package prstatus

import (
	"context"
	"encoding/json"
	"net/url"
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
// Cold start (260807-2ept-pr-status-cold-start). Two mechanisms make the first
// useful pass fast, without touching the 30s steady-state cadence:
//
//   - REGISTRATION WAKE. Start's immediate first refresh is a no-op at process
//     start (no pair is registered until the SSE enrichment loop has run), so the
//     first useful pass used to wait out a whole 30s tick. Register now signals a
//     coalescing wake channel on FIRST-SIGHT pairs only, and Start's loop debounces
//     it (branchPRWakeDebounce) so one SSE pass's burst of registrations triggers
//     ONE refresh — event-driven, ~2.5s after start.
//   - VIEWER HEAD-INDEX. The viewer-wide Collector's single batched GraphQL call
//     already fetches every recent PR the user authored, including each one's head
//     repository + ref. StoreViewerIndex keeps that as a
//     (host/owner/name, branch) → candidates index, and each pass JOINS against it
//     before falling back to `gh pr list` for misses only. Most observed pairs are
//     the user's own PRs, so a pass costs ~0 subprocesses instead of one per pair —
//     fixing both the cold-start latency and the O(N)-subprocess steady-state
//     volume. Identity is HOST-QUALIFIED so a gitlab/GHE pane can never join a
//     same-`owner/name` github.com PR.
//
// The two mechanisms wake the SAME channel: whichever of the two racing startup
// events lands second (the SSE registrations or the collector's first batched
// fetch) triggers the debounced pass, so cold start never depends on wiring order.
//
// An index miss is never an authoritative negative (the batch covers only
// viewer-authored PRs within its top-prFetchLimit window), so only the gh
// fallback or the default-branch exclusion may clear an entry.
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

	// branchOriginTTL bounds how long a per-repo origin-identity verdict (the
	// resolved `host/owner/name` OR a fail-open lookup failure) is reused. An origin
	// remote essentially never changes, so — exactly like branchDefaultBranchTTL —
	// a minutes-range TTL keeps each repo to at most one `git remote get-url` per
	// window regardless of pair count.
	branchOriginTTL = 5 * time.Minute

	// branchPRWakeDebounce is the settle window a registration wake waits out
	// before running its refresh pass, draining any further wakes. One SSE
	// enrichment pass registers every observed pair back-to-back, so a burst of
	// dozens of first-sight registrations must collapse into ONE refresh — that
	// coalescing is what makes the wake seam cheap enough to be additive to the
	// 30s tick. The window is FIXED (drained wakes do not extend it), so a steady
	// trickle of new pairs can never postpone the pass indefinitely.
	branchPRWakeDebounce = 1 * time.Second
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

// branchOriginExec resolves a repo's origin remote URL LOCALLY (no network) via
// `git remote get-url origin` run in repoDir, returning its raw stdout (e.g.
// `git@github.com:sahil87/run-kit.git\n`). It is a package var so tests can stub
// git without a real repo, mirroring the branchPRExec / branchDefaultExec seams.
// The default uses exec.CommandContext with a timeout and an explicit argv slice;
// repoDir is set as cmd.Dir, never interpolated — no user input in argv
// (Constitution §I). Reading a remote URL touches only local config, so it never
// hits the network. A missing repo/remote makes git exit non-zero, which surfaces
// here as an error → the caller fails open.
var branchOriginExec = func(ctx context.Context, repoDir string) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(queryCtx, "git", "remote", "get-url", "origin")
	cmd.Dir = repoDir
	return cmd.Output()
}

// originSchemes are the URL schemes that carry a hosted-remote authority. A
// `file://` (or any other) scheme names a filesystem location, not a host, so it
// is rejected — it has no GitHub identity to join against.
var originSchemes = map[string]bool{"https": true, "http": true, "ssh": true, "git": true}

