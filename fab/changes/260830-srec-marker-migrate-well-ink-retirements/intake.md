# Intake: Marker rework phase 2 — migrate + contract: the well, the ink, the retirements

**Change**: 260830-srec-marker-migrate-well-ink-retirements
**Created**: 2026-08-30

## Origin

Pickup of a pre-written plan phase. The user invoked `/fab-new` with:

> Marker rework phase 2 -- migrate + contract: the well, the ink, the retirements. Full scope,
> known traps, acceptance criteria, and gates are written out in
> `fab/plans/sahil/26-08-30-marker-rework-split.md` under "Phase 2 -- Migrate + contract: the well,
> the ink, the retirements" -- read that section for the intake. One question this phase answers:
> does it look right, and did anything stale survive the removal? This flips the read path (wire
> NormalizeMarker into parseWindows/layout.go/snapshot restore), narrows markerTokens to the twelve
> new tokens, and does the whole visual rework (the T4 well, `--color-marker-ink`, deleting the
> interactive LabelZone, swatch-popover marker-band removal) in one change -- they are inseparable
> per the plan, and this is the part of #767 that produced zero defects. Explicitly out of scope: no
> pad, no strip press target, no wheel, no palette action, no card Marker row -- markers are
> display-only after this phase. Known traps: fixtures carrying legacy tokens will fail once the
> write path normalizes (`snapshot/restore_test.go`, `snapshot/reopen_test.go`,
> `snapshot/integration_test.go`) -- move each to current vocabulary, keep one dedicated legacy-value
> test; the removal sweep must include e2e specs, not just `src/`
> (`grep -rn "Set tab label\|LabelZone\|MARKER_STATES\|markerStripeStyle\|coarse:pl-4\|status-dot-tap" app/frontend`);
> touched e2e tests need Proves/Steps JSDoc updated in the same edit; do not rewrite comments outside
> the change's own lines. Copy source is PR #767 (`git fetch origin refs/pull/767/head:pr767`) but
> read the traps section before trusting the copy. Gates: full set -- `go test ./...`, `tsc`,
> `vitest`, `just test-e2e "window-marker-gutter"`, `just test-e2e "row-flyout"`, `just build` -- one
> e2e invocation at a time.

**Interaction mode**: one-shot. No SRAD questions were asked — the plan section, the four design
studies, and the #767 reference implementation between them settled every decision this phase makes.

**Design authority** (do not re-litigate): `docs/wiki/marker-3x3-studies.html` is canonical for the
grid, stage widths, chevron geometry, the T4 well, the ink pair, and the well→dot gap.
`docs/wiki/mode-axis-studies.html`, `docs/wiki/marker-axis-studies.html`, and
`docs/wiki/window-row-studies.html` cover the axis derivations and the row anatomy this change starts
from.

**Prerequisite state** (verified in this worktree, not assumed): phase 1 is merged —
`origin/main` is at `76d755a8 feat: Marker rework phase 1 — expand: accept the mode:stage vocabulary (#769)`
and this branch was fast-forwarded onto it. `app/frontend/src/marker.tsx` (parse/format half),
`tmux.NormalizeMarker` + `legacyMarkerValues`, and the union `markerTokens` are all present and
unwired. The prior change folder is
`fab/changes/260830-nip5-marker-expand-mode-stage-vocabulary/`.

**Reference implementation**: PR #767 (`git fetch origin refs/pull/767/head:pr767`, head
`790120eb`). It implements all three phases in one change and is **not to be merged** — it is the
parts bin. **Copy, then read**: every trap listed below was a real review finding or a manual-test
defect on that branch.

## Why

**The problem.** After phase 1 the repository holds two marker vocabularies and one renderer. The
backend accepts both the eight flat tokens (`pipe`/`dotted`/`dashed`/`solid`/`double`/`thick`/
`hatch`/`block`) and the twelve `mode:stage` tokens, but nothing normalizes on the read path, so the
frontend still receives whatever tmux holds and still draws it with the old
`themes.ts markerStripeStyle` stripe. The new `marker.tsx` module has tests as its only consumer —
the reviewer already flagged that on #767 cycle 1, and phase 1's intake named this phase as the
production consumer. Until that promise is kept, the expand half is dead weight.

