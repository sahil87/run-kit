# Plan: Cron Tabs Ungated

**Change**: 260913-05ab-cron-tabs-ungated
**Intake**: `intake.md`

## Requirements

### run-kit/ui: Desktop drawer — cron segments render on a resolved server alone

#### R1: The drawer's cron segments need no operator window
The desktop quake drawer body SHALL render `Cron List` / `Cron Log` (with `CronStaleBanner` above) whenever `server` resolves, regardless of whether the server has a `role === "operator"` window; only the `Operator Terminal` segment SHALL read the operator target (embedded terminal when it resolves, the operator-less body with `Start operator` + `NO_OPERATOR_HINT` otherwise). The existing body branch in `components/quake-terminal.tsx` is the implementation; this requirement pins it with tests and does not rewrite it.

- **GIVEN** a resolved server whose sessions carry no `role: "operator"` window
- **WHEN** the drawer receives `requestQuakeTerminal({ action: "open", segment: "list" })`
- **THEN** `cron-list` renders inside the drawer and `quake-terminal-empty` does not
- **AND WHEN** the segment is `log`, **THEN** `cron-log` renders
- **AND WHEN** the segment is switched back to `terminal`, **THEN** `quake-terminal-empty` with `quake-terminal-start-operator` renders

### run-kit/ui: Mobile arm — operator-less cron requests navigate to the Server page

#### R2: Cron-segment requests on an operator-less server navigate to `/$server#cron`
On mobile, a quake terminal request carrying `segment: "list"` or `segment: "log"` whose resolved server has no operator window SHALL navigate to `/$server` (params `{ server }`, hash `cron`, no search) and SHALL NOT toast. Requests with `segment` absent, `"terminal"`, or `"tasks"` on that server, and every request with no resolvable server, SHALL keep the throttled `NO_OPERATOR_HINT` toast with no navigation. Requests on a server WITH an operator window are unchanged (operator route + `?tab=`).

- **GIVEN** a mobile viewport and a resolved server with no operator window
- **WHEN** `Operator: Show cron list` (segment `list`) fires
- **THEN** `navigate({ to: "/$server", params: { server }, hash: "cron" })` is called once and no toast is added
- **AND WHEN** `segment: "log"` fires, **THEN** the same navigation happens
- **AND WHEN** a segment-less or `tasks` request fires, **THEN** the hint toast renders once and `navigate` is not called
- **AND GIVEN** no resolvable server, **WHEN** a `list` request fires, **THEN** the hint toast renders and `navigate` is not called

### run-kit/ui: Mobile Server page — the Cron section

#### R3: `ServerWatchedZone` forks by form factor
`ServerWatchedZone` SHALL render its `server-clock-dashboard` root on both form factors: on desktop the existing `WatchedZone` (unchanged), on mobile (`useIsMobile()`) a new `CronZone`. It SHALL accept a new `server: string` prop, passed by `app.tsx`'s single mount. `WatchedZone` and its tests are untouched.

- **GIVEN** the tmux Server page on a 375×812 viewport
- **WHEN** it renders
- **THEN** `server-clock-dashboard` and `clock-zone-cron` are present and `clock-zone-watched` / `watched-table` are absent
- **AND GIVEN** a desktop viewport, **THEN** `clock-zone-watched` is present and `clock-zone-cron` is absent

#### R4: `CronZone` anatomy
`CronZone` (`components/server-watched-zone/cron-zone.tsx`) SHALL render `<section id="cron" data-testid="clock-zone-cron">` containing `<SectionHeading label="Cron" side={side} className="mb-2" />`, then `<CronStaleBanner server />`, then `<CronList server />` (no `inline` — the modal detail-sheet variant, as on the mobile operator route). `side` SHALL read, from `useCronData(server).entries` at render time: `no entries` when empty; otherwise `{N} entries` plus ` · next in {rel}` when the soonest `nextFire` (via `sortCronEntries`) is ahead, ` · next due` when it is due/past, and no suffix when no entry carries `nextFire`; `{N} entries` uses `entry` for N = 1. No timer — the SSE cadence is the clock. It SHALL be always rendered on mobile regardless of operator presence and never on desktop.