// parseOriginRepo normalizes a `git remote get-url origin` value to the
// HOST-QUALIFIED `host/owner/name` identity used to key the viewer head-index, so
// a local repoDir can be joined against the viewer-wide batch. The host is part of
// the identity because `owner/name` alone is NOT unique across forges: a pane
// whose origin is `gitlab.com/sahil87/tool` (or a GHE mirror) would otherwise join
// a `github.com/sahil87/tool` viewer PR, attach a wrong-host PR link, AND suppress
// the authoritative per-pair gh fallback that would have resolved it correctly.
//
// It accepts ONLY forms that carry an explicit host authority — a recognized
// scheme, or the scp-like `user@host:owner/name`:
//
//	https://github.com/owner/name.git      → github.com/owner/name
//	https://github.com/owner/name          → github.com/owner/name
//	git@github.com:owner/name.git          → github.com/owner/name  (scp-like)
//	ssh://git@github.com:22/owner/name.git → github.com/owner/name
//	git://github.com/owner/name.git        → github.com/owner/name
//	https://ghe.corp/owner/name.git        → ghe.corp/owner/name
//
// Everything else reports ok=false, notably every FILESYSTEM-path remote —
// absolute (`/srv/mirrors/foo`), relative (`../sibling/foo`), `file://`, and the
// dotted-relative-path lookalike (`cache.local/acme/tool`, which is a DIRECTORY,
// not a host). A dot in the first path segment is NOT evidence of a host; only the
// scheme or the scp-like colon is. ok=false is a fail-open signal: the caller
// resolves the pair via `gh pr list` instead, which is always correct — just not
// free.
func parseOriginRepo(out []byte) (string, bool) {
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "", false
	}

	// Split into authority + path, requiring an explicit host authority.
	var authority, path string
	if i := strings.Index(s, "://"); i >= 0 {
		if !originSchemes[strings.ToLower(s[:i])] {
			return "", false // file:// and friends name a path, not a host
		}
		rest := s[i+3:]
		slash := strings.Index(rest, "/")
		if slash < 0 {
			return "", false // authority only, no repo path
		}
		authority, path = rest[:slash], rest[slash+1:]
	} else {
		// The scp-like `user@host:owner/name` is the ONLY schemeless form with a
		// host. Requiring the userinfo `@` before the `:` is what separates it from
		// a bare filesystem path (`/srv/x`, `../x`, `cache.local/acme/tool`) and
		// from a drive/path spec (`host:/abs/path`).
		at := strings.Index(s, "@")
		colon := strings.Index(s, ":")
		if at <= 0 || colon <= at {
			return "", false
		}
		authority, path = s[:colon], s[colon+1:]
		if strings.HasPrefix(path, "/") {
			return "", false // `user@host:/abs/path` is a local path spec
		}
	}

	// Reduce the authority to a bare host: drop userinfo and any port.
	host := authority
	if i := strings.LastIndex(host, "@"); i >= 0 {
		host = host[i+1:]
	}
	if i := strings.Index(host, ":"); i >= 0 {
		host = host[:i]
	}
	if host == "" {
		return "", false
	}

	// The trailing two path segments are `owner/name` (a deeper path — e.g. a
	// GitLab sub-group — still ends in owner/name from GitHub's perspective).
	path = strings.TrimSuffix(strings.TrimRight(path, "/"), ".git")
	path = strings.TrimRight(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return "", false // no room for owner + name
	}
	owner, name := parts[len(parts)-2], parts[len(parts)-1]
	if owner == "" || name == "" {
		return "", false
	}
	return host + "/" + owner + "/" + name, true
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