**The consequence of not doing it.** The union vocabulary is a transitional state, not a resting
one: a validator that accepts twenty tokens for a nine-cell design is a standing invitation for new
writes in the retired vocabulary, and every day it stands the fixture surface that has to be migrated
grows. The agreed visual design (the T4 well, the fixed marker ink, the retired label zone) cannot
ship at all while the old stripe renderer owns the gutter, because the stripe and the well occupy the
same pixels.

**Why this shape.** Expand → **migrate + contract** → add-interaction. The read path flip and the
vocabulary narrowing and the visual rework are genuinely inseparable: narrowing `markerTokens` without
teaching the UI to draw `mode:stage` leaves marked rows blank, and drawing the well without
normalizing means legacy rows render nothing. Doing them together is what keeps every intermediate
state coherent — no running server ever holds a token its own validator rejects.

**Why this is the low-risk phase.** The post-mortem (`docs/findings/marker-rework-review-cycles.md`)
found six of #767's seven real defects in the spring-loaded pad (~30% of the diff). The migration and
the visual rework — everything in this change — produced **zero** defects across ten review cycles.
The risk here is not correctness of new interaction; it is **incomplete removal**. Hence the phase's
one question: *does it look right, and did anything stale survive the removal?*

**Why markers go display-only for a release.** Splitting the pad out is the whole point of the
re-execution. Between this change and phase 3 a marker is set with
`tmux set-option -w -t <window> @rk_win_marker manual:2`; the PR body must say so.

## What Changes

### Backend — flip the read path, then contract the set

**1. `app/backend/internal/tmux/tmux.go` — normalize in `parseWindows`.**
Today (`tmux.go:1256-1261`) the marker field is admitted only if it is already a member:

```go
if m := strings.TrimSpace(parts[19]); validate.MarkerValues[m] {
    marker = m
}
```

It becomes a `NormalizeMarker` call, so the frontend never sees a flat token. `NormalizeMarker`
already trims nothing — it takes the raw value — so keep the `strings.TrimSpace` and hand the trimmed
value in; anything outside both vocabularies still collapses to `""` (the existing unknown-token
idiom). The surrounding comment block, which enumerates the flat tokens, is one of this change's own
lines and must be rewritten to the `mode:stage` vocabulary.

**2. `app/backend/internal/tmux/layout.go` — normalize the snapshot reader's field 27.**
`layout.go:292` currently reads `win.Marker = strings.TrimSpace(parts[26])` with no membership check
at all. Wrap it in `tmux.NormalizeMarker` (same-package, so bare `NormalizeMarker`). Consequence
worth stating: a snapshot captured after this change stores the **normalized** value, so newly
written snapshots carry `manual:1`, not `solid`.

**3. `app/backend/internal/snapshot/restore.go` — normalize on the write path.**
`restore.go:364` is `add(tmux.MarkerOption, win.Marker)`. It becomes:

```go
add(tmux.MarkerOption, tmux.NormalizeMarker(win.Marker))
```

This is load-bearing: an **old snapshot on disk** holds flat tokens, and after step 4 the validator
rejects them. Without normalization here a restore would write a value the API would refuse — state
the running server cannot describe. The reopen engine shares this option-write path.

**4. `app/backend/internal/validate/validate.go` — narrow `markerTokens` to the twelve.**
`markerTokens` (currently the phase-1 union at `validate.go:206`) drops the eight flat tokens and
keeps exactly `manual`, `manual:1`, `manual:2`, `manual:3`, `auto`, `auto:1`, `auto:2`, `auto:3`,
`blocked`, `blocked:1`, `blocked:2`, `blocked:3`. `""` (unset) stays implied by `closedSet`. The
derived error message narrows with it — the whole point of the single-slice derivation. After this,
`POST /api/windows/{id}/options` with `marker=hatch` is a **400 with zero tmux calls**.
The doc comments on `MarkerValues` and `ValidateMarkerValue` (`validate.go:238-250`) still describe
the eight flat states and their stripe widths; they are this change's own lines and must be rewritten.

**5. `app/backend/api/windows.go` — the accepted-value comment.**
Phase 1 touched it as a comment-only edit. Narrow it to the twelve.

