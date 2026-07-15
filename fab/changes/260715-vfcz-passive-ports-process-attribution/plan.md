# Plan: Passive Port Tiles — Remove Ambient HTTP Probe, Show All Listening Ports, Linux Process Attribution

**Change**: 260715-vfcz-passive-ports-process-attribution
**Intake**: `intake.md`

## Requirements

### Ports Collector: Passive Enumeration

#### R1: The collector SHALL enumerate listening ports without any ambient network probing
The `internal/ports` collector MUST NOT issue any outbound request (HTTP or otherwise) to any listening port. Enumeration is purely observational — procfs read on Linux, `lsof` subprocess on darwin, empty elsewhere. `probe.go` and all verdict machinery (`probeTTL`, `probeEntry`, `probeCache`, the injectable `now` clock, `probeVerdicts`) are removed.

- **GIVEN** a one-shot local server (e.g. a `gcloud auth login` OAuth callback listener) bound on a loopback port
- **WHEN** the collector's poll goroutine ticks while that port is listening
- **THEN** the collector reads the port from the enumeration source and publishes it WITHOUT connecting to it (the one-shot server is never consumed)

#### R2: `collect()` becomes enumerate → sort → publish
`collect()` MUST call `readListeningPortsFn()`, sort the result by port ascending, take the write lock, and publish the snapshot — with no filtering step. The `ctx` parameter, which existed only for probes, MAY be dropped from `collect()`'s signature; `poll` still honors `ctx.Done()`.

- **GIVEN** the enumeration returns ports {5432, 8080, 3000}
- **WHEN** `collect()` runs one cycle
- **THEN** the published snapshot is exactly [3000, 5432, 8080] (all ports, sorted ascending, none filtered)

#### R3: The published snapshot contains ALL listening ports (contract reversal)
The snapshot MUST contain every listening TCP port regardless of whether it speaks HTTP, superseding the `260703-8y2a` R1 HTTP-only contract. No denylist or HTTP gate returns anywhere — neither client nor server.

- **GIVEN** Postgres (5432), Redis (6379), and an HTTP dev server (3000) are all listening
- **WHEN** the collector publishes a snapshot
- **THEN** all three ports appear as tiles (5432, 6379, 3000), not just the HTTP responder

#### R4: The initial snapshot carries real data via a synchronous collect at Start
`NewCollector` no longer needs the empty-seed defence (the HTTP-only contract it protected is gone). `Start` MUST perform an initial synchronous `collect()` before launching the poll goroutine, so the first SSE broadcast (cached in `cachedServicesJSON` and replayed to every new client) carries the real enumeration rather than a ~2.5s "No services" gap. `Snapshot()` remains never-nil (marshals to `{"services":[]}`, never `null`).

- **GIVEN** a fresh `Collector` whose enumeration returns {8080}
- **WHEN** `Start(ctx)` is called and then `Snapshot()` is read
- **THEN** the snapshot already contains [8080] (populated synchronously at Start, before the first tick)

### Ports Collector: Linux Process Attribution

#### R5: `parseLsof` / `parseLsofPort` / `lsofRun` move to a shared file compiled on Linux and darwin
The lsof parser (`parseLsof`, `parseLsofPort`) and the `lsofRun` subprocess seam MUST move out of the darwin-only `collector_darwin.go` into a shared file (`lsof.go`) with build tag `//go:build linux || darwin`. Darwin's `readListeningPorts` behavior (lsof-only enumeration with attribution) is unchanged.

- **GIVEN** the darwin build
- **WHEN** `readListeningPorts` runs on macOS
- **THEN** its output is byte-identical to the pre-change behavior (lsof enumeration, first-process-wins dedup, port-sorted, attribution populated)

#### R6: Linux joins lsof attribution onto the authoritative procfs port set
On Linux, procfs (`/proc/net/tcp{,6}`) MUST remain the authoritative port source. `lsofRun` runs additionally (Constitution I: `exec.CommandContext`, 5s `lsofTimeout`, explicit argv `lsof -nP -iTCP -sTCP:LISTEN -FpcPn`, no shell string, no user input) and its parsed attribution is JOINED by port onto the procfs set. Ports that lsof cannot attribute render bare (`Process`/`PID` zero-valued), exactly like today's Linux tiles.

