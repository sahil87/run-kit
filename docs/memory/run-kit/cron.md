---
type: memory
description: "Cron scheduling substrate — the `rk cron` CLI family (add/list/rm/mute/pin/tick) over per-server intent files under $XDG_STATE_HOME/run-kit/cron/; stateless evaluator (every / backoff anchor-join / wake_on cursor / suppress_while guards); delivery log; daemon Ticker; engine delivery, when-idle holds, if_absent dispositions, respawn + operator-tick seeding; circuit breakers; HTTP API (GET /api/cron derivations + deliveries; create/delete/mute/pin; notify deep-links); operator watchlist reader."
---
# Cron

**Domain**: run-kit

## Overview

`internal/cron` (app/backend/internal/cron) is the server-scoped scheduling substrate from the cron spec (`docs/specs/cron.md`): durable cron entries in one intent file per tmux server, a stateless pure evaluator, an append-only delivery log, a tick orchestrator, an injection-engine deliverer, and the daemon ticker goroutine that invokes ticks. The agent-facing surfaces are the `rk cron` CLI family below and the HTTP API (§ HTTP API). The UI's Tier-1 glance tier is the sidebar's desktop-only CLOCK section (the watched-row ◉ indicator and the cron palette actions included) — a pure projection over `GET /api/cron` and the payload's `monitored*`/`operatorStale` fields; [ui/sidebar](/run-kit/ui/sidebar.md) owns the frontend detail. The mobile Activity feed consuming the same endpoint is documented in [ui/cron-activity](/run-kit/ui/cron-activity.md). The dashboard tier remains a later wave of the cron clock plan.

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

**The add-flag ↔ schema mapping**: `--every` carries a positive Go duration into `schedule.interval`; bare `--backoff` builds `{kind: backoff, anchor: operator-idle, min: 60s, max: 30m}` with `--min`/`--max` refining it (a usage error without `--backoff`); `--cron "<expr>"` stores the expression as schema-valid intent — the evaluator skips kind `cron`, so `add` prints a one-line stderr note that expression evaluation is not implemented. `--deliver`/`--if-absent` are validated against the schema's closed sets at parse time (enforced at fire time by the deliverer and the tick orchestrator); `--name` defaults to the payload truncated to 40 runes; `--pinned` sets the flag. Success prints the assigned id and a one-line entry summary on stdout.

**Creator auto-capture and the default target**: inside a tmux pane, `add` stores `created_by: {pane: $TMUX_PANE, at: now}` — `session` stays empty (agent-session capture is a later wave). The default target is `{kind: role, role: operator}` when the caller's own window carries `@rk_win_role=operator` (resolved via `tmux.WindowIDForPane` + `tmux.GetWindowOption` with `tmux.RoleOption`), else `{kind: pane, pane: $TMUX_PANE}`; a failed role read degrades to the pane target with a stderr note, never aborts. Explicit `--role operator` / `--pane %N` (mutually exclusive, validated against `cron.RoleOperator` / `tmux.ValidPaneID`) override auto-capture; outside tmux an explicit target flag is required.

**`list` is disk-derived only**: entry file + delivery log, zero tmux commands — a tmux probe against a dead socket would resurrect the server, and next-fire/rung/orphan derivations need live facts, derived behind the HTTP API instead (§ HTTP API). An absent or empty file is an empty listing (`[]` under `--json`) with exit 0; load diagnostics print to stderr without failing the listing.

**`tick` is the invoker verb**: it wraps `cron.Tick(ctx, cron.Deps{})` — flock, live-server filter, TMUX scrub, and tolerant load all inherited — under a bounded 60s context. Zero-value `Deps` wires no `Deliverer` (fires record outcome `no-deliverer` while the fire/log/cursor choreography exercises) — the CLI verb is the debug invoker; delivering ticks are the daemon Ticker's (§ Daemon Ticker Invoker), which passes the `EngineDeliverer`. A held lock exits 0 quietly with no output; otherwise stdout carries a one-line summary — servers swept, fires, diagnostics count. Real errors (dir resolution, lock creation) exit non-zero via RunE.

## HTTP API

