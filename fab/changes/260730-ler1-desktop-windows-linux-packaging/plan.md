# Plan: Desktop Shell Windows & Linux Packaging

**Change**: 260730-ler1-desktop-windows-linux-packaging
**Intake**: `intake.md`

## Requirements

### Packaging: electron-builder Windows & Linux targets

#### R1: Windows and Linux build targets
`app/desktop/electron-builder.yml` MUST declare a Windows NSIS x64 target and Linux AppImage + deb targets for x64 and arm64, keeping the existing mac configuration and the global `run-kit-desktop-${version}-${arch}.${ext}` artifact naming untouched. Windows MUST ship unsigned (no Authenticode — SmartScreen first-launch friction accepted, mirroring the mac ad-hoc posture); Linux needs no signing. The deb target MUST resolve a maintainer without adding a personal email to the repo (package.json deliberately carries no `author`), via `linux.maintainer` set to the GitHub noreply address.

- **GIVEN** the electron-builder config
- **WHEN** `electron-builder --win` or `--linux` runs
- **THEN** it produces `run-kit-desktop-{version}-x64.exe` (NSIS), `run-kit-desktop-{version}-{x64,arm64}.AppImage`, and `run-kit-desktop-{version}-{x64,arm64}.deb`
- **AND** `--mac` output is byte-for-byte governed by the same config lines as before this change

