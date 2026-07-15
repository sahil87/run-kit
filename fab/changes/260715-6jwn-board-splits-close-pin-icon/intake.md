# Intake: Board Splits, Close-Pane ✕, and Pin-Glyph Unpin

**Change**: 260715-6jwn-board-splits-close-pin-icon
**Created**: 2026-07-15

## Origin

Synthesized from a `/fab-discuss` conversation (2026-07-15), dispatched promptless via `/fab-proceed`. The user's request, with decisions confirmed during discussion:

> On the Board page (`/board/$name`), un-hide the top-bar split buttons and make the top-bar ✕ a real close-pane, both acting on the focused board tile's tmux window; and change the per-tile board header's unpin icon from ✕ to a pin/unpin glyph.

User-confirmed decisions from the discussion:

1. **Splits on board**: the two top-bar SplitButtons (currently terminal-only) render on board mode too, wired to the focused tile (`entries[focusedIndex]` provides `{server, windowId}`). Semantics: "split the selected tmux pane on the selected tmux window" — the existing `splitWindow` API already splits relative to the window's active pane.
2. **Top-bar ✕ on board = kill active pane**, uniform with terminal mode. This deliberately reverses the documented decision at `app/frontend/src/components/board/board-page.tsx:657` ("kill stays in the pane's own UI" / misclick concern); the user accepted the misclick tradeoff for cross-mode ✕ consistency. **No confirmation dialog** — consistent with terminal mode's no-confirm kill; the focused-tile ring carries disambiguation.
3. **Unpin lives only in the per-tile header + palette**: the tile header button (`board-header.tsx`) and the palette action "Board: Unpin Focused Pane" remain the unpin affordances.
4. **Per-tile header icon change** (user's explicit addition): the tile header's ✕ glyph misleads (reads as close/kill) — change it to a pin/unpin icon. Keep the no-confirmation behavior (pin is cheap to restore) and the non-draggable button behavior within the draggable header.

Alternatives rejected in discussion: confirmation dialog on board kill (rejected for consistency with terminal mode); keeping the top-bar ✕ as unpin on board (rejected — redundant with tile-header + palette unpin, and inconsistent ✕ semantics across modes).

## Why

1. **Pain point**: Board tiles render a full live tmux window (the relay attaches the PTY directly to the real session with the window selected — `app/backend/api/relay.go:73`+), yet the board top bar offers no pane management: the split buttons are hidden (gated `currentWindow &&` at `top-bar.tsx:638`, and board mode registers `currentWindow: null`), and the ✕ silently changes meaning from "kill pane" (terminal) to "unpin tile" (board). Meanwhile the per-tile header uses a ✕ glyph for unpin, which reads as a destructive close.
2. **Consequence if unfixed**: users working from a board must navigate away to a terminal route just to split or kill a pane; the mode-dependent ✕ is a muscle-memory hazard in both directions (users expecting kill get unpin; the tile-header ✕ looks like kill but is unpin); and Constitution V (keyboard-first) is unmet on board for split/close actions.
3. **Why this approach**: reuse the existing terminal-mode components and API paths verbatim (`SplitButton`, `ClosePaneButton` kill path, `splitWindow`/`closePane` clients → `SplitWindow`/`KillActivePane` in `internal/tmux`) and only rewire what the board slot registers — minimal surface area, uniform semantics across modes, and the unpin affordance stays discoverable in the two places it already lives (tile header, palette) with a truthful icon.

## What Changes

### 1. Top-bar split buttons render on board mode (`app/frontend/src/components/top-bar.tsx`)

Current: both `SplitButton`s (vertical + horizontal) render only inside the `currentWindow && (...)` L1 block (`top-bar.tsx:638-675`), and board mode registers `currentWindow: null` (`board-page.tsx:686`), so splits never render on board.

New behavior:

- Render the two `SplitButton`s on board mode as well, fed by the focused tile. The board page publishes the focused entry through the top-bar slot (`app/frontend/src/contexts/top-bar-slot-context.tsx`), e.g. a new optional field:

  ```ts
  /** Board mode: the focused tile's kill/split target (null when board is empty). */
  focusedPane?: { server: string; windowId: string; cwd?: string } | null;
  ```

  derived in `board-page.tsx` from `entries[focusedIndex]`. `currentWindow` stays `null` (it also gates the ViewSwitcher, window heading, and FixedWidthToggle, which remain terminal-only).
- `SplitButton` is reused verbatim (`top-bar.tsx:1619`): `splitWindow(server, windowId, horizontal, cwd)` (`src/api/client.ts:255`) → `POST /api/windows/{id}/split` → `tmux.SplitWindow` (`app/backend/internal/tmux/tmux.go:1663`, `split-window [-h] [-c cwd] -t <windowId> -d`). Window IDs are server-unique, so targeting a pinned window's ID works even though it lives in a hidden `_rk-pin-*` session. The split lands relative to the window's active pane and appears live inside the tile (the relay renders the whole window).
- **cwd source (corrected from the discussion)**: the discussion proposed looking up the focused window in `ctx.sessionsByServer` to pass `worktreePath`, but pinned windows are physically moved into `_rk-pin-*` sessions that the sessions chokepoint filters out of every user-facing list including the SSE stream (`tmux.go:523` in `parseSessions`; confirmed by the `handleBoardGet` comment at `app/backend/api/boards.go:93-101`) — that lookup would never find a pinned window. Instead use data the board already has: `BoardEntry.panes` (`src/api/boards.ts`) carries per-pane `cwd` + `isActive` from the `getBoard` join. Pass the focused entry's active pane's `cwd` (fallback: first pane's cwd; else omit — `splitWindow` omits `cwd` from the body and tmux uses its default). This matches terminal-mode semantics, where `WindowInfo.worktreePath` is itself derived from the active pane's path.
- `hidden sm:flex` responsive gating is preserved — board splits/✕ follow the same breakpoint behavior as terminal mode (no mobile change).
- **Housekeeping**: update the right-cluster "button pyramid" comment block (260704-9o7k, `top-bar.tsx:616-637`): L1 splits become terminal+board while FixedWidthToggle stays terminal-only; L2's ✕ description changes (see §2). Shared-button screen positions still hold (autofit occupies the analogous slot on board).

### 2. Top-bar ✕ on board = kill the focused tile's active pane (`top-bar.tsx` + `board-page.tsx`)

Current: board mode passes `onUnpin={onCloseFocused}` into `ClosePaneButton` (`top-bar.tsx:701-711`), where `onCloseFocused` → `unpinFocused` (`board-page.tsx:657-664`), label `"Unpin pane from board"`, disabled at zero panes.

New behavior:

- Board mode uses `ClosePaneButton`'s existing kill path (`top-bar.tsx:1693`) with the focused entry's `{server, windowId}` (from the new `focusedPane` slot field): `closePane(server, windowId)` (`client.ts:275`) → `POST /api/windows/{id}/close-pane` → `tmux.KillActivePane` (`tmux.go:1685`, silent-success/idempotent). Label becomes the terminal `"Close pane"`; the optimistic spinner and toast-on-error behavior come for free. Disabled when the board has no focused entry (replaces `closeDisabled`'s zero-pane rule; the `onUnpin` prop and its "no handler → disable" guard comment become dead for board and are removed or repurposed — `ClosePaneButton` may drop `onUnpin` entirely if no other caller remains).
- **No confirmation dialog** (user-confirmed). Replace the rationale comment at `board-page.tsx:657` with one documenting the reversal: uniform ✕ semantics across modes, misclick tradeoff accepted, focused ring disambiguates.
- `unpinFocused` remains only as the palette action "Board: Unpin Focused Pane" (`board-page.tsx:537-544`) and the tile-header button; `onCloseFocused` leaves the slot registration (`board-page.tsx:681-718`).
- **Stale-pin self-heal after a window-killing ✕** (gap found during intake verification): killing the LAST pane of a window kills the window, which collapses its single-window pin-session. No `board-changed` event fires on that path — the event is emitted only by the pin/unpin/reorder handlers (`boards.go:202/237/296`), and the SSE poll loop deliberately does no board-cleanup diff (`sse.go` ~1159-1165). `useBoardEntries` subscribes only to `board-changed` (`use-boards.ts:125-160`), so the dead tile would linger. Therefore the board page must schedule its own entries refetch after a successful board-mode kill (the kill handler or an `onPaneClosed` callback published alongside `focusedPane`). The `getBoard` join already skips vanished pin-sessions (`boards.go:110-113`), so the refetch drops the dead tile; an emptied board disappears from `GET /api/boards` ("empty board cannot exist"), leaving the board route's empty state. A refetch after a non-window-killing pane kill is harmless (entry still resolves).
- Multi-pane tile: the kill removes just the window's active pane; the tile stays pinned and the relay renders the surviving layout live.
- Tiny tiles: tmux may reject a split ("create pane failed: pane too small") — the existing toast-on-error path in `SplitButton` covers it.

### 3. Tile-header unpin icon: ✕ → pin glyph (`app/frontend/src/components/board/board-header.tsx`)

Current: the unpin button renders a text `×` (`board-header.tsx:41-56`).

New behavior: replace the `×` with an inline-SVG pin/unpin glyph (the project uses hand-rolled inline SVGs — see `SplitButton`/`ClosePaneButton`/`HelpLink` — no icon library; a "pin with slash" unpin-style outline at the header's small size). Everything else is preserved: `draggable={false}` (non-draggable within the draggable header), `e.stopPropagation()` on click, `aria-label={`Unpin ... from board`}`, `title="Unpin from board"`, no confirmation dialog. Update the component doc comment (it names "an unpin button ... the ✕ unpin button").

### 4. Board palette actions for split/close (Constitution V) (`board-page.tsx` ~536+)

Add three palette actions alongside the existing board actions, gated like them on `entries.length > 0`, acting on `entries[focusedIndex]`:

- `Board: Split Focused Pane Vertical`
- `Board: Split Focused Pane Horizontal`
- `Board: Close Focused Pane`

Wiring mirrors the terminal palette's split/close actions (`app.tsx:1507-1526` — `useOptimisticAction`-wrapped `splitWindow`/`closePane` with error toasts; board-page already has `addToast`). "Board: Unpin Focused Pane" stays unchanged. Note: the terminal palette maps "Split Vertical" → `horizontal: true` (`app.tsx:1510`) while the top-bar chip labels "Split vertically" → `horizontal: false` — a pre-existing divergence between the two surfaces on main; the board palette mirrors the terminal *palette* mapping for palette-surface consistency, and reconciling the divergence itself is out of scope.

### 5. Tests and companion docs

- **Unit — `top-bar.test.tsx`**: rewrite the `board-mode ✕ = unpin focused pane` describe (~755-796) — the board ✕ now carries `"Close pane"` and calls `closePane(server, windowId)` with the focused entry's values; the disabled-at-zero-panes rule keys on the absent focused entry. Add board-mode assertions that both SplitButtons render and call `splitWindow` with the focused entry's `{server, windowId, cwd}`; keep cockpit/root assertions that splits/✕ stay absent (`:544-547`); FixedWidthToggle stays board-absent.
- **Unit — `command-palette.boards.test.tsx`**: cover the three new board palette actions.
- **E2E — `app/frontend/tests/e2e/board-unpin-focused.spec.ts` + `.spec.md`**: the spec's core assertion (top-bar ✕ has the `Unpin pane from board` name and POSTs `/unpin`) is invalidated. Rework it into: (a) tile-header pin-glyph unpin — click the header unpin button, assert the click-triggered `POST /api/boards/<name>/unpin` and board emptying (same end-state assertions as today); (b) board top-bar ✕ — assert the `Close pane` name and the click-triggered `POST /api/windows/<id>/close-pane`, then the tile disappearing (self-heal refetch) and the board vanishing from the listing. A board-split e2e (click split → pane count in the tile grows) is desirable if stable; the pane-too-small toast path may be asserted where feasible. Update the sibling `.spec.md` in the same commit (Constitution: Test Companion Docs); rename the spec file if its name no longer describes it.
- Playwright mutating-route mocks (if any are added) must carry the trailing `*` glob (`withServer` appends `?server=`).

### Out of scope

- Reconciling the pre-existing top-bar-chip vs palette "vertical/horizontal" flag divergence (§4 note).
- The board waiting-badge join (`board-page.tsx:617-641` joins entries against `ctx.sessionsByServer`, which excludes pin-sessions — its comment claims pinned-window data flows; observed as questionable during verification but untouched by this change).
- Mobile/breakpoint changes — L1/L2 chips stay `hidden sm:flex`.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar right-cluster pyramid (L1 splits become terminal+board; board ✕ = close-pane kill, unpin lives in tile header + palette), board tile-header pin glyph, new board palette actions, board kill self-heal refetch.

## Impact

- **Frontend**: `app/frontend/src/components/top-bar.tsx` (L1/L2 gating, `ClosePaneButton`, pyramid comment), `app/frontend/src/components/board/board-page.tsx` (slot registration, kill handler + refetch, palette actions, rationale comment), `app/frontend/src/components/board/board-header.tsx` (pin glyph), `app/frontend/src/contexts/top-bar-slot-context.tsx` (new `focusedPane` / kill-callback fields), tests (`top-bar.test.tsx`, `command-palette.boards.test.tsx`, `tests/e2e/board-unpin-focused.spec.ts` + `.spec.md`).
- **Backend**: none — `splitWindow`/`closePane` REST paths, `SplitWindow`/`KillActivePane`, and the `getBoard` dead-pin filtering already exist and are reused.
- **APIs**: no new endpoints; new call sites for `POST /api/windows/{id}/split` and `POST /api/windows/{id}/close-pane` from board mode.
- **Risk**: destructive action (pane kill) gains a new surface with no confirm — mitigated by focused-ring disambiguation and tmux-side silent-success idempotency; misclick tradeoff explicitly accepted by the user.

## Open Questions

- None — decisions were confirmed in the originating discussion; remaining choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Board top-bar splits act on the focused tile's window via the existing `splitWindow` API; ViewSwitcher/FixedWidthToggle stay terminal-only | Discussed — user confirmed; mechanics verified in code (split-window targets the window's active pane) | S:90 R:85 A:90 D:90 |
| 2 | Certain | Board top-bar ✕ = kill active pane, no confirmation dialog, uniform with terminal; reverses the documented board-✕-unpin decision | Discussed — user explicitly accepted the misclick tradeoff for cross-mode consistency | S:95 R:70 A:90 D:90 |
| 3 | Certain | Unpin affordances remain only the tile header + "Board: Unpin Focused Pane" palette action | Discussed — user confirmed | S:90 R:85 A:90 D:90 |
| 4 | Certain | Tile-header unpin icon changes ✕ → pin/unpin glyph; keeps no-confirm + non-draggable behavior | Discussed — user's explicit addition | S:90 R:90 A:90 D:85 |
| 5 | Confident | Board split cwd comes from the focused `BoardEntry.panes` active pane's `cwd` (fallback first pane, else omitted) — NOT the discussion's `ctx.sessionsByServer` lookup | Verified in code: pinned windows live in `_rk-pin-*` sessions filtered from every session list incl. SSE (`tmux.go:523`), so the discussed lookup cannot find them; `BoardEntry.panes` already carries cwd+isActive; outcome (same worktreePath semantics) unchanged | S:60 R:85 A:85 D:75 |
| 6 | Confident | Board page schedules its own entries refetch after a successful board-mode kill (stale-tile self-heal) | Verified gap: no `board-changed` fires on kill-collapsed pin-sessions and `useBoardEntries` subscribes only to `board-changed`; frontend refetch is minimal and consistent with the backend's documented no-eager-cleanup stance | S:55 R:80 A:80 D:70 |
| 7 | Confident | Pin glyph is a hand-rolled inline SVG (pin-with-slash style), matching the project's no-icon-library pattern | Codebase signal: all top-bar chips use inline SVGs; trivially reversible styling detail | S:50 R:90 A:75 D:60 |
| 8 | Confident | Board palette labels: "Board: Split Focused Pane Vertical/Horizontal" + "Board: Close Focused Pane", mirroring the terminal palette's `horizontal` mapping; top-bar-vs-palette flag divergence stays out of scope | Follows the existing "Board: …" naming convention and terminal palette wiring; easily renamed | S:40 R:90 A:60 D:45 |
| 9 | Confident | Slot contract: board publishes `focusedPane {server, windowId, cwd}` (+ a kill/refetch seam) via `top-bar-slot-context`; `currentWindow` stays `null` on board | Mirrors the existing `onCloseFocused`/`autofit` slot-field pattern; internal wiring, reversible at apply | S:55 R:85 A:85 D:70 |
| 10 | Certain | Update unit tests, rework `board-unpin-focused.spec.ts` + `.spec.md`, update pyramid/rationale comments in the same change | Constitution (Test Companion Docs) + code-quality rules mandate it; user listed housekeeping explicitly | S:80 R:90 A:90 D:85 |
| 11 | Certain | No mobile/breakpoint changes — board splits/✕ keep the `hidden sm:flex` gating terminal mode uses | Discussed — user stated the constraint; matches existing responsive pattern | S:85 R:90 A:90 D:90 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