The cron HTTP surface (`app/backend/api/cron.go`, registered beside the other resource routes in `api/router.go`) is a thin JSON translation layer over `internal/cron` — all schedule math stays in the library (`DeriveEntry` calls `JoinAnchor`/`Ladder.NextFire`/`everyAnchor`/`LastDelivery`), the handlers never reimplement it. The wire shape is camelCase (the on-disk YAML's snake_case never crosses the HTTP edge); the server resolves via `serverFromRequest` (`?server=`).

| Route | Behavior |
|---|---|
| `GET /api/cron` | Every entry's intent fields plus the derived facts `lastFired` (unix seconds, 0 = never), `nextFire` (omitted when unknowable), `rung`, `orphaned` — `{"entries": [...]}`; plus a sibling `deliveries` array: the newest delivery-log lines (the log is chronological, so the tail is newest) projected most-recent-first via `cronDeliveriesToJSON` off the log `handleCronList` already loads (`cron.ReadLog` ≡ read + `ParseLog` — no second disk read), capped at `maxCronDeliveries` (50, named constant), each `{ts, entry, name, target, reason, outcome}` with `name` joined from the current entries (empty when the entry was since deleted — a delivery for a removed entry stays valid history). A live-server endpoint (unlike `rk cron list`): it gathers resolved-target facts via the `Server.cronFactsFn` seam (production wires `cron.GatherFactsLive`; nil on the test router), so backoff next-fire/rung and the orphaned flag are real. An absent/empty entry file or log yields `{"entries": [], "deliveries": []}` at 200, never 404; corrupt-entry diagnostics are logged server-side (`slog`), never surfaced |
| `POST /api/cron/create` | Body mirrors the `rk cron add` schema fields (name, schedule kind+params, target kind+params, payload, deliver, ifAbsent, pinned); `created_by.at` is set to now unconditionally (it anchors `every` schedules pre-first-delivery). Validates + persists via `cron.Add` — any `Add` error is a 400 with the underlying text; success is 201 with the created entry (assigned 4-char id) |
| `POST /api/cron/delete` | `{"id": "<4char>"}` → `cron.Remove`; unknown id ⇒ 404; success ⇒ 200 `{"ok": true}` |
| `POST /api/cron/mute` | `{"id": "<4char>", "muted": <bool>}` → `cron.SetMuted`; unknown id ⇒ 404; success ⇒ 200 `{"ok": true}` |
| `POST /api/cron/pin` | `{"id": "<4char>", "pinned": <bool>}` → `cron.SetPinned`; unknown id ⇒ 404; success ⇒ 200 `{"ok": true}` — mirrors mute's contract exactly |

Every mutation wakes the SSE hub explicitly on success (`s.initSSEHub(); s.sseHub.wake(server)` — the same wake-after-write pattern as `handleSessionStringOption`): entry-file writes emit no tmux control-mode event, so without the wake the repaint would wait for the safety poll.

**Per-entry derivation** (`internal/cron/derive.go`): `DeriveEntry(e, log, facts, now) DerivedEntry` computes `{NextFire, HasNextFire, Rung, Orphaned, LastFired}` per entry from the delivery log plus resolved `TargetFacts`. An `every` next-fire is `everyAnchor(e, log) + interval`; a `backoff` rung/next-fire come from `JoinAnchor(StateEpoch, OwnDeliveries, min, max)` — the reported rung is the ladder's + 1 (the upcoming fire's rung) — and are unknowable (`HasNextFire` false) without a resolved anchor epoch; a `cron`-kind entry reports no next-fire rather than a fabricated one. `Orphaned` is a live per-call snapshot of target resolution (`!facts.Resolved()`), never a persisted expiry state.

**Watchlist reader** (`internal/cron/watchlist.go`): `ReadWatchlist(path)` tolerantly parses the fab-owned operator state file's `monitored:` map (path via `FabOperatorStatePath`) into `[]WatchlistEntry{ChangeID, Pane, Repo, Session, Stage, Agent, Branch}` (sorted by ChangeID) plus `last_tick_at` — the same tolerant-read class as `guards.go`'s `ReadOperatorState`: unknown keys ignored, absent/corrupt file ⇒ `(nil, 0, false)`, never an error, an entry missing `pane` skipped (nothing to join against). rk never writes the file. `DefaultWatchlistStaleThreshold` (15m) is the UI-facing "is the monitoring system dead" window over `last_tick_at` — distinct from `DefaultOperatorLoopFreshThreshold` (120s), which gates the short-fuse in-session-loop suppress guard. The sessions-payload join this reader feeds is documented in [tmux-sessions](/run-kit/tmux-sessions.md) § Fab-Tier Derivation.

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
- `deliver` (`immediate | when-idle`) — delivery gating enforced by the deliverer: `immediate` (or empty) sends at fire time; `when-idle` holds while the target pane's agent state reads busy (§ EngineDeliverer).
- `if_absent` (`skip | notify | respawn`) — disposition of a due fire whose target doesn't resolve, applied by the tick orchestrator (§ Tick Orchestration's `if_absent` dispositions); `respawn` on a `role` target invokes the `Deps.Respawner` seam when wired (§ Role-Target Respawn), and degrades to `notify` plus a `respawn-unimplemented` diagnostic for a non-role target or a nil seam (session-target respawn belongs to later waves).
- `pinned`, `muted` — flags; a muted entry never fires (skipped with a `muted` diagnostic).
- `created_by` — `{session, pane, at}` provenance; `at` is the pre-delivery anchor for `every`.

Per-entry validation gates id presence, schedule-kind shape (positive interval, `max ≥ min`), and target shape. The mutation helpers `Add` / `Remove` / `SetMuted` / `SetPinned` read-modify-write the file atomically via `fsatomic.WriteFile`; the mutation read path is strict — a corrupt file is an error (`refusing to mutate`), never a silent drop of existing intent. `EnsureRoleEntry(dir, slug, spec)` is the idempotent seed helper: it scans the server's entries for one whose target is `{kind: role, role: spec.Target.Role}` — a hit returns the existing entry unmodified (`created=false`, no file write), a miss calls `Add` (`created=true`). Existing entries are never mutated: re-seeding after a user's edit (a `rk cron mute`, a rename, hand-tuned backoff bounds) leaves the edit alone — the role target is the idempotency key, not any field value.

## Operator-Tick Seeding

`rk operator` seeds the operator-tick entry on every invocation via `EnsureRoleEntry` — unconditionally, before the command's singleton probe (seeding is disk-only, independent of tmux window state, so it cannot sit behind either early-return branch) and best-effort (a seed failure is one stderr warning, never a non-zero exit and never a skipped window-open — the snapshotter/ticker posture). The seeded spec is the cron spec's own operator-tick example (`docs/specs/cron.md` § Cron State): backoff 60s→30m on the `operator-idle` anchor, `wake_on: {agent-state-change, scope: server, debounce: 10s}`, `suppress_while: [operator-loop-fresh, nothing-tracked]`, `target: {kind: role, role: operator}`, payload/name `"operator tick"`, `deliver: immediate`, `if_absent: respawn`, `pinned: true`, `created_by: {pane: $TMUX_PANE, at: now}` (session empty, the same auto-capture `rk cron add` uses inside a pane). The server slug derives from the caller-socket rule (`tmux.OriginalTMUX` → socket basename, the `cliServerLabel` helper) — see [rk-riff](/run-kit/rk-riff.md) § Single-Quote Escaping and Task Injection for the command side.

