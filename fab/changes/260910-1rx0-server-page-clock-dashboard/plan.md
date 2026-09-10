# Plan: tmux Server Page Clock Dashboard

**Change**: 260910-1rx0-server-page-clock-dashboard
**Intake**: `intake.md`

## Requirements

### UI: Three dashboard zones on the tmux Server page

#### R1: Zones mount below the Sessions grid, inside the one scrolling tile area
The tmux Server page (`/$server`, rendered by `SessionTiles` when no `$window` param is present) SHALL render three additional zones — `WATCHED`, `CRONS`, `RECENT DELIVERIES`, in that order — **below** the Sessions grid, inside the SAME scrolling tile area (`session-tiles.tsx`'s `overflow-y-auto` div). `SessionTiles` gains an optional `footer?: ReactNode` slot rendered after the grid inside that div; `app.tsx` passes `<ServerClockDashboard …/>` (module `components/server-clock-dashboard/`) as that slot. Only the tile area scrolls (the page's existing layout rule). Each zone uses the shared `<SectionHeading label=… side=… />`, matching `[ SESSIONS▊ ]──── {stats}`. No new route, no settings, no per-zone toggles (Constitution IV). The dashboard root carries `data-testid="server-clock-dashboard"`; each zone wrapper carries `data-testid="clock-zone-watched" | "clock-zone-crons" | "clock-zone-deliveries"`.

- **GIVEN** the desktop `/$server` route with a resolved server
- **WHEN** the page renders
- **THEN** the `[ SESSIONS ]` heading + grid render first, followed by `[ WATCHED ]`, `[ CRONS ]`, `[ RECENT DELIVERIES ]` headings in document order inside the same scroll container
- **AND** the page body itself does not scroll horizontally or vertically — only the tile area does

#### R2: Desktop only
The dashboard SHALL render nothing (return `null`) when `useIsMobile()` is true. The mobile answer is the console sheet's Activity feed; the Server page on a phone keeps its tiles unchanged.

- **GIVEN** a 375px-wide viewport (or a coarse-pointer device — `useIsMobile()` is width-OR-coarse)
- **WHEN** `/$server` renders
- **THEN** no element with `data-testid="server-clock-dashboard"` exists in the DOM

