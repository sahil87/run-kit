# Plan: Servers Probe-Timeout Fix + Batched Per-Server Reads

**Change**: 260904-p2kp-servers-probe-timeout-batch-reads
**Intake**: `intake.md`

## Requirements

### tmux: Probe classification (D.1)

#### R1: Three-way probe result
`internal/tmux` SHALL classify a server-liveness probe three ways — `probeAlive` (the
`tmux -L <name> list-sessions` probe exited 0), `probeDead` (fast non-timeout failure: a
dead/absent socket refuses immediately), and `probeTimeout` (the probe's context deadline
was hit — the server is busy or hung, NOT proven dead). Classification MUST key on the
probe context: after `cmd.Run()`, a failure with `probeCtx.Err() == context.DeadlineExceeded`
is `probeTimeout`; any other failure is `probeDead`; success is `probeAlive`. The
classification step SHALL be a pure, unit-testable function over `(runErr, ctxErr)`.

- **GIVEN** a socket whose tmux server answers `list-sessions` within the 2s budget
- **WHEN** the probe runs
- **THEN** the result is `probeAlive`

- **GIVEN** a dead socket file (connection refused — no tmux process behind it)
- **WHEN** the probe runs
- **THEN** it fails fast (well under the deadline) and the result is `probeDead`

- **GIVEN** a live tmux server too busy to answer within the 2s budget
- **WHEN** the probe's context deadline expires and the child is killed
- **THEN** the result is `probeTimeout`, distinct from `probeDead`

#### R2: ListServers keeps timeout servers (retry once, then include)
`ListServers` SHALL treat the three probe results distinctly inside its existing 10-slot
bounded concurrent probe loop: `probeAlive` → keep; `probeDead` → drop (unchanged — dead-
socket detection stays fast and authoritative); `probeTimeout` → retry exactly once with a
fresh probe budget, classifying the retry normally, and a retry that ALSO times out
**keeps the name in the list** (live-but-busy is the truthful default; a genuinely dead
socket refuses instantly and never reaches this path). The policy MUST be stateless per
request — no last-known-state cache (Constitution II; the project's no-in-memory-cache
convention).

- **GIVEN** a live server whose first probe times out under load
- **WHEN** `ListServers` runs
- **THEN** the server appears in the returned list (via retry success or timeout-include)
- **AND** the frontend's `resolveServerView` no longer renders "Server not found" for it

- **GIVEN** a dead socket in `/tmp/tmux-{uid}/`
- **WHEN** `ListServers` runs
- **THEN** the name is dropped exactly as today (no retry, no inclusion)

#### R3: probeServerAlive byte-identical for other consumers
`probeServerAlive` SHALL keep its exact signature and observable semantics (`true` iff
one probe attempt exits 0 within 2s) for its existing consumers — the reaper's
kill-vs-remove probe seam (`reapCandidates`, `internal/tmux/reaper.go`) and
`stampManagedOnBirth`'s pre-probe. It MAY be re-expressed as a thin wrapper over the
classifying probe. Only `ListServers` consumes the three-way classification.

- **GIVEN** the reaper classifying a matched candidate via its probe seam
- **WHEN** this change lands
- **THEN** `reapCandidates`/`classifyReap` behavior and `reaper.go` are unchanged

### tmux: Batched per-server marks read (D.2)

#### R4: ReadServerMarks — one dump exec, dual-read taxonomy preserved
`internal/tmux` SHALL expose a batched reader for the `/api/servers` fan-out:

```go
type ServerMarks struct {
    Rank      *int // @rk_srv_rank; nil when unset
    Ephemeral bool // @rk_srv_ephemeral, legacy @rk_ephemeral
    Protected bool // @rk_srv_protected, legacy @rk_protected
    Managed   bool // @rk_srv_managed (no legacy name)
}
func ReadServerMarks(ctx context.Context, server string) (ServerMarks, error)
```

implemented as **one** `show-options -s` exec per server (via `tmuxExecRawServer`, under
`TmuxTimeout`), parsed by a pure, unit-testable function over the dump text. The parse
MUST preserve the dual-read taxonomy (`readServerMarkDual`, `GetServerRank`):