## Tolerant Load

`LoadEntries` never fails a tick: an absent file yields an empty set with no error; an unreadable or unparseable file yields an empty set plus a diagnostic (`entry-file-unreadable` / `entry-file-corrupt`); each entry is decoded from its own `yaml.Node` so one malformed entry (bad duration, unknown schedule kind, unknown target kind) is skipped with a per-entry `entry-invalid` diagnostic while the rest load. Unknown keys are ignored everywhere.

## The Stateless Evaluator

`Evaluate(EvalInput) EvalResult` is the pure core: no package-level mutable state, no I/O — equal inputs return deep-equal results (pinned by test), so every invoker (CLI tick, daemon ticker, manual) is equivalent. `EvalInput` carries everything disk-derivable: the server's entries, per-entry resolved `TargetFacts`, the server agent-state `Fingerprint`, the parsed delivery log, the previous `WakeCursor`, the fab `OperatorState` distillation, `FreshThreshold` (zero selects the default), and `Now`. `EvalResult` carries due `Fire`s (entry, resolved reason `schedule | wake`, resolved target pane, backoff rung, fire time), due-but-target-unresolved fires in `Absent []Fire` (emitted with an empty `PaneID` after guard evaluation, exactly as resolved fires — a suppressed absent fire is a silent diagnostic), `Diagnostic`s, and the `NextCursor` for the tick orchestrator to persist. Composition order per entry: muted → schedule/wake due math → target resolution → guards — guards are ALWAYS evaluated before a fire is emitted (tick idempotency contract: a duplicate fire after restart is acceptable; a missed suppression is not). A suppressed or skipped fire is a silent diagnostic, never an error, never a recorded miss. An unknown guard name never holds and yields an `unknown-guard` diagnostic.

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

`<slug>.log` is append-only, one JSON line per logged outcome: `{ts, entry, target, reason, outcome}`. The outcome classes are `delivered`, `failed: <detail>` (anchor advancement on failure is deliberate self-throttling — retry next due period, not next tick), `skipped-absent` / `notified-absent` (the `if_absent` dispositions), `respawned` / `respawn-failed: <detail>` (the role-target respawn dispositions — the `Respawner` seam's returned `Outcome` rendered verbatim; the detail's phase prefix, `readiness:` vs `send:`, distinguishes a pre-delivery classification failure from a post-ready send error), `rate-capped` (circuit-breaker trips), and `no-deliverer`. **Held outcomes are never appended** — a `when-idle` hold records a `delivery-held` diagnostic instead, because the log is the derivation source for `every`'s last-delivery and the backoff anchor-join streak: logging a held attempt would advance anchors and silently delay the fire by a full period. The hold is realized as cross-tick retry — the fire re-computes as due on the next tick. The log is history (recovery-backup class), never a live-state source. `ParseLog` skips unparseable lines tolerantly; an absent or unreadable log parses as "no deliveries". When an append pushes the file past the cap (`logCapBytes`, 512 KiB), it is trimmed to its newest ~half, cut at a line boundary, written atomically via `fsatomic` — trimming loses only old history.

## Tick Orchestration

`Tick(ctx, deps)` runs one evaluation sweep — short-lived, idempotent, serialized by the flock: flock → live-server set → per-server load → facts → `Evaluate` → deliver → log → cursor. `Deps` is all seams (`Dir`, `Now`, `ListServers`, `Tmux`, `Deliverer`, `Notifier`, `Respawner`, `OperatorStatePath`, `FreshThreshold`); zero values select the production defaults (`DefaultDir`, `tmux.ListServers`, the real tmux seam, `time.Now`, `push.Notify`, `FabOperatorStatePath`) — `Respawner` has no package-level default: production wires `cmd/rk`'s `rkCronRespawnRole` in `serve.go` (§ Role-Target Respawn), and nil keeps the notify-degrade path so a daemon built without the seam keeps working. A nil `Deliverer` records outcome `no-deliverer` — the fire/log/cursor choreography still exercises. Every diagnostic surfaces at debug via `slog` (the `rate-capped` circuit-breaker trip is the one escalation, at Warn); a per-file or per-server failure is a diagnostic, never an aborted tick.

