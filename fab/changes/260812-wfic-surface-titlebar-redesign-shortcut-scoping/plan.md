# Plan: Surface Tile Title-Bar Redesign + tty-Scoped tmux Shortcuts

**Change**: 260812-wfic-surface-titlebar-redesign-shortcut-scoping
**Intake**: `intake.md`

## Requirements

### Surface Layout: Framed tile chrome

#### R1: Framed tile grid
The desktop tile grid SHALL render tiles as framed cards: the grid container gets `gap-[3px]` and `bg-bg-inset`; each tile gets `border border-border rounded` (keeping `overflow-hidden`). Divider drag mechanics MUST stay unchanged — the absolutely-positioned dividers keep their ratio-boundary placement and 6px hit zones (which cover the 3px gutter), and hover/drag still floods `bg-accent-green`.

- **GIVEN** a 2-tile `split-h` layout on desktop
- **WHEN** the grid renders
- **THEN** a 3px inset-colored gutter visually separates the tiles, each tile shows a 1px border, **AND** dragging the divider still resizes ratios exactly as before (persisted per (window, shape) on release)

#### R2: Focused-tile state with accent highlight
A focused-tile notion SHALL exist: the tile that last received pointer/keyboard interaction. The focused tile's border and kind glyph turn `accent-green` (the tmux active-pane metaphor). Ownership: `SurfaceLayout` owns the focused **slot** as transient component state (the zoom precedent — per-window reset comes free from the `${server}:${windowId}` key) and reports the focused **kind** upward via an `onFocusedKindChange` callback; `app.tsx` mirrors it for the shortcut gate (R8) and palette (R10), and can set focus via a registered ref seam (the `zoomToggleRef` pattern). Default focused slot = slot A; when the focused tile closes (or the layout no longer has that slot), focus falls back to slot A. At arity 1 the highlight is suppressed (no verbs, no highlight — the existing `single` rule).

Focus-assignment seams: `pointerdown` (capture) anywhere in a tile; `focusin` on the tile (clicking into an iframe focuses the iframe element in the parent document); and for the code tile, the `CodeSurface` capture-phase iframe listener reports interaction (keydown/pointerdown inside the contentDocument) via a new optional callback so editor interaction counts as focus.

- **GIVEN** a `split-h:tty,code` layout with the tty tile focused
- **WHEN** the user clicks into the code tile (header or editor content)
- **THEN** the code tile's border and `{}` glyph turn accent-green, the tty tile's revert to default, **AND** `app.tsx`'s mirror reports `code`
- **GIVEN** the focused code tile is closed via its ✕ verb
- **WHEN** the layout collapses to `single:tty`
- **THEN** focus falls back to slot A and no highlight renders (arity 1)

#### R3: Header chrome
Each tile header SHALL become 30px tall (`h-[30px]`), 11px font, on `bg-bg-card` (distinct from content `bg-bg-primary`), keeping `border-b border-border`. A kind glyph from the shared `SURFACE_GLYPH` map (`lib/surface-layout.ts` — `>_` tty, `◫` web, `⌸` chat, `{}` code) precedes the label. The meta text (`tileMeta` — git-root basename for code, `@rk_url` host for web) moves into an inset chip: `bg-bg-inset rounded px-1.5`, 10px, truncating, clearly subordinate to the label. Mobile (R13) renders no header chrome — unchanged.

- **GIVEN** a code tile for a window with `gitRoot=/a/b/lucid-kite`
- **WHEN** the header renders on desktop
- **THEN** it shows `{}` glyph + `Code` label + a `lucid-kite` inset chip in a 30px `bg-bg-card` bar
- **GIVEN** a narrow tile
- **WHEN** the meta chip overflows
- **THEN** the chip truncates with ellipsis and the verbs stay fully visible

#### R4: Verb buttons — boxed, rest-visible
Verb buttons SHALL become fixed-size boxed buttons: 22×22px (26×26 on coarse pointers via the `coarse:` variant), **visible at rest** at ~65% opacity (replacing `opacity-0 group-hover:opacity-100`), hover giving `bg-bg-inset` + full opacity. The close (✕) button's hover turns `text-signal-red`; a 1px hairline rule (border-color) separates ✕ from the safe verbs. The existing `Tip` wrappers and aria-labels are kept. `single` layouts still render no verbs.

