# Plan: Desktop-Shell Host-Switcher Menu — Per-Host Accent Color, Manual Reorder, Per-Host Waiting Counts

**Change**: 260813-1i7j-host-switcher-color-reorder-waiting
**Intake**: `intake.md`

## Requirements

### Desktop Shell Store (`app/desktop/src/hosts.ts`): accentColor + reorder

#### R1: `accentColor` additive optional field
`HostEntry` SHALL gain an optional `accentColor?: string` field persisted in `hosts.json`, with `lastPath`-style per-field tolerance in `parseHostEntry`: absent → entry loads unchanged; string → kept; any other type → the field is dropped and the entry (and file) still loads. The schema `version` MUST stay `1` (absence is a valid state — no bump).

- **GIVEN** a stored `hosts.json` whose entry carries `"accentColor": 42` (wrong type)
- **WHEN** `loadHosts` parses it
- **THEN** the entry loads without the field and no other field is affected
- **AND** an entry with `"accentColor": "#8b7ff0"` loads with the field kept

#### R2: `setHostAccentColor` mutator
`hosts.ts` SHALL export an id-keyed mutator `setHostAccentColor(dir, id, accentColor)` following the existing mutator shape: load → membership guard (unknown `id` is a no-op that writes nothing) → patch → atomic `saveHosts`. It MUST short-circuit an unchanged value (the `setHostLastPath` precedent — the capture seam fires on every theme-color report, so identical writes must not rewrite the file).

- **GIVEN** a host whose stored `accentColor` is already `"#8b7ff0"`
- **WHEN** `setHostAccentColor(dir, id, "#8b7ff0")` runs
- **THEN** no file write occurs and the returned list is unchanged
- **AND** a different value patches only that entry and persists atomically

#### R3: `moveHost` reorder mutator
`hosts.ts` SHALL export an id-keyed array-move mutator `moveHost(dir, id, toIndex)`: load → membership guard (unknown `id` no-ops, writes nothing) → remove the entry from its current position and insert at `toIndex` **clamped** to `[0, hosts.length - 1]` → atomic save. A move that lands on the entry's current index MUST be a no-op that writes nothing. `activeId` and every other field are untouched — only array order changes.

- **GIVEN** hosts `[A, B, C]` and a call `moveHost(dir, C.id, 0)`
- **WHEN** the mutator runs
- **THEN** the persisted order is `[C, A, B]` and `activeId` is unchanged
- **AND** `moveHost(dir, X.id, 5)` on a 3-entry list clamps to index 2
- **AND** `moveHost(dir, unknown, 1)` writes nothing

#### R4: projection carries `accentColor`; `waiting` rides the same wire type
`HostInfo` SHALL gain two optional fields: `accentColor?: string` (filled by `hostInfos` from the store entry when present) and `waiting?: number` (NEVER filled by `hostInfos` — the view-registry join happens in `main.ts`, R7). The `servers:list` envelope shape (`{ ok: true, servers: HostInfo[] }`) is unchanged — no new channel.

- **GIVEN** a list whose entry carries `accentColor`
- **WHEN** `hostInfos(list)` projects it
- **THEN** the projected info carries the same `accentColor`, and entries without one project without the field (never `null`/empty-string)

### Desktop Shell Main + Preload (`app/desktop/src/main.ts`, `preload.ts`)

#### R5: accent persistence seam on `did-change-theme-color`
The existing per-view `did-change-theme-color` wiring in `main.ts` SHALL, in addition to the registry cache + overlay repaint it already does, persist the reported color via `setHostAccentColor(userDataDir(), hostId, color)` **only when `color` is a non-null string** — a `null` report leaves the stored value untouched. The dev-override sentinel view (`__dev__`) matches no store entry, so the mutator's membership guard silently covers it.

