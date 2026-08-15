# Plan: Present Auto-Expand Web Tile

**Change**: 260815-wkcw-present-auto-expand-web-tile
**Intake**: `intake.md`

## Requirements

### Frontend: Auto-expand reaction

#### R1: Transition-observed trigger
A viewer mounted on window W's terminal route SHALL auto-open the `web` tile when it observes W's `rkUrl` **transition** on the state stream — from empty/absent to a non-empty value, or from one non-empty value to a different non-empty value. Cold route entry MUST NOT auto-open (the resolution ladder alone decides what a fresh arrival sees), and a transition to empty/cleared MUST NOT trigger any reaction (availability degradation already drops an unavailable `web` tile).

- **GIVEN** a viewer on `/$server/$window` with the window's `rkUrl` empty
- **WHEN** an agent runs `rk present ./mock.html` in that window (setting `@rk_url`, observed via the SSE snapshot)
- **THEN** the web tile renders beside/over the existing layout per R2
- **AND** the URL carries no `?layout=` change and no `rk-layout:` localStorage key is written

- **GIVEN** a window whose `rkUrl` is already set
- **WHEN** the viewer cold-loads the route (reload, window switch, deep link)
- **THEN** no auto-open occurs — the layout resolves via the normal ladder

- **GIVEN** the auto-open trigger fires for a window whose per-window observation state was initialized on a previous visit this page-load
- **WHEN** `rkUrl` changes to a NEW non-empty value while the viewer is elsewhere and the viewer then returns
- **THEN** no auto-open occurs on return (the reaction requires the transition to be observed while mounted; the observation state updates silently on remount)

