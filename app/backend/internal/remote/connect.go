package remote

import (
	"context"
	"fmt"
	"strconv"
)

// Progress receives human-readable progress lines during Connect — the CLI
// wires it to the chatter channel (stderr; --quiet drops it), the desktop
// shell streams the same lines to the welcome page's amber progress line.
type Progress func(format string, a ...any)

// ConnectResult is the outcome of a successful Connect.
type ConnectResult struct {
	// Remote is the resolved registration entry.
	Remote Remote
	// Origin is the stable local origin, http://127.0.0.1:<local_port>.
	Origin string
	// RemoteVersion is the remote rk version after any bootstrap/update.
	RemoteVersion string
	// Installed is true when connect bootstrapped rk onto the remote.
	Installed bool
	// Updated is true when connect re-ran the installer for an older remote.
	Updated bool
}

// Connect is the one idempotent get-in flow: ssh probe → install rk if
// missing → auto-update when the remote is older than local (never
// downgrade) → remote `rk daemon start` → derive the remote origin via
// `rk url` (never stored) → tunnel window up → local forward accepting.
//
// nameOrTarget resolves against the store (name match first, then verbatim
// target). localVersion is the running rk's version ("dev" skips the skew
// decision — a dev build cannot anchor a comparison).
func Connect(ctx context.Context, storePath, nameOrTarget, localVersion string, progress Progress) (ConnectResult, error) {
	if progress == nil {
		progress = func(string, ...any) {}
	}

	f, err := Load(storePath)
	if err != nil {
		return ConnectResult{}, err
	}
	r := f.Find(nameOrTarget)
	if r == nil {
		return ConnectResult{}, fmt.Errorf("no remote named %q — register it first: rk remote add <target>", nameOrTarget)
	}
	res := ConnectResult{Remote: *r, Origin: r.Origin()}

	// 1. Probe the remote rk.
	progress("connecting to %s…", r.Name)
	probe := sshExec(ctx, r.Target, remoteVersionCmd, sshProbeTimeout)
	if sshUnreachable(probe) {
		return ConnectResult{}, authFailureError(r.Target, probe)
	}

	// 2. Bootstrap when missing.
	if rkMissing(probe) {
		progress("installing rk on %s…", r.Name)
		install := sshExec(ctx, r.Target, remoteInstallCmd, sshInstallTimeout)
		if sshUnreachable(install) {
			return ConnectResult{}, authFailureError(r.Target, install)
		}
		if install.err != nil {
			return ConnectResult{}, fmt.Errorf("installing rk on %s failed: %s", r.Target, installFailureDetail(install))
		}
		res.Installed = true
		probe = sshExec(ctx, r.Target, remoteVersionCmd, sshProbeTimeout)
		if probe.err != nil {
			return ConnectResult{}, fmt.Errorf("rk still not runnable on %s after install: %s", r.Target, stderrTail(probe.stderr))
		}
	} else if probe.err != nil {
		return ConnectResult{}, fmt.Errorf("probing rk on %s failed: %s", r.Target, stderrTail(probe.stderr))
	}
	res.RemoteVersion = parseRemoteVersion(probe.stdout)

	// 3. Auto-update fold: only when the remote is OLDER than local. A newer
	// remote is left untouched (never downgrade); status output notes it.
	if !res.Installed && VersionOlder(res.RemoteVersion, localVersion) {
		progress("updating rk on %s (v%s → v%s)…", r.Name, res.RemoteVersion, parseRemoteVersion(localVersion))
		update := sshExec(ctx, r.Target, remoteInstallCmd, sshInstallTimeout)
		if sshUnreachable(update) {
			return ConnectResult{}, authFailureError(r.Target, update)
		}
		if update.err != nil {
			return ConnectResult{}, fmt.Errorf("updating rk on %s failed: %s", r.Target, installFailureDetail(update))
		}
		res.Updated = true
		if reprobe := sshExec(ctx, r.Target, remoteVersionCmd, sshProbeTimeout); reprobe.err == nil {
			res.RemoteVersion = parseRemoteVersion(reprobe.stdout)
		}
	}

	// 4. Remote daemon up. The daemon lives in tmux on the remote, so ssh
	// drops and laptop sleep lose nothing (Constitution VI). Already-running
	// (or an already-serving foreground serve) is success — the goal is a
	// serving remote, not a fresh process.
	progress("starting daemon on %s…", r.Name)
	start := sshExec(ctx, r.Target, remoteDaemonStartCmd, sshDaemonStartTimeout)
	if start.err != nil && !remoteDaemonAlreadyUp(start) {
		if sshUnreachable(start) {
			return ConnectResult{}, authFailureError(r.Target, start)
		}
		return ConnectResult{}, fmt.Errorf("starting the rk daemon on %s failed: %s", r.Target, stderrTail(start.stderr))
	}

	// 5. Derive the remote origin — request-time state, never persisted.
	urlRes := sshExec(ctx, r.Target, remoteURLCmd, sshProbeTimeout)
	if sshUnreachable(urlRes) {
		return ConnectResult{}, authFailureError(r.Target, urlRes)
	}
	if urlRes.err != nil {
		return ConnectResult{}, fmt.Errorf("deriving the remote origin (`rk url`) on %s failed: %s", r.Target, stderrTail(urlRes.stderr))
	}
	remotePort, err := parseRemotePort(urlRes.stdout)
	if err != nil {
		return ConnectResult{}, err
	}

	// 6. Tunnel window up — with the foreign-squatter guard: a listener on
	// the assigned port that is NOT our tunnel window means some other
	// process squats the stable origin. The port is immutable by design, so
	// this errors and tells; it never silently reassigns.
	localAddr := "127.0.0.1:" + strconv.Itoa(r.LocalPort)
	if TunnelUp(ctx, r.Name) {
		progress("tunnel already up on :%d", r.LocalPort)
	} else {
		if dialFn(localAddr, tunnelDialTimeout) {
			return ConnectResult{}, fmt.Errorf(
				"local port %d is in use by another process (not the %s tunnel) — its port is fixed to keep %s stable; stop the squatting process and rerun connect",
				r.LocalPort, r.Name, r.Origin())
		}
		progress("opening tunnel on :%d…", r.LocalPort)
		if err := openTunnel(ctx, r.Name, r.Target, r.LocalPort, remotePort); err != nil {
			return ConnectResult{}, err
		}
	}

	// 7. Wait for the forward to accept.
	if err := waitTunnelReady(ctx, r.Name, r.LocalPort); err != nil {
		return ConnectResult{}, err
	}
	return res, nil
}

