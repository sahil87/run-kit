# Plan: Frontend Vitest Test-Utils Module

**Change**: 260731-5hm6-frontend-vitest-test-utils
**Intake**: `intake.md`

## Requirements

### Frontend Tests: Shared Fixture Factories

#### R1: Canonical fixture module
A new `app/frontend/src/test-utils/fixtures.ts` MUST export spread-override factories `makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo`, `makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession`, and `makeWindowWithPanes(overrides: Partial<WindowInfo> = {}): WindowInfo` (composed on `makeWindow`), typed against the existing `@/types` definitions. One canonical default set is used: `{ windowId: "@0", index: 0, name: "zsh", worktreePath: "/home/user", activity: "idle", isActiveWindow: false, activityTimestamp: 0 }` for windows; `{ name: "alpha", windows: [makeWindow()] }` for sessions; `makeWindowWithPanes` defaults `worktreePath: "/home/user/code/run-kit"` with one active pane `{ paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true, gitBranch: "main" }` (the values its existing assertions depend on). The module MUST NOT be registered in `vitest.config.ts` `setupFiles`.

- **GIVEN** a test needing a `WindowInfo`
- **WHEN** it calls `makeWindow({ fabChange: "x" })`
- **THEN** it receives a fully-typed `WindowInfo` with canonical defaults and the override applied

#### R2: Fixture call-site migration
The 9 duplicate factory sites MUST migrate to the shared module with test assertions unchanged: local `makeWindow` deleted from `components/status-dot.test.tsx`, `components/status-dot-tip.test.tsx`, `components/pr-status-model.test.ts`, `components/sidebar/window-row.test.tsx`, `components/sidebar/status-panel.test.tsx`, `store/window-store.test.ts`; local `makeWindowWithPanes` deleted from `status-panel.test.tsx`; local `makeSession` deleted from `components/sidebar/session-row.test.tsx`; `lib/waiting.test.ts` `win()`/`session()` and `contexts/optimistic-context.test.tsx` `baseSessions` rebuilt as thin locals on top of the shared factories. Call sites whose local factory required `windowId`+`index` (`window-row.test.tsx`, `window-store.test.ts`) keep passing those fields explicitly per call — the single all-optional signature is kept. Any test that implicitly relied on a non-canonical local default (e.g. `worktreePath: "/tmp"`) passes that value as an explicit override rather than changing the assertion.

- **GIVEN** the migrated test files
- **WHEN** `just test-frontend` runs
- **THEN** the same 114 files / 2039 tests pass as before migration
- **AND** no local `{...defaults, ...overrides}` `WindowInfo`/`ProjectSession` factory definition remains in the 9 listed files

### Frontend Tests: matchMedia Stub Helper

