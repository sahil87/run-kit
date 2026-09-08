# Plan: Operator: direct sidebar open vs. quick-terminal (quake console) access

**Change**: 260908-aumn-operator-direct-open-quake-gate
**Intake**: `intake.md`

## Requirements

### Sidebar: Operator Pinned Row Direct Navigation

#### R1: Pinned row activation is plain navigation, no console special-case
The sidebar's pinned operator row SHALL activate identically to every other window row — a click or Enter/Space calls `onSelectWindow(server, session, windowId)` and nothing else. The `onOpenOperatorConsole` seam (the special-case that previously opened the console overlay instead of navigating) SHALL be removed end-to-end: both call sites (`window-row.tsx`'s click handler, `sidebar/index.tsx`'s Enter/Space handler) and the entire prop chain (`WindowRowProps`/`SidebarProps`/`ServerGroupProps` declarations, their destructuring, and every pass-through site), plus `app.tsx`'s `handleOpenOperatorConsole` callback and its wiring.

- **GIVEN** the sidebar's pinned operator row (role `"operator"`)
- **WHEN** it is clicked, or Enter/Space is pressed while it holds the roving-tabindex focus
- **THEN** `onSelectWindow` fires with the row's `(server, session, windowId)` and the app navigates to `/$server/$window` — no `rk:operator-console` event is dispatched, no console overlay opens
- **AND** on mobile, the SAME navigation occurs (the sidebar drawer closes via `handleSidebarSelectWindow`'s existing `isMobile` branch, unchanged) — behavior no longer forks by platform at the sidebar layer
- **AND** grepping `app/frontend/src` for `onOpenOperatorConsole` returns zero matches

### Operator Console: Route-Aware Opener Gate

#### R2: Desktop quick-terminal openers become inert while already viewing the operator's own route
The desktop console's document-event listener (`operator-console.tsx`'s `onRequest`) SHALL treat every request (`"toggle"`, `"open"`, `"button"` — the chord, the top-bar ◉ button, the overflow-menu row, the palette action, and the palette's Ask-operator fallback row all dispatch through this one listener) as a no-op whenever the current route IS the resolved operator window's own terminal route: instead of mutating the machine state (or `pinnedServer`/`pendingSend`), it surfaces a throttled informational toast and returns. The component already computes this exact fact as `onOperatorRoute` (for the unrelated chat-subject-stamping logic) — the gate reads that same value via a ref, introducing no new "is this the operator's route" comparison. Mobile is unaffected (mobile has no drawer to gate — every mobile request is already navigation, and the tongue already renders its own "return" state instead of "operator" on this exact route).

- **GIVEN** the desktop console, currently on the resolved operator window's own terminal route
- **WHEN** the ⌘J chord fires, the top-bar ◉ button is clicked, the overflow-menu row is clicked, the palette action `Operator: Open console` is selected, or the palette's Ask-operator fallback row is used
- **THEN** the console's machine state does NOT change, no `pinnedServer`/`pendingSend` mutation occurs, and a throttled toast reading `"already viewing the operator — nothing to open"` (or equivalent copy) is shown at most once per 4-second toast lifetime
- **AND GIVEN** the SAME actions fire from any OTHER route (not the operator's own), **THEN** behavior is completely unchanged from today (toggle/open/button semantics, chip/pin behavior, all untouched)
- **AND** repeated activations within the throttle window never stack duplicate toasts (mirrors the existing `NO_OPERATOR_HINT_THROTTLE_MS` idiom used for the no-operator-window case)

### Non-Goals

- Hiding or visually disabling the top-bar ◉ button, the overflow-menu row, or the palette action/fallback row while on the operator's own route — see Design Decision "Inert-with-toast, not hidden" below. They remain visible and clickable everywhere; only their EFFECT is gated, centrally.
- Any change to the omnibox's own click-to-engage / Enter-to-send behavior — out of scope per the intake, unchanged here.
- Any change to mobile's navigation model, the mobile tongue's existing return-state, or the templated-chat-lane / compose-seam fork.
- Restoring `?from=` context-carrying for the sidebar's direct-navigation path — see Design Decision "Direct navigation carries no `?from=`" below.
- Extracting a new shared `useIsOnOperatorRoute()` hook or a pure `isOperatorRouteTarget()` helper — the mobile arm's and the tongue's own pre-existing inline `routeServer === … && routeWindow === …` comparisons are UNTOUCHED by this change (this change adds no new instance of that comparison to duplicate, so there is no fresh parsimony debt to pay down; consolidating the three now-total occurrences is a separate, optional cleanup a future change may pick up).

### Design Decisions

#### Inert-with-toast, not hidden
**Decision**: the operator-route gate lives entirely inside `operator-console.tsx`'s single document-event listener. Every entry point (chord, top-bar button, menu row, palette action, palette fallback row) stays visible and clickable everywhere, unchanged; while on the operator's own route, activating any of them shows a throttled toast instead of opening/toggling the drawer.
**Why**: this is the smallest possible diff that satisfies "disable the ways to open the quick terminal" — it requires touching exactly one file (the shared listener every entry point already funnels through) instead of five (top-bar button, menu row, palette action builder, palette action registration, Ask-operator fallback gate). It also matches the codebase's own stated philosophy for the closely analogous no-operator-window case (`use-global-palette-actions.ts`'s comment: "Always listed: a server without an operator window is answered by the console's own hint line, not by hiding the opener") — and gives clearer feedback than a silently-inert control would (a click that visibly does nothing reads as broken; a toast confirms the click registered and explains why nothing opened). The intake's own assumption (hide the button/menu-row/palette-action, mirroring the "omit-not-disable" availability pattern) is superseded by this discovery made during plan generation — "omit" there answers "there is nothing to show you"; here there IS something (you're looking at it already), so a toast is the more accurate analogy.
**Rejected**: hiding the top-bar button + overflow-menu row while gating the palette/fallback row separately (the intake's original plan) — five files touched instead of one, and inconsistent with the palette's own "always listed" precedent; a silently-inert (visible but no-op, no feedback) control — reads as a bug when tested.
*Introduced by*: 260908-aumn-operator-direct-open-quake-gate

#### Direct navigation carries no `?from=`
**Decision**: the pinned row's plain `onSelectWindow` navigation does not carry a `?from=` origin param or attach the operator route's context chip — it behaves byte-identically to clicking any other sidebar row.
**Why**: the removed seam's `requestOperatorConsole({action:"open", server})` path, via the console's mobile arm, USED to carry `?from=<origin window>` when navigating cross-window on the same server, which fed the operator route's dismissable context chip. `onSelectWindow`'s underlying handler (`app.tsx`'s `handleSidebarSelectWindow` → `navigateToWindow`) explicitly clears search params for every ordinary row and was never meant to carry it. This is the direct, intended consequence of "let the operator open like a normal terminal" — the context-chip mechanism is part of the quick-terminal access mode's value proposition (arriving from elsewhere with context preserved), and dropping it for the direct-access mode is correct, not a regression to patch.
**Rejected**: threading a `?from=` value through `onSelectWindow`'s existing call for the operator row specifically (would resurrect a smaller, sidebar-row-specific special-case — exactly what this change removes — and contradicts "opens like a normal terminal").
*Introduced by*: 260908-aumn-operator-direct-open-quake-gate

## Tasks

### Phase 1: Core Implementation

- [x] T001 Remove the operator special-case from the pointer-click handler in `app/frontend/src/components/sidebar/window-row.tsx` (currently ~lines 884-890: the `if (win.role === "operator" && onOpenOperatorConsole) { onOpenOperatorConsole(srv); return; }` block) so the handler falls through unconditionally to `onSelectWindow(srv, session, win.windowId)`. <!-- R1 -->
- [x] T002 Remove the operator special-case from the Enter/Space handler in `app/frontend/src/components/sidebar/index.tsx` (currently ~lines 1517-1522: the `if (identity.operator && onOpenOperatorConsole) { onOpenOperatorConsole(identity.server); break; }` block) so window-row activation always calls `onSelectWindow`; drop `onOpenOperatorConsole` from the enclosing `handleTreeKeyDown` `useCallback`'s dependency array (currently ~line 1553). <!-- R1 -->
- [x] T003 [P] Remove the `onOpenOperatorConsole` prop end-to-end from `app/frontend/src/components/sidebar/window-row.tsx` (the `WindowRowProps` declaration + doc comment ~lines 178-184, and the destructure ~line 274). <!-- R1 -->
- [x] T004 [P] Remove the `onOpenOperatorConsole` prop end-to-end from `app/frontend/src/components/sidebar/index.tsx`: `SidebarProps` declaration + doc comment (~lines 194-197) and destructure (~line 225); `ServerGroupProps` declaration + doc comment (~lines 2335-2338) and destructure (~line 2418); the Sidebar→ServerGroup pass-through (~line 1886); the ServerGroup→WindowRow pass-through (~line 2939). <!-- R1 -->
- [x] T005 [P] Remove `handleOpenOperatorConsole` from `app/frontend/src/app.tsx` (currently ~lines 4351-4361, including its preceding comment) and its `onOpenOperatorConsole={handleOpenOperatorConsole}` prop pass to `<Sidebar>` (currently ~line 4575) — the pinned row now rides the existing `onSelectWindow={handleSidebarSelectWindow}` wiring (~line 4565) unchanged, identically to every other row. <!-- R1 -->
- [x] T006 Remove the now-dead `operator: boolean` field from the `RowIdentity` window-kind discriminated union in `app/frontend/src/components/sidebar/index.tsx` (currently ~line 139) and its two construction sites (`operator: true` at ~line 2554, `operator: false` at ~line 2584) — confirmed (via grep) to have no other consumer once T002 removes its sole read site. <!-- R1 -->
- [x] T007 Add the desktop operator-route gate to `operator-console.tsx`'s `onRequest` listener (currently ~lines 310-331): introduce `const onOperatorRouteRef = useRef(onOperatorRoute); onOperatorRouteRef.current = onOperatorRoute;` near the component's existing `machineRef`/`isMobileRef` refs (placed after `onOperatorRoute` is computed, ~line 446, mirroring that same ref-per-render-update idiom), and `const toastRef = useRef(toast); toastRef.current = toast;` alongside it. Inside `onRequest`, immediately after the `isMobileRef.current` early return and before the `state`/action branching, add: when `onOperatorRouteRef.current` is true, throttle-check against a new `alreadyOnOperatorHintAtRef` (mirroring `noOperatorHintAtRef`'s existing pattern) using the existing `NO_OPERATOR_HINT_THROTTLE_MS` constant, call `toastRef.current?.addToast(ALREADY_ON_OPERATOR_HINT, "info")` when the throttle allows, and `return` before any `setConsoleMachineState`/`setPinnedServer`/`setPendingSend` call. <!-- R2 -->
- [x] T008 [P] Add the `ALREADY_ON_OPERATOR_HINT` string constant next to `NO_OPERATOR_HINT` in `app/frontend/src/components/operator-console.tsx` (currently ~lines 43-49), e.g. `"already viewing the operator — nothing to open"`. <!-- R2 -->

### Phase 2: Tests

- [x] T009 In `app/frontend/src/components/sidebar/index.test.tsx`: replace the three pinned-row activation tests (currently ~lines 3073-3109 — "clicking the pinned row opens the operator console…", "Enter/Space on the pinned row opens the operator console…", "row activation keeps plain navigation when the console seam is unwired") with two tests asserting plain navigation: click calls `onSelectWindow` with `("primary", "main", "@1")` (per the existing `renderOperatorSidebar` fixture) and does NOT dispatch any console-open behavior; Enter/Space (via the roving-tabindex tree) does the same. Remove the now-meaningless "seam unwired" case (there is no seam left to be unwired). Remove `onOpenOperatorConsole` from the test file's `RenderOpts` type (~line 149) and the harness's pass-through to `<Sidebar>` (~line 200). <!-- R1 -->
- [x] T010 [P] In `app/frontend/src/components/operator-console.test.tsx`: add tests for the operator-route gate — (a) with `mockMatches` resolved to the operator window's own route, dispatching `requestOperatorConsole({action: "toggle"})`, `{action: "open"}`, and `{action: "button"}` each produce no machine-state change and call the toast mock with `ALREADY_ON_OPERATOR_HINT`; (b) repeated activations within the throttle window do not stack (mirror the existing "an operator-less server toasts the hint once…" test, ~line 688); (c) the same actions fired from a non-operator route are unaffected (regression guard — reuse the existing "the chord toggles the desktop machine…" style assertions, ~line 134). <!-- R2 -->
- [x] T011 [P] In `app/frontend/tests/e2e/operator-pinned-row.spec.ts`: rewrite the intent comment's Proves/Steps block (currently ~lines 65-93) and the pinned-row-click assertions (currently ~lines 136-150 — asserting the console overlay opens with no navigation) to assert NAVIGATION instead: clicking the pinned row now navigates to the operator window's terminal route (assert `page.getByRole("button", { name: \`Rename tab ${opName}\` })` visible and `page.getByTestId("operator-console")` has count 0 — mirroring the existing demoted-row assertions at ~lines 172-176), both BEFORE and AFTER the `@rk_win_role` clear (both clicks now behave identically). <!-- rework: review must-fix — the post-demotion click (~line 159 in the current draft) fires while the page is ALREADY on the target window route from the first (pre-demotion) click, so its heading/no-overlay assertions pass trivially regardless of whether that second click's navigation actually works. Navigate AWAY from the window route (e.g. back to the bare server route) between the two clicks, so the post-demotion click's navigation assertion is a real, non-trivial check. --> <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: clicking or Enter/Space-ing the sidebar's pinned operator row navigates to the operator's terminal route exactly like any other row — no console special-case remains in `window-row.tsx` or `sidebar/index.tsx`
- [x] A-002 R1: `onOpenOperatorConsole` no longer exists anywhere in `app/frontend/src` (`grep -rn onOpenOperatorConsole app/frontend/src` returns nothing)
- [x] A-003 R2: while the current route IS the resolved operator window's own terminal route, dispatching the `rk:operator-console` event via `toggle`/`open`/`button` produces no machine-state change and shows the throttled "already viewing the operator" toast
- [x] A-004 R2: on any other route, the chord/button/menu-row/palette entry points behave exactly as before this change (no regression)

### Behavioral Correctness

- [x] A-005 R1: the pinned row's navigation carries no `?from=` search param and attaches no context chip — matches ordinary row navigation, an intentional and documented behavior change from the removed seam
- [x] A-006 R2: the gate reads the console's own resolved `server`/`target`-derived `onOperatorRoute` (not a fresh per-request comparison), so a stale cross-server pin from the Ask-operator fallback does not falsely suppress a genuine opener on a different, non-operator route

### Removal Verification

- [x] A-007 R1: `identity.operator` / `RowIdentity`'s `operator: boolean` field is fully removed (`grep -n '\.operator\b' app/frontend/src/components/sidebar/index.tsx` shows no remaining references)
- [x] A-008 R1: no dead prop-threading remains for `onOpenOperatorConsole` across `WindowRowProps`, `SidebarProps`, `ServerGroupProps`, or `app.tsx`

### Scenario Coverage

- [x] A-009 R1: `sidebar/index.test.tsx` asserts plain navigation for both click and Enter/Space activation of the pinned row
- [x] A-010 R2: `operator-console.test.tsx` asserts the gate's no-op + toast for `toggle`/`open`/`button` while on the operator's own route, and unaffected behavior elsewhere
- [x] A-011 R1: `operator-pinned-row.spec.ts` e2e asserts navigation (not console-open) on pinned-row activation, both before and after the operator role is cleared

### Edge Cases & Error Handling

- [x] A-012 R2: repeated activations of any opener while on the operator's own route within the toast's lifetime do not stack duplicate toasts (reuses the existing throttle pattern)
- [x] A-013 R2: the gate fires before any `pinnedServer`/`pendingSend` state mutation — a gated request leaves the console's state completely untouched

### Code Quality

- [x] A-014 Pattern consistency: the gate reuses the existing ref idiom (`machineRef`/`isMobileRef`) rather than introducing a new pattern
- [x] A-015 No unnecessary duplication: no new inline "on operator route" comparison is added (the gate reads the already-computed `onOperatorRoute`); the existing no-operator-hint toast/throttle idiom is reused rather than reimplemented

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Docs/memory updates (`docs/memory/run-kit/ui/sidebar.md` § Operator Pinned Row, `docs/memory/run-kit/ui/operator-console.md` — including the pre-existing stale three-state ⌘J machine description found during intake) are NOT apply-stage tasks; they are handled by the hydrate stage per the intake's Affected Memory list.

## Deletion Candidates

- None — the planned `onOpenOperatorConsole` seam and `RowIdentity.operator` carrier are already removed; no additional redundant code was found.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Reverse the intake's assumption to hide the top-bar button/menu-row/palette action; instead centralize the gate in the single document-event listener with a throttled toast, leaving every entry point visible and clickable everywhere. | Discovered during plan generation: `use-global-palette-actions.ts` carries an explicit, on-point precedent comment ("Always listed... answered by the console's own hint line, not by hiding the opener") for the closely analogous no-operator-window case; matching it is both more consistent and a 1-file diff instead of 5. Reversible via `/fab-clarify` if the toast reads as insufficient feedback in practice. | S:80 R:80 A:85 D:75 |
| 2 | Certain | The gate reuses the component's already-computed `onOperatorRoute` value (read via a new ref) rather than introducing any new "on operator route" comparison. | `onOperatorRoute` (operator-console.tsx ~line 445-446) already exists for the unrelated chat-subject-stamping logic and is exactly the fact the gate needs; reading it via a ref mirrors the file's own established `machineRef`/`isMobileRef` idiom for values a `[]`-dep effect closure must read fresh. No new duplication, so no parsimony risk. | S:90 R:90 A:95 D:90 |
| 3 | Confident | The sidebar's direct-navigation path intentionally drops `?from=` context-carrying and the operator route's context chip — not restored. | `onSelectWindow`'s underlying `navigateToWindow`/`handleSidebarSelectWindow` explicitly clears search params for every row; carrying `?from=` only for the operator row would resurrect a smaller version of the exact special-case this change removes, and "opens like a normal terminal" is the user's own framing. Documented as a Design Decision so a reviewer does not flag it as an unnoticed regression. | S:75 R:80 A:80 D:75 |

3 assumptions (1 certain, 2 confident, 0 tentative).
