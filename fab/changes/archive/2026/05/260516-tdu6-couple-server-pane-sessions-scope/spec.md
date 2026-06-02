# Spec: Couple Server Pane expand state with Sessions Pane server scope

**Change**: 260516-tdu6-couple-server-pane-sessions-scope
**Created**: 2026-05-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Removing the Server Pane entirely — considered and rejected (Why §3 of intake).
- Server Pane content changes (color stripe, session count, tile grid styling, mobile single-row carousel) — tracked separately.
- Routing, `SessionProvider` shape, or backend changes — this is purely a sidebar UI coupling.
- Cross-tab synchronization of the Server Pane open state — accepted as a free byproduct if Path A's `storage` event listener delivers it, but not a requirement.
- Modifying the per-server collapse keys (`runkit-panel-sessions-${server}`) or the legacy migration logic.

## Sidebar: Server Pane open state as Sessions Pane scope toggle

### Requirement: Coupling rule
The Sessions Pane SHALL render its per-server `ServerGroup` list conditional on the Server Pane's open state. When the Server Pane is collapsed, the Sessions Pane SHALL render one `ServerGroup` per entry in `servers`. When the Server Pane is open, the Sessions Pane SHALL render exactly one `ServerGroup` — the group for `currentServer` — and SHALL omit all other server groups from the rendered output.

The Server Pane's open state is read from the localStorage key `runkit-panel-server` (the same key `CollapsiblePanel` writes via its `storageKey` prop in `app/frontend/src/components/sidebar/server-panel.tsx:106`). No new state is introduced. The rendered group list change is the only behavioral effect.

#### Scenario: Server Pane collapsed (default first-run)
- **GIVEN** `localStorage["runkit-panel-server"]` is `"false"` or unset (default first-run via `defaultOpen={false}`)
- **AND** `servers` resolves to `[{name:"primary"}, {name:"alpha"}, {name:"beta"}]`
- **WHEN** the Sidebar renders
- **THEN** the Sessions Pane renders three `ServerGroup` elements, one per server, in the order returned by `servers`
- **AND** behavior matches the pre-change baseline exactly (no user-visible difference)

#### Scenario: Server Pane open, current server resolved
- **GIVEN** `localStorage["runkit-panel-server"]` is `"true"`
- **AND** `currentServer === "primary"`
- **AND** `servers` resolves to `[{name:"primary"}, {name:"alpha"}, {name:"beta"}]`
- **WHEN** the Sidebar renders
- **THEN** the Sessions Pane renders exactly one `ServerGroup` — for `"primary"`
- **AND** the `ServerGroup` elements for `"alpha"` and `"beta"` are absent from the rendered tree (not just hidden via CSS)

### Requirement: Snap transition (no animation)
The transition between the all-servers tree and the current-server-only tree SHALL be instantaneous — no fade, slide, height, or opacity animation MAY be added to the appearing or disappearing `ServerGroup` elements. The existing per-group `CollapsiblePanel` body transitions inside the rendered `ServerGroup` are unaffected; this requirement applies only to the group-list change driven by the Server Pane's open state.

#### Scenario: Snap when opening the Server Pane
- **GIVEN** the Server Pane is collapsed and the Sessions Pane shows all servers
- **WHEN** the user clicks the Server Pane header to open it
- **THEN** the Sessions Pane's `ServerGroup` list updates to the single-server view in the next React commit
- **AND** the disappearing `ServerGroup` elements are removed from the DOM in that commit, not transitioned out

#### Scenario: Snap when closing the Server Pane
- **GIVEN** the Server Pane is open and the Sessions Pane shows only the current server's group
- **WHEN** the user clicks the Server Pane header to close it
- **THEN** the Sessions Pane's `ServerGroup` list updates to the all-servers view in the next React commit
- **AND** the appearing `ServerGroup` elements are mounted directly without entrance animation

