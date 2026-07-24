# Plan: Mobile Chrome Polish

**Change**: 260724-2bmy-mobile-chrome-polish
**Intake**: `intake.md`

## Requirements

### Top Bar: Left-Cluster Alignment

#### R1: Panel toggle and brand crumb share the sibling chip geometry
The sidebar/panel toggle (hamburger) MUST carry the same bordered-chip treatment as its sibling controls (`rounded border border-border hover:border-text-secondary`, keeping its existing `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]` box and `rk-glint` hover), and `HamburgerIcon` MUST shrink from 20px to 16px so its optical size matches the ~13–14px icons inside neighboring chips. The brand crumb (`a[aria-label="RunKit home"]`) MUST be normalized to the shared control height via `min-h-[24px] coarse:min-h-[30px]`. The Notion-style open/closed fill behavior of the icon MUST be unchanged, and the right-cluster overflow registry/fit machinery MUST NOT be touched.

- **GIVEN** the terminal route at 375×812 with a coarse pointer
- **WHEN** the top bar renders
- **THEN** the panel toggle is a bordered chip whose box (30×30) and icon scale match the HistoryNav arrows beside it
- **AND** the brand crumb's height is 30px so the left cluster sits on one horizontal axis

### Compose Strip: Two-Row Stack

#### R2: Textarea gets its own full-width row with a 2-line default
`compose-strip.tsx` MUST restructure the single `flex items-end gap-1.5` row into two rows inside the existing `TipGroup`: row 1 is the textarea alone, full width (`w-full`), with `rows={2}` (desktop too, per explicit user direction); row 2 holds the buttons — 📎 on the left, a spacer, Insert and Send on the right. The bounded auto-grow (`MAX_TEXTAREA_ROWS = 6`, scrollHeight-based `resize()`) MUST keep working with the new 2-row floor (no re-collapse to 1 line after typing + deleting). The `→ target` header row, × close, attachment previews, Enter policy (`classifyComposeEnter`), focus rules, upload/re-home logic, and the module draft store MUST be untouched.

- **GIVEN** the compose strip enabled at 375px
- **WHEN** the strip renders empty
- **THEN** the textarea spans (near-)full row width at a 2-line height and the 📎/Insert/Send buttons sit on their own row below
- **GIVEN** a draft grown to 5 lines
- **WHEN** the user deletes back to one character
- **THEN** the textarea settles at the 2-row default, never 1 line

### Sidebar Rows: One Icon System + Real Touch Targets

#### R3: Session/window row action buttons use one stroke-SVG icon system with uniform geometry
The text-glyph `+` and `✕` buttons MUST be replaced with stroke SVG icons in `sidebar/icons.tsx` matching the `PaletteIcon`/`BotIcon` convention (24-unit viewBox, `strokeWidth={2}`, 13px default size, `aria-hidden`): new `PlusIcon` and `CloseIcon`. All four session-row buttons (palette, bot, +, ✕) MUST share the same padding and real minimum widths — `min-w-[24px] coarse:min-w-[32px]` alongside the existing `min-h-[24px] coarse:min-h-[36px]` (verify against the 375px drawer with a long session name; drop to 28–30px only if the name column is crushed, never below 28). `BotIcon` MUST be optically re-centered (viewBox/translate nudge; rendered box stays 13px). The window row's kill ✕ and pin buttons MUST receive the same treatment (SVG ✕, uniform padding, `min-w` touch sizing). Hover-reveal behavior (`opacity-0 group-hover:opacity-100 coarse:opacity-100`, window-row `pointer-events-none` at rest) and all handlers/ARIA MUST be unchanged.

- **GIVEN** a hovered session row on desktop
- **WHEN** the icon cluster reveals
- **THEN** all four icons render at the same stroke weight/13px scale with even optical gaps, and each button is ≥24px wide
- **GIVEN** the mobile drawer (coarse pointer)
- **WHEN** a session row renders
- **THEN** each action button is ≥32px wide and ≥36px tall

### Bottom Bar: Safe-Area Inset

