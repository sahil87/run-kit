# Intake: Cron Core + Evaluator

**Change**: 260906-3jtn-cron-core-evaluator
**Created**: 2026-09-06

## Origin

Operator dispatch (one-shot, autonomous): C1, wave 1 of the cron clock execution plan — the foundation change every later wave (C2 CLI, C3 daemon ticker + delivery, C4 operator seeding, C5–C7 UI) depends on.

> internal/cron core + evaluator: entry-file schema + tolerant load ($XDG_STATE_HOME/run-kit/cron/<slug>.yaml); the stateless evaluator (every + backoff with the anchor-join rule; wake_on approximated by the poll -- state-delta since last eval, debounced; suppress_while guards reading the fab operator state file); delivery log (append, size-cap); live-server filter; TMUX scrub; flock. Pure functions unit-tested hard (anchor-join, ladder math, suppression truth table).

**Design authorities** (read them before planning — they own the schema and semantics verbatim):

- `docs/specs/cron.md` — the spec: entry schema, schedule semantics, the anchor-join rule, suppression guards, evaluator guards, delivery-log posture.
- `fab/plans/sahil/26-09-06-cron-clock-plan.md` — the execution plan: C1's scope row, the C1/C2/C3 boundary, and the standing rules that gate review.

**Standing rules from the plan (review gates, not polish)**:

1. **Anchor-join is correctness, not polish** — a raw-idle-epoch backoff implementation MUST be rejected: without the join, each delivery resets the raw epoch and pins the ladder at rung 1 forever (the self-resetting-ladder bug).
2. **Live-server filter before any socket touch** — a tmux command against a dead socket resurrects it; the evaluator must never be a zombie-server factory.
3. **Payload/tick idempotency** — ticks are idempotent by contract; a duplicate fire after restart is acceptable, a missed suppression is not.

## Why

1. **Monitoring liveness dies with the monitored session.** The operator's cadence lives in a `/loop` inside its own Claude session; a Ctrl-C, restart, or compaction kills the timer silently (the dev-ws-sahil01 incident, 2026-09-03). The cron substrate is the durable, session-independent clock that fixes this class.
2. **Recurring work has no durable home.** There is no machine-local scheduler an agent can program that outlives the agent's session.
3. **C1 is the substrate.** Everything downstream — `rk cron` CLI (C2), the daemon ticker + injection delivery (C3), operator-tick seeding (C4), all UI (C5–C7) — consumes this package. Getting the pure core right (schema, schedule math, guards) here is what makes the later waves thin wiring. If C1 ships a raw-epoch ladder or an unfiltered socket sweep, every later wave inherits the bug.

## What Changes

One new Go package: **`app/backend/internal/cron`**. No CLI verb, no daemon goroutine, no HTTP surface, no frontend — those are C2/C3/C5. C1 is the core library plus hard unit tests.

### 1. Entry-file schema + tolerant load

**Location**: `$XDG_STATE_HOME/run-kit/cron/<server-slug>.yaml` — one file per tmux server, keyed by socket name. A separate subdir under the run-kit state root (a new state tenant, sibling of `snapshots/` and `cb/`).

Schema (from the spec, verbatim semantics):

```yaml
entries:
  - id: a3f9                     # 4-char, rk-generated
    name: operator tick
    schedule: { kind: backoff, anchor: operator-idle, min: 60s, max: 30m }
    wake_on: { event: agent-state-change, scope: server, debounce: 10s }
    suppress_while: [operator-loop-fresh, nothing-tracked]
    target: { kind: role, role: operator }
    payload: "operator tick"
    deliver: immediate           # immediate | when-idle
    if_absent: respawn           # skip | notify | respawn
    pinned: true
    created_by: { session: 8c1e…, pane: "%12", at: 1788254000 }
```

- Go types for the full schema: entry, schedule (`every` | `backoff` | `cron`), `wake_on`, `suppress_while` guard names, target (`role` | `session` | `pane`), `deliver`, `if_absent`, `pinned`, `created_by`.
- **Tolerant load**: unknown keys ignored; a malformed entry is skipped with a diagnostic, never failing the whole file; an absent file is an empty entry set. Schedule kind `cron` (5-field expressions) parses as a recognized-but-unevaluated kind in C1 — the evaluator skips it with a diagnostic; C9 lands the expression math. Unknown kinds likewise skip, never error.
- **Runtime facts are NOT stored in the file** (`last_fired`, `next_fire`, rung, orphaned-since are derived). The file changes only on add / rm / pin / mute — mutation helpers (add/remove/mute/pin, atomic write via `internal/fsatomic`) belong to this package so C2's CLI is thin wiring.

### 2. The stateless evaluator

The core is a pure function over disk-derivable inputs: `evaluate(entries, derived state, delivery log, now) → due fires + diagnostics`. No in-memory schedule state; every invoker (C2's `rk cron tick`, C3's daemon goroutine, manual) is equivalent.

