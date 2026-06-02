# Plan: Pane CWD Tracking and Sidebar Hover Info

**Change**: 260405-rx38-pane-cwd-tracking
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Requirements

<!-- migrated from spec.md on 2026-06-02 -->

## Non-Goals

- OSC 7 / shell hook integration for real-time CWD tracking — 2.5s SSE poll is sufficient for this use case
- Per-pane terminal relay or pane-switching UI — pane data stored for future use only
- Always-visible CWD display in sidebar — hover-only keeps sidebar compact

## Backend: PaneInfo Struct and Parsing

### Requirement: PaneInfo type
`tmux.go` SHALL define a `PaneInfo` struct:
```go
type PaneInfo struct {
    PaneID    string `json:"paneId"`
    PaneIndex int    `json:"paneIndex"`
    Cwd       string `json:"cwd"`
    Command   string `json:"command"`
    IsActive  bool   `json:"isActive"`
}
```
Sourced from tmux format variables: `#{pane_id}`, `#{pane_index}`, `#{pane_current_path}`, `#{pane_current_command}`, `#{pane_active}`.

#### Scenario: PaneInfo fields
- **GIVEN** a tmux pane with ID `%8`, index `1`, cwd `/home/user/code`, command `zsh`, active=`false`
- **WHEN** the pane is parsed from `list-panes` output
- **THEN** a `PaneInfo` is produced: `{PaneID: "%8", PaneIndex: 1, Cwd: "/home/user/code", Command: "zsh", IsActive: false}`

### Requirement: parsePanes function
A `parsePanes(lines []string) map[int][]PaneInfo` function SHALL be accessible to same-package tests. It parses tab-delimited `list-panes` output lines and returns a window-index→panes map. Lines have 6 fields (window_index as field 0, pane fields 1–5); malformed lines with fewer than 6 fields are skipped silently. Empty input or all-malformed input returns `nil`. <!-- clarified: field count updated from 5 to 6 to match the #{window_index} prefix required for window grouping; return type updated from []PaneInfo to map[int][]PaneInfo — single-pass grouping, flat slice was unused in all production callers -->

#### Scenario: Standard parse
- **GIVEN** lines from `tmux list-panes -s -t alpha -F "#{window_index}\t#{pane_id}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_active}"`
- **WHEN** `parsePanes` is called with those lines
- **THEN** one `PaneInfo` per line is returned with correct field values (window_index field consumed internally for grouping, not stored in `PaneInfo`)

#### Scenario: Malformed lines skipped
- **GIVEN** a line with fewer than 6 tab-delimited fields
- **WHEN** `parsePanes` is called
- **THEN** the malformed line is silently skipped

#### Scenario: Empty input
- **GIVEN** nil or empty `lines`
- **WHEN** `parsePanes` is called
- **THEN** `nil` is returned

### Requirement: WindowInfo gains Panes field
`WindowInfo` SHALL gain a `Panes []PaneInfo` field with JSON tag `json:"panes,omitempty"`. The existing `WorktreePath` field is retained unchanged for backward compatibility (remains populated from the `#{pane_current_path}` of the active pane as returned by `list-windows`).

#### Scenario: WindowInfo serializes panes
- **GIVEN** a `WindowInfo` with `Panes` containing two `PaneInfo` entries
- **WHEN** the struct is serialized to JSON
- **THEN** the JSON contains a `"panes"` array with two objects each having `paneId`, `paneIndex`, `cwd`, `command`, `isActive` keys

## Backend: ListWindows Pane Population

### Requirement: ListWindows populates Panes
`ListWindows` SHALL call `tmuxExecServer` with `list-panes -s -t <session>` after `list-windows` to fetch all panes for the session. Pane lines are parsed via `parsePanes`, then grouped by **window index**. <!-- clarified: #{window_index} must be included in the list-panes format string for grouping; resolved inline by the format string definition below -->

`ListWindows` SHALL include `#{window_index}` in the `list-panes` format string, and group panes by window index to populate `Panes` on the matching `WindowInfo` entry.

The `list-panes` format string SHALL be: `#{window_index}\t#{pane_id}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_active}`

`parsePanes` format SHALL be updated to expect 6 fields (window_index as field 0, pane fields as fields 1–5).

