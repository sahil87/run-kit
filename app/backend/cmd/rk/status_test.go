package main

import (
	"encoding/json"
	"testing"
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

// TestStatusJSONEmptyIsArray confirms an empty session list marshals to a JSON
// array (`[]`), not `null` — a consumer iterating the result must never get a
// null it has to special-case.
func TestStatusJSONEmptyIsArray(t *testing.T) {
	empty := make([]statusSession, 0)
	data, err := json.Marshal(empty)
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if string(data) != "[]" {
		t.Errorf("empty status JSON = %q, want %q", string(data), "[]")
	}
}

// TestStatusJSONFlagRegistered pins that the --json flag exists on the status
// command (the command-tree surface the help-dump re-verification depends on).
func TestStatusJSONFlagRegistered(t *testing.T) {
	if statusCmd.Flags().Lookup("json") == nil {
		t.Error("status command is missing the --json flag")
	}
}
