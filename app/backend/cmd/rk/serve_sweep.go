package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"rk/internal/tmux"
)

// sweepOrphanedRelaySessions reaps any rk-relay-* sessions left on any known
// tmux server by a previously crashed rk serve instance. Runs synchronously
// at startup before HTTP listeners bind to eliminate races with new relays.
//
// Per-server failures are logged and skipped — they MUST NOT abort the sweep
// or block server startup. The caller (serveCmd.RunE) MAY log the aggregate
// error but SHALL continue startup either way.
//
// Uses ListRawSessionNames (not the filtered ListSessions) because the user-
// facing filter would hide the ephemerals we are trying to reap.
func sweepOrphanedRelaySessions(ctx context.Context) error {
	servers, err := tmux.ListServers(ctx)
	if err != nil {
		slog.Error("relay sweep: list servers failed", "err", err)
		return fmt.Errorf("list servers: %w", err)
	}
	var perServerErrs []string
	killed := 0
	for _, server := range servers {
		names, err := tmux.ListRawSessionNames(ctx, server)
		if err != nil {
			slog.Warn("relay sweep: list sessions failed", "server", server, "err", err)
			perServerErrs = append(perServerErrs, fmt.Sprintf("%s: %v", server, err))
			continue
		}
		for _, name := range names {
			if !strings.HasPrefix(name, tmux.RelaySessionPrefix) {
				continue
			}
			if err := tmux.KillSessionCtx(ctx, server, name); err != nil {
				slog.Warn("relay sweep: kill failed", "server", server, "session", name, "err", err)
				perServerErrs = append(perServerErrs, fmt.Sprintf("%s/%s: %v", server, name, err))
				continue
			}
			killed++
		}
	}
	if killed > 0 {
		slog.Info("relay sweep: reaped orphan ephemerals", "count", killed)
	}
	if len(perServerErrs) > 0 {
		return fmt.Errorf("relay sweep partial failures: %s", strings.Join(perServerErrs, "; "))
	}
	return nil
}
