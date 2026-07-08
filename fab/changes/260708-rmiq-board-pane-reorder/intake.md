# Intake: Board Pane Reorder UI

**Change**: 260708-rmiq-board-pane-reorder
**Created**: 2026-07-08

## Origin

Invoked via `/fab-new rmiq` — backlog item `[rmiq]` in `fab/backlog.md` (dated 2026-07-08), one-shot with no prior conversation. The backlog entry is unusually prescriptive (it encodes the full design); every code claim in it was verified against the source tree at intake time. Raw backlog input:

> Board pane reorder UI — drag-and-drop + Cmd+K Move Left/Right on /board/$name. The backend half is ALREADY SHIPPED with zero frontend callers: POST /api/boards/{name}/reorder computes fractional-index orderKeys (app/backend/api/boards.go lookupOrderKey), GET /api/boards/{name} returns entries sorted by orderKey, and reorder broadcasts a board-changed SSE event that useBoardEntries already refetches on with a 50ms debounce (src/hooks/use-boards.ts); the frontend has reorderPin (src/api/boards.ts) and a toast-wrapped usePinActions().reorder (src/hooks/use-pin-actions.ts) — both currently UNUSED. SCOPE: pure frontend wiring in the desktop board row (DesktopRow in src/components/board/board-page.tsx). DND: adapt the useServerReorder pattern (src/hooks/use-server-reorder.ts) — custom MIME application/x-board-pane-reorder (must not collide with application/x-server-reorder, application/x-session-reorder, or the window-move default-JSON payload), insert-before splice preview via a derive-over-store transient override (a ref, not state) cleared by a render-time equality reconcile against the authoritative entries (NO whole-array watcher effect, NO snap-back on drag-end), and keep the self-target dragover acceptance fix: preventDefault BEFORE the self-target bail, guarding MIME first — otherwise HTML5 DnD plays the native cancelled-drag snap-back ghost. Drag handle = the pane HEADER only (src/components/board/board-pane.tsx), NOT the whole pane — a live terminal must not hijack drags or become the drag image. On drop fire ONE reorderPin POST with before/after = the moved pane new neighbors windowIds (JSON null for prepend/append) — fractional indexing means one call per moved item, unlike server-reorder debounced full-order writes; the board-changed SSE echo reconciles the override. CMD+K: add Board: Move Focused Pane Left / Right to boardRouteActions (board-page.tsx), boundary-gated with no wraparound exactly like computeMoveOrder (src/lib/palette-move.ts); act on focusedIndex, compute before/after from current entries, and optimistically setFocusedIndex(i +/- 1) so focus follows the moved pane (focusedIndex is positional state near board-page.tsx:185). Nice-to-have: track focus by server:windowId key instead of index so focus also survives reorders arriving from another client. Mobile carousel: out of scope (swipe is navigation there). TESTS: unit-test the before/after neighbor computation + palette boundary gating (mirror palette-move.test.ts); Playwright e2e for drag reorder + palette move with a companion .spec.md (constitution Test Companion Docs); run via just test-e2e / just pw only, never raw playwright. ACCEPTANCE: dragging a pane header reorders with instant optimistic preview and the order persists across reload (server orderKey is authoritative); Cmd+K Move Left/Right moves the focused pane and keeps it focused, hidden/no-op at boundaries; cross-server boards work (reorder carries server + windowId); no regression to Cmd+]/Cmd+[ focus cycling, pane drag-resize, or unpin. CONSTITUTION: V keyboard-first (palette parity mandatory), IX POST-only (already satisfied by the existing endpoint). RELATED: board autofit backlog (see next entry) — independent features; ship reorder FIRST.

## Why

1. **The pain point**: Panes on `/board/$name` render in server `orderKey` order, but no UI exists to change that order — users are stuck with pin order. The entire backend half of reorder is already shipped and dark: `POST /api/boards/{name}/reorder` (fractional-index `lookupOrderKey`, `app/backend/api/boards.go:306`), sorted `GET /api/boards/{name}` (`boards.go:94`), a `board-changed` SSE broadcast (`boards.go:258`), the `reorderPin` API client (`src/api/boards.ts:100`), and a toast-wrapped `usePinActions().reorder` (`src/hooks/use-pin-actions.ts:47`). All verified at intake time — the only non-definition callers of `reorderPin` are its own unit tests (`src/api/boards.test.ts`).
2. **Consequence of not fixing**: shipped backend surface stays dead code, and boards — a primary Cockpit surface — remain unarrangeable. The related autofit backlog item (`[738w]`) explicitly sequences after this ("ship reorder FIRST"), so this blocks that too.
3. **Why this approach**: adapting the proven `useServerReorder` pattern (`src/hooks/use-server-reorder.ts`) inherits two hard-won fixes — the derive-over-store transient override (no watcher-effect churn, no drag-end snap-back) and the self-target dragover acceptance ordering (no native cancelled-drag ghost animation). Fractional indexing means one `reorderPin` POST per move (before/after neighbors), simpler than server-reorder's debounced full-order writes. Palette parity is mandated by Constitution V (keyboard-first); Constitution IX (POST-only) is already satisfied by the existing endpoint.

## What Changes

### 1. Drag-and-drop reorder in the desktop board row

All in `DesktopRow` (`src/components/board/board-page.tsx:702`) plus a drag handle in the pane header. Adapt the `useServerReorder` pattern — likely as a new sibling hook (e.g. `src/hooks/use-board-pane-reorder.ts`):

- **MIME**: custom `application/x-board-pane-reorder`. Must not collide with `application/x-server-reorder` (`use-server-reorder.ts:10`), `application/x-session-reorder` (`sidebar/index.tsx:661`), or the window-move default-JSON payload. Guard MIME **before** any acceptance.
- **Drag handle = pane header only** (`BoardHeader`, rendered at `src/components/board/board-pane.tsx:118`) — NOT the whole pane. A live xterm terminal must not hijack drags or become the drag image.
- **Optimistic preview**: insert-before splice preview via a **derive-over-store transient override** — a ref, not React state — cleared by a **render-time equality reconcile** against the authoritative `entries`. NO whole-array watcher effect; NO snap-back on drag-end. (Same discipline as the sidebar session-order derive, PR #240.)
- **Self-target dragover acceptance fix**: call `preventDefault()` BEFORE the self-target bail, with the MIME guard first — otherwise HTML5 DnD plays the native cancelled-drag snap-back ghost. This fix already lives in `useServerReorder` and the sidebar session-reorder handler; keep it.
- **Drop**: fire exactly ONE `reorderPin(server, windowId, board, before, after)` POST where `before`/`after` are the moved pane's **new neighbors' windowIds** (JSON `null` for prepend/append — the client already encodes this, see `src/api/boards.test.ts:95`). No debounce needed — fractional indexing is one call per moved item. The `board-changed` SSE echo (refetched by `useBoardEntries` with a 50ms debounce, `src/hooks/use-boards.ts`) reconciles the override away.
- **Cross-server boards**: the drag payload and the POST carry both `server` and `windowId` (a board spans servers; `windowId` alone is ambiguous).

### 2. Command palette: Move Focused Pane Left / Right

Add `Board: Move Focused Pane Left` and `Board: Move Focused Pane Right` to `boardRouteActions` (`src/components/board/board-page.tsx:303`):

- **Boundary-gated, no wraparound** — exactly like `computeMoveOrder` (`src/lib/palette-move.ts:39`): the action is hidden (not shown disabled) when the focused pane is already at that edge.
- Act on `focusedIndex` (positional state, `board-page.tsx:186`); compute `before`/`after` from the current `entries` and call the same single-POST path as DnD.
- **Optimistic focus-follow**: `setFocusedIndex(i ± 1)` immediately, so focus follows the moved pane through the SSE round-trip.
- Nice-to-have (only if it falls out cheaply): track focus by `server:windowId` key instead of index so focus also survives reorders arriving from **another** client. Not required for acceptance. <!-- assumed: nice-to-have deferred unless trivial — backlog labels it explicitly as nice-to-have -->

### 3. Tests

- **Unit**: the before/after neighbor computation and the palette boundary gating (mirror `src/lib/palette-move.test.ts`). If the DnD logic is extracted to a hook, unit-test it like `use-server-reorder.test.ts` (which shows the `makeDataTransfer` MIME-guard testing pattern).
- **Playwright e2e**: drag reorder + palette move, with a companion `.spec.md` (constitution Test Companion Docs). Direct precedent to mirror: `app/frontend/tests/e2e/server-reorder.spec.ts` + `.spec.md` and `session-reorder.spec.ts` + `.spec.md`.
- **Runners**: `just test-e2e` / `just pw` only — never raw `playwright` (port-isolation: 3020 + isolated tmux server).

### Out of scope

- **Mobile carousel**: no reorder there — swipe is navigation on that surface.
- **Backend**: zero changes; the endpoint, sorting, and SSE broadcast are shipped.
- **Board autofit** (`[738w]`): related but independent; explicitly sequenced after this change.

### Acceptance (from backlog, verbatim intent)

- Dragging a pane header reorders with instant optimistic preview; the order persists across reload (server `orderKey` is authoritative).
- Cmd+K Move Left/Right moves the focused pane and keeps it focused; hidden/no-op at boundaries.
- Cross-server boards work (reorder carries `server` + `windowId`).
- No regression to `Cmd+]`/`Cmd+[` focus cycling, pane drag-resize, or unpin.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — extend the board/reorder pattern coverage with board pane reorder: header-only drag handle, `application/x-board-pane-reorder` MIME, single-POST fractional-index reorder (vs server-reorder's debounced full-order writes), palette Move Left/Right parity.

## Impact

- `src/components/board/board-page.tsx` — `DesktopRow` DnD wiring, `boardRouteActions` two new actions, `focusedIndex` optimistic bump.
- `src/components/board/board-pane.tsx` / `board-header.tsx` — header becomes the drag handle (draggable + drag-start payload).
- New hook likely at `src/hooks/use-board-pane-reorder.ts` (+ unit test), adapted from `use-server-reorder.ts`; possibly a small pure helper for neighbor computation (+ unit test mirroring `palette-move.test.ts`).
- Consumes existing, currently-unused plumbing: `reorderPin` (`src/api/boards.ts`), `usePinActions().reorder` (`src/hooks/use-pin-actions.ts`), `useBoardEntries` SSE refetch (`src/hooks/use-boards.ts`).
- New e2e spec + `.spec.md` under `app/frontend/tests/e2e/`.
- No backend changes, no new routes, no new dependencies.

## Open Questions

*(none — the backlog entry resolves every design decision; all code claims verified at intake time)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is pure frontend wiring — backend endpoint, orderKey sort, SSE broadcast, API client, and toast-wrapped hook all shipped and unused | Backlog explicit; every claim verified in source at intake (only callers of `reorderPin` are its own tests) | S:95 R:90 A:100 D:95 |
| 2 | Certain | DnD adapts the `useServerReorder` pattern: custom MIME `application/x-board-pane-reorder`, ref-based derive-over-store splice preview, render-time equality reconcile, no watcher effect, no drag-end snap-back, preventDefault-before-self-bail with MIME guard first | Backlog prescribes verbatim; pattern + both fixes exist in `use-server-reorder.ts` and sidebar handler | S:100 R:75 A:95 D:95 |
| 3 | Certain | Drag handle is the pane header (`BoardHeader`) only, never the whole pane | Backlog explicit with rationale (live terminal must not hijack drags or become drag image) | S:100 R:85 A:95 D:95 |
| 4 | Certain | Drop and palette move each fire exactly ONE `reorderPin` POST with before/after = new neighbors' windowIds (JSON null at edges); SSE echo reconciles the override | Backlog explicit; fractional-index endpoint semantics + null encoding verified in `boards.test.ts` | S:100 R:85 A:95 D:90 |
| 5 | Certain | Palette actions `Board: Move Focused Pane Left/Right` are boundary-gated with no wraparound (hidden at edges) like `computeMoveOrder`, act on `focusedIndex`, and optimistically `setFocusedIndex(i±1)` | Backlog explicit; `palette-move.ts` precedent is boundary-hidden | S:100 R:90 A:95 D:95 |
| 6 | Certain | Mobile carousel is out of scope (swipe is navigation there); backend untouched; autofit ships separately after | Backlog explicit on all three | S:100 R:95 A:90 D:100 |
| 7 | Certain | Tests = unit (neighbor computation + palette gating, mirroring `palette-move.test.ts`) + Playwright e2e with companion `.spec.md`, run via `just test-e2e`/`just pw` only | Backlog + constitution Test Companion Docs; e2e precedent exists (`server-reorder.spec.ts`, `session-reorder.spec.ts`) | S:100 R:90 A:95 D:95 |
| 8 | Certain | E2e drag simulation mirrors the existing `server-reorder`/`session-reorder` e2e specs | Direct in-repo precedent found for the same HTML5-DnD reorder shape | S:75 R:90 A:90 D:85 |
| 9 | Confident | Focus-tracking by `server:windowId` key (cross-client focus survival) is deferred unless it falls out cheaply — required behavior is the optimistic index bump | Backlog labels it "nice-to-have"; clear front-runner is defer, revisit at apply | S:80 R:90 A:70 D:65 |
| 10 | Confident | DnD state extracted to a dedicated hook (e.g. `src/hooks/use-board-pane-reorder.ts`) rather than inlined in `board-page.tsx` | Backlog says "adapt the useServerReorder pattern" without mandating file layout; repo convention (sibling hook + colocated test) is the front-runner | S:70 R:90 A:80 D:70 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
