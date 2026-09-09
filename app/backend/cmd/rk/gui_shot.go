package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// rk gui shot — screenshot the GUI display to a PNG and print its path. The
// tool ladder (import → scrot → xwd+convert) is probed at run time: nothing
// is installed for the caller, and the first available tool wins. Every
// subprocess is an argv slice under exec.CommandContext bounded by
// guiShotTimeout (Constitution §I).

// guiShotTimeout bounds one screenshot run — a root-window grab is
// sub-second; the bound exists so a hung X tool never wedges the caller.
var guiShotTimeout = 15 * time.Second

// guiShotNoToolError names every ladder option so the hint survives a partial
// install (e.g. xwd without convert).
const guiShotNoToolError = "no screenshot tool found (tried import, scrot, xwd+convert) — sudo apt install imagemagick"

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
'rk gui exec xdotool …' to act, 'rk gui shot' to see the result.

Uses the first screenshot tool found on PATH (import, then scrot, then
xwd+convert); none installed is an error with the apt hint. With --out the
file lands there (parent created, existing file overwritten); otherwise it
lands in the OS temp dir as rk-gui-shot-<timestamp>.png.

Refuses (exit 1) when the GUI is off or enabled but not running ('rk gui
status' has the reason); on macOS the surface mirrors your live session
view-only, so there is no display to screenshot.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiShot,
}

// guiShotStage is one stage of the screenshot pipeline: the argv to run plus
// any extra environment the tool needs (scrot has no display flag — it reads
// DISPLAY from its env).
type guiShotStage struct {
	argv []string
	env  []string
}

// guiShotArgv resolves the screenshot ladder for display/out: (1) import
// -window root, (2) scrot with DISPLAY in its env, (3) xwd piped into
// convert (both must be present — an xwd-only host falls through to the
// no-tool error rather than producing a non-PNG). Pure over lookPath.
func guiShotArgv(lookPath func(string) (string, error), display, out string) (stages []guiShotStage, tool string, ok bool) {
	if _, err := lookPath("import"); err == nil {
		return []guiShotStage{{argv: []string{"import", "-display", display, "-window", "root", out}}}, "import", true
	}
	if _, err := lookPath("scrot"); err == nil {
		return []guiShotStage{{argv: []string{"scrot", out}, env: []string{"DISPLAY=" + display}}}, "scrot", true
	}
	if _, err := lookPath("xwd"); err == nil {
		if _, err := lookPath("convert"); err == nil {
			return []guiShotStage{
				{argv: []string{"xwd", "-display", display, "-root", "-silent"}},
				{argv: []string{"convert", "xwd:-", out}},
			}, "xwd+convert", true
		}
	}
	return nil, "", false
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
	// Reap the producers after the consumer finished; a producer that failed
	// (bad display) and explained itself on stderr outranks the consumer's
	// empty-input failure.
	for i, cmd := range cmds[:last] {
		if err := cmd.Wait(); err != nil && stderrs[i].Len() > 0 {
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

// runGuiShot gates on the OS and the switch, resolves the output path and the
// tool ladder, runs the pipeline, and prints only the absolute PNG path
// (Dataf — the datum survives --quiet; diagnostics go to stderr).
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

	out, _ := cmd.Flags().GetString("out")
	if out == "" {
		// The OS temp dir owns cleanup; screenshots never litter the caller's
		// cwd (usually a repo) and never grow the run-kit state dir.
		out = filepath.Join(os.TempDir(), "rk-gui-shot-"+guiShotNowFn().Format("20060102-150405")+".png")
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

	stages, tool, ok := guiShotArgv(guiShotLookPathFn, st.Display, out)
	if !ok {
		return errors.New(guiShotNoToolError)
	}
	if err := guiShotRunFn(guiCmdCtx(cmd), stages); err != nil {
		return fmt.Errorf("error: %s failed: %w", tool, err)
	}
	newSink(cmd).Dataf("%s\n", out)
	return nil
}
