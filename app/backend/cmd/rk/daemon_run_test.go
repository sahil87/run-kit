package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	"rk/internal/daemon"
)

// withDaemonRunJobStub swaps the RunJob seam for the test's duration. The stub
// records its invocation and returns the scripted outcome.
func withDaemonRunJobStub(t *testing.T, stub func(ctx context.Context, window string, argv []string) (daemon.JobTarget, bool, error)) {
	t.Helper()
	orig := daemonRunJobFn
	daemonRunJobFn = stub
	t.Cleanup(func() { daemonRunJobFn = orig })
}

// runDaemonRun executes `rk daemon run <args...>` against rootCmd with the
// given stub, returning stdout and the error.
func runDaemonRun(t *testing.T, stub func(ctx context.Context, window string, argv []string) (daemon.JobTarget, bool, error), args ...string) (string, error) {
	t.Helper()
	withDaemonRunJobStub(t, stub)
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs(append([]string{"daemon", "run"}, args...))
	t.Cleanup(func() { rootCmd.SetArgs(nil) })
	err := rootCmd.Execute()
	return buf.String(), err
}

func TestDaemonRunCmdRegistered(t *testing.T) {
	dCmd := findChildCmd(rootCmd, "daemon")
	if dCmd == nil {
		t.Fatal("rootCmd has no 'daemon' subcommand")
	}
	if findChildCmd(dCmd, "run") == nil {
		t.Error("daemon subcommand \"run\" not registered")
	}
}

func TestDaemonRunSpawnsAndPrintsTarget(t *testing.T) {
	var gotWindow string
	var gotArgv []string
	out, err := runDaemonRun(t,
		func(_ context.Context, window string, argv []string) (daemon.JobTarget, bool, error) {
			gotWindow, gotArgv = window, argv
			return daemon.JobTarget{Server: "rk-daemon", Session: "rk-jobs", Window: window, WindowID: "@5"}, true, nil
		},
		"--window", "update", "--", "shll", "update", "wt")

	if err != nil {
		t.Fatalf("daemon run: %v", err)
	}
	if gotWindow != "update" {
		t.Errorf("window = %q, want update", gotWindow)
	}
	if strings.Join(gotArgv, " ") != "shll update wt" {
		t.Errorf("argv = %v, want [shll update wt] (-- separated, verbatim)", gotArgv)
	}
	if got := strings.TrimSpace(out); got != "spawned rk-daemon:rk-jobs:update (@5)" {
		t.Errorf("output = %q, want the one-line spawned target", got)
	}
}

func TestDaemonRunAlreadyRunningPrintsTarget(t *testing.T) {
	out, err := runDaemonRun(t,
		func(_ context.Context, window string, argv []string) (daemon.JobTarget, bool, error) {
			return daemon.JobTarget{Server: "rk-daemon", Session: "rk-jobs", Window: window, WindowID: "@9"}, false, nil
		},
		"--window", "restart", "--", "rk", "daemon", "restart")

	if err != nil {
		t.Fatalf("daemon run: %v (already-running exits 0)", err)
	}
	if got := strings.TrimSpace(out); got != "already running: rk-daemon:rk-jobs:restart (@9)" {
		t.Errorf("output = %q, want the already-running line", got)
	}
}

func TestDaemonRunDaemonDownSurfacesActionableError(t *testing.T) {
	_, err := runDaemonRun(t,
		func(context.Context, string, []string) (daemon.JobTarget, bool, error) {
			return daemon.JobTarget{}, false, fmt.Errorf("rk daemon is not running — start it with `rk serve -d`")
		},
		"--window", "x", "--", "true")

	if err == nil {
		t.Fatal("expected a non-zero exit when the daemon is not running")
	}
	if !strings.Contains(err.Error(), "rk serve -d") {
		t.Errorf("error = %q, want it to name the fix (rk serve -d)", err)
	}
}

func TestDaemonRunMissingCommandIsUsageError(t *testing.T) {
	called := false
	_, err := runDaemonRun(t,
		func(context.Context, string, []string) (daemon.JobTarget, bool, error) {
			called = true
			return daemon.JobTarget{}, false, nil
		},
		"--window", "update")

	if err == nil {
		t.Fatal("expected a usage error without a -- command")
	}
	if called {
		t.Error("RunJob must not be called when the command is missing")
	}
}

func TestDaemonRunEmptyWindowNameIsUsageError(t *testing.T) {
	// NOTE: cobra's own "required flag(s) window not set" guard covers a fully
	// absent --window, but the shared rootCmd's pflag state persists across
	// tests (an earlier test's --window stays Changed), so this test drives the
	// equivalent rejection through an explicit empty value.
	called := false
	_, err := runDaemonRun(t,
		func(context.Context, string, []string) (daemon.JobTarget, bool, error) {
			called = true
			return daemon.JobTarget{}, false, nil
		},
		"--window", "", "--", "true")

	if err == nil {
		t.Fatal("expected a usage error for an empty --window name")
	}
	if called {
		t.Error("RunJob must not be called with an empty --window name")
	}
}

func TestDaemonRunRejectsInvalidWindowNames(t *testing.T) {
	for _, name := range []string{"-evil", "has space", "semi;colon", "dot.name", "colon:name"} {
		t.Run(fmt.Sprintf("window=%q", name), func(t *testing.T) {
			called := false
			_, err := runDaemonRun(t,
				func(context.Context, string, []string) (daemon.JobTarget, bool, error) {
					called = true
					return daemon.JobTarget{}, false, nil
				},
				"--window", name, "--", "true")

			if err == nil {
				t.Errorf("window name %q must be rejected before becoming a tmux target", name)
			}
			if called {
				t.Errorf("RunJob called with invalid window name %q", name)
			}
		})
	}
}
