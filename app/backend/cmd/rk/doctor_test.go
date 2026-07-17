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
