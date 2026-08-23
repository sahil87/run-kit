---
type: memory
description: "run-kit's configuration story: fixed root $HOME/.config/run-kit/ (no XDG_CONFIG_HOME), the internal/settings registry (key/type/default/description/category/ui/live) + 12-key inventory behind the GET/POST /api/settings pair (partial merge, all-or-nothing validation), override order (code default < config.yaml < env < CLI flag; env restricted to RK_PORT/RK_HOST/RK_CODE_SERVER_PORT + undocumented RK_TMUX_CONF/LOG_LEVEL escapes), value-home boundaries, migrations with breadcrumbs, ~/.rk tenants."
---
# Configuration

**Domain**: run-kit

## Overview

run-kit's configuration story: one fixed config root, one registry-driven settings file, one stated override order, and stated boundaries for which kind of value lives in which home. The store is `internal/settings`; the web surface is the single registry-driven settings surface carved out by Constitution §IV (no second settings surface may be added).

## Config Root

The config root is the constant `$HOME/.config/run-kit/`, built with `filepath.Join` from `os.UserHomeDir()`, owned by `internal/settings` and exported as `settings.Dir()`. The resolution never consults `$XDG_CONFIG_HOME` and never uses `os.UserConfigDir` — only `$HOME` moves it, and a test pins that env vars cannot. The settings file is `~/.config/run-kit/config.yaml`. (li54)

## Settings Registry

`internal/settings` defines one registry — a `[]registryEntry` table — that is the single source of truth for every settings key and drives both `parse()` and `serialize()`. Each entry carries **key, kind (type), default, description, category, `ui` flag, `live` flag**; scalar entries carry parse/serialize hooks, nested entries (maps, lists) carry a section built by `mapSection`/`listSection`. Slice order IS serialization order: scalar keys first, then nested sections. Adding a key is one registry entry — no new scanner branches.

Serialization stays hand-rolled (line-scanner parse + string-builder serialize — no yaml.v3) and byte-stable: tolerant reads per key (quote-strip, `validate.NormalizeColorValue`, flair-set membership, `strconv.ParseBool`, malformed-entry skip), omit-when-default/empty, nested sections with sorted map keys and quoted values. An untouched settings file round-trips byte-identically.

The 12-key inventory:

| key | type | default | category | ui | live | notes |
|---|---|---|---|---|---|---|
| `theme` | enum/string | `system` | appearance | yes | yes | UI color mode |
| `theme_dark` | string | `default-dark` | appearance | yes | yes | dark-mode theme |
| `theme_light` | string | `default-light` | appearance | yes | yes | light-mode theme |
| `instance_color` | color descriptor | `""` | appearance | yes | yes | tolerant read via `validate.NormalizeColorValue` |
| `instance_name` | string | `""` | identity | yes | yes | display-name override |
| `ssh_host` | string | `""` | connectivity | yes | yes | the ONLY ssh-host surface — no env form exists |
| `server_colors` | map[string]string | `{}` | appearance | yes | yes | mapSection with color normalize |
| `server_flairs` | map[string]string | `{}` | appearance | yes | yes | mapSection with flair-set membership normalize |
| `board_order` | []string | `[]` | layout | yes | yes | listSection |
| `auto_name` | bool | `false` | behavior | yes | no | read at hub construction — applies on daemon restart |
| `tmux_conf` | path string | `""` | advanced | yes | no | user owns the file; rk does no ensure/refresh on it |
| `log_level` | enum (`info`/`debug`) | `info` | advanced | yes | no | read at serve startup |

`live: false` keys are restart-bound (read once at hub/tmux/serve construction); `live: true` keys apply on next read. The exported accessor surface (`Load`, `Save`, `Default`, `Get/SetServerColor`, `Get/SetServerFlair`, `Get/SetInstanceColor`, `Get/SetSSHHost`, `Get/SetInstanceName`, `Get/SetBoardOrder`) sits over the registry. (li54)

## Settings HTTP API

The entire settings HTTP surface is one registry-driven endpoint pair in `api/settings.go` (see [architecture](/run-kit/architecture.md) § REST API for the endpoint rows). The registry exports its metadata read-side (`KeyInfo` + `Registry()`, registry slice order) plus generic per-key JSON value read/apply hooks (`ReadValue`/`ApplyValue`) — value normalization and value-shape validation live with the registry entry, reusing `internal/validate`; board-order **name** validity (`tmux.ValidBoardName`) and duplicate rejection stay in the API handler (`internal/tmux` imports `internal/settings`, so settings calling into tmux would be an import cycle).

