package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/codeserver"
)

func TestDoctorCommandOutput(t *testing.T) {
	// Execute doctorCmd and capture its output.
	// The test result depends on whether tmux is installed,
	// but we verify the command runs and produces expected output either way.
	buf := new(bytes.Buffer)
	doctorCmd.SetOut(buf)
	doctorCmd.SetErr(buf)

	err := doctorCmd.RunE(doctorCmd, nil)
	output := buf.String()

	if err != nil {
		// tmux not found — verify failure output
		if output == "" {
			t.Error("expected output on failure, got empty string")
		}
		if !contains(output, "[FAIL]") {
			t.Errorf("expected [FAIL] in output, got: %s", output)
		}
	} else {
		// tmux found — verify success output
		if !contains(output, "[ OK ] tmux") {
			t.Errorf("expected '[ OK ] tmux' in output, got: %s", output)
		}
		if !contains(output, "All checks passed") {
			t.Errorf("expected 'All checks passed' in output, got: %s", output)
		}
	}
}

func contains(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}

// TestDoctorReportOKMatchesChecks pins the worst-check-wins aggregation
// (Principle 4): the overall `ok` is true only when every check passed.
func TestDoctorReportOKMatchesChecks(t *testing.T) {
	report := runDoctorChecks()
	allOK := true
	for _, c := range report.Checks {
		if !c.OK {
			allOK = false
		}
	}
	if report.OK != allOK {
		t.Errorf("report.OK = %v but checks aggregate to %v (worst-check-wins violated)", report.OK, allOK)
	}
	if len(report.Checks) == 0 {
		t.Error("report has no checks")
	}
}

// TestDoctorJSONToStdoutErrEmpty verifies --json emits the report as JSON to
// stdout with the human diagnostic absent from stdout (it belongs on stderr).
func TestDoctorJSONToStdoutErrEmpty(t *testing.T) {
	var stdout, stderr bytes.Buffer
	doctorCmd.SetOut(&stdout)
	doctorCmd.SetErr(&stderr)
	t.Cleanup(func() {
		doctorCmd.SetOut(nil)
		doctorCmd.SetErr(nil)
		doctorJSON = false
	})
	doctorJSON = true

	// RunE returns a non-nil error when a check fails (tmux absent); either way
	// stdout must carry valid JSON and stderr must stay empty on the JSON path.
	_ = doctorCmd.RunE(doctorCmd, nil)

	var report doctorReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("stdout is not valid doctor JSON: %v (got %q)", err, stdout.String())
	}
	if len(report.Checks) == 0 {
		t.Error("JSON report has no checks")
	}
	if stderr.Len() != 0 {
		t.Errorf("--json path wrote to stderr: %q", stderr.String())
	}
}

// TestDoctorJSONFlagRegistered pins the --json flag surface (help-dump
// re-verification depends on it).
func TestDoctorJSONFlagRegistered(t *testing.T) {
	if doctorCmd.Flags().Lookup("json") == nil {
		t.Error("doctor command is missing the --json flag")
	}
}

// withQuiet sets the package-level quiet var for the test's duration. newSink
// falls back to this var when a standalone subcommand cannot resolve the
// persistent --quiet flag (the shape the RunE-invoking tests use); production
// reads the flag off the invoked command via rootCmd.Execute(). Restore is
// mandatory — cobra does not reset package-global flag vars between calls.
func withQuiet(t *testing.T, v bool) {
	t.Helper()
	orig := quiet
	quiet = v
	t.Cleanup(func() { quiet = orig })
}

