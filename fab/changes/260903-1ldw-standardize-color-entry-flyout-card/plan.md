# Plan: Standardize color-selector invocation on the row flyout card

**Change**: 260903-1ldw-standardize-color-entry-flyout-card
**Intake**: `intake.md`

## Requirements

### Sidebar: Session-row fine-pointer surface

#### R1: Session flyout card becomes the fine-pointer hover surface
The session row's `useRowFlyout` mount (`app/frontend/src/components/sidebar/session-row.tsx`) SHALL drop `coarseOnly: true` so the shared card's hover/focus triggers activate on fine pointers (whole-row hover at the sidebar's right edge, `placement: "right"` — the window tier's mechanics). Coarse behavior MUST be unchanged: the 56px status rail's tap/scrub remains the coarse trigger.

- **GIVEN** a fine-pointer viewport with a session row visible
- **WHEN** the pointer hovers the row (or keyboard focus lands on it)
- **THEN** the session flyout card opens at the sidebar's right edge with title `Session <name>`, the facts line, and the action rows (`Change color…` first)
- **AND** on a coarse pointer the rail tap/scrub still opens the same card with unchanged placement

#### R2: Session-row hover action cluster retires entirely
The session row's trailing hover-revealed icon cluster (palette / bot spawn / `+` create window / `✕` kill, currently render-gated `!coarse`) SHALL be removed entirely — on every pointer class. Every cluster action already exists as a card row (`Change color…`, `Spawn agent…`, `New tab`, `Kill session`); no capability is lost. The direct `SwatchPopover` mount stays, invoked only from the card's `Change color…` row, and its open state keeps suppressing the card.

- **GIVEN** a fine-pointer viewport with a session row hovered
- **WHEN** the row renders
- **THEN** no palette/bot/plus/kill icon buttons render in the row (the old `Set color for <name>` / `Spawn agent in <name>` / `New tab in <name>` / kill buttons are absent from the DOM)
- **AND** clicking the card's `Change color…` row closes the card and opens the row's `SwatchPopover`

#### R3: Session-row fine-pointer identity tip retires
The session row's `useIdentityTip`/`IdentityTipCard` usage (xb77) SHALL be removed — the flyout card is the single hover surface per row. The card already carries the tip's content verbatim (`Session <name>` title bar + `$N · N windows · ~/path` facts line); that content MUST remain on the card.

- **GIVEN** a fine-pointer viewport
- **WHEN** the pointer dwells on a session row
- **THEN** exactly one hover surface opens (the flyout card), carrying the identity title bar and facts line the tip used to show
- **AND** no separate `IdentityTipCard` mounts for the row

### Sidebar: Server group header fine-pointer surface

#### R4: Server card becomes the fine-pointer hover surface on the group header
The server-group `useRowFlyout` mount (`app/frontend/src/components/sidebar/index.tsx`, `ServerGroupInner`) SHALL drop `coarseOnly: true` so the server card opens on fine-pointer hover/focus of the header; the header rail's tap/scrub remains the coarse trigger. The card's existing content (title `Server <name>`, facts `tmux -L <name> · N sessions`, action rows `Change color…` / `New session` / Protect toggle / `Kill server`) is unchanged.

- **GIVEN** a fine-pointer viewport with a server group header visible
- **WHEN** the pointer hovers the header (or keyboard focus lands on it)
- **THEN** the server card opens with `Change color…` as its first action row
- **AND** the header's expand/collapse toggle still works — opening the card does not toggle the group, and card actions `stopPropagation`

#### R5: Server-group header action cluster retires entirely
The header's three-button cluster (palette → plus → close, change x4sf, currently render-gated `!coarse`) SHALL be removed entirely. The card rows bind the same stable identity-arg seams (`onServerColorChange` / `onCreateSession` / `onKillServer`) — no new props, preserving the R6a memo contract.

- **GIVEN** a fine-pointer viewport with a server group header hovered
- **WHEN** the header renders
- **THEN** no palette/plus/close buttons render in the header
- **AND** the card's `New session` and `Kill server` rows route through the existing `onCreateSession`/`onKillServer` seams (kill still confirms via the `killServerTarget` dialog)

#### R6: SwatchPopover anchors at the header on every pointer class
With the palette button gone, the group's portalled `SwatchPopover` SHALL anchor at the header element (the existing `headerRef` fallback with its flip heuristic — the coarse path's code) on every pointer class.

- **GIVEN** the server card's `Change color…` row is clicked (either pointer class)
- **WHEN** the popover opens
- **THEN** it is anchored at the header element via the existing portal + flip heuristic, and selection persists via the existing `handleServerColorChange` → `setServerColor` path

### Sidebar: Server tile card (TMUX SERVERS panel)

