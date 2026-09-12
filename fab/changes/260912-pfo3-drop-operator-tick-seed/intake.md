# Intake: Drop the rk-side operator-tick seed — `rk operator` becomes launcher-only

**Change**: 260912-pfo3-drop-operator-tick-seed
**Created**: 2026-09-12

## Origin

One-shot `/fab-new pfo3` from backlog row `[pfo3]` (fab/backlog.md, dated 2026-09-12). No prior conversation on the topic in this session; the row is STEP 2 of the two-step handover whose STEP 1 shipped as `260911-ntde-cron-wake-on-flags-seed-tuning` (run-kit PR #954, v3.19.52). Raw input:

> [fab-kit operator clock] STEP 2 of the operator-tick ownership handover (STEP 1 + interim tuning shipped in 260911-ntde-cron-wake-on-flags-seed-tuning, which added the --wake-on/--wake-scope/--wake-debounce CLI flags and aligned the interim rk seed to 3m→24m / skip-if-busy). GATED on fab-kit shipping its own seed: fab's reconcile does `rk cron add "operator tick" --backoff --min 3m --max 24m --wake-on agent-state-change --deliver skip-if-busy --role operator --if-absent respawn --respawn rk --respawn operator --respawn -L --respawn '{server}' --pinned` when `rk cron list --json` shows no role:operator row, then keeps editing it as today (fab-kit backlog row). THEN: delete seedOperatorTick/operatorTickEntrySpec from rk operator (app/backend/cmd/rk/operator.go) and the three seed tests (TestOperatorSeedsOperatorTickEntry / TestOperatorSeedIsIdempotent / TestOperatorSeedFailureIsNonFatal in operator_test.go) — rk operator becomes launcher-only (singleton role window, fab agent operator resolution, kickoff delivery, promotion). The respawn argv 'rk operator -L {server}' is unchanged and stays fab's seed value. Overlap window is safe: both sides key idempotency on the role:operator row, so no duplicate. EnsureRoleEntry's narrow upgrade (respawn-argv backfill + below-spec debounce raise) retires with the seed — EnsureRoleEntry itself goes too if it has no other caller. NON-GOALS (unchanged from ntde): no change to backoff/idle-epoch semantics, skipped-busy logging, or rk cron rm.

**The gate is cleared — verified at intake time.** fab-kit shipped its own seed in commit `17903370 feat: fab Seeds the Operator-Tick Cron Entry (#672)` (change `260912-bjrk`), released as **fab-kit v2.26.2**, and `fab version` on this box reports `fab 2.26.2`. fab's `operator_clock.go` reconcile now runs `ensureOperatorCronRow()` — `listOperatorCronRows()` + `pickOperatorCronRow()`, seeding one fully explicit `rk cron add` on **zero** `role:operator` candidates only (never on an rk failure or an ambiguous tie), then re-resolving once — from every reconcile entry point (`track` mutations, `tick-start --diff`, and the new `fab operator clock sync` heal-and-read verb that `/fab-operator` §2 Init step 4 and every per-tick frame run). The argv fab emits:

```
rk cron add "operator tick" --name "operator tick" --backoff --min 3m --max 24m --role operator --deliver skip-if-busy --wake-on agent-state-change --wake-scope server --wake-debounce 60s --if-absent respawn --respawn rk --respawn operator --respawn -L --respawn {server} --pinned
```

fab-kit's memory (`docs/memory/runtime/operator.md` v12) records the ownership decision verbatim: *"fab owns the operator-tick entry end-to-end — the clock reconcile seeds it when the server has none"*, with the rejected alternative *"seeding from `rk operator` only (every policy change had to be mirrored across two repos)"*. It also still says *"`rk operator`'s launcher also seeds it; both key on the row, so there is never a duplicate"* — the overlap-window sentence this change makes stale (a fab-kit doc follow-up, see § Impact).

## Why

**The problem.** After STEP 1 the operator-tick cron entry has two seeders: fab's reconcile (the lifecycle owner — mute/unmute, schedule derive, deliver policy, and now the seed) and `rk operator`'s `seedOperatorTick` → `cron.EnsureRoleEntry(dir, slug, operatorTickEntrySpec())`. The rk copy is a frozen mirror of fab's policy constants (`3m`/`24m`/`skip-if-busy`/`60s`). Both key idempotency on the `role:operator` row, so nothing duplicates today — but the rk copy is now pure liability: the next time fab tunes the entry (a ladder bound, the deliver policy, the wake debounce), a fresh server whose operator is opened by `rk operator` BEFORE fab's first reconcile seeds the old policy and ticks on it until fab's convergence edit lands. Every such tuning would again need a lockstep run-kit PR to keep `operatorTickEntrySpec` in agreement — exactly the cross-repo tax the handover exists to end.

**The decision (fab-kit discussion 2026-09-12, recorded in both repos).** *rk defines the schema and the evaluator; the consumer (fab) seeds and tunes its entry.* rk stays generic substrate — `rk cron add/edit/list/mute/pin/rm` and the daemon's evaluator, delivery, respawn — and `rk operator` stays the launcher the entry's `respawn` argv invokes. Nothing in rk should know the operator entry's shape.

**Why now, and why it is safe.** The gate condition is met (fab 2.26.2 installed and released). Removal order is the planned one: fab's seed first, then rk's — during the overlap both sides keyed on the `role:operator` row, so there was never a duplicate and there is no window without a seeder. After this change a server gains its entry on the operator's first `/fab-operator` Init (`fab operator clock sync`), or on the first `track` mutation / tick, whichever comes first. The daemon's respawn path is unaffected: `rk operator -L {server}` runs only when the entry already exists and fires, so it never needed to seed.

**If we don't.** rk keeps a dead-code mirror of fab policy that silently re-diverges on the next tuning, `EnsureRoleEntry`'s narrow-upgrade logic (respawn-argv backfill, below-spec debounce raise) keeps guarding a shape rk no longer owns, and the memory keeps describing an ownership that is no longer true.

## What Changes

### 1. `app/backend/cmd/rk/operator.go` — delete the seed

Remove, in full:

- the `seedOperatorTick(cmd, serverLabel)` call in `runOperator` (currently between the `serverLabel` derivation and the `ctx, cancel := context.WithTimeout(...)` block), together with its 5-line "Idempotent operator-tick seeding …" comment;
- `func seedOperatorTick(cmd *cobra.Command, slug string)` and its doc comment;
- `func operatorTickEntrySpec() cron.Entry` and its doc comment;
- the `"rk/internal/cron"` import — after the deletion the file has no other `cron.` reference (`cron.ValidSlug`, `cron.EnsureRoleEntry`, `cron.Entry`, `cron.CreatedBy` were all seed-only). The `"time"` import **stays** (`operatorCmdTimeout`, `operatorDeliverDeadline`).

Adjust the `serverLabel` comment: today it reads *"The server label keys both the cron seed's entry file and the kickoff delivery's tmux addressing"* — after the change it keys only the kickoff delivery's tmux addressing (and the `--json` receipt's `server` field). `serverLabel` itself stays — the `-L` receipt and `deliverAgentKickoff` still consume it.