#### R2: afterPack ad-hoc codesign hook stays mac-only
`app/desktop/after-pack.js` MUST skip all work when `electronPlatformName` is not `darwin`, so Windows/Linux packs never invoke `codesign` (which does not exist on those runners). The guard already exists on the current branch (shipped with #465); this change MUST verify it and document why non-darwin packs skip.

- **GIVEN** an electron-builder pack for `win32` or `linux`
- **WHEN** the afterPack hook fires
- **THEN** it returns before touching `codesign`

### Menu: per-platform application (`src/menu.ts`)

#### R3: Windows/Linux menu binds nothing in the page tier
`buildMenu` MUST branch on platform. On macOS the menu MUST remain behaviorally identical to today (App/Edit/View/Servers/Window, same accelerators including the literal ⌃1–9 switcher radios — the two-tier `CmdOrCtrl` re-expression belongs to the pending sibling change 260730-9lez and is NOT implemented here). On Windows/Linux the shell MUST NOT bind any unshifted `Ctrl+<key>` accelerator (that tier is the browser-reserved tier the shell exists to liberate there):

- **No Edit menu** — Chromium handles Ctrl+C/V/X/A/Z natively on win/linux (the mac Edit roles exist only for the macOS clipboard quirk).
- **File → Quit** replaces the mac App menu, as a plain accelerator-less item (the `quit` role default-binds Ctrl+Q on Linux, which is page tier).
- **No Window menu** — native window chrome covers minimize/close (the `minimize` role default-binds Ctrl+M).
- **View menu keeps item parity** with mac, but roles whose win/linux default accelerator is unshifted Ctrl (`reload` Ctrl+R, `resetZoom` Ctrl+0, `zoomIn`/`zoomOut` Ctrl+±) become plain accelerator-less items; shifted-tier defaults (`forceReload` Ctrl+Shift+R, `toggleDevTools` Ctrl+Shift+I) and `togglefullscreen` (F11) keep their roles.
- **Servers switcher radios ship accelerator-less on win/linux** — literal Ctrl+1–9 is exactly the page tier there; menu clicks remain the switch path until 9lez claims `Shift+CmdOrCtrl+1–9` on all platforms.

The structure MUST be composed per-menu so 9lez's two-tier table can layer on top without re-deriving the platform split.

- **GIVEN** the shell running on `win32` or `linux`
- **WHEN** the application menu is built
- **THEN** no menu item carries an unshifted `Ctrl+<key>` accelerator
- **AND** on `darwin` the built template is behaviorally identical to the pre-change menu

### Build scripts: platform branching

#### R4: `build-desktop.sh` platform branching, justfile stays a one-liner
`scripts/build-desktop.sh` MUST accept an optional explicit target argument (`mac`|`win`|`linux`) and default to the host platform via `uname`, mapping to `electron-builder --mac/--win/--linux`. An unknown target MUST error non-zero. Version injection via `--config.extraMetadata.version` and the icon-existence check stay unchanged and platform-neutral. The `justfile` `build-desktop` recipe MUST remain a one-liner delegating to the script (Constitution VIII), passing arguments through.

- **GIVEN** `just build-desktop` on a Linux host
- **WHEN** the script runs with no argument
- **THEN** it invokes `electron-builder --linux --publish never` with the derived version
- **GIVEN** `scripts/build-desktop.sh bsd`
- **WHEN** the target is validated
- **THEN** the script exits non-zero with a usage error

### Release CI: desktop-linux and desktop-windows jobs

#### R5: Two additive release jobs mirroring `desktop-macos`
`.github/workflows/release.yml` MUST gain `desktop-linux` (ubuntu-latest: AppImage + deb, x64 + arm64) and `desktop-windows` (windows-latest: NSIS x64 — native runner, no wine) jobs, each mirroring `desktop-macos`: `needs: release`, checkout of the release tag, Node 22 + pnpm 9, frozen deps, compile, `electron-builder --<platform> --publish never` with the version from the release job's output, and `gh release upload … --clobber` of the platform artifacts. The codesign verification hard-gate stays in `desktop-macos` only. The Windows job's run steps MUST use bash so the shared `cd app/desktop && …` step shape works unmodified.

- **GIVEN** a `v*` tag push
- **WHEN** the release workflow runs
- **THEN** the release carries ~6 desktop assets: 2 mac DMGs, 2 AppImages, 2 debs, 1 NSIS exe
- **AND** neither new job runs `codesign`

### Non-Goals

- The two-tier `Shift+CmdOrCtrl` accelerator table, the `CmdOrCtrl` re-expression of the mac table, and the palette/bridge server switching — all 9lez scope (`260730-9lez-shell-keyboard-tier-symmetry`).
- Windows arm64 target — deferred per intake open question; a config-line addition later.
- Authenticode signing / notarization, snap/rpm/flatpak, in-app auto-update.
- Extending `rk desktop install`/`update` beyond macOS — separate change if wanted.

### Design Decisions

#### Win/Linux page-tier View items are plain accelerator-less items, not suppressed roles
**Decision**: On win/linux, `reload`/`resetZoom`/`zoomIn`/`zoomOut` are rebuilt as plain menu items with click handlers and no accelerator; only shifted-tier and function-key roles stay as roles.
**Why**: Role items cannot have their default accelerator removed (only overridden), and `registerAccelerator: false` still *displays* the dead accelerator — a UX lie. Plain items keep item parity with the mac menu while keeping the page tier clean.
**Rejected**: Dropping the items entirely (loses the mouse path for reload/zoom); `registerAccelerator: false` (displays Ctrl+R while the key falls through to a page that does nothing with it).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging

#### Win/Linux switcher radios are accelerator-less until 9lez lands
**Decision**: The Servers radios bind their literal `Ctrl+N` accelerators only on macOS; win/linux get menu-click switching with no accelerator.
**Why**: 9lez (which moves the switcher to `Shift+CmdOrCtrl+1–9`) is unlanded on this branch; binding Ctrl+1–9 on win/linux would steal exactly the page tier this change exists to deliver. Accelerator-less radios are correct under both the pre- and post-9lez contract, so the changes compose in either merge order.
**Rejected**: Implementing the 9lez chord here (its scope, would collide); keeping Ctrl+1–9 on win/linux (contradicts the shell's premise there).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging

## Tasks

### Phase 1: Packaging config

- [x] T001 Add `win` (NSIS x64) and `linux` (AppImage + deb, x64 + arm64, `maintainer`, `category: Development`) sections to `app/desktop/electron-builder.yml`; leave mac config and global artifactName untouched <!-- R1 -->
- [x] T002 [P] Verify the `electronPlatformName !== "darwin"` guard in `app/desktop/after-pack.js` and annotate why non-darwin packs skip <!-- R2 -->

### Phase 2: Menu per-platform application

- [x] T003 Restructure `app/desktop/src/menu.ts` into per-menu builders branching on `process.platform === "darwin"`: mac table unchanged; win/linux = File→Quit (plain), View (parity items, page-tier ones accelerator-less), Servers (accelerator-less radios), no Edit, no Window; update the header-comment contract for the per-platform application <!-- R3 -->

### Phase 3: Build script & CI

- [x] T004 Extend `scripts/build-desktop.sh` with an optional `mac|win|linux` target argument defaulting to the host platform (`uname`), mapping to the electron-builder platform flag, erroring on unknown targets; update header comment <!-- R4 -->
- [x] T005 [P] Update the `justfile` `build-desktop` recipe to pass arguments through as a one-liner (`build-desktop *args:`) and refresh its comment <!-- R4 -->
- [x] T006 Add the `desktop-linux` job to `.github/workflows/release.yml` (ubuntu-latest, tag checkout, Node 22 + pnpm 9 frozen install, compile, `electron-builder --linux --publish never` with the release version, `gh release upload` of `*.AppImage` + `*.deb` with `--clobber`) <!-- R5 -->
- [x] T007 [P] Add the `desktop-windows` job (windows-latest, `shell: bash` run default, same step shape, `electron-builder --win`, upload `release/*.exe`) <!-- R5 -->

### Phase 4: Verification

- [x] T008 Run the Linux-runnable gates: `pnpm install --frozen-lockfile` + `pnpm run compile` + `node --test` in `app/desktop`, `bash -n scripts/build-desktop.sh`, YAML-parse `release.yml` + `electron-builder.yml`, `just --summary` <!-- R1 R3 R4 R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `electron-builder.yml` declares NSIS x64 for Windows and AppImage + deb (x64 + arm64) for Linux with a maintainer, no Windows signing config, mac section and artifactName unchanged — verified: config validates against `app-builder-lib/scheme.json` (ajv, `valid: true`); `win`/`linux` blocks parse as expected; mac block and `artifactName` untouched in the diff. Note: because the global `artifactName` is user-forced, `${arch}` always expands, and `getArtifactArchName` maps x64 → `x86_64` for AppImage and `amd64` for deb — so real filenames are `-x86_64.AppImage` / `-amd64.deb`, not the literal `-x64` the requirement text implies (upload globs are extension-based, so unaffected)
- [x] A-002 R2: `after-pack.js` returns early for any `electronPlatformName` other than `darwin` — guard present at `after-pack.js:22` with the new explanatory comment above it
- [x] A-003 R3: On win/linux the built menu template contains no unshifted `Ctrl+<key>` accelerator: no Edit menu, no Window menu, plain File→Quit, accelerator-less Servers radios, page-tier View items accelerator-less — verified empirically: compiled `dist/menu.js` loaded under a mocked `electron` with `process.platform` forced to `win32` and `linux`; template top menus are `File | View | Servers` and the ONLY bound accelerators are `Shift+CmdOrCtrl+R`, `Ctrl+Shift+I`, `F11`. Electron 43.2.0's role→accelerator table was read out of the shipped binary to confirm the premises (`reload`=CmdOrCtrl+R, `resetzoom`=CommandOrControl+0, `zoomin`=CommandOrControl+Plus, `zoomout`=CommandOrControl+-, `minimize`=CommandOrControl+M, `quit`=Ctrl+Q on linux / none on win32, `forcereload`=Shift+CmdOrCtrl+R, `toggledevtools`=Ctrl+Shift+I, `togglefullscreen`=F11)
- [x] A-004 R4: `build-desktop.sh` maps `mac|win|linux` (explicit or host-derived) to the matching electron-builder flag; `justfile` recipe is a pass-through one-liner (Constitution VIII) — executed with a stubbed `pnpm`: no-arg on this Linux host → `--linux`, `mac`→`--mac`, `win`→`--win`, `linux`→`--linux`. Recipe `build-desktop *args: scripts/build-desktop.sh {{args}}` matches the existing `dev *args:` pattern (justfile:27)
- [x] A-005 R5: `desktop-linux` and `desktop-windows` jobs exist with `needs: release`, tag checkout, Node 22, frozen pnpm install, `--publish never`, release-job version output, and `--clobber` uploads — all present (`release.yml:205-279`), same pinned action SHAs as `desktop-macos`; `desktop-windows` carries `defaults.run.shell: bash`

### Behavioral Correctness

- [x] A-006 R3: On darwin the menu is behaviorally identical to the pre-change menu (same items, same accelerators, including literal ⌃1–9 radios) — PROVEN by structural diff: compiled the pre-change `menu.ts` (from `HEAD`) and the post-change one, built both templates under a mocked `electron` with `platform=darwin`, and serialized every item's label/role/type/accelerator/checked/click-presence recursively. The two serializations are byte-identical
- [x] A-007 R5: The codesign verification hard-gate appears only in `desktop-macos`; neither new job invokes `codesign` — `codesign` appears only at `release.yml:196-197`; grep of both new jobs is clean, and both carry a comment stating why

### Scenario Coverage

- [x] A-008 R4: An unknown target argument to `build-desktop.sh` exits non-zero with a usage error — `build-desktop.sh bsd` → `usage: build-desktop.sh [mac|win|linux]  (default: host platform)` on stderr, exit 1. `MAC` (wrong case) also correctly rejected
- [x] A-009 R1: Compile + node:test pass on Linux after the config changes (the CI-runnable half of the verification split) — `pnpm run compile` clean under `strict`/`noUnusedLocals`; `pnpm test` → 15/15 pass. `bash -n scripts/build-desktop.sh` clean; both YAML files parse; `just --summary` lists `build-desktop`

### Edge Cases & Error Handling

- [x] A-010 R1 **N/A (hardware-verify)**: Windows SmartScreen first-launch walkthrough of the unsigned NSIS installer — requires Windows hardware, not runnable in this environment or CI
- [x] A-011 R1 **N/A (hardware-verify)**: AppImage + deb launch on a real Linux distro with desktop session — requires a graphical Linux host
- [x] A-012 R3 **N/A (hardware-verify)**: Ctrl+C/Ctrl+V ↔ xterm.js interplay on Windows/Linux (the mac ⌘C/⌘V equivalent) — requires hardware with the packaged shell

### Code Quality

- [x] A-013 Pattern consistency: new yml/CI/script/menu code follows the surrounding shapes (job step mirroring, per-menu builders, bash conventions in `scripts/`) — CI jobs mirror `desktop-macos` step-for-step with the same pinned SHAs; `build-desktop.sh` keeps `set -euo pipefail` + the `cd "$(dirname "$0")/…"` idiom and uses `case`-based validation; the justfile recipe matches the `dev *args:` precedent; `menu.ts` keeps the annotate-every-accelerator comment convention and reuses the file's pre-existing `BrowserWindow.getFocusedWindow()` access pattern rather than importing `main.ts`'s `mainWindow` singleton
- [x] A-014 No unnecessary duplication: the two new CI jobs share the `desktop-macos` step shape rather than inventing a new one; menu builders reuse the existing callbacks/roles — every new symbol (`focusedWebContents`, `zoomBy`, the six `*Menu()` builders) has a call site; `buildMenu`'s exported signature is unchanged so its sole caller (`main.ts:25`) needed no edit; the win/linux plain View items replicate the Electron role bodies exactly (`zoomLevel ± 0.5`, `zoomLevel = 0`) rather than inventing new zoom semantics

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/desktop/package.json:14` (`"dist": "electron-builder --mac --publish never"`) — the last hard-coded `--mac` left in the package now that `scripts/build-desktop.sh` owns platform selection; the script never invokes `pnpm run dist` (it calls `pnpm exec electron-builder` directly) and neither does CI, so this script has zero call sites and is now actively misleading on a win/linux host. Delete it, or re-point it at `../../scripts/build-desktop.sh`.
- `MAX_SWITCHER_ACCELERATORS` (`app/desktop/src/menu.ts:47`) — not redundant yet, but its guard is now reachable on macOS only (`isMac && index < MAX_SWITCHER_ACCELERATORS`). When 260730-9lez moves the switcher to `Shift+CmdOrCtrl+1–9` on all platforms, the `isMac &&` conjunct becomes dead and should be removed rather than left as a vestigial platform test.
- No production code was made redundant by the packaging/CI additions — `electron-builder.yml`'s mac block, `after-pack.js`, and the `desktop-macos` job all remain live and are the shape the two new jobs deliberately mirror.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | 9lez is unlanded on this branch — implement the per-platform split against the current (pre-9lez) `menu.ts`: mac table unchanged (literal ⌃1–9 stays), win/linux switcher radios accelerator-less until 9lez claims `Shift+CmdOrCtrl+1–9` | Dependency is "land first OR same release" (releases cut by tag), so merge order alone is no violation; accelerator-less radios are correct under both pre- and post-9lez contracts, composing in either order | S:75 R:85 A:80 D:75 |
| 2 | Confident | Win/Linux View menu keeps item parity but re-expresses page-tier roles (`reload`, zoom trio) as plain accelerator-less items; shifted-tier roles (⇧Ctrl+R, Ctrl+⇧I) and F11 keep role defaults | Intake demands "page tier stays completely clean" on win/linux; role default accelerators cannot be removed, only overridden | S:55 R:85 A:75 D:65 |
| 3 | Confident | Win/Linux quit is a plain accelerator-less `File → Quit`/`Exit` item, not the `quit` role | The role default-binds Ctrl+Q on Linux — page tier; `window-all-closed` already quits on non-mac | S:60 R:90 A:80 D:75 |
| 4 | Confident | No Window menu on win/linux | The custom Window template is a mac shape per intake; the `minimize` role default-binds Ctrl+M (page tier), and native window chrome covers minimize/close there | S:55 R:90 A:80 D:70 |
| 5 | Confident | deb maintainer supplied as `linux.maintainer: sahil87 <sahil87@users.noreply.github.com>` in electron-builder.yml | deb hard-requires a maintainer; package.json has no `author` and committing a personal email to a public repo is worse — the GitHub noreply address is the conventional stand-in | S:40 R:90 A:80 D:70 |
| 6 | Certain | `desktop-windows` run steps default to `shell: bash` | Keeps the `cd app/desktop && …` step shape identical across the three desktop jobs; bash ships on windows-latest runners | S:50 R:95 A:90 D:85 |
| 7 | Certain | `build-desktop.sh` takes an optional explicit `mac\|win\|linux` target and defaults to the host platform | Intake states exactly this pair of behaviors ("per host platform, or an explicit target argument") | S:80 R:90 A:90 D:85 |

7 assumptions (2 certain, 5 confident, 0 tentative).
