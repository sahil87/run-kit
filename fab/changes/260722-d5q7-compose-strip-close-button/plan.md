# Plan: Compose Strip Close Button

**Change**: 260722-d5q7-compose-strip-close-button
**Intake**: `intake.md`

## Requirements

### Compose Strip: Close Button

#### R1: On-strip close affordance wired to the existing toggle
The compose strip (`app/frontend/src/components/compose-strip.tsx`) MUST render a small × close button in its `→ {target}` header row, whose `onClick` invokes `toggleComposeStrip()` obtained via `useChromeDispatch()` (`app/frontend/src/contexts/chrome-context.tsx`) — the exact same action the bottom-bar `>_` chip and the `View: Text Input` palette entry fire. The component MUST consume the context itself so both mounts (`app.tsx` terminal-route footer and `board-page.tsx` board-route footer) inherit the button with zero per-route edits. No confirmation dialog SHALL be shown — closing is lossless because the draft lives in the module store (`compose-draft-store.ts`).

- **GIVEN** the compose strip is enabled (`composeStripEnabled` on) and rendered on any route
- **WHEN** the user clicks the × close button
- **THEN** `toggleComposeStrip()` runs, `composeStripEnabled` flips off, and the strip unmounts (the `>_` chip returns to `aria-pressed="false"`)
- **AND** no confirmation dialog is shown; the unsent draft (text + attachments) survives in the module store and reappears on re-enable

#### R2: Placement and right-alignment mechanics
The × MUST occupy the far-right slot of the header row, with the conditional "Uploading…" status rendered immediately before (left of) it. The × MUST remain right-aligned whether or not the uploading status is rendered — the current `ml-auto` on the uploading span is reworked (e.g., a single `ml-auto` flex container grouping uploading + ×).

- **GIVEN** the strip header row with no upload in flight
- **WHEN** the row renders
- **THEN** the × sits at the far right of the header row
- **GIVEN** an upload is in flight (`uploading` true)
- **WHEN** the row renders
- **THEN** the "Uploading…" status appears immediately left of the ×, and the × keeps the far-right slot

#### R3: Focus discipline
The × MUST carry `onMouseDown={preventFocusSteal}` like every other button in the strip (📎 / Insert / Send / attachment-remove ×), so clicking it never steals focus from the terminal.

- **GIVEN** a terminal pane holds focus
- **WHEN** the user presses the mouse down on the ×
- **THEN** the mousedown's default action is prevented (no focus transfer to the button)

#### R4: Form, touch target, accessibility, testability
The × MUST follow the strip's secondary-button vocabulary (`text-text-secondary` default, hover border highlight, `rk-glint`), sized to fit the compact `text-xs` header row, and MUST carry the coarse-pointer touch treatment consistent with the strip's other buttons (`coarse:min-h-[36px]`-style — NOT the 16px attachment-remove pattern). It MUST have the accessible name `aria-label="Close compose strip"` and `data-testid="compose-strip-close"`.

- **GIVEN** a coarse-pointer (touch) device
- **WHEN** the strip renders
- **THEN** the × meets the ≥36px coarse touch-target treatment
- **GIVEN** any device
- **WHEN** the strip renders
- **THEN** the button is reachable by accessible name "Close compose strip" and by testid `compose-strip-close`, styled per the secondary-button vocabulary

#### R5: Preserved behaviors (no regressions)
Escape in the textarea SHALL continue to blur back to the terminal and NEVER close the strip. The toggle mechanism itself (`composeStripEnabled` persistence to `runkit-compose-strip`, the `>_` chip, the palette entry) SHALL be untouched. No new keyboard shortcut SHALL be added (palette + chip already satisfy Constitution V; the × is a pointer convenience).

- **GIVEN** the strip textarea has focus
- **WHEN** the user presses Escape
- **THEN** the textarea blurs back to the terminal and the strip stays mounted (unchanged behavior)

#### R6: Test coverage and companion doc
Unit coverage (`compose-strip.test.tsx`) MUST assert the × renders and clicking it invokes the toggle (strip closes; draft survives close→reopen). E2e coverage (`tests/e2e/compose-strip.spec.ts`) MUST assert clicking the × closes the strip (and the draft survives close→reopen), and the sibling `compose-strip.spec.md` MUST be updated in the same change (Constitution § Test Companion Docs).

- **GIVEN** the change is complete
- **WHEN** `just test-frontend` and `just pw test compose-strip` run
- **THEN** all unit and e2e tests pass, including the new ×-close coverage, and `compose-strip.spec.md` documents the new/modified e2e test(s)

### Non-Goals

