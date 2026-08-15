package main

import (
	"path/filepath"
	"strings"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux — the tmux-substrate command family (docs/specs/cli-layering.md):
// operations that talk to tmux directly from the caller's context, with no
// daemon dependency. This change creates the family with two members — `send`
// (deliver a message into an agent pane, gated on its @rk_agent_state) and
// `await` (block until a pane's agent state or a file signal fires). Moving
// the existing root-level tmux commands (reaper, snapshot, tmux-guard,
// init-conf) under mux is future work owned by cli-layering.md.
//
// The family parent carries the shared persistent -L/--server flag (the
// `fab pane` pattern): both subcommands inherit it. Server resolution order:
// -L wins, else the caller's own server derived from the original $TMUX
// (socket basename — the same name ListServers and the -L primitives use),
// else the default server.

var muxServerFlag string

var muxCmd = &cobra.Command{
	Use:   "mux",
	Short: "Tmux substrate operations (agent-to-agent messaging)",
	Long: "Tmux substrate operations that talk to tmux directly from the caller's " +
		"context — no daemon dependency. `send` delivers a message into an agent's " +
		"pane gated on its @rk_agent_state, with probe-verified delivery; `await` " +
		"blocks until a pane's agent state (or a file signal) fires.",
}

func init() {
	muxCmd.PersistentFlags().StringVarP(&muxServerFlag, "server", "L", "",
		"tmux server name (default: the caller's own server from $TMUX, else the default server)")
	muxCmd.AddCommand(muxSendCmd)
	muxCmd.AddCommand(muxAwaitCmd)
}

// muxOriginalTMUXFn is the $TMUX seam (the present.go pattern): internal/tmux's
// init() strips $TMUX from the process, so the captured OriginalTMUX is fixed
// at package-init time and cannot be varied with t.Setenv.
var muxOriginalTMUXFn = func() string { return tmux.OriginalTMUX }

// muxServer resolves the tmux server the mux verbs target: -L wins; else the
// caller's own server derived from the original $TMUX socket basename; else the
// default server. The $TMUX derivation (not -S socket prefixing) keeps every
// downstream call on the internal/tmux -L primitives, so CLI and daemon address
// servers by the same names.
func muxServer() string {
	if muxServerFlag != "" {
		return muxServerFlag
	}
	tmuxEnv := muxOriginalTMUXFn()
	if tmuxEnv == "" {
		return "default"
	}
	socket := tmuxEnv
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	if socket == "" {
		return "default"
	}
	return filepath.Base(socket)
}
