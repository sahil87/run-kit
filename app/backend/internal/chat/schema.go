// Package chat defines run-kit's provider-neutral chat event schema and the
// adapter seam that normalizes a coding agent's on-disk transcript into it. It is
// a READ-ONLY view over the agent pane (Constitution VI — the pane stays the
// agent's parent process; rk only reads the transcript) and derives everything
// from disk at request/stream time with nothing cached beyond the connection
// (Constitution II).
//
// The schema is rk-owned and neutral from day one so Codex/Gemini adapters are
// backend-only additions. v1 ships the Claude adapter (see claude.go); the
// adapter registry (adapter.go) routes on the `@rk_chat` provider prefix.
package chat

import "encoding/json"

// Role is the author of a message Event.
type Role string

const (
	// RoleUser is a human-authored (or slash-command) message.
	RoleUser Role = "user"
	// RoleAssistant is an agent-authored message.
	RoleAssistant Role = "assistant"
	// RoleSystem is a system message (reserved; not emitted by the v1 Claude
	// adapter, which filters system lines).
	RoleSystem Role = "system"
)

// Event.Type discriminants.
const (
	// EventMessage is a text message (user or assistant).
	EventMessage = "message"
	// EventToolUse is an agent tool invocation.
	EventToolUse = "tool_use"
	// EventToolResult is the result of a tool invocation.
	EventToolResult = "tool_result"
)

// Event is one rk-schema chat event; Type discriminates. The zero value is not
// meaningful — events are produced only by adapters. Fields carry omitempty so
// the JSON is minimal per event type (a message has no ToolName, a tool_use has
// no Text, etc.).
type Event struct {
	Type       string          `json:"type"`                 // "message" | "tool_use" | "tool_result"
	ID         string          `json:"id,omitempty"`         // provider line uuid — stable dedup key
	Turn       int             `json:"turn"`                 // monotonic turn counter (see the adapter's turn rule)
	Role       Role            `json:"role,omitempty"`       // message events
	Text       string          `json:"text,omitempty"`       // markdown text content
	ToolUseID  string          `json:"toolUseId,omitempty"`  // pairs tool_use <-> tool_result
	ToolName   string          `json:"toolName,omitempty"`   // tool_use
	ToolInput  json.RawMessage `json:"toolInput,omitempty"`  // tool_use input, verbatim provider JSON
	ToolOutput string          `json:"toolOutput,omitempty"` // tool_result, flattened to text
	IsError    bool            `json:"isError,omitempty"`    // tool_result error flag
	Timestamp  string          `json:"ts,omitempty"`         // RFC3339, from the provider line
}

// Pending is the "agent is waiting on the user" marker — a retractable STATE, not
// an append-only event. It is derived from an unpaired tool_use at the transcript
// tail (typically AskUserQuestion or a permission-gated tool) and resolves when
// the matching tool_result lands. Derivation-over-hooks per Constitution X: when
// a fact is derivable from disk, derivation wins.
type Pending struct {
	ToolUseID string `json:"toolUseId"`
	ToolName  string `json:"toolName"`
	Text      string `json:"text,omitempty"` // human-readable question, when derivable
}
