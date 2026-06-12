// Package prstatus maintains an in-memory, periodically-refreshed cache of the
// current user's open pull-request statuses, fetched in a single batched `gh`
// call. It is modeled on internal/metrics.Collector: a background goroutine
// ticks on an interval, refreshes a snapshot under a lock, and Snapshot()
// hands callers a deep copy.
//
// Design (see fab/changes/260610-596o-pr-status-sidebar):
//   - ONE batched GraphQL call (gh api graphql, viewer.pullRequests) fetches
//     every open PR authored by the user across ALL repos — O(1) in PR count.
//   - The map is REBUILT WHOLESALE each refresh. A PR that merged/closed (no
//     longer OPEN) simply drops out next cycle — this is the cleanup mechanism,
//     so there is no eviction logic or window-lifecycle hook.
//   - On a gh error (network blip) the last-good map is kept
//     (stale-while-revalidate), mirroring metrics.Collector / fetchPaneMapCached.
//   - gh absent or unauthenticated is a silent no-op (last-good kept), matching
//     the `command -v rk` fail-silent posture used elsewhere in the codebase.
//
// No database, no disk, no tmux option — in-memory only (Constitution §II).
// All process execution uses exec.CommandContext with a timeout and an explicit
// argument slice; no shell string and no user input in argv (Constitution §I).
package prstatus

import (
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

// ghTimeout bounds the single batched gh call so a hung gh can never block the
// background goroutine (Constitution Process Execution: 30s for build-like ops,
// shorter for queries; 10s here matches the pane-map fetch).
const ghTimeout = 10 * time.Second

// prFetchLimit caps the number of PRs requested in the batched query. A user
// with more than this many simultaneously-open PRs is far outside the target
// workflow; the cap keeps the single call bounded.
const prFetchLimit = 100

// PRStatus is the collapsed, display-ready status for one pull request.
type PRStatus struct {
	Number         int       // PR number
	URL            string    // canonical PR URL
	State          string    // open | merged | closed
	IsDraft        bool      // draft PR
	Checks         string    // pass | fail | pending | none
	ReviewDecision string    // approved | changes_requested | review_required | none
	FetchedAt      time.Time // when this status was fetched
}

// Collector holds the latest PR-status snapshot, refreshed in the background.
// The map is keyed by canonical PR URL, NOT by PR number: numbers are only
// unique per repository, and the batched query spans ALL of the viewer's repos,
// so two open PRs can share a number (e.g. repoA#18 and repoB#18) and a
// number-keyed map would let one silently clobber the other.
type Collector struct {
	mu       sync.RWMutex
	byURL    map[string]PRStatus
	interval time.Duration

	// ghExec runs the batched gh query and returns its raw stdout. It is a
	// field so tests can stub gh without a real binary (matching the codebase's
	// exec-seam test pattern). nil means "not available" (silent no-op).
	ghExec func(ctx context.Context) ([]byte, error)

	// available reports whether gh is installed and authenticated. A field so
	// tests can force the guard true/false without a real gh binary. Defaults
	// to ghAvailable.
	available func(ctx context.Context) bool
}

// NewCollector creates a PR-status collector that polls on the given interval.
// Call Start to begin the background goroutine.
func NewCollector(interval time.Duration) *Collector {
	return &Collector{
		byURL:     make(map[string]PRStatus),
		interval:  interval,
		ghExec:    defaultGhExec,
		available: ghAvailable,
	}
}

// Start begins the background polling goroutine. It exits when ctx is
// cancelled. The first refresh runs immediately so the cache is warm before the
// first tick elapses.
func (c *Collector) Start(ctx context.Context) {
	go func() {
		c.refresh(ctx)
		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.refresh(ctx)
			}
		}
	}()
}

// Snapshot returns a deep copy of the current PR-status map, keyed by
// canonical PR URL. Callers may read it freely without holding the lock.
func (c *Collector) Snapshot() map[string]PRStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]PRStatus, len(c.byURL))
	for k, v := range c.byURL {
		out[k] = v
	}
	return out
}

// RefreshNow triggers an on-demand refresh (used by the POST refresh endpoint).
// Best-effort: errors are swallowed (stale-while-revalidate keeps the last-good
// map), so callers never block on or surface a gh failure.
func (c *Collector) RefreshNow(ctx context.Context) {
	c.refresh(ctx)
}

// refresh performs ONE batched gh call and rebuilds byURL wholesale.
//
// Failure modes (all leave the last-good map untouched, return without error):
//   - ghExec is nil (gh unavailable / collector not wired) → no-op
//   - gh is absent or unauthenticated → no-op (guarded by ghAvailable)
//   - the gh call errors (network blip) → stale-while-revalidate, keep last-good
//   - the JSON fails to parse → keep last-good
func (c *Collector) refresh(ctx context.Context) {
	if c.ghExec == nil {
		return
	}
	if c.available != nil && !c.available(ctx) {
		return
	}

	out, err := c.ghExec(ctx)
	if err != nil {
		// Network blip / transient gh failure: keep the last-good map
		// (stale-while-revalidate). Do not clear.
		return
	}

	prs, err := parsePRs(out)
	if err != nil {
		return
	}

	next := make(map[string]PRStatus, len(prs))
	now := time.Now()
	for _, p := range prs {
		next[p.URL] = PRStatus{
			Number:         p.Number,
			URL:            p.URL,
			State:          mapState(p.State, p.IsDraft),
			IsDraft:        p.IsDraft,
			Checks:         mapChecks(p.rollupState()),
			ReviewDecision: mapReview(p.ReviewDecision),
			FetchedAt:      now,
		}
	}

	// REPLACE wholesale: a PR absent from the new result (merged/closed/no
	// longer OPEN) is gone next cycle. This is the cleanup mechanism.
	c.mu.Lock()
	c.byURL = next
	c.mu.Unlock()
}

