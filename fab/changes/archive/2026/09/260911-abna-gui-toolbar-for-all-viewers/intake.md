# Intake: GUI toolbar for every viewer — resolution menu chip, fullscreen toggle, launch/input/health chips, `⋯` overflow by width

**Change**: 260911-abna-gui-toolbar-for-all-viewers
**Created**: 2026-09-11

## Origin

> Toolbar — mount-for-all + hover reveal, resolution menu chip, fullscreen toggle, launch/input/health chips, ⋯ overflow by width.
>
> Read fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md in full first, then follow its § Pickup protocol exactly. Base this intake on § Decision log rows T-D1 through T-D7 and the § Change breakdown → "T1 — Toolbar" subsection (Touches / Tasks / Done means / Manual acceptance: resizing the live rk-gui desktop from the pill once, then restoring the prior size via `rk gui resize <prev>`, and never while an agent loop or perf job is on the display — check `tmux -L rk-daemon list-windows -t rk-jobs` first).
>
> Treat § Decision log as Certain (no Likely rows for T). Verify at 375×812 (coarse) and 1280×800 (fine) with Playwright against this worktree's `just dev` rig before opening the PR, per Pickup protocol step 4 — that verification happens at apply/hydrate time, not in this draft step, but note it in the plan.

One-shot `/fab-draft` invocation (not activated; no branch). This is **T1** of the plan doc
`fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md` (written 2026-09-11 from the
gutsy-macaque discussion), the child of `26-09-09-gui-surface.md` and sibling of
`26-09-10-gui-lxqt-desktop.md` / `26-09-10-gui-viewer-ergonomics.md`. Design authority is the
plan's **§ Decision log → T-D1 … T-D7** (all Certain — no Likely rows on the T side) plus its
**§ UX copy** (quoted verbatim below) and **§ Change breakdown → T1 — Toolbar**. T1 deliberately
**amends one prior decision** — V-D10 of the viewer-ergonomics plan ("fine-pointer non-fullscreen
viewers never see the pill") — and treats every other D/L-D/V-D decision as settled. Its sibling
change **R1** (the desktop reference) is disjoint in code; the two share only `docs/specs/gui.md`
(different sections) and the memory hydrate, and the operator queue runs R1 then T1 serially, so
T1 rebases onto R1's merged spec mechanically.

Pickup-protocol reading done for this intake: the plan in full; `docs/specs/gui.md` § Switching
desktops, § The tile (incl. § The toolbar pill, HiDPI, and Send key), § Resize policy;
`fab/project/constitution.md`; `fab/project/context.md` § Mobile Responsive Design and
§ Playwright-Driven Development; memory `run-kit/gui` (§ The `gui.geometry` key, § The `rk gui`
CLI family, § Requirements, § Design Decisions), `run-kit/ui/keyboard-and-palette` (§ The `GUI:`
palette family), `run-kit/ui/lenses-and-layout` (§ GUI Surface), `run-kit/configuration`
(§ Settings Registry); and the live sources `components/gui-toolbar.tsx`, `gui-surface.tsx`,
`gui-pointer.ts`, `lib/palette/gui.ts`, `lib/gui-geometry.ts`, `surface-layout.tsx` (the GuiSurface
mount), `app.tsx` (the `buildGuiActions` call), the colocated unit tests, and
`tests/e2e/gui-surface.spec.ts`.

## Why

**The pain.** The gui tile's session toolbar pill (`components/gui-toolbar.tsx`) mounts only under
`(coarsePointer || fullscreen) && !credentials` and carries **viewer posture only**: `−` `fit` `+`,
`⌖` pointer mode (coarse), `◐` quality, `⌨` key bar (coarse), `∿` stats, `⤢` exit-fullscreen
(fullscreen only). A laptop user watching an agent drive the desktop has **no toolbar at all**, and
the things that viewer reaches for while watching — the desktop's resolution, fullscreen, "put a
terminal or browser on the empty desktop", paste, send a chord, reconnect — are **palette-only**
(`⌘K` → `GUI: …`). A phone user has the pill but not those verbs either. The palette is the complete
registry (Constitution V) but it is the *fallback* discovery path, not the one a person watching a
desktop expects; the tile itself should answer "what size is it, can I go fullscreen, can I launch
something" with one tap or one hover.

**If we do nothing.** Every viewer keeps learning the `GUI:` family by name. The resolution — a
*host* setting on a *shared* desktop that reflows every viewer's windows and moves an agent loop's
coordinates — has no status readout on the tile at all; a viewer cannot tell `1920×1080` from
`auto` from `locked` without opening the stats overlay or the palette. And the pill's V-D10 gate
means every future chip is invisible to the largest class of viewer (fine pointer, not fullscreen).

**Why this approach.** The shipped rule "every pill control mirrors an existing palette action"
(memory `gui.md` § Design Decisions) is exactly what makes widening the pill cheap: every chip
T-D3 adds **already has a palette row and a callback object**, so the pill grows by *selecting rows
by id*, with zero new actions and nothing to keep in step. Three design moves make the wider pill
safe on a phone and clean on a laptop:

1. **Mount for every viewer; differ only in the reveal** (T-D1): coarse viewers keep the tap reveal
   and shown-on-mount discovery; fine-pointer viewers get the fullscreen top-edge hover rule
   everywhere, so the tile stays clean by default.
2. **Resolution is a status chip that acts through a menu** (T-D2): the chip *reads* the live size
   (`1920×1080 ▾`, `auto ▾`, `🔒 1920×1080`) and *changes* it only through a second deliberate tap on
   a menu row — the two-tap path is the mis-tap guard on a 3-second auto-hiding pill.
3. **Overflow by pill width, not pointer kind** (T-D4): below 560 px of wrapper width the rest of the
   inventory folds under a `⋯` chip, so a 375-px phone fits one row and a narrow desktop split tile
   stays honest too.

Rejected alternatives (recorded in the plan): a bare preset chip (invites a phone mis-tap that
reflows every viewer); pointer-kind-gated overflow (a narrow fine-pointer split tile would wrap);
a chevron instead of `⋯` (`▾` already means "menu for this chip" on the resolution chip, so `⋯` is
the one that reads as "more"); a connection-health dot, drag-to-move pill, per-viewer chip
customization, bottom-docked variant, key-bar content changes (T-D7 — separate ideas).

## What Changes

All frontend (`app/frontend/src/…`) plus the spec amendment. No backend, no new route, no new
setting, no new palette row. Paths below are relative to `app/frontend/src/`.

### 1. Mount-for-all and the reveal rules (`components/gui-surface.tsx`, `components/gui-toolbar.tsx`) — T-D1

**Today** (`gui-surface.tsx` ~line 1054):

```tsx
{(coarsePointer || fullscreen) && !credentials ? (
  <GuiToolbar … revealSignal={revealSignal} … />
) : null}
```

and the top-edge reveal is fullscreen-only (~line 938):

```tsx
onPointerMove={(e) => {
  if (!fullscreen) return;
  const top = wrapperRef.current?.getBoundingClientRect().top ?? 0;
  if (e.clientY - top <= TOOLBAR_REVEAL_EDGE_PX) setRevealSignal((n) => n + 1);
}}
```

**After:**

- The mount gate becomes **`!credentials`** inside the canvas branch (the empty state and the
  credentials prompt still never mount it; the bare-WM strip state still does, as today — the pill
  rides the canvas wrapper).
- The `onPointerMove` handler drops the `if (!fullscreen) return;` guard: a pointermove within
  `TOOLBAR_REVEAL_EDGE_PX` (24 px, unchanged) of the wrapper's top edge bumps `revealSignal` for
  **every** viewer. The `onPointerDownCapture` tap reveal is unchanged.
- `GuiToolbar`'s initial `shown` state becomes **`coarsePointer || fullscreen`** (a new prop pair
  already present): a coarse viewer still discovers the pill on mount; a fine-pointer non-fullscreen
  viewer starts **hidden** and sees the pill only after a top-edge hover (the "Done means" for the
  1280-px viewport: *absent by default*).