- New-name-first: a mark is truthy when the new option is present with a non-empty
  trimmed value; when the new name is **absent from the dump**, the legacy name
  (`LegacyEphemeralOption` / `LegacyProtectedOption`) is consulted the same way —
  absence-from-dump is the batched equivalent of the "invalid/unknown option" stderr.
- Dump values MAY be tmux-quoted (`@rk_srv_rank "3"`); surrounding double quotes are
  stripped before interpretation.
- Rank: `strconv.Atoi` of the (unquoted, trimmed) `@rk_srv_rank` value; absent ⇒ `nil`;
  a malformed value returns a wrapped error (mirroring `GetServerRank`).
- A dump failure matching `IsServerGone` returns `ServerMarks{}` with a nil error —
  liveness is the caller's concern; a gone server is never marked.
- Other subprocess failures propagate wrapped.

- **GIVEN** a server with only `@rk_ephemeral 1` set (legacy name, new name unset)
- **WHEN** `ReadServerMarks` runs
- **THEN** `Ephemeral` is true via the legacy fallback

- **GIVEN** a server with `@rk_srv_protected 1` set
- **WHEN** `ReadServerMarks` runs
- **THEN** `Protected` is true from the new name without consulting the legacy name

- **GIVEN** a server killed mid-walk (dump stderr matches `IsServerGone`)
- **WHEN** `ReadServerMarks` runs
- **THEN** it returns `ServerMarks{}` and a nil error

#### R5: Existing per-option exports unchanged
`GetServerRank`, `IsEphemeralServer`, `IsProtectedServer`, `IsGuardedServer`,
`IsManagedServer`, and `readServerMarkDual` SHALL remain unchanged — their other
consumers (reaper `enumerateMarkedServers`, snapshotter, doctor, kill/protect/adopt
handlers) keep per-option semantics.

- **GIVEN** the kill/protect/adopt handlers and the reaper
- **WHEN** this change lands
- **THEN** their call sites and behavior are untouched

### api: Handler read depth (D.2)

#### R6: handleServersList uses the batched read; contract unchanged
`handleServersList`'s per-server goroutine SHALL run exactly two tmux execs —
`ListSessions` + `ReadServerMarks` (down from 5–8). The `rk-daemon` production server
reports `Protected: true` / `Managed: true` **by derivation before any tmux marks
consultation** (the `IsGuardedServer`/`IsManagedServer` short-circuit, relocated to the
handler or a thin helper). Per-server failure handling keeps the no-5xx stance: a
`ListSessions` failure yields `sessionCount: 0`/`windowCount: 0`; a `ReadServerMarks`
failure logs at warn and yields `rank: null` + all-false flags (except the daemon's
derived true flags). The response contract is byte-identical: `serverInfo` JSON shape,
alphabetical `sort.Slice` order, `[]` (never `null`) on empty discovery. The `TmuxOps`
seam gains `ReadServerMarks` (interface + `prodTmuxOps` + `mockTmuxOps`).

- **GIVEN** a server with rank 3, the ephemeral mark, and no protection
- **WHEN** `GET /api/servers` runs
- **THEN** the entry reads `{rank: 3, ephemeral: true, protected: false, managed: false}`
  computed from one `ReadServerMarks` call

- **GIVEN** the `rk-daemon` entry with `ReadServerMarks` failing
- **WHEN** the handler composes its entry
- **THEN** `protected: true` and `managed: true` still hold (derivation, not option read)

- **GIVEN** any per-server read failure
- **WHEN** the handler responds
- **THEN** the response is 200 with zero-value fields for that entry, never a 5xx

### Non-Goals

- The SSE poll loop's identical failure shape (`IsServerGone` classification in
  `api/sse.go` emitting `gone` and evicting cache) — owned by Changes B/C.
- Socket-file hygiene for the stale `rk-test-*` graveyard — owned by Change E.
- Any change to the reaper's kill-vs-remove matrix or `stampManagedOnBirth`.
- Frontend changes — the fix makes the existing `resolveServerView` behave.