### Requirement: Empty-state hint when no current server
When the Server Pane is open AND `currentServer === null` (e.g., the route is `/` before resolution, or the previously-current server was deleted), the Sessions Pane SHALL render no `ServerGroup` elements AND SHALL render an empty-state hint in the area where groups would otherwise appear. The hint text MUST be: `Select a server above to see its sessions.` <!-- clarified: empty-state copy locked. Auto-mode reviewed existing sidebar empty-state convention ("No sessions", "No servers", "No window selected" — all terse, imperative, no full sentences with article+verb) and confirms this wording matches the established tone. Decision §4 records full rationale. Upgraded from Tentative-style marker; matches Assumption #9 (Certain). -->

The hint styling SHALL follow the existing "No sessions" empty-state convention in the Sidebar (`text-text-secondary text-xs py-4 text-center`, the same classes used at `app/frontend/src/components/sidebar/index.tsx:746`).

#### Scenario: Open Server Pane on a board route
- **GIVEN** the user is on route `/` (`currentServer === null`)
- **AND** `localStorage["runkit-panel-server"]` is `"true"`
- **WHEN** the Sidebar renders
- **THEN** no `ServerGroup` elements appear in the Sessions Pane
- **AND** the empty-state hint renders with the text `Select a server above to see its sessions.`
- **AND** the hint has the `text-text-secondary` color and centered alignment

#### Scenario: Current server deleted while Server Pane open
- **GIVEN** the Server Pane is open and `currentServer === "alpha"`
- **WHEN** server `"alpha"` is removed from the `servers` list (kill server) and `currentServer` resolves to `null`
- **THEN** the previously-rendered single `ServerGroup` is unmounted
- **AND** the empty-state hint replaces it
- **AND** no `ServerGroup` elements for other servers appear

### Requirement: Per-server collapse state preserved (dormant)
The per-server keys `runkit-panel-sessions-${server}` SHALL NOT be cleared, overwritten, or otherwise mutated by the coupling logic. When the Sessions Pane filters out a server's group, that server's persisted collapse state remains dormant in localStorage. When the Server Pane later closes and the multi-server tree is restored, each previously-filtered-out group SHALL re-render with its persisted collapse value (the same value `toggleServerSection` and `readServerOpen` in `app/frontend/src/components/sidebar/index.tsx:112,139` already read).