// ghAvailable reports whether the gh CLI is installed AND authenticated. Either
// failing is a silent no-op (matches the `command -v rk` posture).
func ghAvailable(ctx context.Context) bool {
	if _, err := exec.LookPath("gh"); err != nil {
		return false
	}
	authCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	// `gh auth status` exits non-zero when not logged in.
	cmd := exec.CommandContext(authCtx, "gh", "auth", "status")
	return cmd.Run() == nil
}

// ghQuery is the GraphQL query fetching the user's most-recently-updated PRs
// across all repos in a single call — OPEN, MERGED, and CLOSED, ordered by
// UPDATED_AT desc and capped at $limit. Including MERGED/CLOSED lets the pane
// line show a "merged"/"closed" state instead of a bare PR number after a PR
// lands. The recency ordering + $limit cap IS the eviction mechanism: a stale
// merged PR ages out of the top-$limit window and drops from the next wholesale
// rebuild, so the in-memory snapshot stays bounded without separate pruning.
// A just-merged PR is recently updated, so it sits near the top and is always
// included. statusCheckRollup.state is GitHub's pre-collapsed rollup enum
// (SUCCESS|FAILURE|PENDING|ERROR|EXPECTED) so we get the rollup for free.
const ghQuery = `query($limit: Int!) {
  viewer {
    pullRequests(first: $limit, states: [OPEN, MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        url
        state
        isDraft
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

// defaultGhExec runs the batched GraphQL query via `gh api graphql`. Uses
// exec.CommandContext with a timeout and an explicit argument slice — no shell
// string, no user input in argv (Constitution §I).
func defaultGhExec(ctx context.Context) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(queryCtx, "gh", "api", "graphql",
		"-f", "query="+ghQuery,
		"-F", "limit="+strconv.Itoa(prFetchLimit),
	)
	return cmd.Output()
}

// --- gh GraphQL response shapes -------------------------------------------------

type ghResponse struct {
	Data struct {
		Viewer struct {
			PullRequests struct {
				Nodes []ghPR `json:"nodes"`
			} `json:"pullRequests"`
		} `json:"viewer"`
	} `json:"data"`
}

type ghPR struct {
	Number         int    `json:"number"`
	URL            string `json:"url"`
	State          string `json:"state"` // OPEN | CLOSED | MERGED
	IsDraft        bool   `json:"isDraft"`
	ReviewDecision string `json:"reviewDecision"` // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
	Commits        struct {
		Nodes []struct {
			Commit struct {
				StatusCheckRollup *struct {
					State string `json:"state"` // SUCCESS | FAILURE | PENDING | ERROR | EXPECTED
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"commits"`
}

// rollupState extracts the latest commit's check-rollup state, or "" when the
// PR has no commit or no rollup (e.g. no CI configured).
func (p ghPR) rollupState() string {
	if len(p.Commits.Nodes) == 0 {
		return ""
	}
	r := p.Commits.Nodes[0].Commit.StatusCheckRollup
	if r == nil {
		return ""
	}
	return r.State
}

// parsePRs decodes the gh GraphQL response into the PR node list.
func parsePRs(out []byte) ([]ghPR, error) {
	var resp ghResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, err
	}
	return resp.Data.Viewer.PullRequests.Nodes, nil
}

// --- enum collapse --------------------------------------------------------------

// mapState collapses GitHub's PR state to the display state open|merged|closed.
// The draft flag is surfaced separately via PRStatus.IsDraft; a draft PR is
// still "open". An unexpected/empty state defaults to "open".
func mapState(ghState string, _ bool) string {
	switch ghState {
	case "MERGED":
		return "merged"
	case "CLOSED":
		return "closed"
	default: // OPEN (and any unexpected value)
		return "open"
	}
}

// mapChecks collapses GitHub's statusCheckRollup state to pass|fail|pending|none.
// A failing/errored rollup dominates; a pending/expected rollup is pending;
// success is pass; an absent rollup (no CI) is none.
func mapChecks(rollupState string) string {
	switch rollupState {
	case "SUCCESS":
		return "pass"
	case "FAILURE", "ERROR":
		return "fail"
	case "PENDING", "EXPECTED":
		return "pending"
	default: // "" or unknown → no checks
		return "none"
	}
}

// mapReview collapses GitHub's reviewDecision to
// approved|changes_requested|review_required|none.
func mapReview(decision string) string {
	switch decision {
	case "APPROVED":
		return "approved"
	case "CHANGES_REQUESTED":
		return "changes_requested"
	case "REVIEW_REQUIRED":
		return "review_required"
	default: // "" or unknown → none
		return "none"
	}
}
