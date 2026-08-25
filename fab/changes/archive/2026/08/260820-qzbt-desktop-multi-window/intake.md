# Intake: Desktop-Shell Multi-Window

**Change**: 260820-qzbt-desktop-multi-window
**Created**: 2026-08-21

## Origin

Promptless dispatch from a design discussion with the user; the synthesized description below is the discussion's outcome and the user-decided points are FINAL. Interaction mode: one-shot intake creation (`promptless-defer` — no questions asked; any would-be question is recorded as a deferred Unresolved assumption).

> **Feature: desktop-shell multi-window** — one Electron process, many windows, the JetBrains/VS Code model. Today `app/desktop` is a hard single-window architecture: a module-level `mainWindow` singleton (`src/main.ts:142`), one persistent `WebContentsView` per host keyed on host id alone (`src/views.ts`), a global `activeId` in hosts.json, an app-global menu and dock badge built around one active host, `setWindowOpenHandler` denying every new window, and no `requestSingleInstanceLock`. The user's use cases: (1) two windows on two different hosts, (2) two windows on the same host pointed at different tmux servers/routes.

## Why

1. **The pain point**: the shell can show exactly one host and one route at a time. A user running agents on two machines (e.g. `studio-mac` and `buildbox`) must flip a single window back and forth; a user watching two tmux servers on one host has no way to see both. Every comparable tool in the product's reference class (JetBrains, VS Code, Slack) offers N independent windows; the shell's single-window model is an architectural accident of v1, not a design position.
2. **The consequence of not fixing it**: the ⌥⌘1–9 switcher stays the only multi-host affordance — serial, not parallel. Worse, users work around it with `open -n`, launching a second OS instance that shares `userData` and collides on the LevelDB lock — a real, currently-unguarded hazard (`requestSingleInstanceLock` is absent).
3. **Why this approach**: one process with many `BrowserWindow`s is the platform-native model — it keeps one menu, one dock icon, one hosts.json writer, and one view registry, while windows multiply. The alternative (multiple OS instances) is exactly the shared-userData hazard above. Re-keying views on (window, host) instead of migrating views between windows keeps the registry a pure decision layer; the backend already serves N browser clients, so N independent views of one origin is ordinary.

## What Changes

All user-decided contract points below are **FINAL**. The change is `app/desktop` only — zero SPA/renderer code changes (the `shell:new-window` channel is exposed but unconsumed).

### 1. One process, many windows (single-instance lock)

Never multiple OS instances sharing userData. Add `requestSingleInstanceLock()`; when the lock is not obtained the new launch quits. A `second-instance` event in the surviving process opens a **new window** in that process (this also fixes the accidental `open -n` double-instance hazard: shared-userData LevelDB lock collisions).

### 2. New Window opens a duplicate of the current window

`New Window` opens a duplicate of the **current (focused) window**: same host, same current route, but a **fresh independent `WebContentsView`** (independent renderer, own WS/SSE connections — never a shared or moved view). With no hosts registered it opens the welcome page.

- Menu item: `Window → New Window` on mac, `File → New Window` on win/linux — **accelerator-less in this change**. ⌘N arrives via a separate follow-up change that repoints the SPA's ⌘N binding through a new `shell:new-window` bridge channel.
- This change SHOULD still add the **`shell:new-window` bridge channel + IPC handler** (preload invoker + main-side handler routing to the same new-window function the menu item calls), so the follow-up is purely SPA-side. The shell claims no accelerator.

### 3. Same host in N windows — allowed, uncapped

The view key becomes **(windowId, hostId)**. Several independent views of one origin are ordinary — the backend already serves N browser clients. No cap, no eviction (the existing "host lists are small" posture extends to windows).

### 4. Per-window host switching

⌥⌘1–9 (mac) / Alt+1–9 (win/linux) act on the **FOCUSED window**; the Hosts menu radio callbacks route through the focused window. The menu rebuilds on window-focus changes wherever its rendered state depends on the focused window's active host (the radio check marks, at minimum).

### 5. Window switching is OS-native — no new shortcuts

