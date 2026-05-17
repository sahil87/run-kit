# Plan: Couple Server Pane expand state with Sessions Pane server scope

**Change**: 260516-tdu6-couple-server-pane-sessions-scope
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/hooks/use-local-storage-boolean.ts` exporting `useLocalStorageBoolean(storageKey: string, defaultValue: boolean): [boolean, (next: boolean) => void]` — initial value reads `localStorage.getItem(storageKey)` (`"true"`/`"false"` → boolean, else `defaultValue`), wrapped in try/catch for storage-disabled environments; setter writes the stringified boolean and notifies same-tab subscribers via an in-module pub/sub keyed on `storageKey`; also subscribes to the native `storage` event for cross-tab parity (free byproduct, not required). All listener wiring runs inside `useEffect` so SSR/jsdom-without-storage cases remain safe.

### Phase 2: Core Implementation

- [x] T002 Refactor `app/frontend/src/components/sidebar/collapsible-panel.tsx` to drive its open state via `useLocalStorageBoolean(storageKey, defaultOpen)` — replace the existing `useState(() => readPersistedState(...))` + manual `localStorage.setItem` in `toggle`. Delete `readPersistedState` (now dead). Keep `readPersistedHeight` / `writePersistedHeight` untouched (height is numeric, out of scope). External `CollapsiblePanelProps` surface MUST NOT change.

- [x] T003 Wire the coupling logic into `app/frontend/src/components/sidebar/index.tsx`: at the top of `Sidebar`, call `const [serverPaneOpen] = useLocalStorageBoolean("runkit-panel-server", false)`. In the Sessions Pane render region (around line 744–851), replace `servers.map(...)` with a conditional:
  - `serverPaneOpen === false` → iterate `servers` as today.
  - `serverPaneOpen === true && currentServer !== null` → render only the `servers` entry whose `name === currentServer`, passing `isOpen={true}` (force-open override) while keeping `onToggleOpen={() => toggleServerSection(srvInfo.name)}` so chevron clicks still write through to the persisted key.
  - `serverPaneOpen === true && currentServer === null` → render the empty-state hint `<div className="text-text-secondary text-xs py-4 text-center">Select a server above to see its sessions.</div>` in place of the group list.
  Keep the existing `servers.length === 0 → "No servers"` empty-state intact (it dominates when the server list itself is empty).

### Phase 3: Integration & Edge Cases

- [x] T004 Create `app/frontend/src/components/sidebar/index.test.tsx` with Vitest + Testing Library coverage of the five cases from spec §Testing "Vitest unit coverage":
  1. Server Pane collapsed → all `ServerGroup` headers rendered.
  2. Server Pane open + `currentServer === "primary"` → only the `"primary"` group is in the DOM, rendered force-open, no `ServerGroup` for `"alpha"` / `"beta"`.
  3. Server Pane open + `currentServer === null` → no `ServerGroup` elements, empty-state hint visible with exact text `"Select a server above to see its sessions."` and classes `text-text-secondary text-xs py-4 text-center`.
  4. Persisted `runkit-panel-sessions-${server}` keys are not overwritten by the force-open path (assert pre/post-render values; assert force-open dominates the rendered state even when `runkit-panel-sessions-primary === "false"`).
  5. Toggling `localStorage["runkit-panel-server"]` via the in-module hook re-renders the Sessions Pane within the same React tree (click the Server panel header in the rendered Sidebar and assert the group list flips). Use `localStorage.clear()` in `beforeEach`/`afterEach`; stub `matchMedia` per the `server-panel.test.tsx` pattern. Use `StandaloneSessionContextProvider` from `session-context.tsx` to construct the multi-server context without opening a real `EventSource`.

- [x] T005 [P] Create `app/frontend/tests/e2e/sidebar-server-coupling.spec.ts` exercising the headline flow on a desktop viewport: open the Server Pane, assert the Sessions tree narrows to the current server's `ServerGroup` only, then click a non-current tile and assert the tree shows the new server's `ServerGroup`. Also cover the empty-state case (navigate to `/` with Server Pane open → assert the hint is visible). Use `E2E_TMUX_SERVER`, port 3020, and the `beforeAll`/`afterAll` session-setup pattern from `server-panel-grid.spec.ts`. Spawn at least two distinct tmux servers (or two distinct sessions on the e2e server, depending on what the existing fixture supports) so a non-current tile is clickable.

- [x] T006 [P] Create the sibling `app/frontend/tests/e2e/sidebar-server-coupling.spec.md` companion documenting, per the constitution's Test Companion Docs rule, what each `test()` proves and its steps. Mirror the structure of `server-panel-grid.spec.md`: Shared setup, Tests (one `###` per `test()`), Notes.

