# Plan: Config Root + Registry Core (Phase 1)

**Change**: 260823-li54-config-root-registry-core
**Intake**: `intake.md`

## Requirements

### Config Root: Fixed resolution

#### R1: Fixed config root constant
The config root SHALL be `$HOME/.config/run-kit/`, built with `filepath.Join` from the home directory (`os.UserHomeDir()`), owned by `internal/settings`. The resolution MUST NOT consult `$XDG_CONFIG_HOME` and MUST NOT use `os.UserConfigDir`. The settings file becomes `~/.config/run-kit/config.yaml`. An exported accessor (`settings.Dir()`) SHALL expose the root for later phases.

- **GIVEN** any process context (daemon, CLI, agent-in-pane) on any platform
- **WHEN** the config root is resolved
- **THEN** it is `$HOME/.config/run-kit/` — identical everywhere, moved only by `$HOME`

#### R2: Env-immunity test
A test MUST assert env vars cannot move the config root: with `XDG_CONFIG_HOME` set to a temp dir, the resolved path still lands under `$HOME/.config/run-kit/`.

- **GIVEN** `XDG_CONFIG_HOME=/some/tmp` and `HOME=/test/home`
- **WHEN** the settings path is resolved
- **THEN** it is `/test/home/.config/run-kit/config.yaml`

### Migration 1: settings.yaml → config.yaml

#### R3: Fallback-read from the old path
`settings.Load()` SHALL read `~/.config/run-kit/config.yaml`; when that file is absent, it SHALL fallback-read `~/.rk/settings.yaml` (same format, same parser). Defaults apply when both are absent.

- **GIVEN** values exist only in `~/.rk/settings.yaml`
- **WHEN** `Load()` runs
- **THEN** those values are returned unchanged

#### R4: Migrate on first write, breadcrumb
`settings.Save()` SHALL always write the new path (creating `~/.config/run-kit/`). After the first successful write to the new path, when `~/.rk/settings.yaml` still exists it SHALL be renamed to `~/.rk/settings.yaml.migrated` (best-effort — a rename failure never fails the Save).

- **GIVEN** `~/.rk/settings.yaml` exists and the new path does not
- **WHEN** any setting is saved
- **THEN** the new file holds the merged state AND the old file is renamed `settings.yaml.migrated` (nothing silently forks)

### Migration 3: state dir rename

#### R5: `$XDG_STATE_HOME/rk/` → `$XDG_STATE_HOME/run-kit/`
`internal/snapshot.DefaultDir` SHALL resolve `$XDG_STATE_HOME/run-kit/snapshots` and `internal/prstatus.DefaultCachePath` SHALL resolve `$XDG_STATE_HOME/run-kit/prstatus.json` (both keep honoring `$XDG_STATE_HOME` with the `~/.local/state` fallback — state stays XDG-honoring by design, unlike config). `prstatus.json` MAY be left behind at the old path (seed cache, regenerates).

- **GIVEN** `XDG_STATE_HOME` unset
- **WHEN** the snapshot store and prstatus cache paths resolve
- **THEN** they are `~/.local/state/run-kit/snapshots` and `~/.local/state/run-kit/prstatus.json`

#### R6: Snapshots move + breadcrumb
On snapshot-store first use, when the new snapshots dir is absent and old `$XDG_STATE_HOME/rk/snapshots` exists, the old dir SHALL be moved (`os.Rename`, best-effort, one-time) to the new location to preserve recovery backups, and a breadcrumb file (e.g. `$XDG_STATE_HOME/rk/MOVED-to-run-kit`) SHALL be left naming the new path. A failed move MUST degrade to cold-start behavior (empty store), never an error.

- **GIVEN** old `…/rk/snapshots` with recovery backups, no new dir
- **WHEN** the store first resolves
- **THEN** the backups are at `…/run-kit/snapshots` and a breadcrumb marks the old dir

### Settings Registry

