# Intake: Electron Desktop Viewer Shell

**Change**: 260728-04pg-electron-desktop-shell
**Created**: 2026-07-28

## Origin

> Electron desktop viewer shell (app/desktop) — change 1 of the plan at fab/plans/sahil/electron-desktop-shell.md

Conversational origin: a `/fab-discuss` session explored keyboard-shortcut models (Conductor comparison), then Electron feasibility, then converged via plan mode. The full implementation plan was written and user-reviewed at **`fab/plans/sahil/electron-desktop-shell.md`** (read it alongside this intake — it is the design source). The user made three explicit scope decisions via direct questioning:

1. **V1 scope** = shell + the *ability* to override ⌘-tier browser-native shortcuts (the seam, not the full binding set). Dock badge / native notifications explicitly deferred.
2. **Multi-server list** (not single URL) with a switcher.
3. **CI + GitHub Releases** distribution — but the release-CI work was split into a **separate second change** (backlog `[5uae]`); this change delivers everything local, ending at `just build-desktop` producing a working DMG on a Mac.

No notarization: user explicitly accepted ad-hoc-signed DMG with Gatekeeper "Open Anyway" friction.

## Why

run-kit is a browser SPA, which caps its keyboard namespace: the `⌘+letter` / `⌘1–9` tier is browser-reserved and can never reach the page. For a keyboard-first product (Constitution V) this is a hard ceiling — competitors like Conductor (Electron) spend that entire tier on navigation and verbs. The installed PWA gives a standalone window but does not unlock the reserved keys.

A desktop shell removes the ceiling. The chosen shape is a **viewer shell**: a BrowserWindow that loads an existing `rk serve` URL directly — like Slack's "enter your workspace URL". This is cheap because the SPA is 100% origin-relative (bare `fetch("/api/…")` in `app/frontend/src/api/client.ts`; WS URLs built from `window.location` in `src/lib/state-socket.ts:62` and `src/lib/relay-mux.ts:68`), so loading the server's own HTTP origin requires zero SPA changes for basic function.

If we don't build it: the ⌘-tier stays unreachable and any future desktop affordances (badge, native notifications) have no home. Why this approach over alternatives: bundling the daemon inside Electron violates Constitution VI (tmux/server layer independent of any supervisor); Tauri was considered but Electron's Chromium matches what the product is already debugged against (xterm rendering, connection-pool behavior).

## What Changes

### 1. New package: `app/desktop/` (7 source files)

Self-contained pnpm package — **no workspace exists** in this repo; `app/frontend` is the precedent (own `package.json` + `pnpm-lock.yaml`). devDependencies: `electron` (pin current stable major), `electron-builder`, `typescript` — nothing else. No electron-store. Plain `tsc` compile (strict, CommonJS, ES2022, `src/` → `dist/`), no bundler. Main entry `dist/main.js`.

```
app/desktop/
├── package.json            # name run-kit-desktop, private, version 0.0.0 placeholder (injected at build);
│                           #   scripts: compile (tsc + copy welcome.html), dev, dist
├── pnpm-lock.yaml
├── tsconfig.json
├── electron-builder.yml
├── build/icon.png          # 1024px raster, COMMITTED (precedent: generated-icons/*.png are tracked)
└── src/
    ├── main.ts             # lifecycle, BrowserWindow, security wiring, IPC handlers,
    │                       #   welcome.html ↔ active-server-URL routing (~150 lines)
    ├── servers.ts          # servers.json load/save, add/remove/setActive, URL normalization (~80 lines)
    ├── menu.ts             # buildMenu(servers, activeId, callbacks); rebuilt on every list change
    ├── preload.ts          # contextBridge: window.runkitShell = {version, platform, __welcome}
    └── welcome/
        ├── welcome.html    # Slack-style first-run/add-server page (static; copied to dist/ at compile)
        └── welcome.ts      # validate → test ping → add+switch; ?mode=add shows a cancel link
```

### 2. Server list + first-run flow

`<userData>/servers.json`:

```json
{
  "version": 1,
  "activeId": "b3f1…",
  "servers": [{ "id": "<randomUUID>", "name": "studio-mac", "url": "http://100.101.2.3:3000" }]
}
```

- `url` normalized to `new URL(input).origin` (http/https only, else validation error). Write via tmp-file-then-rename. Corrupt/missing file → empty list → welcome page.
- `app.whenReady()`: empty list → `loadFile(welcome.html)`; else `loadURL(activeServer.url)` (fallback: first server if `activeId` dangles).
- Welcome "Connect" → IPC `welcome:test-server` → **main process** pings `net.fetch(origin + "/api/health", { signal: AbortSignal.timeout(5000) })`; must be HTTP 200 with `status === "ok"`. The endpoint exists: `app/backend/api/health.go:8` returns `{status: "ok", hostname}`; returned `hostname` pre-fills the display name.
- `welcome:add-server {name, url}` → persist, set active, rebuild menu, `loadURL`.
- Post-first-run management: menu `Servers → Add Server…` reloads welcome with `?mode=add`; `Servers → Remove "<name>"…` → native confirm dialog; removing the active server switches to first remaining or welcome.
- **IPC hardening**: `welcome:*` handlers verify `event.senderFrame.url` starts with the welcome `file://` URL — server-loaded pages can read `runkitShell.version/platform` but never invoke privileged calls.

