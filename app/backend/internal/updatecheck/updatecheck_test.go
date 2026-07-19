package updatecheck

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestNormalizeTag(t *testing.T) {
	cases := map[string]string{
		"v0.6.0":  "0.6.0",
		"0.6.0":   "0.6.0",
		" v1.2.3": "1.2.3",
		"v1.2.3 ": "1.2.3",
	}
	for in, want := range cases {
		if got := normalizeTag(in); got != want {
			t.Errorf("normalizeTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseMajorMinor(t *testing.T) {
	ok := map[string][2]int{
		"0.6.0":     {0, 6},
		"1.2.3":     {1, 2},
		"10.20.30":  {10, 20},
		"2.5":       {2, 5},
		"1.4.0-rc1": {1, 4}, // trailing pre-release on patch tolerated
	}
	for in, want := range ok {
		maj, min, err := parseMajorMinor(in)
		if err != nil {
			t.Errorf("parseMajorMinor(%q) unexpected error: %v", in, err)
			continue
		}
		if maj != want[0] || min != want[1] {
			t.Errorf("parseMajorMinor(%q) = (%d,%d), want (%d,%d)", in, maj, min, want[0], want[1])
		}
	}
	for _, bad := range []string{"", "1", "dev", "x.y.z", "1.x"} {
		if _, _, err := parseMajorMinor(bad); err == nil {
			t.Errorf("parseMajorMinor(%q) expected error, got nil", bad)
		}
	}
}

func TestParsePatch(t *testing.T) {
	ok := map[string]int{
		"1.2.3":      3,
		"1.2":        0, // absent patch → 0
		"1.2.0-rc1":  0,
		"1.2.5+meta": 5,
	}
	for in, want := range ok {
		got, err := parsePatch(in)
		if err != nil {
			t.Errorf("parsePatch(%q) unexpected error: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("parsePatch(%q) = %d, want %d", in, got, want)
		}
	}
	if _, err := parsePatch("1.2.x"); err == nil {
		t.Errorf("parsePatch(1.2.x) expected error, got nil")
	}
}

func TestCrossesThreshold(t *testing.T) {
	cases := []struct {
		installed, latest, notify string
		want                      bool
		note                      string
	}{
		{"0.5.3", "0.6.0", notifyNever, false, "never never matches"},
		{"0.5.3", "0.6.0", notifyMinor, true, "minor bump under minor matches"},
		{"0.5.3", "1.0.0", notifyMinor, true, "major bump under minor matches"},
		{"0.5.3", "0.5.9", notifyMinor, false, "patch bump under minor does NOT match"},
		{"0.5.3", "0.5.3", notifyMinor, false, "equal under minor does not match"},
		{"0.5.3", "0.5.9", notifyPatch, true, "patch bump under patch matches"},
		{"0.5.3", "0.6.0", notifyPatch, true, "minor bump under patch matches"},
		{"0.5.3", "1.0.0", notifyPatch, true, "major bump under patch matches"},
		{"0.5.3", "0.5.3", notifyPatch, false, "equal under patch does not match"},
		{"0.5.3", "0.5.2", notifyPatch, false, "older patch under patch does not match"},
		{"0.6.0", "0.5.9", notifyMinor, false, "older minor under minor does not match"},
		{"0.5.3", "vbad", notifyMinor, false, "unparseable latest never matches"},
		{"bad", "0.6.0", notifyPatch, false, "unparseable installed never matches"},
		{"0.5.3", "0.6.0", "banana", false, "unknown notify value fails closed"},
	}
	for _, c := range cases {
		if got := crossesThreshold(normalizeTag(c.installed), normalizeTag(c.latest), c.notify); got != c.want {
			t.Errorf("crossesThreshold(%q,%q,%q) = %v, want %v (%s)", c.installed, c.latest, c.notify, got, c.want, c.note)
		}
	}
}

func TestComputeKey(t *testing.T) {
	// Composite key = sorted "tool@latest" pairs, comma-joined. Sorts by the
	// joined pair (tool name first), NOT by roster order.
	matched := []ToolUpdate{
		{Tool: "run-kit", Installed: "3.8.0", Latest: "3.9.0"},
		{Tool: "fab-kit", Installed: "2.16.0", Latest: "2.17.0"},
	}
	if got, want := computeKey(matched), "fab-kit@2.17.0,run-kit@3.9.0"; got != want {
		t.Errorf("computeKey = %q, want %q", got, want)
	}
	if got := computeKey(nil); got != "" {
		t.Errorf("computeKey(nil) = %q, want empty", got)
	}
}

func TestParseBrewVersions(t *testing.T) {
	out := []byte("fab-kit 2.16.0\ntu 0.9.1\nshll 0.1.5 0.1.4\n\nbadline\n")
	got := parseBrewVersions(out)
	want := map[string]string{"fab-kit": "2.16.0", "tu": "0.9.1", "shll": "0.1.5"}
	if len(got) != len(want) {
		t.Fatalf("parseBrewVersions len = %d, want %d (%v)", len(got), len(want), got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("parseBrewVersions[%q] = %q, want %q", k, got[k], v)
		}
	}
}

func TestNewSuppressesDevAndUnparseable(t *testing.T) {
	for _, v := range []string{"dev", "not-a-version", ""} {
		c := New(v, true)
		if !c.suppressed {
			t.Errorf("New(%q) expected suppressed=true", v)
		}
		if len(c.Snapshot().Matched) != 0 {
			t.Errorf("New(%q) snapshot should never match", v)
		}
	}
	c := New("0.5.3", true)
	if c.suppressed {
		t.Errorf("New(0.5.3) should not be suppressed")
	}
}

// fixtureManifest is a representative shll.ai manifest used across the match
// tests. run-kit=minor, fab-kit=minor, tu=patch, wt=never.
func fixtureManifest() Manifest {
	return Manifest{
		Schema:      1,
		GeneratedAt: "2026-07-19T07:13:00Z",
		Tools: map[string]ManifestTool{
			"run-kit": {Latest: "3.9.0", Notify: "minor", Formula: "run-kit"},
			"fab-kit": {Latest: "2.17.0", Notify: "minor", Formula: "fab-kit"},
			"tu":      {Latest: "0.9.2", Notify: "patch", Formula: "tu"},
			"wt":      {Latest: "0.2.0", Notify: "never", Formula: "wt"},
		},
	}
}

// checkerWith wires a checker with a stubbed manifest fetch, brew list, and shll
// presence, then runs one synchronous check. current = running run-kit version.
func checkerWith(t *testing.T, current string, selfBrew bool, shllPresent bool, brew map[string]string) *Checker {
	t.Helper()
	c := New(current, selfBrew)
	c.SetFetchForTest(func() (Manifest, error) { return fixtureManifest(), nil })
	c.SetLookShllForTest(shllPresent)
	c.SetBrewListForTest(func(_ []string) (map[string]string, error) { return brew, nil })
	return c
}

// TestMatchRunKitRow verifies the run-kit row matches against the RUNNING
// version and honors the brew-install self-gate.
func TestMatchRunKitRow(t *testing.T) {
	// run-kit 3.8.0 → 3.9.0 (minor) matches; brew-installed rk, shll present.
	c := checkerWith(t, "3.8.0", true, true, map[string]string{})
	c.CheckOnceForTest()
	snap := c.Snapshot()
	if !hasTool(snap.Matched, "run-kit") {
		t.Fatalf("run-kit should match 3.8.0→3.9.0 (minor), matched=%v", snap.Matched)
	}
	if snap.Current != "3.8.0" || snap.Latest != "3.9.0" {
		t.Errorf("run-kit row legacy fields = (%q,%q), want (3.8.0,3.9.0)", snap.Current, snap.Latest)
	}

	// A go-install/dev rk (selfBrew=false) must NOT self-match even when newer.
	c2 := checkerWith(t, "3.8.0", false, true, map[string]string{})
	c2.CheckOnceForTest()
	if hasTool(c2.Snapshot().Matched, "run-kit") {
		t.Errorf("non-brew run-kit must not self-match")
	}
}

// TestMatchSiblingBrewJoin verifies sibling tools match off the brew-listed
// installed version and that a formula missing from brew never matches.
func TestMatchSiblingBrewJoin(t *testing.T) {
	// fab-kit 2.16.0 → 2.17.0 (minor) matches; tu 0.9.1 → 0.9.2 (patch) matches;
	// wt not listed (and notify:never anyway) never matches.
	c := checkerWith(t, "3.9.0", true, true, map[string]string{
		"fab-kit": "2.16.0",
		"tu":      "0.9.1",
	})
	c.CheckOnceForTest()
	snap := c.Snapshot()
	if !hasTool(snap.Matched, "fab-kit") {
		t.Errorf("fab-kit should match 2.16.0→2.17.0 (minor), matched=%v", snap.Matched)
	}
	if !hasTool(snap.Matched, "tu") {
		t.Errorf("tu should match 0.9.1→0.9.2 (patch), matched=%v", snap.Matched)
	}
	if hasTool(snap.Matched, "wt") {
		t.Errorf("wt (notify:never, not brew-listed) must never match")
	}
	// run-kit is at latest (3.9.0), so it should not match here.
	if hasTool(snap.Matched, "run-kit") {
		t.Errorf("run-kit at latest should not match")
	}
	// run-kit absent from the match set → legacy fields empty.
	if snap.Current != "" || snap.Latest != "" {
		t.Errorf("legacy fields should be empty when run-kit unmatched, got (%q,%q)", snap.Current, snap.Latest)
	}
}

// TestMatchNotBrewInstalledSibling verifies a manifest tool with no brew line
// (not installed) never matches even with a newer latest.
func TestMatchNotBrewInstalledSibling(t *testing.T) {
	// fab-kit newer in the manifest, but not present in brew output.
	c := checkerWith(t, "3.9.0", true, true, map[string]string{})
	c.CheckOnceForTest()
	if hasTool(c.Snapshot().Matched, "fab-kit") {
		t.Errorf("fab-kit not brew-installed must never match")
	}
}

// TestMatchShllAbsentScopesToRunKit verifies that with shll absent, only the
// run-kit row is considered — siblings are skipped regardless of brew.
func TestMatchShllAbsentScopesToRunKit(t *testing.T) {
	c := checkerWith(t, "3.8.0", true, false, map[string]string{
		"fab-kit": "2.16.0", // would match if considered
		"tu":      "0.9.1",
	})
	// The brew seam must never be consulted when shll is absent.
	c.SetBrewListForTest(func(_ []string) (map[string]string, error) {
		t.Fatalf("brew list must not run when shll is absent")
		return nil, nil
	})
	c.CheckOnceForTest()
	snap := c.Snapshot()
	if !hasTool(snap.Matched, "run-kit") {
		t.Errorf("run-kit should still match when shll absent, matched=%v", snap.Matched)
	}
	if hasTool(snap.Matched, "fab-kit") || hasTool(snap.Matched, "tu") {
		t.Errorf("siblings must be skipped when shll absent, matched=%v", snap.Matched)
	}
}

// TestMatchOrderAndKey verifies the composite key is sorted-stable across the
// matched set.
func TestMatchOrderAndKey(t *testing.T) {
	c := checkerWith(t, "3.8.0", true, true, map[string]string{"fab-kit": "2.16.0"})
	c.CheckOnceForTest()
	snap := c.Snapshot()
	if snap.Key != "fab-kit@2.17.0,run-kit@3.9.0" {
		t.Errorf("Key = %q, want fab-kit@2.17.0,run-kit@3.9.0", snap.Key)
	}
}

// TestCheckOnceFiresOnKeyChange drives the OnQualify contract: fire on first
// non-empty key, re-fire on a changed key, no re-fire on an unchanged key.
func TestCheckOnceFiresOnKeyChange(t *testing.T) {
	c := New("3.8.0", true)
	c.SetLookShllForTest(false) // run-kit row only — deterministic
	c.SetSelfBrewForTest(true)

	var latest string
	c.SetFetchForTest(func() (Manifest, error) {
		return Manifest{Tools: map[string]ManifestTool{
			"run-kit": {Latest: latest, Notify: "minor", Formula: "run-kit"},
		}}, nil
	})

	var mu sync.Mutex
	var keys []string
	c.OnQualify = func(r Result) {
		mu.Lock()
		keys = append(keys, r.Key)
		mu.Unlock()
	}

	// 1) 3.9.0 → first non-empty key, fires.
	latest = "3.9.0"
	c.CheckOnceForTest()
	// 2) unchanged key → no re-fire.
	c.CheckOnceForTest()
	// 3) 3.10.0 → key changes, re-fires.
	latest = "3.10.0"
	c.CheckOnceForTest()

	mu.Lock()
	defer mu.Unlock()
	want := []string{"run-kit@3.9.0", "run-kit@3.10.0"}
	if len(keys) != len(want) {
		t.Fatalf("OnQualify fired %d times, want %d (%v)", len(keys), len(want), keys)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Errorf("OnQualify call %d key = %q, want %q", i, keys[i], want[i])
		}
	}
}

// TestCheckOnceClearThenReMatchRefires verifies a match → clear → re-match
// sequence fires on EVERY key change (R7): the first match, the clear-to-empty
// (a first-class cleared-verdict fire — the consumed-match clear), and the
// re-match. The cleared fire carries an empty key + empty matched set.
func TestCheckOnceClearThenReMatchRefires(t *testing.T) {
	c := New("3.8.0", true)
	c.SetLookShllForTest(false)
	c.SetSelfBrewForTest(true)

	var latest string
	c.SetFetchForTest(func() (Manifest, error) {
		return Manifest{Tools: map[string]ManifestTool{
			"run-kit": {Latest: latest, Notify: "minor", Formula: "run-kit"},
		}}, nil
	})
	var mu sync.Mutex
	var fired []Result
	c.OnQualify = func(r Result) {
		mu.Lock()
		fired = append(fired, r)
		mu.Unlock()
	}

	latest = "3.9.0" // match → fire (non-empty key)
	c.CheckOnceForTest()
	latest = "3.8.0" // back to installed → key clears → fire (empty key, R7)
	c.CheckOnceForTest()
	latest = "3.9.0" // re-match → fire (non-empty key)
	c.CheckOnceForTest()

	mu.Lock()
	defer mu.Unlock()
	if len(fired) != 3 {
		t.Fatalf("OnQualify fired %d times, want 3 (match + clear + re-match), keys=%v", len(fired), firedKeys(fired))
	}
	if fired[0].Key != "run-kit@3.9.0" {
		t.Errorf("fire 0 key = %q, want run-kit@3.9.0", fired[0].Key)
	}
	// The cleared verdict: empty key AND empty matched set (first-class R7 fire).
	if fired[1].Key != "" || len(fired[1].Matched) != 0 {
		t.Errorf("fire 1 (clear) = {Key:%q, Matched:%v}, want empty key + empty matched", fired[1].Key, fired[1].Matched)
	}
	if fired[2].Key != "run-kit@3.9.0" {
		t.Errorf("fire 2 key = %q, want run-kit@3.9.0", fired[2].Key)
	}
	if c.Snapshot().Key != "run-kit@3.9.0" {
		t.Errorf("final key = %q, want run-kit@3.9.0", c.Snapshot().Key)
	}
}

// TestCheckOnceEmptyToEmptyNoFire verifies the R7 no-fire boundary: an unchanged
// EMPTY key across two checks (nothing ever matched) must NOT fire — only a key
// CHANGE fires, and empty→empty is not a change.
func TestCheckOnceEmptyToEmptyNoFire(t *testing.T) {
	c := New("3.9.0", true) // already at latest — nothing matches
	c.SetLookShllForTest(false)
	c.SetSelfBrewForTest(true)
	c.SetFetchForTest(func() (Manifest, error) {
		return Manifest{Tools: map[string]ManifestTool{
			"run-kit": {Latest: "3.9.0", Notify: "minor", Formula: "run-kit"},
		}}, nil
	})
	fires := 0
	c.OnQualify = func(Result) { fires++ }

	c.CheckOnceForTest() // empty → empty (never fired before)
	c.CheckOnceForTest() // empty → empty again
	if fires != 0 {
		t.Errorf("OnQualify fired %d times on empty→empty, want 0", fires)
	}
}

// firedKeys is a debug helper: the Key of each recorded fire.
func firedKeys(rs []Result) []string {
	ks := make([]string, len(rs))
	for i, r := range rs {
		ks[i] = r.Key
	}
	return ks
}

// TestCheckOnceFetchErrorRetainsResult verifies stale-while-revalidate: a fetch
// error leaves the previous verdict intact and does not fire OnQualify.
func TestCheckOnceFetchErrorRetainsResult(t *testing.T) {
	c := checkerWith(t, "3.8.0", true, false, nil) // run-kit-only, matches 3.8→3.9
	c.CheckOnceForTest()
	seeded := c.Snapshot()
	if len(seeded.Matched) == 0 {
		t.Fatalf("precondition: seeded verdict should match, got %+v", seeded)
	}

	fired := false
	c.OnQualify = func(Result) { fired = true }
	c.SetFetchForTest(func() (Manifest, error) { return Manifest{}, errors.New("network down") })
	c.CheckOnceForTest()

	got := c.Snapshot()
	if got.Key != seeded.Key || len(got.Matched) != len(seeded.Matched) {
		t.Errorf("after fetch error: snapshot = %+v, want retained %+v", got, seeded)
	}
	if fired {
		t.Errorf("OnQualify should not fire on a fetch error")
	}
}

// TestCheckOnceBrewErrorSkipsSiblings verifies a brew failure leaves siblings
// unmatched this pass but does not crash or clear the run-kit row.
func TestCheckOnceBrewErrorSkipsSiblings(t *testing.T) {
	c := New("3.8.0", true)
	c.SetFetchForTest(func() (Manifest, error) { return fixtureManifest(), nil })
	c.SetLookShllForTest(true)
	c.SetBrewListForTest(func(_ []string) (map[string]string, error) {
		return nil, errors.New("brew not found")
	})
	c.CheckOnceForTest()
	snap := c.Snapshot()
	// run-kit still matches (its row does not depend on brew list output).
	if !hasTool(snap.Matched, "run-kit") {
		t.Errorf("run-kit should still match on a brew error, matched=%v", snap.Matched)
	}
	// No sibling matched (brew failed).
	if hasTool(snap.Matched, "fab-kit") || hasTool(snap.Matched, "tu") {
		t.Errorf("siblings should be unmatched on a brew error, matched=%v", snap.Matched)
	}
}

// TestRecheckAfterRunsDelayedCheck verifies R17's checker trigger: after Start
// captures the daemon context, RecheckAfter schedules a single delayed check
// that re-runs fetch+match and fires OnQualify on the resulting key change.
func TestRecheckAfterRunsDelayedCheck(t *testing.T) {
	// Capture the scheduled (delay, fn) instead of waiting a real ~2min.
	var gotDelay time.Duration
	var scheduled func()
	orig := afterFuncFn
	afterFuncFn = func(d time.Duration, fn func()) { gotDelay = d; scheduled = fn }
	t.Cleanup(func() { afterFuncFn = orig })

	c := New("3.8.0", true)
	c.SetLookShllForTest(false) // run-kit row only — deterministic
	c.SetSelfBrewForTest(true)

	var latest string
	c.SetFetchForTest(func() (Manifest, error) {
		return Manifest{Tools: map[string]ManifestTool{
			"run-kit": {Latest: latest, Notify: "minor", Formula: "run-kit"},
		}}, nil
	})
	fires := 0
	c.OnQualify = func(Result) { fires++ }

	// Start captures the daemon context (Start is a no-op body beyond capture for
	// a non-suppressed checker until the initial delay elapses; we only need the
	// captured context here).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)

	// Simulate the post-remediation state: run-kit now behind latest.
	latest = "3.9.0"
	c.RecheckAfter(90 * time.Second)
	if scheduled == nil {
		t.Fatalf("RecheckAfter did not schedule anything")
	}
	if gotDelay != 90*time.Second {
		t.Errorf("scheduled delay = %v, want 90s", gotDelay)
	}
	// Run the scheduled re-check — it recomputes the verdict and fires.
	scheduled()
	if fires != 1 {
		t.Errorf("delayed re-check fired OnQualify %d times, want 1", fires)
	}
	if c.Snapshot().Key != "run-kit@3.9.0" {
		t.Errorf("post-recheck key = %q, want run-kit@3.9.0", c.Snapshot().Key)
	}
}

// TestRecheckAfterNoopBeforeStartAndSuppressed verifies RecheckAfter is a no-op
// before Start (no daemon context) and on a suppressed checker.
func TestRecheckAfterNoopBeforeStartAndSuppressed(t *testing.T) {
	scheduledCount := 0
	orig := afterFuncFn
	afterFuncFn = func(_ time.Duration, _ func()) { scheduledCount++ }
	t.Cleanup(func() { afterFuncFn = orig })

	// Before Start: no captured context → no-op.
	c := New("3.8.0", true)
	c.RecheckAfter(time.Minute)
	if scheduledCount != 0 {
		t.Errorf("RecheckAfter before Start scheduled %d times, want 0", scheduledCount)
	}

	// Suppressed checker: no-op even after Start.
	sc := New("dev", true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sc.Start(ctx) // suppressed — returns without launching the poll goroutine
	sc.RecheckAfter(time.Minute)
	if scheduledCount != 0 {
		t.Errorf("RecheckAfter on a suppressed checker scheduled %d times, want 0", scheduledCount)
	}
}

// TestStartSuppressedIsNoop verifies a suppressed checker's Start never calls the
// fetch seam.
func TestStartSuppressedIsNoop(t *testing.T) {
	c := New("dev", true)
	called := false
	c.fetchFn = func(ctx context.Context) (Manifest, error) {
		called = true
		return fixtureManifest(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	c.Start(ctx)
	<-ctx.Done()
	if called {
		t.Errorf("suppressed checker must not fetch")
	}
}

func hasTool(matched []ToolUpdate, tool string) bool {
	for _, m := range matched {
		if m.Tool == tool {
			return true
		}
	}
	return false
}
