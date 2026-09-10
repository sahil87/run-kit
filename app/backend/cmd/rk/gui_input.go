package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui click/move/scroll/type/key — the input verbs. Coordinates are
// display pixels (the one coordinate space; shot's stderr scale line is the
// mapping). Every verb shares the gate (darwin refusal, then reachable, then
// the xdotool probe) and the human-input guard: a relayed human input younger
// than guiHumanInputGrace refuses the verb unless --force.

var guiClickCmd = &cobra.Command{
	Use:   "click <x> <y> [--right|--middle|--double] [--window <id>]",
	Short: "Click at display-pixel coordinates",
	Long: `Move the pointer to <x> <y> (display pixels) and click. The button
defaults to left; --right/--middle pick right/middle; --double is a
double-click (the three are mutually exclusive). With --window the
coordinates are window-relative — the window's X/Y is added first.

Refuses (exit 1) while a human drove the display in the last 3s ('human input
<N>s ago — retry or pass --force').`,
	Args:         cobra.ExactArgs(2),
	SilenceUsage: true,
	RunE:         runGuiClick,
}

var guiMoveCmd = &cobra.Command{
	Use:   "move <x> <y>",
	Short: "Move the pointer to display-pixel coordinates",
	Long: `Move the pointer to <x> <y> (display pixels), no click.

Refuses (exit 1) while a human drove the display in the last 3s ('human input
<N>s ago — retry or pass --force').`,
	Args:         cobra.ExactArgs(2),
	SilenceUsage: true,
	RunE:         runGuiMove,
}

var guiScrollCmd = &cobra.Command{
	Use:   "scroll <up|down|left|right> [--n 3] [--at x y]",
	Short: "Scroll at the pointer (or at --at x y first)",
	Long: `Scroll in a direction: --n notches (default 3). With --at the pointer
moves to those display-pixel coordinates first.

Refuses (exit 1) while a human drove the display in the last 3s ('human input
<N>s ago — retry or pass --force').`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	RunE:         runGuiScroll,
}

var guiTypeCmd = &cobra.Command{
	Use:   "type <text> | --stdin",
	Short: "Type text into the focused window (unicode-safe)",
	Long: `Type text with xdotool (the text rides stdin, never argv — unicode-safe,
no quoting hazard). Newlines become Return presses: a trailing newline
produces a trailing Return. --stdin reads all of stdin; an argument and
--stdin together are a usage error. Empty text is a no-op.

Refuses (exit 1) while a human drove the display in the last 3s ('human input
<N>s ago — retry or pass --force').`,
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiType,
}

var guiKeyCmd = &cobra.Command{
	Use:   "key <chord> [<chord>…]",
	Short: "Press key chords (xdotool keysym spelling)",
	Long: `Press one or more key chords verbatim, in xdotool keysym spelling:
'ctrl+l', 'Return', 'alt+F4'.

Refuses (exit 1) while a human drove the display in the last 3s ('human input
<N>s ago — retry or pass --force').`,
	Args:         cobra.MinimumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiKey,
}

func init() {
	guiClickCmd.Flags().Bool("right", false, "Click the right button")
	guiClickCmd.Flags().Bool("middle", false, "Click the middle button")
	guiClickCmd.Flags().Bool("double", false, "Double-click")
	guiClickCmd.Flags().Uint64("window", 0, "Window id — x y become window-relative")
	guiClickCmd.MarkFlagsMutuallyExclusive("right", "middle", "double")
	guiScrollCmd.Flags().Int("n", 3, "Scroll notches")
	guiScrollCmd.Flags().IntSlice("at", nil, "Move to x,y before scrolling")
	guiTypeCmd.Flags().Bool("stdin", false, "Read the text from stdin")
	for _, c := range []*cobra.Command{guiClickCmd, guiMoveCmd, guiScrollCmd, guiTypeCmd, guiKeyCmd} {
		c.Flags().Bool("force", false, "Act even when a human drove the display seconds ago")
	}
}

// guiInputGate runs the shared input-verb preamble: the OS refusal, the
// reachable gate, the xdotool probe, and the human-input guard — in that
// order. Returns the status for the display the verb acts on.
func guiInputGate(ctx context.Context, cmd *cobra.Command, verb string) (gui.Status, error) {
	if guiGOOS == "darwin" {
		return gui.Status{}, guiDarwinRefusal(verb)
	}
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return gui.Status{}, err
	}
	if err := guiRequireXTool("xdotool", guiXdoMissingHint); err != nil {
		return gui.Status{}, err
	}
	force, _ := cmd.Flags().GetBool("force")
	if err := guiRequireNoHumanInput(ctx, force); err != nil {
		return gui.Status{}, err
	}
	return st, nil
}