- **GIVEN** a 2-tile layout at rest (no hover)
- **WHEN** the header renders
- **THEN** all verb buttons are visible (reduced opacity), each with a ≥22×22 hit target
- **GIVEN** the pointer hovers the ✕ button
- **THEN** it shows `text-signal-red` and an inset background

#### R5: Zoom-state feedback
The zoom glyph SHALL become ⛶ and stay `accent-green` while that tile is zoomed (tooltip/aria already flip Zoom/Unzoom — keep). While a tile is zoomed, its promote (◧) and swap (⇄) verbs SHALL be hidden (they are no-ops on a zoomed render); ✕ stays.

- **GIVEN** a 2-tile layout
- **WHEN** the user zooms the code tile
- **THEN** the code header shows an accent-green ⛶, its ◧/⇄ verbs are hidden, and clicking ⛶ again restores the grid and default glyph color

#### R6: tty header status dot
The tty tile header SHALL show the agent-state dot by reusing the existing `StatusDot` component (`components/status-dot.tsx`, `win: WindowInfo`). `app.tsx` passes the current `WindowInfo` (`currentWindow`) to `SurfaceLayout` as a new optional prop consumed only by tty headers. No new backend/SSE plumbing. Non-tty headers render no dot; a null window renders no dot.

- **GIVEN** a tty tile whose window's `agentState` is `active`
- **WHEN** the header renders
- **THEN** the `StatusDot` renders in the tty header before the `>_` glyph, with the same vocabulary as the sidebar row dot

### Keybindings: tty-scoped tmux chords

#### R7: `ttyOnly` registry flag
`KeyBinding` SHALL gain an optional `ttyOnly?: boolean` field ("this chord targets the tmux pane; only meaningful when the tty tile owns focus"), set on exactly the two split rows: `split-horizontal` and `split-vertical` (`DEFAULT_BINDINGS`). No other binding carries it. The flag is data — gate sites consult it rather than hardcoding actionId lists.

- **GIVEN** the registry
- **WHEN** `DEFAULT_BINDINGS` is inspected
- **THEN** `split-horizontal` and `split-vertical` carry `ttyOnly: true` and no other row does

#### R8: Dispatcher gate — handler absent when tty unfocused
The `app.tsx` keybinding handler map SHALL treat a `ttyOnly` binding's handler as absent when the focused tile kind (R2 mirror) is not `tty` — the chord then falls through untouched per dispatcher rule 3 (no `preventDefault`). With the tty tile focused (including `single:tty` and mobile, where the visible/active slot counts as focused), splits fire exactly as today. The tty-side path is untouched: `shouldRefuseTerminalChord` still bounces the chord out of the xterm pane to the window dispatcher.

- **GIVEN** `split-h:tty,code` with the **tty** tile focused
- **WHEN** the user presses ⌘D (mac)
- **THEN** the pane splits horizontally, as today
- **GIVEN** the same layout with the **code** tile focused (e.g. after clicking the code header)
- **WHEN** ⌘D is pressed with focus in the parent document
- **THEN** no split fires and the event is not `preventDefault`ed by the dispatcher

#### R9: Reclaim carve-out — `ttyOnly` chords stay with the editor
The chord-reclaim predicate handed to `CodeSurface` SHALL NOT reclaim keydowns whose only registry matches are `ttyOnly` bindings — a keydown arriving inside the code-server iframe means the code tile owns focus, so ⌘D must reach code-server's own keybinding service (add-selection-to-next-match). Non-`ttyOnly` registry chords (⌘K, ⌘., ⇧⌘., …) keep being reclaimed exactly as today. Implement as a pure helper in `lib/keybindings.ts` (e.g. `hasReclaimableMatch(e, bindings): boolean` — `findMatches(...).some(b => !b.ttyOnly)`) so the predicate is unit-testable; `app.tsx`'s `reclaimChord` delegates to it.