#### R7: Registry as single source of truth
`internal/settings` SHALL define one registry — each entry carrying **key, type, default, description, category, `ui` flag, `live` flag** — that drives parse and serialize (replacing the scalar-key `switch` growth). Seed inventory: `theme`, `theme_dark`, `theme_light`, `instance_color`, `instance_name`, `ssh_host`, `server_colors` (map), `server_flairs` (map), `board_order` (list), `auto_name`, plus new `tmux_conf` (path string, default `""`) and `log_level` (enum `info`/`debug`, default `info`, ui-exposed). Live flags: true for the nine keys that already apply on next read; false for `auto_name` (phase 3 flips it), `tmux_conf`, `log_level`. Descriptions populated now (phases 2/3 consume them).

- **GIVEN** a future key addition
- **WHEN** a registry entry is added
- **THEN** parse and serialize handle it with no new scanner branches

#### R8: Behavior-preserving parse/serialize
The registry refactor MUST preserve current file semantics byte-for-byte for existing content: tolerant reads per key (quote-strip, `validate.NormalizeColorValue`, flair-set membership, `strconv.ParseBool`, malformed-entry skip), scalar serialization order and omit-when-default/empty rules, nested sections in registry order with sorted keys and quoted values. An existing settings file round-trips byte-identically. No `yaml.v3` for this file.

- **GIVEN** a settings file written by the current code
- **WHEN** it is loaded and re-saved by the refactored code (values unchanged)
- **THEN** the output bytes are identical (plus nothing — new keys serialize only when non-default)

#### R9: Accessor surface and per-key API behavior unchanged
The exported accessors (`Load`, `Save`, `Default`, `Get/SetServerColor`, `Get/SetServerFlair`, `Get/SetInstanceColor`, `Get/SetSSHHost`, `Get/SetInstanceName`, `Get/SetBoardOrder`) SHALL keep their signatures; the seven per-key endpoints in `api/settings.go` compile and behave identically (their fold is phase 2 — not here).

- **GIVEN** the existing `api/settings.go` handlers and their tests
- **WHEN** this change lands
- **THEN** they pass unmodified (except tests that assert the storage path)

### Override Order & Env Demotion

#### R10: Override order stated and enforced
The override order is `code default < config.yaml < env < CLI flag`, with env forms existing ONLY for deployment-bootstrap keys (`RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`). It SHALL be documented at the registry (package doc comment) and in `docs/specs/api.md`'s Base Configuration section (replacing the stale `run-kit.yaml` table).

- **GIVEN** a preference key (e.g. `ssh_host`)
- **WHEN** its value is resolved
- **THEN** only code default and config.yaml participate — no env form exists

#### R11: `RK_SSH_HOST` removed entirely
The `RK_SSH_HOST` env var SHALL no longer be read anywhere: delete `Config.SSHHost` and its `Load()` read (`internal/config/config.go:12-15,68`), the router startup seed (`api/router.go:617` + the `SetSSHHost` seam and `sshHost` field), and the env-fallback arm in `api/health.go:31` (the `ssh_host` setting is the only source). Remove the env from `cmd/rk/serve.go` help text (:108) and the commented example from `.env:13`. Update `internal/config/config_test.go`, `api/health_test.go`.

- **GIVEN** `RK_SSH_HOST=devbox` in the environment and no `ssh_host` setting
- **WHEN** `GET /api/health` is served
- **THEN** the response carries no `sshHost` (env is ignored)

#### R12: Doctor flags set-but-ignored `RK_SSH_HOST`
`rk doctor` SHALL emit a check when `RK_SSH_HOST` is set in the environment, stating it is no longer read and pointing at the `ssh_host` key in `~/.config/run-kit/config.yaml`. When the env is unset, no row appears (no noise).

- **GIVEN** `RK_SSH_HOST=devbox`
- **WHEN** `rk doctor` runs
- **THEN** a non-OK check names the var and the replacement key

#### R13: `tmux_conf` config key
`internal/tmux`'s config-path resolution (`tmux.go:85-96`) SHALL become: `RK_TMUX_CONF` env (undocumented per-process test escape — wins per the override order) → `tmux_conf` config.yaml key → `DefaultConfigPath` (`~/.rk/tmux.conf`, unchanged until phase 4). Set-value semantics unchanged: user owns the file (no ensure/refresh/doctor on it). User-facing copy that names `RK_TMUX_CONF` (e.g. the `tmux.go:169` error) SHALL name the `tmux_conf` key instead.