**6. `app/backend/api/operator.go` — the `color-tabs` prompt vocabulary.**
The prompt renders the accepted `@rk_win_marker` accent vocabulary. `operator_test.go:926-936` holds
the drift guard (`promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)`), so the
prompt copy must move with the set or that test fails. The prompt's guidance text (which currently
describes stripe weights) should describe mode × stage instead.

**7. No `legacy_options.go` row.** That table maps option *names*; this is a same-name **value**
remap, owned by `NormalizeMarker`.

### Frontend — the visual rework

**8. `app/frontend/src/marker.tsx` — add the render half.**
Copy from `pr767:app/frontend/src/marker.tsx` (its lines 70+), with two translations (see
Assumptions 1 and 2):

- `MARKER_INK = "var(--color-marker-ink)"`
- `MARKER_STAGE_WIDTHS: Record<MarkerStage, number> = { 1: 7, 2: 15, 3: 22 }`
- `MARKER_CHEVRON_WIDTH = 4.2`, `MARKER_CHEVRON_HEIGHT = 10`, `MARKER_CHEVRON_PITCH = 7.2`,
  `MARKER_CHEVRON_STROKE = 1.8`
- `markerFillStyle(marker): CSSProperties | undefined` — `manual` → `{ width, background: MARKER_INK }`;
  `blocked` → the **non-repeating** 45° `linear-gradient(45deg, INK 0 25%, transparent 25% 50%, INK 50% 75%, transparent 75%)`
  at `backgroundSize: "12px 12px"`, `backgroundRepeat: "repeat"` (phase-aligns across every 12px tile
  boundary — a `repeating-linear-gradient` would not, since 12/√2 is no multiple of its period);
  `auto` → `undefined` (chevrons draw it).
- `MarkerChevrons({ count })` — an `aria-hidden` SVG of `count` right-pointing chevron paths,
  `width = (count - 1) * PITCH + WIDTH`, `strokeLinecap`/`strokeLinejoin` round, stroked in
  `MARKER_INK`, inset by `STROKE / 2`.
- **Relocated from #767's `marker-pad.tsx`** (which this phase does not create):
  ```ts
  export const MARKER_WELL_BACKGROUND = "color-mix(in srgb, var(--color-marker-ink) 12%, transparent)";
  export const MARKER_WELL_EDGE = "1px solid color-mix(in srgb, var(--color-marker-ink) 30%, transparent)";
  ```

**9. `app/frontend/src/globals.css` — the ink token.**
Add `--color-marker-ink` following the `--color-signal-yellow` pattern: the `@theme` block
(`globals.css:~43`, `#f59e0b`), `html[data-theme="dark"]` (`~65`, `#f59e0b`), and
`html[data-theme="light"]` (`~85`, `#d97706`). The `.rk-hazard` wedge comment block changes from
"marker is `hatch`" to "marker mode is `blocked`" and from "the row's guarded marker color" to "the
marker ink" — those are this change's own lines.

**10. `app/frontend/src/components/sidebar/window-row.tsx` — the well, and the retirements.**

The well (replacing the stripe at `window-row.tsx:567-573`):

```tsx
{displayMarker && (
  <div
    aria-hidden="true"
    data-testid="marker-well"
    className="absolute inset-y-0 left-0 z-10 pointer-events-none"
    style={{ width: MARKER_WELL_WIDTH, background: MARKER_WELL_BACKGROUND, borderRight: MARKER_WELL_EDGE }}
  >
    {markerFillStyle(displayMarker) && (
      <span aria-hidden className="absolute inset-y-0 left-0" style={markerFillStyle(displayMarker)} />
    )}
    {displayMarker.mode === "auto" && (
      <span aria-hidden className="absolute inset-y-0 left-0 flex items-center" style={{ width: MARKER_STAGE_WIDTHS[3] }}>
        <MarkerChevrons count={displayMarker.stage} />
      </span>
    )}
  </div>
)}
```

with `const parsedMarker = useMemo(() => parseMarker(marker), [marker])`. In phase 2 there is no
preview state, so `displayMarker` **is** `parsedMarker` — phase 3 introduces the preview override.
The well is drawn on **both pointer classes** and **only when `parseMarker(marker) !== null`** (an
unmarked row renders nothing in the strip). It must NOT be gated on the current `labelZoneEnabled`
predicate (`window-row.tsx:441`), which is going away.

