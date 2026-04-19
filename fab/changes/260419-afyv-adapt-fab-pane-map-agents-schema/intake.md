# Intake: Adapt to fab-kit `_agents` schema refactor

**Change**: 260419-afyv-adapt-fab-pane-map-agents-schema
**Created**: 2026-04-19
**Status**: Draft

## Origin

Cross-repo impact analysis triggered by a pending fab-kit refactor to `.fab-runtime.yaml` and `fab pane map`. The upstream change moves agent state out of change-folder-keyed entries into a top-level `_agents` bucket keyed by Claude's `session_id`, and makes agents first-class runtime entries so that "discussion mode" agents (no active change yet) show up in pane map output. This intake is the run-kit-side draft for adapting to those upstream changes, intended to be picked up after fab-kit ships.

> "fab-kit is making agents visible in pane map even when no change is active. Assess how run-kit's daemon — which consumes `fab pane map --json --all-sessions --server runKit` — is affected and produce a draft intake if warranted."

One-shot intake — no prior conversation in this thread. Analysis was read-only and grounded in the current run-kit code.

## Why

**Primary motivation — semantic expansion benefits run-kit at zero code cost.** Today `fab pane map` only emits `agent_state` when an active change is bound to the window (via `.fab-status.yaml`). The upstream refactor decouples agent state from change state: discussion-mode agents produce `_agents[session_id]` entries immediately, and `fab pane map` joins them to tmux panes via a new `tmux_pane` property. After the upgrade, `agentState` / `agentIdleDuration` will populate for windows where an agent is running with no active change — exactly the state that today shows nothing. The sidebar `agt` row (`app/frontend/src/components/sidebar/status-panel.tsx:199-205`) becomes useful in more places, `getAgentLine()` (`app/frontend/src/lib/format.ts:66-70`) starts returning non-null in more cases, and the "agent is working" signal becomes reliable across the whole dashboard.

**Secondary motivation — validate that no run-kit code breaks.** The analysis surfaced one subtle risk: the frontend branching in `getProcessLine()` (`app/frontend/src/lib/format.ts:47-63`) and `getAgentLine()` (`app/frontend/src/lib/format.ts:66-70`) predicates on `win.agentState` truthiness to decide whether to show the idle timestamp in the `run` line vs. defer to the `agt` row. Today, a discussion-mode agent window falls into the "no agentState → show activityTimestamp-based idle in run line" path. After the refactor, the same window will have `agentState` populated → the `agt` row appears and `run` line suppresses the idle suffix. This is a **rendering change, not a break** — arguably an improvement (duration lives in the dedicated row) — but it deserves a visual verification.

**What does NOT break:**

- Schema change to `.fab-runtime.yaml` is invisible to run-kit. Commit `4a98547`-era refactor already eliminated all direct reads (`260313-3vlx-pane-map-enrichment/spec.md:183`). Run-kit's sole contract is the `fab pane map --json` subprocess output.
- JSON field names (`session`, `window_index`, `change`, `stage`, `agent_state`, `agent_idle_duration`) are unchanged. `paneMapEntry` in `app/backend/internal/sessions/sessions.go:25-35` remains valid.
- The "multiple panes in the same window (splits)" deduplication at `sessions.go:76-86` prefers the entry with a non-nil `Change`. Under the new schema, split panes could have populated `agent_state` but nil `change` (discussion mode). The current dedup rule keeps the first entry when neither has `Change`, which is acceptable — but we may want to extend the preference to also favor entries with populated `AgentState` so that an active agent pane doesn't lose visibility to a sibling pane with no agent.
- No code path in run-kit currently treats `agent_state == null` as a proxy for "no change" — the two fields are consumed independently by `status-panel.tsx` and `format.ts`.
- `change_folder` is not referenced in live code. `tmux_pane` and `_agents` are not consumed (run-kit reads the pane-map CLI, not the runtime YAML).

