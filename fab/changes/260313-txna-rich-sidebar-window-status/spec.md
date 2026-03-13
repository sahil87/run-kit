# Spec: Rich Sidebar Window Status

**Change**: 260313-txna-rich-sidebar-window-status
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Session-level enrichment (session rows remain pure collapse/expand controls)
- Replacing the existing activity dot semantics (green/dim stays; `isActiveWindow` is additive)
- Real-time streaming of agent state (SSE polling at 2.5s interval is sufficient)

## Backend: tmux Format Extension

### Requirement: Fetch pane foreground command

The `ListWindows()` function in `internal/tmux/tmux.go` SHALL include `#{pane_current_command}` in the tmux format string. The parsed result SHALL populate a `PaneCommand` field on `WindowInfo`. No additional subprocess calls SHALL be introduced.

#### Scenario: Normal window with running process
- **GIVEN** a tmux window running `claude` as the foreground process
- **WHEN** `ListWindows()` is called
- **THEN** the returned `WindowInfo` has `PaneCommand` set to `"claude"`

#### Scenario: Window at shell prompt
- **GIVEN** a tmux window with `zsh` as the foreground process (idle at prompt)
- **WHEN** `ListWindows()` is called
- **THEN** the returned `WindowInfo` has `PaneCommand` set to `"zsh"`

### Requirement: Expose activity timestamp

The `WindowInfo` struct SHALL include an `ActivityTimestamp` field (`int64`, JSON key `activityTimestamp`) containing the raw Unix epoch from `#{window_activity}`. This is already parsed internally for the `activity` field computation but not currently exposed.

#### Scenario: Timestamp available in JSON response
- **GIVEN** a tmux window with last activity at Unix time 1710300000
- **WHEN** the SSE stream delivers window data
- **THEN** the JSON payload includes `"activityTimestamp": 1710300000`

## Backend: Agent Runtime State

### Requirement: Read `.fab-runtime.yaml` for agent idle state

A new `internal/fab/runtime.go` SHALL read `.fab-runtime.yaml` from the project root and resolve agent state per change. <!-- clarified: ReadRuntime is only called behind the existing hasFabKit() guard in FetchSessions, so it will never be invoked for non-fab projects. Rule #6 (nil for no .fab-status.yaml) is a defensive safety net. --> The function signature SHALL be:

```go
type RuntimeState struct {
    AgentState        string // "active", "idle", or "unknown"
    AgentIdleDuration string // "2m", "1h" — only populated when idle
}

func ReadRuntime(projectRoot string, changeName string) *RuntimeState
```

<!-- clarified: changeName is the full change folder name (e.g. "260313-txna-rich-sidebar-window-status") as returned by ReadState().Change, which is the key used in .fab-runtime.yaml. This matches the fab-kit runtime.SetIdle(fabRoot, folder) convention. -->

The function SHALL:
1. Read `.fab-runtime.yaml` from `projectRoot`
2. Navigate to `{changeName}.agent.idle_since` (Unix timestamp)
3. If `idle_since` exists: compute elapsed seconds, format as `Ns` (<60s), `Nm` (60s-3599s), `Nh` (>=3600s) using floor division. Return `AgentState: "idle"` with formatted `AgentIdleDuration`
4. If `idle_since` is absent or agent block missing: return `AgentState: "active"`
5. If the runtime file is missing: return `AgentState: "unknown"`
6. Return `nil` if the project has no fab state (no `.fab-status.yaml`)

#### Scenario: Agent actively working
- **GIVEN** a fab project with `.fab-runtime.yaml` that has no `idle_since` for the active change
- **WHEN** `ReadRuntime()` is called
- **THEN** it returns `RuntimeState{AgentState: "active", AgentIdleDuration: ""}`

#### Scenario: Agent idle for 5 minutes
- **GIVEN** a fab project with `.fab-runtime.yaml` where `idle_since` is 300 seconds ago
- **WHEN** `ReadRuntime()` is called
- **THEN** it returns `RuntimeState{AgentState: "idle", AgentIdleDuration: "5m"}`

#### Scenario: Runtime file missing
- **GIVEN** a fab project with no `.fab-runtime.yaml`
- **WHEN** `ReadRuntime()` is called
- **THEN** it returns `RuntimeState{AgentState: "unknown", AgentIdleDuration: ""}`

