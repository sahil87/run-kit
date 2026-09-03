package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var sayCmd = &cobra.Command{
	Use:   "say <text>",
	Short: "Speak a one-line reply to the user through the run-kit dashboard",
	Long: "Send a one-line spoken reply via the local run-kit server — the " +
		"operator's voice channel back to the user (a dashboard card + speech " +
		"when voice is enabled, a Web Push notification otherwise). Fail-silent: " +
		"if the server is unreachable or returns an error, the command exits 0 " +
		"and prints nothing, so it never stalls a calling process.",
	Args: cobra.ExactArgs(1),
	// SilenceErrors/SilenceUsage: the fail-silent contract means we never want
	// cobra to print an error or usage on a failed send. RunE always returns nil.
	SilenceErrors: true,
	SilenceUsage:  true,
	RunE: func(cmd *cobra.Command, args []string) error {
		sendSay(cmd.Context(), args[0])
		return nil
	},
}

// sayOriginalTMUXFn / sayRunOutputFn are the package-level seams for the
// tmux-context derivation (the origin.go idiom): internal/tmux's init() strips
// $TMUX from the process, so the captured OriginalTMUX is fixed at package-init
// time and cannot be varied with t.Setenv.
var (
	sayOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
	sayRunOutputFn    = func(ctx context.Context, args []string) ([]byte, error) {
		return tmux.RunOutput(ctx, args, tmux.RunOpts{})
	}
)

// sendSay POSTs {text, server?, window?} to the local server's /api/say,
// targeting the origin resolveOrigin() derives for the caller. server/window
// ride along when the CLI runs inside a tmux pane (the caller's own server and
// @N window — the push deep link's destination); any derivation failure omits
// both. It is fail-silent by design: any error (unreachable server, non-2xx,
// timeout, undecodable context) is swallowed and produces no output.
func sendSay(parent context.Context, text string) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, notifyTimeout)
	defer cancel()

	payload := map[string]string{"text": text}
	if server, window, ok := sayTmuxContext(ctx); ok {
		payload["server"] = server
		payload["window"] = window
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resolveOrigin(ctx)+"/api/say", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return // server unreachable / timeout — fail silent
	}
	defer resp.Body.Close()
	// Non-2xx is also swallowed: nothing is surfaced, exit 0.
}

// sayTmuxContext derives the caller's tmux server (the $TMUX socket basename —
// the same name the mux verbs and ListServers use) and @N window id (one
// display-message against the caller's pane). The third return is false — and
// both fields are omitted — on any derivation failure: not inside tmux, a
// malformed $TMUX, no $TMUX_PANE, a failed read, or an implausible window id.
func sayTmuxContext(ctx context.Context) (server, window string, ok bool) {
	tmuxEnv := sayOriginalTMUXFn()
	prefix := tmuxSocketArgs(tmuxEnv)
	if len(prefix) == 0 {
		return "", "", false
	}
	socket := tmuxEnv
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	server = filepath.Base(socket)

	pane := os.Getenv("TMUX_PANE")
	if pane == "" {
		return "", "", false
	}
	readCtx, cancel := context.WithTimeout(ctx, muxCmdTimeout)
	defer cancel()
	out, err := sayRunOutputFn(readCtx, append(prefix, "display-message", "-pt", pane, "#{window_id}"))
	if err != nil {
		return "", "", false
	}
	window = strings.TrimSpace(string(out))
	if !tmux.ValidWindowID(window) {
		return "", "", false
	}
	return server, window, true
}
