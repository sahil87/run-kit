# Intake: tmux Server Page Clock Dashboard

**Change**: 260910-1rx0-server-page-clock-dashboard
**Created**: 2026-09-10

## Origin

Conversational — the same `/fab-discuss` session (2026-09-10) that produced
`260910-6ehs-console-activity-segment-status-chip`. That session established that the cron clock's
tier-2 "larger view" (specced as an operator dashboard in the reserved `agents` surface tile) never
shipped and has no surface slot left, and that the fact it visualizes — cron entries, the operator's
watchlist, the delivery log, loop staleness — is **tmux-server-scoped**, not per-tab.

> User: "I do need a larger UI or a larger view but I don't think this is tab-specific. This is more
> server-specific or tmux-server-specific. Should we combine it with the server page or should we use
> some other strategy?"

Agreed direction: split into a glimpse (change `6ehs` — the console's Activity segment + a status-bar
chip) and a **full view on the tmux Server page** (`/$server`) — this change. The Server page is the
one existing route whose scope matches exactly, it already composes in bracketed `SectionHeading`
zones (like the Host page), and adding zones costs no new route (Constitution IV).

**Sequencing**: this change starts only after `6ehs` merges to `main`. It inherits (a) the spec
amendment `6ehs` makes to `docs/specs/cron.md` § UI item 2 (which already names this change as the
registry half), and (b) any controlled-component extraction `6ehs` performs on the feed/segment
pieces. The operator is asked to spawn this change on that merge.

Rejected during discussion: agents tile (tab-scoped indirection; slot taken by `gui`); a new route;
a `clock` surface kind; a separate watchlist list (the study's rule — watched workers are already
rows; here the WATCHED zone is the *detail* table the sidebar cannot afford, justified by the
Server page being the deep view, the same way the Host page's zones deepen the status bar's
fragments).

## Why

**Problem.** There is no desktop surface that shows the operator's full picture for a server: which
workers it watches and what each awaits, every cron entry with its live schedule state (rung, held
reason, orphan expiry, last/next), and the recent delivery log. The sidebar `CLOCK` section is a
deliberately trimmed glance; the console Activity segment (`6ehs`) is a time-ordered triage feed.
Neither is a registry you can scan and manage. Today that view exists only as `rk cron list --json`
plus `fab operator state` in a shell.

**Consequence of not fixing.** The cron substrate is now the operator's only clock (fab-kit #660
retired the in-session loop), and agent adoption of `rk cron` beyond the operator is gated on
visibility of orphaned entries and their expiry. Without a management view those entries are
invisible until they misfire or expire.

**Why this approach.** The Server page already answers "what is happening on this tmux server" with
session tiles and static previews; the clock and watchlist are the same class of fact for the same
scope. `GET /api/cron` already returns entries with derived `nextFire`/`rung`/`orphaned`/`muted`/
`mutedUntil` plus `deliveries`; the sessions payload already carries `monitored*` per window and
`operatorLastTickAt`/`operatorStale` per session. This is a projection of shipped data onto the
right page — no new derivation (Constitution II/X) except none.

## What Changes

### 1. Three zones on the tmux Server page

