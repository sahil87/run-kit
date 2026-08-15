package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// --- shim script --------------------------------------------------------------

// TestTmuxShimScriptShape pins the contract the rest of the system reads out of
// the rendered shim: the ownership marker agent-setup and doctor key on, and a
// FIRST exec line carrying the LITERAL rk path. tmuxShimExecTarget takes the
// first exec line, and the fail-open stage adds a second one below it, so the
// two lines' order is a real (and silently breakable) coupling.
func TestTmuxShimScriptShape(t *testing.T) {
	const rkPath = "/opt/homebrew/bin/run-kit"
	script := tmuxShimScript(rkPath)
	lines := strings.Split(script, "\n")

	if lines[0] != "#!/bin/sh" {
		t.Errorf("line 1 = %q, want the POSIX sh shebang", lines[0])
	}
	if lines[1] != "# "+tmuxShimMarker {
		t.Errorf("line 2 = %q, want the ownership marker comment", lines[1])
	}
	if want := `exec "` + rkPath + `" mux guard "$@"`; !strings.Contains(script, want) {
		t.Errorf("script missing the literal rk exec line %q", want)
	}
	if got := tmuxShimExecTarget(script); got != rkPath {
		t.Errorf("tmuxShimExecTarget = %q, want %q", got, rkPath)
	}

	rkExec := strings.Index(script, `exec "`+rkPath+`"`)
	failOpenExec := strings.Index(script, "\n\texec \"$@\"\n")
	if failOpenExec < 0 {
		t.Fatal("script has no fail-open exec of the resolved real tmux")
	}
	if rkExec > failOpenExec {
		t.Errorf("the fail-open exec (offset %d) precedes the rk exec (offset %d) — doctor would parse the wrong target",
			failOpenExec, rkExec)
	}

	// The probe budget is the whole point of the rewrite; pin that the
	// configured attempts and interval actually reach the script.
	if !strings.Contains(script, "sleep "+tmuxShimProbeInterval) {
		t.Errorf("script missing the %ss probe sleep", tmuxShimProbeInterval)
	}
	if want := fmt.Sprintf("-lt %d ]", tmuxShimProbeAttempts); !strings.Contains(script, want) {
		t.Errorf("script missing the %d-attempt probe bound", tmuxShimProbeAttempts)
	}

	// A relocated copy must still sniff as the shim, or findRealTmux (and the
	// script's own walk) could resolve it and exec-loop.
	if path := writeStub(t, t.TempDir(), "tmux", script, 0o755); !sniffsAsTmuxShim(path) {
		t.Error("the rendered shim does not sniff as the rk shim")
	}
}

// Stub payloads for the shim execution tests. Each announces which binary
// received the invocation, and none carries the shim marker or the string
// "tmux-guard" (that would make the stub itself sniff as the shim).
//
// The …EnvContent variants additionally dump the environment they were exec'd
// with. `export -p` is POSIX and a shell builtin, so it adds nothing to the
// isolated utility PATH the shim's own walk sees.
const (
	stubRkContent          = "#!/bin/sh\necho \"RK $*\"\n"
	stubRkEnvContent       = "#!/bin/sh\necho \"RK $*\"\nexport -p\n"
	stubRealTmuxContent    = "#!/bin/sh\necho \"REALTMUX $*\"\n"
	stubRealTmuxEnvContent = "#!/bin/sh\necho \"REALTMUX $*\"\nexport -p\n"
)

// shimVarPrefix is the namespace every shell variable in the rendered shim
// carries. POSIX sh keeps the export attribute when assigning to a name the
// caller exported, so the prefix is what keeps the shim's internals from
// riding an exported `n` or `real` into the exec'd process — and the shim
// unsets them all before each exec, so not one may appear downstream.
const shimVarPrefix = "_rk_"

