# Intake: Service Tiles on the Cockpit Host Console

**Change**: 260701-5d0z-service-tiles-host-console
**Created**: 2026-07-01

## Origin

> [5d0z] Service tiles on the Cockpit host console — zone 3 of `/` (depends on the Cockpit host-console item [vshd]; assumes that view exists). Expose the machine's LISTENING SERVICES as tiles on the server dashboard, because a listening port is a HOST property (not owned by any tmux window/session) — so `/` (the box-level console) is the correct ontological home, NOT the per-session sidebar. NOVEL COMBO no competitor has: your agent starts a dev server (e.g. `just dev` on :5173) and it auto-appears as a tile next to the agent editing it; one click opens it in an iframe window via the EXISTING proxy. What is MISSING is DISCOVERY: a listening-ports collector.

One-shot invocation from `/fab-new 5d0z` (backlog item). No prior `/fab-discuss` conversation preceded this change.

**Dependency is satisfied.** This is **zone 3 (SERVICES)** of the three-zone Cockpit host console established by [vshd] (`260701-vshd-cockpit-host-console-home`, `review-pr:done`). The vshd shell has been cherry-picked into this branch (`bd1f2ed operator: cherry-pick vshd dependency`), so the zone-1 HOST HEALTH section, the server-independent `useHostMetrics()` subscription, and the shared `HostMetrics` component all exist here (verified in `app/frontend/src/components/server-list-page.tsx`). Zone 2 (existing server tiles) stays untouched. This change adds zone 3.

**Backlog verified rk 2.6.6; current version 2.9.1.** The design below reflects the **verified current state** of the code, re-checked during intake. The backlog's central claim — "the plumbing already exists, only DISCOVERY is missing" — is confirmed: the reverse proxy, the iframe-window type, and the collector idiom to model all exist as described. One load-bearing point the backlog left implicit surfaced during intake and is recorded as an Unresolved question (how "Open in window" obtains a target `(server, session)` from the server-less `/` route).

## Why

1. **Problem**: A listening TCP port is a **host property** — it belongs to the box, not to any tmux window or session. run-kit today has no surface that shows what's listening on the machine. An operator whose agent just started a dev server (`vite` on :5173, an API on :8080) has no way to see it or reach it from run-kit; they must know the port and hand-type a proxy URL, or leave run-kit entirely.
2. **Consequence if unfixed**: The "novel combo" that distinguishes run-kit stays unrealized — an agent starts a service and it silently exists, undiscovered, instead of auto-appearing as a clickable tile next to the agent that started it. The Cockpit positioning ("remote console for your box") is incomplete: zone 1 shows host *health*, but the box's *services* — arguably the more actionable host-global fact — are invisible.
3. **Why this approach**: The two hard parts already exist. **(a)** The reverse proxy `/proxy/{port}/*` → `http://127.0.0.1:{port}` is built, WebSocket-transparent (via `httputil.ReverseProxy`), rewrites localhost references in HTML, and validates the port (1–65535) — `app/backend/api/proxy.go`. **(b)** iframe windows are a first-class window type (`@rk_type=iframe` + `@rk_url`), creatable in one client call `createWindow(server, session, name, cwd, "iframe", url)` — `app/frontend/src/api/client.ts:107`, used today at `app.tsx:606`. The **only** missing piece is **discovery**: a collector that enumerates listening TCP ports and a zone-3 tile grid that renders them. The collector mirrors the proven in-memory `internal/metrics` idiom (Constitution II: no DB, derive at request time; Constitution I: exec-with-timeout if it shells out). This is the smallest change that delivers the combo.

