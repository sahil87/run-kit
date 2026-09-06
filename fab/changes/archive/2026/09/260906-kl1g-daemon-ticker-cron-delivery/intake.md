# Intake: Daemon Ticker + Cron Delivery

**Change**: 260906-kl1g-daemon-ticker-cron-delivery
**Created**: 2026-09-06

## Origin

Operator dispatch (wave 1 of the cron clock plan, C3, parallel with C2, both on top of the merged C1 — PR #855):

> Daemon ticker + delivery: ticker goroutine invoker (isolated, settings key default ON, doctor row); injection-engine delivery with deliver: immediate|when-idle gating; if_absent: skip|notify; circuit breakers (per-target rate cap -- trips visibly, per-server entry cap).

Design authority: `docs/specs/cron.md` (§ The Model item 1, § Delivery, § Targets & Fire-Time Resolution's `if_absent` ladder) and `fab/plans/sahil/26-09-06-cron-clock-plan.md` (row C3). C1 (`internal/cron` core + evaluator, change 260906-3jtn) shipped the `Deliverer` seam this change fills; its hydrated memory is `docs/memory/run-kit/cron.md`. **Scope guard from the dispatch**: a sibling agent is building C2 (`rk cron` CLI) in parallel — this change MUST NOT touch any `cmd/rk` cron subcommand file. `cmd/rk/serve.go` and `cmd/rk/doctor.go` are fine (not cron subcommand files).

## Why

1. **The evaluator has no invoker.** C1 shipped `cron.Tick` as a library function — nothing in production calls it, so no cron entry ever fires. The rk-daemon ticker goroutine is the spec's default invoker ("an isolated goroutine sharing no locks with the serving path").
2. **Fires have no delivery.** `Tick` calls a caller-supplied `Deliverer`; only test fakes exist, and a nil deliverer records `no-deliverer`. Without the injection-engine implementation, the whole substrate is inert — the operator-tick backstop (C4, next wave) cannot land.
3. **Ungated delivery is dangerous.** A scheduling substrate that types into agent panes needs the dumb guards before it goes live: the per-target rate cap (tick storms, delivery feedback loops) and per-server entry cap (cron-spam from misbehaving agents) are spec-mandated evaluator guards, load-bearing from day one — not polish.

Without this change, waves 2+ (operator-tick seeding, the gate, all UI) have nothing to stand on.

## What Changes

### 1. Ticker goroutine invoker (`internal/cron` + `cmd/rk/serve.go`)

A new `Ticker` in `internal/cron` (e.g. `ticker.go`): a goroutine that invokes `cron.Tick(ctx, deps)` on a fixed cadence, started from `serve.go` alongside the snapshotter (same best-effort posture: a state-dir resolution failure disables ticking with a `slog.Warn`, never blocks serving).

- **Cadence**: default 30s (named constant, e.g. `DefaultTickInterval`). The operator backoff schedule's `min` is 60s, so a 30s poll bounds fire lateness to half the smallest rung; `wake_on` is approximated by the same poll per the spec.
- **Isolation**: the goroutine shares no locks with the serving path — its only synchronization is the existing non-blocking flock inside `Tick` (a held lock is a clean skip). Each iteration runs with panic recovery (a tick panic logs and skips the iteration, never kills the daemon) and a bounded per-tick context timeout. Bound to the serve context; stops on shutdown.
- **Settings gate**: a new registry key in `internal/settings`:

  ```
  key: "cron_ticker", kind: "bool", def: "true",
  desc: "Runs the cron tick evaluator inside the daemon: scheduled entries fire while the daemon is up.",
  category: "behavior", ui: true, live: true,
  ```

  Default **ON** (per the dispatch seed). `live: true` — the ticker consults the setting at each iteration (cheap settings read), so toggling takes effect without a daemon restart; when off, the iteration skips with a debug note (goroutine keeps running, does nothing).
- **Doctor row** (`cmd/rk/doctor.go`): an informational OK-shaped row (the ephemeral/tmux-config posture — never fails the report) reporting the `cron_ticker` setting state and the cron state dir (`$XDG_STATE_HOME/run-kit/cron/`) resolvability. `rk doctor` runs in a separate process, so the row reports configuration + disk facts, not live goroutine state.

### 2. Injection-engine Deliverer (`internal/cron`, new `deliver.go`)

An `EngineDeliverer` implementing the C1 `Deliverer` interface (`Deliver(ctx, Fire) Outcome`), constructed in `serve.go` and passed via `Deps.Deliverer`. It sends through `internal/inject` (the one injection engine — never raw `send-keys`), inheriting the pane-mode guard, sanitized buffer paste, novelty echo probe, and submit verification:

- A dedicated `inject.Engine` with its own buffer name (e.g. `rk-cron-send` — per-client buffer names are the established pattern; the CLI/daemon precedent is `rk-agent-send`).
- An `inject.Tmux` adapter delegating to `internal/tmux` context-bound primitives with the fire's stamped `Server` (the `Fire` struct already carries `Server` + `PaneID`) — TMUX/TMUX_PANE scrubbing and explicit `-L` addressing are inherited from `internal/tmux`.
- **`deliver: immediate`** — send now with submit (payload + Enter, verified).
- **`deliver: when-idle`** — gate on `@rk_pane_agent_state` read at delivery time (fresher than eval-time facts): pane busy ⇒ the fire is **held**, outcome `held-busy`. No in-tick waiting — ticks stay short-lived; the hold is realized as cross-tick retry (below). The long-bound policy (drop vs deliver-late after N hours) is spec open question 2, decided at C9 — out of scope here; v1 holds indefinitely via re-evaluation.

**Held outcomes are not log-appended.** `Tick` currently appends one log line per attempted delivery, and the delivery log is the anchor-derivation source for `every` (last line) and the backoff anchor-join streak — logging a held attempt would advance anchors and distort the ladder join, silently delaying the fire by a full period. `Tick` gains a held-outcome class (e.g. `Outcome.Held bool` or a sentinel status) that skips the log append and records a diagnostic instead, so the fire re-computes as due on the next tick and retries — that IS the hold. Delivered, failed, and absent outcomes keep logging as today (a failed injection advancing the anchor is deliberate self-throttling: retry next period, not next tick).

Known v1 semantics wrinkle: a `wake`-reason fire under `when-idle` that gets held has already advanced the wake cursor (Evaluate computes `NextCursor` before delivery), so the held edge is consumed — the payload lands on the entry's next schedule-due or next edge instead. Accepted for v1 (the operator-tick entry, the only planned wake user, is `deliver: immediate`); revisit if a when-idle + wake_on combination becomes real.

### 3. `if_absent` handling: `skip | notify` (`internal/cron` evaluate/tick seam)

C1's evaluator drops a due-but-unresolved-target entry with only a `target-unresolved` diagnostic — the `if_absent` policy was explicitly deferred to this change. Now:

- `EvalResult` surfaces due-but-unresolvable fires distinctly (e.g. an `Absent []Fire` field or fires flagged unresolved — plan decides the shape) so the tick orchestrator can apply the entry's `if_absent` policy. Due-ness math is unchanged; only the disposition of a due fire whose target didn't resolve changes.
- **`skip`** — record the missed fire: append a log line with outcome `skipped-absent`. This is the spec's "record a missed fire; entry trends toward orphaned" (orphan GC itself is C8) — and the logged line advances the schedule anchor, so a dead target produces one line per due period, not one per 30s tick.
- **`notify`** — call `internal/push.Notify` (the daemon-side notification path; fail-silent contract — a notify failure is a diagnostic, never an error) with the entry name and server, e.g. title `cron: <name>`, body `target absent on <server>`; append outcome `notified-absent`. Anchor advancement throttles notify to once per due period, and the per-target rate cap applies on top (the spec notes the rate cap covers notify throttling).
- **`respawn`** — out of scope (C4 owns role respawn, C8 session respawn). A `respawn` entry degrades to the `notify` behavior plus a `respawn-unimplemented` diagnostic, so a C4-seeded entry on an old binary is loud, not silent.

### 4. Circuit breakers

- **Per-target rate cap**: before delivering, count the target pane's log lines with delivery-attempt outcomes (delivered/failed/notified classes — not held) in the trailing hour, across ALL entries targeting that pane; at or past the cap (default 30/hour, named constant e.g. `DefaultTargetRatePerHour`), the fire is suppressed with outcome `rate-capped`. **Trips visibly**: the `rate-capped` line is appended to the log (the UI's future derivation source, and it advances the anchor so the storm self-throttles) AND surfaced at `slog.Warn` — the one cron diagnostic that escalates above debug, per the spec's "tripping is visible, not silent".
- **Per-server entry cap**: default 50 entries per server (named constant, e.g. `MaxEntriesPerServer`). Enforced at the mutation seam — `Add` refuses past the cap with a clear error (callers: C2's CLI, C5's API) — and defensively at load/eval time: entries beyond the cap in a hand-edited file are skipped with an `entry-cap-exceeded` diagnostic.

### 5. Wiring (`cmd/rk/serve.go`)

Construct the deliverer engine + ticker after the snapshotter block: resolve `cron.DefaultDir()` (failure ⇒ warn + disable), build `cron.Deps{Deliverer: <engine deliverer>}` (zero values select production defaults for everything else), start the ticker bound to the serve ctx. No API surface, no SSE wiring, no frontend (all C5+).

## Affected Memory

- `run-kit/cron`: (modify) fill the Deliverer seam section — injection-engine deliverer, when-idle held semantics (held outcomes never logged), if_absent skip/notify dispositions and their log outcomes, circuit breakers (rate cap + entry cap), the ticker invoker + cadence + settings gate
- `run-kit/daemon-lifecycle`: (modify) new serve-time goroutine (cron ticker) in the startup sequence, its isolation/panic posture, shutdown binding
- `run-kit/configuration`: (modify) settings registry gains `cron_ticker` (bool, default true, live) — the 12-key inventory becomes 13
- `run-kit/agent-send`: (modify) one line — the shared injection engine gains the cron deliverer as a client with its own `rk-cron-send` buffer

## Impact

- `app/backend/internal/cron/` — new `ticker.go`, `deliver.go`; `tick.go` (held-outcome class, if_absent dispositions, rate cap), `evaluate.go` (surface due-but-absent fires), `store.go` (`Add` entry cap), plus tests for each. Unit-test hard: held-not-logged anchor preservation, rate-cap trip + visibility, entry-cap refusal, if_absent dispositions, ticker setting gate + panic recovery.
- `app/backend/internal/settings/settings.go` — one registry entry + test.
- `app/backend/cmd/rk/serve.go` — ticker + deliverer wiring (snapshotter posture).
- `app/backend/cmd/rk/doctor.go` — one informational row + test.
- **Not touched**: any `cmd/rk` cron subcommand file (C2, parallel sibling), API/frontend (C5+), operator-tick seeding (C4).
- Dependency note: `internal/cron` gains imports of `internal/inject` and `internal/push` (no cycle — neither imports cron).

## Open Questions

- None blocking. The when-idle hold-window bound (drop vs deliver-late) is spec open question 2, explicitly deferred to C9 — v1 holds via cross-tick retry.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Settings key `cron_ticker`, kind bool, default `true`, `live: true`, behavior category | Dispatch seed fixes "settings key default ON"; registry pattern (`auto_name`) fixes the shape; live-toggle via per-iteration read is the cheapest correct wiring | S:90 R:85 A:85 D:80 |
| 2 | Confident | Tick cadence 30s named constant | Spec approximates `wake_on` by the poll; operator backoff `min` 60s → 30s bounds lateness to half the smallest rung; trivially tunable | S:60 R:85 A:70 D:70 |
| 3 | Confident | Held (when-idle, busy) fires skip the log append and retry via next-tick re-evaluation; no in-tick waiting | Logging a held attempt advances the `every` anchor and distorts the anchor-join streak (C1 memory: log = derivation source); ticks must stay short-lived; C9 owns the long-bound policy | S:65 R:70 A:75 D:60 |
| 4 | Confident | A held `wake`-reason fire's edge is consumed (cursor already advanced); payload lands on next due/edge — decided as v1 semantics, documented in memory | Evaluate computes NextCursor pre-delivery and re-plumbing cursor persistence around delivery outcomes buys nothing real: the only planned wake user (operator tick) is `deliver: immediate`, and the plumbing is internal (no contract) — easily revisited at C9 alongside the hold-window bound | S:45 R:70 A:65 D:55 |
| 5 | Confident | `if_absent: skip`/`notify` append log outcomes (`skipped-absent`/`notified-absent`) that advance the anchor — one disposition per due period, not per tick | Spec: skip "records a missed fire"; anchor advancement is the natural notify throttle the spec assigns to the log+rate-cap pair | S:60 R:75 A:75 D:65 |
| 6 | Confident | `if_absent: respawn` degrades to notify + `respawn-unimplemented` diagnostic in this change | Plan assigns respawn to C4 (role) / C8 (session); loud degradation keeps a C4-seeded entry visible on skew | S:70 R:80 A:75 D:70 |
| 7 | Confident | Per-target rate cap default 30 deliveries/hour, counted from the target pane's non-held log lines across all entries | Spec leaves "default N/hour" open; 30/hr sits above any healthy ladder (min-60s backoff coalesces upward) while bounding a feedback loop; named constant, trivially tuned | S:40 R:80 A:50 D:55 |
| 8 | Confident | Per-server entry cap default 50, enforced in `Add` + defensively at eval with `entry-cap-exceeded` diagnostics | Mutation seam is the natural chokepoint (C2 CLI and C5 API both route through `Add`); eval-time defense covers hand-edited files | S:55 R:80 A:65 D:60 |
| 9 | Confident | Deliverer lives in `internal/cron/deliver.go` using a dedicated `inject.Engine` with buffer `rk-cron-send` | `Deliverer` type already lives in cron; per-client buffer names are the inject pattern; no import cycle | S:50 R:85 A:75 D:65 |
| 10 | Confident | Doctor row is informational OK-shaped (setting state + state-dir resolvability), never a FAIL | Doctor is a separate process — it can report config/disk facts only; matches the ephemeral/tmux-config row posture | S:55 R:90 A:70 D:65 |
| 11 | Confident | Rate-cap trip visibility = logged `rate-capped` outcome + `slog.Warn` (the one above-debug cron signal) | Spec demands visible tripping but the UI is C5/C6 — the log line is the future UI's derivation source; Warn is the daemon-log escalation available now | S:65 R:80 A:75 D:70 |

11 assumptions (1 certain, 10 confident, 0 tentative, 0 unresolved).