- Because the pill is now always mounted, entering fullscreen no longer remounts it; `gui-surface.tsx`'s
  `fullscreenchange` handler (the one that sets `fullscreen`) also bumps `revealSignal` when
  `fullscreen` becomes true, so the pill shows on fullscreen entry exactly as it did when it mounted
  fresh.
- Hide timing is unchanged: `TOOLBAR_HIDE_MS = 3_000` after the last reveal or pill interaction —
  **except while a menu is open** (§ 6 below).
- Nothing changes on the `screen-sharing` (macOS mirror) backend beyond the rows already hidden
  there: the mirror has no launch/resolution rows, so those chips are absent by construction (§ 5).

### 2. The shared anchored menu (`components/gui-toolbar-menu.tsx`, new) — T-D2 / T-D4 / T-D6

One component both the resolution chip and the `⋯` chip open. Shape:

```ts
export type GuiToolbarMenuRow = {
  id: string;            // the palette row id (`gui-res-1280x720`, `gui-open-terminal`, …)
  label: string;         // palette label with the `GUI: ` prefix stripped
  description?: string;  // palette description verbatim (`current`, `locked`, `default`, …)
  disabled?: boolean;
  onSelect: () => void;  // THE palette row's onSelect — never a new closure with logic
};

interface GuiToolbarMenuProps {
  /** `data-menu` value: "resolution" | "overflow" (one test id, two menus). */
  kind: "resolution" | "overflow";
  anchorRef: RefObject<HTMLElement>;   // the chip; the menu renders under it
  rows: GuiToolbarMenuRow[];
  ariaLabel: string;
  onClose: () => void;                 // pick, Escape, outside pointerdown
}
```

