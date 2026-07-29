# Plan: Desktop Shell Release CI

**Change**: 260729-5uae-desktop-shell-release-ci
**Intake**: `intake.md`

## Requirements

### Release CI: Job-Level Outputs on `release`

#### R1: `release` job exposes `tag` and `version` as job outputs
The existing `release` job in `.github/workflows/release.yml` MUST declare job-level `outputs` promoting the step-local `steps.version.outputs.tag` and `steps.version.outputs.version` (from the `Extract version from tag` step, which already resolves both trigger paths) so downstream jobs can consume them. No other part of the `release` job SHALL change.

- **GIVEN** a tag-push or workflow_dispatch run where the `release` job completes
- **WHEN** a downstream job references `needs.release.outputs.tag` / `needs.release.outputs.version`
- **THEN** it receives the resolved tag (e.g. `v0.5.0`) and version (e.g. `0.5.0`) regardless of trigger path

### Release CI: `desktop-macos` Job

#### R2: `desktop-macos` job exists with correct dependency, runner, and checkout ref
A new `desktop-macos` job MUST be appended after the `release` job with `needs: release` and `runs-on: macos-latest`. Its checkout step MUST use `ref: ${{ needs.release.outputs.tag }}` (never `github.ref` — on workflow_dispatch the tag is created inside the release job, so the triggering ref is pre-bump main). It MUST reuse the exact action SHA pins already in the workflow: checkout v4 (`34e11487…`), setup-node v4 (`49933ea5…`) with **node-version 22**, pnpm/action-setup v4 (`fc06bc12…`) with version 9. Node 22 (not the 20 used by the frontend jobs) is required by the desktop package itself: `app/desktop/package.json` declares `engines.node >=22.12.0`, and the lockfile pins `electron@43.2.0` / `@electron/rebuild@4.2.0` with the same constraint — pnpm only *warns* on the mismatch (no `.npmrc` sets `engine-strict`), so a node-20 runner would run the whole packaging path on an unsupported Node and fail late, after the release/tap have published. No `fetch-depth: 0` (shallow checkout is sufficient — the version rides the job output). No extra `if:` (when `release` is skipped, `needs: release` skips this job automatically).

- **GIVEN** a workflow_dispatch release where `scripts/release.sh` created the tag inside the `release` job
- **WHEN** `desktop-macos` runs
- **THEN** it checks out the tag the release packaged, not the pre-bump main ref
- **GIVEN** a workflow_dispatch run off main where `release` is skipped by its `if:` guard
- **WHEN** the workflow evaluates `desktop-macos`
- **THEN** the job is skipped automatically via `needs: release`

#### R3: DMGs are built ad-hoc-signed with the release-job version injected
The job MUST run `pnpm install --frozen-lockfile` and `pnpm run compile` in `app/desktop`, then `pnpm exec electron-builder --mac --publish never --config.extraMetadata.version="${{ needs.release.outputs.version }}"` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"` in the step env. The version MUST come from the release job's output (never `git describe` — a shallow CI checkout can't be trusted for tag description), keeping the DMG version identical to the server-binary version by construction. `identity: null` in `electron-builder.yml` produces the ad-hoc signature.

- **GIVEN** a release for tag `v0.5.0`
- **WHEN** the Build DMGs step completes
- **THEN** `app/desktop/release/` contains `run-kit-desktop-0.5.0-arm64.dmg` and `run-kit-desktop-0.5.0-x64.dmg`, ad-hoc signed, with electron-builder never having hunted for signing certs on the runner

#### R4: Ad-hoc signature is verified in CI
A `codesign -dv` verification step MUST run against the built `.app` bundles under `app/desktop/release/mac*/` (the signature lives on the app bundle, not the DMG container), so a build that silently lost its ad-hoc signature (the known electron-builder regression risk) fails CI loudly.

- **GIVEN** electron-builder produced `.app` bundles under `app/desktop/release/mac*/`
- **WHEN** the Verify step runs `codesign -dv` on each
- **THEN** the step exits non-zero (failing the job) if any bundle is unsigned

#### R5: DMGs are attached to the GitHub Release
An upload step MUST run `gh release upload "${{ needs.release.outputs.tag }}" app/desktop/release/*.dmg --clobber` with `GH_TOKEN: ${{ github.token }}`, appending the DMGs to the release softprops already created without touching the generated release notes. The workflow-level `permissions: contents: write` already covers this; `gh` is preinstalled on GitHub-hosted macOS runners.

- **GIVEN** the `release` job created the GitHub Release for the tag
- **WHEN** the Attach step runs
- **THEN** both DMGs appear as assets on that release, and a re-run overwrites rather than errors (`--clobber`)

### Non-Goals

- No changes to `app/desktop/`, `scripts/build-desktop.sh`, the justfile, or the Homebrew tap/formula template — the tap step continues to reference only the server binaries.
- No notarization, auto-update, or Linux/Windows desktop targets.
- No release-notes changes (Gatekeeper "Open Anyway" docs are a release-notes concern).
- No `continue-on-error` on `desktop-macos` — a failed DMG build turns the workflow red after the release/tap have published; deliberate (surface loudly, never roll back server artifacts).
- Operational verification (test tag + workflow_dispatch run) is post-apply and out of this stage's scope.

## Tasks

### Phase 1: Setup

*(none — single-file workflow edit, no scaffolding)*

### Phase 2: Core Implementation

