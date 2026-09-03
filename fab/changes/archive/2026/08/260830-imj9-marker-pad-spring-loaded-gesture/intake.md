# Intake: Marker rework phase 3 — the spring-loaded pad

**Change**: 260830-imj9-marker-pad-spring-loaded-gesture
**Created**: 2026-08-30

## Origin

Pickup of a pre-written plan phase — the third and last of the marker rework split. The user invoked
`/fab-new` with:

> Marker rework phase 3 -- the spring-loaded pad. Full scope, known traps, acceptance criteria, and
> gates are written out in `fab/plans/sahil/26-08-30-marker-rework-split.md` under "Phase 3 -- The
> spring-loaded pad" -- read that section for the intake. One question this phase answers: does the
> gesture hold at every edge? Six of #767s seven defects were here -- keep this change small and
> review it hard. Adds `marker-pad.tsx` (the 3 mode rows x stage columns grid, `selectCell` relative-
> displacement helper, `stepStage`, header line, highlight ring, placement helpers), `window-row.tsx`
> fine-pointer press target + press-drag-release gesture with live preview + wheel stepping +
> `marker-pad:open` listener, `app.tsx` `Tab: Marker` palette action, `sidebar/index.tsx` optional
> `onWindowMarkerChange` prop. **OQ-1** (how markers are set on a coarse/touch pointer, now that the
> hover card's Marker section is gone) has been **ANSWERED by the user: option 1, a tappable strip**
> -- a tap on the 22x36px marker strip opens the pad in click-menu mode on coarse pointers. Bake that
> into the intake as a settled decision, not an open question. Two defects found by hand after #767
> shipped that must be fixed here: (a) no Marker section in the row hover card -- do NOT port that,
> and do not build the pad's `inline` mode; (b) opening one pad must dismiss another -- give the pad
> its own module-scoped single-open registry like `row-flyout-card.tsx` uses, plus a capture-phase
> outside-dismiss listener. Known traps: the pad must fit the smallest sidebar (160px) via a width
> function of available sidebar width, not a fixed size; from the empty cell the first vertical step
> must land on `manual` not `auto`; wheel must ignore `deltaY === 0` and use a native non-passive
> listener (React registers wheel passively); Escape must revert the preview, not just close;
> `BoardPage` must get no marker seam; test the palette action through the production registry. Copy
> source is PR #767 (`git fetch origin refs/pull/767/head:pr767`) but apply the two hand-found-defect
> fixes above -- do not blindly copy those two parts. Gates: full set plus manual exercise on a real
> server at desktop and mobile widths before ship -- open two pads in sequence, drag past both edges,
> wheel over marked/unmarked rows, walk the pad by keyboard.

**Interaction mode**: one-shot. No SRAD questions were asked — the plan section, the four design
studies, the #767 reference implementation, and the user's explicit OQ-1 answer between them settle
every decision this phase makes. Everything left is verification, not deliberation.

**Design authority** (do not re-litigate): `docs/wiki/marker-3x3-studies.html` is canonical for the
grid, the stage widths, the chevron geometry, the T4 well, the ink pair, and — most relevant here —
the **live spring-loaded pad demo**, which is the gesture spec in motion.
`docs/wiki/marker-axis-studies.html` records why the spring-loaded gesture beat the one-step and
two-step alternatives; `docs/wiki/mode-axis-studies.html` fixes the vertical axis;
`docs/wiki/window-row-studies.html` is the row anatomy this sits on.

**Prerequisite state** (verified in this worktree, not assumed): phase 2 is merged. `origin/main` and
this branch's base are both at
`f84a8f2d feat: Marker rework phase 2 — migrate + contract: the well, the ink, the retirements (#770)`.
Present in the tree today:

- `app/frontend/src/marker.tsx` — the full vocabulary: `MARKER_MODES`, `MARKER_STAGES`,
  `MARKER_STAGE_GLOSS`, `Marker`, `parseMarker`, `formatMarker`, `MARKER_INK`,
  `MARKER_STAGE_WIDTHS`, the chevron constants, `markerFillStyle`, `MarkerChevrons`, **and
  `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE`** (relocated there by phase 2 precisely so the pad
  could import them).
- `window-row.tsx` — the display-only well (`data-testid="marker-well"`, `window-row.tsx:534-558`),
  `const parsedMarker = useMemo(() => parseMarker(marker), [marker])` and
  `const displayMarker = parsedMarker` (`:349-350`) — the seam phase 3 turns into a preview override.
- `api/client.ts:959 setWindowMarker` — **currently a dead export with zero call sites.** Phase 3 is
  its consumer.
- `SIDEBAR_MIN_WIDTH = 160` (`src/contexts/chrome-context.tsx:20`).

The prior change folders are `fab/changes/260830-nip5-marker-expand-mode-stage-vocabulary/` and
`fab/changes/260830-srec-marker-migrate-well-ink-retirements/`.

**Reference implementation**: PR #767 (`git fetch origin refs/pull/767/head:pr767`, head
`790120eb` — already fetched in this worktree). It implements all three phases in one change and is
**not to be merged** — it is the parts bin. **Copy, then read**: six of its seven real defects were in
this phase's ~30% of the diff, and two of them survived a fully green pipeline.

## Why

**The problem.** After phase 2 a marker is **display-only**. The 3×3 model renders correctly in the
well on both pointer classes, the vocabulary is narrowed, the API validates it — and there is no way
to set one from the UI. Today the only write path is
`tmux set-option -w -t <window> @rk_win_marker manual:2`, which the phase 2 PR body says out loud as a
temporary state. `setWindowMarker` sits in `api/client.ts` with no callers, and `window-row.tsx`'s
`marker` prop is read-only.

