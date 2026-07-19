package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"rk/internal/chat"
	"rk/internal/sessions"
)

// chatRefResolveInterval is the cadence at which an open chat SUBSCRIPTION's
// producer (chat_ws.go, on /ws/state) re-resolves the window's @rk_chat ref, so a
// session rotation (/clear, /compact — which re-stamps @rk_chat within one hook
// fire) surfaces a fresh `chat-reset` on the same subscription without a client
// reconnect. This same tick also retries a not-yet-created transcript (lazy
// creation post-/clear), so the producer converges on the new session once Claude
// Code writes its first line. Named (not a magic number); slower than the
// transcript tail cadence because rotation is rare relative to appends. A package
// var (not a const) only so tests can shrink it — production always uses this
// value.
var chatRefResolveInterval = 2 * time.Second

// resolveWindowChat resolves a window's reconciled @rk_chat rollup server-side.
// It fetches the server's sessions, finds the window by its stable WindowID, and
// returns the resolved (ChatProvider, ChatSessionRef, PaneID) via
// sessions.ResolveChatPane — the same active-pane-first / else-first-chat-pane
// rule Change 1 applied in FetchSessions. It NEVER trusts a client-supplied ref
// or pane. The paneID is the chat-send injection target: a WINDOW target routes
// to the active pane, which in a split may not be the chat pane, so send targets
// the resolved pane, not the window.
//
// A non-nil error means FetchSessions itself failed (an infrastructure fault the
// caller maps to 500, mirroring handleSessionsList). ok=false with a nil error
// means the fetch succeeded but the window is absent or carries no reconciled
// chat (a genuine 404). The two are distinct so a transient tmux failure is not
// misreported as "no chat session".
func (s *Server) resolveWindowChat(ctx context.Context, server, windowID string) (provider, ref, paneID string, ok bool, err error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return "", "", "", false, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			w := &sess[si].Windows[wi]
			if w.WindowID == windowID {
				p, r, pane := sessions.ResolveChatPane(w.Panes)
				if p == "" {
					return "", "", "", false, nil
				}
				return p, r, pane, true, nil
			}
		}
	}
	return "", "", "", false, nil
}

