# Surface Layout — The Center Is a Layout of Surfaces

> The terminal route's center becomes a **layout manager**: one to three tiles,
> each rendering a **surface** (a (substrate, lens) pair per
> [`right-panel.md`](right-panel.md)), arranged as a **canonical split tree**
> with per-viewer **sizes**. This spec is **[current]** —
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

A **layout** is fully determined by two values:

| Value | What | Ownership |
|-------|------|-----------|
| **tree** | the canonical split tree of surface leaves (below) | shared tab state (`@rk_win_layout`) |
| **sizes** | divider positions (per-split fractions) | per-viewer, localStorage only (like panel width today) |

Tiles render surfaces of the **route window** (or its companions, once the
`agents` surface lands). The tty is itself a surface — `(current window,
tty)`, always available — so "the terminal" holds no privileged slot; it is
simply the default single-tile layout.

### The canonical tree (templates as generators)

A layout is a **canonical split tree**: a leaf is a surface kind, a split is a
direction (`h` = children left→right, `v` = top→bottom) with ≥2 children, and
a child split never has its parent's direction — so every arrangement has
exactly one encoding. The serialized grammar (in `@rk_win_layout`) is
`node = leaf | dir "(" node "," node {"," node} ")"` with no whitespace, e.g.
`h(tty,v(code,web))`. The tree is still constrained, never free: 1–3 leaves
in this phase (the cap holds until the 150×100px size floor lands), non-`tty`
kinds never repeat, and anything non-canonical fails the parse (the renderer
falls back to the bare `tty` leaf without rewriting the option).

The named arrangements survive as **templates** — generators that build a
tree for any N from a slot order (main fraction 0.58), not as the model. The
legacy `<shape>:<a>,<b>[,<c>]` preset strings parse into their trees
permanently and losslessly (`split-h:a,b` → `h(a,b)`, `main-left:a,b,c` →
`h(a,v(b,c))`, `main-right:a,b,c` → `h(v(b,c),a)`, `main-top:a,b,c` →
`v(a,h(b,c))`, `row` → flat `h`, `col` → flat `v`, `single:X` → `X`);
`main-bottom` (`v(h(b,c),a)`) exists only as a template. Every writer emits
the tree form.

```
 1 tile   2 tiles                3 tiles
┌──────┐ ┌───┬───┐ ┌───────┐   row        col        main-left   main-right  main-top   main-bottom
│  A   │ │ A │ B │ │   A   │ ┌──┬──┬──┐ ┌────────┐ ┌─────┬───┐ ┌───┬─────┐ ┌─────────┐ ┌────┬────┐
│      │ │   │   │ ├───────┤ │ A│ B│ C│ │   A    │ │     │ B │ │ B │     │ │    A    │ │ B  │ C  │
└──────┘ └───┴───┘ │   B   │ │  │  │  │ ├────────┤ │  A  ├───┤ ├───┤  A  │ ├────┬────┤ ├────┴────┤
          (row)    └───────┘ │  │  │  │ │   B    │ │     ├───┤ ├───┤     │ │ B  │ C  │ │    A    │
                   (col)     └──┴──┴──┘ ├────────┤ │     │ C │ │ C │     │ │    │    │ └─────────┘
                                        │   C    │ └─────┴───┘ └───┴─────┘ └────┴────┘
                                        └────────┘
```

Slot A is the **main** slot in `main-*` templates. Four tiles and beyond are
out of scope for now (Constitution IV — a fourth surface is the signal the
user wanted a board); the tree model itself is N-generic so the cap can lift
when the size floor lands.

### One tile per surface kind (v1)

The layout encoding names surface *kinds* (`tty`, `code`, `web`, `gui`,
`agents`); content rides the substrate's content signal (`@rk_win_url` etc. —
for `web` a content *selector*, not an availability gate: the `web` surface
is always tileable like `tty`, and an empty/whitespace `@rk_win_url` renders
the tile's onboarding content state while a non-empty one renders the live
page through the web tile's engine (iframe or native — window-views.md §
Engines; § The View Registry).
`gui` has no content selector in v1 — the tile shows the host's screen; a
per-session display option becomes the selector only if per-session GUIs ever
land ([`gui.md`](gui.md)). Two `web`
tiles with different pages would push content addresses into per-viewer state,
crossing R7 — punted.

---

## State

The tree is shared tab state in the `@rk_win_layout` window option —
see [`ui-state.md`](ui-state.md) § Layout in tmux for the encoding, the
degradation rule, and deep-link handling. Unset renders the bare `tty` leaf;
the URL is always the bare route.

Two values stay per-viewer localStorage, as reading postures: divider sizes
(`rk-layout-sizes:{server}:{@N}:{structure-sig}` — one fraction array per
split, keyed by structure so a swap keeps sizes with positions; the retired
`rk-layout-ratios:*` keys are ignored, not migrated) and tile zoom
(`rk-layout-zoom:*`). There is no present auto-open carve-out: showing a
surface is an ordinary `@rk_win_layout` write every viewer renders. History
entries are bare routes — layout changes never touch the URL, and
back/forward shows whatever the tab's shared layout holds.

---

## Verbs

