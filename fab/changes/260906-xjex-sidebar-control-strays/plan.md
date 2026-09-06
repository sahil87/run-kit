# Plan: Sidebar Control Strays

**Change**: 260906-xjex-sidebar-control-strays
**Intake**: `intake.md`

## Requirements

### Sidebar: One Hover-Reveal Contract

#### R1: One reveal behavior, documented pattern
The hover-revealed icon-cluster pattern MUST have one behavioral contract — unreachable at rest on fine pointers (`pointer-events` gated), always reachable on coarse (`coarse:` escapes), and `focus-visible` reveals — with the canonical spelling documented once (constraint comment at the reference site or a helper string in `controls.ts`, apply's judgment). `status-panel.tsx`~:350 is the reference (container gate + coarse escapes). `host-panel.tsx`~:84 MUST migrate onto the contract (container idiom, or button-level WITH pointer-events gating if no grouping container exists — behavioral equivalence is the requirement). `window-row.tsx`~:949 keeps its deliberate fine-only rendering (the coarse status rail owns that surface) — the pattern comment MUST record this as design.

- **GIVEN** the host-panel palette button at rest on a fine pointer
- **WHEN** the pointer is not over the panel and no focus is inside
- **THEN** the button is not hittable (pointer-events gated), and on coarse it is always visible and hittable

#### R2: Stray tappables gain floors
Floors (24px fine / 40px coarse unless stated): `status-panel.tsx`~:359 PR-copy buttons (20px today); `pin-popover.tsx`~:237 Pin button fine 22→24 (coarse 40 kept); `server-panel.tsx`~:132 "+" button; `board/board-header.tsx`~:85 unpin; `operator-context-chip.tsx`~:42 ✕; `row-flyout-card.tsx`~:728 docs (i) link. `swatch-popover.tsx` `CELL` (~:52): 18px fine KEPT as a documented dense-picker exception + `coarse:w-[28px] coarse:h-[28px]`; the popover MUST still fit a 375px viewport on coarse (verify; reduce columns coarse-only if it overflows). `marker-pad.tsx`: verify-only — geometry is `MARKER_WELL_*`-driven; do not break the lockstep or the spring-loaded interaction.

- **GIVEN** a coarse pointer
- **WHEN** each enumerated control renders
- **THEN** its hit target is ≥40px (swatch cells: 28px by documented exception) and fine-pointer rendering is unchanged except the two sub-24 fine bumps (PR-copy, Pin)

#### R3: One row-hover alpha
`bg-bg-card/50` is the one row-hover fill: `sidebar/index.tsx`~:2910 (`/30`→`/50`); pin-popover rows (`bg-bg-card`→`/50`).

- **GIVEN** any sidebar/popover row hover
- **WHEN** rendered
- **THEN** the fill is `bg-bg-card/50`; no `/30` or full-strength row hover remains in the touched files

### Controls: Switch Track Recipe

#### R4: One switch-track recipe, two consumers
`controls.ts` MUST export the switch-track classes. ON track (`bg-accent-green/30 border-accent-green`) and the knob values are identical at both sites — extract verbatim. The OFF track values DIFFER today (BoolToggle `bg-bg-inset border-border`, server-card Protect `bg-bg-card border-border`); this requirement SANCTIONS unifying on **`bg-bg-inset border-border`** — the recessed-well ground the app's other "off/empty" surfaces use (marker wells, status rail) — which deliberately moves the Protect switch's off track `bg-bg-card` → `bg-bg-inset` (a recorded, intended delta; BoolToggle's off state is unchanged from pre-slice). Consumers: server-card Protect (`server-card.tsx`~:86) and settings `BoolToggle` (`settings-all-panel.tsx`~:87). The Protect row additionally adopts `ACTION_ROW_CLASS` (min-h + left-border hover cue) like its `CardActionRow` siblings; `role="switch"`/`aria-checked` unchanged.

- **GIVEN** the two switches
- **WHEN** rendered in either state
- **THEN** both consume the same exported constants (zero inline track strings); ON/knob values are byte-identical to pre-change; OFF is `bg-bg-inset border-border` at both (the one sanctioned delta being Protect's off track); the Protect row's hover/height matches its sibling action rows

### Cleanup: Touched-Files Deletion Candidates

#### R5: Redundant utilities removed in touched files only
In files this slice touches: remove `select-none` where the global select guard covers the element, and per-site `focus-visible:` outline utilities the global ring outranks (`row-flyout-card.tsx` ACTION_ROW `focus-visible:outline-1 outline-accent`, status-panel's `outline-1` variants). Repo-wide sweep stays slice 7.

- **GIVEN** a touched file
- **WHEN** grepped after the change
- **THEN** no per-site focus outline utility or covered `select-none` remains in it, and keyboard focus still shows the global green ring

### Tests

#### R6: Tests conform
Sweep unit + e2e for assertions pinned to: 20px PR-copy geometry, 18px-coarse swatch cells, `/30` hover alpha, Protect's pre-ACTION_ROW classes, and the removed focus utilities. Binding e2e traps (project memory): row icon clusters need `.hover()` before icon clicks; `filter({ has })` takes page-rooted locators; marker-well width appears as a hardcoded Tailwind literal (grep by value). Intent comments updated in the same edit; scoped e2e only.

- **GIVEN** the scoped affected suites run
- **WHEN** assertions execute
- **THEN** they verify the new contract and pass

### Non-Goals

- Status rail, marker-pad interaction, flyout anatomy, row tint system — untouched
- Window-row icon cluster stays fine-only (recorded as design); no coarse arm
- Dialogs/inputs (slice 6); repo-wide deletion sweep + `Control` primitive (slice 7)

### Design Decisions

#### Swatch cells: 18 fine kept, 28 coarse — the dense-picker exception
**Decision**: Picker grids keep sub-24 fine cells (documented exception) and take 28px on coarse, not 40.
**Why**: An 8+ column color grid at 40px cannot fit 375px; 28px matches the marker-pad's coarse cell ballpark and is tappable in a grid context (adjacent-error cost is low and visible).
**Rejected**: 40px cells with fewer columns — breaks the picker's at-a-glance palette scan; leaving 18px on touch — the audit's worst class.
*Introduced by*: 260906-xjex-sidebar-control-strays

#### Reveal unification is behavioral, not markup-identical
**Decision**: One reveal contract (rest-unreachable fine / always-reachable coarse / focus-visible reveals), allowing container- or button-level spelling per DOM shape.
**Why**: host-panel's button may lack a grouping container; forcing one adds DOM for no user-visible gain.
**Rejected**: One literal class string everywhere — couples unrelated DOM shapes.
*Introduced by*: 260906-xjex-sidebar-control-strays

## Tasks

### Phase 1: Setup

- [x] T001 `controls.ts`: export the switch-track constants (extract the exact values shared by server-card Protect and BoolToggle); constraint comment states the one-recipe rule <!-- R4 -->

### Phase 2: Core Implementation

- [x] T002 `sidebar/status-panel.tsx`: PR-copy buttons 20→24 fine / 40 coarse; confirm it as the reveal reference (align divergence); remove its per-site focus outline utilities <!-- R1, R2, R5 -->
- [x] T003 [P] `sidebar/host-panel.tsx`: palette button onto the reveal contract (pointer-events gating + coarse escapes + focus-visible reveal); floor its hit area <!-- R1, R2 -->
- [x] T004 [P] `sidebar/window-row.tsx`: pattern comment records the fine-only design at the cluster site (verify no divergence; no coarse arm) <!-- R1 -->
- [x] T005 [P] Floors: `pin-popover.tsx` Pin 22→24 fine; `server-panel.tsx` "+"; `board/board-header.tsx` unpin; `operator-context-chip.tsx` ✕; `row-flyout-card.tsx` docs link (+ its ACTION_ROW focus-utility removal) <!-- R2, R5 -->
- [x] T006 [P] `swatch-popover.tsx`: `CELL` gains `coarse:w-[28px] coarse:h-[28px]` + the exception comment; verify 375px coarse fit (adjust columns coarse-only if needed); `marker-pad.tsx` verify-only <!-- R2 -->
- [x] T007 [P] Row-hover alpha: `sidebar/index.tsx`~:2910 `/30`→`/50`; pin-popover rows full→`/50` <!-- R3 -->
- [x] T008 [P] `server-card.tsx`: Protect row adopts `ACTION_ROW_CLASS` + the switch-track constants; `settings-all-panel.tsx` BoolToggle consumes the same constants <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Test sweep per R6 (grep the old values: `min-h-\[20px\]`, 18px-coarse cell assertions, `bg-bg-card/30`, Protect's old classes, removed focus utilities); intent comments in the same edits <!-- R6 -->
- [x] T010 Verify: `cd app/frontend && npx tsc --noEmit`; affected unit suites (status-panel, host-panel, window-row, pin-popover, server-card, server-panel, swatch-popover, settings-all-panel, row-flyout-card, board-header as they exist); scoped e2e for touched sidebar specs only — never the full suite <!-- R6 -->

## Execution Order

- T001 blocks T008; T002–T008 otherwise parallel; T009 after T002–T008; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: host-panel button behaves per the reveal contract on both pointer classes; the reference-site comment documents the pattern + the window-row fine-only carve-out
- [x] A-002 R2: every enumerated stray meets its floor (24/40; swatch 18-fine/28-coarse with the exception comment); swatch popover fits 375px coarse
- [x] A-003 R3: no `bg-bg-card/30` or full-strength row hover remains in touched files
- [x] A-004 R4: switch-track constants exported and consumed at both switches (zero inline track strings); Protect row on ACTION_ROW_CLASS with siblings' hover cue
- [x] A-005 R5: touched files carry no covered `select-none` or per-site focus outline utilities; keyboard focus still rings (global rule)

### Behavioral Correctness

- [x] A-006 R1: fine-pointer rest state — revealed controls not hittable until hover/focus; coarse — always hittable (no hover dependence)
- [x] A-007 R2: fine-pointer rendering unchanged except the two sub-24 bumps (PR-copy, Pin) — no other fine geometry moved

### Scenario Coverage

- [x] A-008 R6: updated suites pass; scoped sidebar e2e for touched specs passes

### Edge Cases & Error Handling

- [x] A-009 R2: marker-pad lockstep (`MARKER_WELL_*` + session-row's hardcoded literal) untouched and verified consistent
- [x] A-010 R4: switch knob transition/position unchanged and ON/knob values byte-identical; OFF unified on `bg-bg-inset border-border` at both switches — BoolToggle's off state identical to pre-slice, Protect's off-track delta sanctioned by R4 (verified cycle 1 rework: `SWITCH_TRACK_OFF = "bg-bg-inset border-border"` at controls.ts:116, consumed at both sites, zero inline track strings remain)

### Code Quality

- [x] A-011 Pattern consistency: floors via the established literal+lockstep convention; constants SCREAMING_SNAKE with constraint-only comments
- [x] A-012 No duplication: the switch track exists once; no re-typed reveal spellings beyond the documented DOM-shape variants
- [x] A-013 No comment narration or change-ID citations

## Notes

- Check items as you review: `- [x]`
- Full e2e suite is on-demand only — scope to changed-surface specs.

## Deletion Candidates

- None — this change removes its own redundant per-site utilities in place (focus-outline utilities, duplicate switch-track strings) and leaves no existing symbol, file, or block unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | PR-copy and Pin fine bumps (20→24, 22→24) are acceptable fine-pointer visual deltas | Sub-24 fine violates the audit's floor; 2-4px on hidden-at-rest controls | S:66 R:82 A:80 D:74 |

1 assumption (0 certain, 1 confident, 0 tentative).
