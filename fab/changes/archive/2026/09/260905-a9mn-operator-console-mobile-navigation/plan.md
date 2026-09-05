# Plan: Operator Console Mobile Navigation

**Change**: 260905-a9mn-operator-console-mobile-navigation
**Intake**: `intake.md`

## Requirements

### Operator Console: Mobile open is navigation

#### R1: Mobile console requests navigate to the operator terminal route
On mobile (`useIsMobile()` — the shared narrow-width-OR-coarse-pointer rule), an `OPERATOR_CONSOLE_EVENT` request SHALL NOT open a sheet: the layout-mounted seam listener resolves `{server, target}` (the `detail.server` pin wins, else `resolveConsoleServer(routeServer, servers, lastViewed)`; the operator window via `findOperatorWindow`) and navigates to the operator window's ordinary terminal route (`/$server/$window`). All three actions (`toggle`, `open`, `button`) collapse to this navigation on mobile, idempotently (already on the operator route ⇒ effectively a no-op). Desktop behavior — the ⌘J three-state machine, all action mappings — is byte-identical to today. Every entry point keeps its current one-line `requestOperatorConsole(...)` dispatch unchanged: the fork lives at the seam listener only.

- **GIVEN** a mobile viewport on any route with an operator window on the resolved server
- **WHEN** the tongue, chord, palette action, palette fallback row, sidebar pinned row, or overflow-menu row fires
- **THEN** the app navigates to `/$server/$window` for the operator window — no sheet renders
- **AND GIVEN** desktop, **THEN** the machine steps exactly as before

#### R2: The mobile sheet is retired — deleted, not gated
`OperatorConsole` (`app/frontend/src/components/operator-console.tsx`) SHALL become desktop-only: the `isMobile` sheet branch is DELETED — the `rk-console-drop absolute inset-0` sheet class arm, the mobile compose strip (textarea + Send), the mobile inline-error block, the mobile focus/restore effects, the `isMobile` plain-toggle arms in the event and Esc handlers, and the `if (isMobile) return drawer` tail. `transparent={!isMobile}` becomes `transparent` (always true). On mobile the component renders no drawer, and a desktop→mobile viewport flip resets the machine to `rest` so no effect or frame survives the gate (the self-gating-component rule: the gate owns the frames AND the effects). The `rk-console-drop` class in `globals.css` is removed if the sheet was its only consumer. The desktop title strip, status line, grips, glass, slide, paste/drop, and geometry/opacity stores are UNCHANGED.

- **GIVEN** a mobile viewport
- **WHEN** any console request fires
- **THEN** no element with `data-testid="operator-console"` mounts
- **AND GIVEN** an open desktop drawer, **WHEN** the viewport flips to mobile, **THEN** the machine resets to `rest` and the drawer unmounts

#### R3: The tongue survives as the mobile standing affordance
`OperatorConsoleTongue` SHALL remain the mobile standing affordance: a tap dispatches through the same seam (now navigating per R1), and the amber `waiting` dot (resolved server's operator `agentState === "waiting"`) survives. The tongue SHALL hide (a) when no operator window resolves on the resolved server (R6's omitted-not-disabled arm) and (b) while the current route already IS the resolved operator window's terminal route (the sheet-covers-it rule translated to navigation). Its `useOperatorConsoleOpen()` gate is replaced by the route check; the open-state slot itself remains for desktop consumers.

- **GIVEN** a mobile viewport on a route that is not the operator window's route, with an operator present
- **WHEN** the route renders
- **THEN** the tongue is visible (dot iff waiting) and a tap navigates to the operator route
- **AND GIVEN** the operator route itself, or an operator-less server, **THEN** no tongue renders

#### R4: Palette fallback `pendingSend` seeds the compose-strip draft
On mobile, the palette Ask-operator fallback row's typed query SHALL NOT auto-send: after navigating, the query is seeded into the operator route's compose-strip draft via the existing draft store (`setComposeText(draftKey, query)` in `app/frontend/src/lib/compose-draft-store.ts`, `draftKey` in its `server:windowId` shape) so the user reviews and sends. The sheet's auto-send-on-resolve effect (`pendingSend` + `target` wait) is deleted with the sheet; desktop `pendingSend` via `sendOperatorMessage` is unchanged.

- **GIVEN** a mobile viewport and a palette query with zero action matches on an operator-bearing server
- **WHEN** the Ask-operator row is activated
- **THEN** the app navigates to the operator route and the compose strip shows the query as its draft, unsent

