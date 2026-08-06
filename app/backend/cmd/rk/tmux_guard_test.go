package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// NOTE (tmux safety): these tests never start, attach to, or kill any tmux
// server. The decision logic is table-driven over argv slices; the exec path
// is exercised against the injectable tmuxGuardExec seam and stub executables
// in temp dirs — never the real tmux binary.

// TestTmuxGuardBlocks pins the v1 block rule over the tmux argv grammar:
// blocked ⇔ a command word in the chain names kill-server AND no explicit
// -L/-S socket flag is present in the global-flag window.
func TestTmuxGuardBlocks(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		blocked bool
	}{
		// The four death vectors' shapes.
		{"bare kill-server", []string{"kill-server"}, true},
		{"TMUX_TMPDIR-style bare kill-server (env is invisible to argv — still bare)", []string{"kill-server"}, true},

		// Explicit socket always passes — the guard enforces explicitness, not policy.
		{"-L separate value", []string{"-L", "scratch", "kill-server"}, false},
		{"-L attached value", []string{"-Lscratch", "kill-server"}, false},
		{"-S separate value", []string{"-S", "/tmp/sock", "kill-server"}, false},
		{"-S attached value", []string{"-S/tmp/sock", "kill-server"}, false},
		{"-L clustered after bare flags", []string{"-2uLscratch", "kill-server"}, false},
		{"-L clustered, value in next token", []string{"-2uL", "scratch", "kill-server"}, false},
		{"-L naming the host server still passes", []string{"-L", "default", "kill-server"}, false},

		// Global bare flags before the command word do not hide the command.
		{"bare flag then kill-server", []string{"-u", "kill-server"}, true},
		{"clustered bare flags then kill-server", []string{"-2u", "kill-server"}, true},
		{"double-dash then kill-server", []string{"--", "kill-server"}, true},

		// Value flags must consume their values (a value is not a command word,
		// and a value that looks like a flag must not be parsed as one).
		{"-f config then kill-server", []string{"-f", "/dev/null", "kill-server"}, true},
		{"-c value could be mistaken for command", []string{"-c", "kill-server"}, false},

		// Unambiguous prefix resolution: tmux runs `kill-ser` as kill-server.
		{"unambiguous prefix kill-ser", []string{"kill-ser"}, true},
		{"unambiguous prefix kill-serv", []string{"kill-serv"}, true},
		{"ambiguous prefix kill-se passes (tmux rejects it itself)", []string{"kill-se"}, false},
		{"ambiguous prefix kill- passes", []string{"kill-"}, false},
		{"overlong word passes", []string{"kill-servers"}, false},

		// Scoped kills are never blocked (v1).
		{"kill-session", []string{"kill-session", "-t", "x"}, false},
		{"kill-window", []string{"kill-window"}, false},
		{"kill-pane", []string{"kill-pane"}, false},

		// Command chains: each command word in the chain is checked.
		{"standalone semicolon chain", []string{"new-window", ";", "kill-server"}, true},
		{"trailing-semicolon token chain", []string{"display;", "kill-server"}, true},
		{"chain with explicit socket passes", []string{"-L", "x", "new-window", ";", "kill-server"}, false},
		{"kill-server first in chain", []string{"kill-server", ";", "new-window"}, true},
		{"empty chain segments", []string{";", ";", "kill-server"}, true},

		// Data arguments must never read as command words.
		{"send-keys data string", []string{"send-keys", "-t", "x", "tmux kill-server", "Enter"}, false},
		{"send-keys bare word data", []string{"send-keys", "kill-server", "Enter"}, false},
		{"escaped semicolon keeps data literal", []string{"send-keys", `kill-server\;`, "Enter"}, false},
		{"data token ending in semicolon stays data but next token is a command word", []string{"send-keys", "ls;", "kill-server"}, true},

		// Odds and ends.
		{"empty argv (bare tmux → new-session)", []string{}, false},
		{"plain new-session", []string{"new-session", "-d"}, false},
		{"list-sessions", []string{"ls"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tmuxGuardBlocks(tc.args); got != tc.blocked {
				t.Errorf("tmuxGuardBlocks(%q) = %v, want %v", tc.args, got, tc.blocked)
			}
		})
	}
}

