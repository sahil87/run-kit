# Plan: Stage Bottom-Gap Parity

**Change**: 260815-g08a-stage-bottom-gap-parity
**Intake**: `intake.md`

## Requirements

### Shell: Stage Bottom Seam

#### R1: The stage charges no row-gap; the footer owns its seam
`stageStyle` in `app/frontend/src/components/shell/shell.tsx` SHALL NOT set `rowGap` (the `columnGap` and its 150ms collapse transition stay byte-identical). The bottombar `<footer>` SHALL carry a content-gated 6px top margin (CSS `:has(>*)` via the Tailwind `has-[...]` variant form; arbitrary-variant fallback if the child combinator doesn't compile), so an empty footer contributes zero height and zero seam, and a populated footer contributes the 6px seam plus its content. Comments describing the old stage row-gap seam (stage header block and the bottombar placement note) SHALL be updated to the footer-owned mechanism.

- **GIVEN** the resting desktop state (fine pointer, compose strip closed) on terminal, server, or board
- **WHEN** the stage renders
- **THEN** sidebar-card bottom == content-column bottom == status-bar top − 6px

- **GIVEN** the compose strip is open on a desktop route
- **WHEN** the footer renders its content
- **THEN** a 6px seam separates the tile column from the strip, and the strip's bottom edge is flush with the sidebar card's bottom

#### R2: Regression e2e proves the parity
An e2e assertion of the resting bottom-edge parity (sidebar aside bottom == content card bottom == status-bar top − 6) SHALL land in an existing suite (`surface-layout.spec.ts` geometry cases or `right-panel.spec.ts` — implementer's choice), with the sibling `.spec.md` updated in the same commit. No unit test (jsdom has no layout).

- **GIVEN** the e2e suite runs on the isolated port-3020 rig
- **WHEN** the parity case executes on a desktop viewport
- **THEN** it fails on the pre-fix code (12px vs 6px) and passes on the fixed code

### Non-Goals

- Mobile branch (no stage there — untouched by construction)
- Any change to `columnGap`, the collapse transition, or the grid templates

## Tasks

### Phase 1: Core Implementation

- [x] T001 `app/frontend/src/components/shell/shell.tsx`: remove `rowGap: "6px"` from `stageStyle`; add the content-gated top seam to the bottombar footer (`has-[>*]:mt-[6px]`, fallback `[&:has(>*)]:mt-[6px]` if the combinator doesn't compile — verify in the built CSS); update the stage header comment and the bottombar placement comment to the footer-owned seam <!-- R1 -->
- [x] T002 Add the bottom-edge parity e2e assertion to an existing suite (surface-layout.spec.ts geometry case or right-panel.spec.ts) + update its sibling `.spec.md` <!-- R2 -->
- [x] T003 Gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "<the modified spec>"`; live-measure the fix against a dev/live instance if cheap <!-- R1, R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `stageStyle` has no `rowGap`; `columnGap` + transition unchanged; footer carries the content-gated 6px top margin — verified in diff (`shell.tsx:199` rowGap removed; `columnGap`/transition lines untouched; `shell.tsx:258` footer `has-[>*]:mt-[6px]`, confirmed compiled to `:has(>*) { margin-top: 6px }` in served CSS)
- [x] A-002 R2: A parity e2e assertion exists in an existing suite with its `.spec.md` updated in the same commit — `surface-layout.spec.ts` "stage bottom-edge parity" case + sibling `.spec.md` entry, both in the same diff

### Behavioral Correctness

- [x] A-003 R1: Resting desktop: sidebar bottom == content bottom == status-bar top − 6px (measured, not assumed) — asserted via bounding boxes in the new e2e case (±1px tolerance); the case passed in the review run, and the fix mechanism (rowGap removal) provably removes the extra 6px the content column paid
- [x] A-004 R1: Comments describe the footer-owned seam, not a stage row-gap — stage header block (`shell.tsx:74-76`), `stageStyle` inline comment (`shell.tsx:190-194`), and bottombar placement comment (`shell.tsx:251-256`) all updated

### Scenario Coverage

- [x] A-005 R2: The e2e parity case passes on the fixed code — `just test-e2e "surface-layout"` 12/12 green in review run

### Code Quality

- [x] A-006 Pattern consistency: the `has-[...]` variant form matches existing codebase usage; no new plumbing/props — matches `has-[:focus-visible]:pointer-events-auto` in `status-panel.tsx:362` / `window-row.tsx:573`
- [x] A-007 No unnecessary duplication: no compensating margins elsewhere; the unrelated 19me archive move rides along uncommitted, never reverted — diff touches only the 4 in-scope files; archive move untouched

## Notes

- Check items as you review: `- [x]`

## Deletion Candidates

- `app/frontend/src/components/shell/shell.tsx:202` (`rowGap: "6px"` in `stageStyle`) — removed by this change itself; it was the root cause (charged 6px between tracks even at zero row height). No other code became redundant: no compensating margins or conditional templates existed elsewhere.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Single-file fix + one e2e case; light-lane inline execution | Intake carries the exact edits with measured evidence | S:90 R:90 A:95 D:95 |

1 assumptions (1 certain, 0 confident, 0 tentative).
