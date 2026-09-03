# Plan: Tab CLI SSE Wake

**Change**: 260902-0ccm-tab-cli-sse-wake
**Intake**: `intake.md`

## Requirements

### Backend: Wake endpoint

- **R1**: The backend MUST expose `POST /api/servers/wake` (`api/servers.go`, registered beside the other server POSTs in `router.go` — Constitution IX) accepting JSON body `{"name": "<server>"}`. The handler MUST validate the name via `validate.ValidateServerName` (→ `400` on failure, mirroring `handleServerProtect`), reject a malformed body with `400`, then run `s.initSSEHub()` + `s.sseHub.wake(body.Name)` and return `200 {"ok": true}`. It MUST NOT touch tmux — the hub's per-server wake is already a harmless no-op for a server with no connected clients.

  - GIVEN a running daemon with a dashboard subscribed to server `default`, WHEN `POST /api/servers/wake {"name":"default"}` arrives, THEN the SSE hub's wake channel for `default` fires (next snapshot pass runs immediately) and the response is `200 {"ok":true}`.
  - GIVEN a body `{"name":"bad;name"}` or unparseable JSON, WHEN the handler runs, THEN it returns `400` and never calls the hub.

### CLI: Fail-silent wake helper

- **R2**: `cmd/rk/` MUST gain a wake helper (new file `cmd/rk/tab_wake.go`, e.g. `wakeTabHub(ctx, server string)`) that POSTs `{"name": <server>}` to `resolveOrigin(ctx) + "/api/servers/wake"` with a dedicated short timeout (`tabWakeTimeout = 2 * time.Second`) and is fail-silent by design: any error (unreachable daemon, non-2xx, timeout, marshal failure) is swallowed with no output and no effect on the command's exit code — the `sendNotify` posture (`cmd/rk/notify.go`). A package-level seam var (`tabWakeFn = wakeTabHub`, the `presentNotifyFn` idiom) MUST exist so tests can record calls without a network.

  - GIVEN `rk serve` is down, WHEN a mutating `rk tab` verb runs, THEN stdout/stderr and the exit code are byte-identical to today (connection-refused is swallowed instantly).
  - GIVEN a hung daemon, WHEN the helper fires, THEN the CLI is delayed at most ~2s and still succeeds.

### CLI: Wake wiring on mutating verbs

- **R3**: Every mutating tab verb MUST fire exactly one wake after its successful tmux write, carrying the mutation's resolved target server (the `resolveTabAddr`/`resolveTabNewSession` result — already `"default"` or a concrete `-L`/own name, matching the daemon's `serverFromRequest` keying verbatim). Call sites: `runTabNew` (`tab_new.go` — window creation arrives as ignored `%unlinked-*` control-mode events, equally invisible), `runTabLayout` both write arms (`tab_layout.go`), `runTabWebAdd`, `runTabWebRm`, `runTabWebSelect`, `runTabWebMv` (`tab_web.go`), `runTabCodeSet` (`tab_code.go`), and `runPresent` (`present.go` — sugar over `web add --show`, same swallowed-repaint problem). Read-only verbs (`tab show`, `tab web ls`, the read-only `tab layout` form) MUST NOT wake. A failed mutation MUST NOT wake (the helper call sits after the error return).

  - GIVEN `rk tab layout @5 split-h:tty,web` succeeds against server `fabKit1`, WHEN the RunE returns, THEN exactly one wake POST with `{"name":"fabKit1"}` was fired.
  - GIVEN `rk tab show`, WHEN it completes, THEN no wake fires.
  - GIVEN a layout write that fails in tmux, WHEN the RunE returns non-zero, THEN no wake fires.

### Design Decisions