// TestTmuxCommandWords pins the cmd_parse_from_arguments mirror directly: only
// segment-leading tokens are command words, and the three semicolon forms
// (standalone, token-final unescaped, token-final escaped) behave like tmux.
func TestTmuxCommandWords(t *testing.T) {
	cases := []struct {
		name   string
		tokens []string
		want   []string
	}{
		{"single command", []string{"new-window", "-n", "x"}, []string{"new-window"}},
		{"standalone separator", []string{"a", ";", "b"}, []string{"a", "b"}},
		{"token-final separator", []string{"a;", "b"}, []string{"a", "b"}},
		{"escaped separator is data", []string{"a", `x\;`, "b"}, []string{"a"}},
		{"data token-final separator ends command, token stays data", []string{"a", "x;", "b"}, []string{"a", "b"}},
		{"empty segments skipped", []string{";", ";", "a"}, []string{"a"}},
		{"empty input", nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tmuxCommandWords(tc.tokens)
			if len(got) != len(tc.want) {
				t.Fatalf("tmuxCommandWords(%q) = %q, want %q", tc.tokens, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("tmuxCommandWords(%q) = %q, want %q", tc.tokens, got, tc.want)
				}
			}
		})
	}
}

// writeStub writes a fake executable (or non-executable) file for PATH-scan
// tests. The content deliberately avoids the shim marker and the string
// "tmux-guard" unless the test wants the sniff to fire.
func writeStub(t *testing.T, dir, name, content string, mode os.FileMode) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	return path
}

const stubTmuxContent = "#!/bin/sh\necho stub\n"

func TestFindRealTmux(t *testing.T) {
	t.Run("skips the shim dir and resolves the first real candidate", func(t *testing.T) {
		shimDir := filepath.Join(t.TempDir(), "shims")
		realDir := t.TempDir()
		writeStub(t, shimDir, "tmux", tmuxShimScript("/opt/homebrew/bin/rk"), 0o755)
		want := writeStub(t, realDir, "tmux", stubTmuxContent, 0o755)

		got, err := findRealTmux(shimDir+string(os.PathListSeparator)+realDir, shimDir)
		if err != nil {
			t.Fatalf("findRealTmux error: %v", err)
		}
		if got != want {
			t.Errorf("resolved %q, want %q", got, want)
		}
	})

	t.Run("errors when only the shim is on PATH", func(t *testing.T) {
		shimDir := filepath.Join(t.TempDir(), "shims")
		writeStub(t, shimDir, "tmux", tmuxShimScript("/opt/homebrew/bin/rk"), 0o755)

		if _, err := findRealTmux(shimDir, shimDir); err == nil {
			t.Fatal("expected an error with no real tmux on PATH")
		} else if !strings.Contains(err.Error(), "no real tmux") {
			t.Errorf("error should name the missing real tmux, got: %v", err)
		}
	})

	t.Run("content sniff skips a relocated shim copy outside the shims dir", func(t *testing.T) {
		strayDir := t.TempDir()
		realDir := t.TempDir()
		writeStub(t, strayDir, "tmux", tmuxShimScript("/opt/homebrew/bin/rk"), 0o755)
		want := writeStub(t, realDir, "tmux", stubTmuxContent, 0o755)

		got, err := findRealTmux(strayDir+string(os.PathListSeparator)+realDir, filepath.Join(t.TempDir(), "shims"))
		if err != nil {
			t.Fatalf("findRealTmux error: %v", err)
		}
		if got != want {
			t.Errorf("resolved %q (the stray shim copy?), want %q", got, want)
		}
	})

	t.Run("skips non-executable files", func(t *testing.T) {
		plainDir := t.TempDir()
		realDir := t.TempDir()
		writeStub(t, plainDir, "tmux", stubTmuxContent, 0o644) // not executable
		want := writeStub(t, realDir, "tmux", stubTmuxContent, 0o755)

		got, err := findRealTmux(plainDir+string(os.PathListSeparator)+realDir, "")
		if err != nil {
			t.Fatalf("findRealTmux error: %v", err)
		}
		if got != want {
			t.Errorf("resolved %q, want %q", got, want)
		}
	})

	t.Run("skips empty PATH entries (never resolves from cwd)", func(t *testing.T) {
		if _, err := findRealTmux("::", ""); err == nil {
			t.Fatal("expected an error for a PATH of empty entries")
		}
	})
}

// guardExecCapture swaps the tmuxGuardExec seam for a recorder for the test's
// duration, so no process is ever replaced or spawned.
func guardExecCapture(t *testing.T) *struct {
	called bool
	path   string
	argv   []string
	envv   []string
} {
	t.Helper()
	rec := &struct {
		called bool
		path   string
		argv   []string
		envv   []string
	}{}
	orig := tmuxGuardExec
	tmuxGuardExec = func(path string, argv []string, envv []string) error {
		rec.called = true
		rec.path = path
		rec.argv = argv
		rec.envv = envv
		return nil
	}
	t.Cleanup(func() { tmuxGuardExec = orig })
	return rec
}

