# Plan: Drag-to-Pin — Window Row onto Board Row

**Change**: 260811-g0t1-drag-window-board-pin
**Intake**: `intake.md`

## Requirements

### Frontend: Window Drag Source (`app/frontend/src/components/sidebar/index.tsx`)

#### R1: Window drag carries a dedicated marker MIME
The window-row drag start (`handleDragStart`, `sidebar/index.tsx:700`) MUST set a dedicated marker MIME `application/x-window-drag` (value: the `windowId`) alongside the existing `application/json` payload. The `application/json` payload MUST stay byte-identical in shape (`{ server, session, index, windowId, name }`) so the existing window reorder/move drop handlers are untouched.

- **GIVEN** a user starts dragging a sidebar window row
- **WHEN** `handleDragStart` runs
- **THEN** `dataTransfer.types` contains both `application/json` and `application/x-window-drag`
- **AND** the `application/json` payload still parses to `{ server, session, index, windowId, name }`

#### R2: Window drag `effectAllowed` widened to `copyMove`
The window-row drag start MUST set `dataTransfer.effectAllowed = "copyMove"` (widened from `"move"`) so drop targets may offer a copy (link) cursor. Existing window reorder/move targets keep `dropEffect = "move"`, which remains permitted under `"copyMove"` — no behavior change on those surfaces.

- **GIVEN** a window-row drag in progress
- **WHEN** the drag start completes
- **THEN** `effectAllowed` is `"copyMove"`
- **AND** within-session reorder and cross-session move dragovers still accept with `dropEffect = "move"`

### Frontend: Board Row Drop Target (`app/frontend/src/components/sidebar/boards-section.tsx`)

#### R3: Board rows accept window drags with a copy cursor and drop highlight
Each board row in `BoardsSection` MUST accept a dragover carrying `application/x-window-drag`: `preventDefault()`, `dataTransfer.dropEffect = "copy"`, and a visible drop-target highlight on that row consistent with the existing session cross-move drop-target treatment (the `boxShadow: inset 0 0 0 2px var(--color-accent)` ring in `session-row.tsx`). A dragover WITHOUT the marker MIME MUST fall through to the existing `useBoardListReorder` `onDragOver` unchanged. The highlight MUST clear on `onDragLeave` and on drop.

- **GIVEN** a window drag (marker MIME present) hovering a board row
- **WHEN** `onDragOver` fires on that row
- **THEN** the event is default-prevented, `dropEffect` is `"copy"`, and the row shows the drop-target ring
- **AND** when the drag leaves the row, the ring clears

#### R4: Dropping a window on a board row pins it
On drop with the marker MIME present, the handler MUST parse the `application/json` payload and call `usePinActions.pin(server, windowId, boardName)` for the dropped-on board — reusing the existing pin mutation unchanged (toast with "View board" action, `writeLastPinnedBoard` persistence, error toasts, SSE reconciliation; no optimistic UI). A drop WITHOUT the marker MIME MUST fall through to the existing reorder `onDrop` unchanged (board-list reorder still reorders and never pins; a window drop never reorders). A malformed JSON payload MUST be ignored silently (no pin call, no throw), mirroring the existing `handleDrop` try/catch.

- **GIVEN** a window drag over board row `review` carrying payload `{ server: "primary", windowId: "@5", name: "editor", … }`
- **WHEN** the drop lands
- **THEN** `pin("primary", "@5", "review")` is invoked
- **AND** the drop-target highlight is cleared
- **AND** board display order is unchanged (no `setBoardOrder` call)

#### R5: Cross-server pin works by construction; no client-side gating
The drop handler MUST NOT gate on the payload's `server` vs. any current server — boards are cross-server and `pin(server, windowId, board)` routes it. Already-pinned windows get NO frontend special-casing: the backend's re-stamp/no-op semantics (`api/boards.go` `windowExistsOnServer`) decide, matching the popover path. The existing cross-server *rejection* in the window-drop handlers applies only to session/window move targets, not board pins.

