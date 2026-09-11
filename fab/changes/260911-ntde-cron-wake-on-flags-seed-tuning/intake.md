# Intake: Cron wake_on CLI flags + interim operator-tick seed tuning

**Change**: 260911-ntde-cron-wake-on-flags-seed-tuning
**Created**: 2026-09-12

## Origin

One-shot `/fab-new ntde` from backlog row `[ntde]` (fab/backlog.md, dated 2026-09-12). No prior conversation on the topic in this session; the backlog row itself records a fab-kit discussion decision and is the full brief. Raw input:

> [fab-kit operator clock] Hand the operator-tick cron entry's ownership to fab; rk stays generic substrate. DECISION (fab-kit discussion 2026-09-12): fab already owns the entry's mute/unmute, schedule derive, and deliver edit (fab operator_clock.go reconcile); seeding is the last slice and lives in rk (app/backend/cmd/rk/operator.go seedOperatorTick + operatorTickEntrySpec). Split ownership means every policy change touches both repos. TWO STEPS, in order. STEP 1 (prerequisite, unblocks fab): expose wake_on on the CLI — add --wake-on <event> (today only agent-state-change), --wake-scope <server|...> (default server), --wake-debounce <dur> (default 60s) to rk cron add AND rk cron edit (edit: replace-field semantics like --deliver; a --wake-on none/off form to clear). Without this, rk cron add can only seed the bare backoff ladder and fab's seed would silently lose the wake_on pickup-latency edge. Validate at add time; surface in rk cron list --json (already emits wake_on) and the cron briefing (docs/site/skill/cron.md). STEP 2 (after fab-kit ships the seed — fab's reconcile does rk cron add ... --pinned when rk cron list --json shows no role:operator row, then keeps editing it as today): delete seedOperatorTick/operatorTickEntrySpec from rk operator; rk operator becomes launcher-only (singleton role window, fab agent operator resolution, kickoff delivery, promotion) — the respawn argv 'rk operator -L {server}' is unchanged and stays fab's seed value. Overlap window is safe: both sides key idempotency on the role:operator row, so no duplicate. INTERIM (do with STEP 1): flip the seed's Deliver from DeliverImmediate to skip-if-busy AND the backoff ladder from 60s→30m to 3m→24m (fab-kit derives --backoff --min 3m --max 24m from 2026-09-12; also the --backoff flag defaults in rk cron add/edit if you want them to agree) — fab-kit now derives skip-if-busy for EVERY tracked-set branch (one policy, no two-way table), so a fresh server should not show 'immediate' until fab's first reconcile edits it. DOC SITES: docs/specs/cron.md § Cron State operator-tick example (L111-115, L145, L190, L518-524, L569 kbbh) — reword ownership: rk defines the schema/evaluator, the consumer (fab) seeds and tunes its entry; docs/memory/run-kit/cron.md, rk-riff.md, ui/cron-console-tabs.md, ui/routes-and-shell.md, docs/site/cron-schedule-kinds.md, docs/site/skill/cron.md wherever they say rk operator seeds. TESTS: app/backend/cmd/rk/operator_test.go L638+ (seed shape — its comment says debounce 10s while operatorTickEntrySpec sets 60s: fix the comment in STEP 1, delete the test in STEP 2), cron_add_test.go L675 (add --wake-on cases). NON-GOALS: no change to backoff/idle-epoch semantics, to skipped-busy logging, to EnsureRoleEntry's narrow-upgrade behaviour before STEP 2, or to rk cron rm staying the user's. Cross-repo pairing: fab-kit side = the skip-if-busy change shipping 2026-09-12 (no rk dep) + a fab backlog row for the seed move gated on STEP 1.

**Scope of THIS change: STEP 1 + INTERIM only.** STEP 2 (deleting the rk-side seed) is gated on fab-kit shipping its own seed and is deferred to a new backlog row this change adds (see § What Changes › 7) — archiving this change marks `[ntde]` done, so STEP 2 needs its own row to survive.

## Why

