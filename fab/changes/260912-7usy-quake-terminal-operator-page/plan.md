# Plan: Quake Terminal Operator Page

**Change**: 260912-7usy-quake-terminal-operator-page
**Intake**: `intake.md`

> Read `intake.md` in full first — it carries the code facts (file:line anchors), the variant
> table, the backend contract table, and the graded assumptions this plan implements. Vocabulary
> is post-rename: `QuakeTerminal`, `components/quake-terminal.tsx`, `lib/quake-terminal.ts`,
> `tests/e2e/quake-terminal.spec.ts`, `requestQuakeTerminal`, the `rk:quake-terminal` seam.

## Requirements

### UI: The operator page (the operator window's route wears the quake surface)

#### R1: Form-factor-neutral operator-page gate
`app/frontend/src/app.tsx` SHALL derive `operatorPage = windowParam != null && currentWindow?.role === "operator"` (no `isMobile` term) and drive everything the old `quakeTerminalTabs` gate drove from it: the `TerminalActivityTabs` strip mount above the surface-layout column, `quakeTab = operatorPage ? (search.tab ?? "terminal") : "terminal"`, `cronTabActive` / `tasksTabActive` / `terminalHidden`, the hidden-not-unmounted surface-layout column, and the `WatchedTasks` / `CronList` / `CronLog` (+ one `CronStaleBanner`) content swap. The tty tile stays the ordinary `TerminalClient`; `surface-layout` / `?layout=` semantics are untouched. The strip's `pt-9` tongue clearance MUST apply only on mobile (`TerminalActivityTabs` gains a boolean prop or the mount branches on `isMobile`); markup, roles and test ids (`terminal-activity-tabs`, `role="tablist"`) are unchanged.

- **GIVEN** a desktop viewport on `/$server/@N` where `@N` carries `role === "operator"`
- **WHEN** the sessions payload resolves the window
- **THEN** the `terminal-activity-tabs` strip renders above the tty tile, and `?tab=tasks` hides the surface-layout column (the `hidden` class, still mounted) and mounts `WatchedTasks`
- **AND GIVEN** a desktop non-operator terminal route, **THEN** the tree renders byte-identically to today (no strip, no swap)

#### R2: `?tab=` is the page's segment state on desktop; the handoff is deleted
The `useEffect` at `app.tsx:955–972` that dispatched `requestQuakeTerminal({ action: "open", segment: search.tab })` and stripped `?tab=` on desktop SHALL be removed. `?tab=terminal|tasks|list|log` (validated by `lib/router-url.ts` `validateTerminalSearch`, `activity` → `log`) drives the page on every form factor through `TerminalActivityTabs`' `replace: true` search writes.

- **GIVEN** desktop, a cold load of `/$server/@N?tab=activity` on the operator window
- **WHEN** the window resolves
- **THEN** the page shows the Cron Log segment, the URL still carries `tab=log`-equivalent state (the param is retained, normalized), and no drawer opens

#### R3: The page's compose is the route's compose strip, forced on and footer-docked
While `operatorPage` holds, the `ComposeStrip` SHALL render regardless of `composeStripEnabled` (`composeStripVisible = composeStripEnabled || operatorPage`) and always in the FOOTER dock (`inTileDock` gains `&& !operatorPage`), so it stays visible under a non-terminal tab. No new store, no new send lane: drafts stay in `lib/compose-draft-store.ts`, sends ride the strip's existing direct / templated (`?from=` chip) fork. The drawer's `QuakeCompose` is untouched.

