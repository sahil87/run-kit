# Intake: GUI Toolbar → Tile Header Measured Fold

**Change**: 260912-lut4-gui-toolbar-header-fold
**Created**: 2026-09-12

## Origin

Conversational design session (natural-language input, no Linear ticket, no backlog ID). The user
worked through a full design exploration of the `gui` tile's session toolbar and settled twelve
numbered decisions plus a priority ladder, a persistence rule, an architecture mapping, and a
testing plan. Two self-contained HTML design studies were produced during that session and are
already copied into the repo (currently untracked) as the design authority for this change.

> Move the GUI tile's session toolbar into the tile header as a width-adaptive measured fold.
>
> The `gui` tile's session toolbar is a floating pill (`app/frontend/src/components/gui-toolbar.tsx`)
> — `absolute top-2 left-1/2 z-20`, overlaying the noVNC framebuffer. It self-hides 3s after the last
> interaction (`TOOLBAR_HIDE_MS`) and a fine-pointer non-fullscreen viewer only rediscovers it by
> moving the pointer within 24px of the tile's top edge (`TOOLBAR_REVEAL_EDGE_PX`). Meanwhile the gui
> tile's own 35px header (`surface-layout.tsx:1816`) has an EMPTY `flex-1` spring, while the tty tile
> already fills that same slot with kind-specific controls (a find toggle, an export menu, a bordered
> pane segment). The toolbar covers the guest desktop, is hard to discover, and there is nowhere
> permanent to show a mode indicator.

**Interaction mode**: conversational — every decision below was settled with the user, including the
options that were explicitly rejected. Those rejections are recorded in
`docs/wiki/gui-toolbar-header-exploration.html` and summarised in the Assumptions table.

**Scope boundary agreed with the user**: this change is the TOOLBAR ONLY. A second, separate change
(a later PR) will add a keyboard-capture toggle (`⌨`) that hands chords to the guest desktop. This
change MUST build the pinned-block plumbing (a measured, reserved slot that never folds) containing
only the `⚙` overflow toggle, so the capture control can drop into an already-reserved slot later.
This change MUST NOT implement keyboard capture, the `gui-capture-toggle` binding, or the
`rk-gui-capture` storage key.

## Why

**The problem.** The gui tile's session toolbar is a floating pill mounted at
`gui-toolbar.tsx:411` with `absolute top-2 left-1/2 -translate-x-1/2 z-20`. It has three
compounding costs:

1. **It covers the guest desktop.** The pill floats over the noVNC framebuffer — the one region of
   the tile the user is actually looking at. Every control it carries costs pixels of the remote
   desktop the viewer came to see.
2. **It is hard to discover.** The pill self-hides `TOOLBAR_HIDE_MS` (3 000 ms) after the last
   interaction. A fine-pointer viewer who is not in fullscreen only gets it back by moving the
   pointer within `TOOLBAR_REVEAL_EDGE_PX` (24 px) of the tile's top edge — an invisible hover
   target with no affordance. There is no permanent, always-visible entry point to the gui tile's
   own controls.
3. **There is nowhere permanent to show a mode indicator.** A self-hiding pill cannot host state
   that must remain readable (the current screen size, the quality preset, and — in the follow-up
   change — whether keyboard capture is armed). A latched control that disappears 3 s later is a
   latch the user cannot trust.

**Meanwhile the slot already exists and is already used by a sibling.** The gui tile's own 35 px
header (`surface-layout.tsx`, the `{!mobile && (…)}` block beginning at line 1815) carries an EMPTY
`flex-1` spring at line 1854. The **tty** tile already fills that same slot with kind-specific
controls: a find toggle, an export menu, and a bordered pane segment (the flush `inline-flex`
segments around `surface-layout.tsx:2007`/`:2058`). The gui branch is the missing sibling, not new
plumbing.

**What happens if we don't fix it.** The framebuffer keeps paying for chrome; the controls stay
undiscoverable; and the follow-up keyboard-capture change has no permanent home for its latch — it
would have to either re-open the discoverability problem or invent a second, competing surface.

**Why this approach over the alternatives.** Three alternatives were considered and rejected with
the user:

- *Keep the pill, make it permanent (drop the hide timer).* Rejected — it still covers the
  framebuffer, and a permanently-overlaid pill is strictly worse than a permanently-overlaid
  self-hiding one for the viewer who wants the desktop.
- *Breakpoint constants (show set A above 560 px, set B above 400 px).* This is what
  `gui-toolbar.tsx` does today via `TOOLBAR_OVERFLOW_MIN_PX` (560) and `TOOLBAR_SHORT_LABEL_MAX_PX`
  (400). Rejected — the labels vary at runtime (`1920×1080` vs `auto`, the quality label, coarse
  sizing), so hardcoded widths are wrong at both ends. A measured fold is the shipped pattern for
  exactly this problem in two other places in this codebase.
- *Keep a minimal pill alive for the fullscreen case.* Rejected — see D6 below. It was
  provisionally ACCEPTED earlier in the design session on a mistaken reading of the fullscreen call
  site, then reversed once the code was read properly: the target is a one-line `querySelector`
  swap, not the pan/fit rework it was assumed to be. Keeping it would mean two surfaces, two
  vocabularies, and the hide-timer machine alive forever for one case.

