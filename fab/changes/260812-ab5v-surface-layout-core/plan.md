# Plan: Surface Layout Core

**Change**: 260812-ab5v-surface-layout-core
**Intake**: `intake.md`

> Authority chain: `docs/specs/surface-layout.md` (model, L1–L4, verbs) →
> `fab/plans/sahil/surface-layout.md` Phase 2 (scope, anti-decisions) → this plan.
> Existing seams to extend (read before coding): `app/frontend/src/lib/window-view.ts`
> (resolveView ladder, storage-key pattern), `app/frontend/src/lib/right-panel.ts`
> (surface registry, panel width clamps), `app/frontend/src/app.tsx` (render branch),
> `app/frontend/src/components/right-panel.tsx` (rail + panel + divider drag).

## Requirements

### Layout Model: state & resolution (`lib/surface-layout.ts`, new)

#### R1: Layout type and preset shapes
A layout SHALL be `(shape, order, ratios)` with shapes exactly `single`, `split-h`,
`split-v`, `row`, `col`, `main-left`, `main-right`, `main-top`; `order` is 1–3 surface
names from the tileable set `tty | web | chat | code`; slot A (first) is the main slot
in `main-*` shapes. Shape arity is fixed (`single`=1, `split-*`=2, others=3); a layout
MUST carry exactly its shape's arity. Surface kinds MUST NOT repeat within one layout
**except `tty`** — duplicate tty tiles of the same window are allowed (the muxed
relay supports N clients). All helpers live in a new pure, DOM-free
`app/frontend/src/lib/surface-layout.ts` following the `window-view.ts` pattern
(colocated unit tests, no React imports).

- **GIVEN** the string `main-left:tty,code,web`
- **WHEN** parsed
- **THEN** it yields `{shape: "main-left", order: ["tty","code","web"]}` and
  serializes back byte-identically
- **AND** `main-left:tty,code` (arity mismatch) and `row:tty,web,web` (repeated
  non-tty kind) are rejected as invalid

#### R2: `?layout=` param and the permanent translation shim
The terminal route SHALL accept `?layout=<shape>:<a>,<b>[,<c>]`. A translation shim at
route entry SHALL map legacy params before resolution: `?view=X` → `single:X`;
`?view=X&panel=Y` → `split-h:X,Y` (X in slot A). It SHALL also migrate localStorage
predecessors: when no `rk-layout` key exists for a window, a stored
`runkit-window-view` / `runkit-window-panel` value seeds the equivalent layout value
(single or split-h). Legacy keys are left in place (other tabs may be older).

- **GIVEN** a deep link `/$server/$window?view=code&panel=web`
- **WHEN** the route mounts
- **THEN** the resolved layout is `split-h:code,web` and the URL is rewritten via
  `replaceState` to `?layout=split-h:code,web`

#### R3: Resolution ladder, mirroring, write discipline
Layout resolution SHALL follow: (1) valid URL `?layout=` → (2) localStorage
`rk-layout:{server}:{@N windowId}` → (3) default-view hint (`defaultView(win)` — a
legacy `@rk_type=iframe` window yields `single:web`) → (4) `single:tty`. The applied
layout SHALL be mirrored to the URL with `replaceState` (never `pushState` for layout
changes). localStorage SHALL be written only on user-initiated mutations (verbs, rail
toggles, chip, divider release) — never on arrival via a carried `?layout=`. Internal
navigation (sidebar, switcher, palette) SHALL target the bare route with no layout
param. Layout consumers SHALL read resolved state, never parse `location.search`
directly.

- **GIVEN** window A showing `main-left:tty,code,web` (user-built) and window B never
  customized
- **WHEN** the user switches A → B → A via the sidebar
- **THEN** B resolves `single:tty` (or its hint) and A restores
  `main-left:tty,code,web` from localStorage, each mirrored into the URL
- **AND** pressing the browser back button returns to the URL (and layout) each
  history entry carried

#### R4: Availability degradation
An unavailable surface in a resolved layout SHALL degrade tile-by-tile: drop the
unavailable surface(s) and render the remaining order in the matching smaller-arity
shape (3→2: `split-h` preserving order with slot A kept; 2→1: `single`); unknown shape
or fully-invalid value falls back through the ladder's next rung. `tty` is always
available (R3 of window-views).

