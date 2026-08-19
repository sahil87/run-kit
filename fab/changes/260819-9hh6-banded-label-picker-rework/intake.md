# Intake: Banded Label Picker Rework

**Change**: 260819-9hh6-banded-label-picker-rework
**Created**: 2026-08-19

## Origin

Synthesized from an interactive design session with the user (promptless dispatch — no questions asked at intake; every decision below was made explicitly by the user during the session). The full decision trail — live mocks for every approach, the tried-and-rejected gallery, and the iteration sequence (B → B-H → ∅-in-headers → in-progress remap) — is recorded in the interactive design study committed alongside this intake:

- **[`assets/picker-layout-studies.html`](assets/picker-layout-studies.html)** — treat its `DECIDED:` items as user decisions (they are restated in full below). The page's live cells embed the real post-#659 flair CSS.

> Change: Label picker B-H rework — banded three-axis picker with composite preview, marker vocabulary growth, and the marker/flair motion split.
>
> Context: the combined "Label" picker (swatch-popover.tsx) sets three independent per-row axes — color (10 hue families × 2 shades), marker (left-edge stripe), flair (animated row overlay; 10 states since PR #659 merged, which is already in this branch's base). The current skeleton (marker column · hairline · color grid · flair rows) stopped scaling and names none of its axes.

## Why

1. **The pain point**: the Label picker's shipped skeleton (vertical marker column · hairline · 5×4 color grid · flair rows underneath) was designed around 4 flairs. PR #659 grew the flair catalogue to 10 states, so the flair section now outgrows the color grid and reads as an unlabeled second color grid — the three axes were learnable at 6+20+4 cells and are not at 6+20+11. Nothing in the panel names any axis; discoverability rests entirely on hover tips.

2. **The consequence of not fixing it**: every future vocabulary growth (markers and flairs are both growing in this change: 5→8 markers, 10→12 flairs) makes the unlabeled wall worse. The keyboard grid keeps accreting special-case clamps around the marker-column geometry (the `GRID_ROWS === MARKER_CELLS.length` 1:1 pairing invariant), and users cannot tell which axis a cell belongs to or what the current combo is.

3. **Why this approach**: an interactive design study (assets/picker-layout-studies.html) explored four layouts plus iterations. The user chose **B-H** — horizontal bands under a live composite preview — because it names the axes with the band headers themselves, keeps panel height constant regardless of any axis's future growth, scrolls each band only in the direction that axis actually grows, and stays ~190px wide (inside the sidebar-flyout and coarse-pointer rail-card width budgets). Rejected alternatives are recorded in **Rejected Alternatives** below.

Two companion semantic cleanups ride the layout rework because the same files change:

- **Motion split** — "markers mean something and hold still; flairs mean nothing and move." Markers predate flairs, so motion was the only spice available when they were designed; now it blurs the axis boundary. The dashed marker's always-on data rain and double's selection-gated scanline crawl are motion, so they migrate to the flair axis (as `rain` and `scan`).
- **In-progress remap** — five *weights* of one stripe device encode *phases*: an ordinal form for categorical meaning (the eye ranks dotted < thick but can't recall "dashed = working" without a legend). New markers therefore add pattern *classes*, and the state the user cares most about — in-progress — gets the strongest iconic form (`hatch`, with the hazard-wedge texture, which culturally means "work zone" and was backwards on completed).

## What Changes

### 1. Naming — panel stays `Label`, axes named in-panel

- The panel keeps the incumbent name **Label**: the palette action `Window: Label` and the `aria-label="Label picker"` stay as-is (zero rename churn across palette, aria, tests, wiki, memory).
- The three axes are named **in-panel** as `color` · `marker` · `flair` via micro band headers in the existing terminal idiom (green-bracket micro-labels, the `SectionHeading`/`[ label ]` style) — exactly the identifiers the code, backend validators, and tmux options (`@rk_color` family / `@rk_marker` / `@rk_flair`) already use.
- (`Look` was evaluated as an honest umbrella and remains the recorded fallback only if flair ever joins the label contract; not part of this change.)

### 2. Layout "B-H" — vertical stack of horizontal bands (swatch-popover.tsx)

Panel width ~190px, constant height. Top to bottom:

- **Composite preview row** (full width): the row's actual resting look — color tint + marker stripe + static paired texture + flair overlay + a sample row name — with the ✕ close button beside it and a small combo caption underneath (e.g. `teal · hatch · scan`; `∅` for unset axes, flair listed last/lightest).
- **Three bands**, each a header row `[ axis ]` with a right-aligned **∅ clear cell in the header** (moved out of the strips — saves a column per band; a ring on the header ∅ indicates "axis unset" — a new pattern this change specs).
  - **color band**: 2 rows (normal shade over dark shade, pairing preserved) × 10 family columns, column-flow, inside a **horizontal-scroll strip** (thin scrollbar + right-edge fade + the cut-off partial column as scroll affordance). At 190px ~8 of 10 families are visible. Color may **only ever scroll horizontally** — vertical would break the shade pairing / family-column identity.
  - **marker band**: single row of 8 static marker cells; fits without scrolling once ∅ moved to the header (8 × 21px ≈ 165px). Marker budget stays ≤ what fits unscrolled (~9 cells) — semantic states must never hide behind a scroll.
  - **flair band**: 2-row column-flow horizontal strip; post-#659 contents = `rain` + `scan` + the 10 shipped flairs = **12 cells** (fits 190px without scroll — no scroll mechanics needed now).
- **Behavior retained**: selection never dismisses the picker (existing rule — combo iteration is the point); Escape / outside-click / ✕ close it. The existing `previewOverride` immediate-repaint mechanism and the `familyToLegacy` write seam are retained.
- **Caller variants**: server rows get **no flair band** (server identity stays flair-free); pure-color callers render preview + color band only.
- **Keyboard**: bands are plain grids; the header ∅ acts as **row 0 of its band** (ArrowUp from a strip's first row lands on its header ∅); arrow moves call `scrollIntoView({block:"nearest", inline:"nearest"})` so the scroll strip is invisible to the grid model. The old `GRID_ROWS === MARKER_CELLS.length` 1:1 pairing invariant (swatch-popover.tsx:69–75) **and its test die** with the marker column.

### 3. Marker axis grows 5 → 8 — all STATIC, categorical growth rule

New states are new pattern **classes**, never a new weight between existing ones:

| State | New? | Pattern | Suggested semantic (label convention only) |
|-------|------|---------|--------------------------------------------|
| `pipe` | **new** | 1px hairline | parked / can-delete |
| `dotted` | existing | dotted stripe | draft / discussion-pending |
| `dashed` | existing | dashed stripe (now still — rain removed) | (generic mid-weight label) |
| `solid` | existing | solid stripe | active |
| `double` | existing | twin stripe (scanlines released to flair) | review / needs-me |
| `thick` | existing | thick stripe, now QUIET — no texture | completed |
| `hatch` | **new** | 45° diagonals + hazard-wedge static texture | **IN-PROGRESS** |
| `block` | **new** | heavy block dashes — 9px-on/3px-off on a 12px tile, 6px wide | archived / frozen |

- All stripe periods must divide the **12px weld module** so stacked rows merge (hatch's diagonal needs tuning to satisfy this).
- The **hazard-wedge static texture migrates from `thick` to `hatch`** (hazard stripes culturally mean "work zone", not "done"); `thick` = completed goes clean and quiet — the most resting state gets the quietest treatment. Net: markers carry exactly **ONE** texture pairing (hatch ↔ hazard wedge).
- Suggested semantics are **label conventions only** — NO wiring to `@rk_agent_state` or the status pyramid; agent lifecycle already belongs to the derived status dot per Constitution X. Marker names (pattern names) surface in tooltips + the combo caption; semantics stay in the study page and memory docs.
- Frontend: `MARKER_STATES` in `app/frontend/src/themes.ts:460` grows; `markerStripeStyle` (themes.ts:497) gains the new cases.
- Backend: `markerTokens` in `app/backend/internal/validate/validate.go:203` grows to the same 8-state closed set (+ tests / error copy).

### 4. Motion split — rain + scan become flairs; markers hold still

Rule: **markers mean something and hold still; flairs mean nothing and move.**

- The always-on **data rain** moves OFF the dashed marker (`.rk-dash-rain` in globals.css:499–539) and becomes a new **`rain` flair** — same CSS, now user-composable with ANY marker (users who liked working=rain set dashed + rain).
- The **scanlines + selection-gated crawl + refresh band** become a new **`scan` flair**, ALWAYS-ON (as a flair, selection gating dissolves by definition); the selection-gated crawl CSS (`.rk-scanlines-crawl` etc., globals.css:420–432 + reduced-motion rules) is **removed**. `double` keeps a plain twin stripe.
- Marker cells and the preview's marker rendering are **fully static**; flair cells keep motion (motion IS flair identity). The composite preview row carries the live combo's motion.
- Frontend: `FLAIR_STATES` (themes.ts:472) grows by `rain` + `scan` → 12 states; new flair classes in globals.css; flair-overlay.tsx — the cube/warp child-markup contract means the picker preview must reuse or mirror flair-overlay's rendering.
- Backend: `flairTokens` (validate.go:205) grows by `rain` + `scan` → 12 (+ tests).
- **Zero data migration**: stored `@rk_marker`/`@rk_flair` values unchanged in name and meaning; `dashed` rows simply go still (visual change, no data change); new values are additive.

### 5. Design study publication

- Commit the study page as `docs/wiki/picker-layout-studies.html` (source: this change's `assets/picker-layout-studies.html`).
- Add a Wiki-table entry in `docs/specs/index.md` (precedent rows: `label-picker-design-studies.html`, `status-rail-design-studies.html`).

### Rejected Alternatives (recorded from the design session)

- **Approach A** — axis micro-labels on the old skeleton: cheapest, but labels name the mass without organizing it; the flair wall and keyboard clamps survive.
- **Approach C** — segmented tabs (one axis at a time): hides two axes at all times; combo iteration (the reason selection never dismisses) would cost a tab-switch per axis.
- **Approach D** — three side-by-side labeled columns: ~300px wide — too wide for the sidebar flyout seam and coarse-pointer rail cards; flair growth leaves dead space under marker.
- **B-V** — vertical flair cap variant of B (parked, not rejected outright): the user chose B-H's height constancy + swipe story over B-V's wrap-grid reading order.

### Known Tradeoffs (accepted by the user)

- Horizontal wheel scroll is second-class on fine pointers (needs shift/trackpad); the cut-off partial column + right-edge fade carry the affordance.
- `double` without scanlines is `solid`'s twin at a squint — may deserve its own pattern class later (explicitly parked).
- ∅ in the header means more mouse travel for the clear-one-axis flow.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) row-texture pairing table (hazard moves thick→hatch, thick quiet, double untextured), marker vocabulary 5→8 with the categorical growth rule, the motion-split rule (markers static / flairs move), new `rain`/`scan` flair classes, crawl removal, reduced-motion notes
- `run-kit/ui/sidebar`: (modify) row flair overlays (12-state catalogue incl. rain/scan), picker anatomy references in row rows/rail cards
- `run-kit/ui/status-signals`: (modify) Label-picker anatomy behind the row flyout card ("Change color…" rows) — the banded B-H layout, band headers, header-∅, composite preview
- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry — `@rk_marker` / `@rk_flair` accepted-value sets grow (names unchanged, values additive)

## Impact

- `app/frontend/src/components/swatch-popover.tsx` (+ `.test.tsx`) — full layout rework: bands + headers + header-∅ + composite preview + horizontal color scroll strip + plain-grid keyboard model. Note: PR #659 already reworked this file for 10 flairs — that is the base. The `GRID_ROWS === MARKER_CELLS` invariant and its unit test are removed.
- `app/frontend/src/components/flair-overlay.tsx` — cube/warp child-markup contract; the picker's composite preview must reuse or mirror it; `rain`/`scan` added to the overlay path.
- `app/frontend/src/themes.ts` (+ `themes.test.ts`) — `MARKER_STATES` (+3), `FLAIR_STATES` (+2), `markerStripeStyle` new cases (pipe/hatch/block), hatch↔hazard pairing seam.
- `app/frontend/src/globals.css` — new flair classes (rain, scan — lifted from `.rk-dash-rain` / `.rk-scanlines[-crawl]`), crawl removal, hazard pairing move (`.rk-hazard` trigger thick→hatch), new marker stripe patterns on the 12px weld module, reduced-motion rules updated.
- `app/backend/internal/validate/validate.go` (+ `validate_test.go`) — `markerTokens` 5→8, `flairTokens` 10→12, error copy.
- Call sites as needed: `app/frontend/src/components/sidebar/window-row.tsx`, `sidebar/session-row.tsx`, `sidebar/row-flyout-card.tsx` (marker/texture rendering + picker embedding).
- E2E: `app/frontend/tests/e2e/window-marker-gutter.spec.ts` (+ its `.spec.md`) asserts marker/rain/hazard behavior and picker chrome — rework; any other spec asserting picker chrome (`row-flyout.spec.ts`, `mobile-layout.spec.ts` reference the picker) updated with `.spec.md` companions per constitution.
- Docs: `docs/wiki/picker-layout-studies.html` (new), `docs/specs/index.md` Wiki table (new row).
- tmux user options `@rk_marker`/`@rk_flair` unchanged in name; values additive. No API shape changes; POST-only mutation surface unchanged.

## Open Questions

- (none — all design decisions were made by the user in the design session; implementation-level choices are graded below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Panel keeps the name `Label` (palette action `Window: Label`, aria-label "Label picker" unchanged); axes named in-panel as `color` · `marker` · `flair` via green-bracket micro band headers | Discussed — user decided; recorded DECIDED in the design study's naming section | S:95 R:85 A:95 D:95 |
| 2 | Certain | Layout = B-H: horizontal bands under a full-width live composite preview row (tint + stripe + texture + flair + name, ✕ beside it, combo caption under it), ~190px wide, constant height | Discussed — user chose B-H over A/C/D/B-V; DECIDED in the study | S:95 R:70 A:90 D:95 |
| 3 | Certain | ∅ clear cell moves into each band's header (right-aligned); ring on the header ∅ = "axis unset"; header ∅ is keyboard row 0 of its band | Discussed — user decided (study iteration 4) | S:90 R:85 A:90 D:90 |
| 4 | Certain | Color band = 2 shade rows × 10 family columns, column-flow, horizontal-scroll strip (thin scrollbar + edge fade + cut-off column affordance); color only ever scrolls horizontally | Discussed — user decided; vertical scroll would break shade pairing / family-column identity | S:95 R:80 A:95 D:95 |
| 5 | Certain | Marker axis grows 5→8, all static: `pipe` (1px hairline), `hatch` (45° diagonals), `block` (9px-on/3px-off on 12px tile, 6px wide); categorical growth rule (new pattern classes, never a new weight); budget ≤ unscrolled (~9 cells) | Discussed — user decided, with exact geometry values from the session | S:95 R:75 A:90 D:95 |
| 6 | Certain | In-progress remap: hazard-wedge texture migrates thick→hatch (hatch = in-progress); thick = completed goes quiet (no texture); dashed demotes to generic; double = review/needs-me, plain twin stripe; markers carry exactly one texture pairing | Discussed — user decided (study iteration 4) | S:95 R:75 A:90 D:95 |
| 7 | Certain | Motion split: always-on data rain moves off dashed into a new `rain` flair; scanlines + crawl + refresh band become a new always-on `scan` flair; `.rk-scanlines-crawl` selection-gated CSS removed; marker cells + preview marker rendering fully static | Discussed — user decided; "markers mean something and hold still; flairs mean nothing and move" | S:95 R:70 A:90 D:95 |
| 8 | Certain | Backend closed sets grow: `markerTokens` +pipe/hatch/block, `flairTokens` +rain/scan (=12); zero data migration — stored values unchanged, new values additive, option names unchanged | Discussed — user decided; verified against validate.go:203–205 | S:95 R:85 A:95 D:95 |
| 9 | Certain | Server rows get no flair band; pure-color callers render preview + color band only; selection never dismisses; Escape/outside-click/✕ close; `previewOverride` + `familyToLegacy` seams retained | Discussed — user decided; retains existing picker contract | S:90 R:85 A:95 D:90 |
| 10 | Certain | The `GRID_ROWS === MARKER_CELLS.length` 1:1 pairing invariant and its unit test are removed with the marker column; bands become plain keyboard grids with `scrollIntoView({block:"nearest", inline:"nearest"})` on arrow moves | Discussed — user decided; invariant verified at swatch-popover.tsx:69–75 | S:90 R:80 A:95 D:90 |
| 11 | Certain | Design study committed as `docs/wiki/picker-layout-studies.html` + Wiki-table row in `docs/specs/index.md`; the session copy also lives at `assets/picker-layout-studies.html` in this change folder | Discussed — user decided; precedent rows exist in the Wiki table | S:95 R:95 A:95 D:95 |
| 12 | Certain | Suggested marker semantics are label conventions only — no wiring to `@rk_agent_state` or the status pyramid | Discussed — user decided; Constitution X (derivation wins for agent lifecycle) | S:95 R:85 A:95 D:95 |
| 13 | Confident | Tooltips and the combo caption surface marker *pattern names* (`hatch`, `pipe`, …), never the suggested semantic strings; semantics live only in the study page and memory docs | Study hint says "marker names surface in tooltips + the combo caption · conventions stay label-only"; semantic strings in UI would contradict no-wiring | S:60 R:85 A:75 D:65 |
| 14 | Confident | Hatch's exact diagonal geometry is tuned during apply so its period divides the 12px weld module (stacked rows merge); precise angle/period is an implementation detail | User flagged the constraint and delegated the tuning; visually verifiable against the existing weld discipline | S:55 R:85 A:80 D:70 |
| 15 | Confident | Session-row and other callers keep their existing axis composition via the picker's existing per-caller props (marker/flair visibility per caller unchanged except where decided in #9) | Codebase answers this — `showMarkers`/`showFlair`-style props already gate bands per caller | S:55 R:80 A:85 D:70 |
| 16 | Confident | The ~190px B-H panel is reused as-is inside the coarse-pointer rail cards and the row flyout card (no separate coarse presentation) | Approach D was rejected specifically for the rail-card width budget, implying B-H at ~190px fits it | S:50 R:75 A:70 D:65 |
| 17 | Confident | Composite preview shows the target row's actual name when the picker is opened for a row, with a neutral sample name for callers without one; combo caption names the color by family only (e.g. `teal`, shade legible from the preview itself) | Study shows "sample row name" + captions like `teal · hatch · scan`; low-stakes copy, easily adjusted | S:45 R:90 A:75 D:60 |
| 18 | Confident | E2E scope: rework `window-marker-gutter.spec.ts` (+ `.spec.md`) and update picker-chrome assertions in affected specs (`row-flyout`, `mobile-layout`) with `.spec.md` companions in the same commits | Constitution Test Companion Docs rule + verified spec files referencing the picker | S:55 R:80 A:85 D:70 |
| 19 | Confident | Reduced-motion discipline unchanged: new `rain`/`scan` flairs zero their animation under `prefers-reduced-motion` per the existing globals.css gates; hatch/hazard is static in every state by design | Existing globals.css reduced-motion block already covers rain/scanlines/hazard patterns being moved | S:60 R:85 A:85 D:75 |

19 assumptions (12 certain, 7 confident, 0 tentative, 0 unresolved).
