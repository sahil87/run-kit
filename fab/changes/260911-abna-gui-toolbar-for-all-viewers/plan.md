# Plan: GUI toolbar for every viewer — resolution menu chip, fullscreen toggle, launch/input/health chips, `⋯` overflow by width

**Change**: 260911-abna-gui-toolbar-for-all-viewers
**Intake**: `intake.md`

> Design authority: `intake.md` (T-D1–T-D7 of `fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md`, all Certain). Paths below are relative to `app/frontend/src/` unless they start with `app/`, `docs/`, `fab/`, or `tests/`.

## Requirements

### GUI Surface: pill mount and reveal

#### R1: The pill mounts for every canvas-state viewer
`GuiSurface` SHALL mount `GuiToolbar` whenever the canvas branch renders and no credentials prompt is up (`!credentials`), for every pointer kind and regardless of fullscreen. The empty state and the credentials prompt SHALL never mount it. The `screen-sharing` backend gets no new chips beyond those whose palette rows exist there.

- **GIVEN** a reachable gui host and a fine-pointer, non-fullscreen viewer with the tile open
- **WHEN** the canvas renders
- **THEN** a `gui-toolbar` element is mounted (possibly hidden by its show/hide machine)
- **AND** the credentials prompt (`gui-surface-credentials`) being visible unmounts it

#### R2: Reveal rules differ by pointer kind; the hide timer is unchanged
The pill SHALL be shown on mount only for coarse-pointer or fullscreen viewers (initial `shown` is `coarsePointer || fullscreen`). A fine-pointer non-fullscreen viewer SHALL start hidden. A pointermove within `TOOLBAR_REVEAL_EDGE_PX` (24) of the wrapper's top edge SHALL reveal it for every viewer (the fullscreen-only guard is removed). A tap (`pointerdown`) on the tile SHALL reveal it (unchanged). Entering fullscreen SHALL bump the reveal signal. The pill SHALL hide `TOOLBAR_HIDE_MS` (3000) after the last reveal or pill/menu interaction, except while a menu is open (R11).

- **GIVEN** a 1280-px fine-pointer viewer with the gui tile open and no menu open
- **WHEN** 3 s pass with no interaction
- **THEN** the pill renders nothing
- **WHEN** the mouse moves to within 24 px of the wrapper's top edge
- **THEN** the pill is visible again

### GUI Surface: the palette-mirror contract

#### R3: Every chip and menu row fires a palette row's own `onSelect`, selected by stable id
`GuiToolbar` SHALL receive the built `GUI:` action list (`GuiPaletteAction[]`, the same array `app.tsx` feeds the palette) as an `actions` prop, threaded `app.tsx` → `SurfaceLayout` → `GuiSurface` → `GuiToolbar`. Every chip and every menu row SHALL invoke the `onSelect` of the row with the matching id and SHALL NOT wrap it in logic of its own. `lib/palette/gui.ts` SHALL export `pickGuiActions(actions, ids)` (order-preserving id filter; absent ids absent) and `stripGuiLabel(label, arrowPrefix?)` (`GUI: Resolution → 1280×720` → `1280×720`; `GUI: Open terminal` → `Open terminal`). No new palette rows are added. `GuiToolbar`'s per-chip callback props (`onZoom`, `onPointerMode`, `onKeyBarVisibleChange`, `onFullscreen`, `quality.onChange`, `stats.onVisibleChange`) are removed; `GuiSurface` keeps its own callback props for chords, pinch, and the RFB seams.

- **GIVEN** one `buildGuiActions(...)` list handed to both the palette and the pill
- **WHEN** the `+` chip is clicked
- **THEN** the exact `onSelect` function object of the row with id `gui-zoom-in` is invoked with no arguments
- **AND** the same holds for every chip and menu row, by its id

#### R4: Chip inventory, groups, order, and presence
The pill SHALL render, left to right, groups separated by a 1-px divider (`w-px self-stretch bg-border`), a divider only between two non-empty groups:

| Group | Chip | Label / aria-label | Row id(s) | Presence |
|---|---|---|---|---|
| Display | resolution | R6 | `gui-res-*` | iff any `gui-res-*` row exists |
| Display | fullscreen | `⤢`, `Enter fullscreen` / `Exit fullscreen` | `gui-fullscreen` | always |
| View | zoom out | `−`, `Zoom out` | `gui-zoom-out` | always; disabled when the row is absent |
| View | zoom fit | `fit`, `Zoom to fit` | `gui-zoom-fit` | always; disabled when absent |
| View | zoom in | `+`, `Zoom in` | `gui-zoom-in` | always; disabled when absent |
| View | quality | `◐ <GUI_QUALITY_LABELS[current]>`, `Quality` | `gui-quality-<nextGuiQuality(current)>` | always |
| Input | pointer mode | `⌖ Trackpad` / `⌖ Touch` (glyph-only below 560 px), `Pointer mode` | `gui-pointer-touch` / `gui-pointer-trackpad` | coarse only; fires whichever exists |
| Input | key bar | `⌨`, `Toggle key bar`, `pressed={keyBarVisible}` | `gui-keybar-hide` / `gui-keybar-show` | coarse only |
| Input | paste | `⎘`, `Paste clipboard` | `gui-paste` | iff row exists |
| Input | send key | `⌥`, `Send key…` | `gui-send-key` | iff row exists |
| Launch | terminal | `▣`, `Open terminal` | `gui-open-terminal` | iff row exists |
| Launch | browser | `◍`, `Open browser` | `gui-open-browser` | iff row exists |
| Health | stats | `∿`, `Toggle stats`, `pressed={statsVisible}` | `gui-stats-hide` / `gui-stats-show` | always |
| Health | reconnect | `↻`, `Reconnect` | `gui-reconnect` | iff row exists |

`gui-turn-off`, `gui-desktop`, `gui-logs`, `gui-hidpi-*`, and `gui-view-1to1` SHALL NOT appear on the pill or in its menus.

- **GIVEN** a connected, reachable, non-mirror host, a fine pointer, wrapper width 1280
- **WHEN** the pill is shown
- **THEN** the chips render in the order `resolution ⤢ | − fit + ◐ | ⎘ ⌥ | ▣ ◍ | ∿` with no `⌖`/`⌨`/`↻` and no `⋯`
- **GIVEN** the same with `connected=false`
- **THEN** `⎘`/`⌥` are absent and `↻` is present

#### R5: The fullscreen chip toggles
`⤢` SHALL render for every viewer and fire the `gui-fullscreen` row; its `aria-label` SHALL read `Enter fullscreen` when not fullscreen and `Exit fullscreen` when fullscreen.

- **GIVEN** a non-fullscreen tile
- **WHEN** `⤢` is clicked
- **THEN** the `gui-fullscreen` row's `onSelect` fires and the chip's aria-label was `Enter fullscreen`

### GUI Surface: the resolution chip and menu

#### R6: The resolution chip reads as status
The chip (`data-testid="gui-toolbar-resolution"`, `Control variant="chip"`, `aria-haspopup="menu"`, `aria-expanded`) SHALL label itself from the stream entry: `auto ▾` when `geometry === "auto"`; otherwise `W×H ▾` where `W`/`H` are the entry's `width`/`height` (fallback `presetLabel(geometry)` without a `(portrait)` suffix when either is 0); prefixed `🔒 ` when `locked`. Below `TOOLBAR_SHORT_LABEL_MAX_PX` (400) of wrapper width the label drops the `×H` half (`1920 ▾`). The `aria-label` SHALL always carry the full form: `Resolution 1920×1080, menu` / `Resolution auto, menu` / `Resolution 1920×1080, locked, menu`. The chip SHALL render only when at least one `gui-res-*` row exists.

- **GIVEN** `geometry="1920x1080"`, `width=1920`, `height=1080`, `locked=false`, wrapper 1280
- **THEN** the chip text is `1920×1080 ▾` and its aria-label `Resolution 1920×1080, menu`
- **GIVEN** the same with `locked=true` and wrapper 375
- **THEN** the chip text is `🔒 1920 ▾` and its aria-label `Resolution 1920×1080, locked, menu`
- **GIVEN** `geometry="auto"`
- **THEN** the chip text is `auto ▾`

