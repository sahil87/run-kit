# Intake: Cockpit Host-Console Home

**Change**: 260701-vshd-cockpit-host-console-home
**Created**: 2026-07-01

## Origin

> [vshd] Cockpit host-console home — turn the server-list route (`/`, `ServerListPage`, no sidebar) into a machine console: three zones — (1) HOST HEALTH, (2) TMUX SERVERS (existing tiles), (3) SERVICES (separate follow-on item). POSITIONING: makes the README/About "remote console for your tmux" claim true in the product (the Cockpit lineage), not just prose; `/` is the only surface that is about the BOX not a session, so host-global data belongs here.

One-shot invocation from `/fab-new vshd` (backlog item). No prior `/fab-discuss` conversation preceded this change. This change delivers **zone 1 (HOST HEALTH) only** — zone 3 (SERVICES) is a separately-tracked follow-on item ([5d0z]) that depends on this shell existing; the existing server tiles are zone 2 and stay untouched.

The backlog text was verified against rk 2.6.6. The current version is 2.9.1; the design below reflects the **verified current-state** of the code (rechecked during intake), which diverges from the backlog on one load-bearing point — see the Unresolved question about how `/` obtains metrics.

## Why

1. **Problem**: `/` (`ServerListPage`) is a bare list of tmux-server tiles. run-kit positions itself as a "remote console for your tmux" / host cockpit, but the one route that is genuinely *about the machine* (not about any session) shows nothing host-global. The product doesn't back up its own positioning prose.
2. **Consequence if unfixed**: The Cockpit lineage stays aspirational. An operator opening run-kit's home has no at-a-glance view of the box's health (CPU, memory, load, disk, uptime) and must dive into a session to see the sidebar `HostPanel` — which is scoped to the *current server*, not offered at the top level.
3. **Why this approach**: The metrics data pipeline already exists end-to-end — `internal/metrics.Collector` reads procfs and the SSE hub broadcasts `event: metrics` to **all** clients regardless of `?server=` (server-independent, every ~2.5s tick). A proven renderer already exists in `components/sidebar/host-panel.tsx` (CPU sparkline, memory gauge, disk, uptime, load) built on `lib/sparkline.ts` + `lib/gauge.ts`. So the change is almost entirely frontend wiring: surface an existing payload through existing render primitives on `/`. This honors Constitution II (no DB — metrics are in-memory/derived from procfs), IV (minimal surface — read-only, no new route), and VII (convention over config — reuse the existing SSE payload and renderer).

**Read-only, by design.** This is Cockpit-the-awareness-view, NOT Cockpit-the-admin-panel. No service/systemd/storage management (that would violate Constitution IV). The scope is: *render* host health. Nothing on this zone mutates host state.

## What Changes

### 1. A HOST HEALTH zone on `ServerListPage` (`app/frontend/src/components/server-list-page.tsx`)

Add a host-health section rendered **above** the existing server-tile grid, inside the existing scroll container. It renders from the live `MetricsSnapshot` payload:

- **Hostname** (header)
- **CPU** — sparkline from the 60-entry `cpu.samples` ring buffer + current `%`
- **Memory** — used/total gauge (`memory.used` / `memory.total`, bytes)
- **Load** — 1/5/15-min averages, normalized against `load.cpus`
- **Disk** — root-fs used/total (`disk.used` / `disk.total`, bytes)
- **Uptime** — `uptime` seconds, formatted `Nd Nh` / `Nh Nm` / `Nm`

The `MetricsSnapshot` shape (verified in `app/backend/internal/metrics/metrics.go`) is:

```go
type MetricsSnapshot struct {
    Hostname   string        `json:"hostname"`
    CPU        CPUMetrics    `json:"cpu"`     // Samples []float64 (60), Current float64, Cores int
    Memory     MemoryMetrics `json:"memory"`  // Used, Total uint64 (bytes)
    Load       LoadMetrics   `json:"load"`    // Avg1, Avg5, Avg15 float64; CPUs int
    Disk       DiskMetrics   `json:"disk"`    // Used, Total uint64 (bytes)
    UptimeSecs float64       `json:"uptime"`
}
```

The empty/absent state (metrics not yet received, e.g. on a non-Linux host where the collector returns zeros, or before the first SSE tick) must render gracefully — a "No metrics" / loading affordance, mirroring `HostPanel`'s `!metrics` branch — never a crash or a blank crash-y layout.

### 2. Reuse, do not rebuild, the metrics renderer

