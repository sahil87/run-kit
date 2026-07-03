# Plan: Cockpit HTTP-Only Services

**Change**: 260703-8y2a-cockpit-http-only-services
**Intake**: `intake.md`

## Requirements

### Backend: HTTP-probe filter in `internal/ports`

#### R1: The services snapshot lists only ports that answer HTTP
The collector's `collect()` SHALL compose the per-platform `readListeningPorts()` enumeration with an HTTP probe filter so that `ServicesSnapshot.Services` contains ONLY ports that return a well-formed HTTP response. The `Service`/`ServicesSnapshot` wire shape MUST NOT change (no `http:` boolean added).

- **GIVEN** the host has a listening HTTP server on port P and a listening non-HTTP daemon on port Q
- **WHEN** the collector runs a poll cycle
- **THEN** `Snapshot().Services` contains a `Service{Port: P}` (with any platform-populated `Process`/`PID`)
- **AND** `Snapshot().Services` does NOT contain port Q

#### R2: "Answers HTTP" = any well-formed HTTP response regardless of status code
A port SHALL be classified as HTTP when `GET http://127.0.0.1:{port}/` yields any well-formed HTTP response (200, 404, 401, 302, 400, etc.). Connection refused/reset, probe timeout, or any `http.Client` error SHALL classify the port as non-HTTP for that probe cycle.

- **GIVEN** a listener that returns HTTP 404 (or 401/302/400) on `GET /`
- **WHEN** the probe runs against that port
- **THEN** the port is classified HTTP and retained in the snapshot
- **AND GIVEN** a listener that accepts the connection but never sends a valid HTTP response (or a closed port)
- **WHEN** the probe runs against that port
- **THEN** the probe errors/times out and the port is classified non-HTTP

#### R3: Probe mechanics mirror the `/proxy/{port}/` upstream
The probe SHALL issue `GET http://127.0.0.1:{port}/` using an `http.Client` that (a) does not follow redirects (`CheckRedirect` returns `http.ErrUseLastResponse`), (b) applies a short per-request timeout (~750 ms), and (c) discards and closes the response body. The loopback target `127.0.0.1` deliberately mirrors `api/proxy.go`'s upstream (`Host: 127.0.0.1:{port}`).

- **GIVEN** a listener bound only to a non-loopback interface (unreachable at `127.0.0.1`)
- **WHEN** the probe runs
- **THEN** the connection fails and the port is classified non-HTTP (consistent with `/proxy` never being able to reach it)
- **AND GIVEN** a listener that answers a 302 redirect
- **WHEN** the probe runs
- **THEN** the redirect is NOT followed and the 302 itself counts as a well-formed HTTP response (HTTP)

#### R4: Probe cadence is decoupled from enumeration via a per-port TTL cache
Enumeration SHALL remain on the `servicesPollInterval` (2.5 s) tick. Probe results SHALL live in a per-port TTL cache (~10 s), following the codebase TTL-cache idiom (`cwdExistsCache`). Each cycle: newly-seen ports (no cached result) are probed immediately; ports with a fresh cached result reuse it; stale entries re-probe. Cache entries for ports no longer listening SHALL be dropped.

- **GIVEN** port P was probed HTTP within the TTL window
- **WHEN** the next enumeration tick occurs before the TTL expires
- **THEN** P's cached HTTP verdict is reused with no new probe request issued
- **AND GIVEN** port P's cached entry is older than the TTL
- **WHEN** the next tick occurs and P is still listening
- **THEN** P is re-probed
- **AND GIVEN** port P stops listening
- **WHEN** the next tick occurs
- **THEN** P's cache entry is evicted

#### R5: Probes within a cycle run under a bounded parallel pool
Probes for the ports that need probing in a cycle SHALL run in parallel under a bounded goroutine pool (semaphore cap ~10), following the `tmux.ListServers` precedent, so N slow/hanging ports cost ~one timeout rather than N sequential timeouts.

