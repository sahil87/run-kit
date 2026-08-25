# Plan: Make the All settings tab the last settings tab

**Change**: 260824-xf6p-all-settings-tab-last
**Intake**: `intake.md`

## Requirements

### Settings Dialog: Tab rail order

#### R1: All settings renders as the last tab
The settings dialog's tab rail SHALL render its tabs in the order **General, Appearance, Shortcuts, All settings** — the `SETTINGS_TABS` array in `app/frontend/src/components/settings-dialog.tsx` is the single source of rail order and SHALL be reordered so the `all` entry is last. Tab ids, labels, panel components, the `SettingsTab` union, deep-link semantics (`openSettings("all")`, palette action `settings-all`), and the General default-open tab MUST NOT change.

- **GIVEN** the settings dialog is open
- **WHEN** the tab rail renders
- **THEN** the tablist order is General, Appearance, Shortcuts, All settings
- **AND** `openSettings("all")` still opens the All settings tab and a tab-less open still lands on General

#### R2: Roving arrow navigation reflects the new order
The roving-tabindex arrow navigation (which walks and wraps `SETTINGS_TABS` in array order) SHALL wrap from **General** backwards (ArrowUp/ArrowLeft) to **All settings**, and the order-dependent unit test assertion MUST be updated to match (Constitution: tests conform to the spec, never the other way around).

- **GIVEN** focus is on the General tab
- **WHEN** ArrowUp is pressed
- **THEN** the All settings tab receives focus and becomes selected (wrap to last)

### Non-Goals

- No NEW e2e spec — but the EXISTING order-pinning e2e test (`app/frontend/tests/e2e/shortcut-registry.spec.ts` "tabs switch by pointer and by roving arrow keys") must be updated to the new order, together with its companion `.spec.md` (Constitution: Test Companion Docs). <!-- rework: cycle 1 — intake wrongly claimed no e2e order pin existed -->
- No persistence, reordering UI, or other tab changes.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Reorder `SETTINGS_TABS` in `app/frontend/src/components/settings-dialog.tsx` so `{ id: "all", label: "All settings" }` is the last entry (order: general, appearance, shortcuts, all) <!-- R1 -->
- [x] T002 Update the wrap assertion in the "arrow keys rove the tablist and activate on focus" test in `app/frontend/src/components/settings-dialog.test.tsx`: ArrowUp from General now selects "All settings" instead of "Shortcuts" <!-- R2 -->
- [x] T003 Run the affected frontend suites (`settings-dialog.test.tsx`, `settings-dialog-context.test.tsx`, `use-global-palette-actions.test.tsx`) via the just-based runner and confirm green <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Update `app/frontend/tests/e2e/shortcut-registry.spec.ts` "tabs switch by pointer and by roving arrow keys" (lines ~332-340): ArrowDown from Appearance now selects Shortcuts, ArrowDown again selects All settings; reword the stale order comment at lines 332-333 <!-- R2 --> <!-- rework: cycle 1 — e2e test pinned the old rail order -->
- [x] T005 Update the companion `app/frontend/tests/e2e/shortcut-registry.spec.md` steps for that test to the new order (same commit, per Constitution Test Companion Docs) <!-- R2 --> <!-- rework: cycle 1 -->
- [x] T006 Run the updated e2e test via `just test-e2e shortcut-registry -g "tabs switch by pointer"` and confirm green (2 passed) <!-- R2 --> <!-- rework: cycle 1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The rendered tablist order is General, Appearance, Shortcuts, All settings (`SETTINGS_TABS` array order, All settings last)

### Behavioral Correctness

- [x] A-002 R1: Tab ids, labels, deep links (`openSettings("all")`, palette `settings-all`), and the General default-open tab are unchanged — display order only
- [x] A-003 R2: ArrowUp from General wraps focus/selection to All settings; the updated test asserts this and passes

### Scenario Coverage

- [x] A-004 R2: The affected unit suites (settings-dialog, settings-dialog-context, use-global-palette-actions) pass after the reorder — `just test-frontend` green at review (3510 tests, 173 files), `npx tsc --noEmit` clean
- [x] A-007 R2: The shortcut-registry e2e test asserts the NEW roving order (Appearance → Shortcuts → All settings), its stale order comment is gone, the companion `.spec.md` steps match, and the test passes via the just-based e2e runner

### Code Quality

- [x] A-005 Pattern consistency: The reorder keeps the existing array/object literal style; no structural changes beyond entry order
- [x] A-006 No unnecessary duplication: No new utilities or duplicated tab definitions introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Verification scope: affected frontend unit suites + type check + the order-pinning shortcut-registry e2e test (scope widened at rework cycle 1 — the original unit-only scope missed the e2e order pin) | Frontend-only diff; the e2e order pin in tests/e2e/ was discovered by review, so the scope now names it explicitly | S:70 R:90 A:85 D:80 |

1 assumption (0 certain, 1 confident, 0 tentative).

## Deletion Candidates

- `app/frontend/tests/e2e/shortcut-registry.spec.ts:332-333` — comment "All settings sits between Appearance and Shortcuts since 260823-5r41." becomes stale with the reorder; deleted/reworded when the test above it is corrected (see must-fix finding in review result).
