# Plan: Cron surface consolidation — console `Cron List | Cron Log` tabs, retire the sidebar CLOCK section and the Server-page CRONS / RECENT DELIVERIES zones, add a `cron` topic page to the rk skill bundle

**Change**: 260911-hcon-cron-surface-consolidation
**Intake**: `intake.md`

## Requirements

### Console: segment strip

#### R1: Four segments in a fixed order
The console segment strip (`components/terminal-activity-tabs.tsx`, shared by the desktop drawer and the mobile operator route) SHALL render exactly four segments in this fixed order and with these Title Case labels: `Operator Terminal` (token `terminal`), `Operator Tasks` (token `tasks` — the operator watchlist body `WatchedTasks`, shipped upstream by `260911-2281-console-tasks-segment-watchlist` and taken as built), `Cron List` (token `list`), `Cron Log` (token `log`). The `ConsoleSegment` type SHALL carry exactly those four tokens, exported `SEGMENTS` SHALL stay the single source the agreement test checks against `OperatorConsoleRequest.segment` and router-url's literal union, and no label MAY wrap or truncate at the desktop drawer width or at the 375px mobile header.

- **GIVEN** the desktop console drawer is open
- **WHEN** the segment header renders
- **THEN** four `role="tab"` buttons read `Operator Terminal`, `Operator Tasks`, `Cron List`, `Cron Log` in that order
- **AND** no button label wraps or is truncated

- **GIVEN** the mobile operator route at 375px
- **WHEN** the segmented header renders
- **THEN** the same four labels appear in the same order

#### R2: `Cron Log` is deliveries only
`components/cron-log.tsx` SHALL render the server's `deliveries` array from `useCronData` newest-first, one row per log line (fires, `missed`, `skipped-absent`, `rate-capped`, `rescheduled`, respawn outcomes), labeled by reason/outcome exactly as the current feed's delivery half does. It SHALL NOT render computed upcoming fires or a "now" divider. Tapping a row whose entry still exists opens `CronEntryDetailSheet` for that entry (modal on mobile, `inline` on desktop); a row for a deleted entry is not tappable. With no deliveries it renders the single line `No deliveries yet on {server}.`

- **GIVEN** a server with three deliveries and two entries
- **WHEN** `Cron Log` renders
- **THEN** three rows appear, newest first, and no upcoming-fire rows or divider exist

- **GIVEN** a delivery whose entry was deleted
- **WHEN** the user taps it
- **THEN** nothing opens

#### R3: `Cron List` is the registry
`components/cron-list.tsx` SHALL render every entry from `useCronData(server).entries`, one dense monospace row each: name (same fallback label the feed uses for unnamed entries), target chip, schedule summary (`describeSchedule`), relative next fire (`in 12m` / `due` / `—`), backoff rung (backoff kinds only), a `deliver` marker when `deliver` is not `immediate`, flags (`muted`, `muted {remaining}` while a lease is live, `pinned`), and orphan state. Rows sort by `nextFire` ascending; rows without `nextFire` sort last, stable by name then id. Muted and orphaned rows are dimmed, never omitted. With no entries it renders a `+ New entry` affordance plus the hint `Agents can schedule prompts too — rk cron add.`

- **GIVEN** entries A (`nextFire` in 5m), B (no `nextFire`), C (`nextFire` in 1m, muted)
- **WHEN** `Cron List` renders
- **THEN** the order is C, A, B and C is dimmed

#### R4: Row actions live on the entry detail surface
Tapping a `Cron List` row SHALL open `CronEntryDetailSheet` (modal on mobile, `inline` on desktop). The sheet SHALL offer: mute/unmute with a `Mute for…` choice (presets `30m`, `2h`, `8h`, `until unmuted`) posting to `POST /api/cron/mute` with the additive `for` field (absent for `until unmuted` and for unmute), pin/unpin, a new `Edit` row opening `CronCreateDialog` in edit mode, and delete with the existing confirm. `Cron List` SHALL carry a `+ New entry` affordance (header or footer, both form factors) opening `CronCreateDialog` in create mode. Every mutation SHALL POST and rely on the SSE-driven refetch; no polling.

- **GIVEN** an unmuted entry's detail sheet
- **WHEN** the user picks `Mute for… 2h`
- **THEN** the client POSTs `{id, muted: true, for: "2h"}` and the row shows `muted` with a remaining time on the next refetch