- **GIVEN** procfs reports listening ports {22, 3000} and non-root lsof can attribute only {3000 → node} (sshd on :22 is root-owned and invisible to non-root lsof)
- **WHEN** Linux `readListeningPorts` runs
- **THEN** the result is [{22}, {3000, node, pid}] — :22 still present (bare, from procfs), :3000 attributed (from the join)

#### R7: lsof missing/failing on Linux degrades to bare procfs ports
If `lsofRun` fails or is absent on Linux, the attribution join yields nothing and the enumeration itself is unaffected — the full procfs port set is still published with all ports bare. Mirrors the package's zero-on-error discipline.

- **GIVEN** `lsof` is not installed on the Linux host
- **WHEN** `readListeningPorts` runs and procfs reports {5432, 8080}
- **THEN** the result is [{5432}, {8080}] (both bare, no attribution, no error surfaced)

### Frontend: Cockpit SERVICES Zone

#### R8: The SERVICES zone renders all listening ports with best-effort attribution
`server-list-page.tsx` MUST render one tile per service showing `:{port}` (mono) plus `svc.process` when present. This already works with the current type/rendering; the requirement is to verify it presents well with attribution now flowing on Linux too, adjusting only if needed. `types.ts` `Service` (`{ port, process?, pid? }`) and the SSE payload shape are unchanged.

- **GIVEN** the backend broadcasts `[{port:3000, process:"node"}, {port:22}]`
- **WHEN** the Cockpit SERVICES zone renders
- **THEN** it shows a `:3000 node` tile and a bare `:22` tile, each with an "Open in window" button gated solely on server existence

#### R9: The stale "provably speaks HTTP" comment block is rewritten
The comment block at `server-list-page.tsx:365-373` currently documents "every tile here provably speaks HTTP" and a "probe filter". It MUST be rewritten to state: tiles are ALL listening ports with best-effort process attribution; opening a non-HTTP port yields a failed iframe — user-initiated, visible, harmless. The "Open in window" affordance is unchanged (gated solely on a tmux server existing; still `createWindow(..., "iframe", "/proxy/{port}/")`).

- **GIVEN** a reader of `server-list-page.tsx`
- **WHEN** they read the SERVICES-zone comment
- **THEN** it describes passive all-ports enumeration with best-effort attribution, with no claim that tiles provably speak HTTP

#### R10: System/infra listeners are visually de-emphasized (presentation-only)
With unfiltered tiles, well-known system/infra listeners SHOULD be visually de-emphasized, mirroring the `isInfraServer` de-emphasis pattern (grey `text-text-secondary`, sorted after regular tiles as a class). The criterion is well-known ports (`port < 1024`), a modest presentation-only choice. The backend snapshot stays port-sorted; de-emphasis is a frontend concern applied at render.

- **GIVEN** the snapshot is `[{port:22, process:"sshd"}, {port:3000, process:"node"}, {port:8080}]`
- **WHEN** the SERVICES zone renders
- **THEN** :3000 and :8080 (regular, port-ascending) render before :22 (well-known, de-emphasized grey), and every tile still renders with its "Open in window" button

### Backend Wiring: Comment Accuracy Only

#### R11: SSE/API broadcast and caching path is behaviorally untouched (comment accuracy only)
The `event: services` broadcast, `cachedServicesJSON` caching/replay (`api/sse.go`), and `ports.NewCollector(servicesPollInterval)` wiring (`api/router.go`) MUST NOT change behavior. The collector package doc comment (`collector.go:1-14`) is rewritten to describe a passive enumerator with best-effort attribution. No API surface, route, schema, or config changes.

- **GIVEN** the existing SSE hub and router wiring
- **WHEN** the change ships
- **THEN** the `event: services` payload shape and broadcast path are identical; only the collector's package doc (and any now-stale inline comments) reflect the passive-enumeration reality

### Non-Goals

- No probe-on-demand machinery — opening the iframe IS the on-demand probe (user-initiated, visible).
- No `/proc/[pid]/fd` inode-walk attribution — the shared lsof parser already exists (Design Decision below).
- No change to the 2.5s `servicesPollInterval` cadence or `collector_other.go` (empty on unsupported platforms).
- No backend sort change for de-emphasis — de-emphasis is frontend presentation only.

