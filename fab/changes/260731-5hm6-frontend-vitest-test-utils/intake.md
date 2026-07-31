# Intake: Frontend Vitest Test-Utils Module

**Change**: 260731-5hm6-frontend-vitest-test-utils
**Created**: 2026-07-31

## Origin

Backlog item `[5hm6]` (one-shot invocation via `/fab-new 5hm6`; no prior conversation):

> Consolidate frontend vitest scaffolding into a shared test-utils module (dedupe sweep 2026-07-31, clusters 6+7; tests-only). (6) FIXTURE BUILDERS: 9 near-identical spread-override factories across 6+ files in app/frontend/src — makeWindow x5 (components/status-dot.test.tsx:12, components/status-dot-tip.test.tsx:21, components/pr-status-model.test.ts:15, components/sidebar/window-row.test.tsx:33 (requires windowId+index overrides), components/sidebar/status-panel.test.tsx:61 + makeWindowWithPanes :268, store/window-store.test.ts:7), makeSession (components/sidebar/session-row.test.tsx:13), session() (lib/waiting.test.ts:18), baseSessions const (contexts/optimistic-context.test.tsx:56). All build WindowInfo/ProjectSession via {defaults, ...overrides}; defaults differ trivially (name "win" vs "zsh", worktreePath "/p" vs "/home/user") — pick one canonical default set, keep Partial-spread overrides. (7) MATCHMEDIA STUB: 11 stub definitions — 10x vi.stubGlobal("matchMedia", vi.fn().mockImplementation(...)) (e.g. components/sidebar/server-panel.test.tsx:10, components/top-bar.test.tsx:112+1265, components/sidebar/index.test.tsx:68) + 1x Object.defineProperty(window,"matchMedia") (components/tip.test.tsx:23); only the matches predicate varies (query.includes("prefers-color-scheme: dark") vs always-false) → stubMatchMedia(predicate?) helper in the same module. Canonical home: no src/test-utils exists yet — check vitest config setupFiles for the conventional spot, else create app/frontend/src/test-utils/ (fixtures.ts + match-media.ts) and import per-test (do NOT auto-install the matchMedia stub globally; some tests assert real behavior). GOTCHA: grep-based sweeps silently skip src/components/session-tiles.tsx (deliberate NUL byte ~line 63) — use grep -a when hunting further members. Verify: just test-frontend. Small overlap with the useMediaQuery-hook backlog item at server-panel.test.tsx — coordinate or sequence.

Intake-time verification (2026-07-31) confirmed the sweep: no `app/frontend/src/test-utils/` exists; `vitest.config.ts` `setupFiles` points at `src/test-setup.ts`, which only auto-installs unconditional environment polyfills (ResizeObserver, `document.fonts`) — not a home for opt-in helpers. The listed fixture-builder and predicate-style matchMedia sites were spot-checked and exist as described. One scope refinement was discovered: a second, out-of-scope family of matchMedia stubs exists (see Non-Goals note under What Changes).

## Why

1. **The pain point**: 9 near-identical fixture factories (`makeWindow` ×5, `makeSession`, `session()`, `baseSessions`, `makeWindowWithPanes`) and ~11 predicate-style matchMedia stub definitions are copy-pasted across `app/frontend/src` test files. Every new component test that touches `WindowInfo`/`ProjectSession` or renders anything media-query-aware copies another ~15–30 lines of boilerplate.

2. **The consequence if unfixed**: the factories drift — they already differ in trivial defaults (`name: "win"` vs `"zsh"`, `worktreePath: "/p"` vs `"/home/user"`), and when `WindowInfo` gains a required field, 6+ files need the same mechanical edit instead of one. The matchMedia stubs similarly re-derive the same MQL-shaped object literal per file, and a shape mistake (missing `addEventListener`) surfaces as a confusing per-file test failure.

3. **Why this approach**: a shared, *imported-per-test* module (not a global setup install) preserves each test file's explicit control over its environment — some tests deliberately assert real/absent matchMedia behavior (e.g. `tip.test.tsx` deletes `window.matchMedia` to restore jsdom's default), so auto-installing the stub globally in `test-setup.ts` would silently change what those tests prove. Import-per-test is also the smallest possible blast radius: pure test-code moves, zero production-code edits.

## What Changes

### New module: `app/frontend/src/test-utils/`

Two files, imported explicitly by test files (NOT registered in `vitest.config.ts` `setupFiles`):

**`fixtures.ts`** — canonical spread-override factories for the two dominant fixture types:

```ts
export function makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return { /* one canonical default set */, ...overrides };
}

export function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return { /* canonical defaults, windows built via makeWindow */, ...overrides };
}
```

- One canonical default set is chosen (defaults across the 9 existing factories differ only trivially); callers that care about a field pass it as an override.
- The two call sites whose local factory *requires* `windowId` + `index` overrides (`sidebar/window-row.test.tsx:33`, `store/window-store.test.ts:7`) migrate by passing those fields explicitly at each call — a single all-optional `makeWindow` signature is kept (no second required-overrides variant).
- `makeWindowWithPanes` (`sidebar/status-panel.test.tsx:268`) moves into `fixtures.ts` as well, composed on top of `makeWindow`.
- `baseSessions` (`contexts/optimistic-context.test.tsx:56`) and `session()` (`lib/waiting.test.ts:18`) are rebuilt at their call sites on top of `makeSession`/`makeWindow` (a local `const baseSessions = [makeSession({...}), ...]` remains fine — the shared module owns the *factories*, not every literal).

**`match-media.ts`** — one stub helper for the predicate-style family:

```ts
/** Install a matchMedia stub; `matches` is decided per-query by the predicate (default: always false). Returns the mock for per-test customization. */
export function stubMatchMedia(predicate: (query: string) => boolean = () => false) { ... }
```

- Wraps the existing `vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({ matches: predicate(query), media: query, addEventListener: ..., removeEventListener: ..., ... })))` shape — the full MQL-ish object literal lives in one place.
- Migrates the ~11 predicate-style definitions the sweep counted: the `mockImplementation((query) => ...)` sites (e.g. `sidebar/server-panel.test.tsx:10`, `top-bar.test.tsx:112` + `:1265`, `sidebar/index.test.tsx:68`) plus the one `Object.defineProperty(window, "matchMedia", ...)` site (`tip.test.tsx:23`). `tip.test.tsx`'s deliberate cleanup semantics (it `delete`s `window.matchMedia` in `beforeEach` to restore jsdom's default) must be preserved — the helper (or a documented companion) must support that restore path, verified during apply.

### Migration of existing test files

Each listed duplicate site is replaced by an import from `@/…/test-utils` (path form per existing project import conventions). Tests-only: no file under `app/frontend/src` production code is touched, and no test *assertions* change — this is a pure scaffolding dedupe. Behavior gate: `just test-frontend` passes before and after with the same test count.

### Explicit Non-Goals

- **The `mockReturnValue(mql)` matchMedia family stays as-is.** Intake-time verification found a second stub family the sweep's cluster 7 did not include: sites that build a *controllable* MQL object and stub via `vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql))` (`hooks/use-coarse-pointer.test.ts` ×6, `contexts/theme-context.test.tsx:52`, `theme-selector.test.tsx:31`, `swatch-popover.test.tsx:44`, `terminal-client.test.tsx` ×4, `sidebar.test.tsx:60`, `sidebar/index.test.tsx` `makeMatchMedia` at `:395`/`:402`). These tests drive real media-query behavior (change events, listener bookkeeping) — a different shape than the fire-and-forget predicate stub. They are out of scope; consolidating them is a possible follow-up backlog item.
- **No global auto-install** of any stub via `setupFiles` (per the backlog's explicit instruction — some tests assert real behavior).
- **No production-code extraction** — the `useMediaQuery` hook consolidation is the separate `[tfr1]` backlog item.

### Coordination note

`[tfr1]` (useMediaQuery hook extraction) shares one file at the margin: `src/components/sidebar/server-panel.test.tsx`. Per the backlog, whichever change lands second rebases that file; no sequencing dependency otherwise.

### Sweep gotcha for apply

When hunting for further duplicate members, plain `grep` silently skips `src/components/session-tiles.tsx` (deliberate NUL byte ~line 63) — use `grep -a` (or perl) for any exhaustiveness re-sweep.

## Affected Memory

None — tests-only scaffolding consolidation; no spec-level or system behavior changes. (`run-kit/ui-patterns` documents production UI behavior, which this change does not touch.)

## Impact

- **Scope**: `app/frontend/src` only; tests-only. 1 new directory (`src/test-utils/` with `fixtures.ts` + `match-media.ts`), ~10–14 existing `*.test.ts(x)` files edited to import the shared helpers and delete their local copies.
- **Production code**: zero files touched.
- **Type surface**: helpers type against existing `WindowInfo` / `ProjectSession` types (imported from their current homes); `npx tsc --noEmit` in `app/frontend` must stay green.
- **Verification**: `just test-frontend` (never raw `pnpm test` — per project testing conventions); same pass count before/after.
- **Risk**: low — every edit is mechanically reversible per-file; the main hazard is subtly changing a fixture default a test implicitly relied on (mitigated by running the frontend suite after each file group).

## Open Questions

None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Canonical home is a new `app/frontend/src/test-utils/` (`fixtures.ts` + `match-media.ts`), imported per-test — not registered in `setupFiles` | Backlog decides this explicitly; verified no existing module and that `test-setup.ts` is unconditional-polyfill-only (wrong home for opt-in stubs) | S:90 R:85 A:95 D:90 |
| 2 | Certain | Verification gate is `just test-frontend` + `tsc --noEmit`; tests must pass with unchanged counts | Backlog names the command; project context mandates `just` recipes over raw test runners | S:85 R:95 A:100 D:95 |
| 3 | Confident | Scope the matchMedia helper to the ~11 predicate-style sites only; the `mockReturnValue(mql)` controllable-MQL family (use-coarse-pointer, theme-context, terminal-client, etc.) stays as-is | Sweep's cluster 7 counted exactly the predicate family; the mql family asserts real event-driven behavior — a different shape, better as a follow-up | S:80 R:85 A:80 D:70 |
| 4 | Confident | Single all-optional `makeWindow(overrides: Partial<WindowInfo>)` signature; the two sites requiring `windowId`+`index` pass them explicitly per call | Simplest unified API; test-only and trivially reversible if a required-overrides variant proves nicer during apply | S:70 R:90 A:85 D:65 |
| 5 | Confident | One canonical fixture default set (exact values picked during apply from the existing factories); all differing call-site expectations handled via explicit overrides | Backlog states defaults differ only trivially; any choice works since every caller spread-overrides what it asserts on | S:70 R:90 A:80 D:65 |
| 6 | Confident | `tip.test.tsx`'s defineProperty/delete-restore semantics are preserved through migration (helper supports the restore path) rather than dropped | The file's comment documents the cleanup as deliberate; preserving it keeps what those tests prove unchanged | S:75 R:85 A:80 D:70 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
