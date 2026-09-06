---
type: memory
description: "The cron scheduling substrate — the `rk cron` CLI family (add/list/rm/mute/pin/tick; -L > caller-socket > default server resolution, creator auto-capture) over per-server intent entry files under $XDG_STATE_HOME/run-kit/cron/ with tolerant load and atomic mutation; the stateless evaluator (every / backoff anchor-join / wake_on cursor / suppress_while guards); the JSON-lines delivery log; the Deliverer seam; the tick orchestrator's guards (live-server filter, flock)."
---
# Cron

**Domain**: run-kit

## Overview

`internal/cron` (app/backend/internal/cron) is the server-scoped scheduling substrate core from the cron spec (`docs/specs/cron.md`): durable cron entries in one intent file per tmux server, a stateless pure evaluator, an append-only delivery log, and a tick orchestrator. The agent-facing surface is the `rk cron` CLI family below; the daemon goroutine, HTTP surface, and frontend are later waves of the cron clock plan.

## CLI: the `rk cron` Family

The `rk cron` cobra family (`app/backend/cmd/rk/cron.go` + per-verb files, the `rk mux` layout) is the agent-facing mutation and invocation surface over the library:

| Verb | Behavior |
|---|---|
| `add <payload>` | Records one entry via `cron.Add`; exactly one schedule flag — `--every <dur>`, bare `--backoff`, or `--cron "<expr>"`; creator and default target auto-captured inside a pane |
| `list [--json]` | One row per entry — id, name, schedule summary, target, deliver, flags, last-fired — or the same records as a JSON array |
| `rm <id>` | Removes one entry via `cron.Remove` |
| `mute <id> [--off]` / `pin <id> [--off]` | Set (bare) or unset (`--off`) the flag via `cron.SetMuted` / `cron.SetPinned` |
| `tick` | One `cron.Tick` sweep across every live server with zero-value `Deps` |

**Server resolution** follows the `rk mux` order: an explicit `-L/--server` wins, else the caller's own server derived from the original `$TMUX` socket basename (`tmux.OriginalTMUX`), else `default`. The resolved name is the cron file slug, validated by `cron.ValidSlug` before any path is built. `tick` takes no `-L` and rejects an explicitly-set one with a usage error — the sweep is all-live-servers by design.

**The add-flag ↔ schema mapping**: `--every` carries a positive Go duration into `schedule.interval`; bare `--backoff` builds `{kind: backoff, anchor: operator-idle, min: 60s, max: 30m}` with `--min`/`--max` refining it (a usage error without `--backoff`); `--cron "<expr>"` stores the expression as schema-valid intent — the evaluator skips kind `cron`, so `add` prints a one-line stderr note that expression evaluation is not implemented. `--deliver`/`--if-absent` are validated against the schema's closed sets at parse time (enforcement is the delivery wave's); `--name` defaults to the payload truncated to 40 runes; `--pinned` sets the flag. Success prints the assigned id and a one-line entry summary on stdout.

**Creator auto-capture and the default target**: inside a tmux pane, `add` stores `created_by: {pane: $TMUX_PANE, at: now}` — `session` stays empty (agent-session capture is a later wave). The default target is `{kind: role, role: operator}` when the caller's own window carries `@rk_win_role=operator` (resolved via `tmux.WindowIDForPane` + `tmux.GetWindowOption` with `tmux.RoleOption`), else `{kind: pane, pane: $TMUX_PANE}`; a failed role read degrades to the pane target with a stderr note, never aborts. Explicit `--role operator` / `--pane %N` (mutually exclusive, validated against `cron.RoleOperator` / `tmux.ValidPaneID`) override auto-capture; outside tmux an explicit target flag is required.

**`list` is disk-derived only**: entry file + delivery log, zero tmux commands — a tmux probe against a dead socket would resurrect the server, and next-fire/rung/orphan derivations need live facts that belong to the API wave. An absent or empty file is an empty listing (`[]` under `--json`) with exit 0; load diagnostics print to stderr without failing the listing.

**`tick` is the invoker verb**: it wraps `cron.Tick(ctx, cron.Deps{})` — flock, live-server filter, TMUX scrub, and tolerant load all inherited — under a bounded 60s context. No `Deliverer` is wired yet (the delivery wave substitutes the injection engine behind that seam), so fires record outcome `no-deliverer` while the fire/log/cursor choreography exercises. A held lock exits 0 quietly with no output; otherwise stdout carries a one-line summary — servers swept, fires, diagnostics count. Real errors (dir resolution, lock creation) exit non-zero via RunE.

