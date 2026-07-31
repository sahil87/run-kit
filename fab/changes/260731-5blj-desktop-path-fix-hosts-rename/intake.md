# Intake: Desktop PATH Fix, Rename Removal & Host Terminology

**Change**: 260731-5blj-desktop-path-fix-hosts-rename
**Created**: 2026-07-31

## Origin

Synthesized from a user conversation (dispatched promptless via `/fab-proceed`-style create-intake — no questions asked; would-be-questions deferred to `## Assumptions`). One change to the Electron desktop shell (`app/desktop/`) bundling three decided items:

> 1. Fix: the desktop welcome page's "Start local server" fails with `exec: "tmux": executable file not found in $PATH` — the GUI PATH trap. Fix at the spawn site (pure `augmentPath` + env override in `runRk`), NOT inside rk.
> 2. Remove the server Rename feature entirely — the menu items are the sole entry point to the whole rename chain; remove the full chain, not just the menu item. Accepted consequence (user confirmed): display names become permanently auto-derived from the hostname at add-time; the only way to change a name is remove-and-re-add.
> 3. Host terminology: "host" = an rk instance, "Server" reserved for tmux servers. The web UI already standardizes this (Constitution IV route set: Host Overview `/`, tmux Server `/$server`); the desktop shell conflicts. Rename throughout the desktop shell, all tiers: user-visible labels, code identifiers + IPC channels, and the persisted store `servers.json` → `hosts.json` with **NO backward compatibility** (explicit user decision — no migration shim, no fallback read; existing users re-add their hosts).

User picked "all in one change" — items 2+3 touch the same files (`menu.ts`, `main.ts`, `preload.ts`, `welcome.*`, `servers.ts`); item 1 touches `local-daemon.ts` + `main.ts`.

## Why

