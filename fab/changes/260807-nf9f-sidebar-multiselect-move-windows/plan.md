# Plan: Sidebar Multi-Select of Window Rows + Bulk Move-to-Session

**Change**: 260807-nf9f-sidebar-multiselect-move-windows
**Intake**: `intake.md`

## Requirements

### Selection: Store and Pure Logic

#### R1: Dedicated selection store keyed by the composite row key
A small dedicated zustand store (`app/frontend/src/store/selection-store.ts`, following the
`window-store.ts` pattern) SHALL hold the sidebar's window-row selection as a
`ReadonlySet<string>` of composite `${server}:${windowId}` keys (the same key shape as
`entryKey()` and the sidebar's `data-row-key`), plus a nullable `anchor` key for shift-range
extension. It SHALL expose `toggle(key)`, `select(keys)`, `selectOnly(keys)`,
`clear()`, `prune(liveKeys)`, and `settleBatch(batchKeys, retainKeys)` — the
last scoping an async batch's terminal update to the keys that batch owned (see R15), since the
bulk move runs fire-and-forget behind an already-closed palette and must not clobber a selection
the user starts while it is still in flight.

A separate `deselect(keys)` is deliberately NOT exposed: every removal path is already covered
(`toggle` for one row, `clear` for Escape / plain click, `prune` for rows leaving the tree, and
`selectOnly` for narrowing to a subset), so it would ship as dead surface. In particular the
bulk-move partial-failure path MUST narrow via `selectOnly(failedKeys)` rather than subtracting
the succeeded keys — subtraction would wrongly retain any selected key that resolved to no window.

- **GIVEN** an empty selection
- **WHEN** `toggle("srv:@1")` is called
- **THEN** `selected` contains `"srv:@1"` and `anchor` is `"srv:@1"`
- **AND** calling `toggle("srv:@1")` again removes it from `selected`

#### R2: Pure selection logic lives in a dependency-free lib module
The range computation, single-server derivation, and prune derivation SHALL live in a pure,
dependency-free module `app/frontend/src/lib/selection.ts` so they are unit-testable without
mounting the tree. It SHALL export at least: `selectionKey(server, windowId)`,
`splitSelectionKey(key)`, `rangeBetween(orderedKeys, anchorKey, targetKey)`,
`singleSelectedServer(selectedKeys)`, and `pruneSelection(selectedKeys, liveKeys)`.

- **GIVEN** the ordered visible window-row keys `["s:@1","s:@2","s:@3","s:@4"]`
- **WHEN** `rangeBetween(keys, "s:@3", "s:@1")` is called (anchor after target)
- **THEN** it returns `["s:@1","s:@2","s:@3"]` — the inclusive contiguous range in visible order,
  direction-independent
- **AND** an anchor or target absent from `orderedKeys` yields `[]`

#### R3: Single-server derivation gates the bulk move
`singleSelectedServer(selectedKeys)` SHALL return the one server every selected key belongs to,
or `null` when the selection is empty or spans more than one server. tmux cannot move windows
across servers, so the bulk-move palette entries MUST NOT be offered for a cross-server selection.

- **GIVEN** a selection `{"a:@1","a:@2"}`
- **WHEN** `singleSelectedServer` is called
- **THEN** it returns `"a"`
- **AND** for `{"a:@1","b:@1"}` it returns `null`, and for `{}` it returns `null`

#### R4: Windows that leave the SSE data are pruned from the selection — collapse is not departure
`pruneSelection(selected, liveKeys)` SHALL drop any selected key absent from the live-key set,
returning the SAME set instance when nothing changed (so a caller can no-op cheaply on an SSE
tick). **Liveness SHALL derive from the session DATA (every window the SSE snapshot knows for the
rendered server groups, whether or not its session is expanded), never from the visible/rendered
row set** — a DOM/visible-row walk equates "not rendered" with "gone", so collapsing a session
would silently destroy the selection of its still-live windows (and `Select all merged`
deliberately selects windows inside collapsed sessions, which a visibility-keyed prune then wipes
on the next unrelated signature change). Collapsing/expanding a session SHALL NOT change the
selection or the anchor. The sidebar SHALL invoke the store's `prune` only when the data-derived
key-set signature changes — never on a passive SSE activity tick.

Because `registerGroupRows` bumps `rowsVersion` only when a SURVIVING group's signature changes,
a whole `ServerGroup` leaving the tree (the sessions-scope ALL→CURRENT switch, a server dropping
out of the SSE snapshot) would otherwise bump nothing and strand its rows' keys. The sidebar SHALL
therefore expose an `unregisterGroupRows(server)` unmount counterpart that drops the group's
identity slice + signature and bumps `rowsVersion`, wired from a `ServerGroup` effect keyed on
`[server]` alone (a cleanup on the registration effect itself would fire on every signature change,
double-bumping and briefly holing the identity map).

- **GIVEN** a selection `{"s:@1","s:@2"}` and live keys `{"s:@1"}`
- **WHEN** SSE reports `@2` gone and the data-derived key-set signature changes
- **THEN** the selection becomes `{"s:@1"}`
- **AND** when live keys still contain both, the identical set instance is returned (no state churn)
- **AND** when a whole server group unmounts, its keys (and a stale anchor pointing into it) are
  pruned while a surviving group's keys stay selected
- **GIVEN** a selection containing windows of an expanded session
- **WHEN** the user collapses that session (or collapses an unrelated session)
- **THEN** the selection and anchor are unchanged, and re-expanding shows the rows still selected

### Sidebar: Multiselect Tree Semantics

#### R5: The tree announces multi-selectability and selected rows
The `role="tree"` container SHALL carry `aria-multiselectable="true"`, and every window row that is
in the selection SHALL carry `aria-selected="true"` on its `role="treeitem"` element plus a visible
selected treatment drawn from the sidebar's existing row-styling vocabulary. Session and server
rows SHALL NOT be selectable and SHALL NOT carry `aria-selected`.

- **GIVEN** the sidebar tree is rendered
- **WHEN** a window row is added to the selection
- **THEN** its treeitem has `aria-selected="true"` and a visible selected treatment
- **AND** the tree container has `aria-multiselectable="true"`, and session rows never gain
  `aria-selected`

#### R6: Cmd/Ctrl-click toggles a window row into the selection without navigating
A Cmd/Ctrl-click on a window row SHALL toggle that row's membership in the selection and SHALL NOT
activate/navigate to the window. A plain (unmodified) click SHALL keep its existing
navigate-to-window behavior and SHALL clear any non-empty selection.

- **GIVEN** a window row that is not selected
- **WHEN** the user Cmd-clicks (or Ctrl-clicks) it
- **THEN** the row becomes selected, the anchor moves to it, and the route does not change
- **AND** a subsequent plain click on any row navigates and clears the selection

#### R7: Shift-click extends a contiguous range from the anchor
A Shift-click on a window row SHALL select the contiguous range of window rows between the current
anchor and the clicked row in visible-row order (the same `[role="treeitem"]` DOM-order walk the
roving navigation uses), without navigating. With no anchor, Shift-click SHALL behave as a plain
toggle and set the anchor.

- **GIVEN** rows `@1 @2 @3 @4` visible and `@1` selected as the anchor
- **WHEN** the user Shift-clicks `@3`
- **THEN** `@1`, `@2`, `@3` are all selected and the route does not change

#### R8: `x` toggles the focused window row's selection
Pressing `x` on a focused window row in the tree SHALL toggle that row's selection (identical
semantics to Cmd-click) and SHALL `preventDefault()`. On a session row `x` SHALL be a no-op. On a
ghost/optimistic row (`ghost` flag or empty `windowId`) `x` SHALL be a no-op, mirroring the existing
SF-3 activation guard. The tree keydown handler's existing early-return for `<input>`/`<textarea>`/
`contentEditable` targets SHALL continue to apply, so `x` typed into a rename input is never
hijacked.

