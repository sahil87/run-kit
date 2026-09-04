package sessions

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"rk/internal/config"
	"rk/internal/prstatus"
	"rk/internal/tmux"
)

// Viewer is one size-arbitrating client attached to a session — the
// per-viewer grid fact (the size IS the diagnostic payload: it identifies the
// clamping client) behind the sidebar's viewer indicator.
type Viewer struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// ProjectSession is a tmux session with its windows and optional fab enrichment.
type ProjectSession struct {
	Name string `json:"name"`
	// Color value descriptor ("4" / "1+3"), sourced from the @rk_ses_color tmux option.
	SessionColor *string `json:"sessionColor,omitempty"`
	// SessionID is the tmux session id ("$N" form, from #{session_id}) — the
	// canonical target handle. Additive JSON key.
	SessionID string `json:"sessionId,omitempty"`
	// SessionPath is the session working directory (#{session_path}). Raw
	// derived state; display abbreviation is the frontend's concern.
	SessionPath string `json:"sessionPath,omitempty"`
	// Flair is the session's per-row flair decoration ("" = unset; one of the
	// validate.FlairValues closed set), sourced from the @rk_ses_flair tmux
	// session option (scope-split from the window @rk_win_flair — see
	// tmux.SetSessionFlair).
	Flair   string            `json:"flair,omitempty"`
	Windows []tmux.WindowInfo `json:"windows"`
	// Hidden is the content-conditional operator-home marker, computed at the
	// FetchSessions join (post window fan-out): true only for the operator
	// session (tmux.OperatorSessionName) while it holds ≥1 window and EVERY
	// window carries role == "operator". The session and its windows STAY in
	// the payload (the window is moved, not linked, so this session is the
	// pinned operator row's only data source); user-facing session
	// enumerations exclude hidden sessions at render. A mixed or stray
	// population yields false, so no window can ever become invisible.
	Hidden bool `json:"hidden,omitempty"`
	// Viewers lists the session's size-arbitrating attached clients, derived
	// from `tmux list-clients` at fetch time (internal/tmux ListClients —
	// control-mode/ignore-size attaches and unsized clients already excluded)
	// and joined by group key (ClientInfo.SessionKey), so a client attached
	// via a derived group copy counts against the leader row. Absent when the
	// session has no attached clients (omitempty); the frontend surfaces a
	// viewer indicator only at ≥2.
	Viewers []Viewer `json:"viewers,omitempty"`
}

// foldViewers buckets the size-arbitrating clients onto session names via the
// group-key join (ClientInfo.SessionKey: the group leader's name for a grouped
// attach, else the attached session's own name — mirroring the leader-keeps-name
// rule so a viewer attached via a derived group copy still counts against the
// UI session). Pure (no I/O) so the join is unit-testable without a live
// server. Returns nil for no clients.
func foldViewers(clients []tmux.ClientInfo) map[string][]Viewer {
	if len(clients) == 0 {
		return nil
	}
	bySession := make(map[string][]Viewer)
	for _, c := range clients {
		key := c.SessionKey()
		if key == "" {
			continue
		}
		bySession[key] = append(bySession[key], Viewer{Width: c.Width, Height: c.Height})
	}
	return bySession
}

// operatorSessionHidden is the pure content rule behind ProjectSession.Hidden:
// hidden iff the session is the operator session AND it holds ≥1 window AND
// every window carries role == "operator". Pure (no I/O) so the truth table is
// unit-testable without a live server.
func operatorSessionHidden(name string, windows []tmux.WindowInfo) bool {
	if name != tmux.OperatorSessionName || len(windows) == 0 {
		return false
	}
	for _, w := range windows {
		if w.Role != "operator" {
			return false
		}
	}
	return true
}

// ActiveWindowProvider supplies the event-tracked active window (`@wid`) for a
// (server, group) pair — the authoritative Tier-1 signal derived from tmux
// control-mode `%session-window-changed` events. It is the seam between the
// tmuxctl layer (which owns the tracker) and the fetch path. A nil provider, or
// a (server, group) miss, signals "no tracked value" so FetchSessions falls
// back to the base-session `#{window_active}` pointer (Tier 2) — preserving
// today's behavior when control-mode is unavailable.
type ActiveWindowProvider interface {
	ActiveWindow(server, group string) (wid string, ok bool)
}

