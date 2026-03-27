# Spec: Performance Phase 4 — Bundle & Loading

**Change**: 260327-uyj5-perf-bundle-loading
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- SSR or server-side rendering — this is a client-only SPA
- Lazy-loading components that are always visible on initial render (TopBar, Sidebar, BottomBar, Dashboard)
- React/ReactDOM chunk splitting — they're needed immediately on every page load
- Caching or TTL for deduplicated requests — deduplication is purely in-flight, not a cache layer

## Frontend: Lazy-Loaded Components

### Requirement: Conditional components SHALL be lazy-loaded

The `CommandPalette`, `ThemeSelector`, and `CreateSessionDialog` components in `app/frontend/src/app.tsx` SHALL be loaded via `React.lazy()` with dynamic `import()` instead of static imports. Each lazy declaration SHALL use `.then(m => ({ default: m.ComponentName }))` to re-wrap the named export as a default export.

The `PaletteAction` type import SHALL remain a static `import type` statement (type-only imports are erased at build time).

#### Scenario: Initial page load without interaction
- **GIVEN** the application loads in a browser
- **WHEN** the main bundle is parsed and executed
- **THEN** the code for `CommandPalette`, `ThemeSelector`, and `CreateSessionDialog` SHALL NOT be included in the main chunk
- **AND** separate chunk files for these components SHALL exist in the build output

#### Scenario: User opens the command palette
- **GIVEN** the application has loaded
- **WHEN** the user triggers the command palette (Cmd+K)
- **THEN** the `CommandPalette` chunk SHALL be loaded on demand
- **AND** the component SHALL render normally once loaded

#### Scenario: User opens the create session dialog
- **GIVEN** the application has loaded and `dialogs.showCreateDialog` becomes true
- **WHEN** `CreateSessionDialog` is rendered for the first time
- **THEN** the component chunk SHALL be loaded on demand
- **AND** the dialog SHALL render normally once loaded

### Requirement: Suspense boundaries SHALL use null fallback

Each lazy-loaded component render site SHALL be wrapped in `<Suspense fallback={null}>`. This applies to:
- `<CommandPalette>` (always mounted, visible on trigger)
- `<ThemeSelector>` (always mounted, visible on trigger)
- `<CreateSessionDialog>` (conditionally mounted)

#### Scenario: Component loading in progress
- **GIVEN** a lazy-loaded component's chunk has not yet been fetched
- **WHEN** React attempts to render the component
- **THEN** nothing SHALL be rendered in its place (null fallback)
- **AND** the rest of the application SHALL remain interactive

## Frontend: Vite Vendor Chunk Splitting

### Requirement: xterm packages SHALL be split into a separate vendor chunk

The Vite build configuration in `app/frontend/vite.config.ts` SHALL include `build.rollupOptions.output.manualChunks` with an `xterm` entry containing `["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"]`.

#### Scenario: Production build output
- **GIVEN** the frontend is built with `vite build`
- **WHEN** the build completes
- **THEN** a separate chunk file for xterm packages SHALL exist in the `dist/assets/` output
- **AND** the main application chunk SHALL NOT contain xterm library code

#### Scenario: xterm package update
- **GIVEN** the xterm packages are updated but application code is unchanged
- **WHEN** the frontend is rebuilt
- **THEN** only the xterm vendor chunk hash SHALL change
- **AND** the main application chunk hash SHALL remain the same

### Requirement: TanStack Router SHALL be split into a separate vendor chunk

The `manualChunks` configuration SHALL include a `router` entry containing `["@tanstack/react-router"]`.

#### Scenario: Production build output
- **GIVEN** the frontend is built with `vite build`
- **WHEN** the build completes
- **THEN** a separate chunk file for TanStack Router SHALL exist in the `dist/assets/` output

## Frontend: API Request Deduplication

### Requirement: Concurrent GET requests to the same URL SHALL be deduplicated

The API client in `app/frontend/src/api/client.ts` SHALL maintain a `Map<string, Promise<Response>>` of in-flight GET requests. When a GET request is initiated for a URL that already has an in-flight promise, the existing promise SHALL be returned instead of making a new HTTP request.

#### Scenario: Two concurrent GET requests to the same endpoint
- **GIVEN** component A calls `getSessions()` and the request is in-flight
- **WHEN** component B calls `getSessions()` before component A's request resolves
- **THEN** only one HTTP request SHALL be made to the server
- **AND** both callers SHALL receive the same response