- **GIVEN** a window from server `alpha` dropped on a board row while viewing server `primary`
- **WHEN** the drop handler runs
- **THEN** `pin("alpha", windowId, board)` is called with no cross-server rejection toast

### Non-Goals

- Host page BOARDS zone drop handling — no sidebar (hence no window-row drag source) exists on `/`.
- Zero-board hint mode as a drop target — no board rows exist to receive a drop; the popover's cold-start `main` prefill covers that flow.
- Auto-expanding a collapsed BOARDS panel mid-drag — the panel defaults open once boards exist.
- Board-page pane area as a drop target — only the sidebar BOARDS panel rows, per the backlog entry.
- No backend, API, route, or state-model changes; no new dependencies; no new e2e spec (pin flow already covered by `boards-pin-flow.spec.ts`).

### Design Decisions

#### Marker MIME alongside the JSON payload, not instead of it
**Decision**: `handleDragStart` adds `application/x-window-drag` as a second type; the `application/json` payload is untouched.
**Why**: During `dragover` a drop target can only inspect `dataTransfer.types` (payload is sealed until drop), and `application/json` is too generic to gate on — every drag surface in the codebase uses a dedicated custom MIME (`application/x-session-reorder`, `application/x-server-reorder`, `application/x-board-list-reorder`, `application/x-board-pane-reorder`) precisely to avoid collisions. Keeping the JSON payload identical leaves the existing reorder/move handlers untouched.
**Rejected**: Gating board rows on `application/json` (collides with any other JSON drag); moving the payload into the marker MIME (breaks existing drop handlers).
*Introduced by*: 260811-g0t1-drag-window-board-pin

#### Copy cursor for a link operation
**Decision**: Board rows set `dropEffect = "copy"`; the window drag's `effectAllowed` widens to `"copyMove"`.
**Why**: Pinning LINKS the window (SESSIONS + BOARDS dual presence — the window stays in its home session and also appears on the board), so a copy (plus-badge) cursor is truthful; `"move"` remains permitted under `"copyMove"` for the existing reorder/move targets.
**Rejected**: Keeping `effectAllowed = "move"` (a move cursor implies the window leaves its session — false for a pin).
*Introduced by*: 260811-g0t1-drag-window-board-pin

## Tasks

### Phase 1: Setup

