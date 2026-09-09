# Plan: Omnibox Placeholder Clarity

**Change**: 260909-ae2w-omnibox-placeholder-clarity
**Intake**: `intake.md`

## Requirements

### run-kit/ui: Operator omnibox placeholder

#### R1: The short placeholder does not repeat the operator glyph
Below the `2xl` rung (viewport < 1536px), the omnibox input's placeholder MUST be `Ask…` — the standing `◉` glyph rendered beside the input already names the operator, so the placeholder SHALL NOT contain a second `◉`.

- **GIVEN** a desktop viewport at `lg` or `xl` (≥ 1024px, < 1536px)
- **WHEN** the omnibox renders at rest
- **THEN** the input's `placeholder` attribute is exactly `Ask…`
- **AND** the standing `◉` glyph (`OperatorStateGlyph`) still renders to the left of the input

#### R2: The placeholder gate stays width-only
The placeholder MUST be selected by the `extraWide` media query alone. Engaging the box (focus, chord, morph) MUST NOT switch the placeholder to the long form below `2xl`, because the mounted context chip leaves the input roughly 12ch inside the `w-[34ch]` engaged box and `Ask the operator…` (18ch) would clip mid-word.

- **GIVEN** a `lg`/`xl` viewport and the console machine entered at `open` (box engaged, `w-[34ch]`)
- **WHEN** the omnibox re-renders
- **THEN** the input's `placeholder` is still `Ask…`

#### R3: The ≥ 2xl placeholder and accessible names are unchanged
At ≥ `2xl` the placeholder MUST remain `Ask the operator…`. The `aria-label="Ask the operator"` on the input and on the md–lg ghost MUST remain unchanged, and the ghost's visible `· ◉ ask` text MUST remain unchanged.

- **GIVEN** a viewport ≥ 1536px
- **WHEN** the omnibox renders
- **THEN** the input's `placeholder` is `Ask the operator…` and its `aria-label` is `Ask the operator`

#### R4: Docs that quote the placeholder carry the new string
`docs/site/skill/tutorial.md` and the hand-maintained HTML tutorial `app/frontend/public/tutorial/tutorial.html` MUST quote the new short placeholder (`"Ask…"`) where they currently quote `"Ask ◉…"`, and any embedded copy the backend serves via `rk skill tutorial` MUST be re-synced so the drift guard passes (Constitution § Toolkit Standards, `shll standards skill`: topic pages are byte-identical to their embedded copies).

- **GIVEN** the tutorial topic page
- **WHEN** it describes typing into the top-bar box
- **THEN** it quotes `"Ask…"`, and the drift-guard test for embedded skill pages passes

### Non-Goals

- Changing any omnibox width (`w-[12ch]`, `2xl:w-[20ch]`, `w-[34ch]`, `max-w-[40vw]`) — the 12ch resting cap protects the breadcrumbs' min-useful-width at `lg`/`xl`.
- Changing the context chip's `max-w-[14ch]` truncation or its `…`.
- Any keyboard, focus, send-lane, or drawer behavior.
- Memory edits — hydrate owns `docs/memory/run-kit/ui/operator-console.md` and `top-bar.md`.

### Design Decisions