- **GIVEN** a deep link `?layout=main-left:tty,code,web` to a window with no `@rk_url`
- **WHEN** resolved
- **THEN** the render is `split-h:tty,code` and no broken iframe mounts

#### R5: Ratios
Divider drags SHALL mutate ratios only (never shape/order), clamped per the existing
`clampPanelWidth` approach, persisted per-viewer in localStorage keyed
`rk-layout-ratios:{server}:{windowId}:{shape}` on drag release. Ratios never appear in
the URL. Tiles MUST stay live during a drag (no IntersectionObserver suspension
unmount mid-drag — the board pane-resize bug class).

- **GIVEN** a `split-h:tty,code` layout
- **WHEN** the divider is dragged and released
- **THEN** the ratio persists across refresh for that window+shape, and the layout
  string in the URL is unchanged

### Renderer: tiles (`components/surface-layout.tsx`, new; `app.tsx` integration)

#### R6: Tile renderer replaces main slot + panel slot
The terminal route's center SHALL render the resolved layout as 1–3 tiles mounting the
existing renderers unchanged: `TerminalClient` (tty), `CodeSurface` (code), the
iframe/web renderer (web), `ChatView` (chat). The legacy single-lens render branch and
the right-panel surface mount in `app.tsx` are replaced by this renderer (the rail
remains). Hide-never-unmount holds per tile: surfaces previously opened this visit
stay mounted `display:none` when closed/zoomed away (matching the panel's P3
behavior); ⏶ zoom is a transient render state (one tile full-center, others hidden at
display level) with **no** URL/localStorage change.

- **GIVEN** `main-left:tty,code,web`
- **WHEN** the user zooms the code tile and un-zooms
- **THEN** the other tiles reappear with editor/terminal state intact and the URL
  never changed

#### R7: Surface header + verbs
Each tile SHALL render a slim header (surface name + small meta + hover-revealed verb
buttons; at rest the buttons fade per the existing hover-cluster pattern): ⏶ zoom,
◧ promote (move to slot A; order permutes, shape unchanged), ⇄ swap (with next
neighbor in order), ✕ close (layout collapses to the smaller-arity shape preserving
remaining order). Promote/swap/close SHALL write localStorage + mirror the URL (R3
discipline); `single` layouts render no ◧/⇄ and closing the last tile is disallowed
(✕ hidden on `single`).

- **GIVEN** `main-left:tty,code,web`
- **WHEN** ◧ is clicked on the code tile
- **THEN** the layout becomes `main-left:code,tty,web`, persisted and mirrored

#### R8: `tty` joins the surface registry
`lib/right-panel.ts`'s `SurfaceName`/`availableSurfaces` SHALL gain `tty` (always
available, listed first) — or the registry moves into `surface-layout.ts` re-exporting
for the rail — such that rail and layout share one registry with `window-view.ts`'s
capability helpers (`hasWebUrl`/`hasChat`/`hasCode`) as the single availability
source.

- **GIVEN** any window
- **WHEN** `availableSurfaces` is computed
- **THEN** it includes `tty` first, then `web`/`chat`/`code` per capability

### Chrome: chip, rail, palette, switcher

#### R9: ▦ Layout chip
The top-bar right cluster (terminal-route L1 tier) SHALL gain a Layout chip: click
opens a popover of preset-shape glyphs valid for the current tile count (current shape
marked; clicking jumps directly); it SHALL participate in the right-cluster overflow
registry like its peers (menuOnly row when squeezed). A chord cycles to the next
same-arity preset keeping order.

- **GIVEN** `main-left:tty,code,web`
- **WHEN** the cycle chord fires
- **THEN** the shape advances to the next 3-tile preset (`main-right`), order intact

