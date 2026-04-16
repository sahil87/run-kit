package main

import (
	"bytes"
	"strings"
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
		"serve":    false,
		"update":   false,
		"doctor":   false,
		"status":   false,
		"context":  false,
		"init-conf": false,
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

func TestVersionFlag(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetArgs([]string{"--version"})

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("--version flag failed: %v", err)
	}

	got := strings.TrimSpace(buf.String())
	want := "rk version dev"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestShortVersionFlag(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetArgs([]string{"-v"})

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("-v flag failed: %v", err)
	}

	got := strings.TrimSpace(buf.String())
	want := "rk version dev"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestVersionSubcommandRemoved(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetArgs([]string{"version"})

	err := rootCmd.Execute()
	if err == nil {
		t.Fatal("expected error for removed 'version' subcommand, got nil")
	}

	errMsg := err.Error()
	if !strings.Contains(errMsg, "unknown command") || !strings.Contains(errMsg, "version") {
		t.Fatalf("unexpected error for 'version' subcommand: %v", err)
	}
}
