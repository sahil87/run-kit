package tmux

import (
	"context"
	"testing"
)

func TestParseVersion(t *testing.T) {
	cases := []struct {
		output    string
		wantOK    bool
		wantMajor int
		wantMinor int
		wantRaw   string
		wantBelow bool
	}{
		{"tmux 3.2a", true, 3, 2, "3.2a", true},
		{"tmux 3.3a", true, 3, 3, "3.3a", true},
		// Exactly 3.4 is NOT below the floor — the >= comparison is
		// load-bearing (Ubuntu 24.04 ships exactly 3.4).
		{"tmux 3.4", true, 3, 4, "3.4", false},
		{"tmux 3.6a", true, 3, 6, "3.6a", false},
		{"tmux 4.0", true, 4, 0, "4.0", false},
		{"tmux 2.9a", true, 2, 9, "2.9a", true},
		{"tmux 3.0", true, 3, 0, "3.0", true},
		{"tmux 3.4\n", true, 3, 4, "3.4", false},
		// Non-release shapes parse as unknown — never a warning, never a block.
		{"tmux next-3.7", false, 0, 0, "", false},
		{"tmux 3.2a-3ubuntu1", false, 0, 0, "", false},
		{"tmux master", false, 0, 0, "", false},
		{"", false, 0, 0, "", false},
		{"garbage", false, 0, 0, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.output, func(t *testing.T) {
			v, ok := ParseVersion(tc.output)
			if ok != tc.wantOK {
				t.Fatalf("ParseVersion(%q) ok = %v, want %v", tc.output, ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if v.Major != tc.wantMajor || v.Minor != tc.wantMinor || v.Raw != tc.wantRaw {
				t.Errorf("ParseVersion(%q) = %+v, want %d.%d raw %q", tc.output, v, tc.wantMajor, tc.wantMinor, tc.wantRaw)
			}
			if v.BelowFloor() != tc.wantBelow {
				t.Errorf("ParseVersion(%q).BelowFloor() = %v, want %v", tc.output, v.BelowFloor(), tc.wantBelow)
			}
		})
	}
}

// TestParseVersionToken pins the bare-token grammar consumed by the
// `#{version}` server probe — no `tmux ` prefix, same unknown semantics.
func TestParseVersionToken(t *testing.T) {
	cases := []struct {
		name      string
		token     string
		wantOK    bool
		wantMajor int
		wantMinor int
		wantRaw   string
	}{
		{"release with suffix", "3.2a", true, 3, 2, "3.2a"},
		{"plain release", "3.4", true, 3, 4, "3.4"},
		{"major bump", "4.0", true, 4, 0, "4.0"},
		{"trailing newline", "3.4\n", true, 3, 4, "3.4"},
		{"snapshot", "next-3.7", false, 0, 0, ""},
		{"vendor suffix", "3.2a-3ubuntu1", false, 0, 0, ""},
		{"client -V shape", "tmux 3.4", false, 0, 0, ""},
		{"empty", "", false, 0, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v, ok := parseVersionToken(tc.token)
			if ok != tc.wantOK {
				t.Fatalf("parseVersionToken(%q) ok = %v, want %v", tc.token, ok, tc.wantOK)
			}
			if ok && (v.Major != tc.wantMajor || v.Minor != tc.wantMinor || v.Raw != tc.wantRaw) {
				t.Errorf("parseVersionToken(%q) = %+v, want %d.%d raw %q", tc.token, v, tc.wantMajor, tc.wantMinor, tc.wantRaw)
			}
		})
	}
}

// TestVersionOlderThan pins the drift predicate: strict major.minor ordering,
// suffixes ignored, one-directional (a newer server never reads as drift).
func TestVersionOlderThan(t *testing.T) {
	v := func(major, minor int) Version { return Version{Major: major, Minor: minor} }
	cases := []struct {
		name      string
		a, b      Version
		wantOlder bool
	}{
		{"minor older", v(3, 2), v(3, 5), true},
		{"major older", v(2, 9), v(3, 0), true},
		{"equal", v(3, 4), v(3, 4), false},
		{"suffix-only difference is not older", Version{Major: 3, Minor: 2, Raw: "3.2"}, Version{Major: 3, Minor: 2, Raw: "3.2a"}, false},
		{"server ahead is not older", v(3, 5), v(3, 4), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.a.OlderThan(tc.b); got != tc.wantOlder {
				t.Errorf("%d.%d OlderThan %d.%d = %v, want %v", tc.a.Major, tc.a.Minor, tc.b.Major, tc.b.Minor, got, tc.wantOlder)
			}
		})
	}
}

// TestServerVersion_ProbeFailureIsUnknown mirrors the CurrentVersion probe
// contract for the server-side probe: a failed exec is unknown, never an
// error. A pre-canceled context fails immediately, so no real tmux is needed.
func TestServerVersion_ProbeFailureIsUnknown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := ServerVersion(ctx, "rk-nonexistent-probe"); ok {
		t.Error("ServerVersion with a canceled ctx must report unknown")
	}
}

// TestCurrentVersion_ProbeFailureIsUnknown proves a failed probe (tmux
// present but `-V` errors/times out) yields unknown rather than propagating
// an error — unknown never warns and never blocks. A pre-canceled context
// fails the exec immediately, so no real tmux is required.
func TestCurrentVersion_ProbeFailureIsUnknown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := CurrentVersion(ctx); ok {
		t.Error("CurrentVersion with a canceled ctx must report unknown")
	}
}
