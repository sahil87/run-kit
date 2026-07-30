---
description: "The app/desktop Electron viewer shell — a BrowserWindow client of an existing rk serve URL that never spawns or supervises the daemon. Covers the servers.json store (id-keyed, lastPath, rename), the welcome flow, last-path capture/restore, the two-tier CmdOrCtrl menu seam (unshifted page tier inviolable, shifted shell tier, ⇧⌘/⇧Ctrl 1–9 switcher) applied per platform, the runkitShell bridge (sender-gated servers + welcome groups) + isShell(), security wiring, mac/win/linux packaging + the three desktop release jobs, and the quarantine-free `rk desktop install`/`update` path."
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
    ├── main.ts             # lifecycle, BrowserWindow, security wiring, IPC, welcome ↔ server routing, last-path capture
    ├── servers.ts          # servers.json store (electron-free, directory-parameterized)
    ├── servers.test.ts     # node:test suite over the compiled store
    ├── menu.ts             # buildMenu(servers, activeId, callbacks) — the per-platform keyboard-tier seam
    ├── preload.ts          # contextBridge: window.runkitShell
    └── welcome/
        ├── welcome.html    # static first-run / add-server / rename page (CSP: default-src 'none')
        └── welcome.ts      # renderer script — structural bridge narrowing, no imports
```

Package tests run via `node --test "dist/**/*.test.js"` after compile — the store module is electron-free precisely so Node's built-in runner covers it without adding a test dependency. Compiled test files are excluded from packaging (`files: ["dist/**", "!dist/**/*.test.js"]`).

## Server-List Store (`src/servers.ts`)

`<userData>/servers.json`, schema version 1:

```json
{
  "version": 1,
  "activeId": "b3f1…",
  "servers": [
    { "id": "<randomUUID>", "name": "studio-mac", "url": "http://100.101.2.3:3000", "lastPath": "/utils2/rk-dev?x=1" }
  ]
}
```

- **Origin normalization**: `url` is stored as `new URL(input).origin` — only `http:`/`https:` accepted; anything else (ftp:, file:, garbage) is a validation error and is never persisted. Path/query/case in the input are dropped by the origin reduction.
- **`lastPath` is optional and additive**: the SPA-route remainder (`pathname + search`) last seen for that server, at schema **version 1** — the field carries no version bump because absence is a valid state.
- **Atomic write**: tmp-file-then-rename in the same directory (`servers.json.tmp-<pid>` → `servers.json`).
- **Corrupt → empty, with per-field tolerance on the optional field**: a missing, unreadable, corrupt, or wrong-shape file loads as an empty list without throwing — the required shape is structurally validated (`version === 1`, `activeId` string-or-null, `servers` an array, and `id`/`name`/`url` strings on every entry), and any violation there rejects the whole file. The optional `lastPath` is the one tolerant field: absent → the entry loads unchanged, a string → kept, any other type → the field is dropped and the entry (and file) still loads. Startup routes to welcome only on the empty-list outcome.
- **Active resolution**: `resolveActiveServer` returns the `activeId` entry, falls back to the **first** server when `activeId` dangles, `null` when the list is empty. `addServer` sets the new entry active (empty display name defaults to the origin); removing the active server promotes the first remaining entry.
- **Origin ownership**: `findServerByOrigin(list, origin)` answers "which entry owns this displayed origin" — `addServer` never dedupes, so several entries can share one origin; the **active** entry wins among the matches, else the first match, else `null`. This is the pure targeting rule behind last-path capture (§ Last-Path Capture & Restore).
- **Per-server mutators, all `id`-keyed**: `setActiveServer`, `setServerLastPath(dir, id, lastPath)`, and `renameServer(dir, id, name)` share one shape — load → membership guard (unknown `id` is a no-op that writes nothing) → `map` patch → atomic `saveServers`. `renameServer` trims the new name and falls back to the entry's origin when it is blank (mirroring `addServer`), and touches **only** `name`: `id`, `url`, `lastPath`, and the `activeId` linkage survive a rename. Per-server state keys on `id` and never on the name, which is what makes renaming lossless (`addServer` mints a fresh `randomUUID`, so anything id-keyed is scoped to one registration).
- **Electron-free**: the data directory is a parameter (`main.ts` passes `app.getPath('userData')`), keeping the module unit-testable under plain `node --test`.
- **IPC projection**: `serverInfos(list)` is the read-only projection to the `{ id, name, url, active }[]` shape the `servers:list` channel returns (§ Bridge). `active` is derived via `resolveActiveServer`, so a dangling `activeId` flags the **first** server — the same fallback startup would load — and an empty list projects to `[]`.

## Startup Routing & Welcome Flow

On `app.whenReady()`: empty list → `loadFile(welcome.html)`; else `showActive` loads `resolveActiveServer(...).url + (lastPath ?? "")` — cold-start reopens the route the user left, and an entry with no `lastPath` loads the bare origin. The dev override `RK_DESKTOP_URL` (see § Dev & Build Entrypoints) short-circuits routing entirely and is never persisted; its normalized origin also joins the allowed-navigation set. `window-all-closed` quits except on macOS; `activate` reopens the window.

The welcome page (static HTML + compiled script, CSP `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`) implements **validate → test ping → add+switch**:

1. Connect submits the URL to IPC `welcome:test-server`; the **main process** pings `net.fetch(origin + "/api/health", { signal: AbortSignal.timeout(5000) })` — the renderer stays sandboxed and does no cross-origin fetch. Success requires HTTP 200 with body `status === "ok"` (`app/backend/api/health.go`); the returned `hostname` pre-fills the display-name field when it is empty. Failures (timeout, network error, non-200, non-JSON, wrong body) return a structured `{ ok: false, error }` rendered inline; nothing is persisted on failure.
2. `welcome:add-server {name, url}` persists, sets active, rebuilds the menu, and `loadURL`s the new server.
3. `?mode=add` (menu `Servers → Add Server…`) shows a cancel link → `welcome:cancel` returns to the active server.

The page doubles as the **rename affordance** under `?mode=rename&id=<id>&name=<current>&url=<origin>` — Electron has no native text-input dialog, so the rename form reuses this card rather than adding a dialog window. Main supplies the prefill context on the `loadFile` query string (store-derived, `URLSearchParams`-encoded; both page sinks are `textContent`/`input.value`), so no read IPC exists. In rename mode the page hides the Server URL label + input, shows the origin in the tagline, pre-fills and focuses the name input, labels the submit button `Rename`, and shows the same cancel link as `?mode=add`. Submit invokes `welcome:rename-server {id, name}` with **no health ping** (the origin is unchanged); on success main persists via `renameServer`, rebuilds the menu, and returns the window to the active server through `showActive` (restoring its `lastPath`).

Post-first-run management lives in the menu: `Servers → Add Server…` reloads welcome with `?mode=add`; `Servers → Rename "<name>"…` (one accelerator-less item per server, between Add and the Remove items) reloads welcome with `?mode=rename`; `Servers → Remove "<name>"…` opens a native confirm dialog (Cancel is the default), and removing the active server switches to the first remaining server or welcome. Opened outside the shell, the welcome page degrades to an inline "bridge unavailable" error with the Connect button disabled.

**The `hidden` attribute is authoritative on this page**: the style block carries `[hidden] { display: none !important; }`, because the author rules `label { display: block }` and `a#cancel { display: block }` are more specific than the UA sheet's `[hidden] { display: none }` and would otherwise keep a `hidden` element painted. JS-driven visibility is unaffected — clearing `hidden` removes the attribute, so the author `display` re-applies.

