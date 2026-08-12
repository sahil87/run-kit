package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"

	"rk/internal/config"
)

const (
	// CodeServerSessionName is the tmux session running the daemon-managed
	// code-server. It is a SIBLING session on the rk-daemon socket (the
	// rk-remotes precedent), never a window inside the rk-daemon session:
	// code-server must survive `rk serve` exits and `daemon stop` (Stop()'s
	// exact-match =rk-daemon target and its kill-session fallback never touch
	// it), because server-side terminals and hot-exit state live in that
	// process (260811-a2bo, Constitution VI's spirit).
	CodeServerSessionName = "rk-code-server"
	// CodeServerWindowName is the single window inside the code-server session.
	CodeServerWindowName = "code-server"
)

// codeServerSessionExists reports whether the code-server session already
// exists on the daemon socket. A package seam (mirroring serverSocket) so
// tests can drive the idempotent-skip branch without a live tmux server.
var codeServerSessionExists = func(ctx context.Context) bool {
	return sessionExistsCtx(ctx, CodeServerSessionName)
}

// codeServerSpawn creates the detached code-server session via runTmux
// (exec.CommandContext + argv + cmdTimeout, Constitution I). A package seam so
// tests capture the argv without a live tmux server.
var codeServerSpawn = func(ctx context.Context, args ...string) error {
	return runTmux(ctx, args...)
}

// codeServerLookPath resolves the code-server binary. A package seam is NOT
// needed for the missing-binary branch (tests set PATH), but keeping the call
// behind a var matches the file's seam style and lets tests assert argv
// without depending on the host's PATH contents.
var codeServerLookPath = exec.LookPath

// ensureCodeServer starts the daemon-managed code-server beside the daemon on
// the rk-daemon socket. It is BEST-EFFORT and re-entrant on every daemon start
// (Start/StartWithBinary both funnel through startSession):
//
//  1. the rk-code-server session already exists ⇒ skip silently;
//  2. the resolved port already accepts connections ⇒ skip with a note (an
//     externally managed instance is respected — the mirror of dev.sh's
//     preset-port carve-out);
//  3. the code-server binary is absent ⇒ warn loudly and continue — an editor
//     must never block the dashboard; the lens degrades to the not-running
//     state and `rk doctor` reports it.
//
// The launch strips VSCODE_IPC_HOOK_CLI from the window's environment via
// `env -u` (inside a VS Code integrated terminal that var flips code-server
// into `code`-CLI mode — "open in existing instance" → exits with "Please
// specify at least one file or folder"; the dev.sh lesson). Loopback-only +
// --auth none: the rk origin is the trust boundary, same posture as dev.
// The remaining flags curate the embedded /code lens: telemetry and the
// update notifier off (updates arrive via brew), workspace trust disabled
// (the lens only opens rk-managed worktrees — code-server has no auto-accept
// flag, so killing the feature is the mechanism), the Coder getting-started
// promo removed, and the app name set to run-kit. Flags apply only to
// instances rk spawns — the externally-managed skip below is unchanged.
func ensureCodeServer() {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	if codeServerSessionExists(ctx) {
		return // already managed — silent skip
	}

	port := config.Load().ResolvedCodeServerPort()
	if port == 0 {
		slog.Warn("code-server not started: no resolvable port (RK_PORT+2 out of range)")
		return
	}
	if portInUse(localhostAddr, port) {
		slog.Info("code-server port already serving; respecting the externally managed instance", "port", port)
		return
	}
	if _, err := codeServerLookPath("code-server"); err != nil {
		slog.Warn("code-server binary not found; the daemon continues without the managed editor (install code-server, e.g. brew install code-server)")
		return
	}

	args := []string{
		"new-session", "-d",
		"-s", CodeServerSessionName,
		"-n", CodeServerWindowName,
		"env", "-u", "VSCODE_IPC_HOOK_CLI",
		"code-server", "--bind-addr", fmt.Sprintf("%s:%d", localhostAddr, port), "--auth", "none",
		"--disable-telemetry", "--disable-update-check", "--disable-workspace-trust",
		"--disable-getting-started-override", "--app-name", "run-kit",
	}
	if err := codeServerSpawn(ctx, args...); err != nil {
		slog.Warn("code-server session spawn failed; the daemon continues without it", "err", err)
	}
}
