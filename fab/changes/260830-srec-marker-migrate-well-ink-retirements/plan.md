# Plan: Marker rework phase 2 — migrate + contract: the well, the ink, the retirements

**Change**: 260830-srec-marker-migrate-well-ink-retirements
**Intake**: `intake.md`

## Requirements

### Backend: Marker read-path normalization

#### R1: `parseWindows` normalizes the stored marker
`internal/tmux/tmux.go` `parseWindows` SHALL pass the trimmed `@rk_win_marker` field through
`NormalizeMarker` instead of gating it on `validate.MarkerValues` membership, so no consumer of the
window payload ever receives a flat pre-`mode:stage` token. Anything outside both vocabularies SHALL
continue to collapse to `""` (the existing unknown-token idiom shared with role and flair).

- **GIVEN** a live tmux window whose `@rk_win_marker` is `hatch`
- **WHEN** `parseWindows` builds the `WindowInfo`
- **THEN** `WindowInfo.Marker` is `blocked:2`
- **AND GIVEN** the option holds `manual:3`, **THEN** it passes through unchanged
- **AND GIVEN** the option holds `nonsense`, **THEN** `Marker` is `""`

#### R2: The snapshot reader normalizes field 27
`internal/tmux/layout.go` SHALL wrap the field-27 marker read (`win.Marker = strings.TrimSpace(parts[26])`)
in `NormalizeMarker`, so a layout capture taken from a server still holding legacy values records the
current vocabulary.

- **GIVEN** a tmux window whose `@rk_win_marker` is `solid`
- **WHEN** the layout reader parses its row
- **THEN** the captured `Window.Marker` is `manual:1`
- **AND** a snapshot written from that capture stores `manual:1`, not `solid`

#### R3: Restore normalizes on the write path
`internal/snapshot/restore.go` SHALL write the marker option as
`add(tmux.MarkerOption, tmux.NormalizeMarker(win.Marker))`, so a snapshot captured before this change
cannot restore a value the narrowed validator rejects. The reopen engine shares this option-write
path and inherits the behavior.

- **GIVEN** a snapshot on disk whose window carries `Marker: "solid"`
- **WHEN** that snapshot is restored (or a window is reopened from the closed ring)
- **THEN** the restored window's `@rk_win_marker` is `manual:1`
- **AND** a subsequent `POST /api/windows/{id}/options` round-trip of that value is accepted

### Backend: Vocabulary contraction

#### R4: `markerTokens` narrows to the twelve `mode:stage` tokens
`internal/validate/validate.go` `markerTokens` SHALL be exactly
`manual`, `manual:1`, `manual:2`, `manual:3`, `auto`, `auto:1`, `auto:2`, `auto:3`, `blocked`,
`blocked:1`, `blocked:2`, `blocked:3` — the eight flat tokens are removed. `""` (unset) stays implied
by `closedSet`. The derived error message narrows with the slice (single-source derivation). The doc
comments on `MarkerValues` and `ValidateMarkerValue`, which still enumerate the flat states and their
stripe widths, SHALL be rewritten to the mode × stage model.

- **GIVEN** the narrowed set
- **WHEN** `POST /api/windows/{windowId}/options` is called with `@rk_win_marker: "hatch"`
- **THEN** the response is 400 **and zero tmux commands are executed**
- **AND WHEN** it is called with `@rk_win_marker: "blocked:2"`, **THEN** it is accepted
- **AND** the 400 body enumerates the twelve current tokens and none of the retired ones

#### R5: The `color-tabs` operator prompt carries the current vocabulary
`api/operator.go`'s `color-tabs` template SHALL render the `@rk_win_marker` accent vocabulary as the
mode × stage model, keeping the `promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)`
drift-guard invariant (`api/operator_test.go`) satisfied. Its guidance prose, which currently
describes stripe weights, SHALL describe modes and stages instead.

- **GIVEN** the narrowed `validate.MarkerValues`
- **WHEN** the drift-guard test compares the prompt vocabulary to the closed set
- **THEN** the two are equal
- **AND** the rendered prompt names no retired token

#### R6: The window-options handler comment matches the accepted set
`api/windows.go`'s accepted-value comment for `@rk_win_marker` SHALL name the twelve current tokens.

- **GIVEN** a reader of `api/windows.go`
- **WHEN** they read the marker option's accepted-value comment
- **THEN** it matches what `validate.ValidateMarkerValue` accepts

### Frontend: Marker render vocabulary

