package main

import (
	"testing"
)

func TestRootCmdDefaultsToServe(t *testing.T) {
	// The root command's RunE should be set (delegating to serveCmd).
	if rootCmd.RunE == nil {
		t.Fatal("rootCmd.RunE should be set to delegate to serve")
	}
}

func TestRootCmdHasSubcommands(t *testing.T) {
	expected := map[string]bool{
		"serve":   false,
		"version": false,
		"upgrade": false,
		"doctor":  false,
		"status":  false,
	}

	for _, cmd := range rootCmd.Commands() {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected subcommand %q not found", name)
		}
	}
}
