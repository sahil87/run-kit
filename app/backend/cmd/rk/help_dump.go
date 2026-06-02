package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
)

// schemaVersion is the frozen contract version for the help-dump JSON.
// It mirrors the shape consumed by the sahil87/shll.ai landing site
// (reference sample: help/wt.json). Bump only on a breaking shape change.
const schemaVersion = 1

// nowUTC is the timestamp source for the dump's captured_at field. It is a
// package-level var so tests can override it with a fixed clock, keeping the
// otherwise non-deterministic timestamp deterministic under test.
var nowUTC = func() time.Time { return time.Now().UTC() }

// node is one command in the emitted help tree. Field names and order match
// the frozen JSON contract (mirrors sahil87/shll.ai help/wt.json). commands is
// recursive and MUST serialize as [] for a leaf, never null — callers build it
// as a non-nil slice.
type node struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Short    string `json:"short"`
	Usage    string `json:"usage"`
	Text     string `json:"text"`
	Commands []node `json:"commands"`
}

// dump is the top-level help-dump document. The shape is frozen:
// {tool, version, captured_at, schema_version, root}.
type dump struct {
	Tool          string `json:"tool"`
	Version       string `json:"version"`
	CapturedAt    string `json:"captured_at"`
	SchemaVersion int    `json:"schema_version"`
	Root          node   `json:"root"`
}

// includeInDump reports whether a command should appear in the dump. Cobra's
// auto-generated completion and help subcommands are excluded by name, and any
// hidden command (including help-dump itself) is excluded by flag. Applied at
// every recursion level, so a hidden parent's whole subtree is dropped.
func includeInDump(cmd *cobra.Command) bool {
	if cmd.Hidden {
		return false
	}
	switch cmd.Name() {
	case "completion", "help":
		return false
	}
	return true
}

// captureNode recursively builds a node from cmd, descending into visible
// children to full depth. commands is always non-nil so a leaf serializes as
// [] rather than null. The capture is pure introspection — no subprocess, no
// shell-string construction (constitution: Security First).
func captureNode(cmd *cobra.Command) node {
	n := node{
		Name:     cmd.Name(),
		Path:     cmd.CommandPath(),
		Short:    cmd.Short,
		Usage:    cmd.UseLine(),
		Text:     cmd.UsageString(),
		Commands: []node{},
	}
	for _, child := range cmd.Commands() {
		if !includeInDump(child) {
			continue
		}
		n.Commands = append(n.Commands, captureNode(child))
	}
	return n
}

// buildDump assembles the full document from root, an injected version, and an
// injected timestamp. Pure function of its inputs so it is testable without
// spawning a process or freezing global time.
func buildDump(root *cobra.Command, version string, now time.Time) dump {
	return dump{
		Tool:          "rk",
		Version:       version,
		CapturedAt:    now.Format(time.RFC3339),
		SchemaVersion: schemaVersion,
		Root:          captureNode(root),
	}
}

var helpDumpCmd = &cobra.Command{
	Use:    "help-dump [output-path]",
	Short:  "Emit the CLI help tree as JSON (build tooling)",
	Hidden: true,
	Args:   cobra.MaximumNArgs(1),
	RunE:   runHelpDump,
}

func runHelpDump(cmd *cobra.Command, args []string) error {
	doc := buildDump(rootCmd, displayVersion(), nowUTC())

	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding help-dump JSON: %w", err)
	}

	if len(args) == 1 {
		if err := os.WriteFile(args[0], data, 0o644); err != nil {
			return fmt.Errorf("writing help-dump to %s: %w", args[0], err)
		}
		return nil
	}

	if _, err := fmt.Fprintln(cmd.OutOrStdout(), string(data)); err != nil {
		return fmt.Errorf("writing help-dump to stdout: %w", err)
	}
	return nil
}
