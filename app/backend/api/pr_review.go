package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"rk/internal/prreview"
	"rk/internal/tmux"
	"rk/internal/validate"
)

// The `review` surface's HTTP half (spec docs/specs/pr-review.md § R4).
//
// Constitution IX: the two reads are GET, every mutation is POST. Constitution
// IV: these are API endpoints on the existing route set — the surface adds one
// tile KIND, not a page. Constitution I: every gh call runs through
// internal/prreview's exec.CommandContext seam with an explicit argv slice, and
// every user-authored body reaches gh on stdin.
//
// The file LIST and the file BODY are separate reads on purpose: a PR with two
// hundred files must render its list without tokenizing any of them (R7), and
// an expanded file fetches its own lines windowed (R5).

// prReviewRefreshMinInterval throttles forced refreshes the way
// statusRefreshMinInterval does for the PR pollers: the button is safe to
// over-fire.
const (
	prReviewRefreshMinInterval = 5 * time.Second
	// prReviewRequestTimeout bounds a read handler. Generous relative to the
	// 5 s handler cap because a cold mount is several gh calls; the detail
	// fetcher single-flights, so a second mount waits on the first rather than
	// multiplying the work.
	prReviewRequestTimeout = 20 * time.Second
	// prReviewWriteTimeout bounds a mutation (and the detached refresh), which
	// costs a gh write plus the invalidated re-read. It is a generous bound ON
	// FAILURE rather than an expected duration — a GitHub write normally
	// returns in well under a second — and the handler blocks on it because
	// the client needs the outcome to render; there is nothing useful to
	// fire-and-forget here.
	prReviewWriteTimeout = 30 * time.Second
)

// prReviewTarget is the resolution every handler starts from: the window, the
// tmux server it lives on, and the PR its branch resolves to.
type prReviewTarget struct {
	server   string
	windowID string
	prURL    string
	// listening is the window's @rk_win_pr_listen arm, read off the SAME
	// session snapshot the PR URL came from — no extra subprocess.
	listening bool
}

// reviewFetcher lazily builds the process-wide detail fetcher. It is created on
// first use rather than in NewRouterAndServer because a daemon whose user never
// opens a review tile should never allocate its caches.
func (s *Server) reviewFetcher() *prreview.Fetcher {
	s.prReviewOnce.Do(func() {
		if s.prReview == nil {
			s.prReview = prreview.NewFetcher()
		}
	})
	return s.prReview
}

// resolvePRReviewTarget reads the window's branch-derived PR from one
// request-scoped session snapshot. The surface is PR-BACKED ONLY, so a window
// with no PR is a 404 — the tile is unreachable, not empty.
func (s *Server) resolvePRReviewTarget(ctx context.Context, r *http.Request, windowID string) (prReviewTarget, error) {
	target := prReviewTarget{server: serverFromRequest(r), windowID: windowID}
	sessions, err := s.sessions.FetchSessions(ctx, target.server)
	if err != nil {
		return target, err
	}
	for si := range sessions {
		for wi := range sessions[si].Windows {
			window := &sessions[si].Windows[wi]
			if window.WindowID != windowID {
				continue
			}
			if window.PrURL == nil || *window.PrURL == "" {
				return target, prreview.ErrNoPR
			}
			target.prURL = *window.PrURL
			target.listening = window.PrListen
			return target, nil
		}
	}
	return target, prreview.ErrNoPR
}

// windowIDParam reads and validates the `window` query parameter shared by
// every route in this file.
func windowIDParam(r *http.Request) (string, bool) {
	id := r.URL.Query().Get("window")
	if validate.ValidateWindowID(id, "Window ID") != "" {
		return "", false
	}
	return id, true
}

// writePRReviewError maps the package's two states onto HTTP. ErrNoPR is a
// state (the surface is PR-backed only) and ErrUnavailable is the gh
// fail-silent posture — neither is an error banner's worth of noise.
func writePRReviewError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, prreview.ErrNoPR):
		writeError(w, http.StatusNotFound, "Window has no pull request")
	case errors.Is(err, prreview.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "gh is unavailable")
	case errors.Is(err, prreview.ErrTimeout):
		writeError(w, http.StatusGatewayTimeout, "GitHub took too long to respond — try again")
	case errors.Is(err, prreview.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests,
			"GitHub API rate limit exceeded — this resets hourly")
	default:
		// The detail is for the log, NOT the banner: it is a subprocess error,
		// and the reader can do nothing with "signal: killed" or "exit status 1".
		slog.Warn("pr review: gh failed", "err", err)
		writeError(w, http.StatusBadGateway, "Could not reach GitHub")
	}
}