**Item 1 (PATH fix)** — On macOS, starting the local daemon from the desktop welcome page fails with `exec: "tmux": executable file not found in $PATH` (surfaced from `daemon.reapStaleDaemonSocket`), while `rk daemon start` from a terminal works fine. Root cause confirmed: the shell resolves the **rk binary itself** via fixed Homebrew candidate paths (`local-daemon.ts` `rkCandidatePaths` — its header comment documents the GUI PATH trap), but `runRk` at `main.ts:323` calls `execFileAsync(rkBinary(), args, { timeout })` with **no env override** — so the spawned rk inherits Electron's GUI PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS, no `/opt/homebrew/bin`), and rk's `exec.LookPath("tmux")` fails. Without the fix, the flagship "Start & connect" local-first flow (PR #478) is broken for every Finder-launched install — the exact audience the welcome "This Mac" section serves. Fixing at the spawn site (not inside rk) is deliberate: the tmux server created by `rk daemon start` inherits the starting process's env for its whole tree, so starting with a sane PATH fixes every future session/pane, not just the reap call.

**Item 2 (Rename removal)** — The user decided the rename option is not needed. The desktop menu's `Rename "<name>"…` items are the sole entry point to the whole rename chain (menu → IPC → welcome `?mode=rename` variant → store `renameServer`); removing only the menu item would orphan dead code across five files, so the full chain goes.

**Item 3 (Host terminology)** — The web UI reserves "Server" for tmux servers ("host" = an rk instance): top-bar headings are `Host` and `tmux Server: <name>`, route set per Constitution IV. The desktop shell conflicts — it calls rk instances "servers" (menu, welcome copy, identifiers, IPC channels, `servers.json`). Leaving the conflict makes every future desktop feature compound the terminology debt. IPC names are app-private (main ↔ its own preload/welcome pages) — no compat concern for the channel renames; the store-file rename drops compat by explicit user decision.

## What Changes

### 1. GUI PATH fix in `app/desktop/src/local-daemon.ts` + `main.ts`

1. **New pure function** in `app/desktop/src/local-daemon.ts`:

   ```ts
   augmentPath(platform: string, currentPath: string | undefined): string
   ```

   Appends the platform brew bin dirs to PATH when missing — the same prefixes `rkCandidatePaths` already encodes: `/opt/homebrew/bin`, `/usr/local/bin` on darwin; `/home/linuxbrew/.linuxbrew/bin`, `/usr/local/bin` on linux (win32: unchanged). Pure + injected (platform and current PATH are parameters), matching the module's electron-free posture so it slots into the existing `node --test` coverage in `local-daemon.test.ts`. Dirs already present in the PATH are not duplicated.

2. **In `main.ts` `runRk`** (line ~323): pass the env override to `execFileAsync`:

   ```ts
   env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) }
   ```

   `runRk` is the single subprocess wrapper (all `rk --version`/`rk url`/`rk daemon start|stop|restart` calls flow through it), so one change covers every invocation. Existing `execFile`-with-args-slice-and-timeout discipline (Constitution I) is unchanged.

### 2. Remove the server Rename feature (full chain)

- **`menu.ts`** (282 lines): the `renameItems` block (~line 221: per-server `Rename "<name>"…` items) + the `onRenameServer` callback in `MenuCallbacks` (~line 58), plus header-comment references to Rename.
- **`main.ts`** (688 lines): the `onRenameServer` handler (~line 197, captures last-path then navigates welcome with `mode: "rename"` + prefill query params); the `welcome:rename-server` IPC handler (~line 564); `parseRenamePayload` (~line 533); the `renameServer` store import (line 48).
- **`preload.ts`**: the `renameServer` bridge method in the `__welcome` group (~line 46).
- **`welcome/welcome.ts`** (525 lines): the entire `?mode=rename` variant — rename-mode detection (`renameId`, ~lines 417–423), the `rename()` flow (~line 459), the `Rename`/`Connect` idle-label switch, the rename-only URL-field-hide/name-field-show display logic, bridge shape checks for `renameServer` (~lines 97–118), and the rename-mode suppression branch of the "This Mac" section (~line 522 — the local section then gates only on `mode !== "add"` semantics as applicable; the rename condition disappears).
- **`welcome/welcome.html`**: the rename-mode markup — the `hidden` Display-name label + input (~line 213) existed solely for rename-mode reuse (the connect flow auto-derives the name and has no name input), so they are removed outright; comment references to rename mode go too.
- **`servers.ts`**: the `renameServer()` store function (~line 184) and its doc-comment references.
- **Tests**: the three `renameServer` cases in `servers.test.ts` (~lines 221, 239, 249) and any other rename assertions.

**Accepted consequence** (user confirmed): display names are permanently auto-derived from the ping's returned hostname at add-time; the only way to change a name is remove-and-re-add.

### 3. Host terminology rename throughout the desktop shell

**(a) User-visible labels**:
- Menu: "Servers" top menu → "Hosts" (all platforms — mac and the win/linux `File | View | Servers` top-menu row); `Add Server…` → `Add Host…`; `Remove "<name>"…` items unchanged in shape but over hosts.
- Welcome copy: `Server URL` label → `Host URL`; divider "or a remote server" → "or a remote host"; any other welcome copy referring to rk instances as servers.
- Daemon dialog text: any `dialog.showMessageBox` copy (stop-confirm, remove-confirm) referring to the server *list*/entries — reword to hosts. The daemon lifecycle naming itself ("Local Daemon" submenu, "Start local server" card semantics per PR #478 copy) **stays as-is** — the daemon is what it is; only rk-instance-list terminology changes.

**(b) Code identifiers + IPC channels** (app-private — no compat concern):
- `servers.ts` → `hosts.ts` (module rename), `ServerEntry` → `HostEntry`, `ServerList` → `HostList`, and functions: `addServer`/`removeServer`/`setActiveServer`/`setServerLastPath`/`resolveActiveServer`/`findServerByOrigin`/`serverInfos`/`loadServers`/`saveServers`/`emptyList` etc. → host-named equivalents. `servers.test.ts` → `hosts.test.ts`.
- IPC: `welcome:test-server` → `welcome:test-host`, `welcome:add-server` → `welcome:add-host`.
- Preload/`runkitShell` bridge naming: the `__welcome` group methods `testServer`/`addServer` → `testHost`/`addHost` (welcome.ts's structural bridge-narrowing checks follow).
- `MenuCallbacks`: `onSwitchServer` → `onSwitchHost`, `onAddServer` → `onAddHost`, `onRemoveServer` → `onRemoveHost`; `main.ts` internals (`switchToServer`, `connectLocalServer`, `showActive` plumbing, `isServersSender` etc.) follow the host naming where they denote rk instances.
- **Boundary — unchanged names**: the `servers:list`/`servers:switch` IPC channels and the bridge's `servers` group (`{ list, switch }`) are consumed by the web SPA (`app/frontend/src/lib/shell.ts` — `listShellServers`/`switchShellServer`, the palette's shell-gated switch block). The web frontend is explicitly out of scope, and renaming that group would silently break the SPA palette (its wrapper resolves `null` for a missing group, disabling the feature with no error). Those two channels + group keep their names in this change. *(See Assumptions #6.)*
- The shared health-ping helper `pingServer` and other tmux-server-adjacent names that do not denote rk instances are judged case-by-case at apply; only rk-instance meanings rename.

**(c) Persisted store**: `<userData>/servers.json` → `<userData>/hosts.json`, with **NO backward compatibility** — no migration shim, no fallback read of the old file. Existing users re-add their hosts. The old `servers.json` is left on disk untouched (never read, never deleted). Schema stays version 1 with the entries array key renamed `servers` → `hosts`:

```json
{
  "version": 1,
  "activeId": "b3f1…",
  "hosts": [
    { "id": "<randomUUID>", "name": "studio-mac", "url": "http://100.101.2.3:3000", "lastPath": "/utils2/rk-dev?x=1" }
  ]
}
```

**Explicitly out of scope**: the web frontend and Go backend — their "server" already means tmux server, which is the terminology being reserved. The daemon lifecycle naming ("Local Daemon" submenu) stays as-is.

## Affected Memory

- `run-kit/desktop-shell`: (modify) Describes the `servers.json` store, the rename flow (`?mode=rename`, `renameServer` mutator, menu Rename items), the `__welcome` bridge shape, and "Servers" menu naming throughout — hydrate must rewrite the store section to `hosts.json`/host naming, delete the rename-flow prose, and update the bridge/menu/welcome descriptions and the GUI-PATH-trap paragraph (now also covering `runRk` env augmentation, not just binary resolution).
- `run-kit/architecture`: (modify) Only if its desktop-shell pipeline summary names `servers.json` or the rename flow — light-touch terminology sync.

## Impact

- **Scope**: `app/desktop/` only. Files: `src/local-daemon.ts` (+ `local-daemon.test.ts`), `src/main.ts`, `src/menu.ts`, `src/preload.ts`, `src/servers.ts` → `src/hosts.ts` (+ `servers.test.ts` → `hosts.test.ts`), `src/welcome/welcome.ts`, `src/welcome/welcome.html`. `window-open.ts` untouched.
- **Web frontend / Go backend**: untouched (explicit non-goal). `app/frontend/src/lib/shell.ts` continues to work because the `servers` bridge group + `servers:*` channels keep their names.
- **Users**: existing desktop users lose their registered host list (no migration) and re-add; rename-by-UI disappears (remove-and-re-add is the replacement).
- **Note**: `fab/project/config.yaml` `source_paths` does not currently list `app/desktop/` — pre-existing condition, not changed here.
- **Verification**: `cd app/desktop && pnpm run compile && node --test "dist/**/*.test.js"`; `tsc --noEmit`. No Playwright coverage exists for the Electron shell (per memory: pure-module node:test suites + compile gates are the automated surface). The PATH-fix end-to-end leg (Finder-launched app) is hardware-only manual verification; `augmentPath` unit tests cover the logic.

## Open Questions

- None blocking — all major decisions were made in the originating conversation. Residual judgment calls are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | PATH fix lives at the spawn site: pure `augmentPath(platform, currentPath)` in `local-daemon.ts` + `env: { ...process.env, PATH: augmentPath(...) }` in `runRk` — never inside rk | Discussed — user decided with verbatim design; rationale (env inheritance by the whole tmux tree) confirmed in conversation; code anchors verified (`main.ts:323`, `rkCandidatePaths`) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Remove the entire rename chain (menu items, `MenuCallbacks.onRenameServer`, `welcome:rename-server` IPC, `parseRenamePayload`, preload bridge method, `?mode=rename` welcome variant, `renameServer` store fn, all rename tests) | Discussed — user decided removal of the full chain; menu items confirmed as sole entry point by code inspection | S:95 R:80 A:95 D:95 |
| 3 | Certain | Display names become permanently auto-derived at add-time; remove-and-re-add is the only way to change a name | Discussed — user explicitly confirmed this consequence | S:95 R:75 A:90 D:95 |
| 4 | Certain | Host terminology renames all desktop tiers (labels, identifiers, IPC, store) in this one change; web frontend + Go backend + "Local Daemon" naming out of scope | Discussed — user decided scope and the all-in-one-change bundling | S:90 R:70 A:90 D:90 |
| 5 | Certain | `servers.json` → `hosts.json` with NO backward compatibility — no migration shim, no fallback read | Discussed — explicit user decision; existing users re-add | S:95 R:70 A:90 D:95 |
| 6 | Confident | The `servers:list`/`servers:switch` IPC channels and the bridge `servers` group keep their names — the host rename covers only shell-internal identifiers + the `welcome:*` channels the conversation named | Conversation named only the `welcome:*` channel renames and declared the web frontend (the sole consumer of the `servers` group via `shell.ts`) out of scope; renaming the group would silently disable the SPA palette's switch block | S:45 R:70 A:55 D:55 |
| 7 | Confident | `hosts.json` keeps schema `version: 1` with the entries array key renamed `servers` → `hosts` | Fresh file with no compat requirement, so field names follow the new terminology; keeping version 1 matches "no migration machinery" intent | S:50 R:75 A:70 D:65 |
| 8 | Confident | The old `servers.json` is left on disk untouched — never read, never deleted | Not discussed; harmless leftover, and deleting user data unprompted is the riskier default | S:40 R:85 A:75 D:70 |
| 9 | Confident | Test files follow the renames (`servers.test.ts` → `hosts.test.ts`, rename cases deleted) and `augmentPath` gets node:test coverage in `local-daemon.test.ts` | Conversation specified augmentPath test coverage and "all associated tests" for removal; code-quality.md requires tests for changed behavior | S:60 R:85 A:85 D:80 |
| 10 | Certain | Daemon lifecycle naming ("Local Daemon" submenu, daemon dialog framing) stays as-is; only rk-instance-list terminology changes | Discussed — user explicitly kept daemon naming out of scope | S:90 R:85 A:90 D:95 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
