# Plan: Marker rework phase 3 — the spring-loaded pad

**Change**: 260830-imj9-marker-pad-spring-loaded-gesture
**Intake**: `intake.md`

## Requirements

### Marker pad: grid model and geometry

#### R1: Relative-displacement cell selection
`selectCell(current, dx, dy, pitch)` SHALL be a pure function that maps a pointer **displacement**
(not a position) to a grid cell, clamped to the grid edges. Columns advance the stage
(`Math.round(dx / pitch)`), rows advance the mode (`Math.round(dy / pitch)`). The ∅ cell sits left of
stage 1 and spans all three mode rows, so an unmarked row has no mode row of its own: the **first**
vertical pitch in either direction MUST land on `manual` (the grid's first mode), and only *further*
downward pitches advance the mode. A purely vertical move off the ∅ column MUST re-enter the grid at
stage 1 rather than stranding the highlight on a column it has left.

- **GIVEN** a row committed to `manual:1` and a pitch of 26
- **WHEN** `selectCell({mode:"manual",stage:1}, 26, 0, 26)` is called
- **THEN** it returns `{mode:"manual",stage:2}`
- **AND** `selectCell({mode:"manual",stage:1}, -26, 0, 26)` returns `null` (the ∅ cell)
- **AND** `selectCell({mode:"manual",stage:1}, 260, 260, 26)` returns `{mode:"blocked",stage:3}` (both axes clamp)

- **GIVEN** an unmarked row (`current === null`)
- **WHEN** `selectCell(null, 0, 26, 26)` is called (one pitch down)
- **THEN** it returns `{mode:"manual",stage:1}` — **not** `auto`
- **AND** `selectCell(null, 0, 52, 26)` returns `{mode:"auto",stage:1}`
- **AND** `selectCell(null, 13, 13, 26)` (sub-pitch in both axes) returns `null`

#### R2: The pad's width is a function of the available sidebar width
`markerPadPopoverLayout(sidebarWidth)` SHALL return `{ width, cellPx, labelPx }` computed from the
measured sidebar width, never a fixed size. `width = min(180, max(0, sidebarWidth - 8))`;
`cellPx = clamp((width - 22 - 54) / 4, 22, 26)`; `labelPx = max(0, width - 22 - cellPx * 4)`. The
label track SHALL absorb the shortfall before any cell drops below its 22px floor.

- **GIVEN** the supported minimum sidebar of 160px (`SIDEBAR_MIN_WIDTH`, `contexts/chrome-context.tsx`)
- **WHEN** `markerPadPopoverLayout(160)` is called
- **THEN** it returns `{ width: 152, cellPx: 22, labelPx: 42 }`
- **AND** `markerPadPopoverLayout(300)` returns `{ width: 180, cellPx: 26, labelPx: 54 }`

#### R3: Placement clamps inside the sidebar on every edge
`placeMarkerPad(sidebar, row, pad, anchorLeft)` SHALL return **row-relative** `{ left, top }` that
centre the pad vertically on the row when unconstrained and clamp it inside every edge of the
sidebar box. The consuming row SHALL resolve that box from the enclosing `[data-sidebar-scroll]`
element.

- **GIVEN** a 160px sidebar and the first visible row (row top flush with the sidebar top)
- **WHEN** the pad is placed
- **THEN** the resulting absolute box lies wholly within the sidebar rectangle
- **AND** the same holds for the last visible row (row bottom flush with the sidebar bottom), and for
  both rows at a 300px sidebar

#### R4: The pad renders one chrome — a 3 mode rows × (∅ + 3 stage) grid of mini wells
`MarkerPad` SHALL render `role="listbox" aria-label="Marker pad"` containing a header line, a mode
label track, one ∅ cell spanning all three mode rows, and nine stage cells. Each stage cell SHALL be
a **mini well** built from the same `MARKER_WELL_BACKGROUND` wash, `MARKER_WELL_EDGE` right edge and
`markerFillStyle` / `MarkerChevrons` fill the row well uses, imported from `@/marker`, so a preview
and a committed marker cannot drift visually. The header SHALL read `` `${mode} · ${gloss}` `` for a
cell and `∅` for the clear cell. The highlighted cell SHALL carry a `ring-1 ring-text-primary`. The
pad SHALL have **no** `inline`/`popover` mode switch and no second cell-size variant.

- **GIVEN** a pad opened on a row committed to `auto:2`
- **WHEN** it mounts
- **THEN** ten cells render (`marker-pad-cell-clear` plus `marker-pad-cell-<mode>-<stage>` for all nine)
- **AND** `marker-pad-cell-auto-2` is the highlighted cell and `marker-pad-header` reads `auto · mid`
- **AND** each stage cell is `cellPx` square and carries the shared wash and right edge

#### R5: The pad is fully keyboard-operable and Escape reverts the preview
The pad SHALL focus the committed value's cell on mount. `ArrowRight`/`ArrowLeft` SHALL walk stages
(left off stage 1 lands on ∅, right off ∅ enters at stage 1), `ArrowUp`/`ArrowDown` SHALL walk modes,
and `Enter`/`Space` SHALL commit the highlighted cell. Every move SHALL emit a preview. `Escape`
SHALL **revert the highlight to the committed value first** and then cancel — closing alone is not
sufficient, because an arrow walk has already repainted the row.

- **GIVEN** a pad open on a row committed to `manual:1`, walked with ArrowRight to `manual:2`
- **WHEN** Escape is pressed
- **THEN** a preview of `manual:1` is emitted before the cancel fires
- **AND** no commit occurs

#### R6: Exactly one marker pad is open at a time
`marker-pad.tsx` SHALL own a module-scoped single-open registry (the `activeFlyout` idiom already in
`components/sidebar/row-flyout-card.tsx`), exporting an open/close pair plus a test reset. Opening any
pad SHALL close the previously open one **regardless of event plumbing**. The consuming row SHALL
additionally register its outside-dismiss `pointerdown` listener in the **capture** phase.

- **GIVEN** two window rows, the first with its pad open
- **WHEN** a pointerdown lands on the second row's marker strip (whose handler calls `stopPropagation`)
- **THEN** exactly one element with `data-testid="marker-pad"` is mounted, and it belongs to the second row

### Window row: the spring-loaded gesture

#### R7: Fine pointers get press → 2D drag → release-commits with live preview
The row SHALL render an invisible `absolute inset-y-0 left-0 w-[22px]` press target
(`data-testid="marker-strip"`) over the marker well for rows with a marker write seam. On a fine
pointer, `pointerdown` SHALL open the pad and record the press origin and the current cell,
`pointermove` SHALL live-preview `selectCell(...)` on the row's own well, and `pointerup` SHALL
**recompute the cell from the release coordinates** and commit it when it differs from the press
origin's cell. A release on the origin cell SHALL commit nothing and leave the pad open as a click
menu. The row's displayed marker SHALL read the preview over the committed value while a preview is
held.

- **GIVEN** a row committed to `manual:1` and a pad pitch of 26
- **WHEN** the strip is pressed and released 26px to the right
- **THEN** the marker write seam is called once with `"manual:2"` and the pad closes
- **AND** pressing and releasing 26px down commits `"auto:1"`
- **AND** pressing and releasing 400px right commits `"manual:3"` (clamped)
- **AND** pressing and releasing without moving calls the write seam zero times and leaves the pad mounted

#### R8: Coarse pointers open the pad by tap, and never capture the pointer
On a coarse pointer the same strip SHALL render and a tap SHALL open the pad in click-menu mode. The
coarse path SHALL NOT call `setPointerCapture` and SHALL NOT treat `pointermove` as cell selection —
a swipe beginning inside the strip must continue to scroll the sidebar drawer.

- **GIVEN** a coarse-pointer row carrying `manual:2`
- **WHEN** the strip is tapped
- **THEN** the pad mounts with `manual:2` highlighted and no write occurs
- **AND** a subsequent `pointermove` across the row emits no preview change

#### R9: Wheel steps the stage on marked rows only, through a native non-passive listener
The strip SHALL attach its `wheel` handler natively with `{ passive: false }` via a ref — React
registers `wheel` passively at the root, where `preventDefault` is a silent no-op. The handler SHALL
return early without `preventDefault` when the row has no committed marker, and when `deltaY === 0`
(a horizontal or momentum-tail event). Otherwise it SHALL `preventDefault` and commit
`stepStage(committed, deltaY > 0 ? 1 : -1)` when that differs from the committed cell.

- **GIVEN** a row committed to `manual:1`
- **WHEN** a wheel event with `deltaY = 120` fires over the strip
- **THEN** `preventDefault` is called and the write seam receives `"manual:2"`
- **AND** an unmarked row's wheel event neither prevents default nor writes
- **AND** a `deltaY === 0` event neither prevents default nor writes, on marked and unmarked rows alike

#### R10: The pad dismisses on outside press and on Escape, reverting the preview
While a pad is open the row SHALL register a document `pointerdown` listener in the **capture** phase
that ignores targets inside the pad anchor or the row's own strip and otherwise closes the pad. Close
SHALL clear the preview (restoring the committed marker), drop the armed press, and deregister from
the single-open registry.

- **GIVEN** an open pad whose highlight has been walked away from the committed value
- **WHEN** a pointerdown lands elsewhere in the sidebar
- **THEN** the pad unmounts and the row repaints its committed marker

#### R11: A strip press never selects the row and never starts a row drag
While a strip press is armed or a pad is open, the row's flyout card SHALL be suppressed and
`dragstart` SHALL be prevented. The press SHALL stop propagation so the row's own click/selection
path never sees it.

- **GIVEN** a row on a route where clicking navigates
- **WHEN** the strip is pressed, dragged and released
- **THEN** the route does not change, no row selection toggles, and no HTML5 drag begins
- **AND** the hover flyout card does not open while the pad is open

### Wiring: write seam, scroll anchor, and the palette

#### R12: The marker write seam is an optional prop, absent on the board route
`Sidebar` SHALL accept an **optional** `onWindowMarkerChange(server, session, windowId, marker)` prop,
threaded to the window row as `onMarkerChange` and omitted for ghost rows, mirroring `onForkWindow`'s
existing threading. `app.tsx` SHALL supply it on the terminal route; `board-page.tsx` SHALL NOT. A row
without the handler SHALL render no strip and no pad.

- **GIVEN** the board route's `<Sidebar currentServer={null}>` mount
- **WHEN** its window rows render
- **THEN** no `marker-strip` element exists on any row
- **AND** the same row on the terminal route does render one

#### R13: The sidebar scroll container is discoverable from a row
The `role="tree"` scroll container in `components/sidebar/index.tsx` SHALL carry
`data-sidebar-scroll=""`, which the row resolves via `closest()` to measure the sidebar box for the
pad's fit and placement.

- **GIVEN** a window row nested inside the sidebar tree
- **WHEN** it opens its pad
- **THEN** `closest("[data-sidebar-scroll]")` resolves to the tree container, not `document.documentElement`

#### R14: `Tab: Marker` is registered in the command palette through an exported builder
`app.tsx` SHALL export `buildTabPickerActions(server, windowId): PaletteAction[]` returning the
`window-label` (`Tab: Label`) and `window-marker` (`Tab: Marker`) entries, and register them in the
terminal group by spreading that builder. `window-marker` SHALL dispatch a `marker-pad:open`
CustomEvent carrying `{ server, windowId }`; the matching row SHALL open its pad, which focuses the
committed cell on mount. Tests SHALL exercise the **production** registration so that deleting the
entry fails a test.

- **GIVEN** the palette open on a terminal route
- **WHEN** `Tab: Marker` is selected
- **THEN** a `marker-pad:open` event fires with the current server and windowId
- **AND** only the row matching that detail opens its pad

#### R15: Retired marker vocabulary is gone from the doc comments this change touches
The three doc comments still naming the eight retired flat tokens SHALL be rewritten to the
`<mode>[:<stage>]` vocabulary: the `marker` prop in `components/sidebar/window-row.tsx`, the
`setWindowMarker` doc in `api/client.ts`, and the `marker` field doc in `src/types.ts`. No other
comment outside this change's own lines SHALL be rewritten.

- **GIVEN** the change's diff
- **WHEN** it is inspected for comment edits
- **THEN** exactly those three pre-existing comments are rewritten, each to the current vocabulary
- **AND** no comment in the diff cites a plan ID, change ID, or PR number

### Non-Goals

- **No Marker section in the row hover card** — `components/sidebar/row-flyout-card.tsx` is not
  touched. This is defect (a) from #767 and porting it is explicitly forbidden.
- **No `inline` pad chrome and no 28px cell variant** — the pad has one chrome.
- **No backend change** — the vocabulary, validator, normalizer and snapshot paths are final from
  phases 1–2. `app/backend/` must not appear in `git diff --stat`.
- **No change to how a committed marker draws** — `src/marker.tsx` is imported, not modified.
- **No `auto`-writing tooling** — OQ-2 stays open; the option remains user-owned.
- **No new route, settings key, or `RK_*` env var.**

### Design Decisions

#### Single-open registry over event-plumbing dismissal

**Decision**: `marker-pad.tsx` owns a module-scoped `activeMarkerPad` handle; opening any pad closes
the previously registered one. A capture-phase document `pointerdown` listener is kept alongside it as
a belt, not as the mechanism.
**Why**: the strip's `pointerdown` handler calls `stopPropagation()`, so a bubble-phase document
listener never sees a press that lands on **another row's strip** — the verified cause of #767's
"two pads open at once" defect. A registry makes single-open true independently of how events
propagate. The codebase already solves this exact class of problem this way in
`components/sidebar/row-flyout-card.tsx` (`activeFlyout`).
**Rejected**: moving the outside-dismiss listener to the capture phase *alone* — it fixes the observed
symptom for this one handler but leaves the invariant hostage to every future `stopPropagation` on the
path; and hoisting pad open-state into a React context, which is far more machinery than one
module-scoped handle and would re-render unrelated rows.
*Introduced by*: 260830-imj9-marker-pad-spring-loaded-gesture

#### One pad chrome; the coarse story is the strip, not the card

**Decision**: the pad ships with a single popover chrome. The coarse-pointer path to setting a marker
is a **tap on the 22 × 36px marker strip**, which opens that same pad in click-menu mode.
**Why**: OQ-1 was answered by the author in favour of the tappable strip. Unlike the retired dot zone
the strip opens the marker pad rather than competing with the flyout card, and the 56px right-edge
rail stays the sole coarse flyout trigger. One chrome means one keyboard model, one placement path and
one set of tests.
**Rejected**: a Marker row in the hover card (option 3 — contradicts the "no Marker section in the
hover popup" decision and was the second hand-found defect on #767); and leaving coarse display-only
with the palette entry as the only path (option 2 — zero new touch targets, but leaves the most
common mobile affordance unreachable without the keyboard).
*Introduced by*: 260830-imj9-marker-pad-spring-loaded-gesture

#### The coarse tap does not capture the pointer

**Decision**: on coarse pointers `pointerdown` opens the pad and returns; no `setPointerCapture`, no
`pointermove` cell selection.
**Why**: capturing the pointer in the left 22px of every row would swallow a vertical swipe that
begins there and stop the sidebar drawer from scrolling — a defect of exactly the class this phase
exists to prevent. "Click-menu mode" implies no drag, so nothing is lost.
**Rejected**: sharing the fine-pointer gesture on touch (breaks drawer scroll); and gating the strip
off on coarse as #767 did (leaves OQ-1 unanswered).
*Introduced by*: 260830-imj9-marker-pad-spring-loaded-gesture

#### Pad width is derived from the measured sidebar, not a constant

**Decision**: `markerPadPopoverLayout(sidebarWidth)` computes width, cell pitch and label-track width;
the label track shrinks before any cell drops below a 22px floor.
**Why**: `SIDEBAR_MIN_WIDTH` is 160px. A fixed ~180px pad clips, because the placement clamp collapses
`maxLeft` to `minLeft` and the pad is pinned to an edge with its right side outside the box. Deriving
the width is the only way the same component serves 160px and 300px.
**Rejected**: a fixed pad with horizontal scrolling (unusable at a 26px cell pitch); and rendering the
pad in a portal outside the sidebar (the pad's relative-displacement gesture is defined against the
row, and a portal would reintroduce the absolute-strategy overflow class of bug).
*Introduced by*: 260830-imj9-marker-pad-spring-loaded-gesture

#### The gesture lives in the row; the grid math lives in the pad

**Decision**: `marker-pad.tsx` exports pure helpers (`selectCell`, `stepStage`, `sameCell`,
`padHeader`, `markerPadPopoverLayout`, `placeMarkerPad`) plus the rendering and keyboard model;
`window-row.tsx` owns the pointer gesture, the preview state and the wheel listener.
**Why**: the risky part of this change is the gesture at its edges, and pure helpers make those edges
unit-testable without a DOM gesture harness — clamping, the ∅ row rule and the 160px fit are all
table tests. The row already owns the well it previews into.
**Rejected**: putting the gesture inside the pad (the pad does not exist until the press has already
begun); and a shared hook (one consumer, so the indirection buys nothing).
*Introduced by*: 260830-imj9-marker-pad-spring-loaded-gesture

### Deprecated Requirements

#### The row's left 22px strip is display-only

**Reason**: phase 2 (`260830-srec`) retired the interactive label zone and left the strip
display-only on both pointer classes as an interim state, pending this phase. Two e2e tests encode it
directly — `tests/e2e/row-flyout.spec.ts` *"fine left zone: no interactive zone…"* and *"coarse left
zone: no interactive zone…"*.
**Migration**: the strip becomes an interactive press/tap target on both pointer classes (R7, R8).
Both e2e tests are rewritten — keeping their well-geometry and ≈30px content-offset assertions, which
are unchanged — along with their `Proves:` / `Steps:` JSDoc in the same edit.

#### Markers are set only via `tmux set-option -w @rk_win_marker`

**Reason**: phase 2 shipped markers display-only and said so in its PR body; `api/client.ts`'s
`setWindowMarker` has had zero call sites since.
**Migration**: the pad becomes its production consumer through the existing unified
`POST /api/windows/{id}/options` contract. No endpoint or validation change.

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `data-sidebar-scroll=""` to the `role="tree"` scroll container (the `treeRef` div) in `app/frontend/src/components/sidebar/index.tsx` <!-- R13 -->
- [x] T002 [P] Fetch the reference implementation: `git fetch origin refs/pull/767/head:pr767` (already present in this worktree; verify with `git rev-parse pr767` → `790120eb`) and read `pr767:app/frontend/src/components/sidebar/marker-pad.tsx` before writing any pad code <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/frontend/src/components/sidebar/marker-pad.tsx` with the pure grid helpers copied from the #767 reference — `selectCell`, `stepStage`, `sameCell`, `padHeader` — importing `MARKER_MODES`/`MARKER_STAGES`/`MARKER_STAGE_GLOSS`/`Marker` from `@/marker` (NOT `@/themes`). Preserve `Math.max(rows - 1, 0)` and the `current === null && rows !== 0` re-entry verbatim <!-- R1 -->
- [x] T004 Add the fit and placement helpers to `marker-pad.tsx` — `markerPadPopoverLayout` plus its constants (`POPOVER_CELL_PX` 26, `POPOVER_INSET_PX` 8, `POPOVER_PREFERRED_WIDTH_PX` 180, `POPOVER_MIN_CELL_PX` 22, `LABEL_PREFERRED_WIDTH_PX` 54, `NON_TRACK_PX` 22, `GAP_PX` 3) and `placeMarkerPad`. Correct the `NON_TRACK_PX` comment: it is 2px border + 8px `p-1` + four 3px inter-track gaps, not "four 12px gaps" <!-- R2 R3 -->
- [x] T005 Add `PadCell` and the `MarkerPad` component to `marker-pad.tsx` — single chrome only: no `mode` prop, no `MARKER_PAD_INLINE_CELL_PX`, no `mode === "inline"` branch anywhere. Import `MARKER_WELL_BACKGROUND`, `MARKER_WELL_EDGE`, `MARKER_STAGE_WIDTHS`, `markerFillStyle`, `MarkerChevrons` from `@/marker`; do not redefine or re-export them <!-- R4 -->
- [x] T006 Add the keyboard model to `MarkerPad`: mount-focus the committed cell, arrows walk stages/modes with the ∅ edge rules, Enter/Space commit, and Escape calls `pick(value)` **before** `onCancel()` <!-- R5 -->
- [x] T007 Add the module-scoped single-open registry to `marker-pad.tsx` — `activeMarkerPad` plus exported `openMarkerPad` / `closeMarkerPad` / `resetMarkerPadRegistry` — modelled on `activeFlyout` in `components/sidebar/row-flyout-card.tsx` <!-- R6 -->
- [x] T008 In `app/frontend/src/components/sidebar/window-row.tsx`, add the optional `onMarkerChange` prop and `markerWired` gate, and convert `displayMarker` from `= parsedMarker` to the preview override (`markerPreview: Marker | null | undefined`) <!-- R7 -->
- [x] T009 Add the strip press target JSX (`data-testid="marker-strip"`, `aria-hidden`, `absolute inset-y-0 left-0 w-[22px] z-20`) and the fine-pointer `onStripDown`/`onStripMove`/`onStripUp` handlers, recomputing the cell from the release coordinates and using an optional-call `setPointerCapture?.()` <!-- R7 -->
- [x] T010 Branch the strip handlers on the existing `useCoarsePointer()` flag: on coarse, `pointerdown` opens the pad and returns — no pointer capture, no `pointermove` cell selection <!-- R8 -->
- [x] T011 Attach the wheel handler natively via `stripRef` with `{ passive: false }` in a `useEffect`, returning early on no committed marker and on `deltaY === 0` <!-- R9 -->
- [x] T012 Add the `useLayoutEffect` that measures `closest("[data-sidebar-scroll]")` and the row, re-fits via `markerPadPopoverLayout`, updates the pitch ref, and positions the `marker-pad-anchor` via `placeMarkerPad`; mount `MarkerPad` inside it and register/deregister with the single-open registry on open/close <!-- R3 R6 -->
- [x] T013 Add `padClose` / `padCommit` and the capture-phase document `pointerdown` dismissal effect, ignoring targets inside the pad anchor or this row's strip <!-- R10 -->
- [x] T014 Co-gate the row flyout on `showMarkerPad` and early-return with `preventDefault()` from `onDragStart` while `pressRef.current || showMarkerPad` <!-- R11 -->
- [x] T015 Add a `marker-pad:open` handler to the existing imperative-event effect alongside `pin-popover:open` / `label-popover:open`, gated on `markerWired` <!-- R14 -->
- [x] T016 Thread the optional `onWindowMarkerChange` prop through `components/sidebar/index.tsx` at every site `onForkWindow` uses (both prop type declarations, both destructures, and all three pass-through sites), passing it to the row as `onMarkerChange={ghost ? undefined : onWindowMarkerChange}` <!-- R12 -->
- [x] T017 In `app/frontend/src/app.tsx`, export `buildTabPickerActions(server, windowId)` returning the `window-label` and `window-marker` entries, replace the inline `window-label` action object with a spread of it, add `handleWindowMarkerChange` (calling `setWindowMarker` imported as `setWindowMarkerApi`, toasting on failure), and pass `onWindowMarkerChange={handleWindowMarkerChange}` to the terminal-route `<Sidebar>` <!-- R14 R12 -->

### Phase 3: Integration & Edge Cases

- [x] T018 [P] Create `app/frontend/src/components/sidebar/marker-pad.test.tsx` covering `selectCell`: one pitch right = +1 stage, left past stage 1 = ∅, one pitch down/up = next/previous mode, **unmarked rows enter at `manual` on the first vertical step**, over-drag clamps to the edge cell, diagonals move both axes, sub-pitch displacement is a no-op <!-- R1 -->
- [x] T019 [P] Add the fit/placement matrix to `marker-pad.test.tsx`: `markerPadPopoverLayout(160)` → `{152, 22, 42}` and `(300)` → `{180, 26, 54}`; and `placeMarkerPad` asserting the box stays inside the sidebar for the **first and last visible row × {160px, 300px}** (four cases) <!-- R2 R3 -->
- [x] T020 [P] Add `MarkerPad` rendering and keyboard cases to `marker-pad.test.tsx`: the 3 × (∅ + 3) grid, the value's cell highlighted and named in the header, each stage cell a mini well sized to `cellPx`, the fitted width/pitch/label track, hover previews without committing, click commits and ∅ clears, arrows move + Enter commits + **Escape reverts the highlight to `value`**, and the `highlight` prop streaming external cells in <!-- R4 R5 -->
- [x] T021 Add gesture cases to `app/frontend/src/components/sidebar/window-row.test.tsx`: one pitch right commits the next stage, one pitch down commits the next mode, over-drag commits the edge cell, a no-move release writes zero times and leaves the pad mounted, and a strip press neither selects/navigates the row nor allows `dragstart` <!-- R7 R11 -->
- [x] T022 Add the single-open test to `window-row.test.tsx`: mount two rows, open the first pad, press the second row's strip, assert **exactly one** `[data-testid="marker-pad"]` is mounted and it belongs to the second row. Reset the registry between tests via `resetMarkerPadRegistry` <!-- R6 -->
- [x] T023 Add wheel cases to `window-row.test.tsx`: a marked row steps and calls `preventDefault`; an unmarked row does neither; `deltaY === 0` does neither on marked and unmarked rows alike <!-- R9 -->
- [x] T024 Add pointer-class and seam cases to `window-row.test.tsx`: with `useCoarsePointer` mocked true a tap opens the pad and a following `pointermove` changes no preview; a row with no `onMarkerChange` renders no strip; the `marker-pad:open` event opens only the matching row's pad <!-- R8 R12 R14 -->
- [x] T025 [P] In `app/frontend/src/app.test.tsx`, import the **production** `buildTabPickerActions` and assert both `window-label` and `window-marker` (`Tab: Marker`) are registered and that selecting `window-marker` dispatches `marker-pad:open` with the right detail <!-- R14 -->
- [x] T026 [P] In `app/frontend/src/components/sidebar/index.test.tsx`, assert `onWindowMarkerChange` reaches the window row and that omitting it (the board-route shape) mounts no strip <!-- R12 -->
- [x] T027 Extend `app/frontend/tests/e2e/window-marker-gutter.spec.ts` with the gesture cases — press-drag-release persists `manual:2` without selecting the row; a no-move release opens the click menu and wheel steps a marked stage — keeping the existing well-rendering test. Write full `Proves:` / `Steps:` JSDoc for each new `test()`, citing no change IDs or PR numbers <!-- R7 R9 -->
- [x] T028 Rewrite the two left-zone tests in `app/frontend/tests/e2e/row-flyout.spec.ts` (*"fine left zone: no interactive zone…"* and *"coarse left zone: no interactive zone…"*) to assert the strip's new interactive behavior while keeping their 22px well-geometry and ≈30px content-offset assertions; update both `Proves:` / `Steps:` blocks in the same edit <!-- R8 R11 -->

### Phase 4: Polish

- [x] T029 Rewrite exactly three stale doc comments to the `<mode>[:<stage>]` vocabulary — the `marker` prop in `components/sidebar/window-row.tsx`, `setWindowMarker` in `api/client.ts`, and the `marker` field in `src/types.ts`. Touch no other pre-existing comment <!-- R15 -->
- [x] T030 Run the provenance sweep over every touched file **including tests and e2e specs** — `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files>` — and clear every hit before reporting completion <!-- R15 -->
- [x] T031 Run the gates in order, **one e2e invocation at a time**: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "window-marker-gutter"`; `just test-e2e "row-flyout"`; `just build`. Confirm `git diff --stat` touches no file under `app/backend/` and no `row-flyout-card.tsx` <!-- R15 -->

## Execution Order

- T001 blocks T012 and T027/T028 (the placement path resolves `[data-sidebar-scroll]`)
- T003 → T004 → T005 → T006 → T007 build up one file in order
- T008 blocks T009–T015 (the preview state and `markerWired` gate are their substrate)
- T016 blocks T017 (app.tsx passes the prop the sidebar must accept)
- T018–T020 depend on T003–T007; T021–T024 on T008–T015; T025–T026 on T016–T017
- T030 runs after every code and test task; T031 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `selectCell` is pure and relative — one pitch right steps the stage, one pitch down steps the mode, both axes clamp at the grid edges, and sub-pitch displacement selects nothing
- [x] A-002 R2: `markerPadPopoverLayout` derives `{width, cellPx, labelPx}` from the measured sidebar width, returning `{152, 22, 42}` at 160px and `{180, 26, 54}` at 300px
- [x] A-003 R3: `placeMarkerPad` returns row-relative coordinates that keep the pad box inside the sidebar rectangle on every edge
- [x] A-004 R4: `MarkerPad` renders one chrome — a 3 × (∅ + 3) grid of mini wells built from the shared `@/marker` wash, edge and fills — with a header line naming the highlighted cell and a `ring-1` highlight
- [x] A-005 R5: the pad is fully operable by keyboard: mount-focus, arrows, Enter/Space commit, Escape
- [x] A-006 R6: `marker-pad.tsx` exports a module-scoped single-open registry (open/close/reset) and the row registers with it
- [x] A-007 R7: the fine-pointer press → drag → release gesture commits the released cell and live-previews on the row's own well throughout the drag
- [x] A-008 R8: the strip renders on coarse pointers and a tap opens the pad in click-menu mode
- [x] A-009 R9: wheel stage-stepping is attached natively with `{ passive: false }` through a ref
- [x] A-010 R12: `onWindowMarkerChange` is optional on `Sidebar`, supplied by `app.tsx` and absent from `board-page.tsx`
- [x] A-011 R13: the `role="tree"` scroll container carries `data-sidebar-scroll=""`
- [x] A-012 R14: `buildTabPickerActions` is exported from `app.tsx` and both palette entries are registered by spreading it

### Behavioral Correctness

- [x] A-013 R1: from the ∅ cell the **first** vertical step lands on `manual`, not `auto`; only further downward pitches advance the mode
- [x] A-014 R5: Escape reverts the preview to the committed marker **before** cancelling — an arrow walk leaves no repaint behind
- [x] A-015 R6: opening a second row's pad dismisses the first — exactly one `marker-pad` is mounted after pressing another row's strip, despite that press calling `stopPropagation`
- [x] A-016 R7: a no-move release commits nothing and leaves the pad open as a click menu
- [x] A-017 R9: wheel steps only on rows with a committed marker, and only for non-zero `deltaY`; it does not scroll the sidebar while stepping
- [x] A-018 R11: a strip press never selects or navigates the row and never starts an HTML5 drag; the hover flyout stays suppressed while the pad is open
- [x] A-019 R8: no `setPointerCapture` is called on the coarse path, so a swipe starting in the strip still scrolls the drawer

### Removal Verification

- [x] A-020 R15: `git diff --stat` shows no change to `app/frontend/src/components/sidebar/row-flyout-card.tsx` — the hover card contains no Marker section
- [x] A-021 R4: no `inline` pad chrome, no `mode` prop, and no `MARKER_PAD_INLINE_CELL_PX` exist anywhere in `marker-pad.tsx`
- [x] A-022 R4: `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` are imported from `@/marker` and defined in exactly one place in the tree
- [x] A-023 R15: `git diff --stat` shows no file under `app/backend/`
- [x] A-024 R15: the three stale doc comments no longer name any retired flat token, and no other pre-existing comment was rewritten

### Scenario Coverage

- [x] A-025 R2/R3: placement is asserted for the **first and last visible row at both 160px and 300px** sidebar widths — four cases, each proving the box stays inside the sidebar
- [x] A-026 R14: the palette test imports the production `buildTabPickerActions`, so deleting the `window-marker` registration fails a test
- [x] A-027 R7/R9: `tests/e2e/window-marker-gutter.spec.ts` covers press-drag-release persistence, the no-move click menu, and wheel stepping on a live server
- [x] A-028 R8/R11: both rewritten `row-flyout.spec.ts` left-zone tests assert the new interactive strip while retaining their 22px well and ≈30px content-offset assertions
- [x] A-029 R12: a board-shaped `Sidebar` mount (no `onWindowMarkerChange`) renders no strip on any row

### Edge Cases & Error Handling

- [x] A-030 R1: over-drag past either edge sticks to the edge cell rather than wrapping or returning null
- [x] A-031 R9: a `deltaY === 0` wheel event passes through without `preventDefault` and without a write, on marked and unmarked rows alike
- [x] A-032 R2: at the 160px minimum the label track truncates and no cell falls below its 22px floor
- [x] A-033 R7: the release cell is recomputed from the release coordinates, so a commit does not depend on the last `pointermove` state update having rendered
- [x] A-034 R10: an outside pointerdown while the highlight has been walked away restores the committed marker on the row

### Code Quality

- [x] A-035 Pattern consistency: the single-open registry mirrors `row-flyout-card.tsx`'s `activeFlyout` idiom, and the optional prop mirrors `onForkWindow`'s threading
- [x] A-036 No unnecessary duplication: the pad reuses `markerFillStyle`, `MarkerChevrons` and the well tokens from `@/marker` rather than re-implementing any fill
- [x] A-037 Type narrowing over assertions: the preview tri-state (`Marker | null | undefined`) is discriminated with guards, not `as` casts
- [x] A-038 No magic numbers: every pad dimension is a named constant in `marker-pad.tsx`
- [x] A-039 Comment hygiene: no comment **this change adds or modifies** narrates the next line, addresses the reviewer, or cites a plan/change ID or PR number (`R#` / `T###` / `A-###` / 4-char ids). This is scoped to the diff — untouched files are out of scope and MUST NOT be flagged
- [x] A-040 Tests cover changed behavior: every new interaction path (gesture, wheel, keyboard, coarse tap, single-open) has a unit test, and the two user-visible paths have e2e coverage
- [x] A-041 Test intent comments: every touched Playwright `test()` carries updated `Proves:` and `Steps:` JSDoc in the same edit, narrating no history and citing no change IDs (constitution § Test Intent Comments)
- [x] A-042 Keyboard-first: the new affordance is registered in the command palette (constitution § V) and the pad itself is fully keyboard-operable

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Ship gate (human, not an acceptance item)

The plan's gates require, **after hydrate and before ship**, a hand exercise on a real server at
desktop and mobile widths: open two pads in sequence, drag past both edges, wheel over marked **and**
unmarked rows, and walk the pad by keyboard. PR #767 shipped two user-visible interaction defects
through a fully green pipeline — this gate is what that cost bought.

It is deliberately **not** an `## Acceptance` item: hydrate requires every acceptance item checked,
and this step happens after hydrate, so parking it there would deadlock the pipeline. It is a
precondition on ship, verified by a person, and it is not optional.

**Status: satisfied.** The author exercised the pad by hand against a live dev rig on a real tmux
server (a scratch server carrying `manual:1`, `manual:3`, `auto:2` and `blocked:2` rows plus three
deliberately unmarked rows), at desktop and mobile widths, and approved the interaction. Small
follow-up improvements were identified and are deferred to their own changes; none block this one.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Requirements are organised as three domains (pad / row gesture / wiring) rather than per-file | The intake's risk framing is behavioral — "does the gesture hold at every edge" — and a reviewer localising a failure wants the requirement, not the file. R7–R11 all land in one file and would otherwise collapse into a single untestable requirement | S:85 R:90 A:90 D:85 |
| 2 | Certain | The 160px/300px × first/last-row placement matrix is four explicit acceptance cases (A-025), not one | The intake's trap 1 names all four; #767's own test file already fans them out, and collapsing them is how an edge-only clamp bug survives | S:90 R:85 A:90 D:90 |
| 3 | Certain | A-039 states the comment-hygiene rule as scoped to the diff, with an explicit "untouched files MUST NOT be flagged" clause | Post-mortem rule 1: the unscoped form cost five of #767's ten review cycles. The clause exists to stop a reviewer re-deriving the repo-wide reading | S:95 R:90 A:95 D:95 |
| 4 | Certain | The provenance sweep is task T030 in the plan, executed by the apply worker before it reports | Post-mortem rule 2: workers mirror plan IDs into comments by habit, and finding them at review costs a whole cycle | S:95 R:90 A:95 D:95 |
| 5 | Confident | Manual verification is an acceptance item (A-043) rather than only a prose gate | The plan makes it a ship gate and the intake calls it non-optional; an unchecked acceptance row is the only mechanism in this pipeline that makes a human step visible to review. It is deliberately the last item and names why it exists | S:75 R:80 A:80 D:70 |
| 6 | Confident | `sidebar/index.tsx` threading is described as "every site `onForkWindow` uses" rather than enumerated line numbers | Line numbers drift the moment T001 edits the same file; `onForkWindow` is an exact, greppable anchor that survives the edit | S:70 R:90 A:85 D:80 |
| 7 | Confident | The two Deprecated Requirements entries are recorded so hydrate can retire phase 2's display-only claims from memory | `run-kit/ui/sidebar.md` and `ui/status-signals.md` currently record the strip as display-only — the exact statement this change falsifies. Without the entry hydrate has no signal to correct it | S:70 R:75 A:85 D:80 |
| 8 | Confident | T027 extends the existing `window-marker-gutter.spec.ts` rather than adding a new spec file | It owns the `_tmux` helper and the marker fixtures, the gates name it by title, and a second marker spec would double the e2e serialisation cost the runner already imposes | S:70 R:85 A:85 D:80 |

8 assumptions (4 certain, 4 confident, 0 tentative).
