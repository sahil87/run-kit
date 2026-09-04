---
type: memory
description: "run-kit's configuration story: fixed root $HOME/.config/run-kit/ (no XDG_CONFIG_HOME; test-only RK_CONFIG_DIR override); the internal/settings registry and 12-key inventory behind /api/settings; override order code default < config.yaml < env < CLI flag, env limited to RK_PORT/RK_HOST/RK_CODE_SERVER_PORT; value-home boundaries; the rk-owned hash-stamped managed tmux.conf and its `@rk_srv_managed`-gated reload paths; breadcrumb migrations, ~/.rk tenants, the cb/ code-bridge state tenant."
---
# Configuration

**Domain**: run-kit

## Overview

run-kit's configuration story: one fixed config root, one registry-driven settings file, one stated override order, and stated boundaries for which kind of value lives in which home. The store is `internal/settings`; the web surface is the single registry-driven settings surface carved out by Constitution §IV (no second settings surface may be added).

## Config Root

The config root is the constant `$HOME/.config/run-kit/`, built with `filepath.Join` from `os.UserHomeDir()`, owned by `internal/settings` and exported as `settings.Dir()`. The resolution never consults `$XDG_CONFIG_HOME` and never uses `os.UserConfigDir` — only `$HOME` moves it, and a test pins that env vars cannot. The settings file is `~/.config/run-kit/config.yaml`; the root also holds the rk-managed `tmux.conf` and the `tmux.d/` drop-in dir (§ Managed tmux.conf). (li54)

One test-only carve-out relocates the root: `RK_CONFIG_DIR` (const `settings.ConfigDirEnv`), read in-package via `os.Getenv` at `Dir()` — the same class of unset-means-production-identical escape as `RK_SERVER_ALLOWLIST` and `RK_TMUX_CONF`, never user-facing deployment configuration. Unset or whitespace-only ⇒ behavior byte-identical to the fixed root; set ⇒ `Dir()` returns the value verbatim, `configPath()` follows (`{value}/config.yaml`), and `Save`'s existing `MkdirAll` creates the relocated root. While the override is active the legacy `~/.rk/settings.yaml` fallback-read and breadcrumb rename are suppressed (`configRootOverridden` gates both), so an isolated run never reads or writes the real `$HOME`. Every consumer of `Dir()`/`configPath()` (`/api/settings`, board persistence, PWA accent read) inherits the override together; the managed tmux.conf path (`tmux.DefaultConfigPath`) is computed independently in `internal/tmux` and deliberately does NOT move. The e2e harness is the consumer — see [test-sockets](/run-kit/test-sockets.md) § Per-Run Config-Root Isolation. (y60c)

## Managed tmux.conf

The default tmux.conf at `~/.config/run-kit/tmux.conf` is **rk-owned**, declared in-band by a hash-stamped first line:

```
# rk-managed sha256:<hex> — DO NOT EDIT; overrides go in ~/.config/run-kit/tmux.d/
```

where `<hex>` is the SHA-256 lowercase-hex digest of the body (everything after the header line). Every rk write of the file goes through one shared managed write path (`writeManagedConfig` in `internal/tmux/managedconf.go`, riding named header prefix/suffix constants) and stamps the hash of what it wrote. A pure classifier (`ClassifyManagedConf` over content; `ClassifyConfigFile` over a path — shared by the ensure path and the doctor row so both agree on every state) sorts the on-disk file against the embedded default into four states: **missing** (stat NotExist) → write header + embed; **managed & current** (header present, body hashes to its own stamp, body == embed) → no-op; **managed & stale** (stamp verifies, body ≠ embed) → force-write the new embed; **hand-edited** (no header, or stamp mismatch) → hands off — never written, never auto-migrated.

