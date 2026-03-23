# Intake: Add PWA Manifest for Install-as-App

**Change**: 260323-ubj4-add-pwa-manifest
**Created**: 2026-03-23
**Status**: Draft

## Origin

> User asked whether the tmux server preference is stored in localStorage (it is, via `runkit-server` key with `?server=` URL param override). They wanted to "Install Page as App" in Chrome/Safari with each installed app targeting a specific server. The `?server=` mechanism already supports this — the browser preserves the full URL at install time — but Chrome requires a web app manifest to offer the install prompt.
>
> A previous PR (#59, commit `7186983`) added full PWA support via `vite-plugin-pwa`, but it was reverted the next day (commit `75034a1`) because the service worker cached stale assets with no offline benefit (the app needs live tmux connections). The revert removed the manifest and meta tags along with the service worker. The icons (`public/icons/`) survived.
>
> Decision: re-add just the manifest and `<link rel="manifest">` tag — no service worker, no caching plugin.

## Why

1. **Problem**: Chrome and Safari won't offer "Install Page as App" / "Add to Home Screen" without a valid web app manifest. Users who want dedicated per-server app windows (one installed app per `?server=` value) can't create them.
2. **Consequence without fix**: Users must use regular browser tabs, losing standalone window mode and per-server separation.
3. **Approach**: A static `manifest.json` in `public/` with `display: "standalone"` is the minimal requirement. No build plugin needed — Vite serves static files from `public/` as-is. The previous approach (`vite-plugin-pwa`) was over-engineered for this use case; the service worker caused more harm than good.

## What Changes

### `app/frontend/public/manifest.json` (new file)

Static web app manifest with:
- `name` / `short_name`: "RunKit"
- `display`: "standalone" — opens in its own window, no browser chrome
- `start_url`: "/" — neutral so the browser uses the actual URL at install time, preserving any `?server=` query param
- `theme_color` / `background_color`: `#0f1117` (dark theme default, matching existing `<meta name="theme-color">`)
- `icons`: references the three existing icons in `public/icons/` (192px, 512px, 512px maskable)

### `app/frontend/index.html` (modify)

Add `<link rel="manifest" href="/manifest.json" />` after the existing `<link rel="apple-touch-icon">` tag. This is the only HTML change needed — the apple-touch-icon and theme-color meta tags are already present from the previous PWA work.

## Affected Memory

- `run-kit/architecture`: (modify) Note that the app includes a PWA manifest for install-as-app support (no service worker)

## Impact

- **Frontend only** — no backend changes
- **Two files**: one new (`manifest.json`), one modified (`index.html`)
- **No new dependencies** — no `vite-plugin-pwa`, no build config changes
- **Icons already exist** in `public/icons/` from the previous PWA PR

## Open Questions

None — scope is fully defined by the conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | No service worker or caching | Discussed — user explicitly removed vite-plugin-pwa due to stale asset caching with no offline benefit | S:95 R:90 A:95 D:95 |
| 2 | Certain | Use existing icons from public/icons/ | Icons survived the revert and are already in place | S:90 R:95 A:95 D:95 |
| 3 | Certain | start_url is "/" not a specific server URL | Discussed — browser uses actual URL at install time, preserving ?server= param | S:90 R:85 A:90 D:90 |
| 4 | Certain | Dark theme colors (#0f1117) for manifest | Matches existing theme-color meta tag already in index.html | S:85 R:95 A:90 D:95 |
| 5 | Confident | No iOS apple-mobile-web-app-capable meta tag needed | Previous revert explicitly removed it; apple-touch-icon already present for home screen icon | S:70 R:85 A:70 D:75 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
