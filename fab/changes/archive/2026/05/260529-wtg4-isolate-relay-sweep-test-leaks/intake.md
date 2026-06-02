# Intake: Isolate Relay Sweep & Stop Test Artifact Leaks

**Change**: 260529-wtg4-isolate-relay-sweep-test-leaks
**Created**: 2026-05-29
**Status**: Draft

## Origin

> fix: isolate relay sweep to owner PID + glob-kill all rk-e2e* sockets in e2e teardown + TestMain pre-sweep of dead-PID test sockets — stop e2e/air-rebuild rk serve from killing live dashboard relays, and stop secondary rk-e2e-* tmux servers leaking on crash/Ctrl-C

This change originated from a `/fab-discuss` investigation into why e2e (and some Go) tests leave behind tmux servers/sockets, which had prompted a backlog item `[fww2]` for an "rk reaper" startup-sweep command. The investigation traced the leakage to its source rather than treating the reaper as the fix. Two parallel Explore agents mapped the Go-test server lifecycle and the e2e harness; their findings were then manually verified against the actual source (one agent claim — "`t.Skip` before `t.Cleanup` leaks" — was checked and found to be a **false alarm**: the skips fire before any server exists).

Key decisions reached conversationally:

1. **The relay sweep is not just a leak — it is a destructive cross-instance bug.** `rk serve` startup runs `sweepOrphanedRelaySessions` across **all** tmux servers (via `tmux.ListServers`, which scans `/tmp/tmux-{uid}/`), killing every `rk-relay-*` session it finds. Starting an e2e run (or any second `rk serve`, or an `air` rebuild under `just dev`) therefore kills the **live** relay ephemerals of a real running dashboard, dropping its open terminal connections.
2. **Read-side visibility is intentionally preserved.** The user explicitly rejected scoping `ListServers`/`/api/servers` to the e2e socket — seeing `rk-e2e-*` servers in the UI is desirable ("as long as I know they're temporary"); hiding them would mask exactly this class of bug. The fix is **write-side only**: stop the cross-socket *reaping*, keep the cross-socket *listing*.
3. **Ownership model = PID + `kill(pid,0)`.** Relays will be stamped with the owning `rk serve` PID at creation; the sweep reaps a relay only when its owner PID is missing or dead. Chosen over a `host:port` owner model because it is simplest, its failure direction is safe (leak-not-kill), and it mirrors the reaper's own planned PID-liveness approach.
4. **Scope is bounded.** The user confirmed *not* widening this to add ownership guards on the user-driven `KillServer`/`KillSession` API paths — those are intentional, user-initiated, and no test targets them. Real **named** sessions and servers are already safe from any automatic kill path; only relay ephemerals are at risk today.
5. **The "rk reaper" (`[fww2]`) is a parallel task, out of scope here.** This change closes the leak at the source so the reaper becomes a thin safety net rather than the primary fix.

## Why

**The problem.** Three distinct defects cause tests (and ordinary dev workflows) to disturb the system and leave residue:

1. **Cross-instance relay destruction (correctness/UX bug — highest severity).** `cmd/rk/serve_sweep.go:sweepOrphanedRelaySessions` iterates *every* live tmux socket and kills *every* `rk-relay-*` session, with no notion of which instance owns the relay. The only reason this sweep exists is to reap relays left by a **crashed predecessor** — but it cannot distinguish a dead predecessor's orphans from a **live sibling's** active relays. Consequence: launching `just test-e2e`, starting a second `rk serve`, or even an `air` rebuild during `just dev` tears down the open WebSocket terminals (relay ephemerals) of a real running dashboard. The underlying session survives, but the user's live terminal tab drops its connection.

2. **Secondary e2e tmux servers leak on crash/interrupt (artifact leak).** Several specs spin up a second, timestamp-named tmux server (`rk-e2e-multi-*`, `rk-e2e-coupling-*`). These are reaped **only** by the spec's own `test.afterAll`. Neither `scripts/test-e2e.sh`'s `trap cleanup EXIT` nor `global-teardown.ts` kills them — both target only the literal socket `rk-e2e`. So on a crash, a tight 10 s test timeout, or Ctrl-C mid-spec, the secondary sockets and their tmux daemons survive on disk indefinitely. Nothing sweeps them by prefix. This is precisely the accumulation that motivated the reaper.