- **GIVEN** several newly-seen ports where some hang until the per-request timeout
- **WHEN** the probe cycle runs
- **THEN** all probes execute concurrently bounded by the pool and the cycle completes in roughly one timeout, not the sum of timeouts

#### R6: Probe filter placement preserves platform degradation
The probe filter SHALL live in shared, platform-agnostic collector code (`net/http` against loopback), applied AFTER the per-platform `readListeningPorts()` seam. `collector_{linux,darwin,other}.go` MUST remain unchanged; on `other` (Windows/BSD) `readListeningPorts()` returns an empty slice so the probe is a no-op there.

- **GIVEN** the `other` build (empty `readListeningPorts()`)
- **WHEN** `collect()` runs
- **THEN** the probe filter receives an empty slice and produces an empty snapshot with no probe requests — unchanged graceful degradation

#### R7: SSE broadcast and never-nil contract are unchanged
The `event: services` SSE broadcast (`api/sse.go`) and `servicesPollInterval` SHALL be functionally unchanged (comment touch-up at most). `ServicesSnapshot.Services` SHALL remain never-nil (empty slice marshals to `[]`). rk's own port answers HTTP and SHALL continue to appear in the list.

- **GIVEN** zero HTTP-answering ports on the host
- **WHEN** a client connects to the SSE stream
- **THEN** it receives `event: services` with `data: {"services":[]}` (not `null`)

### Frontend: remove the denylist, gate only on server existence

#### R8: The `NON_HTTP_PORTS` denylist and `isLikelyHttpPort` are deleted
`NON_HTTP_PORTS`, `isLikelyHttpPort()`, and the belt-and-suspenders guard in `handleOpenInWindow` SHALL be removed from `server-list-page.tsx` — every listed service now provably speaks HTTP.

- **GIVEN** the backend now broadcasts only HTTP responders
- **WHEN** `server-list-page.tsx` renders the SERVICES zone
- **THEN** no `NON_HTTP_PORTS`/`isLikelyHttpPort` reference remains in the file

#### R9: "Open in window" is enabled whenever servers exist
The "Open in window" button SHALL be disabled only when `servers.length === 0` (with the "Create a server first" hint); the `!isLikelyHttpPort(port)` disabled branch and the "Not a web service" tooltip branch SHALL be removed.

- **GIVEN** at least one tmux server exists and a service tile is shown
- **WHEN** the SERVICES zone renders
- **THEN** that tile's "Open in window" button is enabled regardless of port number
- **AND GIVEN** zero servers exist
- **WHEN** the SERVICES zone renders
- **THEN** the button is disabled with the "Create a server first" title

#### R10: Frontend contract docs and empty state reflect the probe-backed list
The SERVICES section comment SHALL describe the probe-backed contract (backend broadcasts only HTTP responders). The empty state stays `No services` (now meaning "no HTTP-answering services"). `types.ts` `Service`/`ServicesSnapshot` SHALL remain unchanged.

- **GIVEN** the SERVICES zone with zero services
- **WHEN** it renders
- **THEN** it shows `No services`

### Non-Goals

- No `http:` boolean or any wire-shape change to `Service`/`ServicesSnapshot` — no consumer needs non-HTTP ports.
- No HTTPS probing — plain HTTP only (an HTTPS-only service typically answers plain HTTP with 400, which counts as HTTP).
- No new API route, endpoint, or dependency (`net/http` is stdlib).

### Design Decisions

