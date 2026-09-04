# Surface Layout — The Center Is a Layout of Surfaces

> The terminal route's center becomes a **layout manager**: one to three tiles,
> each rendering a **surface** (a (substrate, lens) pair per
> [`right-panel.md`](right-panel.md)), arranged by a **preset shape** with a
> **surface order** and per-viewer **ratios**. This spec is **[current]** —
> shipped by `260812-ab5v-surface-layout-core` and follow-ons (toggles
> relocated to the top bar: `260815-19me`; mobile switch group: `260816-ox16`;
> option-driven shared layout state `@rk_win_layout`: `260828-iip5` — see
> [`ui-state.md`](ui-state.md)). It generalizes
> [`window-views.md`](window-views.md)'s exclusive
> main slot and subsumes [`right-panel.md`](right-panel.md)'s panel slot. It
> was designed in a `/fab-discuss` session on 2026-08-12; the execution plan
> lives at [`fab/plans/sahil/26-08-12-surface-layout.md`](../../fab/plans/sahil/26-08-12-surface-layout.md).
> Where this spec says "rail buttons"/"rail toggles", read the top bar's
> `surface-toggles` group — the right rail was retired by `260815-19me`, which
> relocated the open-tile toggles into the top bar.
>
> Companions: [`window-views.md`](window-views.md) (lenses, availability
> derivation — R1–R3 and R5–R7 carry over (R1 and R3 amended by
> `260821-zqlq`: web is unconditionally available and `@rk_win_url` selects its
> content; R4's switcher is retired
> here), [`right-panel.md`](right-panel.md) (surfaces, companions —
> P6 and the panel-slot mechanics are superseded here; availability,
> companions, and P4 carry forward; the rail did NOT survive —
> `260815-19me` moved its toggles into the top bar), [`agent-state.md`](agent-state.md),
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
   show." Same-folder twin windows (a real window plus an `@rk_win_lens=iframe`
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
content rides the substrate's content signal (`@rk_win_url` etc. — for `web` a
content *selector*, not an availability gate: the `web` surface is always
tileable like `tty`, and an empty/whitespace `@rk_win_url` renders the tile's
onboarding content state; window-views.md § The View Registry). Two `web`
tiles with different pages would push content addresses into per-viewer state,
crossing R7 — punted.

---

## State

Shape and order are shared tab state in the `@rk_win_layout` window option —
see [`ui-state.md`](ui-state.md) § Layout in tmux for the encoding, the
degradation rule, and deep-link handling. Unset renders `single:tty`; the URL
is always the bare route.

Two values stay per-viewer localStorage, as reading postures: divider ratios
(`rk-layout-ratios:*`) and tile zoom (`rk-layout-zoom:*`). There is no present
auto-open carve-out: showing a surface is an ordinary `@rk_win_layout` write
every viewer renders. History entries are bare routes — layout changes never
touch the URL, and back/forward shows whatever the tab's shared layout holds.

---

## Verbs

Every arrangement of (shape × order) is reachable in ≤2 actions without
drag-drop. Verbs live as boxed, rest-visible buttons in each tile's surface
header and as palette entries; the shape-cycle chord is bound directly
(Constitution V — buttons are the mouse mirror, not the mechanism). *Amended
at phase-2 ship (`260812-ab5v`): per-verb chords (zoom / promote /
directional swap / close) shipped palette-reachable rather than direct-bound
— one cycle chord plus palette rows covers keyboard-first with far less
chord-surface; direct per-verb bindings remain open to a later phase if
palette latency proves irritating. Amended at `260812-wfic`: the verb buttons
shipped as fixed-size boxed buttons visible at rest (the hover-reveal cluster
was retired).*

