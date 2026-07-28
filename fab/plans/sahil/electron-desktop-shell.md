# Electron Desktop Shell v1 — unsigned DMG, Slack-style server connect

## Context

run-kit is a browser SPA today, which caps its keyboard namespace: the `⌘+letter` / `⌘1–9` tier is browser-reserved and unreachable. A desktop shell removes that ceiling. Discussion settled on a **viewer shell**: an Electron app that loads an existing `rk serve` URL directly — like Slack's "enter your workspace URL" — with **no notarization** (ad-hoc signed DMG, right-click-open friction accepted) and **no daemon bundling** (Constitution VI: the shell is a client only, never spawns/supervises `rk`).

Key enabler verified in the codebase: the SPA is 100% origin-relative (bare `fetch("/api/…")` in `app/frontend/src/api/client.ts`; WS URLs built from `window.location` in `src/lib/state-socket.ts:62` and `src/lib/relay-mux.ts:68`). Loading the server's own HTTP origin means **zero SPA changes for basic function**.

**User-confirmed v1 scope**: shell + ⌘-tier keyboard capability (the seam, not the full binding set) + multi-server list with switcher + CI-built DMG on GitHub Releases. Dock badge / native notifications: deferred.

**Effort: ~4.5 days** (breakdown at bottom).

## Execution: two fab changes, sequential

- **Change 1 — `app/desktop` Electron shell (~4 days)**: the new package (main/servers/menu/preload/welcome), security wiring, 1024px icon variant in `scripts/generate-icons.sh`, `justfile` + `scripts/{dev,build}-desktop.sh`, frontend `src/lib/shell.ts` + test. Deliverable: `just build-desktop` produces a working ad-hoc-signed DMG on a Mac. Almost entirely additive — one new directory plus ~3 small touches to existing files.
- **Change 2 — release CI integration (~0.5 day)**: job-level outputs on the existing `release` job + the new `desktop-macos` job in `.github/workflows/release.yml`, verified via a test tag. Depends on change 1 merged. Isolated because it's release-train surgery with operational (tag-cutting) verification.

Execution environment note: this session runs on Linux — chunks 1/2/5 are fully executable here (Electron smoke-testable under xvfb); the DMG itself is built by the CI macos runner, and the final manual pass (Gatekeeper walkthrough, xterm ⌘C/⌘V, ⌘-tier fall-through feel) is a handed-off checklist for the user's Mac.

## New package: `app/desktop/` (7 source files)

Self-contained pnpm package (no workspace exists — matches `app/frontend` precedent). Deps: `electron` (pin current major), `electron-builder`, `typescript` — nothing else. Plain `tsc` compile (CJS, `outDir dist/`), no bundler. No electron-store — plain JSON with write-tmp-then-rename.

```
app/desktop/
├── package.json            # name run-kit-desktop, version 0.0.0 placeholder (injected at build)
├── pnpm-lock.yaml
├── tsconfig.json           # strict, CommonJS, ES2022, rootDir src → dist
├── electron-builder.yml
├── build/icon.png          # 1024px, COMMITTED (precedent: generated-icons/*.png are tracked)
└── src/
    ├── main.ts             # lifecycle, BrowserWindow, security wiring, IPC handlers, routing
    │                       #   welcome.html ↔ active server URL (~150 lines)
    ├── servers.ts          # servers.json load/save in app.getPath('userData'), add/remove/setActive,
    │                       #   URL normalization to origin (~80 lines)
    ├── menu.ts             # buildMenu(servers, activeId, cbs) — rebuilt on every list change
    ├── preload.ts          # contextBridge: window.runkitShell = {version, platform, __welcome}
    └── welcome/
        ├── welcome.html    # first-run/add-server page (static, copied to dist/ in compile script)
        └── welcome.ts      # validate → test ping → add+switch; ?mode=add shows cancel link
```

## Server list + first-run flow

`<userData>/servers.json`: `{ version: 1, activeId, servers: [{ id: randomUUID(), name, url }] }`. `url` normalized to `new URL(input).origin` (http/https only). Corrupt/missing → empty list → welcome page.