### Operator Console: Origin context on the operator route

#### R5: Origin window rides `?from=` and keeps the templated chat lane
When the mobile fork (R1) navigates FROM a terminal route whose window is not itself the operator window, it SHALL append `?from=<originWindowId>` to the operator-route navigation. On the operator window's terminal route with a valid `from` param (a window id on the same server), the compose strip SHALL render the dismissable `OperatorContextChip` (from the existing chat-subject store — `setOperatorChatSubject` stamped from the route, dismiss/reset semantics preserved), and a plain compose-text submit SHALL ride the templated chat lane — `sendOperatorRequest(server, fromWindowId, "user-message", text)` — exactly as `sendOperatorMessage`'s fork does; with the chip dismissed or no/invalid `from`, sends are the ordinary compose-strip `sendToWindow` path. The fork applies ONLY to the plain text-submit path: special-key and mode-carrying sends (bottom-bar keys, enter, raw) always go direct to the pane — driving the TUI is the point of the route. The param is ephemeral route state (Constitution IV): no persistence, and navigations from non-terminal routes carry no param. Desktop's omnibox chip/lane fork is untouched.

- **GIVEN** a mobile terminal route `/$srv/@5` (not the operator window) with an operator on `$srv`
- **WHEN** the console opens (navigates) and the user submits text from the compose strip
- **THEN** the route is `/$srv/<opWin>?from=@5`, the chip names `@5`, and exactly one POST to `/api/windows/@5/operator-request` fires with `{template: "user-message", text}`
- **AND WHEN** the chip is dismissed, **THEN** the same submit goes through the compose strip's ordinary send to the operator window and no operator-request POST fires
- **AND GIVEN** a bottom-bar key (e.g. ↑ or Enter), **THEN** it is always a direct pane send regardless of the chip

#### R6: Operator-less server on mobile — hide the tongue, hint elsewhere
With no operator window on the resolved server, mobile SHALL NOT navigate: the tongue is hidden (omitted, not disabled — R3), and the remaining openers (chord, palette action, palette fallback row per its existing gate, sidebar pinned row per its existing omission, overflow-menu row) surface a brief hint via the existing toast surface (`useToast`, `app/frontend/src/components/toast.tsx`) carrying the established message `no operator on this server — run rk operator`. Desktop keeps today's behavior (the drawer's hint line).

- **GIVEN** a mobile viewport on a server with no `role === "operator"` window
- **WHEN** the chord or overflow-menu row fires
- **THEN** no navigation occurs and the toast hint renders once

### Tests

#### R7: Unit and e2e coverage moves with the behavior
The mobile-sheet suites in `app/frontend/src/components/operator-console.test.tsx` SHALL be rewritten to the navigation behavior (no sheet on mobile; tongue tap navigates; tongue hidden on the operator route and operator-less servers; viewport-flip machine reset); `app/frontend/src/lib/operator-console.test.ts` updated where seam behavior changed. The mobile e2e specs in `app/frontend/tests/e2e/operator-console.spec.ts` SHALL assert navigation to the operator terminal route with route chrome (compose strip + bottom bar visible, chip when `?from=` present) instead of the sheet, following the project's mobile-spec pattern (direct `goto` + `__rkTerminals` poll), and every added/modified `test()` carries its updated intent comment in the same commit (Constitution: Test Intent Comments). Sibling specs referencing the sheet or tongue are swept.

- **GIVEN** the changed surfaces
- **WHEN** `just test-frontend` and the scoped e2e specs run
- **THEN** all pass with intent comments matching the new behavior

### Non-Goals

- Desktop console behavior changes of any kind (drawer, machine, omnibox, grips, glass, slide, paste, geometry/opacity).
- New backend surface, routes, or persistence (`?from=` is ordinary ephemeral route state).
- Bottom-bar or compose-strip redesign — they are consumed as-is.

### Design Decisions

#### Mobile console = navigation, not a parallel input surface
**Decision**: on mobile, opening the operator navigates to the operator window's ordinary terminal route; the sheet is deleted.
**Why**: the operator is a TUI — prompts need arrows/Enter/Esc/Ctrl-C, which only the terminal route's compose strip + bottom bar deliver on mobile; the route chrome also carries the top-bar heading and the `--bottom-bar-pad` safe-area handling, dissolving both reported defects with zero new code (Constitution IV).
**Rejected**: mounting ComposeStrip + BottomBar inside the sheet (more parallel surface); patching the sheet's safe-area pad only (leaves the TUI-input gap).
*Introduced by*: 260905-a9mn-operator-console-mobile-navigation

