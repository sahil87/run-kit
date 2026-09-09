# Plan: Cron Decoupling — Mute Lease, Generic Roles, Caller-Supplied Respawn

**Change**: 260909-upt2-cron-decoupling-mute-lease
**Intake**: `intake.md`

## Requirements

### Cron: Guards removed (control read of fab's state file)

#### R1: No `suppress_while` evaluation; fab's operator state file is never read for control
`internal/cron` SHALL NOT read the fab operator state file to decide whether a fire is emitted. `guards.go`/`guards_test.go`, the `OperatorState`/`ParseOperatorState`/`ReadOperatorState`/`guardHolds` symbols, `DefaultOperatorLoopFreshThreshold`, and the `GuardOperatorLoopFresh`/`GuardNothingTracked` constants SHALL be deleted. `EvalInput` SHALL lose `Operator` and `FreshThreshold`; `Deps` SHALL lose `OperatorStatePath` and `FreshThreshold`; `Entry` SHALL lose `SuppressWhile`. `Evaluate`'s composition order becomes: muted (incl. lease, R2) → schedule/wake due math → target resolution → emit. A `suppress_while:` key in an existing entry file MUST load with no diagnostic (yaml.v3 ignores unknown keys) and MUST NOT be rewritten on read.

- **GIVEN** an entry file whose only entry carries `suppress_while: [operator-loop-fresh, nothing-tracked]` and a due schedule, with NO fab operator state file anywhere
- **WHEN** a tick evaluates it
- **THEN** the fire is emitted (no `suppressed` diagnostic exists any more) and `LoadEntries` reports zero diagnostics
- **AND** the entry file bytes are unchanged after the tick

### Cron: Mute lease

#### R2: `muted_until` lease with effective-muted semantics
`Entry` SHALL gain `MutedUntil int64` (`yaml:"muted_until,omitempty"`, unix seconds). A pure method `Entry.EffectivelyMuted(now time.Time) bool` SHALL return `Muted || (MutedUntil > 0 && now.Unix() < MutedUntil)` and SHALL replace the bare `e.Muted` check in `Evaluate`. The `muted` diagnostic detail SHALL read `entry is muted` for the flag and `entry is muted until <RFC3339>` for a live lease. Lease expiry SHALL require no write and no wake: the next evaluation simply reads it as unmuted.

- **GIVEN** an entry with `muted_until = now+60s` and a due schedule
- **WHEN** evaluated at `now`
- **THEN** no fire is emitted and the diagnostic reads `muted — entry is muted until …`
- **AND GIVEN** the same entry evaluated at `now+61s`, **THEN** the fire is emitted and no file write occurred

#### R3: Mute write rules
`store.go` SHALL gain `SetMuteLease(dir, slug, id string, until int64) (bool, error)` which sets `muted_until = until` AND clears `muted`. `SetMuted(…, true)` SHALL set `muted` AND clear `muted_until`. `SetMuted(…, false)` SHALL clear both. All three use the existing atomic read-modify-write (`setFlag`/`saveEntries`); a corrupt file refuses to mutate.

- **GIVEN** an entry with `muted: true`
- **WHEN** `SetMuteLease(…, now+300)` runs
- **THEN** the file holds `muted_until: <now+300>` and no `muted:` key
- **AND GIVEN** `SetMuted(…, false)` next, **THEN** neither key remains

#### R4: `rk cron mute <id> [--for <dur>] [--off]`
`cronMuteCmd` SHALL gain `--for <dur>` (Go duration, MUST be positive; a usage error with `--off`). `--for` calls `SetMuteLease(now+dur)` and prints `muted <id> until <RFC3339, local>`; bare `mute` prints `muted <id>`; `--off` prints `unmuted <id>`. The Long help SHALL explain the renewal pattern in one sentence (an in-session loop that renews the lease each tick holds the entry back while alive; when the loop dies the lease lapses and the entry resumes on its own).

- **GIVEN** `rk cron mute a3f9 --for 5m`
- **WHEN** run
- **THEN** stdout is `muted a3f9 until <RFC3339>` and the file carries `muted_until`
- **AND GIVEN** `rk cron mute a3f9 --for 0s` or `--for 5m --off`, **THEN** a usage error (exit 2) and the file is untouched

### Cron: Schema simplification

#### R5: `schedule.anchor` removed
`Schedule.Anchor` SHALL be deleted from the schema; `anchor:` in an entry file is accepted and ignored on read. `cronScheduleJSON.Anchor` and the create body's `schedule.anchor` field SHALL be dropped (an `anchor` key in a POST body is ignored as an unknown JSON field). Frontend `CronSchedule.anchor?` SHALL be removed. `--backoff` help and the `add` Long SHALL stop saying "operator-idle anchored" and instead say: "a backoff ladder keyed on the target pane's idle epoch — resets on genuine activity, continues otherwise (60s→30m by default; refine with --min/--max)". The string `operator-idle` SHALL NOT appear anywhere under `app/`.

- **GIVEN** an on-disk entry `schedule: {kind: backoff, anchor: operator-idle, min: 1m0s, max: 30m0s}`
- **WHEN** loaded and evaluated
- **THEN** it loads with zero diagnostics and ladders exactly as before (`JoinAnchor` never read the field)
- **AND** `GET /api/cron` returns its schedule as `{kind, min, max}` with no `anchor` key