The refresh runs at **daemon start only** — `tmux.EnsureConfig()` at the `cmd/rk/serve.go` serve site; no timer, no watcher (updates restart the daemon). Only a stale→force-write transition triggers the **reload sweep** (`tmux.RefreshSweep`): enumerate servers via `tmux.ListServers` (live-socket-probed — load-bearing, since a tmux command on a dead socket resurrects a server) and `ReloadConfig` each, per-server failures logging and continuing, the sweep never failing daemon start. **Every managed-conf apply path gates on the `@rk_srv_managed` provenance mark** ([tmux-sessions](/run-kit/tmux-sessions.md) § Server-Scoped User Options) — rk never sources its conf into an external (unmarked) server: the sweep checks `IsManagedServer` per server (the `sweepIsManaged` seam beside `sweepListServers`/`sweepReloadConfig`; a skipped external logs at debug, the sweep continues), the WS-attach reload (`api/terminals_ws.go` `reloadConfigForAttach`, seams `attachIsManaged`/`attachReloadConfig`) reloads only for managed servers, at most once per server per daemon lifetime, and fully async — a synchronous per-server once-guard on the `Server` struct admits one goroutine that runs the managed check + reload + legacy sweep off the attach path (zero execs under the terminal switch mask); a read failure skips with a debug log AND releases the guard so a later attach retries, an external verdict skips and consumes it (adopt sources the conf itself), and the attach is unchanged either way (`-f` still applies the conf at client birth for servers rk starts) (260904-71yx) — and `POST /api/tmux/reload-config` (`api/tmux_config.go`, seam `reloadIsManaged`) returns `200 {"status":"skipped","reason":"external"}` for an external target or a failed managed check — a report, never an error, never a 5xx. The adopt verb (`POST /api/servers/adopt`, `rk mux adopt`) is the one path that sources the conf into an external server — by stamping the mark first (see [tmux-sessions](/run-kit/tmux-sessions.md)). Caveat: `history-limit`-class options apply only to panes created after the reload — existing panes keep their old values.

When the resolved config path is not `DefaultConfigPath` (the `tmux_conf` key or `RK_TMUX_CONF` is set), the file is user-owned: rk performs **no ensure/refresh/doctor** on it ("you own everything" mode — `EnsureConfig` gates on this explicitly).

Every scaffold path — `EnsureConfig`, `ForceWriteConfig`, `rk mux init-conf` (both cobra instances), `POST /api/tmux/init-conf` — also ensures `tmux.d/` exists and scaffolds `tmux.d/user.conf` as a commented starter (purpose, one commented `set -g` example, the `10-*.conf` numeric-ordering pointer) when absent; an existing `user.conf` is never overwritten, including under `--force`. (0tu6)

The embedded conf's `pane-border-format` renders, in both the active and inactive arms, a conditional pane-index prefix `#{?#{e|>:#{window_panes},1},#P · ,}` immediately before the path segment (the last two segments of `pane_current_path`), followed by the worktree badge, git branch, and `pane_current_command` segments with per-state color arms: a single-pane window shows the bare path, a multi-pane window shows `N · <path>`. The raw `%N` pane id appears nowhere in the border — it stays reachable via the web status bar's `Copy tmux pane id` affordance and `tmux display-message -p '#{pane_id}'`. (qt7k)

## Settings Registry

`internal/settings` defines one registry — a `[]registryEntry` table — that is the single source of truth for every settings key and drives both `parse()` and `serialize()`. Each entry carries **key, kind (type), default, description, category, `ui` flag, `live` flag**; enum kinds additionally carry **`options`** — the entry's legal values in display order (`theme`: `system`/`dark`/`light`; `log_level`: `info`/`debug`), display metadata for generated controls (the apply hook keeps owning enforcement), nil on non-enum kinds. Scalar entries carry parse/serialize hooks, nested entries (maps, lists) carry a section built by `mapSection`/`listSection`. Slice order IS serialization order: scalar keys first, then nested sections. Adding a key is one registry entry — no new scanner branches.

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
| `auto_name` | bool | `false` | behavior | yes | yes | a settings POST rewires the hub's auto-name tracker live (see [architecture](/run-kit/architecture.md) § SSE Hub) |
| `tmux_conf` | path string | `""` | advanced | yes | no | user owns the file; rk performs no ensure/refresh/doctor on it |
| `log_level` | enum (`info`/`debug`) | `info` | advanced | yes | no | read at serve startup |

`live: false` keys (`tmux_conf`, `log_level`) are restart-bound (read once at tmux/serve startup); `live: true` keys apply on next read — `auto_name`'s one read-once consumer (the hub's tracker) is re-applied live by the settings POST. The exported accessor surface (`Load`, `Save`, `Default`, `Get/SetServerColor`, `Get/SetServerFlair`, `Get/SetInstanceColor`, `Get/SetSSHHost`, `Get/SetInstanceName`, `Get/SetBoardOrder`) sits over the registry. (li54)

## Settings HTTP API