| Verb | Effect on (shape, order) |
|------|--------------------------|
| **⛶ Zoom** | Tile goes full-center, others hidden (not closed); toggle back. No state change — a transient, like tmux `resize-pane -Z` |
| **◧ Promote** | Move this surface to slot A; order permutes, shape unchanged |
| **⇄ Swap** | Swap with neighbor (directional chords: swap-left/right/up/down); order permutes |
| **▦ Cycle shape** | Next preset, same order — one chip on the layout (top-bar right cluster), not per-tile; its popover shows the preset glyphs for direct jump |
| **✕ Close** | Surface leaves; layout collapses to the smaller shape |
| **Switch-to-tile** (mobile-primary) | Swaps WHICH surface the mobile single slot renders: a target already open in the layout writes only the viewer's zoom key (`rk-layout-zoom:*` — no tmux write); an available-but-not-open target grows the shared layout through the shared `--add` mutation (`addSurface` → `@rk_win_layout` write) plus the zoom key; when growth is impossible (arity 3 without the kind) the button is disabled. Lives in the top-bar switch group (§ Mobile) and the `Tile: Switch to <Surface>` palette entries that supersede `View:` at mobile width |

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
| `@rk_win_lens=iframe` as identity | **Dies.** Demoted to a default-layout hint (ladder rung 3) during migration, then removable. Snapshot round-trip option set updates accordingly |
| The `>_` button's `POST @rk_win_lens: null` | **Dies** — the R7 conflation |
| The `ViewSwitcher` pill + `View:` chevron-menu rows (R4) | **Dies** — replaced by rail toggles + the ▦ chip. "Which view am I in" stops being a question because views stop being exclusive |
| `?view=` and `?panel=` params | **Retired** behind the permanent translation shim |
| Same-folder twin windows | **Collapse** — one window, `web`/`code` tiles in its layout |
| `@rk_win_url` | **Stays** — the web tile's content selector *and* shared content address (edit it and every viewer sees the new page; empty/whitespace renders the tile's onboarding state). Never was view state |
| `@rk_pane_agent_session`, `@rk_pane_agent_state` | **Stay** — capability, status |
| Synthetic iframe windows for **external URLs** (no owning pane) | **Stay** as the compat shim — the honest residual (window-views § Two Species step 2); a web tile's content needs a substrate signal |

---

## Mobile (P5 carried forward)

Below `isMobileViewport()` the layout manager does not render multi-tile:
mobile keeps a single tile (slot A) plus the top-bar **switch group** — the
`surface-toggles` cluster entry forked to switch mode: one button per
available surface (the rail-hidden set still filters at render), rendered
only when ≥2 surfaces are available, with radio semantics
(the visible tile pressed; tapping the pressed button is a no-op). The group
is pinned in-bar at mobile — it never drops into the overflow chevron (other
chips yield first) and registers no overflow-menu rows — and carries the same
availability dots as the desktop toggles. Terminal and panel never share width
on a phone. A phone arriving at a tab with a 3-tile shared layout shows slot A and
offers the rest via the switch group.

The buttons run the **switch-to-tile** verb (§ Verbs): an already-open target
writes only the viewer's zoom key (no tmux write); an available-but-not-open
target grows the shared layout via the shared `--add` mutation (`addSurface` →
`@rk_win_layout` write) plus the zoom key, and renders disabled when growth is
impossible (arity 3 without the kind). The palette mirrors the group with
`Tile: Switch to <Surface>` entries
(Constitution V), which supersede the `View:` lens entries at mobile width.

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
[`fab/plans/sahil/26-08-12-surface-layout.md`](../../fab/plans/sahil/26-08-12-surface-layout.md).

| # | Change | Ships |
|---|--------|-------|
| 1 | Spec (this file) + plan | Authored in the 2026-08-12 discussion session; lands with phase 2's PR |
| 2 | **Layout core** | The tile renderer replacing main slot + panel: presets, ladder, verbs, ▦ chip, rail toggles, translation shim |
| 3 | **Retirement sweep** | `@rk_win_lens` identity → hint, `>_` POST, ViewSwitcher, `View:` rows, snapshot option-set update |
| 4 | **Boards + extras** | Boards adopt the renderer; `@rk_default_layout`; drag-drop sugar |