#### R3: Data comes from the existing cadence — no new fetch, no timers
Cron data SHALL be the `CronListResponse` app.tsx ALREADY holds from its single `useCronData(server)` call (the palette's `cronActions` source) — passed down as a `cronData` prop; the dashboard adds no second `useCronData` call and no fetch of its own. Watched rows and staleness SHALL come from the server's sessions (`sessions: ProjectSession[]` prop — the same array `SessionTiles` receives) — no fetch. Every relative time (`in 5m`, `3m ago`, `tick 42s ago`) SHALL be computed at render time from `Date.now()` via `formatDuration` (`lib/format.ts`); the SSE-driven refetch is the clock — no `setInterval`, no ticking timer.

- **GIVEN** the dashboard is mounted
- **WHEN** the network is observed
- **THEN** exactly the pre-existing `GET /api/cron?server=…` requests fire (one on mount, one per sessions tick) — none attributable to the dashboard
- **AND** no interval timer is registered by any dashboard module

### UI: WATCHED zone

#### R4: One row per monitored window, navigate on click
The WATCHED zone SHALL render one row per window on the current server with `monitored === true` (ghost windows excluded), ordered by session order then window index. Columns, in a `text-xs font-mono` table with a `text-[10px] uppercase tracking-wide text-text-secondary` header row:

| col | source | render |
|-----|--------|--------|
| status | `<StatusDot win={win} watched={{ stale: operatorStale }} />` + window name | the name cell is a `<button type="button" data-testid="watched-row-navigate">` calling `onNavigate(win.windowId)` (the `navigateToWindow` path the tiles use) |
| session | owning session name | plain |
| change | `monitoredChange` · `monitoredStage` | `wuiu · review` — the stage in the fab-stage badge style `bg-accent/10 text-accent`; `—` when absent |
| awaiting | `agentState` + `agentIdleDuration` | `waiting 6m` (in `text-signal-yellow`) / `busy` (for `active`) / `idle 12m` / `—` when unknown |
| note | `note` + age | truncated (`truncate max-w-[24ch]`), full text in a `Tip`; age `· {formatDuration(now - noteEpoch)} ago` when `noteEpoch > 0`; the whole cell at `opacity-50` when older than `NOTE_STALE_SECONDS` (import from `sidebar/row-flyout-card.tsx`); `—` when no note |
| repo | `basename(monitoredRepo)` | full path in a `Tip`; `—` when absent |

Each row carries `data-testid="watched-row"`. There are NO row actions (the watchlist is derived from the operator state file and edited only by `fab operator` verbs).

- **GIVEN** two windows with `monitored: true` and one without
- **WHEN** the zone renders
- **THEN** exactly two `watched-row` elements render
- **AND WHEN** the first row's name button is clicked, **THEN** `onNavigate` is called once with that window's `windowId`

#### R5: WATCHED side slot, staleness dimming, and empty states
The zone's `side` slot SHALL read `{N} watched · tick {age} ago` where `age` derives from the server's `operatorLastTickAt` (any session carries it — the value is stamped identically on every session of the server); when any session reports `operatorStale === true` the side slot instead renders `⚠ stale {age}` in `text-signal-yellow` (`data-testid="watched-stale"`) and the whole table dims to `opacity-50`. When `operatorLastTickAt` is 0/absent on every session the tick fragment reads `no operator tick`. Empty states (in place of the table): `No watched workers` when an operator exists (some session has `operatorLastTickAt > 0` OR a window with `role === "operator"`), else `No operator on this server`.

- **GIVEN** sessions with `operatorStale: true` and `operatorLastTickAt` 20 minutes ago
- **WHEN** the zone renders
- **THEN** the side slot shows `⚠ stale 20m` and the table carries `opacity-50`
- **GIVEN** no monitored windows and no operator facts at all
- **THEN** the zone body reads `No operator on this server`

### UI: CRONS zone

#### R6: One row per entry, deterministic sort, registry columns
The CRONS zone SHALL render one row (`data-testid="crons-row"`) per `CronEntry` in `cronData.entries`, sorted by the pure `sortCronEntries(entries, nowSeconds)` (`components/server-clock-dashboard/model.ts`): bucket 0 = **due** (`nextFire` present, `nextFire ≤ now`, not muted, not orphaned); bucket 1 = **scheduled** by `nextFire` ascending; bucket 2 = **undated** (no `nextFire`, not muted/orphaned); bucket 3 = **orphaned**; bucket 4 = **muted** (an entry both muted and orphaned lands in bucket 3 — orphaned is the graver state). Within buckets 2–4 sort by display name. Columns:

| col | render |
|-----|--------|
| name | `name ?? id`; `line-through` when muted or orphaned (the CLOCK row treatment); the row dims to `opacity-50` when muted or orphaned |
| target | `role: operator` / `session: foo` / `pane: %3` — the CLOCK row's `targetChip` rule (kind + first facet), exported from `clock-panel.tsx` or moved to `model.ts` and re-imported there |
| schedule | `describeSchedule(entry)` from `lib/cron-schedule.ts` |
| state | the pure `cronStateLabel(entry, sessions, nowSeconds)` (R7) |
| last | `{formatDuration(now - lastFired)} ago ✓` when `lastFired > 0`, else `—` |
| next | `in {formatDuration(nextFire - now)}` when `nextFire > now`; `due` when `nextFire ≤ now`; `—` when absent |
| actions | a trailing `…` `<button aria-label="Actions for {name}" data-testid="crons-row-actions">` opening the row-flyout card (R8) |

- **GIVEN** entries A (nextFire in 5m), B (nextFire 1m ago, not muted), C (muted, nextFire in 2m), D (orphaned), E (no nextFire)
- **WHEN** `sortCronEntries` runs
- **THEN** the order is B, A, E, D, C

#### R7: State column derived from the wire — no new backend field
`cronStateLabel` SHALL return, in priority order: `orphaned · expires {formatDuration(expiresAt - now)}` when `orphaned === true` and the API's `expiresAt` (the orphan-TTL reap time, declared on `CronEntry`) is still ahead, else bare `orphaned`; `muted {formatDuration(mutedUntil - now)}` when `muted === true` and `mutedUntil > now`, else `muted` when `muted === true`; `held (busy)` when `deliver === "when-idle"` AND `nextFire ≤ now` AND the client-resolved target window's `agentState` is `active` or `waiting`; `due` when `nextFire ≤ now`; `rung {rung}` when `schedule.kind === "backoff"` and `rung != null`; otherwise `—`. Target resolution is the pure `resolveTargetWindow(entry, sessions)`: `kind: "role"` → the window whose `role === entry.target.role`; `kind: "session"` → that session's `isActiveWindow` window (else its first window); `kind: "pane"` → the window whose `panes` include that `paneId`; unresolvable → `undefined` (so a when-idle entry past due with no resolvable target reads `due`, never `held`).

- **GIVEN** a when-idle entry with `nextFire` 30s ago targeting `role: operator`, and the operator window's `agentState` is `active`
- **WHEN** `cronStateLabel` runs
- **THEN** it returns `held (busy)`
- **AND GIVEN** the same entry but the operator window is `idle`, **THEN** it returns `due`

#### R8: Row actions via the row-flyout card; create via the existing dialog
The `…` button SHALL open the sidebar's row-flyout-card idiom (`useRowFlyout` + `PopupTitleBar` + `CardActionList flush` + `CardActionRow`, exactly as `ClockRow` in `clock-panel.tsx`) with **Mute/Unmute** (`row-flyout-mute-action`), **Pin/Unpin** (`row-flyout-pin-action`), and **Delete** (`danger`, `row-flyout-delete-action`). The handlers are props from `app.tsx` — `onMute(entry)`, `onPin(entry)`, `onDelete(entry)`, `onCreate()` — the SAME callbacks `buildCronActions` receives (extract them into one memoized `cronHandlers` object in `app.tsx` so palette and dashboard share them): mute/pin POST straight with the toast-on-error idiom and repaint on the SSE wake; delete routes through app.tsx's existing kill-confirm `Dialog` (`cronDeleteTarget`). A `+ New entry` dashed button (`data-testid="crons-new-entry"`, the New Session tile's dashed idiom) at the end of the zone calls `onCreate()` → the existing `CronCreateDialog`. No new form, no new dialog.

- **GIVEN** a rendered CRONS row for a muted entry
- **WHEN** its `…` button is clicked and the `Unmute` action row is clicked
- **THEN** `onMute` is called once with that entry and the card closes
- **AND WHEN** `+ New entry` is clicked, **THEN** `onCreate` is called once

#### R9: CRONS side slot and empty state
The side slot SHALL read `{N} entries · {M} muted · {K} orphaned`, omitting any zero count (`1 entry` singular; `3 entries · 1 muted` when no orphans). With zero entries the zone body reads `No cron entries` and the `+ New entry` control still renders.

- **GIVEN** 3 entries of which 1 is muted and 0 orphaned
- **THEN** the side slot reads `3 entries · 1 muted`

### UI: RECENT DELIVERIES zone

#### R10: Compact newest-first log with day dividers
The zone SHALL render `cronData.deliveries` in the API's most-recent-first order as-is (no client sort, no pagination, no extra fetch — the API owns the cap). Each row (`data-testid="delivery-row"`) reads `{HH:MM} · {name || "(deleted entry)"} → {outcome label}` where `HH:MM` is the local time of `ts` (24h, zero-padded). The outcome label is the pure `describeOutcome(outcome)` (`model.ts`): `delivered` → `delivered ✓`; `skipped-absent` → `skipped (absent)`; `notified-absent` → `notified (absent)`; `held-expired`, `rate-capped`, `missed`, `respawned`, `expired-orphan` → verbatim; any outcome starting `respawn-failed` or containing `fail`/`error` → verbatim in `text-signal-red`; anything else → verbatim (never a fabricated phrasing). When the log spans more than one local calendar day, a thin day divider (`text-[10px] uppercase text-text-secondary` + `border-t`, `data-testid="delivery-day-divider"`) precedes each day's first row, labelled `today` / `yesterday` / `YYYY-MM-DD`. Side slot: `last {formatDuration(now - deliveries[0].ts)} ago`; empty state `No deliveries yet` with no side slot.

- **GIVEN** deliveries at 14:02 today (`delivered`) and 23:50 yesterday (`respawn-failed: exit 1`)
- **WHEN** the zone renders
- **THEN** two day dividers render (`today`, `yesterday`), the first row reads `14:02 · operator tick → delivered ✓`, and the second row's outcome is verbatim in `text-signal-red`

### Palette: Server: Clock dashboard

#### R11: Palette entry scrolls the CRONS heading into view, no URL hash
`serverActions` in `app.tsx` SHALL gain `{ id: "server-clock-dashboard", label: "Server: Clock dashboard" }` (present whenever a server is resolved, beside the copy entries). `onSelect`: if `windowParam` is set, `navigate({ to: "/$server", params: { server } })` first; then, after the route has rendered, dispatch the document event `rk:server-clock-dashboard-scroll`. The dashboard root registers a `document` listener for that event and calls `scrollIntoView({ block: "start" })` on its CRONS `SectionHeading` wrapper ref; to cover the mount-after-dispatch race the event dispatch is deferred with `requestAnimationFrame` after the awaited `navigate` promise, AND the dashboard checks a module-level pending flag (`lib/server-clock-dashboard-scroll.ts`: `requestCronsScroll()` sets it and dispatches the event; `consumePendingCronsScroll()` clears and returns it) in a mount effect. The URL is never changed to carry a `#crons` hash. On mobile the entry still navigates to `/$server` (the dashboard is absent there, so nothing scrolls).

- **GIVEN** the user is on `/$server/$window` on desktop
- **WHEN** `Server: Clock dashboard` is selected
- **THEN** the route becomes `/$server` and the CRONS heading is scrolled into view within the tile area, with the URL carrying no hash

### Docs: spec and design study

#### R12: Spec and study record the shipped registry
`docs/specs/cron.md` § UI item 2(b) SHALL be marked shipped with the three zone names and the palette entry; § Phasing P2's "Server page's WATCHED / CRONS / RECENT DELIVERIES zones" fragment SHALL carry a `(shipped)` annotation. `docs/wiki/cron-clock-design-studies.html` SHALL gain `<h2>1d · The registry — tmux Server page</h2>` after § 1c (before § 2) with a static mock of the three zones reusing the study's existing CSS vocabulary (`.study`, `.tag`, `.cap`, `.chip`, the `--border`/`--card`/`--inset`/`--ts`/`--tp`/`--green`/`--amber` variables), a caption naming the navigate seam and the row-flyout actions; and § 4's table SHALL gain the row `Open clock dashboard · palette → /$server, CRONS heading scrolled into view · Server: Clock dashboard`. Memory files are hydrate's, not apply's.

- **GIVEN** the docs edits land
- **WHEN** the study is opened in a browser
- **THEN** § 1d renders between § 1c and § 2 with no console errors, and § 4 lists the new palette row

### Tests

#### R13: Unit and e2e coverage
Vitest: `model.test.ts` (sort buckets, `cronStateLabel` incl. held/due/orphaned/muted lease, `resolveTargetWindow` for role/session/pane/unresolvable, `describeOutcome` incl. the red class, day-divider grouping); per-zone component tests using `makeWindow`/`makeSession` (`src/test-utils/fixtures.ts` — extend `makeWindow`'s defaults only if a required field is missing) covering empty states, stale dimming, navigate click, flyout actions calling the handler props, `+ New entry`; a dashboard-root test that `useIsMobile() === true` renders nothing and that the scroll event scrolls the CRONS heading (`scrollIntoView` mocked). Playwright: new `tests/e2e/server-clock-dashboard.spec.ts` following `mobile-cron-activity.spec.ts`'s fully-mocked idiom (`mockStateSocket` with two sessions — one monitored window with `monitored*` facets, an operator window with `role: "operator"`, `operatorLastTickAt` set — plus `page.route("**/api/cron*")` seeding one due entry, one muted entry, and two deliveries): (a) desktop 1280×800 — the three zone headings are visible below the `Sessions` heading inside the tile area; (b) 375×812 — `server-clock-dashboard` has count 0 while the session tiles still render; (c) a mute action round-trips — open the row's `…`, click `Mute`, assert a `POST **/api/cron/mute` with `{id, muted: true}`. Every new `test()` carries the **Proves:/Steps:** JSDoc and the file opens with the shared-setup header (constitution § Test Intent Comments). Run only via `just test-frontend` (vitest) and `just pw test server-clock-dashboard` — never Playwright directly.

- **GIVEN** the suite runs
- **THEN** `just test-frontend` passes, `cd app/frontend && npx tsc --noEmit` passes, and `just pw test server-clock-dashboard` passes

### Non-Goals

- Pending escalations (open questions awaiting the user) — not on any payload; listed in the memory Extension Map only.
- A held-reason field on `GET /api/cron` — backend scope stays zero; the state column renders from what exists (`expiresAt` is already served and is consumed).
- Watchlist edits from the UI — the watchlist is derived; edits are `fab operator` verbs.
- A `#crons` URL hash or any new route/search param.

### Design Decisions

#### The dashboard rides SessionTiles' scroll container via a footer slot
**Decision**: `SessionTiles` takes `footer?: ReactNode` rendered after the grid inside its `overflow-y-auto` div; `app.tsx` passes the dashboard there.
**Why**: the intake's layout rule is "only the tile area scrolls"; a sibling below `SessionTiles` would either create a second scroll region or push the grid's scroll box shorter. A slot keeps one scroll container and one owner of the padding.
**Rejected**: rendering the dashboard inside `SessionTiles` directly (couples the tiles component to cron props); a sibling column below the tiles (two scroll regions).
*Introduced by*: 260910-1rx0-server-page-clock-dashboard

#### One `useCronData` call, owned by app.tsx
**Decision**: the dashboard receives `cronData` as a prop from app.tsx's existing `useCronData(server)` call rather than calling the hook itself.
**Why**: app.tsx already holds the response for the palette's `cronActions`; a second hook instance would double every fetch on the sessions cadence for the same server.
**Rejected**: a second `useCronData` at the dashboard root (the intake's literal wording — duplicates network work with no benefit).
*Introduced by*: 260910-1rx0-server-page-clock-dashboard

#### Shared cron mutation handlers between palette and dashboard
**Decision**: app.tsx builds one memoized `cronHandlers = { onCreate, onMute, onPin, onDelete }` consumed by both `buildCronActions` and the dashboard.
**Why**: the delete confirm dialog and the toast-on-error posture already exist for the palette; sharing the object keeps one delete-confirm path and one error surface (Constitution III, code-quality "no duplicated utilities").
**Rejected**: the dashboard calling `muteCron`/`pinCron`/`deleteCron` itself (a second delete-confirm or an unconfirmed delete).
*Introduced by*: 260910-1rx0-server-page-clock-dashboard

#### Held state is client-resolved from shipped facts
**Decision**: `held (busy)` derives from `deliver: when-idle` + past-due `nextFire` + the client-resolved target window's `agentState ∈ {active, waiting}`.
**Why**: the `when-idle` busy predicate is documented as `active | waiting` and every input already rides the payloads; no backend field is needed for the common role/session/pane targets.
**Rejected**: a `heldReason` backend field (out of scope by intake); omitting the held state entirely (the mock's most useful column would stay empty).
*Introduced by*: 260910-1rx0-server-page-clock-dashboard

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/server-clock-dashboard/model.ts` with the pure helpers `sortCronEntries`, `cronStateLabel`, `resolveTargetWindow`, `describeOutcome`, `groupDeliveriesByDay` (day labels `today`/`yesterday`/`YYYY-MM-DD`), `targetChip` (move the rule from `sidebar/clock-panel.tsx` here and re-import it there), and `formatClockTime(ts)` (`HH:MM` local, 24h); colocated `model.test.ts` covering every branch in R6/R7/R10 <!-- R6, R7, R10 -->
- [x] T002 [P] Add `footer?: ReactNode` to `SessionTiles` (`app/frontend/src/components/session-tiles/session-tiles.tsx`) rendered after the grid inside the `overflow-y-auto` div; extend `session-tiles.test.tsx` with one case asserting the footer renders inside the scroll container after the grid <!-- R1 -->
- [x] T003 [P] Create `app/frontend/src/lib/server-clock-dashboard-scroll.ts` (`CRONS_SCROLL_EVENT = "rk:server-clock-dashboard-scroll"`, `requestCronsScroll()`, `consumePendingCronsScroll()`) with a colocated test <!-- R11 -->

### Phase 2: Core Implementation

- [x] T004 Create `app/frontend/src/components/server-clock-dashboard/watched-zone.tsx` (`WatchedZone({ sessions, onNavigate })`): the `SectionHeading` with the side slot + stale variant, the monitored-rows table per R4, `opacity-50` dimming, both empty states; colocated `watched-zone.test.tsx` per R13 <!-- R4, R5 -->
- [x] T005 Create `app/frontend/src/components/server-clock-dashboard/crons-zone.tsx` (`CronsZone({ entries, sessions, onMute, onPin, onDelete, onCreate })`): heading + side slot per R9, rows per R6 using `describeSchedule`/`formatDuration`/`model.ts`, the `…` row-flyout card per R8, the `+ New entry` dashed button, the `No cron entries` empty state; colocated `crons-zone.test.tsx` per R13 <!-- R6, R7, R8, R9 -->
- [x] T006 [P] Create `app/frontend/src/components/server-clock-dashboard/deliveries-zone.tsx` (`DeliveriesZone({ deliveries })`): heading + `last {age} ago` side slot, newest-first rows, day dividers, red error class, `No deliveries yet`; colocated `deliveries-zone.test.tsx` per R13 <!-- R10 -->
- [x] T007 Create `app/frontend/src/components/server-clock-dashboard/index.tsx` (`ServerClockDashboard({ server, sessions, cronData, onNavigate, cronHandlers })`): `useIsMobile()` gate returning `null`, the three zones in order with `mt-6` spacing, the CRONS heading wrapper ref, the `CRONS_SCROLL_EVENT` document listener + mount-time `consumePendingCronsScroll()` check calling `scrollIntoView({ block: "start" })`; colocated `index.test.tsx` covering the mobile gate and the scroll paths <!-- R1, R2, R3, R11 -->

### Phase 3: Integration & Edge Cases

- [x] T008 In `app/frontend/src/app.tsx`: extract the `buildCronActions` handler object into a memoized `cronHandlers`; pass `footer={<ServerClockDashboard server={server} sessions={sessions} cronData={cronData} onNavigate={navigateToWindow} cronHandlers={cronHandlers} />}` to the `<SessionTiles>` mount; add the `server-clock-dashboard` palette entry to `serverActions` per R11 (navigate to `/$server` when `windowParam` is set, then `requestCronsScroll()` inside a `requestAnimationFrame` after the awaited navigate); keep `useCronData` called exactly once <!-- R1, R3, R8, R11 -->
- [x] T009 Add `app/frontend/tests/e2e/server-clock-dashboard.spec.ts` per R13 (fully mocked: `mockStateSocket` + `page.route("**/api/cron*")` + `**/api/servers` + `**/api/cron/mute`), three `test()`s each with **Proves:/Steps:** JSDoc and a file-header shared-setup comment; run with `just pw test server-clock-dashboard` and fix until green <!-- R1, R2, R8, R13 -->
- [x] T010 Run the verification gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just pw test server-clock-dashboard`; fix any failures at the root cause (never by weakening tests) <!-- R13 -->

### Phase 4: Polish

- [x] T011 [P] Edit `docs/specs/cron.md`: § UI item 2(b) marked shipped naming the three zones + the `Server: Clock dashboard` palette entry (add it to the Constitution V palette list in that section); § Phasing P2's Server-page zones fragment annotated `(shipped)` <!-- R12 -->
- [x] T012 [P] Edit `docs/wiki/cron-clock-design-studies.html`: insert § 1d after § 1c with the static three-zone mock in the study's CSS vocabulary and a caption; add the `Server: Clock dashboard` row to § 4's table <!-- R12 -->

## Execution Order

- T001 blocks T004, T005, T006 (they import `model.ts`)
- T002 and T003 are independent of T001; T007 needs T003–T006; T008 needs T002 and T007
- T009 and T010 run after T008; T011/T012 are independent docs edits

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SessionTiles` renders its `footer` slot after the grid inside the `overflow-y-auto` div, and app.tsx mounts `ServerClockDashboard` there on `/$server`; the three zone headings render in the order WATCHED, CRONS, RECENT DELIVERIES
- [x] A-002 R2: with `useIsMobile()` true the dashboard renders nothing
- [x] A-003 R3: `useCronData` is called exactly once in `app.tsx`; no dashboard module calls `useCronData`, `fetch`, `getCron`, or `setInterval`
- [x] A-004 R4: WATCHED renders one row per `monitored === true` non-ghost window with the six columns; the name cell is a `<button>` calling `onNavigate(windowId)`
- [x] A-005 R5: the WATCHED side slot reads `{N} watched · tick {age} ago`, flips to yellow `⚠ stale {age}` with `opacity-50` on the table when `operatorStale`, and the two empty states render per their conditions
- [x] A-006 R6: `sortCronEntries` orders due → scheduled (nextFire asc) → undated → orphaned → muted; rows carry the muted/orphaned `line-through` + dim treatment and all seven columns
- [x] A-007 R7: `cronStateLabel` returns `orphaned` / `muted {lease}` / `muted` / `held (busy)` / `due` / `rung N` / `—` in that priority, with `held` gated on the resolved target's `agentState ∈ {active, waiting}`
- [x] A-008 R8: the `…` button opens a row-flyout card with Mute/Unmute, Pin/Unpin, Delete (danger) calling the handler props; `+ New entry` calls `onCreate`
- [x] A-009 R9: the CRONS side slot omits zero counts and singularizes `1 entry`; the empty state still shows `+ New entry`
- [x] A-010 R10: deliveries render newest-first as served with `HH:MM · name → outcome`, `(deleted entry)` fallback, day dividers only when the log spans days, red error outcomes, `last {age} ago` side slot, `No deliveries yet`
- [x] A-011 R11: `Server: Clock dashboard` exists in `serverActions`, navigates to `/$server` when on a window route, scrolls the CRONS heading into view, and never writes a URL hash
- [x] A-012 R12: `docs/specs/cron.md` § UI 2(b) and § Phasing P2 mark the registry shipped; the study has § 1d and the § 4 palette row

### Behavioral Correctness

- [x] A-013 R3: every relative time in the three zones is computed at render from `Date.now()` — no `setInterval`/`setTimeout` ticking in any dashboard module
- [x] A-014 R8: Delete from the row-flyout card routes through app.tsx's existing cron kill-confirm dialog (`cronDeleteTarget`), never an unconfirmed `deleteCron`

### Scenario Coverage

- [x] A-015 R6: `model.test.ts` asserts the B, A, E, D, C ordering scenario
- [x] A-016 R7: `model.test.ts` asserts `held (busy)` vs `due` for the when-idle operator scenario and each `resolveTargetWindow` kind
- [x] A-017 R13: `tests/e2e/server-clock-dashboard.spec.ts` covers desktop zones visible, mobile absent, and the mute POST round-trip, each `test()` with Proves:/Steps: JSDoc and a file-header setup comment
- [x] A-018 R13: `just test-frontend`, `npx tsc --noEmit` (in `app/frontend`), and `just pw test server-clock-dashboard` pass

### Edge Cases & Error Handling

- [x] A-019 R7: a when-idle entry past due whose target cannot be resolved reads `due`, not `held (busy)`; an expired `mutedUntil` never renders a negative lease
- [x] A-020 R10: a delivery whose `name` is empty renders `(deleted entry)`; an unknown outcome string renders verbatim without a red class unless it matches the failure predicate
- [x] A-021 R5: a server with zero sessions renders `No operator on this server` without throwing

### Code Quality

- [x] A-022 Pattern consistency: zones reuse `SectionHeading`, `StatusDot`, `Tip`, `formatDuration`, `describeSchedule`, `useRowFlyout`/`CardActionList`/`CardActionRow`/`PopupTitleBar`, and the fab-stage badge classes; naming and file layout match `components/session-tiles/` and `components/sidebar/`
- [x] A-023 No unnecessary duplication: `targetChip` has one definition; cron mutation handlers are shared between palette and dashboard; no second `useCronData`
- [x] A-024 Type narrowing over assertions: no `as` casts in new code beyond test-only DOM narrowing
- [x] A-025 No polling from the client: no `setInterval` + fetch anywhere in the change
- [x] A-026 Magic values named: `CRONS_SCROLL_EVENT`, `NOTE_STALE_SECONDS` (imported), zone labels, and outcome strings live in named constants, not inline literals repeated across files
- [x] A-027 Comments state constraints, not narration: no comment cites this change id or narrates the next line
- [x] A-028 Keyboard-first: every row action and the navigate cell is a `<button>`; the new palette entry is registered

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Memory updates (`routes-and-shell`, `cron-activity`, `keyboard-and-palette`, `sidebar`, `cron` — incl. the Extension Map: orphan expiry, held reason, escalations) are hydrate's, not apply's.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one superseded block (the private `targetChip` in `app/frontend/src/components/sidebar/clock-panel.tsx`) was already removed in the diff itself; the CLOCK panel, Activity feed, and cron palette actions all remain live surfaces the dashboard deliberately reuses rather than replaces.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Dashboard mounts via a `footer` slot on `SessionTiles` rather than as a sibling in app.tsx | Only way to keep one scroll container per the intake's layout rule; trivially reversible | S:70 R:90 A:90 D:80 |
| 2 | Confident | `cronData` is passed down from app.tsx's existing `useCronData` call instead of a second hook call at the dashboard root | Intake's literal wording would double-fetch; the intent ("no new polling") is served better by one call | S:75 R:95 A:90 D:85 |
| 3 | Confident | Cron mutation handlers are shared with the palette via one `cronHandlers` object; delete reuses the existing confirm dialog | Constitution III + code-quality anti-duplication; the palette path already exists | S:80 R:90 A:90 D:85 |
| 4 | Tentative | `held (busy)` is derived client-side from `deliver`, `nextFire`, and the resolved target window's `agentState ∈ {active, waiting}`; orphan expiry reads the API's `expiresAt` | Inputs exist on the wire; the busy predicate is documented; but held-ness is an evaluator-internal fact the client approximates | S:55 R:85 A:65 D:60 |
| 5 | Confident | Outcome vocabulary mapped from the Go log strings (`delivered`, `held-expired`, `rate-capped`, `missed`, `respawned`, `respawn-failed: …`, `notified-absent`, `skipped-absent`, `expired-orphan`); unknown strings pass through verbatim | Read from `internal/cron/tick.go`/`deliver.go` at plan time; verbatim fallback prevents fabricated phrasing | S:70 R:90 A:85 D:80 |
| 6 | Confident | Palette scroll uses a document event + a module pending flag, dispatched after the awaited navigate | Mirrors the `rk:operator-console` document-event seam; covers the mount-after-dispatch race | S:65 R:90 A:85 D:75 |
| 7 | Confident | e2e uses the fully-mocked `mockStateSocket` + `page.route` idiom, not the vitest msw handlers | `tests/msw/handlers.ts` has no cron handler and serves vitest only; `mobile-cron-activity.spec.ts` is the established e2e idiom | S:70 R:95 A:95 D:85 |
| 8 | Confident | Sort tie-breaks: orphaned before muted; muted+orphaned lands in the orphaned bucket; buckets 2–4 sort by name | Intake fixes bucket order but not ties; orphaned is the graver operational state | S:60 R:95 A:85 D:75 |

8 assumptions (0 certain, 7 confident, 1 tentative).
