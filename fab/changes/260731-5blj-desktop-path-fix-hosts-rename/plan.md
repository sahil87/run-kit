# Plan: Desktop PATH Fix, Rename Removal & Host Terminology

**Change**: 260731-5blj-desktop-path-fix-hosts-rename
**Intake**: `intake.md`

## Requirements

### Desktop Shell: GUI PATH Fix

#### R1: Pure PATH augmentation in `local-daemon.ts`
`app/desktop/src/local-daemon.ts` SHALL export a pure function `augmentPath(platform: string, currentPath: string | undefined): string` that appends the platform's brew bin directories to the PATH when missing — the same prefixes `rkCandidatePaths` encodes (`/opt/homebrew/bin`, `/usr/local/bin` on darwin; `/home/linuxbrew/.linuxbrew/bin`, `/usr/local/bin` on linux; win32 and unknown platforms return the input unchanged). Directories already present MUST NOT be duplicated. The function MUST be electron-free and injected (platform and current PATH are parameters) so it slots into the existing `node --test` coverage.

- **GIVEN** platform `darwin` and PATH `/usr/bin:/bin:/usr/sbin:/sbin` (the GUI PATH)
- **WHEN** `augmentPath("darwin", path)` runs
- **THEN** the result is the input with `:/opt/homebrew/bin:/usr/local/bin` appended
- **AND** a PATH that already contains `/opt/homebrew/bin` gains only the missing `/usr/local/bin` (no duplicates)
- **AND** `augmentPath("win32", p)` returns `p` unchanged; an `undefined` current PATH yields just the brew dirs joined with `:`

#### R2: `runRk` spawns with the augmented PATH
`main.ts` `runRk` MUST pass an env override to `execFileAsync`: `env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) }`. `runRk` is the single subprocess wrapper (all `rk --version`/`rk url`/`rk daemon start|stop|restart` calls flow through it), so this one change covers every invocation; the spawned rk (and the whole tmux tree `rk daemon start` creates) then resolves `tmux` via a sane PATH. The existing `execFile`-with-args-slice-and-timeout discipline (Constitution I) is unchanged.

- **GIVEN** a Finder-launched shell whose `process.env.PATH` lacks `/opt/homebrew/bin`
- **WHEN** the welcome card's "Start & connect" runs `rk daemon start` through `runRk`
- **THEN** the spawned rk inherits a PATH containing the brew bin dirs and `exec.LookPath("tmux")` succeeds

### Desktop Shell: Rename Feature Removal

#### R3: The entire rename chain is removed
The desktop shell SHALL carry no server/host rename feature. The full chain goes: the menu's per-entry `Rename "<name>"…` items and `MenuCallbacks.onRenameServer` (`menu.ts`); the `onRenameServer` handler, the `welcome:rename-server` IPC handler, and `parseRenamePayload` (`main.ts`); the `renameServer` bridge method (`preload.ts`); the entire `?mode=rename` welcome variant — rename-mode detection, the `rename()` flow, the `Rename`/`Connect` idle-label switch, the rename-only field show/hide logic, `renameServer` bridge-shape checks, and the rename-mode suppression branch of the "This Mac" section (`welcome/welcome.ts`); the rename-mode-only hidden Display-name label + input markup (`welcome/welcome.html`); the `renameServer()` store mutator; and the three `renameServer` store tests. Display names become permanently auto-derived from the ping hostname at add-time; remove-and-re-add is the only way to change a name.

- **GIVEN** the post-change desktop shell
- **WHEN** the Hosts menu is built and the welcome page loads with any query string
- **THEN** no Rename menu item, no `welcome:rename-*` channel, no `renameServer`/`renameHost` identifier, and no `?mode=rename` behavior exists anywhere in `app/desktop/src/`
- **AND** the "This Mac" section's wiring condition no longer references a rename mode

### Desktop Shell: Host Terminology

