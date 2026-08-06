package main

import (
	"fmt"
	"io"
	"strings"
	"time"

	"rk/internal/snapshot"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// snapshotListCap is the default per-list display cap (Toolkit Principle 9),
// mirroring reaperListCap. Display-only: it bounds rendered rows, never what
// exists in the store; --all restores the full list.
const snapshotListCap = 10

var (
	snapshotListAll   bool
	snapshotShowAt    int64
	snapshotRestoreAt int64
)

// snapshotNow is the clock used for age rendering — a seam so unit tests can
// pin it.
var snapshotNow = time.Now

// newSnapshotStore resolves the production store. A var seam so command tests
// can point it at a temp directory.
var newSnapshotStore = func() (*snapshot.Store, error) {
	dir, err := snapshot.DefaultDir()
	if err != nil {
		return nil, err
	}
	return snapshot.NewStore(dir), nil
}

// snapshotRestoreFn is the restore engine seam (production: snapshot.Restore)
// so the command layer is testable without a live tmux server.
var snapshotRestoreFn = snapshot.Restore

var snapshotCmd = &cobra.Command{
	Use:   "snapshot",
	Short: "Inspect and restore tmux server layout snapshots",
	Long: `The run-kit daemon periodically snapshots the layout of every tmux server it
covers — sessions, windows, pane working directories, and run-kit presentation
options — into ` + "`~/.local/state/rk/snapshots/`" + ` (write-only recovery backups;
live state is still derived from tmux). When a server dies, its last snapshot
is kept as a ` + "`{server}.died-{ts}.json`" + ` tombstone.

Subcommands:
  list     show available snapshots (live + died) with ages and counts
  show     print a stored layout without touching tmux
  restore  recreate a dead server's layout (fresh shells at the recorded
           working directories — former commands are reported, never relaunched)`,
}

var snapshotListCmd = &cobra.Command{
	Use:   "list [<server>]",
	Short: "List available layout snapshots (live + died)",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		filter := ""
		if len(args) == 1 {
			if msg := validate.ValidateServerName(args[0]); msg != "" {
				return usageError(fmt.Errorf("invalid server name: %s", msg))
			}
			filter = args[0]
		}
		store, err := newSnapshotStore()
		if err != nil {
			return err
		}
		rows, err := store.List(filter)
		if err != nil {
			return err
		}
		renderSnapshotList(cmd.OutOrStdout(), rows, snapshotListAll)
		return nil
	},
}

var snapshotShowCmd = &cobra.Command{
	Use:   "show <server>",
	Short: "Print a stored layout (sessions → windows → pane cwds) without acting",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		snap, err := resolveSnapshotArg(args[0], snapshotShowAt)
		if err != nil {
			return err
		}
		renderSnapshotShow(cmd.OutOrStdout(), snap)
		return nil
	},
}

