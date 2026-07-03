# Intake: Cockpit HTTP-Only Services

**Change**: 260703-8y2a-cockpit-http-only-services
**Created**: 2026-07-03

## Origin

One-shot `/fab-new` invocation, no prior discussion in the conversation.

> in the cockpit, instead of listing all services on the host, only list the services which have a http response

## Why

The Cockpit's SERVICES zone (`/`, zone 3) renders a tile for **every listening TCP port** on the host — databases, caches, SSH, brokers, internal daemons — as enumerated by `internal/ports.Collector` and broadcast over SSE (`event: services`). But the zone's entire purpose is opening a service's **web UI** in an `@rk_type=iframe` tmux window via the `/proxy/{port}/` reverse proxy. For any port that doesn't speak HTTP, the tile is pure noise: its "Open in window" button is disabled by a static `NON_HTTP_PORTS` denylist (`server-list-page.tsx:22`) that is explicitly a heuristic — the code comment admits "we can't KNOW a port speaks HTTP without probing it". A Postgres on 5432 is correctly gated, but a Postgres on 5433 renders an enabled button that opens a broken iframe, and an HTTP dev server is indistinguishable from a random daemon.

If we don't fix it: on a busy operator box the zone fills with unopenable ports, burying the handful of actual web UIs the zone exists to surface, and the denylist keeps accumulating exceptions.

Why this approach: replace the guess with truth — probe each listening port with a real HTTP request on the backend and list only the ports that answer HTTP. The backend already owns a poll loop for this exact data (2.5 s cadence), probing from the host is the only correct vantage point (the browser may be remote over Tailscale and cannot probe host-local ports), and a probe-backed list makes the frontend denylist dead code.

## What Changes

### Backend — HTTP probe layer in `internal/ports`

Add an HTTP-probe step to the collector so the snapshot contains **only services that answer HTTP**:

- **Probe mechanics**: for each enumerated listening port, issue `GET http://127.0.0.1:{port}/` with a short per-request timeout (~750 ms), using an `http.Client` that does **not follow redirects** (`CheckRedirect` returning `http.ErrUseLastResponse`) and discards/closes the response body. `127.0.0.1` deliberately mirrors the `/proxy/{port}/` upstream target (`api/proxy.go:41` — `Host: fmt.Sprintf("127.0.0.1:%d", port)`): a port unreachable at loopback was never openable via "Open in window" anyway.
- **What counts as HTTP**: any well-formed HTTP response, **regardless of status code** — 200, 404, 401, 302, even 400 ("plain HTTP request sent to HTTPS port") all prove the listener speaks HTTP. Connection refused/reset, probe timeout, or a malformed response (any `http.Client` error) marks the port non-HTTP for that probe cycle.
- **Filtering happens in the backend**: `collect()` composes `readListeningPorts()` (unchanged, per-platform) with the probe filter; the `ServicesSnapshot` semantic becomes "listening **HTTP** services". No `http:` boolean is added to `Service` — no consumer needs non-HTTP ports.
- **Probe cadence decoupled from enumeration cadence**: enumeration stays at the 2.5 s tick (`servicesPollInterval`), but probe results live in a per-port TTL cache (~10 s), following the codebase's idiomatic TTL-cache pattern (`cwdExistsCache`, `fetchPaneMapCached`). On each tick: ports with no cached result (newly seen) are probed immediately — a new HTTP service surfaces within one tick; ports with a fresh cached result reuse it; stale entries re-probe. This bounds probe traffic in each service's access log to ~1 request per 10 s instead of one per 2.5 s tick. Cache entries for ports that stop listening are dropped.
- **Bounded parallelism**: probes within a cycle run in parallel under a bounded goroutine pool (cap ~10, semaphore channel — the `tmux.ListServers` precedent), so N slow/hanging ports cost ~one timeout, not N.
- **Placement**: the probe is platform-agnostic (`net/http` against loopback) and lives in shared collector code (e.g. a `probe.go` beside `collector.go`), applied after the per-platform `readListeningPorts()` seam. `collector_other.go` (Windows/BSD) returns an empty slice, so the probe is a no-op there — unchanged graceful degradation.
- **Unchanged**: `Service`/`ServicesSnapshot` wire shape, the `event: services` SSE broadcast (`api/sse.go`), `servicesPollInterval`, and the never-nil-slice guarantee. rk's own port answers HTTP and continues to list itself.

### Frontend — delete the denylist, un-gate the button

