# Spec: Adapt to fab-kit `_agents` schema refactor

**Change**: 260419-afyv-adapt-fab-pane-map-agents-schema
**Created**: 2026-04-19
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Direct consumption of `_agents[session_id].tmux_pane` from `.fab-runtime.yaml` — run-kit's sole fab-state contract remains the `fab pane map --json` subprocess output. Reintroducing a YAML read would undo `260313-3vlx-pane-map-enrichment`.
- Adding a `pid` or process-identity axis to the pane-map join — fab-kit does not surface `pid` in `fab pane map` output today. Defer until the JSON schema grows it.
- Tightening the 5s pane-map cache TTL to absorb fab-side `_agents` churn — the upstream refactor's mtime frequency does not change per-invocation cost enough to matter.
- Explicit "discussion-mode" classification in backend types — run-kit infers this implicitly from the combination of `fabChange == ""` and `agentState != ""`.

## Backend: Pane-map dedup preference

### Requirement: Pane-map dedup SHALL prefer richer fab state

When `fab pane map --json --all-sessions` returns multiple entries that collide on `(session, window_index)` — i.e. split panes within the same tmux window — `fetchPaneMap` in `app/backend/internal/sessions/sessions.go` SHALL resolve the collision by selecting the entry with the richest fab state, in descending priority:

1. An entry whose `Change` is non-nil SHALL win over an entry whose `Change` is nil.
2. When both entries have a nil `Change`, an entry whose `AgentState` is non-nil SHALL win over an entry whose `AgentState` is nil.
3. When both entries are equally rich (either both have `Change` set, or both have `Change` nil and either both-or-neither have `AgentState` set), the first-seen entry SHALL be preserved (stable iteration order).

The existing struct tag and field shape of `paneMapEntry` (`sessions.go:25-35`) MUST remain unchanged. The change is strictly within the body of the dedup loop at `sessions.go:73-87`.

#### Scenario: Discussion-mode agent pane wins over bare pane

- **GIVEN** a tmux window with two panes — pane A runs a Claude discussion-mode agent (`fab pane map` emits `change: null, agent_state: "active"`), pane B has no fab state (`change: null, agent_state: null`)
- **WHEN** `fetchPaneMap` iterates the JSON entries
- **THEN** the resulting map entry for `(session, window_index)` SHALL be pane A (populated `AgentState`), not pane B (both fields nil)
- **AND** enrichment at `sessions.go:374-377` SHALL surface pane A's agent state to the frontend

#### Scenario: Change-bound pane still wins over agent-only pane

- **GIVEN** a tmux window with two panes — pane A has `change: "260313-abc", agent_state: null`, pane B has `change: null, agent_state: "active"`
- **WHEN** `fetchPaneMap` iterates the JSON entries in either order
- **THEN** the resulting map entry SHALL be pane A (non-nil `Change`), per existing rule-1 priority
- **AND** the new rule-2 priority SHALL NOT override rule-1

#### Scenario: Both panes equal — first-seen wins

- **GIVEN** a tmux window with two panes, both with `change: null, agent_state: null`
- **WHEN** `fetchPaneMap` iterates the JSON entries
- **THEN** the first entry encountered SHALL be preserved in the map (existing behavior, unchanged)

#### Scenario: Both panes agent-only, opposite iteration orders converge

- **GIVEN** a tmux window with two panes, both with `change: null` but both with non-nil `agent_state`
- **WHEN** `fetchPaneMap` iterates the JSON entries
- **THEN** the first-seen entry SHALL be preserved (rule-2 applies only when exactly one side is nil)

### Requirement: Pane-map join SHOULD remain agnostic to upstream schema changes

The `fetchPaneMap` function MUST continue to consume the `fab pane map --json` subprocess output only — no direct reads of `.fab-runtime.yaml`. The `paneMapEntry` struct fields (`session`, `window_index`, `pane`, `tab`, `worktree`, `change`, `stage`, `agent_state`, `agent_idle_duration`) MUST match the fab-kit v1.5.0 JSON contract unchanged.

#### Scenario: Upstream schema stability

- **GIVEN** fab-kit v1.5.0 has shipped the `_agents` schema refactor that moves agent state into a top-level `_agents` bucket
- **WHEN** run-kit invokes `fab pane map --json --all-sessions`
- **THEN** the JSON output fields consumed by `paneMapEntry` SHALL be unchanged in name and shape
- **AND** no run-kit code path SHALL read `.fab-runtime.yaml` directly

## Backend: Unit test coverage for dedup preference

### Requirement: `sessions_test.go` SHALL exercise the new dedup preference

`app/backend/internal/sessions/sessions_test.go` SHALL add at least one new test case that feeds `fetchPaneMap` (or a dedup-level helper covering the same loop) a two-entry slice where one entry is discussion-mode (`change: null, agent_state: non-nil`) and the other is bare (both nil), and verifies the discussion-mode entry is preserved in the resulting map regardless of input order.

#### Scenario: Test asserts agent pane wins over bare pane

