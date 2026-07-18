package prstatus

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Branch→PR derivation (260705-dmex-generic-agent-state-tier).
//
// This is a distinct capability from the viewer-wide collector above: given a
// pane's repo directory and branch, it resolves the PR whose head is that branch
// via `gh pr list --head <branch> --state all` run in the repo, picking by
// precedence (open > merged > closed — pickBranchPR). run-kit derives
// PrURL/PrNumber this way for ANY pane on a branch with a PR — not only
// fab-change-bound windows — replacing the pane-map join as the PR-link source
// (Constitution §X: PR links are derivable, not pushed). The viewer-wide
// URL-keyed collector still supplies the live state/checks/review join, keyed by
// the derived URL.
//
// Querying ALL states (not just open) is what makes a merged PR's purple/orange
// done-square DURABLE and RESTART-PROOF: the PR keeps resolving positive after it
// merges, derived freshly from gh each pass, so there is no in-memory grace clock
// to expire or to be wiped by an rk restart (status-pyramid.md § Open Decisions
// D2, revised — the earlier `--state open` + 10-min grace decayed the merged
// square into a green fab square minutes after merge).
//
// CRITICAL — no network on the SSE hot path. Resolution runs on a BACKGROUND
// refresher (mirroring Collector.Start's tick discipline), NOT inline in
// FetchSessions. The sessions enrichment loop only (a) REGISTERS the observed
// (repoDir, branch) pairs — a cheap, lock-guarded set insert — and (b) JOINS the
// derived PR from an in-memory snapshot. All gh subprocesses live on the
// refresher goroutine, so the 2.5s SSE poll never spawns a process. This
// preserves api/sse.go's documented zero-network-call hot-path invariant and
// code-review.md's 5s API cap.
//
// All subprocess execution uses exec.CommandContext with an explicit argv slice
// and a timeout; no shell string, no user input in argv beyond the branch name,
// which is passed as a discrete arg (Constitution §I).

const (
	// branchPRRefreshInterval is the background refresher's tick cadence: how
	// often it re-resolves every registered (repo, branch) pair. Faster than the
	// viewer-wide collector's 90s tick because a per-branch `gh pr list` is much
	// cheaper than the full graphql fetch and PR-link freshness (a newly opened
	// PR appearing on a window) wants to be reasonably prompt — but still slow
	// enough that gh traffic is bounded and decoupled from the 2.5s SSE cadence.
	branchPRRefreshInterval = 30 * time.Second

	// branchPRObservedTTL bounds how long a registered pair stays live without
	// being re-observed. A pane whose window closed (or moved off the branch)
	// stops being registered; after this TTL its entry ages out of the refresher
	// so it neither costs a gh call nor lingers in the snapshot. Sized to a
	// small multiple of the refresh interval so a transiently-unobserved pair
	// (one missed SSE tick) is not evicted mid-flight.
	branchPRObservedTTL = 5 * time.Minute

	// branchPRAvailabilityTTL bounds how long a gh-availability verdict (positive
	// OR negative) is reused. The negative MUST be cached: an installed-but-
	// unauthenticated gh would otherwise re-run `gh auth status` for every pass,
	// forever. One availability probe per pass at most, and skipped entirely
	// while a fresh verdict stands.
	branchPRAvailabilityTTL = 60 * time.Second

	// branchDefaultBranchTTL bounds how long a per-repo default-branch verdict
	// (the resolved name OR a fail-open lookup failure) is reused. A default
	// branch essentially never changes, so a minutes-range TTL keeps each repo to
	// at most one `git symbolic-ref` per window regardless of how many pairs it
	// has — never one per pair per pass. Sized like branchPRObservedTTL (minutes
	// scale, comfortably longer than the 30s refresh tick).
	branchDefaultBranchTTL = 5 * time.Minute
)