- Rendered **inside the surface wrapper** (`position: absolute`, top = chip bottom + 4 px gap —
  `BreadcrumbDropdown`/`TopBarOverflowMenu`'s `MENU_GAP_PX` idiom — horizontally clamped to the
  wrapper), `data-testid="gui-toolbar-menu"`, `data-menu={kind}`, `role="menu"`, one column,
  monospace, `POPOVER_SHELL` from `components/controls.ts`, rows as `Control variant="menu-row"`
  (`role="menuitem"`), the palette's idioms: `label — description` when a description exists,
  disabled rows dimmed and inert, the `current` description rendered as the trailing check
  (`MENU_ROW_CHECK_MARK`) the way the palette marks `current`.
- Keyboard: focus moves into the menu on open (first enabled row); `↑`/`↓` rove, `Enter`/`Space`
  select, `Escape` closes and returns focus to the chip; `Tab` closes. The menu's own `onKeyDown`
  stops propagation so noVNC's canvas keyboard never sees these keys (the menu is a sibling of the
  noVNC host, not a descendant, so nothing reaches the canvas anyway; the wrapper's
  `onKeyDownCapture` reclaim only fires for registry chords).
- Close: a pick fires the row's `onSelect` and closes; **Escape**; an **outside pointerdown**
  (document-level capture listener while open — a tap on the canvas closes the menu *and* is
  otherwise an ordinary tile tap). The pill itself stays shown while a menu is open (§ 6).
- Touch pass-through: see § 7.

### 3. The resolution chip and its menu — T-D2

**Chip** (`data-testid="gui-toolbar-resolution"`, `Control variant="chip"`, `aria-haspopup="menu"`,
`aria-expanded`):

| Stream state (`GuiSignal`) | Chip label | `aria-label` |
|---|---|---|
| `geometry === "auto"` | `auto ▾` | `Resolution auto, menu` |
| fixed, `locked === false` | `1920×1080 ▾` | `Resolution 1920×1080, menu` |
| fixed or auto, `locked === true` | `🔒 1920×1080 ▾` / `🔒 auto ▾` | `Resolution 1920×1080, locked, menu` |

The `W×H` half is the **live desktop size** — the stream entry's `width`×`height` (what the stats
overlay already renders), formatted `W×H` with the `×` glyph and **no `(portrait)` suffix** on the
chip (the menu rows keep `presetLabel`'s suffix). When `width`/`height` are `0` (a stream entry that
omitted them), fall back to `presetLabel(geometry)`. Below **400 px** of wrapper width the label
drops the `×H` half — `1920 ▾` / `🔒 1920 ▾` — so the primary set fits one row at 375 px (see § 5's
arithmetic); the `aria-label` keeps the full size.

**Presence**: the chip renders iff at least one `gui-res-*` row is present in the action list
(i.e. `reachable && backend !== "screen-sharing"` — hidden on the macOS mirror, where the palette
hides the rows too).

**Menu rows**, in this order, each the palette row selected **by id** (§ 8):

| Row label (prefix stripped) | Palette id | Notes |
|---|---|---|
| `Resolution → 1280×720` → shown as `1280×720` | `gui-res-1280x720` | `current` description on the live one |
| `1600×900` | `gui-res-1600x900` | |
| `1920×1080` | `gui-res-1920x1080` | |
| `2560×1440` | `gui-res-2560x1440` | |
| `1080×1920 (portrait)` | `gui-res-1080x1920` | |
| `Match this tile` | `gui-res-match` | present (the tile is open by construction) |
| `Auto (follow this tile)` | `gui-res-auto` | absent while `geometry === "auto"` (the destination-only rule, unchanged) |
| `Custom…` | `gui-res-custom` | opens app.tsx's `GuiGeometryPrompt` |
| `Lock resolution` / `Unlock resolution` | `gui-lock` / `gui-unlock` | present only where the palette has them (fine pointer); under a fixed geometry disabled with the fixed-size description — V-D4 unchanged |

Row labels strip the `GUI: Resolution → ` arrow prefix as well as `GUI: ` (the menu's title *is*
"Resolution"); every other menu strips only `GUI: `.

**Locked semantics**: while the host pin is set (`locked`), the five preset rows, `Match this tile`,
`Auto`, and `Custom…` render **disabled with the description `locked`**. This gate lives in
`buildGuiActions` (its input gains `locked: boolean`, threaded from `gui?.locked ?? false` in
`app.tsx`), so the palette's `GUI: Resolution →` rows read disabled/`locked` too — the pill keeps
having no logic of its own (T-D5), and the palette stays the truthful registry.

**Two-tap guard**: picking a size posts `POST /api/gui/host/resize` immediately (the palette row's
`onResize`, no confirm) — the chip-then-row path *is* the mis-tap guard.

### 4. Fullscreen toggle — T-D3

