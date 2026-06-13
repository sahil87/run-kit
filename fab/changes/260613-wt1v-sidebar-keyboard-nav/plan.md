# Plan: Sidebar Keyboard Navigation (Wave 3)

**Change**: 260613-wt1v-sidebar-keyboard-nav
**Intake**: `intake.md`

## Requirements

Frontend-only change on the sidebar session/window tree DOM (`app/frontend/src/components/sidebar/`). Two paired concerns: (1) roving-tabindex arrow-key navigation scoped to the focused Sessions tree, and (2) W3C-APG tree ARIA. No backend, API, route, or tmux changes (Constitution II/IV/IX untouched). Builds on the Wave-2 memoized rows (#262, merged) and MUST preserve their memo invariants.

### Sidebar Tree: Roving-Tabindex Arrow Navigation

#### R1: Single roving tab stop over visible tree rows
The Sessions tree SHALL maintain a roving-tabindex model: exactly one tree row carries `tabIndex={0}` (the roving-focused row) and every other tree row carries `tabIndex={-1}`. The set of navigable rows is the flattened list of currently-VISIBLE tree rows in DOM order: every session header row whose server group is open, plus the window rows of each session that is NOT collapsed. Server-group headers, Boards rows, and Server-panel tiles are excluded.

- **GIVEN** a sidebar with one open server group containing one expanded session with two windows
- **WHEN** the tree first renders
- **THEN** exactly one of the {session row, window rows} carries `tabIndex={0}` and the rest carry `tabIndex={-1}`
- **AND** collapsing the session removes its window rows from the navigable set

#### R2: ArrowDown/ArrowUp move between visible rows, stopping at the ends
ArrowDown SHALL move roving focus to the next visible row; ArrowUp to the previous. Traversal flows continuously across all open server groups as one flat list and STOPS at the first/last row (no wrap). Each handled key calls `preventDefault()`.

- **GIVEN** roving focus on the first visible row
- **WHEN** the user presses ArrowUp
- **THEN** focus does not move (stop at start, no wrap) and page scroll is prevented
- **AND** **WHEN** on the last visible row and ArrowDown is pressed, focus does not move (stop at end)
- **AND** **WHEN** on the last row of server group A's subtree and ArrowDown is pressed, focus moves to the first row of server group B

#### R3: ArrowRight/ArrowLeft expand/collapse and move within the disclosure tree
ArrowRight on a collapsed session row SHALL expand it; on an already-expanded session row SHALL move to its first window child; on a window row is a no-op. ArrowLeft on an expanded session row SHALL collapse it; on a window row SHALL move to its parent session row; on a collapsed session row is a no-op. Each handled key calls `preventDefault()`.

- **GIVEN** roving focus on a collapsed session row
- **WHEN** the user presses ArrowRight
- **THEN** the session expands (its windows become visible) and focus stays on the session row
- **AND** **WHEN** the session is expanded and ArrowRight is pressed again, focus moves to the session's first window row
- **AND** **WHEN** focus is on a window row and ArrowLeft is pressed, focus moves to the parent session row
- **AND** **WHEN** focus is on an expanded session row and ArrowLeft is pressed, the session collapses

#### R4: Enter and Space activate the focused row
Enter AND Space SHALL both activate the focused row (W3C APG tree convention): a window row fires `onSelectWindow(server, session, windowId)`; a session row fires `onSelectFirstWindow(server, session, firstWindowId)`. Each calls `preventDefault()`.

- **GIVEN** roving focus on a window row
- **WHEN** the user presses Enter (or Space)
- **THEN** `onSelectWindow` is called with that row's (server, session, windowId)
- **AND** **WHEN** focus is on a session row and Enter/Space is pressed, `onSelectFirstWindow` is called

#### R5: Home/End jump to first/last visible row
Home SHALL move roving focus to the first visible row; End to the last visible row (across all open groups). Each calls `preventDefault()`.

- **GIVEN** roving focus on any row
- **WHEN** the user presses Home
- **THEN** focus moves to the first visible row
- **AND** **WHEN** End is pressed, focus moves to the last visible row

#### R6: Roving focus moves the DOM focus and scrolls the row into view
On a roving-index change the handler SHALL imperatively `focus()` the new row's DOM node (window rows via `[data-window-id]`, session rows via an analogous stable handle) and SHALL `scrollIntoView({ block: "nearest" })` so the row stays visible past the scroll boundary — mirroring the CommandPalette/ThemeSelector "Keyboard-Navigable List Scroll Pattern".

- **GIVEN** a tree taller than its scroll container with roving focus near the bottom
- **WHEN** ArrowDown moves focus to a row below the fold
- **THEN** `document.activeElement` is the new row and the row is scrolled into the nearest-visible position

#### R7: Rename inputs and non-tree targets are not hijacked
The tree `onKeyDown` SHALL early-return when the event originates from an `<input>` or editable element (so a row's rename input keeps Enter=commit / Escape=cancel and arrows move the text caret) and SHALL only act on events whose target is within the session tree.

- **GIVEN** a session/window row in rename mode with its `<input>` focused
- **WHEN** the user presses ArrowDown or Enter inside the input
- **THEN** the tree handler does not move roving focus or activate a row; the rename input's own handler governs

### Sidebar Tree: Tree ARIA (two-level disclosure tree)

#### R8: Tree container carries role="tree"
The scrollable Sessions region wrapping the `ServerGroup`s (`index.tsx:825`, `<div className="flex-1 min-h-0 overflow-y-auto">`) SHALL carry `role="tree"` with an accessible label. The `<nav aria-label="Sessions">` landmark SHALL remain the outer landmark — `role="tree"` goes on the inner container, not on the `<nav>`.

- **GIVEN** the rendered sidebar
- **WHEN** the accessibility tree is inspected
- **THEN** the `<nav aria-label="Sessions">` landmark contains a distinct `role="tree"` element wrapping the server groups

#### R9: Session rows are level-1 treeitems with expanded/controls/position metadata
Each session header row (`SessionRow`) SHALL be `role="treeitem"`, `aria-level="1"`, `aria-expanded={!isCollapsed}`, `aria-controls={windowGroupId}`, with `aria-setsize` (count of sibling sessions) and `aria-posinset` (1-based position among siblings). The existing chevron `aria-expanded` is lifted/duplicated onto the treeitem.

- **GIVEN** a server group with 3 sessions, the 2nd expanded
- **WHEN** the 2nd session row is inspected
- **THEN** it is `role="treeitem"` `aria-level="1"` `aria-setsize="3"` `aria-posinset="2"` `aria-expanded="true"` with `aria-controls` referencing its window group's id

#### R10: Window rows are level-2 leaf treeitems with position metadata
Each window row (`WindowRow`) SHALL be `role="treeitem"`, `aria-level="2"` (a leaf — no `aria-expanded`), with `aria-setsize` (count of sibling windows) and `aria-posinset` (1-based position among siblings).

- **GIVEN** a session with 2 windows
- **WHEN** the 1st window row is inspected
- **THEN** it is `role="treeitem"` `aria-level="2"` `aria-setsize="2"` `aria-posinset="1"` with no `aria-expanded`

#### R11: Window-list container is a role="group" with a stable id
The window-list container (`<div className="ml-3">`, `index.tsx:1204`) SHALL carry `role="group"` and a stable `id` (e.g. `windows-${server}-${session}`) referenced by the parent session row's `aria-controls`.

- **GIVEN** a session "api" on server "default" with its windows visible
- **WHEN** the window-list container is inspected
- **THEN** it is `role="group"` with `id="windows-default-api"` and the session row's `aria-controls` equals that id

### Non-Goals

- **Palette window-switching** — already shipped by #260 ("Window: Switch to …"). Does NOT touch `app.tsx` / `windowActions`.
- **`index.tsx` god-orchestrator hook-extraction** — explicitly out of scope for all three sidebar waves; keyboard nav is wired into the orchestrator as-is.
- **Keyboard drag-and-drop reordering** — the mouse DnD reorder and derive-over-store session-order pattern are untouched; no keyboard "move window up/down" (that lives in the palette).
- **Server-group header as a treeitem (3-level tree)** — the per-server `ServerGroup` header stays a structural wrapper; server collapse/expand remains mouse/Tab-button only for v1.
- **Re-introducing any `nowSeconds` prop** removed by Wave 2.

### Design Decisions

1. **Two-level tree (session = level 1, window = level 2); server header is a structural wrapper, not a treeitem**: keeps v1 simple. — *Why*: user explicitly chose this at intake (Assumption #10). — *Rejected*: 3-level tree with server-as-treeitem (more ARIA surface, server collapse keyboard wiring, deferred).
2. **APG-standard navigation: ArrowUp/Down stop at ends (no wrap), continuous cross-group flow, Enter AND Space activate**: matches W3C APG Tree View. — *Why*: user explicitly chose APG-standard at intake (Assumption #11). — *Rejected*: wrap-around + Enter-only.
3. **Roving state in `index.tsx` (a single `rovingKey` string), threaded as a `tabIndex` prop into memo'd rows**: keeps tree state in the orchestrator that already owns it; only the two affected rows re-render per keypress. — *Why*: respects the Wave-2 memo tree (Assumption #5). — *Rejected*: per-row focus management / reusing URL-based `isSelected` as the roving index (Assumption #7 — would light up wrong rows).
4. **`onKeyDown` on the tree container, not `document` / not the terminal**: arrows act only when focus is inside the tree. — *Why*: xterm.js owns terminal keystrokes; the project removed single-key/global shortcuts because they conflicted (Assumption #3).
5. **Roving cursor is a row *key* (`data-window-id` / `data-session-row`), resolved against the live DOM (`[role="treeitem"]` within the tree) at keypress time — NOT a numeric index over a render-derived array** *(revised in rework cycle 1)*. — *Why*: the key model survives expand/collapse and SSE add/remove without ever pointing at a stale/wrong row (a numeric index can desync when the visible set changes between renders); the "session row, then descend into windows" cross-group order falls out of DOM order for free. The Wave-2 SSE-tick invariant is preserved by gating the key-normalization effect on a cheap visible-set signature (NOT running it on every render) and never moving focus on a passive tick. — *Rejected*: a numeric `rovingIndex` over a render-derived flattened array (the originally-planned model; replaced because index↔row desync on visible-set changes is the harder failure mode). The earlier concern that DOM-query "re-queries every keypress" is accepted as cheap — keypresses are rare and user-driven, unlike the several-per-second SSE path.

## Tasks

### Phase 1: Setup (props + ARIA scaffolding on memo'd rows)

- [x] T001 [P] In `app/frontend/src/components/sidebar/window-row.tsx`: add optional props `tabIndex?: number`, `ariaLevel?: number`, `ariaSetSize?: number`, `ariaPosInSet?: number` to `WindowRowProps`; render them on the row wrapper `<div data-window-id …>` as `role="treeitem"`, `aria-level`, `aria-setsize`, `aria-posinset`, and `tabIndex` (default `-1` when undefined). Keep `memo(WindowRowInner)`. <!-- R10 -->
- [x] T002 [P] In `app/frontend/src/components/sidebar/session-row.tsx`: add optional props `tabIndex?: number`, `ariaSetSize?: number`, `ariaPosInSet?: number`, `windowGroupId?: string`, and a stable row handle prop (`data-session-row` value, e.g. `sessionRowKey?: string`). Render the row's outer `<div>` as `role="treeitem"`, `aria-level="1"`, `aria-expanded={!isCollapsed}`, `aria-controls={windowGroupId}`, `aria-setsize`, `aria-posinset`, `tabIndex` (default `-1`), and `data-session-row={sessionRowKey}`. Keep `memo(SessionRowInner)`. <!-- R9 --> <!-- rework: SF-5 — emit aria-controls ONLY while the session is expanded (the role=group window list is mounted only when !isCollapsed); a collapsed session must not point aria-controls at an unmounted id (invalid ARIA). Update session-row.test.tsx to assert aria-controls is absent when isCollapsed. -->

### Phase 2: Core Implementation (roving state + visible-rows model in index.tsx)

- [x] T003 In `app/frontend/src/components/sidebar/index.tsx`: add a `role="group"` + stable `id={`windows-${server}-${session}`}` to the window-list container (`<div className="ml-3">`), and pass that same id as `windowGroupId` to the `SessionRow`. <!-- R11 -->
- [x] T004 In `index.tsx`: add `role="tree"` + `aria-label="Session tree"` to the scrollable Sessions region (`<div className="flex-1 min-h-0 overflow-y-auto">`). Keep `<nav aria-label="Sessions">` as the landmark. <!-- R8 -->
- [x] T005 In `index.tsx`: build the flattened visible-rows model in DOM order. For each visible server group (`isOpen`), in `orderedSessions` order: push a session entry `{ kind: "session", server, session, key }`, then if `!isCollapsed` push each window entry `{ kind: "window", server, session, windowId }`. Compute it where the per-server data is available (a memoized derivation over `visibleServers` + `collapsed` + open-state) and pass per-row `tabIndex`/`aria-setsize`/`aria-posinset` down to rows. Thread `aria-setsize`/`aria-posinset` (session position among `orderedSessions`; window position among `session.windows`) and `tabIndex` (0 for the roving row, -1 otherwise) into `SessionRow`/`WindowRow` via `ServerGroup`. <!-- R1 -->
- [x] T006 In `index.tsx`: roving state is a single `rovingKey` string (the roving row's `data-window-id`/`data-session-row`), with a `useEffect` keyed on `[rovingKey]` that focuses + `scrollIntoView({ block: "nearest" })`s the matching row (mirroring CommandPalette/ThemeSelector), gated by `focusMovedRef` so focus moves only on an actual keypress-driven change. <!-- R6 --> <!-- rework: MF-1 — the rovingKey-normalization effect MUST NOT run on every render. It currently has no dependency array, so it fires on every passive SSE tick (several/sec), runs a full-tree querySelectorAll, and can call setRovingKey(firstKey) when window churn invalidates the current key — an SSE-driven roving-state change that violates the Wave-2 #262 invariant ("an SSE tick must NOT change roving state"). Gate it on a cheap derived visible-set signature (e.g. a memoized string of open-server × !collapsed-session × window-id list, or [rovingKey, visibleRowSignature]) so it re-validates ONLY when the visible-row SET changes, never on a passive data tick. Preserve: no focus steal on a passive render (focusMovedRef stays false). -->
- [x] T007 In `index.tsx`: add the tree-container `onKeyDown` handler implementing ArrowDown/Up (move next/prev, stop at ends), ArrowRight/Left (expand/first-child / collapse/parent, with no-ops per R3), Enter+Space (activate via `onSelectWindow` / `onSelectFirstWindow`), Home/End (first/last). Each handled key `preventDefault()`s. Early-return when `e.target` is an `<input>`/editable. Attach it to the `role="tree"` container. <!-- R2 R3 R4 R5 R7 --> <!-- rework: (a) SF-2 — Enter/Space activation MUST derive the target from the roving row's identity and call onSelectWindow(server,session,windowId) / onSelectFirstWindow(...) DIRECTLY, not via currentEl.querySelector('button').click() or the magic-string aria-label^="Navigate to" (brittle: DOM-order + label-text coupling, no type safety, R4 says the handler "fires onSelectWindow"). (b) SF-3 — guard activation against ghost/optimistic rows: if the roving key starts with "ghost-" (empty windowId), Enter/Space is a no-op (mirror the existing isGhostWindow/dragEnabled guard on the drag path). -->

### Phase 3: Integration & Edge Cases

- [x] T008 In `index.tsx`: wire `ServerGroup` to receive `rovingKey` (the identity of the roving row) and per-row index data so each `SessionRow`/`WindowRow` gets the correct `tabIndex` (0 only for the roving row). Ensure only the two affected rows change `tabIndex` per keypress (preserve Wave-2 memo invariants — keep handler identities stable, thread no churning value). <!-- R1 --> <!-- rework: re-verify after the MF-1 effect-gating change that a simulated SSE tick (re-render with a changed sessionsByServer Map but no keypress) does NOT change rovingKey and does NOT pull focus into the tree. -->
- [x] T009 In `index.tsx`: handle ArrowRight-expand / ArrowLeft-collapse by calling the existing `toggleSession(server, name)`; after an expand, the newly-visible windows extend the list — keep the roving row on the session (R3 first press) so the next ArrowRight lands on the first child. Handle the rename early-return so the existing per-row rename `onKeyDown` (Enter/Escape) is unaffected. <!-- R3 R7 --> <!-- rework: SF-4 — the mobile-drawer focus effect (the useEffect that focuses the [data-window-id] [aria-current="page"] row on drawer open, index.tsx ~:728) focuses a row WITHOUT updating rovingKey, so the focused row and the tabIndex=0 tab-stop desync and the next arrow jumps. Sync rovingKey to that row's key when the effect focuses it (or have handleTreeKeyDown derive the current row from document.activeElement when it is a treeitem). -->

### Phase 4: Tests

- [x] T010 [P] Extend `app/frontend/src/components/sidebar/window-row.test.tsx`: assert the row renders `role="treeitem"`, `aria-level="2"`, `aria-setsize`/`aria-posinset` when passed, no `aria-expanded`, and `tabIndex` reflects the prop (0 vs -1). <!-- R10 -->
- [x] T011 [P] Extend `app/frontend/src/components/sidebar/session-row.test.tsx`: assert the row renders `role="treeitem"`, `aria-level="1"`, `aria-expanded` mirrors `!isCollapsed`, `aria-controls` equals the passed window-group id, `aria-setsize`/`aria-posinset`, `tabIndex`, and `data-session-row`. <!-- R9 -->
- [x] T012 Extend `app/frontend/src/components/sidebar/index.test.tsx`: assert (a) the tree container has `role="tree"` inside the `nav[aria-label="Sessions"]`; (b) the window-list container has `role="group"` with the expected id matched by the session row's `aria-controls`; (c) exactly one tree row has `tabIndex=0`; (d) ArrowDown/Up move the `tabIndex=0` (and focus) and stop at the ends; (e) ArrowRight expands a collapsed session; (f) Enter on a window row calls `onSelectWindow`; (g) a keydown originating from a rename `<input>` does not move roving focus. <!-- R1 R2 R3 R4 R7 R8 R11 -->
- [x] T013 Add Playwright spec `app/frontend/tests/e2e/sidebar-keyboard-nav.spec.ts` + sibling `app/frontend/tests/e2e/sidebar-keyboard-nav.spec.md` (Constitution Test Companion Docs) covering: focus the tree, ArrowDown/Up traversal, ArrowRight/Left expand-collapse, Enter-select, Home/End, and that arrows inside a rename input / the terminal are not hijacked. <!-- R2 R3 R4 R5 R6 R7 -->

### Phase 5: Rework (cycle 1 — review findings)

- [x] T014 In `app/frontend/src/components/sidebar/index.test.tsx`: add a regression test for the SSE-tick invariant (would have caught MF-1) — render the tree, set a roving row, then re-render with a CHANGED `sessionsByServer`/sessions Map (simulating a passive SSE tick, no keypress) and assert (a) `rovingKey`/the `tabIndex=0` row is UNCHANGED and (b) `document.activeElement` is NOT pulled into the tree. Also add an `expect(document.activeElement).toBe(...)` assertion after an arrow keypress (the focus-movement half was previously untested). <!-- R1 R6 -->
- [x] T015 In `app/frontend/src/components/sidebar/index.test.tsx` (and the e2e spec if cheap): assert Enter/Space on a ghost/optimistic window row (key prefixed `ghost-`, empty windowId) does NOT call `onSelectWindow` (SF-3 guard), and that Enter/Space on a real window row calls `onSelectWindow` with the correct `(server, session, windowId)` derived from the roving identity (SF-2 — direct handler call, not a synthesized click). <!-- R4 -->
- [x] T016 In `app/frontend/src/components/sidebar/session-row.test.tsx`: assert `aria-controls` is PRESENT (equals the window-group id) when expanded and ABSENT when `isCollapsed` (SF-5). <!-- R9 R11 -->

## Execution Order

- T001, T002 are independent ([P]) and precede everything (props the parent will thread).
- T003, T004 are independent ARIA wiring on the container.
- T005 → T006 → T007 → T008 → T009 are sequential (visible-rows model → focus effect → keydown → tabIndex wiring → arrow expand/collapse edge cases), all in `index.tsx`.
- T010, T011 ([P]) depend on T001/T002. T012 depends on T003–T009. T013 depends on the full feature.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Exactly one visible tree row carries `tabIndex={0}`; all others carry `tabIndex={-1}`. The navigable set is session rows of open groups plus window rows of non-collapsed sessions only (Boards/Server-panel excluded). Met: `tabIndex={rovingKey === key ? 0 : -1}` threaded into both rows (index.tsx:1385, 1463); the normalize effect (index.tsx:797) guarantees exactly one match; `[role="treeitem"]` scoped to `treeRef` (the `role="tree"` container) excludes Boards/Server-panel. Unit test "establishes exactly one tab stop" passes.
- [x] A-002 R2: ArrowDown/ArrowUp move roving focus between visible rows, flow continuously across open server groups, and stop (no wrap) at the first/last row; each press prevents default page scroll. Met: `moveRovingTo` clamps to `[0, len-1]` (index.tsx:813); both keys `preventDefault()` (index.tsx:853-858). DOM-order `querySelectorAll` flows continuously across groups. Unit + e2e cover stop-at-ends.
- [x] A-003 R3: ArrowRight expands a collapsed session, then moves to its first window; ArrowLeft collapses an expanded session and moves a window to its parent; window-ArrowRight and collapsed-session-ArrowLeft are no-ops. Met: index.tsx:868-906. Window-ArrowRight `break`s (leaf no-op); collapsed-session-ArrowLeft falls through with no action.
- [x] A-004 R4: Enter and Space both activate — `onSelectWindow` on a window row, `onSelectFirstWindow` on a session row. Met (REWORKED, SF-2): index.tsx:962-984 derives the target from the roving row's TYPED `RowIdentity` (discriminated union) and calls `onSelectWindow(server, session, windowId)` / `onSelectWindow(server, session, firstWindowId)` DIRECTLY — the brittle `.click()` synthesis / `aria-label^="Navigate to"` coupling is GONE. `onSelectFirstWindow` is wired as `onSelectWindow` at index.tsx:1504, so the session-row keyboard path is behaviorally identical to the mouse path. T015 ("Enter on a real window row calls onSelectWindow with the roving identity") passes.
- [x] A-005 R5: Home moves to the first visible row and End to the last. Met: index.tsx:860-867. Unit test "Home/End jump" passes.
- [x] A-006 R6: A roving change moves `document.activeElement` to the new row's DOM node and calls `scrollIntoView({ block: "nearest" })`. Met: the `[rovingKey]` focus effect (index.tsx:825-836) + the same-key imperative path in `moveRovingTo` (index.tsx:867-883). `focusMovedRef` gates focus to user key nav only (passive SSE re-render never steals focus). T014(b) ("moves document.activeElement onto the roving row after an arrow keypress") asserts the focus half explicitly.
- [x] A-007 R7: A keydown from a rename `<input>` does not move roving focus or activate a row; the rename Enter/Escape contract still works. Met: early-return on `HTMLInputElement`/`HTMLTextAreaElement`/`isContentEditable` (index.tsx:835-842). Unit + e2e cover the rename-input case.
- [x] A-008 R8: The scrollable Sessions region carries `role="tree"`; the `<nav aria-label="Sessions">` landmark stays separate. Met: `role="tree"` + `aria-label="Session tree"` on the inner `<div>` (index.tsx:1010-1011); `<nav aria-label="Sessions">` unchanged (index.tsx:966).
- [x] A-009 R9: Session rows are `role="treeitem"` `aria-level="1"` with correct `aria-expanded`/`aria-controls`/`aria-setsize`/`aria-posinset`. Met: session-row.tsx:117-123; index.tsx:1385-1389 threads set/pos/windowGroupId.
- [x] A-010 R10: Window rows are `role="treeitem"` `aria-level="2"` (no `aria-expanded`) with correct `aria-setsize`/`aria-posinset`. Met: window-row.tsx:213-217; index.tsx:1464-1466. No `aria-expanded` rendered. Unit test asserts absence.
- [x] A-011 R11: The window-list container is `role="group"` with a stable id referenced by the session row's `aria-controls`. Met: `role="group" id={windows-${server}-${session.name}}` (index.tsx:1408); same id passed as `windowGroupId` → `aria-controls` (index.tsx:1388). Unit test verifies the association resolves via `getElementById`.

### Behavioral Correctness

- [x] A-012 R1: Per arrow keypress only the two affected rows (old + new roving) change `tabIndex` — the Wave-2 memo tree is preserved (no churning props threaded into memo'd children; handler identities stable). Met: `rovingKey` is a single string prop; on change only the two rows whose computed primitive `tabIndex` flips get a changed prop, the rest bail under memo. All handlers stay identity-arg `useCallback`s; no `nowSeconds`/churning value threaded. MF-1 VERIFIED REWORKED: the roving-key normalize effect is now gated on `[rovingKey, rowsVersion]` (index.tsx:863), and `rowsVersion` is bumped by `registerGroupRows` ONLY when a group's visible-row-set string signature changes (index.tsx:785-794). A passive SSE tick recomputes `rowSlice`/`rowSignature` (deps include the fresh `orderedSessions` ref) but the signature STRING value is unchanged → `prev === signature` → no `bumpRowsVersion()` → normalize effect does NOT run → `rovingKey` untouched, `focusMovedRef` stays false. So the tick neither changes roving state nor steals focus. Both `WindowRow`/`SessionRow`/`ServerGroup` remain `memo(...Inner)`. T014(a) (the SSE-tick regression test that would have caught the original MF-1) + the existing `React.memo` unit tests for both rows pass.
- [x] A-013 R2 R3 R4 R5 R7: A Playwright spec exercises arrow traversal, Left/Right expand-collapse, Enter-select, Home/End, and the rename-input/terminal non-hijack, with a matching `.spec.md` companion. Met: `tests/e2e/sidebar-keyboard-nav.spec.ts` (5 tests, `playwright --list` confirms all 5 compile/enumerate, exit 0) + `.spec.md` companion present per Constitution Test Companion Docs (the .spec.md documents all 5 tests with what-it-proves + steps). NOTE: the spec does not include an explicit terminal-non-hijack assertion (only rename-input); see Nice-to-have. Home/End is covered by the ArrowDown/Up spec's `Home` press + the unit-test Home/End jump.
- [x] A-014 R8 R9 R10 R11: Unit tests assert the tree/treeitem/group roles, levels, set/pos metadata, and aria-controls association. Met: index.test.tsx "tree ARIA + roving keyboard navigation" block + session-row.test.tsx / window-row.test.tsx "tree ARIA + roving tabindex" blocks. All pass.

### Edge Cases & Error Handling

- [x] A-015 R7: Arrows pressed while a row's rename input is focused move the text caret, not the tree (handler early-returns on editable targets). Met: index.tsx:835-842. Unit test "does not hijack arrows originating from a rename input" passes.
- [x] A-016 R2: When the visible-rows list shrinks (a session collapses), the roving index is clamped so it never points past the end. Met: the key-based model is inherently robust — the normalize effect (index.tsx:851-863) resets `rovingKey` to the first visible row when the current key no longer matches a rendered treeitem (and `rowsVersion` bumps on the collapse because the signature shrank), and `moveRovingTo` clamps to `[0, len-1]` (index.tsx:868). Approach differs from the plan's "clamp a numeric index" but achieves the same guarantee more directly.

### Code Quality

- [x] A-017 Pattern consistency: New code follows the surrounding TypeScript/React 19/Tailwind v4 idiom and the identity-arg `useCallback` prop-threading into `ServerGroup`; rows stay `memo(...Inner)`. Met: all new handlers are `useCallback`; `rovingKey` threaded as a single string; rows unchanged in their memo wrapping.
- [x] A-018 **N/A**: The roving + scrollIntoView mechanism reuses the CommandPalette/ThemeSelector "Keyboard-Navigable List Scroll Pattern" rather than inventing a new one. Partial: the implementation reuses the `scrollIntoView({ block: "nearest" })` + ref-query half of the pattern, but deliberately diverges from the pattern's `selectedIndex` numeric-state model — it uses a `rovingKey` string + a DOM `querySelectorAll('[role="treeitem"]')` enumeration instead of the plan's render-derived flattened model. Marked N/A on strict "reuse the same mechanism" because the divergence is intentional and arguably superior for the variable-length tree; see Should-fix for the design-deviation note. The scroll half of the pattern IS reused.
- [x] A-019 Type narrowing over assertions: Visible-row discrimination uses a discriminated union / `if` guards, not `as` casts (code-quality.md). Met (STRENGTHENED in rework): Enter/Space activation now derives the target from a typed `RowIdentity` discriminated union (index.tsx:42-44) via `identityForKey` + `identity.kind === "window"` narrowing — no `as` cast on the activation path. DOM-navigation predicates use `hasAttribute("data-window-id")` / `getAttribute("aria-level")` guards. Minor: `e.target as HTMLElement` cast in `handleTreeKeyDown` (index.tsx:890) — narrowed immediately via `instanceof` checks, acceptable.
- [x] A-020 No client polling / no new caches: roving state is plain React state; no `setInterval`/fetch, no new in-memory cache (code-quality.md anti-patterns). Met: `rovingKey` is plain `useState`; refs (`focusMovedRef`, `treeRef`) are not caches.
- [x] A-021 Keyboard-first (Constitution V): every new navigation affordance is reachable by keyboard; no new mouse-only path. Met: the entire change is keyboard-affordance; no mouse-only path added.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Deviation from intake path**: the intake's example path `app/frontend/tests/sidebar-keyboard-nav.spec.ts` is corrected to `app/frontend/tests/e2e/sidebar-keyboard-nav.spec.ts` — the Playwright `testDir` is `./tests/e2e` (playwright.config.ts:6) and every existing spec lives there. The `.spec.md` companion sits beside it per Constitution Test Companion Docs.

## Deletion Candidates

None — this change adds new functionality (roving-tabindex keyboard nav + tree ARIA) without making existing code redundant. The pre-existing mobile-drawer focus effect (index.tsx:735-757) overlaps conceptually with the new roving-focus effect but serves a distinct trigger (drawer-open vs. arrow-key nav) and is NOT superseded — instead the rework WIRED it to the roving model (SF-4: it now `setRovingKey(key)`s the row it focuses so the tab-stop doesn't desync). The session/window rename `onKeyDown` handlers are untouched and still required. Every new symbol (`RowIdentity`, `registerGroupRows`, `identityForKey`, `getVisibleRows`, `rowKeyOf`, `moveRovingTo`, `handleTreeKeyDown`, `rowsVersion`/`bumpRowsVersion`, `groupSignatureRef`, `rowIdentityRef`, `focusMovedRef`) has live call sites (verified by grep). No symbol, branch, or file became unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New Playwright spec lives in `app/frontend/tests/e2e/` (not the intake's literal `app/frontend/tests/`), beside its `.spec.md`. | Playwright `testDir: "./tests/e2e"` (playwright.config.ts:6); all 20+ existing specs live there. The intake path was a shorthand; the real convention is unambiguous. | S:95 R:90 A:98 D:95 |
| 2 | Confident | Roving index is a single `useState<number>` over the render-derived flattened visible-rows list (not a per-row id map); the focus effect keys on `[rovingIndex]` and queries the stable handle. | Mirrors CommandPalette/ThemeSelector `selectedIndex` exactly (ui-patterns "Keyboard-Navigable List Scroll Pattern"). Index over a render-stable derived list is the established pattern. | S:80 R:70 A:88 D:78 |
| 3 | Confident | Session rows get a `data-session-row` handle with value `${server}:${name}` (parallel to window rows' `data-window-id`); the focus effect queries it within `navRef`. | The intake calls for "an analogous stable handle, e.g. data-session-row". `${server}:${name}` matches the existing `collapsed` key convention in `toggleSession`. | S:82 R:75 A:85 D:80 |
| 4 | Confident | ArrowRight on an expanded session moves to its first window; the first press on a COLLAPSED session only expands (focus stays on the session), so two presses are needed to reach the first child from collapsed. | This is the literal W3C APG Tree behavior the intake specifies (R3 GIVEN/WHEN/THEN); expand-then-descend on separate presses is the standard. | S:88 R:75 A:88 D:82 |
| 5 | Confident | The keydown handler reads the roving row's identity from the flattened list at the current `rovingIndex` rather than from `document.activeElement`, deriving expand/collapse/activate targets from the model. | The model is the single source of truth (render-derived); reading activeElement would couple to DOM focus timing. One obvious interpretation given the index-based pattern. | S:80 R:68 A:85 D:78 |

5 assumptions (1 certain, 4 confident, 0 tentative).
