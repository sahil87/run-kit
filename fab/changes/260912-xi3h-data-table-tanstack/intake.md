# Intake: One Data Table — Operator Tasks, Cron List, Cron Log over TanStack Table

**Change**: 260912-xi3h-data-table-tanstack
**Created**: 2026-09-12

## Origin

> Operator Tasks, Cron List and Cron Log render through one shared DataTable component over @tanstack/react-table -- sortable on every column, resizable columns, per-viewer sort/width persistence -- replacing the hand-rolled `<table>` and the two div-row lists. This is Change 5 of the sequential plan at fab/plans/sahil/26-09-12-quake-terminal-drawer.md -- read that file's Standing context and Change 5 sections in full before writing the intake; slug data-table-tanstack. Unlike changes 0-4, this one is FILE-DISJOINT and parallel-capable per the plan (touches watched-table.tsx, cron-list.tsx, cron-log.tsx, a new data-table.tsx -- none of which the sequential ladder touches), so it runs independently from its own fresh main worktree, no dependency on the 0->1->2->3->4 chain.

One-shot `/fab-new` invocation from a fresh `main` worktree (`run-kit.worktrees/data-table-tanstack`, branch `data-table-tanstack`, HEAD `d60c86e6`). The design was settled in the 2026-09-12 `/fab-discuss` session recorded in `fab/plans/sahil/26-09-12-quake-terminal-drawer.md` (§ Decisions of record, § Standing context, § Change 5) and the design study `docs/wiki/operator-console-drawer-studies.html`. Decisions of record carried into this intake verbatim:

- **Tables move to TanStack Table, not shadcn/Radix.** Radix has no table primitive; shadcn's data table is TanStack underneath plus a dependency tree (Radix, cva, tailwind-merge, a generated `components/ui/`) the project deliberately does not carry. Headless model, our rendering.
- **Parallel-capable.** Change 5 edits `watched-table.tsx`, `cron-list.tsx`, `cron-log.tsx` and adds `data-table.tsx` — none of which changes 0–4 (rename → resize → docked compose → operator page → cron ungated) touch — so it runs from its own worktree at any point; if it lands mid-ladder the next ladder change rebases over it trivially. The rename (change 0, PR #959) has already merged, so this intake is written in the `quake-terminal` vocabulary (`quake-terminal.spec.ts`, `QuakeSegments`, `lib/quake-terminal.ts`).
- **Lane hint:** full lane (plan § Sequencing: "2, 3 and 5 are the full lane").

Codebase facts verified 2026-09-12 against `d60c86e6` while writing this intake (they correct two details of the plan text):

- `@tanstack/react-table` is not yet a dependency; `@tanstack/react-router@^1.168.22` is (same family — `pnpm-lock.yaml` already resolves `@tanstack/react-store`, `@tanstack/store`).
- The plan calls the `overflow-x-auto` wrapper "the constitution's table exception". The constitution has no such clause. The governing rule is `fab/project/context.md` § Mobile Responsive: the `.app-shell` and terminal column carry `overflow: hidden` so the *page* never scrolls horizontally, and the bottom bar must not wrap or scroll at 375px. A table that scrolls horizontally *inside its own wrapper* violates neither — that is the intake's reading, recorded as an assumption below.
- The plan says the dependency list lives in `architecture/repo-layout.md`. That file stops at directory granularity and lists no packages. The frontend-stack decisions live in `architecture/overview.md` § Design Decisions ("TanStack Router over React Router"); the new table dependency is recorded there and in the new `ui/data-table.md`.
- `sortCronEntries` (`lib/cron-list-model.ts`) sorts `nextFire` ascending, undated last, ties by label then id. `cron-list.test.tsx` asserts that exact row order by test id. `cron-log.test.tsx` asserts API order (`["cron-delivery-row-soon", "cron-delivery-row-gone"]`).
- `WatchedTable` is mounted twice: `server-watched-zone/watched-zone.tsx` (Server page, default padding, worker rows only) and `watched-tasks.tsx` (quake drawer `dense`, and the mobile operator route `?tab=tasks` non-dense — two species of row).
- Existing selectors the e2e specs depend on (must survive unchanged): `watched-table`, `watched-row`, `watched-row-navigate`, `tracked-item-row`, `tracked-item-expand`, `cron-list`, `cron-list-new`, `cron-list-empty`, `cron-list-unresolved`, `cron-list-row-{id}`, `cron-list-deliver`, `cron-log`, `cron-log-empty`, `cron-log-unresolved`, `cron-delivery-row-{id}` (`tests/e2e/quake-terminal.spec.ts`, `mobile-cron-tabs.spec.ts`, `server-watched-zone.spec.ts`).
- The per-viewer store idiom to copy: `hooks/use-local-storage-enum.ts` (in-module pub/sub keyed on the storage key, `readPersisted` with try/catch, cross-tab via the native `storage` event) and `lib/quake-terminal.ts` § Per-viewer persisted preferences (JSON value, numeric clamping, absent/corrupt/out-of-clamp → defaults, `QUAKE_GEOMETRY_KEY = "runkit-quake-terminal-geometry"`).
- The palette builder idiom to copy: `lib/palette/cron.ts` (`buildCronActions` — pure builder, `…` optionPicker sub-step for entry selection, omit-not-disable with an empty list) registered from `app.tsx`'s `paletteActions` memo (line ~4686) via `useRegisterPaletteActions`.
- Coarse-pointer detection: `hooks/use-coarse-pointer.ts` `useCoarsePointer()` over `COARSE_POINTER_QUERY = "(any-pointer: coarse)"` — the one definition of "coarse", in lockstep with the Tailwind `coarse:` variant.
- Header buttons: `components/control.tsx` `controlClass` / `<Control>` — the single definition of every button-shaped control recipe; the `toggle` variant takes call-site geometry via `base` plus the green latched arm on-state.

## Why

**The pain.** Three list surfaces in the quake terminal and on the Server page render tabular data three different ways: `watched-table.tsx` is a hand-rolled `<table>` with six `<th>`s and per-row cell classes threaded through props (`cellPad`/`lastCellPad`/`headPad`); `cron-list.tsx` and `cron-log.tsx` are `flex` div-rows (`ROW_CLASS`) whose "columns" are `flex-1`/`flex-[2]`/`shrink-0` spans with no header row at all — a reader has to infer what `role: operator` · `every 5 minutes` · `in 4m` mean from position. None of the three sorts on a user's request: the watched table renders in session order, the cron list in `sortCronEntries` order, the cron log in API order, and a user who wants "which worker has been waiting longest" or "which entry fires soonest by target" re-scans by eye. Column widths are fixed by the class recipe; a long note or repo basename truncates at `max-w-[24ch]` regardless of how wide the Server page is. The two div-row lists cannot even show a header without becoming a fourth bespoke layout.

**The consequence of not fixing it.** Every new column or state treatment lands three times (routes-and-shell § "One watched-list component" already exists precisely because two renderings drifted). Change 3 (operator page) puts the Operator Tasks table full-width on desktop, where six fixed-recipe columns look sparse; change 4 (cron ungated) puts Cron List on a Server page footer where a headerless flex row is unreadable next to the WATCHED zone's real table. Adding sort/resize to each surface independently would triple the code and the tests.

**Why this approach.** One headless table model (`@tanstack/react-table`: column defs, sorting state, column sizing state — ~14 kB gzipped, zero runtime deps, the same family as the router already in `dependencies`) rendered by one component in the project's own Tailwind/Control vocabulary. The component owns the table *chrome* — header buttons with `aria-sort`, resize handles, the `<colgroup>` widths, the per-viewer store, the palette reset — and the three consumers own their *cells*: `StatusDot`, the stage chip, `Tip`-wrapped truncation, `isCronDimmed` dimming, the inert deleted-entry row, the row-click → detail sheet. Nothing visual changes at rest; everything gains a header, sort and resize. Rejected: shadcn/ui's data table (TanStack underneath plus Radix, cva, tailwind-merge and a generated `components/ui/` tree the project has deliberately kept out — `code-review.md` even lists `components/ui/` as a skip path that does not exist here); a hand-rolled sort/resize (re-implements what the headless library already gets right — stable sort, `sortUndefined`, resize deltas, RTL); keeping the div-rows and adding a header span row (a fourth layout, no resize path).

## What Changes

### 1. Dependency

Add `@tanstack/react-table` (latest 8.x) to `app/frontend/package.json` `dependencies` via `pnpm add @tanstack/react-table` from `app/frontend/` (lockfile updated in the same commit; a fresh worktree needs `pnpm install --frozen-lockfile` before Vitest/tsc). No shadcn, no Radix, no `components/ui/`, no `cva`/`tailwind-merge`. The library is headless: it ships no CSS and renders nothing; every element below is ours.

### 2. `components/data-table.tsx` — the one table

A generic component and a small module of exports:

```ts
export type DataTableColumn<Row> = {
  id: string;                       // stable column id — the sort/width persistence key
  header: string;                   // the visible label ("status", "session", …) — lowercase like today's <th>s
  /** Sort accessor: a string or number (or undefined → sorts last). Cells with
   *  no natural scalar (the status cell) return the row's display label. */
  sortValue: (row: Row) => string | number | undefined;
  /** Optional comparator overriding the default scalar compare (Cron List's
   *  `next` column uses sortCronEntries' tie-break). */
  sortingFn?: (a: Row, b: Row) => number;
  cell: (row: Row) => ReactNode;    // the consumer's renderer — keeps StatusDot, chips, Tip, buttons
  /** Sizing in px. `size` is the default width; `minSize` keeps six columns
   *  legible with horizontal scroll rather than wrapping. */
  size: number;
  minSize?: number;                 // default DATA_TABLE_MIN_COL_PX (48)
  maxSize?: number;                 // default DATA_TABLE_MAX_COL_PX (960)
  /** Cell-level className (alignment, `whitespace-nowrap`, secondary ink). */
  className?: string;
};

export type DataTableSort = { id: string; desc: boolean } | null;

export type DataTableRowProps = Pick<
  HTMLAttributes<HTMLTableRowElement>,
  "className" | "onClick" | "onKeyDown" | "role" | "tabIndex" | "aria-disabled"
> & { "data-testid"?: string; "data-done"?: string };

export function DataTable<Row>({
  tableId,        // "watched" | "watched-dense" | "cron-list" | "cron-log" — the storage + palette identity
  columns,
  rows,
  rowKey,         // (row) => string — React key; also the row identity for tests
  initialSort,    // DataTableSort — the at-rest order when the viewer has no persisted sort (null = input order)
  dense = false,  // quake drawer variant: pr-2 / py-0.5 instead of pr-3 / py-1 (today's WatchedTable `dense`)
  rowProps,       // (row) => DataTableRowProps — test ids, data-done, dimming class, click/keyboard handlers
  className,      // extra classes on the <table> (e.g. the stale `opacity-50`)
  "data-testid": testId,  // forwarded to the <table> — WatchedTable keeps "watched-table"
}: DataTableProps<Row>): JSX.Element
```

**Rendering.** A `<div className="overflow-x-auto">` wrapper (min-width follows the sum of column widths, so six columns at their `minSize` scroll horizontally inside the wrapper at the 420px drawer floor and the 375px mobile route instead of wrapping — the page itself never gains a horizontal scrollbar, per `context.md`'s no-page-overflow rule) → `<table className="text-xs font-mono table-fixed">` → `<colgroup>` with one `<col>` per column whose `style={{ width: var(--rk-col-<id>) }}` reads a CSS custom property set on the `<table>` from TanStack's `column.getSize()` (widths change by restyling the `<table>`'s custom properties, not by re-rendering cells) → `<thead>` with one `<tr>` of `<th scope="col" aria-sort="ascending|descending|none">` cells → `<tbody>` with one `<tr {...rowProps(row)}>` per row and `<td className={column.className}>` cells calling `column.cell(row)`.

**Header cells.** Each `<th>` contains a `<Control variant="toggle" base={DATA_TABLE_HEADER_BASE} pressed={sorted}>` button — `DATA_TABLE_HEADER_BASE` is today's header typography (`text-left text-[10px] uppercase tracking-wide text-text-secondary font-normal`, full cell width, the `pr-3 pb-1` / dense `pr-2 pb-1` padding) so the header looks identical at rest; the green latched arm marks the sorted column (scheme C: green = state). The label is followed by a sort glyph span: `▴` ascending, `▾` descending, nothing at rest (`aria-hidden`; the state is on `aria-sort`). The button's `aria-label` is `Sort by {header}`. 
Click / Enter / Space cycle `none → ascending → descending → none` (TanStack's default toggle with `enableMultiSort: false`, `enableSortingRemoval: true`); a cleared state means "back to `initialSort`" — the effective sorting fed to the table is `persistedSort ?? initialSort`, never `[]`-means-input-order for a table that has an `initialSort`. Undefined sort values sort last in both directions (`sortUndefined: "last"`).

**Resize handles.** Every header cell except the last carries an absolutely positioned 6px-wide handle on its right edge (`cursor-col-resize`, `touch-none`, extends the full header height, `aria-hidden` — resize is mouse-only by design; the keyboard path is the palette reset below). `columnResizeMode: "onChange"` with `columnResizeDirection: "ltr"`; the handle binds TanStack's `header.getResizeHandler()` for `onMouseDown`/`onTouchStart`. During a drag the handle wears `bg-accent-green`; on hover it tints `bg-accent-green/60` (the hover vocabulary — animated elements turn green; a static colour under `prefers-reduced-motion`). Widths are clamped to `[minSize, maxSize]` by TanStack; the store write happens **once on drag end** (pointer-up), mirroring the drawer geometry store's write-on-pointer-up. Double-click on a handle resets that one column to its `size`.
`enableColumnResizing` is `false` while `useCoarsePointer()` is true — no handles render on touch devices (a touch has no resize gesture; header-tap sorting stays).

**Persistence** (Constitution IV — per-viewer state lives in localStorage). One JSON key per `tableId`:

```ts
export const DATA_TABLE_STORAGE_PREFIX = "runkit-table-";   // + tableId → "runkit-table-cron-list"
export type DataTableViewState = {
  sort: { id: string; desc: boolean } | null;               // null = "use initialSort"
  widths: Record<string, number>;                           // column id → px, only user-resized columns
};
export function readDataTableViewState(tableId: string, columns: …): DataTableViewState  // absent/corrupt/unknown-column/out-of-clamp → defaults, per field
export function writeDataTableViewState(tableId: string, state: DataTableViewState): void
export function resetDataTableViewState(tableId: string): void                          // removeItem + notify
export function useDataTableViewState(tableId, columns): [DataTableViewState, setters…]   // the pub/sub hook
```

The store follows `use-local-storage-enum.ts`'s in-module pub/sub (same-tab subscribers — the drawer's table and the Server page's table may both be mounted — plus the native `storage` event cross-tab) and `lib/quake-terminal.ts`'s value discipline: `JSON.parse` in try/catch; `sort.id` must name a current column or it degrades to `null`; each width must be a finite number and is clamped into `[minSize, maxSize]` of its column, unknown column ids are dropped; anything unusable resolves to the defaults without error and is overwritten on the next write. The `<colgroup>` reads `widths[id] ?? column.size`.

**Mounted-table registry + palette.** `data-table.tsx` keeps a module-level `Map<tableId, { label: string }>` of currently mounted tables (register on mount, unregister on unmount, `subscribeMountedDataTables(listener)` for the palette). `lib/palette/data-table.ts` exports the pure builder:

```ts
export function buildDataTableActions(mounted: { id: string; label: string }[]): PaletteAction[]
// 0 mounted  → []                                   (omit-not-disable)
// 1 mounted  → [{ id: "table-reset-columns", label: "Table: Reset columns", onSelect: reset(that id) }]
// 2+ mounted → [{ id: "table-reset-columns", label: "Table: Reset columns…",
//                 optionPicker: { options: mounted.map(m => ({ key: m.id, label: m.label })),
//                                 placeholder: "Pick a table to reset — Space toggle · Enter apply",
//                                 onApply: keys => keys.forEach(reset) } }]
```

Labels: `Operator Tasks` (`watched-dense`), `Watched` (`watched` — the Server page zone), `Cron List`, `Cron Log`. Reset clears the table's key (sort back to `initialSort`, widths back to `size`) — this is Constitution V's keyboard path for the mouse-only resize. `app.tsx` subscribes to the registry with a `useSyncExternalStore`-style hook exported by `data-table.tsx` and spreads `buildDataTableActions(mounted)` into the existing `paletteActions` memo beside the cron group.

### 3. Consumer: `watched-table.tsx` (Operator Tasks + the Server page WATCHED zone)

`WatchedTable` keeps its props (`rows`, `stale`, `nowSeconds`, `onNavigate`, `dense`) and its two row species, and becomes a thin column-definition + `DataTable` mount:

| id | header | `sortValue` | cell (worker row) | cell (item row) |
|---|---|---|---|---|
| `status` | status | `win.name` / `item.id` | `StatusDot` + name navigate button (`watched-row-navigate`) | kind chip + id |
| `session` | session | `session` / `item.session` | text | text or `—` |
| `change` | change | `change ?? ""` / `refs` | change · stage chip · paused · done | `Tip`-truncated refs |
| `awaiting` | awaiting | `agentState` rank (`waiting` 0 · `active` 1 · `idle` 2 · other 3) then idle seconds | `awaitingCell` text, yellow when waiting | paused / done / pane gone / `—` |
| `note` | note | `win.note ?? ""` / `item.text ?? ""` | `Tip`-truncated note + age, stale-dimmed | the expand-in-place toggle (`tracked-item-expand`) |
| `repo` | repo | `repoBasename(...)` | `Tip`-truncated basename | basename · `updated … ago` |

`rowProps` returns `{ "data-testid": "watched-row" | "tracked-item-row", "data-done": done ? "true" : undefined, className: done ? "opacity-50" : undefined }` — exactly today's `<tr>` attributes. `tableId` is `dense ? "watched-dense" : "watched"` (the drawer at ≥420px and the Server page at full width want different widths; the mobile `?tab=tasks` mount is non-dense and shares the Server page key).
 `initialSort` is `null` (today's derived order — session order then window index — is the at-rest order). The stale `opacity-50` moves to `className`; `data-testid="watched-table"` is forwarded. The `TrackedItemRow`'s `expanded` state moves into a small `NoteCell` component so the cell renderer can hold state. Default `size`s reproduce today's proportions roughly (status 160, session 120, change 200, awaiting 110, note 240, repo 160) with `minSize` 48–80 so the six columns keep legible labels at 420px with horizontal scroll.

### 4. Consumer: `cron-list.tsx` (Cron List)

The `sorted.map(CronListRow)` div-row list becomes a `DataTable` with columns:

| id | header | `sortValue` / `sortingFn` | cell |
|---|---|---|---|
| `label` | entry | `cronEntryLabel(entry)` | label text (primary ink) |
| `target` | target | `targetChip(entry)` | chip text (secondary) |
| `schedule` | schedule | `describeSchedule(entry)` | sentence (secondary, truncated) |
| `rung` | rung | `entry.rung` (undefined for non-backoff → last) | `rung N` or `—` |
| `deliver` | deliver | `deliverMarker ?? ""` | marker text in `data-testid="cron-list-deliver"` or nothing (the norm adds zero chrome) |
| `next` | next | **`sortingFn` = `sortCronEntries`' comparator** (`nextFire` asc, undated last, label, id) | `in {dur}` / `due` / `—` |
| `flags` | flags | joined flags string | `muted {rem}` · `pinned` · `orphaned {age}` · `expires {rel}` (secondary) |

`initialSort = { id: "next", desc: false }` — so at rest the row order is exactly `sortCronEntries(entries)` and the recorded scenario ("C, A, B — C dimmed, not omitted") plus `cron-list.test.tsx`'s asserted order hold unchanged. Extract the comparator from `sortCronEntries` as `compareCronEntries(a, b)` in `lib/cron-list-model.ts` so the list sort and the table sort are one function (`sortCronEntries` becomes `[...entries].sort(compareCronEntries)`). `rowProps` returns `{ "data-testid": "cron-list-row-{id}", className: dimmed ? "opacity-50 cursor-pointer" : "cursor-pointer", role: "button", tabIndex: 0, onClick: open, onKeyDown: Enter/Space → open }` — the row stays a single keyboard-reachable target as the `<button>` was (Constitution V). Everything around the table is unchanged: the `+ New entry` chip row, `cron-list-empty`, `cron-list-unresolved`, the `inline` prop (still on `CronList` — it governs the detail sheet's in-container anchoring, not the table), `CronEntryDetailSheet`, `CronCreateDialog`. `tableId = "cron-list"`, `dense` follows `inline` (the drawer mount), row height keeps the `coarse:min-h-[44px]` floor via `rowProps.className`.

### 5. Consumer: `cron-log.tsx` (Cron Log)

The `deliveries.map(DeliveryRow)` list becomes a `DataTable` with columns `entry` (`delivery.name || delivery.entry`), `outcome` (`delivery.outcome`, raw text), `when` (`sortValue = delivery.ts`, cell `{dur} ago` at render time — no timer). `initialSort = null`: at rest the rows are the API's most-recent-first order as-is (the memory's "rendered as-is" rule); a user sort is an additive client override that persists per viewer like any other table; `Table: Reset columns` returns to API order. `rowProps`: a known entry gets `role="button"`, `tabIndex=0`, click/Enter/Space → open the sheet; a since-deleted entry gets no role, no `tabIndex`, `aria-disabled` — the inert-row rule ("valid history that opens nothing") expressed on a `<tr>` instead of a `<div>`; both carry `data-testid="cron-delivery-row-{entry}"`. `tableId = "cron-log"`; `cron-log-empty` / `cron-log-unresolved` / `inline` unchanged.

### 6. Tests

- **New `components/data-table.test.tsx`**: header click cycles `aria-sort` none → ascending → descending → none and re-orders rows; a cleared sort returns to `initialSort`; undefined values sort last; `enableMultiSort` off (a second header click replaces, never stacks); a resize drag (pointerdown/move/up on the handle) writes `widths[id]` once on release and the `<col>` var follows; double-click on a handle resets that column; storage round-trip; corrupt JSON / unknown column id / non-numeric width fall back to defaults; coarse pointer (mocked `matchMedia`) renders no handles but still sorts; `buildDataTableActions` 0/1/2+ shapes (in `lib/palette/data-table.test.ts`).
- **Updated `cron-list.test.tsx`**: the default-order test is unchanged and must pass as written; add "header click re-sorts by label and `aria-sort` reflects it"; the anatomy test keeps its `toHaveTextContent` assertions (they run against the whole `<tr>`).
- **Updated `cron-log.test.tsx`**: the API-order test unchanged; add "clicking `when` sorts oldest-first, the reset returns to API order"; deleted-entry row has no `role="button"`.
- **Updated `watched-table.test.tsx`**: the padding tests (`py-0.5 / pr-2` vs `py-1 / pr-3`) move to the `<td>`/`<th>` emitted by `DataTable`; all other assertions (six columns, cells, dims, expand toggle) hold; add "sorting by `awaiting` puts waiting rows first".
- **`lib/cron-list-model.test.ts`**: `compareCronEntries` is the extracted comparator; `sortCronEntries` tests unchanged.
- **e2e** (`quake-terminal.spec.ts`, `mobile-cron-tabs.spec.ts`, `server-watched-zone.spec.ts`): selectors unchanged and green. Add one `test()` to `quake-terminal.spec.ts` — "Cron List header click re-sorts and the order survives a reload" (with the Test Intent Comments JSDoc: Proves / Steps) — and one to `server-watched-zone.spec.ts` — "the WATCHED table has a real header row with sortable columns". No new spec file.
- **Verification gate** (plan § Standing context): `npx tsc --noEmit` + the affected Vitest suites + scoped e2e (`just test-e2e quake-terminal`, `just test-e2e mobile-cron-tabs`, `just test-e2e server-watched-zone`) — never the full suite as a gate.

### 7. Non-goals

- Virtualization (row counts are small; revisit if `deliveries` grows).
- Column visibility toggles / column reordering (TanStack supports them — leave off until asked).
- Any change to the data hooks (`useCronData`, `collectTrackedRows`, `watchedWorkerRows`) or the backend.
- Keyboard-driven column *resizing* (the palette reset is the keyboard path; a chord-driven width step is not in scope).
- Any change to the four-segment strip, the detail sheet, the create dialog, the stale banner, or the summary/hint lines above the tables.
- Touching any file the 0→4 ladder touches (`quake-terminal.tsx`, `lib/quake-terminal.ts`, `top-bar.tsx`, `app.tsx` beyond the one-line palette spread, `ui/quake-terminal.md` beyond the one-sentence pointer below).

## Affected Memory

- `run-kit/ui/data-table` (new): the shared `DataTable` — column contract, header/sort/`aria-sort` semantics, the resize handle and its coarse-pointer gate, `runkit-table-<id>` view-state store (shape, clamping, corrupt fallback, pub/sub), the mounted-table registry + `Table: Reset columns` palette action, the four table ids, Design Decisions: "TanStack Table over shadcn/Radix", "Cleared sort means the table's initial sort", "Resize is mouse-only; reset is the keyboard path", "Two storage keys for the watched table's two densities".
- `run-kit/ui/cron-console-tabs` (modify): § `Cron List` is the registry — rows are `DataTable` rows with a header (`entry · target · schedule · rung · deliver · next · flags`); the sort sentence becomes "default order `sortCronEntries` (the `next` column's initial ascending sort); a header click is a per-viewer override"; § `Cron Log` is deliveries only — "API most-recent-first order at rest; a user sort is an additive client override"; § Mobile parity and e2e coverage — the new spec test; the components list gains `components/data-table.tsx`.
- `run-kit/ui/routes-and-shell` (modify): § Server Page WATCHED Zone and Design Decision "One watched-list component for the Server page and the quake terminal" — `WatchedTable` now renders over `DataTable` (header row, sortable, resizable; `watched` vs `watched-dense` keys).
- `run-kit/ui/quake-terminal` (modify, one sentence): § Desktop segments — the Operator Tasks segment's table is the shared `DataTable`-backed `WatchedTable` (pointer to `ui/data-table`). Kept to a pointer so the 0→4 ladder's rewrites of this file rebase trivially.
- `run-kit/ui/keyboard-and-palette` (modify): § Command Palette Actions gains the `Table: Reset columns[…]` entry (mounted-table gated, `…` picker with 2+ tables).
- `run-kit/architecture/overview` (modify): § Design Decisions gains "TanStack Table over shadcn/Radix" beside "TanStack Router over React Router" (the frontend-stack decision home; `repo-layout.md` lists no packages).
- `run-kit/ui/dialogs-and-state` (modify, if it carries the localStorage key inventory): add `runkit-table-<id>`.
- `run-kit/ui/index` (regenerate via `fab docs-index` — the new file's row).

## Impact

**Frontend only** (`app/frontend/`). No backend, no API, no route, no tmux change.

- New: `src/components/data-table.tsx`, `src/components/data-table.test.tsx`, `src/lib/palette/data-table.ts`, `src/lib/palette/data-table.test.ts`.
- Modified: `src/components/watched-table.tsx` (+ test), `src/components/cron-list.tsx` (+ test), `src/components/cron-log.tsx` (+ test), `src/lib/cron-list-model.ts` (+ test — extract `compareCronEntries`), `src/app.tsx` (one import + one spread in the `paletteActions` memo), `package.json` + `pnpm-lock.yaml`.
- e2e: `tests/e2e/quake-terminal.spec.ts`, `tests/e2e/server-watched-zone.spec.ts` (one added `test()` each, JSDoc intent comments); `mobile-cron-tabs.spec.ts` unchanged but in the gate.
- Untouched mounts whose props do not change: `server-watched-zone/watched-zone.tsx`, `watched-tasks.tsx`, the quake terminal drawer, the mobile operator route.
- Bundle: +~14 kB gzipped (`@tanstack/react-table`), loaded with the main chunk (the tables live in the always-present drawer).
- Behavioral contract: at rest every table renders the same rows in the same order with the same cells as today; new: a header row on Cron List / Cron Log, click-to-sort, drag-to-resize (fine pointers), per-viewer persistence, one palette action.
- Risk surface: e2e specs assert row test ids and text content on the row element — a `<tr>` still contains every cell's text, so `toHaveTextContent` assertions hold; the `ROW_CLASS` `coarse:min-h-[44px]` touch floor must move onto the `<tr>`/`<td>` so mobile tap targets do not shrink; `table-fixed` + `<colgroup>` widths need `min-w` on the `<table>` equal to the summed widths or the browser redistributes; the Tailwind scanner reads literal classes only, so padding variants stay literal strings in `data-table.tsx`.
- Merge topology: parallel to the 0→4 ladder; the only shared file is `app.tsx` (one spread line — change 3 also edits `app.tsx`, so whichever lands second rebases one hunk) and `ui/quake-terminal.md` (one pointer sentence).

## Open Questions

- None blocking. Four choices the plan left open are decided as Confident rows 18–21 (header `Control` variant, the `watched`/`watched-dense` key split, default column sizes, double-click handle reset) — cheap to revisit via `/fab-clarify` if any reads wrong.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `@tanstack/react-table` headless; no shadcn, Radix, `cva`, `tailwind-merge`, or `components/ui/` | Plan § Decisions of record, verbatim; `code-review.md` names `components/ui/` as a path this repo does not have | S:95 R:70 A:95 D:95 |
| 2 | Certain | Cron List at rest = `sortCronEntries` order, expressed as `initialSort` on the `next` column with the extracted `compareCronEntries` comparator | Plan § Change 5 item 3; `cron-list.test.tsx` asserts the exact order; extracting the comparator keeps one sort function | S:95 R:85 A:95 D:90 |
| 3 | Certain | Cron Log at rest = API most-recent-first (`initialSort: null`); a user sort is an additive override | Plan § Change 5 item 3; memory § `Cron Log` is deliveries only ("rendered as-is") | S:95 R:90 A:95 D:95 |
| 4 | Certain | Row test ids / `data-done` / dimming / click-to-sheet / inert deleted row / `+ New entry` / empty and no-server hints are unchanged | Plan item 3 "unchanged"; three e2e specs select on them | S:95 R:60 A:95 D:95 |
| 5 | Certain | Persistence in localStorage as `runkit-table-<id>` JSON, pub/sub + clamping idiom of `use-local-storage-enum.ts` / `lib/quake-terminal.ts` | Plan item 4; Constitution IV per-viewer carve-out; both idioms verified in source | S:90 R:85 A:95 D:90 |
| 6 | Certain | `Table: Reset columns` palette action is the keyboard path for the mouse-only resize | Plan item 4; Constitution V; pure-builder idiom of `lib/palette/cron.ts` | S:90 R:90 A:95 D:90 |
| 7 | Certain | Non-goals: virtualization, column visibility, data-hook changes | Plan § Change 5 Non-goals verbatim | S:95 R:95 A:95 D:95 |
| 8 | Certain | Verification = tsc + affected Vitest + scoped e2e, never the full suite as a gate | Plan § Standing context | S:95 R:95 A:100 D:100 |
| 9 | Certain | `DataTable` props: `tableId`, `columns`, `rows`, `rowKey`, `initialSort`, `dense`, `rowProps`, `className`, `data-testid`; `inline` stays on `CronList`/`CronLog` (it governs the sheet's anchoring, not the table) | Plan lists `inline` among DataTable props, but in the consumers it makes the root `relative` for the detail sheet — a consumer concern; the table has no use for it | S:80 R:85 A:85 D:75 |
| 10 | Certain | `<table>` inside an `overflow-x-auto` wrapper; `minSize` per column so six columns scroll horizontally at 420px / 375px rather than wrapping; the page never scrolls horizontally | Plan item 2; the "constitution's table exception" does not exist — `context.md`'s rule bans *page* overflow, which an internal scroller does not cause | S:80 R:80 A:80 D:80 |
| 11 | Certain | Column resizing: `columnResizeMode: "onChange"`, widths as CSS custom properties on the `<table>` read by `<col>`s, store write once on pointer-up, disabled when `useCoarsePointer()` | Plan item 2; `useCoarsePointer` is the one "coarse" definition; write-on-release mirrors the geometry store | S:85 R:85 A:85 D:80 |
| 12 | Certain | Sort cycle none → asc → desc → none, single-column only (`enableMultiSort: false`); a cleared state falls back to `initialSort`, never to raw input order for a table with an `initialSort` | TanStack default cycle; small tables; keeps assumption 2's contract when a user un-sorts | S:70 R:90 A:85 D:75 |
| 13 | Certain | Row interaction on a `<tr>`: `role="button"` + `tabIndex=0` + click/Enter/Space via `rowProps`; a deleted-entry log row gets none of these (plus `aria-disabled`) | Today the row is a full-row `<button>`; a `<tr>` cannot be a button, and Constitution V needs the row keyboard-reachable; the inert rule is memory-recorded | S:70 R:85 A:85 D:75 |
| 14 | Certain | Cron List columns `entry · target · schedule · rung · deliver · next · flags` (flags leave the label span for their own column) | Plan item 3 names exactly these seven; row-level `toHaveTextContent` assertions are unaffected | S:90 R:85 A:85 D:85 |
| 15 | Confident | Palette shape: omitted with no mounted table, direct `Table: Reset columns` with one, `Table: Reset columns…` optionPicker with two or more (mounted-table registry in `data-table.tsx`) | Plan says "the focused/visible table"; a mount registry plus the existing `…` picker idiom is the deterministic reading; omit-not-disable is the cron builder's rule | S:60 R:85 A:80 D:65 |
| 16 | Certain | Memory placement: a new `ui/data-table.md` (not a section in `visual-design.md`); the dependency decision lands in `architecture/overview.md` § Design Decisions | Plan leaves this to the intake; `visual-design.md` is ~720 lines; `repo-layout.md` lists no packages, `overview.md` already holds "TanStack Router over React Router" | S:65 R:95 A:85 D:75 |
| 17 | Confident | `WatchedTable` sort accessors: status → name/id, awaiting → state rank (waiting · active · idle · other) then idle seconds, others → their display string; `initialSort: null` keeps today's derived order at rest | Plan gives no per-column accessor; these are the only readings that make "sortable on every column" meaningful for the two-species table | S:55 R:85 A:80 D:70 |
| 18 | Confident | Header cells are `<Control variant="toggle" base={header typography} pressed={sorted}>` — the green latched arm marks the sorted column, `▴`/`▾` glyph after the label, nothing at rest | Plan says "Control-primitive buttons carrying aria-sort and the sort glyph" without naming the variant; `toggle` + latched arm is the vocabulary's "green = state", but a bare-styled button with only the glyph is equally valid | S:50 R:90 A:60 D:45 |
| 19 | Confident | Two storage keys for the watched table — `watched` (Server page + mobile `?tab=tasks`) and `watched-dense` (the drawer) | Plan says "per table"; the same six columns at ~420px and at full page width want different widths, so one key would fight itself; a single key is the simpler alternative | S:45 R:90 A:65 D:45 |
| 20 | Confident | Default `size`/`minSize` values (status 160/80, session 120/64, change 200/80, awaiting 110/64, note 240/80, repo 160/64; cron/log columns analogous; global clamp 48–960 px) and a 6px handle | Plan gives no numbers; these approximate today's rendered proportions and are trivially tuned at apply | S:35 R:95 A:70 D:50 |
| 21 | Confident | Double-click on a resize handle resets that one column's width | Not in the plan; mirrors the drawer grips' double-click reset (change 1) and costs one handler | S:30 R:95 A:75 D:55 |

21 assumptions (15 certain, 6 confident, 0 tentative, 0 unresolved).
