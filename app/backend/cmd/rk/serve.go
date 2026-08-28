package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"rk/api"
	"rk/internal/config"
	"rk/internal/daemon"
	"rk/internal/selfpath"
	"rk/internal/settings"
	"rk/internal/snapshot"
	"rk/internal/tmux"
	"rk/internal/tmuxctl"
	"rk/internal/updatecheck"

	"github.com/spf13/cobra"
)

// bootIDBytes is the number of random bytes behind the per-process boot id
// (16 hex chars = 8 bytes). Generated once per `rk serve` start; a fresh id on
// every restart lets an open tab detect a same-version restart and reload.
const bootIDBytes = 8

// newBootID returns a random hex boot id for this process, or an empty string
// if crypto/rand fails (the version slot then carries an empty boot — the
// reload guard simply never fires on boot, which degrades to version-only
// reload; no worse than before boot ids existed).
func newBootID() string {
	b := make([]byte, bootIDBytes)
	if _, err := rand.Read(b); err != nil {
		slog.Warn("boot id generation failed; boot-based reload disabled", "err", err)
		return ""
	}
	return hex.EncodeToString(b)
}

// resolveBrewInstalled reports whether this daemon binary is a Homebrew install,
// computed ONCE at startup (resolve the self path, test the Cellar marker).
// Best-effort: a resolve failure reports false (the palette's brew-gated
// force-update entry simply stays hidden, which is safe).
func resolveBrewInstalled() bool {
	selfPath, err := selfpath.Resolve()
	if err != nil {
		return false
	}
	return selfpath.IsBrewInstalled(selfPath)
}

const (
	// daemonLogDirMode is the permission used for `os.MkdirAll` on the daemon
	// log's parent directory.
	daemonLogDirMode = 0o755
	// daemonLogFileMode is the permission used when creating the daemon log file.
	daemonLogFileMode = 0o644
)

