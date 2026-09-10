# Plan: Code Rescue — Positive Empty-Boot Signal + Bridge Record Ownership

**Change**: 260910-oa3c-code-rescue-positive-signal-record-ownership
**Intake**: `intake.md`

## Requirements

### Extension: empty-boot marker and ownership

#### R1: Empty-boot marker on a zero-folder, tab-keyed activation
`app/code-bridge/src/extension.ts` `activate()` SHALL, after the `rk.bridge.enabled` gate, handle `vscode.workspace.workspaceFolders` empty as follows: when `vscode.workspace.workspaceFile` is a `file:` URI, read that file from disk and derive the tab identity from its top-level `settings` via `readTabIdentity`; when an identity resolves, write `$XDG_STATE_HOME/run-kit/cb/boots/<hostId>.json` (dir `0700` via `ensurePrivateDir`+`mkdirSync`, file `0600` via `writeAtomic`) with exactly `{hostId, workspaceFile, tab, server, pid, extVersion, startedAt}` where `hostId = computeHostId(workspaceFile.fsPath)`, `pid = process.pid`, `startedAt = new Date().toISOString()`. When no identity resolves (no workspace file, non-`file:` scheme, unreadable/unparseable file, missing or invalid settings) the extension SHALL write nothing and return, as today.

- **GIVEN** an extension host activating with zero folders for `/…/code/default/@7-3fa1c9.code-workspace` whose `settings` carry `rk.tab: "@7"`, `rk.server: "default"`
- **WHEN** `activate()` runs
- **THEN** `cb/boots/<computeHostId(path)>.json` exists with `tab:"@7"`, `server:"default"`, `pid: process.pid` and an RFC 3339 `startedAt`

- **GIVEN** zero folders and a workspace file whose `settings` has `rk.tab: "7"`
- **WHEN** `activate()` runs
- **THEN** no marker is written and no bridge starts

#### R2: Late folder starts the bridge and removes the marker
After writing the marker, `activate()` SHALL subscribe to `vscode.workspace.onDidChangeWorkspaceFolders`; when `workspaceFolders[0]` becomes present, it SHALL remove the marker (pid-guarded per R3) and run the normal bridge startup for that folder — the startup body factored out of `activate()` into one function both paths call — then dispose the subscription (one bridge per window).

- **GIVEN** a marker written by this host
- **WHEN** a folder is added to the workspace
- **THEN** the marker is gone, the bridge socket and host record exist, and a second folder change starts nothing new

#### R3: Ownership-guarded cleanup
`deactivate()` SHALL unlink the host record and its socket only when the record file on disk parses to an object whose numeric `pid` equals `process.pid`; the marker file is removed under the same predicate. A missing, unreadable, or unparseable file leaves the corresponding files alone. `server.close()` runs unconditionally. The predicate is a pure `ownsFile(contents: string, pid: number): boolean`.

- **GIVEN** a newer host rewrote `hosts/<hostId>.json` with its own pid
- **WHEN** the older host's `deactivate()` runs
- **THEN** the record and socket remain

- **GIVEN** the record still carries `process.pid`
- **WHEN** `deactivate()` runs
- **THEN** the record and socket are removed

#### R4: `vscode`-free pure pieces with `node --test` coverage
`identityFromWorkspaceFile(contents)`, `ownsFile(contents, pid)`, and `buildBootMarker({hostId, workspaceFile, identity, pid, extVersion, now})` SHALL live in `vscode`-free module(s) under `app/code-bridge/src/` with tests in `app/code-bridge/test/`: valid file ⇒ identity; missing/non-object `settings`, invalid values, non-JSON ⇒ `null`; `ownsFile` true only on a matching numeric pid; marker key set exact.

- **GIVEN** `identityFromWorkspaceFile('{"folders":[],"settings":{"rk.tab":"@7","rk.server":"s"}}')`
- **WHEN** evaluated
- **THEN** it returns `{tab:"@7", server:"s"}`; `'{"settings":5}'` and `'nope'` return `null`

### Backend: boots registry and route field

