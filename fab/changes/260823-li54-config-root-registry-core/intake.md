# Intake: Config Root + Registry Core (Phase 1)

**Change**: 260823-li54-config-root-registry-core
**Created**: 2026-08-23

## Origin

One-shot `/fab-new` invocation implementing **Phase 1 (Root + registry core)** of the consolidated config plan `fab/plans/sahil/26-08-23-config-consolidated.md` (which merges and supersedes `26-08-22-config-standardization.md` and `26-08-23-tmux-config-standardization.md`; decision record: the 2026-08-23 "Config Sanitization Board" brainstorm artifact). Backend-only, ships alone; prerequisite to phases 2/3/4.

> Implement Phase 1 (Root + registry core) of fab/plans/sahil/26-08-23-config-consolidated.md — backend-only, ships alone. Scope: (1) fixed config-root resolution to $HOME/.config/run-kit/ as a constant built with filepath.Join (no XDG_CONFIG_HOME honor, no os.UserConfigDir), with a test asserting env vars cannot move it; (2) migrations 1 and 3 from the plan's Migrations section (~/.rk/settings.yaml → ~/.config/run-kit/config.yaml; $XDG_STATE_HOME/rk/ → $XDG_STATE_HOME/run-kit/, MOVING snapshots/ to preserve recovery backups, prstatus.json may be left behind) — fallback-read from the old path, migrate on first write, leave a breadcrumb so nothing silently forks; (3) settings registry refactor: a single source-of-truth registry (key, type, default, description, category, ui flag, live flag) replacing the scalar-switch growth in internal/settings, seeded with the starting key inventory in the plan (theme, theme_dark, theme_light, instance_color, instance_name, ssh_host, server_colors, server_flairs, board_order, auto_name, plus new tmux_conf and log_level); (4) override order code-default < config.yaml < env < CLI flag, with env forms restricted to deployment-bootstrap keys only; (5) env demotion: RK_SSH_HOST removed entirely (ssh_host config key is the only surface; add an rk doctor line flagging a set-but-ignored RK_SSH_HOST), RK_TMUX_CONF becomes the tmux_conf config.yaml key (env MAY survive undocumented as a per-process test escape), LOG_LEVEL becomes a config.yaml key (ui-exposed), RK_CODE_SERVER_PORT stays env; (6) ghost sweep: stale run-kit.yaml references (Constitution VII, docs/specs/architecture.md:95, docs/specs/api.md:24-25, internal/fabconfig/fabconfig.go:5, validate.go:129), move FindGitRoot out of the vestigial runkit_yaml.go into e.g. gitroot.go; (7) Constitution amendments: IV replaces 'configuration lives in environment variables' with the layered story and carves out the one registry-driven settings surface; VII's run-kit.yaml sentence becomes config.yaml. Do NOT touch the settings API/pane (phase 2/3) or tmux.conf ownership (phase 4) — those are separate later changes that depend on this one. Verify every file/line anchor cited in the plan against current code before implementing, per the plan's own instruction.

