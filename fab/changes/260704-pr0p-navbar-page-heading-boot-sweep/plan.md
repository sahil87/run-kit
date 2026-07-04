# Plan: Universal Top-Bar Page Heading with Boot Sweep

**Change**: 260704-pr0p-navbar-page-heading-boot-sweep
**Intake**: `intake.md`

## Requirements

### Top Bar: Universal center page-heading

#### R1: Center heading renders on every mode
The top-bar center cell SHALL render a `PageType: name` identity heading in all four modes (`terminal`, `board`, `root`, `cockpit`), replacing the terminal-only gate.

- **GIVEN** a terminal route (`mode="terminal"`) with a current window
- **WHEN** the top bar renders
- **THEN** the center cell shows `Terminal: <window-name>` where the name is the existing editable rename button, with the ▾ window switcher beside it
- **AND GIVEN** `mode="board"` **THEN** the center shows `Board: <board-name>` with a ▾ board switcher (name display-only, no rename)
- **AND GIVEN** `mode="root"` **THEN** the center shows `Server Cabin: <server-name>` (name display-only)
- **AND GIVEN** `mode="cockpit"` **THEN** the center shows the solo word `Cockpit` (no prefix, no instance name)

#### R2: Two-tone styling with static prefix sibling
The page-type prefix SHALL render `text-text-secondary` as a static sibling span OUTSIDE the rename button/input; the instance name SHALL keep `font-semibold text-text-primary`. The prefix uses a colon separator (`Terminal:`) in title case. A solo type word (Cockpit) SHALL render primary-medium (the PageHeading solo rule).

- **GIVEN** a terminal route
- **WHEN** the user clicks the prefix span
- **THEN** no inline edit starts (the edit input binds only to the name)
- **AND** the prefix is hidden below `sm`; the name keeps `max-w-[16ch]` and `coarse:min-h-[30px]`
- **AND GIVEN** cockpit **THEN** the solo `Cockpit` word stays visible at all breakpoints

#### R3: Combined boot-sweep animation
The center heading SHALL animate with ONE continuous left-to-right "boot sweep": a single inverse-video accent-green block cursor sweeps prefix + space + name at `DECODE_FRAME_MS` (28ms) per cell, reusing `DECODE_GLYPHS` and `prefersReducedMotion`.

- **GIVEN** motion is enabled and the cursor is over prefix cells
- **WHEN** a frame advances
- **THEN** cells right of the cursor are dim (`rk-typed-off`), the cursor cell shows the real char in inverse video (`rk-typed-cursor`), resolved cells settle to `text-secondary`
- **AND** the name cells to the right of the cursor churn `DECODE_GLYPHS` in accent-green from the START of the sweep (frame 0) — not only once the cursor reaches the name — each unresolved name cell churning every frame until the cursor's arrival LOCKS it to its true char; resolved (already-passed) name cells settle to semibold `text-primary`; spaces are preserved during churn. Prefix cells never churn — they dim (`rk-typed-off`) ahead of the cursor and type/settle to `text-secondary` behind it. *(Amended by re-review finding 260704-pr0p: the earlier prose "the churn starts only when the cursor reaches the name" contradicted the user-approved HTML demo — both the demo and the shipped code churn name cells right of the cursor from frame 0. Code matches demo.)*
- **AND GIVEN** hover **THEN** the sweep replays behind the 140ms `DECODE_HOVER_INTENT_MS` intent delay; mouseleave cancels and resolves to rest
- **AND GIVEN** mount/navigation (a displayed-name change) **THEN** the sweep plays once
- **AND GIVEN** `prefers-reduced-motion` **THEN** the sweep is skipped entirely (rest state IS the reduced-motion state)
- **AND GIVEN** cockpit (no instance name) **THEN** the typed sweep alone plays over the solo type word

#### R4: Preserve WindowHeading edit/rename guards
The boot sweep SHALL compose with the existing WindowHeading guards without regressing inline rename (mouse + palette `window-heading:rename` CustomEvent).

