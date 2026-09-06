package main

import (
	"context"
	"fmt"
	"os"
	"time"
	"unicode/utf8"

	"rk/internal/cron"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk cron add <payload> — record one cron entry in the resolved server's
// intent file. Exactly one schedule flag is required: --every <dur>, bare
// --backoff (anchor operator-idle, min/max refinable), or --cron "<expr>"
// (stored as schema-valid intent — expression evaluation is not implemented
// yet, so a note prints to stderr). Inside a tmux pane the creator is
// auto-captured ($TMUX_PANE + now) and the target defaults to role:operator
// when the caller's window carries the operator role, else the caller's own
// pane; explicit --role/--pane override. Outside tmux an explicit target flag
// is required — a typed command must not guess a target. The write goes
// through cron.Add only (atomic read-modify-write, id generation, per-entry
// validation — a corrupt file refuses to mutate).

// cronAddNameMaxRunes caps the derived --name default (a payload prefix).
const cronAddNameMaxRunes = 40

var (
	cronAddEvery    time.Duration
	cronAddBackoff  bool
	cronAddCronExpr string
	cronAddMin      time.Duration
	cronAddMax      time.Duration
	cronAddName     string
	cronAddDeliver  string
	cronAddIfAbsent string
	cronAddPinned   bool
	cronAddRole     string
	cronAddPane     string
)

var cronAddCmd = &cobra.Command{
	Use:   "add <payload> --every <dur> | --backoff | --cron \"<expr>\"",
	Short: "Add a cron entry to the server's intent file",
	Long: "Add a cron entry delivering <payload> on a schedule. Exactly one schedule " +
		"flag is required: --every <dur> (a positive Go duration like 1h or 90s), " +
		"--backoff (an operator-idle anchored ladder, 60s→30m by default; refine " +
		"with --min/--max), or --cron \"<expr>\" (a 5-field expression, stored as " +
		"intent — expression evaluation is not implemented yet). Run inside a tmux " +
		"pane, the creator is auto-captured from $TMUX_PANE and the target defaults " +
		"to role:operator when your window carries the operator role, else your own " +
		"pane; --role operator or --pane %N override. Outside tmux, --role or --pane " +
		"is required. --name defaults to a payload prefix; --deliver and --if-absent " +
		"values are validated now but enforced by the delivery wave.",
	Example: `  rk cron add "check PRs" --every 1h
  rk cron add "tick" --backoff --min 2m --max 30m
  rk cron add "nightly" --cron "0 3 * * *" --role operator`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runCronAdd(cmd, args[0])
	},
}

func init() {
	f := cronAddCmd.Flags()
	f.DurationVar(&cronAddEvery, "every", 0, "Fire on a fixed interval (Go duration, e.g. 1h, 90s)")
	f.BoolVar(&cronAddBackoff, "backoff", false, "Fire on an operator-idle backoff ladder (default 60s→30m)")
	f.StringVar(&cronAddCronExpr, "cron", "", "Store a 5-field cron expression as intent (not evaluated yet)")
	f.DurationVar(&cronAddMin, "min", time.Minute, "Backoff ladder minimum gap (with --backoff)")
	f.DurationVar(&cronAddMax, "max", 30*time.Minute, "Backoff ladder maximum gap (with --backoff)")
	f.StringVar(&cronAddName, "name", "", "Display name (default: a payload prefix)")
	f.StringVar(&cronAddDeliver, "deliver", cron.DeliverImmediate, "Delivery policy: immediate|when-idle")
	f.StringVar(&cronAddIfAbsent, "if-absent", cron.IfAbsentSkip, "Absent-target policy: skip|notify|respawn")
	f.BoolVar(&cronAddPinned, "pinned", false, "Pin the entry (exempt from orphan expiry)")
	f.StringVar(&cronAddRole, "role", "", "Target a server role (only: operator)")
	f.StringVar(&cronAddPane, "pane", "", "Target a pane id (%N)")
}

// Seams so runCronAdd is testable without a live tmux server: the clock, the
// caller's pane, and the caller-window role read.
var (
	cronNowFn      = time.Now
	cronTmuxPaneFn = func() string { return os.Getenv("TMUX_PANE") }
	// cronWindowRoleFn resolves the pane's window and reads its role option.
	// Any failure degrades the add to the pane target — the caller IS the
	// pane, so that fallback never guesses.
	cronWindowRoleFn = func(ctx context.Context, paneID, server string) (string, error) {
		windowID, err := tmux.WindowIDForPane(ctx, paneID, server)
		if err != nil {
			return "", err
		}
		return tmux.GetWindowOption(ctx, windowID, server, tmux.RoleOption)
	}
)

// cronAddTimeout bounds the auto-capture role read (the only subprocess the
// verb spawns; the write itself is local disk).
const cronAddTimeout = 5 * time.Second