Everything else in `rk operator` is untouched and is the launcher-only surface the row names: the `$TMUX` / `fab`-on-PATH preconditions, the `--workers` charset gate, the `-L/--server` daemon-invocable form, the server-wide singleton probe (`findOperatorWindowID`), `createMarkedOperatorWindow` (atomic create-and-mark through the `rk role` write path + `MoveWindowIntoOperatorSession` promotion), `riff.ResolveAgent(ctx, root, "operator")` + `SkillPaneCommand`, the typed `/fab-operator` kickoff via `deliverAgentKickoff` with the paste-it-yourself degrade, and the `--json` receipt. No help text (`Long`/`Example`) mentions seeding, so `help-dump` output is unchanged.

### 2. `app/backend/cmd/rk/operator_test.go` — delete the seed tests and their seam plumbing

- Delete the `// --- Operator-tick seeding ---` section: its section comment and the three tests `TestOperatorSeedsOperatorTickEntry`, `TestOperatorSeedIsIdempotent`, `TestOperatorSeedFailureIsNonFatal`.
- In `TestOperatorServerFlagCreatesWithoutTMUX`, delete the trailing seed assertion (`cron.LoadEntries(filepath.Join(s.cronDir, "runKit.yaml"))` … *"want the entry seeded under the -L slug"*) and drop *"the entry seeds under the runKit slug"* from its doc comment.
- In the `stubOperatorSeams` helper: remove the `cronDir string` / `cronDirErr error` fields and their comment from the seams struct; remove the `origCronDir, origCronPane := cronDirFn, cronTmuxPaneFn` capture, the `s.cronDir = t.TempDir()` + two seam overrides, and the matching `cronDirFn, cronTmuxPaneFn = origCronDir, origCronPane` restore in `t.Cleanup`. The **package-level seams `cronDirFn` / `cronTmuxPaneFn` / `cronNowFn` (`cron.go`) stay** — `rk cron add` and `cron_test.go` use them.
- Trim the `operatorTestSocket` comment: *"Its basename doubles as the cron server slug for the seed step, so it must pass cron.ValidSlug (no dots)."* is no longer a constraint (the basename still feeds `cliServerLabel` for the receipt/kickoff, which imposes no slug rule).
- Drop imports that become unused (`rk/internal/cron`; check `filepath`, `os`, `time` — each is used elsewhere in the file, verify with `go vet`).
- The suite must still pass under `env -u TMUX -u TMUX_PANE` (the ambient-env false-green guard in the file header).