// applyActiveWindow enforces the two-tier active-window derivation on one
// session's windows in place. When trackedWid is non-empty (Tier 1) AND a live
// window matches it, exactly that window is marked active and all others are
// cleared — overriding the base-pointer flag parsed by parseWindows. If
// trackedWid is empty (no tracked entry) OR matches no live window (stale —
// e.g. the window closed between the event and this fetch), the base-pointer
// flags are left untouched (Tier 2 fallback). This guarantees the sidebar's
// single-highlight invariant: at most one window is active per session.
//
// Pure function (no I/O) so the derivation is unit-testable directly, mirroring
// the parseWindows/parsePanes split.
func applyActiveWindow(windows []tmux.WindowInfo, trackedWid string) {
	if trackedWid == "" {
		return // Tier 2: keep base-pointer flags.
	}
	matchIdx := -1
	for i := range windows {
		if windows[i].WindowID == trackedWid {
			matchIdx = i
			break
		}
	}
	if matchIdx < 0 {
		// Stale tracked @wid (window gone) — fall back to Tier 2 for this
		// session rather than marking none active.
		return
	}
	for i := range windows {
		windows[i].IsActiveWindow = i == matchIdx
	}
}

// Per-entry git branch cache with separate positive/negative TTLs. lastGood /
// lastGoodAt remember the most recent GENUINE positive resolution independently
// of the served branch: during a detached-HEAD grace serve the entry's branch is
// the remembered one, but lastGoodAt is never re-stamped, so the grace window is
// measured from the last real ref — a deliberate long-term detached checkout
// exhausts it and degrades to the negative cache rather than holding forever.
type gitBranchCacheEntry struct {
	branch     string
	expiresAt  time.Time
	lastGood   string
	lastGoodAt time.Time
}

const (
	gitBranchPositiveTTL  = 30 * time.Second
	gitBranchNegativeTTL  = 15 * time.Second
	gitBranchResolveLimit = 16
	gitBranchCmdTimeout   = 250 * time.Millisecond

	// gitBranchDetachedGraceTTL bounds how long a detached HEAD keeps serving the
	// cwd's last-known branch. A rebase/bisect ends on the branch it started on,
	// so blanking the branch (and with it every PR surface) mid-rebase is pure
	// noise — but the grace MUST expire so a checkout deliberately parked
	// detached eventually reads as branchless. Sized to cover a long interactive
	// rebase; the serve is cached on the NEGATIVE cadence (15s) so the real HEAD
	// is re-read promptly once the rebase finishes.
	gitBranchDetachedGraceTTL = 5 * time.Minute
)

var (
	gitBranchCacheMu sync.RWMutex
	gitBranchCache   = make(map[string]gitBranchCacheEntry)
)

type cwdExistsCacheEntry struct {
	missing   bool
	expiresAt time.Time
}

const (
	// A deleted worktree stays deleted, so the positive ("exists") result can
	// be cached longer; the negative ("missing") result is the interesting,
	// changeable one, but it too rarely flips back, so both use one short TTL
	// that keeps the SSE tick from stat-storming while staying responsive.
	cwdExistsTTL = 10 * time.Second
)

var (
	cwdExistsCacheMu sync.RWMutex
	cwdExistsCache   = make(map[string]cwdExistsCacheEntry)
)

