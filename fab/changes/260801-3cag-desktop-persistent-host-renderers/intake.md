# Intake: Desktop Persistent Host Renderers

**Change**: 260801-3cag-desktop-persistent-host-renderers
**Created**: 2026-08-01

## Origin

Conversational — a `/fab-discuss` session asking: "On the electron app, how practical is it to implement instant switching between hosts. i.e. Lets say I have 3 hosts connected, then keep 3 renderers always on. The act of Cmd+Alt+1/2/3 just switches between these renderers instantly. Instead of what happens right now - the whole page loads via a fresh server request."

The discussion concluded the pattern is practical and standard (Slack's multi-workspace model), settled on `WebContentsView` (not deprecated `BrowserView`, not hidden `BrowserWindow`s, not an SPA-level multi-host rewrite), and enumerated the single-webContents assumptions in `main.ts` that need per-view routing. The user then asked to draft this as its own change:

> Create 2 intakes - for 1 and 2. Using fab-draft.

(Item 2 of the discussion's recommendation. Sibling change `260801-ujuk-spa-asset-cache-headers` fixes the bundle re-download problem independently; this change is about zero-latency switching and always-live host state.)

## Why

1. **Pain point**: `switchToHost` (`app/desktop/src/main.ts:222`) is a `loadURL` navigation — every host switch tears down the renderer and boots the SPA from scratch: full page load, WS/SSE reconnect, terminal reattach round-trip, lost xterm scrollback and scroll position. Even with cache headers fixed (sibling change), a switch still costs SPA boot + API calls + socket reattach (~300–800ms) and discards live terminal state.
2. **Consequence if unfixed**: host switching stays a context-destroying navigation rather than a workspace flip. Users running 2–4 hosts (the ⌥⌘1–9 switcher exists precisely for them) pay the reload and lose terminal state on every flip.
3. **Why this approach**: one persistent `WebContentsView` per visited host, swapped on switch, is the established Electron pattern for multi-workspace apps. It's additive to the existing security wiring (the pure policy modules — `window-open.ts`, origin allowlists, sender gating — are already per-webContents-shape-agnostic) and requires **zero SPA changes**. Alternatives rejected in discussion: hidden `BrowserWindow` per host (heavier, focus/flicker problems); SPA-level multi-host in one renderer (breaks the SPA's 100% origin-relative design — bare `fetch("/api/…")`, WS URLs from `window.location` — a rewrite, not a shell feature).

## What Changes

### View lifecycle (`app/desktop/src/main.ts` + a new electron-free module)

- One `WebContentsView` per **visited** host, created **lazily** on first switch/load (never eagerly for all registered hosts), kept alive until the host is removed or the app quits. Views are destroyed when their host entry is removed via `Hosts → Remove`.
- The window remains a `BrowserWindow`. Its own `webContents` keeps serving the welcome page (`loadFile`) when the host list is empty and under `?mode=add`; host content lives in views attached over the full window bounds (the SPA draws the 28px titlebar strip itself, so views cover the entire window — matching today's rendering exactly). Views resize with the window (`resize` handler calls `setBounds`).
- `switchToHost(id)` becomes: persist active id via the store → detach the current view, attach (or create-then-attach) the target host's view → rebuild menu. No `loadURL` on an existing view. All three existing entry points (Hosts-menu radios, ⌥⌘1–9 / ⇧Ctrl+1–9 accelerators, the SPA strip dropdown via `servers:switch`) keep routing through this one seam unchanged.
- Per-view decision logic (which view to create/destroy/attach, badge cache bookkeeping) lives in a new electron-free pure module (e.g. `src/views.ts`) with a `node --test` suite, following the `hosts.ts` / `strip.ts` / `badge.ts` pattern.

### Per-view wiring (currently single-webContents in `main.ts`)

Each assumption below currently binds to `mainWindow.webContents` and moves to per-view attach-time wiring:

1. **Security**: `will-navigate`/`will-redirect` guard (`isAllowedNavigation`), `setWindowOpenHandler` (via the existing pure `windowOpenAction`), permission handler, preload + `additionalArguments` — attached to every view's webContents at creation. IPC sender gating (`isHostsSender`/`isWelcomeSender`) already keys on sender-frame origin, so it survives multiple renderers with **no change**.
2. **Theme color / titlebar overlay**: listen for `did-change-theme-color` per view, cache the last color per view; on switch, re-apply the **incoming** view's cached color via `setTitleBarOverlay` (non-darwin; darwin returns early as today). The fallback-strip CSS injection (`shouldInjectFallbackStrip` / `fallbackStripCss`) runs per view on its `did-finish-load`.
3. **Badge**: keep today's per-active-host semantics — main caches the last `badge:set` count **per view** (keyed by webContents id, since sender origin can be shared by multiple entries), paints only the active view's cached count, and repaints on switch (0/clear when the incoming view has no cached count). Background views' reports update their cache silently. The three clear seams (switch, welcome, window `closed`) become repaint/clear operations on this cache.
4. **Last-path**: views preserve live state, so switch-time capture/restore is no longer what drives warm switching — but `lastPath` persistence stays for **cold start**: capture each view's `getURL()`-derived `pathname + search` at window `close` (and on view destroy), restore only when creating a view fresh. `findHostByOrigin`'s active-wins tiebreak keeps working for shared-origin entries.
5. **View menu items** (reload / force-reload / devtools / zoom): route to the active view's webContents (the existing `focusedWebContents()` helper on win/linux mostly covers this; verify roles on mac target the focused view, else convert to explicit items over the same helper).
6. **`RK_DESKTOP_URL` dev override**: becomes a single dev view; its origin already joins the navigation allowlist.

### Behavior changes to document (not code seams)

- **Background hosts stay live**: their WS terminal relays (tmux attach per open terminal) and `/ws/state` connections remain open while not displayed. This is the feature (instant flip, no reattach, live per-host badge caches) and the cost.
- **Memory**: each live renderer is a full Chromium process (~100–200MB with xterm canvases). No cap/eviction in v1 — host lists are small (switcher caps at 9; typical 2–4) — revisit if real usage shows pressure.

### Out of scope

- Badge **aggregation** across hosts (summing waiting counts) — deliberate follow-up; this change preserves the "window's own host" contract.
- Any SPA change (`app/frontend`) — the SPA remains shell-agnostic; `shell.ts` wrappers, strip, and badge reporter work unchanged inside views.
- Multi-window (one window per host) — different feature.

## Affected Memory

- `run-kit/desktop-shell`: (modify) major — view-per-host lifecycle replaces the single-BrowserWindow-navigation model; per-view wiring for security/theme/strip/badge/last-path; the switch seam's new semantics
- `run-kit/ui-patterns`: (modify) minor, only if badge-reporter or strip behavior notes reference the shell's single-webContents model

## Impact

- `app/desktop/src/main.ts` — the bulk of the change (view lifecycle, per-view wiring, switch seam)
- `app/desktop/src/views.ts` (+ `views.test.ts`) — new pure module
- `app/desktop/src/menu.ts` — possibly view-menu item routing; accelerator table **unchanged** (keyboard-tier seam untouched)
- No backend, no frontend changes. Electron ^43 already ships `WebContentsView`.
- Manual verification on real hardware: multi-host switch flip, theme-color overlay re-apply on non-darwin, badge repaint on switch, welcome ↔ views transitions

## Open Questions

- None blocking — the two product-policy choices (badge scope #4, view eviction #5) carry v1 defaults in the Assumptions table; revisit via `/fab-clarify` if the defaults are wrong.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `WebContentsView` per host over hidden windows or SPA multi-host | Discussed and chosen — standard multi-workspace pattern; `BrowserView` deprecated on Electron 43; SPA rewrite rejected | S:85 R:60 A:85 D:80 |
| 2 | Certain | Lazy view creation on first visit; views persist until host removal or quit | Discussed — eager creation wastes memory for never-visited hosts | S:75 R:80 A:85 D:80 |
| 3 | Confident | Keep `BrowserWindow` (welcome in window contents); views cover full window bounds | Smallest diff; SPA draws its own strip so full-bounds views reproduce today's rendering | S:60 R:70 A:80 D:70 |
| 4 | Confident | Badge stays per-active-host in v1: main-side per-view count cache, repaint on switch; no cross-host summing | Preserves today's documented contract; aggregation is a product change deferred to a follow-up — flag via /fab-clarify if summing is wanted | S:50 R:85 A:55 D:45 |
| 5 | Confident | No view cap/eviction in v1 | Host lists are small (≤9 switcher slots, typically 2–4); eviction adds policy complexity with no evidence of need yet | S:45 R:90 A:60 D:50 |
| 6 | Certain | Theme-color overlay re-applied from the incoming view's cached color on switch | Direct consequence of per-host accents + one native overlay surface | S:70 R:85 A:85 D:85 |
| 7 | Confident | `lastPath` persists at quit/view-destroy only; used only when creating a view fresh | Warm switches keep live state in the view; cold-start restore contract unchanged | S:65 R:85 A:80 D:80 |
| 8 | Certain | Security wiring attached per view; IPC sender gating unchanged | Gating is origin-based already; navigation/window-open policies are pure modules reused per view | S:75 R:80 A:90 D:85 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
