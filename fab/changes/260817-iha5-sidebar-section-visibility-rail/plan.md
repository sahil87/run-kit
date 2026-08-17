# Plan: Sidebar Section-Visibility Toggle Micro-Rail

**Change**: 260817-iha5-sidebar-section-visibility-rail
**Intake**: `intake.md`

## Requirements

### Sidebar: Section-visibility micro-rail

#### R1: Micro-rail component
A new `SectionRail` component (`app/frontend/src/components/sidebar/section-rail.tsx`) SHALL render a horizontal row of exactly four icon-only toggle buttons — in order **Boards · Server · Pane · Host** — as the FIRST child of the Sidebar's `<nav>` (above `BoardsSection`, `app/frontend/src/components/sidebar/index.tsx:1504`). Sessions MUST NOT appear in the set. The rail itself MUST always render (it is not self-hideable).

- **GIVEN** the sidebar is rendered on any route that mounts it (`app.tsx` shell or `/board/$name`)
- **WHEN** the sidebar paints
- **THEN** the rail renders at the top of the `<nav>` with exactly four toggle buttons in the fixed order Boards, Server, Pane, Host
- **AND** no toggle exists for the Sessions tree

#### R2: Button geometry, icons, and states
Each rail button MUST be a 24×24px box with a 13px stroke glyph on fine pointers and grow to 30×30px on coarse pointers (`coarse:` variant — the `TOP_BAR_BUTTON_H` 30px coarse axis; the fine box is the sidebar row-icon-system geometry `min-w-[24px] min-h-[24px]`). Buttons sit with ~4px gap and ~8px rail side padding (rail row ~32px tall on fine pointers). Each button MUST carry `aria-pressed` reflecting its section's visibility, an `aria-label` naming the section (state-stable, e.g. `Toggle Boards section`), and a glyph from `app/frontend/src/components/sidebar/icons.tsx` in the file's fixed idiom (`stroke="currentColor"`, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, `aria-hidden`; four new members: `BoardsSectionIcon`, `ServerSectionIcon`, `PaneSectionIcon`, `HostSectionIcon`). Pressed state = subtle accent-tinted fill + inset accent ring + `text-text-primary`; unpressed = `text-text-secondary` at rest, `text-text-primary` on hover.

- **GIVEN** a fine-pointer viewport
- **WHEN** the rail renders
- **THEN** each button is a 24×24px box with a 13px stroke SVG, and a pressed button shows the accent fill + inset ring while an unpressed one reads `text-text-secondary`
- **GIVEN** a coarse-pointer device
- **WHEN** the rail renders
- **THEN** each button's box is 30×30px (touch target), same glyph idiom