**The problem.** The operator-tick cron entry has split ownership across two repos. fab-kit's `operator_clock.go` reconcile already owns the entry's mute/unmute (tracked-set flips), its derived schedule, and its deliver policy (applied through `rk cron edit`). The one remaining slice — creating the entry in the first place — lives in rk (`operatorTickEntrySpec` + `seedOperatorTick` in `app/backend/cmd/rk/operator.go`). Every operator-clock policy change (today: skip-if-busy everywhere, 3m→24m ladder) therefore lands as two PRs in two repos, and until both ship a fresh server seeds one policy and fab's first reconcile flips it to another.

**The blocker for moving the seed to fab.** fab's future seed would be a plain `rk cron add … --backoff --min 3m --max 24m --role operator --if-absent respawn --respawn … --pinned`. But `rk cron add` has no way to set `wake_on` — the field exists in the schema (`cron.WakeOn{Event, Scope, Debounce}`), is emitted by `rk cron list --json`, and is set today only by the Go-side spec. A fab seed without `wake_on` would silently lose the reactive channel (an agent asking a question pings the operator within one poll instead of waiting for the next backoff rung) — a regression nobody would notice until latency complaints. STEP 1 closes that gap on the CLI, in both `add` and `edit`, so fab can seed and later tune the full entry through rk's verbs alone.

**Why the interim seed tuning rides along.** fab-kit now derives `skip-if-busy` for every tracked-set branch and a 3m→24m ladder. Until STEP 2 removes the rk seed, a fresh server would otherwise show `deliver: immediate` / 60s→30m until fab's first reconcile edits it. Aligning the rk spec with fab's derived values now removes that visible flap at ~zero cost (two constants and a test), and it is the last time the rk-side spec should need touching.

**If we don't.** fab-kit's seed move stays blocked, ownership stays split, and each future policy change keeps costing two coordinated PRs plus an overlap window where the two sides disagree.

## What Changes

### 1. `rk cron add` — three new `wake_on` flags

Add to `app/backend/cmd/rk/cron_add.go` (flag vars, `init()`, `runCronAdd`, `Long`, `Example`):

| Flag | Type | Default | Meaning |
|------|------|---------|---------|
| `--wake-on <event>` | string | `""` (unset — no `wake_on` block) | Edge trigger OR'd with the schedule. Only accepted value today: `agent-state-change` (`cron.WakeAgentStateChange`). |
| `--wake-scope <scope>` | string | `server` (`cron.WakeScopeServer`) | Fingerprint scope. Only accepted value today: `server`. |
| `--wake-debounce <dur>` | duration | `60s` | Hold after the entry's own newest delivery; a burst coalesces into one fire. Must be `≥ 0`. |

Behavior:

- When `--wake-on` is given, the entry gets `WakeOn: &cron.WakeOn{Event: <event>, Scope: <scope>, Debounce: cron.Duration{<dur>}}`. When it is not given, `WakeOn` stays `nil` and the file omits the key (matches the existing `respawn` "empty set is the unset case" posture).
- **Validation at add time, usage-classified (exit 2)** via the existing `cronAddValidateEnum` helper: `--wake-on` ∈ {`agent-state-change`}; `--wake-scope` ∈ {`server`}; `--wake-debounce < 0` is a usage error. Message shape follows `--deliver`'s (`--wake-on must be one of: agent-state-change`).
- **`--wake-scope` or `--wake-debounce` without `--wake-on` is a usage error** — `--wake-scope/--wake-debounce only apply with --wake-on` — mirroring `--min/--max only apply with --backoff` and `--respawn only applies with --if-absent respawn`. Detect via `cmd.Flags().Changed(...)`, not value comparison, so an explicit `--wake-scope server` alone still errors.
- `Entry.validate()` in `internal/cron/schema.go` gains **no** new `wake_on` rule — the tolerant-load posture for files already on disk is unchanged (§ Assumptions 6).
- `Long`: extend the policy sentence to name the wake flags (the reactive channel — "fires when an agent in scope goes waiting/idle or vanishes, in addition to the schedule"). `Example`: add the full operator-entry shape fab will seed with:

  ```
  rk cron add "operator tick" --backoff --min 3m --max 24m --wake-on agent-state-change --deliver skip-if-busy --role operator --if-absent respawn --respawn rk --respawn operator --respawn -L --respawn '{server}' --pinned
  ```

  (replacing the current `operator tick` example line, which shows the bare ladder and no `--pinned`). The existing pinned example strings in `cron_add_test.go` (`"wake up" --idle-every 3m`, `"morning digest" …`) stay.

