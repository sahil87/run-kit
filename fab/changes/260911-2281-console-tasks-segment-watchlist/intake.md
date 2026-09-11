# Intake: Console Operator Tasks Segment — the Operator Watchlist in the Quake Console

**Change**: 260911-2281-console-tasks-segment-watchlist
**Created**: 2026-09-11

## Origin

Conversational — a live design discussion that started from a fab-kit session's proposal and ended in a
user-confirmed decision. Created promptless via `/fab-proceed`'s create-new dispatch (no questions asked;
every choice that would have been a question is a graded row in `## Assumptions`).

> Add a tab in the quake terminal (the operator console overlay) that shows the list of tasks the fab
> operator is tracking. A fab-kit session proposed that fab write an HTML frame
> (`$XDG_STATE_HOME/fab/operator/<slug>.html`, sibling to the operator state YAML) on every tick and that
> run-kit add a console tab displaying that local HTML file by path.

**Decision reached (user confirmed)**: build the tab, but render it from the watchlist run-kit already
derives — NOT from a fab-written HTML file. The tab is a third segment in the operator console — `Operator Terminal | Activity | Operator Tasks`
(the `Terminal` segment is relabelled `Operator Terminal` in this change; a parallel change renames
`Activity` into `Cron List` / `Cron Log`, so the merged strip reads
`Operator Terminal | Operator Tasks | Cron List | Cron Log`); its body is the same watched-worker list the tmux Server page's WATCHED zone already
renders, through ONE shared component. No fab-kit change, no new YAML fields, no new backend route.

Key decisions carried from the conversation:

1. **Source of truth is the derived watchlist** — run-kit already reads
   `$XDG_STATE_HOME/fab/operator/<slug>.yaml` tolerantly (`app/backend/internal/cron/watchlist.go`:
   `ParseWatchlist`/`ReadWatchlist`, `WatchlistEntry{ChangeID, Pane, Repo, Session, Stage, Agent, Branch}`),
   joins entries onto windows by pane ID (`app/backend/internal/sessions/sessions.go`: `joinWatchlist`,
   plus `operatorLastTickAt`/`operatorStale` stamped per session), and ships the result in the sessions
   payload over the state socket. The frontend already holds every fact the tab needs.
2. **Shared component** — the Server page WATCHED zone (`components/server-clock-dashboard/watched-zone.tsx`,
   change `260910-1rx0`) and the new console segment render through one watched-list component.
3. **Plumbing follows the Activity segment exactly** (change `260910-6ehs`): `ConsoleSegments` strip value,
   `OperatorConsoleRequest.segment`, the mobile `?tab=` search param, the desktop `?tab=` handoff, a palette
   twin, console-local ephemeral segment state.
4. **Rejected**: fab-authored HTML displayed by path (recorded below as a design decision).
5. **Naming (user decided)**: the new segment's label is `Operator Tasks` and the existing `Terminal`
   segment is relabelled `Operator Terminal` in this change. Why two words: a parallel change renames the
   `Activity` segment into `Cron List` and `Cron Log`, so after both merge every segment carries its domain
   prefix — `Operator Terminal | Operator Tasks | Cron List | Cron Log`. Labels only: the `tab` values
   (`terminal`, `tasks`), the `?tab=` param values, and the codebase's internal vocabulary
   (`watched`/`watchlist` — `WatchedZone`, `monitored*`, the watched underbar) do not change.
6. **Merge hygiene with the parallel Activity rename**: that change also edits
   `components/terminal-activity-tabs.tsx` (the `activity` entry) and the tests asserting the `Activity`
   label. This change touches ONLY the `terminal` entry's label and appends the `tasks` entry — it does not
   reorder, rename, or otherwise touch the `activity` entry or any `Activity`-label assertion — so the
   two diffs merge without a manual conflict resolution.

## Why

