# Plan: Lift TopBar to Persistent Root Layout

**Change**: 260707-4vq2-lift-topbar-root-layout
**Intake**: `intake.md`

## Requirements

### Root Layout: Persistent TopBar Mount

#### R1: Single persistent TopBar mount above the router outlet
`RootWrapper` (`app/frontend/src/app.tsx`) SHALL render a single `TopBar` (via a `RootTopBar` wrapper) once, in a flex-column layout inside the existing provider stack, above the router `<Outlet>`. The TopBar SHALL NOT unmount when navigating between routes.

- **GIVEN** the app is mounted at `/`
- **WHEN** the user navigates to `/$server`, `/$server/$window`, or `/board/$name`
- **THEN** the top-bar DOM element retains stable React identity (it re-renders in place, it is not unmounted and remounted)
- **AND** its heading/mode updates to reflect the new route

#### R2: Suspense boundary wraps only the content region
The root layout's `<Suspense fallback={null}>` boundary SHALL wrap only the `<Outlet>` content region, not the TopBar header. The `--app-height` viewport variable SHALL be consumed by the root layout container so the column fills the viewport.

- **GIVEN** the user is on any route with the TopBar painted
- **WHEN** they navigate to `/board/$name` and the lazy board chunk is still loading
- **THEN** the TopBar stays painted while only the content body is blank

### TopBar Prop Delivery

#### R3: Route-derived mode and page identity at root
`RootTopBar` SHALL derive `mode` and page identity synchronously from the current route (via `useMatches()`/route params): `/` → `cockpit`; `/board/$name` → `board` (with `boardName` from `$name`); `/$server` → `root`; `/$server/$window` → `terminal`; unmatched routes → a minimal `cockpit`-like fallback mode. The derived mode SHALL flip the moment the URL changes, independent of the incoming page's mount.

- **GIVEN** the user clicks a board link from the cockpit
- **WHEN** the URL changes to `/board/foo` but the board chunk has not yet loaded
- **THEN** the TopBar renders `Board: foo` derived from the URL param

#### R4: Page-registered slot context for data/handlers
A new slot context (`TopBarSlotProvider`, `app/frontend/src/contexts/top-bar-slot-context.tsx`) SHALL let pages publish their TopBar data/handler props (`sessions`, `currentSession`, `currentWindow`, `isConnected`, `sidebarOpen`, `server`, `sessionName`, `windowName`, `onNavigate`, `onToggleSidebar`, `onCreateSession`, `onCreateWindow`, and board extras `paneCount`/`serverCount`/`waitingPaneCount`/`boards`/`onCloseFocused`/`closeDisabled`) into the context via an effect on mount/update and clear them on unmount. It SHALL follow the `FocusedTerminalProvider` precedent (referentially-stable dispatcher, `useMemo` value). Heavy handlers (`navigateToWindow`, `handleCreateSessionInstant`, etc.) SHALL stay defined in `AppShell`/`BoardPage` — no logic migrates to root.

- **GIVEN** `AppShell` mounts for `/$server/$window`
- **WHEN** it registers its TopBar props into the slot
- **THEN** `RootTopBar` renders `Terminal: <window>` with a working window switcher and session dropdown fed by those props

#### R5: Tolerant-empty defaults when no page has registered
When no page has published slot props yet (first frame after navigation, or a lazy chunk still loading), `RootTopBar` SHALL render the route-derived mode with the tolerant-empty prop shape (`sessions=[]`, `currentSession=null`, `currentWindow=null`, `sessionName=""`, `windowName=""`, `server=""`, `sidebarOpen=false`, no-op callbacks) that the cockpit/board mounts already use.

- **GIVEN** the user navigates from `/` to `/board/foo`
- **WHEN** the board chunk has not registered its slot props yet
- **THEN** `RootTopBar` renders `Board: foo` (from the URL) with tolerant-empty data props and no crash

### Per-Page TopBar Removal + Registration