// BranchPR is the derived PR for a (repo, branch) pair. It carries only the
// fields needed to populate WindowInfo.PrURL/PrNumber, to rank candidates by
// precedence, and to key the live-status join; the richer checks/review come
// from the viewer-wide collector.
type BranchPR struct {
	Number int    `json:"number"`
	URL    string `json:"url"`
	// State is GitHub's PR state — OPEN | MERGED | CLOSED (the `gh pr list --json
	// state` enum). It drives pickBranchPR's precedence ranking (open > merged >
	// closed); it is compared case-insensitively and not surfaced further (the
	// viewer-wide collector supplies the displayed prState via the URL join).
	State string `json:"state"`
	// UpdatedAt breaks ties WITHIN a state class — the most-recently-updated PR of
	// the winning class is chosen; it is not surfaced further.
	UpdatedAt time.Time `json:"updatedAt"`
}

// branchPRExec runs `gh pr list --head <branch> --state all` in repoDir and
// returns its raw stdout. It is a package var so tests can stub gh without a real
// binary (mirroring the ghExec seam on Collector). The default uses
// exec.CommandContext with a timeout and an explicit argv slice.
//
// The query is `--state all` (NOT `--state open`): a merged PR must keep being
// derived so its purple/orange DONE-square survives statelessly, restart-proof —
// there is no grace clock to remember it (status-pyramid.md D2, revised). The
// `state` field is requested so pickBranchPR can rank by precedence
// (open > merged > closed). An explicit `--limit 100` overrides gh's default of
// 30, which `--state all` could otherwise exceed on a much-reused head and
// truncate the winning PR out of the result page.
var branchPRExec = func(ctx context.Context, repoDir, branch string) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(queryCtx, "gh", "pr", "list",
		"--head", branch,
		"--state", "all",
		// gh pr list defaults to 30 results; under --state all a branch's full
		// history (open + every prior merged/closed PR on the same head) can
		// exceed that and truncate the winning PR out of the page. A generous
		// explicit cap keeps pickBranchPR's precedence ranking correct without
		// unbounded output — a single head realistically never has this many PRs.
		"--limit", "100",
		"--json", "number,url,state,updatedAt",
	)
	cmd.Dir = repoDir
	return cmd.Output()
}

// branchPRAvailable reports whether gh is installed and authenticated. A package
// var so tests can force it; defaults to the same ghAvailable guard the
// viewer-wide collector uses.
var branchPRAvailable = ghAvailable

// defaultBranchRef is the local symbolic ref that names a repo's default branch,
// and defaultBranchRefPrefix is the part stripped from a resolved
// `git symbolic-ref` value to yield the bare branch name (e.g.
// `refs/remotes/origin/main` → `main`).
const (
	defaultBranchRef       = "refs/remotes/origin/HEAD"
	defaultBranchRefPrefix = "refs/remotes/origin/"
)

// branchDefaultExec resolves a repo's default branch LOCALLY (no network) via
// `git symbolic-ref refs/remotes/origin/HEAD` run in repoDir, returning its raw
// stdout (e.g. `refs/remotes/origin/main\n`). It is a package var so tests can
// stub git without a real repo, mirroring the branchPRExec seam. The default
// uses exec.CommandContext with a timeout and an explicit argv slice; repoDir is
// set as cmd.Dir, never interpolated — no user input in argv (Constitution §I).
// The symbolic-ref read touches only a local ref file, so it never hits the
// network. An unset/missing ref makes git exit non-zero, which surfaces here as
// an error → the caller fails open.
var branchDefaultExec = func(ctx context.Context, repoDir string) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(queryCtx, "git", "symbolic-ref", defaultBranchRef)
	cmd.Dir = repoDir
	return cmd.Output()
}

// parseDefaultBranch extracts the bare default-branch name from
// `git symbolic-ref refs/remotes/origin/HEAD` output. It strips the
// `refs/remotes/origin/` prefix and any surrounding whitespace (the trailing
// newline git emits). It reports ok=false for output that does not carry the
// expected prefix or that yields an empty name — treated by the caller as a
// lookup failure (fail-open).
func parseDefaultBranch(out []byte) (string, bool) {
	ref := strings.TrimSpace(string(out))
	if !strings.HasPrefix(ref, defaultBranchRefPrefix) {
		return "", false
	}
	name := strings.TrimSpace(strings.TrimPrefix(ref, defaultBranchRefPrefix))
	if name == "" {
		return "", false
	}
	return name, true
}

