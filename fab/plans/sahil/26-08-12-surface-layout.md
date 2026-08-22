# Plan: Surface Layout Manager (the center as a layout of surfaces)

**Authored**: 2026-08-12
**Author**: discussion session with Claude (`/fab-discuss`)
**Executor**: agents picking up changes one by one, each via the normal fab pipeline
**Status**: Spec authored (`docs/specs/surface-layout.md`). Phase 2 (layout core)
starting via `/fab-new` + `/fab-fff` in the authoring session. Phases 3–4 open for
pickup — each phase section below is self-contained enough to intake from.

## Goal

Replace the terminal route's exclusive main slot + fixed right-panel slot with a
**surface layout manager**: 1–3 tiles, each a (substrate, lens) surface, arranged by
preset shapes with an ordered surface list and per-viewer ratios. End state: the tty
is just another surface; `View:` exclusivity and `@rk_type` identity are retired;
layouts are URL-addressable and per-window persistent.

**The spec is the authority** — read `docs/specs/surface-layout.md` first at every
pickup. This plan adds execution ordering, per-phase scope, and the decisions that
bound each change. If spec and plan disagree, the spec wins (and fix the plan).

## Strategic framing (why this shape)

- The rail + panel (shipped: `260811-2r1w`, `260811-k3vp`) already proved the
  surface model; this generalizes *placement*, not the model.
- Preset shapes (not free split trees) keep the state space enumerable:
  URL-encodable, cyclable, testable. Every (shape × order) state reachable in ≤2
  verb actions without drag-drop; drag lands later as sugar over the same mutations.
- All choice-state moves to URL + localStorage (window-views R2/R7 discipline);
  all rk- variables that survive are capability/content signals, not view state.

## Decision log (committed by this plan — intakes should treat these as Certain)

1. **Layout = (shape, order, ratios).** Shapes: `single`, `split-h`, `split-v`,
   `row`, `col`, `main-left`, `main-right`, `main-top`. Slot A = main. Max 3 tiles.
2. **One URL param**: `?layout=<shape>:<a>,<b>[,<c>]` — subsumes `?view=` and
   `?panel=` via a **permanent translation shim** at route entry (old deep links
   never break).
3. **Resolution ladder**: URL > localStorage `rk-layout:{server}:{@N}` >
   default-view hint (legacy `@rk_type=iframe` → single `web` tile) > single `tty`.
   Mirror applied layout to the URL via `replaceState`. Write localStorage on
   **user mutation only** (never on arrival via a carried `?layout=`).
4. **Internal navigation targets the bare route** — the destination window resolves
   its own layout. History entries carry the layout they had (L4: back/forward
   restores "what you saw").
5. **Verbs**: ⏶ zoom (transient), ◧ promote-to-A, ⇄ swap-with-neighbor (directional
   chords), ▦ cycle/pick shape (one top-bar chip with preset-glyph popover),
   ✕ close. All palette + chord reachable (Constitution V).
6. **Rail buttons become open-tile toggles** (lit per open tile; click to add/close).
   Right-panel P4 (attention escapes) unchanged.
7. **One tile per surface kind** in v1 (no two `web` tiles — content addresses stay
   substrate state, R7).
8. **tty is a surface**: (current window, tty), always available. Duplicate tty
   tiles of the same window are allowed (muxed relay already supports N clients).
9. **Mobile**: multi-tile is desktop-only in v1; below `isMobileViewport()` show
   slot A + remaining surfaces as sheet tabs.
10. **`@rk_url`/`@rk_chat`/`@rk_owner`/`@rk_agent_state` stay** (capability/
    content/topology/status). **`@rk_type` identity dies** (→ hint → gone, phase 3).
11. **No `@rk_layout` window option.** Per-viewer durability = localStorage;
    shared durability = boards/settings.yaml (phase 4). A creation-time
    `@rk_default_layout` hint is phase 4, optional.

## Anti-decisions (binding)

- **No free split trees** — presets only. A fourth tile is the signal the user
  wanted a board (Constitution IV).
- **No server-side layout state** — no POST, no SSE payload additions for layout,
  no new window options in phases 2–3 (Constitution II/X).
- **Do not build drag-drop in phase 2.** Verbs first; drag is a later input method
  over the same (shape, order, ratios) mutations.
- **Do not resurrect `260714-t97o-web-view-lens`** — the drafted change is
  superseded by this plan (a `web` tile IS the web lens beside the tty). Archive
  the draft rather than executing it.

