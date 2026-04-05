# Spec: Multi-file Tmux Config Sourcing

**Change**: 260328-wxrh-source-rk-tmux-configs
**Created**: 2026-03-28
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Migrating existing users automatically — users run `rk init-conf --force` or manually add the `source-file` line
- Supporting nested subdirectories in `tmux.d/` — only top-level `*.conf` files are sourced
- Providing example drop-in configs or a plugin manager

## Tmux Config: Drop-in Directory

### Requirement: Source directive in default config

The embedded default config (`configs/tmux/default.conf`) SHALL include a `source-file -q` directive at the end of the file that sources all `*.conf` files from `~/.rk/tmux.d/`.

The directive SHALL use the `-q` flag so tmux silently succeeds when no files match (empty or missing directory).

#### Scenario: Fresh install sources user extensions
- **GIVEN** a fresh install with `~/.rk/tmux.d/plugins.conf` present
- **WHEN** tmux starts with the default config
- **THEN** `plugins.conf` is sourced after the base configuration

#### Scenario: Empty tmux.d directory
- **GIVEN** `~/.rk/tmux.d/` exists but contains no `.conf` files
- **WHEN** tmux starts with the default config
- **THEN** tmux starts normally with no errors (the `-q` flag suppresses "no match")

#### Scenario: Missing tmux.d directory
- **GIVEN** `~/.rk/tmux.d/` does not exist
- **WHEN** tmux starts with the default config
- **THEN** tmux starts normally with no errors (the `-q` flag suppresses "no match")

### Requirement: Lexicographic source order

Files in `tmux.d/` SHALL be sourced in lexicographic (filesystem) order, enabling users to control precedence via numeric prefixes (e.g., `00-plugins.conf`, `50-keybindings.conf`, `99-overrides.conf`).

#### Scenario: Ordered sourcing
- **GIVEN** `~/.rk/tmux.d/` contains `50-keys.conf` and `10-plugins.conf`
- **WHEN** tmux sources the glob `~/.rk/tmux.d/*.conf`
- **THEN** `10-plugins.conf` is sourced before `50-keys.conf`

## CLI: init-conf directory creation

### Requirement: Create tmux.d on init-conf

`rk init-conf` SHALL create `~/.rk/tmux.d/` when writing the config file. The directory creation SHALL be idempotent — no error if already exists.

#### Scenario: init-conf creates tmux.d
- **GIVEN** `~/.rk/` exists but `~/.rk/tmux.d/` does not
- **WHEN** the user runs `rk init-conf`
- **THEN** `~/.rk/tmux.conf` is written AND `~/.rk/tmux.d/` is created

#### Scenario: init-conf with existing tmux.d
- **GIVEN** `~/.rk/tmux.d/` already exists with user configs
- **WHEN** the user runs `rk init-conf --force`
- **THEN** `~/.rk/tmux.conf` is overwritten AND `~/.rk/tmux.d/` is untouched (no deletion of contents)

## Backend: Auto-create tmux.d

### Requirement: EnsureConfig creates tmux.d

`EnsureConfig()` SHALL create `~/.rk/tmux.d/` alongside the config file write. If the config file already exists (skip path), `tmux.d/` creation SHALL still be attempted to handle the case where the config exists but the directory was manually deleted.

#### Scenario: First run creates both
- **GIVEN** neither `~/.rk/tmux.conf` nor `~/.rk/tmux.d/` exist
- **WHEN** the server calls `EnsureConfig()`
- **THEN** `~/.rk/tmux.conf` is written from embedded defaults AND `~/.rk/tmux.d/` is created

#### Scenario: Config exists but tmux.d missing
- **GIVEN** `~/.rk/tmux.conf` exists but `~/.rk/tmux.d/` does not
- **WHEN** the server calls `EnsureConfig()`
- **THEN** `~/.rk/tmux.conf` is NOT overwritten AND `~/.rk/tmux.d/` is created

### Requirement: ForceWriteConfig creates tmux.d

`ForceWriteConfig()` SHALL create `~/.rk/tmux.d/` alongside the forced config write.

#### Scenario: Force write creates tmux.d
- **GIVEN** `~/.rk/tmux.conf` exists, `~/.rk/tmux.d/` does not
- **WHEN** `ForceWriteConfig()` is called
- **THEN** `~/.rk/tmux.conf` is overwritten with embedded defaults AND `~/.rk/tmux.d/` is created

## Reload: Transitive sourcing

### Requirement: Reload picks up tmux.d changes

`ReloadConfig()` SHALL NOT require changes — the existing `source-file` on `tmux.conf` transitively re-executes the `source-file -q ~/.rk/tmux.d/*.conf` directive, picking up new or changed drop-in files.

#### Scenario: Hot-reload with new drop-in
- **GIVEN** tmux is running with the base config AND user adds `~/.rk/tmux.d/theme.conf`
- **WHEN** `ReloadConfig()` is called (via API or `rk init-conf`)
- **THEN** `theme.conf` is sourced and its settings take effect

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `~/.rk/tmux.d/` as the drop-in directory | Confirmed from intake #1 — `.d` convention is universally understood | S:85 R:90 A:90 D:95 |
| 2 | Certain | Use `source-file -q` with glob pattern | Confirmed from intake #2 — tmux native, `-q` silences "no match" errors | S:90 R:95 A:95 D:90 |
| 3 | Certain | Lexicographic ordering via filesystem glob | Confirmed from intake #3 — tmux `source-file` glob follows filesystem ordering | S:80 R:95 A:90 D:90 |
| 4 | Certain | Create `tmux.d/` in `EnsureConfig` and `ForceWriteConfig` | Upgraded from intake #4 Confident — spec analysis confirms idempotent `MkdirAll` is trivial and safe | S:75 R:95 A:90 D:85 |
| 5 | Certain | Directive lives in `configs/tmux/default.conf` template | Upgraded from intake #5 Confident — build pipeline copies this to embed, no dynamic generation needed | S:80 R:90 A:90 D:85 |
| 6 | Confident | No automatic migration for existing users | Confirmed from intake #6 — `init-conf --force` or manual edit; power users can handle one line | S:60 R:80 A:70 D:70 |
| 7 | Certain | `EnsureConfig` creates `tmux.d/` even when config already exists | Spec-level discovery — handles edge case of config-exists-but-no-directory | S:75 R:95 A:85 D:90 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
