# Intake: Passive Port Tiles — Remove Ambient HTTP Probe, Show All Listening Ports, Linux Process Attribution

**Change**: 260715-vfcz-passive-ports-process-attribution
**Created**: 2026-07-15

## Origin

> Remove the ambient HTTP probe from the ports collector; enumerate listening ports passively and show all of them on the Cockpit SERVICES zone, with process attribution on Linux.

Dispatched promptless by `/fab-proceed` from a live discussion session — the change description was synthesized from that session. All major decisions below were made interactively in that session and are user-confirmed unless marked otherwise; no questions were asked at intake (promptless dispatch). Key user-confirmed decisions: (1) delete the ambient probe entirely, (2) show ALL listening ports ("be happy with the output of lsof" — explicitly accepting many more tiles on the Cockpit), (3) add process attribution on Linux so unfiltered tiles are legible (`node :3000`, `sshd :22`), (4) keep the "Open in window" affordance on every tile with no probe-on-demand machinery (the iframe load itself is the on-demand probe).

## Why

1. **The pain**: `internal/ports` (app/backend/internal/ports/) enumerates listening TCP ports every 2.5s and issues `GET http://127.0.0.1:{port}/` to every newly-seen port within one tick (probe.go, `probePort`), re-probing every 10s (`probeTTL`, collector.go:49), to filter the Cockpit SERVICES tiles to HTTP-responders only. This unsolicited probing **breaks one-shot local servers**: `gcloud auth login` runs a local OAuth callback server that handles exactly one request — run-kit's probe consumes it before the browser redirect arrives and the login fails. The pattern is general: `gh auth login`, `aws sso login`, debugger attach ports, any CLI OAuth flow.
2. **No safe cadence exists**: the FIRST probe is the killer, so probing-cadence tuning, age gates, TTL changes, and port denylists were all rejected — a one-shot server is consumed on first contact, and denylists are whack-a-mole. Process-name allowlists were also rejected (gcloud's callback server is python; so are countless dev servers). Probe-on-demand was rejected as needless machinery: opening the iframe IS the on-demand probe, user-initiated and visible.
3. **Collateral damage even when nothing breaks**: the probe spams every local dev server's access log with a request every 10s and can defeat idle-shutdown timers.
4. **Philosophy**: the probe violates the project's derive-don't-interact ethos (Constitution II — state is *derived* at request time): it actively mutates other programs' state. Removing it makes the collector purely observational (procfs read / lsof), consistent with every other collector in the codebase.
5. **The consequence of not fixing**: run-kit silently sabotages routine CLI auth flows on any box it runs on — a trust-destroying failure mode that looks like a Google/GitHub outage, not a run-kit bug.

## What Changes

### 1. Delete the ambient HTTP probe (backend, `app/backend/internal/ports/`)

- **Delete `probe.go` entirely**: `probeTimeout`, `probeConcurrency`, `probeTransport`, `probeClient`, and the `probePort` seam all go.
- **`collector.go` loses the verdict machinery**: `probeTTL` (collector.go:49), `probeEntry`, the `probeCache` map, the injectable `now` clock (existed only for TTL tests), and the whole `probeVerdicts()` method (cache split, bounded-semaphore parallel probe, cache rebuild/eviction). `collect()` becomes **enumerate → sort → publish**: call `readListeningPortsFn()`, sort by port ascending, take the lock, publish. (`collect`'s `ctx` parameter existed only for probes — it may drop; `poll` still honors `ctx.Done()`.)
- **Package doc comment rewritten** (collector.go:1-14): it currently promises "filters them to only those that answer HTTP" and documents the probe filter — the package becomes a passive enumerator (procfs on Linux, lsof on darwin, empty elsewhere) with best-effort process attribution.
- **The `NewCollector` empty-seed subtlety dissolves** (collector.go:74-92): the empty initial snapshot exists *solely* so no unfiltered data reaches an SSE client before the first probe pass (the R1 HTTP-only contract). With the filter gone there is no contract to protect. Perform an **initial synchronous `collect()` at `Start`** so the very first SSE broadcast (which the hub caches in `cachedServicesJSON` and replays to every new client, api/sse.go:376-378) carries real data instead of a ~2.5s "No services" gap. <!-- see Assumptions #7 -->

### 2. Show ALL listening ports (deliberate contract reversal)

- The published snapshot is now the **full passive enumeration** — every listening TCP port, HTTP or not (Postgres, Redis, SSH, …). The user explicitly accepts that this means many more port tiles on the Cockpit page.
- This **reverses the deliberate `260703-8y2a-cockpit-http-only-services` requirement** (the collector's "R1" HTTP-only contract). Note for review/hydrate: that change also deleted the frontend `NON_HTTP_PORTS` denylist / `isLikelyHttpPort` heuristic — the denylist **stays deleted**; the all-ports display needs no gate of any kind, client or server.
- Sorting stays port-ascending in the backend snapshot (existing behavior, minus the filter step).

### 3. Linux process attribution

Today `collector_linux.go` parses `/proc/net/tcp{,6}` and returns bare `Service{Port}` (empty `Process`/`PID`); only darwin's lsof path fills them (collector_darwin.go `parseLsof`).

- **Mechanism**: run `lsof` on Linux too, sharing one parser with the darwin path — the user's words ("just be happy with the output of lsof") make this the natural reading. Move `parseLsof`/`parseLsofPort` and the `lsofRun` seam out of the darwin-only file into a shared file compiled on both platforms (e.g. `lsof.go`, build tag `linux || darwin`), leaving darwin's `readListeningPorts` behavior unchanged.
- **Join, don't replace, on Linux**: procfs (`/proc/net/tcp{,6}`) remains the **authoritative port set**; lsof output is joined by port to attribute what it can. This is load-bearing: a non-root `lsof` only sees the invoking user's processes on Linux, so an lsof-*only* Linux enumeration would silently drop root-owned listeners (`sshd :22`) — violating confirmed decision 2 (show ALL ports). Ports lsof cannot attribute render bare (`:{port}` with no process), exactly like every Linux tile today. Attribution is best-effort by design; `Service.Process`/`PID` are already documented as best-effort zero-values (collector.go:26-30).
- **Constitution I**: the Linux `lsofRun` MUST mirror darwin's — `exec.CommandContext` with the 5s `lsofTimeout`, explicit argument slice (`lsof -nP -iTCP -sTCP:LISTEN -FpcPn`), no shell string, no user input in argv.
- **Degradation**: lsof missing/failing on Linux degrades to bare procfs ports (attribution join yields nothing) — the enumeration itself is unaffected. Mirrors the package's zero-on-error discipline.
- **Rejected alternative**: a dependency-free `/proc/[pid]/fd` socket-inode walk. Same non-root visibility limits as lsof, avoids the lsof binary dependency, but requires bespoke inode-matching code where a proven shared parser already exists. Recorded as a design decision for the plan. <!-- see Assumptions #4 -->

### 4. Frontend — Cockpit SERVICES zone (`app/frontend/src/components/server-list-page.tsx`)

- **Tile rendering already surfaces attribution**: each tile renders `:{port}` plus `svc.process` when present (server-list-page.tsx:386-393), and `types.ts` `Service` is already `{ port, process?, pid? }` — Linux attribution lights up with **zero type or rendering changes**. Verify the tile presents well with attribution (e.g. `:3000 node`), adjusting only if needed.
- **Stale comment block rewritten** (server-list-page.tsx:365-373): it currently documents "every tile here provably speaks HTTP". New truth: tiles are ALL listening ports with best-effort attribution; opening a non-HTTP port yields a failed iframe — user-initiated, visible, harmless.
- **"Open in window" unchanged on every tile** (user-confirmed): still gated solely on a tmux server existing, still `createWindow(..., "iframe", "/proxy/{port}/")`. No probe-on-demand, no disabled states, no tooltip gating.
- **De-emphasize root-owned/system listeners** *(proposed in discussion, not explicitly user-confirmed — treat per SRAD, see Assumptions #5)*: with unfiltered tiles, visually de-emphasize system/infra listeners the way infra servers are de-emphasized (`isInfraServer`/`compareServers` in client.ts — grey `text-text-secondary`, sorted last as a class, presentation-only in the frontend). Candidate criterion: unattributed tiles and/or well-known ports (< 1024); the `/proc/net/tcp` `uid` column is also available server-side if ownership data is wanted. Exact criterion is decided at apply; keep the scope modest and presentation-only (backend snapshot stays port-sorted).

### 5. SSE / API — no schema change

- The `event: services` broadcast payload shape is unchanged: `ServicesSnapshot{services: [{port, process?, pid?}]}` — `Process`/`PID` are already `omitempty` JSON fields (collector.go:26-30), and the frontend already parses/dedups them (`applyHostServices`, session-context.tsx). The broadcast/caching path (api/sse.go `cachedServicesJSON`, router.go:387 `ports.NewCollector(servicesPollInterval)` wiring) is untouched apart from comment accuracy.
- `useHostServices()` consumers need no plumbing changes — the zone simply receives more (and better-attributed) rows.

### 6. Tests

- `probe_test.go`: **delete** (covers only the probe seam).
- `collector_test.go`: remove probe-verdict/TTL-cache/parallel-probe/eviction cases; keep or reshape enumerate→sort→publish, `Snapshot()` copy semantics, and the seed behavior test (updated for the initial-collect decision in §1).
- `collector_linux_test.go`: keep procfs parser tests; **add** attribution-join tests (procfs set ∪ lsof attribution; unattributed ports render bare; lsof-missing degradation).
- `collector_darwin_test.go`: `parseLsof`/`parseLsofPort` tests move with the shared parser (platform-agnostic file so both platforms run them); darwin-specific enumeration behavior stays.
- Frontend: `server-list-page.test.tsx` SERVICES-zone assertions updated (attributed tile rendering; de-emphasis if included). UI changes SHOULD include Playwright e2e coverage per code-quality.md; any touched `.spec.ts` updates its sibling `.spec.md` (constitution Test Companion Docs); e2e runs only via `just test-e2e` / `just pw`.

### Cross-cutting constraints

- **Constitution I** (exec.CommandContext + timeout + argv slice) governs the new Linux lsof call; **Constitution II** (derive, don't interact) is the philosophical driver — this change removes the codebase's only ambient interaction with foreign processes; **Constitution IV**: no new routes or pages.
- **Hydrate obligation**: `docs/memory/run-kit/architecture.md` (§ `internal/ports` — described as "listening-HTTP-services collector with HTTP-probe filter") and `docs/memory/run-kit/ui-patterns.md` (§ SERVICES Zone on `/` — "probe-backed", "HTTP gate is now server-side", "Linux is port-only" paragraphs) both describe the superseded probe filter and MUST record the supersession.

## Affected Memory

- `run-kit/architecture.md`: (modify) `internal/ports` section — probe filter removed (supersedes 260703-8y2a's R1 HTTP-only contract and the NewCollector empty-seed rationale); passive enumerate→sort→publish; shared lsof parser + Linux attribution join; initial-collect seed
- `run-kit/ui-patterns.md`: (modify) § SERVICES Zone on `/` — tiles are now ALL listening ports with best-effort process attribution on Linux AND darwin ("Linux is port-only" is superseded); "provably speaks HTTP" / server-side HTTP gate paragraphs superseded; Open-in-window semantics on non-HTTP ports; de-emphasis treatment if shipped

## Impact

- **Backend**: `app/backend/internal/ports/` — `probe.go` (delete), `collector.go` (collect/seed/doc), `collector_linux.go` (attribution join), `collector_darwin.go` (parser extraction), new shared `lsof.go`; `collector_other.go` unchanged. `api/sse.go` / `api/router.go` / `api/proxy.go`: behavior untouched (comment accuracy only).
- **Frontend**: `app/frontend/src/components/server-list-page.tsx` (+ its test) — comment rewrite, optional de-emphasis; `types.ts`, `session-context.tsx`: no changes.
- **Tests**: 4 backend test files reshaped (one deleted), frontend unit test updated, possible e2e touch.
- **No API surface, route, schema, or config changes.** No new dependencies beyond invoking `lsof` on Linux (already the darwin pattern; degrades gracefully when absent).
- **Behavioral blast radius**: Cockpit SERVICES zone shows substantially more tiles (accepted); ambient loopback HTTP traffic from run-kit stops entirely — one-shot OAuth callback servers, dev-server access logs, and idle-shutdown timers are no longer touched.

## Open Questions

- None — all Unresolved-grade decisions were resolved in the originating discussion; the one unconfirmed proposal (system-listener de-emphasis) is carried as a Confident assumption (#5), not a blocker.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete the ambient probe entirely — probe.go and the probeVerdicts/probeCache/probeTTL machinery; collector becomes enumerate → sort → publish | User-confirmed decision 1; "there is NO safe probing cadence — the first probe is the killer" | S:95 R:75 A:90 D:95 |
| 2 | Certain | Show ALL listening ports on the Cockpit SERVICES zone, accepting many more tiles; supersedes the 260703-8y2a HTTP-only (R1) contract; no denylist returns | User-confirmed decision 2 — "be happy with the output of lsof", tile volume explicitly accepted | S:90 R:85 A:85 D:90 |
| 3 | Certain | Keep "Open in window" on every tile, gated only on server existence; probe-on-demand rejected — the iframe load is the on-demand probe | User-confirmed decision 4; failed iframe on a non-HTTP port is user-initiated, visible, harmless | S:95 R:90 A:90 D:95 |
| 4 | Confident | Linux attribution = lsof joined onto the authoritative procfs port set, sharing darwin's parseLsof (shared lsof.go); NOT lsof-only enumeration (non-root lsof hides root-owned listeners, violating #2); NOT a /proc/*/fd inode walk | User's words point at lsof; darwin parser exists to share; the join preserves the confirmed all-ports contract; walk is the noted dependency-free alternative | S:70 R:80 A:80 D:60 |
| 5 | Confident | De-emphasize root-owned/system listeners on Cockpit tiles (grey secondary text / sorted-last, mirroring isInfraServer de-emphasis), exact criterion decided at apply; presentation-only | Proposed in discussion, NOT explicitly user-confirmed; trivially reversible presentation choice with an established in-repo pattern | S:40 R:85 A:60 D:45 |
| 6 | Certain | SSE `event: services` payload shape unchanged — Service already carries omitempty process/pid; frontend types.ts already optional; tile already renders svc.process | Verified in code: collector.go:26-30, server-list-page.tsx:386-393, session-context.tsx applyHostServices | S:85 R:90 A:95 D:95 |
| 7 | Confident | NewCollector's empty-seed rationale dissolves; add an initial synchronous collect() at Start so the first SSE broadcast carries real data (pre-tick "No services" gap no longer load-bearing) | Design inference — either seed is safe once the filter contract is gone; the collector comment itself scopes the empty seed to the R1 contract | S:55 R:90 A:85 D:65 |
| 8 | Certain | Enumeration cadence (2.5s servicesPollInterval) and collector_other.go (empty on unsupported platforms) unchanged | Not discussed; no reason to change; pure keep-the-default | S:70 R:95 A:90 D:85 |
| 9 | Certain | Test reshaping: probe_test.go deleted; probe/TTL cases removed from collector_test.go; parseLsof tests relocated with the shared parser; attribution-join + lsof-degradation tests added; frontend tile tests updated | Mechanical consequence of #1–#4; the four affected backend test files are named in the change description | S:85 R:90 A:90 D:90 |
| 10 | Confident | Change type pinned `feat` (explicit source, survives refresh re-inference) — a behavior redesign adding capability (attribution, all-ports view), though motivated by a breakage | Taxonomy judgment call (feat vs fix defensible either way); the flat 3.0 intake gate is type-independent | S:60 R:95 A:85 D:55 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
