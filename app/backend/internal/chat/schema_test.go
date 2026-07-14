package chat

import (
	"encoding/json"
	"testing"
)

// TestEventJSONTags asserts the wire shape of an Event matches the intake's
// documented field names and omitempty rules (a message event omits tool fields;
// toolInput is raw JSON).
func TestEventJSONTags(t *testing.T) {
	e := Event{
		Type:      EventToolUse,
		ID:        "u1",
		Turn:      2,
		ToolUseID: "toolu_x",
		ToolName:  "Read",
		ToolInput: json.RawMessage(`{"file_path":"/x"}`),
		Timestamp: "2026-07-14T10:00:00.000Z",
	}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := m["type"]; !ok {
		t.Error("missing type")
	}
	if _, ok := m["toolInput"]; !ok {
		t.Error("missing toolInput")
	}
	// A tool_use event carries no role/text/toolOutput — omitempty drops them.
	for _, absent := range []string{"role", "text", "toolOutput", "isError"} {
		if _, present := m[absent]; present {
			t.Errorf("expected %q to be omitted on a tool_use event", absent)
		}
	}
	// turn is NOT omitempty — turn 0 must still serialize; here turn=2.
	if string(m["turn"]) != "2" {
		t.Errorf("turn = %s, want 2", m["turn"])
	}
}

// TestConversationJSONShape asserts the backfill object matches the intake's
// {"provider","sessionRef","events","pending"} shape, including pending:null.
func TestConversationJSONShape(t *testing.T) {
	c := Conversation{Provider: "claude", SessionRef: "ref", Events: []Event{}, Pending: nil}
	b, _ := json.Marshal(c)
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"provider", "sessionRef", "events", "pending"} {
		if _, ok := m[k]; !ok {
			t.Errorf("missing key %q", k)
		}
	}
	if string(m["pending"]) != "null" {
		t.Errorf("pending = %s, want null", m["pending"])
	}
}
