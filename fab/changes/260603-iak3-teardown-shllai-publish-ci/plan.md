# Plan: Teardown shll.ai Help-Tree Publish CI (Push → Pull Migration)

**Change**: 260603-iak3-teardown-shllai-publish-ci
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

<!-- Change type: ci. shll.ai inverted its integration model from push (tool
     repos PR their help JSON into shll.ai) to pull (shll.ai runs `<tool> help-dump`
     on a schedule). run-kit must remove the obsolete push transport while
     preserving `rk help-dump` as the single contract surface shll.ai now pulls. -->

### CI: Release Pipeline Push Transport Removal

#### R1: Remove the shll.ai push transport from the release workflow
The `release` job in `.github/workflows/release.yml` SHALL NOT contain the `Publish help tree to shll.ai` step. Removing this single self-contained step eliminates all four directive components at once: the producer CI (`rk help-dump help/run-kit.json` + `jq empty`), the PR-opening logic (`publish_to_shllai()` clone/branch/commit/push + `gh pr create`), the auto-merge wiring (`gh pr merge --auto --squash`), and the `SHLLAI_TOKEN` usage (`env: SHLLAI_TOKEN` + every `$SHLLAI_TOKEN` reference). The step's leading explanatory comment block (the "Placed LAST in the job…" comment) SHALL be removed with it, since it only describes that step.

- **GIVEN** the current `release.yml` whose final step is `Publish help tree to shll.ai`
- **WHEN** the change is applied
- **THEN** that step and its leading comment block are gone
- **AND** `grep` over `.github/workflows/` finds zero references to `SHLLAI_TOKEN`, `shll.ai`, or `help/run-kit.json`

#### R2: The release workflow remains a valid, intact workflow
After removing the step, `.github/workflows/release.yml` SHALL remain valid, parseable YAML, and the `release` job's final remaining step SHALL be `Update Homebrew tap`. All steps prior to the removed one (checkout, tag, setup-go/node/pnpm, build, cross-compile, GitHub Release, Homebrew tap) SHALL be unchanged, and the job's `permissions: contents: write` and `concurrency` blocks SHALL be untouched (they were never specific to the publish step).

- **GIVEN** the edited `release.yml`
- **WHEN** parsed by a YAML parser
- **THEN** it parses without error
- **AND** the last step's `name` is `Update Homebrew tap`
- **AND** no earlier step or top-level key is altered

#### R3: Preserve `rk help-dump` as the single contract surface (verify-only)
The hidden Cobra subcommand `help-dump` (`app/backend/cmd/rk/help_dump.go`) and its tests (`app/backend/cmd/rk/help_dump_test.go`) MUST NOT be modified. After the change, `rk help-dump` MUST still exit 0, emit valid JSON to stdout, report `schema_version: 1`, and report `tool: rk`. No code change is required to preserve this — leaving the files untouched preserves it by definition; this requirement is satisfied by verification, not modification.

- **GIVEN** the unmodified `help_dump.go` / `help_dump_test.go`
- **WHEN** the `rk` binary is built and `rk help-dump` is run
- **THEN** it exits 0 with valid JSON on stdout where `schema_version == 1` and `tool == "rk"`
- **AND** `go vet ./...` passes and the help-dump tests pass unchanged

### Non-Goals

- shll.ai's site-side pull job (scheduled `rk help-dump` capture / Astro loader) — lives in the separate `sahil87/shll.ai` repo, not here.
- Any change to the `help-dump` JSON shape, schema version, or command behavior.
- Other toolkit repos' teardowns (idea, hop, fab-kit, wt, tu, shll) — each is its own PR.
- Deleting the `SHLLAI_TOKEN` GitHub repo secret — a repo-settings (out-of-tree) operator follow-up noted in the PR body, not a code change here.
- Reconciling `docs/memory/run-kit/architecture.md` — a hydrate-stage activity, not apply.

### Design Decisions

1. **Delete the whole step rather than trim individual lines**: run-kit implemented the entire push path as one self-contained final step, so a single deletion cleanly satisfies all four directive components. — *Why*: minimizes blast radius and leaves no orphaned shell fragments. — *Rejected*: surgically editing lines within the step (more error-prone, leaves dead scaffolding).
2. **Preserve `rk help-dump` untouched**: the directive's Critical Preservation Rule names it as the single contract surface shll.ai pulls from. — *Why*: removing the transport, never the command. — *Rejected*: refactoring/relocating the command (out of scope, would risk the contract surface).
3. **Security posture (Constitution §I — Security First)**: this change strictly *reduces* attack surface. It removes a cross-repo write secret (`SHLLAI_TOKEN`) clone + `gh` invocation that wrote into an external repo on every release. With shll.ai pulling, the push side is dead weight that holds a least-privilege-violating write-scoped token with no remaining consumer. Removal aligns with §I and least-privilege.