### Design Decisions

#### Stateless timeout-keep (retry-once-then-include)
**Decision**: On probe timeout, retry once with a fresh budget; a second timeout keeps
the server listed. No last-known-state cache.
**Why**: Constitution II + the code-quality no-in-memory-cache principle; the failure
asymmetry favors inclusion (a ghost entry self-heals next request; a vanished live server
breaks navigation — the 2026-09-04 incident).
**Rejected**: Carrying a last-known-alive set across requests — an in-memory cache with
staleness questions, for no gain over the stateless policy.
*Introduced by*: 260904-p2kp-servers-probe-timeout-batch-reads

#### Batch via one show-options dump, not intra-goroutine parallelization
**Decision**: `ReadServerMarks` replaces four option reads with one `show-options -s`
dump parsed in Go.
**Why**: The cost driver is exec/fork count under a fork storm; parallelizing keeps 5–8
forks per server, batching drops to 2.
**Rejected**: Parallelizing the per-option reads inside the goroutine — same fork count,
merely overlapped.
*Introduced by*: 260904-p2kp-servers-probe-timeout-batch-reads

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/tmux/tmux.go`, add the `probeResult` type and the classifying probe (`probeServer(ctx, name) probeResult`) with the classification extracted as a pure function over `(runErr, ctxErr)`; re-express `probeServerAlive` as a thin `== probeAlive` wrapper with byte-identical semantics <!-- R1, R3 -->
- [x] T002 In `app/backend/internal/tmux/tmux.go` `ListServers`, consume the three-way result inside the existing 10-slot probe loop: keep alive, drop dead, retry timeout once (fresh budget) and include on second timeout; extract the per-candidate keep/drop decision so it is unit-testable without live servers <!-- R2 -->
- [x] T003 [P] In `app/backend/internal/tmux/tmux_test.go`, add unit tests for the pure classification function (exit-0 ⇒ alive; non-timeout failure ⇒ dead; deadline-exceeded ⇒ timeout) and for the ListServers keep/drop decision (alive keep, dead drop, timeout→retry-alive keep, timeout→retry-timeout keep) <!-- R1, R2 -->
- [x] T004 In `app/backend/internal/tmux/tmux.go`, add `ServerMarks` + `ReadServerMarks(ctx, server)` implemented as one `tmuxExecRawServer(ctx, server, "show-options", "-s")` call and a pure dump parser applying the dual-read taxonomy (new-name-first, legacy fallback on absence, quote stripping, rank Atoi with wrapped error, IsServerGone ⇒ zero-value + nil, other failures wrapped) <!-- R4 -->
- [x] T005 [P] In `app/backend/internal/tmux/tmux_test.go`, add dump-parser unit tests: new-name set, legacy-only set (fallback fires), both absent, both set (new wins), quoted values, malformed rank error, empty dump, gone-server taxonomy (error path exercised via the exported func where feasible) <!-- R4 -->
- [x] T006 In `app/backend/api/router.go`, add `ReadServerMarks(ctx context.Context, server string) (tmux.ServerMarks, error)` to the `TmuxOps` interface and `prodTmuxOps`; add the method to `mockTmuxOps` in `app/backend/api/sessions_test.go` following its existing per-method stub pattern <!-- R6 -->
- [x] T007 In `app/backend/api/servers.go` `handleServersList`, replace the four per-option calls with one `ReadServerMarks` call per server; apply the rk-daemon derivation short-circuit for `Protected`/`Managed` before consulting marks; keep warn-log + zero-value defaults per field and the unchanged response composition/sort <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Update `app/backend/api/servers_test.go`: rewire the rank/ephemeral/protected/managed list tests onto the `ReadServerMarks` mock; add regressions — marks-read failure yields `rank: null` + false flags with 200; rk-daemon entry reports `protected: true`/`managed: true` even when marks read fails; alphabetical-order contract still asserted <!-- R6 -->
- [x] T009 Verify no other callers broke and per-option exports are untouched (`go build ./...`, grep the reaper/snapshotter/doctor call sites), then run the verification gates: `cd app/backend && go test ./...` <!-- R3, R5 -->

## Execution Order

- T001 blocks T002; T004 blocks T006; T006 blocks T007; T007 blocks T008
- T003/T005 are parallel to the api-side tasks once their tmux.go counterparts land
- T009 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A three-way probe classification exists in `internal/tmux` with the classify step pure and unit-tested
- [x] A-002 R2: `ListServers` retries a timed-out probe once and includes the server on a second timeout; dead sockets still drop with no retry
- [x] A-003 R4: `ReadServerMarks` returns rank/ephemeral/protected/managed from exactly one `show-options -s` exec per server
- [x] A-004 R6: `handleServersList` runs exactly two tmux execs per server (`ListSessions` + `ReadServerMarks`)

### Behavioral Correctness

- [x] A-005 R2: A live-but-busy server no longer vanishes from `GET /api/servers` (regression test at the keep/drop seam)
- [x] A-006 R4: Legacy-only marks (`@rk_ephemeral`/`@rk_protected`) still read truthy via the dump parse (dual-read preserved)
- [x] A-007 R6: rk-daemon reports `protected: true`/`managed: true` by derivation even when its marks read fails

### Scenario Coverage

- [x] A-008 R1: Unit tests cover alive/dead/timeout classification including the deadline-exceeded discrimination
- [x] A-009 R4: Dump-parser tests cover new-name, legacy-fallback, both-absent, both-set precedence, quoted values, malformed rank, and gone-server taxonomy
- [x] A-010 R6: Handler tests cover marks-failure defaults (no 5xx) and the unchanged alphabetical-order contract

### Edge Cases & Error Handling

- [x] A-011 R4: Gone-server during dump ⇒ `ServerMarks{}` + nil error; malformed rank ⇒ wrapped error surfaced as `rank: null` + warn in the handler
- [x] A-012 R2: The timeout retry is stateless — no package-level or handler-level last-known cache introduced

### Removal Verification

- [x] A-013 R5: No per-option export was removed or behavior-changed; reaper/snapshotter/doctor call sites compile and behave unchanged; `probeServerAlive` semantics byte-identical

### Code Quality

- [x] A-014 Pattern consistency: New tmux funcs mirror the existing taxonomy-documenting comment style and `tmuxExecRawServer` + `TmuxTimeout` exec pattern
- [x] A-015 No unnecessary duplication: The dump parse reuses `isUnsetOptionErr`/`IsServerGone`/option-name constants; no second socket-dir or probe convention introduced
- [x] A-016 exec.CommandContext with timeouts for all subprocess calls; no shell strings
- [x] A-017 No in-memory cache introduced (derive-at-request-time preserved)
- [x] A-018 New/changed behavior is covered by tests (probe classification, keep/drop, dump parse, handler defaults)
- [x] A-019 No comment narration: comments state taxonomy/invariants, not change history

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (probe classification, batched marks read) without making existing code redundant; the per-option exports it supersedes in the `/api/servers` fan-out are deliberately retained for their other consumers (reaper, snapshotter, doctor, kill/protect/adopt handlers) per R5

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The retry probe uses a fresh 2s budget (same constant as the first attempt) | Simplest correct policy; probes run concurrently under the 10-slot semaphore so worst-case latency impact is bounded; no signal favors a different constant | S:60 R:85 A:80 D:70 |
| 2 | Confident | Testability seams are pure functions (classify over `(runErr, ctxErr)`; keep/drop decision; dump parser) rather than injected fakes | Matches the package's existing pattern (`filterSocketEntries`, `classifyReap`, `matchesServerAllowlist` are all extracted pure helpers) | S:70 R:85 A:85 D:80 |
| 3 | Confident | The daemon derivation short-circuit moves into the handler path (or a thin helper) rather than into `ReadServerMarks` | `ReadServerMarks` stays a pure option read mirroring `readServerMarkDual`'s layer; derivation is the predicate layer's concern (`IsGuardedServer` documents this split) | S:65 R:80 A:80 D:70 |

3 assumptions (0 certain, 3 confident, 0 tentative).