#### R3: stubMatchMedia helper
A new `app/frontend/src/test-utils/match-media.ts` MUST export `stubMatchMedia(predicate: (query: string) => boolean = () => false)` that installs a matchMedia stub via `vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => mql))` where the MQL-shaped literal (`matches: predicate(query)`, `media: query`, `onchange: null`, and `vi.fn()` stubs for `addEventListener`/`removeEventListener`/`addListener`/`removeListener`/`dispatchEvent`) lives in this one place. The helper MUST return the installed mock for per-test customization, and the installed property MUST remain deletable (`delete window.matchMedia` restores jsdom's default `undefined`) so `tip.test.tsx`'s restore path keeps working.

- **GIVEN** a jsdom test with no matchMedia
- **WHEN** it calls `stubMatchMedia((q) => q.includes("prefers-color-scheme: dark"))`
- **THEN** `window.matchMedia("(prefers-color-scheme: dark)").matches` is true and other queries are false
- **AND** a subsequent `delete window.matchMedia` restores `window.matchMedia === undefined`

#### R4: Predicate-site migration
The ~11 predicate-style stub definitions MUST migrate to `stubMatchMedia`: the module-level stubs in `components/sidebar/server-panel.test.tsx:10` and `components/sidebar/index.test.tsx:68`; the three `beforeEach` stubs in `components/top-bar.test.tsx` (`:112`, `:244`, `:1265`); the inline `beforeEach` stub in `components/host-overview-page.test.tsx:~118`; the local wrapper bodies `stubCoarsePointer()` in `components/chat-view.test.tsx`, `stubPointer(coarse)` in `components/compose-strip.test.tsx`, `mockMatchMedia(matches)` in `components/shell/shell.test.tsx`; and the `Object.defineProperty` helper `stubMatchMedia(coarse)` in `components/tip.test.tsx`. Each site's existing predicate semantics are preserved verbatim (e.g. `query !== "(pointer: coarse)"`, `query.includes("prefers-color-scheme")`). `tip.test.tsx`'s deliberate `afterEach` `delete window.matchMedia` cleanup MUST be preserved and MUST still restore jsdom's default.

- **GIVEN** the migrated matchMedia sites
- **WHEN** `just test-frontend` runs
- **THEN** all previously-passing tests still pass with the same counts
- **AND** no `mockImplementation((query...` matchMedia literal remains outside `src/test-utils/match-media.ts` (the `mockReturnValue(mql)` family excepted, plus `sidebar/index.test.tsx`'s `makeMatchMedia` — mockImplementation-shaped but explicitly enumerated as out of scope by the intake's binding Non-Goal)

#### R5: Verification gates and blast radius
The change MUST be tests-only: zero production files touched, no `vitest.config.ts`/`test-setup.ts` edits, and the `mockReturnValue(mql)` matchMedia family (use-coarse-pointer, theme-context, theme-selector, swatch-popover, terminal-client, sidebar.test.tsx, sidebar/index `makeMatchMedia`, window-row `mockMatchMedia`, and the constant-object `mockReturnValue` stubs such as `compose-strip.test.tsx:108`) left untouched. `just test-frontend` MUST pass with the same test count as the pre-change baseline (114 files / 2039 tests), and `npx tsc --noEmit` in `app/frontend` MUST stay green.

- **GIVEN** the completed change
- **WHEN** `git diff --name-only` is inspected
- **THEN** only `src/test-utils/*` (new) and `src/**/*.test.ts(x)` files appear
- **AND** `just test-frontend` reports 2039 passed and `npx tsc --noEmit` exits 0

### Non-Goals

- The `mockReturnValue(mql)` matchMedia family stays as-is (controllable-MQL shape; separate follow-up)
- No global auto-install of any stub via `setupFiles`
- No production-code extraction (`useMediaQuery` hook is backlog item `[tfr1]`)

## Tasks

### Phase 1: Setup

- [x] T001 Capture baseline: run `just test-frontend` from repo root and record file/test counts (114 files / 2039 tests, all passing — recorded 2026-07-31) <!-- R5 -->

### Phase 2: Core Implementation

- [x] T002 [P] Create `app/frontend/src/test-utils/fixtures.ts` with `makeWindow`, `makeSession`, `makeWindowWithPanes` per the canonical default set, typed against `@/types` <!-- R1 -->
- [x] T003 [P] Create `app/frontend/src/test-utils/match-media.ts` with `stubMatchMedia(predicate = () => false)` returning the installed mock <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] Migrate fixture sites A — `src/components/status-dot.test.tsx`, `src/components/status-dot-tip.test.tsx`, `src/components/pr-status-model.test.ts`: delete local `makeWindow`, import from `@/test-utils/fixtures`; run their suites <!-- R2 -->
- [x] T005 [P] Migrate fixture sites B — `src/components/sidebar/window-row.test.tsx`, `src/store/window-store.test.ts`, `src/components/sidebar/status-panel.test.tsx` (incl. moving `makeWindowWithPanes` usage to the shared import): delete local factories, keep explicit `windowId`/`index` (and any non-canonical default like `/tmp`) as per-call overrides; run their suites <!-- R2 -->
- [x] T006 [P] Migrate session-fixture sites — `src/components/sidebar/session-row.test.tsx` (delete local `makeSession`), `src/lib/waiting.test.ts` (rebuild `win`/`session` on shared factories), `src/contexts/optimistic-context.test.tsx` (rebuild `baseSessions` via `makeSession`/`makeWindow`); run their suites <!-- R2 -->
- [x] T007 [P] Migrate module-level matchMedia stubs — `src/components/sidebar/server-panel.test.tsx`, `src/components/sidebar/index.test.tsx` (module-level stub only; leave `makeMatchMedia` untouched); run their suites <!-- R4 -->
- [x] T008 [P] Migrate `src/components/top-bar.test.tsx` three `beforeEach` stubs (`:112` and `:1265` `query !== "(pointer: coarse)"`, `:244` `query.includes("prefers-color-scheme")`), preserving comments; run its suite <!-- R4 -->
- [x] T009 [P] Migrate wrapper-style sites — `src/components/chat-view.test.tsx` (`stubCoarsePointer`), `src/components/compose-strip.test.tsx` (`stubPointer` only; leave the `mockReturnValue` beforeEach stub), `src/components/shell/shell.test.tsx` (`mockMatchMedia` → direct `stubMatchMedia` calls), `src/components/host-overview-page.test.tsx` (inline beforeEach); run their suites <!-- R4 -->
- [x] T010 Migrate `src/components/tip.test.tsx`: replace the `Object.defineProperty` helper with the shared `stubMatchMedia`, keep the `afterEach` `delete window.matchMedia` restore + its comment; run its suite to prove the restore path still yields jsdom's default <!-- R4 -->

