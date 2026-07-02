# Plan: Cockpit Host-Console Home

**Change**: 260701-vshd-cockpit-host-console-home
**Intake**: `intake.md`

## Requirements

### Frontend: Server-Independent Host-Metrics Subscription

#### R1: A host-metrics EventSource independent of server attachment
`SessionProvider` SHALL open exactly ONE `EventSource` dedicated to receiving the server-independent `event: metrics` broadcast, opened unconditionally on mount and independent of `attachServer`/`currentServer`. The stream SHALL be a metrics-only stream (no per-server session state is consumed from it). The connection SHALL be de-duplicated against the existing per-server pool so no more than one extra connection is ever opened for host metrics regardless of how many servers are attached.

- **GIVEN** the app is mounted (any route, including `/` with zero attached servers)
- **WHEN** `SessionProvider` initializes
- **THEN** one host-metrics `EventSource` is open and receiving `event: metrics`
- **AND** navigating between routes never tears it down or opens a second one

#### R2: `useHostMetrics()` hook not gated on `currentServer`
The provider SHALL expose a `useHostMetrics(): MetricsSnapshot | null` hook that returns the latest host-metrics snapshot received on the dedicated stream, `null` before the first tick. It SHALL NOT be gated on `currentServer` (unlike `useMetrics()`, which returns `null` on `/`). The existing `useMetrics()` (current-server-scoped) SHALL remain unchanged for `HostPanel`'s sidebar call site.

- **GIVEN** the app is on `/` (no `currentServer`)
- **WHEN** a metrics tick arrives on the host-metrics stream
- **THEN** `useHostMetrics()` returns the parsed `MetricsSnapshot`
- **AND** `useMetrics()` continues to return `null` on `/` (unchanged behavior)

#### R3: Graceful empty state before first tick
`useHostMetrics()` SHALL return `null` until the first metrics event is parsed, and consumers SHALL render a non-crashing empty affordance for the `null` case, mirroring `HostPanel`'s `!metrics` branch.

- **GIVEN** no metrics event has arrived yet (or the host reports zeros on a non-Linux box)
- **WHEN** a consumer reads `useHostMetrics()`
- **THEN** it receives `null` (pre-tick) or a zero-valued snapshot (non-Linux), and renders a "No metrics" affordance rather than crashing

### Frontend: Shared Host-Metrics Presentational Component

#### R4: Extract the metric rows into a shared presentational component
The metric-row rendering currently inline in `host-panel.tsx` (CPU sparkline, memory gauge, disk+uptime line, load line) SHALL be extracted into a single layout-agnostic presentational component that takes a `MetricsSnapshot` and renders the rows using the existing `lib/sparkline.ts` + `lib/gauge.ts` primitives. `HostPanel` SHALL be refactored to consume this component so its rendered output is unchanged. The new `/` zone SHALL consume the same component so the two host views stay visually consistent.

- **GIVEN** a `MetricsSnapshot`
- **WHEN** the shared component renders it
- **THEN** it emits the same CPU/mem/disk/uptime/load rows `HostPanel` produces today
- **AND** `HostPanel`'s visible output is unchanged after refactor (regression guard)

### Frontend: HOST HEALTH Zone on `/`

#### R5: HOST HEALTH zone renders on `ServerListPage`
`ServerListPage` (`/`) SHALL render a HOST HEALTH zone ABOVE the existing server-tile grid, inside the existing scroll container (`div.flex-1.overflow-y-auto`). The zone SHALL show hostname (header) plus the shared metric component (CPU sparkline+current, memory used/total gauge, load 1/5/15 normalized, disk used/total, uptime). It SHALL consume `useHostMetrics()`. The existing server tiles (create/open/count) SHALL remain untouched and functional.

- **GIVEN** the browser is at `/`
- **WHEN** metrics arrive on the host-metrics stream (~2.5s tick)
- **THEN** the HOST HEALTH zone shows live hostname, CPU sparkline, memory, load, disk, and uptime
- **AND** the zone updates on each subsequent tick
- **AND** the server-tile grid below it renders and functions exactly as before

#### R6: Empty state on `/` when no metrics
The HOST HEALTH zone SHALL render a graceful "No metrics" affordance (not a blank/broken layout) when `useHostMetrics()` is `null`.

- **GIVEN** `/` is open and no metrics have arrived yet
- **WHEN** the zone renders
- **THEN** it shows a "No metrics" affordance and does not crash

### Backend: SSE Server-Neutral Stream Tolerance (verification only)

#### R7: The SSE endpoint tolerates a metrics-only / server-neutral connection
`GET /api/sessions/stream` MUST accept a connection with a missing or neutral `server` query param and stream `event: metrics` without erroring. This is a verified apply-time precondition, expected to require NO backend change.