var snapshotRestoreCmd = &cobra.Command{
	Use:   "restore <server>",
	Short: "Recreate a dead server's layout from its snapshot",
	Long: `Recreate a dead tmux server from its stored snapshot: sessions and windows
with their original names and indexes, panes as FRESH SHELLS at the recorded
working directories, split layouts where possible, and run-kit options
(server rank, session order, colors, markers).

No process is ever relaunched — each window's former command is printed in the
restore report so you can decide what to resume (e.g. ` + "`claude -c`" + ` per agent
window). Refuses to run when the target server is alive with sessions.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		snap, err := resolveSnapshotArg(args[0], snapshotRestoreAt)
		if err != nil {
			return err
		}
		// The validated CLI argument — not the JSON-embedded server field — is
		// the operative restore target; the engine rejects a snapshot whose
		// own Server field disagrees.
		report, err := snapshotRestoreFn(cmd.Context(), args[0], snap)
		if err != nil {
			return err
		}
		// The report is the record of a destructive mutation — data channel,
		// unaffected by --quiet (mirrors the reaper's stance).
		renderRestoreReport(cmd.OutOrStdout(), snap, report)
		return nil
	},
}

func init() {
	snapshotListCmd.Flags().BoolVar(&snapshotListAll, "all", false,
		"print the full list instead of the default 10-row cap (display-only)")
	snapshotShowCmd.Flags().Int64Var(&snapshotShowAt, "at", 0,
		"select a history/tombstone entry by its unix timestamp (default: latest)")
	snapshotRestoreCmd.Flags().Int64Var(&snapshotRestoreAt, "at", 0,
		"restore a history/tombstone entry by its unix timestamp (default: latest)")
	snapshotCmd.AddCommand(snapshotListCmd)
	snapshotCmd.AddCommand(snapshotShowCmd)
	snapshotCmd.AddCommand(snapshotRestoreCmd)
}

// resolveSnapshotArg validates the server argument and the --at value, then
// resolves the snapshot to act on. Validation runs BEFORE any filesystem use —
// the server name feeds path construction and, on restore, tmux targets (§I).
func resolveSnapshotArg(server string, at int64) (*snapshot.Snapshot, error) {
	if msg := validate.ValidateServerName(server); msg != "" {
		return nil, usageError(fmt.Errorf("invalid server name: %s", msg))
	}
	if at < 0 {
		return nil, usageError(fmt.Errorf("--at must be a non-negative unix timestamp"))
	}
	store, err := newSnapshotStore()
	if err != nil {
		return nil, err
	}
	return store.Resolve(server, at)
}

// formatSnapshotAge renders a duration since t compactly ("42s", "5m", "3h",
// "2d"). Future or zero timestamps render as "-".
func formatSnapshotAge(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	d := snapshotNow().Sub(t)
	switch {
	case d < 0:
		return "-"
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// renderSnapshotList prints one row per snapshot entry, capped at
// snapshotListCap unless all is set (header count stays exact).
func renderSnapshotList(w io.Writer, rows []snapshot.Entry, all bool) {
	if len(rows) == 0 {
		fmt.Fprintln(w, "No snapshots found.")
		return
	}
	fmt.Fprintf(w, "%d snapshot(s):\n", len(rows))
	shown := rows
	if !all && len(rows) > snapshotListCap {
		shown = rows[:snapshotListCap]
	}
	fmt.Fprintf(w, "  %-20s %-22s %-6s %8s %8s %8s\n", "SERVER", "STATE", "AGE", "SESSIONS", "WINDOWS", "HISTORY")
	for _, r := range shown {
		state := "live"
		if r.DiedAt != nil {
			state = "died " + formatSnapshotAge(*r.DiedAt) + " ago"
			if r.AuditedKill {
				state += " (audited)"
			}
		}
		fmt.Fprintf(w, "  %-20s %-22s %-6s %8d %8d %8d\n",
			r.Server, state, formatSnapshotAge(r.TakenAt), r.Sessions, r.Windows, r.HistoryCount)
	}
	renderTruncationNotice(w, "  ", len(rows), len(shown))
}

// renderSnapshotShow prints a snapshot's layout tree: sessions → windows →
// panes with cwds and former commands.
func renderSnapshotShow(w io.Writer, snap *snapshot.Snapshot) {
	fmt.Fprintf(w, "Snapshot of server %q taken %s (%s ago)\n",
		snap.Server, snap.TakenAt.Format(time.RFC3339), formatSnapshotAge(snap.TakenAt))
	if snap.DiedAt != nil {
		audited := ""
		if snap.AuditedKill {
			audited = ", audited kill"
		}
		fmt.Fprintf(w, "Server DIED %s (%s ago%s)\n",
			snap.DiedAt.Format(time.RFC3339), formatSnapshotAge(*snap.DiedAt), audited)
	}
	if snap.ServerRank != nil {
		fmt.Fprintf(w, "Server rank: %d\n", *snap.ServerRank)
	}
	if len(snap.SessionOrder) > 0 {
		fmt.Fprintf(w, "Session order: %s\n", strings.Join(snap.SessionOrder, ", "))
	}
	for _, sess := range snap.Sessions {
		color := ""
		if sess.Color != "" {
			color = fmt.Sprintf(", color %s", sess.Color)
		}
		fmt.Fprintf(w, "session %s (created %s%s)\n",
			sess.Name, time.Unix(sess.CreatedAt, 0).UTC().Format(time.RFC3339), color)
		for _, win := range sess.Windows {
			active := ""
			if win.Active {
				active = "  (active)"
			}
			fmt.Fprintf(w, "  window %d: %s%s\n", win.Index, win.Name, active)
			for _, p := range win.Panes {
				cmd := p.Command
				if cmd == "" {
					cmd = "-"
				}
				fmt.Fprintf(w, "    pane %d: %s  [%s]\n", p.Index, p.Cwd, cmd)
			}
		}
	}
}

// renderRestoreReport prints what the restore recreated, what it skipped, and
// each window's former command so the user can decide what to resume.
func renderRestoreReport(w io.Writer, snap *snapshot.Snapshot, report *snapshot.Report) {
	fmt.Fprintf(w, "Restored server %q from snapshot taken %s:\n",
		report.Server, snap.TakenAt.Format(time.RFC3339))
	for _, sess := range report.Sessions {
		fmt.Fprintf(w, "  session %s (%d window(s)):\n", sess.Name, len(sess.Windows))
		for _, win := range sess.Windows {
			former := ""
			if len(win.FormerCommands) > 0 {
				former = "  was running: " + strings.Join(win.FormerCommands, ", ")
			}
			fmt.Fprintf(w, "    window %d: %s — %d pane(s)%s\n", win.Index, win.Name, win.Panes, former)
			for _, note := range win.Notes {
				fmt.Fprintf(w, "      note: %s\n", note)
			}
		}
	}
	if len(report.Skipped) > 0 {
		fmt.Fprintln(w, "Skipped:")
		for _, sk := range report.Skipped {
			fmt.Fprintf(w, "  %s\n", sk)
		}
	}
	for _, note := range report.Notes {
		fmt.Fprintf(w, "note: %s\n", note)
	}
	fmt.Fprintf(w, "Panes are fresh shells — nothing was relaunched. Attach with: tmux -L %s attach\n", report.Server)
}