Geometry and constants:

- `MARKER_WELL_WIDTH = 22` replaces `LABEL_ZONE_WIDTH = 26`; `STRIPE_EDGE_INSET` (4) goes to 0 and
  is then unused — delete it, not zero it.
- `ICON_ZONE_WIDTH` (12) and `ICON_EDGE_INSET` (12) are deleted with the zone.
- Row content start is `pl-[30px]` on **both** pointer classes: the `coarse:pl-4` override in the
  base class string (`window-row.tsx:395`) is removed. The 8px gap between the well's right edge and
  the content holds the status dot's 3px waiting halo clear of the well.

Retirements in this file:

- **Delete the interactive `LabelZone`** — the component (`window-row.tsx:895-960`), its
  `LabelZoneProps`, the `zoneHover` state, `openLabelPicker`, the `labelZoneEnabled` predicate, the
  three constants above, and the `aria-label="Set tab label"` element.
- `blocked` mounts `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)` (today
  `window-row.tsx:521` sets it from `markerColor`, and the trigger is the `hatch` token).
- **The marker no longer reads the row's family colour.** `markerColor` (`window-row.tsx:352`)
  survives only as the `FlairOverlay` colour (`window-row.tsx:560`) — rename or re-comment it so a
  later reader does not re-couple it to the marker.
- **Plain hover no longer shades the row background**; the shade is reserved for the held state
  (`flyout.open`), which the class-name logic already distinguishes (`window-row.tsx:404-411`, and the
  `onMouseEnter`/`onMouseLeave` inline-style pair at `~618`).
- **The coarse status dot loses its flyout-trigger role**: `scrub.handlers`, the `stopPropagation`
  onClick, and the `coarse:min-w-[32px]` box come off the wrapper span (`window-row.tsx:645-648`), so
  the 56px rail is the sole coarse flyout trigger and **a dot tap selects the row**.
- The row's `onMarkerChange` prop and its threading become dead once the picker's marker band is
  gone — remove them here and at the call site. Phase 3 reintroduces a write seam under a different
  name (`onWindowMarkerChange`).

**11. `app/frontend/src/components/swatch-popover.tsx` — the picker becomes colour + flair.**
Remove the marker band and everything downstream of it: the `selectedMarker` / `onSelectMarker`
props, the `showMarkers` predicate, `markerOverride` / `previewMarker` / `currentMarker` state, the
`clear-marker` keyboard cell row (`swatch-popover.tsx:243-244, 321, 583-584`), the
`MARKER_STATES.slice(1)` cell grid (`:587-590`), `previewStripe` (`:435`), and the marker legs of the
combo caption and of `clearAll` (`:209-217`).

**12. `app/frontend/src/themes.ts` — delete the retired vocabulary.**
`MARKER_STATES` (`themes.ts:479`) and `markerStripeStyle` (`themes.ts:528`) have no consumer once
steps 10 and 11 land. Delete both, together with their `themes.test.ts` blocks (`:480-529`) and the
`MARKER_STATES`/`markerStripeStyle` imports at `themes.test.ts:14,16`. `FLAIR_STATES` and the flair
machinery are untouched; the `FLAIR_STATES` doc comment references "the marker axis's retired
motion" — that reference stays accurate and must not be churned.

### Tests

**Backend.** Read-path coverage for the two flips (a `hatch` window is served as `blocked:2`; a
`solid` snapshot field parses to `manual:1`), write-path coverage for `restore.go`, the narrowed
validator table in `validate_test.go` (every flat token now rejected, every `mode:stage` token
accepted), and the `operator_test.go` drift guard passing against the narrowed set.

**Frontend unit.** `marker.test.ts` gains `markerFillStyle` cases per mode × stage (widths 7/15/22,
`auto` → `undefined`, `blocked` carries the non-repeating gradient) and `MarkerChevrons` count/width
cases. `window-row.test.tsx` (18 hits in the removal sweep) moves from stripe assertions to well
assertions and loses its label-zone cases. `swatch-popover.test.tsx` loses its marker cases.

**e2e.** Both spec files need real rewriting, not a search-and-replace:

- `tests/e2e/window-marker-gutter.spec.ts` is built end-to-end around the label zone → banded picker
  → marker band flow, which no longer exists. Rewrite it to set `@rk_win_marker` through the file's
  existing `_tmux` helper and assert the **well** renders (`data-testid="marker-well"`, 22px, the
  wash + edge, `.rk-hazard` on `blocked`, nothing on an unmarked row). Its file-header comment
  (which describes the 8-state closed set and the three-band picker) is part of the same edit.
- `tests/e2e/row-flyout.spec.ts` (7 hits) — the coarse dot no longer opens the card. Assert the rail
  opens it and a dot tap selects the row.
- `tests/e2e/legacy-color-sweep.spec.ts:72,115` opens the Label picker via
  `row.getByLabel("Set tab label")`. That entry point is deleted; re-route it through the card's
  `Change color…` row (`row-flyout-card.tsx:820`), which together with the `Tab: Label` palette
  action (`app.tsx:2611`) is the picker's remaining way in.
- **Every touched `test()` needs its `Proves:` / `Steps:` JSDoc updated in the same edit**
  (constitution § Test Intent Comments), and the intent comment SHALL NOT cite change IDs or PR
  numbers.

### Explicitly out of scope

**No pad, no strip press target, no wheel, no palette `Tab: Marker` action, no card Marker row, no
`marker-pad.tsx`.** Markers are **display-only** after this phase. Do not port #767's
`app/frontend/src/components/sidebar/marker-pad.tsx`, its `window-row.tsx` gesture wiring, its
`buildTabPickerActions` export, or the `sidebar/index.tsx` `onWindowMarkerChange` seam — all four are
phase 3. The PR body must state that markers are set with
`tmux set-option -w -t <window> @rk_win_marker manual:2` until phase 3 lands.

Open question **OQ-1** (how markers are set on a coarse pointer once the card's Marker section is
gone) belongs to phase 3 and is explicitly recorded in the plan as changing "phase 3's scope but
nothing in phases 1–2". Do not pre-empt it here.

### Known traps

Each was a real review finding or a manual-test defect on #767, or a verified property of this
worktree.