- **GIVEN** a client opens `/api/sessions/stream` with no meaningful `server` param
- **WHEN** the SSE hub handles the connection
- **THEN** the handler accepts it (never 4xx/5xx), immediately sends any cached metrics snapshot, and continues broadcasting `event: metrics` every tick
- **AND** any incidental per-server session poll for the neutral server degrades gracefully (logged/skipped, or reaped if server-gone) without affecting the metrics broadcast

### Design Decisions

1. **Server-neutral stream reuses `/api/sessions/stream` — no new endpoint, but a bounded read-path tolerance change WAS needed**: the endpoint accepts a neutral connection (`serverFromRequest` defaults `""` → `"default"`, never errors) and `addClient`/poll broadcast `event: metrics` server-independently. BUT a client coerced to a real-server name gets session-polled and, when that server is `IsServerGone`, REAPED from `h.clients` — evicting the metrics-only client. So the apply added a `metricsOnlyServer` sentinel: `?metrics=1` routes the client to the sentinel key (`handleSSE`), and the poll loop skips session-fetch/reap for it while the metrics broadcast still reaches it. — *Why*: honors Constitution IV (no new route) and II (no persistence), IX (GET, read-only); the broadcast is already server-global. — *Rejected*: (A) attach-first-server — fails with zero servers, the exact fresh-box case host health matters most; (C) new `GET /api/metrics` + poll — adds an endpoint and a client poll where an SSE broadcast already exists (violates code-quality "no client polling").

2. **Dedicated stream opened at `?server=` neutral, not piggybacking a per-server stream**: the host-metrics ES is a distinct pool entry keyed separately from the per-server pool, so it stays open on `/` (zero attached servers) and is never closed by the attach/detach diff. — *Why*: the intake's approach (B) requires host metrics to work independent of any attachment. — *Rejected*: reusing the current-server stream's metrics — that is exactly today's gap (null on `/`).

3. **Extract shared presentational component rather than duplicate ~120 lines**: two call sites (sidebar `HostPanel` + `/` zone) now consume identical metric rows. — *Why*: DRY, keeps the two host views consistent, easily reversed. — *Rejected*: duplicating the render logic — drift risk across two host surfaces.

### Non-Goals

- Zone 3 (SERVICES) — separate follow-on item [5d0z], out of scope.
- Any host mutation (systemd/storage/service management) — read-only awareness view only (Constitution IV).
- Changing the server-tile grid (zone 2) behavior.
- A new backend route or persistence.

## Tasks

### Phase 1: Verification & Shared Component