// TestDoctorQuietDropsChatterKeepsFailAndExit pins R4: under --quiet the banner,
// [ OK ] rows, and success tail (chatter) are suppressed on stderr, while a
// [FAIL] row (actionable error detail) and the non-zero exit survive.
func TestDoctorQuietDropsChatterKeepsFailAndExit(t *testing.T) {
	withQuiet(t, true)
	var stdout, stderr bytes.Buffer
	doctorCmd.SetOut(&stdout)
	doctorCmd.SetErr(&stderr)
	t.Cleanup(func() { doctorCmd.SetOut(nil); doctorCmd.SetErr(nil) })

	err := doctorCmd.RunE(doctorCmd, nil)
	errOut := stderr.String()

	// The banner and success tail are chatter and must never appear under --quiet.
	if contains(errOut, "Checking runtime dependencies") {
		t.Errorf("--quiet must drop the banner, got stderr: %q", errOut)
	}
	if contains(errOut, "All checks passed") {
		t.Errorf("--quiet must drop the success tail, got stderr: %q", errOut)
	}
	if contains(errOut, "[ OK ]") {
		t.Errorf("--quiet must drop [ OK ] rows, got stderr: %q", errOut)
	}

	if err != nil {
		// tmux absent — the FAIL row (error detail) and non-zero exit survive.
		if !contains(errOut, "[FAIL]") {
			t.Errorf("--quiet must keep [FAIL] rows (error detail), got stderr: %q", errOut)
		}
	} else {
		// tmux present — a fully-passing --quiet run is silent on stderr.
		if errOut != "" {
			t.Errorf("--quiet passing run must be silent on stderr, got: %q", errOut)
		}
	}
}

// TestDoctorQuietJSONEmitsExactlyJSON pins R4's --json clause: --quiet --json
// emits exactly the JSON report to stdout with empty stderr (the flag never
// gates the machine-data path).
func TestDoctorQuietJSONEmitsExactlyJSON(t *testing.T) {
	withQuiet(t, true)
	var stdout, stderr bytes.Buffer
	doctorCmd.SetOut(&stdout)
	doctorCmd.SetErr(&stderr)
	t.Cleanup(func() {
		doctorCmd.SetOut(nil)
		doctorCmd.SetErr(nil)
		doctorJSON = false
	})
	doctorJSON = true

	_ = doctorCmd.RunE(doctorCmd, nil)

	var report doctorReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("--quiet --json stdout is not valid doctor JSON: %v (got %q)", err, stdout.String())
	}
	if stderr.Len() != 0 {
		t.Errorf("--quiet --json wrote to stderr: %q", stderr.String())
	}
}

// TestDoctorQuietFlagWiredThroughRoot proves the production seam: invoking via
// rootCmd.Execute() with --quiet resolves the persistent flag on the command
// itself (not the var fallback), so newSink discards chatter. This exercises the
// real wiring the RunE-only tests bypass.
func TestDoctorQuietFlagWiredThroughRoot(t *testing.T) {
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs([]string{"doctor", "--quiet"})
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
		// Reset the persistent flag so it does not leak into other tests.
		_ = rootCmd.PersistentFlags().Set("quiet", "false")
		quiet = false
	})

	// Execute may return an error (tmux absent) — either way the banner/tail
	// chatter must be suppressed on stderr.
	_ = rootCmd.Execute()
	if contains(stderr.String(), "Checking runtime dependencies") || contains(stderr.String(), "[ OK ]") {
		t.Errorf("--quiet via rootCmd.Execute() must suppress chatter, got stderr: %q", stderr.String())
	}
}

// --- tmux guard shim check ------------------------------------------------------

// NOTE (tmux safety): these tests use temp homes, stub executables, and
// injected (pathEnv, lookPath) pairs only — no host PATH dependence, no tmux
// execution.

// doctorShimScript renders shim content whose embedded rk path names a REAL
// stub binary in a temp dir — the check now stats the exec target, so a
// healthy-install fixture must embed a path that exists (a literal
// /opt/homebrew/bin/rk would read as the dangling-rk failure).
func doctorShimScript(t *testing.T) string {
	t.Helper()
	return tmuxShimScript(writeStub(t, t.TempDir(), "rk", "#!/bin/sh\nexit 0\n", 0o755))
}