#### R7: Server tiles host the same server card
Each server tile in `app/frontend/src/components/sidebar/server-panel.tsx` SHALL host the SAME server flyout card as the group header (shared shell + shared content — extracted/shared, not duplicated), opened on fine-pointer hover/focus of the tile. No coarse rail is added to the tile in this change (on coarse pointers the tile card simply doesn't open — the sessions-pane header card is the coarse surface). Tile click (server switch) MUST be unaffected; card actions `stopPropagation`.

- **GIVEN** a fine-pointer viewport with the TMUX SERVERS panel expanded
- **WHEN** the pointer dwells on a server tile
- **THEN** the server card opens (title `Server <name>`, facts line, `Change color…` / `New session` / Protect toggle / `Kill server` rows) — the tile's first-ever color entry
- **AND** clicking `Change color…` closes the card and opens a `SwatchPopover` anchored at the tile (the tile-portal flip-heuristic pattern), persisting via the same `setServerColor` seam

#### R8: Server-tile identity tip retires; shared content extraction
The tile's `useIdentityTip` usage SHALL be removed (the card carries the same facts — an external server's ` · external — not started by run-kit` suffix moves onto the card's facts line for the tile). The server card content (title/facts/action rows) SHALL be a shared component or shared builder consumed by BOTH the group header and the tile, so the two mounts cannot drift.

- **GIVEN** the tile card and the group-header card for the same server
- **WHEN** both render
- **THEN** their title, facts composition, and action-row set come from one shared implementation
- **AND** no `IdentityTipCard` mounts on server tiles

### Sidebar: identity-tip module retirement

#### R9: `identity-tip.tsx` is deleted
After R3 and R8, `app/frontend/src/components/sidebar/identity-tip.tsx` SHALL have no consumers; delete the module and its test coverage. If a consumer must remain for an unforeseen reason, keep the module and record why in `## Notes`. Memory/doc references to the retired tips are hydrate's concern, not code's.

- **GIVEN** the completed change
- **WHEN** grepping the frontend for `identity-tip` / `useIdentityTip` / `IdentityTipCard`
- **THEN** no source imports remain (the file and its tests are deleted)

### Command palette: Server: Set Color

#### R10: `Server: Set Color` palette action exists
`app/frontend/src/app.tsx` SHALL register a `Server: Set Color` action (id `server-set-color`, in `serverActions` beside the other `Server:` verbs), mirroring `Session: Set Color`'s shape: extend the `showColorPicker` union to `"session" | "window" | "server" | null`, render the same centered modal `SwatchPopover` for the `"server"` arm scoped to the current route's server, and persist via the existing `setServerColor` API (error → toast, matching the session/window arms). The action is registered whenever a current server exists (Constitution V — the keyboard path for the server tier once the hover icon retires).

- **GIVEN** the command palette open on a `/$server/...` route
- **WHEN** `Server: Set Color` is selected and a swatch is picked
- **THEN** `setServerColor(server, color)` is called and the sidebar's server tints repaint via the existing SSE/refetch paths
- **AND** a failed POST surfaces an error toast

### Non-Goals

- No coarse-pointer behavior changes on the three existing tiers (rail + card, 260817-ve5m).
- No coarse rail on the server tile — the tile card is fine-pointer hover/focus only.
- No change to the Host panel instance-color icon or the Settings dialog instance-color home (the documented exception).
- No change to the SwatchPopover / label picker internals (owned by 260723-wwoi / 260819-9hh6).
- No new color tokens, no new props through the memoized row tree.

### Design Decisions

#### Card promotion instead of hover-icon proliferation
**Decision**: Promote the shared row flyout card to the fine-pointer action surface on the session and server tiers (drop `coarseOnly`), retiring the hover icon clusters and identity tips, rather than adding hover icons to the tiers that lack them.
**Why**: The card is already the coarse standard on all three tiers and the fine standard on the window tier (93dy); converging both pointer regimes on one gesture makes the whole sidebar learnable, and labeled card rows are more discoverable than unlabeled hover-revealed icons.
**Rejected**: Standardizing on hover icons (adds a fourth idiom to the window row and tile, keeps pointer regimes divergent); leaving the server tile inert (server color stays unreachable from the SERVERS panel).
*Introduced by*: 260903-1ldw-standardize-color-entry-flyout-card

#### Palette action rides the existing modal SwatchPopover union
**Decision**: `Server: Set Color` extends the app.tsx `showColorPicker` union (`"server"` arm) and calls `setServerColor` directly, rather than dispatching a document event at the ServerGroup header's popover.
**Why**: Mirrors its named siblings `Session: Set Color` / `Tab: Set Color` exactly (one idiom per verb family); no dependency on the sidebar being open or the group being rendered.
**Rejected**: A `server-color-popover:open` document event into the group header (the `label-popover:open` idiom) — fails when the sidebar is collapsed or the group is scrolled out/unmounted.
*Introduced by*: 260903-1ldw-standardize-color-entry-flyout-card

## Tasks

### Phase 1: Setup

- [x] T001 Extract the shared server-card content (title `Server <name>`, facts line incl. the external suffix, action rows Change color…/New session/Protect toggle/Kill server) from `ServerGroupInner`'s inline `content` render prop in `app/frontend/src/components/sidebar/index.tsx` into a shared component/builder (e.g. `ServerCardContent` in `sidebar/row-flyout-card.tsx` or a sibling module), parameterized by the existing identity-arg seams; keep the group header consuming it with zero behavior change <!-- R8 -->

### Phase 2: Core Implementation

- [x] T002 Session row (`app/frontend/src/components/sidebar/session-row.tsx`): drop `coarseOnly: true` from `useRowFlyout`; remove the fine-pointer hover action cluster (palette/bot/plus/kill buttons); remove the `useIdentityTip` usage and simplify `setRowRefs` to the flyout reference alone; keep the `SwatchPopover` mount + `showColorPicker` suppression <!-- R1 -->
- [x] T003 Server group header (`app/frontend/src/components/sidebar/index.tsx`): drop `coarseOnly: true` from the group's `useRowFlyout`; remove the palette→plus→close header cluster; anchor the portalled `SwatchPopover` at `headerRef` unconditionally (remove the `paletteBtnRef` anchor arm); verify card open never toggles the group <!-- R4 -->
- [x] T004 Server tile (`app/frontend/src/components/sidebar/server-panel.tsx`): mount `useRowFlyout` (fine-pointer hover/focus; no rail, no coarse trigger) on each tile rendering the shared server-card content from T001; add a tile-anchored portalled `SwatchPopover` (the existing tile-portal flip-heuristic pattern) opened by the card's `Change color…` row; thread the needed seams (`onServerColorChange`/`onCreateSession`/`onKillServer`/protect) through `ServerPanel` props from `Sidebar`; remove the tile's `useIdentityTip` usage <!-- R7 -->
- [x] T005 [P] Palette action (`app/frontend/src/app.tsx`): extend `showColorPicker` to `"session" | "window" | "server" | null`; add `Server: Set Color` (id `server-set-color`) to `serverActions`; wire the modal `SwatchPopover`'s `"server"` arm (`selectedColor` from the current server's stored color where cheaply available, else undefined; `onSelect` → `setServerColor(server, c)` with toast on failure) <!-- R10 -->
- [x] T006 Delete `app/frontend/src/components/sidebar/identity-tip.tsx` and its tests once T002–T004 remove the three consumers; grep-verify no imports remain <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Unit tests: update `session-row.test.tsx` (cluster absent on every pointer class; fine-pointer hover opens the card; identity tip gone; `Change color…` → SwatchPopover handoff), `index.test.tsx`/`index.core.test.tsx` (header cluster absent; fine hover opens server card; SwatchPopover header-anchored; kill/create routing unchanged), `server-panel.test.tsx` (tile card opens on hover with shared content; tile click still switches servers; tile SwatchPopover; identity tip gone), and palette coverage for `server-set-color` where palette actions are tested <!-- R2 -->
- [x] T008 e2e: retarget specs driving the retired hover-icon selectors to card rows — `new-window-unnamed.spec.ts`, `api-integration.spec.ts`, `spawn-agent.spec.ts`, `row-flyout.spec.ts`, `sync-latency.spec.ts`; extend `row-flyout.spec.ts` for fine-pointer session/server card hover-open and the server-tile card; keep every modified `test()`'s Proves/Steps intent comment current <!-- R7 -->
- [x] T009 Run verification gates: `just test-backend` (unaffected, sanity), `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e` <!-- R1 -->