// prReviewListResponse is the tile's mount payload: the file list, the threads,
// the viewer login, and the arm state. No file BODY rides it.
type prReviewListResponse struct {
	*prreview.Review
	Listening bool `json:"listening"`
}

// GET /api/pr/review?window={id}
func (s *Server) handlePRReview(w http.ResponseWriter, r *http.Request) {
	windowID, ok := windowIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), prReviewRequestTimeout)
	defer cancel()

	target, err := s.resolvePRReviewTarget(ctx, r, windowID)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	review, err := s.reviewFetcher().Get(ctx, target.prURL, false)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, prReviewListResponse{
		Review:    review,
		Listening: target.listening,
	})
}

// GET /api/pr/review/file?window={id}&path=…[&start=…&count=…]
//
// Without start/count the response carries the file's PATCH rows (its hunks).
// With them it carries post-image lines start..start+count-1 as context rows —
// the `↕ All N lines` / `↑ 5 lines` expanders — served from the SAME cached
// blob the lexer uses, so expansion costs no extra gh call.
//
// `path` is shape-validated here and then checked against the PR's own
// changed-file list by BOTH branches (FileRows and ContextRows each require
// Review.FindFile to hit). The closed set is the authorization: without it the
// route would serve any blob in the repository at the head sha.
func (s *Server) handlePRReviewFile(w http.ResponseWriter, r *http.Request) {
	windowID, ok := windowIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	path := r.URL.Query().Get("path")
	if validate.ValidatePath(path, "Path") != "" {
		writeError(w, http.StatusBadRequest, "Invalid path")
		return
	}
	start, err := positiveQueryInt(r, "start")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid start")
		return
	}
	count, err := positiveQueryInt(r, "count")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid count")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), prReviewRequestTimeout)
	defer cancel()
	target, err := s.resolvePRReviewTarget(ctx, r, windowID)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	fetcher := s.reviewFetcher()
	review, err := fetcher.Get(ctx, target.prURL, false)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	var body prreview.FileBody
	if start > 0 {
		body, err = fetcher.ContextRows(ctx, review, path, start, count)
	} else {
		body, err = fetcher.FileRows(ctx, review, path)
	}
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// positiveQueryInt reads an optional non-negative integer query parameter.
// Absent is (0, nil); malformed or negative is an error, because a silently
// clamped range would serve the wrong lines.
func positiveQueryInt(r *http.Request, key string) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, errors.New("invalid " + key)
	}
	return value, nil
}

type prReviewCommentBody struct {
	Window string `json:"window"`
	// ThreadReplyTo is the DATABASE id of the comment being replied to. Present
	// ⇒ this is a reply; absent ⇒ a new line-anchored comment.
	ThreadReplyTo int64  `json:"replyTo,omitempty"`
	Path          string `json:"path,omitempty"`
	Line          int    `json:"line,omitempty"`
	StartLine     int    `json:"startLine,omitempty"`
	Side          string `json:"side,omitempty"`
	Body          string `json:"body"`
	// Mode is "single" (post now — the only mode that can dispatch on post) or
	// "review" (append to the viewer's pending review, invisible to gh until
	// submitted).
	Mode string `json:"mode,omitempty"`
}

// POST /api/pr/review/comment
func (s *Server) handlePRReviewComment(w http.ResponseWriter, r *http.Request) {
	var body prReviewCommentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Body == "" {
		writeError(w, http.StatusBadRequest, "Empty comment body")
		return
	}
	if validate.ValidateWindowID(body.Window, "Window ID") != "" {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), prReviewWriteTimeout)
	defer cancel()
	target, err := s.resolvePRReviewTarget(ctx, r, body.Window)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	fetcher := s.reviewFetcher()
	review, err := fetcher.Get(ctx, target.prURL, false)
	if err != nil {
		writePRReviewError(w, err)
		return
	}

	if body.ThreadReplyTo > 0 {
		if err := fetcher.Reply(ctx, review, body.ThreadReplyTo, body.Body); err != nil {
			writePRReviewError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "replied"})
		return
	}

	if body.Path == "" || body.Line <= 0 {
		writeError(w, http.StatusBadRequest, "A new comment needs a path and a line")
		return
	}
	mode := prreview.ModeSingle
	if body.Mode == string(prreview.ModeReview) {
		mode = prreview.ModeReview
	}
	if err := fetcher.AddComment(ctx, review, prreview.NewComment{
		Path:      body.Path,
		Line:      body.Line,
		StartLine: body.StartLine,
		Side:      body.Side,
		Body:      body.Body,
		Mode:      mode,
	}); err != nil {
		writePRReviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": string(mode)})
}

