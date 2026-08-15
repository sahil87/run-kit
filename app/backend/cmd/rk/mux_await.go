package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux await <target> — block until any waitable signal fires on the target
// pane, then print a ONE-WORD report and exit. The agent-to-agent half of the
// conversation loop (rk mux send's counterpart): an already-fired signal
// returns immediately (first check before any sleep), and the timeout bounds
// the OBSERVER, never the pane.
//
// Reports: a state from --until (default idle) → that state, exit 0; --file
// appeared (OR-composed) → "file", exit 0; --timeout expired → "running",
// exit 0; the pane died mid-wait → "gone", exit 1 (a fired signal in the same
// tick wins over the death). An uninstrumented pane (no @rk_agent_state) with
// no --file errors immediately — there is nothing observable to wait on.
// --after-active requires observing `active` at least once before an --until
// state counts (the composable fix for the stale-state race when awaiting a
// pane that was just sent to outside `rk mux send --await`). --notify sends a
// Web Push when the signal fires — fail-silent per the rk notify contract.

// awaitCmdTimeout caps each tmux read the observer performs (Constitution §I:
// 5-10s for short-lived tmux helpers).
const awaitCmdTimeout = 5 * time.Second

var (
	awaitUntilFlag       string
	awaitFileFlag        string
	awaitAfterActiveFlag bool
	awaitTimeoutFlag     int
	awaitNotifyFlag      string
)

// awaitFlagAuto is the NoOptDefVal sentinel for --notify (the present.go
// pattern): a bare --notify parses to this sentinel (derive the default
// message) while --notify=x carries x.
const awaitFlagAuto = "\x00auto"

var muxAwaitCmd = &cobra.Command{
	Use:   "await <target> [--until <state>[,<state>]] [--file <path>] [--after-active] [--timeout <secs>] [--notify[=msg]]",
	Short: "Block until an agent pane reaches a state (or a file appears)",
	Long: "Block until any waitable signal fires on the target pane, then print a " +
		"one-word report and exit:\n" +
		"  <state>   the pane's @rk_agent_state reached a state in --until (default idle)\n" +
		"  file      the --file path appeared (OR-composed with the state signal)\n" +
		"  running   --timeout (default 300s, 0 = indefinite) expired — exit 0; the\n" +
		"            timeout bounds the observer, never the pane\n" +
		"  gone      the pane died mid-wait — exit 1\n\n" +
		"The first check runs before any sleep, so an already-fired signal returns " +
		"immediately. --after-active requires observing `active` before an --until " +
		"state counts (closes the stale-state race when awaiting right after a send " +
		"outside `rk mux send --await`). --notify sends a fail-silent Web Push when " +
		"the signal fires.\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxAwait(cmd, args[0])
	},
}

func init() {
	muxAwaitCmd.Flags().StringVar(&awaitUntilFlag, "until", tmux.AgentStateIdle,
		"Comma-separated agent states to wake on (active|waiting|idle)")
	muxAwaitCmd.Flags().StringVar(&awaitFileFlag, "file", "",
		"Also wake when this path appears (OR-composed with the state signal)")
	muxAwaitCmd.Flags().BoolVar(&awaitAfterActiveFlag, "after-active", false,
		"Require observing the active state before an --until state counts")
	muxAwaitCmd.Flags().IntVar(&awaitTimeoutFlag, "timeout", awaitDefaultTimeoutSec,
		"Seconds before reporting `running` (0 = wait indefinitely)")
	muxAwaitCmd.Flags().StringVar(&awaitNotifyFlag, "notify", "",
		"Send a Web Push when the signal fires (optional message; default \"agent <target> is <report>\")")
	muxAwaitCmd.Flags().Lookup("notify").NoOptDefVal = awaitFlagAuto
}

// awaitDeps are the observer's test seams (the present.go pattern): the
// defaults delegate to internal/tmux / the rk notify send path / the real
// clock, and tests substitute fakes so the whole contract runs tmux-free.
type awaitDeps struct {
	readState func(ctx context.Context, paneID string) (state string, gone bool, err error)
	fileStat  func(path string) bool
	sleep     func(ctx context.Context, d time.Duration) error
	now       func() time.Time
	notify    func(ctx context.Context, title, body string)
}

// muxAwaitDepsFn is the deps seam (the present.go pattern): production builds
// the real tmux/clock/notify deps via prodAwaitDeps; tests substitute fakes so
// the command path runs tmux-free.
var muxAwaitDepsFn = prodAwaitDeps

// prodAwaitDeps builds the production seams targeting the resolved server.
func prodAwaitDeps(server string) awaitDeps {
	return awaitDeps{
		// Each tmux read gets its OWN bounded context (awaitCmdTimeout) — the
		// observer loop itself rides the caller's (unbounded) context, so a wait
		// can outlive any single read by minutes (default --timeout 300s, 0 =
		// indefinite) while no individual read can hang the loop.
		readState: func(ctx context.Context, paneID string) (string, bool, error) {
			rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
			defer cancel()
			return muxReadPaneState(rctx, paneID, server)
		},
		fileStat: func(path string) bool {
			_, err := os.Stat(path)
			return err == nil
		},
		sleep:  sleepCtxCmd,
		now:    time.Now,
		notify: sendNotify,
	}
}

// muxReadPaneState is the production state read: a pane lookup that maps a
// "can't find pane" failure to gone=true (the pane died mid-wait), and the
// reconciled @rk_agent_state otherwise ("" = unknown/uninstrumented).
func muxReadPaneState(ctx context.Context, paneID, server string) (state string, gone bool, err error) {
	state, err = tmux.PaneAgentState(ctx, paneID, server)
	if err != nil && strings.Contains(err.Error(), "can't find pane") {
		return "", true, nil
	}
	return state, false, err
}

