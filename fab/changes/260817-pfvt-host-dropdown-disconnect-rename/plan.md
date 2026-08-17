# Plan: Host-Switcher Dropdown Per-Row Disconnect & Rename

**Change**: 260817-pfvt-host-dropdown-disconnect-rename
**Intake**: `intake.md`

## Requirements

### Desktop Store: Host Name Mutator

#### R1: `setHostName` id-keyed store mutator
`app/desktop/src/hosts.ts` SHALL export `setHostName(dir: string, id: string, name: string): HostList` following the `setHostLastPath` shape exactly: load → membership guard (unknown `id` is a no-op that writes nothing) → patch → atomic `saveHosts`, with a short-circuit that writes nothing when the trimmed value is empty or equals the current name. The stored name SHALL be the trimmed input (the `addHost` convention). No schema change — `name` is already a required v1 field, and entries stay keyed on the immutable `id`.

- **GIVEN** a hosts.json with an entry `{id: "x", name: "old"}`
- **WHEN** `setHostName(dir, "x", "  new  ")` is called
- **THEN** the persisted entry's name is `"new"` and every other field (`activeId`, `lastPath`, `accentColor`, `remote`, list order) is byte-identical

- **GIVEN** the same store
- **WHEN** called with an unknown id, an empty/whitespace-only name, or the unchanged current name
- **THEN** nothing is written (no file rewrite) and the returned list equals the loaded one

### Desktop IPC: `servers:remove` + `servers:rename`