- **GIVEN** a host view reporting theme color `"#4a4468"`
- **WHEN** the event fires
- **THEN** the host's `hosts.json` entry gains/updates `accentColor: "#4a4468"` (short-circuited when unchanged)
- **AND** a `null` report changes nothing on disk

#### R6: `servers:reorder` IPC handler
`main.ts` SHALL register a `servers:reorder` handler gated by the existing `isHostsSender` (registered host origins + welcome, like every `servers:*` handler). Payload is `{ id, toIndex }`, structurally validated (`id` a string, `toIndex` a non-negative integer) — anything else returns `{ ok: false, error: "Invalid request" }`. On a valid payload it calls `moveHost` and then `rebuildMenu()` (native Hosts-menu accelerators derive from list order), returning `{ ok: true }`. An unknown id is still `{ ok: true }` (no-op mutator, menu rebuild harmless) — the store's unknown-id-no-op convention, not an error.

- **GIVEN** the SPA invokes `servers.reorder(id, 0)` for a registered host
- **WHEN** the handler runs
- **THEN** `hosts.json` order changes, the native menu is rebuilt with re-derived ⌥⌘1–9/⇧Ctrl+1–9 accelerators, and `{ ok: true }` returns
- **AND** a disallowed sender gets `{ ok: false, error: "Not allowed" }`

#### R7: `servers:list` joins view-registry waiting counts
The `servers:list` handler SHALL join the store projection with the view registry: for each projected info, when a view exists for that host id and its cached `badgeCount > 0`, set `waiting` to that count; otherwise omit the field. A never-visited host (no view) and a zero count both project without `waiting`. The dock badge pipeline (`badge:set` → `applyBadge`) is untouched — cross-host aggregation stays a non-goal.

- **GIVEN** a background host whose view last reported `badge:set 3`
- **WHEN** the SPA calls `servers:list`
- **THEN** that host's entry carries `waiting: 3`
- **AND** hosts with no view or a `0` count carry no `waiting` field

#### R8: preload bridge reorder invoker
`preload.ts` SHALL add `reorder: (id, toIndex) => ipcRenderer.invoke("servers:reorder", { id, toIndex })` to the existing `servers` group. Nothing else about the bridge changes; older-SPA pages simply never call it.

- **GIVEN** the SPA detects the invoker
- **WHEN** it calls `runkitShell.servers.reorder(id, 2)`
- **THEN** the gated main-side handler receives `{ id, toIndex: 2 }`

### Frontend Shell Lib (`app/frontend/src/lib/shell.ts`, `shell-strip.ts`)

#### R9: `ShellServer` type + structural validation extension
`ShellServer` SHALL gain optional `accentColor?: string` and `waiting?: number`. `isShellServer` validates them **when present** (wrong type rejects the entry, and thereby the list — these values come from our own shell, not user input; absence is always valid, preserving older-shell responses).

- **GIVEN** a `servers:list` response from an older shell (`{id, name, url, active}` only)
- **WHEN** `listShellServers()` narrows it
- **THEN** the list parses successfully with both fields absent

#### R10: reorder capability detection + invoker
`shell.ts` SHALL add `canReorderShellHosts(): boolean` and `reorderShellHosts(id, toIndex): Promise<boolean>` following the `canAddShellHost`/`addShellHost` optional-invoker pattern exactly (separate structural narrowing of the additive `reorder` member; resolves `false` outside the shell, on an older shell, or on rejection/denial; never throws).

- **GIVEN** an older shell whose `servers` group lacks `reorder`
- **WHEN** `canReorderShellHosts()` runs
- **THEN** it returns `false` and the strip renders no reorder affordances (R14–R16)

#### R11: row model carries hex-validated color + waiting count
`ShellHostMenuRow` SHALL gain `accentColor: string | null` and `waiting: number | null`. `shellHostMenuRows` fills `accentColor` only when the server's value matches a strict hex pattern (`#RGB`/`#RRGGBB`/`#RRGGBBAA` — the shell-side `fallbackStripCss` hex-validation precedent, guarding style interpolation) and fills `waiting` only when present and `> 0` **and the row is not active** (the active host's attention is the dock badge's job; the menu surfaces *background* hosts).

