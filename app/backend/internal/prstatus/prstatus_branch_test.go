package prstatus

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"
)

// newTestRefresher builds a BranchRefresher with injected exec/available seams
// and a controllable clock, so tests drive resolution deterministically without
// a real gh binary, the background goroutine, or wall-clock timing. The
// default-branch seam defaults to a fail-open stub (git symbolic-ref "fails"), so
// tests that don't care about the default-branch exclusion resolve every pair
// via the gh path exactly as before — no real git process is ever spawned.
func newTestRefresher(available bool, exec func(ctx context.Context, repoDir, branch string) ([]byte, error)) *BranchRefresher {
	r := NewBranchRefresher(branchPRRefreshInterval)
	r.exec = exec
	r.available = func(context.Context) bool { return available }
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return nil, errors.New("no default branch (test default: fail-open)")
	}
	// Origin identity also defaults to a fail-open stub so no test ever spawns a
	// real `git remote get-url`. Tests exercising the viewer-index join override
	// it (an unseeded index short-circuits before it is even consulted).
	r.originExec = func(context.Context, string) ([]byte, error) {
		return nil, errors.New("no origin (test default: fail-open)")
	}
	// Fixed clock; tests advance it via r.now reassignment when they need TTL math.
	base := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return base }
	return r
}

// originURLOutput renders `git remote get-url origin` stdout (trailing newline as
// git emits).
func originURLOutput(url string) []byte { return []byte(url + "\n") }

// prURL renders a canonical PR URL on a given host. Seed candidates must carry a
// realistic URL: the index key is HOST-QUALIFIED and the host comes from the PR
// URL (the batched query carries no --hostname), so a placeholder URL with no host
// is skipped at index time.
func prURL(host, repo string, number int) string {
	return "https://" + host + "/" + repo + "/pull/" + strconv.Itoa(number)
}

// ghPRURL renders a github.com PR URL — the common seed case, matching a
// github.com origin.
func ghPRURL(repo string, number int) string { return prURL("github.com", repo, number) }

// seedIndex stores a viewer head-index from (headRepo, headRef, candidate)
// triples, going through the real StoreViewerIndex path so the skip rules and key
// derivation under test are the ones production uses.
func seedIndex(r *BranchRefresher, prs ...ViewerPR) { r.StoreViewerIndex(prs) }

// viewerPR builds one seed candidate.
func viewerPR(number int, url, state, headRepo, headRef string, updatedAt time.Time) ViewerPR {
	return ViewerPR{Number: number, URL: url, State: state, HeadRepo: headRepo, HeadRef: headRef, UpdatedAt: updatedAt}
}

// ts parses an RFC3339 timestamp for candidate fixtures.
func ts(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("bad fixture timestamp %q: %v", s, err)
	}
	return v
}

// drainWake reports how many wake signals are currently pending (0 or 1 — the
// channel is capacity-1), draining them.
func drainWake(r *BranchRefresher) int {
	n := 0
	for {
		select {
		case <-r.wake:
			n++
		default:
			return n
		}
	}
}

// defaultBranchRefOutput renders the `git symbolic-ref refs/remotes/origin/HEAD`
// stdout for a given default branch name (trailing newline as git emits).
func defaultBranchRefOutput(name string) []byte {
	return []byte(defaultBranchRefPrefix + name + "\n")
}

// branchListJSON renders a `gh pr list --json ...` array from raw node strings.
func branchListJSON(nodes ...string) []byte {
	out := "["
	for i, n := range nodes {
		if i > 0 {
			out += ","
		}
		out += n
	}
	out += "]"
	return []byte(out)
}

// branchNode renders an OPEN PR node (the common case for the non-precedence
// tests). Precedence tests use branchNodeState to set a specific state.
func branchNode(number int, url, updatedAt string) string {
	return branchNodeState(number, url, "OPEN", updatedAt)
}

// branchNodeState renders a PR node with an explicit GitHub state (OPEN | MERGED
// | CLOSED — the `gh pr list --json state` enum) so precedence tests can build
// mixed-state branches.
func branchNodeState(number int, url, state, updatedAt string) string {
	return `{"number":` + strconv.Itoa(number) + `,"url":"` + url +
		`","state":"` + state + `","updatedAt":"` + updatedAt + `"}`
}

// TestBranchRefresher_SinglePR: a registered pair resolves to its single open PR
// after one refresh, and the snapshot serves it without any further exec.
func TestBranchRefresher_SinglePR(t *testing.T) {
	calls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		calls++
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})

	// Before resolution: snapshot is empty even for a registered pair.
	r.Register("/repo", "feat")
	if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
		t.Fatalf("snapshot before refresh must be empty, got ok=%v pr=%v", ok, pr)
	}

	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil {
		t.Fatalf("expected a PR after refresh, got ok=%v pr=%v", ok, pr)
	}
	if pr.Number != 4 || pr.URL != "https://x/pull/4" {
		t.Errorf("got #%d %q, want #4 https://x/pull/4", pr.Number, pr.URL)
	}
	// A second snapshot read issues NO exec (hot-path purity).
	if _, _ = r.Snapshot("/repo", "feat"); calls != 1 {
		t.Errorf("Snapshot issued exec: calls=%d, want 1 (only the refresh)", calls)
	}
}

// TestBranchRefresher_MultiPRPicksMostRecent: on a branch with several open PRs,
// the most-recently-updated one wins.
func TestBranchRefresher_MultiPRPicksMostRecent(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(
			branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z"),
			branchNode(9, "https://x/pull/9", "2026-07-05T00:00:00Z"), // most recent
			branchNode(7, "https://x/pull/7", "2026-07-03T00:00:00Z"),
		), nil
	})
	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil {
		t.Fatalf("expected a PR, got ok=%v", ok)
	}
	if pr.Number != 9 {
		t.Errorf("got #%d, want #9 (most recently updated)", pr.Number)
	}
}

// TestBranchRefresher_NoPRNegativeEntry: an empty result is a valid negative
// entry (resolved, no open PR) — snapshot returns (nil, false).
func TestBranchRefresher_NoPRNegativeEntry(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil // empty array
	})
	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
		t.Errorf("expected no PR (negative entry), got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_GhUnavailableNoExecCachedNegative: when gh is unavailable
// the refresher issues NO branch-list exec, and the negative availability verdict
// is CACHED — a second pass within the TTL does not re-probe availability.
func TestBranchRefresher_GhUnavailableNoExecCachedNegative(t *testing.T) {
	execCalls := 0
	availCalls := 0
	r := NewBranchRefresher(branchPRRefreshInterval)
	r.exec = func(context.Context, string, string) ([]byte, error) {
		execCalls++
		return nil, nil
	}
	r.available = func(context.Context) bool {
		availCalls++
		return false
	}
	base := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return base }

	r.Register("/repo", "feat")
	r.refresh(context.Background())
	r.refresh(context.Background()) // second pass, same (cached) clock

	if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
		t.Errorf("expected no PR when gh unavailable, got ok=%v", ok)
	}
	if execCalls != 0 {
		t.Errorf("branch-list exec ran %d times, want 0 (gh unavailable)", execCalls)
	}
	if availCalls != 1 {
		t.Errorf("availability probed %d times across two passes, want 1 (negative cached)", availCalls)
	}
}

// TestBranchRefresher_AvailabilityReprobedAfterTTL: once the cached availability
// verdict ages past branchPRAvailabilityTTL, the next pass re-probes.
func TestBranchRefresher_AvailabilityReprobedAfterTTL(t *testing.T) {
	availCalls := 0
	r := NewBranchRefresher(branchPRRefreshInterval)
	r.exec = func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	}
	r.available = func(context.Context) bool {
		availCalls++
		return true
	}
	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // probe #1
	now = now.Add(branchPRAvailabilityTTL + time.Second)
	r.refresh(context.Background()) // verdict stale → probe #2

	if availCalls != 2 {
		t.Errorf("availability probed %d times, want 2 (re-probe after TTL)", availCalls)
	}
}

