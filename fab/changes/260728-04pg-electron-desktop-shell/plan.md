# Plan: Electron Desktop Viewer Shell

**Change**: 260728-04pg-electron-desktop-shell
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Package Scaffold

#### R1: Self-contained app/desktop pnpm package
`app/desktop/` SHALL be a self-contained pnpm package (own `package.json` + `pnpm-lock.yaml`; NO
`pnpm-workspace.yaml` introduced anywhere — `app/frontend` precedent). devDependencies SHALL be
exactly `electron` (pinned to the current stable major), `electron-builder`, and `typescript`.
Compilation SHALL be plain `tsc` (strict, CommonJS, ES2022, `src/` → `dist/`, no bundler); the
package `main` SHALL be `dist/main.js`; the `compile` script SHALL also copy
`src/welcome/welcome.html` to `dist/welcome/`.

- **GIVEN** a clean checkout with Node 22.12+ (Electron 43's engine floor, declared in the package `engines`) and pnpm 9+
- **WHEN** `pnpm install --frozen-lockfile && pnpm run compile` runs in `app/desktop`
- **THEN** `dist/main.js`, `dist/preload.js`, `dist/welcome/welcome.js`, and
  `dist/welcome/welcome.html` exist and `pnpm exec tsc --noEmit` reports no errors

### Desktop Shell: Server List Store

#### R2: servers.json store with atomic writes
`src/servers.ts` SHALL persist `{ "version": 1, "activeId": <id>, "servers": [{ "id", "name",
"url" }] }` at `<userData>/servers.json`, with `id` from `crypto.randomUUID()`. `url` SHALL be
normalized to `new URL(input).origin` and only `http:`/`https:` protocols accepted (anything else
is a validation error, never persisted). Writes SHALL be tmp-file-then-rename in the same
directory. A corrupt or missing file SHALL load as an empty list (no throw). The module SHALL be
parameterized by data-directory path (electron-free) so it is unit-testable.

- **GIVEN** a `servers.json` containing invalid JSON
- **WHEN** the store loads
- **THEN** it returns an empty list without throwing (startup then routes to welcome)
- **GIVEN** input `HTTP://Host:3000/some/path?x=1`
- **WHEN** `addServer` normalizes the URL
- **THEN** the stored `url` is `http://host:3000`
- **GIVEN** input `ftp://host`
- **WHEN** validated
- **THEN** a validation error is returned and nothing is persisted

### Desktop Shell: Startup Routing & Welcome Flow

#### R3: welcome ↔ active-server routing
On `app.whenReady()`, main SHALL `loadFile(welcome.html)` when the server list is empty, else
`loadURL(activeServer.url)` (falling back to the first server when `activeId` dangles). The
welcome page SHALL implement validate → test ping → add+switch; `?mode=add` SHALL show a cancel
link returning to the active server. `Servers → Remove "<name>"…` SHALL confirm via native
dialog; removing the active server SHALL switch to the first remaining server or welcome. In dev,
`RK_DESKTOP_URL` SHALL load that URL directly without persisting it.

- **GIVEN** no `servers.json`
- **WHEN** the app launches
- **THEN** the welcome page is shown
- **GIVEN** `activeId` references a deleted server
- **WHEN** the app launches
- **THEN** the first server in the list is loaded
- **GIVEN** the active server is removed via the menu
- **WHEN** the removal is confirmed
- **THEN** the window switches to the first remaining server, or welcome when none remain

#### R4: main-process health ping
IPC `welcome:test-server` SHALL ping from the **main process** via
`net.fetch(origin + "/api/health", { signal: AbortSignal.timeout(5000) })`, requiring HTTP 200
with body `status === "ok"`; the returned `hostname` SHALL pre-fill the display name. Failures
(timeout, network error, non-200, wrong body) SHALL return a structured error rendered by the
welcome page; nothing is persisted on failure.

- **GIVEN** a reachable `rk serve` at the entered origin
- **WHEN** Connect is pressed
- **THEN** the ping succeeds within 5s and the name field pre-fills with the returned hostname
- **GIVEN** an unreachable origin
- **WHEN** Connect is pressed
- **THEN** a structured error is shown and no server is added

### Desktop Shell: ⌘-Tier Menu Seam

#### R5: accelerator-avoidance menu
`src/menu.ts` SHALL export `buildMenu(servers, activeId, callbacks)`, rebuilt on every list
change. The menu SHALL bind accelerators ONLY on: ⌘Q quit, ⌘H/⌥⌘H hide; Edit roles
⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A; View ⌘R/⇧⌘R reload, ⌥⌘I devtools, ⌘+/⌘−/⌘0 zoom roles, ⌃⌘F fullscreen;
Servers switcher radio items on ⌃1–⌃9 (Control deliberately — leaves ⌘1–9 free); Window ⌘M
minimize via a custom template (NOT `role: 'windowMenu'`, so no auto-⌘W). ⌘W SHALL remain
unbound, with an accelerator-less "Close Window" menu item. The guaranteed fall-through set
(⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos) SHALL carry no accelerator; no
`globalShortcut` SHALL be registered and no `before-input-event` handler installed. A `menu.ts`
comment SHALL document the seam: future page-first handling of a menu-bound key means removing
its accelerator, not intercepting.

- **GIVEN** the built application menu
- **WHEN** its template is enumerated
- **THEN** the accelerator set is exactly the list above and the active server's radio item is checked
- **GIVEN** a server is added or removed
- **WHEN** the list changes
- **THEN** the menu is rebuilt and ⌃1–⌃9 reflect the new list order

### Desktop Shell: Security Wiring

#### R6: renderer isolation and IPC hardening
The BrowserWindow SHALL use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
and the preload; the shell version SHALL be passed via
`additionalArguments: ['--runkit-shell-version=' + app.getVersion()]` (sandboxed preloads read
`process.argv`). The preload SHALL expose `window.runkitShell = { version, platform, __welcome }`
via `contextBridge`. On `web-contents-created`: `setWindowOpenHandler` SHALL always deny —
registered-server origins load in-window, other http(s) URLs open via `shell.openExternal`;
`will-navigate` SHALL allow only registered origins plus the welcome `file://` URL.
`setPermissionRequestHandler` SHALL allow `clipboard-read`, `clipboard-sanitized-write`,
`notifications` and deny the rest. No `certificate-error` bypass. All `welcome:*` IPC handlers
SHALL verify `event.senderFrame.url` starts with the welcome `file://` URL.

- **GIVEN** a page loaded from a registered server origin
- **WHEN** it invokes `welcome:add-server` via the bridge
- **THEN** the main-process handler rejects it (sender-frame check fails); the page can still read
  `runkitShell.version`/`platform`
- **GIVEN** a link to a non-registered http(s) origin
- **WHEN** it is clicked (window.open or navigation)
- **THEN** it opens in the system browser and never in-window

#### R7: viewer only — never supervises the daemon
`app/desktop` SHALL NOT import `child_process`/`node:child_process` or spawn/supervise any
process (Constitution VI). The shell is a client of an existing `rk serve` URL only.

- **GIVEN** the completed `app/desktop/src/`
- **WHEN** grepped for `child_process` / `spawn(` / `exec`
- **THEN** there are no matches

### Packaging & Build

#### R8: electron-builder config + version injection
`electron-builder.yml` SHALL match the intake block: `appId: ai.shll.run-kit`, `productName: Run
Kit`, `directories: { buildResources: build, output: release }`, packaged files limited to
`dist/**` (excluding compiled test files), mac category `public.app-category.developer-tools`,
per-arch DMG targets (arm64, x64), `identity: null` (ad-hoc, no notarization),
`artifactName: "run-kit-desktop-${version}-${arch}.${ext}"`, `npmRebuild: false`.
`scripts/build-desktop.sh` SHALL derive `VERSION` from `git describe --tags --abbrev=0` (strip
leading `v`, fallback `0.0.0-dev`), verify `build/icon.png` exists (pointing at `just icons` when
missing), run `pnpm install --frozen-lockfile`, compile, then
`electron-builder --mac --publish never --config.extraMetadata.version=$VERSION`. `scripts/build.sh`
and the Go backend SHALL NOT be touched.

- **GIVEN** a Mac with the repo checked out
- **WHEN** `just build-desktop` runs
- **THEN** ad-hoc-signed per-arch DMGs land in `app/desktop/release/` named
  `run-kit-desktop-<version>-<arch>.dmg`, with the version injected via extraMetadata

#### R9: 1024px committed desktop icon
`scripts/generate-icons.sh` SHALL gain a 1024px variant writing `app/desktop/build/icon.png`
(dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask composite for macOS squircle fit)
from `app/frontend/public/icon.svg`, and SHALL be run so the PNG exists in the tree
(committed-ready; builds need neither sharp nor the frontend package).

- **GIVEN** `just icons` has run
- **WHEN** the tree is inspected
- **THEN** `app/desktop/build/icon.png` exists at 1024×1024 with rounded corners, and the three
  existing PWA variants are byte-equivalent regenerations (no behavior change)

#### R10: justfile recipes + scripts + gitignore
`justfile` SHALL gain `dev-desktop:` and `build-desktop:` as one-liners delegating to
`scripts/dev-desktop.sh` and `scripts/build-desktop.sh` (Constitution VIII).
`scripts/dev-desktop.sh` SHALL: `pnpm install` when `node_modules` is missing, compile, then
`pnpm exec electron .`, honoring `RK_DESKTOP_URL` (loads that URL directly without persisting).
`.gitignore` SHALL gain `app/desktop/release/` (the existing bare `dist` entry already covers
compiled TS output).

- **GIVEN** a running `just dev` on port 3000
- **WHEN** `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop` runs on a workstation
- **THEN** the shell opens the dashboard directly and `servers.json` is not created/modified

### Frontend Seam

#### R11: lib/shell.ts + vitest suite
`app/frontend/src/lib/shell.ts` SHALL define the `RunkitShell` interface (`{ version: string;
platform: string }`), a `declare global` Window typing, `isShell()` (type-narrowing guard — no
`as` assertions), and `shellInfo()` returning `RunkitShell | null`. A sibling `shell.test.ts`
(vitest) SHALL cover present/absent/malformed bridge shapes. No other SPA file changes.

- **GIVEN** `window.runkitShell` is absent (plain browser)
- **WHEN** `isShell()` / `shellInfo()` run
- **THEN** they return `false` / `null` without throwing
- **GIVEN** a well-formed bridge object
- **WHEN** `shellInfo()` runs
- **THEN** it returns the typed `{version, platform}` via narrowing
- **GIVEN** a malformed bridge (e.g. `version` not a string)
- **WHEN** `isShell()` runs
- **THEN** it returns `false`

### Non-Goals

- Release CI (desktop-macos job, release.yml outputs) — change 2, backlog `[5uae]`
- Dock badge / native notifications — deferred by user
- Deep-link (`runkit://`) pairing, auto-update, Windows/Linux packaging
- Actual ⌘-tier bindings in the SPA — later change gated on `isShell()`
- Touching `scripts/build.sh` or the Go backend

### Design Decisions

#### ⌘-tier seam is accelerator avoidance, not key interception
**Decision**: Unlock the ⌘ tier by simply not binding accelerators on keys the page should own; no `globalShortcut`, no `before-input-event`.
**Why**: Electron only steals keys via accelerators/globalShortcut/OS — unclaimed keys already reach the page; zero interception code to maintain.
**Rejected**: `before-input-event` routing — adds a fragile dispatch layer v1 doesn't need; documented in menu.ts that un-binding (not intercepting) is the future path.
*Introduced by*: 260728-04pg-electron-desktop-shell

#### Plain servers.json with atomic write, no electron-store
**Decision**: Hand-rolled `<userData>/servers.json` (version 1 schema), tmp-file-then-rename writes, corrupt→empty recovery.
**Why**: Three-dep package stays three deps; the store is ~80 lines and trivially testable when parameterized by directory.
**Rejected**: electron-store — a dependency for a single small file; migration machinery unneeded at v1.
*Introduced by*: 260728-04pg-electron-desktop-shell

#### Store module is electron-free; tests run on node:test
**Decision**: `servers.ts` takes the data directory as a parameter (main.ts passes `app.getPath('userData')`); `src/servers.test.ts` runs via Node's built-in `node --test` after tsc compile, with compiled tests excluded from packaged `files`.
**Why**: code-quality mandates tests for new behavior; node:test keeps the intake's exact three-dep pin while covering normalization/corruption/atomicity.
**Rejected**: adding vitest/jest to app/desktop (violates the dep pin); leaving the store untested (violates code-quality MUST).
*Introduced by*: 260728-04pg-electron-desktop-shell

## Tasks

### Phase 1: Setup

- [x] T001 Scaffold `app/desktop/`: `package.json` (name `run-kit-desktop`, private, version `0.0.0`, `main: dist/main.js`, scripts `compile` (tsc + welcome.html copy), `test` (`node --test "dist/**/*.test.js"`), `dev`, `dist`; devDeps electron/electron-builder/typescript only), `tsconfig.json` (strict, CommonJS, ES2022, lib ES2022+DOM, rootDir `src`, outDir `dist`); run `pnpm install` in `app/desktop` to pin the current electron major and generate `pnpm-lock.yaml` <!-- R1 -->
- [x] T002 [P] Extend `scripts/generate-icons.sh` with a 1024px desktop variant → `app/desktop/build/icon.png` (bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask); ensure sharp is present (`cd app/frontend && pnpm install --frozen-lockfile` if missing), then run `just icons` so the PNG exists <!-- R9 -->

### Phase 2: Core Implementation

- [x] T003 Implement `app/desktop/src/servers.ts` (schema v1 load/save, add/remove/setActive, URL→origin normalization with http/https validation, tmp-then-rename atomic write, corrupt/missing→empty; directory-parameterized) plus `app/desktop/src/servers.test.ts` (node:test: round-trip, normalization, invalid protocol, corrupt file, active-fallback helper) <!-- R2 -->
- [x] T004 [P] Implement `app/desktop/src/preload.ts` — contextBridge exposing `window.runkitShell = { version (from --runkit-shell-version argv), platform: process.platform, __welcome: { testServer, addServer, cancel } }` via ipcRenderer.invoke <!-- R6 -->
- [x] T005 [P] Implement `app/desktop/src/menu.ts` — `buildMenu(servers, activeId, callbacks)` with exactly the R5 accelerator set, ⌃1–⌃9 server radios, custom Window menu (⌘M, accelerator-less Close Window), and the seam-documentation comment <!-- R5 --> <!-- rework: review cycle 1 must-fix — A-019 as-cast at menu.ts:98; replace `{ type: "separator" } as MenuItemConstructorOptions` with a typed const, then re-verify A-019 and mark it [x] -->
- [x] T006 Implement `app/desktop/src/main.ts` — lifecycle, BrowserWindow with R6 webPreferences + additionalArguments, welcome↔active-server routing (incl. dangling-activeId fallback and `RK_DESKTOP_URL` non-persisting dev override), IPC handlers `welcome:test-server` (net.fetch /api/health, 5s AbortSignal timeout, status==="ok", hostname return) / `welcome:add-server` / `welcome:cancel` with senderFrame gating, menu callbacks (add via `?mode=add`, remove with native confirm dialog + active-switch), window-open/will-navigate/permission wiring; no child_process anywhere <!-- R3 R4 R6 R7 -->
- [x] T007 Implement `app/desktop/src/welcome/welcome.html` + `welcome.ts` — URL+name form, validate → ping → pre-fill name → add+switch, error rendering, `?mode=add` cancel link <!-- R3 R4 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Verify the package end-to-end on Linux: `pnpm run compile`, `pnpm exec tsc --noEmit`, `pnpm run test` (node:test on compiled servers tests); if the Electron binary downloaded, optional `xvfb-run pnpm exec electron .` smoke (do not block on it) <!-- R1 R2 -->
- [x] T009 [P] Write `app/desktop/electron-builder.yml` per R8 (incl. `files: ["dist/**", "!dist/**/*.test.js"]`) <!-- R8 -->
- [x] T010 Write `scripts/dev-desktop.sh` + `scripts/build-desktop.sh` (git-describe version, icon check, frozen install, compile, electron-builder invocation), add `dev-desktop:`/`build-desktop:` one-liner recipes to `justfile`, add `app/desktop/release/` to `.gitignore` <!-- R10 R8 -->
- [x] T011 [P] Implement `app/frontend/src/lib/shell.ts` + `app/frontend/src/lib/shell.test.ts`; run `just test-frontend` <!-- R11 -->

### Phase 4: Polish

- [x] T012 Final sweep: `just check` (frontend tsc --noEmit), app/desktop `tsc --noEmit` green, grep `app/desktop/src` for child_process/spawn (must be absent), `git status` confirms `app/desktop/release/` ignored and `build/icon.png` + `pnpm-lock.yaml` tracked-ready <!-- R7 R1 -->

## Execution Order

- T001 blocks T003–T009 (package scaffold + lockfile first)
- T002 is independent ([P] with T001)
- T006 depends on T003/T004/T005; T007 depends on T004/T006 contract
- T010 depends on T001 paths only; T011 fully independent; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/desktop` is self-contained (own lockfile, no workspace file anywhere); strict CJS/ES2022 tsc compiles `src/`→`dist/` with `dist/main.js` entry and welcome.html copied by the compile script
- [x] A-002 R2: servers.json v1 round-trips; URLs normalized to origin (http/https only); atomic tmp-then-rename writes; corrupt/missing file loads as empty list
- [x] A-003 R3: startup routes welcome (empty) / active server (else) with first-server fallback on dangling activeId; `?mode=add` shows cancel; removing the active server switches to first remaining or welcome; RK_DESKTOP_URL loads without persisting
- [x] A-004 R4: `welcome:test-server` pings from the main process with a 5s timeout, requires 200 + `status==="ok"`, and returns `hostname` for name pre-fill; failures produce a structured, rendered error
- [x] A-005 R5: menu binds exactly the enumerated accelerator set; ⌃1–⌃9 radios reflect the active server; custom Window menu without `role: 'windowMenu'`; ⌘W unbound with accelerator-less Close Window; no globalShortcut/before-input-event; seam comment present; menu rebuilt on list changes
- [x] A-006 R6: contextIsolation/sandbox/preload wiring, additionalArguments version pass, window-open deny + openExternal, will-navigate allowlist (registered origins + welcome file://), permission handler allowlist, no certificate-error bypass
- [x] A-007 R8: electron-builder.yml matches the intake block (appId, productName, per-arch DMGs, identity null, artifactName, npmRebuild false) and build-desktop.sh injects the git-describe version via extraMetadata with `0.0.0-dev` fallback
- [x] A-008 R9: 1024px masked variant added to scripts/generate-icons.sh, `just icons` run, `app/desktop/build/icon.png` present in the tree
- [x] A-009 R10: justfile recipes are one-liners delegating to the two new scripts; `.gitignore` covers `app/desktop/release/`
- [x] A-010 R11: `lib/shell.ts` + `shell.test.ts` exist and `just test-frontend` passes including the new suite

### Scenario Coverage

- [x] A-011 R2: normalization, invalid-protocol, and corrupt-file scenarios are exercised by `servers.test.ts` (node:test) and pass via `pnpm run test`
- [x] A-012 R11: present/absent/malformed bridge scenarios are exercised by `shell.test.ts`

### Edge Cases & Error Handling

- [x] A-013 R3: dangling `activeId` falls back to the first server (covered by store helper test or main routing logic)
- [x] A-014 R4: unreachable server / non-ok body → error shown on welcome, nothing persisted

### Security

- [x] A-015 R6: `welcome:*` IPC handlers reject calls whose senderFrame URL is not the welcome file:// URL (server pages can read version/platform only)
- [x] A-016 R7: no child_process import or process spawning in `app/desktop` — the shell never spawns/supervises the rk daemon

### Code Quality

- [x] A-017 Pattern consistency: new TS follows house style (doc-comment headers, named constants, small focused modules); scripts follow existing `scripts/*.sh` conventions (`set -euo pipefail`-style guards, repo-root cd); justfile stays a thin index
- [x] A-018 No unnecessary duplication: no reimplementation of existing utilities; welcome page reuses the health endpoint rather than a bespoke probe
- [x] A-019 Type narrowing over assertions: `shell.ts` and desktop TS use guards/discriminated shapes, no `as` casts — met — typed const, no assertions remain
- [x] A-020 Tests included for new behavior: shell.test.ts (vitest) + servers.test.ts (node:test); no polling loops introduced in the frontend

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Verification split (Linux execution env): DMG build, Gatekeeper walkthrough, xterm ⌘C/⌘V, and ⌘-fall-through feel are a handed-off manual checklist for a Mac; Linux verifies compile, unit tests, and (optionally) an xvfb smoke

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (purely additive: new `app/desktop/` package, new `lib/shell.ts` seam, new scripts/recipes; the PWA install path and all existing build tooling remain in use).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Electron pinned to the current stable major resolved at install time (caret range within that major) | Intake says "pin current stable major" without naming it; whatever `pnpm add -D electron` resolves today is that major | S:70 R:90 A:85 D:80 |
| 2 | Confident | `servers.ts` directory-parameterized + `servers.test.ts` on node:test (zero new deps); compiled tests excluded from packaged `files` | code-quality MUST-include-tests vs intake's exact three-dep pin — node:test satisfies both; intake's 7-file listing is additive-compatible | S:60 R:90 A:85 D:70 |
| 3 | Confident | Single tsconfig with `lib: [ES2022, DOM]` covering main + preload + welcome renderer TS | One-package simplicity; DOM types are harmless in main-process files; two tsconfigs add build complexity v1 doesn't need | S:60 R:90 A:85 D:75 |
| 4 | Confident | Rounded-rect mask radius ≈ 22.37% of icon size (macOS squircle approximation) via SVG rect composited `dest-in` | Intake specifies "rounded-rect dest-in mask" without a radius; Apple's app-icon ratio is the obvious default; cosmetic and reversible | S:55 R:95 A:80 D:70 |
| 5 | Confident | Servers-menu accelerators use literal `Ctrl+1`…`Ctrl+9` (not CmdOrCtrl) | Intake mandates Control deliberately to keep ⌘1–9 free — CmdOrCtrl would rebind ⌘ on macOS, defeating the seam | S:80 R:95 A:90 D:90 |
| 6 | Confident | `__welcome` bridge exposed on all pages but privileged only via main-side senderFrame gating | Intake's hardening model gates in main ("server-loaded pages … never invoke privileged calls"); conditional preload exposure would duplicate the same check with more surface | S:70 R:85 A:85 D:80 |

6 assumptions (0 certain, 6 confident, 0 tentative).