// resolveCwdMissing reports, for each unique non-empty cwd, whether the path no
// longer exists on disk (true == missing). It follows the same TTL-cache pattern
// as resolveGitBranches: a per-entry TTL cache fronts a cheap os.Stat so the SSE
// hub's periodic refresh doesn't stat every pane on every tick. (It omits that
// function's per-call resolve limit and ctx-cancellation checks — an os.Stat is
// cheaper than git resolution and the loop is bounded by the distinct pane cwds.)
// A cwd that exists (or whose stat fails for any reason other than not-existing)
// is treated as present — we only flag the unambiguous fs.ErrNotExist case to
// avoid false "(deleted)" markers on transient errors (permissions, races).
func resolveCwdMissing(cwds []string) map[string]bool {
	now := time.Now()
	result := make(map[string]bool)
	seen := make(map[string]bool)
	var misses []string

	cwdExistsCacheMu.RLock()
	for _, cwd := range cwds {
		if cwd == "" || seen[cwd] {
			continue
		}
		seen[cwd] = true
		if entry, ok := cwdExistsCache[cwd]; ok && now.Before(entry.expiresAt) {
			if entry.missing {
				result[cwd] = true
			}
			continue
		}
		misses = append(misses, cwd)
	}
	cwdExistsCacheMu.RUnlock()

	if len(misses) == 0 {
		return result
	}

	updates := make(map[string]cwdExistsCacheEntry, len(misses))
	for _, cwd := range misses {
		_, err := os.Stat(cwd)
		missing := errors.Is(err, fs.ErrNotExist)
		if missing {
			result[cwd] = true
		}
		updates[cwd] = cwdExistsCacheEntry{missing: missing, expiresAt: now.Add(cwdExistsTTL)}
	}

	cwdExistsCacheMu.Lock()
	for cwd, entry := range updates {
		cwdExistsCache[cwd] = entry
	}
	cwdExistsCacheMu.Unlock()

	return result
}

// resolveGitBranchFromHead reads .git/HEAD directly (no subprocess).
// Handles both normal repos and worktrees (where .git is a file pointing to the
// real gitdir). detached reports a READABLE HEAD that is not a ref — the
// mid-rebase/bisect shape — which the caller may bridge with the last-known
// branch (grace); every unreadable/non-repo shape is (ok=false, detached=false)
// and keeps plain negative behavior.
func resolveGitBranchFromHead(cwd string) (branch string, detached, ok bool) {
	if cwd == "" {
		// filepath.Join("", ".git") is a RELATIVE ".git" — it would stat against
		// the server process's own working directory, not any pane's repo.
		return "", false, false
	}
	gitPath := filepath.Join(cwd, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return "", false, false
	}

	headPath := ""
	if info.IsDir() {
		headPath = filepath.Join(gitPath, "HEAD")
	} else {
		// Worktree: .git is a file containing "gitdir: <path>"
		data, err := os.ReadFile(gitPath)
		if err != nil {
			return "", false, false
		}
		data = bytes.TrimSpace(data)
		if !bytes.HasPrefix(data, []byte("gitdir:")) {
			return "", false, false
		}
		gitDir := string(bytes.TrimSpace(data[7:]))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(cwd, gitDir)
		}
		headPath = filepath.Join(gitDir, "HEAD")
	}

	head, err := os.ReadFile(headPath)
	if err != nil {
		return "", false, false
	}
	head = bytes.TrimSpace(head)
	if !bytes.HasPrefix(head, []byte("ref:")) {
		return "", true, false // detached HEAD (raw commit SHA)
	}
	ref := string(bytes.TrimSpace(head[4:]))
	// "refs/heads/main" → "main"
	if i := len("refs/heads/"); len(ref) > i {
		return ref[i:], false, true
	}
	return "", false, false
}

