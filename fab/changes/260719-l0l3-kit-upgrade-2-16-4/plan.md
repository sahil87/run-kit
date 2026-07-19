# Plan: fab-kit Upgrade 2.16.3 → 2.16.4

**Change**: 260719-l0l3-kit-upgrade-2-16-4
**Intake**: `intake.md`

## Requirements

<!-- Verification-only change: the entire diff is ALREADY present, uncommitted,
     in the working tree (3 files). Apply MUST NOT re-run `fab upgrade-repo` and
     MUST NOT edit any of the three files. Requirements are stated as the
     verifiable post-upgrade conditions the working tree must satisfy. -->

### Toolkit Metadata: fab-kit Version Bump 2.16.3 → 2.16.4

#### R1: `fab/.fab-version` names 2.16.4
The working tree file `fab/.fab-version` SHALL read exactly `2.16.4` (the upgrade was pre-applied; apply verifies, it does not edit).

- **GIVEN** the fab-kit upgrade 2.16.3 → 2.16.4 was already executed in this worktree
- **WHEN** apply reads `fab/.fab-version`
- **THEN** its sole content is `2.16.4`
- **AND** apply performs no write to the file

#### R2: `fab/.kit-migration-version` names 2.16.4
The working tree file `fab/.kit-migration-version` SHALL read exactly `2.16.4`.

- **GIVEN** the upgrade was already executed
- **WHEN** apply reads `fab/.kit-migration-version`
- **THEN** its sole content is `2.16.4`
- **AND** apply performs no write to the file

#### R3: `config.yaml` reference-fence header names kit 2.16.4
The `fab/project/config.yaml` auto-regenerated reference-fence header comment SHALL name kit 2.16.4 — `# >>> fab reference (kit 2.16.4) >>>` — with no other config values changed.

- **GIVEN** the upgrade regenerated the reference fence
- **WHEN** apply reads `fab/project/config.yaml`
- **THEN** the fence header line reads `# >>> fab reference (kit 2.16.4) >>> ---------------------------------------`
- **AND** the `git diff` for `config.yaml` shows only that single fence-header line changed (no other config value diff)

#### R4: Working tree is scoped to exactly the three files plus this change's artifacts
The working tree SHALL show no tracked-file modifications beyond `fab/.fab-version`, `fab/.kit-migration-version`, and `fab/project/config.yaml`, plus this change's own untracked `fab/changes/260719-l0l3-kit-upgrade-2-16-4/` artifacts.

- **GIVEN** the pre-applied upgrade diff
- **WHEN** apply reads `git status --porcelain`
- **THEN** exactly the three tracked files appear as modified (` M`)
- **AND** the only untracked entry is `fab/changes/260719-l0l3-kit-upgrade-2-16-4/`

#### R5: Change type is pinned to `chore`
The change type SHALL be `chore` and pinned via `fab status set-change-type` so an explicit source survives refresh re-inference.

- **GIVEN** a toolkit-metadata version bump (canonically `chore`)
- **WHEN** apply pins the change type
- **THEN** `.status.yaml` records `change_type: chore` with an explicit source

### Non-Goals

- Removing the `providers:` field from `config.yaml` — deliberately kept as-is (presence=intent); out of scope per the intake.
- Re-running `fab upgrade-repo` or editing any of the three files — explicitly prohibited; apply is verification-only.
- Running any project test suite — `source_paths` are untouched and `fab/` is in `true_impact_exclude`.
- Any source, test, or `docs/site/` content change.

### Design Decisions

#### Verification-only apply — no auto-repair
**Decision**: Apply verifies the working tree matches the expected post-upgrade state and fails the task if any check is off; it never edits the three files or re-runs the upgrade.
**Why**: The upgrade already ran cleanly and the diff is present; re-running or hand-editing adds only risk and could diverge from what `fab upgrade-repo` produced.
**Rejected**: Re-running `fab upgrade-repo` at apply — would risk clobbering the already-correct diff and entangling unrelated regeneration; explicitly prohibited by the intake.
*Introduced by*: 260719-l0l3-kit-upgrade-2-16-4

