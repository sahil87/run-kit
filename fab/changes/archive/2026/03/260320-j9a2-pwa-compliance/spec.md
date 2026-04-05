# Spec: PWA Compliance

**Change**: 260320-j9a2-pwa-compliance
**Created**: 2026-03-20
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Offline functionality beyond cached app shell — run-kit is a terminal relay, meaningful offline mode is not possible
- Push notifications or background sync — no server-side push infrastructure exists
- Custom service worker logic — the `vite-plugin-pwa` generated worker is sufficient

## Frontend: PWA Manifest

### Requirement: Web App Manifest via Plugin Config

The Vite build SHALL produce a valid web app manifest (`manifest.webmanifest`) via the `vite-plugin-pwa` plugin configuration in `app/frontend/vite.config.ts`. The manifest MUST include: `name` ("RunKit"), `short_name` ("RunKit"), `description`, `start_url` ("/"), `display` ("standalone"), `background_color` ("#0f1117"), `theme_color` ("#0f1117"), and an `icons` array with at least three entries (192px, 512px, 512px maskable).

#### Scenario: Manifest is generated during build

- **GIVEN** the Vite build runs with `vite-plugin-pwa` configured
- **WHEN** the build completes
- **THEN** a `manifest.webmanifest` file EXISTS in the build output (`dist/`)
- **AND** the manifest contains `display: "standalone"` and `start_url: "/"`
- **AND** the manifest references icon paths that resolve to actual files

#### Scenario: Manifest link is injected into HTML

- **GIVEN** the Vite build runs with `vite-plugin-pwa` configured
- **WHEN** the build output `index.html` is inspected
- **THEN** a `<link rel="manifest" href="...">` tag is present in the `<head>`

## Frontend: Service Worker

### Requirement: Auto-Updating Service Worker

The `vite-plugin-pwa` plugin SHALL be configured with `registerType: "autoUpdate"`. The service worker SHALL precache all static assets from the Vite build output. The service worker SHALL update silently on new deploys without user interaction.

#### Scenario: Service worker precaches static assets

- **GIVEN** a production build is deployed with a service worker
- **WHEN** a user loads the app for the first time
- **THEN** the service worker installs and caches all static assets (JS, CSS, HTML)
- **AND** subsequent visits load cached assets without network requests for static files

#### Scenario: Service worker updates automatically

- **GIVEN** a user has a cached version of the app
- **WHEN** a new build is deployed with updated assets
- **THEN** the service worker detects the update and caches new assets
- **AND** no reload prompt or user action is required

### Requirement: Network-Only for API and WebSocket

The Workbox runtime caching configuration SHALL specify `NetworkOnly` for URL patterns matching `/api/` and `/relay/` paths. SSE streams (`/api/sessions/stream`) and WebSocket connections (`/relay/*`) MUST NOT be intercepted by the service worker.

#### Scenario: API calls bypass service worker cache

- **GIVEN** the service worker is active
- **WHEN** the app makes a `GET /api/sessions` request
- **THEN** the request goes directly to the network (not served from cache)

#### Scenario: WebSocket connections are unaffected

- **GIVEN** the service worker is active
- **WHEN** the app opens a WebSocket connection to `/relay/{session}/{window}`
- **THEN** the connection is established directly with the server

### Requirement: SPA Navigate Fallback

The Workbox configuration SHALL include `navigateFallback: "/index.html"` to ensure client-side routing works when the app shell is served from cache. Navigation requests to routes like `/{session}/{window}` SHALL fall back to `index.html`.

#### Scenario: SPA routes served from cache

- **GIVEN** the service worker is active and the app shell is cached
- **WHEN** the user navigates directly to `/{session}/{window}` (e.g., via homescreen launch)
- **THEN** the cached `index.html` is served
- **AND** TanStack Router handles the client-side route resolution

## Frontend: PWA Meta Tags

### Requirement: iOS Safari Compatibility Tags