### 3. `app/backend/internal/cron/store.go` — delete `EnsureRoleEntry`

`EnsureRoleEntry` has exactly one caller (`operator.go`, verified with grep over `app/backend`), so per the row it goes with the seed — the whole function and its doc comment, including the two narrow upgrades (respawn-argv backfill when `if_absent: respawn` with an empty argv; below-spec `wake_on.debounce` raise). `Add`, `Remove`, `Update`, `SetMuted`, `loadForMutate`, `saveEntries` are unchanged. `RoleOperator` (`schema.go`) **stays** — `push_url.go` still names the operator role literally.

Existing on-disk entries are **not** migrated by rk (unchanged posture): an already-seeded server keeps its stored entry, and fab's reconcile edits it via `rk cron edit`. The narrow upgrades were transitional (an old-shape entry with no `respawn` argv or a 10s debounce); every live server has long since been upgraded or re-seeded, and fab's `clock sync` re-seeds a removed entry anyway.

### 4. `app/backend/internal/cron/store_test.go` — delete the `EnsureRoleEntry` tests

Delete the two fixtures `roleTickSpec()` and `roleTickSpecWithDebounce(d)` and the eight tests `TestEnsureRoleEntryRejectsNonRoleSpec`, `TestEnsureRoleEntrySeedsOnEmpty`, `TestEnsureRoleEntryIdempotentAndNeverMutates`, `TestEnsureRoleEntryRoleScoped`, `TestEnsureRoleEntryNarrowUpgrade`, `TestEnsureRoleEntryNoUpgradeWhenRespawnPresent`, `TestEnsureRoleEntryDebounceBackfill`, `TestEnsureRoleEntryNoDebounceDowngrade`. `TestMuteWriteRules` and `TestUpdateMergesFields` sit between them and stay. Check whether any surviving test in the file used `roleTickSpec` (grep says none outside those eight) and whether `time` stays imported.

### 5. Documentation — every site that says rk seeds

Memory (hydrate stage, `docs/memory/run-kit/`):