`⤢` is present for every viewer and **toggles**: `aria-label="Enter fullscreen"` when not
fullscreen, `"Exit fullscreen"` when fullscreen; it fires the `gui-fullscreen` row's `onSelect`
(app.tsx's `guiFullscreen`, already a toggle that exits when fullscreen; zen fallback where
`requestFullscreen` is absent, the row's description already says so). Today the chip exists only
while fullscreen (exit-only).

### 5. Chip inventory, groups, order, and the `⋯` overflow — T-D3 / T-D4

**Wide (wrapper ≥ 560 px)**, left to right, groups separated by a 1-px divider (`w-px self-stretch
bg-border`):

```
[ 1920×1080 ▾ ][ ⤢ ] | [ − ][ fit ][ + ][ ◐ Balanced ] | [ ⌖ Trackpad ][ ⌨ ][ ⎘ ][ ⌥ ] | [ ▣ ][ ◍ ] | [ ∿ ][ ↻ ]
```

| Group | Chip | Glyph/label | Palette id(s) | Presence rule |
|---|---|---|---|---|
| Display | resolution | `W×H ▾` (§ 3) | `gui-res-*` | iff any `gui-res-*` row present |
| Display | fullscreen toggle | `⤢` | `gui-fullscreen` | always (tile open) |
| View | zoom out | `−` | `gui-zoom-out` | always rendered; **disabled** when the row is absent (at `fit`) |
| View | zoom fit | `fit` | `gui-zoom-fit` | always rendered; disabled when absent (at `fit`) |
| View | zoom in | `+` | `gui-zoom-in` | always rendered; disabled when absent (at `200`) |
| View | quality | `◐ <current label>` | `gui-quality-<next>` | always; fires the row for `nextGuiQuality(current)` (the cycle, as today) |
| Input | pointer mode | `⌖ Trackpad` / `⌖ Touch` (glyph-only below 560) | `gui-pointer-touch` / `gui-pointer-trackpad` | coarse only; fires whichever destination row is present |
| Input | key bar | `⌨` (`pressed={keyBarVisible}`) | `gui-keybar-hide` / `gui-keybar-show` | coarse only; whichever is present |
| Input | paste | `⎘` `aria-label="Paste clipboard"` | `gui-paste` | iff present (connected) |
| Input | send key | `⌥` `aria-label="Send key…"` | `gui-send-key` | iff present (connected) |
| Launch | terminal | `▣` `aria-label="Open terminal"` | `gui-open-terminal` | iff present (reachable, not mirror) |
| Launch | browser | `◍` `aria-label="Open browser"` | `gui-open-browser` | iff present |
| Health | stats | `∿` (`pressed={statsVisible}`) `aria-label="Toggle stats"` | `gui-stats-hide` / `gui-stats-show` | always; whichever is present |
| Health | reconnect | `↻` `aria-label="Reconnect"` | `gui-reconnect` | iff present (disconnected) |

A group whose chips are all absent renders no divider. **Not on the pill** (T-D3): `gui-turn-off`,
`gui-desktop`, `gui-logs` (they restart/kill the display or leave the tile), `gui-hidpi-*`,
`gui-view-1to1` (rare — palette only).

Presence follows the palette's omit-not-disable rule **except** the three zoom chips and the two
coarse posture chips, which keep today's fixed rendering (always present within their pointer gate,
disabled when the destination row is absent) so the View/Input groups never reflow as the zoom or
mode changes — the existing `GuiToolbar — gating` unit tests stay true.

**Narrow (wrapper < 560 px)** — the **primary set** plus `⋯`:

```
[ 1920×1080 ▾ ][ ⤢ ] | [ − ][ fit ][ + ] | [ ⌖ ][ ⌨ ] | [ ⋯ ]
```

`⋯` (`data-testid="gui-toolbar-overflow"`, `aria-label="More actions"`, `aria-haspopup="menu"`)
opens the shared menu (§ 2, `kind="overflow"`) with these rows, in this order, each present iff its
chip would be present wide:

`Quality → Balanced` (label `Quality → <current>`; fires `gui-quality-<next>`) · `Paste clipboard`
· `Send key…` · `Open terminal` · `Open browser` · `Show stats` / `Hide stats` · `Reconnect`

At ≥ 560 px everything is inline and `⋯` is absent. The threshold is one exported constant,
`TOOLBAR_OVERFLOW_MIN_PX = 560` (`gui-toolbar.tsx`); the label-shortening threshold is
`TOOLBAR_SHORT_LABEL_MAX_PX = 400`. Both are measured against the **surface wrapper's** width (not
the viewport, not the pointer kind): `gui-surface.tsx` attaches a `ResizeObserver` to `wrapperRef`
(guarded by `typeof ResizeObserver !== "undefined"` for jsdom; initial value from
`getBoundingClientRect()`), keeps `wrapperWidth` in state, and passes it to `GuiToolbar` as a plain
`wrapperWidth: number` prop — so unit tests exercise 375 / 560 / 1280 by prop alone.

