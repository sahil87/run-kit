package prstatus

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"
)

// ghJSON builds a minimal gh GraphQL response body for the given PR nodes.
// Each node is the raw JSON for one PR (see ghFixture).
func ghJSON(nodes string) []byte {
	return []byte(`{"data":{"viewer":{"pullRequests":{"nodes":[` + nodes + `]}}}}`)
}

// ghFixture renders one PR node with the given fields.
func ghFixture(number int, url, state string, isDraft bool, rollup, review string) string {
	draft := "false"
	if isDraft {
		draft = "true"
	}
	rollupJSON := "null"
	if rollup != "" {
		rollupJSON = `{"state":"` + rollup + `"}`
	}
	return `{"number":` + strconv.Itoa(number) +
		`,"url":"` + url +
		`","state":"` + state +
		`","isDraft":` + draft +
		`,"reviewDecision":"` + review +
		`","commits":{"nodes":[{"commit":{"statusCheckRollup":` + rollupJSON + `}}]}}`
}

// newTestCollector builds a collector whose gh availability is forced true and
// whose gh exec is stubbed with the supplied function.
func newTestCollector(exec func(ctx context.Context) ([]byte, error)) *Collector {
	c := NewCollector(time.Hour)
	c.available = func(context.Context) bool { return true }
	c.ghExec = exec
	return c
}

func TestRefreshBuildsSnapshot(t *testing.T) {
	c := newTestCollector(func(context.Context) ([]byte, error) {
		return ghJSON(
			ghFixture(386, "https://example/pull/386", "OPEN", false, "SUCCESS", "APPROVED"),
		), nil
	})
	c.refresh(context.Background())

	snap := c.Snapshot()
	got, ok := snap["https://example/pull/386"]
	if !ok {
		t.Fatalf("PR #386 missing from snapshot: %v", snap)
	}
	if got.URL != "https://example/pull/386" {
		t.Errorf("URL = %q", got.URL)
	}
	if got.State != "open" {
		t.Errorf("State = %q, want open", got.State)
	}
	if got.Checks != "pass" {
		t.Errorf("Checks = %q, want pass", got.Checks)
	}
	if got.ReviewDecision != "approved" {
		t.Errorf("ReviewDecision = %q, want approved", got.ReviewDecision)
	}
	if got.FetchedAt.IsZero() {
		t.Error("FetchedAt not set")
	}
}

func TestRefreshWholesaleRebuildDropsAbsentPR(t *testing.T) {
	// First cycle: two PRs present.
	out := ghJSON(
		ghFixture(100, "u100", "OPEN", false, "SUCCESS", "") + "," +
			ghFixture(200, "u200", "OPEN", false, "PENDING", ""),
	)
	c := newTestCollector(func(context.Context) ([]byte, error) { return out, nil })
	c.refresh(context.Background())
	if snap := c.Snapshot(); len(snap) != 2 || snap["u100"].Number != 100 || snap["u200"].Number != 200 {
		t.Fatalf("first cycle snapshot = %v, want #100 and #200", snap)
	}

	// Second cycle: #100 is simply absent from the fetch result. Whatever the
	// real-world reason (e.g. it aged out of the top-$limit UPDATED_AT window),
	// the wholesale rebuild must drop it — there is no separate pruning logic,
	// so "not in the latest fetch" is the entire eviction mechanism.
	out = ghJSON(ghFixture(200, "u200", "OPEN", false, "SUCCESS", ""))
	c.refresh(context.Background())
	snap := c.Snapshot()
	if _, ok := snap["u100"]; ok {
		t.Error("PR #100 should be gone after wholesale rebuild")
	}
	if _, ok := snap["u200"]; !ok {
		t.Error("PR #200 should remain")
	}
	if len(snap) != 1 {
		t.Errorf("snapshot size = %d, want 1", len(snap))
	}
}

func TestRefreshStaleWhileRevalidateOnError(t *testing.T) {
	calls := 0
	c := newTestCollector(func(context.Context) ([]byte, error) {
		calls++
		if calls == 1 {
			return ghJSON(ghFixture(386, "u386", "OPEN", false, "SUCCESS", "APPROVED")), nil
		}
		return nil, errors.New("network blip")
	})

	// First refresh: good data.
	c.refresh(context.Background())
	if _, ok := c.Snapshot()["u386"]; !ok {
		t.Fatal("PR #386 missing after first refresh")
	}

	// Second refresh: gh errors — last-good map MUST be kept.
	c.refresh(context.Background())
	snap := c.Snapshot()
	if got, ok := snap["u386"]; !ok || got.ReviewDecision != "approved" {
		t.Errorf("stale-while-revalidate failed: snapshot = %v", snap)
	}
}

func TestRefreshGhUnavailableIsNoOp(t *testing.T) {
	// Seed a snapshot via a forced-available refresh first.
	c := newTestCollector(func(context.Context) ([]byte, error) {
		return ghJSON(ghFixture(1, "u1", "OPEN", false, "SUCCESS", "")), nil
	})
	c.refresh(context.Background())
	if len(c.Snapshot()) != 1 {
		t.Fatal("seed refresh failed")
	}

	// Now flip availability to false; refresh must be a no-op (last-good kept),
	// and the gh exec must NOT be called.
	c.available = func(context.Context) bool { return false }
	c.ghExec = func(context.Context) ([]byte, error) {
		t.Fatal("ghExec must not be called when gh is unavailable")
		return nil, nil
	}
	c.refresh(context.Background())
	if len(c.Snapshot()) != 1 {
		t.Errorf("snapshot changed on unavailable gh: %v", c.Snapshot())
	}
}