### 2. `rk cron edit` — the same three flags, replace-field semantics

Add to `app/backend/cmd/rk/cron_edit.go` (flag vars, `init()`, `runCronEdit`'s `edited` predicate, `apply` closure, the "nothing to edit" message, `Use`, `Long`, `Example`):

- `--wake-on <event>` **replaces the whole `wake_on` block**: `e.WakeOn = &cron.WakeOn{Event, Scope, Debounce}` with `--wake-scope`/`--wake-debounce` refining and the defaults (`server`, `60s`) filling any knob not given — the same shape as `--backoff --min/--max` "replaces the whole ladder (60s/30m defaults for the knob not given)". Enum/range validation identical to `add`.
- **Clear form**: `--wake-on none` sets `e.WakeOn = nil` (the file drops the key). `off` is accepted as an alias for `none` (the backlog names both; `mute --off`/`pin --off` are the toolkit's existing "off" idiom). `--wake-on none` combined with `--wake-scope` or `--wake-debounce` is a usage error (`--wake-scope/--wake-debounce do not apply with --wake-on none`).
- `--wake-scope`/`--wake-debounce` without `--wake-on` is a usage error, same text as `add`.
- `edited` becomes `scheduleSet || Changed(deliver|name|if-absent|respawn|wake-on)`; the "nothing to edit" usage message lists `--wake-on`.
- **No `rescheduled` log line for a wake_on-only edit.** `cron.Edit` (`internal/cron/edit.go`) compares only `Schedule` and `Deliver`; `wake_on` has no anchor to reset (the wake cursor is keyed by entry id and cold-starts harmlessly), so `cron.Edit` is untouched (§ Assumptions 5).
- `Use` gains `[--wake-on <event>|none [--wake-scope <s>] [--wake-debounce <dur>]]`; `Example` gains `rk cron edit a3f9 --wake-on agent-state-change --wake-debounce 2m` and `rk cron edit a3f9 --wake-on none`.

### 3. `rk cron list` — verified, no code change

`rk cron list --json` already emits `wake_on` as `{event, scope, debounce}` (`cronListWakeOn`, `cron_list.go`), `null` when unset. The text table's FLAGS column stays `muted`/`pinned` only — no wake column is added (§ Assumptions 7). The apply stage adds one `--json` round-trip assertion (add with `--wake-on` → list shows the block) rather than new list code.

### 4. INTERIM — `operatorTickEntrySpec` aligned with fab's derived values

In `app/backend/cmd/rk/operator.go`:

```go
Schedule: cron.Schedule{
    Kind: cron.ScheduleBackoff,
    Min:  cron.Duration{Duration: 3 * time.Minute},   // was 60 * time.Second
    Max:  cron.Duration{Duration: 24 * time.Minute},  // was 30 * time.Minute
},
// WakeOn unchanged: agent-state-change / server / 60s
Deliver: cron.DeliverSkipIfBusy,                       // was cron.DeliverImmediate
```

Everything else in the spec (wake_on 60s, `role:operator`, payload/name `operator tick`, `if_absent: respawn`, `respawn: ["rk","operator","-L","{server}"]`, `pinned: true`, `created_by`) is unchanged.

**The generic `--backoff` defaults (`--min 1m`, `--max 30m`) in `add`/`edit` stay as they are** (§ Assumptions 2). The 3m→24m ladder is the operator consumer's tuning, not the substrate's default — which is exactly the ownership thesis of this change. The `Long`/usage text "60s→30m by default" therefore stays correct.

**`EnsureRoleEntry` is not touched** (NON-GOAL): an already-seeded server keeps its 60s→30m/immediate entry until fab's reconcile edits it — the narrow upgrade still only backfills an empty respawn argv and raises a below-spec debounce. The new spec values reach fresh servers only.

### 5. Tests

- `app/backend/cmd/rk/cron_add_test.go`: new cases — `--wake-on agent-state-change` alone persists `{agent-state-change, server, 60s}`; with `--wake-scope server --wake-debounce 2m` persists the given values; omitted flags ⇒ `WakeOn == nil` and the YAML has no `wake_on:` key; usage-error matrix (unknown event, unknown scope, negative debounce, `--wake-scope`/`--wake-debounce` without `--wake-on`) — exit 2, state dir untouched (extend the `TestCronAddRespawnMatrix` table style); the `Long`/`Example` pin test gains the new operator-entry example string and the wake-flag mention.
- `app/backend/cmd/rk/cron_edit_test.go`: `--wake-on` on an entry without one adds the block; on an entry with one replaces it (including debounce reset to default when `--wake-debounce` is omitted); `--wake-on none` and `--wake-on off` clear it; a wake_on-only edit appends **no** `rescheduled` line; the usage matrix (knobs without `--wake-on`, knobs with `none`, bad enum).
- `app/backend/cmd/rk/operator_test.go` `TestOperatorSeedsOperatorTickEntry` (L642): expected schedule 3m/24m, deliver `skip-if-busy`; fix the doc comment (it says `wake_on … 10s` and `immediate`; the spec has been 60s since upt2) to state 3m→24m / 60s / skip-if-busy. `TestOperatorSeedIsIdempotent` is unaffected. The whole seed test block is deleted only in STEP 2.
- `cron_list_test.go`: one assertion that a `--wake-on` add round-trips through `--json`.

### 6. Docs — ownership reworded to present truth, values updated

Wording rule everywhere: **rk defines the schema and the evaluator; the consumer (fab) seeds and tunes its entry.** State present truth honestly — today `rk operator` still seeds (STEP 2 pending); do not write the future state as if shipped.

- **`docs/specs/cron.md`** — § Cron State example (≈L111–115): `schedule: { kind: backoff, min: 3m, max: 24m }`, `deliver: skip-if-busy`, plus a comment that the values are the operator consumer's tuning. ≈L145 (anchor-join paragraph naming "the operator tick"): no semantic change; light touch only if it asserts who seeds. ≈L190 (debounce paragraph "The operator tick seeds `60s`, and `rk operator` raises an existing below-spec value to it"): reword to the consumer-seeds framing while keeping the rk narrow-upgrade sentence true until STEP 2. ≈L518–524 (P1.5 "rk operator seeds the operator-tick entry"): add the ownership decision and the two-step handover (STEP 1 shipped here; STEP 2 gated on fab-kit's seed). ≈L569 (kbbh decision note): historical — leave, or add one clause noting the seed is moving to fab. § CLI (wherever `rk cron add`/`edit` flags are enumerated): add the three wake flags and the `none` clear form.
- **`docs/memory/run-kit/cron.md`** — § CLI: the three flags on `add` and `edit`, validation rules, replace-block/`none` semantics, no-`rescheduled` rule. § Operator-Tick Seeding: new spec values (3m→24m, skip-if-busy), ownership framing, STEP 2 pending. § Requirements: the idempotent-seeding requirement's spec values; a new requirement for the wake flags (add/edit/validation/clear) with scenarios. § Design Decisions: one entry — "wake_on is CLI-addressable so a consumer can seed the full operator entry; generic backoff defaults stay 60s/30m because the 3m→24m ladder is the consumer's tuning".
- **`docs/memory/run-kit/rk-riff.md`** ≈L299 and ≈L417 (the `rk operator` seeding sentences): reword to the ownership framing; values need not be repeated there (they point at cron.md).
- **`docs/site/skill/cron.md`** (the cron briefing, embedded as `rk skill cron`): in § `rk cron add`, a new bullet group for the wake flags (what an actionable edge is, the debounce hold, the `none` clear on `edit`); the operator example line updated; L15 "(`rk operator`'s seeded entry)" → neutral ("the operator tick entry"). Check against `shll standards skill` before editing (Constitution § Toolkit Standards).
- **`docs/site/cron-schedule-kinds.md`** ≈L163–172 ("Put together" panel): the YAML block → `min: 3m, max: 24m`, `deliver: skip-if-busy`; the prose "that `rk operator` seeds" → ownership-neutral; the "snaps back to 1 minute" sentence → "to 3 minutes". The generic backoff panel's 1→30m ladder text is the substrate default and stays.
- **`docs/memory/run-kit/ui/cron-console-tabs.md`, `ui/routes-and-shell.md`**: grep finds no "seeds"/"rk operator seeds" claims in either — no edit expected (§ Assumptions 8); re-grep during apply.
- `rk cron add --help` / `edit --help` are release artifacts (`help-dump` standard) — the `Long`/`Example`/flag-usage edits above are the doc change for the command tree; check `shll standards help-dump` and `principles` (№3, №4 exit-2 usage errors) before finalizing help text.

### 7. Follow-up backlog row for STEP 2

Append a new `fab/backlog.md` row (fresh 4-char ID, dated the day of apply) carrying STEP 2 verbatim from the origin text: delete `seedOperatorTick`/`operatorTickEntrySpec` and the seed tests; `rk operator` becomes launcher-only; **gated on fab-kit's reconcile seeding via `rk cron add … --pinned` (fab-kit backlog row)**; respawn argv `rk operator -L {server}` unchanged; note the safe overlap window (both sides key on the `role:operator` row) and that `EnsureRoleEntry`'s narrow upgrade goes away with the seed. Mark it `[fab-kit operator clock]` like `[ntde]`.

## Affected Memory

- `run-kit/cron`: (modify) § CLI — `--wake-on`/`--wake-scope`/`--wake-debounce` on `add`+`edit`, validation, replace-block + `none` clear, no `rescheduled` on wake-only edits; § Operator-Tick Seeding — spec values 3m→24m / skip-if-busy and the consumer-owns-the-entry framing with STEP 2 pending; § Requirements — updated seed requirement + new wake-flags requirement; § Design Decisions — one new entry
- `run-kit/rk-riff`: (modify) the two `rk operator` seeding sentences (≈L299, ≈L417) reworded to the ownership framing

## Impact

**Code (Go, `app/backend/`)**
- `cmd/rk/cron_add.go` — flag vars, `init()`, `runCronAdd` (wake block build + validation), `Long`, `Example`
- `cmd/rk/cron_edit.go` — flag vars, `init()`, `runCronEdit` (`edited`, `apply`, validation, `none` clear), `Use`, `Long`, `Example`
- `cmd/rk/operator.go` — `operatorTickEntrySpec` (3 constants)
- `internal/cron/` — **no changes** (`schema.go` `WakeOn`/enums already exist; `edit.go` untouched; `store.go` `EnsureRoleEntry` untouched)

**Tests** — `cmd/rk/cron_add_test.go`, `cron_edit_test.go`, `operator_test.go` (L630–690 comment + expected values), `cron_list_test.go` (one round-trip). Run via `just test-backend`; the fresh worktree needs `just _ensure-tmux-conf` first for the Go embed.

**Docs** — `docs/specs/cron.md`, `docs/memory/run-kit/cron.md`, `docs/memory/run-kit/rk-riff.md`, `docs/site/skill/cron.md`, `docs/site/cron-schedule-kinds.md`, `fab/backlog.md` (STEP 2 row). Memory index regeneration via `fab docs-index` if descriptions change.

**Cross-repo** — `rk cron list --json`'s `wake_on` shape is already a fab-kit read contract (memory cron.md § CLI) and does not change. fab-kit's `operator_clock.go` in the local checkout still carries `operatorBackoffMin = "1m"` / `Max = "30m"` and a two-way deliver table; the 3m→24m + skip-if-busy-everywhere change is the fab-kit side shipping 2026-09-12 and has no rk dependency. fab's seed move (STEP 2 gate) will call `rk cron add … --wake-on agent-state-change … --pinned` once this ships.

**Live servers** — not migrated by rk: an existing seeded entry keeps 60s→30m/immediate until fab's reconcile edits it (NON-GOAL preserved). Only fresh servers see the new spec.

**Standards** — CLI surface + help + `docs/site/` change ⇒ Constitution § Toolkit Standards applies: check `shll standards principles`, `help-dump`, `skill` during apply.

## Open Questions

- None blocking. The one judgment call left open by the backlog ("also the `--backoff` flag defaults … if you want them to agree") is resolved as an assumption (keep the generic defaults; § Assumptions 2) — override via `/fab-clarify` if the defaults should move too.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Scope is STEP 1 + INTERIM only; STEP 2 is deferred to a new backlog row this change adds | Backlog orders the steps and gates STEP 2 on fab-kit shipping its seed; archiving marks `[ntde]` done so STEP 2 needs its own row | S:85 R:70 A:75 D:75 |
| 2 | Confident | Generic `--backoff` `--min 1m` / `--max 30m` defaults in `add`/`edit` stay; only `operatorTickEntrySpec` moves to 3m→24m | Backlog leaves it optional ("if you want them to agree"); the ladder is the operator consumer's tuning, not the substrate default — the ownership thesis of the change; avoids touching every "60s→30m by default" doc/help string | S:60 R:85 A:70 D:65 |
| 3 | Certain | `--wake-scope` / `--wake-debounce` without `--wake-on` is a usage error (exit 2) on both verbs | Mirrors `--min/--max only apply with --backoff` and `--respawn only applies with --if-absent respawn`; toolkit principle №4 | S:70 R:90 A:90 D:85 |
| 4 | Confident | `edit --wake-on <event>` replaces the whole `wake_on` block (defaults fill omitted knobs); `--wake-on none` clears it, `off` accepted as alias; `none` + knobs is a usage error | Backlog asks for replace-field semantics like `--deliver` and a `none/off` clear; the `--backoff --min/--max` "replaces the whole ladder" precedent fixes the block-replace shape | S:65 R:80 A:75 D:60 |
| 5 | Confident | A wake_on-only edit appends no `rescheduled` log line; `cron.Edit` is untouched | `rescheduled` is the schedule/deliver anchor-reset point; `wake_on` has no anchor — its cursor is entry-id keyed and cold-starts harmlessly | S:50 R:85 A:80 D:70 |
| 6 | Confident | Validation is CLI-side (`cronAddValidateEnum` + `debounce ≥ 0`); `Entry.validate()` gains no `wake_on` rule | Backlog says "validate at add time"; adding a schema rule would change tolerant-load behavior for files already on disk | S:60 R:85 A:75 D:60 |
| 7 | Certain | `rk cron list` text table unchanged; `--json` already emits `wake_on` — verified in `cron_list.go`, no list code change | Backlog states `--json` already emits it; the FLAGS column is muted/pinned by design | S:80 R:95 A:95 D:90 |
| 8 | Certain | `ui/cron-console-tabs.md` and `ui/routes-and-shell.md` need no edit | Grep finds no seeding claim in either; the backlog's "wherever they say rk operator seeds" is conditional | S:70 R:95 A:95 D:90 |
| 9 | Confident | Docs state present truth: `rk operator` still seeds today, ownership handover is two-step with STEP 2 pending | Memory files are post-implementation truth; writing the future state before STEP 2 ships would be a false claim | S:70 R:85 A:70 D:65 |
| 10 | Certain | Change type `feat` | New CLI flags are a feature; the seed tuning and doc rewording ride along | S:80 R:95 A:95 D:90 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).
