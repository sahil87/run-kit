# Config relocation + consolidation — one settings story, one file, one pane

> Backlog detail doc — written 2026-08-22 after the RK_AUTO_NAME discussion on PR #711
> surfaced that run-kit has no coherent config story: an env-var layer that was being
> used as the default home for new settings, a server-side `~/.rk/settings.yaml` most
> of the codebase (and the agent working on it) had forgotten exists, ghost references
> to a `run-kit.yaml` removed long ago, and two constitution sentences describing
> config mechanisms that no longer match reality. Decisions recorded here were made
> in that session (path naming, env demotion, settings-pane direction).
> Verify file/line anchors before implementing.

## Problem

Adding one boolean ("gate auto-name behind a setting") had no obvious home, and the
wrong one (an env var) was reachable faster than the right one (the existing settings
store). Config today is scattered across seven surfaces with no stated boundaries, no
precedence rule, and no UI exposure beyond piecemeal palette actions. "Soon we are
going to have lots of different setting options" — without consolidation, each lands
wherever the author happens to look first.

## Inventory — where configuration lives today (verified 2026-08-22)

1. **Env vars via `internal/config`** (`config.go` — `Load()`): `RK_PORT`, `RK_HOST`
   (deployment binding), `RK_SSH_HOST` (fallback UNDER settings — see precedence mess
   below), `RK_CODE_SERVER_PORT` (override for an externally managed code-server).
   Scattered elsewhere: `RK_TMUX_CONF` (tmux config override), `LOG_LEVEL`,
   `RK_RIFF_SUBPROC` (internal sentinel, not config), `RK_REAL_TARBALL` (test-only),
   `XDG_STATE_HOME`/`XDG_DATA_HOME` (state dirs). `.env` (committed) + `.env.local`
   (overrides) feed the dev workflow; Vite reads `RK_PORT` too.
2. **`~/.rk/settings.yaml` via `internal/settings`** — the real per-instance settings
   store, UI-written through `POST /api/settings/*` handlers (`api/settings.go`):
   `theme`/`theme_dark`/`theme_light`, `instance_color`, `instance_name`, `ssh_host`,
   `server_colors`, `server_flairs`, `board_order`. Hand-rolled tolerant line
   parser/serializer (`settings.go` `parse()` ~:215 scalar switch + `nestedSections`
   registry, `serialize()` ~:283). Non-XDG path. The frontend theme flow proves the
   model works: `theme-context.tsx` paints from the localStorage cache
   (`runkit-theme*`), then loads the API value and reconciles.
3. **`@rk_*` tmux user options** — per-server/session/window/pane runtime prefs and
   state (colors, flair, marker, role, url, type, chat identity, agent_state,
   ephemeral). Constitution X territory; NOT part of this consolidation.
4. **localStorage** — per-viewer UI prefs (theme cache, terminal font size, rail/
   sidebar state, compose drafts, layout params). Correctly per-viewer; stays.
5. **Desktop shell** — `~/.config/run-kit-desktop/` (Electron userData): `hosts.json`,
   `windows.json`. Separate app, separate store; stays, but note the naming precedent:
   `run-kit-*`, not `rk`.
6. **`$XDG_STATE_HOME/rk/`** — snapshots, seed caches. State, not config (Constitution
   II carve-outs); untouched here.
