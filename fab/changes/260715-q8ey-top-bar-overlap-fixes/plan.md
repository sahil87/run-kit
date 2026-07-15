# Plan: Top-Bar Overlap Fixes

**Change**: 260715-q8ey-top-bar-overlap-fixes
**Intake**: `intake.md`

## Requirements

### TopBar: Left breadcrumb degradation

#### R1: Crumb wrapper spans must be shrinkable so their `truncate` engages
The two crumb wrapper spans inside the left `<nav>` — the server-link crumb wrapper and the session crumb wrapper — MUST carry `min-w-0` so the `truncate max-w-[16ch]` already present on the inner anchor / dropdown trigger can engage under horizontal pressure. A nested flex item defaults to `min-width: auto`, which otherwise blocks shrink and forces the crumbs to overflow their box.

- **GIVEN** a terminal route at a mid width (~700px) with a long server name and a long session name
- **WHEN** the left nav's grid track is squeezed
- **THEN** the crumb text compresses to an ellipsis inside its `max-w-[16ch]` cap
- **AND** the crumb content never overflows the nav's box into the center heading

#### R2: The breadcrumb `<nav>` must clip past its floor, not overflow (backstop)
The `<nav aria-label="Breadcrumb">` element MUST carry `overflow-hidden` so any residual content past the shrunk floor is clipped inside the nav box rather than painted over the center heading. It MUST also carry an explicit breakpoint-aware minimum width (replacing the bare `min-w-0`) so a usable identity floor (brand icon + hamburger below `sm`; plus a session-crumb sliver at `sm+`) is preserved.

- **GIVEN** the left nav has shrunk to its explicit floor and content still does not fit
- **WHEN** the browser is at any width in the 640–900px band
- **THEN** overflowing crumb content is clipped at the nav's right edge
- **AND** the nav's rendered box never intersects the center heading's box

#### R2a: The nav clip MUST NOT clip or displace the session-switcher dropdown menu
The `overflow-hidden` clip backstop on the `<nav>` (R2) is a further-out ancestor of the session crumb's `BreadcrumbDropdown` open menu, which is `position: absolute` inside its own `relative` wrapper *inside the nav*. A plain `overflow-hidden` therefore (a) clips the open menu to the nav's ~single-line box and (b) turns the nav into a scrollable container whose focus-on-open `scrollIntoView` (`breadcrumb-dropdown.tsx`) scrolls the entire nav content out of its clip box — making the session switcher and its `+ New Session` action unusable at every `sm+` width (review 260715, empirically proven: open menu box lands off-viewport at y≈-75, hit-test empty; pre-clip it renders at y≈37, visible). The clip backstop (R2, user-approved) MUST be preserved; the fix is to let the `BreadcrumbDropdown` menu **escape the nav's clip context** so the clip protects the center heading without breaking the menu.

- **GIVEN** a terminal route at `sm+` (incl. 700px and 1024px) with the nav's `overflow-hidden` backstop in place
- **WHEN** the user opens the session-switcher dropdown (clicking the session crumb ▾)
- **THEN** the open menu renders fully visible and hit-testable at its trigger, not clipped and not scrolled out of the nav box
- **AND** the R2 clip backstop still prevents crumb overflow from painting over the center heading
- **AND** the other three `BreadcrumbDropdown` call sites (hierarchy ▾, window switcher, board switcher) are unaffected or improved by the same fix

#### R3: Server crumb visible only at `md+`
The server-link crumb (its wrapper span) MUST render only at `md+` (previously `sm+`). The hierarchy ▾ inside the center heading prefix (`Window ▾:`) already provides "go to Server Cabin → Cockpit" navigation, so the left server crumb is redundant at cramped widths and is the natural first element to give way. The session crumb (with its switcher + `+ New Session` action) MUST remain visible at `sm+`.

- **GIVEN** a terminal route
- **WHEN** the viewport is below `md` (< 768px) but at or above `sm` (≥ 640px)
- **THEN** the server-link crumb is hidden (CSS `display`) and the session crumb is visible
- **AND** at `md+` (≥ 768px) the server-link crumb is visible again

### TopBar: Center heading protection