## Tasks

<!-- Verification-only. No source edits, no file writes to the three upgrade files. -->

### Phase 1: Verification

- [x] T001 [P] Verify `fab/.fab-version` reads exactly `2.16.4` (read-only). <!-- R1 -->
- [x] T002 [P] Verify `fab/.kit-migration-version` reads exactly `2.16.4` (read-only). <!-- R2 -->
- [x] T003 [P] Verify the `fab/project/config.yaml` reference-fence header reads `# >>> fab reference (kit 2.16.4) >>>` and that `git diff` for the file shows only that single fence-header line changed. <!-- R3 -->
- [x] T004 Verify `git status --porcelain` shows exactly the three tracked files modified (`fab/.fab-version`, `fab/.kit-migration-version`, `fab/project/config.yaml`) plus only the untracked `fab/changes/260719-l0l3-kit-upgrade-2-16-4/` artifacts — no other tracked modifications. <!-- R4 -->

### Phase 2: Metadata

- [x] T005 Pin change type to `chore` via `fab status set-change-type l0l3 chore`. <!-- R5 -->

## Execution Order

- T001–T003 are independent read-only checks (parallelizable).
- T004 is a whole-tree scope check; run after T001–T003 confirm the three files.
- T005 (metadata pin) is independent of the verification checks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `fab/.fab-version` contains exactly `2.16.4`.
- [x] A-002 R2: `fab/.kit-migration-version` contains exactly `2.16.4`.
- [x] A-003 R3: `fab/project/config.yaml` fence header reads `# >>> fab reference (kit 2.16.4) >>>` and no other config value changed.
- [x] A-004 R4: `git status` shows only the three tracked files modified plus this change's own `fab/changes/260719-l0l3-kit-upgrade-2-16-4/` artifacts.
- [x] A-005 R5: `.status.yaml` records `change_type: chore` (explicit source).

### Behavioral Correctness

- [x] A-006 R3: The `config.yaml` change is confined to the single reference-fence header comment line — the `git diff` shows no functional config-value change (e.g., `providers:` unchanged and still present).

### Removal Verification

- [x] A-007 **N/A**: No requirements removed by this change.

### Scenario Coverage

- [x] A-008 R4: Apply did not re-run `fab upgrade-repo` and did not edit any of the three files (verification-only) — the working-tree diff is byte-identical to the pre-applied state.

### Edge Cases & Error Handling

- [x] A-009 R1: A failed verification fails the apply task per the standard pipeline failure path — no auto-repair edits are made.

### Code Quality

- [x] A-010 Pattern consistency: **N/A** — no code changed; only toolkit-metadata files under `fab/` (excluded from `source_paths`).
- [x] A-011 No unnecessary duplication: **N/A** — no code changed.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- No project test suites run — `source_paths` untouched, `fab/` in `true_impact_exclude`.

## Assumptions

<!-- Apply-agent record of graded decisions co-generated with ## Requirements.
     All decisions are Certain — the intake pins every point verbatim. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Apply is verification-only: no `fab upgrade-repo` re-run, no edits to the three files | Explicit and verbatim in the intake; confirmed against `git status`/`git diff` — tree matches exactly | S:95 R:90 A:95 D:95 |
| 2 | Certain | Keep `providers:` in `config.yaml` as-is; removing it is out of scope | Explicit in the intake Out-of-Scope section; trivially reversible later | S:95 R:95 A:90 D:95 |
| 3 | Certain | Change type pinned to `chore` via `fab status set-change-type` | Explicit in the intake (Assumption 3); toolkit-metadata bump is canonically chore | S:95 R:90 A:95 D:95 |
| 4 | Certain | A failed verification fails the apply task — no auto-repair | Entailed by the intake's "must NOT re-run / must NOT edit" constraint; failing is the only compliant behavior | S:75 R:85 A:90 D:90 |

4 assumptions (4 certain, 0 confident, 0 tentative).