#### R6: Role targets accept any `@rk_win_role` value
`facts.go` SHALL resolve a role target by scanning for the window whose `Role` equals `e.Target.Role` (not the `RoleOperator` constant); the `unknown role` rejection is removed; diagnostics read `no window carries role <role>` / `role window %s: %v`. `cron_add.go` SHALL accept any `--role` value that is non-empty and contains no whitespace (usage error otherwise), with help `Target a server role (the @rk_win_role value, e.g. operator)`. The auto-capture ladder SHALL target `{kind: role, role: <value>}` whenever the caller window carries ANY non-empty role. `RoleOperator` stays only for the `rk operator` seed.

- **GIVEN** a window stamped `@rk_win_role=reviewer` and an entry `target: {kind: role, role: reviewer}`
- **WHEN** facts are gathered
- **THEN** the target resolves to that window's agent pane
- **AND GIVEN** `rk cron add x --every 1h --role reviewer`, **THEN** the entry persists with `role: reviewer`; `--role "a b"` is a usage error

### Cron: Caller-supplied respawn

#### R7: `respawn: [argv...]` executed as an argument slice
`Entry` SHALL gain `Respawn []string` (`yaml:"respawn,omitempty"`). `validate()` SHALL reject a present-but-empty slice (`respawn needs at least one element`) and an empty `argv[0]`. A new `internal/cron/respawn.go` SHALL provide `RespawnArgv(e Entry, server string) []string` (pure: `strings.ReplaceAll(elem, "{server}", server)` on every element) and the exec seam `Deps.RunRespawn func(ctx context.Context, argv []string, dir string) ([]byte, error)` whose production default runs `exec.CommandContext(ctx, argv[0], argv[1:]...)` with `Dir = dir` and combined output — NEVER a shell string (Constitution I). The tick SHALL run it with a `DefaultRespawnTimeout` (named constant, 90s) derived context, `dir` = `os.UserHomeDir()`, the daemon's own (TMUX-scrubbed) environment. Exit 0 ⇒ outcome `respawned`; non-zero, timeout, or exec error ⇒ `respawn-failed: <detail>` where detail includes the error and the output tail (≤ 200 bytes). No delivery happens on the respawn tick; both outcomes append one log line and count toward the absent-fire rate cap as today.

- **GIVEN** an absent role fire whose entry has `respawn: ["rk","operator","-L","{server}"]` on server `runKit`
- **WHEN** the tick disposes it with a fake `RunRespawn` recording argv
- **THEN** the fake receives `["rk","operator","-L","runKit"]`, the log line outcome is `respawned`, and no delivery is attempted
- **AND GIVEN** the fake returns exit status 1 with output `boom`, **THEN** the outcome is `respawn-failed: …boom…`

#### R8: Disposition table replaces the role respawner
For an absent fire with `if_absent: respawn` the tick SHALL dispose per: role or session target with `respawn` present ⇒ run argv (R7); session target without `respawn` ⇒ `SessionRespawner` (unchanged closed-ring resume; nil seam degrades to notify as today); role target without `respawn` ⇒ notify-degrade with diagnostic `respawn-uncommanded` ("if_absent respawn has no respawn command; degraded to notify"); pane target ⇒ notify-degrade as today. `Deps.Respawner` and `cmd/rk/cron_respawn.go` (+test) SHALL be deleted; `serve.go` SHALL stop wiring `Respawner`. `createMarkedOperatorWindow` stays as `rk operator`'s own helper; the `cronRespawnPrefix` helper it needs moves into `operator.go` (renamed, e.g. `operatorServerPrefix`).

- **GIVEN** a session-target entry with `if_absent: respawn` and no `respawn`
- **WHEN** its fire is absent
- **THEN** the `SessionRespawner` seam is called exactly as before this change
- **AND GIVEN** a role-target entry in the same state, **THEN** the outcome is `notified-absent` with a `respawn-uncommanded` diagnostic

#### R9: `rk cron add --respawn` (repeatable) and the API `respawn` field
`cron_add.go` SHALL gain `--respawn <arg>` as a repeatable `StringArrayVar` (one argv element per occurrence, passed exactly as typed). Usage errors: `--respawn` without `--if-absent respawn`; `--if-absent respawn` without `--respawn` when the resolved target is role or pane (allowed for session targets). The Long help SHALL document `{server}`. `api/cron.go` SHALL add `Respawn []string` (`json:"respawn,omitempty"`) to `cronEntryJSON` and accept `respawn` in the create body, validated by `cron.Add`; a role-target create with `ifAbsent: respawn` and no `respawn` is a 400.

- **GIVEN** `rk cron add "operator tick" --backoff --role operator --if-absent respawn --respawn rk --respawn operator --respawn -L --respawn '{server}'`
- **WHEN** run
- **THEN** the entry persists with `respawn: [rk, operator, -L, "{server}"]`
- **AND GIVEN** the same without any `--respawn`, **THEN** a usage error names the missing command; **AND GIVEN** `--session <ref> --if-absent respawn` without `--respawn`, **THEN** the add succeeds

#### R10: `rk operator -L/--server <name>` (daemon-invocable)
`operatorCmd` SHALL gain `-L/--server <name>`. When set: the inside-tmux precondition is waived; every tmux call is addressed with the `-L <name>` prefix (bare for `default`) and no restored `$TMUX`; a singleton hit returns success WITHOUT `switch-client` (stdout `Operator tab already present.`); the created window opens in `os.UserHomeDir()`; the seed slug is the flag value. The fab-on-PATH precondition stays hard. Without the flag, behavior is byte-identical to today.