- **GIVEN** a server entry with `accentColor: "javascript:alert(1)"`
- **WHEN** rows derive
- **THEN** that row's `accentColor` is `null` (no bar, no style interpolation)
- **AND** an active entry with `waiting: 2` derives `waiting: null` while a background one keeps `2`

### Strip Component (`app/frontend/src/components/shell-titlebar-strip.tsx`)

#### R12: accent edge bar
Each menu row with a non-null `accentColor` SHALL render a ~3px left-edge bar in that color (vertically inset, matching the row's height minus small padding). Rows without a color render no bar and keep identical text alignment (the bar must not shift row content — it overlays the row's left edge, absolutely positioned).

- **GIVEN** hosts with distinct accent colors
- **WHEN** the menu opens
- **THEN** each row shows its host's accent as a left-edge bar and colorless rows show none, with all names left-aligned identically

#### R13: waiting-count chip
Each row with a non-null `waiting` SHALL render an amber `● {N}` indicator between the origin and the accelerator hint (`ml-auto` cluster). Waiting-only semantics — the component never renders busy/idle states, and `0`/absent renders nothing.

- **GIVEN** a background host with `waiting: 3`
- **WHEN** the menu renders
- **THEN** its row shows an amber `● 3` before the `⌥⌘N` hint, and rows without a count show nothing extra

#### R14: ⌥↑/⌥↓ keyboard move with live hint re-numbering
When the reorder capability is present, the menu's capture-phase keydown handler SHALL treat Alt+ArrowUp/Alt+ArrowDown (all platforms — `e.altKey && (ArrowUp|ArrowDown)`) as "move the focused row": each keypress commits one move (`reorderShellHosts(id, index±1)`), optimistically reorders the local list state so the accelerator hints re-number live, and keeps focus (and the roving-tabindex seat) on the moved row. No wrap at the list edges — a move past either end is a no-op that swallows the key. Plain (unmodified) ArrowUp/ArrowDown keep today's roving-focus behavior; without the capability, Alt+arrows fall through to today's arrow handling. The Add-Host footer is not movable and is skipped by Alt+arrow handling.

- **GIVEN** the menu is open with focus on row 2 of 4 and reorder capability present
- **WHEN** the user presses ⌥↑
- **THEN** the row moves to index 1, `reorderShellHosts` is invoked once with `(id, 1)`, the hints re-number (the moved row now shows `⌥⌘2`), and focus stays on the moved row
- **AND** ⌥↑ on the first row is a no-op (no invoke, no order change)

#### R15: drag-grip reorder
When the reorder capability is present, each host row SHALL show a drag grip (`⋮⋮`) on row hover at the row's trailing edge; dragging a row and dropping it at another position commits **one** `reorderShellHosts(id, toIndex)` invocation at drop, with local row order updated optimistically during the drag (the sidebar session-reorder derive-over-store precedent: local order is presentation state, the open-time refetch reconciles). A failed invoke surfaces the existing toast pattern (`addToast(..., "error")`) and refetches the list.

- **GIVEN** the menu is open with 4 hosts and reorder capability present
- **WHEN** the user drags row 4 to position 1 and drops
- **THEN** exactly one `reorderShellHosts` call fires with `(row4.id, 0)`, the rows render in the new order, and the hints re-number

#### R16: capability degradation
Without the reorder capability (older shell): no grips render, Alt+arrows are not intercepted. Without `accentColor` on an entry: no bar. Without `waiting`: no chip. The menu MUST render correctly against an older shell's plain `{id, name, url, active}` projection — all three features are independently additive.

- **GIVEN** an older shell exposing only `list`/`switch`/`add`
- **WHEN** the menu opens
- **THEN** it renders exactly today's rows (marker, name, origin, hint) with no new affordances and no errors