1. **Probe filter as an injectable seam in shared collector code**: add a package-var `probePort func(ctx, port) bool` (default: real `net/http` probe) and a per-port TTL cache on the `Collector`, applied in `collect()` after `readListeningPorts()`. — *Why*: mirrors the existing `lsofRun` (darwin) / `ghExec` (prstatus) package-var seams so tests stub the network without real listeners where useful, and keeps the probe platform-agnostic per the intake. — *Rejected*: probing inside each per-platform `readListeningPorts()` (would duplicate the probe three times and couple it to enumeration).
2. **`NewCollector` seeds an EMPTY snapshot; the first tick produces the filtered list**: `NewCollector` seeds `ServicesSnapshot{Services: []Service{}}` (the `metrics.Collector` zero-value-seed precedent) WITHOUT enumerating or probing, and the probe filter produces the first real list from the first `collect()` tick onward. — *Why*: the SSE hub reads `Snapshot()` on its very FIRST poll pass and both broadcasts it and caches it in `cachedServicesJSON` (replayed to every new client) — that pass runs BEFORE the collector's ticker first fires (`api/sse.go` ~942-962; the poll loop's `waitForNext` sits at its END, ~sse.go:993). An unfiltered `readListeningPorts()` seed would therefore leak non-HTTP ports (Postgres/Redis/SSH/…) to any client connecting in the first ~2.5 s, violating R1's HTTP-only contract. An empty seed shows "No services" until the first filtered snapshot lands within one `servicesPollInterval` (2.5 s), and no unfiltered data can ever reach a client. Probing at construction is also rejected (would block `serve` startup for up to ports × timeout / pool). — *Correction*: the original plan seeded the unfiltered enumeration on the premise that "nothing reads the pre-tick snapshot over SSE (the hub broadcasts on ticks)" — that premise was WRONG: the hub's first poll pass reads and broadcasts the snapshot immediately, before the first tick. — *Rejected*: unfiltered constructor seed (leaks non-HTTP ports via the immediate first SSE pass); blocking probe in the constructor (startup latency).

## Tasks

### Phase 1: Backend probe layer

- [x] T001 Add the HTTP probe seam in a new `app/backend/internal/ports/probe.go`: a package-var `probePort func(ctx context.Context, port int) bool` whose default issues `GET http://127.0.0.1:{port}/` via an `http.Client` with `Timeout` ~750 ms and `CheckRedirect` returning `http.ErrUseLastResponse`, discarding+closing the body, returning `true` on any well-formed response (any status) and `false` on any client error/timeout. Add named constants for the timeout and pool cap. <!-- R2 R3 -->
- [x] T002 Add a per-port TTL probe cache to `Collector` in `app/backend/internal/ports/collector.go`: a `map[int]probeEntry{httpOK bool; at time.Time}` guarded by a mutex (or reuse `c.mu` carefully) plus a `probeTTL` constant (~10 s), following the `cwdExistsCache` idiom. <!-- R4 -->
- [x] T003 Rewrite `collect()` in `app/backend/internal/ports/collector.go` to: enumerate via `readListeningPorts()`, determine which enumerated ports need probing (no cache entry OR stale), probe those in parallel under a bounded semaphore pool (cap ~10, `tmux.ListServers` precedent), merge with fresh cache hits, evict cache entries for ports no longer listening, and store the filtered HTTP-only slice as the snapshot (sorted ascending, never nil). Preserve each `Service`'s platform-populated `Process`/`PID`. `NewCollector` MUST seed an EMPTY snapshot (`ServicesSnapshot{Services: []Service{}}`, the `metrics.Collector` zero-value-seed precedent) — NOT the unfiltered enumeration: the SSE hub's poll-loop body runs immediately (its wait sits at the loop END, `api/sse.go` `waitForNext`) and caches/broadcasts `Snapshot()` before the collector's first ticker fire, so an unfiltered seed leaks non-HTTP ports to any client connecting in the first ~2.5 s, violating R1. Correct Design Decision 2's text accordingly. <!-- R1 R4 R5 R6 --> <!-- rework: review must-fix — unfiltered NewCollector seed reaches SSE clients via the hub's immediate first poll pass + cachedServicesJSON replay; seed empty instead (verified against api/sse.go:942-993) -->

### Phase 2: Frontend denylist removal

