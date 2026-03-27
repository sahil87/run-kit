# Intake: Performance Phase 4 — Bundle & Loading

**Change**: 260327-uyj5-perf-bundle-loading
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Performance Phase 4 — Bundle and Loading: (1) Lazy-load conditional components (CommandPalette, ThemeSelector, CreateSessionDialog) with React.lazy() + Suspense in app.tsx, (2) Add Vite manual chunks for vendor splitting (xterm family, router) in vite.config.ts, (3) Add API request deduplication via in-flight promise map in api/client.ts. See fab/plans/performance-improvements.md Phase 4 for full details.

One-shot request, following the structured performance improvement plan at `fab/plans/performance-improvements.md`. All three items are Phase 4 items (4.1, 4.2, 4.3) grouped together as they all target initial page load performance.

## Why

The frontend currently loads all JavaScript eagerly in a single main chunk. Three problems compound:

1. **Eager component loading**: `CommandPalette`, `ThemeSelector`, and `CreateSessionDialog` are imported at the top of `app.tsx` (lines 12-15) but render conditionally — CommandPalette and ThemeSelector are always mounted but only visible on user action, CreateSessionDialog renders only when `dialogs.showCreateDialog` is true. Loading their code upfront delays first paint.

2. **No vendor chunk splitting**: `vite.config.ts` has no `build.rollupOptions.output.manualChunks` configuration. The xterm family (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`) and TanStack Router are bundled into the main chunk alongside application code. Vendor code changes infrequently but invalidates the entire cache on any app code change.

3. **Duplicate API requests**: `api/client.ts` has no deduplication. Concurrent callers hitting the same endpoint (e.g., during route transitions where multiple components mount simultaneously and call `getSessions()`) each make independent HTTP requests. This wastes bandwidth and increases server load.

Without these fixes, initial page load is slower than necessary, cache invalidation is coarse-grained, and route transitions generate redundant network traffic.

## What Changes

### 4.1 Lazy-load conditional components (`app.tsx`)

Replace static imports of `CommandPalette`, `ThemeSelector`, and `CreateSessionDialog` with `React.lazy()` dynamic imports. Wrap their render sites in `<Suspense fallback={null}>`.

**Current** (lines 12-15 of `app.tsx`):
```tsx
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { ThemeSelector } from "@/components/theme-selector";
import { CreateSessionDialog } from "@/components/create-session-dialog";
```

**Target**:
```tsx
import type { PaletteAction } from "@/components/command-palette";

const CommandPalette = lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
const ThemeSelector = lazy(() => import("@/components/theme-selector").then(m => ({ default: m.ThemeSelector })));
const CreateSessionDialog = lazy(() => import("@/components/create-session-dialog").then(m => ({ default: m.CreateSessionDialog })));
```

The `PaletteAction` type import stays static (types are erased at build time). Each lazy import uses `.then(m => ({ default: m.X }))` because these are named exports, not default exports.

Render sites wrap with `<Suspense fallback={null}>`:
- `<CommandPalette>` at line 783
- `<ThemeSelector>` at line 784
- `<CreateSessionDialog>` at line 613 (already conditionally rendered)

Using `fallback={null}` because these components are overlays — showing nothing briefly is better than a loading spinner.

### 4.2 Vite manual chunks (`vite.config.ts`)

Add `build.rollupOptions.output.manualChunks` to `vite.config.ts`:

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
        router: ["@tanstack/react-router"],
      },
    },
  },
},
```

This creates two vendor chunks:
- **xterm**: The terminal rendering library and its addons (~200KB+ combined). Changes rarely.
- **router**: TanStack Router. Changes rarely.

React and ReactDOM are intentionally left in the main chunk — they're needed immediately and splitting them adds a network round-trip for no caching benefit (they change with React upgrades, which are infrequent).

### 4.3 API request deduplication (`api/client.ts`)

Add an in-flight promise map that deduplicates concurrent GET requests to the same URL:

```ts
const inFlight = new Map<string, Promise<unknown>>();

async function deduplicatedFetch(url: string, init?: RequestInit): Promise<Response> {
  // Only deduplicate GET requests (no init or method === GET)
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") return fetch(url, init);

  const key = url;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<Response>;

  const promise = fetch(url, init).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
```

All GET-based functions in the module (`getHealth`, `getSessions`, `getDirectories`, `getKeybindings`, `getThemePreference`) use `deduplicatedFetch` instead of `fetch` directly. POST/PUT functions are not deduplicated (they have side effects).

The deduplication key is the full URL string (after `withServer()` appends the server param). Promises are cleaned up in `.finally()` so subsequent calls after completion make fresh requests.

## Affected Memory

- `run-kit/architecture`: (modify) Document vendor chunk strategy and lazy-loading pattern

## Impact

- **Files changed**: `app/frontend/src/app.tsx`, `app/frontend/vite.config.ts`, `app/frontend/src/api/client.ts`
- **Tests**: `app/frontend/src/api/client.test.ts` — add tests for deduplication behavior (concurrent calls, POST bypass, cleanup after resolve/reject)
- **Build**: Bundle output changes (new chunk files). No runtime API changes.
- **Backwards compatibility**: None — purely additive optimization. No API surface changes.

## Open Questions

(None — all three items are well-specified in the performance plan with clear implementation targets.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `React.lazy()` + `Suspense` for lazy loading | React 19 supports lazy natively; the project already uses React 19. No alternative needed. | S:90 R:90 A:95 D:95 |
| 2 | Certain | Use `fallback={null}` for Suspense boundaries | Components are overlays/dialogs — no visible loading state needed. Consistent with how they're already conditionally rendered. | S:85 R:95 A:90 D:90 |
| 3 | Certain | Only deduplicate GET requests | POST/PUT requests have side effects and must execute every time. Standard pattern. | S:90 R:95 A:95 D:95 |
| 4 | Certain | Use URL string as deduplication key | `withServer()` already appends the server param, making each server-scoped URL unique. No need for a more complex key. | S:85 R:90 A:90 D:90 |
| 5 | Certain | Split xterm and router as separate vendor chunks | These are the largest vendor deps that change infrequently. Splitting improves cache hit rate. React left in main chunk (always needed immediately). | S:90 R:90 A:90 D:85 |
| 6 | Confident | Named export re-wrapping pattern for lazy imports | CommandPalette, ThemeSelector, CreateSessionDialog are named exports. `React.lazy()` requires default exports, so `.then(m => ({ default: m.X }))` is needed. | S:80 R:90 A:85 D:80 |
| 7 | Confident | PaletteAction type stays as static import | Type imports are erased at build time — no bundle impact. Needed for the `paletteActions` type annotation in AppShell. | S:80 R:95 A:85 D:85 |
| 8 | Confident | Deduplication map uses `Map<string, Promise>` | Simple, standard approach. No need for LRU cache or TTL — promises self-clean via `.finally()`. | S:75 R:85 A:80 D:75 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