#### Scenario: Non-current server's collapse state survives filtering
- **GIVEN** `currentServer === "primary"`, the Server Pane is collapsed
- **AND** the user has expanded server `"alpha"`'s `ServerGroup` (so `localStorage["runkit-panel-sessions-alpha"] === "true"`)
- **WHEN** the user opens the Server Pane (so `"alpha"`'s group is filtered out)
- **AND** the user later closes the Server Pane (restoring the multi-server tree)
- **THEN** `localStorage["runkit-panel-sessions-alpha"]` is still `"true"`
- **AND** `"alpha"`'s `ServerGroup` re-renders in the expanded state

### Requirement: Force-open the current server's group while filtered
When the Server Pane is open AND `currentServer !== null`, the rendered current-server `ServerGroup` SHALL be displayed in the open state regardless of the value of `localStorage["runkit-panel-sessions-${currentServer}"]`. This override is render-time only: the persisted value SHALL NOT be written, read-modified-written, or otherwise mutated by the coupling logic. When the Server Pane closes and the multi-server tree is restored, the current server's group SHALL restore to whatever its persisted value already was.

#### Scenario: Persisted collapsed, force-open while filtered
- **GIVEN** `currentServer === "primary"` and `localStorage["runkit-panel-sessions-primary"] === "false"`
- **AND** the Sessions Pane is showing the multi-server tree with primary's group collapsed
- **WHEN** the user opens the Server Pane
- **THEN** the Sessions Pane renders only the `"primary"` group AND that group's body is visible (chevron pointing down)
- **AND** `localStorage["runkit-panel-sessions-primary"]` remains `"false"` (not overwritten by the force-open)

#### Scenario: Restore persisted state on Server Pane close
- **GIVEN** the prior scenario's end state — Server Pane open, `"primary"` group force-opened, `localStorage["runkit-panel-sessions-primary"] === "false"`
- **WHEN** the user closes the Server Pane
- **THEN** the multi-server tree renders
- **AND** the `"primary"` group is collapsed (per its persisted `"false"`)

## Sidebar: Cross-component reactivity for `runkit-panel-server`

### Requirement: Sessions Pane re-renders when Server Pane toggles
The Sessions Pane SHALL re-render in the same tab when the Server Pane's open state changes via user interaction. Reading `localStorage["runkit-panel-server"]` directly on every Sidebar render is insufficient because `localStorage` writes do not by themselves trigger React renders, and the native `storage` event fires only across tabs.

The implementation SHALL use **Path A** — a shared hook `useLocalStorageBoolean(storageKey, defaultValue)` that both `CollapsiblePanel` and the Sessions Pane call, with same-tab synchronization via an in-process pub/sub keyed on the storage key. Same-tab listeners SHALL be notified when any subscriber's setter is invoked. The hook MAY also subscribe to the native `storage` event for cross-tab synchronization at zero cost; cross-tab sync is not a requirement.

Path B (lifting the open state into a new `SidebarLayoutContext` with controlled `CollapsiblePanel` props) is rejected — see Design Decisions §1.

Grep performed for an existing equivalent (`grep -rn "useLocalStorage" app/frontend/src/`, `ls app/frontend/src/hooks/`, `grep "localStorage" app/frontend/src/lib/`): **no existing helper found.** Therefore the hook MUST be created.

The new hook SHALL live at `app/frontend/src/hooks/use-local-storage-boolean.ts`. <!-- clarified: location confirmed. Auto-mode verified `app/frontend/src/hooks/` contains 12+ existing `use-*` files (use-active-board, use-boards, use-browser-title, use-dialog-state, use-file-upload, use-is-mobile, use-modifier-state, use-optimistic-action, use-pane-widths, use-pin-actions, use-sessions, use-visual-viewport, use-window-pins) while `src/lib/` holds non-React utilities. The deviation from intake's `lib/` path follows established project convention. Decision §3 records full rationale; matches Assumption #13 (Certain). -->

#### Scenario: Open the Server Pane while the Sidebar is mounted
- **GIVEN** the Server Pane is collapsed and the Sessions Pane shows all servers
- **AND** the Sidebar component is currently mounted in the same tab
- **WHEN** the user clicks the Server Pane header to open it
- **THEN** the Sessions Pane re-renders within the same React commit cycle
- **AND** the rendered output switches to the single-server view (per "Coupling rule")

#### Scenario: Hook write notifies same-tab subscribers
- **GIVEN** two components subscribe to `useLocalStorageBoolean("runkit-panel-server", false)`
- **WHEN** one component's setter writes `true`
- **THEN** localStorage is updated AND both subscribers' return values become `true` AND both components re-render

### Requirement: `CollapsiblePanel` API surface stable for other consumers
The introduction of `useLocalStorageBoolean` MUST NOT introduce required new props on `CollapsiblePanel`. Existing consumers (`WindowPanel`, `HostPanel`, `ServerPanel`) SHALL continue to render with their current prop sets. The `useLocalStorageBoolean` hook MAY be adopted inside `CollapsiblePanel` as a refactor of its `readPersistedState` + `setIsOpen` internal logic — if so, the externally observed behavior MUST be preserved (initial value reads from localStorage with fallback to `defaultOpen`, toggles write back, etc.).

#### Scenario: Existing CollapsiblePanel consumers unchanged
- **GIVEN** `WindowPanel`, `HostPanel`, `ServerPanel`, `ServerSelector` mount with their current props
- **WHEN** the application runs after this change
- **THEN** each panel's collapse/expand behavior matches the pre-change baseline
- **AND** the panel's open state still persists to its declared `storageKey`

## Sidebar: Read-path encapsulation

### Requirement: Sidebar reads the Server Pane's open state via the shared hook
`Sidebar` in `app/frontend/src/components/sidebar/index.tsx` SHALL call `useLocalStorageBoolean("runkit-panel-server", false)` to obtain the current Server Pane open state. The Sidebar SHALL pass `false` as the default to match `ServerPanel`'s `defaultOpen={false}` (`app/frontend/src/components/sidebar/server-panel.tsx:107`). The Sessions-Pane rendering region near `index.tsx:744-820` SHALL gate the `servers.map((srvInfo) => <ServerGroup ... />)` expression on this value:

- When `serverPaneOpen === false`: iterate the full `servers` array (current behavior).
- When `serverPaneOpen === true` AND `currentServer !== null`: render only the entry whose `name === currentServer`, passing `isOpen={true}` (force-open) AND retaining the existing `onToggleOpen={() => toggleServerSection(srvInfo.name)}` so user clicks on the chevron continue to write through to the persisted key — even though the rendered open state is forced.
- When `serverPaneOpen === true` AND `currentServer === null`: render the empty-state hint instead of the group list.

#### Scenario: Force-open propagates to `ServerGroup`
- **GIVEN** `serverPaneOpen === true` and `currentServer === "primary"`
- **WHEN** the Sidebar renders the current server's `ServerGroup`
- **THEN** the `isOpen` prop passed to `ServerGroup` is `true` regardless of `readServerOpen("primary")`'s return value
- **AND** the `onToggleOpen` prop still calls `toggleServerSection("primary")` if invoked

#### Scenario: User chevron-click while force-opened
- **GIVEN** the force-open scenario above is active
- **WHEN** the user clicks the current group's chevron (invoking `onToggleOpen`)
- **THEN** `localStorage["runkit-panel-sessions-primary"]` flips its persisted boolean
- **AND** the rendered group remains visually open (force-open dominates while the Server Pane is open)
- **AND** when the Server Pane later closes, the new persisted value takes effect

## Testing

### Requirement: Vitest unit coverage for the coupling logic
The change SHALL include unit tests in `app/frontend/src/components/sidebar/index.test.tsx` (extending the file if it exists, creating it if it does not) <!-- clarified: test colocation confirmed. Auto-mode verified `app/frontend/src/components/sidebar/` contains sibling `.test.tsx` files (server-panel.test.tsx, collapsible-panel.test.tsx, status-panel.test.tsx, window-row.test.tsx). Pattern matches code-quality.md §Test Strategy ("Tests use `.test.ts` or `.test.tsx` extension, colocated with source files"). Aligned with Assumption #10 (Certain). --> covering at minimum:

1. Server Pane collapsed → all `ServerGroup`s rendered.
2. Server Pane open + `currentServer === "primary"` → only primary's `ServerGroup` rendered, force-opened, others not in the DOM.
3. Server Pane open + `currentServer === null` → no `ServerGroup`s, empty-state hint visible with correct text.
4. Persisted `runkit-panel-sessions-${server}` keys are not overwritten by the force-open path (assert pre- and post-toggle values).
5. Toggling `runkit-panel-server` re-renders the Sessions Pane within the same tab (cross-component reactivity via the shared hook).

Tests SHALL use the existing `StandaloneSessionContextProvider` (`session-context.tsx`) test helper to construct a multi-server context without opening a real `EventSource` — matching the pattern in `session-context.test.tsx` and `server-panel.test.tsx`.

#### Scenario: Vitest run covers the coupling matrix
- **GIVEN** `index.test.tsx` defines the five test cases above
- **WHEN** `just test-frontend` runs
- **THEN** all five cases pass
- **AND** no test mutates real `localStorage` without resetting it in `afterEach`

### Requirement: Playwright e2e coverage for the user flow
The change SHOULD include one new Playwright e2e test exercising the headline flow: open Server Pane → tree narrows → click a different server tile → tree shows the new server's content. The test SHALL live under `app/frontend/tests/e2e/` per project convention (e.g., `sidebar-server-coupling.spec.ts`) AND SHALL ship with a sibling `.spec.md` companion documenting the proof per the constitution's **Test Companion Docs** rule.

The e2e SHALL be runnable via `just pw test sidebar-server-coupling` (port 3020, isolated tmux server per `fab/project/context.md` §Testing) — never invoked through `npx playwright test` directly.

#### Scenario: Playwright flow validates the user-visible behavior
- **GIVEN** a running dev server on port 3020 with at least two tmux sessions on different servers
- **WHEN** the e2e test opens the Server Pane, asserts the tree narrows to the current server, clicks a non-current tile, then asserts the tree shows that server's sessions
- **THEN** the test passes
- **AND** no Playwright test that previously opened the Server Pane and asserted on the multi-server tree shape regresses (audit existing e2e specs at spec stage)

### Requirement: No existing test regressions
Existing unit and e2e tests SHALL continue to pass. Any existing Playwright test that opens the Server Pane and then asserts on the multi-server `ServerGroup` shape MUST be updated to either (a) keep the Server Pane closed for that assertion, or (b) update assertions to match the single-current-server filtered view.

#### Scenario: Full test sweep
- **GIVEN** the full implementation is applied
- **WHEN** `just test` runs (backend + frontend + e2e)
- **THEN** all tests pass with no skipped cases attributed to this change

## Performance

### Requirement: Negligible render cost
The coupling logic SHALL add no more than one boolean read per Sidebar render and one filter operation over the `servers` array. No new network calls, SSE listeners, or `EventSource` attachments SHALL be introduced. Lazy-attach behavior for non-current servers (`attachServer` calls driven by `readServerOpen`) MAY become unreachable while the Server Pane is open and groups are filtered out — this is acceptable because the user has no way to interact with those groups in that state.

#### Scenario: No new fetches when toggling the Server Pane
- **GIVEN** the Sidebar is mounted on a server route with one current server and two non-current servers
- **WHEN** the user toggles the Server Pane open and closed three times in succession
- **THEN** no new HTTP, WebSocket, or SSE connections beyond the baseline are observed
- **AND** the number of React renders of `Sidebar` is bounded by O(1) per toggle (one render per state change)

## Design Decisions

1. **Path A (shared hook) over Path B (lifted context)**: chosen.
   - *Why*: Smallest local change. `CollapsiblePanel` already reads localStorage directly via internal helpers (`readPersistedState`, `readPersistedHeight`); the hook extracts the existing pattern instead of introducing a new context. The Sessions Pane consumer is a sibling, not a descendant, of `ServerPanel`, so a context provider would have to wrap the entire Sidebar just to feed one read. Same-tab reactivity is implemented via a tiny in-module pub/sub keyed on the storage key — a 20–40 line file. The native `storage` event optionally provides cross-tab sync as a free byproduct.
   - *Rejected*: Path B (new `SidebarLayoutContext` with controlled `open` prop on `CollapsiblePanel`). Drawbacks: (a) introduces controlled/uncontrolled duality on `CollapsiblePanel` (the `open` prop must accept either a uncontrolled-with-storage default or a controlled value); (b) every other `CollapsiblePanel` consumer must thread the context provider through; (c) larger blast radius for a one-pair coupling. Reversible: if the pub/sub proves fragile in practice, switching to context is a localized refactor of `useLocalStorageBoolean`'s implementation and the Sidebar's read site.

2. **Force-open the current server's group while filtered, without mutating persisted state**: chosen (clarified in intake Q12).
   - *Why*: The filtered view exists specifically to show the current server's sessions; a collapsed header would be a degenerate UI — the user opened the Server Pane expecting drill-in content. Rendering force-open is a transient prop override at the call site, not a state mutation, so persisted user habits are preserved exactly.
   - *Rejected*: (a) Honoring `localStorage["runkit-panel-sessions-${currentServer}"]` literally — fails the "filtered view should show content" expectation. (b) Writing `true` to that key when the Server Pane opens — silently mutates user state, violates the "dormant, not cleared" principle established for other servers' keys.

3. **Hook location `app/frontend/src/hooks/use-local-storage-boolean.ts`** (not `app/frontend/src/lib/`).
   - *Why*: Project convention. `src/hooks/` is the established home for `use-*` hooks (12 existing entries: `use-is-mobile.ts`, `use-optimistic-action.ts`, `use-pin-actions.ts`, `use-window-pins.ts`, etc.). `src/lib/` holds non-React utilities (`format.ts`, `clipboard.ts`, `navigation.ts`, `gauge.ts`, `sparkline.ts`) — putting a hook there would break the existing categorization.
   - *Rejected*: `src/lib/use-local-storage-boolean.ts` (the intake's suggested path) — out of step with the hooks directory convention.

4. **Empty-state copy: `Select a server above to see its sessions.`** (intake suggestion retained).
   - *Why*: Concise, action-oriented, directional ("above" is accurate because the Server Pane sits above the Sessions Pane in the sidebar layout). Matches the existing "No sessions" empty-state convention's brevity and tone.
   - *Rejected*: Longer variants ("There is no current server selected. Choose one from the Server Pane above.") — verbose, redundant given the visual context.

5. **Snap transition (no animation)** (clarified in intake Why §3rd paragraph).
   - *Why*: Animations on user-triggered layout changes feel laggy more than smooth, and the existing `ServerGroup` body animations already provide enough motion vocabulary nearby. The cause (Server Pane chevron rotates, panel body grows) and effect (Sessions Pane filter changes) are both visible in the same viewport, so the user can attribute the change without a transition cue.
   - *Rejected*: Crossfade or height-collapse on the disappearing groups — added implementation complexity (animating elements being removed requires React presence-keeping libraries like Framer Motion, or manual `setTimeout` choreography) for negligible UX value.

## Assumptions

<!-- SCORING SOURCE: fab score reads only this table. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server Pane open state (`runkit-panel-server`) is the single source of truth; no new state is introduced | Confirmed from intake #1 — verified against `server-panel.tsx:106` (`storageKey="runkit-panel-server"`) | S:95 R:85 A:90 D:90 |
| 2 | Certain | Coupling rule: Server Pane collapsed → all servers in tree; Server Pane open → current server only | Confirmed from intake #2 — core design choice, fully specified by Requirement "Coupling rule" | S:98 R:60 A:90 D:95 |
| 3 | Certain | Transition is snap (no animation) on Server Pane toggle | Confirmed from intake #3 — fully specified by Requirement "Snap transition" | S:95 R:90 A:90 D:90 |
| 4 | Certain | Empty-state hint shown when Server Pane open AND `currentServer === null` | Confirmed from intake #4 — copy and styling locked in Requirement "Empty-state hint" | S:90 R:85 A:85 D:85 |
| 5 | Certain | Per-server collapse keys (`runkit-panel-sessions-${server}`) preserved dormant; never overwritten by the coupling logic | Confirmed from intake #5 — locked in Requirement "Per-server collapse state preserved" | S:95 R:90 A:90 D:90 |
| 6 | Certain | Server Pane not removed; tile grid contents unchanged | Confirmed from intake #6 — in Non-Goals | S:98 R:85 A:95 D:95 |
| 7 | Certain | No routing, `SessionProvider`, or backend changes | Confirmed from intake #7 — in Non-Goals | S:95 R:80 A:95 D:95 |
| 8 | Certain | Path A (shared `useLocalStorageBoolean` hook) chosen over Path B (lifted context) | Upgraded from intake Confident #8 — spec-level analysis confirms: grep found no existing helper, `CollapsiblePanel` already does direct localStorage reads, sibling-component sharing makes context overkill. Decision §1 records rationale and rejected alternative. | S:90 R:75 A:85 D:85 |
| 9 | Certain | Empty-state hint copy: `Select a server above to see its sessions.` | Upgraded from intake Confident #9 — locked in spec; no stronger convention found in existing sidebar empty-states ("No sessions", "No servers", "No window selected" all use this terse imperative style). Decision §4 records rationale. | S:80 R:90 A:85 D:75 |
| 10 | Certain | Tests: Vitest colocated as `index.test.tsx` plus a new Playwright spec under `app/frontend/tests/e2e/` with sibling `.spec.md` companion | Upgraded from intake Confident #10 — constitution §"Test Companion Docs" makes the `.spec.md` requirement explicit; code-quality.md §"Test Strategy" and existing sibling test files confirm colocation | S:90 R:85 A:95 D:85 |
| 11 | Certain | Affected memory: `docs/memory/run-kit/ui-patterns.md` — single new paragraph in the existing Sidebar section, slotted near the per-server `ServerGroup` paragraphs (around line 277) | Confirmed from intake #11 — verified by reading `ui-patterns.md:245-348`, the per-server paragraphs at 275-277 are the natural anchor | S:85 R:85 A:90 D:85 |
| 12 | Certain | Force-open the current server's group while filtered; persisted state NOT overwritten; restores on Server Pane close | Confirmed from intake #12 (already clarified) — locked in Requirement "Force-open the current server's group". Decision §2 records rationale. | S:95 R:55 A:50 D:40 |
| 13 | Certain | Hook lives at `app/frontend/src/hooks/use-local-storage-boolean.ts` (NOT `app/frontend/src/lib/...`) | Diverged from intake #13 (the intake suggested `lib/`) — grep-first caveat resolved: no existing hook found, project convention puts `use-*` hooks in `src/hooks/` (12 existing examples), `src/lib/` is for non-React utilities. Decision §3 records rationale. | S:90 R:90 A:95 D:90 |
| 14 | Confident | Same-tab cross-component reactivity implemented via in-module pub/sub keyed on storage key; cross-tab `storage` event subscription is optional (free byproduct, not a requirement) | New decision — implied by Path A choice. `storage` event alone fires only across tabs, so an in-module dispatch is mandatory for the Sidebar to see Server Pane toggles. Pattern is conventional; alternatives (React 18 `useSyncExternalStore` with `subscribe` callback) are equivalent — both produce the same observable behavior. | S:75 R:80 A:80 D:75 |
| 15 | Confident | Lazy-attach to non-current servers' EventSources (`attachServer` driven by `readServerOpen`) becomes unreachable while filtered; acceptable because user has no UI to expand a filtered-out group | New decision — surfaces a subtle consequence of filtering. Acceptable because: (a) the user must close the Server Pane to interact with non-current groups, at which point the existing lazy-attach loop re-runs in `useEffect`; (b) no functional regression — the non-current servers' SSE streams are not needed while they're not rendered. | S:70 R:85 A:80 D:80 |
| 16 | Confident | `Sidebar` passes `isOpen={true}` directly to the current server's `ServerGroup` while filtered, rather than mutating per-server state | New decision — chosen to keep `ServerGroup` API stable (it already accepts `isOpen` as a controlled prop in the existing render at `index.tsx:756`). Alternative would be a render-time exemption inside `ServerGroup` itself, which couples the child to the Server Pane state — worse separation of concerns. | S:80 R:80 A:85 D:80 |
| 17 | Confident | User clicks on the current group's chevron while force-opened still write through to `runkit-panel-sessions-${currentServer}` (the persisted state advances even while the rendered state is forced) | New decision — preserves the "click does something" expectation (a no-op chevron would be confusing). The visible state stays open because force-open dominates; the persisted state takes effect once the Server Pane closes. | S:75 R:80 A:75 D:70 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).
