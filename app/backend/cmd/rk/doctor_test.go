package main

import (
	"bytes"
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