### 3. App menu — the ⌘-tier seam (the point of the change)

Electron steals a key from the page only via menu accelerators, `globalShortcut` (none registered), or the OS. So the seam is: **do not bind accelerators on keys the page should own.** No `before-input-event` in v1 — unclaimed keys already reach the page; document in a `menu.ts` comment that future page-first handling of a menu-bound key means removing its accelerator, not intercepting.

Menu binds ONLY: app essentials (⌘Q quit, ⌘H/⌥⌘H hide), **Edit roles ⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A** (mandatory — clipboard in web content is dead on macOS without them), View (⌘R/⇧⌘R reload, ⌥⌘I devtools, ⌘+/⌘−/⌘0 zoom roles, ⌃⌘F fullscreen), **Servers switcher radio items on ⌃1–⌃9** (Control deliberately — leaves ⌘1–9 free), Window ⌘M minimize (custom template, NOT `role: 'windowMenu'`, so no auto-⌘W).

**⌘W: unbound by design** — falls through to the page for future tab-close semantics; accelerator-less "Close Window" menu item for mouse users. Guaranteed fall-through set: ⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and all unlisted ⇧⌘ combos.

### 4. Security wiring (main.ts)

- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload; shell version passed via `additionalArguments: ['--runkit-shell-version=' + app.getVersion()]` (sandboxed preloads read `process.argv`).
- `web-contents-created`: `setWindowOpenHandler` → always deny; registered-server origins load in-window, other http(s) → `shell.openExternal`. `will-navigate`: allow registered origins + welcome `file://` URL only.
- `setPermissionRequestHandler`: allow `clipboard-read`, `clipboard-sanitized-write`, `notifications`; deny rest. No `certificate-error` bypass.
- The shell NEVER spawns or supervises the rk daemon (Constitution VI) — client only.

### 5. Packaging (electron-builder.yml)

```yaml
appId: ai.shll.run-kit
productName: Run Kit
directories: { buildResources: build, output: release }
files: ["dist/**"]
mac:
  category: public.app-category.developer-tools
  target: [{ target: dmg, arch: [arm64, x64] }]   # per-arch DMGs; universal ≈2× size for no benefit
  identity: null                                   # ad-hoc only; no notarization
artifactName: "run-kit-desktop-${version}-${arch}.${ext}"
npmRebuild: false
```

- arm64 macOS requires at least ad-hoc signing; current electron-builder ad-hoc-signs automatically with `identity: null`. If a regression leaves it unsigned, fallback is a one-line `afterPack` hook (`codesign --force --deep -s -`).
- **Version injection**: `electron-builder --config.extraMetadata.version=$VERSION` (rewrites packaged package.json → `app.getVersion()` → `runkitShell.version`). There is NO VERSION file in this repo — `scripts/build.sh:19` reading one is latently broken; do not depend on it or fix it here. Local builds: `git describe --tags --abbrev=0` (strip `v`), fallback `0.0.0-dev`.

### 6. Icon variant (`scripts/generate-icons.sh`)

Extend the existing sharp variants array with a 1024px variant → `app/desktop/build/icon.png` (dark bg `#0f1117`, 20% padding, rounded-rect `dest-in` mask composite for macOS squircle fit). Source: `app/frontend/public/icon.svg`. The PNG is committed so builds need neither sharp nor the frontend package. electron-builder auto-converts png→icns.

### 7. justfile + scripts (Constitution VIII: one-liner recipes → scripts/)

- `dev-desktop:` → `scripts/dev-desktop.sh` — pnpm install if `node_modules` missing, compile, `pnpm exec electron .`; honor `RK_DESKTOP_URL` env to load a URL directly without persisting (`RK_DESKTOP_URL=http://localhost:3000 just dev-desktop` against `just dev`).
- `build-desktop:` → `scripts/build-desktop.sh` — version from git describe, verify `build/icon.png` exists (point at `just icons` if missing), `pnpm install --frozen-lockfile`, compile, `electron-builder --mac --publish never --config.extraMetadata.version=$VERSION`.
- `.gitignore`: add `app/desktop/release/` (the bare `dist` entry already covers compiled TS output).

### 8. Frontend seam (only SPA change)

New `app/frontend/src/lib/shell.ts` + `shell.test.ts` (house convention: lib modules pair with vitest files): `RunkitShell` interface (`{version, platform}`), `declare global` window typing, `isShell()`, `shellInfo()`. Consumed nowhere critical in v1 — actual ⌘ bindings are a later change gated on `isShell()`. Non-secure http origins already degrade gracefully in the SPA: SW/push gate on `isSecureContext` fail-silent (`src/lib/push.ts:20,36`), clipboard has an `execCommand` fallback (`src/lib/clipboard.ts`).