**Schedule math** (pure functions, unit-tested hard):

- **`every`**: fires when `now − last_delivery ≥ interval`; last delivery derives from the delivery log; before any delivery, the anchor is `created_by.at`.
- **`backoff`**: fire times are `anchor + min·(2ⁿ − 1)` (gaps min, 2·min, 4·min…), capped at `max`. The anchor is the agent idle epoch carried by `@rk_pane_agent_state` (re-read each evaluation), corrected by the **anchor-join rule**: the effective anchor is *the last activity not caused by the clock*. The evaluator joins the raw idle epoch against the entry's own delivery log — a raw epoch that immediately follows its own delivery (within a named attribution window) does NOT reset the ladder; the rung continues from the trailing own-delivery streak in the log. A non-attributed epoch resets the rung to 0 with the raw epoch as the new anchor. Both inputs (pane option, log) live on disk, so the schedule stays a pure function; a restart at worst re-fires one due tick.
- **`wake_on` (poll approximation)**: an edge trigger OR'd with the schedule — fire when the named transition occurred (v1: `agent-state-change`, server scope) since the last evaluation, debounced per the entry's `debounce` so a burst coalesces into one fire. Approximated by the poll: the evaluator fingerprints the server's agent states and compares against the previous evaluation's observation. That observation lives in a small sidecar cursor file under the cron state dir (startup-seed-cache class per Constitution II: never authoritative, corrupt/absent degrades to a cold start — at worst one missed or duplicate edge fire, acceptable under tick idempotency).
- **`suppress_while` guards**: evaluated at fire time; while any holds, the fire is skipped silently (not a missed fire). Two named guards ship:
  - `operator-loop-fresh` — holds while `last_tick_at` in the fab operator state file (`$XDG_STATE_HOME/fab/operator/<server-slug>.yaml`) is fresh (within a staleness threshold). This is the arbitration that keeps the cron silent while the in-session `/loop` is alive — no double ticks.
  - `nothing-tracked` — holds while `monitored`, `watches`, and `autopilot` in that file are all empty.
  - The fab operator state file is a **fab-owned schema read tolerantly** (unknown keys ignored) and documented as an external contract, the same class as the dispatch-record reads. Absent/corrupt file semantics: `operator-loop-fresh` does NOT hold (no fresh stamp exists), `nothing-tracked` DOES hold (nothing is tracked). Full truth table unit-tested.

**Delivery is a seam, not a C1 feature**: the evaluator returns due fires; actual injection-engine delivery, `deliver: when-idle` gating, `if_absent` handling, and circuit breakers are C3. C1 defines the deliverer interface (and a test fake) so the package's tick entrypoint can run end-to-end in tests and append to the log.

### 3. Delivery log (append, size-cap)

`$XDG_STATE_HOME/run-kit/cron/<server-slug>.log` — one line per delivery (timestamp, entry id, resolved target, outcome), append-only, size-capped (on exceeding the cap, atomically trim to the newest tail). The log is the derivation source for `every` last-delivery, the anchor-join streak, and (later) UI "last fired" — history, recovery-backup class, never a live-state source.

### 4. Evaluator guards

- **Live-server filter first**: server enumeration filters to live sockets before ANY tmux command is issued (reuse the existing liveness enumeration in `internal/tmux` — the same filter `rk mux reap` relies on). Entry files whose server is dead are skipped entirely, never probed.
- **TMUX scrub**: every tmux-touching call scrubs `TMUX`/`TMUX_PANE` from the subprocess env and addresses the stamped absolute socket path, never "current server" (the `%14`-collision lesson).
- **flock**: evaluation is serialized by a non-blocking flock on a lock file under the cron state dir; a held lock means another invoker is mid-tick — exit cleanly and quietly (idempotent tick contract, safe for concurrent invokers).

### 5. Unit tests (the hard part, explicitly in scope)

Pure functions tested hard, table-driven:

- **Anchor-join**: raw epoch attributed vs. non-attributed; multi-delivery streaks; the self-resetting-ladder case (a raw-epoch implementation MUST fail these tests); restart/duplicate-fire tolerance.
- **Ladder math**: `min·(2ⁿ − 1)` fire times, `max` cap, rung derivation from the log.
- **Suppression truth table**: both guards × fresh/stale/absent/corrupt state file × empty/non-empty tracked sets.
- **Tolerant load**: unknown keys, malformed entries, absent file, unknown schedule kinds, `cron`-kind skip.
- **`every` math, wake_on debounce/delta, log cap trim, flock contention.**

Tests that touch tmux state use the existing test-socket isolation conventions (`internal/testutil`, `rk-test-*` naming, env scrubbed with `env -u TMUX -u TMUX_PANE` semantics — cmd/rk ambient-env lesson applies to any new package tests too).