- **GIVEN** the roving cursor is on window row `@2`
- **WHEN** the user presses `x`
- **THEN** `@2` becomes selected (`aria-selected="true"`) and the route does not change
- **AND** pressing `x` on a session row or inside a rename input changes nothing

#### R9: Escape clears a non-empty selection
Pressing `Escape` inside the tree with a non-empty selection SHALL clear the selection and
`preventDefault()`. With an empty selection `Escape` SHALL be a no-op (not `preventDefault()`ed), and
the inline rename inputs' own Escape handling (which fires on the input target, before the tree
handler's editable early-return can matter) SHALL keep precedence.

- **GIVEN** three window rows are selected
- **WHEN** the user presses `Escape` with focus inside the tree
- **THEN** the selection is empty and no row carries `aria-selected="true"`
- **AND** pressing `Escape` while renaming a row still cancels the rename, leaving the selection intact

#### R10: A minimal, non-interactive selection-count indicator
While the selection is non-empty the sidebar SHALL render a small non-interactive indicator
reporting the count plus the two hints (act via the palette, `Esc` to clear) — e.g.
`4 selected · ⌘K to act · Esc to clear`. It SHALL contain no buttons and no action strip; the
command palette is the sole action surface. It SHALL disappear when the selection empties.

- **GIVEN** two window rows are selected
- **WHEN** the sidebar renders
- **THEN** an indicator reading `2 selected` (with the ⌘K / Esc hints) is visible and holds no
  interactive controls
- **AND** clearing the selection removes the indicator

### Palette: Selection Commands

#### R11: Pure `palette-selection.ts` builder for the selection command family
A pure, dependency-free builder module `app/frontend/src/lib/palette-selection.ts` (mirroring
`palette-pin.ts` / `palette-move.ts`) with colocated `palette-selection.test.ts` SHALL compose the
selection command family. Action bodies are thin callbacks supplied by `app.tsx`. It SHALL export
`buildSelectAllMergedAction(...)` and `buildSelectionMoveActions(...)` (plus the derivation helper
`mergedWindowKeys(...)`), so label composition and eligibility gating are unit-tested without
mounting the shell.

- **GIVEN** the builder is called with no merged windows
- **WHEN** `buildSelectAllMergedAction` runs
- **THEN** it returns `null` (the command is omitted, not disabled)

#### R12: `Selection: Select all merged` selects the current server's merged windows
The palette SHALL offer `Selection: Select all merged (N)` when there is a current-server context
AND that server has ≥1 window whose `prState === "merged"`. Selecting it SHALL replace the
selection with exactly those windows' keys, scoped to the current server only. The command SHALL be
omitted when there is no current server or no merged windows.

- **GIVEN** the current server has 3 windows with `prState === "merged"` across two sessions
- **WHEN** the user runs `Selection: Select all merged (3)`
- **THEN** exactly those 3 window rows become selected and no other row does
- **AND** on a server with no merged windows the entry is absent from the palette

#### R13: One `Selection: Move N windows to <session>` entry per eligible target session
When the selection is non-empty AND all selected windows resolve to a single server, the palette
SHALL offer one entry per existing session on that server, labeled
`Selection: Move N window(s) to <session>` with the live count. Sessions that would make the move a
complete no-op (every selected window already lives in that session) SHALL be excluded. No
create-if-missing entry and no picker dialog SHALL be added — the palette's fuzzy filter is the
picker. Entries SHALL be absent when the selection is empty or spans multiple servers.

The target sessions and the move itself SHALL both belong to the **selection's** server
(`singleSelectedServer`), which is NOT necessarily the route server — with sessions scope `all`
the sidebar paints every server's groups, so a user can select rows on server A while routed to
server B, and tmux window ids (`@N`) are unique per server only. `buildSelectionMoveActions` SHALL
take the server its `sessions` argument belongs to as an explicit parameter and return `[]` on a
mismatch against the selection's own server, so a caller cannot silently re-key one server's
windows under another's. `app.tsx` SHALL pass the selection server's own session list
(the merged list when it is the route server, else `ctx.sessionsByServer.get(srv)`) and SHALL omit
the entries entirely when that server's sessions have not loaded.

- **GIVEN** 4 windows selected on server `s`, which has sessions `work`, `completed`
- **WHEN** the palette opens
- **THEN** entries `Selection: Move 4 windows to work` (if not all 4 already live there) and
  `Selection: Move 4 windows to completed` are offered
- **AND** with a cross-server selection no `Selection: Move …` entry is offered at all
- **AND** with a selection on server `a` while routed to server `b`, the entries list `a`'s
  sessions and the move POSTs against `a` — never `b`

### Execution: Bulk Move

#### R14: Bulk move issues N sequential POSTs to the existing endpoint
Executing a bulk move SHALL call the existing client fn `moveWindowToSession(server, windowId,
targetSession)` once per selected window, **sequentially** (awaiting each before the next). No
backend change, no new endpoint, no new client fn. No bulk optimistic/ghost-window machinery is
introduced — rows repaint from the SSE stream. The existing single-window optimistic
`executeMoveToSession` drag-and-drop path SHALL remain untouched.

- **GIVEN** 3 windows selected and a target session chosen
- **WHEN** the action runs
- **THEN** exactly 3 `POST /api/windows/{id}/move-to-session` requests are made, one at a time
- **AND** the moved rows appear under the target session on the next SSE snapshot

#### R15: Continue-on-error with an aggregate toast and a retry-friendly selection
A failed move SHALL NOT abort the remaining moves; failures are collected. On full success a
success toast `Moved N window(s) to <session>` SHALL be shown and the selection cleared. On partial
(or total) failure an error toast SHALL report the counts and the first error message — e.g.
`Moved 3 of 5 windows to completed — 2 failed: <first error>` — and the selection SHALL be reduced
to exactly the windows that failed, as the retry affordance.