**Architecturally this is a third instance of a shipped pattern, not new machinery.** The repo
already contains both halves of the measured-fold idiom: `lib/top-bar-overflow.ts`
(`computeVisibleCount` — pure fit arithmetic, dependency-free, unit-tested without mounting the
shell) with its measurement wiring in `top-bar.tsx` (one `ResizeObserver` plus a hidden probe row),
and `lib/crumb-collapse.ts` (`deriveCrumbsCollapsed` + `CRUMB_COLLAPSE_HYSTERESIS_PX = 24` —
one-sided expand-edge hysteresis so a drag hovering the boundary cannot flap). This change follows
both precedents literally.

## What Changes

### 1. Placement — the gui branch in the tile header's spring (D1)

The gui tile's controls move into the tile header's `flex-1` spring at
`app/frontend/src/components/surface-layout.tsx` (the empty `<span className="flex-1" />` at line
1854, inside the `{!mobile && (…)}` header block that opens at line 1815), via a **gui branch
mirroring the existing tty branch**.

Rationale (settled with the user): the slot exists and has precedent (tty already fills it); nothing
overlays the framebuffer; no hide timer; no invisible hover target to discover.

The floating pill is **not reparented** — the controls are RE-RENDERED in the header's vocabulary
(see §6). The pill is **deleted entirely** (see §7); `gui-toolbar.tsx` becomes header-only.

### 2. Measured priority fold (D2, D3, D4, D5)

**D2 — measured priority fold.** Show as many controls as fit, in a fixed priority order, and fold
the remainder into a `⚙` panel. **No breakpoint constants.** Widths come from measurement, never
from hardcoded pixel thresholds.

**D3 — `⚙` is an overflow affordance, NOT permanent.** It renders only when something is actually
folded, and disappears at full width. This is the same rule the top bar's overflow chevron follows.

**D4 — the pinned block never folds, and its MEASURED width is reserved from the budget BEFORE any
ladder item is fitted.** In this change the pinned block contains the `⚙` toggle alone; the
follow-up keyboard-capture control joins it later, which is why the block is built as a block and
not as a bare button. This mirrors the top bar's reserve of its trailing chevron block and its
pinned mobile switch group (`reservedWidth` in `computeVisibleCount`).

D3 and D4 interact: the reserve must not be what *causes* the fold that justifies the reserve. Fit
two passes — fit once with NO pinned reserve; if every ladder item fits, render no `⚙` and reserve
nothing; otherwise re-fit with the pinned block's measured width reserved.
<!-- assumed: two-pass conditional reserve resolves the D3 (⚙ not permanent) × D4 (reserve before fitting) circularity — implied by D3+D4 but never stated; the top-bar precedent reserves a PERMANENT chevron so it does not answer this. The alternative (always reserve, hide the ⚙) yields a different gui-toolbar-fold.ts signature and different unit tests -->

**D5 — labels degrade one step before an item folds.** Degradation is spent before dropping
(cheapest move first — it keeps the control reachable):

| Item | Full label | Degraded label |
|------|-----------|----------------|
| Screen size | `1920×1080 ▾` | `1920 ▾` |
| Quality | `◐ Balanced` | `◐` |

So the fit order per item is: full label → degraded label → folded into `⚙`.

### 3. The priority ladder (the core design decision)

```
pin.  ⚙                       — never folds; width reserved (capture joins it later)
 1.   Screen size             — `1920×1080 ▾` → degrades to `1920 ▾`
 2.   Zoom                    — `− fit +`
 3.   Quality                 — `◐ Balanced` → degrades to `◐`
 4.   Input                   — `⎘` paste, `⌥` send key
 5.   Launch                  — `▣` terminal, `◍` browser
 6.   Health                  — `∿` stats, `↻` reconnect
```

Rationale per rung, as settled:

- **1. Screen size** — the tile's defining property, and the menu host for presets / lock / auto.
- **2. Zoom** (`− fit +`) — the only per-moment controls; they are used WHILE reading the desktop.
- **3. Quality** — USER DECISION: keep the label and degrade it. REJECTED: glyph-only always, which
  would reclaim ~55 px but requires a hover to read the current preset.
- **4. Input** — `⎘` paste, `⌥` send key.
- **5. Launch** — `▣` terminal, `◍` browser.
- **6. Health** — `∿` stats, `↻` reconnect.

### 4. Grouping and spacing (D10, D11)

**D10 — THREE dividers, FOUR groups. NO divider between icons.**

```
size  ┆  − fit +  ┆  quality  ┆  ⎘ ⌥ ▣ ◍ ∿ ↻
```

Rationale: each text chip is a distinct KIND of control (a menu, a stepper, a cycle) so a seam
between them carries information; the six action glyphs are peers, and a divider between peers is
noise. The earlier five-divider version is REJECTED — the dividers, not the gaps, were making the
row sprawl.

**D11 — items sit FLUSH, `gap: 0`.** This is the header's flush-segment idiom (the tty pane segment
is a bordered `inline-flex` with zero gap). The dividers carry ALL separation and use the SHIPPED
divider spec already present at `surface-layout.tsx:2007` and `:2058`:

```
<span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />
```

i.e. 2 px side margins, a 14 px hairline, vertically centred — **NOT** a full-height rule.

REJECTED: 6 px (`gap-1.5`, the loose-verb gap) — it spends ~60 px on air, roughly the whole reserve
the later capture control needs.

Verb boxes stay 24×24, so **WCAG 2.2 SC 2.5.8 target minimum is untouched** — only the space
BETWEEN boxes shrinks.

### 5. Tooltips (D12)

Every control carries a `Tip` (`app/frontend/src/components/tip.tsx`), with **ONE `TipGroup`**
wrapping the whole cluster — the warm-cluster provider, so sweeping the row opens each tip at 0 ms
instead of paying the 300 ms open delay per control.