**The pain point.** The operator console (⌘J) is where the user talks to the fab operator and watches
its terminal, but the *set of workers the operator is tracking* is visible only on the tmux Server page
(`/$server`, the WATCHED zone) or one flyout at a time on sidebar window rows. Answering "what is the
operator watching right now, and which of those is waiting on me?" costs a navigation away from whatever
terminal the user is in. The console is the natural home: it is an overlay on every route, already
server-scoped, already carries the operator's tick-age stamp, and already has a segment header built for
exactly this kind of secondary view (Activity).

**Why not the fab-written HTML frame.** The fab-kit proposal (fab writes `<slug>.html` beside the state
YAML every tick; rk shows it by path) would cost run-kit:

- a new route serving an arbitrary local file into the SPA, plus a sandboxed iframe to host it;
- a refresh story — client polling (a listed anti-pattern in `fab/project/code-quality.md`) or a new
  mtime-watch broadcast on the SSE hub;
- a second cross-repo file contract beside the slug rule (`cron.FabOperatorSlug`), with its own schema
  drift risk;
- a foreign-looking page inside the drawer: no theme tokens, no terminal font, no `StatusDot` channels,
  no row-click navigation, no shared staleness treatment.

Meanwhile run-kit *already* derives the watchlist from that same directory (Constitution II — derive at
request time; Constitution X — nothing underivable is pushed), joins it to live tmux facts fab does not
have (window name, live agent state, `@rk_win_note`, ghost status), and re-renders on the sessions SSE
cadence for free. Rendering in rk gives a themed, live, navigable list with zero new contract surface.

**If we don't do it.** The user keeps navigating to `/$server` to see the watchlist, or fab-kit ships the
HTML frame and rk grows an iframe-by-path route it would have to secure and refresh forever.

**Why a shared component.** Two renderings of the same rows (Server page table + console list) would
drift the moment one gains a column or a state treatment. Extracting the WATCHED zone's row rendering
into one component keeps the Server page byte-equivalent and gives the console the same six columns,
the same `StatusDot` + watched underbar, the same note-staleness dimming, the same empty states.

## What Changes

Frontend-only plus spec/memory hydration. No backend change, no new HTTP route, no new tmux option, no
new hook, no fab-kit change. The tolerant external-contract read of the operator state file is untouched.

### 1. Shared watched-list component (extract from the WATCHED zone)

Extract the row rendering of `components/server-clock-dashboard/watched-zone.tsx` into ONE reusable
component that both mounts consume. Concretely:

- **Pure helpers** (new, in `components/server-clock-dashboard/model.ts` — the zone module's existing
  pure-helper file — or a sibling `watched-model.ts`):
  - `collectWatchedRows(sessions: ProjectSession[]): { session: string; win: WindowInfo }[]` — one row
    per non-ghost window with `monitored === true`, ordered by session order then window index (today's
    inline loop in `WatchedZone`, lifted verbatim).
  - `watchlistStatus(sessions: ProjectSession[], nowSeconds: number): { stale: boolean; tickAgeSeconds: number | null; hasOperator: boolean }`
    — `stale` = any session `operatorStale === true`; `tickAgeSeconds` from the max `operatorLastTickAt`
    (`null` when 0 everywhere); `hasOperator` = tick > 0 or any `role === "operator"` window (today's
    inline derivations, lifted verbatim).
- **Shared presentational component** `WatchedTable` (new file `components/watched-table.tsx`, or kept
  inside the `server-clock-dashboard/` module and exported — plan's choice; one file, one export used by
  both mounts):

  ```tsx
  export function WatchedTable({
    rows, stale, nowSeconds, onNavigate, dense = false,
  }: {
    rows: { session: string; win: WindowInfo }[];
    stale: boolean;
    nowSeconds: number;
    onNavigate: (windowId: string) => void;
    /** Console variant: tighter cell padding, header row kept. */
    dense?: boolean;
  })
  ```

  It renders today's `<table data-testid="watched-table">` with the same six columns — status
  (`<StatusDot win watched={{ stale }} />` + window-name `<button data-testid="watched-row-navigate">`),
  session, change (`monitoredChange` · `monitoredStage` badge), awaiting (`waiting {dur}` in
  `text-signal-yellow` / `busy` / `idle {dur}` / `—`), note (truncated + `Tip`, `· {age} ago`, dimmed past
  `NOTE_STALE_SECONDS`), repo (basename + `Tip`) — the same `data-testid="watched-row"` rows, the same
  `opacity-50` whole-table dimming when `stale`. `WatchedRow` and `awaitingCell` move with it unchanged.