// branchEntry is a cached derivation for one (repo, branch) pair. observedAt is
// bumped on every Register so the refresher can age out pairs no window reports
// anymore; pr is the last-good result (nil == either not-yet-resolved OR a
// confirmed "no PR" — both serve nothing from Snapshot, which is the only
// distinction the join cares about).
//
// Because the branch query is `--state all`, a merged PR keeps resolving to a
// positive result on every pass — its done-square is durable STATELESSLY, so
// there is no grace clock to remember it across the merge boundary or across an
// rk restart (status-pyramid.md D2, revised).
type branchEntry struct {
	pr         *BranchPR // last-known PR
	observedAt time.Time // last Register time — drives age-out
}

// defaultBranchEntry is a per-repo cached default-branch verdict. It caches BOTH
// a successful resolution (name set, ok=true) AND a lookup failure (name "",
// ok=false → the caller fails open), each with a taken-at timestamp, so a repo
// costs at most one `git symbolic-ref` per branchDefaultBranchTTL window — never
// one per pair per pass. Mirrors the availValid/availAt gh-availability cache.
type defaultBranchEntry struct {
	name string    // resolved default branch (empty on a cached failure)
	ok   bool      // true when the lookup succeeded; false is a cached fail-open verdict
	at   time.Time // wall-clock time the verdict was taken
}

// BranchRefresher resolves registered (repo, branch) pairs → their PR (any
// state, open > merged > closed by precedence) on a background tick and serves
// the result from an in-memory snapshot. The sessions
// enrichment REGISTERS pairs (cheap) and reads via Snapshot (no exec); the
// refresher goroutine owns all gh subprocesses, keeping the SSE hot path
// network-free.
type BranchRefresher struct {
	mu       sync.RWMutex
	entries  map[string]branchEntry
	interval time.Duration

	// Cached gh-availability verdict (positive AND negative). Guarded by mu.
	// availAt is the wall-clock time the verdict was taken; a verdict older than
	// branchPRAvailabilityTTL is re-probed on the next pass (at most once/pass).
	availValid bool
	availAt    time.Time

	// Per-repo default-branch cache (keyed by repoDir), guarded by mu. Caches
	// both a resolved name and a fail-open failure verdict, each with a taken-at
	// timestamp; a verdict older than branchDefaultBranchTTL is re-probed. This
	// is what keeps a repo to one `git symbolic-ref` per TTL window regardless of
	// how many pairs it registers.
	defaultBranches map[string]defaultBranchEntry

	// exec runs the branch-list gh query; available reports gh installed+
	// authenticated; defaultExec resolves a repo's default branch via git
	// symbolic-ref. All are fields so tests can stub them per instance (matching
	// the ghExec/available seams on Collector). They default to the package-var
	// seams.
	exec        func(ctx context.Context, repoDir, branch string) ([]byte, error)
	available   func(ctx context.Context) bool
	defaultExec func(ctx context.Context, repoDir string) ([]byte, error)

	// now is a clock seam for tests (defaults to time.Now).
	now func() time.Time
}

// NewBranchRefresher creates a branch→PR refresher that re-resolves every
// registered pair on the given interval. Call Start to begin the background
// goroutine.
func NewBranchRefresher(interval time.Duration) *BranchRefresher {
	return &BranchRefresher{
		entries:         make(map[string]branchEntry),
		defaultBranches: make(map[string]defaultBranchEntry),
		interval:        interval,
		exec:            branchPRExec,
		available:       branchPRAvailable,
		defaultExec:     branchDefaultExec,
		now:             time.Now,
	}
}

// DefaultBranchRefresher is the process-wide refresher instance. router.go
// Start()s it next to the viewer-wide collector; internal/sessions registers
// observed pairs and joins from its snapshot via the package-level Register /
// SnapshotBranchPR helpers. A single shared instance keeps FetchSessions'
// signature unchanged (no per-call refresher plumbing) while the resolution work
// still lives entirely off the hot path.
var DefaultBranchRefresher = NewBranchRefresher(branchPRRefreshInterval)

// branchPRCacheKey builds the (repoDir, branch) cache key. A NUL separator
// avoids any collision between a repo path and a branch name.
func branchPRCacheKey(repoDir, branch string) string {
	return repoDir + "\x00" + branch
}