#### R5: Boot-marker registry read
`app/backend/internal/codebridge` SHALL export `BootsDir()` (= `<StateDir()>/boots`, mirroring `HostsDir`), a `BootMarker` struct mirroring the marker JSON (`StartedAt` raw string), `ReadBootMarkers(dir)` (absent dir ⇒ empty, unreadable/undecodable skipped, sorted by host id) sharing ONE enumeration helper with `ReadRecords`, and `TabEmptyBootAt(markers, server, tab, alive) string` with `TabStartedAt`'s exact rules (tab AND server match, injected `alive`, `time.RFC3339Nano` parse, unparseable skipped, newest wins, `""` when none) implemented once (a shared unexported `newestTabStamp` or a small interface both types satisfy) — no second copy of the parse/compare loop and no second ReadDir loop.

- **GIVEN** markers A `{tab:"@7", server:"s", startedAt:T1}` and B `{…, startedAt:T2 > T1}`, both alive, plus a dead-pid marker with T3 > T2 and a marker for server `"x"`
- **WHEN** `TabEmptyBootAt(markers, "s", "@7", alive)` runs
- **THEN** it returns T2

- **GIVEN** no `boots/` directory
- **WHEN** `ReadBootMarkers(BootsDir())` runs
- **THEN** it returns an empty slice and a nil error

#### R6: `emptyBootAt` on the code-bridge route
`GET /api/windows/{windowId}/code-bridge` SHALL respond `{"installed": bool, "startedAt": string, "emptyBootAt": string}` where `emptyBootAt = TabEmptyBootAt(ReadBootMarkers(BootsDir()), server, windowID, PIDAlive)`; validation, defaults, degrade-to-`""` on a missing dir, `500` only on an unexpected read error, request-time derivation, GET, no `LiveHosts`, no socket dial, no prune — all unchanged.

- **GIVEN** a pid-alive fixture marker for `("default","@7")` under `t.Setenv("XDG_STATE_HOME")` and a same-tab marker for server `"other"`
- **WHEN** `GET /api/windows/@7/code-bridge?server=default`
- **THEN** `emptyBootAt` equals the `default` marker's stamp

- **GIVEN** a host record but no `boots/` dir
- **WHEN** requested
- **THEN** `startedAt` is the record's stamp and `emptyBootAt` is `""`

### Frontend: positive-signal decision and bounded verdict

#### R7: Client shape
`CodeBridgeResult`'s `ok` arm SHALL gain `emptyBootAt: string`; `fetchCodeBridge` SHALL read it as `typeof data.emptyBootAt === "string" ? data.emptyBootAt : ""` (older backend ⇒ `""`); the `unavailable` arm is unchanged and the call still never throws.

- **GIVEN** a `200 {"installed":true,"startedAt":"A"}` response without the new field
- **WHEN** `fetchCodeBridge` resolves
- **THEN** the result is `{status:"ok", installed:true, startedAt:"A", emptyBootAt:""}`

#### R8: Decision module
`app/frontend/src/lib/code-boot-rescue.ts` SHALL export `CODE_BOOT_RESCUE_WAIT_MS = 10_000`, `CODE_BOOT_RESCUE_RECHECK_MS = 10_000`, `isWorkspaceSrc`, `newerThanBaseline(baseline: string | null, current: string | null): boolean` (true iff `current` is a parseable non-empty stamp AND (`baseline === ""` OR `Date.parse(current) > Date.parse(baseline)`); a `null` baseline or an unparseable side ⇒ false; never `Date.now()`), and `decideRescue({ baselineEmptyBootAt, emptyBootAt, installed, isWorkspaceMount })` ⇒ `"none"` when `!isWorkspaceMount`; `"skip-not-installed"` when `installed !== true`; `"reload"` when `newerThanBaseline(baselineEmptyBootAt, emptyBootAt)`; otherwise `"none"`. `bridgeConfirmed` is retired in favour of `newerThanBaseline`. The host-record stamp SHALL never produce `"reload"`.

- **GIVEN** `baselineEmptyBootAt = ""`, `emptyBootAt = "2026-09-10T22:05:01Z"`, `installed = true`, workspace mount
- **WHEN** `decideRescue` runs
- **THEN** it returns `"reload"`

- **GIVEN** `baselineEmptyBootAt = null`, `emptyBootAt = "2026-09-10T22:05:01Z"`
- **WHEN** `decideRescue` runs
- **THEN** it returns `"none"`