- **`WatchedZone` becomes a thin wrapper**: `SectionHeading label="Watched" side={…}` (the existing side
  slot: `{N} watched · tick {age} ago` / `⚠ stale {age}` with `data-testid="watched-stale"`), the existing
  empty-state lines (`No watched workers` / `No operator on this server`), and `<WatchedTable … />`. Its
  test ids, markup, and `watched-zone.test.tsx` expectations stay green unchanged — the Server page is a
  pure refactor here.

### 2. Third segment value `tasks`

`components/terminal-activity-tabs.tsx`:

```ts
const SEGMENTS = [
  { tab: "terminal", label: "Operator Terminal" },
  { tab: "activity", label: "Activity" }, // untouched here — a parallel change renames it
  { tab: "tasks", label: "Operator Tasks" },
] as const;
export type ConsoleSegment = (typeof SEGMENTS)[number]["tab"]; // "terminal" | "activity" | "tasks"
```

`ConsoleSegments` (controlled `{ value, onChange }`, `role="tablist"`, `data-testid="terminal-activity-tabs"`)
renders the third button with the same `controlClass({ variant: "segment" })` treatment. The mobile
wrapper `TerminalActivityTabs` derives `active` from `search.tab` for all three values (`tab` absent →
`terminal`). Keep the file name and test id (`terminal-activity-tabs`) — renaming would churn every spec
for no behavior gain; record in the JSDoc that the strip now carries three segments.

**Single source of truth for the union**: `lib/operator-console.ts`'s `OperatorConsoleRequest.segment`
and `lib/router-url.ts`'s `TerminalSearch.tab` both currently spell `"terminal" | "activity"` inline.
Widen both to include `"tasks"`. `router-url.ts` is a deliberately dependency-free leaf, so it keeps its
own literal union; `lib/operator-console.ts` may import `ConsoleSegment` from the component module or
define the union once and have the component derive from it — the plan picks one; the three spellings
MUST agree (a Vitest assertion that `SEGMENTS.map(s => s.tab)` equals the accepted `tab` values is the
cheap guard).

### 3. Router search param: `?tab=tasks`

`lib/router-url.ts`:

```ts
export type TerminalSearch = { …; tab?: "terminal" | "activity" | "tasks" };
// validateTerminalSearch:
if (search.tab === "terminal" || search.tab === "activity" || search.tab === "tasks") out.tab = search.tab;
```