1. `app.whenReady()`: empty list → `loadFile(welcome.html)`; else `loadURL(activeServer.url)` (fallback: first server).
2. Welcome "Connect" → IPC `welcome:test-server` → **main process** pings `net.fetch(origin + "/api/health", { signal: AbortSignal.timeout(5000) })` — must be 200 with `status === "ok"`. Returned `hostname` pre-fills the display name (`app/backend/api/health.go:8`, mounted in `router.go`; CORS is moot since main pings).
3. `welcome:add-server` → persist, set active, rebuild menu, `loadURL`.
4. Add/remove after first run: `Servers → Add Server…` reloads welcome with `?mode=add`; `Servers → Remove "<name>"…` → native confirm dialog; removing the active server switches to first remaining or welcome.
5. **IPC hardening**: `welcome:*` handlers verify `event.senderFrame.url` starts with the welcome `file://` URL — server-loaded pages can read `runkitShell.version/platform` but never invoke privileged calls.

## App menu — the ⌘-tier seam

Core mechanic: Electron steals a key from the page only via menu accelerators, `globalShortcut` (we register none), or the OS. So the seam is simply **don't bind accelerators on keys the page should own**. No `before-input-event` needed in v1 (document in a `menu.ts` comment that future page-first handling of a menu-bound key = remove its accelerator, not intercept).

Menu binds ONLY: app essentials (⌘Q quit, ⌘H/⌥⌘H hide), **Edit roles ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A** (mandatory — clipboard in web content is dead on macOS without them), View (⌘R/⇧⌘R reload, ⌥⌘I devtools, ⌘+/⌘−/⌘0 zoom roles, ⌃⌘F fullscreen), **Servers switcher radios on ⌃1–⌃9** (Control deliberately — leaves ⌘1–9 free), Window ⌘M minimize (custom template, NOT `role: 'windowMenu'`, so no auto-⌘W).

**⌘W: unbound by design** — falls through to the page for future tab-close semantics; accelerator-less "Close Window" menu item for mouse users. Guaranteed fall-through set: ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos.

## Security wiring (main.ts)

- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload; shell version passed via `additionalArguments: ['--runkit-shell-version=' + app.getVersion()]` (sandboxed preloads read `process.argv`).
- `web-contents-created`: `setWindowOpenHandler` → always deny; registered-server origins load in-window, other http(s) → `shell.openExternal`. `will-navigate`: allow registered origins + welcome file:// URL only (SPA pushState routing never triggers it).
- `setPermissionRequestHandler`: allow `clipboard-read`, `clipboard-sanitized-write`, `notifications`; deny rest. No `certificate-error` bypass.

## Frontend seam (only SPA change)

New `app/frontend/src/lib/shell.ts` + `shell.test.ts` (house convention: lib modules pair with vitest files): `RunkitShell` interface, `declare global` window typing, `isShell()`, `shellInfo()`. Consumed nowhere critical in v1 — actual ⌘ bindings are a later change gated on `isShell()`. Non-secure http origins already degrade gracefully: SW/push gate on `isSecureContext` fail-silent (`src/lib/push.ts:20,36`), clipboard has `execCommand` fallback (`src/lib/clipboard.ts`).

## Packaging (electron-builder.yml)

```yaml
appId: ai.shll.run-kit
productName: Run Kit
directories: { buildResources: build, output: release }
files: ["dist/**"]
mac:
  category: public.app-category.developer-tools
  target: [{ target: dmg, arch: [arm64, x64] }]   # per-arch DMGs ≈110MB; universal ≈2× for no benefit
  identity: null                                   # ad-hoc only; no notarization
artifactName: "run-kit-desktop-${version}-${arch}.${ext}"
npmRebuild: false
```

- arm64 macOS requires at least ad-hoc signing; current electron-builder ad-hoc-signs automatically with `identity: null`. Verify with `codesign -dv` in CI; fallback = one-line `afterPack` hook (`codesign --force --deep -s -`). Set `CSC_IDENTITY_AUTO_DISCOVERY: false` in CI.
- Icon: extend `scripts/generate-icons.sh` (sharp, existing variants array) with a 1024px variant → `app/desktop/build/icon.png` (dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask for squircle fit). Committed, so CI needs neither sharp nor the frontend package. electron-builder auto-converts png→icns.
- **Version injection**: `--config.extraMetadata.version=$VERSION` (rewrites packaged package.json → `app.getVersion()` → `runkitShell.version`). There is NO VERSION file — `scripts/build.sh:19` reading one is latently broken; don't depend on or fix it here. Local builds: `git describe --tags --abbrev=0` (strip `v`), fallback `0.0.0-dev`.

