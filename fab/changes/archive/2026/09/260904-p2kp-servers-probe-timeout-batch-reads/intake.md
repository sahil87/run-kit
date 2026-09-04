# Intake: Servers Probe-Timeout Fix + Batched Per-Server Reads

**Change**: 260904-p2kp-servers-probe-timeout-batch-reads
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation executing **Change D** of the daemon blocking & reliability
plan (`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md`, authored 2026-09-04 from a
live incident diagnosis + two code audits). The plan is the design conversation of record;
this change is one of six parallel wave-1 changes (disjoint files from A/B/E/F).

> Daemon reliability - Change D: /api/servers probe-timeout fix plus cheaper per-server
> reads. Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change D
> section (D.1-D.2) exactly. Files: app/backend/api/servers.go,
> app/backend/internal/tmux/tmux.go (+tests). Preserve the dual-read taxonomy for legacy
> options. Re-verify all line numbers against current HEAD before editing - plan numbers
> are as of fd16e6b4.

Key decisions carried from the plan:
- D.1: distinguish probe **timeout** from **connection-refused**; on timeout keep a
  previously-seen server (retry once / carry last-known state) instead of dropping it.
  Dead-socket detection (ECONNREFUSED) stays fast and authoritative.
- D.2: batch the 5–8 serial per-server execs in the `/api/servers` fan-out into one
  `show-options`-shaped exec per server (or parallelize within the goroutine).
  **Preserve the dual-read taxonomy** for legacy option names.