3. **Go-test sockets leak only on hard kill (minor residue).** The `t.Cleanup(kill-server)` helpers in `tmux_test.go`, `relay_test.go`, `daemon_test.go`, `integration_test.go` are actually **correct** for normal/skip/fail paths — they register cleanup right after the server is created and before any `t.Fatalf`. The residual leak is only on SIGKILL / panic in the test binary / OOM, where `t.Cleanup` never runs. The server name already embeds the test PID (`rk-test-<pid>-<ns>`, `rk-relay-test-<pid>-<ns>`), so dead-PID detection is trivial.

**What happens if we don't fix it.** Developers running the e2e suite while a real `rk serve` is up will keep losing their live terminals (defect 1), and orphan `rk-e2e-*` sockets + tmux daemons will keep piling up in `/tmp/tmux-{uid}/` (defect 2), churning the dashboard's server list and consuming processes. The team is being pushed to build a separate "reaper" command to mop this up — adding surface area (against constitution principle IV) to compensate for a leak that should not exist.

**Why this approach over alternatives.**
- *Owner-PID guard over scoping `ListServers`*: scoping reads would hide leaked servers from the UI, masking the very bugs we want visible. The destructive sweep is the only thing that needs scoping, and PID-ownership is the minimal, safe way to scope it.
- *PID + `kill(pid,0)` over `host:port` ownership*: the sweep runs **before** the instance's own HTTP listener binds, so a port-liveness probe is ambiguous at exactly the moment it runs. PID liveness is unambiguous and its failure mode is a benign leak (a recycled PID could spare a stale relay) rather than a wrongful kill.
- *Fix at source over building the reaper*: closing the leak honors "Minimal Surface Area" — the reaper becomes optional defense-in-depth instead of load-bearing.

## What Changes

### 1. Relay sweep scoped to owner PID (`app/backend/`)

**Stamp ownership at relay creation.** When a relay ephemeral is created (`api/relay.go` → `NewGroupedSession`), set a server-scoped... actually session-scoped user option recording the owning `rk serve` PID:

```
tmux -L <server> set-option -t <ephemeral> @rk_owner_pid <serve-pid>
```

The PID is the current `rk serve` process PID (`os.Getpid()`), captured once at process start (or read at stamp time — both resolve to the same value within a process). The relay name itself stays a random 8-hex string (`newEphemeralRelayName`, relay.go:31) — ownership lives in the option, not the name, preserving the existing injection-closed naming surface (constitution I).

**Reap only dead-owner relays.** `cmd/rk/serve_sweep.go:sweepOrphanedRelaySessions` keeps iterating **all** servers (read-side unchanged — `ListServers` still scans every socket so the UI keeps seeing everything). For each `rk-relay-*` session it now reads `@rk_owner_pid` and applies:

```
owner := readOption(session, "@rk_owner_pid")    // server-scoped per-session option
reap if:
    owner == ""                  // legacy/unstamped relay → orphan from older binary, safe to reap
    OR !pidAlive(owner)          // syscall.Kill(pid, 0) == ESRCH → owning process gone
keep if:
    pidAlive(owner)              // a LIVE instance owns this relay → never touch it
```

`pidAlive(pid)` uses `syscall.Kill(pid, 0)`: returns nil → alive; `ESRCH` → dead; `EPERM` → alive-but-not-ours (treat as alive → spare, the safe direction). The existing `ControlAnchorSessionName` (`_rk-ctl`) guard and per-server error isolation are retained verbatim.

**Net effect on the confirmed bug:** when the e2e backend (or a rebuilt `air` instance, or a second `rk serve`) starts, the real dashboard's PID is alive, so its relays carry a live `@rk_owner_pid` → **spared**. Only relays whose owner has actually exited are reaped — the intended behavior.