- **GIVEN** `rk operator -L runKit` run with `$TMUX` unset and no operator window on `runKit`
- **WHEN** run (tmux seams faked)
- **THEN** `new-window` is invoked with a leading `-L runKit`, the role is stamped, the kickoff is delivered, and no `switch-client` call is recorded
- **AND GIVEN** an operator window already present, **THEN** exit 0 with `Operator tab already present.` and no `select-window`/`switch-client`

#### R11: Seed shape and narrow upgrade
`operatorTickEntrySpec()` SHALL produce `{kind: backoff, min 60s, max 30m}`, the existing `wake_on`, `target role:operator`, payload/name `operator tick`, `deliver immediate`, `if_absent respawn`, `respawn: ["rk","operator","-L","{server}"]`, `pinned` — with NO `suppress_while` and NO anchor. `EnsureRoleEntry` SHALL, on a role hit whose `IfAbsent == respawn` and `len(Respawn) == 0` while `len(spec.Respawn) > 0`, set `Respawn` from the spec and save (the marshal drops retired keys as a side effect), touching no other field; it returns `created=false`.

- **GIVEN** an on-disk seeded entry (old shape: anchor + suppress_while, `if_absent: respawn`, no `respawn`, user-tuned `max: 45m`, `muted: true`)
- **WHEN** `EnsureRoleEntry` runs with the new spec
- **THEN** the file holds `respawn: [rk, operator, -L, "{server}"]`, keeps `max: 45m0s` and `muted: true`, and no longer carries `anchor`/`suppress_while`
- **AND GIVEN** an entry that already has a `respawn`, **THEN** the file is byte-identical afterwards

### Cron: Fab operator state file (display only)

#### R12: Socket-path slug mirrors fab
`internal/tmux` SHALL gain `SocketPath(ctx, server string) (string, error)` querying `display-message -p '#{socket_path}'` through the package's server-addressed exec core (argv slice, bounded context). `internal/cron` SHALL gain the pure `FabOperatorSlug(socketPath string) string` mirroring fab's rule exactly: replace `-` with `--` FIRST, strip the leading `/`, replace every `/` with `-`, empty ⇒ `default`. `FabOperatorStatePath(fabSlug)` SHALL validate by construction (non-empty, no `/`, no NUL) instead of `ValidSlug`. `sessions.go` SHALL derive the file as `FabOperatorStatePath(FabOperatorSlug(SocketPath(server)))`, falling back to slug `default` when the query errors.

- **GIVEN** socket path `/tmp/tmux-1001/runKit`
- **WHEN** `FabOperatorSlug` runs
- **THEN** it returns `tmp-tmux--1001-runKit`; and `/tmp/tmux/1000/default` → `tmp-tmux-1000-default`; `""` → `default`
- **AND GIVEN** a fab state file at `fab/operator/tmp-tmux--1001-runKit.yaml` with a `monitored:` entry for pane `%5`, **WHEN** `FetchSessions` runs against `runKit`, **THEN** the window holding `%5` reports `monitored: true` and `operatorLastTickAt` is populated

### API, CLI list, and UI surfacing