- **GIVEN** focus inside the code-server iframe
- **WHEN** ⌘D is pressed
- **THEN** the reclaim listener does not intercept it (no synthetic re-dispatch), and code-server receives it
- **GIVEN** the same focus
- **WHEN** ⌘K is pressed
- **THEN** it is reclaimed and the palette opens, as today

#### R10: Keyboard parity — palette focus entries
`buildLayoutActions` (`lib/palette-layout.ts`) SHALL add `Layout: Focus <Surface>` entries — one per open tile kind that is not currently focused, desktop multi-tile only (hidden at arity 1 and on mobile) — invoking a focus-by-kind callback that `app.tsx` routes through the `SurfaceLayout` focus ref seam (first slot of that kind). The split palette rows (`Window: Split Horizontal|Vertical`) remain reachable from anywhere — the R8 gate applies to chords, not palette invocation.

- **GIVEN** `split-h:tty,code` with tty focused
- **WHEN** the palette opens
- **THEN** `Layout: Focus Code` is listed (and `Layout: Focus Terminal` is not); selecting it focuses the code tile
- **GIVEN** any layout
- **WHEN** the palette's `Window: Split Horizontal` is invoked
- **THEN** it splits regardless of which tile is focused

### Non-Goals

- No changes to `?layout=` encoding, the resolution ladder, or any localStorage key (focused tile is transient, like zoom).
- No mobile chrome changes (R13 branch stays header-less; the sheet tabs remain the mobile switcher).
- No backend, API, or route changes.
- No re-gating of other chords (`view-cycle`, `panel-toggle`, `kill-window`, navigation, ⌘K stay global).
- No change to `StatusDot` itself (import-site reuse only).

### Design Decisions

#### Focused slot owned by SurfaceLayout, kind mirrored to app.tsx
**Decision**: The focused **slot** index is `SurfaceLayout` component state; `app.tsx` receives only the focused **kind** via `onFocusedKindChange` and triggers focus via a registered ref (`focusTileRef`, the `zoomToggleRef` pattern).
**Why**: Per-window reset comes free from the existing `${server}:${windowId}` key (same reason zoom lives there); the gate and palette only need the kind; duplicate-tty highlight needs the slot, which only the component knows.
**Rejected**: Lifting the slot into `app.tsx` — it would need manual reset on window switches and layout mutations, re-deriving what the component key already guarantees.
*Introduced by*: 260812-wfic-surface-titlebar-redesign-shortcut-scoping

#### Gate at handler presence, not inside the dispatcher
**Decision**: R8 gates by making the handler `undefined` in the `app.tsx` handler map when tty is unfocused, keyed off the registry's `ttyOnly` data.
**Why**: "Scope is descriptive; handler presence gates" is the established dispatcher contract (rule 3 gives fall-through without `preventDefault` for free).
**Rejected**: Teaching `useKeybindingDispatch` about tile focus — the dispatcher is deliberately generic and route-agnostic.
*Introduced by*: 260812-wfic-surface-titlebar-redesign-shortcut-scoping

## Tasks

### Phase 1: Registry + pure helpers

- [x] T001 [P] Add `ttyOnly?: boolean` to `KeyBinding` (`app/frontend/src/lib/keybindings.ts`), set it on the `split-horizontal` and `split-vertical` rows in `DEFAULT_BINDINGS`; unit tests in `keybindings.test.ts` assert exactly those two rows carry it <!-- R7 -->
- [x] T002 [P] Add pure `hasReclaimableMatch(e, bindings)` to `lib/keybindings.ts` (`findMatches(e, bindings).some(b => !b.ttyOnly)`); unit tests: ⌘D-shaped event with the split rows → false, ⌘K-shaped → true, no match → false <!-- R9 -->

### Phase 2: Tile chrome (surface-layout.tsx)

