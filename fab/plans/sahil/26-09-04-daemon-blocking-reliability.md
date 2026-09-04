# Plan: Daemon blocking & reliability — six changes

**Authored**: 2026-09-04
**Author**: discussion session with Claude (live incident diagnosis + two code audits)
**Executor**: the operator, dispatching agents per change via the normal fab pipeline
(`/fab-new` → `/fab-fff`), each change in its own worktree.
**Status**: Changes A, B, D, E, F open for pickup **in parallel** (disjoint files).
**C only after B merges** (same file, `api/sse.go`; C is structural, B is surgical).
**All line numbers are as of `fd16e6b4`** — re-verify before editing.

## Context — the incident (2026-09-04)

Symptoms: navigating to a terminal tab left the switch mask ("waiting logo") up for
seconds; the UI intermittently failed to detect the `rK` server. Live evidence gathered
while it was happening:

- Daemon log (`~/.cache/rk/daemon.log`): `SSE poll error err="signal: killed" server=rK`,
  `read @rk_srv_ephemeral: signal: killed`, `terminals: window not found windowID=@20
  err="context deadline exceeded"` — the daemon's own tmux execs dying at their context
  deadlines.
- The `rK` tmux server answered `display-message` in **≤15ms across 90 samples during the
  incident** — tmux was never slow; time is lost inside the daemon (queueing + fork storm).
- 16 cores, load ~5 — no CPU starvation.
- **~71 `[tmux: client] <defunct>` zombies** under the daemon, growing a few per minute of
  tab navigation (in pairs — the frontend ghost-gap probe reconnect tears down twice,
  `terminal-client.tsx:870-874`).
- `/tmp/tmux-1001/` held **2,682 socket files, 2,675 stale `rk-test-*`** (2,084 from one
  day of test runs). e2e teardown kills servers but never removes socket files.
- `/api/servers` flat ~350ms; `/api/sessions` 8ms.
- A `go test ./cmd/rk/` run (any worktree) creates several tmux test servers **per
  second**, each entering the daemon's sequential poll workload — this is why heavy work
  in one worktree ("sturdy-caracal") degraded the whole dashboard.

Root causes, each owned by one change below: un-reaped relay children (A), data races
that can kill the daemon + a 12s cold-subscribe hole (B), single-goroutine sequential
poll (C), probe-timeout treated as server death (D), socket-file graveyard (E), serial
`git rev-parse` storm inside the poll (F).

### Operator prelude (ops relief, before/alongside the changes)

1. Restart the daemon (clears the accumulated zombies; they re-accumulate until A lands).
2. Sweep dead socket files:
   `for s in /tmp/tmux-$(id -u)/rk-test-*; do tmux -S "$s" list-sessions >/dev/null 2>&1 || rm -f "$s"; done`
   (re-degrades until E lands).

---

## Change A — terminal relay: reap children, gate the pre-attach reload

**Files**: `app/backend/api/terminals_ws.go` (+ its tests).
**One question for review**: *is `cmd.Wait()` called exactly once on every path a child
was forked, and does no attach regress when the reload is skipped?*

### A.1 — reap the pty tmux client (zombie + goroutine leak)

The relay kills but never waits: `stream.teardown()` (`terminals_ws.go:837-850`, `Kill()`
at `:847`) and the publish-race branch (`:538-546`, `Kill()` at `:544`). Zero `cmd.Wait()`
in the file — the only correct kill+reap in the repo is `internal/tmuxctl/client.go:317-322`
(kill, then Wait; contract documented at `client.go:37-38`). Consequences today: one
zombie PID **plus one permanently parked `os/exec` watchCtx goroutine** per closed
stream (unbuffered `resultc` send only `Wait` receives); at the fork ceiling every exec
in the daemon fails at once.

Fix: after a successful `pty.StartWithSize`, ensure exactly one owner reaps — e.g. the
attach goroutine defers `cmd.Wait()` post-kill, or teardown does kill→Wait like tmuxctl.
`Wait` must be called by exactly one goroutine per `Cmd`. Cover both paths (normal
teardown and the publish race). Add a regression test that closes a stream and asserts
the child is reaped (no `Z` state / `Wait` returned).