**The consequence of not doing it.** A label axis nobody can label is worse than no axis: it invites
the reader to conclude the feature is broken rather than unfinished. It also leaves a dead API export
and a dead client function that the next reviewer will (correctly) propose deleting, which would
strand the whole two-phase migration. And it violates Constitution V by omission — there is currently
no keyboard path to a marker at all, because the affordance that would be registered in the palette
does not exist.

**Why this shape.** Expand → migrate + contract → **add-interaction**. The interaction lands last, on
a settled data model and a settled renderer, so the review can be about one thing: *does the gesture
hold at every edge?* Nothing in this change touches storage, validation, or the drawn result of a
committed marker — a bug here can produce a wrong write or a stuck popover, never a token the server
cannot describe.

**Why this is the dangerous phase, and what that buys.** The post-mortem
(`docs/findings/marker-rework-review-cycles.md`) found **six of #767's seven real defects in the pad**
— and two of those were user-visible interaction defects that a fully green ten-cycle pipeline shipped
anyway. The split exists so that this ~+900/−100 of new interaction gets a review budget that is not
being spent re-reading a storage migration. Two of the six are already diagnosed below with their
verified causes and fixes; the remaining risk is edge behavior (clamping, placement, pointer classes),
which is why the acceptance list is written as edges and why a **hand exercise on a real server at
both widths is a ship gate**, not a nicety.

## What Changes

### 1. New — `app/frontend/src/components/sidebar/marker-pad.tsx`

Copy from `pr767:app/frontend/src/components/sidebar/marker-pad.tsx` (399 lines), then apply the
deltas in this section. The pad owns the **grid math, the rendering, and the keyboard model**; the
**gestures live with the consumer** (`window-row.tsx`).

**Deltas against the #767 copy — apply all of them:**

**(a) Single chrome. Delete `inline` mode entirely.** #767's pad takes `mode: "popover" | "inline"`
because it also mounted inside the flyout card's Marker row. That row is defect (a) and is not being
built. Remove the `mode` prop, `MARKER_PAD_INLINE_CELL_PX`, and every `mode === "popover"` /
`mode === "inline"` branch — the popover chrome, the mount-focus effect, and the Escape
`stopPropagation` all become unconditional. The pad is a popover, full stop.

**(b) Import from `@/marker`, do not redefine.** #767 imports the vocabulary from `@/themes` (that
tree kept it there) and **defines `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` in `marker-pad.tsx`**.
In this tree both already live in `src/marker.tsx` (phase 2, deliberately). Import them; do not
re-export them from the pad and do not create a second definition.

**(c) The single-open registry — defect (b)'s fix.** Add module-scoped state mirroring
`row-flyout-card.tsx:98-136`'s `activeFlyout` idiom:

```ts
/** The open pad's closer — one pad at a time across every row, regardless of
 *  event plumbing (a strip press stops propagation, so an outside-dismiss
 *  listener alone cannot see a press that lands on ANOTHER row's strip). */
let activeMarkerPad: { close: () => void } | null = null;

export function openMarkerPad(handle: { close: () => void }): void {
  if (activeMarkerPad && activeMarkerPad !== handle) activeMarkerPad.close();
  activeMarkerPad = handle;
}
export function closeMarkerPad(handle: { close: () => void }): void {
  if (activeMarkerPad === handle) activeMarkerPad = null;
}
/** Test seam — mirrors `resetFlyoutWarmState`. */
export function resetMarkerPadRegistry(): void {
  activeMarkerPad = null;
}
```

`window-row.tsx` calls `openMarkerPad` when it opens its pad and `closeMarkerPad` when it closes or
unmounts. See § "The two defects" for why the document listener alone is not sufficient.

**Kept verbatim from #767 (these are the reviewed, correct parts):**

- `selectCell(current: Marker | null, dx: number, dy: number, pitch: number): Marker | null` — a
  **pure relative-displacement** helper. `cols = Math.round(dx / pitch)`, `rows = Math.round(dy / pitch)`.
  Columns: `stageIndex = (current ? current.stage : 0) + cols`; `stageIndex < 1` returns `null` (the ∅
  cell) **except** when `current === null && rows !== 0`, in which case it re-enters at stage 1 — a
  purely vertical move off the ∅ column must not strand the highlight on a column it already left.
  Rows: `modeIndex = current ? MARKER_MODES.indexOf(current.mode) + rows : Math.max(rows - 1, 0)` —
  this `- 1` is the "∅ spans all three mode rows" rule (see the traps).  Both axes clamp to the grid
  edges.