- **GIVEN** `tmux_conf: /my/tmux.conf` in config.yaml and no env
- **WHEN** tmux commands resolve the config path
- **THEN** `/my/tmux.conf` is used and `EnsureConfig` does not touch it
- **AND** **GIVEN** `RK_TMUX_CONF` also set **THEN** the env value wins

#### R14: `log_level` config key
`cmd/rk/serve.go:133` SHALL read the log level from settings (`log_level`, `info`/`debug`); the `LOG_LEVEL` env read survives as an undocumented per-process escape that wins when set (the dev rig depends on it — `justfile:38`, `scripts/dev.sh:21`, which stay unchanged).

- **GIVEN** `log_level: debug` in config.yaml, no env
- **WHEN** `rk serve` starts
- **THEN** slog runs at debug level
- **AND** **GIVEN** `LOG_LEVEL=debug` env with no config key **THEN** debug still wins (dev rig unchanged)

### Ghost Sweep & Governance

#### R15: `run-kit.yaml` ghost sweep
Stale `run-kit.yaml` references SHALL be corrected: `docs/specs/architecture.md:95` (tree line), `docs/specs/api.md:24-25` (Base Configuration table — rewritten per R10), `internal/fabconfig/fabconfig.go:5` (doc comment), `internal/validate/validate.go:129` (doc comment). A final sweep confirms no other live `run-kit.yaml` references remain in code/docs (memory logs and archived changes exempt — they are historical records).

- **GIVEN** the sweep is done
- **WHEN** grepping code, specs, README, docs/site for `run-kit.yaml`
- **THEN** no live references remain

#### R16: `FindGitRoot` relocation
`FindGitRoot` SHALL move from the vestigial `internal/config/runkit_yaml.go` to `internal/config/gitroot.go` (same package, same symbol — no caller changes); `runkit_yaml.go` is deleted.

- **GIVEN** the move
- **WHEN** the backend builds and riff repo-root derivation runs
- **THEN** behavior is unchanged and no file named for `run-kit.yaml` remains

#### R17: Constitution amendments
Constitution IV SHALL replace "Configuration lives in environment variables (`.env` committed, `.env.local` for overrides)" with the layered story (deployment binding in env — `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`, `.env`/`.env.local` as the bootstrap vehicle; per-instance preferences in `~/.config/run-kit/config.yaml` behind the settings registry; per-entity in `@rk_*` options; per-viewer in localStorage) and carve out the ONE registry-driven settings surface (singular by design) from the "no settings pages" rule. Constitution VII's `run-kit.yaml` sentence becomes: "The `config.yaml` settings file SHOULD require nothing; every key has a working default." Version bumps 1.9.0 → 1.10.0, Last Amended 2026-08-23.

- **GIVEN** the amended constitution
- **WHEN** phases 2/3 add the settings API/pane
- **THEN** they are constitutional under the IV carve-out

### Non-Goals

- Settings API fold (`GET/POST /api/settings`) and settings pane — phases 2/3.
- tmux.conf ownership/managed header/refresh/migration 2 — phase 4 (only the `tmux_conf` KEY lands here; `DefaultConfigPath` stays `~/.rk/tmux.conf`).
- `~/.rk/`'s other tenants (push store `internal/push/store.go:39`, code-server bin/profile `internal/codeserver/codeserver.go:40` + `internal/daemon/codeserver.go:92,98`, job logs `internal/daemon/jobs.go:222`) — untouched; follow-up backlog item.
- Frontend changes of any kind; `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`; fab-kit's `fab/project/config.yaml`; desktop store; live-apply machinery.
- Fenced reference block + `rk config explain` — deferred (registry `description` makes them data-only later).

### Design Decisions