- **GIVEN** entries A (`nextFire` in 5m) and B (no `nextFire`)
- **WHEN** `CronZone` renders
- **THEN** the side slot reads `2 entries · next in 5m`, the banner is absent (no stale session), and `cron-list` renders with both rows
- **AND GIVEN** zero entries, **THEN** the side slot reads `no entries` and `CronList`'s own empty hint renders
- **AND GIVEN** a session with `operatorStale: true`, **THEN** `cron-activity-banner` renders above the list

#### R5: Hash-driven scroll-to
`CronZone` SHALL scroll its section root into view (`scrollIntoView({ block: "start" })`) once on mount when the router location hash is `cron` (TanStack's `useLocation().hash`, which strips the `#`), and never otherwise.

- **GIVEN** the Server page mounted at `/default#cron`
- **WHEN** `CronZone` mounts
- **THEN** `scrollIntoView` is called on the section root exactly once
- **AND GIVEN** `/default` with no hash, **THEN** it is not called

### run-kit/ui: Copy and comments

#### R6: Comments and docs stop claiming the operator gate on cron
The registration comments for the two cron palette rows in `hooks/use-global-palette-actions.ts` and the builder doc-comments in `lib/palette/quake-terminal.ts` SHALL state the actual constraint (desktop: the cron segments render regardless of operator; mobile operator-less: the Server page's Cron section). `NO_OPERATOR_HINT`, the two row labels, the `◷` chip derivation, and the rows' always-listed registration are unchanged.

- **GIVEN** the two files
- **WHEN** read
- **THEN** no comment says an operator-less server is "answered by the hint line" for the cron rows

### run-kit/ui: Tests

#### R7: E2e coverage of the ungated paths
`tests/e2e/quake-terminal.spec.ts` SHALL gain a desktop test (operator-less server, `◷` chip click opens the drawer on Cron List with `cron-list-row-a3f9` visible and no `quake-terminal-empty`) and a mobile test (operator-less server, palette `Operator: Show cron list` lands on `/default` with `#cron`, `clock-zone-cron` visible with the stubbed row, no hint toast); the existing mobile toast test's intent comment SHALL note the cron-segment exception. `tests/e2e/server-watched-zone.spec.ts`'s `the zone is absent on the mobile viewport` SHALL become a test that the mobile viewport renders the Cron section (`server-clock-dashboard`, `clock-zone-cron`, the `Cron` heading, `+ New entry`, the stubbed cron row) and no `clock-zone-watched` / `watched-table`. Every new or changed `test()` carries its JSDoc **Proves/Steps** block (Constitution § Test Intent Comments). `mobile-cron-tabs.spec.ts` is unchanged.

- **GIVEN** the three specs
- **WHEN** `just test-e2e quake-terminal.spec`, `just test-e2e server-watched-zone.spec`, `just test-e2e mobile-cron-tabs.spec`, and `just test-e2e operator-compose.spec` run
- **THEN** all pass

### Non-Goals

- Rewriting the drawer body branch for symmetry — it is already correct.
- A `Cron Log` view on the mobile Server page — registry only; the log's mobile entry is the push deep-link, which needs the operator route.
- A Cron section on the desktop Server page — the 2026-09-11 supersession of the CRONS zone stands.
- Any change to the mobile tongue, the `◷` chip's derivation, the palette row labels, `GET /api/cron`, routes, or per-viewer state.

### Design Decisions

#### Cron is ungated from the operator
**Decision**: `Cron List` / `Cron Log` need only a resolved server; only `Operator Terminal` / `Operator Tasks` depend on the operator window.
**Why**: agents schedule with `rk cron add`, entries target any role/session/pane, the operator-tick entry is one consumer's entry; a phone user who stopped the operator must still reach the registry that mutes the respawning entry.
**Rejected**: keeping the gate (leaves the decision of record half-true); a mobile cron sheet (the mobile arm is navigation by design); a Cron section on desktop (the CRONS-zone supersession).
*Introduced by*: 260913-05ab-cron-tabs-ungated

#### The mobile operator-less cron home is the Server page, registry only
**Decision**: `ServerWatchedZone`'s mobile branch renders a `Cron` section (`CronList`, no log) in the tiles' footer slot; mobile cron requests on an operator-less server navigate to `/$server#cron`.
**Why**: server-scoped page for a server-scoped fact; the footer slot already renders on both form factors; no new route (Constitution IV); an explicit hash-scroll effect keeps the landing independent of router hash handling inside the tiles' nested scroll container.
**Rejected**: a `List | Log` sub-strip in the section (machinery for a second-order case); a `?tab=` search param on `/$server` (the route validates no search; the hash is the lighter carrier).
*Introduced by*: 260913-05ab-cron-tabs-ungated

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/quake-terminal.tsx` `mobileRequestRef.current`, split the operator-less branch: no server ⇒ toast (unchanged); server without operator and `segment` ∈ {`list`,`log`} ⇒ `navigate({ to: "/$server", params: { server: srv }, hash: "cron" })` and return; otherwise toast (unchanged). Add Vitest cases in `components/quake-terminal.test.tsx`: desktop operator-less `list`/`log`/`terminal` body rendering (R1) and the four mobile-arm cases (R2). <!-- R1, R2 -->
- [x] T002 Create `app/frontend/src/components/server-watched-zone/cron-zone.tsx` (`CronZone({ server })` per R4 + the R5 hash-scroll effect via `useLocation` from `@tanstack/react-router`); change `server-watched-zone/index.tsx` to render `CronZone` on mobile and `WatchedZone` on desktop inside the shared `server-clock-dashboard` root, adding the `server` prop; pass `server={server}` at the `app.tsx` mount. Add `cron-zone.test.tsx` (side-slot strings, banner gating, `CronList` mounted without `inline`, hash scroll only for `cron`) and an `index.test.tsx` fork case (mobile ⇒ `clock-zone-cron`, desktop ⇒ `clock-zone-watched`). <!-- R3, R4, R5 -->
- [x] T003 Reword the cron-row comments in `app/frontend/src/hooks/use-global-palette-actions.ts` and the `buildQuakeTerminalListAction`/`LogAction` doc-comment in `app/frontend/src/lib/palette/quake-terminal.ts` to the actual constraint; verify no drawer-body comment in `quake-terminal.tsx` narrates an operator gate on the cron branch. <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T004 E2e: in `app/frontend/tests/e2e/quake-terminal.spec.ts` add the desktop operator-less `◷` chip test and the mobile operator-less palette → `/default#cron` test, and extend the existing mobile toast test's intent comment; in `tests/e2e/server-watched-zone.spec.ts` rewrite `the zone is absent on the mobile viewport` into the Cron-section assertion (the spec's cron stub already exists). Run `npx tsc --noEmit`, the two Vitest files, and `just test-e2e quake-terminal.spec`, `server-watched-zone.spec`, `mobile-cron-tabs.spec`, `operator-compose.spec`. <!-- R7 -->

### Phase 4: Polish

- [x] T005 Spec: update `docs/specs/cron.md` § UI — Three Tiers item 4 ("gated on the operator window" ⇒ the operator route hosts the tabs when an operator exists, the Server page's Cron section otherwise; drop "degrade-to-absent gating") and add one sentence to item 2 stating the desktop drawer's cron segments need no operator. (Memory files are hydrate's; the spec is human-curated and rides the same PR.) <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: With a resolved operator-less server, `segment: "list"` renders `cron-list` and `segment: "log"` renders `cron-log` in the desktop drawer with no `quake-terminal-empty`; `terminal` renders the Start-operator body — covered by Vitest
- [x] A-002 R2: On mobile, `list`/`log` requests on an operator-less server call `navigate` with `{ to: "/$server", params: { server }, hash: "cron" }` and add no toast; segment-less/`tasks`/no-server requests toast once and never navigate — covered by Vitest
- [x] A-003 R3: `ServerWatchedZone` renders `CronZone` on mobile and `WatchedZone` on desktop under one `server-clock-dashboard` root, taking `server`; `app.tsx` passes it
- [x] A-004 R4: `CronZone` renders `section#cron[data-testid=clock-zone-cron]` with the `Cron` heading, the computed side slot, `CronStaleBanner`, and `CronList` without `inline`
- [x] A-005 R5: `scrollIntoView` fires once on mount only when the location hash is `cron`
- [x] A-006 R6: The palette-row comments state the actual constraint; no drawer-body comment narrates a cron operator gate
- [x] A-007 R7: The four e2e specs pass with the new/changed tests and their intent blocks

### Behavioral Correctness

- [x] A-008 R2: A mobile request WITH an operator window still navigates to the operator route with `?tab=` (and `?from=` cross-route) — `mobile-cron-tabs.spec.ts` unchanged and green; the existing Vitest mobile-arm cases still pass
- [x] A-009 R3: `watched-zone.test.tsx` and the desktop `server-watched-zone.spec.ts` tests pass unchanged

### Scenario Coverage

- [x] A-010 R1: Vitest covers list, log, and terminal segments on an operator-less server
- [x] A-011 R4: Vitest covers the `2 entries · next in 5m`, `no entries`, and stale-banner scenarios
- [x] A-012 R7: E2e covers the desktop `◷` chip on an operator-less server and the mobile palette → Cron section landing

### Edge Cases & Error Handling

- [x] A-013 R2: No resolvable server + `list` request ⇒ toast, no navigate
- [x] A-014 R4: An entry whose `nextFire` is in the past reads `next due`; all-undated entries read `{N} entries` with no suffix; one entry reads `1 entry`
- [x] A-015 R5: Hash absent ⇒ no scroll call; the effect does not re-fire on re-render

### Code Quality

- [x] A-016 Pattern consistency: `CronZone` follows `WatchedZone`'s heading/side-slot idiom and the module's `clock-zone-*` test-id scheme; render-time ages via `formatDuration`, no timers
- [x] A-017 No unnecessary duplication: reuses `useCronData`, `sortCronEntries`, `formatDuration`, `SectionHeading`, `CronStaleBanner`, `CronList`
- [x] A-018 Type narrowing over assertions: no new `as` casts
- [x] A-019 No client polling: no `setInterval`/timer added
- [x] A-020 Comment discipline: new comments state constraints (why the fork, why the explicit scroll), never narrate or cite change IDs
- [x] A-021 Test Intent Comments: every new/changed Playwright `test()` carries Proves/Steps; touched spec file headers stay accurate
- [x] A-022 Tests included: new behavior (mobile arm branch, `CronZone`, fork) has Vitest + Playwright coverage

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (the mobile Cron section, the operator-less navigation branch, tests) without making any existing file, function, branch, or config redundant. The mobile toast path remains live for non-cron segments, and the retired `clock-zone-crons` / `clock-zone-deliveries` negative assertions in `server-watched-zone` tests still guard the earlier supersession.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Side-slot grammar: `no entries` / `{N} entries` (`1 entry`) + ` · next in {rel}` / ` · next due` / no suffix | Mirrors WATCHED's `{N} watched · tick {age} ago` slot; the intake fixed the shape but not the singular/past-due wording | S:60 R:95 A:85 D:75 |
| 2 | Confident | Hash read via TanStack `useLocation().hash` (no `#`), compared to `cron`; effect runs once on mount | Router-owned location is the app's source of truth over `window.location`; a single-run effect avoids re-scrolling on SSE re-renders | S:55 R:90 A:80 D:75 |
| 3 | Certain | Five tasks ⇒ light lane, inline execution | Plan-hinted light-lane candidate; task count ≤ 5 by honest grouping | S:80 R:95 A:95 D:90 |
| 4 | Certain | The spec edit is an apply task (T005) while memory edits are hydrate's | Specs are human-curated and outside hydrate's memory scope; they ride the same PR | S:80 R:95 A:90 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative).