#### R10: Rail toggles + icons
Rail buttons SHALL become open-tile toggles: lit for each open tile; clicking an unlit
available surface appends it (arity grows: 1→2 `split-h`, 2→3 `main-left`, at 3 the
remaining unlit buttons render disabled with a "close a tile first" tooltip); clicking
a lit one closes its tile (R7 close semantics). A `tty` rail button joins the rail.
Rail buttons SHALL render icon glyphs instead of text labels — `>_` tty, `◫` web, `⌸`
chat, `{}` code (or nearest equivalents consistent with `top-bar-icons.tsx`
vocabulary) — with the previous text moving to tooltips (existing `Tip` component).
Availability dots and the attention-dot seam are unchanged (P4).

- **GIVEN** a `single:tty` layout on a code-capable window
- **WHEN** the code rail icon is clicked
- **THEN** the layout becomes `split-h:tty,code`, the icon lights, and its tooltip
  reads "Code"

#### R11: Palette + chords
The command palette SHALL gain: `Layout: Add <surface>` / `Layout: Close <surface>`
(per available/open surface), `Layout: Zoom` / `Layout: Promote` / `Layout: Swap` (for
the focused/slot-A tile), and per-shape jumps (`Layout: main-left` …) for the current
arity. Chords register through the existing keybinding registry
(`lib/keybindings.ts` + `use-keybinding-dispatch.ts`), avoiding documented collisions
(`⌘.` view-cycle, `⇧⌘.` panel toggle); every new shortcut appears in the shortcuts
overlay per the palette-registration review rule.

- **GIVEN** the palette open on a terminal route
- **WHEN** the user types "layout"
- **THEN** the layout entries appear and execute the same mutations as the buttons

#### R12: ViewSwitcher coexistence (this phase)
The ViewSwitcher pill and `View:` overflow rows SHALL keep rendering: selecting a view
there SHALL set the layout to `single:<view>` (through the same mutation path,
counting as a user mutation). When the layout is multi-tile the switcher SHALL reflect
slot A's surface. No removal in this change (Phase 3 owns it).

- **GIVEN** `split-h:tty,code`
- **WHEN** the user picks `View: Web` in the switcher
- **THEN** the layout becomes `single:web` (persisted, mirrored) and the switcher
  shows web active

### Mobile

#### R13: Slot A + sheet tabs below the mobile threshold
Below `isMobileViewport()` the center SHALL render only slot A; the remaining resolved
surfaces SHALL be reachable as tabs in the existing sheet pattern (bottom-bar chip →
full-height sheet, surfaces as tabs). Multi-tile grid, dividers, and tile verb buttons
do not render on mobile. A 3-tile `?layout=` URL on a phone shows slot A and offers
the rest as sheet tabs.

- **GIVEN** a 375px viewport arriving at `?layout=main-left:tty,code,web`
- **WHEN** the route mounts
- **THEN** the tty renders full-width, and the sheet exposes Code and Web tabs

### Non-Goals

- Free split trees, a 4th tile, drag-drop, board adoption, `@rk_default_layout`,
  ViewSwitcher/`@rk_type` removal — later phases (plan Anti-decisions, binding).
- No backend/API/SSE/window-option changes of any kind.
- The `agents` surface (companion windows) — not yet shipped; the registry stays
  open-ended for it.

### Design Decisions