> Note: the failure direction is deliberately biased toward leaking (an unstamped or recycled-PID relay may survive one extra cycle) rather than wrongly killing a live instance's relays. The reaper (out of scope) backstops residual leaks.

### 2. e2e teardown reaps all `rk-e2e*` sockets (`scripts/`, `app/frontend/`)

Both teardown layers currently kill only the literal `rk-e2e` socket, missing timestamp-named secondaries. Widen both to glob:

**`scripts/test-e2e.sh`** — `cleanup()` (the `trap cleanup EXIT` handler):
```sh
cleanup() {
  kill 0 2>/dev/null || true
  # Kill the primary e2e server AND any secondary rk-e2e-* servers tests spun up
  for sock in /tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}*; do
    [ -S "$sock" ] && tmux -L "$(basename "$sock")" kill-server 2>/dev/null || true
  done
}
```
The trap fires on EXIT regardless of cause (normal completion, `set -e` error, SIGINT/SIGTERM from Ctrl-C), so this reaps secondaries even when a spec's `afterAll` never ran.

**`app/frontend/tests/e2e/global-teardown.ts`** — apply the same glob (kill every socket whose basename starts with `E2E_TMUX_SERVER`), so Playwright's own teardown is also prefix-complete. This is best-effort and must swallow errors (a socket may already be gone).

The exact glob mechanism (shell loop over the socket dir vs. `tmux list-sessions` discovery) is an implementation detail for the plan; the requirement is "every `rk-e2e*` socket is killed on teardown, including on interrupt."

### 3. Go `TestMain` pre-sweep of dead-PID test sockets (`app/backend/`)

Add (or extend) `TestMain` in the affected packages (`internal/tmux`, `api`) to sweep `rk-test-*` / `rk-relay-test-*` sockets whose embedded PID is dead, **before** tests run. Names follow `rk-<kind>-<pid>-<ns>`, so the PID is the parseable second field.

```go
func TestMain(m *testing.M) {
    sweepDeadTestSockets()   // parse <pid> from rk-test-*/rk-relay-test-* names; kill-server if !pidAlive(pid)
    os.Exit(m.Run())
}
```

This self-heals SIGKILL/panic residue from prior runs without any separate command. Fixed-name shared sockets (`rk-daemon-test`, `rk-tmuxctl-test`) already pre-kill on entry in their helpers and are unaffected. The sweep MUST only target sockets whose PID is dead — never reap a `rk-test-<live-pid>-*` socket belonging to a concurrently running `go test` invocation.

### Out of scope (explicitly)

- **No "rk reaper" command** (`[fww2]`) — parallel task; this change makes it optional.
- **No scoping of `ListServers` / `/api/servers`** — read-side visibility of `rk-e2e-*` is intentionally preserved.
- **No ownership guard on `KillServer` / `KillSession`** — those API paths are user-driven and intentional; no test targets them, and real named sessions/servers are already safe from automatic kills.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document the relay-ownership model — relays carry `@rk_owner_pid`, and the startup sweep reaps relays only when the owning PID is dead. Note that read-side server discovery (`ListServers`) remains global by design.
- `run-kit/architecture`: (modify, if such detail exists there) Note the e2e isolation boundary: test CLI commands are socket-scoped to `rk-e2e*`, but the e2e backend discovers all sockets and is made non-destructive toward foreign relays via PID ownership.

## Impact

**Backend (`app/backend/`):**
- `cmd/rk/serve_sweep.go` — `sweepOrphanedRelaySessions` gains the PID-ownership predicate.
- `api/relay.go` — relay creation stamps `@rk_owner_pid`.
- `internal/tmux/tmux.go` — likely a small helper to set/read the option and a `pidAlive` helper (or place `pidAlive` near the sweep). The session-scoped option setter may already exist (`set-option -t`); confirm during plan.
- `internal/tmux/tmux_test.go`, `api/relay_test.go` (+ possibly a new/extended `TestMain`) — dead-PID pre-sweep.

