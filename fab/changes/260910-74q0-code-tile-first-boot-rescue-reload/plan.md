# Plan: Code Tile First-Boot Rescue Reload (gated on the code-bridge host record)

**Change**: 260910-74q0-code-tile-first-boot-rescue-reload
**Intake**: `intake.md`

## Requirements

### Backend: code-bridge status endpoint

#### R1: Read-shaped code-bridge status route
The daemon SHALL serve `GET /api/windows/{windowId}/code-bridge?server=<name>` (`app/backend/api/codebridge.go`, registered in `api/router.go` beside the `code-workspace` GET) and respond `200 {"installed": <bool>, "startedAt": "<RFC 3339 or empty>"}`. `installed` MUST be `codeserver.InstalledBridgeVersion(codeserver.ExtensionsDir(home)) != ""` (the `rk doctor` derivation, `home` from `os.UserHomeDir` per request). `startedAt` MUST be derived at request time from the host registry under `codebridge.HostsDir()` (Constitution II) and MUST NOT be cached. The route MUST validate `windowId` via `parseWindowID` (400 on failure) and an explicitly supplied `server` via `validate.ValidateServerName` (400 on failure; an empty `server` defaults to `default`, the `code-workspace` precedent). A missing registry dir or an unresolvable state dir MUST yield `startedAt: ""` with `200`, never an error; only an unexpected read error is `500`.

- **GIVEN** a live tab-keyed host record `{tab:"@7", server:"default", pid:<alive>, startedAt:"2026-09-10T02:45:39.941Z"}` under `$XDG_STATE_HOME/run-kit/cb/hosts/`
- **WHEN** the client requests `GET /api/windows/@7/code-bridge?server=default`
- **THEN** the response is `200` with `startedAt` equal to that record's value and `installed` reflecting the extensions dir

- **GIVEN** no `cb/hosts/` directory exists
- **WHEN** the client requests the route for any valid window
- **THEN** the response is `200 {"installed": …, "startedAt": ""}`

- **GIVEN** an invalid window id (`/api/windows/bogus/code-bridge`) or `?server=../x`
- **WHEN** requested
- **THEN** the response is `400`

#### R2: Newest live tab-keyed `startedAt` derivation
`app/backend/internal/codebridge/tabsignal.go` SHALL export `TabStartedAt(records []HostRecord, server, tab string, alive func(pid int) bool) string`, returning the newest `StartedAt` among records where `rec.Tab == tab && rec.Server == server && alive(rec.PID)`. Records missing either `Tab` or `Server` (folder-opened hosts) MUST never match. `StartedAt` values MUST be compared as parsed `time.RFC3339` (`time.RFC3339Nano`-tolerant); an unparseable value MUST be skipped, never fatal. Two matching records (a code-root change left the old host alive under a different `hostId`) MUST resolve to the newer. The function MUST NOT ping sockets or delete files — liveness for this consumer is `kill -0` only (the existing `pidAlive`, passed in as `alive`); `LiveHosts`, `ReadRecords`, `Resolve` are unchanged.

- **GIVEN** records A `{tab:"@7", server:"s", startedAt: T1}` and B `{tab:"@7", server:"s", startedAt: T2 > T1}`, both alive
- **WHEN** `TabStartedAt(records, "s", "@7", alive)` runs
- **THEN** it returns T2

- **GIVEN** a matching record whose pid is dead, plus a folder-only record and a record for another server
- **WHEN** `TabStartedAt` runs for `("s", "@7")`
- **THEN** it returns `""`

- **GIVEN** a matching alive record with `startedAt: "not-a-time"` and another with a valid stamp
- **WHEN** `TabStartedAt` runs
- **THEN** it returns the valid stamp

### Frontend: client and decision module