// installDoctorShim writes an rk-owned shim into the temp home plus a stub
// "real tmux" in its own dir, returning the shim path and a pathEnv where the
// stub sits behind the shims dir (the healthy installed layout).
func installDoctorShim(t *testing.T, home string) (shim, pathEnv string) {
	t.Helper()
	shim = tmuxShimPath(home)
	writeStub(t, filepath.Dir(shim), "tmux", doctorShimScript(t), 0o755)
	realDir := t.TempDir()
	writeStub(t, realDir, "tmux", stubTmuxContent, 0o755)
	return shim, filepath.Dir(shim) + string(os.PathListSeparator) + realDir
}

func TestTmuxGuardShimCheckNotInstalled(t *testing.T) {
	home := t.TempDir()
	c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
		t.Fatal("lookPath must not be called when the shim is absent")
		return "", nil
	})
	if !c.OK {
		t.Errorf("absent shim must be OK (optional), got %+v", c)
	}
	if !strings.Contains(c.Note, "not installed") {
		t.Errorf("absent shim should carry a not-installed note, got %+v", c)
	}
}

// TestTmuxGuardShimCheckUnreadableFile pins the cycle-2 should-fix: an
// existing-but-unreadable file at the shim path is NOT the optional
// "not installed" state — exec.LookPath resolves it without read permission,
// so it may be fronting (and killing) every tmux invocation. The check must
// FAIL with a permissions hint instead of letting doctor exit 0.
func TestTmuxGuardShimCheckUnreadableFile(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root — file permissions do not restrict reads")
	}
	home := t.TempDir()
	shim := tmuxShimPath(home)
	writeStub(t, filepath.Dir(shim), "tmux", tmuxShimScript("/opt/homebrew/bin/rk"), 0o755)
	// Executable but not readable: LookPath resolves it, os.ReadFile fails.
	if err := os.Chmod(shim, 0o111); err != nil {
		t.Fatal(err)
	}
	c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
		t.Fatal("lookPath must not be called for an unreadable file")
		return "", nil
	})
	if c.OK {
		t.Errorf("unreadable file at the shim path must FAIL, got %+v", c)
	}
	if !strings.Contains(c.Hint, "permissions") {
		t.Errorf("hint should point at permissions, got %+v", c)
	}
	if !strings.Contains(c.Hint, shim) {
		t.Errorf("hint should name the shim path, got %+v", c)
	}
}

// TestTmuxGuardShimCheckMarkerlessFile pins half of must-fix #4: a marker-less
// file at the shim path is a USER file, not an installed rk shim — the check
// reads it as not-installed (OK + note), never as the guard being active.
func TestTmuxGuardShimCheckMarkerlessFile(t *testing.T) {
	home := t.TempDir()
	shim := tmuxShimPath(home)
	writeStub(t, filepath.Dir(shim), "tmux", "#!/bin/sh\n# my own wrapper\nexec /usr/bin/tmux \"$@\"\n", 0o755)
	c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
		t.Fatal("lookPath must not be called for a marker-less file")
		return "", nil
	})
	if !c.OK {
		t.Errorf("marker-less file must read as not-installed (OK), got %+v", c)
	}
	if !strings.Contains(c.Note, "non-rk file") {
		t.Errorf("note should say a non-rk file occupies the path, got %+v", c)
	}
}