- [x] T004 In `app/frontend/src/components/server-list-page.tsx`: delete `NON_HTTP_PORTS` and `isLikelyHttpPort()` (lines ~13–37), remove the `!isLikelyHttpPort(port)` guard in `handleOpenInWindow`, change the button `disabled` to `servers.length === 0` only, simplify the `title` to the two-way (`servers.length === 0 ? "Create a server first" : undefined`), and update the SERVICES section comment to describe the probe-backed contract. <!-- R8 R9 R10 -->

### Phase 3: Tests

- [x] T005 Add probe-layer + TTL-cache Go tests in `app/backend/internal/ports/` (platform-agnostic `_test.go`, no build tag). Cover: an `httptest.Server` responder is retained; a non-2xx (404/401) responder is retained; a raw `net.Listener` that never responds is filtered via timeout; a closed port is filtered; a redirect (302) is retained and not followed. TTL-cache behavior via the `probePort` seam: fresh result reused (no re-probe), stale result re-probed, vanished port evicted. Bounded-pool concurrency (N hanging ports ≈ one timeout). <!-- R1 R2 R3 R4 R5 -->
- [x] T006 Update `app/frontend/src/components/server-list-page.test.tsx`: remove the two denylist tests ("disables … for a well-known non-HTTP port" and "gates only the non-HTTP tile") and replace with an always-enabled-when-servers-exist assertion (e.g. a former-denylist port like 5432 renders an ENABLED button when a server exists). Keep the zero-servers-disabled test. <!-- R8 R9 -->

## Execution Order

- T001 and T002 are independent (both are prerequisites for T003).
- T003 depends on T001 + T002.
- T004 is independent of the backend tasks.
- T005 depends on T001–T003; T006 depends on T004.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `collect()` composes `readListeningPorts()` with the probe filter; the snapshot contains only HTTP-answering ports and `Service`/`ServicesSnapshot` wire shape is unchanged (no `http:` field).
- [x] A-002 R2: A well-formed HTTP response of any status (200/404/401/302/400) classifies the port HTTP; client error/timeout/refused classifies it non-HTTP.
- [x] A-003 R3: The probe issues `GET http://127.0.0.1:{port}/` with a ~750 ms timeout, does not follow redirects, and discards+closes the body.
- [x] A-004 R4: Probe results live in a ~10 s per-port TTL cache; new ports probed on first sight, fresh results reused, stale re-probed, vanished ports evicted.
- [x] A-005 R5: In-cycle probes run under a bounded semaphore pool (cap ~10).
- [x] A-006 R6: The probe filter lives in shared code applied after the per-platform seam; `collector_{linux,darwin,other}.go` are unchanged and `other` degrades to an empty no-op.
- [x] A-007 R7: `event: services` SSE broadcast and `servicesPollInterval` are functionally unchanged; `Services` stays never-nil (`[]` not `null`).
- [x] A-008 R8: `NON_HTTP_PORTS`, `isLikelyHttpPort()`, and the `handleOpenInWindow` guard are removed from `server-list-page.tsx`.
- [x] A-009 R9: "Open in window" is enabled whenever `servers.length > 0` and disabled only when zero servers exist.
- [x] A-010 R10: The SERVICES comment describes the probe-backed contract; empty state stays `No services`; `types.ts` unchanged.

### Behavioral Correctness

- [x] A-011 R4: An enumerated port with a fresh cached probe verdict issues NO new probe request within the TTL window (verified by seam call-count).
- [x] A-012 R3: A 302 responder is retained (redirect not followed) — the 302 itself is a well-formed HTTP response.

### Scenario Coverage

- [x] A-013 R1: A Go test with an `httptest.Server` (retained) alongside a never-responding raw listener (filtered) and a closed port (filtered) passes.
- [x] A-014 R9: A frontend test asserts a former-denylist port (e.g. 5432) renders an enabled "Open in window" button when a server exists.