// Register records that a (repoDir, branch) pair is currently observed by a live
// window. It is a cheap lock-guarded set touch — NO subprocess, NO network — so
// it is safe on the SSE hot path. The background refresher resolves registered
// pairs; unobserved pairs age out (branchPRObservedTTL). Empty inputs are
// ignored.
func (r *BranchRefresher) Register(repoDir, branch string) {
	if repoDir == "" || branch == "" {
		return
	}
	key := branchPRCacheKey(repoDir, branch)
	now := r.now()
	r.mu.Lock()
	e := r.entries[key] // zero value on first sight (pr=nil, resolved=false)
	e.observedAt = now
	r.entries[key] = e
	r.mu.Unlock()
}

// Snapshot returns the last-good derived PR for a (repoDir, branch) pair from the
// in-memory cache. It NEVER runs a subprocess — this is the hot-path join. It
// returns (pr, true) only when the refresher has resolved the pair to a PR;
// (nil, false) for an unregistered pair, an as-yet-unresolved pair, or a resolved
// negative ("no PR") entry.
func (r *BranchRefresher) Snapshot(repoDir, branch string) (*BranchPR, bool) {
	if repoDir == "" || branch == "" {
		return nil, false
	}
	key := branchPRCacheKey(repoDir, branch)
	r.mu.RLock()
	e, ok := r.entries[key]
	r.mu.RUnlock()
	if !ok || e.pr == nil {
		return nil, false
	}
	// Return a copy so callers can't mutate the cached value.
	pr := *e.pr
	return &pr, true
}

// RefreshNow triggers an on-demand re-resolve of every registered
// (repo, branch) pair (used by the POST /api/status/refresh endpoint). It
// delegates to the same private refresh the background tick runs, mirroring
// Collector.RefreshNow. Best-effort: errors are swallowed per pair
// (stale-while-revalidate) — a transient gh failure keeps the last-good entry
// rather than downgrading it, exactly as the tick-driven path behaves.
func (r *BranchRefresher) RefreshNow(ctx context.Context) {
	r.refresh(ctx)
}

// Start begins the background refresh goroutine. It runs one refresh
// immediately (so the snapshot warms before the first tick) then ticks on the
// interval, exiting when ctx is cancelled — the same lifecycle as
// metrics.Collector / prstatus.Collector.
func (r *BranchRefresher) Start(ctx context.Context) {
	go func() {
		r.refresh(ctx)
		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.refresh(ctx)
			}
		}
	}()
}