// handleChatBackfill serves GET /api/windows/{windowId}/chat — the full
// conversation as rk-schema JSON. Reads only (Constitution IX); curl-able.
func (s *Server) handleChatBackfill(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	server := serverFromRequest(r)

	provider, ref, _, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
	if err != nil {
		// FetchSessions itself failed — an infrastructure fault, not a missing
		// chat. Mirror handleSessionsList's 500 rather than reporting "no chat".
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no chat session for this window")
		return
	}
	adapter, err := chat.Lookup(provider)
	if err != nil {
		// Well-formed but unregistered provider (codex/gemini in v1) — 404-class.
		writeError(w, http.StatusNotFound, fmt.Sprintf("no adapter for provider %q", provider))
		return
	}
	conv, err := adapter.Backfill(r.Context(), ref)
	if err != nil {
		s.writeChatReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

// writeChatReadError maps an adapter read error to an HTTP response. A missing
// transcript for a live ref, or a malformed reconciled ref, is surfaced as a
// 404-class response: the client only ever supplies a windowID, so a bad ref is
// a property of the reconciled @rk_chat (per Change 1's no-disk-validation
// rationale, this endpoint is where those naturally show), not a server fault.
// Any other read error is a 500.
func (s *Server) writeChatReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, chat.ErrTranscriptNotFound) {
		writeError(w, http.StatusNotFound, "transcript not found for session")
		return
	}
	if errors.Is(err, chat.ErrInvalidRef) {
		writeError(w, http.StatusNotFound, "malformed chat session ref for this window")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

// --- chat send (260714-jdyg-chat-send) --------------------------------------

// Chat-send probe timing. A short settle lets the TUI redraw after the paste
// before the first echo capture; a bounded retry tolerates a slow redraw. The
// probe's own wall-clock worst case is settle + (attempts-1)*gap = 80 + 2*80 =
// 240ms; the whole injection sequence (baseline capture → set → paste → up to 3
// probe captures → Enter) additionally runs 6 tmux subprocesses. Those
// subprocesses no longer each carry an independent 10s timeout: handleChatSend
// threads ONE shared context deadline (chatSendTotalBudget) through the entire
// sequence, so the route stays bounded well under the 5s route-blocking rule
// (code-review.md) even on a slow tmux. Settle/gap are package vars (not consts)
// SOLELY so tests can shrink them — production always uses these values (mirrors
// chatRefResolveInterval).
var (
	chatSendProbeSettle = 80 * time.Millisecond
	chatSendProbeGap    = 80 * time.Millisecond
)

const (
	chatSendProbeAttempts = 3
	// chatSendProbeCaptureLines is the tail depth captured for the echo probe —
	// enough to catch the pasted message even when the TUI input box wraps it
	// across several rows, without capturing the whole scrollback.
	chatSendProbeCaptureLines = 40
	// chatSendNeedleMaxLen caps the probe needle length so an ~80-col TUI wrap
	// cannot split the fragment we look for; taken from the END of the last line
	// (most recently typed characters are the most reliable to have landed).
	chatSendNeedleMaxLen = 40
	// chatSendTotalBudgetDefault is the default value of chatSendTotalBudget: it
	// bounds the WHOLE injection sequence (all 6 subprocesses plus the
	// settle/retry sleeps share this one deadline). Comfortably covers the 240ms
	// of probe sleeps with headroom for the tmux exec latencies while staying
	// under the 5s route-blocking budget (code-review.md) — the earlier design
	// granted each subprocess its own 10s timeout, so a stalled sequence could
	// block the route for far longer than 5s.
	chatSendTotalBudgetDefault = 4 * time.Second
)

// chatSendTotalBudget is the shared injection deadline (see
// chatSendTotalBudgetDefault). A package var (not a const) SOLELY so a test can
// shrink it to assert the deadline aborts the sequence; production always uses
// the default.
var chatSendTotalBudget = chatSendTotalBudgetDefault

// chatSendLocks serializes concurrent chat sends per (server, paneID). Each
// injection holds its pane's lock across the WHOLE sequence — baseline capture →
// set-buffer → paste-buffer → echo probe → Enter — for two reasons:
//
//  1. The set → paste critical section uses ONE shared named tmux buffer
//     (tmux.ChatSendBuffer), and rk is that buffer's sole writer, so two sends
//     could otherwise interleave as A-set / B-set / A-paste (pane A receives B's
//     text; B's own paste (-d) 500s on the already-deleted buffer).
//  2. More subtly, two sends to the SAME pane racing the same composer could each
//     paste before either probes+Enters, merging into one doubled submission.
//     Holding the lock for the whole sequence means the second send only begins
//     after the first has finished (paste → probe → Enter or the 409), so it
//     observes a settled composer rather than the first send's in-flight paste.
//
// Scoping the lock per (server, paneID) keeps DISTINCT panes fully concurrent —
// only same-pane sends serialize. But distinct panes still share the single
// server-wide named buffer, so the set → paste subsequence is ALSO serialized
// across all panes by a small global mutex (chatSetPasteMu) nested inside the
// per-pane lock. Division of labour: the per-pane lock provides same-pane
// whole-sequence ordering; the global mutex provides shared-buffer atomicity for
// the two-subprocess set → paste window across panes. Both are held only briefly
// relative to the slow probe captures, so throughput across distinct panes stays
// high.
var chatSendLocks = newChatSendLockMap()

// chatSetPasteMu guards the shared named-buffer set → paste critical section
// across ALL panes (see chatSendLocks). Nested inside the per-pane lock; held
// only for the two fast subprocesses so cross-pane sends stay concurrent
// everywhere else.
var chatSetPasteMu sync.Mutex

// chatSendLockMap hands out one *sync.Mutex per (server, paneID) key so
// concurrent sends to the same pane serialize while distinct panes run
// concurrently. Entries are created on demand and intentionally never evicted:
// the key space is bounded by the live pane set (small), and eviction would
// reintroduce a race (a send could drop the last reference between two
// same-pane sends). A plain guarded map is the minimal structure here.
type chatSendLockMap struct {
	mu sync.Mutex
	m  map[string]*sync.Mutex
}

func newChatSendLockMap() *chatSendLockMap {
	return &chatSendLockMap{m: make(map[string]*sync.Mutex)}
}

// lockFor returns the mutex for a (server, paneID) pair, creating it on first
// use. The returned mutex is NOT locked — the caller Lock/Unlocks it.
func (l *chatSendLockMap) lockFor(server, paneID string) *sync.Mutex {
	key := server + "\x00" + paneID
	l.mu.Lock()
	defer l.mu.Unlock()
	mu, ok := l.m[key]
	if !ok {
		mu = &sync.Mutex{}
		l.m[key] = mu
	}
	return mu
}

// chatSendRequest is the POST body for handleChatSend.
type chatSendRequest struct {
	Text string `json:"text"`
}

// handleChatSend serves POST /api/windows/{windowId}/chat/send — injects a
// message into the window's resolved agent pane. Mutation ⇒ POST (Constitution
// IX). It re-resolves the pane server-side (the client supplies only a windowID
// and the text), pastes the text into the pane via a named tmux buffer, probes
// that it echoed into the live input buffer, and ONLY THEN sends Enter. A probe
// failure withholds Enter and returns 409 (structured), leaving the pasted text
// visibly in the TUI input box — recoverable state, never a blind Enter.
//
// Busy policy is Allow + probe (user-decided): there is NO agentState gate and
// NO server-side queue (Constitution II). A busy (active) agent receives the
// paste into its TUI input box, which Claude Code queues natively (steering);
// the probe is the sole guard.
func (s *Server) handleChatSend(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body chatSendRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Strip terminal control bytes BEFORE the emptiness check so every downstream
	// consumer (needle, multiline detection, paste, probe) sees the sanitized text
	// and an all-control message collapses to empty and takes the existing 400 path.
	body.Text = sanitizeChatText(body.Text)
	if strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "Message text cannot be empty")
		return
	}

	server := serverFromRequest(r)

	_, _, paneID, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
	if err != nil {
		// FetchSessions itself failed — infrastructure fault (mirror the read
		// endpoints' 500), not a missing chat.
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no chat session for this window")
		return
	}

	// One shared deadline for the WHOLE injection sequence (Constitution /
	// Process Execution + code-review.md's 5s route-blocking rule): baseline
	// capture → set → paste → probe captures → Enter all run under this single
	// context, so the route can never block for the old worst case of 6 × 10s.
	// Derived from the request context so a client disconnect also cancels the
	// tmux subprocesses.
	ctx, cancel := context.WithTimeout(r.Context(), chatSendTotalBudget)
	defer cancel()

	// Provider-agnostic tmux injection behind a small function seam so Change 5's
	// protocol-based codex send can later branch on provider without reshaping
	// this handler. v1 makes NO provider branch.
	if err := s.injectChatMessage(ctx, server, paneID, body.Text); err != nil {
		var probeErr chatProbeFailure
		if errors.As(err, &probeErr) {
			// Probe failed — no Enter was sent; the pasted text is left visible in
			// the TUI input box (recoverable state), and the failure is surfaced.
			writeError(w, http.StatusConflict, probeErr.Error())
			return
		}
		// A tmux subprocess failure (set-buffer / paste-buffer / capture / Enter).
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// chatProbeFailure is the sentinel error type for a failed echo probe — the
// pasted text did not echo into the pane's live input buffer within the retry
// budget, so Enter was withheld. The handler maps it to a structured 409.
type chatProbeFailure struct{}

func (chatProbeFailure) Error() string {
	// The retry hint matters because the pasted text is left sitting in the
	// agent's composer (Enter was withheld, not the paste). An identical retry
	// would paste a SECOND copy on top of the first and submit doubled text — so
	// steer the user to check the terminal view before resending.
	return "agent input not ready — message pasted but not echoed; Enter withheld. " +
		"The text remains in the agent's input — check the terminal view before retrying, as a resend would duplicate it."
}

// chatSendCollapseMinRunes is the single-line rune length at or above which the
// paste-collapse placeholder is counted as a valid echo signal. Claude Code
// collapses a single-line paste over 800 chars into a suffix-less
// "[Pasted text #N]" chip (empirical, CC 2.1.215, INDEPENDENT of TUI width — the
// observed threshold is 801). 200 is a deliberately conservative lower bound so an
// upstream threshold reduction cannot silently rebreak long-single-line sends,
// while short interactive sends (which never collapse) keep exact-needle-only
// matching and so keep the narrowest false-positive window.
const chatSendCollapseMinRunes = 200

// injectChatMessage runs the pane-targeted injection sequence (Constitution I —
// all argv slices, no shell strings, text as a discrete argv element via the
// named buffer): baseline capture → set-buffer → paste-buffer (-d -p, bracketed)
// → NOVELTY echo probe → send-keys Enter (only on probe success). Every step
// targets paneID, never the window, and shares the caller's ctx deadline.
//
// The probe verifies NOVELTY, not mere presence: it counts the needle (and, for a
// COLLAPSIBLE paste, the paste-collapse placeholder) in a PRE-PASTE baseline
// capture and requires the count to strictly INCREASE after the paste. This is
// what makes the guard sound: a stale "[Pasted text #N …]" chip already in-frame
// (this very handler's 409 path leaves the pasted text in the composer) or a
// short/common needle like "y"/"ok" already on screen no longer false-positives
// the probe — only the CURRENT paste, which adds a fresh occurrence, satisfies it.
// If the pane scrolls between baseline and probe the count cannot rise, so it
// fails CLOSED (409, no blind Enter) — the exact hazard (blind Enter into e.g. a
// permission dialog) R5 exists to prevent.
//
// A tmux failure is returned verbatim (→ 500); a probe failure is returned as
// chatProbeFailure (→ 409, Enter withheld).
func (s *Server) injectChatMessage(ctx context.Context, server, paneID, text string) error {
	needle := chatProbeNeedle(text)
	if needle == "" {
		// Whitespace-only text is rejected upstream (400); a non-empty text always
		// yields a non-empty needle. Defensive: an empty needle means "cannot
		// verify", so fail closed BEFORE touching the buffer — never a blind Enter.
		return chatProbeFailure{}
	}
	// The TUI can collapse a paste into a "[Pasted text #N …]" chip instead of
	// echoing the raw text — for MULTILINE text (a "+M lines" chip) OR for a long
	// single line (a suffix-less chip, empirically >800 chars). A paste is
	// "collapsible" when either is possible, and only then is the chip a valid
	// echo signal (see chatSendCollapseMinRunes). Short single-line pastes keep
	// exact-needle-only matching.
	collapsible := strings.Contains(text, "\n") || utf8.RuneCountInString(text) >= chatSendCollapseMinRunes

	// Serialize the WHOLE sequence per (server, paneID): a second send to the SAME
	// pane only begins after this one has fully finished (baseline → set → paste →
	// probe → Enter or 409), so it can never paste into a composer already holding
	// this send's in-flight paste (which would merge into one doubled submission).
	// Distinct panes run concurrently — each takes its own lock.
	paneLock := chatSendLocks.lockFor(server, paneID)
	paneLock.Lock()
	defer paneLock.Unlock()

	// PRE-PASTE baseline: the occurrence count the probe must beat. Captured
	// BEFORE mutating the buffer so any stale needle/placeholder already in-frame
	// is included in the floor rather than mistaken for this paste's echo.
	baseline, err := s.tmux.CapturePane(ctx, paneID, chatSendProbeCaptureLines, server)
	if err != nil {
		return fmt.Errorf("capture-pane (baseline): %w", err)
	}
	baseCount := countProbeOccurrences(baseline, needle, collapsible)

	// The set → paste critical section is additionally serialized across ALL panes
	// (chatSetPasteMu) because the named buffer is shared server-wide; held only
	// for these two fast subprocesses. The probe below runs with only the per-pane
	// lock held.
	if err := s.setAndPaste(ctx, server, paneID, text); err != nil {
		return err
	}

	if err := s.probeChatEcho(ctx, server, paneID, needle, collapsible, baseCount); err != nil {
		return err
	}
	if err := s.tmux.SendEnterToPane(ctx, paneID, server); err != nil {
		return fmt.Errorf("send-keys: %w", err)
	}
	return nil
}

// setAndPaste runs the set-buffer → paste-buffer critical section under
// chatSetPasteMu so two concurrent sends to DIFFERENT panes (each holding its own
// per-pane lock) cannot interleave on the shared named buffer as
// A-set / B-set / A-paste. See chatSendLocks / chatSetPasteMu.
func (s *Server) setAndPaste(ctx context.Context, server, paneID, text string) error {
	chatSetPasteMu.Lock()
	defer chatSetPasteMu.Unlock()
	if err := s.tmux.SetChatSendBuffer(ctx, text, server); err != nil {
		return fmt.Errorf("set-buffer: %w", err)
	}
	if err := s.tmux.PasteChatSendBuffer(ctx, paneID, server); err != nil {
		return fmt.Errorf("paste-buffer: %w", err)
	}
	return nil
}

// probeChatEcho verifies the pasted text NEWLY echoed into the pane's live input
// buffer before Enter is committed. It waits a short settle, then captures the
// pane tail up to chatSendProbeAttempts times (bounded retry with a small gap),
// returning nil on the first capture whose needle/placeholder occurrence count
// strictly exceeds baseCount (the pre-paste floor) — proof THIS paste added an
// occurrence, not that a stale one was already present. A tmux capture failure
// is returned verbatim (→ 500, distinct from a clean probe miss); an exhausted
// retry returns chatProbeFailure (→ 409). All captures and sleeps share the
// caller's ctx deadline, so the loop stays well under the route budget.
func (s *Server) probeChatEcho(ctx context.Context, server, paneID, needle string, collapsible bool, baseCount int) error {
	for attempt := 0; attempt < chatSendProbeAttempts; attempt++ {
		d := chatSendProbeGap
		if attempt == 0 {
			d = chatSendProbeSettle
		}
		// ctx-aware settle/gap: on a client disconnect or the shared deadline
		// firing, abort the probe promptly rather than sleeping out the full
		// interval before the next capture would notice the cancelled ctx.
		if err := sleepCtx(ctx, d); err != nil {
			return err
		}
		capture, err := s.tmux.CapturePane(ctx, paneID, chatSendProbeCaptureLines, server)
		if err != nil {
			return fmt.Errorf("capture-pane: %w", err)
		}
		if countProbeOccurrences(capture, needle, collapsible) > baseCount {
			return nil
		}
	}
	return chatProbeFailure{}
}

// sleepCtx sleeps for d but returns early with ctx.Err() if ctx is cancelled or
// its deadline fires first. Used by the echo probe so a client disconnect (or
// the shared chatSendTotalBudget deadline) aborts the settle/gap wait promptly
// instead of sleeping out the full interval. A ctx error propagates up as the
// injection error (→ 500), never a false chatProbeFailure.
func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ansiEscapeRe matches the ANSI CSI / OSC escape sequences CapturePane preserves
// (it captures with -e). Stripped before probe matching so styling never breaks
// the echo check.
var ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)

// pasteCollapseRe matches Claude Code's paste-collapse placeholder — the TUI
// replaces a larger bracketed paste with a chip rather than echoing the raw text,
// so the raw needle would never be found and the probe would 409 exactly the
// collapsed case. There are TWO chip forms:
//   - multiline collapse:            "[Pasted text #N +M lines]"
//   - long single-line collapse:     "[Pasted text #N]" (NO "+M lines" suffix)
//
// The single-line collapse is a pure character-count threshold (empirically
// >800 chars on Claude Code 2.1.215, INDEPENDENT of TUI width — verified at
// 60/80/200 cols), NOT a wrap effect, so the suffix-less chip carries no line
// count. The placeholder counts as a SUCCESSFUL echo (the paste demonstrably
// reached the input buffer — the TUI only renders this chip for content it
// accepted) — but ONLY when the paste is COLLAPSIBLE (see countProbeOccurrences /
// chatSendCollapseMinRunes), and ONLY as a fresh occurrence vs the pre-paste
// baseline (a stale chip from a prior send is in the baseline count).
//
// The pattern matches the WHITESPACE-STRIPPED capture (stripForProbe removes all
// whitespace — spaces, tabs, newlines, etc.), i.e. "[Pastedtext#1+12lines]" or
// "[Pastedtext#5]"; the "+M lines" part
// is optional and tolerant of singular/plural "line"/"lines" and any digit counts.
var pasteCollapseRe = regexp.MustCompile(`\[Pastedtext#\d+(?:\+\d+lines?)?\]`)

// sanitizeChatText strips terminal control bytes from a chat-send message before
// it is pasted into the agent pane. Bracketed paste makes ordinary text inert, but
// control bytes ride through verbatim — most sharply ESC (0x1B), which can embed
// the bracketed-paste-end sequence (ESC[201~) and turn the tail of the message into
// live keystrokes (the classic paste-injection break-out). Defense: normalize
// CR/CRLF to \n, then drop every control rune — unicode.IsControl covers C0
// (U+0000–U+001F), DEL (U+007F), and the C1 range (U+0080–U+009F, incl. the
// single-byte CSI U+009B) — EXCEPT \n and \t, which are legitimate message content
// (multiline messages and indented code). CR-normalization (rather than bare
// stripping) keeps a CRLF-origin multiline message's line structure so it still
// counts as multiline downstream.
func sanitizeChatText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text)
}

