package gui

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Geometry parsing and the RandR resize argv. The parsers and argv builders
// are pure — nothing here runs a subprocess but RunOnDisplay — so the whole
// surface is table-testable without an X server. xrandr has no display flag;
// the runner sets DISPLAY in the process env (LaunchEnv), so the argv never
// carries it.

const (
	// GeometryAuto is the gui.geometry value that follows the focused desktop
	// viewer's tile instead of pinning a size.
	GeometryAuto = "auto"
	// GeometryDefault is the gui.geometry default and the size `auto` resolves
	// to wherever a concrete WxH is required (the supervisor's -geometry).
	GeometryDefault = "1920x1080"
	// GeometryMin and GeometryMax bound each side of a fixed WxH, inclusive.
	GeometryMin = 320
	GeometryMax = 7680
)

// XrandrTimeout bounds one xrandr exchange (query or resize step) — callers
// wrap the context; RunOnDisplay does not set its own.
const XrandrTimeout = 10 * time.Second

// XrandrMissingHint is the refusal the CLI and the resize endpoint share when
// xrandr is not on PATH (rk installs nothing).
const XrandrMissingHint = "xrandr not found — sudo apt install x11-xserver-utils"

// geometryShape is the fixed-size form: lowercase x, decimal digits, no sign,
// no spaces.
var geometryShape = regexp.MustCompile(`^([0-9]+)x([0-9]+)$`)

// ParseGeometry accepts the literal "auto" (auto=true, w=h=0) or a WxH with
// both sides in [GeometryMin, GeometryMax]. The input is trimmed first.
func ParseGeometry(s string) (w, h int, auto bool, err error) {
	s = strings.TrimSpace(s)
	if s == GeometryAuto {
		return 0, 0, true, nil
	}
	m := geometryShape.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false, fmt.Errorf("geometry must be WxH (%d–%d per side) or auto, got %q", GeometryMin, GeometryMax, s)
	}
	w, _ = strconv.Atoi(m[1])
	h, _ = strconv.Atoi(m[2])
	if w < GeometryMin || w > GeometryMax || h < GeometryMin || h > GeometryMax {
		return 0, 0, false, fmt.Errorf("geometry %s out of range (%d–%d per side)", s, GeometryMin, GeometryMax)
	}
	return w, h, false, nil
}

// ValidateGeometry is the settings-validator shape of ParseGeometry: "" when
// valid, else the error text.
func ValidateGeometry(s string) string {
	if _, _, _, err := ParseGeometry(s); err != nil {
		return err.Error()
	}
	return ""
}

// FormatGeometry renders a size as WxH.
func FormatGeometry(w, h int) string {
	return strconv.Itoa(w) + "x" + strconv.Itoa(h)
}

// XrandrQueryArgv probes the display's connected outputs and their modes.
func XrandrQueryArgv() []string {
	return []string{"xrandr", "--query"}
}

// ParseXrandrQuery reads `xrandr --query` output: the first line of the form
// "<name> connected …" yields output, and the indented lines that follow it
// (until the next non-indented line) yield modes as their first token.
func ParseXrandrQuery(out string) (output string, modes []string, err error) {
	inModes := false
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			if inModes {
				modes = append(modes, strings.Fields(line)[0])
			}
			continue
		}
		inModes = false
		fields := strings.Fields(line)
		if output == "" && len(fields) >= 2 && fields[1] == "connected" {
			output = fields[0]
			inModes = true
		}
	}
	if output == "" {
		return "", nil, errors.New("xrandr reports no connected output")
	}
	return output, modes, nil
}

// XrandrResizeArgv builds the steps that resize output to WxH. A mode the
// output already lists needs the single --output --mode step; an unlisted
// mode is first defined with a zero-timing modeline (Xvnc ignores timings) and
// added to the output. The output name always comes from the query — never
// hardcoded.
func XrandrResizeArgv(output string, modes []string, w, h int) [][]string {
	mode := FormatGeometry(w, h)
	setStep := []string{"xrandr", "--output", output, "--mode", mode}
	for _, m := range modes {
		if m == mode {
			return [][]string{setStep}
		}
	}
	return [][]string{
		{"xrandr", "--newmode", mode, "0", strconv.Itoa(w), "0", "0", "0", strconv.Itoa(h), "0", "0", "0"},
		{"xrandr", "--addmode", output, mode},
		setStep,
	}
}

// DisplayRunner runs one argv slice on the given X display and returns its
// stdout. A seam so Resize is testable without an X server.
type DisplayRunner func(ctx context.Context, display string, argv []string) (stdout string, err error)

// RunOnDisplay is the production DisplayRunner: an argv slice under
// exec.CommandContext (never a shell string), DISPLAY set in the env, stdout
// captured. The error carries the trimmed stderr tail when non-empty, else
// the exec error (the guiXdoRunFn idiom).
func RunOnDisplay(ctx context.Context, display string, argv []string) (string, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = LaunchEnv(os.Environ(), display, "")
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		if tail := strings.TrimSpace(errBuf.String()); tail != "" {
			return "", errors.New(tail)
		}
		return "", err
	}
	return strings.TrimSuffix(out.String(), "\n"), nil
}

// Resize orchestrates a display resize over the runner: query, parse, then
// each argv step in order, stopping at the first error (returned verbatim,
// prefixed "xrandr: ").
func Resize(ctx context.Context, run DisplayRunner, display string, w, h int) error {
	out, err := run(ctx, display, XrandrQueryArgv())
	if err != nil {
		return fmt.Errorf("xrandr: %w", err)
	}
	output, modes, err := ParseXrandrQuery(out)
	if err != nil {
		return fmt.Errorf("xrandr: %w", err)
	}
	for _, argv := range XrandrResizeArgv(output, modes, w, h) {
		if _, err := run(ctx, display, argv); err != nil {
			return fmt.Errorf("xrandr: %w", err)
		}
	}
	return nil
}
