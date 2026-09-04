package api

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"rk/internal/inject"
)

// Shared fixtures for the tests of the kept chat infrastructure consumers
// (operator actuation, auto-name, the /send route): a staged Claude transcript
// on disk plus the fast-probe seams that keep injection tests quick.

const testTranscriptRef = "5d80479e-8f25-46cd-a0d4-e51435508a37"

// stageFixtureTranscript writes the sanitized chat fixture to a temp
// CLAUDE_CONFIG_DIR under the given ref and points $CLAUDE_CONFIG_DIR at it.
func stageFixtureTranscript(t *testing.T, ref string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFixtureAt(t, projDir, ref)
}

// stageEmptyConfigDir points $CLAUDE_CONFIG_DIR at a fresh temp dir with a
// projects/<proj> subdir but NO transcript, and returns the projects/<proj>
// path. Writing "<ref>.jsonl" there later makes a transcript appear — the lazy
// -creation-post-/clear scenario.
func stageEmptyConfigDir(t *testing.T) (projDir string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	projDir = filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return projDir
}

// writeFixtureAt writes the sanitized fixture transcript as "<ref>.jsonl" under
// projDir (used to make a transcript "appear" mid-test).
func writeFixtureAt(t *testing.T, projDir, ref string) {
	t.Helper()
	fixture, err := os.ReadFile(filepath.Join("..", "internal", "transcript", "testdata", "claude_session.jsonl"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projDir, ref+".jsonl"), fixture, 0o644); err != nil {
		t.Fatal(err)
	}
}

// fastAgentSendProbe shrinks the probe settle/gap so the retry loop runs quickly
// under test, restoring the production values after.
func fastAgentSendProbe(t *testing.T) {
	t.Helper()
	ps, pg := inject.ProbeSettle, inject.ProbeGap
	submitBackoff := append([]time.Duration(nil), inject.SubmitBackoff...)
	inject.ProbeSettle = time.Millisecond
	inject.ProbeGap = time.Millisecond
	inject.SubmitBackoff = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}
	t.Cleanup(func() {
		inject.ProbeSettle, inject.ProbeGap = ps, pg
		inject.SubmitBackoff = submitBackoff
	})
}

func unverifiedSubmitOps(t *testing.T, baseline, preFrame string) *mockTmuxOps {
	t.Helper()
	retries := inject.SubmitRetries
	inject.SubmitRetries = 0
	t.Cleanup(func() { inject.SubmitRetries = retries })
	captures := []string{baseline, preFrame}
	for range inject.SubmitBackoff {
		captures = append(captures, preFrame)
	}
	return &mockTmuxOps{capturePaneResults: captures}
}
