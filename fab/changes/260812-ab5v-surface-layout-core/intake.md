# Intake: Surface Layout Core

**Change**: 260812-ab5v-surface-layout-core
**Created**: 2026-08-12

## Origin

Conversational — designed in a `/fab-discuss` session on 2026-08-12 (mocked visually via
an iframe window, iterated across ~10 exchanges), then committed to spec and plan before
this intake was created:

- **Spec (authority)**: `docs/specs/surface-layout.md` — the model, rules L1–L4, verbs,
  retirement map. Read it first.
- **Execution plan**: `fab/plans/sahil/surface-layout.md` — this change is **Phase 2**;
  its Decision log rows are Certain and its Anti-decisions are binding.

> User's raw ask (condensed from the discussion): "I want a fluid layout system where
> each view or sub-window can be organized freely — the xterm window is a sub window,
> like the iframe view and the code view. The central pane becomes a view layout
> manager. When a user wants three surfaces, or wants to swap left and right — buttons
> on the surface ('expand', 'swap') can make up for missing drag-drop. Also: replace the
> right-rail text labels with icons, text becomes tooltips (fold into this change)."

## Why

1. **Pain**: The terminal route renders one exclusive lens in the main slot plus at most
   one surface in a fixed right-panel split. The highest-value arrangements (agent
   big-left, editor + served page stacked beside) are unreachable; the center can burn
   half the screen on an iframe window's inert shell pane while the wanted content sits
   squeezed in the panel. `View: Terminal / Code / Chat` menu rows read as exclusive
   modes and confuse; same-folder twin windows exist purely to work around one-lens-at-a-time.
2. **If unfixed**: every new projection deepens the exclusivity model (more `View:` rows,
   more synthetic twin windows), and the shipped panel hardcodes exactly one arrangement.
3. **This approach**: generalize placement, not the model — surfaces (substrate, lens)
   already exist (right-panel spec, shipped `260811-2r1w`/`260811-k3vp`); arrange 1–3 of
   them by **preset shapes × ordered surfaces × per-viewer ratios**. Presets (not free
   split trees) keep state enumerable, URL-encodable, and testable; every arrangement is
   reachable in ≤2 verb actions without drag-drop (drag lands later as sugar over the
   same mutations). All choice-state is client-side (URL + localStorage) per
   window-views R2/R7 — zero backend work.

## What Changes

All frontend (`app/frontend/src/` + `app/frontend/tests/`). No Go changes, no new
routes, no new window options, no SSE payload changes.

### 1. Layout state model + resolution ladder

- Layout = `(shape, order, ratios)`. Shapes (exact URL strings): `single`, `split-h`,
  `split-v`, `row`, `col`, `main-left`, `main-right`, `main-top`. Slot A = main slot in
  `main-*` shapes. Max 3 tiles (Constitution IV).
- One URL param on the existing `/$server/$window` route:
  `?layout=<shape>:<surface>,<surface>[,<surface>]` — e.g. `?layout=main-left:tty,code,web`.
- **Permanent translation shim** at route entry: `?view=X` → `?layout=single:X`;
  `?view=X&panel=Y[,Z]` → the matching 2/3-tile shape (`split-h` / `main-left` with X in
  slot A). Old deep links never break. Also translate the **localStorage predecessors**
  (last-chosen view / panel keys) into `rk-layout:*` values when no layout key exists yet.
- **Resolution ladder** on route entry: (1) URL `?layout=` → apply; (2) else
  localStorage `rk-layout:{server}:{@N window id}`; (3) else default-view hint (legacy
  `@rk_type=iframe` window → `single:web`); (4) else `single:tty`.
- Mirror the applied layout into the URL via `replaceState` (no history entry per layout
  tweak; window switches push entries as today — history restores "what you saw").
- Write localStorage **on user mutation only** (verbs, rail toggles, shape chip, divider
  drags) — never on merely arriving via a carried `?layout=`.
- Internal navigation (sidebar, ▾ switcher, palette) targets the **bare route**; the
  destination resolves its own layout. Layout readers consume resolved state, never
  parse `location.search` pre-ladder.
- Unknown shape or unavailable surface degrades tile-by-tile toward `tty` (R2 fallback
  spirit); a 3-tile layout with one unavailable surface renders the 2-tile shape.
- Ratios: per-viewer localStorage only (like panel width today), keyed per (window,
  shape). Never in the URL.

### 2. Tile renderer (replaces main slot + panel slot)

