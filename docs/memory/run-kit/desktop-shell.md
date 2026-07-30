---
description: "The app/desktop Electron viewer shell — a BrowserWindow client of an existing rk serve URL that never spawns or supervises the daemon. Covers the servers.json store, welcome flow, the ⌘-tier accelerator-avoidance menu seam (⌃1–9 switcher, ⌘W unbound), the window.runkitShell preload bridge + isShell() seam, security wiring (sandbox, navigation/permission allowlists, senderFrame-gated IPC), and ad-hoc per-arch DMG packaging — local plus the desktop-macos release job attaching DMGs to each Release."
type: memory
---
# Desktop Viewer Shell (`app/desktop`)

`app/desktop` is an Electron **viewer shell**: a BrowserWindow that loads an existing `rk serve` URL directly — the Slack "enter your workspace URL" model. It exists to remove the browser keyboard ceiling: the `⌘+letter` / `⌘1–9` tier is browser-reserved and can never reach a web page, which caps a keyboard-first product (Constitution V). Inside the shell, every key the shell does not claim reaches the SPA. Loading the server's own HTTP origin needs zero SPA changes for basic function because the SPA is 100% origin-relative (bare `fetch("/api/…")`, WS URLs built from `window.location`).

The shell is a **client only** (Constitution VI): it never spawns or supervises the rk daemon — no `child_process` import exists anywhere in the package. The tmux/server layer stays fully independent of any desktop process.

## Package Shape

Self-contained pnpm package (own `package.json` + `pnpm-lock.yaml`; no `pnpm-workspace.yaml` anywhere in the repo — the `app/frontend` precedent). devDependencies are exactly three: `electron` (`^43`), `electron-builder`, `typescript`. Compilation is plain `tsc` — strict, `module: nodenext` (CommonJS emit for main/preload; no `"type": "module"`), ES2022 + DOM libs, `src/` → `dist/`, no bundler; `moduleDetection: "auto"` so `src/welcome/welcome.ts` (deliberately import/export-free) emits as a browser-runnable global script. Package `main` is `dist/main.js`; the `compile` script also copies `src/welcome/welcome.html` to `dist/welcome/`. `pnpm.onlyBuiltDependencies: [electron]` permits the Electron binary postinstall.

```
app/desktop/
├── package.json            # run-kit-desktop, private, version 0.0.0 placeholder (injected at build)
├── pnpm-lock.yaml
├── tsconfig.json
├── electron-builder.yml
├── build/icon.png          # committed 1024px raster (see § Packaging)
└── src/
    ├── main.ts             # lifecycle, BrowserWindow, security wiring, IPC, welcome ↔ server routing
    ├── servers.ts          # servers.json store (electron-free, directory-parameterized)
    ├── servers.test.ts     # node:test suite over the compiled store
    ├── menu.ts             # buildMenu(servers, activeId, callbacks) — the ⌘-tier seam
    ├── preload.ts          # contextBridge: window.runkitShell
    └── welcome/
        ├── welcome.html    # static first-run/add-server page (CSP: default-src 'none')
        └── welcome.ts      # renderer script — structural bridge narrowing, no imports
```

Package tests run via `node --test "dist/**/*.test.js"` after compile — the store module is electron-free precisely so Node's built-in runner covers it without adding a test dependency. Compiled test files are excluded from packaging (`files: ["dist/**", "!dist/**/*.test.js"]`).

## Server-List Store (`src/servers.ts`)

`<userData>/servers.json`, schema version 1:

```json
{ "version": 1, "activeId": "b3f1…", "servers": [{ "id": "<randomUUID>", "name": "studio-mac", "url": "http://100.101.2.3:3000" }] }
```

- **Origin normalization**: `url` is stored as `new URL(input).origin` — only `http:`/`https:` accepted; anything else (ftp:, file:, garbage) is a validation error and is never persisted. Path/query/case in the input are dropped by the origin reduction.
- **Atomic write**: tmp-file-then-rename in the same directory (`servers.json.tmp-<pid>` → `servers.json`).
- **Corrupt → empty**: a missing, unreadable, corrupt, or wrong-shape file loads as an empty list without throwing (the full shape is structurally validated, including `version === 1`); startup then routes to the welcome page.
- **Active resolution**: `resolveActiveServer` returns the `activeId` entry, falls back to the **first** server when `activeId` dangles, `null` when the list is empty. `addServer` sets the new entry active (empty display name defaults to the origin); removing the active server promotes the first remaining entry.
- **Electron-free**: the data directory is a parameter (`main.ts` passes `app.getPath('userData')`), keeping the module unit-testable under plain `node --test`.

## Startup Routing & Welcome Flow

