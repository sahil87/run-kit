package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"rk/internal/validate"
)

// JobsSessionName is the tmux session hosting daemon-managed job windows
// (update, restart). It is a SIBLING session on the rk-daemon socket — the
// rk-code-server / rk-remotes precedent — never a window inside the rk-daemon
// session: daemon.Stop()'s exact-match =rk-daemon kill never touches it, so a
// job window survives the daemon restart the job itself triggers (the
// load-bearing property for `rk daemon restart` running as a job).
const JobsSessionName = "rk-jobs"

// JobTarget identifies a spawned (or found in-flight) job window — enough for
// callers (API handlers, the CLI) to build a dashboard link or a one-line
// report.
type JobTarget struct {
	Server   string // tmux socket name: "rk-daemon"
	Session  string // JobsSessionName
	Window   string // job name, e.g. "update"
	WindowID string // tmux window id, e.g. "@5"
}

// jobDaemonRunning probes daemon liveness. A package seam (mirroring
// codeServerSessionExists) so tests drive the gate without a live tmux server.
var jobDaemonRunning = func(ctx context.Context) bool {
	return isRunningCtx(ctx)
}

// jobSessionExists reports whether the named session exists on the daemon
// socket. A package seam for the same reason as jobDaemonRunning.
var jobSessionExists = func(ctx context.Context, name string) bool {
	return sessionExistsCtx(ctx, name)
}

// jobWindowState queries a job window: exists, dead (remained-on-exit pane),
// and its window id. One display-message call carries both format fields; an
// error (window absent — "can't find window") maps to exists=false. A package
// seam so tests drive the three dedup branches without a live tmux server.
var jobWindowState = func(ctx context.Context, target string) (id string, dead bool, exists bool) {
	out, err := runTmuxOutput(ctx, "display-message", "-p", "-t", target, "#{window_id} #{pane_dead}")
	if err != nil {
		return "", false, false
	}
	fields := strings.Fields(string(out))
	if len(fields) != 2 {
		return "", false, false
	}
	return fields[0], fields[1] == "1", true
}

// jobRunTmux / jobRunTmuxOutput are the package seams over the runTmux/
// runTmuxOutput runners (exec.CommandContext + argv + caller-bounded ctx,
// Constitution I) so tests capture argv without a live tmux server.
var jobRunTmux = runTmux
var jobRunTmuxOutput = runTmuxOutput

// jobUserHomeDir resolves the user's home for the durable job log path. A
// package seam (mirroring codeServerUserHomeDir) so tests point the log at a
// temp dir and never touch the real ~/.rk.
var jobUserHomeDir = os.UserHomeDir

// shellQuote single-quotes s for a POSIX shell (pipe-pane's command string is
// shell-interpreted by tmux), escaping embedded single quotes with the
// canonical '\'' sequence — paths like /Users/Jane Doe survive intact.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// jobTargetFor returns the exact-match window target (=rk-jobs:=<window>) used
// for every dedup/probe/kill/options call — prefix-match hijack is the class
// of footgun the `=` anchors exist to prevent (tmux-sessions memory).
func jobTargetFor(window string) string {
	return "=" + JobsSessionName + ":=" + window
}