- Line numbers re-verified at HEAD `b53e0cad` during intake (all references below are
  current; the plan's fd16e6b4 numbers had drifted by ~4 lines in tmux.go).

## Why

**The incident (2026-09-04)**: during a heavy `go test` run in a sibling worktree, the
dashboard intermittently rendered "Server not found" for the live `rK` server, and
`/api/servers` sat at a flat ~350ms while `/api/sessions` answered in 8ms. tmux itself was
never slow (`display-message` ≤15ms across 90 samples during the incident) — the time is
lost in the daemon's own exec queueing under a fork storm.

1. **Problem (D.1)**: `probeServerAlive` (`tmux.go:3034-3039`) runs one
   `tmux -L <name> list-sessions` under a 2s ceiling and returns `cmd.Run() == nil` — a
   deadline kill (`signal: killed`) is indistinguishable from a dead socket
   (ECONNREFUSED → "no server running…"). On any failure `ListServers`
   (`tmux.go:3115-3163`) silently drops the name, so a **live-but-busy server vanishes
   from `GET /api/servers`** and the frontend's `resolveServerView` — fed only by that
   endpoint (`session-context.tsx:670`) — renders "Server not found" for a healthy server.
2. **Problem (D.2)**: the handler (`servers.go:53-139`) fans out **across** servers
   concurrently, but **within** one server runs 5–8 serial execs: `ListSessions`,
   `GetServerRank`, `IsEphemeralServer` (1–2 — dual-read re-reads the legacy name when the
   new one is unset, which is the common case), `IsGuardedServer` → `IsProtectedServer`
   (1–2), `IsManagedServer` (1). Under load each exec queues behind the fork storm, so
   per-server latency stacks and the endpoint owns the ~350ms floor together with the
   stale-socket graveyard (Change E's territory).
3. **If unfixed**: every future heavy test run or fork storm makes live servers flicker
   out of the UI (worse than showing stale counts), and `/api/servers` stays the most
   expensive read in the API for reasons proportional to exec count, not data size.
4. **Why this approach**: timeout and connection-refused are *different facts* — a dead
   socket refuses instantly and can stay authoritative-and-fast, while a timeout only
   means "no answer within budget", where dropping is the wrong default (the failure
   asymmetry: a ghost entry self-heals on the next request; a vanished live server breaks
   navigation). Batching option reads attacks the actual cost driver (exec count) without
   changing the response contract.

## What Changes

### D.1 — probe timeout classified distinct from dead socket (`internal/tmux/tmux.go`)

Introduce a classifying probe alongside `probeServerAlive`, e.g.:

```go
type probeResult int

const (
    probeAlive   probeResult = iota // list-sessions exited 0
    probeDead                       // fast failure: dead/absent socket (IsServerGone-shaped stderr, ECONNREFUSED)
    probeTimeout                    // context deadline hit — server busy or hung, NOT proven dead
)

func probeServer(ctx context.Context, name string) probeResult
```

Classification: after `cmd.Run()`, `probeCtx.Err() == context.DeadlineExceeded` ⇒
`probeTimeout`; a non-timeout failure ⇒ `probeDead` (today's fast dead-socket path —
stderr matching stays available via `containsServerGoneText` if needed, but exit-error
without deadline is sufficient since a dead socket refuses instantly); success ⇒
`probeAlive`.

`ListServers` consumption changes (`tmux.go:3115-3163`, inside the existing 10-slot
bounded concurrent probe loop):
- `probeAlive` → keep (unchanged).
- `probeDead` → drop (unchanged — dead-socket detection stays fast and authoritative).
- `probeTimeout` → **retry once** (fresh 2s budget); a retry that answers is classified
  normally; a retry that also times out **keeps the name in the list** (live-but-busy is
  the truthful default — a genuinely dead socket would have refused instantly). No
  last-known-state cache is introduced (Constitution II / the project's no-in-memory-cache
  convention); the retry-then-include policy is stateless per request.

**Blast-radius guard**: `probeServerAlive` keeps its exact current signature and
semantics for its other consumers — the reaper's kill-vs-remove classification
(`reapCandidates` threads it as the probe seam, `internal/tmux/reaper.go`) and
`stampManagedOnBirth`'s pre-probe (`tmux.go:3578`). It becomes a thin wrapper
(`probeServer(...) == probeAlive`) or stays as-is; either way its observable behavior is
byte-identical. Only `ListServers` consumes the three-way classification.

Out of scope (owned by Changes B/C): the SSE poll loop's same-shaped failure
(`IsServerGone` classification of transient fetch errors in `api/sse.go` emitting `gone`
and evicting cache). This change touches only `servers.go` + `tmux.go`.

### D.2 — batched per-server reads in the `/api/servers` fan-out (`servers.go` + `tmux.go`)

Add one batched reader to `internal/tmux` that replaces the four per-option reads
(`GetServerRank`, `IsEphemeralServer`, `IsGuardedServer`'s option leg, `IsManagedServer`)
with **one exec per server**:

```go
// ServerMarks is the batched per-server option read for the /api/servers fan-out.
type ServerMarks struct {
    Rank      *int // @rk_srv_rank; nil when unset/unparseable-absent
    Ephemeral bool // @rk_srv_ephemeral, legacy @rk_ephemeral
    Protected bool // @rk_srv_protected, legacy @rk_protected
    Managed   bool // @rk_srv_managed (no legacy name)
}

func ReadServerMarks(ctx context.Context, server string) (ServerMarks, error)
```

Implementation: one `tmux -L <server> show-options -s` dump, parsed line-wise
(`name value` pairs). The **dual-read taxonomy is preserved in the parse**, mapping
`readServerMarkDual`'s per-exec semantics (`tmux.go:3434-3449`) onto dump absence:

- **New-name-first**: a mark is truthy when the new name (`@rk_srv_ephemeral` /
  `@rk_srv_protected`) is present with a non-empty trimmed value; when the new name is
  **absent from the dump**, the legacy name (`@rk_ephemeral` / `@rk_protected`) is
  consulted the same way. (Absence-from-dump is the batched equivalent of the
  "invalid option/unknown option" unset stderr.)
- **Gone server** → zero values, nil error: a dump failure matching `IsServerGone` returns
  `ServerMarks{}` with no error — liveness is the caller's concern and a gone server is
  never marked (exact mirror of `readServerMarkDual` and `GetServerRank`'s taxonomy,
  `tmux.go:3330-3356`).
- **Other subprocess failures** propagate wrapped (caller logs warn, defaults apply —
  the handler's existing no-5xx stance).
- **Rank**: parsed from `@rk_srv_rank` (`strconv.Atoi` of the trimmed value); absent ⇒
  `nil`; a malformed value propagates a wrapped error exactly as `GetServerRank` does
  today (so the handler's warn-and-null path is preserved).
- **Value quoting**: tmux's `show-options` dump may quote values (`@rk_srv_rank "3"`);
  the parser must trim quotes — cover this in tests with real dump-shaped fixtures.

Handler changes (`servers.go:70-135`): the per-server goroutine becomes
`ListSessions` + `ReadServerMarks` — **depth 5–8 → 2 execs**. Derivation short-circuits
stay in the handler or a thin predicate: the `rk-daemon` production server reports
`Protected: true` / `Managed: true` **by derivation before any tmux read**, exactly as
`IsGuardedServer` (`tmux.go:3513-3518`) and `IsManagedServer` (`tmux.go:3553-3556`)
short-circuit today. Per-field warn logging on failure and zero-value defaults are
preserved (`sessionCount: 0` / `rank: null` / flags `false`; no 5xx). Response shape,
alphabetical `sort.Slice` order (an asserted API contract, `servers_test.go`), and the
empty-list `[]` (never `null`) behavior are byte-identical.

The existing exported single-option functions (`GetServerRank`, `IsEphemeralServer`,
`IsProtectedServer`, `IsGuardedServer`, `IsManagedServer`, `readServerMarkDual`) are
**not removed or changed** — their other consumers (reaper `enumerateMarkedServers`,
snapshotter, doctor, kill/protect/adopt handlers) keep the per-option semantics.
If the `TmuxOps` seam in the api package currently exposes the per-option methods for
this handler, the seam gains `ReadServerMarks` and the handler switches to it.

### Tests

- `internal/tmux`: unit tests for the probe classification (timeout vs fast-fail —
  fakeable via a stub command or by extracting the classify step as a pure function on
  `(runErr, ctxErr)`), and for the `ReadServerMarks` dump parser as a pure function over
  dump text: new-name set, legacy-only set (dual-read fallback), both absent, quoted
  values, malformed rank, gone-server error taxonomy.
- `api`: `servers_test.go` regression — a server whose probe times out **stays in the
  list**; a dead-socket server is dropped; batched-read failure yields the zero-value
  entry with no 5xx; alphabetical order contract still asserted.
- Standard verification gates per `fab/project/code-quality.md` § Verification
  (`just test-backend` at minimum).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) § socket-dir helpers table — `probeServerAlive` row
  gains the classifying sibling and `ListServers`' timeout-retains semantics ("only
  sockets whose probe succeeds" is no longer the full story); § Server-Scoped User
  Options reader column — `GET /api/servers` fan-out now reads marks via the batched
  `ReadServerMarks` dump instead of per-option `readServerMarkDual` calls.
- `run-kit/api-and-sockets`: (modify) `GET /api/servers` row — the per-server fan-out
  description (read depth 2: `ListSessions` + one batched `show-options -s` dump;
  timeout-kept servers; unchanged response/order/no-5xx contract).
- `run-kit/test-sockets`: (modify) small — the reaper's probe seam note stays true
  (`probeServerAlive` unchanged), but the `/api/servers`-lists-every-server section's
  cost note (per-socket probe) should reflect the timeout-retry behavior.

## Impact

- `app/backend/internal/tmux/tmux.go` — classifying probe + `ReadServerMarks`; existing
  exports untouched. `app/backend/internal/tmux/*_test.go` — new unit tests.
- `app/backend/api/servers.go` — `handleServersList` per-server goroutine rewired to the
  batched read + daemon derivation short-circuit; `app/backend/api/servers_test.go` —
  regression tests. The `TmuxOps` seam gains one method.
- **No API contract change**: `serverInfo` JSON shape, alphabetical order, `[]`-never-
  `null`, and the no-5xx stance are all preserved; the frontend is untouched.
- Consumers deliberately untouched: reaper (`reaper.go`), snapshotter, doctor,
  kill/protect/adopt handlers, `api/sse.go` (Changes B/C own the poll loop), board
  enumeration (rides `ListServers` and simply inherits the timeout-retains behavior).
- Behavior change visible to users: a busy server now stays listed (possibly with
  zero/stale counts for one request) instead of flickering to "Server not found";
  `/api/servers` exec count per server drops from 5–8 to 2.

## Open Questions

- None — the plan section is prescriptive, and the two design-freedom points
  (timeout-keep mechanism; batch vs parallelize) resolve cleanly from the constitution
  (stateless retry-then-include; batching, since parallelizing would keep the fork
  count that is the actual problem). Recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Probe timeout is classified distinct from dead socket; ECONNREFUSED/dead-socket drop stays fast and authoritative | Stated verbatim in plan D.1 | S:90 R:75 A:90 D:90 |
| 2 | Confident | Timeout-keep mechanism: stateless retry-once, then include on second timeout — no last-known-state cache | Plan offers "retry once / carry last-known state"; Constitution II + the project's no-in-memory-cache convention rule out the cache; failure asymmetry (ghost entry self-heals, vanished live server breaks navigation) favors include | S:70 R:75 A:75 D:60 |
| 3 | Confident | `probeServerAlive` keeps byte-identical semantics for reaper/`stampManagedOnBirth`; only `ListServers` consumes the three-way classification | Minimal blast radius; the reaper's kill-vs-remove matrix and the birth-stamp pre-probe are out of the plan's scope and are correctness-sensitive | S:60 R:80 A:80 D:70 |
| 4 | Confident | D.2 uses one `show-options -s` dump per server (batch), not intra-goroutine parallelization | Plan offers either; the cost driver is exec/fork count, which parallelizing preserves and batching eliminates (5–8 → 2 per server) | S:70 R:70 A:80 D:70 |
| 5 | Certain | Dual-read taxonomy preserved in the dump parse: new-name-first, legacy fallback on absence, gone-server ⇒ zero values + nil error, other failures wrapped | Explicit user instruction + `readServerMarkDual`/`GetServerRank` document the taxonomy precisely (tmux.go:3330-3449) | S:95 R:80 A:90 D:90 |
| 6 | Certain | rk-daemon derivation short-circuits (`Protected`/`Managed` true before any tmux read) preserved | `IsGuardedServer`/`IsManagedServer` document the derivation as non-negotiable (never an option read) | S:85 R:85 A:95 D:95 |
| 7 | Certain | API response contract unchanged: `serverInfo` shape, alphabetical sort, `[]` never `null`, no-5xx per-field defaults | Asserted contract in `servers_test.go` + memory api-and-sockets row; the change is cost/classification only | S:85 R:80 A:95 D:90 |
| 8 | Confident | Existing per-option exports (`GetServerRank`, `IsEphemeralServer`, …) remain unchanged alongside the new batched reader | Their other consumers (reaper, snapshotter, doctor, mutation handlers) are out of scope; removing them would widen the diff against the plan's file list | S:65 R:75 A:85 D:75 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
