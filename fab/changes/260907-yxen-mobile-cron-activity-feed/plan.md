# Plan: Mobile Cron UI — Activity Feed, Entry Detail Sheet, Notify Deep-Links

**Change**: 260907-yxen-mobile-cron-activity-feed
**Intake**: `intake.md`

## Requirements

### Backend: Cron Pin Endpoint

#### R1: `POST /api/cron/pin` route
The system SHALL expose `POST /api/cron/pin`, mirroring `POST /api/cron/mute`'s contract exactly:
body `{"id": "<4char>", "pinned": <bool>}`, unknown id → 404, success → 200 `{"ok": true}` and an
explicit SSE hub wake (`s.initSSEHub(); s.sseHub.wake(server)`).

- **GIVEN** an existing entry id and body `{id, pinned: true}`
- **WHEN** `POST /api/cron/pin` is called
- **THEN** `cron.SetPinned(dir, server, id, true)` persists the flag, the response is 200
  `{"ok": true}`, and the server SSE hub wakes for that server
- **AND GIVEN** an unknown id, **THEN** the response is 404 and no file is mutated

### Backend: Cron Delivery History Projection

#### R2: `GET /api/cron` gains a `deliveries` field
`GET /api/cron?server=<slug>` SHALL include a top-level `deliveries` array alongside the existing
`entries` array: recent delivery-log lines (`{ts, entry, name, target, reason, outcome}`,
most-recent-first, capped at a named constant), parsed via the existing `cron.ParseLog` and joined
against the loaded entries for `name` (empty/omitted when the entry has since been removed). An
absent or empty log yields `deliveries: []`, never an error.

- **GIVEN** a server with a non-empty delivery log
- **WHEN** `GET /api/cron?server=<slug>` is called
- **THEN** the response includes `deliveries` sorted newest-first, each line carrying `ts`,
  `entry`, `target`, `reason`, `outcome`, and `name` joined from the current entry when it still
  exists
- **AND GIVEN** an absent or empty log, **THEN** `deliveries` is `[]` at 200, never a 404 or error

### Backend: Cron Notify Deep-Links

