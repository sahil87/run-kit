package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui shot — screenshot the GUI display to a PNG and print its path. The
// tool ladder (import → scrot → xwd+convert) is probed at run time: nothing
// is installed for the caller, and the first available tool wins. Every
// subprocess is an argv slice under exec.CommandContext bounded by
// guiShotTimeout (Constitution §I). Resizing rides ImageMagick: import takes
// -resize inline, scrot/xwd get a convert post-stage — a scale request on a
// host with neither import nor convert refuses with the imagemagick hint.

// guiShotTimeout bounds one screenshot run — a root-window grab is
// sub-second; the bound exists so a hung X tool never wedges the caller.
var guiShotTimeout = 15 * time.Second

// guiShotNoToolError names every ladder option so the hint survives a partial
// install (e.g. xwd without convert).
const guiShotNoToolError = "no screenshot tool found (tried import, scrot, xwd+convert) — sudo apt install imagemagick"

const (
	// guiShotWindowRungError: scrot has no by-id capture (scrot -t is a
	// thumbnail flag and is not used), so --window needs an ImageMagick rung.
	guiShotWindowRungError = "--window needs imagemagick (import or convert) — sudo apt install imagemagick"
	// guiShotScaleRungError: only ImageMagick resizes (import inline, convert
	// as a post-stage).
	guiShotScaleRungError = "--scale needs imagemagick — sudo apt install imagemagick"
)

// Package seams (the gui.go idiom): LookPath per tool, the pipeline runner,
// and the clock for the default output name (guiGOOS lives in gui.go).
var (
	guiShotLookPathFn = exec.LookPath
	guiShotRunFn      = guiShotRunStages
	guiShotNowFn      = time.Now
)