// installFailureDetail prefers the stderr tail, falling back to the raw exec
// error so a silent installer failure still says something actionable.
func installFailureDetail(res execResult) string {
	if tail := stderrTail(res.stderr); tail != "" {
		return tail
	}
	if res.err != nil {
		return res.err.Error()
	}
	return "unknown error"
}

// Disconnect kills only the remote's tunnel window; the remote daemon keeps
// running. Idempotent — an absent window is success.
func Disconnect(ctx context.Context, storePath, name string) (Remote, error) {
	f, err := Load(storePath)
	if err != nil {
		return Remote{}, err
	}
	r := f.FindByName(name)
	if r == nil {
		return Remote{}, fmt.Errorf("no remote named %q", name)
	}
	if err := closeTunnel(ctx, r.Name); err != nil {
		return Remote{}, err
	}
	return *r, nil
}

// RemoveRemote disconnects and drops the entry from the store. The remote
// installation is untouched.
func RemoveRemote(ctx context.Context, storePath, name string) (Remote, error) {
	f, err := Load(storePath)
	if err != nil {
		return Remote{}, err
	}
	r := f.FindByName(name)
	if r == nil {
		return Remote{}, fmt.Errorf("no remote named %q", name)
	}
	removed := *r
	if err := closeTunnel(ctx, r.Name); err != nil {
		return Remote{}, err
	}
	next, _ := f.Remove(name)
	if err := Save(storePath, next); err != nil {
		return Remote{}, err
	}
	return removed, nil
}
