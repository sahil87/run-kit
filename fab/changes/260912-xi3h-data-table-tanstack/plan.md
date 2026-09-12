# Plan: One Data Table — Operator Tasks, Cron List, Cron Log over TanStack Table

**Change**: 260912-xi3h-data-table-tanstack
**Intake**: `intake.md`

## Requirements

### Frontend: the shared `DataTable` component

#### R1: One headless table model, our rendering
`app/frontend` SHALL depend on `@tanstack/react-table` (install the latest published major from `app/frontend/` with `pnpm add @tanstack/react-table`; the lockfile updates in the same commit). No shadcn/ui, Radix, `cva`, `tailwind-merge`, or `components/ui/` tree SHALL be added. `components/data-table.tsx` SHALL export a generic `DataTable<Row>` that owns the table chrome (header row, sort, resize, `<colgroup>` widths, view-state store, mounted-table registry) while consumers own cell rendering via per-column `cell(row)` renderers and per-row `rowProps(row)`.

- **GIVEN** a consumer passes `columns`, `rows`, `rowKey`, `tableId`
- **WHEN** `DataTable` renders
- **THEN** it emits `<div class="overflow-x-auto"><table class="… table-fixed"><colgroup>…</colgroup><thead>…</thead><tbody>…</tbody></table></div>` with one `<th scope="col">` per column and one `<tr>` per row, each `<td>` containing `column.cell(row)`

