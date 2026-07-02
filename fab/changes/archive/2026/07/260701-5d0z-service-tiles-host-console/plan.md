# Plan: Service Tiles on the Cockpit Host Console

**Change**: 260701-5d0z-service-tiles-host-console
**Intake**: `intake.md`

## Requirements

### Backend: Listening-port collector (`internal/ports`)

- **R1** — The backend SHALL provide an in-memory `ports.Collector` modeled on `internal/metrics.Collector`: `NewCollector(pollInterval)` → `Start(ctx)` (ticker goroutine) → `Snapshot()` guarded by `sync.RWMutex`, with a `//go:build linux` / `//go:build !linux` platform split and graceful zero-value returns on error/non-Linux. No database, no persistent store (Constitution II).
  - GIVEN a constructed collector, WHEN `Snapshot()` is called before any tick, THEN it returns a valid `ServicesSnapshot` whose `Services` field is a non-nil (possibly empty) slice.
  - GIVEN a collector with a running `Start(ctx)`, WHEN `ctx` is cancelled, THEN the poll goroutine exits and subsequent `Snapshot()` calls still return the last known snapshot without panic.

- **R2** — On Linux, the collector SHALL enumerate listening TCP sockets by parsing `/proc/net/tcp` and `/proc/net/tcp6`, selecting sockets in state `0A` (LISTEN), extracting the local port from the hex `local_address` field, deduplicating ports that appear across v4 and v6, and sorting the result by port ascending. It SHALL NOT shell out (procfs path needs no subprocess — Constitution I surface avoided).
  - GIVEN a `/proc/net/tcp` fixture with a LISTEN socket on port `0x1F90` (8080) and an ESTABLISHED socket on another port, WHEN parsed, THEN only port 8080 is reported.
  - GIVEN the same port present as a LISTEN socket in both `/proc/net/tcp` and `/proc/net/tcp6`, WHEN parsed, THEN it appears exactly once in the snapshot.
  - GIVEN LISTEN sockets on ports 8080, 5173, and 3000, WHEN parsed, THEN the snapshot lists them sorted ascending: 3000, 5173, 8080.

- **R3** — On non-Linux platforms the collector SHALL return an empty `ServicesSnapshot{Services: []Service{}}` (graceful zero), exactly like `metrics/collector_darwin.go`. No crash, no error surfaced.
  - GIVEN a non-Linux build, WHEN `Snapshot()` is called, THEN `Services` is an empty non-nil slice.

- **R4** — v1 SHALL ship port-only tiles: the `Service` struct carries `Port` (required) plus `Process`/`PID` fields that are `omitempty` and left zero-valued in v1 (best-effort process attribution deferred). v1 SHALL NOT classify protocol, health-check, or sniff services (Constitution IV — keep it dumb first).
  - GIVEN any LISTEN socket, WHEN reported, THEN `Process == ""` and `PID == 0` in v1.

### Backend: `event: services` SSE broadcast (`api/sse.go`)

- **R5** — The SSE hub SHALL broadcast a server-independent `event: services` to all connected clients on each poll tick, mirroring the existing `event: metrics` block: hold the collector as `h.services`, snapshot + marshal + fan out to every client. It SHALL cache the latest payload as `h.cachedServicesJSON` and send it to a client the moment it connects (mirroring `h.cachedMetricsJSON` initial send). The collector SHALL be threaded through `newSSEHub`. NO new HTTP endpoint or route (Constitution IV, IX) — the event rides the existing server-neutral `?metrics=1` stream.
  - GIVEN a connected SSE client and a non-nil `h.services`, WHEN a poll tick fires, THEN the client receives an `event: services` frame with the marshalled snapshot.
  - GIVEN a fresh client connecting after at least one tick has cached a payload, WHEN it connects, THEN it immediately receives the cached `event: services` frame without waiting for the next tick.
  - GIVEN a `?metrics=1` server-neutral client (Cockpit `/` with zero attached servers), WHEN a tick fires, THEN it receives `event: services` (the same fan-out reaches it, as it does for `event: metrics`).