#### Scenario: Non-fab project
- **GIVEN** a tmux session whose project root has no `fab/project/config.yaml`
- **WHEN** session enrichment runs
- **THEN** `AgentState` and `AgentIdleDuration` are empty (omitted from JSON)

### Requirement: Cache runtime file per project root

Within a single `FetchSessions()` call, `.fab-runtime.yaml` SHALL be read at most once per unique project root. The runtime file content SHALL be cached and reused for all windows sharing that project root. <!-- clarified: the "panemap.go caching pattern" reference was inaccurate (no such file exists in fab-kit). The caching rationale stands on its own: avoid redundant file reads when multiple sessions share a project root. Implementation: a sync.Map or plain map guarded by the existing goroutine-per-session pattern. -->

#### Scenario: Two sessions with same project root
- **GIVEN** two tmux sessions both rooted at `/home/user/code/project`
- **WHEN** `FetchSessions()` runs
- **THEN** `.fab-runtime.yaml` is read exactly once for that project root

### Requirement: Extend WindowInfo struct

`tmux.WindowInfo` SHALL add four new fields:

```go
PaneCommand       string `json:"paneCommand,omitempty"`
AgentState        string `json:"agentState,omitempty"`
AgentIdleDuration string `json:"agentIdleDuration,omitempty"`
ActivityTimestamp int64  `json:"activityTimestamp"`
```

The `enrichSession()` function in `internal/sessions/sessions.go` SHALL populate `AgentState` and `AgentIdleDuration` from `ReadRuntime()` alongside existing `FabChange`/`FabStage` enrichment.

#### Scenario: Full enrichment for fab window
- **GIVEN** a fab-enabled session with an active change at stage "apply" and agent idle for 2 minutes
- **WHEN** `FetchSessions()` returns the session data
- **THEN** each `WindowInfo` includes `fabChange`, `fabStage: "apply"`, `agentState: "idle"`, `agentIdleDuration: "2m"`, `paneCommand`, and `activityTimestamp`

## Frontend: TypeScript Types

### Requirement: Extend WindowInfo type

The `WindowInfo` type in `src/types.ts` SHALL add:

```typescript
paneCommand?: string;
agentState?: string;
agentIdleDuration?: string;
activityTimestamp: number;
```

#### Scenario: Type-safe access to new fields
- **GIVEN** a `WindowInfo` object from the SSE stream
- **WHEN** code accesses `win.paneCommand` or `win.agentState`
- **THEN** TypeScript provides autocompletion and type checking without casts

## Frontend: Sidebar Window Row Enrichment

### Requirement: Activity dot encodes isActiveWindow

The activity dot on window rows SHALL render a `ring-1` outline when the window's `isActiveWindow` is `true`. The ring color SHOULD be `ring-accent-green` when the window is also active, or `ring-text-secondary/40` when idle. The dot's fill color (green=active, dim=idle) SHALL remain unchanged.

#### Scenario: Tmux-focused active window
- **GIVEN** a window that is both `isActiveWindow: true` and `activity: "active"`
- **WHEN** the sidebar renders the window row
- **THEN** the activity dot has a green fill AND a green ring outline

#### Scenario: Tmux-focused but idle window
- **GIVEN** a window with `isActiveWindow: true` and `activity: "idle"`
- **WHEN** the sidebar renders the window row
- **THEN** the activity dot has a dim fill AND a dim ring outline

#### Scenario: Non-focused window
- **GIVEN** a window with `isActiveWindow: false`
- **WHEN** the sidebar renders the window row
- **THEN** the activity dot has no ring (same as current behavior)

### Requirement: Duration display in sidebar

Each window row SHALL display a duration label right-aligned, after the fab stage text (or in its place for non-fab windows). The duration SHALL be shown only when the window is idle:

- **Fab windows with agent state**: show `agentIdleDuration` (e.g., `2m`, `1h`). When `agentState` is `"unknown"` (runtime file missing), fall back to computing from `activityTimestamp` like non-fab windows <!-- clarified: unknown agent state degrades gracefully to tmux-based duration -->
- **Non-fab windows**: compute relative time from `activityTimestamp` on the frontend (same Ns/Nm/Nh format)
- **Active windows** (either agent or tmux): duration omitted

Duration text SHALL use `text-xs text-text-secondary` styling.

