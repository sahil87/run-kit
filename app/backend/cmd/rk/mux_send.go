package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"rk/internal/inject"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux send <target> — deliver a message into an agent's tmux pane, gated on
// the pane's @rk_agent_state, with probe-verified delivery (the chat-send
// injection engine in internal/inject — named-buffer bracketed paste, novelty
// echo probe, probe-gated Enter — never fab pane send's blind send-keys +
// trailing Enter). No daemon dependency: tmux is addressed directly from the
// caller's context (the rk present pattern).
//
// The gate matrix (fab-kit's idleGate verbatim) reads the reconciled
// @rk_agent_state:
//
//	state    | plain        | --answer
//	---------+--------------+--------------------------------
//	unknown  | warn + send  | warn + send
//	idle     | send         | send
//	waiting  | refuse       | send (this send IS the answer)
//	active   | refuse       | refuse (never interrupt a working agent)
//
// --force skips the gate (target existence is still validated); --answer and
// --force are mutually exclusive. Refusals name the state, print to stderr,
// exit 1. stdout carries exactly ONE report line: `delivered %N` (probe-
// confirmed submit), `staged %N` (--no-enter), `sent %N` (--key sends), or the
// await report word when --await is used. Exit codes follow the toolkit
// convention: 0 success, 1 operational failure, 2 usage.

// muxCmdTimeout caps each tmux subprocess the verbs spawn (Constitution §I:
// 5-10s for short-lived tmux helpers). The injection engine's probe sleeps
// additionally run under the caller's context.
const muxCmdTimeout = 5 * time.Second

var (
	muxSendKeysFlag    []string
	muxSendAnswerFlag  bool
	muxSendForceFlag   bool
	muxSendNoEnterFlag bool
	muxSendAwaitFlag   string
	muxSendTimeoutFlag int
)

// sendFlagAuto is the NoOptDefVal sentinel for --await (the present.go
// pattern): a bare --await parses to this sentinel (use the default state set)
// while --await=idle,waiting carries the set.
const sendFlagAuto = "\x00auto"

var muxSendCmd = &cobra.Command{
	Use:   "send <target> [<message> | -] [--key <key>]... [--answer | --force] [--no-enter] [--await[=<states>]] [--timeout <secs>]",
	Short: "Deliver a message into an agent's pane, gated on its agent state",
	Long: "Deliver a message into an agent's tmux pane with probe-verified delivery " +
		"(bracketed paste + echo probe + probe-gated Enter), gated on the pane's " +
		"@rk_agent_state: idle sends; waiting refuses unless --answer (this send IS " +
		"the answer it waits for); active always refuses; unknown warns and sends. " +
		"--force skips the gate.\n\n" +
		"Payload (exactly one): a positional message, `-` to read it from stdin, or " +
		"one or more --key <name> flags sending raw tmux key names (Enter, Up, C-c) " +
		"post-gate with no paste or probe. --no-enter stages the text without " +
		"submitting. --await[=<states>] (default idle,waiting) then blocks until the " +
		"peer reaches one of those states, printing the await report word; " +
		"--timeout bounds that wait (observer only).\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Args: usageArgs(cobra.RangeArgs(1, 2)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxSend(cmd, args)
	},
}

func init() {
	muxSendCmd.Flags().StringArrayVar(&muxSendKeysFlag, "key", nil,
		"Send a tmux key name instead of text (repeatable; e.g. --key Enter, --key C-c)")
	muxSendCmd.Flags().BoolVar(&muxSendAnswerFlag, "answer", false,
		"This send answers the target's pending question (a waiting pane accepts it)")
	muxSendCmd.Flags().BoolVar(&muxSendForceFlag, "force", false,
		"Skip the agent-state gate (the target must still exist)")
	muxSendCmd.Flags().BoolVar(&muxSendNoEnterFlag, "no-enter", false,
		"Stage the text in the input box without submitting (no Enter)")
	muxSendCmd.Flags().StringVar(&muxSendAwaitFlag, "await", "",
		"After submitting, block until the peer reaches one of these states (optional set; default idle,waiting)")
	muxSendCmd.Flags().Lookup("await").NoOptDefVal = sendFlagAuto
	muxSendCmd.Flags().IntVar(&muxSendTimeoutFlag, "timeout", awaitDefaultTimeoutSec,
		"Seconds the --await phase may run before reporting `running` (0 = indefinite)")
	muxSendCmd.MarkFlagsMutuallyExclusive("answer", "force")
}