On `app.whenReady()`: empty list → `loadFile(welcome.html)`; else `loadURL(resolveActiveServer(...).url)`. The dev override `RK_DESKTOP_URL` (see § Dev & Build Entrypoints) short-circuits routing entirely and is never persisted; its normalized origin also joins the allowed-navigation set. `window-all-closed` quits except on macOS; `activate` reopens the window.

The welcome page (static HTML + compiled script, CSP `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`) implements **validate → test ping → add+switch**:

1. Connect submits the URL to IPC `welcome:test-server`; the **main process** pings `net.fetch(origin + "/api/health", { signal: AbortSignal.timeout(5000) })` — the renderer stays sandboxed and does no cross-origin fetch. Success requires HTTP 200 with body `status === "ok"` (`app/backend/api/health.go`); the returned `hostname` pre-fills the display-name field when it is empty. Failures (timeout, network error, non-200, non-JSON, wrong body) return a structured `{ ok: false, error }` rendered inline; nothing is persisted on failure.
2. `welcome:add-server {name, url}` persists, sets active, rebuilds the menu, and `loadURL`s the new server.
3. `?mode=add` (menu `Servers → Add Server…`) shows a cancel link → `welcome:cancel` returns to the active server.

Post-first-run management lives in the menu: `Servers → Add Server…` reloads welcome with `?mode=add`; `Servers → Remove "<name>"…` opens a native confirm dialog (Cancel is the default), and removing the active server switches to the first remaining server or welcome. Opened outside the shell, the welcome page degrades to an inline "bridge unavailable" error with the Connect button disabled.

## ⌘-Tier Menu Seam (`src/menu.ts`)

The point of the shell. Electron steals a key from the page only via menu accelerators, `globalShortcut` (none registered), or the OS — so the seam is: **do not bind accelerators on keys the page should own**. Unclaimed keys already reach the loaded SPA; there is no `before-input-event` interception, and none should be added — if the SPA later needs page-first handling of a key that IS menu-bound, the fix is to **remove that menu item's accelerator, never to intercept input events** (documented in the `menu.ts` header comment).

`buildMenu(servers, activeId, callbacks)` is rebuilt (and re-set via `Menu.setApplicationMenu`) on every server-list change. The bound accelerator set is exhaustive:

| Menu | Bound accelerators |
|------|--------------------|
| App | ⌘Q quit, ⌘H hide, ⌥⌘H hide-others |
| Edit | roles ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A — mandatory: clipboard in web content is dead on macOS without them |
| View | ⌘R reload, ⇧⌘R force-reload, ⌥⌘I devtools, ⌘0/⌘+/⌘− zoom roles, ⌃⌘F fullscreen |
| Servers | radio items on literal `Ctrl+1`…`Ctrl+9` (⌃, deliberately NOT CmdOrCtrl — ⌘1–9 stays free for the page); active server checked |
| Window | ⌘M minimize + zoom via a **custom template**, NOT `role: 'windowMenu'` (that role auto-binds ⌘W) |

**⌘W is unbound by design** — it falls through to the page for future tab-close semantics; mouse users get an accelerator-less "Close Window" item. Guaranteed fall-through set: ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos.

Accepted gap (recorded nice-to-have): switcher radios check by exact `activeId` match, so in the dangling-`activeId` state startup loads the first server (store fallback) while no radio renders checked until the next list mutation rebuilds the menu.

## `window.runkitShell` Bridge (`src/preload.ts` ↔ `app/frontend/src/lib/shell.ts`)

The sandboxed preload exposes exactly one bridge via `contextBridge.exposeInMainWorld`:

- **`version`** — the shell app version, read from the `--runkit-shell-version=` argv entry (passed via `webPreferences.additionalArguments`, since sandboxed preloads read `process.argv` but cannot call `app.getVersion()`).
- **`platform`** — `process.platform`.
- **`__welcome`** — `{ testServer(url), addServer(name, url), cancel() }`, thin `ipcRenderer.invoke` wrappers for the `welcome:*` channels.

`version`/`platform` are readable by **every** page, including pages loaded from registered rk servers — this is the SPA's shell-detection seam. `__welcome` is exposed everywhere but **privileged nowhere except the welcome page**: every `welcome:*` handler in main verifies `event.senderFrame.url` starts with the welcome `file://` URL and answers `{ ok: false, error: "Not allowed" }` otherwise, so a server-loaded page can read shell metadata but never invoke a privileged call. IPC payloads are structurally validated in main (unknown-typed, narrowed) before use.

