# Plan: Server Tile Diet — Window Counts & Hover-Action Removal

**Change**: 260721-bylc-server-tile-diet-window-counts
**Intake**: `intake.md`

## Requirements

### Sidebar SERVER Panel: Tile Tightening In Place

#### R1: Two-line tile tightened to ≈38px
The server tile in `app/frontend/src/components/sidebar/server-panel.tsx` MUST keep its two-line anatomy (name line + count line) while tightening total height from ≈48px to ≈38px: top color stripe `h-1` → `h-0.5`, body padding `pt-1` → `pt-0.5` (horizontal `px-1.5` and bottom `pb-1.5` kept by default), and count-row reserve `h-4` → `h-3.5`. The count-row reserve MUST remain a fixed height so agents flipping between waiting/busy never change tile height (the existing comment's documented purpose is preserved at the smaller size). The TOP edge remains the server signature/active-marker — top border = server, left border = window rows; no left-border marker is introduced.

- **GIVEN** a rendered server tile with no waiting agents
- **WHEN** an agent on that server enters the waiting state (badge appears)
- **THEN** the tile's height does not change (the `h-3.5` reserve already held the badge's space)
- **AND** the stripe is 2px (`h-0.5`) and colored only when the tile is active

### Sidebar SERVER Panel: Window Count Display

#### R2: Tile count shows WINDOWS as a bare number; full wording in the tooltip
The tile's count line MUST show a bare window-count number (e.g. `5`) sourced from the new `windowCount` field (R3), replacing the `{sessionCount} sess` text. The tile button's `title` MUST be extended from the bare server name to include singular-aware full wording, e.g. `runKit — 5 windows across 2 sessions` / `1 window across 1 session`. The `WaitingBadge` MUST stay on the same count-line flex row in its numeric-pill form, right-aligned exactly as today; the obsolete comment justifying count-row placement by hover-cluster collision avoidance is updated (the cluster is removed by R4) while the placement is kept.

- **GIVEN** a server with 5 windows across 2 sessions
- **WHEN** its tile renders
- **THEN** the count line shows `5` (no "sess"/"win" suffix) and the button `title` contains `5 windows across 2 sessions`
- **GIVEN** a server with 1 window in 1 session
- **WHEN** its tile renders
- **THEN** the `title` wording is singular: `1 window across 1 session`

### Backend: Per-Server Window Count

#### R3: `windowCount` derived from tmux at request time
`ListSessions` (`app/backend/internal/tmux/tmux.go`) MUST append `#{session_windows}` as a 6th field to its `list-sessions` format string, parsed by `parseSessions` into a new additive `SessionInfo` field `Windows int` (JSON key `windows`). `handleServersList` (`app/backend/api/servers.go`) MUST sum `Windows` per server over the sessions `parseSessions` keeps (its session-group-copy filter already excludes grouped duplicates, so shared windows are not double-counted) inside the existing fan-out — no new subprocess — and surface the sum as `WindowCount int` (JSON `windowCount`) on the `serverInfo` response entry. The frontend `ServerInfo` type (`app/frontend/src/api/client.ts`) gains `windowCount`. `sessionCount` MUST be kept alongside (verified consumer: `host-overview-page.tsx` renders `{sessionCount} sess`). Per-server `ListSessions` failure keeps the existing no-5xx stance: that entry gets `windowCount: 0`.

- **GIVEN** a server with sessions of 3 and 2 windows plus a session-group copy of the first
- **WHEN** GET `/api/servers` responds
- **THEN** that server's entry carries `windowCount: 5` (the group copy is not double-counted) and `sessionCount` is unchanged in meaning
- **GIVEN** a server whose `ListSessions` errors
- **WHEN** GET `/api/servers` responds
- **THEN** the response is still 200 and that entry has `windowCount: 0`

### Sidebar SERVER Panel: Hover-Action Cluster Removal

