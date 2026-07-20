# Plan: Install Docs Policy B Conformance

**Change**: 260720-ec6i-install-docs-policy-b
**Intake**: `intake.md`

## Requirements

### Install Docs: README.md

#### R1: Install section drops the per-formula escape hatch
The README Install section (line 17) MUST NOT carry the per-formula `brew install sahil87/tap/run-kit` escape-hatch sentence. The replacement sentence is the verbatim wt/hop/idea/tu wording: "Installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically. To install the entire shll toolkit instead:". Both curl bootstrap blocks SHALL stay unchanged.

- **GIVEN** README.md's Install section
- **WHEN** the edit is applied
- **THEN** the prose between the two curl blocks reads exactly the sibling-repo wording with no `brew install` mention
- **AND** both `curl -fsSL https://shll.ai/install | sh …` blocks are byte-identical to before

#### R2: Quick start prose uses the subset-install form
The README Quick start prose (line 36) MUST replace the `brew install sahil87/tap/wt` fragment with `shll install wt`, keeping the rest of the sentence intact.

- **GIVEN** the Quick start sentence about `wt` on `PATH`
- **WHEN** the edit is applied
- **THEN** it reads "— included with the full-toolkit install, or `shll install wt` — and your agent CLI available."

#### R3: Troubleshooting wt-not-found entry points to shll install + shll.ai
The README Troubleshooting entry (line 267) MUST replace both the per-formula `brew install sahil87/tap/wt` pointer and the retired `sahil87/tap/all` meta-formula reference. The entry itself stays; only its install pointer changes to: "install `wt` via `shll install wt`, or install the full toolkit from [https://shll.ai](https://shll.ai)."

- **GIVEN** the Troubleshooting "wt not found" bullet
- **WHEN** the edit is applied
- **THEN** it names `shll install wt` and links https://shll.ai, with no `sahil87/tap` reference

### Install Docs: docs/site/install.md

#### R4: Install section leads with the curl bootstrap
The Install section (lines 5–13) MUST replace the "run-kit ships as a Homebrew formula" lead-in + `brew install sahil87/tap/run-kit` block with the shll.ai bootstrap lead-in + curl block per the intake's verbatim splice, merging "This puts the `run-kit` binary on your `PATH`." into the new lead sentence. Everything from "The formula also installs `rk`…" onward SHALL stay intact, including the quick-start block.

- **GIVEN** docs/site/install.md's Install section
- **WHEN** the edit is applied
- **THEN** the section leads with "Install via the [shll toolkit](https://shll.ai) bootstrap:" followed by the `curl -fsSL https://shll.ai/install | sh -s -- run-kit` block
- **AND** the following paragraph begins "This installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically, and puts the `run-kit` binary on your `PATH`. The formula also installs `rk`…"

#### R5: Prerequisites wt bullet uses the shll.ai pointer
The Prerequisites bullet (line 43) MUST replace both per-formula references (`sahil87/tap/wt`, retired `sahil87/tap/all`) with: "included with the [full-toolkit install](https://shll.ai), or `shll install wt`."

- **GIVEN** the Prerequisites `wt` bullet
- **WHEN** the edit is applied
- **THEN** it links the full-toolkit install to https://shll.ai and names `shll install wt`, with no `sahil87/tap` reference

### Non-Goals

- Binary error hints in Go source (`app/backend/cmd/rk/upgrade.go:183`) — Policy A mandates those hints in binary output; out of this docs-only scope.
- All curl bootstrap blocks, the README toolkit banner (line 3), command-reference link (line 262), Upgrade/update prose, `docs/site/skill.md:97` gating instruction, and historical references in `fab/changes/` / `docs/memory/` / changelogs — explicitly KEPT per the intake.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Edit README.md Install section (line 17): remove the "Prefer plain Homebrew? `brew install sahil87/tap/run-kit` does the same." sentence per the intake's verbatim replacement <!-- R1 -->
- [x] T002 Edit README.md Quick start prose (line 36): replace `` `brew install sahil87/tap/wt` `` with `` `shll install wt` `` <!-- R2 -->
- [x] T003 Edit README.md Troubleshooting (line 267): replace the install pointer with `shll install wt` + shll.ai link, removing the retired `sahil87/tap/all` reference <!-- R3 -->
- [x] T004 [P] Edit docs/site/install.md Install section (lines 5–13): replace the Homebrew-formula lead-in + brew block with the shll.ai bootstrap lead-in + curl block, splicing the PATH sentence per the intake <!-- R4 -->
- [x] T005 [P] Edit docs/site/install.md Prerequisites (line 43): replace with the full-toolkit shll.ai link + `shll install wt` form, removing the retired `sahil87/tap/all` reference <!-- R5 -->

### Phase 2: Verification

- [x] T006 Verify: `grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/` returns zero hits; `git diff --stat` confirms the diff is confined to README.md + docs/site/install.md <!-- R1 R2 R3 R4 R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: README Install section carries no per-formula brew sentence; prose matches the sibling-repo wording verbatim; both curl blocks unchanged
- [x] A-002 R2: README Quick start names `shll install wt` in place of the brew fragment
- [x] A-003 R3: README Troubleshooting wt-not-found entry points to `shll install wt` and https://shll.ai
- [x] A-004 R4: docs/site/install.md Install section leads with the shll.ai bootstrap curl block and the spliced PATH sentence; everything from "The formula also installs `rk`…" onward intact
- [x] A-005 R5: docs/site/install.md Prerequisites wt bullet uses the full-toolkit shll.ai link + `shll install wt`

### Removal Verification

- [x] A-006 R3: No `sahil87/tap/all` (retired meta-formula) reference remains in README.md or docs/site/
- [x] A-007 R1: `grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/` returns zero hits

### Behavioral Correctness

- [x] A-008 R4: Heading structure of README.md and docs/site/install.md is unchanged (shll.ai extraction anchors unaffected)

### Code Quality

- [x] A-009 Pattern consistency: Replacement wording matches the conformant sibling READMEs (wt/hop/idea/tu)
- [x] A-010 No unnecessary duplication: Diff confined to the two documented files; no code, tests, or other content touched

## Notes

- Docs-only change (change_type: docs) — no test suite run; verification is the audit grep + diff-stat confinement check.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|

0 assumptions.