#### R4: Bottom bar rides above the phone corner arc when the keyboard is collapsed
`index.html`'s viewport meta MUST append `viewport-fit=cover` (keeping `interactive-widget=resizes-content`). The bottom-bar toolbar row (`bottom-bar.tsx`, the `py-1.5` row) MUST split its vertical padding into `pt-1.5` + `pb-[max(0.375rem,env(safe-area-inset-bottom))]` — CSS-only, no JS keyboard detection. The top-bar `<header>` MUST gain a `pt-[env(safe-area-inset-top)]` guard so standalone-PWA mode never tucks the bar under the status bar/clock. On browsers/desktop `env()` is 0, so there is no visual change.

- **GIVEN** an iPhone-class device with the keyboard collapsed
- **WHEN** the bottom bar renders
- **THEN** its bottom padding resolves to `max(6px, safe-area-inset-bottom)` and the extreme chips clear the corner arc
- **GIVEN** the keyboard is open (`interactive-widget=resizes-content` shrinks the layout viewport)
- **WHEN** the bar rides above the keyboard
- **THEN** `env(safe-area-inset-bottom)` is consumed by the OS and padding returns to 6px

### Non-Goals

- No changes to the right-cluster overflow registry/fit machinery in `top-bar.tsx`
- No new e2e spec (no new `.spec.ts` → Test Companion Docs rule not triggered)
- No JS keyboard/`visualViewport` detection for the safe-area fix
- No backend, API, route, or handler/ARIA changes

## Tasks

### Phase 1: Core Implementation

- [x] T001 [P] `app/frontend/src/components/top-bar.tsx` — give the hamburger button the bordered-chip classes (`rounded border border-border hover:border-text-secondary`), shrink `HamburgerIcon` to 16px, add `min-h-[24px] coarse:min-h-[30px]` to the brand crumb anchor <!-- R1 -->
- [x] T002 [P] `app/frontend/src/components/compose-strip.tsx` — restructure the input row into a two-row stack (full-width `rows={2}` textarea; 📎 left / Insert+Send right on a button row), keep auto-grow + all behavior <!-- R2 -->
- [x] T003 [P] `app/frontend/src/components/sidebar/icons.tsx` — add `PlusIcon` and `CloseIcon` (24-unit viewBox, `strokeWidth={2}`, 13px default, `aria-hidden`); optically re-center `BotIcon` via a viewBox nudge <!-- R3 -->
- [x] T004 `app/frontend/src/components/sidebar/session-row.tsx` — swap `+`/`✕` text glyphs for `PlusIcon`/`CloseIcon`, unify padding (`px-0.5`) and add `min-w-[24px] coarse:min-w-[32px]` on all four action buttons <!-- R3 -->
- [x] T005 `app/frontend/src/components/sidebar/window-row.tsx` — same treatment on the pin/kill cluster: `CloseIcon` for ✕, uniform `px-0.5`, `min-w-[24px] coarse:min-w-[32px]` <!-- R3 -->
- [x] T006 [P] `app/frontend/index.html` + `app/frontend/src/components/bottom-bar.tsx` + `app/frontend/src/components/top-bar.tsx` — append `viewport-fit=cover` to the viewport meta; split the toolbar row's `py-1.5` into `pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]`; add `pt-[env(safe-area-inset-top)]` to the top-bar `<header>` <!-- R4 -->

### Phase 2: Tests & Verification