- [x] T003 Framed grid + header chrome in `app/frontend/src/components/surface-layout.tsx`: grid `gap-[3px] bg-bg-inset`, per-tile `border border-border rounded`; header → `h-[30px]` / 11px / `bg-bg-card`, `SURFACE_GLYPH` kind glyph before the label, meta in an inset chip (`bg-bg-inset rounded px-1.5` 10px truncating); dividers untouched <!-- R1 -->
- [x] T004 Verb button redesign in `surface-layout.tsx`: 22×22 (`coarse:` 26×26) boxed buttons, rest-visible ~65% opacity, hover `bg-bg-inset` + full opacity, ✕ hover `text-signal-red`, hairline rule before ✕; zoom glyph ⛶ with `accent-green` while zoomed; ◧/⇄ hidden on the zoomed tile; `Tip`s kept <!-- R4 -->
- [x] T005 Focused-tile state in `surface-layout.tsx`: `focusedSlot` state (default 0, fallback to 0 when the slot leaves), `pointerdown`-capture + `focusin` seams on the tile wrapper, accent-green border + glyph on the focused tile (suppressed at arity 1), `onFocusedKindChange` callback, `focusTileRef` seam (focus first slot of a kind); `CodeSurface` (`code-surface.tsx`) gains an optional `onInteract` callback fired from its contentDocument keydown/pointerdown listeners, wired to tile focus <!-- R2 -->
- [x] T006 tty header status dot: new optional `WindowInfo` prop on `SurfaceLayout` consumed by tty tile headers via `<StatusDot win={...} />` (no dot when null/non-tty) <!-- R6 -->

### Phase 3: app.tsx wiring + palette

