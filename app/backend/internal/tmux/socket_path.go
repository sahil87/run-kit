package tmux

import (
	"context"
	"strings"
)

// socketPathQuery is the SocketPath exec seam — a package-level var (the
// sweepListServers/agentProcessAlive idiom) so tests substitute a fake and
// never touch a live server; production binds the server-addressed raw-exec
// core (argv slice, TMUX/TMUX_PANE-scrubbed env).
var socketPathQuery = tmuxExecRawServer

// SocketPath returns the named tmux server's socket path (#{socket_path}),
// trimmed of surrounding whitespace. The call is bounded to the TmuxTimeout
// tier on top of the caller's context. Errors propagate verbatim — the caller
// owns the degradation policy (a dead or unreachable server is a normal
// failure mode for this query).
func SocketPath(ctx context.Context, server string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	raw, err := socketPathQuery(ctx, server, "display-message", "-p", "#{socket_path}")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(raw), nil
}