- `cron.md` § Operator-Tick Seeding — rewrite to present truth: fab's clock reconcile seeds the entry (zero-candidate rule, the argv above, `fab operator clock sync` heals a removed entry); `rk operator` is launcher-only; the seeded spec's values are fab's constants (rk carries none); the `EnsureRoleEntry` paragraph (L121) goes; the requirement *"Idempotent role-entry seeding with the narrow upgrade"* and its scenarios retire; the design decision *"Role-target presence as the seed idempotency key"* becomes a cross-repo statement (fab keys on the `role:operator` row) or retires; § Seed interaction bullet (L87) and the `RoleOperator` clause (L108, "e.g. the `rk operator` seed" → `push_url.go`); L243 *"fab's future seed"* → present tense; the `rk cron list --json` read contract gains the seed as a consumer of `rk cron add`.
- `rk-riff.md` L305 and L423 — drop the "`rk operator` also seeds …" sentences; the respawn-argv and `-L` prose stays.
- `architecture/cli.md` `operator` row — drop "tick-seed warnings stay on stderr".

Specs and site (apply stage, alongside the code — the human-curated spec was touched the same way by ntde):

- `docs/specs/cron.md` L190–193 (*"`rk operator` — which still seeds the entry today … raises an existing below-spec value to it"* → the consumer seeds `60s`, rk no longer touches it) and P1.5 (*"STEP 2 (pending …) deletes the rk-side seed"* → shipped); L592's parenthetical (*"The seed itself is moving to fab"*) → moved.
- `docs/site/cron-schedule-kinds.md` L163 — *"rk defines the clock and `rk operator` plants the entry today; … fab … is taking over the seeding as well"* → rk defines the clock, fab plants and tunes the entry.
- `docs/site/skill/cron.md` L15 — "the operator entry seeded on every tmux server" stays true; optionally name fab as the seeder. Both `docs/site` edits fall under the constitution's Toolkit Standards clause — check against `shll standards readme-extraction` / `skill` before finishing.

Not touched here: fab-kit's own docs (`docs/memory/runtime/operator.md`: *"`rk operator`'s launcher also seeds it"*) — a fab-kit follow-up row, out of this repo.

### 6. Verification

`just test-backend` (go test `./cmd/rk/` and `./internal/cron/` are the affected packages — run them first), plus `go vet ./...` for the dropped imports, plus `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`. No frontend or e2e change: the three e2e specs that mention `operator tick` (`status-bar`, `mobile-cron-tabs`, `operator-console`) inject cron fixtures through the API and never invoke `rk operator`.

## Affected Memory

- `run-kit/cron`: (modify) § Operator-Tick Seeding rewritten (fab seeds via its reconcile; rk launcher-only; no rk-side spec); `EnsureRoleEntry` paragraph, the narrow-upgrade requirement + scenarios, and the seed-idempotency design decision retired or re-homed as cross-repo statements; § Seed interaction, `RoleOperator` clause, and the `rk cron list --json` contract paragraph updated
- `run-kit/rk-riff`: (modify) drop the two "`rk operator` also seeds the operator-tick entry" sentences (§ Single-Quote Escaping and Task Injection area, L305; the operator.go file row, L423)
- `run-kit/architecture/cli`: (modify) `operator` row — remove the tick-seed stderr-warning clause

## Impact

**Code** (all removals): `app/backend/cmd/rk/operator.go` (~60 lines: call site, two functions, one import), `app/backend/cmd/rk/operator_test.go` (three tests + one assertion + seam plumbing, ~120 lines), `app/backend/internal/cron/store.go` (`EnsureRoleEntry`, ~50 lines), `app/backend/internal/cron/store_test.go` (two fixtures + eight tests, ~200 lines). No new code paths, no CLI flag or help-text change, no API change, no frontend change.

**Behavior contract**: `rk operator` no longer creates the operator-tick cron entry. A fresh server gains its entry when fab's clock reconcile first runs — `/fab-operator` §2 Init (`fab operator clock sync`), any `fab operator track` mutation, or `tick-start --diff`. Requires fab-kit ≥ 2.26.2 for the seed to exist at all; an older fab's Init hand-parses `rk cron list --json` and STOPs loudly with *"no operator-tick cron entry on this server — run rk operator to seed it"* (a wrong hint after this change, but a visible stop, not a silent no-tick server).