#### Chat is a tileable surface kind
**Decision**: The tileable set is `tty | web | chat | code` — chat tiles mount
`ChatView`.
**Why**: `chat` is a shipped lens in `window-view.ts`'s registry; excluding it would
leave the switcher able to show a surface the layout cannot, breaking R12's shim.
**Rejected**: tty/web/code only (the intake's shorthand) — would regress chat users.
*Introduced by*: 260812-ab5v-surface-layout-core

#### 2-tile legacy shim maps to `split-h`
**Decision**: `?view=X&panel=Y` → `split-h:X,Y`; growth 1→2 appends as `split-h`,
2→3 as `main-left`.
**Why**: `split-h` is the visual continuation of today's main+panel split; `main-left`
keeps the incumbent slot-A tile dominant on growth.
**Rejected**: mapping to `main-left` at 2 tiles (no third tile to justify the
asymmetric shape).
*Introduced by*: 260812-ab5v-surface-layout-core

#### New helpers in `lib/surface-layout.ts`, registry consolidation minimal
**Decision**: New pure module owns parse/serialize/ladder/mutations; `right-panel.ts`
keeps width/ratio helpers and gains `tty` in the registry rather than being rewritten.
**Why**: Mirrors the shipped `window-view.ts` pure-helper pattern (unit-testable,
drift-free single source); minimizes churn in shipped, tested code.
**Rejected**: rewriting `right-panel.ts` wholesale into the new module (bigger diff,
no behavioral gain this phase).
*Introduced by*: 260812-ab5v-surface-layout-core

## Tasks

### Phase 1: Setup — pure model

- [x] T001 Create `app/frontend/src/lib/surface-layout.ts`: `LayoutShape`/`Layout`
  types, shape arity table, parse/serialize for `<shape>:<a>,<b>[,<c>]`, validation
  (arity, duplicate-kind-except-tty), tileable-surface availability via
  `window-view.ts` helpers <!-- R1 -->
- [x] T002 Add ladder + shim to `surface-layout.ts`: `resolveLayout(search, stored,
  win)` (URL > stored > hint > single:tty), legacy translation (`view`/`panel` params
  → layout; `runkit-window-view`/`runkit-window-panel` storage seeding), tile-by-tile
  availability degradation, storage keys `rk-layout:{server}:{windowId}` +
  `rk-layout-ratios:{server}:{windowId}:{shape}` with try/catch-noop read/write <!-- R2, R3, R4, R5 -->
- [x] T003 Add mutation helpers to `surface-layout.ts`: `promote`, `swapWithNext`,
  `closeSurface` (arity collapse), `addSurface` (1→2 `split-h`, 2→3 `main-left`),
  `cycleShape` (same-arity ring), `setShape` <!-- R7, R9, R10 -->
- [x] T004 [P] Unit tests `app/frontend/src/lib/surface-layout.test.ts`: parse/
  serialize round-trips, invalid rejections, ladder precedence incl. hint rung, shim
  translations (params + storage seeding), degradation cases, every mutation helper,
  ratio key shape <!-- R1, R2, R3, R4, R5 -->

### Phase 2: Core Implementation — renderer

- [x] T005 Create `app/frontend/src/components/surface-layout.tsx`: the tile grid
  renderer — shape → CSS grid mapping, tile chrome (header: name, meta,
  hover-revealed ⏶ ◧ ⇄ ✕ buttons), mounts existing renderers (`TerminalClient`,
  `CodeSurface`, web/iframe renderer, `ChatView`) per surface, hide-never-unmount
  bookkeeping, zoom transient state <!-- R6, R7 -->
- [x] T006 Dividers in `surface-layout.tsx`: drag mutates ratios only (reuse
  `clampPanelWidth`-style clamps), persist on release, keep tiles live during drag
  (no suspension unmount) <!-- R5 -->
- [x] T007 Integrate in `app/frontend/src/app.tsx`: replace the exclusive lens render
  branch + panel surface mount with the layout renderer; wire the resolution ladder at
  route entry, `replaceState` mirroring, write-on-user-mutation discipline; keep the
  rail mounted; bare-route internal nav unchanged <!-- R3, R6 -->
- [x] T008 Add `tty` to the surface registry (`lib/right-panel.ts`
  `SurfaceName`/`availableSurfaces` or relocated registry re-exported) so rail +
  layout + switcher share one source <!-- R8 -->
- [x] T009 [P] Unit tests `components/surface-layout.test.tsx`: shape rendering per
  arity, verb buttons mutate + persist, zoom hides without unmount, degradation
  render, duplicate-tty tiles mount two TerminalClients <!-- R6, R7 -->

### Phase 3: Integration & Edge Cases — chrome

- [x] T010 Layout chip in `app/frontend/src/components/top-bar.tsx` (+
  `top-bar-icons.tsx` glyph, `lib/top-bar-overflow.ts` registry row): popover of
  arity-valid preset glyphs, current marked, direct jump; cycle chord <!-- R9 -->
- [x] T011 Rail rework in `app/frontend/src/components/right-panel.tsx`: toggle
  semantics (add/close via mutation helpers), lit-per-open-tile, disabled+tooltip at
  3 tiles, `tty` button added, icon glyphs replace text labels with labels as `Tip`
  tooltips <!-- R10 -->
- [x] T012 Palette + keybindings: register `Layout:` entries in
  `components/command-palette.tsx` (+ `lib/palette-view.ts` patterns) and chords in
  `lib/keybindings.ts`/`hooks/use-keybinding-dispatch.ts`; add to shortcuts overlay;
  avoid `⌘.`/`⇧⌘.` collisions <!-- R11 -->
- [x] T013 ViewSwitcher wiring in `components/view-switcher.tsx`: selection sets
  `single:<view>` through the shared mutation path; multi-tile reflects slot A <!-- R12 -->
- [x] T014 Mobile: slot-A-only render below `isMobileViewport()` + remaining surfaces
  as sheet tabs (extend the existing sheet/bottom-bar chip pattern) <!-- R13 -->
- [x] T015 [P] Unit tests for chip (arity filtering, cycle), rail toggles (add/close/
  disabled), switcher shim, mobile branch <!-- R9, R10, R12, R13 -->

### Phase 4: Polish — e2e

- [x] T016 e2e `app/frontend/tests/surface-layout.spec.ts` (+ **`.spec.md`
  companion**): legacy `?view=`/`?panel=` deep links resolve identically; build
  3-tile via rail + verbs; refresh restores; A→B→A window-switch round-trip;
  back/forward historical layouts; divider ratio persists; mobile tabs at 375px.
  Budget tiles against the h1 6-slot pool (plaintext origin) — prefer `single`/
  2-tile flows except one bounded 3-tile test <!-- R2, R3, R5, R7, R10, R13 -->
- [x] T017 Update existing affected e2e + their `.spec.md` companions (panel/view
  specs asserting the old single-surface panel or `?view=` URLs) to the layout
  model <!-- R6, R12 -->

## Execution Order

- T001 → T002 → T003 (model builds on itself); T004 after T003
- T005 → T006 → T007 (renderer then integration); T008 before T011
- Phase 3 tasks depend on T007; T010–T014 are mutually independent after it
- T016/T017 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `surface-layout.ts` parses/serializes all eight shapes with arity +
  duplicate-kind validation, pure and DOM-free with colocated tests
- [x] A-002 R2: `?layout=` accepted; `?view=`/`?view=&panel=` deep links and legacy
  localStorage values resolve to equivalent layouts (shim, permanent)
- [x] A-003 R3: ladder order URL > localStorage > hint > `single:tty`;
  `replaceState` mirroring; localStorage written only on user mutation
- [x] A-004 R6: center renders 1–3 tiles mounting the four existing renderers
  unchanged; legacy exclusive branch + panel mount removed from `app.tsx`
- [x] A-005 R7: all four verbs present as hover header buttons with the specified
  (shape, order) effects; `single` hides ◧/⇄/✕
- [x] A-006 R8: `tty` in the shared surface registry, always available, listed first
- [x] A-007 R9: layout chip renders arity-valid presets, jumps directly, cycles via
  chord, participates in the overflow registry
- [x] A-008 R10: rail toggles add/close tiles; disabled+tooltip at 3; icons replace
  text with text as tooltips; `tty` button present
- [x] A-009 R11: palette `Layout:` entries + chords registered, in shortcuts overlay,
  no collision with `⌘.`/`⇧⌘.`
- [x] A-010 R12: ViewSwitcher drives `single:<view>` and reflects slot A when
  multi-tile
- [x] A-011 R13: mobile renders slot A only with remaining surfaces as sheet tabs

### Behavioral Correctness

- [x] A-012 R3: window switch A→B→A restores each window's own layout; back/forward
  restores historical layouts (replaceState/pushState split verified)
- [x] A-013 R4: unavailable surfaces degrade tile-by-tile (3→2→1) with slot A
  preserved; unknown values fall through the ladder
- [x] A-014 R5: divider drag mutates ratios only, persists per (window, shape), never
  touches the URL; tiles stay live mid-drag
- [x] A-015 R6: zoom is transient — no URL/localStorage change; un-zoom restores
  tiles with state intact (no unmount)

### Scenario Coverage

- [x] A-016 R2: e2e proves a legacy `?view=code&panel=web` deep link renders
  `split-h:code,web` with the rewritten URL
- [x] A-017 R7: e2e builds a 3-tile layout and rearranges it using only verbs/rail
  (no drag), reaching promote/swap/close outcomes
- [x] A-018 R13: e2e at 375px shows slot A + sheet tabs for a 3-tile URL

### Edge Cases & Error Handling

- [x] A-019 R1: malformed `?layout=` (bad shape, wrong arity, repeated non-tty kind)
  never renders a broken tile — falls through the ladder
- [x] A-020 R10: at 3 tiles, unlit rail buttons are disabled with an explanatory
  tooltip rather than silently no-oping
- [x] A-021 R6: duplicate tty tiles of one window render two live terminals without
  relay errors

### Code Quality

- [x] A-022 Pattern consistency: new modules follow the `window-view.ts`/
  `right-panel.ts` pure-helper + colocated-test pattern; components match surrounding
  naming/idiom
- [x] A-023 No unnecessary duplication: capability checks reuse
  `hasWebUrl`/`hasChat`/`hasCode`; clamping reuses the existing approach; no second
  view-resolution path survives (the shim funnels into one resolver)
- [x] A-024 Type narrowing over assertions: untrusted URL/localStorage strings are
  validated via guards, no `as` casts on parse paths
- [x] A-025 No client polling: layout state changes are event-driven; SSE remains the
  only live-data channel
- [x] A-026 New/changed Playwright specs ship matching `.spec.md` companions in the
  same commit

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/lib/window-view.ts` `resolveView` — no production callers left; `resolveLayout` subsumes it (only tests + comments reference it). Phase 3 retirement-sweep material.
- `app/frontend/src/lib/window-view.ts` `writeStoredView` — no production callers; the layout mutation path writes `rk-layout:` keys instead (`readStoredView` survives for the legacy-seed path in `app.tsx`'s switch classification).
- `app/frontend/src/lib/right-panel.ts` `resolvePanel` — no production callers; the panel slot is a tile now.
- `app/frontend/src/lib/right-panel.ts` `writeStoredPanel` / `removeStoredPanel` — no production callers (`readStoredPanel` survives for legacy seeding).
- `app/frontend/src/lib/right-panel.ts` panel-width machinery (`clampPanelWidth`, `readStoredPanelWidth`, `writeStoredPanelWidth`, `PANEL_WIDTH_STORAGE_KEY`, `DEFAULT_PANEL_WIDTH_PCT`, `MAX_PANEL_WIDTH_PCT`) — the panel width drag is gone with the panel slot; only `MIN_PANEL_WIDTH_PX` survives in production (via `clampRatio`).
- `app/frontend/src/app.tsx:68,105-107` — now-unused imports `ChatView`, `TerminalClient`, `IframeWindow`, `CodeSurface` (the renderers moved into `SurfaceLayout`; only comments reference them; tsc stays green because `noUnusedLocals` is off).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `chat` joins the tileable set (`tty\|web\|chat\|code`) | Shipped lens registry in `window-view.ts`; excluding it breaks R12's switcher shim | S:80 R:85 A:90 D:85 |
| 2 | Confident | 2-tile shim/growth shape is `split-h`; 2→3 growth is `main-left` | Visual continuation of today's main+panel; slot-A dominance on growth | S:60 R:90 A:80 D:70 |
| 3 | Confident | New module named `lib/surface-layout.ts` + `components/surface-layout.tsx`; `right-panel.ts` gains `tty` rather than being rewritten | Mirrors shipped pure-helper pattern; minimal churn in tested code | S:65 R:90 A:85 D:75 |
| 4 | Confident | Ratio storage keyed per (window, shape); persisted on drag release only | A ratio is meaningless across shapes; release-persist matches panel-width behavior | S:60 R:90 A:80 D:75 |
| 5 | Confident | At 3 tiles, further rail adds render disabled+tooltip (not swap-in) | Max-3 is binding; silent no-op hides the constraint, swap-in surprises | S:55 R:85 A:75 D:70 |
| 6 | Confident | Chat glyph `⌸` (or nearest in `top-bar-icons.tsx` vocabulary); final glyphs defer to existing vocabulary at apply | Intake assumption 14 extended to the fourth surface | S:55 R:95 A:75 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
