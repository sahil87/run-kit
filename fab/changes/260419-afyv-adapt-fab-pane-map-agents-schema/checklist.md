# Quality Checklist: Adapt to fab-kit `_agents` schema refactor

**Change**: 260419-afyv-adapt-fab-pane-map-agents-schema
**Generated**: 2026-04-19
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Pane-map dedup SHALL prefer richer fab state: `fetchPaneMap` in `app/backend/internal/sessions/sessions.go` implements the Change > AgentState > first-seen priority ordering via a switch statement over the dedup branch. (Extracted into `dedupEntries` helper at `sessions.go:78-96` — invoked by `fetchPaneMap` at `sessions.go:73`; switch covers rule-1 and rule-2 explicitly.)
- [x] CHK-002 `sessions_test.go` SHALL exercise the new dedup preference: `TestPaneMapDedupPrefersAgentState` exists, feeds both input orderings, and asserts the agent-bearing entry wins. (`sessions_test.go:358-398`, subtests `agent-first` and `bare-first` both pass.)
- [x] CHK-003 `sessions_test.go` SHALL preserve rule-1 priority: `TestPaneMapDedupChangeStillWinsOverAgent` exists and asserts `Change: non-nil` wins over `Change: nil, AgentState: non-nil`. (`sessions_test.go:404-445`, subtests `change-first` and `agent-first` both pass.)
- [ ] CHK-004 Sidebar pane panel SHALL render agent state for discussion-mode windows: visual verification confirms the `agt` row appears, `run` suppresses `idle` suffix, no `fab` row, no stage badge. (Deferred to T004 — human-only visual verification after PR merge.)
- [x] CHK-005 Window-row stage badge SHALL NOT render in discussion mode: `win.fabStage && ...` branch at `window-row.tsx:166-168` remains empty when no fab change is bound. (No frontend files modified — existing branching at `window-row.tsx` unchanged.)
- [x] CHK-006 `getWindowDuration` SHALL prefer `agentIdleDuration` for discussion-mode idle windows: `format.ts:24-39` branching is agent-state-driven, independent of `fabChange`. (No frontend files modified — existing branching in `format.ts` unchanged.)
- [x] **N/A**: CHK-007 Architecture memory SHALL document agent-independent resolution: `docs/memory/run-kit/architecture.md` updated during hydrate to reflect the new contract. (Memory hydration is the next stage; not required during review.)

## Behavioral Correctness

- [x] CHK-008 Change > AgentState priority holds in all input orderings: dedup test fixtures prove determinism regardless of slice order. (Both `TestPaneMapDedup*` tests run both orderings and pass.)
- [x] CHK-009 Upstream schema stability: no new `.fab-runtime.yaml` reads introduced; `paneMapEntry` struct unchanged in name, shape, and JSON tags. (Grep-verified: zero `fab-runtime` references in `app/backend/`. Struct at `sessions.go:25-35` unchanged.)

## Scenario Coverage

- [x] CHK-010 Scenario "Discussion-mode agent pane wins over bare pane": covered by `TestPaneMapDedupPrefersAgentState`.
- [x] CHK-011 Scenario "Change-bound pane still wins over agent-only pane": covered by `TestPaneMapDedupChangeStillWinsOverAgent`.
- [x] CHK-012 Scenario "Both panes equal — first-seen wins": verified implicitly by existing tests that construct all-nil entries; no new test required but confirm preserved. (Switch falls through when both sides are all-nil — first-seen preserved; existing `TestPaneMapJoinPopulatesPerWindowFabFields` still passes.)
- [ ] CHK-013 Scenario "Discussion-mode agent shows in `agt` row": manually verified in step T004 of tasks.md. (Deferred to T004 — human visual verification.)
- [ ] CHK-014 Scenario "Discussion-mode idle agent shows duration in `agt` row": manually verified in step T004. (Deferred to T004 — human visual verification.)
- [ ] CHK-015 Scenario "Change-bound windows unchanged": regression-checked by running the dev stack against an existing change and confirming rendering matches pre-upgrade. (Deferred to T004 — human visual verification.)

## Edge Cases & Error Handling

- [x] CHK-016 Both panes agent-only, neither has `Change`, both have non-nil `AgentState`: rule-2 does not fire (since it requires exactly one nil `AgentState`); first-seen is preserved. (Switch rule-2 guard `e.AgentState != nil && existing.AgentState == nil` prevents firing when both non-nil.)
- [x] CHK-017 Empty pane-map (`fab pane map` returns `[]`): `fetchPaneMap` returns an empty map; no windows are enriched. Existing `TestPaneMapNilLeavesAllFieldsEmpty` covers this. (Test still passes.)
- [x] CHK-018 `fab` missing from PATH: `fetchPaneMap` returns error; stale cache preserved or windows get empty fab fields. Existing `TestFetchPaneMapFabNotOnPath` covers this. (Test still passes.)

## Code Quality

- [x] CHK-019 Readability: dedup loop priority ordering is self-documenting via switch-statement with commented rule labels. (Comment at `sessions.go:87` names the priority ordering; switch cases are explicit.)
- [x] CHK-020 Follow project patterns: Go `switch` with labeled priorities matches existing style in `internal/sessions/`; no new abstraction layers introduced. (Extracting `dedupEntries` is a minor but positive refactor — improves testability without introducing a new layer.)
- [x] CHK-021 `exec.CommandContext` with timeouts: `fetchPaneMap` already uses `context.WithTimeout` (unchanged); no new subprocess calls added.
- [x] CHK-022 Tests colocated with code: new tests live in `app/backend/internal/sessions/sessions_test.go` (same package).
- [x] CHK-023 Derivation from tmux + filesystem: change preserves the existing data-derivation posture; no new caches or state introduced.
- [x] CHK-024 Pattern consistency: new code follows naming and structural patterns of surrounding code. (`dedupEntries` naming and signature consistent with surrounding helpers.)
- [x] CHK-025 No unnecessary duplication: existing utilities (`strPtr` test helper, `derefStr`, `paneMapEntry` struct) are reused. (`strPtr` used in new tests; `paneMapEntry` struct unchanged.)
- [x] CHK-026 No magic strings: no new literals introduced beyond test fixture values clearly scoped to test functions.
- [x] CHK-027 No shell string construction: no new subprocess calls added; existing `exec.CommandContext` call with argument slice unchanged.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
