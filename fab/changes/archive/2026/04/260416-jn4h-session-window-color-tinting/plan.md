# Plan: Session and Window Color Tinting

**Change**: 260416-jn4h-session-window-color-tinting
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

- [x] T001 [P] Add `Color *int` field to `WindowInfo` struct in `app/backend/internal/tmux/tmux.go` and extend the `ListWindows()` format string with `#{@color}` as field 8. Update `parseWindows()` to parse the new field (empty string → nil, integer → pointer). Update `windowFormat` constant.
- [x] T002 [P] Add `SessionColor *int` field to `ProjectSession` struct in `app/backend/internal/sessions/sessions.go` with JSON tag `json:"sessionColor,omitempty"`. Add `color?: number` to `WindowInfo` and `sessionColor?: number` to `ProjectSession` in `app/frontend/src/types.ts`.
- [x] T003 [P] Export `blendHex()` from `app/frontend/src/themes.ts` (currently module-private). No signature change needed — just remove the non-export restriction.

## Phase 2: Core Implementation

- [x] T004 Add `ReadSessionColor(projectRoot string) *int` function to a new file `app/backend/internal/config/runkit_yaml.go`. Reads `run-kit.yaml` from `projectRoot`, parses `session_color` field. Returns nil on missing file, missing key, or parse error. Best-effort, no error propagation.
- [x] T005 Add `WriteSessionColor(projectRoot string, color *int) error` function to `app/backend/internal/config/runkit_yaml.go`. When color is non-nil, writes `session_color: N` to `run-kit.yaml`. When nil, removes `session_color` key (or deletes file if empty).
- [x] T006 Wire session color reading into `FetchSessions()` in `app/backend/internal/sessions/sessions.go`. After deriving `repoRoot` for each session, call `config.ReadSessionColor(repoRoot)` and assign to `ProjectSession.SessionColor`.
- [x] T007 Add `SetWindowColor` and `UnsetWindowColor` methods to `TmuxOps` interface in `app/backend/api/router.go` and implement in `app/backend/internal/tmux/tmux.go`. `SetWindowColor(session string, index int, color int, server string)` executes `tmux set-option -w -t "{session}:{index}" @color {color}`. `UnsetWindowColor(session string, index int, server string)` executes `tmux set-option -wu -t "{session}:{index}" @color`.
- [x] T008 Add `POST /api/sessions/{session}/windows/{index}/color` handler in `app/backend/api/windows.go`. Request body: `{"color": N}` (0-15) or `{"color": null}`. Validate session name, window index (non-negative), color range. Call `SetWindowColor` or `UnsetWindowColor`. Register route in `app/backend/api/router.go`.
- [x] T009 Add `POST /api/sessions/{session}/color` handler in `app/backend/api/sessions.go`. Request body: `{"color": N}` (0-15) or `{"color": null}`. Derive project root from session's first window via `ListWindows` + path walk. Call `config.WriteSessionColor`. Register route in `app/backend/api/router.go`.
- [x] T010 Add `setWindowColor(session, index, color)` and `setSessionColor(session, color)` API client functions in `app/frontend/src/api/client.ts`. Both POST with JSON body, both append `?server=` via `withServer()`.
- [x] T011 Create `SwatchPopover` component at `app/frontend/src/components/swatch-popover.tsx`. Props: `selectedColor?: number`, `onSelect(color: number | null): void`, `onClose(): void`, `anchorRef?: RefObject<HTMLElement>`. Renders 13 ANSI color swatches (indices 1-6, 8-14) from `useTheme().theme.palette.ansi` at full saturation, plus "Clear" button. Checkmark on selected. Arrow key navigation, Escape/outside-click dismiss. Compact two-row grid layout.
- [x] T012 Add pre-blended color tint computation to `app/frontend/src/themes.ts`. Export a `computeRowTints(palette: ThemePalette): Map<number, {base: string, hover: string, selected: string}>` that pre-computes blended hex values for all 13 picker indices at 12%/18%/22% ratios against the palette background. Memoize per theme in the ThemeProvider or compute at theme load.

## Phase 3: Integration & Edge Cases

- [x] T013 Update `SessionRow` in `app/frontend/src/components/sidebar/session-row.tsx` to accept `sessionColor?: number` prop. When set, apply pre-blended background tint (base/hover/selected) via inline styles using computed tints. Add hover-reveal color swatch icon that opens `SwatchPopover`.
- [x] T014 Update `WindowRow` in `app/frontend/src/components/sidebar/window-row.tsx` to accept `color?: number` prop. When set, apply pre-blended background tint via inline styles. Change activity dot from color-based (green/gray) to shape-based (filled circle/hollow ring) using `text-secondary`. The left border for selected colored windows uses ANSI color at full saturation. Add hover-reveal color swatch icon.
- [x] T015 Register "Session: Set Color" and "Window: Set Color" actions in `app/frontend/src/components/command-palette.tsx`. "Window: Set Color" shown only when `currentWindow` exists. "Session: Set Color" shown when any session is active. Both open `SwatchPopover` (use a state flag in app.tsx or palette to switch to swatch selection mode). Wire to `setSessionColor` / `setWindowColor` API calls with optimistic update.
- [x] T016 Pass `sessionColor` and `color` through the sidebar component tree in `app/frontend/src/components/sidebar/index.tsx`. Read from `session.sessionColor` for sessions and `win.color` for windows. Pass to `SessionRow` and `WindowRow` respectively.

