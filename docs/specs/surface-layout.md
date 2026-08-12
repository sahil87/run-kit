# Surface Layout — The Center Is a Layout of Surfaces

> The terminal route's center becomes a **layout manager**: one to three tiles,
> each rendering a **surface** (a (substrate, lens) pair per
> [`right-panel.md`](right-panel.md)), arranged by a **preset shape** with a
> **surface order** and per-viewer **ratios**. This spec is **[target]**
> throughout — it generalizes [`window-views.md`](window-views.md)'s exclusive
> main slot and subsumes [`right-panel.md`](right-panel.md)'s panel slot. It
> was designed in a `/fab-discuss` session on 2026-08-12; the execution plan
> lives at [`fab/plans/sahil/surface-layout.md`](../../fab/plans/sahil/surface-layout.md).
>
> Companions: [`window-views.md`](window-views.md) (lenses, availability
> derivation — R1–R3 and R5–R7 carry over unchanged; R4's switcher is retired
> here), [`right-panel.md`](right-panel.md) (surfaces, the rail, companions —
> P6 and the panel-slot mechanics are superseded here; the rail, availability,
> `@rk_owner`, and P4 carry forward), [`agent-state.md`](agent-state.md),
> [`status-pyramid.md`](status-pyramid.md) (untouched — status describes
> substrates, never tiles).

---

## The Problem

1. **Lenses are exclusive; the panel is one fixed split.** The main slot
   renders one lens; the right panel adds exactly one more surface in one
   hardcoded position. The highest-value arrangements — agent big-left with
   editor and served page stacked beside it — are unreachable, and the center
   can end up burning half the screen on the inert shell pane of an iframe
   window while the content the user wants sits squeezed in the panel.
2. **View exclusivity confuses.** `View: Terminal / Code / Chat` menu rows
   read as "pick where you are" when the honest question is "pick what to
   show." Same-folder twin windows (a real window plus an `@rk_type=iframe`
   sibling whose only job is to hold a different renderer) exist purely to
   work around the one-lens-at-a-time model.

---

## The Model

A **layout** is fully determined by three values:

| Value | What | Ownership |
|-------|------|-----------|
| **shape** | one of the preset arrangements below | per-viewer choice |
| **order** | the surfaces occupying the shape's slots, first = slot A | per-viewer choice |
| **ratios** | divider positions | per-viewer, localStorage only (like panel width today) |

Tiles render surfaces of the **route window** (or its companions, once the
`agents` surface lands). The tty is itself a surface — `(current window,
tty)`, always available — so "the terminal" holds no privileged slot; it is
simply the default single-tile layout.

### Shape presets (not trees)

Layouts use an enumerated preset set — deliberately **not** a free split tree.
Presets are cyclable, URL-encodable, and cover real 2–4-tile needs; free trees
are where dock UIs get fiddly and layouts become unrecoverable. (tmux has
both; everyone lives in the presets.)

```
 1 tile   2 tiles                3 tiles
┌──────┐ ┌───┬───┐ ┌───────┐   row        col        main-left   main-right  main-top
│  A   │ │ A │ B │ │   A   │ ┌──┬──┬──┐ ┌────────┐ ┌─────┬───┐ ┌───┬─────┐ ┌─────────┐
│      │ │   │   │ ├───────┤ │ A│ B│ C│ │   A    │ │     │ B │ │ B │     │ │    A    │
└──────┘ └───┴───┘ │   B   │ │  │  │  │ ├────────┤ │  A  ├───┤ ├───┤  A  │ ├────┬────┤
          split-h  └───────┘ │  │  │  │ │   B    │ │     ├───┤ ├───┤     │ │ B  │ C  │
                    split-v  └──┴──┴──┘ ├────────┤ │     │ C │ │ C │     │ │    │    │
                                        │   C    │ └─────┴───┘ └───┴─────┘ └────┴────┘
                                        └────────┘
```

Slot A is the **main** slot in `main-*` shapes. Four tiles and beyond are out
of scope (Constitution IV — a fourth surface is the signal the user wanted a
board).

### One tile per surface kind (v1)