**Why adapt now rather than wait for user complaints:** The dedup rule (point above) is the only non-trivial semantic shift. Fixing it proactively is a ~5-line change; leaving it until a user notices that an active discussion-mode agent is invisible in a split window would be reactive and hard to diagnose.

## What Changes

### 1. Pane-map dedup: also prefer entries with populated `AgentState`

`app/backend/internal/sessions/sessions.go:73-87` currently dedups multiple pane entries for the same `(session, windowIndex)` key by preferring the entry with a non-nil `Change`. Extend the rule to also prefer entries with a non-nil `AgentState` when neither has `Change`.

**Before:**

```go
for _, e := range entries {
    key := fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)
    if existing, ok := m[key]; ok {
        if e.Change != nil && existing.Change == nil {
            m[key] = e
        }
    } else {
        m[key] = e
    }
}
```

**After (proposed):**

```go
for _, e := range entries {
    key := fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)
    existing, ok := m[key]
    if !ok {
        m[key] = e
        continue
    }
    // Prefer richer fab state. Priority: Change > AgentState > first-seen.
    switch {
    case e.Change != nil && existing.Change == nil:
        m[key] = e
    case e.Change == nil && existing.Change == nil && e.AgentState != nil && existing.AgentState == nil:
        m[key] = e
    }
}
```

Rationale: after the refactor, a split window could contain one pane with a discussion-mode agent (populated `AgentState`, nil `Change`) and another pane with no agent. The active-agent pane should win.

### 2. Visual verification of sidebar / top-bar rendering in discussion mode

No code change — this is a test/memory task. Confirm with a live discussion-mode agent (no active change) that:

- Sidebar `Pane` panel renders the `agt <state> <duration>` row (`app/frontend/src/components/sidebar/status-panel.tsx:199-205`).
- Sidebar window-row does NOT show a stage badge (`win.fabStage` is empty — `app/frontend/src/components/sidebar/window-row.tsx:166-168`), which is correct.
- `getWindowDuration` (`app/frontend/src/lib/format.ts:24-39`) returns the `agentIdleDuration` for idle discussion-mode agents instead of falling through to `activityTimestamp`-based computation.
- `run` line shows the command only (without idle suffix) since `agentState` is truthy (`format.ts:52`), and the idle duration is surfaced in the dedicated `agt` row.

If any rendering is off (e.g., clipped state transitions, missing agent row), fix in-place.

### 3. Tests

Add a unit test to `app/backend/internal/sessions/sessions_test.go` covering the new dedup preference — discussion-mode agent pane wins over bare pane within the same window.

Existing tests (`TestPaneMapEntryParsing`, `TestPaneMapJoinPopulatesPerWindowFabFields`, `TestPaneMapNilLeavesAllFieldsEmpty`) continue to pass unmodified — they already exercise `Change=nil, AgentState=nil` and `Change=set, AgentState=set` combinations. Add coverage for `Change=nil, AgentState=set` (new discussion-mode shape).

### 4. Memory update

`docs/memory/run-kit/architecture.md` describes pane-map enrichment semantics around line 82 and the 2026-03-14 history entry at line 445. Add a brief note that agent state now resolves independently of change state (post-fab-kit-refactor), so `agentState` / `agentIdleDuration` can be populated for windows with no `fabChange`.

### 5. Pickup timing

Unblocked as of 2026-04-19: fab-kit v1.5.0 has shipped the `_agents` schema refactor, and `fab/project/config.yaml` has `fab_version: 1.5.0`. Ready to proceed to spec/apply. Pre-spec sanity check:

1. Run `fab pane map --json --all-sessions` from a worktree with a discussion-mode agent running (no active change); confirm the entry shows populated `agent_state`.

## Affected Memory

- `run-kit/architecture.md`: (modify) note that agent state resolves independently of change state after the fab-kit `_agents` schema refactor; both fields can now populate or be null independently.

## Impact

**Backend code:**
- `app/backend/internal/sessions/sessions.go:73-87` — dedup rule extension (~5 lines).
- `app/backend/internal/sessions/sessions_test.go` — one new test case for the discussion-mode dedup preference.