#### R7: `marker.tsx` gains the render half and owns the well tokens
`app/frontend/src/marker.tsx` SHALL export, alongside the existing parse/format half:
`MARKER_INK = "var(--color-marker-ink)"`; `MARKER_STAGE_WIDTHS = { 1: 7, 2: 15, 3: 22 }`;
`MARKER_CHEVRON_WIDTH = 4.2`, `MARKER_CHEVRON_HEIGHT = 10`, `MARKER_CHEVRON_PITCH = 7.2`,
`MARKER_CHEVRON_STROKE = 1.8`; `markerFillStyle(marker)`; the `MarkerChevrons` component; and
`MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE`. `markerFillStyle` SHALL return a solid fill for
`manual`, a **non-repeating** 45° `linear-gradient` on a `12px 12px` tile for `blocked`, and
`undefined` for `auto`. `MarkerChevrons` SHALL render `count` right-pointing chevrons stroked in
`MARKER_INK`, `aria-hidden`, at width `(count - 1) * PITCH + WIDTH`.

- **GIVEN** `{ mode: "manual", stage: 2 }`
- **WHEN** `markerFillStyle` is called
- **THEN** it returns `{ width: 15, background: "var(--color-marker-ink)" }`
- **AND GIVEN** `{ mode: "auto", stage: 3 }`, **THEN** `markerFillStyle` returns `undefined`
- **AND GIVEN** `{ mode: "blocked", stage: 3 }`, **THEN** the style carries `backgroundSize: "12px 12px"`,
  `backgroundRepeat: "repeat"`, `width: 22`, and a `linear-gradient(45deg, …)` — never a
  `repeating-linear-gradient`
- **AND GIVEN** `MarkerChevrons` with `count: 2`, **THEN** the SVG width is `11.4` and it contains two paths

#### R8: `--color-marker-ink` is a theme-paired token
`app/frontend/src/globals.css` SHALL define `--color-marker-ink` in the `@theme` block and in both
`html[data-theme="dark"]` (`#f59e0b`) and `html[data-theme="light"]` (`#d97706`), following the
`--color-signal-yellow` pattern.

- **GIVEN** the dark theme is active
- **WHEN** a marked row paints
- **THEN** its well, fill, chevrons, and hazard wedge all resolve to `#f59e0b`
- **AND GIVEN** the light theme, **THEN** they resolve to `#d97706`

### Frontend: The marker well

#### R9: A marked row renders the T4 well; an unmarked row renders nothing
`window-row.tsx` SHALL render the marker well **only** when `parseMarker(marker) !== null`, on **both**
pointer classes, as an `aria-hidden`, `pointer-events-none`, `z-10` element at `left: 0` and
`width: MARKER_WELL_WIDTH = 22`, with `MARKER_WELL_BACKGROUND` (12% ink wash) and `MARKER_WELL_EDGE`
(1px 30%-ink right edge). Inside it, `manual` and `blocked` render the `markerFillStyle` fill anchored
at `left: 0` full row height (so stacked rows weld), and `auto` renders `MarkerChevrons` vertically
centred in a 22px-wide box. The well SHALL carry `data-testid="marker-well"` and MUST NOT be gated on
the retired `labelZoneEnabled` predicate.

- **GIVEN** a window row whose marker is `auto:2`
- **WHEN** the row renders
- **THEN** exactly one `marker-well` element exists at `left: 0` with `width: 22px`
- **AND** it contains two chevrons and no fill span
- **AND GIVEN** a window with no marker, **THEN** no `marker-well` element is rendered

#### R10: Row geometry is uniform across pointer classes, and `blocked` mounts the hazard in ink
The row's content start SHALL be `pl-[30px]` on **both** pointer classes — the `coarse:pl-4` override
is removed. `STRIPE_EDGE_INSET`, `LABEL_ZONE_WIDTH`, `ICON_ZONE_WIDTH`, and `ICON_EDGE_INSET` SHALL be
deleted, replaced by `MARKER_WELL_WIDTH = 22`. A row whose marker **mode** is `blocked` SHALL mount
`.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`; the trigger is the mode, not the
retired `hatch` token, and the ink is no longer the row's family colour.

- **GIVEN** a coarse-pointer viewport
- **WHEN** a window row renders
- **THEN** its content start is 30px, identical to the fine-pointer row
- **AND GIVEN** a row marked `blocked:1`, **THEN** `.rk-hazard` is mounted and `--rk-marker-color`
  resolves to `var(--color-marker-ink)`
