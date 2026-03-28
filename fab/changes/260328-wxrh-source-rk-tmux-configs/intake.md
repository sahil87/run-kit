# Intake: Multi-file Tmux Config Sourcing

**Change**: 260328-wxrh-source-rk-tmux-configs
**Created**: 2026-03-28
**Status**: Draft

## Origin

> Add the ability to read multiple tmux configs from the .rk folder — so the user can add plugins, add customizations etc. The .rk folder should support sourcing multiple tmux config files, letting users extend the base tmux configuration with their own plugins, keybindings, and customizations without modifying the core config.

## Why

Currently run-kit manages a single tmux config file at `~/.rk/tmux.conf`. This file is scaffolded from an embedded default on first run (`rk init-conf` / `EnsureConfig()`), and users must edit it directly to customize their tmux environment. This creates two problems:

1. **Upgrade friction** — when run-kit ships an updated default config (new keybindings, theme tweaks, status bar changes), `EnsureConfig()` skips the write if the file exists, and `init-conf --force` overwrites user customizations. There's no way to upgrade the base config while preserving user additions.

2. **No separation of concerns** — a user who wants to add a tmux plugin (e.g., tmux-resurrect), custom keybindings, or project-specific settings has to inline them into the same file that contains run-kit's own configuration. This makes it hard to reason about what's "theirs" vs. what came from run-kit.

The solution: the `~/.rk/` directory should support a convention where additional `.conf` files are automatically sourced after the main `tmux.conf`. Users drop files like `~/.rk/tmux.d/plugins.conf` or `~/.rk/tmux.d/keybindings.conf` into a well-known directory, and run-kit picks them up without requiring any changes to the base config.

## What Changes

### New `tmux.d/` directory convention

A new directory `~/.rk/tmux.d/` serves as a drop-in config directory. Any `*.conf` files placed here are sourced by tmux after the main `~/.rk/tmux.conf`.

- Files are sourced in lexicographic order (e.g., `00-plugins.conf` before `50-keybindings.conf`)
- Subdirectories are ignored — only top-level `*.conf` files in `tmux.d/` are sourced
- The directory is optional — if `~/.rk/tmux.d/` doesn't exist, behavior is unchanged

### Append `source-file` directives to the main config

The simplest tmux-native approach: when writing or reloading the config, append `source-file -q ~/.rk/tmux.d/*.conf` to the end of `~/.rk/tmux.conf`. The `-q` flag makes `source-file` silently succeed if no files match the glob (i.e., the directory is empty or doesn't exist).

This is a single line appended to the default config template in `configs/tmux/default.conf`:

```
# --- User extensions ---
source-file -q ~/.rk/tmux.d/*.conf
```

### Backend changes

- **`configs/tmux/default.conf`** — append the `source-file -q` directive at the end
- **`EnsureConfig()` in `internal/tmux/tmux.go`** — no changes needed; the directive is part of the embedded default config, so new installs get it automatically
- **Existing users** — `rk init-conf --force` re-scaffolds the config with the new directive. Alternatively, the `ReloadConfig` flow could detect the missing directive and append it, but that's more complex and not strictly necessary for v1

### `rk init-conf` enhancement

When `rk init-conf` writes the config, also create `~/.rk/tmux.d/` if it doesn't exist. This makes the drop-in directory discoverable without requiring users to `mkdir` it themselves.

### Reload behavior

`ReloadConfig()` already runs `source-file` on the main `tmux.conf`. Since the `source-file -q` directive is inside that file, reloading the main config automatically picks up any new or changed files in `tmux.d/`. No changes to `ReloadConfig()` needed.

## Affected Memory

- `run-kit/architecture`: (modify) document tmux.d convention, updated config flow

## Impact

- **`configs/tmux/default.conf`** — one new line at the end
- **`app/backend/cmd/rk/initconf.go`** — create `tmux.d/` directory alongside config write
- **`app/backend/internal/tmux/tmux.go`** — `EnsureConfig()` and `ForceWriteConfig()` create `tmux.d/` directory
- **Existing users** — need to either `rk init-conf --force` or manually add the `source-file` line
- No API changes, no frontend changes, no new routes

## Open Questions

- None — the tmux `source-file -q` glob pattern is a well-established convention (used by tmux-sensible, tpm, and most tmux plugin managers).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `~/.rk/tmux.d/` as the drop-in directory name | Follows `.d` convention (conf.d, cron.d, sudoers.d) — universally understood | S:85 R:90 A:90 D:95 |
| 2 | Certain | Use `source-file -q` with glob pattern | tmux native, `-q` silences "no match" errors, no runtime overhead | S:90 R:95 A:95 D:90 |
| 3 | Certain | Source files in lexicographic order | tmux `source-file` glob inherently follows filesystem ordering; numeric prefixes (00-, 50-) give users explicit control | S:80 R:95 A:90 D:90 |
| 4 | Confident | Create `tmux.d/` directory in `init-conf` and `EnsureConfig` | Makes the convention discoverable; `mkdir` is cheap and idempotent | S:70 R:90 A:85 D:80 |
| 5 | Confident | Append directive to `configs/tmux/default.conf` (the template), not dynamically | Simpler implementation — the directive is static, embedded in the binary at build time | S:75 R:85 A:85 D:75 |
| 6 | Confident | No migration for existing users — rely on `init-conf --force` or manual edit | Constitution VII (Convention Over Configuration) + keeping changes minimal; existing users are power users who can add one line | S:60 R:80 A:70 D:70 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