**SPA side** (`app/frontend/src/lib/shell.ts`, the only SPA file the shell touches): `RunkitShell` interface (`{ version, platform }`), a `declare global` Window typing that types `runkitShell` as `unknown` (the bridge is runtime-injected, so it is validated structurally — type-narrowing guard, no `as` casts), `shellInfo()` returning a plain `{ version, platform }` (never leaking `__welcome`) or `null`, and `isShell()`. Covered by the sibling vitest suite `shell.test.ts` (present / absent / malformed bridge shapes). `isShell()` is consumed nowhere critical yet — actual ⌘-tier SPA keyboard bindings are future work gated on it (see [ui-patterns](/run-kit/ui-patterns.md) § Keyboard Shortcuts). The welcome page's own script narrows the bridge the same structural way (`Reflect.get(window, "runkitShell")`, no global augmentation).

## Security Wiring (`src/main.ts`)

- **Renderer isolation**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload path, `additionalArguments` version pass-through.
- **Window-open**: `setWindowOpenHandler` always denies — a registered-server origin loads in-window (`contents.loadURL`), any other http(s) URL opens via `shell.openExternal`, everything else is dropped.
- **Navigation allowlist**: `will-navigate` and `will-redirect` share one guard allowing only registered server origins (plus the `RK_DESKTOP_URL` origin in dev) and the welcome `file://` URL; blocked http(s) targets are handed to the system browser — a server-issued redirect cannot escape the registered-origin set in-window.
- **Permissions**: `setPermissionRequestHandler` allows exactly `clipboard-read`, `clipboard-sanitized-write`, `notifications`; everything else is denied.
- **TLS fails closed**: no `certificate-error` bypass handler exists.
- **IPC hardening**: sender-frame gating on all `welcome:*` handlers (§ Bridge above).

## Packaging (`electron-builder.yml` + `scripts/build-desktop.sh`)

