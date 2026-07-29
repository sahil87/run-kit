# macOS Test Brief — Electron Desktop Viewer Shell (PR #462)

> **Audience**: an agent running on the user's Mac (Claude Code or similar) with shell access.
> **Goal**: verify everything change `260728-04pg-electron-desktop-shell` could not verify on Linux — DMG packaging, Gatekeeper, and the ⌘-tier keyboard seam under real macOS key handling.
> **Scope guard**: this is TESTING only. Do not fix, refactor, or commit code. Record findings; the fix loop belongs to a separate change.

## What you are testing

`app/desktop/` is a new Electron **viewer shell**: a BrowserWindow that loads an existing `rk serve` URL (like Slack's workspace-URL model). It never spawns the rk daemon. Its reason to exist is the **⌘-tier keyboard seam** — the app menu deliberately avoids accelerators on keys the web page should receive (⌘T ⌘W ⌘N ⌘L ⌘K ⌘F ⌘P ⌘1–9 ⌘[ ⌘] and unlisted ⇧⌘ combos), which a browser can never deliver. Design doc: `fab/plans/sahil/electron-desktop-shell.md`; memory: `docs/memory/run-kit/desktop-shell.md`.

## Prerequisites

- Branch `260728-04pg-electron-desktop-shell` checked out (or main, once PR #462 merges).
- Node ≥ 22.12 (Electron 43 floor — `app/desktop/package.json` `engines`), pnpm ≥ 9, `just`.
- A running run-kit server to connect to: `just dev` in this repo (Vite on `RK_PORT`, default 3000) or any `rk serve` instance. `http://localhost:3000` is fine.
- For keystroke automation via `osascript`, the terminal app needs Accessibility permission (System Settings → Privacy & Security → Accessibility). If not grantable, do those steps interactively with the user.

## Useful levers for an agent

- **Screenshots**: `screencapture -x /tmp/shot.png` then read the image — your main way to "see" the window.
- **CDP**: launch dev mode with remote debugging to evaluate JS in the page:
  `cd app/desktop && pnpm run compile && RK_DESKTOP_URL=http://localhost:3000 pnpm exec electron . --remote-debugging-port=9222`
  then `curl http://127.0.0.1:9222/json` → websocket → `Runtime.evaluate`. Good for asserting `window.runkitShell`, DOM state, and injecting a keydown logger. **Not valid** for testing menu accelerators (CDP-synthesized keys bypass the native menu) — real accelerator tests need `osascript` System Events keystrokes or the user's hands.
- **userData paths** (where `servers.json` lives): dev/unpackaged → `~/Library/Application Support/run-kit-desktop/`; packaged app → `~/Library/Application Support/Run Kit/`.

## Test matrix

### T1 — Build & packaging
1. `just build-desktop` → expect `app/desktop/release/run-kit-desktop-<version>-arm64.dmg` (+ `-x64.dmg`). `<version>` should equal the latest git tag sans `v` (from `git describe`), not `0.0.0`.
2. `codesign -dv app/desktop/release/mac-arm64/*.app 2>&1` → must show a signature with `Signature=adhoc` (ad-hoc; `identity: null` by design). An **unsigned** arm64 app is a FAIL (it won't launch at all).
3. Mount the DMG, drag "Run Kit.app" to /Applications.

### T2 — Gatekeeper walkthrough (packaged app)
1. Launch from Finder. **Expected**: blocked ("damaged" or "unidentified developer" — record the exact dialog wording and macOS version).
2. Recovery path A: System Settings → Privacy & Security → "Open Anyway". Path B: `xattr -dr com.apple.quarantine "/Applications/Run Kit.app"`. Record which worked — this text feeds the README/release notes.

### T3 — First-run & multi-server flow
1. Remove `servers.json` (path above). Launch → **welcome page** with URL + name inputs.
2. Enter the running server's URL → Connect → name field pre-fills with the server's hostname (from `/api/health`); Add → dashboard loads.
3. Enter an unreachable URL (e.g. `http://localhost:59999`) → structured error, nothing persisted.
4. Menu **Servers → Add Server…** → welcome with a cancel link (`?mode=add`) → add a second server (a second `rk serve -d` on another port, or any reachable instance).
5. Switch via **⌃1 / ⌃2** — radio checkmark follows; window loads the right server.
6. **Servers → Remove** the active server → native confirm → switches to the remaining one; remove all → welcome page.

### T4 — ⌘-tier keyboard seam (the core test)
With the dashboard loaded and a terminal window focused:
1. **Existing SPA shortcuts still work**: ⌘K (palette), ⌘\ (sidebar), ⌘. (lens cycle), Ctrl+` (chat toggle on chat-capable windows).
2. **Fall-through set reaches the page**: inject via devtools (⌥⌘I) `window.addEventListener('keydown', e => (e.metaKey) && console.log('page got', e.key), true)` then press ⌘T ⌘W ⌘N ⌘L ⌘P ⌘1…⌘9 ⌘[ ⌘] — **every one must log**; none may trigger browser-chrome behavior (there is none) or close the window.
3. **⌘W is a deliberate no-op** (window stays open; only the red button / ⌘Q / Window menu close it) — not a bug.
4. **Edit roles in xterm**: select text in the terminal → ⌘C → paste elsewhere (clipboard has it); ⌘V into the terminal → text arrives in the shell. This is the riskiest known interplay (menu roles fire before the page; xterm selections are canvas-managed) — if copy/paste fails here it is a REAL finding (recorded fallback: drop the copy/paste accelerators, keep the menu items).
5. **Bound chords behave**: ⌘Q quits, ⌘H hides, ⌘M minimizes, ⌘R reloads (kill and restart `rk serve` → ⌘R reconnects), ⌘+/⌘−/⌘0 zoom, ⌃⌘F fullscreen, ⌥⌘I devtools.
6. Menu inspection: Window menu has NO ⌘W accelerator on Close Window; Servers radios show ⌃1–⌃9.

### T5 — Security wiring
1. In devtools on a server page: `window.runkitShell` → `{version: "<injected>", platform: "darwin", __welcome: {...}}`; `await window.runkitShell.__welcome.testServer("http://localhost:3000")` → must be **rejected** (senderFrame gate — only the welcome page may call it).
2. Click an external http(s) link in the dashboard (e.g. a PR link in the sidebar, or a URL printed in the terminal via the WebLinks addon) → opens in the **system browser**, never in-window.
3. `window.open('https://example.com')` from devtools → denied in-window, opens externally.

### T6 — Degradation parity (plain-http origin)
On an `http://<non-localhost>` origin (e.g. a Tailscale IP): service worker/push silently absent (`isSecureContext` false — expected, matches browser behavior), clipboard falls back to `execCommand`. No console errors beyond that.

## Known-accepted, do NOT report as bugs

- Gatekeeper friction (T2) — no notarization by design.
- ⌘W no-op (T4.3) — reserved for future tab semantics.
- SW/push absent on plain-http origins (T6).
- tmux's ~80-col minimum causing horizontal overflow on narrow windows — pre-existing product behavior.

## Reporting

Produce `fab/plans/sahil/electron-desktop-shell-macos-results.md`: one row per T-item — pass/fail/blocked + a one-line note (exact dialog text for T2; macOS + hardware arch at top). For each FAIL, capture a screenshot path and, if actionable, add a backlog entry (`idea add "desktop-shell: <finding>"` — the `idea` CLI is installed). Do not fix anything in this session.