// chatProbeNeedle derives the echo-probe needle from the message text: the LAST
// non-empty line, whitespace-stripped and capped to the last chatSendNeedleMaxLen
// runes (so an ~80-col TUI wrap cannot split the fragment we look for). Returns
// "" only for whitespace-only text (rejected upstream).
func chatProbeNeedle(text string) string {
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		stripped := stripForProbe(lines[i])
		if stripped == "" {
			continue
		}
		runes := []rune(stripped)
		if len(runes) > chatSendNeedleMaxLen {
			runes = runes[len(runes)-chatSendNeedleMaxLen:]
		}
		return string(runes)
	}
	return ""
}

// countProbeOccurrences counts how many times this paste's echo signal appears
// in the pane capture: the raw needle occurrences PLUS, when the paste is
// COLLAPSIBLE, the paste-collapse placeholder occurrences. Both the capture and
// the needle have ALL whitespace removed (stripForProbe) so a TUI wrap that
// inserts spaces/newlines mid-fragment (or a leading prompt glyph on the wrapped
// row) cannot defeat the match.
//
// The handler compares this count against a pre-paste BASELINE and requires a
// strict increase, so a stale needle/placeholder already in-frame is a floor to
// beat rather than a false positive. The collapsible gate matters: `collapsible`
// means the TUI may have collapsed THIS paste into a chip (multiline text, or a
// single line long enough to collapse — chatSendCollapseMinRunes), so the chip is
// a valid fresh-echo signal; a short single-line paste never collapses, so
// counting the chip for it would only widen the concurrent-fresh-chip
// false-positive window. A short/common single-line needle ("y", "ok") could
// substring-match unrelated stale content, but that content is in the baseline
// too — the caller's strict-increase requirement, not this counter, is what makes
// short needles fail closed against stale content.
func countProbeOccurrences(capture, needle string, collapsible bool) int {
	stripped := stripForProbe(capture)
	n := strings.Count(stripped, needle)
	if collapsible {
		n += len(pasteCollapseRe.FindAllString(stripped, -1))
	}
	return n
}

// stripForProbe normalizes a string for echo matching: strip ANSI escapes, then
// remove ALL whitespace (spaces, tabs, newlines). Wrap-safe by construction.
func stripForProbe(s string) string {
	s = ansiEscapeRe.ReplaceAllString(s, "")
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