## Execution Order

- T001 blocks T004 (shared content must exist before the tile consumes it); T003 can adopt T001's extraction in the same pass
- T002, T003+T001, T005 are mutually independent; T006 requires T002–T004 complete
- T007–T009 follow all implementation tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: Session flyout card opens on fine-pointer hover/focus of the session row (right-edge placement) and the coarse rail trigger is unchanged
- [x] A-002 R4: Server card opens on fine-pointer hover/focus of the group header and the coarse rail trigger is unchanged
- [x] A-003 R7: Server tiles open the server card on fine-pointer hover/focus, giving the tile a working `Change color…` entry; tile click still switches servers
- [x] A-004 R10: `Server: Set Color` palette action exists, opens the modal SwatchPopover, and persists via `setServerColor`

### Behavioral Correctness

- [x] A-005 R2: Session-row cluster actions all remain reachable via card rows (`Change color…`, `Spawn agent…` when wired, `New tab`, `Kill session` with confirm), and the `Change color…` close-then-open handoff + popover-over-card suppression hold
- [x] A-006 R5: Server-header card rows route through the existing seams — `New session` creates on that group's server; `Kill server` confirms via the `killServerTarget` dialog (daemon warning intact)
- [x] A-007 R6: The server SwatchPopover anchors at the header element with the flip heuristic on both pointer classes
- [x] A-008 R8: The group-header card and tile card render from one shared content implementation (no duplicated row lists)

