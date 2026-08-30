# Intake: Marker track and pad refinements

**Change**: 260830-hbsr-marker-track-and-pad-refinements
**Created**: 2026-08-30

## Origin

Follow-up polish on the marker surface, raised by the author immediately after exercising the
spring-loaded pad by hand and merging phase 3 (PR #772, merge commit `caa647b6`). The author's raw
input:

> Small improvements:
> 1) The "track + edge" should be shown on all rows - not just the rows with markers
> 2) With width of this track on mobile is too less. It doesn't look like a square - its more a
>    rectangle. (screenshot attached)
> 3) The design of the marker popup - the top left should say "what" it is - Marker. The columns can
>    have numbers as headings. The job that the top left area is doing right now (show which combo is
>    selected) can be done by highlighting the color of the label of that row and column instead.

**Interaction mode**: conversational. Two design questions were put to the author before this intake
was written, because each item overrides a decision already recorded as canonical. Both were
answered:

- **Item 1 — how heavy is the empty track?** → **Full wash + edge on every row.** The 12% ink wash
  and the 1px 30% right edge render on unmarked rows exactly as on marked ones. (The lighter
  alternative — edge only when empty, wash reserved for marked rows — was offered and rejected.)
- **Item 2 — what happens to the stage fill widths on coarse?** → **Coarse well becomes 36px and the
  fills scale to 12/24/36.** The fine pointer class is unchanged (22px well, 7/15/22 fills). Content
  start moves `30px → 44px` **on coarse only**. (Keeping 7/15/22 inside a 36px well, and shrinking
  the coarse row height to ~26px instead, were both offered and rejected.)

Item 3 was specified concretely enough not to need a question; the one detail it leaves open is
recorded as an assumption below.

**Screenshot**: `.uploads/260830231149-IMG_3255.jpeg` — the pad open on a coarse-width sidebar. It
shows the symptom for item 2 (the row wells at the left edge read as tall rectangles, not squares)
and the current pad header (`auto · mid` in the top-left) that item 3 replaces.

## Why

**The problem.**

1. **The gutter only exists where a marker does.** The well is gated on `parseMarker(marker) !== null`
   (`window-row.tsx`, the `{displayMarker && (` block), so unmarked rows render nothing at the left
   edge. The 22px press/tap target is therefore invisible on exactly the rows where a user most wants
   it — the ones with no marker yet. There is no affordance saying "a marker goes here".
2. **The coarse track is not square.** A coarse row is `min-h-[36px]` and the well is 22px wide, so
   the marker reads as a 22 × 36 rectangle. The design intent (and every study mock) is a square
   swatch; at stage 3 the fill is the full well, which makes the mismatch most obvious precisely
   where the marker is most saturated.
3. **The pad's top-left says the wrong thing.** It currently renders `<mode> · <gloss>` (e.g.
   `auto · mid`) — the *value*, in the one place a reader expects the *name of the surface*. The pad
   opens with no label telling you what it is, and the stage columns are unlabelled, so the ordinal
   axis has to be inferred from fill width.

**The consequence of not doing it.** Item 1 is a discoverability bug: phase 3 shipped a write path
that a user cannot see. Item 2 is the kind of geometry drift that becomes permanent once screenshots
and muscle memory accumulate around it. Item 3 costs a reader one extra inference on every open, and
wastes the pad's most valuable line on information the highlight ring already conveys.

**Why now, and why one change.** All three are small, purely presentational, and land in the same
three files. None touches storage, validation, the gesture model, the write seam, or the palette.
The change answers one question — *does the marker surface read correctly at both pointer classes?* —
which is what makes it reviewable in one pass.

**Why these override the design authority, deliberately.** `docs/wiki/marker-3x3-studies.html` is the
canonical study for this design and it fixes two things this change reverses: the T4 well is
specified as *"drawn only on rows that carry a marker"*, and stage widths are fixed at *7 / 15 / 22*.
Phase 2 hydrated both into memory. The author has overridden both with the answers above. **Updating
the study and the memory is therefore in scope** — if the change ships without them, the next agent
reads the study, finds the implementation diverging from the stated canon, and "fixes" it back.

## What Changes

### 1. `app/frontend/src/components/sidebar/window-row.tsx` — the always-on track

The well's render gate moves **inward**: the well container (wash + right edge) becomes
unconditional; only the *fill* stays gated on a parsed marker.

```tsx
// before: {displayMarker && ( <div data-testid="marker-well" …> …fill… </div> )}
// after:  <div data-testid="marker-well" …>{displayMarker && ( …fill… )}</div>
```

Consequences to carry through:

- `data-testid="marker-well"` now exists on **every** row. Tests that assert its absence on an
  unmarked row must move to asserting the absence of the **fill** instead (a new
  `data-testid="marker-fill"` on the fill span is the cheapest way to keep those assertions
  meaningful — see Assumptions).
