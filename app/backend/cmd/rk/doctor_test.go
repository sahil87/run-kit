package main

import (
	"bytes"
	"encoding/json"
	"testing"
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
