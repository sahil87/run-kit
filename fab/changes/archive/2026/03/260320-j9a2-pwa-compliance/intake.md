# Intake: PWA Compliance

**Change**: 260320-j9a2-pwa-compliance
**Created**: 2026-03-20
**Status**: Draft

## Origin

> Make the run-kit web app PWA compliant so it can be added to homescreen with standalone display mode (no address bar/top bar), fast cached loads, and a polished app-like experience.

Conversational `/fab-discuss` session preceded this intake. Key decisions were made collaboratively:

1. **Plugin choice**: Use `vite-plugin-pwa` with `registerType: 'autoUpdate'` — simplest path for a Vite SPA, avoids hand-rolling a service worker
2. **Caching strategy**: Cache-first for static assets (HTML/JS/CSS), network-only for `/api/` and WebSocket — aligns with the constitution's "state derived at request time" principle
3. **Manifest generation**: From plugin config (no separate JSON file to maintain)
4. **iOS meta tags**: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `theme-color`
5. **Icons**: Basic set (192x192, 512x512, maskable variants) — placeholder initially
6. **Offline behavior**: Cached app shell with connection status indicator — no meaningful offline mode (terminal relay)
7. **Service worker updates**: Auto-update on new deploys via `registerType: 'autoUpdate'`

## Why

run-kit is a web-based agent orchestration dashboard frequently accessed from mobile devices and desktop browsers. Currently, accessing it means:

1. **Wasted screen space** — the browser address bar and toolbar consume ~15% of vertical screen real estate on mobile, which is precious for a terminal-centric UI
2. **No homescreen presence** — users must navigate through bookmarks or type the URL each time
3. **Slower repeat visits** — every page load fetches all static assets from the network, even though the app shell rarely changes

Making the app PWA-compliant gives us:
- **Standalone display mode** — full-screen experience without browser chrome
- **Homescreen icon** — one-tap access, feels native
- **Cached app shell** — instant repeat loads for the static assets; only WebSocket/SSE connections need the network
- **Future-proofing** — foundation for push notifications or background sync if ever needed

The alternative (doing nothing) leaves the app feeling like "just a website" rather than a tool.

## What Changes

### 1. Install `vite-plugin-pwa`

Add `vite-plugin-pwa` as a devDependency in `app/frontend/package.json`:

```bash
cd app/frontend && pnpm add -D vite-plugin-pwa
```

### 2. Configure PWA plugin in `vite.config.ts`

Add the `VitePWA` plugin to `app/frontend/vite.config.ts` with:

```typescript
import { VitePWA } from "vite-plugin-pwa";

// In plugins array:
VitePWA({
  registerType: "autoUpdate",
  manifest: {
    name: "RunKit",
    short_name: "RunKit",
    description: "Web-based agent orchestration dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    navigateFallback: "/index.html",
    runtimeCaching: [
      {
        urlPattern: /^https?:\/\/.*\/(api|relay)\/.*/,
        handler: "NetworkOnly",
      },
    ],
  },
})
```

Key configuration choices:
- `registerType: "autoUpdate"` — service worker updates silently, no reload prompt needed
- `background_color` and `theme_color` match the dark theme (`#0a0a0a`)
- `navigateFallback` ensures SPA routing works offline (TanStack Router routes)
- `NetworkOnly` for `/api/` and `/relay/` — these are SSE and WebSocket endpoints that must always hit the server
- Static assets (JS, CSS, fonts) are precached automatically by Workbox from the Vite build output

### 3. Add PWA meta tags to `index.html`

Add to `app/frontend/index.html` `<head>`:

```html
<meta name="theme-color" content="#0a0a0a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

The `<link rel="manifest">` tag is injected automatically by `vite-plugin-pwa`.

### 4. Create placeholder icons

Generate SVG-based PNG icons at:
- `app/frontend/public/icons/icon-192.png` (192x192)
- `app/frontend/public/icons/icon-512.png` (512x512)
- `app/frontend/public/icons/icon-512-maskable.png` (512x512, with safe zone padding)
<!-- assumed: Using the existing logo.svg as the base for generated icons — it's the only brand asset in the repo -->

These can be generated from the existing `app/frontend/public/logo.svg` or created as simple placeholder icons with the RunKit branding.

### 5. Theme color synchronization

The `theme-color` meta tag should match the current theme. Since run-kit supports system/light/dark modes, the theme-color meta tag value should be:
- Dark mode: `#0a0a0a`
- Light mode: `#ffffff`
<!-- assumed: Using #0a0a0a for dark and #ffffff for light — inferred from typical dark/light patterns, actual values should match the CSS variables -->

The existing blocking theme script in `index.html` can set the initial `theme-color` meta tag alongside `data-theme`. Runtime theme switches (via the theme toggle) should also update the meta tag.

## Affected Memory

- `run-kit/architecture`: (modify) Add PWA layer: service worker, manifest, caching strategy
- `run-kit/ui-patterns`: (modify) Add PWA meta tags pattern, theme-color sync, standalone display considerations

## Impact

- **Frontend build**: Vite build output now includes a service worker (`sw.js`) and manifest (`manifest.webmanifest`) — the Go backend must serve these files (it already serves the Vite `dist/` output, so no backend changes needed)
- **New dependency**: `vite-plugin-pwa` (devDependency only, not runtime)
- **Icons directory**: New `public/icons/` directory with 3 PNG files
- **index.html**: 4 new meta/link tags in `<head>`
- **vite.config.ts**: New plugin import and configuration
- **Theme toggle**: Minor addition to update `theme-color` meta tag on theme switch
- **No backend changes**: The Go server already serves static files from the Vite build output directory

## Open Questions

- None — all key decisions were resolved during the `/fab-discuss` session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `vite-plugin-pwa` with `registerType: 'autoUpdate'` | Discussed — user agreed on simplest path for Vite SPA | S:95 R:85 A:90 D:95 |
| 2 | Certain | Cache-first for static, network-only for `/api/` and `/relay/` | Discussed — aligns with constitution's "state derived at request time" | S:95 R:80 A:95 D:90 |
| 3 | Certain | Generate manifest from plugin config, not separate JSON | Discussed — user agreed, reduces maintenance | S:90 R:90 A:85 D:90 |
| 4 | Certain | `display: "standalone"` mode | Discussed — user explicitly wants no address bar/top bar | S:95 R:90 A:90 D:95 |
| 5 | Certain | Add iOS Safari meta tags | Discussed — user agreed on full PWA compliance | S:90 R:90 A:85 D:90 |
| 6 | Certain | Auto-update service worker (no reload prompt) | Discussed — user agreed on silent updates | S:90 R:85 A:85 D:85 |
| 7 | Confident | Use existing `logo.svg` as base for icon generation | logo.svg is the only brand asset in the repo | S:70 R:90 A:75 D:80 |
| 8 | Confident | Dark theme color `#0a0a0a`, light theme color `#ffffff` | Inferred from typical patterns — actual values need CSS variable verification | S:65 R:90 A:70 D:75 |
| 9 | Confident | Theme-color meta tag updated dynamically on theme switch | Natural extension of existing theme toggle behavior | S:75 R:85 A:80 D:80 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