- Remove `NON_HTTP_PORTS` and `isLikelyHttpPort()` from `server-list-page.tsx` (lines 13–37) — every listed service now provably speaks HTTP.
- "Open in window" is enabled whenever `servers.length > 0`; drop the `!isLikelyHttpPort(port)` disabled-branch, the "Not a web service" tooltip branch, and the belt-and-suspenders guard in `handleOpenInWindow` (line 147).
- The SERVICES section comment updates to describe the probe-backed contract (the backend only broadcasts HTTP responders).
- Empty state stays `No services` — it now means "no HTTP-answering services".
- `types.ts` `Service`/`ServicesSnapshot` unchanged.

### Tests

- **Go** (`internal/ports`): probe-layer tests using real listeners on ephemeral ports — an `httptest.Server` (listed), a raw `net.Listener` that accepts and never responds (filtered out via timeout), a closed port (filtered out), a non-2xx responder e.g. 404/401 (listed). TTL-cache behavior: fresh result reused, stale result re-probed, vanished port evicted.
- **Frontend** (`server-list-page.test.tsx`): update tests that exercise the denylist gating (disabled button/tooltip for e.g. 5432) to the new always-enabled-when-servers-exist contract.

## Affected Memory

- `run-kit/architecture`: (modify) `internal/ports` row — collector gains the HTTP-probe filter layer (probe mechanics, TTL cache, bounded pool); snapshot semantic becomes "listening HTTP services"
- `run-kit/ui-patterns`: (modify) Cockpit host-console SERVICES zone — `NON_HTTP_PORTS` denylist gate replaced by the probe-backed list; "Open in window" gated only on server existence

## Impact

- `app/backend/internal/ports/` — `collector.go` (compose probe into `collect()`), new probe file + tests; per-platform `collector_{linux,darwin,other}.go` untouched
- `app/backend/api/sse.go` — no functional change (comment touch-up at most)
- `app/frontend/src/components/server-list-page.tsx` + `server-list-page.test.tsx` — denylist removal, button gating, test updates
- No API-shape, route, or type changes; no new dependencies (`net/http` stdlib)

## Open Questions

None — the request is unambiguous and the codebase determines the mechanism; remaining choices are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Probe runs in the backend `internal/ports` collector, not the frontend | Browser may be remote (Tailscale) and cannot probe host-local ports; collector already owns the poll loop; matches metrics/prstatus collector pattern | S:75 R:70 A:95 D:90 |
| 2 | Confident | Backend filters the snapshot to HTTP responders (no `http:` flag + client-side filter) | Directly implements "only list…"; no consumer needs non-HTTP ports; smaller surface (constitution §IV) | S:60 R:70 A:75 D:65 |
| 3 | Confident | "Has an HTTP response" = any well-formed HTTP response regardless of status code; client error/timeout/refused = not HTTP | A 404/401/302/400 still proves the listener speaks HTTP, which is all the iframe proxy needs | S:65 R:80 A:85 D:80 |
| 4 | Confident | Probe = `GET http://127.0.0.1:{port}/`, ~750 ms timeout, redirects not followed, body discarded, plain HTTP only | Mirrors the `/proxy/{port}/` upstream (`127.0.0.1`); HTTPS-only services typically still answer plain HTTP with 400, which counts | S:45 R:85 A:80 D:65 |
| 5 | Confident | Probe cadence decoupled via ~10 s per-port TTL cache; new ports probed on first sight; bounded pool cap ~10 | Probing every 2.5 s tick spams every local service's access log; TTL-cache is the codebase idiom; exact TTL/cap values are tunable one-liners | S:30 R:85 A:65 D:55 |
| 6 | Certain | Delete `NON_HTTP_PORTS` + `isLikelyHttpPort`; "Open in window" enabled whenever servers exist | The heuristic is dead code once the list is probe-backed; its own comment calls probing the truthful replacement | S:60 R:90 A:90 D:85 |
| 7 | Confident | Services unreachable at `127.0.0.1` (bound to a non-loopback interface only, or v6-only `[::1]`) drop from the list | Consistent with `/proxy` targeting `127.0.0.1` — such ports were never openable from the tile anyway | S:40 R:80 A:75 D:60 |
| 8 | Certain | SSE event (`event: services`) and `Service`/`ServicesSnapshot` wire shape unchanged; rk's own port keeps listing itself | Pure content filter — no consumer contract changes; rk answers HTTP so it passes the probe | S:70 R:90 A:90 D:90 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