- **GIVEN** no marker (`emptyBootAt = ""`) and no host record at all, `installed = true`
- **WHEN** `decideRescue` runs
- **THEN** it returns `"none"`

#### R9: Bounded verdict in `CodeSurface`
Per `?workspace=` mount generation with an injected `fetchBridgeStatus`, `CodeSurface` SHALL: (1) at src adoption read once and capture BOTH baselines (`startedAt`, `emptyBootAt`; an `unavailable` result leaves both `null`); (2) at `CODE_BOOT_RESCUE_WAIT_MS` after the first iframe `load` read once — `installed !== true`/unavailable ⇒ settle with `skip-not-installed` and one `console.warn` naming `rk code-server install`; a newer marker (`newerThanBaseline(baselineEmptyBootAt, emptyBootAt)`) ⇒ exactly one `contentWindow.location.reload()` in the try/catch posture, settle; a newer record (`newerThanBaseline(baselineStartedAt, startedAt)`) ⇒ settle, no reload; both newer ⇒ settle, no reload; neither newer ⇒ arm exactly ONE re-check; (3) at `CODE_BOOT_RESCUE_RECHECK_MS` later read once, apply the same decision, then settle regardless. Invariants: at most three reads and one `reload()` per generation, no interval loop, the `src` ref never rewritten, `settled` set before each verdict fetch, a settled generation ignores later `load` events, generation reset on a `reachable` flip / remount / `followSrc` nonce adoption, cleanup clears pending timers and discards in-flight reads. A `?folder=` mount or a missing prop stays inert.

- **GIVEN** baseline `{startedAt:"A", emptyBootAt:""}`, first verdict `{startedAt:"A", emptyBootAt:""}`, re-check `{startedAt:"A", emptyBootAt:"M"}` with `installed:true`
- **WHEN** 10 s then 10 s elapse after `load`
- **THEN** the fetcher was called three times and `reload` exactly once

- **GIVEN** first verdict `{startedAt:"B" > "A", emptyBootAt:""}`
- **WHEN** 10 s elapse
- **THEN** no re-check is armed and no reload happens (two fetcher calls total)

- **GIVEN** nothing newer at either verdict
- **WHEN** 20 s elapse
- **THEN** three fetcher calls, no reload, and a later `load` re-arms nothing

#### R10: e2e coverage
`app/frontend/tests/e2e/code-surface.spec.ts` SHALL keep the negative test (fake pid-alive host record ⇒ exactly one `load`) with its intent comment updated to the positive-signal rule. A positive test (fake empty-boot marker written after the baseline read ⇒ exactly two `load`s) SHALL be added if `installed: true` can be made deterministic in the harness — the plan-time candidate is a fixture `run-kit.rk-code-bridge-<v>/package.json` under a per-run `XDG_DATA_HOME` forwarded only to the backend's `just dev` line in `scripts/test-e2e.sh`; if that perturbs the dev rig (code-server or `rk` reading `XDG_DATA_HOME` for anything else), the positive arm stays vitest-only and the reason is recorded in `## Assumptions`.

- **GIVEN** the code tile open on the stub with a confirming host record
- **WHEN** 22 s elapse
- **THEN** the iframe has loaded exactly once

### Non-Goals

- Changing the code-server reachability probe (500 ms dial / 5 s TTL) — a separate, unverified suspicion.
- Cache pre-warm, DOM peeking, upstream report — unchanged exclusions.
- Removing `startedAt` from the response, or re-keying `hostId` per boot.

### Design Decisions

#### The rescue fires only on a positive empty-boot signal
**Decision**: the code tile reloads only when the bridge extension itself reports that THIS boot activated with zero folders (an empty-boot marker newer than the mount baseline); the absence of a host record is never a trigger.
**Why**: a good boot's record lands only after the remote extension host activates, which under load takes longer than any fixed window (7 s measured with three concurrent workbenches; the user's boot missed a 10 s verdict by about a second), so absence cannot distinguish "slow" from "broken" — and a false reload is exactly the blind reload the rescue exists to avoid. The extension provably runs `activate()` on the broken boot, so it can name the failure directly.
**Rejected**: widening the fixed window (every extra second is a longer broken-boot dwell and still no guarantee); polling until a record appears (an interval loop on a UI path); keeping the absence rule with a re-check only (still infers from silence).
*Introduced by*: 260910-oa3c-code-rescue-positive-signal-record-ownership

