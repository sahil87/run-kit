# Intake: Homebrew Deployment System

**Change**: 260317-ukyz-homebrew-deployment
**Created**: 2026-03-17
**Status**: Draft

## Origin

> Create a deployment system for run-kit. Using homebrew. Check how "tu" gets deployed right now (~/code/wvrdz/tu). Something similar. Note that we need to keep local build (just build) file in sync with what gets deployed - basically "run-kit upgrade" and "just build" should place the run-kit binary + other built assets at the same place. Thoughts?

Conversational — user wants a Homebrew-based distribution model for run-kit, referencing tu's release flow and fab-kit's build pattern as templates. Key constraint: `just build` (local dev) and Homebrew install must produce the same single binary.

Through discussion, the user confirmed:
- **`embed.FS`** for frontend assets — the Vite build output gets compiled into the Go binary at build time, producing a single self-contained binary
- **Cobra CLI framework** for subcommands — run-kit gets a proper CLI with `serve`, `version`, `upgrade`, `doctor`, `status`
- **Config stays via env vars** — no CLI flags for behavior changes; env vars continue to be the configuration mechanism (`.env` / `.env.local`)
- **Prebuilt binaries** — follow fab-kit's pattern: cross-compile for all platforms, CI/CD on tag push, ship prebuilt binaries via GitHub Release. Homebrew formula downloads the binary (no build-from-source)
- **Version via ldflags** — `VERSION` file as source of truth, injected at build time via `-X main.version=...`, not a Go constant

## Why

1. **No distribution mechanism today** — run-kit is currently built and run locally from the repo checkout. There's no way to install it on another machine, update it, or distribute it to team members without cloning the repo.

2. **Without this, every user must maintain a full dev environment** — Go 1.22, Node.js, pnpm, and all build dependencies just to run the tool. A Homebrew formula lets users install a pre-built binary with zero build dependencies.

3. **Following proven org patterns** — tu has a release flow (tag → GitHub release → formula update) and fab-kit has a cross-compilation + CI/CD pattern (tag push → GitHub Actions builds all platforms → uploads archives). Combining both patterns gives run-kit a robust distribution pipeline.

## What Changes

### 1. Cobra CLI Framework

run-kit's `main.go` currently starts the HTTP server directly. This changes to a Cobra-based CLI with five subcommands:

- **`run-kit serve`** — start the HTTP server (current behavior). `run-kit` with no args defaults to `serve` for backwards compatibility.
- **`run-kit version`** — print version and build info
- **`run-kit upgrade`** — self-update (Homebrew detection → `brew upgrade`, or suggest `git pull && just build` for dev installs)
- **`run-kit doctor`** — dependency check (validates tmux, checks config). Replaces/supplements `scripts/doctor.sh` for installed users who don't have the justfile.
- **`run-kit status`** — quick tmux session summary without starting the web UI (list active sessions, window counts, agent states). Useful for SSH/headless checks.

**Config remains via env vars** — no CLI flags for `RK_PORT`, `RK_HOST`, `LOG_LEVEL`, etc. Env vars loaded from `.env` / `.env.local` as today.

### 2. `embed.FS` for Frontend Assets

The Vite build output (`app/frontend/dist/`) gets embedded into the Go binary at compile time using `//go:embed`:

```go
//go:embed all:dist
var frontendFS embed.FS
```