func TestRefreshNilExecIsNoOp(t *testing.T) {
	c := NewCollector(time.Hour)
	c.available = func(context.Context) bool { return true }
	c.ghExec = nil
	c.refresh(context.Background()) // must not panic
	if len(c.Snapshot()) != 0 {
		t.Errorf("snapshot = %v, want empty", c.Snapshot())
	}
}

func TestRefreshBadJSONKeepsLastGood(t *testing.T) {
	calls := 0
	c := newTestCollector(func(context.Context) ([]byte, error) {
		calls++
		if calls == 1 {
			return ghJSON(ghFixture(7, "u7", "OPEN", false, "SUCCESS", "")), nil
		}
		return []byte("not json"), nil
	})
	c.refresh(context.Background())
	c.refresh(context.Background())
	if _, ok := c.Snapshot()["u7"]; !ok {
		t.Error("bad JSON should keep last-good map")
	}
}

func TestMapChecks(t *testing.T) {
	cases := map[string]string{
		"SUCCESS":  "pass",
		"FAILURE":  "fail",
		"ERROR":    "fail",
		"PENDING":  "pending",
		"EXPECTED": "pending",
		"":         "none",
		"WAT":      "none",
	}
	for in, want := range cases {
		if got := mapChecks(in); got != want {
			t.Errorf("mapChecks(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMapReview(t *testing.T) {
	cases := map[string]string{
		"APPROVED":          "approved",
		"CHANGES_REQUESTED": "changes_requested",
		"REVIEW_REQUIRED":   "review_required",
		"":                  "none",
		"WAT":               "none",
	}
	for in, want := range cases {
		if got := mapReview(in); got != want {
			t.Errorf("mapReview(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMapState(t *testing.T) {
	cases := []struct {
		in    string
		draft bool
		want  string
	}{
		{"OPEN", false, "open"},
		{"OPEN", true, "open"}, // draft is surfaced via IsDraft, still "open"
		// The collector queries states: [OPEN, MERGED, CLOSED] so the line can
		// show a terminal state after a PR lands.
		{"MERGED", false, "merged"},
		{"CLOSED", false, "closed"},
		{"WAT", false, "open"}, // unexpected → safe "open" default
	}
	for _, tc := range cases {
		if got := mapState(tc.in, tc.draft); got != tc.want {
			t.Errorf("mapState(%q, %v) = %q, want %q", tc.in, tc.draft, got, tc.want)
		}
	}
}

func TestDraftAndEnumCollapseEndToEnd(t *testing.T) {
	c := newTestCollector(func(context.Context) ([]byte, error) {
		return ghJSON(
			ghFixture(11, "u11", "OPEN", true, "FAILURE", "CHANGES_REQUESTED") + "," +
				ghFixture(12, "u12", "OPEN", false, "SUCCESS", "APPROVED") + "," +
				ghFixture(13, "u13", "MERGED", false, "", ""),
		), nil
	})
	c.refresh(context.Background())
	snap := c.Snapshot()

	p11 := snap["u11"]
	if !p11.IsDraft {
		t.Error("#11 should be draft")
	}
	if p11.State != "open" || p11.Checks != "fail" || p11.ReviewDecision != "changes_requested" {
		t.Errorf("#11 collapse wrong: %+v", p11)
	}
	// #12 is a non-draft open PR with passing checks and an approval — exercises
	// the SUCCESS→pass and APPROVED→approved collapses.
	p12 := snap["u12"]
	if p12.State != "open" || p12.IsDraft || p12.Checks != "pass" || p12.ReviewDecision != "approved" {
		t.Errorf("#12 collapse wrong: %+v", p12)
	}
	// #13 is merged — the query now includes MERGED so a landed PR shows its
	// terminal state (checks/review are "none"/none for the empty fixture).
	p13 := snap["u13"]
	if p13.State != "merged" {
		t.Errorf("#13 should be merged, got %+v", p13)
	}
}

func TestRefreshCrossRepoSameNumberNoCollision(t *testing.T) {
	// PR numbers are only unique per repository. Two PRs sharing a number but
	// living in different repos must BOTH survive the rebuild under their own
	// URL keys — a number-keyed map let one clobber the other (the bug where an
	// open repoA#18 displayed as merged because repoB#18 had merged).
	c := newTestCollector(func(context.Context) ([]byte, error) {
		return ghJSON(
			ghFixture(18, "https://github.com/sahil87/idea/pull/18", "OPEN", false, "SUCCESS", "") + "," +
				ghFixture(18, "https://github.com/sahil87/shll/pull/18", "MERGED", false, "", ""),
		), nil
	})
	c.refresh(context.Background())
	snap := c.Snapshot()

	if len(snap) != 2 {
		t.Fatalf("snapshot size = %d, want 2 (one per URL): %v", len(snap), snap)
	}
	if got := snap["https://github.com/sahil87/idea/pull/18"].State; got != "open" {
		t.Errorf("idea#18 state = %q, want open", got)
	}
	if got := snap["https://github.com/sahil87/shll/pull/18"].State; got != "merged" {
		t.Errorf("shll#18 state = %q, want merged", got)
	}
}

func TestSnapshotIsCopy(t *testing.T) {
	c := newTestCollector(func(context.Context) ([]byte, error) {
		return ghJSON(ghFixture(1, "u1", "OPEN", false, "SUCCESS", "")), nil
	})
	c.refresh(context.Background())
	snap := c.Snapshot()
	delete(snap, "u1") // mutate the copy
	if _, ok := c.Snapshot()["u1"]; !ok {
		t.Error("mutating the snapshot must not affect the collector's map")
	}
}