`app/frontend/index.html` SHALL include the following meta tags in the `<head>`:
- `<meta name="theme-color" content="#0f1117" />` — initial value matching dark theme
- `<meta name="apple-mobile-web-app-capable" content="yes" />`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
- `<link rel="apple-touch-icon" href="/icons/icon-192.png" />`

#### Scenario: iOS homescreen install

- **GIVEN** a user visits run-kit in Safari on iOS
- **WHEN** the user adds the page to their homescreen via Share > Add to Home Screen
- **THEN** the app launches in standalone mode (no address bar, no Safari toolbar)
- **AND** the status bar uses `black-translucent` style (content renders behind the status bar)

#### Scenario: Theme color matches the app theme

- **GIVEN** a user opens run-kit in a mobile browser
- **WHEN** the page loads
- **THEN** the browser toolbar/status bar color matches the app's background color (`#0f1117` for dark theme)

## Frontend: Theme Color Synchronization

### Requirement: Dynamic Theme Color Updates

The `theme-color` meta tag value SHALL be updated whenever the theme changes. The blocking inline script in `index.html` SHALL set the initial theme-color alongside `data-theme`. The `ThemeProvider`'s `applyTheme` function SHALL update the meta tag at runtime.

Theme color mapping:
- Dark theme: `#0f1117` (matches `--color-bg-primary` dark)
- Light theme: `#f8f9fb` (matches `--color-bg-primary` light)

#### Scenario: Theme color set on initial load (dark)

- **GIVEN** the user's theme preference is "dark" (or "system" resolving to dark)
- **WHEN** the page loads (before React hydrates)
- **THEN** the blocking inline script sets `<meta name="theme-color" content="#0f1117">`

#### Scenario: Theme color set on initial load (light)

- **GIVEN** the user's theme preference is "light" (or "system" resolving to light)
- **WHEN** the page loads (before React hydrates)
- **THEN** the blocking inline script sets `<meta name="theme-color" content="#f8f9fb">`

#### Scenario: Theme color updates on runtime switch

- **GIVEN** the user is on the app with dark theme active
- **WHEN** the user switches to light theme via command palette or ThemeToggle
- **THEN** the `theme-color` meta tag updates to `#f8f9fb`
- **AND** the browser toolbar color changes accordingly (on supporting browsers)

## Frontend: App Icons

### Requirement: PWA Icon Set

The following icon files SHALL exist in `app/frontend/public/icons/`:
- `icon-192.png` — 192x192 pixels, standard purpose
- `icon-512.png` — 512x512 pixels, standard purpose
- `icon-512-maskable.png` — 512x512 pixels, maskable purpose (content within safe zone)

Icons SHALL use the hexagonal logo from `app/frontend/public/logo.svg` as the design basis, rendered on a dark background (`#0f1117`) for visual consistency with the app.

#### Scenario: Icons render on Android homescreen

- **GIVEN** the manifest references `/icons/icon-192.png` and `/icons/icon-512.png`
- **WHEN** a user installs the app on Android via "Add to Home Screen"
- **THEN** the 192px icon is displayed on the homescreen
- **AND** the 512px icon is used for the splash screen

#### Scenario: Maskable icon adapts to device shape

- **GIVEN** the manifest references `/icons/icon-512-maskable.png` with `purpose: "maskable"`
- **WHEN** a device applies its icon mask (circle, squircle, etc.)
- **THEN** the essential logo content remains visible within the safe zone (inner 80% of the icon)

## Frontend: Vite Plugin Installation

### Requirement: vite-plugin-pwa Dependency

`vite-plugin-pwa` SHALL be added as a devDependency in `app/frontend/package.json`. The plugin import (`import { VitePWA } from "vite-plugin-pwa"`) SHALL be added to `app/frontend/vite.config.ts` and included in the `plugins` array.

#### Scenario: Plugin is installed and configured