// originEntry is a per-repo cached origin-identity verdict. Like
// defaultBranchEntry it caches BOTH a successful resolution (repo set, ok=true)
// AND a lookup failure (repo "", ok=false → the caller fails open to the per-pair
// gh path), each with a taken-at timestamp, so a repo costs at most one
// `git remote get-url origin` per branchOriginTTL window.
type originEntry struct {
	repo string    // resolved `host/owner/name` (empty on a cached failure)
	ok   bool      // true when the lookup succeeded; false is a cached fail-open verdict
	at   time.Time // wall-clock time the verdict was taken
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

	// Per-repo origin-identity cache (keyed by repoDir), guarded by mu. Same
	// shape and lifecycle as defaultBranches: both outcomes cached with a
	// taken-at timestamp, re-probed past branchOriginTTL, pruned when no live
	// pair observes the repo. Feeds the viewer-index join (see viewerIndex).
	origins map[string]originEntry

	// viewerIndex is the head-index seeded from the viewer-wide Collector's ONE
	// batched GraphQL call: (origin `host/owner/name`, headRefName) → candidate PRs
	// (see viewerIndexKey). It is replaced WHOLESALE by StoreViewerIndex on each
	// successful collector parse and consulted by every refresh pass before the
	// per-pair `gh pr list` fallback — which is what collapses N sequential gh
	// subprocesses per pass into one already-fetched batch. Guarded by mu.
	viewerIndex map[string][]BranchPR

	// wake is the coalescing registration-wake channel (capacity 1, non-blocking
	// send). Register signals it when a pair is FIRST seen so the refresher's
	// first useful pass starts as soon as the SSE enrichment loop has reported
	// its pairs (~2.5s after start) instead of waiting out the first 30s tick.
	// A capacity-1 buffer plus the wakeDebounce settle window collapse a burst of
	// registrations into a single pass.
	wake chan struct{}

	// wakeDebounce is the settle window Start waits out after a wake before
	// refreshing (defaults to branchPRWakeDebounce; a field so tests can shrink
	// it, mirroring the now/exec per-instance seams).
	wakeDebounce time.Duration

	// exec runs the branch-list gh query; available reports gh installed+
	// authenticated; defaultExec resolves a repo's default branch via git
	// symbolic-ref; originExec resolves a repo's origin remote URL via git remote
	// get-url. All are fields so tests can stub them per instance (matching the
	// ghExec/available seams on Collector). They default to the package-var
	// seams.
	exec        func(ctx context.Context, repoDir, branch string) ([]byte, error)
	available   func(ctx context.Context) bool
	defaultExec func(ctx context.Context, repoDir string) ([]byte, error)
	originExec  func(ctx context.Context, repoDir string) ([]byte, error)

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
		origins:         make(map[string]originEntry),
		interval:        interval,
		wake:            make(chan struct{}, 1),
		wakeDebounce:    branchPRWakeDebounce,
		exec:            branchPRExec,
		available:       branchPRAvailable,
		defaultExec:     branchDefaultExec,
		originExec:      branchOriginExec,
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
// window. It is a cheap lock-guarded set touch plus (on a FIRST-SIGHT pair) one
// non-blocking channel send — NO subprocess, NO network, never blocking — so it
// is safe on the SSE hot path. The background refresher resolves registered
// pairs; unobserved pairs age out (branchPRObservedTTL). Empty inputs are
// ignored.
//
// The wake fires ONLY when the key was not already present. Every SSE
// enrichment pass (2.5s) re-registers every observed pair, so waking on any
// registration would degenerate the refresher into a 2.5s gh poll; first-sight
// only keeps the 30s steady-state cadence intact while still starting the first
// useful pass as soon as the pairs exist.
func (r *BranchRefresher) Register(repoDir, branch string) {
	if repoDir == "" || branch == "" {
		return
	}
	key := branchPRCacheKey(repoDir, branch)
	now := r.now()
	r.mu.Lock()
	e, seen := r.entries[key] // zero value on first sight (pr=nil, observedAt=0)
	e.observedAt = now
	r.entries[key] = e
	r.mu.Unlock()
	if !seen {
		r.signalWake()
	}
}

// signalWake performs the coalescing non-blocking send on the wake channel: a
// wake already pending absorbs this one (capacity 1), and a full channel drops
// the send rather than blocking the caller — the standard coalescing-wake shape
// (mirroring api/sse.go's per-server wake seam). Safe from any goroutine,
// including the SSE hot path.
func (r *BranchRefresher) signalWake() {
	if r.wake == nil {
		return
	}
	select {
	case r.wake <- struct{}{}:
	default:
	}
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

// viewerIndexKey builds the viewer head-index key from a HOST-QUALIFIED head
// repository identity (`host/owner/name` — the shape parseOriginRepo returns, and
// what StoreViewerIndex composes from a node's URL host + nameWithOwner) and a
// head ref name.
//
// The host is part of the key because `owner/name` is not unique across forges: a
// gitlab.com or GHE pane must MISS a same-named github.com PR rather than attach
// it (and thereby suppress the authoritative gh fallback). The identity half is
// LOWERCASED — hostnames are case-insensitive, GitHub repository identities are
// case-insensitive, and nameWithOwner returns the canonical case while a local
// `origin` URL may be typed differently, so folding case prevents a spurious miss.
// Branch names are NOT folded (git refs are case-sensitive). The NUL separator
// avoids any identity/ref collision.
func viewerIndexKey(hostRepo, headRef string) string {
	return strings.ToLower(hostRepo) + "\x00" + headRef
}

// StoreViewerIndex replaces the viewer head-index WHOLESALE from one batched
// viewer-wide fetch (wired to Collector.SetViewerPRSink in router.go). Candidates
// are grouped by (head repo, head ref) so a refresh pass can join a
// (repoDir, branch) pair against PRs the process ALREADY fetched, instead of
// spawning one `gh pr list` per pair.
//
// Nodes with no URL (malformed/partial JSON — a URL-less PR can never key the
// live-status join), no URL HOST (the host is half the index identity — see
// viewerIndexKey), no head ref, or no head repository (a deleted fork) carry no
// joinable identity and are skipped. Wholesale replacement mirrors the
// collector's byURL rebuild: a PR that aged out of the batch simply stops being
// an index candidate, so there is no eviction logic. In-memory only
// (Constitution §II).
//
// A NON-EMPTY store signals the coalescing wake channel, so a seed that lands
// AFTER the first registrations still triggers one debounced index-served pass.
// This is what makes startup ordering safe WITHOUT relying on wiring order: the
// collector's first batched fetch completes at an unpredictable time relative to
// the first SSE registrations (and on the restart path the registrations win the
// race), so both orderings must converge on an index-served pass. An EMPTY store
// (no gh PRs, or every node unjoinable) signals nothing — there is no index to
// serve a pass from, so a wake would only burn a `gh pr list` per pair.
func (r *BranchRefresher) StoreViewerIndex(prs []ViewerPR) {
	next := make(map[string][]BranchPR, len(prs))
	for _, p := range prs {
		if p.URL == "" || p.HeadRef == "" || p.HeadRepo == "" {
			continue
		}
		host, ok := prURLHost(p.URL)
		if !ok {
			continue // no host authority → no joinable identity (see viewerIndexKey)
		}
		key := viewerIndexKey(host+"/"+p.HeadRepo, p.HeadRef)
		next[key] = append(next[key], BranchPR{
			Number:    p.Number,
			URL:       p.URL,
			State:     p.State,
			UpdatedAt: p.UpdatedAt,
		})
	}
	r.mu.Lock()
	r.viewerIndex = next
	r.mu.Unlock()
	if len(next) > 0 {
		r.signalWake()
	}
}

// prURLHost extracts the bare host authority from a PR's canonical URL. The
// batched viewer query carries no `--hostname`, so the PR URL is the ONLY host
// authority available for a node — and the host is half the index identity
// (viewerIndexKey), since an `owner/name` alone would let a gitlab.com or GHE
// pane join a github.com PR. A URL that does not parse, or that carries no host,
// yields ok=false and its node is skipped.
func prURLHost(rawURL string) (string, bool) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", false
	}
	host := u.Hostname() // drops any :port
	if host == "" {
		return "", false
	}
	return host, true
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
//
// The loop additionally selects on the registration wake channel. The immediate
// first refresh is a NO-OP at process start (no pair is registered yet —
// registration only happens once the SSE enrichment loop observes panes), so
// without the wake the first USEFUL pass would wait out a whole interval; the
// wake makes it event-driven instead (~2.5s after start). Steady-state cadence
// is unchanged: the ticker keeps running and the wake is purely additive, firing
// only for first-sight pairs.
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
			case <-r.wake:
				if !r.settle(ctx) {
					return // ctx cancelled mid-settle
				}
				r.refresh(ctx)
			}
		}
	}()
}