Rendered by a new `components/server-clock-dashboard/` module (one file per zone + an index),
mounted from `app.tsx` in the server route's content column **below the `Sessions` grid** inside the
same single scrolling tile area (only the tile area scrolls — the page's existing layout rule). Each
zone uses the shared `<SectionHeading label=… side=… />` (typed-sweep inside the brackets, the stats
in the `side` slot), matching `[ SESSIONS▊ ]──── {N} sessions, {M} windows`.

**Zone order and headings** (descending operational urgency):

1. `WATCHED` — side slot: `{N} watched · tick {age} ago` (yellow `⚠ stale {age}` when
   `operatorStale`). Empty state: `No watched workers` when an operator exists, or `No operator on
   this server` when no session carries `operatorLastTickAt`.
2. `CRONS` — side slot: `{N} entries · {M} muted · {K} orphaned` (omit zero counts).
   Empty state: `No cron entries`.
3. `RECENT DELIVERIES` — side slot: `last {age} ago`. Empty state: `No deliveries yet`.

Zones render on the server route only (`/$server`), for the route's server. They are hidden entirely
on mobile (`useIsMobile()` — the mobile answer is the console sheet's Activity feed; the Server page
on a phone keeps its tiles). Constitution IV: no new route, no settings, no per-zone toggles — the
zones are always present below the grid, so they cost nothing above the fold.

### 2. WATCHED zone — the detail table the sidebar cannot afford

One row per window on the current server with `monitored === true` (the fab operator state file's
`monitored` map, already joined onto windows by pane ID server-side). Columns (mono, the Host page
zone typography):

| col | source | render |
|-----|--------|--------|
| status | `StatusDot win` (the shared component) + window name | click navigates to `/$server/$window` (the same `navigateToWindow` path the tiles use) |
| session | owning session name | plain |
| change | `monitoredChange` + `monitoredStage` | `wuiu · review` (the fab-stage badge style `bg-accent/10 text-accent` for the stage) |
| awaiting | `agentState` + idle duration (`waiting 6m` / `busy` / `idle 12m`) | `waiting` in the status-dot amber vocabulary |
| note | `note` + age (`· {duration} ago`), dimmed past `NOTE_STALE_SECONDS` | truncated, full text in `Tip` |
| repo | `monitoredRepo` basename | tooltip full path |

The whole table dims to `opacity-50` when the session's `operatorStale` is true (the sidebar's
watched-indicator dimming, applied to the zone). No row actions (the watchlist is the operator's;
edits are `fab operator` verbs — the study's "watchlist stays derived" rule). Rows are `<button>`
for the navigate action so keyboard reaches every row (Constitution V).

### 3. CRONS zone — the registry the CLOCK section trims

One row per `CronEntry`, sorted: firing/due first, then by `nextFire` ascending, then orphaned, then
muted. Columns:

| col | render |
|-----|--------|
| name | `name ?? id`; `line-through` when muted or orphaned (the CLOCK row treatment) |
| target | `role: operator` / `session: foo` / `pane: %3` (the CLOCK row's `targetChip`) |
| schedule | plain words — reuse the detail sheet's schedule-in-plain-words formatter (`every 1m after idle, doubling to 30m` / `every 1h` / `cron 0 2 * * *` + `catch up once` / `wakes on agent-state-change`) |
| state | `rung 3` (backoff) · `held (busy)` when `deliver: when-idle` and the target's `agentState` is not idle and `nextFire` ≤ now · `due` when past · `orphaned · expires {rel}` when orphaned (expiry = the entry's orphan TTL if the API exposes it, else just `orphaned`) · `muted {lease remaining}` / `muted` |
| last / next | `{lastFired rel} ✓` (or `—`) · `in {rel}` / `due` / `—` |
| actions | a trailing `…` button opening the sidebar row-flyout-card idiom (`useRowFlyout` + `CardActionList`) with **Mute/Unmute**, **Pin/Unpin**, **Delete** (danger, confirm) — the same actions the CLOCK row and the mobile sheet expose, calling `muteCron` / `pinCron` / `deleteCron`. Every mutation already wakes the SSE hub server-side; `useCronData` refetches on the next sessions tick |

A `+ New entry` dashed control at the end of the zone opens the existing `CronCreateDialog` (the
palette's `Cron: new entry` target) — same dialog, no new form.

### 4. RECENT DELIVERIES zone

The `deliveries` array (most-recent-first, server-capped) rendered as a compact log, newest first:
`{HH:MM} · {entry name or "(deleted entry)"} → {outcome}` where outcome maps to the delivery log's
disposition (`delivered ✓`, `held → delivered ✓`, `held-expired`, `skipped (absent)`, `respawned`,
error text in `text-signal-red`). Group by day with a thin day divider when the log spans days.
Show at most the server-capped list; no pagination, no fetch of more (the API owns the cap).

### 5. Data layer

- `useCronData(server)` (existing hook, mount fetch + sessions-SSE cadence) — one call at the
  dashboard root, passed down. No new polling.
- Watched rows and staleness come from `useSessionContext().sessionsByServer.get(server)` — no
  fetch at all.
- Time rendering is render-time relative (`formatDuration`), refreshed by the SSE cadence — **no
  ticking timer** (the feed's and CLOCK panel's shared contract).
- If the `CronEntry` type lacks a field the CRONS `state` column wants (orphan expiry, held reason),
  **do not add a backend field in this change** — render the column from what exists and list the
  gap in the memory file's § Extension Map. Backend scope stays zero.

### 6. Palette (Constitution V)

- `Server: Clock dashboard` (id `server-clock-dashboard`) — navigates to `/$server` and scrolls the
  `CRONS` heading into view (`scrollIntoView` on the zone's heading ref; a `#crons` hash is **not**
  added — URL stays as-is per the route contract). Registered in `serverActions` beside the copy
  actions, present on every route that resolves a server.
- The zones' row actions are already palette-covered (`Cron: mute…`, `Cron: pin…`,
  `Cron: delete…`, `Cron: new entry`).

### 7. Spec, study, memory

- `docs/specs/cron.md` § UI item 2 (as rewritten by `6ehs`): mark the Server page half **shipped**
  with the three zones named; adjust § Phasing P2.
- `docs/wiki/cron-clock-design-studies.html`: append § 1d "The registry — tmux Server page" with a
  static mock of the three zones (the study's existing CSS vocabulary), and add the palette row to
  § 4.
- `docs/memory/run-kit/ui/routes-and-shell.md` § tmux Server page: the three zones, their empty
  states, mobile hiding, the navigate seam; § Extension Map for fields the API does not yet expose
  (orphan expiry, held reason, escalations).

**Explicitly out of scope**: "pending escalations" (open questions awaiting the user) — needs a new
read of the fab operator state file's notes; not on any payload today. Listed in the extension map,
not built.

### 8. Tests

- Unit: each zone renders from fixture data (`makeWindow` factory in `src/test-utils/fixtures.ts`
  extended with `monitored*` fields if absent); empty states; stale dimming; sort order; the flyout
  actions call the API client; the palette entry scrolls.
- e2e (`tests/e2e/server-page.spec.ts` or new): with the msw handlers seeding `GET /api/cron`
  (`tests/msw/handlers.ts`) — zones visible below the grid on desktop, absent on the 375px mobile
  viewport, a mute action round-trips. **Proves:/Steps:** JSDoc on every new `test()`; run only via
  `just test-e2e` / `just pw`.

## Affected Memory

- `run-kit/ui/routes-and-shell`: (modify) § tmux Server page — WATCHED / CRONS / RECENT DELIVERIES
  zones, empty states, desktop-only gate, navigate seam, extension map
- `run-kit/ui/cron-activity`: (modify) cross-reference — feed (triage) vs Server page (registry);
  shared plain-words schedule formatter now has two consumers
- `run-kit/ui/keyboard-and-palette`: (modify) `Server: Clock dashboard` entry
- `run-kit/ui/sidebar`: (modify) one line — CLOCK section points to the Server page as the deep view
- `run-kit/cron`: (modify) § UI — Server page registry shipped; escalations remain unbuilt

## Impact

- Frontend only: new `components/server-clock-dashboard/*`, `app.tsx` (mount + palette action),
  reuse of `hooks/use-cron.ts`, `components/sidebar/row-flyout-card.tsx`,
  `components/cron-create-dialog.tsx`, the detail sheet's schedule formatter (export it if private),
  `components/status-dot`, `components/section-heading`.
- Backend: none. All data already served by `GET /api/cron` and the sessions SSE payload.
- Docs: `docs/specs/cron.md`, `docs/wiki/cron-clock-design-studies.html`, memory files above.
- Depends on `260910-6ehs` being merged (spec amendment; shared extraction). Independent of the
  hexokit and GUI work in flight.

## Open Questions

- Zone placement: below the Sessions grid (chosen — sessions stay the page's first answer) vs above
  it (clock first). Below is the default here; revisit after living with it.
- Should the WATCHED zone also list the operator window itself as a header row (state + tick age)?
  Default: no — the tick age lives in the zone's side slot.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Full view lives on the tmux Server page (`/$server`), no new route | Discussed — user proposed the server page; Constitution IV fixed route set | S:95 R:90 A:95 D:90 |
| 2 | Certain | Three zones: WATCHED, CRONS, RECENT DELIVERIES, using `SectionHeading` | Study § 1b's dashboard content, re-homed; the Server/Host pages' zone idiom | S:90 R:85 A:95 D:90 |
| 3 | Certain | Sequenced after `260910-6ehs` merges | Discussed — the operator starts this on that merge; inherits the spec amendment | S:95 R:90 A:95 D:90 |
| 4 | Certain | Zero backend change; escalations out of scope | Discussed — all data already served; escalations need a new derivation | S:90 R:90 A:90 D:85 |
| 5 | Confident | Zones render below the Sessions grid, desktop only | Sessions remain the page's first answer; mobile has the Activity feed; listed as open question | S:65 R:90 A:75 D:70 |
| 6 | Confident | CRONS row actions via the row-flyout-card idiom; create via the existing dialog | The sidebar's action-row idiom the study prescribes for desktop; Constitution III reuse | S:75 R:85 A:85 D:80 |
| 7 | Confident | WATCHED rows navigate to the window; no watchlist edits in the UI | Watchlist is derived from the operator state file and owned by `fab operator` verbs | S:80 R:90 A:90 D:80 |
| 8 | Confident | Data via `useCronData` + session context only; no timers | Existing hook and cadence contracts; Constitution II | S:85 R:90 A:90 D:85 |
| 9 | Confident | Palette `Server: Clock dashboard` scrolls the CRONS heading into view, no URL hash | Constitution V parity; route contract keeps URLs identity-only | S:70 R:85 A:80 D:75 |
| 10 | Tentative | Delivery outcome vocabulary mapped client-side from the log's disposition strings | Disposition set is known (`delivered`, `held-expired`, `skipped`, `respawned`) but exact field names must be read from the API/Go types at apply | S:50 R:80 A:60 D:55 |
| 11 | Tentative | Orphan expiry and held reason rendered only if the API already exposes them; otherwise omitted and listed in the extension map | Keeps backend scope at zero; may leave the mock's richest columns partially empty | S:55 R:85 A:65 D:60 |

11 assumptions (4 certain, 5 confident, 2 tentative, 0 unresolved).
