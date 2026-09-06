package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"syscall"
	"testing"

	"rk/internal/cron"
)

// TestCronTickHeldLockIsQuiet: with another invoker holding the flock, tick
// exits 0 with no output at all (skip-on-contention — ticks are idempotent).
// The lock is pre-held against a temp Dir injected through the deps seam, so
// the test never touches a live tmux server (the sweep returns before any
// server enumeration).
func TestCronTickHeldLockIsQuiet(t *testing.T) {
	dir := stubCronDir(t)

	lockPath := cron.LockPath(dir)
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	})

	origDeps := cronTickDepsFn
	cronTickDepsFn = func() cron.Deps {
		return cron.Deps{
			Dir: dir,
			ListServers: func(context.Context) ([]string, error) {
				t.Error("ListServers called under contention — the lock must gate everything")
				return nil, nil
			},
		}
	}
	t.Cleanup(func() { cronTickDepsFn = origDeps })

	stdout, stderr, err := runCronCmd(t, "tick")
	if err != nil {
		t.Fatalf("tick under a held lock: err = %v, want nil (quiet exit 0)", err)
	}
	if stdout != "" || stderr != "" {
		t.Errorf("tick under a held lock printed stdout=%q stderr=%q, want silence", stdout, stderr)
	}
}

// TestCronTickSummary: a quiet sweep prints the one-line summary (servers
// swept, fires, diagnostics) on stdout.
func TestCronTickSummary(t *testing.T) {
	dir := stubCronDir(t)

	origDeps := cronTickDepsFn
	cronTickDepsFn = func() cron.Deps {
		return cron.Deps{
			Dir:         dir,
			ListServers: func(context.Context) ([]string, error) { return nil, nil },
		}
	}
	t.Cleanup(func() { cronTickDepsFn = origDeps })

	stdout, _, err := runCronCmd(t, "tick")
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if !strings.Contains(stdout, "tick: 0 servers swept, 0 fires, 0 diagnostics") {
		t.Errorf("stdout = %q, want the one-line summary", stdout)
	}
}

// TestCronTickError: a real tick error (dir resolution, lock creation, sweep
// failure) surfaces via RunE with a non-zero exit.
func TestCronTickError(t *testing.T) {
	stubCronDir(t)
	origRun := cronTickRunFn
	cronTickRunFn = func(context.Context, cron.Deps) (cron.TickResult, error) {
		return cron.TickResult{}, errors.New("boom")
	}
	t.Cleanup(func() { cronTickRunFn = origRun })

	_, _, err := runCronCmd(t, "tick")
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v, want the tick error surfaced", err)
	}
}