#### R7: The resolution menu is the palette's Resolution and Lock rows
Tapping the chip SHALL open a `GuiToolbarMenu` (`kind="resolution"`) whose rows are, in order, the existing rows picked by id: `gui-res-1280x720`, `gui-res-1600x900`, `gui-res-1920x1080`, `gui-res-2560x1440`, `gui-res-1080x1920`, `gui-res-match`, `gui-res-auto`, `gui-res-custom`, then `gui-lock` / `gui-unlock` — each present only if the palette list contains it. Row labels strip `GUI: Resolution → ` (and `GUI: ` for the lock rows); descriptions pass through verbatim (`current`, `locked`, the fixed-size lock copy). Picking a size fires the row immediately (no confirm) and closes the menu.

- **GIVEN** `geometry="1920x1080"` and a fine pointer
- **WHEN** the chip is tapped
- **THEN** the menu lists `1280×720`, `1600×900`, `1920×1080 — current`, `2560×1440`, `1080×1920 (portrait)`, `Match this tile`, `Auto (follow this tile)`, `Custom…`, `Lock resolution` (disabled, fixed-size description)
- **GIVEN** `geometry="auto"`
- **THEN** the `Auto (follow this tile)` row is absent
- **GIVEN** a coarse pointer
- **THEN** no lock row is present (the palette has none)

#### R8: A locked host disables the size rows in the builder
`buildGuiActions` input SHALL gain `locked: boolean` (from `gui?.locked ?? false` in `app.tsx`). While `locked`, every `gui-res-*` row (the five presets, `gui-res-match`, `gui-res-auto`, `gui-res-custom`) SHALL carry `disabled: true` and `description: "locked"` (replacing `current`). The pill's menu renders them disabled and inert; the palette shows the same.

- **GIVEN** `locked=true`
- **WHEN** `buildGuiActions` runs
- **THEN** every `gui-res-*` row is `disabled` with description `locked`
- **AND** the `gui-lock`/`gui-unlock` row semantics are unchanged

### GUI Surface: overflow and the shared menu

#### R9: Overflow is decided by wrapper width
`GuiSurface` SHALL measure `wrapperRef` with a `ResizeObserver` (guarded by `typeof ResizeObserver !== "undefined"`, seeded from `getBoundingClientRect().width`) and pass `wrapperWidth` to `GuiToolbar`. Below `TOOLBAR_OVERFLOW_MIN_PX` (560, exported from `gui-toolbar.tsx`) the pill SHALL render only the primary set — resolution, `⤢`, `−`, `fit`, `+`, `⌖` (coarse), `⌨` (coarse) — plus a `⋯` chip (`data-testid="gui-toolbar-overflow"`, `aria-label="More actions"`, `aria-haspopup="menu"`). At or above 560 every chip is inline and `⋯` is absent.

- **GIVEN** wrapper width 375 (or 559)
- **THEN** the pill contains the primary set and `⋯`, and no quality/paste/send-key/launch/stats/reconnect chips
- **GIVEN** wrapper width 560 (or 1280)
- **THEN** `⋯` is absent and every present row's chip is inline

#### R10: The `⋯` menu carries the folded rows
The `⋯` chip SHALL open a `GuiToolbarMenu` (`kind="overflow"`) with rows, in order, each present iff its chip would be present wide: `Quality → <GUI_QUALITY_LABELS[current]>` (fires `gui-quality-<nextGuiQuality(current)>`), `Paste clipboard`, `Send key…`, `Open terminal`, `Open browser`, `Show stats` / `Hide stats`, `Reconnect`.

- **GIVEN** wrapper 375, coarse pointer, connected, reachable, quality `balanced`, stats hidden
- **WHEN** `⋯` is tapped
- **THEN** the menu rows read `Quality → Balanced`, `Paste clipboard`, `Send key…`, `Open terminal`, `Open browser`, `Show stats`
- **WHEN** `Quality → Balanced` is picked
- **THEN** the `gui-quality-smooth` row's `onSelect` fires