#### R4: User-visible labels say "host" for rk instances
User-visible desktop copy MUST reserve "Server" for tmux servers and call rk instances hosts: the top-level menu `Servers` → `Hosts` (all platforms), `Add Server…` → `Add Host…`, the welcome `Server URL` label → `Host URL`, and the divider "or a remote server" → "or a remote host". The daemon lifecycle naming ("Local Daemon" submenu, daemon dialog framing, "Start & connect" semantics) stays as-is. The remove-confirm dialog copy (`Remove "<name>"?` + origin detail) contains no server-instance terminology and needs no rewording.

- **GIVEN** the built application menu and the welcome page
- **WHEN** a user inspects the menus and welcome copy
- **THEN** rk instances are labeled Hosts/Host everywhere and "Local Daemon" naming is untouched

#### R5: Code identifiers and app-private IPC adopt host naming; the SPA boundary keeps server naming
`servers.ts` → `hosts.ts` (module rename; `servers.test.ts` → `hosts.test.ts`), with `ServerEntry` → `HostEntry`, `ServerList` → `HostList`, and host-named functions (`addHost`, `removeHost`, `setActiveHost`, `setHostLastPath`, `resolveActiveHost`, `findHostByOrigin`, `hostInfos`, `loadHosts`, `saveHosts`, `parseHostEntry`, `parseHostList`; `emptyList`/`normalizeOrigin` keep their neutral names). App-private IPC renames: `welcome:test-server` → `welcome:test-host`, `welcome:add-server` → `welcome:add-host`; the `__welcome` bridge methods `testServer`/`addServer` → `testHost`/`addHost` (welcome.ts structural checks follow). `MenuCallbacks`: `onSwitchServer` → `onSwitchHost`, `onAddServer` → `onAddHost`, `onRemoveServer` → `onRemoveHost`; `main.ts` internals follow (`switchToHost`, `connectLocalHost`, `confirmAndRemoveHost`, `isHostsSender`, …). **Boundary — MUST NOT change**: the `servers:list`/`servers:switch` IPC channel names, the preload bridge's `servers` group (`{ list, switch }`), and the `servers:list` response envelope key `servers` (structurally narrowed by `app/frontend/src/lib/shell.ts` — renaming any of these silently disables the SPA palette's switch block). The shared health-ping helper `pingServer` keeps its name (it pings any rk server URL, remote form included, and is not an rk-instance-list identifier).

- **GIVEN** the web SPA loaded inside the post-change shell
- **WHEN** the palette invokes `listShellServers()`/`switchShellServer(id)` via the `servers` bridge group
- **THEN** `servers:list` still answers `{ ok: true, servers: [...] }` and `servers:switch` still switches — the SPA needs no change
- **AND** no `welcome:test-server`/`welcome:add-server` channel or `testServer`/`addServer` bridge method remains

#### R6: Persisted store is `hosts.json` with no backward compatibility
The store file SHALL be `<userData>/hosts.json`, schema version 1, with the entries array key renamed `servers` → `hosts` (`{ "version": 1, "activeId": ..., "hosts": [{ id, name, url, lastPath? }] }`). There is NO migration shim and NO fallback read of `servers.json` — existing users re-add their hosts; the old `servers.json` is left on disk untouched (never read, never deleted). All other store semantics (origin normalization, atomic tmp-then-rename write, corrupt→empty with lastPath field tolerance, active resolution, origin ownership) are unchanged.

- **GIVEN** a userData dir containing only a valid old `servers.json`
- **WHEN** the shell starts
- **THEN** the host list loads empty (welcome page) and `servers.json` is not read, modified, or deleted
- **AND** adding a host writes `hosts.json` with the `hosts` array key

### Desktop Shell: Tests

#### R7: Tests follow the change
`servers.test.ts` → `hosts.test.ts` with all fixtures/identifiers updated to `hosts.json`/`hosts`-key/host names and the three `renameServer` cases deleted. `local-daemon.test.ts` gains `augmentPath` coverage (darwin append, no-duplication, undefined PATH, linux prefixes, win32 pass-through). Verification gates: `cd app/desktop && pnpm run compile` and `pnpm run test` (node:test over `dist/**/*.test.js`) pass.

