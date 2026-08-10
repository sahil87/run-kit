# Plan: Closed PR Row Glyph

**Change**: 260810-xuej-closed-pr-row-glyph
**Intake**: `intake.md`

## Requirements

### Frontend: Glyph gate + color (`pr-status-model.ts`)

#### R1: `prOwnsGlyph` admits closed
`prOwnsGlyph(win)` SHALL remain a **positive allowlist** and SHALL admit `prState === "closed"` alongside `open` and `merged` when `prNumber` is present. An absent/unknown `prState` (the backend's unconfident `""` fallback, serialized away via `omitempty`) SHALL still NOT own the glyph — the gate MUST NOT become a `!==` check. The gate's doc comment SHALL be updated (the "a dead closed PR never does" claim is no longer true).

- **GIVEN** a window with `prNumber: 7, prState: "closed"`
- **WHEN** `prOwnsGlyph(win)` is evaluated
- **THEN** it returns `true`
- **AND** `prOwnsGlyph(makeWindow({ prNumber: 7 }))` (absent `prState`) still returns `false`

#### R2: `prGlyphColor` gains a closed branch
`prGlyphColor(win)` SHALL gain a `closed` branch returning `text-text-secondary` (the established inert/no-journey token, shared with draft). The closed branch SHALL sit **above the fail branch** — a closed PR's check/review state is historical noise (the same first-match rationale that puts `merged` above `fail` in `prDotState`). A closed draft SHALL read closed (the draft branch is `open`-gated, so this falls out by construction).

- **GIVEN** a window with `prState: "closed"` and any checks/review/draft combination
- **WHEN** `prGlyphColor(win)` is evaluated
- **THEN** it returns `text-text-secondary` (muted — user decision: muted over GitHub-red)
- **AND** `prGlyphColor` for open/merged/failing/draft/pending inputs is unchanged

### Frontend: Closed icon + glyph surfaces

#### R3: New `GitPullRequestClosedIcon` (`sidebar/icons.tsx`)
A new exported `GitPullRequestClosedIcon` SHALL render the lucide `git-pull-request-closed` silhouette in the sibling icons' fixed idiom (`currentColor` stroke, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, 13px default size, `aria-hidden`): source-branch circle + vertical rail, an ✕ where the merge arc was, truncated target rail + target circle.

- **GIVEN** `sidebar/icons.tsx`
- **WHEN** the icon module is imported
- **THEN** `GitPullRequestClosedIcon` exists with `{ size = 13 }` props and the shared stroke idiom

#### R4: Window row picks the icon by state (`sidebar/window-row.tsx`)
The rest-state PR glyph (~line 573) SHALL render `GitPullRequestClosedIcon` when `win.prState === "closed"`, else the existing `GitPullRequestIcon`. Gate (`prOwnsGlyph`) and color (`prGlyphColor`) usage stay unchanged.

- **GIVEN** a sidebar window row with `prNumber` set
- **WHEN** `win.prState === "closed"`
- **THEN** the row renders the glyph (`data-testid="row-pr-glyph"`) with the closed ✕ icon and `text-text-secondary`

#### R5: Session tiles pick the icon by state (`session-tiles/session-tiles.tsx`)
The tile glyph (`data-testid="tile-pr-glyph"`) SHALL use the identical state-picked icon. Caveat: the file contains a deliberate NUL byte (~line 63) — search with `grep -a`/perl.

- **GIVEN** a session tile with `prNumber` set
- **WHEN** `win.prState === "closed"`
- **THEN** the tile renders the glyph with the closed ✕ icon and `text-text-secondary`

### Docs: reference SVG + status-dot page

#### R6: `docs/img/status-dot-reference.svg` — glyph strip five → six states
The "3 · PR" strip SHALL become six states: the combined gray `draft · closed → none` entry splits into `draft` (gray **normal** PR icon) and `closed` (gray **✕** closed icon, new `#prClosed` def/inline group); the section heading "five states" → "six states"; the bottom vocabulary note "5 glyph states" → "6 glyph states"; the `defs` color-legend comment gains the closed line. Visual idiom preserved (fill `#787c99` for both gray entries).

- **GIVEN** the reference SVG linked from `docs/site/status-dot.md` §3
- **WHEN** the glyph strip is read
- **THEN** it shows six labeled states including an explicit gray `closed` ✕ entry

#### R7: `docs/site/status-dot.md` — glyph/D2 prose updates
The page SHALL state: §3 heading "five states" → "six states"; the `prOwnsGlyph` allowlist is `open`/`merged`/`closed` (unknown/unconfident states still never own); the color table gains a `closed` row (gray `text-text-secondary`, distinct ✕ icon — muted dead PR; ✕ shape separates it from draft); "a closed-unmerged PR earns **no glyph**" → closed earns the muted ✕ glyph (register line unchanged); §D2 "earns no glyph" → now also feeds the muted ✕ glyph; the Row-Minimalism table row includes closed; the line near §PANE panel ("a closed PR keeps its register line but shows no row glyph") is updated accordingly.

- **GIVEN** `docs/site/status-dot.md`
- **WHEN** the glyph, D2, and Row-Minimalism sections are read
- **THEN** every mention of the closed-PR glyph reflects the new six-state vocabulary

### Tests

#### R8: Unit tests cover the closed glyph
- `pr-status-model.test.ts`: `prOwnsGlyph` admits closed (with `prNumber`), still rejects absent/unknown state; `prGlyphColor` returns `text-text-secondary` for closed — including closed+failing-checks and closed+draft (closed wins over both). The existing "never owns for a closed-unmerged PR (D2)" assertion SHALL be inverted to the new truth.
- `window-row.test.tsx` / `session-tiles.test.tsx`: a closed PR renders the glyph with the closed icon (distinguishable from the normal icon — e.g. the ✕ path count or a distinguishing marker); open/merged keep the existing icon. The existing "renders NO glyph for closed" assertions SHALL be updated to assert the muted ✕ glyph.

- **GIVEN** the updated implementation
- **WHEN** `just test-frontend` runs
- **THEN** all unit tests pass, including the new closed-glyph cases

#### R9: No Playwright spec regressions
If any `*.spec.ts` under `app/frontend/tests/` asserts glyph absence for a closed PR, it SHALL be updated together with its sibling `*.spec.md` (Constitution: Test Companion Docs). (Pre-check at plan time: no e2e spec references closed PRs — expected N/A.)

- **GIVEN** the e2e suite
- **WHEN** specs touching the PR glyph are inspected
- **THEN** none assert closed → no-glyph, or they are updated with companions

### Design artifact

#### R10: `dot-mock/` reflects the decided muted variant
The mock page in the change folder SHALL present the closed-PR proposal with the user's chosen **muted** variant as the decision (red explicitly rejected). The historical "closed → none" strip stays annotated as superseded, not edited away.

- **GIVEN** `fab/changes/260810-xuej-closed-pr-row-glyph/dot-mock/index.html`
- **WHEN** the page is opened
- **THEN** the muted-gray closed glyph is identifiable as the chosen design

### Non-Goals

- Backend changes — `prState: "closed"` already flows; `WindowInfo["prState"]` already includes it
- Status dot changes — the dot renders no PR state; local/remote split preserved
- Red closed glyph — rejected by the user after mock review (anti-clutter)
- GitHub-red `PR_STATE_COLORS.closed` change — the PANE panel text vocabulary is untouched

### Design Decisions

#### Muted gray closed glyph over GitHub red
**Decision**: closed renders `text-text-secondary` + the distinct ✕ closed icon; the ✕ shape alone separates closed from draft.
**Why**: dead PRs should not draw rest-state attention; user reviewed the mock and chose muted ("muted is ok").
**Rejected**: GitHub-exact red + ✕ — collides visually with fail-ish red attention and lights up dead PRs.
*Introduced by*: 260810-xuej-closed-pr-row-glyph

#### Closed branch above fail in `prGlyphColor`
**Decision**: `prState === "closed"` returns muted before the `prDotState === "fail"` check runs.
**Why**: a closed PR's checks/review are historical noise; mirrors the merged-above-fail first-match precedent in `prDotState`.
**Rejected**: letting fail win for closed PRs — a dead PR with stale failing checks would read red, the opposite of "dead, ignore".
*Introduced by*: 260810-xuej-closed-pr-row-glyph

## Tasks

### Phase 2: Core Implementation

- [x] T001 Extend `prOwnsGlyph` (allowlist + doc comment) and add the closed branch to `prGlyphColor` in `app/frontend/src/components/pr-status-model.ts` <!-- R1, R2 -->
- [x] T002 Add `GitPullRequestClosedIcon` to `app/frontend/src/components/sidebar/icons.tsx` in the sibling idiom <!-- R3 -->
- [x] T003 Pick glyph icon by state in `app/frontend/src/components/sidebar/window-row.tsx` (~line 573) <!-- R4 -->
- [x] T004 Pick glyph icon by state in `app/frontend/src/components/session-tiles/session-tiles.tsx` (NUL-byte caveat: `grep -a`) <!-- R5 -->
- [x] T005 Update `app/frontend/src/components/pr-status-model.test.ts` — closed admitted, muted color wins over fail/draft <!-- R8 -->
- [x] T006 Update `app/frontend/src/components/sidebar/window-row.test.tsx` — closed renders muted ✕ glyph; open/merged keep normal icon <!-- R8 -->
- [x] T007 Update `app/frontend/src/components/session-tiles/session-tiles.test.tsx` — same on tiles <!-- R8 -->

### Phase 3: Docs & Sweep

- [x] T008 Update `docs/img/status-dot-reference.svg` — glyph strip five → six states (split draft/closed, `#prClosed` def, heading + vocabulary note) <!-- R6 -->
- [x] T009 Update `docs/site/status-dot.md` — §3 heading/allowlist/color-table, no-glyph sentence, §D2, Row-Minimalism row, PANE-panel line <!-- R7 -->
- [x] T010 Verify `dot-mock/` page reflects the muted decision; sweep `app/frontend/tests/e2e/` for closed-glyph assertions (update spec + `.spec.md` if any) <!-- R9, R10 -->

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `prOwnsGlyph` returns true for closed PRs with a `prNumber`, false for absent/unknown `prState`
- [ ] A-002 R2: `prGlyphColor` returns `text-text-secondary` for closed PRs regardless of checks/review/draft, and the closed branch sits above the fail branch
- [ ] A-003 R3: `GitPullRequestClosedIcon` is exported from `sidebar/icons.tsx` in the shared stroke idiom
- [ ] A-004 R4: a sidebar window row with a closed PR renders `row-pr-glyph` with the ✕ icon in `text-text-secondary`
- [ ] A-005 R5: a session tile with a closed PR renders `tile-pr-glyph` with the ✕ icon in `text-text-secondary`
- [ ] A-006 R6: `docs/img/status-dot-reference.svg` shows a six-state glyph strip with an explicit gray closed ✕ entry
- [ ] A-007 R7: `docs/site/status-dot.md` glyph/D2/Row-Minimalism prose matches the new behavior
- [ ] A-008 R10: the `dot-mock/` page presents the muted variant as the decided design

### Behavioral Correctness

- [ ] A-009 R1: the gate remains a positive allowlist — a stateless PR (`prNumber` set, `prState` absent) renders no glyph
- [ ] A-010 R2: open/merged/failing/draft/pending glyph colors are unchanged

### Scenario Coverage

- [ ] A-011 R8: `just test-frontend` passes with the new closed-glyph cases (model, window-row, session-tiles)
- [ ] A-012 R8: a closed PR with failing checks and a closed draft both render the muted ✕ glyph (closed wins)

### Edge Cases & Error Handling

- [ ] A-013 R9: no Playwright spec asserts closed → no-glyph (or such specs + `.spec.md` companions are updated in this change)

### Code Quality

- [ ] A-014 Pattern consistency: the new icon and state-pick follow the existing `icons.tsx` idiom and glyph render sites
- [ ] A-015 No unnecessary duplication: the state-pick reuses `win.prState === "closed"` at both surfaces without new abstraction
- [ ] A-016 New behavior is covered by tests (code-quality.md: new features MUST include tests)
- [ ] A-017 No magic tokens: muted gray reuses the established `text-text-secondary` token

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend `prOwnsGlyph` as a positive allowlist (open/merged/closed), never a `!==` check | Load-bearing constraint documented in the gate's own comment (absent-state protection) | S:90 R:85 A:95 D:95 |
| 2 | Certain | Closed renders `text-text-secondary` + the distinct ✕ icon; ✕ shape alone separates closed from draft | User decided after mock review — red variant explicitly rejected | S:95 R:95 A:95 D:90 |
| 3 | Certain | Distinct closed icon (lucide `git-pull-request-closed` silhouette) in the `icons.tsx` idiom | GitHub disambiguates by shape, not color; icons.tsx has a fixed line-art idiom to follow | S:85 R:80 A:85 D:75 |
| 4 | Confident | `closed` branch sits above `fail` in `prGlyphColor` | Mirrors the merged-above-fail precedent in `prDotState`'s first-match order | S:70 R:90 A:80 D:70 |
| 5 | Certain | Both glyph surfaces (window-row + session-tiles) pick the icon by state | pr-status-model's header names both as glyph consumers; leaving tiles behind would fork the vocabulary | S:75 R:85 A:90 D:85 |
| 6 | Certain | Frontend-only — backend already emits `prState: "closed"` | The PANE panel renders `closed (draft)` today; `WindowInfo["prState"]` already includes it | S:85 R:90 A:95 D:95 |
| 7 | Certain | Update `docs/img/status-dot-reference.svg` (five → six states) + `docs/site/status-dot.md` prose | Explicit user direction at go-ahead; the SVG is linked from the doc page | S:95 R:90 A:90 D:95 |

7 assumptions (6 certain, 1 confident, 0 tentative).