### Phase 4: Polish

- [x] T011 Exhaustiveness re-sweep (`grep -a`/perl per the NUL-byte gotcha) confirming no remaining predicate-style duplicates or local `WindowInfo`/`ProjectSession` factories in the listed files; then run final gates: `just test-frontend` (count equality vs T001 baseline) and `npx tsc --noEmit` in `app/frontend` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `src/test-utils/fixtures.ts` exists exporting `makeWindow`/`makeSession`/`makeWindowWithPanes` with the canonical default set, typed against `@/types`, not registered in `setupFiles` — verified: `fixtures.ts:8/22/31`, `import type { ProjectSession, WindowInfo } from "@/types"` at `:1`; `vitest.config.ts` `setupFiles` still `["./src/test-setup.ts"]` (file untouched in the diff)
- [x] A-002 R3: `src/test-utils/match-media.ts` exists exporting `stubMatchMedia` with default always-false predicate, one MQL-shaped literal, returning the mock — verified `match-media.ts:11-23`; default `() => false` proven by probe (`stubMatchMedia(); matchMedia("anything").matches === false`)
- [x] A-003 R2: all 9 listed fixture sites import the shared factories; no local spread-override `WindowInfo`/`ProjectSession` factory definitions remain in them — verified: zero `function makeWindow|makeSession|makeWindowWithPanes|makeRegisterWindow` across all 9; repo-wide only `fixtures.ts` + the out-of-scope positional `focused-pane-window.test.ts:6 win()` carry `Partial<WindowInfo>`
- [x] A-004 R4: all ~11 predicate-style matchMedia sites (incl. `tip.test.tsx`'s defineProperty variant) call `stubMatchMedia`; each site's predicate semantics preserved — 12 call sites across 8 files verified predicate-by-predicate against HEAD; the sole remaining `mockImplementation((query` outside the module is `sidebar/index.test.tsx:370` `makeMatchMedia` (binding Non-Goal, Assumption 6)

### Behavioral Correctness

- [x] A-005 R2: tests formerly relying on non-canonical local defaults pass those values as explicit overrides — no assertion text changed anywhere — verified: `optimistic-context.test.tsx:58-70` passes `worktreePath: "/tmp"`/`"/app"` explicitly; `status-panel.test.tsx:32` passes `worktreePath: cwd`; `window-store.test.ts` has zero `/tmp` reads (its old local default was unasserted); `waiting.test.ts` asserts counts only; zero assertion lines in the diff
- [x] A-006 R4: `tip.test.tsx`'s `afterEach` still `delete`s `window.matchMedia` and its suite passes (restore-to-jsdom-default path proven) — `tip.test.tsx:19` preserved; independently probed: after `stubMatchMedia(...)`, `delete window.matchMedia` yields `undefined` on both `window` and `globalThis`; no `restoreAllMocks`/`unstubAllGlobals` in the file to perturb it
- [x] A-007 R5: `just test-frontend` passes with the same counts as the pre-change baseline (114 files / 2039 tests) — re-run at review: **114 files / 2039 tests passed**, exact baseline match
- [x] A-008 R5: `npx tsc --noEmit` in `app/frontend` exits 0 — re-run at review: exit 0

### Edge Cases & Error Handling

- [x] A-009 R5: within `app/frontend/`, `git diff --name-only` shows only test files plus the new `src/test-utils/` — zero production files, no `vitest.config.ts`/`test-setup.ts` edits, `mockReturnValue(mql)` family untouched (fab pipeline bookkeeping under `fab/changes/` and the `docs/memory/` hydrate artifact sit outside this tests-only constraint) — verified: 17 modified files all `*.test.ts(x)` + 2 new `test-utils/*.ts`; `vitest.config.ts`/`test-setup.ts` show no diff; use-coarse-pointer, theme-context, theme-selector, swatch-popover, terminal-client, sidebar.test.tsx all UNTOUCHED; `window-row.test.tsx:20` `mockMatchMedia` and `compose-strip.test.tsx:98` `mockReturnValue` preserved in-place

### Code Quality

- [x] A-010 Pattern consistency: new module follows existing test-file conventions (`@/` imports, vi.fn-based stubs, doc comments) — verified: `@/types` type-only import, `vi.fn()` stubs, JSDoc on every export; all 17 migrated files import via the `@/test-utils/…` alias; no new `as` casts introduced and one pre-existing `as ProjectSession` cast retired from `session-row.test.tsx` (aligns with code-quality.md "type narrowing over type assertions")
- [x] A-011 No unnecessary duplication: no new helper duplicates an existing utility; local thin wrappers only where they encode per-file semantics (e.g. `stubPointer(coarse)`) — verified: no prior `src/test-utils`/fixture/helper module existed (`tests/msw` is unrelated network mocking); all 4 exports have live call sites (makeWindow 8, makeSession 3, makeWindowWithPanes 1, stubMatchMedia 8 importers); net **−163 lines** (113 added incl. the new module, 276 deleted)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/lib/focused-pane-window.test.ts:6` — local `win(windowId, name, extra?)` `Partial<WindowInfo>` factory; the last remaining `WindowInfo` spread-factory in `src/` outside the shared module. Positional-arg shape and a non-canonical `activityTimestamp: 100`, so not in the intake's enumerated 9 — a clean follow-up now that `makeWindow` exists.
- `app/frontend/src/components/sidebar/index.test.tsx:370` — `makeMatchMedia(mobile)` is predicate/`mockImplementation`-shaped and could collapse onto `stubMatchMedia`, but it *returns* the mock for the file's `afterEach` re-stub rather than installing it; the intake's binding Non-Goal enumerates it out of scope. Deleting it needs a `stubMatchMedia` return-the-uninstalled-mock variant — deferred with the `mockReturnValue(mql)` family.
- `app/frontend/src/components/chat-view.test.tsx:10` and `app/frontend/src/components/tip.test.tsx:23` — the two one-line `stubCoarsePointer()` wrappers are now textually identical; a shared `stubCoarsePointer(coarse = true)` export would retire both. Deliberately kept per Assumption 4 (each carries a file-specific doc comment), so this is a candidate only if that assumption is revisited.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Canonical window defaults: `name: "zsh"`, `worktreePath: "/home/user"` (the majority values across the 9 factories); `windowId: "@0"`, `index: 0` and the rest are unanimous | Intake delegates the exact pick to apply; verified no test asserts on the literal defaults `"win"`/`"/p"`/`"/tmp"` outside the factory definitions themselves | S:75 R:90 A:85 D:70 |
| 2 | Confident | `makeWindowWithPanes` keeps its original `/home/user/code/run-kit` + `%5`/`main` pane defaults as the shared defaults | It has exactly one existing definition and its tests assert those literals; changing them would change assertions | S:80 R:90 A:90 D:85 |
| 3 | Confident | Scope the predicate migration to the 10 mockImplementation-style sites + tip.test.tsx defineProperty (matching the intake's ~11 count); constant-object `mockReturnValue` stubs (e.g. `compose-strip.test.tsx:108`, settings-dialog, update-chip, host-panel, session-tiles, instance-accent, chrome-context, typed-label) stay untouched even where expressible as `stubMatchMedia()` | The intake's binding Non-Goal excludes the whole `mockReturnValue(mql)` family by shape; the sweep's cluster 7 counted only the predicate/mockImplementation family | S:80 R:85 A:85 D:75 |
| 4 | Confident | Local named wrappers (`stubCoarsePointer`, `stubPointer(coarse)`, tip's coarse-boolean helper) are kept as one-line delegates to `stubMatchMedia` rather than inlined at every call site | They encode per-file pointer semantics and carry doc comments; the shared module owns the MQL literal, which is the dedupe target | S:70 R:95 A:85 D:70 |
| 5 | Certain | tip.test.tsx migrates to `vi.stubGlobal`-based stubbing; its `delete window.matchMedia` restore keeps working because stubGlobal defines a configurable property on the jsdom global | jsdom has no matchMedia, so stubGlobal defines (configurable) rather than replaces; verified by running the tip suite as part of T010 | S:80 R:90 A:90 D:85 |
| 6 | Confident | `sidebar/index.test.tsx` `makeMatchMedia` (:369) is left untouched even though apply found it is mockImplementation/predicate-shaped (the intake classified it under the `mockReturnValue(mql)` family) | The intake's Non-Goal enumerates it out of scope by name and Non-Goals are binding; it is a behavior-identical follow-up candidate alongside the mql family | S:75 R:90 A:80 D:70 |
| 7 | Confident | A third duplicate found during apply — `makeRegisterWindow` in `status-panel.test.tsx:853`, byte-identical to `makeWindowWithPanes` — was deduped to the shared factory despite not being in the intake's enumeration | Same file, same shape, same defaults as an enumerated member; the intake's exhaustiveness re-sweep instruction covers newly-found members in listed files | S:70 R:90 A:85 D:75 |

7 assumptions (1 certain, 6 confident, 0 tentative).