- [x] T007 Update/extend colocated unit tests: `compose-strip.test.tsx` (textarea `rows={2}` + button-row structure), `session-row.test.tsx` / `window-row.test.tsx` (SVG icons render in place of text glyphs); run `just test-frontend` <!-- R2, R3 -->
- [x] T008 Playwright measurement pass (scratchpad `shots.mjs`/`row-measure.mjs` against :3020, mobile 375×812 `hasTouch` + desktop 1280×800): toggle/brand/chips on one 30px axis; textarea ≥ ~90% row width at 2-line default; sidebar buttons ≥24px (fine) / ≥32px (coarse) wide with even optical gaps; bottom-bar `pb` computed as `max(6px, env(...))` <!-- R1, R2, R3, R4 -->
- [x] T009 Run affected e2e specs via `just test-e2e` (`compose-strip`, `bottom-bar-chip-size`, `tooltips`, sidebar-touching specs); triage known pre-existing flakes per project memory <!-- R1, R2, R3, R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The hamburger toggle renders as a bordered chip with a 16px icon and the brand crumb carries `min-h-[24px] coarse:min-h-[30px]`; right-cluster overflow machinery untouched — verified `top-bar.tsx:811` (bordered chip), `:158-159` (16px), `:844` (crumb min-h); measured mobile toggle 30×30 @y=10, brand 30h @y=10, HistoryNav arrows 30×30 @y=10 (one axis); hamburger SVG 16×16
- [x] A-002 R2: The compose strip renders a full-width `rows={2}` textarea on its own row with 📎/Insert/Send on a second row; all send/upload/draft behavior unchanged — measured 375px: textarea 363px wide (100% of row) × 44px; buttons on row 2 (📎 x=6, Insert x=246.7, Send x=314.1); desktop 1048px/100%; all 5 compose-strip e2e + 27 compose-strip unit tests green
- [x] A-003 R3: `PlusIcon`/`CloseIcon` exist in `sidebar/icons.tsx` per the file's icon convention and replace the text glyphs in session and window rows; all four session-row buttons share padding and `min-w-[24px] coarse:min-w-[32px]` — `icons.tsx:113`/`:135` follow the 24-viewBox/strokeWidth=2/13px/aria-hidden convention; measured coarse: all four session-row buttons exactly 32×36 with 13px SVGs, window-row pin+kill 32×36
- [x] A-004 R4: `viewport-fit=cover` is in the viewport meta; the bottom-bar row uses `pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]`; the top-bar header has the `pt-[env(safe-area-inset-top)]` guard — verified `index.html:5`, `bottom-bar.tsx:299`, `top-bar.tsx:782`; computed toolbar `pt:6px / pb:6px` where `env()`=0

### Behavioral Correctness

- [x] A-005 R2: Auto-grow floor respects the 2-row default — growing to >2 lines and deleting back settles at 2 rows, never 1 — measured live: 5 lines → 92px, back to 1 char → 44px, emptied → 44px (`style.height=44px`); desktop 8 lines → 96px (6-row cap, `overflowY:auto`) → back to 44px. `height="auto"` measurement resolves to the `rows={2}` box, so the floor holds
- [x] A-006 R3: Hover-reveal (`opacity-0 group-hover:opacity-100 coarse:opacity-100`) and window-row rest-state `pointer-events-none` semantics are byte-preserved; every handler and aria-label is unchanged — diff confirms only sizing/padding classes changed on those buttons; `window-row.tsx:422` cluster `pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto` untouched; no `onClick`/`aria-label` line appears in the diff

### Scenario Coverage

- [x] A-007 R1: Playwright mobile measurement confirms toggle, brand crumb, and neighbor chips share one 30px horizontal axis — independently re-measured (375×812, `hasTouch`): toggle {y:10,h:30}, brand {y:10,h:30}, Back {y:10,h:30}, Forward {y:10,h:30} — identical y and height
- [x] A-008 R3: Playwright measurement confirms even optical icon gaps and ≥32px coarse touch widths without crushing the name column at 375px with a long session name — session-row button centers 199/231/263/295 (exactly 32px apart, zero variance) at 32×36 each; name column keeps 163.8px of the 319px row; longest window name observed ends at x=173 vs the 32×36 window-row cluster starting at x=243 (no overlap)
- [x] A-009 R4: Computed bottom padding on the toolbar row resolves via `max(0.375rem, env(safe-area-inset-bottom))` (6px where `env()` is 0) — computed `paddingBottom: 6px`, `paddingTop: 6px` on the `[role=toolbar][aria-label="Terminal keys"]` row in Chromium (env()=0); the `max()` arm is Tailwind-compiled from the class at `bottom-bar.tsx:299`

### Edge Cases & Error Handling

- [x] A-010 R2: Disabled "no target" state, guard-blocked send, and attachment re-home flows still pass their existing unit tests after the DOM restructure — full `just test-frontend` green (1878 tests / 106 files), including the pre-existing compose-strip no-target, guard-block, and re-home cases; `tsc --noEmit` clean

### Code Quality

