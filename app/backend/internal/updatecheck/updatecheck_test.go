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
		"0.6.0":       {0, 6},
		"1.2.3":       {1, 2},
		"10.20.30":    {10, 20},
		"2.5":         {2, 5},
		"1.4.0-rc1":   {1, 4}, // trailing pre-release on patch tolerated
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

func TestQualifies(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
		note            string
	}{
		{"0.5.3", "0.6.0", true, "minor bump qualifies"},
		{"0.5.3", "1.0.0", true, "major bump qualifies"},
		{"0.5.3", "0.5.9", false, "patch bump does not qualify"},
		{"0.5.3", "0.5.3", false, "equal does not qualify"},
		{"0.6.0", "0.5.9", false, "older latest does not qualify"},
		{"1.2.0", "1.1.9", false, "older minor does not qualify"},
		{"1.9.0", "2.0.0", true, "major bump across minor boundary qualifies"},
		{"0.5.3", "vbad", false, "unparseable latest does not qualify"},
		{"bad", "0.6.0", false, "unparseable current does not qualify"},
	}
	for _, c := range cases {
		if got := qualifies(normalizeTag(c.current), normalizeTag(c.latest)); got != c.want {
			t.Errorf("qualifies(%q,%q) = %v, want %v (%s)", c.current, c.latest, got, c.want, c.note)
		}
	}
}

func TestNewSuppressesDevAndUnparseable(t *testing.T) {
	for _, v := range []string{"dev", "not-a-version", ""} {
		c := New(v)
		if !c.suppressed {
			t.Errorf("New(%q) expected suppressed=true", v)
		}
		if c.Snapshot().Qualifies {
			t.Errorf("New(%q) snapshot should never qualify", v)
		}
	}
	c := New("0.5.3")
	if c.suppressed {
		t.Errorf("New(0.5.3) should not be suppressed")
	}
}

// TestCheckOnceQualifiesAndFiresCallback drives a single check via a stubbed
// fetch and asserts the verdict updates and OnQualify fires exactly once.
func TestCheckOnceQualifiesAndFiresCallback(t *testing.T) {
	c := New("0.5.3")
	c.fetchFn = func(ctx context.Context) (string, error) { return "v0.6.0", nil }

	var mu sync.Mutex
	var calls [][2]string
	c.OnQualify = func(current, latest string) {
		mu.Lock()
		calls = append(calls, [2]string{current, latest})
		mu.Unlock()
	}

	c.checkOnce(context.Background())

	snap := c.Snapshot()
	if !snap.Qualifies || snap.Latest != "0.6.0" || snap.Current != "0.5.3" {
		t.Fatalf("after check: snapshot = %+v, want qualifying 0.5.3→0.6.0", snap)
	}

	// A second check with the same qualifying latest must NOT re-fire OnQualify
	// (the transition already happened).
	c.checkOnce(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 {
		t.Fatalf("OnQualify fired %d times, want exactly 1 (%v)", len(calls), calls)
	}
	if calls[0] != [2]string{"0.5.3", "0.6.0"} {
		t.Errorf("OnQualify args = %v, want [0.5.3 0.6.0]", calls[0])
	}
}

// TestCheckOnceRefiresOnNewerRelease verifies that a still-qualifying check
// reporting a NEWER latest re-fires OnQualify (refreshing the cached SSE slot so
// the chip + per-version dismissal re-show contract stays current), while a
// repeat of the same qualifying latest does not re-fire.
func TestCheckOnceRefiresOnNewerRelease(t *testing.T) {
	c := New("0.5.3")

	var next string
	c.fetchFn = func(ctx context.Context) (string, error) { return next, nil }

	var mu sync.Mutex
	var calls [][2]string
	c.OnQualify = func(current, latest string) {
		mu.Lock()
		calls = append(calls, [2]string{current, latest})
		mu.Unlock()
	}

	// 1) 0.6.0 qualifies and fires the first time.
	next = "v0.6.0"
	c.checkOnce(context.Background())
	// 2) A later check returning 0.7.0 re-fires with the updated latest.
	next = "v0.7.0"
	c.checkOnce(context.Background())
	// 3) A repeat 0.6.0 -> 0.7.0 with no change (0.7.0 again) must NOT re-fire.
	c.checkOnce(context.Background())

	snap := c.Snapshot()
	if !snap.Qualifies || snap.Latest != "0.7.0" {
		t.Fatalf("after checks: snapshot = %+v, want qualifying latest 0.7.0", snap)
	}

	mu.Lock()
	defer mu.Unlock()
	want := [][2]string{{"0.5.3", "0.6.0"}, {"0.5.3", "0.7.0"}}
	if len(calls) != len(want) {
		t.Fatalf("OnQualify fired %d times, want %d (%v)", len(calls), len(want), calls)
	}
	for i := range want {
		if calls[i] != want[i] {
			t.Errorf("OnQualify call %d = %v, want %v", i, calls[i], want[i])
		}
	}
}

// TestCheckOncePatchDoesNotFire verifies a patch-only latest never qualifies and
// never fires the callback.
func TestCheckOncePatchDoesNotFire(t *testing.T) {
	c := New("0.5.3")
	c.fetchFn = func(ctx context.Context) (string, error) { return "v0.5.9", nil }
	fired := false
	c.OnQualify = func(current, latest string) { fired = true }

	c.checkOnce(context.Background())

	if c.Snapshot().Qualifies {
		t.Errorf("patch bump should not qualify")
	}
	if fired {
		t.Errorf("OnQualify should not fire for a patch bump")
	}
}

// TestCheckOnceFetchErrorRetainsResult verifies stale-while-revalidate: a fetch
// error leaves the previous verdict intact and does not fire OnQualify.
func TestCheckOnceFetchErrorRetainsResult(t *testing.T) {
	c := New("0.5.3")
	// First: a successful qualifying check seeds the verdict.
	c.fetchFn = func(ctx context.Context) (string, error) { return "v0.6.0", nil }
	c.checkOnce(context.Background())
	seeded := c.Snapshot()
	if !seeded.Qualifies {
		t.Fatalf("precondition: seeded verdict should qualify, got %+v", seeded)
	}

	// Now the fetch fails — the prior verdict must be retained.
	fired := false
	c.OnQualify = func(current, latest string) { fired = true }
	c.fetchFn = func(ctx context.Context) (string, error) { return "", errors.New("network down") }
	c.checkOnce(context.Background())

	if got := c.Snapshot(); got != seeded {
		t.Errorf("after fetch error: snapshot = %+v, want retained %+v", got, seeded)
	}
	if fired {
		t.Errorf("OnQualify should not fire on a fetch error")
	}
}

// TestStartSuppressedIsNoop verifies a suppressed checker's Start never calls the
// fetch seam.
func TestStartSuppressedIsNoop(t *testing.T) {
	c := New("dev")
	called := false
	c.fetchFn = func(ctx context.Context) (string, error) {
		called = true
		return "v0.6.0", nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	c.Start(ctx)
	<-ctx.Done()
	if called {
		t.Errorf("suppressed checker must not fetch")
	}
}