- **flock**: a non-blocking exclusive flock (`syscall.Flock`, `LOCK_EX|LOCK_NB`) on `cron/.lock`. A held lock returns the `ErrTickHeld` sentinel internally; `Tick` treats it as a clean, quiet exit — no fires, no writes, no error, a debug-level note (skip-on-contention is correct because ticks are idempotent). `TickResult.Held` reports the held-lock no-op and `TickResult.Servers` the count of live servers actually swept, so an invoker can stay silent on contention and summarize otherwise.
- **Live-server filter first**: the tick derives its server set from `tmux.ListServers` (the live-socket-probed enumeration — the same filter `rk mux reap` and the managed-conf sweep rely on) and skips entry files whose server is not in that set entirely (`server-not-live` diagnostic, ZERO tmux commands) — a tmux command against a dead socket resurrects it, so the evaluator can never be a zombie-server factory.
- **TMUX scrub**: the package constructs no `exec` calls of its own; every tmux touch routes through the `TmuxSeam` interface whose production implementation delegates to `internal/tmux` (which scrubs `TMUX`/`TMUX_PANE` from the subprocess env and targets explicit `-L <server>`).
- **Deliverer seam**: `Deliverer` (`Deliver(ctx, Fire) Outcome`) is supplied by the caller; production wires the `EngineDeliverer` (below) and tests use fakes — the interface substitutes the implementation without touching evaluation. `Tick` appends one log line per non-held delivery outcome and persists the next wake cursor after evaluation.
- **if_absent dispositions**: for each `EvalResult.Absent` fire, `Tick` applies the entry's `if_absent` policy: `skip` (or empty) appends `skipped-absent`; `notify` calls the `Deps.Notifier` seam (production default `internal/push.Notify`, fail-silent — a notify error is a diagnostic, never a tick error) with title `cron: <entry name>`, body naming the server, and a deep-link URL (§ Notify Deep-Links), then appends `notified-absent`; `respawn` on a role target with a wired `Deps.Respawner` calls the seam and logs its returned outcome (`respawned` / `respawn-failed: <detail>` — § Role-Target Respawn); every other `respawn` combination (nil seam or a non-role target) degrades to the `notify` behavior plus a `respawn-unimplemented` diagnostic. Every logged disposition advances the schedule anchor, so a dead target produces one disposition per due period, not one per tick.

## Notify Deep-Links

Cron's fail-silent notify calls carry a same-origin deep-link to the mobile Activity feed (`internal/cron/push_url.go`). `PushURL(server, windowID)` — exported, pure — builds `/{server}/{N}?tab=activity` where the URL segment is the window id's numeric part (the tmux `@N` sans `@`), both segments path-escaped (the `waitingPushURL` shape); an empty windowID yields `""`. `operatorPushURL(ctx, server, seam)` — unexported — resolves the server's `role: operator` carrier window through the tick's `TmuxSeam` (the same `@rk_win_role` radio semantics `GatherFacts` uses — no new tmux surface) and returns its deep-link; the tick orchestrator's `if_absent: notify` call site passes it. `cmd/rk`'s respawn-failed escalation (`cronRespawnEscalate`) re-probes `list-windows` at notify time via `cronRespawnOperatorWindow` — the operator window may have been created by the failed respawn itself (the delivery-wall case), exactly when the link matters most — and passes the pure `PushURL` result through. The fail-silent contract is absolute: an unresolvable operator window yields `""` and the notify fires URL-less — the tick never errors, blocks, or retries over a missing deep link. The `tab=activity` param and the feed it selects are documented in [ui/cron-activity](/run-kit/ui/cron-activity.md).

## Daemon Ticker Invoker

`Ticker` (`ticker.go`, `NewTicker(deps).Start(ctx)`) is the daemon invoker: a goroutine invoking `cron.Tick` every `DefaultTickInterval` (30s — the operator backoff schedule's `min` is 60s, so the poll bounds fire lateness to half the smallest rung; `wake_on` is approximated by the same poll). It is isolated from the serving path: no shared locks (the only serialization is `Tick`'s own non-blocking flock), each iteration wrapped in panic recovery (a panicking tick logs at Error and skips the iteration — it never kills the daemon) and bounded by a per-tick context timeout (`tickTimeout`). A `cron_ticker` settings key (bool, default true, live — see [configuration](/run-kit/configuration.md)) gates every iteration via a fresh `settings.Load()`: off ⇒ the iteration skips with a debug note (no tmux or disk work), on ⇒ ticking resumes with no daemon restart. `serve.go` starts the ticker after the snapshotter block, bound to the serve context, with the snapshotter's best-effort posture: a `cron.DefaultDir()` resolution failure disables ticking with a single `slog.Warn`, never blocking serving. `rk doctor` renders an always-OK informational "cron ticker" row (the ephemeral/tmux-config posture) reporting the setting state and state-dir resolvability — doctor runs in a separate process, so it reports config + disk facts, not live goroutine state.

## EngineDeliverer

`EngineDeliverer` (`deliver.go`, `NewEngineDeliverer()`) is the production `Deliverer`: it sends through `internal/inject` — the one injection engine, never raw `send-keys` — via a dedicated `inject.Engine` on the per-client buffer `rk-cron-send` (the CLI/daemon precedent is `rk-agent-send`; see [agent-send](/run-kit/agent-send.md)) and a package-private `inject.Tmux` adapter (`cronInjectTmux`, mirroring `riffInjectTmux` since cron cannot import cmd or riff) delegating to `internal/tmux` context-bound primitives with the fire's stamped `Server`. Delivery inherits the pane-mode guard, `inject.Sanitize`, the novelty echo probe, and submit verification.

- `deliver: immediate` (or empty) sends now with submit; a send error yields outcome `failed: <detail>` (logged).
- `deliver: when-idle` reads the target pane's agent state at delivery time (`tmux.PaneAgentState` — fresher than the eval-time facts) and holds on `active | waiting` (the operator request-lane busy predicate): outcome `held-busy` with `Outcome.Held = true` — never log-appended (§ Delivery Log), retried by next-tick re-evaluation. `idle` and unknown (`""`) states deliver. There is no in-tick waiting — ticks stay short-lived — and no long-bound policy yet (drop vs deliver-late is spec open question 2); v1 holds indefinitely via cross-tick retry. A held `wake`-reason fire's edge is consumed (`Evaluate` computes `NextCursor` before delivery); the payload lands on the entry's next schedule-due or next edge.

