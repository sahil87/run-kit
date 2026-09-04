package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"rk/internal/inject"
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
//
// --any generalizes the target to one-or-more panes (any-of wait): per sweep
// the first pane whose state is in --until wins and the report appends it
// ("waiting %5"); the first dead pane reports "gone %N" (exit 1) when no
// signal fired that sweep; "file"/"running" stay bare. --after-active is
// tracked PER PANE, and an uninstrumented member with no --file fails the
// whole arm on the first sweep. Two targets resolving to the same pane are a
// usage error. Without --any the contract is byte-identical to the
// single-target form.
//
// --ready is the boot-readiness condition (inject.AwaitReady): wait until a
// freshly spawned pane is safe to type into — its reconciled agent state is
// present (hooks fired ⇒ the TUI is up) or, for hook-less agents, a settled
// screen is classified by a sentinel echo probe: a harmless sentinel is pasted
// into the pane, an echo means a live input box, and no echo on a settled
// non-blank screen means the pane is parked behind a wall (a trust dialog,
// survey, or login wall that would eat a delivery). Reports "ready %N
// (state)" / "ready %N (echo)" / "parked %N" (exit 0, the screen snippet on
// stderr — classification is rk's, judging what the wall wants is the
// caller's); mutually exclusive with --until/--file/--after-active/--any
// (usage error, exit 2); --timeout expiry keeps the family contract
// ("running", exit 0), and a pane death mid-wait reports "gone" (exit 1). The
// sentinel is typed only into PRE-DELIVERY panes (no agent state yet, nothing
// delivered — state is re-checked before every probe); against a live
// delivered worker readiness verbs are illegal — use --until / capture.
// `parked` exits 0, so `&&`-composers must branch on the report word.

// awaitCmdTimeout caps each tmux read the observer performs (Constitution §I:
// 5-10s for short-lived tmux helpers).
const awaitCmdTimeout = 5 * time.Second

var (
	awaitUntilFlag       string
	awaitFileFlag        string
	awaitAfterActiveFlag bool
	awaitTimeoutFlag     int
	awaitNotifyFlag      string
	awaitAnyFlag         bool
	awaitReadyFlag       bool
)

// awaitFlagAuto is the NoOptDefVal sentinel for --notify (the present.go
// pattern): a bare --notify parses to this sentinel (derive the default
// message) while --notify=x carries x.
const awaitFlagAuto = "\x00auto"