- **`GET /api/settings`** → `{"settings": [{key, kind, default, description, category, ui, live, value}]}` — one object per registry entry, in registry order, snake_case registry key names verbatim, values in natural JSON types: `null` for unset string scalars, maps as objects (possibly `{}`), `board_order` as an array (possibly `[]`), `auto_name` as a bool.
- **`POST /api/settings`** — a flat JSON object of registry keys, partial merge per Constitution §IX: present keys set, absent keys untouched, `null` unsets (resets to the registry default). String scalars are trimmed, trimmed-to-empty treated as `null` (except `theme`/`theme_dark`/`theme_light`, whose defaults are non-empty — a trimmed-to-empty non-null value is a 400). Map keys merge **per entry** (an entry `null` unsets that entry, other entries untouched; a top-level `null` clears the whole map); `board_order` replaces wholesale (top-level `null` ≡ `[]`). The whole body is validated before a single `Load → apply-all → Save` — an unknown key, malformed body, or any per-key validation failure is a 400 with nothing persisted. Success is `200 {"status": "ok"}`; a successful body containing `board_order` broadcasts the server-global `board-order` SSE event (see architecture § SSE Hub). No other key has a broadcast side effect. (f1ot)

## Override Order & Env Inventory

Override order: **code default < config.yaml < env < CLI flag**. Env forms exist ONLY for deployment-bootstrap keys: `RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT` (`.env` committed, `.env.local` for overrides — the bootstrap vehicle). The only other env reads are two **undocumented per-process escapes** that win over their config.yaml keys but are never user-facing: `RK_TMUX_CONF` (over `tmux_conf`) and `LOG_LEVEL` (over `log_level` — the dev rig depends on it via `justfile`/`scripts/dev.sh`). Preference keys have no env form. `rk doctor` flags a set-but-ignored `RK_SSH_HOST` (no reader remains; the hint points at the `ssh_host` key). (li54)

## Boundaries

| Kind of value | Home |
|---|---|
| Per-instance behavior / prefs | `~/.config/run-kit/config.yaml` |
| Per-entity (server/session/window/pane) | `@rk_*` tmux options |
| Per-viewer / device | localStorage |
| Deployment binding | env (`RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`) |
| State (snapshots, caches — droppable only) | `$XDG_STATE_HOME/run-kit/` |

## Migrations & Breadcrumbs

Migrations follow one pattern: fallback-read from the old path, migrate on first write, leave a breadcrumb so nothing silently forks. Two have landed:

- **Settings file**: `Load()` reads `~/.config/run-kit/config.yaml`, fallback-reading the legacy `~/.rk/settings.yaml` (same format) when the new file is absent; `Save()` always writes the new path and then renames a still-present legacy file to `~/.rk/settings.yaml.migrated` (best-effort — a rename failure never fails the save). A read-only instance keeps fallback-reading the old file indefinitely, losslessly.
- **State dir**: `$XDG_STATE_HOME/run-kit/` (snapshots at `…/run-kit/snapshots`, prstatus cache at `…/run-kit/prstatus.json`), still XDG-honoring with the `~/.local/state` fallback — a deliberate asymmetry vs the config root, safe because Constitution §II restricts this dir to droppable, never-authoritative files. On snapshot-store first use, when the new dir is absent and the legacy `…/rk/snapshots` exists, the old dir is moved (`os.Rename`, best-effort, one-time) and a `MOVED-to-run-kit` breadcrumb file is left in the legacy dir naming the new path; a failed move degrades to cold-start behavior, never an error. The legacy `prstatus.json` is left behind — it is a startup seed cache that regenerates cold.

`~/.rk/` still has tenants covered by no migration: the web-push store (`internal/push`), the code-server bin dir (`internal/codeserver`) and profile/install dirs (`internal/daemon`), job logs (`internal/daemon/jobs.go`), and `tmux.conf`/`tmux.d/` (whose relocation is a later phase). (li54)

## Requirements

### Requirement: Fixed config root
The config root SHALL be `$HOME/.config/run-kit/`, built with `filepath.Join` from `os.UserHomeDir()`, and MUST NOT consult `$XDG_CONFIG_HOME` or `os.UserConfigDir`.

#### Scenario: Env cannot move the root
- **GIVEN** `XDG_CONFIG_HOME=/some/tmp` and `HOME=/test/home`
- **WHEN** the settings path is resolved
- **THEN** it is `/test/home/.config/run-kit/config.yaml`

### Requirement: Registry as single source of truth
Every settings key SHALL be one registry entry carrying key/type/default/description/category/ui/live; adding a key MUST NOT require new parse/serialize branches, nor new HTTP value plumbing — the registry's generic value read/apply hooks serve `GET`/`POST /api/settings` for every key.

### Requirement: Settings mutations are all-or-nothing
`POST /api/settings` SHALL validate the entire body before any write; an unknown key, malformed body, or any per-key validation failure MUST be a 400 with nothing persisted.

#### Scenario: Unknown key persists nothing
- **GIVEN** a body `{"theme": "dark", "bogus_key": 1}`
- **WHEN** POSTed to `/api/settings`
- **THEN** the response is 400 and the stored `theme` is unchanged

### Requirement: Byte-stable serialization
An existing settings file with values unchanged SHALL round-trip byte-identically through load + save (omit-when-default, scalar order, quoted values, sorted map keys).