1. **Fixtures carrying legacy tokens fail once the write path normalizes.** `snapshot/restore_test.go:129`
   (`restoreFixture`), `snapshot/reopen_test.go:22` (`reopenFixture` — main's reopen engine shares
   restore's option-write path), and `snapshot/integration_test.go:152` all carry `Marker: "solid"`.
   Move each to the current vocabulary and **keep one dedicated test that feeds a legacy value and
   asserts the normalized result**. `snapshot/snapshot_test.go:54,97,155,174` also carries `"solid"`
   — it round-trips Go structs through JSON without touching a normalizing path, so it may pass
   untouched; check it rather than assume, and migrate it for vocabulary hygiene if nothing breaks.
2. **The removal sweep must include e2e specs, not just `src/`.** The gate is
   `grep -rn "Set tab label\|LabelZone\|MARKER_STATES\|markerStripeStyle\|coarse:pl-4\|status-dot-tap" app/frontend`
   returning nothing but deliberate survivors. Today it hits nine files:
   `src/components/sidebar/window-row.tsx` (28), `src/components/sidebar/window-row.test.tsx` (18),
   `src/themes.test.ts` (15), `tests/e2e/window-marker-gutter.spec.ts` (13),
   `tests/e2e/row-flyout.spec.ts` (7), `src/components/swatch-popover.tsx` (6),
   `tests/e2e/legacy-color-sweep.spec.ts` (2), `src/themes.ts` (2),
   `src/components/swatch-popover.test.tsx` (2). A `src/`-only sweep is exactly the mistake that
   broke CI on PR #751.
3. **Do not rewrite comments outside the change's own lines.** #767 churned ~200 lines of unrelated
   `app.tsx` comments chasing an unscoped hygiene rule, and its `globals.css` diff *also* rewrites
   two untouched comment blocks (a `260819-v6y4 R11` citation at `:167` and an `R2` reference at
   `:362`) that have nothing to do with markers. Do not carry those hunks across.
4. **Comment-hygiene acceptance is scoped to the diff.** Write it as *"no plan/change IDs
   (`R#`/`T###`/`A-###`) or removed-feature narration in comments **this change adds or modifies**"* —
   never as a repo-wide rule. The repo's own convention is to cite change ids, so an unscoped rule
   makes every review re-litigate untouched files; this single mistake cost five of #767's ten cycles.
5. **The provenance sweep goes in the apply prompt, not the review.** Instruct the worker to run,
   before writing its result:
   `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files incl. tests>`
   and clear every hit. Workers mirror plan IDs into comments by habit, and the sweep must cover test
   and e2e files, not just `src/`.
6. **#767's import paths do not match this tree.** #767 kept the marker vocabulary in `themes.ts`
   (`window-row.tsx` there imports `parseMarker`, `markerFillStyle`, `MarkerChevrons`, `MARKER_INK`,
   `MARKER_STAGE_WIDTHS` from `@/themes`); phase 1 chose a standalone `@/marker`. Every copied import
   needs translating, and `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` must be lifted out of
   `marker-pad.tsx` into `marker.tsx` (Assumption 1) because the pad is not created here.
7. **Do not re-run the full gate set for a comment fix.** Re-run what the edit touches.
8. **Treat the 3-cycle exhaustion stop as a design signal.** If this phase exhausts its rework
   budget, stop and re-plan rather than hand-driving it.
9. **Pre-warm the worker pane** (`fab dispatch open` → `ready` → clear any trust/update wall) before
   the pipeline needs it.

### Acceptance (from the plan, verbatim in intent)

- A live window carrying `hatch` is served as `blocked:2`; an old snapshot restores as `blocked:2`; a
  retired token POSTed to `/api/windows/{id}/options` returns 400 **with zero tmux calls**.
- A marked row renders the well at `left: 0; width: 22px` with the 12% wash and the 30% right edge in
  `var(--color-marker-ink)`; an unmarked row renders nothing in the strip.
- No element with `aria-label="Set tab label"` exists on either pointer class; the colour + flair
  picker still opens from the card's `Change color…` row and the `Tab: Label` palette action.
- Plain hover changes no row background; the held state does.
- A coarse dot tap selects the row; the rail still opens the card.
- `parseMarker`/`formatMarker` round-trip is unchanged, and every one of the nine mode × stage pairs
  renders its specified shape and width.

### Gates

Full set, **one e2e invocation at a time**:

```
cd app/backend && go test ./...
cd app/frontend && npx tsc --noEmit
just test-frontend
just test-e2e "window-marker-gutter"
just test-e2e "row-flyout"
just build
```

The e2e runner kills any listener on :3020 machine-wide, and a second run started during the first's
teardown fails with a real-looking `ECONNREFUSED` — never overlap them.

### Size estimate

~8 frontend files plus the backend flip. Roughly +600 / −900 — it deletes more than it adds.

## Affected Memory

- `run-kit/architecture.md`: (modify) § the `@rk_win_marker` window user option and the
  `internal/validate` closed-set validator row — phase 1 recorded the transitional union and
  `NormalizeMarker` as landed-but-unwired. Record the narrowed twelve-token set, the two read-path
  call sites (`parseWindows`, `layout.go` field 27) and the `restore.go` write-path call site.
- `run-kit/tmux-sessions.md`: (modify) the `@rk_win_marker` row of the `@rk_<scope>_<name>` option
  inventory — accepted values narrow to the twelve; note that legacy values on disk are normalized on
  read and on restore rather than migrated by `MigrateLegacyOptions` (a value remap, not a name remap).
- `run-kit/api-and-sockets.md`: (modify) the `POST /api/windows/{windowId}/options` entry's
  `@rk_win_marker` validation clause — the retired tokens now 400 with zero tmux calls.
- `run-kit/operator-actuation.md`: (modify) the `color-tabs` prompt's `@rk_win_marker` accent
  vocabulary and its prompt-vocabulary drift-guard invariant.
- `run-kit/layout-snapshots.md`: (modify) the capture/restore option set — snapshots now store and
  restore normalized marker values; an old snapshot's flat token is normalized on the way back in.
- `run-kit/ui/visual-design.md`: (modify) the colour-token table gains `--color-marker-ink`
  (#f59e0b dark / #d97706 light); the row-textures section replaces the eight-state stripe vocabulary
  with the 3×3 mode × stage model, the T4 well (12% wash + 30% right edge, marked rows only), the
  fill widths 7/15/22 and the chevron geometry, and records that the marker no longer reads the row's
  family hue. The `.rk-hazard` wedge's trigger changes from the `hatch` token to the `blocked` mode.
- `run-kit/ui/sidebar.md`: (modify) § row anatomy and § icon system and label zone — the interactive
  label zone is retired, the left strip becomes the display-only 22px marker well on both pointer
  classes, content start is `pl-[30px]` everywhere, plain hover no longer shades the row, and the
  coarse status dot is no longer a flyout trigger (the 56px rail is the sole coarse trigger; a dot tap
  selects the row).
- `run-kit/ui/status-signals.md`: (modify) the coarse-rail / flyout-card entry-point list — the dot
  tap is no longer one of them.
- `run-kit/ui/dialogs-and-state.md`: (modify) the Label-picker (swatch popover) description — it
  becomes a colour + flair picker; the marker band, its keyboard `clear-marker` row, and the marker
  leg of the combo caption and clear-all are gone.

## Impact

**Backend** (`app/backend`): `internal/tmux/tmux.go` (parseWindows marker admit + doc comment),
`internal/tmux/layout.go` (field 27), `internal/snapshot/restore.go` (option write),
`internal/validate/validate.go` (`markerTokens` + two doc comments), `api/windows.go` (comment),
`api/operator.go` (`color-tabs` prompt vocabulary). Tests: `internal/tmux/tmux_test.go`,
`internal/validate/validate_test.go`, `internal/snapshot/{restore,reopen,integration,snapshot}_test.go`,
`api/operator_test.go`.

**Frontend** (`app/frontend`): `src/marker.tsx` (+ render half, + well tokens), `src/globals.css`
(ink token in three blocks, `.rk-hazard` comment), `src/themes.ts` (`MARKER_STATES` +
`markerStripeStyle` deleted), `src/components/sidebar/window-row.tsx` (the largest single file —
28 sweep hits), `src/components/swatch-popover.tsx`. Tests: `src/marker.test.ts`,
`src/themes.test.ts`, `src/components/sidebar/window-row.test.tsx`,
`src/components/swatch-popover.test.tsx`, `tests/e2e/window-marker-gutter.spec.ts`,
`tests/e2e/row-flyout.spec.ts`, `tests/e2e/legacy-color-sweep.spec.ts`.

**API contract**: `POST /api/windows/{windowId}/options` narrows its accepted `marker` values — a
**breaking change for any external caller** still POSTing a flat token. Acceptable and intended: the
option is user-owned and the read path normalizes what already exists on disk.

**No new routes, no new settings key, no database** — Constitution IV/II unaffected. Constitution V
(keyboard-first) is unaffected because this phase removes a *mouse* affordance (the label zone) while
the picker keeps its palette entry; the marker itself becomes display-only and therefore has no
action to register until phase 3.

## Open Questions

None blocking. The plan section, the four study pages, and the #767 reference settle every decision
this phase makes. OQ-1 (coarse-pointer marker setting) and OQ-2 (whether tooling ever writes `auto`)
are recorded in the plan as phase-3-and-later concerns and are deliberately not answered here.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` are defined in `src/marker.tsx`, not in a new `marker-pad.tsx` | #767 put them in `marker-pad.tsx`, which is phase-3 scope and must not be created here; phase 1 established `marker.tsx` as the single home for the marker vocabulary, and phase 3 can import them from there | S:85 R:90 A:95 D:90 |
| 2 | Certain | Copied #767 code has its imports translated from `@/themes` to `@/marker` | #767 kept the vocabulary in `themes.ts`; phase 1 shipped a standalone `src/marker.tsx` and this phase *deletes* the marker half of `themes.ts`, so re-adding marker exports there would contradict the retirement | S:80 R:90 A:95 D:95 |
| 3 | Certain | `MARKER_STATES` and `markerStripeStyle` are deleted from `themes.ts` outright (not deprecated in place), along with their `themes.test.ts` blocks | Steps 10 and 11 remove their only two consumers; the plan lists both in the removal sweep, and leaving dead exports would make the sweep's own grep gate un-passable | S:85 R:75 A:90 D:85 |
| 4 | Certain | The well renders on both pointer classes gated purely on `parseMarker(marker) !== null`, not on the current `labelZoneEnabled` predicate | `labelZoneEnabled` also requires `onColorChange`/`onMarkerChange`/`server`, and it is deleted with the zone; the plan's acceptance says an unmarked row renders nothing and a marked row renders the well, with no capability qualifier | S:80 R:85 A:90 D:85 |
| 5 | Certain | `window-marker-gutter.spec.ts` is rewritten to set `@rk_win_marker` through the spec's existing `_tmux` helper and assert well rendering | The spec's current flow is label zone → banded picker → marker band, and all three are removed; with markers display-only in this phase there is no UI write path left to drive, so the tmux helper is the only way to reach a marked row | S:75 R:80 A:85 D:80 |
| 6 | Certain | The comment-hygiene acceptance item is scoped to lines this change adds or modifies, and the provenance grep runs in the **apply** prompt before the worker writes its result | Post-mortem rules 1 and 2, stated verbatim in the plan's "Rules that bind every phase"; an unscoped rule cost five of #767's ten review cycles | S:95 R:90 A:95 D:95 |
| 7 | Certain | #767's unrelated `globals.css` comment rewrites (the `R11` and `R2` citation hunks) are not carried across | Verified by diffing `main..pr767` on `globals.css`: two hunks touch comment blocks with no marker content. The plan forbids rewriting comments outside the change's own lines | S:90 R:85 A:90 D:90 |
| 8 | Certain | `markerColor` is retained solely as the `FlairOverlay` colour, and `.rk-hazard` reads `--rk-marker-color: var(--color-marker-ink)` | Stated explicitly in the plan's frontend scope ("the marker no longer reads the row's family colour; `markerColor` survives only as the `FlairOverlay` colour"); the studies fix the ink as one theme-paired hue, never the family hue | S:85 R:80 A:85 D:85 |
| 9 | Certain | OQ-1 does not block this phase — coarse rows ship display-only | The plan states OQ-1 "changes phase 3's scope but nothing in phases 1–2", and the user's invocation lists the pad and every write affordance as explicitly out of scope | S:90 R:70 A:85 D:85 |
| 10 | Confident | `snapshot/snapshot_test.go`'s `"solid"` fixtures are checked and migrated for vocabulary hygiene even though the plan's trap list names only three files | It round-trips Go structs through JSON without crossing a normalizing path, so it probably passes untouched — but leaving a retired token in a fixture is exactly the "did anything stale survive" failure this phase asks about. Verify before changing | S:60 R:85 A:70 D:65 |
| 11 | Confident | The dedicated legacy-value test lives on the **write** path in `snapshot/restore_test.go`, with read-path legacy coverage added in `tmux_test.go` (parseWindows) and for `layout.go` field 27 | The plan asks to "keep one dedicated test that feeds a legacy value and asserts the normalized result" in the fixture context (restore); the two read-path flips are new behavior and need their own coverage regardless | S:75 R:85 A:80 D:75 |
| 12 | Confident | `legacy-color-sweep.spec.ts` re-routes its picker entry from `getByLabel("Set tab label")` to the card's `Change color…` row | That zone is deleted; the card row and the `Tab: Label` palette action are the picker's two remaining entry points, and the card row is the one already reachable from a sidebar row in that spec's flow | S:70 R:80 A:85 D:80 |
| 13 | Confident | The `onMarkerChange` prop is removed from `window-row.tsx` and `swatch-popover.tsx` and from the `sidebar/index.tsx` call site | With the marker band gone the prop has no consumer. Phase 3's plan describes *introducing* an optional `onWindowMarkerChange` prop, which reads as a re-introduction under a new name rather than a survival of this one | S:65 R:85 A:80 D:75 |
| 14 | Confident | The coarse dot's `data-testid="status-dot-tap"` wrapper span is simplified to a plain wrapper (handlers, `stopPropagation`, and `coarse:min-w-[32px]` removed) rather than deleted outright | The plan enumerates three removals and is silent on the element itself; the dot still needs a wrapper, and `row-flyout.spec.ts` targets that testid — but the testid name now describes behavior that is gone, so renaming it with its spec is equally defensible | S:45 R:80 A:65 D:55 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
