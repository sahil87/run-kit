package main

// Own-tab and server resolution shared by rk present, the rk tab family, and
// rk code exec --tab (docs/specs/ui-state.md § Addressing Grammar): one code
// path derives the caller's tmux window and server — extracted from
// present.go so no verb carries a second copy.
//
// Server resolution follows the rk mux rule (mux.go muxServer): an explicit
// -L/--server wins; else the caller's own server derived from the ORIGINAL
// $TMUX socket basename; else "default". The own-tab path needs the -S socket
// prefix as well as the name (the pane id only exists on the caller's own
// socket); every downstream call then rides the internal/tmux -L primitives
// addressed by name.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rk/internal/tabaddr"
	"rk/internal/tmux"
	"rk/internal/validate"
)

// ownTabTimeout bounds the short tmux reads own-tab resolution spawns
// (Constitution §I: 5s for short-lived tmux helpers).
const ownTabTimeout = 5 * time.Second

// ownTabOriginalTMUXFn is the $TMUX seam (the present.go pattern):
// internal/tmux's init() strips $TMUX from the process, so the captured
// OriginalTMUX is fixed at package-init time and cannot be varied with
// t.Setenv.
var ownTabOriginalTMUXFn = func() string { return tmux.OriginalTMUX }

// ownTabRunOutputFn is the display-message read seam (the role.go /
// present.go pattern) so resolution is unit-testable without a live server.
var ownTabRunOutputFn = func(ctx context.Context, args []string) ([]byte, error) {
	return tmux.RunOutput(ctx, args, tmux.RunOpts{})
}

// callerContext resolves the caller's tmux context: the -S socket prefix from
// the ORIGINAL $TMUX (internal/tmux's init() strips $TMUX from the process)
// and the server name the -L primitives address it by (socket basename,
// matching ListServers naming). Returns ok=false when $TMUX is unset or
// malformed — the caller decides whether that is fatal.
func callerContext() (prefix []string, serverName string, ok bool) {
	tmuxEnv := ownTabOriginalTMUXFn()
	prefix = tmuxSocketArgs(tmuxEnv)
	if len(prefix) == 0 {
		return nil, "", false
	}
	socket := tmuxEnv
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	return prefix, filepath.Base(socket), true
}

// ownTabDisplayValue runs a display-message-style tmux read on the caller's
// own server (socket prefix) and returns the trimmed single-line output.
func ownTabDisplayValue(ctx context.Context, prefix []string, target, format string) (string, error) {
	args := append(append([]string{}, prefix...), "display-message", "-pt", target, format)
	out, err := ownTabRunOutputFn(ctx, args)
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "", fmt.Errorf("empty response from tmux")
	}
	return v, nil
}

// ownWindowID resolves the caller's own tmux window (@N) via $TMUX_PANE on
// the caller's own server. Returns an operational error (exit 1) when
// $TMUX_PANE is unset or $TMUX is malformed — the message names the fix (pass
// @N explicitly).
func ownWindowID(ctx context.Context) (windowID, server string, err error) {
	pane := os.Getenv("TMUX_PANE")
	if pane == "" {
		return "", "", fmt.Errorf("not inside a tmux pane ($TMUX_PANE is unset) — pass @N explicitly to name the tab")
	}
	prefix, serverName, ok := callerContext()
	if !ok {
		return "", "", fmt.Errorf("cannot derive this pane's tmux server socket from $TMUX (unset or malformed) — refusing to target the default server; pass @N with -L to name the tab")
	}
	ctx, cancel := context.WithTimeout(ctx, ownTabTimeout)
	defer cancel()
	id, err := ownTabDisplayValue(ctx, prefix, pane, "#{window_id}")
	if err != nil {
		return "", "", fmt.Errorf("resolve current window: %w", err)
	}
	if errMsg := validate.ValidateWindowID(id, "Window ID"); errMsg != "" {
		return "", "", fmt.Errorf("resolve current window: %s", errMsg)
	}
	return id, serverName, nil
}

// resolveTabWindow applies the address default: addr.WindowID (or a
// =session:window target, resolved via one display-message read) on the -L
// server or the caller's own server; else ownWindowID. The returned server
// name is what every internal/tmux -L primitive takes. When serverFlag names
// a server and the address carries no window, there is no "own tab" to fall
// back to — a usage error (exit 2).
func resolveTabWindow(ctx context.Context, addr tabaddr.Addr, serverFlag string) (windowID, server string, err error) {
	if addr.WindowID == "" {
		if serverFlag != "" {
			return "", "", usageError(fmt.Errorf("@N is required when --server names another server"))
		}
		return ownWindowID(ctx)
	}

	// Server: -L wins; else the caller's own server; else "default" (the
	// muxServer rule). A window id on another server never needs the caller's
	// socket prefix.
	server = serverFlag
	if server == "" {
		if _, serverName, ok := callerContext(); ok {
			server = serverName
		} else {
			server = "default"
		}
	}

	target := addr.WindowID
	if !strings.HasPrefix(target, "@") {
		// =session:window targets (the tmux.ParsePaneTarget "=" form) resolve
		// to a window id via one display-message read; anything else (a bare
		// session:window included) is a usage error, exactly as rk mux rejects
		// it — the documented session/window hijack footgun.
		pt, perr := tmux.ParsePaneTarget(target)
		if perr != nil || pt.WindowTarget == "" {
			return "", "", usageError(fmt.Errorf("invalid tab target %q: want @N or =session:window", target))
		}
		args := []string{"display-message", "-pt", target, "#{window_id}"}
		if server != "default" {
			args = append([]string{"-L", server}, args...)
		}
		ctx, cancel := context.WithTimeout(ctx, ownTabTimeout)
		defer cancel()
		out, rerr := ownTabRunOutputFn(ctx, args)
		if rerr != nil {
			return "", "", fmt.Errorf("resolve window %q: %w", target, rerr)
		}
		target = strings.TrimSpace(string(out))
	}
	if errMsg := validate.ValidateWindowID(target, "Window ID"); errMsg != "" {
		return "", "", fmt.Errorf("resolve window: %s", errMsg)
	}
	return target, server, nil
}
