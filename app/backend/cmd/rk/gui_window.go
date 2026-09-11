package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui windows / focus — the window inventory and the raise-and-focus verb.
// Both wrap xdotool (probe first, the apt hint on a miss) through the shared
// guiXdoRunFn seam; focus is an input verb under the human-input guard.

var guiWindowsCmd = &cobra.Command{
	Use:   "windows [--json]",
	Short: "List the visible windows on the GUI display",
	Long: `List every visible top-level window on the GUI display, sorted by X id:
rows of 'ID PID GEOMETRY TITLE' (geometry WxH+X+Y), the active window's row
suffixed ' *'. A window whose client sets no _NET_WM_PID lists pid 0; a bare
display (no EWMH window manager) marks nothing active — neither is an error.

--json emits the standard {"ok":true,"result":…} envelope around
[{id, pid, x, y, width, height, title, active, app}] (app is the
pid's /proc comm; an empty display emits "result": []).

Refuses (exit 1) when the GUI is off or enabled but not running, or when
xdotool is not installed (the apt hint).`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiWindows,
}

var guiFocusCmd = &cobra.Command{
	Use:   "focus <id|--title <substr>>",
	Short: "Raise and focus a window on the GUI display",
	Long: `Raise and focus one window: by numeric X id, or by --title
(case-sensitive substring over the current titles). Exactly one match is
required — zero matches is 'no window matches "<substr>"', several is the
'ambiguous' line naming every match (both exit 1). An id argument that is not
a window is '<id>: not a window' (exit 1).

focus is an input verb: it refuses while a human drove the display in the
last 3s ('human input <N>s ago — retry or pass --force').`,
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiFocus,
}

func init() {
	guiWindowsCmd.Flags().Bool("json", false, "Emit the inventory as JSON")
	guiFocusCmd.Flags().String("title", "", "Match a window by title substring (case-sensitive)")
	guiFocusCmd.Flags().Bool("force", false, "Act even when a human drove the display seconds ago")
}

// guiCollectWindows runs the inventory scan: the visible-window search, then
// per-window name/geometry/pid, then the active-window read. The per-window
// degradations (no _NET_WM_PID, no EWMH active window, a window vanishing
// mid-scan) are empty values, never errors.
func guiCollectWindows(ctx context.Context, display string) ([]gui.Window, error) {
	out, err := guiXdoRunFn(ctx, display, gui.XdoSearchVisible(display), "")
	if err != nil && out == "" {
		// xdotool exits 1 when the search matches nothing — an empty display
		// is an empty inventory, not a failure.
		return []gui.Window{}, nil
	}
	ids, err := gui.ParseWindowIDs(out)
	if err != nil {
		return nil, err
	}
	var activeID uint64
	if out, err := guiXdoRunFn(ctx, display, gui.XdoActiveWindow(), ""); err == nil {
		activeID, _ = strconv.ParseUint(strings.TrimSpace(out), 10, 64)
	}
	raw := make([]gui.WindowRaw, 0, len(ids))
	for _, id := range ids {
		r := gui.WindowRaw{ID: id}
		if name, err := guiXdoRunFn(ctx, display, gui.XdoWindowName(id), ""); err == nil {
			r.Title = name
		}
		geo, err := guiXdoRunFn(ctx, display, gui.XdoWindowGeometry(id), "")
		if err != nil {
			continue // vanished mid-scan
		}
		r.Geometry = geo
		if pid, err := guiXdoRunFn(ctx, display, gui.XdoWindowPID(id), ""); err == nil {
			r.PID = pid
		}
		raw = append(raw, r)
	}
	return gui.ParseWindows(raw, activeID, guiProcComm), nil
}

// guiProcComm reads /proc/<pid>/comm (the RunningApps idiom); "" when
// unreadable.
func guiProcComm(pid int) string {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "comm"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func runGuiWindows(cmd *cobra.Command, _ []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("windows")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	if err := guiRequireXTool("xdotool", guiXdoMissingHint); err != nil {
		return err
	}
	windows, err := guiCollectWindows(ctx, st.Display)
	if err != nil {
		return fmt.Errorf("error: listing windows: %w", err)
	}
	sink := newSink(cmd)
	if jsonOut, _ := cmd.Flags().GetBool("json"); jsonOut {
		if err := sink.Envelope(windows, nil); err != nil {
			return fmt.Errorf("encoding the window list: %w", err)
		}
		return nil
	}
	for _, w := range windows {
		line := fmt.Sprintf("%d %d %dx%d+%d+%d %s", w.ID, w.PID, w.Width, w.Height, w.X, w.Y, w.Title)
		if w.Active {
			line += " *"
		}
		sink.Dataf("%s\n", line)
	}
	return nil
}

func runGuiFocus(cmd *cobra.Command, args []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("focus")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	if err := guiRequireXTool("xdotool", guiXdoMissingHint); err != nil {
		return err
	}
	title, _ := cmd.Flags().GetString("title")
	force, _ := cmd.Flags().GetBool("force")
	if (len(args) == 1) == (title != "") {
		return usageError(errors.New("focus needs exactly one of <id> or --title <substr>"))
	}
	if err := guiRequireNoHumanInput(ctx, force); err != nil {
		return err
	}

	var id uint64
	if title != "" {
		// --name's argument is a regex; QuoteMeta keeps the substring literal.
		ids, err := guiXdoSearchIDs(ctx, st.Display, regexp.QuoteMeta(title))
		if err != nil {
			return fmt.Errorf("error: searching windows: %w", err)
		}
		switch len(ids) {
		case 0:
			return fmt.Errorf("no window matches %q", title)
		case 1:
			id = ids[0]
		default:
			parts := make([]string, 0, len(ids))
			for _, wid := range ids {
				name, _ := guiXdoRunFn(ctx, st.Display, gui.XdoWindowName(wid), "")
				parts = append(parts, fmt.Sprintf("%d %s", wid, name))
			}
			return fmt.Errorf("ambiguous %q: %d windows match — %s", title, len(ids), strings.Join(parts, ", "))
		}
	} else {
		id, err = strconv.ParseUint(args[0], 10, 64)
		if err != nil {
			return usageError(fmt.Errorf("focus: %q is not a window id", args[0]))
		}
		if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoWindowGeometry(id), ""); err != nil {
			return fmt.Errorf("%d: not a window", id)
		}
	}
	if _, err := guiXdoRunFn(ctx, st.Display, gui.XdoActivate(id), ""); err != nil {
		return fmt.Errorf("error: windowactivate %d: %w", id, err)
	}
	return nil
}