// TestBranchRefresher_TransientErrorKeepsLastGood: a good entry survives a
// subsequent transient exec error (true stale-while-revalidate — never
// downgraded to a negative).
func TestBranchRefresher_TransientErrorKeepsLastGood(t *testing.T) {
	fail := false
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		if fail {
			return nil, errors.New("gh boom")
		}
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.Register("/repo", "feat")
	r.refresh(context.Background()) // resolves #4

	fail = true
	r.refresh(context.Background()) // transient error

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("last-good PR #4 must survive a transient error, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_MalformedJSONNoPrior: unparseable gh output with no prior
// good entry serves nothing (the entry stays unresolved, nil pr) rather than
// panicking. Snapshot returns (nil, false) either way.
func TestBranchRefresher_MalformedJSONNoPrior(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return []byte("not json"), nil
	})
	r.Register("/repo", "feat")
	r.refresh(context.Background())
	if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
		t.Errorf("expected no PR on malformed JSON, got ok=%v", ok)
	}
}

// TestBranchRefresher_MalformedJSONKeepsLastGood: a partial/malformed gh output
// (broken JSON) must NOT clear a previously-good PR mapping — it is treated like
// a transient error (stale-while-revalidate), same as an exec error.
func TestBranchRefresher_MalformedJSONKeepsLastGood(t *testing.T) {
	malformed := false
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		if malformed {
			return []byte("{partial"), nil // broken JSON, e.g. a truncated gh write
		}
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.Register("/repo", "feat")
	r.refresh(context.Background()) // resolves #4

	malformed = true
	r.refresh(context.Background()) // parse error → must keep #4

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("last-good PR #4 must survive a JSON parse error, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_MergedPRDurableFromColdCollector: the D2-revised
// durability contract (status-pyramid.md § Open Decisions — D2, revised). A
// merged PR's done-square must be DERIVED, not remembered — so it survives an rk
// restart, which a fresh (cold) BranchRefresher faithfully models (the refresher
// holds ALL cross-restart derivation state, so a new instance == a restart). The
// branch query is `--state all`, so the merged PR keeps resolving positive with
// no prior positive entry and no grace clock: the cold collector serves it on the
// FIRST refresh and on every pass thereafter (no wall-clock grace to expire).
func TestBranchRefresher_MergedPRDurableFromColdCollector(t *testing.T) {
	// Cold collector: a fresh refresher (no history, no grace state). The gh
	// response is exactly what a warm collector would see — a merged PR on the
	// branch. Restart-proofness = the SAME gh response yields the SAME derivation
	// from fresh process state.
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNodeState(4, "https://x/pull/4", "MERGED", "2026-07-01T00:00:00Z")), nil
	})
	base := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return base }

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // FIRST refresh on a cold collector

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("merged PR #4 must be served on the first refresh of a cold collector, got ok=%v pr=%v", ok, pr)
	}

	// Many further passes, arbitrarily far in the future — no grace clock, so the
	// merged PR is served statelessly forever (as long as the pane sits on the
	// branch). Re-Register each pass (a live window does every SSE tick) so the
	// observed-TTL age-out never fires.
	for i := 0; i < 5; i++ {
		base = base.Add(time.Hour) // far past any former 10-min grace window
		r.now = func() time.Time { return base }
		r.Register("/repo", "feat")
		r.refresh(context.Background())
		if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 4 {
			t.Fatalf("merged PR #4 must remain served on pass %d (stateless durability, no grace expiry), got ok=%v pr=%v", i, ok, pr)
		}
	}
}

// TestBranchRefresher_RefreshNow: the exported on-demand RefreshNow delegates to
// the same private refresh the tick runs — a registered pair is re-resolved and
// served from the snapshot after one RefreshNow call, and a subsequent transient
// error keeps the last-good entry (best-effort, stale-while-revalidate).
func TestBranchRefresher_RefreshNow(t *testing.T) {
	fail := false
	calls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		calls++
		if fail {
			return nil, errors.New("gh boom")
		}
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.Register("/repo", "feat")

	// On-demand refresh resolves the pair without the background goroutine.
	r.RefreshNow(context.Background())
	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("RefreshNow must resolve the registered pair, got ok=%v pr=%v", ok, pr)
	}
	if calls != 1 {
		t.Errorf("RefreshNow issued %d exec calls, want 1", calls)
	}

	// A transient error on a later RefreshNow keeps the last-good entry.
	fail = true
	r.RefreshNow(context.Background())
	pr, ok = r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("last-good PR #4 must survive a transient RefreshNow error, got ok=%v pr=%v", ok, pr)
	}
}

// TestPickBranchPR_Precedence covers the open > merged > closed selection rule
// (status-pyramid.md D2, revised), including the branch-reuse edge (an open PR
// with an OLDER updatedAt still outranks a newer merged PR — state class beats
// recency across classes) and most-recent-within-class tie-breaking.
func TestPickBranchPR_Precedence(t *testing.T) {
	cases := []struct {
		name  string
		nodes []string
		want  int // expected PR number, or -1 for nil
	}{
		{
			name: "open beats merged even when older (branch-reuse edge)",
			nodes: []string{
				branchNodeState(4, "https://x/pull/4", "MERGED", "2026-07-05T00:00:00Z"), // newer
				branchNodeState(9, "https://x/pull/9", "OPEN", "2026-07-01T00:00:00Z"),   // older but open
			},
			want: 9,
		},
		{
			name: "merged beats closed",
			nodes: []string{
				branchNodeState(4, "https://x/pull/4", "CLOSED", "2026-07-05T00:00:00Z"),
				branchNodeState(9, "https://x/pull/9", "MERGED", "2026-07-01T00:00:00Z"),
			},
			want: 9,
		},
		{
			name: "closed only returns the most-recent closed",
			nodes: []string{
				branchNodeState(4, "https://x/pull/4", "CLOSED", "2026-07-01T00:00:00Z"),
				branchNodeState(9, "https://x/pull/9", "CLOSED", "2026-07-05T00:00:00Z"), // most recent
			},
			want: 9,
		},
		{
			name: "most-recent within the open class",
			nodes: []string{
				branchNodeState(4, "https://x/pull/4", "OPEN", "2026-07-01T00:00:00Z"),
				branchNodeState(9, "https://x/pull/9", "OPEN", "2026-07-05T00:00:00Z"), // most recent
				branchNodeState(7, "https://x/pull/7", "OPEN", "2026-07-03T00:00:00Z"),
			},
			want: 9,
		},
		{
			name: "lowercase state ranks the same (case-insensitive)",
			nodes: []string{
				branchNodeState(4, "https://x/pull/4", "merged", "2026-07-05T00:00:00Z"),
				branchNodeState(9, "https://x/pull/9", "open", "2026-07-01T00:00:00Z"),
			},
			want: 9,
		},
		{
			name:  "empty result is a valid negative",
			nodes: nil,
			want:  -1,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pr, err := pickBranchPR(branchListJSON(tc.nodes...))
			if err != nil {
				t.Fatalf("unexpected parse error: %v", err)
			}
			if tc.want < 0 {
				if pr != nil {
					t.Fatalf("expected nil (negative), got %v", pr)
				}
				return
			}
			if pr == nil || pr.Number != tc.want {
				t.Fatalf("got %v, want #%d", pr, tc.want)
			}
		})
	}
}