### Phase 4: Polish

- [x] T007 Run scoped verification: (a) `cd app/frontend && npx tsc --noEmit`, (b) `just test-frontend` (Vitest, includes new `index.test.tsx`), (c) `just pw test sidebar-server-coupling` (new Playwright spec). Audit existing Playwright specs that open the Server Pane and assert on the multi-server tree shape — update any that regress per spec §Testing "No existing test regressions". If all scoped tests pass, run `just test` as the final smoke gate.

## Execution Order

- T001 blocks T002 and T003 (both consume the new hook).
- T002 and T003 are sequential — T002 is a pure refactor that MUST not change behaviour; T003 layers the coupling on top.
- T004 depends on T003 (tests the wired Sidebar).
- T005 and T006 are parallelizable with each other and depend on T003 (T005 needs the implementation to be runnable; T006 is documentation derived from T005's tests).
- T007 is the final verification pass — runs after T001–T006.

## Acceptance

### Functional Completeness

- [ ] A-001 Coupling rule: Sessions Pane renders all `ServerGroup`s when the Server Pane is collapsed; renders exactly one (`currentServer`'s) when the Server Pane is open with `currentServer !== null`.
- [ ] A-002 Snap transition: no fade/slide/height/opacity animation is added to the appearing/disappearing `ServerGroup` elements at the group-list level; the existing `CollapsiblePanel` body transitions inside each rendered `ServerGroup` are preserved.
- [ ] A-003 Empty-state hint: when the Server Pane is open AND `currentServer === null`, no `ServerGroup`s render and the hint `Select a server above to see its sessions.` is shown with classes `text-text-secondary text-xs py-4 text-center`.
- [ ] A-004 Per-server collapse state preserved: `runkit-panel-sessions-${server}` is never written by the coupling logic — only by user-driven `toggleServerSection` chevron clicks.
- [ ] A-005 Force-open the current server's group while filtered: when the Server Pane is open with `currentServer !== null`, the rendered `ServerGroup` receives `isOpen={true}` regardless of `localStorage["runkit-panel-sessions-${currentServer}"]`, and that key is not overwritten by the force-open path.
- [ ] A-006 Cross-component reactivity: opening/closing the Server Pane re-renders the Sessions Pane in the same tab via the `useLocalStorageBoolean` hook's in-module pub/sub — without depending on the native `storage` event (which fires only across tabs).
- [ ] A-007 `CollapsiblePanel` API stable: no new required props; `WindowPanel`, `HostPanel`, `ServerPanel`, `ServerSelector`, and any other consumer mount with their current prop sets and behaviour unchanged.
- [ ] A-008 Hook location: `app/frontend/src/hooks/use-local-storage-boolean.ts` exists; nothing was added to `app/frontend/src/lib/`.
- [ ] A-009 Sidebar read path: `Sidebar` calls `useLocalStorageBoolean("runkit-panel-server", false)` exactly once and gates the `ServerGroup` rendering region on its return value.

### Behavioral Correctness

- [ ] A-010 User chevron click while force-opened: clicking the current server's group chevron while filtered writes `runkit-panel-sessions-${currentServer}` through via `toggleServerSection`, but the rendered group remains visually open (force-open dominates while the Server Pane is open).
- [ ] A-011 Restore-on-close: after the Server Pane closes, each previously-filtered-out server's group re-renders with its persisted `runkit-panel-sessions-${server}` value (or the `server === currentServer` default when unset).

### Scenario Coverage

- [ ] A-012 Scenario "Server Pane collapsed (default first-run)": Vitest test case asserts three `ServerGroup` elements render for `[primary, alpha, beta]` when `localStorage["runkit-panel-server"]` is unset.
- [ ] A-013 Scenario "Server Pane open, current server resolved": Vitest test case asserts exactly one `ServerGroup` (for `currentServer`) renders and groups for other servers are absent from the DOM.
- [ ] A-014 Scenario "Open Server Pane on a board route": Vitest test case asserts no `ServerGroup`s and the empty-state hint appears with the exact copy and styling.
- [ ] A-015 Scenario "Non-current server's collapse state survives filtering": Vitest test asserts `localStorage["runkit-panel-sessions-alpha"]` is still `"true"` after the Server Pane toggles open and closed.
- [ ] A-016 Scenario "Persisted collapsed, force-open while filtered": Vitest test asserts the rendered group is open while `localStorage["runkit-panel-sessions-primary"]` remains `"false"`.
- [ ] A-017 Scenario "Playwright flow validates the user-visible behavior": e2e test passes — open Server Pane → tree narrows → click a non-current tile → tree shows that server's group.

### Edge Cases & Error Handling

- [ ] A-018 SSR / jsdom-without-storage: hook gracefully falls back to `defaultValue` when `localStorage` throws or `window` is missing; no test mutates real `localStorage` without resetting it in `afterEach`.
- [ ] A-019 Current server deleted while Server Pane open: when `currentServer` transitions from `"alpha"` to `null` (kill server), the previously-rendered single `ServerGroup` unmounts and the empty-state hint replaces it without rendering any other server's group.
- [ ] A-020 `servers.length === 0` still dominates: when the server list itself is empty, the existing `"No servers"` empty-state remains the rendered output regardless of Server Pane open state.

### Code Quality

- [ ] A-021 Pattern consistency: new hook lives in `src/hooks/` (matching 12+ existing `use-*` files); no new files added to `src/lib/` for React hooks. Naming follows `use-{kebab-case}.ts` convention. No new "what the code does" comments; comments explain "why" only where non-obvious.
- [ ] A-022 No unnecessary duplication: `useLocalStorageBoolean` replaces the existing `readPersistedState` + manual `localStorage.setItem` pattern inside `CollapsiblePanel`; `readPersistedState` is removed. The Sidebar reads via the same hook — no second direct `localStorage.getItem("runkit-panel-server")` call elsewhere.
- [ ] A-023 Constitution IV (Minimal Surface Area): no new routes, no new settings pages, no expansion beyond the spec's empty-state hint + filter logic.
- [ ] A-024 Constitution V (Keyboard-First): the empty-state hint is text-only with no new keyboard affordance added; existing Server Pane keyboard reachability (header button, tile `option` roles) is preserved.
- [ ] A-025 Type narrowing over assertions: any new typings (hook return type, pub/sub map types) use `if` guards / discriminated unions, not `as` casts, per `code-quality.md`.
- [ ] A-026 Test Companion Docs: `sidebar-server-coupling.spec.ts` ships with a sibling `.spec.md` covering every `test()` per the constitution's mandatory rule.
- [ ] A-027 No existing test regressions: `just test` passes with no new skipped cases attributed to this change; any existing Playwright test that opened the Server Pane and asserted on the multi-server tree shape was updated to either keep the Server Pane closed or match the filtered view.

### Performance

- [ ] A-028 Negligible render cost: the coupling logic adds at most one boolean read per Sidebar render and one filter over `servers`. No new network calls, SSE listeners, or `EventSource` attachments are introduced.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
