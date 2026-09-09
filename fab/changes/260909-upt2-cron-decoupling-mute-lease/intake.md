# Intake: Cron Decoupling — Mute Lease, Generic Roles, Caller-Supplied Respawn

**Change**: 260909-upt2-cron-decoupling-mute-lease
**Created**: 2026-09-09

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized design conversation with the user. The description below is the sole source; it names exact values, schema shapes, CLI flags, and behaviors, which are carried verbatim into § What Changes.

> **Title**: Cron decoupling — explicit operator control (mute lease), generic roles, schema-less backoff anchor, caller-supplied respawn, fab-file path fix, help clarification
>
> **Origin / problem (observed 2026-09-09)**: The seeded `operator tick` cron entry (id 9de2 on server runKit) has not delivered to the operator since 04:02 IST even though the sidebar CLOCK row shows `operator tick  role: operator  rung 1  in 0s` (due now). The daemon ticker is healthy (30s cadence, cursor rewritten every tick, target resolves to the codex operator pane). A read-only run of `cron.Evaluate` against live state produced exactly one diagnostic: `suppressed — guard nothing-tracked holds`.
>
> Root cause: `cron.FabOperatorStatePath(slug)` (app/backend/internal/cron/dir.go) builds `$XDG_STATE_HOME/fab/operator/<tmux server name>.yaml` (e.g. `runKit.yaml`). fab-kit writes the file as `<slugified socket path>.yaml` (e.g. `tmp-tmux--1001-runKit.yaml`; see fab-kit `src/go/fab/cmd/fab/operator.go` `slugify`/`serverSlug`: escape literal `-` as `--` first, strip the leading `/`, replace `/` with `-`, empty ⇒ `default`). The spec uses the term "server-slug" for both and the two repos resolved it differently. An absent file is the documented cold posture: `operator-loop-fresh` does not hold, `nothing-tracked` DOES hold — so the guard suppresses every fire on every server, forever, silently (suppressions are debug-level diagnostics). The same path bug blinds the sessions payload's watchlist join (`internal/sessions/sessions.go` ~line 605 via `cron.ReadWatchlist`), so the ◉ watched-row marks and the `⚠ operator stale` CLOCK header warning never appear.
>
> Secondary observation: even with the path fixed, `nothing-tracked` would decide by `trackedLen` counting top-level map keys of `autopilot`, so a finished autopilot (`completed`/`queue` keys, `current: null`) reads as tracked.
>
> **Design decision (the user's, agreed in discussion)**: The path bug is a symptom. The design flaw is that the clock infers operator intent by reading fab's private state file — rk parsing another tool's schema (a CLI-layering violation: rk owns the tmux/agent substrate, fab owns choreography). Fix: the operator TELLS the clock through the clock's own verbs, and cron becomes operator-agnostic — the operator is one consumer among many.
>
> **What changes (run-kit side ONLY)**: (1) delete both `suppress_while` guards and `guards.go`; (2) mute lease `rk cron mute <id> --for <dur>` persisted as `muted_until`; (3) drop the schedule `anchor` field (`{kind: backoff, min, max}`), remove `operator-idle` everywhere; (4) role targets accept any role; (5) caller-supplied per-entry `respawn: [argv...]` with a `{server}` placeholder, delete the built-in role respawner, keep session-resume as the session-target default; (6) `rk operator` seeds the new entry shape; (7) fix the fab operator state file path for DISPLAY only via `tmux.SocketPath` + fab's slugify rule, pinned as a cross-repo contract; (8) surface `muted`/`mutedUntil` in the API, the CLOCK row (`muted 4m` badge), and `rk cron list`; (9) `rk cron add` help states the payload is text typed into the agent's chat, never a shell command; (10) docs.
>
> **Out of scope**: fab-kit changes (the operator skill issuing `rk cron mute --for` renewals / plain mute when stopping with nothing tracked / `mute --off` on enroll) — a follow-up intake in the fab-kit repo. Interim behavior accepted knowingly: until the fab-kit side ships, the idle operator is ticked every backoff step with nothing suppressing it (loud but safe; the user can mute by hand). Any per-role launch registry beyond the per-entry `respawn` argv.
>
> **Interim mitigation the user may apply by hand (not part of the change)**: `rk cron mute 9de2` / `rk cron mute 9de2 --off`.

Interaction mode: one-shot dispatch; no questions asked (promptless-defer). Every decision the description left to the designer is graded in § Assumptions.

## Why

**The pain point.** The operator-tick backstop — the whole reason the cron substrate exists (kill the dead-operator-loop incident class) — has been silently dead on every server since the day the guards shipped. `cron.FabOperatorStatePath` names the fab operator state file `<server>.yaml` while fab writes `<slugified socket path>.yaml`; rk never finds the file, the documented cold posture makes `nothing-tracked` hold, and every fire is suppressed with a debug-level diagnostic. Nothing in the UI distinguishes "held back by a guard" from "about to fire": the CLOCK row sits at `in 0s` indefinitely. The same path bug blinds the ◉ watched-row marks and the `⚠ operator stale` header warning.

**Why not just fix the path.** Fixing `FabOperatorStatePath` would restore today's behavior, but today's behavior is the design flaw: rk decides whether to fire by parsing fab's private state-file schema (`last_tick_at`, `monitored`, `watches`, `autopilot`). That is a CLI-layering violation (`docs/specs/cli-layering.md`: rk owns the tmux/agent substrate, fab owns pipeline choreography) with a concrete second bug already visible — `trackedLen` counts top-level map keys of `autopilot`, so a finished autopilot (`completed`/`queue` keys, `current: null`) reads as tracked. Every future fab schema change becomes a latent cron regression in rk. The cure is inversion of control: fab TELLS the clock through the clock's own verbs (mute / lease / unmute), and cron stops knowing anything about the operator.

**Why a lease, not a plain mute.** The in-session operator loop wants "I'm alive, hold off" semantics. A plain mute expresses "hold off" but not "while I'm alive": if the operator crashes after muting, the backstop stays muted and the incident class returns. A lease (`--for <dur>`, renewed each tick) lapses on its own when the loop dies, so the cron backstop resumes with no further call — the dead-man's-switch shape the spec's staleness banner already uses.

**Why the rest travels with it.** Once the guards go, the last operator-specific knowledge inside cron is (a) the `operator-idle` anchor name — a field that names nothing, since `kind: backoff` already means "ladder keyed on the TARGET pane's idle epoch, reset by genuine activity" (the anchor-join math is target-generic and never reads the field); (b) the `Role != operator ⇒ unresolved` checks — the only reason for the operator-only rule is that one role value exists today, and resolution is already generic; (c) the built-in role respawner's window-create + `/fab-operator` kickoff path — fab knowledge inside the daemon. Replacing (c) with a caller-supplied argv (`respawn: ["rk","operator","-L","{server}"]`) makes the clock a generic executor and keeps fab's launch knowledge in fab's own entry. The rejected alternative for (a) — renaming the anchor to `target-idle` — was turned down by the user in favor of removing the field entirely.

**If we don't fix it.** The backstop stays dead everywhere; the watchlist UI stays blind; any operator built on a non-fab choreography can never use the clock; and the next fab state-schema tweak silently changes rk's firing behavior again.

## What Changes

### 1. Delete the `suppress_while` guards (CONTROL read of fab's state file)

`app/backend/internal/cron/`:

- **`guards.go` and `guards_test.go` are deleted**: `OperatorState`, `ParseOperatorState`, `ReadOperatorState`, `guardHolds`, `DefaultOperatorLoopFreshThreshold`, and the `GuardOperatorLoopFresh` / `GuardNothingTracked` constants (schema.go) all go.
- **`Evaluate` no longer takes operator state**: `EvalInput` loses `Operator OperatorState` and `FreshThreshold time.Duration`; the guard loop in `Evaluate` (the `for _, g := range e.SuppressWhile` block emitting `suppressed` / `unknown-guard` diagnostics) is removed. Composition order becomes: muted (incl. lease, § 2) → schedule/wake due math → target resolution → emit.
- **`Deps` loses `OperatorStatePath` and `FreshThreshold`**; `tickServer` stops reading the operator state file; the `ReadOperatorState` call site in `tick.go` goes.
- **Tolerant read of the retired key**: `suppress_while` in an entry file is accepted and ignored on load (yaml.v3 ignores unknown keys once the struct field is removed — `Entry.SuppressWhile` is deleted, so existing files keep loading with no diagnostic). The file is not rewritten on read; the key disappears the next time any mutation verb marshals that file.
- The `operator tick` seed (§ 6) and `rk cron add` no longer produce the key. `rk cron add` never exposed a guard flag, so no CLI surface changes here.
- The cron spec's `suppress_while` bullet, the `nothing-tracked`/`operator-loop-fresh` truth table, and the P1.5 "zero fab-operator skill changes — the guard keeps the cron silent" posture are removed from `docs/specs/cron.md` (§ 10).

### 2. Mute lease — `rk cron mute <id> --for <dur>`

**Schema** (`schema.go`): `Entry` gains `MutedUntil int64 \`yaml:"muted_until,omitempty"\`` — unix seconds — alongside the existing `Muted bool`. Both are intent fields set only by mutation verbs (Constitution II: the lease lives in the existing per-server intent file; no new store).

**Semantics** (the user's, verbatim): `rk cron mute <id> --for <dur>` mutes the entry until `now + dur`; expiry unmutes automatically with no further call — the evaluator treats an expired lease as unmuted. Plain `rk cron mute <id>` stays an indefinite mute. `--off` clears both.

**Write rules** (`store.go`): a new mutator, e.g. `SetMuteLease(dir, slug, id string, until int64) (bool, error)`, sets `muted_until = until` **and clears `muted`** (a lease is a bounded mute — the caller's intent is "until then", so an earlier indefinite mute does not outlive the lease). Plain `SetMuted(…, true)` sets `muted = true` **and clears `muted_until`** (indefinite wins). `SetMuted(…, false)` (the `--off` path and the HTTP `muted:false` body) clears both. Same atomic read-modify-write as today; a corrupt file refuses to mutate.

**Evaluator** (`evaluate.go`): a pure helper, e.g. `func (e Entry) EffectivelyMuted(now time.Time) bool { return e.Muted || (e.MutedUntil > 0 && now.Unix() < e.MutedUntil) }`, replaces the `if e.Muted` check. The `muted` diagnostic detail distinguishes the two: `entry is muted` vs `entry is muted until <RFC3339>`. An expired lease needs no write — it is simply false at the next evaluation (30s daemon cadence), and the stale `muted_until` value is scrubbed by whichever mutation next marshals the file.

**CLI** (`cron_mut.go`): `cronMuteCmd` gains `--for <dur>` (Go duration, must be positive; mutually exclusive with `--off` — usage error otherwise). Confirmation lines: `muted <id> until <RFC3339 local>` for a lease, `muted <id>` / `unmuted <id>` as today. Use line becomes `mute <id> [--for <dur>] [--off]`; Long explains the renewal pattern in one sentence ("an in-session loop that renews the lease each tick holds the entry back while it is alive; when the loop dies the lease lapses and the entry resumes on its own").

**Rationale for the shape** (carried from the discussion): the in-session operator loop renews the lease each tick ("I'm alive, hold off"); if the loop dies the lease lapses and the cron backstop resumes on its own. A plain mute would lose the backstop when the operator crashes after muting. The fab-kit side (skill issuing mute/unmute/renew) is OUT of scope here.

### 3. Drop the schedule `anchor` field

`kind: backoff` already says it: the ladder resets whenever the target shows genuine activity and continues otherwise. The anchor-join math (`JoinAnchor(facts.StateEpoch, OwnDeliveries(…))`) is keyed on the TARGET pane's idle epoch and never reads `Schedule.Anchor` (verified: the field's only readers are the API JSON echo in `api/cron.go:85,255` and the two writers in `cron_add.go:218` / `operator.go:312`).

- **Schema**: `Schedule.Anchor` is deleted; `anchor:` in an entry file is accepted and ignored on read (unknown key). Schema becomes `{kind: backoff, min, max}`. The `schema.go` doc comment and the spec's § Cron State example drop the field.
- **CLI**: `--backoff --min --max` unchanged. Help text for `--backoff` and the `add` Long stop saying "operator-idle anchored"; new wording: "a backoff ladder keyed on the target pane's idle epoch — resets on genuine activity, continues otherwise (60s→30m by default; refine with --min/--max)". The mode switch is the schedule kind itself (`every` is the non-backoff mode); no anchor flag exists or is added.
- **API**: `cronScheduleJSON.Anchor` is **dropped entirely** (chosen over "always empty" — a field that can only ever be empty is noise on the wire; see Assumptions #5). `POST /api/cron/create` bodies carrying `schedule.anchor` are accepted and ignored (unknown JSON field). Frontend `CronSchedule.anchor?` (`app/frontend/src/api/client.ts`) is removed.
- **Memory/spec**: the DD "Bare `--backoff` with operator-idle defaults" is superseded (hydrate rewrites it as "Bare `--backoff` with 60s→30m defaults; no anchor field").
- Rejected alternative: renaming the anchor to `target-idle` (the user preferred removing the field entirely).

### 4. Role targets accept any role

Resolution is already generic — find the window whose `@rk_win_role` equals the target role, then its agent pane via `ResolveAgentPane`; no carrier ⇒ unresolved. The only reason for the operator-only rule was that one role value exists today.

- `internal/cron/facts.go`: remove the `if e.Target.Role != RoleOperator { … "unknown role" … }` block; the carrier scan compares `windows[i].window.Role == e.Target.Role` (not the constant); diagnostics read `no window carries role <role>` / `role window %s: %v`.
- `cmd/rk/cron_add.go`: remove the `cronAddRole != cron.RoleOperator ⇒ usage error` check; `--role` help becomes `Target a server role (the @rk_win_role value, e.g. operator)`. Validate the value with the same name-shape rule tmux option values already pass through (`validate.ValidateName`-class: non-empty, no whitespace) before it reaches the file — Constitution I (a role string is a tmux target discriminator, not a shell argument, but it is user input in a file other verbs read).
- Auto-capture ladder generalizes with it: a caller window carrying ANY non-empty `@rk_win_role` ⇒ `target: {kind: role, role: <that value>}` (today: only when the value is `operator`); the session → pane rungs are unchanged.
- `schema.go`: `RoleOperator` stays only where a literal is still needed (the `rk operator` seed in § 6); the comment "the only role target currently defined" is rewritten.
- `validate()` already requires a non-empty role for role targets — unchanged.

### 5. Caller-supplied respawn — `respawn: [argv...]`

**Schema**: `Entry` gains `Respawn []string \`yaml:"respawn,omitempty"\``. Used only when `if_absent: respawn`. `validate()` rejects a present-but-empty argv (`respawn needs at least one element`) and an empty `argv[0]`.

**Execution** (daemon, inside `tickServer`'s absent-fire disposition switch): the daemon runs the argv via `exec.CommandContext` with a timeout — **NEVER a shell string** (Constitution I). A `{server}` placeholder in any argv element is substituted (exact substring, `strings.ReplaceAll`) with the entry's stamped tmux server name (`fire.Server`), so the file reads plainly:

```yaml
respawn: ["rk", "operator", "-L", "{server}"]
```

Runtime details (designer's choices, graded in Assumptions #10): timeout **90s** (the `cronSessionSpawnTimeout` precedent; it must exceed `rk operator`'s own kickoff delivery bound of `operatorDeliverDeadline` 25s + `operatorCmdTimeout` 10s plus agent boot); environment = the daemon's process env (already `TMUX`/`TMUX_PANE`-scrubbed by `internal/tmux`'s init — the spec's env-discipline guard); working directory = the user's home directory (the neutral default the retired role respawner used — the daemon has no project cwd); stdout+stderr captured and the tail (≤ 200 bytes) folded into the failure detail.

**Outcomes** (as today): exit 0 within the timeout ⇒ `respawned`; non-zero exit, timeout, or exec error ⇒ `respawn-failed: <detail>`. **After a successful respawn there is NO delivery that tick**; the payload lands on the next resolved fire (today's behavior — a fresh session has no context for a bare payload). Both outcomes append one log line and advance the anchor; the absent-fire rate cap applies as before (entry-ID keyed). The respawn command is responsible for its own idempotency (the retired respawner's "defensive re-probe" is not re-implemented generically — `rk operator` is already a per-server singleton, § 5a).

**Seam**: `Deps.Respawner func(ctx, Fire) Outcome` and the production `rkCronRespawnRole` are **deleted**. In their place an exec seam, e.g. `Deps.RunRespawn func(ctx context.Context, argv []string, dir string) ([]byte, error)`, with a production default wrapping `exec.CommandContext`; tests inject a fake. `Deps.SessionRespawner` stays.

**Disposition switch** (`tick.go`), for an absent fire with `if_absent: respawn`:

| Target kind | `respawn` argv present | Disposition |
|---|---|---|
| role / session | yes | run argv → `respawned` / `respawn-failed: <detail>` |
| session | no | `SessionRespawner` (closed-ring plain resume, unchanged) — the default |
| role | no | notify-degrade with a diagnostic (`respawn-uncommanded`: "if_absent respawn has no respawn command; degraded to notify") — today's `respawn-unimplemented` path, renamed |
| pane | any | notify-degrade as today (a dead pane id never re-resolves, so a respawn can never land its payload) |

**Delete the built-in role respawner**: `cmd/rk/cron_respawn.go` and `cron_respawn_test.go` go (window-create + `/fab-operator` kickoff-prompt path, `cronRespawn*` seams, `cronRespawnEscalate`, `cronRespawnOperatorWindow`) — that was the last fab knowledge inside cron. `createMarkedOperatorWindow` stays (it is `rk operator`'s own create-and-mark half); its comment stops naming the cron respawner. `serve.go` stops wiring `Respawner: rkCronRespawnRole`. **Keep the session-resume respawner** (`cron_respawn_session.go`, closed-ring plain resume) as the default when a session-target entry has `if_absent: respawn` and no `respawn` command; a `respawn` command overrides it.

**CLI** (`cron_add.go`): `--respawn <arg>` — **repeatable** (pflag `StringArrayVar`), one argv element per occurrence, passed exactly as typed (no splitting, no quoting rules — Assumptions #9):

```
rk cron add "operator tick" --backoff --role operator --if-absent respawn \
  --respawn rk --respawn operator --respawn -L --respawn '{server}'
```

`--respawn` without `--if-absent respawn` is a usage error. `--if-absent respawn` without `--respawn` is a usage error for `--role`/`--pane` targets (no default exists for them) and allowed for `--session` targets (the resume default). The Long help documents `{server}`.

**API** (`api/cron.go`): `cronEntryJSON` gains `Respawn []string \`json:"respawn,omitempty"\``; the `POST /api/cron/create` body accepts `respawn` with the same validation as the CLI. **Trust note (for the spec, one sentence)**: entries can be created over the localhost HTTP API, so the API can now make the daemon exec a command; it could already type arbitrary text into an agent's chat (command execution by proxy), so the trust boundary does not move.

#### 5a. `rk operator -L <server>` — the seeded argv presupposes it

`rk operator` today hard-requires `$TMUX` (exit 1 outside tmux), derives its server from the original `$TMUX` socket, and runs `switch-client` on the singleton hit. The daemon has no `$TMUX` and no client, so `["rk","operator","-L","{server}"]` cannot work as-is. This change adds `-L/--server <name>` to `rk operator` (`cmd/rk/operator.go`): when set, the inside-tmux precondition is waived, every tmux call is addressed at `-L <name>` (the `tmuxSocketArgs`/`cronRespawnPrefix` shape — bare for `default`), the singleton hit returns success **without** `switch-client` (no client to switch), the created window opens in the user's home directory (the retired respawner's default; inside tmux the cwd rule is unchanged), and the seed (§ 6) uses the flag's server as its slug. The fab-on-PATH precondition stays hard. Inside tmux without `-L`, behavior is byte-identical to today. (Assumptions #12.)

### 6. `rk operator` seeds the new entry shape

`operatorTickEntrySpec()` (`cmd/rk/operator.go`) becomes:

```go
cron.Entry{
    Name:     "operator tick",
    Schedule: cron.Schedule{Kind: cron.ScheduleBackoff,
                            Min: cron.Duration{Duration: 60 * time.Second},
                            Max: cron.Duration{Duration: 30 * time.Minute}},
    WakeOn:   &cron.WakeOn{Event: cron.WakeAgentStateChange, Scope: cron.WakeScopeServer,
                            Debounce: cron.Duration{Duration: 10 * time.Second}},
    Target:   cron.Target{Kind: cron.TargetRole, Role: cron.RoleOperator},
    Payload:  "operator tick",
    Deliver:  cron.DeliverImmediate,
    IfAbsent: cron.IfAbsentRespawn,
    Respawn:  []string{"rk", "operator", "-L", "{server}"},
    Pinned:   true,
    CreatedBy: /* unchanged auto-capture */,
}
```

— NO `suppress_while`, NO `anchor`.

**Existing seeded entries on disk keep loading** (tolerant read: both retired keys are ignored). **`EnsureRoleEntry` upgrades an existing hit narrowly** (Assumptions #13): when the matched role entry has `if_absent: respawn` and an empty `respawn`, it fills `respawn` from the spec and rewrites the file (the marshal drops the retired keys as a side effect); it never touches any other field (min/max/muted/pinned/name — the user's tuning stays, per the existing DD "role-target presence as the seed idempotency key"). Without this, every already-seeded server would silently lose its backstop respawn the moment the built-in role respawner is deleted. Return value gains nothing new (`created=false` on an upgrade; a `rk operator` stderr note "upgraded operator tick respawn command" is acceptable but optional).

### 7. Fab operator state file path — DISPLAY only, fab's slug rule

Keep `FabOperatorStatePath` for the sessions watchlist join (◉ marks, `operatorStale`, `⚠ operator stale`) but derive the file name the way fab does.

- **`tmux.SocketPath(ctx, server string) (string, error)`** (`internal/tmux/`): queries `#{socket_path}` via `display-message -p '#{socket_path}'` addressed at the server (`tmuxExecRawServer` — argv slice, bounded context). Returns the trimmed path; any error propagates.
- **`cron.FabOperatorSlug(socketPath string) string`** (pure, table-tested): mirrors fab's slugify exactly — **escape `-` → `--` first, strip the leading `/`, replace `/` → `-`, empty ⇒ `default`**. Example: `/tmp/tmux-1001/runKit` → `tmp-tmux--1001-runKit`.
- **`FabOperatorStatePath(fabSlug)`** validates path-safety by construction (non-empty, no `/` or NUL — every `/` was replaced, so traversal is impossible) instead of `ValidSlug`'s socket-name alphabet (a socket path may legally contain `.`).
- **`sessions.go` join**: `sock, err := tmux.SocketPath(ctx, server); slug := "default" if err != nil else cron.FabOperatorSlug(sock)` → `cron.ReadWatchlist(cron.FabOperatorStatePath(slug))`. `default` as the fallback matches fab. `FetchSessions` only runs against live servers, so the query never touches a dead socket (the live-server rule). One extra bounded subprocess per fetch; if a per-fetch `list-*` format already exists where `#{socket_path}` can ride along, the plan may piggyback instead of a separate call — same helper contract either way.
- **Pin the naming rule in `docs/specs/cron.md`** as an explicit cross-repo contract: fab-kit owns the file; rk mirrors the slug (the rule spelled out, with the example).

### 8. Surface state in the API, the CLOCK row, and `rk cron list`

- **`GET /api/cron`** entries carry `muted` (bool, omitempty) and `mutedUntil` (unix seconds, omitempty). `muted` reports the **effective** state — stored flag OR unexpired lease as of the request — so every existing consumer (mobile Activity feed dimming, entry detail sheet, palette) stays correct without change; `mutedUntil` is the additive lease fact (Assumptions #3).
- **`POST /api/cron/mute`** body stays `{id, muted}`; `muted:false` clears both flag and lease; `muted:true` sets the indefinite flag. Lease writes are CLI-only in this change (the operator skill's renewal path is the CLI). The route keeps waking the SSE hub (`s.sseHub.wake(server)`) exactly like the existing mutations; the new lease mutator is reached only from the CLI, which (as today for every `rk cron` verb) cannot wake the hub — the panel catches up on the next sessions-slice broadcast.
- **CLOCK row** (`app/frontend/src/components/sidebar/clock-panel.tsx`): the badge becomes `muted <remaining>` when `mutedUntil` is present and still in the future as of the fetch (e.g. `muted 4m`, via the existing `formatDuration`), `muted` for an indefinite mute, `orphaned` precedence unchanged; dimming/strike-through keyed on the effective `muted`. The panel keeps its no-clock contract (remaining is as-of-fetch, exactly like `in Ns`). A held-back entry is thus never again a row silently pinned at `in 0s`. `CronEntry` in `client.ts` gains `mutedUntil?: number`; `CronSchedule.anchor?` is removed. Vitest (`clock-panel.test.tsx`): leased badge text, indefinite badge, expired-lease-as-of-fetch renders no badge, flyout Unmute posts `muted:false` for a leased entry.
- **`rk cron list`**: the FLAGS column renders `muted(4m)` for a lease (`muted` indefinite, `pinned` as today, comma-joined); `--json` gains `mutedUntil` and reports effective `muted`.

### 9. `rk cron add` help clarification

State plainly in the `add` Long help — and in the `cron` parent Long, which repeats the "payload plus a schedule" phrasing — that **the payload is TEXT TYPED INTO THE TARGET AGENT'S CHAT AS A PROMPT (via the injection engine, submitted with Enter) — it is NOT a shell command and is never executed.** One or two sentences, e.g.: "The payload is prompt text: at fire time rk types it into the target agent's chat and presses Enter, exactly as if you had typed it. It is never run as a command — to run a command, ask the agent to run it." An agent reading the help cold assumed command semantics ("does it write `rk mux send <pane>` into the payload?"). CLI surface changes are checked against `shll standards` per Constitution § Toolkit Standards.

### 10. Docs

- `docs/specs/cron.md`: remove `suppress_while` and `anchor` from the § Cron State operator-tick example and from § Schedules; drop the `operator-loop-fresh`/`nothing-tracked` prose and the "Watchlist" paragraph's guard mention; add the mute lease (§ Cron State + § API & CLI: `rk cron mute <id> [--for <dur>] [--off]`), the `respawn` argv + `{server}` (§ Targets `if_absent` ladder — role respawn = the entry's command; session default = resume), any-role targets (§ Targets table: "any `@rk_win_role` value"), the fab-file slug contract (§ Watchlist), the trust note (§ API & CLI), and rewrite P1.5/P3's dual-clock language to the lease arbitration.
- `docs/memory/run-kit/cron.md`: post-implementation truth via hydrate (CLI table, schema, seeding, evaluator, respawn sections, DDs).
- `docs/specs/glossary.md`: **does not exist** (the memory index's link is dangling); no glossary edit in this change.
- `docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation: the watchlist paragraph names `cron.ReadWatchlist(cron.FabOperatorStatePath(server))` — update to the `SocketPath` → `FabOperatorSlug` derivation.

### Out of scope (explicit)

- fab-kit changes: the operator skill issuing `rk cron mute --for` renewals each tick, a plain mute when stopping with nothing tracked, and `mute --off` on enroll. A follow-up intake will be drafted in the fab-kit repo after this change.
- Interim behavior is accepted knowingly: until the fab-kit side ships, the idle operator is ticked every backoff step with nothing suppressing it (loud but safe; the user can mute by hand: `rk cron mute 9de2` / `rk cron mute 9de2 --off`).
- Any per-role launch registry beyond the per-entry `respawn` argv.
- Lease writes over HTTP (`POST /api/cron/mute` with a duration) — not requested; CLI-only this change.
- Mobile Activity feed / entry detail sheet code — they read the effective `muted` and need no change.

## Affected Memory

- `run-kit/cron`: (modify) guards removed; `Evaluate`/`Deps` signatures; mute lease (`muted_until`, effective-muted rule, write rules, CLI `--for`); schema without `anchor`; any-role targets; `respawn` argv + `{server}` + exec seam + disposition table; role respawner deleted, session default kept; `EnsureRoleEntry` narrow upgrade; `FabOperatorSlug` + `SocketPath` derivation and the cross-repo slug contract; API `mutedUntil`/`respawn`; help wording; superseded DDs (bare `--backoff` operator-idle defaults; role respawn delivers the kickoff; per-kind respawner seams → exec seam + session seam)
- `run-kit/tmux-sessions`: (modify) § Fab-Tier Derivation watchlist paragraph — file name derived via `tmux.SocketPath` + fab's slugify; the `SocketPath` helper in the `internal/tmux` inventory
- `run-kit/rk-riff`: (modify) `rk operator` gains `-L/--server` (daemon-invocable: no `$TMUX` requirement, no `switch-client`, home-dir window)
- `run-kit/ui/sidebar`: (modify) `clock-panel.tsx` badge shows the lease remaining (`muted 4m`); `CronEntry.mutedUntil`; `CronSchedule.anchor` removed
- `run-kit/api-and-sockets`: (modify) `GET /api/cron` entry fields (`mutedUntil`, `respawn`, effective `muted`, `schedule.anchor` dropped); `POST /api/cron/create` accepts `respawn`
- `run-kit/ui/cron-activity`: (modify, doc-only) the feed's muted dimming now reads the effective `muted` (lease included); no code change expected

## Impact

**Backend (`app/backend/`)**
- `internal/cron/guards.go`, `guards_test.go` — deleted
- `internal/cron/schema.go` (+test) — `MutedUntil`, `Respawn`, `Schedule.Anchor` removed, `SuppressWhile` removed, guard constants removed, `validate()` additions, `EffectivelyMuted`
- `internal/cron/evaluate.go` (+test) — `EvalInput` without operator state; lease check; guard loop removed
- `internal/cron/tick.go` (+test) — `Deps` without `Respawner`/`OperatorStatePath`/`FreshThreshold`; `RunRespawn` exec seam; disposition table; `{server}` substitution
- `internal/cron/facts.go` (+test) — any-role carrier scan
- `internal/cron/store.go` (+test) — `SetMuteLease`, `SetMuted` clearing rules, `EnsureRoleEntry` narrow upgrade
- `internal/cron/dir.go` (+test) — `FabOperatorSlug`, `FabOperatorStatePath` path-safety rule
- `internal/cron/derive.go`, `watchlist.go` — comment updates only
- `internal/tmux/` (+test) — `SocketPath`
- `internal/sessions/sessions.go` (+test) — watchlist join derivation
- `cmd/rk/cron_respawn.go`, `cron_respawn_test.go` — deleted
- `cmd/rk/cron_add.go` (+test) — `--respawn`, `--role` any value, backoff without anchor, help text, usage-error matrix
- `cmd/rk/cron_mut.go` (+test) — `--for`
- `cmd/rk/cron_list.go` (+test) — FLAGS lease rendering, `--json` `mutedUntil`
- `cmd/rk/cron.go` — parent Long help
- `cmd/rk/operator.go` (+test) — seed spec, `-L/--server`
- `cmd/rk/serve.go` — respawner wiring
- `api/cron.go` (+test) — `mutedUntil`, `respawn`, effective `muted`, `anchor` dropped

**Frontend (`app/frontend/src/`)**
- `components/sidebar/clock-panel.tsx` + `clock-panel.test.tsx` — lease badge
- `api/client.ts` — `CronEntry.mutedUntil`, `CronSchedule.anchor` removed

**Docs**: `docs/specs/cron.md`; memory via hydrate (§ Affected Memory).

**Verification**: `just _ensure-tmux-conf` then `just test-backend` (scope first: `internal/cron`, `internal/tmux`, `internal/sessions`, `cmd/rk`, `api`), `just test-frontend`; no Playwright `test()` is expected to change — if one is touched, its Proves/Steps intent comment is updated in the same commit. CLI help changes checked against `shll standards`. Then the code-quality gate sequence (`tsc --noEmit`, `just build`).

**Risk notes**: (a) deleting the built-in role respawner without § 6's narrow upgrade would silently downgrade every already-seeded server to notify — the upgrade is load-bearing; (b) `rk operator -L` is new daemon-invocable surface — its no-`$TMUX` path must never `switch-client`; (c) the `{server}` substitution and the argv exec are the only new subprocess surface — argv slice + timeout, reviewed as must-fix security scope.

## Open Questions

- None left blocking. Worth a `/fab-clarify` glance: #9 (repeatable `--respawn` vs a single split string), #12 (`rk operator -L` scope addition), #13 (`EnsureRoleEntry` narrow upgrade), #16 (no HTTP lease write this change).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete both `suppress_while` guards, `guards.go`, and the `OperatorState`/`FreshThreshold` inputs to `Evaluate`/`Deps`; `suppress_while` accepted and ignored on read | Discussed — the user's design decision (rk must not parse fab's state file for control) | S:95 R:70 A:90 D:95 |
| 2 | Certain | Mute lease: `rk cron mute <id> --for <dur>` mutes until now+dur, expiry unmutes with no further call, plain `mute` stays indefinite, `--off` clears both | Discussed — verbatim semantics; rationale: a plain mute loses the backstop when the operator crashes after muting | S:95 R:80 A:90 D:90 |
| 3 | Confident | Field is `muted_until` (unix seconds); `--for` clears the indefinite flag, plain `mute` clears the lease; evaluator, API `muted`, and `list --json` report the effective state (flag OR unexpired lease) with `mutedUntil` additive | Description gives `muted_until` as the example; effective `muted` keeps every existing consumer (mobile feed, sheet, palette) correct with no change. Rejected: `muted` = stored flag only (every consumer would need the lease rule) | S:70 R:85 A:80 D:70 |
| 4 | Certain | Drop `schedule.anchor`: schema `{kind: backoff, min, max}`, `anchor` ignored on read, `operator-idle` removed from schema/help/API, `--backoff --min --max` unchanged, kind is the mode switch | Discussed — user chose removal over renaming to `target-idle`; the anchor-join math never reads the field (verified) | S:95 R:75 A:90 D:95 |
| 5 | Confident | `cronScheduleJSON.Anchor` dropped entirely (not always-empty); TS `CronSchedule.anchor?` removed | Description leaves the choice open; a field that can only be empty is wire noise; no frontend reader uses it | S:60 R:90 A:85 D:75 |
| 6 | Certain | Role targets accept any `@rk_win_role` value: remove the facts.go `Role != operator` check and the `cron_add.go` `--role` validation; auto-capture uses the caller window's role value as-is | Discussed — resolution is already generic; the operator-only rule existed because one role value exists today | S:90 R:80 A:90 D:90 |
| 7 | Certain | Per-entry `respawn: [argv...]` used only with `if_absent: respawn`; `exec.CommandContext` + timeout, never a shell string; `{server}` substituted with the stamped server name; no delivery on the respawn tick; `respawned`/`respawn-failed: <detail>` outcomes; rate cap as before; built-in role respawner + `Respawner` seam deleted | Discussed — verbatim; Constitution I | S:95 R:65 A:90 D:90 |
| 8 | Confident | Session-resume respawner stays the default for session targets with `if_absent: respawn` and no `respawn`; a `respawn` command overrides it | The user was told this judgment call and did not object; recorded as an assumption per the description | S:75 R:75 A:75 D:70 |
| 9 | Confident | `rk cron add --respawn <arg>` is repeatable (pflag StringArray), one argv element per occurrence, no splitting | Designer's choice per the description; elements pass exactly as typed (a path with spaces survives; no mini-parser). Rejected: a single string split on whitespace (cannot express spaces; its own quoting rules); a trailing `-- argv…` grammar (changes the verb's positional contract) | S:55 R:85 A:75 D:60 |
| 10 | Confident | Respawn exec runtime: 90s timeout, daemon's TMUX-scrubbed env, home-dir cwd, output tail folded into the failure detail | `cronSessionSpawnTimeout` (90s) precedent; must exceed `rk operator`'s 25s+10s kickoff bound plus boot; the retired respawner's home-dir default | S:45 R:90 A:80 D:70 |
| 11 | Confident | `--if-absent respawn` without `--respawn` is a usage error for role/pane targets, allowed for session targets; on-disk role entries in that state degrade to notify with a `respawn-uncommanded` diagnostic; pane targets never respawn even with an argv | A dead pane id never re-resolves, so a respawn can never land its payload; the notify-degrade path already exists and is renamed, not rebuilt | S:50 R:85 A:75 D:65 |
| 12 | Confident | `rk operator` gains `-L/--server <name>`: waives the inside-tmux precondition, addresses tmux at `-L <name>`, skips `switch-client` on a singleton hit, opens the window in the home dir; unchanged inside tmux without the flag | The user's verbatim seeded argv `rk operator -L {server}` presupposes the flag, which does not exist today (hard `$TMUX` requirement, `switch-client` on hit). `createMarkedOperatorWindow` is already env/prefix-parametrized for the daemon case | S:70 R:70 A:75 D:75 |
| 13 | Confident | `EnsureRoleEntry` upgrades an existing role hit narrowly: fill an empty `respawn` from the spec when `if_absent: respawn`, rewrite (dropping retired keys), touch nothing else | Description asks for a decision; without it every already-seeded server silently loses its backstop respawn when the built-in respawner is deleted. Rejected: no upgrade (loses the backstop); full overwrite (clobbers user tuning — contradicts the existing "seed never reconciles" DD) | S:50 R:80 A:65 D:60 |
| 14 | Certain | Fab operator state file path is fixed for DISPLAY only: `tmux.SocketPath` (`display-message -p '#{socket_path}'`, argv, timeout) + fab's slugify (`-`→`--` first, strip leading `/`, `/`→`-`, empty ⇒ `default`), `default` on query failure; pinned in `docs/specs/cron.md` as a cross-repo contract | Discussed — verbatim rule and fallback | S:95 R:80 A:90 D:90 |
| 15 | Confident | Split the derivation into `tmux.SocketPath` (query) + pure `cron.FabOperatorSlug` (table-tested); `FabOperatorStatePath` validates path-safety by construction (no `/` survives) rather than `ValidSlug`'s socket-name alphabet | A socket path may legally contain `.`; every `/` is replaced so traversal is impossible; a pure slugify is the testable half | S:55 R:85 A:80 D:70 |
| 16 | Confident | `POST /api/cron/mute` body unchanged (`{id, muted}`); `muted:false` clears flag and lease; lease writes are CLI-only in this change | Not requested; the operator skill's renewal path is the CLI; reversible additive API later | S:45 R:90 A:70 D:60 |
| 17 | Confident | CLOCK badge `muted <remaining>` (as-of-fetch, `formatDuration`) for a lease, `muted` indefinite, `orphaned` precedence unchanged, no clock added to the panel; `rk cron list` FLAGS `muted(4m)`, `--json` `mutedUntil` | Description's `muted 4m` example; the panel's render-performance no-clock contract | S:65 R:90 A:80 D:75 |
| 18 | Certain | Help text in `add` Long and the `cron` parent Long: the payload is prompt text typed into the target agent's chat and submitted with Enter via the injection engine — never a shell command, never executed | Discussed — verbatim intent; the parent Long repeats the "payload plus a schedule" phrasing | S:95 R:95 A:95 D:95 |
| 19 | Certain | Out of scope: fab-kit skill changes (lease renewals / plain mute / `--off` on enroll); interim loud-but-safe ticking accepted knowingly; no per-role launch registry | Discussed — stated explicitly | S:95 R:90 A:90 D:95 |
| 20 | Certain | No `docs/specs/glossary.md` edit — the file does not exist (dangling memory-index link); `tmux-sessions.md` § Fab-Tier Derivation pointer updated | Verified by `find docs -iname 'glossary*'` | S:70 R:95 A:90 D:85 |
| 21 | Confident | Lease expiry needs no SSE wake or file write: the evaluator reads the expired lease as unmuted on its next 30s tick; the UI catches up on the next sessions-slice broadcast | Constitution II (no runtime state written); the panel's badge is as-of-fetch like `in Ns` | S:50 R:85 A:75 D:65 |
| 22 | Certain | `change_type` = `feat` | New capabilities (lease, argv respawn, any-role targets) dominate; the path fix is one of ten items | S:80 R:95 A:90 D:85 |

22 assumptions (10 certain, 12 confident, 0 tentative, 0 unresolved).