The batch runs fire-and-forget behind an already-closed palette, so its terminal selection update
SHALL be RECONCILED against the keys the batch itself owned (`settleBatch`) rather than written
against the whole current store: a user who starts a NEW selection while a long batch is still
POSTing MUST NOT have it cleared or replaced by that batch's outcome.

- **GIVEN** 5 selected windows where 2 moves reject
- **WHEN** the bulk move completes
- **THEN** an error toast reports `3 of 5` with the failure count and the first error message
- **AND** exactly the 2 failed windows remain selected

### Non-Goals

- Any backend change — no new endpoints, no `createIfMissing` on move.
- Session-row or server-row selection.
- Bulk optimistic/ghost-window machinery; the single-window DnD optimistic path is untouched.
- Cross-server bulk move (tmux cannot move windows across tmux servers).
- A new dialog/picker component — the palette's per-session entries are the picker.
- Shift+ArrowUp/Down range extension (an intake MAY; `x` + shift-click is the required baseline).

### Design Decisions

#### Keyboard selection-toggle key is `x`, not Space
**Decision**: The focused-row selection toggle is `x`.
**Why**: `Enter` and `Space` are already bound to row activation in the tree keydown switch
(`sidebar/index.tsx`), so repurposing Space would break existing activation behavior. `x` is unbound
in the tree handler and is the well-precedented list-multiselect key (Gmail-style).
**Rejected**: Space — it already activates the row; rebinding it is a behavior regression for every
existing keyboard user.
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

#### Selection state lives in a dedicated store, not sidebar-local state
**Decision**: A small dedicated zustand store (`store/selection-store.ts`) owns the selection.
**Why**: The command palette is composed in `app.tsx` while the tree lives in
`components/sidebar/index.tsx`; both must read and write the selection. A shared store is the
project's established seam for exactly this (`window-store.ts`).
**Rejected**: Sidebar-local `useState` plus prop threading — the palette is not a descendant of the
sidebar, so it would require lifting state into `app.tsx` and threading a setter down through
`Sidebar` → `ServerGroup` → `WindowRow`, churning the memo contract those props exist to protect.
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

#### Bulk move is N sequential calls with continue-on-error, not a new bulk endpoint
**Decision**: The bulk action awaits one existing `move-to-session` POST per window in sequence and
collects failures rather than aborting.
**Why**: tmux window moves mutate session state serially and the endpoint is already serial-safe;
reusing it adds zero backend surface (Constitution IV). Each window's move is independent, so
aborting on the first error would strand the remaining windows for a likely-unrelated failure.
**Rejected**: A batch endpoint (new backend surface for no behavioral gain) and parallel `Promise.all`
(concurrent tmux session mutation, and a rejected promise loses the per-window outcome detail the
aggregate toast reports).
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

#### Escape-to-clear is a CAPTURE-phase handler on the tree
**Decision**: Escape-to-clear lives in a separate `onKeyDownCapture` handler on the
`role="tree"` container, not as a case in the existing bubble-phase `handleTreeKeyDown`.
**Why**: Each window row spreads the row-flyout card's floating-ui `referenceProps`, whose
`useDismiss` contributes an `onKeyDown` that `stopPropagation()`s Escape while the card is open —
and the card OPENS on keyboard row focus (`useFocus`), which is exactly the state a keyboard user
clearing a selection is in. A bubble-phase handler on the tree therefore never sees the key
(proven by e2e: the bubble version silently no-opped). Capture gives the tree first refusal.
The handler consumes the event ONLY when there is a selection to clear and only outside an
editable target, so the rename input's Escape-cancels and the flyout card's own Escape-dismiss
both still work (both verified green in `row-flyout.spec.ts` and `sidebar-keyboard-nav.spec.ts`).
**Rejected**: Disabling the flyout's `escapeKey` dismiss, or setting `escapeKeyBubbles` — that
would degrade the card's own documented Escape-dismiss contract for an unrelated feature.
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

#### Selection liveness comes from a DATA key registry, parallel to the visible-row one
**Decision**: Each `ServerGroup` registers two independent things with the sidebar: its VISIBLE-row
identity slice + signature (`registerGroupRows` → `rowsVersion`, which gates roving-key
normalization) and its DATA window-key set + signature (`registerGroupDataKeys` →
`dataKeysVersion`, which gates the selection prune). The data set is composed from `orderedSessions`
ignoring `collapsed`/`isOpen`, so it holds every real window the SSE snapshot knows for that server.
`unregisterGroupRows` drops both on unmount.
**Why**: The two consumers need different notions of "present". Roving navigation is inherently
about rendered rows. Selection is not: a window folded out of view is still a live tmux window the
user meant to select, and `Select all merged` deliberately selects windows inside collapsed
sessions. Keying the prune on visibility made every collapse a silent selection wipe. Both
signatures are strings over key sets, so neither counter bumps on the several-per-second passive SSE
activity ticks — the load-bearing "an SSE tick must not change tree state" invariant is preserved on
both paths, and a pure session reorder does not bump the data one (its parts are sorted).
**Rejected**: (a) Reusing `rowsVersion` for both — the defect above. (b) A `useEffect` watching
`sessionsByServer` in the sidebar — it re-runs on every tick and reintroduces the whole-Map watcher
churn a previous change deliberately removed; the per-group signature is what filters ticks out.
(c) Deriving live keys from the raw `sessionsByServer` prop at prune time — it lacks the optimistic
ghost/rename overlays the groups actually paint, so it would disagree with the rendered tree.
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

#### An async batch settles by RECONCILING against its own keys, not by clobbering the store
**Decision**: `executeBulkMove` ends with `settleBatch(batchKeys, failedKeys)` — a store action that
subtracts only the keys the batch owned and gave up, leaving every other key (and an anchor the user
moved elsewhere) untouched — rather than `clear()` / `selectOnly(failedKeys)`.
**Why**: The palette closes before the batch runs and the batch is fire-and-forget, so a slow move
races the user. `clear()` and `selectOnly()` act on whatever the store holds at settle time, so a
selection the user started mid-batch was silently destroyed by an operation that had nothing to do
with it. Scoping the write to the batch's own keys makes the outcome identical in the uncontended
case and correct in the contended one.
**Rejected**: An in-flight flag refusing a second batch — it treats a legitimate concurrent action as
an error, and it does not actually fix the race it is meant to guard (the user's new SELECTION, not a
second batch, is what gets clobbered). Reconciling handles both, and lets two disjoint batches settle
independently.
*Introduced by*: 260807-nf9f-sidebar-multiselect-move-windows

## Tasks

### Phase 1: Pure Logic + Store