- `Tip` **REPLACES** the native `title=` (never both — `tip.tsx`'s own docblock states this: the OS
  bubble would double the styled tip).
- `aria-label` stays, and is what coarse pointers get, since `Tip` is suppressed under
  `pointer: coarse` by contract.
- `Tip` clones its child and adds NO wrapper DOM node — its docblock says this is specifically so
  the top bar's overflow-fit width-measurement probe is unaffected, so it composes with this fold
  for free.
- The three zoom tips carry their keycap **pulled from the LIVE binding, not a hardcoded string**.
  `gui-zoom-in` / `gui-zoom-out` / `gui-zoom-fit` are `guiOnly` ctrl-tier registry bindings; use the
  same source `withShortcutHints` reads, so a remap updates the tooltip for free.
- Menu/cycle chips carry a dim `note`: `"menu"` for the size chip, `"cycles"` for the quality chip.

### 6. Header chrome, not pill chrome (D8)

Controls are RE-RENDERED in the header's vocabulary, not reparented:

| Aspect | Header vocabulary (this change) | Pill vocabulary (rejected for the header) |
|--------|--------------------------------|-------------------------------------------|
| Height axis | 24 px fixed (26 px coarse) — the verb-button axis | 33×35 `Control variant="chip"` floor — does not fit the header's 32 px content band |
| Border | Borderless, `hover:bg-bg-inset` | Bordered chip |
| Ink | `text-text-secondary` at rest → `text-text-primary` on hover | — |
| Latched | Green ink + inset ring — the ⌕ find-toggle precedent, `controlClass({ variant: "toggle", ringed: true })` | — |
| Text chips | Borderless, content-width, 6 px side padding | — |

The 35 px header is 32 px of content plus a 3 px bottom rule (see the comment above
`surface-layout.tsx:1815`), which is why the pill's 35 px chip floor cannot be carried across.

### 7. Fullscreen targets the TILE; the pill is deleted (D6 — REVERSED 2026-09-12)

Fullscreen **moves to the tile element**, so the header travels into fullscreen and serves it like
every other case. **The floating pill is deleted outright.** One surface, one vocabulary, every
form factor.

**Two edits, both verified against the tree** (the earlier "risk to the pan/fit math" assessment was
wrong and is retracted):

1. `app.tsx:1409` (`guiFullscreen`) resolves its target by DOM query, **not** a ref:
   `document.querySelector('[data-testid="gui-surface-canvas"]')`. The tile wrapper carries
   `data-testid="surface-tile-gui"` (`surface-layout.tsx:1719`), so this is a one-line selector
   swap — e.g. query the canvas then `.closest('[data-testid^="surface-tile-gui"]')` so the
   duplicate-suffix form still matches.
2. `gui-surface.tsx:417` compares `document.fullscreenElement === wrapperRef.current` to drive its
   local `fullscreen` state. With the tile as the fullscreen element this identity check becomes a
   **containment** check (`document.fullscreenElement?.contains(wrapperRef.current)`).

The fit math needs **no** change: the wrapper stays a flex child of the fullscreened tile, is sized
by the tile as before, and the existing `ResizeObserver` re-measures it normally.

**Keyboard lock is unaffected.** `guiFullscreen` already chains `keyboardLock()?.lock()` on the
fullscreen promise (`app.tsx:1426`, helper at `:245`) and unlocks on exit (`:1433`). That behaviour
is untouched by moving the target.

**Consequence** (load-bearing for the deletion list in §10): `TOOLBAR_HIDE_MS`,
`TOOLBAR_REVEAL_EDGE_PX`, `revealSignal`, the top-edge reveal `pointermove`, and the pill's
`wrapperWidth` `ResizeObserver` are all **DELETED**. `gui-toolbar.tsx` becomes a single-mode
component: the header fold, nothing else.

**In fullscreen the header renders as it does windowed**, minus the layout verbs (`↰ ⇄ ✕`) — already
suppressed while a tile is zoomed, so the precedent exists — leaving `⤢` latched green as the exit.
Cost: 35 px of framebuffer in fullscreen, accepted in exchange for deleting the second surface.

### 7b. SVG glyphs and the gui meta chip (added 2026-09-12, post-apply)

Two additions found by testing the built header, both recorded here so the reviewer checks against them:

**D8b — the cluster's glyphs are SVGs, not Unicode.** The pill drew its controls as Unicode text characters
(`⎘ ⌥ ▣ ◍ ∿ ↻ ⚙ ⤢`, `− fit +`), which was self-consistent while it was an isolated surface. In the header they sit
beside `ZoomGlyph`/`PromoteGlyph`/`SwapGlyph`/`TileCloseGlyph`, and measurement confirms the mismatch: **11px text
vs 14px SVG** in the same 24×24 box, plus a weight/baseline difference (the SVGs are `strokeWidth 2`, optically
centred). Every glyph-only control therefore becomes a `ControlGlyph`-shaped SVG in `top-bar-icons.tsx`. This is
what that file exists for — its docblock states the goal as "one definition per mirrored control" with structural
bar↔menu parity. Text chips (resolution, quality) stay text. Hit targets, `aria-label`s and `Tip` labels are
unchanged, so the by-id palette mirror and existing selectors hold.

**D14 — the gui tile gains a `wm · display` meta chip.** `tileMeta` (`surface-layout.tsx:574`) returns a value for
`code` and `web` but `null` for `gui`, so the gui header has no meta chip today — the design study shows one, and
the follow-up keyboard-capture change needs something to swap to `keys → desktop`. It is header content, so it
lands here rather than in that change. Degrades to the display alone when `wm` is empty (the tested `GUI_BARE`
state).