- **GIVEN** the developer runs `pnpm install` in `app/frontend/`
- **WHEN** `vite.config.ts` is loaded by Vite
- **THEN** the `VitePWA` plugin is registered and produces service worker + manifest during build

## Frontend: Testing

### Requirement: PWA Configuration Tests

Unit tests SHALL verify that the PWA configuration is correct. Tests SHALL cover:
- Manifest values (name, display, start_url, icons)
- Theme color synchronization logic
- Meta tag presence in `index.html`

#### Scenario: Theme color sync test

- **GIVEN** the ThemeProvider renders with dark theme
- **WHEN** the theme switches to light
- **THEN** the `theme-color` meta tag value changes from `#0f1117` to `#f8f9fb`

## Design Decisions

1. **`vite-plugin-pwa` over hand-written service worker**: Plugin auto-generates SW from build output with zero maintenance. Workbox handles precaching, versioning, and update logic. Hand-written SW would require manual cache management for every build.
   - *Rejected*: Manual service worker — maintenance burden disproportionate to the simple caching we need.

2. **`registerType: "autoUpdate"` over prompt**: For a tool like run-kit, silent updates are preferred. Users don't expect update prompts from their terminal dashboard. The alternative (prompt) adds UI complexity for negligible benefit.
   - *Rejected*: `registerType: "prompt"` — adds toast/banner UI for no user benefit.

3. **Theme color uses `--color-bg-primary` values, not hardcoded**: Dark `#0f1117` and light `#f8f9fb` match the actual CSS custom properties, ensuring the browser toolbar blends with the app seamlessly.
   - *Rejected*: Generic values like `#000000`/`#ffffff` — visible mismatch with the actual app background.

4. **Manifest in plugin config, not separate `manifest.json`**: Single source of truth in `vite.config.ts`. No risk of manifest and config drifting out of sync.
   - *Rejected*: Separate `manifest.json` in `public/` — extra file to maintain, easy to forget when changing names/colors.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `vite-plugin-pwa` with `registerType: 'autoUpdate'` | Confirmed from intake #1 — user explicitly agreed | S:95 R:85 A:90 D:95 |
| 2 | Certain | Cache-first for static, network-only for `/api/` and `/relay/` | Confirmed from intake #2 — aligns with constitution | S:95 R:80 A:95 D:90 |
| 3 | Certain | Generate manifest from plugin config | Confirmed from intake #3 — reduces maintenance | S:90 R:90 A:85 D:90 |
| 4 | Certain | `display: "standalone"` mode | Confirmed from intake #4 — user's primary goal | S:95 R:90 A:90 D:95 |
| 5 | Certain | Add iOS Safari meta tags | Confirmed from intake #5 — full PWA compliance | S:90 R:90 A:85 D:90 |
| 6 | Certain | Auto-update service worker silently | Confirmed from intake #6 — no reload prompt | S:90 R:85 A:85 D:85 |
| 7 | Certain | Use existing `logo.svg` as icon basis | Upgraded from intake Confident #7 — verified: logo.svg exists as hexagonal design, only brand asset | S:90 R:90 A:90 D:90 |
| 8 | Certain | Dark `#0f1117`, light `#f8f9fb` for theme-color | Upgraded from intake Confident #8 — verified against actual CSS vars in globals.css | S:95 R:90 A:95 D:95 |
| 9 | Certain | Theme-color meta tag updated dynamically on theme switch | Upgraded from intake Confident #9 — `applyTheme()` in ThemeProvider is the natural hook point | S:85 R:90 A:90 D:90 |
| 10 | Certain | `black-translucent` for apple-mobile-web-app-status-bar-style | Standard choice for dark-themed apps with fullbleed layout | S:85 R:90 A:85 D:90 |
| 11 | Certain | SPA navigateFallback to index.html | Required for TanStack Router client-side routes to work from cache | S:90 R:90 A:95 D:95 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