// RunJob runs argv in the managed window named `window` of the rk-jobs sibling
// session on the rk-daemon socket, returning the window's identity.
//
// started=false with a nil error means a LIVE job window with that name
// already exists (in-flight): its target is returned so callers can surface it
// and NO second window is spawned. An error means the job did not start.
//
// Semantics, in order:
//
//  1. Daemon gate: the daemon must be running — otherwise error. Any tmux
//     command on a dead socket would silently BIRTH a server; the gate refuses
//     instead of paying that side effect (no fallback fork, intake decision 1).
//  2. Session ensure: rk-jobs is created (new-session -d) when absent.
//  3. Window dedup on the exact-match target: a live pane → in-flight, return
//     started=false; a dead pane (remained after a failed run — remain-on-exit
//     failed) → kill-window and respawn (reap-on-rerun, intake decision 5);
//     absent → spawn fresh.
//  4. Spawn: new-window -d … -P -F '#{window_id}' <argv…>. tmux joins the
//     trailing argv words with spaces into its own sh -c — the same boundary
//     the shipped codeserver spawn crosses; every word is rk-controlled or
//     validated upstream (ValidateToolName on manifest tool names).
//  5. Post-spawn window options, BEST-EFFORT (warn-only, never fail the
//     spawn): remain-on-exit failed (pane persists only on non-zero exit,
//     tmux ≥ 3.2) and a pipe-pane tee to ~/.rk/<window>.log for durable log
//     continuity with the pre-window update.log/restart.log paths.
//
// The window name is validated before it becomes a tmux target or a pipe-pane
// shell-string component (Constitution I) — the same identifier class as
// validate.ValidateToolName (CLI users supply it via rk daemon run --window).
func RunJob(ctx context.Context, window string, argv []string) (target JobTarget, started bool, err error) {
	target = JobTarget{Server: serverSocket, Session: JobsSessionName, Window: window}

	if msg := validate.ValidateToolName(window); msg != "" {
		return target, false, fmt.Errorf("invalid job window name %q: %s", window, msg)
	}
	if len(argv) == 0 {
		return target, false, fmt.Errorf("no command given for job window %q", window)
	}

	// Every tmux call below shares ONE cmdTimeout-bounded context derived from
	// the caller's — deliberately NOT Stop's per-command-context pattern: the
	// single budget bounds the whole gate→ensure→dedup→spawn→options sequence,
	// so an API handler calling RunJob blocks at most one cmdTimeout end-to-end
	// rather than accumulating a fresh budget per command.
	cmdCtx, cancel := context.WithTimeout(ctx, cmdTimeout)
	defer cancel()

	// 1. Daemon gate — never birth a tmux server as a side effect.
	if !jobDaemonRunning(cmdCtx) {
		return target, false, fmt.Errorf("rk daemon is not running — start it with `rk serve -d`")
	}

	// 2. Session ensure (sibling of rk-daemon on the same socket).
	if !jobSessionExists(cmdCtx, JobsSessionName) {
		if err := jobRunTmux(cmdCtx, "new-session", "-d", "-s", JobsSessionName); err != nil {
			// A concurrent RunJob can win the create race — that is the ensured
			// state, not a failure.
			if !strings.Contains(err.Error(), "duplicate session") {
				return target, false, fmt.Errorf("creating %s session: %w", JobsSessionName, err)
			}
		}
	}

	// 3. Window dedup (exact-match targets throughout).
	winTarget := jobTargetFor(window)
	if id, dead, exists := jobWindowState(cmdCtx, winTarget); exists {
		if !dead {
			// In-flight: hand back the live window, spawn nothing.
			target.WindowID = id
			return target, false, nil
		}
		// Stale failed window (remained on non-zero exit): reap and respawn.
		if err := jobRunTmux(cmdCtx, "kill-window", "-t", winTarget); err != nil {
			return target, false, fmt.Errorf("reaping stale %q job window: %w", window, err)
		}
	}

	// 4. Spawn.
	spawnArgs := []string{"new-window", "-d", "-t", "=" + JobsSessionName + ":", "-n", window, "-P", "-F", "#{window_id}"}
	spawnArgs = append(spawnArgs, argv...)
	out, err := jobRunTmuxOutput(cmdCtx, spawnArgs...)
	if err != nil {
		return target, false, fmt.Errorf("spawning %q job window: %w", window, err)
	}
	target.WindowID = strings.TrimSpace(string(out))

	// 5. Post-spawn window options — best-effort, warn-only.
	if err := jobRunTmux(cmdCtx, "set-option", "-w", "-t", winTarget, "remain-on-exit", "failed"); err != nil {
		slog.Warn("job window remain-on-exit failed to set; the window will close on failure too", "window", window, "err", err)
	}
	if home, err := jobUserHomeDir(); err != nil {
		slog.Warn("job window log pipe skipped: home directory unresolvable", "window", window, "err", err)
	} else {
		logPath := filepath.Join(home, ".rk", window+".log")
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			slog.Warn("job window log dir creation failed; the pipe-pane tee may not write", "window", window, "err", err)
		}
		// The one shell string in the spawn path — pipe-pane's command is shell-
		// interpreted by tmux. window passed the ValidateToolName class above
		// (no whitespace, quotes, or metacharacters), but home is arbitrary
		// (e.g. /Users/Jane Doe), so the path is single-quoted for the shell.
		if err := jobRunTmux(cmdCtx, "pipe-pane", "-o", "-t", winTarget, "cat >> "+shellQuote(logPath)); err != nil {
			slog.Warn("job window log pipe failed; output lives in scrollback only", "window", window, "err", err)
		}
	}

	return target, true, nil
}
