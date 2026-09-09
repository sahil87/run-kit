// Package cron is the server-scoped scheduling substrate core (docs/specs/cron.md):
// durable cron entries in one intent file per tmux server, a stateless evaluator,
// an append-only delivery log, and the tick orchestrator. This change ships the
// library only — no CLI verb, daemon goroutine, or HTTP surface.
//
// State layout under $XDG_STATE_HOME/run-kit/cron/ (XDG-honoring, ~/.local/state
// fallback — the snapshot.DefaultDir resolution):
//
//	<server-slug>.yaml        entries (intent — the same class as .status.yaml)
//	<server-slug>.log         delivery log (JSON lines; recovery-backup class)
//	<server-slug>.cursor.yaml wake_on cursor (seed-cache class, never authoritative)
//	.lock                     non-blocking tick flock
package cron

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	// dirMode is the cron state dir's permission class (0700, the cb/ and
	// tmuxctl precedent — agent payloads are private).
	dirMode = 0o700
	// fileMode is the permission for entry files, logs, cursors, and the lock.
	fileMode = 0o600
)

// slugPattern is the server-slug grammar (the snapshot-store rule). Slugs are
// tmux socket names; the closed alphabet means a validated slug can never
// traverse or split a path, so validation MUST happen before any path build.
var slugPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ValidSlug reports whether s is a well-formed server slug.
func ValidSlug(s string) bool {
	return slugPattern.MatchString(s)
}

// DefaultDir resolves the cron state root: $XDG_STATE_HOME/run-kit/cron when
// the env var is set, else ~/.local/state/run-kit/cron. Pure resolver, no side
// effects (the snapshot.DefaultDir pattern).
func DefaultDir() (string, error) {
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return filepath.Join(v, "run-kit", "cron"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving cron dir: %w", err)
	}
	return filepath.Join(home, ".local", "state", "run-kit", "cron"), nil
}

// EnsureDir creates the cron state root if absent (0700 class).
func EnsureDir(dir string) error {
	return os.MkdirAll(dir, dirMode)
}

// EntriesPath is the entry file for a server slug. The slug is validated
// before the path is built (A-025: no traversal).
func EntriesPath(dir, slug string) (string, error) {
	if !ValidSlug(slug) {
		return "", fmt.Errorf("invalid server slug %q", slug)
	}
	return filepath.Join(dir, slug+".yaml"), nil
}

// LogPath is the delivery log for a server slug.
func LogPath(dir, slug string) (string, error) {
	if !ValidSlug(slug) {
		return "", fmt.Errorf("invalid server slug %q", slug)
	}
	return filepath.Join(dir, slug+".log"), nil
}

// CursorPath is the wake_on cursor for a server slug.
func CursorPath(dir, slug string) (string, error) {
	if !ValidSlug(slug) {
		return "", fmt.Errorf("invalid server slug %q", slug)
	}
	return filepath.Join(dir, slug+".cursor.yaml"), nil
}

// LockPath is the tick lock file (no slug — one lock serializes the tick
// across all servers).
func LockPath(dir string) string {
	return filepath.Join(dir, ".lock")
}

// FabOperatorSlug derives the fab operator state file's stem from a tmux
// socket path, mirroring fab-kit's slugify exactly (a cross-repo contract —
// fab owns the file, rk mirrors the name): escape literal `-` as `--` FIRST,
// strip the leading `/`, replace every `/` with `-`; an empty path slugs to
// "default". Example: /tmp/tmux-1001/runKit → tmp-tmux--1001-runKit.
func FabOperatorSlug(socketPath string) string {
	if socketPath == "" {
		return "default"
	}
	s := strings.ReplaceAll(socketPath, "-", "--")
	s = strings.TrimPrefix(s, "/")
	return strings.ReplaceAll(s, "/", "-")
}

// FabOperatorStatePath resolves the fab-owned operator state file for a fab
// slug ($XDG_STATE_HOME/fab/operator/<slug>.yaml, same XDG resolution root).
// The slug comes from FabOperatorSlug (a socket path, not a server slug — it
// may legally contain `.`), so path safety is validated by construction:
// every `/` was already replaced, so non-empty + no `/` + no NUL makes
// traversal structurally impossible. The file's schema is fab's; rk reads it
// tolerantly (see watchlist.go).
func FabOperatorStatePath(fabSlug string) (string, error) {
	if fabSlug == "" || strings.ContainsAny(fabSlug, "/\x00") {
		return "", fmt.Errorf("invalid fab slug %q", fabSlug)
	}
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return filepath.Join(v, "fab", "operator", fabSlug+".yaml"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving fab operator state path: %w", err)
	}
	return filepath.Join(home, ".local", "state", "fab", "operator", fabSlug+".yaml"), nil
}