#### R13: Effective `muted` + `mutedUntil` on the wire, in `rk cron list`, and in the CLOCK row
`GET /api/cron` entries SHALL report `muted` as the EFFECTIVE state (`EffectivelyMuted(s.now())`) and add `mutedUntil` (`json:"mutedUntil,omitempty"`). `POST /api/cron/mute` keeps `{id, muted}` (true ⇒ `SetMuted(true)`, false ⇒ `SetMuted(false)`, both clearing per R3) and keeps waking the SSE hub. `rk cron list` FLAGS SHALL render `muted(<remaining>)` for a live lease (e.g. `muted(4m)`), `muted` for the flag, `pinned` as today; `--json` SHALL report effective `muted` and add `muted_until` (snake_case, matching the record's existing keys). `clock-panel.tsx` SHALL render the badge `muted <remaining>` (via `formatDuration`, as-of-fetch) when `mutedUntil` is in the future, `muted` for an indefinite mute, `orphaned` taking precedence unchanged; dimming keys on the effective `muted`; the panel adds no clock. `CronEntry` in `client.ts` gains `mutedUntil?: number`.

- **GIVEN** an entry with `muted_until = now+240s`
- **WHEN** `GET /api/cron` is served
- **THEN** the entry has `muted: true` and `mutedUntil: <now+240>`; the CLOCK row shows badge `muted 4m` dimmed; `rk cron list` shows `muted(4m)`
- **AND GIVEN** `muted_until` in the past, **THEN** `muted: false`, no badge, no `muted(...)` flag

#### R14: Help text — the payload is a prompt, never a command
The `rk cron add` Long and the `cron` parent Long SHALL state, in one or two sentences, that the payload is prompt text: at fire time rk types it into the target agent's chat through the injection engine and presses Enter, exactly as if a person had typed it; it is never run as a command. The changed help SHALL be checked against `shll standards` (Constitution § Toolkit Standards).

- **GIVEN** `rk cron add --help`
- **WHEN** read
- **THEN** it contains the prompt-not-command sentence, no `operator-idle`, and documents `--respawn`/`{server}`

### Docs

#### R15: Spec updated to the new contract
`docs/specs/cron.md` SHALL: drop `suppress_while` and `anchor` from § Cron State's example and § Schedules; remove the `operator-loop-fresh`/`nothing-tracked` prose (incl. § Watchlist's guard sentence and P1.5/P3's dual-clock language, rewritten to the lease arbitration); add the mute lease to § Cron State and § API & CLI (`rk cron mute <id> [--for <dur>] [--off]`); rewrite the § Targets `if_absent: respawn` ladder as the entry's `respawn` argv with `{server}` (session default = resume) and the role row as "any `@rk_win_role` value"; pin the fab-file slug rule in § Watchlist as an explicit cross-repo contract (fab-kit owns the file, rk mirrors the slug; rule + example); add the one-sentence trust note to § API & CLI. `docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation's watchlist sentence SHALL name the `SocketPath` → `FabOperatorSlug` derivation. Memory otherwise updates at hydrate.

- **GIVEN** `docs/specs/cron.md` after the change
- **WHEN** grepped
- **THEN** `suppress_while`, `operator-idle`, `nothing-tracked`, and `operator-loop-fresh` do not appear; `muted_until`, `respawn:`, `{server}`, and `tmp-tmux--1001-runKit` do

### Non-Goals

- fab-kit changes (the operator skill's lease renewals, plain mute on stop, `--off` on enroll) — a follow-up intake in that repo.
- Lease writes over HTTP — `POST /api/cron/mute` keeps its `{id, muted}` body.
- A per-role launch registry — the per-entry `respawn` argv is the whole mechanism.
- Re-implementing the retired respawner's defensive re-probe generically — the command owns its idempotency (`rk operator` is already a singleton).
- Mobile Activity feed / entry detail sheet code — they read the effective `muted` and need no change.

### Design Decisions

#### The clock is told, never infers
**Decision**: Delete both `suppress_while` guards; the only suppression is the entry's own `muted`/`muted_until`, written through `rk cron` verbs.
**Why**: rk parsing fab's private state-file schema for control is a CLI-layering violation and produced two bugs (a path mismatch that muted every server forever, and `trackedLen` counting a finished autopilot as tracked). Inversion of control keeps fab's knowledge in fab.
**Rejected**: Fixing only the path — restores the flawed coupling; any future fab schema change becomes a latent cron regression.
*Introduced by*: 260909-upt2-cron-decoupling-mute-lease

#### Lease, not plain mute, for "my loop is alive"
**Decision**: `rk cron mute <id> --for <dur>` sets `muted_until`; expiry needs no write.
**Why**: A renewed lease lapses on its own when the in-session loop dies, so the backstop resumes; a plain mute would outlive a crashed operator.
**Rejected**: Plain mute + unmute on stop (loses the backstop on a crash); a heartbeat file (a new state store, Constitution II).
*Introduced by*: 260909-upt2-cron-decoupling-mute-lease

#### `kind: backoff` carries no anchor field
**Decision**: Remove `schedule.anchor`; the ladder is keyed on the target pane's idle epoch by definition.
**Why**: The anchor-join math never read the field; a field that names nothing invites operator-specific readings.
**Rejected**: Renaming to `target-idle` (still a field with one legal value).
*Introduced by*: 260909-upt2-cron-decoupling-mute-lease

#### Respawn is a caller-supplied argv with `{server}`
**Decision**: `respawn: [argv...]` run via `exec.CommandContext`; the seeded operator entry says `rk operator -L {server}`; the built-in role respawner is deleted; session-resume stays the no-command default for session targets.
**Why**: How to bring a target back is the creator's knowledge, not the clock's; the argv form keeps Constitution I (no shell strings) and lets any consumer respawn.
**Rejected**: A per-role launch registry (more machinery than one field); keeping the built-in operator respawner (fab knowledge inside cron); dropping the session-resume default (loses shipped behavior for no gain).
*Introduced by*: 260909-upt2-cron-decoupling-mute-lease

#### Fab state file read only for display, slug mirrored from fab
**Decision**: `FabOperatorStatePath` stays for the watchlist/staleness projection, deriving the file name via `tmux.SocketPath` + a pure `FabOperatorSlug` that copies fab's slugify; the rule is pinned in the spec as a cross-repo contract.
**Why**: The ◉ marks and stale warning are projection, not control; mirroring the slug is cheaper than a second file format and fixes the same-term-two-meanings bug at its source.
**Rejected**: Asking fab-kit to write server-name-keyed files (socket-path keying is deliberately collision-free across socket dirs).
*Introduced by*: 260909-upt2-cron-decoupling-mute-lease

### Deprecated Requirements

#### Guard truth table (`suppress_while`)
**Reason**: Control must not derive from fab's state file.
**Migration**: `muted`/`muted_until` via `rk cron mute [--for]`; fab-kit follow-up issues the calls.

#### Role-target respawn mechanics (built-in window-create + `/fab-operator` kickoff)
**Reason**: Fab knowledge inside cron.
**Migration**: The entry's `respawn` argv (`rk operator -L {server}` for the operator).

#### Bare `--backoff` with operator-idle defaults
**Reason**: The anchor field is removed.
**Migration**: Bare `--backoff` with 60s→30m defaults, no anchor.

## Tasks

### Phase 1: Setup

- [x] T001 `app/backend/internal/cron/schema.go` (+`schema_test.go`): delete `SuppressWhile`, `Schedule.Anchor`, the two guard constants; add `MutedUntil int64 \`yaml:"muted_until,omitempty"\`` and `Respawn []string \`yaml:"respawn,omitempty"\``; add `func (e Entry) EffectivelyMuted(now time.Time) bool`; extend `validate()` (present-but-empty `respawn`, empty `argv[0]`); rewrite the `RoleOperator` comment; tests: tolerant load of a file carrying `anchor:` and `suppress_while:` (zero diagnostics, bytes untouched), `EffectivelyMuted` table (flag / live lease / expired lease), respawn validation <!-- R1, R2, R5, R7 -->
- [x] T002 [P] `app/backend/internal/cron/dir.go` (+`dir_test.go`): add pure `FabOperatorSlug(socketPath string) string` (escape `-`→`--` first, strip leading `/`, `/`→`-`, empty ⇒ `default`); change `FabOperatorStatePath` to validate by construction (non-empty, no `/`, no NUL) instead of `ValidSlug`; table tests incl. `/tmp/tmux-1001/runKit` → `tmp-tmux--1001-runKit` and `/tmp/tmux/1000/default` → `tmp-tmux-1000-default` <!-- R12 -->
- [x] T003 [P] `app/backend/internal/tmux/` (+test, following the package's existing seam-based test idiom): add `SocketPath(ctx, server string) (string, error)` — `display-message -p '#{socket_path}'` through the server-addressed exec core (argv slice, bounded context), trimmed output <!-- R12 -->

### Phase 2: Core Implementation

- [x] T004 Delete `app/backend/internal/cron/guards.go` and `guards_test.go`; `evaluate.go` (+`evaluate_test.go`): remove `Operator`/`FreshThreshold` from `EvalInput` and the guard loop; replace `if e.Muted` with `EffectivelyMuted(in.Now)` and the two-form `muted` diagnostic detail; update/delete every test that constructed `OperatorState`, passed `Operator:`, or asserted `suppressed`/`unknown-guard`; add the lease tests (R2 scenarios) <!-- R1, R2 -->
- [x] T005 `app/backend/internal/cron/store.go` (+`store_test.go`): add `SetMuteLease` (sets `muted_until`, clears `muted`); make `SetMuted(true)` clear `muted_until` and `SetMuted(false)` clear both; `EnsureRoleEntry` narrow upgrade (role hit with `IfAbsent == respawn`, empty `Respawn`, non-empty `spec.Respawn` ⇒ set + save, nothing else touched, `created=false`); tests: the R3 write-rule matrix, the R11 upgrade scenario (old-shape file with anchor/suppress_while + user tuning ⇒ respawn filled, tuning kept, retired keys gone), no-op when `respawn` already present (byte-identical file) <!-- R3, R11 -->
- [x] T006 [P] `app/backend/internal/cron/facts.go` (+`facts_test.go`): drop the `Role != RoleOperator` rejection; scan `windows[i].window.Role == e.Target.Role`; diagnostics `no window carries role <role>` / `role window %s: %v`; test a non-operator role resolving and an unknown role reading unresolved <!-- R6 -->
- [x] T007 New `app/backend/internal/cron/respawn.go` (+`respawn_test.go`): `RespawnArgv(e Entry, server string) []string` (`{server}` substitution on every element, copy not mutate), `DefaultRespawnTimeout` (90s named constant), `Deps.RunRespawn` type + production default `runRespawnExec` (`exec.CommandContext(ctx, argv[0], argv[1:]...)`, `Dir`, `CombinedOutput`), `respawnDetail(err, output)` folding a ≤200-byte output tail; tests for substitution and detail folding (no live exec beyond a trivially safe `true`/`false` if the package's tests already exec; otherwise fake-only) <!-- R7 -->
- [x] T008 `app/backend/internal/cron/tick.go` (+`tick_test.go`): remove `Deps.Respawner`, `Deps.OperatorStatePath`, `Deps.FreshThreshold` and the `ReadOperatorState` call; add `Deps.RunRespawn` (nil ⇒ production default); implement the R8 disposition table in the absent-fire switch (argv present ⇒ run under `DefaultRespawnTimeout` with `os.UserHomeDir()` cwd ⇒ `respawned` / `respawn-failed: <detail>`; session without argv ⇒ `SessionRespawner`; role without argv ⇒ notify-degrade + `respawn-uncommanded` diagnostic; pane ⇒ notify-degrade); keep `respawnedThisTick`/rate-cap behavior; rewrite tests that used `Respawner` fakes to `RunRespawn` fakes and add the R7/R8 scenarios <!-- R7, R8 -->
- [x] T009 Delete `app/backend/cmd/rk/cron_respawn.go` and `cron_respawn_test.go`; move the server-prefix helper into `cmd/rk/operator.go` as `operatorServerPrefix(server string) []string` (bare for `""`/`default`, else `-L <server>`); `cmd/rk/serve.go`: drop `Respawner: rkCronRespawnRole` from the `cron.Deps` literal; fix any remaining references (`cron_respawn_session.go` comments, `createMarkedOperatorWindow`'s comment no longer naming the cron respawner); `go build ./...` clean <!-- R8 -->
- [x] T010 `app/backend/cmd/rk/operator.go` (+`operator_test.go`): add `-L/--server` flag (`operatorServerFlag`); when set: skip the `$TMUX` precondition, build `prefix := operatorServerPrefix(flag)` and pass `nil` env with prefixed args to every tmux call (list-windows probe, select-window skipped, NO `switch-client`; stdout `Operator tab already present.`), `windowDir = os.UserHomeDir()`, seed slug = flag value; without the flag behavior is unchanged; update `operatorTickEntrySpec()` to the R11 shape (no anchor, no `SuppressWhile`, `Respawn: []string{"rk","operator","-L","{server}"}`); tests: R10 scenarios (no `switch-client` recorded with `-L`; `-L` args prefixed; outside-tmux without `-L` still exit 1), seed-shape assertions updated <!-- R10, R11 -->
- [x] T011 `app/backend/cmd/rk/cron_add.go` (+`cron_add_test.go`): drop `Anchor: "operator-idle"`; `--backoff` help + Long wording per R5; `--role` accepts any non-empty whitespace-free value (help per R6), auto-capture ladder uses the caller window's role value as-is; add repeatable `--respawn` (`StringArrayVar`) with the R9 usage-error matrix (needs `--if-absent respawn`; role/pane targets with `--if-absent respawn` need `--respawn`; session targets may omit it); Long documents `{server}` and carries the R14 prompt-not-command sentence; tests for each matrix row and the help strings <!-- R5, R6, R9, R14 -->
- [x] T012 [P] `app/backend/cmd/rk/cron_mut.go` (+`cron_mut_test.go`): `--for <dur>` on `mute` (positive; usage error with `--off` or non-positive), `SetMuteLease(now+dur)` via a `cronNowFn`-style seam, confirmation `muted <id> until <RFC3339 local>`; Use line `mute <id> [--for <dur>] [--off]`; Long renewal sentence per R4; tests <!-- R4 -->
- [x] T013 [P] `app/backend/cmd/rk/cron_list.go` (+`cron_list_test.go`) and `cmd/rk/cron.go`: FLAGS renders `muted(<cronDurationShort remaining>)` for a live lease, `muted` for the flag; record `Muted` = effective, new `MutedUntil int64 \`json:"muted_until"\``; parent `cron` Long carries the R14 sentence; tests for both flag renderings and the JSON key <!-- R13, R14 -->
- [x] T014 `app/backend/api/cron.go` (+`cron_test.go`): drop `Anchor` from `cronScheduleJSON` and the create body; add `MutedUntil int64 \`json:"mutedUntil,omitempty"\`` and `Respawn []string \`json:"respawn,omitempty"\`` to `cronEntryJSON`; `Muted` = `e.EffectivelyMuted(now)`; create body accepts `respawn` (400 on `cron.Add` validation errors, incl. role + `ifAbsent: respawn` without `respawn` — enforce that rule in a shared `cron` helper the CLI also calls, or in `validate()` if the on-disk degrade in R8 is kept as load-tolerant: pick the former); tests: live lease ⇒ `muted: true` + `mutedUntil`; expired ⇒ `muted: false`, no key; no `anchor` on the wire; `respawn` round-trip; role-respawn-without-command ⇒ 400 <!-- R5, R9, R13 -->
- [x] T015 `app/backend/internal/sessions/sessions.go` (+test): derive the watchlist file as `cron.FabOperatorStatePath(cron.FabOperatorSlug(sock))` with `sock` from `tmux.SocketPath(ctx, server)` (slug `default` on error) through the package's existing tmux seam so the test can fake the socket path; test the R12 join scenario (file at the slugified name ⇒ `monitored: true` + `operatorLastTickAt`) <!-- R12 -->

### Phase 3: Integration & Edge Cases

- [x] T016 `app/frontend/src/api/client.ts`: remove `CronSchedule.anchor?`, add `CronEntry.mutedUntil?: number`; `app/frontend/src/components/sidebar/clock-panel.tsx` (+`clock-panel.test.tsx`): badge `muted <formatDuration(mutedUntil - now)>` when `mutedUntil` is in the future as of the fetch, `muted` for an indefinite mute, `orphaned` precedence unchanged, dimming on effective `muted`, no interval/clock added; tests: leased badge text, indefinite badge, expired-as-of-fetch renders no badge (server already reports `muted:false`), flyout Unmute posts `muted:false` for a leased entry; `npx tsc --noEmit` clean <!-- R13 -->
- [x] T017 Repo-wide sweep: `grep -rn 'operator-idle\|SuppressWhile\|suppress_while\|GuardNothingTracked\|GuardOperatorLoopFresh\|OperatorState\b\|rkCronRespawnRole\|cronRespawnPrefix\|Schedule.Anchor\|\.Anchor\b' app/` returns nothing under `app/` (docs excluded); `just _ensure-tmux-conf && just test-backend` and `just test-frontend` green <!-- R1, R5, R8 -->

### Phase 4: Polish

- [x] T018 [P] `docs/specs/cron.md`: apply R15 (Cron State example, Schedules, Targets table + `if_absent` ladder, Watchlist slug contract with the `/tmp/tmux-1001/runKit` → `tmp-tmux--1001-runKit` example, API & CLI mute lease + trust note, Phasing P1.5/P3 lease arbitration; remove every `suppress_while`/`operator-idle`/guard mention); `docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation: watchlist sentence names the `SocketPath` → `FabOperatorSlug` derivation <!-- R15 -->
- [x] T019 [P] Toolkit standards check: run `shll standards`, read the entries governing CLI help/surface, and confirm the changed `rk cron add`/`mute`/`list` and `rk operator` help conform (adjust wording if a standard requires) <!-- R14 -->
- [x] T020 Verification gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just build` <!-- R1 -->

## Execution Order

- T001 blocks T004, T005, T007, T008, T011, T014 (schema first)
- T002 and T003 block T015
- T007 blocks T008; T008 blocks T009; T009 blocks T010 (the prefix helper moves before `-L` lands)
- T016 needs T014's wire shape; T017 runs after every code task; T020 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `guards.go` is gone, `Evaluate`/`Deps` carry no operator-state inputs, and no code path reads the fab operator state file for control
- [x] A-002 R2: `EffectivelyMuted` gates evaluation; a live lease suppresses, an expired lease fires, with no write on expiry
- [x] A-003 R3: `SetMuteLease`/`SetMuted` implement the clearing matrix atomically
- [x] A-004 R4: `rk cron mute <id> --for <dur>` works with the documented confirmation and usage errors
- [x] A-005 R5: `schedule.anchor` is gone from schema, CLI, API, and frontend; old files load unchanged
- [x] A-006 R6: any `@rk_win_role` value resolves as a role target; `--role` accepts it; auto-capture generalizes
- [x] A-007 R7: `respawn` argv runs via `exec.CommandContext` with `{server}` substituted, 90s timeout, home cwd, no delivery that tick
- [x] A-008 R8: the disposition table is implemented; the built-in role respawner and `Deps.Respawner` are deleted; session-resume remains the session default
- [x] A-009 R9: `--respawn` is repeatable with the usage-error matrix; the API accepts and echoes `respawn`
- [x] A-010 R10: `rk operator -L <server>` runs from outside tmux, addresses `-L`, never `switch-client`s, opens in the home dir
- [x] A-011 R11: the seed has the new shape and `EnsureRoleEntry` fills only an empty `respawn` on existing hits
- [x] A-012 R12: `SocketPath` + `FabOperatorSlug` derive the fab file name and the sessions watchlist join finds the real file
- [x] A-013 R13: effective `muted` + `mutedUntil` on the API, `muted(<remaining>)` in `rk cron list`, `muted <remaining>` badge in the CLOCK row
- [x] A-014 R14: `add` and parent help state the payload is prompt text, never a command
- [x] A-015 R15: the spec and the tmux-sessions pointer reflect the new contract

### Behavioral Correctness

- [x] A-016 R1: an entry file carrying `suppress_while:` fires when due and is not rewritten by a tick
- [x] A-017 R11: an already-seeded server keeps its user tuning and gains the respawn argv on the next `rk operator`
- [x] A-018 R13: `POST /api/cron/mute {muted:false}` clears a lease as well as the flag

### Removal Verification

- [x] A-019 R1: no `OperatorState`, guard constants, or `suppressed`/`unknown-guard` diagnostics remain under `app/`
- [x] A-020 R5: `operator-idle` appears nowhere under `app/`
- [x] A-021 R8: `cron_respawn.go`/`cron_respawn_test.go` and `rkCronRespawnRole` are gone; `serve.go` wires no `Respawner`

### Scenario Coverage

- [x] A-022 R7: tests pin `{server}` substitution on every element and the `respawn-failed` detail folding
- [x] A-023 R10: tests record no `switch-client` under `-L` and a `-L`-prefixed `new-window`
- [x] A-024 R12: `FabOperatorSlug` table covers the `-`/`--` escape, leading-slash strip, and empty ⇒ `default`

### Edge Cases & Error Handling

- [x] A-025 R4: `--for 0s`, negative durations, and `--for` with `--off` are usage errors with the file untouched
- [x] A-026 R9: role/pane `--if-absent respawn` without `--respawn` is a usage error; session targets are allowed
- [x] A-027 R7: a respawn timeout or non-zero exit logs `respawn-failed: <detail>` and still advances the anchor / counts toward the rate cap
- [x] A-028 R12: a failing `SocketPath` query degrades to slug `default` with no error surfaced

### Code Quality

- [x] A-029 Pattern consistency: new code follows `internal/cron` idioms (named constants, seam-based tests, tolerant-load diagnostics, comments stating constraints not narration, no change-ids in comments)
- [x] A-030 No unnecessary duplication: the mute mutators share `setFlag`; the server-prefix helper exists once; `EffectivelyMuted` is the single muted rule used by evaluator, API, and CLI list
- [x] A-031 Tests accompany every behavior change (Go colocated `_test.go`; Vitest for `clock-panel`)
- [x] A-032 Constitution II holds: no new state files; the lease and respawn argv live in the intent file; expiry writes nothing
- [x] A-033 Anti-pattern check: no inline tmux command construction outside `internal/tmux/`; no `setInterval` polling added to the CLOCK panel

### Security

- [x] A-034 R7: the respawn argv is executed as an argument slice with a timeout — no shell, no string interpolation beyond the exact `{server}` substring; `{server}` is the stamped slug (already `ValidSlug`-gated)
- [x] A-035 R10: `rk operator -L` addresses tmux by `-L <name>` argv only; the launcher shell string is unchanged from today's one documented exception

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change deletes its own superseded surface in place (`guards.go`, `cron_respawn.go`, `Deps.Respawner`/`OperatorStatePath`/`FreshThreshold`, `Schedule.Anchor`, `Entry.SuppressWhile`, the guard constants); review found no newly-orphaned symbol the apply stage missed. `parseTickAt` moved from `guards.go` to `watchlist.go` with its one remaining caller.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The "role + `if_absent: respawn` requires `respawn`" rule is enforced at add time (CLI and API) via a shared cron-package helper, not in `validate()` | Existing on-disk entries in that state must keep loading (R8's notify-degrade); `validate()` runs on load too | S:60 R:85 A:80 D:75 |
| 2 | Confident | `rk cron list --json` uses `muted_until` (snake_case) | The record's existing keys are snake_case (`last_fired`, `orphaned_since`); the API stays camelCase | S:70 R:90 A:85 D:80 |
| 3 | Confident | `RunRespawn` exec uses `CombinedOutput` and folds a ≤200-byte tail into the failure detail | Bounded log lines; enough to see `rk operator`'s precondition message | S:55 R:90 A:80 D:70 |
| 4 | Confident | `rk operator -L` singleton hit prints `Operator tab already present.` (not "Switched to…") | No client is switched; the message must not lie | S:65 R:95 A:90 D:80 |
| 5 | Confident | `FabOperatorStatePath` path-safety is "non-empty, no `/`, no NUL" | Every `/` was replaced by the slugify, so traversal is structurally impossible; socket paths may contain `.` | S:60 R:85 A:80 D:70 |
| 6 | Certain | Verification gates follow `fab/project/code-quality.md` order | Config prescribes it | S:90 R:95 A:95 D:95 |
| 7 | Confident | `Deps.RunRespawn`'s type is the named `RunRespawnFunc` declared in respawn.go; the `Deps` struct itself stays in tick.go | Keeps the exec seam beside `RespawnArgv`/`runRespawnExec` | S:60 R:90 A:85 D:70 |
| 8 | Confident | `respawnDetail` formats `<err>: <tail>` with the tail cut at exactly 200 bytes (`…`-prefixed when truncated); a home-dir resolution failure logs `respawn-failed: resolving home dir: <err>` | Bounded log lines; no new diagnostic class needed | S:55 R:90 A:80 D:70 |
| 9 | Certain | The backoff ladder math keeps `Ladder.Anchor`/`JoinAnchor`/`everyAnchor`; only `Schedule.Anchor` was deleted, so T017's `\.Anchor\b` sweep hits only this retained math | The plan's DD pins the anchor-join math as never having read the deleted field; renaming a load-bearing domain term for grep cosmetics is churn without gain | S:85 R:80 A:85 D:85 |
| 10 | Confident | Tolerant-load fixtures use `anchor: idle` (not the retired `operator-idle` value) so R5's "nowhere under app/" holds literally | The retired KEYS (`anchor:`, `suppress_while:`) are what the fixtures must prove load tolerantly; the value is arbitrary | S:70 R:85 A:80 D:75 |
| 11 | Confident | The shared add-time respawn rule lives in `cron.ValidateRespawnIntent(e Entry) error` (store.go): `Add` calls it after `validate()` (API create gets its 400 for free) and `runCronAdd` wraps it as an exit-2 usage error | Plan Assumption #1's "former" option; one enforcement point shared by CLI and API | S:70 R:85 A:80 D:75 |
| 12 | Confident | `cronEntryToJSON` gained a `now time.Time` param; `mutedUntil` is emitted only while the lease is live (expired ⇒ key absent); `rk cron list --json`'s `muted_until` is likewise omitempty | An expired lease is already-unmuted truth — emitting a stale timestamp would invite client-side expiry logic the effective `muted` already settles | S:60 R:85 A:80 D:70 |
| 13 | Confident | `deliverAgentKickoff` takes the tmux server label directly (was: derived from a captured `$TMUX`); `tutorial.go` passes `cliServerLabel(...)` | The `-L` path has no `$TMUX` to derive from; the label is the honest input | S:50 R:85 A:75 D:65 |
| 14 | Confident | The respawn notify seam moved into `cron_respawn_session.go` as `cronSessionRespawnNotifyFn` (the session respawner's escalate path used it); `runCronAdd` normalizes pflag's post-reset non-nil empty `--respawn` slice to nil so `respawn:` stays omitted on disk | Both are mechanical consequences of deleting cron_respawn.go and of pflag `StringArrayVar` reset semantics tripping validate()'s present-but-empty rule | S:65 R:85 A:75 D:70 |
| 15 | Confident | `tmux.SocketPath` rides a `var socketPathQuery = tmuxExecRawServer` fn-var seam and is a separate bounded `display-message` call per fetch (not piggybacked) | `#{socket_path}` is server-scoped and does not ride any per-fetch `list-*` row shape the code already parses | S:60 R:90 A:80 D:70 |
| 16 | Confident | `internal/sessions` gained its first fn-var seam block (`listSessionsFn`/`listClientsFn`/`listWindowsFn`/`socketPathFn`) so `FetchSessions` is fakeable end-to-end; the R12 join test runs in-memory | The package had zero existing seams (verified by grep); one block in the repo's sweep-var idiom, not a parallel mechanism | S:55 R:80 A:75 D:65 |
| 17 | Confident | The CLOCK leased badge requires effective `muted === true` (server-resolved) — `mutedUntil` only upgrades badge text — and shares one `Date.now()` read per render with the `in Ns` label | Makes the expired-lease case render no badge with zero client-side expiry logic; mirrors the existing `in Ns` pattern exactly | S:65 R:90 A:80 D:75 |
| 18 | Confident | Spec edits: the catch-up policy's "guard-gated" became "mute-gated" (the only remaining fire-time suppression); "Union predicates and guards" heading singularized; `muted_until` shown as a commented optional field in the Cron State example | Guards are gone; the seed doesn't ship muted, so the lease field is illustrated as optional, not seeded | S:55 R:90 A:75 D:65 |

18 assumptions (2 certain, 16 confident, 0 tentative).
