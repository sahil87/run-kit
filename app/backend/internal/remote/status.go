package remote

import (
	"context"
	"encoding/json"
)

// Daemon-state classifications for list/status output. Derived per request
// via ssh probe — nothing is cached or stored.
const (
	DaemonRunning     = "running"
	DaemonStopped     = "stopped"
	DaemonNoRK        = "no rk"
	DaemonUnreachable = "unreachable"
)

// State is the derived, request-time view of one remote.
type State struct {
	Remote Remote
	// TunnelUp is derived from the rk-remotes tmux session.
	TunnelUp bool
	// Daemon is one of the Daemon* classifications.
	Daemon string
	// RemoteVersion is the remote rk version ("" when unknown/no rk).
	RemoteVersion string
}

// daemonStatusEnvelope is the fragment of `rk daemon status --json` this
// package reads.
type daemonStatusEnvelope struct {
	Daemon struct {
		Running bool `json:"running"`
	} `json:"daemon"`
}

// Inspect derives one remote's full state: tunnel from tmux, daemon state and
// version over a single-probe-each ssh pass. tunnels comes from ListTunnels
// so callers iterating many remotes pay one tmux roundtrip total.
func Inspect(ctx context.Context, r Remote, tunnels map[string]bool) State {
	st := State{Remote: r, TunnelUp: tunnels[r.Name]}

	probe := sshExec(ctx, r.Target, remoteVersionCmd, sshProbeTimeout)
	switch {
	case sshUnreachable(probe):
		st.Daemon = DaemonUnreachable
		return st
	case rkMissing(probe):
		st.Daemon = DaemonNoRK
		return st
	case probe.err != nil:
		st.Daemon = DaemonUnreachable
		return st
	}
	st.RemoteVersion = parseRemoteVersion(probe.stdout)

	status := sshExec(ctx, r.Target, remoteDaemonJSONCmd, sshProbeTimeout)
	if status.err != nil {
		st.Daemon = DaemonUnreachable
		return st
	}
	var env daemonStatusEnvelope
	if err := json.Unmarshal([]byte(status.stdout), &env); err != nil {
		st.Daemon = DaemonUnreachable
		return st
	}
	if env.Daemon.Running {
		st.Daemon = DaemonRunning
	} else {
		st.Daemon = DaemonStopped
	}
	return st
}
