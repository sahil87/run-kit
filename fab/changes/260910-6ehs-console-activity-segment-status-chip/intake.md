# Intake: Console Activity Segment + Status-Bar Clock Chip

**Change**: 260910-6ehs-console-activity-segment-status-chip
**Created**: 2026-09-10

## Origin

Conversational — a `/fab-discuss` session (2026-09-10) reviewing how much of the cron clock plan
(`fab/plans/sahil/26-09-06-cron-clock-plan.md`) and its UI design (`docs/specs/cron.md` § UI,
`docs/wiki/cron-clock-design-studies.html`) actually shipped. Finding: the plan's ten changes all
merged, but of the spec's four UI tiers only tier 1 (the desktop sidebar `CLOCK` section, #863) and
tier 4 (the mobile Activity feed, #864) exist. Tier 2 — the "larger view", specced as an operator
dashboard inside the reserved `agents` surface tile — was excluded from the plan ("gets its own plan
when scheduled"), never re-planned, and has since lost its slot: the frontend's `SURFACE_KINDS` is
now `tty · web · code · gui` (the `gui` surface took the fourth kind).

> User: "I do need a larger UI or a larger view but I don't think this is tab-specific. This is more
> server-specific or tmux-server-specific. Should we combine it with the server page or should we use
> some other strategy? … Also it needs to be easily accessible. Maybe we mix it with the operator UI
> or maybe we create a shortcut on the main page where we see the terminal to get a glimpse of what's
> happening on clocks."

Agreed direction (two changes, this is the first):

1. **This change — the glimpse.** The desktop operator console drawer gains the `Terminal | Activity`
   segment that mobile already ships, plus a status-bar clock chip on the terminal route that opens
   the console on the Activity segment. Spec amendment: `docs/specs/cron.md` tier 2 is re-pointed
   from the agents tile to (console Activity segment + tmux Server page dashboard), and the study's
   § 1b is marked superseded.
2. **Second change (`260910-1rx0-server-page-clock-dashboard`) — the full view.** The tmux Server
   page (`/$server`) gains WATCHED / CRONS / RECENT DELIVERIES zones. Sequenced after this change
   merges (it inherits the spec amendment and any shared feed refactor).

Rejected during discussion: keeping the agents-tile design (tab-scoped indirection for a server-scoped
fact; slot gone); a new `/$server/clock` route (Constitution IV fixed route set); a dedicated `clock`
surface kind (already rejected by the spec); folding everything into the console (an output-only
drawer sized for one terminal cannot carry a registry); folding everything into the Server page
(leaves "glimpse without leaving the terminal" unmet — the actual complaint).

## Why

**Problem.** The only desktop view of the cron clock is the sidebar `CLOCK` section — a ~260px
glance the design explicitly sized as "enough for a glance, not for what all the operator is doing."
Its rows are trimmed against the study's mock (no last-delivery, no held reason, no orphan expiry,
no header tick age), and it is default-off behind a rail toggle. Seeing what is about to fire, what
just fired, and whether the operator loop is stale requires either enabling that section or picking
up a phone (the mobile Activity feed is the richer surface today).

**Consequence of not fixing.** The operator backstop is the mechanism that "kills the incident
class" of a dead operator loop, and its staleness signal is the dead-man's switch — yet on desktop
that alarm is a small yellow `⚠ operator stale` in a section most viewers have hidden. The
design's tier-2 "larger view" was the intended home and it no longer has a surface to land on.

**Why this approach.** Every piece already exists: the console drawer is root-mounted, server-
resolved, output-only, opened by ⌘J from any route (zero navigation — the study's hard rule for
the glance tier); mobile already renders `Terminal | Activity` on the same console concept via
`TerminalActivityTabs` + `CronActivityFeed`; the status bar is the shell's always-visible strip
whose design memory already reserves "a next-tick readout may ride it later." This change is
desktop parity with a shipped mobile design, not new design. The spec even anticipates it: "the
console title strip's live agent-state line is the natural later home for the tick-age stamp."

## What Changes

### 1. Desktop console drawer: `Terminal | Activity` segments

`app/frontend/src/components/operator-console.tsx` (desktop branch only — the mobile branch is
untouched; it already navigates to the operator route where `TerminalActivityTabs` mounts).

- Under the title strip (`◉ OPERATOR · server · agentState · ▼`) and above the status line, render a
  segmented header with two segments, **Terminal** and **Activity**, reusing the `controlClass({
  variant: "segment" })` idiom `TerminalActivityTabs` uses. Extract the presentational segment strip
  from `terminal-activity-tabs.tsx` into a controlled component (`value`/`onChange` props) so the
  mobile tabs (router-search-param driven) and the desktop console (component-state driven) share
  one render. The mobile behavior and test ids stay identical.
- Segment state is **console-local, per-viewer, ephemeral** (`useState`, default `terminal`) — the
  drawer's open/closed is already ephemeral component state (Constitution IV); no URL, tmux, or
  localStorage write. Re-opening the drawer starts on Terminal unless opened with an explicit
  segment request (see § 3).
- **Activity segment body**: mount `<CronActivityFeed server={server} />` in place of the
  `TerminalClient`. The feed already renders the pinned staleness banner, the UPCOMING / now /
  EARLIER timeline, and opens `CronEntryDetailSheet` on row tap. The `TerminalClient` is
  **unmounted** while Activity is shown (one relay stream max per drawer; the `key` on
  `TerminalClient` already makes remount cheap). Glass background applies unchanged.
- The Activity body inherits the console's server resolution and its degrade-to-absent posture: with
  no resolvable server (the param-less multi-server picker case with nothing picked) the segment
  shows the same centered hint line the feed already renders for an unresolvable server.
- **Entry detail on desktop**: `CronEntryDetailSheet` currently mounts as a mobile bottom sheet. On
  desktop it renders inside the drawer as a panel replacing the feed (a back affordance `‹ Activity`
  in the sheet's header returns to the feed). No flyout cards are introduced in the drawer — the
  mute toggle / pin / delete rows are the sheet's, unchanged. If the sheet's geometry is
  coarse-pointer-specific, gate those classes with `coarse:` rather than forking the component.
- **Title strip tick-age stamp**: append ` · tick {age} ago` (via `formatDuration`) after the agent
  state, read from the session's server-derived `operatorLastTickAt`; when `operatorStale` is true
  render it in `text-signal-yellow` with the `⚠` glyph (the CLOCK header's exact copy and tooltip:
  `Operator last ticked {age} ago`). Render nothing when the field is absent (older backend / no
  operator). Render-time only, no ticking timer (the feed's SSE-cadence contract).

### 2. Status-bar clock chip (terminal route, desktop)

`app/frontend/src/components/status-bar.tsx`, RIGHT (host/server) cluster, placed immediately
before the `<server>` fragment.

- A `<button>` segment `◷ {next}` where `{next}` is the soonest `nextFire` across the current
  server's entries rendered as `in 4m` / `due` (the sheet's existing relative-time helper). When the
  server's sessions carry `operatorStale === true`, the chip renders `◷ stale {age}` in
  `text-signal-yellow` (one chip, two states — never two chips). When there are zero entries and no
  staleness, the chip is **omitted** (omit-not-disable, the bar's value-gating rule).
- Data: `useCronData(server)` at the leaf (the bar's presentational-by-contract rule permits leaf
  subscriptions to existing contexts/hooks; the hook rides the existing sessions SSE cadence — no
  new fetch loop). `server` is already a `StatusBarProps` input; the chip renders only when it is
  non-null (terminal and server routes; never on the Host page).
- Click: `requestOperatorConsole({ action: "open", segment: "activity" })` (§ 3). Tooltip (`Tip`):
  `Clock — next fire {name} in {rel}` / `Operator loop stale — last tick {age} ago`.
- Degradation ladder: the chip drops with the hints at `≥xl` **but** the stale state never drops
  (the connection-dot precedent — an alarm must survive the ladder); the `…` overflow menu gains a
  mirroring `clk` row with the inverse breakpoint class, carrying the same open action.
- Copy affordance: none (no stable raw value — the `agt` rule).

### 3. Console open seam: optional segment

`app/frontend/src/lib/operator-console.ts`: extend the `rk:operator-console` event payload
(`requestOperatorConsole`) with an optional `segment?: "terminal" | "activity"`. The desktop console
applies it on open (sets the segment state); the mobile branch maps `segment: "activity"` to its
existing navigation with `search: { tab: "activity" }` so the notify deep-link and the mobile route
agree. Callers omitting `segment` see no behavior change.

Desktop honoring of the existing `?tab=activity` deep-link (from `rk notify`, `internal/cron/push_url.go`):
`app.tsx` computes `activityTabActive = operatorConsoleTabs && search.tab === "activity"` and
`operatorConsoleTabs` is mobile-gated, so on desktop the param is currently inert. Add: on the
desktop terminal route, when `search.tab === "activity"` is present on the operator window's route,
dispatch `requestOperatorConsole({ action: "open", segment: "activity" })` once on mount and strip
the param (`navigate({ search: prev => ({...prev, tab: undefined}), replace: true })`) so a reload
does not re-open. This makes one deep-link land correctly on both form factors.

### 4. Palette (Constitution V)

`app/frontend/src/lib/palette/operator-console.ts` gains a second pure builder:
`Operator: Show clock activity` (id `operator-console-activity`) → `requestOperatorConsole({ action:
"open", segment: "activity" })`. Registered beside `Operator: Open console` in
`use-global-palette-actions.ts`; same availability gating (absent when the console is unavailable).
No new chord — ⌘J stays the console toggle; the segment is one Tab-reachable click inside it. The
segment buttons are `role="tab"` with roving keyboard focus exactly as the mobile tabs.

### 5. Spec + study amendment

- `docs/specs/cron.md` § UI: rewrite item 2 (Dashboard). New text: the larger view is
  **server-scoped**, split into (a) the console's Activity segment on desktop (this change — parity
  with the mobile feed, the glimpse), and (b) the tmux Server page's WATCHED / CRONS / RECENT
  DELIVERIES zones (`260910-1rx0`, the registry). Record the agents-tile dashboard as **superseded**
  with the reason (tab-scoped tile for a server-scoped fact; the `agents` kind is no longer
  reserved — `gui` took the fourth surface). Add "status-bar clock chip → console Activity" to the
  tier list and to the palette line. Update § Phasing P2 wording accordingly. Keep tier 3 (board
  immersion) as-is.
- `docs/wiki/cron-clock-design-studies.html` § 1b: prepend a short "Superseded 2026-09-10 — see
  `docs/specs/cron.md` § UI item 2" note above the mock; leave the mock in place as the record of
  the rejected direction. Update the § 4 interaction inventory with the two new rows (status-bar
  chip; palette `Operator: Show clock activity`).
- `docs/specs/index.md`: refresh the Cron row description (drop "operator dashboard in the reserved
  agents tile" phrasing if present).

### 6. Tests

- Unit (`operator-console.test.tsx`): desktop drawer renders the two segments; Activity mounts the
  feed and unmounts the terminal; `segment` in the open request selects Activity; tick-age stamp
  renders/dims per `operatorStale`; mobile branch unchanged (existing tests stay green).
- Unit (`status-bar.test.tsx`): chip omitted with zero entries; `in Nm` with entries; stale state
  wins and survives the `≥xl` drop; click dispatches the console event with `segment: "activity"`;
  overflow row mirrors.
- Unit (`terminal-activity-tabs.test.tsx` or new): the extracted controlled segment strip; mobile
  tabs still drive `?tab`.
- e2e (`tests/e2e/`): one desktop case — open console via ⌘J, click Activity, feed visible; one
  case — status-bar chip click opens the console on Activity. Every new `test()` carries the
  **Proves:/Steps:** JSDoc block (constitution § Test Intent Comments). Run via `just test-e2e` /
  `just pw` only.

## Affected Memory

- `run-kit/ui/operator-console`: (modify) desktop `Terminal | Activity` segments, Activity body =
  `CronActivityFeed`, desktop entry-detail panel, title-strip tick-age stamp, `segment` in the open
  seam, desktop `?tab=activity` handling
- `run-kit/ui/cron-activity`: (modify) feed now has two mounts (mobile route + desktop console);
  the shared controlled segment strip; the desktop detail-panel variant
- `run-kit/ui/status-signals`: (modify) § Status Bar — the `◷` clock chip (right cluster, states,
  ladder exception for stale, overflow row, no copy affordance)
- `run-kit/ui/keyboard-and-palette`: (modify) `Operator: Show clock activity` entry
- `run-kit/ui/sidebar`: (modify) one line — the CLOCK section is the glance; the console segment
  and Server page are the larger views (cross-reference only)
- `run-kit/cron`: (modify) § UI pointer — tier 2 re-pointed; agents-tile superseded

## Impact

- Frontend only: `components/operator-console.tsx`, `components/terminal-activity-tabs.tsx`
  (extract), `components/cron-activity-feed.tsx` (desktop mount tolerance),
  `components/cron-entry-detail-sheet.tsx` (desktop panel variant), `components/status-bar.tsx`,
  `lib/operator-console.ts` (event payload), `lib/palette/operator-console.ts`,
  `hooks/use-global-palette-actions.ts`, `app.tsx` (desktop `?tab=activity` handoff).
- No backend change: `GET /api/cron` already returns `entries` + `deliveries`; `operatorStale` /
  `operatorLastTickAt` already ride the sessions payload; `POST /api/cron/{mute,pin,delete}` exist.
- No new fetch loops (feed and chip ride `useCronData` on the sessions SSE cadence).
- Docs: `docs/specs/cron.md`, `docs/specs/index.md`, `docs/wiki/cron-clock-design-studies.html`.
- Relay budget: unchanged — the drawer holds at most one `TerminalClient`, unmounted on Activity.

## Open Questions

- Should the desktop drawer remember the last segment per viewer (localStorage, like geometry and
  opacity) instead of resetting to Terminal? Default here: reset (ephemeral), matching open/closed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Larger view is server-scoped, not a per-tab tile; agents-tile dashboard superseded | Discussed — user stated scope; `agents` kind no longer in `SURFACE_KINDS` | S:95 R:85 A:95 D:90 |
| 2 | Certain | Glimpse lands in the operator console drawer as a `Terminal \| Activity` segment | Discussed — user proposed mixing with operator UI; mobile already ships this exact shape | S:90 R:85 A:95 D:90 |
| 3 | Certain | Shortcut from the terminal page is a status-bar chip that opens the console on Activity | Discussed — user asked for a shortcut on the terminal page; status-bar memory reserves the slot | S:85 R:90 A:90 D:85 |
| 4 | Certain | Full registry view (WATCHED/CRONS/DELIVERIES) is a separate change on the Server page, sequenced after this one | Discussed — two-change split agreed; second change drafted as `260910-1rx0` | S:95 R:90 A:95 D:90 |
| 5 | Confident | Reuse `CronActivityFeed` + `CronEntryDetailSheet` verbatim in the drawer; extract a controlled segment strip from `TerminalActivityTabs` | Constitution III/IV — wrap shipped pieces; one render for both form factors | S:80 R:80 A:85 D:75 |
| 6 | Confident | Segment state is ephemeral component state, default Terminal | Matches the drawer's open/closed posture (Constitution IV); listed as open question for per-viewer persistence | S:65 R:90 A:75 D:70 |
| 7 | Confident | `TerminalClient` unmounts while Activity is shown | Relay-budget discipline (6-per-origin lesson); remount is keyed and cheap | S:70 R:85 A:85 D:75 |
| 8 | Confident | Chip omitted when no entries and not stale; stale state never drops in the ladder | Bar's omit-not-disable rule; alarm-survives-ladder follows the connection-dot precedent | S:70 R:85 A:80 D:75 |
| 9 | Confident | Desktop honors `?tab=activity` by opening the console on Activity and stripping the param | Deep-link (`rk notify`) must land on both form factors; strip prevents reopen on reload | S:65 R:80 A:75 D:70 |
| 10 | Confident | Palette entry `Operator: Show clock activity`, no new chord | Constitution V parity; ⌘J remains the console chord | S:75 R:90 A:85 D:80 |
| 11 | Tentative | Desktop entry detail renders as an in-drawer panel with a back affordance (not a modal, not a flyout) | Study bans flyouts for this content; modal over a quake drawer is heavy; implementer may pick sheet-in-drawer if simpler | S:50 R:75 A:60 D:55 |
| 12 | Tentative | Title-strip tick-age stamp uses the CLOCK header's copy and yellow treatment | Spec names the strip as the tick-age home; exact copy is a reasonable mirror | S:55 R:85 A:70 D:60 |

12 assumptions (4 certain, 6 confident, 2 tentative, 0 unresolved).