Unknown values still drop to absent (reads as `terminal`). Update the header comment ("the mobile
operator route's segment selector").

### 4. Mobile operator route: the Tasks content slot (`app.tsx`)

Today: `operatorConsoleTabs = isMobile && windowParam != null && currentWindow?.role === "operator"`,
`activityTabActive = operatorConsoleTabs && search.tab === "activity"`; the surface-layout column takes
the `hidden` class while `activityTabActive`, and `<CronActivityFeed server={server} />` mounts in its
place. Generalize:

```ts
const consoleTab = operatorConsoleTabs ? (search.tab ?? "terminal") : "terminal";
const activityTabActive = consoleTab === "activity";
const tasksTabActive = consoleTab === "tasks";
const terminalHidden = activityTabActive || tasksTabActive;
```

- The terminal column stays MOUNTED-but-hidden (the existing `hidden` class posture) while either
  non-terminal tab is active.
- `tasksTabActive && <WatchedTasks server={server} sessions={sessions} onNavigate={navigateToWindow} />`
  mounts in the content slot exactly where the feed mounts for `activity` (§ 6 defines `WatchedTasks`).
- Row click on mobile goes through AppShell's existing `navigateToWindow` (the same seam the Server
  page's `onNavigate` uses) — navigating to another window's route drops the `tab` param naturally
  (`search: {}` on the destination), so the user lands on the watched worker's terminal.

### 5. Desktop `?tab=tasks` handoff (`app.tsx`)

The existing once-per-arrival effect (desktop, operator route, `search.tab === "activity"` →
`requestOperatorConsole({ action: "open", segment: "activity" })` + strip the param with `replace: true`)
generalizes to any non-terminal `tab`:

```ts
if (isMobile || !windowParam || currentWindow?.role !== "operator") return;
if (search.tab !== "activity" && search.tab !== "tasks") return;
requestOperatorConsole({ action: "open", segment: search.tab });
void navigate({ to: ".", search: (prev) => ({ ...prev, tab: undefined }), replace: true });
```

### 6. The console body on `tasks` (`components/operator-console.tsx`)

- **Segment state**: unchanged mechanism — `useState<ConsoleSegment>("terminal")`, reset to `terminal`
  in `finishClose` and the immediate-close branch of `requestClose`, set from `detail.segment` after the
  machine transition. Nothing is written to URL, tmux, or localStorage (Constitution IV).
- **Desktop operator-route no-op gate**: today `if (onOperatorRouteRef.current && detail.segment !== "activity")`
  toasts `already viewing the operator` and returns. Generalize: the gate holds only when the request
  carries no segment or `segment: "terminal"`; any other segment (`activity`, `tasks`) bypasses it — those
  views exist only inside the drawer on desktop.
- **Mobile arm**: today `if (detail.segment === "activity") { … tab: "activity" … }`. Generalize to
  `if (detail.segment !== undefined && detail.segment !== "terminal")` mapping to `tab: detail.segment`,
  merged with `?from=` on a cross-route navigation, `replace: true` in-place search update when already on
  the operator route — byte-identical behavior for `activity`.
- **Body branch** (the desktop drawer):

  ```tsx
  {segment === "activity" ? (
    <CronActivityFeed server={server ?? ""} inline />
  ) : segment === "tasks" ? (
    <WatchedTasks
      server={server ?? ""}
      sessions={server ? (sessionsByServer.get(server) ?? []) : []}
      onNavigate={(windowId) => {
        if (!server) return;
        void navigate({ to: "/$server/$window", params: { server, window: windowId }, search: {} });
        setConsoleMachineState("rest");
      }}
      dense
    />
  ) : target && server ? ( <TerminalClient … /> ) : ( hint )}
  ```

  The `TerminalClient` is UNMOUNTED on both non-terminal segments (the one-relay-stream-per-drawer rule
  holds).
- **Row click → navigate + collapse.** Verified existing behavior: the drawer has no in-drawer navigation
  today; every navigation that happens while it is open originates OUTSIDE the drawer (sidebar row,
  palette pick, tile click) and the capture-phase outside-click handler collapses the drawer to `rest`.
  A click on a Tasks row is INSIDE the console's DOM, so that handler stands down — the row handler
  therefore collapses explicitly with `setConsoleMachineState("rest")` after navigating, matching the
  user-observable "navigation collapses the drawer" posture. The console is mounted at the root layout
  and cannot reach AppShell's `navigateToWindow`, so it navigates through the router directly with
  `search: {}` — the form `handleSidebarSelectWindow` already uses for its cross-server branch (the
  destination window resolves its own stored layout). Navigating to the CURRENT route is a harmless
  same-URL navigate followed by the collapse.
- **`WatchedTasks`** (new — the segment body; lives in `components/watched-tasks.tsx` or beside the
  shared table; the plan picks):

  ```tsx
  export function WatchedTasks({ server, sessions, onNavigate, dense = false }: {
    server: string; sessions: ProjectSession[]; onNavigate: (windowId: string) => void; dense?: boolean;
  })
  ```

  Anatomy top→bottom, in a `flex-1 min-h-0 flex flex-col` root (`data-testid="watched-tasks"`):
  1. **Pinned staleness banner** — rendered exactly when `watchlistStatus(...).stale` is true, mirroring
     the Activity feed's banner (`shrink-0 border-b border-border px-3 py-2 text-xs text-signal-yellow`,
     `role="status"`, `data-testid="watched-tasks-banner"`): `operator tick — last seen {age} ago`
     (`formatDuration` of the tick age; `operator tick — no recent tick` when the age is unknown). The
     staleness verdict is the server's `operatorStale` (the 15-minute `DefaultWatchlistStaleThreshold` in
     `internal/cron/watchlist.go`) — the frontend never re-derives the threshold.
  2. **Scroll body** (`flex-1 min-h-0 overflow-y-auto`): `<WatchedTable rows stale nowSeconds onNavigate dense />`
     when rows exist.
  3. **Hint line, never an error** (centered `text-xs text-text-secondary`, the console's hint idiom):
     `no server resolved — watchlist unavailable` when `server` is empty; `No operator on this server`
     when `!hasOperator`; `No watched workers` when the operator exists but the list is empty (absent
     state file = empty watchlist, by the backend's tolerant read).

  Every relative age is computed at render from `Date.now()`; the sessions SSE cadence is the clock — no
  timer, no fetch, no polling (`CronActivityFeed`'s and the dashboard's shared contract). The component
  takes `sessions` by prop (the console passes `sessionsByServer.get(server)`, AppShell passes its
  `sessions`) so it stays a pure projection with no hook of its own.
- **JSDoc**: the component header's "Terminal | Activity segment header" prose becomes
  "Operator Terminal | Activity | Operator Tasks"; the Operator Tasks segment paragraph states the body, the one-relay-stream rule,
  and the row-click collapse.

### 7. Palette entry (Constitution V)

`lib/palette/operator-console.ts` gains a third pure builder beside `buildOperatorConsoleActivityAction`:

```ts
export function buildOperatorConsoleTasksAction(): OperatorConsolePaletteAction {
  return {
    id: "operator-console-tasks",
    label: "Operator: Show tasks",
    onSelect: () => requestOperatorConsole({ action: "open", segment: "tasks" }),
  };
}
```

`hooks/use-global-palette-actions.ts` folds it into the layout-global group immediately after
`Operator: Show clock activity`. Always listed (an operator-less server is answered by the segment's hint
line, not by hiding the entry); no registry chord — like the Activity twin, the segment is one click past
⌘J and the palette entry is its keyboard-parity path. It bypasses the desktop operator-route no-op gate
via the generalized rule in § 6.

### 8. Tests (run only via `just` recipes: `just test-frontend`, `just test-e2e <name>` / `just pw`)

**Vitest** (colocated):
- `lib/router-url.test.ts`: `?tab=tasks` accepted; `?tab=bogus` still drops.
- `components/terminal-activity-tabs.test.tsx`: three tabs rendered; `?tab=tasks` selects Tasks; the
  segment-value agreement guard (SEGMENTS ↔ accepted `tab` values ↔ request union).
- `components/operator-console.test.tsx` (extend the existing "activity segment" describe or add a
  "tasks segment" one): selecting Tasks mounts `watched-tasks` and unmounts the terminal; an open
  request with `segment: "tasks"` lands on Tasks; `segment: "tasks"` on the operator route bypasses the
  already-viewing toast; close + plain re-open resets to Terminal; mobile arm maps `segment: "tasks"` to
  `search.tab = "tasks"` (merged with `?from=`, in-place when already there); a row click navigates to
  `/$server/$window` and drives the machine to `rest`.
- `lib/palette/operator-console.test.ts`: the tasks builder's id/label/dispatch.
- `components/watched-table.test.tsx` (new) or extend `watched-zone.test.tsx`: rows, stale dimming,
  awaiting/note/repo cells, navigate callback — the existing `watched-zone.test.tsx` MUST stay green
  unchanged (the zone is a refactor).
- `components/watched-tasks.test.tsx` (new): banner on stale, the three hint states, dense prop.
- **`Terminal` → `Operator Terminal` label assertions**: every `getByRole("tab", { name: "Terminal" })`
  in `components/terminal-activity-tabs.test.tsx`, `components/operator-console.test.tsx`, and
  `tests/e2e/mobile-cron-activity.spec.ts` becomes `{ name: "Operator Terminal" }`. Leave every
  `{ name: "Activity" }` assertion untouched (the parallel rename owns those). The `switchLens(page,
  "Terminal")` helper in `web-view-lens.spec.ts` is the lens switcher, not this strip — leave it alone.

**Playwright** (`app/frontend/tests/e2e/*.spec.ts`, each `test()` with the Constitution's
**Proves:/Steps:** JSDoc, file headers updated for any new stubbed payload facets):
- `operator-console.spec.ts`: "the Tasks segment lists watched workers and a row click navigates and
  collapses the drawer" (seed a `monitored` window via the sessions `page.route` stub the way
  `server-clock-dashboard.spec.ts` does); "desktop `?tab=tasks` deep link opens the drawer on Tasks and
  strips the param"; the palette entry `Operator: Show tasks` opens on Tasks (fold into the
  existing palette-count assertion in `operator-compose.spec.ts` if that is where the twin is counted).