#### R5: Edit mode for the create dialog
`CronCreateDialog` SHALL accept an optional `entry: CronEntry` prop. In edit mode the title is `Edit entry` and the submit label `Save`; editable fields are name, schedule (kind change replaces the whole schedule), deliver, if-absent, and respawn argv (a non-`respawn` if-absent clears respawn); target, creator, payload, muted and pinned are read-only (payload rendered as text). Submit SHALL POST only changed fields via a new `editCron(server, body: CronEditBody)` client wrapper to `POST /api/cron/edit`; 400 bodies render inline; 409 `cron tick in progress` renders as a retryable inline error.

- **GIVEN** an entry with schedule `every 30m`
- **WHEN** the user changes only the name and saves
- **THEN** the POST body is `{id, name}` and the dialog closes on 200

- **GIVEN** the server answers 409
- **WHEN** the user saves
- **THEN** the dialog stays open with a retryable error line

#### R6: Stale banner above both cron tabs
The pinned staleness banner SHALL be extracted to `components/cron-stale-banner.tsx` and mounted once, above the body of `Cron List` and `Cron Log` (not above `Operator Terminal`), on both form factors, rendered exactly when the server's sessions report `operatorStale`.

- **GIVEN** `operatorStale` is true
- **WHEN** either cron tab is active
- **THEN** the banner shows; **AND** on `Operator Terminal` it does not

### Routing and seams

#### R7: `?tab=` tokens with a one-release alias
`lib/router-url.ts` SHALL type `tab?: "terminal" | "tasks" | "list" | "log"`; `validateTerminalSearch` SHALL accept `activity` and normalize it to `log`, dropping unknown values. `lib/operator-console.ts` SHALL type `segment` from the strip's `SEGMENTS` (the four tokens). The mobile gate in `app.tsx` SHALL treat `log` and `list` as cron tabs and swap the corresponding body in; the desktop handoff SHALL open the drawer on `segment: search.tab` for either value and strip the param once, as today.

- **GIVEN** a push-notification deep link `/{server}/{N}?tab=activity`
- **WHEN** it opens on mobile
- **THEN** the `Cron Log` tab is selected

- **GIVEN** `?tab=list` on desktop
- **WHEN** the operator route loads
- **THEN** the drawer opens on `Cron List` and the param is stripped

#### R8: Palette registry
The palette SHALL register `Operator: Show cron list` (`segment: "list"`) before `Operator: Show cron log` (`segment: "log"`, replacing `Operator: Show clock activity`). `Panel: Toggle Clock` and `Server: Clock dashboard` SHALL be removed. `Cron: new entry`, `Cron: mute…`, `Cron: pin…`, `Cron: delete…` remain.

- **GIVEN** the palette open
- **WHEN** the user types `cron`
- **THEN** `Operator: Show cron list` appears above `Operator: Show cron log`; **AND** neither `Panel: Toggle Clock` nor `Server: Clock dashboard` exists

#### R9: `◷` chip opens `Cron List`
The status-bar `◷` chip SHALL be visually unchanged; its click and the overflow row (relabeled `◷ Cron List`) SHALL call `requestOperatorConsole({action: "open", segment: "list"})`.

- **GIVEN** a server with one entry
- **WHEN** the chip is clicked
- **THEN** the console opens on `Cron List`

### Backend

#### R10: Notify deep-link emits the new token
`internal/cron/push_url.go` SHALL set `cronPushTab = "log"` so `PushURL` yields `/{server}/{N}?tab=log`.

- **GIVEN** server `dev`, window `@9`
- **WHEN** `PushURL` runs
- **THEN** it returns `/dev/9?tab=log`

#### R11: Mute route gains an additive lease field
`handleCronMute` SHALL accept an optional `for` (Go duration string) in its body. With `muted: true` and a valid `for`, it SHALL set the lease to now+`for` via `cron.SetMuteLease`; with `muted: true` and no `for`, today's `SetMuted` behavior; with `muted: false`, clear flag and lease as today. An unparsable or non-positive `for` SHALL 400. No new route.

- **GIVEN** `{id, muted: true, for: "2h"}`
- **WHEN** posted
- **THEN** the entry's `muted_until` is about two hours ahead and the response is 200

- **GIVEN** `{id, muted: true, for: "soon"}`
- **WHEN** posted
- **THEN** 400

