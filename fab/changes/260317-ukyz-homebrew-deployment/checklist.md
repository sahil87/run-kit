# Quality Checklist: Homebrew Deployment System

**Change**: 260317-ukyz-homebrew-deployment
**Generated**: 2026-03-18
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Cobra Root Command: `run-kit` with no args starts HTTP server (defaults to serve)
- [x] CHK-002 Serve Subcommand: `run-kit serve` starts server with env var config and graceful shutdown
- [x] CHK-003 Version Subcommand: `run-kit version` prints version string from ldflags (or "dev")
- [x] CHK-004 Upgrade Subcommand: detects Homebrew vs local install, runs appropriate update
- [x] CHK-005 Doctor Subcommand: checks tmux on PATH, prints pass/fail, exits 1 on failure
- [x] CHK-006 Status Subcommand: lists tmux sessions with window counts, handles no-server
- [x] CHK-007 Embed Frontend: `app/backend/frontend/embed.go` exposes `embed.FS` with `//go:embed all:dist`
- [x] CHK-008 SPA Dual-Mode: serves from embedded FS in production, filesystem in dev
- [x] CHK-009 VERSION File: exists at repo root with semver string, read by build script
- [x] CHK-010 Build Script: `scripts/build.sh` runs frontend-first build with ldflags injection
- [x] CHK-011 Release Script: `scripts/release.sh` bumps version, commits, tags, pushes
- [x] CHK-012 Justfile: `build` delegates to `scripts/build.sh`, `release` delegates to `scripts/release.sh`
- [x] CHK-013 GitHub Actions: `.github/workflows/release.yml` triggers on `v*` tags, cross-compiles 4 targets
- [x] CHK-014 Formula Template: `Formula/run-kit.rb` with platform URLs and SHA256 placeholders

## Behavioral Correctness
- [x] CHK-015 No-args backwards compat: `run-kit` (no subcommand) behaves identically to current server start
- [x] CHK-016 Dev mode unaffected: `just dev` still works (Vite serves frontend, no embed needed)
- [x] CHK-017 Version fallback: dev builds without ldflags show "dev" not empty string

## Scenario Coverage
- [x] CHK-018 Homebrew install detection: upgrade command detects `/Cellar/run-kit/` in executable path
- [x] CHK-019 Local install detection: upgrade command prints git pull instructions for non-Homebrew
- [x] CHK-020 tmux missing: doctor exits 1 with install instructions
- [x] CHK-021 No tmux server: status prints "No tmux sessions found" and exits 0
- [x] CHK-022 Clean build: `scripts/build.sh` from clean checkout produces working binary

## Edge Cases & Error Handling
- [x] CHK-023 Missing frontend dist: build script fails clearly if `pnpm build` hasn't run
- [x] CHK-024 Empty embed in dev: SPA handler falls back to filesystem when embedded FS is empty/placeholder

## Code Quality
- [x] CHK-025 Pattern consistency: CLI commands follow Go/Cobra conventions, shell scripts use `set -euo pipefail`
- [x] CHK-026 No unnecessary duplication: reuses `internal/tmux.ListSessions()` in status command
- [x] CHK-027 exec.CommandContext with timeouts: upgrade command uses context with timeout for brew subprocess calls
- [x] CHK-028 No shell string construction: all subprocess calls use argument slices
- [x] CHK-029 Thin Justfile: build and release recipes are one-liners delegating to scripts

## Security
- [x] CHK-030 No shell injection: upgrade command uses exec.CommandContext with argument slices for brew calls
- [x] CHK-031 CGO_ENABLED=0: release builds use static linking

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