### Deprecated Requirements

#### shll.ai help-tree push publish (from `260602-a36m-help-dump-shll-ai`, hardened in `260602-2dt9-fix-shllai-help-publish`)
**Reason**: shll.ai moved to a pull model (it now invokes `rk help-dump` on a schedule). The push transport is redundant and a redundant attack surface; dual writers to `help/run-kit.json` race.
**Migration**: shll.ai pulls via its own scheduled `rk help-dump` capture in the `sahil87/shll.ai` repo. run-kit's contract obligation is now solely to keep `rk help-dump` working (R3).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Delete the `Publish help tree to shll.ai` step (and its leading "Placed LAST in the job…" comment block) from `.github/workflows/release.yml` so the job's final step becomes `Update Homebrew tap`; match surrounding YAML style and leave all prior steps and top-level keys untouched. <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Validate `.github/workflows/release.yml` still parses as YAML (using `yq`, since pyyaml is unavailable) and confirm the last step is `Update Homebrew tap`. <!-- R2 -->
- [x] T003 Grep `.github/workflows/` to confirm zero remaining references to `SHLLAI_TOKEN`, `shll.ai`, or `help/run-kit.json`. <!-- R1 -->
- [x] T004 Verify the preserved contract surface unchanged: build `rk` and run `rk help-dump`, asserting exit 0, valid JSON on stdout, `schema_version == 1`, `tool == "rk"`; run `go vet ./...` and the help-dump tests (the `cmd/rk` package tests cover all `TestBuildDump*`/`TestCaptureNode*` help-dump tests). Do NOT modify `help_dump.go` / `help_dump_test.go`. <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `Publish help tree to shll.ai` step and its leading comment block are removed from `.github/workflows/release.yml`; all four directive components (producer CI, PR-opening logic, auto-merge wiring, `SHLLAI_TOKEN` usage) are gone.
- [x] A-002 R2: `.github/workflows/release.yml` parses as valid YAML and the `release` job's final step is `Update Homebrew tap`, with all prior steps and top-level keys unchanged.
- [x] A-003 R3: `rk help-dump` (built binary) exits 0, emits valid JSON to stdout with `schema_version == 1` and `tool == "rk"`; `help_dump.go` and `help_dump_test.go` are unmodified.

### Removal Verification

- [x] A-004 R1: A grep over `.github/workflows/` returns zero matches for `SHLLAI_TOKEN`, `shll.ai`, and `help/run-kit.json` (historical matches under `fab/` and `docs/memory/` are expected and untouched).

### Scenario Coverage

- [x] A-005 R3: `go vet ./...` passes and the help-dump tests pass unchanged.

### Security

- [x] A-006 R1: No remaining workflow code references the `SHLLAI_TOKEN` cross-repo write secret; the change strictly reduces attack surface per Constitution §I (Security First). Deleting the GitHub repo secret itself is an out-of-tree operator follow-up noted in the PR body.

### Code Quality

- [x] A-007 Pattern consistency: The edited `release.yml` matches surrounding YAML style (indentation, step structure); no orphaned shell fragments or dangling comments remain.
- [x] A-008 No unnecessary duplication: No new utilities introduced; this is a pure deletion.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove the entire `Publish help tree to shll.ai` step as one deletion to satisfy all four directive components | Directive is prescriptive; run-kit implemented the whole push path as one self-contained final step (verified in `release.yml` lines ~160–254) | S:98 R:80 A:95 D:96 |
| 2 | Certain | Remove the step's leading "Placed LAST in the job…" comment block along with the step | The comment exclusively documents the removed step; leaving it would be a dangling, now-false comment | S:95 R:85 A:95 D:95 |
| 3 | Certain | Do NOT modify `help_dump.go` / `help_dump_test.go` — preserved as the contract surface; satisfied by verify-only | Directive's explicit Critical Preservation Rule; removing only the transport, never the command | S:98 R:85 A:95 D:97 |
| 4 | Certain | Use `yq` for YAML validation (pyyaml is not installed in this environment) | Environment probe: `python3 -c 'import yaml'` fails (ModuleNotFoundError); `yq v4.53.2` is available | S:95 R:90 A:95 D:92 |
| 5 | Confident | Deleting the LAST step of the `release` job cannot affect the GitHub Release or Homebrew tap; release path preserved | The step was deliberately placed last and documented best-effort; both artifacts are produced earlier in the job | S:88 R:80 A:90 D:88 |
| 6 | Confident | `docs/memory/run-kit/architecture.md` reconciliation is deferred to hydrate, not done at apply | Memory hydration is a hydrate-stage activity per the fab pipeline; apply touches code/CI only (per intake Affected Memory + task directive) | S:85 R:88 A:88 D:85 |

6 assumptions (4 certain, 2 confident, 0 tentative).
