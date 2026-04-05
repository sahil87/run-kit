# Spec: Rename CLI Binary to rk

**Change**: 260323-ycod-rename-cli-to-rk
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Renaming the GitHub repository (`wvrdz/run-kit` stays as-is) — avoids breaking stars, forks, links
- Changing environment variable prefixes (`RK_*`) — already match the new name
- Changing daemon socket name (`rk-daemon`) or tmux session (`rk`) — already use `rk` prefix
- Renaming frontend test fixture data that uses "run-kit" as sample session names — example data, not CLI identity
- Providing a migration path from `~/.run-kit/` to `~/.rk/` — early-stage project with few users

## CLI: Binary Name

### Requirement: Binary SHALL be named `rk`

The compiled Go binary SHALL be named `rk`. The Cobra root command `Use` field SHALL be `"rk"`. All user-facing output (version strings, status messages, error messages) SHALL reference `rk`, not `run-kit`.

#### Scenario: Version output
- **GIVEN** the `rk` binary is installed
- **WHEN** the user runs `rk version`
- **THEN** the output SHALL be `rk version {semver}`

#### Scenario: Daemon status messages
- **GIVEN** the user runs `rk serve -d`
- **WHEN** the daemon starts successfully
- **THEN** the output SHALL say `rk daemon started on {host}:{port}`

#### Scenario: Daemon already running
- **GIVEN** a daemon is already running
- **WHEN** the user runs `rk serve -d`
- **THEN** the output SHALL say `rk daemon already running on {host}:{port}`

## CLI: Command Directory

### Requirement: Go entrypoint SHALL be `cmd/rk/`

The Cobra CLI entrypoint directory SHALL be `app/backend/cmd/rk/`. All files currently in `cmd/run-kit/` SHALL be moved to `cmd/rk/` with no changes to file names within the directory.

#### Scenario: Directory structure after rename
- **GIVEN** the rename is complete
- **WHEN** inspecting `app/backend/cmd/`
- **THEN** only `cmd/rk/` SHALL exist (no `cmd/run-kit/`)
- **AND** all files (`main.go`, `root.go`, `serve.go`, `version.go`, `upgrade.go`, `doctor.go`, `status.go`, `initconf.go`) SHALL be present in `cmd/rk/`

## Go Module: Import Path

### Requirement: Module path SHALL be `rk`

`go.mod` SHALL declare `module rk`. All import paths throughout `app/backend/` SHALL use `rk/...` instead of `run-kit/...`.

#### Scenario: Module declaration
- **GIVEN** the rename is complete
- **WHEN** reading `app/backend/go.mod`
- **THEN** the first line SHALL be `module rk`

#### Scenario: Import paths
- **GIVEN** any Go source file in `app/backend/`
- **WHEN** it imports internal packages
- **THEN** imports SHALL use `"rk/internal/..."`, `"rk/api"`, etc.
- **AND** no import SHALL reference `"run-kit/..."`

## Config: User Directory

### Requirement: Config directory SHALL be `~/.rk/`

The default tmux config path SHALL be `~/.rk/tmux.conf`. The `init-conf` subcommand description SHALL reference `~/.rk/tmux.conf`. `EnsureConfig()` SHALL write to `~/.rk/tmux.conf`.

#### Scenario: Default config path
- **GIVEN** `RK_TMUX_CONF` is not set
- **WHEN** the binary resolves the config path
- **THEN** the path SHALL be `$HOME/.rk/tmux.conf`

#### Scenario: Init-conf scaffolding
- **GIVEN** `~/.rk/tmux.conf` does not exist
- **WHEN** the user runs `rk init-conf`
- **THEN** the config file SHALL be written to `~/.rk/tmux.conf`

## Upgrade: Homebrew References

### Requirement: Upgrade command SHALL reference `wvrdz/tap/rk`

The `upgrade` subcommand SHALL check for Homebrew installation via `/Cellar/rk/` path. Brew info and upgrade commands SHALL target `wvrdz/tap/rk`. Installation instructions SHALL show `brew install wvrdz/tap/rk`.

#### Scenario: Cellar detection
- **GIVEN** `rk` was installed via Homebrew
- **WHEN** resolving the binary path
- **THEN** the path SHALL contain `/Cellar/rk/`

#### Scenario: Non-Homebrew installation
- **GIVEN** `rk` was not installed via Homebrew
- **WHEN** the user runs `rk upgrade`
- **THEN** the output SHALL suggest `brew install wvrdz/tap/rk`

## Build: Artifact Naming

### Requirement: Build output SHALL be `rk`

`scripts/build.sh` SHALL output the binary to `dist/rk`. The build source SHALL be `./cmd/rk`.

#### Scenario: Local build
- **GIVEN** the user runs `scripts/build.sh`
- **WHEN** the build completes
- **THEN** the binary SHALL exist at `dist/rk`
- **AND** echo messages SHALL reference `rk`

