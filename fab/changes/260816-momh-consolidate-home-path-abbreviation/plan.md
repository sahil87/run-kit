# Plan: Consolidate Home-Path Abbreviation

**Change**: 260816-momh-consolidate-home-path-abbreviation
**Intake**: `intake.md`

## Requirements

### Frontend: Shared home-substitution helper

#### R1: `abbreviateHomePath` covers all three home prefixes with boundary semantics
`abbreviateHomePath` (`app/frontend/src/lib/format.ts`, keeping its exported name and location) SHALL abbreviate a leading `/home/<user>`, `/Users/<user>`, or `/root` prefix to `~`, requiring a segment boundary (slash or end-of-string) after the matched prefix for all three arms. Unmatched paths pass through unchanged. The doc comment SHALL mention `/root`. Exact-match table (binding):

| Input | Output |
|-------|--------|
| `/home/sahil/code/x` | `~/code/x` |
| `/Users/sahil/code/x` | `~/code/x` |
| `/root/x` | `~/x` |
| `/root` | `~` |
| `/home/u` | `~` |
| `/rootfs/x` | `/rootfs/x` |
| `/homeless/dir` | `/homeless/dir` |
| `/srv/data` | `/srv/data` |
| `/home` | `/home` |

- **GIVEN** the inputs in the table
- **WHEN** `abbreviateHomePath` is applied
- **THEN** each produces exactly the listed output

#### R2: `shortenPath` delegates step-1 substitution; `HOME_PATTERNS` deleted
`shortenPath` in `app/frontend/src/components/sidebar/status-panel.tsx` SHALL call `abbreviateHomePath` (imported from `@/lib/format`) for its home-substitution step; the private `HOME_PATTERNS` constant SHALL be deleted. The step-2 keep-last-2-segments truncation stays local and behaviorally unchanged; `shortenPath` remains private. `session-row.tsx` is NOT touched.

- **GIVEN** the PANE panel rendering a cwd under `/home/<user>/...`
- **WHEN** `shortenPath` runs
- **THEN** output is identical to before the change, and no `HOME_PATTERNS` symbol exists in the file

#### R3: Test coverage and gates
`lib/format.test.ts`'s table SHALL gain the `/root`, `/root/x`, `/rootfs/x`, `/homeless/dir`, and `/home` rows (existing rows retained). `status-panel.test.tsx` passes UNMODIFIED. Gates: `just test-frontend` green, `npx tsc --noEmit` clean. No e2e (no `.spec.ts` touched, so no `.spec.md` obligations).

- **GIVEN** the suites run
- **WHEN** `just test-frontend` and `tsc --noEmit` execute
- **THEN** both pass with `status-panel.test.tsx` untouched

### Non-Goals

- Any truncation-behavior change in `shortenPath`
- Touching `session-row.tsx` (already on the shared helper)
- Backend, e2e, or new exports beyond the existing `abbreviateHomePath`

## Tasks

### Phase 1: Core Implementation

- [x] T001 Extend `abbreviateHomePath` in `app/frontend/src/lib/format.ts` to the R1 behavior table (add `/root` arm with the `(?=\/|$)` boundary; update doc comment); add the new table rows to `app/frontend/src/lib/format.test.ts` <!-- R1, R3 -->
- [x] T002 In `app/frontend/src/components/sidebar/status-panel.tsx`: delete `HOME_PATTERNS`, make `shortenPath` step 1 call `abbreviateHomePath` (import from `@/lib/format`), keep step-2 truncation unchanged <!-- R2 -->

### Phase 2: Verification

- [x] T003 Run gates: `just test-frontend` (confirm `status-panel.test.tsx` green unmodified) and `cd app/frontend && npx tsc --noEmit` <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `abbreviateHomePath` matches the full behavior table, all three arms boundary-checked
- [x] A-002 R2: `HOME_PATTERNS` is gone; `shortenPath` delegates step 1 to the shared helper; truncation unchanged

### Behavioral Correctness

- [x] A-003 R2: PANE panel cwd rendering identical for `/home`/`/Users` inputs; identity tip now abbreviates `/root/...`

### Scenario Coverage

- [x] A-004 R3: format.test.ts covers `/root`, `/root/x`, `/rootfs/x`, `/homeless/dir`, `/home` plus retained rows

### Edge Cases & Error Handling

- [x] A-005 R1: Boundary cases (`/rootfs/x`, `/home`, bare `/root`) behave per table — no loosening

### Code Quality

- [x] A-006 Pattern consistency: import idiom matches the file's existing `@/lib/format` import; comments state constraints only
- [x] A-007 No unnecessary duplication: exactly one home-substitution implementation remains in the frontend

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Merged matcher implemented as a single alternation regex extending the existing form (per intake row 6, left to apply; single regex is the minimal edit) | Either shape satisfies the table; one regex keeps the function one expression | S:60 R:90 A:85 D:75 |

1 assumptions (0 certain, 1 confident, 0 tentative).