// awaitPollTick is the observer's internal poll cadence (~2s, matching the
// fab pane await precedent; an internal knob, not a flag). A package var
// SOLELY so tests can shrink it.
var awaitPollTick = 2 * time.Second

// awaitDefaultTimeoutSec is the default --timeout: the fab pane await
// contract's 300s, bounding the observer (never the pane). 0 = indefinite.
const awaitDefaultTimeoutSec = 300

// runMuxAwait is the testable core: parse → resolve → observe → report →
// optionally notify.
func runMuxAwait(cmd *cobra.Command, target string) error {
	pt, err := tmux.ParsePaneTarget(target)
	if err != nil {
		return usageError(err)
	}
	until, err := parseUntilStates(awaitUntilFlag)
	if err != nil {
		return usageError(err)
	}
	if awaitTimeoutFlag < 0 {
		return usageError(fmt.Errorf("--timeout must be >= 0 (0 = indefinite)"))
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	// Target RESOLUTION is a bounded tmux call; the observer loop below rides the
	// PARENT context (no command-level deadline) — a wait may legitimately run
	// for the full --timeout (default 300s, 0 = indefinite), so only the
	// individual tmux reads carry timeouts (see prodAwaitDeps).
	ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
	paneID, err := resolvePaneTarget(ctx, pt, muxServer())
	cancel()
	if err != nil {
		return err
	}

	deps := muxAwaitDepsFn(muxServer())
	report, err := awaitObserve(parent, deps, paneID, awaitParams{
		until:       until,
		file:        awaitFileFlag,
		afterActive: awaitAfterActiveFlag,
		timeout:     time.Duration(awaitTimeoutFlag) * time.Second,
	})

	sink := newSink(cmd)
	if report != "" {
		sink.Dataf("%s\n", report)
	}
	// --notify fires only on a REAL signal (never on a refusal-class error
	// before the wait even started), fail-silent per the rk notify contract.
	if report != "" && cmd.Flags().Changed("notify") {
		msg := awaitNotifyFlag
		if msg == awaitFlagAuto {
			msg = fmt.Sprintf("agent %s is %s", paneID, report)
		}
		deps.notify(parent, "", msg)
	}
	return err
}

// awaitParams are the observer's inputs, already flag-validated.
type awaitParams struct {
	until       []string      // the state set that wakes the observer
	file        string        // OR-composed file-appearance signal ("" = none)
	afterActive bool          // require an active sighting before until states count
	timeout     time.Duration // observer bound; 0 = indefinite
}

// awaitObserve runs the await observer loop and returns the report word plus
// the exit-classifying error (nil for idle/file/running; a plain operational
// error for gone, after the "gone" report is still returned for printing). The
// loop checks BEFORE sleeping so an already-fired signal returns immediately,
// and checks the file signal before the state read so a fired signal wins over
// a mid-tick pane death.
// errUnobservable marks the "nothing observable to wait on" verdict — an
// uninstrumented pane (no @rk_agent_state) with no --file. A sentinel so
// `rk mux send --await`'s grace watch can treat it as a fall-through (the
// delivery already happened; the await phase re-applies the rule itself).
var errUnobservable = errors.New("nothing observable to wait on")

func awaitObserve(ctx context.Context, deps awaitDeps, paneID string, p awaitParams) (string, error) {
	var deadline time.Time
	if p.timeout > 0 {
		deadline = deps.now().Add(p.timeout)
	}
	seenActive := false
	instrumentedChecked := false
	until := make(map[string]bool, len(p.until))
	for _, s := range p.until {
		until[s] = true
	}

	for {
		// 1. File signal first — a fired signal wins over a mid-tick pane death.
		if p.file != "" && deps.fileStat(p.file) {
			return "file", nil
		}
		// 2. State signal.
		state, gone, err := deps.readState(ctx, paneID)
		if err != nil {
			return "", fmt.Errorf("read pane state: %w", err)
		}
		if gone {
			return "gone", fmt.Errorf("pane %s is gone", paneID)
		}
		if !instrumentedChecked {
			instrumentedChecked = true
			// An uninstrumented pane with no --file has nothing observable to
			// wait on — error immediately rather than polling forever.
			if state == "" && p.file == "" {
				return "", fmt.Errorf("%w: pane %s carries no %s and no --file was given", errUnobservable, paneID, tmux.AgentStateOption)
			}
		}
		if state == tmux.AgentStateActive {
			seenActive = true
		}
		if until[state] && (!p.afterActive || seenActive) {
			return state, nil
		}
		// 3. Timeout — the observer's own bound; `running` is a report, not a
		// failure (exit 0).
		if p.timeout > 0 && !deps.now().Before(deadline) {
			return "running", nil
		}
		if err := deps.sleep(ctx, awaitPollTick); err != nil {
			return "", err
		}
	}
}

// parseUntilStates validates a --until value: a comma-separated set of known
// agent states, no duplicates, non-empty.
func parseUntilStates(s string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, tok := range strings.Split(s, ",") {
		tok = strings.TrimSpace(tok)
		switch tok {
		case tmux.AgentStateActive, tmux.AgentStateWaiting, tmux.AgentStateIdle:
			if seen[tok] {
				return nil, fmt.Errorf("--until lists %q twice", tok)
			}
			seen[tok] = true
			out = append(out, tok)
		default:
			return nil, fmt.Errorf("unknown --until state %q (valid: active, waiting, idle)", tok)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("--until must name at least one state")
	}
	return out, nil
}

// sleepCtxCmd sleeps for d, aborting early with ctx.Err() on cancellation —
// the await observer's tick and send's grace watch both wait through it.
func sleepCtxCmd(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