// callerExportedShimVars are the shim's own variable names, exported by the
// CALLER. Under POSIX assignment-keeps-export semantics these are the shapes
// that would leak the shim's values into tmux if the unset were dropped.
var callerExportedShimVars = []string{
	shimVarPrefix + "path=caller",
	shimVarPrefix + "n=caller",
	shimVarPrefix + "real=caller",
	shimVarPrefix + "shims=caller",
	shimVarPrefix + "np=caller",
}

// exportedNames extracts the variable NAMES from a POSIX `export -p` dump
// (dash prints `export NAME='v'`, bash `declare -x NAME="v"`). Keying on the
// name is what keeps the assertions honest: a VALUE routinely mentions these
// strings by accident — a t.TempDir() path carries the subtest's own name.
func exportedNames(dump string) []string {
	var names []string
	for _, line := range strings.Split(dump, "\n") {
		fields := strings.Fields(line)
		var assignment string
		switch {
		case len(fields) >= 2 && fields[0] == "export":
			assignment = fields[1]
		case len(fields) >= 3 && fields[0] == "declare" && fields[1] == "-x":
			assignment = fields[2]
		default:
			continue
		}
		name, _, _ := strings.Cut(assignment, "=")
		names = append(names, name)
	}
	return names
}

// assertNoShimStateExported fails when the environment an …EnvContent stub
// dumped carries the guard's escape hatch or any variable from the shim's
// namespace.
func assertNoShimStateExported(t *testing.T, dump string) {
	t.Helper()
	for _, name := range exportedNames(dump) {
		if name == rkTmuxGuardEnvVar {
			t.Errorf("the exec'd env must carry no %s (the hatch is per-invocation), got:\n%s", rkTmuxGuardEnvVar, dump)
		}
		if strings.HasPrefix(name, shimVarPrefix) {
			t.Errorf("the exec'd env must carry no %s* shim variable, got %q in:\n%s", shimVarPrefix, name, dump)
		}
	}
}

// shimRunTimeout bounds every shim execution. It is far above the ~3s probe
// budget, so tripping it means the shim wedged — most plausibly a fail-open
// exec loop through a relocated copy of itself.
const shimRunTimeout = 60 * time.Second

// shimUtilDir returns a directory of symlinks to the only external utilities
// the shim script uses: sleep (the probe loop) and grep (the candidate sniff).
// Execution tests build their PATH from this dir plus their own stub dirs, so
// the script's walk can never reach the machine's real tmux.
func shimUtilDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "util")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"sleep", "grep"} {
		src, err := exec.LookPath(name)
		if err != nil {
			t.Skipf("shim execution tests need %s on PATH: %v", name, err)
		}
		if err := os.Symlink(src, filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// installShimScript renders the shim for rkPath and installs it as an
// executable file in its own directory, returning the path.
func installShimScript(t *testing.T, rkPath string) string {
	t.Helper()
	return writeStub(t, filepath.Join(t.TempDir(), "shims"), "tmux", tmuxShimScript(rkPath), 0o755)
}

// shimRun describes one execution of an installed shim. Everything the shim
// can reach is a stub under t.TempDir(): no test starts, attaches to, or kills
// a tmux server, and none runs against the real $HOME.
type shimRun struct {
	shim string   // an installed shim, from installShimScript
	home string   // isolated $HOME — decides which shims dir the walk skips
	path string   // isolated PATH
	env  []string // extra KEY=VALUE entries
	args []string // the tmux argv
}

type shimResult struct {
	stdout string
	stderr string
	code   int
}

// runShim executes an installed shim under an isolated environment: a fresh
// empty cwd, and an env carrying nothing but the run's own HOME/PATH/extras.
func runShim(t *testing.T, run shimRun) shimResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), shimRunTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, run.shim, run.args...)
	cmd.Dir = t.TempDir()
	cmd.Env = append([]string{"HOME=" + run.home, "PATH=" + run.path}, run.env...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()

	if ctx.Err() != nil {
		t.Fatalf("shim did not finish within %s — a fail-open exec loop?", shimRunTimeout)
	}
	res := shimResult{stdout: stdout.String(), stderr: stderr.String()}
	var exitErr *exec.ExitError
	switch {
	case err == nil:
	case errors.As(err, &exitErr):
		res.code = exitErr.ExitCode()
	default:
		t.Fatalf("running shim: %v (stderr: %s)", err, res.stderr)
	}
	return res
}

