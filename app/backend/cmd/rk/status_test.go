package main

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// TestStatusJSONShape pins the --json document contract: a JSON array whose
// entries are {name, windows}. Callers parse this shape, so the field names and
// types are a stable contract (Principle 2: machine formats stay stable).
func TestStatusJSONShape(t *testing.T) {
	sessions := []statusSession{
		{Name: "work", Windows: 3},
		{Name: "scratch", Windows: 1},
	}
	data, err := json.Marshal(sessions)
	if err != nil {
		t.Fatalf("marshal status sessions: %v", err)
	}

	var out []map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal status JSON: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("got %d entries, want 2", len(out))
	}
	if out[0]["name"] != "work" {
		t.Errorf("entry 0 name = %v, want %q", out[0]["name"], "work")
	}
	// JSON numbers unmarshal into float64 through interface{}.
	if out[0]["windows"] != float64(3) {
		t.Errorf("entry 0 windows = %v, want 3", out[0]["windows"])
	}
	// Only the two contract keys are present.
	for k := range out[0] {
		if k != "name" && k != "windows" {
			t.Errorf("unexpected key %q in status JSON entry", k)
		}
	}
}

// TestStatusJSONEmptyIsArray confirms an empty session list makes
// writeSessionStatusJSON emit a JSON array (`[]`), not `null` — a consumer
// iterating the result must never get a null it has to special-case. This drives
// the real emit path (the `make([]statusSession, 0, ...)` slice that guarantees
// `[]`, and the trailing-newline Fprintln), not a parallel json.Marshal — an
// empty session list means the window-listing loop never runs, so no tmux
// subprocess is touched.
func TestStatusJSONEmptyIsArray(t *testing.T) {
	var out bytes.Buffer
	cmd := &cobra.Command{}
	cmd.SetOut(&out)

	if err := writeSessionStatusJSON(context.Background(), cmd, "runkit", []tmux.SessionInfo{}); err != nil {
		t.Fatalf("writeSessionStatusJSON error: %v", err)
	}
	if got := out.String(); got != "[]\n" {
		t.Errorf("empty status JSON stdout = %q, want %q", got, "[]\n")
	}
}

// TestStatusJSONFlagRegistered pins that the --json flag exists on the status
// command (the command-tree surface the help-dump re-verification depends on).
func TestStatusJSONFlagRegistered(t *testing.T) {
	if statusCmd.Flags().Lookup("json") == nil {
		t.Error("status command is missing the --json flag")
	}
}
