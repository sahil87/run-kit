# Plan: Mobile switch-to-tile verb + tile-verb palette vocabulary rename

**Change**: 260816-ox16-mobile-tile-switch-vocab
**Intake**: `intake.md`

## Requirements

### Surface Layout: The switch-to-tile verb

#### R1: Switch-to-tile semantics
The app SHALL provide a switch-to-tile verb `switchToTile(surface)` (in `app/frontend/src/app.tsx`) with two arms:
- If `surface` is already in `renderLayout.order` → set the transient mobile slot state (`setMobileSlotA(surface)`) — no `applyLayout`, no URL/localStorage write (spec surface-layout.md L3 discipline).
- Else (available but not open) → `switchView(surface)` → `applyLayout({shape:"single", order:[surface]})` — the existing palette `View:` path, so per-window localStorage persistence, URL mirroring, and code-folder latch seeding (which keys on `layout.order.includes("code")`) all apply unchanged.

- **GIVEN** a mobile viewport on a window with layout `single:tty` and a non-empty `rkUrl`
- **WHEN** the user invokes switch-to-tile for `web`
- **THEN** the layout becomes `single:web` via `applyLayout` (localStorage written, URL mirrored as `?layout=` per the clean-URL default rule)

- **GIVEN** a mobile viewport arriving at a `?layout=main-left:tty,code,web` deep link (slot A `tty` visible)
- **WHEN** the user invokes switch-to-tile for `web`
- **THEN** the web tile renders full-width via transient state only — the URL and `rk-layout:` localStorage are untouched

### Top Bar: Mobile switch group

