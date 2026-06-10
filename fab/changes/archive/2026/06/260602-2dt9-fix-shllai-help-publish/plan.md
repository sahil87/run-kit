# Plan: Fix shll.ai help-tree publish — run-kit.json never lands

**Change**: 260602-2dt9-fix-shllai-help-publish
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Release: shll.ai help-tree publish step

#### R1: Destination directory guaranteed before copy
The publish step SHALL ensure the destination directory `/tmp/shll-ai/help/` exists before copying `help/run-kit.json` into it.

- **GIVEN** a freshly-cloned `sahil87/shll.ai` working tree whose `help/` directory does not exist at the cloned commit
- **WHEN** the publish step copies `help/run-kit.json` to `/tmp/shll-ai/help/run-kit.json`
- **THEN** the copy SHALL succeed because `mkdir -p /tmp/shll-ai/help` ran immediately before it
- **AND** the operation SHALL remain idempotent if `help/` already exists

#### R2: Internal produce/copy failures fail the Release job
A failure in producing or copying the help tree (missing release binary, `rk help-dump` error, invalid JSON, or a failed `cp`) is an internal defect of this repo's build and SHALL fail the Release job with a `::error::` annotation — never be swallowed by the best-effort wrapper.

- **GIVEN** the `cp help/run-kit.json /tmp/shll-ai/help/run-kit.json` fails (e.g. source missing, or destination still unwritable)
- **WHEN** the publish step runs
- **THEN** the step SHALL emit a `::error::` annotation and exit non-zero, failing the Release job
- **AND** the failure SHALL NOT be reachable by the "unchanged — nothing to publish" guard (that guard's `return 0` can no longer mask a copy failure)

#### R3: External clone/PR/merge interactions stay best-effort
The cross-repo interactions — `git clone` of shll.ai, `gh pr create`, and `gh pr merge --auto` — SHALL remain tolerant: an unreachable shll.ai, a missing repo-level auto-merge setting, or a pre-existing same-version branch SHALL log a warning and leave any opened PR for manual merge, never failing the already-published release.

- **GIVEN** shll.ai is unreachable, or auto-merge is disabled, or the `rk-help-dump-<version>` branch already exists from a prior attempt
- **WHEN** the best-effort `publish_to_shllai` function runs
- **THEN** the failure SHALL surface as a `::warning::` (or informational `echo`) and the Release job SHALL still succeed

#### R4: The "unchanged → nothing to publish" no-diff guard remains a legitimate clean skip
The no-diff guard SHALL stay, but is only reachable after a genuinely successful produce+copy. A true identical-tree no-op (help tree identical to last release) SHALL still `return 0` as a legitimate skip, not an error.

- **GIVEN** a successful produce+copy where the copied `help/run-kit.json` is byte-identical to what shll.ai already has
- **WHEN** `git status --porcelain help/run-kit.json` reports no change
- **THEN** the step SHALL print "unchanged since last release — nothing to publish." and the job SHALL succeed without opening a PR

#### R5: Observability of resolved paths and post-copy state
The publish step SHALL echo the resolved source and destination paths before the copy, and run `ls -l /tmp/shll-ai/help/run-kit.json` immediately after, so any future failure is greppable in the run log.

- **GIVEN** the publish step runs (success or failure)
- **WHEN** the produce+copy phase executes
- **THEN** the run log SHALL contain the resolved source path, the resolved destination path, and a `ls -l` of the copied file on success

### Non-Goals
- No backfill of `v2.1.8` — the next tagged release publishes `run-kit.json`.
- The producer (`app/backend/cmd/rk/help_dump.go`, `root.go` wiring, the `mkdir -p help && rk help-dump … && jq empty` lines) is unchanged — already correct and tested.
- No change to `sahil87/shll.ai` (the consumer repo).

### Design Decisions
1. **Hoist produce + clone + copy out of the best-effort function so `set -e` (`bash -e`) applies**: the `rk help-dump`, `jq empty`, `git clone`, `mkdir -p`, and `cp` all run at the top level of the `run:` block where `bash -e` makes any non-zero exit fatal. — *Why*: the cleanest way to make internal defects fatal is to remove them from the `if publish_to_shllai` context that neutralizes `set -e`. The `git clone` is the one external op that must be fatal-adjacent only because the copy depends on it — but per R3 a clone failure should stay best-effort. — *Resolved*: keep `git clone` inside the best-effort function (external), and move only the `mkdir -p` + `cp` + observability into a fatal block guarded by an explicit `|| { echo "::error::…"; exit 1; }`. See Assumptions row 1. — *Rejected*: hoisting the clone out (would make an unreachable shll.ai fatal, violating R3).
2. **Guard the `cp` with an explicit `|| { echo "::error::…"; exit 1; }` rather than relying solely on `set -e`**: makes the fatal intent self-documenting and emits a GitHub error annotation. — *Why*: matches the intake's "fail loudly" directive and the `::error::`/`::warning::` annotation idiom already used in the step. — *Rejected*: bare reliance on `set -e` inside the function (the function's return is consumed by `if`, which suppresses `set -e`).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Restructure the `Publish help tree to shll.ai` step in `.github/workflows/release.yml` so the clone+copy of `help/run-kit.json` into `/tmp/shll-ai/help/` is fatal: clone shll.ai at top level (best-effort warn+exit-skip if unreachable, per R3), then `mkdir -p /tmp/shll-ai/help`, echo resolved src/dest paths, `cp` guarded with `|| { echo "::error::…"; exit 1; }`, and a post-copy `ls -l`. Keep `git checkout/commit/push`, `gh pr create`, and `gh pr merge --auto` best-effort with `|| return 1` / `|| echo …`. Preserve the "unchanged → nothing to publish" `return 0` guard, now only reachable after a successful copy. <!-- R1 R2 R3 R4 R5 -->