The sidebar `HostPanel` (`app/frontend/src/components/sidebar/host-panel.tsx`) already renders exactly this data using `lib/sparkline.ts` (`sparkline()`), `lib/gauge.ts` (`gaugeBar`, `gaugeColor`, `formatMemory`), and local `formatUptime`/`formatDisk` helpers. The host-console zone SHOULD reuse those same primitives so the two host views stay visually and behaviorally consistent. Whether to extract the shared metric rows into a reusable presentational component or duplicate the ~120 lines is a design decision recorded in Assumptions (lean: extract, since we now have two call sites).

Note the layout context differs: `HostPanel` is a narrow sidebar `CollapsiblePanel`; the `/` zone is a full-width dashboard header. The presentational primitives (sparkline string, gauge bar, formatters) are layout-agnostic and reusable; the container/layout chrome is not.

### 3. Server-independent host-metrics subscription on `/` (the resolved load-bearing design point)

**Verified current state** (diverges from the backlog's "the metrics data ALREADY flows … the frontend just needs to consume `event:metrics` on `/`"):

- `SessionProvider` **is** mounted in `RootWrapper` above all routes, so `/` (`ServerListPage`) is inside the provider and *can* call a metrics hook. So far, so good.
- **However**, the provider opens an `EventSource` only for **attached** servers (`attachServer(name)`, lazily called when a sidebar group expands), via `/api/sessions/stream?server=<name>`. On `/` there is no attached server and no `currentServer`, so **no EventSource is open**.
- Worse, `useMetrics()` returns metrics for the **current server only**: `currentMetrics = currentServer ? metricsByServer.get(currentServer) ?? null : null`. On `/`, `currentServer` is null → `useMetrics()` returns `null` unconditionally, even if a stream were open.

So `event: metrics` being server-independent server-side does **not** mean it reaches `/` today — `/` has no live SSE connection and no current-server metrics slice. **This gap must be closed for the zone to show live data.**

**Chosen approach — (B) a dedicated server-independent metrics subscription** (user-confirmed at intake).
<!-- clarified: metrics-acquisition fork resolved to approach B (server-independent subscription + useHostMetrics) — user chose it over (A) attach-first-server and (C) GET+poll -->
Add a provider affordance (or a small standalone hook) that opens **one** `EventSource` purely to receive the server-independent `event: metrics` broadcast, **independent of any server attachment**, and expose it via a new `useHostMetrics()` that is **not** `currentServer`-gated. `ServerListPage` consumes `useHostMetrics()`.

Rationale for (B) over the alternatives: it matches the server-independent nature of the broadcast (host metrics are host-global), it **works with zero tmux servers** (the fresh-box case — exactly when an operator wants host health), and it does not overload per-server attachment semantics. The two rejected alternatives, for the record:
- **(A) Attach the first available server on `/`** — simplest, reuses everything, but zero servers ⇒ no stream ⇒ no host health, and it semantically gates host metrics on an arbitrary server.
- **(C) Backend `GET /api/metrics` + poll** — introduces a poll where an event stream already exists and adds a new endpoint; least aligned with the SSE-first pattern.

**Precondition to verify during apply**: the SSE endpoint must accept a connection intended purely for the server-independent broadcast. Confirm whether `GET /api/sessions/stream` tolerates a missing/neutral `server` query param (streaming `event: metrics` without erroring). If it rejects a missing/unknown `server`, approach (B) needs a small backend tolerance change (accept a metrics-only / server-neutral stream) — a bounded, Constitution-IX-compliant read-path adjustment, not a pivot away from (B).

### 4. Acceptance behavior

- Opening `/` shows live host metrics (hostname, CPU sparkline, mem, load, disk, uptime) that update on each SSE metrics tick (~2.5s).
- The existing server tiles (create / open / count) are unchanged and still function.
- No new route is added; `/` stays the home route.
- No database, no backend persistence (Constitution II) — for approach (B)/(A) no backend change at all; approach (C) would add one read-only GET endpoint.
- Graceful empty state when no metrics have arrived or the host reports zeros (non-Linux).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the `/` route (`ServerListPage`) gains a host-health zone; document the Cockpit host-console home, the reused metrics renderer, and the new server-independent `useHostMetrics()` affordance and how it differs from the `currentServer`-scoped `useMetrics()`.
- `run-kit/architecture`: (modify) — record the server-independent host-metrics EventSource subscription added to `SessionProvider` (approach B): one stream opened purely for the `event: metrics` broadcast, independent of per-server attachment, exposed via `useHostMetrics()`. If apply finds the SSE endpoint needs a small server-neutral-stream tolerance change, record that too.

## Impact

**Frontend (primary):**
- `app/frontend/src/components/server-list-page.tsx` — add the host-health zone.
- `app/frontend/src/contexts/session-context.tsx` — modified: add a server-independent metrics subscription (one EventSource for the `event: metrics` broadcast, independent of `attachServer`) + a `useHostMetrics()` hook not gated on `currentServer` (approach B, confirmed).
- Reused as-is: `app/frontend/src/lib/sparkline.ts`, `app/frontend/src/lib/gauge.ts`, and the render logic currently in `app/frontend/src/components/sidebar/host-panel.tsx` (candidate for extraction into a shared presentational component).
- `app/frontend/src/types.ts` — `MetricsSnapshot` type already defined; no change expected.

**Backend:**
- Approach (B), the chosen design: **expected to require no backend change** — the collector + server-independent `event: metrics` broadcast already exist (`app/backend/internal/metrics/`, `app/backend/api/sse.go`).
- **To verify during apply** (the one open backend precondition): whether `GET /api/sessions/stream` (with no/empty/neutral `server` query param) is accepted and streams the server-independent `event: metrics` without erroring. If it rejects a missing/unknown `server`, add a small server-neutral-stream tolerance (accept a metrics-only stream) — a bounded read-path change, still Constitution IX-compliant, not a pivot away from (B).

**Tests:**
- New/updated Playwright e2e spec asserting host-health tiles render on `/` and update on the metrics tick, plus a `.spec.md` companion (Constitution: Test Companion Docs).
- Unit coverage for any extracted presentational component and for the empty/zero-metrics state.

**Constitution touchpoints:** II (no DB — derive from procfs), IV (minimal surface — read-only, no new route, no admin), VII (convention over config — reuse the SSE payload + renderer), IX (if a GET endpoint is added, it's a read — compliant), and Test Companion Docs (`.spec.md` for any new spec).

## Open Questions

- **RESOLVED at intake** — *How should `/` obtain host metrics, given the verified SSE-subscription gap?* → **Approach (B): a server-independent host-metrics subscription + `useHostMetrics()`** (user-confirmed). See What Changes §3. The only residual is a bounded apply-time verification: whether the SSE endpoint tolerates a server-neutral stream; if not, add a small tolerance change (does not change the chosen approach).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Deliver zone 1 (HOST HEALTH) only; zones 2 (server tiles) untouched, zone 3 (services) is out of scope (separate item [5d0z]) | Explicit in the backlog text — "SERVICES (separate follow-on item)", "Keep the existing server-tile … behavior intact" | S:95 R:85 A:95 D:95 |
| 2 | Certain | Read-only awareness view; no host mutation (no systemd/storage/service management) | Explicit in backlog ("read-ONLY … NOT Cockpit-the-admin-panel") and required by Constitution IV | S:95 R:80 A:100 D:95 |
| 3 | Certain | Render from the existing `MetricsSnapshot` / `event: metrics` payload; no new metrics data source | Backlog + verified: collector + server-independent SSE broadcast already exist; `MetricsSnapshot` fields confirmed in code | S:90 R:80 A:95 D:90 |
| 4 | Confident | Reuse `lib/sparkline.ts` + `lib/gauge.ts` and the `HostPanel` render logic rather than writing a new renderer; lean toward extracting a shared presentational component (two call sites now) | Strong codebase signal — the exact renderer exists; extraction is the standard DRY move for a second consumer and is easily reversed | S:70 R:75 A:85 D:70 |
| 5 | Confident | Metrics fields to show = hostname, CPU sparkline+current, mem used/total, load 1/5/15, disk used/total, uptime | Enumerated in the backlog and matches the full `MetricsSnapshot`/`HostPanel` field set exactly | S:85 R:80 A:90 D:85 |
| 6 | Confident | Host-health zone renders above the server-tile grid, inside the existing scroll container; graceful empty/zero state mirroring `HostPanel`'s `!metrics` branch | Backlog says "above or beside"; above-in-scroll-container is the low-risk default matching the current single-column-then-grid layout; empty state is required for non-Linux/pre-first-tick | S:65 R:80 A:80 D:70 |
| 7 | Certain | `/` acquires host metrics via approach (B): a server-independent host-metrics subscription + `useHostMetrics()` (not `currentServer`-gated), rather than (A) attach-first-server or (C) GET+poll | Asked and answered at intake — user chose (B). Was the load-bearing architectural fork; now determined by an explicit user decision, so graded Certain | S:90 R:70 A:95 D:95 |
| 8 | Certain | The verified SSE-subscription gap is closed by adding one server-independent metrics EventSource to `SessionProvider` (no per-server attachment); apply verifies the endpoint tolerates a server-neutral stream and adds a small tolerance change only if needed | Follows directly from the (B) decision above; the residual endpoint-tolerance check is a bounded apply-time verification, not an open design choice | S:80 R:65 A:85 D:85 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