- [x] A-011 Pattern consistency: New icons follow the documented `sidebar/icons.tsx` convention; chip classes reuse the established bordered-chip vocabulary (`LINK_CRUMB_CLASS`/`HistoryNav` style); `coarse:` variant used for all touch sizing — `PlusIcon`/`CloseIcon` match `PaletteIcon`/`GearIcon`/`BotIcon` exactly (24-viewBox, strokeWidth=2, 13px default, `aria-hidden`, `currentColor`); effective stroke 2÷24×13 ≈ 1.08px preserves the documented weight parity with `PinIcon` (1.5÷16×12 ≈ 1.125px). BotIcon viewBox nudge verified: palette ink center lands at the 13px box center (6.5px), bot head center was 1.08px low and is now 0.27px low, with 0.27px top clearance (antenna dot not clipped)
- [x] A-012 No unnecessary duplication: No new utilities where existing classes/components suffice; tests run only via `just` recipes — both new icons have live call sites (`session-row.tsx:257`/`:266`, `window-row.tsx:459`); no pre-existing Plus/Close icon component was duplicated; all test runs used `just test-frontend` / `just test-e2e`
- [x] A-013 Tests: Changed behavior is covered by updated colocated unit tests (`just test-frontend` green); affected e2e specs pass or fail only on documented pre-existing flakes — `just test-frontend` 1878/1878 green. E2E: compose-strip 5/5, bottom-bar-chip-size 2/2, tooltips 5/5, mobile-layout 4/4, sidebar-keyboard-nav 5/5, session-tiles 1/1. `sidebar-panels` "Host panel shows real system metrics via SSE" fails — **proven pre-existing** by re-running it with the change stashed (identical `text=0/0` strict-mode violation on the clean baseline)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/sidebar/index.tsx:1748,1758` — the server-group header's `+` and `✕` **text glyphs** (`text-[13px] px-1`) are now the last instances of the mixed-glyph cluster this change replaced one level down; they sit in the same panel directly above the fixed session rows, and the file's own comment at `:1722` says they mirror "the session row's + ✕ pair". Replace with `PlusIcon`/`CloseIcon` (follow-up, see review should-fix).
- `app/frontend/src/components/top-bar.tsx:2403` — remaining `✕` text glyph on a top-bar control; candidate for `CloseIcon` if the one-icon-system convention is extended past the sidebar (out of this change's stated scope).
- No dead code was created by this change: both new icons have live call sites, no function/branch became unreachable, and no existing class or component was superseded (the `min-h`-only variants were edited in place, not left behind).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Uniform padding on sidebar action buttons is `px-0.5` (the palette/bot value), with `min-w` carrying the touch target | Intake mandates "same padding on all four" without picking a value; `px-0.5` + explicit `min-w` keeps buttons compact on fine pointers while meeting targets | S:55 R:90 A:85 D:75 |
| 2 | Confident | BotIcon optical nudge = viewBox y-shift (`0 1.5 24 24`), shifting the drawing up ~0.8px at 13px | Head body center sits at y=14 vs the palette's ~12 in the 24-unit box; a viewBox shift keeps the rendered box 13px exactly as the intake requires, no wrapper classes | S:60 R:90 A:80 D:75 |
| 3 | Confident | Window-row kill icon uses the shared 13px `CloseIcon` default (was a 14px text glyph) | One icon system means one size; 13px matches PaletteIcon/BotIcon/PinIcon cluster scale | S:55 R:90 A:85 D:80 |
| 4 | Confident | Brand-crumb `min-h` lands on the brand anchor only, not inside `LINK_CRUMB_CLASS` | The server crumb (other `LINK_CRUMB_CLASS` consumer) is an inline truncating link where `min-h` is inert without flex display; the measured defect is the brand crumb specifically | S:60 R:90 A:85 D:80 |
| 5 | Confident | Compose button row uses an `ml-auto` container grouping Insert+Send right of the 📎 | Intake allows "`ml-auto` or `flex-1`" spacer; a grouping container keeps Tip-wrapped buttons untouched | S:50 R:95 A:90 D:80 |

5 assumptions (0 certain, 5 confident, 0 tentative).