- **GIVEN** an inline edit is in progress
- **WHEN** the user is typing
- **THEN** the scramble is cancelled and the input binds to the real name state
- **AND GIVEN** the displayed name changes (rename commit / SSE external rename / window navigation) **THEN** the decode/sweep replays once
- **AND GIVEN** an external identity change (`server:windowId`) mid-edit **THEN** the stale edit is cancelled
- **AND** the heading instance is NOT remounted per window (no remount `key`)
- **AND GIVEN** the palette dispatches `window-heading:rename` **THEN** inline edit is entered

#### R5: Accessible names never churn
Decorative sweep cells SHALL be `aria-hidden` (or equivalent) and accessible names (rename button `aria-label`, section `<h2>` names) SHALL stay stable during animation.

- **GIVEN** the sweep is running
- **WHEN** a screen reader reads the heading
- **THEN** the rename button's `aria-label="Rename window <name>"` is unchanged and stable
- **AND** no `<h1>` is added to the top bar

### Top Bar: Left breadcrumb move-don't-copy

#### R6: Left breadcrumb ends at the parent in every mode
The left breadcrumb SHALL always end at the parent; the current-page leaf SHALL be the centered heading. A name SHALL never appear twice in the bar.

- **GIVEN** `mode="root"`
- **WHEN** the top bar renders
- **THEN** the server leaf crumb no longer renders in the left nav (it moved to the center); the left breadcrumb ends at brand + hamburger
- **AND GIVEN** `mode="board"` **THEN** the board name and ▾ switcher move to the center; the counts/hint string stays left; the left `Board ▸` home button is removed
- **AND GIVEN** `mode="terminal"` **THEN** the breadcrumb still ends at the session crumb (unchanged shape)

### Section headings: bracket idiom transfer

#### R7: Remove in-page PageHeading rows
The Cockpit PageHeading row (`server-list-page.tsx`) and the Server Cabin PageHeading row (`session-tiles.tsx`) SHALL be removed — page identity now lives in the top bar.

- **GIVEN** the Cockpit `/` renders
- **WHEN** the page body renders
- **THEN** no `[ cockpit ]` PageHeading row is present
- **AND GIVEN** the Server Cabin `/$server` **THEN** no `[ server cabin · name ]` PageHeading row is present

#### R8: Bracket section-heading component
A shared `SectionHeading` component SHALL carry the bracket idiom (`[` `]` brackets, always-reserved blinking caret cell `▊`, trailing horizontal rule, `rk-bracket-*` hover treatment) around a section label, keeping the TypedLabel typed-sweep INSIDE the brackets and `<h2>` semantics + uppercase styling. It SHALL support an optional right-aligned side slot after the rule.

- **GIVEN** the Server Cabin
- **WHEN** the Sessions section renders
- **THEN** it shows `[ SESSIONS▊ ]──── {N} sessions, {M} windows` with the stats right-aligned after the rule
- **AND GIVEN** a Cockpit zone (`Host Health`/`Boards`/`Tmux Servers`/`Services`) **THEN** it shows `[ LABEL▊ ]────` keeping the existing inline metadata (hostname, board count, etc.) and no relocated stats
- **AND** the label keeps its `<h2>` role and its TypedLabel typed-sweep hover
- **AND** brackets/caret/rule are decorative (`aria-hidden`), so the `<h2>` accessible name is just the label text

### Documentation

#### R9: Hover-vocabulary docs updated consistently
The `globals.css` vocabulary comment and `fab/project/context.md` (Conventions hover bullet + Mobile top-bar description) SHALL be updated so "decode = editable window identity" widens to the boot sweep as the top-bar page-heading treatment and "brackets+caret = page titles" becomes the section-heading treatment.

- **GIVEN** the docs
- **WHEN** a reader consults the hover-animation vocabulary
- **THEN** both `globals.css` and `context.md` describe the boot sweep as the top-bar page-heading treatment and brackets+caret as the section-heading treatment, kept consistent

### Non-Goals

- No board rename API (boards have no rename today — display-only per constitution IV).
- No new routes; the fixed route set is unchanged.
- No backend changes.
- Sidebar TypedLabel labels are NOT bracket targets — they keep typed-sweep only.

### Design Decisions