#### R4: The center grid column must not shrink below its content floor
The center cell's outer wrapper MUST NOT carry `min-w-0` (it currently does), so the `auto` grid column never compresses below the heading's content floor. The floor is already bounded — the heading name spans carry `max-w-[16ch] sm:max-w-[28ch] truncate`, the history arrows / hierarchy ▾ / window & board ▾ switchers are fixed-width `shrink-0`, and the inner box keeps its `sm:min-w-[28ch]` stable anchor — so removing `min-w-0` protects the center without introducing a magic pixel min. The `sm:min-w-[28ch]` anchor MUST stay at `sm:` (NOT be demoted to `md:`).

- **GIVEN** a terminal route at a mid width with long left crumbs and a long window name
- **WHEN** the grid is under horizontal pressure
- **THEN** the center `auto` column holds at least the heading's content floor
- **AND** squeeze is absorbed by the left (and right) `1fr` columns, never by compressing the center into overlap

### TopBar: Right cluster (out of scope, interim)

#### R5: Right cluster is intentionally untouched (interim, documented)
This change MUST NOT add `min-w-0` / `overflow-hidden` to the right cluster. With left/center floors in place, extreme narrowness can push the grid wider than the viewport so the right cluster's rightmost items (connection dot first) clip at the app-shell edge. This is accepted as transitional until the companion overflow-chevron change gives the right cluster proper degradation. A partial `overflow-hidden` here would clip the wrong end (flex overflow spills toward inline-end, dropping the always-block L3/dot first), so it MUST NOT be attempted.

- **GIVEN** an extremely narrow viewport where even the floored left/center exceed the viewport
- **WHEN** the grid overflows the app shell
- **THEN** the right cluster clips at the shell edge (accepted interim) and the change adds no right-cluster clip/min-width

### Tests: Overlap regression coverage

#### R6: Playwright e2e proves no overlap + the degradation ladder
A Playwright e2e (run via `just test-e2e` / `just pw`, never raw playwright) MUST, at a ~700×800 viewport on a terminal route with a long window name and a long session name, assert the breadcrumb nav's bounding box and the center heading's bounding box do NOT intersect; assert the crumbs show ellipsis (not overflow) under pressure; assert the server crumb is hidden below `md` and visible at `md+`; and re-verify 375px (mobile leaf unchanged) and 1024px+ (no regression, anchor intact). Its sibling `.spec.md` companion MUST be created/updated in the same change (constitution: Test Companion Docs).

- **GIVEN** the e2e suite runs on the isolated test server (port 3020, `rk-test-e2e`)
- **WHEN** the overlap spec runs at 700px with long names
- **THEN** nav-box ∩ heading-box is empty and the crumb text is clipped/ellipsised
- **AND** the server crumb toggles visibility across the `md` breakpoint as specified

### Design Decisions

