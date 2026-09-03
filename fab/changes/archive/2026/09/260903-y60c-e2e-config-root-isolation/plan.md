# Plan: E2E Config-Root Isolation

**Change**: 260903-y60c-e2e-config-root-isolation
**Intake**: `intake.md`

## Requirements

### Backend: env-gated config-root override in `internal/settings`

#### R1: `RK_CONFIG_DIR` overrides the config root, test-only, production byte-identical when unset
`app/backend/internal/settings/settings.go` SHALL read a test-isolation env var `RK_CONFIG_DIR` in-package via `os.Getenv` (the `RK_SERVER_ALLOWLIST` / `RK_TMUX_CONF` precedent — NOT threaded through `internal/config`). When the value is unset or whitespace-only, `Dir()` MUST return `$HOME/.config/run-kit` and `configPath()` MUST return `$HOME/.config/run-kit/config.yaml` — behavior byte-identical to today. When set (trimmed value non-empty), `Dir()` SHALL return the env value verbatim as the config root and `configPath()` SHALL return `{value}/config.yaml`; the directory is created on save exactly as the fixed root is today (`Save`'s existing `os.MkdirAll(Dir(), …)` path inherits the override — no new creation code). The package doc comment and the `Dir()` doc comment ("The config root is fixed at $HOME/.config/run-kit") MUST be updated to state the test-only carve-out. Every consumer of `Dir()`/`configPath()` inherits the override (no per-consumer plumbing).

- **GIVEN** `RK_CONFIG_DIR` is unset (or set to `"   "`)
- **WHEN** `Dir()` / `configPath()` resolve
- **THEN** they return `$HOME/.config/run-kit` / `$HOME/.config/run-kit/config.yaml` exactly as today

- **GIVEN** `RK_CONFIG_DIR=/tmp/e2e-run/config`
- **WHEN** `Dir()` / `configPath()` resolve
- **THEN** they return `/tmp/e2e-run/config` / `/tmp/e2e-run/config/config.yaml`
- **AND** `Save()` creates `/tmp/e2e-run/config` when absent

#### R2: Unit coverage for set / unset / whitespace
`internal/settings/settings_test.go` SHALL gain `t.Setenv`-based cases covering: unset (existing fixed-root behavior — the existing `TestConfigRootIsFixedAndEnvImmune` stays green), whitespace-only value (treated as unset), set value (root moves, `configPath` follows, save-creates-dir under the override).

- **GIVEN** the new test cases run under `go test ./internal/settings/`
- **WHEN** each sets `HOME` and `RK_CONFIG_DIR` per its case
- **THEN** all pass, and no existing settings test regresses

### Harness: `scripts/test-e2e.sh` wires the isolated root

#### R3: The e2e harness points backend and Playwright at a per-run config root
`scripts/test-e2e.sh` SHALL create `"$E2E_STATE_HOME/config"` (under the existing per-run `mktemp -d`, already removed by the EXIT trap), add `RK_CONFIG_DIR=$E2E_STATE_HOME/config` to the dev-backend launch env (the `bash -c "… exec just dev"` line, alongside `RK_SERVER_ALLOWLIST` and `XDG_STATE_HOME`), and add the same `RK_CONFIG_DIR` to the `run_playwright` env so specs and backend agree on the path. The header comment documenting "`$HOME`-keyed state … stays shared" MUST be updated to state the config root is now isolated per run.

- **GIVEN** two worktrees running `just test-e2e` concurrently
- **WHEN** their specs mutate `instance_name` / `board_order` through the live API
- **THEN** each run's backend reads/writes its own per-run temp `config.yaml`; neither the developer's real `~/.config/run-kit/config.yaml` nor the sibling run is touched

### Specs: path from env, snapshot/restore kept as fallback

#### R4: Config-touching specs derive the settings path from `RK_CONFIG_DIR` with a homedir fallback
`settings-dialog.spec.ts` and `board-list-reorder.spec.ts` SHALL compute `SETTINGS_PATH` as `join(process.env.RK_CONFIG_DIR ?? join(homedir(), ".config", "run-kit"), "config.yaml")`. The existing beforeAll/afterAll snapshot/restore pattern is KEPT, not removed — `just pw` runs against a `just dev` rig that does not set `RK_CONFIG_DIR` (interactive lane, real config), so the specs must still protect the real file there; under `just test-e2e` the snapshot/restore becomes a harmless no-op against the per-run temp file. Spec intent comments (constitution: Test Intent Comments) MUST be updated to state both modes. `pwa-assets.spec.ts` needs no change (tint-agnostic by design).

- **GIVEN** a spec run with `RK_CONFIG_DIR` set by the harness
- **WHEN** the suite snapshots/restores `SETTINGS_PATH`
- **THEN** it operates on the per-run temp file, never the developer's real config
- **AND GIVEN** an interactive `just pw` run (no `RK_CONFIG_DIR`), **THEN** the snapshot/restore protects the real `~/.config/run-kit/config.yaml` exactly as today

### Non-Goals

- No constitution amendment — Principle IV's env-key clause governs deployment binding; `RK_CONFIG_DIR` is a test-isolation var in the same shipped class as `RK_SERVER_ALLOWLIST`.
- No `$HOME` redirection for the dev-server subtree (rejected in intake — larger blast radius).
- No cross-worktree flock around config-touching specs (rejected in intake — serializes instead of isolating).
- No change to `pwa-assets.spec.ts`.

### Design Decisions

#### In-package env read at the shared root
**Decision**: `RK_CONFIG_DIR` is read inside `internal/settings` at `Dir()` — the single root every settings consumer (`configPath`, `/api/settings`, board persistence, PWA accent read) resolves through. The managed tmux.conf path (`tmux.DefaultConfigPath`) is computed independently in `internal/tmux` and deliberately does NOT move under the override — only the settings file needs per-run isolation. While the override is active, the legacy `~/.rk/settings.yaml` fallback-read and breadcrumb rename are suppressed too, so an isolated run never reads or writes the real `$HOME`.
**Why**: scope-at-the-shared-root is the recorded rationale for `RK_SERVER_ALLOWLIST` (filter in `ListServers`, not the handler); a per-consumer override would leave sibling paths unscoped. In-package `os.Getenv` matches the package precedent and avoids a new `internal/config` import edge.
**Rejected**: threading through `internal/config` (new cross-package plumbing for one test-only value); overriding `$HOME` for the dev subtree (moves `~/.rk`, node/pnpm caches — blast radius).
*Introduced by*: 260903-y60c-e2e-config-root-isolation

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the `RK_CONFIG_DIR` env-gated override to `Dir()` in `app/backend/internal/settings/settings.go` (whitespace-only ⇒ unset; set ⇒ value verbatim), export the env-name const, and update the package + `Dir()` doc comments with the test-only carve-out <!-- R1 -->
- [x] T002 Extend `app/backend/internal/settings/settings_test.go` with `t.Setenv`-based cases: unset, whitespace-only, set (Dir/configPath move together), and save-creates-dir under the override <!-- R2 -->

### Phase 2: Harness & Specs

- [x] T003 [P] `scripts/test-e2e.sh`: create `"$E2E_STATE_HOME/config"`, add `RK_CONFIG_DIR` to the dev-backend launch env and to `run_playwright`, update the header comment's shared-`$HOME` gap note <!-- R3 -->
- [x] T004 [P] Derive `SETTINGS_PATH` from `process.env.RK_CONFIG_DIR` (homedir fallback) in `app/frontend/tests/e2e/settings-dialog.spec.ts` and `app/frontend/tests/e2e/board-list-reorder.spec.ts`; update both files' intent comments to state harness-isolated vs interactive-fallback modes <!-- R4 -->

### Phase 3: Verification

- [x] T005 Run gates: `go test ./...` in `app/backend`, `npx tsc --noEmit` in `app/frontend`, and `just test-e2e` (config-touching specs) to confirm the isolated root end-to-end <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Dir()`/`configPath()` honor `RK_CONFIG_DIR` when set (root verbatim, `{value}/config.yaml`) and are byte-identical to today when unset or whitespace-only
- [x] A-002 R2: `settings_test.go` covers set / unset / whitespace-only / save-creates-dir cases and the full backend test suite passes
- [x] A-003 R3: `scripts/test-e2e.sh` creates the per-run config dir and exports `RK_CONFIG_DIR` to both the dev-backend launch and `run_playwright`
- [x] A-004 R4: Both specs compute `SETTINGS_PATH` from `RK_CONFIG_DIR` with the homedir fallback, and the snapshot/restore pattern is retained

### Behavioral Correctness

- [x] A-005 R1: Production behavior unchanged — no API surface change; with the env unset every existing settings test (incl. `TestConfigRootIsFixedAndEnvImmune`) passes unmodified
- [x] A-006 R3: Under `just test-e2e`, backend writes land in `$E2E_STATE_HOME/config/config.yaml` (removed by the EXIT trap), not `~/.config/run-kit/config.yaml`

### Scenario Coverage

- [x] A-007 R4: Spec intent comments state both modes (harness-isolated temp file; interactive `just pw` fallback protecting the real file) per the Test Intent Comments constitution rule
- [x] A-008 R3: The test-e2e.sh header comment no longer documents the `$HOME`-stays-shared gap as open

### Code Quality

- [x] A-009 Pattern consistency: the override follows the `RK_SERVER_ALLOWLIST`/`RK_TMUX_CONF` in-package `os.Getenv` precedent (no `internal/config` threading, env-name const in one place)
- [x] A-010 No unnecessary duplication: no new dir-creation code — `Save()`'s existing `MkdirAll` path inherits the override; specs share the same two-line path derivation

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

Considered and rejected: the `beforeAll`/`afterAll` snapshot/restore blocks (`app/frontend/tests/e2e/settings-dialog.spec.ts:88-120`, `app/frontend/tests/e2e/board-list-reorder.spec.ts:51-90`) become a no-op under `just test-e2e`, but R4 deliberately retains them as the real-config guard for the interactive `just pw` lane.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep the intake's `RK_CONFIG_DIR` name | Intake records it as the proposed name (Tentative there for pre-merge rename); apply implements as specified — trivially renameable later | S:85 R:90 A:90 D:85 |
| 2 | Confident | Export a package const for the env name (mirroring `tmux.ServerAllowlistEnv`) rather than an inline literal | Codebase precedent: `ServerAllowlistEnv` is the named-const pattern for env-gated test vars; magic strings are a listed anti-pattern | S:70 R:90 A:85 D:80 |
| 3 | Confident | Whitespace-only ⇒ unset via `strings.TrimSpace`; a set value returned verbatim (untrimmed-path edge accepted) | Intake states both "whitespace-only ⇒ production default" and "returns the env value verbatim"; matches the allowlist's empty-is-unset rule | S:75 R:85 A:80 D:75 |

3 assumptions (1 certain, 2 confident, 0 tentative).