- **AND GIVEN** a row marked `manual:3` on a red-family colour, **THEN** the well paints in the marker
  ink, not red

### Frontend: Retirements

#### R11: The interactive label zone is gone
`window-row.tsx` SHALL no longer render any interactive left-edge zone. The `LabelZone` component,
`LabelZoneProps`, the `zoneHover` state, `openLabelPicker`, the `labelZoneEnabled` predicate, and every
`aria-label="Set tab label"` element SHALL be deleted. The row's `onMarkerChange` prop and its
threading from `sidebar/index.tsx` SHALL be removed with it.

- **GIVEN** any window row on either pointer class
- **WHEN** the DOM is queried for `[aria-label="Set tab label"]`
- **THEN** nothing matches
- **AND** the colour + flair picker still opens from the flyout card's `Change color…` row and from the
  `Tab: Label` palette action

#### R12: Plain hover no longer shades the row; the held state does
The row's background SHALL change on the held state (`flyout.open`) only. The hover-driven background
shading — both the `hover:` class arm and the `onMouseEnter`/`onMouseLeave` inline-style pair — SHALL be
removed. Text-colour hover treatments are unaffected.

- **GIVEN** a window row at rest
- **WHEN** the pointer hovers it without opening the flyout
- **THEN** its background is unchanged
- **AND WHEN** its flyout card is open, **THEN** the held shade is applied

#### R13: The coarse status dot is no longer a flyout trigger
The status-dot wrapper SHALL lose `scrub.handlers`, its `stopPropagation` `onClick`, and its
`coarse:min-w-[32px]` box, so the 56px status rail is the sole coarse flyout trigger and a coarse dot
tap falls through to row selection.

- **GIVEN** a coarse-pointer viewport
- **WHEN** the user taps a row's status dot
- **THEN** the row is selected and no flyout card opens
- **AND WHEN** the user taps the row's 56px rail, **THEN** the flyout card opens as before

#### R14: The Label picker becomes colour + flair
`swatch-popover.tsx` SHALL remove the marker band and everything downstream: the `selectedMarker` /
`onSelectMarker` props, the `showMarkers` predicate, `markerOverride` / `previewMarker` /
`currentMarker` state, the `clear-marker` keyboard cell row, the `MARKER_STATES` cell grid,
`previewStripe`, and the marker legs of the combo caption and of `clearAll`.

- **GIVEN** the picker is open on a window row
- **WHEN** the bands render
- **THEN** exactly two bands exist — colour and flair
- **AND** keyboard navigation skips no live cell and reaches no marker cell
- **AND** the clear-all row clears colour and flair only

#### R15: The flat marker vocabulary is deleted from `themes.ts`
`themes.ts` SHALL no longer export `MARKER_STATES` or `markerStripeStyle`; their `themes.test.ts`
coverage is deleted with them. `FLAIR_STATES` and the flair machinery are untouched.

- **GIVEN** the repository after this change
- **WHEN** `grep -rn "MARKER_STATES\|markerStripeStyle" app/frontend` is run
- **THEN** nothing matches

### Tests

#### R16: Fixtures and specs move to the current vocabulary, with one deliberate legacy test
Every test fixture carrying a retired token SHALL move to the current vocabulary, and **one dedicated
test** SHALL feed a legacy value through the restore write path and assert the normalized result.
Read-path legacy coverage SHALL exist for `parseWindows` and for the layout field-27 read. Every
touched Playwright `test()` SHALL have its `Proves:` / `Steps:` JSDoc updated in the same edit, and
each touched spec file's header comment SHALL match the setup it now describes.

- **GIVEN** `snapshot/restore_test.go`, `snapshot/reopen_test.go`, and `snapshot/integration_test.go`
- **WHEN** the suite runs after the write path normalizes
- **THEN** all pass with current-vocabulary fixtures
- **AND** one test feeds `solid` through restore and asserts `manual:1` is written
- **AND GIVEN** the e2e specs, **THEN** `window-marker-gutter.spec.ts` sets markers through its `_tmux`
  helper and asserts well rendering, `row-flyout.spec.ts` reflects the rail-only coarse trigger, and
  `legacy-color-sweep.spec.ts` opens the picker through the card's `Change color…` row

### Non-Goals