1. **Center protection via removing `min-w-0` rather than an explicit pixel min**: the heading floor is already bounded by existing `max-w` caps + fixed-width controls, so protecting the content floor satisfies "min width for the center section" without a magic number (intake assumption #5). — *Rejected*: adding a new explicit `min-w-[Npx]` to the center — redundant given the bounded floor, and a guessed pixel value.
2. **Server crumb demoted to `md:`, session crumb stays at `sm:`**: the hierarchy ▾ covers server/cockpit navigation, making the left server crumb the redundant first-to-give element; the session crumb owns the switcher + `+ New Session` and stays (intake #4). — *Rejected*: demoting both, or demoting the `sm:min-w-[28ch]` center anchor to `md:` (explicitly superseded by the companion overflow change, intake #4).
3. **New dedicated spec file `top-bar-overlap.spec.ts`** rather than extending `window-heading.spec.ts`: the overlap tests need their own long-name session lifecycle and a distinct viewport sweep; a dedicated file keeps the concern isolated and the companion `.spec.md` focused (intake §6 offered either). — *Rejected*: extending `window-heading.spec.ts` — would bloat an already-large file and mix the anchor/hover concern with overlap regression.

### Non-Goals

- Right-cluster degradation (overflow-chevron menu) — owned by the companion change (R5).
- Any component API, prop, routing, or backend change — this is a class-level edit to one component plus tests.

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/top-bar.tsx`, add `min-w-0` to the session crumb wrapper span (`hidden sm:flex items-center gap-1.5`, ~line 452) so its `BreadcrumbDropdown` trigger `truncate max-w-[16ch]` engages. <!-- R1 -->
- [x] T002 In `app/frontend/src/components/top-bar.tsx`, change the server-link crumb wrapper span (`hidden sm:flex items-center gap-1.5`, ~line 436) to `hidden md:flex items-center gap-1.5 min-w-0` — folds the `min-w-0` unblock (R1) and the `sm:`→`md:` demotion (R3) into one class edit. <!-- R1 --> <!-- R3 -->
- [x] T003 In `app/frontend/src/components/top-bar.tsx`, on the `<nav aria-label="Breadcrumb">` element (~line 384), add `overflow-hidden` and replace the bare `min-w-0` with the explicit floor `min-w-[76px] sm:min-w-[180px]` (values Playwright-tunable in T006). <!-- R2 -->
- [x] T004 In `app/frontend/src/components/top-bar.tsx`, remove `min-w-0` from the center cell's OUTER wrapper (`flex items-center justify-center min-w-0`, ~line 487); leave the INNER box's `min-w-0 sm:min-w-[28ch]` (~line 488) unchanged. <!-- R4 -->
- [x] T008 In `app/frontend/src/components/breadcrumb-dropdown.tsx`, make the open menu escape the nav's `overflow-hidden` clip context so R2's backstop does not clip/displace it (R2a). <!-- rework: nav overflow-hidden clips + focus-scroll-displaces the session dropdown menu (review 260715) --> Render the `role="menu"` element with **`position: fixed`** anchored to the trigger's viewport rect (measure `buttonRef.getBoundingClientRect()` on open; position the menu's top-left at `rect.bottom + gap` / `rect.left`), rather than `absolute top-full` inside the clipped `relative` wrapper. Fixed positioning is viewport-relative, so no `overflow:hidden` ancestor (the nav) can clip it. Keep it dismiss-on-scroll/resize (recompute or close on `scroll`/`resize`) so it never detaches from the moving trigger, keep the existing click-outside + Escape + Arrow-key focus behavior, keep `z-50`, and keep the `min-w-[160px] max-w-[240px]` sizing. This MUST be safe and correct for **all four** `BreadcrumbDropdown` call sites (session crumb, hierarchy ▾, window switcher, board switcher) — verify each still opens correctly positioned. Update the stale line-111 trigger comment if it no longer describes the mechanism.

### Phase 3: Tests & Verification

- [x] T005 Create `app/frontend/tests/e2e/top-bar-overlap.spec.ts` (+ sibling `top-bar-overlap.spec.md` per constitution): at ~700×800 on a terminal route with a long window name + long session name, assert nav-box ∩ heading-box is empty and crumb text is clipped/ellipsised; assert the server crumb is hidden below `md` and visible at `md+`; re-verify 375px (no horizontal overflow, mobile leaf intact) and 1024px+ (anchor intact, server crumb visible). Run via `just test-e2e "top-bar-overlap"`. <!-- R6 -->
- [x] T009 Extend `app/frontend/tests/e2e/top-bar-overlap.spec.ts` (+ update the sibling `.spec.md`) with a dropdown-menu-visibility guard for R2a: at both 700px and 1024px on a terminal route, open the session-switcher dropdown (click the session crumb ▾) and assert the open `role="menu"` is visible and hit-testable (its bounding box is on-screen and `elementFromPoint` at its center resolves inside it / the `+ New Session` action is clickable). This is the regression the closed-trigger tests missed. <!-- R2a -->
- [x] T010 (should-fix, review 260715) Hoist the near-duplicate `resolveWindow`/`gotoWindow` helpers shared by `top-bar-overlap.spec.ts` and `window-heading.spec.ts` into the sanctioned shared-helper home `app/frontend/tests/e2e/_ready.ts`, and import them from both specs (parsimony — reuse existing utility). Verify both specs still pass after the hoist. <!-- review-should-fix -->
- [x] T006 Run a Playwright sweep at 375 / 640 / 700 / 768 / 1024px against the running behavior; if the sweep shows overlap or excessive clipping, tune the T003 floor values (`min-w-[76px] sm:min-w-[180px]`) and record the final values in `## Notes`. The mechanism (explicit floor + clip) is the requirement; the pixels are tunable. <!-- R6 -->
- [x] T007 Run `just test-frontend` and confirm `app/frontend/src/components/top-bar.test.tsx` still passes; update any class-string assertion only if one exists on a touched class (none identified at plan time — the unit test queries by role/aria-label, so no update is expected). <!-- R1 --> <!-- R3 --> <!-- R4 -->

## Execution Order

- T001–T004 are the source edits (all in `top-bar.tsx`); do them first, then T005–T007.
- T005 (write spec) precedes T006 (sweep + tune) — the spec's viewport assertions are the sweep harness.
- T007 (unit tests) can run any time after T001–T004.
- **Rework (review 260715)**: T008 (dropdown escapes the nav clip, `breadcrumb-dropdown.tsx`) must land before re-review; T009 (dropdown-visibility e2e guard) extends the T005 spec and proves T008. Run `just test-frontend` (breadcrumb-dropdown may have a unit test) and the scoped e2e after T008/T009.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both crumb wrapper spans carry `min-w-0`; under mid-width pressure the crumb text truncates to ellipsis within `max-w-[16ch]` instead of overflowing the nav box.
- [x] A-002 R2: The `<nav aria-label="Breadcrumb">` carries `overflow-hidden` and an explicit breakpoint-aware min-width floor (bare `min-w-0` replaced); residual overflow clips inside the nav box.
- [x] A-003 R3: The server-link crumb renders only at `md+`; the session crumb still renders at `sm+`.
- [x] A-004 R4: The center cell's outer wrapper no longer carries `min-w-0`; the inner box keeps `sm:min-w-[28ch]` at `sm:` (not demoted to `md:`).
- [x] A-005 R5: No `min-w-0`/`overflow-hidden` was added to the right cluster.

### Behavioral Correctness

- [x] A-006 R2: At ~700×800 on a terminal route with long window + session names, the breadcrumb nav's bounding box and the center heading's bounding box do NOT intersect.
- [x] A-007 R4: Squeeze is absorbed by the left/right `1fr` columns — the center heading is never compressed into overlap across the 640–900px band.

### Scenario Coverage

- [x] A-008 R6: `top-bar-overlap.spec.ts` exists, runs green via `just test-e2e`, and asserts no-intersection + ellipsis + server-crumb `md`-toggle + 375px/1024px re-verification.
- [x] A-009 R6: The sibling `top-bar-overlap.spec.md` companion documents each `test()` (what it proves + numbered steps) per the constitution's Test Companion Docs rule.

### Edge Cases & Error Handling

- [x] A-010 R2: At 375px the top bar stays single-line with no horizontal page overflow (mobile leaf layout unchanged).
- [x] A-011 R4: At 1024px+ there is no visual regression and the `sm:min-w-[28ch]` anchor is intact. — re-verified after the T008 dropdown-escape fix: the `1024px+ has no regression … center anchor is intact` e2e passes (anchor reserves >180px), and the dropdown now opens correctly at 1024px (new R2a guard passes).
- [x] A-016 R2a: With the nav's `overflow-hidden` backstop in place, opening the session-switcher dropdown at 700px and 1024px renders the menu fully visible and hit-testable (not clipped, not scrolled out of the nav box); the `+ New Session` action is clickable. The other three `BreadcrumbDropdown` call sites (hierarchy ▾, window switcher, board switcher) still open correctly positioned. — Proven: both R2a e2e guards (700px + 1024px) pass (menu on-screen box, `elementFromPoint` center resolves inside, `+ New Session` hit-testable). The fix is a shared change in `breadcrumb-dropdown.tsx` (`position: fixed` anchored to the trigger rect), so it applies identically to all four call sites; the `window-heading.spec.ts` `hierarchy ▾ lists the ancestor chain and navigates up` e2e still passes (opens + selects a menuitem), confirming a non-session call site opens correctly positioned, and the 24 breadcrumb-dropdown unit tests (open/close/nav/a11y) still pass for the shared component.

### Code Quality

- [x] A-012 Pattern consistency: The class edits follow the existing Tailwind breakpoint + `min-w-0`/`shrink-0`/`truncate` idiom already used throughout `top-bar.tsx`.
- [x] A-013 No unnecessary duplication: No new component/utility introduced; existing `truncate`/`max-w` classes are reused (only their shrink chain is unblocked).
- [x] A-014 Magic numbers: The nav floor pixel values are documented as tunable in `## Notes` with their final tuned values recorded, not left as unexplained magic numbers.
- [x] A-015 UI test coverage: The responsive change ships a Playwright e2e per code-quality "UI changes SHOULD include Playwright e2e tests".

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Nav floor tuned values (recorded by T006)**: `min-w-[76px] sm:min-w-[180px]` — the intake starting values held across the full Playwright sweep (375 / 640 / 700 / 768 / 1024px): at every width the breadcrumb nav's box does not intersect the center heading's box and there is no horizontal page overflow. No adjustment was needed, so the starting values are the final tuned values. The `overflow-hidden` backstop clips any residual crumb layout past the floor (a clipped child keeps a layout box wider than its clipping parent, which is expected and correct — the no-overlap + computed-`overflow:hidden` assertions are the meaningful proofs, not a layout-box comparison).
- **Rework (review 260715 must-fix — R2a/T008/T009/T010)**: the nav `overflow-hidden` backstop was clipping + focus-scroll-displacing the session dropdown menu. Fixed by rendering the `BreadcrumbDropdown` open `role="menu"` with `position: fixed` anchored to the trigger's `getBoundingClientRect()` (recomputed on scroll/resize, capture-phase so ancestor scroll containers are heard), so the menu escapes the nav's clip context — a shared component change that applies to all four call sites. Verified: `just test-frontend` (1244 unit tests pass, incl. the 24 breadcrumb-dropdown tests), `just check` (typecheck clean), `just test-e2e "top-bar-overlap.spec.ts"` (7 pass, incl. the two new R2a dropdown-visibility guards at 700px + 1024px and the re-confirmed no-overlap A-006/A-007 + 1024px-anchor A-011), and `just test-e2e "window-heading.spec.ts"` (16 pass — the T010 hoist of `resolveWindow`/`gotoWindow` into `_ready.ts` is safe). The nav clip (R2) is unchanged and still present (the `overflow:hidden` assertion in the 700px test still passes).

## Deletion Candidates

None — this change is a class-level fix (shrink-chain unblock + clip backstop + breakpoint demotion) plus new tests; it makes no existing code redundant or unused. (The left server crumb's navigation redundancy with the hierarchy ▾ predates this change — introduced by 260714-uco1 — and its retention at `md+` is a user-approved design decision here, not a discovered removal opportunity.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add `min-w-0` to both crumb wrapper spans to unblock the existing `truncate` | User-approved (intake fix 1); standard nested-flex min-width fix; trivially reversible | S:90 R:95 A:95 D:90 |
| 2 | Certain | Clip backstop `overflow-hidden` on the breadcrumb `<nav>` | User-approved (intake fix 2, re-confirmed "+ the clip backstop") | S:90 R:95 A:90 D:90 |
| 3 | Confident | Server crumb demoted `sm:`→`md:`; session crumb stays `sm:` | User-approved (intake fix 4); hierarchy ▾ covers the navigation; easily reverted | S:85 R:90 A:85 D:75 |
| 4 | Confident | Keep `sm:min-w-[28ch]` center anchor at `sm:` (do NOT demote to `md:`) | Superseded fix-3 idea once the companion overflow change absorbs right-side squeeze; user approved the split | S:75 R:90 A:80 D:70 |
| 5 | Confident | Center protection = remove the outer wrapper's `min-w-0` (content-floor protection) rather than a new explicit pixel min | Heading floor already bounded by existing `max-w` caps + fixed-width controls; satisfies "min width for the center" without a magic number | S:60 R:85 A:85 D:65 |
| 6 | Tentative | Nav min-width floor values `min-w-[76px] sm:min-w-[180px]`, Playwright-tunable | Mechanism (explicit floor) is agreed; exact pixels are visual-tuning territory — implementer adjusts via the sweep in T006 | S:45 R:90 A:70 D:50 |
| 7 | Confident | Right cluster untouched; interim right-edge clipping accepted until the companion overflow-chevron change | Intake §5 / assumption #7 assigns right-cluster degradation to the companion change | S:80 R:85 A:80 D:75 |
| 8 | Confident | New dedicated `top-bar-overlap.spec.ts` file rather than extending `window-heading.spec.ts` | Overlap tests need their own long-name session + viewport sweep; intake §6 offered either | S:70 R:85 A:80 D:70 |
| 9 | Confident | Reconcile R2's clip backstop with the dropdown menu by making the `BreadcrumbDropdown` menu escape via `position: fixed` anchored to the trigger (not by weakening/dropping the nav clip) | Review 260715 must-fix: nav `overflow-hidden` clipped + focus-scroll-displaced the session menu. The clip is a user-approved requirement (R2/intake #2), so preserve it and let the menu escape. `overflow-clip` on the nav fixes only the focus-scroll, not the clipping; dropping the backstop would need a requirement change. Fixed positioning is the standard escape-the-clip pattern and benefits all four call sites; recompute/close on scroll+resize keeps it anchored. Reversible (component-local). | S:85 R:85 A:85 D:80 |

9 assumptions (2 certain, 6 confident, 1 tentative).