**Live servers**: existing entries (e.g. this box's `onxm` row) are untouched; fab's reconcile keeps editing them.

**Cross-repo follow-up (not this change)**: fab-kit's operator memory still describes `rk operator` as a co-seeder and its old STOP text names `rk operator`; both want a fab-kit row once this ships.

**Docs**: three memory files (hydrate), `docs/specs/cron.md`, `docs/site/cron-schedule-kinds.md`, `docs/site/skill/cron.md` (apply).

## Open Questions

*(none — the backlog row is fully specified, the gate condition is verified against the installed fab-kit, and every code site was located at intake time)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The gate is met: fab-kit v2.26.2 (#672, change bjrk) ships `ensureOperatorCronRow` seeding from every reconcile entry point plus `fab operator clock sync`; the installed fab is 2.26.2 | Verified in the fab-kit repo (commit, memory v12 row, intake) and via `fab version` on this box | S:90 R:90 A:95 D:95 |
| 2 | Certain | Delete `seedOperatorTick`, `operatorTickEntrySpec`, the call site, the `cron` import, the three named tests, and the `-L` test's seed assertion | The row names each of these; the `-L` assertion is the one extra seed check grep found | S:95 R:85 A:95 D:95 |
| 3 | Certain | Delete `EnsureRoleEntry` with its eight `store_test.go` tests and two fixtures | The row says "goes too if it has no other caller"; grep over `app/backend` finds only `operator.go` | S:90 R:80 A:95 D:90 |
| 4 | Certain | Retire the seed-specific seam plumbing in `stubOperatorSeams` (`cronDir`/`cronDirErr`, the `cronDirFn`/`cronTmuxPaneFn` overrides) but keep the package-level seams in `cron.go` | The seams are shared with `rk cron add` and `cron_test.go`; only the operator test's use of them was seed-only | S:70 R:90 A:90 D:80 |
| 5 | Certain | `RoleOperator` stays in `schema.go` | `push_url.go` still uses it; only the memory clause citing "the `rk operator` seed" as its example is reworded | S:80 R:95 A:95 D:90 |
| 6 | Certain | No e2e or frontend change | The three specs mentioning `operator tick` inject API fixtures and never call `rk operator` | S:80 R:95 A:90 D:90 |
| 7 | Certain | Existing on-disk entries are not migrated by rk; fab's reconcile owns them | Backlog non-goals + the standing "seeding establishes once, never reconciles" posture | S:90 R:90 A:95 D:95 |
| 8 | Certain | Doc sites updated in this repo: memory `cron.md`/`rk-riff.md`/`architecture/cli.md` at hydrate; `docs/specs/cron.md`, `docs/site/cron-schedule-kinds.md`, `docs/site/skill/cron.md` at apply (checked against `shll standards`); fab-kit's own docs are a fab-kit follow-up | Located by grep; ntde updated the spec the same way; the constitution's Toolkit Standards clause binds `docs/site` | S:85 R:90 A:85 D:85 |
| 9 | Confident | No fab minimum-version gate is added to `rk operator` | The launcher already requires `fab` on PATH; a pre-2.26.2 fab STOPs loudly at Init rather than silently running without ticks, and the toolkit is kept current on this box — a version probe would be new surface for a transitional case | S:40 R:85 A:70 D:65 |
| 10 | Confident | `change_type` pinned to `refactor` via `fab status set-change-type` | The row text contains "tests"/"operator_test.go", so refresh would infer `test`; the change is an ownership-handover code removal — `refactor` over `chore` | S:60 R:95 A:85 D:65 |
| 11 | Confident | The `rk cron add --help` example showing the operator-tick argv stays | It documents the argv fab emits — substrate help showing a consumer's canonical add is still accurate and useful | S:60 R:95 A:80 D:75 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).
