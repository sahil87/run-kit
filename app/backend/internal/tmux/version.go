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

// versionTokenPattern matches a release version token: `3.2a`, `3.4` — a
// major.minor pair with an optional letter suffix. Anything else (`next-3.7`,
// `3.2a-3ubuntu1`, vendor formats) does not match and reads as unknown. The
// single grammar behind both entry shapes: `tmux -V` client output (prefix
// stripped by ParseVersion) and the bare `#{version}` format variable
// (parseVersionToken directly, via ServerVersion).
var versionTokenPattern = regexp.MustCompile(`^(\d+)\.(\d+)[a-z]*$`)

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

// OlderThan reports whether v is strictly older than other by major.minor
// ordering. Letter suffixes are ignored — a suffix-only difference (3.2 vs
// 3.2a) is NOT older. This is the drift predicate: the doctor drift note
// fires only when the on-disk binary is strictly newer than a running server.
func (v Version) OlderThan(other Version) bool {
	return v.Major < other.Major || (v.Major == other.Major && v.Minor < other.Minor)
}

// ParseVersion parses `tmux -V` output. The bool is false for anything that
// is not a plain release string — non-release output is "unknown", never an
// error, so callers never warn or block on a parse.
func ParseVersion(output string) (Version, bool) {
	token, ok := strings.CutPrefix(strings.TrimSpace(output), "tmux ")
	if !ok {
		return Version{}, false
	}
	return parseVersionToken(token)
}

// parseVersionToken parses a bare version token (`3.2a`) against the shared
// release grammar. Same unknown semantics as ParseVersion: false, never an
// error.
func parseVersionToken(token string) (Version, bool) {
	token = strings.TrimSpace(token)
	m := versionTokenPattern.FindStringSubmatch(token)
	if m == nil {
		return Version{}, false
	}
	major, err1 := strconv.Atoi(m[1])
	minor, err2 := strconv.Atoi(m[2])
	if err1 != nil || err2 != nil {
		return Version{}, false
	}
	return Version{Major: major, Minor: minor, Raw: token}, true
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

// ServerVersion probes a RUNNING tmux server's version via the `#{version}`
// format variable (the server's version — unlike `tmux -V`, which reports the
// on-disk client binary). Callers must target only servers already confirmed
// live (ListServers): a tmux client command on a dead socket can resurrect a
// server. The ctx is caller-owned per the runner-core contract. Any failure —
// dead socket, timeout, no sessions, non-release output — is unknown:
// (Version{}, false), never an error.
func ServerVersion(ctx context.Context, server string) (Version, bool) {
	args := append(serverArgs(server), "display-message", "-p", "#{version}")
	out, err := RunOutput(ctx, args, RunOpts{})
	if err != nil {
		return Version{}, false
	}
	return parseVersionToken(string(out))
}