## Last-Path Capture & Restore (`src/main.ts`)

The shell remembers where each server was left, so ⌃1–⌃9 switching and cold start land on the route the user was working in rather than the SPA root.

**Capture** is one helper, `captureLastPath()`: read `mainWindow.webContents.getURL()`, then persist `pathname + search` via `setServerLastPath` for the entry `findServerByOrigin` resolves from the URL's origin. Two guards make it safe:

- **Welcome guard** — a URL starting with the welcome `file://` URL is never captured (the welcome page is not a server route).
- **Origin-match guard** — an unparseable URL, or one whose origin matches no registered server (mid-navigation, a foreign origin), persists nothing. One server's route therefore cannot pollinate another server's entry.

Call sites are every shell-initiated navigation away from a server page plus window teardown: `onSwitchServer` (before loading the incoming server), `onAddServer` and `onRenameServer` (before navigating to welcome), and the main window's `close` event — capture-on-quit, so cold-start restore reflects the route at quit rather than only the last switch-away (`webContents` is still readable during `close`). No navigation-event tracking (`did-navigate-in-page` and friends) exists: the SPA is a history-API router, so `getURL()` is already current at capture time.

**Restore** is the mirror: `onSwitchServer` loads `entry.url + (entry.lastPath ?? "")` and `showActive` loads `active.url + (active.lastPath ?? "")`. A restored deep route needs no security change — `isAllowedNavigation` is origin-membership only and already permits any path on a registered origin.

**Staleness is the SPA's problem.** A remembered route pointing at a since-removed window or board, or at a dead server, is loaded as-is; the SPA's Not Found fallback and dead-server handling are the failure mode. The shell performs no validation, no health ping of the path, and no fallback-to-origin.

## Keyboard-Tier Menu Seam (`src/menu.ts`)

The point of the shell. Electron steals a key from the page only via menu accelerators, `globalShortcut` (none registered), or the OS — so the seam is: **do not bind accelerators on keys the page should own**. Unclaimed keys already reach the loaded SPA; there is no `before-input-event` interception, and none should be added — if the SPA later needs page-first handling of a key that IS menu-bound, the fix is to **remove that menu item's accelerator, never to intercept input events** (documented in the `menu.ts` header comment).

The contract is a platform-neutral **two-tier rule**:

- **Page tier — unshifted `CmdOrCtrl+<any>`**: the shell NEVER binds it, on any platform. This is the shell's premise — the tier a browser reserves (macOS ⌘, Windows/Linux Ctrl) belongs to the SPA.
- **Shell tier — `Shift+CmdOrCtrl+<any>`**: shell chrome MAY claim keys here, sparingly. Today's only claim is the Servers switcher (1–9).

Guaranteed fall-through therefore reads: **the unshifted Cmd/Ctrl tier is inviolable** (⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] …); the shifted tier is shell-claimable.

The menu is applied **per platform** — symmetry of *rule*, not symmetry of accelerator table: `buildMenu` composes its template from per-menu builders (`macAppMenu` / `fileMenu`, `macEditMenu`, `viewMenu`, `serversMenu`, `macWindowMenu`) that branch on a module-level `isMac = process.platform === "darwin"`, because Chromium's native handling and role defaults differ per platform (the carve-outs below). The switcher accelerator itself is one `CmdOrCtrl` expression, identical everywhere. The exported `buildMenu(servers, activeId, callbacks)` signature is unchanged and is still rebuilt (and re-set via `Menu.setApplicationMenu`) on every server-list change.

### macOS