- **R6** — The ports collector SHALL be constructed and `Start`ed at server bootstrap alongside the metrics collector (`api/router.go` `NewRouterAndServer`), stored on `Server`, and passed into `newSSEHub`.
  - GIVEN `NewRouterAndServer(ctx, logger)`, WHEN it runs, THEN a `ports.Collector` is created, `Start(ctx)`-ed, and wired into the hub such that `h.services != nil`.

### Frontend: `useHostServices()` subscription (`contexts/session-context.tsx`)

- **R7** — The provider SHALL expose a server-independent `useHostServices()` hook backed by its own `HostServicesContext`, mirroring `useHostMetrics()` (not `currentServer`-gated; available on every route including `/`). A `services` listener SHALL be added on BOTH host-metrics delivery paths — the dedicated `?metrics=1` stream AND the per-server-stream fan-out — so `/` stays live whether or not a server is attached. Payloads SHALL be deduped on the raw event string (mirroring `applyHostMetrics`).
  - GIVEN the `/` route with no server attached, WHEN the dedicated `?metrics=1` stream emits `event: services`, THEN `useHostServices()` returns the parsed `services` array.
  - GIVEN a route with a server attached (dedicated stream closed), WHEN that per-server stream emits `event: services`, THEN `useHostServices()` returns the parsed array (fan-out path).
  - GIVEN two attached servers emitting the identical services payload in one tick, WHEN both arrive, THEN the host-services consumer re-renders at most once for that payload.
  - GIVEN a malformed `services` event, WHEN received, THEN it is skipped without throwing.

- **R8** — `types.ts` SHALL define `Service` and `ServicesSnapshot` types matching the backend JSON shape (`{ port: number; process?: string; pid?: number }` and `{ services: Service[] }`). `useHostServices()` SHALL return `Service[]` (empty array before the first tick, never `null`/`undefined` to the consumer).
  - GIVEN no services event yet, WHEN `useHostServices()` is read, THEN it returns `[]`.

### Frontend: Services zone on `/` (`components/server-list-page.tsx`)

- **R9** — `ServerListPage` SHALL render a `<section aria-label="Services">` inside the existing scroll container, reusing zone 1's `mb-6 max-w-md` idiom, placed directly after the Host Health section (host health → services → servers). Each service tile SHALL show the port as primary text (e.g. `:5173`, mono) and the process name as dimmed secondary text when present. When `useHostServices()` returns an empty array, it SHALL render a graceful "No services" fallback mirroring the zone-1 "No metrics" affordance — never a crash or blank grid.
  - GIVEN a services array `[{port:5173},{port:8080}]`, WHEN the page renders, THEN a tile per port is shown with `:5173` and `:8080`.
  - GIVEN an empty services array, WHEN the page renders, THEN a "No services" message is shown and the app does not crash.
  - GIVEN a service with a `process` value, WHEN its tile renders, THEN the process name appears as dimmed secondary text.

### Frontend: "Open in window" action (`components/server-list-page.tsx`)

- **R10** — Each service tile SHALL provide an "Open in window" action that creates a real `@rk_type=iframe` tmux window via `createWindow(server, session, ":{port}", undefined, "iframe", "/proxy/{port}/")` and then navigates to that server (`/$server`), so the new iframe window surfaces via SSE. The action uses the existing `POST /api/sessions/{session}/windows` mutation (Constitution IX — no new verb).
  - GIVEN at least one server exists, WHEN "Open in window" is clicked for port 5173, THEN `createWindow` is called with `rkType="iframe"` and `rkUrl="/proxy/5173/"` against a resolved `(server, session)`, and the app navigates to that server.

