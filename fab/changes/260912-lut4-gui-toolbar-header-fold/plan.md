# Plan: GUI Toolbar → Tile Header Measured Fold

**Change**: 260912-lut4-gui-toolbar-header-fold
**Intake**: `intake.md`

## Requirements

### GUI Tile: Header Fold Cluster

#### R1: Header placement (D1, D8)
The gui tile's session controls SHALL render inside the tile header's `flex-1` spring in `app/frontend/src/components/surface-layout.tsx` (the `{!mobile && (…)}` block), via a gui branch mirroring the existing tty branch. Controls SHALL be re-rendered in the header's chrome vocabulary, not reparented: 24 px fixed height axis (26 px coarse), borderless with `hover:bg-bg-inset`, `text-text-secondary` at rest → `text-text-primary` on hover, latched state = green ink + inset ring via `controlClass({ variant: "toggle", ringed: true })` (the ⌕ find-toggle precedent), text chips borderless/content-width with 6 px side padding.

- **GIVEN** a desktop (non-mobile) layout with the gui tile open
- **WHEN** the tile header renders
- **THEN** the gui cluster renders inside the header spring and nothing overlays the noVNC framebuffer
- **AND** no floating pill (`absolute top-2 left-1/2 z-20`) renders in any mode

#### R2: Measured priority fold (D2 + the ladder)
The cluster SHALL show as many controls as fit in a fixed priority order — pin `⚙` · 1 screen size · 2 zoom (`− fit +`) · 3 quality · 4 input (`⎘ ⌥`) · 5 launch (`▣ ◍`) · 6 health (`∿ ↻`) — folding the remainder into the `⚙` panel. Widths SHALL come from measurement (a hidden probe row), never from hardcoded pixel thresholds. Fold order is bottom-of-ladder first (Health → Launch → Input → Quality → Zoom → Screen size).

- **GIVEN** the gui header cluster rendered at a measurable width
- **WHEN** the available spring width shrinks below the cluster's measured width
- **THEN** ladder rungs fold into the `⚙` panel in reverse priority order
- **AND** no breakpoint constant (`TOOLBAR_OVERFLOW_MIN_PX`, `TOOLBAR_SHORT_LABEL_MAX_PX`) participates in the decision

#### R3: Conditional `⚙` with two-pass reserve (D3 × D4 resolution)
The `⚙` toggle SHALL render only when at least one ladder item is actually folded, and disappear at full width. The fit SHALL run two passes: fit once with NO pinned reserve; if every ladder item fits (degradation allowed, per R4), render no `⚙` and reserve nothing; otherwise re-fit with the pinned block's measured width reserved before any ladder item is fitted.

- **GIVEN** a spring width where every ladder item fits with no reserve
- **WHEN** the fold computes
- **THEN** no `⚙` renders and no width is reserved
- **AND** at a width where an item folds only with no reserve, the re-fit reserves the pinned block's measured width first

#### R4: Label degradation before folding (D5)
A degradable item's label SHALL degrade one step before that item folds: screen size `1920×1080 ▾` → `1920 ▾`; quality `◐ Balanced` → `◐`. Degradation is spent least-important-first (quality before screen size) and ALL degradation is spent before ANY item folds (cheapest move first — the control stays reachable).

- **GIVEN** a width where the full-label cluster overflows by less than the quality label's degradation saves
- **WHEN** the fold computes
- **THEN** quality renders as `◐`, every item stays inline, and no `⚙` renders

#### R5: Grouping and spacing (D10, D11)
The cluster SHALL render FOUR groups — `size ┆ − fit + ┆ quality ┆ ⎘ ⌥ ▣ ◍ ∿ ↻` — with exactly THREE dividers between them and NO divider between the peer action glyphs. Items SHALL sit flush (`gap: 0`); dividers carry all separation using the shipped spec verbatim: `<span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />`. Verb boxes stay 24×24 (26×26 coarse) so WCAG 2.2 SC 2.5.8 is untouched.

- **GIVEN** the full cluster inline
- **WHEN** it renders
- **THEN** exactly three `mx-0.5 h-3.5 w-px bg-border` hairlines separate the four groups and no divider sits between two action glyphs

#### R6: Tooltips (D12)
Every cluster control SHALL carry a `Tip` inside ONE `TipGroup` wrapping the whole cluster. `Tip` REPLACES the native `title=` (never both); `aria-label` stays as the coarse-pointer path. The three zoom tips SHALL carry their keycap pulled from the LIVE `gui-zoom-in` / `gui-zoom-out` / `gui-zoom-fit` registry bindings (via `useKeybindings()` → `byAction.get(id)` → `formatCombo` when enabled, else absent — the source `withShortcutHints` reads). The size chip SHALL carry the dim note `"menu"`, the quality chip `"cycles"`, and the `⚙` toggle the count of folded items.