- [x] T001 [P] Create `app/frontend/src/lib/selection.ts` — pure, dependency-free selection logic:
  `selectionKey(server, windowId)`, `splitSelectionKey(key)`, `rangeBetween(orderedKeys, anchorKey,
  targetKey)` (inclusive, direction-independent, `[]` on a missing endpoint),
  `singleSelectedServer(selectedKeys)` (`null` when empty or multi-server) and
  `pruneSelection(selected, liveKeys)` (same-instance return when unchanged). <!-- R2 R3 R4 -->
- [x] T002 [P] Create colocated `app/frontend/src/lib/selection.test.ts` covering range computation
  (both directions, endpoints missing, single-element), single-server derivation (empty / one /
  multi), key round-tripping (including a windowId containing `:`), and prune (drop, no-op
  same-instance, empty). <!-- R2 R3 R4 -->
- [x] T003 Create `app/frontend/src/store/selection-store.ts` — a zustand store following the
  `window-store.ts` pattern: `selected: ReadonlySet<string>`, `anchor: string | null`, and actions
  `toggle`, `select`, `selectOnly`, `deselect`, `setAnchor`, `clear`, `prune` (delegating range/prune
  math to `lib/selection.ts`). <!-- R1 R4 -->
- [x] T004 Create colocated `app/frontend/src/store/selection-store.test.ts` covering toggle on/off +
  anchor movement, `selectOnly` replacing the set, `deselect`, `clear`, and `prune` dropping dead
  keys while leaving state untouched when nothing changed. <!-- R1 R4 -->

### Phase 2: Palette Builder

- [x] T005 Create `app/frontend/src/lib/palette-selection.ts` — pure builder exporting
  `mergedWindowKeys(server, sessions)`, `buildSelectAllMergedAction(server, sessions, onSelectAll)`
  (returns `null` with no server or no merged windows; label carries the live count) and
  `buildSelectionMoveActions(server, sessionNames, selectedKeys, currentSessionOfKey, onMove)` (one
  entry per eligible session, complete-no-op targets excluded, empty when the selection is empty or
  cross-server, labels carry the live count with correct singular/plural). <!-- R11 R12 R13 -->
- [x] T006 Create colocated `app/frontend/src/lib/palette-selection.test.ts` covering merged-key
  derivation from window PR data, the hidden-when-empty/hidden-when-no-server cases, per-session
  entry composition + no-op-target exclusion, cross-server gating, and singular/plural labels. <!-- R11 R12 R13 -->

### Phase 3: Sidebar Wiring

- [x] T007 Wire multiselect into `app/frontend/src/components/sidebar/index.tsx`: subscribe to the
  selection store, add `aria-multiselectable="true"` to the `role="tree"` container, add the `x` and
  `Escape` cases to `handleTreeKeyDown` (ghost/session no-op guards, `preventDefault`), add the
  modifier-aware row-click handler (`cmd/ctrl` toggle, `shift` range over the DOM-order window-row
  keys, plain click navigates and clears), and prune the selection from the existing `rowsVersion`
  signal.
  <!-- rework cycle 2 (requirements revised): R4 was wrong — prune liveness derived from getVisibleWindowKeys()' DOM walk, equating "not rendered" with "gone": collapsing a session destroys the selection of its still-live windows (verified: select primary:@0, collapse its session ⇒ selected [] anchor null), and Select-all-merged keys inside collapsed sessions get wiped by the next unrelated signature change. Re-implement the prune's live-key source from session DATA (every window the SSE snapshot knows for rendered server groups, expanded or not) per revised R4; collapse/expand must not touch selection or anchor. Keep the group-unmount unregister behavior. Update the cycle-1 unmount tests if they assumed visibility-keyed liveness, and add collapse-survival coverage. --> <!-- R5 R6 R7 R8 R9 R4 --> <!-- rework: review must-fix 2 — pruning gated on rowsVersion never fires when a whole ServerGroup unmounts (sessions-scope ALL→CUR switch, server disappearing): registerGroupRows has no unregister-on-unmount counterpart, so stale keys survive in the selection (violates R4/A-004/A-022). Unregister the group's slice + signature on ServerGroup unmount and bump rowsVersion. --> <!-- reworked: added `unregisterGroupRows(server)` beside registerGroupRows (drops the group's signature + identity slice, bumps rowsVersion), threaded it as a ServerGroup prop, and wired it from a cleanup-only effect keyed on `[server]` alone so it fires on real unmount rather than on every signature change. --> <!-- reworked (cycle 2): prune liveness is now DATA-derived. A second, independent registry sits beside the visible-row one: each ServerGroup composes `dataKeys`/`dataSignature` from `orderedSessions` IGNORING `collapsed`/`isOpen` (real windows only — ghosts excluded; signature sorted so a pure reorder does not bump) and registers them via the new `registerGroupDataKeys` prop. The parent holds `groupDataKeysRef`/`groupDataSignatureRef` + a separate `dataKeysVersion` counter, and the prune effect is re-gated from `rowsVersion` to `dataKeysVersion`, pruning against `getLiveWindowKeys()` (the union of every rendered group's data keys). Collapse/expand changes no data key, so it bumps nothing and touches neither selection nor anchor; `unregisterGroupRows` now drops BOTH slices and bumps both counters, preserving the cycle-1 unmount behavior. `getVisibleWindowKeys()` is retained — it still (correctly) orders the shift-click range by VISIBLE order. Also removed the dead `setSelectionAnchor(selectionAnchor)` self-assignment in `extendSelectionTo` and its now-unused store subscription (plan Deletion Candidate). Tests: the 3 cycle-1 unmount cases still pass unchanged (they assert genuine departure, not visibility); added `Sidebar — selection survives collapse/expand` (own-session collapse keeps selection+anchor and re-expand shows the row still `aria-selected`; a key inside an ALREADY-collapsed session survives an unrelated session's collapse; a genuinely killed window still prunes, anchor included) — the first two verified RED against the pre-fix visibility-keyed prune. Plus an e2e case driving the same collapse/re-expand against real tmux. -->
- [x] T008 Add the selected-row treatment to
  `app/frontend/src/components/sidebar/window-row.tsx`: an `isSelectedForBulk` prop driving
  `aria-selected` on the treeitem plus a visible treatment consistent with the row-styling
  vocabulary, and an `onRowClick`-style modifier-aware click seam (identity-arg, memo-safe). <!-- R5 R6 R7 -->
- [x] T009 Add the minimal non-interactive selection-count indicator to the sidebar (count + ⌘K/Esc
  hints), rendered only while the selection is non-empty. <!-- R10 -->

### Phase 4: Palette + Execution Wiring