### Design Decisions

1. **Linux attribution = lsof JOINED onto procfs, not lsof-only enumeration**: procfs stays the authoritative port set; lsof attributes what it can. — *Why*: a non-root `lsof` sees only the invoking user's processes on Linux, so lsof-only enumeration would silently drop root-owned listeners (sshd :22), violating R3 (show ALL ports). — *Rejected*: lsof-only Linux enumeration (drops root-owned listeners); a dependency-free `/proc/[pid]/fd` socket-inode walk (same non-root limits, but bespoke inode-matching where a proven shared parser already exists).
2. **Initial synchronous collect() at Start (not a lazy empty seed)**: — *Why*: the empty-seed rationale existed solely to protect the now-removed HTTP-only contract; a synchronous first collect means the replayed `cachedServicesJSON` carries real data. — *Rejected*: keeping the empty seed (leaves a ~2.5s "No services" gap on the first broadcast for no contract benefit).
3. **De-emphasis criterion = well-known ports (`port < 1024`)**: — *Why*: modest, deterministic, needs no extra backend data, and maps cleanly to "system/infra listener"; mirrors the existing `isInfraServer` grey/sorted-last presentation. — *Rejected*: unattributed-tile de-emphasis (a legitimate high dev-server port with failed attribution would be wrongly greyed); server-side `uid`-column ownership (adds backend surface for a presentation-only choice).

### Deprecated Requirements

#### 260703-8y2a R1: HTTP-only SERVICES contract
**Reason**: the ambient HTTP probe that enforced it breaks one-shot local servers (OAuth callbacks) on first contact — there is no safe probing cadence. User-confirmed reversal.
**Migration**: the collector now publishes ALL listening ports passively; a non-HTTP tile opened via "Open in window" yields a harmless failed iframe (user-initiated, visible). No denylist returns; the `260703-8y2a` frontend `NON_HTTP_PORTS`/`isLikelyHttpPort` deletion stays deleted.

## Tasks

### Phase 1: Backend — Delete the probe

- [x] T001 Delete `app/backend/internal/ports/probe.go` entirely (`probeTimeout`, `probeConcurrency`, `probeTransport`, `probeClient`, `probePort`). <!-- R1 -->
- [x] T002 Delete `app/backend/internal/ports/probe_test.go` entirely (it covers only the probe seam). Relocate the still-needed test helpers (`withStubEnum`, `portsOf`, `equalInts`) into `collector_test.go` since `collector_test.go` depends on them. <!-- R1 -->

### Phase 2: Backend — Passive collector