The entire settings HTTP surface is one registry-driven endpoint pair in `api/settings.go` (see [architecture](/run-kit/architecture.md) § REST API for the endpoint rows). The registry exports its metadata read-side (`KeyInfo` + `Registry()`, registry slice order) plus generic per-key JSON value read/apply hooks (`ReadValue`/`ApplyValue`) — value normalization and value-shape validation live with the registry entry, reusing `internal/validate`; board-order **name** validity (`tmux.ValidBoardName`) and duplicate rejection stay in the API handler (`internal/tmux` imports `internal/settings`, so settings calling into tmux would be an import cycle).

- **`GET /api/settings`** → `{"settings": [{key, kind, default, description, category, ui, live, options?, value}]}` — one object per registry entry, in registry order, snake_case registry key names verbatim, values in natural JSON types: `null` for unset string scalars, maps as objects (possibly `{}`), `board_order` as an array (possibly `[]`), `auto_name` as a bool. `options` is present only on enum kinds (`theme`, `log_level`) and omitted otherwise.
- **`POST /api/settings`** — a flat JSON object of registry keys, partial merge per Constitution §IX: present keys set, absent keys untouched, `null` unsets (resets to the registry default). String scalars are trimmed, trimmed-to-empty treated as `null` (except `theme`/`theme_dark`/`theme_light`, whose defaults are non-empty — a trimmed-to-empty non-null value is a 400). Map keys merge **per entry** (an entry `null` unsets that entry, other entries untouched; a top-level `null` clears the whole map); `board_order` replaces wholesale (top-level `null` ≡ `[]`). The whole body is validated before a single `Load → apply-all → Save` — an unknown key, malformed body, or any per-key validation failure is a 400 with nothing persisted. Success is `200 {"status": "ok"}` with two keyed side effects: a successful body containing `board_order` broadcasts the server-global `board-order` SSE event (see architecture § SSE Hub), and one containing `auto_name` (set or `null`-unset) re-applies the post-merge value to the running hub's auto-name tracker through the hub's apply seam (`sseHub.setAutoName` — see [architecture](/run-kit/architecture.md) § SSE Hub), so the live key takes effect without a daemon restart. No other key has a side effect. (f1ot) (5r41)

## Override Order & Env Inventory

Override order: **code default < config.yaml < env < CLI flag**. Env forms exist ONLY for deployment-bootstrap keys: `RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT` (`.env` committed, `.env.local` for overrides — the bootstrap vehicle). The only other env reads are three **undocumented per-process escapes** that win over their config.yaml keys but are never user-facing: `RK_TMUX_CONF` (over `tmux_conf`), `LOG_LEVEL` (over `log_level` — the dev rig depends on it via `justfile`/`scripts/dev.sh`), and `RK_CONFIG_DIR` (relocates the whole config root — § Config Root). Preference keys have no env form. `rk doctor` flags a set-but-ignored `RK_SSH_HOST` (no reader remains; the hint points at the `ssh_host` key). (li54)

## Boundaries

| Kind of value | Home |
|---|---|
| Per-instance behavior / prefs | `~/.config/run-kit/config.yaml` |
| Per-entity (server/session/window/pane) | `@rk_*` tmux options |
| Per-viewer / device | localStorage |
| Per-editor-profile (the managed code-server profile) | code-server's own `settings.json` — e.g. `rk.bridge.enabled` (the code bridge's off switch, seeded `true` by the daemon's write-once `codeServerSeedSettings`; it lives in the editor profile, NOT `config.yaml`, and has no env form — see [code-bridge](/run-kit/code-bridge.md)) |
| Deployment binding | env (`RK_PORT`, `RK_HOST`, `RK_CODE_SERVER_PORT`) |
| State (snapshots, caches — droppable only) | `$XDG_STATE_HOME/run-kit/` |

## Migrations & Breadcrumbs

Migrations follow one pattern: fallback-read from the old path, migrate on first write, leave a breadcrumb so nothing silently forks. Three have landed:

- **Settings file**: `Load()` reads `~/.config/run-kit/config.yaml`, fallback-reading the legacy `~/.rk/settings.yaml` (same format) when the new file is absent; `Save()` always writes the new path and then renames a still-present legacy file to `~/.rk/settings.yaml.migrated` (best-effort — a rename failure never fails the save). A read-only instance keeps fallback-reading the old file indefinitely, losslessly.
- **State dir**: `$XDG_STATE_HOME/run-kit/` (snapshots at `…/run-kit/snapshots`, prstatus cache at `…/run-kit/prstatus.json`, the code-bridge socket root + host registry at `…/run-kit/cb/` — 0700, sockets 0600, records pruned live per call; see [code-bridge](/run-kit/code-bridge.md)), still XDG-honoring with the `~/.local/state` fallback — a deliberate asymmetry vs the config root, safe because Constitution §II restricts this dir to droppable, never-authoritative files. On snapshot-store first use, when the new dir is absent and the legacy `…/rk/snapshots` exists, the old dir is moved (`os.Rename`, best-effort, one-time) and a `MOVED-to-run-kit` breadcrumb file is left in the legacy dir naming the new path; a failed move degrades to cold-start behavior, never an error. The legacy `prstatus.json` is left behind — it is a startup seed cache that regenerates cold.
- **tmux.conf + tmux.d**: `DefaultConfigPath` is `~/.config/run-kit/tmux.conf` (the same fixed-root construction as `settings.Dir()`), the drop-in dir is `~/.config/run-kit/tmux.d/`, and the embed sources the new path. On ensure at the default path, legacy `~/.rk/tmux.d/*.conf` drop-ins are moved into the new `tmux.d/` (a same-name file already at the new path wins — never overwritten) and the old dir becomes the breadcrumb `tmux.d.migrated`; a legacy `~/.rk/tmux.conf` becomes the breadcrumb `tmux.conf.migrated` only when byte-equal to the current embed — pre-header files carry no stamp, so anything else (old-embed pristine or hand-edited) is left untouched and surfaced only by the doctor recipe. All best-effort, never fatal. (0tu6)

`~/.rk/` still has tenants covered by no migration: the web-push store (`internal/push`), the code-server bin dir (`internal/codeserver`) and profile/install dirs (`internal/daemon`), and job logs (`internal/daemon/jobs.go`). (li54)

## Requirements

### Requirement: Fixed config root
The config root SHALL be `$HOME/.config/run-kit/`, built with `filepath.Join` from `os.UserHomeDir()`, and MUST NOT consult `$XDG_CONFIG_HOME` or `os.UserConfigDir`. The sole exception is the test-only `RK_CONFIG_DIR` override: when set to a non-whitespace value, `Dir()` SHALL return it verbatim, `configPath()` SHALL follow, and the legacy `~/.rk/settings.yaml` fallback-read and breadcrumb rename SHALL be suppressed; unset or whitespace-only MUST be byte-identical to the fixed root.

#### Scenario: Env cannot move the root
- **GIVEN** `XDG_CONFIG_HOME=/some/tmp` and `HOME=/test/home`
- **WHEN** the settings path is resolved
- **THEN** it is `/test/home/.config/run-kit/config.yaml`

#### Scenario: The test override relocates root and suppresses legacy touchpoints
- **GIVEN** `RK_CONFIG_DIR=/tmp/e2e/config` and a legacy `~/.rk/settings.yaml` on disk
- **WHEN** settings are loaded and saved
- **THEN** reads and writes land at `/tmp/e2e/config/config.yaml`, the legacy file is neither imported nor renamed, and the fixed `$HOME` root is untouched

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
A migration SHALL fallback-read the old path, migrate on first write, and leave a self-documenting breadcrumb (`settings.yaml.migrated`, `MOVED-to-run-kit`, `tmux.conf.migrated`, `tmux.d.migrated`); a failed breadcrumb/move MUST NOT fail the operation and MUST degrade to cold-start behavior.

### Requirement: Managed tmux.conf ownership
Every rk write of the default tmux.conf SHALL produce a file whose first line is the managed header `# rk-managed sha256:<hex> — DO NOT EDIT; overrides go in ~/.config/run-kit/tmux.d/`, with `<hex>` the SHA-256 lowercase-hex digest of the body. The daemon-start refresh SHALL classify the on-disk file against the embed (missing / managed-current / managed-stale / hand-edited) and write only on missing or managed-stale; a hand-edited file MUST never be written or auto-migrated. The reload sweep SHALL run only after a stale→force-write transition, SHALL touch only live-enumerated **managed** servers (`@rk_srv_managed` per [tmux-sessions](/run-kit/tmux-sessions.md) — an external server receives no conf, and an explicit `POST /api/tmux/reload-config` on one returns `200 {"status":"skipped","reason":"external"}`, not an error), and MUST never fail daemon start. When `tmux_conf`/`RK_TMUX_CONF` redirects the config path, rk SHALL perform no ensure/refresh/doctor on the file.