- **R11** — Target `(server, session)` resolution: WHEN ≥1 server exists, the action SHALL target the first-listed server and reuse the existing instant-session machinery (`createSession` when the server has no session yet, or the first existing session) before creating the iframe window. WHEN zero servers exist, the "Open in window" action SHALL be disabled with a hint (e.g. "create a server first") — no server is auto-spawned from a proxy-tile click.
  - GIVEN zero servers, WHEN the services zone renders a tile, THEN its "Open in window" control is disabled and a "create a server first" hint is present.
  - GIVEN a server that already has a session, WHEN "Open in window" is clicked, THEN no new session is created and the iframe window is created in the existing session.
  - GIVEN a server with no sessions, WHEN "Open in window" is clicked, THEN an instant session is created first, then the iframe window in it.

### Non-Goals

- No process/PID attribution in v1 (deferred — R4).
- No protocol classification, health-checking, favicons, or "is this HTTP" heuristics (R4).
- No new HTTP endpoint or route; no auto-create-server on a proxy-tile click when zero servers exist (R11).
- Zones 1 (Host Health) and 2 (server tiles) are not modified beyond inserting zone 3 between them.

### Design Decisions

- **Reuse the existing SSE stream, not a new endpoint** — `event: services` rides the server-neutral `?metrics=1` broadcast exactly as `event: metrics` does. Rejected a `GET /api/services` poll endpoint (redundant surface; violates the SSE-first pattern and Constitution IV).
- **procfs over `ss`** — matches the metrics collector's no-dependency procfs discipline and avoids a subprocess (no Constitution-I `exec.CommandContext` surface). `ss -ltnp` remains a bounded future fallback if attribution is added.
- **Real iframe tmux window (approach A)** — the backlog's literal ask, user-confirmed at intake. Rejected a plain browser tab (loses the in-app window) and a server-less overlay (new UI surface).
- **Own context for host services** — a separate `HostServicesContext` (parallel to `HostMetricsContext`) so the ~2.5s services stream does not cascade re-renders through unrelated consumers.

## Tasks

### Phase 1: Backend collector

- [x] T001 Add `Service` and `ServicesSnapshot` types plus the `Collector` shape (`NewCollector`, `Start`, `Snapshot`, ticker `poll`/`collect` under `sync.RWMutex`) in `app/backend/internal/ports/collector.go`, modeled on `internal/metrics/collector.go`. `Snapshot()` returns a deep copy; `Services` is never nil. <!-- R1 R4 -->
- [x] T002 Add `app/backend/internal/ports/collector_linux.go` (`//go:build linux`): parse `/proc/net/tcp` + `/proc/net/tcp6`, select state `0A`, extract the hex local port, dedupe across files, sort ascending. Factored so the fixture-parse logic is unit-testable (e.g. a `parseListeningPorts(reader)` helper reused by both file reads). <!-- R2 -->
- [x] T003 Add `app/backend/internal/ports/collector_other.go` (`//go:build !linux`): return `ServicesSnapshot{Services: []Service{}}`. <!-- R3 -->
- [x] T004 [P] Add `app/backend/internal/ports/collector_linux_test.go` (`//go:build linux`): fixture parse asserting LISTEN extraction, non-LISTEN ignored, v4/v6 dedupe, ascending sort. Mirror `metrics/collector_linux_test.go`. <!-- R2 -->
- [x] T005 [P] Add `app/backend/internal/ports/collector_test.go` (cross-platform): `NewCollector` returns non-nil empty `Services`; Start/Stop lifecycle and Snapshot thread-safety do not panic. <!-- R1 -->

### Phase 2: Backend SSE wiring

- [x] T006 In `app/backend/api/sse.go`: add `services *ports.Collector` and `cachedServicesJSON string` fields to `sseHub`; add the `services` param to `newSSEHub` and set it; add the initial cached-send in `addClient` (mirror the `cachedMetricsJSON` block); add the `event: services` broadcast block in the poll tick loop (mirror the `event: metrics` block at ~sse.go:677). <!-- R5 -->
- [x] T007 In `app/backend/api/router.go`: add `services *ports.Collector` to `Server`; construct + `Start(ctx)` a `ports.NewCollector(...)` in `NewRouterAndServer` alongside `metrics`; pass it into `newSSEHub` in `initSSEHub`. Add a `servicesPollInterval` const in `sse.go`. <!-- R6 -->

