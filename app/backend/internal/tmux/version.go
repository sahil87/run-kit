package tmux

// The tmux version floor and its probe/parse helpers. The floor exists
// because below 3.4 tmux shell-joins multi-argument shell-commands instead of
// exec'ing them as argv — the remote-tunnels path would interpolate remote
// host input through a shell (Constitution §I). The floor is the single
// source of truth consumed by the daemon-start warning, the `rk serve`
// startup warning, the doctor tmux note, and the remote-tunnels gate.

import (
	"context"
	"regexp"
	"strconv"
	"strings"
)

const (
	// FloorMajor/FloorMinor name the minimum supported tmux version (3.4).
	// Comparison is >= everywhere: exactly 3.4 passes silently (Ubuntu 24.04
	// ships exactly 3.4 and must not be nagged).
	FloorMajor = 3
	FloorMinor = 4
	// FloorString is the floor rendered for user-facing messages.
	FloorString = "3.4"
)

// versionPattern matches release-build `tmux -V` output: `tmux 3.2a`,
// `tmux 3.4` — a major.minor token with an optional letter suffix. Anything
// else (`tmux next-3.7`, vendor formats) does not match and reads as unknown.
var versionPattern = regexp.MustCompile(`^tmux ((\d+)\.(\d+)[a-z]*)$`)

// Version is a parsed tmux release version.
type Version struct {
	// Major/Minor are the numeric release components (3, 2 for tmux 3.2a).
	Major int
	Minor int
	// Raw is the version token as tmux reported it ("3.2a"), retained for
	// user-facing messages.
	Raw string
}

// BelowFloor reports whether the version is strictly below the supported
// floor. The comparison is >= against the floor: exactly 3.4 is NOT below.
func (v Version) BelowFloor() bool {
	return v.Major < FloorMajor || (v.Major == FloorMajor && v.Minor < FloorMinor)
}

// ParseVersion parses `tmux -V` output. The bool is false for anything that
// is not a plain release string — non-release output is "unknown", never an
// error, so callers never warn or block on a parse.
func ParseVersion(output string) (Version, bool) {
	m := versionPattern.FindStringSubmatch(strings.TrimSpace(output))
	if m == nil {
		return Version{}, false
	}
	major, err1 := strconv.Atoi(m[2])
	minor, err2 := strconv.Atoi(m[3])
	if err1 != nil || err2 != nil {
		return Version{}, false
	}
	return Version{Major: major, Minor: minor, Raw: m[1]}, true
}

// CurrentVersion probes the tmux on PATH (through the tmux-guard shim to the
// real binary — exactly the binary every run-kit tmux call uses) via the
// RunOutput runner core. The ctx is caller-owned per the runner-core
// contract (each call site wraps with its own timeout). A failed probe or
// unparseable output is unknown — (Version{}, false), never an error.
func CurrentVersion(ctx context.Context) (Version, bool) {
	out, err := RunOutput(ctx, []string{"-V"}, RunOpts{})
	if err != nil {
		return Version{}, false
	}
	return ParseVersion(string(out))
}
