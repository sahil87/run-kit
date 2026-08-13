package daemon

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"rk/internal/codeserver"
	"rk/internal/config"
	"rk/internal/selfpath"
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
	// CodeServerInstallJobWindow is the rk-jobs window the missing-binary
	// branch spawns to run the install-then-start chain.
	CodeServerInstallJobWindow = "code-server-install"
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

// codeServerLookPath resolves a user-managed code-server on PATH — rung 2 of
// the resolution ladder. A package seam is NOT needed for the missing-binary
// branch (tests set PATH), but keeping the call behind a var matches the
// file's seam style and lets tests assert argv without depending on the
// host's PATH contents.
var codeServerLookPath = exec.LookPath

// codeServerUserHomeDir resolves the user's home directory for the rk-owned
// profile and managed-install paths. A package seam (os.UserHomeDir reads
// platform-specific env) so tests point the profile at a temp dir and never
// touch the real ~/.rk.
var codeServerUserHomeDir = os.UserHomeDir

// codeServerRunJob is the package seam over RunJob for the install-job spawn
// (mirroring codeServerSpawn) so tests capture the job argv without a live
// tmux server.
var codeServerRunJob = func(ctx context.Context, window string, argv []string) (JobTarget, bool, error) {
	return RunJob(ctx, window, argv)
}

// codeServerSelfPath resolves this daemon's own on-disk binary path for the
// install job's shell chain. A package seam (mirroring codeServerUserHomeDir)
// so tests return a fixed path.
var codeServerSelfPath = selfpath.Resolve

// codeServerSeedSettings is the write-once baseline for the rk-owned profile:
// both settings are settings-only (no CLI flags exist — verified code-server
// 4.112.0 / Code 1.112.0). chat.disableAIFeatures hides the "Build with
// Agent" chat panel; workbench.startupEditor "none" suppresses the welcome
// tab in the embedded /code lens. Seeded ONLY when settings.json is absent —
// user edits win forever after.
const codeServerSeedSettings = `{
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none"
}
`

// codeServerProfileDir is the rk-owned --user-data-dir: ~/.rk/
// code-server-profile (the ~/.rk/tmux.conf config-namespace precedent — the
// seeded settings.json is the user-editable artifact here). The pre-260813
// path was ~/.rk/code-server; migrateCodeServerProfile renames it one-shot.
func codeServerProfileDir(home string) string {
	return filepath.Join(home, ".rk", "code-server-profile")
}

// codeServerLegacyProfileDir is the pre-260813 profile path, kept solely as
// the migration source.
func codeServerLegacyProfileDir(home string) string {
	return filepath.Join(home, ".rk", "code-server")
}

// codeServerExtensionsDir is code-server's DEFAULT extensions location:
// $XDG_DATA_HOME/code-server/extensions, else ~/.local/share/code-server/
// extensions. Pinned explicitly because code-server derives its default
// extensions dir from the user-data-dir (<user-data-dir>/extensions), so
// overriding the data dir alone would hide the user's installed extensions.
func codeServerExtensionsDir(home string) string {
	if v := os.Getenv("XDG_DATA_HOME"); v != "" {
		return filepath.Join(v, "code-server", "extensions")
	}
	return filepath.Join(home, ".local", "share", "code-server", "extensions")
}