#### Origin context rides a `?from=` search param
**Decision**: the mobile fork appends `?from=<originWindowId>` when navigating from a terminal route; the operator route stamps the chat subject from it and the compose strip's plain submit rides the templated chat lane behind the dismissable chip.
**Why**: preserves the sheet's chat-lane parity (server-derived envelope, Constitution X) without new persistence; the param is a route fact, visible and shareable.
**Rejected**: dropping origin context on mobile (loses the envelope the user confirmed they want); a module-store handoff without the param (invisible state, dies on reload).
*Introduced by*: 260905-a9mn-operator-console-mobile-navigation

#### Operator-less mobile fallback is hide-plus-hint
**Decision**: the tongue hides when no operator resolves; the other openers toast the existing hint instead of navigating.
**Why**: omitted-not-disabled is the established availability pattern; the openers that remain reachable (chord, palette, menu) must answer with something — the toast is the lightest existing surface.
**Rejected**: always-visible tongue with hint-on-tap (a standing affordance that cannot act); silent no-op (indistinguishable from breakage).
*Introduced by*: 260905-a9mn-operator-console-mobile-navigation

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fork the seam listener for mobile: in `app/frontend/src/components/operator-console.tsx` (or a colocated hook it mounts), on `useIsMobile()` resolve `{server, target}` from the request and `navigate({ to: "/$server/$window", params: { server, window: target.window.windowId }, search: ... })`; append `from: <routeWindow>` when navigating from a terminal route whose window ≠ the operator window on the same server; keep desktop machine handling byte-identical. Include the R6 no-target guard (no navigation). <!-- R1 --> <!-- rework: re-activation while already on the operator route must be a true no-op — skip the navigate and preserve existing search (the unconditional navigate replaced ?from= with empty search, silently detaching the chip) -->
- [x] T002 Delete the mobile sheet: remove the `isMobile` sheet branch, mobile compose strip, mobile error block, mobile focus/restore effects, plain-toggle arms, `pendingSend` auto-send effect, and `if (isMobile) return drawer` tail from `operator-console.tsx`; `transparent` always true; add the desktop→mobile viewport-flip machine reset to `rest`; remove `rk-console-drop` from `app/frontend/src/globals.css` if orphaned. <!-- R2 -->
- [x] T003 Retarget the tongue: `OperatorConsoleTongue` keeps the seam dispatch + amber dot; replace the `useOperatorConsoleOpen()` gate with (a) hide when `target` is undefined and (b) hide while the current route is the resolved operator window's route. <!-- R3 --> <!-- rework: the on-operator-route gate must compare route server AND window id (ids are server-scoped); also remove the now-consumerless open-state slot + its publish effect per the review's deletion candidate -->
- [x] T004 Accept `?from=` on the terminal route (follow the `?layout=` validation pattern in `app/frontend/src/router.tsx` / `app.tsx`): on the operator window's route with a valid same-server `from`, stamp `setOperatorChatSubject({server, windowId: from, name})` (clear on leave/invalid) and render `OperatorContextChip` in the compose strip area. <!-- R5 -->
- [x] T005 Fork the compose-strip plain text submit: in `app/frontend/src/components/compose-strip.tsx`, when the focused window is the operator window and `getOperatorChatTarget(server)` resolves, send via `sendOperatorRequest(server, subject.windowId, "user-message", text)` instead of `sendToWindow`; all special-key/mode sends stay direct; failures ride the strip's existing error surface and the draft survives. <!-- R5 -->
- [x] T006 Seed `pendingSend` into the draft: the mobile navigation arm carries the fallback row's query and writes `setComposeText("<server>:<opWindowId>", query)` after navigation (no auto-send). <!-- R4 -->
- [x] T007 Operator-less hint: in the mobile navigation arm, when no operator window resolves, show the `useToast` hint `no operator on this server — run rk operator` and do not navigate. <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Rewrite unit tests: `operator-console.test.tsx` mobile suites → navigation assertions (no sheet, tongue navigates/hides, viewport-flip reset); update `lib/operator-console.test.ts` and `compose-strip.test.tsx` for the new fork; run `just test-frontend`. <!-- R7 --> <!-- rework: restore the deleted desktop templated-lane UI coverage (sendOperatorMessage fork: chip render, dismissal→direct lane, reset on re-engage, pendingSend-same-commit-as-reset) against the omnibox or lib-level with a stamped subject; fix the 'already on the operator route' test that enshrined the ?from=-dropping behavior -->
- [x] T009 Rewrite e2e: `app/frontend/tests/e2e/operator-console.spec.ts` mobile specs → navigation + route chrome + `?from=` chip + templated-lane POST assertion (mock the operator-request route with the trailing-`*` glob rule); sweep sibling specs; update intent comments in the same commit; run the scoped specs via `just test-e2e "<spec>"`. <!-- R7 -->