**Test harness:**
- `scripts/test-e2e.sh` — glob teardown.
- `app/frontend/tests/e2e/global-teardown.ts` — glob teardown.

**Behavioral surfaces:**
- No API contract change. No new routes. No new config. No DB (constitution II preserved).
- The `IsGoTestServerName` UI filter and tmuxctl `isTmuxSocketCandidate` behavior are unchanged.
- All new subprocess calls use `exec.CommandContext` with timeouts (constitution I / Process Execution).

**Tests to add/update:**
- Sweep unit test: a relay stamped with a live PID is spared; one with a dead/missing PID is reaped; `_rk-ctl` anchor untouched.
- e2e teardown: secondary `rk-e2e-*` sockets are gone after a run (and after a simulated interrupt, if feasible to assert).
- `TestMain` pre-sweep: dead-PID test socket removed at startup; live-PID socket preserved.

## Open Questions

- Should `@rk_owner_pid` be a **session-scoped** user option (`set-option -t <ephemeral>`) or a **server-scoped** one? Session-scoped is correct here (each relay is its own ephemeral session and dies with its connection), but confirm tmux semantics during plan — server-scoped options on an ephemeral grouped session could bleed to the real session.
- For `pidAlive`, how should `EPERM` (PID exists but owned by another user) be treated? Recommended: treat as alive → spare (safe direction). Confirm no scenario where a relay's owner PID legitimately belongs to another user.
- Is a single shared `TestMain` per package sufficient, or do `internal/tmux` and `api` each need their own? (Go allows one `TestMain` per package.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is write-side only; `ListServers`/`/api/servers` read scope is unchanged so `rk-e2e-*` stays visible in the UI | Discussed — user explicitly rejected read-side scoping to keep temporaries visible and avoid masking bugs | S:95 R:80 A:90 D:95 |
| 2 | Certain | Ownership model is PID + `kill(pid,0)`; relays stamped `@rk_owner_pid`, reaped only when owner PID dead/absent | Discussed — user selected Option A over host:port ownership; sweep runs before listener bind so port-liveness is ambiguous | S:95 R:70 A:85 D:90 |
| 3 | Certain | Scope excludes the rk reaper, `ListServers` scoping, and `KillServer`/`KillSession` guards | Discussed — user confirmed "keep scope as-is" and "rk reaper is a parallel task" | S:95 R:75 A:90 D:95 |
| 4 | Certain | Real named sessions/servers are already safe from automatic kill; only relay ephemerals are at risk | Verified — traced every kill-session/kill-server call site; only the relay sweep is automatic and it is prefix-guarded to `rk-relay-*` | S:90 R:85 A:90 D:90 |
| 5 | Confident | e2e teardown must glob `rk-e2e*` (not literal `rk-e2e`) in both `test-e2e.sh` trap and `global-teardown.ts` | Verified leak source — secondary `rk-e2e-multi-*`/`rk-e2e-coupling-*` servers escape both teardown layers; trap fires on interrupt so glob there covers Ctrl-C | S:85 R:75 A:85 D:85 |
| 6 | Confident | Go test-socket leak is only on hard-kill; fix via `TestMain` dead-PID pre-sweep, parsing `<pid>` from `rk-<kind>-<pid>-<ns>` | Verified — `t.Cleanup` helpers are correct on normal/skip/fail paths; residual leak only on SIGKILL/panic; PID already embedded in name | S:80 R:80 A:85 D:80 |
| 7 | Confident | `@rk_owner_pid` is a session-scoped option on the ephemeral relay session | Strong default — each relay is its own ephemeral session; confirm tmux group-option-bleed semantics during plan (raised as Open Question) | S:70 R:65 A:70 D:75 |
| 8 | Tentative | `pidAlive` treats `EPERM` (PID owned by another user) as alive → spare | Reasonable safe-direction default; not yet confirmed whether any relay owner PID legitimately belongs to another user | S:55 R:70 A:60 D:65 |

8 assumptions (4 certain, 3 confident, 1 tentative, 0 unresolved).