- [x] T003 In `app/backend/internal/ports/collector.go`: rewrite the package doc comment (lines 1-14) to describe a passive enumerator (procfs on Linux, lsof on darwin, empty elsewhere) with best-effort process attribution and no HTTP probe/filter. <!-- R11 -->
- [x] T004 In `collector.go`: remove `probeTTL`, `probeEntry`, the `probeCache` map field, the injectable `now` clock field, and the whole `probeVerdicts()` method. Rewrite `collect()` to enumerate → sort → publish (`readListeningPortsFn()` → sort ascending → lock → publish), dropping the now-unused `ctx` parameter; `poll` still honors `ctx.Done()`. <!-- R2 -->
- [x] T005 In `collector.go`: strip the empty-seed rationale from `NewCollector` (still constructs a non-nil zero-length slice so `Snapshot()` marshals to `{"services":[]}` before Start), and change `Start` to run an initial synchronous `collect()` before launching the poll goroutine. Update the `Service` doc comment which says attribution is "left zero-valued until process attribution is added" (attribution now lands on both platforms; Linux ports may still be bare when lsof can't attribute them). <!-- R4 --> <!-- rework: review should-fix — Start's synchronous seed runs on the boot path before ListenAndServe (worst case lsofTimeout=5s); document the bounded boot-delay tradeoff in Start's comment (behavior unchanged — R4 mandates the sync seed) -->

### Phase 3: Backend — Shared lsof parser + Linux attribution join

- [x] T006 Create `app/backend/internal/ports/lsof.go` (`//go:build linux || darwin`) and move `parseLsof`, `parseLsofPort`, `lsofRun`, and the `lsofTimeout` const into it from `collector_darwin.go`, preserving behavior verbatim. <!-- R5 -->
- [x] T007 In `collector_darwin.go`: remove the moved symbols, leaving darwin's `readListeningPorts` (lsof-only enumeration with attribution) behaviorally unchanged; adjust imports. <!-- R5 --> <!-- rework: review must-fix (duplicated-logic) — darwin's readListeningPorts inlines the exact run-lsof sequence lsofAttribution() implements (ctx+timeout → lsofRun → partial-output degrade → parseLsof), duplicating the subtle error-semantics comment; delegate to lsofAttribution() then build the sorted slice from the map (byte-identical behavior, empty map → empty non-nil slice, drops the context import) -->
- [x] T008 In `collector_linux.go`: run `lsofRun` (via the shared parser) additionally to procfs and JOIN attribution by port onto the authoritative procfs port set — procfs stays the port source, lsof fills `Process`/`PID` where it can, unattributed ports render bare, and lsof failure/absence degrades to bare procfs ports (zero-on-error). Constitution I governs the lsof call. <!-- R6, R7 -->

### Phase 4: Backend — Tests

- [x] T009 Reshape `app/backend/internal/ports/collector_test.go`: remove probe-verdict / TTL-cache / parallel-probe / eviction cases (`TestCollect_FiltersToHTTPPorts`, `TestCollect_FreshCacheReusedNoReprobe`, `TestCollect_StaleCacheReprobed`, `TestCollect_VanishedPortEvicted`, `TestCollect_BoundedParallelProbes`, `TestNewCollector_InitialSnapshotEmpty`). Add an enumerate→sort→publish test and a Start-does-initial-collect test (Snapshot populated synchronously at Start). Keep `TestSnapshot_ReturnsCopy`, `TestCollector_StartAndStop`, `TestCollector_SnapshotThreadSafety`. <!-- R2, R4 -->
- [x] T010 Move the `parseLsof`/`parseLsofPort` tests from `collector_darwin_test.go` into a shared `app/backend/internal/ports/lsof_test.go` (`//go:build linux || darwin`) so both platforms run them; leave darwin-specific enumeration tests (`TestReadListeningPorts_LsofSeam`) in `collector_darwin_test.go`. <!-- R5 -->
- [x] T011 In `app/backend/internal/ports/collector_linux_test.go`: keep the procfs parser tests; add attribution-join tests (procfs port set ∪ lsof attribution; a port lsof can't attribute renders bare; lsof-missing/failure degrades to bare procfs ports) by stubbing `lsofRun` and `procNetTCPFiles`. <!-- R6, R7 -->

### Phase 5: Frontend

- [x] T012 In `app/frontend/src/components/server-list-page.tsx`: rewrite the SERVICES-zone comment block (lines ~365-373) — tiles are ALL listening ports with best-effort attribution; opening a non-HTTP port yields a harmless user-initiated failed iframe; "Open in window" unchanged (server-existence gate only). Verify the attributed tile (`:{port} process`) presents well. <!-- R8, R9 -->
- [x] T013 In `server-list-page.tsx`: implement well-known-port (`port < 1024`) de-emphasis — grey `text-text-secondary` port text and sort well-known tiles after regular ones as a class (stable within-class by port), mirroring `isInfraServer`. Presentation-only; the SSE snapshot order is untouched. <!-- R10 -->
- [x] T014 Update `app/frontend/src/components/server-list-page.test.tsx` SERVICES-zone assertions: attributed-tile rendering (unchanged, still passes) and add coverage for the well-known-port de-emphasis (grey class + sorted-last ordering). <!-- R8, R10 --> <!-- rework: review should-fix — test name + comment at lines ~239-243 still document the deleted probe contract ("backend now broadcasts only HTTP responders" / "provably HTTP"); rewrite the description to the new rationale (all ports broadcast; iframe load is the on-demand probe); assertions stay -->

## Execution Order

- T001, T002 (Phase 1) precede Phase 2 (collector edits reference the removed probe symbols and helpers).
- T006 (create shared `lsof.go`) precedes T007 (darwin removal) and T008 (Linux join) — both depend on the moved symbols existing in the shared file.
- Phase 4 tests follow their Phase 2/3 implementation tasks.
- Frontend (Phase 5) is independent of the backend phases and may run in parallel, but T013 precedes T014 (test asserts the de-emphasis).

## Acceptance

### Functional Completeness

- [x] A-001 R1: The collector issues no outbound request to any listening port; `probe.go` and all probe machinery are gone (grep for `probePort`/`probeClient`/`probeVerdicts` returns nothing).
- [x] A-002 R2: `collect()` enumerates, sorts ascending, and publishes with no filtering; a test with stubbed enumeration {5432,8080,3000} yields snapshot [3000,5432,8080].
- [x] A-003 R3: A snapshot with Postgres/Redis/HTTP listeners contains all of them (no HTTP gate; no denylist anywhere, client or server).
- [x] A-004 R4: `Start` runs an initial synchronous `collect()`; `Snapshot()` immediately after `Start` returns the enumerated ports, not an empty gap.
- [x] A-005 R5: `parseLsof`/`parseLsofPort`/`lsofRun`/`lsofTimeout` live in a `linux || darwin` shared `lsof.go`; darwin `readListeningPorts` behavior is unchanged.
- [x] A-006 R6: Linux `readListeningPorts` returns the full procfs port set with lsof attribution joined by port; a procfs-only port (root-owned, lsof-invisible) still appears bare.
- [x] A-007 R7: With lsof failing/absent on Linux, the full procfs set is still published, all bare, no error.
- [x] A-008 R8: The SERVICES zone renders one tile per service with `:{port}` primary and `svc.process` secondary when present; "Open in window" gated solely on server existence.
- [x] A-009 R9: The SERVICES-zone comment no longer claims tiles provably speak HTTP; it describes passive all-ports enumeration with best-effort attribution and the harmless-failed-iframe semantics.
- [x] A-010 R11: The `event: services` payload shape and SSE broadcast/caching path are unchanged; only the collector package doc (and stale inline comments) are updated.

### Behavioral Correctness

- [x] A-011 R3: A one-shot loopback server is enumerated and published without being connected to (the probe that consumed it is gone).
- [x] A-012 R10: Well-known ports (`< 1024`) render grey and sorted after regular tiles as a class; regular tiles keep port-ascending order; every tile keeps its "Open in window" button.

### Removal Verification

- [x] A-013 R1: `probe.go` and `probe_test.go` are deleted; no `probeTTL`/`probeEntry`/`probeCache`/`now`-clock/`probeVerdicts` remain in `collector.go`.
- [x] A-014 R1: The `260703-8y2a` frontend `NON_HTTP_PORTS`/`isLikelyHttpPort` deletion is confirmed still-deleted (no client-side HTTP denylist reintroduced).

### Scenario Coverage

- [x] A-015 R6: An attribution-join unit test proves procfs port ∪ lsof attribution (attributed port carries process/pid, procfs-only port bare) via stubbed `lsofRun` + `procNetTCPFiles`.
- [x] A-016 R7: An lsof-degradation unit test proves bare procfs ports when `lsofRun` errors.

### Edge Cases & Error Handling

- [x] A-017 R7: lsof returning partial output with a non-zero exit is still parsed (darwin seam behavior preserved); Linux lsof error degrades to bare ports without dropping the enumeration.
- [x] A-018 R4: `Snapshot()` is never nil — marshals to `{"services":[]}` before Start and after ctx cancellation.

### Code Quality

- [x] A-019 Pattern consistency: New code follows the package's existing naming/structure (seam vars for testability, `//go:build` splits, zero-on-error discipline, port-ascending sort).
- [x] A-020 No unnecessary duplication: The lsof parser is shared (one file, both platforms) rather than duplicated; Linux reuses `parseLsof`/`lsofRun` rather than reimplementing attribution. <!-- re-review 260715 cycle 2: M1 resolved — collector_darwin.go:20-21 now delegates to lsofAttribution() (single run-lsof wrapper at lsof.go:97-109); no duplicated logic remains -->
- [x] A-021 Security (Constitution I): The Linux lsof call uses `exec.CommandContext` with the 5s timeout, an explicit argv slice, no shell string, and no user input in argv.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The hydrate obligation (superseding the probe-filter descriptions in `architecture.md` § `internal/ports` and `ui-patterns.md` § SERVICES Zone) is a hydrate-stage concern, not apply — apply touches source + tests only.
- `api/sse_test.go:232` comment ("pre-fills a valid snapshot") is now slightly stale (the test doesn't call `Start`, so `NewCollector` yields an empty-but-valid snapshot) but the test still verifies its intent (a `"services"` payload arrives); left unchanged to avoid scope creep.

## Deletion Candidates

- `app/backend/internal/ports/collector_darwin.go:26-28` and `app/backend/internal/ports/collector_linux.go:56-58` (per-platform `sort.Slice`) — `collect()` unconditionally re-sorts every snapshot (collector.go:125-127), so the platform-level sorts are redundant on the production path; platform tests currently assert sorted output directly (`TestReadListeningPorts_LsofSeam`, `TestReadListeningPorts_JoinsLsofAttribution`), so removing them would move the sorted-output contract to `collect()`'s tests. (Prior cycle's first candidate — the darwin inline run-lsof block — was deleted by the T007 rework and is no longer listed.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete `probe.go` + all verdict machinery; `collect()` becomes enumerate→sort→publish; drop `collect`'s `ctx` param | Intake Assumption #1 (user-confirmed decision 1) — no safe probing cadence exists | S:95 R:75 A:90 D:95 |
| 2 | Certain | Publish ALL listening ports; supersede the 260703-8y2a HTTP-only contract; no denylist returns anywhere | Intake Assumption #2 (user-confirmed decision 2) — tile volume explicitly accepted | S:90 R:85 A:85 D:90 |
| 3 | Confident | Linux attribution = lsof JOINED onto the authoritative procfs set (not lsof-only, not a /proc/*/fd walk) via a shared `lsof.go` (`linux \|\| darwin`) | Intake Assumption #4 — join preserves the all-ports contract; darwin parser exists to share; walk is the rejected dependency-free alternative | S:70 R:80 A:80 D:60 |
| 4 | Confident | Initial synchronous `collect()` at `Start` (empty-seed rationale dissolves) so the first replayed broadcast carries real data | Intake Assumption #7 — either seed is safe once the filter contract is gone; removes the pre-tick "No services" gap | S:55 R:90 A:85 D:65 |
| 5 | Confident | De-emphasis criterion = well-known ports (`port < 1024`), grey `text-text-secondary` + sorted-last-as-a-class, mirroring `isInfraServer`; presentation-only, backend snapshot stays port-sorted | Intake Assumption #5 leaves the exact criterion to apply — `< 1024` is the standard "system/reserved" boundary, deterministic, needs no extra backend data, and avoids wrongly greying a high dev port with failed attribution | S:45 R:85 A:65 D:55 |
| 6 | Certain | SSE `event: services` payload shape unchanged; frontend `Service` type + tile rendering already surface `svc.process` — Linux attribution lights up with zero type/render changes | Intake Assumption #6 — verified in code (collector.go:26-30, types.ts Service, server-list-page.tsx:386-393) | S:85 R:90 A:95 D:95 |
| 7 | Certain | Relocate the shared test helpers (`withStubEnum`, `portsOf`, `equalInts`) from the deleted `probe_test.go` into `collector_test.go`; move `parseLsof`/`parseLsofPort` tests into a shared `lsof_test.go` (`linux \|\| darwin`); keep `TestReadListeningPorts_LsofSeam` darwin-only | Intake Assumption #9 + code fact: `collector_test.go` depends on those helpers, which currently live in `probe_test.go`; deleting it without relocating them breaks compilation | S:85 R:90 A:90 D:90 |
| 8 | Certain | `servicesPollInterval` (2.5s) and `collector_other.go` (empty on unsupported platforms) unchanged | Intake Assumption #8 — pure keep-the-default | S:70 R:95 A:90 D:85 |
| 9 | Confident | `api/sse_test.go:232`'s "pre-fills a valid snapshot" comment left unchanged despite being mildly stale under the Start-does-initial-collect change | The test never calls `Start`, still asserts a `"services"` payload arrives, and passes unchanged; editing an unrelated test comment is scope creep for zero behavioral value | S:60 R:95 A:80 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative).