- `appId: ai.shll.run-kit`, `productName: Run Kit`, mac category `public.app-category.developer-tools`, `directories: { buildResources: build, output: release }`, `npmRebuild: false`, packaged files `dist/**` minus compiled tests.
- **Per-arch DMGs** (arm64 + x64), artifact name `run-kit-desktop-${version}-${arch}.${ext}` — mirrors the `rk-darwin-{arm64,amd64}` artifact convention; a universal binary would be ~2× the size for no benefit.
- **Ad-hoc signing only**: `identity: null` plus the `afterPack: ./after-pack.js` hook — `identity: null` makes electron-builder *skip* signing entirely (it does NOT ad-hoc sign: the Electron prebuilt leaves only a linker signature on the arm64 binary and nothing on x64, proven on the v3.12.2 release run), so the hook runs `codesign --force --deep --sign -` on the packed `.app` before the DMG is built (arm64 macOS refuses to launch fully unsigned binaries). No Developer ID, no notarization. The accepted cost is Gatekeeper friction on first launch ("Open Anyway", or `xattr -dr com.apple.quarantine` on Sequoia's "damaged" variant).
- **Version injection**: `package.json` carries a `0.0.0` placeholder; the real version rides `electron-builder --config.extraMetadata.version=$VERSION` (rewrites the packaged package.json → `app.getVersion()` → `runkitShell.version`). The version source differs per build path: local `scripts/build-desktop.sh` derives `$VERSION` from `git describe --tags --abbrev=0` (leading `v` stripped, fallback `0.0.0-dev`); the CI job takes it from the release job's `version` output (§ Release Packaging). Either way the desktop pipeline reads no VERSION file and is independent of `scripts/build.sh`.
- **Icon**: `app/desktop/build/icon.png` is a **committed** 1024px raster generated by `scripts/generate-icons.sh` (dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask at radius ≈22.37% of size — Apple's app-icon corner ratio — so the flat square sits close to the macOS squircle when electron-builder converts png → icns). Committed so desktop builds need neither sharp nor the frontend package; regenerate via `just icons`.

## Release Packaging (`.github/workflows/release.yml` § `desktop-macos`)

Every tagged release carries `run-kit-desktop-{version}-arm64.dmg` and `run-kit-desktop-{version}-x64.dmg` as GitHub Release assets. The `desktop-macos` job (`needs: release`, `runs-on: macos-latest`) checks out the release tag, installs frozen deps under Node 22 (`engines.node >=22.12.0`; the frontend jobs' Node 20 is insufficient here), compiles, runs `electron-builder --mac --publish never` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and the version from the release job's output, verifies each `.app` with `codesign --verify --deep --strict` (plus `-dv` for display), and attaches the DMGs via `gh release upload … --clobber`. The job runs the packaging steps inline rather than calling `scripts/build-desktop.sh` — see [architecture](/run-kit/architecture.md) § Release Flow & CI/CD for the full step list and the dependency/skip semantics.

`just build-desktop` on a Mac is the local path, used for development builds and for reproducing a packaging failure off the release train.

## Dev & Build Entrypoints

Constitution VIII one-liners in the `justfile`, logic in `scripts/`:

- `just dev-desktop` → `scripts/dev-desktop.sh`: `pnpm install` when `node_modules` is missing, compile, `exec pnpm exec electron .`. `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop` (against a running `just dev`) loads that URL directly without touching `servers.json`.
- `just build-desktop` → `scripts/build-desktop.sh`: Mac-only; verifies `build/icon.png` exists (pointing at `just icons` when missing), `pnpm install --frozen-lockfile`, compile, `electron-builder --mac --publish never` with the extraMetadata version. Output lands in `app/desktop/release/` (gitignored; the repo's bare `dist` gitignore entry already covers compiled TS output).

Verification split: compile, `tsc --noEmit`, node:test (store), and vitest (`shell.test.ts`) all run on Linux; the DMG build, Gatekeeper walkthrough, xterm ⌘C/⌘V interplay, and ⌘-fall-through feel require a Mac.

## Design Decisions

### Viewer shell, not a bundled daemon
**Decision**: The shell loads an existing `rk serve` URL and never spawns or supervises the daemon; Electron (not Tauri) is the shell runtime.
**Why**: Constitution VI keeps the tmux/server layer independent of any supervisor; Electron's Chromium matches what the product is already debugged against (xterm rendering, connection-pool behavior).
**Rejected**: Bundling the daemon inside Electron (violates Constitution VI); Tauri (a second browser engine to debug against for no capability gain here).
*Introduced by*: 260728-04pg-electron-desktop-shell

### ⌘-tier seam is accelerator avoidance, not key interception
**Decision**: Unlock the ⌘ tier by simply not binding accelerators on keys the page should own; no `globalShortcut`, no `before-input-event`.
**Why**: Electron only steals keys via accelerators/globalShortcut/OS — unclaimed keys already reach the page; zero interception code to maintain.
**Rejected**: `before-input-event` routing — a fragile dispatch layer v1 doesn't need; the documented future path for a menu-bound key is un-binding, not intercepting.
*Introduced by*: 260728-04pg-electron-desktop-shell

### Plain servers.json with atomic write, no electron-store
**Decision**: Hand-rolled `<userData>/servers.json` (version 1 schema), tmp-file-then-rename writes, corrupt→empty recovery.
**Why**: The three-dep package stays three deps; the store is ~150 lines and trivially testable when parameterized by directory.
**Rejected**: electron-store — a dependency for a single small file; migration machinery unneeded at v1.
*Introduced by*: 260728-04pg-electron-desktop-shell

### Store module is electron-free; tests run on node:test
**Decision**: `servers.ts` takes the data directory as a parameter (main passes `app.getPath('userData')`); `servers.test.ts` runs via Node's built-in `node --test` over the compiled `dist/`, with compiled tests excluded from packaged `files`.
**Why**: New behavior must ship with tests while keeping the exact three-dep pin — node:test satisfies both.
**Rejected**: Adding vitest/jest to app/desktop (violates the dep pin); leaving the store untested.
*Introduced by*: 260728-04pg-electron-desktop-shell

### `__welcome` exposed on all pages, privileged only via main-side gating
**Decision**: The preload exposes the `__welcome` IPC invokers everywhere; privilege is enforced in the main process by the `senderFrame.url` check on every `welcome:*` handler.
**Why**: One authoritative check at the trust boundary (main) instead of duplicating it in the preload; a renderer-side gate could not be trusted anyway.
**Rejected**: Conditional preload exposure per page — duplicates the same check with more surface and no added security.
*Introduced by*: 260728-04pg-electron-desktop-shell

### Per-arch ad-hoc DMGs with build-time version injection
**Decision**: Two DMGs (arm64, x64) with `identity: null`, versioned via `--config.extraMetadata.version` — from `git describe` locally, from the release job's `version` output in CI.
**Why**: Mirrors the `rk-darwin-{arm64,amd64}` artifact convention; a universal binary doubles size for no benefit; notarization is explicitly not a requirement, and ad-hoc satisfies arm64's signing floor; the tag is the repo's version source, so the packaged version needs no committed file.
**Rejected**: Universal binary (size); Developer ID + notarization (cost/ceremony for a personal-infra tool); a committed VERSION bump per desktop release (drifts from the tag).
*Introduced by*: 260728-04pg-electron-desktop-shell

### CI signature verification is a hard gate on the `.app`, not the DMG
**Decision**: The release job runs `codesign -dv` over `app/desktop/release/mac*/*.app` and fails the workflow if any bundle is unsigned or the glob matches nothing.
**Why**: The ad-hoc signature lives on the app bundle, not the DMG container, and an unsigned arm64 app is killed at launch — a silently unsigned build ships a DMG that cannot open, so the failure must surface in CI rather than at a user's first launch.
**Rejected**: Verifying the DMG (the container carries no app signature); skipping verification and trusting `identity: null` (the electron-builder ad-hoc path has regressed before).
*Introduced by*: 260729-5uae-desktop-shell-release-ci