// settle waits out the wakeDebounce window after a wake, DRAINING any further
// wakes so a burst of registrations from one SSE enrichment pass yields exactly
// one refresh pass. It reports whether the window elapsed (true) or ctx was
// cancelled (false — the caller must exit without refreshing). The window is
// fixed: a drained wake does not restart it, so a steady trickle of new pairs
// can never postpone the pass. A wake arriving AFTER the window (including
// during the refresh itself) stays buffered and triggers one more pass — the
// same at-least-once guarantee the SSE hub's wake seam gives.
func (r *BranchRefresher) settle(ctx context.Context) bool {
	timer := time.NewTimer(r.wakeDebounce)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-r.wake:
			// Absorbed into this pass; keep waiting out the same window.
		case <-timer.C:
			return true
		}
	}
}

// refresh re-resolves every currently-registered pair and ages out pairs no
// longer observed. Per pair it tries three resolvers IN ORDER — default-branch
// exclusion, viewer head-index join, per-pair `gh pr list` fallback (see the loop
// body) — so the gh subprocess runs only for pairs the already-fetched batch does
// not cover. Availability is checked at most ONCE per pass, LAZILY: the probe
// (itself a subprocess) runs only when a pair actually reaches the gh fallback, so
// a pass resolved entirely by exclusions and index hits issues zero gh
// subprocesses.
// Resolution rules for the gh path:
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
	// lock held so Register/Snapshot never block on a hung gh. The set of live
	// repoDirs is collected here too, so stale per-repo default-branch entries
	// (repos no window observes anymore) can be pruned symmetrically with the
	// per-pair age-out — keeping defaultBranches bounded (Constitution §II).
	r.mu.Lock()
	type pending struct {
		key             string
		repoDir, branch string
	}
	var todo []pending
	liveRepos := make(map[string]struct{})
	for key, e := range r.entries {
		if now.Sub(e.observedAt) > branchPRObservedTTL {
			delete(r.entries, key)
			continue
		}
		repoDir, branch := splitBranchPRKey(key)
		liveRepos[repoDir] = struct{}{}
		todo = append(todo, pending{key: key, repoDir: repoDir, branch: branch})
	}
	// Prune per-repo default-branch verdicts for repos no live pair observes
	// anymore. Best-effort, timestamp-guarded: a repo whose newest verdict is
	// still within branchDefaultBranchTTL is kept (it may be re-observed within
	// the window and re-used), so this never fights an in-flight re-probe.
	for repoDir, e := range r.defaultBranches {
		if _, live := liveRepos[repoDir]; live {
			continue
		}
		if now.Sub(e.at) > branchDefaultBranchTTL {
			delete(r.defaultBranches, repoDir)
		}
	}
	// Prune per-repo origin-identity verdicts the same way, on the same guard —
	// the two caches share a lifecycle (Constitution §II: bounded in-memory maps).
	for repoDir, e := range r.origins {
		if _, live := liveRepos[repoDir]; live {
			continue
		}
		if now.Sub(e.at) > branchOriginTTL {
			delete(r.origins, repoDir)
		}
	}
	r.mu.Unlock()

	if len(todo) == 0 {
		return
	}

	// At most ONE availability check per pass, resolved LAZILY — only when a pair
	// actually reaches the gh fallback below — and memoized for the rest of the
	// pass (the cross-pass branchPRAvailabilityTTL cache inside checkAvailable still
	// applies on top).
	//
	// Laziness is load-bearing for cold start: `gh auth status` is a subprocess that
	// can burn up to ghTimeout (10s) when the network hangs, and the two resolvers
	// ahead of the fallback — the default-branch exclusion and the viewer head-index
	// join — need no gh at all. A pass in which every pair resolves that way must
	// therefore issue NO gh subprocess whatsoever, or the wake-driven first pass
	// would stall behind a probe whose answer it never uses.
	//
	// NOTE: this is NOT an early return. The exclusion needs only local
	// `git symbolic-ref`, so it MUST run even when gh is unavailable — otherwise a
	// stale positive (the #480 fork-PR case) would never be cleared while gh is
	// down, defeating the whole point of the exclusion. Only the gh execution path
	// (r.exec) is gated on availability. The closure is confined to this pass, which
	// runs on one goroutine, so the memo needs no lock.
	ghProbed, ghOK := false, false
	ghAvailableNow := func() bool {
		if !ghProbed {
			ghOK = r.checkAvailable(ctx, now)
			ghProbed = true
		}
		return ghOK
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

		// Viewer head-index join: the pair's PR may already have been fetched by
		// the viewer-wide collector's ONE batched GraphQL call (most observed pairs
		// are the user's own PRs). On a hit this resolves the pair with NO
		// subprocess at all — the mechanism that turns an N-sequential-`gh pr list`
		// pass into a join, and that makes the wake-driven first pass resolve
		// immediately instead of over minutes.
		//
		// A MISS is never authoritative: the batch covers only viewer-authored PRs
		// inside the top-prFetchLimit recently-updated window, so it cannot
		// distinguish "no PR" from "not covered". Misses therefore fall THROUGH to
		// the gh path, which alone may write a negative.
		if pr, hit := r.viewerIndexPR(ctx, now, p.repoDir, p.branch); hit {
			r.mu.Lock()
			if e, present := r.entries[p.key]; present { // may have aged out concurrently
				e.pr = pr
				r.entries[p.key] = e
			}
			r.mu.Unlock()
			continue
		}

		// gh path: only reachable for a non-default branch the index did not cover.
		// This is also the FIRST point at which gh availability matters, so it is
		// where the probe is resolved (once per pass, memoized). Skip the pair when
		// gh is unavailable (keeping last-good, stale-while-revalidate) — the
		// exclusion above already ran regardless of gh.
		if !ghAvailableNow() {
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

// viewerIndexPR resolves a (repoDir, branch) pair against the stored viewer
// head-index, reporting hit=false for every "not covered" case — no index seeded
// yet, origin identity unresolvable, or no candidate under the pair's
// HOST-QUALIFIED key (so a same-`owner/name` repo on a different forge is a MISS,
// not a wrong-host hit) — all of which fall through to the per-pair gh path. It
// NEVER writes a negative entry: the batch cannot prove a branch has no PR.
//
// A hit is ranked with pickBranchCandidate — the SAME precedence helper the gh
// path's pickBranchPR uses — so indexed and gh-derived results agree on the
// winner (open > merged > closed, most-recently-updated within a class).
// Runs on the refresher goroutine only (it may resolve origin identity, a
// subprocess), never on the hot path.
func (r *BranchRefresher) viewerIndexPR(ctx context.Context, now time.Time, repoDir, branch string) (*BranchPR, bool) {
	r.mu.RLock()
	indexSize := len(r.viewerIndex)
	r.mu.RUnlock()
	if indexSize == 0 {
		// No seed yet (collector unwired, or its first fetch has not landed).
		// Short-circuit BEFORE resolving origin identity so an unwired collector
		// costs zero `git remote get-url` subprocesses.
		return nil, false
	}

	repo, ok := r.originRepo(ctx, now, repoDir)
	if !ok {
		return nil, false // identity unresolvable → fail open to the gh path
	}

	r.mu.RLock()
	candidates := r.viewerIndex[viewerIndexKey(repo, branch)]
	r.mu.RUnlock()
	pr := pickBranchCandidate(candidates)
	if pr == nil {
		return nil, false
	}
	return pr, true
}

// originRepo returns the repo's HOST-QUALIFIED `host/owner/name` origin identity,
// resolving it via the git-remote seam and caching the verdict per-repo for
// branchOriginTTL (see parseOriginRepo for why the host is part of it). The
// bool reports whether the lookup SUCCEEDED — ok=false is a fail-open signal (the
// caller then resolves the pair via gh). BOTH outcomes are cached (a failure just
// as much as a success) so a pathless/remoteless repo does not trigger a per-pass
// retry storm. It NEVER runs a subprocess when a fresh verdict stands. Runs on
// the refresher goroutine only, with the subprocess OUTSIDE the mu critical
// section — exactly like defaultBranch, so a hung git never blocks
// Register/Snapshot.
func (r *BranchRefresher) originRepo(ctx context.Context, now time.Time, repoDir string) (string, bool) {
	r.mu.RLock()
	e, cached := r.origins[repoDir]
	r.mu.RUnlock()
	if cached && !e.at.IsZero() && now.Sub(e.at) < branchOriginTTL {
		return e.repo, e.ok
	}

	repo, ok := "", false
	if r.originExec != nil {
		if out, err := r.originExec(ctx, repoDir); err == nil {
			repo, ok = parseOriginRepo(out)
		}
	}

	r.mu.Lock()
	r.origins[repoDir] = originEntry{repo: repo, ok: ok, at: now}
	r.mu.Unlock()
	return repo, ok
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
	return pickBranchCandidate(prs), nil
}

// pickBranchCandidate is the precedence ranker shared by BOTH derivation paths —
// the `gh pr list` fallback (via pickBranchPR) and the viewer head-index join
// (via viewerIndexPR) — so an indexed candidate set and a gh result set can never
// disagree on the winner. Precedence: open > merged > closed (branchStateRank),
// ties WITHIN a class broken by most-recently-updated. URL-less candidates are
// skipped (they could never key the live-status join). Returns nil when the slice
// is empty or every candidate was skipped, and always returns a COPY so callers
// cannot mutate the backing array.
func pickBranchCandidate(prs []BranchPR) *BranchPR {
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
		return nil
	}
	chosen := prs[best]
	return &chosen
}