// TestTmuxShimExecsRkWhenAvailable is the steady state, unchanged by this
// rewrite: an executable rk path receives the original argv verbatim, with no
// probe delay and nothing on stderr.
func TestTmuxShimExecsRkWhenAvailable(t *testing.T) {
	rk := writeStub(t, t.TempDir(), "rk", stubRkContent, 0o755)

	start := time.Now()
	res := runShim(t, shimRun{
		shim: installShimScript(t, rk),
		home: t.TempDir(),
		path: shimUtilDir(t),
		args: []string{"list-panes", "-a"},
	})

	if res.code != 0 || res.stdout != "RK mux guard list-panes -a\n" {
		t.Fatalf("stdout=%q code=%d, want the rk stub to receive the verbatim argv", res.stdout, res.code)
	}
	if res.stderr != "" {
		t.Errorf("the steady state must stay silent, got stderr %q", res.stderr)
	}
	// The probe loop tests its condition before sleeping, so an executable rk
	// never pays the ~3s budget. Two process spawns are well under this bound.
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("steady state took %s — the probe loop must not sleep when rk is executable", elapsed)
	}
}

// TestTmuxShimSteadyStateForwardsNoShimState pins the steady-state half of the
// environment contract on the HOT path — every PATH-resolved tmux call on the
// machine goes through it. POSIX sh keeps the export attribute when assigning
// to a name the caller exported, so an unprefixed loop counter handed rk (and
// through it, tmux) a literal `n=0`; tmux then copies its starting environment
// into a new server's GLOBAL environment. Prefixing is half the fix, unsetting
// before the exec is the other half — even a caller who exports the shim's own
// names must see none of them downstream.
func TestTmuxShimSteadyStateForwardsNoShimState(t *testing.T) {
	rk := writeStub(t, t.TempDir(), "rk", stubRkEnvContent, 0o755)

	res := runShim(t, shimRun{
		shim: installShimScript(t, rk),
		home: t.TempDir(),
		path: shimUtilDir(t),
		env:  callerExportedShimVars,
		args: []string{"list-panes"},
	})

	if res.code != 0 || !strings.HasPrefix(res.stdout, "RK mux guard list-panes\n") {
		t.Fatalf("stdout=%q stderr=%q code=%d, want the rk stub to receive the invocation",
			res.stdout, res.stderr, res.code)
	}
	assertNoShimStateExported(t, res.stdout)
}

// TestTmuxShimRecoversWhenRkReappears covers the window this change exists for:
// a package manager's non-atomic relink leaves the embedded rk path dangling
// for a few seconds. The invocation must stall and then complete through rk,
// never exit 127.
func TestTmuxShimRecoversWhenRkReappears(t *testing.T) {
	rk := filepath.Join(t.TempDir(), "run-kit")
	shim := installShimScript(t, rk)

	restored := make(chan error, 1)
	go func() {
		time.Sleep(300 * time.Millisecond)
		// Write then rename, so the path is never briefly present-but-not-yet
		// -executable — that is how a relink lands, and it keeps the test from
		// racing its own fixture.
		tmp := rk + ".partial"
		if err := os.WriteFile(tmp, []byte(stubRkContent), 0o755); err != nil {
			restored <- err
			return
		}
		restored <- os.Rename(tmp, rk)
	}()

	res := runShim(t, shimRun{
		shim: shim,
		home: t.TempDir(),
		path: shimUtilDir(t),
		args: []string{"list-panes"},
	})
	if err := <-restored; err != nil {
		t.Fatalf("restoring the rk stub: %v", err)
	}

	if res.code != 0 || res.stdout != "RK mux guard list-panes\n" {
		t.Fatalf("stdout=%q stderr=%q code=%d, want the restored rk to receive the invocation",
			res.stdout, res.stderr, res.code)
	}
}