**375-px fit arithmetic** (why the short label exists): at coarse chip metrics (`coarse:min-w-[36px]`,
4-px gap, `px-1` pill padding) the narrow set is seven 36-px chips (252) + three 1-px dividers +
ten 4-px gaps (40) + 8 px padding = 303 px before the label chip. A full `1920×1080 ▾` label (~11
monospace cells ≈ 80 px + 16 px padding ≈ 96 px) lands at ≈ 399 px — over 375; the short `1920 ▾`
(≈ 59 px) lands at ≈ 362 px. The apply agent confirms with the real 375×812 screenshot and tunes the
400-px threshold if the measured widths differ (the plan's § Risks row).

### 6. Hide-timer suspension while a menu is open — T-D6

`GuiToolbar` holds `openMenu: "resolution" | "overflow" | null`. The hide effect becomes:

```ts
useEffect(() => {
  if (!shown || openMenu !== null) return;   // an open menu suspends the timer
  const t = setTimeout(() => setShown(false), TOOLBAR_HIDE_MS);
  return () => clearTimeout(t);
}, [shown, interactions, openMenu]);
```

Any pointerdown on the pill **or on a menu** calls `poke()` (restarts the timer); closing a menu
restarts it too (the `openMenu` dependency), so the pill hides 3 s after the menu closes. A
`revealSignal` bump while a menu is open is harmless (sets `shown`, already true).

### 7. Touch pass-through (`components/gui-pointer.ts`) — T-D6

`CHROME_SELECTOR` gains the menu:

```ts
const CHROME_SELECTOR =
  '[data-testid="gui-keybar"], [data-testid="gui-wm-strip"], [data-testid="gui-surface-credentials"], [data-testid="gui-toolbar"], [data-testid="gui-toolbar-menu"]';
```

so a trackpad-mode touch on a menu row is never owned (the compatibility mouse events reach the
row). `gui-pointer.test.ts` § chrome pass-through gains a `gui-toolbar-menu` case mirroring the
existing `gui-toolbar` one.

### 8. Selecting palette rows by id (`lib/palette/gui.ts`, `app.tsx`, `surface-layout.tsx`, `gui-surface.tsx`) — T-D5

- `lib/palette/gui.ts` exports a pure helper — **no new rows**:

  ```ts
  /** Pick rows out of a built `GUI:` list by stable id, preserving list order;
   *  absent ids are simply absent. */
  export function pickGuiActions(actions: readonly GuiPaletteAction[], ids: readonly string[]): GuiPaletteAction[];
  /** `GUI: Resolution → 1280×720` → `1280×720`; `GUI: Open terminal` → `Open terminal`. */
  export function stripGuiLabel(label: string, arrowPrefix?: string): string;
  ```

  plus the `locked` input described in § 3 (the only behavioral change to the builder: `gui-res-*`
  rows gain `disabled: true, description: "locked"` while `input.locked`).
- `app.tsx` already builds `guiActions` (memoized on the terminal route); it threads that array
  down as a new `guiActions: GuiPaletteAction[]` prop through `SurfaceLayout` → the lazy
  `GuiSurface` → `GuiToolbar` (`actions` prop). The zen-fallback description patch on
  `gui-fullscreen` rides along.
- `GuiToolbar`'s per-chip callback props (`onZoom`, `onPointerMode`, `onKeyBarVisibleChange`,
  `onFullscreen`, `quality.onChange`, `stats.onVisibleChange`) are **retired**; every chip and menu
  row fires `row.onSelect` of the row picked by id. The state props the labels need stay:
  `zoom`, `pointerMode`, `coarsePointer`, `fullscreen`, `keyBarVisible`, `quality`, `statsVisible`,
  plus new `geometry`, `width`, `height`, `locked`, `connected`, `wrapperWidth`, `revealSignal`.
  `GuiSurface` keeps its own `onZoomChange` / `onPointerModeChange` / … props — they still serve the
  chords, pinch, and the imperative seams; only the pill stops consuming them.
- The unit-test suite `GuiToolbar — shared callbacks with the palette rows` becomes an identity
  check in the other direction: build one `buildGuiActions(...)` list, hand it to the pill, click a
  chip, assert the **same** `onSelect` (same function object) as the palette row with that id was
  called with identical arguments.

### 9. Tests

**Unit (`gui-toolbar.test.tsx`, `gui-toolbar-menu.test.tsx` new, `gui-pointer.test.ts`, `lib/palette/gui.test.ts`)**:
show/hide machine incl. suspension while a menu is open and the fine-non-fullscreen hidden start;
gating per § 5's presence table; resolution label derivation (`auto ▾` / `W×H ▾` / `🔒` prefix /
fallback to `presetLabel(geometry)` / short label below 400); menu rows built by id with `current`
and `locked` descriptions and the Auto-hidden-under-auto rule; overflow at `wrapperWidth` 375
(primary set + `⋯`), 559 (same), 560 (all inline, no `⋯`), 1280; menu keyboard (roving, Escape
closes and refocuses the chip), outside-pointerdown close; `pickGuiActions` / `stripGuiLabel`;
`locked` disables `gui-res-*` in the builder; chrome pass-through for `gui-toolbar-menu`.

