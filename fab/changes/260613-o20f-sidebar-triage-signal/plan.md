# Plan: Sidebar Triage Signal

**Change**: 260613-o20f-sidebar-triage-signal
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. Pure-presentational frontend change to the sidebar
     WindowRow that maps already-transmitted needs-attention fields onto the
     existing red token, plus a one-word export to share the fail predicate. -->

### Sidebar: Failed Fab Stage Signal

#### R1: Failed fab-stage text renders in the red token
WHEN a window's `fabDisplayState === "failed"`, the fab-stage text in `window-row.tsx` MUST render with `text-red-400` instead of `text-text-secondary`. The existing quiet-row gate (`win.fabStage && win.fabDisplayState !== "done"`) MUST remain identical — only the color token becomes conditional.

- **GIVEN** a window with `fabStage: "review"` and `fabDisplayState: "failed"`
- **WHEN** the row renders
- **THEN** the `"review"` stage-text node carries `text-red-400`
- **AND** it does NOT carry `text-text-secondary`

#### R2: Non-failed fab-stage text keeps the secondary token (compatibility fallthrough)
WHEN `fabDisplayState` is any value other than `"failed"` (e.g. `"active"`, `"ready"`, an unknown future value, or absent), the fab-stage text MUST keep `text-text-secondary`. The `"done"` suppression behavior MUST be unchanged.

- **GIVEN** a window with `fabStage: "review-pr"` and `fabDisplayState: "active"`
- **WHEN** the row renders
- **THEN** the stage-text node carries `text-text-secondary`
- **AND** it does NOT carry `text-red-400`

### Sidebar: Failed Fab Stage Activity Dot

#### R3: Failed fab-stage colors the activity dot red
WHEN a window's `fabDisplayState === "failed"`, the activity dot MUST render in `text-red-400` (its border and fill draw via `currentColor`, so the color token flows through without touching the inline `style`). The dot's `isActiveWindow`/`activity` ring logic and filled-vs-hollow shape MUST be untouched. For any non-`"failed"` state the dot MUST keep `text-text-secondary`.

- **GIVEN** a window with `fabDisplayState: "failed"`
- **WHEN** the row renders
- **THEN** the activity-dot span carries `text-red-400`
- **AND** a window without `fabDisplayState: "failed"` keeps `text-text-secondary` on the dot

### Sidebar: PR-Fail Glyph

#### R4: A red PR-fail glyph appears for change-bound windows whose PR needs attention
WHEN a window has a `prNumber` AND `isFailish(win)` is true (`prChecks === "fail"` OR `prReview === "changes_requested"`), the right-side cluster MUST render a small filled red bullet `●` (U+25CF) in `text-red-400`, placed before the stage text and duration. The glyph MUST carry an accessible name via `aria-label` and a `title`. The glyph MUST NOT render when `prNumber` is absent, nor when checks pass and the review is clean.

- **GIVEN** a window with `prNumber: 386` and `prChecks: "fail"`
- **WHEN** the row renders
- **THEN** a `text-red-400` glyph with an `aria-label` of "PR needs attention" is present
- **AND** GIVEN `prReview: "changes_requested"` (checks otherwise clean) the glyph is also present
- **AND** GIVEN `prChecks: "pass"` and `prReview: "approved"` the glyph is absent
- **AND** GIVEN no `prNumber` the glyph is absent even if a stray fail field is set

#### R5: The PR-fail predicate is a single source of truth (reuse `isFailish`)
The PR-fail condition MUST be evaluated via the existing `isFailish` predicate from `pr-status-line.tsx`, not re-derived inline in `window-row.tsx`. `isFailish` MUST be exported (changed from module-private) without altering its behavior or its existing internal call site.

- **GIVEN** `isFailish` is currently module-private in `pr-status-line.tsx`
- **WHEN** the export keyword is added
- **THEN** `window-row.tsx` imports and calls `isFailish` for the glyph gate
- **AND** the existing `PrStatusLine` call site is unaffected (no behavior change)

### Non-Goals

- No return of the full `PrStatusLine` to sidebar rows — it was deliberately removed in `260610-obky`; the row stays a single compact line.
- No new SSE fields, no backend change — all fields already exist on `WindowInfo` (`types.ts:44-74`).
- No new component, dependency, or route.
- The quiet-parked-row gate logic is not changed (only the color token is made conditional).