// guiParseCoord parses one display-pixel coordinate: a non-negative integer.
func guiParseCoord(verb, s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0, usageError(fmt.Errorf("%s: %q is not a non-negative coordinate", verb, s))
	}
	return n, nil
}

func runGuiClick(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiInputGate(ctx, cmd, "click")
	if err != nil {
		return err
	}
	x, err := guiParseCoord("click", args[0])
	if err != nil {
		return err
	}
	y, err := guiParseCoord("click", args[1])
	if err != nil {
		return err
	}
	button, repeat := gui.XdoButtonLeft, 1
	if r, _ := cmd.Flags().GetBool("right"); r {
		button = gui.XdoButtonRight
	}
	if m, _ := cmd.Flags().GetBool("middle"); m {
		button = gui.XdoButtonMiddle
	}
	if d, _ := cmd.Flags().GetBool("double"); d {
		repeat = 2
	}
	if w, _ := cmd.Flags().GetUint64("window"); cmd.Flags().Changed("window") {
		geo, gerr := guiXdoRunFn(ctx, st.Display, gui.XdoWindowGeometry(w), "")
		if gerr != nil {
			return fmt.Errorf("--window %d: not a window", w)
		}
		wx, wy, _, _, perr := gui.ParseWindowGeometry(geo)
		if perr != nil {
			return fmt.Errorf("--window %d: not a window", w)
		}
		x, y = x+wx, y+wy
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoMouseMove(x, y), ""); err != nil {
		return fmt.Errorf("error: mousemove: %w", err)
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoClick(button, repeat), ""); err != nil {
		return fmt.Errorf("error: click: %w", err)
	}
	return nil
}

func runGuiMove(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiInputGate(ctx, cmd, "move")
	if err != nil {
		return err
	}
	x, err := guiParseCoord("move", args[0])
	if err != nil {
		return err
	}
	y, err := guiParseCoord("move", args[1])
	if err != nil {
		return err
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoMouseMove(x, y), ""); err != nil {
		return fmt.Errorf("error: mousemove: %w", err)
	}
	return nil
}

func runGuiScroll(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiInputGate(ctx, cmd, "scroll")
	if err != nil {
		return err
	}
	button, ok := gui.XdoScrollButton(args[0])
	if !ok {
		return usageError(fmt.Errorf("scroll: %q is not a direction (up|down|left|right)", args[0]))
	}
	n, _ := cmd.Flags().GetInt("n")
	if n < 1 {
		return usageError(fmt.Errorf("scroll: --n %d is not a positive notch count", n))
	}
	if at, _ := cmd.Flags().GetIntSlice("at"); len(at) > 0 {
		if len(at) != 2 || at[0] < 0 || at[1] < 0 {
			return usageError(errors.New("scroll: --at needs exactly two non-negative coordinates (x,y)"))
		}
		if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoMouseMove(at[0], at[1]), ""); err != nil {
			return fmt.Errorf("error: mousemove: %w", err)
		}
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoScroll(button, n), ""); err != nil {
		return fmt.Errorf("error: scroll: %w", err)
	}
	return nil
}

func runGuiType(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiInputGate(ctx, cmd, "type")
	if err != nil {
		return err
	}
	stdinFlag, _ := cmd.Flags().GetBool("stdin")
	if len(args) == 1 && stdinFlag {
		return usageError(errors.New("type: pass the text as an argument or --stdin, not both"))
	}
	if len(args) == 0 && !stdinFlag {
		return usageError(errors.New("type: pass the text as an argument or --stdin"))
	}
	var text string
	if stdinFlag {
		data, rerr := io.ReadAll(cmd.InOrStdin())
		if rerr != nil {
			return fmt.Errorf("error: reading stdin: %w", rerr)
		}
		text = string(data)
	} else {
		text = args[0]
	}
	if text == "" {
		return nil // empty text is a no-op
	}
	segments := gui.TypeSegments(text)
	for i, seg := range segments {
		if seg != "" {
			if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoType(), seg); err != nil {
				return fmt.Errorf("error: type: %w", err)
			}
		}
		if i < len(segments)-1 {
			if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoKey("Return"), ""); err != nil {
				return fmt.Errorf("error: key Return: %w", err)
			}
		}
	}
	return nil
}

func runGuiKey(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiInputGate(ctx, cmd, "key")
	if err != nil {
		return err
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoKey(args...), ""); err != nil {
		return fmt.Errorf("error: key: %w", err)
	}
	return nil
}
