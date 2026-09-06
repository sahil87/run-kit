# Plan: Server Header Coarse Density

**Change**: 260906-wr2z-server-header-coarse-density
**Intake**: `intake.md`

## Requirements

### Sidebar: Layout-neutral header-action touch floors

#### R1: SERVER panel `+` floor must not drive header height
The SERVER panel's `+` create-server `headerAction` button (`app/frontend/src/components/sidebar/server-panel.tsx`) SHALL keep its 24px-fine / 40px-coarse touch-target floor while contributing no more than the header row's text-driven content height (16px line) to layout, via negative vertical margins (`-my-1 coarse:-my-3`: fine 24 − 2·4 = 16, coarse 40 − 2·12 = 16).

- **GIVEN** the sidebar (drawer or desktop) on a coarse pointer (`any-pointer: coarse`)
- **WHEN** the SERVER `CollapsiblePanel` header renders (collapsed or expanded)
- **THEN** its header row height equals the BOARDS header row height (text + `py-1`, ~24px)
- **AND** the `+` button's hit box remains ≥ 40×40 on coarse and ≥ 24×24 on fine pointers

#### R2: HOST panel palette button gets the identical treatment
The HOST panel's instance-color palette `titleAction` button (`app/frontend/src/components/sidebar/host-panel.tsx`) carries the same floor pair inside the same header flex row and SHALL gain the same `-my-1 coarse:-my-3` margins, leaving its hover-reveal/pointer-events spelling untouched.

- **GIVEN** the sidebar with the HOST panel section enabled on a coarse pointer
- **WHEN** the HOST `CollapsiblePanel` header renders
- **THEN** the header row height matches the other panel headers' text-driven height
- **AND** the palette button's floor pair and one-hover-reveal-contract classes are unchanged

#### R3: e2e regression coverage under coarse emulation
A Playwright test SHALL assert SERVER/BOARDS header-height parity under coarse-pointer emulation (`hasTouch: true` flips Chromium's `any-pointer: coarse`, per the `sidebar-panels.spec.ts` idiom), living in `server-panel-grid.spec.ts` (the ServerPanel behavioral spec; its existing mobile tests use no `hasTouch`, so the new test gets its own `test.describe` with `test.use({ hasTouch: true, viewport: { width: 375, height: 812 } })`). Per the constitution's Test Intent Comments rule it carries a Proves/Steps JSDoc block, and the file-header comment notes the coarse block's setup.

- **GIVEN** a 375×812 viewport with `hasTouch: true` and the mobile drawer open
- **WHEN** the SERVER and BOARDS header rows' bounding boxes are measured
- **THEN** their heights are equal within 1px

### Non-Goals

- The PANE panel's bordered refresh chip (`status-panel.tsx`, `coarse:min-h-[30px]`) — a visible bordered control with a deliberately smaller floor; separate visual decision.
- The status-panel PR-copy cluster — already absolutely positioned and layout-neutral.
- `ServerTile` anatomy and the tile grid — not the reported defect.
- `CollapsiblePanel` itself — the fix belongs at the two call sites carrying the floor.

### Design Decisions

#### Layout-neutral floor via negative margins, not smaller targets or fixed header height
**Decision**: Keep the settled 24/40 floor pair on both header-action buttons and neutralize its layout contribution with `-my-1 coarse:-my-3` at the call sites.
**Why**: The 40px coarse target is the repo-wide convention (visual-design § Touch Targets); negative vertical margin keeps the hit box while the flex row sizes to its text, and the header needs no overflow tricks.
**Rejected**: Shrinking the coarse floor (violates the convention); a fixed-height header row in `CollapsiblePanel` (fights flex layout, risks clipping focus rings, and touches every panel for a two-call-site defect).
*Introduced by*: 260906-wr2z-server-header-coarse-density

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Add `-my-1 coarse:-my-3` to the `+` headerAction button's class string in `app/frontend/src/components/sidebar/server-panel.tsx` (the `min-w-[24px] min-h-[24px] coarse:min-w-[40px] coarse:min-h-[40px]` button) <!-- R1 -->
- [x] T002 [P] Add `-my-1 coarse:-my-3` to the palette titleAction button's class string in `app/frontend/src/components/sidebar/host-panel.tsx` (same floor pair; leave the hover-reveal classes untouched) <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Add a coarse-emulation `test.describe` (`test.use({ hasTouch: true, viewport: 375×812 })`) to `app/frontend/tests/e2e/server-panel-grid.spec.ts` asserting SERVER vs BOARDS header-row heights are equal (±1px) in the open mobile drawer, with a Proves/Steps JSDoc block and a file-header note for the new block's setup <!-- R3 -->
- [x] T004 Verify: `npx tsc --noEmit` in `app/frontend`, run the touched unit suites (`server-panel.test.tsx`, `collapsible-panel.test.tsx` if it asserts header geometry), and run the changed-surface e2e specs via `just test-e2e "server-panel-grid"` (plus `sidebar-panels` as the sibling spec touching the same headers) <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The SERVER panel `+` button carries `-my-1 coarse:-my-3` alongside the unchanged 24/40 floor pair; the header flex row's height is text-driven on both pointer classes
- [x] A-002 R2: The HOST panel palette button carries the same margins with its hover-reveal spelling intact

### Behavioral Correctness

- [x] A-003 R1: On coarse emulation the SERVER header height equals the BOARDS header height (previously ~48px vs ~24px)

### Scenario Coverage

- [x] A-004 R3: The new coarse-emulation test exists in `server-panel-grid.spec.ts`, asserts header-height parity (±1px), and passes; it carries the constitution-mandated Proves/Steps intent comment

### Edge Cases & Error Handling

- [x] A-005 R1: The `+` button's tap target still meets the 40×40 coarse floor (bounding box, not layout box) and remains clickable — existing create-server flows unaffected

### Code Quality

- [x] A-006 Pattern consistency: The margin utilities ride the existing class strings in place; no new components, tokens, or constants
- [x] A-007 No unnecessary duplication: No new helper or constant introduced for a two-call-site class tweak; no comment narration added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds layout-neutral margins to two existing class strings and one e2e test without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Exact utilities `-my-1 coarse:-my-3` (both floors reduce to the 16px text line) | Arithmetic from the floor pair vs the row's 16px line height; fine pointers get the same parity fix (SERVER was 8px taller than BOARDS on fine too) | S:70 R:90 A:85 D:75 |
| 2 | Confident | e2e home = `server-panel-grid.spec.ts` with a new `hasTouch` describe (not `sidebar-panels.spec.ts`) | It is the ServerPanel behavioral spec; its mobile tests lack `hasTouch`, so a dedicated coarse block is needed either way, and the BOARDS header is always mounted in the drawer | S:65 R:90 A:80 D:70 |
| 3 | Certain | No unit-test geometry assertions to update | jsdom cannot compute flex row heights; geometry proof lives in e2e only (the roving-focus lesson) | S:70 R:95 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