#### One bounded re-check, not a fixed single read
**Decision**: the verdict reads at 10 s and, when neither stamp has moved, once more at 20 s, then settles — at most three reads per mount generation.
**Why**: the marker is written by the same slow extension-host activation as the record, so a single read at 10 s would miss the broken boot under load; one re-check covers the measured latency with margin while keeping the per-generation cost bounded and interval-free.
**Rejected**: an interval until a signal appears (open-ended client polling); a single read at 20 s (doubles the good-boot confirmation latency for nothing).
*Introduced by*: 260910-oa3c-code-rescue-positive-signal-record-ownership

#### Cleanup removes only files the exiting host still owns
**Decision**: `deactivate()` unlinks the host record, socket, and marker only when the on-disk record's `pid` is its own.
**Why**: `hostId` hashes the workspace path with VS Code's per-browser `machineId`, so successive boots of one tab in one browser share a record and socket path; VS Code keeps the previous extension host alive ~5 minutes after its client leaves, and its unconditional unlink was deleting the live host's files.
**Rejected**: re-keying `hostId` per boot (breaks the deterministic identity `rk code exec --tab` and the newest-wins rule rely on); leaving cleanup unconditional and tolerating the loss (kills the bridge for the tab five minutes after every remount).
*Introduced by*: 260910-oa3c-code-rescue-positive-signal-record-ownership

## Tasks

### Phase 1: Backend

- [x] T001 [P] Add `BootsDir()` to `app/backend/internal/codebridge/state.go` (+ `state_test.go` case under the XDG override) and a new `boots.go` with `BootMarker` + `ReadBootMarkers` sharing one unexported enumeration helper with `ReadRecords` in `record.go` (refactor `ReadRecords` onto it; `record_test.go` must stay green) <!-- R5 -->
- [x] T002 [P] Add `TabEmptyBootAt` in `app/backend/internal/codebridge/tabsignal.go` with the parse/compare/newest-wins logic shared with `TabStartedAt` (one unexported helper or small interface), plus `tabsignal_test.go` table cases for markers (newest wins both orders, dead pid, wrong tab/server, unparseable, empty) <!-- R5 -->
- [x] T003 Extend `handleCodeBridge` in `app/backend/api/codebridge.go` with `emptyBootAt`, and extend `api/codebridge_test.go` with a `writeBootMarker` helper: fixture marker ⇒ stamp; other-server marker does not leak; missing `boots/` ⇒ `""` while `startedAt` still derives; dead-pid marker invisible; run `cd app/backend && go test ./internal/codebridge/ ./api/` <!-- R6 -->

### Phase 2: Extension and frontend

- [x] T004 [P] Create the `vscode`-free pure module(s) in `app/code-bridge/src/` (e.g. `workspace-file.ts` with `identityFromWorkspaceFile`, `ownership.ts` with `ownsFile` and `buildBootMarker`) plus `app/code-bridge/test/workspace-file.test.ts` / `ownership.test.ts` covering R4's cases; run `cd app/code-bridge && pnpm run typecheck && pnpm test` <!-- R4 -->
- [x] T005 Rewire `app/code-bridge/src/extension.ts`: factor the bridge startup into a function taking the folder; replace `if (!folder) return;` with the empty-boot branch (workspace-file read, identity, `boots/` dir, `writeAtomic` marker, `onDidChangeWorkspaceFolders` subscription that removes the marker pid-guarded, starts the bridge once, then disposes); guard `deactivate()` with `ownsFile` for record+socket and for the marker; keep `server.close()` unconditional; `pnpm run typecheck && pnpm test && pnpm run build` <!-- R1, R2, R3 -->
- [x] T006 [P] Add `emptyBootAt` to `CodeBridgeResult` and `fetchCodeBridge` in `app/frontend/src/api/client.ts` (older-backend default `""`) and cover it in `client.test.ts` <!-- R7 -->
- [x] T007 [P] Rewrite `app/frontend/src/lib/code-boot-rescue.ts` (`CODE_BOOT_RESCUE_RECHECK_MS`, `newerThanBaseline`, the new `decideRescue` signature; retire `bridgeConfirmed`) and `code-boot-rescue.test.ts` for the full new table including `null` vs `""` baselines and unparseable stamps <!-- R8 -->
- [x] T008 Rewire the rescue effect in `app/frontend/src/components/code-surface.tsx` for the two-stamp baseline, the first verdict, the single re-check, early settle on a newer record, settle-before-fetch on both verdicts, cleanup; extend `code-surface.test.tsx` with the fake-timer cases in R9 (three reads then reload at re-check; two reads on a newer record; three reads no reload; one reload at first verdict without re-check; unavailable ⇒ warn; remount ⇒ fresh baselines; `?folder=`/prop absent inert); `cd app/frontend && npx tsc --noEmit && npx vitest run src/lib/code-boot-rescue.test.ts src/components/code-surface.test.tsx src/api/client.test.ts` <!-- R9 -->

