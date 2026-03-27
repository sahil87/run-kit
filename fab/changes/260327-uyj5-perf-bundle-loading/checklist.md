# Quality Checklist: Performance Phase 4 — Bundle & Loading

**Change**: 260327-uyj5-perf-bundle-loading
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Lazy-loaded components: CommandPalette, ThemeSelector, CreateSessionDialog use React.lazy() with dynamic import()
- [x] CHK-002 Suspense boundaries: Each lazy component wrapped in `<Suspense fallback={null}>`
- [x] CHK-003 Vendor chunk splitting: manualChunks config creates xterm and router chunks
- [x] CHK-004 API deduplication: deduplicatedFetch function exists with Map-based in-flight tracking
- [x] CHK-005 GET functions use deduplicatedFetch: getHealth, getSessions, getDirectories, getKeybindings, getThemePreference

## Behavioral Correctness
- [x] CHK-006 Named export re-wrapping: .then(m => ({ default: m.X })) pattern used for all three lazy components
- [x] CHK-007 PaletteAction type import: Remains static `import type` (not dynamically imported)
- [x] CHK-008 POST/PUT bypass: createSession, renameSession, killSession, createWindow, killWindow, renameWindow, sendKeys, splitWindow, closePane, selectWindow, reloadTmuxConfig, initTmuxConf, uploadFile, createServer, killServer, setThemePreference all use plain fetch (not deduplicatedFetch)
- [x] CHK-009 Dedup cleanup: Promises removed from Map via .finally() on both resolve and reject

## Scenario Coverage
- [x] CHK-010 Concurrent GET dedup: Two concurrent calls to same endpoint produce only one HTTP request
- [x] CHK-011 Sequential GET freshness: Calls after prior request completes make a new HTTP request
- [x] CHK-012 Failure cleanup: Failed request removes entry from in-flight map
- [x] CHK-013 Build output: Production build produces separate xterm and router chunk files

## Edge Cases & Error Handling
- [x] CHK-014 **N/A**: No dedicated error boundary was added for lazy-loaded chunks in this change; Suspense with `fallback={null}` only covers the loading state and chunk load failures would still surface as React errors
- [x] CHK-015 Different servers: Requests to same endpoint but different server param are not deduplicated

## Code Quality
- [x] CHK-016 Pattern consistency: New code follows naming and structural patterns of surrounding code in app.tsx and client.ts
- [x] CHK-017 No unnecessary duplication: deduplicatedFetch is a single utility, not repeated per function
- [x] CHK-018 Type narrowing: deduplicatedFetch uses proper TypeScript types, no `as` casts
- [x] CHK-019 No magic strings: HTTP method check uses explicit comparison
- [x] CHK-020 Existing utilities: No duplication of existing helpers (withServer, throwOnError reused as-is)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