### A.2 — take the per-attach config reload off the critical path

`attachStream` runs `reloadConfigForAttach` synchronously before the pty attach
(`terminals_ws.go:521` call site; func at `:387-424`): `IsManagedServer` (1 exec,
background ctx, 10s budget) + `tmux.ReloadConfig` → `source-file` of the whole managed
tmux.conf (1 exec, 10s budget) — **on every attach**. The legacy-option sweep inside it
is already once-guarded and async; the managed-check + reload are not. The switch mask
arms at 300ms and lifts only on the first PTY byte (`window-transition.ts:80`,
`terminal-client.tsx:1100-1111`), so these two execs sit directly under the waiting logo.

Fix options (pick in apply): per-server once-guard like the sweep already has (config is
hash-stamped — see `docs/memory/run-kit/configuration.md`, reload only when the stamp
differs), or move the reload fully async (attach proceeds with current conf; comment at
`:389-393` already declares reload best-effort). Keep the managed-only gate semantics.

---

## Change B — sseHub: fix the races, wake on cold subscribe

**Files**: `app/backend/api/sse.go`, `app/backend/api/tmuxctl_bridge.go` (+ tests).
**One question for review**: *is every `h.cache` access now under a consistent lock, and
does a cold subscribe get a snapshot promptly without waking storms?*

### B.1 — `h.cache` unsynchronized map access (daemon-killer)

`poll()` accesses `h.cache` (`sse.go:229`) **without** `h.mu`: `delete` at `:1416`, read
at `:1420`, write at `:1438`. Handler goroutines access it **under** `h.mu`:
`sendCachedPreviewLocked` (`:1157`, reached from subscribe/preview-scope) and the
dead-server reap (`:1676`). A detected concurrent map read/write is a Go runtime
**throw** — the whole daemon dies. There is also a value-level race: `attachPRStatus`
(`:1459`, documented at `:1447` as mutating cached `WindowInfo` in place) vs readers.
Fix: consistent locking (or move cache ownership entirely into the poll goroutine and
hand out copies).

### B.2 — `subscriber` field race

`s.sseHub.subscriber = sub` is a plain write (`tmuxctl_bridge.go:209`) racing `poll()`'s
reads (`sse.go:384,393,1869,1871`). Set before the hub starts or guard it.

### B.3 — cold subscribe waits out the 12s safety timer

`stateSubscribe`/`addClient` never call `h.wake(key)` (all wake call sites are mutation
handlers). If `poll()` is parked in `waitForNext` (`:1859`) on the *previous* server
list, a newly-subscribed server's first snapshot waits up to `safetyPollInterval = 12s`
(`sse.go:80`; gate at `:380-405`). Fix: when the subscribe ack finds no
`previousJSON[key]` (`:723-745`), wake the loop for that server.

Run B's tests with `-race` in CI scope for this package if not already.

---

## Change C — poll loop: bound the head-of-line blocking *(after B merges)*

**Files**: `app/backend/api/sse.go` (+ tests). Structural; design freedom in apply.
**One question for review**: *can one slow server still delay another server's snapshot
or the global broadcasts?*

`poll()` (`sse.go:1349`) is the only snapshot producer and walks servers **sequentially**
(`:1403`): per server `FetchSessions` (background ctx, up to 10s of inner execs, `:1424`)
then `capturePreviews` — one `capture-pane` exec per expanded window, serial (`:1538`).
Host-global broadcasts (metrics/services/code-server, `:1701-1745`) are emitted only
after the whole loop — one hung server freezes every tab's metrics. During a `go test`
run creating servers at >1/s, the loop's workload multiplies and `rK`'s snapshot goes
stale (the incident's `signal: killed` poll errors).

Direction: fan the per-server body out with bounded concurrency (respect per-tmux-server
single-threadedness — parallelism *across* servers, never within one), emit each server's
events as it completes, and move the global broadcasts ahead of / independent of the
server loop. Consider a per-tick time budget so one server cannot own the tick.

---

## Change D — `/api/servers`: probe-timeout ≠ dead, cheaper per-server reads

**Files**: `app/backend/api/servers.go`, `app/backend/internal/tmux/tmux.go` (+ tests).
**One question for review**: *can a live-but-busy server still silently vanish from the
list, and did the read batching preserve each option's dual-read semantics?*

### D.1 — a busy server is silently declared dead

`probeServerAlive` (`tmux.go:3030-3038`): one `list-sessions` with a 2s ceiling; on
timeout the name is silently dropped from `ListServers` → the frontend renders "Server
not found" (`resolveServerView`, fed only by `GET /api/servers`,
`session-context.tsx:670`). The poll loop has the same failure shape: transient fetch
errors classified by `IsServerGone` (`sse.go:1426-1432`) emit `gone` and evict cache.
Fix: distinguish timeout from connection-refused; on timeout keep a previously-seen
server (retry once / carry last-known state) instead of dropping it. Dead-socket
detection (ECONNREFUSED) stays fast and authoritative.