// TestTmuxShimFailsOpen covers what happens once the probe budget is spent and
// rk is still unreachable. Subtests run in parallel because each pays the full
// ~3s budget — so EVERY fixture is written here in the parent, before the first
// subtest resumes: writing an executable in one goroutine while another forks
// makes the fork inherit the write fd, and the exec fails with ETXTBSY.
func TestTmuxShimFailsOpen(t *testing.T) {
	// A path that will never exist, so every subtest exhausts the probe budget.
	danglingRk := filepath.Join(t.TempDir(), "gone", "run-kit")
	shim := installShimScript(t, danglingRk)
	util := shimUtilDir(t)

	realDir := t.TempDir()
	writeStub(t, realDir, "tmux", stubRealTmuxContent, 0o755)

	// A second real tmux that also dumps the environment it was exec'd with,
	// for the subtests that assert what the fail-open exec hands downstream.
	realEnvDir := t.TempDir()
	writeStub(t, realEnvDir, "tmux", stubRealTmuxEnvContent, 0o755)

	// A relocated copy of the shim: only the content sniff can skip this one.
	strayDir := t.TempDir()
	writeStub(t, strayDir, "tmux", tmuxShimScript("/opt/homebrew/bin/run-kit"), 0o755)

	// A marker-less stub inside the shims dir: only the directory exclusion can
	// skip this one, so it pins that exclusion independently of the sniff.
	home := t.TempDir()
	writeStub(t, rkShimsDir(home), "tmux", stubTmuxContent, 0o755)

	join := func(dirs ...string) string { return strings.Join(dirs, string(os.PathListSeparator)) }

	t.Run("execs the real tmux with the original argv", func(t *testing.T) {
		t.Parallel()
		// The leading empty entry also pins that empty PATH entries are skipped.
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join("", util, realDir),
			args: []string{"list-panes", "-a"},
		})

		if res.code != 0 || res.stdout != "REALTMUX list-panes -a\n" {
			t.Fatalf("stdout=%q stderr=%q code=%d, want the real tmux to receive the verbatim argv",
				res.stdout, res.stderr, res.code)
		}
		notice := strings.TrimSpace(res.stderr)
		if notice == "" || strings.Contains(notice, "\n") {
			t.Errorf("want exactly one stderr notice line, got %q", res.stderr)
		}
		if !strings.Contains(notice, danglingRk) {
			t.Errorf("the fail-open notice should name the unreachable rk path %q, got %q", danglingRk, notice)
		}
	})

	t.Run("refuses a bare kill-server", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join(util, realDir),
			args: []string{"kill-server"},
		})

		if res.code != 1 {
			t.Errorf("exit code = %d, want 1", res.code)
		}
		if res.stdout != "" {
			t.Errorf("the real tmux must never run on a refusal, got stdout %q", res.stdout)
		}
		if !strings.Contains(res.stderr, "BLOCKED") {
			t.Errorf("stderr should carry the refusal, got %q", res.stderr)
		}
		// The backstop runs before the fail-open notice, so a refusal must not
		// also claim the guard was bypassed.
		if strings.Contains(res.stderr, "unguarded") {
			t.Errorf("a refusal must not also print the fail-open notice, got %q", res.stderr)
		}
	})

	t.Run("passes kill-server carrying an explicit socket", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join(util, realDir),
			args: []string{"-L", "scratch", "kill-server"},
		})

		if res.code != 0 || res.stdout != "REALTMUX -L scratch kill-server\n" {
			t.Fatalf("stdout=%q code=%d, want an explicit socket to pass the backstop", res.stdout, res.code)
		}
	})

	// The escape hatch must hold on the fallback path AND stop there. tmux
	// copies its starting environment into a NEW server's global environment,
	// so a forwarded RK_TMUX_GUARD=off would make the per-invocation hatch
	// permanent for every future pane of a server started under it — the exact
	// death vector the guard exists to close, re-opened by the fallback. The
	// same run exports the shim's own variable names to prove the unset covers
	// caller-exported names too (POSIX assignment keeps the export attribute).
	t.Run("RK_TMUX_GUARD=off bypasses the backstop without forwarding the hatch to tmux", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join(util, realEnvDir),
			env:  append([]string{rkTmuxGuardEnvVar + "=" + rkTmuxGuardOff}, callerExportedShimVars...),
			args: []string{"kill-server"},
		})

		if res.code != 0 || !strings.HasPrefix(res.stdout, "REALTMUX kill-server\n") {
			t.Fatalf("stdout=%q code=%d, want the documented escape hatch to hold on the fallback path",
				res.stdout, res.code)
		}
		assertNoShimStateExported(t, res.stdout)
	})

	// IFS belongs to the caller, and the PATH walk borrows it. A shell resets
	// IFS's VALUE at startup but KEEPS the export attribute an exported IFS
	// arrived with (verified on both dash and bash), so assigning the walk's
	// ":" would ride out to the exec'd tmux — and into a new server's global
	// environment, where a one-character IFS breaks every field split in every
	// future pane. Unsetting it unconditionally is the mirror-image leak: the
	// caller's IFS would vanish from the environment entirely.
	t.Run("does not hand the PATH walk's IFS to the exec'd tmux", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join(util, realEnvDir),
			env:  []string{"IFS=|"},
			args: []string{"list-panes"},
		})

		if res.code != 0 || !strings.HasPrefix(res.stdout, "REALTMUX list-panes\n") {
			t.Fatalf("stdout=%q code=%d, want the fail-open path to reach the real tmux", res.stdout, res.code)
		}
		// dash prints `export IFS=':'`, bash `declare -x IFS=":"` — either
		// spelling means the walk's separator escaped.
		for _, leaked := range []string{`IFS=':'`, `IFS=":"`} {
			if strings.Contains(res.stdout, leaked) {
				t.Errorf("the exec'd env carries the walk's IFS (%s), got:\n%s", leaked, res.stdout)
			}
		}
		// The walk must also not strip an exported IFS on its way out.
		var sawIFS bool
		for _, name := range exportedNames(res.stdout) {
			if name == "IFS" {
				sawIFS = true
			}
		}
		if !sawIFS {
			t.Errorf("the walk unset the caller's exported IFS instead of restoring it, got:\n%s", res.stdout)
		}
	})

	t.Run("skips a relocated copy of the shim", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: join(util, strayDir, realDir),
			args: []string{"list-panes"},
		})

		// Reaching the real tmux at all proves the stray copy was skipped —
		// exec'ing it would have looped until shimRunTimeout.
		if res.code != 0 || res.stdout != "REALTMUX list-panes\n" {
			t.Fatalf("stdout=%q code=%d, want the stray shim copy skipped", res.stdout, res.code)
		}
	})

	// The shims dir holds a marker-LESS tmux stub, so only the directory
	// exclusion can skip it — and the exclusion compares normalized paths, so
	// the separator spellings a real $PATH (or $HOME) picks up must not smuggle
	// it past. Reaching the real tmux is the proof; resolving the shims-dir
	// stub instead would print nothing on stdout.
	for name, spelling := range map[string]string{
		"exact":              rkShimsDir(home),
		"trailing slash":     rkShimsDir(home) + "/",
		"doubled separators": strings.ReplaceAll(rkShimsDir(home), "/", "//"),
	} {
		t.Run("skips the rk shims dir ("+name+")", func(t *testing.T) {
			t.Parallel()
			res := runShim(t, shimRun{
				shim: shim,
				home: home,
				path: join(util, spelling, realDir),
				args: []string{"list-panes"},
			})

			if res.code != 0 || res.stdout != "REALTMUX list-panes\n" {
				t.Fatalf("stdout=%q code=%d, want the shims dir skipped", res.stdout, res.code)
			}
		})
	}

	t.Run("exits non-zero when no real tmux exists", func(t *testing.T) {
		t.Parallel()
		res := runShim(t, shimRun{
			shim: shim,
			home: home,
			path: util,
			args: []string{"list-panes"},
		})

		if res.code == 0 {
			t.Errorf("exit code = 0, want non-zero with nothing to exec")
		}
		if !strings.Contains(res.stderr, "no real tmux") {
			t.Errorf("stderr should name the missing real tmux, got %q", res.stderr)
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

// TestTmuxGuardServerFlagFlowsToTmux pins the guard's -L posture (mux family
// exception): DisableFlagParsing means every token after `guard` flows verbatim
// into the tmux argv, where -L is genuinely tmux's socket flag — so the guard
// never calls muxRejectInheritedServerFlag, and no invocation is silently
// retargeted. Both spellings (flag before or after the subcommand) resolve to
// the guard with the explicit socket still in the argv it passes to tmux, and
// the permanent root alias behaves byte-identically.
func TestTmuxGuardServerFlagFlowsToTmux(t *testing.T) {
	for _, tc := range []struct {
		name string
		argv []string
	}{
		{"flag after the subcommand", []string{"mux", "guard", "-L", "x", "kill-server"}},
		{"flag before the subcommand", []string{"mux", "-L", "x", "guard", "kill-server"}},
		{"permanent root alias", []string{"tmux-guard", "-L", "x", "kill-server"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := guardExecCapture(t)
			stub := guardEnv(t)

			cmd, args, err := rootCmd.Find(tc.argv)
			if err != nil {
				t.Fatalf("Find(%q) error: %v", tc.argv, err)
			}
			if err := cmd.RunE(cmd, args); err != nil {
				t.Fatalf("guard RunE error: %v", err)
			}
			if !rec.called {
				t.Fatal("an explicit socket must pass the guard and exec the real tmux")
			}
			wantArgv := []string{stub, "-L", "x", "kill-server"}
			if len(rec.argv) != len(wantArgv) {
				t.Fatalf("exec argv = %q, want %q", rec.argv, wantArgv)
			}
			for i := range wantArgv {
				if rec.argv[i] != wantArgv[i] {
					t.Fatalf("exec argv = %q, want %q (the explicit socket must ride into tmux — no silent retarget)", rec.argv, wantArgv)
				}
			}
		})
	}
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

// TestTmuxGuardCommandRegistered pins the CLI surface for BOTH instances of
// the factory-built guard: the visible `rk mux guard` family member and the
// PERMANENT hidden root alias `rk tmux-guard` (installed shims exec the
// literal name frozen at install time — cli-layering.md delegation rule 3).
// The Deprecated == "" pin makes a future sweep converting the alias into a
// warning alias fail a test: warning text would leak onto stderr of every
// guarded tmux call on old installs.
func TestTmuxGuardCommandRegistered(t *testing.T) {
	t.Run("family member at mux guard", func(t *testing.T) {
		cmd, _, err := rootCmd.Find([]string{"mux", "guard"})
		if err != nil || cmd.Name() != "guard" {
			t.Fatalf("`mux guard` not resolvable (cmd=%v, err=%v)", cmd, err)
		}
		if cmd.Hidden {
			t.Error("the mux family member must be visible")
		}
		if !cmd.DisableFlagParsing {
			t.Error("guard must disable cobra flag parsing (tmux flags pass through verbatim)")
		}
	})

	t.Run("permanent hidden root alias tmux-guard", func(t *testing.T) {
		cmd, _, err := rootCmd.Find([]string{"tmux-guard"})
		if err != nil || cmd.Name() != "tmux-guard" {
			t.Fatalf("`tmux-guard` not resolvable at root (cmd=%v, err=%v)", cmd, err)
		}
		if !cmd.Hidden {
			t.Error("the root alias must be hidden")
		}
		if cmd.Deprecated != "" {
			t.Errorf("the alias is PERMANENT and must never warn (Deprecated = %q)", cmd.Deprecated)
		}
		if !cmd.DisableFlagParsing {
			t.Error("guard must disable cobra flag parsing (tmux flags pass through verbatim)")
		}
	})
}