**Anchor verification (done at intake, 2026-08-23, per the plan's own instruction — all current):**

- `internal/settings/settings.go:65-72` — `settingsPath()` returns `~/.rk/settings.yaml`; scalar keys parsed in a growing `switch` (`parse()` :251-290), nested sections already registry-driven (`nestedSections` :198-206).
- `internal/config/config.go:68` — `cfg.SSHHost = os.Getenv("RK_SSH_HOST")`; consumers: `api/router.go:617` (startup seed), `api/health.go:31` (fallback when the `ssh_host` setting is empty), `cmd/rk/serve.go:108` (help text), `.env:13` (commented example), `internal/config/config_test.go:88-97`.
- `internal/tmux/tmux.go:85-96` — `DefaultConfigPath = ~/.rk/tmux.conf`; `configPath = os.Getenv("RK_TMUX_CONF")` else default.
- `cmd/rk/serve.go:133` — `LOG_LEVEL` env read (debug check); dev rig depends on it: `justfile:38` (`LOG_LEVEL=debug … air`) and `scripts/dev.sh:21` (`export LOG_LEVEL=debug`).
- State dir `"rk"` segment: `internal/snapshot/store.go:37-49` (`DefaultDir` → `$XDG_STATE_HOME/rk/snapshots`), `internal/prstatus/prstatus_disk.go:72-85` (`DefaultCachePath` → `$XDG_STATE_HOME/rk/prstatus.json`).
- Ghost anchors: Constitution VII (`fab/project/constitution.md:26` "The `run-kit.yaml` config SHOULD require only project paths"), `docs/specs/architecture.md:95` (`run-kit.yaml # Optional server config (gitignored)`), `docs/specs/api.md:24-25` (override-order table citing `run-kit.yaml`), `internal/fabconfig/fabconfig.go:5` (doc comment "the pattern used by internal/config for run-kit.yaml"), `internal/validate/validate.go:129` (NormalizeColorValue doc comment "settings, run-kit.yaml"), `internal/config/runkit_yaml.go` (22 lines, sole function `FindGitRoot` at :10 — vestigial as claimed).
- Reference pattern confirmed: `~/code/sahil87/hop/src/internal/config/resolve.go` (`configPath()` — `$HOME` only, `filepath.Join`, explicit no-XDG/no-UserConfigDir comment).
- **Discovery**: `~/.rk/` has four tenants beyond the plan's migrations — `internal/push/store.go:39` (web-push store), `internal/codeserver/codeserver.go:40` (code-server bin dir), `internal/daemon/codeserver.go:92,98` (profile + install dir), `internal/daemon/jobs.go:222` (job logs). The plan's "`~/.rk/` retires once the migrations land" is therefore incomplete; these are out of scope here (see Non-goals / Open follow-up).

## Why

Config is scattered across seven surfaces with no stated boundaries and no precedence rule — the wrong home (an env var) is reachable faster than the right one (the `RK_AUTO_NAME` misstep, PR #711). Concretely today: preferences live in `~/.rk/settings.yaml`, deployment binding in env, `ssh_host` exists in BOTH (the one file-loses-to-env… actually settings-wins-over-env case — `api/health.go:31` prefers the setting), `RK_TMUX_CONF` and `LOG_LEVEL` are env-only preferences, and stale docs still describe a `run-kit.yaml` that no longer exists.

If unfixed: every new preference re-litigates its home (and sometimes picks wrong), the daemon/CLI/agents-in-panes process contexts can silently read different config when an env var differs between them, and phases 2/3/4 (settings API, settings pane, tmux.conf ownership) have no foundation to build on.

Why this approach: a **fixed** config root (no `$XDG_CONFIG_HOME`, no `os.UserConfigDir`) makes the path identical in every process context by construction — determinism is the point for a daemon+CLI+agents tool (hop's pattern verbatim). A **registry** makes key addition data-driven instead of scanner-branch growth (the `nestedSections` slice in `internal/settings` already proved this shape for nested sections; this extends it to everything). A stated **override order** with env restricted to deployment-bootstrap keys deletes the ambiguity class entirely. All decisions were settled in the 2026-08-23 brainstorm; this change executes them.

## What Changes

### 1. Fixed config root — `$HOME/.config/run-kit/`

New resolution in `internal/settings` (the package that owns the file; see Assumption 8):

```go
// configDir returns the single fixed config root $HOME/.config/run-kit/.
// The only environment input is $HOME. No $XDG_CONFIG_HOME, no
// os.UserConfigDir (macOS would give ~/Library/Application Support) — the
// path is identical on every platform and in every process context
// (daemon, CLI, agents-in-panes) by construction. Dotfiles users symlink
// the directory.
func configDir() (string, error) {
    home := os.Getenv("HOME") // or os.UserHomeDir(); see Assumption 17
    ...
    return filepath.Join(home, ".config", "run-kit"), nil
}
```

The settings file becomes `~/.config/run-kit/config.yaml`. A test asserts env vars cannot move it: with `XDG_CONFIG_HOME` (and any other candidate env) set to a temp dir, the resolved path still lands under `$HOME/.config/run-kit/`. An exported accessor (e.g. `settings.Dir()`) exposes the root for phase 4 (tmux.conf/tmux.d relocation) without re-deriving it.

### 2. Migrations 1 & 3

Pattern (per plan): fallback-read from the old path, migrate on first write, leave a breadcrumb so nothing silently forks.

**Migration 1 — `~/.rk/settings.yaml` → `~/.config/run-kit/config.yaml`:**
- `Load()`: read the new path; if absent, fallback-read `~/.rk/settings.yaml` (parse unchanged — same format).
- `Save()`: always writes the new path (creating the directory). After the first successful write to the new path, rename the old file to `~/.rk/settings.yaml.migrated` (best-effort; the rename IS the breadcrumb — an old binary that still looks there finds a clearly-marked artifact, not a silently diverging live file).
- No timer, no eager migration at startup: migrate-on-first-write only. A read-only instance keeps fallback-reading the old file indefinitely, which is correct and lossless.

**Migration 3 — `$XDG_STATE_HOME/rk/` → `$XDG_STATE_HOME/run-kit/`:**
- `internal/snapshot/store.go DefaultDir` → `…/run-kit/snapshots`; `internal/prstatus/prstatus_disk.go DefaultCachePath` → `…/run-kit/prstatus.json`. State STAYS XDG-honoring (`$XDG_STATE_HOME` env respected, `~/.local/state` fallback) — deliberate asymmetry vs the config root, safe because Constitution II restricts this dir to droppable, never-authoritative files.
- **MOVE `snapshots/`** (recovery backups are worth preserving): at snapshot-store resolution, if the new dir is absent and the old `…/rk/snapshots` exists, `os.Rename` it into place (best-effort, one-time; parent pre-created). On success, write a breadcrumb file in the old dir (e.g. `$XDG_STATE_HOME/rk/MOVED-to-run-kit`) naming the new path.
- `prstatus.json` may be left behind — it is a startup seed cache; a cold start regenerates it (worst case: one cold-start latency hit).

`~/.rk/` does NOT retire in this change: `tmux.conf`/`tmux.d/` move in phase 4 (migration 2), and four additional tenants were discovered outside the plan's migration list (see Origin discovery + Open follow-up).

### 3. Settings registry (single source of truth)

Replace the scalar-key `switch` growth in `internal/settings/settings.go parse()`/`serialize()` with one registry, each entry carrying: **key, type, default, description, category, `ui` flag, `live` flag**. The registry drives parse and serialize now; phases 2/3 point the API, pane, and palette actions at the same table.

Seed inventory (everything the store holds today plus the two env demotions):

| key | type | default | category | ui | live | notes |
|---|---|---|---|---|---|---|
| `theme` | enum/string | `system` | appearance | yes | yes | existing |
| `theme_dark` | string | `default-dark` | appearance | yes | yes | existing |
| `theme_light` | string | `default-light` | appearance | yes | yes | existing |
| `instance_color` | color descriptor | `""` | appearance | yes | yes | tolerant read via `validate.NormalizeColorValue` (unchanged) |
| `instance_name` | string | `""` | identity | yes | yes | existing |
| `ssh_host` | string | `""` | connectivity | yes | yes | becomes the ONLY ssh-host surface (see §5) |
| `server_colors` | map[string]string | `{}` | appearance | yes | yes | keeps mapSection normalize (colors) |
| `server_flairs` | map[string]string | `{}` | appearance | yes | yes | keeps mapSection normalize (flair set) |
| `board_order` | []string | `[]` | layout | yes | yes | keeps listSection |
| `auto_name` | bool | `false` | behavior | yes | **no** | live-flip is phase 3, not here |
| `tmux_conf` | path string | `""` | advanced | yes | no | NEW — see §5 |
| `log_level` | enum (`info`/`debug`) | `info` | advanced | yes | no | NEW — see §5 |

Behavior-preserving constraints on the refactor:
- Tolerant-read semantics per key are unchanged (quote-strip, `NormalizeColorValue`, flair membership, `strconv.ParseBool`, malformed-entry skip).
- Serialization stays hand-rolled and byte-stable: scalar keys in current order, omit-when-default/empty rules preserved (an untouched settings file round-trips byte-identically), nested sections in registry order, sorted map keys, always-quoted values. No `yaml.v3` for this file (Assumption 9).
- The exported accessor surface (`Load`, `Save`, `Default`, `Get/SetServerColor`, `Get/SetServerFlair`, `Get/SetInstanceColor`, `Get/SetSSHHost`, `Get/SetInstanceName`, `Get/SetBoardOrder`) keeps its signatures — the seven per-key API endpoints in `api/settings.go` continue to compile and behave identically (their hard fold is phase 2).
- fab-kit's fenced reference block and a `config explain` CLI are **deferred** (not in phase-1 scope; Assumption 10). The registry's `description` field is populated now so those become data-only later.

### 4. Override order

`code default < config.yaml < env < CLI flag`, with **env forms existing only for deployment-bootstrap keys** (`RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`). Documented at the registry (package doc comment) and in `docs/specs/api.md`'s Base Configuration table (which currently cites `run-kit.yaml` — rewritten as part of the ghost sweep to describe the real chain: defaults → env → CLI for bootstrap keys; defaults → `config.yaml` for preference keys). In phase 1 the only keys with more than two live layers are `tmux_conf` and `log_level` (config.yaml < undocumented env escape); the order is the stated contract every later key follows.

### 5. Env demotion

- **`RK_SSH_HOST` removed entirely**: delete `SSHHost` from `internal/config.Config` and its `Load()` read (`config.go:12-15,68`); drop the router startup seed (`api/router.go:617`) and the env-fallback arm in `api/health.go:31` (the `ssh_host` setting becomes the only source; the `SetSSHHost` test seam on Server may stay or go with the field — whatever keeps `api/health_test.go` honest); remove the `RK_SSH_HOST` lines from `cmd/rk/serve.go` help text (:108) and the commented example from `.env:13`; update `internal/config/config_test.go`. **New `rk doctor` line**: a check that flags a set-but-ignored `RK_SSH_HOST` (env set → warn "RK_SSH_HOST is no longer read; set the ssh_host key in ~/.config/run-kit/config.yaml"), following the existing `doctorCheck` pattern in `cmd/rk/doctor.go`.
- **`RK_TMUX_CONF` → `tmux_conf` config key**: `internal/tmux/tmux.go:85-96` resolution becomes `RK_TMUX_CONF` env (undocumented per-process test escape, wins per override order) → `tmux_conf` config.yaml key → `DefaultConfigPath` (`~/.rk/tmux.conf`, unchanged until phase 4). Semantics of a set value unchanged: user owns the file, rk performs no ensure/refresh/doctor on it (`EnsureConfig` short-circuit behavior today keyed on the same resolution). Note `internal/tmux` init-time reads must not import a cycle — settings read happens via a small seam (Assumption 18).
- **`LOG_LEVEL` → `log_level` config key** (ui-exposed): `cmd/rk/serve.go:133` reads the setting; the `LOG_LEVEL` env read survives as an undocumented per-process escape (env-wins), because the dev rig depends on it (`justfile:38`, `scripts/dev.sh:21`) and a per-process debug toggle must not mutate the user's config.yaml. Not documented in user-facing help/README.
- **`RK_CODE_SERVER_PORT` stays env** (deployment-shaped) — no change.

### 6. Ghost sweep (`run-kit.yaml` references + vestigial file)

- Constitution VII sentence — covered by §7.
- `docs/specs/architecture.md:95` — delete the `run-kit.yaml` tree line (or replace with `~/.config/run-kit/config.yaml` described where config is documented).
- `docs/specs/api.md:24-25` — rewrite the Base Configuration override table (see §4).
- `internal/fabconfig/fabconfig.go:5` — fix the doc comment ("the pattern used by internal/config for run-kit.yaml" → current reality).
- `internal/validate/validate.go:129` — fix the `NormalizeColorValue` doc comment ("settings, run-kit.yaml" → settings/config.yaml + tmux option readers).
- `internal/config/runkit_yaml.go` — move `FindGitRoot` to `internal/config/gitroot.go`; delete the vestigial file (its name is the last live `run-kit.yaml` ghost). Callers (e.g. riff repo-root derivation) are unaffected — same package, same symbol.

### 7. Constitution amendments

- **IV (Minimal Surface Area)**: replace "Configuration lives in environment variables (`.env` committed, `.env.local` for overrides)" with the layered story — deployment binding in env (`RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`; `.env`/`.env.local` remain the bootstrap vehicle), per-instance preferences in `~/.config/run-kit/config.yaml` behind the settings registry, per-entity state in `@rk_*` tmux options, per-viewer state in localStorage — and carve out the ONE registry-driven settings surface (singular by design; "no settings pages" softens to permit exactly that surface, which phases 2/3 build).
- **VII (Convention Over Configuration)**: the `run-kit.yaml` sentence becomes `config.yaml` — "The `config.yaml` settings file SHOULD require nothing; every key has a working default."
- Bump version (minor — principle semantics amended: 1.9.0 → 1.10.0) and Last Amended date.

## Affected Memory

- `run-kit/configuration`: (new) The config story stated once — fixed root + rationale (determinism across daemon/CLI/pane contexts), the settings registry shape and key inventory, override order, env inventory (bootstrap-only) + undocumented escapes, the boundaries table (config.yaml / @rk_* / localStorage / env / state dir), migrations + breadcrumbs, `~/.rk` remaining tenants.
- `run-kit/architecture`: (modify) Settings store path + registry mention, env-var inventory (RK_SSH_HOST gone, LOG_LEVEL demoted), state-dir rename, `runkit_yaml.go` → `gitroot.go`.
- `run-kit/layout-snapshots`: (modify) Store root becomes `$XDG_STATE_HOME/run-kit/snapshots`; the one-time move + breadcrumb.

## Impact

- **Go backend**: `internal/settings/` (registry rewrite + root + migration 1 — the core of the change), `internal/config/` (SSHHost removal; `runkit_yaml.go` → `gitroot.go`), `internal/tmux/tmux.go` (conf-path resolution seam), `internal/snapshot/store.go` + `internal/prstatus/prstatus_disk.go` (migration 3), `api/router.go` + `api/health.go` (+ their tests) (ssh-host env fallback removal), `cmd/rk/serve.go` (help text, log-level source), `cmd/rk/doctor.go` (RK_SSH_HOST check), `internal/fabconfig/fabconfig.go` + `internal/validate/validate.go` (comment fixes).
- **Docs/governance**: `fab/project/constitution.md` (IV, VII, version), `docs/specs/architecture.md`, `docs/specs/api.md`, `.env`.
- **Not touched**: the seven per-key settings endpoints' behavior (phase 2 folds them), any frontend code, tmux.conf content/ownership/`EnsureConfig` mechanics (phase 4), `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT`, fab-kit's `fab/project/config.yaml`, desktop store, `~/.rk`'s push/code-server/job-log tenants.
- **Tests**: settings round-trip + migration tests (old-path fallback, first-write migrate + breadcrumb, byte-stable serialize), the env-immunity test for the root, snapshot/prstatus path tests (existing tests at the new paths + move-on-first-resolve), config/router/health/doctor test updates. Backend-only: `just test-backend` is the primary gate; e2e should be unaffected (the e2e rig sets a per-run temp `XDG_STATE_HOME`, which keeps honoring the env).
- **User-visible**: existing `~/.rk/settings.yaml` values survive via fallback-read + first-write migration; recovery snapshots survive via the directory move; a set `RK_SSH_HOST` stops working (doctor flags it; release note per plan).

## Open Questions

- None blocking. One follow-up to file OUTSIDE this change (not phase-1 scope): the plan's "`~/.rk/` retires once the migrations land" is incomplete — `internal/push/store.go:39`, `internal/codeserver/codeserver.go:40`, `internal/daemon/codeserver.go:92,98`, and `internal/daemon/jobs.go:222` also live under `~/.rk/` and are covered by no migration. Needs a backlog item (likely "migrate remaining ~/.rk tenants to state/config roots, then retire ~/.rk").

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Config root is the constant `$HOME/.config/run-kit/` via `filepath.Join`; no `$XDG_CONFIG_HOME`, no `os.UserConfigDir`; test asserts env immunity | Plan + invocation state it verbatim; hop pattern verified at `resolve.go:16` | S:95 R:60 A:95 D:95 |
| 2 | Certain | Migrations 1 & 3 only (tmux files are phase 4); pattern = fallback-read old path, migrate on first write, breadcrumb | Plan Migrations section + invocation scope | S:90 R:70 A:90 D:90 |
| 3 | Certain | Registry fields (key, type, default, description, category, ui, live) seeded with the 12-key inventory | Plan enumerates both lists explicitly | S:95 R:75 A:90 D:90 |
| 4 | Certain | Override order code < config.yaml < env < CLI; env forms restricted to `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT` | Plan; RK_CODE_SERVER_PORT explicitly stays env | S:90 R:70 A:90 D:90 |
| 5 | Certain | `RK_SSH_HOST` removed entirely (config read, router seed, health fallback, help text, `.env` example) + doctor set-but-ignored flag | Plan + invocation; all five consumers located and verified | S:95 R:65 A:90 D:95 |
| 6 | Certain | `tmux_conf` config key with unchanged you-own-everything semantics; `RK_TMUX_CONF` env survives undocumented, env-wins | Plan states both halves incl. the MAY-survive escape | S:90 R:75 A:85 D:85 |
| 7 | Confident | `LOG_LEVEL` env read ALSO survives as an undocumented per-process escape (not just the `log_level` key) | Dev rig depends on it (justfile:38, dev.sh:21); a per-process debug toggle must not mutate user config; plan's "kept only if genuinely needed pre-boot" read as permitting the escape while docs point at the key | S:60 R:80 A:75 D:60 |
| 8 | Confident | The config root + config.yaml stay owned by `internal/settings`, which exports the root (e.g. `settings.Dir()`) for phase 4 | Single-owner locality; phase 4 needs only the exported root; avoids a new package for one constant | S:55 R:75 A:80 D:70 |
| 9 | Confident | Keep hand-rolled registry-driven parse/serialize; no yaml.v3 for config.yaml | Preserves tolerant-read + byte-stable omit-when-default output the tests pin; extends the existing `nestedSections` registry precedent; yaml.v3 round-trips would reformat user files | S:50 R:60 A:80 D:65 |
| 10 | Confident | Fenced reference block + `rk config explain` deferred out of phase 1; registry `description` populated now so they become data-only later | Invocation's scope list omits them; plan lists them under the registry/API/pane section that phases 2/3 own | S:45 R:80 A:70 D:60 |
| 11 | Confident | Migration 1 breadcrumb = rename old file to `settings.yaml.migrated` after first successful new-path write; fallback-read until then | Plan offers "breadcrumb (or rename the old file `*.migrated`)" — rename is the self-documenting option and kills silent forking | S:70 R:75 A:80 D:70 |
| 12 | Confident | Migration 3 = path change in `DefaultDir`/`DefaultCachePath` + one-time best-effort `os.Rename` of old `snapshots/` when new dir absent + breadcrumb file in old state dir; `prstatus.json` left behind | Plan explicit on move-vs-drop; rename is atomic same-filesystem; seed cache regenerates by contract (Constitution II) | S:75 R:75 A:85 D:75 |
| 13 | Certain | Ghost-sweep file list is exactly the five verified anchors + `FindGitRoot` → `internal/config/gitroot.go` (same package, delete `runkit_yaml.go`) | All anchors re-verified current at intake; same-package move breaks no callers | S:95 R:85 A:95 D:90 |
| 14 | Certain | Constitution IV/VII amended per plan wording; version 1.9.0 → 1.10.0 + Last Amended 2026-08-23 (or ship date) | Plan gives the amendment content; minor bump matches prior amendment practice | S:85 R:70 A:85 D:85 |
| 15 | Confident | Seven per-key settings endpoints keep byte-identical behavior atop the registry store (fold is phase 2); `~/.rk`'s push/code-server/job-log tenants untouched and flagged for follow-up | Invocation forbids touching the API; discovered tenants are outside every planned migration | S:70 R:80 A:85 D:80 |
| 16 | Confident | Registry `live` flags: true for the nine keys that already apply on next read via per-key endpoints; false for `auto_name` (phase 3 flips it), `tmux_conf`, `log_level` (restart-bound) | Matches current runtime behavior exactly; live-apply machinery itself is phase 3 — flags are declarative here | S:55 R:85 A:75 D:65 |
| 17 | Confident | Root derives `$HOME` via `os.UserHomeDir()` (which reads `$HOME` on Unix), matching the existing settingsPath idiom; the env-immunity test covers `XDG_CONFIG_HOME` and confirms only HOME moves it | hop uses raw `os.Getenv("HOME")`; rk's existing code uses `os.UserHomeDir()` — keeping rk's idiom is behaviorally identical on the platforms rk targets | S:50 R:85 A:80 D:70 |
| 18 | Confident | `internal/tmux`'s conf-path resolution gains the config-key layer via a seam that avoids an import cycle (direct `internal/settings` import if acyclic — verify at apply; else an injected value from the composition root, mirroring how `RK_TMUX_CONF` is read in-package today) | tmux.go resolves at package init today; settings currently imports only validate, so a settings→tmux cycle is unlikely but MUST be verified at apply | S:50 R:70 A:70 D:60 |

18 assumptions (8 certain, 10 confident, 0 tentative, 0 unresolved).