- **GIVEN** the compiled `app/desktop/dist`
- **WHEN** `pnpm run test` runs
- **THEN** all suites pass with no `renameServer` case present and `augmentPath` covered

### Non-Goals

- Web frontend and Go backend — their "server" already means tmux server (the terminology being reserved); `app/frontend/src/lib/shell.ts` is untouched.
- Migration/fallback read of `servers.json` — explicit user decision.
- Daemon lifecycle naming ("Local Daemon", daemon dialog framing) — stays as-is.
- `window-open.ts` behavior — untouched (comment-only mention of the renamed module may be updated).

### Deprecated Requirements

#### Host (server) rename affordance
**Reason**: User decided the rename option is not needed; the menu items were the sole entry point, so the whole chain (menu → IPC → `?mode=rename` welcome variant → store mutator) is removed rather than orphaned.
**Migration**: Remove-and-re-add (display names auto-derive from the ping hostname at add-time).

## Tasks

### Phase 1: Setup

- [x] T001 `git mv app/desktop/src/servers.ts app/desktop/src/hosts.ts && git mv app/desktop/src/servers.test.ts app/desktop/src/hosts.test.ts` — pure file renames first so content edits diff cleanly <!-- R5 -->

### Phase 2: Core Implementation

- [x] T002 [P] In `app/desktop/src/local-daemon.ts`: add a shared `brewBinDirs(platform)` source of the per-platform brew prefixes, derive `rkCandidatePaths` from it, and export `augmentPath(platform, currentPath)` (append missing dirs, no duplicates, win32/unknown pass-through, undefined PATH → dirs joined); update the header + "servers.ts precedent" comment <!-- R1 -->
- [x] T003 In `app/desktop/src/hosts.ts`: rename types/functions to host naming (`HostEntry`, `HostList`, `AddResult.host`, `loadHosts`/`saveHosts`/`addHost`/`removeHost`/`setActiveHost`/`setHostLastPath`/`resolveActiveHost`/`findHostByOrigin`/`HostInfo`/`hostInfos`), set `FILE_NAME = "hosts.json"`, rename the schema array key `servers` → `hosts`, delete `renameServer()`, and update all doc comments (store header, rename references) <!-- R3 R5 R6 -->
- [x] T004 In `app/desktop/src/menu.ts`: drop `renameItems` + `MenuCallbacks.onRenameServer`; rename callbacks to `onSwitchHost`/`onAddHost`/`onRemoveHost`; menu label `Servers` → `Hosts`, `Add Server…` → `Add Host…`; import `HostEntry` from `./hosts`; `serversMenu` → `hostsMenu` with host-named params; update header-comment Rename/Servers references (keep the Local Daemon submenu and all accelerators as-is) <!-- R3 R4 R5 -->
- [x] T005 In `app/desktop/src/main.ts`: add the `runRk` env override (`PATH: augmentPath(process.platform, process.env.PATH)`); delete the `onRenameServer` callback, the `welcome:rename-server` handler, and `parseRenamePayload`; switch imports to `./hosts`; rename internals (`switchToHost`, `connectLocalHost`, `confirmAndRemoveHost`, `isHostsSender`, host-named locals/comments); rename channels `welcome:test-server`/`welcome:add-server` → `welcome:test-host`/`welcome:add-host`; keep `servers:list`/`servers:switch` channel names AND the `{ ok: true, servers: [...] }` envelope key (SPA boundary) <!-- R2 R3 R5 -->
- [x] T006 [P] In `app/desktop/src/preload.ts`: drop `renameServer`; rename `__welcome` methods `testServer`/`addServer` → `testHost`/`addHost` invoking the new `welcome:*` channels; keep the `servers` group byte-identical; update header comments <!-- R3 R5 -->
- [x] T007 In `app/desktop/src/welcome/welcome.ts`: remove the `?mode=rename` variant (renameId detection, `rename()`, idle-label switch, field show/hide, tagline mutation) and the now-unused `tagline`/`urlLabel`/`nameLabel`/`nameInput` element plumbing; bridge shape checks become `testHost`/`addHost`/`cancel`; local-section wiring drops the `mode !== "rename"` condition; update header comments and remote-flow copy references <!-- R3 R5 -->
- [x] T008 [P] In `app/desktop/src/welcome/welcome.html`: delete the hidden Display-name label + input and their rename-mode comment; `Server URL` label → `Host URL`; divider "or a remote server" → "or a remote host"; update the local-section comment's rename-mode mention <!-- R3 R4 -->