### Requirement: Env restricted to bootstrap keys
Env forms SHALL exist only for `RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`; a preference key (e.g. `ssh_host`) SHALL resolve from code default and config.yaml only.

#### Scenario: Preference key ignores env
- **GIVEN** `RK_SSH_HOST=devbox` in the environment and no `ssh_host` setting
- **WHEN** `GET /api/health` is served
- **THEN** the response carries no `sshHost`

### Requirement: Breadcrumb migrations
A migration SHALL fallback-read the old path, migrate on first write, and leave a self-documenting breadcrumb (`settings.yaml.migrated`, `MOVED-to-run-kit`); a failed breadcrumb/move MUST NOT fail the operation and MUST degrade to cold-start behavior.

## Design Decisions

### Fixed config root, no XDG
**Decision**: `$HOME/.config/run-kit/` as a `filepath.Join` constant; only `$HOME` moves it.
**Why**: rk is a daemon + CLI + agents-in-panes — an env var differing between those contexts silently forks which config is read; determinism by construction (hop's proven pattern). Dotfiles users symlink the directory.
**Rejected**: `os.UserConfigDir` (macOS → `~/Library/Application Support`, path differs per platform); honoring `$XDG_CONFIG_HOME` (per-process forkability is the exact failure mode).
*Introduced by*: 260823-li54-config-root-registry-core

### Hand-rolled registry-driven serializer
**Decision**: keep the line-scanner parse + string-builder serialize, driven by the registry.
**Why**: preserves tolerant-read semantics and byte-stable omit-when-default output the tests pin; extends the proven `nestedSections` registry shape to all keys.
**Rejected**: `yaml.v3` marshal/unmarshal — reformats user files, loses omit-when-default byte-stability, adds comment-handling complexity.
*Introduced by*: 260823-li54-config-root-registry-core

### Breadcrumb by rename
**Decision**: migration breadcrumbs are self-documenting filesystem artifacts — the old settings file renamed `*.migrated`; the state move leaves a `MOVED-to-run-kit` marker file.
**Why**: an old binary or a curious user finds a clearly-marked artifact instead of a silently diverging live file.
**Rejected**: deleting the old file (destroys the rollback path); leaving it live (silent fork — two writers, two truths).
*Introduced by*: 260823-li54-config-root-registry-core

### Env escapes stay undocumented
**Decision**: `RK_TMUX_CONF` and `LOG_LEVEL` survive as per-process env escapes that win over their config.yaml keys, with no user-facing documentation.
**Why**: a per-process test/debug toggle must not mutate the user's config.yaml, and the dev rig exports `LOG_LEVEL=debug` (`justfile`, `scripts/dev.sh`).
**Rejected**: deleting the env reads (breaks the dev rig and per-process testing); documenting them (grows the env surface the override order just restricted).
*Introduced by*: 260823-li54-config-root-registry-core

### GET shape: array of full registry entries
**Decision**: `{"settings": [{key, kind, default, description, category, ui, live, value}]}` in registry order, snake_case registry key names verbatim.
**Why**: a registry-driven settings surface renders typed controls straight from this — one payload, ordered, self-describing; null-for-unset preserves the read contract the per-key GETs carried.
**Rejected**: split `{registry: [...], values: {...}}` (two structures to zip client-side); values-only map (drops the metadata a registry-driven surface needs, defeating the registry).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

### Value plumbing in registry hooks, board-name validation at the API layer
**Decision**: registry entries own generic JSON value read/apply hooks (normalization + value-shape validation lives with the entry, reusing `internal/validate`); board-order **name** validity (`tmux.ValidBoardName`) and duplicate rejection stay in the API handler.
**Why**: keeps "adding a key is one registry entry" true for the API path; `internal/tmux` imports `internal/settings` (tmux.go), so settings calling into tmux is an import cycle — the API package already imports both.
**Rejected**: a per-key switch in `api/settings.go` (reintroduces per-key growth at the HTTP layer); moving `ValidBoardName` into `internal/validate` (churns `api/boards.go` callers for no behavioral gain).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

### Per-entry map merge
**Decision**: map-kind keys merge per-entry with `null` unsetting one entry; top-level `null` clears the map; `board_order` replaces wholesale.
**Why**: mirrors the `SetServerColor(server, color *string)` one-entry semantics so client setters stay one-entry-sized; a full-map replace would force every color-picker click to read-modify-write the whole map client-side (racy across tabs).
**Rejected**: wholesale map replacement (race-prone, bigger client diffs); JSON-merge-patch RFC 7386 wholesale-object semantics (breaks the one-entry setter shape).
*Introduced by*: 260823-f1ot-settings-api-hard-fold

See [architecture](/run-kit/architecture.md) § `internal/settings` for the package-level contract and [layout-snapshots](/run-kit/layout-snapshots.md) for the snapshot store under the state root.
