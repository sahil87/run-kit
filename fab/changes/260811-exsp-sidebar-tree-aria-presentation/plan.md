# Plan: Sidebar Tree ARIA Presentational Server Wrappers

**Change**: 260811-exsp-sidebar-tree-aria-presentation
**Intake**: `intake.md`

## Requirements

### Frontend: Sidebar Tree ARIA

#### R1: Presentational server section wrappers
The per-server `<section>` wrapper rendered by `ServerGroup` in `app/frontend/src/components/sidebar/index.tsx` (inside the `role="tree"` session tree) MUST carry `role="presentation"` and MUST NOT carry `aria-labelledby`. Per WAI-ARIA 1.2 Presentational Roles Conflict Resolution, a global ARIA property such as `aria-labelledby` voids the presentation role, so both halves of this requirement are mandatory together.

- **GIVEN** the sidebar renders one or more servers in the session tree
- **WHEN** the tree DOM is inspected
- **THEN** every per-server `<section>` wrapper directly under `[role="tree"]` has `role="presentation"`
- **AND** none of those wrappers carries an `aria-labelledby` attribute

#### R2: Drop the dead `server-header-*` id, keep the button's own labeling
The `id={`server-header-${server}`}` on the `ServerGroup` header toggle button exists solely as the `aria-labelledby` target (verified: no other reference in `src/` or tests). Once R1 removes the `aria-labelledby`, that id MUST be removed in the same edit. The button MUST retain its `aria-expanded` state and its `aria-label` (`Collapse/Expand {server} sessions`), so the server name remains announced on the actual control.

- **GIVEN** the `ServerGroup` header toggle button for a server
- **WHEN** the tree DOM is inspected
- **THEN** the button carries no `id` attribute
- **AND** it still carries `aria-expanded` and an `aria-label` naming the server

#### R3: Unit-test the presentational wrapper contract
`app/frontend/src/components/sidebar/index.test.tsx` MUST gain an assertion in the tree-ARIA area proving each per-server wrapper under `[role="tree"]` carries `role="presentation"` and no `aria-labelledby`. Existing tree tests (roving tabindex, `[role="treeitem"]` enumeration, `data-row-key` selectors) MUST pass unchanged — they do not depend on the section's region role or the removed id. Unit tests only; no e2e spec changes.

- **GIVEN** the sidebar test suite
- **WHEN** `just test-frontend` runs
- **THEN** a test asserting the presentational-wrapper contract (R1) passes
- **AND** all pre-existing tree-ARIA tests still pass

### Non-Goals

- The server header row (the `aria-current` div with chevron/palette/+/✕ buttons) remaining non-treeitem interactive content inside the tree — documented deliberate keyboard-first APG deviation; not touched.
- The intermediate plain `<div>`s (header wrapper, content div, per-session group divs) — implicit `generic` role, not landmarks; the backlog scopes this change to the `<section>` wrappers only.
- Keyboard-nav, roving-tabindex, or multiselect behavior — the `rovingKey`/`getVisibleRows` machinery reads `[role="treeitem"]` from DOM order and is unaffected by wrapper semantics.
- No visual change; semantics only.

### Design Decisions

#### Keep the `<section>` element with `role="presentation"`
**Decision**: Add `role="presentation"` to the existing `<section>` wrapper and remove `aria-labelledby`; do not swap the element to `<div>`.
**Why**: With `role="presentation"` the element's implicit semantics are neutralized either way, so an element swap would be pure churn — minimal diff wins. The `aria-labelledby` removal is spec-required, not optional: per WAI-ARIA 1.2 § Presentational Roles Conflict Resolution a global ARIA property voids the presentation role, so keeping it would silently make the change a no-op (the section would stay exposed as a named `region` landmark).
**Rejected**: (a) Keeping `aria-labelledby` alongside `role="presentation"` — spec-voided, change becomes a no-op. (b) `role="group"` per server — the server header row inside the wrapper is deliberately NOT a treeitem, so a `group` would still contain non-treeitem interactive content, and the backlog directive explicitly prescribes `presentation`.
*Introduced by*: 260811-exsp-sidebar-tree-aria-presentation

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `role="presentation"` and remove `aria-labelledby={`server-header-${server}`}` on the per-server `<section>` wrapper in `ServerGroup` (`app/frontend/src/components/sidebar/index.tsx:2320-2323`) <!-- R1 -->
- [x] T002 Remove the now-unused `id={`server-header-${server}`}` from the header toggle button (`app/frontend/src/components/sidebar/index.tsx:2350`); keep `aria-expanded` and `aria-label` intact <!-- R2 -->
- [x] T003 Add a test in the tree-ARIA describe block of `app/frontend/src/components/sidebar/index.test.tsx` asserting every per-server wrapper under `[role="tree"]` has `role="presentation"` and no `aria-labelledby`; run `just test-frontend` and fix any failures <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every per-server `<section>` wrapper under `[role="tree"]` carries `role="presentation"` and no `aria-labelledby` attribute
- [x] A-002 R2: The `ServerGroup` header toggle button carries no `id` attribute while retaining `aria-expanded` and its `Collapse/Expand {server} sessions` `aria-label`
- [x] A-003 R3: `app/frontend/src/components/sidebar/index.test.tsx` contains a test asserting the presentational-wrapper contract, and `just test-frontend` is green

### Behavioral Correctness

- [x] A-004 R1: No per-server `region` landmark is exposed inside the tree — the accessibility structure reads `tree → treeitem(level 1) → group → treeitem(level 2)` with the wrapper semantically transparent
- [x] A-005 R1: Existing tree tests (roving tabindex, treeitem enumeration, `data-row-key` selectors) pass unchanged — no behavioral regressions

### Scenario Coverage

- [x] A-006 R3: The new unit test exercises the multi-row tree fixture and verifies the wrapper contract for every rendered server group

### Code Quality

- [x] A-007 Pattern consistency: The edit follows the surrounding JSX/test conventions (attribute style, existing tree-ARIA describe block, Testing Library queries)
- [x] A-008 No unnecessary duplication: The test reuses the existing tree fixture/render helpers rather than adding a parallel mount
- [x] A-009 Test coverage: The changed behavior (presentational wrappers, dropped id) is covered by a unit test, per code-quality.md

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None remaining — the sole artifact this change made redundant (the `id={`server-header-${server}`}` on the `ServerGroup` header toggle button, `app/frontend/src/components/sidebar/index.tsx`, dead once R1 dropped the `aria-labelledby` target) was already removed in the same apply diff (T002); repo-wide grep for `server-header-` returns zero references

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One task per requirement (T001/T002 split the same-edit code change; T003 the test) | Traceability contract requires one `<!-- R# -->` per task; the code edits are adjacent lines in one function, so the split costs nothing | S:90 R:95 A:95 D:90 |
| 2 | Confident | Place the new test inside the existing "tree ARIA + roving keyboard navigation (wt1v)" describe block, reusing `renderTree()`/`tree()` | Intake specifies "an assertion in the tree-ARIA area"; that block already mounts a multi-session tree and has the helpers needed | S:70 R:90 A:85 D:75 |
| 3 | Certain | The intake's 6 assumptions stand as-is; no new under-specified requirement surfaced during plan generation | Intake is exhaustive (exact code, spec citation, verification); assumptions 1–5 map 1:1 onto R1–R3 and the Non-Goals | S:90 R:90 A:90 D:90 |

3 assumptions (2 certain, 1 confident, 0 tentative).