- [x] T001 Add job-level `outputs:` block (`tag`, `version` from `steps.version.outputs.*`) to the `release` job in `.github/workflows/release.yml` <!-- R1 -->
- [x] T002 Append the `desktop-macos` job skeleton after the `release` job: `needs: release`, `runs-on: macos-latest`, checkout @ pinned SHA with `ref: ${{ needs.release.outputs.tag }}`, setup-node @ pinned SHA (node 22 — desktop package `engines.node >=22.12.0`), pnpm/action-setup @ pinned SHA (pnpm 9) <!-- R2 --> <!-- rework: review must-fix — node-version 20 contradicts app/desktop engines >=22.12.0 (electron 43, @electron/rebuild); R2 revised to node 22 -->
- [x] T003 Add the build steps to `desktop-macos`: `Install desktop dependencies` (frozen install in app/desktop), `Compile`, and `Build DMGs (ad-hoc signed)` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and `--config.extraMetadata.version="${{ needs.release.outputs.version }}"` <!-- R3 -->
- [x] T004 Add the `Verify ad-hoc signature` step: `codesign -dv` loop over `app/desktop/release/mac*/*.app` <!-- R4 -->
- [x] T005 Add the `Attach DMGs to release` step: `gh release upload "${{ needs.release.outputs.tag }}" app/desktop/release/*.dmg --clobber` with `GH_TOKEN: ${{ github.token }}` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Validate `.github/workflows/release.yml`: YAML well-formedness (python3 yaml.safe_load), actionlint if installed (skip silently otherwise), and confirm via `git diff` that only the `outputs:` block and the new job were added — release-job steps and the Homebrew tap step untouched <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `release` job declares `outputs.tag` and `outputs.version` mapped to `steps.version.outputs.tag` / `steps.version.outputs.version`
- [x] A-002 R2: A `desktop-macos` job exists with `needs: release`, `runs-on: macos-latest`, checkout at `ref: ${{ needs.release.outputs.tag }}`, and the exact three action SHA pins already used by the `release` job (checkout v4, setup-node v4 @ **node 22**, pnpm v4 @ pnpm 9)
- [x] A-003 R3: The job installs with `--frozen-lockfile`, compiles, and runs `electron-builder --mac --publish never` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and version injected via `--config.extraMetadata.version` from `needs.release.outputs.version`
- [x] A-004 R4: A `codesign -dv` step verifies each `.app` bundle under `app/desktop/release/mac*/` and fails the job on an unsigned bundle
- [x] A-005 R5: A `gh release upload` step attaches `app/desktop/release/*.dmg` to `needs.release.outputs.tag` with `--clobber` and `GH_TOKEN: ${{ github.token }}`

### Behavioral Correctness

- [x] A-006 R2: `desktop-macos` carries no extra `if:` guard and no `fetch-depth: 0` — skip-propagation rides `needs: release`, and no step in the job depends on git history
- [x] A-007 R3: The desktop job derives its version exclusively from the release-job output — no `git describe` and no call to `scripts/build-desktop.sh` anywhere in the job

### Scenario Coverage

- [x] A-008 R1: Both trigger paths feed the outputs — the `Extract version from tag` step (unchanged) resolves tag-push via `${GITHUB_REF#refs/tags/}` and workflow_dispatch via `steps.create_tag.outputs.tag`, and the promoted job outputs reference that step

### Edge Cases & Error Handling

- [x] A-009 R5: A desktop-macos failure turns the workflow red after the release/tap have published — no `continue-on-error`, no rollback of server artifacts

### Code Quality

- [x] A-010 Pattern consistency: The new job matches the existing workflow style — pinned action SHAs with `# v4` trailing comments, step naming, `cd app/desktop`-style run blocks
- [x] A-011 No unnecessary duplication: No new action versions introduced; the existing `release` job, Homebrew tap step, and everything outside the two edits are byte-identical

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Place the `outputs:` block directly under the `release` job's `runs-on:` line (before `steps:`) | Job-mapping key order is semantically irrelevant in Actions YAML; adjacent-to-header placement is the conventional, most readable spot and the intake shows `outputs:` at job level without prescribing position | S:75 R:95 A:95 D:85 |
| 2 | Certain | Append `desktop-macos` at the end of the file (after the release job's last step, the Homebrew tap update) | The intake says "appended after the `release` job"; the release job runs to end-of-file, so end-of-file is the only append point that keeps the release job contiguous | S:85 R:95 A:95 D:90 |
| 3 | Certain | Adopt the intake's What Changes YAML verbatim (step names, env placement, shell loops) as the implementation | The intake is the sole design input and marks the YAML as the exact design; dispatch instructions say "follow it precisely" | S:95 R:90 A:95 D:95 |
| 4 | Confident | Validation is python3 yaml.safe_load + actionlint-if-present only — no project test suite runs | Workflow YAML is outside `source_paths`/`test_paths` (intake Impact) and the dispatch contract forbids running the full suite for this CI-only change; code-quality.md's verification gates target Go/TS source, not `.github/` | S:70 R:90 A:85 D:80 |
| 5 | Certain | `desktop-macos` pins node-version 22, superseding the "setup-node 20" in the intake and source plan | Review must-fix (rework cycle 1): `app/desktop/package.json` `engines.node >=22.12.0` + electron 43 / @electron/rebuild lockfile constraints; node 20 only warns at install then fails late on an unsupported runtime. The frontend jobs' node-20 pins have no such constraint and are untouched | S:90 R:90 A:95 D:90 |

5 assumptions (4 certain, 1 confident).
