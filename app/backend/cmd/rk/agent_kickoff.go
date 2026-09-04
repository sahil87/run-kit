package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rk/internal/inject"
)

// Shared plumbing for the agent-launching commands (`rk tutorial`,
// `rk operator`): both spawn a window with the restored caller $TMUX and hand
// a kickoff prompt to the inject composite through a per-command delivery
// seam. The helpers are parameterized on the captured $TMUX value so each
// command keeps its own OriginalTMUX test seam.

// kickoffDeliverFn is the per-command delivery seam shape (tutorialDeliverFn /
// operatorDeliverFn): production drives inject.DeliverWhenReady; tests
// substitute a recorder so the command path runs tmux-free.
type kickoffDeliverFn = func(ctx context.Context, engine *inject.Engine, t inject.Tmux, server, paneID, text string) (inject.Readiness, error)

// deliverAgentKickoff hands a kickoff prompt to the shared inject composite:
// inject.DeliverWhenReady waits for boot readiness (agent state present, else
// a settled screen) and then runs the engine's verified send (named-buffer
// bracketed paste, echo probe, probe-gated Enter). The CLI's per-invocation
// buffer (rk-send-<pid>, the `rk mux send` pattern) keeps a kickoff delivery
// from ever clobbering a concurrent daemon/mux-send buffer. The returned error
// is informational — callers degrade, it never fails the command.
func deliverAgentKickoff(parent context.Context, deliver kickoffDeliverFn, originalTMUX, paneID, prompt string, deadline, cmdTimeout time.Duration) error {
	// The context outlives the readiness wait by one command timeout so the
	// engine's own bounded subprocesses still fit after a slow boot.
	ctx, cancel := context.WithTimeout(parent, deadline+cmdTimeout)
	defer cancel()
	engine := inject.NewEngine(muxBufferNameFn())
	_, err := deliver(ctx, engine, awaitReadyTmux{}, cliServerLabel(originalTMUX), paneID, prompt)
	return err
}

// cliServerLabel derives the tmux server label the delivery calls target from
// a captured $TMUX value (the muxServer derivation): the socket basename is
// the -L label, and an empty/default socket means the default server.
func cliServerLabel(originalTMUX string) string {
	socket := originalTMUX
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	if socket == "" {
		return "default"
	}
	return filepath.Base(socket)
}

// cliChildEnv returns the subprocess env with a captured $TMUX restored
// (internal/tmux's init() strips it from the process) so bare tmux calls
// reach the caller's current server — the riff CLI-path pattern (childEnv
// with an empty server label).
func cliChildEnv(originalTMUX string) []string {
	env := os.Environ()
	if originalTMUX != "" {
		env = append(env, "TMUX="+originalTMUX)
	}
	return env
}
