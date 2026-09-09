package gui

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

// Display range: rk-managed X displays start at :10 (below that belongs to the
// host's desktop session) and end at :99.
const maxDisplay = 99

// tmpRoot is the X11 lock/socket root FreeDisplay probes. A package seam so
// tests point it at a temp root and never touch the real /tmp entries.
var tmpRoot = "/tmp"

// FreeDisplay returns the lowest display N in [start, maxDisplay] that is
// free — neither /tmp/.X{N}-lock nor /tmp/.X11-unix/X{N} exists. It errors
// when the range is exhausted.
func FreeDisplay(start int) (int, error) {
	for n := start; n <= maxDisplay; n++ {
		if pathExists(filepath.Join(tmpRoot, fmt.Sprintf(".X%d-lock", n))) {
			continue
		}
		if pathExists(filepath.Join(tmpRoot, ".X11-unix", fmt.Sprintf("X%d", n))) {
			continue
		}
		return n, nil
	}
	return 0, fmt.Errorf("no free display in :%d–:%d", start, maxDisplay)
}

// pathExists reports whether path exists; a stat error other than not-exist
// is treated as occupied — a mis-probed display is skipped, never handed out.
func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil || !errors.Is(err, fs.ErrNotExist)
}

// displayPattern is the exact display form: ':' followed by digits.
var displayPattern = regexp.MustCompile(`^:[0-9]+$`)

// ParseDisplay parses the ":N" display form into N.
func ParseDisplay(s string) (int, error) {
	if !displayPattern.MatchString(s) {
		return 0, fmt.Errorf("display must be in the form :N, got %q", s)
	}
	n, err := strconv.Atoi(s[1:])
	if err != nil {
		return 0, fmt.Errorf("display must be in the form :N, got %q", s)
	}
	return n, nil
}