- **GIVEN** a test fixture with two `paneMapEntry` values for the same `(session, window_index)`, one with populated `AgentState` and one without
- **WHEN** the test exercises the dedup logic
- **THEN** the map lookup for that key SHALL return the entry with populated `AgentState`
- **AND** the test SHALL run with both iteration orders (agent-first and bare-first) to prove the result is deterministic

#### Scenario: Existing tests continue to pass

- **GIVEN** the existing tests `TestPaneMapEntryParsing`, `TestPaneMapJoinPopulatesPerWindowFabFields`, `TestPaneMapNilLeavesAllFieldsEmpty`, `TestFetchPaneMapFabNotOnPath`, `TestFetchPaneMapIntegration`
- **WHEN** `go test ./app/backend/internal/sessions/...` runs after the dedup change
- **THEN** all existing tests SHALL continue to pass unmodified

## Frontend: Discussion-mode rendering

### Requirement: Sidebar pane panel SHALL render agent state for discussion-mode windows

After the fab-kit v1.5.0 upgrade, the sidebar `Pane` panel (`app/frontend/src/components/sidebar/status-panel.tsx`) SHALL surface the `agt` row for windows where the agent is active but no fab change is bound. The existing rendering branches MUST continue to handle change-bound windows identically to prior behavior.

No code change is required for this requirement — it SHALL be satisfied by the existing branching in `getProcessLine` (`status-panel.tsx:47-63`), `getAgentLine` (`status-panel.tsx:66-70`), and the panel body (`status-panel.tsx:146-205`). The requirement is a verification contract, not a new implementation.

#### Scenario: Discussion-mode agent shows in `agt` row

- **GIVEN** a tmux window bound to a Claude discussion-mode agent with no active fab change (`win.fabChange === ""`, `win.agentState === "active"`)
- **WHEN** the sidebar `Pane` panel renders for that window
- **THEN** the `agt` row SHALL be present with the agent state text
- **AND** the `run` line SHALL show the pane command without an `idle` suffix (`getProcessLine` returns command-only because `win.agentState` is truthy)
- **AND** the `fab` row SHALL NOT render (no `fabLine` because `fabChange` is absent)

#### Scenario: Discussion-mode idle agent shows duration in `agt` row

- **GIVEN** a tmux window bound to a Claude discussion-mode agent that is idle (`win.agentState === "idle"`, `win.agentIdleDuration === "5m"`, `win.fabChange === ""`)
- **WHEN** the sidebar `Pane` panel renders
- **THEN** the `agt` row SHALL read `idle 5m` (or equivalent via `getAgentLine`)
- **AND** the `run` line SHALL NOT repeat the idle duration

#### Scenario: Change-bound windows unchanged

- **GIVEN** a tmux window bound to a change with an active agent (`win.fabChange === "260313-abc-feature"`, `win.fabStage === "apply"`, `win.agentState === "active"`)
- **WHEN** the sidebar `Pane` panel renders
- **THEN** rendering SHALL match pre-upgrade behavior — `fab` row with change and stage, plus `agt` row with agent state

### Requirement: Window-row stage badge SHALL NOT render in discussion mode

The per-window stage badge at `app/frontend/src/components/sidebar/window-row.tsx:166-168` (`win.fabStage && ...`) SHALL remain empty when the window has no fab change bound, because `fabStage` remains empty independent of `agentState`.

#### Scenario: Discussion-mode window has no stage badge

- **GIVEN** a tmux window with `win.fabStage === ""` and `win.agentState === "active"`
- **WHEN** the window row renders in the sidebar
- **THEN** no stage badge SHALL appear in the right-side metadata span
- **AND** the window duration (from `getWindowDuration`) SHALL continue to render if the window is idle

### Requirement: `getWindowDuration` SHALL prefer `agentIdleDuration` for discussion-mode idle windows

`app/frontend/src/lib/format.ts:24-39` SHALL continue to return `agentIdleDuration` when `agentState === "idle"` and `agentIdleDuration` is truthy, regardless of whether `fabChange` is empty. The function MUST NOT introduce new branching that gates on `fabChange`.

#### Scenario: Idle discussion-mode agent uses agent-reported duration

- **GIVEN** `win.activity !== "active"`, `win.agentState === "idle"`, `win.agentIdleDuration === "12m"`, `win.fabChange === ""`
- **WHEN** `getWindowDuration(win, nowSeconds)` is called
- **THEN** the return SHALL be `"12m"`
- **AND** the fallback `activityTimestamp` path SHALL NOT execute

## Memory update

### Requirement: `docs/memory/run-kit/architecture.md` SHALL document agent-independent resolution

The architecture memory file SHALL be updated during hydrate to note that agent state now resolves independently of change state after the fab-kit v1.5.0 `_agents` schema refactor: `fabChange`/`fabStage` and `agentState`/`agentIdleDuration` can each populate or be empty independently on any window. The update SHALL be applied to the "pane-map enrichment" discussion (around line 82-93 in the current file) without removing any existing semantics.

#### Scenario: Memory reflects post-refactor contract