#### R11: The shared anchored menu
`components/gui-toolbar-menu.tsx` SHALL export `GuiToolbarMenu` rendering inside the surface wrapper (`absolute`, anchored under its chip with a 4-px gap, horizontally clamped to the wrapper), `data-testid="gui-toolbar-menu"`, `data-menu={kind}`, `role="menu"`, one column, monospace, using `POPOVER_SHELL` and `Control variant="menu-row"` (`role="menuitem"`) with the palette idioms (`label — description`; disabled rows dimmed and inert; a `current` description rendered via `MENU_ROW_CHECK_MARK`). Focus SHALL move to the first enabled row on open; `↑`/`↓` rove, `Enter`/`Space` select, `Escape` and `Tab` close and return focus to the chip; keydown events SHALL not propagate past the menu. A pick fires the row and closes. A `pointerdown` outside the menu and its chip (document capture listener while open) SHALL close it. While a menu is open the pill's hide timer SHALL be suspended; closing restarts it; any pointerdown on the pill or menu restarts it.

- **GIVEN** an open resolution menu
- **WHEN** 5 s pass with no interaction
- **THEN** the pill and menu are still visible
- **WHEN** Escape is pressed
- **THEN** the menu closes, the chip has focus, and the pill hides 3 s later

#### R12: Menu touches pass through the trackpad layer
`gui-pointer.ts`'s `CHROME_SELECTOR` SHALL include `[data-testid="gui-toolbar-menu"]`, so a trackpad-mode touch on a menu row is never owned.

- **GIVEN** trackpad mode attached and a touchstart targeting an element inside `gui-toolbar-menu`
- **THEN** the event is neither swallowed nor treated as a gesture

### Tests and docs

#### R13: Unit and e2e coverage
Vitest SHALL cover: the show/hide machine including menu suspension and the fine-non-fullscreen hidden start; R4's presence table at fine/coarse × connected/disconnected × mirror; R6's label derivation; R7/R8's menu rows and disabled states; R9 at wrapper widths 375/559/560/1280; R11's keyboard and outside-close behavior; `pickGuiActions`/`stripGuiLabel`; the `locked` builder gate; R12's pass-through. Playwright (`tests/e2e/gui-surface.spec.ts`, mocked-signal describes, each `test()` with Proves/Steps intent comments) SHALL add: at 375×812 coarse — primary set + `⋯` fits one row (pill box width ≤ 375, all chips share one `top`), `⋯` opens the overflow menu with R10's rows, the resolution chip's aria-label names the mocked size, tapping `1280×720` posts the exact resize body via a `page.route` intercept; at 1280×800 fine — the pill is absent after open, a top-edge `mouse.move` reveals it, `⋯` has count 0, the resolution menu shows `current` on the mocked size. The two existing coarse pill tests keep passing.

- **GIVEN** `just test-e2e "e2e/gui-surface"` on this worktree's rig
- **THEN** the new and existing gui-surface mocked tests pass

#### R14: Spec amendment and verification artifacts
`docs/specs/gui.md` § The toolbar pill, HiDPI, and Send key SHALL be rewritten per intake § 10 (mount-for-all, reveal rules, inventory and groups, resolution chip grammar, `⋯` below 560 px, menu behavior, by-id mirror, the explicit "amends V-D10; T-D1–T-D7 are the design log" line). Two Playwright screenshots of the `just dev` rig — `375x812-coarse.png` (pill narrow, `⋯` menu open) and `1280x800-fine.png` (pill revealed wide, resolution menu open) — SHALL be saved under `fab/changes/260911-abna-gui-toolbar-for-all-viewers/shots/` for the PR.

- **GIVEN** the change folder after apply
- **THEN** both PNGs exist and the spec section describes the shipped pill

### Non-Goals

- No connection-health dot, drag-to-move pill, per-viewer chip customization, bottom-docked variant, or key-bar content changes (T-D7).
- No new palette rows; no changes to the palette's own rendering except the `locked` disabled state on Resolution rows (R8).
- No backend, route, or settings changes. No real-Xvnc-rig e2e additions.
- The live `rk-gui` desktop is not resized by any automated step; the once-only manual acceptance is the orchestrator's, at ship time, behind the `rk-jobs` guard (intake § 11).

### Design Decisions

#### The pill mounts for every viewer; only the reveal differs
**Decision**: mount under `!credentials` in the canvas state; coarse = tap reveal + shown on mount, fine = 24-px top-edge hover everywhere, fullscreen entry bumps the reveal.
**Why**: resolution, fullscreen, and the launchers are what a laptop viewer reaches for while watching an agent; hover-reveal keeps the tile clean by default.
**Rejected**: V-D10's fine-pointer non-fullscreen exclusion (made every future chip invisible to the largest viewer class).
*Introduced by*: 260911-abna-gui-toolbar-for-all-viewers