func runCronAdd(cmd *cobra.Command, payload string) error {
	schedule, cronExprStored, err := cronAddSchedule(cmd)
	if err != nil {
		return err
	}
	if err := cronAddValidateEnum("--deliver", cronAddDeliver, cron.DeliverImmediate, cron.DeliverWhenIdle); err != nil {
		return err
	}
	if err := cronAddValidateEnum("--if-absent", cronAddIfAbsent, cron.IfAbsentSkip, cron.IfAbsentNotify, cron.IfAbsentRespawn); err != nil {
		return err
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, cronAddTimeout)
	defer cancel()

	slug, err := cronSlug()
	if err != nil {
		return err
	}
	sink := newSink(cmd)
	target, createdBy, err := cronAddTarget(ctx, slug, sink)
	if err != nil {
		return err
	}

	name := cronAddName
	if name == "" {
		name = truncateRunes(payload, cronAddNameMaxRunes)
	}

	dir, err := cronDir()
	if err != nil {
		return err
	}
	entry, err := cron.Add(dir, slug, cron.Entry{
		Name:      name,
		Schedule:  schedule,
		Target:    target,
		Payload:   payload,
		Deliver:   cronAddDeliver,
		IfAbsent:  cronAddIfAbsent,
		Pinned:    cronAddPinned,
		CreatedBy: createdBy,
	})
	if err != nil {
		return err
	}
	if cronExprStored {
		sink.Notef("note: --cron expressions are stored as intent but not evaluated yet; the entry goes live when expression evaluation ships\n")
	}
	sink.Dataf("%s %s [%s -> %s]\n", entry.ID, entry.Name, cronScheduleSummary(entry.Schedule), cronTargetSummary(entry.Target))
	return nil
}

// cronAddSchedule validates the schedule flag set and builds the schedule.
// Exactly one of --every/--backoff/--cron must be set; --min/--max are legal
// only alongside --backoff. The bool reports whether a cron expression was
// stored (the caller prints the not-evaluated note).
func cronAddSchedule(cmd *cobra.Command) (cron.Schedule, bool, error) {
	set := 0
	for _, name := range []string{"every", "backoff", "cron"} {
		if cmd.Flags().Changed(name) {
			set++
		}
	}
	if set != 1 {
		return cron.Schedule{}, false, usageError(fmt.Errorf("exactly one schedule flag is required: --every, --backoff, or --cron"))
	}
	if cmd.Flags().Changed("min") || cmd.Flags().Changed("max") {
		if !cmd.Flags().Changed("backoff") {
			return cron.Schedule{}, false, usageError(fmt.Errorf("--min/--max only apply with --backoff"))
		}
	}
	switch {
	case cmd.Flags().Changed("every"):
		if cronAddEvery <= 0 {
			return cron.Schedule{}, false, usageError(fmt.Errorf("--every must be a positive duration, got %s", cronAddEvery))
		}
		return cron.Schedule{Kind: cron.ScheduleEvery, Interval: cron.Duration{Duration: cronAddEvery}}, false, nil
	case cmd.Flags().Changed("backoff"):
		return cron.Schedule{
			Kind:   cron.ScheduleBackoff,
			Anchor: "operator-idle",
			Min:    cron.Duration{Duration: cronAddMin},
			Max:    cron.Duration{Duration: cronAddMax},
		}, false, nil
	default:
		return cron.Schedule{Kind: cron.ScheduleCron, Expr: cronAddCronExpr}, true, nil
	}
}

// cronAddValidateEnum gates a flag value against the schema's closed set at
// parse time (the schema carries but does not enforce these values).
func cronAddValidateEnum(flag, value string, valid ...string) error {
	for _, v := range valid {
		if value == v {
			return nil
		}
	}
	return usageError(fmt.Errorf("invalid %s value %q: want one of %v", flag, value, valid))
}

// cronAddTarget resolves the entry's target and creator provenance. Explicit
// flags win; else inside a pane the target defaults to role:operator when the
// caller's window holds the operator role, else the caller's pane; outside
// tmux an explicit flag is required (a typed command must not guess).
func cronAddTarget(ctx context.Context, slug string, sink outputSink) (cron.Target, cron.CreatedBy, error) {
	if cronAddRole != "" && cronAddPane != "" {
		return cron.Target{}, cron.CreatedBy{}, usageError(fmt.Errorf("--role and --pane are mutually exclusive"))
	}
	if cronAddRole != "" {
		if cronAddRole != cron.RoleOperator {
			return cron.Target{}, cron.CreatedBy{}, usageError(fmt.Errorf("invalid --role value %q: want %q", cronAddRole, cron.RoleOperator))
		}
	}
	if cronAddPane != "" && !tmux.ValidPaneID(cronAddPane) {
		return cron.Target{}, cron.CreatedBy{}, usageError(fmt.Errorf("invalid --pane value %q: want a %%N pane id", cronAddPane))
	}

	var createdBy cron.CreatedBy
	callerPane := cronTmuxPaneFn()
	if callerPane != "" {
		if !tmux.ValidPaneID(callerPane) {
			return cron.Target{}, cron.CreatedBy{}, fmt.Errorf("malformed $TMUX_PANE %q (want a %%N pane id)", callerPane)
		}
		createdBy = cron.CreatedBy{Pane: callerPane, At: cronNowFn().Unix()}
	}

	switch {
	case cronAddRole != "":
		return cron.Target{Kind: cron.TargetRole, Role: cronAddRole}, createdBy, nil
	case cronAddPane != "":
		return cron.Target{Kind: cron.TargetPane, Pane: cronAddPane}, createdBy, nil
	case callerPane == "":
		return cron.Target{}, cron.CreatedBy{}, usageError(fmt.Errorf("not inside a tmux pane ($TMUX_PANE is unset) — pass --role or --pane to name a target"))
	}

	role, err := cronWindowRoleFn(ctx, callerPane, slug)
	if err == nil && role == cron.RoleOperator {
		return cron.Target{Kind: cron.TargetRole, Role: cron.RoleOperator}, createdBy, nil
	}
	if err != nil {
		sink.Notef("window role unreadable (%v) — targeting pane %s\n", err, callerPane)
	}
	return cron.Target{Kind: cron.TargetPane, Pane: callerPane}, createdBy, nil
}

// truncateRunes returns s cut to at most n runes.
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