1. **Boot-sweep engine composes into WindowHeading, not a rewrite**: extend the existing `WindowHeading` component so its `decode` scramble becomes a per-cell boot sweep that also sweeps a prefix, keeping all three guards intact. Cockpit/board/root render sibling heading components that reuse the same sweep primitive. — *Why*: the intake mandates preserving the guards and reusing DECODE_* constants; a from-scratch component would risk regressing rename. — *Rejected*: a brand-new SweepHeading replacing WindowHeading (would duplicate/lose the edit guards).
2. **Shared per-cell `BootSweep` hook/primitive**: factor the cell-state machine (prefix typed-cursor + name churn+lock) into one reusable renderer so terminal (editable), board/root (display-only + prefix), and cockpit (solo) all share the mechanic. — *Why*: DRY across four modes, one animation timeline. — *Rejected*: four independent sweep implementations.
3. **PageHeading retired into SectionHeading**: `page-heading.tsx` + its unit test are deleted; a new `section-heading.tsx` (label + optional side slot, brackets + caret + rule + TypedLabel inside) serves cabin + cockpit call sites. — *Why*: both PageHeading usages disappear; a shared section component is the natural shape (intake assumption #11).
4. **Prefix as static sibling span**: the prefix lives outside the rename button so clicking it never starts an edit and the accessible rename `aria-label` is unaffected. — *Why*: intake R2 explicit constraint.

## Tasks

### Phase 1: Shared components

- [x] T001 Create `app/frontend/src/components/section-heading.tsx` — a `SectionHeading({ label, side?, className? })` component rendering the bracket idiom (`[`/`]` with `rk-bracket`/`rk-bracket-open`/`rk-bracket-close`, reserved `rk-bracket-caret` `▊` cell, `rk-bracket-group` hover scope), an `<h2>` wrapping `<TypedLabel text={label} />` (uppercase `text-xs tracking-wide text-text-secondary`), a `flex-1 border-t border-border` rule, and an optional right-aligned `side` slot after the rule. Brackets/caret/rule `aria-hidden`; `<h2>` accessible name = label only. <!-- R8 -->

### Phase 2: Top-bar center heading + boot sweep

- [x] T002 <!-- rework: M2 — resolved cells must settle to REST colors as the cursor passes (prefix→text-secondary, name→semibold text-primary); currently unclassed resolved cells inherit the container's scrambling text-accent-green flip, muting the left-to-right two-tone reveal --> In `app/frontend/src/components/top-bar.tsx`, add the boot-sweep cell-state primitive: a `useBootSweep`-style renderer (or shared internal `BootSweepCells` helper) that takes `prefix`, `name` (and a `solo` flag for cockpit), runs ONE cursor at `DECODE_FRAME_MS` over prefix + space + name, applies TypedLabel cell states (`rk-typed-off`/`rk-typed-cursor`) over prefix cells and decode-glyph churn (`DECODE_GLYPHS`, accent-green, spaces preserved) over unresolved name cells, resolving prefix→`text-secondary` and name→semibold `text-primary`. Reuse `DECODE_FRAME_MS`, `DECODE_HOVER_INTENT_MS`, `DECODE_GLYPHS`, `randomGlyph`, `prefersReducedMotion`. Decorative cells `aria-hidden`. <!-- R3 R5 -->
- [x] T003 <!-- rework: M1+M2 — add the mount replay leg (sweep plays once on mount; prevNameRef seeding + late currentWindow resolution currently prevent any initial/route-transition play) and drop the whole-container text-accent-green flip while scrambling (only churn/cursor cells are green); also N1 stale "terminal mode only" comment at ~:205, N4 double prefix/name spacing (sp cell + flex gap) --> Rework `WindowHeading` in `top-bar.tsx` to render the static `Terminal:` prefix sibling span OUTSIDE the rename button/input, and drive the name display via the boot-sweep primitive (prefix typed + name churn) — preserving all three guards (edit cancels scramble + binds to real name; displayed-name-change replays; identity-change cancels stale edit; no remount key) and the palette `window-heading:rename` path. The rename button `aria-label` stays `Rename window ${name}` (stable). Prefix hidden below `sm`. <!-- R1 R2 R3 R4 R5 -->
- [x] T004 <!-- rework: M1+M2 — mount replay missing (only hover + name-change trigger; headings remount per page-type so navigation never animates) and container green flip during sweep; also N3 aria-label-on-generic-span worth resolving --> Add display-only heading components in `top-bar.tsx` for board/root/cockpit: a `PageHeadingDisplay`-style component that renders a static prefix span + boot-swept name (board `Board:` + name, root `Server Cabin:` + name) or a solo typed-sweep word (cockpit `Cockpit`, primary-medium, visible at all breakpoints). Hover replay behind 140ms intent; mount replay on name change; reduced-motion skip. No rename affordance. <!-- R1 R2 R3 -->
- [x] T005 Update the center-cell render in `top-bar.tsx` so it renders the correct heading per mode: terminal → `WindowHeading` + ▾ window switcher; board → board display heading + ▾ board switcher (moved from left); root → server display heading; cockpit → solo `Cockpit`. Remove the `showWindowHeading` terminal-only gate. <!-- R1 R6 -->

### Phase 3: Left breadcrumb move-don't-copy

- [x] T006 In `top-bar.tsx`, remove the root-mode `serverIsLeaf` `aria-current="page"` server leaf span from the left nav (it moved to the center heading). Keep the terminal-mode server LINK crumb and session crumb unchanged. Adjust `showServerCrumb`/`serverIsLeaf` logic accordingly. <!-- R6 -->
- [x] T007 In `top-bar.tsx`, reduce `BoardModeBreadcrumb` to keep only the counts/hint span on the left; remove the left `Board ▸` home button and the board name + ▾ switcher (the name + switcher move to the center via T004/T005). The board switcher dropdown (`boards` items + `← Sessions`/navigate) relocates to the center beside the board name. <!-- R6 -->

### Phase 4: Remove PageHeading rows + wire section headings

- [x] T008 <!-- rework: S1 — cockpit zone metadata was placed in the SectionHeading side slot, contradicting this task's own text ("in each section's own layout") and plan assumption #4; restore metadata to the zone body next to/after the heading at its original text-xs sizing --> In `app/frontend/src/components/server-list-page.tsx`, delete the `<PageHeading page="cockpit" className="mb-6" />` row and its import; replace the four zone `<h2><TypedLabel .../></h2>` headings (`Host Health`, `Boards`, `Tmux Servers`, `Services`) with `<SectionHeading label=... />`, preserving each zone's existing inline metadata (hostname / board count / server count) in each section's own layout. <!-- R7 R8 -->
- [x] T009 In `app/frontend/src/components/session-tiles/session-tiles.tsx`, delete the `<PageHeading page="server cabin" ... />` row and its import; replace the `Sessions` `<h2><TypedLabel/></h2>` with `<SectionHeading label="Sessions" side={<stats>} />` where the stats (`{N} sessions, {M} windows`) are the relocated right-aligned side text. <!-- R7 R8 -->
- [x] T010 Delete `app/frontend/src/components/page-heading.tsx` and `app/frontend/src/components/page-heading.test.tsx` (retired — no remaining importers after T008/T009). <!-- R7 -->

### Phase 5: Documentation

- [x] T011 Update the hover-vocabulary comment in `app/frontend/src/globals.css` (lines ~105–112): "decode = editable window identity" → the boot sweep as the top-bar page-heading treatment; "brackets+caret = page titles" → section-heading treatment. <!-- R9 -->
- [x] T012 Update `fab/project/context.md`: the § Conventions hover-animation vocabulary bullet and the § Mobile Responsive Design top-bar description ("centered editable window heading … on terminal routes") to describe the universal `PageType: name` heading with the boot sweep and the section-heading bracket idiom. <!-- R9 -->

### Phase 6: Tests

- [x] T013 Update `app/frontend/src/components/top-bar.test.tsx`: root-mode assertions now expect the centered heading (server name in the center heading, not a left `aria-current` leaf); add per-mode heading/prefix assertions (terminal `Terminal:` prefix sibling, board `Board:` + board switcher in center, root `Server Cabin:`, cockpit solo `Cockpit`); board breadcrumb now only shows counts/hint on the left (no `Board ▸`, no left board name). Preserve rename/edit/palette tests. <!-- R1 R2 R4 R5 R6 -->
- [x] T014 Create `app/frontend/src/components/section-heading.test.tsx` — assert `<h2>` accessible name equals the label (brackets/caret/rule aria-hidden), optional side slot renders after the rule, TypedLabel is present inside the brackets. <!-- R8 -->
- [x] T015 Update `app/frontend/src/components/server-list-page.test.tsx`: PageHeading `[ cockpit ]` `<h1>` removal (no level-1 heading); the four zone `<h2>` labels still present via SectionHeading (order Host Health → Boards → Tmux Servers → Services). <!-- R7 R8 -->
- [x] T016 <!-- rework: S2+S3 — no behavioral test exercises the boot sweep (units stub matchMedia to reduced-motion; motion e2e block covers only sidebar TypedLabel): add a motion-opted-in e2e (hover heading → rk-typed-cursor cell attaches → resolves); and T016 claimed board centered-heading e2e coverage but only root+cockpit were added — add the board e2e (or amend claim + .spec.md); also N5 stale unit-test name "empty center cell" in top-bar.test.tsx --> Update e2e `app/frontend/tests/e2e/window-heading.spec.ts` + `.spec.md`: the terminal heading now carries a static `Terminal:` prefix sibling; the rename button label/behavior is unchanged; add board/root/cockpit centered-heading coverage and the section-heading shape. Check `mobile-layout.spec.ts` and `host-health-home.spec.ts` for heading assertions and update if the removed PageHeading `<h1>` or new headings are referenced. Every touched `.spec.ts` updates its sibling `.spec.md`. <!-- R1 R2 R6 R7 R8 -->

### Phase 7: Verification

- [x] T017 <!-- rework: re-verify after cycle-1 fixes --> Run `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and targeted `just test-e2e "window-heading"` / `"host-health-home"`; fix failures. <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->

## Execution Order

Phase 1 (SectionHeading) before Phase 4 (its consumers). Phase 2 (boot-sweep engine + WindowHeading + display headings) before Phase 3 (breadcrumb reduction relies on the center headings existing) and before the top-bar tests in Phase 6. T010 (delete page-heading) only after T008 + T009 remove all importers. Phase 5 docs are independent. Phase 7 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The top-bar center cell renders a `PageType: name` heading in all four modes (`Terminal: <window>`, `Board: <board>`, `Server Cabin: <server>`, solo `Cockpit`).
- [x] A-002 R2: The page-type prefix is a `text-text-secondary` static sibling span outside the rename control; the name is `font-semibold text-text-primary`; solo `Cockpit` is primary-medium; prefix hidden below `sm`; solo word visible at all breakpoints.
- [x] A-003 R3: One left-to-right boot sweep animates prefix (typed cursor) into name (decode churn+lock) at 28ms/cell, replaying on hover (140ms intent) and displayed-name change, skipped under reduced motion; cockpit plays the typed sweep alone.
- [x] A-004 R4: Inline rename (mouse click + palette `window-heading:rename`) still works; edit cancels the sweep; displayed-name change replays; external identity change cancels a stale edit; no remount key.
- [x] A-005 R5: The rename button `aria-label` is stable during animation; decorative sweep cells are `aria-hidden`; no `<h1>` is added to the top bar.
- [x] A-006 R6: The left breadcrumb ends at the parent in every mode — the root server leaf and board name/▾ moved to the center; board counts/hint stay left; the left `Board ▸` home button is removed.
- [x] A-007 R7: Both in-page PageHeading rows are removed (Cockpit + Server Cabin); `page-heading.tsx` + its test are deleted.
- [x] A-008 R8: A shared `SectionHeading` carries the bracket idiom (brackets + caret + rule + optional side slot) with TypedLabel inside and `<h2>` semantics; used on cabin `Sessions` (stats right-aligned) and the four cockpit zones (existing inline metadata preserved).
- [x] A-009 R9: The `globals.css` vocabulary comment and `context.md` (Conventions + Mobile top-bar) describe the boot sweep as the top-bar page-heading treatment and brackets+caret as the section-heading treatment, kept consistent.

### Behavioral Correctness

- [x] A-010 R4: The palette `window-heading:rename` CustomEvent enters inline edit unchanged; blur commits; Escape/empty-trim cancels.
- [x] A-011 R3: Under `prefers-reduced-motion` the sweep never starts (JS-gated) and inline-edit input shows the real name (no scrambled text leak).

### Scenario Coverage

- [x] A-012 R1: The 375px top bar stays single-line with the universal heading and no horizontal overflow on the terminal route.
- [x] A-013 R8: On the Cockpit `/`, the four zone `<h2>` labels render in order (Host Health → Boards → Tmux Servers → Services) via SectionHeading.

### Edge Cases & Error Handling

- [x] A-014 R2: Clicking the prefix span on a terminal route does NOT start an inline edit (edit binds only to the name).
- [x] A-015 R3: Spaces are preserved during name churn (`ch === " " ? " " : randomGlyph()`).

### Code Quality

- [x] A-016 Pattern consistency: new components follow existing top-bar / component conventions (function components, `rk-*` utility classes, Tailwind, no magic strings — reuse the named DECODE_* constants and TypedLabel).
- [x] A-017 No unnecessary duplication: the boot-sweep cell mechanic is shared across the four modes rather than reimplemented per mode; SectionHeading is shared across cabin + cockpit call sites.
- [x] A-018 Test coverage: touched/added `.spec.ts` files update their sibling `.spec.md` in the same work unit (constitution Test Companion Docs); new/changed behavior has unit + e2e coverage.

## Notes

The button-pyramid rebase (HEAD f909090, `260704-9o7k`) touches the right cluster only; this change touches the left breadcrumb + center cell + page bodies, so no conflict expected. Right-cluster tests in `top-bar.test.tsx` are preserved verbatim.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the code it obsoleted — `page-heading.tsx` + its test, the `DECODE_REVEAL_PER_STEP` constant, the left-nav `BoardModeBreadcrumb` board name/`Board ▸` button, and the root-mode `serverIsLeaf` leaf span — was already deleted within the change itself; no further orphans found: all new symbols have call sites and `rk-bracket-*`/`rk-typed-*`/`TypedLabel`/`LINK_CRUMB_CLASS` remain in use).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The boot-sweep cell mechanic is factored into a shared internal primitive in `top-bar.tsx` (not a separate module) — WindowHeading (editable), board/root display headings, and cockpit solo all consume it. Keeps the animation timeline in one place near the DECODE_* constants it reuses. | Intake mandates reuse of DECODE_* + guards; a shared primitive is the DRY shape. Colocated with WindowHeading (which owns the guards) rather than a new module. Reversible refactor. | S:60 R:85 A:85 D:70 |
| 2 | Confident | `SectionHeading` is a new file `section-heading.tsx` (label + optional side slot), replacing PageHeading; `page-heading.tsx` + `page-heading.test.tsx` deleted after removing both importers. | Intake assumption #11 (Confident) — both PageHeading usages disappear; a shared section component is the natural shape. | S:55 R:85 A:85 D:75 |
| 3 | Confident | Board switcher dropdown (`boards` items + `← Sessions` action) relocates to the center beside the board name; the left keeps only the counts/hint span. | Intake §2 says board name + ▾ switcher MOVE to center; counts/hint STAY left; the ▾ is the board switcher, so it travels with the name. | S:70 R:80 A:85 D:75 |
| 4 | Confident | Cockpit zone SectionHeadings keep each zone's existing inline metadata (hostname / board count / server count) rendered in the zone body next to/after the heading, NOT as the SectionHeading `side` slot (which is reserved for the cabin stats relocation). | Intake assumption #17 (Confident): "no side text" means no relocated stats, not removal of existing metadata. Preserving current layout avoids an unrequested regression. | S:50 R:85 A:80 D:65 |
| 5 | Confident | The boot sweep on display-only headings (board/root) sweeps the full prefixed string on hover + name-change replay + mount; cockpit's solo word gets the typed sweep alone. No rename affordance on board/root/cockpit. | Intake §3 + assumption #7/#13: display-only names still animate (the demo animated all four); board has no rename API. | S:60 R:85 A:85 D:75 |

5 assumptions (0 certain, 5 confident, 0 tentative).