- [x] T007 `app.tsx`: mirror `focusedTileKind` state (fed by `onFocusedKindChange`; mobile uses the active slot's kind); gate the two split handler-map entries on `ttyOnly` data + `focusedTileKind === "tty"`; swap `reclaimChord` to `hasReclaimableMatch`; pass `currentWindow` for the status dot; register `focusTileRef` <!-- R8 -->
- [x] T008 `Layout: Focus <Surface>` palette entries in `lib/palette-layout.ts` (`buildLayoutActions` — new opts: focused kind + `onFocus`; entries per open non-focused kind, desktop multi-tile only); wire in `app.tsx`; unit tests in `palette-layout.test.ts` <!-- R10 -->

### Phase 4: Tests

- [x] T009 Update `surface-layout.test.tsx`: replace the `opacity-0`/`group-hover` assertion with rest-visible + boxed sizing; add coverage for focused-tile callback + accent class, zoom glyph/verb-hiding, meta chip, tty status dot presence <!-- R2 -->
- [x] T010 e2e: update `tests/e2e/surface-layout.spec.ts` (+ `.spec.md` in the same commit) for the new chrome (hover interactions still work; adjust any geometry/class assertions); add specs: focused-tile border follows clicks; ⌘D splits with tty focused; ⌘D does NOT split with the code tile focused (pane count unchanged); keep `surface-tile-*` testids stable; run via `just test-e2e` / `just pw` only <!-- R8 -->
- [x] T011 Full gates: `go test ./...` (backend untouched — smoke), `npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "surface-layout"` + `just test-e2e "code-surface"` <!-- R1 -->

## Execution Order

- T001/T002 are independent ([P]).
- T003 → T004 → T005 (same file, sequential); T006 after T005 (header structure settled).
- T007 needs T001/T002/T005; T008 needs T005/T007.
- T009 after Phase 2; T010/T011 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Desktop multi-tile grids render a 3px `bg-bg-inset` gutter and per-tile `border border-border rounded`; divider drag + ratio persistence behave exactly as before — `surface-layout.tsx` grid `gap-[3px] bg-bg-inset`, desktop tiles `border rounded` + `border-border`; divider code untouched; existing ratio-persistence e2e still passes (9/9 surface-layout)
- [x] A-002 R2: A focused-tile highlight (accent-green border + glyph) tracks pointer/keyboard interaction across tiles, defaults to slot A, falls back to slot A on close, and is suppressed at arity 1 — `focusedSlot` state + pointerdown-capture/focusin/onInteract seams in `surface-layout.tsx`; unit tests cover default/move/fallback/arity-1; e2e A-013 passes
- [x] A-003 R3: Headers are 30px `bg-bg-card` with `SURFACE_GLYPH` glyph, label, and truncating inset meta chip; mobile renders no header — header `h-[30px] bg-bg-card text-[11px]`, glyph span + `bg-bg-inset rounded px-1.5` chip; `{!mobile && ...}` gate; unit test "header chrome" passes
- [x] A-004 R4: Verbs are 22×22 (26×26 coarse) boxed buttons visible at rest, hover feedback per spec, ✕ reddens, hairline before ✕; `single` renders no verbs — `VERB_BUTTON_CLASS` (`h-[22px] w-[22px] coarse:h/w-[26px] opacity-65 hover:opacity-100 hover:bg-bg-inset`), ✕ `hover:text-signal-red`, `w-px bg-border` hairline; `showVerbs` keeps arity>1 gate; unit test passes
- [x] A-005 R5: Zoomed tile shows accent-green ⛶ and hides ◧/⇄; unzoom restores — `{!isZoomed && ...}` wraps promote/swap, zoom button gains `text-accent-green opacity-100` while zoomed; unit test passes
- [x] A-006 R6: tty tile header renders `StatusDot` from the passed `WindowInfo`; non-tty headers and null windows render none — `{kind === "tty" && statusWindow && <StatusDot win={statusWindow} />}`; both unit tests pass
- [x] A-007 R7: Exactly `split-horizontal`/`split-vertical` carry `ttyOnly: true` — unit test filters `DEFAULT_BINDINGS` and asserts the exact pair across all hosts
- [x] A-008 R8: Split chords fire only when the tty tile is focused (trivially on `single:tty`/mobile-active-tty); otherwise the chord falls through without `preventDefault` — `ttyGated` in `app.tsx` yields `undefined` handler off the registry flag + `focusedTileKind`; e2e A-014 passes (pane count unchanged with code focused, splits with tty focused)
- [x] A-009 R9: ⌘D inside the code iframe reaches code-server (not reclaimed); ⌘K inside the iframe still opens the palette — `hasReclaimableMatch` (`.some(b => !b.ttyOnly)`) unit-tested incl. ⌘D-shape → false; existing code-surface e2e (Ctrl+K reclaim inside the iframe) passes 8/8
- [x] A-010 R10: `Layout: Focus <Surface>` palette entries exist per open non-focused kind (desktop multi-tile), and `Window: Split …` palette rows work regardless of focus — `buildLayoutActions` adds `layout-focus-<kind>` per open non-focused kind (arity>1, `onFocus` present); 5 unit tests pass; the gate wraps only the chord handler map, palette bodies untouched

### Behavioral Correctness

- [x] A-011 R2: Hide-never-unmount, duplicate-tty rules, and the flat single-array render/key discipline are unregressed (element identity survives close/zoom) — `allTiles` bookkeeping, `${kind}${suffix}` keys, and `everOpened` untouched; existing close/reopen + zoom unit tests and the 9-test e2e suite pass
- [x] A-012 R8: The tty-focused path is byte-equivalent to today (xterm refusal → dispatcher → split), verified by the existing split e2e still passing — with tty focused `ttyGated` returns `fromPalette(id)` exactly as before; e2e A-014 step 6 splits (pane count 1→2)

### Scenario Coverage

- [x] A-013 R2: e2e — clicking the code tile then the tty tile moves the accent border accordingly — "the focused-tile accent border follows clicks across tiles" passes (surface-layout e2e, 9/9)
- [x] A-014 R8: e2e — ⌘D with code tile focused does not change pane count; ⌘D with tty focused splits — "the split chord is tty-scoped" passes against live tmux pane counts

### Edge Cases & Error Handling

- [x] A-015 R2: Closing the focused tile falls back to slot A without a stale highlight; zoom + focus compose (zoomed tile is focusable, highlight consistent) — fallback unit test passes (3→2 collapse re-highlights slot A); zoom and focus are independent state axes (`isFocused` has no zoom exclusion, seams stay attached on the zoomed render)
- [x] A-016 R9: A keydown matching BOTH a ttyOnly and a non-ttyOnly binding is still reclaimed (`.some(!ttyOnly)` semantics) — covered by a unit test even if no such default pair exists today — unit test constructs the shared-chord pair and asserts reclaim fires

### Code Quality

- [x] A-017 Pattern consistency: New code follows naming/structural patterns of surrounding code (registry data flags, pure lib helpers with colocated tests, ref-seam pattern) — `ttyOnly` rides `KeyBinding` like `ignoreInputs`; `hasReclaimableMatch` is a pure colocated helper; `focusTileRef` mirrors `zoomToggleRef`
- [x] A-018 No unnecessary duplication: `SURFACE_GLYPH`, `StatusDot`, `Tip`, `findMatches` reused — no parallel implementations — verified in the diff; `hasReclaimableMatch` delegates to `findMatches`
- [x] A-019 Type narrowing over assertions: no new `as` casts on the parse/prop paths — diff introduces no `as` casts
- [x] A-020 No client polling; no database/ORM; no new routes (constitution II/IV compliance trivially maintained) — frontend-only diff; no fetch loops, no routes, no backend changes (go test ./... green as smoke)
- [x] A-021 Tests included for new behavior (unit + e2e with companion `.spec.md` updated in the same commit) — keybindings/palette-layout/surface-layout unit tests + two new e2e specs with `surface-layout.spec.md` updated in the same change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The retired hover-cluster verb pattern (`opacity-0 group-hover:opacity-100`) and the 24px header were replaced in place in `surface-layout.tsx`; `findMatches` lost its `app.tsx` call site but remains the dispatcher's (`hooks/use-keybinding-dispatch.ts`) and tests' match engine. No surviving symbol lost its last caller.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Focused SLOT stays SurfaceLayout state; app.tsx mirrors only the KIND (callback + ref seam, the zoom precedent) | Intake said "lifted"; the zoom-pattern mirror satisfies the gate's need while keeping per-window reset free — recorded as a Design Decision | S:70 R:75 A:85 D:75 |
| 2 | Confident | Focus-detection seams: tile pointerdown-capture + focusin, plus a CodeSurface `onInteract` callback from its existing contentDocument listeners | Iframes swallow pointer events; focusin on the iframe element + the already-attached capture listener cover the code tile without new iframe machinery | S:60 R:80 A:75 D:65 |
| 3 | Confident | Status dot prop is the full `WindowInfo` (new optional prop) rather than widening the `ViewWindow` prop | `StatusDot` consumes `WindowInfo`; `ViewWindow` stays the pure-lib narrow type | S:65 R:85 A:85 D:80 |
| 4 | Certain | Reclaim carve-out ships as a pure `lib/keybindings.ts` helper with unit tests | Registry module owns chord predicates by convention; keeps app.tsx thin | S:80 R:90 A:90 D:85 |
| 5 | Confident | Grid gutter via `gap-[3px]` + container `bg-bg-inset`, no outer padding; divider hit zones (6px) already span the gutter | Mock showed a padded wrap; padding steals terminal columns for no separation gain — gap alone delivers the mock's read | S:60 R:85 A:80 D:70 |
| 6 | Confident | Mobile gate: `focusedTileKind` on mobile = the active slot's kind (sheet-tab selection), so splits fire only when the visible tile is tty | Intake: "the visible/active slot counts as focused"; mobileActiveTile is the existing transient state | S:70 R:80 A:80 D:80 |
| 7 | Confident | Interaction seams report the focused kind SYNCHRONOUSLY (a `focusSlot` helper calls `onFocusedKindChange` from the pointerdown/focusin/ref seams); the reporting effect remains only for the mount default and the close fallback | The e2e gate test flaked: the accent border (render 1) precedes the effect-driven report → parent re-render → handler-map rebuild (renders 2–3), so a chord pressed in that gap still fired. Discrete-event flushing makes the synchronous report land in the dispatcher before the next keydown | S:75 R:75 A:80 D:75 |

7 assumptions (1 certain, 6 confident, 0 tentative).