- `stepStage(marker, direction: 1 | -1)` — clamped to 1..3, mode unchanged.
- `sameCell(a, b)` — grid-position equality, `null` = the ∅ column.
- `padHeader(marker)` — `` `${mode} · ${MARKER_STAGE_GLOSS[stage]}` ``, `"∅"` on the clear cell.
- `markerPadPopoverLayout(sidebarWidth): { width, cellPx, labelPx }` — the width function of
  available sidebar width. Constants: `POPOVER_CELL_PX = 26`, `POPOVER_INSET_PX = 8`,
  `POPOVER_PREFERRED_WIDTH_PX = 180`, `POPOVER_MIN_CELL_PX = 22`, `LABEL_PREFERRED_WIDTH_PX = 54`,
  `NON_TRACK_PX = 22`, `GAP_PX = 3`.
  `width = min(180, max(0, sidebarWidth - 8))`;
  `cellPx = clamp((width - 22 - 54) / 4, 22, 26)`; `labelPx = max(0, width - 22 - cellPx * 4)`.
  At a 160px sidebar this yields **width 152, cellPx 22, labelPx 42** — the label track truncates
  before any cell drops below its 22px floor.
  *(`NON_TRACK_PX = 22` = 2px border + 8px `p-1` + four 3px inter-track gaps. #767's comment on this
  constant miscounts the gaps as "four 12px"; the number is right, the prose is not — fix the comment
  while copying, it is one of this change's own lines.)*
- `placeMarkerPad(sidebar, row, pad, anchorLeft): { left, top }` — vertically centres the pad on the
  row when unconstrained and clamps to **every** sidebar edge; `left` and `top` are returned
  **row-relative** (the anchor is absolutely positioned inside the row).
- `MarkerPad` — `role="listbox" aria-label="Marker pad" data-testid="marker-pad"`, a
  `data-testid="marker-pad-header"` line, a label track of the three mode names, the ∅ button
  (`data-testid="marker-pad-cell-clear"`, one cell spanning all three rows, height
  `cellPx * 3 + GAP_PX * 2`), and nine `PadCell`s
  (`data-testid={"marker-pad-cell-" + mode + "-" + stage}`, `role="option"`,
  `aria-label={"Marker " + mode + ":" + stage}`). Each cell is a **mini well** — the same
  `MARKER_WELL_BACKGROUND` wash + `MARKER_WELL_EDGE` right edge + `markerFillStyle` /
  `MarkerChevrons` the row uses, so a preview and a committed marker cannot drift visually. The
  highlight is `ring-1 ring-text-primary`.
- Props: `value` (committed), `onPreview`, `onCommit`, `onCancel`, `cellPx`, `popoverWidth`,
  `labelPx`, `highlight` (the drag streams cells in through it; `undefined` = the pad owns its own
  highlight for the click/keyboard path).
- Keyboard model: mount focuses the cell for `value`. `ArrowRight`/`ArrowLeft` walk stages (left off
  stage 1 lands on ∅, right off ∅ enters at stage 1), `ArrowUp`/`ArrowDown` walk modes,
  `Enter`/`Space` commit, **`Escape` calls `pick(value)` first — reverting the preview — and then
  `onCancel()`**; the popover stops the key so the row's other dismissal paths do not double-fire.
  Every arrow move previews (`onPreview`) and moves focus.

### 2. `app/frontend/src/components/sidebar/window-row.tsx` — the gesture

Copy the block at `pr767:app/frontend/src/components/sidebar/window-row.tsx:258-425` plus its JSX
(`:765-830`), with the deltas below.

**New prop** (mirrors the shape #767 used, under phase 2's agreed new name at the sidebar level):

```ts
/** Persist a marker for this window — the stored `<mode>[:<stage>]` form, or
 *  null to clear. Written by the marker pad; the pad passes the EXACT picked
 *  cell, never a cycled state. Omitted on ghost rows and on the board route. */
onMarkerChange?: (server: string, session: string, windowId: string, marker: string | null) => void;
```

`const markerWired = !ghost && !!onMarkerChange && !!server;`

**Preview state.** `displayMarker` (today `= parsedMarker`, `window-row.tsx:350`) becomes
`markerPreview !== undefined ? markerPreview : parsedMarker`, where
`markerPreview: Marker | null | undefined` — `undefined` = no preview, `null` = preview the ∅ cell.
`displayMarkerStyle` and the `isBlocked` hazard predicate (`:426`) already read `displayMarker`, so the
well and the hazard wedge paint live during a drag with no further change.

**The press target.** An invisible overlay, rendered for `markerWired` rows:

```tsx
<div
  ref={stripRef}
  data-testid="marker-strip"
  aria-hidden="true"
  onPointerDown={onStripDown}
  onPointerMove={onStripMove}
  onPointerUp={onStripUp}
  className="absolute inset-y-0 left-0 w-[22px] cursor-pointer z-20"
/>
```

**Pointer-class split** (this is OQ-1's answer, see § below): #767 gated this on
`markerWired && !coarse`. It now renders on **both** pointer classes, and the handlers branch on the
`coarse` flag from the existing `useCoarsePointer()` (`window-row.tsx:246`):

- **Fine**: the full press → 2D drag → release-commits gesture, with pointer capture.
- **Coarse**: `onStripDown` opens the pad and returns — **no pointer capture, no `pointermove`
  selection**. A capture would swallow a vertical swipe that starts in the strip and stop the drawer
  from scrolling. A tap therefore lands the pad in click-menu mode, which is exactly the answered
  behavior; `onStripUp` has nothing to commit.

**The gesture (fine).**

- `onStripDown`: `e.stopPropagation()`; re-fit the layout from the enclosing
  `[data-sidebar-scroll]` element's measured width (so the pitch is right before the first
  `pointermove`); record `pressRef = { originX, originY, start: displayMarker }`; open the pad;
  `e.currentTarget.setPointerCapture?.(e.pointerId)` — **optional-call**, jsdom has no pointer-capture
  APIs and the unit tests drive the gesture directly (the `useRailScrub` idiom already in this file).
- `onStripMove`: `setMarkerPreview(selectCell(press.start, e.clientX - originX, e.clientY - originY, pitch))`.
- `onStripUp`: **recompute the cell from the release coordinates** rather than trusting that the last
  `pointermove` state update has rendered. If `!sameCell(cell, press.start)` → commit and close; else
  → clear the preview and **leave the pad open as a click menu**. Release the capture if held.
- Suppression: the flyout card is co-gated (`suppressed: ghost || showPinPopover || showLabelPicker || showMarkerPad`)
  and `onDragStart` early-returns with `preventDefault()` while `pressRef.current || showMarkerPad` —
  **a strip press must never select the row and never start an HTML5 drag**.

**Wheel.** A `useCallback`'d native handler attached with `{ passive: false }` via `stripRef` in a
`useEffect` — **React registers `wheel` passively at the root, so `preventDefault` inside `onWheel`
is a no-op** and the sidebar would scroll out from under the row being stepped. It returns early when
`!parsedMarker` (unmarked rows must not intercept the sidebar's scroll) and when `e.deltaY === 0`
(a horizontal or momentum-tail event — swallowing it would stop the scroll and step an axis nobody
asked for). Otherwise `preventDefault()` and commit `stepStage(parsedMarker, e.deltaY > 0 ? 1 : -1)`
when it differs from the current cell.

**Placement.** A `useLayoutEffect` gated on `showMarkerPad` measures the enclosing
`[data-sidebar-scroll]` box and the row box, re-fits via `markerPadPopoverLayout(bounds.width)`,
updates the pitch ref, and sets `padPosition` from
`placeMarkerPad(sidebarRect, rowRect, { width, height: anchor.offsetHeight }, MARKER_WELL_WIDTH)`.
The pad mounts in a `data-testid="marker-pad-anchor"` `absolute z-50` div positioned by `padPosition`.

**Dismissal.** A `useEffect` gated on `showMarkerPad` registering
`document.addEventListener("pointerdown", onDocDown, true)` — **capture phase** (see § "The two
defects"), ignoring targets inside the pad anchor or this row's own strip. Escape is owned by the pad
(revert-then-cancel). `padClose()` clears the preview, closes, nulls `pressRef`, and calls
`closeMarkerPad(handle)`; opening calls `openMarkerPad(handle)`.

**Palette listener.** Extend the existing imperative-event effect (`window-row.tsx:312-336`, which
today handles `pin-popover:open` and `label-popover:open`) with a third:

```ts
function padHandler(e: Event) {
  if (isMatch(e) && markerWired) setShowMarkerPad(true);
}
document.addEventListener("marker-pad:open", padHandler);
```

The pad focuses the committed cell itself on mount, so this is a complete keyboard path.

**Stale-comment fix (enumerated, and only these).** `window-row.tsx:46-47`'s `marker` prop doc still
reads `("" | "dotted" | "dashed" | "solid" | "double" | "thick")` — a legacy-vocabulary survivor of
phase 2's sweep, on the lines this change re-works. Rewrite it to the `<mode>[:<stage>]` form.

### 3. `app/frontend/src/components/sidebar/index.tsx` — the write seam + the scroll anchor

- **`onWindowMarkerChange`** — a new **optional** prop on `SidebarProps`, threaded through the
  intermediate `ServerGroup`-level props exactly as `onForkWindow` is (`index.tsx:175`, `:208`,
  `:1826`, `:2229-2230`, `:2313`, `:2969`, `:3146` are the seven `onForkWindow` sites to mirror), and
  passed to the row as `onMarkerChange={ghost ? undefined : onWindowMarkerChange}` at the ghost-row
  site. Signature: `(server: string, session: string, windowId: string, marker: string | null) => void`.
- **`data-sidebar-scroll=""`** on the `role="tree"` scroll container (`index.tsx:1723-1724`, the
  `treeRef` div). **This attribute does not exist anywhere in the tree today** — #767 added it in the
  same change as the pad, and both `onStripDown` and the placement effect resolve the sidebar box
  through `closest("[data-sidebar-scroll]")`. Without it the pad silently falls back to
  `document.documentElement` and the 160px clamp cannot work.

### 4. `app/frontend/src/app.tsx` — the palette entries

Replace the inline `window-label` action object (`app.tsx:2604-2620`) with a call to a new **exported**
builder:

```ts
/** Palette entries for the current row's two independent pickers: the color +
 *  flair Label picker and the marker pad. Both reach the row through its
 *  imperative CustomEvent opener (the `pin-popover:open` idiom), which is the
 *  keyboard path to affordances that otherwise need a pointer. Exported so the
 *  registration is testable through the production builder, not a copy. */
export function buildTabPickerActions(server: string, windowId: string): PaletteAction[] {
  return [
    { id: "window-label",  label: "Tab: Label",  onSelect: () => { document.dispatchEvent(new CustomEvent("label-popover:open", { detail: { server, windowId } })); } },
    { id: "window-marker", label: "Tab: Marker", onSelect: () => { document.dispatchEvent(new CustomEvent("marker-pad:open",   { detail: { server, windowId } })); } },
  ];
}
```

spread at the registration site as `...buildTabPickerActions(server, currentWindow.windowId)`. The
existing `window-label` comment block describes the picker as "colors + marker" and cites a change id
(`hwtr`) — both are wrong after phase 2 and both are on lines this change replaces; the builder's
doc comment above is the replacement, and it cites nothing.

Also add `handleWindowMarkerChange`:

```ts
const handleWindowMarkerChange = useCallback(
  (srv: string, _session: string, windowId: string, marker: string | null) => {
    setWindowMarkerApi(srv, windowId, marker).catch((err: Error) =>
      addToast(err.message || "Failed to set tab marker", "error"),
    );
  },
  [addToast],
);
```

imported as `setWindowMarker as setWindowMarkerApi` alongside the existing `setWindowColor as
setWindowColorApi`, and passed to the terminal-route `<Sidebar>` as
`onWindowMarkerChange={handleWindowMarkerChange}`.

### 5. `app/frontend/src/api/client.ts` and `src/types.ts` — two stale doc comments

`client.ts:956-958`'s `setWindowMarker` doc still says *`marker` is one of "dotted"/"solid"/"double"*
and `types.ts:99-103`'s `marker` field doc still lists the eight retired tokens. Both describe a
vocabulary the validator now rejects, and phase 3 is the change that gives `setWindowMarker` its
first caller. Rewrite both to `<mode>[:<stage>]`, mode ∈ `manual`/`auto`/`blocked`, stage ∈ 1..3,
`null` or `""` clears. **These two plus `window-row.tsx:46-47` are the complete list of comments this
change rewrites outside its own new code** — do not go looking for more.

### The answered open question — OQ-1, coarse-pointer marker setting

**Settled by the user: option 1, the tappable strip.** This is a decision, not an open question, and
must not be re-litigated in review.

On a coarse pointer the 22 × 36px marker strip is a tap target that opens the pad in **click-menu
mode**. It is narrow but deliberate, and unlike the retired dot zone it opens the marker pad rather
than competing with the flyout card — the 56px right-edge rail remains the sole coarse flyout
trigger, and the status dot (which sits in the content zone, from x = 30px) keeps its phase-2
row-select behavior.

Consequences that must be carried through:

- The strip renders on **both** pointer classes (#767 gated it `!coarse`).
- Coarse handlers do **not** capture the pointer and do **not** treat `pointermove` as cell
  selection — otherwise a swipe starting in the left 22px would stop the drawer scrolling.
- Two existing e2e tests assert the opposite of the new behavior and must be rewritten (see traps).
- Option 3 (a Marker row in the card on coarse only) is explicitly **rejected** — it contradicts
  defect (a).

### The two defects found by hand after #767 shipped

**(a) No Marker section in the row hover card.** Do **not** port #767's
`row-flyout-card.tsx` changes (`pr767:.../row-flyout-card.tsx:23-24, 666-667, 682-689, 725-729,
829-860` — the `marker` / `onMarkerCommit` props, the `markerCommit` gate, and the
`row-flyout-marker-action` row hosting an inline pad). Do not build the pad's `inline` mode or its
28px cell variant. The card keeps today's order: `Change color…` → fork → fix-tab-name → pin → kill
(`row-flyout-card.tsx:810-843`). `row-flyout-card.tsx` should end this change **untouched**.

**(b) Opening one pad must dismiss another.** On #767, pressing another row's marker strip left the
first pad open; dismissal only fired when the press landed elsewhere on a row.

*Verified cause*: `onStripDown` calls `e.stopPropagation()`, so the pad's document-level
**bubble-phase** `pointerdown` listener never sees a press that lands on another strip.

*Fix*: the module-scoped single-open registry in § 1(c) — the pattern this codebase already uses for
exactly this class of problem (`row-flyout-card.tsx:109` `activeFlyout`, closed by the next opener).
The registry makes single-open true **regardless of event plumbing**. Registering the outside-dismiss
listener in the **capture** phase (`addEventListener(..., true)` — the idiom the tree's
Escape-to-clear already uses) is a reasonable belt alongside it, and is also required.

*Required test*: mount two rows, open the first pad, press the second row's strip, assert **exactly
one** `[data-testid="marker-pad"]` is mounted. A test that only proves the second pad opened would
have passed on #767.

### Known traps (each was a real #767 finding, or verified in this worktree)

1. **The pad must fit the smallest sidebar.** `SIDEBAR_MIN_WIDTH = 160`
   (`src/contexts/chrome-context.tsx:20`); a fixed ~180px pad clips because the placement clamp
   collapses `maxLeft` to `minLeft`. The width is a **function of available sidebar width**
   (`markerPadPopoverLayout`), the label column shrinks first (`minmax(0, 54px)` → 42px at the
   minimum), and cells never go below 22px. **Test placement at 160px and 300px, for the first and
   last visible rows, asserting the box stays inside the sidebar** — that is four cases, and #767's
   own `marker-pad.test.tsx:52-94` is the shape to copy.
2. **From ∅, the first vertical step must land on `manual`, not `auto`.** The ∅ cell spans all three
   mode rows, so an unmarked row has no row of its own; `Math.max(rows - 1, 0)` is the whole fix and
   it is easy to "simplify" away. Only *further* downward pitches advance the mode.
3. **Wheel: only a vertical wheel steps, and the listener must be native and non-passive.**
   `deltaY === 0` returns **without** `preventDefault`. React registers `wheel` passively at the root,
   so `onWheel` + `preventDefault` is a silent no-op — attach through `stripRef` with
   `{ passive: false }`.
4. **Escape must revert the preview, not merely close.** An arrow walk previews cells; Escape restores
   the committed marker (`pick(value)` before `onCancel()`).
5. **The board route gets no marker seam.** `BoardPage` mounts `<Sidebar currentServer={null} …>`
   (`components/board/board-page.tsx:970-981`) and must supply **no** `onWindowMarkerChange`. Assert
   the strip is absent there. Do not add the prop to that call site "for symmetry".
6. **Test the palette action through the production registry**, not a copy of the builder — deleting
   the real `window-marker` registration must fail the test. That is why `buildTabPickerActions` is
   exported from `app.tsx`.
7. **Two existing e2e tests assert "no interactive zone" in the left strip and will now fail.**
   `tests/e2e/row-flyout.spec.ts:540` (*"fine left zone: no interactive zone, the 22px marker well
   stays, content starts ≈30px"*) and `:814` (*"coarse left zone: …"*) both encode phase 2's
   display-only left edge. Phase 3 re-introduces an interactive zone on **both** pointer classes.
   Rewrite both — including their `Proves:` / `Steps:` JSDoc, in the same edit (constitution § Test
   Intent Comments) — to assert the strip's new behavior while keeping their well-geometry and
   content-offset assertions, which are unchanged.
8. **`data-sidebar-scroll` does not exist in this tree.** Verified: `grep -rn "data-sidebar-scroll"
   app/frontend/src` returns nothing. Copying the pad without adding it to `index.tsx:1723` produces a
   pad that "works" in dev at wide widths and fails every clamp test.
9. **#767's import paths do not match this tree.** It imports the vocabulary from `@/themes`; here it
   is `@/marker`, and `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` are already exported from there —
   do not redefine them in `marker-pad.tsx`.
10. **Comment-hygiene acceptance is scoped to the diff.** Write it as *"no plan/change IDs
    (`R#` / `T###` / `A-###`) or removed-feature narration in comments **this change adds or
    modifies**"* — never as a repo-wide rule. The repo's own convention is to cite change ids, so an
    unscoped rule makes every review re-litigate untouched files; this single mistake cost five of
    #767's ten review cycles.
11. **The provenance sweep goes in the apply prompt, not the review.** Instruct the worker to run,
    before writing its result:
    `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files incl. tests>`
    and clear every hit. Workers mirror plan IDs into comments by habit, and the sweep must cover test
    and e2e files, not just `src/`.
12. **Do not re-run the full gate set for a comment fix.** Re-run what the edit touches.
13. **Treat the 3-cycle exhaustion stop as a design signal.** If this phase exhausts its rework
    budget, stop and re-plan rather than hand-driving it.
14. **Pre-warm the worker pane** (`fab dispatch open` → `ready` → clear any trust/update wall) before
    the pipeline needs it.

### Tests

**Unit — `src/components/sidebar/marker-pad.test.tsx` (new).** Copy the shape of
`pr767:.../marker-pad.test.tsx` minus its `inline`-mode case:

- `selectCell`: one pitch right = +1 stage; left past stage 1 = ∅; one pitch down = next mode, up =
  previous; **an unmarked row enters the grid at `manual` on the first vertical step**; over-drag
  clamps to the edge cell; diagonals move both axes; sub-pitch displacement is a no-op.
- `markerPadPopoverLayout` / `placeMarkerPad`: **the first and last visible row × {160px, 300px}
  sidebar** matrix, each asserting the placed box stays inside the sidebar; plus the geometry
  assertion (152/22/42 at the minimum, 180/26/54 when roomy).
- `stepStage` / `padHeader` / `sameCell`.
- `MarkerPad`: renders 3 mode rows × (∅ + 3 stage cells); the value's cell highlights and the header
  names it; each stage cell is a mini well sized to `cellPx`; the fitted width/pitch/label track
  render; hover previews without committing; click commits and ∅ clears; **arrows move, Enter
  commits, Escape reverts the highlight to `value`**; the `highlight` prop streams external cells in
  (the drag path).

**Unit — `src/components/sidebar/window-row.test.tsx`.**

- Press → move one pitch right → release commits the next stage via `onMarkerChange` with the
  formatted string; drag down commits the next mode; over-drag commits the edge cell.
- A no-move release leaves the pad mounted and calls `onMarkerChange` **zero** times.
- A strip press does not select/navigate the row and `dragstart` is prevented while armed.
- **Two rows: open the first pad, press the second row's strip, assert exactly one `marker-pad`.**
- Wheel steps a marked row and does not step an unmarked one; `deltaY === 0` passes through
  untouched (no `preventDefault`, no write).
- The `marker-pad:open` CustomEvent opens **this** row's pad and not a sibling's.
- Coarse (`useCoarsePointer` mocked true): the strip renders, a tap opens the pad, and a
  `pointermove` after the down does **not** change the preview.
- A row with no `onMarkerChange` renders no strip.

**Unit — `src/app.test.tsx`.** Register the palette through the **production**
`buildTabPickerActions` and assert both `window-label` and `window-marker` (`Tab: Marker`) are
present, and that selecting `window-marker` dispatches `marker-pad:open` with the right detail.

**Unit — `src/components/sidebar/index.test.tsx`.** `onWindowMarkerChange` reaches the row; omitting
it (the board-route shape) mounts no strip.

**e2e.** `tests/e2e/window-marker-gutter.spec.ts` gains the gesture cases (press-drag-release
persists `manual:2` without selecting the row; a no-move release opens the click menu and wheel steps
a marked stage — `pr767:.../window-marker-gutter.spec.ts:108-176` is the reference), keeping its
existing well-rendering test. `tests/e2e/row-flyout.spec.ts:540` and `:814` are rewritten per trap 7.
Every touched `test()` gets its `Proves:` / `Steps:` JSDoc updated in the same edit, citing no change
IDs or PR numbers.

### Explicitly out of scope

- **No card Marker row, no pad `inline` mode, no 28px cell variant** — `row-flyout-card.tsx` is not
  touched.
- **No backend change at all.** The vocabulary, the validator, the normalizer, and the snapshot paths
  are phase 1 + 2 and are final. `app/backend/` should not appear in `git diff --stat`.
- **No change to how a committed marker draws.** `marker.tsx`'s render half is phase 2's and is
  imported, not modified (the pad may need nothing from it beyond imports).
- **No `auto`-writing tooling.** OQ-2 (whether `fab fff` ever stamps `auto` at lifecycle boundaries)
  is explicitly "revisit only after phase 3 ships". The option stays user-owned.
- **No new route, no new settings key, no new `RK_*` env var.**

### Acceptance (from the plan, verbatim in intent)

- Press → drag one pitch right → release commits the next stage; drag down commits the next mode;
  over-drag clamps to the edge cell; a no-move release commits nothing and leaves the click menu open.
- Opening a second row's pad dismisses the first (**exactly one** pad mounted).
- The pad's box stays inside the sidebar at 160px and 300px, on the first and last rows.
- Wheel steps only on marked rows, only for non-zero `deltaY`, and does not scroll the sidebar.
- `Tab: Marker` opens the pad on the current row; arrows move, Enter/Space commit, Escape reverts and
  closes.
- The row hover card contains **no** Marker section.
- A strip press never selects the row and never starts an HTML5 drag.
- On a coarse pointer a tap on the 22 × 36px strip opens the pad in click-menu mode, and a swipe that
  starts in the strip still scrolls the drawer.
- The board route renders no marker strip.

### Gates

Full set, **one e2e invocation at a time** (the runner kills any listener on the e2e port
machine-wide; a second run started during the first's teardown fails with a real-looking
`ECONNREFUSED`):

```
cd app/backend && go test ./...
cd app/frontend && npx tsc --noEmit
just test-frontend
just test-e2e "window-marker-gutter"
just test-e2e "row-flyout"
just build
```

**Plus a ship gate the automated set cannot cover — manual exercise on a real server at desktop and
mobile widths**: open two pads in sequence, drag past both edges, wheel over marked *and* unmarked
rows, and walk the pad by keyboard. #767 shipped two user-visible interaction defects through a fully
green pipeline; this gate is why.

### Size estimate

~5 files plus one new component and one new test file. Roughly +900 / −100.

## Affected Memory

- `run-kit/ui/sidebar.md`: (modify) § row anatomy — the left 22px strip gains an interactive press
  target on **both** pointer classes: fine = press → 2D drag → release-commits with live preview plus
  wheel stage-stepping; coarse = tap opens the pad in click-menu mode (OQ-1 answered). Record that
  the strip press never selects the row and never starts a row drag, and that the 56px rail remains
  the sole coarse flyout trigger. Also record the new `data-sidebar-scroll` anchor on the tree
  container and the `onWindowMarkerChange` optional-prop seam (present on the terminal route, absent
  on the board route — the `onForkWindow` idiom).
- `run-kit/ui/dialogs-and-state.md`: (modify) add the marker pad as a popup surface — the 3 mode rows
  × (∅ + 3 stage) grid, its width-as-a-function-of-sidebar fit (152/22/42 at the 160px minimum,
  180/26/54 when roomy), the row-relative clamped placement, the module-scoped **single-open
  registry** (one pad at a time, the `activeFlyout` idiom) and capture-phase outside-dismiss, and the
  Escape-reverts-the-preview rule. Note explicitly that the pad has **one** chrome and is **not** in
  the row flyout card.
- `run-kit/ui/visual-design.md`: (modify) the marker section — pad cells are mini wells reusing the
  row's wash/edge/fill so preview and committed states cannot drift; the highlight is a
  `ring-1 ring-text-primary`; the header line is `<mode> · <gloss>` (`∅` on clear).
- `run-kit/ui/keyboard-and-palette.md`: (modify) the terminal-group action list gains `Tab: Marker`
  (`window-marker`), dispatching `marker-pad:open`; both tab-picker entries now come from the
  exported `buildTabPickerActions` builder.
- `run-kit/ui/status-signals.md`: (modify) the row's left-edge entry-point list — the marker strip is
  now an interactive target on both pointer classes, where phase 2 recorded it as display-only.
- `run-kit/api-and-sockets.md`: (modify) note that `setWindowMarker` regains a production caller —
  the pad writes `@rk_win_marker` through the existing unified `POST /api/windows/{id}/options`
  contract. No endpoint or validation change.

*(All six paths were verified to exist against `docs/memory/run-kit/` and `docs/memory/run-kit/ui/`;
the hydrate worker should still read the domain and sub-domain indexes and place content where the
existing sections live rather than creating near-duplicate files.)*

## Impact

**Frontend** (`app/frontend`):

| File | Change |
|------|--------|
| `src/components/sidebar/marker-pad.tsx` | **new** — grid, pure helpers, layout/placement, keyboard model, single-open registry |
| `src/components/sidebar/marker-pad.test.tsx` | **new** |
| `src/components/sidebar/window-row.tsx` | preview state, press target, gesture, wheel, placement, dismissal, `marker-pad:open`, `onMarkerChange` prop, one stale doc comment |
| `src/components/sidebar/index.tsx` | optional `onWindowMarkerChange` threaded like `onForkWindow`; `data-sidebar-scroll` on the tree container |
| `src/app.tsx` | exported `buildTabPickerActions`, `handleWindowMarkerChange`, sidebar wiring |
| `src/api/client.ts` | `setWindowMarker` doc comment only (it regains its first caller) |
| `src/types.ts` | `marker` field doc comment only |
| `src/components/sidebar/window-row.test.tsx`, `index.test.tsx`, `src/app.test.tsx` | new coverage |
| `tests/e2e/window-marker-gutter.spec.ts`, `tests/e2e/row-flyout.spec.ts` | gesture cases; the two "no interactive zone" tests rewritten |

**Untouched by design**: `app/backend/**` (no backend change), `src/marker.tsx` (imported only),
`src/components/sidebar/row-flyout-card.tsx` (defect (a)),
`src/components/board/board-page.tsx` (no marker seam), `src/components/swatch-popover.tsx`.

**API contract**: unchanged. The pad writes through the existing
`POST /api/windows/{windowId}/options` with `@rk_win_marker` set to a `<mode>[:<stage>]` token the
validator already accepts.

**Constitution**: II (no database) and IV (minimal surface — no new route, no settings key, no new
env var) unaffected. **V (keyboard-first) is positively served**: the pad's keyboard model plus the
`Tab: Marker` palette registration give the marker its first complete keyboard path, and the
registration is required, not optional. § Test Intent Comments binds every touched e2e `test()`.

## Open Questions

None. **OQ-1 is answered** — option 1, the tappable strip on coarse pointers — and is recorded above
as a settled decision, not a question. **OQ-2** (whether tooling ever writes `auto` at lifecycle
boundaries) is recorded in the plan as "revisit only after phase 3 ships" and is deliberately out of
scope; the option stays user-owned and the mode names stay generic.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The marker strip renders on **both** pointer classes; a coarse tap opens the pad in click-menu mode | The user answered OQ-1 explicitly with option 1 and instructed that it be baked in as settled. #767 gated the strip `!coarse`, so this is a deliberate divergence from the copy source | S:95 R:75 A:90 D:95 |
| 2 | Certain | The pad's `inline` mode, `MARKER_PAD_INLINE_CELL_PX`, and every `row-flyout-card.tsx` change from #767 are dropped; the card ends this change untouched | Defect (a), stated by both the plan and the user's invocation: "do NOT port that, and do not build the pad's inline mode". The card's current order is verified at `row-flyout-card.tsx:810-843` | S:95 R:85 A:95 D:95 |
| 3 | Certain | A module-scoped `activeMarkerPad` registry in `marker-pad.tsx` (open/close/reset), plus a **capture-phase** document `pointerdown` listener, is the fix for defect (b) | The user named both mechanisms and the pattern to copy; the cause is verified (`onStripDown`'s `stopPropagation` blinds a bubble-phase listener to a press on another strip). `row-flyout-card.tsx:109` is the in-tree precedent | S:95 R:85 A:95 D:90 |
| 4 | Certain | `marker-pad.tsx` imports `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` and the vocabulary from `@/marker` rather than defining or re-exporting them | Phase 2 relocated both constants into `src/marker.tsx` *specifically so phase 3 could import them* (its Assumption 1), and verified present at `marker.tsx:27-30`. #767 defines them in the pad because that tree had no `marker.tsx` | S:90 R:90 A:95 D:95 |
| 5 | Certain | `data-sidebar-scroll=""` is added to the `role="tree"` container at `sidebar/index.tsx:1723` | Verified absent from the whole tree today; `closest("[data-sidebar-scroll]")` is load-bearing in both `onStripDown` and the placement effect, and without it the 160px clamp silently measures `documentElement` | S:85 R:90 A:95 D:95 |
| 6 | Certain | `buildTabPickerActions` is **exported** from `app.tsx` and the palette test imports it, so deleting the `window-marker` registration fails a test | Stated as a trap in the plan ("test the palette action through the production registry, not a copy of the builder"); #767 already shaped it this way at `app.tsx:581` | S:90 R:85 A:95 D:95 |
| 7 | Certain | `BoardPage` supplies no `onWindowMarkerChange`; the optional prop mirrors `onForkWindow`'s threading | Plan trap, verified: `board-page.tsx:970-981` mounts `<Sidebar currentServer={null}>` with no fork handler either, and `onForkWindow` has seven threading sites in `sidebar/index.tsx` to mirror | S:90 R:85 A:95 D:95 |
| 8 | Certain | The comment-hygiene acceptance item is scoped to lines this change adds or modifies, and the provenance grep runs in the **apply** prompt before the worker writes its result | Post-mortem rules 1 and 2, stated verbatim in the plan's "Rules that bind every phase"; an unscoped rule cost five of #767's ten review cycles | S:95 R:90 A:95 D:95 |
| 9 | Certain | `selectCell`'s `Math.max(rows - 1, 0)` (∅ has no mode row of its own) and the `current === null && rows !== 0` re-entry are copied verbatim, with tests pinning both | Plan trap 2 names the first explicitly; the second is the same rule on the other axis and is easy to lose in a "simplification". #767's own tests cover both | S:85 R:70 A:90 D:90 |
| 10 | Confident | On coarse the handlers open the pad on `pointerdown` and then **do not** capture the pointer or select cells on `pointermove` | The answered behavior is "click-menu mode", which implies no drag; and capturing would swallow a vertical swipe starting in the left 22px, breaking drawer scrolling on mobile — a defect of exactly the class this phase exists to prevent. Not stated in the plan, so recorded rather than assumed silently | S:60 R:70 A:80 D:70 |
| 11 | Confident | `tests/e2e/row-flyout.spec.ts:540` and `:814` ("fine/coarse left zone: no interactive zone…") are rewritten, keeping their well-geometry and ≈30px content-offset assertions | Verified: both encode phase 2's display-only left edge, which this change reverses on both pointer classes. Neither is listed in the plan's traps — found by reading the current specs. Deleting them would lose the geometry coverage they also carry | S:70 R:80 A:85 D:80 |
| 12 | Confident | Three stale doc comments are rewritten — `window-row.tsx:46-47`, `api/client.ts:956-958`, `types.ts:99-103` — and that is the complete list | All three still name the eight retired tokens, all three sit on the marker write seam this change revives, and `setWindowMarker` gets its first caller here. Enumerating them caps the churn that trap 10 exists to prevent; #767 churned ~200 unrelated comment lines | S:65 R:85 A:85 D:75 |
| 13 | Confident | The row-level prop stays named `onMarkerChange` while the sidebar-level prop is `onWindowMarkerChange` | The plan names only the sidebar-level prop; #767 uses exactly this pairing (`onMarkerChange={onWindowMarkerChange}` at the row site), and it matches the file's existing `onWindowColorChange` → `onColorChange` convention | S:70 R:90 A:85 D:80 |
| 14 | Confident | New e2e gesture coverage lands in `window-marker-gutter.spec.ts` (not a new spec file), reusing that file's existing `_tmux` helper and setup | It is the marker spec, it already carries the well-rendering test and the tmux seam, and the gates name it. #767 put its two gesture tests there too | S:70 R:85 A:85 D:80 |
| 15 | Certain | The palette entry is recorded in `run-kit/ui/keyboard-and-palette.md`; hydrate places content in existing sections rather than creating new files | Verified against `docs/memory/run-kit/ui/` — there is no `command-palette.md`; all six Affected-Memory paths exist on disk today | S:85 R:85 A:95 D:90 |
| 16 | Confident | Wheel reads the **committed** `parsedMarker` (not the preview) and commits immediately, with no pad open required | #767's shape, and it is the only reading that makes "wheel steps only on marked rows" testable independently of the pad's open state; the plan's acceptance phrases wheel entirely in terms of marked/unmarked rows | S:65 R:85 A:80 D:75 |
| 17 | Confident | `#767`'s `NON_TRACK_PX = 22` is kept and only its comment corrected (2px border + 8px `p-1` + four 3px gaps, not "four 12px gaps") | The arithmetic checks out against the rendered tracks and reproduces the plan's stated 160px→152/22/42 fit; the prose does not. Correcting the number instead of the comment would break the documented minimum-width geometry | S:75 R:85 A:85 D:80 |

17 assumptions (10 certain, 7 confident, 0 tentative, 0 unresolved).