**Build sequence:**
1. `pnpm build` → produces `app/frontend/dist/`
2. Copy `app/frontend/dist/` → `app/backend/frontend/dist/` (Go embed can't reach `../` paths)
3. `go build` → reads `dist/` via `//go:embed`, compiles it into the binary

The Go server serves the embedded filesystem for all non-API routes. Result: a single ~15-20MB binary that contains both the Go server and the entire frontend.

**For dev mode (`just dev`):** Nothing changes — Vite dev server still serves frontend directly with HMR. The embed path only matters for production builds.

### 3. Version Management

Following fab-kit's pattern:

- **Source of truth**: `VERSION` file at repo root (e.g., `0.1.0`)
- **Injection**: via Go ldflags at build time: `-X main.version=$(cat VERSION)`
- **Go code**: `var version = "dev"` in `main.go`, overridden by ldflags during builds
- **Used by**: `run-kit version` (display), `run-kit upgrade` (comparison with brew info)

The release script bumps the VERSION file. Local dev builds show `dev` unless you run the full build script.

### 4. Cross-Compilation & CI/CD

Following fab-kit's pattern:

**Local build** (`just build`):
1. Build frontend (`pnpm build`)
2. Copy dist into Go source tree
3. `CGO_ENABLED=0 go build -ldflags '-X main.version=...' -o ../../bin/run-kit ./cmd/run-kit`

**Release build** (CI/CD):
- Triggered by `v*` tag push via GitHub Actions
- Cross-compiles for 4 targets: `darwin/arm64`, `darwin/amd64`, `linux/arm64`, `linux/amd64`
- Creates GitHub Release with platform-specific binaries attached
- Single binary per platform (frontend embedded, no additional assets)

**GitHub Actions workflow** (`.github/workflows/release.yml`):
```yaml
on:
  push:
    tags: ['v*']
```
Steps: checkout → setup Go → setup Node/pnpm → build frontend → cross-compile all targets → create GitHub Release with binaries

### 5. Homebrew Formula (`wvrdz/homebrew-tap`)

A new formula `Formula/run-kit.rb` in the `wvrdz/homebrew-tap` repo (needs to be created).

The formula:
- Downloads the prebuilt binary from the GitHub Release for the appropriate platform (`darwin-arm64`, `darwin-amd64`, etc.)
- Installs the single binary to `bin/` — no build step, no dependencies
- SHA256 checksums for each platform archive
- **No runtime dependencies** — the Go binary is fully self-contained (frontend embedded, static linking via `CGO_ENABLED=0`)

This is simpler than tu's formula (which builds from source) because we ship prebuilt binaries.

### 6. Release Script (`scripts/release.sh`)

Orchestrates the manual release flow:

```bash
#!/usr/bin/env bash
set -euo pipefail

bump="${1:?Usage: release.sh <patch|minor|major>}"

# 1. Bump VERSION file (semver increment)
# 2. Commit VERSION change
# 3. Create git tag (v{version})
# 4. Push commit + tag → triggers GitHub Actions CI/CD
# 5. (CI builds binaries, creates GitHub Release)
# 6. After CI completes: update formula SHA256 + version in homebrew-tap
# 7. Push homebrew-tap
```

The release script handles the manual steps. CI/CD handles the build. The formula update happens after CI completes (the script can wait for the release or be run in two phases).

### 7. Justfile Changes

```just
build:
    scripts/build.sh

release bump="patch":
    scripts/release.sh {{bump}}
```

`scripts/build.sh` encapsulates the build sequence:
1. `cd app/frontend && pnpm build`
2. Copy `app/frontend/dist/` → `app/backend/frontend/dist/`
3. Read version from `VERSION` file
4. `cd app/backend && CGO_ENABLED=0 go build -ldflags '-X main.version=...' -o ../../bin/run-kit ./cmd/run-kit`

Build order is now frontend-first (required for embed). The justfile recipe stays a one-liner per constitution (Thin Justfile principle).

### 8. `run-kit upgrade` Command

Similar to tu's `tu update`:
1. Detect Homebrew install: check if `os.Executable()` path contains `/Cellar/run-kit/`
2. If Homebrew: run `brew update` → `brew info --json=v2 run-kit` → compare versions → `brew upgrade run-kit`
3. If local/dev: print "Local install detected. Run: git pull && just build"

### 9. `run-kit doctor` Command

Validates runtime dependencies for installed users:
- tmux installed and reachable
- Correct version ranges
- Config files present (`.env`, etc.)

Lighter than `scripts/doctor.sh` (which checks dev dependencies like `air`, `pnpm`, `node`). The CLI doctor only checks runtime requirements, not build requirements.

### 10. `run-kit status` Command

Quick tmux session summary:
- Lists active tmux sessions managed by run-kit
- Shows window count per session
- No server required — reads directly from tmux

## Affected Memory

- `run-kit/architecture`: (modify) Add deployment/distribution section covering Homebrew formula, release flow, embed.FS, CLI subcommands, CI/CD pipeline, and version management

## Impact

- **New files**: `app/backend/cmd/run-kit/` cobra commands (root, serve, version, upgrade, doctor, status), `app/backend/frontend/embed.go`, `VERSION`, `scripts/release.sh`, `scripts/build.sh`, `.github/workflows/release.yml`
- **Modified files**: `app/backend/cmd/run-kit/main.go` (cobra root command replacing direct server start), `justfile` (build recipe delegates to script, add release recipe), `app/backend/go.mod` (add cobra dependency)
- **External**: `wvrdz/homebrew-tap` repo created with `Formula/run-kit.rb`
- **No runtime dependencies** — the distributed binary is fully self-contained
- **No breaking changes** to existing `just dev` workflow. `just build` output is equivalent (same binary, now with embedded frontend and version).

## Open Questions

- Does the homebrew-tap repo need to be created as part of this change, or is that a manual prerequisite?

## Clarifications

### Session 2026-03-18 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 3 | Changed | "Prebuilt binaries following fab-kit's pattern — cross-compile, CI/CD on tag push, ship via GitHub Release" |
| 4 | Changed | "VERSION file + ldflags injection at build time, not Go constant. Tag-triggered CI/CD." |
| 5 | Confirmed | — |
| 8 | Changed | "No runtime dependencies — shipping prebuilt self-contained binary" |
| 9 | Confirmed | — |
| 10 | Confirmed | — |
| 11 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `embed.FS` to bundle frontend assets into the Go binary | Discussed — user confirmed single-binary approach. Vite dist compiled into Go binary at build time. | S:95 R:75 A:80 D:90 |
| 2 | Certain | Cobra CLI with serve, version, upgrade, doctor, status subcommands | Discussed — user chose these 5 subcommands explicitly. Config stays via env vars. | S:95 R:80 A:90 D:95 |
| 3 | Certain | Ship prebuilt binaries via GitHub Release (not build-from-source formula) | Clarified — user changed to fab-kit's pattern: cross-compile for all platforms, CI/CD on tag push | S:95 R:80 A:75 D:75 |
| 4 | Certain | Version via `VERSION` file + ldflags injection (`-X main.version=...`) | Clarified — user changed to build-time injection following fab-kit pattern, not Go constant | S:95 R:85 A:75 D:65 |
| 5 | Certain | Release script modeled on tu's flow (tag → CI → formula update) | Clarified — user confirmed | S:95 R:80 A:85 D:85 |
| 6 | Certain | Use `wvrdz/homebrew-tap` as the tap repository | User referenced tu's setup which uses this tap. Only one tap for the org. | S:85 R:90 A:90 D:90 |
| 7 | Certain | `just build` order changes to frontend-first, then Go build (for embed) | Required by `embed.FS` — frontend dist must exist before Go compilation. | S:90 R:90 A:95 D:95 |
| 8 | Certain | Homebrew formula has zero runtime/build dependencies — ships prebuilt binary | Clarified — user confirmed no deps needed since shipping final Go binary | S:95 R:85 A:90 D:85 |
| 9 | Certain | Copy frontend dist into Go source tree before build (not `../` embed) | Clarified — user confirmed as build step | S:95 R:85 A:85 D:65 |
| 10 | Certain | `run-kit doctor` checks runtime deps only (tmux), not build deps | Clarified — user confirmed | S:95 R:85 A:75 D:70 |
| 11 | Certain | `run-kit` with no args defaults to `serve` | Clarified — user confirmed | S:95 R:90 A:90 D:85 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