#### R3: Typed client fetch
`app/frontend/src/api/client.ts` SHALL export `fetchCodeBridge(server, windowId): Promise<CodeBridgeResult>` over `deduplicatedFetch(withServer(...))`, where `CodeBridgeResult = { status: "ok"; installed: boolean; startedAt: string } | { status: "unavailable" }`. Any non-2xx response (including an old backend's 404) and any thrown fetch/parse error MUST resolve to `{ status: "unavailable" }` — the call MUST never throw (the fail-closed contract in R6).

- **GIVEN** the backend answers `200 {"installed": true, "startedAt": "X"}`
- **WHEN** `fetchCodeBridge("default", "@7")` resolves
- **THEN** the result is `{ status: "ok", installed: true, startedAt: "X" }`

- **GIVEN** the backend answers `404`
- **WHEN** `fetchCodeBridge` resolves
- **THEN** the result is `{ status: "unavailable" }` and nothing throws

#### R4: Pure rescue decision module
`app/frontend/src/lib/code-boot-rescue.ts` SHALL be DOM-free (the `lib/code-folder-latch.ts` contract) and export:
- `CODE_BOOT_RESCUE_WAIT_MS = 10_000` (measured from the iframe `load` event);
- `isWorkspaceSrc(src: string): boolean` — true iff the src carries a `workspace` query param (the `/code/?workspace=` form);
- `bridgeConfirmed(baseline: string | null, current: string | null): boolean` — true iff `current` is non-empty AND (`baseline` is null/empty OR `Date.parse(current) > Date.parse(baseline)`); an unparseable `current` is never a confirmation. Server-written stamps are compared against server-written stamps only — never `Date.now()`;
- `decideRescue({ baseline, current, installed, isWorkspaceMount }): "reload" | "none" | "skip-not-installed"` — `isWorkspaceMount === false` ⇒ `"none"`; `installed !== true` (false OR null = decision GET unavailable) ⇒ `"skip-not-installed"`; `bridgeConfirmed(baseline, current)` ⇒ `"none"`; otherwise `"reload"`.

- **GIVEN** `baseline = "…39.941Z"`, `current = "…41.100Z"`, `installed = true`, workspace mount
- **WHEN** `decideRescue` runs
- **THEN** it returns `"none"`

- **GIVEN** `baseline = "…39.941Z"`, `current = "…39.941Z"` (the stale record from the previous boot), `installed = true`, workspace mount
- **WHEN** `decideRescue` runs
- **THEN** it returns `"reload"`

- **GIVEN** `installed = null`
- **WHEN** `decideRescue` runs on a workspace mount with no confirmation
- **THEN** it returns `"skip-not-installed"`

- **GIVEN** a `?folder=` mount
- **WHEN** `decideRescue` runs
- **THEN** it returns `"none"` regardless of the other inputs

### Frontend: CodeSurface wiring

#### R5: Two point-in-time GETs and one reload per mount generation
`CodeSurface` (`app/frontend/src/components/code-surface.tsx`) SHALL accept an optional injected fetcher prop `fetchBridgeStatus?: () => Promise<CodeBridgeResult>` (built in `app.tsx` as `() => fetchCodeBridge(server, windowId)` and threaded through `SurfaceLayout` like the existing code-surface seams). When a mount generation adopts a `src` for which `isWorkspaceSrc` is true, the component SHALL issue the fetcher once and store the result's `startedAt` as that generation's **baseline** (`null` on `unavailable`). On the iframe's `load` event, if the generation is unsettled, it SHALL arm a `CODE_BOOT_RESCUE_WAIT_MS` timer; on expiry it SHALL issue the fetcher a second time, call `decideRescue`, and on `"reload"` run `iframe.contentWindow?.location.reload()` inside the component's existing try/catch posture. Exactly two fetches and at most one `reload()` per mount generation; the generation is then **settled** and no later event fires again. The `src` ref MUST remain untouched (a `reload()` is not a `src` write). A new mount generation (the `reachable` flip, a window-switch remount, or a `followSrc` nonce adoption) MUST reset baseline, timer and budget. Unmount or generation change MUST clear any pending timer and discard in-flight fetch results. When the prop is absent the component's behavior is unchanged (no fetches, no timer).

- **GIVEN** a `?workspace=` mount whose baseline fetch returned `startedAt: ""` and whose expiry fetch returns `{installed: true, startedAt: "…"}` (a newer record)
- **WHEN** the timer expires
- **THEN** `contentWindow.location.reload` is NOT called and the generation is settled

- **GIVEN** the same mount whose expiry fetch returns `{installed: true, startedAt: ""}`
- **WHEN** the timer expires
- **THEN** `contentWindow.location.reload` is called exactly once, and a further `load` event never re-arms the timer for this generation

- **GIVEN** a settled generation
- **WHEN** `reachable` flips false→true (remount)
- **THEN** a fresh baseline fetch is issued and the budget is available again

#### R6: Fail-closed not-installed / unavailable posture
When `decideRescue` returns `"skip-not-installed"`, `CodeSurface` SHALL perform no reload and SHALL emit exactly one `console.warn` per mount generation naming `rk code-server install` (the `use-code-workspace.ts` one-warning idiom). An `unavailable` decision fetch (old backend, network error) takes the same path. A blind reload MUST never occur.

- **GIVEN** the expiry fetch returns `{ status: "unavailable" }`
- **WHEN** the timer expires
- **THEN** no reload happens and one warning is logged

#### R7: Bounded e2e — no rescue reload when the record confirms the boot
`app/frontend/tests/e2e/code-surface.spec.ts` SHALL gain one test (with the constitution's **Proves/Steps** intent comment) that writes a fake pid-alive host record `{hostId, folder, pid: process.pid, sock, extVersion, startedAt: <now ISO>, tab: <window id>, server: <E2E tmux server>}` into `$XDG_STATE_HOME/run-kit/cb/hosts/` (the harness's per-run state home — `E2E_STATE_HOME`-derived, read from `process.env.XDG_STATE_HOME`, never hardcoded) AFTER the code tile's iframe has mounted, then asserts the iframe fires exactly one `load` over `CODE_BOOT_RESCUE_WAIT_MS + 2 s` (no rescue reload). The test MUST clean the record up in `afterEach`. It MUST hold in both `installed` states of the host box (confirmed record ⇒ `none`; not installed ⇒ `skip-not-installed`), so it never depends on the extensions dir.

- **GIVEN** the code tile open on the stub code-server and a confirming host record for the tab
- **WHEN** 12 s elapse after the first `load`
- **THEN** the iframe has loaded exactly once

### Non-Goals

- Changing the bridge extension (`app/code-bridge/`) to subscribe to `onDidChangeWorkspaceFolders` — separate hygiene follow-up; the broken boot never delivers the folder to the extension host anyway.
- Pre-warming VS Code's `CachedConfigurations` directory — couples to VS Code-internal paths and id hashing.
- Peeking into the iframe DOM for the "no folder opened" panel — couples to VS Code UI text.
- Any per-tick payload field, hub join, or filesystem watcher on `cb/hosts/` — superseded by the decision-point GET (intake Clarifications, 2026-09-10).
- Detecting `rk.bridge.enabled=false` — documented limitation (one rescue reload per mount in that configuration).
- An upstream VS Code / code-server report — out of band.

### Design Decisions

#### The first-boot rescue is the second sanctioned parent re-navigation
**Decision**: `CodeSurface` may parent-navigate a live frame in exactly two cases — the nonce-keyed `followSrc` (editor moved itself) and the host-record-gated first-boot rescue `contentWindow.location.reload()`, at most once per mount generation.
**Why**: the rescue targets a frame that provably has no editor state to lose (the bridge never registered, so the workbench booted with zero folders); a `reload()` keeps the `?workspace=` URL and the tab identity, whereas a `src` write would re-navigate and lose the mount-generation ref discipline.
**Rejected**: a blind reload on every first open (double-boots good boots; the user's explicit exclusion); degrading to `?folder=` (drops the tab identity the workspace file carries).
*Introduced by*: 260910-74q0-code-tile-first-boot-rescue-reload

#### Two decision-point GETs, not a payload field or a watcher
**Decision**: the rescue signal is read by two point-in-time `GET /api/windows/{id}/code-bridge` calls per mount generation (baseline at src adoption, verdict at wait expiry).
**Why**: the state socket's idle cadence (12 s `safetyPollInterval` + 5 s TTL) cannot observe a record written inside a 10 s window, so a per-tick field would false-reload good boots; two requests with no interval and no loop are not polling, and the derivation stays request-time (Constitution II, IX).
**Rejected**: an `fsnotify` watcher on `cb/hosts/` waking the hub (machinery for a once-per-workspace event); widening the wait to ≥ 20 s (a 20 s empty-editor dwell on every broken boot).
*Introduced by*: 260910-74q0-code-tile-first-boot-rescue-reload

#### Request-path liveness is `kill -0` only
**Decision**: the endpoint filters records with `pidAlive` and never calls `LiveHosts`.
**Why**: `LiveHosts` dials every socket with a 2 s timeout serially and prunes the registry as a side effect — neither belongs on a UI request path; the newer-than-baseline rule already neutralises stale records, so a ping adds nothing for this signal.
**Rejected**: reusing `LiveHosts` (latency and file deletion on a read path).
*Introduced by*: 260910-74q0-code-tile-first-boot-rescue-reload

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `CodeBridgeResult` and `fetchCodeBridge(server, windowId)` to `app/frontend/src/api/client.ts` beside `fetchCodeWorkspace` (never throws; non-2xx/throw ⇒ `{status:"unavailable"}`); cover both branches in `app/frontend/src/api/client.test.ts` <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 [P] Create `app/backend/internal/codebridge/tabsignal.go` with `TabStartedAt(records, server, tab, alive)` (tab+server match, alive filter, RFC 3339 parse, newest wins, unparseable skipped) and `tabsignal_test.go` covering newest-wins, dead pid, folder-only record, wrong server, unparseable stamp, empty input <!-- R2 -->
- [x] T003 Create `app/backend/api/codebridge.go` (`handleCodeBridge`: parseWindowID, server validation/default, `codebridge.HostsDir` + `ReadRecords` + `TabStartedAt` with `pidAlive` (export a small `PIDAlive` or accept the func), `codeserver.InstalledBridgeVersion(codeserver.ExtensionsDir(home))`, JSON `{installed, startedAt}`), register `r.Get("/api/windows/{windowId}/code-bridge", …)` in `app/backend/api/router.go` beside the `code-workspace` route, and add `app/backend/api/codebridge_test.go` (200 with fixture registry under `t.Setenv("XDG_STATE_HOME")`, 200 + empty `startedAt` on missing dir, 400 bad window id, 400 bad server, `installed` via `t.Setenv("XDG_DATA_HOME")` + `writeBridgeFixture`-style manifest) <!-- R1 -->
- [x] T004 [P] Create `app/frontend/src/lib/code-boot-rescue.ts` (`CODE_BOOT_RESCUE_WAIT_MS`, `isWorkspaceSrc`, `bridgeConfirmed`, `decideRescue`) and `code-boot-rescue.test.ts` covering: newer stamp ⇒ none; equal/older stamp ⇒ reload; null baseline + any stamp ⇒ none; empty current ⇒ reload; unparseable current ⇒ reload; installed false/null ⇒ skip-not-installed; `?folder=` ⇒ none; `isWorkspaceSrc` on both src forms <!-- R4 -->
- [x] T005 Wire the rescue into `app/frontend/src/components/code-surface.tsx`: new optional prop `fetchBridgeStatus`, per-mount-generation rescue state (baseline, timer, settled, warned) reset on `reachable` flip and `followSrc` nonce adoption, baseline fetch at workspace-src adoption, timer armed on `load`, expiry fetch + `decideRescue` + one `reload()` in try/catch, one `console.warn` on `skip-not-installed`, cleanup of timer/in-flight on unmount and generation change; extend `code-surface.test.tsx` with fake timers and a mocked fetcher: (a) confirming record ⇒ no reload, (b) no newer record + installed ⇒ exactly one reload and no re-arm on a second load, (c) unavailable ⇒ no reload + one warn, (d) remount after settle ⇒ fresh baseline fetch, (e) prop absent ⇒ no fetch, (f) `?folder=` src ⇒ no fetch/reload <!-- R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Thread the fetcher from `app/frontend/src/app.tsx` (build `() => fetchCodeBridge(server, windowId)` next to the `useCodeWorkspace` call, stable via `useCallback`) through `app/frontend/src/components/surface-layout.tsx` to `CodeSurface` alongside the existing code-surface seams; run `npx tsc --noEmit` and `just test-frontend` <!-- R5 -->
- [x] T007 Add the bounded negative e2e test to `app/frontend/tests/e2e/code-surface.spec.ts` (Proves/Steps intent comment; write the fake host record into `${process.env.XDG_STATE_HOME}/run-kit/cb/hosts/` after the iframe mounts, count iframe `load` events via an exposed binding or `page.evaluate` counter, assert exactly one over 12 s, clean up in `afterEach`); run `just test-e2e "code-surface"` <!-- R7 -->

## Execution Order

- T002 blocks T003 (handler calls `TabStartedAt`)
- T001 and T004 block T005 (types + decision module)
- T005 blocks T006 (prop exists) and T007 (behavior under test)
- T002/T003 (Go) are independent of T001/T004/T005 (frontend) and may run alongside them

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /api/windows/{windowId}/code-bridge?server=…` is registered and returns `200 {"installed", "startedAt"}` derived at request time from the extensions dir and `cb/hosts/`
- [x] A-002 R2: `codebridge.TabStartedAt` exists, matches on tab AND server, filters by the injected `alive`, and returns the newest parseable stamp
- [x] A-003 R3: `fetchCodeBridge` exists in `api/client.ts`, returns the typed `ok`/`unavailable` union, and never throws
- [x] A-004 R4: `lib/code-boot-rescue.ts` exports `CODE_BOOT_RESCUE_WAIT_MS`, `isWorkspaceSrc`, `bridgeConfirmed`, `decideRescue` with the specified rule table
- [x] A-005 R5: `CodeSurface` issues the baseline fetch at workspace-src adoption, arms the 10 s timer on `load`, issues the decision fetch at expiry, and reloads at most once per mount generation
- [x] A-006 R6: a `skip-not-installed` or `unavailable` outcome performs no reload and logs exactly one warning per generation
- [x] A-007 R7: the e2e negative test exists with a Proves/Steps intent comment and passes under `just test-e2e "code-surface"`

### Behavioral Correctness

- [x] A-008 R5: a mounted frame's `src` attribute is never rewritten by the rescue (only `contentWindow.location.reload()`), preserving the mount-generation ref rule and the `followSrc` exception
- [x] A-009 R5: a `followSrc` nonce adoption and a `reachable` flip each start a fresh generation (new baseline fetch, budget restored); a settled generation never re-arms on later `load` events
- [x] A-010 R4: the comparison is stamp-vs-stamp (`Date.parse` on both server-written values) and never uses `Date.now()`
- [x] A-011 R1: the handler performs no socket dial and deletes no registry file (no `LiveHosts` call)

### Scenario Coverage

- [x] A-012 R2: Go tests cover newest-wins, dead pid, folder-only record, wrong server, unparseable stamp, and empty input
- [x] A-013 R1: handler tests cover 200 with a fixture record, 200 + empty `startedAt` on a missing dir, 400 on bad window id, 400 on bad server, and `installed` true/false via an extensions-dir fixture
- [x] A-014 R5: `code-surface.test.tsx` covers confirming record ⇒ no reload, stale/no record ⇒ one reload, unavailable ⇒ no reload + warn, remount ⇒ fresh baseline, prop absent ⇒ no fetch, `?folder=` ⇒ no fetch
- [x] A-015 R4: `code-boot-rescue.test.ts` covers every row of the decision table including null baseline and unparseable stamps

### Edge Cases & Error Handling

- [x] A-016 R1: a missing `cb/hosts/` directory or unresolvable state dir yields `200` with `startedAt: ""`, not `500`
- [x] A-017 R3: an old backend answering 404 resolves to `unavailable`, which the surface treats as not installed (no reload)
- [x] A-018 R5: unmount or generation change during the 10 s wait clears the timer and discards in-flight fetch results (no state update after unmount, no reload on a stale generation)
- [x] A-019 R6: no code path can reload the frame without a `decideRescue` result of `"reload"` (no blind reload)

### Code Quality

- [x] A-020 Pattern consistency: the handler mirrors `api/codeworkspace.go` (validation order, error mapping, `writeJSON`); the client helper mirrors `fetchCodeWorkspace`; the decision module mirrors `lib/code-folder-latch.ts` (pure, DOM-free, colocated tests)
- [x] A-021 No unnecessary duplication: `pidAlive`, `ReadRecords`, `HostsDir`, `InstalledBridgeVersion`, `ExtensionsDir`, `parseWindowID`, `deduplicatedFetch`, `withServer` are reused, not re-implemented
- [x] A-022 Type narrowing over assertions: the client result is a discriminated union consumed with `status` guards, no `as` casts on response JSON beyond the existing client idiom
- [x] A-023 Magic numbers named: the wait window is the exported `CODE_BOOT_RESCUE_WAIT_MS` constant; the e2e budget derives from it
- [x] A-024 No client polling: exactly two requests per mount generation, no `setInterval`, no retry loop
- [x] A-025 Comments state constraints the code cannot show (why two GETs, why `kill -0` only, why stamp-vs-stamp) and cite no change IDs or PR numbers
- [x] A-026 Tests added for every new behavior (Go unit, handler, vitest module, component, e2e) and `just test-backend`, `just test-frontend`, `just test-e2e "code-surface"` pass

### Security

- [x] A-027 R1: `windowId` and `server` are validated before any path composition or registry read; the response never echoes registry paths or socket paths

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Hydrate targets (from the intake): `docs/memory/run-kit/ui/lenses-and-layout.md` (§ Code Surface rescue rule; amend the "One sanctioned parent re-navigation" DD to two; lift the three DDs above), `docs/memory/run-kit/code-bridge.md` (second consumer of the host record), `docs/memory/run-kit/api-and-sockets.md` (new route row in § API Layer); propose a one-clause amendment to `docs/specs/right-panel.md` § The code lens.

## Deletion Candidates

- None — this change adds new functionality (one route, one decision module, one injected prop seam) without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The fetcher is injected into `CodeSurface` as a prop (`fetchBridgeStatus`) built in `app.tsx`, rather than passing `server`/`windowId` into the component | Keeps `CodeSurface` free of the API client import graph, the same injection pattern as `shouldReclaimChord`; the component owns the mount generation and the `load` seam, so the decision must live there | S:70 R:90 A:85 D:75 |
| 2 | Confident | A failed baseline fetch stores `baseline = null`; `bridgeConfirmed(null, current)` is true for any non-empty `current` | A stale record from a previous boot may then suppress a rescue, which errs toward NOT reloading — the user's core constraint; the alternative (treat null baseline as "no record") risks a blind reload against a confirmed good boot | S:60 R:85 A:80 D:70 |
| 3 | Certain | `bridgeConfirmed` uses `Date.parse` on both RFC 3339 strings and requires strictly greater | Intake #5 (server clock vs server clock); string comparison would break across the `Z`/offset and fractional-second forms the extension may write | S:85 R:90 A:95 D:85 |
| 4 | Confident | The handler resolves `home` via `os.UserHomeDir()` per request and tolerates its error as `installed: false` | The `api/servers.go` precedent; an unresolvable home is a degenerate box where no rescue should fire anyway | S:60 R:90 A:85 D:75 |
| 5 | Confident | The Go export for liveness is a tiny `PIDAlive` wrapper (or the handler passes `pidAlive` through a package-level func) rather than changing `LiveHosts` | Minimal surface; the intake pins `LiveHosts` unchanged | S:65 R:95 A:90 D:80 |
| 6 | Confident | The e2e counts iframe `load` events through a `page.exposeFunction` counter attached to the mounted iframe and asserts exactly one over `CODE_BOOT_RESCUE_WAIT_MS + 2000` ms | The stub harness has no real extension; the intake bounds e2e to the negative assertion which holds in both installed states | S:55 R:90 A:75 D:65 |
| 7 | Certain | Lane: 7 tasks ⇒ FULL lane (apply dispatched) | `_pipeline.md` Step 1 threshold (≤ 5 ⇒ light) applied to the honest task count | S:95 R:100 A:100 D:100 |

7 assumptions (2 certain, 5 confident, 0 tentative).