### Edge Cases & Error Handling

- [x] A-015 R2: A raw listener that accepts but never sends a valid HTTP response is filtered via probe timeout, not a hang (bounded by the per-request timeout).
- [x] A-016 R6: The `other` build path (empty enumeration) produces an empty snapshot with no probe requests.

### Code Quality

- [x] A-017 Pattern consistency: The probe seam follows the `lsofRun`/`ghExec` package-var idiom; the TTL cache follows `cwdExistsCache`; the bounded pool follows `tmux.ListServers`; no shell strings, `net/http` only.
- [x] A-018 No unnecessary duplication: The probe filter is written once in shared collector code, not duplicated per platform; existing `Service`/`ServicesSnapshot`/`Snapshot()` machinery is reused.
- [x] A-019 No magic numbers: The probe timeout, TTL, and pool cap are named constants.

### Security

- [x] A-020 R3: The probe targets only loopback `127.0.0.1:{port}` with no user-controlled input in the request (port comes from procfs/lsof enumeration); no shell execution is introduced (Constitution I).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/ports/collector_linux.go:43` (`sort.Slice` in `readListeningPorts`) — the shared `collect()` now sorts the filtered snapshot at the publish boundary (collector.go), making the per-platform ascending sort redundant on the collector path; left in place because R6 froze `collector_{linux,darwin,other}.go` in this change (removing it would also require updating platform parser tests that assert sorted output).
- `app/backend/internal/ports/collector_darwin.go:95` (`sort.Slice` in `parseLsof`) — same redundancy as the Linux sort: `collect()` re-sorts after the probe filter; frozen by R6 in this change, flagged for a human to remove later.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Probe seam is a package-var `probePort func(ctx, port) bool` with a default `net/http` implementation, mirroring `lsofRun`/`ghExec` | Established codebase idiom for an injectable subprocess/network seam; lets platform-agnostic tests stub the probe deterministically | S:60 R:80 A:85 D:75 |
| 2 | Confident | `NewCollector` seeds an EMPTY snapshot (`[]Service{}`, metrics.Collector precedent); the probe filter produces the first real list from the first `collect()` tick onward | The SSE hub reads + broadcasts + caches `Snapshot()` on its FIRST poll pass, before the collector's first tick — an unfiltered seed would leak non-HTTP ports to early clients (R1 violation); an empty seed shows "No services" until the first filtered snapshot lands within one 2.5 s interval. Probing in the constructor is also rejected (blocks `serve` startup) | S:45 R:75 A:70 D:60 |
| 3 | Confident | TTL cache stores `{httpOK bool, at time.Time}` per port; stale = `now - at > probeTTL`; eviction rebuilds the cache to only currently-listening ports each cycle | Directly implements the intake's decoupled-cadence design; matches the `cwdExistsCache` TTL idiom | S:55 R:80 A:80 D:70 |
| 4 | Certain | Concrete values: probe timeout 750 ms, TTL 10 s, pool cap 10 — as named constants | Values specified verbatim in the intake (assumptions #4, #5) and per the `tmux.ListServers` cap-10 precedent | S:75 R:85 A:90 D:85 |
| 5 | Confident | Go probe tests are platform-agnostic (`probe_test.go` / `collector_probe_test.go`, no build tag) using real `httptest.Server`/`net.Listener` plus the `probePort` seam for TTL/pool behavior | `net/http` loopback works on every platform; matches how `collector_test.go` (untagged) already tests shared collector behavior | S:60 R:85 A:80 D:75 |
| 6 | Confident | Frontend keeps the zero-servers-disabled test and the existing create/fetch/reuse tests; only the two denylist-specific tests are replaced with an always-enabled assertion | Those two tests assert behavior R8/R9 explicitly remove; the rest exercise the unchanged open-in-window flow | S:65 R:85 A:85 D:80 |

6 assumptions (1 certain, 5 confident, 0 tentative).