// muxSend*Fn are package-level seams so runMuxSend can be tested without a
// live tmux server (the present.go/role.go pattern); the defaults delegate to
// internal/tmux / internal/inject / the rk notify send path.
var (
	muxSendEngineSendFn = func(ctx context.Context, engine *inject.Engine, t inject.Tmux, server, paneID, text string, submit bool) error {
		return engine.Send(ctx, t, server, paneID, text, submit)
	}
	muxSendKeysFn = func(ctx context.Context, paneID, server string, keys ...string) error {
		return tmux.SendKeysToPane(ctx, paneID, server, keys...)
	}
	muxSendAgentStateFn = func(ctx context.Context, paneID, server string) (string, error) {
		return tmux.PaneAgentState(ctx, paneID, server)
	}
	muxSendPaneExistsFn = func(ctx context.Context, paneID, server string) (bool, error) {
		return tmux.PaneExists(ctx, paneID, server)
	}
	muxSendResolveWindowFn = func(ctx context.Context, windowTarget, server string) (string, error) {
		return tmux.ResolveAgentPane(ctx, windowTarget, server)
	}
	muxAwaitObserveFn = func(ctx context.Context, deps awaitDeps, paneID string, p awaitParams) (string, error) {
		return awaitObserve(ctx, deps, paneID, p)
	}
	// muxStdinFn supplies the stdin reader for the `-` payload form (a var so
	// tests can feed a buffer).
	muxStdinFn = func() io.Reader { return os.Stdin }
	// muxBufferNameFn derives the CLI's per-invocation buffer name (never the
	// daemon's rk-chat-send — a CLI send can never clobber a concurrent daemon
	// send's buffer). A var so tests get a stable name.
	muxBufferNameFn = func() string { return fmt.Sprintf("rk-send-%d", os.Getpid()) }
)

// cliInjectTmux is the CLI's inject.Tmux substrate: name-parameterized buffer
// primitives straight from internal/tmux (the daemon's adapter ignores the
// name because its buffer is fixed; the CLI's per-invocation name rides it).
type cliInjectTmux struct{}

func (cliInjectTmux) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	return tmux.CapturePaneCtx(ctx, paneID, lines, server)
}
func (cliInjectTmux) SetBuffer(ctx context.Context, name, text, server string) error {
	return tmux.SetBufferCtx(ctx, name, text, server)
}
func (cliInjectTmux) PasteBuffer(ctx context.Context, name, paneID, server string) error {
	return tmux.PasteBufferCtx(ctx, name, paneID, server)
}
func (cliInjectTmux) SendEnter(ctx context.Context, paneID, server string) error {
	return tmux.SendEnterToPaneCtx(ctx, paneID, server)
}

// resolvePaneTarget resolves a parsed mux target to its pane ID: pane IDs pass
// through; window forms route to the window's agent pane (the pane carrying a
// known @rk_agent_state, falling back to the active pane).
func resolvePaneTarget(ctx context.Context, pt tmux.PaneTarget, server string) (string, error) {
	if pt.PaneID != "" {
		return pt.PaneID, nil
	}
	paneID, err := muxSendResolveWindowFn(ctx, pt.WindowTarget, server)
	if err != nil {
		return "", fmt.Errorf("resolve window target %s: %w", pt.WindowTarget, err)
	}
	return paneID, nil
}