- The terminal route's center renders the resolved layout: 1–3 tiles, each mounting an
  existing surface renderer — `TerminalClient` (tty), `CodeSurface` (code), the
  web/iframe renderer (web) — unchanged inside a tile chrome.
- `tty` joins the surface registry: `(current window, tty)`, always available.
  Duplicate tty tiles of the same window are allowed (muxed `/ws/terminals` relay
  already supports N clients per pane).
- One tile per surface **kind** in v1 (no two `web` tiles — content addresses stay
  substrate state per R7).
- Hide-never-unmount (right-panel P3) holds per tile; **⏶ zoom hides other tiles at
  `display` level, never unmounts** (zoom is a transient, not layout state — no URL/
  localStorage change).
- Draggable dividers between tiles mutate **ratios only**, never shape. Force tiles
  live during a divider drag (IntersectionObserver suspension caused the board
  pane-resize mid-drag disconnect — same class of bug).

### 3. Surface header + verbs

Each tile gets a slim header: surface name, small meta (e.g. git root for code,
`@rk_url` host for web), and hover-revealed verb buttons (at rest they fade; buttons
are the mouse mirror — every verb is also a palette entry and a chord, Constitution V):

| Verb | Effect on (shape, order) |
|------|--------------------------|
| ⏶ Zoom | Transient full-center toggle; no state change |
| ◧ Promote | Move this surface to slot A; order permutes, shape unchanged |
| ⇄ Swap | Swap with neighbor (directional chords: swap left/right/up/down); order permutes |
| ✕ Close | Surface leaves; layout collapses to the smaller shape |

Palette entries: `Layout: Zoom <surface>` / `Layout: Promote <surface>` /
`Layout: Swap …` / `Layout: Close <surface>` / `Layout: Add <surface>` — plus per-shape
jumps (`Layout: main-left` …). Chord assignments follow the existing keybinding
registry patterns; register new shortcuts in the palette per code-review policy.

### 4. ▦ Layout chip (top-bar right cluster)

One chip in the terminal-route L1 tier: click opens a popover of preset-shape glyphs
(direct jump, current shape marked); a chord cycles to the next preset keeping order
(tmux `next-layout` muscle memory). The chip participates in the right-cluster overflow
registry like its peers.

### 5. Rail: toggles + icons

- Rail buttons become **open-tile toggles**: lit for every open tile; clicking an unlit
  icon adds that surface to the next slot; clicking a lit one closes its tile.
  Availability and the amber attention dot are unchanged (right-panel P4 — attention
  must escape whatever the layout hides).