## Acceptance

### Functional Completeness
- [x] A-001 R1: `mkdir -p /tmp/shll-ai/help` runs immediately before the `cp`, so the destination directory always exists.
- [x] A-002 R2: A failed `cp` (or missing source) emits a `::error::` annotation and exits non-zero — it is NOT swallowed by `if publish_to_shllai` and cannot reach the "unchanged" `return 0`. (Dry-run Case C: missing source → `::error::` + exit 1.)
- [x] A-003 R3: `git clone`, `gh pr create`, and `gh pr merge --auto` remain tolerant (`|| return 1` / `|| echo …`); an external hiccup logs a warning and the release succeeds. (Unchanged in the diff — preserved.)
- [x] A-004 R4: The "unchanged since last release — nothing to publish." `return 0` guard is preserved and only reachable after a successful produce+copy.
- [x] A-005 R5: The step echoes resolved source/destination paths and runs `ls -l /tmp/shll-ai/help/run-kit.json` after the copy.

### Behavioral Correctness
- [x] A-006 R1 R2: A local dry-run (clone shll.ai read-only + locally-built `rk` help-dump + the new `mkdir -p` + `cp` sequence) produces `/tmp/shll-ai/help/run-kit.json` and passes `jq empty`, proving the destination-dir fix resolves the `No such file or directory` failure from CI run 26816371162. (Case A reproduced the old failure then proved the fix; Case B proved idempotence when `help/` already exists.)

### Code Quality
- [x] A-007 R2 R3: The step matches surrounding YAML/shell style (indentation, comment density, `::error::`/`::warning::` idiom) and preserves the existing security posture — explicit `gh` args, `SHLLAI_TOKEN` interpolation mirroring the established convention, no untrusted shell-string interpolation. Step stays LAST in the job (verified via YAML parse: last step = "Publish help tree to shll.ai").
- [x] A-008 R1 R2 R3 R4 R5: `.github/workflows/release.yml` parses as valid YAML (python yaml.safe_load: OK); `actionlint` run (installed via `go install`): exit 0, no findings.

## Notes

Verification for this change is observational, not test-runner-based: GitHub Actions YAML is not exercised by `go test`/`vitest`/Playwright (intake Assumption #6, repo has no CI-workflow test harness). Verify via (a) YAML parse + actionlint-if-available, and (b) a local read-only dry-run of the new `mkdir -p` + `cp` logic against a real shll.ai clone with a locally-built `rk`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Keep `git clone` INSIDE the best-effort function (external, per R3); make only `mkdir -p` + `cp` fatal via explicit `\|\| { echo "::error::…"; exit 1; }`, kept at top level of the function but with a fatal guard rather than `\|\| return 1` | Intake step 3 lists clone as best-effort; the copy is the internal defect that must be fatal. An explicit `exit 1` inside the function fails the whole `run:` block regardless of the `if` wrapper, so it satisfies R2 without hoisting the clone out (which would wrongly make an unreachable shll.ai fatal, violating R3). | S:85 R:80 A:88 D:78 |
| 2 | Confident | Resolved source path is `help/run-kit.json` (relative to repo checkout, already produced by the unchanged producer lines ~176-178); resolved dest is `/tmp/shll-ai/help/run-kit.json` | These exact paths are in the current file and the intake; echoing `$PWD/help/run-kit.json` and the dest literal is the minimal observability that makes a future failure greppable | S:90 R:85 A:90 D:85 |
| 3 | Certain | No automated test asserts this (GH Actions YAML has no test harness); verification is YAML-parse + actionlint-if-available + local cp dry-run | Carried from intake Assumption #6; constitution test mandate targets Go/TS app code, not `.github/` YAML | S:82 R:80 A:88 D:78 |