macOS ⌘\`/⇧⌘\` ("Move focus to next window" system shortcut), App Exposé, and the Dock window list; win/linux Alt+Tab. To make entries distinguishable:

- **Window titles become the active host name plus the route leaf** (e.g. `studio-mac — utils2`); the welcome window titles plainly (product name).
- The mac Window menu (custom template — deliberately NOT `role: 'windowMenu'`, which auto-binds ⌘W; the existing decision stands) gains a **manual per-window list section**, rebuilt on window open/close/focus/title changes, since the custom template forgoes AppKit's automatic window list.

### 6. Badge = sum across distinct displayed hosts (user-decided)

Sum the waiting counts of every host that is the ACTIVE host of any open window; a host displayed by two windows counts **once**. This **deliberately supersedes** the recorded "aggregation across hosts is a deliberate non-goal" in `docs/memory/run-kit/desktop-shell.md` (that non-goal was scoped to the single-window model — the memory's own wording anticipates this as "a deliberate follow-up, not an oversight"). Per-view caches stay unchanged in shape; the painted OS badge recomputes on any cached count change, window open/close, and host switches. On win32 the overlay icon is a per-window surface (`win.setOverlayIcon`) — the plan decides whether the aggregate paints on every window or only the focused one (see Assumptions #10).

### 7. Cold-start restores the window set (user-decided)

Persist each open window's `{active host id, current route, bounds}` in a **NEW `windows.json` beside hosts.json** — do NOT complicate hosts.json's additive-field discipline. The store is:

- atomic-write (tmp-then-rename) + corrupt→empty tolerant, like the hosts store;
- electron-free and directory-parameterized like `hosts.ts`, with a `node --test` suite.

Relaunch (and macOS dock-reopen after all windows closed) restores every window. Per-host `lastPath` **remains** as the fallback for hosts opened fresh; with two windows on one host, each window record carries its own route (last-closed-wins applies only where a per-window record is absent).

### 8. `activeId` demotes to cosmetic "last focused window's host"

Per-window active host is the real state; the hosts.json `activeId` field remains for back-compat and as the first-window fallback, updated to track the last focused window's host.

### Consequential reshapes (verified against memory/source; plan decides details within these constraints)

- **`views.ts`** re-keys entries on (windowId, hostId); `webContentsId` resolution stays id-based; per-view badge/theme caches unchanged in shape. Keep the module electron-free with updated `node --test` coverage.
- **A window registry replaces the `mainWindow` singleton**: per-window welcome/attach routing, bounds sync, close-time lastPath + window-record capture (every live view of that window), `closed` cleanup destroying that window's views only. Pure decision logic extracted to an electron-free module with its own `node --test` suite (the established pattern — pure decision layers in modules, impure glue in `main.ts`).
- **`Hosts → Remove`** destroys that host's views across ALL windows; a window left with no attachable host falls to first-remaining-host or welcome.
- **Titlebar strip / overlay / fallback-CSS wiring** is already per-view or per-webContents; the overlay paint and `switchPaint` become per-window (each window paints its own attached view's cache). `applyOverlayColor` takes the window.
- **Last-path capture** keys on the view's host id as today; the origin-equality guard and dev-sentinel behavior unchanged.
- **Welcome pages render per-window** in each window's own webContents; the blank-underlay trick stays per-window; `isWelcomeSender` gating extends to any window's own webContents.
- **Unchanged (already app-level/shape-agnostic)**: the window-open deny policy, navigation guard, permission handler, and IPC sender gating.
- **`RK_DESKTOP_URL` dev sentinel**: single dev view in the first window; New Window under the sentinel duplicates it (plan may simplify — decide and record; see Assumptions #11).
- Existing electron-free test suites **extend rather than fork**; packaging/build untouched.

### Out of scope

- The ⌘N/⇧⌘T/⇧⌘W keymap + "tab" copy sweep and the SPA-side ⌘\` system-claim row (separate drafted follow-up change).
- ⌘-click "open host in new window" affordances in the SPA host-switcher (later phase).
- Cross-window view **moving** — views never migrate between windows.
- Any renderer/SPA code change (this change is app/desktop only — the `shell:new-window` channel is exposed but unconsumed).

### Tests

- Extend `hosts.test.ts` / `views.test.ts` patterns; new `windows`-store suite; window-registry pure-logic extraction with its own `node --test` suite.
- Manual-verify items (real hardware): ⌘\` window cycling, second-instance behavior.

## Affected Memory

- `run-kit/desktop-shell`: (modify) — the single-window claims throughout: view registry re-keyed on (window, host), the window registry replacing `mainWindow`, the new `windows.json` store, badge scope superseding the per-active-host non-goal, per-window menu/overlay/welcome behavior, single-instance lock, window titles + mac Window menu list, `activeId` demotion, `shell:new-window` bridge addition.

## Impact

- **`app/desktop/src/main.ts`** — the largest surface: single-instance lock, window registry glue, second-instance handler, per-window attach/welcome/underlay routing, focus-driven menu rebuilds, badge aggregation paint, close-time capture, `shell:new-window` IPC handler.
- **`app/desktop/src/views.ts` + `views.test.ts`** — (window, host) re-key of every registry operation; `switchPaint` per-window.
- **New `app/desktop/src/windows.ts` (store) + `windows.test.ts`** — the windows.json store.
- **New window-registry pure-logic module + `node --test` suite** (name plan-decided; must not collide conceptually with the store module).
- **`app/desktop/src/menu.ts`** — New Window items, mac Window-menu per-window list section, focused-window routing of Hosts callbacks.
- **`app/desktop/src/badge.ts`** — unchanged in shape (aggregation is a caller-side sum); **`hosts.ts`** — `activeId` semantics demote (write pattern changes in main, store shape untouched); **`preload.ts`** — `shell:new-window` invoker.
- No SPA changes, no packaging/build changes, no backend changes.

## Open Questions

- None asked (`promptless-defer`). The design discussion resolved all decision points; the two explicitly plan-delegated choices are recorded as Confident assumptions (#10, #11).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One process, many windows: `requestSingleInstanceLock`; `second-instance` opens a new window in the existing process | User-decided FINAL contract point 1 | S:95 R:70 A:85 D:95 |
| 2 | Certain | New Window duplicates the current window (same host, same route, fresh independent view); welcome when no hosts; menu item accelerator-less; `shell:new-window` bridge channel + IPC handler added but unconsumed | User-decided FINAL contract point 2, including the SHOULD on the bridge channel | S:95 R:75 A:85 D:95 |
| 3 | Certain | View key becomes (windowId, hostId); same host in N windows allowed, uncapped; views never migrate between windows | User-decided FINAL contract point 3 + out-of-scope note | S:95 R:65 A:85 D:95 |
| 4 | Certain | Host-switch accelerators and Hosts-menu callbacks act on the focused window; menu rebuilds on focus change where rendered state depends on the focused window's active host | User-decided FINAL contract point 4 | S:90 R:70 A:85 D:90 |
| 5 | Certain | Window switching stays OS-native (no new shortcuts); titles = active host name + route leaf; mac Window menu keeps the custom template and gains a manual per-window list rebuilt on open/close/focus/title changes | User-decided FINAL contract point 5; preserves the recorded no-`role:'windowMenu'` decision | S:90 R:80 A:85 D:90 |
| 6 | Certain | Badge = sum of waiting counts across DISTINCT hosts active in any open window (a host shown twice counts once); recomputes on cache change, window open/close, host switch | User-decided FINAL contract point 6 — deliberately supersedes the recorded single-host non-goal, which the memory itself scopes to the single-window model | S:95 R:80 A:85 D:95 |
| 7 | Certain | New `windows.json` beside hosts.json persisting per-window {active host id, current route, bounds}; atomic write, corrupt→empty, electron-free + directory-parameterized with `node --test` suite; relaunch and mac dock-reopen restore every window; `lastPath` stays as fresh-open fallback | User-decided FINAL contract point 7, including the do-not-touch-hosts.json discipline | S:95 R:70 A:90 D:95 |
| 8 | Certain | `activeId` demotes to cosmetic last-focused-window's-host; field kept for back-compat and first-window fallback | User-decided FINAL contract point 8 | S:90 R:75 A:85 D:90 |
| 9 | Certain | Window-registry pure logic extracted to an electron-free module with its own `node --test` suite; existing suites extend rather than fork; packaging untouched | User-stated in the Tests/reshapes sections; matches the package's established seven-module pattern | S:90 R:80 A:90 D:90 |
| 10 | Confident | win32 overlay: paint the aggregate on EVERY open window's taskbar button (not just the focused one) | User delegated to plan ("plan decides whether the overlay paints on every window or the focused one"); `setOverlayIcon` is per-window and each taskbar entry should signal — plan confirms or flips, trivially reversible | S:60 R:90 A:80 D:70 |
| 11 | Confident | `RK_DESKTOP_URL` dev sentinel: first window gets the single dev view; New Window under the sentinel duplicates it as an independent sentinel-scoped view — plan may simplify (e.g. sentinel stays single-window) and must record the decision | User delegated: "plan may simplify — decide and record"; dev-only, low-stakes | S:65 R:90 A:75 D:65 |
| 12 | Confident | Title route leaf = last non-empty path segment of the current route (`/utils2/rk-dev` → `rk-dev`, `/utils2` → `utils2`); bare origin → host name alone; welcome window → plain product name | The user's example `studio-mac — utils2` shows host + leaf; leaf derivation is the one obvious reading and is cosmetic/reversible | S:65 R:90 A:80 D:70 |
| 13 | Confident | windows.json carries its own `version: 1` field and an ordered array of window records; schema details (record field names, focus restoration order) are plan-decided within the contract's {active host id, current route, bounds} triple | Contract fixes the record contents; the envelope follows the hosts.json v1 precedent | S:65 R:85 A:80 D:70 |
| 14 | Confident | `second-instance` uses the same duplicate-of-current-window semantics as the menu item (focused window as source; welcome/restore when no window is open) | Contract says "opens a new window" without qualifying; reusing the one new-window function is the single-seam pattern the package already follows (`switchToHost` precedent) | S:65 R:85 A:80 D:70 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