// TestBranchRefresher_RegisterEmptyInputsIgnored: empty repo/branch never enters
// the cache and never triggers an exec.
func TestBranchRefresher_RegisterEmptyInputsIgnored(t *testing.T) {
	calls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		calls++
		return branchListJSON(), nil
	})
	r.Register("", "feat")
	r.Register("/repo", "")
	r.refresh(context.Background())
	if calls != 0 {
		t.Errorf("exec ran %d times for empty-input registrations, want 0", calls)
	}
	if pr, ok := r.Snapshot("", "feat"); ok || pr != nil {
		t.Errorf("empty repoDir: expected no PR")
	}
	if pr, ok := r.Snapshot("/repo", ""); ok || pr != nil {
		t.Errorf("empty branch: expected no PR")
	}
}

// TestBranchRefresher_UnobservedPairAgesOut: a pair no longer re-Registered is
// dropped from the cache after branchPRObservedTTL, so it neither costs a gh call
// nor lingers in the snapshot.
func TestBranchRefresher_UnobservedPairAgesOut(t *testing.T) {
	calls := 0
	r := NewBranchRefresher(branchPRRefreshInterval)
	r.exec = func(context.Context, string, string) ([]byte, error) {
		calls++
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	}
	r.available = func(context.Context) bool { return true }
	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // resolves #4; calls == 1
	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil {
		t.Fatal("expected #4 after first refresh")
	}

	// Advance past the observed TTL WITHOUT re-registering → the pair ages out.
	now = now.Add(branchPRObservedTTL + time.Second)
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
		t.Errorf("aged-out pair should be gone from the snapshot, got ok=%v", ok)
	}
	if calls != 1 {
		t.Errorf("aged-out pair should not be re-resolved: calls=%d, want 1", calls)
	}
}

// TestBranchRefresher_SnapshotNeverExecs: the hot-path join issues zero exec even
// when the pair is registered but not yet resolved (the pre-refresh window).
func TestBranchRefresher_SnapshotNeverExecs(t *testing.T) {
	calls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		calls++
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.Register("/repo", "feat")
	// Many snapshot reads before any refresh — none may exec.
	for i := 0; i < 5; i++ {
		if pr, ok := r.Snapshot("/repo", "feat"); ok || pr != nil {
			t.Fatalf("pre-refresh snapshot must be empty, got ok=%v", ok)
		}
	}
	if calls != 0 {
		t.Errorf("Snapshot issued %d exec calls, want 0 (join is pure)", calls)
	}
}

// TestPickBranchPR_SkipsEmptyURL ensures a URL-less node (malformed/partial gh
// JSON) is skipped so it can never key the live-status join.
func TestPickBranchPR_SkipsEmptyURL(t *testing.T) {
	out := branchListJSON(
		`{"number":1,"url":"","updatedAt":"2026-07-09T00:00:00Z"}`,
		branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z"),
	)
	pr, err := pickBranchPR(out)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if pr == nil || pr.Number != 4 {
		t.Fatalf("expected #4 (URL-less node skipped), got %v", pr)
	}
}

// TestBranchRefresher_DefaultBranchExcluded: a pair whose branch is the repo's
// default branch is excluded — the branch-list gh query is NEVER run for it, and
// Snapshot returns (nil, false).
func TestBranchRefresher_DefaultBranchExcluded(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNodeState(480, "https://x/pull/480", "MERGED", "2026-07-16T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return defaultBranchRefOutput("main"), nil
	}

	r.Register("/repo", "main")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "main"); ok || pr != nil {
		t.Errorf("default-branch pair must resolve to a negative, got ok=%v pr=%v", ok, pr)
	}
	if ghCalls != 0 {
		t.Errorf("gh pr list ran %d times for a default-branch pair, want 0", ghCalls)
	}
}