### Phase 3: Integration & Edge Cases

- [x] T009 In `app/desktop/src/hosts.test.ts`: update imports/identifiers/fixtures to host naming (`hosts.json`, `hosts` array key, `result.host`), delete the three `renameServer` tests, keep every other behavior case (corrupt→empty, lastPath tolerance, origin ownership, active resolution, infos projection) <!-- R7 R6 -->
- [x] T010 [P] In `app/desktop/src/local-daemon.test.ts`: add `augmentPath` cases — darwin GUI-PATH append, no duplication when a dir is already present, undefined current PATH, linux prefixes, win32 pass-through <!-- R7 R1 -->
- [x] T011 Verification: `cd app/desktop && rm -rf dist && pnpm run compile && pnpm run test` — clean compile (stale `dist/servers.*` gone) and all node:test suites green; sweep `app/desktop/src/` for leftover `renameServer`/`servers.json`/`welcome:test-server`/`welcome:add-server`/`ServerEntry` references <!-- R1 R2 R3 R4 R5 R6 R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `augmentPath` exists in `local-daemon.ts`, pure and injected, appending the platform brew bin dirs without duplication; win32/unknown platforms and already-complete PATHs pass through
- [x] A-002 R2: `runRk` passes `env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) }` to `execFileAsync`, covering every rk invocation through the single wrapper
- [x] A-003 R5: `hosts.ts` exports the host-named store API and `menu.ts`/`main.ts`/`preload.ts`/`welcome.ts` consume it; `welcome:test-host`/`welcome:add-host` are the only welcome mutation channels
- [x] A-004 R6: The store reads/writes `<userData>/hosts.json` with the `hosts` array key at schema version 1

### Behavioral Correctness

- [x] A-005 R4: Menu shows `Hosts` / `Add Host…`; welcome shows `Host URL` and "or a remote host"; "Local Daemon" submenu naming and daemon dialog framing unchanged
- [x] A-006 R5: The `servers:list`/`servers:switch` channels, the preload `servers` group, and the `{ ok: true, servers: [...] }` envelope key are byte-identical to before — the SPA palette switch block keeps working with no frontend change
- [x] A-007 R6: A userData dir holding only an old `servers.json` loads as an empty host list (welcome route); the old file is never read, migrated, or deleted

### Removal Verification

- [x] A-008 R3: No `renameServer`/`renameHost`, `welcome:rename-server`, `parseRenamePayload`, `onRenameServer`, `?mode=rename` handling, or rename-mode markup remains anywhere in `app/desktop/src/`
- [x] A-009 R3: The welcome page's "This Mac" wiring condition no longer references a rename mode (gates only on platform heading + daemon bridge)

### Scenario Coverage

- [x] A-010 R1: `local-daemon.test.ts` covers the darwin GUI-PATH append, dedup, undefined-PATH, linux, and win32 cases
- [x] A-011 R7: `hosts.test.ts` covers the renamed store end-to-end (add/remove/active/lastPath/origin-ownership/corrupt-file) against `hosts.json` with zero rename cases

### Edge Cases & Error Handling

- [x] A-012 R1: A PATH already containing one brew dir but not the other gains only the missing one; the delimiter is `:` and no trailing/duplicate separators are introduced
- [x] A-013 R6: Corrupt or wrong-shape `hosts.json` still loads as an empty list; wrong-typed `lastPath` drops the field, not the file

### Code Quality