The layout encoding names surface *kinds* (`tty`, `code`, `web`, `agents`);
content rides the substrate's capability signal (`@rk_url` etc.). Two `web`
tiles with different pages would push content addresses into per-viewer state,
crossing R7 — punted.

---

## State — the resolution ladder

### L1 — One URL param, shape:order encoded

`?layout=<shape>:<surface>,<surface>[,<surface>]` on the existing
`/$server/$window` route (Constitution IV — no new routes, no new params
beyond this one). Example: `?layout=main-left:tty,code,web`. This **subsumes
and retires `?view=` and `?panel=`**: `?view=X` translates to `?layout=X`,
`?view=X&panel=Y[,Z]` to the matching 2/3-tile shape, via a permanent
translation shim at route entry so old deep links never break. Unknown shapes
or unavailable surfaces degrade tile-by-tile toward `tty` (R2's fallback
spirit).

### L2 — Resolution order: URL > localStorage > default

On route entry:

1. **URL carries `?layout=`** → apply it (deep links, notifications, shared
   links, history entries win).
2. **else localStorage** `rk-layout:{server}:{@N window id}` → the viewer's
   last layout *for this window* (value-bearing key, R2 convention; keyed by
   the immutable `@N` id — rename-proof).
3. **else the window's default-view hint** (R5 — a legacy `@rk_type=iframe`
   window defaults to a single `web` tile).
4. **else** single `tty` tile.

The applied layout is mirrored into the URL via `replaceState`, so the address
bar is at all times a valid deep link to what is on screen — **except the
window's default layout, which mirrors as a clean URL with the param
dropped** (the retired `?view=` convention, "tty drops the param", carried
forward at phase-2 ship: a bare URL *is* the deep link to the default, and
bare internal-nav URLs stay bare). **URL = address
(of this exact sight, shareable with anyone); localStorage = the viewer's
window→layout map (consulted when arriving without an explicit address);
settings.yaml boards = shared named layouts** (phase 4).

### L3 — Write on user mutation only

localStorage is written when the viewer *changes* the layout (verbs, rail
toggles, shape chip, divider drags) — never on merely arriving via a URL that
carries `?layout=`. Following someone's deep link shows their arrangement;
touching anything makes it yours.

### L4 — History gets "what you saw"

Layout changes use `replaceState` (no history entry per tweak); window
switches push entries as today. Each history entry therefore carries the
layout it had when the viewer left, and rung 1 honors it — back/forward
restores the historical arrangement, not the current localStorage value.

Internal navigation (sidebar rows, ▾ switcher, palette) always targets the
**bare route** — the destination window resolves its own layout via the
ladder. Nothing at the navigation source knows or carries the target's layout.
Code that reads layout must read resolved state, never parse `location.search`
before the ladder has run.

---

## Verbs

Every arrangement of (shape × order) is reachable in ≤2 actions without
drag-drop. Verbs live as hover buttons in each tile's surface header and as
palette entries; the shape-cycle chord is bound directly (Constitution V —
buttons are the mouse mirror, not the mechanism). *Amended at phase-2 ship
(`260812-ab5v`): per-verb chords (zoom / promote / directional swap / close)
shipped palette-reachable rather than direct-bound — one cycle chord plus
palette rows covers keyboard-first with far less chord-surface; direct
per-verb bindings remain open to a later phase if palette latency proves
irritating.*

| Verb | Effect on (shape, order) |
|------|--------------------------|
| **⏶ Zoom** | Tile goes full-center, others hidden (not closed); toggle back. No state change — a transient, like tmux `resize-pane -Z` |
| **◧ Promote** | Move this surface to slot A; order permutes, shape unchanged |
| **⇄ Swap** | Swap with neighbor (directional chords: swap-left/right/up/down); order permutes |
| **▦ Cycle shape** | Next preset, same order — one chip on the layout (top-bar right cluster), not per-tile; its popover shows the preset glyphs for direct jump |
| **✕ Close** | Surface leaves; layout collapses to the smaller shape |

**Rail semantics change**: rail buttons become **open-tile toggles** — lit for
every open tile; clicking an unlit icon adds that surface to the next slot,
clicking a lit one closes its tile. The rail stays the availability +
attention surface (right-panel P4 unchanged — a collapsed/absent tile may hide
content, never state that wants a human).