## Phase 4: Polish

- [x] T017 Add Go unit tests for `ReadSessionColor`, `WriteSessionColor` in `app/backend/internal/config/runkit_yaml_test.go`. Test: missing file, empty file, valid color, missing key, invalid value.
- [x] T018 Add Go handler tests for window color and session color endpoints in `app/backend/api/windows_test.go` and `app/backend/api/sessions_test.go`. Test: set color, clear color, invalid color value, invalid session/index.
- [x] T019 Add frontend unit tests for `SwatchPopover` in `app/frontend/src/components/swatch-popover.test.tsx`. Test: renders 13 swatches, shows checkmark on selected, calls onSelect, calls onClose on Escape.
- [x] T020 Add frontend unit test for `computeRowTints` in `app/frontend/src/themes.test.ts`. Test: returns correct number of entries, values are valid hex strings.

---

## Execution Order

- T001, T002, T003 are parallel (no dependencies)
- T004 before T005 (read before write in same file)
- T004, T005 before T006 (config module before session enrichment)
- T007 before T008 (tmux methods before handler)
- T006 parallel with T007-T009 (session enrichment independent of API endpoints)
- T010 after T008, T009 (client functions after endpoints exist)
- T011, T012 independent of backend tasks (frontend-only)
- T013, T014 after T011, T012 (need SwatchPopover and tint computation)
- T015 after T011, T010 (needs SwatchPopover and API client)
- T016 after T013, T014 (needs updated row components)
- T017-T020 after their respective implementation tasks

## Acceptance

## Functional Completeness

- [ ] CHK-001 Session color persistence: `run-kit.yaml` with `session_color` is read by `FetchSessions()` and value appears in SSE stream as `sessionColor`
- [ ] CHK-002 Window color storage: `#{@color}` tmux user option is read by `ListWindows()` and appears in SSE stream as `color`
- [ ] CHK-003 Set window color endpoint: `POST /api/sessions/:session/windows/:index/color` sets `@color` via tmux
- [ ] CHK-004 Clear window color endpoint: same endpoint with `null` clears `@color` via `set-option -wu`
- [ ] CHK-005 Set session color endpoint: `POST /api/sessions/:session/color` writes `session_color` to `run-kit.yaml`
- [ ] CHK-006 Clear session color endpoint: same endpoint with `null` removes `session_color` from `run-kit.yaml`
- [ ] CHK-007 Pre-blended row tint: colored rows use `blendHex()` at 12% base / 18% hover / 22% selected
- [ ] CHK-008 13-color picker: swatch popover shows indices 1-6, 8-14 (excludes 0, 7, 15)
- [ ] CHK-009 Activity dot shape-based: filled circle = active, hollow ring = idle, always `text-secondary`
- [ ] CHK-010 Command palette actions: "Session: Set Color" and "Window: Set Color" registered
- [ ] CHK-011 Hover indicator: color swatch icon appears on hover for both session and window rows
- [ ] CHK-012 Frontend types: `ProjectSession.sessionColor` and `WindowInfo.color` fields added

## Behavioral Correctness

- [ ] CHK-013 Selected colored row: uses 22% blend background + full-saturation ANSI left border (replaces `bg-accent/10`)
- [ ] CHK-014 Hover colored row: uses 18% blend background (replaces existing hover bg)
- [ ] CHK-015 Uncolored rows: existing styling unchanged (no regression)

## Scenario Coverage

- [ ] CHK-016 Session with no `run-kit.yaml`: no error, sessionColor omitted
- [ ] CHK-017 Window with no `@color`: color field omitted, row renders normally
- [ ] CHK-018 Invalid color value (out of range): 400 error from API
- [ ] CHK-019 Clear color then verify: row returns to default styling after clear
- [ ] CHK-020 Theme switch with colors: swatch popover and row tints update live

## Edge Cases & Error Handling

- [ ] CHK-021 `run-kit.yaml` exists but malformed: no crash, sessionColor omitted
- [ ] CHK-022 `run-kit.yaml` write to read-only directory: error returned to client
- [ ] CHK-023 Swatch popover dismiss: Escape and outside-click close without action
- [ ] CHK-024 Concurrent SSE clients: color changes propagated to all connected tabs

## Code Quality

- [ ] CHK-025 Pattern consistency: new endpoints follow existing handler structure (validate → execute → writeJSON)
- [ ] CHK-026 No unnecessary duplication: reuses `blendHex()`, `validate.ValidateName()`, existing tmux command patterns
- [ ] CHK-027 All subprocess calls use `exec.CommandContext` with timeout
- [ ] CHK-028 No shell string construction for tmux commands — argument slices only
- [ ] CHK-029 No inline tmux command construction — all through `internal/tmux/`
- [ ] CHK-030 New keyboard action registered in command palette
- [ ] CHK-031 No polling from client — color changes flow through existing SSE stream

## Security

- [ ] CHK-032 Session name validated via `validate.ValidateName()` before tmux commands
- [ ] CHK-033 Window index validated as non-negative integer
- [ ] CHK-034 Color value validated as integer 0-15 (rejects out-of-range, non-integer)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