- [x] T001 Verify the SSE server-neutral-stream precondition (R7): confirm `serverFromRequest` in `app/backend/api/router.go` defaults a missing/neutral `server` to a non-erroring value and that `app/backend/api/sse.go` `addClient`/`poll` broadcast `event: metrics` server-independently. Record the finding; add a backend tolerance change ONLY if the endpoint rejects a neutral stream. <!-- R7 -->
  <!-- rework: (review should-fix #2, sse.go ~:200-213 via :698) the always-open metrics-only sentinel is never Covers()-ed, so safetyIntervalEffective returns legacyPollInterval (2.5s) for the WHOLE servers slice whenever a metrics-only client is present (i.e. ~always), effectively disabling the 12s safety interval for co-attached real servers → ~5x more FetchSessions subprocess calls on the safety path. Fix: exclude the metricsOnlyServer sentinel from the servers slice fed to safetyIntervalEffective/waitForNext (or treat it as covered). Cost regression, not correctness; keep the reap-skip and sentinel behavior otherwise intact. -->

  <!-- FINDING: The endpoint ACCEPTS a neutral stream (serverFromRequest defaults "" → "default", never errors; addClient/poll broadcast metrics server-independently). BUT a stream coerced to a real-server name ("default") gets session-polled and, when that server is IsServerGone, REAPED from h.clients — evicting the metrics-only client so it stops receiving metrics (proven by e2e: cold first attempt got no metrics for 20s, retry got cached metrics instantly before its own reap). So a bounded backend tolerance change WAS needed: a `metricsOnlyServer` sentinel + `?metrics=1` route (handleSSE) + a poll-loop skip so the metrics-only client is never session-polled or reaped. Constitution IX-compliant (GET, read-only). -->
- [x] T002 Extract the metric-row rendering from `app/frontend/src/components/sidebar/host-panel.tsx` into a shared layout-agnostic presentational component (new `app/frontend/src/components/host-metrics.tsx` exporting `HostMetrics({ metrics }: { metrics: MetricsSnapshot })`) that renders the CPU sparkline, `MemoryLine`, disk+uptime line, and `LoadLine` using `lib/sparkline.ts` + `lib/gauge.ts`. Move `formatUptime`/`formatDisk` and the `MemoryLine`/`LoadLine` helpers into it. <!-- R4 -->
- [x] T003 Refactor `app/frontend/src/components/sidebar/host-panel.tsx` to consume `HostMetrics` for the `metrics` branch, preserving the `CollapsiblePanel` chrome, the hostname header dot, and the `!metrics` "No metrics" branch so its visible output is unchanged. <!-- R4 -->

### Phase 2: Provider Subscription + Hook

- [x] T004 Add a server-independent host-metrics subscription to `app/frontend/src/contexts/session-context.tsx`: a new `MetricsContext`-style `HostMetricsContext` (default `undefined` sentinel, same throw-outside-provider idiom as `useMetrics`), a dedicated `EventSource` opened once on mount (independent of `attachedSet`) that listens for `event: metrics` and stores the parsed `MetricsSnapshot` in provider state, and a `useHostMetrics(): MetricsSnapshot | null` export. Keep `useMetrics()` (current-server-scoped) unchanged. Ensure the dedicated ES is de-duplicated from the per-server pool and cleaned up appropriately (StrictMode-safe, mirroring the existing pool discipline). <!-- R1 R2 R3 -->
  <!-- rework: TWO items in session-context.tsx.
       (1) MUST-FIX (review, ~:555-567): delete the `HostMetricsProvider` export — it has ZERO call sites anywhere in the repo (host-metrics unit tests drive the real SessionProvider + MockEventSource, not this helper). Dead exported API surface. Delete the ~11-line export. Do NOT add a call site to justify it.
       (2) SHOULD-FIX #3 (review, ~:428-441): the always-open ?metrics=1 dedicated stream adds a permanent +1 to the plaintext HTTP/1.1 6-per-origin connection budget on EVERY route — including the known-fragile board route (see memory e2e-flakiness-board-route-dynamic-import-hang) — and is REDUNDANT whenever ≥1 server is attached, since the event:metrics broadcast already fans out to every per-server stream (session-context.tsx per-server metrics listener). It only earns its keep on bare `/` (no server attached). Fix: gate the dedicated metrics-only stream so it is open ONLY when there is no per-server stream open (no attached server) — open it when the attached set is empty, close it once any server stream exists (whose fan-out then supplies event:metrics). useHostMetrics() must still return live metrics from whichever source is active (dedicated stream when no server; the per-server fan-out otherwise). Preserve StrictMode-safety and the no-leak discipline. Re-verify the e2e host-health-home spec still passes AND that this does not regress the board route. -->


### Phase 3: HOST HEALTH Zone on `/`

- [x] T005 Add the HOST HEALTH zone to `app/frontend/src/components/server-list-page.tsx`: render a hostname header + `HostMetrics` (consuming `useHostMetrics()`) ABOVE the server-tile grid, inside the existing `div.flex-1.overflow-y-auto` scroll container, with a "No metrics" empty-state affordance when the hook returns `null`. Leave the server-tile grid and create/open/count behavior untouched. <!-- R5 R6 -->

### Phase 4: Tests

- [x] T006 [P] Unit-test the provider host-metrics path in `app/frontend/src/contexts/session-context.test.tsx`: extend `MockEventSource` coverage to assert (a) a dedicated host-metrics ES opens on mount with no `currentServer`, (b) `useHostMetrics()` returns the parsed snapshot after a `metrics` emit while `useMetrics()` stays `null` on `/`, (c) `null` before the first tick. <!-- R1 R2 R3 -->
- [x] T007 [P] Unit-test the shared `HostMetrics` component in `app/frontend/src/components/host-metrics.test.tsx`: given a fixed `MetricsSnapshot`, assert CPU %, memory string, disk string, uptime string, and load percentages render (regression guard for the extraction). <!-- R4 -->
- [x] T008 Add a Playwright e2e spec `app/frontend/tests/e2e/host-health-home.spec.ts` (+ sibling `.spec.md` per Constitution Test Companion Docs) asserting the HOST HEALTH zone renders on `/` with a hostname and updates on the metrics tick, and that the server-tile grid still renders. <!-- R5 R6 -->

## Execution Order

- T001 is independent (verification) — run first to confirm no backend work.
- T002 blocks T003 (HostPanel consumes the extracted component) and T005/T007 (both consume `HostMetrics`).
- T004 blocks T005 (`/` zone consumes `useHostMetrics()`) and T006.
- T006, T007 are `[P]` (different files); T008 depends on T004+T005.

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `SessionProvider` opens exactly one dedicated host-metrics `EventSource` on mount, independent of `attachServer`/`currentServer`, and never opens a second one across route changes.
- [ ] A-002 R2: `useHostMetrics()` is exported, returns the latest `MetricsSnapshot` (or `null` pre-tick), and is not gated on `currentServer`; `useMetrics()` remains current-server-scoped and unchanged.
- [ ] A-003 R4: A shared layout-agnostic `HostMetrics` presentational component exists and is consumed by both `HostPanel` and the `/` zone, rendering via `lib/sparkline.ts` + `lib/gauge.ts`.
- [ ] A-004 R5: `ServerListPage` renders a HOST HEALTH zone above the server-tile grid inside the existing scroll container, showing hostname + CPU/mem/load/disk/uptime from `useHostMetrics()`.
- [ ] A-005 R7: `GET /api/sessions/stream` accepts a missing/neutral `server` param and streams `event: metrics` without erroring (verified; backend tolerance change added only if the verification found rejection).

### Behavioral Correctness

- [ ] A-006 R5: On `/`, the HOST HEALTH zone updates on each ~2.5s metrics tick; the server-tile grid (create/open/session count) is unchanged and still functions.
- [ ] A-007 R4: `HostPanel`'s sidebar rendered output is unchanged after the extraction refactor.

### Scenario Coverage

- [ ] A-008 R1: A unit test proves a dedicated host-metrics ES opens with no `currentServer` set.
- [ ] A-009 R2: A unit test proves `useHostMetrics()` returns metrics on `/` while `useMetrics()` returns `null`.
- [ ] A-010 R5: A Playwright e2e spec asserts the HOST HEALTH zone renders on `/` (hostname visible) and the server grid still renders; a `.spec.md` companion documents it.

### Edge Cases & Error Handling

- [ ] A-011 R3: `useHostMetrics()` returns `null` before the first tick and consumers render a "No metrics" affordance (never crash); a non-Linux zero-valued snapshot renders without crashing.
- [ ] A-012 R6: The `/` HOST HEALTH zone renders a graceful "No metrics" affordance when the hook is `null`.
- [ ] A-013 R7: An incidental per-server poll for the neutral server degrades gracefully (logged/skipped/reaped) without disrupting the metrics broadcast.

### Code Quality

- [ ] A-014 Pattern consistency: New code follows the provider's existing context/hook idioms (undefined-sentinel throw, memoized value, StrictMode-safe ES pool) and the component conventions of surrounding files.
- [ ] A-015 No unnecessary duplication: The metric-row rendering is shared via `HostMetrics` rather than duplicated; existing `lib/sparkline.ts` + `lib/gauge.ts` are reused.
- [ ] A-016 No client polling: The `/` zone consumes the SSE broadcast via `useHostMetrics()`, never `setInterval`+fetch (code-quality anti-pattern).
- [ ] A-017 Minimal surface (Constitution IV): No new route added; `/` stays the home route; no host-mutation controls.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/contexts/session-context.tsx:561` `HostMetricsProvider` — exported test/storybook helper with zero call sites; the host-metrics unit tests drive the real `SessionProvider` + `MockEventSource` instead. Delete unless a consumer is added.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | No backend change — reuse `/api/sessions/stream` with a neutral `server` param for the metrics-only stream | Verified in code: `serverFromRequest` defaults missing/invalid `server` to `"default"` (never errors), `addClient` sends cached metrics unconditionally, poll broadcasts `event: metrics` to all clients server-independently | S:95 R:80 A:95 D:90 |
| 2 | Confident | Extract a shared `HostMetrics` presentational component (`components/host-metrics.tsx`) consumed by both `HostPanel` and the `/` zone | Intake leans extract (two call sites); DRY, easily reversed; keeps the two host surfaces visually consistent | S:75 R:80 A:85 D:75 |
| 3 | Confident | The dedicated host-metrics `EventSource` is a separate pool entry opened once on mount, independent of `attachedSet`, using the same undefined-sentinel context idiom as `useMetrics` | Follows directly from approach (B) and the provider's existing `MetricsContext`/pool patterns; the one design nuance is a separate ES rather than piggybacking a per-server stream (which would be null on `/`) | S:80 R:70 A:80 D:75 |
| 4 | Confident | HOST HEALTH zone sits above the server-tile grid inside the existing scroll container, with a "No metrics" empty state mirroring `HostPanel`'s `!metrics` branch | Intake §1/§6; low-risk default matching the current single-column-then-grid layout | S:80 R:80 A:85 D:80 |
| 5 | Confident | The host-metrics stream connects with an explicit neutral param (e.g. omitted/empty `server`), accepting that the backend will poll a nonexistent `"default"` server harmlessly | Backend degrades gracefully on a missing server (poll error logged/skipped, or server-gone reap); metrics broadcast is unaffected. Alternative (attach a real server) rejected by approach (B) — must work with zero servers | S:70 R:70 A:75 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