- **GIVEN** a fine-pointer desktop with the gui tile open
- **WHEN** the user sweeps the cluster
- **THEN** each control opens its styled tip at 0 ms inside the warm cluster and no control carries a native `title=`

#### R7: The `⚙` overflow panel
The `⚙` panel SHALL be the existing `GuiToolbarMenu` component (extended, not duplicated), rendering the folded rungs as flat by-id `pickGuiActions` rows in ladder order with group separators — never nested submenus. A folded screen-size rung inlines the resolution menu rows; a folded quality rung contributes the cycle row labelled `Quality → <current preset>`. On coarse pointers the panel appends the two coarse-only rows (`⌖` pointer mode, `⌨` key bar). The panel's open/closed state SHALL persist per viewer (R12).

- **GIVEN** two rungs folded at the current width
- **WHEN** the user opens `⚙`
- **THEN** the panel lists exactly those rungs' palette rows in ladder order with a separator between groups
- **AND** picking a row fires that palette row's own `onSelect` and closes the panel

#### R8: Fold architecture (intake §11)
Pure fit arithmetic SHALL live in a NEW dependency-free `app/frontend/src/lib/gui-toolbar-fold.ts` shaped like `lib/top-bar-overflow.ts`; the component owns DOM measurement, the module owns the decision. Measurement SHALL mirror `top-bar.tsx`: ONE `ResizeObserver` plus a hidden probe row rendering every fit candidate's real width (both label forms of the degradable items), observing the header spring, the probe, AND the pinned block. The fold SHALL be collapse-first (nothing renders before the pre-paint `useLayoutEffect` measure) and SHALL port one-sided EXPAND-EDGE hysteresis (24 px, the module's OWN named constant, matching `CRUMB_COLLAPSE_HYSTERESIS_PX`) so a drag hovering the boundary cannot flap. A serialized `candidateKey` SHALL re-run the measure effect when the probed SET changes. Unmeasured environments (jsdom, zero-width probes) SHALL keep the previous state, with the fully-expanded form as the cold default (the `crumb-collapse.ts` rule).

- **GIVEN** jsdom (no layout engine, all probe widths read 0)
- **WHEN** the component mounts
- **THEN** the cold default renders the full cluster inline so unit tests exercise the full inventory

### Fullscreen (D6 — reversed 2026-09-12)

#### R9: Fullscreen targets the tile; the pill is deleted
`guiFullscreen` in `app.tsx` SHALL resolve its target as the gui TILE element (query the canvas/empty node, then `.closest('[data-testid^="surface-tile-gui"]')`), so the header travels into fullscreen. The `fullscreenchange` check in `gui-surface.tsx` SHALL become a containment check (`document.fullscreenElement?.contains(root)`) and SHALL report up via a new `onFullscreenChange` prop so `surface-layout.tsx` can latch the `⤢` header verb green (ringed toggle) and suppress the layout verbs (`⛶ ↰ ⇄ ✕`) while the gui tile is fullscreen. The fit math and the `keyboardLock()` chaining SHALL be untouched. The `⤢` verb SHALL render in the gui header's right rail at any arity (the tty find-button precedent), firing the `gui-fullscreen` palette row by id.

- **GIVEN** the gui tile open on desktop
- **WHEN** the user fires `GUI: Fullscreen` (palette or `⤢`)
- **THEN** `document.fullscreenElement` is the `surface-tile-gui` element, the header renders inside it with `⤢` latched, and the layout verbs are gone
- **AND** exiting (⤢ or Esc) restores the windowed header and releases the keyboard lock as before

### Mobile (D7)

#### R10: Mobile is the bottom rung
On mobile (where `surface-layout.tsx` gates the whole tile header behind `!mobile`), the pinned block — the `⚙` toggle alone in this change — SHALL render into the TOP BAR adjacent to the pinned mobile switch group, gated on the visible mobile surface being `gui` (switch mode, `active === "gui"`), and SHALL be width-reserved like the switch group (it renders inside the measured pinned container). The panel SHALL be the same component as the desktop fold panel, carrying every ladder rung's rows plus the two coarse-only rows (`⌖`, `⌨`) and the `gui-fullscreen` row (parity with the deleted mobile pill's `⤢` chip). `gui-keybar.tsx` is UNCHANGED.