### Phase 3: Frontend hook + types

- [x] T008 In `app/frontend/src/types.ts`: add `Service` (`{ port: number; process?: string; pid?: number }`) and `ServicesSnapshot` (`{ services: Service[] }`). <!-- R8 -->
- [x] T009 In `app/frontend/src/contexts/session-context.tsx`: add `HostServicesContext`, `hostServices` state + `applyHostServices` dedup ref, a `services` listener on BOTH the per-server-stream fan-out (~line 340) and the dedicated `?metrics=1` stream (~line 478), the `HostServicesContext.Provider`, and the `useHostServices(): Service[]` hook. Add `hostServices` fallback to `StandaloneSessionContextProvider` is not needed (separate context); ensure `useHostServices` throws outside provider like `useHostMetrics`. <!-- R7 R8 -->
- [x] T010 [P] Extend `app/frontend/src/contexts/session-context.test.tsx`: assert `useHostServices()` populates from the dedicated stream on `/`, from the per-server fan-out when attached, dedupes identical payloads, and returns `[]` before the first tick. <!-- R7 R8 -->

### Phase 4: Frontend services zone + action

- [x] T011 In `app/frontend/src/components/server-list-page.tsx`: consume `useHostServices()`; render the `<section aria-label="Services">` (after Host Health) with a tile per service (port primary mono, process secondary dim), and the "No services" empty state. <!-- R9 -->
- [x] T012 In `app/frontend/src/components/server-list-page.tsx`: add the "Open in window" handler — resolve target `(server, session)` from the page's `servers` list (first server; reuse existing session or `createSession` instant), call `createWindow(server, session, ":{port}", undefined, "iframe", "/proxy/{port}/")`, then `navigate({ to: "/$server", params })`. Disable the action with a "create a server first" hint when `servers.length === 0`. <!-- R10 R11 -->
- [x] T013 [P] Add `app/frontend/src/components/server-list-page.test.tsx`: renders tiles from a mocked `useHostServices()`; empty state on `[]`; "Open in window" disabled with hint when zero servers; clicking with a server calls `createWindow` with the iframe args and navigates. <!-- R9 R10 R11 -->

## Execution Order