## CI — `.github/workflows/release.yml`

1. Add job-level outputs to the existing `release` job: `tag`/`version` from `steps.version.outputs.*` (currently step-local only, verified release.yml:72–81).
2. New `desktop-macos` job: `needs: release`, `runs-on: macos-latest`; checkout with **`ref: ${{ needs.release.outputs.tag }}`** (critical: on workflow_dispatch the tag is created inside the release job by `scripts/release.sh`, so `github.ref` is wrong); setup-node 20 + pnpm 9 (pin action SHAs matching existing style); `pnpm install --frozen-lockfile` in app/desktop; compile + `electron-builder --mac --publish never --config.extraMetadata.version=…` with `CSC_IDENTITY_AUTO_DISCOVERY: "false"`; `codesign -dv` verify step; attach via `gh release upload "$tag" app/desktop/release/*.dmg --clobber` (appends assets without touching the release notes softprops generated; `permissions: contents: write` already set). Homebrew tap untouched.

## justfile + scripts (Constitution VIII: one-liners → scripts/)

- `dev-desktop:` → `scripts/dev-desktop.sh` — pnpm install if needed, compile, `electron .`; honor `RK_DESKTOP_URL` env to load a URL directly without persisting (pleasant against `just dev`: `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop`).
- `build-desktop:` → `scripts/build-desktop.sh` — version from git describe, verify `build/icon.png` exists (point at `just icons` if not), frozen install, compile, electron-builder.
- `.gitignore`: add `app/desktop/release/` (bare `dist` entry already covers compiled TS).

## Sequencing & effort (~4.5 days)

| # | Chunk | Days |
|---|-------|------|
| 1 | Shell core: main/servers/menu/preload + security wiring, loads persisted URL end-to-end | 1.5 |
| 2 | Welcome page + IPC ping/add/remove + menu switcher rebuild | 1.0 |
| 3 | Icon variant + electron-builder + local DMG + manual test pass (Gatekeeper walkthrough; xterm ⌘C/⌘V via Edit roles; ⌘1–9/⌘T/⌘W fall-through to page; SW no-op on http origin) | 1.0 |
| 4 | CI job + test-tag dry run (verify DMG lands on the release; workflow_dispatch path checks out the right ref) | 0.5 |
| 5 | justfile/scripts + frontend shell.ts + test + README note | 0.5 |

## Risks

1. **Gatekeeper (Sequoia)**: ad-hoc downloaded apps may show "damaged"; right-click-Open no longer bypasses — document `System Settings → Privacy & Security → Open Anyway` and `xattr -dr com.apple.quarantine "/Applications/Run Kit.app"` in release notes. Highest support-friction item.
2. **Edit-role ⌘C/⌘V vs xterm**: menu roles fire before the page; verify copy-from-terminal / paste-into-terminal explicitly in chunk 3. Fallback: drop the copy/paste accelerators (keep menu items) so keydowns reach xterm.
3. **electron-builder ad-hoc regression** on arm64 → app killed at launch; mitigated by CI codesign-verify + afterPack fallback.
4. **⌘W does nothing** until the SPA binds it — deliberate; ⌘Q and the red button remain.
5. **No auto-update** — manual DMG downloads; `runkitShell.version` enables a future update nudge.

## Verification

1. `just dev-desktop` with `RK_DESKTOP_URL=http://localhost:3000` against `just dev` — dashboard renders, terminal I/O works, external links open in system browser.
2. First-run: delete `servers.json`, launch → welcome page → enter URL → hostname pre-fills → connect. Add a second server, switch via ⌃1/⌃2, remove active server.
3. Keyboard: devtools console `monitorEvents`-style keydown listener (or temporary log in the SPA) confirming ⌘T/⌘W/⌘1–9 reach the page; ⌘C/⌘V work in xterm; ⌘Q quits.
4. `just build-desktop` on a Mac → mount DMG, drag to /Applications, quarantine walkthrough, `codesign -dv` shows ad-hoc signature.
5. Push a test tag on a branch → desktop-macos job builds and `gh release upload` attaches both DMGs; then one workflow_dispatch release verifying the tag-ref checkout path.
6. Existing suites unaffected: `just test-frontend` (covers new shell.test.ts); backend untouched except nothing.
