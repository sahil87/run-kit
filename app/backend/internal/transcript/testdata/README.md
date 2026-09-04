# chat adapter test fixtures

## `claude_session.jsonl`

A **sanitized**, structurally-faithful Claude Code session transcript used to pin
the tolerant JSONL parser against format drift (plan risk #1). It is hand-built
to exercise every structural case the parser must handle, with the exact envelope
and content-block shapes **verified against live transcripts on this host** during
apply (2026-07-14).

**Producing Claude Code version**: `2.1.209` (the `claude --version` on the host
where the envelope/block shapes were verified). The raw JSONL line format is
officially internal/unsupported and can drift across versions — hence a pinned
fixture plus synthetic drift cases in `claude_test.go`. Re-verify and re-pin if a
newer Claude Code version changes the transcript shape.

**Sanitization**: no content is copied verbatim from any real conversation. All
message text, tool inputs, and tool outputs are placeholder strings prefixed
`SANITIZED`. Only the *structure* (line types, envelope keys, block shapes,
string-vs-array content, sidechain flag, turn boundaries, an unpaired
`AskUserQuestion` tail) mirrors real transcripts.

Structural cases covered, in order:

1. Non-conversation line types that must be **skipped** (`permission-mode`,
   `custom-title`, `agent-name`, `file-history-snapshot`).
2. A **string-content** user message (slash-command shape) — opens turn 1.
3. Assistant `text` block.
4. A `thinking` block (must be **skipped** in v1) alongside a `tool_use`.
5. A **tool_result-carrier** user message (string content) — continues turn 1,
   does NOT open a new turn; pairs `toolu_A`.
6. An `isSidechain: true` line — must be **excluded**.
7. An unknown line type — skipped.
8. A second real user prompt — opens turn 2.
9. A `tool_use` whose `tool_result` has **array** content — flattened to text.
10. An unpaired `AskUserQuestion` `tool_use` at the tail — yields a `Pending`
    with derived question text.