// resolveGitBranchWithGit falls back to git rev-parse (for edge cases). detached
// mirrors resolveGitBranchFromHead's signal: rev-parse prints the literal `HEAD`
// on a detached checkout.
func resolveGitBranchWithGit(ctx context.Context, cwd string) (branch string, detached bool) {
	gitCtx, cancel := context.WithTimeout(ctx, gitBranchCmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(gitCtx, "git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	b := string(bytes.TrimSpace(out))
	if b == "HEAD" {
		return "", true // detached
	}
	return b, false
}

// resolveGitBranches resolves git branches for a set of cwds using a per-entry TTL cache.
// Prefers reading .git/HEAD directly; falls back to git subprocess. A detached
// HEAD within gitBranchDetachedGraceTTL of the cwd's last genuine positive
// resolution serves that last-known branch (a rebase ends on the branch it
// started on — blanking every PR surface mid-rebase is noise), cached on the
// negative cadence so the real HEAD is re-read promptly once it re-attaches.
func resolveGitBranches(ctx context.Context, cwds []string) map[string]string {
	now := time.Now()
	result := make(map[string]string)
	seen := make(map[string]bool)
	var misses []string
	prior := make(map[string]gitBranchCacheEntry)

	// Check cache for each cwd
	gitBranchCacheMu.RLock()
	for _, cwd := range cwds {
		if cwd == "" || seen[cwd] {
			continue
		}
		seen[cwd] = true
		if entry, ok := gitBranchCache[cwd]; ok {
			if now.Before(entry.expiresAt) {
				if entry.branch != "" {
					result[cwd] = entry.branch
				}
				continue
			}
			// Expired: keep the old entry's last-good record for the grace check.
			prior[cwd] = entry
		}
		misses = append(misses, cwd)
	}
	gitBranchCacheMu.RUnlock()

	if len(misses) == 0 {
		return result
	}
	if len(misses) > gitBranchResolveLimit {
		misses = misses[:gitBranchResolveLimit]
	}

	// Resolve misses
	updates := make(map[string]gitBranchCacheEntry, len(misses))
	for _, cwd := range misses {
		if ctx.Err() != nil {
			break
		}
		branch, detached, ok := resolveGitBranchFromHead(cwd)
		if !ok && !detached {
			// The HEAD shape is authoritative for detached — the subprocess
			// fallback runs only for the shapes the direct read couldn't parse.
			branch, detached = resolveGitBranchWithGit(ctx, cwd)
		}
		p := prior[cwd]
		var entry gitBranchCacheEntry
		switch {
		case branch != "":
			entry = gitBranchCacheEntry{branch: branch, expiresAt: now.Add(gitBranchPositiveTTL), lastGood: branch, lastGoodAt: now}
			result[cwd] = branch
		case detached && p.lastGood != "" && now.Sub(p.lastGoodAt) < gitBranchDetachedGraceTTL:
			// Grace serve: bridge the rebase with the last-known branch. lastGoodAt
			// is NOT re-stamped — the grace window is measured from the last real
			// ref, so a checkout parked detached exhausts it.
			entry = gitBranchCacheEntry{branch: p.lastGood, expiresAt: now.Add(gitBranchNegativeTTL), lastGood: p.lastGood, lastGoodAt: p.lastGoodAt}
			result[cwd] = p.lastGood
		default:
			// Genuine negative (no repo, unparseable, or grace exhausted). The
			// last-good record is carried so a detached cwd that expires and later
			// re-attaches restarts its grace from the next real ref, not from
			// stale history.
			entry = gitBranchCacheEntry{expiresAt: now.Add(gitBranchNegativeTTL), lastGood: p.lastGood, lastGoodAt: p.lastGoodAt}
		}
		updates[cwd] = entry
	}

	gitBranchCacheMu.Lock()
	for cwd, entry := range updates {
		gitBranchCache[cwd] = entry
	}
	gitBranchCacheMu.Unlock()

	return result
}

// agentStatePrecedence ranks the three agent states for the window-level rollup:
// waiting > active > idle. A higher number wins. An unknown/empty state ranks 0
// (contributes nothing). waiting is the attention state, so it must win the
// rollup — a split window with one waiting pane is a waiting window.
func agentStatePrecedence(state string) int {
	switch state {
	case tmux.AgentStateWaiting:
		return 3
	case tmux.AgentStateActive:
		return 2
	case tmux.AgentStateIdle:
		return 1
	default:
		return 0
	}
}

// FormatAgentDuration formats an elapsed-seconds value in the Ns/Nm/Nh style
// fab produced (floor division), so the frontend duration surface is
// byte-compatible with the previous fab-formatted string. A non-positive
// elapsed yields "".
func FormatAgentDuration(elapsedSeconds int64) string {
	if elapsedSeconds <= 0 {
		return ""
	}
	switch {
	case elapsedSeconds < 60:
		return fmt.Sprintf("%ds", elapsedSeconds)
	case elapsedSeconds < 3600:
		return fmt.Sprintf("%dm", elapsedSeconds/60)
	default:
		return fmt.Sprintf("%dh", elapsedSeconds/3600)
	}
}

// rollupAgentState derives the window-level agent state and idle/waiting
// duration from the window's panes (post-reconciler), applying the
// waiting > active > idle precedence. The duration is computed rk-side from the
// winning pane's AgentStateEpoch for idle AND waiting (empty for active/unknown).
// Pure function (no I/O) so the rollup is unit-testable, mirroring the
// parseWindows/parsePanes/applyActiveWindow split.
func rollupAgentState(panes []tmux.PaneInfo, nowUnix int64) (state string, duration string) {
	best := -1
	var bestEpoch int64
	for _, p := range panes {
		if p.AgentState == "" {
			continue
		}
		rank := agentStatePrecedence(p.AgentState)
		// Deterministic tie-break: at the same precedence (e.g. two waiting
		// panes), prefer the pane with the newest AgentStateEpoch so the
		// window duration reflects the most-recently-updated pane rather than
		// an arbitrary older one (which would inflate the shown waiting/idle
		// duration). A strictly-higher rank always wins outright.
		if rank > best || (rank == best && p.AgentStateEpoch > bestEpoch) {
			best = rank
			state = p.AgentState
			bestEpoch = p.AgentStateEpoch
		}
	}
	if state == "" {
		return "", ""
	}
	// Duration is meaningful for idle and waiting (how long the human has been
	// the blocker / how long at rest); active has no duration.
	if (state == tmux.AgentStateIdle || state == tmux.AgentStateWaiting) && bestEpoch > 0 {
		duration = FormatAgentDuration(nowUnix - bestEpoch)
	}
	return state, duration
}

// ResolveChatPane derives the window-level chat identity AND the resolved pane
// id from the window's panes (post-reconciler): the ACTIVE pane's chat if it
// carries one, else the FIRST pane (in tmux pane order) that carries one.
// Deterministic — the common case is a single agent pane per window; the
// multi-pane rule can be revisited without a backend contract break since
// per-pane truth also ships on PaneInfo.ChatProvider/ChatSessionRef. Returns
// ("", "", "") when no pane carries a chat. Pure function (no I/O).
//
// The paneID is what agent-send injects into — a WINDOW target routes to the
// active pane, which in a split may not be the chat pane, so the resolved pane
// (not the window) is the correct injection target. This is the single source of
// the active-pane-first rollup rule; rollupChat delegates to it.
func ResolveChatPane(panes []tmux.PaneInfo) (provider, ref, paneID string) {
	for _, p := range panes {
		if p.IsActive && p.ChatProvider != "" {
			return p.ChatProvider, p.ChatSessionRef, p.PaneID
		}
	}
	for _, p := range panes {
		if p.ChatProvider != "" {
			return p.ChatProvider, p.ChatSessionRef, p.PaneID
		}
	}
	return "", "", ""
}

// rollupChat derives the window-level chat identity from the window's panes,
// discarding the resolved pane id (the SSE/read path rolls up to the window and
// re-resolves the pane server-side per request). Delegates to ResolveChatPane so
// the active-pane-first rule lives in exactly one place.
func rollupChat(panes []tmux.PaneInfo) (provider, ref string) {
	provider, ref, _ = ResolveChatPane(panes)
	return provider, ref
}

// rollupAltScreen derives the window-level alt-screen flag from the ACTIVE
// pane — the same active-pane rule CaptureWindowHistoryCtx targets: an
// alt-screen active pane means tmux holds no scrollback for the window's
// capture, so the export menu gates its server-capture row on this. False for
// a zero-pane window (never lies toward true).
func rollupAltScreen(panes []tmux.PaneInfo) bool {
	for _, p := range panes {
		if p.IsActive {
			return p.AltScreen
		}
	}
	return false
}

// deriveGitRoot resolves the window's git toplevel for the code lens/surface
// (docs/specs/right-panel.md): the ACTIVE pane's cwd, else the first pane's
// cwd, else the window's worktree path — the same precedence as api/riff.go's
// windowCwd (duplicated here because api imports this package, not vice
// versa) — walked up via config.FindGitRoot (a pure filesystem stat-walk, no
// subprocess — Constitution I needs no timeout here). Keyed by git ROOT, not
// window id or raw cwd: editor state follows the code, and two windows on one
// worktree deliberately share one editor state. Returns "" when the cwd is
// not inside a git repo.
func deriveGitRoot(w *tmux.WindowInfo) string {
	cwd := w.WorktreePath
	if len(w.Panes) > 0 {
		if first := w.Panes[0].Cwd; first != "" {
			cwd = first
		}
		for _, p := range w.Panes {
			if p.IsActive {
				if p.Cwd != "" {
					cwd = p.Cwd
				}
				break
			}
		}
	}
	if cwd == "" {
		return ""
	}
	return config.FindGitRoot(cwd)
}

// windowBranchRepo returns the (repoDir, branch) to derive a window's PR from:
// the active pane's cwd/branch when the active pane is on a branch, else the
// first pane that has a resolved branch. A window is the UI unit that carries a
// single PrURL, and the active pane is its canonical representative. Returns
// ("", "") when no pane has a resolved branch.
func windowBranchRepo(w *tmux.WindowInfo) (repoDir, branch string) {
	// Prefer the active pane.
	for i := range w.Panes {
		if w.Panes[i].IsActive && w.Panes[i].GitBranch != "" {
			return w.Panes[i].Cwd, w.Panes[i].GitBranch
		}
	}
	// Fall back to the first pane with a branch.
	for i := range w.Panes {
		if w.Panes[i].GitBranch != "" {
			return w.Panes[i].Cwd, w.Panes[i].GitBranch
		}
	}
	return "", ""
}

// windowPRKey is the (repoDir, branch) pair enrichWindowPR registers and joins
// on. It keys on the GIT ROOT of the branch-supplying pane, not its raw cwd: a
// pane cd-ing between subdirectories of one worktree must keep hitting the same
// (repoDir, branch) entry, or every cd blanks the PR fields until the refresher
// resolves a brand-new pair. The root is resolved from the SAME pane that
// supplied the branch (not w.GitRoot, which follows the active pane) so the two
// halves of the key always describe one repo. FindGitRoot is a pure stat-walk —
// no subprocess, hot-path safe. A cwd outside any repo falls back to the raw
// cwd key; no branch yields ("", "").
func windowPRKey(w *tmux.WindowInfo) (repoDir, branch string) {
	repoDir, branch = windowBranchRepo(w)
	if branch == "" || repoDir == "" {
		// A branch with no cwd carries no joinable identity — and FindGitRoot("")
		// would stat a relative ".git" against the server's own working directory.
		return "", ""
	}
	if root := config.FindGitRoot(repoDir); root != "" {
		repoDir = root
	}
	return repoDir, branch
}

// enrichWindowPR populates the window's PrURL/PrNumber (and a fallback PrState)
// from its branch (Constitution §X — PR links are derivable, not pushed):
// any pane on a branch with a PR (open, merged, or closed) gets its link, in
// any repo, under any workflow.
//
// CRITICAL — this runs on the SSE hot path (FetchSessions), so it does ZERO
// network/subprocess work: it (a) REGISTERS the (repoDir, branch) pair with the
// prstatus background refresher — a cheap, lock-guarded set touch — and (b)
// JOINS the last-good derived PR from the refresher's in-memory snapshot. The
// actual `gh pr list` resolution happens off-tick on the refresher goroutine
// (see internal/prstatus.BranchRefresher). A window with no branch is skipped; a
// branch not yet resolved, with no PR, or gh absent leaves the fields nil.
//
// PrState is seeded as a FALLBACK from the branch-derived state so that the
// authoritative viewer-wide collector (sse.attachPRStatus, keyed by PR URL) can
// override it on a hit but a MISS does not strand PrState empty. Without this, a
// branch-derived CLOSED PR outside the viewer's top-$limit collector window
// would carry prNumber set + prState "" and the frontend's prOwnsDot would paint
// a solid done-square for a dead PR. MapBranchState maps unknown/empty to "" so
// an unconfident state never defaults to "open" and re-creates that bug.
//
// PrIsDraft is seeded the same way and for a sharper reason: the viewer-wide
// collector queries `viewer { pullRequests }`, so it only ever sees the
// AUTHENTICATED USER'S OWN PRs. A draft opened by a teammate is resolved by this
// branch channel (author-agnostic) but MISSES the URL join, so without this seed
// its prIsDraft stays false and the row glyph renders as a non-draft. The
// collector still overrides on a hit, and since it polls at 90s against this
// channel's 30s it can serve a briefly stale flag — accepted, and exactly how
// PrState already behaves.
func enrichWindowPR(w *tmux.WindowInfo) {
	repoDir, branch := windowPRKey(w)
	if branch == "" {
		return
	}
	// Report the pair so the background refresher resolves it (cheap; no exec).
	prstatus.Register(repoDir, branch)
	// Join the last-good result from the in-memory snapshot (no exec).
	if pr, ok := prstatus.SnapshotBranchPR(repoDir, branch); ok {
		url := pr.URL
		num := pr.Number
		w.PrURL = &url
		w.PrNumber = &num
		w.PrState = prstatus.MapBranchState(pr.State)
		w.PrIsDraft = pr.IsDraft
	}
}

// sessionData pairs a session's tmux info with its fresh window snapshot. It is
// the unit FetchSessions fans out per session and the input to the per-window
// enrichment passes (fab state, git branch, rollups).
type sessionData struct {
	info    tmux.SessionInfo
	windows []tmux.WindowInfo
}

// FetchSessions fetches all sessions from the specified server, derives project
// roots from tmux, enriches with fab state, and applies the two-tier
// active-window derivation. The provider supplies the event-tracked active
// window per group (Tier 1); when it is nil or has no entry for a session's
// group, the base-session `#{window_active}` pointer parsed from tmux (Tier 2)
// stands. A nil provider therefore degrades to exactly today's behavior.
func FetchSessions(ctx context.Context, server string, provider ActiveWindowProvider) ([]ProjectSession, error) {
	sessionInfos, err := tmux.ListSessions(ctx, server)
	if err != nil {
		return nil, err
	}

	if len(sessionInfos) == 0 {
		return []ProjectSession{}, nil
	}

	// Attached-viewer tier: one list-clients round-trip per fetch (same cost
	// class as the enumeration calls), folded onto sessions by group key. A
	// failure degrades to no viewers (log-and-continue) — the fetch itself
	// never fails on it.
	clients, err := tmux.ListClients(ctx, server)
	if err != nil {
		slog.Warn("list-clients failed; sessions carry no viewers", "server", server, "error", err)
	}
	viewers := foldViewers(clients)

	// Fetch windows for all sessions in parallel.
	data := make([]sessionData, len(sessionInfos))
	var wg sync.WaitGroup

	for i, info := range sessionInfos {
		wg.Add(1)
		go func(idx int, si tmux.SessionInfo) {
			defer wg.Done()
			windows, _ := tmux.ListWindows(ctx, si.Name, server)
			if windows == nil {
				windows = []tmux.WindowInfo{}
			}
			data[idx] = sessionData{info: si, windows: windows}
		}(i, info)
	}
	wg.Wait()

	// Collect all pane cwds for git branch resolution.
	var allCwds []string
	for _, sd := range data {
		for _, w := range sd.windows {
			for _, p := range w.Panes {
				allCwds = append(allCwds, p.Cwd)
			}
		}
	}
	gitBranches := resolveGitBranches(ctx, allCwds)
	cwdMissing := resolveCwdMissing(allCwds)

	// The fab tier is derived natively from disk (cwd → .fab-status.yaml →
	// .status.yaml — see fabstate.go), fresh on every call: no subprocess, no
	// cross-request cache, so a stage transition repaints on the next fetch.
	// The memo dedupes reads within this one call (many panes share a worktree).
	fabMemo := newFabStateMemo()

	// Build result with per-window fab enrichment and git branches.
	nowUnix := time.Now().Unix()
	result := make([]ProjectSession, len(data))
	for i, sd := range data {
		for j := range sd.windows {
			// Fab tier proper (change/stage/displayState) from the native
			// per-pane derivation, rolled up to the window (change-bound pane
			// wins, else the first pane carrying one).
			fab := fabMemo.windowState(sd.windows[j].Panes)
			sd.windows[j].FabChange = fab.change
			sd.windows[j].FabStage = fab.stage
			sd.windows[j].FabDisplayState = fab.displayState
			for k := range sd.windows[j].Panes {
				cwd := sd.windows[j].Panes[k].Cwd
				if branch, ok := gitBranches[cwd]; ok {
					sd.windows[j].Panes[k].GitBranch = branch
				}
				if cwdMissing[cwd] {
					sd.windows[j].Panes[k].CwdMissing = true
				}
			}
			// Generic agent-state tier (260705-dmex): window-level rollup over
			// the panes' @rk_agent_state (waiting > active > idle), with the
			// idle/waiting duration computed rk-side from the epoch.
			sd.windows[j].AgentState, sd.windows[j].AgentIdleDuration = rollupAgentState(sd.windows[j].Panes, nowUnix)
			// Chat identity tier (260713-nh86): window-level rollup over the
			// panes' reconciled @rk_chat (active pane first, else first set). Per-
			// pane truth is preserved on the Panes entries; both ride the existing
			// ProjectSession marshal to GET /api/sessions and SSE event: sessions.
			sd.windows[j].ChatProvider, sd.windows[j].ChatSessionRef = rollupChat(sd.windows[j].Panes)
			// Alt-screen tier (260820-4le0): the ACTIVE pane's alternate_on,
			// rolled up to the window so the export menu's server-capture row
			// can be honest about panes where tmux holds no scrollback.
			sd.windows[j].AltScreen = rollupAltScreen(sd.windows[j].Panes)
			// Code-lens availability tier (260811-k3vp): the window's git root,
			// derived from its active pane's cwd (Constitution II/X — nothing
			// stored, nothing pushed). Empty when the cwd is not a repo.
			sd.windows[j].GitRoot = deriveGitRoot(&sd.windows[j])
			// PR-from-branch derivation (260705-dmex): register the window's
			// branch with the prstatus refresher and join its last-good PR from
			// the in-memory snapshot — no subprocess on this hot path.
			enrichWindowPR(&sd.windows[j])
		}

		// Two-tier active-window derivation. The user-facing session name IS
		// the session-group key (parseSessions keeps the leader whose name ==
		// #{session_group}, or an ungrouped session keyed by its own name —
		// matching parseSessionGroups/parseActiveWindowsByGroup). Tier 1: if
		// the provider reports a tracked @wid for this group, it overrides the
		// base-pointer flag (authoritative). Tier 2: otherwise the parsed
		// #{window_active} flag stands. A nil provider is a no-op (Tier 2).
		if provider != nil {
			if trackedWid, ok := provider.ActiveWindow(server, sd.info.Name); ok {
				applyActiveWindow(sd.windows, trackedWid)
			}
		}

		result[i] = ProjectSession{Name: sd.info.Name, SessionColor: sd.info.Color, SessionID: sd.info.ID, SessionPath: sd.info.Path, Flair: sd.info.Flair, Windows: sd.windows, Hidden: operatorSessionHidden(sd.info.Name, sd.windows), Viewers: viewers[sd.info.Name]}
	}

	return result, nil
}

// ProjectRoot derives the project root from the target window identified by its
// stable window ID. It resolves the owning session from the window ID, then
// returns that window's worktree path. Falls back to the session's first window
// when the ID is not found among the enumerated windows.
func ProjectRoot(ctx context.Context, windowID, server string) (string, error) {
	session, err := tmux.ResolveWindowSession(ctx, server, windowID)
	if err != nil {
		return "", err
	}

	windows, err := tmux.ListWindows(ctx, session, server)
	if err != nil {
		return "", err
	}
	if len(windows) == 0 {
		return "", nil
	}

	for _, w := range windows {
		if w.WindowID == windowID {
			return w.WorktreePath, nil
		}
	}
	// Fall back to first window
	return windows[0].WorktreePath, nil
}