- **GIVEN** a coarse mobile viewport with the gui surface visible
- **WHEN** the top bar renders
- **THEN** a `⚙` button sits beside the pinned switch group and opens the panel with every ladder row plus `⌖`/`⌨`
- **AND** switching the visible surface away from gui removes the block

### Palette & Persistence

#### R11: Constitution V — palette mirrors only (D9)
Every chip, verb, and panel row SHALL be a by-id `pickGuiActions` mirror of the `GUI:` palette family; no toolbar-only action. The palette SHALL gain a destination-only pair — `gui-toolbar-show` (`GUI: Show toolbar`) / `gui-toolbar-hide` (`GUI: Hide toolbar`) — gated on `tileOpen`, firing the new `onToolbarVisibleChange` input (the `gui-keybar-show`/`gui-keybar-hide` precedent).

- **GIVEN** the gui tile open
- **WHEN** the palette lists `GUI:` rows
- **THEN** exactly one of `GUI: Show toolbar` / `GUI: Hide toolbar` renders (the destination row) and selecting it flips the `⚙` panel state

#### R12: `rk-gui-toolbar` persistence
The `⚙` panel's open/closed state SHALL persist per viewer as a NEW `rk-gui-toolbar` key in `app/frontend/src/lib/gui-posture.ts`, following the sibling `rk-gui-keybar` precedent and that file's validated-read / try-catch-noop-write discipline. Absent/invalid SHALL read as CLOSED.

- **GIVEN** the panel opened and the page reloaded
- **WHEN** the gui header mounts
- **THEN** the panel reads open from `rk-gui-toolbar` without a visit-length reset

### Deletions

#### R13: The pill and its machine are gone
`gui-toolbar.tsx` SHALL become a single-mode component (the header fold). `TOOLBAR_HIDE_MS`, `TOOLBAR_REVEAL_EDGE_PX`, `TOOLBAR_OVERFLOW_MIN_PX`, `TOOLBAR_SHORT_LABEL_MAX_PX`, the `revealSignal` prop and its effect, the top-edge reveal `pointermove`, and the pill's `wrapperWidth` `ResizeObserver` SHALL all be deleted from `gui-toolbar.tsx` and `gui-surface.tsx`. No pill code path survives anywhere, fullscreen included.

- **GIVEN** the change applied
- **WHEN** the tree is searched
- **THEN** none of the deleted symbols exist and `gui-surface.tsx` mounts no toolbar

### Design Studies

#### R14: Studies ship with the change
`docs/wiki/gui-toolbar-header-studies.html` (final proposal) and `docs/wiki/gui-toolbar-header-exploration.html` (exploration record) — already in the tree, untracked — SHALL be part of this change's committed file set, and `docs/specs/index.md`'s Wiki table SHALL gain one row per file in the neighbouring rows' style (bolded/plain link plus a dense one-paragraph description ending in "Self-contained; open in a browser").

- **GIVEN** the change's file set
- **WHEN** `docs/specs/index.md` renders its Wiki table
- **THEN** both studies are linked with style-matching rows

### Testing

#### R15: Fold tests at both levels
The new pure module SHALL carry a colocated Vitest suite (`gui-toolbar-fold.test.ts`) matching the `top-bar-overflow.test.ts` / `crumb-collapse.test.ts` shape. The fold ladder SHALL have a Playwright spec driving real widths (`tests/e2e/gui-toolbar-fold.spec.ts`) with retrying assertions (the `ResizeObserver` re-fit is not atomic with the resize), a shared-setup file header, and a `Proves:`/`Steps:` JSDoc per `test()`. `gui-toolbar.test.tsx` SHALL be largely rewritten for the header fold (every pill/reveal/hide-timer test deleted); `gui-surface.spec.ts`'s reveal/pill cases SHALL be deleted or retargeted to the header/top-bar surfaces; a fullscreen e2e case SHALL assert the header renders inside the fullscreened tile.

- **GIVEN** jsdom has no layout engine
- **WHEN** the fold ladder is verified
- **THEN** a Playwright spec (not Vitest) drives real widths, and every new `test()` carries its intent comment

### Non-Goals

- Keyboard capture (`⌨`), the `gui-capture-toggle` binding, and the `rk-gui-capture` storage key — a separate later change; this change only builds the pinned-block plumbing it will occupy.
- `gui-keybar.tsx` (the key bar docked under the canvas) — unchanged.
- The pan/fit math and the `keyboardLock()` chaining — unchanged.
- Control-gallery PNG baselines — the `Control` primitive emits no new classes (all new compositions are call-site strings), so no regeneration runs.