- **Icons replace text labels** (user-requested fold-in): the shipped rail renders text
  ("web", "code"); replace with glyphs — `>_` tty, `◫` web, `{}` code (or equivalents
  consistent with the app's existing glyph vocabulary) — and move the text into
  tooltips.
- The `tty` rail button is new (the tty surface's toggle).

### 6. ViewSwitcher coexistence (this phase only)

The ViewSwitcher pill and `View:` chevron-menu rows **keep rendering and stay
consistent**: they set single-tile layouts through the shim (`View: Code` ⇒
`single:code`). Full removal is Phase 3 (see the plan) — keeping it here bounds this
diff. The switcher reflects slot A's surface when multi-tile.

### 7. Mobile (P5 carried forward)

Below `isMobileViewport()` multi-tile does not render: show slot A + the remaining
surfaces as sheet tabs (existing sheet pattern). A phone arriving at a 3-tile
`?layout=` URL shows slot A and offers the rest as tabs. Multi-tile is desktop-only in v1.

### Out of scope (binding anti-decisions, from the plan)

- No free split trees; no 4th tile.
- No server-side layout state (no POST, no SSE additions, no new window options).
- No drag-drop (later phase; verbs must reach every state).
- No `@rk_type`/switcher removal (Phase 3); no board adoption / `@rk_default_layout`
  (Phase 4).
- Do not execute the drafted `260714-t97o-web-view-lens` change — superseded by this
  plan (archive separately).

## Affected Memory

- `run-kit/ui-patterns`: (modify) window-view lenses + right panel sections gain the
  layout manager: (shape, order, ratios) model, `?layout=` ladder, tile verbs, rail
  toggle/icon semantics, ViewSwitcher coexistence note

## Impact

- `app/frontend/src/` — terminal route page (center render path), right-panel
  components (subsumed into tiles; rail button component), top-bar right cluster (▦
  chip + overflow registry), command palette registrations, keybindings, localStorage
  helpers, surface registry.
- `app/frontend/tests/` — new e2e for layout (verbs, ladder, shim, refresh/window-switch
  round-trips, history semantics, mobile tabs); existing panel/view e2e updated. Every
  new/changed `*.spec.ts` ships its `.spec.md` companion (constitution).
- **Perf watchout**: 3 tiles on a plaintext (HTTP/1.1) origin = SSE + ≤2 relay WS + 2
  iframes' subresource fetches — the 6-slot pool-starvation class from the board-route
  postmortem. Keep the bounded-WS discipline; e2e budgets tiles against the pool.
- No backend, no API, no routes.

## Open Questions

- (none — the discussion, spec, and plan resolved the design; remaining choices are
  graded below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Layout = (shape, order, ratios); preset shapes only; max 3 tiles | Plan Decision log #1 + spec § Model — discussed and committed | S:95 R:70 A:95 D:95 |
| 2 | Certain | `?layout=<shape>:<a>,<b>[,<c>]` subsumes `?view=`/`?panel=` via permanent translation shim | Plan #2, spec L1 — discussed ("old deep links never break") | S:95 R:75 A:95 D:90 |
| 3 | Certain | Ladder URL > localStorage `rk-layout:{server}:{@N}` > hint > `single:tty`; replaceState mirroring; write-on-user-mutation; bare-route internal nav | Plan #3–4, spec L2–L4 — each rung debated explicitly in the discussion | S:95 R:75 A:95 D:90 |
| 4 | Certain | Verbs ⏶ ◧ ⇄ ✕ + ▦ chip; all palette + chord reachable; zoom is transient (no state change) | Plan #5, spec § Verbs — user proposed the button-verbs approach | S:90 R:85 A:90 D:85 |
| 5 | Certain | Rail buttons become open-tile toggles; P4 attention unchanged | Plan #6 — user confirmed the semantics change when flagged | S:90 R:80 A:90 D:85 |
| 6 | Certain | One tile per surface kind; tty surface always available; duplicate tty tiles of one window allowed | Plan #7–8 — R7 reasoning discussed | S:90 R:80 A:90 D:85 |
| 7 | Certain | Mobile: slot A + sheet tabs; multi-tile desktop-only v1 | Plan #9, spec § Mobile — mirrors right-panel P5 call | S:85 R:85 A:90 D:85 |
| 8 | Certain | Rail icons replace text labels; labels become tooltips | User-requested fold-in, verbatim | S:95 R:95 A:90 D:95 |
| 9 | Certain | ViewSwitcher keeps rendering this phase, driving single-tile layouts through the shim; removal is Phase 3 | Plan Phase-2 scope — bounds the diff deliberately | S:85 R:90 A:90 D:85 |
| 10 | Confident | Exact shape strings: `single`, `split-h`, `split-v`, `row`, `col`, `main-left`, `main-right`, `main-top` | Named in plan/spec; exact spelling is mine — trivially renameable pre-ship | S:70 R:90 A:80 D:75 |
| 11 | Confident | Translation shim also migrates localStorage predecessors (old view/panel keys → layout keys when no layout key exists) | Plan Phase-2 scope line; preserves users' per-window view memory | S:70 R:85 A:80 D:75 |
| 12 | Confident | Ratios keyed per (window, shape) in localStorage; never URL | Discussed ("ratios stay in localStorage like panel width"); per-shape keying is mine (a ratio is meaningless across shapes) | S:65 R:90 A:80 D:75 |
| 13 | Confident | Specific chord assignments follow the existing keybinding registry's patterns and avoid documented collisions (`⌘.` view-cycle, `⇧⌘.` panel toggle) | Registry + palette conventions give the answer; easily rebound | S:55 R:95 A:80 D:70 |
| 14 | Confident | Icon glyphs: `>_` tty, `◫` web, `{}` code, `⛭` agents — or nearest equivalents in the app's glyph vocabulary | From the approved mock; final glyph choice defers to existing vocabulary at apply | S:60 R:95 A:75 D:70 |
| 15 | Confident | Unavailable/unknown layout parts degrade tile-by-tile toward `tty` (3-tile with one unavailable surface renders the 2-tile shape) | R2's fallback spirit extended; discussed availability-vs-content split | S:60 R:80 A:80 D:70 |

15 assumptions (9 certain, 6 confident, 0 tentative, 0 unresolved).
