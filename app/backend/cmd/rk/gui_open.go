package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui open — open a URL or file on the GUI display via xdg-open, detached.
// Not an input verb — the human-input guard never applies.

// guiOpenURLPattern matches a URL scheme (RFC 3986's ALPHA *( ALPHA / DIGIT /
// "+" / "-" / "." ) followed by ':') — anything else is a file path.
var guiOpenURLPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)

// guiOpenStartFn is the detached-start seam (the guiLaunchStartFn idiom).
var guiOpenStartFn = gui.StartDetached

var guiOpenCmd = &cobra.Command{
	Use:   "open <url|file>",
	Short: "Open a URL or file on the GUI display",
	Long: `Open a URL or file on the GUI display: runs 'xdg-open <target>'
detached (an argument with a URL scheme is a URL; anything else is a file
path, made absolute first) and prints 'started <pid> on :N'.

Without xdg-open a URL falls back to the browser ladder (the same resolution
'rk gui launch browser' uses; nothing on it prints the browser install hint,
exit 1) and a file refuses with 'xdg-open not found — sudo apt install
xdg-utils' (exit 1). A missing file is 'open: <path>: no such file' (exit 1).

Refuses (exit 1) when the GUI is off or enabled but not running.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	RunE:         runGuiOpen,
}

func runGuiOpen(cmd *cobra.Command, args []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("open")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}

	target := args[0]
	isURL := guiOpenURLPattern.MatchString(target)
	if !isURL {
		abs, aerr := filepath.Abs(target)
		if aerr != nil {
			return fmt.Errorf("error: open %s: %w", target, aerr)
		}
		if _, serr := guiStatFn(abs); serr != nil {
			return fmt.Errorf("open: %s: no such file", target)
		}
		target = abs
	}

	if _, err := guiLookPathFn("xdg-open"); err == nil {
		return guiOpenStart(cmd, st, []string{"xdg-open", target})
	}
	if !isURL {
		return errors.New("xdg-open not found — sudo apt install xdg-utils")
	}
	// No xdg-open: a URL falls back to the browser ladder (one launcher
	// shared everywhere — the launch verb, the HTTP twin, the toolbar).
	_, path, ok := gui.ResolveApp(gui.AppBrowser, guiLookPathFn, guiStatFn)
	if !ok {
		return errors.New(gui.LaunchHint(gui.AppBrowser, guiLookPathFn))
	}
	return guiOpenStart(cmd, st, []string{path, target})
}

// guiOpenStart starts the argv detached on the display and prints the
// launcher datum ('started <pid> on :N').
func guiOpenStart(cmd *cobra.Command, st gui.Status, argv []string) error {
	pid, err := guiOpenStartFn(argv, gui.LaunchEnv(os.Environ(), st.Display, st.Socket))
	if err != nil {
		return fmt.Errorf("error: %s: %w", argv[0], err)
	}
	newSink(cmd).Dataf("started %d on %s\n", pid, st.Display)
	return nil
}
