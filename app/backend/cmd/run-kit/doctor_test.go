package main

import (
	"os/exec"
	"testing"
)

func TestDoctorTmuxLookPath(t *testing.T) {
	// This test verifies exec.LookPath works for tmux (the mechanism doctor uses).
	// On CI or environments without tmux, this documents the expected behavior.
	_, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not on PATH — skipping (expected in some CI environments)")
	}
	// If tmux is found, the doctor check would pass.
}