#### R2: Mobile render fork of the surface-toggles group
The top-bar `surface-toggles` registry entry SHALL render on the mobile terminal route (today it is registered only when `!isMobile`, app.tsx:3610). The `surfaceToggles` slot prop gains a mode discriminant: desktop passes toggle mode (today's open-tile add/close semantics, unchanged); mobile passes switch mode with the visible surface (`mobileActiveTile`) and the switch-to-tile callback. In switch mode `SurfaceToggleGroup` (top-bar.tsx) SHALL render one button per available surface not in `SURFACE_RAIL_HIDDEN` (chat renders no button), `tty` first, with radio semantics: `aria-pressed` on exactly the visible surface, tap on a non-pressed button runs switch-to-tile, tap on the pressed button is a no-op. The disabled-at-3 state MUST NOT apply in switch mode (switching never adds a fourth tile). The group renders on mobile only when ≥2 surfaces are shown after the `SURFACE_RAIL_HIDDEN` filter; with fewer it renders nothing there.

- **GIVEN** a 375px viewport on a terminal route whose window offers `tty`+`web`
- **WHEN** the top bar renders
- **THEN** the `surface-toggles` group shows the `>_` and `://` buttons with the visible surface pressed
- **AND** tapping the other button switches the rendered surface per R1

- **GIVEN** the same viewport on a window offering only `tty`
- **WHEN** the top bar renders
- **THEN** no surface-toggles group renders

#### R3: Mobile pinning, dots, and no menu rows
On mobile the `surface-toggles` entry SHALL be exempt from the overflow fit pipeline (pinned in-bar, like the trailing chevron's exemption; other candidates drop first) and SHALL register no overflow-menu rows there (`SurfaceToggleMenuRows` stays desktop-only — the misleading add-a-tile checkbox path on mobile is removed by construction). The per-button corner availability dot carries over to switch mode. The present auto-expand reaction remains render-only: a transiently auto-opened `web` surface reads as an unpressed button (reachable by tap), and the visible tile is NEVER auto-swapped (R13 rule preserved).

- **GIVEN** a 375px viewport with the switch group present and other right-cluster chips overflowed
- **WHEN** the fit pipeline runs
- **THEN** the group stays in-bar and the chevron menu carries no Tiles rows

### Mobile Sheet: Retirement

#### R4: Remove the ▦ chip and mobile-surface-sheet
`app/frontend/src/components/mobile-surface-sheet.tsx` SHALL be deleted; the bottom bar's `surfaceSheet` prop, ▦ chip, and sheet mount (bottom-bar.tsx:~508–536, plus its `sheetOpen` state and the `MobileSurfaceSheet` import) SHALL be removed; app.tsx's `surfaceSheet` prop wiring (~3712–3728) SHALL be removed. The transient `mobileSlotA` state and `mobileActiveTile` derivation stay (they back R1's open arm). The bottom bar is otherwise unchanged.

- **GIVEN** a 375px viewport on a multi-tile layout
- **WHEN** the bottom bar renders
- **THEN** no `mobile-surfaces-chip` testid exists anywhere in the DOM, and switching happens via the top-bar group

### Palette: Tile vocabulary

#### R5: Rename show/hide/focus entries to `Tile:`
In `app/frontend/src/lib/palette-layout.ts`, the show/hide/focus entries SHALL be renamed at all widths: `layout-add-${kind}` / `Layout: Add <Surface>` → `tile-show-${kind}` / `Tile: Show <Surface>`; `layout-close-${kind}` / `Layout: Close <Surface>` → `tile-hide-${kind}` / `Tile: Hide <Surface>`; `layout-focus-${kind}` / `Layout: Focus <Surface>` → `tile-focus-${kind}` / `Tile: Focus <Surface>`. Chat's entries ride the rename (they remain chat's only entry points). The `⌘J` `code-toggle` hint (`toggleTarget`/`toggleShortcut`) stays on the code Show/Hide pair. `Layout:` retains only arrangement verbs: `Promote`, `Swap`, `Zoom`/`Unzoom`, per-shape jumps, `Cycle Shape` — ids `layout-promote-*`, `layout-swap-*`, `layout-zoom`/`layout-unzoom`, `layout-shape-*`, `layout-cycle` unchanged (the `layout-cycle` id is a registry actionId contract and MUST NOT change).

- **GIVEN** a desktop terminal route with a `single:tty` layout and `web` available
- **WHEN** the palette opens
- **THEN** it lists `Tile: Show Web` (id `tile-show-web`) and no `Layout: Add` entries exist

#### R6: `Tile: Switch to <Surface>` entries supersede `View:` on mobile
A pure builder SHALL produce mobile switch entries — one `Tile: Switch to <Surface>` action (id `tile-switch-${kind}`) per surface that is available, not `SURFACE_RAIL_HIDDEN`-hidden, and not the currently visible surface — invoking the R1 verb. On mobile the palette SHALL list these INSTEAD of the `View: Terminal/Web/Code/Chat` entries (`buildViewActions` output is desktop-only). Desktop `View:` actions, `src/lib/palette-view.ts`, and the `⌘.` view-cycle chord are untouched. Exception carried from the current model: chat is `SURFACE_RAIL_HIDDEN`, so mobile chat switching remains reachable via... nothing new — chat keeps its existing `Tile: Show/Hide Chat` (renamed R5) entries as its entry points on all widths; `Tile: Switch to Chat` is NOT emitted (the hidden-set filter applies).

- **GIVEN** a 375px viewport on a window offering `tty`+`web`, currently showing `tty`
- **WHEN** the palette opens
- **THEN** it lists `Tile: Switch to Web` and does NOT list `View: Web`
- **AND** on a 1440px viewport the same window lists `View: Web` and no `Tile: Switch` entries

### Docs: Spec amendment

#### R7: surface-layout.md Mobile section
`docs/specs/surface-layout.md` § Mobile SHALL be amended: the sheet pattern is replaced by the top-bar switch group (availability-driven, radio semantics, switch-to-tile's two arms), the "slot A + tabs" language updated to "slot A + top-bar switch group", and the never-auto-swap rule retained. The § Verbs table gains the switch-to-tile verb with its mobile-primary scope.

- **GIVEN** the amended spec
- **WHEN** a reader checks § Mobile
- **THEN** it describes the shipped top-bar switch group and no longer prescribes the sheet

### Non-Goals

- Desktop `View:` family rename (`Tile: Solo <X>`) — explicitly deferred to a later pass.
- Any new chord for switch-to-tile — the `⌘.` cycle already covers keyboard switching; the mobile verb is touch-primary with palette parity.
- Swipe-gesture switching — rejected (xterm touch-scroll and iframe scroll conflicts); possible later sugar.
- Bottom-bar switcher — rejected (the bottom bar does not render on the web lens; would strand the user).

### Design Decisions

#### 375px budget is fixed forward, not designed around
**Decision**: Ship the segmented switch group as designed; if the retained 375px single-line/no-overflow e2e assertions fail, fix within the design (spacing, truncation room, dropping the group's trailing divider on mobile) rather than silently substituting the single cycle-button fallback.
**Why**: The fallback was an intake contingency, not a second design; auto-substituting it mid-apply would ship a different UX than the one agreed. A genuine impossibility surfaces as a failed task for escalation.
**Rejected**: Auto-substitution of the cycle button — silently changes the shipped affordance; a human should make that call.
*Introduced by*: 260816-ox16-mobile-tile-switch-vocab

#### Overflow Tiles rows are desktop-only by construction
**Decision**: Mobile registers no `menuRender` for the surface-toggles entry (and the entry is overflow-exempt there), so the chevron menu's Tiles section simply never exists on mobile; desktop rows are unchanged (their row text "<Label> tile" carries no Add/Close wording, so no relabel is needed).
**Why**: The pinned in-bar group is the primary mobile affordance; checkbox add/close rows beside a radio group would reintroduce the misleading add-a-tile path this change removes. Today's mobile already renders no rows (the prop was `!isMobile`-gated), so this preserves observed behavior while making it deliberate.
**Rejected**: Relabeling the rows Show/Hide on mobile — keeps two competing affordances for one action; suppressing only rows but letting the group overflow — an overflowed pinned group would strand switching entirely.
*Introduced by*: 260816-ox16-mobile-tile-switch-vocab

## Tasks

### Phase 1: Pure libs

- [x] T001 Rename show/hide/focus palette entries in `app/frontend/src/lib/palette-layout.ts`: ids `layout-add-*`→`tile-show-*`, `layout-close-*`→`tile-hide-*`, `layout-focus-*`→`tile-focus-*`; labels `Layout: Add/Close/Focus`→`Tile: Show/Hide/Focus`; keep `layout-zoom`/`layout-unzoom`/`layout-promote-*`/`layout-swap-*`/`layout-shape-*`/`layout-cycle` ids+labels; keep `toggleHint` on the code pair; update header comment; update `app/frontend/src/lib/palette-layout.test.ts` expectations <!-- R5 -->
- [x] T002 Add `buildTileSwitchActions(available, visible, onSwitch)` to `app/frontend/src/lib/palette-layout.ts` (filter `SURFACE_RAIL_HIDDEN`, exclude `visible`, ids `tile-switch-${kind}`, labels `Tile: Switch to <Surface>`) with unit tests in `palette-layout.test.ts` <!-- R6 -->

### Phase 2: Components + app wiring

- [x] T003 In `app/frontend/src/app.tsx`: add `switchToTile(surface)` (open→`setMobileSlotA`, else `switchView`); extend the slot's `surfaceToggles` registration (~3610) to mobile with a mode discriminant (`mode:"switch"`, `active: mobileActiveTile`, `onSwitch: switchToTile`, gated on ≥2 shown surfaces) while desktop keeps `mode:"toggle"` semantics unchanged <!-- R1 -->
- [x] T004 In `app/frontend/src/components/top-bar.tsx`: teach `SurfaceToggleGroup` switch mode (radio semantics — pressed = active, no disabled-at-3, availability dots kept); make the `surface-toggles` registry entry overflow-exempt on mobile and register no `menuRender` there (`SurfaceToggleMenuRows` desktop-only); update the group's doc comment <!-- R2 -->
- [x] T005 In `app/frontend/src/app.tsx` palette assembly: gate `buildViewActions` output to desktop; on mobile emit `buildTileSwitchActions(panelSurfaces, mobileActiveTile, switchToTile)` instead <!-- R6 -->
- [x] T006 Delete `app/frontend/src/components/mobile-surface-sheet.tsx`; remove the ▦ chip, `sheetOpen` state, `surfaceSheet` prop, and `MobileSurfaceSheet` import from `app/frontend/src/components/bottom-bar.tsx`; remove the `surfaceSheet` wiring from `app/frontend/src/app.tsx` (~3712–3728); keep `mobileSlotA`/`mobileActiveTile` <!-- R4 -->

### Phase 3: Tests

- [x] T007 Update `app/frontend/tests/e2e/right-panel.spec.ts` (375px case: group now PRESENT with radio semantics, no `mobile-surfaces-chip`) and `tests/e2e/surface-layout.spec.ts` (3-tile deep-link case: slot A + top-bar switch group, transient swap leaves URL/localStorage untouched) + both `.spec.md` companions <!-- R2 -->
- [x] T008 Add mobile switch-to-tile e2e coverage (extend `tests/e2e/web-view-lens.spec.ts` 375px block or the surface-layout mobile block): tty→web one-tap switch on `single:tty` persists `single:web`; retained single-line/no-overflow assertions at 375px with a long window name pass with the group present; palette shows `Tile: Switch to Web` on mobile and `View: Web` on desktop; update `.spec.md` <!-- R1 -->
- [x] T009 Sweep remaining e2e/unit matchers for renamed ids/labels (`chat-view.spec.ts` chat-entry references, `code-surface.spec.ts` `View: Code`/Add-Close references, any `Layout: Add|Close|Focus` greps) + `.spec.md` companions; `cd app/backend && go test ./...` untouched-check <!-- R5 -->

### Phase 4: Docs

- [x] T010 Amend `docs/specs/surface-layout.md` § Mobile (sheet → top-bar switch group, switch-to-tile verb in § Verbs, never-auto-swap retained) <!-- R7 -->

## Execution Order

- T001, T002 first (pure libs; T002 depends on T001's file state)
- T003 → T004 → T005 (app wiring before top-bar consumption before palette assembly); T006 independent after T003
- T007–T009 after Phase 2; T010 anytime after T004

## Acceptance

### Functional Completeness

- [x] A-001 R1: `switchToTile` exists with both arms — open→transient (`setMobileSlotA`), not-open→`switchView` — and is the only mobile switch path
- [x] A-002 R2: at 375px the `surface-toggles` group renders on terminal routes with ≥2 shown surfaces, radio semantics, chat filtered; absent with <2
- [x] A-003 R3: the group never overflows on mobile and the chevron menu has no Tiles rows there; availability dots render in switch mode
- [x] A-004 R4: `mobile-surface-sheet.tsx` deleted; no `mobile-surfaces-chip` testid in the DOM at any width; bottom bar otherwise unchanged
- [x] A-005 R5: palette ids/labels are `tile-show-*`/`tile-hide-*`/`tile-focus-*` with `Tile:` labels; `layout-cycle` and arrangement ids unchanged; `⌘J` hint on code pair
- [x] A-006 R6: mobile palette lists `Tile: Switch to <X>` (no `View:` entries); desktop lists `View:` entries (no `Tile: Switch` entries); no `tile-switch-chat` ever
- [x] A-007 R7: `docs/specs/surface-layout.md` § Mobile describes the top-bar switch group, not the sheet

### Behavioral Correctness

- [x] A-008 R1: switching to a not-open surface writes `rk-layout:` localStorage and mirrors the URL; switching to an open surface on a multi-tile deep link writes neither
- [x] A-009 R3: a present auto-expand transition renders the web button unpressed-with-dot and never auto-swaps the visible tile

### Removal Verification

- [x] A-010 R4: no references to `MobileSurfaceSheet`, `surfaceSheet`, or the sheet testids remain in src/ or tests/ (the `mobile-surfaces-chip` string survives ONLY as `toHaveCount(0)` absence assertions — the verification mechanism for A-004, not a live reference)
- [x] A-011 R5: no `layout-add-`, `layout-close-`, `layout-focus-` ids or `Layout: Add/Close/Focus` labels remain in src/ or tests/ (remaining `Layout: Add|Close|Focus` matches are the negative assertions in `palette-layout.test.ts` proving the rename)

### Scenario Coverage

- [x] A-012 R1: e2e proves tty→web one tap at 375px on `single:tty` (persists) and transient swap on a 3-tile deep link (URL untouched)
- [x] A-013 R2: retained 375px single-line top-bar/no-horizontal-overflow assertions pass with the group present (long window name case)

### Edge Cases & Error Handling

- [x] A-014 R2: tapping the pressed button is a no-op; a surface leaving availability (e.g. `rkUrl` cleared) degrades the group per existing availability derivation without a crash
- [x] A-015 R6: single-surface windows emit no `Tile: Switch` entries and no mobile group

### Code Quality

- [x] A-016 Pattern consistency: switch mode reuses `SURFACE_GLYPH`/`SURFACE_LABEL`/`Tip`/aria patterns; pure builders stay DOM-free with colocated tests
- [x] A-017 No unnecessary duplication: no new component tree for the mobile group; `switchToTile` composes existing `setMobileSlotA`/`switchView`
- [x] A-018 Frontend type check passes (`cd app/frontend && npx tsc --noEmit`); no `as` casts added (type narrowing per code-quality.md — the two `mode: "…" as const` additions are discriminated-union literals, not narrowing-evading casts)
- [x] A-019 Tests-through-just rule respected: e2e via `just test-e2e "<spec>"`; every touched `.spec.ts` updates its `.spec.md` in the same commit (constitution)
- [x] A-020 No client polling introduced; no new routes/params (Constitution IV)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change's planned removals (`mobile-surface-sheet.tsx`, the bottom-bar ▦ chip + `surfaceSheet` prop wiring, the sheet unit tests) were executed in the diff; review found no further code the change makes redundant (`mobileSlotA`/`mobileActiveTile` are retained deliberately per plan assumption 5 — they back the switch verb's open arm and `focusedTileKind`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | 375px budget failures are fixed within the segmented-group design (spacing/truncation); no auto-substitution of the cycle-button fallback — genuine impossibility stops as a failed task | Resolves intake Unresolved #10: auto-swapping designs mid-apply ships an unagreed UX; escalation path exists (pipeline stop) | S:60 R:75 A:70 D:65 |
| 2 | Confident | Overflow Tiles rows: desktop-only by construction (mobile registers no menuRender + overflow-exempt entry); desktop rows unchanged, no relabel needed (row text carries no Add/Close wording) | Resolves intake Unresolved #11: today's mobile already renders no rows (`!isMobile` prop gate), so suppression preserves observed behavior while removing the misleading path | S:65 R:80 A:75 D:70 |
| 3 | Confident | The mode discriminant lives on the `surfaceToggles` slot prop (`mode: "toggle" \| "switch"` + `active`/`onSwitch`), not a new registry entry | One entry keeps the probe/fit single-slot measurement and the group's internal order; the fork is a render branch, matching the intake's "render fork, not a new component tree" | S:70 R:85 A:80 D:75 |
| 4 | Confident | `Tile: Switch to Chat` is never emitted (hidden-set filter applies to the new builder), keeping chat palette-only via its renamed Show/Hide entries | Mirrors the existing `SURFACE_RAIL_HIDDEN` render-time filter contract everywhere else (toggles, sheet); un-hiding chat is a one-line set edit later | S:70 R:90 A:80 D:75 |
| 5 | Certain | `mobileSlotA`/`mobileActiveTile` state survives the sheet deletion (it backs the switch verb's open arm and `focusedTileKind`) | Direct code dependency at app.tsx:986/1005; removing it would break focus-kind derivation | S:85 R:80 A:90 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