*(No setup — no new dependencies, files, or configuration.)*

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/sidebar/index.tsx` `handleDragStart`: set the `application/x-window-drag` marker MIME (value `windowId`) alongside the existing `application/json` payload and widen `effectAllowed` to `"copyMove"`. Export the marker MIME as a named constant shared with the drop target. <!-- R1, R2 -->
- [x] T002 In `app/frontend/src/components/sidebar/boards-section.tsx`: compose window-drop handling with the reorder tile props on each board row — marker-gated `onDragOver` (preventDefault + `dropEffect: "copy"` + drop-target ring state), marker-gated `onDrop` (parse JSON payload → `usePinActions.pin(server, windowId, boardName)`, malformed payload ignored), `onDragLeave` clearing the highlight; non-marker drags fall through to the existing reorder handlers. <!-- R3, R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Extend `app/frontend/src/components/sidebar/boards-section.test.tsx`: window-drag dragover accepted (preventDefault, copy effect, highlight shown); drop parses payload and calls the pin API with `(server, windowId, board)`; dragleave clears the highlight; malformed payload pins nothing; a board-list-reorder drag still reorders and never pins; a window drop never reorders (`setBoardOrder` not called). <!-- R3, R4, R5 -->
- [x] T004 Extend `app/frontend/src/components/sidebar/index.test.tsx`: window drag start sets the marker MIME + `copyMove` while the JSON payload keeps its shape; within-session reorder dragover still accepts with `dropEffect: "move"`. <!-- R1, R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `handleDragStart` sets `application/x-window-drag` alongside an unchanged `application/json` payload (`{ server, session, index, windowId, name }`).
- [x] A-002 R2: Window drag `effectAllowed` is `"copyMove"`; existing move targets still accept with `dropEffect: "move"`.
- [x] A-003 R3: A window-drag dragover on a board row is accepted (preventDefault), sets `dropEffect: "copy"`, shows the drop-target ring, and the ring clears on dragleave/drop; non-marker dragovers fall through to board-list reorder.
- [x] A-004 R4: Dropping a window on a board row calls `usePinActions.pin(server, windowId, boardName)` (toast + last-used persistence + SSE reconcile inherited unchanged); a window drop triggers no reorder; a reorder drop triggers no pin.
- [x] A-005 R5: No client-side gating on the payload's server or on already-pinned windows; the drop calls `pin` unconditionally and lets the backend decide.

### Behavioral Correctness

- [x] A-006 R1: Existing within-session window reorder and cross-session move behave exactly as before (JSON payload shape unchanged, reorder/move handlers untouched).
- [x] A-007 R4: Board-list drag reorder (`application/x-board-list-reorder`) over board rows still reorders with optimistic order + debounced POST, never invoking pin.

### Scenario Coverage

- [x] A-008 R3: Unit test proves the dragover acceptance + copy cursor + highlight and the dragleave clear.
- [x] A-009 R4: Unit test proves the drop → `pin(server, windowId, board)` call and the reorder/pin non-interference in both directions.

### Edge Cases & Error Handling

- [x] A-010 R4: A drop whose `application/json` payload is malformed JSON is ignored silently — no pin call, no throw.

### Code Quality

- [x] A-011: New behavior covered by tests (`code-quality.md`: new features MUST include tests) — `just test-frontend` green (130 files / 2523 tests passed).
- [x] A-012: Type narrowing over type assertions (`code-quality.md` frontend principle) in the drop payload parsing (`typeof` guards, no `as` casts).
- [x] A-013: No magic strings — the marker MIME is a named constant shared between drag source and drop target (`code-quality.md` anti-patterns).
- [x] A-014 Pattern consistency: drag wiring mirrors the existing custom-MIME reorder surfaces (`useBoardListReorder`, session-row drop target); `pin` reused unchanged (no duplicated pin logic).
- [x] A-015 No unnecessary duplication: `usePinActions`, `useBoardListReorder`, and the session-row drop-target styling are reused, not reimplemented.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop-target highlight reuses the session-row cross-move ring verbatim (`boxShadow: inset 0 0 0 2px var(--color-accent)`, `borderRadius: 4px`) | Intake names the session-row treatment as the consistency target; the style already exists and is trivially reversible | S:80 R:90 A:85 D:85 |
| 2 | Confident | Marker MIME constant exported from `boards-section.tsx` and imported by `index.tsx` (which already imports `BoardsSection`) | Two-file share needs one named constant (code-quality: no magic strings); no new module for one string, and no import cycle (boards-section never imports index) | S:45 R:85 A:75 D:65 |
| 3 | Certain | Malformed/missing JSON payload at drop is ignored silently (try/catch, no toast) | Mirrors the existing `handleDrop`/`handleSessionDrop` parse guards exactly | S:75 R:90 A:85 D:85 |
| 4 | Confident | Highlight state is local `useState<string \| null>` in `BoardsSection`, cleared on dragleave + drop; no global drag-end listener | The highlight is purely per-row hover feedback; dragleave fires when the pointer exits the row, drop clears on completion — matches the intake's "local state" wording | S:70 R:85 A:70 D:65 |
| 5 | Certain | Tests mock `@/api/boards` (`pinWindow`/`setBoardOrder`) in `boards-section.test.tsx`, keeping `useBoardListReorder` real — mirroring the file's existing `useBoards`/toast seam mocks | The existing test file establishes exactly this mocking posture; jsdom `DataTransfer` stub mirrors `index.test.tsx`'s `makeDataTransfer` | S:80 R:90 A:85 D:80 |

5 assumptions (3 certain, 2 confident, 0 tentative).
