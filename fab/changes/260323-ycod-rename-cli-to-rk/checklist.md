# Quality Checklist: Rename CLI Binary to rk

**Change**: 260323-ycod-rename-cli-to-rk
**Generated**: 2026-03-23
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Binary name: Compiled binary is named `rk`, not `run-kit`
- [x] CHK-002 Module path: `go.mod` declares `module rk`
- [x] CHK-003 Import paths: No Go file imports `"run-kit/..."`
- [x] CHK-004 Config directory: Default config path is `~/.rk/tmux.conf`
- [x] CHK-005 Upgrade command: References `wvrdz/tap/rk` and `/Cellar/rk/`
- [x] CHK-006 Build script: Outputs to `dist/rk` from `./cmd/rk`
- [x] CHK-007 Release workflow: Produces `rk-{os}-{arch}.tar.gz` with `rk` binary inside
- [x] CHK-008 Formula template: Class `Rk`, `bin.install "rk"`, test `"rk version"`
- [x] CHK-009 README: Shows `brew install rk` and `rk` CLI examples
- [x] CHK-010 Homebrew tap: `Formula/rk.rb` with class `Rk`

## Behavioral Correctness
- [x] CHK-011 Version output: `rk version` prints `rk version {semver}`
- [x] CHK-012 Daemon messages: All serve.go messages say "rk daemon"
- [x] CHK-013 Cobra root: `Use` field is `"rk"`

## Removal Verification
- [x] CHK-014 No `cmd/run-kit/` directory remains
- [x] CHK-015 No `"run-kit/..."` import paths remain in Go files
- [x] CHK-016 No `dist/run-kit` references remain in build scripts

## Scenario Coverage
- [x] CHK-017 Go build succeeds: `go build ./cmd/rk` completes without error
- [x] CHK-018 Go tests pass: `go test ./...` passes
- [x] CHK-019 Version test: `version_test.go` expects `"rk version dev"`

## Edge Cases & Error Handling
- [x] CHK-020 Daemon comments in `internal/daemon/daemon.go` reference `rk` not `run-kit`
- [x] CHK-021 Frontend comment in `app.tsx` references `rk` not `run-kit`

## Code Quality
- [x] CHK-022 Pattern consistency: Rename is comprehensive — no stale `run-kit` binary references remain
- [x] CHK-023 No unnecessary duplication: No duplicate formula files (old + new)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