### Removal Verification

- [x] A-009 R2: No palette/bot/plus/kill icon buttons render in session rows on any pointer class (old aria-labels `Set color for…`/`Spawn agent in…`/`New tab in…` absent from row DOM)
- [x] A-010 R5: No palette/plus/close buttons render in server group headers
- [x] A-011 R3: No `IdentityTipCard` mounts on session rows or server tiles
- [x] A-012 R9: `sidebar/identity-tip.tsx` and its tests are deleted; no source imports remain

### Scenario Coverage

- [x] A-013 R1: e2e proves fine-pointer hover opens the session and server cards and `Change color…` opens the picker (row-flyout.spec.ts)
- [x] A-014 R7: e2e or unit coverage proves the server-tile card path end-to-end (hover → card → Change color… → popover)
- [x] A-015 R2: Retargeted e2e specs (new-window-unnamed, api-integration, spawn-agent, sync-latency) pass using card rows, with intent comments updated

### Edge Cases & Error Handling

- [x] A-016 R1: Popover-over-card precedence holds at every tier (`suppressed` includes the picker-open state; card does not reopen while a picker is open)
- [x] A-017 R4: Opening the server card (hover or rail) never toggles the group's expand/collapse; card action clicks `stopPropagation`
- [x] A-018 R10: A failed `setServerColor` POST from the palette arm surfaces an error toast
- [x] A-019 R7: On coarse pointers the server tile opens no card (no rail added; no dead hover surface), and existing coarse flows are untouched

### Code Quality

- [x] A-020 Pattern consistency: new/changed code follows the shared card-shell idioms (close-then-open, `stopPropagation`, optional-handler gating, `PopupTitleBar` grammar)
- [x] A-021 No unnecessary duplication: server card content is shared between header and tile (Anti-Pattern: duplicating existing utilities)
- [x] A-022 Render performance: `SessionRow`/`ServerGroup`/`WindowRow` stay memoized; card state stays row-local; no new props thread through the memo tree; no `nowSeconds`-style churn props (R6a contract)
- [x] A-023 No polling: no `setInterval`+fetch added; repaints ride existing SSE/refetch paths
- [x] A-024 Tests included: new/changed behavior covered by unit tests, and modified e2e `test()`s carry current Proves/Steps intent comments (Constitution: Test Intent Comments)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The planned retirements (`sidebar/identity-tip.tsx` + `tests/e2e/row-identity-tips.spec.ts`, R9) were already executed in the diff; every remaining symbol touched by the diff keeps live call sites (`Tip`/`TipGroup` in `sidebar/index.tsx` still serve the scope-chip/version tips; `RowFlyout.referenceProps` remains the window-row and tile consumption path beside the new `getReferenceProps`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `Server: Set Color` uses the app.tsx modal-SwatchPopover union (`"server"` arm) rather than a document event into the group header's popover | Mirrors its named siblings exactly; works with the sidebar collapsed; the event idiom fails on unmounted/scrolled-out rows | S:60 R:85 A:80 D:70 |
| 2 | Confident | The session row's `Spawn agent…`, `Update annotations`, `New tab`, `Kill session` card rows are the sufficient replacements for the retired cluster (no new rows added) | User decision 1 says clusters retire because every action already exists as a card row; verified in code (260817-ve5m + 260827-8n6k) | S:80 R:80 A:85 D:85 |
| 3 | Confident | The tile card omits a coarse trigger entirely (hover/focus only; `coarseOnly` false but no rail) — coarse tiles behave exactly as today | Intake Non-Goal: no rail on tiles this change; the coarse surface for servers remains the sessions-pane header card | S:70 R:80 A:75 D:75 |
| 4 | Confident | Palette `"server"` arm's `selectedColor` may be undefined when the current color isn't cheaply available in app.tsx (the picker still works; selection persists) | Server colors live in Sidebar-local state; fetching `getAllServerColors` in app.tsx just for a checkmark is optional polish the apply agent may add if trivial | S:55 R:85 A:75 D:65 |
| 5 | Certain | The external-server suffix ` · external — not started by run-kit` moves onto the tile card's facts line (the tip's composition carries over verbatim) | The card replaces the tip as the identity surface; dropping the suffix would lose information | S:75 R:90 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
