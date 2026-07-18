# Intake: Pin Flow Friction & Boards Discoverability

**Change**: 260718-gxrq-pin-flow-friction-discoverability
**Created**: 2026-07-18

## Origin

Promptless dispatch (defer-and-surface contract) from a synthesized user-discussion scope. The agreed scope, verbatim:

> Title: Make pinning windows to boards easier and boards more discoverable.
>
> Problem: The only pin entry point is the sidebar window-row pin icon (hover-revealed, mouse-only) opening PinPopover (app/frontend/src/components/sidebar/pin-popover.tsx). With zero boards the popover shows ONLY a text input, forcing the user to invent a board name; autofocus always lands in that input so typing feels like the primary path even when boards exist. The sidebar BOARDS panel (app/frontend/src/components/sidebar/boards-section.tsx) is collapsed by default (CollapsiblePanel storageKey "runkit-panel-boards", defaultOpen={false}), hiding boards and the "Pin a window to start a board" hint. There is no keyboard path to pin at all — a Constitution V (keyboard-first) gap.
>
> Agreed scope (three parts, one change):
>
> 1. Pin popover friction:
>    a. Cold start (zero boards): remove forced typing — offer a one-click default, e.g. a primary row "Pin to new board 'main'" or pre-fill the input with "main" (text selected) so bare Enter pins. Default board name agreed: "main". (Exact mechanism — one-click row vs pre-filled input — was left open; pick one and record as an assumption.)
>    b. Last-used board default: order the most recently pinned-to board first in the popover list, and make Enter with an empty input pin to it. Persist last-used board client-side in localStorage with a runkit-* key per existing preference patterns (e.g. runkit-terminal-font-size). No backend persistence (Constitution II, no database; this is a per-client preference).
>
> 2. Boards discoverability — explicitly NOT a rename. Renaming BOARDS to "PINNED WINDOWS" was considered and REJECTED to avoid a vocabulary split ("Board" is load-bearing: /board/$name route, "Board: <name>" canonical page heading per Constitution IV, board switcher, "Board:" palette actions, /api/boards). Instead:
>    a. BOARDS sidebar panel defaults open when boards.length > 0 (or auto-expand once when the first board is created — pick one, record as assumption; respect the user's explicit collapse preference once set).
>    b. Add the shared PinIcon glyph (app/frontend/src/components/pin-icon.tsx) to the BOARDS panel header to visually link the window-row pin icon to where pins land.
>    c. Post-pin feedback: toast "Pinned to <board>" with a "View board" link navigating to /board/<name>. Pin/unpin currently only toast on error (app/frontend/src/hooks/use-pin-actions.ts).
>
> 3. Command-palette pin actions: "Pin: Current Window to <board>" per existing board plus a new-board variant, built as a pure builder in lib/palette-pin.ts per the established palette-builder pattern (see lib/palette-move.ts, lib/palette-update.ts, lib/palette-version.ts). Closes the Constitution V gap and gives the terminal page a pin path (palette actions available on the terminal route for the current window). New palette actions must be registered/documented per the project's code-review rules.
>
> Out of scope (explicitly agreed):
> - Renaming the BOARDS pane/vocabulary.
> - Board-side "+ Add window" picker on /board/$name — deferred to a separate future change.
> - Drag-to-pin (sidebar window row onto board row) — captured in the main backlog as idea [g0t1].
> - The bolder "bookmark-star" semantics (bare pin-icon click pins immediately to last-used board) — considered and rejected in favor of the conservative popover changes above.

**Codebase verification note** (gap analysis at intake time): the "no keyboard path to pin at all" framing is *nearly* accurate — an inline `Board: Pin Current Window` palette action already exists in `app/frontend/src/app.tsx` (~line 1882). It does not pin directly: it dispatches a `pin-popover:open` CustomEvent that the matching sidebar `WindowRow` handles by opening the PinPopover, whose autofocused input then requires typing. So a keyboard-openable path exists, but no direct keyboard *pin* exists. This change's palette-pin builder supersedes that inline action (see What Changes §3).

## Why

1. **The pain point**: Pinning is the sole way boards come into existence, yet the flow is high-friction and invisible. Cold start forces the user to invent a name in a bare text input; when boards exist, autofocus still lands in the type-a-name input rather than surfacing the boards already there; the BOARDS panel ships collapsed so a user may pin a window and never see where it landed; and there is no direct keyboard pin (Constitution V gap — the palette can only open the mouse-centric popover). Successful pins give zero feedback (`usePinActions` toasts only on error), so the loop "pin → where did it go?" stays open.

2. **Consequence of not fixing**: Boards — a core surface (the `/board/$name` route, board switcher, board palette actions all hang off them) — stay underused because the on-ramp is hidden and awkward. The first-run experience actively teaches users that pinning is a typing chore rather than a one-keystroke action.

3. **Why this approach**: Conservative, additive UX changes over vocabulary or interaction-model changes. Renaming BOARDS was rejected (vocabulary split against the load-bearing "Board" term); bookmark-star instant-pin was rejected (surprising destructive-feeling default); drag-to-pin deferred to backlog [g0t1]. What remains is a set of small, independently reversible refinements that reuse existing primitives: the PinPopover, the `runkit-*` localStorage preference pattern, the shared PinIcon glyph, the toast system, and the established pure palette-builder pattern (`lib/palette-move.ts`, `lib/palette-update.ts`, `lib/palette-version.ts`).

## What Changes

Frontend-only. No backend or API changes — `POST /api/boards/{name}/pin` already accepts everything needed, and `ValidBoardName` (mirrored in `app/frontend/src/components/board/board-name.ts`, regex `^[A-Za-z0-9_-]{1,32}$`) accepts the agreed default name `main`.

### 1. Pin popover friction (`app/frontend/src/components/sidebar/pin-popover.tsx`)

**1a. Cold start (zero boards)** — when `boards.length === 0`, pre-fill the input state with `"main"` and select the text on autofocus (`inputRef.current.select()`), so:
- Bare **Enter** immediately pins to a new board `main` (the existing `handleSubmitNew` path — no new submit logic).
- Typing anything replaces the selection, preserving the invent-a-name path unchanged.
- The placeholder path is untouched when boards exist (input stays empty).

Chosen mechanism: **pre-filled selected input**, not a separate one-click row (keyboard-first per Constitution V; smallest diff; the input is already the autofocus target). See Assumption 2.

**1b. Last-used board default**:
- On every **successful** pin (any entry point), persist the board name to localStorage under `runkit-last-pinned-board` (see Assumption 4). Write lives next to the pin mutation so all call sites (popover, palette) update it.
- The popover's board list renders the last-used board **first**, remaining boards in their existing display order (the `boards` prop order from `useBoards`). A stale value (board no longer exists) is ignored — filter against the live `boards` list.
- **Enter with an empty input** pins to the last-used board (and closes the popover) when a valid last-used board exists; otherwise it stays a no-op (current behavior). Note this composes with 1a: at zero boards the input is pre-filled so the empty-Enter branch is unreachable there.
- Surfacing: the last-used row carries a small `↵` hint so Enter's target is visible (see Assumption 8).
- Persistence helper is a small module in `app/frontend/src/lib/` (e.g. `last-pinned-board.ts`: `readLastPinnedBoard()` / `writeLastPinnedBoard(name)`, try/catch around localStorage per existing patterns) so ordering and Enter-target logic are unit-testable.

### 2. Boards discoverability (`app/frontend/src/components/sidebar/boards-section.tsx` + toast/pin-actions seams)

**2a. Default-open when boards exist** — change `defaultOpen={false}` to `defaultOpen={boards.length > 0}` on the `CollapsiblePanel` (storageKey `runkit-panel-boards` unchanged). Mechanics verified: `useLocalStorageBoolean(storageKey, defaultValue)` only consults `defaultValue` when no stored key exists, and its resync effect depends on `defaultValue` — so with no stored preference the panel opens live when the first board appears, and once the user explicitly toggles, the stored value always wins (the "respect the user's explicit collapse preference" requirement falls out of the existing hook for free). Chosen over one-shot auto-expand-on-first-board (needs extra one-shot state; see Assumption 3).

**2b. PinIcon in the BOARDS header** — render the shared `PinIcon` glyph (`app/frontend/src/components/pin-icon.tsx`, outline variant) in the panel header via the existing `headerRight` slot, leading the board count (count rendering today: `<span className="text-xs text-text-secondary">{boards.length}</span>`; the icon should also render in hint mode when the count is absent). Visually links the window-row pin icon to where pins land. No new SVG — reuse only.

**2c. Post-pin success feedback**:
- `app/frontend/src/components/toast.tsx`: extend `ToastEntry`/`addToast` with an optional action — `action?: { label: string; onSelect: () => void }` — rendered as a button inside the toast (keyboard-focusable; `pointer-events-auto` already set on the toast body). Existing two-arg call sites unchanged.
- `app/frontend/src/hooks/use-pin-actions.ts`: on successful `pin`, `addToast("Pinned to <board>", "info")` with action `{ label: "View board", onSelect: () => navigate to /board/<board> }`. The hook runs inside router context, so it can obtain `useNavigate` directly. Placing this in the hook (not per call site) gives every pin entry point the same feedback (see Assumption 6). `unpin` stays error-only.

### 3. Command-palette pin actions (`app/frontend/src/lib/palette-pin.ts` new + `app/frontend/src/app.tsx` wiring)

- New **pure builder** `lib/palette-pin.ts` per the established palette-builder pattern (`palette-move.ts`, `palette-update.ts`, `palette-version.ts`, `palette-view.ts`): a `buildPinActions(...)` taking the board summaries, the set of boards the current window is already pinned to, the last-used board name, and callbacks — returning `PaletteAction[]` (`{ id, label, onSelect }` from `components/command-palette.tsx`):
  - One direct-pin action per existing board the window is **not** already pinned to: `Pin: Current Window to <board>` → calls the pin mutation directly (one keystroke path — Cmd+K, type, Enter; success toast from §2c is the feedback). Boards ordered last-used-first to mirror the popover (see Assumption 5).
  - A new-board variant: `Pin: Current Window to new board…` → opens the PinPopover via the existing `pin-popover:open` CustomEvent (free-text entry needs the popover; the palette has no value input).
- **Supersedes** the inline ad-hoc `board-pin-current` action (`Board: Pin Current Window`, app.tsx ~1882): remove it — its popover-opening role is absorbed by the new-board variant (see Assumption 7). `Board: Unpin Current Window` and `Board: Switch to <name>` are unchanged.
- Wiring: registered in AppShell's `boardActions`/palette composition in `app.tsx`, gated like the existing pin action (`sessionName && currentWindow && server`) — so the actions are available on the terminal route for the current window. The board-route palette mount (`board-page.tsx`) is unchanged. No new keyboard *chord* is added (palette entries only), and the palette registration comment documents the actions per the project code-review rule ("new keyboard shortcuts must be documented in the command palette registration").

### 4. Tests

- Colocated unit tests (Vitest): `pin-popover` cold-start prefill + empty-Enter-to-last-used + ordering; `boards-section` dynamic defaultOpen + header PinIcon; `last-pinned-board` helper; `palette-pin.test.ts` builder (label set, already-pinned exclusion, ordering, new-board variant); `toast` action rendering; `use-pin-actions` success toast + last-used write.
- Playwright e2e: extend `app/frontend/tests/e2e/boards-pin-flow.spec.ts` (cold-start Enter-pins-to-main; post-pin toast with View board link; palette direct pin) — **its sibling `boards-pin-flow.spec.md` MUST be updated in the same commit** (constitution Test Companion Docs).

### Out of scope (explicitly agreed)

- Renaming the BOARDS pane or any "Board" vocabulary.
- Board-side "+ Add window" picker on `/board/$name` (separate future change).
- Drag-to-pin from sidebar window row onto a board row (backlog idea [g0t1]).
- Bookmark-star semantics (bare pin-icon click pins immediately to last-used board) — rejected.
- Changing the window-row pin icon's hover-reveal/mouse behavior.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — pin popover cold-start/last-used behavior, BOARDS panel dynamic default-open + header PinIcon, toast optional-action support, post-pin success feedback, `lib/palette-pin.ts` builder + supersession of the inline `Board: Pin Current Window` action, `runkit-last-pinned-board` preference key.

## Impact

- **Frontend only** (`app/frontend/src/`), no Go backend or API surface changes; no new routes (Constitution IV untouched); no backend persistence (Constitution II — last-used board is a per-client localStorage preference).
- Files modified: `components/sidebar/pin-popover.tsx`, `components/sidebar/boards-section.tsx`, `components/toast.tsx`, `hooks/use-pin-actions.ts`, `app.tsx` (palette wiring, removal of inline pin action).
- Files added: `lib/palette-pin.ts` (+ `lib/palette-pin.test.ts`), `lib/last-pinned-board.ts` (+ test).
- Reused unchanged: `components/pin-icon.tsx`, `api/boards.ts` (`pinWindow`), `components/board/board-name.ts` (`ValidBoardName`), `components/sidebar/collapsible-panel.tsx` (existing `defaultOpen`/`headerRight` props suffice).
- Tests: colocated unit tests + `tests/e2e/boards-pin-flow.spec.ts` / `.spec.md`.
- Constitution touchpoints: V (keyboard-first — direct palette pin closes the gap), IV (no new pages/vocabulary), II (no backend state).

## Open Questions

- None — promptless-defer run; all decision points were either agreed in the discussion or explicitly delegated ("pick one and record as an assumption") and are recorded as graded rows below. No decision scored Unresolved (composite < 20).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Default new-board name is `main` | Discussed — user agreed explicitly; `ValidBoardName` accepts it | S:95 R:90 A:95 D:95 |
| 2 | Confident | Cold-start mechanism = pre-fill the input with `main` (text selected) so bare Enter pins; no separate one-click row | Delegated pick ("pick one, record as assumption"); keyboard-first (Constitution V), smallest diff, reuses existing submit path; rejected alternative: primary row button | S:70 R:85 A:60 D:55 |
| 3 | Confident | Discoverability mechanism = dynamic `defaultOpen={boards.length > 0}` (not one-shot auto-expand on first board) | Delegated pick; `useLocalStorageBoolean` natively supports a dynamic default and stored user toggles always win — auto-expand-once would need extra one-shot state | S:75 R:90 A:80 D:65 |
| 4 | Certain | Last-used board persisted at localStorage key `runkit-last-pinned-board`, client-side only | Agreed pattern (`runkit-*` prefix per existing keys e.g. `runkit-terminal-font-size`, `runkit-update-dismissed`); Constitution II forbids backend persistence | S:85 R:95 A:90 D:85 |
| 5 | Confident | Last-used is written on every successful pin from any entry point; stale values (board gone) are ignored by filtering against live boards; palette per-board entries mirror the popover's last-used-first ordering | Necessary edge-case handling implied by the agreed behavior; single-write-site next to the pin mutation keeps entry points consistent | S:65 R:90 A:80 D:70 |
| 6 | Confident | Success toast implemented inside `usePinActions.pin` (variant `info`) so all pin call sites gain feedback; toast component gains optional `action?: { label, onSelect }` rendered as a button | Agreed feedback ("Pinned to <board>" + "View board" link); hook placement + minimal toast extension are the obvious implementation; existing toast has message-only entries | S:70 R:85 A:75 D:65 |
| 7 | Confident | `lib/palette-pin.ts` per-board actions labeled `Pin: Current Window to <board>` (excluding already-pinned boards) + `Pin: Current Window to new board…` opening the popover via the existing `pin-popover:open` event; the inline `Board: Pin Current Window` action in app.tsx is removed (superseded); `Board: Unpin Current Window` unchanged | Labels per agreed scope text; exclusion mirrors the palette's "show the destination, never the current state" pattern (view actions); keeping both the old opener and the new-board variant would duplicate | S:65 R:90 A:70 D:60 |
| 8 | Confident | Enter-target surfacing = a small `↵` hint on the last-used board row; input placeholder unchanged | Minor visual microdesign, easily reversible; several valid options with this as front-runner | S:50 R:90 A:55 D:45 |
| 9 | Confident | PinIcon placement = BOARDS panel `headerRight`, leading the count (also shown in zero-board hint mode) | Agreed glyph + header; exact slot is implementation detail — `headerRight` is the existing extension point | S:60 R:95 A:70 D:60 |
| 10 | Certain | Scope guards: no BOARDS rename, no board-side "+ Add window" picker, no drag-to-pin (backlog [g0t1]), no bookmark-star instant pin, window-row hover behavior untouched | Discussed — each explicitly rejected or deferred by the user | S:95 R:85 A:95 D:95 |
| 11 | Certain | Tests = colocated Vitest unit tests per changed module + extended `boards-pin-flow.spec.ts` e2e with its `.spec.md` companion updated in the same commit | Constitution (Test Companion Docs) + code-quality.md mandate tests for changed behavior; e2e file already covers the pin flow | S:90 R:90 A:95 D:90 |
| 12 | Confident | Palette pin actions mount in AppShell's existing palette composition gated on `sessionName && currentWindow && server` (terminal/server routes); board-route palette mount unchanged | Mirrors the existing inline pin action's gating; the terminal route is the agreed target surface | S:70 R:85 A:80 D:70 |

12 assumptions (4 certain, 8 confident, 0 tentative, 0 unresolved).