Dragging a tile's header is the mouse path for rearrangement; every drag
outcome also has a keyboard route, so every arrangement is reachable in ≤2
actions without drag-drop — a guarantee that rides the **palette** (`Layout:
Promote <Surface>` + `Tile: Swap <Dir>`; at ≤3 tiles every structure is one
of the templates and leaf placement within a structure is one promote or
swap). Zoom/close live as boxed, rest-visible buttons in each tile's surface
header; every verb also exists as a palette entry; the template-cycle chord
is bound directly (Constitution V — buttons are the mouse mirror, not the
mechanism). *Amended at phase-2 ship (`260812-ab5v`): per-verb chords (zoom /
promote / directional swap / close) shipped palette-reachable rather than
direct-bound — one cycle chord plus palette rows covers keyboard-first with
far less chord-surface; direct per-verb bindings remain open to a later phase
if palette latency proves irritating. Amended at `260812-wfic`: the verb
buttons shipped as fixed-size boxed buttons visible at rest (the hover-reveal
cluster was retired).*

| Verb | Effect on the tree |
|------|--------------------------|
| **Drag** (header, mouse) | Drag a tile by its header background: dropping on another tile's **center** swaps the two leaves; on its **edge band** (clamp(25 % of the axis, 28, 110) px; corners go to the deepest edge) splits beside it; on the **layout's outer 18 px edge** spans that side at 50 % of the axis. The overlay previews the *result* tree at this viewer's sizes (the dragged tile's destination filled); a drop that rebuilds the same arrangement reads "no change", one that would leave a tile under 150×100 px reads "too small" and is not offered. Escape cancels; a commit is exactly one `@rk_win_layout` write plus the viewer's sizes under the new structure signature. Disabled on coarse pointers, zoomed renders, and single-leaf layouts |
| **⛶ Zoom** | Tile goes full-center, others hidden (not closed); toggle back. No state change — a transient, like tmux `resize-pane -Z` |
| **Add** (open-tile toggle) | Split the **last leaf in reading order** along its longer axis (tie → horizontal), the new leaf landing after it — at landscape this reproduces the old 1→2 `split-h`, 2→3 `main-left` growth exactly. Refused at 3 leaves and on a repeated non-`tty` kind |
| **◧ Promote** (palette) | Swap this leaf with slot A (the template's main tile, or the first leaf in reading order for a custom tree) — palette `Layout: Promote <Surface>`; a center drop onto slot A is the drag equivalent |
| **⇄ Swap** (palette) | Directional swap (palette `Tile: Swap Left/Right/Up/Down`): swap the focused leaf with the geometric neighbour across that edge — the nearest leaf whose rect overlaps on the perpendicular axis; a no-op without one |
| **▦ Cycle template** | Next template for the current tile count (`row → col → main-left → …` at 3 tiles), rebuilt from the current slot order — one chip on the layout (top-bar right cluster), not per-tile; its popover shows the template mini-glyphs for direct jump (lossy for a custom tree) |
| **✕ Close** | The leaf drops out (remove + normalise); its neighbours absorb its size and the remaining **structure is kept** — closing one tile of a column leaves a column. The last tile never closes |
| **Switch-to-tile** (mobile-primary) | Swaps WHICH surface the mobile single slot renders: a target already open in the layout writes only the viewer's zoom key (`rk-layout-zoom:*` — no tmux write); an available-but-not-open target grows the shared layout through the shared `--add` mutation (`addSurface` → `@rk_win_layout` write) plus the zoom key; when growth is impossible (3 tiles without the kind) the button is disabled. Lives in the top-bar switch group (§ Mobile) and the `Tile: Switch to <Surface>` palette entries that supersede `View:` at mobile width |

**Rail semantics change**: rail buttons become **open-tile toggles** — lit for
every open tile; clicking an unlit icon adds that surface to the next slot,
clicking a lit one closes its tile. The rail stays the availability +
attention surface (right-panel P4 unchanged — a collapsed/absent tile may hide
content, never state that wants a human).

Drag-drop is **sugar over the same generic tree edits** (drop-on-tile = swap,
drop-on-edge = wrap → remove → normalise, drag-divider = sizes) — nothing in
the verb model is throwaway.

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
| `@rk_win_url` | **Stays** — the web tile's content selector *and* shared content address (edit it and every viewer sees the new page, rendered through the tile's engine — iframe or native; empty/whitespace renders the tile's onboarding state). Never was view state |
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

The `gui` tile gets one more rule on coarse pointers **[current]**: it scales
the shared desktop client-side (fit, or 1:1 clip+pan) and **never drives a
SetDesktopSize resize** — the desktop follows the last-focused *fine-pointer*
viewer's tile size; phones are readers of the shared screen, not its geometry
authority ([`gui.md`](gui.md) § Resize policy).

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
- **IV** — no new routes; `?layout=` *replaces* two params; a canonical tree
  (constrained, templates as generators), not free trees; ≤3 tiles until the
  size floor lands.
- **V** — every verb is palette + chord reachable; the header drag's outcomes
  are all palette-reachable too (Promote + directional Swap reach every
  arrangement in ≤2 actions at ≤3 tiles).
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
| 4 | **Boards + extras** | Boards adopt the renderer; `@rk_default_layout` (the drag-drop sugar shipped with the header drag) |
