# Tasks: Performance Phase 4 — Bundle & Loading

**Change**: 260327-uyj5-perf-bundle-loading
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

(No setup tasks — all changes are modifications to existing files with no new dependencies.)

## Phase 2: Core Implementation

- [x] T001 [P] Lazy-load CommandPalette, ThemeSelector, CreateSessionDialog in `app/frontend/src/app.tsx` — replace static imports with `React.lazy()` + `.then(m => ({ default: m.X }))`, add `lazy` and `Suspense` to React imports, keep `PaletteAction` as `import type`
- [x] T002 [P] Add Suspense boundaries in `app/frontend/src/app.tsx` — wrap `<CommandPalette>`, `<ThemeSelector>`, and `<CreateSessionDialog>` render sites with `<Suspense fallback={null}>`
- [x] T003 [P] Add `build.rollupOptions.output.manualChunks` to `app/frontend/vite.config.ts` — xterm chunk (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`) and router chunk (`@tanstack/react-router`)
- [x] T004 [P] Add `deduplicatedFetch` function to `app/frontend/src/api/client.ts` — module-level `Map<string, Promise<Response>>`, GET-only dedup with URL key, `.finally()` cleanup
- [x] T005 Replace `fetch` with `deduplicatedFetch` in all GET functions in `app/frontend/src/api/client.ts` — `getHealth`, `getSessions`, `getDirectories`, `getKeybindings`, `getThemePreference`

## Phase 3: Integration & Edge Cases

- [x] T006 Add deduplication tests in `app/frontend/src/api/client.test.ts` — test concurrent GET dedup (single fetch call), POST bypass (two fetch calls), cleanup after resolve, cleanup after reject, sequential calls make fresh requests
- [x] T007 Verify production build succeeds with `cd app/frontend && npx tsc --noEmit && npx vite build` — confirm separate chunk files for xterm and router appear in `dist/assets/`
- [x] T008 Run existing frontend tests with `cd app/frontend && npx vitest run` to verify no regressions

---

## Execution Order

- T001-T004 are fully parallel (different files or independent changes within same file)
- T005 depends on T004 (deduplicatedFetch must exist before replacing fetch calls)
- T006 depends on T005 (tests exercise the deduplication behavior)
- T007-T008 run after all implementation tasks complete