- No Escape-closes behavior — explicitly rejected in the intake; Escape semantics are unchanged (R5)
- No new keyboard shortcut for the toggle — already keyboard-reachable via palette + chip
- No confirmation/warning dialog on close — draft is lossless via the module store
- No changes to ChromeContext, backend, API, or routing

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the × close button to the header row of `app/frontend/src/components/compose-strip.tsx`: import and consume `useChromeDispatch()` from `@/contexts/chrome-context`, render a `<button>` with `onClick={toggleComposeStrip}` at the far right of the `→ {target}` row <!-- R1 -->
- [x] T002 Rework the header-row right-alignment in `compose-strip.tsx`: group the conditional "Uploading…" status and the × in a single `ml-auto` flex container so the × stays far-right whether or not the uploading status renders (uploading immediately left of the ×) <!-- R2 -->
- [x] T003 Apply the button contract to the × in `compose-strip.tsx`: `onMouseDown={preventFocusSteal}`, secondary-button styling (`rk-glint`, `text-text-secondary`, hover border highlight, compact `text-xs` sizing), coarse touch treatment (`coarse:min-h-[36px] coarse:min-w-[36px]`), `aria-label="Close compose strip"`, `data-testid="compose-strip-close"` <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T004 [P] Add Vitest unit coverage in `app/frontend/src/components/compose-strip.test.tsx`: (a) with `runkit-compose-strip` seeded on and a conditional-mount harness (`composeStripEnabled && <ComposeStrip />` under the real `ChromeProvider`), the × renders with its accessible name and clicking it closes the strip; re-toggling on restores the strip with the draft intact; (b) mousedown on the × is default-prevented (no focus steal); Escape-blur regression stays green <!-- R6 -->
- [x] T005 [P] Add an e2e test to `app/frontend/tests/e2e/compose-strip.spec.ts`: enable the strip via the `>_` chip, type a draft, click `compose-strip-close` — the strip unmounts and the chip returns to `aria-pressed="false"`; re-enable via the chip — the draft is still in the textarea <!-- R6 -->
- [x] T006 Update the companion doc `app/frontend/tests/e2e/compose-strip.spec.md` with the new test's "what it proves" + numbered steps (same change as the `.spec.ts` edit, per Constitution § Test Companion Docs) <!-- R6 -->
- [x] T007 Run `just test-frontend` (Vitest) and `just pw test compose-strip` (e2e, port 3020 isolated tmux server); fix any failures <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The × renders in the strip's header row and clicking it fires `toggleComposeStrip()` — the strip closes and the `>_` chip reads unpressed; both route mounts inherit the button with no per-route edits (the component consumes `useChromeDispatch()` itself)
- [x] A-002 R2: The × occupies the far-right header slot; the "Uploading…" status, when present, sits immediately left of it; right-alignment holds in both states
- [x] A-003 R3: The × carries `onMouseDown={preventFocusSteal}` — mousedown is default-prevented like the strip's other buttons
- [x] A-004 R4: The × carries `aria-label="Close compose strip"`, `data-testid="compose-strip-close"`, secondary-button styling (`rk-glint`, `text-text-secondary`, hover border highlight), and the `coarse:` ≥36px touch treatment (not the 16px attachment-remove pattern)

### Behavioral Correctness

- [x] A-005 R1: Closing via the × shows no confirmation and loses no draft — text + attachments survive close→reopen via the module store
- [x] A-006 R5: Escape still blurs the textarea and never closes the strip; `composeStripEnabled` persistence, the chip, and the palette entry are untouched; no new keyboard shortcut added (verified: Escape/keydown/blur logic is entirely absent from the diff — the only edits are the header-row cluster + the `useChromeDispatch` import/consumption)

### Scenario Coverage

- [x] A-007 R6: Unit tests cover ×-render, ×-close (toggle semantics under the real ChromeProvider), draft survival across ×-close→reopen, and mousedown prevention — `just test-frontend` passes (1767 passed)
- [x] A-008 R6: The e2e spec covers ×-close (strip unmounts, chip unpressed) and draft survival on reopen — `just test-e2e compose-strip` passes (5 passed); `compose-strip.spec.md` is updated in the same change

### Code Quality

- [x] A-009 Pattern consistency: The new button follows the strip's existing button vocabulary and naming (`compose-strip-*` testid, `preventFocusSteal`, `rk-glint`, `coarse:` variants)
- [x] A-010 No unnecessary duplication: Reuses `toggleComposeStrip` from ChromeContext (no new state/preference/prop-threading); no reimplementation of the toggle
- [x] A-011 Type safety: No `as` casts introduced in production code (`tsc --noEmit` passes); context consumed via the typed `useChromeDispatch()` hook

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is purely additive (a new on-strip close affordance) and makes no existing code redundant. The `>_` bottom-bar chip (`bottom-bar.tsx:365`) and the `View: Text Input` palette entry remain intentional alternate toggle paths — Constitution V (Keyboard-First) requires the keyboard-reachable ones, and the × is a pointer-only convenience alongside them, not a replacement.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Unit tests assert toggle semantics via a conditional-mount harness (`composeStripEnabled && <ComposeStrip />`) under the real `ChromeProvider` with `runkit-compose-strip` seeded in localStorage — not a mocked context | Existing tests already wrap the strip in the real `ChromeProvider`; a conditional mount mirrors the actual `app.tsx`/`board-page.tsx` gating, making the test faithful to production wiring | S:60 R:90 A:85 D:75 |
| 2 | Confident | The × glyph is a text "×" inside the button (no icon library), with the accessible name on the button's `aria-label` | Matches the attachment-remove × precedent and the project's text-glyph convention; no icon library is used in the strip | S:55 R:95 A:90 D:80 |
| 3 | Confident | Coarse treatment is `coarse:min-h-[36px] coarse:min-w-[36px]` (both axes) since the × is a narrow glyph without the horizontal padding that gives the strip's wider buttons their width | The strip's other buttons use only `coarse:min-h-[36px]` because px-2/px-3 padding supplies width; a bare × needs `min-w` too to meet the 36px target (context.md's 36px touch convention) | S:60 R:90 A:85 D:75 |
| 4 | Confident | E2e coverage is a new dedicated `test()` (close + draft-survival) rather than extending the existing toggle test | Keeps the existing 4 tests' contracts untouched in `.spec.md`; a dedicated test documents the new affordance cleanly; each Playwright test gets a fresh context so the off-by-default precondition holds | S:55 R:85 A:85 D:70 |
| 5 | Confident | Compact fine-pointer sizing: small padding (`px-1.5 py-0.5`, `leading-none`) so the header row stays visually compact while keeping the bordered secondary-button look | Intake requires "sized to fit the compact `text-xs` header row" with a hover border highlight — a bordered button needs some padding; exact values are freely reversible styling | S:50 R:95 A:80 D:65 |

5 assumptions (0 certain, 5 confident, 0 tentative).