#### Resolution is a status chip that acts through a menu
**Decision**: the chip reads the live size (`1920×1080 ▾`, `auto ▾`, `🔒` prefix) and changes it only via a second tap on a menu row; no confirm.
**Why**: a host setting on a shared desktop behind a 3-second auto-hiding pill needs a two-tap path as the mis-tap guard; the status label answers "what size is it" for free.
**Rejected**: a bare preset chip (phone mis-tap reflows every viewer and moves an agent loop's coordinates); a confirm dialog (a third step for a reversible action).
*Introduced by*: 260911-abna-gui-toolbar-for-all-viewers

#### Overflow is decided by pill width, not pointer kind
**Decision**: a `ResizeObserver` on the surface wrapper; below 560 px the primary set + `⋯`, else everything inline.
**Why**: a narrow fine-pointer split tile must fold too; `⋯` reads as "more" beside the `▾` that already means "menu for this chip".
**Rejected**: pointer-kind gating; a chevron.
*Introduced by*: 260911-abna-gui-toolbar-for-all-viewers

#### The pill consumes the built palette rows by id
**Decision**: thread the `buildGuiActions` output down as `actions`; chips and rows fire `row.onSelect` by stable id via `pickGuiActions`; the `locked` disabled state lives in the builder.
**Why**: T-D5 — no chip logic of its own; the palette stays the truthful registry and both surfaces agree.
**Rejected**: per-chip callback props (drift risk, eight new props); a pill-only disabled overlay for `locked` (palette would disagree).
*Introduced by*: 260911-abna-gui-toolbar-for-all-viewers

#### Zoom and coarse posture chips stay fixed; everything else omits when absent
**Decision**: `−`/`fit`/`+`/`⌖`/`⌨` always render within their pointer gate and disable when the destination row is absent; other chips exist iff their row exists.
**Why**: the View/Input groups must not reflow on every zoom step; the rest follows the palette's omit-not-disable rule.
**Rejected**: uniform omit (chip jitter); uniform disable (a permanently greyed `↻` on a connected tile).
*Introduced by*: 260911-abna-gui-toolbar-for-all-viewers

## Tasks

### Phase 1: Setup

- [x] T001 Run `just setup` in this worktree (fresh worktree: no `app/frontend/node_modules`, no Playwright browsers); confirm `pnpm exec tsc --noEmit` is clean before any edit <!-- R13 -->

### Phase 2: Core Implementation

- [x] T002 `lib/palette/gui.ts`: add `locked: boolean` to `GuiPaletteInput`; while `locked`, every `gui-res-*` row gets `disabled: true, description: "locked"`; export `pickGuiActions(actions, ids)` and `stripGuiLabel(label, arrowPrefix?)`; update `lib/palette/gui.test.ts` (locked gate, helpers). Update the file's header comment for the new input <!-- R3 R8 -->
- [x] T003 [P] `components/gui-toolbar-menu.tsx` (new) + `gui-toolbar-menu.test.tsx` (new): `GuiToolbarMenu` per R11 — anchored absolute rendering inside the wrapper, `POPOVER_SHELL`, `Control variant="menu-row"`, `label — description`, disabled rows, `MENU_ROW_CHECK_MARK` for `current`, roving keyboard, Escape/Tab close + refocus, outside-pointerdown close, keydown non-propagation, `data-testid="gui-toolbar-menu"` / `data-menu`. Tests: rows render, disabled inert, pick fires `onSelect` then `onClose`, Escape/outside close, arrow roving <!-- R11 -->
- [x] T004 `components/gui-toolbar.tsx`: rewrite per R3–R10 — props become `actions`, `zoom`, `pointerMode`, `coarsePointer`, `fullscreen`, `keyBarVisible`, `quality`, `statsVisible`, `connected`, `geometry`, `width`, `height`, `locked`, `wrapperWidth`, `revealSignal`; initial `shown = coarsePointer || fullscreen`; `openMenu` state suspending the hide timer; group rendering with dividers; resolution chip label (`TOOLBAR_SHORT_LABEL_MAX_PX = 400`) and aria-label; `⋯` below `TOOLBAR_OVERFLOW_MIN_PX = 560`; both menus built via `pickGuiActions` + `stripGuiLabel`; quality chip/row fires `gui-quality-<nextGuiQuality(current)>`; fullscreen toggle aria-labels. Rewrite the header comment (mount-for-all, by-id mirror, overflow rule) <!-- R2 R3 R4 R5 R6 R7 R9 R10 -->
- [x] T005 `components/gui-toolbar.test.tsx`: rewrite — show/hide machine (fine non-fullscreen starts hidden, menu suspends timer, interaction restarts), presence table (fine/coarse × connected × mirror × zoom edges), label derivation (auto / W×H / 🔒 / fallback / short below 400), resolution menu rows incl. `current`, `locked`, Auto-hidden-under-auto, no lock row on coarse; overflow at 375/559/560/1280; `⋯` menu rows; same-`onSelect`-object identity for every chip and row against one `buildGuiActions` list <!-- R2 R3 R4 R5 R6 R7 R8 R9 R10 -->
- [x] T006 `components/gui-surface.tsx`: mount gate → `!credentials` in the canvas branch; drop the `if (!fullscreen) return` in `onPointerMove`; bump `revealSignal` when `fullscreen` flips true; add the guarded `ResizeObserver` on `wrapperRef` → `wrapperWidth` state; new prop `guiActions: GuiPaletteAction[]`; pass `actions`, `connected`, `geometry`/`width`/`height`/`locked` (from `gui`), `wrapperWidth` to `GuiToolbar` and remove the retired callback props from the pill (keep them on `GuiSurface` for chords/pinch/seams). Update the header comment's Toolbar-pill bullet. Adjust `gui-surface.test.tsx` if it constructs the pill props <!-- R1 R2 R9 -->
- [x] T007 `components/surface-layout.tsx` + `app.tsx`: thread `guiActions` (the memoized `buildGuiActions` output, incl. the zen-fallback description patch) from `app.tsx` through `SurfaceLayout` to the lazy `GuiSurface`; pass `locked: gui?.locked ?? false` into `buildGuiActions`; `pnpm exec tsc --noEmit` clean <!-- R3 R8 -->
- [x] T008 [P] `components/gui-pointer.ts`: add `[data-testid="gui-toolbar-menu"]` to `CHROME_SELECTOR`; `gui-pointer.test.ts` § chrome pass-through gains a `gui-toolbar-menu` case <!-- R12 -->

### Phase 3: Integration & Edge Cases

- [x] T009 `tests/e2e/gui-surface.spec.ts`: add the R13 tests — 375×812 coarse (primary set + `⋯` one-row fit; `⋯` menu rows; resolution chip aria-label; `1280×720` row posts the exact `/api/gui/host/resize` body via `page.route`) and 1280×800 fine (absent by default; top-edge `mouse.move` reveals; no `⋯`; menu rows with `current`); Proves/Steps JSDoc on each; update the file header if shared setup changes. Run `just test-e2e "e2e/gui-surface"` (one spec per invocation; the `e2e/` prefix — never a bare name) and `just test-frontend` <!-- R13 -->
- [x] T010 Playwright verification on the `just dev` rig: start `just dev` for this worktree, drive it with a short node script (`require("playwright")` from `app/frontend`) or `just pw`, using the same `page.route` gui-signal stub the spec uses; save `375x812-coarse.png` (narrow pill, `⋯` menu open) and `1280x800-fine.png` (revealed wide pill, resolution menu open) to `fab/changes/260911-abna-gui-toolbar-for-all-viewers/shots/`; if the narrow pill wraps at 375, tune `TOOLBAR_SHORT_LABEL_MAX_PX` / chip set and re-shoot; stop the dev rig afterwards <!-- R14 -->

### Phase 4: Polish

- [x] T011 `docs/specs/gui.md` § The toolbar pill, HiDPI, and Send key: rewrite the pill paragraph per intake § 10 (mount-for-all, reveal rules, chip inventory and groups, resolution chip grammar, `⋯` below 560 px, menu behavior, by-id mirror; "amends V-D10's two-context rule; T-D1–T-D7 of `fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md` are the design log") <!-- R14 -->
- [x] T012 Full gate: `pnpm exec tsc --noEmit` (from `app/frontend`), `just test-frontend`, `just test-backend`, then `just test`; list any known environmental e2e failures by name in the result summary without investigating them <!-- R13 -->

## Execution Order

- T002 and T003 before T004 (T004 imports `pickGuiActions`/`stripGuiLabel` and `GuiToolbarMenu`)
- T004 before T005, T006; T006 before T007 (prop threading compiles only once `GuiSurface` accepts `guiActions`)
- T008 is independent of T002–T007
- T009 after T007; T010 after T009; T011 and T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GuiToolbar` is mounted in the canvas state for a fine-pointer non-fullscreen viewer and is not mounted while the credentials prompt is up
- [x] A-002 R2: a fine-pointer non-fullscreen pill starts hidden; a pointermove within 24 px of the wrapper top reveals it outside fullscreen; a tile tap reveals it; fullscreen entry bumps the reveal signal
- [x] A-003 R3: `GuiToolbar` takes `actions` and fires `row.onSelect` by id for every chip and menu row; `pickGuiActions` and `stripGuiLabel` are exported and tested; the retired callback props are gone from `GuiToolbar`
- [x] A-004 R4: the chip inventory, group order, dividers, and presence rules match the R4 table, and `gui-turn-off`/`gui-desktop`/`gui-logs`/`gui-hidpi-*`/`gui-view-1to1` never appear on the pill
- [x] A-005 R5: `⤢` renders for every viewer, fires `gui-fullscreen`, and its aria-label toggles `Enter fullscreen`/`Exit fullscreen`
- [x] A-006 R6: the resolution chip label and aria-label follow the R6 table (auto / W×H / 🔒 / fallback / short below 400) and the chip is absent when no `gui-res-*` row exists
- [x] A-007 R7: the resolution menu lists the palette's Resolution and Lock rows in order with stripped labels and verbatim descriptions; picking a size fires the row without a confirm
- [x] A-008 R8: `buildGuiActions` disables every `gui-res-*` row with description `locked` while `locked`
- [x] A-009 R9: `wrapperWidth` comes from a guarded `ResizeObserver`; below 560 the primary set + `⋯` render, at ≥ 560 all chips are inline with no `⋯`
- [x] A-010 R10: the `⋯` menu rows and order match R10 and the quality row fires the next preset's palette row
- [x] A-011 R11: `GuiToolbarMenu` is anchored inside the wrapper, uses the popover/menu-row primitives, handles roving keys, Escape/Tab, outside-pointerdown, and suspends the pill's hide timer while open
- [x] A-012 R12: `CHROME_SELECTOR` includes `gui-toolbar-menu` and the pass-through test covers it
- [x] A-013 R13: the vitest suites and the four new Playwright tests exist with Proves/Steps comments and pass on the worktree rig
- [x] A-014 R14: the spec section is rewritten and both screenshots exist under the change folder's `shots/`

### Behavioral Correctness

- [x] A-015 R1: the two existing coarse pill e2e tests ("shows on open, auto-hides, a tap re-shows it"; "Zoom in chip moves the badge to 100%") still pass
- [x] A-016 R2: the pill still hides 3 s after the last interaction when no menu is open
- [x] A-017 R4: zoom chips render disabled (not absent) at `fit`/`200`; `⎘`/`⌥` are absent when disconnected and `↻` present; launch chips and the resolution chip are absent on the `screen-sharing` backend

### Scenario Coverage

- [x] A-018 R7: e2e — tapping the `1280×720` row at 375×812 posts `{"geometry":"1280x720"}` to `/api/gui/host/resize`
- [x] A-019 R9: e2e — at 375×812 the pill's bounding box is ≤ 375 px wide and every chip shares one `top`
- [x] A-020 R2: e2e — at 1280×800 the pill has count 0 after the tile opens and becomes visible after a top-edge `mouse.move`
- [x] A-021 R10: e2e — the `⋯` menu at 375 lists `Quality → Balanced`, `Paste clipboard`, `Send key…`, `Open terminal`, `Open browser`, `Show stats` (the mocked-signal e2e never connects the RFB, so it asserts the presence-gated subset — `Quality → Balanced`, `Open terminal`, `Open browser`, `Show stats`, `Reconnect`; the full connected six-row list is asserted in vitest at gui-toolbar.test.tsx "the ⋯ menu carries the folded rows in order")

### Edge Cases & Error Handling

- [x] A-022 R6: `width`/`height` of 0 fall back to `presetLabel(geometry)` (no portrait suffix); an empty `geometry` with 0 sizes renders the chip without throwing
- [x] A-023 R11: a menu open across the 3-s mark stays open and the pill stays shown; Escape returns focus to the chip
- [x] A-024 R9: jsdom without `ResizeObserver` renders the surface without error; unit tests exercise widths by prop
- [x] A-025 R7: under `geometry="auto"` the `Auto (follow this tile)` row is absent from the menu; on a coarse pointer no lock row appears

### Code Quality

- [x] A-026 Pattern consistency: new code follows the surrounding component patterns (`Control` primitive, `controls.ts` constants, header comments stating constraints, not narration)
- [x] A-027 No unnecessary duplication: the menu is one component used by both chips; row selection uses `pickGuiActions`; no re-implemented palette logic
- [x] A-028 Type narrowing over assertions: no new `as` casts where an `if` guard or discriminated union serves
- [x] A-029 Tests included: new behavior has vitest coverage and the UI change has Playwright coverage with intent comments (constitution § Test Intent Comments)
- [x] A-030 Magic numbers named: 560 and 400 are exported constants; the 4-px menu gap is a named constant
- [x] A-031 Comment discipline: no comment narrates the next line, cites a change ID or PR number, or addresses the reviewer
- [x] A-032 Verification gates run: `pnpm exec tsc --noEmit`, `just test-frontend`, `just test-backend`, `just test` (known environmental e2e failures listed by name, not investigated) — reviewer re-ran tsc (clean), `just test-frontend` (4591 passed), and `just test-e2e "e2e/gui-surface"` (26 passed, real Xvnc rig included); the apply worker's full `just test` reported backend ok with the two known load flakes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Manual acceptance on the live `rk-gui` desktop (intake § 11) is a ship-time, once-only, orchestrator action behind the `tmux -L rk-daemon list-windows -t rk-jobs` guard — never part of apply or review.

## Deletion Candidates

- `app/frontend/src/components/gui-surface.tsx:225-242` — the `onPointerModeChange`, `onKeyBarVisibleChange`, `onQualityChange`, `onStatsVisibleChange`, and `onFullscreen` props have no remaining reader inside `GuiSurface` now that the pill fires `guiActions` rows by id (only `onZoomChange` is still consumed, via `onZoomChangeRef` and the wheel/pinch seams); T006's "chords/pinch/seams" rationale does not hold for these five
- `app/frontend/src/components/surface-layout.tsx:233-245,1659-1668` — the matching `onGuiPointerModeChange` / `onGuiKeyBarVisibleChange` / `onGuiFullscreen` / `onGuiQualityChange` / `onGuiStatsVisibleChange` pass-throughs exist only to feed those dead `GuiSurface` props (app.tsx's handler functions themselves stay — `buildGuiActions` consumes them)
- `app/frontend/src/components/gui-toolbar.tsx:93,106` — the `zoom` and `connected` props are declared per R3/T004 but never read; gating and presence ride the rows, so the props (and the `zoom` doc comment's "the prop only labels") carry no behavior

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Screenshots for the PR live under the change folder's `shots/` and ride the change branch | The PR must link two PNGs; the change folder is already committed by ship, and the intake asked for them "attached to the PR" | S:70 R:90 A:85 D:65 |
| 2 | Confident | The Playwright verification loop (T010) stubs the gui signal with the spec's `page.route` mock rather than requiring a live desktop on the dev rig | The dev rig has no gui enabled by default; the pill's rendering is signal-driven, so a stubbed signal is what the screenshots need | S:70 R:90 A:85 D:65 |
| 3 | Confident | The live-desktop manual acceptance is excluded from apply/review and left to the orchestrator at ship time | It touches a shared display and depends on a deployed daemon; the plan's own rule forbids running it while jobs are on the display | S:75 R:90 A:85 D:70 |
| 4 | Certain | Existing chip glyphs, `Control variant="chip"`, and the coarse `min-h-[36px]` touch rule are reused unchanged | context.md § Mobile Responsive Design and the shipped pill | S:85 R:90 A:95 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