#### Scenario: Panes grouped by window
- **GIVEN** a session "alpha" with window index 0 (2 panes: `%0`, `%1`) and window index 1 (1 pane: `%2`)
- **WHEN** `ListWindows(ctx, "alpha", server)` is called
- **THEN** the returned `WindowInfo` for index 0 has `Panes` with 2 entries (`%0`, `%1`), and index 1 has 1 entry (`%2`)

#### Scenario: list-panes failure is non-fatal
- **GIVEN** `list-panes` returns an error (e.g., session disappeared mid-tick)
- **WHEN** `ListWindows` encounters the error
- **THEN** `ListWindows` returns the windows without pane data (empty `Panes` fields), not an error
- **AND** `WorktreePath` remains correctly populated from `list-windows`

#### Scenario: Window with no matching panes
- **GIVEN** `list-panes` returns no panes for a given window index
- **WHEN** the result is assembled
- **THEN** `Panes` for that window is nil or empty

### Requirement: WorktreePath unchanged
`WorktreePath` on `WindowInfo` SHALL continue to be populated from `#{pane_current_path}` in the `list-windows` format (active pane CWD as returned by tmux). The `list-panes` call adds the `Panes` array; it does NOT replace the `WorktreePath` source.

#### Scenario: WorktreePath backward compat
- **GIVEN** no consumers of `WorktreePath` are modified
- **WHEN** `ListWindows` is called
- **THEN** `WorktreePath` retains its value from `list-windows #{pane_current_path}` (identical to the active pane's CWD in the panes array)

## Frontend: Type System

### Requirement: PaneInfo frontend type
`app/frontend/src/types.ts` SHALL add a `PaneInfo` type:
```ts
export type PaneInfo = {
  paneId: string;
  paneIndex: number;
  cwd: string;
  command: string;
  isActive: boolean;
};
```

#### Scenario: PaneInfo type is importable
- **GIVEN** a component needing pane data
- **WHEN** it imports `PaneInfo` from `@/types`
- **THEN** the import compiles with no type errors

### Requirement: WindowInfo gains panes field
`WindowInfo` in `types.ts` SHALL gain `panes?: PaneInfo[]` as an optional field (optional to maintain backward compat with existing test fixtures that don't include it).

#### Scenario: WindowInfo with panes
- **GIVEN** SSE data including a `panes` array on a window object
- **WHEN** the JSON is deserialized as `WindowInfo`
- **THEN** `window.panes` is typed as `PaneInfo[] | undefined`

#### Scenario: WindowInfo without panes (legacy)
- **GIVEN** SSE data where `panes` is absent on a window object
- **WHEN** the JSON is deserialized as `WindowInfo`
- **THEN** `window.panes` is `undefined` without type error

## Frontend: Zustand Store

### Requirement: WindowEntry stores panes
`WindowEntry` in `app/frontend/src/store/window-store.ts` SHALL gain `panes: PaneInfo[]` (defaulting to `[]` when absent from incoming `WindowInfo`).

#### Scenario: panes synced from SSE
- **GIVEN** `setWindowsForSession` receives a `WindowInfo` array where one window has `panes: [{paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true}]`
- **WHEN** `setWindowsForSession` is called
- **THEN** the `WindowEntry` for that window has `panes` equal to the incoming array

#### Scenario: panes absent from incoming WindowInfo
- **GIVEN** `setWindowsForSession` receives a `WindowInfo` where `panes` is `undefined`
- **WHEN** the store is updated
- **THEN** the `WindowEntry.panes` is set to `[]`

#### Scenario: panes updated on re-sync
- **GIVEN** a window entry already in the store with pane data
- **WHEN** a new SSE tick arrives with updated pane data (e.g., new CWD)
- **THEN** `WindowEntry.panes` is replaced with the fresh pane data

### Requirement: MergedWindow exposes panes
`MergedWindow` (the `WindowInfo & { optimistic?, optimisticId? }` intersection type) SHALL automatically include `panes?: PaneInfo[]` via the `WindowInfo` extension. No separate change required to `MergedWindow`.

#### Scenario: MergedWindow type check
- **GIVEN** a `MergedWindow` value
- **WHEN** `mergedWindow.panes` is accessed
- **THEN** TypeScript resolves the type as `PaneInfo[] | undefined`

## Sidebar: Window Row Hover Tooltip

### Requirement: Hover tooltip on window rows
Each window row in the sidebar SHALL display a hover tooltip revealing pane metadata. The tooltip is implemented as an absolutely-positioned `div` inside the existing `relative group` wrapper of `window-row.tsx`, revealed via `group-hover:opacity-100` and hidden by `opacity-0`. The same `group-hover` reveal pattern used by the kill button SHALL be applied.

<!-- clarified: tooltip positioned to the right using `left-full` with `ml-1` margin, floating outside the sidebar boundary via absolute positioning; avoids sidebar edge clipping and does not obscure window name text -->

#### Scenario: Tooltip appears on hover
- **GIVEN** a window row in the sidebar with pane data available
- **WHEN** the user hovers over the window row
- **THEN** a tooltip appears showing `cwd`, `win`, and `panes` key-value entries

#### Scenario: Tooltip hidden at rest
- **GIVEN** a window row not being hovered
- **WHEN** rendered in the sidebar
- **THEN** the tooltip div is `opacity-0` and not visible

### Requirement: Tooltip content
The tooltip SHALL display the following key-value rows:
- `cwd` — active pane's CWD: `panes?.find(p => p.isActive)?.cwd ?? worktreePath`
  <!-- clarified: fallback to worktreePath when panes absent or no active pane found; the expression `panes?.find(p => p.isActive)?.cwd ?? worktreePath` in the requirement already encodes this -->
- `win` — window index and window ID, e.g., `3 (@5)`
- `panes` — comma-separated list of pane IDs with index, e.g., `%8 (0), %9 (1)*` where `*` marks the active pane

#### Scenario: Tooltip shows active pane CWD
- **GIVEN** a window with panes `[{paneId: "%5", isActive: true, cwd: "/home/user/code/run-kit"}, {paneId: "%6", isActive: false, cwd: "/home/user"}]`
- **WHEN** the tooltip is rendered
- **THEN** `cwd:` shows `/home/user/code/run-kit`

#### Scenario: Tooltip shows pane list
- **GIVEN** a window with the above pane array
- **WHEN** the tooltip is rendered
- **THEN** `panes:` shows `%5 (0)*, %6 (1)`

#### Scenario: Tooltip with no pane data
- **GIVEN** a window where `panes` is `undefined` or empty
- **WHEN** the tooltip is rendered
- **THEN** `cwd:` falls back to `worktreePath`, `panes:` shows `—`

### Requirement: Tooltip does not clip sidebar edge
The tooltip SHALL be positioned so it does not clip against the left or right edge of the sidebar. The tooltip is positioned below the window row, within sidebar bounds, and MUST NOT overlap or obscure the window name text.
<!-- clarified: tooltip positioned below the row using `top-full left-0 mt-0.5 w-full` absolute positioning; stays within sidebar width, using whitespace-normal break-words to handle long paths -->

#### Scenario: Tooltip positioning
- **GIVEN** a window row near the bottom of the sidebar
- **WHEN** the tooltip appears
- **THEN** tooltip content remains fully readable without being clipped by the sidebar container

## Design Decisions

1. **`list-panes` format includes `#{window_index}`**: Required to group panes back to their window without a separate `list-windows` cross-reference. Alternative (calling `list-panes -t session:N` per window) was rejected as N+1 subprocess spawning per tick.
   - *Why*: Single `list-panes -s -t <session>` call returns all panes with window index, enabling O(N) grouping.
   - *Rejected*: Per-window `list-panes` call adds N extra subprocesses per SSE tick.

2. **`list-panes` failure is non-fatal**: If the session disappears between the `list-windows` call and the `list-panes` call, `Panes` is simply empty. Returning an error here would break the entire SSE tick for a transient race.
   - *Why*: Pane data is supplementary; window enumeration must not fail due to pane data unavailability.
   - *Rejected*: Treating `list-panes` errors as fatal would introduce SSE interruptions for minor races.

3. **`panes` optional in frontend `WindowInfo`**: Existing test fixtures omit panes; making it required would break all existing tests requiring mass fixture updates.
   - *Why*: TypeScript optional field gives type safety without forcing fixture churn.
   - *Rejected*: Required field would break `sidebar.test.tsx` and all other test files that construct `WindowInfo` objects.

## Tasks

## Phase 1: Setup

<!-- No scaffolding required — all files already exist. -->

- [x] T001 [P] Add `PaneInfo` struct to `app/backend/internal/tmux/tmux.go` (after `WindowInfo`) and add `Panes []PaneInfo` field to `WindowInfo` struct
- [x] T002 [P] Add `PaneInfo` type and `panes?: PaneInfo[]` field to `app/frontend/src/types.ts`

## Phase 2: Core Implementation

- [x] T003 Add `parsePanes(lines []string) map[int][]PaneInfo` function to `app/backend/internal/tmux/tmux.go` — parses 6-field tab-delimited list-panes output (field 0 = window_index for grouping, fields 1–5 = paneId, paneIndex, cwd, command, isActive); returns window-index→panes map only (flat slice removed — was discarded in all production callers) <!-- rework: dropped unused []PaneInfo first return value per outward review should-fix; tests updated to verify via map -->
- [x] T004 Update `ListWindows` in `app/backend/internal/tmux/tmux.go` to call `list-panes -s -t <session>` after `list-windows`, parse with `parsePanes`, and populate `Panes` on each `WindowInfo` (non-fatal if `list-panes` errors)
- [x] T005 Add `panes: PaneInfo[]` to `WindowEntry` type in `app/frontend/src/store/window-store.ts` and update `setWindowsForSession` to sync `panes` from incoming `WindowInfo` (default to `[]` when absent)
- [x] T006 [P] Add hover tooltip div to `app/frontend/src/components/sidebar/window-row.tsx` — absolutely-positioned inside `relative group` wrapper, revealed via `opacity-0 group-hover:opacity-100`, positioned `top-full left-0 mt-0.5 w-full z-30` (below row, within sidebar bounds), showing `cwd`, `win`, and `panes` key-value rows with fallback behavior per spec <!-- rework: left-full clipped by overflow-hidden ancestor in app.tsx; changed to top-full left-0 to stay within sidebar horizontal bounds -->

## Phase 3: Tests

- [x] T007 Add `parsePanes` unit tests to `app/backend/internal/tmux/tmux_test.go` — cover standard parse (6-field lines), malformed lines skipped, empty input returns nil, active pane flag, window grouping map
- [x] T008 Add `setWindowsForSession` pane sync test to `app/frontend/src/store/window-store.test.ts` (create file if absent, or add to existing) — cover panes synced from WindowInfo, panes absent defaults to `[]`, panes updated on re-sync
- [x] T009 [P] Add `WindowRow` tooltip render tests to `app/frontend/src/components/sidebar/window-row.test.tsx` (create if absent) — cover tooltip hidden at rest (opacity-0), shows cwd from active pane, shows fallback worktreePath when no panes, shows pane list with `*` for active pane, ghost window has no tooltip <!-- rework: update for new top-full positioning and add ghost window suppression test -->

## Phase 4: Verification

- [x] T010 Run `cd app/backend && go test ./...` — all Go tests pass
- [x] T011 Run `cd app/frontend && npx tsc --noEmit` — no TypeScript errors
- [x] T012 Run `just test` — backend + frontend + e2e tests pass

---

## Execution Order

- T001 blocks T003, T004 (need PaneInfo struct before parsePanes and ListWindows can reference it)
- T002 blocks T005, T006 (need PaneInfo type before store and tooltip can use it)
- T003 blocks T004 (parsePanes must exist before ListWindows calls it)
- T004 blocks T010 (Go implementation must be done before backend tests run)
- T005 blocks T008 (store change must exist before store test can be added)
- T006 blocks T009 (tooltip must exist before tooltip tests can be added)
- T007, T008, T009 can run in parallel after their prerequisites
- T010, T011, T012 run sequentially in Phase 4 (verification gates)

---

## Clarifications

### Session 2026-04-06 (auto)

| # | Item | Action | Detail |
|---|------|--------|--------|
| T003 | parsePanes signature vs spec | Resolved | Spec defines `[]PaneInfo` return; tasks extend to `([]PaneInfo, map[int][]PaneInfo)` for single-pass efficiency in ListWindows. Both are consistent — the map is an implementation convenience, not a contract change. |

## Acceptance

## Functional Completeness

- [x] CHK-001 PaneInfo struct: `tmux.go` defines `PaneInfo` with fields `PaneID`, `PaneIndex`, `Cwd`, `Command`, `IsActive` and correct JSON tags (`paneId`, `paneIndex`, `cwd`, `command`, `isActive`)
- [x] CHK-002 WindowInfo.Panes field: `WindowInfo` in `tmux.go` has `Panes []PaneInfo` with `json:"panes,omitempty"`
- [x] CHK-003 parsePanes function: unexported `parsePanes` helper exists, parses 6-field tab-delimited lines, returns `nil` for empty input, skips malformed (<6 fields) lines silently
- [x] CHK-004 ListWindows pane population: `ListWindows` calls `list-panes -s -t <session>` with the 6-field format string and populates `Panes` on each `WindowInfo` grouped by window index
- [x] CHK-005 WorktreePath unchanged: `WorktreePath` still populated from `list-windows #{pane_current_path}` — not derived from `list-panes`
- [x] CHK-006 Frontend PaneInfo type: `types.ts` exports `PaneInfo` type with `paneId`, `paneIndex`, `cwd`, `command`, `isActive` fields
- [x] CHK-007 WindowInfo.panes optional field: `WindowInfo` in `types.ts` has `panes?: PaneInfo[]` — optional, not required
- [x] CHK-008 WindowEntry.panes: `window-store.ts` `WindowEntry` has `panes: PaneInfo[]` field
- [x] CHK-009 setWindowsForSession syncs panes: pane data from incoming `WindowInfo.panes` copied to `WindowEntry.panes`; absent/undefined panes defaults to `[]`
- [x] CHK-010 Sidebar tooltip rendered: `window-row.tsx` includes absolutely-positioned tooltip div inside `relative group` wrapper
- [x] CHK-011 Tooltip reveal pattern: tooltip uses `opacity-0 group-hover:opacity-100` (same as kill button)
- [x] CHK-012 Tooltip positioning: tooltip uses `top-full left-0 mt-0.5 w-full z-30` Tailwind classes (below row, within sidebar bounds)
- [x] CHK-013 Tooltip content fields: tooltip shows `cwd`, `win` (index + windowId), and `panes` (comma-separated IDs with index, `*` for active)
- [x] CHK-014 Tooltip CWD fallback: when `panes` is absent/empty, `cwd` row falls back to `worktreePath`
- [x] CHK-015 Tooltip panes fallback: when `panes` is absent/empty, `panes` row shows `—`

## Behavioral Correctness

- [x] CHK-016 list-panes failure non-fatal: when `list-panes` errors (e.g., session disappears), `ListWindows` returns windows with empty `Panes` fields — not an error
- [x] CHK-017 panes updated on re-sync: each SSE tick replaces `WindowEntry.panes` with fresh data (no stale pane data accumulates)

## Scenario Coverage

- [x] CHK-018 Panes grouped by window: Go test verifies window index 0 gets panes %0,%1 and window index 1 gets pane %2 when list-panes output contains both windows
- [x] CHK-019 setWindowsForSession panes test: TS test verifies `panes` synced from `WindowInfo`, absent panes defaults to `[]`, re-sync replaces panes
- [x] CHK-020 Tooltip shows active pane CWD: test verifies `cwd:` shows the cwd of the pane where `isActive: true`
- [x] CHK-021 Tooltip shows pane list with asterisk: test verifies active pane marked with `*` in panes list

## Edge Cases & Error Handling

- [x] CHK-022 Window with no matching panes: a window index present in list-windows but absent from list-panes result gets empty `Panes` (nil or `[]`), not an error
- [x] CHK-023 PaneInfo with isActive=false for all panes: tooltip CWD falls back to `worktreePath`, no crash

## Code Quality

- [x] CHK-024 Pattern consistency: `parsePanes` follows same structure as `parseWindows` (tab delimiter, nil on empty, skip malformed); `PaneInfo` struct follows `WindowInfo` JSON tag conventions
- [x] CHK-025 No unnecessary duplication: `tmuxExecServer` reused for `list-panes` call (no new exec helper); `listDelim` constant reused in `parsePanes`
- [x] CHK-026 Go subprocess safety: `list-panes` call uses `tmuxExecServer(ctx, server, ...)` with argument slices — no shell strings
- [x] CHK-027 No magic strings: `list-panes` format string defined as a named `strings.Join` expression or constant (not scattered inline) — defined as `var paneFormat`
- [x] CHK-028 Type narrowing in frontend: tooltip component uses optional chaining (`panes?.find(...)`) — no `as` casts

## Security

- [x] CHK-029 No injection surface: `list-panes -s -t <session>` call passes `session` as an explicit argument to `tmuxExecServer` (arg slice), not via shell string interpolation
