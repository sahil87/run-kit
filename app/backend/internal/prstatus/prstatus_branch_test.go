package prstatus

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"
)

// newTestRefresher builds a BranchRefresher with injected exec/available seams
// and a controllable clock, so tests drive resolution deterministically without
// a real gh binary, the background goroutine, or wall-clock timing.
func newTestRefresher(available bool, exec func(ctx context.Context, repoDir, branch string) ([]byte, error)) *BranchRefresher {
	r := NewBranchRefresher(branchPRRefreshInterval)
	r.exec = exec
	r.available = func(context.Context) bool { return available }
	// Fixed clock; tests advance it via r.now reassignment when they need TTL math.
	base := time.Unix(1_000_000, 0)
	r.now = func() time.Time { return base }
	return r
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