#### R3: Hover labels (fine pointers only)
On fine pointers each button SHALL be wrapped in the shared tier-1 `Tip` (`components/tip.tsx`) with a short action label (e.g. `Show Boards section` / `Hide Boards section`, mirroring the scope chip's state-flipping label pattern; ≤40ch). No native `title=` (never both). No labels on coarse pointers — `Tip` is hover/focus-driven and tapping a toggle is self-revealing.

- **GIVEN** a fine pointer hovering a rail button
- **WHEN** the hover delay elapses
- **THEN** a tier-1 `Tip` names what a click does, and the button carries no native `title` attribute

#### R4: Visibility state — four shared booleans
A new hook module `app/frontend/src/hooks/use-sidebar-sections.ts` SHALL own the section vocabulary: a `SidebarSection` type (`"boards" | "server" | "pane" | "host"`), the ordered `SIDEBAR_SECTIONS` tuple, per-section localStorage keys `runkit-sidebar-section-{section}`, per-section defaults (**boards: true, server: true, pane: false, host: false**), and `useSidebarSectionVisible(section): [boolean, (next: boolean) => void]` implemented over the existing `useLocalStorageBoolean` pub/sub hook so the rail, the sidebar render, and the palette entries stay in sync within a tab. Keys are shared across viewports — NO per-viewport fork, NO per-route state.

- **GIVEN** no stored values
- **WHEN** the sidebar renders on any viewport
- **THEN** Boards and Server sections are visible, Pane and Host are hidden — byte-identical to today's default rendering on both desktop and mobile
- **GIVEN** a rail button is toggled in one component
- **WHEN** another subscriber of the same key is mounted (e.g. the palette action list or the sidebar body)
- **THEN** it re-renders with the new value in the same tab (pub/sub), and other tabs sync via the native `storage` event

#### R5: Section gating — visibility replaces the isMobile gate
`sidebar/index.tsx` SHALL gate each optional section on its visibility boolean: `BoardsSection` and `ServerPanel` (both currently unconditional) render only when their section is on; the `isMobile && <BottomPanels …/>` gate (`index.tsx:1691`) is REPLACED by per-section gating — `WindowPanel` (Pane) and `HostPanel` (Host) mount independently under their own booleans on every viewport (the `BottomPanels` wrapper splits or takes per-section props accordingly). Toggle-off fully unmounts the section (header gone, height reclaimed, effects stopped). `SidebarFooter` is NOT a toggleable section and keeps its existing `isMobile` gate. Persisted collapse state (`CollapsiblePanel` `storageKey`s such as `runkit-panel-server`, `runkit-panel-window`, `runkit-panel-host`, and `-height` keys) MUST NOT be touched by visibility toggling — re-toggling a section on restores its collapse/height state exactly as left.

- **GIVEN** the Pane section is toggled on, its panel collapsed via the chevron, then the section toggled off and on again
- **WHEN** the panel remounts
- **THEN** it renders collapsed (collapse state survived the visibility round-trip)
- **GIVEN** a desktop viewport with Pane toggled on
- **WHEN** the sidebar renders
- **THEN** the `WindowPanel` mounts in the desktop sidebar (the 260814-ldbs desktop removal becomes a default, not a hard gate)
- **GIVEN** the default state on mobile
- **WHEN** the drawer opens
- **THEN** no PANE/HOST panels render — the drawer is pure nav (+ footer), and the board-route focused-tile PANE fallback is consequently opt-in

#### R6: Command-palette entries
`app/frontend/src/hooks/use-global-palette-actions.ts` SHALL register four always-available actions — `Panel: Toggle Boards`, `Panel: Toggle Server`, `Panel: Toggle Pane`, `Panel: Toggle Host` (ids e.g. `panel-toggle-boards` …) — each flipping its section boolean via the R4 hook. These are the keyboard recovery path (Constitution V).

- **GIVEN** any route
- **WHEN** the user opens the palette and runs `Panel: Toggle Host`
- **THEN** the Host section's persisted boolean flips and a mounted sidebar reflects it immediately

#### R7: Render-performance neutrality
The rail and the section gates MUST NOT disturb the sidebar memo tree (sidebar.md § Render Performance, R6a): visibility state is read via the R4 hook inside `Sidebar`/`SectionRail` locally — no new props threaded through `ServerGroup`/`SessionRow`/`WindowRow`, no new churning references into memoized children, no per-second ticks.

- **GIVEN** an SSE session tick
- **WHEN** the sidebar re-renders
- **THEN** the memoized `ServerGroup` subtrees skip exactly as before (no new unstable props introduced by this change)

#### R8: Tests and companions
Unit tests (Vitest, colocated) SHALL cover the rail component (order, `aria-pressed`, toggle wiring) and the hook (defaults, key names, pub/sub sync); `sidebar/index.test.tsx` gains gating coverage (default render = today's; toggled states mount/unmount sections). Playwright e2e SHALL cover toggle → section unmount/remount + persistence across reload on both viewports (375px coarse + desktop), with `.spec.md` companions per Constitution. Existing e2e coupled to the old defaults — `tests/e2e/sidebar-panels.spec.ts` (drawer PANE/HOST assumed present) and `tests/e2e/pr-status-sidebar.spec.ts` (Pane-panel PR row) — SHALL be updated to enable the Pane/Host sections first (seed localStorage or drive the rail), with their `.spec.md` companions updated in the same commit.

- **GIVEN** the full frontend test suite
- **WHEN** `just test-frontend` and the touched e2e specs run
- **THEN** all pass under the new defaults

### Non-Goals

- No existing control migrates into the rail (the ALL/CUR scope chip stays where it is); the rail is only the *designated home* for future sidebar-level controls.
- No changes to the desktop status bar, the coarse status rail/cards, or `SidebarFooter`.
- No backend/API/route changes; no per-route or per-viewport visibility state.
- No self-hide toggle for the rail itself.

### Design Decisions

#### Tier-1 Tip labels, not identity-tip cards
**Decision**: Rail button hover labels use the shared tier-1 `Tip` component with a state-flipping action label, like the SESSIONS scope chip.
**Why**: The tooltip promotion rule (status-signals.md § Tooltips — Two-Tier Taxonomy) is explicit: a tooltip that names a control is tier-1; tier-2 identity tips carry a second line of identity/state. A rail toggle's label is a control name with zero state payload. The intake's "identity-tip idiom" wording is honored in spirit (hover label on fine pointers only) while conforming to the taxonomy's letter.
**Rejected**: `IdentityTipCard` per button — a title-bar-plus-body card for a 24px toggle violates the two-tier boundary and duplicates chrome for no added information.
*Introduced by*: 260817-iha5-sidebar-section-visibility-rail

#### Visibility gate lives in the Sidebar orchestrator
**Decision**: Section booleans are read in `Sidebar` (and `SectionRail`) via `useSidebarSectionVisible`; gated sections are conditionally rendered at their existing mount sites.
**Why**: `Sidebar` already re-renders on its own state; reading four pub/sub booleans there adds no churn to the memoized row tree (R6a untouched — no new props through `ServerGroup`).
**Rejected**: A context provider for section visibility — needless indirection for four booleans already synchronized by the `useLocalStorageBoolean` pub/sub.
*Introduced by*: 260817-iha5-sidebar-section-visibility-rail

## Tasks

### Phase 1: Setup

- [x] T001 [P] Create `app/frontend/src/hooks/use-sidebar-sections.ts` — `SidebarSection` type, ordered `SIDEBAR_SECTIONS` tuple with per-section `{ key: "runkit-sidebar-section-{s}", default, label }`, and `useSidebarSectionVisible(section)` over `useLocalStorageBoolean`; colocated `use-sidebar-sections.test.ts` (defaults, key names, setter round-trip, pub/sub sync between two hook instances) <!-- R4 -->
- [x] T002 [P] Add four stroke icons to `app/frontend/src/components/sidebar/icons.tsx` in the file's exact idiom (13px default, 24-unit viewBox, strokeWidth 2, aria-hidden): `BoardsSectionIcon`, `ServerSectionIcon`, `PaneSectionIcon`, `HostSectionIcon` <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/frontend/src/components/sidebar/section-rail.tsx` — `SectionRail` mapping `SIDEBAR_SECTIONS` to `aria-pressed` toggle buttons (24×24 fine / `coarse:` 30×30, ~4px gap, ~8px side padding, pressed = accent fill + inset ring, unpressed = text-secondary/hover-primary), each wrapped in tier-1 `Tip` with a state-flipping `Show/Hide {Section} section` label (no native `title`); colocated `section-rail.test.tsx` (order, aria-pressed reflects state, click flips the persisted boolean, no Sessions toggle) <!-- R1, R2, R3 -->
- [x] T004 Mount `<SectionRail />` as the first child of the `<nav>` in `app/frontend/src/components/sidebar/index.tsx` (above `BoardsSection`, :1504) and gate `BoardsSection` + `ServerPanel` on their R4 booleans read in `Sidebar` <!-- R1, R5, R7 -->
- [x] T005 Replace the `isMobile && <BottomPanels …/>` gate (`sidebar/index.tsx:1691`) with independent Pane/Host visibility gating (split `BottomPanels` or pass per-section flags so `WindowPanel` and `HostPanel` mount independently on every viewport); keep `SidebarFooter`'s `isMobile` gate; update the adjacent 260814-ldbs comment block to describe the new default-off contract; verify collapse `storageKey`s are untouched by toggling <!-- R5 -->
- [x] T006 [P] Register the four `Panel: Toggle {Boards|Server|Pane|Host}` actions in `app/frontend/src/hooks/use-global-palette-actions.ts` (ids `panel-toggle-*`), flipping via `useSidebarSectionVisible` setters; extend that hook's existing test coverage if present <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Update `app/frontend/src/components/sidebar/index.test.tsx` (and any unit test asserting unconditional `BoardsSection`/`ServerPanel`/`BottomPanels` rendering) to the new gating: default render byte-equivalent to today on both viewports; toggled-on Pane/Host mount on desktop too; collapse-state survival across a visibility round-trip <!-- R5, R4 -->
- [x] T008 New e2e `app/frontend/tests/e2e/sidebar-section-rail.spec.ts` + `.spec.md` companion — rail renders with defaults (Boards/Server pressed, Pane/Host not), toggling Pane on mounts the PANE panel and persists across reload, toggling Boards off removes the section; run at 375px (`hasTouch`, drawer flow — mobile specs use direct goto, no gotoWindow) and desktop 1024px+ <!-- R8, R1, R5 -->
- [x] T009 Update `app/frontend/tests/e2e/sidebar-panels.spec.ts` + `.spec.md` — drawer PANE/HOST tests first enable the sections (seed `runkit-sidebar-section-pane|host` via `addInitScript` or drive the rail); the desktop no-panels test becomes a defaults test (asserts default-off rather than unconditional absence) <!-- R8, R5 -->
- [x] T010 Update `app/frontend/tests/e2e/pr-status-sidebar.spec.ts` + `.spec.md` — Pane-panel PR-row tests seed the Pane section on before asserting <!-- R8 -->

### Phase 4: Polish

- [x] T011 Verification gates in order: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, then the touched e2e specs via `just test-e2e "<spec>"` (never bare `just pw` in this environment), and `just build` <!-- R8 -->

## Execution Order

- T001 and T002 are independent [P]; both block T003
- T003 blocks T004; T004 blocks T005
- T006 depends only on T001
- T007–T010 follow T005; T011 is last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SectionRail` renders four toggles in order Boards · Server · Pane · Host at the top of the sidebar `<nav>`, on both Sidebar mounts (`app.tsx` and `board-page.tsx`); no Sessions toggle; the rail is not self-hideable
- [x] A-002 R2: Buttons are 24×24 (fine) / 30×30 (coarse) with 13px `icons.tsx`-idiom glyphs, `aria-pressed`, and the specified pressed/unpressed treatments
- [x] A-003 R3: Fine-pointer hover shows a tier-1 `Tip` action label; no native `title` on rail buttons
- [x] A-004 R4: `use-sidebar-sections.ts` owns keys `runkit-sidebar-section-*`, defaults boards/server on + pane/host off, built on `useLocalStorageBoolean`; same keys on all viewports and routes
- [x] A-005 R5: `BoardsSection`, `ServerPanel`, `WindowPanel`, `HostPanel` are visibility-gated; the `isMobile && <BottomPanels/>` gate is gone; `SidebarFooter` still isMobile-gated
- [x] A-006 R6: Four `Panel: Toggle {Section}` palette actions exist in `use-global-palette-actions.ts` and flip the persisted booleans

### Behavioral Correctness

- [x] A-007 R4: With no stored values, rendering on desktop and mobile is behavior-identical to before this change (Boards+Server visible, Pane+Host absent)
- [x] A-008 R5: Toggle-off fully unmounts a section (header gone); persisted collapse/height keys survive a visibility round-trip untouched
- [x] A-009 R5: With Pane toggled on, `WindowPanel` mounts in the DESKTOP sidebar (opt-in return of the 260814-ldbs panels)

### Scenario Coverage

- [x] A-010 R8: New e2e spec covers toggle → unmount/remount + reload persistence at 375px and desktop, with a `.spec.md` companion
- [x] A-011 R8: `sidebar-panels.spec.ts` and `pr-status-sidebar.spec.ts` updated to the new defaults with `.spec.md` companions updated in the same commit

### Edge Cases & Error Handling

- [x] A-012 R4: localStorage unavailable (privacy mode) degrades to defaults without throwing (the `useLocalStorageBoolean` try/catch path)
- [x] A-013 R6: Palette toggle on a route with no sidebar mounted (`/`) flips the persisted value harmlessly (no crash, next sidebar mount reflects it)

### Code Quality

- [x] A-014 Pattern consistency: rail/icons/hook follow the row-icon-system, `use-local-storage-*`, and `Tip` idioms of the surrounding code
- [x] A-015 No unnecessary duplication: reuses `useLocalStorageBoolean`, `Tip`, existing icon idiom — no new tooltip/storage/icon systems
- [x] A-016 R7: No new props threaded through memoized `ServerGroup`/`SessionRow`/`WindowRow`; R6a invariants intact
- [x] A-017 New behavior has tests (unit + e2e per code-quality.md); no client polling introduced; no comment narration added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. Its one removal (the `isMobile && <BottomPanels …/>` gate in `app/frontend/src/components/sidebar/index.tsx`) was the planned R5 replacement, executed in the diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Rail labels use tier-1 `Tip` (state-flipping action label), not `IdentityTipCard`, deviating from the intake's "identity-tip idiom" wording | The tooltip promotion rule makes a control-name label tier-1 by definition; spirit (fine-pointer hover label) preserved | S:70 R:90 A:90 D:75 |
| 2 | Confident | Hook module named `hooks/use-sidebar-sections.ts` with keys `runkit-sidebar-section-{boards,server,pane,host}` and ids `panel-toggle-*` | Intake fixed the convention (`runkit-*`, per-section boolean) but not exact names; follows `use-sessions-scope.ts` precedent | S:55 R:80 A:85 D:70 |
| 3 | Confident | Palette actions live in `useGlobalPaletteActions` (route-independent home) with labels `Panel: Toggle {Section}` verbatim from the intake | The hook is the existing home for route-independent chrome actions (Help/Settings/font); flipping a persisted bool is valid on every route | S:65 R:85 A:85 D:80 |
| 4 | Confident | Existing e2e adapts by seeding `runkit-sidebar-section-*` in `addInitScript` (fastest deterministic path) rather than driving the rail UI in every coupled spec; the new rail spec drives the real UI | Persistence-seeding is the established pattern for pre-state in these specs; UI-driving coverage still exists in the dedicated spec | S:60 R:85 A:80 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