**E2E (`tests/e2e/gui-surface.spec.ts`, mocked-signal describes, intent comments per the
constitution's Test Intent Comments rule)**:

- **375×812 coarse** (existing `mobile (375px)` describe, `mockGuiBackend(page, GUI_ON_ICEWM)`):
  the pill shows on open with the primary set and `⋯`, fits one row (assert the pill's bounding box
  width ≤ 375 and its chips share one `top`); `⋯` opens `gui-toolbar-menu[data-menu="overflow"]` with
  the § 5 rows; the resolution chip reads the mocked size (`1920×1080 ▾` or the short form — assert on
  `aria-label`), opens the resolution menu, and tapping `1280×720` posts the exact resize body
  (`page.route` intercept, the same assertion as the existing "Resolution → 1280×720 posts the exact
  resize body" test) — mocked, so no live desktop is touched.
- **1280×800 fine** (existing `desktop (1280px)` describe): the pill is **absent** after the tile
  opens; a `mouse.move` within 24 px of the wrapper's top edge reveals it; every chip is inline and
  `gui-toolbar-overflow` has count 0; the resolution menu's rows are present with `current` on the
  mocked size.
- The real-rig describe is not extended: the mocked resize-body assertion plus the existing
  real-rig "the resize endpoint drives the display size" spec cover the chain end to end.

**Playwright-driven verification (apply/hydrate time, before the PR opens — Pickup protocol
step 4)**: start this worktree's rig with `just dev`, drive it with Playwright at **375×812
(coarse)** and **1280×800 (fine)**, screenshot the pill wide, narrow, with each menu open, and
attach both viewport screenshots to the PR. The plan's `context.md` § Playwright-Driven Development
loop is the procedure; `just pw test gui-surface` runs the spec against the same rig identity.

### 10. Spec amendment (`docs/specs/gui.md` § The toolbar pill, HiDPI, and Send key) — T-D1

Rewrite the pill paragraph: the pill mounts for **every** viewer of the canvas state (never the empty
or credentials states); coarse viewers see it on mount and on a tap, fine-pointer viewers on a
pointermove within 24 px of the tile's top edge (fullscreen or not); it hides 3 s after the last
reveal or interaction, **suspended while one of its menus is open**; the chip inventory and groups
per § 5, the resolution chip's status-label + menu grammar per § 3, the `⋯` overflow below 560 px of
tile width; every chip and menu row is a `GUI:` palette row selected by id (Constitution V
unchanged). Record the amendment explicitly: "amends V-D10's two-context rule; T-D1–T-D7 of
`fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md` are the design log". R1 edits
§ Switching desktops of the same file — different section; rebase mechanically.

### 11. Manual acceptance on the live `rk-gui` session (once, at hydrate/ship time)

The live host desktop is shared. Before touching it: `tmux -L rk-daemon list-windows -t rk-jobs`
— **never** while an agent loop or perf job is on the display. Then `rk gui status` (note the
current geometry as `<prev>`), pick one preset from the pill's resolution menu on a real viewer,
confirm `rk gui status` reports the new size, and restore with `rk gui resize <prev>`. Do this once;
everything else is verified on the isolated `just dev` / e2e rig.

### 12. Plan bookkeeping

Fill the T1 row's Change ID in the plan's § Change breakdown (done at draft time: `abna`); mark
Done when merged; T1's PR (the last in the queue) updates the plan's § Status line.

## Affected Memory

- `run-kit/gui`: (modify) § Requirements → "The toolbar pill mirrors the palette, in exactly two contexts" becomes "…mounts for every viewer; the reveal differs by pointer" (T-D1 amends V-D10); § Design Decisions gains "The pill mounts for every viewer; only the reveal differs" (T-D1), "Resolution is a status chip that acts through a menu, never a bare preset chip" (T-D2), "Overflow is decided by pill width, not pointer kind" (T-D4), and "A locked host disables the size rows in the builder, so both surfaces agree" (§ 3); the existing "Every pill control mirrors an existing palette action" DD stays and gains the by-id mechanism.
- `run-kit/ui/lenses-and-layout`: (modify) § GUI Surface → the toolbar-pill paragraph (mount gate, reveal rules, inventory/groups, the two menus, the `ResizeObserver` width prop, the hide-timer suspension, the `gui-toolbar-menu` chrome pass-through); § Design Decisions → "The toolbar pill is presentational; the tile owns its context, app.tsx owns every action" updated to the `guiActions`-threaded, select-by-id shape.
- `run-kit/ui/keyboard-and-palette`: (modify) § The `GUI:` palette family — the builder's new `locked` input (Resolution rows disabled with `locked`), and the exported `pickGuiActions` / `stripGuiLabel` helpers the pill consumes.

## Impact

- **Code**: `components/gui-toolbar.tsx` (rewrite of the inventory; ~190 → ~350 lines), new
  `components/gui-toolbar-menu.tsx` (+test), `components/gui-surface.tsx` (mount gate, reveal, the
  `ResizeObserver`, new props threaded to the pill, fullscreen-entry reveal bump),
  `components/surface-layout.tsx` (thread `guiActions`), `app.tsx` (pass `guiActions`; `locked` into
  `buildGuiActions`), `lib/palette/gui.ts` (+`locked`, `pickGuiActions`, `stripGuiLabel`),
  `components/gui-pointer.ts` (one selector), tests as § 9, `docs/specs/gui.md` § The toolbar pill.
- **Behavior visible to every viewer**: a laptop viewer now has a hover-revealed pill; a phone
  viewer's pill grows a resolution chip and a `⋯` menu. Nothing changes for the palette except the
  `locked` disabled state on the Resolution rows.
- **Shared-desktop risk**: the pill can now resize the shared desktop from a phone — mitigated by
  the two-tap menu path and the `locked` gate; the manual acceptance touches the live display exactly
  once and restores it.
- **Scale**: ~9 plan tasks (full lane, above the light-lane threshold). Estimated ~1 h 30 including
  the two-viewport Playwright loop.
- **Dependencies**: none new; reuses `Control`, `controls.ts` popover constants, `gui-geometry.ts`,
  `gui-posture.ts`. Serial after R1 in the operator queue (shared `docs/specs/gui.md` file only).
- **Constitution**: I — no subprocesses; II — postures stay in localStorage, resolution stays the
  settings key; III — reuses the palette rows, Control primitive, noVNC seams; IV — no new route or
  page; V — every chip is a palette row; Test Intent Comments — every new `test()` carries
  Proves/Steps.

## Open Questions

- None. § Decision log T-D1–T-D7 is Certain; the remaining implementation choices are recorded as
  Confident assumptions below and are cheap to revise via `/fab-clarify` or at apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | T-D1: the pill mounts for every canvas-state viewer (`!credentials`); coarse keeps tap reveal + shown-on-mount, fine-pointer viewers get the 24-px top-edge hover reveal everywhere; empty/credentials states never mount it; mirror backend unchanged beyond already-hidden rows | Plan § Decision log, Certain by the user's instruction; amends V-D10 deliberately and records it in spec + memory | S:95 R:70 A:90 D:95 |
| 2 | Certain | T-D2: a status-labelled resolution chip (`1920×1080 ▾` / `auto ▾` / `🔒` prefix while locked) opening an anchored one-column menu whose rows ARE the palette's Resolution + Lock rows; no confirm on pick (two-tap path is the guard); size rows disabled `locked` while the host pin is set; hidden on the macOS mirror | Plan § Decision log + § UX copy (chip label, menu rows, aria labels quoted verbatim) | S:95 R:75 A:90 D:95 |
| 3 | Certain | T-D3: inventory and order Display `W×H ▾` `⤢`(toggle) · View `−` `fit` `+` `◐` · Input `⌖` `⌨` (coarse) `⎘` `⌥` · Launch `▣` `◍` · Health `∿` `↻`, 1-px dividers; Turn off / Desktop… / logs / HiDPI / 1:1 stay palette-only | Plan § Decision log + § UX copy (wide pill) | S:95 R:80 A:90 D:95 |
| 4 | Certain | T-D4: overflow decided by wrapper width via a `ResizeObserver`; below 560 px the primary set `W×H ▾` `⤢` `−` `fit` `+` `⌖` `⌨` + `⋯`, the rest under a `⋯` menu rendered like the resolution menu; at ≥ 560 everything inline, `⋯` absent | Plan § Decision log + § UX copy (narrow pill, `⋯` rows) | S:95 R:85 A:90 D:90 |
| 5 | Certain | T-D5: every chip and menu row fires the palette row's own callback object, selected by stable id from the same `buildGuiActions` output app.tsx feeds the palette; labels strip `GUI: `; no new rows; Constitution V unchanged | Plan § Decision log; the shipped memory DD "Every pill control mirrors an existing palette action" | S:95 R:80 A:95 D:95 |
| 6 | Certain | T-D6: reuse the pill's reveal machinery and `gui-pointer.ts` never-owned pass-through (selector gains the menu test id); any pill/menu interaction restarts the hide timer; an open menu suspends it until close | Plan § Decision log; the named new failure mode (menu vanishing mid-choice) is the reason | S:90 R:85 A:90 D:90 |
| 7 | Certain | T-D7 out of scope: connection-health dot, drag-to-move pill, per-viewer chip customization, bottom-docked variant, key-bar content changes | Plan § Decision log | S:95 R:95 A:90 D:95 |
| 8 | Certain | Verification protocol: Playwright against this worktree's `just dev` rig at 375×812 (coarse) and 1280×800 (fine) before the PR opens, both screenshots attached; manual acceptance on the live `rk-gui` desktop exactly once, after checking `tmux -L rk-daemon list-windows -t rk-jobs`, restoring with `rk gui resize <prev>`; new e2e `test()`s carry Proves/Steps intent comments | Plan § Pickup protocol step 4, § T1 Manual acceptance, the user's instruction; constitution § Test Intent Comments | S:95 R:90 A:90 D:95 |
| 9 | Confident | The pill consumes a `guiActions: GuiPaletteAction[]` prop threaded app.tsx → SurfaceLayout → GuiSurface → GuiToolbar; GuiToolbar's per-chip callback props are retired in favor of `row.onSelect`; GuiSurface keeps its own callback props for chords/pinch/RFB seams | T-D5 names "the same `buildGuiActions` input … threaded from app.tsx, selecting rows by their stable ids"; threading the built array is the smallest shape that satisfies it; the plan's Touches row says "thread the action input" | S:80 R:70 A:80 D:75 |
| 10 | Confident | The `locked` disabled state (`disabled: true, description: "locked"` on `gui-res-*` rows) lives in `buildGuiActions` via a new `locked` input, so the palette rows read disabled too | T-D5's "no chip has logic of its own" plus T-D2's locked semantics can only both hold if the gate is in the builder; palette and pill then agree; reversible in one file | S:70 R:85 A:80 D:70 |
| 11 | Confident | Chip label derivation: `auto ▾` when `geometry === "auto"`, else `W×H` from the stream entry's `width`×`height` (fallback `presetLabel(geometry)` when 0), `🔒 ` prefix when `locked`, no `(portrait)` suffix on the chip (menu rows keep it) | T-D2 says "the live desktop size … from the stream's geometry"; `width`/`height` are the live framebuffer the stats overlay already reads; suffix dropped to fit the phone row | S:75 R:90 A:80 D:65 |
| 12 | Confident | Below 400 px of wrapper width the chip label drops the `×H` half (`1920 ▾`) and the `⌖` chip is glyph-only below 560; thresholds are exported constants, confirmed against the 375×812 screenshot at apply | Plan § Risks names this exact fallback; the 375-px width arithmetic in § 5 lands the full label at ≈ 399 px (over) and the short one at ≈ 362 px | S:70 R:90 A:80 D:60 |
| 13 | Confident | Presence follows omit-not-disable (a chip exists iff its palette row exists) except the three zoom chips and the coarse `⌖`/`⌨`, which stay always-rendered and disabled when the destination row is absent so the View/Input groups never reflow | Preserves today's gating tests and avoids chip jitter on every zoom step; the palette's own convention for the rest | S:70 R:90 A:80 D:65 |
| 14 | Confident | The `⋯` menu's quality entry is one row `Quality → <current>` firing the `gui-quality-<nextGuiQuality(current)>` row (the inline chip's cycle, unchanged); `↻ Reconnect`, `⎘`, `⌥`, `▣`, `◍` appear only when their rows exist | Plan § UX copy lists `Quality → Balanced` as a single row; the cycle is the shipped chip behavior | S:75 R:90 A:80 D:65 |
| 15 | Confident | Menu component: rendered inside the surface wrapper (absolute, anchored under its chip, 4-px gap, clamped to the wrapper), `POPOVER_SHELL` + `Control variant="menu-row"`, roving ↑↓/Enter, Escape closes and refocuses the chip, outside pointerdown closes; test id `gui-toolbar-menu` with `data-menu`; `ResizeObserver` guarded for jsdom and the width passed as a prop | In-wrapper rendering keeps anchoring trivial and lets the trackpad pass-through selector apply; the popover constants are the repo's menu idiom (`TopBarOverflowMenu`, `BreadcrumbDropdown`) | S:75 R:90 A:85 D:60 |
| 16 | Confident | Fine-pointer non-fullscreen viewers start hidden (initial `shown` is true only when coarse or fullscreen); entering fullscreen bumps `revealSignal` so the always-mounted pill still shows on fullscreen entry | "Done means": absent by default at 1280 fine; fullscreen entry previously showed the pill via a fresh mount and must keep doing so | S:70 R:85 A:85 D:65 |
| 17 | Confident | E2E scope: mocked-signal specs at both viewports (incl. the `POST /api/gui/host/resize` body intercept); no new real-rig spec; the live-desktop check stays manual | The mocked intercept + the existing real-rig resize spec cover the chain; a real-rig pill test would add rig time without new coverage | S:75 R:90 A:85 D:60 |

17 assumptions (8 certain, 9 confident, 0 tentative, 0 unresolved).