### Non-goals (explicitly out of scope)

- **Release CI** (desktop-macos job, job-level outputs in release.yml) — change 2, backlog `[5uae]`.
- Dock badge / native notifications (deferred by user).
- Deep-link (`runkit://`) pairing, auto-update, Windows/Linux packaging.
- Actual ⌘-tier bindings in the SPA (later change gated on `isShell()`).
- Touching `scripts/build.sh` or the Go backend.

## Affected Memory

- `run-kit/desktop-shell`: (new) The app/desktop Electron viewer shell — viewer-only architecture (never supervises the daemon), server-list store + welcome flow, the ⌘-tier menu/accelerator seam, `window.runkitShell` bridge contract, ad-hoc DMG packaging + version injection.
- `run-kit/architecture`: (modify) Repository layout gains the third `app/desktop` package; build pipeline gains `just dev-desktop`/`build-desktop` and the 1024px icon variant.

## Impact

- **Additive**: one new directory (`app/desktop/`, ~10 files). Existing-file touches: `scripts/generate-icons.sh` (one variant entry), `justfile` (two recipes), two new `scripts/*.sh`, `.gitignore` (one line), `app/frontend/src/lib/shell.ts` + `shell.test.ts` (new files). Zero backend changes; zero changes to existing frontend behavior.
- **Verification split** (execution environment is Linux): Electron shell smoke-testable on Linux under xvfb (welcome flow, server store, menu structure); DMG build + Gatekeeper walkthrough + xterm ⌘C/⌘V + ⌘-fall-through feel require a Mac — delivered as a handed-off manual checklist. `just test-frontend` covers the new `shell.test.ts`.
- **Risks** (from the plan): Gatekeeper "damaged" UX on Sequoia (document `xattr -dr com.apple.quarantine` in README note); Edit-role ⌘C/⌘V vs xterm interplay (fallback: drop copy/paste accelerators, keep menu items); electron-builder ad-hoc regression on arm64.

## Open Questions

*(none — design fully resolved in fab/plans/sahil/electron-desktop-shell.md and the originating conversation)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Viewer shell only — never spawns/supervises the rk daemon | Constitution VI mandates it; discussed and confirmed explicitly | S:90 R:70 A:95 D:95 |
| 2 | Certain | Scope = keyboard-capability seam; dock badge/notifications deferred | User's explicit scope answer chose this over the badge option | S:95 R:90 A:90 D:95 |
| 3 | Certain | Multi-server list with ⌃1–9 switcher (not single URL) | User's explicit choice in scope questioning | S:95 R:85 A:90 D:90 |
| 4 | Certain | Ad-hoc signed DMG, no notarization; Gatekeeper friction accepted | User stated "notarization isn't a requirement" and confirmed | S:95 R:80 A:90 D:95 |
| 5 | Certain | Release CI split to change 2 (backlog [5uae]); this change ends at local `just build-desktop` | User approved the 2-change split explicitly | S:95 R:90 A:95 D:95 |
| 6 | Certain | Self-contained pnpm package, TS strict, no workspace wiring | app/frontend precedent; no pnpm-workspace.yaml exists (verified) | S:85 R:90 A:95 D:90 |
| 7 | Confident | ⌘-seam = accelerator-avoidance + runkitShell preload flag + lib/shell.ts; no before-input-event in v1 | Plan-reviewed design; Electron delivers unclaimed keys to the page; easily extended later | S:80 R:85 A:85 D:80 |
| 8 | Confident | ⌘W left unbound; accelerator-less Close Window menu item | Plan-reviewed; reversible one-liner if it annoys | S:70 R:90 A:80 D:75 |
| 9 | Confident | Per-arch DMGs (arm64+x64), not universal | Mirrors rk-darwin-{arm64,amd64} artifact convention; universal ≈2× size | S:60 R:90 A:85 D:80 |
| 10 | Confident | Plain servers.json in userData with atomic write; no electron-store dep | Minimal-deps preference; trivial to swap later | S:65 R:95 A:90 D:85 |
| 11 | Confident | appId `ai.shll.run-kit`, productName "Run Kit" | shll toolkit domain; appId change later moves userData (moderate rework) | S:55 R:60 A:75 D:70 |
| 12 | Confident | Health ping from main process via net.fetch /api/health, 5s timeout; hostname pre-fills name | Endpoint verified (health.go:8); main-process ping keeps renderer sandboxed | S:75 R:90 A:95 D:90 |
| 13 | Confident | Version via extraMetadata from `git describe`; VERSION-file path (build.sh:19) untouched | No VERSION file exists (verified); fixing build.sh is out of scope | S:75 R:85 A:90 D:85 |
| 14 | Confident | 1024px committed icon variant with rounded-rect mask via generate-icons.sh | Committed-PNG precedent verified; mask is cosmetic and reversible | S:70 R:95 A:85 D:80 |

14 assumptions (6 certain, 8 confident, 0 tentative, 0 unresolved).