#### R2: Column contract
Each column SHALL declare `id` (stable — the persistence key), `header` (lowercase label), `sortValue(row): string | number | undefined`, optional `sortingFn(a, b)`, `cell(row): ReactNode`, `size` (default px width), optional `minSize` (default `DATA_TABLE_MIN_COL_PX = 48`), optional `maxSize` (default `DATA_TABLE_MAX_COL_PX = 960`), optional `className` (applied to that column's `<td>`s).

- **GIVEN** a column with `sortValue` returning `undefined` for some rows
- **WHEN** the column is sorted in either direction
- **THEN** rows with `undefined` sort last (`sortUndefined: "last"`)

#### R3: Sortable headers with `aria-sort`
Every header cell SHALL contain a button built with `controlClass({ variant: "toggle", base: DATA_TABLE_HEADER_BASE, pressed: sorted })` (or `<Control>`), where `DATA_TABLE_HEADER_BASE` reproduces today's header typography (`text-left text-[10px] uppercase tracking-wide text-text-secondary font-normal w-full`) so the header is visually unchanged at rest. The `<th>` SHALL carry `aria-sort="ascending" | "descending" | "none"`; the button SHALL carry `aria-label="Sort by {header}"` and, after the label, an `aria-hidden` glyph span — `▴` ascending, `▾` descending, empty at rest. Click / Enter / Space SHALL cycle `none → ascending → descending → none` with `enableMultiSort: false` and `enableSortingRemoval: true`. The effective sorting fed to TanStack SHALL be `persistedSort ?? initialSort` — a cleared sort returns to `initialSort`, never to raw input order for a table that has one; when `initialSort` is `null` a cleared sort is input order.

- **GIVEN** a table with `initialSort: { id: "next", desc: false }`
- **WHEN** the user clicks the `next` header three times
- **THEN** `aria-sort` reads `ascending` (same as rest — the persisted sort is now explicit asc), then `descending`, then the sort clears and the rows return to the `initialSort` order with `aria-sort="ascending"` on `next`
- **AND GIVEN** the user clicks a different header
- **THEN** that column sorts ascending and the previous column reads `aria-sort="none"` (single-column)

#### R4: Column resizing (fine pointers only)
Every header except the last SHALL carry an `aria-hidden` resize handle: an absolutely positioned 6px-wide element on the header's right edge, full header height, `cursor-col-resize touch-none`, bound to TanStack's `header.getResizeHandler()` on `onMouseDown` and `onTouchStart`, with `columnResizeMode: "onChange"`. Column widths SHALL be written to CSS custom properties `--rk-col-<id>` on the `<table>` element and read by each `<col style="width: var(--rk-col-<id>)">`; the `<table>` SHALL carry `style.minWidth` equal to the sum of column widths so `table-fixed` never redistributes. During a drag the handle wears `bg-accent-green`; on hover `bg-accent-green/60`. Widths SHALL be clamped to `[minSize, maxSize]`. The view-state store SHALL be written **once on drag end** (pointer-up / touch-end), not per move. Double-click on a handle SHALL reset that column to its `size`. When `useCoarsePointer()` is true, `enableColumnResizing` SHALL be `false` and no handles render (sorting by header tap stays).

- **GIVEN** a fine-pointer viewport and a two-column table
- **WHEN** the user drags the first column's handle 40px right and releases
- **THEN** `--rk-col-<first>` grows by 40px (within clamps), `<col>` widths follow, and `localStorage["runkit-table-<id>"]` gains `widths: { "<first>": <new px> }` exactly once
- **GIVEN** `matchMedia("(any-pointer: coarse)")` matches
- **WHEN** the table renders
- **THEN** no element with `data-testid="data-table-resize-handle"` exists and header clicks still sort

#### R5: Per-viewer view state in localStorage
`data-table.tsx` SHALL export `DATA_TABLE_STORAGE_PREFIX = "runkit-table-"`, `type DataTableViewState = { sort: { id: string; desc: boolean } | null; widths: Record<string, number> }`, `readDataTableViewState(tableId, columns)`, `writeDataTableViewState(tableId, state)`, `resetDataTableViewState(tableId)`, and the hook `useDataTableViewState(tableId, columns)`. The store SHALL follow `hooks/use-local-storage-enum.ts`'s in-module pub/sub (same-tab subscribers keyed on the storage key; cross-tab via the native `storage` event) and `lib/quake-terminal.ts`'s value discipline: `JSON.parse` in try/catch; `sort.id` naming a column not in `columns` degrades to `null`; each width must be a finite number and is clamped into its column's `[minSize, maxSize]`; unknown column ids are dropped; anything unusable resolves per field to the defaults (`sort: null`, `widths: {}`) with no error; a localStorage that throws (privacy mode) is treated as empty on read and ignored on write. `resetDataTableViewState` removes the key and notifies subscribers.

- **GIVEN** `localStorage["runkit-table-t"] = '{"sort":{"id":"nope","desc":true},"widths":{"a":"wide","b":10,"zzz":200}}'` and columns `a` (`minSize` 48) and `b` (`minSize` 48)
- **WHEN** `readDataTableViewState("t", columns)` runs
- **THEN** it returns `{ sort: null, widths: { b: 48 } }`
- **GIVEN** `localStorage["runkit-table-t"] = 'not json'`
- **THEN** it returns `{ sort: null, widths: {} }`

#### R6: Mounted-table registry and the palette reset
`data-table.tsx` SHALL keep a module-level registry of mounted tables (`tableId → { label }`), registering on mount and unregistering on unmount, and export `useMountedDataTables(): { id: string; label: string }[]` (a `useSyncExternalStore`-backed subscription) plus `resetDataTableViewState`. `lib/palette/data-table.ts` SHALL export the pure builder `buildDataTableActions(mounted)`: zero mounted → `[]`; one → `[{ id: "table-reset-columns", label: "Table: Reset columns", onSelect: reset(id) }]`; two or more → one action `{ id: "table-reset-columns", label: "Table: Reset columns…", optionPicker: { options: mounted.map(m => ({ key: m.id, label: m.label })), placeholder: "Pick a table to reset — Space toggle · Enter apply", onApply: keys => keys.forEach(reset) }, onSelect: () => {} }` (the `lib/palette/cron.ts` picker idiom). `app.tsx` SHALL call `useMountedDataTables()` in AppShell and spread `buildDataTableActions(mounted)` into the existing `paletteActions` memo beside the cron group — one import line and one spread line, nothing else in `app.tsx` changes. Labels: `watched` → `Watched`, `watched-dense` → `Operator Tasks`, `cron-list` → `Cron List`, `cron-log` → `Cron Log`.

- **GIVEN** the quake drawer's Cron List is open over the Server page's WATCHED zone
- **WHEN** the palette opens
- **THEN** it lists `Table: Reset columns…` whose picker offers `Cron List` and `Watched`
- **AND WHEN** `Cron List` is applied
- **THEN** `localStorage["runkit-table-cron-list"]` is removed and the Cron List rows return to the `sortCronEntries` order at default widths

### Frontend: consumers

#### R7: `WatchedTable` over `DataTable`, unchanged at rest
`components/watched-table.tsx` SHALL keep its props (`rows`, `stale`, `nowSeconds`, `onNavigate`, `dense`) and both row species, and render via `DataTable` with six columns `status · session · change · awaiting · note · repo`. `tableId` is `dense ? "watched-dense" : "watched"`; `initialSort` is `null` (today's derived order at rest). `rowProps(row)` returns `{ "data-testid": "watched-row" | "tracked-item-row", "data-done": done ? "true" : undefined, className: done ? "opacity-50" : undefined }`. The stale `opacity-50` and `data-testid="watched-table"` move to the `<table>` via `className`/`data-testid`. Cell content per species is today's markup verbatim (`StatusDot` + navigate button `watched-row-navigate`, stage chip, paused/done markers, `Tip`-wrapped truncation, the `tracked-item-expand` toggle — its `expanded` state moves into a `NoteCell` component). Sort accessors: `status` → `win.name` / `item.id`; `session` → session string; `change` → change string / joined refs; `awaiting` → state rank (`waiting` 0, `active` 1, `idle` 2, other 3) × 10^9 + idle seconds (paused/done/pane-gone items rank 3); `note` → note/text; `repo` → basename. `dense` maps to `pr-2 py-0.5` cells / `pr-2 pb-1` headers, default to `pr-3 py-1` / `pr-3 pb-1` (the last column drops the right padding as today). Default sizes: status 160/80, session 120/64, change 200/80, awaiting 110/64, note 240/80, repo 160/64 (`size`/`minSize`).

- **GIVEN** one worker row (waiting) and one item row (paused)
- **WHEN** `WatchedTable` renders with `dense`
- **THEN** every existing `watched-table.test.tsx` assertion holds (six headers, cell contents, `data-done`, padding classes now on `<td>`/`<th>`), and clicking the `awaiting` header puts the waiting worker first

#### R8: `CronList` over `DataTable` with the registry order at rest
`components/cron-list.tsx` SHALL replace the `sorted.map(CronListRow)` div-row list with a `DataTable` (`tableId: "cron-list"`, `dense: inline`) of seven columns: `label` (header `entry`, `cronEntryLabel`), `target` (`targetChip`), `schedule` (`describeSchedule`, `truncate` secondary), `rung` (`rung N` or `—`; `sortValue` = `entry.rung` for backoff kinds else `undefined`), `deliver` (the marker text inside `data-testid="cron-list-deliver"` when `deliver` is set and not `immediate`, otherwise nothing), `next` (`in {dur}` / `due` / `—`; **`sortingFn = compareCronEntries`**), `flags` (`muted {rem}` · `pinned` · `orphaned {age}` · `expires {rel}` joined with ` · `, secondary ink). `initialSort = { id: "next", desc: false }`. `lib/cron-list-model.ts` SHALL export `compareCronEntries(a, b)` (the comparator extracted from `sortCronEntries`) and `sortCronEntries` SHALL become `[...entries].sort(compareCronEntries)`. `rowProps(entry)` returns `{ "data-testid": "cron-list-row-{id}", role: "button", tabIndex: 0, className: "cursor-pointer coarse:min-h-[44px]" + (isCronDimmed(entry) ? " opacity-50" : ""), onClick: open, onKeyDown: Enter/Space → open }`. The `+ New entry` chip row, `cron-list-empty`, `cron-list-unresolved`, the `inline` root class, `CronEntryDetailSheet`, and `CronCreateDialog` are unchanged.

- **GIVEN** entries A (`nextFire` in 5m), B (no `nextFire`), C (`nextFire` in 1m, muted)
- **WHEN** `Cron List` renders with no persisted view state
- **THEN** the row order is C, A, B and C carries `opacity-50` — `cron-list.test.tsx`'s existing order assertion passes unchanged
- **AND WHEN** the `entry` header is clicked
- **THEN** rows sort by label ascending and the `<th>` for `entry` reads `aria-sort="ascending"`

#### R9: `CronLog` over `DataTable` with API order at rest
`components/cron-log.tsx` SHALL replace the `deliveries.map(DeliveryRow)` list with a `DataTable` (`tableId: "cron-log"`, `dense: inline`, `rowKey` = `${ts}-${entry}-${index}`) of three columns: `entry` (`delivery.name || delivery.entry`), `outcome` (raw text), `when` (`sortValue = delivery.ts`, cell `{formatDuration(elapsed)} ago` computed at render). `initialSort = null` — the API's most-recent-first order as-is. `rowProps(delivery)`: when the entry exists, `{ "data-testid": "cron-delivery-row-{entry}", role: "button", tabIndex: 0, className: "cursor-pointer coarse:min-h-[44px]", onClick, onKeyDown }`; when the entry is deleted, `{ "data-testid": "cron-delivery-row-{entry}", "aria-disabled": "true", className: "coarse:min-h-[44px]" }` with no role, tabIndex, or handlers. `cron-log-empty`, `cron-log-unresolved`, and `inline` are unchanged.

- **GIVEN** deliveries `soon` then `gone` (API order) where `gone`'s entry was deleted
- **WHEN** `Cron Log` renders
- **THEN** the row order is `soon`, `gone`; clicking `gone` opens nothing and it has no `role="button"`
- **AND WHEN** the `when` header is clicked twice
- **THEN** the rows are oldest-first, then newest-first; a `resetDataTableViewState("cron-log")` returns to API order

#### R10: Tests and intent comments
Unit coverage: `components/data-table.test.tsx` (R2–R6 scenarios: sort cycle + `aria-sort`, single-column replacement, undefined-last, cleared-sort → `initialSort`, resize drag writes once + `<col>` var follows, handle double-click reset, storage round-trip, corrupt JSON / unknown id / non-numeric width fallback, coarse pointer renders no handles, mount registry add/remove), `lib/palette/data-table.test.ts` (0/1/2+ shapes, picker applies reset), `lib/cron-list-model.test.ts` (`compareCronEntries` equals `sortCronEntries` order), updated `cron-list.test.tsx` / `cron-log.test.tsx` / `watched-table.test.tsx` per R7–R9 (existing order and content assertions pass as written; padding assertions target `<td>`/`<th>`). E2e: one added `test()` in `tests/e2e/quake-terminal.spec.ts` — Cron List header click re-sorts and the order survives a reload — and one in `tests/e2e/server-watched-zone.spec.ts` — the WATCHED table renders a header row whose `status` header has `aria-sort`; each carries the Test Intent Comments JSDoc (**Proves:** / **Steps:**). Existing e2e selectors are unchanged.

- **GIVEN** the verification gate `cd app/frontend && npx tsc --noEmit`, `pnpm vitest run src/components/data-table.test.tsx src/components/cron-list.test.tsx src/components/cron-log.test.tsx src/components/watched-table.test.tsx src/lib/cron-list-model.test.ts src/lib/palette/data-table.test.ts`, and `just test-e2e quake-terminal`, `just test-e2e mobile-cron-tabs`, `just test-e2e server-watched-zone`
- **WHEN** apply completes
- **THEN** all are green (never the full suite as a gate)

### Non-Goals

- Virtualization — row counts are small; revisit if `deliveries` grows.
- Column visibility toggles or reordering — TanStack supports them; leave off until asked.
- Any change to `useCronData`, `collectTrackedRows`, `watchedWorkerRows`, or the backend.
- Keyboard-driven column *resizing* — the palette reset is the keyboard path.
- Any change to the four-segment strip, the detail sheet, the create dialog, the stale banner, the summary/hint lines, or the files the 0→4 ladder touches (`quake-terminal.tsx`, `lib/quake-terminal.ts`, `top-bar.tsx`; `app.tsx` only the one-line palette spread).

### Design Decisions

#### TanStack Table over shadcn/Radix
**Decision**: `@tanstack/react-table` as the headless table model; every element rendered in the project's own Tailwind/Control vocabulary.
**Why**: Radix has no table primitive; shadcn's data table is TanStack underneath plus a dependency tree (Radix, cva, tailwind-merge, a generated `components/ui/`) the project deliberately does not carry; the router is already TanStack.
**Rejected**: shadcn/ui data table (the dependency tree); a hand-rolled sort/resize (re-implements stable sort, `sortUndefined`, resize deltas the library already gets right); keeping the div-rows with a header span (a fourth bespoke layout, no resize path).
*Introduced by*: 260912-xi3h-data-table-tanstack

#### Cleared sort means the table's initial sort
**Decision**: the sorting fed to TanStack is `persistedSort ?? initialSort`; a user un-sorting a column returns to the table's declared at-rest order, never to raw input order when an `initialSort` exists.
**Why**: Cron List's at-rest order is a recorded contract (`sortCronEntries`); "no user sort" must mean that order, not whatever the API returned.
**Rejected**: pre-sorting `rows` before handing them to the table (double sorting, and the header would show no `aria-sort` for the default order).
*Introduced by*: 260912-xi3h-data-table-tanstack

#### Resize is mouse-only; reset is the keyboard path
**Decision**: handles render only on fine pointers and are `aria-hidden`; `Table: Reset columns` in the palette restores widths and sort.
**Why**: a touch has no resize gesture and a keyboard width-step chord is scope creep; Constitution V is satisfied by a palette path to undo the mouse-only state.
**Rejected**: keyboard-resizable handles (focusable `<div role="separator">` with arrow keys — more chrome than the tables warrant); no reset at all (a viewer stuck with a bad width).
*Introduced by*: 260912-xi3h-data-table-tanstack

#### Two storage keys for the watched table's two densities
**Decision**: `WatchedTable` persists under `watched` (Server page and mobile `?tab=tasks`) and `watched-dense` (the quake drawer).
**Why**: the same six columns at ~420px and at full page width want different widths; one key would fight itself across mounts.
**Rejected**: one shared key (widths tuned in the drawer break the Server page and vice versa).
*Introduced by*: 260912-xi3h-data-table-tanstack

## Tasks

### Phase 1: Setup

- [x] T001 Add `@tanstack/react-table` from `app/frontend/` via `pnpm add @tanstack/react-table` (latest published major; `package.json` + `pnpm-lock.yaml` updated). Confirm `npx tsc --noEmit` still passes with no consumers. <!-- R1 -->
- [x] T002 [P] Extract `compareCronEntries(a, b)` in `app/frontend/src/lib/cron-list-model.ts`; make `sortCronEntries` = `[...entries].sort(compareCronEntries)`; add a `compareCronEntries` case to `app/frontend/src/lib/cron-list-model.test.ts` asserting it yields the same order as `sortCronEntries` (including undated-last and the label/id tie-break). <!-- R8 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/frontend/src/components/data-table.tsx`: the view-state store (`DATA_TABLE_STORAGE_PREFIX`, `DataTableViewState`, `readDataTableViewState` with per-field clamp/fallback, `writeDataTableViewState`, `resetDataTableViewState`, in-module pub/sub + `storage` listener, `useDataTableViewState`), and the mounted-table registry (`registerMountedDataTable`, `useMountedDataTables` via `useSyncExternalStore`). Model on `hooks/use-local-storage-enum.ts` and `lib/quake-terminal.ts` § Per-viewer persisted preferences. <!-- R5 -->
- [x] T004 In `data-table.tsx`, implement `DataTable<Row>` over `useReactTable` (`getCoreRowModel`, `getSortedRowModel`, `enableMultiSort: false`, `enableSortingRemoval: true`, `sortUndefined: "last"`, `columnResizeMode: "onChange"`, `enableColumnResizing: !coarse`): `overflow-x-auto` wrapper, `<table class="text-xs font-mono table-fixed">` with `--rk-col-<id>` custom properties and `minWidth` = summed widths, `<colgroup>` reading the vars, `<thead>` with `<th scope="col" aria-sort>` + `controlClass({ variant: "toggle", base: DATA_TABLE_HEADER_BASE, pressed })` buttons (`aria-label="Sort by {header}"`, `▴`/`▾` glyph span `aria-hidden`), effective sorting `persistedSort ?? initialSort`, `<tbody>` rows spreading `rowProps(row)` with `<td className={column.className}>` cells; `dense` padding literals (`pr-2 py-0.5` / `pr-3 py-1`, headers `pb-1`, last column no right padding). Register in the mount registry on mount. <!-- R1 R2 R3 -->
- [x] T005 In `data-table.tsx`, add the resize handles (`data-testid="data-table-resize-handle"`, 6px, `cursor-col-resize touch-none`, hover `bg-accent-green/60`, dragging `bg-accent-green`), bound to `header.getResizeHandler()`; clamp to `[minSize, maxSize]`; write the store once on drag end (`onColumnSizingChange` updates local state; `mouseup`/`touchend` → `writeDataTableViewState`); double-click → reset that column's width; omit handles entirely when `useCoarsePointer()` is true. <!-- R4 -->
- [x] T006 [P] Create `app/frontend/src/lib/palette/data-table.ts` with `buildDataTableActions(mounted, reset = resetDataTableViewState)` per R6 (0 → `[]`, 1 → direct `Table: Reset columns`, 2+ → `Table: Reset columns…` optionPicker), and `app/frontend/src/lib/palette/data-table.test.ts` covering the three shapes and that the picker's `onApply` resets each picked id. <!-- R6 -->
- [x] T007 Wire the palette in `app/frontend/src/app.tsx`: import `useMountedDataTables` + `buildDataTableActions`, call `useMountedDataTables()` in AppShell, and spread `...buildDataTableActions(mountedDataTables)` into the existing `paletteActions` memo beside `buildCronActions` (add `mountedDataTables` to the memo deps). No other `app.tsx` change. <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Rewrite `app/frontend/src/components/watched-table.tsx` over `DataTable` per R7: six column defs with species-switching `cell` renderers (extract `NoteCell` for the item row's expand toggle), sort accessors, `rowProps`, `tableId` by density, `className` for stale dimming, forwarded `data-testid="watched-table"`; delete the hand-rolled `<table>`/`WatchedRow`/`TrackedItemRow` prop-threading (`cellPad`/`lastCellPad`/`headPad`). Update `app/frontend/src/components/watched-table.test.tsx`: padding assertions target `<td>`/`<th>`; add "sorting by awaiting puts waiting rows first" and "headers carry aria-sort". <!-- R7 R10 -->
- [x] T009 Rewrite `app/frontend/src/components/cron-list.tsx` over `DataTable` per R8 (seven columns, `initialSort` on `next` with `compareCronEntries`, `rowProps` with role/tabIndex/keyboard open, `dense: inline`); delete `CronListRow` and `ROW_CLASS`. Update `app/frontend/src/components/cron-list.test.tsx`: the existing order and anatomy tests pass unchanged; add "header click re-sorts by entry label and aria-sort reflects it". <!-- R8 R10 -->
- [x] T010 Rewrite `app/frontend/src/components/cron-log.tsx` over `DataTable` per R9 (three columns, `initialSort: null`, inert deleted-entry rows via `rowProps`); delete `DeliveryRow` and `ROW_CLASS`. Update `app/frontend/src/components/cron-log.test.tsx`: the existing API-order test passes unchanged; the deleted-entry test asserts no `role="button"`; add "clicking when sorts oldest-first then newest-first; reset returns to API order". <!-- R9 R10 -->
- [x] T011 Create `app/frontend/src/components/data-table.test.tsx` covering every R2–R6 scenario listed in R10 (sort cycle/aria-sort/single-column/undefined-last/cleared-sort fallback, resize drag writes once + `<col>` var, handle double-click reset, storage round-trip and corrupt fallbacks, coarse pointer via a mocked `matchMedia` renders no handles, mount registry add/remove). Run the scoped Vitest set from R10 and `npx tsc --noEmit`; fix failures. <!-- R2 R3 R4 R5 R6 R10 -->

### Phase 4: Polish

- [x] T012 Add the two e2e tests per R10 — `app/frontend/tests/e2e/quake-terminal.spec.ts` (Cron List header click re-sorts; order survives reload) and `app/frontend/tests/e2e/server-watched-zone.spec.ts` (WATCHED table header row with `aria-sort`) — each with the **Proves:** / **Steps:** JSDoc. Run `just test-e2e quake-terminal`, `just test-e2e mobile-cron-tabs`, `just test-e2e server-watched-zone` (from the repo root; a "webServer exited early" means the rig failed to start, not a failing test — retry once). Fix any selector fallout. <!-- R10 -->

## Execution Order

- T001 blocks T004 (the import); T002 blocks T009.
- T003 blocks T004, T005, T006 (they import the store / registry); T004 blocks T005, T008, T009, T010.
- T006 and T007: T006 blocks T007.
- T011 after T005; T012 after T008–T010.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `@tanstack/react-table` is in `app/frontend/package.json` `dependencies` and the lockfile; no shadcn/Radix/cva/tailwind-merge/`components/ui/` was added; `components/data-table.tsx` exports `DataTable`.
- [x] A-002 R2: Column defs carry `id`, `header`, `sortValue`, optional `sortingFn`, `cell`, `size`, optional `minSize`/`maxSize`/`className`; `undefined` sort values land last in both directions.
- [x] A-003 R3: Header `<th>`s carry `aria-sort`; header buttons use `controlClass`/`Control` `toggle` with `DATA_TABLE_HEADER_BASE`, `aria-label="Sort by …"`, and the `▴`/`▾` glyph; the cycle is none → asc → desc → none, single-column.
- [x] A-004 R4: Fine-pointer tables render resize handles bound to TanStack's resize handler; widths ride `--rk-col-<id>` vars read by `<col>`; the store is written once on drag end; double-click resets the column; coarse pointers render no handles.
- [x] A-005 R5: `runkit-table-<id>` JSON round-trips; corrupt JSON, unknown column ids, non-numeric or out-of-clamp widths, and a throwing localStorage all degrade per field to defaults without error; same-tab subscribers update via pub/sub.
- [x] A-006 R6: `buildDataTableActions` yields `[]` / direct / `…` picker by mounted count; `app.tsx` spreads it into `paletteActions` with exactly one import and one spread line. (Two import lines — `buildDataTableActions` + `useMountedDataTables` — as T007 sanctions; otherwise only the spread and its memo dep changed.)
- [x] A-007 R7: `WatchedTable` renders both species through `DataTable` with six columns, `tableId` by density, and unchanged test ids / `data-done` / dimming.
- [x] A-008 R8: `CronList` renders seven columns with `initialSort` on `next` via `compareCronEntries`; rows are keyboard-reachable buttons; chrome around the table is unchanged.
- [x] A-009 R9: `CronLog` renders three columns in API order at rest; deleted-entry rows are inert (no role/tabIndex/handlers, `aria-disabled`).

### Behavioral Correctness

- [x] A-010 R3: A cleared sort on a table with `initialSort` returns to that order (not input order); on a table with `initialSort: null` it returns to input order.
- [x] A-011 R8: With no persisted view state the Cron List row order equals `sortCronEntries(entries)` — `cron-list.test.tsx`'s order assertion passes as written.
- [x] A-012 R9: With no persisted view state the Cron Log row order equals the API order — `cron-log.test.tsx`'s order assertion passes as written.
- [x] A-013 R7: At rest `WatchedTable`'s row order equals the input order and the existing `watched-table.test.tsx` content assertions pass.

### Scenario Coverage

- [x] A-014 R3: Test covers the three-click cycle and single-column replacement with `aria-sort` assertions.
- [x] A-015 R4: Test covers a drag writing `widths` once and a coarse-pointer render without handles.
- [x] A-016 R5: Test covers the corrupt-value scenario in R5 verbatim (`{ sort: null, widths: { b: 48 } }`) and the non-JSON scenario.
- [x] A-017 R6: Test covers the 2+-mounted picker applying a reset.
- [x] A-018 R8: Test covers header click re-sort by entry label.
- [x] A-019 R9: Test covers `when` sort toggling and reset back to API order.
- [x] A-020 R10: Both new e2e `test()`s exist with **Proves:**/**Steps:** JSDoc and the three scoped e2e specs pass.

### Edge Cases & Error Handling

- [x] A-021 R4: Widths never leave `[minSize, maxSize]`; the `<table>` `minWidth` equals the summed widths so `table-fixed` does not redistribute.
- [x] A-022 R5: `localStorage` throwing on read or write neither crashes the table nor leaves stale subscribers.
- [x] A-023 R9: A `cron-delivery-row-{entry}` for a deleted entry opens nothing on click or Enter.
- [x] A-024 R7: The item row's expand toggle still works inside a `DataTable` cell (state held by `NoteCell`).

### Code Quality

- [x] A-025 Pattern consistency: New code follows the naming and structural patterns of `use-local-storage-enum.ts`, `lib/quake-terminal.ts`, `lib/palette/cron.ts`, and `control.tsx`.
- [x] A-026 No unnecessary duplication: `compareCronEntries` is the single sort comparator; `controlClass` is used for header buttons instead of re-typed button classes; `useCoarsePointer` is the single coarse definition.
- [x] A-027 Type narrowing over assertions: the stored-state parser uses `typeof`/`Number.isFinite` guards, no `as` casts beyond the `JSON.parse` unknown.
- [x] A-028 No magic numbers: `DATA_TABLE_MIN_COL_PX`, `DATA_TABLE_MAX_COL_PX`, the handle width, and the header base classes are named constants; Tailwind classes stay literal strings.
- [x] A-029 No god functions: `DataTable` splits header/handle/body rendering into focused components (>50-line functions have a clear reason). (The `DataTable` function runs ~235 lines unsplit — its header/row JSX closes over a dozen per-render values, so extraction would be pure prop-threading; judged met under the "clear reason" clause, with a nice-to-have finding recorded.)
- [x] A-030 Tests alongside: every new behavior has a colocated `.test.tsx`/`.test.ts`; the two new e2e tests carry intent comments; no change-ID citations in code comments.
- [x] A-031 No polling: no `setInterval`; relative times still compute at render.
- [x] A-032 Comment discipline: comments state constraints the code cannot show (why widths ride CSS vars, why the store writes on drag end), never narrate the next line. (One factual slip — `cron-log.tsx`'s header comment names the wrong storage key — filed as a should-fix finding, not a discipline violation.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The worktree is fresh: `app/frontend/node_modules` was installed with `pnpm install --frozen-lockfile` before apply; `just test-e2e` needs `just setup` once for Playwright browsers.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. Apply already removed everything it obsoleted (`ROW_CLASS` + `CronListRow` in `cron-list.tsx`, `ROW_CLASS` + `DeliveryRow` in `cron-log.tsx`, the hand-rolled `<table>` and the `cellPad`/`lastCellPad`/`headPad` prop-threading in `watched-table.tsx`); `sortCronEntries` keeps its plan-mandated role as the registry-order API wrapping `compareCronEntries`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Install the latest published `@tanstack/react-table` major (9.x at plan time) rather than pinning 8.x | Headless API is stable across 8→9; React 19 already in use; fall back to `^8` only if peer deps reject React 19 | S:60 R:90 A:80 D:75 |
| 2 | Confident | `awaiting` sort value is a rank × 10^9 + idle seconds so state groups stay contiguous and idle-longest sorts within a group | Plan-level reading of "sortable on every column" for a text cell with no natural scalar | S:55 R:90 A:80 D:70 |
| 3 | Confident | Resize store write on `mouseup`/`touchend` via a document-level listener armed on handle press, not per `onColumnSizingChange` | Mirrors the drawer geometry store; avoids a write per pointer move | S:65 R:90 A:85 D:80 |
| 4 | Confident | `useMountedDataTables` via `useSyncExternalStore` over a module-level Map + listener Set | Matches the existing in-module pub/sub idiom; React 19 native | S:60 R:95 A:85 D:80 |

4 assumptions (0 certain, 4 confident, 0 tentative).