Future drag-drop is **sugar over the same three mutations** (drop-on-tile =
swap, drop-on-edge = shape change + slot insert, drag-divider = ratios) — 
nothing in the verb model is throwaway.

---

## What dies, what stays

The R7 test sorts every mechanism: **substrate state** (shared fact about the
process, must outlive any browser) stays; **view state** (one viewer's choice)
moves into the layout.

| Mechanism | Verdict |
|-----------|---------|
| `@rk_type=iframe` as identity | **Dies.** Demoted to a default-layout hint (ladder rung 3) during migration, then removable. Snapshot round-trip option set updates accordingly |
| The `>_` button's `POST @rk_type: null` | **Dies** — the R7 conflation |
| The `ViewSwitcher` pill + `View:` chevron-menu rows (R4) | **Dies** — replaced by rail toggles + the ▦ chip. "Which view am I in" stops being a question because views stop being exclusive |
| `?view=` and `?panel=` params | **Retired** behind the permanent translation shim |
| Same-folder twin windows | **Collapse** — one window, `web`/`code` tiles in its layout |
| `@rk_url` | **Stays** — capability signal *and* shared content address (edit it and every viewer sees the new page). Never was view state |
| `@rk_chat`, `@rk_owner`, `@rk_agent_state` | **Stay** — capability, topology, status |
| Synthetic iframe windows for **external URLs** (no owning pane) | **Stay** as the compat shim — the honest residual (window-views § Two Species step 2); a web tile's content needs a substrate signal |

---

## Mobile (P5 carried forward)

Below `isMobileViewport()` the layout manager does not render multi-tile:
mobile keeps a single tile plus the sheet pattern (surfaces as sheet tabs).
Terminal and panel never share width on a phone. A phone arriving at a
3-tile `?layout=` URL shows slot A and offers the rest as tabs. Desktop-only
in v1 mirrors right-panel's call.

---

## Performance note

A 3-tile layout on a plaintext (HTTP/1.1) origin is SSE + up to 2 relay WS +
2 iframes' subresource fetches — the 6-slot connection-pool starvation class
from the board-route postmortem. Prod over h2 is immune; dev/e2e origins are
where it bites. Implementation carries the bounded-WS discipline from that
fix, and e2e specs budget tiles against the pool.

---

## Constitution Mapping

- **II / X** — nothing new is stored server-side; availability, content
  addresses, and rollups stay derived. Layout is client state (URL +
  localStorage); shared named layouts ride settings.yaml with boards (phase 4).
- **IV** — no new routes; `?layout=` *replaces* two params; presets, not free
  trees; ≤3 tiles.
- **V** — every verb is palette + chord reachable; drag is sugar.
- **VI** — untouched; tiles are renderers over the same relay/proxy seams.

---

## Boards convergence (phase 4, noted so nobody designs against it)

A board becomes a **saved, named layout** whose tiles are (window, view)
pairs — the window-views § Boards generalization landing on the same
renderer. Terminal-route layouts are per-viewer and anonymous; board layouts
are shared and named (settings.yaml, like `board_order`). "Save this layout as
a board" is the bridge verb. A creation-time `@rk_default_layout` hint (for
`rk riff` spawn shapes) is deferred to the same phase.

---

## Phasing

Execution detail, per-change scope, and pickup notes live in the plan:
[`fab/plans/sahil/surface-layout.md`](../../fab/plans/sahil/surface-layout.md).

| # | Change | Ships |
|---|--------|-------|
| 1 | Spec (this file) + plan | Authored in the 2026-08-12 discussion session; lands with phase 2's PR |
| 2 | **Layout core** | The tile renderer replacing main slot + panel: presets, ladder, verbs, ▦ chip, rail toggles, translation shim |
| 3 | **Retirement sweep** | `@rk_type` identity → hint, `>_` POST, ViewSwitcher, `View:` rows, snapshot option-set update |
| 4 | **Boards + extras** | Boards adopt the renderer; `@rk_default_layout`; drag-drop sugar |
