package tmux

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// VersionInfo holds the parsed tmux version.
type VersionInfo struct {
	Major int
	Minor int
	Raw   string // e.g. "3.6a", "next-3.5"
}

// versionRe matches the major.minor portion of tmux -V output.
var versionRe = regexp.MustCompile(`(\d+)\.(\d+)`)

// Version runs `tmux -V` and parses the output.
func Version() (VersionInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "tmux", "-V").Output()
	if err != nil {
		return VersionInfo{}, fmt.Errorf("running tmux -V: %w", err)
	}

	raw := strings.TrimSpace(string(out))
	// Strip "tmux " prefix if present
	raw = strings.TrimPrefix(raw, "tmux ")

	m := versionRe.FindStringSubmatch(raw)
	if m == nil {
		return VersionInfo{Raw: raw}, fmt.Errorf("cannot parse tmux version from %q", raw)
	}

	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])

	return VersionInfo{Major: major, Minor: minor, Raw: raw}, nil
}

// CheckMinVersion returns nil if the installed tmux is >= major.minor,
// or an error with an upgrade message.
func CheckMinVersion(major, minor int) error {
	v, err := Version()
	if err != nil {
		return fmt.Errorf("checking tmux version: %w", err)
	}

	if v.Major > major || (v.Major == major && v.Minor >= minor) {
		return nil
	}

	return fmt.Errorf("tmux %s found, but %d.%d+ is required for synchronized output (prevents terminal jitter)\n"+
		"  upgrade: brew install tmux  (macOS/Linuxbrew)\n"+
		"           or build from https://github.com/tmux/tmux/releases",
		v.Raw, major, minor)
}