**Keep it dumb first (v1 scope discipline).** v1 lists listening TCP ports and lets the user open any of them. It does **NOT** heuristically classify "is this an HTTP server" — some ports proxy cleanly (a dev server), some won't (a database port), and that's acceptable in v1; the user decides what to open. No health-checking, no protocol sniffing, no favicons. This keeps the collector honest (it reports what's listening, nothing inferred) and the surface minimal (Constitution IV).

## What Changes

### 1. Backend — a listening-TCP-port collector (`app/backend/internal/ports/`)

A new in-memory collector modeled **exactly** on `internal/metrics.Collector` (`app/backend/internal/metrics/collector.go`), which is the canonical shape: `NewCollector(pollInterval)` → `Start(ctx)` (spawns a goroutine with a `time.NewTicker`) → `Snapshot()` guarded by `sync.RWMutex`, with a platform split for the OS-specific read.

Proposed shape (naming follows the metrics collector verbatim):

```go
// app/backend/internal/ports/collector.go
type Service struct {
    Port    int    `json:"port"`
    Process string `json:"process,omitempty"` // best-effort command name; "" if unknown
    PID     int    `json:"pid,omitempty"`     // best-effort; 0 if unknown
}

type ServicesSnapshot struct {
    Services []Service `json:"services"` // sorted by port asc; never nil (empty slice, not null)
}

type Collector struct {
    mu           sync.RWMutex
    snapshot     ServicesSnapshot
    pollInterval time.Duration
}

func NewCollector(pollInterval time.Duration) *Collector { ... }
func (c *Collector) Start(ctx context.Context) { ... } // ticker loop, same as metrics
func (c *Collector) Snapshot() ServicesSnapshot { ... } // RLock + copy
```

**Reading the ports — procfs preferred (no-dep parity with metrics).** The metrics collector reads procfs directly (`os.Open("/proc/stat")`, `os.ReadFile("/proc/loadavg")`, etc. — `collector_linux.go`) with a `//go:build linux` / `//go:build darwin` split and graceful zero-value returns on any error. The ports collector follows the same split:

- **`collector_linux.go`** (`//go:build linux`): parse `/proc/net/tcp` and `/proc/net/tcp6` for sockets in state `0A` (LISTEN). Extract the local port (hex, high 16 bits of the `local_address` field). Deduplicate ports across the two files (a port bound on both v4 and v6 is one service). This is the no-dependency path, matching the metrics collector's procfs discipline exactly.
- **`collector_darwin.go`** / non-Linux (`//go:build !linux`): return an empty `ServicesSnapshot{Services: []Service{}}` — graceful zero, exactly like `metrics/collector_darwin.go`. No crash, no error surfaced.

> **Design note on `ss` vs procfs (recorded as an assumption, not a hard decision):** the backlog offers `ss -ltnp` OR procfs, "procfs preferred for no-dep parity with metrics." procfs is the lean: it needs no subprocess (so no `exec.CommandContext`/timeout ceremony, no Constitution-I surface), and it matches the metrics collector's exact idiom so the two collectors read identically. The tradeoff: `/proc/net/tcp` gives the socket owner as a UID + inode, so **best-effort process attribution** (mapping a socket inode → PID → command via `/proc/<pid>/fd` + `/proc/<pid>/comm`) is more work than `ss -p` gives for free. v1 MAY ship with port-only tiles (empty `Process`) and add attribution as a refinement — see Assumptions. If attribution proves to need `ss`, that is a bounded, Constitution-I-compliant `exec.CommandContext`-with-timeout addition, not a redesign.

### 2. Backend — surface the snapshot as a server-independent SSE event (`app/backend/api/sse.go`)

Model on how metrics reaches clients. The SSE hub already broadcasts `event: metrics` to **all** clients on every tick, server-independently (`sse.go:677`):

```go
// existing metrics broadcast, sse.go:677 — the exact idiom to mirror
if h.metrics != nil {
    snap := h.metrics.Snapshot()
    metricsJSON, _ := json.Marshal(snap)
    metricsEvent := []byte(fmt.Sprintf("event: metrics\ndata: %s\n\n", metricsStr))
    // fan out to every client across every server
}
```

Add a parallel `event: services` broadcast in the same tick loop: hold the collector as `h.services`, snapshot it, marshal, and fan out identically. Two details to mirror from the metrics path exactly:

- **Server-neutral stream reuse.** This event rides the **existing** server-neutral stream — the hub already supports a metrics-only client via `?metrics=1` (`sse.go:839`, `metricsOnlyServer` sentinel) that receives server-independent broadcasts without polling any tmux server. `event: services` reaches that same client with **no new endpoint** (Constitution IV, IX).
- **Initial cached send on client join.** The hub sends the cached metrics snapshot to a client the moment it connects (`sse.go:283-289`, `h.cachedMetricsJSON`) so a fresh client isn't blank until the next tick. Add a `h.cachedServicesJSON` and mirror that initial send for `event: services`, so a client opening `/` sees services immediately rather than after a poll cycle.

The collector is constructed and `Start`ed where the metrics collector is (server bootstrap), and passed into `newSSEHub` alongside `mc *metrics.Collector`.

> **Alternative considered — a `GET /api/services` endpoint.** Rejected for the same reason vshd rejected GET+poll for metrics: an event stream already exists and reaches `/`, so a poll endpoint is redundant surface. SSE-first is the established pattern.

### 3. Frontend — a server-independent services subscription + `useHostServices()` hook (`app/frontend/src/contexts/session-context.tsx`)

The vshd change added a server-independent `useHostMetrics()` fed by its own `HostMetricsContext`. **`event: services` flows over the same connections** — the frontend does not open a second EventSource; it adds an `addEventListener("services", ...)` handler wherever the `metrics` listener already lives and exposes the parsed `ServicesSnapshot.services` via a parallel `useHostServices()` hook (not `currentServer`-gated, its own `HostServicesContext`), mirroring `useHostMetrics()`.

**Both metrics-delivery paths must be mirrored** (verified in `session-context.tsx`): host-global metrics arrive via *two* code paths and a services listener must be added to **both**, or `/` goes stale whenever a server is attached:
1. The **dedicated `?metrics=1` stream** (`session-context.tsx:461-493`), opened only when zero servers are attached (`hostMetricsWanted = attachedSet.size === 0`).
2. The **per-server-stream fan-out** (`session-context.tsx:340-357`): when servers are attached, the dedicated stream is closed and the server-global `event: metrics` (identical on every per-server stream) is fed into `HostMetricsContext` from any attached server's stream. `event: services` is likewise server-global, so the same fan-out applies.

`ServerListPage` consumes `useHostServices()`.

### 4. Frontend — a SERVICES zone (zone 3) on `ServerListPage` (`app/frontend/src/components/server-list-page.tsx`)

The current layout (verified) is: header → scroll container `div.flex-1.overflow-y-auto` containing **zone 1** `<section aria-label="Host health" className="mb-6 max-w-md">` (the vshd HOST HEALTH block), then a server-count line, then **zone 2** `<div className="grid ...">` (server tiles + New Server). Add **zone 3** as a new `<section aria-label="Services">` inside the same scroll container, reusing zone 1's `mb-6 max-w-md` sibling-section idiom. Placement is a minor layout choice (recorded Confident, easily reversed): the cleanest fit is **directly after zone 1 (host health → services → servers)**, since it sits beside its sibling host-global section above the per-server grid; the backlog's "zone 3" numbering would instead put it after the server grid. Either reads fine — apply picks one and the tile content is placement-independent. Each tile shows:

- **Port** (primary, mono) — e.g. `:5173`
- **Best-effort process / command** (secondary, dim) — e.g. `vite`, or nothing when attribution is unavailable
- **Primary action "Open in window"** — creates an iframe window pointing at `/proxy/{port}/` (see §5)

Empty state: when `useHostServices()` returns an empty array (no listening ports, or non-Linux host), render a graceful "No services" affordance mirroring zone 1's `No metrics` fallback — never a crash or blank grid.

### 5. Frontend — the "Open in window" action (the one open design point)

An iframe window is created with `createWindow(server, session, name, undefined, "iframe", "/proxy/{port}/")`. This requires a target **`(server, session)`** — but `/` is **server-less**: `IframeWindow` itself notes it "renders only from AppShell terminal routes where `currentServer` is set" (`iframe-window.tsx:12`), and `ServerListPage` only ever `navigate`s to `/$server` — it holds no session context. So "Open in window" from `/` must resolve a target `(server, session)` before it can create the iframe window.

**RESOLVED at intake (user decision): approach (A) — a real `@rk_type=iframe` tmux window** (the backlog's literal ask), created via `createWindow(server, session, ":{port}", undefined, "iframe", "/proxy/{port}/")`, then navigate to it. Rejected: (B) plain browser tab (`window.open`) — loses the in-app window; (C) server-less in-app overlay — new UI surface, diverges from the established iframe-window type.

**Target `(server, session)` resolution** (the residual sub-decision, resolved as a graded default — see Assumptions, not blocking):
- **One or more servers exist**: target the **most-recently-active / first-listed** server. If it has a session, create the window there; if not, create an instant session first (reuse the existing `executeCreateSessionInstant` / instant-session machinery the app already uses at `app.tsx`), then create the iframe window in it and navigate.
- **Zero servers exist**: a tmux iframe window is impossible with no server. v1 default: **disable the tile's "Open in window" action with a hint** (e.g. "create a server first") rather than silently spawning a server from a proxy-tile click. Lower-surprise, easily upgraded later to an auto-create-server flow if desired.

This decision shapes only the click handler (and the disabled/hint state); it does **not** affect the collector, the SSE event, or the tile rendering (§§1–4 are independent of it).

## Affected Memory

- `run-kit/architecture`: (modify) — record the new in-memory listening-TCP-port collector (`internal/ports`, procfs `/proc/net/tcp{,6}` LISTEN parse, `//go:build` platform split, graceful zero on non-Linux, RWMutex snapshot — modeled on `internal/metrics`) and its server-independent `event: services` SSE broadcast riding the existing metrics-only server-neutral stream (`?metrics=1` / `metricsOnlyServer` sentinel).
- `run-kit/ui-patterns`: (modify) — document the SERVICES zone (zone 3) on `/`, the `useHostServices()` server-independent subscription (parallel to `useHostMetrics()`, same EventSource), the service-tile UI, and the "Open in window" → iframe-window (`@rk_type=iframe`, `@rk_url=/proxy/{port}/`) action and how it resolves a target `(server, session)` from the server-less `/` route (per the resolved Open Question).

## Impact

**Backend (new + small wiring):**
- **New**: `app/backend/internal/ports/collector.go` (+ `collector_linux.go`, `collector_darwin.go`, tests) — the listening-ports collector, modeled on `internal/metrics`.
- `app/backend/api/sse.go` — add `h.services` field, a parallel `event: services` broadcast in the tick loop (~10 lines mirroring the `event: metrics` block), and thread the collector through `newSSEHub`.
- Server bootstrap (wherever `metrics.NewCollector(...)` is constructed and `Start`ed) — construct + start the ports collector alongside it.
- **No new HTTP endpoint, no new route** (Constitution IV, IX): the event rides the existing server-neutral SSE stream.

**Frontend (primary UI work):**
- `app/frontend/src/contexts/session-context.tsx` — add a `services` event listener to the existing host-metrics EventSource and a `useHostServices()` hook (parallel to `useHostMetrics()`).
- `app/frontend/src/components/server-list-page.tsx` — add the zone-3 SERVICES `<section>` + tile grid + "Open in window" handler.
- `app/frontend/src/types.ts` — add `Service` / `ServicesSnapshot` types.
- Reused as-is: `createWindow` (`api/client.ts`), the `/proxy/{port}/*` handler, the iframe-window type.

**Tests:**
- Go: `collector_linux_test.go` — parse a fixture `/proc/net/tcp` and assert LISTEN ports are extracted, deduped across v4/v6, and non-LISTEN sockets ignored; non-Linux path returns empty. (Mirror `metrics/collector_linux_test.go`.)
- Playwright e2e + `.spec.md` companion (Constitution: Test Companion Docs) — service tiles render on `/` from the `event: services` stream and "Open in window" creates an iframe window. (e2e feasibility depends on being able to seed a known listening port on the isolated test host — noted as an apply-time concern.)
- Vitest unit — `useHostServices()` parsing + the empty/non-Linux state.

**Constitution touchpoints:** II (no DB — collector is in-memory, derived from procfs at each tick), I (if `ss` is used for attribution, `exec.CommandContext` with timeout; procfs path needs none), IV (no new route — a section of `/`; no admin/management), VII (convention over config — reuse the SSE payload + iframe/proxy mechanism), IX (no new mutating verb — the "Open in window" action uses the existing `POST /api/sessions/{session}/windows`). All satisfied.

## Open Questions

- **RESOLVED at intake — How does "Open in window" resolve a target `(server, session)` from the server-less `/` route?** → **Approach (A): a real `@rk_type=iframe` tmux window** (user-confirmed at intake). Target resolution: most-recently-active server + instant session when ≥1 server exists; disable the action with a hint when zero servers exist. See What Changes §5. Rejected (B) plain browser tab and (C) server-less overlay. Residual is only the graded target-resolution default (not blocking).
- **Best-effort process attribution — port-only v1, or attribution in v1?** procfs gives socket→UID+inode, so PID/command attribution is extra work (inode→`/proc/<pid>/fd` scan). Ship port-only tiles first and add attribution later, or invest in attribution for v1? (Leaning port-first per "keep it dumb first"; recorded as an assumption, not blocking.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | This is zone 3 (SERVICES) of the vshd three-zone host console; the [vshd] shell (zone-1 HOST HEALTH, `useHostMetrics()`, `HostMetrics`) is present in this branch and reused untouched; zones 1 and 2 are not modified | Backlog is explicit ("zone 3 of /", "depends on [vshd]"); verified in code — `server-list-page.tsx` imports `useHostMetrics`/`HostMetrics` and renders the HOST HEALTH `<section>`; vshd cherry-picked (`bd1f2ed`) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Discovery is the only missing piece: the `/proxy/{port}/*` reverse proxy, iframe window type (`@rk_type=iframe`/`@rk_url`, via `createWindow`), and the collector idiom all already exist and are reused, not rebuilt | Verified first-hand: `api/proxy.go` (proxy, WS-transparent, port-validated, HTML-rewrite), `api/client.ts:107` + `app.tsx:606` (iframe create), `internal/metrics/collector.go` (collector shape) | S:90 R:80 A:95 D:90 |
| 3 | Certain | New in-memory `internal/ports` collector modeled exactly on `internal/metrics.Collector` — `NewCollector`→`Start(ctx)` ticker→`Snapshot()` under RWMutex, `//go:build` linux/darwin split, graceful zero on non-Linux; no DB (Constitution II) | The metrics collector is the canonical established idiom; backlog says "modeled on internal/metrics.Collector"; Constitution II mandates no persistent store | S:90 R:75 A:95 D:90 |
| 4 | Confident | Read listening ports from procfs (`/proc/net/tcp` + `/proc/net/tcp6`, state `0A`=LISTEN, dedupe v4/v6) rather than shelling out to `ss` | Backlog states "procfs preferred for no-dep parity with metrics"; matches the metrics collector's exact procfs discipline; avoids a subprocess (no Constitution-I surface). `ss` remains an easy, bounded fallback for attribution if needed | S:75 R:65 A:80 D:75 |
| 5 | Confident | Surface the snapshot as a server-independent `event: services` SSE broadcast riding the existing `?metrics=1` server-neutral stream (no new HTTP endpoint); frontend consumes via a `useHostServices()` hook mirroring `useHostMetrics()` on the same EventSource | Directly mirrors the verified `event: metrics` path (`sse.go:677`, `:839` `metricsOnlyServer` sentinel) and the vshd `useHostMetrics()` precedent; honors Constitution IV/IX (no new route/verb). Backlog offered "SSE hub event OR GET endpoint" — SSE matches the established pattern | S:80 R:70 A:85 D:80 |
| 6 | Confident | Zone 3 renders as a new `<section aria-label="Services">` inside the existing `/` scroll container, placed after the server-tile grid (host health → servers → services); graceful "No services" empty state mirroring zone 1's `No metrics` fallback | Backlog says "zone 3" (ordering implies after servers); verified single-scroll-container layout in `server-list-page.tsx`; empty state required for zero-ports / non-Linux, mirroring the established zone-1 pattern | S:70 R:80 A:80 D:75 |
| 7 | Certain | v1 lists listening TCP ports and lets the user open any — NO heuristic "is this HTTP" classification, no health-check, no protocol sniffing | Backlog is explicit: "KEEP IT DUMB FIRST … do NOT try to classify". Keeps the collector honest and the surface minimal (Constitution IV) | S:85 R:80 A:90 D:85 |
| 8 | Confident | Ship port-only tiles in v1 (empty `Process`) and defer best-effort process/command attribution (socket inode→PID→comm) to a refinement | procfs makes attribution non-trivial (inode→`/proc/<pid>/fd` scan); "keep it dumb first" favors shipping discovery before attribution. But the backlog does list "best-effort process attribution" in scope, so this is a real tradeoff, not a settled default — easily revisited | S:55 R:70 A:55 D:45 |
| 9 | Certain | "Open in window" opens a real `@rk_type=iframe` tmux window (approach A) via `createWindow(server, session, ":{port}", _, "iframe", "/proxy/{port}/")` — not a plain browser tab (B) or a server-less overlay (C) | Was the load-bearing architectural fork; **asked and answered at intake — user chose (A)**, the backlog's literal ask. Now determined by explicit user decision | S:90 R:70 A:95 D:95 |
| 10 | Confident | Target `(server, session)` for the iframe window: most-recently-active/first server + instant session (reuse existing instant-session machinery) when ≥1 server exists; disable the action with a "create a server first" hint when zero servers exist | Follows from the (A) decision; the app already has instant-session creation to reuse; disabling on zero-servers is the lower-surprise v1 default (avoids spawning a server from a proxy-tile click) and is easily upgraded later. A reasonable default, not a settled requirement | S:60 R:70 A:70 D:65 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