#### Fixed config root, no XDG
**Decision**: `$HOME/.config/run-kit/` as a `filepath.Join` constant; only `$HOME` moves it.
**Why**: rk is a daemon + CLI + agents-in-panes — an env var differing between those contexts silently forks which config is read; determinism by construction (hop's proven pattern).
**Rejected**: `os.UserConfigDir` (macOS → `~/Library/Application Support`, path differs per platform); honoring `$XDG_CONFIG_HOME` (per-process forkability is the exact failure mode).
*Introduced by*: 260823-li54-config-root-registry-core

#### Hand-rolled registry-driven serializer
**Decision**: keep the line-scanner parse + string-builder serialize, now driven by the registry.
**Why**: preserves tolerant-read semantics and byte-stable omit-when-default output the existing tests pin; extends the proven `nestedSections` registry shape.
**Rejected**: `yaml.v3` marshal/unmarshal — reformats user files, loses omit-when-default byte-stability, adds comment-handling complexity for the phase-2 fence.
*Introduced by*: 260823-li54-config-root-registry-core

#### Breadcrumb by rename
**Decision**: migration breadcrumbs are self-documenting filesystem artifacts — old settings file renamed `*.migrated`; state move leaves a `MOVED-to-run-kit` marker file.
**Why**: an old binary or a curious user finds a clearly-marked artifact instead of a silently diverging live file.
**Rejected**: deleting the old file (destroys the rollback path); leaving it live (silent fork — two writers, two truths).
*Introduced by*: 260823-li54-config-root-registry-core

## Tasks

### Phase 1: Setup

- [x] T001 `internal/settings/settings.go`: add the fixed config root — `Dir()` (exported) + `configPath()` returning `$HOME/.config/run-kit/config.yaml` via `os.UserHomeDir()` + `filepath.Join`; package doc comment states the override order (R10) and the no-XDG rule. Add the env-immunity test in `settings_test.go` (t.Setenv `XDG_CONFIG_HOME` + `HOME`; assert path under `$HOME/.config/run-kit/`) <!-- R1, R2 -->

### Phase 2: Core Implementation

- [x] T002 `internal/settings/settings.go`: registry refactor — a `registryEntry` (key, type, default, description, category, ui, live) table covering all scalar keys, with `parse()`/`serialize()` driven by it; fold the existing `nestedSections` map/list machinery under the same registry umbrella. Byte-stable round-trip and tolerant-read tests must stay green (extend `settings_test.go` with an explicit round-trip byte-equality case) <!-- R7, R8 -->
- [x] T003 `internal/settings/settings.go`: add `TmuxConf` and `LogLevel` fields + registry entries (`tmux_conf` default `""`, category advanced, ui, non-live; `log_level` enum info/debug default `info`, category advanced, ui, non-live; tolerant parse — invalid `log_level` keeps default); omit-when-default serialization <!-- R7 -->
- [x] T004 `internal/settings/settings.go` + `settings_test.go`: migration 1 — `Load()` falls back to `~/.rk/settings.yaml` when the new path is absent; `Save()` writes the new path and best-effort renames the old file to `settings.yaml.migrated` after a successful write. Tests: fallback read, migrate-on-save + breadcrumb rename, both-absent defaults, new-path-wins-when-both-exist <!-- R3, R4 -->
- [x] T005 `internal/snapshot/store.go` + `store_test.go`: `DefaultDir` → `$XDG_STATE_HOME/run-kit/snapshots`; one-time best-effort `os.Rename` move of the old `…/rk/snapshots` when the new dir is absent (at store first-use/ensure, not in the pure path fn) + `MOVED-to-run-kit` breadcrumb in the old dir; failed move degrades to cold start. Tests: path resolution, move-preserves-backups, breadcrumb, move-failure tolerance <!-- R5, R6 -->
- [x] T006 [P] `internal/prstatus/prstatus_disk.go` + `prstatus_disk_test.go`: `DefaultCachePath` → `$XDG_STATE_HOME/run-kit/prstatus.json`; old file left behind (no move); update the Constitution §II doc comments that cite `$XDG_STATE_HOME/rk/` (also `prstatus.go:21`, `prstatus_branch.go:718`, `api/router.go:591` comment) <!-- R5 -->
- [x] T007 [P] `internal/config/config.go` + `config_test.go`: delete `SSHHost` field + `Load()` read + doc comment; drop the `RK_SSH_HOST` test cases <!-- R11 -->
- [x] T008 `api/router.go` + `api/health.go` + `api/health_test.go`: remove the `sshHost` server field, the `cfg.SSHHost` seed (:617), the `SetSSHHost` seam (:678) and the env-fallback arm (`health.go:31`) — `ssh_host` setting is the only source; update comments (:167-176, :561, `health.go:19`, `api/settings.go:156`) and tests <!-- R11 -->
- [x] T009 [P] `cmd/rk/serve.go` (help text :108) + `.env:13`: remove the `RK_SSH_HOST` lines <!-- R11 -->
- [x] T010 `cmd/rk/doctor.go` + `doctor_test.go`: append a check only when `RK_SSH_HOST` is set — non-OK, note "RK_SSH_HOST is no longer read — set the ssh_host key in ~/.config/run-kit/config.yaml"; hermetic test via env <!-- R12 -->
- [x] T011 `internal/tmux/tmux.go` + `tmux_test.go`: config-path resolution becomes env `RK_TMUX_CONF` → `settings.Load().TmuxConf` → `DefaultConfigPath` (verify `internal/tmux` → `internal/settings` import is acyclic first; if a cycle exists, inject the value from the composition roots instead — record which in the task note); update the `:169` error copy to name the `tmux_conf` key; test the three-layer precedence <!-- R13 -->
- [x] T012 `cmd/rk/serve.go:133`: log level = `LOG_LEVEL` env if set (undocumented escape), else `settings.Load().LogLevel`; `justfile`/`scripts/dev.sh` untouched <!-- R14 -->

### Phase 3: Integration & Edge Cases

- [x] T013 [P] `internal/config/`: move `FindGitRoot` to new `gitroot.go`; delete `runkit_yaml.go` (move any of its tests alongside) <!-- R16 -->
- [x] T014 [P] Ghost sweep: fix `internal/fabconfig/fabconfig.go:5` and `internal/validate/validate.go:129` doc comments; delete the `run-kit.yaml` tree line at `docs/specs/architecture.md:95`; rewrite `docs/specs/api.md:24-25` Base Configuration as the layered override-order story (bootstrap env keys vs config.yaml preference keys, new path named) <!-- R15, R10 -->
- [x] T015 Final sweep: grep code + README + docs/specs + docs/site for `run-kit.yaml`, `~/.rk/settings.yaml`, `RK_SSH_HOST` — fix any live stragglers (memory logs / archived changes exempt). Sweep scope includes TESTS (e2e specs) and comments, not just Go code <!-- R15 --> <!-- rework: review found live stragglers — e2e SETTINGS_PATH constants (settings-dialog.spec.ts:29, board-list-reorder.spec.ts:12) still target ~/.rk/settings.yaml (must-fix: suites mutate the real config.yaml unprotected); plus should-fix stale references: constitution.md:11 §II state-dir path, comment-only refs (instance-accent.ts:16, boards.ts:15+102, sidebar/index.tsx:233+240, pwa-assets.spec.ts:6, router.go:811), api.md code-server-port row's nonexistent CLI arm, test-e2e.sh:15 example path -->

### Phase 4: Polish

- [x] T016 `fab/project/constitution.md`: amend IV (layered config story + the one-settings-surface carve-out) and VII (`config.yaml` sentence); version 1.9.0 → 1.10.0, Last Amended 2026-08-23 <!-- R17 -->
- [x] T017 Gates: `just test-backend` green; `just build` green (frontend untouched — tsc/e2e not required for this backend-only change, but do not skip if any frontend file was touched) <!-- R8, R9 -->

## Execution Order

- T001 → T002 → T003 → T004 (same file, sequential); T005/T006/T007/T009/T013/T014 parallelizable
- T008 depends on T007 (config field removal); T010 after T008 (doctor references the settled copy); T011/T012 after T003 (need the new fields)
- T015 after T009/T013/T014; T016/T017 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Config root resolves to `$HOME/.config/run-kit/` via `filepath.Join`; `settings.Dir()` exported; no `os.UserConfigDir` / `XDG_CONFIG_HOME` anywhere in the resolution
- [x] A-002 R3/R4: Old-path values survive — fallback-read works, first `Save()` lands everything in `config.yaml` and renames the old file to `settings.yaml.migrated`
- [x] A-003 R5/R6: Snapshot store and prstatus cache resolve under `$XDG_STATE_HOME/run-kit/`; existing snapshots are moved with a breadcrumb left; prstatus.json regenerates cold
- [x] A-004 R7: One registry entry per key (all 12), each carrying key/type/default/description/category/ui/live; adding a key requires no scanner-branch edits
- [x] A-005 R12: `rk doctor` with `RK_SSH_HOST` set shows the set-but-ignored warning; without it, no row
- [x] A-006 R13/R14: `tmux_conf` and `log_level` config keys work end-to-end; both env escapes win when set

### Behavioral Correctness

- [x] A-007 R8: A current-format settings file round-trips byte-identically through the refactored parse/serialize (test proves it)
- [x] A-008 R9: The seven per-key `api/settings.go` endpoints behave identically (handler code untouched; their tests green)
- [x] A-009 R14: Dev rig unchanged — `LOG_LEVEL=debug` via `justfile`/`dev.sh` still yields debug logging

### Removal Verification

- [x] A-010 R11: No `RK_SSH_HOST` read remains in Go code, help text, or `.env`; `/api/health` ignores the env entirely
- [x] A-011 R16: `runkit_yaml.go` gone; `FindGitRoot` in `gitroot.go`; all callers compile unchanged
- [x] A-012 R15: No live `run-kit.yaml` reference in code/specs/README/docs-site (historical logs exempt)

### Scenario Coverage

- [x] A-013 R2: Env-immunity test exists and passes (XDG_CONFIG_HOME cannot move the root)
- [x] A-014 R4/R6: Migration tests cover fallback-read, migrate-on-write, breadcrumbs, and both-absent defaults; snapshot-move test covers preserve + degrade-on-failure

### Edge Cases & Error Handling

- [x] A-015 R4: Rename failure of the old settings file does not fail `Save()`; a read-only instance keeps fallback-reading the old file losslessly
- [x] A-016 R6: When the new snapshots dir already exists, the old dir is never merged into or clobbered — the move fires only into an absent target

### Code Quality

- [x] A-017 Pattern consistency: registry code extends the existing `nestedSection` idiom; doctor check follows `doctorCheck` conventions; comments state constraints, not narration
- [x] A-018 No unnecessary duplication: one root resolver, one registry — no second source of truth for keys or paths
- [x] A-019 Tests included for added/changed behavior (root, migrations, registry round-trip, doctor, tmux precedence)
- [x] A-020 No new subprocess calls; all file ops on `filepath.Join`-built constants (no user-controlled path segments)

### Security

- [x] A-021 R11: Removing the env read does not widen any surface; `ssh_host` remains validated/quoted exactly as today on its existing paths

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the removals this change required (`internal/config/runkit_yaml.go`, `Config.SSHHost` + its `Load()` read, the `Server.sshHost` field / startup seed / `SetSSHHost` seam, the `nestedSections` slice, `settingsPath()`) were all executed in the diff; no further existing code was made redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Doctor row appears only when `RK_SSH_HOST` is set (omit when unset) | Steady-state doctor output stays noise-free; the flag exists for the one misconfigured case | S:60 R:85 A:80 D:70 |
| 2 | Confident | tmux conf resolution keeps package-level init-time resolve (env → settings → default), tests pin via `RK_TMUX_CONF` env as today | Matches existing in-package `os.Getenv` precedent; lazy re-resolution is phase-4 territory | S:55 R:75 A:75 D:65 |
| 3 | Confident | Snapshots move fires at store first-use (ensure path), not inside the pure `DefaultDir` resolver | Path fns stay side-effect-free; the store already has the dir-ensure seam | S:55 R:80 A:80 D:70 |
| 4 | Confident | `log_level` accepts `info`/`debug` only (current code only distinguishes debug); invalid values keep default | serve.go:133 checks only "debug" today; wider enums are speculative | S:60 R:85 A:85 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