type prReviewThreadBody struct {
	Window   string `json:"window"`
	ThreadID string `json:"threadId"`
	Resolved bool   `json:"resolved"`
}

// POST /api/pr/review/thread — resolve / unresolve.
func (s *Server) handlePRReviewThread(w http.ResponseWriter, r *http.Request) {
	var body prReviewThreadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.ThreadID == "" {
		writeError(w, http.StatusBadRequest, "Missing thread id")
		return
	}
	if validate.ValidateWindowID(body.Window, "Window ID") != "" {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), prReviewWriteTimeout)
	defer cancel()
	target, err := s.resolvePRReviewTarget(ctx, r, body.Window)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	fetcher := s.reviewFetcher()
	review, err := fetcher.Get(ctx, target.prURL, false)
	if err != nil {
		writePRReviewError(w, err)
		return
	}
	if err := fetcher.SetThreadResolved(ctx, review, body.ThreadID, body.Resolved); err != nil {
		writePRReviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"resolved": body.Resolved})
}

type prReviewListenBody struct {
	Window    string `json:"window"`
	Listening bool   `json:"listening"`
}

// POST /api/pr/review/listen — arm / disarm the comment listener for a window.
//
// Arm state is the per-window `@rk_win_pr_listen` tmux option: per-window
// because the unit of work is a branch, and SHARED across viewers because
// arming is a fact about the work rather than a viewing posture.
func (s *Server) handlePRReviewListen(w http.ResponseWriter, r *http.Request) {
	var body prReviewListenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if validate.ValidateWindowID(body.Window, "Window ID") != "" {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var err error
	if body.Listening {
		err = s.tmux.SetWindowOption(ctx, body.Window, server, tmux.PrListenOption, "1")
	} else {
		err = s.tmux.UnsetWindowOption(ctx, body.Window, server, tmux.PrListenOption)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"listening": body.Listening})
}

// POST /api/pr/review/refresh — mirrors POST /api/status/refresh: detached,
// coalesced, throttled, and always 202 with the fate in the body (the body is
// not the completion signal).
func (s *Server) handlePRReviewRefresh(w http.ResponseWriter, r *http.Request) {
	windowID, ok := windowIDParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	target, err := s.resolvePRReviewTarget(ctx, r, windowID)
	if err != nil {
		writePRReviewError(w, err)
		return
	}

	outcome := s.startPRReviewRefresh(target.prURL)
	if outcome == refreshStarted {
		fetcher := s.reviewFetcher()
		prURL := target.prURL
		go func() {
			// context.Background, not r.Context — the request is already gone
			// by the time the gh work runs (the api/waiting_push.go pattern).
			detached, cancel := context.WithTimeout(context.Background(), prReviewWriteTimeout)
			defer cancel()
			fetcher.Invalidate(prURL)
			_, _ = fetcher.Get(detached, prURL, true)
			s.finishPRReviewRefresh(prURL)
		}()
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": string(outcome)})
}

// prReviewRefreshState is the per-PR in-flight + throttle record behind the
// refresh choke point.
type prReviewRefreshState struct {
	mu       sync.Mutex
	inFlight map[string]bool
	lastAt   map[string]time.Time
	now      func() time.Time
}

func newPRReviewRefreshState() *prReviewRefreshState {
	return &prReviewRefreshState{
		inFlight: map[string]bool{},
		lastAt:   map[string]time.Time{},
		now:      time.Now,
	}
}

func (s *Server) startPRReviewRefresh(prURL string) refreshOutcome {
	state := s.prReviewRefreshOrInit()
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.inFlight[prURL] {
		return refreshCoalesced
	}
	if last, ok := state.lastAt[prURL]; ok && state.now().Sub(last) < prReviewRefreshMinInterval {
		return refreshThrottled
	}
	state.inFlight[prURL] = true
	state.lastAt[prURL] = state.now()
	return refreshStarted
}

func (s *Server) finishPRReviewRefresh(prURL string) {
	state := s.prReviewRefreshOrInit()
	state.mu.Lock()
	delete(state.inFlight, prURL)
	state.mu.Unlock()
}

func (s *Server) prReviewRefreshOrInit() *prReviewRefreshState {
	s.prReviewOnce.Do(func() {
		if s.prReview == nil {
			s.prReview = prreview.NewFetcher()
		}
	})
	s.prReviewRefreshOnce.Do(func() {
		if s.prReviewRefresh == nil {
			s.prReviewRefresh = newPRReviewRefreshState()
		}
	})
	return s.prReviewRefresh
}