## State Files

All cron state lives under `$XDG_STATE_HOME/run-kit/cron/` (`DefaultDir` — XDG-honoring with the `~/.local/state` fallback, the `snapshot.DefaultDir` resolution; dir 0700, files 0600). Server slugs are tmux socket names validated against `^[A-Za-z0-9_-]+$` (the snapshot-store rule) before any path is built — a validated slug can never traverse or split a path.

| Path | Content | Class |
|---|---|---|
| `<slug>.yaml` | cron entries — intent (the same class as `.status.yaml`) | intent |
| `<slug>.log` | delivery log, JSON lines | recovery-backup (history, never a live-state source) |
| `<slug>.cursor.yaml` | `wake_on` previous-observation cursor | startup seed cache (never authoritative) |
| `.lock` | non-blocking tick flock (no slug — one lock serializes a tick across all servers) | droppable |

## Entry Schema

Entry files are INTENT: runtime facts (`last_fired`, `next_fire`, backoff rung, orphaned-since) are never schema fields — they derive from the delivery log, the pane agent-state option, and the wake cursor. The typed schema (`schema.go`):

- `id` — 4-char rk-generated id (random from `[a-z0-9]`, unique within the server's file), assigned by `Add`.
- `name`, `payload` — display name and the text delivered on a fire.
- `schedule` — `kind: every | backoff | cron`; `every` carries `interval`; `backoff` carries `anchor` (`operator-idle` — the target pane's idle epoch) + `min` + `max`; `cron` carries a 5-field `expr`, recognized as schema-valid but never evaluated by the evaluator (skipped with a `schedule-kind-unsupported` diagnostic; the expression math is a later wave). Durations are Go `time.ParseDuration` strings (`60s`, `30m`).
- `wake_on` — `{event: agent-state-change, scope: server, debounce}` edge trigger OR'd with the schedule.
- `suppress_while` — list of guard names evaluated at fire time.
- `target` — `kind: role | session | pane` + the discriminant field (`role`, `session`, `pane`); the only defined role is `operator` (the `@rk_win_role` radio's closed set); pane targets must pass `tmux.ValidPaneID` (the `%N` grammar).
- `deliver` (`immediate | when-idle`) and `if_absent` (`skip | notify | respawn`) — carried in the schema, not enforced by this package (enforcement belongs to the delivery wave).
- `pinned`, `muted` — flags; a muted entry never fires (skipped with a `muted` diagnostic).
- `created_by` — `{session, pane, at}` provenance; `at` is the pre-delivery anchor for `every`.

Per-entry validation gates id presence, schedule-kind shape (positive interval, `max ≥ min`), and target shape. The mutation helpers `Add` / `Remove` / `SetMuted` / `SetPinned` read-modify-write the file atomically via `fsatomic.WriteFile`; the mutation read path is strict — a corrupt file is an error (`refusing to mutate`), never a silent drop of existing intent.

## Tolerant Load

`LoadEntries` never fails a tick: an absent file yields an empty set with no error; an unreadable or unparseable file yields an empty set plus a diagnostic (`entry-file-unreadable` / `entry-file-corrupt`); each entry is decoded from its own `yaml.Node` so one malformed entry (bad duration, unknown schedule kind, unknown target kind) is skipped with a per-entry `entry-invalid` diagnostic while the rest load. Unknown keys are ignored everywhere.

## The Stateless Evaluator

`Evaluate(EvalInput) EvalResult` is the pure core: no package-level mutable state, no I/O — equal inputs return deep-equal results (pinned by test), so every invoker (CLI tick, daemon ticker, manual) is equivalent. `EvalInput` carries everything disk-derivable: the server's entries, per-entry resolved `TargetFacts`, the server agent-state `Fingerprint`, the parsed delivery log, the previous `WakeCursor`, the fab `OperatorState` distillation, `FreshThreshold` (zero selects the default), and `Now`. `EvalResult` carries due `Fire`s (entry, resolved reason `schedule | wake`, resolved target pane, backoff rung, fire time), `Diagnostic`s, and the `NextCursor` for the tick orchestrator to persist. Composition order per entry: muted → schedule/wake due math → target resolution → guards — guards are ALWAYS evaluated before a fire is emitted (tick idempotency contract: a duplicate fire after restart is acceptable; a missed suppression is not). A suppressed or skipped fire is a silent diagnostic, never an error, never a recorded miss. An unknown guard name never holds and yields an `unknown-guard` diagnostic.

### `every`

Fires when `now − anchor ≥ interval`, where the anchor is the entry's newest delivery-log line, or `created_by.at` before any delivery.

### `backoff` and the anchor-join rule

Fire times are `anchor + min·(2ⁿ − 1)` — gaps `min, 2·min, 4·min, …` with each gap capped at `max`. The effective anchor is *the last activity not caused by the clock*. `JoinAnchor` joins the raw idle epoch (the target pane's `@rk_pane_agent_state` epoch, supplied in facts) against the entry's own delivery log:

- A raw epoch within `attributionWindow` (named constant, 120s) after the entry's own latest delivery is attributed to that delivery (the agent going busy/idle because the payload landed) and does NOT reset the ladder — including the stale-option skew case where the epoch still predates the delivery.
- On an attributed epoch, the rung is recovered by a backward streak walk over the log: consecutive own deliveries whose spacing fits the ladder shape (a gap must not be SMALLER than the ladder gap at its rung minus the attribution tolerance; larger gaps are invoker lateness, which idempotent ticks absorb). Cap-saturated gaps make deep rungs indistinguishable — the smallest consistent rung is chosen (an under-estimated anchor fires early at most once; the next delivery's short gap re-bases the ladder). The reconstructed anchor is the oldest streak delivery minus `min`. A consistency floor — next fire never earlier than last delivery + `min` — falls back to the conservative single-delivery streak when an ambiguous history would under-shoot it.
- No deliveries, or a non-attributed epoch (genuine activity): the ladder resets to rung 0 with the raw epoch as anchor.

Both inputs live on disk, so the schedule stays a pure function; a restart at worst re-fires one due tick. An implementation laddering off the raw epoch alone resets after every delivery (the self-resetting-ladder bug) and fails the shipped tests.

### `wake_on` poll approximation

A `wake_on: agent-state-change` entry fires when the server-scoped agent-state fingerprint (the canonical sorted `pane=state` rendering over panes carrying a state — map order never leaks in) differs from the entry's previous observation, debounced per entry. The rule (`wakeEdge`): no prior observation ⇒ cold start, no edge, the cursor seeds (`wake-cold-start` diagnostic); unchanged ⇒ no edge; changed and the observation is older than `debounce` ⇒ fire and advance the cursor; changed but younger ⇒ HOLD, keep the old observation (`wake-debounced`) — the poll cannot date the change itself, only bound it to after the observation, so holding is the conservative debounce and a burst coalesces into at most one fire. The cursor is keyed by entry id so one entry's fire cannot advance (and thereby swallow) another entry's pending edge.

The cursor persists at `<slug>.cursor.yaml`, written atomically by the tick orchestrator every tick. It is seed-cache class per Constitution II: absent/corrupt/empty degrades to a cold start (no edge fire that tick, cursor rewritten) — at worst one missed or duplicate edge, which tick idempotency absorbs.

### `suppress_while` guards

Two named guards ship, both reading the fab-owned operator state file (see External Contracts):

- `operator-loop-fresh` — holds while the file is present, its `last_tick_at` parses, and `now − last_tick_at ≤ threshold`. The threshold is an `EvalInput`/`Deps` parameter; zero selects `DefaultOperatorLoopFreshThreshold` (named constant, 120s — above the in-session loop's short-cadence ticks, below the operator tick's backoff `min×2`). This is the arbitration that keeps the cron silent while the in-session `/loop` is alive.
- `nothing-tracked` — holds while `monitored`, `watches`, and `autopilot` are all empty (lists/maps counted by length, a present scalar counts as 1, nil as 0).

Truth table over the state file: fresh ⇒ `operator-loop-fresh` holds; stale ⇒ does not; absent or corrupt (including an absent `last_tick_at`) ⇒ `operator-loop-fresh` does NOT hold (no fresh stamp exists) while `nothing-tracked` DOES hold (nothing is tracked). The full file-state × tracked-state × guard-list matrix is pinned by a table-driven test.

## Delivery Log

`<slug>.log` is append-only, one JSON line per attempted delivery: `{ts, entry, target, reason, outcome}`. It is the derivation source for `every`'s last-delivery and the backoff anchor-join streak — history (recovery-backup class), never a live-state source. `ParseLog` skips unparseable lines tolerantly; an absent or unreadable log parses as "no deliveries". When an append pushes the file past the cap (`logCapBytes`, 512 KiB), it is trimmed to its newest ~half, cut at a line boundary, written atomically via `fsatomic` — trimming loses only old history.

## Tick Orchestration

`Tick(ctx, deps)` runs one evaluation sweep — short-lived, idempotent, serialized by the flock: flock → live-server set → per-server load → facts → `Evaluate` → deliver → log → cursor. `Deps` is all seams (`Dir`, `Now`, `ListServers`, `Tmux`, `Deliverer`, `OperatorStatePath`, `FreshThreshold`); zero values select the production defaults (`DefaultDir`, `tmux.ListServers`, the real tmux seam, `time.Now`, `FabOperatorStatePath`). A nil `Deliverer` records outcome `no-deliverer` — the fire/log/cursor choreography still exercises. Every diagnostic surfaces at debug via `slog`; a per-file or per-server failure is a diagnostic, never an aborted tick.

- **flock**: a non-blocking exclusive flock (`syscall.Flock`, `LOCK_EX|LOCK_NB`) on `cron/.lock`. A held lock returns the `ErrTickHeld` sentinel internally; `Tick` treats it as a clean, quiet exit — no fires, no writes, no error, a debug-level note (skip-on-contention is correct because ticks are idempotent). `TickResult.Held` reports the held-lock no-op and `TickResult.Servers` the count of live servers actually swept, so an invoker can stay silent on contention and summarize otherwise.
- **Live-server filter first**: the tick derives its server set from `tmux.ListServers` (the live-socket-probed enumeration — the same filter `rk mux reap` and the managed-conf sweep rely on) and skips entry files whose server is not in that set entirely (`server-not-live` diagnostic, ZERO tmux commands) — a tmux command against a dead socket resurrects it, so the evaluator can never be a zombie-server factory.
- **TMUX scrub**: the package constructs no `exec` calls of its own; every tmux touch routes through the `TmuxSeam` interface whose production implementation delegates to `internal/tmux` (which scrubs `TMUX`/`TMUX_PANE` from the subprocess env and targets explicit `-L <server>`).
- **Deliverer seam**: `Deliverer` (`Deliver(ctx, Fire) Outcome`) is supplied by the caller; this package ships only test fakes. Injection-engine delivery, `deliver: when-idle` gating, `if_absent` handling, and circuit breakers live behind the interface in the delivery wave — it substitutes the implementation without touching evaluation. `Tick` appends one log line per attempted delivery with the outcome and persists the next wake cursor after evaluation.

## Fact Gathering & Target Resolution

`GatherFacts` resolves every entry's target on one live server in one enumeration pass (sessions → windows + panes; enumeration failures degrade to diagnostics): the server-scoped agent-state fingerprint (the `wake_on` input) comes from the enumerated panes' `@rk_pane_agent_state` values, and each resolved target pane's state + idle epoch (`tmux.PaneFactsCtx` — `StateEpoch` is the `backoff` anchor input) fills its `TargetFacts`. Resolution per target kind: `role: operator` finds the window carrying `@rk_win_role = operator` (the radio semantics — see [tmux-sessions](/run-kit/tmux-sessions.md)) and resolves its agent pane via `tmux.ResolveAgentPane`, never a bare `-t _rk-operator`; `session` finds the live pane carrying the `@rk_pane_agent_session` id (see [agent-state](/run-kit/agent-state.md)); `pane` checks id validity plus liveness via `tmux.PaneExists`. A target that fails resolution marks the entry's fires unresolvable this tick (`target-unresolved` diagnostic, never an error — `if_absent` policy belongs to the delivery wave).

## External Contracts

The fab operator state file at `$XDG_STATE_HOME/fab/operator/<server-slug>.yaml` (same XDG resolution root; `FabOperatorStatePath`) is a **fab-owned schema read tolerantly** — the same external-read class as the `.status.yaml` and `.fab-dispatch/` reads: unknown keys ignored, `last_tick_at` accepted as unix seconds (number or string) or an RFC3339/ISO-8601 timestamp, and an absent or unparseable file degrades to the cold posture above, never an error. Cron writes nothing to it.

## Requirements

### Requirement: Tolerant entry-file load
Loading a server's entry file SHALL ignore unknown keys, SHALL skip an invalid entry with a per-entry diagnostic without failing the file, SHALL treat an absent file as an empty entry set with no error, and SHALL treat a whole-file parse failure as an empty set plus a diagnostic — a corrupt file MUST never abort a tick. Mutation helpers MUST refuse to mutate a corrupt file and MUST write atomically.

#### Scenario: Mixed file loads the good, diagnoses the bad
- **GIVEN** an entry file with one valid entry, one entry with an unknown schedule kind, and a top-level unknown key
- **WHEN** loaded
- **THEN** the valid entry is returned, the invalid entry appears only in diagnostics, and no error is returned

### Requirement: Stateless deterministic evaluation
`Evaluate` SHALL hold no package-level mutable state and perform no I/O; two calls with equal inputs MUST return deep-equal results. Guard evaluation MUST precede due-fire emission, and a muted entry or a `cron`-kind schedule MUST skip with distinct diagnostics.

### Requirement: Backoff anchor-join
A `backoff` entry SHALL fire on the ladder `anchor + min·(2ⁿ − 1)` with per-gap cap `max`, where the effective anchor is derived by `JoinAnchor` from the raw idle epoch joined against the entry's own delivery log: an epoch within `attributionWindow` of the latest own delivery continues the trailing own-delivery streak; a non-attributed epoch resets to rung 0 with the epoch as anchor. An implementation deriving the ladder from the raw epoch alone MUST fail the package's tests.

#### Scenario: Attributed epoch continues the ladder
- **GIVEN** `min: 60s, max: 30m`, deliveries at T+1m and T+3m, and a raw idle epoch 5s after the T+3m delivery
- **WHEN** evaluated
- **THEN** the next fire is T+7m (rung 3), not T+3m+1m; **AND GIVEN** a raw epoch 10m after the T+3m delivery, **THEN** the rung resets and the next fire is epoch+60s

### Requirement: Wake-on delta with cold-start degradation
A `wake_on: agent-state-change` entry SHALL fire when the server fingerprint differs from its cursor observation older than `debounce`, SHALL hold (not fire) while the change is younger than `debounce`, and MUST treat an absent/corrupt cursor as a cold start — no edge fire that tick, cursor rewritten, never an error.

### Requirement: Guard truth table
`suppress_while` guards SHALL be evaluated at fire time; while any holds the fire SHALL be skipped silently. An absent or corrupt fab operator state file MUST mean `operator-loop-fresh` does not hold and `nothing-tracked` holds. An unknown guard name MUST never hold and MUST yield a diagnostic.

### Requirement: Live-server filter before any socket touch
The tick SHALL derive its server set from the live-socket-probed enumeration and MUST NOT issue any tmux command for a server outside that set; entry files for dead servers are skipped with a diagnostic only. The package MUST NOT construct its own tmux `exec` calls — all tmux interaction routes through `internal/tmux` behind the `TmuxSeam` interface.

#### Scenario: Dead server's entry file is never probed
- **GIVEN** entry files for servers `live1` and `dead1` where only `live1` enumerates
- **WHEN** a tick runs
- **THEN** facts are gathered and fires evaluated for `live1` only, and zero tmux commands target `dead1`

### Requirement: Idempotent, serialized tick
A tick SHALL take the non-blocking flock on `cron/.lock` before evaluating; when the lock is held elsewhere it MUST exit cleanly and quietly — no fires, no log writes, no error. A duplicate fire after a restart is acceptable; a missed suppression is not.

### Requirement: Delivery log as derivation source
Each attempted delivery SHALL append exactly one JSON line (`{ts, entry, target, reason, outcome}`); the parser SHALL expose per-entry last-delivery and the trailing own-delivery streak while skipping unparseable lines; an append past the 512 KiB cap SHALL atomically trim to the newest tail cut at a line boundary.

### Requirement: CLI server resolution and slug validation
The entry-file-scoped verbs (`add`, `list`, `rm`, `mute`, `pin`) SHALL resolve their tmux server as: explicit `-L/--server` wins, else the caller's own server from the original `$TMUX` socket basename, else `default`; the resolved name MUST pass `cron.ValidSlug` before any path is built. `tick` MUST reject an explicitly-set `-L` with a usage error — it sweeps every live server by design.

#### Scenario: Caller-socket resolution, tick refuses `-L`
- **GIVEN** a shell inside a tmux pane on socket `/tmp/tmux-1001/work,12,0`
- **WHEN** `rk cron list` runs with no `-L`
- **THEN** the entry file for slug `work` is read
- **AND** `rk cron tick -L work` exits non-zero with a usage error naming the flag

### Requirement: `add` schedule-flag and write contract
`rk cron add <payload>` SHALL require exactly one schedule flag — `--every` (a positive Go duration), bare `--backoff` (anchor `operator-idle`, `min 60s`/`max 30m` defaults; `--min`/`--max` without `--backoff` are a usage error), or `--cron` (stored as schema-valid intent with a stderr note that expression evaluation is not implemented). `--deliver`/`--if-absent` values MUST be validated against the schema's closed sets at parse time, and every write MUST go through `cron.Add`. Success prints the assigned id and a one-line entry summary on stdout.

#### Scenario: Mutual exclusion and enum validation
- **GIVEN** `rk cron add "check PRs" --every 1h --backoff`
- **WHEN** parsed
- **THEN** the command exits non-zero with a mutual-exclusion usage error
- **AND GIVEN** `--deliver sometimes`, **THEN** the command exits non-zero naming the valid values and the entry file is untouched

### Requirement: Creator auto-capture and default target
Inside a tmux pane, `add` SHALL store `created_by: {pane: $TMUX_PANE, at: now}` with `session` empty, and SHALL default the target to `role:operator` when the caller's window carries `@rk_win_role=operator`, else `pane:$TMUX_PANE`; a failed role read MUST degrade to the pane target, never abort. Explicit `--role operator` / `--pane %N` (mutually exclusive, validated) override auto-capture; outside tmux (`$TMUX_PANE` unset) an explicit target flag is REQUIRED — the command MUST NOT guess a target.

#### Scenario: Role window, plain pane, outside tmux
- **GIVEN** an agent pane `%12` in a window with no role, on server `work`
- **WHEN** `rk cron add "tick me" --every 5m` runs
- **THEN** the stored entry has `target: {kind: pane, pane: "%12"}` and `created_by: {pane: "%12", at: <now>}` with no `session`
- **AND GIVEN** the same command from the window carrying `@rk_win_role=operator`, **THEN** the target is `{kind: role, role: operator}`
- **AND GIVEN** `$TMUX_PANE` unset and no target flag, **THEN** the command exits non-zero telling the caller to pass `--role` or `--pane`

### Requirement: `list` derives from disk only
`rk cron list` SHALL read only the entry file and the delivery log — zero tmux commands — rendering one row per entry (id, name, schedule summary, target, deliver, flags, last-fired) or the same records as a `--json` array on stdout. An absent or empty file yields an empty listing with exit 0; corrupt entries surface as stderr diagnostics without failing the listing.

### Requirement: Single-entry mutation verbs
`rk cron rm <id>` SHALL remove via `cron.Remove`; `mute <id> [--off]` / `pin <id> [--off]` SHALL set/unset via `cron.SetMuted`/`cron.SetPinned`. An unknown id MUST exit non-zero with `no entry <id>` on stderr; each success prints a one-line confirmation on stdout.

### Requirement: `tick` invoker posture
`rk cron tick` SHALL wrap `cron.Tick` with zero-value `Deps` under a bounded context; a held lock MUST exit 0 quietly with no output; otherwise stdout carries a one-line summary (servers swept, fires, diagnostics count). With no `Deliverer` wired, fires record outcome `no-deliverer`.

## Design Decisions

### Anchor-join as a log-derived streak
**Decision**: rung = trailing streak of the entry's own deliveries whose following idle-epoch observations were attributed (within `attributionWindow` after a delivery); a non-attributed epoch resets rung 0 / anchor = epoch.
**Why**: the pre-delivery idle epoch is unrecoverable once tmux overwrites the option, so the log is the only durable record; the streak formulation is a pure function of (raw epoch, log) — both on disk, per the spec's statelessness requirement.
**Rejected**: persisting the effective anchor in a sidecar (a live-state store — Constitution II violation, and drift-prone); raw-epoch ladder (the self-resetting-ladder bug the plan's standing rule exists to reject).
*Introduced by*: 260906-3jtn-cron-core-evaluator

### Wake cursor as a seed-cache-class sidecar
**Decision**: the `wake_on` previous-observation fingerprint persists at `<slug>.cursor.yaml`; corrupt/absent = cold start (no edge fire that tick), rewritten every tick.
**Why**: a state-delta needs a previous observation; entry files must stay intent-only; Constitution II's seed-cache carve-out covers never-authoritative, droppable files.
**Rejected**: fingerprint in the entry file (runtime fact in an intent file); in-memory only (breaks the every-invoker-is-equivalent stateless contract).
*Introduced by*: 260906-3jtn-cron-core-evaluator

### `muted` as a schema field
**Decision**: add `muted: bool` to the entry schema (default false); the evaluator skips muted entries.
**Why**: the spec fixes mute as a first-class verb (`rk cron mute`, `POST /api/cron/mute`, the UI toggle) and states the file changes on mute — the flag must live in the intent file.
**Rejected**: a separate muted-ids sidecar (splits intent across files for no gain).
*Introduced by*: 260906-3jtn-cron-core-evaluator

### Delivery boundary at the `Deliverer` interface
**Decision**: `Tick` computes fires, resolves targets, and calls a caller-supplied `Deliverer`; injection, `when-idle`, `if_absent`, and circuit breakers live behind the interface (a later wave substitutes the injection-engine implementation).
**Why**: matches the cron clock plan's core/delivery split; keeps every core function testable without tmux delivery; the log-append and cursor-write choreography still exercises end-to-end in tests via the fake.
**Rejected**: stubbing `internal/inject` calls directly in the core (drags the delivery wave's scope in; injection gating decisions belong with the delivery change).
*Introduced by*: 260906-3jtn-cron-core-evaluator

### Bare `--backoff` with operator-idle defaults
**Decision**: `--backoff` is a boolean flag selecting anchor `operator-idle` with `min 60s` / `max 30m` defaults; `--min`/`--max` refine it.
**Why**: the spec's CLI table shows bare `--backoff`; the schema requires anchor+min+max; `operator-idle` is the only anchor defined; the defaults are the spec's operator-tick values.
**Rejected**: a required `--backoff <anchor>` value (only one legal value exists — ceremony without choice); a separate `--anchor` flag (same reason).
*Introduced by*: 260906-bi3v-rk-cron-cli

### `cron list` never touches tmux
**Decision**: `list` derives from the entry file + delivery log only; no next-fire/rung/orphan columns.
**Why**: any tmux command against a dead socket resurrects it (the zombie-server rule); next-fire/rung need live facts, which the API wave derives behind the HTTP surface.
**Rejected**: probing live servers for next-fire in the CLI (zombie hazard + duplicates the API wave's work).
*Introduced by*: 260906-bi3v-rk-cron-cli

### Mute/pin unset via `--off`
**Decision**: `mute <id> [--off]` and `pin <id> [--off]`; no `unmute`/`unpin` verbs.
**Why**: smallest surface satisfying the spec's mute toggle; maps 1:1 onto `SetMuted`/`SetPinned(bool)`.
**Rejected**: separate un-verbs (doubles the surface); toggle-on-repeat (non-idempotent scripts).
*Introduced by*: 260906-bi3v-rk-cron-cli

### Outside-tmux adds require an explicit target
**Decision**: `$TMUX_PANE` unset + no `--role`/`--pane` ⇒ hard error.
**Why**: the `rk role` posture — a typed command must not guess a target; auto-capture without a pane has nothing to capture.
**Rejected**: defaulting to `role:operator` (writes intent against a server the caller may not mean).
*Introduced by*: 260906-bi3v-rk-cron-cli

See [configuration](/run-kit/configuration.md) § Migrations & Breadcrumbs for the state-root inventory this tenant joins, [layout-snapshots](/run-kit/layout-snapshots.md) for the sibling state-root resolution pattern, and [test-sockets](/run-kit/test-sockets.md) for the tmux test-isolation conventions the package's tests follow.