### 8. Mobile is the bottom rung of the same ladder (D7)

Mobile is not a special case — it is the narrowest width, where **everything folds**, so only the
pinned block renders. It renders **into the TOP BAR**, because:

- `surface-layout.tsx:1815` gates the ENTIRE tile header behind `{!mobile && (…)}` — on mobile there
  is no tile header to put controls in; and
- mobile shows one surface at a time via the top bar's pinned mobile switch group, so the top bar is
  already the mobile surface-control surface.

The block sits adjacent to the pinned mobile switch group, gated on the visible mobile surface being
`gui`.
<!-- assumed: exact mobile slot — D7 names the top bar and cites the switch group as the reason, but does not fix the slot. Alternatives: an exempt item in the right cluster, or a row inside the existing top-bar overflow menu. top-bar.tsx's cluster registry and overflow fit are shared machinery, so this is cross-file to move later -->

The `⚙` panel is the **same component** on mobile, with the two coarse-only rows appended:

- `⌖` pointer mode
- `⌨` key bar

The `gui-keybar.tsx` key bar docked under the canvas is a **SEPARATE component and is UNCHANGED**.

### 9. Constitution V intact — every control is a palette mirror (D9)

Every chip and every panel row stays a **by-id `pickGuiActions` mirror** of the `GUI:` palette
family in `app/frontend/src/lib/palette/gui.ts`. **No toolbar-only action may be introduced.**
(`palette/gui.ts:92` already states this rule for the pill: "stable id (`pickGuiActions`) — no new
rows may be added for the pill".)

The `⚙` toggle itself gets palette rows, following the key bar's existing
`gui-keybar-show` / `gui-keybar-hide` pair (`palette/gui.ts:333`–`:334`):

```ts
{ id: "gui-toolbar-show", label: "GUI: Show toolbar", onSelect: () => input.onToolbarVisibleChange(true) }
{ id: "gui-toolbar-hide", label: "GUI: Hide toolbar", onSelect: () => input.onToolbarVisibleChange(false) }
```

### 10. Persistence — a new `rk-gui-toolbar` key

The `⚙` panel's open/closed state persists **per viewer** as a NEW `rk-gui-toolbar` key in
`app/frontend/src/lib/gui-posture.ts`, following the sibling `rk-gui-keybar` precedent
(`gui-posture.ts:65`) and that file's validated-read / try-catch-noop-write discipline. The key
joins the six existing siblings (`rk-gui-zoom`, `rk-gui-pointer`, `rk-gui-lock`, `rk-gui-quality`,
`rk-gui-stats-visible`, `rk-gui-hidpi`, `rk-gui-keybar`).

REJECTED: reset-closed-each-visit — inconsistent with the six sibling keys, and a narrow tile is
narrow every visit.

### 11. Architecture — follow the top-bar precedent exactly

- **Pure fit arithmetic** goes in a NEW `app/frontend/src/lib/gui-toolbar-fold.ts`, shaped like
  `lib/top-bar-overflow.ts` (`computeVisibleCount`) — **dependency-free and unit-testable without
  mounting the shell**. The component owns DOM measurement; the module owns the decision. This is
  the same split `crumb-collapse.ts` documents in its own header comment.
- **Measurement wiring mirrors `top-bar.tsx:979`**: ONE `ResizeObserver` plus a **HIDDEN PROBE ROW**
  rendering every fit candidate's real width, so nothing is hardcoded (labels vary at runtime:
  `1920×1080` vs `auto`, coarse sizing, the quality label). Observe the **header**, the **probe**,
  AND the **pinned block** — an item's own width can change without the container resizing.
- **Collapse-first**: the visible count starts at 0 and is set in a `useLayoutEffect` BEFORE paint,
  so there is no flash of overflowing controls.
- **Port one-sided EXPAND-EDGE HYSTERESIS** from `lib/crumb-collapse.ts`
  (`CRUMB_COLLAPSE_HYSTERESIS_PX = 24`). Without it the fold flaps when a drag hovers the boundary.
- **Serialize a `candidateKey`** so the measure effect re-runs when the probed SET changes, not on
  every render — the gui action list changes with connection state, lock, and pointer kind.
- `app/frontend/src/test-setup.ts` (the `ResizeObserver` stub installed when the environment does not
  provide one) already covers jsdom, so existing unit tests keep passing — they simply never
  exercise the fold.

### 12. What gets deleted / kept in `gui-toolbar.tsx`

| Symbol | Fate |
|--------|------|
| `TOOLBAR_OVERFLOW_MIN_PX` (560) | **DELETED** — replaced by the measured fold |
| `TOOLBAR_SHORT_LABEL_MAX_PX` (400) | **DELETED** — replaced by label degradation |
| `TOOLBAR_HIDE_MS` (3 000) | **DELETED** — no pill anywhere (D6) |
| `TOOLBAR_REVEAL_EDGE_PX` (24) | **DELETED** — no pill anywhere (D6) |
| `revealSignal` prop + its effect | **DELETED** — no pill anywhere (D6) |
| top-edge reveal `pointermove` + pill `wrapperWidth` observer | **DELETED** — no pill anywhere (D6) |

### 13. Design studies (already in the repo, currently untracked — INCLUDE them in this change)

Two self-contained HTML design studies were produced in the design session and copied into the repo.
They are the design authority for this change and MUST be committed as part of it:

- `docs/wiki/gui-toolbar-header-studies.html` — the final proposal: the 12 decisions, a **live width
  slider running the real fold algorithm**, the priority ladder, a filmstrip at five widths,
  fullscreen + mobile frames, the grouping/spacing and tooltip tables, and the
  architecture-precedent map.