// refresh re-resolves every currently-registered pair and ages out pairs no
// longer observed. It gates on ONE availability check per pass (cached, positive
// and negative — an unauthenticated gh does not re-probe per pair). Resolution
// rules per pair:
//   - transient exec error → KEEP the last-good entry (true stale-while-revalidate;
//     never fail-to-negative)
//   - a parsed empty/no-PR result → a valid NEGATIVE entry (nil pr, resolved)
//   - a parsed PR (open/merged/closed, picked by precedence) → the positive entry
//
// Because the query is `--state all`, a merged PR keeps resolving positive on
// every pass — its done-square is durable STATELESSLY (no grace clock, no
// negative-stamp retention). Only a genuine empty/no-PR result clears the entry.
func (r *BranchRefresher) refresh(ctx context.Context) {
	now := r.now()

	// Age out unobserved pairs and collect the live keys to resolve. Done under
	// the lock; the (cheap) resolution loop below runs the gh calls WITHOUT the
	// lock held so Register/Snapshot never block on a hung gh.
	r.mu.Lock()
	type pending struct {
		key             string
		repoDir, branch string
	}
	var todo []pending
	for key, e := range r.entries {
		if now.Sub(e.observedAt) > branchPRObservedTTL {
			delete(r.entries, key)
			continue
		}
		repoDir, branch := splitBranchPRKey(key)
		todo = append(todo, pending{key: key, repoDir: repoDir, branch: branch})
	}
	r.mu.Unlock()

	if len(todo) == 0 {
		return
	}

	// One availability check per pass (cached verdict — positive AND negative).
	if !r.checkAvailable(ctx, now) {
		return
	}

	for _, p := range todo {
		// Default-branch exclusion: a pane parked on the repo's DEFAULT branch
		// never "has its own PR" — every `gh pr list --head <default>` match is
		// degenerate (a fork PR sharing the name, or an old PR whose head was the
		// default branch). Resolve the repo's default branch locally (cached
		// per-repo; runs `git symbolic-ref` at most once per TTL window) and, when
		// the pair's branch equals it, resolve the entry to an AUTHORITATIVE
		// NEGATIVE without any gh call. Authoritative (not skip/transient) is what
		// CLEARS a stale positive — e.g. a fork-PR match cached before the ref
		// resolved — within one pass. On lookup FAILURE the (name,ok) verdict is
		// ok=false → fall through to the normal gh path (fail-open): a missing
		// local ref must not silently disable the feature repo-wide.
		if defName, ok := r.defaultBranch(ctx, now, p.repoDir); ok && p.branch == defName {
			r.mu.Lock()
			if e, present := r.entries[p.key]; present { // may have aged out concurrently
				e.pr = nil
				r.entries[p.key] = e
			}
			r.mu.Unlock()
			continue
		}

		out, err := r.exec(ctx, p.repoDir, p.branch)
		if err != nil {
			// Transient exec/network error: keep last-good (stale-while-
			// revalidate). Do NOT downgrade a good entry to a negative.
			continue
		}
		pr, parseErr := pickBranchPR(out) // nil,nil == confirmed no PR (valid negative)
		if parseErr != nil {
			// Partial/malformed gh output (broken JSON): treat like a transient
			// error and keep last-good rather than clearing a previously-good PR
			// mapping. Only a successfully parsed result updates the entry.
			continue
		}
		r.mu.Lock()
		if e, ok := r.entries[p.key]; ok { // may have aged out concurrently
			// A successfully parsed result is authoritative: a picked PR (open/
			// merged/closed) is the positive entry; a genuine empty/no-PR result
			// clears to a true negative. No grace retention — `--state all` keeps
			// a merged PR resolving positive, so the done-square is stateless.
			e.pr = pr
			r.entries[p.key] = e
		}
		r.mu.Unlock()
	}
}

// checkAvailable returns the cached gh-availability verdict, re-probing only when
// the cached verdict is older than branchPRAvailabilityTTL. Caches the negative
// result too, so an installed-but-unauthenticated gh probes at most once per TTL,
// never once per registered pair.
func (r *BranchRefresher) checkAvailable(ctx context.Context, now time.Time) bool {
	r.mu.RLock()
	valid := r.availValid
	at := r.availAt
	r.mu.RUnlock()
	if !at.IsZero() && now.Sub(at) < branchPRAvailabilityTTL {
		return valid
	}
	ok := r.available == nil || r.available(ctx)
	r.mu.Lock()
	r.availValid = ok
	r.availAt = now
	r.mu.Unlock()
	return ok
}

// defaultBranch returns the repo's default branch, resolving it via the git
// symbolic-ref seam and caching the verdict per-repo for branchDefaultBranchTTL.
// The bool reports whether the lookup SUCCEEDED — ok=false is a fail-open signal
// (the caller then resolves the pair normally via gh). BOTH outcomes are cached
// (a failure just as much as a success) so a missing local ref does not trigger
// a per-pass `git symbolic-ref` retry storm. It NEVER runs a subprocess when a
// fresh verdict stands. Runs on the refresher goroutine only (off the hot path).
func (r *BranchRefresher) defaultBranch(ctx context.Context, now time.Time, repoDir string) (string, bool) {
	r.mu.RLock()
	e, cached := r.defaultBranches[repoDir]
	r.mu.RUnlock()
	if cached && !e.at.IsZero() && now.Sub(e.at) < branchDefaultBranchTTL {
		return e.name, e.ok
	}

	name, ok := "", false
	if r.defaultExec != nil {
		if out, err := r.defaultExec(ctx, repoDir); err == nil {
			name, ok = parseDefaultBranch(out)
		}
	}

	r.mu.Lock()
	r.defaultBranches[repoDir] = defaultBranchEntry{name: name, ok: ok, at: now}
	r.mu.Unlock()
	return name, ok
}

