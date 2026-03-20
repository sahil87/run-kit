# Tasks: PWA Compliance

**Change**: 260320-j9a2-pwa-compliance
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Install `vite-plugin-pwa` as devDependency — run `pnpm add -D vite-plugin-pwa` in `app/frontend/`
- [x] T002 [P] Create `app/frontend/public/icons/` directory and generate PWA icons (icon-192.png, icon-512.png, icon-512-maskable.png) from `app/frontend/public/logo.svg`

## Phase 2: Core Implementation

- [x] T003 Configure VitePWA plugin in `app/frontend/vite.config.ts` — add import, manifest config (name, display, icons, colors), workbox config (navigateFallback, NetworkOnly for /api/ and /relay/)
- [x] T004 [P] Add PWA meta tags to `app/frontend/index.html` — theme-color, apple-mobile-web-app-capable, apple-mobile-web-app-status-bar-style, apple-touch-icon
- [x] T005 [P] Update blocking theme script in `app/frontend/index.html` to set initial theme-color meta tag alongside data-theme attribute
- [x] T006 Update `applyTheme()` in `app/frontend/src/contexts/theme-context.tsx` to update theme-color meta tag on runtime theme switches

## Phase 3: Integration & Edge Cases

- [x] T007 Verify production build generates service worker and manifest — run `pnpm build` in `app/frontend/`, confirm `sw.js` and `manifest.webmanifest` in `dist/`
- [x] T008 Write unit tests for theme-color synchronization in `app/frontend/src/contexts/theme-context.test.tsx`

---

## Execution Order

- T001 blocks T003 (plugin must be installed before configuring)
- T002 is independent (icons can be created in parallel with T001)
- T004, T005 are independent of T001 (HTML changes, no plugin dependency)
- T006 depends on nothing (modifying existing TypeScript)
- T007 depends on T001-T006 (needs complete setup for build verification)
- T008 depends on T006 (tests the theme-color sync logic)