- **GIVEN** `localStorage["runkit-compose-strip"]` absent (preference off) on the desktop operator route
- **WHEN** the page renders on `?tab=list`
- **THEN** `compose-strip-input` is visible below the Cron List body
- **AND GIVEN** a desktop non-operator terminal route with the preference off, **THEN** no strip renders (today's behavior)

### UI: Drawer ⇄ page

#### R4: Openers on the operator route focus the page — no drawer, no toast
In `components/quake-terminal.tsx`'s seam listener the desktop `onOperatorRouteRef` branch SHALL: for `segment` absent or `"terminal"`, call `focusComposeStrip()` (`lib/compose-strip-events.ts`) — both `toggle` and `open` — and, when `detail.send` is set, seed the strip's draft via `setComposeText(\`${server}:${windowId}\`, send)` (mobile's existing behavior); for `segment ∈ {tasks, list, log}`, write `?tab=<segment>` in place (`navigate({ to: ".", search: prev => ({ ...prev, tab }), replace: true })`). `ALREADY_ON_OPERATOR_HINT`, `alreadyOnOperatorHintAtRef` and the toast SHALL be removed. The on-operator-route handling SHOULD be one form-factor-neutral code path the desktop and mobile arms both call (the mobile arm's already-on-route `?tab=` and draft-seeding branches are that code today). Requests on every other desktop route keep their open/toggle, server-pin and pending-send semantics.

- **GIVEN** desktop on the operator route
- **WHEN** ⌘J fires, or the palette `Operator: Open quake terminal` is picked
- **THEN** the compose strip's textarea receives focus, the machine stays `rest`, no drawer mounts, no toast
- **AND WHEN** `Operator: Show cron list` or the `◷` chip fires, **THEN** the URL gains `?tab=list` and the page swaps to Cron List

#### R5: The launcher collapses on the operator route
`components/quake-launcher.tsx` SHALL derive `onOperatorRoute` (route server/window equal the resolved `server` / `target.window.windowId`, the drawer's rule) and, while true, render its collapsed form (glyph + state dot + chord keycap, the change-2 `open`-state look, `engaged` false) instead of the standing textarea, with click → `focusComposeStrip()`. It MUST NOT call `setQuakeMachineState("open")` on that route. Its `useOperatorCompose` draft is left alone.

- **GIVEN** desktop ≥ lg on the operator route
- **WHEN** the launcher renders
- **THEN** no `quake-launcher` textarea is present, the collapsed control is, and clicking it focuses `compose-strip-input`

#### R6: `⤢ open as tab` with a palette twin
The drawer header row SHALL gain a `Control` icon-variant button between the pin and the collapse button — glyph `⤢`, `aria-label="Open as tab"`, `data-testid="quake-terminal-open-as-tab"`, rendered only while `target` resolves — whose click navigates to `/$server/$window` for the operator window with `search: segment === "terminal" ? {} : { tab: segment }` and then `setQuakeMachineState("rest")`. `lib/palette/quake-terminal.ts` SHALL export `buildQuakeTerminalOpenAsTabAction(...)` (id `quake-terminal-open-as-tab`, label `Operator: Open as tab`), registered in `app.tsx` after the pin entry and listed only while the desktop machine is `open` AND a target resolves (the pin entry's gating precedent).

- **GIVEN** the drawer open on `/$server/@3` (a non-operator route) with the Cron Log segment selected
- **WHEN** `⤢ open as tab` is clicked
- **THEN** the route becomes `/$server/@N?tab=log` for the operator window `@N` and the drawer is at `rest`

### UI: Start operator

#### R7: Start operator button in the operator-less body
The Operator Terminal segment's operator-less body (`data-testid="quake-terminal-empty"`) SHALL render a `Control` wide-variant button `Start operator` (`data-testid="quake-terminal-start-operator"`) with the unchanged `NO_OPERATOR_HINT` text as its sub-line (`text-text-secondary`). Click → `startOperator(server)`; pending state `disabled` + `aria-busy="true"` + label `starting…`; on 202 (or a 409 `operator_exists`, treated as success) nothing further is done — the SSE `sessions` payload carries the new `role === "operator"` window, `target` resolves and the embed mounts, unmounting the body; on any other error an inline `role="alert"` line (`data-testid="quake-terminal-start-error"`, `text-signal-red`) carries the server's `error` message and the button returns to idle. The page variant has no special branch (its route requires the operator window).

- **GIVEN** the drawer open on a server with no operator window
- **WHEN** `Start operator` is clicked and the backend answers `202 {"windowId":"@7","server":"default"}`
- **THEN** the button reads `starting…` and is disabled until the sessions payload carries `@7` as operator, then the `TerminalClient` for `@7` mounts and the empty body is gone
- **AND GIVEN** the backend answers `502 {"error":"run-kit operator: fab not found on PATH — …"}`, **THEN** that message renders under the button and the button is enabled again

#### R8: `Operator: Start operator` palette entry, gated on absence
A pure builder (`lib/palette/quake-terminal.ts` or its operator sibling) SHALL produce `{ id: "operator-start", label: "Operator: Start operator" }`; `app.tsx` registers it only when the resolved server has no operator window (`!hasOperatorWindow` — degrade to absent, never disabled), on both form factors. `onSelect` → `startOperator(server)`; on success (202 or 409-as-success with a `windowId`) navigate to `/$server/<windowId>`; on error `toast.addToast(message, "error")`.

- **GIVEN** a server with an operator window
- **WHEN** the palette opens
- **THEN** `Operator: Start operator` is not listed
- **AND GIVEN** a server without one, **WHEN** the entry is picked and the POST answers 202, **THEN** the route becomes `/$server/<windowId>`

#### R9: API client
`app/frontend/src/api/client.ts` SHALL export `OperatorStartResult = { windowId: string; server: string }` and `startOperator(server)`: `fetch(withServer("/api/operator/start", server), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })`, `throwOnError` on non-ok, `res.json()` otherwise. A 409 with code `operator_exists` MUST surface to callers distinguishably (the structured error carries `code`/`windowId`) so R7/R8 can treat it as success.

- **GIVEN** `startOperator("default")`
- **WHEN** the server answers 202
- **THEN** the promise resolves to `{ windowId, server }`; a 502 rejects with the server's message

### API: `POST /api/operator/start`

#### R10: Route contract
`app/backend/api/operator_start.go` (registered in `router.go` beside `/api/operator-request`) SHALL implement the intake's contract table: server from `serverFromRequest(r)` (body ignored); ONE `FetchSessions` pre-check → `500` on fetch error, `409` via `writeErrorCode(w, 409, "operator_exists", "operator already present")` + `windowId` when `findOperatorWindow` resolves; exec `[selfPath, "operator", "-L", server, "--json"]` (`selfPath` from the `resolveSelfPathFn` seam; never PATH-resolved `rk`) via `exec.CommandContext` under a **detached** context (`context.WithTimeout(context.Background(), operatorStartProcessTimeout)`, 90 s); read stdout line-by-line until the rk JSON envelope `{"ok":true,"result":{"window","server","created"}}` parses, bounded by `operatorStartReceiptTimeout` (30 s); on `created:true` → `s.sseHub.wake(server)` and `202 {"windowId","server"}`; `created:false` → `409 operator_exists` + `windowId`; non-zero exit before a receipt → `502 {"error": "<first non-empty stderr line>"}`; no receipt within 30 s → kill the process, `504 {"error":"operator start timed out"}`. After responding, the process finishes its kickoff in a goroutine (`cmd.Wait()`, non-zero exit logged at warn). The exec sits behind a package seam (`operatorStartRunFn`) so the status mapping is unit-testable; the seam's default implementation MUST be exercised by its own test (a stub script standing in for the binary).

- **GIVEN** a server with no operator and a stub returning `{"ok":true,"result":{"window":"@7","server":"default","created":true}}`
- **WHEN** `POST /api/operator/start?server=default`
- **THEN** `202 {"windowId":"@7","server":"default"}`, the argv seen by the seam is `[<self>, "operator", "-L", "default", "--json"]`, and the SSE hub was woken once for `default`
- **AND GIVEN** an operator already present, **THEN** `409` with `code: "operator_exists"` and its `windowId`, and the seam is never called
- **AND GIVEN** a stub exiting 1 with stderr `run-kit operator: fab not found on PATH — …`, **THEN** `502` with that line as `error`
- **AND GIVEN** a stub that never prints, **THEN** `504` within the receipt bound

### UI: Sidebar placeholder row

#### R11: Always-present operator row
`components/sidebar/index.tsx` SHALL accept an optional `onOperatorPlaceholder?: (server: string) => void` (threaded `Sidebar → ServerGroup` like `onOperatorCompose`; AppShell passes `(server) => requestQuakeTerminal({ action: "open", server, segment: "terminal" })`; `board/board-page.tsx` omits it). When `operatorEntry === null` AND the prop is present, `ServerGroupInner` renders in the pinned row's slot, inside the group's `{isOpen && …}` body: `HeadsetIcon` (13px) + name `operator` + sub-label `not running` (`text-text-secondary`), `data-testid="operator-placeholder-row"`, no status dot / cluster / marker well / flyout, `draggable={false}`, excluded from the selection registry and `dataKeys`; `role="treeitem"`, `aria-selected={false}`, roving key `${server}:operator-placeholder` leading the group's row slice; pointer click and Enter/Space through the tree path call the handler. Once a carrier appears the ordinary pinned `WindowRow` replaces it (no animation).

- **GIVEN** the terminal route's sidebar on a server with no operator window
- **WHEN** the group renders
- **THEN** `operator-placeholder-row` is the group's first row, `Tab`+`Enter` on it dispatches `rk:quake-terminal` with `{ action: "open", server, segment: "terminal" }`, and the drawer opens on Operator Terminal with the Start button
- **AND GIVEN** the board route's sidebar, **THEN** no placeholder renders
- **AND GIVEN** the sessions payload gains a `role === "operator"` window, **THEN** the placeholder is gone and the pinned `WindowRow` is present

### Docs: spec and rk skill text

#### R12: API spec and tutorial text
`docs/specs/api.md` SHALL gain a `POST /api/operator/start` section (request, the status table, Constitution I/IX notes) and a Route Summary row (`operator_start.go`). `app/backend/cmd/rk/skill/tutorial.md` line 64's "**No operator**" bullet SHALL add the dashboard path ("or press **Start operator** in the quake terminal (⌘J) / the `Operator: Start operator` palette entry") after checking `shll standards` for the skill-surface standard (fail-silent if `shll` is absent). Memory files are hydrate's, not apply's.

- **GIVEN** the spec's Route Summary
- **WHEN** read after apply
- **THEN** it lists `POST /api/operator/start` → `operator_start.go`

### Non-Goals

- Mobile behavior beyond what the shared gate implies (the forced compose strip on the operator route is the one deliberate mobile-visible consequence); the tongue, the navigation arm and `?from=` are untouched.
- Any change to `cmd/rk/operator.go`, the operator's launcher resolution, or the kickoff prompt — the route is a caller.
- Auto-starting the operator; Start affordances anywhere but the drawer body and the palette.
- Cron ungating (change 4); header state/tick/pin/collapse on the page; a fifth lens; `surface-layout` changes; the tmux status bar.
- Migrating the page's compose onto the operator compose seam.

### Design Decisions

#### The page's compose is the route's compose strip, not the operator compose seam
**Decision**: the operator page's docked compose is `ComposeStrip` — the route's own input, forced on and footer-docked while `operatorPage` holds; the drawer keeps `QuakeCompose`.
**Why**: mobile's operator route already uses the strip with its chat-lane fork and `?from=` chip; one route keeps one input across form factors; the plan's text names "the route's compose strip".
**Rejected**: rendering `QuakeCompose` on the page — it would split the route's input per form factor and duplicate inputs whenever the strip preference is on.
*Introduced by*: 260912-7usy-quake-terminal-operator-page

#### Operator-route openers focus the page compose
**Decision**: on the operator route every opener focuses the compose strip (terminal segment) or writes `?tab=` in place (other segments); the drawer never opens there and the toast is retired.
**Why**: the page IS the surface; a drawer over the operator's own terminal duplicates the embed, and a toast explains an inert action that no longer needs to be inert.
**Rejected**: keeping the toast for the terminal case — it answers a question the focus already answers.
*Introduced by*: 260912-7usy-quake-terminal-operator-page

#### Start operator is an HTTP door onto `rk operator -L --json`, responding on the receipt line
**Decision**: the daemon execs its own binary (`resolveSelfPathFn`) as `operator -L <server> --json`, responds once the JSON receipt parses (30 s bound) and lets the kickoff delivery finish under a detached 90 s context.
**Why**: `rk operator` already owns creation, role-stamping, singleton probing, agent resolution and kickoff; the receipt precedes the up-to-25 s kickoff, so waiting for exit would make the button feel hung; 90 s mirrors the cron respawn's bound for the identical launch.
**Rejected**: the managed job window (`runJobFn`) — asynchronous, no `windowId` in the response; PATH-resolved `rk` — the daemon's PATH is not the user's.
*Introduced by*: 260912-7usy-quake-terminal-operator-page

#### Placeholder row opens the drawer, not a synthetic route
**Decision**: the operator-less sidebar row exists on every server group the shell wires a handler for and its activation opens the drawer on Operator Terminal.
**Why**: Constitution IV's fixed route set — an overlay needs no URL, and a window-less `/$server/operator` would have to redirect once the operator exists.
**Rejected**: rendering nothing (today) — the operator's constant landmark disappears exactly when a new user needs it.
*Introduced by*: 260912-7usy-quake-terminal-operator-page

### Deprecated Requirements

#### Desktop openers are inert on the resolved operator route
**Reason**: the operator route now renders the page; openers focus it (R4).
**Migration**: R4 (focus / in-place `?tab=`); `ALREADY_ON_OPERATOR_HINT` and its throttle ref are removed.

#### Desktop `?tab=` handoff to the drawer
**Reason**: `?tab=` is live on the page on every form factor (R2).
**Migration**: the `app.tsx` effect is deleted; the two e2e tests are rewritten.

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `OperatorStartResult` + `startOperator(server)` to `app/frontend/src/api/client.ts` (the `sendServerOperatorRequest` shape; structured 409 `operator_exists` distinguishable to callers) with a colocated unit test in `api/client.test.ts` <!-- R9 -->
- [x] T002 [P] Create `app/backend/api/operator_start.go`: `handleOperatorStart`, the `operatorStartRunFn` seam + its default `runOperatorStart` (StdoutPipe, first-parsing-line receipt, detached 90 s context, 30 s receipt bound, kill on timeout, goroutine `Wait` + warn log), status mapping per R10, `s.sseHub.wake(server)` on success; register `r.Post("/api/operator/start", s.handleOperatorStart)` in `api/router.go` <!-- R10 -->
- [x] T003 Write `app/backend/api/operator_start_test.go`: argv shape, 409 pre-check (seam not called), 202 + wake once, 409 on `created:false`, 502 with stderr line, 504 on receipt timeout, plus a default-implementation test with a stub script binary; run `cd app/backend && go test ./api/ -run Operator` (run `just _ensure-tmux-conf` first in a fresh worktree) <!-- R10 -->

### Phase 2: Core Implementation

- [x] T004 In `app/frontend/src/app.tsx`: replace `quakeTerminalTabs` with `operatorPage` (drop `isMobile`), delete the desktop `?tab=` handoff effect (lines ~955–972), add `composeStripVisible = composeStripEnabled || operatorPage`, add `&& !operatorPage` to `inTileDock`, use `composeStripVisible` at the footer-dock mount; pass a mobile-only clearance prop to `TerminalActivityTabs` (`components/terminal-activity-tabs.tsx` makes `pt-9` conditional) <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T005 In `app/frontend/src/components/quake-terminal.tsx`: extract the on-operator-route handling into one form-factor-neutral helper (terminal/absent segment → `focusComposeStrip()` + optional `setComposeText` seeding of `send`; non-terminal segment → in-place `?tab=` navigate) used by both the desktop gate branch and the mobile arm's already-on-route branch; remove `ALREADY_ON_OPERATOR_HINT` / `alreadyOnOperatorHintAtRef` / the toast <!-- R4 -->
- [x] T006 In `app/frontend/src/components/quake-launcher.tsx`: derive `onOperatorRoute` from the resolved target vs. route params; render the collapsed control there (no textarea) with click → `focusComposeStrip()`; ensure no `setQuakeMachineState("open")` path fires on that route <!-- R5 -->
- [x] T007 Add the `⤢ open as tab` header control to `quake-terminal.tsx` (icon `Control`, aria-label, test id, target-gated, navigate + `rest`) and `buildQuakeTerminalOpenAsTabAction` in `app/frontend/src/lib/palette/quake-terminal.ts`; register it in `app.tsx` after the pin entry, listed only while `open` with a resolved target <!-- R6 -->
- [x] T008 In `quake-terminal.tsx` replace the operator-less hint body with the `Start operator` wide `Control` + hint sub-line + pending/error states calling `startOperator(server)` (409 `operator_exists` = success; other errors inline under `quake-terminal-start-error`) <!-- R7 -->
- [x] T009 Add the `Operator: Start operator` builder (id `operator-start`) and register it in `app.tsx` gated on `!hasOperatorWindow`, both form factors; `onSelect` → `startOperator` → navigate `/$server/<windowId>` or error toast <!-- R8 -->
- [x] T010 In `app/frontend/src/components/sidebar/index.tsx`: add `onOperatorPlaceholder` to `SidebarProps` and `ServerGroup` props, thread it, render the placeholder row per R11 in the pinned slot (roving key `${server}:operator-placeholder` leading the slice, tree ARIA, activation via click + Enter/Space, excluded from selection/dataKeys); wire the handler in `app.tsx`'s `<Sidebar>` mount (`requestQuakeTerminal({ action: "open", server, segment: "terminal" })`); leave `board-page.tsx` unwired <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T011 [P] Vitest `app/frontend/src/app.test.tsx`: desktop operator route mounts the strip and swaps on `?tab=tasks`; compose strip renders with the preference off; a non-operator desktop route renders neither; no seam dispatch on a desktop `?tab=` arrival <!-- R1 --> <!-- R2 --> <!-- R3 -->
- [x] T012 [P] Vitest `quake-terminal.test.tsx` (seam on the operator route: focus spy called, machine unchanged, `?tab=` write for non-terminal segments; Start button states incl. 409-as-success and inline 502; `⤢ open as tab` navigate + rest) and `quake-launcher.test.tsx` (collapsed form + focus-forward on the operator route) <!-- R4 --> <!-- R5 --> <!-- R6 --> <!-- R7 -->
- [x] T013 [P] Vitest `lib/palette/quake-terminal.test.ts` (open-as-tab builder; Start operator builder + `app.test.tsx` listing iff no operator) and sidebar tests (placeholder renders only with the handler and no carrier; activation calls it; leading roving order; swap to the real row) <!-- R6 --> <!-- R8 --> <!-- R11 -->
- [x] T014 e2e `app/frontend/tests/e2e/quake-terminal.spec.ts`: rewrite the two desktop deep-link tests (`:821`, `:925`) to assert the page's segment with the param retained; add ⌘J-on-operator-route focuses `compose-strip-input` (no drawer); `Operator: Show cron list` on that route lands on `?tab=list`; `⤢ open as tab` from the drawer on `/$server/@N` (non-operator) lands on the operator route with `?tab=`; update every `test()` JSDoc (Proves/Steps) in the same commit <!-- R2 --> <!-- R4 --> <!-- R6 -->
- [x] T015 New e2e `app/frontend/tests/e2e/operator-page.spec.ts` with a file header documenting the `page.route` stubs: desktop operator route shows the strip and swaps the body with the strip forced on; `Start operator` posts to `/api/operator/start?server=…` (stubbed 202) and the embed mounts once the mocked sessions payload carries the operator window; the stubbed 502 message surfaces inline; the placeholder row is present without an operator, opens the drawer on Enter, and is replaced by the pinned row when the operator appears (follow `quake-terminal.spec.ts`'s `mockBackend` idiom) <!-- R7 --> <!-- R11 --> <!-- R1 -->
- [x] T016 Verification gate: `cd app/frontend && npx tsc --noEmit`; the Vitest suites above via `just test-frontend` scoped to the touched files where the recipe allows (else the full frontend unit run); `just test-e2e quake-terminal.spec`, `just test-e2e operator-page.spec`, `just test-e2e operator-pinned-row.spec`, `just test-e2e mobile-cron-tabs.spec` (ALWAYS pass the `.spec` suffix — the worktree dir is named `quake-terminal-operator-page` and a bare filter matches every spec; gate on the `N passed` line, an ` ELIFECYCLE` after "see you again~" is rig teardown); fix failures; never run the full suite as the gate <!-- R1 --> <!-- R10 -->

### Phase 4: Polish

- [x] T017 `docs/specs/api.md`: add the `POST /api/operator/start` section and Route Summary row; `app/backend/cmd/rk/skill/tutorial.md:64`: add the Start operator clause after `command -v shll >/dev/null 2>&1 && shll standards` (read the skill-surface standard if listed; skip silently if `shll` is absent) <!-- R12 -->

## Execution Order

- T001–T003 are independent of the frontend work and can run first or alongside T004–T010.
- T004 blocks T005/T006 conceptually (they rely on `operatorPage` rendering the strip); T005 blocks T012's seam tests; T007–T009 depend on T001.
- T014/T015 run after T004–T010; T016 last before T017.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The desktop operator route renders the `terminal-activity-tabs` strip and swaps the body on `?tab=`; non-operator desktop routes are unchanged
- [x] A-002 R2: The desktop `?tab=` handoff effect no longer exists and a cold `?tab=` load lands on the page's segment
- [x] A-003 R3: The compose strip renders on the operator page with the preference off and stays visible under non-terminal tabs (footer dock)
- [x] A-004 R4: Openers on the operator route focus the strip or write `?tab=` in place; `ALREADY_ON_OPERATOR_HINT` is gone
- [x] A-005 R5: The launcher renders collapsed on the operator route and its click focuses the strip
- [x] A-006 R6: `⤢ open as tab` exists, navigates with the right `search`, rests the machine, and has the gated palette twin
- [x] A-007 R7: The Start operator button renders in the operator-less body with pending/success/error states
- [x] A-008 R8: `Operator: Start operator` is listed iff no operator and navigates on success
- [x] A-009 R9: `startOperator` client exists with the documented shape
- [x] A-010 R10: `POST /api/operator/start` implements the full status table with the detached-context / receipt-line exec
- [x] A-011 R11: The placeholder row renders per spec, is keyboard-reachable, opens the drawer, and swaps to the real row
- [x] A-012 R12: `docs/specs/api.md` and `tutorial.md` carry the new text

### Behavioral Correctness

- [x] A-013 R4: ⌘J on the desktop operator route leaves the machine at `rest` and mounts no drawer
- [x] A-014 R2: The e2e deep-link tests assert the page (param retained), not the drawer
- [x] A-015 R3: A desktop non-operator terminal route with the strip preference off still renders no strip; with it on, the in-tile dock is still used there

### Removal Verification

- [x] A-016 R4: No reference to `ALREADY_ON_OPERATOR_HINT` / `alreadyOnOperatorHintAtRef` remains
- [x] A-017 R2: No `requestQuakeTerminal` dispatch remains in `app.tsx` keyed on `search.tab`

### Scenario Coverage

- [x] A-018 R7: e2e — stubbed 202 leads to the embed mounting and the button unmounting; stubbed 502 surfaces inline
- [x] A-019 R11: e2e — placeholder row present without an operator, Enter opens the drawer on Operator Terminal, replaced by the pinned row once the operator exists
- [x] A-020 R6: e2e — `⤢ open as tab` from a non-operator route lands on `/$server/@N?tab=<segment>`
- [x] A-021 R10: Go tests cover 202 / 409 (both paths) / 502 / 504 and the argv shape; the default seam implementation is tested with a stub binary

### Edge Cases & Error Handling

- [x] A-022 R7: A 409 `operator_exists` on Start is treated as success (no error line)
- [x] A-023 R10: The exec context is detached from the request context (a client disconnect does not kill the launch) and the process is killed on receipt timeout
- [x] A-024 R11: The placeholder is excluded from multi-select and `dataKeys`; a collapsed group hides it
- [x] A-025 R1: `mobile-cron-tabs.spec` still passes (mobile operator route unchanged apart from the forced strip)

### Code Quality

- [x] A-026 Pattern consistency: new code follows the surrounding naming, error-handling and structural patterns (optional-prop threading, pure palette builders, `writeError`/`writeErrorCode`, seams as package vars)
- [x] A-027 No unnecessary duplication: the operator-route handling is one shared path for both arms; `focusComposeStrip`, `setComposeText`, `withServer`, `throwOnError`, `serverFromRequest`, `findOperatorWindow`, `resolveSelfPathFn` reused
- [x] A-028 Type narrowing over assertions in the new frontend code; no `as` casts introduced
- [x] A-029 No god functions (>50 lines without reason) in the new handler or components
- [x] A-030 No magic numbers: timeouts and ids are named constants
- [x] A-031 No client polling: success is observed through the SSE `sessions` payload
- [x] A-032 No comment narration; comments state constraints only; no change-ID citations in code comments
- [x] A-033 Every new/changed Playwright `test()` carries the Proves/Steps JSDoc and each new spec has a file header
- [x] A-034 Tests added for every new behavior (Vitest, Go, e2e)

### Security

- [x] A-035 R10: The exec is an argv slice under a bounded context; `server` is validated by `serverFromRequest`; no shell string, no PATH-resolved binary
- [x] A-036 R10: All mutating traffic is POST (Constitution IX)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant; its two removals (the desktop `?tab=` handoff effect in `app.tsx` and the `ALREADY_ON_OPERATOR_HINT` toast path in `quake-terminal.tsx`) were planned in `## Deprecated Requirements` and verified under `### Removal Verification` (A-016/A-017).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The shared on-operator-route helper lives in `quake-terminal.tsx` (not `lib/quake-terminal.ts`) because it needs `navigate` and the toast/refs already held there | Both arms already live in that component; moving it to lib would need router injection | S:60 R:85 A:80 D:70 |
| 2 | Confident | The Start builder is placed in `lib/palette/quake-terminal.ts` beside the other `Operator:` builders | One file already owns the operator palette shapes | S:60 R:90 A:85 D:80 |
| 3 | Confident | Structured 409 detection reuses the client's existing structured-error type from `throwOnError` (the `code` field the operator-request lane already surfaces) | The 409 `staged_send_failure` precedent uses `writeErrorCode`; the client already parses `code` | S:55 R:85 A:75 D:70 |
| 4 | Confident | `TerminalActivityTabs` takes a `clearTongue?: boolean` prop for the `pt-9` wrapper rather than the mount branching in `app.tsx` | Keeps the mount a one-liner and the mobile-only rule with the strip | S:50 R:90 A:80 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
