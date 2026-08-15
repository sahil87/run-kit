package main

import (
	"testing"

	"rk/internal/tmux"
)

// TestMuxServerResolution pins the -L > $TMUX-derived > default precedence.
func TestMuxServerResolution(t *testing.T) {
	origFlag, origTMUX := muxServerFlag, muxOriginalTMUXFn
	t.Cleanup(func() { muxServerFlag, muxOriginalTMUXFn = origFlag, origTMUX })

	muxServerFlag = ""
	muxOriginalTMUXFn = func() string { return tmux.OriginalTMUX }

	muxOriginalTMUXFn = func() string { return "/tmp/tmux-1000/dev,123,0" }
	if got := muxServer(); got != "dev" {
		t.Errorf("muxServer() = %q, want %q (socket basename)", got, "dev")
	}

	muxServerFlag = "other"
	if got := muxServer(); got != "other" {
		t.Errorf("muxServer() = %q, want -L flag to win", got)
	}
	muxServerFlag = ""

	muxOriginalTMUXFn = func() string { return "" }
	if got := muxServer(); got != "default" {
		t.Errorf("muxServer() = %q, want %q outside tmux", got, "default")
	}

	muxOriginalTMUXFn = func() string { return ",," }
	if got := muxServer(); got != "default" {
		t.Errorf("muxServer() = %q, want %q for a malformed $TMUX", got, "default")
	}
}

// TestMuxFamilyRegistered: the root gains exactly one mux row, and the family
// lists send and await with the shared -L flag inherited.
func TestMuxFamilyRegistered(t *testing.T) {
	found := false
	count := 0
	for _, c := range rootCmd.Commands() {
		if c.Name() == "mux" {
			count++
			for _, sub := range c.Commands() {
				switch sub.Name() {
				case "send":
				case "await":
				default:
					t.Errorf("unexpected mux subcommand %q", sub.Name())
				}
				if sub.Flag("server") == nil {
					t.Errorf("mux %s does not inherit the -L/--server flag", sub.Name())
				}
			}
			if len(c.Commands()) != 2 {
				t.Errorf("mux has %d subcommands, want exactly 2 (send, await)", len(c.Commands()))
			}
			found = true
		}
	}
	if !found {
		t.Fatal("mux command not registered on root")
	}
	if count != 1 {
		t.Errorf("mux registered %d times on root, want 1", count)
	}
}