#### R12: `cron` skill topic
A canonical page `docs/site/skill/cron.md` (≤150 lines, static-only, in the existing topic genre) SHALL exist, be synced by `scripts/sync-skill.sh` into `app/backend/cmd/rk/skill/cron.md`, embedded in `skill.go` as a `"cron"` row of `skillTopics`, and covered by the four topic test tables in `skill_test.go` (the valid-topics string becomes `code, cron, display, gui, messaging, mux, tutorial`). `docs/site/skill.md` § Topics SHALL gain the line `- **schedule a prompt for later or on a cadence** (user says "check on this every 30 min", "nudge me when…", "remind me at 9") → \`rk skill cron\``. The `rk cron` parent `Long` SHALL end with `Agent briefing: \`run-kit skill cron\`.` The page SHALL cover: what cron is (a prompt typed into the agent, never executed), when to reach for it, the four schedule flags, targets and auto-capture, `--deliver`, `--if-absent`/`--respawn` with `{server}`, `mute [--for] [--off]`, `pin`, `edit`, `list [--json]`, `rm`, and worked examples.

- **GIVEN** a built `rk`
- **WHEN** `rk skill cron` runs
- **THEN** stdout is byte-identical to the embedded page, stderr empty, exit 0

### Removals

#### R13: Sidebar CLOCK section retired
`components/sidebar/clock-panel.tsx` and its tests, the rail button and `ClockSectionIcon`, the `"clock"` `SidebarSection` member and its `use-sidebar-sections.ts` entry, the `showClock`/`ClockPanel`/`ClockStaleWarning` mount in `sidebar/index.tsx`, and the `Panel: Toggle Clock` entry with its `setClockVisible` plumbing SHALL be removed. A stored `runkit-sidebar-section-clock` value is ignored. The watched-row underbar, the `opr` register and `operatorStale` derivations are untouched.

- **GIVEN** localStorage has `runkit-sidebar-section-clock=true`
- **WHEN** the sidebar renders
- **THEN** no CLOCK panel and no Clock rail button exist, and no error is thrown

#### R14: Server page keeps WATCHED only
`crons-zone.tsx`, `deliveries-zone.tsx`, their tests, the CRONS/DELIVERIES parts of the dashboard `index.tsx` and `model.ts`, `lib/server-clock-dashboard-scroll.ts`, and the `Server: Clock dashboard` wiring SHALL be removed. `watched-zone.tsx` stays mounted through the `SessionTiles` `footer` slot. The folder SHALL be renamed `components/server-watched-zone/` (or flattened to one file when only the zone and its model remain). Cron helpers that `Cron List` still needs (`targetChip`, `isCronDimmed`, `mutedLabel`, `sortCronEntries`, `describeOutcome`) move to `lib/cron-list-model.ts`.

- **GIVEN** `/$server` on desktop
- **WHEN** the page renders
- **THEN** a WATCHED heading exists and no CRONS or RECENT DELIVERIES heading exists

### Tests

#### R15: Test coverage follows the new surfaces
Playwright: `mobile-cron-activity.spec.ts` becomes `mobile-cron-tabs.spec.ts`; `operator-console.spec.ts` is updated; `server-clock-dashboard.spec.ts` becomes `server-watched-zone.spec.ts`. Every `test()` carries the Proves/Steps JSDoc and each file its header comment. Vitest covers alias parsing, list sort, the strip labels, and the dialog's edit mode. Go tests cover `PushURL`, the mute `for` field, and the `cron` topic. Scoped lanes run first, then `just test`.

- **GIVEN** the change complete
- **WHEN** `just test` runs
- **THEN** it passes

### Non-Goals

- MCP cron write tools — a separate change
- The operator watchlist, watched-row underbar, `opr` register — not the clock
- Evaluator or schedule semantics — untouched
- fab-kit skill changes
- A migration UI for the stored CLOCK preference
- Rendering the `Operator Tasks` slot — future change

### Design Decisions

