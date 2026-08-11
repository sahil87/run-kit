# Intake: Drag-to-Pin — Window Row onto Board Row

**Change**: 260811-g0t1-drag-window-board-pin
**Created**: 2026-08-11

## Origin

One-shot `/fab-new g0t1` from the backlog:

> [g0t1] 2026-07-18: Drag-to-pin: drag a sidebar window row onto a board row in the sidebar BOARDS panel to pin it (reuse existing custom-MIME drag-reorder infra)

No prior conversation context — cold invocation from the backlog entry.

## Why

Pinning a window to a board today takes three entry points (memory § Pin Entry Points): the hover-revealed window-row pin icon → `PinPopover` → pick a board, the command palette `Pin:` actions, and the board-header unpin. All are indirect: even when the destination board row is visible in the BOARDS panel a few rows above the window, the user must open a popover and pick the board from a list.

The sidebar already teaches drag as a first-class vocabulary — window rows drag to reorder/move (within-session and cross-session), session rows drag to reorder, board rows drag to reorder, server tiles drag to reorder. Dragging a window row onto a board row is the natural direct-manipulation completion of that vocabulary: source and destination are both on screen, and every piece of infrastructure already exists (the window drag carries `{server, windowId, …}`, the pin mutation is one hook call). Without this, the drag gesture users will inevitably try (windows are draggable, boards are visible) dies silently — the board row rejects the hover and the drag snaps back with no explanation.

Approach: pure frontend wiring of two existing mechanisms (the window-row drag payload and `usePinActions.pin`). No backend change, no new API, no new state model — the SSE echo already reconciles pin counts and board contents.

## What Changes

### 1. Window-drag marker MIME (`sidebar/index.tsx`)

The window-row drag (`handleDragStart`, `sidebar/index.tsx:700`) currently sets a single generic type:

```ts
e.dataTransfer.setData(
  "application/json",
  JSON.stringify({ server, session: sessionName, index: windowIndex, windowId, name: windowName }),
);
e.dataTransfer.effectAllowed = "move";
```

During `dragover` a drop target can only inspect `e.dataTransfer.types` (payload data is sealed until drop), and `application/json` is too generic to gate on — every other drag surface in the codebase uses a dedicated custom MIME precisely to avoid collisions (`application/x-session-reorder`, `application/x-server-reorder`, `application/x-board-list-reorder`, `application/x-board-pane-reorder`).

Add a marker type alongside the existing payload (payload stays in `application/json` so the existing window reorder/move handlers are untouched — they gate on `dragSource` state and parse the JSON at drop):

```ts
e.dataTransfer.setData("application/x-window-drag", windowId); // marker for foreign drop targets
e.dataTransfer.effectAllowed = "copyMove"; // widened from "move" — see §3
```

### 2. Board rows accept window drops (`sidebar/boards-section.tsx`)

Each board row `<button>` in `BoardsSection` currently spreads the reorder handlers from `useBoardListReorder`'s `getTileProps`. Compose those with window-drop handling — the two drag species dispatch by MIME so they cannot interfere:

- **`onDragOver`**: if `e.dataTransfer.types.includes("application/x-window-drag")` → `e.preventDefault()`, `e.dataTransfer.dropEffect = "copy"`, and mark this board name as the active drop target (local state) for the highlight. Otherwise fall through to the existing reorder `onDragOver` (which itself gates on `application/x-board-list-reorder`).
- **`onDrop`**: if the window marker type is present → parse the `application/json` payload (`{ server, windowId, name }`), clear the drop-target state, and call `pin(server, windowId, boardName)` from the existing `usePinActions` hook. Otherwise fall through to the reorder `onDrop`.
- **`onDragLeave` / drag end**: clear the drop-target highlight state.

`usePinActions.pin` is reused unchanged, so the drop inherits the full existing pin behavior for free: `POST /api/boards/{board}/pin`, the `Pinned to {board}` toast with the "View board" action, `writeLastPinnedBoard` persistence, and error toasts on failure. No optimistic UI — the SSE echo updates `pinCount` and board contents, exactly as the popover pin path does.

Cross-server works by construction: boards are cross-server, the drag payload carries `server`, and `pin(server, windowId, board)` routes it. The existing cross-server *rejection* in the window-drop handlers applies only to session/window move targets, not to board pins.

**Drop-target affordance**: while a window drag hovers a board row, the row gets a visible drop-target treatment consistent with the existing session drop-target styling (the cross-session move highlight in `session-row.tsx` — background/tint emphasis), so the user sees which board will receive the pin.

### 3. Cursor semantics — link, not move