// setOriginalTMUX overrides tmux.OriginalTMUX (the pre-init capture of the
// caller's $TMUX) for the test's duration. In the test process the real value
// depends on where `go test` ran (inside a pane or not), so tests pin it
// explicitly both ways.
func setOriginalTMUX(t *testing.T, v string) {
	t.Helper()
	orig := tmux.OriginalTMUX
	tmux.OriginalTMUX = v
	t.Cleanup(func() { tmux.OriginalTMUX = orig })
}

// envValues returns every VALUE the env slice carries for the given key.
func envValues(envv []string, key string) []string {
	var vals []string
	for _, kv := range envv {
		if strings.HasPrefix(kv, key+"=") {
			vals = append(vals, strings.TrimPrefix(kv, key+"="))
		}
	}
	return vals
}

// guardEnv points HOME at a temp dir and PATH at a single stub dir, so
// runTmuxGuard never sees the host's real tmux or shim. Returns the stub path.
func guardEnv(t *testing.T) string {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	stubDir := t.TempDir()
	stub := writeStub(t, stubDir, "tmux", stubTmuxContent, 0o755)
	t.Setenv("PATH", stubDir)
	t.Setenv(rkTmuxGuardEnvVar, "")
	return stub
}

func TestRunTmuxGuardBlockedPath(t *testing.T) {
	rec := guardExecCapture(t)
	guardEnv(t)

	err := runTmuxGuard([]string{"kill-server"})
	if err == nil {
		t.Fatal("expected a blocked error")
	}
	var ece *exitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("blocked error should be *exitCodeError, got %T: %v", err, err)
	}
	if ece.code != 1 {
		t.Errorf("blocked exit code = %d, want 1", ece.code)
	}
	if ece.msg != tmuxGuardBlockedMessage {
		t.Errorf("blocked message mismatch:\ngot:  %q\nwant: %q", ece.msg, tmuxGuardBlockedMessage)
	}
	for _, needle := range []string{"BLOCKED", "-L/-S > $TMUX > TMUX_TMPDIR", "RK_TMUX_GUARD=off"} {
		if !strings.Contains(ece.msg, needle) {
			t.Errorf("blocked message missing %q", needle)
		}
	}
	if rec.called {
		t.Error("blocked invocation must never exec")
	}
}

func TestRunTmuxGuardPassExecsVerbatim(t *testing.T) {
	rec := guardExecCapture(t)
	stub := guardEnv(t)

	args := []string{"-L", "scratch", "kill-server"}
	if err := runTmuxGuard(args); err != nil {
		t.Fatalf("pass path error: %v", err)
	}
	if !rec.called {
		t.Fatal("pass path must exec the real tmux")
	}
	if rec.path != stub {
		t.Errorf("exec path = %q, want the stub %q", rec.path, stub)
	}
	wantArgv := append([]string{stub}, args...)
	if len(rec.argv) != len(wantArgv) {
		t.Fatalf("exec argv = %q, want %q", rec.argv, wantArgv)
	}
	for i := range wantArgv {
		if rec.argv[i] != wantArgv[i] {
			t.Fatalf("exec argv = %q, want %q", rec.argv, wantArgv)
		}
	}
}

// TestRunTmuxGuardRestoresTMUXEnv pins the exec ENVIRONMENT (must-fix #1 of
// the review): internal/tmux's init() runs os.Unsetenv("TMUX") process-wide
// before RunE, so the guard must restore $TMUX from tmux.OriginalTMUX — an
// exec'd tmux seeing no $TMUX retargets every shimmed bare command to the
// DEFAULT server, inverting the guard's safety goal.
func TestRunTmuxGuardRestoresTMUXEnv(t *testing.T) {
	rec := guardExecCapture(t)
	guardEnv(t)
	const paneTMUX = "/tmp/tmux-1000/default,12345,0"
	setOriginalTMUX(t, paneTMUX)

	if err := runTmuxGuard([]string{"ls"}); err != nil {
		t.Fatalf("pass path error: %v", err)
	}
	if !rec.called {
		t.Fatal("pass path must exec the real tmux")
	}
	vals := envValues(rec.envv, "TMUX")
	if len(vals) != 1 || vals[0] != paneTMUX {
		t.Errorf("exec env must carry exactly the original TMUX %q, got TMUX values %q", paneTMUX, vals)
	}
}