## Role-Target Respawn

The production `Deps.Respawner` is `rkCronRespawnRole` (`cmd/rk/cron_respawn.go`), wired into the ticker's `cron.Deps` in `serve.go` alongside `Deliverer: cron.NewEngineDeliverer()`. It lives in `cmd/rk` because it needs `riff.ResolveAgent` and the tmux new-window/role-stamp calls that `internal/cron` cannot import (the `cronInjectTmux` package-boundary comment) — role-target fires only, a gate the tick's disposition switch enforces. Its flow for a fire on `fire.Server` (the spec's spawn-then-deliver composite):

1. **Defensive re-probe** — `list-windows -a` for the `@rk_win_role=operator` carrier, addressed at the fire's stamped server (`-L <slug>`, bare for the default server) with the daemon's TMUX/TMUX_PANE-scrubbed env. `if_absent` fired because evaluation found no carrier, but a window may have appeared across the 30s tick boundary; its creator owns its kickoff, so a hit returns `respawned` with an "already present" detail and NO delivery.
2. **Create-and-mark** — `createMarkedOperatorWindow` (the helper extracted from `rk operator`'s `runOperator`: `new-window` in the user's home directory — the daemon has no project cwd — → resolve the window id → atomic `stampOperatorRole`), driven by the daemon's own run-output seam.
3. **Spawn-then-deliver** — `inject.DeliverWhenReady` on a dedicated `rk-cron-respawn` buffer (the `rk-cron-send` per-client-buffer precedent), bounded by `operatorDeliverDeadline`, delivering the prefix-rendered kickoff — `riff.RenderSkillRef(agent.SkillPrefix, operatorKickoffPrompt)` over the canonical `/fab-operator` constant, with the operator tier resolved via the `cronRespawnResolveAgentFn` seam on an empty repo root (the daemon has no project cwd; a codex-tier operator gets `$fab-operator`) — NEVER `fire.Entry.Payload`: a fresh session has no tick convention in context, and the bare payload resumes on the entry's next resolved fire via the ordinary `Fires` branch — no has-kicked-off bookkeeping exists.
4. **Walls escalate, never retry** — a `parked`/`narrow`/`gone`/timeout classification or a send error notifies fail-silently via the same `push.Notify` channel `if_absent: notify` uses (naming the entry and server, carrying the § Notify Deep-Links URL when the operator window resolves) and returns `respawn-failed: <detail>`; the daemon spends no judgment round and never auto-answers a wall (the spec's `if_absent` ladder rule). Every tmux call is an argv-slice `exec.CommandContext` (Constitution §I).

Both respawn outcomes are non-held: each attempt appends one log line and advances the anchor like any other disposition (one attempt per due period, not per tick), and `countsTowardRate` counts `respawned`/`respawn-failed` toward the per-target rate cap, entry-ID keyed like the other absent-fire dispositions — a persistently-dead operator cannot storm respawns.

## Circuit Breakers

- **Per-target rate cap**: before delivering a resolved fire (and before absent dispositions), `Tick` counts the trailing hour's log lines for the same target — keyed on the fire's pane ID for resolved fires, on the entry ID for absent fires (their lines carry no pane); the counted classes are `delivered`, `failed: …`, `notified-absent`, `respawned`, `respawn-failed: …` (`countsTowardRate`), and held outcomes never appear in the log so they are inherently excluded — across all entries targeting it. At or past `DefaultTargetRatePerHour` (30, named constant) the fire is suppressed with outcome `rate-capped`. The trip is visible: the `rate-capped` line IS appended (anchor advancement self-throttles the storm; the log is the future UI's derivation source) AND surfaced at `slog.Warn` — the one cron diagnostic above debug.
- **Per-server entry cap**: `Add` refuses to add an entry past `MaxEntriesPerServer` (50, named constant) with an error naming the cap. Defensively, evaluation processes at most the first cap-many entries of a hand-edited larger file, skipping the excess with per-entry `entry-cap-exceeded` diagnostics.

## Fact Gathering & Target Resolution

`GatherFacts` resolves every entry's target on one live server in one enumeration pass (sessions → windows + panes; enumeration failures degrade to diagnostics): the server-scoped agent-state fingerprint (the `wake_on` input) comes from the enumerated panes' `@rk_pane_agent_state` values, and each resolved target pane's state + idle epoch (`tmux.PaneFactsCtx` — `StateEpoch` is the `backoff` anchor input) fills its `TargetFacts`. Resolution per target kind: `role: operator` finds the window carrying `@rk_win_role = operator` (the radio semantics — see [tmux-sessions](/run-kit/tmux-sessions.md)) and resolves its agent pane via `tmux.ResolveAgentPane`, never a bare `-t _rk-operator`; `session` finds the live pane carrying the `@rk_pane_agent_session` id (see [agent-state](/run-kit/agent-state.md)); `pane` checks id validity plus liveness via `tmux.PaneExists`. A target that fails resolution surfaces the entry's due fires in `EvalResult.Absent` for the tick's `if_absent` dispositions (`target-unresolved` diagnostic, never an error).

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
Each non-held delivery outcome SHALL append exactly one JSON line (`{ts, entry, target, reason, outcome}`); a held outcome MUST append nothing (a `delivery-held` diagnostic is recorded instead) so anchors and the backoff streak join are unchanged by holds and the fire is due again next tick; the parser SHALL expose per-entry last-delivery and the trailing own-delivery streak while skipping unparseable lines; an append past the 512 KiB cap SHALL atomically trim to the newest tail cut at a line boundary.

### Requirement: Daemon ticker invoker
A `Ticker` SHALL invoke `Tick` at `DefaultTickInterval` (30s), bound to the serve context, with panic recovery per iteration (a panic logs and skips the iteration) and a per-tick context timeout. Each iteration SHALL consult the `cron_ticker` setting (bool, default true, live) — when off, the iteration skips without tmux or disk work; when re-enabled, ticking resumes without a restart. Startup MUST follow the snapshotter's best-effort posture: a state-dir resolution failure disables ticking with a Warn, never blocking serving.

### Requirement: Injection-engine delivery with when-idle holds
Delivery SHALL go through `internal/inject` on the dedicated buffer `rk-cron-send` — never raw `send-keys`. `deliver: when-idle` SHALL read the target pane's agent state at delivery time and hold (outcome `held-busy`, `Held: true`) on `active | waiting`; `idle` and unknown states deliver. A send failure SHALL log `failed: <detail>`.

### Requirement: if_absent dispositions
Due-but-target-unresolved fires SHALL surface in `EvalResult.Absent` (guards evaluated before emission; a suppressed absent fire is a silent diagnostic). `Tick` SHALL apply `skip` (log `skipped-absent`), `notify` (fail-silent notifier + `notified-absent`), and — for a role target with a wired `Deps.Respawner` — `respawn` (call the seam, log its returned `respawned`/`respawn-failed: <detail>` outcome); a nil seam or a non-role target SHALL degrade `respawn` to notify plus a `respawn-unimplemented` diagnostic, byte-for-byte the unwired-fallback behavior. Logged dispositions SHALL advance the anchor — one disposition per due period, not per tick.

### Requirement: Idempotent role-entry seeding
`EnsureRoleEntry` SHALL treat an existing entry whose target matches `{kind: role, role: spec.Target.Role}` as already-seeded (returned unmodified, no file write) and SHALL otherwise add the spec via `Add`; it MUST never mutate an existing entry. `rk operator` SHALL invoke it with the fixed operator-tick spec on every run, before the singleton probe, best-effort — a seed failure MUST warn on stderr without changing the exit code or skipping the window open.

### Requirement: Role-target respawn mechanics
The production Respawner SHALL re-probe for the role carrier first (an already-present window is a `respawned` success with NO delivery — its creator owns the kickoff), create-and-mark the window atomically when absent, and deliver the kickoff prompt via `inject.DeliverWhenReady` only on a `ready` classification — never the entry's bare payload. Any non-`ready` classification or send error SHALL escalate via the fail-silent notifier and return `respawn-failed: <detail>`; the daemon MUST NOT retry in-tick, deliver into an unclassified pane, or auto-answer a wall. Respawn outcomes SHALL count toward the per-target rate cap (entry-ID keyed) and advance the anchor like any other logged disposition.

### Requirement: Circuit breakers
Before delivery, `Tick` SHALL suppress a fire at or past `DefaultTargetRatePerHour` (30 trailing-hour log lines keyed on pane ID, or entry ID for absent fires) with a logged `rate-capped` outcome AND a `slog.Warn`. `Add` SHALL refuse past `MaxEntriesPerServer` (50) with a named-cap error, and evaluation SHALL process only the first cap-many entries of an oversized file with `entry-cap-exceeded` diagnostics.

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

### Requirement: `GET /api/cron` derived-facts projection
`GET /api/cron?server=<slug>` SHALL return `{"entries": [...], "deliveries": [...]}` — each entry's intent fields with the derived facts (`nextFire`/`rung`/`orphaned`/`lastFired`) computed by `cron.DeriveEntry` (the API layer MUST NOT reimplement schedule math), plus the recent delivery log projected most-recent-first, capped at the named `maxCronDeliveries` constant, each line carrying `{ts, entry, name, target, reason, outcome}` with `name` joined from the current entries (empty for a since-deleted entry). An absent or empty entry file or log SHALL yield `{"entries": [], "deliveries": []}` at 200, never 404 or an error; corrupt-entry diagnostics SHALL be logged server-side and never surfaced to the client. A `cron`-kind entry SHALL report no next-fire rather than a fabricated one.

### Requirement: cron mutation routes
`POST /api/cron/create` SHALL validate and persist via `cron.Add` (any `Add` error ⇒ 400 with its text; success ⇒ 201 with the created entry, `created_by.at` always set to now); `POST /api/cron/delete` ← `{"id"}`, `POST /api/cron/mute` ← `{"id", "muted"}`, and `POST /api/cron/pin` ← `{"id", "pinned"}` SHALL mutate via `cron.Remove`/`cron.SetMuted`/`cron.SetPinned`, 404 on an unknown id, 200 `{"ok": true}` on success. All four SHALL wake the SSE hub explicitly on success (`initSSEHub(); sseHub.wake(server)`) — entry-file writes emit no tmux control-mode event.

### Requirement: tolerant watchlist read
`cron.ReadWatchlist` SHALL parse the fab operator state file's `monitored:` map tolerantly — an absent or corrupt file degrades to `(nil, 0, false)`, never an error; an entry missing `pane` SHALL be skipped (nothing to join against). rk SHALL never write the fab-owned file.

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
**Decision**: `Tick` computes fires, resolves targets, and calls a caller-supplied `Deliverer`; injection, `when-idle` gating, `if_absent` handling, and circuit breakers live behind the interface in the production `EngineDeliverer`, which substitutes in without touching evaluation.
**Why**: matches the cron clock plan's core/delivery split; keeps every core function testable without tmux delivery; the log-append and cursor-write choreography still exercises end-to-end in tests via the fake.
**Rejected**: stubbing `internal/inject` calls directly in the core (drags delivery scope into the core; injection gating decisions belong with the deliverer).
*Introduced by*: 260906-3jtn-cron-core-evaluator

### Bare `--backoff` with operator-idle defaults
**Decision**: `--backoff` is a boolean flag selecting anchor `operator-idle` with `min 60s` / `max 30m` defaults; `--min`/`--max` refine it.
**Why**: the spec's CLI table shows bare `--backoff`; the schema requires anchor+min+max; `operator-idle` is the only anchor defined; the defaults are the spec's operator-tick values.
**Rejected**: a required `--backoff <anchor>` value (only one legal value exists — ceremony without choice); a separate `--anchor` flag (same reason).
*Introduced by*: 260906-bi3v-rk-cron-cli

### `cron list` never touches tmux
**Decision**: `list` derives from the entry file + delivery log only; no next-fire/rung/orphan columns.
**Why**: any tmux command against a dead socket resurrects it (the zombie-server rule); next-fire/rung need live facts, derived behind the HTTP surface instead (`GET /api/cron`, § HTTP API).
**Rejected**: probing live servers for next-fire in the CLI (zombie hazard + duplicates the HTTP API's derivation).
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
### Held outcomes never reach the delivery log
**Decision**: `Outcome.Held` outcomes skip the log append; the hold is cross-tick retry via unchanged anchors.
**Why**: the log is the anchor-derivation source (`every` last-line, backoff streak join) — logging a held attempt advances anchors and silently delays the fire by a full period; not logging makes re-evaluation the retry mechanism for free.
**Rejected**: logging held attempts with an outcome filter in the schedule math (touches the pinned derivation semantics for no gain); in-tick waiting for idle (violates the short-lived-tick contract).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

### Held wake edges are consumed
**Decision**: a `wake`-reason fire held under `when-idle` does not restore the wake cursor; the payload lands on the entry's next schedule-due or next edge.
**Why**: `Evaluate` computes `NextCursor` before delivery outcomes exist; re-plumbing cursor persistence around outcomes buys nothing real — the only planned wake user (operator tick) is `deliver: immediate`.
**Rejected**: outcome-aware cursor persistence (couples the pure evaluator to delivery results).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

### `when-idle` busy predicate is `active | waiting`
**Decision**: hold on `active` and `waiting`; deliver on `idle` and unknown ("").
**Why**: matches the operator request-lane busy gate (`api/operator.go`); typing into a `waiting` pane would stack a payload behind a pending question; an unknown-state pane (plain shell, no agent) can't be gated on a signal it doesn't carry.
**Rejected**: hold on unknown (a when-idle entry targeting a non-agent pane would never fire).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

### Rate-cap key: pane ID for resolved fires, entry ID for absent fires
**Decision**: the trailing-hour count keys on the log line's target pane for deliveries, and on the entry ID for absent dispositions (their lines carry no pane).
**Why**: the spec's cap is per-target; absent fires have no target, but their notify path still needs the cap (the spec assigns notify throttling to it).
**Rejected**: a separate notify-cursor sidecar (the pulse plan's design, obsoleted by the spec's "the rate cap covers notify throttling").
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

### Role-target presence as the seed idempotency key
**Decision**: `EnsureRoleEntry` treats "an entry with `target: {kind: role, role: X}` exists on this server" as the sole seeded/not-seeded signal; a hit is returned unmodified.
**Why**: the "one operator per server" radio invariant (`@rk_win_role=operator`) makes role-target presence the unambiguous, drift-proof key — it survives a user renaming, muting, or hand-tuning the entry; entry files are intent that only `rk cron` verbs mutate, so seeding establishes once and never reconciles over a user's edits.
**Rejected**: a name/payload string match (breaks the moment the display text changes); a reserved fixed entry ID (special-cases outside `Add`'s uniform random-assignment contract for no real gain).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

### `Respawner` as a third nil-safe seam, role targets only
**Decision**: `Deps.Respawner func(ctx, Fire) Outcome`, consulted only for `if_absent: respawn` on a `role` target; nil or a non-role target keeps the notify-degrade path byte-for-byte.
**Why**: mirrors the `Deliverer`/`Notifier` seam shape — the disk/logic core stays testable via fakes while production wires the real implementation in `serve.go`; the role-only gate matches the wave scoping (session-target `claude --resume` respawn is a later wave) and lives at one explicit branch in the disposition switch.
**Rejected**: overloading `Deliverer` to also handle absent-fire respawn (conflates resolved-fire delivery with absent-fire disposition — different inputs and failure semantics).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

### Respawn delivers the kickoff, never the bare payload
**Decision**: the Respawner always delivers the kickoff — the canonical `/fab-operator` constant rendered per the resolved provider's `skill_prefix` (`riff.RenderSkillRef`), never the entry's bare payload; the payload is delivered by the ordinary `EngineDeliverer` path on the next non-absent fire — no has-kicked-off state exists anywhere.
**Why**: `if_absent: respawn` runs only when target resolution already failed, so every respawn is first contact with a fresh session that has no tick convention in context; once the role resolves live, the next fire takes the `Fires` branch and the kickoff-vs-payload distinction falls out of the branch split for free.
**Rejected**: a persisted kicked-off flag on the entry or in a sidecar (an intent file is the wrong place for a runtime fact, and the branch split already encodes it).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

### Escalate-don't-wait for respawn walls
**Decision**: a non-`ready` readiness classification or a send error during respawn calls the fail-silent notifier (entry + server named) and returns `respawn-failed` — no in-tick retry, no judgment round, no delivery into an unclassified pane.
**Why**: the judgment-round carve-out exists for a human-attended dispatch loop; the daemon tick has no human to answer a wall, and the spec's ladder rule is that the clock never auto-answers walls — escalation to a human is the only safe posture.
**Rejected**: cross-tick readiness retry without escalation (a silently-stuck respawn defeats the backstop's purpose); auto-answering common wall patterns (the spec's explicit prohibition).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

### Derivation logic lives in `internal/cron`, not the `api` package
**Decision**: `DeriveEntry` (next-fire/rung/orphaned/last-fired) is an exported function in `internal/cron`; the `GET /api/cron` handler is a thin JSON translation layer over it.
**Why**: `internal/cron` already owns every piece of the underlying math (`JoinAnchor`, `Ladder.NextFire`, `everyAnchor`, `LastDelivery`); keeping the derivation there matches the existing package boundary and keeps the projection logic testable independent of HTTP.
**Rejected**: inlining the derivation in `api/cron.go` — duplicates package-private schedule math or forces exporting internals purely for one caller.
*Introduced by*: 260907-1jm6-cron-api-derivations

### Watchlist staleness attaches to every `ProjectSession`
**Decision**: `OperatorLastTickAt`/`OperatorStale` populate identically on every session returned for one server, rather than only the `Hidden` operator session.
**Why**: simpler consumer contract — no special-casing to locate the `Hidden` session first; the repeated bytes are negligible (one int64 + one bool × a handful of sessions per server).
**Rejected**: attaching only to the `Hidden` operator session — matches its "operator row's own data source" precedent more narrowly, but forces every consumer to filter for it first.
*Introduced by*: 260907-1jm6-cron-api-derivations

### `pin` rides the same HTTP contract as `mute`
**Decision**: `POST /api/cron/pin` ← `{"id", "pinned"}` mutates via `cron.SetPinned` — 404 on an unknown id, 200 `{"ok": true}` plus an SSE hub wake on success, mirroring `POST /api/cron/mute` byte-for-byte in shape.
**Why**: the mobile entry detail sheet's pin row (the spec's alarm-app anatomy — [ui/cron-activity](/run-kit/ui/cron-activity.md)) needs a pin mutation reachable from the browser; mirroring mute's contract keeps the mutation surface uniform and adds no new response shape.
**Rejected**: keeping `cron.SetPinned` CLI-only (strands the mobile sheet's pin row); a differently-shaped pin body (diverges from the mute precedent for no reason).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### The pin route waited for a consumer
**Decision**: pin's HTTP endpoint exists only because a browser consumer appeared — the CLI-only posture held while no caller needed pin over HTTP and gave way when the mobile detail sheet became that caller.
**Why**: speculative HTTP surface is avoided by policy (minimal surface, Constitution IV); the CLI-only stance was conditional ("no consumer"), and the condition expired rather than the principle breaking.
**Rejected**: adding the route preemptively ahead of any consumer (speculative surface); silently overwriting the earlier CLI-only entry (a reversal recorded in place keeps the decision's history legible, FKF §3.3).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### Delivery history rides the existing `GET /api/cron` endpoint
**Decision**: recent deliveries project as a sibling `deliveries` array on the existing `GET /api/cron` response, not a new endpoint.
**Why**: Constitution IV (minimal surface) and the one-thin-read-endpoint pattern both favor extending; `handleCronList` already holds the parsed log (`cron.ReadLog`), so the projection is a pure slice of loaded data, not a new code path.
**Rejected**: a separate `GET /api/cron/log` endpoint (doubles the read surface for data always consumed alongside `entries`).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### Notify deep-links target the Activity segment, not a specific entry
**Decision**: the cron notify deep-link is `/{server}/{operatorWindowNum}?tab=activity`, with no entry id in the URL; the helper is split into an exported pure `PushURL(server, windowID)` builder plus the unexported `operatorPushURL` resolver so `cmd/rk`'s escalation (which resolves windows through its own run-output seam) reuses the builder without new `Deps` surface.
**Why**: the spec's notification deep-links to the Activity segment, not to a specific entry's detail sheet; the pure/seam split keeps `internal/cron`'s exported surface minimal and each half unit-testable through its existing fake.
**Rejected**: carrying `&entry=<id>` to auto-open a detail sheet (speculative surface beyond the stated requirement); one monolithic resolver (forces the `cmd/rk` caller through the tick's seam it doesn't hold).
*Introduced by*: 260907-yxen-mobile-cron-activity-feed

### Watchlist staleness threshold is 15 minutes
**Decision**: the named constant `DefaultWatchlistStaleThreshold` (15m) gates `OperatorStale`.
**Why**: the spec names `last_tick_at` as "the single staleness timestamp" but gives no number; a named constant (mirroring `DefaultOperatorLoopFreshThreshold`'s pattern) keeps the value a one-line change.
**Rejected**: reusing `DefaultOperatorLoopFreshThreshold` (120s) directly — that threshold answers a different, much-shorter-fuse question ("is the in-session `/loop` still ticking") and would false-trip watchlist staleness constantly.
*Introduced by*: 260907-1jm6-cron-api-derivations

See [configuration](/run-kit/configuration.md) § Migrations & Breadcrumbs for the state-root inventory this tenant joins, [layout-snapshots](/run-kit/layout-snapshots.md) for the sibling state-root resolution pattern, and [test-sockets](/run-kit/test-sockets.md) for the tmux test-isolation conventions the package's tests follow.
