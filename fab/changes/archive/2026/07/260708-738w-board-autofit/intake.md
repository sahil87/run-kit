# Intake: Board Autofit Toggle

**Change**: 260708-738w-board-autofit
**Created**: 2026-07-08

## Origin

One-shot `/fab-new 738w` invocation resolving backlog item `[738w]` (no prior conversation context). The backlog entry is unusually detailed — effectively a mini-spec — and is reproduced verbatim as the raw input:

> Board Autofit toggle — panes auto-resize to fill available screen width, max 4 visible at once, per-board preference. UI: a toggle button in the TopBar board-mode right cluster (src/components/top-bar.tsx, next to the Aa terminal-font control and the unpin ✕) + a Board: Toggle Autofit action in boardRouteActions (src/components/board/board-page.tsx) — Constitution V requires the palette parity. STATE: per-board localStorage key runkit:board-autofit:{board} (mirror the BOARD_WIDTHS_LOCALSTORAGE_PREFIX conventions in src/hooks/use-pane-widths.ts; a small useBoardAutofit hook with the same read/write guards is fine). BEHAVIOR (desktop DesktopRow only — the mobile carousel is already one full-width pane, no-op there): autofit ON → stop passing the explicit pixel width from usePaneWidths to BoardPane and lay panes out with flex: 1 1 0 and min-width: max(280px, 25%) inside the existing overflow-x-auto row. Result: with 4 or fewer panes they stretch to share the full row width equally and reflow live on window resize; with more than 4 each pane floors at 25% of the scrollport (or BOARD_PANE_MIN_WIDTH 280px if that is larger — narrow screens) and the row scrolls past 4 exactly as today. Prefer this pure-CSS approach (no ResizeObserver on the row); VERIFY the percentage min-width resolves against the scrollport width for flex items in the horizontal-scroll container — if it resolves against scrolled content width instead, fall back to measuring container width in JS and computing pixel widths. Autofit OFF → exactly current behavior (per-pane widths from usePaneWidths). Resize handles: pass showResizeHandle={false} while autofit is on; stored per-pane widths are NOT modified, so toggling autofit off restores the hand-tuned layout. VERIFY xterm refits when pane size changes via flex reflow rather than the width prop (check the fit/resize handling in src/components/terminal-client.tsx — window resize with autofit on must refit all visible panes). NOTE: the plaintext-origin relay cap MAX_LIVE_RELAY_PANES=4 (board-page.tsx) aligns exactly with the 4-visible max, so autofit never forces a visible-but-paused pane in dev; the focused pane is exempt from the cap anyway. TESTS: unit-test the autofit persistence hook + any width-derivation helper; Playwright e2e with companion .spec.md (constitution Test Companion Docs): toggle on with 2-3 panes → equal widths filling the row, no horizontal scrollbar; 5+ panes → 25% floor + horizontal scroll; per-board persistence across reload (board A on, board B off); handles hidden while on and hand-tuned widths restored when toggled off; run via just test-e2e / just pw only. ACCEPTANCE: top-bar toggle and palette action both flip autofit; preference persists per board; no regression to manual drag-resize, Cmd+]/Cmd+[ focus cycling, the IntersectionObserver relay suspension, or the mobile carousel. RELATED: [rmiq] board pane reorder — independent features, ship reorder FIRST; equal-width autofit panes make DnD insert-before targeting cleaner.

Both `VERIFY` items in the entry were resolved during intake by reading the current code — see Assumptions #2 and #4. The `RELATED` ordering constraint ([rmiq] ships first) is already satisfied on this branch — see Assumption #11.

## Why

1. **Pain point**: On a desktop board, every pane renders at an explicit pixel width (default `BOARD_PANE_DEFAULT_WIDTH = 480px`, or a hand-dragged value persisted per pane). With 2–3 panes on a wide monitor this leaves a large dead strip of unused row width; the only remedy is manually dragging each pane's resize handle, and the result does not adapt when the window resizes or a pane is pinned/unpinned.
2. **Consequence of not fixing**: Boards — the multi-agent monitoring surface — chronically under-use screen width, and users repeat manual width fiddling per board and per layout change. The upcoming reorder workflow ([rmiq], already shipped) makes pane sets churn more, amplifying the fiddling.
3. **Why this approach**: A per-board autofit toggle is the minimal-surface answer (Constitution IV — no settings page, one button + one palette action). The pure-CSS flex layout (`flex: 1 1 0` + a min-width floor) delivers live reflow on window resize for free, avoids a ResizeObserver on the row, and degrades exactly to today's horizontal-scroll behavior past 4 panes. Preserving (not overwriting) the stored per-pane widths makes the toggle non-destructive: hand-tuned layouts survive an autofit round-trip.

## What Changes

### 1. Persistence: `useBoardAutofit` hook (new)

New hook file `app/frontend/src/hooks/use-board-autofit.ts`, mirroring the conventions of `use-pane-widths.ts`:

- Exported key prefix constant: `BOARD_AUTOFIT_LOCALSTORAGE_PREFIX = "runkit:board-autofit:"`; full key `runkit:board-autofit:{board}`.
- Same guard discipline as `readMap`/`writeMap` in `use-pane-widths.ts`: `typeof window === "undefined"` bail, `try/catch` around `localStorage` read/write, tolerant of malformed values (anything but the stored "on" sentinel reads as off).
- API shape: `useBoardAutofit(board: string)` → `{ autofit: boolean, toggleAutofit: () => void }` (setter persists; state reloads when `board` changes, mirroring the `useEffect`-on-`board` reload in `usePaneWidths`).
- Default when no key is stored: **off** (current behavior).

### 2. Layout: `DesktopRow` autofit branch (`board-page.tsx`)

Desktop only — `MobileCarousel` is untouched (already one full-width pane via CSS `w-full`; autofit is a no-op there).

- Autofit **ON**: stop passing the explicit pixel `width` from `usePaneWidths.getWidth` to `BoardPane`; instead the pane root (the direct flex child of the existing `overflow-x-auto flex gap-1 p-1` row) gets `flex: 1 1 0` and `min-width: max(280px, calc(25% - 3px))`.
  - The floor is gap-adjusted from the backlog's literal `max(280px, 25%)`: the row has 4px gaps (`gap-1`), so at exactly 4 panes a literal 25% floor forces `4×25% + 3×4px > 100%` — a 12px horizontal scrollbar, contradicting the "max 4 visible at once" intent. `calc(25% - 3px)` (3 gaps × 4px ÷ 4 panes) makes exactly 4 panes fit flush. The 280px arm is `BOARD_PANE_MIN_WIDTH` (import the existing constant, don't hard-code).
  - Result: ≤4 panes stretch to share the full row width equally and reflow live on window resize; >4 panes floor at ~25% of the scrollport (or 280px if larger — narrow screens) and the row scrolls exactly as today.
  - Pure CSS — no ResizeObserver on the row. **Verified** (backlog VERIFY #1): a flex item's percentage `min-width` resolves against the flex container's content box (the scrollport), not the scrolled content width — the containing block of a flex item is its flex container's content box, and `overflow-x: auto` does not change that. The JS-measurement fallback described in the backlog is therefore not needed; the e2e asserts the resulting widths as a safety net.
- Autofit **OFF**: exactly current behavior — explicit per-pane pixel widths from `usePaneWidths`.
- Resize handles: `showResizeHandle={false}` while autofit is on (`onResizeStart` not wired). Stored per-pane widths in `runkit:board-widths:{board}` are **never modified** by autofit; toggling off restores the hand-tuned layout.
- `BoardPane` (`board-pane.tsx`) already treats `width` as optional (omitted → CSS-driven `w-full`, used by the mobile carousel). It needs a way to carry the autofit flex sizing on its root element instead of `w-full` — a small sizing extension (e.g. an `autofit` prop selecting the flex classes), decided at plan time following the existing optional-`width` pattern.

### 3. UI: top-bar toggle + palette action

- **Top-bar button** (`top-bar.tsx`): a board-mode toggle in the right-cluster L2 area, next to the `Aa` `TerminalFontControl` and the unpin `✕` `ClosePaneButton`. Board-only (unlike Aa/✕ which are `terminal || board`). Follows the `FixedWidthToggle` pattern (the analogous width-behavior toggle in the same pyramid): pressed/aria-pressed state reflecting `autofit`, CRT-glint hover vocabulary, `coarse:` touch sizing per the existing cluster conventions.
- **State plumbing**: `BoardPage` owns the `useBoardAutofit` instance and publishes `autofit` + `toggleAutofit` into the top-bar slot context (`useRegisterTopBarSlot` at `board-page.tsx:564`), the same channel that carries `onCloseFocused`/`closeDisabled` today; `top-bar.tsx` consumes them as new optional board-mode slot fields (tolerant-empty defaults like the existing fields).
- **Palette action** (`boardRouteActions` memo in `board-page.tsx`): `Board: Toggle Autofit` → `toggleAutofit`. Constitution V palette parity — both the button and the action flip the same state.

### 4. Relay-suspension interaction (no code change — alignment note)

`MAX_LIVE_RELAY_PANES = 4` (`board-page.tsx:54`) equals the 4-visible max that the 25% floor produces, so on plaintext origins autofit never forces a visible-but-paused pane; the focused pane is exempt from the cap anyway (`selectLivePanes`). The IntersectionObserver suspension keeps working unchanged — with autofit on, >4 panes still overflow horizontally and off-screen panes still suspend.

### 5. xterm refit (no new wiring — verified)

Backlog VERIFY #2, resolved: `terminal-client.tsx` mounts a `ResizeObserver` on the terminal container (`terminal-client.tsx:337`) that rAF-debounces `fitAddon.fit()` and pairs every fit with a `{type: "resize", cols, rows}` WS message to the backend. Flex reflow (window resize, pane pinned/unpinned, toggle flips) changes each pane container's size and fires that observer per pane — all visible panes refit with no autofit-specific code.

### 6. Tests

- **Unit** (Vitest, colocated): `use-board-autofit.test.ts` — persistence round-trip, per-board key isolation, malformed-value tolerance, board-switch reload; plus any width-derivation helper if one is extracted.
- **E2E** (Playwright, `app/frontend/tests/`, run via `just test-e2e` / `just pw` only — never direct): new spec with companion `.spec.md` (constitution Test Companion Docs), covering:
  1. Toggle on with 2–3 panes → equal widths filling the row, no horizontal scrollbar.
  2. 5+ panes → ~25% floor + horizontal scroll.
  3. Per-board persistence across reload (board A on, board B off).
  4. Handles hidden while on; hand-tuned widths restored when toggled off.
  5. Both the top-bar button and the palette action flip the state.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add the board autofit toggle to the board-UI patterns — per-board localStorage preference, DesktopRow flex layout branch, top-bar board-cluster button + palette parity, non-destructive interaction with stored pane widths.

## Impact

Frontend-only; no backend, no API, no new routes (Constitution IV).

- `app/frontend/src/hooks/use-board-autofit.ts` (new) + `use-board-autofit.test.ts` (new)
- `app/frontend/src/components/board/board-page.tsx` — `DesktopRow` layout branch, `boardRouteActions` entry, slot registration, `usePaneWidths` wiring
- `app/frontend/src/components/board/board-pane.tsx` — sizing extension for the autofit flex classes
- `app/frontend/src/components/top-bar.tsx` — board-mode toggle button in the right cluster
- `app/frontend/src/contexts/top-bar-slot-context.tsx` — new optional board-mode slot fields
- `app/frontend/tests/board-autofit.spec.ts` (new) + `board-autofit.spec.md` (new)

Regression surface (explicit acceptance): manual drag-resize (autofit off), `Cmd+]`/`Cmd+[` focus cycling, IntersectionObserver relay suspension, mobile carousel.

## Open Questions

None — the backlog entry pre-resolved the design, and both VERIFY items were settled by code inspection during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Per-board persistence via localStorage key `runkit:board-autofit:{board}` in a new `useBoardAutofit` hook with `use-pane-widths.ts`-style guards | Explicit in backlog, exact key format given; conventions verified in `use-pane-widths.ts` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Pure-CSS flex layout (`flex: 1 1 0` + min-width floor), no ResizeObserver on the row; JS-measurement fallback not needed | Backlog's preferred approach; its VERIFY resolved — percentage `min-width` on a flex item resolves against the flex container's content box (scrollport), not scrolled content width; e2e asserts widths as safety net | S:85 R:85 A:90 D:85 |
| 3 | Confident | Floor is gap-adjusted: `min-width: max(280px, calc(25% - 3px))` rather than the literal `max(280px, 25%)` | Row has `gap-1` (4px × 3 gaps); literal 25% forces a 12px scrollbar at exactly 4 panes, contradicting the stated "max 4 visible" behavior — adjusted value honors intent over letter | S:70 R:90 A:85 D:60 |
| 4 | Certain | No autofit-specific xterm refit wiring needed | Backlog VERIFY resolved in code: `terminal-client.tsx:337` ResizeObserver on the terminal container rAF-debounces `fit()` + paired resize WS message; flex reflow fires it per pane | S:90 R:85 A:95 D:90 |
| 5 | Certain | Autofit applies to desktop `DesktopRow` only; `MobileCarousel` untouched | Explicit in backlog; verified — carousel panes already omit `width` and use CSS `w-full` | S:95 R:90 A:95 D:95 |
| 6 | Certain | `showResizeHandle={false}` while on; stored `runkit:board-widths:{board}` values never modified, so toggling off restores hand-tuned layout | Explicit in backlog; matches non-destructive-toggle intent | S:95 R:90 A:95 D:90 |
| 7 | Certain | Default is OFF when no preference is stored (opt-in per board) | "Autofit OFF → exactly current behavior" + per-board preference framing imply opt-in; absence of key = today's layout | S:65 R:95 A:85 D:85 |
| 8 | Confident | `BoardPane` grows a small sizing extension (e.g. an `autofit` prop selecting flex classes on the pane root) instead of a wrapper div | Pane root is the row's direct flex child; follows the existing optional-`width` pattern (`board-pane.tsx:15-22`); exact prop shape decided at plan time | S:70 R:85 A:80 D:70 |
| 9 | Confident | Toggle button mirrors the `FixedWidthToggle` pattern; board-only in the L2 cluster area; state plumbed through the top-bar slot context like `onCloseFocused` | Placement explicit in backlog ("next to Aa and ✕"); visual/wiring pattern inferred from the analogous width-toggle and the existing board-mode slot fields | S:60 R:95 A:80 D:70 |
| 10 | Certain | No relay-cap change: `MAX_LIVE_RELAY_PANES = 4` already aligns with the 4-visible max; focused pane exempt | Verified at `board-page.tsx:54` and `selectLivePanes`; backlog NOTE confirms alignment is intentional | S:90 R:85 A:95 D:90 |
| 11 | Certain | [rmiq] ship-first ordering already satisfied — no sequencing work in this change | Verified: `useBoardPaneReorder` present in `DesktopRow` (commit 8926f50 cherry-picked reorder onto this branch) | S:85 R:80 A:95 D:90 |
| 12 | Certain | Test plan: unit tests for the hook + Playwright e2e with companion `.spec.md`, run via `just test-e2e`/`just pw` only | Explicit in backlog; constitution Test Companion Docs mandates the `.spec.md`; project context mandates just-recipe isolation (port 3020) | S:95 R:90 A:95 D:95 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