#### Scenario: Fab window idle for 3 minutes
- **GIVEN** a fab window with `agentState: "idle"` and `agentIdleDuration: "3m"`
- **WHEN** the sidebar renders
- **THEN** the window row shows `3m` right-aligned after the fab stage badge

#### Scenario: Non-fab window idle for 1 hour
- **GIVEN** a non-fab window with `activity: "idle"` and `activityTimestamp` 3600 seconds ago
- **WHEN** the sidebar renders
- **THEN** the window row shows `1h` right-aligned

#### Scenario: Active window
- **GIVEN** a window with `activity: "active"` (and `agentState: "active"` if fab)
- **WHEN** the sidebar renders
- **THEN** no duration is shown

### Requirement: Info popover ("i" button)

Each window row SHALL include an info button that opens a popover with detailed window context:

- **Desktop**: the button appears on hover (`opacity-0 group-hover:opacity-100` transition)
- **Mobile**: the button is always visible as a small `ⓘ` character (`text-[10px]`)
- **Interaction**: tap-to-toggle popover on both platforms (no hover-open)

The popover SHALL display in a compact key-value layout:

| Label | Value |
|-------|-------|
| Change | `{4-char ID} · {slug}` (from `fabChange`, omitted for non-fab windows) |
| Process | `{paneCommand}` |
| Path | `{worktreePath}` |
| State | `{activity}` + `{agentState}` + `{duration}` |

Popover styling: `bg-bg-primary border border-border shadow-2xl rounded`, `text-xs`, labels in `text-text-secondary`, values in `text-text-primary`, tight `py-1 px-2` padding. Dismiss on outside click, Escape, or re-tap. 44px tap target for mobile (`coarse:min-h-[44px]`).

#### Scenario: Desktop hover reveals "i" button
- **GIVEN** a window row on desktop (pointer: fine)
- **WHEN** the user hovers over the row
- **THEN** the "i" button fades in
- **AND** clicking it opens the info popover

#### Scenario: Mobile "i" always visible
- **GIVEN** a window row on mobile (pointer: coarse)
- **WHEN** the sidebar renders
- **THEN** the "i" button is always visible as a small `ⓘ`

#### Scenario: Popover dismiss
- **GIVEN** an open info popover
- **WHEN** the user clicks outside, presses Escape, or re-taps the "i" button
- **THEN** the popover closes

#### Scenario: Non-fab window popover
- **GIVEN** a non-fab window
- **WHEN** the info popover opens
- **THEN** the "Change" row is omitted

## Frontend: Top Bar Line 2 Enrichment

### Requirement: Selected window detail in Line 2 right

The top bar Line 2 right side SHALL display enriched status for the currently selected window:

```
● {activity} · {paneCommand} · {duration} │ {fabStage badge} · {id} · {slug}  [⟷]
```

- The `│` separator and fab-specific fields (stage, id, slug) SHALL only appear when the window has `fabStage`
- The `{id}` and `{slug}` SHALL be extracted from `fabChange` (4-char ID prefix and slug suffix of the folder name) <!-- clarified: fabChange is the full folder name like "260313-txna-rich-sidebar-window-status"; id = chars 8-11 (the 4-char code after date+dash), slug = everything after the second dash -->
- The `{paneCommand}` SHALL be omitted if empty/undefined
- The `{duration}` SHALL follow the same source logic as sidebar: `agentIdleDuration` for fab windows with known agent state, `activityTimestamp`-derived for non-fab or unknown agent state, omitted when active <!-- clarified: top bar duration source mirrors sidebar duration requirement -->
- On mobile (`< 640px`), the enriched status SHALL collapse per existing Line 2 mobile behavior (`hidden sm:flex`)
- The fixed-width toggle button SHALL remain in its current position (rightmost)

#### Scenario: Full status for fab window
- **GIVEN** the selected window has `activity: "active"`, `paneCommand: "claude"`, `fabStage: "apply"`, `fabChange: "260313-txna-rich-sidebar-window-status"`
- **WHEN** the top bar renders Line 2
- **THEN** the right side shows: `● active · claude │ apply · txna · rich-sidebar-window-status [⟷]`

#### Scenario: Non-fab window status
- **GIVEN** the selected window has `activity: "idle"`, `paneCommand: "zsh"`, no `fabStage`, `activityTimestamp` 120 seconds ago
- **WHEN** the top bar renders Line 2
- **THEN** the right side shows: `● idle · zsh · 2m [⟷]`

