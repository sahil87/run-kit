# Plan: Unified Toolbar Update Button

**Change**: 260720-ml7k-unified-toolbar-update-button
**Intake**: `intake.md`

## Requirements

### Frontend: Resting check affordance on the overflow-menu version row

#### R1: Check-again affordance renders on the resting version row
The overflow menu's version row (`app/frontend/src/components/top-bar-overflow-menu.tsx`) MUST render a check-again icon button (lucide rotate-cw glyph, `aria-label="Check for updates"`, matching `title`) alongside the version text whenever the row is NOT currently the update surface AND the daemon is not the `dev` sentinel (`daemonVersion === "dev"` hides it; a `null` daemonVersion — no `event: version` yet — counts as non-dev, the same gate as `buildCheckActions`). The affordance MUST be a plain (non-`role="menuitem"`) control so clicking it does not trigger the container's terminal-action menu-close, keeping the in-flight state visible.

- **GIVEN** a non-dev daemon with no update surface showing (no qualifying update, or the chip is in-bar)
- **WHEN** the user opens the overflow chevron menu
- **THEN** the version row shows the running version plus a ⟳ button labeled "Check for updates"

- **GIVEN** a daemon reporting `daemonVersion === "dev"`
- **WHEN** the overflow menu is opened
- **THEN** the version row is the plain copy row with NO check affordance

#### R2: Click runs the plain notable check with existing toast reporting
Clicking the check affordance MUST run the plain notable check — `runUpdateCheck(false)` from the existing `useUpdateCheck` hook — reporting through that hook's existing flow: one info toast via `composeCheckToast` on success (with the existing brew-gated "Update Now" action slot), one error toast on failure. No new reporting surface, no incl.-patches variant (that stays palette-only).

- **GIVEN** the resting version row with the check affordance
- **WHEN** the user clicks ⟳
- **THEN** `POST /api/updates/check` fires once and the result reports via the existing check toast
- **AND** if the check finds a notable update, the shared verdict updates and the chip promotes into the bar (or the menu row swaps to its update surface) purely by derivation

#### R3: In-flight spinner + single-flight
While a check is in flight the affordance MUST show a busy state (`LogoSpinner`) and be disabled; repeat invocations MUST be no-ops until the response lands (single-flight), including double-clicks landing before the React state flush.

- **GIVEN** a check request in flight
- **WHEN** the user clicks the affordance again (or a palette check command fires through the same hook instance)
- **THEN** no second `POST /api/updates/check` is issued
- **AND** when the response lands the affordance returns to its rest form

#### R4: `useUpdateCheck` exposes a `checking` boolean
`app/frontend/src/hooks/use-update-check.ts` MUST expose an in-flight `checking: boolean` alongside `runUpdateCheck`, cleared on both success and failure. The addition MUST be additive (existing consumers in `app.tsx` and `board-page.tsx` destructure only `runUpdateCheck`) and MUST NOT destabilize `runUpdateCheck`'s referential identity across the in-flight transition (the board palette memoizes a large action array on it) — the synchronous single-flight guard uses a ref, with state only driving the UI.

- **GIVEN** a component consuming `useUpdateCheck()`
- **WHEN** `runUpdateCheck` is invoked and later settles
- **THEN** `checking` reads `true` for the duration and `false` after, and the `runUpdateCheck` function identity is unchanged

### Frontend: Verdict-derived placement (promote/demote)

#### R5: Promoted state unchanged — placement is derivation only
The in-bar `UpdateChip` (`app/frontend/src/components/top-bar.tsx`) MUST remain single-action (no ⟳ segment) and behaviorally unchanged: renders when `showChip` and space allows, click runs `useUpdateClick`'s one-click update, dismiss `✕` intact. No imperative promote/demote logic may be introduced anywhere — chip/menu-row placement MUST fall out of the verdict-derived rendering (`showChip`, overflow measurement) exactly as today. Demotion after a completed update is the verdict clearing (reload or composite-key change), with no new mechanism.

- **GIVEN** a notable undismissed update pending and bar space available
- **WHEN** the top bar renders
- **THEN** the chip is in-bar in its existing form and the menu version row is the plain version + ⟳ row
- **AND** after the update completes and the verdict clears, the chip leaves the bar and the row reverts to version + ⟳ with no imperative movement code

#### R6: Menu update surface covers the dismissed-pending case; attention badge stays dismissal-silenced
The version row MUST render as the update surface whenever a qualifying update is pending AND the chip is not in-bar — i.e. the chip entry is overflowed OR the update is dismissed (`qualifies && !showChip`). A dismissed pending update therefore shows the update surface, not the ⟳ (the stronger affordance wins; mirrors the palette's deliberate-discovery posture of ignoring chip dismissal). The chevron attention badge MUST remain keyed on the undismissed-overflowed case only (today's `showChip && overflowed`), so dismissal still silences all ambient chrome.