- `mobile-cron-activity.spec.ts` (or a sibling `mobile-watched-tasks.spec.ts`): "tapping Tasks swaps
  the content slot without a full reload"; "`?tab=tasks` deep link lands on Tasks".
- `server-clock-dashboard.spec.ts`: unchanged and green (the refactor guard).

### 9. Spec and memory hydration

- `docs/specs/cron.md` § UI — Three Tiers → tier 2(a): the desktop console drawer carries
  `Operator Terminal | Activity | Operator Tasks`; Operator Tasks is the watchlist rendered through the same component as the Server
  page WATCHED zone (tier 2b), entry point `Operator: Show tasks`, mobile `?tab=tasks`. Add to the
  **Rejected** paragraph: *fab-authored HTML frame displayed by path* (a new file-serving route + sandboxed
  iframe, a polling or mtime-watch refresh story, a second cross-repo file contract, an unthemed foreign
  page — superseded by rendering the already-derived watchlist). Add the palette entry to the
  Constitution V list.
- Memory (see Affected Memory) — requirement text and Design Decisions per FKF shape.

### Non-goals

- No new fields in the operator state YAML; no fab-kit change; no read of the operator's notes/pending
  escalations (still the Extension Map item in routes-and-shell § Clock Dashboard Zones).
- No row actions on the list (the watchlist is derived; edits are `fab operator` verbs).
- No sidebar change, no status-bar chip for Tasks, no new chord.
- No Server page visual change beyond the pure component extraction.