### Phase 3: Integration and e2e

- [x] T009 Update the negative e2e test's intent comment in `app/frontend/tests/e2e/code-surface.spec.ts`; evaluate the `XDG_DATA_HOME` fixture option in `scripts/test-e2e.sh` for a deterministic `installed: true` (forwarded only to the backend line); if safe, add the positive marker test (fake marker into `${XDG_STATE_HOME}/run-kit/cb/boots/` after the baseline read ⇒ exactly two iframe `load`s, cleanup in `afterEach`, Proves/Steps comment); otherwise record the reason as a plan assumption; run `just test-e2e "code-surface"` <!-- R10 -->
- [x] T010 Full gates: `just test-backend`, `just test-frontend`, `cd app/code-bridge && pnpm test`, `just build`; fix anything red <!-- R5, R9 -->

## Execution Order

- T001 and T002 block T003 (the handler consumes both)
- T004 blocks T005; T006 and T007 block T008
- T008 blocks T009; everything blocks T010
- Phase 1 (Go) and Phase 2 (TS) are independent of each other

## Acceptance

### Functional Completeness

- [x] A-001 R1: a zero-folder activation with a tab-keyed `file:` workspace file writes `cb/boots/<hostId>.json` with the exact seven keys; no identity ⇒ nothing written
- [x] A-002 R2: a folder arriving later removes the marker and starts the bridge exactly once via the factored startup
- [x] A-003 R3: `deactivate()` unlinks record/socket/marker only when the on-disk record's pid is `process.pid`
- [x] A-004 R4: `identityFromWorkspaceFile`, `ownsFile`, `buildBootMarker` exist in `vscode`-free modules with `node --test` coverage
- [x] A-005 R5: `BootsDir`, `BootMarker`, `ReadBootMarkers`, `TabEmptyBootAt` exist with the specified semantics
- [x] A-006 R6: the route responds with `emptyBootAt` alongside `installed` and `startedAt`
- [x] A-007 R7: `fetchCodeBridge` returns `emptyBootAt`, defaulting `""` when absent
- [x] A-008 R8: `decideRescue` implements the positive-signal table; `newerThanBaseline` treats `null` as unconfirmable and `""` as "accept any parseable stamp"
- [x] A-009 R9: `CodeSurface` performs at most three reads and one reload per generation with the single re-check
- [x] A-010 R10: the negative e2e test passes with an updated intent comment; the positive arm is present or its omission is recorded

### Behavioral Correctness

- [x] A-011 R8: the host-record `startedAt` can never yield `"reload"`; a newer record only settles early
- [x] A-012 R9: the frame's `src` attribute is never rewritten; `settled` is set before each verdict fetch; a settled generation ignores later `load` events
- [x] A-013 R3: a record rewritten by a newer pid survives the older host's `deactivate()`
- [x] A-014 R5: `ReadRecords` still passes its existing tests after moving onto the shared enumeration helper

### Scenario Coverage

- [x] A-015 R5: Go tests cover marker newest-wins (both orders), dead pid, wrong tab/server, unparseable stamp, empty input, missing dir
- [x] A-016 R6: handler tests cover the fixture marker, other-server isolation, missing `boots/`, dead-pid marker
- [x] A-017 R9: `code-surface.test.tsx` covers every fake-timer scenario listed in T008
- [x] A-018 R4: extension tests cover valid/missing/invalid/non-JSON workspace files and matching/different/missing pid ownership