- `docs/wiki/gui-toolbar-header-exploration.html` — the exploration record, with the rejected
  options.

Both follow the repo's existing `docs/wiki/*.html` design-study convention. Both MUST get rows in
`docs/specs/index.md`'s **Wiki** table, matching the style of the neighbouring rows (a bolded/plain
link plus a dense one-paragraph description ending in "Self-contained; open in a browser").

### 14. Testing

- **Vitest for the new pure module** — `app/frontend/src/lib/gui-toolbar-fold.test.ts`, colocated,
  matching the shape of `top-bar-overflow.test.ts` and `crumb-collapse.test.ts`.
- **The fold ladder itself needs a PLAYWRIGHT spec driving real widths** — jsdom has no layout
  engine. The existing `top-bar-overflow.spec.ts` / `crumb-collapse.spec.ts` document that the
  `ResizeObserver` re-fit is **NOT atomic with the resize**, so assertions need retry. Per the
  constitution's Test Intent Comments rule, every new `test()` carries a `Proves:` / `Steps:` JSDoc
  block and the spec file opens with a shared-setup file header.
- `app/frontend/src/components/gui-toolbar.test.tsx` is **largely rewritten** (the component becomes
  the header fold; every pill/reveal/hide-timer test is deleted).
- `gui-surface.spec.ts` reveal cases are **deleted** — there is no reveal behaviour left to assert.
- **Regenerate the control-gallery PNG baselines IF the `Control` primitive emits new classes**:
  `just test-e2e "control-gallery"`, then visually review the PNG diff — only the intended cells may
  change (see `fab/project/code-quality.md` § Verification).
- All tests run through `just` recipes (`just test-frontend`, `just test-e2e`, `just pw`) — never
  `pnpm test` / `playwright test` directly.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) The gui surface section's "toolbar pill" entry becomes the
  header-mounted measured fold with the pill removed; records the tile-header gui branch, the
  priority ladder, the `⚙` overflow panel, and the mobile bottom rung.
- `run-kit/ui/top-bar`: (modify) The mobile `⚙` pinned block rendered into the top bar beside the
  pinned mobile switch group, and its interaction with the right cluster's overflow fit.
- `run-kit/ui/visual-design`: (modify) The header-chrome control vocabulary for tile-header controls
  — the 24 px (26 coarse) verb axis, borderless `hover:bg-bg-inset`, the latched green-ink + inset
  ring form, the flush `gap-0` segment idiom, and the `mx-0.5 h-3.5 w-px bg-border` divider spec.
- `run-kit/ui/keyboard-and-palette`: (modify) The `GUI:` palette family gains
  `GUI: Show toolbar` / `GUI: Hide toolbar`; the zoom tips read their keycaps from the live
  `gui-zoom-*` bindings.
- `run-kit/ui/dialogs-and-state`: (modify) The per-viewer gui posture inventory gains the
  `rk-gui-toolbar` key alongside `rk-gui-zoom` / `rk-gui-pointer` / `rk-gui-lock` / `rk-gui-hidpi` /
  `rk-gui-keybar`.
- `run-kit/ui/status-signals`: (modify) The two-tier tooltip taxonomy gains the gui header cluster as
  a `TipGroup` warm-cluster consumer.
- `run-kit/gui`: (modify) The "toolbar pill" rules in the GUI surface memory become the header-fold
  rules; the pill requirement ("mounts for every viewer") is retired, and the fullscreen target moves
  from the surface wrapper to the tile.

## Impact

**New files**

- `app/frontend/src/lib/gui-toolbar-fold.ts` — pure fit arithmetic (dependency-free).
- `app/frontend/src/lib/gui-toolbar-fold.test.ts` — colocated Vitest unit tests.
- A Playwright spec for the fold ladder at real widths (e.g.
  `app/frontend/tests/e2e/gui-toolbar-fold.spec.ts`).
- Possibly a new header-cluster component (e.g.
  `app/frontend/src/components/gui-header-controls.tsx`) plus its colocated test, if the gui branch
  is too large to inline in `surface-layout.tsx`.

**Modified files**

- `app/frontend/src/components/surface-layout.tsx` (~2 294 lines) — the gui branch in the header
  spring (the empty `flex-1` at line 1854), inside the `{!mobile && (…)}` block at line 1815.
- `app/frontend/src/components/gui-toolbar.tsx` (~440 lines) — becomes the header fold (pill deleted);
  `TOOLBAR_OVERFLOW_MIN_PX` / `TOOLBAR_SHORT_LABEL_MAX_PX` retire from the header path.
- `app/frontend/src/components/gui-surface.tsx` (~1 164 lines) — the pill mount becomes
  fullscreen-only; `requestFullscreen` on `wrapperRef` and the `fullscreenchange` identity check are
  UNCHANGED.
- `app/frontend/src/components/gui-toolbar-menu.tsx` — the `⚙` panel (desktop folded rows + the two
  coarse-only mobile rows).
- `app/frontend/src/components/top-bar.tsx` — the mobile `⚙` pinned block.
- `app/frontend/src/lib/gui-posture.ts` (~282 lines) — the `rk-gui-toolbar` key.
- `app/frontend/src/lib/palette/gui.ts` (~406 lines) — the two new `GUI:` rows.
- `docs/specs/index.md` — two new Wiki-table rows.
- Tests: `gui-toolbar.test.tsx` (largely rewritten), `gui-surface.spec.ts` (reveal cases
  retargeted), `gui-posture.test.ts`, `palette/gui.test.ts`, `top-bar.test.tsx`.