### Non-Goals

- Rename-host affordance — recorded desktop-shell design decision stands (names auto-derive at add-time; remove + re-add)
- Alphabetical or any auto-sort — order IS the accelerator map; auto-sort silently remaps accelerators
- Color treatments A (dot) / C (tinted name) / D (row wash) — rejected in design review
- ssh tag on rows; unreachable ⚠ row state — mocked, not selected
- Cross-host dock-badge aggregation — the dock badge stays active-host-only
- Command-palette reorder commands — deferred (intake Open Question; not selected)
- Native Hosts-menu row colors/counts — the native menu keeps its current shape; only its accelerator order follows reorder

### Design Decisions

#### Accent color persists in hosts.json, not just the view registry
**Decision**: Persist `accentColor` per host entry (additive optional field), captured from `did-change-theme-color`, rather than projecting the registry's session-scoped `themeColor` cache.
**Why**: The registry cache dies with the window and never exists for hosts not yet visited this run; persistence makes colors correct at cold start — precisely when the menu is most needed to tell hosts apart.
**Rejected**: Registry-only projection — colors would blank on every launch until each host is visited.
*Introduced by*: 260813-1i7j-host-switcher-color-reorder-waiting

#### Reorder is move-by-id (`{id, toIndex}`), committed per gesture
**Decision**: One IPC channel `servers:reorder` carrying `{id, toIndex}`; each keyboard press or drag-drop commits one move.
**Why**: Keys on the immutable host id (the store's id-keyed-mutator rule); a full-array payload would trust renderer-supplied order and need set-equality validation.
**Rejected**: `{order: id[]}` full-list replace — larger validation surface, and a stale renderer list would silently drop concurrently-added hosts.
*Introduced by*: 260813-1i7j-host-switcher-color-reorder-waiting

#### Waiting count joins at the `servers:list` handler, not in `hostInfos`
**Decision**: `hostInfos` (electron-free, store-only) never fills `waiting`; the `main.ts` handler joins registry `badgeCount` caches into the projection.
**Why**: Keeps `hosts.ts` electron-free and store-pure (the module boundary the whole test strategy rides on); the registry is main-side state.
**Rejected**: Passing the registry into `hostInfos` — couples the store module to view state for a three-line join.
*Introduced by*: 260813-1i7j-host-switcher-color-reorder-waiting

## Tasks

### Phase 1: Store + pure logic (`app/desktop`)

- [x] T001 Add `accentColor?: string` to `HostEntry` with per-field parse tolerance in `parseHostEntry`, and to `HostInfo` (+ `waiting?: number`) with `hostInfos` filling `accentColor` only, in `app/desktop/src/hosts.ts` <!-- R1, R4 -->
- [x] T002 Add `setHostAccentColor(dir, id, accentColor)` mutator (membership guard, unchanged-value short-circuit, atomic save) in `app/desktop/src/hosts.ts` <!-- R2 -->
- [x] T003 Add `moveHost(dir, id, toIndex)` mutator (membership guard, clamp, same-index no-op, atomic save) in `app/desktop/src/hosts.ts` <!-- R3 -->
- [x] T004 Cover T001–T003 in `app/desktop/src/hosts.test.ts`: tolerance matrix (absent/string/wrong-type), short-circuit write behavior, move/clamp/no-op cases, projection field pass-through <!-- R1, R2, R3, R4 -->

### Phase 2: Shell main + preload (`app/desktop`)

- [x] T005 Persist accent in the `did-change-theme-color` wiring (non-null string only) in `app/desktop/src/main.ts` <!-- R5 -->
- [x] T006 Join view-registry `badgeCount` into the `servers:list` projection (`waiting` when a view exists and count > 0) in `app/desktop/src/main.ts` <!-- R7 -->
- [x] T007 Register the `servers:reorder` handler (isHostsSender gate, payload validation, `moveHost` + `rebuildMenu()`) in `app/desktop/src/main.ts` <!-- R6 -->
- [x] T008 Add the `reorder` invoker to the `servers` group in `app/desktop/src/preload.ts` <!-- R8 -->

### Phase 3: Frontend shell lib (`app/frontend`)

- [x] T009 Extend `ShellServer` (+ `isShellServer` present-field validation) and add `canReorderShellHosts`/`reorderShellHosts` per the `add`-invoker pattern in `app/frontend/src/lib/shell.ts`; cover in `app/frontend/src/lib/shell.test.ts` <!-- R9, R10 -->
- [x] T010 Extend `ShellHostMenuRow` with hex-validated `accentColor` and background-only `waiting` in `app/frontend/src/lib/shell-strip.ts`; cover derivation (hex accept/reject matrix, active-row suppression, absent fields) in its test file <!-- R11 -->

### Phase 4: Strip component (`app/frontend`)

- [x] T011 Render the accent edge bar and the amber `● N` waiting chip in `app/frontend/src/components/shell-titlebar-strip.tsx`; cover both (present/absent) in `shell-titlebar-strip.test.tsx` <!-- R12, R13 -->
- [x] T012 Implement ⌥↑/⌥↓ move in the capture-phase keydown handler (capability-gated, per-press commit, optimistic reorder, focus-follows, edge no-op, footer skipped) in `shell-titlebar-strip.tsx`; cover in `shell-titlebar-strip.test.tsx` <!-- R14 -->
- [x] T013 Implement the hover drag grip with commit-on-drop and optimistic order (failure → toast + refetch) in `shell-titlebar-strip.tsx`; cover in `shell-titlebar-strip.test.tsx` <!-- R15 -->
- [x] T014 Add the older-shell degradation test (plain 4-field projection → today's rendering, no affordances) in `shell-titlebar-strip.test.tsx` <!-- R16 -->

### Phase 5: Verification

- [x] T015 Full gates: `cd app/desktop && pnpm compile && node --test "dist/**/*.test.js"`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend` <!-- R1–R16 -->

## Execution Order

- T001 blocks T002–T004 (types) and T005–T006 (main.ts uses the new exports)
- T007 depends on T003; T008 is independent after T007's channel name is fixed
- T009 blocks T010–T014; T010 blocks T011–T013
- T015 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `hosts.json` round-trips `accentColor` with lastPath-style tolerance (absent kept-out, string kept, wrong type dropped without rejecting the entry), schema version still 1
- [x] A-002 R2: `setHostAccentColor` patches only the target entry, no-ops on unknown id, and skips the write on an unchanged value
- [x] A-003 R3: `moveHost` reorders by id with clamped target index, no-ops on unknown id and same-index moves, and never touches `activeId`
- [x] A-004 R4: `hostInfos` carries `accentColor` (and never fills `waiting`); the wire type carries both optionals
- [x] A-005 R5: a non-null theme-color report persists to the reporting host's entry; null reports and the dev sentinel view write nothing
- [x] A-006 R6: `servers:reorder` is sender-gated, validates `{id, toIndex}`, moves + rebuilds the native menu, and returns ok
- [x] A-007 R7: `servers:list` carries `waiting` exactly for hosts with a live view whose cached count > 0
- [x] A-008 R8: the preload `servers` group exposes the `reorder` invoker
- [x] A-009 R10: `canReorderShellHosts`/`reorderShellHosts` follow the optional-invoker pattern (false/no-throw outside shell and on older shells)
- [x] A-010 R11: row derivation hex-validates `accentColor` and suppresses `waiting` on the active row
- [x] A-011 R12: rows render the accent edge bar without shifting content; colorless rows render none
- [x] A-012 R13: background rows with a count render the amber `● N` chip before the hint
- [x] A-013 R14: ⌥↑/⌥↓ moves the focused row with one invoke per press, live hint re-numbering, focus-follow, and edge no-ops
- [x] A-014 R15: drag-drop commits exactly one reorder invocation with optimistic order and toast+refetch on failure

### Behavioral Correctness

- [x] A-015 R9: an older shell's 4-field `servers:list` response still parses (absent optionals valid); wrong-typed present optionals reject
- [x] A-016 R14: plain (unmodified) arrows keep today's roving-focus behavior; Alt+arrows without the capability fall through unchanged

### Scenario Coverage

- [x] A-017 R16: the degradation scenario is an explicit test — plain projection renders today's menu with no grips, bars, or chips
- [x] A-018 R6: after a reorder, the native Hosts menu's digit accelerators reflect the new order (rebuild verified via the menu-rebuild seam)

### Edge Cases & Error Handling

- [x] A-019 R11: a non-hex `accentColor` value never reaches style interpolation (bar suppressed)
- [x] A-020 R14: Alt+arrow at a list edge swallows the key without invoking reorder or wrapping
- [x] A-021 R15: a rejected/denied reorder invoke surfaces the error toast and refetches the list

### Code Quality

- [x] A-022 Pattern consistency: new store mutators mirror the existing load→guard→patch→atomic-save shape; bridge additions mirror the `add`-invoker narrowing pattern; no `as` casts in frontend narrowing
- [x] A-023 No unnecessary duplication: hex validation, toast usage, and roving-focus logic reuse/extend the existing seams rather than parallel implementations
- [x] A-024 Tests included: every behavior change lands with tests in the module's established runner (`node --test` desktop, Vitest frontend)
- [x] A-025 No Go-backend or route changes; Constitution II/IV untouched

### Security

- [x] A-026 R6: `servers:reorder` is gated by `isHostsSender` and structurally validates its payload; no renderer-supplied array order is trusted (move-by-id only)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `null` theme-color reports never clear a persisted `accentColor` (persist non-null strings only) | The SPA's theme-color meta is accent-aware end-to-end and effectively always present; clearing on transient nulls would flicker stored state. Easily revisited | S:60 R:85 A:80 D:70 |
| 2 | Confident | Frontend validation rejects a wrong-typed present optional (vs hosts.ts-style field-drop) | The response comes from our own shell, not user data — cross-version shells omit fields rather than mistype them; strict-when-present is simpler and matches `isShellServer`'s existing strictness | S:55 R:85 A:80 D:65 |
| 3 | Confident | Waiting chip suppressed on the ACTIVE row (backend still sends the count; row derivation nulls it) | Intake says "background host's row"; the active host's attention surface is the dock badge. Display-layer choice, trivially reversible | S:65 R:90 A:80 D:75 |
| 4 | Confident | Reorder payload `{id, toIndex}` on channel `servers:reorder`; wrong-shape payload → `Invalid request`, unknown id → ok no-op | Carried from intake #10; unknown-id-ok mirrors the store's no-op convention (remove/setActive precedents) | S:60 R:85 A:85 D:70 |
| 5 | Confident | Alt+ArrowUp/Down on all platforms, per-press commit, no wrap, footer excluded from movement | Carried from intake #12; arrows compose no characters so the mac Option issue doesn't apply; no-wrap matches accelerator-assignment mental model | S:60 R:85 A:80 D:70 |
| 6 | Confident | Drag implemented with commit-on-drop + optimistic local order; open-time refetch is the reconcile seam | Carried from intake #13 (sidebar derive-over-store precedent); exact DOM drag mechanism left to apply within these semantics | S:55 R:85 A:75 D:65 |
| 7 | Certain | Native Hosts menu gets no colors/counts — only its accelerator order follows reorder via the existing rebuild | Intake scopes the feature to the SPA dropdown; menu.ts change surface stays zero beyond the rebuild call | S:80 R:90 A:90 D:85 |

7 assumptions (1 certain, 6 confident, 0 tentative).