#### R6: AppShell removes its TopBar mount and registers into the slot
`AppShell` (`app.tsx`, the `<header style={{ gridArea: "topbar" }}><TopBar …/></header>` block) SHALL delete its `<TopBar>` mount and instead register its props into the slot context. The `terminal` vs `root` distinction (`windowParam ? "terminal" : "root"`) is derived at root; AppShell no longer computes `topBarMode`.

- **GIVEN** `AppShell` is mounted
- **WHEN** it renders
- **THEN** it contains no `<TopBar>` element and the Shell grid contains no `topbar` grid area
- **AND** the persistent root TopBar reflects AppShell's registered props

#### R7: ServerListPage removes its TopBar mount
`ServerListPage` (`server-list-page.tsx`) SHALL delete its `<TopBar mode="cockpit" …/>` mount. Its outer wrapper `flex flex-col h-screen` SHALL become `flex flex-col h-full` (the root layout owns viewport height). It MAY register `isConnected={hostMetricsConnected}` into the slot; cockpit mode otherwise needs no page data.

- **GIVEN** the cockpit route `/` is active
- **WHEN** `ServerListPage` renders
- **THEN** it renders no `<TopBar>` of its own, and the persistent root TopBar renders `cockpit` mode with the host-metrics connection dot
- **AND** the page body scrolls beneath the persistent bar without overflowing the viewport

#### R8: BoardPage removes its TopBar mount and registers board extras
`BoardPage` (`board-page.tsx`, the `<header style={{ gridArea: "topbar" }}><TopBar mode="board" …/></header>` block) SHALL delete its `<TopBar>` mount and register the board extras (`boardName`, `paneCount`, `serverCount`, `waitingPaneCount`, `boards`, `onCloseFocused`, `closeDisabled`, `isConnected`, `sidebarOpen`, `onToggleSidebar`) into the slot context.

- **GIVEN** the board route `/board/foo` is active with panes pinned
- **WHEN** `BoardPage` renders
- **THEN** it renders no `<TopBar>` of its own, and the persistent root TopBar renders `Board: foo` with the pane/server counts, waiting badge, board switcher, and ✕ unpin control fed by the registered extras

### Shell Grid