#### Scenario: Stale refreshes, hand-edited survives
- **GIVEN** a managed & stale file at the default path
- **WHEN** the daemon starts
- **THEN** the file is force-written with the current embed and the reload sweep runs; **AND GIVEN** a hand-edited file, **THEN** it survives byte-identical and no sweep runs.

### Requirement: user.conf override scaffold
Every scaffold path (`EnsureConfig`, `ForceWriteConfig`, `rk mux init-conf`, `POST /api/tmux/init-conf`) SHALL ensure `tmux.d/` exists and scaffold `tmux.d/user.conf` as a commented starter when absent; an existing `user.conf` MUST never be overwritten, including under `--force`.

#### Scenario: --force preserves user.conf
- **GIVEN** a user with customizations in `tmux.d/user.conf`
- **WHEN** `rk mux init-conf --force` runs
- **THEN** the managed tmux.conf is rewritten and `user.conf` is byte-identical to before.

## Design Decisions

### Fixed config root, no XDG
**Decision**: `$HOME/.config/run-kit/` as a `filepath.Join` constant; only `$HOME` moves it.
**Why**: rk is a daemon + CLI + agents-in-panes — an env var differing between those contexts silently forks which config is read; determinism by construction (hop's proven pattern). Dotfiles users symlink the directory.
**Rejected**: `os.UserConfigDir` (macOS → `~/Library/Application Support`, path differs per platform); honoring `$XDG_CONFIG_HOME` (per-process forkability is the exact failure mode).
*Introduced by*: 260823-li54-config-root-registry-core

### Test-only config-root override at the shared root
**Decision**: `RK_CONFIG_DIR` is read inside `internal/settings` at `Dir()` — the single root every settings consumer (`configPath`, `/api/settings`, board persistence, PWA accent read) resolves through — with the legacy-path touchpoints suppressed while it is active; the managed tmux.conf path is computed independently in `internal/tmux` and deliberately does not move.
**Why**: scope-at-the-shared-root is the same rationale as `RK_SERVER_ALLOWLIST` filtering in `ListServers` — a per-consumer override would leave sibling paths unscoped; the in-package `os.Getenv` read matches the package precedent, and only the settings file needs per-run isolation.
**Rejected**: threading through `internal/config` (new cross-package plumbing for one test-only value); overriding `$HOME` for the dev subtree (moves `~/.rk`, node/pnpm caches — larger blast radius for the same isolation win); a cross-worktree flock around config-touching specs (serializes instead of isolating).
*Introduced by*: 260903-y60c-e2e-config-root-isolation

### Hand-rolled registry-driven serializer
**Decision**: keep the line-scanner parse + string-builder serialize, driven by the registry.
**Why**: preserves tolerant-read semantics and byte-stable omit-when-default output the tests pin; extends the proven `nestedSections` registry shape to all keys.
**Rejected**: `yaml.v3` marshal/unmarshal — reformats user files, loses omit-when-default byte-stability, adds comment-handling complexity.
*Introduced by*: 260823-li54-config-root-registry-core

### Breadcrumb by rename
**Decision**: migration breadcrumbs are self-documenting filesystem artifacts — the old settings file becomes `*.migrated`; the state move leaves a `MOVED-to-run-kit` marker file.
**Why**: an old binary or a curious user finds a clearly-marked artifact instead of a silently diverging live file.
**Rejected**: deleting the old file (destroys the rollback path); leaving it live (silent fork — two writers, two truths).
*Introduced by*: 260823-li54-config-root-registry-core

### Env escapes stay undocumented
**Decision**: `RK_TMUX_CONF` and `LOG_LEVEL` survive as per-process env escapes that win over their config.yaml keys, with no user-facing documentation.
**Why**: a per-process test/debug toggle must not mutate the user's config.yaml, and the dev rig exports `LOG_LEVEL=debug` (`justfile`, `scripts/dev.sh`).
**Rejected**: deleting the env reads (breaks the dev rig and per-process testing); documenting them (grows the env surface the override order just restricted).
*Introduced by*: 260823-li54-config-root-registry-core

### GET shape: array of full registry entries
**Decision**: `{"settings": [{key, kind, default, description, category, ui, live, options?, value}]}` in registry order, snake_case registry key names verbatim.
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

### Hash-stamped header as the ownership declaration
**Decision**: ownership and staleness of the managed tmux.conf are derived from a SHA-256 stamp in the file's own first line; the three-state check is a pure local computation against the embed.
**Why**: no version registry, no timestamps, no extra state file (Constitution II — derive from the filesystem); "did the user edit this?" becomes deterministic and testable.
**Rejected**: a version marker (stale detection breaks when the embed changes without a version bump); mtime heuristics (false positives on copy/touch); a sidecar state file (a second source of truth to drift).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

### Byte-equal embed test for pre-header migration
**Decision**: an old `~/.rk/tmux.conf` is auto-breadcrumbed only when byte-equal to the current embed; everything else is hands-off with a doctor recipe.
**Why**: pre-header files carry no stamp, so managed-ness is unprovable; byte-equality with the current embed is the only zero-false-positive detector, and false positives here destroy user edits.
**Rejected**: comparing against historical embeds (rk does not archive them); auto-migrating any old file (violates the never-clobber rule).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

### Sweep only on an actual force-write
**Decision**: the reload sweep fires only on the managed-stale → force-write transition, not on every daemon start.
**Why**: reloading unchanged config is wasted tmux traffic across every live server, and the sweep's only purpose is propagating a refresh that just happened.
**Rejected**: unconditional sweep at start (noise, and touches servers for nothing); sweeping on missing→write (a fresh file means no server was started with older content by rk's `-f` — new servers pick it up at creation).
*Introduced by*: 260823-0tu6-tmux-conf-ownership

### Managed-conf apply paths gate on the provenance mark
**Decision**: all three conf-apply paths (the daemon-start reload sweep, the WS-attach best-effort reload, and `POST /api/tmux/reload-config`) skip external (unmarked) servers; the explicit endpoint reports `200 {"status":"skipped","reason":"external"}` rather than erroring, and the sweep/attach skips log at debug. `CreateSession`'s `-f` flag carries no gate.
**Why**: the user's own tmux.conf regime and rk's managed conf are different regimes — sourcing rk's conf into a server the user configured themselves silently changes its keybindings, styling, and options. tmux ignores `-f` on an already-running server, so the flag applies only at birth, which is exactly when the `@rk_srv_managed` stamp lands — gating it would be dead code.
**Rejected**: gating only the sweep (the WS-attach reload fired merely on viewing a terminal — the hottest path); erroring on the endpoint's external case (a report keeps scripted reloads non-fatal).
*Introduced by*: 260826-lv87-external-server-provenance-adopt

### auto_name liveness via POST-driven tracker rewire, no broadcast
**Decision**: the settings POST rewires the hub's auto-name tracker in place; no generic settings-changed SSE event is added.
**Why**: `live` means "applies on next read without restart" — every other live key already honors it per its read cadence; auto_name's read-once-at-construction seam was the only violation. Cross-tab push is new backend surface the invocation forbids.
**Rejected**: per-tick `settings.Load()` in the hub (file I/O every ~2s per server for one bool); a settings-changed broadcast (unneeded surface).
*Introduced by*: 260823-5r41-settings-pane-live-apply

### Enum options ride the registry
**Decision**: `registryEntry.options []string` for enum kinds, served through KeyInfo and GET.
**Why**: a generated enum control needs options as data and the registry is the single source of truth.
**Rejected**: legal values living only inside the parse/apply closures (invisible to generated controls, as `log_level`'s once were); hardcoding options in the frontend (drifts from the registry, defeats generation).
*Introduced by*: 260823-5r41-settings-pane-live-apply

### Conditional pane-index prefix on the pane border
**Decision**: the managed conf's `pane-border-format` shows `#P · ` only when `window_panes > 1`, via `#{?#{e|>:#{window_panes},1},#P · ,}`; the raw `%N` pane id appears nowhere in the border.
**Why**: the single-pane window is the dominant case — a constant `1 · ` prefix is noise that duplicates nothing useful, and a raw tmux internal id means nothing to a user reading primary chrome. The id stays reachable where it belongs: the web status bar's `Copy tmux pane id` affordance and `tmux display-message -p '#{pane_id}'`.
**Rejected**: keeping `#P` unconditionally (noise in the common case); keeping `#D` anywhere in the border (the internal-id leak).
*Introduced by*: 260902-qt7k-ipad-chrome-polish

See [architecture](/run-kit/architecture.md) § `internal/settings` for the package-level contract and [layout-snapshots](/run-kit/layout-snapshots.md) for the snapshot store under the state root.
