# Intake: Terminal Relay — Reap Children, Gate the Pre-Attach Reload

**Change**: 260904-71yx-terminal-relay-reap-gate-reload
**Created**: 2026-09-04

## Origin

> Daemon reliability - Change A: terminal relay reap children + gate the pre-attach reload. Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change A section (A.1-A.2) exactly. Files: app/backend/api/terminals_ws.go (+tests). Re-verify all line numbers against current HEAD before editing - plan numbers are as of fd16e6b4.

One-shot `/fab-new` invocation executing **Change A** of the six-change daemon blocking & reliability plan (`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md`, authored 2026-09-04 from a live incident diagnosis plus two code audits). The plan is the design authority for this change; this intake transfers its Change A section plus the line-number re-verification performed at intake time. Changes B–F are sibling changes in other worktrees and are explicitly out of scope here.

**Line numbers re-verified at intake** (HEAD `b53e0cad`, which is the plan's `fd16e6b4` baseline plus unrelated commits): every plan reference still matches — `stream.teardown()` at `terminals_ws.go:837-850` with `Kill()` at `:847`; the publish-race branch at `:538-547` with `Kill()` at `:544`; zero `cmd.Wait()` anywhere in the file; `reloadConfigForAttach` at `:387-424` (seams `attachIsManaged`/`attachReloadConfig`/`attachMigrateLegacy` at `:381-385`), called synchronously at `:521` immediately before `pty.StartWithSize` at `:527`; the repo's one correct kill→reap precedent at `internal/tmuxctl/client.go:317-322`.

## Why

**The incident (2026-09-04)**: navigating to a terminal tab left the switch mask ("waiting logo") up for seconds, and the UI intermittently failed to detect the `rK` server. tmux itself answered `display-message` in ≤15ms across 90 samples *during* the incident — the time was lost inside the daemon. Two of the root causes live in the terminal relay (`app/backend/api/terminals_ws.go`) and this change owns both:

1. **Un-reaped relay children (A.1)** — the relay kills its `tmux attach-session` pty child but never waits on it. ~71 `[tmux: client] <defunct>` zombies had accumulated under the daemon, growing a few per minute of tab navigation (in pairs — the frontend ghost-gap probe reconnect tears down twice, `terminal-client.tsx:870-874`). Each closed stream leaks one zombie PID **plus one permanently parked `os/exec` watchCtx goroutine** (the unbuffered `resultc` send only `Wait` receives). Consequence if unfixed: slow-motion daemon death — at the fork ceiling every exec in the daemon fails at once (the incident's `SSE poll error err="signal: killed"` log lines).

2. **Per-attach config reload on the critical path (A.2)** — `attachStream` runs `reloadConfigForAttach` synchronously before the pty attach: `IsManagedServer` (1 exec, background ctx, 10s budget) + `tmux.ReloadConfig` → `source-file` of the whole managed tmux.conf (1 exec, 10s budget) — **on every attach**. The switch mask arms at 300ms and lifts only on the first PTY byte (`window-transition.ts:80`, `terminal-client.tsx:1100-1111`), so these two execs sit directly under the waiting logo. Consequence if unfixed: every tab switch pays up to two serialized tmux execs before the user sees anything, and under daemon congestion (the zombies above) those execs are exactly the ones that stall.

**Why this approach**: A.1 follows the repo's own proven contract — `internal/tmuxctl/client.go:317-322` kills then `Wait()`s, with the contract documented at `client.go:37-38`. A.2 exploits structure that already exists: the reload is already declared best-effort (comment at `:389-393`), the managed tmux.conf is hash-stamped (`docs/memory/run-kit/configuration.md` § Managed tmux.conf) so staleness is detectable without sourcing, and the legacy-option sweep inside the same function is *already* once-guarded and async — the managed-check + reload are the only parts left synchronous.

## What Changes

### A.1 — Reap the pty tmux client (zombie + goroutine leak)

`app/backend/api/terminals_ws.go`. Today's two kill-without-wait paths:

- `stream.teardown()` (`:837-850`): `sync.Once`-guarded — closes `st.closed`, cancels the attach context, closes the ptmx, then `st.cmd.Process.Kill()` at `:847`. No `Wait`.
- The publish-race branch in `attachStream` (`:538-547`): when the stream was closed/torn down while attaching (`tc.streams[op.ID] != st`), it cancels, closes the just-opened ptmx, and `cmd.Process.Kill()` at `:544`. No `Wait`. Note: on this path the `cmd` was **never published** into the stream (`st.cmd` is still nil), so `teardown()` cannot cover it — the reap must happen in this branch itself.

**Fix**: after a successful `pty.StartWithSize`, ensure **exactly one owner reaps each `Cmd`** — e.g. the attach goroutine defers `cmd.Wait()` post-kill, or teardown does kill→`Wait` mirroring `internal/tmuxctl/client.go:317-322`:

```go
if cmd.Process != nil {
    _ = cmd.Process.Kill()
    _ = cmd.Wait()
}
```

Constraints the chosen mechanism must satisfy:
- `Wait` is called by **exactly one goroutine per `Cmd`** (`os/exec` forbids concurrent/double Wait).
- **Both** fork paths are covered: normal teardown (`stream.teardown`, reached from `closeStream`, socket teardown, `failClosed`) and the publish race (`:538-547`).
- The `failClosed` pre-publish failure paths (resolve failure, select-window failure, pty start failure) forked no child or the fork failed — `pty.StartWithSize` failure means no process to reap; teardown on a placeholder stream (nil `cmd`) stays a no-op.
- The control pseudo-stream (`controlStreamID`, no ptmx/cmd) keeps no-oping through teardown.
- Kill-before-Wait ordering (a blocked `tmux attach-session` won't exit on its own; `Wait` without kill would hang the reaping goroutine).

**Regression test** (in `terminals_ws_test.go`): close a stream and assert the child is reaped — no `Z` (zombie) process state remains / `Wait` returned. Cover both paths (normal close and the publish race) as far as the test seams allow. The existing suite is `-race`-clean across terminals+scheduler; keep it so.

### A.2 — Take the per-attach config reload off the critical path

`app/backend/api/terminals_ws.go`. Today `attachStream` calls `tc.s.reloadConfigForAttach(server)` synchronously at `:521`, before `pty.StartWithSize` at `:527`. Inside (`:394-424`): `attachIsManaged` (managed-provenance check, 1 exec) → `attachReloadConfig` (`source-file` of the managed conf, 1 exec) → the legacy-option sweep, which is already once-guarded (`tmux.MarkLegacyMigrationAttempt`) and runs in its own goroutine.

**Fix — pick one in apply** (the plan explicitly grants apply the choice):

1. **Per-server once/staleness guard** like the sweep already has: the managed conf is hash-stamped (see `docs/memory/run-kit/configuration.md` § Managed tmux.conf — the `# rk-managed sha256:<hex>` header), so reload only when the stamp differs from what this server last received / when not yet reloaded this daemon lifetime. First attach per server pays the cost once; every subsequent attach skips both execs.
2. **Move the managed-check + reload fully async** (goroutine, like the sweep): the attach proceeds immediately with the server's current conf; the comment at `:389-393` already declares the reload best-effort and never-fails.

Invariants regardless of option:
- **Keep the managed-only gate semantics**: an external (unmarked) server never receives rk's conf; a managed-check read failure fails closed (skip). The `attachIsManaged`/`attachReloadConfig`/`attachMigrateLegacy` test seams (`:381-385`) keep pinning this without a live server (existing tests must keep passing or be updated to the new shape per the Test Integrity constitution rule).
- **No attach regression when the reload is skipped**: the attach itself must be byte-identical in behavior — `-f confPath` still rides the attach args (`:515-517`), so a brand-new server still gets the conf at client birth regardless of the reload.
- The legacy-sweep once-guard behavior (synchronous guard take, async sweep, hub wake on change) is preserved.

### Review focus (from the plan)

The one question review must answer: *is `cmd.Wait()` called exactly once on every path a child was forked, and does no attach regress when the reload is skipped?*

## Affected Memory

- `run-kit/api-and-sockets`: (modify) Terminal Relay section — the stream teardown contract gains the kill→reap (`Wait`) guarantee on both fork paths; the per-stream attach sequence description (`… → forceTERM + best-effort ReloadConfig → pty.StartWithSize`) changes to reflect the gated/async reload.
- `run-kit/configuration`: (modify) § Managed tmux.conf — the WS-attach best-effort reload path (`reloadConfigForAttach`, seams `attachIsManaged`/`attachReloadConfig`) is re-characterized as gated/off-critical-path; the "fired merely on viewing a terminal — the hottest path" note in the Design Decisions gains its resolution.

## Impact

- **Code**: `app/backend/api/terminals_ws.go` (teardown, `attachStream` publish-race branch, `reloadConfigForAttach` + call site), `app/backend/api/terminals_ws_test.go` (+ possibly a new sibling test file). No other packages; no API/protocol change; no frontend change.
- **Behavior**: no user-visible protocol change — same `/ws/terminals` contract, same close codes. Faster attach (waiting logo lifts sooner on warm servers), no zombie accumulation, no goroutine leak per closed stream.
- **Constitution**: §I (exec.CommandContext discipline untouched), §VI (tmux stays independent — killing/reaping rk's *own* attach client, never tmux servers), Process Execution constraint (zombies must not block the server — this is the fix), Test Integrity (tests updated to spec, not vice versa).
- **Verification gates** (`code-quality.md` § Verification): `go test ./...` in `app/backend`, frontend typecheck (untouched, still runs), `just test`, `just build`. Keep `-race` on the touched package's suite (plan: "A and B should add/keep `-race` coverage").
- **Parallelism**: Wave-1 change, disjoint files from B/D/E/F — safe to land independently.

## Open Questions

- None. The plan is prescriptive about the defect, the constraints, and the review question; the two deliberately-open implementation choices (reap ownership mechanism, A.2 option 1 vs 2) are explicitly delegated to apply by the plan and recorded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan Change A (A.1 + A.2) in `terminals_ws.go` + tests; Changes B–F excluded | Plan states files and wave-parallel ownership explicitly; user said "Change A section (A.1-A.2) exactly" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Plan line numbers are still valid at HEAD `b53e0cad` — verified against source at intake (Kill at :847 and :544, reload at :394/:521, zero Wait in file) | Direct code inspection this session; user asked for re-verification and it was performed | S:90 R:95 A:100 D:95 |
| 3 | Confident | Reap-ownership mechanism (teardown does kill→Wait à la tmuxctl vs attach goroutine defers Wait) is decided at apply, with kill→Wait-in-teardown as front-runner plus an in-branch reap for the publish race (cmd never published there) | Plan says "e.g." and lists both; constraints (exactly-one-Wait, both paths) are fixed, mechanism is reversible within one file | S:80 R:85 A:80 D:60 |
| 4 | Confident | A.2 option (per-server staleness/once-guard vs fully-async reload) is decided at apply | Plan says verbatim "pick in apply"; both options satisfy the stated invariants; single-file reversible | S:85 R:85 A:75 D:55 |
| 5 | Certain | Managed-only gate semantics and the existing `attachIsManaged`/`attachReloadConfig`/`attachMigrateLegacy` test-seam pattern are preserved | Plan requires it ("Keep the managed-only gate semantics"); memory § Managed tmux.conf documents the gate as a design decision | S:90 R:80 A:95 D:90 |
| 6 | Certain | Regression test asserts the child is reaped on stream close (no zombie / Wait returned), and the package suite stays `-race`-clean | Plan prescribes the test and the `-race` coverage explicitly | S:90 R:90 A:90 D:90 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