- The well stays `aria-hidden` and `pointer-events-none`; the strip overlay above it keeps owning
  interaction. The well must not become focusable or announce itself.
- The `.rk-hazard` wedge stays gated on `displayMarker?.mode === "blocked"` — an unmarked row gets
  the track, never the hazard.

### 2. `window-row.tsx` + `src/marker.tsx` — coarse geometry

The marker geometry becomes **pointer-class-dependent**. Fine is unchanged; coarse scales by 36/22.

| Constant | Fine | Coarse |
|---|---|---|
| Well / strip width | 22px | **36px** |
| Stage fill widths | 7 / 15 / 22 | **12 / 24 / 36** |
| Row content start | `pl-[30px]` | **`coarse:pl-[44px]`** (was `pl-[30px]`) |

- `MARKER_STAGE_WIDTHS` gains a coarse counterpart in `src/marker.tsx`
  (`MARKER_STAGE_WIDTHS_COARSE = { 1: 12, 2: 24, 3: 36 }`), and `markerFillStyle` takes the width
  table (or a pointer-class flag) rather than closing over the fine one. Both the row well and the
  **pad cells** consume it — pad cells stay on the fine table, since the pad's own cell size is
  driven by `markerPadPopoverLayout`, not by the row.
- `MARKER_WELL_WIDTH = 22` in `window-row.tsx` becomes a fine/coarse pair. It has three consumers
  that must all follow the pointer class: the well's `width`, the strip overlay's `w-[22px]`, and
  the pad's `anchorLeft` argument to `placeMarkerPad`.
- The 8px gap between the well's right edge and the content is preserved on both classes (22+8=30,
  36+8=44). That gap is load-bearing: it holds the status dot's 3px waiting halo clear of the well.
- **Chevrons** (`auto`) are drawn from `MARKER_CHEVRON_WIDTH/HEIGHT/PITCH/STROKE` (4.2 / 10 / 7.2 /
  1.8) sized for a 22px well. In a 36px well they must scale by the same 36/22 factor so `auto:3`
  reads as a full-width glyph row rather than a small mark floating in a wide box.

### 3. `app/frontend/src/components/sidebar/marker-pad.tsx` — header and labels

Replace the value-echo header line with a titled, labelled grid.

- **Top-left cell reads `Marker`** — the surface's name, in the label track's header position.
- **Column headings**: the three stage columns are headed `1` `2` `3`; the ∅ column is headed `∅`
  (or left blank — see Assumptions).
- **Selection is shown by highlighting the labels**, not by a text line: when a cell is highlighted,
  its **mode row label** and its **stage column heading** both take the marker ink
  (`var(--color-marker-ink)`); every other label stays `text-text-secondary`. On the ∅ cell, the ∅
  heading highlights and no mode label does.
- The `<mode> · <gloss>` header line and its `data-testid="marker-pad-header"` are **removed**. The
  `padHeader()` helper loses its only consumer and is deleted with its unit test.
- The per-cell `ring-1 ring-text-primary` highlight **stays** — the label highlight is additive, not
  a replacement.