// TestTmuxGuardShimCheckDanglingRkPath pins the cycle-3 must-fix: an installed
// shim whose EMBEDDED rk path no longer exists (the recorded brew rk→run-kit
// rename incident — a zombie keg path baked into the shim) degrades EVERY tmux
// command on the machine to a ~3s stall followed by an unguarded run — the
// shim's probe budget covers a transient relink, not a permanent break — so
// the check must FAIL with a re-install hint instead of vouching for the
// install.
func TestTmuxGuardShimCheckDanglingRkPath(t *testing.T) {
	t.Run("embedded rk path missing", func(t *testing.T) {
		home := t.TempDir()
		shim := tmuxShimPath(home)
		gone := filepath.Join(t.TempDir(), "rk") // never created — a dangling target
		writeStub(t, filepath.Dir(shim), "tmux", tmuxShimScript(gone), 0o755)
		c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
			t.Fatal("lookPath must not be called when the embedded rk is dangling")
			return "", nil
		})
		if c.OK {
			t.Errorf("shim exec'ing a missing rk binary must FAIL, got %+v", c)
		}
		if !strings.Contains(c.Hint, gone) {
			t.Errorf("hint should name the dangling path %q, got %+v", gone, c)
		}
		if !strings.Contains(c.Hint, "rk agent setup") {
			t.Errorf("hint should carry the re-install remedy `rk agent setup`, got %+v", c)
		}
	})

	t.Run("no parseable exec target", func(t *testing.T) {
		home := t.TempDir()
		shim := tmuxShimPath(home)
		// Marker-owned (rk's artifact) but the exec line was mangled by hand —
		// there is no target to stat, and the shim cannot work.
		content := "#!/bin/sh\n# " + tmuxShimMarker + "\n"
		writeStub(t, filepath.Dir(shim), "tmux", content, 0o755)
		c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
			t.Fatal("lookPath must not be called when the shim has no exec target")
			return "", nil
		})
		if c.OK {
			t.Errorf("shim with no parseable exec target must FAIL, got %+v", c)
		}
		if !strings.Contains(c.Hint, "rk agent setup") {
			t.Errorf("hint should carry the re-install remedy `rk agent setup`, got %+v", c)
		}
	})

	// The PR-review should-fix: bare os.Stat existence is not enough — a
	// directory or a non-executable file at the embedded target breaks every
	// shimmed tmux invocation exactly like a missing binary, so both must
	// FAIL instead of reading as a healthy install.
	t.Run("embedded rk path is a directory", func(t *testing.T) {
		home := t.TempDir()
		shim := tmuxShimPath(home)
		writeStub(t, filepath.Dir(shim), "tmux", tmuxShimScript(t.TempDir()), 0o755)
		c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
			t.Fatal("lookPath must not be called when the embedded rk is a directory")
			return "", nil
		})
		if c.OK {
			t.Errorf("shim exec'ing a directory must FAIL, got %+v", c)
		}
		if !strings.Contains(c.Hint, "not an executable file") {
			t.Errorf("hint should say the target is not an executable file, got %+v", c)
		}
		if !strings.Contains(c.Hint, "rk agent setup") {
			t.Errorf("hint should carry the re-install remedy `rk agent setup`, got %+v", c)
		}
	})

	t.Run("embedded rk path not executable", func(t *testing.T) {
		home := t.TempDir()
		shim := tmuxShimPath(home)
		target := writeStub(t, t.TempDir(), "rk", "#!/bin/sh\nexit 0\n", 0o644)
		writeStub(t, filepath.Dir(shim), "tmux", tmuxShimScript(target), 0o755)
		c := tmuxGuardShimCheck(home, "", func(string) (string, error) {
			t.Fatal("lookPath must not be called when the embedded rk is not executable")
			return "", nil
		})
		if c.OK {
			t.Errorf("shim exec'ing a non-executable file must FAIL, got %+v", c)
		}
		if !strings.Contains(c.Hint, "not an executable file") {
			t.Errorf("hint should say the target is not an executable file, got %+v", c)
		}
		if !strings.Contains(c.Hint, "rk agent setup") {
			t.Errorf("hint should carry the re-install remedy `rk agent setup`, got %+v", c)
		}
	})
}

func TestTmuxGuardShimCheckResolvesToShim(t *testing.T) {
	home := t.TempDir()
	shim, pathEnv := installDoctorShim(t, home)
	c := tmuxGuardShimCheck(home, pathEnv, func(string) (string, error) { return shim, nil })
	if !c.OK {
		t.Errorf("shim-resolving PATH with a real tmux behind it must be OK, got %+v", c)
	}
	if !strings.Contains(c.Note, "resolves tmux to the shim") {
		t.Errorf("expected a resolves-to-shim note, got %+v", c)
	}
}

