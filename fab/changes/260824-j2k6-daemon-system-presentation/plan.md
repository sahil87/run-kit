# Plan: Daemon SYSTEM Presentation

**Change**: 260824-j2k6-daemon-system-presentation
**Intake**: `intake.md`

## Requirements

### Backend: version SSE payload carries daemon start + port

#### R1: `event: version` gains `started` and `port`
The cached server-global `event: version` SSE payload SHALL gain two additive fields: `started` (daemon process start time, epoch seconds) and `port` (the resolved port the daemon bound, `cfg.Port`). `sseHub.setVersion` (`app/backend/api/sse.go:937`) and `Server.SetVersion` (`app/backend/api/tmuxctl_bridge.go:244`) extend their signatures; the single call site `apiServer.SetVersion(version, newBootID(), selfBrew)` (`app/backend/cmd/rk/serve.go:180`) passes the boot-captured start time and `cfg.Port`. The fields are ADDITIVE — older clients parsing only `version`/`boot`/`brew` are unaffected, and the no-broadcast/connect-replay delivery is unchanged.

- **GIVEN** a running daemon that called `SetVersion` at boot
- **WHEN** a client connects to `/ws/state` and receives the replayed `event: version`
- **THEN** the payload contains `started` (epoch seconds ≤ now) and `port` (the bound port) beside `version`/`boot`/`brew`

### Frontend: client-side daemon start/port

#### R2: session-context parses `started`/`port` with graceful degradation
The `case "version"` handler in `contexts/session-context.tsx` (~line 890) SHALL parse the new fields and expose `daemonStarted: number | null` and `daemonPort: number | null` on the session context (beside `daemonVersion`). A payload from an older daemon without the fields MUST yield `null` for both — never `NaN`, `0`, or a thrown error (the `boot`-field mixed-version precedent).

- **GIVEN** a version event payload without `started`/`port` (older daemon)
- **WHEN** the client parses it
- **THEN** `daemonStarted` and `daemonPort` are `null` and no error is thrown

### Frontend: run-kit system card in the HOST HEALTH zone

#### R3: system card — daemon line with Restart
A new *run-kit system card* component SHALL render inside the existing HOST HEALTH zone of `host-overview-page.tsx` (extend the zone at lines 314–342 — no new zone, no new route). Its daemon line shows version (`daemonVersion`), uptime (`formatUptime(now − daemonStarted)`, reusing the exported helper at `components/host-metrics.tsx:9`), and port (`daemonPort`), with a **Restart** action wired to the context's existing `restartNow()` (`POST /api/restart` — the same seam the kill dialog's Restart primary and the `run-kit: Restart Daemon` palette entry use; no new endpoint, no second restart implementation). Uptime/port render only when their fields are non-null (older-daemon degradation). The card SHALL render independently of the `hostMetrics` stream (the daemon serving the page is up by definition) and MUST NOT add any new palette entry (Restart parity is already satisfied by the existing `run-kit-restart` entry, `lib/palette-update.ts:185`).

- **GIVEN** the host overview page `/` on a current daemon
- **WHEN** the HOST HEALTH zone renders
- **THEN** the system card shows version, uptime, and port with a Restart control
- **AND** clicking Restart invokes `restartNow()` (the reload guard handles the reconnect)

#### R4: system card — service rows with live status and View deep-links
The card SHALL render three service rows — **jobs**, **code-server**, **remotes** — with live status derived from `sessionsByServer.get(DAEMON_SERVER)` exactly as `protectedBlastRadius` derives blast-radius copy (`components/server-dialogs.tsx:16–29`): `rk-jobs` window count = running jobs, `rk-code-server` session presence = code-server up, `rk-remotes` window count = active tunnels. The host page SHALL call `attachServer(DAEMON_SERVER)` (the existing lazy-attach seam, `contexts/session-context.tsx:166`) so the rows are live. Each row whose sibling session exists gets a **View** action navigating to the ordinary `/$server/$window` terminal route for that session's active (or first) window on the rk-daemon server — the same navigation the sidebar rows use. An absent sibling session renders the row with a not-running status and no View link. The rows carry no other verbs (no kill/create — service verbs, not tmux-server verbs).

- **GIVEN** the daemon has an `rk-jobs` session with 1 window and no `rk-code-server` session
- **WHEN** the system card renders
- **THEN** the jobs row shows a running status (1 job) with a View link to that window's terminal route, and the code-server row shows not-running with no link

### Frontend: shield glyph on server lists