#### R2: `servers:remove` channel routes into `confirmAndRemoveHost`
`app/desktop/src/main.ts` SHALL register an `isHostsSender`-gated `servers:remove` handler taking the host id as a plain **string** payload (the `servers:switch` shape). A non-string payload SHALL return `{ ok: false, error: "Invalid request" }`; an ungated sender `{ ok: false, error: "Not allowed" }`. Otherwise the handler SHALL `await confirmAndRemoveHost(id)` — the same single path the native `Hosts → Remove "<name>"…` item calls (native confirm dialog with Cancel as default, store removal, view destruction, `rebuildMenu()`, active-host fallback to first-remaining-or-welcome) — and resolve `{ ok: true }`. User-cancel and unknown id both resolve `{ ok: true }` (cancel is a successful no-op, matching the reorder handler's unknown-id-is-ok convention). No removal logic is added to `confirmAndRemoveHost` itself.

- **GIVEN** a registered-host sender and a registered background host id
- **WHEN** `servers:remove` is invoked and the user confirms the native dialog
- **THEN** the entry leaves hosts.json, its view is destroyed, the native menu rebuilds, and the handler resolves `{ ok: true }`

- **GIVEN** the same invocation
- **WHEN** the user cancels the dialog
- **THEN** nothing changes and the handler still resolves `{ ok: true }`

#### R3: `servers:rename` channel persists and rebuilds the menu
`main.ts` SHALL register an `isHostsSender`-gated `servers:rename` handler taking a structurally validated `{ id, name }` payload (both strings — anything else `"Invalid request"`) via a `parseRenamePayload` sibling of `parseReorderPayload`. The handler SHALL call `setHostName(userDataDir(), id, name)` then `rebuildMenu()` unconditionally (host names appear in the native Hosts-menu radio labels and `Remove "<name>"…` items), and resolve `{ ok: true }` — unknown id and no-op values included (the store's no-op convention; the rebuild is harmless).

- **GIVEN** a registered-host sender and payload `{ id: "x", name: "studio" }` for a registered host
- **WHEN** `servers:rename` is invoked
- **THEN** hosts.json carries the trimmed name, the native menu is rebuilt with the new label, and the handler resolves `{ ok: true }`

- **GIVEN** a payload missing `name` or with a non-string member
- **WHEN** invoked
- **THEN** the handler resolves `{ ok: false, error: "Invalid request" }` and nothing is written

#### R4: Preload invokers
`app/desktop/src/preload.ts` SHALL add two thin invokers to the existing `servers` group: `remove: (id) => ipcRenderer.invoke("servers:remove", id)` and `rename: (id, name) => ipcRenderer.invoke("servers:rename", { id, name })`. The group name, existing channel names, and the `servers:list` envelope stay frozen (additive members of the same namespace).

- **GIVEN** the shell's preload bridge
- **WHEN** the SPA calls `runkitShell.servers.remove(id)` / `.rename(id, name)`
- **THEN** the corresponding channel is invoked with the shapes R2/R3 expect

### SPA Bridge: Capability Pairs

#### R5: `canRemoveShellHost`/`removeShellHost` + `canRenameShellHost`/`renameShellHost`
`app/frontend/src/lib/shell.ts` SHALL add two additive, independently narrowed capability pairs following the `canReorderShellHosts`/`reorderShellHosts` pattern verbatim: separate `is…Bridge` narrowing extending `ShellServersBridge` (so the base group stays usable without the invoker), invokers that never throw and resolve `false` in a plain browser, on an older shell lacking the member, or on a rejected/denied/malformed response, and `true` only on `{ ok: true }`.

- **GIVEN** a bridge whose `servers` group lacks `remove`/`rename` (older shell)
- **WHEN** the predicates run
- **THEN** both return `false` and the invokers resolve `false` without throwing

- **GIVEN** a bridge carrying the invokers and a shell resolving `{ ok: true }`
- **WHEN** `removeShellHost("x")` / `renameShellHost("x", "n")` run
- **THEN** both resolve `true` and passed the exact arguments through

### Dropdown UI: Row Affordances

#### R6: Row restructure without nested interactive elements
Each host row in `app/frontend/src/components/shell-titlebar-strip.tsx` is currently a single `<button role="menuitemradio">`; icon buttons and a rename input MUST NOT nest inside it (invalid HTML). The row SHALL be restructured — a non-interactive `group relative` wrapper containing the primary `role="menuitemradio"` button plus a sibling, absolutely-positioned trailing action cluster holding the icon `<button>`s — while preserving intact: the roving-tabindex/arrow cycle (`itemRefs`/`focusedIndex` keep pointing at the primary row buttons, footer last), drag reorder (`draggable` + `HOST_REORDER_MIME` handlers still fire on row drag), the emptied-list guards (`hostCountRef` layout-effect write, close-on-empty, shrink re-clamp), and the accent bar / marker / name / origin / waiting / hint columns' alignment.

- **GIVEN** the restructured menu with the reorder capability present
- **WHEN** a row is dragged onto another and dropped
- **THEN** exactly one `reorderShellHosts` commit fires and hints re-number, as before

- **GIVEN** an open menu whose refetch empties the list
- **WHEN** an arrow key is pressed in the stale-subscription window
- **THEN** the key is released app-wide (no preventDefault), as before

#### R7: Disconnect affordance
Each host row SHALL render a hover/focus-revealed **Disconnect** icon button (unplug glyph; `aria-label` and `Tip` tooltip say "Disconnect", never delete/remove), gated on `canRemoveShellHost()`. Click SHALL invoke `removeShellHost(row.id)` — the SPA adds **no** second confirmation; the shell's native Cancel-default dialog is the safety. A `false` resolution SHALL surface toast `"Shell host disconnect failed"` and `fetchServers()`. After a confirmed disconnect of a background host the SPA refetches and reconciles in place (menu stays open); disconnecting the ACTIVE host navigates shell-side (page swap) with nothing to reconcile. On an older shell without the capability the icon does not render.

- **GIVEN** the menu open on a newer shell
- **WHEN** the Disconnect icon on a background row is clicked and the invoke resolves `true`
- **THEN** exactly one `removeShellHost(id)` call fired with that row's id and the list refetches

- **GIVEN** an older shell (`canRemoveShellHost()` false)
- **WHEN** the menu renders
- **THEN** no Disconnect icon exists and rows render as today

#### R8: Inline rename affordance
Each host row SHALL render a hover/focus-revealed **Edit** (rename) icon button (pencil glyph), gated on `canRenameShellHost()`. Click SHALL enter inline edit: the name span is replaced by a text input prefilled with the current name, select-all on focus. **Enter or blur commits; Escape cancels** (the window-heading rename precedent — no dialog). Commit trims; an empty/whitespace-only or unchanged value is a cancel (no invoke). A real commit SHALL call `renameShellHost(id, trimmed)`, optimistically update the local row name, and refetch to reconcile; `false` SHALL surface toast `"Shell host rename failed"` plus refetch. The menu SHALL stay open across the edit and commit.

- **GIVEN** a row in edit mode with the name changed to `" studio "`
- **WHEN** Enter is pressed
- **THEN** exactly one `renameShellHost(id, "studio")` call fires, the row shows `studio` immediately, the menu stays open, and a refetch reconciles

- **GIVEN** a row in edit mode
- **WHEN** Escape is pressed, or the value is committed empty/unchanged
- **THEN** no invoke fires and the row returns to display mode with the prior name

#### R9: Keyboard bindings and edit-mode key suspension
The existing capture-phase keydown handler SHALL bind, on the focused host row while the menu is open: **Delete or Backspace** → disconnect (same path as the icon; capability-gated, not bound on the Add-Host footer, falls through on older shells) and **F2** → enter inline rename (capability-gated). While the rename input is focused the menu's key handling SHALL suspend for editing keys: the capture handler bails when the event target is the rename input, so Escape exits the edit only (menu stays open), Enter commits without activating/switching the row, arrows move the caret (no roving/reorder), and Delete/Backspace edit text.

- **GIVEN** a focused host row (not editing) on a newer shell
- **WHEN** Backspace is pressed
- **THEN** `removeShellHost` is invoked for that row exactly once

- **GIVEN** a row in edit mode
- **WHEN** ArrowDown or Escape is pressed inside the input
- **THEN** focus does not rove and the menu does not close; Escape only exits the edit

### Non-Goals

- No change to the native `Hosts → Remove "<name>"…` menu item's label or behavior — the "Disconnect" verb is dropdown-only.
- No welcome-page rename mode, no rename dialog, no rename surface anywhere but the dropdown row.
- No dedupe of same-origin entries and no change to `addHost`; rename is the disambiguation tool.
- No e2e coverage — `isShell()` is false under Playwright; the strip is vitest-plus-manual-verify territory (established in ui/top-bar memory).
- No change to `rk remote disconnect` semantics; `servers:remove` removes the registration (entry + view), which for SSH-remote hosts is more than dropping the tunnel.

### Design Decisions

#### The dropdown gains rename; the 260731-5blj "no rename affordance" decision is reversed
**Decision**: Reintroduce host rename as an inline edit in the SPA host-switcher dropdown, backed by a `setHostName` store mutator and an additive `servers:rename` channel. The welcome page, native menu, and store add-time naming are untouched — names still auto-derive at add-time; rename is a post-add correction.
**Why**: The 5blj decision priced rename against a native dialog Electron lacks and a heavy chain (menu item + welcome-page mode + privileged channel + store mutator). The SPA dropdown — which did not exist then — is now a cheap inline-edit surface with a recorded product precedent (the window-heading rename), and duplicate/same-named registrations (addHost never dedupes) make a cosmetic-string edit genuinely useful: remove-and-re-add mints a fresh UUID and drops `lastPath`.
**Rejected**: Keeping remove-and-re-add as the only rename path (loses per-host state for a cosmetic edit); a native rename dialog (still does not exist in Electron); a welcome-page rename mode (the exact heavy chain 5blj rightly killed).
*Introduced by*: 260817-pfvt-host-dropdown-disconnect-rename

#### Disconnect is a verb choice, not a new mechanism
**Decision**: The dropdown's removal affordance is labeled "Disconnect" (unplug icon) and routes into the unchanged `confirmAndRemoveHost` path via a gate-narrow-call `servers:remove` handler.
**Why**: User-confirmed verb; one removal path keeps the confirm dialog, view teardown, menu rebuild, and active-fallback single-sourced. The native menu keeps "Remove" — renaming it is unrequested scope.
**Rejected**: A second SPA-side confirmation (double-confirm noise; the native Cancel-default dialog is the safety); a distinct removal implementation for the dropdown (two paths to drift).
*Introduced by*: 260817-pfvt-host-dropdown-disconnect-rename

## Tasks

### Phase 1: Desktop shell (store → IPC → preload)

- [x] T001 [P] Add `setHostName(dir, id, name)` to `app/desktop/src/hosts.ts` in the `setHostLastPath` shape: load → find entry → trim → no-op (return loaded list, write nothing) on unknown id / empty trimmed / unchanged → patch → `saveHosts` <!-- R1 -->
- [x] T002 [P] Add `setHostName` cases to `app/desktop/src/hosts.test.ts` mirroring the `setHostLastPath` suite: rename persists and round-trips; trims whitespace; unknown id writes nothing; unchanged value writes nothing (assert no file rewrite); empty/whitespace-only keeps current name; `activeId`/`lastPath`/`accentColor`/`remote`/order untouched <!-- R1 -->
- [x] T003 Register `servers:remove` in `registerIpcHandlers()` in `app/desktop/src/main.ts`: `isHostsSender` gate → non-string id `"Invalid request"` → `await confirmAndRemoveHost(id)` → `{ ok: true }` (cancel and unknown id included) <!-- R2 -->
- [x] T004 Add `parseRenamePayload` (sibling of `parseReorderPayload`: `{id, name}` both strings) and register `servers:rename` in `app/desktop/src/main.ts`: gate → narrow → `setHostName(userDataDir(), id, name)` → `rebuildMenu()` → `{ ok: true }` <!-- R3 -->
- [x] T005 Add `remove`/`rename` invokers to the `servers` group in `app/desktop/src/preload.ts` (thin `ipcRenderer.invoke` wrappers; update the header comment's group description) <!-- R4 -->

### Phase 2: SPA bridge

- [x] T006 [P] Add `canRemoveShellHost`/`removeShellHost(id)` and `canRenameShellHost`/`renameShellHost(id, name)` to `app/frontend/src/lib/shell.ts` on the `canReorderShellHosts` pattern: separate `ShellServersRemoveBridge`/`ShellServersRenameBridge` narrowing, never-throw invokers resolving `true` only on `{ ok: true }` <!-- R5 -->
- [x] T007 [P] Add Vitest cases to `app/frontend/src/lib/shell.test.ts` for both pairs: present / absent / malformed bridge shapes, denial and rejection resolve `false`, arguments passed through (the reorder-pair test pattern) <!-- R5 -->

### Phase 3: Dropdown component

- [x] T008 Restructure the host row in `app/frontend/src/components/shell-titlebar-strip.tsx`: non-interactive `group relative` wrapper + primary `role="menuitemradio"` button + sibling absolutely-positioned trailing action cluster; keep `itemRefs`/`focusedIndex` on the primary buttons, keep drag handlers and `HOST_REORDER_MIME` behavior, keep the grip, widen the trailing reservation (today's `pr-6`) for grip + two icons, keep accent bar/marker/name/origin/waiting/hint alignment and the emptied-list guards <!-- R6 -->
- [x] T009 Add the Disconnect affordance to the action cluster: unplug-glyph icon button (aria-label/Tip "Disconnect"), rendered only when `canRemoveShellHost()`; click → `removeShellHost(row.id)`, no SPA confirm; `false` → toast `"Shell host disconnect failed"` + `fetchServers()`; `true` → `fetchServers()` to reconcile (menu stays open for background-host removal) <!-- R7 -->
- [x] T010 Add the inline rename affordance: pencil-glyph icon button rendered only when `canRenameShellHost()`; click → row edit mode (input prefilled, select-all); Enter/blur commit with trim, empty/unchanged = cancel (no invoke); real commit → optimistic local name + `renameShellHost(id, trimmed)` + refetch; `false` → toast `"Shell host rename failed"` + refetch; Escape cancels; menu stays open throughout <!-- R8 -->
- [x] T011 Extend the capture-phase `handleKey` effect: Delete/Backspace on a focused host row → disconnect (capability-gated, not on the footer), F2 → enter rename; bail out of all menu key handling when `e.target` is the rename input (edit-mode suspension) <!-- R9 -->
- [x] T012 Add component cases to `app/frontend/src/components/shell-titlebar-strip.test.tsx`: icons gated on capabilities; older shell renders plain rows (no icons, keys fall through); Disconnect click invokes `remove` with the row id; Delete/Backspace on focused row invokes `remove`; footer unaffected; F2 enters edit; Enter commits trimmed value; blur commits; Escape cancels without closing the menu; empty/unchanged commit performs no invoke; failure resolutions toast + refetch; remove-shrunk refetch keeps focus/emptied-list guards; drag reorder still commits once <!-- R6, R7, R8, R9 -->

### Phase 4: Verification

- [x] T013 Run the gates: `cd app/desktop && pnpm compile && node --test "dist/**/*.test.js"`; `cd app/frontend && npx tsc --noEmit`; frontend Vitest via the just recipe (`just test-frontend`); `just build`. Fix anything they surface <!-- R1, R5, R6 -->

## Execution Order

- T001 blocks T002 (tests compile against the mutator) and T004 (handler calls it)
- T003/T004 block T005 only conceptually (channel names); T005 blocks nothing SPA-side (the SPA narrows structurally)
- T006 blocks T007, T009, T010
- T008 blocks T009–T012
- T013 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `setHostName` exists in `hosts.ts` with membership guard, trim, empty/unchanged no-op, and atomic save; its `node --test` cases pass
- [x] A-002 R2: `servers:remove` handler is registered, `isHostsSender`-gated, narrows a string id, and calls `confirmAndRemoveHost` (which is itself unmodified)
- [x] A-003 R3: `servers:rename` handler is registered with `parseRenamePayload` narrowing and calls `setHostName` then `rebuildMenu()` unconditionally
- [x] A-004 R4: the preload `servers` group carries `remove`/`rename` invokers targeting the new channels with the specified payload shapes
- [x] A-005 R5: both capability pairs exist in `lib/shell.ts`, independently narrowed, never throw, and their Vitest cases pass
- [x] A-006 R7: the Disconnect icon renders capability-gated with "Disconnect" as aria-label/tooltip and invokes `removeShellHost` with the row id
- [x] A-007 R8: the rename flow works inline — Enter/blur commit trimmed, Escape/empty/unchanged cancel with no invoke, optimistic update + refetch, menu stays open

### Behavioral Correctness

- [x] A-008 R2: user-cancel and unknown id resolve `{ ok: true }`; the SPA treats them as successful no-ops (refetch reconciles, no error toast)
- [x] A-009 R9: Delete/Backspace and F2 act on the focused row only, are capability-gated, skip the Add-Host footer, and all menu key handling bails while the rename input has focus

### Scenario Coverage

- [x] A-010 R6: component tests cover the restructured row still driving drag reorder (one commit per drop), roving tabindex, and the emptied-list guards after a remove-shrunk refetch
- [x] A-011 R7, R8: component tests cover both failure toasts (`"Shell host disconnect failed"` / `"Shell host rename failed"`) with refetch, and the older-shell plain-row degradation

### Edge Cases & Error Handling

- [x] A-012 R3: malformed `servers:rename` payloads (missing/non-string members) resolve `"Invalid request"` and write nothing; malformed `servers:remove` payloads (non-string) likewise
- [x] A-013 R6: no interactive element nests inside another (`<button>` inside `<button>`, input inside button) anywhere in the row markup

### Code Quality

- [x] A-014 Pattern consistency: new code follows the established shapes verbatim — `setHostLastPath` (store), `parseReorderPayload`/reorder handler (IPC), `canReorderShellHosts` pair (bridge), `commitReorder` toast+refetch (component)
- [x] A-015 No unnecessary duplication: no second removal path, no second confirm, no re-derived origin/name logic; type narrowing over assertions (no `as` casts) in all SPA additions
- [x] A-016 Comments state constraints code can't show (nesting invariant, frozen `servers:*` contract, capability degradation) — no narration, no change-ID citations in code

### Security

- [x] A-017 R2, R3: both new handlers are `isHostsSender`-gated and structurally validate payloads before any store call; no new privileged surface reaches the welcome-only tiers; error text for ungated senders is `"Not allowed"`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Row restructure shape: non-interactive wrapper + primary menuitemradio button + sibling absolutely-positioned action cluster (icon buttons never nested) | The one structure that satisfies the no-nested-interactive constraint while keeping `itemRefs` on real buttons; exact DOM details stay apply-level and reversible | S:60 R:85 A:75 D:60 |
| 2 | Confident | Icon glyphs: lucide-style pencil (rename) and unplug (disconnect) as inline SVGs, matching the user-approved HTML mock | Mock was explicitly approved; inline SVG matches how the SPA renders small icons and avoids new deps | S:75 R:90 A:80 D:75 |
| 3 | Confident | Action-cluster order: edit · disconnect · grip at the trailing edge, hint hidden while the cluster shows (hover/focus) | Approved mock's arrangement; hint and cluster share the trailing zone and never need to coexist | S:65 R:90 A:75 D:65 |
| 4 | Confident | Disconnect of the ACTIVE host needs no SPA-side reconciliation — the shell's `showActive` page swap unloads/re-targets the SPA | Matches the recorded shell behavior (`confirmAndRemoveHost` → `showActive`); the switch-selection precedent already declines optimistic UI for page swaps | S:70 R:80 A:85 D:75 |

4 assumptions (0 certain, 4 confident, 0 tentative).