- [x] T010 Wire the selection palette actions into `app/frontend/src/app.tsx`: a
  `selectionActions: PaletteAction[]` memo composing `buildSelectAllMergedAction` +
  `buildSelectionMoveActions` from the pure builder, folded into the `paletteActions` array. <!-- R11 R12 R13 --> <!-- rework: review must-fix 1 — move actions must derive the server from the SELECTION (singleSelectedServer), not the current route server: pass that server's session list (ctx.sessionsByServer.get(srv)) to buildSelectionMoveActions and omit entries when that server's sessions aren't loaded (violates R13/R14; with sessions scope "all" a user can select rows on server A while routed to server B). Also review should-fix 3 — make the `x` toggle (and cmd/shift-click gestures) user-discoverable via the palette registration and/or the count-indicator hint text (A-032 + project review rule). --> <!-- reworked: the memo now derives `selectionServer = singleSelectedServer(selectedWindows)` and feeds THAT server's sessions (merged list when it is the route server, else ctx.sessionsByServer.get(srv)), omitting the entries when undefined (not loaded). `buildSelectionMoveActions` additionally gained an explicit `sessionsServer` first parameter and refuses a mismatch, so the wrong-server feed cannot silently re-key ids. Discoverability: SELECTION_GESTURE_HINT ("x · ⌘-click · ⇧-click") rides the select-all entry's `shortcut` badge, and the count indicator now reads "N selected · x to toggle · ⌘K to act · Esc to clear". -->
- [x] T011 Implement the bulk-move executor in `app.tsx`: N sequential `moveWindowToSession` awaits,
  continue-on-error with collected failures, aggregate success/error toast via `addToast`, selection
  cleared on full success and reduced to the failed keys on partial failure.
  <!-- rework cycle 2 (should-fix): executeBulkMove is fire-and-forget with no in-flight guard and the palette closes before it runs — a user starting a NEW selection during a long batch has it clobbered by the batch's terminal clearSelection()/selectOnlySelection(failedKeys) against the CURRENT store. Guard with an in-flight flag or reconcile the terminal update against the keys the batch actually owned (app.tsx:2046-2064). --> <!-- R14 R15 --> <!-- rework: review must-fix 1 (same root cause as T010) — executeBulkMove must POST against the selection-derived server, never the route server. Also review should-fix 4 — selection-store `deselect` has zero production call sites: wire it where natural (e.g. partial-failure retain path) or amend R1 to drop it. --> <!-- reworked: executeBulkMove is now invoked with `selectionServer` rather than the route `server`, so the POSTs target the selection's tmux server. `deselect` resolved by DROPPING it (R1 amended): the partial-failure path correctly uses `selectOnly(failedKeys)` — subtracting the succeeded keys instead would wrongly retain keys that resolved to no window — and every other removal path is covered by toggle/clear/prune. Removed from the store, its type, and its unit tests. --> <!-- reworked (cycle 2): the terminal selection update now RECONCILES against the keys the batch owned instead of clobbering the store. New store action `settleBatch(batchKeys, retainKeys)` subtracts only the batch's own given-up keys (batchKeys minus retainKeys) from whatever the store currently holds, leaving every key the batch did not own untouched, and drops the anchor only when it pointed at one of those removed keys. `executeBulkMove` calls `settleBatch(keys, failedKeys)` in place of `clearSelection()` / `selectOnlySelection(failedKeys)`. Behavior in the uncontended case is unchanged (full success empties, partial failure leaves exactly the failed keys, total failure is a no-op write per A-025); the contended case no longer destroys a selection the user started mid-batch. Chose reconcile over an in-flight lock: a lock would refuse a second legitimate batch, whereas reconciling lets two disjoint batches both settle correctly. 6 new store unit tests, two of which assert the race directly. -->

### Phase 5: Tests

- [x] T012 Add the Playwright e2e spec `app/frontend/tests/e2e/sidebar-multiselect.spec.ts` covering
  cmd-click + shift-click + `x` selection, Escape clear, the count indicator, and the palette
  `Selection: Move N windows to <session>` flow moving real tmux windows on the isolated e2e server
  with SSE repaint of the moved rows. <!-- R5 R6 R7 R8 R9 R10 R13 R14 -->