- **GIVEN** a qualifying pending update that the user has dismissed
- **WHEN** the overflow menu is opened
- **THEN** the version row is the update surface (`Run Kit v{a} → v{b} ⬆` / `Toolkit updates (N) ⬆`), not the ⟳ row
- **AND** the chevron carries NO attention badge

- **GIVEN** a qualifying undismissed update whose chip is overflowed
- **WHEN** the top bar renders
- **THEN** the chevron badge shows and the version row is the update surface (existing behavior)

### Non-Goals

- No quiet-dot third state for `update_available && !notable` — the chip stays notable-policy-driven (patch-only findings remain toast-only).
- No backend work — `POST /api/updates/check`, verdict flags, and SSE payload shipped in n2ai.
- No changes to the two palette check commands, `run-kit: Update Now`, `run-kit: Restart Daemon`, or `run-kit: Dismiss Update Notice`.
- No Playwright e2e for the check flow — the e2e server runs the `dev` sentinel, which hides the affordance by design (same posture as n2ai). Vitest unit coverage instead.

### Design Decisions

#### Dismissed-pending shows the update surface (small derivation change)
**Decision**: Extend the version row's update-surface condition from `showChip && overflowed` to `qualifies && (overflowed || !showChip)`, while the chevron badge keeps the old condition.
**Why**: The intake states twice (What Changes §3, assumption 7) that a dismissed pending update shows the menu update surface, not the ⟳ — but current code shows the plain copy row when dismissed (the intake's "unchanged" framing mis-stated the baseline). The menu is deliberate discovery (like the palette, which already ignores dismissal via `qualifies`), so surfacing the pending update there does not violate "dismissal silences the ambient chip" — the badge, which IS ambient, stays silenced.
**Rejected**: Treating "dismissal semantics unchanged" as binding and rendering ⟳ when dismissed — it directly contradicts the intake's explicit stated outcome, and offering "check again" while a known pending verdict exists is the blind-affordance smell the design rejects.
*Introduced by*: 260720-ml7k-unified-toolbar-update-button

#### Check affordance is a non-menuitem control (menu stays open)
**Decision**: The ⟳ is a plain button (no `role="menuitem"`, `tabIndex={-1}`) inside the version row, so the container's role-keyed close handler does not fire on click.
**Why**: The in-flight spinner/single-flight state is only meaningful if the menu stays open across the ~1-2s check; the font-stepper precedent (role="group" row, plain buttons) established exactly this pattern for non-terminal menu actions. Arrow-key nav still reaches it (the focusables selector matches `button:not([disabled])`).
**Rejected**: `role="menuitem"` with close-on-click — hides the busy state and makes single-flight moot; an intermediate "checking…" toast was already rejected in n2ai.
*Introduced by*: 260720-ml7k-unified-toolbar-update-button

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add in-flight `checking: boolean` to `app/frontend/src/hooks/use-update-check.ts`: ref-based synchronous single-flight guard (early-return in `runUpdateCheck`), `useState` for the UI value, cleared in a `.finally` on both success and failure; `runUpdateCheck` deps unchanged (identity stable) <!-- R3, R4 -->
- [x] T002 Rework the version row in `app/frontend/src/components/top-bar-overflow-menu.tsx`: split badge vs surface conditions (`showBadge` = `updateOverflowed && tools.length > 0` unchanged; `asUpdateSurface` = `tools.length > 0 && (updateOverflowed || (qualifies && !showChip))` reading `qualifies`/`showChip` from `useUpdateNotification`), and render the resting row as a flex group of the existing copy menuitem plus the dev-gated ⟳ check button (rotate-cw SVG, 24px/coarse:30px bordered square per the step-button vocabulary, `tabIndex={-1}`, `aria-label`/`title` "Check for updates", `LogoSpinner` + disabled while `checking`, click → `runUpdateCheck(false)`) <!-- R1, R2, R3, R6 -->
- [x] T003 Update the stale registry/menu comments in `app/frontend/src/components/top-bar.tsx` (`update-chip` entry note + `updateOverflowed` computation note) to describe the new resting-row and dismissed-pending derivation; no chip behavior change <!-- R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add `app/frontend/src/components/top-bar-overflow-menu.test.tsx` (direct `TopBarOverflowMenu` render under `ToastProvider` + `StandaloneSessionContextProvider`, partial-mocking `checkForUpdates` in `@/api/client`): ⟳ renders on the resting row (incl. null-version), hidden on `dev`, hidden when the row is the update surface, click fires one check + success toast, error toast on rejection, in-flight spinner/disabled + single-flight double-click, dismissed-pending renders the update surface with no ⟳, and the chevron badge stays off for dismissed-pending <!-- R1, R2, R3, R4, R6 -->
- [x] T005 Run verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and `cd app/backend && go test ./...` (backend untouched — regression confirmation only) <!-- R1, R2, R3, R4, R5, R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The resting version row renders the ⟳ "Check for updates" button (correct aria/title), gated off on the `dev` sentinel and whenever the row is the update surface
- [x] A-002 R2: Clicking ⟳ issues exactly one `POST /api/updates/check` via `runUpdateCheck(false)` and reports through the existing check toast (info on success, error on failure); no new reporting surface
- [x] A-003 R4: `useUpdateCheck` returns `{ runUpdateCheck, checking }`; existing palette consumers compile and behave unchanged

### Behavioral Correctness

- [x] A-004 R3: While a check is in flight the affordance is disabled with a spinner and repeat clicks (including same-tick double-clicks) issue no second request; the rest form returns after settle
- [x] A-005 R6: A dismissed pending update renders the menu update surface (not ⟳) while the chevron attention badge stays off; the undismissed-overflowed badge behavior is unchanged

### Scenario Coverage

- [x] A-006 R5: No imperative promote/demote code exists — chip/menu placement derives solely from `showChip`/verdict state + overflow measurement; the in-bar chip remains single-action with its existing click/dismiss behavior (existing `update-chip.test.tsx` suite still green)

### Edge Cases & Error Handling

- [x] A-007 R1: A `null` `daemonVersion` (no version event yet) counts as non-dev — the ⟳ renders alongside the plain `Run Kit` row and checking still works
- [x] A-008 R2: A failed check (network/409/502) surfaces the server's message as an error toast and re-enables the affordance

### Code Quality

- [x] A-009 Pattern consistency: New code follows the existing menu-row/step-button vocabulary, `coarse:` touch sizing, and the registry-derived placement conventions of surrounding code
- [x] A-010 No unnecessary duplication: The check flow reuses `useUpdateCheck`/`composeCheckToast` verbatim; the update surface keeps `useUpdateClick`/`updateChipToolSummary` — no bar↔menu drift copies
- [x] A-011 Tests: New/changed behavior is covered by Vitest units (`top-bar-overflow-menu.test.tsx`); no client polling introduced; frontend uses type narrowing, no `as` casts added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (the resting-row check affordance + a `checking` flag) without making existing code redundant. The `asUpdateSurface`/badge derivation was split rather than replaced, and `useUpdateClick`/`composeCheckToast`/`updateChipToolSummary` are reused verbatim.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Implement assumption 7's stated outcome (dismissed-pending → menu update surface) even though it requires a small derivation change the intake's "explicitly unchanged" framing missed — current code shows the plain copy row when dismissed. Chevron badge stays keyed on undismissed-overflowed so ambient silencing is preserved | The intake states the outcome explicitly twice; the menu is deliberate discovery like the palette (which already ignores dismissal); reversible one-expression change | S:70 R:90 A:90 D:80 |
| 2 | Confident | The ⟳ is a plain non-`menuitem` control (`tabIndex={-1}`) so a check click leaves the menu open, keeping the spinner/single-flight state visible; arrow-nav reaches it via the `button:not([disabled])` focusables selector | Intake specifies a visible in-flight state; the font-stepper row is the established precedent for non-closing menu controls | S:65 R:90 A:90 D:80 |
| 3 | Confident | Glyph = the lucide rotate-cw SVG (same path as the in-bar RefreshButton) in the 24px/coarse:30px bordered-square step-button treatment, not a text `⟳` char | Reuses the codebase's existing refresh vocabulary and menu step-button sizing; purely presentational and trivially reversible | S:55 R:95 A:90 D:75 |
| 4 | Confident | Single-flight guard is a `useRef` flag checked synchronously inside `runUpdateCheck` (state only drives the spinner), keeping `runUpdateCheck`'s identity stable across the in-flight transition | board-page.tsx memoizes a large palette array on `runUpdateCheck`; adding `checking` to the callback deps would churn it mid-check for no benefit | S:60 R:90 A:90 D:85 |
| 5 | Certain | The ⟳ also renders when a notable update chip is in-bar (the menu row is then the plain version row) — the render rule is exactly "whenever no update surface is showing" | Intake §1 states the rule verbatim | S:85 R:90 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
