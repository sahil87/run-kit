# Tasks: Homebrew Deployment System

**Change**: 260317-ukyz-homebrew-deployment
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `VERSION` file at repo root containing `0.1.0`
- [x] T002 Add `spf13/cobra` dependency: `cd app/backend && go get github.com/spf13/cobra@latest`
- [x] T003 Create `app/backend/frontend/` directory with `embed.go` exposing `//go:embed all:dist` as `embed.FS`, plus a placeholder `dist/.gitkeep` so the package compiles without a build

## Phase 2: Core Implementation

- [x] T004 Restructure `app/backend/cmd/run-kit/main.go` into Cobra root command. Create `root.go` (root command, `var version = "dev"`, defaults to `serve`), `serve.go` (current server logic from `main.go`), `version.go` (`run-kit version` prints version string). Keep `main.go` minimal — just calls `root.Execute()`
- [x] T005 Create `app/backend/cmd/run-kit/upgrade.go` — detect Homebrew install via `os.Executable()` path containing `/Cellar/run-kit/`, run `brew update && brew upgrade run-kit` if Homebrew, else print local install message
- [x] T006 [P] Create `app/backend/cmd/run-kit/doctor.go` — check tmux on PATH via `exec.LookPath`, print pass/fail status, exit 1 if any check fails
- [x] T007 [P] Create `app/backend/cmd/run-kit/status.go` — use `internal/tmux.ListSessions()` to display session names and window counts. Handle no-server case gracefully
- [x] T008 Update `app/backend/api/spa.go` to support dual-mode serving: use embedded `fs.FS` from `app/backend/frontend` package when available (non-empty embed), fall back to filesystem `spaDir` for dev mode

## Phase 3: Integration & Edge Cases

- [x] T009 Create `scripts/build.sh` — full production build sequence: frontend build, copy dist to `app/backend/frontend/dist/`, read VERSION, go build with ldflags. `CGO_ENABLED=0` for static binary
- [x] T010 Create `scripts/release.sh` — accept bump arg (patch/minor/major), increment VERSION semver, commit, tag `v{version}`, push commit + tag
- [x] T011 Update `justfile` — change `build` recipe to delegate to `scripts/build.sh`, add `release` recipe delegating to `scripts/release.sh`
- [x] T012 Create `.github/workflows/release.yml` — trigger on `v*` tag push, setup Go + Node/pnpm, build frontend, cross-compile 4 targets (darwin/arm64, darwin/amd64, linux/arm64, linux/amd64), create GitHub Release with tarballs
- [x] T013 [P] Create `Formula/run-kit.rb` template — reference formula for `wvrdz/homebrew-tap` with platform-specific URL/SHA256 placeholders, zero dependencies

## Phase 4: Polish

- [x] T014 Add Go tests for new CLI commands: `root_test.go` (no-args defaults to serve behavior), `version_test.go` (version output format), `doctor_test.go` (LookPath mock)
- [x] T015 Verify full build pipeline: `scripts/build.sh` produces working binary with embedded frontend and correct version string

---

## Execution Order

- T001, T002, T003 are independent setup — run first
- T004 blocks T005, T006, T007 (all subcommands depend on Cobra root)
- T005, T006, T007 are independent of each other after T004
- T008 depends on T003 (needs the embed package)
- T009 depends on T003 and T008 (build script needs embed working)
- T010, T012, T013 are independent of each other
- T011 depends on T009 and T010 (justfile delegates to both scripts)
- T014 depends on T004-T007 (tests need commands to exist)
- T015 depends on T009 (integration verification)