## Affected Memory

- `run-kit/cron`: (new) the cron substrate core — entry schema, tolerant load, evaluator semantics (anchor-join, ladder math, wake_on poll approximation, suppression guards), delivery log posture, evaluator guards (live-server filter, TMUX scrub, flock), the C1/C2/C3 seam.
- `run-kit/configuration`: (modify) new `$XDG_STATE_HOME/run-kit/cron/` state tenant (entry files + delivery log + wake_on cursor) alongside `snapshots/` and `cb/`.

## Impact

- **New**: `app/backend/internal/cron/` (schema/load, evaluate, backoff + anchor-join, guards, delivery log, server filter, lock; colocated `*_test.go`).
- **Read-only consumers of existing packages**: `internal/tmux` (live-server enumeration, `@rk_pane_agent_state` / role option reads), `internal/fsatomic` (atomic writes). No changes to `api/`, no frontend, no CLI wiring (C2), no daemon changes (C3).
- **External contract**: tolerant read of the fab-owned operator state file schema (`$XDG_STATE_HOME/fab/operator/<server-slug>.yaml`).
- **Constitution**: II (entry files are intent; log is recovery-backup class; cursor is seed-cache class), I (all subprocess via `exec.CommandContext`, validated inputs), X (nothing pushed — everything derived).
- **Verification**: `go test ./...` in `app/backend` is the gate; no e2e surface exists yet.

## Open Questions

*(none — everything decidable landed as a graded assumption below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Package lives at `app/backend/internal/cron`, Go, colocated `*_test.go` | Spec names `internal/cron`; all Go internals live under `app/backend/internal/`; config/constitution answer this | S:85 R:90 A:95 D:95 |
| 2 | Certain | C1 excludes the CLI verb (C2), daemon ticker, injection delivery, `when-idle`/`if_absent` handling, and circuit breakers (C3); C1 defines a deliverer interface + test fake so the tick path and log append are testable | Plan's change-breakdown rows draw this boundary explicitly | S:90 R:75 A:90 D:85 |
| 3 | Confident | Anchor-join implementation: ladder rung derives from the trailing own-delivery streak in the delivery log; a raw idle epoch within a named attribution window after the entry's own last delivery continues the streak; a non-attributed epoch resets rung 0 with the raw epoch as anchor | Spec fixes the rule ("last activity not caused by the clock", joined against the log) but not the formula; this is the direct log-derivable formulation — exact math finalized in plan and locked by tests | S:70 R:55 A:70 D:50 |
| 4 | Confident | `wake_on` poll approximation persists its last-eval observation as a sidecar cursor file under `cron/` (seed-cache class: never authoritative, corrupt/absent = cold start, at worst one missed/duplicate edge fire) | The delta needs a previous observation; entry files must not carry runtime facts; Constitution II's seed-cache carve-out is the sanctioned home | S:65 R:70 A:70 D:55 |
| 5 | Confident | Absent/corrupt fab operator state file ⇒ `operator-loop-fresh` does not hold, `nothing-tracked` holds | Follows each guard's meaning (no fresh stamp exists; nothing is tracked); spec mandates tolerant parse + absent-file grace; truth table unit-tested | S:60 R:80 A:70 D:60 |
| 6 | Confident | Delivery log: one structured line per delivery (ts, entry id, resolved target, outcome); size cap a named constant with atomic trim-to-newest-tail on exceed; exact cap value chosen at plan | Spec fixes append + size-cap + derivation-source role, not the encoding; any self-describing line format satisfies the consumers | S:55 R:85 A:80 D:70 |
| 7 | Certain | flock: non-blocking, on a lock file under the cron state dir; held lock ⇒ clean quiet exit | Spec: "serialized by a non-blocking flock"; idempotent-tick contract makes skip-on-contention correct | S:80 R:90 A:85 D:90 |
| 8 | Certain | Schedule kind `cron` (5-field) is schema-recognized but unevaluated in C1 (skip + diagnostic); C9 lands expression math | Plan assigns 5-field expressions to C9; tolerant-load posture covers the interim | S:85 R:85 A:85 D:80 |
| 9 | Certain | Live-server filter reuses the existing liveness enumeration in `internal/tmux` (the `rk mux reap` filter) rather than reimplementing | Code-quality anti-pattern list (no duplicate utilities); the helper exists and is battle-tested against the resurrection hazard | S:80 R:80 A:85 D:85 |
| 10 | Confident | `operator-loop-fresh` staleness threshold is a parameter of the guard with a named-constant default; C4 (operator-tick seeding) owns the operationally-tuned value | The spec calls it "the pulse threshold" without a number; parameterizing keeps C1 pure and defers tuning to the wave that seeds the entry | S:55 R:75 A:60 D:55 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