- [x] T013 Add the sibling companion doc `app/frontend/tests/e2e/sidebar-multiselect.spec.md` (same
  commit, per the constitution's Test Companion Docs rule) documenting what each test proves plus
  numbered steps and the shared setup. <!-- R5 R6 R7 R8 R9 R10 R13 R14 -->
- [x] T014 Run `just test-frontend` (Vitest) and `just test-e2e "sidebar-multiselect"`; fix failures. <!-- R1 R2 R3 R4 R11 R12 R13 R14 R15 --> <!-- rework cycle 2: re-run after the collapse-survival prune fix + in-flight batch guard; add unit coverage proving collapse/expand leaves selection+anchor untouched and that a killed window still prunes. --> <!-- rework: re-run after the cycle-1 fixes; add unit coverage for the cross-server derivation (must-fix 1) and group-unmount pruning (must-fix 2) so the fixed paths are test-detected. --> <!-- reworked: `just test-frontend` 126 files / 2348 tests green (one run tripped the known @xterm graphemes "Data error" import flake; clean on rerun). `just test-e2e "sidebar-multiselect"` 5/5 green including the real two-POST bulk move. Added coverage: palette-selection.test.ts `cross-server derivation` (4 cases — same-server build, mismatched-server refusal, same-id-different-server refusal, no-overlap keeps all targets) plus a shortcut-badge assertion; sidebar/index.test.tsx `selection pruning on ServerGroup unmount` (3 cases — ALL→CUR prune, surviving-group keys retained, stale anchor dropped). All 3 unmount cases verified RED against the pre-fix code. --> <!-- reworked (cycle 2): `just test-frontend` 126 files / 2357 tests green; `npx tsc --noEmit` clean; `just test-e2e "sidebar-multiselect"` 6/6 green (the added collapse-survival case plus the real two-POST bulk move). New coverage: selection-store.test.ts `settleBatch` (6 cases — succeeded-keys dropped leaving the failed ones, full-success empty, total-failure no-op write, does NOT clobber a new selection built mid-batch, does NOT re-add its failed keys over a new selection, anchor dropped only for its own removed keys); sidebar/index.test.tsx `selection survives collapse/expand` (3 cases — own-session collapse keeps selection+anchor and re-expand still `aria-selected`, a key inside an already-collapsed session survives an unrelated collapse, a genuinely killed window still prunes with its anchor). The two collapse cases verified RED against the pre-fix visibility-keyed prune. The e2e spec gained a matching case and its `.spec.md` companion entry (constitution Test Companion Docs). The `index.test.tsx` render helper was split into `sidebarTree()` + `renderSidebar()`/`rerenderSidebar()` so a test can simulate an SSE snapshot change without remounting. -->

## Execution Order

- T001 blocks T002, T003, T005 (the pure logic is the shared dependency)
- T003 blocks T004, T007, T010, T011
- T005 blocks T006, T010
- T007 blocks T008, T009 (the sidebar owns the props the row consumes)
- T010 blocks T011
- T012/T013 follow all implementation tasks; T014 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A dedicated selection store exists at `store/selection-store.ts` with the composite-key
  `selected` set, an `anchor`, and the toggle/select/selectOnly/clear/prune actions
  (`deselect` and `setAnchor` both dropped per the amended R1 — no production call site), plus the rework-2
  addition `settleBatch(batchKeys, retainKeys)` for scoping an async batch's terminal update to the
  keys it owned.
- [x] A-002 R2: `lib/selection.ts` is pure and dependency-free (no React, no zustand, no API imports)
  and exports the key, range, single-server, and prune helpers.
- [x] A-003 R3: `singleSelectedServer` returns the single server for a same-server selection and `null`
  for an empty or cross-server one.
- [x] A-004 R4: Selected keys for windows that leave the SSE data are pruned, and pruning is driven
  by the DATA key-set signature change, not by a per-SSE-tick effect and not by visibility.
  **MET (rework 2)**: Liveness is now derived from session DATA. Each `ServerGroup` composes
  `dataKeys`/`dataSignature` from `orderedSessions` ignoring `collapsed`/`isOpen` and registers them
  via `registerGroupDataKeys`; the parent prunes against the union (`getLiveWindowKeys()`) gated on a
  dedicated `dataKeysVersion` that bumps only when a group's data key set changes. A collapse/expand
  changes no data key, so it bumps nothing — selection and anchor are untouched — while a killed
  window and a whole-group unmount both still prune (`unregisterGroupRows` drops both slices and
  bumps both counters). Passive SSE activity ticks still never reach the prune (the signature is a
  string over the key set, not the snapshot identity). Covered by `sidebar/index.test.tsx`
  "selection pruning on ServerGroup unmount" (3 cases, unchanged) and "selection survives
  collapse/expand" (3 cases, two verified RED pre-fix), plus an e2e collapse-survival case.
  **VERIFIED (review 3)**: independently re-ran the two collapse cases against a re-introduced
  visibility-keyed prune — both go RED, confirming they are genuine regression guards rather than
  vacuous assertions. Also probed two paths the suite does not cover, both correct: a full sidebar
  unmount/remount (the Shell collapse toggle fully unmounts `<Sidebar/>`) preserves selection +
  anchor, and a window killed *while the sidebar was closed* is correctly pruned on remount.
- [x] A-005 R5: The tree container carries `aria-multiselectable="true"`; selected window rows carry
  `aria-selected="true"` with a visible treatment; session/server rows never do.
- [x] A-006 R6: Cmd/Ctrl-click toggles a window row's selection without navigating; a plain click still
  navigates and clears the selection.
- [x] A-007 R7: Shift-click selects the inclusive contiguous range from the anchor in visible-row order
  without navigating.
- [x] A-008 R8: `x` on a focused window row toggles its selection; it is a no-op on session and
  ghost rows and is not hijacked from rename inputs.
- [x] A-009 R9: Escape clears a non-empty selection and leaves the rename-cancel contract intact.
- [x] A-010 R10: A non-interactive count indicator with the ⌘K/Esc hints shows while the selection is
  non-empty and disappears when it empties.
  **NOTE (review 3)**: met on the server/terminal routes. On the **board route** the indicator (and
  the selection gestures) still render — `Sidebar` enables them unconditionally and `BoardPage`
  mounts it with `currentServer={null}`, which falls back to painting every server's groups — but
  `BoardPage` composes its own `boardRouteActions` palette (DD-8: AppShell's palette never mounts
  there) and does not include `selectionActions`. So a board-route user can build a selection and
  read `⌘K to act`, then find no `Selection:` entry in the palette. Recorded as a should-fix; the
  plan never scoped the board route, so this is a gap to decide on (wire the actions into
  `boardRouteActions`, or suppress the selection affordances there) rather than a broken requirement.
- [x] A-011 R11: `lib/palette-selection.ts` is a pure builder with a colocated test; the action bodies
  are caller-supplied callbacks.
- [x] A-012 R12: `Selection: Select all merged (N)` appears only with a current server and ≥1 merged
  window, and selects exactly the current server's merged windows.
  **MET (rework 2)**: The builder was already correct in isolation (`palette-selection.test.ts`
  green) — it derives keys from the merged SESSION DATA, so it includes merged windows in collapsed
  sessions. Those keys now survive: A-004's prune is data-derived, so a subsequent visible-row
  change no longer wipes them. Directly covered by the `sidebar/index.test.tsx` case "keeps a key
  that sits INSIDE a collapsed session when an UNRELATED session collapses" — the exact shape the
  headline "Select all merged → Move to session" flow depends on.
- [x] A-013 R13: One `Selection: Move N window(s) to <session>` entry per eligible target session, with
  live counts, no-op targets excluded, and no entries for an empty or cross-server selection.
  **MET (rework 1)**: `app.tsx` derives `selectionServer = singleSelectedServer(...)` and passes that
  server's own session list (merged when it is the route server, else `ctx.sessionsByServer.get`),
  omitting the entries when it has not loaded. `buildSelectionMoveActions` also takes an explicit
  `sessionsServer` and returns `[]` on a mismatch, so a wrong-server feed cannot re-key `@N` ids.
- [x] A-014 R14: The bulk move issues one sequential `moveWindowToSession` call per selected window and
  adds no backend surface, no new client fn, and no bulk optimistic machinery.
  **MET (rework 1)**: `executeBulkMove` is invoked with `selectionServer`, so the POSTs target the
  selection's tmux server rather than the route server.
- [x] A-015 R15: Partial failure continues through the batch, reports counts + the first error in one
  toast, and leaves exactly the failed windows selected.
  **MET (rework 2 refinement)**: the terminal update is now scoped to the keys the batch owned
  (`settleBatch`), so the uncontended outcome is unchanged — subtracting the succeeded keys from the
  batch's own selection leaves precisely the failed ones — while a selection the user started
  during a long batch is no longer clobbered.
  **VERIFIED (review 3)**: probed the race boundary directly. A new selection **disjoint** from the
  batch's keys is fully preserved, which is the case R15's second paragraph specifies. One residual
  remains, inherent to the subtract-only choice in Assumption 21: if the user clears mid-batch and
  deliberately **re-selects a window the batch itself owned**, that key is still subtracted at
  settle time (the store cannot distinguish the new membership from the batch-owned one). Recorded
  as a should-fix, not a must-fix — R15 requires only that a new selection not be "cleared or
  replaced", which holds; closing the overlap case needs a per-key generation/epoch stamp.

### Behavioral Correctness

- [x] A-016 R6: The existing plain-click navigation and the existing single-window drag-and-drop
  optimistic `executeMoveToSession` path behave exactly as before this change.
- [x] A-017 R8: The tree keydown handler's existing Enter/Space activation, arrow navigation, and
  editable-target early-return are unchanged by the added `x`/`Escape` cases.

### Scenario Coverage

- [x] A-018 R2: Vitest unit tests cover range computation (both directions, missing endpoints),
  single-server derivation, and prune (including the unchanged-instance case).
- [x] A-019 R13: Vitest unit tests cover the palette builder's gating, exclusion, and label composition.
- [x] A-020 R14: A Playwright e2e spec exercises selection (cmd-click, shift-click, `x`), Escape clear,
  and the palette bulk move against real tmux windows with SSE repaint.
- [x] A-021 R14: The e2e spec ships with its sibling `.spec.md` companion doc in the same commit.

### Edge Cases & Error Handling

- [x] A-022 R4: A killed/moved window's key does not linger in the selection, and a merely-hidden
  one is not pruned.
  **MET (rework 2)**: Both directions hold. Lingering: a killed window drops out of its group's
  DATA key set (covered by "still prunes a window that genuinely leaves the SSE data"), and a whole
  departed group drops via `unregisterGroupRows` (3 unmount cases); the stale anchor goes with the
  key in both. Over-eagerness: the prune no longer keys on visibility, so a collapsed-away but
  still-live window keeps its selection (see A-004). "Gone" and "hidden" are now distinguished by
  the data/visible registry split.
- [x] A-023 R8: Ghost/optimistic rows (no real `windowId`) cannot be selected via click or `x`.
- [x] A-024 R13: A target session that already contains every selected window is not offered.
- [x] A-025 R15: A total-failure batch surfaces the error toast and leaves the whole selection intact.

### Code Quality

- [x] A-026 Pattern consistency: New code follows the naming and structural patterns of surrounding
  code (`lib/palette-*.ts` pure builders with colocated tests, `store/*.ts` zustand shape,
  identity-arg `useCallback` handlers preserving the sidebar memo contract).
- [x] A-027 No unnecessary duplication: The existing `moveWindowToSession` client fn, `entryKey`
  composite-key convention, `addToast`, and `prDotState`/`prState` PR knowledge are reused rather than
  reimplemented.
- [x] A-028 Type narrowing over type assertions: New frontend code prefers `if` guards and
  discriminated unions over `as` casts.
- [x] A-029 No client polling: Row repaint after a bulk move comes from the SSE stream — no
  `setInterval` + fetch is introduced.
- [x] A-030 No god functions: No new function exceeds the codebase's typical size without clear reason;
  pure logic is extracted to `lib/` rather than inlined into the sidebar or `app.tsx`.
- [x] A-031 Tests accompany behavior: The added/changed behavior is covered by colocated Vitest units
  plus a Playwright e2e (code-quality.md: new features MUST include tests; UI changes SHOULD include
  e2e).
- [x] A-032 Keyboard shortcut documented in the palette registration: the new `x` toggle is documented
  at the palette-registration seam per the project review rule.
  **MET (rework 1)**: Surfaced to the user in two places — `SELECTION_GESTURE_HINT`
  (`x · ⌘-click · ⇧-click`) rides the `Selection: Select all merged` entry's `shortcut` badge, which
  the palette renders as a `<kbd>`; and the count indicator reads
  `N selected · x to toggle · ⌘K to act · Esc to clear`. Deliberately NOT added to
  `DEFAULT_BINDINGS` — that registry is for modifier chords, and registering a bare `x` there would
  hijack the key app-wide rather than inside the focused tree.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- ~~`app/frontend/src/store/selection-store.ts` (`deselect`)~~ — **RESOLVED (rework 1)**: dropped from the store, its action type, and its unit tests, and R1 amended to stop mandating it. Verified absent in review 2. Removal (not wiring) was the correct resolution: the partial-failure path must narrow via `selectOnly(failedKeys)` — subtracting the succeeded keys would wrongly retain any selected key that resolved to no window — and toggle/clear/prune already cover every other removal path.
- ~~`app/frontend/src/components/sidebar/index.tsx:1057` (`setSelectionAnchor(selectionAnchor)`)~~ — **RESOLVED (rework 2)**: the self-assignment inside `extendSelectionTo` and its now-unused `setAnchor` subscription are deleted; the comment now states that `select()` itself leaves the anchor untouched. Verified absent in review 3.
- ~~`app/frontend/src/store/selection-store.ts:67,154` (`setAnchor`)~~ — **RESOLVED (PR review, Copilot)**: verifiably dead surface — zero production call sites (the only two consumers, `sidebar/index.tsx` and `app.tsx`, subscribe to `selected`/`anchor`/`toggle`/`select`/`selectOnly`/`clear`/`prune`/`settleBatch` and never `setAnchor`) and zero test coverage. Resolved the same way `deselect` was in rework 1: the action and its type are deleted, R1 and A-001 amended, and the `selectOnly` doc comment records why no consumer ever needed a standalone anchor write.
- None otherwise — this change adds new frontend surface (selection store, pure lib, palette builder, sidebar gestures) without superseding existing code. The single-window drag-and-drop optimistic `executeMoveToSession` path is deliberately retained (plan Non-Goals), and `moveWindowToSession` / `entryKey` / `addToast` / `prState` are reused rather than duplicated.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Selection store lives at `store/selection-store.ts`; pure logic at `lib/selection.ts`; palette builder at `lib/palette-selection.ts` | The intake names all three paths verbatim; the project convention (`window-store.ts`, `lib/palette-*.ts` + colocated test) determines the shapes | S:95 R:85 A:95 D:95 |
| 2 | Certain | Bulk move reuses `moveWindowToSession` (client.ts) sequentially with no backend change | Intake decision 5/6 (Certain) plus verified handler + client fn; nothing under-specified | S:95 R:80 A:95 D:95 |
| 3 | Certain | Palette label prefix is `Selection:` (`Selection: Select all merged (N)`, `Selection: Move N windows to <session>`) | The intake's own examples use the `Selection:` prefix, matching the established `Board:` / `View:` / `Window:` palette vocabulary | S:85 R:90 A:90 D:85 |
| 4 | Confident | Selection pruning is driven by a per-group set-signature counter (not an SSE watcher); after rework 2 that counter is a DEDICATED `dataKeysVersion` over DATA keys, not the visible-row `rowsVersion` | The intake requires pruning but names no mechanism. The signature-counter shape is right (it filters out the several-per-second passive ticks and preserves the "SSE tick must not change tree state" invariant); reusing the VISIBLE-row counter was the wrong signal, since it also fires on collapse/expand where nothing departed | S:55 R:80 A:90 D:75 |
| 5 | Confident | A plain (unmodified) click on a window row clears a non-empty selection in addition to navigating | The intake specifies modifier behavior but not the plain-click case; clearing on a plain click is the universal file-manager/list convention and keeps the selection from silently outliving the user's attention. Escape remains the explicit clear | S:40 R:85 A:75 D:65 |
| 6 | Confident | `singleSelectedServer` returns `null` (not a throw) for a cross-server selection, and the move entries are simply omitted | The intake says entries "appear only when … single server" — omission is the stated behavior, and the palette family already omits rather than disables (buildPinActions, buildViewActions) | S:70 R:90 A:90 D:80 |
| 7 | Confident | Labels use singular/plural correctly (`Move 1 window to …` / `Move 4 windows to …`) | The intake's examples show only the plural; matching grammar to the live count is the obvious refinement and is trivially unit-testable | S:50 R:95 A:85 D:80 |
| 8 | Confident | The selection-count indicator renders in the sidebar between the tree and the bottom panels, following the sidebar's existing footer/indicator styling vocabulary | The intake specifies content and non-interactivity but leaves placement to "the sidebar's existing footer/indicator vocabulary"; directly under the scrollable tree is where a transient status strip reads without displacing the pinned panels, and it is trivially relocatable | S:45 R:95 A:70 D:55 |
| 9 | Confident | On a total-failure batch (0 succeeded) the whole selection stays selected and the error toast still reports `0 of N` | Follows directly from the intake's continue-on-error + failed-windows-stay-selected rule; the total-failure case is just its limit and needs no special branch | S:60 R:90 A:85 D:80 |
| 10 | Confident | Merged detection uses `win.prState === "merged"` directly rather than `prDotState(win) === "merged"` | The intake names both; they agree for the merged case (`prDotState` returns `"merged"` iff `prState === "merged"`), and the direct field read is the narrower, dependency-free predicate the pure builder needs | S:65 R:90 A:90 D:75 |
| 11 | Certain | `deselect` is DROPPED from the store (R1 amended) rather than wired into the partial-failure path | The review offered either resolution explicitly. Wiring it would be wrong, not merely redundant: the partial-failure path must REPLACE the selection with the failed keys (`selectOnly`), because subtracting the succeeded keys would retain any selected key that resolved to no window at all. With toggle/clear/prune covering every other removal, no correct call site exists | S:90 R:85 A:95 D:90 |
| 12 | Confident | `buildSelectionMoveActions` gains an explicit `sessionsServer` parameter and refuses a mismatch, rather than trusting app.tsx to feed the right list | Fixing only the call site would leave the builder silently re-keying ANY caller's sessions under the selection's server — which is exactly how the original defect produced plausible-looking wrong targets. A cheap equality guard makes the contract enforceable at the seam and is directly unit-testable; the cost is one extra argument at the single call site | S:60 R:85 A:85 D:75 |
| 13 | Confident | The selection's sessions are read as the MERGED list when the selection is on the route server, else the raw `ctx.sessionsByServer.get(srv)` | `useMergedSessions` is a hook scoped to the current server and cannot be called per-server, so the merged overlays (ghost/rename) are only available for the route server. Preferring merged where available and falling back to raw elsewhere keeps the common same-server case exact while still supporting the cross-server case, and the raw list is what the sidebar's other cross-server reads already use | S:55 R:85 A:85 D:70 |
| 14 | Confident | An unloaded selection-server session list (`undefined`) omits the move entries entirely rather than treating it as empty | The review named the omit behavior. It is also the safer branch: an empty array would render "no eligible targets" as an affirmative answer, whereas the truth is "not known yet" — and the family's convention is to omit rather than mislead | S:70 R:90 A:85 D:80 |
| 15 | Confident | The `x` toggle is surfaced via the palette entry's `shortcut` badge + the count-indicator hint, NOT by registering it in `DEFAULT_BINDINGS` | The project review rule asks for documentation at the palette registration, and `PaletteAction.shortcut` is the existing seam the palette already renders as a `<kbd>`. `DEFAULT_BINDINGS` is a modifier-chord registry driving a window-level dispatcher; registering a bare `x` there would hijack the key app-wide instead of inside the focused tree — a behavior change, not documentation | S:65 R:80 A:90 D:80 |
| 16 | Confident | The unregister runs from a SEPARATE ServerGroup effect keyed on `[server]` alone, not as a cleanup on the existing registration effect | A cleanup on the registration effect would fire on every signature change (its deps include `rowSignature`/`rowSlice`), producing an unregister→re-register churn that double-bumps `rowsVersion` and briefly holes the identity map mid-update. Keyed on `[server]` the cleanup runs only on real unmount, which is precisely the uncovered case | S:60 R:80 A:90 D:80 |
| 17 | Certain | Data-derived liveness is registered by each ServerGroup as a SECOND registry (`registerGroupDataKeys` + `dataKeysVersion`) rather than derived in the sidebar from the raw `sessionsByServer` prop | The revised R4 mandates data-derived liveness but not the seam. The group is the only place the MERGED session data lives (`useMergedSessions` is applied per-group, and raw `sessionsByServer` lacks the ghost/rename overlays the group actually paints), so a sidebar-level derivation would disagree with the rendered tree. Registering mirrors the existing `registerGroupRows` pattern exactly, and reuses its unmount counterpart | S:85 R:80 A:95 D:85 |
| 18 | Confident | The prune gets its OWN version counter (`dataKeysVersion`) instead of continuing to share `rowsVersion` | Sharing is what produced the defect: `rowsVersion` intentionally bumps on collapse/expand because roving normalization needs it, and any consumer riding it inherits that semantics. A second counter costs one `useReducer` and makes each consumer's trigger say what it means. Bumping `rowsVersion` from data changes instead would wake roving normalization spuriously | S:70 R:85 A:90 D:80 |
| 19 | Confident | The data signature is SORTED, so a pure session/window reorder does not bump the prune counter | A reorder moves no window in or out of the snapshot, so it is not a liveness event; an order-sensitive signature would run a pointless prune on every drag-reorder. Sorting is a one-line cost with no downside — the signature is only ever compared for equality, never read for order (the shift-click range still reads VISIBLE order from the DOM) | S:60 R:90 A:90 D:85 |
| 20 | Confident | The batch's terminal selection update reconciles via a new `settleBatch(batchKeys, retainKeys)` store action rather than an in-flight lock | The review offered either. Reconciling is strictly better: a lock refuses a legitimate second batch AND does not fix the actual race (the user's new SELECTION is what gets clobbered, not a competing batch). `settleBatch` keeps the uncontended behavior byte-identical while making the write scoped, and it is directly unit-testable without timing | S:70 R:85 A:90 D:75 |
| 21 | Confident | `settleBatch` is SUBTRACT-ONLY — it never re-adds its retained (failed) keys over whatever the store now holds | Re-adding would resurrect keys the user explicitly dismissed if they cleared mid-batch, trading one clobber for another. Subtract-only yields the R15 retry affordance exactly in the uncontended case (the failed keys are simply the ones not subtracted) and defers to the user's intent in the contended one | S:55 R:85 A:85 D:70 |

21 assumptions (5 certain, 16 confident, 0 tentative).