- **No marker pad**, no `marker-pad.tsx`, no strip press target, no drag/wheel gesture, no
  `marker-pad:open` event, no `Tab: Marker` palette action, no `onWindowMarkerChange` seam, no card
  Marker row — all of it is phase 3. Do not port #767's `marker-pad.tsx` or its `window-row.tsx`
  gesture wiring.
- **No answer to OQ-1** (how a coarse pointer sets a marker). Markers are display-only after this
  change; the plan records that OQ-1 changes phase 3's scope and nothing here.
- **No `legacy_options.go` row.** That table remaps option *names*; this is a same-name *value* remap
  owned by `NormalizeMarker`.
- **No repo-wide comment hygiene.** Only lines this change adds or modifies are in scope.

### Design Decisions

#### The well tokens live in the marker module, not the pad
**Decision**: `MARKER_WELL_BACKGROUND` and `MARKER_WELL_EDGE` are defined in
`app/frontend/src/marker.tsx`.
**Why**: the row well and (later) every pad cell must paint the identical wash and edge or previews
drift visually from committed markers; `marker.tsx` is already the single home for the marker
vocabulary, and it exists in this phase while the pad does not.
**Rejected**: keeping them in `marker-pad.tsx` as PR #767 does — that file is phase-3 scope and
creating it here to hold two constants would drag the pad's surface into a display-only change.
*Introduced by*: 260830-srec-marker-migrate-well-ink-retirements

#### Legacy marker values are normalized at every boundary, never migrated in place
**Decision**: flat tokens are mapped forward by `NormalizeMarker` at three seams — the live read
(`parseWindows`), the snapshot read (`layout.go` field 27), and the restore write (`restore.go`) —
rather than by a one-shot rewrite of `@rk_win_marker` across running servers.
**Why**: Constitution II derives state from tmux at request time; a migration pass would need a
writable sweep over every reachable server and would still miss servers started later from an old
snapshot. Normalizing at the boundaries makes every path idempotent and leaves no window in a state
its own validator rejects.
**Rejected**: a `MigrateLegacyOptions` row (that table remaps option *names*, and this is a value
remap); a startup sweep (a write pass over user state at boot, with no way to reach detached servers).
*Introduced by*: 260830-srec-marker-migrate-well-ink-retirements