**New untracked files to commit**

- `docs/wiki/gui-toolbar-header-studies.html`
- `docs/wiki/gui-toolbar-header-exploration.html`

**Constitution touchpoints**

- **V (Keyboard-First)** — satisfied by D9: every chip and panel row is a by-id `pickGuiActions`
  mirror, so every control is palette-reachable. No toolbar-only action.
- **IV (Minimal Surface Area)** — no new route, no new settings surface; per-viewer state stays in
  `localStorage` (`rk-gui-toolbar`), which is exactly where the constitution puts per-viewer state.
- **Test Intent Comments** — every new Playwright `test()` needs its `Proves:` / `Steps:` JSDoc and
  the spec file needs a shared-setup header comment.

**Explicitly out of scope**

- Keyboard capture (`⌨`), the `gui-capture-toggle` binding, and the `rk-gui-capture` storage key —
  a separate later change. This change only reserves the pinned slot they will drop into.
- `gui-keybar.tsx` (the key bar docked under the canvas) — unchanged.
- The fullscreen target (`wrapperRef` in `gui-surface.tsx`) and the pan/fit math — unchanged.

**Risks**

- `surface-layout.tsx` is a 2 294-line file carrying the whole tile grid; the gui branch must not
  disturb the tty branch or the drag/resize machinery around it.
- The measured fold's `ResizeObserver` re-fit is not atomic with the resize, so e2e assertions need
  retry (the existing fold specs document this).
- `top-bar.tsx` hosts a shared, registry-driven overflow fit; adding a gui-conditional mobile control
  touches that shared machinery and its tests.

## Open Questions

- Where exactly in the mobile top bar does the `⚙` pinned block sit — adjacent to the pinned mobile
  switch group, as an exempt item in the right cluster, or as a row inside the existing top-bar
  overflow menu? (Recorded as a Tentative assumption below.)
- When the `⚙` block's reserved width is what *causes* an item to fold, does the fold run two passes
  (fit once with no reserve; if everything fits, render no `⚙`) or always reserve and hide? D3 and D4
  together imply the two-pass rule but do not state it. (Recorded as a Tentative assumption below.)
- Does the fold budget measure the header's `flex-1` spring or the header element itself? (Recorded
  as a Confident assumption below.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | D1 — controls live in the tile header's `flex-1` spring (`surface-layout.tsx:1854`, inside the `{!mobile &&}` block at :1815), via a gui branch mirroring the existing tty branch | Discussed — user chose the existing header slot over a permanent floating pill; the tty branch is live precedent in the same slot | S:95 R:75 A:90 D:95 |