### Design Decisions

#### Two-pass conditional reserve
**Decision**: The fold runs two passes — fit once with NO pinned reserve; if every ladder item fits, render no `⚙` and reserve nothing; otherwise re-fit with the pinned block's measured width reserved.
**Why**: D3 (`⚙` renders only when something folds) and D4 (the pinned width is reserved before fitting) are circular without it — the reserve must not be what causes the fold that justifies the reserve.
**Rejected**: Always reserve and hide the `⚙` — spends ~29 px at full width for chrome the user cannot see, and contradicts D3.
*Introduced by*: 260912-lut4-gui-toolbar-header-fold

#### Mobile `⚙` slot — adjacent to the pinned switch group
**Decision**: The mobile pinned block renders inside the top bar's measured pinned container, immediately after the mobile switch group, gated on switch mode with `active === "gui"`.
**Why**: D7 names the top bar and cites the switch group as the reason (mobile has no tile header; the top bar is already the mobile surface-control surface); inside the pinned container its width is reserved by the existing `pinnedRef` measurement for free.
**Rejected**: An exempt right-cluster registry entry (the registry is window-chrome, not surface-conditional) or a row inside the top-bar overflow menu (buries the only entry point one level deep).
*Introduced by*: 260912-lut4-gui-toolbar-header-fold

#### Header fullscreen state flows up from GuiSurface
**Decision**: `GuiSurface` keeps its `fullscreenchange` listener (identity → containment check) and reports transitions through a new `onFullscreenChange` prop; `SurfaceLayout` holds `guiTileFullscreen` and uses it to latch `⤢` and suppress the layout verbs.
**Why**: The listener already lives in `GuiSurface`; the header (a sibling, rendered by `SurfaceLayout`) needs the state and React data flows down — the report is the smallest seam.
**Rejected**: A second `fullscreenchange` listener in `SurfaceLayout` matching by `data-testid` — two sources of truth for one DOM fact, and the child hardcoding its parent's testid.
*Introduced by*: 260912-lut4-gui-toolbar-header-fold

