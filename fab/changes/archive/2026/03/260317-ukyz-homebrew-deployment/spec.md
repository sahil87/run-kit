# Spec: Homebrew Deployment System

**Change**: 260317-ukyz-homebrew-deployment
**Created**: 2026-03-18
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Building from source in the Homebrew formula — we ship prebuilt binaries only
- Windows support — cross-compilation targets darwin and linux only
- CLI flags for configuration — env vars remain the sole config mechanism
- Dev dependency checking in `run-kit doctor` — only runtime deps (tmux)
- Formula auto-update from CI — release script updates the tap manually after CI completes

## CLI: Cobra Framework

### Requirement: Cobra Root Command

The `cmd/run-kit/main.go` entry point SHALL be restructured to use Cobra as the CLI framework. The root command SHALL default to the `serve` subcommand when invoked with no arguments, preserving backwards compatibility.

#### Scenario: No-args invocation defaults to serve
- **GIVEN** run-kit is invoked with no arguments
- **WHEN** the binary executes
- **THEN** the HTTP server starts (equivalent to `run-kit serve`)

#### Scenario: Help displays subcommands
- **GIVEN** run-kit is invoked with `--help`
- **WHEN** the binary executes
- **THEN** it displays usage with subcommands: serve, version, upgrade, doctor, status

### Requirement: Serve Subcommand

`run-kit serve` SHALL start the HTTP server with the same behavior as the current `main.go` — loading config from env vars, setting up the chi router, and handling graceful shutdown via SIGINT/SIGTERM.

#### Scenario: Serve starts server
- **GIVEN** env vars `BACKEND_PORT=3000` and `BACKEND_HOST=127.0.0.1` are set
- **WHEN** `run-kit serve` is executed
- **THEN** the HTTP server listens on `127.0.0.1:3000`
- **AND** logs "server starting" with the address

### Requirement: Version Subcommand

`run-kit version` SHALL print the version string and build info. The version is injected at build time via ldflags (`-X main.version=...`). The default value for local dev builds SHALL be `"dev"`.

#### Scenario: Version from ldflags
- **GIVEN** the binary was built with `-ldflags '-X main.version=0.1.0'`
- **WHEN** `run-kit version` is executed
- **THEN** it prints `run-kit version 0.1.0`

#### Scenario: Dev version fallback
- **GIVEN** the binary was built without ldflags
- **WHEN** `run-kit version` is executed
- **THEN** it prints `run-kit version dev`

### Requirement: Upgrade Subcommand

`run-kit upgrade` SHALL detect whether the binary was installed via Homebrew or locally, and execute the appropriate update mechanism.

#### Scenario: Homebrew install detected
- **GIVEN** `os.Executable()` resolves to a path containing `/Cellar/run-kit/`
- **WHEN** `run-kit upgrade` is executed
- **THEN** it runs `brew update` followed by `brew upgrade run-kit`
- **AND** prints the old and new version

#### Scenario: Local install detected
- **GIVEN** `os.Executable()` does NOT resolve to a Homebrew Cellar path
- **WHEN** `run-kit upgrade` is executed
- **THEN** it prints "Local install detected. Run: git pull && just build"

### Requirement: Doctor Subcommand

`run-kit doctor` SHALL validate runtime dependencies only (not build dependencies). It MUST check that tmux is installed and reachable on PATH.

#### Scenario: All checks pass
- **GIVEN** tmux is installed and on PATH
- **WHEN** `run-kit doctor` is executed
- **THEN** it prints a passing status for each check
- **AND** exits 0

#### Scenario: tmux missing
- **GIVEN** tmux is NOT on PATH
- **WHEN** `run-kit doctor` is executed
- **THEN** it prints a failing status for tmux with install instructions
- **AND** exits 1

### Requirement: Status Subcommand

`run-kit status` SHALL display a quick tmux session summary without starting the web UI. It reads directly from tmux, requiring no server.

#### Scenario: Active sessions
- **GIVEN** tmux has 2 active sessions
- **WHEN** `run-kit status` is executed
- **THEN** it lists each session name with window count
- **AND** exits 0

#### Scenario: No tmux server
- **GIVEN** no tmux server is running
- **WHEN** `run-kit status` is executed
- **THEN** it prints "No tmux sessions found"
- **AND** exits 0

## Embedding: Frontend Assets via embed.FS

### Requirement: Embed Frontend Build Output

The Go binary SHALL embed the Vite build output (`app/frontend/dist/`) using `//go:embed`. A new package `app/backend/frontend/` SHALL contain an `embed.go` file that exposes the embedded filesystem.

#### Scenario: Build sequence
- **GIVEN** `pnpm build` has been run (producing `app/frontend/dist/`)
- **WHEN** the build script copies `app/frontend/dist/` to `app/backend/frontend/dist/`
- **AND** `go build` compiles the binary
- **THEN** the binary contains the embedded frontend assets

### Requirement: SPA Serving from Embedded FS