#### R4: Hover palette/✕ cluster and its dead plumbing removed from the tile surface
The hover-revealed `showActions` block in `ServerTile` (palette button + ✕ kill button) MUST be deleted, along with the now-dead plumbing on the tile and panel: `ServerTile` props `onKill`/`onColorClick`/`colorPickerOpen`/`colorPickerNode`, the portalled `SwatchPopover` + `popoverPos` `useLayoutEffect` + `tileWrapperRef` positioning, `ServerPanel` props `onKillServer`/`onServerColorChange` and the `colorPickerFor` state, and the corresponding unused imports. The caller (`app/frontend/src/components/sidebar/index.tsx`) MUST shed the dead prop threading into `<ServerPanel>` while keeping the Sidebar-level `onKillServer`/`onServerColorChange` props intact — the SESSIONS-pane server-group headers (PR #432 / x4sf) still consume them and are untouched.

- **GIVEN** a desktop pointer hovering a server tile
- **WHEN** the tile renders
- **THEN** no palette or ✕ button appears (desktop now matches mobile, which never had the cluster)
- **AND** the SESSIONS-pane group-header kill/color buttons still work unchanged

### Command Palette: Per-Server Kill Escape Hatch

#### R5: `Server: Kill {name}` listed for every server
The existing single current-server `Server: Kill` palette entry (`app/frontend/src/app.tsx` `serverActions`) MUST be replaced with per-server entries following the established `Server: Switch to {name}` enumeration pattern: one `Server: Kill {name}` entry per server, the current server suffixed ` (current)`. Selection MUST reuse the existing kill flow — `setKillServerTarget(name)` → the inline `killServerTarget` confirmation Dialog in `app.tsx` (including its `DAEMON_SERVER` warning) → `executeKillServer`. Label/entry composition SHALL live in a pure extracted builder `app/frontend/src/lib/palette-server-kill.ts` (mirroring `palette-pin.ts`/`palette-move.ts`) with a colocated unit test. This keeps kill keyboard-reachable for non-current servers under the SESSIONS pane's `current` scope mode (Constitution V); kill stays the existing POST endpoint (Constitution IX).

- **GIVEN** servers `default` (current), `work`, `rk-daemon`
- **WHEN** the palette opens
- **THEN** it lists `Server: Kill default (current)`, `Server: Kill work`, `Server: Kill rk-daemon`
- **AND** selecting `Server: Kill rk-daemon` opens the confirm Dialog with the daemon warning line

### Sidebar SERVER Panel: Panel Chrome Diet

#### R6: Grid floor 88px → 72px
The tile grid floor MUST drop to 72px on both layouts: desktop `gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))"` and mobile `gridAutoColumns: "72px"`. The explanatory comment MUST be updated: the 88px floor existed only to fit "N sess" + waiting badge side by side; a bare number + badge fits at 72px.

- **GIVEN** the desktop sidebar
- **WHEN** the grid lays out
- **THEN** tiles pack at a 72px minimum column width; mobile single-row columns are 72px

#### R7: Redundant server name removed from the panel header
The `headerRight` slot in `ServerPanel` MUST drop the `<span>{server}</span>` (the highlighted tile and the top-bar page heading already show it) while keeping the `{refreshing && <LogoSpinner size={10} />}` behavior.

- **GIVEN** the SERVER panel header
- **WHEN** it renders with `refreshing` true
- **THEN** the spinner shows and no server name text is present in `headerRight`

#### R8: Panel height constants 56 → 50
`ServerPanel`'s `CollapsiblePanel` props `defaultHeight`/`minHeight`/`mobileHeight` MUST change from 56 to 50 to match the shrunken one-row tile height, verified visually (one tile row + padding, no clipping) during apply.

- **GIVEN** the panel at its default height
- **WHEN** one row of tightened tiles renders
- **THEN** the row is fully visible without clipping at height 50

### Host Overview: Explicitly Unchanged

#### R9: Host overview tiles keep `{sessionCount} sess`
`host-overview-page.tsx` / `host-panel.tsx` MUST remain unchanged in display: their tiles keep rendering `{sessionCount} sess`; the new `windowCount` field is available but not displayed this change.

- **GIVEN** the Host overview page
- **WHEN** server tiles render
- **THEN** they show `{sessionCount} sess` exactly as before this change

### Tests

#### R10: Test surface updated with the change
Tests MUST cover the changed behavior (code-quality.md): `server-panel.test.tsx` (bare window-count rendering replacing "N sess" assertions, absence of the hover action cluster, tooltip wording), `internal/tmux/tmux_test.go` (6-field `parseSessions` parsing), `api/servers_test.go` (per-server window summation incl. failure → 0), a colocated unit test for the palette builder, and `app/frontend/tests/e2e/server-panel-grid.spec.ts` (its `text=/\d+ sess/` assertion changes) with its sibling `server-panel-grid.spec.md` updated in the same commit (Constitution § Test Companion Docs).

- **GIVEN** the full change applied
- **WHEN** `just test-backend`, `just test-frontend`, and the scoped `server-panel-grid` e2e run
- **THEN** all pass, and `server-panel-grid.spec.md` documents the updated assertions

### Non-Goals

- Host overview window-count display — deliberately deferred (intake Tentative #16)
- Board-page palette server entries — the board palette carries no server entries today
- Any change to `kill-dialog.tsx` (session/window kills only) or the SESSIONS-pane group headers
- Renaming or removing `sessionCount` from the API

## Tasks

### Phase 1: Backend window count

- [x] T001 Add `Windows int` (JSON `windows`) to `SessionInfo`, append `#{session_windows}` as the 6th format field in `ListSessions`, and parse it in `parseSessions` (`app/backend/internal/tmux/tmux.go`) <!-- R3 -->
- [x] T002 Extend `app/backend/internal/tmux/tmux_test.go`: 6-field line helper + parse cases (windows parsed, missing field → 0, group-copy filtering with windows) and compare `Windows` in `sessionInfoSliceEqual` <!-- R3, R10 -->
- [x] T003 Add `WindowCount int` (JSON `windowCount`) to `serverInfo` and sum kept sessions' `Windows` per server inside the existing fan-out in `handleServersList` (`app/backend/api/servers.go`) <!-- R3 -->
- [x] T004 Add window-count summation tests to `app/backend/api/servers_test.go` (multi-session sum via mock `SessionInfo.Windows`; `ListSessions` failure → `windowCount: 0`, still 200) <!-- R3, R10 -->

### Phase 2: Frontend tile + panel diet

- [x] T005 [P] Add `windowCount?: number` to the `ServerInfo` type in `app/frontend/src/api/client.ts` (optional, mirroring the `rank?` precedent — backend always sends it) <!-- R3 -->
- [x] T006 Tighten the tile in `app/frontend/src/components/sidebar/server-panel.tsx`: stripe `h-1`→`h-0.5`, body `pt-1`→`pt-0.5`, count reserve `h-4`→`h-3.5` (preserve the fixed-height comment intent); replace `{sessionCount} sess` with the bare `windowCount` number; extend the button `title` to `"{name} — {N} window(s) across {M} session(s)"` singular-aware; update the badge-placement comment (cluster-collision rationale obsolete, placement kept) <!-- R1, R2 -->
- [x] T007 Remove the `showActions` hover cluster and dead plumbing from `server-panel.tsx`: `ServerTile` props `onKill`/`onColorClick`/`colorPickerOpen`/`colorPickerNode`, the portalled `SwatchPopover` + `popoverPos` `useLayoutEffect` + `tileWrapperRef`, `ServerPanel` props `onKillServer`/`onServerColorChange` + `colorPickerFor` state, and unused imports (`createPortal`, `useLayoutEffect`, `SwatchPopover`, `PaletteIcon`) <!-- R4 -->
- [x] T008 Drop the grid floor 88px→72px on both desktop `minmax` and mobile `gridAutoColumns` in `server-panel.tsx`; rewrite the explanatory comment for the new floor <!-- R6 -->
- [x] T009 Panel chrome: remove the server-name span from `headerRight` (keep the refresh spinner); lower `defaultHeight`/`minHeight`/`mobileHeight` 56→50 in `server-panel.tsx` <!-- R7, R8 -->
- [x] T010 Shed the dead `onKillServer`/`onServerColorChange` threading into `<ServerPanel>` in `app/frontend/src/components/sidebar/index.tsx` (Sidebar-level props stay — SESSIONS-pane group headers consume them) <!-- R4 -->
- [x] T011 Update `app/frontend/src/components/sidebar/server-panel.test.tsx`: fixtures gain `windowCount`; bare-number rendering + tooltip assertions replace the "N sess" assertions; kill/color-picker tests replaced by cluster-absence assertions; drop removed props from the render helper <!-- R1, R2, R4, R10 -->

### Phase 3: Palette escape hatch

- [x] T012 [P] Create `app/frontend/src/lib/palette-server-kill.ts` — pure `buildServerKillActions(serverNames, currentServer, onKill)` builder (per-server `Server: Kill {name}` entries, ` (current)` suffix) + colocated `palette-server-kill.test.ts` <!-- R5, R10 -->
- [x] T013 Replace the single `Server: Kill` entry in `app.tsx` `serverActions` with the builder's per-server entries wired to `setKillServerTarget` (existing confirm Dialog + `DAEMON_SERVER` warning flow reused) <!-- R5 -->

### Phase 4: e2e + verification

- [x] T014 Update `app/frontend/tests/e2e/server-panel-grid.spec.ts` (the `text=/\d+ sess/` assertion → window-count/tooltip assertion) and its sibling `server-panel-grid.spec.md` in the same commit <!-- R2, R10 -->
- [x] T015 Run verification gates: `just test-backend`, `just test-frontend`, `just check`, scoped `just test-e2e server-panel-grid`; fix failures <!-- R10 -->

## Execution Order

- T001 blocks T002 and T003; T003 blocks T004
- T005 blocks T006 (type carries `windowCount`); T006–T009 are same-file sequential; T010 after T007; T011 after T006–T009
- T012 blocks T013
- T014/T015 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Tile keeps two-line anatomy with stripe `h-0.5`, body `pt-0.5`, fixed-height count reserve `h-3.5`; comment intent (no height jump on badge appearance) preserved
- [x] A-002 R2: Count line renders the bare window-count number; button `title` carries singular-aware "{N} windows across {M} sessions" wording; WaitingBadge stays right-aligned on the count row as a numeric pill
- [x] A-003 R3: `#{session_windows}` parsed as 6th field into `SessionInfo.Windows`; `handleServersList` sums per server over kept sessions only; `windowCount` present on the response and the frontend `ServerInfo`; `sessionCount` kept
- [x] A-004 R4: `showActions` cluster and all dead plumbing gone through the panel surface (tile props, portal, `ServerPanel` props, `colorPickerFor`, caller threading); SESSIONS-pane group-header kill/color paths untouched
- [x] A-005 R5: Palette lists `Server: Kill {name}` for every server with ` (current)` on the current one, via the extracted `src/lib` builder; selection funnels through `setKillServerTarget` → inline Dialog (incl. `DAEMON_SERVER` warning) → `executeKillServer`
- [x] A-006 R6: Grid floor 72px on both desktop `minmax` and mobile `gridAutoColumns`, with an updated explanatory comment
- [x] A-007 R7: `headerRight` no longer renders the server name; refresh spinner behavior kept
- [x] A-008 R8: Panel `defaultHeight`/`minHeight`/`mobileHeight` are 50 with one tile row fully visible (no clipping) — verified via passing e2e (no clipping asserted by grid render tests)

### Behavioral Correctness

- [x] A-009 R2: No tile shows "N sess" any more in the sidebar SERVER panel; the old `{sessionCount} sess` assertions are gone from `server-panel.test.tsx`
- [x] A-010 R3: Session-group copies do not double-count windows (summation only over `parseSessions`-kept sessions); a per-server `ListSessions` failure yields `windowCount: 0` without a 5xx
- [x] A-011 R9: Host overview tiles still render `{sessionCount} sess` unchanged (`host-overview-page.tsx:363` unchanged, not in diff)

### Removal Verification

- [x] A-012 R4: No palette/✕ hover buttons render on server tiles on any pointer type; no unused imports or dead props remain in `server-panel.tsx` / the `<ServerPanel>` call site (verified: `createPortal`/`useLayoutEffect`/`SwatchPopover`/`PaletteIcon` imports dropped; `useCallback`/`useRef`/`useEffect`/`fireEvent`/`within` remain live)
- [x] A-013 R5: The old single current-server `Server: Kill` entry (id `kill-server`) is gone, replaced by per-server entries (id `kill-server-{name}`)

### Scenario Coverage

- [x] A-014 R3: `tmux_test.go` covers 6-field parsing (value parsed, missing field → 0, group-copy filter + windows, malformed → 0); `servers_test.go` covers multi-session summation and the failure → 0 path
- [x] A-015 R5: The builder unit test covers per-server entry generation, label composition, and the `(current)` suffix (plus empty-list and current-not-in-list edges)
- [x] A-016 R10: `server-panel-grid.spec.ts` no longer asserts `/\d+ sess/` (asserts `toHaveCount(0)`) and asserts the new tooltip count rendering; `server-panel-grid.spec.md` updated in the same working tree

### Edge Cases & Error Handling

- [x] A-017 R2: A server with `windowCount` 0/undefined renders `0` without layout breakage (`windowCount ?? 0`, covered by the "renders 0 when windowCount is absent" test); badge absent at count 0 keeps the reserved row height
- [x] A-018 R1: Waiting badge appearing/disappearing does not change tile height (fixed `h-3.5` reserve — reserve is unconditional, independent of badge presence)

### Code Quality

- [x] A-019 Pattern consistency: new code follows surrounding conventions (palette builder mirrors `palette-pin.ts`/`palette-move.ts`; backend field additions mirror the `rank` fan-out precedent)
- [x] A-020 No unnecessary duplication: existing utilities reused (`WaitingBadge`, `setKillServerTarget` flow, existing fan-out — no new subprocess, no new dialog)
- [x] A-021 No shell strings / `exec.CommandContext` discipline unchanged: the backend change touches only the format string inside the existing `ListSessions` call (Constitution I)
- [x] A-022 State derived from tmux at request time — window count introduces no cache (Constitution II); all mutating flows remain POST (Constitution IX); palette keeps kill keyboard-reachable (Constitution V)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Frontend `ServerInfo.windowCount` is optional (`windowCount?: number`), tile renders `windowCount ?? 0` | Mirrors the existing `rank?` precedent on the same type; backend always sends the field, and optionality avoids churning the many test fixtures that construct `ServerInfo` | S:70 R:90 A:85 D:75 |
| 2 | Confident | Tooltip format: `` `${name} — ${N} window(s) across ${M} session(s)` `` — name kept first, an em-dash separator | Intake keeps `title={name}` as base and says "extend it to include"; the name must stay in the tooltip since it is the truncation fallback (existing test asserts it) | S:65 R:95 A:80 D:70 |
| 3 | Confident | `SessionInfo.Windows` uses plain `json:"windows"` (no omitempty) | Additive key per intake; a real session always has ≥1 window so omitempty would only hide malformed parses; matches `name`'s always-present style | S:60 R:90 A:80 D:75 |
| 4 | Confident | Builder signature `buildServerKillActions(serverNames: string[], currentServer: string, onKill: (name) => void): PaletteAction[]` in `src/lib/palette-server-kill.ts` | Mirrors `buildPinActions` (names + callbacks, thin app.tsx wiring); intake's front-runner pattern (assumption 18) | S:65 R:90 A:85 D:70 |
| 5 | Certain | Sidebar-level `onKillServer`/`onServerColorChange` props stay on `Sidebar`; only the `<ServerPanel …>` threading is removed | Verified in source: `sidebar/index.tsx` ServerGroup headers (lines ~1240, ~1685, ~1706) consume both — they are NOT dead at the Sidebar level | S:85 R:90 A:95 D:90 |
| 6 | Confident | e2e replacement assertion: the grid tile's `title` attribute matches `/\d+ windows? across \d+ sessions?/` (tooltip is the stable text seam; the bare number alone is too ambiguous to locate) | The old `/\d+ sess/` text seam disappears; the tooltip carries the only greppable full wording | S:60 R:90 A:80 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).

## Deletion Candidates

- None — this change already deletes the redundant code inline (the `showActions` hover cluster, the portalled `SwatchPopover` + `popoverPos`/`tileWrapperRef`/`useLayoutEffect`, `ServerTile`/`ServerPanel` kill/color props, `colorPickerFor` state, the `<ServerPanel>` prop threading, and the single `kill-server` palette entry). The now-unused imports (`createPortal`, `useLayoutEffect`, `SwatchPopover`, `PaletteIcon`) are dropped from `server-panel.tsx` within the diff. Nothing else became newly redundant: `SwatchPopover` and `PaletteIcon` retain many other consumers (SESSIONS-pane group headers, session/window rows), and `handleServerColorChange`/`onKillServer` stay live at the `Sidebar` level for the x4sf group-header contract.