var guiShotCmd = &cobra.Command{
	Use:   "shot",
	Short: "Screenshot the GUI display to a PNG and print its path",
	Long: `Screenshot the GUI display (the root window of the rk-gui desktop) to
a PNG and print the absolute path on stdout — the look-half of the agent loop:
the drive verbs act, 'rk gui shot' sees the result.

Uses the first screenshot tool found on PATH (import, then scrot, then
xwd+convert); none installed is an error with the apt hint. With --out the
file lands there (parent created, existing file overwritten); otherwise it
lands in the OS temp dir as rk-gui-shot-<timestamp>.png.

--scale <f> (0 < f ≤ 1) and --max-width <px> shrink the capture through
ImageMagick (mutually exclusive; --max-width derives the scale from the
source width). --window <id> captures one window instead of the root.
stderr always carries 'geometry WxH scale S' — the source geometry and the
applied scale — so coordinates divide cleanly back into display pixels;
stdout stays the bare path.

--json replaces the bare path with the standard envelope: stdout carries
{"ok":true,"result":{…}} whose result keys are path (the absolute PNG),
width and height (the source geometry), scale (the applied scale), and
display, plus window only when --window was given. The stderr geometry line
still prints.

Refuses (exit 1) when the GUI is off or enabled but not running ('rk gui
status' has the reason); on macOS the surface mirrors your live session
view-only, so there is no display to screenshot.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiShot,
}

func init() {
	guiShotCmd.Flags().Float64("scale", 0, "Scale the capture by this factor, in (0, 1] (ImageMagick)")
	guiShotCmd.Flags().Int("max-width", 0, "Scale the capture down to at most this width in px (ImageMagick)")
	guiShotCmd.Flags().Uint64("window", 0, "Capture this window id (from 'rk gui windows') instead of the root")
	guiShotCmd.Flags().Bool("json", false, "Emit the capture receipt as a JSON envelope (path, width, height, scale, display)")
}

// guiShotStage is one stage of the screenshot pipeline: the argv to run plus
// any extra environment the tool needs (scrot has no display flag — it reads
// DISPLAY from its env).
type guiShotStage struct {
	argv []string
	env  []string
}

// guiShotOpts carries the capture modifiers. The verb fills scale/scaleSet/
// maxWidth from flags; guiShotCapture resolves them into the effective scale
// it stores back in scale for the ladder builder (1 = no resize). window is
// the --window target (windowSet false = the root).
type guiShotOpts struct {
	scale     float64
	scaleSet  bool
	maxWidth  int
	window    uint64
	windowSet bool
}

// guiShotResizeArg renders the ImageMagick -resize percentage for a scale
// (0.5 → "50%").
func guiShotResizeArg(scale float64) string {
	return strconv.FormatFloat(scale*100, 'f', -1, 64) + "%"
}

// guiShotArgv resolves the screenshot ladder for display/out: (1) import,
// (2) scrot with DISPLAY in its env, (3) xwd piped into convert (both must be
// present — an xwd-only host falls through to the no-tool case rather than
// producing a non-PNG). A scale below 1 and a --window target ride the
// ImageMagick rungs: import takes both inline; scrot resizes via a convert
// post-stage and refuses --window outright; xwd maps --window to -id and
// resizes in the convert stage. A nil error with tool "" is the no-tool case
// (the caller prints guiShotNoToolError). Pure over lookPath.
func guiShotArgv(lookPath func(string) (string, error), display, out string, opts guiShotOpts) (stages []guiShotStage, tool string, err error) {
	resize := opts.scale > 0 && opts.scale < 1
	window := "root"
	if opts.windowSet {
		window = strconv.FormatUint(opts.window, 10)
	}
	if _, err := lookPath("import"); err == nil {
		argv := []string{"import", "-display", display, "-window", window}
		if resize {
			argv = append(argv, "-resize", guiShotResizeArg(opts.scale))
		}
		return []guiShotStage{{argv: append(argv, out)}}, "import", nil
	}
	if _, err := lookPath("scrot"); err == nil {
		if opts.windowSet {
			return nil, "", errors.New(guiShotWindowRungError)
		}
		stages := []guiShotStage{{argv: []string{"scrot", out}, env: []string{"DISPLAY=" + display}}}
		if resize {
			if _, err := lookPath("convert"); err != nil {
				return nil, "", errors.New(guiShotScaleRungError)
			}
			stages = append(stages, guiShotStage{argv: []string{"convert", out, "-resize", guiShotResizeArg(opts.scale), out}})
		}
		return stages, "scrot", nil
	}
	if _, err := lookPath("xwd"); err == nil {
		if _, err := lookPath("convert"); err == nil {
			xwdArgv := []string{"xwd", "-display", display}
			if opts.windowSet {
				xwdArgv = append(xwdArgv, "-id", window)
			} else {
				xwdArgv = append(xwdArgv, "-root")
			}
			xwdArgv = append(xwdArgv, "-silent")
			convertArgv := []string{"convert", "xwd:-"}
			if resize {
				convertArgv = append(convertArgv, "-resize", guiShotResizeArg(opts.scale))
			}
			return []guiShotStage{
				{argv: xwdArgv},
				{argv: append(convertArgv, out)},
			}, "xwd+convert", nil
		}
	}
	if resize {
		return nil, "", errors.New(guiShotScaleRungError)
	}
	// No rung resolved: the no-tool case. (--window with no import present is
	// here only when scrot is absent too — the scrot rung refuses above — and
	// xwd-without-convert was never a PNG pipeline.)
	return nil, "", nil
}

// guiShotRunStages is the default guiShotRunFn: runs the resolved pipeline —
// one stage, or two with stage 1's stdout wired into stage 2's stdin in Go —
// each process under the shared timeout context. A non-zero exit returns the
// tool's stderr tail (falling back to the exit error when stderr is empty).
func guiShotRunStages(ctx context.Context, stages []guiShotStage) error {
	ctx, cancel := context.WithTimeout(ctx, guiShotTimeout)
	defer cancel()

	// Build every stage first: StdoutPipe must be wired before the producer's
	// Start, so the pipeline is assembled ahead of any process launch.
	cmds := make([]*exec.Cmd, len(stages))
	stderrs := make([]*bytes.Buffer, len(stages))
	for i, stage := range stages {
		cmd := exec.CommandContext(ctx, stage.argv[0], stage.argv[1:]...)
		cmd.Env = append(os.Environ(), stage.env...)
		stderr := new(bytes.Buffer)
		cmd.Stderr = stderr
		if i > 0 {
			pipe, err := cmds[i-1].StdoutPipe()
			if err != nil {
				return err
			}
			cmd.Stdin = pipe
		}
		cmds[i], stderrs[i] = cmd, stderr
	}
	for _, cmd := range cmds[:len(cmds)-1] {
		if err := cmd.Start(); err != nil {
			return err
		}
	}
	last := len(cmds) - 1
	if err := cmds[last].Run(); err != nil {
		return shotStageError(err, stderrs[last])
	}
	// Reap the producers after the consumer finished. Any producer failure
	// fails the run — a silent non-zero xwd would otherwise let convert's
	// success stand for a capture that never happened; shotStageError still
	// prefers the tool's own stderr when it explained itself.
	for i, cmd := range cmds[:last] {
		if err := cmd.Wait(); err != nil {
			return shotStageError(err, stderrs[i])
		}
	}
	return nil
}

// shotStageError renders one stage's failure: the stderr tail when the tool
// explained itself, else the bare exit error.
func shotStageError(err error, stderr *bytes.Buffer) error {
	tail := strings.TrimSpace(stderr.String())
	if tail == "" {
		return err
	}
	return errors.New(tail)
}

// guiShotCapture runs one capture and returns the destination, the SOURCE
// geometry, and the effective scale. The source geometry is the probe's
// Width×Height for the root and the window's getwindowgeometry for --window
// (which needs xdotool). The effective scale is the explicit --scale, or
// min(1, maxWidth/W) for --max-width. wait --stable reuses this at 0.25.
func guiShotCapture(ctx context.Context, st gui.Status, out string, opts guiShotOpts) (width, height int, scale float64, err error) {
	if opts.windowSet {
		if err := guiRequireXTool("xdotool", guiXdoMissingHint); err != nil {
			return 0, 0, 0, err
		}
		geo, gerr := guiXdoRunFn(ctx, st.Display, gui.XdoWindowGeometry(opts.window), "")
		if gerr != nil {
			return 0, 0, 0, fmt.Errorf("--window %d: not a window", opts.window)
		}
		_, _, w, h, perr := gui.ParseWindowGeometry(geo)
		if perr != nil {
			return 0, 0, 0, fmt.Errorf("--window %d: not a window", opts.window)
		}
		width, height = w, h
	} else {
		width, height = st.Width, st.Height
	}
	scale = 1
	if opts.scaleSet {
		scale = opts.scale
	}
	if opts.maxWidth > 0 && width > 0 {
		scale = math.Min(1, float64(opts.maxWidth)/float64(width))
	}
	stages, tool, aerr := guiShotArgv(guiShotLookPathFn, st.Display, out, guiShotOpts{scale: scale, window: opts.window, windowSet: opts.windowSet})
	if aerr != nil {
		return 0, 0, 0, aerr
	}
	if tool == "" {
		return 0, 0, 0, errors.New(guiShotNoToolError)
	}
	if err := guiShotRunFn(ctx, stages); err != nil {
		return 0, 0, 0, fmt.Errorf("error: %s failed: %w", tool, err)
	}
	return width, height, scale, nil
}

// guiShotJSONResult is the `shot --json` receipt: the bare-path line's datum
// plus the source geometry and applied scale the stderr geometry line
// carries. Window is present only for a --window capture (a real X window id
// is never 0, and --window 0 fails before the receipt).
type guiShotJSONResult struct {
	Path    string  `json:"path"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Scale   float64 `json:"scale"`
	Display string  `json:"display"`
	Window  uint64  `json:"window,omitempty"`
}

