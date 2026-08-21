# Plan: Ephemeral Server Surfacing

**Change**: 260821-l1qe-ephemeral-server-surfacing
**Intake**: `intake.md`

## Requirements

### Backend API: `ephemeral` flag on the servers payload

#### R1: GET /api/servers carries a request-time `ephemeral` boolean
The server-list endpoint (`handleServersList`, `app/backend/api/servers.go`) SHALL include `ephemeral: bool` on every `serverInfo` entry, derived at request time via `tmux.IsEphemeralServer` — a Principle II derivation with no caching store and no SSE schema change. The read MUST ride the existing per-server fan-out goroutine (one extra tmux call per server, same WaitGroup + mutex pattern as `GetServerRank`), keeping the handler inside the 5s budget. A per-server read failure SHALL log at warn and yield `ephemeral: false` — never a 5xx (the handler's established no-5xx fan-out stance). A server gone mid-walk reads as not-ephemeral (`IsEphemeralServer` already returns `(false, nil)` on `IsServerGone`). The `TmuxOps` interface (`app/backend/api/router.go`) gains `IsEphemeralServer(ctx context.Context, server string) (bool, error)` with a `prodTmuxOps` passthrough.

- **GIVEN** a live server carrying `@rk_ephemeral 1` and a live server without it
- **WHEN** a client GETs `/api/servers`
- **THEN** the marked server's entry has `ephemeral: true` and the unmarked one `ephemeral: false`
- **AND** the array's alphabetical order and every existing field are unchanged

- **GIVEN** a server whose ephemeral read fails with a non-gone subprocess error
- **WHEN** the fan-out runs
- **THEN** the entry reports `ephemeral: false`, a warn is logged, and the response is still 200

### CLI: `rk doctor` ephemeral-servers row

#### R2: Doctor reports the live ephemeral-server count with a reap hint
`rk doctor` (`app/backend/cmd/rk/doctor.go`) SHALL append an always-OK-shaped check row (Name `ephemeral servers`, `OK: true` in every branch — informational, never a failure, mirroring the code-server row's posture) reporting the count of live servers carrying `@rk_ephemeral`. Nonzero count → Note `"{N} live server(s) marked @rk_ephemeral — sweep with `rk mux reap --ephemeral`"`. Zero → the quiet Note `"none"`. Enumeration MUST reuse the reaper's semantics — live-only via `ListServers` (dead sockets never queried), `_rk-ctl`/`rk-daemon` hard-skipped, per-server read failures isolated — through a new exported `tmux.EphemeralServers(ctx) ([]string, error)` wrapper over the existing unexported `enumerateEphemeralServers` (sorted names; never a re-implementation). An enumeration error SHALL degrade to the OK row with a note naming the skip (mirroring the drift sweep's never-block posture). The check is seam-injected (package-level var, like `tmuxServerList`) so tests drive every branch without live tmux.

- **GIVEN** two live servers marked `@rk_ephemeral` and one unmarked
- **WHEN** `rk doctor` runs
- **THEN** the human output carries `[ OK ] ephemeral servers — 2 live server(s) marked @rk_ephemeral — sweep with `rk mux reap --ephemeral`` and `--json` carries the same note verbatim

- **GIVEN** zero marked servers
- **WHEN** `rk doctor` runs
- **THEN** the row is `[ OK ] ephemeral servers — none` and the overall verdict is unaffected

### Frontend client: type + rank-aware sort

#### R3: `ServerInfo.ephemeral` + sort-to-bottom as a sub-rank tie-break
`ServerInfo` (`app/frontend/src/api/client.ts`) SHALL gain `ephemeral?: boolean` (optional, mirroring `windowCount`/`rank` — backend always sends it, test fixtures may omit). `compareServersRanked` SHALL sort ephemeral servers after non-ephemeral ones **within the regular class, as a tie-break below rank and above name**: effective regular-class key `(rank, ephemeral, name)`. Explicit user rank (drag placement) wins over the derived de-emphasis; among equal-rank or unranked regulars, marked servers sink to the bottom of the regular segment (stable byte-order within each group). The infra class (`isInfraServer`) stays pinned last and ignores both keys, and `compareServers` is untouched — every existing ordering test stays green.

- **GIVEN** unranked regular servers `alpha` (ephemeral), `beta`, `zeta` (ephemeral) and infra `rk-daemon`
- **WHEN** the list sorts by `compareServersRanked`
- **THEN** the order is `beta, alpha, zeta, rk-daemon`

- **GIVEN** an ephemeral server ranked 0 and an unmarked server ranked 1
- **WHEN** the list sorts
- **THEN** the ranked ephemeral server sorts first — rank wins over the ephemeral key

### Host Overview: scratch badge + de-emphasis

#### R4: Marked tiles get a `scratch` chip and grey name; never hidden
The Host TMUX SERVERS tile grid (`app/frontend/src/components/host-overview-page.tsx`) SHALL render a small `scratch` chip on ephemeral servers' tiles, styled like the recovery tree's `resumable` chip (`border border-border rounded px-1 text-text-secondary`, inline after the name), and SHALL grey the tile name via the existing `isInfraServer` de-emphasis treatment (`text-text-secondary`). The tile MUST stay fully clickable, draggable, and included in every existing action — no hiding, no filtering, no collapsed group anywhere.

- **GIVEN** a server entry with `ephemeral: true`
- **WHEN** the Host page renders its tile
- **THEN** the tile shows the `scratch` chip and a greyed name, and clicking it still switches to the server

- **GIVEN** a server entry with `ephemeral: false` or an omitted flag
- **WHEN** the tile renders
- **THEN** it is byte-identical to today's rendering (no chip, normal emphasis)

### Non-Goals

- Sidebar / status-rail visual de-emphasis — deferred by intake assumption 4 (the sidebar row carries a dense signal system; separate design conversation). The sidebar's ServerPanel *ordering* does inherit the shared comparator (see Design Decisions).
- SSE carriage of the flag — the server list is fetch-on-demand; no SSE schema change.
- New pages/routes, filtering, or excluding ephemeral servers from any action (Constitution IV; surface-don't-hide).
- E2E spec extension — no existing spec asserts server-list content semantics (see Assumptions).

### Design Decisions

#### Rank outranks ephemeral in the display sort
**Decision**: The ephemeral key sits *below* rank in `compareServersRanked`'s regular-class key — `(rank, ephemeral, name)`.
**Why**: The drag-reorder POST writes ranks to the entire regular class, so after any drag every server is ranked. An ephemeral-above-rank key would snap a deliberately dragged ephemeral tile back to the bottom (and the reorder hook's render-time reconcile would never observe its override order, wedging the optimistic state). Explicit user placement is stronger intent than a derived de-emphasis. Scratch servers are agent/test-created and unranked in practice, so they still sink.
**Rejected**: Ephemeral as a class between regular and infra (rank-ignoring) — fights drag-reorder and overrides explicit user placement.
*Introduced by*: 260821-l1qe-ephemeral-server-surfacing

#### The ordering rule lives in the shared comparator
**Decision**: Sort-to-bottom is implemented once in `compareServersRanked` — the single client-side sort choke point (`session-context.tsx` sorts `ctx.servers` with it) — so the sidebar ServerPanel inherits the same order.
**Why**: One list source, one comparator; a page-local re-sort in `HostOverviewPage` would diverge the two surfaces fed by the same list and duplicate ordering logic.
**Rejected**: Page-local sort in `HostOverviewPage` before `useServerReorder` — duplicated logic, divergent surfaces, and the reorder hook documents its input as "the already-effective-sorted list".
*Introduced by*: 260821-l1qe-ephemeral-server-surfacing

#### Doctor row always present, always OK-shaped
**Decision**: The ephemeral-servers check appends unconditionally with `OK: true` in every branch; the count/hint, `none`, or an enumeration-skip message ride the Note.
**Why**: A stable check set keeps `--json` consumers schema-stable (the existing checks append unconditionally); scratch servers are a hygiene fact, not a dependency failure, so the row must never flip the overall verdict — the code-server and drift precedents.
**Rejected**: Omitting the row at zero — unstable check set for JSON consumers; FAIL-shaping nonzero counts — ephemeral marks are deliberate creator opt-in, not a fault.
*Introduced by*: 260821-l1qe-ephemeral-server-surfacing

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `IsEphemeralServer(ctx, server) (bool, error)` to the `TmuxOps` interface and the `prodTmuxOps` passthrough in `app/backend/api/router.go`; update every test fixture implementing `TmuxOps` to satisfy the new method <!-- R1 -->
- [x] T002 Add `Ephemeral bool \`json:"ephemeral"\`` to `serverInfo` and the fan-out read (warn + false on error) in `app/backend/api/servers.go` <!-- R1 -->
- [x] T003 Handler tests in `app/backend/api/servers_test.go`: marked → true, unmarked → false, read-error → false + 200 (no 5xx) <!-- R1 -->
- [x] T004 [P] Export `EphemeralServers(ctx) ([]string, error)` in `app/backend/internal/tmux/reaper.go` wrapping `enumerateEphemeralServers(ctx, true)` (sorted names), with a unit test in `reaper_test.go` <!-- R2 -->
- [x] T005 Add the seam-injected `ephemeralServersCheck` to `app/backend/cmd/rk/doctor.go`, wire it into `runDoctorChecks`, and cover nonzero/zero/enumeration-error branches in `doctor_test.go` <!-- R2 -->
- [x] T006 [P] Add `ephemeral?: boolean` to `ServerInfo` and the sub-rank ephemeral tie-break to `compareServersRanked` in `app/frontend/src/api/client.ts`; extend the comparator suite in `client.test.ts` (ephemeral sinks among unranked; rank wins; infra + `compareServers` unchanged) <!-- R3 -->
- [x] T007 Render the `scratch` chip + grey-name de-emphasis on ephemeral tiles in `app/frontend/src/components/host-overview-page.tsx`; unit tests in `host-overview-page.test.tsx` (chip + grey on marked, unchanged unmarked, tile still clickable) <!-- R4 -->

## Execution Order

- T001 blocks T002/T003 (interface first); T006 blocks T007 (type first)
- T004 blocks T005 (doctor consumes the exported wrapper)
- The backend chain (T001–T005) and frontend chain (T006–T007) are independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every `/api/servers` entry carries `ephemeral`, true only for live servers with `@rk_ephemeral` set, derived in the existing fan-out with no cache and no SSE change
- [x] A-002 R2: `rk doctor` emits the `ephemeral servers` row — count + `rk mux reap --ephemeral` hint note when nonzero, `none` at zero, never `OK: false`
- [x] A-003 R3: `ServerInfo` types the flag and `compareServersRanked` sinks ephemeral servers within the regular class as a sub-rank tie-break
- [x] A-004 R4: Marked Host tiles render the `scratch` chip and greyed name; no server is hidden or excluded from any action

### Behavioral Correctness

- [x] A-005 R3: Rank wins over ephemeral (a ranked ephemeral server sorts by its rank); infra pinning and `compareServers` byte-order semantics are unchanged and existing ordering tests stay green
- [x] A-006 R2: Doctor enumeration reuses the reaper's live-only, hard-skip semantics via the exported `tmux.EphemeralServers` wrapper — no duplicated enumeration logic

### Scenario Coverage

- [x] A-007 R1: Handler tests cover marked/unmarked/read-error entries (`just test-backend`)
- [x] A-008 R2: Doctor tests cover nonzero, zero, and enumeration-error branches via the seam
- [x] A-009 R4: Frontend unit tests cover chip render, de-emphasis, sort order, and click-through (`just test-frontend`)

### Edge Cases & Error Handling

- [x] A-010 R1: A server gone mid-walk or with a failing option read yields `ephemeral: false` and a 200 — never a 5xx
- [x] A-011 R2: An enumeration failure degrades the doctor row to an OK note naming the skip — never blocks or fails doctor

### Code Quality

- [x] A-012 Pattern consistency: New code follows surrounding patterns (fan-out read mirrors `GetServerRank`; doctor check mirrors the seam-injected code-server/drift shape; chip mirrors the recovery `resumable` chip)
- [x] A-013 No unnecessary duplication: Doctor reuses `enumerateEphemeralServers` via the exported wrapper; no second enumeration path
- [x] A-014 Go subprocess discipline: All tmux reads ride existing `exec.CommandContext`-with-timeout helpers; the servers handler stays within the 5s budget
- [x] A-015 Tests included: New behavior in both backend and frontend is test-covered per code-quality.md

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Ephemeral sort key sits below rank (tie-break), not above | Drag-reorder writes full-class ranks; ephemeral-above-rank snap-backs dragged tiles and wedges the reorder override reconcile; explicit rank = explicit intent | S:60 R:80 A:80 D:70 |
| 2 | Confident | Ordering lives in shared `compareServersRanked`, so sidebar ServerPanel inherits the order (visuals there stay deferred) | One sort choke point per memory; intake defers only sidebar *de-emphasis*, and a page-local sort would diverge the two surfaces | S:65 R:85 A:80 D:75 |
| 3 | Confident | Doctor row always present and OK-shaped; zero → `none` note; enumeration error → skip note | Mirrors code-server (informational OK note) and drift (never-block) precedents; stable `--json` check set | S:70 R:90 A:85 D:75 |
| 4 | Confident | No e2e extension — unit tests carry the frontend coverage | Intake's e2e task is conditional ("if one covers the server list"); host-health-home.spec.ts asserts metrics only, server-reorder.spec.ts asserts drag only — no spec asserts server-list content semantics | S:60 R:90 A:75 D:70 |
| 5 | Certain | De-emphasis = grey name via the existing `isInfraServer` treatment | The tile already has exactly one de-emphasis vocabulary (grey name, tile stays clickable); intake pairs "badge + de-emphasis" | S:75 R:90 A:85 D:80 |
| 6 | Confident | Doctor enumeration via a new exported `tmux.EphemeralServers` wrapper | `enumerateEphemeralServers` is unexported; doctor is package main; wrapping beats re-implementing (code-quality anti-duplication) | S:70 R:85 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