## Execution Order

- T001 blocks T003, T006, T007 (they ride the navigation arm)
- T004 blocks T005
- T002 is independent after T001 lands the listener fork

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every mobile entry point results in navigation to the operator window's terminal route; no sheet mounts on mobile
- [x] A-002 R2: The sheet code path (compose textarea, Send, mobile error block, mobile focus effects, `rk-console-drop` if orphaned) is gone from the tree, and `OperatorConsole` renders desktop-only
- [x] A-003 R3: The tongue navigates, keeps its waiting dot, and hides on the operator route and on operator-less servers
- [x] A-004 R4: The palette fallback query lands as the operator route's compose draft, unsent
- [x] A-005 R5: `?from=` renders the chip and routes plain submits through the templated lane; dismissal and special keys go direct
- [x] A-006 R6: Operator-less mobile activations toast the hint and never navigate

### Behavioral Correctness

- [x] A-007 R1: Desktop machine/action mappings are byte-identical (existing desktop unit + e2e suites pass unmodified; the templated-lane UI coverage deleted with the mobile suites was restored at the omnibox level — chip render, dismissal→direct lane, reset on re-engage — plus the console-level pendingSend-same-commit-as-reset test)
- [x] A-008 R2: A desktop→mobile viewport flip closes any open drawer via a machine reset to `rest` with no orphaned effects

### Removal Verification

- [x] A-009 R2: No `isMobile` sheet branch, mobile compose, or `pendingSend` auto-send remains in `operator-console.tsx`; grep sweep covers src AND tests (spec files included) for retired sheet references

### Scenario Coverage

- [x] A-010 R5: e2e proves the `?from=` chip + templated POST and the dismissed-chip direct send on a 375px viewport
- [x] A-011 R7: Rewritten specs follow the mobile pattern (direct goto + `__rkTerminals` poll) and carry updated intent comments

### Edge Cases & Error Handling

- [x] A-012 R5: An invalid/foreign `?from=` (unknown or cross-server window id) renders no chip and sends direct, without error
- [x] A-013 R6: The toast hint fires once per activation and does not stack on repeated activations

### Code Quality

- [x] A-014 Pattern consistency: navigation uses the existing cross-server sidebar pattern; search-param handling follows the `?layout=` idiom; no new state channels
- [x] A-015 No unnecessary duplication: the chat-subject store, chip component, draft store, and toast are reused — no parallel implementations
- [x] A-016 No comment narration or change-ID citations in code or tests (provenance sweep over src and tests)
- [x] A-017 No client polling introduced; SSE/route state only

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None outstanding — the cycle-1 candidates (the `isOperatorConsoleOpen`/`setOperatorConsoleOpen`/`useOperatorConsoleOpen` open-state slot and its publish effect) were deleted in the rework; this re-review found no newly redundant code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The mobile navigation arm stays inside the layout-mounted `OperatorConsole` listener (the component mounts on both form factors, renders desktop-only) rather than a second listener component | Keeps the one-seam invariant; router hooks are available at the root layout | S:70 R:85 A:80 D:75 |
| 2 | Confident | The compose-strip templated fork gates on focused-window-is-operator AND `getOperatorChatTarget(server)`, reusing the existing chat-subject store | Mirrors `sendOperatorMessage`'s send-time fork exactly; one semantics, two mounts | S:65 R:80 A:80 D:70 |
| 3 | Confident | The operator-less hint rides the existing `useToast` surface | Only existing transient-hint surface; console inline lines are gone with the sheet | S:60 R:85 A:75 D:70 |
| 4 | Confident | The tongue hides while already on the operator route (translation of the hidden-while-sheet-open rule) | A standing affordance pointing at the current page is noise; minimal correct gate | S:60 R:85 A:75 D:70 |
| 5 | Confident | `?from=` is accepted via the route's existing search-param validation and ignored gracefully when invalid | The `?layout=` ladder is the established idiom for terminal-route search state | S:65 R:80 A:80 D:75 |

5 assumptions (0 certain, 5 confident, 0 tentative).