// guiShotScaleText renders the scale for the stderr geometry line (1, 0.5).
func guiShotScaleText(scale float64) string {
	return strconv.FormatFloat(scale, 'f', -1, 64)
}

// runGuiShot gates on the OS and the switch, resolves the output path and the
// tool ladder, runs the pipeline, and prints the absolute PNG path (Dataf —
// the datum survives --quiet; diagnostics go to stderr), or the JSON envelope
// under --json. stderr always carries the source geometry and applied scale.
func runGuiShot(cmd *cobra.Command, _ []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("shot")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}

	scale, _ := cmd.Flags().GetFloat64("scale")
	maxWidth, _ := cmd.Flags().GetInt("max-width")
	window, _ := cmd.Flags().GetUint64("window")
	if cmd.Flags().Changed("scale") && cmd.Flags().Changed("max-width") {
		return usageError(errors.New("--scale and --max-width are mutually exclusive"))
	}
	if cmd.Flags().Changed("scale") && (scale <= 0 || scale > 1) {
		return usageError(fmt.Errorf("--scale %s is outside (0, 1]", guiShotScaleText(scale)))
	}
	if cmd.Flags().Changed("max-width") && maxWidth < 1 {
		return usageError(fmt.Errorf("--max-width %d is not a positive pixel width", maxWidth))
	}
	opts := guiShotOpts{scale: scale, scaleSet: cmd.Flags().Changed("scale"), maxWidth: maxWidth, window: window, windowSet: cmd.Flags().Changed("window")}

	out, _ := cmd.Flags().GetString("out")
	if out == "" {
		// The OS temp dir owns cleanup; screenshots never litter the caller's
		// cwd (usually a repo) and never grow the run-kit state dir.
		// os.TempDir returns $TMPDIR verbatim, which may be relative; stdout
		// promises an absolute path, so the default is normalized too.
		abs, err := filepath.Abs(filepath.Join(os.TempDir(), "rk-gui-shot-"+guiShotNowFn().Format("20060102-150405")+".png"))
		if err != nil {
			return fmt.Errorf("error: resolving the temp dir: %w", err)
		}
		out = abs
	} else {
		abs, err := filepath.Abs(out)
		if err != nil {
			return fmt.Errorf("error: --out %s: %w", out, err)
		}
		out = abs
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return fmt.Errorf("error: creating %s: %w", filepath.Dir(out), err)
		}
	}

	width, height, applied, err := guiShotCapture(ctx, st, out, opts)
	if err != nil {
		return err
	}
	sink := newSink(cmd)
	sink.Notef("geometry %dx%d scale %s\n", width, height, guiShotScaleText(applied))
	if jsonOut, _ := cmd.Flags().GetBool("json"); jsonOut {
		doc := guiShotJSONResult{
			Path:    out,
			Width:   width,
			Height:  height,
			Scale:   applied,
			Display: st.Display,
		}
		if opts.windowSet {
			doc.Window = opts.window
		}
		return sink.Envelope(doc, nil)
	}
	sink.Dataf("%s\n", out)
	return nil
}