// runMuxSend is the testable core: parse → payload XOR → resolve → gate →
// deliver → report → optionally await.
func runMuxSend(cmd *cobra.Command, args []string) error {
	pt, err := tmux.ParsePaneTarget(args[0])
	if err != nil {
		return usageError(err)
	}

	// Payload XOR (R3): exactly one of positional message / `-` stdin / --key.
	// cobra's MarkFlagsMutuallyExclusive already rejects --answer + --force.
	var message string
	hasMessage := len(args) == 2
	hasKeys := len(muxSendKeysFlag) > 0
	if hasMessage == hasKeys {
		return usageError(fmt.Errorf("exactly one payload is required: a positional message, `-` (stdin), or --key"))
	}
	if hasMessage {
		if args[1] == "-" {
			data, err := io.ReadAll(muxStdinFn())
			if err != nil {
				return fmt.Errorf("read message from stdin: %w", err)
			}
			message = inject.Sanitize(string(data))
		} else {
			message = inject.Sanitize(args[1])
		}
		if strings.TrimSpace(message) == "" {
			return usageError(fmt.Errorf("message text cannot be empty"))
		}
	}

	awaitRequested := cmd.Flags().Changed("await")
	if awaitRequested && muxSendNoEnterFlag {
		return usageError(fmt.Errorf("--await requires a submitted message — it cannot combine with --no-enter"))
	}
	if muxSendTimeoutFlag < 0 {
		return usageError(fmt.Errorf("--timeout must be >= 0 (0 = indefinite)"))
	}
	awaitStates := []string{tmux.AgentStateIdle, tmux.AgentStateWaiting}
	if awaitRequested && muxSendAwaitFlag != sendFlagAuto {
		if awaitStates, err = parseUntilStates(muxSendAwaitFlag); err != nil {
			return usageError(err)
		}
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	// The bounded ctx covers only the one-shot delivery phase (resolve → gate →
	// inject — a handful of tmux subprocesses plus the probe's settle/retry
	// sleeps). The --await composition below rides the PARENT context: a wait
	// may run for the full --timeout (default 300s, 0 = indefinite), and only
	// its individual tmux reads carry timeouts (see prodAwaitDeps).
	ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
	defer cancel()

	server := muxServer()
	sink := newSink(cmd)

	paneID, err := resolvePaneTarget(ctx, pt, server)
	if err != nil {
		return err
	}

	// The agent-state gate (R4). --force skips it but the target's existence is
	// still validated.
	if muxSendForceFlag {
		ok, err := muxSendPaneExistsFn(ctx, paneID, server)
		if err != nil {
			return fmt.Errorf("check target pane: %w", err)
		}
		if !ok {
			return fmt.Errorf("pane %s does not exist", paneID)
		}
	} else {
		state, err := muxSendAgentStateFn(ctx, paneID, server)
		if err != nil {
			return fmt.Errorf("read agent state: %w", err)
		}
		switch state {
		case "":
			sink.Notef("warning: pane %s has no readable agent state — sending ungated\n", paneID)
		case tmux.AgentStateIdle:
		case tmux.AgentStateWaiting:
			if !muxSendAnswerFlag {
				return fmt.Errorf("refusing to send to pane %s: agent is waiting (use --answer if this send is the answer it waits for)", paneID)
			}
		case tmux.AgentStateActive:
			return fmt.Errorf("refusing to send to pane %s: agent is active (never interrupt a working agent)", paneID)
		}
	}

	// Delivery (R5).
	var report string
	switch {
	case hasKeys:
		if err := muxSendKeysFn(ctx, paneID, server, muxSendKeysFlag...); err != nil {
			return fmt.Errorf("send-keys: %w", err)
		}
		report = "sent"
	default:
		engine := inject.NewEngine(muxBufferNameFn())
		err := muxSendEngineSendFn(ctx, engine, cliInjectTmux{}, server, paneID, message, !muxSendNoEnterFlag)
		if err != nil {
			var probeErr inject.ProbeFailure
			if errors.As(err, &probeErr) {
				// The 409's CLI analog: text stays staged in the composer, no
				// blind Enter, and the failure is visible to scripts (exit 1).
				return errors.New(probeErr.Error())
			}
			return err
		}
		report = "delivered"
		if muxSendNoEnterFlag {
			report = "staged"
		}
	}

	// Composed ask-and-wait (R6): the await report word replaces the delivery
	// report as stdout's single line. A report is printed even when the await
	// ends in an error (the `gone` contract: report on stdout, exit 1); when the
	// await fails WITHOUT a report (e.g. the pane is uninstrumented), the
	// delivery report still prints — the delivery succeeded, the wait failed.
	if awaitRequested {
		deliveryReport := report
		report, err = muxSendAwaitPeer(parent, cmd, server, paneID, awaitStates)
		if report == "" && err != nil {
			report = deliveryReport
		}
		if report != "" {
			sink.Dataf("%s %s\n", report, paneID)
		}
		return err
	}

	sink.Dataf("%s %s\n", report, paneID)
	return nil
}

// sendAwaitActiveGrace bounds the post-submit watch for the peer's state to
// flip to `active` before the await proper begins. The flip watch closes the
// stale-state race — a bare await fired right after a send would otherwise
// return instantly on the peer's PRE-SEND idle — and its expiry falls through
// to the await rather than erroring (hooks may lag, or the peer may finish
// within the grace window). A package var SOLELY so tests can shrink it.
var sendAwaitActiveGrace = 10 * time.Second

// muxSendAwaitPeer runs the composed --await: first watch for the pane's state
// to flip to active under a bounded grace, then run the await observer with the
// requested state set. The grace watch is the observer itself with
// until={active} and the grace as its timeout. Two grace outcomes fall through
// to the await rather than ending the composition: "running" (grace expired —
// hooks may lag, or the peer finished within the grace window) and the
// uninstrumented verdict (the pane carries no @rk_agent_state — the delivery
// already happened, and the await phase re-applies the uninstrumented rule
// itself in case state appeared in the meantime). A "gone" verdict (or a read
// failure) propagates as the final report — the peer died.
func muxSendAwaitPeer(ctx context.Context, cmd *cobra.Command, server, paneID string, states []string) (string, error) {
	deps := muxAwaitDepsFn(server)
	graceReport, err := muxAwaitObserveFn(ctx, deps, paneID, awaitParams{
		until:   []string{tmux.AgentStateActive},
		timeout: sendAwaitActiveGrace,
	})
	if err != nil && !errors.Is(err, errUnobservable) {
		return graceReport, err
	}
	// graceReport is "active" (flip observed) or "running" (grace expired) —
	// the race window is closed as well as it can be, either way.
	return muxAwaitObserveFn(ctx, deps, paneID, awaitParams{
		until:   states,
		timeout: time.Duration(muxSendTimeoutFlag) * time.Second,
	})
}