#### R9: Shell drops the topbar row and hands off viewport height
`Shell` (`components/shell/shell.tsx`) SHALL remove the `topbar` grid area. Desktop `gridTemplateAreas` → `'"sidebar content" "sidebar bottombar"'` with rows `1fr auto`; mobile → `'"content" "bottombar"'` with rows `1fr auto`. Shell height `var(--app-height, 100vh)` SHALL become `100%` (it fills the root layout's `flex-1` region). The mobile drawer overlay grid child SHALL move from `gridRow: "2 / 4"` to `gridRow: "1 / 3"`. `useSidebarKeyboardToggle` (Cmd+\) SHALL remain in Shell with unchanged behavior.

- **GIVEN** the desktop viewport (≥ 640px)
- **WHEN** an `AppShell` or `BoardPage` route renders
- **THEN** the full-width bar sits above the sidebar+content stack exactly as before (geometry preserved), the Shell grid has no `topbar` area, and the Shell fills its parent flex region
- **AND** on mobile the sidebar drawer overlays the content+bottombar rows correctly at the new row indices

### Edge Routes

#### R10: Not-Found / ServerNotFound / ServerWaiting render below the persistent bar
`NotFoundPage` (`router.tsx`), `ServerNotFound` and `ServerWaiting` (`app.tsx`) SHALL change their `h-screen` centering wrapper to `h-full` so they fit inside the root layout's content region below the persistent TopBar without overflowing. The root mode derivation SHALL cover the unmatched-route case with a minimal `cockpit`-like fallback (R3).

- **GIVEN** the user navigates to a non-existent path, an unknown server, or a just-created server that is still coming up
- **WHEN** the respective edge component renders in the outlet region
- **THEN** it renders below the persistent TopBar, centered within the content region, with no vertical overflow past the viewport

### Non-Goals

- Sidebar / BottomBar / Shell persistence across routes — they remain per-page; the Sidebar still remounts on `/$server` ↔ `/board/$name`.
- Lazy-loading strategy / Suspense fallback redesign — `fallback={null}` stays; only its blast radius shrinks to the content region.
- TopBar internal rendering — all four modes keep their exact current appearance; this change relocates the mount, it does not redesign the bar.
- Backend / API / tmux changes — frontend only.

### Design Decisions

1. **Route-derived mode + page-registered slot** (not "move all handlers to root"): route params give synchronous mode/identity at the moment the URL flips; the slot context delivers heavy page data/handlers without migrating `navigateToWindow`'s View-Transitions gate or `handleCreateSessionInstant`'s optimistic ghosts out of their owners. — *Why*: keeps the largest file's logic in place, minimizes blast radius, matches the `FocusedTerminalProvider` precedent already mounted in `RootWrapper`. — *Rejected*: lifting all handlers to root (large, risky migration for no user-visible gain).
2. **`RootTopBar` merges route-derived mode over slot data**: the derived mode/identity wins for `mode`/`boardName`; slot data fills the tolerant-empty props. — *Why*: heading must not wait on the incoming page's mount (lazy board). — *Rejected*: mode-from-slot (would flash a stale mode for one frame on navigation, and blank the heading while the board chunk loads).
3. **Geometry-preserving Shell extraction**: Shell's grid already renders the topbar full-width above the sidebar, so removing the row and having the root layout paint the bar above Shell is a visual no-op. — *Why*: lowest-risk way to preserve the current desktop/mobile stack.
4. **Pathless layout route + `fullbleed` moved to the root container** (added at apply): the persistent chrome lives in an `AppLayout` component mounted by a **pathless layout route** (`id: "app-layout"`) that uniformly parents every page route, so `AppLayout` sits at a stable match depth and does not remount across navigation. The `html.fullbleed` viewport-pinning (`position: fixed; inset: 0`) moved from `.app-shell` to the root `.app-root` container, and `.app-shell` now fills its flex parent (`position: relative; height: 100%`). — *Why*: (a) hosting the bar directly in `RootWrapper` remounted the root subtree on the index-route transition; a pathless layout normalizes tree depth. (b) `.app-shell` being `position: fixed; inset: 0` overlaid the persistent header — pinning the root container instead keeps the header above the content region. — *Rejected*: keeping the bar in `RootWrapper` (remount asymmetry); leaving `.app-shell` fixed (header overlay/click-interception).

## Tasks

### Phase 1: Slot Context Scaffolding

- [x] T001 Create `app/frontend/src/contexts/top-bar-slot-context.tsx` — a `TopBarSlotProvider` + `useTopBarSlot` (read) + `useRegisterTopBarSlot` (register/clear via effect) following the `FocusedTerminalProvider` precedent (referentially-stable dispatcher ref, `useMemo` value). Define a `TopBarSlotValue` type covering the page-published props enumerated in R4; page-independent props (route-derived mode/boardName) are NOT in the slot. Registration is last-writer-wins with clear-on-unmount. <!-- R4 -->

### Phase 2: Root Layout + RootTopBar

- [x] T002 In `app/frontend/src/app.tsx`, add a `RootTopBar` component that: <!-- rework RESOLVED (cycle 1): NotFoundPage now signals not-found via a dedicated boolean channel on TopBarSlotContext (`useSignalTopBarNotFound` sets true on mount / false on unmount); RootTopBar reads it via `useTopBarNotFound()` and forces `mode="cockpit"` (+ null boardName) BEFORE the route-param walk, so /board/x/y no longer derives "Board: x". The `/a/b/c` ServerNotFound arm is untouched (notFound is false there — verified green by create-server-waiting e2e). Stale route-tree comment at router.tsx:121 fixed (notFoundComponent → app-layout route); stale gridArea:"topbar" fixture removed from shell.test.tsx (handle repointed to the `content` child). Verified by new e2e assertion (/board/x/y → cockpit heading, no "Board x") + slot-context unit tests. -->: reads route matches via `useMatches()` and derives `mode` + page identity (`/` → cockpit, `/board/$name` → board with `boardName`, `/$server/$window` → terminal, `/$server` → root, unmatched → cockpit-like fallback); reads slot data via `useTopBarSlot()`; renders `<TopBar>` with route-derived mode/boardName merged over tolerant-empty-defaulted slot data (R3, R5). <!-- R3 -->
- [x] T003 In `app/frontend/src/app.tsx`, restructure `RootWrapper`: wrap the existing provider stack's inner region with `TopBarSlotProvider`, then a flex-column `<div style={{ height: "var(--app-height, 100vh)" }} className="flex flex-col">` containing a `<header className="shrink-0"><RootTopBar/></header>` and a `<div className="flex-1 min-h-0"><Suspense fallback={null}><Outlet/></Suspense></div>` (R1, R2). Keep all existing providers in place. <!-- R1 -->
- [x] T004 Handle the `--app-height` var handoff: the root layout div is now the `--app-height` consumer (R2). Decide `useVisualViewport()` placement — keep it in Shell (still runs on shell routes) OR move to `RootWrapper` so cockpit/edge routes also track the iOS keyboard; record the decision in `## Assumptions`. <!-- R2 -->

### Phase 3: Page Mount Removal + Registration

- [x] T005 In `app/frontend/src/app.tsx` `AppShell`: delete the `<header style={{ gridArea: "topbar" }}><TopBar …/></header>` block and the now-unused `topBarMode` local; add an effect (via `useRegisterTopBarSlot`) that registers AppShell's TopBar props (`sessions`, `currentSession`, `currentWindow`, `sessionName: displaySession`, `windowName: displayName`, `isConnected`, `sidebarOpen`, `server`, `onNavigate: navigateToWindow`, `onToggleSidebar`, `onCreateSession: handleCreateSessionInstant`, `onCreateWindow: handleCreateWindow`) and clears on unmount (R6). <!-- R6 -->
- [x] T006 In `app/frontend/src/components/server-list-page.tsx`: delete the `<TopBar mode="cockpit" …/>` mount and its `TopBar` import; change the outer wrapper `flex flex-col h-screen` → `flex flex-col h-full`; register `isConnected: hostMetricsConnected` into the slot via `useRegisterTopBarSlot` (cockpit mode otherwise needs no page data) (R7). <!-- R7 -->
- [x] T007 In `app/frontend/src/components/board/board-page.tsx` `BoardPageContent`: delete the `<header style={{ gridArea: "topbar" }}><TopBar mode="board" …/></header>` block and its `TopBar` import (keep `HELP_URL` if still used); register the board extras (`boardName: name`, `paneCount: entries.length`, `serverCount`, `waitingPaneCount`, `boards`, `onCloseFocused: unpinFocused`, `closeDisabled: entries.length === 0`, `isConnected: boardConnected`, `sidebarOpen`, `onToggleSidebar`) into the slot via `useRegisterTopBarSlot` (R8). <!-- R8 -->

### Phase 4: Shell Grid + Edge Routes

- [x] T008 In `app/frontend/src/components/shell/shell.tsx`: remove the `topbar` grid area — desktop `gridTemplateAreas` → `'"sidebar content" "sidebar bottombar"'` rows `1fr auto`; mobile → `'"content" "bottombar"'` rows `1fr auto`; change both `height` values from `var(--app-height, 100vh)` to `100%`; move the mobile drawer overlay child `gridRow: "2 / 4"` → `gridRow: "1 / 3"`; update the topology comment. Leave `useSidebarKeyboardToggle` unchanged (R9). <!-- R9 -->
- [x] T009 In `app/frontend/src/router.tsx` (`NotFoundPage`) and `app/frontend/src/app.tsx` (`ServerNotFound`, `ServerWaiting`): change the centering wrapper `h-screen` → `h-full` on all three so they fit the content region below the persistent bar (R10). <!-- R10 -->

### Phase 5: Tests

- [x] T010 Update `app/frontend/src/components/server-list-page.test.tsx`: the `ServerListPage — Cockpit TopBar` describe block (3 tests, lines ~275-304) asserts `ServerListPage` renders the shared TopBar itself. Since the mount moves to root, relocate/rewrite these — the cockpit no-heading assertion (no in-page `<h1>` PageHeading) stays on the page; the TopBar-presence assertions move to a root-layout test or are removed as no longer this component's responsibility. Keep the suite green. <!-- R7 -->
- [x] T011 [P] Add/adjust a Vitest unit test for `top-bar-slot-context.tsx` (register → read → clear-on-unmount, last-writer-wins) mirroring `focused-terminal-context.test.tsx`. <!-- R4 -->
- [x] T012 Add an e2e spec `app/frontend/tests/e2e/top-bar-persistence.spec.ts` (+ sibling `.spec.md`) <!-- rework RESOLVED (cycle 1): companion doc + spec.ts header now state that hop 2 (brand-crumb click) is a RELOAD BOUNDARY — the brand is a raw <a href="/"> that TanStack Router does not intercept, so it is a full document navigation, not client-side; hop 2 reframed to assert cold-load chrome mount, and only hops 1 & 3 carry the no-remount persistence claim. Added a second e2e test asserting /board/x/y renders the cockpit fallback heading (not "Board x") — the T002 fix (A-015). Both e2e tests pass. --> asserting the TopBar DOM node identity is preserved across `/` → `/$server` → `/board/$name` navigation (element-handle comparison — the direct flicker regression test), and that the heading updates per route. Update any existing e2e that locates the top bar within page structure if the move breaks its locator. <!-- R1 -->

### Phase 6: Verification

- [x] T013 Run gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "top-bar-persistence"` (and any e2e touched). Playwright-driven manual sanity of all four modes at 375px and desktop is noted in Assumptions if not run. <!-- R1 R6 R7 R8 R9 R10 -->

## Execution Order

- T001 blocks T002 (RootTopBar consumes the slot hook).
- T002 blocks T003 (RootWrapper renders RootTopBar).
- T003 blocks T004 (var handoff decided against the new layout div).
- T005, T006, T007 depend on T001 (registration hook) and are independent of each other ([P]-eligible once T001 lands).
- T008, T009 are independent of the registration work (pure layout) but should land with the page changes to keep the app renderable.
- T010, T011 depend on their respective source changes (T006 / T001).
- T013 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A single `TopBar` mounts once in `RootWrapper` above the `<Outlet>`; no page component renders its own `<TopBar>`.
- [x] A-002 R2: The root `<Suspense fallback={null}>` wraps only the content region; the `--app-height` var is consumed by the root layout container.
- [x] A-003 R3: `RootTopBar` derives `mode` + identity from the route (`/`→cockpit, `/board/$name`→board+boardName, `/$server/$window`→terminal, `/$server`→root, unmatched→cockpit fallback).
- [x] A-004 R4: `top-bar-slot-context.tsx` exists, follows the `FocusedTerminalProvider` shape, and delivers page data/handlers; heavy handlers remain in AppShell/BoardPage.
- [x] A-005 R5: With no page registered, `RootTopBar` renders the route-derived mode with tolerant-empty props and does not crash.
- [x] A-006 R6: `AppShell` renders no `<TopBar>` and registers its props into the slot; `topBarMode` local removed.
- [x] A-007 R7: `ServerListPage` renders no `<TopBar>`; its wrapper is `h-full`; cockpit connection dot reflects `hostMetricsConnected` via the root bar.
- [x] A-008 R8: `BoardPage` renders no `<TopBar>` and registers the full board-extras set into the slot.
- [x] A-009 R9: Shell has no `topbar` grid area; desktop/mobile areas + rows are updated; height is `100%`; mobile drawer overlay uses `gridRow: "1 / 3"`; Cmd+\ still toggles the sidebar on shell routes.
- [x] A-010 R10: `NotFoundPage`, `ServerNotFound`, `ServerWaiting` use `h-full` and render below the persistent bar without overflow.

### Behavioral Correctness

- [x] A-011 R1: Navigating `/` → `/$server` → `/board/$name` keeps a SINGLE persistent TopBar that does NOT remount as a component (verified: `RootWrapper`/`AppLayout`/`RootTopBar`/`TopBar` mount effects stay stable across navigation) and stays continuously present with its route-derived heading updating per route (verified by the e2e `top-bar-persistence`). NOTE: strict DOM-node identity is NOT preserved on the `→ /` (index-route) transition — TanStack Router's per-match Suspense re-commit recreates the host node without remounting the component; this is a router-internal artifact that does not blank the bar. See Assumptions #8.
- [x] A-012 R2: Navigating to a board with the chunk still loading keeps the TopBar painted while only the content body blanks.
- [x] A-013 R3: On lazy board navigation the heading shows `Board: <name>` from the URL before the chunk mounts.

### Edge Cases & Error Handling

- [x] A-014 R5: A first-frame-after-navigation with no registered slot props renders tolerant-empty without error.
- [x] A-015 R10: Unmatched route (`NotFoundPage`) renders under the minimal cockpit-like TopBar fallback mode. <!-- MET (rework cycle 1): `NotFoundPage` now calls `useSignalTopBarNotFound()`, flipping a dedicated boolean channel on `TopBarSlotContext`; `RootTopBar` reads it via `useTopBarNotFound()` and forces `mode="cockpit"` (nulling `boardName`) ahead of the route-param walk, so a fuzzy not-found (`/board/x/y`, param `name=x` retained by the router) no longer leaks `Board: x`. Verified by the new e2e test `top-bar-persistence.spec.ts` "an unmatched route falls back to the minimal cockpit heading" (asserts `getByLabel("Cockpit")` visible + `getByLabel("Board x")` count 0), which passes. The conformant `/a/b/c` → AppShell/ServerNotFound arm is untouched (notFound is false there; create-server-waiting e2e still green). -->


### Code Quality

- [x] A-016 Pattern consistency: The slot context follows the `FocusedTerminalProvider` naming/structure (stable dispatcher, `useMemo` value, throw-outside-provider read hook).
- [x] A-017 No unnecessary duplication: No TopBar props logic is duplicated between root and pages beyond the registration seam; heavy handlers are not reimplemented at root.
- [x] A-018 Type narrowing over assertions: New code prefers `if` guards / discriminated unions over `as` casts (code-quality.md § Principles).
- [x] A-019 Tests cover changed behavior: The slot context, the ServerListPage mount move, and the flicker regression (DOM identity) are covered by unit + e2e tests (code-quality.md — new features MUST include tests; UI changes SHOULD include e2e).
- [x] A-020 Spec companion parity: Every added/modified `*.spec.ts` under `app/frontend/tests/` has its sibling `*.spec.md` created/updated in the same change (constitution § Test Companion Docs).
- [x] A-021 Keyboard-first preserved: Cmd+\ sidebar toggle and all TopBar keyboard/palette affordances keep working (constitution V); no new routes added (constitution IV).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- ~~`app/frontend/src/components/shell/shell.test.tsx:43`~~ — RESOLVED (rework cycle 1): the stale `<header gridArea:"topbar">` render-harness child was removed; the `parentElement` handle repointed to the `content` child.
- ~~`app/frontend/src/router.tsx:121`~~ — RESOLVED (rework cycle 1): the route-tree comment now says the `notFoundComponent` lives on the `app-layout` route (rendered below the persistent TopBar), matching the diff.
- Otherwise `None` — the change deleted its own redundancies in place (the Shell `topbar` grid row, the three per-page `<TopBar>` mounts, AppShell's `topBarMode` local, and Shell's `useVisualViewport()` call were all removed by the apply diff).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope = lift TopBar only; Sidebar/BottomBar/Shell stay per-page | Carried from intake assumption #2 (user explicitly chose "Lift TopBar to root" over full persistent chrome) | S:100 R:80 A:100 D:100 |
| 2 | Confident | Prop delivery = route-derived mode/identity at root + page-registered slot context (FocusedTerminalProvider precedent) with tolerant-empty defaults | Codebase precedent exists; both board/cockpit mounts already use the tolerant-empty shape; alternative (all handlers to root) is a large migration for no user-visible gain; reversible | S:60 R:85 A:80 D:70 |
| 3 | Confident | Root layout = flex column (persistent header + `flex-1` outlet region); Shell drops its `topbar` row and switches height `var(--app-height,100vh)`→`100%` | Shell already renders the topbar full-width above the sidebar so the extraction is geometrically a no-op; straightforward to adjust if a seam shows | S:70 R:75 A:85 D:80 |
| 4 | Confident | `useVisualViewport()` moves to `RootWrapper` ONLY — the call is REMOVED from `Shell` (import deleted); the root `.app-root` div is the sole `--app-height` consumer, so the var is maintained on every route including cockpit/edge routes that mount no Shell | Owning the hook once at root avoids a double-subscription cleanup race (two mounted copies tearing down shared listeners — see the RootWrapper comment at app.tsx:100-109); the root call covers all routes so Shell's copy is redundant. Reversible; low blast radius <!-- clarified: row updated in rework cycle 1 — the original record said "stays in Shell and is ALSO called in RootWrapper", contradicting the shipped code (review should-fix #1) --> | S:55 R:85 A:80 D:65 |
| 5 | Confident | Keep `Suspense fallback={null}`; shrinking its blast radius to the content region is sufficient | Navbar persistence is the requested outcome; fallback design is a separable follow-up | S:55 R:90 A:80 D:75 |
| 6 | Confident | Edge pages (NotFound/ServerNotFound/ServerWaiting) render below the persistent bar with `h-screen`→`h-full`; unmatched routes get a minimal cockpit-like TopBar fallback | Reasonable default keeping chrome consistent on error pages; cheap to flip | S:40 R:75 A:65 D:50 |
| 7 | Confident | `ServerListPage — Cockpit TopBar` unit tests are rewritten: the no-in-page-`<h1>` assertion stays on the page; the TopBar-presence assertions (brand crumb, dot, `Cockpit` heading) are removed from this component (covered by `top-bar.test.tsx` cockpit-mode + the e2e), since they are no longer this component's responsibility | The mount moved; asserting TopBar internals on a component that no longer renders it would be a false test. Test Integrity: tests conform to the new structure | S:65 R:80 A:75 D:70 |
| 8 | Confident | The flicker-regression e2e asserts the ACHIEVABLE, user-facing invariant — a single non-remounting TopBar (mount-effect-stable) that stays continuously present with a per-route heading — NOT strict DOM-node identity | Investigation established that no component in the persistent chain remounts, but TanStack Router 1.168's per-match Suspense re-commit recreates the header host node on the `→ /` (index-route) transition. This is a router-internal reconciliation artifact that does not remount the component and does not blank the bar (the heading renders synchronously from route state), so it is not a user-visible flicker. Achieving strict node identity would require patching router internals — out of scope, and the user goal (no flicker) is met and tested regardless | S:60 R:70 A:70 D:60 |
| 9 | Confident | Not-found → cockpit-fallback signals via a DEDICATED boolean channel on `TopBarSlotContext` (`useSignalTopBarNotFound` sets true on mount / false on unmount; `RootTopBar` reads `useTopBarNotFound()` and forces `mode="cockpit"` ahead of the param walk) — NOT via the page-data `slot` and NOT via reading router internals (`globalNotFound`) in `RootTopBar` | The reviewer's prescribed resolution (a). A bare boolean keeps `NotFoundPage` decoupled from the full slot prop shape it owns none of; a separate channel avoids entangling not-found with page-data registration. Rejected: (a) reading the router's `globalNotFound`/`status` synchronously in `RootTopBar` — avoids the one-frame flash but couples to a `?`-optional router-internal field + a hardcoded `"app-layout"` route-id string, and must precisely replicate the fuzzy-match-vs-notFoundComponent resolution to avoid catching `/a/b/c`; (b) folding `notFound` into the page-data slot — mixes an error-page signal into the page-registration channel. NOTE: because `RootTopBar` sits ABOVE the `<Outlet>`, ANY signal from the (in-Outlet) not-found page is inherently one render behind — a ~1-frame "Board: x" flash before the effect lands is unavoidable without router-internal reading; it is not user-perceptible and A-015 (settled-state) is unaffected | S:70 R:85 A:80 D:70 |

9 assumptions (1 certain, 8 confident, 0 tentative).