// setupSlog constructs the default slog logger. When RK_DAEMON_LOG (from env)
// is set and the file can be opened for append, slog output is teed to both
// os.Stderr and the log file via io.MultiWriter. On any error (UserCacheDir
// failure upstream, mkdir failure, open failure) we fall back to stderr-only
// and emit a single slog.Warn so the operator can see the failure mode but
// HTTP serving still proceeds — diagnostic logging MUST NOT block startup.
func setupSlog(level slog.Level) *slog.Logger {
	var out io.Writer = os.Stderr
	logPath := os.Getenv(daemon.LogEnvVar)
	var openErr error
	if logPath != "" {
		if err := os.MkdirAll(filepath.Dir(logPath), daemonLogDirMode); err != nil {
			openErr = err
		} else {
			f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, daemonLogFileMode)
			if err != nil {
				openErr = err
			} else {
				out = io.MultiWriter(os.Stderr, f)
			}
		}
	}

	logger := slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: level}))
	if openErr != nil {
		logger.Warn("daemon log unavailable", "path", logPath, "err", openErr)
	}
	return logger
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the HTTP server (foreground)",
	Long: `Start the HTTP server in the foreground.

Environment variables:
  RK_HOST      Host to bind (default "127.0.0.1")
  RK_PORT      Port to bind (default 3000)

Examples:
  run-kit serve                              # foreground on 127.0.0.1:3000
  RK_HOST=0.0.0.0 RK_PORT=8080 run-kit serve # bind all interfaces, port 8080

To run run-kit as a background daemon, see 'run-kit daemon start' (and the rest of the
'run-kit daemon' subcommand tree).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := config.Load()

		// Three-state managed tmux.conf refresh before starting (daemon start is
		// the only trigger — no timer, no watcher). The reload sweep runs ONLY
		// on an actual stale→force-write transition: reloading unchanged config
		// on every start would be wasted tmux traffic across every live server.
		refreshed, err := tmux.EnsureConfig()
		if err != nil {
			return fmt.Errorf("ensuring tmux config: %w", err)
		}
		if refreshed {
			sweepCtx, sweepCancel := context.WithTimeout(context.Background(), 30*time.Second)
			tmux.RefreshSweep(sweepCtx)
			sweepCancel()
		}

		// No startup sweep: relay ephemerals are gone (the relay attaches the PTY
		// directly to the real session), and board pin-sessions (`_rk-pin-*`) are
		// PERSISTENT across rk restarts (Constitution VI — tmux survives the
		// server). A persisted pin is valid state, not an orphan, so there is
		// nothing to reap.

		// Log level: the LOG_LEVEL env is an undocumented per-process escape
		// that wins when set (the dev rig depends on it); otherwise the
		// log_level config.yaml key applies. "debug" enables debug, anything
		// else is info.
		logLevel := slog.LevelInfo
		if l := os.Getenv("LOG_LEVEL"); l != "" {
			if strings.EqualFold(l, "debug") {
				logLevel = slog.LevelDebug
			}
		} else if strings.EqualFold(settings.Load().LogLevel, "debug") {
			logLevel = slog.LevelDebug
		}
		logger := setupSlog(logLevel)
		slog.SetDefault(logger)

		// Below-floor tmux warning, after slog.SetDefault so it rides the
		// configured logger (incl. the RK_DAEMON_LOG tee): the daemon-start
		// stderr warning is invisible on the desktop "Start & connect" and
		// `rk update` restart paths. Unknown versions log nothing.
		vctx, vcancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
		v, vok := tmuxVersionProbe(vctx)
		vcancel()
		if vok && v.BelowFloor() {
			slog.Warn(tmux.UpgradeHint(runtime.GOOS, exec.LookPath, v.Raw))
		}

		// Graceful shutdown via SIGINT/SIGTERM
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()

		// Process start feeds the version slot's `started` field (the host
		// page's daemon uptime readout). Captured before the router so the
		// whole boot sequence counts toward uptime.
		started := time.Now().Unix()

		router, apiServer := api.NewRouterAndServer(ctx, logger)

		// Expose the running version to clients over SSE (server-global
		// `event: version`, replayed on connect) and wire the periodic update
		// checker: it polls the shll.ai versions manifest on a background tick
		// and, when any toolkit tool crosses its notify threshold (or a prior
		// match clears), broadcasts a server-global
		// `event: update-available`. Both surfaces drive the web UI's update chip
		// and the post-restart auto-reload. The checker suppresses itself for the
		// "dev" sentinel / unparseable versions and is bound to the serve context.
		selfBrew := resolveBrewInstalled()
		apiServer.SetVersion(version, newBootID(), selfBrew, started, cfg.Port)
		updateChecker := updatecheck.New(version, selfBrew)
		updateChecker.OnQualify = apiServer.WireUpdateAvailableBroadcast()
		updateChecker.Start(ctx)
		apiServer.SetUpdateChecker(updateChecker)

		// Start the tmuxctl supervisor AFTER tmux.EnsureConfig() (above) and
		// BEFORE the HTTP listen, so the SSE hub never races an empty Client map
		// for sockets that already exist on disk.
		//
		// Per-socket Open failures (PTY unavailable, etc.) are logged
		// inside the Supervisor and never block startup.
		supervisor := tmuxctl.NewSupervisor(api.NewHubSinkFactory())

		// Inject this deployment's origin (derived from the same config the
		// server binds with) so every supervisor dial stamps @rk_srv_origin on the
		// covered tmux server — pane-side `rk url`/`rk notify` resolve it from
		// there. The startup enumeration covers pre-existing servers (healing
		// the value across restarts on a new port); fsnotify dials cover births.
		tmuxctl.SetStampOrigin(fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port))

		// Layout snapshotter: periodically persists per-covered-server layout
		// snapshots (disaster-recovery backups; the /api/recovery endpoints are
		// the sanctioned read-only reader — live state never derives from a
		// snapshot) and tombstones a server's last snapshot when its socket is
		// removed.
		// Wired BEFORE supervisor.Start so the removal callback can never miss
		// an early socket removal. Best-effort throughout: a store-dir
		// resolution failure disables snapshotting with a warning — it must
		// never block serving.
		if snapDir, err := snapshot.DefaultDir(); err != nil {
			slog.Warn("layout snapshots disabled: state dir unresolvable", "err", err)
		} else {
			snapshot.MigrateLegacyDir(snapDir)
			snapStore := snapshot.NewStore(snapDir)
			snapshotter := snapshot.NewSnapshotter(supervisor, snapStore)
			supervisor.OnSocketRemoved = snapshotter.OnServerRemoved
			apiServer.SetServerKillNotifier(snapshotter.NoteAuditedKill)
			// The recovery endpoints read from the SAME store the snapshotter
			// writes to, so /api/recovery offers exactly what was persisted.
			apiServer.SetSnapshotStore(snapStore)
			snapshotter.Start(ctx)
		}

		if err := supervisor.Start(ctx); err != nil {
			slog.Warn("tmuxctl supervisor failed to start; falling back to safety-net poll", "err", err)
		} else {
			apiServer.SetWindowChangeSubscriber(api.NewSupervisorSubscriber(supervisor))
			// Thread the per-socket active-window trackers into the fetch path
			// so FetchSessions derives isActiveWindow from control-mode events
			// (Tier 1), falling back to the base pointer (Tier 2) per group.
			apiServer.SetActiveWindowProvider(supervisor)
		}

		addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		server := &http.Server{
			Addr:    addr,
			Handler: router,
		}

		go func() {
			slog.Info("server starting", "addr", addr)
			if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "err", err)
				os.Exit(1)
			}
		}()

		<-ctx.Done()
		slog.Info("shutting down...")

		// Stop the supervisor first (bounded 5s) so all control-mode
		// connections close cleanly before the HTTP server shuts down.
		// Stop errors are logged but do not block shutdown — matches the
		// daemon-log graceful-degradation pattern from PR #197.
		supCtx, supCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := supervisor.Stop(supCtx); err != nil {
			slog.Warn("tmuxctl supervisor stop error", "err", err)
		}
		supCancel()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown error", "err", err)
		}

		return nil
	},
}