#### Tab names mirror the CLI
**Decision**: The cron tabs are `Cron List` and `Cron Log`, with `Cron List` first.
**Why**: rk's CLI-as-contract principle; `rk cron list` is the registry a user already knows, and the list is where actions live.
**Rejected**: "Watches"/"Cron Watches" (collides with the operator's worker watchlist: underbar, WATCHED zone, `opr`); "Logs"/"Cron Logs" for the merged feed (half of it was computed future fires).
*Introduced by*: 260911-hcon-cron-surface-consolidation

#### The log tab drops the upcoming-fires half
**Decision**: `Cron Log` shows deliveries only; each entry's next fire lives in `Cron List`.
**Why**: With one to five entries the merged timeline's ordering bought little, and it duplicated the registry without offering its actions.
**Rejected**: Keep the merged timeline under a new name — misdescribes the content.
*Introduced by*: 260911-hcon-cron-surface-consolidation

#### `activity` alias normalized in the validator
**Decision**: `validateTerminalSearch` maps `tab=activity` to `log` for one release.
**Why**: Already-sent push notifications keep landing; one place, unit-testable, no redirect.
**Rejected**: A route-level redirect (a navigation for an alias) or dropping the alias (dead links).
*Introduced by*: 260911-hcon-cron-surface-consolidation

#### Web mute lease rides the existing mute route
**Decision**: An optional `for` duration on `POST /api/cron/mute`.
**Why**: Constitution IX (POST only, no new verb shapes); the CLI's `mute --for` has the same store helper; backward compatible.
**Rejected**: Display-only lease (the list could not do what the CLI does); a new `/api/cron/mute-for` route.
*Introduced by*: 260911-hcon-cron-surface-consolidation

#### Fourth slot sized, not rendered
**Decision**: The strip is laid out for four labels but renders three.
**Why**: A disabled placeholder is a dead control with a state style and no behavior; the sizing is what protects the future change.
**Rejected**: A disabled `Operator Tasks` placeholder segment.
*Introduced by*: 260911-hcon-cron-surface-consolidation

### Deprecated Requirements

#### One merged timeline around a "now" divider
**Reason**: Split into `Cron Log` (deliveries) and `Cron List` (registry with next fire).
**Migration**: R2, R3.

#### Sidebar CLOCK section and `Panel: Toggle Clock`
**Reason**: Default-off duplicate of the registry now in the console.
**Migration**: R3, R13.

#### Server page CRONS / RECENT DELIVERIES zones and `Server: Clock dashboard`
**Reason**: A navigation away; duplicate renderers.
**Migration**: R2, R3, R14.

#### `Operator: Show clock activity`
**Reason**: Renamed with the tab.
**Migration**: R8.

## Tasks

### Phase 1: Setup

- [x] T001 `app/frontend/src/api/client.ts`: add `CronEditBody` + `editCron(server, body)` (POST `/api/cron/edit`); extend `muteCron` with an optional `forDuration?: string` that sends `for` in the body. Unit-test both in `client.test.ts` (or the existing cron client test). <!-- R5, R11 -->
- [x] T002 [P] `app/frontend/src/lib/router-url.ts`: `tab?: "terminal" | "log" | "list"`; `validateTerminalSearch` normalizes `activity` → `log`, drops unknown. Add/extend `router-url.test.ts` for `terminal`, `log`, `list`, `activity→log`, unknown. <!-- R7 -->
- [x] T003 [P] `app/backend/internal/cron/push_url.go`: `cronPushTab = "log"`, update the file comment; update `push_url_test.go` expectations (`?tab=log`). <!-- R10 -->
- [x] T004 [P] `app/backend/api/cron.go` `handleCronMute`: optional `For string \`json:"for"\``; `muted:true` + `for` → `time.ParseDuration`, non-positive/unparsable → 400, else `cron.SetMuteLease(dir, server, id, now+for)`; otherwise today's `SetMuted` path; fix the handler comment. Add cases to `api/cron_test.go` (lease set, absent keeps behavior, invalid → 400). <!-- R11 -->

### Phase 2: Core Implementation

- [x] T005 `app/frontend/src/components/terminal-activity-tabs.tsx`: `SEGMENTS` = `terminal`/`Operator Terminal`, `list`/`Cron List`, `log`/`Cron Log`; `ConsoleSegment` three tokens; `TerminalActivityTabs` reads `search.tab` ∈ {`log`,`list`} else `terminal`; size the strip for four labels (`whitespace-nowrap`, equal flex basis or a four-column grid, `text-[11px]` kept) and keep `data-testid="terminal-activity-tabs"`. Update the header comments. Add `terminal-activity-tabs.test.tsx` asserting labels, order, and no-wrap classes. <!-- R1 --> <!-- rework: merge with upstream #938 — FOUR segments `terminal|tasks|list|log`, labels `Operator Terminal | Operator Tasks | Cron List | Cron Log`; keep upstream's exported SEGMENTS + agreement test -->
- [x] T006 [P] `app/frontend/src/components/cron-stale-banner.tsx`: extract the pinned staleness banner from `cron-activity-feed.tsx` (same derivation from `sessionsByServer` `operatorStale`/`operatorLastTickAt`, same `data-testid`). <!-- R6 -->
- [x] T007 [P] `app/frontend/src/lib/cron-list-model.ts`: move `targetChip`, `isCronDimmed`, `mutedLabel`, `sortCronEntries`, `describeOutcome` (and any helper `Cron List`/`Cron Log` need) out of `components/server-clock-dashboard/model.ts`; `sortCronEntries` implements R3's order (soonest first, no-`nextFire` last, stable by name then id). Unit-test the sort and `mutedLabel` lease rendering in `cron-list-model.test.ts`. <!-- R3 --> <!-- rework: review must-fix — `describeOutcome` has zero call sites; DELETE it and its test block (R2 pins raw outcome rendering); also absorb upstream's `collectWatchedRows`/`watchlistStatus` into `server-watched-zone/model.ts`, not here -->
- [x] T008 `app/frontend/src/components/cron-log.tsx`: deliveries-only list per R2 (reuse the feed's `DeliveryRow` rendering, newest first, tap → `CronEntryDetailSheet` when the entry exists, empty line `No deliveries yet on {server}.`), `inline` prop as the feed had. Unit-test row count/order and the non-tappable deleted-entry row. <!-- R2 -->
- [x] T009 `app/frontend/src/components/cron-list.tsx`: registry rows per R3 using `lib/cron-list-model.ts` + `lib/cron-schedule.ts`; tap → `CronEntryDetailSheet`; `+ New entry` affordance opening `CronCreateDialog`; empty state with the `rk cron add` hint; `inline` prop. Unit-test rendering of flags/deliver marker/dimming and the empty state. <!-- R3, R4 -->
- [x] T010 `app/frontend/src/components/cron-create-dialog.tsx`: optional `entry?: CronEntry` → edit mode per R5 (title `Edit entry`, submit `Save`, read-only target/creator/payload, editable name/schedule/deliver/if-absent/respawn, changed-fields-only body via `editCron`, inline 400, retryable 409). Add `cron-create-dialog.test.tsx` cases for edit mode. <!-- R5 -->
- [x] T011 `app/frontend/src/components/cron-entry-detail-sheet.tsx`: add the `Edit` row (opens `CronCreateDialog` with `entry`), replace the plain mute toggle with mute/unmute + `Mute for…` presets (`30m`, `2h`, `8h`, `until unmuted`) calling `muteCron(server, id, true, forDuration)`; keep optimistic behavior and inline errors. Unit-test the preset → body mapping. <!-- R4 -->
- [x] T012 `app/frontend/src/components/operator-console.tsx` + `app/frontend/src/lib/operator-console.ts`: `segment` type `terminal|log|list`; body mapping `list` → `<CronList inline />`, `log` → `<CronLog inline />`, with `<CronStaleBanner />` mounted once above either cron body; terminal unmounted while a cron tab shows; the `?tab=` handoff maps either token; update comments that say "Activity". <!-- R1, R6, R7 --> <!-- rework: rebase merge — keep upstream's `tasks` → WatchedTasks body and its generalized non-terminal gate; add `list`/`log` bodies -->
- [x] T013 `app/frontend/src/app.tsx`: mobile gate (~937–951) treats `log`/`list` as cron tabs and swaps in `CronList`/`CronLog` (mobile variant) under `CronStaleBanner`; desktop handoff opens with `segment: search.tab`; keep strip-once behavior. <!-- R7 --> <!-- rework: rebase merge — keep upstream's consoleTab/terminalHidden/WatchedTasks slot and same-window-tap navigation; add list/log slots; handoff for any non-terminal tab -->
- [x] T014 Palette: `app/frontend/src/lib/palette/operator-console.ts` — add `buildOperatorConsoleListAction()` (`operator-console-list`, `Operator: Show cron list`, `segment:"list"`) and rename the activity builder to `buildOperatorConsoleLogAction()` (`operator-console-log`, `Operator: Show cron log`, `segment:"log"`); wire both, list first, where the old entry is registered (`app.tsx` ~4600, `hooks/use-global-palette-actions.ts`); remove `panel-toggle-clock` / `Panel: Toggle Clock` and `Server: Clock dashboard` (`app.tsx` ~4288–4298) with their plumbing. Update palette unit tests. <!-- R8, R13, R14 --> <!-- rework: rebase merge — keep upstream's `Operator: Show tasks`; order Open console · Show tasks · Show cron list · Show cron log -->
- [x] T015 [P] `app/frontend/src/components/status-bar.tsx`: `openClockActivity` → `openCronList` calling `requestOperatorConsole({action:"open", segment:"list"})`; overflow row label `◷ Cron List`; comments updated. <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T016 Retire the sidebar CLOCK section: delete `components/sidebar/clock-panel.tsx` (+ tests); remove `ClockSectionIcon` from `sidebar/icons.tsx` and its use in `sidebar/section-rail.tsx`; drop `"clock"` from `SidebarSection` and its entry in `hooks/use-sidebar-sections.ts` (+ tests); remove `clockSectionVisible`/`showClock`/`ClockPanel`/`ClockStaleWarning` from `sidebar/index.tsx`. Leave `monitored`/`operatorStale`/underbar/`opr` code untouched. <!-- R13 -->
- [x] T017 Server page: delete `components/server-clock-dashboard/{crons-zone,deliveries-zone}.tsx` (+ tests) and `lib/server-clock-dashboard-scroll.ts`; trim `index.tsx`/`model.ts` to WATCHED; rename the folder to `components/server-watched-zone/` (flatten if one component remains); update `session-tiles.tsx` footer import and comments; update `app.tsx` mount. <!-- R14 --> <!-- rework: rebase merge — upstream added watched-table.tsx/watched-tasks.tsx and moved watched helpers into the dashboard model; keep our folder name, port the model + thin watched-zone, re-point watched-tasks import -->
- [x] T018 Delete `components/cron-activity-feed.tsx` (+ test) once T008/T009/T012/T013 consume the new components; grep for remaining `CronActivityFeed`/`terminal-activity` "Activity" references in `src/` and update comments. <!-- R2 -->
- [x] T019 Skill topic: write `docs/site/skill/cron.md` (≤150 lines, genre of `docs/site/skill/gui.md`, content per R12); add the § Topics line to `docs/site/skill.md`; add the `sync` row to `scripts/sync-skill.sh` and run it (commit `app/backend/cmd/rk/skill/cron.md`); `skill.go` embed + `skillTopics["cron"]`; `skill_test.go` four table cases + valid-topics string; append `Agent briefing: \`run-kit skill cron\`.` to the `rk cron` `Long` in `cmd/rk/cron.go`. <!-- R12 -->
- [x] T020 Playwright: rename `tests/e2e/mobile-cron-activity.spec.ts` → `mobile-cron-tabs.spec.ts` (three segments at 375px, `?tab=activity` lands on `Cron Log`, `?tab=list` lands on `Cron List`, banner above both tabs, `+ New entry` opens the dialog, detail sheet `Edit` row); update `operator-console.spec.ts` (three segments, `◷` chip → `Cron List`, `Operator: Show cron list`/`Show cron log`, `?tab=activity` desktop handoff → `Cron Log`, absence of `Panel: Toggle Clock`/`Server: Clock dashboard`); rename `server-clock-dashboard.spec.ts` → `server-watched-zone.spec.ts` (WATCHED present, CRONS/RECENT DELIVERIES absent, mobile absent). Extend the e2e mocks the specs use for `/api/cron/edit` and the mute `for` field. Every `test()` gets the Proves/Steps JSDoc; each file a header comment. <!-- R15 --> <!-- rework: rebase merge — fold upstream's tasks-segment tests (mobile-cron-activity → mobile-cron-tabs, operator-console, operator-compose) into the four-segment specs -->
- [x] T021 Gates: `cd app/frontend && pnpm install --frozen-lockfile` if `node_modules` is missing; `just _ensure-tmux-conf`; `just test-backend`; `just test-frontend`; `cd app/frontend && npx tsc --noEmit`; `just test-e2e mobile-cron-tabs`, `just test-e2e operator-console`, `just test-e2e server-watched-zone`; then `just test`; fix failures. <!-- R15 --> <!-- rework: re-run all gates after the rebase (add operator-compose, sidebar-section-rail, status-bar e2e) -->

### Phase 4: Polish

- [x] T022 Verify `rk skill cron`, `rk skill topics`, and `rk help-dump` from a HEAD build (`go run ./cmd/rk skill cron | diff - skill/cron.md`); if `shll standards` is on PATH, read the `skill` and `help-dump` standards and confirm the `Topics:` line and the `rk cron` Long pointer conform; drop the pointer if the standard objects. <!-- R12 -->

## Execution Order

- T001–T004 are independent and precede Phase 2
- T005, T006, T007 precede T008, T009, T012, T013
- T010 precedes T011 (the sheet's Edit row opens the dialog's edit mode)
- T012 and T013 precede T018 (the feed is deleted only after both consumers switch)
- T017 depends on T007 (helpers moved before the model is trimmed)
- T019 is independent of the frontend work and may run alongside Phase 2
- T020 follows every frontend task; T021 follows T020; T022 follows T019

## Acceptance

### Functional Completeness

- [x] A-001 R1: The strip renders `Operator Terminal`, `Operator Tasks`, `Cron List`, `Cron Log` in that order on desktop and mobile, and `ConsoleSegment` carries exactly `terminal | tasks | list | log`
- [x] A-002 R2: `Cron Log` renders the deliveries array newest-first with no upcoming rows and no divider
- [x] A-003 R3: `Cron List` renders every entry with name, target chip, schedule summary, next fire, rung (backoff only), deliver marker (non-immediate only), flags with lease remaining, orphan state
- [x] A-004 R4: The detail sheet offers mute/unmute with `Mute for…` presets, pin/unpin, `Edit`, delete; `Cron List` carries `+ New entry`
- [x] A-005 R5: `CronCreateDialog` in edit mode shows `Edit entry`/`Save`, read-only target/creator/payload, and POSTs only changed fields to `/api/cron/edit` via `editCron`
- [x] A-006 R6: `CronStaleBanner` exists as its own component and is mounted once above the cron tabs' body, not above the terminal
- [x] A-007 R7: `validateTerminalSearch` accepts `tasks`/`log`/`list`, maps `activity` → `log`, drops unknowns; `requestOperatorConsole` `segment` is typed from `SEGMENTS` (`terminal|tasks|list|log`)
- [x] A-008 R8: Palette has `Operator: Show cron list` before `Operator: Show cron log`; `Cron: *` verbs remain
- [x] A-009 R9: The `◷` chip and the `◷ Cron List` overflow row open the console on `list`
- [x] A-010 R10: `PushURL("dev", "@9")` returns `/dev/9?tab=log`
- [x] A-011 R11: `POST /api/cron/mute` with `for` sets a lease; without `for` behaves as before; invalid `for` returns 400
- [x] A-012 R12: `rk skill cron` prints the embedded page byte-identically; `skillTopics` has a `cron` row; `docs/site/skill.md` § Topics lists it; `scripts/sync-skill.sh` syncs it; the `rk cron` Long ends with the agent-briefing pointer

### Behavioral Correctness

- [x] A-013 R2: A log row for a deleted entry is not tappable; a row for a live entry opens its detail sheet
- [x] A-014 R3: Sort is soonest-first, no-`nextFire` last, stable by name then id; muted/orphaned rows are dimmed, never omitted
- [x] A-015 R5: A 409 from `/api/cron/edit` leaves the dialog open with a retryable error; a 400 renders inline
- [x] A-016 R7: A cold `?tab=activity` on mobile selects `Cron Log`; on desktop it opens the drawer on `Cron Log` and strips the param
- [x] A-017 R1: No segment label wraps or truncates at the drawer width or at 375px with all four segments rendered

### Removal Verification

- [x] A-018 R13: No `clock-panel.tsx`, `ClockSectionIcon`, `"clock"` section, `runkit-sidebar-section-clock` entry, `Panel: Toggle Clock`, or `showClock` plumbing remains in `src/`; the underbar/`opr`/`operatorStale` code is unchanged
- [x] A-019 R14: No `crons-zone.tsx`, `deliveries-zone.tsx`, `server-clock-dashboard-scroll.ts`, or `Server: Clock dashboard` remains; `/$server` renders WATCHED only; the folder is `server-watched-zone`
- [x] A-020 R2: `cron-activity-feed.tsx` and its test are deleted and no `CronActivityFeed` import remains
- [x] A-021 R8: `Operator: Show clock activity` and the id `operator-console-activity` no longer exist

### Scenario Coverage

- [x] A-022 R15: `mobile-cron-tabs.spec.ts` covers the four segments at 375px, both deep links, banner on both tabs, `+ New entry`, and the `Edit` row
- [x] A-023 R15: `operator-console.spec.ts` covers the four desktop segments, the chip → `Cron List`, the tasks + both cron palette entries, the desktop `?tab=activity`/`?tab=tasks` handoffs, and the absence of the removed entries
- [x] A-024 R15: `server-watched-zone.spec.ts` covers WATCHED present, CRONS/RECENT DELIVERIES absent, mobile absent
- [x] A-025 R15: Vitest covers alias parsing, list sort, strip labels, dialog edit mode, and the mute preset → body mapping; Go tests cover `PushURL`, mute `for`, and the `cron` topic tables
- [x] A-026 R15: `just test` passes — known pre-existing environment exception: backend ok, frontend ok (221 files / 4554 tests), e2e 442 passed / 1 skipped / 1 failed (`gui-surface.spec.ts:1207` stats-overlay real-Xvnc test), and the same spec fails identically on a clean HEAD (verified via `git stash -u` + isolated rerun), so the failure is a pre-existing environment issue outside this diff; every spec this change touched passes. Cycle-2 review re-verified the gates: `just test-backend` ok, `just test-frontend` 221 files / 4554 tests ok, `npx tsc --noEmit` clean, and the scoped e2e lanes re-run on the rebased tree — mobile-cron-tabs 12 passed, operator-console 33 passed (exit 0), server-watched-zone 2 passed

### Edge Cases & Error Handling

- [x] A-027 R3: An entry with no `nextFire` renders `—` and sorts last; an unnamed entry uses the feed's fallback label
- [x] A-028 R4: `Mute for… until unmuted` and unmute send no `for` field
- [x] A-029 R13: A stored `runkit-sidebar-section-clock=true` causes no error and no panel
- [x] A-030 R12: `rk skill nosuch` exits non-zero listing `code, cron, display, gui, messaging, mux, tutorial`

### Code Quality

- [x] A-031 Pattern consistency: new components follow the feed's/sheet's naming, `controlClass` usage, `data-testid` conventions, and header-comment style
- [x] A-032 No unnecessary duplication: `lib/cron-schedule.ts` and `lib/cron-list-model.ts` are the only cron formatting/sort helpers; no second copy of the banner derivation
- [x] A-033 No client polling: every cron surface reads `useCronData` and relies on the SSE cadence
- [x] A-034 Type narrowing over assertions in the new TypeScript; no `as` casts introduced beyond `as const`
- [x] A-035 Comments state constraints, not narration; no change ids or PR numbers in code comments; every Playwright `test()` has Proves/Steps and each spec a header comment
- [x] A-036 Go: no new routes; `handleCronMute` keeps `exec`-free, context-free store calls; errors map to 400/404/500 as siblings do
- [x] A-037 Skill page ≤150 lines, static-only, byte-identical embed (drift-guard tests pass)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Hydrate scope (memory, spec, wiki captions, backlog alias-sunset item) is in `intake.md` § 11 and § Affected Memory

## Deletion Candidates

None — this change's planned retirements (sidebar CLOCK section, Server-page CRONS / RECENT DELIVERIES zones, `cron-activity-feed.tsx`, the scroll seam, the retired palette entries) are all executed in the diff, and cycle 1's candidate (`describeOutcome` in `lib/cron-list-model.ts`) was deleted this cycle. The legacy test ids `cron-activity-banner` and `server-clock-dashboard` survive deliberately (rename churn across specs for no behavior gain — recorded in `server-watched-zone.spec.ts`'s header), so they are rename opportunities, not deletions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `?tab=` tokens are `log` and `list`; alias normalized in `validateTerminalSearch` | Intake row 7; shortest stable tokens, one testable place | S:70 R:80 A:85 D:65 |
| 2 | Confident | Cron helpers move from the dashboard `model.ts` to `lib/cron-list-model.ts` | Both `Cron List` and the surviving WATCHED zone need a home that is not a component folder about to shrink | S:60 R:90 A:85 D:70 |
| 3 | Confident | `muteCron` gains an optional trailing `forDuration` argument rather than a new client function | Smallest client surface; the body field is additive | S:55 R:90 A:85 D:70 |
| 4 | Certain | All four segments render — upstream #938 (`260911-2281-console-tasks-segment-watchlist`) shipped `Operator Tasks` mid-flight; this change rebases onto it and takes slot 2 as built | The placeholder question is moot once the real tab exists | S:95 R:90 A:95 D:95 |
| 5 | Confident | The mobile cron tab bodies are the same `CronList`/`CronLog` components without `inline` | Parity requirement; the feed already shipped this two-variant shape | S:70 R:85 A:85 D:80 |
| 6 | Confident | The e2e mocks are extended in the same file the three specs already stub cron routes from | Existing specs stub `/api/cron`; edit and `for` are additive routes/fields | S:55 R:90 A:75 D:70 |
| 7 | Confident | The detail sheet's `Edit` row opens `CronCreateDialog` as a sibling modal (mobile) or inline panel (desktop) rather than editing in place | Reuses one dialog for create and edit; the intake fixes the dialog as the edit surface | S:65 R:80 A:80 D:70 |
| 8 | Certain | `describeSchedule`/`describeDeliver` stay in `lib/cron-schedule.ts` (already shared) | Verified: four consumers import them from that module today | S:90 R:95 A:95 D:95 |

8 assumptions (1 certain, 6 confident, 1 tentative).
