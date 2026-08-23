# Config final — one root, one registry, one owned tmux file

> Consolidated plan — written 2026-08-23. Merges and SUPERSEDES
> `26-08-22-config-standardization.md` (settings consolidation) and
> `26-08-23-tmux-config-standardization.md` (tmux.conf ownership), baking in
> every decision from the 2026-08-23 brainstorm (record: the "Config
> Sanitization Board" artifact,
> https://claude.ai/code/artifact/eec43218-3b51-49ec-8c2a-35388c5bf619).
> The older docs are kept for their inventories and rationale-of-record;
> anything conflicting here wins. Verify file/line anchors before implementing.

## Problem (condensed)

Config is scattered across seven surfaces with no stated boundaries, no
precedence rule, and no UI beyond piecemeal palette actions — the wrong home
(an env var) is reachable faster than the right one (the RK_AUTO_NAME
misstep, PR #711). Separately, rk's embedded tmux.conf never reaches existing
installs (`EnsureConfig` writes only when missing; `rk update` never touches
it), and users hand-edit the managed file because the `tmux.d/` override
surface is invisible — then lose edits to `init-conf --force`, the only
refresh path offered. Full inventories: superseded docs §Inventory.

## Decisions (all settled 2026-08-23)

### Location & resolution

- **One config root, a CONSTANT**: `$HOME/.config/run-kit/` built with
  `filepath.Join` from `$HOME`. **No `$XDG_CONFIG_HOME` honor, no
  `os.UserConfigDir`** (macOS would give `~/Library/Application Support`).
  This is hop's pattern verbatim (`hop/src/internal/config/resolve.go:16` —
  the path is identical on every platform and every process context by
  construction; a test asserts env vars cannot move it). Determinism is the
  point: rk is a daemon + CLI + agents-in-panes, and an env var that differs
  between those contexts silently forks which config is read. Dotfiles users
  symlink the directory.
- **Everything rk owns lives under that root**: `config.yaml` (the settings
  file), `tmux.conf` (the managed file), `tmux.d/` (user drop-ins). The tmux
  files sit BESIDE config.yaml — tmux.conf is a whole owned file, not a
  registry key. `~/.rk/` retires once the migrations land.
- **State dir**: `$XDG_STATE_HOME/run-kit/` — renamed from `rk` (full tool
  name everywhere). State STAYS XDG-honoring, unlike config: Constitution §II
  restricts it to droppable, never-authoritative files (prstatus seed cache,
  snapshots + died-server recovery backups), so an env mismatch there cannot
  fork behavior. That asymmetry is deliberate and documented.
- **fab-kit is the documented exception** to the fixed-`~/.config` pattern:
  `~/.fab-kit/config.yaml` stays co-located with its version cache (its
  "decision 5; XDG rejected").
- **shll `config-home` standard** (companion deliverable, shll repo): fixed
  `$HOME/.config/<tool-name>/` config path (full tool name, `filepath.Join`,
  no XDG env, no UserConfigDir); override order below; env forms restricted
  to deployment bootstrap keys; XDG-honoring state gated on droppability;
  fab-kit listed as the exception. None of the eight existing standards
  covers this.

### Precedence & env demotion

- **Override order (fab-kit's cascade)**: code default < `config.yaml` < env
  < CLI flag. Safe only because of the companion rule: **env forms exist
  ONLY for deployment bootstrap keys** (`RK_PORT`, `RK_HOST`) — env is never
  an override channel for preference keys.
- **`RK_SSH_HOST` is REMOVED entirely** — the `ssh_host` config key is the
  only surface. UX impact accepted: steady state unchanged (UI/config key
  stays; deeplinks resolve settings-first already); headless provisioning
  falls to the derived `user@hostname` deeplink chain (fine on tailnets,
  loses alias-carried port/user/key until the key is set once). Mitigation:
  an `rk doctor` line flags a set-but-ignored `RK_SSH_HOST`, plus a release
  note; the commented example leaves `.env`. Removing it deletes the one
  file-wins-over-env case, so the override order holds with zero exceptions.
- **`RK_TMUX_CONF` → `tmux_conf` config.yaml key**, the documented
  user-facing surface, semantics unchanged: when set, rk performs no
  ensure/refresh/doctor on the file ("you own everything" mode). The env var
  MAY survive undocumented as a per-process test escape (env-wins per the
  order above suits tests).
- **`LOG_LEVEL` → config.yaml key** (`ui`-exposed); env kept only if
  genuinely needed pre-boot. `RK_CODE_SERVER_PORT` stays env
  (deployment-shaped).

### Settings registry, API, pane

- **A settings registry is the single source of truth**: key, type, default,
  description, category, `ui` flag, `live` flag. Drives parse/serialize
  (replacing the scalar-switch growth in `internal/settings`), the API, the
  pane, and per-setting palette actions. Starting key inventory (everything
  the store holds today plus the two env demotions): `theme`, `theme_dark`,
  `theme_light`, `instance_color`, `instance_name`, `ssh_host`,
  `server_colors` (map), `server_flairs` (map), `board_order` (list),
  `auto_name`, plus new `tmux_conf` and `log_level`. Borrowed from fab-kit: the fenced
  reference block (un-overridden defaults regenerated into the file as a
  commented fence), `config explain <key>` prose on demand, registry-driven
  key addition.
- **API: `GET /api/settings`** (registry + values) and **`POST
  /api/settings`** (partial merge per Constitution IX — present keys set,
  `null` unsets). **HARD FOLD, no shims**: the seven per-key endpoints
  (theme, instance color, instance name, ssh host, server colors, server
  flairs, board order) are deleted in the same change and all frontend
  callers updated — frontend and backend ship in one binary, there are no
  external API consumers, so shims would be compat machinery with no compat
  audience.
- **Settings pane ships as an OVERLAY** (no new route; palette-first entry
  `Settings: Open` + overflow menu): searchable flat list, category headers,
  typed controls from the registry (bool/enum/string/color),
  modified-from-default indicator, "Edit in config.yaml" escape hatch.
  **A `/settings` route promotion is a SEPARATE BACKLOG ITEM** (linkability
  wanted later; not part of this plan).
- **Live application**: registry `live` keys take effect on next read/tick
  (settings API nudges the SSE hub); non-live keys badge "requires restart".
  `auto_name` flips to `live`.

### tmux.conf ownership (mechanism unchanged from the tmux plan, paths updated)

- **`~/.config/run-kit/tmux.conf` is rk-OWNED, declared by a managed header
  with a content hash at the TOP**:
  `# rk-managed sha256:<hash-of-body> — DO NOT EDIT; overrides go in ~/.config/run-kit/tmux.d/`.
  Three-state check: **missing** → write the embed; **managed & stale**
  (body matches its own stamp, embed differs) → force-write + reload sweep;
  **hand-edited** (hash mismatch or no header) → hands off, doctor drift
  line carries the migration recipe.
- **Refresh at daemon start** (the `EnsureConfig` call site,
  `cmd/rk/serve.go:122`), never a timer — updates restart the daemon. The
  reload sweep (`tmux.ReloadConfig`) enumerates LIVE rk servers filtered to
  live sockets (load-bearing: any tmux command on a dead socket resurrects a
  server).
- **`tmux.d/user.conf` is the standard override file**, scaffolded as a
  commented starter by every scaffold path; numeric-prefixed siblings
  (`10-*.conf`) stay available for ordering. No new mechanism — the sourced
  drop-in dir is promoted, not replaced.
- **Hand-edited managed confs are never clobbered, never auto-migrated**;
  the doctor line and the init-conf already-exists error state the recipe.
- **Docs, layered cheapest-first**: the header itself → `rk doctor` → CLI
  copy (init-conf success/error name `user.conf`; `--force` help scoped to
  the managed file) → README + docs/site "Customizing tmux" section
  (standards-checked via `shll standards`) → NOT the web app. Caveat
  documented wherever the refresh is mentioned: `history-limit`-class
  options apply only to panes created after reload.

### Sweeps & amendments

- **Constitution amendments**: IV — replace "configuration lives in
  environment variables" with the layered story; carve out the ONE
  registry-driven settings surface (singular by design). VII — `run-kit.yaml`
  sentence becomes `config.yaml` ("SHOULD require nothing; every key has a
  working default").
- **Ghost sweep**: stale `run-kit.yaml` references (Constitution VII,
  `docs/specs/architecture.md:95`, `docs/specs/api.md:24-25`,
  `internal/fabconfig/fabconfig.go:5`, `validate.go:129`); `FindGitRoot`
  moves out of the vestigial `runkit_yaml.go` (e.g. `gitroot.go`).

### Boundaries, stated once (recorded in memory at hydrate)

| Kind of value | Home |
|---|---|
| Per-instance behavior / prefs | `config.yaml` |
| Per-entity (server/session/window/pane) | `@rk_*` tmux options |
| Per-viewer / device | localStorage |
| Deployment binding | env (`RK_PORT`, `RK_HOST`) |
| State (snapshots, caches — droppable only) | `$XDG_STATE_HOME/run-kit/` |

## Migrations

All three follow the same pattern — fallback-read from the old path,
migrate on first write, leave a breadcrumb (or rename the old file
`*.migrated`) so nothing silently forks:

1. `~/.rk/settings.yaml` → `~/.config/run-kit/config.yaml`
2. `~/.rk/tmux.conf` + `~/.rk/tmux.d/` → `~/.config/run-kit/` (the managed
   header's three-state logic applies at the NEW path; an old hand-edited
   conf migrates per the doctor recipe, never automatically)
3. `$XDG_STATE_HOME/rk/` → `$XDG_STATE_HOME/run-kit/` — contents are
   droppable by contract, but MOVE (don't drop) `snapshots/` to preserve
   recovery backups; `prstatus.json` may simply be left behind

`~/.rk/` retires when all three have landed.

## Phasing

1. **Root + registry core** (backend-only, ships alone): fixed-path
   resolution, migrations 1 & 3, settings registry refactor, override order,
   env demotion (`RK_SSH_HOST` removal + doctor flag, `LOG_LEVEL` +
   `tmux_conf` keys), ghost sweep, constitution amendments.
2. **Settings API**: registry `GET/POST /api/settings` + hard fold of the
   seven per-key endpoints (frontend callers updated in the same change).
3. **Settings pane**: overlay UI + palette actions + live-apply plumbing
   (`auto_name` → live).
4. **tmux ownership**: managed header + three-state refresh + reload sweep +
   `user.conf` scaffold + doctor drift line + migration 2 + docs (README /
   docs/site / CLI copy). Depends on phase 1 only for the new root path;
   can run parallel to 2/3. Unit tests: three-state decision, live-socket
   filter.
5. **Companions** (separate repos / backlog, already filed): the shll
   `config-home` standard write-up — shll backlog `[km8t]` (execution
   already started 2026-08-23); the `/settings` route promotion — run-kit
   main backlog `[3n73]`.

Each phase is a separate fab change; 1 is prerequisite to 2/3/4.

## Non-goals / guardrails (merged)

- No per-user profiles or auth-scoped settings; no remote-host settings sync.
- No merge of the desktop shell's `run-kit-desktop` store (separate app).
- No migration of `@rk_*` options or localStorage prefs into the file.
- fab-kit's `fab/project/config.yaml` untouched (fab-owned; rk stays a reader).
- One registry-driven settings surface — no per-feature settings screens.
- No new tmux override mechanism — `tmux.d/` is promoted, not replaced.
- No timer/watcher refresh (daemon start only); no web-app tmux surface.
- No change to what the embedded tmux.conf CONTAINS.

## Relation to in-flight work

`260822-q675-operator-auto-name-idle` (PR #711) put `auto_name` in the
CURRENT store (`~/.rk/settings.yaml`), read at hub construction — phase 1
relocates the file under it, phase 3 makes the key live; nothing blocks.
The `history-limit 100000` embed line is the first beneficiary of phase 4's
refresh — most existing installs predate it.