| Menu | Bound accelerators |
|------|--------------------|
| App | ⌘Q quit, ⌘H hide, ⌥⌘H hide-others |
| Edit | roles ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A — a **macOS carve-out**, outside the cross-platform rule: clipboard in web content is dead on macOS without them, while Windows/Linux Chromium handles it natively (so the equivalents are not to be bound there) |
| View | ⌘R reload, ⇧⌘R force-reload, ⌥⌘I devtools, ⌘0/⌘+/⌘− zoom roles, ⌃⌘F fullscreen — conventional shell chrome via role defaults, a carve-out that predates the rule |
| Servers | radio items on `Shift+CmdOrCtrl+1`…`Shift+CmdOrCtrl+9` (⇧⌘1–9 on macOS) — the shell tier, capped at 9 by `MAX_SWITCHER_ACCELERATORS`; active server checked. The management items below them — `Add Server…`, per-server `Rename "<name>"…`, per-server `Remove "<name>"…` — are accelerator-less by design, so adding them never narrows the fall-through set |
| Window | ⌘M minimize + zoom via a **custom template**, NOT `role: 'windowMenu'` (that role auto-binds ⌘W) |

**⌘W is unbound by design** — it falls through to the page for future tab-close semantics; mouse users get an accelerator-less "Close Window" item.

Menu radios are the mouse path for the same items the accelerators reach, not alternatives to them; the radio `click` bodies route through the one shared switch seam (§ Security Wiring → `switchToServer`).

### Windows / Linux

The unshifted Ctrl tier is **entirely unbound** — the page tier there is completely clean. Top menus are `File | View | Servers`, and the exhaustive bound set is **⇧Ctrl+1–9 Servers switcher, ⇧Ctrl+R force-reload, ⇧Ctrl+I devtools, F11 fullscreen** (shifted-tier and function-key defaults, which the shell may claim).

| Divergence from mac | Why |
|---------------------|-----|
| **No Edit menu** | Chromium handles Ctrl+C/V/X/A/Z natively on win/linux; the mac Edit roles exist only for the macOS clipboard quirk |
| **File → Quit** (labelled "Exit" on `win32`) as a plain `click: () => app.quit()` item, replacing the mac App menu | `role: 'quit'` default-binds Ctrl+Q on Linux — page tier. `window-all-closed` already quits on non-mac |
| **No Window menu** | Native window chrome covers minimize/close, and `role: 'minimize'` default-binds Ctrl+M |
| **View keeps item parity** but `reload` / `resetZoom` / `zoomIn` / `zoomOut` are rebuilt as plain accelerator-less items over a shared `focusedWebContents()` helper (`zoomBy(±0.5)`, `setZoomLevel(0)` — replicating the Electron role bodies exactly); `forceReload`, `toggleDevTools`, `togglefullscreen` stay roles | A role's default accelerator can be overridden but not removed, and `registerAccelerator: false` still *displays* the dead accelerator |

The Servers switcher does **not** diverge: the radios bind `Shift+CmdOrCtrl+1–9` on every platform (⇧Ctrl+1–9 here) — the shell tier, one un-gated `CmdOrCtrl` expression capped by `MAX_SWITCHER_ACCELERATORS`.

Accepted gap (recorded nice-to-have): switcher radios check by exact `activeId` match, so in the dangling-`activeId` state startup loads the first server (store fallback) while no radio renders checked until the next list mutation rebuilds the menu.

## `window.runkitShell` Bridge (`src/preload.ts` ↔ `app/frontend/src/lib/shell.ts`)

The sandboxed preload exposes exactly one bridge via `contextBridge.exposeInMainWorld`:

- **`version`** — the shell app version, read from the `--runkit-shell-version=` argv entry (passed via `webPreferences.additionalArguments`, since sandboxed preloads read `process.argv` but cannot call `app.getVersion()`).
- **`platform`** — `process.platform`.
- **`servers`** — `{ list(), switch(id) }`, thin invokers for the `servers:list` / `servers:switch` channels; the SPA command palette's server-switch path.
- **`__welcome`** — `{ testServer(url), addServer(name, url), renameServer(id, name), cancel() }`, thin `ipcRenderer.invoke` wrappers for the `welcome:*` channels.

`version`/`platform` are readable by **every** page, including pages loaded from registered rk servers — this is the SPA's shell-detection seam. The two invoker groups are likewise exposed everywhere but privileged by **main-side sender-frame gating**, each against a different allowlist (IPC payloads are structurally validated in main — unknown-typed, narrowed — before use):

| Channels | Privileged senders | Gate |
|----------|--------------------|------|
| `welcome:*` | the welcome page only | `isWelcomeSender` — `event.senderFrame.url` starts with the welcome `file://` URL |
| `servers:*` | registered server origins (the pages that host the SPA palette) **plus** the welcome page | `isServersSender` — delegates to `isAllowedNavigation`, the same set the navigation guard computes (so it also covers the `RK_DESKTOP_URL` dev origin) |

Any sender outside a channel's allowlist gets `{ ok: false, error: "Not allowed" }` and no state change — so a server-loaded page can read shell metadata and switch servers, but never invoke a `welcome:*` call. `servers:list` answers the discriminated `{ ok: true, servers: ServerInfo[] } | { ok: false, error }` envelope; `servers:switch` rejects a non-string payload as `"Invalid request"` and an unregistered id as `"Unknown server"` without navigating.

**SPA side** (`app/frontend/src/lib/shell.ts`, the only SPA file the shell touches): `RunkitShell` interface (`{ version, platform }`), a `declare global` Window typing that types `runkitShell` as `unknown` (the bridge is runtime-injected, so it is validated structurally — type-narrowing guards, no `as` casts), `shellInfo()` returning a plain `{ version, platform }` (never leaking `__welcome`) or `null`, `isShell()`, and the `servers`-group wrappers `listShellServers(): Promise<ShellServer[] | null>` / `switchShellServer(id): Promise<boolean>`. Both wrappers **never throw**: a plain browser, an older shell lacking the `servers` group, a malformed entry, an `{ ok: false }` denial, and a rejected invoke all resolve `null`/`false`. Covered by the sibling vitest suite `shell.test.ts` (present / absent / malformed shapes of both surfaces).