#### The placeholder does not name the operator twice
**Decision**: The `lg`/`xl` placeholder is `Ask…`; the standing `◉` glyph beside the input is the operator's name in the box.
**Why**: `Ask ◉…` rendered as `◉ Ask ◉…` — two glyphs and a dangling ellipsis that read as a truncated label, especially beside the chip's own truncation `…`. `Ask…` is 4ch (vs 6ch) and sits comfortably in the 12ch resting budget, following the codebase's trailing-ellipsis placeholder convention.
**Rejected**: Switching to `Ask the operator…` whenever engaged — the chip caps the input at ~12ch so the 18ch phrase clips mid-word. Dropping the ellipsis (`Ask`) — reads as a button label and breaks the placeholder convention. Widening the resting box — trades away the crumbs' width budget for a placeholder.
*Introduced by*: 260909-ae2w-omnibox-placeholder-clarity

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/frontend/src/components/operator-omnibox.tsx`, change `placeholder={extraWide ? "Ask the operator…" : "Ask ◉…"}` to `placeholder={extraWide ? "Ask the operator…" : "Ask…"}`; update the header comment's quoted `"Ask ◉…"` to `"Ask…"` and add one clause stating the standing glyph already names the operator so the placeholder does not repeat it (and that the gate is width-only because the chip caps the engaged input width). <!-- R1, R2, R3 -->
- [x] T002 In `app/frontend/src/components/operator-omnibox.test.tsx`, change the `≥ lg rung` expectation from `"Ask ◉…"` to `"Ask…"`, and in the wide-rung engaged test (the one asserting `w-[34ch]` after `requestOperatorConsole({ action: "open" })`) add an assertion that the input's `placeholder` is still `"Ask…"` while engaged. Run the omnibox spec through `just` (scoped), then the frontend unit suite. <!-- R1, R2, R3 -->

### Phase 2: Docs

- [x] T003 In `docs/site/skill/tutorial.md` line 61, change `("Ask ◉…")` to `("Ask…")`; locate the embedded-skill sync script / drift guard (grep `skill/tutorial` under `scripts/` and `app/backend/`), re-run the sync so the embedded copy matches, and run the drift-guard Go test. <!-- R4 -->
- [x] T004 In `app/frontend/public/tutorial/tutorial.html` (the hand-maintained HTML tutorial the skill tutorial opens via `rk present`), change the chapter-3 legend's `("Ask ◉…")` to `("Ask…")`; then sweep the WHOLE repo for `Ask ◉` across every file type (no `--include` filter; exclude `node_modules`, `.git`, `fab/changes/`, `docs/memory/`) and fix any remaining quote. <!-- R4 --> <!-- rework: review cycle 1 — A-002 sweep found tutorial.html still quoting the old string; the intake grep filtered to ts/tsx/md and missed .html -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: At `lg`/`xl` the omnibox input placeholder is exactly `Ask…` and the standing `◉` glyph still renders beside it.
- [x] A-002 R4: `docs/site/skill/tutorial.md` and `app/frontend/public/tutorial/tutorial.html` quote `"Ask…"`, and no file of any type under the repo (excluding `node_modules`, `.git`, `fab/changes/`, `docs/memory/`) still contains `Ask ◉…`.

### Behavioral Correctness

- [x] A-003 R2: With the box engaged at `lg`/`xl` (machine `open`, `w-[34ch]`), the placeholder is still `Ask…` — no `engaged` branch in the placeholder expression.
- [x] A-004 R3: At ≥ `2xl` the placeholder is `Ask the operator…`; `aria-label="Ask the operator"` is unchanged on the input and ghost; the ghost text `· ◉ ask` is unchanged.

### Removal Verification

- [x] A-005 **N/A**: No requirements are deprecated by this change.

### Scenario Coverage

- [x] A-006 R1: The `≥ lg rung` unit test asserts `placeholder="Ask…"`.
- [x] A-007 R2: A wide-rung engaged unit test asserts the placeholder stays `Ask…` after entering `open`.
- [x] A-008 R4: The embedded-skill drift-guard test passes after the tutorial edit (embedded copy re-synced).

### Edge Cases & Error Handling

- [x] A-009 **N/A**: Copy-only change; no error states or boundary conditions introduced.

### Code Quality

- [x] A-010 Pattern consistency: The header comment states the constraint (why the glyph is not repeated, why the gate is width-only) without narrating the code or citing change IDs / PR numbers.
- [x] A-011 No unnecessary duplication: No new helpers, constants, or branches were introduced for a one-string change.
- [x] A-012 Tests cover the changed behavior (new fix includes a test per `code-quality.md`).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — review cycle 2 confirms: the change replaces a placeholder string and doc quotes in place; it makes no existing file, function, branch, or config redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The tutorial edit requires re-syncing the embedded skill copy | `shll standards skill` mandates byte-identical embedded topic pages with a drift-guard test | S:80 R:95 A:95 D:95 |
| 2 | Confident | The engaged-state placeholder assertion is added to the existing outside-focus/`w-[34ch]` test rather than a new test | Smallest diff; the test already enters `open` at the wide rung | S:60 R:95 A:85 D:75 |
| 3 | Certain | No Playwright e2e test is added | Placeholder text is fully covered by the unit spec; no e2e spec references it and no layout changes | S:70 R:95 A:90 D:85 |

3 assumptions (2 certain, 1 confident, 0 tentative).