### D.2 — per-server read depth

The handler already fans out **across** servers (`servers.go:70-135`), but within one
server runs 5–8 serial execs: `ListSessions`, `GetServerRank`, `IsEphemeralServer` (1–2:
dual-read re-reads the legacy name when unset — the common case, `tmux.go:3427-3455`),
`IsGuardedServer` (1–2), `IsManagedServer`. Batch these into one `show-options`-shaped
exec per server (or parallelize within the goroutine) — depth 5–8 → 1–2. Preserve the
dual-read taxonomy.

---

## Change E — test-socket file hygiene

**Files**: `scripts/test-e2e.sh`, the Go test TestMain sweeps
(`docs/memory/run-kit/test-sockets.md` owns the inventory), optionally `rk mux reap`.
**One question for review**: *does teardown remove exactly the socket files whose servers
it just killed, and does `rk mux reap` clean files for already-dead servers?*

Teardown kills servers but leaves socket files (`test-e2e.sh:60-70`): 2,675 stale files
accumulated, and `/api/servers` probes the graveyard every request (ScanSocketDir at
`tmux.go:2992` + probe per socket, 10-concurrent) — the ~350ms floor. Note
`servers.go:55-58`: the test-socket hide filter was deliberately deleted; `rk mux reap`
is the intended cleaner — so file removal belongs in (a) every teardown path after
`kill-server` (`rm -f` the socket; tmux does not remove it for killed servers), (b)
`rk mux reap`, which should also unlink socket files of dead servers it encounters, and
(c) the seven-package TestMain POST-sweep. Constitution II is untouched — socket files
are tmux's state, not rk's.

---

## Change F — damp the serial git-fallback storm in FetchSessions

**Files**: `app/backend/internal/sessions/sessions.go` (+ tests).
**One question for review**: *does a pane in a real repo still get a correct branch
promptly, and does a non-repo cwd no longer trigger subprocess fallbacks on a cycle?*

`resolveGitBranches` (`sessions.go:329-396`): a cwd whose `.git` stat fails takes the
`git rev-parse` subprocess fallback (250ms cap each, `gitBranchCmdTimeout` at `:162`),
serially, up to `gitBranchResolveLimit = 16` per fetch (`:161`) — worst case **4s of
serial execs inside the poll goroutine**, re-armed every 15s by the negative TTL for
every non-repo pane (`~`, `/tmp`, …). Fix: treat a clean "no `.git` ancestor" stat walk
as an authoritative negative with a much longer TTL (subprocess fallback reserved for
*unparseable* `.git` shapes), and/or resolve misses concurrently with a small bound.

---

## Parallelism & merge order

```
Wave 1 (parallel, disjoint files):
  A  api/terminals_ws.go
  B  api/sse.go, api/tmuxctl_bridge.go
  D  api/servers.go, internal/tmux/tmux.go
  E  scripts/, TestMain sweeps, rk mux reap
  F  internal/sessions/sessions.go

Wave 2 (after B merges):
  C  api/sse.go   — rebase on B; structural rework of poll()
```

Priority within wave 1 if serialized by capacity: **A** (stops the slow-motion daemon
death and the waiting logo), then **B** (crash-class races), then **D**, **E**, **F**.

Every change: standard verification gates (`code-quality.md` § Verification); A and B
should add/keep `-race` coverage on the touched packages.
