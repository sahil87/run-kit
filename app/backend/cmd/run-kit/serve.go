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

	"run-kit/api"
	"run-kit/internal/config"

	"github.com/spf13/cobra"
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the HTTP server",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := config.Load()

		logLevel := slog.LevelInfo
		if strings.EqualFold(os.Getenv("LOG_LEVEL"), "debug") {
			logLevel = slog.LevelDebug
		}
		logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel}))
		slog.SetDefault(logger)

		router := api.NewRouter(logger)

		addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		server := &http.Server{
			Addr:    addr,
			Handler: router,
		}

		// Graceful shutdown via SIGINT/SIGTERM
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()

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