var muxAwaitCmd = &cobra.Command{
	Use:   "await [--any] <target>... [--until <state>[,<state>]] [--file <path>] [--after-active] [--ready] [--timeout <secs>] [--notify[=msg]]",
	Short: "Block until an agent pane reaches a state (or a file appears)",
	Long: "Block until any waitable signal fires on the target pane, then print a " +
		"one-line report and exit:\n" +
		"  <state>   the pane's " + tmux.AgentStateOption + " reached a state in --until (default idle)\n" +
		"  file      the --file path appeared (OR-composed with the state signal)\n" +
		"  running   --timeout (default 300s, 0 = indefinite) expired — exit 0; the\n" +
		"            timeout bounds the observer, never the pane\n" +
		"  gone      the pane died mid-wait — exit 1\n\n" +
		"The first check runs before any sleep, so an already-fired signal returns " +
		"immediately. --after-active requires observing `active` before an --until " +
		"state counts (closes the stale-state race when awaiting right after a send " +
		"outside `rk mux send --await`). --notify sends a fail-silent Web Push when " +
		"the signal fires.\n\n" +
		"--ready instead waits for BOOT readiness — the moment a freshly spawned " +
		"agent is safe to type into: the pane's agent state is present (its hooks " +
		"fired) or, for hook-less agents, a settled screen is classified by a " +
		"sentinel echo probe — a harmless sentinel is pasted into the pane; an " +
		"echo means a live input box (`ready %N (echo)`), and no echo on a " +
		"settled non-blank screen means the pane is parked behind a wall " +
		"(`parked %N`, exit 0, the screen snippet on stderr so the caller can " +
		"judge what the wall wants). It reports `ready %N (state)`, `ready %N " +
		"(echo)`, or `parked %N` and cannot combine with " +
		"--until/--file/--after-active/--any. The sentinel is typed only into " +
		"pre-delivery panes (no agent state yet, nothing delivered) — against a " +
		"live delivered worker, use `await --until` / `capture` instead. " +
		"Composition for hook-less agents: `rk mux await --ready %5 && rk mux " +
		"send --force %5 '<prompt>'` — `parked` also exits 0, so `&&`-composers " +
		"must branch on the report word.\n\n" +
		"With --any the target is one-or-more panes and the observer wakes on the " +
		"FIRST to fire: state reports append the firing pane (`waiting %5`), a " +
		"death reports `gone %N` (exit 1) when no signal fired that sweep, and " +
		"`file`/`running` stay bare. --after-active is tracked per pane, an " +
		"uninstrumented member with no --file fails the whole arm, and two " +
		"targets resolving to the same pane are a usage error.\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Args: usageArgs(cobra.MinimumNArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxAwait(cmd, args)
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
	muxAwaitCmd.Flags().BoolVar(&awaitAnyFlag, "any", false,
		"Accept one-or-more targets and wake on the FIRST to fire (report appends the firing pane)")
	muxAwaitCmd.Flags().BoolVar(&awaitReadyFlag, "ready", false,
		"Wait until the pane is boot-ready for typed input (agent state present, else a sentinel echo probe: echo = ready, no echo = parked)")
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
// reconciled @rk_pane_agent_state otherwise ("" = unknown/uninstrumented).
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
func runMuxAwait(cmd *cobra.Command, args []string) error {
	if !awaitAnyFlag && len(args) != 1 {
		return usageError(fmt.Errorf("await takes exactly one target without --any (got %d)", len(args)))
	}
	// --ready is a boot-readiness wait on a single pane — mixing it with the
	// state/file conditions or the multi-target arm has no coherent semantics.
	if awaitReadyFlag && (cmd.Flags().Changed("until") || awaitFileFlag != "" || awaitAfterActiveFlag || awaitAnyFlag) {
		return usageError(fmt.Errorf("--ready cannot combine with --until, --file, --after-active, or --any"))
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
	server := muxServer()
	// Every target resolves to a pane ID up front, before the wait begins. Each
	// resolution is a bounded tmux call; the observer loop below rides the
	// PARENT context (no command-level deadline) — a wait may legitimately run
	// for the full --timeout (default 300s, 0 = indefinite), so only the
	// individual tmux reads carry timeouts (see prodAwaitDeps).
	panes := make([]string, 0, len(args))
	seen := make(map[string]string, len(args)) // pane ID → the arg that named it
	for _, arg := range args {
		pt, err := tmux.ParsePaneTarget(arg)
		if err != nil {
			return usageError(err)
		}
		ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
		paneID, err := resolvePaneTarget(ctx, pt, server)
		cancel()
		if err != nil {
			return err
		}
		if prev, dup := seen[paneID]; dup {
			return usageError(fmt.Errorf("duplicate target: %s and %s both resolve to pane %s", prev, arg, paneID))
		}
		seen[paneID] = arg
		panes = append(panes, paneID)
	}

	deps := muxAwaitDepsFn(server)
	if awaitReadyFlag {
		return runMuxAwaitReady(cmd, parent, server, panes[0], deps)
	}
	report, firedPane, err := awaitObserve(parent, deps, panes, awaitParams{
		until:       until,
		file:        awaitFileFlag,
		afterActive: awaitAfterActiveFlag,
		timeout:     time.Duration(awaitTimeoutFlag) * time.Second,
	})

	sink := newSink(cmd)
	line := report
	if awaitAnyFlag && firedPane != "" {
		line = report + " " + firedPane
	}
	if line != "" {
		sink.Dataf("%s\n", line)
	}
	// --notify fires only on a REAL signal (never on a refusal-class error
	// before the wait even started), fail-silent per the rk notify contract.
	if report != "" && cmd.Flags().Changed("notify") {
		msg := awaitNotifyFlag
		if msg == awaitFlagAuto {
			switch {
			case firedPane != "":
				msg = fmt.Sprintf("agent %s is %s", firedPane, report)
			case awaitAnyFlag:
				msg = fmt.Sprintf("await --any is %s", report)
			default:
				msg = fmt.Sprintf("agent %s is %s", panes[0], report)
			}
		}
		deps.notify(parent, "", msg)
	}
	return err
}

// muxAwaitReadyFn is the --ready wait seam (the muxAwaitDepsFn pattern):
// production waits via inject.AwaitReady with the reconciled state reader, the
// "can't find pane" gone predicate (the muxReadPaneState mapping), a
// per-invocation sentinel buffer name, and per-read bounds; tests substitute a
// fake. A --timeout of 0 (indefinite, the family contract) re-arms the bounded
// primitive after each ErrNotReady pass; parked and gone break the loop, and
// any other timeout becomes the wait's deadline.
var muxAwaitReadyFn = func(ctx context.Context, server, paneID string, timeout time.Duration) (inject.Readiness, error) {
	opts := inject.ReadyOpts{
		State:      boundedPaneAgentState,
		IsGone:     func(err error) bool { return strings.Contains(err.Error(), "can't find pane") },
		BufferName: muxReadyBufferNameFn(),
	}
	if timeout > 0 {
		opts.Deadline = timeout
	}
	for {
		readiness, err := inject.AwaitReady(ctx, awaitReadyTmux{}, server, paneID, opts)
		if err == nil || !errors.Is(err, inject.ErrNotReady) || timeout > 0 {
			return readiness, err
		}
		if err := ctx.Err(); err != nil {
			return 0, err
		}
	}
}

// muxReadyBufferNameFn derives the sentinel probe's per-invocation buffer name
// (the muxBufferNameFn pattern) so a probe never clobbers a concurrent send
// buffer. A var SOLELY so tests can pin it.
var muxReadyBufferNameFn = func() string { return fmt.Sprintf("rk-ready-%d", os.Getpid()) }

// boundedPaneAgentState is the --ready state reader: the reconciled
// @rk_pane_agent_state, each read under its own short timeout (the await
// observer's per-read discipline — the wait itself may run unbounded).
func boundedPaneAgentState(ctx context.Context, paneID, server string) (string, error) {
	rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
	defer cancel()
	return tmux.PaneAgentState(rctx, paneID, server)
}

// awaitReadyTmux bounds each readiness capture AND sentinel-probe primitive
// (the probe pastes and C-u-clears through SetBuffer/PasteBuffer/SendKeys)
// under its own short timeout. SendEnter and PasteBufferRaw delegate to the
// CLI's shared adapter — unused by AwaitReady, exercised when the same adapter
// feeds a delivery.
type awaitReadyTmux struct{ cliInjectTmux }

func (awaitReadyTmux) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
	defer cancel()
	return tmux.CapturePaneCtx(rctx, paneID, lines, server)
}

func (a awaitReadyTmux) SetBuffer(ctx context.Context, name, text, server string) error {
	rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
	defer cancel()
	return a.cliInjectTmux.SetBuffer(rctx, name, text, server)
}

func (a awaitReadyTmux) PasteBuffer(ctx context.Context, name, paneID, server string) error {
	rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
	defer cancel()
	return a.cliInjectTmux.PasteBuffer(rctx, name, paneID, server)
}

func (a awaitReadyTmux) SendKeys(ctx context.Context, paneID, server string, keys ...string) error {
	rctx, cancel := context.WithTimeout(ctx, awaitCmdTimeout)
	defer cancel()
	return a.cliInjectTmux.SendKeys(rctx, paneID, server, keys...)
}

// runMuxAwaitReady runs the --ready condition: block until the target pane is
// boot-ready, report the outcome (`ready %N (state)` / `ready %N (echo)` /
// `parked %N` — exit 0, with the parked screen snippet on stderr so the caller
// can judge what the wall wants; `gone` — exit 1), and honor the family's
// timeout report (`running`, exit 0) and --notify machinery (fired on every
// report, fail-silent per the rk notify contract).
func runMuxAwaitReady(cmd *cobra.Command, parent context.Context, server, paneID string, deps awaitDeps) error {
	timeout := time.Duration(awaitTimeoutFlag) * time.Second
	readiness, err := muxAwaitReadyFn(parent, server, paneID, timeout)

	sink := newSink(cmd)
	var line string
	var reportErr error
	switch {
	case err == nil:
		signal := "state"
		if readiness == inject.ReadyByEcho {
			signal = "echo"
		}
		line = fmt.Sprintf("ready %s (%s)", paneID, signal)
	case errors.Is(err, inject.ErrNotReady):
		// The family's timeout contract: `running` is a report, not a failure.
		line = "running"
	case errors.Is(err, inject.ErrParked):
		// Parked is wake-worthy and returns immediately: the caller must act.
		// Classification succeeded, so this is a report (exit 0), not a
		// failure; the snippet rides stderr as diagnostics. The snippet is
		// the caller's evidence for judging the wall, so it is written
		// ungated — --quiet drops chatter, never actionable diagnostics.
		var parked *inject.ParkedError
		if errors.As(err, &parked) && parked.Snippet != "" {
			fmt.Fprintf(cmd.ErrOrStderr(), "%s\n", parked.Snippet)
		}
		line = fmt.Sprintf("parked %s", paneID)
	case errors.Is(err, inject.ErrGone):
		// The family's death contract: report `gone`, exit 1 with diagnostics.
		line = "gone"
		reportErr = err
	default:
		return err
	}
	sink.Dataf("%s\n", line)
	// --notify fires on the report, fail-silent per the rk notify contract.
	if cmd.Flags().Changed("notify") {
		msg := awaitNotifyFlag
		if msg == awaitFlagAuto {
			msg = fmt.Sprintf("agent %s is %s", paneID, strings.Fields(line)[0])
		}
		deps.notify(parent, "", msg)
	}
	return reportErr
}

// awaitParams are the observer's inputs, already flag-validated.
type awaitParams struct {
	until       []string      // the state set that wakes the observer
	file        string        // OR-composed file-appearance signal ("" = none)
	afterActive bool          // require an active sighting before until states count
	timeout     time.Duration // observer bound; 0 = indefinite
}

// awaitObserve runs the await observer loop over the pane set and returns the
// report word, the firing pane ("" for file/running and for read/timeout-class
// errors), plus the exit-classifying error (nil for state/file/running; a
// plain operational error for gone, after the "gone" report is still returned
// for printing). Each sweep checks BEFORE sleeping so an already-fired signal
// returns immediately, and checks the file signal before the state reads so a
// fired signal wins over a mid-sweep pane death. Within a sweep a death only
// records the first gone pane — a state signal on a later member still wins.
// The first sweep is also the arm validation: a match there is held until
// every member proved observable, and the unobservable error outranks it.
// errUnobservable marks the "nothing observable to wait on" verdict — an
// uninstrumented pane (no @rk_agent_state) with no --file. A sentinel so
// `rk mux send --await`'s grace watch can treat it as a fall-through (the
// delivery already happened; the await phase re-applies the rule itself).
var errUnobservable = errors.New("nothing observable to wait on")

func awaitObserve(ctx context.Context, deps awaitDeps, panes []string, p awaitParams) (string, string, error) {
	var deadline time.Time
	if p.timeout > 0 {
		deadline = deps.now().Add(p.timeout)
	}
	seenActive := make(map[string]bool, len(panes)) // --after-active is per pane
	instrumentedChecked := false
	until := make(map[string]bool, len(p.until))
	for _, s := range p.until {
		until[s] = true
	}

	for {
		// 1. File signal first — a fired signal wins over a mid-sweep pane death.
		if p.file != "" && deps.fileStat(p.file) {
			return "file", "", nil
		}
		// 2. State sweep — panes in listed order; the first --until match wins.
		// The FIRST sweep doubles as the arm validation: a match found there is
		// held until every member has been checked observable, so an
		// uninstrumented member fails the whole arm even when an earlier pane
		// has already fired (the unobservable error outranks a held match).
		firstSweep := !instrumentedChecked
		gonePane := ""
		heldState, heldPane := "", ""
		for _, paneID := range panes {
			state, gone, err := deps.readState(ctx, paneID)
			if err != nil {
				return "", "", fmt.Errorf("read pane state: %w", err)
			}
			if gone {
				if gonePane == "" {
					gonePane = paneID
				}
				continue
			}
			if firstSweep && state == "" && p.file == "" {
				// An uninstrumented pane with no --file has nothing observable
				// to wait on — error immediately rather than polling forever.
				return "", "", fmt.Errorf("%w: pane %s carries no %s and no --file was given", errUnobservable, paneID, tmux.AgentStateOption)
			}
			if state == tmux.AgentStateActive {
				seenActive[paneID] = true
			}
			if until[state] && (!p.afterActive || seenActive[paneID]) {
				if !firstSweep {
					return state, paneID, nil
				}
				if heldPane == "" {
					heldState, heldPane = state, paneID
				}
			}
		}
		instrumentedChecked = true
		if heldPane != "" {
			return heldState, heldPane, nil
		}
		// 3. Death — reported only when no signal fired this sweep.
		if gonePane != "" {
			return "gone", gonePane, fmt.Errorf("pane %s is gone", gonePane)
		}
		// 4. Timeout — the observer's own bound; `running` is a report, not a
		// failure (exit 0).
		if p.timeout > 0 && !deps.now().Before(deadline) {
			return "running", "", nil
		}
		if err := deps.sleep(ctx, awaitPollTick); err != nil {
			return "", "", err
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