// TestBranchRefresher_DefaultBranchClearsStalePositive: the live-bug regression
// (fab-kit main → #480). An entry already holding a positive PR is CLEARED to a
// confirmed negative once its branch is recognized as the default branch —
// exclusion is authoritative, not a transient/skip that would stale-keep the
// wrong PR forever.
func TestBranchRefresher_DefaultBranchClearsStalePositive(t *testing.T) {
	defaultResolves := false
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		// The degenerate fork-PR match: gh keeps returning #480 for --head main.
		return branchListJSON(branchNodeState(480, "https://x/pull/480", "MERGED", "2026-07-16T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		if !defaultResolves {
			// First pass: origin/HEAD not yet resolvable → fail-open, gh runs,
			// the stale #480 gets cached (models the pre-fix / pre-ref state).
			return nil, errors.New("origin/HEAD unset")
		}
		return defaultBranchRefOutput("main"), nil
	}

	r.Register("/repo", "main")
	r.refresh(context.Background()) // fail-open: caches the stale positive #480
	if pr, ok := r.Snapshot("/repo", "main"); !ok || pr == nil || pr.Number != 480 {
		t.Fatalf("precondition: stale #480 should be cached after fail-open pass, got ok=%v pr=%v", ok, pr)
	}

	// origin/HEAD now resolves; advance past the default-branch cache TTL so the
	// verdict is re-probed and the exclusion applies.
	defaultResolves = true
	base := time.Unix(1_000_000, 0).Add(branchDefaultBranchTTL + time.Second)
	r.now = func() time.Time { return base }
	r.Register("/repo", "main")
	r.refresh(context.Background()) // now excluded → clears the stale positive

	if pr, ok := r.Snapshot("/repo", "main"); ok || pr != nil {
		t.Errorf("stale #480 must be cleared once main is recognized as the default branch, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_ExclusionIsBranchScoped: a feature-branch pair in the SAME
// repo still resolves normally when a sibling default-branch pair is excluded —
// the exclusion is branch-scoped, not repo-scoped.
func TestBranchRefresher_ExclusionIsBranchScoped(t *testing.T) {
	r := newTestRefresher(true, func(_ context.Context, _ string, branch string) ([]byte, error) {
		// gh would (degenerately) match main too, but it must never be asked for it.
		if branch == "main" {
			t.Fatalf("gh pr list must not run for the excluded default branch")
		}
		return branchListJSON(branchNode(7, "https://x/pull/7", "2026-07-01T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return defaultBranchRefOutput("main"), nil
	}

	r.Register("/repo", "main")
	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "main"); ok || pr != nil {
		t.Errorf("default-branch pair must be excluded, got ok=%v pr=%v", ok, pr)
	}
	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 7 {
		t.Errorf("feature-branch pair must resolve normally, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_DefaultBranchLookupFailsOpen: when the default-branch
// lookup fails (unset origin/HEAD, no origin, git error), the pair resolves via
// gh exactly as today (fail-open), and the failure verdict is CACHED — a second
// pass within the TTL does not re-probe git symbolic-ref.
func TestBranchRefresher_DefaultBranchLookupFailsOpen(t *testing.T) {
	defaultCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		defaultCalls++
		return nil, errors.New("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref")
	}

	r.Register("/repo", "main")
	r.refresh(context.Background())
	r.refresh(context.Background()) // second pass, same (cached) clock

	if pr, ok := r.Snapshot("/repo", "main"); !ok || pr == nil || pr.Number != 4 {
		t.Errorf("fail-open: pair must resolve via gh, got ok=%v pr=%v", ok, pr)
	}
	if defaultCalls != 1 {
		t.Errorf("git symbolic-ref probed %d times across two passes, want 1 (failure cached)", defaultCalls)
	}
}

// TestBranchRefresher_DefaultBranchCachedPerRepo: N pairs in one repo cost ONE
// default-branch lookup per pass/TTL window (not one per pair), mirroring the
// availability-cache call-count style.
func TestBranchRefresher_DefaultBranchCachedPerRepo(t *testing.T) {
	defaultCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		defaultCalls++
		return defaultBranchRefOutput("main"), nil
	}

	// Several feature-branch pairs in the same repo (none is the default branch).
	r.Register("/repo", "feat-a")
	r.Register("/repo", "feat-b")
	r.Register("/repo", "feat-c")
	r.refresh(context.Background())

	if defaultCalls != 1 {
		t.Errorf("default-branch lookup ran %d times for 3 pairs in one repo, want 1 (per-repo cached)", defaultCalls)
	}

	// A second pass within the TTL adds no further lookups.
	r.refresh(context.Background())
	if defaultCalls != 1 {
		t.Errorf("default-branch lookup ran %d times across two passes, want 1 (verdict cached)", defaultCalls)
	}
}

// TestBranchRefresher_DefaultBranchReprobedAfterTTL: once the cached
// default-branch verdict ages past branchDefaultBranchTTL, the next pass
// re-probes git symbolic-ref.
func TestBranchRefresher_DefaultBranchReprobedAfterTTL(t *testing.T) {
	defaultCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		defaultCalls++
		return defaultBranchRefOutput("main"), nil
	}

	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // probe #1
	now = now.Add(branchDefaultBranchTTL + time.Second)
	r.Register("/repo", "feat")     // keep the pair alive past its observed-TTL
	r.refresh(context.Background()) // verdict stale → probe #2

	if defaultCalls != 2 {
		t.Errorf("default-branch probed %d times, want 2 (re-probe after TTL)", defaultCalls)
	}
}

// TestBranchRefresher_DefaultBranchExcludedWhenGhUnavailable: the default-branch
// exclusion needs only local `git symbolic-ref`, so it MUST run — and clear a
// stale positive — even when gh is unavailable. This is the live-bug edge: if gh
// goes down, the #480 fork-PR match must still disappear once main is recognized
// as the default branch (the exclusion is not gated behind gh availability).
func TestBranchRefresher_DefaultBranchExcludedWhenGhUnavailable(t *testing.T) {
	ghCalls := 0
	// gh is AVAILABLE for the first pass (so the stale positive gets cached), then
	// flips unavailable — the exclusion must still clear it.
	ghUp := true
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNodeState(480, "https://x/pull/480", "MERGED", "2026-07-16T00:00:00Z")), nil
	})
	r.available = func(context.Context) bool { return ghUp }
	// origin/HEAD does not resolve on the first pass (fail-open → gh caches #480),
	// then resolves to main so the exclusion applies.
	defaultResolves := false
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		if !defaultResolves {
			return nil, errors.New("origin/HEAD unset")
		}
		return defaultBranchRefOutput("main"), nil
	}
	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "main")
	r.refresh(context.Background()) // fail-open + gh up → caches stale #480
	if pr, ok := r.Snapshot("/repo", "main"); !ok || pr == nil || pr.Number != 480 {
		t.Fatalf("precondition: stale #480 should be cached, got ok=%v pr=%v", ok, pr)
	}

	// gh goes DOWN and origin/HEAD now resolves; advance past both TTLs so the
	// availability verdict re-probes (negative) and the default-branch verdict
	// re-probes (main). The exclusion must clear #480 despite gh being down.
	ghUp = false
	defaultResolves = true
	now = now.Add(branchDefaultBranchTTL + branchPRAvailabilityTTL + time.Second)
	r.now = func() time.Time { return now }
	r.Register("/repo", "main")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "main"); ok || pr != nil {
		t.Errorf("stale #480 must be cleared by the exclusion even when gh is down, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_DefaultBranchPrunedWhenRepoUnobserved: the per-repo
// default-branch cache must not grow unbounded. Once a repo has no live pair AND
// its verdict has aged past branchDefaultBranchTTL, the entry is pruned during the
// age-out pass (symmetric with the per-pair observed-TTL age-out).
func TestBranchRefresher_DefaultBranchPrunedWhenRepoUnobserved(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return defaultBranchRefOutput("main"), nil
	}
	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	// Observe a feature-branch pair once → its repo's default-branch verdict is cached.
	r.Register("/repo", "feat")
	r.refresh(context.Background())
	r.mu.RLock()
	_, cached := r.defaultBranches["/repo"]
	r.mu.RUnlock()
	if !cached {
		t.Fatalf("precondition: /repo default-branch verdict should be cached after a refresh")
	}

	// Stop observing the pair and advance past both the observed-TTL (so the pair
	// ages out) and the default-branch TTL (so the verdict is prune-eligible).
	now = now.Add(branchPRObservedTTL + branchDefaultBranchTTL + time.Second)
	r.now = func() time.Time { return now }
	r.refresh(context.Background()) // pair ages out; unobserved+stale repo verdict is pruned

	r.mu.RLock()
	_, stillCached := r.defaultBranches["/repo"]
	r.mu.RUnlock()
	if stillCached {
		t.Errorf("default-branch verdict for an unobserved, aged-out repo must be pruned")
	}
}

// TestParseDefaultBranch covers the symbolic-ref output parser: the expected
// prefix is stripped and whitespace trimmed; anything else is a lookup failure.
func TestParseDefaultBranch(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		wantName string
		wantOK   bool
	}{
		{"main with trailing newline", "refs/remotes/origin/main\n", "main", true},
		{"master", "refs/remotes/origin/master\n", "master", true},
		{"slashed branch name preserved", "refs/remotes/origin/release/2.0\n", "release/2.0", true},
		{"surrounding whitespace trimmed", "  refs/remotes/origin/main  \n", "main", true},
		{"missing prefix is a failure", "main\n", "", false},
		{"empty output is a failure", "", "", false},
		{"prefix only (empty name) is a failure", "refs/remotes/origin/\n", "", false},
		{"unrelated ref is a failure", "refs/heads/main\n", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			name, ok := parseDefaultBranch([]byte(tc.in))
			if name != tc.wantName || ok != tc.wantOK {
				t.Errorf("parseDefaultBranch(%q) = (%q, %v), want (%q, %v)", tc.in, name, ok, tc.wantName, tc.wantOK)
			}
		})
	}
}

// --- registration wake seam (260807-2ept) ---------------------------------------

// TestBranchRefresher_RegisterFirstSightSignalsWakeOnce: a FIRST-SIGHT pair wakes
// the refresher; re-observing a known pair (which every 2.5s SSE enrichment pass
// does for every pair) must NOT — otherwise the wake would degenerate the 30s
// refresher into a 2.5s gh poll.
func TestBranchRefresher_RegisterFirstSightSignalsWakeOnce(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})

	r.Register("/repo", "feat")
	if got := drainWake(r); got != 1 {
		t.Fatalf("first-sight registration signalled %d wakes, want 1", got)
	}

	// Re-registrations of the SAME pair must be silent.
	for i := 0; i < 5; i++ {
		r.Register("/repo", "feat")
	}
	if got := drainWake(r); got != 0 {
		t.Errorf("re-registration signalled %d wakes, want 0", got)
	}

	// A different pair is first-sight again → one wake.
	r.Register("/repo", "other")
	if got := drainWake(r); got != 1 {
		t.Errorf("new pair signalled %d wakes, want 1", got)
	}
}

// TestBranchRefresher_RegisterWakeCoalesces: a burst of first-sight registrations
// leaves exactly ONE pending wake (capacity-1 channel, non-blocking send), and no
// Register call blocks — the hot-path safety property.
func TestBranchRefresher_RegisterWakeCoalesces(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	for i := 0; i < 50; i++ {
		r.Register("/repo", "feat-"+strconv.Itoa(i))
	}
	if got := drainWake(r); got != 1 {
		t.Errorf("50 first-sight registrations left %d pending wakes, want 1 (coalesced)", got)
	}
}

// TestBranchRefresher_RegisterEmptyInputsDoNotWake: an ignored registration must
// not wake the refresher either (it creates no entry to resolve).
func TestBranchRefresher_RegisterEmptyInputsDoNotWake(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	r.Register("", "feat")
	r.Register("/repo", "")
	if got := drainWake(r); got != 0 {
		t.Errorf("empty-input registrations signalled %d wakes, want 0", got)
	}
}

