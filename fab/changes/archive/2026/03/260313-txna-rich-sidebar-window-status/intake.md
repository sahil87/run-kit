# Intake: Rich Sidebar Window Status

**Change**: 260313-txna-rich-sidebar-window-status
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Enrich sidebar window rows and top bar with richer session/window state information. Currently the sidebar only shows: activity dot (green/dim) + window name + fabStage text (right-aligned, optional). Several fields are fetched but unused (fabChange, isActiveWindow, worktreePath). There's no agent state or activity duration information.

Conversational origin — extended `/fab-discuss` session exploring what information users need at a glance when managing multiple agent windows. Evaluated four options (A: fab change info, B: activity duration, C: process/command awareness, D: composite status line) and refined into a layered design: compact inline signals + progressive disclosure via "i" popover + full detail in top bar.

Key decisions from the discussion:
- **Extend existing Go backend** rather than shelling out to `fab pane-map` — the backend already calls `tmux list-windows` and reads `.fab-status.yaml` per session every SSE tick; adding fields to these existing paths avoids process spawn overhead
- **"i" popover for dense info** (fab change name, process command, worktree path) rather than inlining Option A directly in the sidebar (too wide)
- **Duration shown directly** in sidebar (Option B) — most actionable at-a-glance signal
- **Top bar Line 2 right side** shows the same detail as the "i" popover, spelled out for the selected window
- **Session rows stay pure** — no enrichment, collapse/expand only
- **Tap-to-toggle popover** for mobile (hover doesn't exist on touch)

## Why

1. **The problem**: Users managing multiple agent sessions (the core run-kit use case) can't tell at a glance which windows need attention, which agents are actively working, how long something has been idle, or what fab change a window is working on. The sidebar's current binary active/idle dot and optional stage text are insufficient for orchestration.

2. **What happens without this**: Users must click into each window to check its state, or mentally track which agents are doing what. This defeats the purpose of a multi-agent orchestration dashboard.

3. **Why this approach**: Layered information density — 4 compact signals inline (dot, name, stage, duration) for scanning, progressive disclosure via "i" popover for details, and the top bar for the currently selected window's full context. This avoids cluttering the sidebar while making all information accessible.

## What Changes

### Backend: Extend `tmux.ListWindows()` with `pane_current_command`

Add `#{pane_current_command}` to the existing tmux format string in `app/backend/internal/tmux/tmux.go:151-157`. This returns the foreground process name (e.g., `claude`, `zsh`, `vim`, `go`) for each window. Zero additional subprocess calls — it's just one more field in the same `tmux list-windows -F` query.

Current format:
```go
format := strings.Join([]string{
    "#{window_index}",
    "#{window_name}",
    "#{pane_current_path}",
    "#{window_activity}",
    "#{window_active}",
}, listDelim)
```

Add `#{pane_current_command}` as the 6th field. Update `parseWindows()` to expect 6 fields and populate the new `PaneCommand` struct field.

### Backend: Add `.fab-runtime.yaml` reading in `enrichSession()`

Port the agent state resolution logic from fab-kit's `panemap.go` (specifically the `resolveAgentState` function at lines 271-348 and `formatIdleDuration` at lines 370-378) into a new file `app/backend/internal/fab/runtime.go`.

The logic:
1. Read `.fab-runtime.yaml` from the project root (same location as `.fab-status.yaml`)
2. Look up the active change's folder name in the YAML structure
3. Navigate to `{folderName}.agent.idle_since` — a Unix timestamp
4. If `idle_since` exists: compute elapsed duration, format as `Ns`/`Nm`/`Nh` (floor division), return `idle` state + duration string
5. If `idle_since` is absent or the agent block is missing: return `active` state
6. If the runtime file is missing entirely: return `unknown` state (displayed as `?` in pane-map)

Cache the runtime file per project root within a single `FetchSessions()` call to avoid re-reading for sessions that share a worktree.

Update `enrichSession()` in `app/backend/internal/sessions/sessions.go` to call this new runtime reader alongside the existing `fab.ReadState()` call.

### Backend: Extend `WindowInfo` struct and JSON

Add three new fields to `tmux.WindowInfo`:
```go
type WindowInfo struct {
    // existing fields...
    PaneCommand       string `json:"paneCommand,omitempty"`
    AgentState        string `json:"agentState,omitempty"`        // "active", "idle", or "unknown"
    AgentIdleDuration string `json:"agentIdleDuration,omitempty"` // "2m", "1h" — only when idle
}
```

Also expose the raw `window_activity` timestamp so the frontend can compute relative durations for non-fab windows:
```go
    ActivityTimestamp int64  `json:"activityTimestamp"`  // Unix epoch from tmux window_activity
```

### Frontend: Extend TypeScript types

```typescript
type WindowInfo = {
    // existing
    index: number;
    name: string;
    worktreePath: string;
    activity: "active" | "idle";
    isActiveWindow: boolean;
    fabChange?: string;
    fabStage?: string;
    // new
    paneCommand?: string;
    agentState?: string;          // "active" | "idle" | "unknown"
    agentIdleDuration?: string;   // "2m", "1h"
    activityTimestamp: number;    // Unix epoch
};
```

### Frontend: Sidebar window row enrichment

Each window row in `sidebar.tsx` (currently lines 124-154) gains:

1. **Activity dot enhancement** — encode `isActiveWindow` with a `ring-1 ring-accent-green` (or `ring-text-primary`) around the existing dot, distinguishing "this is the window tmux has selected" from "this had recent activity". Pure CSS, no animation. <!-- clarified: ring/outline chosen over pulse, size change, or color change -->

2. **Duration display** (right-aligned, after fab stage or in its place for non-fab windows):
   - For fab windows with agent state: show `agentIdleDuration` when idle (e.g., `2m`), omit when active
   - For non-fab windows: compute relative time from `activityTimestamp` on the frontend side, show when idle
   - Duration uses `text-xs text-text-secondary` styling, same as current fabStage

3. **"i" info button** — hover-only on desktop, persistent small `ⓘ` character (`text-[10px]`) on mobile. Click/tap opens a popover with: <!-- clarified: hover desktop, persistent mobile -->
   - **Fab change name**: full folder name (e.g., `260313-txna-rich-sidebar-window-status`)
   - **Process**: foreground command name from `paneCommand` (e.g., `claude`, `zsh`)
   - **Worktree path**: from `worktreePath`
   - **Activity details**: state + duration + `isActiveWindow` label

   Popover styled with `bg-bg-primary border border-border shadow-2xl rounded` (same base as dropdowns) but with a **compact key-value layout**: `text-xs`, label in `text-text-secondary`, value in `text-text-primary`, tight `py-1 px-2` padding. Visually distinct from action menus (read-only info card). Dismiss on outside click, Escape, or re-tap. 44px tap target for mobile (`coarse:min-h-[44px]`). <!-- clarified: info card layout, not menu list -->

### Frontend: Top bar Line 2 right side enrichment

Currently `top-bar.tsx:177-196` shows `● active/idle` text + fab stage badge + fixed-width toggle.

Expand for the selected window to show:
```
● active · claude · 2m │ apply · auth-refactor   [⟷]
```

Layout: `{activity dot} {activity text} · {paneCommand} · {duration} │ {fabStage badge} · {fabChange short name} {fixedWidthToggle}`

- The `│` separator only appears when fab info is present
- `fabChange` shows as 4-char ID + slug (e.g., `txna · rich-sidebar-window-status`) — not the full dated folder name, not slug-only <!-- clarified: ID + slug format for top bar -->
- All items use existing `text-xs text-text-secondary` styling
- On mobile (`< 640px`), the detailed status collapses — same pattern as existing Line 2 mobile behavior

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add sidebar enrichment patterns (info popover, duration display, dot encoding) and updated Line 2 right side layout
- `run-kit/architecture`: (modify) Add `.fab-runtime.yaml` reading to backend data flow

## Impact

- **Backend**: `internal/tmux/tmux.go` (format string + parsing), new `internal/fab/runtime.go`, `internal/sessions/sessions.go` (enrichment call)
- **Frontend**: `src/types.ts`, `src/components/sidebar.tsx`, `src/components/top-bar.tsx`, new popover component or inline in sidebar
- **API surface**: `GET /api/sessions` and SSE stream gain new fields (additive, backward compatible)
- **SSE payload size**: Slightly larger per tick — 3 new string fields per window (~50-100 bytes)
- **Tests**: Backend tests for runtime YAML parsing, tmux format parsing with 6th field; frontend tests for sidebar popover, duration display, top bar layout

## Open Questions

None — all resolved via clarification session.

## Clarifications

### Session 2026-03-13

| # | Action | Detail |
|---|--------|--------|
| 8 | Changed | "i" button: hover-only desktop, persistent small `ⓘ` on mobile (was: hover desktop + persistent icon mobile — refined visibility model) |
| OQ1 | Resolved | "i" visibility on mobile → always visible (persistent), resolved from open question |
| OQ2 | Resolved | `isActiveWindow` dot treatment → `ring-1` outline, resolved from open question |
| 9 | Changed | Fab change display: 4-char ID + slug (was: slug-only) |
| 10 | Changed | Info popover: compact key-value layout (was: same as dropdown menus) |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend existing Go backend rather than shelling out to `fab pane-map` | Discussed — user confirmed after evaluating cost (backend already has tmux + fab data path) | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session rows stay pure — no enrichment | Discussed — user explicitly decided | S:95 R:90 A:90 D:95 |
| 3 | Certain | "i" popover is tap-to-toggle on mobile | Discussed — user confirmed | S:95 R:85 A:85 D:90 |
| 4 | Certain | Top bar Line 2 right shows same info as "i" popover for selected window | Discussed — user proposed this design | S:90 R:85 A:85 D:90 |
| 5 | Confident | Cache `.fab-runtime.yaml` per project root within a single FetchSessions call | Strong pattern from pane-map implementation; easily changed | S:70 R:90 A:85 D:85 |
| 6 | Confident | Expose raw `activityTimestamp` for frontend duration computation on non-fab windows | Logical extension — frontend needs this for non-fab duration display; alternative is backend-computed duration for all | S:65 R:90 A:80 D:75 |
| 7 | Confident | Duration format matches pane-map convention: Ns/Nm/Nh floor division | Consistent with existing fab-kit convention; no reason to deviate | S:75 R:90 A:90 D:85 |
| 8 | Certain | "i" button: hover-only on desktop, persistent small `ⓘ` on mobile | Clarified — user confirmed recommendation (mobile has no hover; persistent but subtle) | S:95 R:90 A:60 D:55 |
| 9 | Certain | Fab change displayed as 4-char ID + slug in top bar (e.g., `txna · rich-sidebar-window-status`) | Clarified — user confirmed recommendation (ID builds command recognition, date adds no value in live context) | S:95 R:95 A:65 D:55 |
| 10 | Certain | Info popover uses same base styling as dropdowns but with compact key-value layout (label in text-secondary, value in text-primary, tight padding) — visually distinct from action menus | Clarified — user confirmed recommendation (read-only info card vs clickable menu distinction) | S:95 R:90 A:70 D:60 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