- **Decision**: Wake calls sit at each RunE tail (and `runPresent`'s), not inside shared helpers like `webAddShow`. **Why**: uniform altitude — one visible call per verb beside its `Dataf`, after the mutation's success is known; `webAddShow` stays a pure tmux-write helper. **Rejected**: a single call inside `webAddShow` (covers only add/present, leaving rm/select/mv/layout/code/new needing tail calls anyway — mixed altitude). *Introduced by 260902-0ccm.*
- **Decision**: The wake POST fires after the verb's `Dataf` output where output exists. **Why**: the datum reaches the consumer before any network wait; the wake is side-band. **Rejected**: wake-before-print (delays stdout for no benefit). *Introduced by 260902-0ccm.*
- **Decision**: `tabWakeTimeout` is 2s, distinct from `notifyTimeout`'s 8s. **Why**: the wake rides every mutation's hot path; a down daemon connection-refuses instantly, the timeout only bounds a hung daemon. **Rejected**: reusing 8s (worst-case 8s stall per CLI call in choreography loops). *Introduced by 260902-0ccm.*

### Non-Goals

- No change to the 12s `safetyPollInterval` (it stays the backstop for non-rk writers).
- No wake for other CLI families (`rk mux`, `rk role`, …) — out of this change's backlog scope; the helper is reusable when they need it.
- No frontend changes.

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Add `handleServerWake` to `app/backend/api/servers.go` <!-- rework: sseHub.wake allocates h.wakes entries for names with no subscribers and nothing ever deletes them (unbounded growth); gate the wake on a live h.clients subscription --> (decode `{"name"}`, `validate.ValidateServerName` → 400, `initSSEHub()` + `sseHub.wake(name)`, `200 {"ok":true}`; mirror `handleServerProtect` minus tmux) and register `r.Post("/api/servers/wake", s.handleServerWake)` beside the other server POSTs in `app/backend/api/router.go` <!-- R1 -->
- [x] T002 [P] Add `app/backend/cmd/rk/tab_wake.go`: `tabWakeTimeout = 2 * time.Second`, `wakeTabHub(ctx, server)` (resolveOrigin + POST `/api/servers/wake`, fail-silent, `sendNotify` shape) and seam var `tabWakeFn = wakeTabHub` <!-- R2 -->
- [x] T003 <!-- rework: present arms wake before runPresent prints; move the wake to runPresent after Dataf --> Wire `tabWakeFn(ctx, server)` after the successful write (post-`Dataf` where output exists) in `runTabNew` (`tab_new.go`), both `runTabLayout` write arms (`tab_layout.go`), `runTabWebAdd`/`runTabWebRm`/`runTabWebSelect`/`runTabWebMv` (`tab_web.go`), `runTabCodeSet` (`tab_code.go`), `runPresent` (`present.go`) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] Handler tests in `app/backend/api/servers_test.go` <!-- rework: add a no-subscriber wake test proving h.wakes does not grow for unknown names --> (beside `TestHandleServerProtect_*`): valid name → 200 + hub wake observable, invalid name → 400, malformed body → 400 <!-- R1 -->
- [x] T005 [P] CLI tests (`app/backend/cmd/rk/tab_wake_test.go` <!-- rework: cover non-2xx and hung-daemon fail-silent modes with output/exit assertions --> + extending `tab_test.go`/`present_test.go` stubs): each mutating verb fires exactly one wake with the resolved server; `show`/`web ls`/read-only layout fire none; failed mutation fires none; a panicking-free real `wakeTabHub` against a dead port produces no output and returns promptly <!-- R2, R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/servers/wake` validates the server name, wakes the SSE hub for exactly that server, returns `200 {"ok":true}`, and issues zero tmux calls.
- [x] A-002 R2: the CLI wake helper is fail-silent — unreachable daemon, non-2xx, and timeout all produce no output and leave the verb's exit code unchanged.
- [x] A-003 R3: every mutating tab verb (`new`, both `layout` write arms, `web add/rm/select/mv`, `code set`) and `rk present` fires exactly one wake with the mutation's resolved target server.

### Behavioral Correctness

- [x] A-004 R3: read-only verbs (`tab show`, `tab web ls`, argless/read-only `tab layout`) fire no wake; a failed mutation fires no wake.
- [x] A-005 R1: invalid name or malformed body → `400` with the hub never called.

### Edge Cases & Error Handling

- [x] A-006 R2: a hung daemon bounds the CLI delay at `tabWakeTimeout` (~2s); a down daemon adds no perceptible latency.

### Code Quality

- [x] A-007 Pattern consistency: helper mirrors `sendNotify`/`resolveOrigin`; seam var mirrors `presentNotifyFn`; handler mirrors `handleServerProtect`; no duplicated origin/validation logic.
- [x] A-008: `cd app/backend && go test ./...` green; no new lint violations; no comment narration or change-ID citations in code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `rk present` is wired too (not just `rk tab` verbs) | Present is documented sugar over `tab web add --show` sharing `webAddShow`; excluding it would leave the flagship "show this to the user" verb with the exact swallowed-repaint bug | S:70 R:90 A:85 D:80 |
| 2 | Confident | Wake calls at RunE tails, not inside `webAddShow` | Uniform altitude, keeps the shared helper pure; see Design Decisions | S:60 R:90 A:80 D:70 |
| 3 | Certain | Server name passes verbatim (CLI already resolves to `"default"` or a concrete name, matching `serverFromRequest`) | Verified in `owntab.go` `resolveTabWindow` and `router.go` `serverFromRequest` | S:85 R:90 A:95 D:95 |

3 assumptions (1 certain, 2 confident, 0 tentative, 0 unresolved).

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.
