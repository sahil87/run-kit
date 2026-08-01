# Intake: Fix Stale Welcome Drag Region Killing the Titlebar Host Switcher

**Change**: 260801-5k2m-fix-stale-welcome-drag-region
**Created**: 2026-08-01

## Origin

Conversational — reported during a `/fab-discuss` session and diagnosed by code trace before this intake:

> After clicking on "Add host" from the title bar, and then clicking cancel - the host dropdown from the title bar no longer works

The discussion traced the full round trip through `app/desktop/src/main.ts` and produced a high-confidence root-cause hypothesis (not yet verified against a live shell), a discriminating manual test, and an agreed fix direction (the recommended option 1 below; the user then said "kick a fab new for both", accepting the proposal).

## Why

**Problem**: In the desktop shell, after opening the Add Host flow from the titlebar strip's host-switcher dropdown (`+ Add Host…`) — or from the native `Hosts → Add Host…` menu — and returning to a host page, the host-switcher trigger in the titlebar strip stops responding to clicks. The rest of the app keeps working; only the top-28px strip's interactive island is dead, permanently, until app relaunch.

**Consequence if unfixed**: The mouse-secondary path for host switching (shipped in 260731-4bqi / PR #502) silently dies after the first welcome round trip in any session. Because the same seam runs on *every* welcome→host transition, actually adding a host (first-run flow, `welcome:add-host` → `switchToHost`) is predicted to break it too — not just the Cancel path the user found.

**Root cause (hypothesis, high confidence — verify live before/while fixing)**: `welcome.html` carries a fixed 28px full-width `-webkit-app-region: drag` band (`app/desktop/src/welcome/welcome.html`, `.titlebar-strip`). When the welcome page hands off to a host view, `blankWelcomeUnderlay` (`app/desktop/src/main.ts:418`) navigates the window's own webContents to `about:blank`. Chromium only emits draggable-region updates for documents that *have* app-region elements — `about:blank` has none, so no update fires and Electron keeps the welcome page's regions cached on the base webContents (a known Electron bug class: regions persisting after CSS removal / view changes — electron/electron#26308, #20926). Electron merges drag regions across the base webContents and attached `WebContentsView`s without z-order occlusion, and no-drag exclusions subtract only *within their own webContents* — so the stale full-width band under the SPA view overrides the strip's single no-drag island (the host-switcher trigger, `app/frontend/src/components/shell-titlebar-strip.tsx`). Every click there becomes a window drag.

**Why this approach over alternatives**: fix at `blankWelcomeUnderlay` — it is the ONE seam where welcome hands off to a view (both the Cancel path and the successful-add path flow through `attachHostView` → `blankWelcomeUnderlay`), so one change covers all transitions. Rejected: `executeJavaScript` on the welcome page to flip its strip to `no-drag` before blanking (more moving parts, ordering-sensitive, same effect); leaving `about:blank` and patching renderer-side (the SPA cannot punch through another webContents' region).

## What Changes

### 1. `blankWelcomeUnderlay` loads a no-drag blank document instead of `about:blank`

In `app/desktop/src/main.ts`, replace the `about:blank` load with a `data:` URL whose document declares an explicit no-drag region, forcing Chromium to emit a draggable-regions update that clears the stale welcome band:

```ts
// today
void win.webContents.loadURL("about:blank");
// after
void win.webContents.loadURL(BLANK_UNDERLAY_URL);
```

with the constant (exact content to be finalized during apply):

```ts
/** Blank underlay that clears the welcome page's stale draggable region:
 *  a document with an explicit app-region element forces Chromium to emit a
 *  regions update, where about:blank (no app-region styles) never does. */
export const BLANK_UNDERLAY_URL =
  'data:text/html,<body style="-webkit-app-region:no-drag"></body>';
```

The constant SHOULD live in `app/desktop/src/strip.ts` (the electron-free titlebar-strip pure-logic module) so `strip.test.ts` can cover it under plain `node --test`, per the package's electron-free-module pattern.

Follow-on checks inside `main.ts` (expected no-ops, verify during apply):

- The `blankWelcomeUnderlay` gate reads `win.webContents.getURL().startsWith(WELCOME_URL)` **before** loading — unchanged.
- `showWelcome` reloads the welcome page fresh via `loadFile` — the welcome page re-declares its own drag band on load, so bouncing welcome↔host repeatedly stays correct in both directions.
- A main-initiated `loadURL` bypasses the `will-navigate` guard (the existing `about:blank` comment documents this), so the `data:` URL needs no allowlist entry. The doc comments on `blankWelcomeUnderlay` and the design-decision note in memory must be updated to name the new URL and why.
- `badge:set`'s direct-paint branch keys on `event.sender.id === mainWindow.webContents.id`, not on the URL — unaffected.

### 2. Live verification (manual, on macOS)

Before or alongside the fix, confirm the diagnosis and the fix on a real shell run:

- **Repro + discriminator**: registered host → strip dropdown → `+ Add Host…` → Cancel → press-and-drag on the host name in the strip. Window moving under the drag confirms the stale-drag-region mechanism.
- **Predicted second path**: first-run/menu Add Host → actually *add* a host → the dropdown must work immediately (this path is predicted broken today).
- **Post-fix**: both paths leave the dropdown clickable; the strip band *outside* the trigger stays draggable; the welcome page itself remains draggable when shown again.

If the live repro CONTRADICTS the hypothesis (window does not move on drag), stop and re-diagnose before applying the fix — the change is premised on this mechanism.

### 3. Tests

- `strip.test.ts`: assert the exported underlay-URL constant is a `data:text/html` URL and carries `-webkit-app-region:no-drag` (a contract pin, mirroring the module's other constant tests).
- No Playwright coverage — the bug lives in Electron window compositing, outside the web test harness's reach; the manual verification above is the acceptance evidence (record the outcome in the PR body).

## Affected Memory

- `run-kit/desktop-shell`: (modify) § Host Views "The welcome underlay is blanked" and the matching Design Decisions entry — the underlay is now a no-drag `data:` document, and why `about:blank` was insufficient (stale draggable regions).

## Impact

- `app/desktop/src/main.ts` — `blankWelcomeUnderlay` (one-line load-target change + comment).
- `app/desktop/src/strip.ts` + `strip.test.ts` — new exported constant + test.
- No IPC, store, frontend, or backend changes. No security-surface change (main-initiated load, no allowlist edit).
- Affects all three welcome→host transitions: cancel, add-and-switch, local-daemon connect.

## Open Questions

- None — the fix seam and approach were agreed in discussion; the one contingency (hypothesis falsified by live repro) has an explicit stop-and-re-diagnose instruction in What Changes §2.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Root cause is the stale welcome drag region persisting on the base webContents after `about:blank` | Full code trace matches the symptom shape exactly (only the strip's no-drag island dies, permanently, only after a welcome round trip); mechanism matches a known Electron bug class; NOT yet verified on a live shell — What Changes §2 gates the fix on the live discriminator | S:80 R:75 A:60 D:70 |
| 2 | Certain | Fix at `blankWelcomeUnderlay` via a no-drag `data:` URL (option 1 from discussion) | Recommended in discussion and accepted by the user; single seam covers every welcome→host path; `executeJavaScript` alternative explicitly rejected as more fragile | S:75 R:90 A:80 D:75 |
| 3 | Certain | Constant lives in `strip.ts` with a `node --test` contract test | Package convention: every testable decision lives in an electron-free module; `strip.ts` is the titlebar-strip home | S:60 R:95 A:90 D:85 |
| 4 | Certain | No Playwright/e2e coverage; manual verification is the acceptance evidence | Electron window compositing is outside the web harness; desktop package has no GUI test rig by design (node --test only) | S:70 R:90 A:95 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