- **GIVEN** the hydrate stage begins after implementation and review pass
- **WHEN** `/fab-continue` hydrates memory
- **THEN** `docs/memory/run-kit/architecture.md` SHALL contain a paragraph clarifying that `agentState`/`agentIdleDuration` can populate for windows with no `fabChange` bound (discussion-mode agents), and the dedup rule in `sessions.go` now prefers entries with populated `AgentState` when both sides have `Change: nil`

## Design Decisions

1. **Dedup priority is Change > AgentState > first-seen** (not a flat combined "richness" score)
   - *Why*: `Change` remains the stronger signal because a change-bound pane is always agent-bearing in practice, and the existing priority ordering is already understood. Agent-only is a secondary fallback specifically for discussion-mode.
   - *Rejected*: A scoring function like `score = (Change != nil) * 2 + (AgentState != nil) * 1` — equivalent in effect but opaque at the call site. The switch statement makes the priority ordering self-documenting.

2. **No new data-class for "discussion-mode"**
   - *Why*: Run-kit already treats `fabChange` and `agentState` as independent fields. Adding a derived `isDiscussionMode` classification would only be consumed in rendering and would introduce a new concept duplicating `fabChange === "" && agentState !== ""`. Readers can infer from the existing fields.
   - *Rejected*: A `window.mode: "fab" | "discussion" | "plain"` enum — needless abstraction.

3. **Dedup test iterates input in both orders**
   - *Why*: Go map iteration is randomized, but `fetchPaneMap`'s input is a `[]paneMapEntry` with deterministic order from the JSON. Asserting the rule in both orders (`[bare, agent]` and `[agent, bare]`) proves the dedup is based on the entry content, not position.
   - *Rejected*: Single-order test — would not catch a bug where the dedup rule is accidentally inverted and happens to work only when the "right" entry shows up first.

4. **No cache TTL change** (validates Tentative #8 from intake, now Certain)
   - *Why*: The 5s pane-map cache (`fetchPaneMapCached`, `sessions.go:107-135`) absorbs fab-kit's churn from `_agents` mutations. Each fab-side write touches the runtime YAML, but run-kit reads the subprocess output at most once per 5s per server.
   - *Rejected*: Measurement-driven tightening/loosening of TTL — not warranted without evidence of a regression.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The `.fab-runtime.yaml` schema change is invisible to run-kit | Confirmed from intake #1. Grep-verified: no direct reads remain in live code after `260313-3vlx-pane-map-enrichment` | S:95 R:90 A:95 D:95 |
| 2 | Certain | JSON field names in `fab pane map` output are unchanged across v1.5.0 | Confirmed from intake #2. `paneMapEntry` struct at `sessions.go:25-35` continues to unmarshal the v1.5.0 output correctly | S:95 R:85 A:90 D:95 |
| 3 | Certain | No run-kit code treats `agent_state == null` as a proxy for "no change" | Confirmed from intake #3. `getProcessLine` (`status-panel.tsx:47-63`) and `getAgentLine` (`status-panel.tsx:66-70`) branch on `agentState` independently of `fabChange` | S:90 R:90 A:90 D:95 |
| 4 | Certain | Dedup rule priority: Change > AgentState > first-seen | Confirmed from intake #4. Switch-statement implementation keeps priority ordering self-documenting; see Design Decision 1 | S:95 R:80 A:70 D:85 |
| 5 | Certain | Frontend rendering behavior in discussion mode matches existing design intent | Confirmed from intake #5. `status-panel.tsx:146-205` already separates `fab`/`run`/`agt` rows and gracefully handles `fabChange` absent + `agentState` present | S:95 R:80 A:75 D:80 |
| 6 | Certain | Precondition met: fab-kit v1.5.0 shipped with `_agents` refactor and `fab_version: 1.5.0` in `fab/project/config.yaml` — change is unblocked | Confirmed from intake #6 | S:95 R:90 A:80 D:90 |
| 7 | Certain | Direct `tmux_pane` consumption is deferred; keep current session:windowIndex join | Confirmed from intake #7 | S:95 R:65 A:55 D:60 |
| 8 | Certain | Performance impact from `_agents` mtime churn is negligible for run-kit | Confirmed from intake #8. 5s pane-map cache absorbs any fab-side churn | S:95 R:70 A:60 D:65 |
| 9 | Certain | Intake location references for `getProcessLine`/`getAgentLine` point to `format.ts`, but these functions actually live in `status-panel.tsx:47-70` | Discovered during spec-level code audit. Spec uses the correct locations; intake's line references were stale. Spec requirement text supersedes | S:95 R:70 A:85 D:90 |
| 10 | Certain | Dedup test fixture uses Go's stable slice iteration to verify both input orders | See Design Decision 3. Slice order is deterministic (Go's randomized iteration is map-only), so the test feeds two slices with swapped entries | S:90 R:60 A:85 D:85 |
| 11 | Certain | Frontend verification is a manual/visual task, not a new automated test | The intake's §2 "Visual verification" is a reviewer-run smoke test, not a Playwright addition. `status-panel.tsx` has no e2e test today and spec SHOULD NOT manufacture one solely for this change. Constitution's "Test Companion Docs" applies only to `*.spec.ts`, and none exist for status-panel | S:85 R:70 A:80 D:85 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