#### Scenario: Sequential GET requests to the same endpoint
- **GIVEN** a `getSessions()` call has completed (promise resolved)
- **WHEN** another `getSessions()` call is made
- **THEN** a new HTTP request SHALL be made (the previous promise was cleaned up)

#### Scenario: GET request failure with deduplication
- **GIVEN** a deduplicated GET request is in-flight
- **WHEN** the request fails (network error or non-ok status)
- **THEN** the promise SHALL be removed from the in-flight map via `.finally()`
- **AND** both callers SHALL receive the same rejection
- **AND** subsequent calls SHALL make fresh requests

### Requirement: POST and PUT requests SHALL NOT be deduplicated

Only GET requests (where `init` is undefined or `init.method` is `"GET"`) SHALL be deduplicated. Requests with any other HTTP method SHALL always result in a new `fetch()` call.

#### Scenario: Concurrent POST requests
- **GIVEN** `createSession("foo")` is called
- **WHEN** `createSession("foo")` is called again before the first completes
- **THEN** two separate HTTP POST requests SHALL be made to the server

### Requirement: Deduplication key SHALL be the full URL

The deduplication map key SHALL be the full URL string as passed to `fetch()` — after `withServer()` has appended the `?server=` parameter. This ensures requests scoped to different tmux servers are not incorrectly deduplicated.

#### Scenario: Same endpoint, different servers
- **GIVEN** server context is `"runkit"`
- **WHEN** `getSessions()` is called, producing URL `/api/sessions?server=runkit`
- **AND** a hypothetical call with server `"default"` produces `/api/sessions?server=default`
- **THEN** these SHALL be treated as separate entries in the deduplication map

## Design Decisions

1. **Named export re-wrapping for lazy imports**: `.then(m => ({ default: m.X }))`
   - *Why*: `React.lazy()` requires the dynamic import to resolve to a module with a `default` export. All three target components use named exports.
   - *Rejected*: Converting components to default exports — would change the import API for all consumers, not just the lazy-load site.

2. **Single Suspense boundary vs per-component**: Per-component `<Suspense>` boundaries
   - *Why*: Each component loads independently. A single boundary would show nothing until all three chunks load. Per-component boundaries allow each to appear as soon as its chunk arrives.
   - *Rejected*: Single `<Suspense>` wrapping all three — unnecessarily delays rendering of faster-loading components.

3. **`deduplicatedFetch` wrapper vs interceptor pattern**: Internal `deduplicatedFetch` function
   - *Why*: Simple, explicit, no global side effects. Each GET function opts in by calling `deduplicatedFetch` instead of `fetch`. Keeps the deduplication scope clear.
   - *Rejected*: Global `fetch` monkey-patching — invasive, affects all fetch calls including POST/PUT, harder to test.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `React.lazy()` + `Suspense` for lazy loading | Confirmed from intake #1 — React 19 supports lazy natively | S:90 R:90 A:95 D:95 |
| 2 | Certain | Use `fallback={null}` for Suspense boundaries | Confirmed from intake #2 — overlays need no loading indicator | S:85 R:95 A:90 D:90 |
| 3 | Certain | Only deduplicate GET requests | Confirmed from intake #3 — POST/PUT have side effects | S:90 R:95 A:95 D:95 |
| 4 | Certain | Use URL string as deduplication key | Confirmed from intake #4 — withServer() makes URLs server-unique | S:85 R:90 A:90 D:90 |
| 5 | Certain | Split xterm and router as separate vendor chunks | Confirmed from intake #5 — largest infrequent-change deps | S:90 R:90 A:90 D:85 |
| 6 | Certain | Named export re-wrapping for lazy | Upgraded from intake #6 Confident — verified all three components use named exports in source | S:85 R:90 A:90 D:85 |
| 7 | Certain | PaletteAction type stays as static import | Upgraded from intake #7 Confident — verified type-only import in source, erased at build | S:85 R:95 A:90 D:90 |
| 8 | Certain | Deduplication uses Map<string, Promise> with .finally() cleanup | Upgraded from intake #8 Confident — standard dedup pattern, no TTL needed for in-flight only | S:80 R:90 A:85 D:85 |
| 9 | Certain | Per-component Suspense boundaries | Each component is independent — single boundary would delay rendering unnecessarily. Derived from component analysis. | S:85 R:90 A:90 D:90 |
| 10 | Certain | React/ReactDOM not split into vendor chunk | React is needed on every page immediately — splitting adds latency with no cache benefit. From intake/plan. | S:90 R:85 A:90 D:90 |

10 assumptions (10 certain, 0 confident, 0 tentative, 0 unresolved).