// splitBranchPRKey inverts branchPRCacheKey.
func splitBranchPRKey(key string) (repoDir, branch string) {
	for i := 0; i < len(key); i++ {
		if key[i] == '\x00' {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

// Register / SnapshotBranchPR are the package-level façade over
// DefaultBranchRefresher used by internal/sessions so it need not hold a
// refresher reference.

// Register records an observed (repoDir, branch) pair on the default refresher.
func Register(repoDir, branch string) {
	DefaultBranchRefresher.Register(repoDir, branch)
}

// SnapshotBranchPR joins the last-good derived PR for a (repoDir, branch) pair
// from the default refresher's in-memory snapshot — no subprocess (hot-path safe).
func SnapshotBranchPR(repoDir, branch string) (*BranchPR, bool) {
	return DefaultBranchRefresher.Snapshot(repoDir, branch)
}

// MapBranchState collapses a branch-derived PR's raw GitHub state enum
// (OPEN|MERGED|CLOSED, case-insensitive) to the frontend display value
// open|merged|closed. Unlike the viewer-wide collector's mapState (which
// defaults unknown/empty to "open"), an unrecognized or empty state maps to ""
// here: a branch fallback with no confident state MUST NOT default to "open",
// or a stateless dead PR would wrongly own the status dot. Used by the sessions
// enrichment to seed WindowInfo.PrState as a fallback when the URL-keyed
// collector join misses (e.g. a closed PR outside the viewer's top-$limit
// window) — without it, prOwnsDot sees prNumber set + prState "" and wrongly
// paints a solid done-square for a dead PR.
func MapBranchState(state string) string {
	switch strings.ToUpper(state) {
	case "OPEN":
		return "open"
	case "MERGED":
		return "merged"
	case "CLOSED":
		return "closed"
	default:
		return ""
	}
}

// branchStateRank maps a GitHub PR state to its precedence rank — LOWER wins.
// Open outranks merged outranks closed (status-pyramid.md D2, revised): an open
// PR always owns the branch (the branch-reuse edge — a reopened branch's live PR
// must beat an older merged one), else the most recent merged PR, else the most
// recent closed PR (still derived for the register/tip; the frontend prOwnsDot
// excludes closed from dot ownership). Comparison is case-insensitive — `gh pr
// list --json state` emits GitHub's uppercase enum (OPEN|MERGED|CLOSED), the same
// values the viewer-wide collector's mapState handles. An unknown/empty state
// sorts last (rank 3) so a future enum value never silently outranks a real one.
func branchStateRank(state string) int {
	switch strings.ToUpper(state) {
	case "OPEN":
		return 0
	case "MERGED":
		return 1
	case "CLOSED":
		return 2
	default:
		return 3
	}
}

// pickBranchPR parses a `gh pr list --json ...` array and returns the winning PR
// by precedence: open > merged > closed (branchStateRank), breaking ties WITHIN a
// state class by most-recently-updated. Nodes with an empty URL are skipped
// (malformed/partial JSON — a URL-less PR can never key the live-status join).
// Returns nil when the array is empty or every node was skipped. A JSON parse
// error is surfaced via the returned error so refresh can keep the last-good
// entry (stale-while-revalidate) rather than downgrading a good mapping to a
// negative on transient/partial gh output; a successfully parsed empty array is a
// valid negative (nil pr, nil err).
func pickBranchPR(out []byte) (*BranchPR, error) {
	var prs []BranchPR
	if err := json.Unmarshal(out, &prs); err != nil {
		return nil, err
	}
	best := -1
	for i := range prs {
		if prs[i].URL == "" {
			continue
		}
		if best < 0 {
			best = i
			continue
		}
		rank, bestRank := branchStateRank(prs[i].State), branchStateRank(prs[best].State)
		switch {
		case rank < bestRank:
			// A higher-precedence state class wins outright.
			best = i
		case rank == bestRank && prs[i].UpdatedAt.After(prs[best].UpdatedAt):
			// Within the same class, most-recently-updated wins.
			best = i
		}
	}
	if best < 0 {
		return nil, nil
	}
	// Return a copy so callers can't mutate the parsed slice's backing array.
	chosen := prs[best]
	return &chosen, nil
}