## Affected Memory

- `run-kit/ui/operator-console`: (modify) § Anatomy and § Desktop Terminal | Activity segments → three
  segments (`Tasks` = the watchlist via the shared `WatchedTable`, terminal unmounted, row click
  navigates + collapses); the seam's `segment` union gains `tasks`; the operator-route no-op gate's
  bypass generalizes to any non-terminal segment; the mobile arm maps any non-terminal segment to
  `?tab=`; desktop `?tab=tasks` handoff. New Design Decision: *Tasks renders the derived watchlist, not a
  fab-written HTML frame* (Decision / Why / Rejected / Introduced by).
- `run-kit/ui/cron-activity`: (modify) § Two mounts share one controlled segment strip — the strip
  carries three values; the mobile route's third content slot.
- `run-kit/ui/routes-and-shell`: (modify) § Clock Dashboard Zones → WATCHED renders through the shared
  `WatchedTable` + `collectWatchedRows`/`watchlistStatus` helpers also mounted by the console's Tasks
  segment; new Design Decision: *one watched-list component for the Server page and the console*.
- `run-kit/ui/keyboard-and-palette`: (modify) § Command Palette Actions — the `Operator: Show tracked
  tasks` entry (id `operator-console-tasks`, chordless, always listed, `segment: "tasks"`).