// TestRunTmuxGuardNoTMUXWhenCallerHadNone pins the other half: a caller
// without $TMUX (outside any pane) must exec tmux with a TMUX-free env — the
// guard restores, it never fabricates.
func TestRunTmuxGuardNoTMUXWhenCallerHadNone(t *testing.T) {
	rec := guardExecCapture(t)
	guardEnv(t)
	setOriginalTMUX(t, "")

	if err := runTmuxGuard([]string{"ls"}); err != nil {
		t.Fatalf("pass path error: %v", err)
	}
	if !rec.called {
		t.Fatal("pass path must exec the real tmux")
	}
	if vals := envValues(rec.envv, "TMUX"); len(vals) != 0 {
		t.Errorf("exec env must carry no TMUX when the caller had none, got %q", vals)
	}
}

func TestRunTmuxGuardEscapeHatch(t *testing.T) {
	rec := guardExecCapture(t)
	guardEnv(t)
	t.Setenv(rkTmuxGuardEnvVar, rkTmuxGuardOff)

	if err := runTmuxGuard([]string{"kill-server"}); err != nil {
		t.Fatalf("RK_TMUX_GUARD=off must pass through, got: %v", err)
	}
	if !rec.called {
		t.Error("RK_TMUX_GUARD=off must exec the real tmux")
	}
}

// TestRunTmuxGuardExecEnvStripsGuardVar pins the cycle-3 must-fix: the exec
// env must never carry RK_TMUX_GUARD. tmux copies the starting environment of
// `new-session -d` into the NEW server's global environment, so exec'ing the
// hatch through would bake RK_TMUX_GUARD=off into every future pane of a
// server started under it — a later bare kill-server from any of those panes
// would then pass the guard, making the per-invocation hatch permanent.
func TestRunTmuxGuardExecEnvStripsGuardVar(t *testing.T) {
	t.Run("off-hatch path", func(t *testing.T) {
		rec := guardExecCapture(t)
		guardEnv(t)
		t.Setenv(rkTmuxGuardEnvVar, rkTmuxGuardOff)

		if err := runTmuxGuard([]string{"new-session", "-d"}); err != nil {
			t.Fatalf("off-hatch pass path error: %v", err)
		}
		if !rec.called {
			t.Fatal("off-hatch path must exec the real tmux")
		}
		if vals := envValues(rec.envv, rkTmuxGuardEnvVar); len(vals) != 0 {
			t.Errorf("exec env must carry no %s (the hatch is per-invocation), got %q", rkTmuxGuardEnvVar, vals)
		}
	})

	t.Run("normal pass path", func(t *testing.T) {
		rec := guardExecCapture(t)
		guardEnv(t)
		// Any non-off value: present in the caller's env, must still be stripped.
		t.Setenv(rkTmuxGuardEnvVar, "on")

		if err := runTmuxGuard([]string{"ls"}); err != nil {
			t.Fatalf("pass path error: %v", err)
		}
		if !rec.called {
			t.Fatal("pass path must exec the real tmux")
		}
		if vals := envValues(rec.envv, rkTmuxGuardEnvVar); len(vals) != 0 {
			t.Errorf("exec env must carry no %s, got %q", rkTmuxGuardEnvVar, vals)
		}
	})
}

func TestRunTmuxGuardNoRealTmux(t *testing.T) {
	rec := guardExecCapture(t)
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir()) // empty dir — no tmux at all
	t.Setenv(rkTmuxGuardEnvVar, "")

	err := runTmuxGuard([]string{"new-session"})
	if err == nil {
		t.Fatal("expected an error when no real tmux exists")
	}
	var ece *exitCodeError
	if !errors.As(err, &ece) || ece.code != 1 {
		t.Fatalf("missing-tmux error should be *exitCodeError code 1, got %T: %v", err, err)
	}
	if rec.called {
		t.Error("must not exec when resolution failed")
	}
}

// TestTmuxGuardCommandRegistered pins the CLI surface: the subcommand exists
// on the root with flag parsing disabled (tmux flags pass through verbatim).
func TestTmuxGuardCommandRegistered(t *testing.T) {
	for _, c := range rootCmd.Commands() {
		if c.Name() == "tmux-guard" {
			if !c.DisableFlagParsing {
				t.Error("tmux-guard must disable cobra flag parsing")
			}
			return
		}
	}
	t.Error("tmux-guard is not registered on the root command")
}