### Design Decisions

1. **Reuse `isFailish` via export, not duplication**: change `function isFailish` → `export function isFailish` and import into `window-row.tsx`. — *Why*: single source of truth for the fail definition; keeps row and Pane panel in lockstep. — *Rejected*: re-deriving the boolean inline (drift risk).
2. **Color both the stage text AND the activity dot on `failed`**: — *Why*: the dot shows on quiet/short rows where stage text is absent, maximizing legibility; the dot already renders via a color token so the swap is mechanical. — *Rejected*: stage-text-only (less legible; a minor reviewer preference, not a different design).
3. **Filled red bullet `●` (U+25CF) as the glyph**: — *Why*: reuses `PrStatusLine`'s established `stateGlyph` vocabulary (`●` for open PRs). — *Rejected*: a distinct shape/SVG (polish nuance deferrable to review).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/pr-status-line.tsx`, change the module-private `function isFailish(win: WindowInfo): boolean` (line ~29) to `export function isFailish(...)`. No body change; existing internal call site unaffected. <!-- R5 -->
- [x] T002 In `app/frontend/src/components/sidebar/window-row.tsx`, add `import { isFailish } from "@/components/pr-status-line";`. <!-- R5 -->
- [x] T003 In `app/frontend/src/components/sidebar/window-row.tsx`, make the fab-stage text color conditional: when `win.fabDisplayState === "failed"` render `text-red-400`, else `text-text-secondary`. Keep the gate `win.fabStage && win.fabDisplayState !== "done"` identical (line ~229-233). <!-- R1 R2 -->
- [x] T004 In `app/frontend/src/components/sidebar/window-row.tsx`, make the activity-dot color conditional: swap the hard-pinned `text-text-secondary` for `text-red-400` when `win.fabDisplayState === "failed"` (line ~198-205). Leave the `isActiveWindow`/`activity` ring and shape logic and inline `style` untouched. <!-- R3 -->
- [x] T005 In `app/frontend/src/components/sidebar/window-row.tsx`, add the PR-fail glyph in the right-side cluster (`<span className="flex items-center gap-1.5 shrink-0">`, line ~223), before the stage text + duration: render a `text-red-400` filled bullet `●` gated on `win.prNumber && isFailish(win)`, with `aria-label="PR needs attention"` and a `title`. <!-- R4 -->

### Phase 3: Tests

- [x] T006 In `app/frontend/src/components/sidebar/window-row.test.tsx`, add a `describe` block (sibling to `fab stage quiet-row policy`) covering: failed stage → red stage text; non-failed (`active`) → secondary token (not red); failed stage → red activity dot; PR-fail glyph renders for `prChecks: "fail"`; renders for `prReview: "changes_requested"`; NO glyph when checks pass + review clean; NO glyph when `prNumber` absent. <!-- R1 R2 R3 R4 -->

## Execution Order

- T001 blocks T002 and T005 (the export must exist before the import/usage).
- T003, T004, T005 all edit `window-row.tsx` and are sequenced (same file).
- T006 (tests) runs after T001-T005.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A window with `fabStage` set and `fabDisplayState === "failed"` renders the stage text in `text-red-400`. (window-row.tsx:248; test window-row.test.tsx:225-236)
- [x] A-002 R2: A window with a non-`"failed"`, non-`"done"` `fabDisplayState` renders the stage text in `text-text-secondary` (never `text-red-400`); `"done"` is still suppressed. (window-row.tsx:247-248 ternary else-branch + unchanged `!== "done"` gate; tests window-row.test.tsx:238-249 and the existing quiet-row `done` suppression at 161-174)
- [x] A-003 R3: A window with `fabDisplayState === "failed"` renders the activity dot in `text-red-400`; otherwise the dot stays `text-text-secondary` with its ring/shape logic intact. (window-row.tsx:200; the inline `style` border/fill via `currentColor` is untouched; test window-row.test.tsx:251-262)
- [x] A-004 R4: The red `●` PR-fail glyph (with `aria-label`/`title`) renders when `prNumber` is present AND `isFailish(win)`; it is placed before stage text + duration. (window-row.tsx:231-239, `&#x25CF;` U+25CF, in the right-cluster span before stage+duration; tests window-row.test.tsx:264-289)
- [x] A-005 R5: `isFailish` is exported from `pr-status-line.tsx` and consumed by `window-row.tsx`; the predicate is not duplicated and the existing `PrStatusLine` call site is unaffected. (pr-status-line.tsx:29 `export function isFailish`; imported window-row.tsx:9; internal call site pr-status-line.tsx:47 unchanged; no inline duplicate found)