Pinning **links** the window (dual presence — memory § SESSIONS + BOARDS dual presence): the window stays in its home session and also appears on the board. The drag cursor should say so: board rows set `dropEffect = "copy"` (plus-badge cursor: "adds to board"), which requires widening the window-drag `effectAllowed` from `"move"` to `"copyMove"`. Existing window reorder/move targets keep `dropEffect = "move"`, which remains permitted under `"copyMove"` — no behavior change on those surfaces.

### 4. Already-pinned windows — no frontend special-casing

The backend already defines re-pin semantics (`api/boards.go` `windowExistsOnServer`): a window pinned to another board re-stamps to the new board on pin (a window has exactly one board), and a pin to its current board is a no-op success. The drop handler calls `pin` unconditionally and lets the backend decide — no client-side gating, matching the popover path.

### 5. Out of scope (non-goals)

- **Host page BOARDS zone**: no sidebar (and hence no window-row drag source) exists on `/`, so its board tiles get no drop handling.
- **Zero-board hint mode**: with no board rows there is no drop target; dropping on the hint to create a board stays out (the popover's cold-start `main` prefill covers that flow).
- **Auto-expanding a collapsed BOARDS panel mid-drag**: not included; the panel defaults open once boards exist.
- **Board-page pane area as a drop target**: only the sidebar BOARDS panel rows, per the backlog entry.

### 6. Tests

Unit tests, colocated per project convention (jsdom drag events with a `DataTransfer` stub, as the existing reorder-hook tests do):

- `boards-section.test.tsx`: a dragover carrying `application/x-window-drag` is accepted (preventDefault, copy effect, highlight); drop parses the JSON payload and calls the pin API with `(server, windowId, board)`; a board-list-reorder drag over a board row still reorders and never pins; a window drop does not disturb board order.
- `sidebar/index.test.tsx` (or the relevant existing drag test): window drag start sets the marker MIME and `copyMove`, and existing within-session reorder / cross-session move still function.

No new e2e for the native drag gesture — the existing drag features (board-list reorder, board pane reorder) cover endpoint behavior via e2e and DnD wiring via unit tests; the pin flow itself is already e2e-covered (`boards-pin-flow.spec.ts`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) add drag-to-pin as a fourth row in § Pin Entry Points; extend § Sidebar Boards Section with the window-drop target behavior (marker-MIME gating, copy cursor, drop highlight); note the window-drag marker MIME + `copyMove` widening alongside the existing custom-MIME inventory.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — window `handleDragStart`: add marker MIME, widen `effectAllowed` (~3 lines).
- `app/frontend/src/components/sidebar/boards-section.tsx` — compose window-drop handlers with the reorder tile props; drop-target highlight state; `usePinActions` wiring.
- `app/frontend/src/components/sidebar/boards-section.test.tsx`, `index.test.tsx` — new/extended unit tests.
- No backend, API, route, or state-model changes. No new dependencies.

## Open Questions

- None — all decision points resolved from codebase patterns and memory (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Gate board-row drops on a new dedicated marker MIME `application/x-window-drag` set alongside the existing `application/json` payload | Backlog explicitly says "reuse existing custom-MIME drag-reorder infra"; every drag surface in the codebase uses a dedicated MIME for collision-free gating, and dragover cannot read payload data | S:70 R:85 A:90 D:80 |
| 2 | Certain | Drop invokes existing `usePinActions.pin` unchanged (toast + View-board action + last-used persistence + SSE reconcile); no optimistic UI | Single existing pin mutation path shared by popover and palette; SSE echo already reconciles boards state | S:75 R:85 A:90 D:85 |
| 3 | Confident | No frontend gating for already-pinned windows — backend re-stamp/no-op semantics decide | `api/boards.go` documents the re-pin path explicitly; popover path behaves the same way | S:60 R:80 A:85 D:80 |
| 4 | Confident | Widen window-drag `effectAllowed` to `"copyMove"`; board rows use `dropEffect: "copy"` so the cursor says link-not-move | Pin is a link (dual presence), so a copy cursor is truthful; `"move"` remains permitted under `"copyMove"` for existing targets | S:35 R:85 A:55 D:55 |
| 5 | Confident | Board row shows a drop-target highlight during window-drag hover, mirroring the session cross-move drop-target treatment | Existing affordance vocabulary; purely stylistic and trivially reversible | S:50 R:90 A:80 D:75 |
| 6 | Certain | Scope = sidebar BOARDS panel rows only (no Host BOARDS zone, no zero-board hint drop, no auto-expand of a collapsed panel) | Backlog names the sidebar BOARDS panel; Host page has no sidebar drag source; hint mode has no rows | S:70 R:85 A:85 D:80 |
| 7 | Confident | Unit tests (jsdom drag events) for gating/drop/non-interference; no new e2e for the native gesture | Matches how existing drag surfaces are tested (unit for DnD wiring, e2e for endpoints); pin flow already e2e-covered | S:55 R:85 A:80 D:70 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