The first real SPA consumer of this seam is the palette's shell-gated `Server: Switch to "<name>"` block — which gates on the `servers` group's own emptiness (`listShellServers()` resolving `null`/`[]` outside the shell) rather than calling `isShell()`, since an older shell exposes `version`/`platform` without the group (see [ui-patterns](/run-kit/ui-patterns.md) § Keyboard Shortcuts). `isShell()` itself remains the seam for future page-tier SPA keyboard bindings. The welcome page's own script narrows the bridge the same structural way (`Reflect.get(window, "runkitShell")`, no global augmentation).

## Security Wiring (`src/main.ts`)

- **Renderer isolation**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload path, `additionalArguments` version pass-through.
- **Window-open**: `setWindowOpenHandler` always denies — a registered-server origin loads in-window (`contents.loadURL`), any other http(s) URL opens via `shell.openExternal`, everything else is dropped.
- **Navigation allowlist**: `will-navigate` and `will-redirect` share one guard allowing only registered server origins (plus the `RK_DESKTOP_URL` origin in dev) and the welcome `file://` URL; blocked http(s) targets are handed to the system browser — a server-issued redirect cannot escape the registered-origin set in-window.
- **Permissions**: `setPermissionRequestHandler` allows exactly `clipboard-read`, `clipboard-sanitized-write`, `notifications`; everything else is denied.
- **TLS fails closed**: no `certificate-error` bypass handler exists.
- **IPC hardening**: sender-frame gating on every `welcome:*` and `servers:*` handler, each against its own allowlist (§ Bridge above) — always in main, never in the preload.
- **One switch path**: `switchToServer(id)` (set active via the store → `loadURL` → rebuild menu) is the single seam shared by the Servers menu radio callback and the `servers:switch` handler, so the IPC and mouse paths cannot diverge.

## Packaging (`electron-builder.yml` + `scripts/build-desktop.sh`)

- `appId: ai.shll.run-kit`, `productName: Run Kit`, mac category `public.app-category.developer-tools`, `directories: { buildResources: build, output: release }`, `npmRebuild: false`, packaged files `dist/**` minus compiled tests.
- **Three platforms, one global artifact name** `run-kit-desktop-${version}-${arch}.${ext}`:

  | Platform | Targets | Arches |
  |----------|---------|--------|
  | mac | dmg | arm64, x64 |
  | win | nsis | x64 |
  | linux | AppImage, deb | x64, arm64 |

  Per-arch (not universal) mirrors the `rk-darwin-{arm64,amd64}` artifact convention; a universal mac binary would be ~2× the size for no benefit. Because the global `artifactName` is user-forced, `${arch}` always expands through electron-builder's per-target arch naming, so real Linux filenames are `-x86_64.AppImage` and `-amd64.deb` (not the literal `-x64`); upload globs are extension-based, so this is naming-only. AppImage is the zero-install default and deb covers the Debian/Ubuntu majority; win-arm64 and snap/rpm/flatpak are deferred until demand.