Phase 1 → Phase 2 (T006/T007 depend on the collector existing) → Phase 3 → Phase 4 (T011/T012 depend on the hook + types). Within a phase, `[P]` tasks are independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ports.Collector` exists with `NewCollector`/`Start`/`Snapshot` under `sync.RWMutex`, platform-split, in-memory (no DB).
- [x] A-002 R2: On Linux the collector parses `/proc/net/tcp{,6}`, selects LISTEN (`0A`), extracts + dedupes + sorts ports, with no subprocess.
- [x] A-003 R3: On non-Linux the collector returns an empty non-nil `Services` slice.
- [x] A-004 R4: v1 tiles are port-only (`Process==""`, `PID==0`); no classification/health-check.
- [x] A-005 R5: The hub broadcasts `event: services` each tick and sends `cachedServicesJSON` on client connect; no new route.
- [x] A-006 R6: The collector is constructed, started, and wired into the hub at bootstrap.
- [x] A-007 R7: `useHostServices()` is fed by both the dedicated `?metrics=1` stream and the per-server fan-out, deduped.
- [x] A-008 R8: `Service`/`ServicesSnapshot` types exist; the hook returns `[]` before the first tick.
- [x] A-009 R9: The Services `<section>` renders tiles (port primary, process secondary) with a "No services" empty state.
- [x] A-010 R10: "Open in window" creates an `@rk_type=iframe` window pointing at `/proxy/{port}/` and navigates to the server.
- [x] A-011 R11: Target resolution uses the first server + instant/existing session; the action is disabled with a hint when zero servers exist.

### Scenario Coverage

- [x] A-012 R2: Fixture test proves LISTEN extraction, non-LISTEN ignored, v4/v6 dedupe, ascending sort.
- [x] A-013 R7: Unit tests prove host-services delivery on `/` (dedicated stream) and when a server is attached (fan-out), with dedupe.
- [x] A-014 R11: Unit test proves the zero-servers disabled/hint state and the server-present create+navigate path.

### Edge Cases & Error Handling

- [x] A-015 R7: A malformed `services` SSE event is skipped without throwing.
- [x] A-016 R9: An empty services array renders the "No services" fallback rather than crashing.

### Code Quality

- [x] A-017 Pattern consistency: the collector, SSE block, hook, and zone follow the established `metrics`/`useHostMetrics`/`HostMetrics` idioms.
- [x] A-018 No unnecessary duplication: reuses `createWindow`, the `/proxy/{port}/` handler, the iframe window type, and instant-session machinery rather than reimplementing.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Collector modeled exactly on `internal/metrics.Collector` (NewCollector→Start(ctx)→Snapshot under RWMutex; `//go:build` split; graceful zero) | Intake Assumption #3 (Certain) + verified `metrics/collector.go` is the canonical idiom; Constitution II mandates in-memory | S:90 R:75 A:95 D:90 |
| 2 | Confident | Non-Linux file named `collector_other.go` with `//go:build !linux` (not `collector_darwin.go`) | Intake says "darwin / non-Linux" and cites `metrics/collector_darwin.go`, but metrics' darwin file has real macOS impls; the ports non-Linux path is a pure zero-stub, so a single `!linux` file covers darwin AND all other non-Linux without a per-OS file. Easily renamed | S:70 R:80 A:75 D:70 |
| 3 | Confident | `Service` carries `Process`/`PID` fields (omitempty, zero in v1) rather than a port-only struct | Intake §1 shows the struct WITH these fields and Assumption #8 (Confident) defers attribution but keeps the fields; adding the fields now avoids a JSON-shape change when attribution lands | S:75 R:70 A:70 D:70 |
| 4 | Confident | Zone 3 placed directly AFTER Host Health (health → services → servers), per the intake's "cleanest fit" recommendation | Intake §4 + Assumption #6: two placements read fine; the intake explicitly recommends after-zone-1 as the sibling-section fit. Placement is trivially reversible | S:70 R:85 A:75 D:70 |
| 5 | Confident | "Open in window" resolves the target from `ServerListPage`'s own `servers` list (first entry) + `createSession` for the instant session, rather than importing app.tsx's `executeCreateSessionInstant` | Intake Assumption #10 (Confident): reuse instant-session machinery. `ServerListPage` already holds its own `servers` state and `createSession`/`createWindow` are exported client fns; app.tsx's handler is bound to its own `server` param and not reusable from `/`. Same client primitives, same effect | S:65 R:70 A:70 D:65 |
| 6 | Confident | The iframe window's tmux window name is `:{port}` (e.g. `:5173`) per intake §5's literal `createWindow(server, session, ":{port}", ...)` | Intake §5 and Assumption #9 spell the name argument as `":{port}"` verbatim | S:80 R:85 A:80 D:80 |
| 7 | Certain | No Playwright e2e added; coverage is the Go fixture test + Vitest hook/zone tests | Intake explicitly flags e2e feasibility depends on seeding a known listening port on the isolated test host and says "if infeasible, prefer unit coverage". The test host's listening ports are non-deterministic and not seedable without new harness surface; the Constitution Test-Companion-Doc rule only binds IF a `.spec.ts` is added, so omitting e2e keeps the change compliant | S:80 R:75 A:85 D:80 |

7 assumptions (2 certain, 5 confident, 0 tentative).

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. It introduces a parallel `internal/ports` collector, an `event: services` SSE broadcast, a `useHostServices()` hook, and a zone-3 services section, all of which reuse existing primitives (`createWindow`, the `/proxy/{port}/` handler, the `@rk_type=iframe` window type, and the instant-session machinery) rather than replacing them. No prior code path is superseded.