// migrateCodeServerProfile performs the one-shot rename of the legacy
// ~/.rk/code-server profile dir to ~/.rk/code-server-profile, preserving
// settings and hot-exit state across the path change. Old-exists ∧ new-absent
// ⇒ os.Rename; both-exist leaves both untouched (new wins); old-absent is a
// no-op. Runs before the seed so the write-once logic only ever sees the new
// path.
func migrateCodeServerProfile(home string) error {
	newDir := codeServerProfileDir(home)
	if _, err := os.Stat(newDir); err == nil {
		return nil // new exists — leave both untouched
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	oldDir := codeServerLegacyProfileDir(home)
	if _, err := os.Stat(oldDir); errors.Is(err, fs.ErrNotExist) {
		return nil // fresh host — nothing to migrate
	} else if err != nil {
		return err
	}
	return os.Rename(oldDir, newDir)
}

// seedCodeServerSettings writes the baseline User/settings.json into the
// rk-owned profile dir, only when the path does not already exist. An
// existing entry — any content, even a non-regular file — is left untouched:
// the seed is a baseline, not enforcement. The write is temp-file + rename so
// an interrupted daemon start can never leave a truncated settings.json for
// code-server to choke on (a stray .tmp is the worst case, and a later run
// renames over it).
func seedCodeServerSettings(profileDir string) error {
	path := filepath.Join(profileDir, "User", "settings.json")
	if _, err := os.Stat(path); err == nil {
		return nil // user edits persist
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(codeServerSeedSettings), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// resolveCodeServerBinary is the two-rung resolution ladder: (1) the managed
// install's absolute path (~/.rk/code-server-bin/current/bin/code-server,
// verified executable — the tmux window's PATH is not rk's), then (2) a
// user-managed code-server on PATH (same spirit as the externally-managed-port
// carve-out). Returns "" when neither rung resolves.
func resolveCodeServerBinary(home string) string {
	if managed := codeserver.ManagedBinary(home); managed != "" {
		return managed
	}
	if path, err := codeServerLookPath("code-server"); err == nil {
		return path
	}
	return ""
}

// EnsureOutcome classifies how an ensure/start call ended so the CLI can
// print the right outcome line (the daemon ignores the value — its posture is
// warn-and-continue).
type EnsureOutcome int

const (
	// EnsureAlreadyRunning: the rk-code-server session exists — silent skip.
	EnsureAlreadyRunning EnsureOutcome = iota
	// EnsureNoPort: the resolved port is unresolvable (degenerate RK_PORT).
	EnsureNoPort
	// EnsureExternallyManaged: the port already serves — a user-managed
	// instance is respected, not shadowed.
	EnsureExternallyManaged
	// EnsureStarted: the session was spawned.
	EnsureStarted
	// EnsureInstallJobSpawned: the binary was missing (daemon posture) — the
	// install-then-start job window is running in rk-jobs instead.
	EnsureInstallJobSpawned
)

// ensureCodeServerCore is the shared ensure path behind the daemon's
// ensureCodeServer (cli=false) and the CLI's StartCodeServer (cli=true). The
// postures differ only on failure: the daemon warns and continues (an editor
// must never block the dashboard) and, on a missing binary, spawns the
// rk-jobs install job; the CLI returns operational errors instead. The skip
// order is fixed: session-exists, unresolvable-port, externally-managed-port,
// THEN the binary ladder.
func ensureCodeServerCore(cli bool) (EnsureOutcome, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	if codeServerSessionExists(ctx) {
		return EnsureAlreadyRunning, nil
	}

	port := config.Load().ResolvedCodeServerPort()
	if port == 0 {
		if cli {
			return EnsureNoPort, fmt.Errorf("no resolvable code-server port (RK_PORT+2 out of range and no valid RK_CODE_SERVER_PORT)")
		}
		slog.Warn("code-server not started: no resolvable port (RK_PORT+2 out of range)")
		return EnsureNoPort, nil
	}
	if portInUse(localhostAddr, port) {
		slog.Info("code-server port already serving; respecting the externally managed instance", "port", port)
		return EnsureExternallyManaged, nil
	}

	home, homeErr := codeServerUserHomeDir()
	if homeErr != nil {
		slog.Warn("code-server profile skipped: home directory unresolvable; spawning without the rk-owned profile", "err", homeErr)
	}

	binary := ""
	if homeErr == nil {
		binary = resolveCodeServerBinary(home)
	} else if path, err := codeServerLookPath("code-server"); err == nil {
		binary = path // no home ⇒ no managed rung; PATH still applies
	}
	if binary == "" {
		if cli {
			return EnsureAlreadyRunning, fmt.Errorf("code-server binary not found — install it with `rk code-server install`")
		}
		spawnCodeServerInstallJob(ctx)
		return EnsureInstallJobSpawned, nil
	}

	args := []string{
		"new-session", "-d",
		"-s", CodeServerSessionName,
		"-n", CodeServerWindowName,
		"env", "-u", "VSCODE_IPC_HOOK_CLI",
		binary, "--bind-addr", fmt.Sprintf("%s:%d", localhostAddr, port), "--auth", "none",
		"--disable-telemetry", "--disable-update-check", "--disable-workspace-trust",
		"--disable-getting-started-override", "--app-name", "run-kit",
	}
	if homeErr == nil {
		profileDir := codeServerProfileDir(home)
		if err := migrateCodeServerProfile(home); err != nil {
			slog.Warn("code-server profile migration failed; continuing with the current profile state", "err", err)
		}
		if err := seedCodeServerSettings(profileDir); err != nil {
			slog.Warn("code-server settings seed failed; continuing with an unseeded profile", "err", err)
		}
		args = append(args, "--user-data-dir", profileDir, "--extensions-dir", codeServerExtensionsDir(home))
	}
	if err := codeServerSpawn(ctx, args...); err != nil {
		if cli {
			return EnsureAlreadyRunning, fmt.Errorf("spawning the code-server session: %w", err)
		}
		slog.Warn("code-server session spawn failed; the daemon continues without it", "err", err)
		return EnsureStarted, nil
	}
	return EnsureStarted, nil
}

// spawnCodeServerInstallJob spawns the rk-jobs window running the
// install-then-start shell chain (`<rk-exe> code-server install && <rk-exe>
// code-server start`) and returns immediately — the daemon NEVER blocks on the
// ~100MB download; the lens degrades to the not-running state and the job's
// progress is visible as a tmux window on the dashboard. RunJob's dedup (a
// live window of the same name ⇒ no second spawn) is the duplicate-job guard;
// a dead window from a failed prior run respawns naturally here on the next
// daemon start. The chain's && IS the B→C sequencing (daemon start is
// one-shot; no supervisor loop, Constitution VI).
func spawnCodeServerInstallJob(ctx context.Context) {
	exe, err := codeServerSelfPath()
	if err != nil {
		slog.Warn("code-server install job skipped: could not resolve the rk binary path — run `rk code-server install` manually", "err", err)
		return
	}
	// tmux joins the trailing argv words with spaces into its own sh -c, so the
	// chain is one argv element and the exe path is single-quoted (the
	// space-in-path edge RunJob's unquoted join documents).
	quoted := shellQuote(exe)
	argv := []string{quoted + " code-server install && " + quoted + " code-server start"}
	target, started, err := codeServerRunJob(ctx, CodeServerInstallJobWindow, argv)
	switch {
	case err != nil:
		slog.Warn("code-server binary not found and the install job failed to start — run `rk code-server install` manually", "err", err)
	case !started:
		slog.Info("code-server binary not found; the install job is already running", "window", target.Window)
	default:
		slog.Info("code-server binary not found; spawned the install job — the editor appears when the download finishes", "window", target.Window)
	}
}

// ensureCodeServer starts the daemon-managed code-server beside the daemon on
// the rk-daemon socket. It is BEST-EFFORT and re-entrant on every daemon start
// (Start/StartWithBinary both funnel through startSession):
//
//  1. the rk-code-server session already exists ⇒ skip silently;
//  2. no resolvable port (degenerate RK_PORT whose +2 is out of range) ⇒
//     warn and skip;
//  3. the resolved port already accepts connections ⇒ skip with a note (an
//     externally managed instance is respected — the mirror of dev.sh's
//     preset-port carve-out);
//  4. the binary is absent on BOTH ladder rungs ⇒ spawn the code-server-install
//     job window in rk-jobs (install-then-start chain) and return — the daemon
//     never blocks on the download; the lens degrades to the not-running state
//     and `rk doctor` reports it.
//
// The launch strips VSCODE_IPC_HOOK_CLI from the window's environment via
// `env -u` (inside a VS Code integrated terminal that var flips code-server
// into `code`-CLI mode — "open in existing instance" → exits with "Please
// specify at least one file or folder"; the dev.sh lesson). Loopback-only +
// --auth none: the rk origin is the trust boundary, same posture as dev.
// The remaining flags curate the embedded /code lens: telemetry and the
// update notifier off (updates arrive via rk — `rk code-server update`),
// workspace trust disabled (the lens only opens rk-managed worktrees —
// code-server has no auto-accept flag, so killing the feature is the
// mechanism), the Coder getting-started promo removed, and the app name set
// to run-kit. Flags apply only to instances rk spawns — the
// externally-managed skip below is unchanged.
//
// The spawn also carries the rk-owned profile (260812-71bv): --user-data-dir
// ~/.rk/code-server-profile (the legacy ~/.rk/code-server is renamed one-shot
// first), seeded write-once with settings that have no CLI flags
// (codeServerSeedSettings), plus --extensions-dir pinned back to code-server's
// default location so the user's installed extensions stay visible. Both
// degrade best-effort: a failed seed keeps the flags (code-server creates its
// own dir); an unresolvable home drops the profile flags entirely (a relative
// or empty path would be worse than the status quo).
func ensureCodeServer() {
	_, _ = ensureCodeServerCore(false) // warn-and-continue: errors are logged inside
}

// StartCodeServer is the exported ensure entry for `rk code-server start`
// (R10). It is gated on the daemon running — any tmux command on a dead socket
// would silently BIRTH a server (the RunJob gate's mirror), so a down daemon
// is an operational error naming `rk serve -d`. Unlike the daemon's
// warn-and-continue posture, failures here are operational errors: a missing
// binary names `rk code-server install`, a spawn failure is returned.
func StartCodeServer() (EnsureOutcome, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if !jobDaemonRunning(ctx) {
		return EnsureAlreadyRunning, fmt.Errorf("rk daemon is not running — start it with `rk serve -d`")
	}
	return ensureCodeServerCore(true)
}

// codeServerPaneCommand is the package seam over the pane_start_command query
// (mirroring codeServerSpawn) so tests drive session classification without a
// live tmux server.
var codeServerPaneCommand = func(ctx context.Context, target string) ([]byte, error) {
	return runTmuxOutput(ctx, "list-panes", "-t", target, "-F", "#{pane_start_command}")
}

// CodeServerSessionCommand reports the running code-server session's spawn
// command — the argv string the session was created with, read live from
// tmux's pane_start_command (Constitution II: derived at call time, no cached
// state). Callers (the `rk code-server install` migration respawn) classify
// the session by whether this string contains the managed binary path.
//
// Callers MUST gate on daemon liveness (daemon.IsRunning) BEFORE calling:
// this function runs tmux probes (has-session, list-panes), and any tmux
// command on a dead socket silently births a server — the same hazard the
// RunJob/StartCodeServer gates exist to prevent.
//
// Returns (cmd, exists, err): an absent session is ("", false, nil); a session
// that exists but cannot be inspected is ("", true, err) — the caller must
// treat that as uncertain evidence and never kill on it. list-panes, NOT
// display-message: display-message with an unresolvable window target silently
// falls back to the session's active window and exits 0 (the 260812-anac bug
// class); list-panes hard-fails on a missing window. The window is single-pane
// by construction; the first line wins, tolerating a manual split.
func CodeServerSessionCommand() (string, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if !codeServerSessionExists(ctx) {
		return "", false, nil
	}
	out, err := codeServerPaneCommand(ctx, "="+CodeServerSessionName+":="+CodeServerWindowName)
	if err != nil {
		return "", true, fmt.Errorf("inspecting the %s session's start command: %w", CodeServerSessionName, err)
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	return line, true, nil
}

// KillCodeServerSession kills the rk-code-server session (exact-match target —
// prefix-match hijack is the class of footgun the `=` anchors exist to
// prevent). Used by `rk code-server update` so the flipped symlink takes
// effect: code-server's hot exit preserves unsaved buffers across the respawn.
// An absent session is success (nothing to kill).
func KillCodeServerSession() error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if !codeServerSessionExists(ctx) {
		return nil
	}
	slog.Warn("tmux teardown", "audit", "kill", "op", "kill-session", "server", serverSocket, "target", CodeServerSessionName, "callers", "daemon.KillCodeServerSession")
	if err := runTmux(ctx, "kill-session", "-t", "="+CodeServerSessionName); err != nil {
		return fmt.Errorf("killing the %s session: %w", CodeServerSessionName, err)
	}
	return nil
}