#### Scenario: Mobile collapse
- **GIVEN** viewport width < 640px
- **WHEN** the top bar renders Line 2
- **THEN** the enriched status items are hidden (only the `⋯` palette trigger and fixed-width toggle remain)

## Design Decisions

1. **Extend existing backend data path over shelling out to `fab pane-map`**: The Go backend already queries `tmux list-windows` and reads `.fab-status.yaml` per session on every 2.5s SSE tick. Adding `pane_current_command` (one more format variable) and `.fab-runtime.yaml` (one more file read) to this existing path avoids process spawn overhead (~30-60ms per tick) and output parsing.
   - *Why*: Performance and simplicity — zero new subprocesses, piggybacks on existing work.
   - *Rejected*: Calling `fab pane-map` as subprocess every tick — adds fork+exec overhead, requires parsing CLI output, and pane-map doesn't even fetch `pane_current_command` today.

2. **Ring outline for `isActiveWindow` (not pulse or size change)**: A `ring-1` CSS outline is visually distinct without changing the dot's size or color semantics, and follows the existing `ring-` pattern used for keyboard focus states.
   - *Why*: Pure CSS, no animation overhead, consistent with existing patterns.
   - *Rejected*: Pulse animation (distracting with multiple windows), larger dot (too subtle), different color (conflicts with active/idle semantics).

3. **Compact key-value info popover (not menu-style dropdown)**: The info popover is a read-only context display, not an action menu. Using a key-value layout with label/value styling distinguishes it from the breadcrumb dropdowns.
   - *Why*: Prevents user confusion (info card vs clickable menu).
   - *Rejected*: Exact dropdown menu treatment (misleading — looks clickable).

4. **4-char ID + slug for fab change display (not full folder name or slug-only)**: The ID is what users type in commands (`/fab-switch txna`), building recognition. The date prefix adds no value in a live dashboard. Slug-only loses the command-linkage.
   - *Why*: Optimal balance of brevity and utility.
   - *Rejected*: Full folder name (too long), slug-only (loses ID linkage), ID-only (too terse).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend existing Go backend rather than shelling out to `fab pane-map` | Confirmed from intake #1 — user confirmed after evaluating cost | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session rows stay pure — no enrichment | Confirmed from intake #2 — user explicitly decided | S:95 R:90 A:90 D:95 |
| 3 | Certain | "i" popover is tap-to-toggle on mobile | Confirmed from intake #3 | S:95 R:85 A:85 D:90 |
| 4 | Certain | Top bar Line 2 right shows same info as "i" popover for selected window | Confirmed from intake #4 | S:90 R:85 A:85 D:90 |
| 5 | Confident | Cache `.fab-runtime.yaml` per project root within a single FetchSessions call | Avoids redundant file reads when multiple sessions share a project root; easily changed if needed | S:70 R:90 A:85 D:85 |
| 6 | Confident | Expose raw `activityTimestamp` for frontend duration computation on non-fab windows | Frontend needs timestamp for relative time display; alternative is backend-computed duration | S:65 R:90 A:80 D:75 |
| 7 | Confident | Duration format matches pane-map convention: Ns/Nm/Nh floor division | Consistent with fab-kit convention | S:75 R:90 A:90 D:85 |
| 8 | Certain | "i" button: hover-only on desktop, persistent small ⓘ on mobile | Clarified from intake #8 — user confirmed | S:95 R:90 A:60 D:55 |
| 9 | Certain | Fab change displayed as 4-char ID + slug in top bar and popover | Clarified from intake #9 — user confirmed | S:95 R:95 A:65 D:55 |
| 10 | Certain | Info popover uses compact key-value layout (not menu-style) | Clarified from intake #10 — user confirmed | S:95 R:90 A:70 D:60 |
| 11 | Confident | `ReadRuntime()` returns nil for non-fab projects (no enrichment) | Follows existing pattern — `ReadState()` returns nil, enrichment skipped | S:70 R:95 A:90 D:90 |
| 12 | Certain | `parseWindows()` expects 6 fields (was 5) after adding pane_current_command | Deterministic — tmux format string defines field count | S:95 R:85 A:95 D:95 |
| 13 | Confident | Info popover positioned below the "i" button (not tooltip-style above) | Below is more natural for sidebar items; consistent with dropdown positioning | S:60 R:95 A:75 D:65 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).
