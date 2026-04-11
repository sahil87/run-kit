package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"rk/api"
	"rk/internal/config"
	"rk/internal/daemon"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the HTTP server",
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

		logLevel := slog.LevelInfo
		if strings.EqualFold(os.Getenv("LOG_LEVEL"), "debug") {
			logLevel = slog.LevelDebug
		}
		logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel}))
		slog.SetDefault(logger)

		// Graceful shutdown via SIGINT/SIGTERM
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()

		router := api.NewRouter(ctx, logger)

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