The SPA handler (`api/spa.go`) SHALL serve from the embedded filesystem in production builds. For dev mode, the existing `spaDir` file-based serving continues to work (Vite dev server handles frontend).

#### Scenario: Production binary serves embedded assets
- **GIVEN** the binary was built with embedded frontend assets
- **WHEN** a browser requests `/`
- **THEN** the server responds with `index.html` from the embedded filesystem

#### Scenario: Static file from embedded FS
- **GIVEN** the binary was built with embedded frontend assets
- **WHEN** a browser requests `/assets/main.js`
- **THEN** the server responds with the file from the embedded filesystem

## Version: Management

### Requirement: VERSION File

A `VERSION` file at the repo root SHALL be the single source of truth for the project version. It contains a semver string (e.g., `0.1.0`) with no trailing newline prefix or `v` prefix.

#### Scenario: VERSION file read by build
- **GIVEN** `VERSION` contains `0.1.0`
- **WHEN** `scripts/build.sh` runs
- **THEN** it passes `-X main.version=0.1.0` to `go build` via ldflags

### Requirement: Version Variable in Go

`main.go` (or the root command file) SHALL declare `var version = "dev"` which is overridden by ldflags during production builds.

#### Scenario: Default dev version
- **GIVEN** no ldflags override
- **WHEN** the version variable is read
- **THEN** it returns `"dev"`

## Build: Scripts and Justfile

### Requirement: Build Script

`scripts/build.sh` SHALL encapsulate the full production build sequence:
1. Build frontend (`cd app/frontend && pnpm build`)
2. Copy `app/frontend/dist/` → `app/backend/frontend/dist/`
3. Read version from `VERSION` file
4. Build Go binary with ldflags: `CGO_ENABLED=0 go build -ldflags '-X main.version=...' -o ../../bin/run-kit ./cmd/run-kit`

The build order is frontend-first (required for embed).

#### Scenario: Clean build
- **GIVEN** a clean checkout with Node.js, pnpm, and Go installed
- **WHEN** `scripts/build.sh` is executed
- **THEN** it produces `bin/run-kit` with embedded frontend and correct version
- **AND** exits 0

### Requirement: Justfile Build Recipe

The `build` recipe in `justfile` SHALL delegate to `scripts/build.sh`. A new `release` recipe SHALL delegate to `scripts/release.sh`.

#### Scenario: just build
- **GIVEN** the justfile exists
- **WHEN** `just build` is executed
- **THEN** it runs `scripts/build.sh`

#### Scenario: just release
- **GIVEN** the justfile exists
- **WHEN** `just release patch` is executed
- **THEN** it runs `scripts/release.sh patch`

## CI/CD: Release Pipeline

### Requirement: GitHub Actions Release Workflow

`.github/workflows/release.yml` SHALL trigger on `v*` tag pushes. It SHALL cross-compile for 4 targets: `darwin/arm64`, `darwin/amd64`, `linux/arm64`, `linux/amd64`. Each target produces a tarball (`run-kit-{os}-{arch}.tar.gz`) uploaded to a GitHub Release.

#### Scenario: Tag push triggers build
- **GIVEN** a tag `v0.1.0` is pushed
- **WHEN** GitHub Actions runs the workflow
- **THEN** it builds 4 platform binaries with embedded frontend
- **AND** creates a GitHub Release `v0.1.0` with 4 tarballs attached

#### Scenario: Binary is self-contained
- **GIVEN** a release binary for `darwin/arm64`
- **WHEN** it is downloaded and executed
- **THEN** it runs without requiring Go, Node.js, or pnpm installed

### Requirement: Release Script

`scripts/release.sh` SHALL accept a bump level (`patch`, `minor`, `major`), increment the `VERSION` file accordingly, commit, tag with `v` prefix, and push.

#### Scenario: Patch release
- **GIVEN** `VERSION` contains `0.1.0`
- **WHEN** `scripts/release.sh patch` is executed
- **THEN** `VERSION` is updated to `0.1.1`
- **AND** a commit with message "v0.1.1" is created
- **AND** tag `v0.1.1` is created and pushed

## Distribution: Homebrew Formula

### Requirement: Homebrew Tap Formula

A formula `Formula/run-kit.rb` in the `wvrdz/homebrew-tap` repo SHALL download the prebuilt binary from the GitHub Release. It SHALL have zero runtime dependencies and zero build dependencies. SHA256 checksums for each platform archive are included.

#### Scenario: brew install
- **GIVEN** the user has tapped `wvrdz/homebrew-tap`
- **WHEN** `brew install run-kit` is executed
- **THEN** it downloads the prebuilt binary for the current platform
- **AND** installs it to `$(brew --prefix)/bin/run-kit`
- **AND** does NOT compile from source

### Requirement: Formula Template in Repo

A template formula file SHALL exist at `Formula/run-kit.rb` (or similar location in the run-kit repo for reference). The release script updates the actual formula in `wvrdz/homebrew-tap` after CI completes.

