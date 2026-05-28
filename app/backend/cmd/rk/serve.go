package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"rk/api"
	"rk/internal/config"
	"rk/internal/daemon"
	"rk/internal/tmux"
	"rk/internal/tmuxctl"

	"github.com/spf13/cobra"
)

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
	Short: "Start the HTTP server",
	Long: `Start the HTTP server.

Environment variables:
  RK_HOST    Host to bind (default "127.0.0.1")
  RK_PORT    Port to bind (default 3000)

Examples:
  rk serve                              # foreground on 127.0.0.1:3000
  RK_HOST=0.0.0.0 RK_PORT=8080 rk serve # bind all interfaces, port 8080
  rk serve -d                           # run as background daemon`,
	RunE: func(cmd *cobra.Command, args []string) error {
		daemonFlag, _ := cmd.Flags().GetBool("daemon")
		restartFlag, _ := cmd.Flags().GetBool("restart")
		stopFlag, _ := cmd.Flags().GetBool("stop")

		// Mutual exclusivity check.
		flagCount := 0
		if daemonFlag {
			flagCount++
		}
		if restartFlag {
			flagCount++
		}
		if stopFlag {
			flagCount++
		}
		if flagCount > 1 {
			return fmt.Errorf("flags -d/--daemon, --restart, and --stop are mutually exclusive")
		}

		switch {
		case daemonFlag:
			if daemon.IsRunning() {
				return fmt.Errorf("rk daemon already running (%s/%s/%s)",
					daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
			}
			if err := daemon.Start(); err != nil {
				return fmt.Errorf("starting daemon: %w", err)
			}
			fmt.Printf("rk daemon started (%s/%s/%s)\n",
				daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
			return nil

		case restartFlag:
			if daemon.IsRunning() {
				fmt.Println("Restarting rk daemon...")
			}
			if err := daemon.Restart(); err != nil {
				return fmt.Errorf("restarting daemon: %w", err)
			}
			fmt.Printf("rk daemon started (%s/%s/%s)\n",
				daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
			return nil

		case stopFlag:
			if !daemon.IsRunning() {
				fmt.Println("rk daemon not running")
				return nil
			}
			if err := daemon.Stop(); err != nil {
				return fmt.Errorf("stopping daemon: %w", err)
			}
			fmt.Println("rk daemon stopped")
			return nil
		}

		// Default: foreground serve (existing behavior).
		cfg := config.Load()

		// Ensure tmux config exists before starting (write embedded default if missing).
		if err := tmux.EnsureConfig(); err != nil {
			return fmt.Errorf("ensuring tmux config: %w", err)
		}

		// Reap orphaned rk-relay-* ephemerals left by a previously crashed
		// rk serve instance. Synchronous to eliminate races with new relays
		// creating ephemerals concurrently with the sweep. Bounded to 30s
		// so a misbehaving tmux server cannot stall startup indefinitely.
		// Failures are logged but never block startup.
		sweepCtx, sweepCancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := sweepOrphanedRelaySessions(sweepCtx); err != nil {
			slog.Warn("relay sweep finished with errors", "err", err)
		}
		sweepCancel()

		logLevel := slog.LevelInfo
		if strings.EqualFold(os.Getenv("LOG_LEVEL"), "debug") {
			logLevel = slog.LevelDebug
		}
		logger := setupSlog(logLevel)
		slog.SetDefault(logger)

		// Graceful shutdown via SIGINT/SIGTERM
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()

		router, apiServer := api.NewRouterAndServer(ctx, logger)

		// Start the tmuxctl supervisor AFTER tmux.EnsureConfig() and
		// sweepOrphanedRelaySessions (both above) and BEFORE the HTTP
		// listen. The sweep must run first so it does not observe the
		// `_rk-ctl` anchor as an orphan; the supervisor must run before
		// listen so the SSE hub never races an empty Client map for
		// sockets that already exist on disk.
		//
		// Per-socket Open failures (PTY unavailable, etc.) are logged
		// inside the Supervisor and never block startup.
		supervisor := tmuxctl.NewSupervisor(api.NewHubSink())
		if err := supervisor.Start(ctx); err != nil {
			slog.Warn("tmuxctl supervisor failed to start; falling back to safety-net poll", "err", err)
		} else {
			apiServer.SetWindowChangeSubscriber(api.NewSupervisorSubscriber(supervisor))
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

func init() {
	serveCmd.Flags().BoolP("daemon", "d", false, "Start as a background daemon in a tmux session")
	serveCmd.Flags().Bool("restart", false, "Restart the background daemon")
	serveCmd.Flags().Bool("stop", false, "Stop the background daemon")
}