#### R2: Transient render-time composition (never a mutation)
The auto-open SHALL be a render-time transient override: when active and the resolved layout lacks `web`, the render path substitutes `addSurface(layout, "web")` (the existing growth conventions — 1→2 `split-h`, 2→3 `main-left`). It MUST NOT call `applyLayout`, write `rk-layout:` localStorage, or mirror `?layout=` into the URL — the URL-mirror effect stays keyed on the ladder-resolved layout, not the transient one. At arity 3 without `web`, `addSurface` returns `null` and the reaction is a no-op. When the `web` tile is already open, the reaction takes no layout action and does not move focus (`IframeWindow`'s existing SSE sync already navigates the iframe on `rkUrl` change).

- **GIVEN** a viewer with resolved layout `single:tty` and an active auto-open
- **WHEN** the center renders
- **THEN** it renders `split-h:tty,web` while `resolveLayout`'s output, localStorage, and the URL remain `single:tty`

- **GIVEN** a resolved 3-tile layout without `web` (e.g. `main-left:tty,code,chat`)
- **WHEN** the trigger fires
- **THEN** nothing changes visually (no fourth tile, no substitution)

- **GIVEN** an active transient auto-open
- **WHEN** the user performs any layout mutation (tile verbs, rail toggle, ▦ chip, palette `Layout:`/`View:` actions) — all of which act on the RENDERED layout
- **THEN** the mutation persists from the rendered state per the ordinary `applyLayout` path (spec L3: touching makes it yours) and the transient override deactivates

#### R3: Dismissal latch
Closing the auto-opened `web` tile (tile ✕, rail toggle, `Layout: Close Web` — any user mutation whose resulting layout lacks `web` while the auto-open is active) SHALL record the window's current `rkUrl` value in an in-memory latch keyed per `(server, windowId)`, and a later observed transition TO that exact latched value MUST NOT re-trigger the auto-open. The latch is in-memory only (resets on reload; no sessionStorage/localStorage). A transition to a *different* value re-triggers normally — timestamped present URLs (`target.URL(..., presentNowFn)`) intentionally pass the latch on every re-present.

- **GIVEN** an auto-opened web tile for value X
- **WHEN** the user closes it, the agent unsets and re-sets `@rk_url` to the same X
- **THEN** no re-open occurs (the empty→X transition matches the latch)

- **GIVEN** the same dismissal of value X
- **WHEN** `rkUrl` transitions to a different value Y (a re-present)
- **THEN** the auto-open re-triggers

#### R4: Mobile — shared render path, no visible-tile swap
The transient override SHALL apply through the same render path on mobile (`isMobileViewport()`), where only slot A renders: the auto-added `web` surface becomes reachable as a tab in the mobile surface sheet (the layout turning multi-tile makes the bottom-bar ▦ chip appear), but the reaction MUST NOT set or change `mobileActiveTile` — the visible tile is never auto-swapped on a phone.

- **GIVEN** a mobile viewer on a `single:tty` window
- **WHEN** the trigger fires
- **THEN** the visible tile stays tty and the web surface is reachable via the sheet's tabs

#### R5: Spec and doc-comment amendments
`docs/specs/surface-layout.md` SHALL gain a carve-out (in the R7/L3 commentary area) stating that a fresh `rk present` is an implicit request for attention and the actively-viewing viewer's client MAY transiently auto-open the `web` tile — with no persistence write, keeping R7's substrate-vs-view split and L3 intact. `app/backend/cmd/rk/present.go` SHALL have its doc comment (lines 21–23) and `Long` help text ("The tile is never opened for the viewer…", line 54) amended to state the carve-out. These are comment/help-text edits only — zero Go behavior change; if the help-dump conformance artifacts cover the `Long` text, they are regenerated per the toolkit standard.

- **GIVEN** the amended files
- **WHEN** `go test ./...` runs in `app/backend`
- **THEN** all tests (including any help-dump conformance test) pass with no behavior change

### Non-Goals

- The `--window` arm — already auto-surfaces via layout-ladder rung 3 (`@rk_type=iframe` hint).
- Any backend behavior change: no API, SSE-hub, wake-nudge, or tmux changes (the HTTP wake nudge is explicitly rejected for v1).
- Focus stealing: the reaction never changes the focused tile, on desktop or mobile.
- Persisted dismissal: the latch does not survive reload (transition-observation makes reload safe anyway).

### Design Decisions

#### Transient override composes via addSurface at render time
**Decision**: `app.tsx` computes `renderLayout = autoOpenActive && !layout.order.includes("web") ? (addSurface(layout, "web") ?? layout) : layout` and feeds `renderLayout` to `SurfaceLayout` and the tile verbs; `resolveLayout`'s output keeps feeding the URL-mirror effect, localStorage, and the window-switch transition classification.
**Why**: reuses the exact growth shapes every other web-open path produces (rail toggle, ⇧⌘., palette), so the auto-open looks identical to a manual open; verbs acting on the rendered layout make "touching it makes it yours" (L3) fall out for free — a mutation persists from what the user sees.
**Rejected**: slot-A swap (steals the terminal from an actively-typing user); a zoom-like overlay (new interaction surface, not reachable by the existing verbs; closing semantics would need bespoke chrome).
*Introduced by*: 260815-wkcw-present-auto-expand-web-tile

#### Value-exact latch; timestamped re-presents intentionally pass it
**Decision**: the dismissal latch matches the exact `rkUrl` string. A re-present of the same file carries a fresh timestamp and re-opens.
**Why**: a re-present is by definition a fresh request for attention; suppressing it would make the verb unreliable. The latch's job is narrower — the same value re-observed (unset/re-set, state replays) must not fight a dismissal.
**Rejected**: normalizing away the `ts` param or a time-window cooldown — heuristic, and it would suppress genuine re-presents.
*Introduced by*: 260815-wkcw-present-auto-expand-web-tile

#### Observation state lives in a per-window in-memory map, not reset-on-switch state
**Decision**: the helper's state (`lastUrl`, `active`, `dismissedUrl`) is held in an `app.tsx` ref `Map` keyed `${server}:${windowId}` and updated by a pure reducer from `lib/present-auto-expand.ts`; it is not cleared on window switch.
**Why**: surviving the map across switches means a value change that happened while the viewer was away updates `lastUrl` silently on remount (no spurious trigger), and a brief `currentWindow === undefined` frame (snapshot races) cannot fake a transition. Matches the transition-observed rule without extra bookkeeping.
**Rejected**: `useState` reset on `[server, windowParam]` (the `mobileSlotA` pattern) — a reset makes the first post-switch observation indistinguishable from cold entry only if handled carefully, and loses the latch on every switch.
*Introduced by*: 260815-wkcw-present-auto-expand-web-tile

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create pure helper `app/frontend/src/lib/present-auto-expand.ts`: `AutoExpandState { lastUrl: string; active: boolean; dismissedUrl: string | null }`, `observeRkUrl(state | undefined, rkUrl: string): AutoExpandState` (initialization = no trigger; transition detection; trim + empty handling; latch comparison), `dismissAutoExpand(state): AutoExpandState` (records `lastUrl` as `dismissedUrl`, clears `active`), `deactivateAutoExpand(state)` (user took ownership without closing web), and `withAutoWeb(layout: Layout, active: boolean): Layout` (addSurface substitution, null→identity, skip when `web` already in order). DOM-free, no imports beyond `surface-layout.ts` types/helpers. <!-- R1 R2 R3 -->
- [x] T002 [P] Colocated unit tests `app/frontend/src/lib/present-auto-expand.test.ts`: initialization (cold entry no-trigger), empty→set triggers, value→value triggers, set→empty no-trigger + state update, same-value SSE tick no-trigger, latch suppression (empty→latched-value), latch pass-through (different value), `withAutoWeb` at arity 1/2/3 and with web already open. <!-- R1 R2 R3 -->
- [x] T003 <!-- rework: should-fix — key the mirrored autoWebOpen state to the window (store {key, active} or clear synchronously on [server, windowParam] change) so a window switch cannot flash a phantom web tile on the destination route (app.tsx:773-806); also fix the comment at app.tsx:771 (unknown-window value is null, not undefined) --> Wire the reaction in `app/frontend/src/app.tsx` beside the layout-state block: a ref `Map<string, AutoExpandState>` keyed `${server}:${windowId}`; an effect on `[server, windowParam, effectiveWindow?.rkUrl]` that runs `observeRkUrl` (skipped while `effectiveWindow` is undefined) and mirrors `active` into a state boolean; `renderLayout = withAutoWeb(layout, autoWebOpen)` feeding `<SurfaceLayout layout={…}>` and every verb callback that currently reads `layout` for mutations (promote/swap/close/onSwitchToTty/togglePanel path stays on its own logic — verbs act on the RENDERED layout); in `applyLayout`, when the auto-open is active, run `dismissAutoExpand` if the applied layout lacks `web`, else `deactivateAutoExpand`. The URL-mirror effect, `readStoredLayout`/`writeStoredLayout`, `resolvedView`, and `ungatedIds` classification stay on the ladder-resolved `layout`. `mobileActiveTile` derivation switches to `renderLayout.order` for tab reachability but its default stays slot A (no auto-swap). <!-- R1 R2 R3 R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 <!-- rework: must-fix — the readiness gate targets the retired sidebar-footer dot (`nav [aria-label='Connected']`, spec.ts:47); since the shell refactor (260815-19me) the desktop Connected dot lives in the status bar — gate on page.getByTestId("status-bar").locator("[aria-label='Connected']") per _ready.ts / right-panel.spec.ts:63-67, update the .spec.md Shared-setup claim; also fix stale "rail" prose at spec.ts:54-56/108/138 + spec.md:35-37 (button is the top-bar SurfaceToggleGroup's "Web tile" toggle) --> Playwright e2e `app/frontend/tests/e2e/present-auto-expand.spec.ts` + sibling `present-auto-expand.spec.md` on the real-tmux port-3020 rig (`web-view-lens.spec.ts` `_tmux.ts` pattern; `tmux set-option -w @rk_url` is the present-default-arm write path): (a) rkUrl set while viewing → web tile appears, URL has no `?layout=`, no `rk-layout:` localStorage key; (b) close the auto-opened tile via its ✕, unset + re-set the same value → no re-open; (c) set a different value → re-opens; (d) cold arrival with rkUrl already set → no auto-open (`single:tty` renders). Keep every flow at ≤2 tiles (connection-pool budget); run via `just test-e2e` / `just pw` only. <!-- R1 R2 R3 -->

### Phase 4: Polish

- [x] T005 [P] Amend `docs/specs/surface-layout.md`: add the transient auto-open carve-out to the R7/L3 commentary ("a fresh present is an implicit request for attention"; per-viewer, render-time, no persistence — L3 untouched because nothing is written). <!-- R5 -->
- [x] T006 <!-- rework: must-fix — the Long help text (present.go:57) still reads "The tile is never opened for the viewer — availability appears on the rail."; amend it to state the transient auto-open carve-out (the doc-comment half is already done) --> [P] Amend `app/backend/cmd/rk/present.go`: doc comment lines 21–23 and the `Long` help text line 54 to state the carve-out (viewers actively on the window's route may see a transient auto-open; layout persistence stays per-viewer). Zero behavior change; run `cd app/backend && go test ./...` and regenerate any help-dump artifact if the conformance test requires it (check `shll standards help-dump` if available). <!-- R5 -->

## Execution Order

- T001 blocks T002 and T003; T004 needs T003.
- T005/T006 are independent `[P]` docs tasks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: An `rkUrl` empty→set transition observed while mounted renders the web tile with no `?layout=` change and no `rk-layout:` write (e2e case a). — verified (re-review cycle 3): the readiness gate now targets the status bar (`page.getByTestId("status-bar").locator("[aria-label='Connected']")`, present-auto-expand.spec.ts:50 — the `_ready.ts` pattern), and `just test-e2e "present-auto-expand"` runs 3/3 green; e2e case a asserts the iframe appears beside the terminal with a clean URL and zero `rk-layout:` localStorage keys.
- [x] A-002 R2: The rendered auto-open layout is `addSurface`-shaped (`split-h` from `single`, `main-left` from 2-tile); the ladder-resolved layout, localStorage, and URL are unchanged. — verified (re-review cycle 3): `withAutoWeb` unit tests pass (145/145 vitest files, 2843 tests), app.tsx keeps `resolveLayout`'s output feeding the URL-mirror/localStorage effects while only the render/verb seam reads `renderLayout`, and e2e case a confirms the rendered open with no persistence.
- [x] A-003 R3: After dismissal, re-observing the same value does not re-open; a different value re-opens (e2e cases b, c). — verified (re-review cycle 3): e2e case b (✕-close → unset → re-set same value stays closed; a different value re-opens) passes, backed by the latch unit tests.
- [x] A-004 R4: On mobile the visible tile is never auto-swapped; the web surface is reachable via the sheet tabs while the override is active. — verified by code inspection (no mobile e2e in T004's scope): `addSurface` appends `web` so slot A (`renderLayout.order[0]`) is unchanged; `mobileActiveTile` and the `surfaceSheet` tab list both read `renderLayout.order`, so the transient web surface appears as a tab while slot A keeps rendering.
- [x] A-005 R5: surface-layout.md and present.go no longer assert an unconditional "never opens the viewer's tile"; both state the transient carve-out; `go test ./...` passes. — verified (re-review cycle 2): surface-layout.md gained the R7/L3 carve-out paragraph, present.go's doc comment AND the `Long` help text (present.go:57-59) now state the transient auto-open carve-out ("A viewer currently on this window's route may see the web tile auto-open transiently (render-time only, nothing persisted)"), and `cd app/backend && go test ./...` passes with no behavior change.

### Behavioral Correctness

- [x] A-006 R1: Cold route entry (reload / window switch / deep link) with `rkUrl` already set never auto-opens (e2e case d). — verified (re-review cycle 3): e2e case d (stamp `@rk_url` before navigating → `single:tty` renders, iframe absent, toggle unpressed, clean URL) passes; `observeRkUrl(undefined, …)` initialization-never-triggers holds in unit tests.
- [x] A-007 R1: Clearing `@rk_url` triggers no reaction beyond existing availability degradation. — verified: unit test "a set→empty transition does not trigger and deactivates"; e2e case b's unset leg re-renders without re-open.
- [x] A-008 R2: At resolved arity 3 without `web`, the trigger is a visual no-op. — verified: unit test "is identity at arity 3 without web" (`addSurface` null → identity).
- [x] A-009 R2: A user layout mutation during an active auto-open persists from the rendered layout and deactivates the override. — verified: all verb paths (`togglePanel`, palette `buildLayoutActions`, `onPromote`/`onSwap`/`onClose`/`onSwitchToTty`) act on `renderLayout`; `applyLayout` runs `dismissAutoExpand`/`deactivateAutoExpand` while the override is active (e2e case b exercises the dismiss path).

### Scenario Coverage

- [x] A-010 R1: Unit tests cover initialization, all transition shapes, same-value ticks, and undefined-window frames. — verified: `present-auto-expand.test.ts` (14 tests, all passing) covers `undefined`-state initialization, empty→set, value→value, set→empty, same-value ticks, and remount catch-up.
- [x] A-011 R3: Unit tests cover latch record, suppression, and pass-through. — verified: latch tests cover record (`dismissAutoExpand`), suppression (empty→latched value), and pass-through (different value).

### Edge Cases & Error Handling

- [x] A-012 R2: `withAutoWeb` is identity when `web` is already in the order and when `addSurface` returns null. — verified: unit tests "is identity when web is already open" and "is identity at arity 3 without web".
- [x] A-013 R1: An SSE tick re-delivering an identical `rkUrl` does not re-trigger (transition, not presence, semantics). — verified: unit test "a same-value SSE tick is a no-op (returns the state object unchanged)".

### Code Quality

- [x] A-014 Pattern consistency: the helper is pure/DOM-free with colocated tests (the `window-view.ts` / `surface-layout.ts` module contract); app.tsx wiring follows the existing transient-state comment style.
- [x] A-015 No unnecessary duplication: growth shapes come from `addSurface`, availability from `hasWebUrl` — no re-implementation. — verified: `withAutoWeb` delegates to `addSurface`; trim discipline mirrors `hasWebUrl` without duplicating it.
- [x] A-016 Type narrowing over assertions: no `as` casts on the new paths. — verified: no casts in the new module/wiring; `npx tsc --noEmit` clean.
- [x] A-017 No client polling: the reaction rides the existing SSE-fed `WindowInfo` — no `setInterval`/fetch.
- [x] A-018 Test companion doc: `present-auto-expand.spec.md` documents what each test proves + steps, shipped in the same commit. — verified: `.spec.md` covers all three tests with what-it-proves + numbered steps, added alongside the spec.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mechanism (intake deferred #14): render-time transient override via `addSurface(layout, "web")`, verbs act on the rendered layout, arity-3-without-web = no-op | The intake's front-runner, confirmed against app.tsx's single-mutation-path structure — the substitution point (`layout` → `renderLayout` at the render/verb seam) exists cleanly; slot-A swap and overlay both add new interaction surface | S:70 R:80 A:75 D:70 |
| 2 | Confident | Mobile (intake deferred #15): shared render path — web becomes a sheet tab, `mobileActiveTile` never auto-swapped | Reuses the exact machinery with zero mobile-specific code; avoids the flagged UX risk (auto-swapping a phone's single visible tile); desktop-only gating would need extra code to LIMIT behavior | S:55 R:80 A:70 D:65 |
| 3 | Confident | Already-open web tile: no reaction at all (no focus move) — intake #11's "at most mark focused" resolved to "do nothing" | Auto-moving focus flips the `ttyOnly` chord gate under a typing user's fingers; the iframe already navigates via its SSE sync, so attention is delivered | S:60 R:85 A:75 D:70 |
| 4 | Confident | Ownership semantics: any user `applyLayout` during an active auto-open deactivates it; only a mutation whose result lacks `web` records the latch | Mirrors L3's deep-link precedent ("touching anything makes it yours"); keeping the override alive across user mutations would fight the persisted layout | S:60 R:80 A:75 D:70 |
| 5 | Tentative | The `mobileActiveTile` fallback derivation reads `renderLayout.order` (so the sheet lists the transient web tab) rather than staying on the resolved order | Smallest change that makes R4's reachability true; if it complicates the sheet's pressed-state logic, apply may keep the sheet on the resolved layout and drop transient reachability on mobile (R4's MUST is only "no auto-swap") <!-- assumed: mobile sheet lists the transient web tab via renderLayout.order --> | S:45 R:75 A:55 D:45 |

5 assumptions (0 certain, 4 confident, 1 tentative).