7. **Ghosts** — `run-kit.yaml` no longer exists anywhere but is still referenced by:
   Constitution VII ("The `run-kit.yaml` config SHOULD require only project paths"),
   `docs/specs/architecture.md:95`, `docs/specs/api.md:24-25` (stale port/host
   precedence), `internal/fabconfig/fabconfig.go:5` ("mirrors the pattern used by
   internal/config for run-kit.yaml" — no such pattern exists), `validate.go:129`,
   and the vestigial filename `internal/config/runkit_yaml.go` (contains only
   `FindGitRoot`). History: server config (q8a9) → killed for env vars (9738fdb8,
   whence Constitution IV's sentence) → resurrected as a color store (PR #140) →
   killed again when colors moved to tmux options (#610).

Read-only sibling, out of scope: `fab/project/config.yaml` is fab-kit's (rk reads riff
presets from it via `internal/fabconfig`); it stays fab-owned.

## fab-kit standards worth borrowing (compared 2026-08-22)

fab-kit's config (`fab/project/config.yaml` + `fab config`) has four ideas run-kit
should steal:

- **Fenced reference block**: un-overridden defaults are auto-regenerated INTO the
  config file as a commented fence ("move above the fence and uncomment to
  override") — the file documents itself and upgrades refresh the docs.
- **`fab config explain <key>`**: full prose per key, on demand.
- **Scoping**: project config vs `fab config set --system` machine-wide.
- **Registry-driven**: adding a key is a registry entry, not new parser branches —
  run-kit's `nestedSections` already gestures at this; finish the thought.

## Design decisions

- **One canonical file: `~/.config/run-kit/config.yaml`** (respect `$XDG_CONFIG_HOME`;
  `run-kit`, NOT `rk` — decided 2026-08-22, matches the `run-kit-desktop` precedent).
  `internal/settings` stays the single loader. Migration: on load, fall back to
  `~/.rk/settings.yaml`; on first save to the new path, migrate content and leave a
  breadcrumb (or rename the old file `settings.yaml.migrated`) so nothing silently
  forks.
- **A settings registry is the single source of truth**: key, type, default,
  description, category, and two flags — `ui` (exposed on the pane) and `live`
  (applies without daemon restart). The registry drives parse/serialize (replacing
  the scalar switch's growth), the settings API, the pane rendering, and per-setting
  palette actions. This is the VSCode model: the UI is a projection of the registry,
  never hand-built per setting.
- **Env vars are demoted to deployment bootstrap only** — values needed at/before
  process start, per-deployment: `RK_PORT`, `RK_HOST`. Env is NOT an override channel
  for preference keys (that technique caused the RK_AUTO_NAME misstep). Precedence,
  one sentence: **code default < config.yaml < env (deployment keys only) < CLI
  flag**. Existing overlaps to resolve under that rule: `ssh_host` (today
  settings-wins-over-env — keep file-wins, deprecate `RK_SSH_HOST` to bootstrap-seed
  or remove), `RK_CODE_SERVER_PORT` (deployment-shaped; stays env), `RK_TMUX_CONF`
  and `LOG_LEVEL` (move to config.yaml as `ui`-exposed keys, env kept only if
  genuinely needed pre-boot).
- **Settings pane, VSCode-like**: searchable flat list, category group headers, typed
  controls from the registry (bool toggle, enum select, string, color), a
  "modified from default" indicator, and the raw-file escape hatch ("Edit in
  config.yaml"). Entry is palette-first (`Settings: Open`, Constitution V) plus the
  overflow menu. Form factor to decide at implementation: an overlay pane (no new
  route; matches the palette pattern) vs a `/settings` route (linkable, closer to
  VSCode) — Constitution IV's fixed-route-set pressure favors the overlay; pick one
  and amend accordingly.
- **Live application**: registry `live` flag; live keys take effect on next read/tick
  (the settings API can nudge the SSE hub), non-live keys badge "requires restart"
  in the pane, exactly like VSCode. `auto_name` (currently read once at hub
  construction — `initSSEHub` nils the tracker when off) becomes `live` here.
- **API consolidation**: `GET /api/settings` returns registry + values;
  `POST /api/settings` partial-merge per Constitution IX's documented body contract
  (present keys set, `null` unsets). Existing per-key endpoints
  (`/api/settings/theme`, instance color/name, ssh host, server colors/flairs,
  board order) stay as compat shims or fold in — decide at implementation; the
  frontend theme flow (localStorage cache + API reconcile) is the pattern every
  pane-exposed setting inherits.
- **Boundaries stated once** (and recorded in memory at hydrate): per-instance
  behavior/prefs → `config.yaml`; per-entity (server/session/window) → `@rk_*`
  options; per-viewer/device → localStorage; deployment → env; state →
  `$XDG_STATE_HOME/rk` (never config).
- **Constitution amendments**: IV — replace "Configuration lives in environment
  variables" with the layered story above, and carve out the settings pane (today it
  says "no settings pages"; the pane needs an explicit, bounded exception — one
  registry-driven surface, not per-feature settings screens). VII — replace the
  `run-kit.yaml` sentence with `config.yaml` ("SHOULD require nothing; every key has
  a working default").
- **Stale-reference sweep**: the Ghosts list above (two specs, two code comments, the
  `runkit_yaml.go` filename — `FindGitRoot` moves somewhere honest, e.g.
  `internal/config/gitroot.go`).

## Phasing

1. **Relocate + registry core** (backend-only): new path + migration, registry
   refactor of `internal/settings`, precedence rule, env demotions, ghost sweep,
   constitution amendments. Ships alone; nothing user-visible changes except the
   file location.
2. **Settings API**: `GET/POST /api/settings` registry-driven; compat decision for
   per-key endpoints.
3. **Settings pane**: VSCode-like UI + palette actions + live-apply plumbing
   (including flipping `auto_name` to `live`).
4. **Stragglers**: `LOG_LEVEL` / `RK_TMUX_CONF` moves, `RK_SSH_HOST` deprecation,
   fold-or-keep on legacy endpoints.

Each phase is a separate fab change; 1 is prerequisite to 2/3, 4 is independent
cleanup after 1.

## Non-goals / guardrails

- No per-user profiles or auth-scoped settings (single-operator instance).
- No remote-host settings sync (each instance owns its file).
- No merge of the desktop shell's `run-kit-desktop` store (different app).
- No migration of `@rk_*` options or localStorage prefs into the file — the
  boundaries section exists precisely to keep those where they are.
- fab-kit's `fab/project/config.yaml` untouched (fab-owned; rk stays a reader).
- No settings screens outside the one registry-driven pane (Constitution IV's
  amended exception is singular by design).

## Relation to in-flight work

`260822-q675-operator-auto-name-idle` (PR #711) moves its gate from `RK_AUTO_NAME`
to `auto_name` in the CURRENT settings store (`~/.rk/settings.yaml`), read at hub
construction — deliberately not waiting for this plan. Phase 1 relocates the file
under it; phase 3 makes the key live. Nothing in q675 blocks on this doc.