- **Signing: mac ad-hoc, Windows unsigned, Linux none.** On mac, `identity: null` plus the `afterPack: ./after-pack.js` hook — `identity: null` makes electron-builder *skip* signing entirely (it does NOT ad-hoc sign: the Electron prebuilt leaves only a linker signature on the arm64 binary and nothing on x64, proven on the v3.12.2 release run), so the hook runs `codesign --force --deep --sign -` on the packed `.app` before the DMG is built (arm64 macOS refuses to launch fully unsigned binaries). No Developer ID, no notarization. The residual cost lands only on **manually downloaded** DMGs — a browser stamps `com.apple.quarantine`, so Gatekeeper demands "Open Anyway" (or `xattr -dr com.apple.quarantine` on Sequoia's "damaged" variant) on every download. `rk desktop install` avoids it entirely (§ Installation & Updates) and is **macOS-only** — win/linux users install from the release assets directly. Windows carries no Authenticode config: the accepted cost is SmartScreen's "unrecognized app" first-launch dialog, the same personal-infra posture as the mac decision. Linux requires no signing.
- **`after-pack.js` is mac-only by guard**: the hook returns immediately when `context.electronPlatformName !== "darwin"`, so win/linux packs never reach `codesign` (which does not exist on those builders). The hook stays registered globally in `electron-builder.yml` — the guard, not the config, is what scopes it.
- **deb maintainer** comes from `linux.maintainer` (`sahil87 <sahil87@users.noreply.github.com>`) with `linux.category: Development`. deb hard-requires a maintainer and `package.json` deliberately carries no `author` field, so the GitHub noreply address stands in rather than committing a personal email.
- **Icons across platforms**: the single committed `build/icon.png` is sufficient source material — electron-builder derives the Windows `.ico` from it and Linux uses the png directly. No per-platform assets are committed.
- **Version injection**: `package.json` carries a `0.0.0` placeholder; the real version rides `electron-builder --config.extraMetadata.version=$VERSION` (rewrites the packaged package.json → `app.getVersion()` → `runkitShell.version`). The version source differs per build path: local `scripts/build-desktop.sh` derives `$VERSION` from `git describe --tags --abbrev=0` (leading `v` stripped, fallback `0.0.0-dev`); the CI job takes it from the release job's `version` output (§ Release Packaging). Either way the desktop pipeline reads no VERSION file and is independent of `scripts/build.sh`.
- **Icon**: `app/desktop/build/icon.png` is a **committed** 1024px raster generated by `scripts/generate-icons.sh` (dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask at radius ≈22.37% of size — Apple's app-icon corner ratio — so the flat square sits close to the macOS squircle when electron-builder converts png → icns). Committed so desktop builds need neither sharp nor the frontend package; regenerate via `just icons`.

## Release Packaging (`.github/workflows/release.yml`)

Every tagged release carries the full desktop set as GitHub Release assets — ~6 files: 2 mac DMGs (arm64, x64), 2 AppImages, 2 debs, and 1 Windows NSIS `.exe`. Three sibling jobs produce them, each `needs: release` on a native runner:

| Job | Runner | Build | Upload glob |
|-----|--------|-------|-------------|
| `desktop-macos` | macos-latest | `electron-builder --mac`, `CSC_IDENTITY_AUTO_DISCOVERY: "false"` | `release/*.dmg` |
| `desktop-linux` | ubuntu-latest | `electron-builder --linux` | `release/*.AppImage` + `release/*.deb` |
| `desktop-windows` | windows-latest | `electron-builder --win` | `release/*.exe` |

All three share one step shape: checkout at `ref: needs.release.outputs.tag`, setup-node 22 + pnpm 9 on the same pinned action SHAs (`engines.node >=22.12.0`; the frontend jobs' Node 20 is insufficient here), `pnpm install --frozen-lockfile` → `pnpm run compile` in `app/desktop`, `--publish never` with the version from the release job's output, then `gh release upload … --clobber`. `desktop-windows` sets `defaults.run.shell: bash` so the shared `cd app/desktop && …` step bodies work unmodified on a Windows runner. Native runners rather than wine cross-compilation — runner minutes are not a constraint here.

**The codesign verification hard-gate is mac-only.** Only `desktop-macos` runs `codesign --verify --deep --strict` (plus `-dv` for display) over the packed `.app`; the ad-hoc signature is a macOS *launch* requirement, and there is no equivalent invariant to assert on Windows (unsigned by design) or Linux (no signing at all). The win/linux jobs each carry an inline comment stating that.

All three run the packaging steps inline rather than calling `scripts/build-desktop.sh` — see [architecture](/run-kit/architecture.md) § Release Flow & CI/CD for the full step list and the dependency/skip semantics.

`just build-desktop` is the local path, used for development builds and for reproducing a packaging failure off the release train; each platform's package can only be built on that platform's host.

## Installation & Updates — `rk desktop`

The **primary** install and update path is the CLI: `rk desktop install` / `rk desktop update` (with `rk desktop status` as the read-only version report). The command group lives in `cmd/rk/desktop.go` over the `internal/desktop` installer library — see [architecture](/run-kit/architecture.md) § CLI Subcommands (`desktop` row) for the flags, output routing, and seam wiring. Manual DMG download from GitHub Releases plus a quarantine-clearing step is retained in `README.md` / `docs/site/install.md` as the **fallback** for a machine without the `rk` CLI.

**Why the CLI path is quarantine-free.** `com.apple.quarantine` is stamped by the **downloading application**, not by macOS unconditionally: apps that declare `LSFileQuarantineEnabled` (every browser) attach it, plain command-line tools do not. A Go program fetching the DMG over HTTPS therefore leaves no quarantine attribute, and the installed app launches cleanly — on first install and on every update. The ad-hoc signature (§ Packaging) satisfies arm64's signing floor, and with no quarantine flag Gatekeeper never runs its verification dialog. This is not a Gatekeeper bypass in intent: the user is explicitly invoking an already-trusted toolkit binary to fetch a release from a known repository — the `brew install` trust model.

**Why the installer self-verifies.** Because this code path deliberately skips the check Gatekeeper would have performed, it performs its own — two hard gates that no flag can skip: (a) SHA256 of the downloaded bytes against the release asset's `digest` when the GitHub API supplies one, and (b) `codesign --verify --deep --strict` on the `.app` inside the mounted image, before anything is copied. A DMG failing either gate is discarded non-zero with the install target untouched. When the API supplies no digest the checksum step is skipped with a note on the chatter channel and codesign remains the hard gate.

**Why Homebrew Cask does not solve this.** The belief that casks are quarantine-free (because brew downloads via `curl`) is outdated and load-bearing enough to record: modern Homebrew **deliberately applies** `com.apple.quarantine` itself — verified in `Library/Homebrew/cask/quarantine.rb` on Homebrew 6.0.13. A cask install would reproduce the identical Gatekeeper dialog. The `--no-quarantine` escape hatch is user-side only; a formula cannot opt its own users out. A cask remains a reasonable future distribution *convenience*, but it is not a fix for this problem.

**Notarization is deferred, not rejected.** A $99/year Developer ID plus notarization is the only fix covering every channel (browser downloads, casks, AirDrop) and would remove the need for the CLI's self-verification framing entirely. It is an explicit later-not-now decision.

**Version derivation.** The installed version is read from `<InstallDir>/Run Kit.app/Contents/Info.plist` (`CFBundleShortVersionString`, via `plutil -extract … raw`) at check time — never assumed equal to the `rk` CLI version, since a CLI upgrade does not move the app (Constitution II — derive, no state file). Comparison against the latest release reuses `internal/updatecheck.AnyIncrease`.

**Update path**: `rk desktop update` is the shell's only automated update mechanism — the app itself carries no auto-updater (electron-updater is a deliberate non-goal), so `update`/`status` are what a user runs to reach a new release.

## Dev & Build Entrypoints

Constitution VIII one-liners in the `justfile`, logic in `scripts/`:

- `just dev-desktop` → `scripts/dev-desktop.sh`: `pnpm install` when `node_modules` is missing, compile, `exec pnpm exec electron .`. `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop` (against a running `just dev`) loads that URL directly without touching `servers.json`.
- `just build-desktop [mac|win|linux]` → `scripts/build-desktop.sh`: takes an **optional explicit target** and otherwise derives it from the host via `uname -s` (`Darwin`→mac, `Linux`→linux, `MINGW*`/`MSYS*`/`CYGWIN*`→win; anything else errors telling the caller to pass a target). The target maps to `--mac`/`--win`/`--linux`; an unknown argument exits non-zero with `usage: build-desktop.sh [mac|win|linux]  (default: host platform)`. The rest is platform-neutral and unchanged: verify `build/icon.png` exists (pointing at `just icons` when missing), `pnpm install --frozen-lockfile`, compile, `electron-builder <flag> --publish never` with the extraMetadata version. Output lands in `app/desktop/release/` (gitignored; the repo's bare `dist` gitignore entry already covers compiled TS output). The justfile recipe stays a one-liner passing args through (`build-desktop *args:`, Constitution VIII).

Verification split: compile, `tsc --noEmit`, node:test (store), and vitest (`shell.test.ts`) all run on Linux. Hardware-only items, per platform:

- **mac** — the DMG build, Gatekeeper "Open Anyway" walkthrough, xterm ⌘C/⌘V interplay, ⌘-fall-through feel, and **⇧⌘1–9 server switching on a non-US layout** — shifted-digit accelerators are the flakiest class (Electron resolves accelerators by character, not scancode, and AZERTY digits already require Shift); no scancode workaround in v1.
- **Windows** — the SmartScreen "unrecognized app" first-launch walkthrough of the unsigned NSIS installer, and Ctrl+C/Ctrl+V ↔ xterm.js interplay (load-bearing in a terminal product); the shifted-digit layout caveat applies to ⇧Ctrl+1–9 here too.
- **Linux** — AppImage and deb launch on a real distro with a desktop session, plus the same Ctrl+C/Ctrl+V ↔ xterm.js interplay and the ⇧Ctrl+1–9 layout caveat.

The win/linux *menu* contract is nonetheless CI-provable without hardware: the compiled `dist/menu.js` can be loaded under a mocked `electron` module with `process.platform` forced, and the built template's accelerators asserted — that is how the "nothing in the unshifted Ctrl tier" invariant was verified.

(The vitest column of the split now also covers `palette-shell.test.ts`, the palette-side suite of the `servers` bridge group.)

## Design Decisions

### Viewer shell, not a bundled daemon
**Decision**: The shell loads an existing `rk serve` URL and never spawns or supervises the daemon; Electron (not Tauri) is the shell runtime.
**Why**: Constitution VI keeps the tmux/server layer independent of any supervisor; Electron's Chromium matches what the product is already debugged against (xterm rendering, connection-pool behavior).
**Rejected**: Bundling the daemon inside Electron (violates Constitution VI); Tauri (a second browser engine to debug against for no capability gain here).
*Introduced by*: 260728-04pg-electron-desktop-shell

### The tier seam is accelerator avoidance, not key interception
**Decision**: Unlock the browser-reserved tier by simply not binding accelerators on keys the page should own; no `globalShortcut`, no `before-input-event`.
**Why**: Electron only steals keys via accelerators/globalShortcut/OS — unclaimed keys already reach the page; zero interception code to maintain.
**Rejected**: `before-input-event` routing — a fragile dispatch layer v1 doesn't need; the documented future path for a menu-bound key is un-binding, not intercepting.
*Introduced by*: 260728-04pg-electron-desktop-shell

### Two accelerator tiers expressed with `CmdOrCtrl`; portable chords are one expression on every platform
**Decision**: State the contract as page tier (unshifted `CmdOrCtrl+<any>`, never bound) vs. shell tier (`Shift+CmdOrCtrl+<any>`, sparingly claimable), and express every portable accelerator with `CmdOrCtrl` — the Servers switcher on `Shift+CmdOrCtrl+1–9`, with the literal `Ctrl+1–9` bindings dropped outright rather than kept as an alias.
**Why**: Symmetry is the governing principle — whatever is Cmd+X on macOS is Ctrl+X elsewhere — so the tier a browser reserves is the tier the shell must leave alone on *every* platform. Literal `Ctrl+1–9` was safe only on macOS; on Windows/Linux it would steal exactly the keys the shell exists to hand the SPA. macOS behavior is unchanged by the re-expression alone.
**Rejected**: Per-platform *switcher* chords (two bindings to keep in sync, and the documented fall-through promise stops being one promise) — distinct from the per-platform carve-out builders the menu legitimately has (see "The menu is symmetric in rule, not in accelerator table" below); keeping `Ctrl+1–9` as a macOS legacy alias (two bindings for one item days after the feature shipped, for no muscle-memory install base); menu-only switching with no chord (fails Constitution V).
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

### `servers:*` privilege gate reuses the navigation allowlist
**Decision**: `isServersSender` delegates to the existing `isAllowedNavigation` (welcome `file://` URL + registered server origins + dev-override origin) rather than computing its own set.
**Why**: The intended allowlist — registered server origins plus the welcome page — is exactly the set the navigation guard already computes; one authoritative set cannot drift from itself.
**Rejected**: A second hand-rolled origin set — duplicates the `registeredOrigins()` composition and would diverge on the dev-override case.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

### One discriminated envelope for `servers:list`
**Decision**: `servers:list` returns `{ ok: true, servers: [...] } | { ok: false, error }`; the SPA lib unwraps it to a plain `ShellServer[]` (or `null`).
**Why**: The gating contract needs an `{ ok: false }` error shape anyway, and a single discriminated union matches the handlers' existing `PingResult`/`IpcResult` pattern while the SPA-facing API still hands callers a plain array.
**Rejected**: Bare-array success plus an object failure — two unrelated top-level shapes for one channel to narrow.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

### Shared `switchToServer` seam in main
**Decision**: The menu radio callback's body (set active → `loadURL` → rebuild menu) is extracted into one function called by both the radio callback and the `servers:switch` handler.
**Why**: The IPC switch must behave identically to clicking the radio; a shared function makes divergence structurally impossible instead of merely intended.
**Rejected**: Duplicating the three calls inside the handler — invites drift the moment the switch path grows a step.
*Introduced by*: 260730-9lez-shell-keyboard-tier-symmetry

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

### Last path persisted per server, not a live view per server
**Decision**: Per-server route memory is a single optional `lastPath` string in `servers.json`, captured at navigation-away/close and replayed on switch-in and startup; one BrowserWindow still shows one server at a time.
**Why**: Cheap "reopen where I was" — the store already exists with atomic-write plumbing, and persisting (rather than holding routes in memory) is what makes cold start work at all.
**Rejected**: A live `WebContentsView` per server (Slack-style workspaces — keeps scroll position, terminal state, and SSE connections alive): memory cost, N live connection sets per server (SSE plus per-pane relay WebSockets), and lifecycle complexity, all out of scope for a *viewer* shell. An in-memory-only `Map<id, path>`: fixes switching but not cold start, which is the stated point.
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

### Capture target resolved by origin lookup, not by activeId
**Decision**: `captureLastPath()` resolves which entry to write to via `findServerByOrigin` — matching the displayed URL's origin against the registered list (active entry wins among same-origin duplicates) — rather than trusting the store's `activeId` as "the outgoing server".
**Why**: `setWindowOpenHandler` can load a registered origin in-window without updating `activeId`, so the displayed origin can differ from the active entry. Origin lookup writes the path to the server that actually owns it, subsuming the outgoing-origin match and making cross-pollination structurally impossible; keeping the rule as a pure function in `servers.ts` also puts the same-origin-duplicate tie-break under `node --test`.
**Rejected**: Matching against `resolveActiveServer(...)` only — saves nothing, or the wrong thing, when the displayed page belongs to a non-active registered origin. A bare `.find()` on origin — targets the first same-origin entry rather than the one in view.
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

### Per-server state keys on `id`; rename is a first-class store mutator
**Decision**: Everything stored per server (`lastPath`, the `activeId` linkage) keys on the immutable `id`, and renaming goes through `renameServer`, which touches only `name`.
**Why**: The pre-rename workaround for changing a display name was remove-and-re-add, and `addServer` mints a fresh `randomUUID` — so every id-keyed fact silently vanished. A dedicated rename makes the operation lossless by construction, and keying on `id` rather than the name is what lets it be.
**Rejected**: Keying per-server state on the display name (renaming would orphan it, and names are not unique); leaving rename to remove-and-re-add (silent state loss on a routine operation).
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

### Wrong-typed optional field drops the field, never the file
**Decision**: On load, a non-string `lastPath` drops just that field; the entry and the rest of the file still load. Wrong types in the required fields (`id`/`name`/`url`/`version`/`activeId`/`servers`) still reject the whole file to the empty list.
**Why**: Corrupt→empty is the right default for a shape the shell cannot interpret, but it wipes the user's server list — far too destructive a response to a junk value in a field that is allowed to be absent. Absence is already a valid state, so dropping is the least destructive reading that keeps a pre-existing valid file loading.
**Rejected**: Treating a wrong-typed `lastPath` as whole-file corruption (loses every registered server over a cosmetic field); rejecting just the offending entry (still loses a server the user registered).
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

### Rename UI reuses the welcome page, prefilled via the query string
**Decision**: `?mode=rename&id=…&name=…&url=…` turns the welcome card into the rename form; main supplies the prefill context as `loadFile` query params, and the page reads them from `URLSearchParams`. No read IPC.
**Why**: Electron has no native text-input dialog, and the welcome page already carries the name input, the cancel link, and the gated-IPC plumbing — plus the `?mode=add` precedent for query-driven variants. The prefill values originate in main (trusted, store-derived), and the page already parses `location.search`, so a `welcome:get-server` handler would add privileged surface for identical data.
**Rejected**: A custom dialog window (new window, new lifecycle, new security wiring for one text field); a new gated read IPC (more privileged surface, same data).
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

### `[hidden]` wins over author `display` rules on the welcome page
**Decision**: The welcome page's style block declares `[hidden] { display: none !important; }`.
**Why**: The page toggles visibility through the `hidden` attribute, but its author rules `label { display: block }` and `a#cancel { display: block }` outrank the UA sheet's `[hidden] { display: none }` — so a `hidden` element stayed painted. Making the attribute authoritative page-wide fixes every current and future toggle at once, and leaves JS-driven show paths intact (clearing `hidden` removes the attribute, restoring the author `display`).
**Rejected**: Per-element `display: none` overrides or swapping to a class-based toggle — both leave the next `hidden` element on the page silently broken.
*Introduced by*: 260730-n2y9-desktop-last-path-restore-rename

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

### Quarantine-free install via a CLI fetch, not a cask and not notarization
**Decision**: Distribute and update the app through `rk desktop install`/`update` — a Go program fetching the release DMG over HTTPS — with the manual DMG download plus a quarantine-clearing step kept only as a CLI-less fallback.
**Why**: Quarantine is applied by the *downloading application* honoring `LSFileQuarantineEnabled` — browsers do, command-line tools do not — so a CLI fetch is genuinely quarantine-free on first install *and* every update, which is the actual friction (the flag is re-stamped per download). The trust model matches `brew install`: an already-trusted toolkit binary fetching from a known repository.
**Rejected**: Homebrew Cask — modern Homebrew deliberately applies `com.apple.quarantine` itself (verified in `cask/quarantine.rb` on Homebrew 6.0.13), so a cask reproduces the identical dialog and `--no-quarantine` is user-side only. Notarization ($99/yr Developer ID) — the correct channel-agnostic fix, deferred not rejected. `curl … | sh` — the trust problem of piping a remote script to a shell, and it forgoes reuse of the existing release-resolution/`selfpath` patterns and Go unit-testability. electron-updater in-app auto-update — fixes subsequent updates but not the first install, and is a larger change inside the Electron app.
*Introduced by*: 260730-pl4v-rk-desktop-install

### The installer verifies what Gatekeeper no longer will
**Decision**: `Install` hard-gates on SHA256-vs-release-digest (when the API supplies one) and `codesign --verify --deep --strict` on the mounted `.app`, before touching the install target; no flag (`--force`, `--quiet`, `--path`) reaches or skips either gate.
**Why**: This code path deliberately produces a quarantine-free install, which is precisely the check Gatekeeper would otherwise have run — without self-verification the convenience becomes a malware vector.
**Rejected**: Trusting HTTPS + the known repo alone (an unverified binary install is the whole risk); failing hard when the API supplies no digest (digest presence varies by upload path, so that would break installs of otherwise-valid releases — the note-and-degrade-to-codesign posture is the compromise).
*Introduced by*: 260730-pl4v-rk-desktop-install

### Stage-then-atomic-replace, and a running app is never overwritten
**Decision**: `ditto` copies the new bundle to a deterministic dot-prefixed staging name **inside** `InstallDir`, then the old bundle is removed and the staged copy renamed into place; `AppRunning` (a `pgrep -f` probe against the bundle's `Contents/MacOS`) refuses install/update both before the download and again immediately before the replace, and `--force` does **not** override that refusal.
**Why**: The long copy must complete before the existing install is touched, so a mid-copy failure never destroys a working install; staging in `InstallDir` keeps the final rename same-volume (atomic), and the deterministic name self-heals a leftover from a crashed prior run. The second `AppRunning` check closes the multi-minute download/codesign TOCTOU window. `--force` is scoped to *version state* — overwriting a live bundle corrupts the running process, a distinct concern the user cannot usefully override.
**Rejected**: `RemoveAll(dest)` before the copy (the original shape — a `ditto` failure left no app at all); a hand-rolled Go tree copy instead of `ditto` (`ditto` is the macOS-correct tool for preserving bundle metadata and signatures — Constitution III); deriving the destination from the mounted DMG's bundle basename (it could diverge from the `AppBundleName` the version/running probes key on, so the mounted name is *validated* against that constant instead).
*Introduced by*: 260730-pl4v-rk-desktop-install

### The menu is symmetric in rule, not in accelerator table
**Decision**: `buildMenu` composes per-menu builders branching on `isMac`, and the two platforms bind deliberately different sets: mac keeps the Edit roles, App menu, and Window menu; win/linux drop all three and bind nothing in the unshifted Ctrl tier.
**Why**: The invariant worth preserving is "the page tier is never bound", and the page tier is ⌘ on mac but Ctrl on win/linux. Chromium already handles Ctrl+C/V/X/A/Z natively on win/linux, so the mac Edit roles (which exist purely for the macOS clipboard quirk) would spend page-tier keys for nothing there; the App and Window menus are mac shapes whose roles (`quit`, `minimize`) default-bind Ctrl+Q/Ctrl+M.
**Rejected**: A single accelerator table re-expressed with `CmdOrCtrl` (mechanically symmetric, but it would bind Ctrl+Z/X/C/V/A/R/0/± on win/linux — the exact tier the shell exists to free); per-platform menu *files* (duplicates the shared View/Servers structure and drifts).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging

### Page-tier View items are plain accelerator-less items, not suppressed roles
**Decision**: On win/linux, `reload`/`resetZoom`/`zoomIn`/`zoomOut` are rebuilt as plain items with click handlers and no accelerator (replicating the Electron role bodies exactly — `zoomLevel ± 0.5`, `zoomLevel = 0`); only shifted-tier roles and `togglefullscreen` (F11) stay roles.
**Why**: A role's default accelerator can be overridden but never removed, and `registerAccelerator: false` still *displays* the dead accelerator — a UX lie. Plain items keep menu-item parity with mac while leaving the key itself free for the page.
**Rejected**: Dropping the items entirely (loses the mouse path for reload/zoom); `registerAccelerator: false` (displays Ctrl+R while the key falls through).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging

### Native runners per platform; the codesign gate stays mac-only
**Decision**: Three sibling `needs: release` jobs on macos-latest / ubuntu-latest / windows-latest, sharing one step shape (`desktop-windows` gets `defaults.run.shell: bash` to keep the shared `cd app/desktop && …` bodies working). Only `desktop-macos` runs the `codesign --verify --deep --strict` hard gate.
**Why**: Native runners avoid wine cross-compilation entirely and runner minutes are not a constraint; the codesign gate exists because an unsigned arm64 `.app` is *killed at launch*, an invariant with no Windows or Linux analogue (Windows is unsigned by design, Linux unsigned by nature), so asserting it there would be ceremony with nothing to catch.
**Rejected**: Wine cross-compilation from the ubuntu job (one fewer job, but a whole extra failure surface for no gain); a generic "verify the package" step on all three (nothing meaningful to verify off mac); PowerShell on the Windows job (would fork the step bodies).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging

### Build target is an optional argument defaulting to the host platform
**Decision**: `scripts/build-desktop.sh [mac|win|linux]` derives the target from `uname -s` when the argument is absent and errors non-zero on an unknown one; the justfile recipe stays a pass-through one-liner (`build-desktop *args:`).
**Why**: The common local case is "build for the machine I am on", and electron-builder cannot meaningfully cross-build these targets anyway — so the host default is right almost always, while the explicit argument keeps the script usable as the single named entrypoint. Constitution VIII keeps the branching in the script, not the justfile.
**Rejected**: A required target argument (breaks the existing argless `just build-desktop` habit for no benefit); three separate scripts (triplicates the version-derivation and icon-check preamble); branching inside the justfile recipe (Constitution VIII).
*Introduced by*: 260730-ler1-desktop-windows-linux-packaging
