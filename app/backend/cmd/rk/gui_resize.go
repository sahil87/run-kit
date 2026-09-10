package main

import (
	"context"
	"fmt"
	"strings"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// guiXrandrRunFn runs one xrandr argv on the GUI display — the package seam
// over gui.RunOnDisplay (the guiXdoRunFn idiom) so tests capture the argv
// without an X server. RunOnDisplay sets no timeout of its own; callers wrap
// the context with gui.XrandrTimeout.
var guiXrandrRunFn gui.DisplayRunner = gui.RunOnDisplay

var guiResizeCmd = &cobra.Command{
	Use:   "resize <WxH|auto>",
	Short: "Resize the GUI desktop (gui.geometry)",
	Long: `Resize the GUI desktop's pixel size (the gui.geometry setting).

A fixed size — 'rk gui resize 1600x900' — applies live through xrandr and
persists: windows keep their positions and viewer tiles letterbox instead of
driving SetDesktopSize, and the supervisor starts the backend with it on the
next 'rk gui restart'. 'auto' clears the pin (no xrandr call): the focused
fine-pointer viewer's tile drives the desktop size again. Sides run 320–7680
each; a malformed or out-of-range argument is a usage error (exit 2).

A failed xrandr exits 1 with the setting untouched; 'rk gui status' and the
doctor row show the current value as 'WxH fixed' or 'WxH auto'.

Refuses (exit 1) when the GUI is off or enabled but not running ('rk gui
status' has the reason), or when xrandr is not installed; on macOS the
surface mirrors your live session view-only, so there is no display to
resize.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	RunE:         runGuiResize,
}

func runGuiResize(cmd *cobra.Command, args []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("resize")
	}
	w, h, auto, err := gui.ParseGeometry(args[0])
	if err != nil {
		return usageError(err)
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), gui.XrandrTimeout)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	if !auto {
		if err := guiRequireXTool("xrandr", gui.XrandrMissingHint); err != nil {
			return err
		}
		if err := gui.Resize(ctx, guiXrandrRunFn, st.Display, w, h); err != nil {
			// Resize prefixes its failure "xrandr: " — the datum keeps the
			// stderr tail only. The setting is left untouched.
			return fmt.Errorf("error: xrandr failed: %s", strings.TrimPrefix(err.Error(), "xrandr: "))
		}
	}
	settings := guiSettingsLoad()
	was := settings.GUIGeometry
	settings.GUIGeometry = gui.GeometryAuto
	if !auto {
		settings.GUIGeometry = gui.FormatGeometry(w, h)
	}
	if err := guiSettingsSave(settings); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	sink := newSink(cmd)
	if auto {
		sink.Dataf("desktop follows the focused viewer (gui.geometry=auto)\n")
		return nil
	}
	sink.Dataf("resized %s to %s (was %s)\n", st.Display, gui.FormatGeometry(w, h), was)
	return nil
}