// TestTmuxGuardShimCheckNoRealTmuxBehindShim pins the other half of must-fix
// #4: tmux resolving to the shim is NOT enough — with no real tmux behind it,
// every guarded call dies at exec time, so the check must FAIL.
func TestTmuxGuardShimCheckNoRealTmuxBehindShim(t *testing.T) {
	home := t.TempDir()
	shim := tmuxShimPath(home)
	writeStub(t, filepath.Dir(shim), "tmux", doctorShimScript(t), 0o755)
	// pathEnv carries ONLY the shims dir — nothing behind the shim.
	c := tmuxGuardShimCheck(home, filepath.Dir(shim), func(string) (string, error) { return shim, nil })
	if c.OK {
		t.Errorf("shim with no real tmux behind it must FAIL, got %+v", c)
	}
	if !strings.Contains(c.Hint, "no real tmux") {
		t.Errorf("hint should name the missing real tmux, got %+v", c)
	}
}

func TestTmuxGuardShimCheckPathRegression(t *testing.T) {
	home := t.TempDir()
	shim, pathEnv := installDoctorShim(t, home)
	_ = shim

	t.Run("resolves elsewhere", func(t *testing.T) {
		other := filepath.Join(t.TempDir(), "tmux")
		if err := os.WriteFile(other, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		c := tmuxGuardShimCheck(home, pathEnv, func(string) (string, error) { return other, nil })
		if c.OK {
			t.Errorf("PATH resolving tmux elsewhere must FAIL, got %+v", c)
		}
		if !strings.Contains(c.Hint, "rk tmux guard") {
			t.Errorf("hint should point at the PATH block, got %+v", c)
		}
	})

	t.Run("no tmux on PATH at all", func(t *testing.T) {
		c := tmuxGuardShimCheck(home, pathEnv, func(string) (string, error) { return "", os.ErrNotExist })
		if c.OK {
			t.Errorf("installed shim with no PATH resolution must FAIL, got %+v", c)
		}
		if c.Hint == "" {
			t.Errorf("failure must carry a hint, got %+v", c)
		}
	})
}

// TestDoctorFailRowWording pins should-fix #3: the shared human [FAIL] row
// keeps its historical "<name> not found — <hint>" wording for absence-style
// checks, while the shim check (whose failures are mis-wirings, not absences)
// renders its own natural lead-in.
func TestDoctorFailRowWording(t *testing.T) {
	absence := doctorCheck{Name: "tmux", OK: false, Hint: "install tmux"}
	if got := doctorFailLabel(absence); got != "tmux not found" {
		t.Errorf("absence-style [FAIL] label = %q, want %q", got, "tmux not found")
	}
	home := t.TempDir()
	shim := tmuxShimPath(home)
	writeStub(t, filepath.Dir(shim), "tmux", doctorShimScript(t), 0o755)
	c := tmuxGuardShimCheck(home, "", func(string) (string, error) { return "", os.ErrNotExist })
	if c.OK {
		t.Fatalf("expected a failing shim check, got %+v", c)
	}
	if got := doctorFailLabel(c); got != "tmux-guard shim" {
		t.Errorf("shim [FAIL] label = %q, want %q", got, "tmux-guard shim")
	}
}

// TestCodeServerCheckAbsentBinaryIsWarnNotFail proves the daemon-managed
// editor's doctor row never fails the report (260811-a2bo): an absent binary
// is the WARN case — OK with a remediation note — matching daemon start's
// warn-and-continue discipline. The remediation is rk-managed install
// guidance, never brew.
func TestCodeServerCheckAbsentBinaryIsWarnNotFail(t *testing.T) {
	t.Setenv("RK_CODE_SERVER_PORT", "3939")
	c := codeServerCheck(
		t.TempDir(), // no managed install under this home
		func(string) (string, error) { return "", fmt.Errorf("not found") },
		func(string) bool { return false },
	)
	if c.Name != "code-server" {
		t.Errorf("name = %q, want code-server", c.Name)
	}
	if !c.OK {
		t.Error("absent binary must not fail the check (WARN case)")
	}
	if !strings.Contains(c.Note, "not installed") || !strings.Contains(c.Note, ":3939") {
		t.Errorf("note = %q, want remediation + resolved port", c.Note)
	}
	if !strings.Contains(c.Note, "rk code-server install") {
		t.Errorf("note = %q, want the rk-managed install hint", c.Note)
	}
	if strings.Contains(c.Note, "brew") {
		t.Errorf("note = %q, must not suggest brew", c.Note)
	}
}

// TestCodeServerCheckManagedVersion proves the rk-managed install is reported
// with its version (from the current symlink) and wins over a PATH install —
// the same precedence as the daemon's resolution ladder.
func TestCodeServerCheckManagedVersion(t *testing.T) {
	t.Setenv("RK_PORT", "3000")
	t.Setenv("RK_CODE_SERVER_PORT", "")
	home := t.TempDir()
	bin := filepath.Join(codeserver.VersionDir(home, "4.132.0"), "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "code-server"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("4.132.0", codeserver.CurrentPath(home)); err != nil {
		t.Fatal(err)
	}

	c := codeServerCheck(
		home,
		func(string) (string, error) { return "/usr/bin/code-server", nil }, // PATH also resolves
		func(string) bool { return true },
	)
	if !c.OK || !strings.Contains(c.Note, "managed v4.132.0") {
		t.Errorf("note = %q, want the managed version (rung 1 wins over PATH)", c.Note)
	}
	if !strings.Contains(c.Note, "reachable on 127.0.0.1:3002") {
		t.Errorf("note = %q, want reachability alongside the version", c.Note)
	}
}

// TestCodeServerCheckReachabilityNotes covers the two installed states:
// reachable reports the loopback address; unreachable reports the
// daemon-starts-it hint. Both stay OK.
func TestCodeServerCheckReachabilityNotes(t *testing.T) {
	t.Setenv("RK_PORT", "3000")
	t.Setenv("RK_CODE_SERVER_PORT", "")
	lookPath := func(string) (string, error) { return "/usr/bin/code-server", nil }

	up := codeServerCheck(t.TempDir(), lookPath, func(string) bool { return true })
	if !up.OK || !strings.Contains(up.Note, "reachable on 127.0.0.1:3002") {
		t.Errorf("reachable: %+v, want OK + convention port :3002 note", up)
	}

	down := codeServerCheck(t.TempDir(), lookPath, func(string) bool { return false })
	if !down.OK || !strings.Contains(down.Note, "not currently reachable on 127.0.0.1:3002") {
		t.Errorf("unreachable: %+v, want OK + not-reachable note with :3002", down)
	}
}

// TestCodeServerCheckUnresolvablePort proves a degenerate config (RK_PORT whose
// +2 leaves 1-65535, no override) reports an explicit not-resolvable state
// instead of probing 127.0.0.1:0 and reporting a confusing ":0" note.
func TestCodeServerCheckUnresolvablePort(t *testing.T) {
	t.Setenv("RK_PORT", "65535")
	t.Setenv("RK_CODE_SERVER_PORT", "")
	dialed := false
	c := codeServerCheck(
		t.TempDir(),
		func(string) (string, error) { return "/usr/bin/code-server", nil },
		func(string) bool { dialed = true; return false },
	)
	if !c.OK {
		t.Error("an unresolvable port must not fail the check (WARN case)")
	}
	if dialed {
		t.Error("reachability was probed on an unresolvable port")
	}
	if !strings.Contains(c.Note, "not resolvable") {
		t.Errorf("note = %q, want an explicit not-resolvable state", c.Note)
	}
	if strings.Contains(c.Note, ":0") {
		t.Errorf("note = %q, must not surface the degenerate :0 port", c.Note)
	}
}
