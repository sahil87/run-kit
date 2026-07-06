package prstatus

import (
	"context"
	"encoding/json"
	"os/exec"
	"sync"
	"time"
)

// Branch→PR derivation (260705-dmex-generic-agent-state-tier).
//
// This is a distinct capability from the viewer-wide collector above: given a
// pane's repo directory and branch, it resolves the OPEN PR whose head is that
// branch via `gh pr list --head <branch>` run in the repo. run-kit derives
// PrURL/PrNumber this way for ANY pane on a branch with an open PR — not only
// fab-change-bound windows — replacing the pane-map join as the PR-link source
// (Constitution §X: PR links are derivable, not pushed). The viewer-wide
// URL-keyed collector still supplies the live state/checks/review join, keyed by
// the derived URL.
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

	// branchPRMergedGrace is the D2 grace window (status-pyramid.md § Open
	// Decisions — D2). The branch lookup is `--state open`, so the moment a PR
	// merges (or closes) it drops out of the query and would otherwise vanish
	// from the window instantly — losing the purple/orange DONE-square terminal
	// state (the whole point of the merged shape). To retain it, when the query
	// returns "no open PR" for a pair that PREVIOUSLY resolved to a PR, keep the
	// last-known derived PR for this grace window instead of clearing to a
	// negative. During the grace the viewer-wide collector (which DOES query
	// MERGED/CLOSED) supplies the merged state via the URL join, so the dot shows
	// the done-square; a closed-unmerged PR's fall-back to the live fab tier is
	// handled frontend-side (statusDotState drops PR ownership for prState ==
	// "closed"). After the grace the entry becomes a true negative and the pane
	// falls through to its fab/floor tier. Sized generously so a just-merged PR
	// stays visible long enough to register, but bounded so a stale mapping never
	// lingers indefinitely (Constitution II — no durable state).
	branchPRMergedGrace = 10 * time.Minute
)

// BranchPR is the derived open PR for a (repo, branch) pair. It carries only the
// fields needed to populate WindowInfo.PrURL/PrNumber and to key the live-status
// join; the richer state/checks/review come from the viewer-wide collector.
// (State/IsDraft were trimmed at rework cycle 1 — no consumer ever read them,
// and they were dropped from the `--json` field list too.)
type BranchPR struct {
	Number int    `json:"number"`
	URL    string `json:"url"`
	// UpdatedAt is used only to pick the most-recently-updated PR when a branch
	// has more than one open PR; it is not surfaced further.
	UpdatedAt time.Time `json:"updatedAt"`
}

// branchPRExec runs `gh pr list --head <branch>` in repoDir and returns its raw
// stdout. It is a package var so tests can stub gh without a real binary
// (mirroring the ghExec seam on Collector). The default uses exec.CommandContext
// with a timeout and an explicit argv slice.
var branchPRExec = func(ctx context.Context, repoDir, branch string) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(queryCtx, "gh", "pr", "list",
		"--head", branch,
		"--state", "open",
		"--json", "number,url,updatedAt",
	)
	cmd.Dir = repoDir
	return cmd.Output()
}

// branchPRAvailable reports whether gh is installed and authenticated. A package
// var so tests can force it; defaults to the same ghAvailable guard the
// viewer-wide collector uses.
var branchPRAvailable = ghAvailable

// branchEntry is a cached derivation for one (repo, branch) pair. observedAt is
// bumped on every Register so the refresher can age out pairs no window reports
// anymore; pr is the last-good result (nil == either not-yet-resolved OR a
// confirmed "no open PR" past the grace window — both serve nothing from
// Snapshot, which is the only distinction the join cares about).
//
// wentNegativeAt is the D2 grace-window clock: when a pair that PREVIOUSLY
// resolved to a PR next resolves to "no open PR" (the PR merged/closed and
// dropped from the `--state open` query), the refresher does NOT clear `pr`
// immediately — it stamps `wentNegativeAt` and keeps serving the last-known PR
// until `branchPRMergedGrace` elapses, so the merged done-square survives the
// open-only lookup (status-pyramid.md D2). Zero when the entry is positive
// (open PR still resolving) or has never resolved.
type branchEntry struct {
	pr             *BranchPR // last-known PR (served during the D2 grace even after it left `--state open`)
	observedAt     time.Time // last Register time — drives age-out
	wentNegativeAt time.Time // when a previously-positive entry first resolved negative (D2 grace clock)
}

// BranchRefresher resolves registered (repo, branch) pairs → open PR on a
// background tick and serves the result from an in-memory snapshot. The sessions
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

	// exec runs the branch-list gh query; available reports gh installed+
	// authenticated. Both are fields so tests can stub them per instance
	// (matching the ghExec/available seams on Collector). They default to the
	// package-var seams.
	exec      func(ctx context.Context, repoDir, branch string) ([]byte, error)
	available func(ctx context.Context) bool

	// now is a clock seam for tests (defaults to time.Now).
	now func() time.Time
}

// NewBranchRefresher creates a branch→PR refresher that re-resolves every
// registered pair on the given interval. Call Start to begin the background
// goroutine.
func NewBranchRefresher(interval time.Duration) *BranchRefresher {
	return &BranchRefresher{
		entries:   make(map[string]branchEntry),
		interval:  interval,
		exec:      branchPRExec,
		available: branchPRAvailable,
		now:       time.Now,
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
// returns (pr, true) only when the refresher has resolved the pair to an open PR;
// (nil, false) for an unregistered pair, an as-yet-unresolved pair, or a resolved
// negative ("no open PR") entry.
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
//   - a parsed open PR → the positive entry
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
		out, err := r.exec(ctx, p.repoDir, p.branch)
		if err != nil {
			// Transient exec/network error: keep last-good (stale-while-
			// revalidate). Do NOT downgrade a good entry to a negative.
			continue
		}
		pr, parseErr := pickBranchPR(out) // nil,nil == confirmed no open PR (valid negative)
		if parseErr != nil {
			// Partial/malformed gh output (broken JSON): treat like a transient
			// error and keep last-good rather than clearing a previously-good PR
			// mapping. Only a successfully parsed result updates the entry.
			continue
		}
		r.mu.Lock()
		if e, ok := r.entries[p.key]; ok { // may have aged out concurrently
			if pr != nil {
				// Positive: an open PR resolved — update and clear any grace clock.
				e.pr = pr
				e.wentNegativeAt = time.Time{}
			} else if e.pr != nil {
				// D2 grace: the PR left `--state open` (merged/closed) but this
				// pair previously resolved to one. Retain the last-known PR until
				// the grace window elapses, so the done-square survives; then
				// clear to a true negative and let the pane fall through to fab.
				if e.wentNegativeAt.IsZero() {
					e.wentNegativeAt = now
				} else if now.Sub(e.wentNegativeAt) > branchPRMergedGrace {
					e.pr = nil
					e.wentNegativeAt = time.Time{}
				}
			}
			// (pr == nil && e.pr == nil): a still-unresolved negative — nothing
			// to retain, leave as-is.
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

// pickBranchPR parses a `gh pr list --json ...` array and returns the
// most-recently-updated open PR, or nil when the array is empty or every node
// has an empty URL (malformed/partial JSON — a URL-less PR can never key the
// live-status join). A JSON parse error is surfaced via the returned error so
// refresh can keep the last-good entry (stale-while-revalidate) rather than
// downgrading a good mapping to a negative on transient/partial gh output; a
// successfully parsed empty array is a valid negative (nil pr, nil err).
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
		if best < 0 || prs[i].UpdatedAt.After(prs[best].UpdatedAt) {
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
