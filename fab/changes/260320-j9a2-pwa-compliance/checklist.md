# Quality Checklist: PWA Compliance

**Change**: 260320-j9a2-pwa-compliance
**Generated**: 2026-03-20
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Web App Manifest: `manifest.webmanifest` generated in build output with correct `name`, `short_name`, `display: "standalone"`, `start_url: "/"`
- [x] CHK-002 Service Worker: `sw.js` generated in build output, precaches static assets
- [x] CHK-003 Network-Only Config: `/api/` and `/relay/` URLs bypass service worker cache
- [x] CHK-004 SPA Fallback: `navigateFallback` set to `/index.html` for client-side routing
- [x] CHK-005 iOS Meta Tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` present in `index.html`
- [x] CHK-006 Theme Color Meta: `<meta name="theme-color">` present in `index.html`
- [x] CHK-007 Icon Files: `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` exist in `public/icons/`

## Behavioral Correctness
- [x] CHK-008 Theme-color sync (dark): Blocking script sets theme-color to `#0f1117` when resolved theme is dark
- [x] CHK-009 Theme-color sync (light): Blocking script sets theme-color to `#f8f9fb` when resolved theme is light
- [x] CHK-010 Theme-color runtime: `applyTheme()` updates theme-color meta tag when theme switches

## Scenario Coverage
- [x] CHK-011 Build produces manifest: `pnpm build` in `app/frontend/` generates `manifest.webmanifest` in `dist/`
- [x] CHK-012 Build produces service worker: `pnpm build` generates `sw.js` in `dist/`
- [x] CHK-013 Manifest link injected: Built `index.html` contains `<link rel="manifest">`

## Edge Cases & Error Handling
- [x] CHK-014 Missing meta tag graceful: If `theme-color` meta tag doesn't exist in DOM, `applyTheme()` does not throw

## Code Quality
- [x] CHK-015 Pattern consistency: Plugin config follows existing `vite.config.ts` patterns (import style, plugins array)
- [x] CHK-016 No unnecessary duplication: Theme color values `#0f1117`/`#f8f9fb` defined as constants or derived, not scattered as magic strings
- [x] CHK-017 Frontend type check: `npx tsc --noEmit` passes in `app/frontend/`
- [x] CHK-018 Existing tests pass: `vitest run` passes in `app/frontend/`

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