### Behavioral Correctness

- [x] A-006 R2: The quiet-parked-row gate (`fabDisplayState !== "done"`) is byte-for-byte unchanged — only the className expression changed. (Confirmed in working-tree diff: the `{win.fabStage && win.fabDisplayState !== "done" && (` line is identical; only the inner `<span className=…>` changed from a literal string to a ternary.)
- [x] A-007 R4: No glyph renders when `prChecks: "pass"` + `prReview: "approved"`, and none renders when `prNumber` is absent. (tests window-row.test.tsx:291-312)

### Scenario Coverage

- [x] A-008 R1 R2 R3 R4: `window-row.test.tsx` adds a sibling `describe` block exercising all seven scenarios (failed/non-failed stage text, failed dot, glyph present for checks-fail and changes-requested, glyph absent for clean and for no-PR). All tests pass. (`describe("triage signals")` window-row.test.tsx:224-313, 7 cases; full run: 28/28 passed across window-row + pr-status-line specs.)

### Code Quality

- [x] A-009 Pattern consistency: New code follows the surrounding Tailwind className-string and conditional-className-composition style in `window-row.tsx`. (Template-literal ternary matches the existing `buttonClass`/`buttonStyle` composition idiom; glyph span mirrors the existing `&#x25A0;` swatch/`✕` kill glyph pattern in the same file.)
- [x] A-010 No unnecessary duplication: The fail predicate reuses the exported `isFailish` rather than re-deriving it inline (matches code-quality "Duplicating existing utilities" anti-pattern guard). (grep confirms the only `prChecks === "fail" || prReview === "changes_requested"` literal is in `isFailish` itself; window-row.tsx calls the import.)
- [x] A-011 Type narrowing over assertions: No new `as` casts introduced; the change uses field comparisons on the existing `WindowInfo` shape. (Diff adds only `win.fabDisplayState === "failed"` / `win.prNumber && isFailish(win)` field comparisons; tsc --noEmit clean.)
- [x] A-012 Tests cover changed behavior: Per code-quality "new features/bug fixes MUST include tests", the added unit tests cover every new presentational branch. (7 new cases cover both branches of each of the 3 new conditionals.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality (two presentational signals + one export) without making existing code redundant. The `export` on `isFailish` widens visibility without removing its internal call site; the new dot/stage ternaries and PR-fail glyph are additive branches over existing fields.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `isFailish` by exporting it (one-word `export`) and importing into `window-row.tsx`, not duplicating the predicate. | Intake explicitly mandates reuse; single-source-of-truth; export is non-breaking (existing call site unaffected, no test asserts privacy). | S:90 R:90 A:95 D:90 |
| 2 | Confident | Apply the failed → `text-red-400` token to BOTH the stage text AND the activity dot. | Intake sanctions both; dot shows on quiet/short rows where stage text is absent; the dot already renders via a color token so the swap is mechanical; one-clause reversion. | S:65 R:88 A:75 D:72 |
| 3 | Confident | Use a filled red bullet `●` (U+25CF) for the PR-fail glyph, with `aria-label`/`title`. | Direct precedent: `PrStatusLine`'s `stateGlyph` uses `●` for open PRs; established vocabulary; trivially reversible. | S:60 R:88 A:78 D:70 |
| 4 | Confident | Place the PR-fail glyph in the right-side cluster (before stage text + duration), not next to the left activity dot. | The right cluster already groups status signals (stage, duration); consistent placement; keeps the left side as pure name/identity. | S:60 R:85 A:75 D:70 |
| 5 | Confident | Gate the PR-fail glyph on `win.prNumber` (mirroring `PrStatusLine`'s gate) even though `isFailish` is already false without PR data. | Explicit, readable guard; prevents a stray glyph on edge/partial data; matches the established `PrStatusLine` gating convention. | S:65 R:85 A:80 D:75 |
| 6 | Certain | `aria-label` text is "PR needs attention" and `title` is "PR checks failing or changes requested". | Intake provides these exact strings as the example; an accessible name is required for a bare glyph. | S:85 R:90 A:90 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative).