// TestBranchRefresher_SettleDrainsWakes: settle waits out the debounce window and
// absorbs wakes arriving inside it, so the burst becomes one pass.
func TestBranchRefresher_SettleDrainsWakes(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	r.wakeDebounce = 10 * time.Millisecond
	r.signalWake()

	if !r.settle(context.Background()) {
		t.Fatal("settle should report the window elapsed")
	}
	if got := drainWake(r); got != 0 {
		t.Errorf("settle left %d pending wakes, want 0 (drained)", got)
	}
}

// TestBranchRefresher_SettleHonorsContextCancel: a ctx cancellation during the
// settle window aborts the pass (the Start loop then exits) rather than
// refreshing on a dead context.
func TestBranchRefresher_SettleHonorsContextCancel(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	r.wakeDebounce = time.Hour // long enough that only the cancel can return
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r.settle(ctx) {
		t.Error("settle must report false on a cancelled context")
	}
}

// TestBranchRefresher_WakeBurstDrivesExactlyOneExtraPass: the cold-start
// contract. A burst of first-sight registrations drives ONE additional refresh
// pass, not one per registration — proved by exec counts on a started refresher
// whose ticker is an hour out (so only the wake can drive a pass).
//
// The burst is registered BEFORE Start so the count is deterministic: the
// immediate first refresh resolves all three pairs (3 execs) and the single
// buffered wake drives exactly one more pass (3 more execs). A per-registration
// wake would instead produce three extra passes.
func TestBranchRefresher_WakeBurstDrivesExactlyOneExtraPass(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	reached := make(chan struct{})
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		mu.Lock()
		calls++
		if calls == 6 {
			close(reached)
		}
		mu.Unlock()
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.interval = time.Hour // the steady-state ticker must never fire in this test
	r.wakeDebounce = 5 * time.Millisecond

	r.Register("/repo", "a")
	r.Register("/repo", "b")
	r.Register("/repo", "c")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	select {
	case <-reached:
	case <-time.After(5 * time.Second):
		mu.Lock()
		got := calls
		mu.Unlock()
		t.Fatalf("wake did not drive a second pass: exec calls = %d, want 6", got)
	}

	// Nothing further may run — no new pair, and the ticker is an hour out.
	time.Sleep(20 * r.wakeDebounce)
	mu.Lock()
	got := calls
	mu.Unlock()
	if got != 6 {
		t.Errorf("exec calls = %d, want exactly 6 (initial pass + ONE coalesced wake pass)", got)
	}
}

// --- viewer head-index join (260807-2ept) ---------------------------------------

// withOrigin points the refresher's origin seam at a fixed remote URL and returns
// a pointer to the call counter, so tests can assert lookup frequency.
func withOrigin(r *BranchRefresher, url string) *int {
	calls := 0
	r.originExec = func(context.Context, string) ([]byte, error) {
		calls++
		return originURLOutput(url), nil
	}
	return &calls
}