| 2 | Certain | D2 — measured priority fold: fit as many controls as possible in a fixed priority order, fold the rest into `⚙`; NO breakpoint constants | Discussed — user chose measurement over the current `TOOLBAR_OVERFLOW_MIN_PX`/`TOOLBAR_SHORT_LABEL_MAX_PX` breakpoints, because runtime label widths vary | S:95 R:70 A:90 D:90 |
| 3 | Certain | D3 — `⚙` renders only when something is actually folded and disappears at full width (an overflow affordance, not permanent chrome) | Discussed — user chose the top bar's chevron rule over a permanent gear | S:90 R:85 A:85 D:90 |
| 4 | Certain | D4 — the pinned block never folds; its MEASURED width is reserved from the budget BEFORE any ladder item is fitted. In this change it holds `⚙` alone | Discussed — user chose a reserved block so the later keyboard-capture control drops into an already-reserved slot; mirrors the top bar's trailing-chevron reserve | S:90 R:80 A:85 D:85 |
| 5 | Certain | D5 — labels degrade one step before an item folds: `1920×1080 ▾` → `1920 ▾`; `◐ Balanced` → `◐` | Discussed — user chose spend-degradation-before-dropping (cheapest move first, keeps the control reachable) | S:90 R:85 A:80 D:85 |
| 6 | Certain | D6 (REVERSED 2026-09-12) — fullscreen targets the **tile** (`[data-testid="surface-tile-gui"]`), the header travels, and the pill is **deleted**. Two edits: the `querySelector` in `guiFullscreen` (`app.tsx:1409`) and the identity→containment check (`gui-surface.tsx:417`). Fit math unchanged; `keyboardLock()` chaining unchanged | Discussed — the original rejection rested on a misreading of the call site (assumed a `wrapperRef` + pan/fit rework). Reading `app.tsx:1409` showed a DOM `querySelector`, so the swap is one line; user then chose to drop the pill entirely | S:95 R:85 A:90 D:95 |
| 7 | Certain | D7 — mobile is the bottom rung of the same ladder: everything folds, only the pinned block renders, and it renders into the TOP BAR; the `⚙` panel is the same component with `⌖` pointer mode and `⌨` key bar appended as coarse-only rows | Discussed — user chose the top bar because `surface-layout.tsx:1815` gates the whole tile header behind `!mobile` and mobile already shows one surface at a time via the top-bar switch group | S:90 R:75 A:80 D:85 |
| 8 | Certain | D8 — header chrome, not pill chrome: 24px fixed height axis (26 coarse), borderless with `hover:bg-bg-inset`, `text-text-secondary` → `text-text-primary` on hover, latched = green ink + inset ring (`controlClass({variant:"toggle", ringed:true})`, the ⌕ find-toggle precedent), text chips borderless/content-width/6px side padding | Discussed — user chose re-rendering in the header's vocabulary over reparenting; the pill's 33×35 `Control variant="chip"` floor does not fit the header's 32px content band | S:90 R:85 A:85 D:85 |
| 9 | Certain | D9 — Constitution V intact: every chip and panel row is a by-id `pickGuiActions` mirror of the `GUI:` palette family; no toolbar-only action. The `⚙` toggle gets `GUI: Show toolbar` / `GUI: Hide toolbar` rows, like `gui-keybar-show`/`gui-keybar-hide` | Constitution V plus the existing rule already stated in `palette/gui.ts:92`; the keybar pair at `palette/gui.ts:333`–`:334` is the exact precedent | S:95 R:80 A:95 D:95 |
| 10 | Certain | D10 — THREE dividers, FOUR groups (`size ┆ − fit + ┆ quality ┆ six action glyphs`); NO divider between the peer icons | Discussed — user rejected the earlier five-divider version; the dividers, not the gaps, were making the row sprawl | S:90 R:90 A:80 D:85 |
| 11 | Certain | D11 — items sit FLUSH at `gap: 0` (the header's flush-segment idiom); dividers carry all separation using the SHIPPED spec `mx-0.5 h-3.5 w-px bg-border`; verb boxes stay 24×24 so WCAG 2.2 SC 2.5.8 is untouched | Discussed — user rejected 6px (`gap-1.5`), which spends ~60px on air, roughly the whole reserve the later capture control needs; the divider spec is verbatim from `surface-layout.tsx:2007`/`:2058` | S:90 R:90 A:85 D:85 |
| 12 | Certain | D12 — every control carries a `Tip` inside ONE `TipGroup`; `Tip` REPLACES native `title=` (never both); `aria-label` stays as the coarse-pointer path; zoom tips pull keycaps from the LIVE `gui-zoom-in`/`-out`/`-fit` bindings via the source `withShortcutHints` reads; menu/cycle chips carry dim notes ("menu", "cycles") | Discussed; `tip.tsx`'s own docblock states the title-replacement rule, the warm-cluster 0ms behavior, the coarse suppression, and the no-wrapper-DOM-node property that makes it compose with width-measurement probes | S:85 R:85 A:85 D:85 |
| 13 | Certain | Priority ladder order: pin `⚙` · 1 screen size · 2 zoom (`− fit +`) · 3 quality · 4 input (`⎘ ⌥`) · 5 launch (`▣ ◍`) · 6 health (`∿ ↻`) | Discussed — the ordering was the core design decision; size is the tile's defining property and the menu host, zoom is the only per-moment control | S:95 R:85 A:80 D:85 |
| 14 | Certain | Quality keeps its label and degrades it rather than being glyph-only always | Discussed — user rejected glyph-only-always, which would reclaim ~55px but require a hover to read the current preset | S:90 R:85 A:80 D:85 |
| 15 | Certain | Persistence: the `⚙` panel's open/closed state persists per viewer as a NEW `rk-gui-toolbar` key in `lib/gui-posture.ts`, following the `rk-gui-keybar` precedent and that file's validated-read / try-catch-noop-write discipline | Discussed — user rejected reset-closed-each-visit as inconsistent with the six sibling keys (a narrow tile is narrow every visit) | S:90 R:80 A:85 D:85 |
| 16 | Certain | Architecture: pure fit arithmetic in a NEW `lib/gui-toolbar-fold.ts` shaped like `lib/top-bar-overflow.ts` (`computeVisibleCount`); the component owns DOM measurement, the module owns the decision | Discussed; this is the shipped split documented in both `top-bar-overflow.ts` and `crumb-collapse.ts` header comments — a third instance of a live pattern, not new plumbing | S:90 R:75 A:90 D:85 |
| 17 | Certain | Measurement wiring mirrors `top-bar.tsx:979`: ONE `ResizeObserver` plus a HIDDEN PROBE ROW rendering every candidate's real width; observe the header, the probe, AND the pinned block (an item's own width can change without the container resizing) | Discussed; nothing may be hardcoded because labels vary at runtime (`1920×1080` vs `auto`, coarse sizing, quality label) | S:90 R:75 A:90 D:85 |
| 18 | Certain | Collapse-first: visible count starts at 0 and is set in a `useLayoutEffect` BEFORE paint, so there is no flash of overflowing controls | Discussed; matches the shipped top-bar behavior | S:85 R:85 A:90 D:85 |
| 19 | Certain | Port one-sided EXPAND-EDGE hysteresis from `lib/crumb-collapse.ts` (`CRUMB_COLLAPSE_HYSTERESIS_PX = 24`) so the fold cannot flap when a drag hovers the boundary | Discussed; `crumb-collapse.ts` documents both the rationale and the exact one-sided shape | S:90 R:85 A:90 D:85 |
| 20 | Certain | Serialize a `candidateKey` so the measure effect re-runs when the probed SET changes, not on every render (the gui action list changes with connection state, lock, and pointer kind) | Discussed; the varying action list is visible in `pickGuiActions` | S:85 R:85 A:85 D:80 |
| 21 | Certain | SCOPE BOUNDARY: this change is the toolbar ONLY. Do NOT implement keyboard capture, the `gui-capture-toggle` binding, or the `rk-gui-capture` storage key — only the pinned-block plumbing they will later occupy | Discussed — user drew this boundary explicitly and assigned capture to a separate later PR | S:95 R:80 A:90 D:95 |
| 22 | Certain | Deletions in `gui-toolbar.tsx`: `TOOLBAR_OVERFLOW_MIN_PX` (560), `TOOLBAR_SHORT_LABEL_MAX_PX` (400), `TOOLBAR_HIDE_MS` (3000), `TOOLBAR_REVEAL_EDGE_PX` (24), `revealSignal`, the top-edge reveal `pointermove`, and the pill `wrapperWidth` observer are ALL deleted — the component becomes header-only | Discussed; follows directly from the reversed D6 deleting the pill | S:95 R:85 A:90 D:90 |
| 23 | Certain | `gui-keybar.tsx` (the key bar docked under the canvas) is a SEPARATE component and is UNCHANGED by this change | Discussed — user stated this explicitly when settling the mobile rung | S:95 R:90 A:90 D:95 |
| 24 | Certain | Testing: Vitest for the new pure module (colocated); a PLAYWRIGHT spec drives the fold ladder at real widths because jsdom has no layout engine, with retrying assertions since the ResizeObserver re-fit is not atomic with the resize; `gui-toolbar.test.tsx` largely rewritten; `gui-surface.spec.ts` reveal cases deleted (no reveal behaviour remains); a fullscreen case asserts the header renders inside the fullscreened tile | Discussed; the non-atomicity is documented by the existing `top-bar-overflow.spec.ts` / `crumb-collapse.spec.ts`, and `test-setup.ts`'s ResizeObserver stub keeps existing unit tests green | S:85 R:85 A:90 D:80 |
| 25 | Certain | Control-gallery PNG baselines are regenerated only IF the `Control` primitive emits new classes: `just test-e2e "control-gallery"` then visually review the diff (only intended cells may change) | `fab/project/code-quality.md` § Verification states this rule verbatim for that spec | S:85 R:90 A:95 D:85 |
| 26 | Certain | The two untracked design studies (`docs/wiki/gui-toolbar-header-studies.html`, `docs/wiki/gui-toolbar-header-exploration.html`) are committed as part of this change and each gets a row in `docs/specs/index.md`'s Wiki table, matching the neighbouring rows' style | Discussed — user named both files and the index requirement; the Wiki table already carries eleven sibling `docs/wiki/*.html` rows in exactly that style | S:90 R:90 A:85 D:90 |
| 27 | Confident | Everything the fullscreen pill renders stays as it is today, including its existing `TOOLBAR_OVERFLOW_MIN_PX`/`TOOLBAR_SHORT_LABEL_MAX_PX` degradation — "minimal pill" means the pill survives unchanged in fullscreen, not a newly trimmed subset | The scope note says those constants give way to the measured fold "in header mode", which implies they survive in fullscreen mode; no trimmed subset was ever specified, and the pill is one component plus one test file | S:70 R:80 A:80 D:70 |
| 28 | Confident | The fold budget is measured from the header's `flex-1` spring (the container the controls actually occupy), not from the header element, since the header also carries the glyph, title and right rail | The top-bar precedent measures the cluster wrapper, not the bar; `crumb-collapse.ts` explicitly measures the `flex-1 min-w-0` section wrapper; which element is observed is a one-line change | S:55 R:90 A:85 D:70 |
| 29 | Confident | The `⚙` panel reuses/extends the existing `gui-toolbar-menu.tsx` rather than introducing a second popover component, and its folded entries render as flat palette-mirror rows (not nested submenus) | D9 requires every panel row to be a by-id `pickGuiActions` mirror, which is a flat-row shape; Constitution IV resists a second surface; the panel is component-local | S:60 R:80 A:85 D:70 |
| 30 | Confident | The `rk-gui-toolbar` key defaults to CLOSED when absent (absent/invalid = panel closed), read through the same validated-read discipline as its siblings | An overflow panel's natural rest state is closed; `gui-posture.ts` treats absent/invalid as the safe default for every sibling key; the default is one line | S:55 R:90 A:85 D:80 |
| 31 | Confident | The mobile `⚙` pinned block is rendered in the top bar adjacent to the pinned mobile switch group (gated on the visible mobile surface being `gui`), rather than as an exempt right-cluster item or a row inside the existing top-bar overflow menu | D7 names the top bar and cites the switch group as the reason, but does not fix the slot; the top bar's cluster registry and overflow fit are shared machinery, so moving it post-implementation is a few files. Three valid placements, with switch-group adjacency the front-runner because it is D7's own stated reason | S:50 R:60 A:50 D:50 |
| 32 | Confident | Reserve resolution: the fold runs two passes — fit once with NO pinned reserve; if every ladder item fits, render no `⚙` and no reserve; otherwise re-fit with the pinned block's measured width reserved. This resolves the D3 (`⚙` not permanent) × D4 (reserve before fitting) circularity | D3 and D4 together imply it but neither states it, and the top-bar precedent does not answer it (its chevron block is permanent, so it always reserves). The alternative — always reserve and hide the `⚙` — is also defensible and yields a different `gui-toolbar-fold.ts` signature and different unit tests; at intake this is still one pure module's signature, revisable before any code exists | S:45 R:65 A:55 D:50 |
| 33 | Confident | The gui fold defines its OWN named hysteresis constant in `lib/gui-toolbar-fold.ts` (value 24, matching `CRUMB_COLLAPSE_HYSTERESIS_PX`) rather than importing the crumb constant, keeping the new module dependency-free as its precedent requires | "Port" was the word used, and `top-bar-overflow.ts`/`crumb-collapse.ts` are both dependency-free by design; but importing the shared constant is also defensible and avoids a magic number pair; either way it is one constant in one new module | S:60 R:90 A:80 D:70 |

33 assumptions (26 certain, 7 confident, 0 tentative, 0 unresolved).

> Rows 31 and 32 sit just above the Confident floor and carry `<!-- assumed: -->` markers in the body
> above — they are the two mechanics the design conversation implied but never stated, and are the
> highest-value targets for `/fab-clarify` before apply.