#### The marker paints in one fixed ink, never the row's family hue
**Decision**: every marker surface reads `--color-marker-ink` (#f59e0b dark / #d97706 light);
`markerColor` survives only as the `FlairOverlay` colour.
**Why**: the marker is now a two-axis encoding — shape carries mode, width/count carries stage — and a
per-row hue would add a third, uncontrolled channel that collides with the family tint the row already
uses for identity. A single ink keeps the nine cells comparable across rows of any colour.
**Rejected**: keeping the guarded family colour (the design studies rejected it — a red-family row's
`blocked` marker read as a status signal rather than a user label).
*Introduced by*: 260830-srec-marker-migrate-well-ink-retirements

#### The row's background shade belongs to the held state alone
**Decision**: plain hover changes no row background; only `flyout.open` shades.
**Why**: with the well occupying the left 22px on every row, a hover shade plus a wash plus a family
tint stacked three background layers on one row and made the well's 12% wash unreadable on hover. The
held state is the only background change that carries information.
**Rejected**: keeping a lighter hover shade (still stacks under the wash); moving the wash above the
hover fill (inverts the z-order the hazard/flair overlays already depend on).
*Introduced by*: 260830-srec-marker-migrate-well-ink-retirements

### Deprecated Requirements

#### Left-Edge Label Zone (`window-row.tsx` `LabelZone`)
**Reason**: the 26px interactive zone was the marker's write affordance and the Label picker's
fine-pointer opener. With markers display-only and the picker reachable from the flyout card and the
palette, the zone is an invisible-at-rest target consuming the space the 22px well now occupies.
**Migration**: the colour + flair picker opens from the flyout card's `Change color…` row and the
`Tab: Label` palette action; markers are set with `tmux set-option -w -t <window> @rk_win_marker manual:2`
until phase 3 lands the pad.

#### Flat 8-state marker vocabulary (`MARKER_STATES` / `markerStripeStyle` / `markerTokens`)
**Reason**: superseded by the 3×3 mode × stage model, which the design studies fix as canonical.
Keeping both vocabularies live means the validator accepts twenty tokens for a nine-cell design.
**Migration**: `tmux.NormalizeMarker` maps every retired token forward
(`pipe|dotted|dashed|solid → manual:1`, `double → manual:2`, `thick → manual:3`, `hatch → blocked:2`,
`block → blocked:3`) at the read and restore boundaries; stored values need no user action.

#### Coarse status-dot flyout trigger
**Reason**: the dot's coarse scrub handlers competed with row selection and duplicated the 56px status
rail, which is the documented coarse trailing zone for all three row tiers.
**Migration**: the rail is the sole coarse flyout trigger; a coarse dot tap selects the row.

## Tasks

### Phase 1: Backend — flip the read path

- [x] T001 Wire `NormalizeMarker` into `parseWindows` in `app/backend/internal/tmux/tmux.go` (replace the `validate.MarkerValues[m]` membership gate around `parts[19]`), and rewrite the adjacent doc comment to the mode × stage vocabulary <!-- R1 -->
- [x] T002 Wrap the field-27 marker read in `app/backend/internal/tmux/layout.go` (`win.Marker = strings.TrimSpace(parts[26])`) in `NormalizeMarker` <!-- R2 -->
- [x] T003 Normalize on the restore write path in `app/backend/internal/snapshot/restore.go` — `add(tmux.MarkerOption, tmux.NormalizeMarker(win.Marker))` <!-- R3 -->
- [x] T004 [P] Add read-path tests: a `hatch` window parsing to `blocked:2` in `internal/tmux/tmux_test.go`, and a `solid` field-27 row parsing to `manual:1` for the layout reader <!-- R1 R2 -->

### Phase 2: Backend — contract the vocabulary

- [x] T005 Narrow `markerTokens` in `app/backend/internal/validate/validate.go` to the twelve `mode:stage` tokens and rewrite the `MarkerValues` / `ValidateMarkerValue` doc comments <!-- R4 -->
- [x] T006 Update the `color-tabs` prompt's `@rk_win_marker` vocabulary and guidance prose in `app/backend/api/operator.go` <!-- R5 -->
- [x] T007 [P] Update the `@rk_win_marker` accepted-value comment in `app/backend/api/windows.go` <!-- R6 -->
- [x] T008 Update `internal/validate/validate_test.go` — every retired token rejected, every current token accepted, flair/role tables untouched <!-- R4 -->
- [x] T009 Move the legacy fixtures in `internal/snapshot/restore_test.go`, `reopen_test.go`, and `integration_test.go` to the current vocabulary; check `snapshot_test.go` and migrate it if its `"solid"` fixtures do not cross a normalizing path; add the one dedicated test that feeds `solid` through restore and asserts `manual:1` is written <!-- R3 R16 -->
- [x] T010 [P] Verify the `promptVocab`/`closedSetTokens` drift guard in `app/backend/api/operator_test.go` passes against the narrowed set; update the test's expectations only where it enumerates tokens directly <!-- R5 -->

### Phase 3: Frontend — the ink and the render vocabulary

- [x] T011 Add `--color-marker-ink` to `app/frontend/src/globals.css` in the `@theme`, `html[data-theme="dark"]` (#f59e0b) and `html[data-theme="light"]` (#d97706) blocks, following the `--color-signal-yellow` pattern; update the `.rk-hazard` comment block's trigger from the `hatch` token to the `blocked` mode and its colour source to the marker ink <!-- R8 R10 -->
- [x] T012 Add the render half to `app/frontend/src/marker.tsx` — `MARKER_INK`, `MARKER_STAGE_WIDTHS`, the four chevron constants, `markerFillStyle`, `MarkerChevrons`, and `MARKER_WELL_BACKGROUND` / `MARKER_WELL_EDGE` (copy from `pr767:app/frontend/src/marker.tsx` and `pr767:app/frontend/src/components/sidebar/marker-pad.tsx`, translating `@/themes` imports to this module) <!-- R7 -->
- [x] T013 Extend `app/frontend/src/marker.test.ts` with `markerFillStyle` cases per mode × stage (widths 7/15/22, `auto` → `undefined`, `blocked` carries the non-repeating gradient at `12px 12px`) and `MarkerChevrons` count/width cases <!-- R7 -->

### Phase 4: Frontend — the well and the retirements

- [x] T014 Replace the stripe with the marker well in `app/frontend/src/components/sidebar/window-row.tsx` — `parseMarker` memo, the `data-testid="marker-well"` element at `left:0`/`width:22` with the wash and edge, the fill span, and the centred `MarkerChevrons` for `auto`; gate purely on the parsed marker <!-- R9 -->
- [x] T015 Retire the row geometry constants in `window-row.tsx` — delete `STRIPE_EDGE_INSET`, `LABEL_ZONE_WIDTH`, `ICON_ZONE_WIDTH`, `ICON_EDGE_INSET`; add `MARKER_WELL_WIDTH = 22`; remove the `coarse:pl-4` override so both pointer classes start at `pl-[30px]`; point `.rk-hazard`'s `--rk-marker-color` at `var(--color-marker-ink)` and trigger it on the `blocked` mode <!-- R10 -->
- [x] T016 Delete the interactive label zone in `window-row.tsx` — the `LabelZone` component, `LabelZoneProps`, `zoneHover`, `openLabelPicker`, `labelZoneEnabled`, the `aria-label="Set tab label"` element — and remove the `onMarkerChange` prop here and at its `sidebar/index.tsx` call site <!-- R11 -->
- [x] T017 Remove the hover background shading in `window-row.tsx` (the `hover:` background arm and the `onMouseEnter`/`onMouseLeave` inline-style pair), keeping the `flyout.open` held shade and all text-colour hover treatments <!-- R12 -->
- [x] T018 Strip the coarse status-dot wrapper in `window-row.tsx` of `scrub.handlers`, its `stopPropagation` `onClick`, and `coarse:min-w-[32px]` <!-- R13 -->
- [x] T019 Remove the marker band from `app/frontend/src/components/swatch-popover.tsx` — the `selectedMarker`/`onSelectMarker` props, `showMarkers`, `markerOverride`/`previewMarker`/`currentMarker`, the `clear-marker` keyboard row, the `MARKER_STATES` cell grid, `previewStripe`, and the marker legs of the combo caption and `clearAll` <!-- R14 -->
- [x] T020 Delete `MARKER_STATES` and `markerStripeStyle` from `app/frontend/src/themes.ts` and their coverage from `src/themes.test.ts` (including the imports) <!-- R15 -->
- [x] T021 Update `src/components/sidebar/window-row.test.tsx` — well assertions replacing stripe assertions, label-zone cases deleted, hover-shade and coarse-dot cases updated <!-- R9 R11 R12 R13 -->
- [x] T022 [P] Update `src/components/swatch-popover.test.tsx` — marker cases deleted, colour + flair coverage intact <!-- R14 -->

### Phase 5: e2e and the removal sweep

- [x] T023 Rewrite `app/frontend/tests/e2e/window-marker-gutter.spec.ts` — set `@rk_win_marker` through the spec's existing `_tmux` helper and assert well rendering (`marker-well` present at 22px with wash + edge, `.rk-hazard` on `blocked`, nothing on an unmarked row); update the file-header comment and every touched `test()`'s `Proves:`/`Steps:` JSDoc in the same edit <!-- R9 R16 --> <!-- rework: the rewritten file-header comment does not cover the file's shared setup (the describe-scoped beforeAll createSession / afterAll killSession, the TEST_SESSION fixture, the resolveWindow + expectMarker helpers), which Constitution § Test Intent Comments requires -->
- [x] T024 Update `app/frontend/tests/e2e/row-flyout.spec.ts` — the rail is the sole coarse flyout trigger and a coarse dot tap selects the row; update the touched `Proves:`/`Steps:` JSDoc in the same edit <!-- R13 R16 -->
- [x] T025 Re-route `app/frontend/tests/e2e/legacy-color-sweep.spec.ts` from `getByLabel("Set tab label")` to the flyout card's `Change color…` row; update its `Proves:`/`Steps:` JSDoc in the same edit <!-- R11 R16 -->
- [x] T026 Run the removal sweep `grep -rn "Set tab label\|LabelZone\|MARKER_STATES\|markerStripeStyle\|coarse:pl-4\|status-dot-tap" app/frontend` and clear or justify every remaining hit <!-- R11 R15 R16 -->

### Phase 6: Gates

- [x] T027 Run `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, and `just test-frontend` <!-- R1 R4 R7 R9 -->
- [x] T028 Run `just test-e2e "window-marker-gutter"`, then — only after it finishes — `just test-e2e "row-flyout"`, then `just build` <!-- R16 -->

## Execution Order

- T001–T003 are the read/write flips and must land before T005 narrows the set, or the live read path
  starts dropping legacy values to `""` instead of mapping them forward.
- T009's fixture migration depends on T003 (the write path is what breaks the fixtures).
- T012 blocks T014 (the well consumes `markerFillStyle`/`MarkerChevrons`/the well tokens); T011 blocks
  both (the ink token they resolve against).
- T019 and T020 are ordered: `swatch-popover.tsx` is `markerStripeStyle`'s last consumer, so T020's
  deletion only type-checks after T019.
- T026's sweep runs after T014–T025; T028's e2e invocations run strictly one at a time.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A live window carrying `hatch` is served as `blocked:2`; `manual:3` passes through; an unknown token is served as `""`
- [x] A-002 R2: The layout reader normalizes field 27 — a `solid` window captures as `manual:1`
- [x] A-003 R3: Restoring a snapshot whose window carries `solid` writes `@rk_win_marker manual:1`
- [x] A-004 R4: `markerTokens` is exactly the twelve `mode:stage` tokens and the derived error message names only them
- [x] A-005 R5: The `color-tabs` prompt's marker vocabulary equals `closedSetTokens(validate.MarkerValues)` and names no retired token
- [x] A-006 R6: `api/windows.go`'s accepted-value comment matches `ValidateMarkerValue`
- [x] A-007 R7: `marker.tsx` exports the render half and the well tokens; `markerFillStyle` returns solid/gradient/`undefined` per mode and the specified widths per stage
- [x] A-008 R8: `--color-marker-ink` is defined in the `@theme` block and both theme blocks with the specified values
- [x] A-009 R9: A marked row renders exactly one `marker-well` at `left: 0`, `width: 22px`, with the 12% wash and the 30% right edge

### Behavioral Correctness

- [x] A-010 R4: `POST /api/windows/{id}/options` with a retired marker token returns 400 **with zero tmux calls**, and with `blocked:2` is accepted
- [x] A-011 R9: An unmarked row renders nothing in the left strip — no `marker-well` element
- [x] A-012 R10: Content start is `pl-[30px]` on both pointer classes; no `coarse:pl-4` survives
- [x] A-013 R10: A row whose mode is `blocked` mounts `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`; a coloured row's marker paints in the ink, not the family hue
- [x] A-014 R12: Plain hover changes no row background; the held (`flyout.open`) state does
- [x] A-015 R13: A coarse dot tap selects the row and opens no card; the 56px rail still opens the card
- [x] A-016 R14: The picker renders exactly two bands (colour, flair); clear-all clears colour and flair only

### Removal Verification

- [x] A-017 R11: No `aria-label="Set tab label"` element exists on either pointer class, and `LabelZone`/`labelZoneEnabled`/`zoneHover`/`openLabelPicker` are gone from the tree
- [x] A-018 R11: `onMarkerChange` is removed from `window-row.tsx`, `swatch-popover.tsx`, and the `sidebar/index.tsx` call site — no dead prop threading survives
- [x] A-019 R10: `STRIPE_EDGE_INSET`, `LABEL_ZONE_WIDTH`, `ICON_ZONE_WIDTH`, and `ICON_EDGE_INSET` are deleted, not zeroed
- [x] A-020 R15: `grep -rn "MARKER_STATES\|markerStripeStyle" app/frontend` returns nothing
- [x] A-021 R16: The full removal sweep over `app/frontend` (src **and** tests) leaves no unjustified hit for `Set tab label`, `LabelZone`, `MARKER_STATES`, `markerStripeStyle`, `coarse:pl-4`, or `status-dot-tap`

### Scenario Coverage

- [x] A-022 R7: `marker.test.ts` covers all nine mode × stage pairs for `markerFillStyle` plus `MarkerChevrons` count and width
- [x] A-023 R16: One dedicated test feeds a legacy value through the restore write path and asserts the normalized result; the three named snapshot fixtures carry current-vocabulary values
- [x] A-024 R16: `window-marker-gutter.spec.ts` sets markers via the `_tmux` helper and asserts well rendering; `row-flyout.spec.ts` covers the rail-only coarse trigger; `legacy-color-sweep.spec.ts` opens the picker from the card
- [x] A-025 R16: Every touched Playwright `test()` carries an updated `Proves:` / `Steps:` JSDoc, and each touched spec file's header comment matches its current setup. **Scope note (verified, do not re-litigate)**: the header block sits AFTER the imports in 71 of this repo's 87 e2e specs — that placement is the repo convention and satisfies the constitution. `row-flyout.spec.ts` (header at its top-of-body block) and `legacy-color-sweep.spec.ts` (header at lines 11-20, covering `beforeAll`/`afterAll`) already conform and MUST NOT be restructured. `window-marker-gutter.spec.ts` now covers its describe-scoped hooks, timestamped session fixture, tmux/read helpers, local pollers, viewport, and route-stub posture.

### Edge Cases & Error Handling

- [x] A-026 **N/A**: R1 explicitly preserves trim-before-normalize at the live read seam, so padded valid tokens remain valid; raw padded or unknown values still collapse through `NormalizeMarker`.
- [x] A-027 R7: `markerFillStyle` for `blocked` uses a non-repeating `linear-gradient(45deg, …)` on a `12px 12px` tile — never a `repeating-linear-gradient` (the 12/√2 phase-alignment constraint)
- [x] A-028 R3: A snapshot written *after* this change round-trips unchanged (normalizing an already-current value is the identity)

### Code Quality

- [x] A-029 Pattern consistency: New code follows the naming and structural patterns of surrounding code — `--color-marker-ink` follows the `--color-signal-yellow` token pattern, and the well follows the overlay-owns-clip discipline (dedicated absolutely-positioned inner element, `pointer-events-none`, never `overflow-hidden` on the row root)
- [x] A-030 No unnecessary duplication: the marker vocabulary lives only in `marker.tsx` — no fill widths, chevron geometry, or well alphas are restated at a consumer
- [x] A-031 Comment hygiene: comments **this change adds or modifies** carry no plan/change IDs (`R#`/`T###`/`A-###`), no PR numbers, and no removed-feature narration; comments outside the change's own lines are left alone
- [x] A-032 Magic numbers: the well width, stage widths, chevron geometry, and well alphas are named constants, not inline literals at their consumers
- [x] A-033 No god functions: `window-row.tsx` is net smaller after the retirements; no new function exceeds a clear-purpose size

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Copy source is `pr767` (fetched: `790120eb`). Copied code carries #767's bugs unless the intake's
  known-traps section says otherwise — read it before trusting a hunk, and never carry #767's
  unrelated `globals.css` comment rewrites.
- e2e invocations run **one at a time**; a second run started during the first's teardown fails with a
  real-looking `ECONNREFUSED`.

## Deletion Candidates

- `app/frontend/src/api/client.ts:setWindowMarker` — removing the marker write prop threading leaves this exported wrapper with no in-tree call sites until a future write surface deliberately reintroduces one.
- `app/frontend/src/components/swatch-popover.test.tsx:257` — the composite-preview `borders` fixture lost its final assertion when marker preview coverage was removed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The read-path flips (T001–T003) land before the vocabulary narrows (T005) | Narrowing first would make `parseWindows` drop every legacy value to `""` for the duration, briefly blanking marked rows on live servers | S:85 R:75 A:95 D:90 |
| 2 | Certain | `markerFillStyle` returns `undefined` for `auto`, and the row renders chevrons instead | Copied verbatim from #767's shipped renderer, which the design studies fix as canonical; a fill plus chevrons would double-paint stage width | S:90 R:85 A:95 D:90 |
| 3 | Certain | The well is `aria-hidden` and `pointer-events-none` | It is display-only in this phase; the row's existing overlay discipline (hazard, flair) already uses exactly this shape, and a focusable or hittable well would pre-empt phase 3's press target | S:85 R:85 A:95 D:90 |
| 4 | Confident | `themes.ts`'s marker deletion (T020) is ordered after the popover's band removal (T019) | `swatch-popover.tsx` is `markerStripeStyle`'s last consumer; deleting the export first leaves the tree un-typecheckable between tasks | S:75 R:90 A:90 D:80 |
| 5 | Confident | `snapshot_test.go` is checked and migrated only if its `"solid"` fixtures cross a normalizing path | It round-trips Go structs through JSON without touching `layout.go` or `restore.go`, so it likely passes untouched — but a retired token left in a fixture is the "did anything stale survive" failure this phase asks about | S:60 R:85 A:70 D:65 |
| 6 | Confident | The `status-dot-tap` testid survives as a plain wrapper rather than being deleted or renamed | The dot still needs a wrapper element and `row-flyout.spec.ts` targets that testid; renaming it in the same change would churn a selector for no behavioural gain, though the name now describes behaviour that is gone | S:50 R:80 A:70 D:60 |
| 7 | Confident | Text-colour hover treatments survive R12's hover-shade removal | The plan's wording is "plain hover no longer shades the row **background**"; the text-brightening arm carries affordance information and is not a background layer competing with the well's wash | S:70 R:85 A:80 D:70 |

7 assumptions (3 certain, 4 confident, 0 tentative).
