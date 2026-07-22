# Plan: View Switcher Menu-Only Placement

**Change**: 260722-n2n4-view-switcher-menu-only
**Intake**: `intake.md`

## Requirements

### Frontend: Top-Bar Overflow Registry — `menuOnly` Capability

#### R1: Generic `menuOnly` registry flag
The right-cluster overflow-registry entry type (`RegistryEntry` in `app/frontend/src/components/top-bar.tsx`) MUST gain an optional `menuOnly?: boolean` field. A `menuOnly: true` entry SHALL never render in-bar — it MUST be excluded from the visible candidate row, the hidden measurement probe, and the width-fit computation (it contributes zero pixels to the fit budget) — while its `menuRender()` rows SHALL always render in the overflow chevron menu (subject to the entry's existing `modes`/`hidden` gates), in registry (pyramid) order alongside overflowed fit candidates. The existing `hidden` field SHALL keep its "renders nowhere" priority over `menuOnly`.

- **GIVEN** a registry entry with `menuOnly: true` that passes its `modes` and `hidden` gates
- **WHEN** the top bar renders at ANY width (including widths where every fit candidate fits in-bar)
- **THEN** the entry's `barRender()` output appears neither in the visible row nor in the measurement probe
- **AND** the entry's `menuRender()` rows appear in the chevron menu, ordered by registry position relative to other overflowed entries

- **GIVEN** a registry entry with both `hidden: true` and `menuOnly: true`
- **WHEN** the top bar renders
- **THEN** the entry renders nowhere (no bar slot, no probe copy, no menu row)

#### R2: The `view-switcher` entry is menu-only
The `view-switcher` registry entry (the first entry of `rightItems`) MUST set `menuOnly: true`. Its existing `hidden` gate (terminal mode + `currentWindow` + `onSelectView` + `availableViews.length > 1`) SHALL be unchanged. The whole shared pill moves — including the `[tty|web]` case on iframe-URL windows. The `ViewSwitcher` pill component (`app/frontend/src/components/view-switcher.tsx`) and the entry's `barRender` wiring MUST stay in the codebase intact (unreachable under the flag), so reverting is a one-line flag removal. Observable result: the `view-toggle` testid appears nowhere in the DOM (bar or probe), and the `View: Terminal` / `View: Web` / `View: Chat` `menuitemradio` rows are present in the chevron menu at every width whenever the window offers more than one lens.

- **GIVEN** a terminal-route window offering more than one lens (web- and/or chat-capable)
- **WHEN** the page renders at a wide desktop width (e.g. 1440px) or a narrow mobile width (375px)
- **THEN** no in-bar switcher pill renders (no accessible `group` named "Window view"; no `view-toggle` testid anywhere in the DOM)
- **AND** the chevron menu contains one `View: {label}` `menuitemradio` row per available lens, as the first menu rows (registry order), with the active lens's row marked (`aria-checked="true"`, accent-green)

- **GIVEN** a tty-only (single-lens) window
- **WHEN** the page renders
- **THEN** no `View:` rows appear in the chevron menu (the entry's `hidden` gate keeps it out entirely)

#### R3: Fit computation and probe exclusion
The candidate pipeline in `top-bar.tsx` MUST split: fit candidates = `candidates.filter((e) => !e.menuOnly)`. Only fit candidates SHALL render in the hidden measurement probe row and contribute widths to `computeVisibleCount` — the probe's children MUST stay index-aligned with the widths array the fit reads. `visibleItems` SHALL be the fitting suffix of the fit candidates; `overflowItems` SHALL be the menuOnly entries plus the non-fitting fit candidates, listed in registry order. `computeVisibleCount` in `app/frontend/src/lib/top-bar-overflow.ts` MUST keep its signature and behavior — exclusion happens in the caller; its doc header (which names the ViewSwitcher as the first candidate) SHALL be updated. Comments in `top-bar.tsx` and `view-switcher.tsx` describing "first candidate / first to yield" in-bar behavior SHALL be updated to describe the menu-only state. Measure-effect dependencies that existed solely because the ViewSwitcher's probe width varied (`availableViews`, `activeView`) MAY be removed now that the pill is out of the probe.

- **GIVEN** the terminal route with a multi-lens window
- **WHEN** the fit computation runs
- **THEN** the probe row contains one child per fit candidate (no view-switcher copy), index-aligned with the measured widths array
- **AND** the pyramid drop order over fit candidates is unchanged — `split-vertical` is now the first candidate to yield under width pressure

#### R4: Everything else unchanged
The `Cmd/Ctrl+.` lens cycle, the command palette `View: Terminal/Web/Chat` actions, `?view=` deep links, and localStorage lens persistence MUST be untouched. `app/frontend/src/lib/window-view.ts` (`hasChat()` and capability derivation) MUST NOT be gated or feature-flagged. The backend MUST be unchanged (`chatProvider` keeps being emitted). The chevron menu itself (the always-present trailing exempt block) and the update row it hosts MUST be unchanged.

- **GIVEN** a chat-capable window
- **WHEN** the user presses `Cmd/Ctrl+.`, invokes a palette `View:` action, or opens a `?view=chat` deep link
- **THEN** the lens switches exactly as before this change

### Tests: E2E and Unit Rework

#### R5: Tests reach lenses via the menu rows or deep links; companion docs updated
E2E specs MUST reach non-tty views through the chevron `View: …` `menuitemradio` rows (or `?view=` deep links where the lens itself, not the switcher, is under test). Per the constitution's Test Companion Docs constraint, every modified `.spec.ts` MUST have its sibling `.spec.md` updated in the same commit-unit. Specifically:
- `tests/e2e/top-bar-overflow.spec.ts` (+ `.spec.md`): the "ViewSwitcher is the first-to-drop candidate (260717-6anu)" describe is rewritten to assert menu-only placement at all widths; drop-order coverage that used the ViewSwitcher as its subject retargets `split-vertical` as the new first fit candidate.
- `tests/e2e/chat-view.spec.ts` (+ `.spec.md`): lens switching routed through the menu rows or deep links; in-bar pill assertions become menu-row/pill-absence assertions.
- `tests/e2e/web-view-lens.spec.ts` (+ `.spec.md`): same rework for the `[tty|web]` case (the whole pill moves).
- `tests/e2e/window-heading.spec.ts`: comment-only ViewSwitcher reference — expected comment-only or no change (verify).
- `tests/e2e/connection-budget.spec.ts`: deep-link driven — expected no functional change (verify).
- Unit `src/components/top-bar.test.tsx`: add `menuOnly` coverage (no `view-toggle` anywhere in the DOM including the probe; `View:` rows always in the menu; single-view contributes nothing).
- Unit `src/components/view-switcher.test.tsx`: the component survives intact, so component tests stand; adjust only stale placement comments if any mislead.

Tests run through `just` recipes only (`just test-frontend`, `just pw test <name>`), never raw Playwright.

- **GIVEN** the reworked e2e suites
- **WHEN** `just pw test top-bar-overflow`, `just pw test web-view-lens`, and `just pw test chat-view` run
- **THEN** all pass, proving menu-only placement, menu-row lens switching, deep-link resolution, and no horizontal overflow at 375px

### Non-Goals

- No spec edit in the apply diff — `docs/specs/window-views.md` R4 drift is noted; memory/spec alignment is handled at hydrate (specs are human-curated).
- No removal of the `ViewSwitcher` pill component or its `barRender` wiring (the revert story depends on them staying intact).
- No feature flag on `hasChat()` or any capability derivation change.
- No backend or API change.

### Design Decisions

#### menuOnly is a registry capability, not a view-switcher hack
**Decision**: Implement the placement change as a generic optional `menuOnly` flag on `RegistryEntry`, honored by the candidate pipeline for any entry.
**Why**: Rides the existing overflow machinery (the menu-row rendering already exists and is wired); reverting when chat ships is deleting one flag; any future control can opt in.
**Rejected**: A one-off "skip the view-switcher" special case in the fit wiring — same diff size but not reusable and harder to revert cleanly. Removing the component or feature-flagging `hasChat()` — rejected in the discussion (breaks the web lens / hides chat capability).
*Introduced by*: 260722-n2n4-view-switcher-menu-only

#### Overflow list derived as "candidates minus visible"
**Decision**: Compute `overflowItems` by filtering the full candidate list against the set of visible (in-bar) entries, rather than concatenating menuOnly entries with the non-fitting prefix.
**Why**: One expression preserves registry order for free (menuOnly entries interleave correctly at their registry positions) and cannot double-count.
**Rejected**: Explicit concat of menuOnly + overflowed-fit-candidate lists — requires a re-sort by registry index to preserve order.
*Introduced by*: 260722-n2n4-view-switcher-menu-only

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependency changes; frontend-only edit of existing files)*

### Phase 2: Core Implementation

- [x] T001 Add the optional `menuOnly?: boolean` field to `RegistryEntry` in `app/frontend/src/components/top-bar.tsx` with a doc comment stating the semantics (never in-bar / never probed / zero fit pixels; `menuRender()` always in the menu; `hidden` keeps priority) <!-- R1 -->
- [x] T002 Set `menuOnly: true` on the `view-switcher` entry in `rightItems` (`top-bar.tsx`) and rewrite its registry comment (and the right-cluster JSX comments) from "first candidate / first to yield" to the menu-only state; keep `barRender`/`ViewSwitcher` intact <!-- R2 -->
- [x] T003 Split the candidate pipeline in `top-bar.tsx`: `fitCandidates = candidates.filter((e) => !e.menuOnly)`; probe row renders `fitCandidates` (index-aligned with the widths array); `candidateKey` derives from `fitCandidates`; `visibleItems` = fitting suffix of `fitCandidates`; `overflowItems` = candidates minus the visible set (registry order); drop the now-dead `availableViews`/`activeView` measure-effect deps; update measurement comments <!-- R1, R3 -->
- [x] T004 [P] Update doc comments in `app/frontend/src/components/view-switcher.tsx` (the `ViewSwitcher` header, the in-component "no hidden sm:*" comment, and the `ViewSwitcherMenuRows` header) to describe menu-only placement — the rows are the ONLY rendering while the flag is set <!-- R2 -->
- [x] T005 [P] Update the doc header of `app/frontend/src/lib/top-bar-overflow.ts` (it names the ViewSwitcher as the first non-exempt candidate); no signature/behavior change <!-- R3 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T006 Unit: in `app/frontend/src/components/top-bar.test.tsx`, add `menuOnly` coverage — on a multi-view window the `view-toggle` testid appears NOWHERE in the DOM (not even the aria-hidden probe), the `View:` `menuitemradio` rows are in the menu and lead the row order, and the probe contains no "Window view" group; update the stale probe-copy comments in the existing 260717-6anu tests; keep the single-view no-rows test <!-- R1, R2 -->
- [x] T007 [P] Unit: verify `app/frontend/src/components/view-switcher.test.tsx` needs no functional change (component intact); adjust only misleading placement comments <!-- R5 -->
- [x] T008 E2E: rewrite the "ViewSwitcher is the first-to-drop candidate (260717-6anu)" describe in `app/frontend/tests/e2e/top-bar-overflow.spec.ts` to a menu-only describe — (a) no in-bar pill and no `view-toggle` testid at any width in a sweep including 1440px and 375px, with `View:` rows present in the menu at both extremes; (b) fit candidates keep the pyramid with `split-vertical` as the new first-to-yield subject; (c) a `View:` row activation at a WIDE width switches the lens (URL `?view=web`, iframe renders) and closes the menu; update `app/frontend/tests/e2e/top-bar-overflow.spec.md` in the same commit-unit <!-- R2, R3, R5 -->
- [x] T009 E2E: rework `app/frontend/tests/e2e/web-view-lens.spec.ts` — route all lens flips through the chevron `View:` rows (helpers replace the `webChip`/`ttyChip` in-bar clicks), replace chip-presence/`aria-pressed` assertions with menu-row-presence/`aria-checked` (or pill-absence) assertions, and rework the 375px test's "inline on desktop" tail to assert menu-only at desktop too; update `web-view-lens.spec.md` <!-- R2, R5 -->
- [x] T010 E2E: rework `app/frontend/tests/e2e/chat-view.spec.ts` — the switcher-gating test asserts menu rows (present on @1, absent on @2), the flip test routes through the `View: Chat` menu row, tests that used the in-bar group merely as a readiness gate re-gate on a lens/heading surface, and the 375px test keeps its assertions with updated rationale comments; update `chat-view.spec.md` <!-- R2, R5 -->
- [x] T011 [P] Verify `app/frontend/tests/e2e/window-heading.spec.ts` (one comment-only ViewSwitcher reference, ~line 404) and `app/frontend/tests/e2e/connection-budget.spec.ts` (deep-link driven, no `view-toggle` reference) need no functional change; adjust the window-heading comment only if it becomes inaccurate <!-- R5 -->

### Phase 4: Polish

- [x] T012 Run the gates through `just` recipes: `just test-frontend` (Vitest incl. tsc-adjacent), `cd app/frontend && npx tsc --noEmit`, then `just pw test top-bar-overflow`, `just pw test web-view-lens`, `just pw test chat-view`, `just pw test window-heading`, `just pw test connection-budget`; fix any failures <!-- R5 -->

## Execution Order

- T001 → T002 → T003 (same file, sequential); T004/T005 parallel to each other after T002.
- T006 depends on T001–T003; T008–T010 depend on T002–T003; T007/T011 independent.
- T012 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `RegistryEntry` carries an optional documented `menuOnly` field; a flagged entry renders no bar slot, no probe copy, and zero fit pixels, while its menu rows always render (subject to `modes`/`hidden`)
- [x] A-002 R2: the `view-switcher` entry sets `menuOnly: true` with its `hidden` gate unchanged; the `view-toggle` testid appears nowhere in the DOM; `View:` rows are in the chevron menu at every width on a multi-lens window
- [x] A-003 R3: the probe renders only fit candidates, index-aligned with the widths array; `overflowItems` preserves registry order (the `View:` rows lead); `computeVisibleCount` keeps its signature and behavior

### Behavioral Correctness

- [x] A-004 R2: the `ViewSwitcher` pill component and the entry's `barRender` wiring remain intact and unreachable — revert is removing the one flag
- [x] A-005 R3: pyramid drop order over the remaining fit candidates is unchanged (`split-vertical` first to yield; L1 before L2 before L3)
- [x] A-006 R4: no changes to `window-view.ts`, palette `View:` actions, `Cmd/Ctrl+.` cycle, `Ctrl+\`` toggle, `?view=` deep links, localStorage persistence, or any backend file

### Scenario Coverage

- [x] A-007 R2: e2e proves menu-only placement at wide (1440px) and narrow (375px) widths, an active-row `aria-checked` marking, and a `View:` row activation switching the lens (URL + renderer) and closing the menu
- [x] A-008 R5: chat and web lens e2e suites reach non-tty lenses only via menu rows or `?view=` deep links; unit tests cover `menuOnly` exclusion (bar + probe) and menu-row presence

### Edge Cases & Error Handling

- [x] A-009 R1: a `hidden` entry with `menuOnly: true` renders nowhere (hidden keeps priority); a single-view window contributes no `View:` menu rows
- [x] A-010 R2: at 375px with a long window name there is no horizontal page overflow and the header stays single-line (chat + web mobile tests)

### Code Quality

- [x] A-011 Pattern consistency: new code follows the registry/fit wiring patterns and comment style of `top-bar.tsx`; type narrowing over assertions (no new `as` casts)
- [x] A-012 No unnecessary duplication: reuses `ViewSwitcherMenuRows`, the existing menu-row machinery, and `computeVisibleCount` unchanged; no new components
- [x] A-013 Test companion docs: every modified `.spec.ts` has its sibling `.spec.md` updated in the same commit-unit (constitution § Test Companion Docs)
- [x] A-014 No client polling introduced; no database/ORM; no route changes (constitution II/IV)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

Note: the intake/plan (R2, A-004, Non-Goals) DELIBERATELY retain the items below to keep the revert to a one-line flag removal. They are surfaced here as the change's now-unreachable code, NOT as a recommendation to delete now — delete only when the `menuOnly` flag is removed or chat ships.

- `app/frontend/src/components/view-switcher.tsx` `ViewSwitcher` component (the segmented pill) — unreachable while `menuOnly: true`; its `barRender` closure in `top-bar.tsx` never runs. Retained intentionally as the revert target.
- `top-bar.tsx` `view-switcher` entry `barRender: () => <ViewSwitcher …/>` — the only caller of the pill; dead under the flag. Retained intentionally.
- `top-bar.tsx` `RegistryEntry.barRender`'s use of `availableViews`/`activeView` (lines ~480–493) — these two slot props/args now feed only the unreachable `barRender`; they cannot be removed without breaking the intact-pill revert story, so they are correctly kept. Candidate for removal only alongside the pill.


## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `overflowItems` computed as candidates-minus-visible-set (single filter preserving registry order) rather than an explicit menuOnly+overflowed concat | Simplest expression satisfying intake §3's "menuOnly entries plus non-fitting fit candidates in registry order"; behavior-identical | S:70 R:95 A:90 D:75 |
| 2 | Confident | Remove the now-dead `availableViews`/`activeView` measure-effect deps in `top-bar.tsx` | They existed solely because the ViewSwitcher's probe width varied with segments; the pill is no longer in the probe, so they are dead weight — comment block must be rewritten anyway | S:60 R:90 A:85 D:75 |
| 3 | Confident | E2E suites keep `DESKTOP_VIEWPORT`/wide-width at 1440px with updated rationale comments, rather than re-tuning to 1280px | Minimal churn; 1440px remains a valid "everything fits" width — only the pill-drop-threshold rationale is stale | S:55 R:95 A:85 D:70 |
| 4 | Confident | chat-view tests that used the in-bar group only as a readiness gate re-gate on an always-present surface (heading / chat-view testid) | The gate's purpose was "page loaded", not switcher placement; menu-open gating would add needless clicks | S:60 R:90 A:85 D:75 |
| 5 | Certain | `view-switcher.test.tsx` component tests stand unchanged (component untouched); only comments may be adjusted | The intake scopes component survival explicitly; those tests render the component directly, not via the top bar | S:80 R:95 A:95 D:90 |
| 6 | Confident | New unit coverage asserts probe exclusion via `queryByTestId("view-toggle")` absence document-wide (jsdom overflows everything, so bar-vs-menu placement is not distinguishable in unit tests; the e2e carries the width-driven proof) | Matches the existing jsdom-limitation note in `top-bar.test.tsx` (zero widths → everything overflows); the intake's observable result is exactly "no `view-toggle` anywhere in the DOM" | S:65 R:90 A:85 D:75 |

6 assumptions (1 certain, 5 confident, 0 tentative).