- `MARKER_STAGE_GLOSS` (`early` / `mid` / `done`) loses its only render consumer. Keep the export
  (it is the vocabulary's gloss and belongs with the model), but do not leave it unused without a
  consumer — surface it as the column headings' `title`/`aria-label` so the gloss stays reachable.

Layout note: the pad grows one heading row taller. `markerPadPopoverLayout`'s **width** math is
untouched (`NON_TRACK_PX` is a width constant); placement already measures `anchor.offsetHeight`, so
the vertical clamp adapts on its own. The 160px fit (152 / 22 / 42) is unchanged.

### 4. Design authority + memory (in scope, not optional)

- **`docs/wiki/marker-3x3-studies.html`** — the T4 section asserts the well is *"drawn only on rows
  that carry a marker"* and the settled-values line fixes stage widths at *7 / 15 / 22*. Both are now
  false. Update those claims in place to the shipped behavior (always-on track; 7/15/22 fine and
  12/24/36 coarse). Keep the *rationale* prose that explains why the alternatives were considered —
  this page is a study, and the exploration record stays useful; only the stated conclusion moves.
- **`docs/memory/run-kit/ui/sidebar.md`** — two statements are stale: the row-anatomy line ("the 22px
  marker well occupies the left edge and content begins at 30px") and the full-bleed-row line ("The
  22px marker well occupies `left-0`; content uses `pl-[30px]` on both pointer classes").
- **`docs/memory/run-kit/ui/visual-design.md`** — "renders all nine pairs in the 22px marker well …
  Stage widths are 7/15/22px" needs the pointer-class split, and the marker section should record
  that the track is drawn on every row with the fill gated on a parsed marker.
- **`docs/memory/run-kit/ui/dialogs-and-state.md`** — the marker-pad entry describes the header line;
  it becomes the titled/labelled grid.

### Explicitly out of scope

- **No change to the gesture model** — press/drag/release, the wheel listener, the single-open
  registry, capture-phase dismissal, Escape-reverts, and the `marker-pad:open` palette path are all
  untouched. This change is presentational.
- **No backend change.** `app/backend/` must not appear in `git diff --stat`.
- **No change to the stored vocabulary** — `parseMarker` / `formatMarker` / the twelve tokens /
  `NormalizeMarker` are final from phases 1–2.
- **No Marker section in the row hover card**, still. `row-flyout-card.tsx` stays untouched.
- **No new route, settings key, or `RK_*` env var.**

### Known traps

1. **The always-on well breaks existing absence assertions.** `window-marker-gutter.spec.ts` asserts
   an unmarked row "renders nothing in the strip", and `window-row.test.tsx` has matching unit
   coverage. These are correct today and wrong tomorrow — rewrite them to assert *the track is
   present and the fill is absent*, and update the `Proves:` / `Steps:` JSDoc in the same edit
   (constitution § Test Intent Comments).
2. **`row-flyout.spec.ts` measures the well and the 30px content offset on both pointer classes.**
   The two left-zone tests (fine and coarse) assert `width ≈ 22` and `content.x - row.x ≈ 30`. The
   coarse one must become 36 / 44; the fine one stays 22 / 30. Getting this wrong passes locally on
   one pointer class and fails the other.
3. **`MARKER_WELL_WIDTH` has three consumers** — the well, the strip overlay, and the pad's
   `anchorLeft`. Missing the third leaves the pad anchored 14px inside the coarse well.
4. **Chevron geometry is not covered by the stage-width table** — scaling `MARKER_STAGE_WIDTHS` alone
   leaves `auto` markers visually undersized in the wider coarse well.
5. **Deleting `padHeader` must take its test with it**, and `MARKER_STAGE_GLOSS` must not be left as
   an unreferenced export (see § 3 for its new consumer).
6. **Comment-hygiene acceptance is scoped to the diff** — *"no plan/change IDs (`R#` / `T###` /
   `A-###`) or removed-feature narration in comments **this change adds or modifies**"*, never as a
   repo-wide rule. This repo's own convention is to cite change ids in older comments; an unscoped
   rule made review re-litigate untouched files for five cycles on PR #767.
7. **The provenance sweep runs in the apply prompt**, before the worker reports:
   `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files incl. tests>`
8. **The wiki study is HTML.** Edit the claim text, not the surrounding markup or the live demo
   scripts; a careless rewrite breaks a self-contained page nobody re-opens until it matters.

### Acceptance

- Every window row renders the 22px (fine) / 36px (coarse) track with the 12% wash and 30% right
  edge, marked or not; only a row with a parsed marker renders a fill or chevrons.
- An unmarked row renders no hazard wedge and no fill.
- On a coarse pointer the track is 36px wide, `manual:3` fills it exactly, `auto:3` draws chevrons
  scaled to it, and row content starts at 44px.
- On a fine pointer the track is 22px, fills are 7/15/22, and content starts at 30px — unchanged.
- The pad's top-left reads `Marker`; the stage columns are headed `1` `2` `3`.
- Highlighting a cell tints that cell's mode-row label and stage-column heading in the marker ink;
  no `<mode> · <gloss>` line is rendered anywhere.
- The pad's box still stays inside the sidebar at 160px and 300px, first and last row.
- The gesture, wheel, single-open, Escape-revert and palette behaviors are byte-for-byte unchanged in
  behavior (their tests pass untouched except where geometry constants appear).
- `docs/wiki/marker-3x3-studies.html` and the three memory files no longer assert marked-rows-only or
  a universal 7/15/22.

### Gates

Full set, **one e2e invocation at a time** (the runner kills any listener on the e2e port
machine-wide; a second run during the first's teardown fails with a real-looking `ECONNREFUSED`):

```
cd app/backend && go test ./...
cd app/frontend && npx tsc --noEmit
just test-frontend
just test-e2e "window-marker-gutter"
just test-e2e "row-flyout"
just build
```

A hand check at mobile width is worth one minute given item 2 is a geometry change judged by eye,
but it is **not** a blocking ship gate this time: the gesture model — the thing #767's defects lived
in — is untouched here.

### Size estimate

3 source files, 1 wiki page, 3 memory files, plus their tests. Roughly +180 / −90.

## Affected Memory

- `run-kit/ui/sidebar.md`: (modify) § row anatomy and § full-bleed row box — the marker track renders
  on every row (fill gated on a parsed marker); well width and content start become pointer-class
  dependent (22/30 fine, 36/44 coarse), with the 8px status-dot-halo gap preserved on both.
- `run-kit/ui/visual-design.md`: (modify) the marker section — stage fill widths are 7/15/22 fine and
  12/24/36 coarse, chevron geometry scales with the well, and the 12% wash + 30% edge is the track
  chrome on every row rather than a marked-row-only treatment.
- `run-kit/ui/dialogs-and-state.md`: (modify) the marker-pad entry — the value-echo header line is
  replaced by a `Marker` title, numbered stage column headings, and selection expressed by tinting
  the active row label and column heading in the marker ink (the per-cell ring is retained).

## Impact

**Frontend** (`app/frontend`): `src/marker.tsx` (coarse stage-width table, chevron scaling,
`markerFillStyle` signature), `src/components/sidebar/window-row.tsx` (well gate, pointer-class
geometry, content padding, strip width, pad anchor),
`src/components/sidebar/marker-pad.tsx` (header → title + column headings + label highlight,
`padHeader` removed). Tests: `src/marker.test.ts`, `src/components/sidebar/marker-pad.test.tsx`,
`src/components/sidebar/window-row.test.tsx`, `tests/e2e/window-marker-gutter.spec.ts`,
`tests/e2e/row-flyout.spec.ts`.

**Docs**: `docs/wiki/marker-3x3-studies.html` (T4 conclusion + settled-values line).

**No backend, no API contract change, no new route or settings key.** Constitution IV (minimal
surface) and V (keyboard-first — the palette path and the pad's keyboard model are untouched) are
unaffected.

## Open Questions

None. Both design questions raised by items 1 and 2 were put to the author and answered before this
intake was written; item 3's one loose detail (the ∅ column's heading) is recorded as an assumption
rather than a question because either reading is cheap to change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Unmarked rows render the full 12% wash **and** the 1px 30% edge, identical to marked rows | The author was shown both this and the lighter edge-only alternative with previews, and chose full wash + edge explicitly | S:95 R:85 A:95 D:95 |
| 2 | Certain | Coarse well is 36px with fills scaling to 12/24/36; fine stays 22px with 7/15/22; content start 44px coarse / 30px fine | Chosen explicitly by the author from three previewed options; the 8px halo gap is preserved on both classes by construction (22+8, 36+8) | S:95 R:80 A:95 D:95 |
| 3 | Certain | Updating `docs/wiki/marker-3x3-studies.html` and the three memory files is in scope, not a follow-up | Items 1 and 2 falsify claims the study states as canonical and phase 2 hydrated into memory; leaving them stale invites the next agent to revert the change as a drift fix | S:85 R:90 A:95 D:90 |
| 4 | Certain | The gesture model is untouched — this change is presentational only | Nothing in the author's three items concerns press/drag/wheel/keyboard behavior, and the gesture is the surface that produced six of #767's seven defects; keeping it out of the diff is what makes this change cheap to review | S:90 R:85 A:95 D:95 |
| 5 | Confident | A `data-testid="marker-fill"` is added to the fill span so absence assertions stay meaningful once the well is always present | The existing "unmarked row renders nothing in the strip" assertions key on `marker-well`, which will now always exist; without a fill testid those tests either delete real coverage or assert on style internals | S:70 R:85 A:85 D:80 |
| 6 | Confident | The ∅ column is headed `∅`, matching its cell glyph, rather than left blank | The heading row reads as a complete axis legend that way, and a blank cell above a glyph column looks like a rendering gap. Cheap to flip if the author prefers blank | S:55 R:95 A:70 D:60 |
| 7 | Confident | `MARKER_STAGE_GLOSS` is retained and re-consumed as the column headings' accessible label/title rather than deleted with the header line | It is the vocabulary's gloss and belongs with the model; the gloss is also the only place `early`/`mid`/`done` is expressed, and dropping it entirely would lose that meaning from the UI along with the header | S:65 R:85 A:80 D:70 |
| 8 | Confident | Chevron constants scale by the same 36/22 factor on coarse rather than being re-derived as new absolute values | Proportional scaling keeps `auto:N` reading identically across pointer classes with one factor and no second constant table; absolute re-derivation would need its own design pass the author has not asked for | S:60 R:80 A:80 D:70 |
| 9 | Confident | `markerFillStyle` takes the stage-width table (or a coarse flag) as an argument rather than reading a module-level mutable | It has two call sites with different needs — the row (pointer-class dependent) and the pad cells (always fine) — so the width table must be a parameter for both to be correct simultaneously | S:70 R:85 A:85 D:80 |
| 10 | Confident | The hand check at mobile width is recommended but not a blocking ship gate for this change | The gesture model — where #767's defects lived and what justified phase 3's blocking gate — is explicitly out of scope here; these are static geometry and label changes fully covered by unit and e2e assertions | S:65 R:75 A:80 D:70 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).