// TestBranchRefresher_IndexHitSkipsGh: a pair covered by the seeded viewer index
// resolves from the batch with ZERO `gh pr list` subprocesses — the mechanism that
// collapses an N-sequential-gh pass into a join.
func TestBranchRefresher_IndexHitSkipsGh(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(), nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(538, ghPRURL("sahil87/run-kit", 538), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 538 {
		t.Fatalf("index hit must resolve the pair, got ok=%v pr=%v", ok, pr)
	}
	if ghCalls != 0 {
		t.Errorf("gh pr list ran %d times for an index hit, want 0", ghCalls)
	}
}

// TestBranchRefresher_IndexHitPrecedence: indexed candidates are ranked by the
// SAME precedence as gh results — open > merged > closed across classes,
// most-recently-updated within a class.
func TestBranchRefresher_IndexHitPrecedence(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh must not run for an index hit")
		return nil, nil
	})
	withOrigin(r, "https://github.com/sahil87/run-kit.git")
	seedIndex(r,
		// A newer MERGED PR must lose to an older OPEN one (state class beats
		// recency across classes — the branch-reuse edge).
		viewerPR(1, ghPRURL("sahil87/run-kit", 1), "MERGED", "sahil87/run-kit", "feat", ts(t, "2026-08-05T00:00:00Z")),
		viewerPR(2, ghPRURL("sahil87/run-kit", 2), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")),
		viewerPR(3, ghPRURL("sahil87/run-kit", 3), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-03T00:00:00Z")),
	)

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 3 {
		t.Fatalf("want #3 (most-recent OPEN), got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_IndexHitResolvesWhenGhUnavailable: the index join needs no
// gh at all, so a covered pair still resolves while gh is down/unauthenticated.
func TestBranchRefresher_IndexHitResolvesWhenGhUnavailable(t *testing.T) {
	r := newTestRefresher(false, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh must not run when unavailable")
		return nil, nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(9, ghPRURL("sahil87/run-kit", 9), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 9 {
		t.Errorf("index hit must resolve without gh, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_IndexMissFallsBackToGh: a pair the batch does not cover
// (here: a branch with no indexed candidate) falls through to the existing
// per-pair gh path unchanged.
func TestBranchRefresher_IndexMissFallsBackToGh(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNode(77, "https://x/pull/77", "2026-08-01T00:00:00Z")), nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	// Indexed under a DIFFERENT branch, so the pair misses.
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "other", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 77 {
		t.Fatalf("index miss must fall back to gh, got ok=%v pr=%v", ok, pr)
	}
	if ghCalls != 1 {
		t.Errorf("gh pr list ran %d times on an index miss, want 1", ghCalls)
	}
}

// TestBranchRefresher_ForkHeadMismatchFallsBackToGh: a fork PR's headRepository is
// the FORK, not the pane repo's origin, so it misses the identity join and must
// fall back to gh rather than resolving off a wrong-repo candidate.
func TestBranchRefresher_ForkHeadMismatchFallsBackToGh(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNode(77, "https://x/pull/77", "2026-08-01T00:00:00Z")), nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	// Same branch name, but the head lives in a fork of a different owner.
	seedIndex(r, viewerPR(5, ghPRURL("someone-else/run-kit", 5), "OPEN", "someone-else/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 77 {
		t.Fatalf("fork-head mismatch must fall back to gh, got ok=%v pr=%v", ok, pr)
	}
	if ghCalls != 1 {
		t.Errorf("gh pr list ran %d times on a fork identity mismatch, want 1", ghCalls)
	}
}

// TestBranchRefresher_HostMismatchFallsBackToGh: identity is HOST-QUALIFIED, so a
// pane whose origin lives on gitlab.com must MISS a same-`owner/name` github.com
// viewer PR (and fall back to the authoritative gh path) rather than attach a
// wrong-forge PR link. `owner/name` is not unique across forges.
func TestBranchRefresher_HostMismatchFallsBackToGh(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNode(77, "https://gitlab.com/sahil87/tool/-/merge_requests/77", "2026-08-01T00:00:00Z")), nil
	})
	withOrigin(r, "git@gitlab.com:sahil87/tool.git")
	// Same owner/name and branch — but the indexed PR is hosted on github.com.
	seedIndex(r, viewerPR(5, ghPRURL("sahil87/tool", 5), "OPEN", "sahil87/tool", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	pr, ok := r.Snapshot("/repo", "feat")
	if !ok || pr == nil || pr.Number != 77 {
		t.Fatalf("host mismatch must fall back to gh, got ok=%v pr=%v", ok, pr)
	}
	if ghCalls != 1 {
		t.Errorf("gh pr list ran %d times on a host mismatch, want 1", ghCalls)
	}
}

// TestBranchRefresher_GHEHostJoins: the qualification is a match rule, not a
// github.com-only rule — a GHE pane joins its OWN host's viewer PR.
func TestBranchRefresher_GHEHostJoins(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh must not run for an index hit")
		return nil, nil
	})
	withOrigin(r, "https://ghe.corp.example/sahil87/tool.git")
	seedIndex(r, viewerPR(31, prURL("ghe.corp.example", "sahil87/tool", 31), "OPEN", "sahil87/tool", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 31 {
		t.Errorf("same-host GHE pair must join the index, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_IndexRepoIdentityCaseInsensitive: GitHub repo identities are
// case-insensitive (and nameWithOwner returns the canonical case), so an origin
// URL typed in a different case must still join.
func TestBranchRefresher_IndexRepoIdentityCaseInsensitive(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh must not run for an index hit")
		return nil, nil
	})
	withOrigin(r, "git@github.com:Sahil87/Run-Kit.git")
	seedIndex(r, viewerPR(12, ghPRURL("sahil87/run-kit", 12), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 12 {
		t.Errorf("case-differing origin must still join, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_IndexMissNeverWritesNegative: the batch covers only
// viewer-authored PRs inside its top-limit window, so it cannot prove "no PR".
// A miss must therefore leave a last-good positive entry intact when the gh
// fallback cannot run (gh down) — never downgrade it to a negative.
func TestBranchRefresher_IndexMissNeverWritesNegative(t *testing.T) {
	ghUp := true
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	r.available = func(context.Context) bool { return ghUp }
	withOrigin(r, "git@github.com:sahil87/run-kit.git")

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // gh resolves #4 (no index yet)
	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 4 {
		t.Fatalf("precondition: #4 should be cached, got ok=%v pr=%v", ok, pr)
	}

	// A seeded index that does NOT cover this pair, plus gh down: the miss must be
	// a pass-through, not a negative.
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/other", 1), "OPEN", "sahil87/other", "feat", ts(t, "2026-08-01T00:00:00Z")))
	ghUp = false
	now := time.Unix(1_000_000, 0).Add(branchPRAvailabilityTTL + time.Second)
	r.now = func() time.Time { return now }
	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 4 {
		t.Errorf("an index miss must never clear a last-good entry, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_DefaultBranchExclusionOutranksIndexHit: the exclusion stays
// FIRST and authoritative — a default-branch pane resolves to a negative even when
// the viewer index holds a candidate for that head (the degenerate
// same-head-as-default case).
func TestBranchRefresher_DefaultBranchExclusionOutranksIndexHit(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh must not run for an excluded default-branch pair")
		return nil, nil
	})
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return defaultBranchRefOutput("main"), nil
	}
	originCalls := withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(480, ghPRURL("sahil87/run-kit", 480), "MERGED", "sahil87/run-kit", "main", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "main")
	r.refresh(context.Background())

	if pr, ok := r.Snapshot("/repo", "main"); ok || pr != nil {
		t.Errorf("default-branch exclusion must outrank an index hit, got ok=%v pr=%v", ok, pr)
	}
	if *originCalls != 0 {
		t.Errorf("origin identity resolved %d times for an excluded pair, want 0 (exclusion short-circuits first)", *originCalls)
	}
}

// TestBranchRefresher_UnseededIndexSkipsOriginLookup: with no index stored (an
// unwired collector, or before its first fetch lands) the join short-circuits
// BEFORE resolving origin identity, so it costs no `git remote get-url`.
func TestBranchRefresher_UnseededIndexSkipsOriginLookup(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	originCalls := withOrigin(r, "git@github.com:sahil87/run-kit.git")

	r.Register("/repo", "feat")
	r.refresh(context.Background())

	if *originCalls != 0 {
		t.Errorf("origin identity resolved %d times with no index seeded, want 0", *originCalls)
	}
	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 4 {
		t.Errorf("pair must still resolve via gh, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_StoredIndexServesLaterPasses: the index is STORED (not
// consumed once), so every later pass keeps joining against it with no gh call —
// this is what removes the steady-state O(N)-subprocess volume.
func TestBranchRefresher_StoredIndexServesLaterPasses(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(), nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(538, ghPRURL("sahil87/run-kit", 538), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	for i := 0; i < 3; i++ {
		r.Register("/repo", "feat") // as a live window does every SSE tick
		r.refresh(context.Background())
		if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 538 {
			t.Fatalf("pass %d: index hit lost, got ok=%v pr=%v", i, ok, pr)
		}
	}
	if ghCalls != 0 {
		t.Errorf("gh pr list ran %d times across 3 index-covered passes, want 0", ghCalls)
	}
}

// TestStoreViewerIndexSkipsUnjoinableNodes: nodes with no URL, no URL host, no
// head ref, or no head repository carry no joinable identity and must never enter
// the index. The URL host matters because the index key is host-qualified — a node
// whose URL yields no host cannot be placed on a forge.
func TestStoreViewerIndexSkipsUnjoinableNodes(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	seedIndex(r,
		viewerPR(1, "", "OPEN", "o/r", "feat", ts(t, "2026-08-01T00:00:00Z")),                // no URL
		viewerPR(2, ghPRURL("o/r", 2), "OPEN", "o/r", "", ts(t, "2026-08-01T00:00:00Z")),     // no head ref
		viewerPR(3, ghPRURL("", 3), "OPEN", "", "feat", ts(t, "2026-08-01T00:00:00Z")),       // null head repo
		viewerPR(5, "o/r/pull/5", "OPEN", "o/r", "feat", ts(t, "2026-08-01T00:00:00Z")),      // URL carries no host
		viewerPR(4, ghPRURL("o/r", 4), "OPEN", "o/r", "keep", ts(t, "2026-08-01T00:00:00Z")), // joinable
	)

	r.mu.RLock()
	index := r.viewerIndex
	r.mu.RUnlock()
	if len(index) != 1 {
		t.Fatalf("index holds %d keys, want 1 (only the joinable node): %v", len(index), index)
	}
	if got := index[viewerIndexKey("github.com/o/r", "keep")]; len(got) != 1 || got[0].Number != 4 {
		t.Errorf("index entry = %v, want only #4", got)
	}
}

// TestStoreViewerIndexReplacesWholesale: a re-seed REPLACES the index (mirroring
// the collector's byURL rebuild) — a candidate that aged out of the batch stops
// being joinable, with no eviction logic.
func TestStoreViewerIndexReplacesWholesale(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	seedIndex(r, viewerPR(1, ghPRURL("o/r", 1), "OPEN", "o/r", "old", ts(t, "2026-08-01T00:00:00Z")))
	seedIndex(r, viewerPR(2, ghPRURL("o/r", 2), "OPEN", "o/r", "new", ts(t, "2026-08-02T00:00:00Z")))

	r.mu.RLock()
	index := r.viewerIndex
	r.mu.RUnlock()
	if _, ok := index[viewerIndexKey("github.com/o/r", "old")]; ok {
		t.Error("stale candidate must be gone after a wholesale re-seed")
	}
	if _, ok := index[viewerIndexKey("github.com/o/r", "new")]; !ok {
		t.Error("re-seeded candidate missing")
	}
}

// --- wake-on-store (260807-2ept, rework cycle 1) --------------------------------

// TestBranchRefresher_StoreViewerIndexSignalsWake: storing a NON-EMPTY index
// signals the same coalescing wake Register uses, so a seed landing after the
// first registrations still drives a debounced pass. An EMPTY store signals
// nothing — there would be no index to serve the pass from, so the wake would only
// buy a `gh pr list` per registered pair.
func TestBranchRefresher_StoreViewerIndexSignalsWake(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	candidate := viewerPR(1, ghPRURL("o/r", 1), "OPEN", "o/r", "feat", ts(t, "2026-08-01T00:00:00Z"))

	seedIndex(r, candidate)
	if got := drainWake(r); got != 1 {
		t.Fatalf("non-empty store signalled %d wakes, want 1", got)
	}

	// Repeated stores coalesce onto one pending wake (capacity-1, non-blocking send).
	for i := 0; i < 5; i++ {
		seedIndex(r, candidate)
	}
	if got := drainWake(r); got != 1 {
		t.Errorf("5 stores left %d pending wakes, want 1 (coalesced)", got)
	}

	seedIndex(r) // empty batch
	if got := drainWake(r); got != 0 {
		t.Errorf("empty store signalled %d wakes, want 0", got)
	}
	// Every node unjoinable ⇒ an empty index ⇒ still no wake.
	seedIndex(r, viewerPR(2, "", "OPEN", "o/r", "feat", ts(t, "2026-08-01T00:00:00Z")))
	if got := drainWake(r); got != 0 {
		t.Errorf("all-unjoinable store signalled %d wakes, want 0", got)
	}
}

// TestBranchRefresher_SeedAfterRegistrationDrivesIndexServedPass: the PRODUCTION
// ordering (and the restart path). SSE registrations can land BEFORE the
// collector's first batched fetch completes, so the SEED itself must wake the
// refresher — wiring order alone cannot guarantee an index-served pass, because
// the collector's first refresh finishes at an unpredictable time relative to the
// first registrations.
//
// The ticker is set an hour out so ONLY a wake can drive a pass. The burst is
// registered before Start, making the pre-seed pass count deterministic (the
// immediate pass plus one coalesced wake pass, each resolving all three pairs via
// gh while the index is empty). The seed then drives EXACTLY ONE further pass,
// which resolves every pair from the index with ZERO additional gh calls.
func TestBranchRefresher_SeedAfterRegistrationDrivesIndexServedPass(t *testing.T) {
	var mu sync.Mutex
	ghCalls, clockReads := 0, 0
	preSeedDone := make(chan struct{})
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		mu.Lock()
		ghCalls++
		if ghCalls == 6 {
			close(preSeedDone)
		}
		mu.Unlock()
		return branchListJSON(), nil // no PR on any branch yet → negatives
	})
	r.interval = time.Hour // the steady-state ticker must never fire in this test
	r.wakeDebounce = 5 * time.Millisecond
	withOrigin(r, "git@github.com:sahil87/run-kit.git")

	// refresh() takes exactly ONE clock read (at the top of the pass), so counting
	// clock reads counts passes. Register reads the clock too, but every Register
	// happens before the baseline below is captured, so the delta after it is passes
	// alone.
	base := time.Unix(1_000_000, 0)
	r.now = func() time.Time {
		mu.Lock()
		clockReads++
		mu.Unlock()
		return base
	}

	branches := []string{"a", "b", "c"}
	for _, b := range branches {
		r.Register("/repo", b)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	select {
	case <-preSeedDone:
	case <-time.After(5 * time.Second):
		mu.Lock()
		got := ghCalls
		mu.Unlock()
		t.Fatalf("pre-seed passes did not complete: gh calls = %d, want 6", got)
	}
	time.Sleep(20 * r.wakeDebounce) // let the loop go quiet before sampling
	mu.Lock()
	ghBefore, readsBefore := ghCalls, clockReads
	mu.Unlock()
	if ghBefore != 6 {
		t.Fatalf("pre-seed gh calls = %d, want 6 (initial pass + one coalesced wake pass)", ghBefore)
	}
	for _, b := range branches {
		if pr, ok := r.Snapshot("/repo", b); ok || pr != nil {
			t.Fatalf("precondition: %q must be unresolved before the seed, got %v", b, pr)
		}
	}

	// The seed lands LAST — the ordering that used to leave the refresher asleep
	// until the next 30s tick.
	seedIndex(r,
		viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "a", ts(t, "2026-08-01T00:00:00Z")),
		viewerPR(2, ghPRURL("sahil87/run-kit", 2), "OPEN", "sahil87/run-kit", "b", ts(t, "2026-08-02T00:00:00Z")),
		viewerPR(3, ghPRURL("sahil87/run-kit", 3), "OPEN", "sahil87/run-kit", "c", ts(t, "2026-08-03T00:00:00Z")),
	)

	deadline := time.Now().Add(5 * time.Second)
	for {
		resolved := 0
		for i, b := range branches {
			if pr, ok := r.Snapshot("/repo", b); ok && pr != nil && pr.Number == i+1 {
				resolved++
			}
		}
		if resolved == len(branches) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the seed did not wake the refresher: %d/%d pairs resolved from the index", resolved, len(branches))
		}
		time.Sleep(time.Millisecond)
	}

	time.Sleep(20 * r.wakeDebounce) // nothing further may run
	mu.Lock()
	ghAfter, readsAfter := ghCalls, clockReads
	mu.Unlock()
	if ghAfter != ghBefore {
		t.Errorf("the index-served pass issued %d gh calls, want 0", ghAfter-ghBefore)
	}
	if passes := readsAfter - readsBefore; passes != 1 {
		t.Errorf("the seed drove %d refresh passes, want exactly 1 (debounced)", passes)
	}
}

// --- lazy gh-availability probe (260807-2ept, rework cycle 1) --------------------

// TestBranchRefresher_AvailabilityProbeIsLazy: `gh auth status` is itself a
// subprocess that can burn up to ghTimeout, and neither the default-branch
// exclusion nor the index join needs gh — so a pass resolved entirely by those two
// must issue NO gh subprocess at all, the probe included. Otherwise the
// wake-driven cold-start pass could stall behind a probe whose answer it never
// uses.
func TestBranchRefresher_AvailabilityProbeIsLazy(t *testing.T) {
	availCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		t.Fatal("gh pr list must not run when every pair resolves without gh")
		return nil, nil
	})
	r.available = func(context.Context) bool {
		availCalls++
		return true
	}
	r.defaultExec = func(context.Context, string) ([]byte, error) {
		return defaultBranchRefOutput("main"), nil
	}
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(538, ghPRURL("sahil87/run-kit", 538), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "main") // resolved by the default-branch exclusion
	r.Register("/repo", "feat") // resolved by the index join
	r.refresh(context.Background())

	if availCalls != 0 {
		t.Errorf("availability probed %d times on a pass with no gh fallback, want 0 (lazy)", availCalls)
	}
	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 538 {
		t.Errorf("the index hit must still resolve, got ok=%v pr=%v", ok, pr)
	}
}

// TestBranchRefresher_AvailabilityProbedOnceWhenFallbackReached: the flip side of
// laziness — on a MIXED pass the probe is resolved at the first pair that reaches
// the fallback and memoized for the rest of the pass (never once per pair).
func TestBranchRefresher_AvailabilityProbedOnceWhenFallbackReached(t *testing.T) {
	availCalls, ghCalls := 0, 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNode(77, "https://github.com/sahil87/run-kit/pull/77", "2026-08-01T00:00:00Z")), nil
	})
	r.available = func(context.Context) bool {
		availCalls++
		return true
	}
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(538, ghPRURL("sahil87/run-kit", 538), "OPEN", "sahil87/run-kit", "hit", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "hit")    // index hit — no gh
	r.Register("/repo", "miss-a") // fallback
	r.Register("/repo", "miss-b") // fallback
	r.refresh(context.Background())

	if availCalls != 1 {
		t.Errorf("availability probed %d times on a mixed pass, want 1 (memoized per pass)", availCalls)
	}
	if ghCalls != 2 {
		t.Errorf("gh pr list ran %d times, want 2 (one per index miss)", ghCalls)
	}
}

// --- origin identity cache (260807-2ept) ----------------------------------------

// TestBranchRefresher_OriginCachedPerRepo: N pairs in one repo cost ONE
// `git remote get-url origin` per pass/TTL window, mirroring the default-branch
// and gh-availability caches.
func TestBranchRefresher_OriginCachedPerRepo(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	originCalls := withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "feat-a", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat-a")
	r.Register("/repo", "feat-b")
	r.Register("/repo", "feat-c")
	r.refresh(context.Background())
	if *originCalls != 1 {
		t.Errorf("origin resolved %d times for 3 pairs in one repo, want 1 (per-repo cached)", *originCalls)
	}

	r.refresh(context.Background())
	if *originCalls != 1 {
		t.Errorf("origin resolved %d times across two passes, want 1 (verdict cached)", *originCalls)
	}
}

// TestBranchRefresher_OriginLookupFailsOpenAndIsCached: an origin lookup failure
// falls back to the gh path (fail open) and is CACHED, so a repo without a usable
// origin does not trigger a per-pass `git remote get-url` retry storm.
func TestBranchRefresher_OriginLookupFailsOpenAndIsCached(t *testing.T) {
	ghCalls := 0
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		ghCalls++
		return branchListJSON(branchNode(4, "https://x/pull/4", "2026-07-01T00:00:00Z")), nil
	})
	originCalls := 0
	r.originExec = func(context.Context, string) ([]byte, error) {
		originCalls++
		return nil, errors.New("fatal: No such remote 'origin'")
	}
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	r.Register("/repo", "feat")
	r.refresh(context.Background())
	r.refresh(context.Background()) // same (cached) clock

	if pr, ok := r.Snapshot("/repo", "feat"); !ok || pr == nil || pr.Number != 4 {
		t.Errorf("fail-open: pair must resolve via gh, got ok=%v pr=%v", ok, pr)
	}
	if originCalls != 1 {
		t.Errorf("origin probed %d times across two passes, want 1 (failure cached)", originCalls)
	}
	if ghCalls != 2 {
		t.Errorf("gh ran %d times, want 2 (one per pass — fail-open on both)", ghCalls)
	}
}

// TestBranchRefresher_OriginReprobedAfterTTL: once the cached origin verdict ages
// past branchOriginTTL, the next pass re-probes.
func TestBranchRefresher_OriginReprobedAfterTTL(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	originCalls := withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "feat")
	r.refresh(context.Background()) // probe #1
	now = now.Add(branchOriginTTL + time.Second)
	r.Register("/repo", "feat") // keep the pair alive past its observed TTL
	r.refresh(context.Background())

	if *originCalls != 2 {
		t.Errorf("origin probed %d times, want 2 (re-probe after TTL)", *originCalls)
	}
}

// TestBranchRefresher_OriginPrunedWhenRepoUnobserved: the per-repo origin cache is
// pruned on the same guard as defaultBranches — no live pair AND a verdict aged
// past the TTL — so it cannot grow unbounded (Constitution §II).
func TestBranchRefresher_OriginPrunedWhenRepoUnobserved(t *testing.T) {
	r := newTestRefresher(true, func(context.Context, string, string) ([]byte, error) {
		return branchListJSON(), nil
	})
	withOrigin(r, "git@github.com:sahil87/run-kit.git")
	seedIndex(r, viewerPR(1, ghPRURL("sahil87/run-kit", 1), "OPEN", "sahil87/run-kit", "feat", ts(t, "2026-08-01T00:00:00Z")))

	now := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return now }

	r.Register("/repo", "feat")
	r.refresh(context.Background())
	r.mu.RLock()
	_, cached := r.origins["/repo"]
	r.mu.RUnlock()
	if !cached {
		t.Fatal("precondition: /repo origin verdict should be cached after a refresh")
	}

	now = now.Add(branchPRObservedTTL + branchOriginTTL + time.Second)
	r.now = func() time.Time { return now }
	r.refresh(context.Background()) // pair ages out; unobserved+stale verdict pruned

	r.mu.RLock()
	_, stillCached := r.origins["/repo"]
	r.mu.RUnlock()
	if stillCached {
		t.Error("origin verdict for an unobserved, aged-out repo must be pruned")
	}
}

// TestParseOriginRepo covers origin-URL normalization to the HOST-QUALIFIED
// `host/owner/name` identity the viewer head-index is keyed by, across every form
// git emits — and the rejections. Two rejection families matter:
//
//   - filesystem paths (absolute, relative, `file://`, `~`) have no forge identity
//     at all and must fail open rather than yield a bogus `parent/dir`;
//   - a DOTTED first path segment is not evidence of a host — `cache.local/acme/tool`
//     as a relative path is a directory, not a remote — so only an explicit scheme
//     or the scp-like `user@host:` colon qualifies.
func TestParseOriginRepo(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		wantRepo string
		wantOK   bool
	}{
		{"https with .git", "https://github.com/sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"https without .git", "https://github.com/sahil87/run-kit\n", "github.com/sahil87/run-kit", true},
		{"https with trailing slash", "https://github.com/sahil87/run-kit/\n", "github.com/sahil87/run-kit", true},
		{"scp-like git@", "git@github.com:sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"scp-like without .git", "git@github.com:sahil87/run-kit\n", "github.com/sahil87/run-kit", true},
		{"ssh scheme", "ssh://git@github.com/sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"ssh scheme with port", "ssh://git@github.com:22/sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"git scheme", "git://github.com/sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"https with credentials in authority", "https://user@github.com/sahil87/run-kit.git\n", "github.com/sahil87/run-kit", true},
		{"self-hosted host", "https://git.example.org/team/tool.git\n", "git.example.org/team/tool", true},
		// The two host-mismatch families the qualification exists for: same
		// owner/name, different forge.
		{"gitlab host qualified", "git@gitlab.com:sahil87/tool.git\n", "gitlab.com/sahil87/tool", true},
		{"GHE host qualified", "https://ghe.corp.example/sahil87/tool.git\n", "ghe.corp.example/sahil87/tool", true},
		{"surrounding whitespace trimmed", "  git@github.com:sahil87/run-kit.git  \n", "github.com/sahil87/run-kit", true},
		{"case preserved (folded at key time)", "git@github.com:Sahil87/Run-Kit.git\n", "github.com/Sahil87/Run-Kit", true},
		{"absolute filesystem path rejected", "/srv/mirrors/run-kit\n", "", false},
		{"relative filesystem path rejected", "../sibling/run-kit\n", "", false},
		{"dotted relative path is not a host", "cache.local/acme/tool\n", "", false},
		{"dotted relative path with ./ prefix rejected", "./cache.local/acme/tool\n", "", false},
		{"file scheme rejected", "file:///srv/mirrors/acme/tool\n", "", false},
		{"home-relative path rejected", "~/repos/acme/tool\n", "", false},
		{"schemeless host:path rejected (no userinfo)", "github.com:sahil87/run-kit\n", "", false},
		{"scp-like with absolute path rejected", "git@myhost:/srv/mirrors/tool\n", "", false},
		{"empty output rejected", "", "", false},
		{"host only rejected", "https://github.com/\n", "", false},
		{"authority with no path rejected", "https://github.com\n", "", false},
		{"host plus single segment rejected", "https://github.com/sahil87\n", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo, ok := parseOriginRepo([]byte(tc.in))
			if repo != tc.wantRepo || ok != tc.wantOK {
				t.Errorf("parseOriginRepo(%q) = (%q, %v), want (%q, %v)", tc.in, repo, ok, tc.wantRepo, tc.wantOK)
			}
		})
	}
}

// TestMapBranchState: the branch-fallback state mapper collapses GitHub's enum to
// the frontend's lowercase display value, case-insensitively, and maps
// unknown/empty to "" (NOT "open") so an unconfident branch fallback never wrongly
// owns the status dot.
func TestMapBranchState(t *testing.T) {
	cases := map[string]string{
		"OPEN":    "open",
		"open":    "open",
		"MERGED":  "merged",
		"Merged":  "merged",
		"CLOSED":  "closed",
		"closed":  "closed",
		"":        "",
		"UNKNOWN": "", // future enum value must not default to "open"
	}
	for in, want := range cases {
		if got := MapBranchState(in); got != want {
			t.Errorf("MapBranchState(%q) = %q, want %q", in, got, want)
		}
	}
}
