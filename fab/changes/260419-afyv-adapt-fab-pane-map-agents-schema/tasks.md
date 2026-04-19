# Tasks: Adapt to fab-kit `_agents` schema refactor

**Change**: 260419-afyv-adapt-fab-pane-map-agents-schema
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

<!-- No scaffolding required — this is a small behavioral change to existing code. -->

_(none)_

## Phase 2: Core Implementation

- [x] T001 Extend dedup rule in `app/backend/internal/sessions/sessions.go` (lines 73-87) — replace the single `if e.Change != nil && existing.Change == nil` branch with a `switch` that implements the priority ordering specified by the spec's "Pane-map dedup SHALL prefer richer fab state" requirement: (1) entry with non-nil `Change` wins over nil `Change`; (2) when both have nil `Change`, entry with non-nil `AgentState` wins; (3) otherwise first-seen is preserved. Keep the `paneMapEntry` struct (lines 25-35) unchanged.

## Phase 3: Integration & Edge Cases

- [x] T002 Add a new test case to `app/backend/internal/sessions/sessions_test.go` — function `TestPaneMapDedupPrefersAgentState` — that constructs two `paneMapEntry` values for the same `(session, window_index)` key, one with `Change: nil, AgentState: non-nil` (discussion-mode) and one with both nil (bare). The test SHALL assert that the dedup result for that key is the discussion-mode entry, and SHALL verify the assertion holds with both input slice orderings (agent-first and bare-first). Use the existing `strPtr` helper from the test file. The test MAY drive the dedup loop directly (as a local copy inside the test) rather than invoking `fetchPaneMap` — the subprocess path is already covered by `TestFetchPaneMapIntegration`. Also add a sibling test `TestPaneMapDedupChangeStillWinsOverAgent` that proves the existing rule-1 priority is unaffected: an entry with non-nil `Change` (and nil `AgentState`) MUST win over an entry with nil `Change` (and non-nil `AgentState`), regardless of input order.

- [x] T003 Run the backend test suite to verify no regressions — `cd app/backend && go test ./internal/sessions/... -run '^TestPaneMap'` and `cd app/backend && go test ./...`. Fix any failures by adjusting the implementation to match the spec (never the other way around per constitution § Test Integrity).
<!-- All new and existing TestPaneMap* tests pass; entire backend suite passes except for TestFetchPaneMapIntegration, which fails on a pre-existing environmental issue (rk/internal/tmux init() unsets TMUX, so fab's tmux subprocess cannot find the default socket). Verified failure is reproducible on the clean baseline without my changes — it is not a regression from T001/T002. -->


## Phase 4: Polish

- [ ] T004 Manual visual verification of sidebar rendering in discussion mode (required by spec "Sidebar pane panel SHALL render agent state for discussion-mode windows"). Start the dev stack (`just dev`), open a tmux window with a Claude discussion-mode agent (no fab change bound), confirm via the UI: (a) the sidebar `Pane` panel shows the `agt` row with agent state; (b) `run` line shows the command without an `idle` suffix; (c) no `fab` row renders; (d) no stage badge on the window row; (e) if the agent idles, `agt` row shows the agent-reported duration. If any of (a)-(e) is incorrect, fix in place — this becomes an implementation task rather than a verification task. Log the verification outcome (pass or the list of fixes applied) as a comment or note in the PR description.
<!-- manual task — deferred to human reviewer after PR merge; see PR description -->

---

## Execution Order

- T001 is self-contained (one file, one function).
- T002 depends on T001 (tests the new behavior).
- T003 depends on T001 and T002 (runs them).
- T004 is independent of T001-T003 — the frontend rendering change is zero-code per spec, but the verification MUST happen on a build that includes T001's backend fix, so T004 SHOULD run after T001 has been merged into the working tree.

T001 → T002 → T003 → T004.
