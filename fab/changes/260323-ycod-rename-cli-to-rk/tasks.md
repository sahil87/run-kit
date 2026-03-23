# Tasks: Rename CLI Binary to rk

**Change**: 260323-ycod-rename-cli-to-rk
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Module & Directory Rename

- [x] T001 Rename `app/backend/go.mod` module from `run-kit` to `rk`
- [x] T002 Rename directory `app/backend/cmd/run-kit/` to `app/backend/cmd/rk/`
- [x] T003 Find-replace all Go import paths: `"run-kit/` → `"rk/` across all `.go` files in `app/backend/`

## Phase 2: CLI Output & Messages

- [x] T004 [P] Update `app/backend/cmd/rk/root.go`: Cobra `Use` field and `Short` description
- [x] T005 [P] Update `app/backend/cmd/rk/version.go`: version output string `"rk version %s"`
- [x] T006 [P] Update `app/backend/cmd/rk/serve.go`: all 6 "run-kit daemon" messages → "rk daemon"
- [x] T007 [P] Update `app/backend/cmd/rk/upgrade.go`: Cellar path check (`/Cellar/rk/`), brew formula refs (`wvrdz/tap/rk`), status messages
- [x] T008 [P] Update `app/backend/cmd/rk/initconf.go`: description referencing `~/.rk/`
- [x] T009 [P] Update `app/backend/cmd/rk/version_test.go`: expected output `"rk version dev"`

## Phase 3: Config & Internal References

- [x] T010 Update `app/backend/internal/tmux/tmux.go`: `DefaultConfigPath` from `~/.run-kit/tmux.conf` to `~/.rk/tmux.conf`
- [x] T011 Update `app/backend/internal/daemon/daemon.go`: comments referencing "run-kit serve" and "run-kit" in $PATH

## Phase 4: Build & Release Pipeline

- [x] T012 [P] Update `scripts/build.sh`: output path `dist/rk`, source `./cmd/rk`, echo messages
- [x] T013 [P] Update `justfile`: all `dist/run-kit` → `dist/rk`, `./cmd/run-kit` → `./cmd/rk`
- [x] T014 [P] Update `.github/workflows/release.yml`: artifact names `rk-{os}-{arch}`, binary name in tarball, formula push path `Formula/rk.rb`
- [x] T015 [P] Update `.github/formula-template.rb`: class `Rk`, asset URLs, `bin.install "rk"`, test assertion

## Phase 5: Documentation & Frontend

- [x] T016 [P] Update `README.md`: install instructions and CLI usage examples
- [x] T017 [P] Update `app/frontend/src/app.tsx`: comment referencing "run-kit's tmux config" → "rk's tmux config"

## Phase 6: Homebrew Tap (external repo)

- [x] T018 In `/Users/sahil/code/wvrdz/homebrew-tap/`: rename `Formula/run-kit.rb` → `Formula/rk.rb`, update class to `Rk`, `bin.install "rk"`, test assertion, README table

## Phase 7: Verification

- [x] T019 Run `cd app/backend && go build ./cmd/rk` to verify the build succeeds
- [x] T020 Run `cd app/backend && go test ./...` to verify all tests pass

---

## Execution Order

- T001-T003 are sequential (module rename → dir rename → import fix)
- T004-T009 are parallel (all in the renamed `cmd/rk/` directory, independent files)
- T010-T011 are independent of Phase 2
- T012-T015 are parallel (independent build/release files)
- T016-T017 are parallel (independent doc/frontend files)
- T018 is independent (separate repo)
- T019-T020 are sequential and must run after all other tasks