#### R5: shared shield glyph rendered from the protected flag
A shared shield glyph (one inline-SVG definition, placed in the shared control-glyph register `components/top-bar-icons.tsx`) SHALL render on both server-list surfaces for servers where `name === DAEMON_SERVER || server.protected` (the predicate Change 1's sidebar toggle already computes as `serverProtected`, `sidebar/index.tsx:2363`):

1. the host TMUX SERVERS tile (`host-overview-page.tsx:408–439` — the tile map destructures `{ name, sessionCount, ephemeral }` and MUST pick up `protected`; glyph beside the name, the scratch-chip slot precedent), and
2. the sidebar server group header (beside the truncating `{server}` name span, `sidebar/index.tsx:2761`).

`rk-daemon`'s dim-and-pin-last treatment (`isInfraServer` sort + grey name) is UNCHANGED — the glyph is additive. Non-protected servers render no glyph (zero drift).

- **GIVEN** a server marked `@rk_protected` and the rk-daemon server
- **WHEN** the host tile grid and the sidebar render
- **THEN** both show the shield glyph on those servers' tile/row, and unmarked servers show none

### Tests

#### R6: unit + e2e coverage with `.spec.md` companion
Go: the sse_test.go version-slot tests SHALL assert `started`/`port` in the payload. Frontend units: system-card render (daemon line formatting, null-field omission, service-row derivation for present/absent sessions, Restart wiring, View link targets) and shield-glyph presence/absence on both surfaces. e2e: one spec proving the HOST HEALTH system card renders on `/` with service rows and that a View deep-link lands on the terminal route, plus the rk-daemon shield glyph on the tile grid — with the mandatory sibling `.spec.md` companion (constitution Test Companion Docs).

- **GIVEN** the e2e rig
- **WHEN** the spec runs against `/`
- **THEN** the system card, service rows, View navigation, and shield glyph assertions pass

### Non-Goals

- Shell-level protection — the tmux guard shim's jurisdiction (plan Non-Goal)
- Hiding infra from new users — verb-shaping, not concealment
- Protecting test/ephemeral classes — taxonomy stays three states
- New pages, routes, endpoints, settings surfaces, or palette entries (Constitution IV / V parity holds via existing entries)
- Change 1 guard mechanics — already shipped in this branch

### Design Decisions

#### Uptime/port ride the version SSE slot, not a new endpoint
**Decision**: Extend the cached `event: version` payload with `started`/`port` rather than adding an endpoint or extending `/api/health`.
**Why**: The client already consumes this slot for `version`; connect-replay delivers it exactly when needed with zero polling; the plan's no-new-routes Non-Goal holds; additive-field degradation is the established `boot` precedent.
**Rejected**: New `GET /api/daemon` endpoint (new route for data a live slot already transports); deriving port from `window.location` (wrong behind the Tailscale HTTPS proxy); deriving uptime from `boot` (it is random hex, not a timestamp).
*Introduced by*: 260824-j2k6-daemon-system-presentation

#### System card extends HOST HEALTH — no distinct SYSTEM zone
**Decision**: Mount the card inside the existing HOST HEALTH zone.
**Why**: The plan's explicit recommendation — zone scaffolding and `SectionHeading` idiom already exist; a new zone adds hierarchy for one card.
**Rejected**: A distinct SYSTEM zone (more zone chrome, no added clarity; cheap to revisit later if the card grows).
*Introduced by*: 260824-j2k6-daemon-system-presentation

## Tasks

### Phase 1: Setup

- [x] T001 Extend `sseHub.setVersion` (`app/backend/api/sse.go`) with `started int64` + `port int` payload fields; thread through `Server.SetVersion` (`app/backend/api/tmuxctl_bridge.go:244`); pass boot-captured `time.Now().Unix()` and `cfg.Port` at the call site (`app/backend/cmd/rk/serve.go:180`); extend the version-slot tests (`app/backend/api/sse_test.go:683+`) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Parse `started`/`port` in the `case "version"` handler and expose `daemonStarted`/`daemonPort` (null-safe) on the session context (`app/frontend/src/contexts/session-context.tsx` ~890, context type ~206) + unit test old/new payload shapes (`session-context.test.tsx`) <!-- R2 -->
- [x] T003 [P] Add `ShieldGlyph` inline SVG to the shared control-glyph register (`app/frontend/src/components/top-bar-icons.tsx`) <!-- R5 -->
- [x] T004 New `SystemCard` component (`app/frontend/src/components/system-card.tsx` + `system-card.test.tsx`): daemon line (version / `formatUptime(now − started)` / port, null-field omission), Restart via `restartNow()`, service rows (jobs/code-server/remotes) derived from `sessionsByServer.get(DAEMON_SERVER)` with View links to `/$server/$window` (active-or-first window) and not-running fallback <!-- R3 -->
- [x] T005 Mount `SystemCard` in the HOST HEALTH zone (`app/frontend/src/components/host-overview-page.tsx:314–342`), call `attachServer(DAEMON_SERVER)`, render independent of `hostMetrics`; extend `host-overview-page.test.tsx` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Shield glyph on host TMUX SERVERS tiles: destructure `protected` in the `orderedServers` map (`host-overview-page.tsx:408`), render `ShieldGlyph` for `isProtected = name === DAEMON_SERVER || protected` beside the name (scratch-chip slot precedent); unit test tile glyph presence/absence <!-- R5 -->
- [x] T007 [P] Shield glyph on sidebar server group headers beside the `{server}` name span (`app/frontend/src/components/sidebar/index.tsx:2761`), reusing the existing `serverProtected` predicate (:2363); unit test in `sidebar/index.test.tsx` <!-- R5 -->
- [x] T008 e2e spec `app/frontend/tests/e2e/host-system-card.spec.ts` + sibling `host-system-card.spec.md`: card renders on `/` with service rows, View deep-link lands on the terminal route, rk-daemon tile shows the shield glyph <!-- R6 -->

### Phase 4: Polish

- [x] T009 Verification gates: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, targeted vitest suites (system-card, host-overview-page, session-context, sidebar), `just test-e2e "host-system-card.spec.ts"`, plus sibling e2e specs touching the host page and sidebar surfaces <!-- R6 -->

## Execution Order

- T001 blocks T002 (payload shape first); T002 and T004 block T005 (card consumes context fields)
- T003 blocks T006/T007 (glyph definition first)
- T008 runs after T005–T007; T009 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `event: version` payload carries `started` (epoch seconds) and `port`, seeded from the serve call site; delivery semantics (connect-replay, no broadcast) unchanged
- [x] A-002 R2: session context exposes `daemonStarted`/`daemonPort`, `null` on older payloads without error
- [x] A-003 R3: the system card renders in the HOST HEALTH zone with version/uptime/port and a working Restart wired to `restartNow()`
- [x] A-004 R4: jobs/code-server/remotes rows show live status derived from the daemon server's sessions; present rows carry View deep-links to `/$server/$window`; absent rows show not-running with no link
- [x] A-005 R5: the shield glyph renders on host tiles and sidebar headers for `rk-daemon` and `@rk_protected` servers, from one shared SVG definition

### Behavioral Correctness

- [x] A-006 R3: the card renders when `hostMetrics` is null (independent of the metrics stream)
- [x] A-007 R5: rk-daemon keeps dim-and-pin-last unchanged; non-protected servers show zero drift (no glyph, no layout shift)
- [x] A-008 R3: no new palette entries; Restart parity holds via the existing `run-kit-restart` entry

### Scenario Coverage

- [x] A-009 R4: unit tests cover present/absent sibling sessions (jobs count, code-server presence, tunnels count, not-running fallback)
- [x] A-010 R2: unit tests cover old-payload (no `started`/`port`) and new-payload parsing
- [x] A-011 R6: e2e proves card render + View deep-link + shield glyph on `/`, with the `.spec.md` companion in the same commit

### Edge Cases & Error Handling

- [x] A-012 R3: uptime/port lines are omitted (not `NaN`/garbage) when fields are null (verified — unit test); Restart failure surfaces a toast/error, not an unhandled rejection (**partial**: the palette entry and kill-dialog Restart toast on rejection, but the system card's own Restart button swallows it — see review should-fix S-1)

### Code Quality

- [x] A-013 Pattern consistency: card follows the zone/`SectionHeading` idiom, glyph joins the top-bar-icons register, derivations mirror `protectedBlastRadius`
- [x] A-014 No unnecessary duplication: reuses `formatUptime`, `restartNow`, `DAEMON_SERVER`, `attachServer`, existing navigation — no second restart path, no new endpoint
- [x] A-015 No client polling: all live data rides the SSE stream / session context (no `setInterval` + fetch)

### Security

- [x] A-016 R1: no new subprocess or input surface — payload fields are server-derived constants; no user input flows into the SSE slot

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one candidate surfaced during review is pre-existing, not created by this change: `app/frontend/src/lib/window-cycle.ts:65` active-or-first-window resolution is now shape-duplicated by `system-card.tsx:22–26` (`activeOrFirstWindow`) — a shared helper would consolidate both (should-fix, not deletion).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `started` is epoch **seconds** (int64) captured once at the SetVersion call site; client computes uptime as `Date.now()/1000 − started` | Matches `MetricsSnapshot.uptime` seconds convention and `formatUptime(secs)`; capturing at call site avoids threading a start-time global | S:55 R:85 A:85 D:75 |
| 2 | Confident | `daemonStarted`/`daemonPort` live on the main session context beside `daemonVersion` (not a new context) | The version event is already parsed there; two scalar fields don't warrant the metrics-context cascade-isolation treatment | S:55 R:85 A:80 D:75 |
| 3 | Confident | The uptime display re-renders lazily (computed at render; no ticking interval) — a static "3d 4h" that refreshes on natural re-renders is acceptable | A 1-minute ticker for a coarse `formatUptime` granularity adds churn the zone doesn't need; no-polling principle favors passive | S:50 R:90 A:75 D:70 |
| 4 | Confident | Restart fires immediately via `restartNow()` with no extra confirm dialog | The palette's `run-kit: Restart Daemon` fires immediately (documented "no confirmation dialog"); restart is the SAFE verb the guard funnels users toward — adding friction to it inverts Change 1's design | S:55 R:80 A:80 D:70 |
| 5 | Confident | View resolves the session's active window via the window list's `isActive`-equivalent (fall back to first window) using the same navigation call the sidebar uses | Route params verified; exact active-window field checked at implementation | S:50 R:85 A:75 D:70 |
| 6 | Certain | Glyph placement: beside the name on both surfaces, `aria`-labeled, no layout shift for unmarked servers | Scratch-chip precedent on tiles; truncating name span on sidebar headers | S:75 R:90 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
