---
description: "The app/desktop Electron viewer shell — a BrowserWindow client of an existing rk serve URL that never spawns or supervises the daemon. Covers the servers.json store (id-keyed state, optional lastPath, rename mutator), the welcome flow + ?mode=rename variant, last-path capture/restore on switch/add/rename/close, the ⌘-tier accelerator-avoidance menu seam, the runkitShell preload bridge, security wiring, per-arch DMG packaging, and rk desktop install/update as the quarantine-free install path."
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
    ├── menu.ts             # buildMenu(servers, activeId, callbacks) — the ⌘-tier seam
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

## ⌘-Tier Menu Seam (`src/menu.ts`)

The point of the shell. Electron steals a key from the page only via menu accelerators, `globalShortcut` (none registered), or the OS — so the seam is: **do not bind accelerators on keys the page should own**. Unclaimed keys already reach the loaded SPA; there is no `before-input-event` interception, and none should be added — if the SPA later needs page-first handling of a key that IS menu-bound, the fix is to **remove that menu item's accelerator, never to intercept input events** (documented in the `menu.ts` header comment).

`buildMenu(servers, activeId, callbacks)` is rebuilt (and re-set via `Menu.setApplicationMenu`) on every server-list change. The bound accelerator set is exhaustive:

| Menu | Bound accelerators |
|------|--------------------|
| App | ⌘Q quit, ⌘H hide, ⌥⌘H hide-others |
| Edit | roles ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A — mandatory: clipboard in web content is dead on macOS without them |
| View | ⌘R reload, ⇧⌘R force-reload, ⌥⌘I devtools, ⌘0/⌘+/⌘− zoom roles, ⌃⌘F fullscreen |
| Servers | radio items on literal `Ctrl+1`…`Ctrl+9` (⌃, deliberately NOT CmdOrCtrl — ⌘1–9 stays free for the page); active server checked. The management items below them — `Add Server…`, per-server `Rename "<name>"…`, per-server `Remove "<name>"…` — are accelerator-less by design, so adding them never narrows the fall-through set |
| Window | ⌘M minimize + zoom via a **custom template**, NOT `role: 'windowMenu'` (that role auto-binds ⌘W) |

**⌘W is unbound by design** — it falls through to the page for future tab-close semantics; mouse users get an accelerator-less "Close Window" item. Guaranteed fall-through set: ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos.

Accepted gap (recorded nice-to-have): switcher radios check by exact `activeId` match, so in the dangling-`activeId` state startup loads the first server (store fallback) while no radio renders checked until the next list mutation rebuilds the menu.

## `window.runkitShell` Bridge (`src/preload.ts` ↔ `app/frontend/src/lib/shell.ts`)

The sandboxed preload exposes exactly one bridge via `contextBridge.exposeInMainWorld`:

- **`version`** — the shell app version, read from the `--runkit-shell-version=` argv entry (passed via `webPreferences.additionalArguments`, since sandboxed preloads read `process.argv` but cannot call `app.getVersion()`).
- **`platform`** — `process.platform`.
- **`__welcome`** — `{ testServer(url), addServer(name, url), renameServer(id, name), cancel() }`, thin `ipcRenderer.invoke` wrappers for the `welcome:*` channels.

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
- **Ad-hoc signing only**: `identity: null` plus the `afterPack: ./after-pack.js` hook — `identity: null` makes electron-builder *skip* signing entirely (it does NOT ad-hoc sign: the Electron prebuilt leaves only a linker signature on the arm64 binary and nothing on x64, proven on the v3.12.2 release run), so the hook runs `codesign --force --deep --sign -` on the packed `.app` before the DMG is built (arm64 macOS refuses to launch fully unsigned binaries). No Developer ID, no notarization. The residual cost lands only on **manually downloaded** DMGs — a browser stamps `com.apple.quarantine`, so Gatekeeper demands "Open Anyway" (or `xattr -dr com.apple.quarantine` on Sequoia's "damaged" variant) on every download. `rk desktop install` avoids it entirely (§ Installation & Updates).
- **Version injection**: `package.json` carries a `0.0.0` placeholder; the real version rides `electron-builder --config.extraMetadata.version=$VERSION` (rewrites the packaged package.json → `app.getVersion()` → `runkitShell.version`). The version source differs per build path: local `scripts/build-desktop.sh` derives `$VERSION` from `git describe --tags --abbrev=0` (leading `v` stripped, fallback `0.0.0-dev`); the CI job takes it from the release job's `version` output (§ Release Packaging). Either way the desktop pipeline reads no VERSION file and is independent of `scripts/build.sh`.
- **Icon**: `app/desktop/build/icon.png` is a **committed** 1024px raster generated by `scripts/generate-icons.sh` (dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask at radius ≈22.37% of size — Apple's app-icon corner ratio — so the flat square sits close to the macOS squircle when electron-builder converts png → icns). Committed so desktop builds need neither sharp nor the frontend package; regenerate via `just icons`.

## Release Packaging (`.github/workflows/release.yml` § `desktop-macos`)

Every tagged release carries `run-kit-desktop-{version}-arm64.dmg` and `run-kit-desktop-{version}-x64.dmg` as GitHub Release assets. The `desktop-macos` job (`needs: release`, `runs-on: macos-latest`) checks out the release tag, installs frozen deps under Node 22 (`engines.node >=22.12.0`; the frontend jobs' Node 20 is insufficient here), compiles, runs `electron-builder --mac --publish never` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and the version from the release job's output, verifies each `.app` with `codesign --verify --deep --strict` (plus `-dv` for display), and attaches the DMGs via `gh release upload … --clobber`. The job runs the packaging steps inline rather than calling `scripts/build-desktop.sh` — see [architecture](/run-kit/architecture.md) § Release Flow & CI/CD for the full step list and the dependency/skip semantics.

`just build-desktop` on a Mac is the local path, used for development builds and for reproducing a packaging failure off the release train.

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
