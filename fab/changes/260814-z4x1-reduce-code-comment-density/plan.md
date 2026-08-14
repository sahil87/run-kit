# Plan: Reduce Code Comment Density

**Change**: 260814-z4x1-reduce-code-comment-density
**Intake**: `intake.md`

## Requirements

### Process: Comment anti-pattern rule

#### R1: Anti-pattern rule in code-quality.md
`fab/project/code-quality.md` `## Anti-Patterns` MUST gain a comment-narration bullet stating the positive criterion (comments state constraints the code can't show — invariants, cross-file contracts, non-obvious "why") and all four prohibited forms: narrating the next line, mirroring sibling code, reviewer-directed prose, and change-ID / PR-number citations. `code-review.md` SHALL NOT be edited — anti-patterns already flow into review acceptance via plan generation.

- **GIVEN** a future apply or review stage loads `fab/project/code-quality.md`
- **WHEN** it reads `## Anti-Patterns`
- **THEN** the comment-narration rule is present as one bullet alongside the existing anti-patterns
- **AND** no other file carries the rule

### Cleanup: Comment distillation sweep

#### R2: Distill the four named targets
The sweep MUST walk every comment in `app/frontend/src/globals.css` (flair overlays block only), `app/backend/api/sessions.go`, `app/backend/api/settings.go`, and `app/frontend/src/components/swatch-popover.tsx`, keeping (condensed where possible) only comments that state constraints the code can't show, and deleting narration, sibling-mirroring, reviewer-directed prose, and change-ID/PR citations. Functional and navigational comments MUST survive: `review-ignore` suppressions, lint/ts directives, Go doc comments on exported identifiers (condensed but present), and CSS section banners (`── … ──`).

- **GIVEN** the flair block's ~60-line banner in `globals.css`
- **WHEN** the sweep distills it
- **THEN** the stacking-context/source-order design constraint and reduced-motion note survive condensed, while value enumeration and section-mirroring prose are gone
- **GIVEN** `sessions.go`'s rename handlers
- **WHEN** the sweep distills them
- **THEN** the permissive-SOURCE vs tightened-TARGET validation asymmetry remains documented (condensed), and per-field decode narration collapses to the one non-obvious fact (unknown-key/case-fold JSON semantics deliberately preserved)
- **GIVEN** `swatch-popover.tsx`
- **WHEN** the sweep distills it
- **THEN** the legacy-value normalization contract and `undefined` vs `null` sentinel semantics remain, while render-gating narration ("renders only when callback present") is deleted

#### R3: Behavior preservation
The sweep MUST change zero executable lines — the diff in the four swept files touches only comments (and whitespace left by removed comment blocks). Verification gates MUST pass: `go test ./...` in `app/backend/`, `npx tsc --noEmit` in `app/frontend/`, and the colocated `swatch-popover.test.tsx` suite.

- **GIVEN** the completed sweep
- **WHEN** `git diff` is inspected for the four swept files
- **THEN** every removed/changed line is a comment line (or blank line churn), and all three gates pass

### Non-Goals

- Repo-wide comment sweep — the rule prevents new accumulation; only the four measured heavy hitters are swept
- Numeric density target — the keeper criterion is qualitative per comment; a quota would incentivize deleting keeper comments
- Editing `fab/project/code-review.md` — anti-patterns already reach review via plan generation

## Tasks

### Phase 1: Setup

- [x] T001 Add the comment-narration bullet to `fab/project/code-quality.md` `## Anti-Patterns` (positive criterion + four prohibited forms) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 [P] Distill the flair overlays comment block in `app/frontend/src/globals.css` (banner ~lines 542–600 + per-keyframe comments); keep the stacking-context/source-order constraint and reduced-motion note, keep `── … ──` section banners <!-- R2 -->
- [x] T003 [P] Distill channel-handler comments in `app/backend/api/sessions.go` and `app/backend/api/settings.go`; keep the rename-validation asymmetry and the descriptor contract, condense per-field decode narration, keep exported-identifier doc comments <!-- R2 -->
- [x] T004 [P] Distill comments in `app/frontend/src/components/swatch-popover.tsx`; keep normalization contract + `undefined`/`null` sentinel semantics, delete render-gating narration <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Verify behavior preservation: comment-only diff check on the four swept files, then `go test ./...` (app/backend), `npx tsc --noEmit` (app/frontend), and the `swatch-popover` unit suite <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `fab/project/code-quality.md` `## Anti-Patterns` contains the comment-narration bullet with the positive criterion and all four prohibited forms; no other file was edited for the rule
- [x] A-002 R2: All four targets are distilled — remaining comments each state a constraint the code can't show; narration, sibling-mirroring, and change-ID/PR citations are gone

### Behavioral Correctness

- [x] A-003 R3: The diff in the four swept files contains no executable-line changes — comment and blank lines only (plus gofmt field-alignment whitespace on the `set`/`unset` struct fields in sessions.go, tokens identical)

### Scenario Coverage

- [x] A-004 R2: Spot-check keepers survived: rename-validation asymmetry (sessions.go), descriptor contract (sessions.go), stacking-context constraint + reduced-motion note (globals.css), normalization contract + sentinel semantics (swatch-popover.tsx)

### Edge Cases & Error Handling

- [x] A-005 R2: Functional markers preserved — no `review-ignore` / lint / ts directives existed in the swept ranges (grep-verified); Go doc comments on the handler identifiers still present (condensed); CSS `── Flair overlays ──` section banner intact

### Code Quality

- [x] A-006 Pattern consistency: Surviving comments match surrounding comment idiom (Go doc-comment form, CSS banner form)
- [x] A-007 No unnecessary duplication: The rule text lives in exactly one place (`code-quality.md` — grep of fab/project/ confirms a single occurrence)
- [x] A-008 Verification gates: `go test ./...`, `npx tsc --noEmit`, and the swatch-popover unit suite (47 tests) all pass; gofmt clean

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | sessions.go + settings.go grouped as one task (T003) | Same channel-handler seam (PR #608), same treatment, small combined size — one focused session | S:75 R:90 A:85 D:80 |
| 2 | Certain | Go doc comments on exported identifiers are kept (condensed), never deleted | Go documentation convention; golint/pkgsite expect them | S:85 R:90 A:95 D:90 |
| 3 | Confident | Blank-line churn from removed comment blocks counts as comment-only for R3 | Removing a comment block naturally collapses surrounding blank lines; executable lines still untouched | S:70 R:85 A:85 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).

## Deletion Candidates

- None — comment-only distillation plus one config-rule bullet; no existing code, symbol, or config made redundant or unused.