- `run-kit/cron`: (modify) § Overview UI pointer — tier 2(a) is two segments (Activity glimpse + Tasks
  watchlist) sharing the registry tier's component.

## Impact

**Frontend (`app/frontend/src/`)** — the whole change:
- `components/terminal-activity-tabs.tsx` (+ test) — third segment.
- `lib/router-url.ts` (+ test) — `tab` union.
- `lib/operator-console.ts` — `segment` union (+ JSDoc).
- `components/operator-console.tsx` (+ test) — gate/mobile-arm generalization, Tasks body, row-click
  navigate + collapse, JSDoc.
- `app.tsx` — mobile content slot for `tasks`, desktop `?tab=` handoff generalization.
- `components/server-clock-dashboard/watched-zone.tsx` → thin wrapper; `model.ts` (or sibling) gains the
  two pure helpers; new `components/watched-table.tsx` (shared) and `components/watched-tasks.tsx`
  (segment body), each with tests.
- `lib/palette/operator-console.ts` (+ test), `hooks/use-global-palette-actions.ts` — palette entry.
- `tests/e2e/operator-console.spec.ts`, `tests/e2e/mobile-cron-activity.spec.ts` (or a sibling),
  possibly `tests/e2e/operator-compose.spec.ts` (palette count).

**Backend**: none. **API/SSE contract**: none (reads `monitored*`, `operatorStale`, `operatorLastTickAt`,
`agentState`, `agentIdleDuration`, `note`/`noteEpoch`, `role` — all already on the payload).
**fab-kit**: none. **Docs**: `docs/specs/cron.md`, the five memory files above (+ `fab docs-index`
regeneration).

**Risks**: (a) the three segment-union spellings drifting — guarded by the agreement test; (b) the
WATCHED zone extraction changing Server page markup — guarded by `watched-zone.test.tsx` and
`server-clock-dashboard.spec.ts` staying untouched and green; (c) the console's drawer height at the
default 55vh with a six-column table — `dense` padding plus the scroll body handle overflow; column
truncation already exists on note/repo.

## Open Questions

