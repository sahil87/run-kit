# Plan: Drop the rk-side operator-tick seed — `rk operator` becomes launcher-only

**Change**: 260912-pfo3-drop-operator-tick-seed
**Intake**: `intake.md`

## Requirements

### rk operator: launcher-only

#### R1: `rk operator` creates no cron entry
`rk operator` MUST NOT read or write the cron state directory. `seedOperatorTick`, `operatorTickEntrySpec`, and the seed call site in `runOperator` SHALL be removed, and `app/backend/cmd/rk/operator.go` SHALL no longer import `rk/internal/cron`. Every other launcher behavior — the `$TMUX` and `fab`-on-PATH preconditions, the `--workers` charset gate, the `-L/--server` form, the singleton probe, `createMarkedOperatorWindow`, the kickoff delivery with its paste-it-yourself degrade, and the `--json` receipt — MUST be byte-for-byte unchanged in behavior.

- **GIVEN** a server whose cron state dir has no `role:operator` entry
- **WHEN** `rk operator` (or `rk operator -L <server>`) opens the operator window
- **THEN** the state dir still has no entry and no seed warning appears on stderr
- **AND** the window opens, the role is stamped, and the kickoff is delivered exactly as before

#### R2: `serverLabel` keeps only its remaining consumers
The `serverLabel` derivation in `runOperator` SHALL remain (the `--json` receipt's `server` field and `deliverAgentKickoff` consume it), and its comment SHALL no longer claim it keys a cron seed's entry file.

- **GIVEN** `rk operator -L runKit --json` on a server with no operator window
- **WHEN** the window is created
- **THEN** the receipt's `server` is `runKit` and the kickoff is addressed at `runKit`

### internal/cron: seed helper retired

#### R3: `EnsureRoleEntry` is removed
`cron.EnsureRoleEntry` and its two narrow upgrades (respawn-argv backfill, below-spec debounce raise) SHALL be deleted from `app/backend/internal/cron/store.go`. `Add`, `Remove`, `Update`, `SetMuted`, `loadForMutate`, `saveEntries`, and the `RoleOperator` constant MUST be unchanged. On-disk entries are NOT migrated or rewritten by rk.

- **GIVEN** the `internal/cron` package after the change
- **WHEN** `grep -rn EnsureRoleEntry app/backend` runs
- **THEN** it returns nothing
- **AND** `go build ./...` succeeds

### Tests

#### R4: Seed tests removed, suites green, ambient-env guard intact
The three `rk operator` seed tests, the `-L` test's seed assertion, the seed-only seam plumbing in `stubOperatorSeams` (`cronDir`/`cronDirErr` fields, the `cronDirFn`/`cronTmuxPaneFn` overrides and restores), the two `store_test.go` fixtures (`roleTickSpec`, `roleTickSpecWithDebounce`), and the eight `TestEnsureRoleEntry*` tests SHALL be deleted. The package-level seams `cronDirFn` / `cronTmuxPaneFn` / `cronNowFn` in `cron.go` MUST stay (used by `rk cron add` and `cron_test.go`). `go vet ./...` MUST pass (no unused imports), `go test ./cmd/rk/ ./internal/cron/` MUST pass, and `./cmd/rk/` MUST also pass under `env -u TMUX -u TMUX_PANE`.

- **GIVEN** the edited test files
- **WHEN** `go vet ./... && go test ./cmd/rk/ ./internal/cron/` and `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` run from `app/backend`
- **THEN** all pass with no seed test names in the output

### Documentation: present truth on ownership

#### R5: Spec and site say fab seeds, rk launches
`docs/specs/cron.md` (the `wake_on` debounce bullet that says `rk operator` still seeds, the P1.5 STEP 2 "pending" sentence, and the L592 "seed itself is moving to fab" parenthetical), `docs/site/cron-schedule-kinds.md` (the "rk operator plants the entry today … taking over" sentence), and `docs/site/skill/cron.md` (the "seeded on every tmux server" clause) SHALL state that fab's clock reconcile seeds and tunes the operator-tick entry and `rk operator` is launcher-only. The `docs/site` edits SHALL be checked against `shll standards skill` and `shll standards readme-extraction` (constitution § Toolkit Standards). Memory (`run-kit/cron`, `run-kit/rk-riff`, `run-kit/architecture/cli`) is the hydrate stage's, not apply's.

- **GIVEN** the three edited docs
- **WHEN** `grep -n -i 'rk operator.*seed\|seed.*rk operator\|plants the entry' docs/specs/cron.md docs/site/cron-schedule-kinds.md docs/site/skill/cron.md` runs
- **THEN** every remaining hit describes rk as launcher-only or fab as the seeder — none says rk seeds "today" or "still"

### Non-Goals

- No change to backoff / idle-epoch / anchor-join semantics, skipped-busy logging, `wake_on` evaluation, or `rk cron rm` — the evaluator and every `rk cron` verb are untouched
- No migration or rewrite of existing on-disk operator-tick entries (fab's reconcile owns them via `rk cron edit`)
- No fab minimum-version probe in `rk operator` (see Design Decisions)
- No change to `rk cron add --help`'s operator-tick example (it documents the argv fab emits)
- No edits to fab-kit's own docs (they still call `rk operator` a co-seeder — a fab-kit follow-up)

### Design Decisions

#### rk stays substrate: no fab version gate in the launcher
**Decision**: `rk operator` gains no probe that fab is ≥ 2.26.2 (the first fab that seeds the entry); its only fab precondition remains `fab` on PATH.
**Why**: a pre-2.26.2 fab STOPs loudly at `/fab-operator` §2 Init when no entry exists, so the failure is visible, not a silently tickless server; the toolkit is kept current on the one box that runs it; a version probe would be new launcher surface for a transitional case and would put fab's release history inside rk.
**Rejected**: a `fab version` parse + STOP in `rk operator` (new surface, brittle string parse); keeping the rk seed as a fallback for old fabs (re-creates the two-owner policy drift this change exists to end).
*Introduced by*: 260912-pfo3-drop-operator-tick-seed

### Deprecated Requirements

#### Idempotent role-entry seeding with the narrow upgrade (memory `run-kit/cron`)
**Reason**: the seed and its `EnsureRoleEntry` helper move out of rk; fab's clock reconcile seeds on zero `role:operator` rows and tunes via `rk cron edit`.
**Migration**: fab-kit `operator_clock.go` `ensureOperatorCronRow` (v2.26.2); the `role:operator` row stays the cross-repo idempotency key.

#### `rk operator` seeds the operator-tick entry before its singleton probe
**Reason**: ownership handover — rk defines the schema and evaluator; the consumer (fab) seeds and tunes its entry.
**Migration**: N/A for rk; `fab operator clock sync` and every fab reconcile entry point seed a missing entry.

## Tasks

### Phase 1: Code removal

- [x] T001 `app/backend/cmd/rk/operator.go`: delete the `seedOperatorTick(cmd, serverLabel)` call and its comment block, `seedOperatorTick`, `operatorTickEntrySpec`, and the `rk/internal/cron` import; reword the `serverLabel` comment to name only the kickoff addressing and receipt <!-- R1, R2 -->
- [x] T002 `app/backend/cmd/rk/operator_test.go`: delete the `// --- Operator-tick seeding ---` section (three tests), the `-L` test's trailing `cron.LoadEntries` seed assertion and its doc-comment clause, the `cronDir`/`cronDirErr` seam fields + overrides + restore in `stubOperatorSeams`, the `ValidSlug` clause on `operatorTestSocket`, and any import left unused <!-- R4 -->
- [x] T003 `app/backend/internal/cron/store.go` + `store_test.go`: delete `EnsureRoleEntry` with its doc comment; delete `roleTickSpec`, `roleTickSpecWithDebounce`, and the eight `TestEnsureRoleEntry*` tests, keeping `TestMuteWriteRules` and `TestUpdateMergesFields` intact; drop any import left unused <!-- R3, R4 -->

### Phase 2: Documentation

- [x] T004 Update `docs/specs/cron.md` (debounce bullet, P1.5 STEP 2, L592 parenthetical), `docs/site/cron-schedule-kinds.md` (the "plants the entry today" sentence), and `docs/site/skill/cron.md` (the seeded-on-every-server clause) to present truth; check the two `docs/site` files against `shll standards skill` / `readme-extraction` <!-- R5 -->

### Phase 3: Verification

- [x] T005 From `app/backend`: `go vet ./...`, `go test ./cmd/rk/ ./internal/cron/`, and `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`; then `grep -rn 'EnsureRoleEntry\|seedOperatorTick\|operatorTickEntrySpec' app/backend` must return nothing <!-- R1, R3, R4 -->

## Execution Order

- T001–T003 are independent files but T005 depends on all three; run T001 → T002 → T003 → T004 → T005

## Acceptance

### Functional Completeness

- [x] A-001 R1: `operator.go` contains no `seedOperatorTick`, `operatorTickEntrySpec`, or `rk/internal/cron` import, and `runOperator` proceeds from `serverLabel` straight to the context timeout
- [x] A-002 R3: `EnsureRoleEntry` is absent from `app/backend` (source and tests) and `internal/cron`'s remaining exported API is unchanged
- [x] A-003 R5: the three docs describe fab as the seeder and `rk operator` as launcher-only

### Behavioral Correctness

- [x] A-004 R1: `TestOperatorServerFlagCreatesWithoutTMUX` still verifies the `-L` probe, stamp, delivery, and report without any cron-entry assertion
- [x] A-005 R2: the `serverLabel` comment names only the kickoff/receipt consumers

### Removal Verification

- [x] A-006 R4: no `TestOperatorSeed*` or `TestEnsureRoleEntry*` test names remain; `roleTickSpec*` fixtures are gone; `cronDir`/`cronDirErr` are gone from the operator test seams struct
- [x] A-007 R4: `cronDirFn`, `cronTmuxPaneFn`, `cronNowFn` remain in `cron.go` and `cron_test.go` still compiles against them

### Scenario Coverage

- [x] A-008 R4: `go test ./cmd/rk/ ./internal/cron/` passes from `app/backend`
- [x] A-009 R4: `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` passes

### Edge Cases & Error Handling

- [x] A-010 R1: `TestOperatorSeedFailureIsNonFatal`'s surviving concern — the window still opens when a best-effort step fails — is covered by the remaining kickoff-degrade tests; no stderr path references "could not seed"

### Code Quality

- [x] A-011 Pattern consistency: deletions leave no orphaned comments narrating the removed seed (grep `seed` in `operator.go`/`operator_test.go` returns only unrelated hits or nothing)
- [x] A-012 No unnecessary duplication: no replacement helper was introduced
- [x] A-013 Comment discipline: no comment cites a change ID or PR number, none narrates "removed"/"no longer"

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change is itself the deletion pass (the rk-side seed, its tests, and `EnsureRoleEntry`); every symbol the removed code consumed (`cron.ValidSlug`, `cron.CreatedBy`, `RoleOperator`, `cronDirFn`/`cronTmuxPaneFn`/`cronNowFn`) retains live callers (`cron.go`, `cron_add.go`, `push_url.go`, `dir.go`), so no further redundancy was discovered.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Five tasks grouped by package (operator.go / operator_test.go / internal/cron / docs / verification) | Each is one focused deletion session; the intake enumerates every site | S:90 R:95 A:95 D:90 |
| 2 | Confident | `docs/site` edits are minimal rewordings, checked against `shll standards` rather than restructured | Constitution § Toolkit Standards binds the surface; the change alters one clause per file | S:70 R:90 A:80 D:80 |
| 3 | Certain | Memory updates are deferred to hydrate; apply touches spec + site only | Pipeline stage ownership; intake lists memory under Affected Memory | S:90 R:95 A:95 D:95 |

3 assumptions (2 certain, 1 confident, 0 tentative).
