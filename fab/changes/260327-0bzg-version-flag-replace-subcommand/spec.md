# Spec: Replace `rk version` Subcommand with `--version` / `-v` Flag

**Change**: 260327-0bzg-version-flag-replace-subcommand
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/architecture.md`

## CLI: Version Flag

### Requirement: Version via Global Flag

The `rk` CLI SHALL expose version information via Cobra's built-in `--version` and `-v` global flags on the root command. The `version` subcommand SHALL be removed.

#### Scenario: User runs `rk --version`
- **GIVEN** the `rk` binary is built with version `0.5.0` via ldflags
- **WHEN** the user runs `rk --version`
- **THEN** stdout contains `rk version 0.5.0`
- **AND** the exit code is 0

#### Scenario: User runs `rk -v`
- **GIVEN** the `rk` binary is built with version `0.5.0` via ldflags
- **WHEN** the user runs `rk -v`
- **THEN** stdout contains `rk version 0.5.0`
- **AND** the exit code is 0

#### Scenario: User runs `rk version` (removed subcommand)
- **GIVEN** the `version` subcommand has been removed
- **WHEN** the user runs `rk version`
- **THEN** Cobra outputs an unknown command error
- **AND** the exit code is non-zero

### Requirement: Output Format Preserved

The version output format SHALL remain `rk version {version}`, matching Cobra's default version template. No custom `SetVersionTemplate` call is needed.

#### Scenario: Default dev version
- **GIVEN** the binary is built without ldflags (default `version = "dev"`)
- **WHEN** the user runs `rk --version`
- **THEN** stdout contains `rk version dev`

## Deprecated Requirements

### `version` Subcommand

**Reason**: Replaced by `--version` / `-v` global flag — the idiomatic CLI convention.
**Migration**: Use `rk --version` or `rk -v` instead of `rk version`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use Cobra's built-in `rootCmd.Version` field | Confirmed from intake #1 — Cobra natively supports `--version`/`-v` when `Version` is set | S:95 R:90 A:95 D:95 |
| 2 | Certain | Output format remains `rk version {version}` | Confirmed from intake #2 — Cobra's default template produces this format | S:90 R:95 A:90 D:95 |
| 3 | Certain | Delete `version.go` and `version_test.go` entirely | Confirmed from intake #3 — files contain only the subcommand | S:95 R:85 A:95 D:95 |
| 4 | Confident | Breaking change is acceptable | Confirmed from intake #4 — pre-1.0 tool, user explicitly requested | S:85 R:70 A:75 D:85 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