## Phase 2 — Layout core (fab change, full lane — IN FLIGHT via authoring session)

The tile renderer replacing main slot + panel on the terminal route. Frontend-only.

**Scope:**
- Layout state model + resolution ladder + `replaceState` mirroring + translation
  shim for `?view=`/`?panel=` and their localStorage predecessors.
- Preset renderer: shapes above; draggable dividers mutate ratios only (ratios in
  localStorage, never the URL).
- Surface headers per tile (name + meta + hover verb buttons ⏶ ◧ ⇄ ✕); ▦ layout
  chip in the top-bar right cluster with preset popover; palette entries + chords
  for every verb.
- Rail toggle semantics; `tty` surface registry row.
- **Rail icons (folded-in micro change, user-requested 2026-08-12):** the shipped
  rail renders text labels ("web", "code"); replace with icon glyphs (`>_` tty,
  `◫` web, `{}` code, `⛭` agents — or equivalents consistent with the app's glyph
  vocabulary) and move the text into tooltips. Matches right-panel.md's original
  "icon rail" language.
- Existing renderers (TerminalClient, CodeSurface, iframe/web renderer) mount
  inside tiles unchanged; hide-never-unmount (P3) holds per tile; zoom hides
  (display-level), never unmounts.
- Keep the ViewSwitcher pill and `View:` rows **rendering but consistent** during
  this phase (they set single-tile layouts through the shim) — full removal is
  phase 3, so phase 2's diff stays reviewable.

**Watchouts (from memory/postmortems):**
- HTTP/1.1 6-slot pool starvation on plaintext origins (board-route postmortem):
  3 tiles = SSE + ≤2 relay WS + 2 iframes. Keep the bounded-WS discipline; e2e
  budgets tiles against the pool; static imports for xterm chunks.
- IntersectionObserver suspension vs divider drags (board pane-resize postmortem):
  force tiles live during a drag.
- Playwright: `pointer-events-none`-at-rest hover clusters need `.hover()` first;
  mutating-route mocks need trailing `*` globs.
- Every new/changed `*.spec.ts` ships its `.spec.md` companion (constitution).

**Acceptance sketch:** old `?view=`/`?panel=` deep links resolve identically;
3-tile main-left arranges via verbs only (no mouse) and via buttons; refresh
restores per-window layouts; window switch A→B→A round-trips both layouts;
back/forward restores historical arrangements; mobile shows slot A + tabs.

## Phase 3 — Retirement sweep (fab change, small)

Pure deletion + migration, after phase 2 soaks.

- `@rk_type=iframe`: stop honoring as identity; honor as ladder-rung-3 hint only.
  Remove the `>_` button's `POST @rk_type: null` path (and its API handler if
  nothing else uses it).
- Remove the ViewSwitcher pill and `View:` chevron-menu rows (rail + ▦ chip are
  the sole affordances). Sweep palette entries.
- Snapshot round-trip: keep `@rk_type`/`@rk_url` in the option set while any
  legacy windows exist; note the eventual `@rk_type` drop in
  `docs/memory/run-kit/layout-snapshots.md` at hydrate.
- e2e sweep: specs asserting switcher/`View:` rows move to rail/chip assertions.
- Synthetic iframe windows for **external URLs stay** (compat shim — spec § What
  dies). Same-folder twins: no code change needed; users just stop making them.

## Phase 4 — Boards + extras (fab change(s), open-ended)

- Boards adopt the tile renderer: a board = saved named layout of (window, view)
  pairs in settings.yaml (like `board_order`). Bridge verb: "Save layout as
  board" from the ▦ chip/palette.
- Optional `@rk_default_layout` creation-time hint (riff spawn shapes) — R5-style:
  applies only when URL + localStorage are silent; absorbs and retires the
  `@rk_type` hint from phase 3.
- Drag-drop sugar: drop-on-tile = ⇄, drop-on-edge = shape+insert, drag-divider =
  ratios. Only if verb-driven arranging proves insufficient.
- localStorage GC: drop `rk-layout:*` keys whose window id no longer appears in
  the SSE payload (lazy, low priority).

## Pickup protocol (phases 3–4)

1. Read `docs/specs/surface-layout.md`, then this plan's phase section.
2. Check the spec's [target] markers against shipped reality — phase 2 may have
   amended details at hydrate; memory (`docs/memory/run-kit/ui-patterns.md`) is
   authoritative for what shipped.
3. `/fab-new` with the phase section as intake source; treat the Decision log as
   Certain and the Anti-decisions as binding.