- [x] A-014 Pattern consistency: new/renamed code follows the module's electron-free + structural-narrowing patterns; no `as` casts introduced
- [x] A-015 No unnecessary duplication: brew prefixes have a single source shared by `rkCandidatePaths` and `augmentPath`
- [x] A-016 Subprocess discipline: every `execFile` call keeps an argument slice and explicit timeout (Constitution I); the env override adds no shell-string invocation
- [x] A-017 Tests included: changed behavior (PATH augmentation, host store, removals) is covered by the node:test suites and the compile gate

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/desktop/src/welcome/welcome.html:180` (`<p id="tagline">`) — the `id` existed for the rename variant's `tagline.textContent` mutation (now removed); no code reads or writes the element anymore, so the `id` attribute is dead (the static paragraph itself stays as copy).
- `app/desktop/src/main.ts:88-91` (`ServersListResult`) — a private one-use type alias whose only consumer is the `servers:list` handler's return annotation; inlining `{ ok: true; servers: HostInfo[] } | { ok: false; error: string }` would remove the indirection, though the alias documents the frozen SPA envelope and is arguably worth keeping.
- No further candidates: the rename chain's own removal (menu items, `MenuCallbacks.onRenameServer`, `welcome:rename-server` handler, `parseRenamePayload`, `renameServer` store mutator, `?mode=rename` welcome variant, the hidden Display-name markup, the `tagline`/`urlLabel`/`nameLabel`/`nameInput` element plumbing, three store tests) was already performed in-change, and `augmentPath` shares `brewBinDirs` with `rkCandidatePaths` rather than duplicating the prefixes.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Brew prefixes get a single shared source in `local-daemon.ts` (`brewBinDirs(platform)`) consumed by both `rkCandidatePaths` and `augmentPath` | Intake says augmentPath uses "the same prefixes rkCandidatePaths already encodes"; code-quality bans duplication — deriving both from one list is the direct reading | S:70 R:90 A:85 D:80 |
| 2 | Certain | `augmentPath` APPENDS missing dirs (end of PATH), `:`-joined; undefined PATH yields just the brew dirs | Intake verbatim: "Appends the platform brew bin dirs to PATH when missing"; append preserves system-binary precedence | S:85 R:90 A:90 D:85 |
| 3 | Confident | The `servers:list` response envelope key stays `servers` (only channel names were frozen explicitly; the key is part of the same SPA contract — `shell.ts` `isServersListOk` narrows on it) | Renaming the key would silently break the palette exactly like renaming the group; boundary = everything `shell.ts` structurally reads | S:60 R:75 A:85 D:80 |
| 4 | Confident | `isServersSender` → `isHostsSender` (intake's explicit rename list), with a comment noting it gates the boundary-frozen `servers:*` channels; the `servers:switch` "Unknown server" error string becomes "Unknown host" (SPA ignores error text) | Intake names `isServersSender` in the follow-host-naming list; error strings are not narrowed by `shell.ts` | S:55 R:85 A:70 D:60 |
| 5 | Confident | Remove-confirm dialog copy is unchanged — `Remove "<name>"?` + origin detail contains no server-instance wording | Intake asks to reword dialog copy "referring to the server list/entries"; inspection shows none exists | S:55 R:90 A:85 D:80 |
| 6 | Confident | Rename-mode-only DOM plumbing (`tagline`/`urlLabel`/`nameLabel`/`nameInput` in `WelcomeElements`, tagline mutation) is removed with the variant; the static HTML tagline and URL label stay | The elements existed "solely for rename-mode reuse" per intake; dead plumbing after removal would fail the orphaned-code rationale that motivated full-chain removal | S:65 R:85 A:85 D:80 |
| 7 | Confident | Neutral identifiers keep their names: `emptyList`, `normalizeOrigin`, `pingServer`, `showActive`, `parseAddPayload`, `ServersListResult`-shaped envelope typing renamed only where private | Intake: tmux-server-adjacent / non-rk-instance names judged case-by-case; these denote origins/pings/lists generically or sit on the frozen boundary | S:50 R:85 A:75 D:65 |

7 assumptions (1 certain, 6 confident, 0 tentative).