None blocking. Three low-stakes choices were decided rather than asked (all easily reversed in a
follow-up; see Assumptions #12–#14): the dense console variant keeps all six columns; a desktop Tasks
row click collapses the drawer after navigating; no status-bar entry point for Tasks in this change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Render the Tasks segment from the already-derived watchlist in the sessions payload, not from a fab-written HTML file shown by path | Discussed — user confirmed; Constitution II/X and the polling anti-pattern all point the same way; rejected alternative recorded | S:95 R:70 A:95 D:95 |
| 2 | Certain | No new fields in the operator state YAML; no fab-kit change; frontend-only | Discussed — user fixed the constraint; every needed fact is already on `WindowInfo`/`ProjectSession` | S:95 R:85 A:95 D:95 |
| 3 | Certain | One shared watched-list component (`WatchedTable` + pure helpers) mounted by both the Server page WATCHED zone and the console Tasks segment; the zone becomes a thin wrapper | Discussed — user fixed the constraint; pure extraction keeps `watched-zone.test.tsx` green | S:90 R:80 A:90 D:90 |
| 4 | Certain | Segment plumbing mirrors the Activity segment exactly: `ConsoleSegments` value `tasks`, `OperatorConsoleRequest.segment` and `TerminalSearch.tab` widened, mobile `?tab=tasks` slot swap, desktop `?tab=tasks` handoff, console-local ephemeral state reset on close | Discussed — user fixed the constraint; the `260910-6ehs` pattern is fully in place and read | S:95 R:85 A:95 D:95 |
| 5 | Certain | Palette entry `Operator: Show tasks` (id `operator-console-tasks`, chordless, always listed) folded in after `Operator: Show clock activity`; bypasses the desktop operator-route no-op gate | Constitution V; the Activity twin's builder + fold-in site are the template | S:90 R:90 A:95 D:85 |
| 6 | Certain | Staleness = the server's `operatorStale` verdict (15-minute `DefaultWatchlistStaleThreshold`), shown as a pinned banner mirroring the Activity feed's; absent file / empty list renders a hint line, never an error | Discussed; the feed's banner and the zone's empty states already exist verbatim | S:90 R:90 A:95 D:90 |
| 7 | Confident | Desktop row click navigates via the router to `/$server/$window` with `search: {}` and then collapses the drawer with `setConsoleMachineState("rest")` | Verified: no in-drawer navigation exists today; all navigations while open originate outside the drawer and collapse it via the outside-click handler, which stands down for in-console clicks — explicit collapse matches the observable posture; the root-mounted console cannot reach AppShell's `navigateToWindow` | S:80 R:85 A:80 D:70 |
| 8 | Certain | Segment labels are `Operator Tasks` (new) and `Operator Terminal` (relabelled from `Terminal`); `tab` values, `?tab=` values, and internal identifiers (`watched`/`watchlist`, `WatchedTable`, `WatchedTasks`, `monitored*`) are unchanged | Discussed — user decided: a parallel change renames `Activity` to `Cron List` / `Cron Log`, so domain-prefixed two-word labels become the strip's pattern; the `activity` entry is left untouched here for merge hygiene | S:95 R:85 A:95 D:95 |
| 9 | Confident | The operator-route gate and the mobile arm generalize on "segment is absent or `terminal`" vs "any other segment", rather than enumerating `activity`/`tasks` | Not discussed explicitly; one rule for every non-terminal segment, byte-identical for `activity`; enumerating is the equally-correct alternative | S:60 R:90 A:85 D:70 |
| 10 | Confident | The shared strip keeps its file name and `terminal-activity-tabs` test id despite carrying three segments | Renaming churns every console/mobile spec for no behavior gain; JSDoc records the widening | S:65 R:90 A:80 D:70 |
| 11 | Confident | `WatchedTasks` takes `sessions` by prop (no hook of its own); the console passes `sessionsByServer.get(server)`, AppShell passes its `sessions` | Keeps the body a pure projection like `WatchedZone`; reading `useSessionContext` inside (the `CronActivityFeed` shape) is equally valid — plan may flip it | S:40 R:90 A:70 D:45 |
| 12 | Confident | The console's `dense` variant keeps all six WATCHED columns (status, session, change, awaiting, note, repo) — tighter padding only, no column drop | Would have asked interactively (a visual-fit preference at the 420px minimum drawer width) but a column toggle is trivially reversible; same-columns is the "same component + props" reading of the brief | S:40 R:90 A:50 D:40 |
| 13 | Confident | A desktop Tasks row click collapses the drawer after navigating (implemented by #7); the keep-open "browse several workers" alternative is recorded, not built | The brief says collapse per existing behavior; the alternative is a one-line change | S:55 R:90 A:60 D:50 |
| 14 | Confident | No status-bar entry point (e.g. a watched-count chip beside the `◷` clock chip) for Tasks in this change — palette + segment header + `?tab=tasks` are the entry points | Scope decision: the brief lists the palette entry only; a chip would be its own small change | S:45 R:90 A:65 D:55 |

14 assumptions (6 certain, 8 confident, 0 tentative, 0 unresolved).
