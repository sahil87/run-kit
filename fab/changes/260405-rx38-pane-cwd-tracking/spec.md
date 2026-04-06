# Spec: Pane CWD Tracking and Sidebar Hover Info

**Change**: 260405-rx38-pane-cwd-tracking
**Created**: 2026-04-06
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

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

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `tmux pane_current_path` via SSE sufficient — no OSC 7 | Confirmed from intake #1. 2.5s lag acceptable; OSC 7 adds shell dependency for no meaningful gain | S:95 R:95 A:95 D:90 |
| 2 | Certain | `list-panes -s -t <session>` — one call per session per tick | Confirmed from intake #2. Cheap single subprocess; groups naturally by window_index | S:90 R:90 A:90 D:90 |
| 3 | Certain | `PaneInfo` shape: paneId, paneIndex, cwd, command, isActive | Confirmed from intake #3. Sufficient for tooltip and future use | S:90 R:95 A:90 D:90 |
| 4 | Certain | `list-panes` format includes `#{window_index}` as field 0 for grouping | Spec-level discovery — required to group panes to windows without per-window subprocess calls | S:90 R:90 A:90 D:90 |
| 5 | Certain | `WorktreePath` continues to be populated from `list-windows #{pane_current_path}` | Confirmed from intake #4. `list-panes` is additive — no change to existing WorktreePath source | S:90 R:95 A:90 D:90 |
| 6 | Certain | Panes stored in Zustand `WindowEntry` for future access | Confirmed from intake #5. Explicit decision — pane data useful for future features | S:95 R:95 A:95 D:95 |
| 7 | Confident | Tooltip uses `group-hover` pattern from kill button in `window-row.tsx` | Confirmed from intake #6. Consistent with existing `opacity-0 group-hover:opacity-100` reveal | S:80 R:85 A:80 D:80 |
| 8 | Confident | `panes` is optional in `WindowInfo` frontend type | Spec-level: existing test fixtures omit panes — required field would force mass fixture updates | S:80 R:80 A:85 D:80 |
| 9 | Certain | Tooltip positioned to the right using `left-full ml-1` absolute positioning (floats outside sidebar) | Clarified — `left-full` floats tooltip outside sidebar boundary; does not overlap window name text; consistent pattern with sidebar `overflow-y-auto` container | S:90 R:85 A:85 D:85 |
| 10 | Confident | `list-panes` failure is non-fatal — empty Panes, not error | Race condition between `list-windows` and `list-panes` is possible; pane data is supplementary | S:80 R:70 A:85 D:80 |

10 assumptions (7 certain, 3 confident, 0 tentative). Auto-clarified 2026-04-06.