### Requirement: Justfile SHALL reference `rk` paths

All justfile recipes SHALL use `dist/rk` for the binary path and `./cmd/rk` for `go run` invocations.

#### Scenario: Just run recipe
- **GIVEN** the user runs `just run`
- **WHEN** the recipe executes
- **THEN** it SHALL invoke `./dist/rk`

## Release: CI Artifact Naming

### Requirement: Release artifacts SHALL use `rk-{os}-{arch}` naming

The GitHub Actions release workflow SHALL produce tarballs named `rk-{os}-{arch}.tar.gz` containing a binary named `rk`.

#### Scenario: Release tarball contents
- **GIVEN** a release is triggered
- **WHEN** the workflow builds for darwin-arm64
- **THEN** it SHALL produce `rk-darwin-arm64.tar.gz`
- **AND** the tarball SHALL contain a single binary named `rk`

### Requirement: Formula template SHALL use `Rk` class

`.github/formula-template.rb` SHALL declare `class Rk < Formula`, use `bin.install "rk"`, and test with `rk version`.

#### Scenario: Formula template class
- **GIVEN** the formula template
- **WHEN** reading the class declaration
- **THEN** it SHALL be `class Rk < Formula`

### Requirement: Release workflow SHALL push `Formula/rk.rb`

The release workflow SHALL write the generated formula to `Formula/rk.rb` in the homebrew-tap repo (replacing `Formula/run-kit.rb`).

#### Scenario: Formula file path in release
- **GIVEN** a release is triggered
- **WHEN** the workflow pushes to the homebrew-tap repo
- **THEN** it SHALL write `Formula/rk.rb`
- **AND** it SHALL `git add Formula/rk.rb`

## Homebrew Tap: Formula Rename

### Requirement: Homebrew formula SHALL be `rk.rb`

In the `homebrew-tap` repo, `Formula/run-kit.rb` SHALL be renamed to `Formula/rk.rb`. The class SHALL be `Rk`. `bin.install` SHALL install `"rk"`. The test SHALL verify `rk version` output.

#### Scenario: Install via Homebrew
- **GIVEN** the user has tapped `wvrdz/tap`
- **WHEN** the user runs `brew install rk`
- **THEN** the `rk` binary SHALL be installed to the Homebrew bin path

#### Scenario: Formula test
- **GIVEN** the formula test runs
- **WHEN** executing the test block
- **THEN** `rk version` SHALL produce output matching `"rk version"`

### Requirement: Tap README SHALL reference `rk`

The homebrew-tap `README.md` formula table SHALL list `rk` instead of `run-kit`.

#### Scenario: README table
- **GIVEN** the homebrew-tap README
- **WHEN** reading the Formulas table
- **THEN** the entry SHALL show `rk` with description "Tmux session manager with web UI"

## Documentation: README

### Requirement: README SHALL show `rk` install and usage

The project README install instructions SHALL use `brew install rk`. CLI usage examples SHALL use `rk` as the command name.

#### Scenario: Install instructions
- **GIVEN** the project README
- **WHEN** reading the installation section
- **THEN** it SHALL show `brew install rk`

## Frontend: Comment Update

### Requirement: Frontend comment SHALL reference `rk`

The comment in `app/frontend/src/app.tsx` (~line 400) referencing "run-kit's tmux config" SHALL be updated to reference "rk's tmux config".

#### Scenario: Comment text
- **GIVEN** `app/frontend/src/app.tsx`
- **WHEN** reading the tmux config reset comment
- **THEN** it SHALL say "rk" not "run-kit"

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Binary name becomes `rk` | Confirmed from intake #1 — user explicitly approved | S:95 R:60 A:95 D:95 |
| 2 | Certain | Go module path changes to `module rk` | Confirmed from intake #2 — mechanical find-replace | S:90 R:70 A:90 D:90 |
| 3 | Certain | Config dir changes to `~/.rk/` | Confirmed from intake #3 — consistency with binary name | S:85 R:65 A:85 D:90 |
| 4 | Certain | GitHub repo name stays `wvrdz/run-kit` | Confirmed from intake #4 — avoid breaking links | S:90 R:90 A:90 D:95 |
| 5 | Certain | Env var prefixes stay `RK_*` | Confirmed from intake #5 — already match | S:95 R:90 A:95 D:95 |
| 6 | Certain | Daemon internals stay `rk-daemon`/`rk` | Confirmed from intake #6 — already use rk prefix | S:95 R:90 A:95 D:95 |
| 7 | Certain | Frontend test fixtures keep "run-kit" session names | Confirmed from intake #7 — example data only | S:85 R:95 A:85 D:90 |
| 8 | Confident | Homebrew tap changes committed separately | Confirmed from intake #8 — cross-repo standard practice | S:60 R:90 A:80 D:75 |
| 9 | Confident | No migration for `~/.run-kit/` | Confirmed from intake #9 — few users, low impact | S:50 R:80 A:70 D:70 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
