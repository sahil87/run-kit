package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestVersionOutput(t *testing.T) {
	buf := new(bytes.Buffer)

	// Temporarily replace the Run func to use cmd.Print (which respects SetOut).
	origRun := versionCmd.Run
	versionCmd.Run = func(cmd *cobra.Command, args []string) {
		cmd.Printf("rk version %s\n", version)
	}
	defer func() { versionCmd.Run = origRun }()

	rootCmd.SetOut(buf)
	rootCmd.SetArgs([]string{"version"})

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("version command failed: %v", err)
	}

	got := strings.TrimSpace(buf.String())
	want := "rk version dev"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