### Edge Cases & Error Handling

- [x] A-019 R1: an unreadable or unparseable workspace file, or a non-`file:` scheme, writes nothing and throws nothing
- [x] A-020 R3: a missing or unparseable record leaves record, socket and marker untouched
- [x] A-021 R7: an old backend (no field) yields `emptyBootAt: ""`, so no reload can fire against it
- [x] A-022 R9: unmount or generation change during either wait clears timers and discards in-flight reads

### Code Quality

- [x] A-023 Pattern consistency: `boots.go` mirrors `record.go`; the handler extension mirrors the existing field derivation; new pure modules mirror `tab.ts` (validator style, `node --test`)
- [x] A-024 No unnecessary duplication: one ReadDir loop, one parse/compare/newest-wins implementation, one stamp-compare helper on the frontend, `readTabIdentity` reused for the on-disk settings
- [x] A-025 Type narrowing over assertions: the client reads `emptyBootAt` behind a `typeof` guard; extension parsers narrow unknown JSON without `as` casts
- [x] A-026 Magic numbers named: both wait constants exported; the e2e budget derives from them
- [x] A-027 No client polling: at most three point-in-time reads per generation, no `setInterval`
- [x] A-028 Comments state constraints the code cannot show (why absence is not a signal, why pid-guarded cleanup, why two stamps) and cite no change IDs or PR numbers
- [x] A-029 Tests added for every new behavior; `just test-backend`, `just test-frontend`, `pnpm test` (code-bridge), `just test-e2e "code-surface"`, `just build` pass

### Security

- [x] A-030 R1: the marker dir is `0700`, files `0600`; the workspace-file path is only read, never executed or echoed into argv; `tab`/`server` in the marker pass `readTabIdentity` before the backend trusts them (tab+server match only)
- [x] A-031 R6: `windowId` and `server` are validated before any registry read; the response never echoes registry or socket paths

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Hydrate targets are listed in the intake § E; the three Design Decisions above lift into `ui/lenses-and-layout.md` and `code-bridge.md`.

## Deletion Candidates

- None remaining — the one symbol this change made redundant, `bridgeConfirmed` in `app/frontend/src/lib/code-boot-rescue.ts`, was already retired in the apply diff (replaced by `newerThanBaseline`); a repo-wide grep finds no surviving source references. No other existing file, function, branch, or config is left unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New extension modules are `src/workspace-file.ts` and `src/ownership.ts` (names implementer-adjustable); `buildBootMarker` sits beside `ownsFile` | Intake #7 leaves names to the implementer; two small modules keep the `vscode`-free seam obvious | S:60 R:95 A:90 D:80 |
| 2 | Confident | The shared Go enumeration helper is an unexported generic `readJSONDir[T any]`; the shared stamp logic is an unexported `newestTabStamp` over a tiny interface both `HostRecord` and `BootMarker` implement | Intake #8 leaves the mechanism to the reviewer; generics keep `ReadRecords`'s public signature unchanged | S:60 R:90 A:90 D:75 |
| 3 | Certain | `newerThanBaseline(null, x)` is false, `newerThanBaseline("", x)` is true for parseable `x` | Intake #12 | S:85 R:90 A:95 D:85 |
| 4 | Certain | Both newer at one read ⇒ settle without reload | Intake #13 | S:80 R:90 A:90 D:85 |
| 5 | Confident | The e2e positive arm's `XDG_DATA_HOME` fixture is forwarded only to the backend line of `scripts/test-e2e.sh`; T009 verifies code-server/`rk` do not read `XDG_DATA_HOME` for anything the rig depends on before adopting it | Intake #17; `codeserver.ExtensionsDir` honors the variable and the handler tests already rely on it | S:55 R:90 A:65 D:60 |
| 6 | Certain | Lane: 10 tasks ⇒ FULL lane | `_pipeline.md` Step 1 threshold | S:95 R:100 A:100 D:100 |

6 assumptions (3 certain, 3 confident, 0 tentative).