**Frontend code:**
- No functional changes. Existing rendering handles the new data shape correctly (pending visual verification).

**API contract:**
- No changes. `/api/sessions` response shape is unchanged; the fields simply populate in more scenarios.

**External dependencies:**
- Blocked on fab-kit shipping the `_agents` schema refactor. Requires `fab_version` bump in `fab/project/config.yaml`.

**Out of scope:**
- `rk context` (`app/backend/cmd/rk/context.go`) does not consume pane-map or runtime data; untouched.
- Daemon lifecycle, SSE hub, iframe/proxy features — all untouched.
- Direct `.fab-runtime.yaml` reads were removed in change `260313-3vlx-pane-map-enrichment` and are not reintroduced.

## Open Questions

- Should the dedup rule also consider a Process/PID axis in the future? The upstream refactor adds `pid` as a new runtime axis (for GC via `kill(pid, 0)`), but fab-kit doesn't surface it in pane-map JSON output today. Defer unless the schema grows a `pid` column.
- Is there value in consuming `tmux_pane` directly (e.g., via a future `fab pane map --by-pane-id` mode) to avoid the `session:window_index` join entirely? Defer — current join is correct for all current consumers.

## Clarifications

### Session 2026-04-19

| # | Action | Detail |
|---|--------|--------|
| 7 | Confirmed | Defer direct `tmux_pane` consumption; keep current join logic |
| 8 | Confirmed | Performance impact negligible; 5s pane-map cache absorbs fab-side churn |
| 4 | Confirmed | Extend dedup rule to prefer entries with populated `AgentState` |
| 5 | Confirmed | Frontend rendering changes are improvements, not regressions |
| 6 | Changed | Precondition met: fab-kit v1.5.0 shipped and `fab_version: 1.5.0` in `fab/project/config.yaml`; no longer blocked |

### Session 2026-04-19 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Changed | "fab-kit v1.5.0 shipped; run-kit config.yaml at 1.5.0 — unblocked" |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The `.fab-runtime.yaml` schema change is invisible to run-kit | Grep-verified: no direct reads in live code. Sole contract is `fab pane map --json` subprocess output. Direct reads were removed in `260313-3vlx-pane-map-enrichment` | S:95 R:90 A:95 D:95 |
| 2 | Certain | JSON field names in `fab pane map` output are unchanged | Task brief explicitly states "CLI columns unchanged in name; semantics expand". `paneMapEntry` struct at `sessions.go:25-35` remains valid | S:95 R:85 A:90 D:95 |
| 3 | Certain | No run-kit code treats `agent_state == null` as a proxy for "no change" | Code audit of all 3 consumers: `sessions.go:374-377` joins both independently; `status-panel.tsx:52,67,147-150` branches on each separately; `format.ts:24-38,52,66-70` branches on each separately | S:90 R:90 A:90 D:95 |
| 4 | Certain | Dedup rule should extend to prefer entries with populated `AgentState` when neither has `Change` | Clarified — user confirmed | S:95 R:80 A:70 D:85 |
| 5 | Certain | Frontend rendering changes in discussion mode are improvements, not regressions | Clarified — user confirmed | S:95 R:80 A:75 D:80 |
| 6 | Certain | Precondition met: fab-kit v1.5.0 has shipped the `_agents` schema refactor and run-kit's `fab_version` is at 1.5.0; change is unblocked and ready to proceed | Clarified — user confirmed after `fab upgrade-repo` to 1.5.0 | S:95 R:90 A:80 D:90 |
| 7 | Certain | `tmux_pane` property in `_agents` entries is not worth consuming directly in run-kit today | Clarified — user confirmed | S:95 R:65 A:55 D:60 |
| 8 | Certain | Performance impact from more `_agents` entries and mtime churn is negligible for run-kit | Clarified — user confirmed | S:95 R:70 A:60 D:65 |

8 assumptions (8 certain, 0 confident, 0 tentative, 0 unresolved).