#### The mobile `⚙` panel carries the Fullscreen row
**Decision**: The mobile panel prepends the `gui-fullscreen` row (with the screen-size rung's group); desktop never folds `⤢` (it is a header rail verb).
**Why**: The deleted mobile pill rendered `⤢` inline at all times; dropping it would strand mobile fullscreen behind the palette alone — a regression, not a fold.
**Rejected**: Omitting it (mobile loses its one-tap fullscreen) or a mobile-only pinned `⤢` (a second pinned control this change does not need).
*Introduced by*: 260912-lut4-gui-toolbar-header-fold

### Deprecated Requirements

#### The floating toolbar pill
**Reason**: The pill covers the framebuffer, self-hides 3 s after the last interaction, and is rediscoverable only through an invisible 24 px top-edge hover target; the header fold replaces it in every form factor, fullscreen included (D6 reversed).
**Migration**: The header fold cluster (R1–R8), the header `⤢` verb (R9), and the mobile top-bar `⚙` block (R10).

#### Breakpoint-driven overflow (`TOOLBAR_OVERFLOW_MIN_PX` / `TOOLBAR_SHORT_LABEL_MAX_PX`)
**Reason**: Hardcoded widths are wrong at both ends — labels vary at runtime (`1920×1080` vs `auto`, the quality label, coarse sizing).
**Migration**: The measured fold (`lib/gui-toolbar-fold.ts` + the probe row, R2/R8) and label degradation (R4).

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/gui-toolbar-fold.ts` — pure fold arithmetic (`computeGuiToolbarFold` + `GUI_TOOLBAR_FOLD_HYSTERESIS_PX = 24`): two-pass conditional reserve, least-important-first degradation before folding, group-divider charging, one-sided expand-edge hysteresis, degenerate-input rule (zero widths keep previous state; cold default fully expanded) — plus the colocated `app/frontend/src/lib/gui-toolbar-fold.test.ts` Vitest suite in the `top-bar-overflow.test.ts` shape <!-- R2, R3, R4, R8 -->

### Phase 2: Core Implementation

- [x] T002 [P] `app/frontend/src/lib/gui-posture.ts` — add the `rk-gui-toolbar` key (`readGuiToolbarVisible` defaulting closed on absent/invalid, `writeGuiToolbarVisible` writing `"1"`/removing) and extend the header docblock's key inventory; extend `app/frontend/src/lib/gui-posture.test.ts` (mirror the `rk-gui-keybar` block) <!-- R12 -->
- [x] T003 [P] `app/frontend/src/lib/palette/gui.ts` — add `toolbarVisible` + `onToolbarVisibleChange` to `GuiPaletteInput`, emit the destination-only `gui-toolbar-show`/`gui-toolbar-hide` pair inside the `tileOpen` block, and update the file docblock's pill paragraph (the pill is gone; the header fold consumes the same list); extend `app/frontend/src/lib/palette/gui.test.ts` (mirror the key-bar pair block) <!-- R11 -->
- [x] T004 [P] `app/frontend/src/components/gui-toolbar-menu.tsx` — extend `GuiToolbarMenuRow` with a separator variant (`{ id, separator: true }` renders an `aria-hidden` hairline, no `menuitem` role) and update the docblock (header fold, not pill); extend `app/frontend/src/components/gui-toolbar-menu.test.tsx` <!-- R7 -->
- [x] T005 Rewrite `app/frontend/src/components/gui-toolbar.tsx` as the header fold: the probe row + one-`ResizeObserver` measure effect (spring + probe + pinned observed, `candidateKey`, collapse-first `useLayoutEffect`), the flush four-group cluster in header chrome (D8/D10/D11), one `TipGroup` with per-control `Tip`s (live zoom keycaps via `useKeybindings`, `menu`/`cycles` notes, `⚙` folded-count note), the resolution menu, the `⚙` pinned block with persisted panel state, and the exported mobile overflow block (`GuiToolbarMobileOverflow`: `⚙` + full panel incl. `gui-fullscreen` and the coarse rows); largely rewrite `app/frontend/src/components/gui-toolbar.test.tsx` (pill/reveal/hide-timer suites deleted; header-fold presence/gating/mirror/panel suites in) <!-- R1, R2, R3, R4, R5, R6, R7, R8, R12 -->
- [x] T006 `app/frontend/src/components/surface-layout.tsx` — the gui header branch: replace the empty `flex-1` spring for `kind === "gui"` with `<GuiToolbar>` (root `flex-1 min-w-0`), render the `⤢` rail verb (by-id `gui-fullscreen` mirror, ringed-toggle latch) with one divider, track `guiTileFullscreen` (fed by GuiSurface's `onFullscreenChange`), suppress the layout-verb block while the gui tile is fullscreen, and add the `guiToolbarVisible` / `onGuiToolbarVisibleChange` props; extend `app/frontend/src/components/surface-layout.test.tsx` <!-- R1, R9 -->
- [x] T007 `app/frontend/src/components/gui-surface.tsx` — delete the pill mount, `revealSignal`, `wrapperWidth` + its observer, the top-edge reveal `pointermove`, and the tap-to-reveal bump (keep `onInteract`); switch the `fullscreenchange` check to containment on a root ref attached to BOTH the canvas and empty roots, and report via `onFullscreenChange`; sweep the header docblock's toolbar-pill bullet; update `app/frontend/src/components/gui-surface.test.tsx` (delete the pill suites, retarget the ⌨-chip keybar test to the palette row) <!-- R9, R13 -->
- [x] T008 `app/frontend/src/app.tsx` + `app/frontend/src/contexts/top-bar-slot-context.tsx` — the `guiFullscreen` selector swap (`.closest('[data-testid^="surface-tile-gui"]')`); the `guiToolbarVisible` state + `handleGuiToolbarVisibleChange` (seed `readGuiToolbarVisible`, write-through); the palette input's `toolbarVisible`/`onToolbarVisibleChange`; SurfaceLayout's new props; the slot type + `topBarSlot`'s `guiToolbar` payload (`actions`, `quality`, `visible`, `onVisibleChange`); `RootTopBar` passes `slot?.guiToolbar` <!-- R9, R11, R12 -->
- [x] T009 `app/frontend/src/components/top-bar.tsx` — the `guiToolbar` prop and the mobile `⚙` pinned block (`GuiToolbarMobileOverflow`) rendered inside the pinned container after the switch group, gated on `surfaceToggles?.mode === "switch" && surfaceToggles.active === "gui"`; extend `app/frontend/src/components/top-bar.test.tsx` <!-- R10 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Retarget `app/frontend/tests/e2e/gui-surface.spec.ts` — delete the pill show/hide/reveal and 375px primary-set cases; retarget the resolution-menu, `⋯`-menu quality-cycle, and resize-POST cases to the header cluster (desktop) and the top-bar `⚙` panel (mobile); update the file-header narrative <!-- R9, R13, R15 -->
- [x] T011 New `app/frontend/tests/e2e/gui-toolbar-fold.spec.ts` — drive the ladder at real viewport widths (full → degradation → reverse-priority fold → `⚙` appears/disappears, panel contents, `rk-gui-toolbar` persistence across reload) plus a fullscreen case asserting the header renders inside the fullscreened tile with `⤢` latched and the layout verbs gone; retrying assertions, shared-setup header, `Proves:`/`Steps:` per `test()` <!-- R2, R3, R4, R9, R15 -->

### Phase 4: Polish

- [x] T012 `docs/specs/index.md` — one Wiki-table row per design study (`gui-toolbar-header-studies.html`, `gui-toolbar-header-exploration.html`) in the neighbouring style; confirm both HTML files are in the tree for ship to commit; comment/docblock sweep across every touched file (no stale pill references) <!-- R14 -->

## Execution Order

- T001 blocks T005 (the component consumes the pure module)
- T002/T003/T004 are independent of each other; T003 blocks T008 (app.tsx wires the new input fields)
- T005 blocks T006, T007, T009 (the branch, the deletions, and the mobile block all consume the rewritten component)
- T006 and T007 interlock on `onFullscreenChange` — do them back-to-back
- T010/T011 run after T005–T009; T012 is independent

## Acceptance

### Functional Completeness

- [x] T013 `app/frontend/src/components/top-bar-icons.tsx` + `app/frontend/src/components/gui-toolbar.tsx` — replace the cluster's Unicode text glyphs with real SVG glyphs so the gui header matches its neighbouring verbs. Today every toolbar control renders an 11px Unicode character (`⎘ ⌥ ▣ ◍ ∿ ↻ ⚙ ⤢` and the zoom trio `− fit +`) inheriting the header's `text-[11px]`, while the shipped verbs (`ZoomGlyph`/`PromoteGlyph`/`SwapGlyph`/`TileCloseGlyph`, and tty's `FindGlyph`/`ExportGlyph`) render 14px SVGs — measured 11px vs 14px in the same 24×24 box, plus a weight/baseline mismatch (SVGs are `strokeWidth 2` and optically centred). Add `PasteGlyph`, `SendKeyGlyph`, `TerminalGlyph`, `BrowserGlyph`, `StatsGlyph`, `ReconnectGlyph`, `GearGlyph`, `FullscreenGlyph`, `ZoomInGlyph`, `ZoomOutGlyph`, `ZoomFitGlyph` following the file's `ControlGlyph` convention exactly (14px rendered, 24 viewBox, `strokeWidth 2`, `currentColor`, `aria-hidden="true"`, `shrink-0`, kebab-case `data-icon`), and swap the toolbar to them. Keep the TEXT chips as text (`auto ▾` / `1920×1080 ▾`, `fit` if it stays lexical, `◐ Balanced`) — only glyph-only controls become SVG. `aria-label`s and the `Tip` labels are unchanged, so the by-id palette mirror and every existing test selector still hold <!-- R6, D8 -->
- [x] T014 `app/frontend/src/components/surface-layout.tsx` — give the gui tile a header meta chip. `tileMeta` (`:574`) currently returns a value for `code` (code-root basename) and `web` (page host) but **`null` for `gui`**, so the gui header has no meta chip at all. Add a `gui` arm returning `wm · display` from the `GuiSignal` (`wm` / `display`, `session-context.tsx:283–295`), degrading gracefully when `wm === ""` (the bare-WM state `GUI_BARE` already covers in tests) — render just the display in that case. This is the chip the follow-up keyboard-capture change swaps to `keys → desktop`; it belongs here because it is header content and the design study shows it. Extend `surface-layout.test.tsx` <!-- R1 -->
- [ ] A-001 R1: The gui tile header renders the fold cluster in the header spring on desktop; nothing overlays the framebuffer; the tty branch and layout verbs are undisturbed
- [ ] A-002 R2: The fold is driven by measured widths only — no `TOOLBAR_OVERFLOW_MIN_PX`/`TOOLBAR_SHORT_LABEL_MAX_PX` or successor constants exist; the ladder folds Health → Launch → Input → Quality → Zoom → Screen size
- [ ] A-003 R3: At a width fitting everything, no `⚙` renders and nothing is reserved; once an item folds, `⚙` renders and the pinned width is reserved before fitting
- [ ] A-004 R4: Quality renders `◐` (and the size chip its short form) before any item folds; degradation order is quality first, then screen size
- [ ] A-005 R5: The full cluster shows exactly four groups separated by exactly three `mx-0.5 h-3.5 w-px bg-border` hairlines at `gap: 0`
- [ ] A-006 R6: Every cluster control has a `Tip` in one `TipGroup`, no `title=`, a kept `aria-label`; zoom tips show live registry keycaps; size/quality chips show the `menu`/`cycles` notes; `⚙` notes the folded count
- [ ] A-007 R7: The `⚙` panel is `GuiToolbarMenu` with flat by-id rows in ladder order plus group separators; coarse pointers get the `⌖`/`⌨` rows appended
- [ ] A-008 R8: `lib/gui-toolbar-fold.ts` exists dependency-free with colocated Vitest coverage; the component measures via one `ResizeObserver` + hidden probe, is collapse-first, and applies 24px expand-edge hysteresis
- [ ] A-009 R9: `document.fullscreenElement` is the `surface-tile-gui` element after `GUI: Fullscreen`; the header (with latched `⤢`, no layout verbs) renders inside it; Esc/⤢ exit restores windowed chrome; keyboard-lock chaining is untouched
- [ ] A-010 R10: On mobile with gui visible, the top bar renders the `⚙` block beside the switch group; its panel carries every ladder row plus `⌖`/`⌨` and Fullscreen; switching away from gui removes it; `gui-keybar.tsx` is byte-identical
- [ ] A-011 R11: The palette shows exactly one of `GUI: Show toolbar` / `GUI: Hide toolbar` when the tile is open, and every chip/row fires a by-id palette `onSelect`
- [ ] A-012 R12: `rk-gui-toolbar` round-trips the panel state across a reload; absent/invalid reads closed

### Behavioral Correctness

- [ ] A-013 R9: Fullscreen entry/exit behaves as before for the user (framebuffer + chrome fill the screen, Esc exits, keyboard lock engages) with the tile — not the canvas wrapper — as the fullscreen element
- [ ] A-014 R13: Searching the tree finds no `TOOLBAR_HIDE_MS`, `TOOLBAR_REVEAL_EDGE_PX`, `revealSignal`, `wrapperWidth`, or pill markup; `gui-toolbar.tsx` is header-only

### Removal Verification

- [ ] A-015 R13: No pill code path survives in any mode (windowed, fullscreen, mobile); the deleted reveal/auto-hide e2e cases are gone from `gui-surface.spec.ts`

### Scenario Coverage

- [ ] A-016 R15: `gui-toolbar-fold.test.ts` covers full-fit, degradation order, fold order, two-pass reserve, hysteresis, and degenerate inputs; `gui-toolbar-fold.spec.ts` drives the ladder at real widths with retrying assertions and passes
- [ ] A-017 R9: A fullscreen e2e case proves the header serves the fullscreened tile

### Edge Cases & Error Handling

- [ ] A-018 R8: Under jsdom (zero-width probes) the component renders the full cluster (cold expanded default) so existing unit suites stay green; a candidate-set change re-runs the measure via `candidateKey`
- [ ] A-019 R3: The reserve never causes the fold that justifies it — the two-pass rule is pinned by unit tests on both sides of the boundary

### Code Quality

- [ ] A-020 Type narrowing over assertions: new code narrows with guards (no `as` casts beyond the established probe-element reads)
- [ ] A-021 Tests included: every added/changed behavior has Vitest and/or Playwright coverage per `fab/project/code-quality.md`
- [ ] A-022 No magic numbers: the 24px hysteresis and any widths are named constants or measured, never literals
- [ ] A-023 Comment discipline: comments state constraints/cross-file contracts only — no narration, no reviewer-addressed notes, no change-id citations in code comments
- [ ] A-024 Pattern consistency: the fold mirrors `top-bar-overflow.ts`/`crumb-collapse.ts`/`top-bar.tsx` idioms (probe, reserve, collapse-first, hysteresis)
- [ ] A-025 No unnecessary duplication: `GuiToolbarMenu`, `Tip`/`TipGroup`, `controlClass`, `pickGuiActions`, and the posture read/write discipline are reused, not reimplemented
- [ ] A-026 T013: No glyph-only control in the gui header cluster renders a Unicode text character; every one is a `ControlGlyph`-shaped SVG at 14px, matching the adjacent layout verbs in size, stroke weight and baseline. The text chips (resolution, quality) remain text
- [ ] A-027 T014: The gui tile header renders a meta chip reading `wm · display` (e.g. `startxfce4 · :22`), degrading to the display alone when the WM is empty

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Environment: no Go toolchain on this machine — frontend gates only (`npx tsc --noEmit`, `just test-frontend`, `just test-e2e`); `just test`/`just build`/`go test` are unrunnable here for environment reasons.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Two-pass conditional reserve resolves the D3 × D4 circularity: fit with no reserve; if everything fits render no `⚙` and reserve nothing, else re-fit with the pinned block's measured width reserved | D3 and D4 together imply it but never state it (intake row 32); the top-bar precedent reserves a PERMANENT chevron so it does not answer this; implemented as the pure module's two-pass `decide` with unit tests pinning both sides of the boundary | S:70 R:65 A:70 D:55 |
| 2 | Confident | The mobile `⚙` block renders inside the top bar's measured pinned container, immediately after the pinned mobile switch group, gated on switch mode with `active === "gui"` | D7 names the top bar and cites the switch group as the reason but does not fix the slot (intake row 31); switch-group adjacency is the intake's front-runner and inherits the pinned reserve for free | S:60 R:60 A:65 D:55 |
| 3 | Certain | The fold budget measures the header's `flex-1` spring (the container the controls occupy), not the header element | Intake row 28; the top-bar precedent measures the cluster wrapper and `crumb-collapse.ts` measures the `flex-1 min-w-0` section wrapper | S:65 R:90 A:85 D:75 |
| 4 | Confident | The `⚙` panel extends `gui-toolbar-menu.tsx` (a separator row variant) and renders folded entries as flat palette-mirror rows with group separators — no second popover, no nested submenus | Intake row 29 plus the study mock's `fsep` group separators; D9's flat-row shape follows from by-id `pickGuiActions` mirroring | S:65 R:80 A:85 D:70 |
| 5 | Certain | `rk-gui-toolbar` reads CLOSED when absent/invalid; the write stores `"1"` and removes the key on close | Intake row 30; the sibling keys' safe-default discipline and an overflow panel's natural rest state agree | S:60 R:90 A:90 D:80 |
| 6 | Certain | `lib/gui-toolbar-fold.ts` defines its OWN `GUI_TOOLBAR_FOLD_HYSTERESIS_PX = 24` rather than importing `CRUMB_COLLAPSE_HYSTERESIS_PX` | Intake row 33 — "port" was the word used, and both precedent modules are dependency-free by design | S:65 R:90 A:85 D:70 |
| 7 | Confident | Header fullscreen state flows up from `GuiSurface` via a new `onFullscreenChange` prop (containment-checked against a root ref attached to both the canvas and empty roots); `SurfaceLayout` latches `⤢` and suppresses the layout-verb block while set | The intake names the `gui-surface.tsx:417` containment edit explicitly, which only has a consumer if the state reports up; the header is a sibling rendered by `SurfaceLayout`, so a callback prop is the smallest seam | S:55 R:70 A:70 D:60 |
| 8 | Confident | The mobile `⚙` panel carries the `gui-fullscreen` row (grouped with screen size); desktop never folds `⤢` (a header rail verb) | The deleted mobile pill rendered `⤢` inline at all times — omitting it would regress mobile fullscreen to palette-only; neither the intake nor the study's mobile mock fixes this | S:45 R:75 A:65 D:55 |
| 9 | Confident | Degenerate measurements (jsdom / zero-width probes) keep the previous fold state; the cold default is fully expanded (the `crumb-collapse.ts` rule), while collapse-first comes from a `null` initial fold state set in a pre-paint `useLayoutEffect` | The crumb module documents exactly this rule; a cold-collapsed jsdom default would blind every component unit test, and a real browser measures before first paint so no flash exists either way | S:55 R:85 A:80 D:65 |
| 10 | Certain | The zoom trio and the quality chip always render within their gate and DISABLE when the destination row is absent (the pill's no-reflow rule carried over); the coarse `⌖`/`⌨` pair leaves the inline cluster for the panel | The pill's docblock states the rule for exactly these controls; the fold's `candidateKey` re-measure covers the remaining presence churn | S:70 R:80 A:85 D:80 |
| 11 | Confident | `⤢` renders as a header rail verb for the gui tile at ANY arity (the tty find-button precedent), a by-id `gui-fullscreen` mirror, separated from the fold cluster by one hairline and sitting with the layout verbs without one | The study's header mock places `⤢` with the rail verbs (`… pinned ┆ ⤢ ⛶ ↰ ⇄ ┆ ✕`); the old pill rendered it unconditionally, so arity-1 gui tiles keep their fullscreen affordance | S:60 R:80 A:75 D:65 |

11 assumptions (4 certain, 7 confident, 0 tentative).