#### R3: Deep-link URL on cron notify calls
The cron package's fail-silent `Notifier` seam calls that fire from a server-scoped context
(`if_absent: notify` and `respawn-failed` in the tick orchestrator's disposition switch) SHALL
carry a same-origin deep-link URL built by a new `cronPushURL(server string) string` helper. The
helper resolves the server's `role: operator` window using the package's existing role-lookup
(mirroring `docs/memory/run-kit/cron.md` § Fact Gathering & Target Resolution) and returns
`/{server}/{operatorWindowNum}?tab=activity`; when the role has no live window, it returns `""`
(no deep link) — degrading to today's URL-less notify, never blocking or erroring the tick.

- **GIVEN** a server with a live `role: operator` window numbered `@7`
- **WHEN** a cron notify fires for that server
- **THEN** the notification carries URL `/{server}/7?tab=activity`
- **AND GIVEN** no live operator window resolves, **THEN** the notification fires with an empty
  URL and the tick completes normally (no error, no retry)

### Frontend: Terminal Route Tab Param

#### R4: `tab` search param on the terminal route
`TerminalSearch` (`app/frontend/src/lib/router-url.ts`) SHALL accept an optional `tab` field typed
`"terminal" | "activity"`, validated by a guarded block in `validateTerminalSearch` following the
existing `view`/`panel` pattern (drop any other value silently, never throw). No route
re-registration is needed — `terminalRoute`'s existing `validateSearch: validateTerminalSearch`
picks the field up automatically.

- **GIVEN** a terminal route URL with `?tab=activity`
- **WHEN** the route's search is validated
- **THEN** `search.tab === "activity"`
- **AND GIVEN** `?tab=bogus`, **THEN** `search.tab` is `undefined` (dropped, not thrown)

### Frontend: Mobile Segmented Header

#### R5: `Terminal | Activity` segmented header, mobile + operator-role gated
On a mobile viewport (the existing `useIsMobile()` rule), when the resolved window's role is
`operator`, the terminal route SHALL render a two-segment header (`Terminal`, `Activity`) inserted
in `app/frontend/src/components/app.tsx` inside `<main style={{gridArea: "content"}}>`, as a new
sibling immediately above the existing `flex-1 flex flex-col` wrapper that renders
`<SurfaceLayout>`. Tapping a segment SHALL update the `tab` search param via the router's
search-param setter (no full navigation, no page reload). On any other route (non-operator window,
or desktop of any window) the header SHALL NOT render, and the existing render tree SHALL be
byte-identical to pre-change behavior.

- **GIVEN** a mobile viewport on the operator window's terminal route
- **WHEN** the route renders
- **THEN** the `Terminal | Activity` header appears above the terminal content
- **AND GIVEN** the same viewport on any non-operator window's route, **THEN** no header renders
- **AND GIVEN** a desktop viewport on the operator window's route, **THEN** no header renders

#### R6: `tab=activity` swaps content without unmounting the terminal
When `tab` resolves to `"activity"` on the gated route (R5), the content slot SHALL render the
Activity feed (R7) in place of `<SurfaceLayout>`; the underlying terminal connection SHALL NOT be
torn down — it is suspended/hidden using the same mechanism the codebase already applies to
hidden-but-mounted terminal panes, so switching back to `Terminal` resumes without a reconnect.

- **GIVEN** the operator route with `tab=activity`
- **WHEN** the user taps `Terminal`
- **THEN** the terminal reappears immediately with no reconnect flicker and no lost scrollback

### Frontend: Activity Feed

#### R7: Merged upcoming/delivered timeline with a "now" divider
The Activity feed component SHALL fetch `GET /api/cron?server=<slug>` (R2's extended shape) and
render one time-ordered timeline merging computed upcoming fires (from each non-orphaned,
non-muted entry's `nextFire`, chronological, soonest-first, adjacent to the divider) and recent
deliveries (from `deliveries`, reverse-chronological, newest-first, adjacent to the divider),
separated by a single "now" divider row. When the resolved server cannot be determined, the feed
SHALL degrade to the same absent/hint state the operator console already uses elsewhere (no crash,
no empty fetch loop).

- **GIVEN** entries with future `nextFire` values and a non-empty `deliveries` array
- **WHEN** the feed renders
- **THEN** deliveries appear on the past side of the divider (newest closest to "now") and upcoming
  fires appear on the future side (soonest closest to "now")
- **AND GIVEN** no resolvable server, **THEN** the feed shows the same hint state as the console's
  operator-less case, with no request made

#### R8: Muted and orphaned entries render dimmed, not hidden
Entries with `muted: true` or `orphaned: true` SHALL still appear in the upcoming-fires portion of
the feed with a visually dimmed treatment, matching the desktop CLOCK panel's row-treatment intent
— never omitted from the list.

- **GIVEN** a muted entry with a computed `nextFire`
- **WHEN** the feed renders
- **THEN** the entry's row appears dimmed, not absent

#### R9: Row tap opens the entry detail sheet
Tapping any feed row (upcoming or delivered) SHALL open the entry detail sheet (R11) scoped to that
row's entry id.

- **GIVEN** a feed row for entry `a3f9`
- **WHEN** the row is tapped
- **THEN** the entry detail sheet opens showing `a3f9`'s data

### Frontend: Staleness Banner

#### R10: Pinned staleness banner
The Activity feed SHALL render a pinned banner at the top of the timeline exactly when the
resolved server's session data reports `operatorStale: true` (the existing
`ProjectSession.OperatorStale` field, read via `useSessions()`/`useSessionContext()` — no new
fetch), showing a plain-language statement derived from `operatorLastTickAt` (e.g. "operator tick —
last seen {relative time} ago"). The banner SHALL be absent when `operatorStale` is `false` or
unknown.

- **GIVEN** a server whose sessions report `operatorStale: true` and `operatorLastTickAt: <ts>`
- **WHEN** the feed renders
- **THEN** the pinned banner appears at the top of the timeline with a relative-time statement
  derived from `<ts>`
- **AND GIVEN** `operatorStale: false`, **THEN** no banner renders

### Frontend: Entry Detail Sheet

#### R11: Entry detail sheet — alarm-app anatomy
The entry detail sheet (new component, no existing Sheet/BottomSheet primitive to extend) SHALL
show: the entry's `name`; a plain-words schedule description (R12); `lastFired` (0 renders as
"never") and `nextFire` (or "unknown" when `hasNextFire` is false); a first-class mute toggle
switch calling `POST /api/cron/mute {id, muted: !entry.muted}` (existing endpoint); a pin row
calling `POST /api/cron/pin {id, pinned: !entry.pinned}` (R1's new endpoint); and a delete row
calling `POST /api/cron/delete {id}` (existing endpoint) behind the codebase's existing
kill-confirm idiom. Each mutation SHALL optimistically reflect in the sheet and reconcile on the
next SSE-pushed refresh, matching the existing optimistic-mutation pattern. No flyout card
alternative exists on mobile — this sheet is the sole action surface for an entry there.

- **GIVEN** an open detail sheet for a non-muted entry
- **WHEN** the mute toggle is switched on
- **THEN** `POST /api/cron/mute {id, muted: true}` fires and the toggle reflects the new state
  immediately
- **AND GIVEN** the pin row is tapped, **THEN** `POST /api/cron/pin {id, pinned: true}` fires
- **AND GIVEN** the delete row is confirmed, **THEN** `POST /api/cron/delete {id}` fires and the
  sheet closes

#### R12: Plain-words schedule description
A new pure helper `describeSchedule(entry)` SHALL translate an entry's `schedule` (and, when
present, `wakeOn`) shape into a plain-language sentence, shared between the feed's row summary
(R7) and the detail sheet (R11): `{kind: "every", interval}` → "every {duration}";
`{kind: "backoff", min, max}` → a sentence naming the backoff range since last activity;
`{kind: "cron", expr}` → the raw expression plus a "not yet evaluated" note (matching the CLI's
existing stderr posture for unsupported cron expressions — the evaluator does not fire these).

- **GIVEN** `{kind: "every", interval: "1h"}`
- **WHEN** described
- **THEN** the sentence reads "every hour" (or equivalent plain phrasing)
- **AND GIVEN** `{kind: "cron", expr: "0 * * * *"}`, **THEN** the sentence shows the raw expression
  plus a note that it is not yet evaluated

### Frontend: Palette Actions

#### R13: `Cron: pin…` palette action
A `Cron: pin…` action SHALL be registered in the shared command-palette action registry, invoking
`POST /api/cron/pin` for a selected entry, per Constitution V (every user-facing action reachable
via the palette). The existing `Cron: new entry` / `Cron: mute…` / `Cron: delete…` actions SHALL be
verified present; any missing from a prior wave are registered here.

- **GIVEN** the command palette is open with a cron entry in context
- **WHEN** `Cron: pin…` is invoked
- **THEN** the same `POST /api/cron/pin` mutation fires as the detail sheet's pin row

### Non-Goals

- Desktop UI (the `CLOCK` sidebar section, watched-row indicator, flyout-card detail line) — C6, a
  sibling change in a parallel worktree. Nothing under `app/frontend/src/components/sidebar/` is
  touched.
- The `agents` operator-dashboard tile — deferred pending the reserved `agents` surface kind.
- Session/pane targets, orphan GC, `cron` 5-field expression evaluation — Wave 4 (C8/C9). This
  change only displays existing orphaned/`cron`-kind state (dimmed treatment, "not yet evaluated"
  note) without changing evaluator behavior.
- The reverse loop-side staleness check (spec Open Question 3) — explicitly decided against in
  Wave 2, not reopened here.
- No change to `internal/cron`'s evaluation, delivery, or respawn logic beyond the two additive
  reads (`ParseLog` projection, role-window resolution for the notify URL).

### Design Decisions

#### Reverse the "pin has no HTTP endpoint" decision
**Decision**: add `POST /api/cron/pin`, mirroring `POST /api/cron/mute` exactly.
**Why**: the prior decision's own stated rationale was "no consumer" for a pin HTTP route; this
change's mobile entry detail sheet is that consumer, per `docs/specs/cron.md`'s alarm-app anatomy
naming a pin row alongside mute/delete.
**Rejected**: leaving pin CLI-only and omitting it from the mobile detail sheet (contradicts the
spec's stated anatomy); a differently-shaped pin body (diverging from the mute precedent for no
reason).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

#### Delivery history rides the existing `GET /api/cron` endpoint
**Decision**: add a `deliveries` sibling array to the existing `GET /api/cron` response instead of
a new endpoint.
**Why**: Constitution IV (minimal surface) and the existing "one thin read endpoint over
`internal/cron`" pattern both favor extending; `cron.ParseLog` already exists server-side and only
needs a projection, not a new code path.
**Rejected**: a separate `GET /api/cron/log` endpoint (doubles the read surface for data that is
always consumed alongside `entries`).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

#### The mobile "console sheet" is the existing operator terminal route
**Decision**: the `Terminal | Activity` segmented header mounts on the existing operator-window
terminal route (gated mobile + `role === "operator"`), not on a new overlay/sheet component.
**Why**: `docs/memory/run-kit/ui/operator-console.md` documents, as a verified codebase fact, that
no mobile drawer/sheet exists today — every console-open request already navigates to the operator
window's ordinary terminal route, whose own chrome IS the mobile console.
**Rejected**: building a new mobile overlay/sheet component to host the segments (duplicates
existing route chrome, contradicts the "mobile console = navigation" design already shipped).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

#### Tab switch swaps content in place, keeping the terminal mounted
**Decision**: `tab=activity` swaps the rendered content slot but does not unmount `TerminalClient`.
**Why**: matches the existing hidden-page stream-suspension precedent and the desktop tongue's
toggle-not-teardown behavior; avoids a reconnect flicker/scrollback loss on tab-back.
**Rejected**: unmounting the terminal on tab-away (simpler but regresses an existing UX guarantee
that hidden terminals stay connected).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

#### Notify deep-link targets the Activity segment, not a specific entry
**Decision**: `cronPushURL` builds `/{server}/{operatorWindowNum}?tab=activity` with no entry id in
the URL.
**Why**: the spec states the notification "deep-links to the Activity segment," not to a specific
entry's detail sheet; this is the simpler contract with no stated requirement for auto-opening a
sheet.
**Rejected**: also carrying `&entry=<id>` to auto-open the detail sheet (speculative surface beyond
the spec's stated requirement — may be added later if requested).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `tab?: "terminal" | "activity"` to `TerminalSearch` and its guarded validation
      block in `app/frontend/src/lib/router-url.ts` <!-- R4 -->

### Phase 2: Core Implementation

- [x] T002 [P] Add `handleCronPin` in `app/backend/api/cron.go`, mirroring `handleCronMute`
      (decode `{id, pinned}`, `cron.SetPinned`, 404 on unknown id, SSE wake, `{"ok": true}`)
      <!-- R1 -->
- [x] T003 Register `r.Post("/api/cron/pin", s.handleCronPin)` in `app/backend/api/router.go`
      beside the existing cron routes <!-- R1 -->
- [x] T004 Extend `handleCronList` in `app/backend/api/cron.go` to project a `deliveries` field via
      `cron.ParseLog`, most-recent-first, capped at a new named constant, joined with entry `name`
      when the entry still exists <!-- R2 -->
- [x] T005 Add `cronPushURL(server string) string` (package placement follows `internal/cron`'s
      existing role-lookup and package-boundary rules — colocate with whichever package can call
      the role-resolution helper directly) resolving the `role: operator` window and building
      `/{server}/{N}?tab=activity`, returning `""` when unresolvable <!-- R3 -->
- [x] T006 Wire `cronPushURL` into the tick orchestrator's `if_absent: notify` and
      `respawn-failed` `Notifier` call sites in `internal/cron` <!-- R3 -->
- [x] T007 [P] Add `describeSchedule(entry)` in a new `app/frontend/src/lib/cron-schedule.ts`
      covering `every`/`backoff`/`cron` shapes <!-- R12 -->
- [x] T008 Build the entry detail sheet component in a new
      `app/frontend/src/components/cron-entry-detail-sheet.tsx` (name, `describeSchedule` output,
      last/next, mute toggle, pin row, delete row) <!-- R11 -->
- [x] T009 Build the Activity feed component in a new
      `app/frontend/src/components/cron-activity-feed.tsx` (fetch `GET /api/cron`, merge upcoming
      fires + deliveries around a now-divider, dim muted/orphaned rows, row-tap opens T008's sheet)
      <!-- R7, R8, R9 -->
- [x] T010 Add the pinned staleness banner to the Activity feed component, reading
      `OperatorStale`/`OperatorLastTickAt` via the existing `useSessions()`/`useSessionContext()`
      hooks <!-- R10 -->
- [x] T011 Build a small `Terminal | Activity` segmented-header component driving the `tab` search
      param via the router's search-param setter <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T012 Insert T011's segmented header and the `tab`-conditional content swap (T009's feed vs.
      the existing `<SurfaceLayout>`) into `app/frontend/src/components/app.tsx` inside
      `<main style={{gridArea: "content"}}>`, gated on `useIsMobile() && currentWindow?.role ===
      "operator"`, keeping the terminal mounted-but-hidden on the Activity tab <!-- R5, R6 -->
- [x] T013 Register the `Cron: pin…` palette action, verifying/adding `Cron: new entry` /
      `Cron: mute…` / `Cron: delete…` if any are missing from a prior wave <!-- R13 -->
- [x] T014 Handle the unresolvable-server case in the Activity feed (degrade to the console's
      existing absent/hint state, no request fired) <!-- R7 -->
- [x] T015 Handle `cron`-kind entries in `describeSchedule` and the feed row summary (raw
      expression + "not yet evaluated" note, no fabricated next-fire) <!-- R12 -->

### Phase 4: Polish

- [x] T016 [P] Go handler tests: `handleCronPin` (mirroring existing `handleCronMute` tests) and
      the `deliveries` field in `handleCronList` tests, in `app/backend/api/cron_test.go`
      <!-- R1, R2 -->
- [x] T017 [P] Go test for `cronPushURL` (resolves a live operator window; degrades to `""` when
      unresolvable) <!-- R3 -->
- [x] T018 [P] Frontend unit tests: `describeSchedule` cases (every/backoff/cron), Activity feed
      ordering + staleness banner gating, colocated as `.test.ts(x)` files <!-- R12, R7, R10 -->
- [x] T019 [P] Frontend unit tests: entry detail sheet mute/pin/delete wiring, colocated
      <!-- R11 -->
- [x] T020 Playwright e2e test (with the required Proves/Steps intent comment) covering: the mobile
      segmented header appears only on the operator route, tapping Activity switches content
      without a full reload, and a `?tab=activity` deep link lands directly on the Activity segment
      <!-- R5, R6 -->

## Execution Order

- T002–T003 (pin endpoint) are independent of T004 (deliveries projection) but both touch
  `app/backend/api/cron.go` — sequence them to avoid overlapping edits to the same file.
- T005 must land before T006 (the helper must exist before it is wired into the orchestrator).
- T007 (schedule helper) must land before T008 and T009 (both consume it).
- T008 must land before T009's row-tap wiring (the feed opens the sheet T008 builds), though the
  two components can be scaffolded in parallel and wired last.
- T011 is independent of T007–T010 and can run in parallel; T012 depends on T009, T010, and T011
  all existing.
- T016–T020 depend on their respective implementation tasks being complete.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/cron/pin` sets the `pinned` flag and returns 200 `{"ok": true}` on
      success, 404 on an unknown id
- [x] A-002 R2: `GET /api/cron` response includes a `deliveries` array reflecting the server's
      delivery log, most-recent-first
- [x] A-003 R3: cron notify calls carry a deep-link URL when the operator role window resolves,
      and an empty URL (never an error) otherwise
- [x] A-004 R4: the `tab` query param round-trips through `TerminalSearch` validation; any other
      value is dropped, never thrown
- [x] A-005 R5: the segmented header renders only when mobile AND the window's role is `operator`;
      tapping `Activity` updates `tab` without a full navigation
- [x] A-006 R6: switching to `Activity` swaps rendered content without unmounting the terminal
      connection
- [x] A-007 R7: the Activity feed merges upcoming fires and deliveries around a single now-divider
- [x] A-008 R8: muted and orphaned entries render dimmed, never omitted
- [x] A-009 R9: tapping a feed row opens the entry detail sheet scoped to that row's entry
- [x] A-010 R10: the staleness banner appears exactly when `operatorStale` is true and reflects
      `operatorLastTickAt`
- [x] A-011 R11: the entry detail sheet's mute/pin/delete rows call their respective endpoints and
      reflect the result
- [x] A-012 R12: `describeSchedule` produces correct plain-language output for `every`, `backoff`,
      and `cron` schedule kinds
- [x] A-013 R13: `Cron: pin…` is registered in the palette and invokes the same mutation as the
      detail sheet's pin row

### Behavioral Correctness

- [x] A-014 R5, R6: every non-operator route and every desktop route renders byte-identical to
      pre-change behavior (no regression from the new gated header)
- [x] A-015 R3: a cron notify call with no resolvable operator window still fires the notification
      (fail-silent), only without a deep-link URL

### Scenario Coverage

- [x] A-016 R5: a `/{server}/{operatorWindowNum}?tab=activity` link lands directly on the Activity
      segment with no extra tap
- [x] A-017 R1: un-pinning (`pinned: false`) after pinning succeeds identically to the initial pin

### Edge Cases & Error Handling

- [x] A-018 R2: an empty or absent delivery log yields `deliveries: []`, never an error or 404
- [x] A-019 R7: an unresolvable server degrades the feed to the console's existing absent/hint
      state, firing no request
- [x] A-020 R12: a `cron`-kind entry's description shows its raw expression plus a "not yet
      evaluated" note rather than a fabricated next-fire

### Code Quality

- [x] A-021 No duplicated utilities: the pin handler and `cronPushURL` reuse existing
      `internal/cron`/`internal/tmux` functions rather than reimplementing role-resolution or
      mutation logic
- [x] A-022 No magic numbers: the `deliveries` cap and any other new limits are named constants,
      matching the existing `DefaultTargetRatePerHour`/`MaxEntriesPerServer` convention
- [x] A-023 No client-side polling introduced: the Activity feed relies on the existing SSE/session
      refresh cadence, never a new `setInterval` + fetch loop
- [x] A-024 Pattern consistency: new frontend components follow existing structural and naming
      patterns (colocated tests, Tailwind conventions, `coarse:` touch targets)
- [x] A-025 No unnecessary duplication: the feed's degrade-to-absent gating matches (rather than
      reimplements) the operator console's existing pattern

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

<!-- Intake's Assumptions table already covers the design-level judgment calls (pin endpoint,
     deliveries placement, mobile chrome interpretation, tab param, content-swap behavior, deep-link
     shape) — those are not re-litigated here. This table covers only decisions made while
     translating the intake into concrete requirements/tasks. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `cronPushURL`'s package placement is decided at apply time by whichever package can call the existing role-lookup directly, rather than fixed here | The intake flagged this as an open implementation detail (`internal/cron` cannot import `api`; the exact boundary depends on what the role-lookup helper's current visibility allows) — codebase inspection at apply time resolves it with certainty either way | S:55 R:75 A:70 D:55 |
| 2 | Confident | The `deliveries` cap is a new named constant (exact value, e.g. 50, chosen at apply time to roughly match the feed's practical scroll depth) | No spec-stated number exists; a named constant matching the existing `DefaultTargetRatePerHour`/`MaxEntriesPerServer` style is trivially adjustable and low-risk either way | S:45 R:80 A:65 D:60 |
| 3 | Confident | T002/T003 (pin) and T004 (deliveries) are sequenced rather than parallelized despite both being additive, because they touch the same file (`api/cron.go`) | Avoids a merge/edit conflict within a single file during one apply pass; purely a task-ordering choice with no behavioral effect | S:70 R:90 A:85 D:80 |
| 4 | Certain | `cronPushURL` lives in `internal/cron` (new `push_url.go`), not `api` — the tick orchestrator's notify call site sits inside `internal/cron` with the `TmuxSeam` already injected, and `internal/cron` cannot import `api`; `api` never calls `cron.Tick` (`cmd/rk` wires it), so no new `Deps` entry was added | The seam is the established DI shape; placement is forced by the package boundary, not a preference | S:80 R:85 A:85 D:80 |
| 5 | Confident | The helper is split into an exported pure `PushURL(server, windowID)` builder plus an unexported `operatorPushURL(ctx, server, seam)` resolver | `cmd/rk`'s respawn escalation resolves windows through its own `runOutput` seam and only needs the pure builder; keeps the exported surface minimal and each side unit-testable through its existing fake | S:55 R:75 A:70 D:60 |
| 6 | Confident | T004's deliveries projection reuses the `log` slice `handleCronList` already loads via `cron.ReadLog` (ReadLog ≡ read + ParseLog) instead of a second `ParseLog` call on a fresh read | Same data, no double disk I/O; the list handler already had the parsed log in hand | S:50 R:80 A:75 D:65 |
| 7 | Confident | The `respawn-failed` escalation re-probes `list-windows` at notify time rather than reusing the respawner's earlier probe result | The operator window may have been created by the respawn itself (delivery-wall case) — exactly when the deep link is most valuable | S:45 R:70 A:60 D:55 |
| 8 | Certain | `maxCronDeliveries = 50` | The task's explicit suggestion, matching the `DefaultTargetRatePerHour`/`MaxEntriesPerServer` named-constant convention | S:70 R:85 A:80 D:75 |
| 9 | Tentative | `Cron: new entry` opens a new minimal create dialog (payload, optional name, every/backoff/cron schedule inputs, target fixed to `role: "operator"`) | The plan said "register the action" but no create UI exists anywhere in the frontend; this is the smallest honest implementation — review may want it expanded or descoped | S:35 R:55 A:45 D:40 |
| 10 | Confident | Tab switching navigates with `replace: true` rather than pushing history | Avoids a same-route history stack that would fight the console's back-navigation; deep links stay clean | S:50 R:70 A:60 D:55 |
| 11 | Confident | Palette cron entries are fetched in AppShell on server routes via `useCronData`, keyed to the existing sessions-slice cadence | Sanctioned "existing SSE cadence, no new polling" posture (A-023); cost is one small GET per sessions event on server routes | S:45 R:65 A:60 D:55 |
| 12 | Confident | Undated entries (cron-kind, unresolved) render at the far end of the upcoming block, unhidden | R8 requires muted/orphaned never omitted; extending one rule to all undated entries satisfies "no fabricated next-fire" without a second special case | S:50 R:70 A:65 D:55 |
| 13 | Confident | Palette delete goes through a kill-confirm Dialog mounted in AppShell; palette mute/pin fire immediately | The optionPicker sub-step can't nest the palette's own confirm row, and the KillDialog idiom is the codebase's destructive-action pattern | S:55 R:75 A:65 D:60 |
| 14 | Certain | The feed's unresolvable-server degrade reuses the console's hint-state mechanism; wording is "no server resolved — cron activity unavailable" | Mechanism is a direct reuse (A-025); the wording is a presentational choice | S:70 R:85 A:80 D:75 |

14 assumptions (3 certain, 10 confident, 1 tentative).