#### Scenario: Formula references correct URL
- **GIVEN** version `0.1.0` was released
- **WHEN** the formula is checked
- **THEN** the URL pattern is `https://github.com/wvrdz/run-kit/releases/download/v0.1.0/run-kit-{os}-{arch}.tar.gz`

## Design Decisions

1. **Prebuilt binaries over build-from-source formula**: Ship cross-compiled binaries via GitHub Release.
   - *Why*: Eliminates need for Go/Node.js/pnpm on the user's machine. Faster install. Single binary, no build step.
   - *Rejected*: Build-from-source formula (like tu) — requires all build dependencies on user's machine, slower install, more complex formula.

2. **`embed.FS` with copy step over `go:embed` with `../` paths**: Copy `app/frontend/dist/` into `app/backend/frontend/dist/` before build.
   - *Why*: Go's `//go:embed` cannot reference files outside the package directory. The copy step is a simple build-time operation.
   - *Rejected*: Restructuring the repo to colocate frontend output with Go source — would break existing dev workflow.

3. **VERSION file + ldflags over Go constant**: Version sourced from `VERSION` file, injected via `-X main.version=...`.
   - *Why*: Shell scripts (release, build) can read/write a plain text file. No Go code changes needed for version bumps.
   - *Rejected*: Go constant — requires code change for each release, harder to automate.

4. **Cobra over custom CLI parsing**: Use `spf13/cobra` for subcommand management.
   - *Why*: Industry standard, auto-generates help, well-documented. run-kit has 5 subcommands which is the sweet spot for Cobra.
   - *Rejected*: stdlib `flag` — no subcommand support. Custom parsing — unnecessary when Cobra exists.

5. **Formula downloads binary (not build-from-source)**: The Homebrew formula downloads prebuilt binaries from GitHub Releases.
   - *Why*: Zero build dependencies needed on user machine. Install is seconds, not minutes.
   - *Rejected*: Source formula with `go build` — would need Go + Node.js + pnpm in the formula, complex and slow.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `embed.FS` to bundle frontend into Go binary | Confirmed from intake #1 — user explicitly chose single-binary approach | S:95 R:75 A:80 D:90 |
| 2 | Certain | Cobra CLI with serve, version, upgrade, doctor, status | Confirmed from intake #2 — user chose these 5 subcommands | S:95 R:80 A:90 D:95 |
| 3 | Certain | Ship prebuilt binaries via GitHub Release | Confirmed from intake #3 — cross-compile, CI/CD on tag push | S:95 R:80 A:75 D:75 |
| 4 | Certain | VERSION file + ldflags injection | Confirmed from intake #4 — build-time injection, not Go constant | S:95 R:85 A:75 D:65 |
| 5 | Certain | Release script: tag → CI → formula update | Confirmed from intake #5 | S:95 R:80 A:85 D:85 |
| 6 | Certain | `wvrdz/homebrew-tap` as tap repo | Confirmed from intake #6 — org convention | S:85 R:90 A:90 D:90 |
| 7 | Certain | Frontend-first build order for embed | Confirmed from intake #7 — required by embed.FS | S:90 R:90 A:95 D:95 |
| 8 | Certain | Formula has zero deps — ships prebuilt binary | Confirmed from intake #8 | S:95 R:85 A:90 D:85 |
| 9 | Certain | Copy frontend dist into Go source tree before build | Confirmed from intake #9 — Go embed limitation | S:95 R:85 A:85 D:65 |
| 10 | Certain | `run-kit doctor` checks runtime deps only | Confirmed from intake #10 — tmux only, not build deps | S:95 R:85 A:75 D:70 |
| 11 | Certain | `run-kit` with no args defaults to `serve` | Confirmed from intake #11 — backwards compat | S:95 R:90 A:90 D:85 |
| 12 | Certain | Cobra added as Go dependency (`spf13/cobra`) | Standard CLI framework for Go; the only established choice for multi-subcommand Go CLIs | S:90 R:90 A:95 D:95 |
| 13 | Certain | SPA handler dual-mode: embedded FS in production, filesystem in dev | Required for `just dev` to work (Vite serves frontend). Production binary uses embedded FS. Determined by presence of embedded assets | S:85 R:85 A:90 D:90 |
| 14 | Certain | Cross-compile targets: darwin/arm64, darwin/amd64, linux/arm64, linux/amd64 | Clarified — intake specifies these 4 targets explicitly, Non-Goals confirms no Windows. Resolvable from context | S:95 R:80 A:70 D:70 |
| 15 | Confident | Homebrew-tap repo is a manual prerequisite (not created by this change) | Intake asked this as open question. Creating external repos is outside the scope of a code change. The formula template lives in-repo as reference | S:70 R:85 A:60 D:65 |

15 assumptions (14 certain, 1 confident, 0 tentative, 0 unresolved).
