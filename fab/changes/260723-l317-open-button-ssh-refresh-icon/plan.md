# Plan: Open-Button SSH-Host Refresh + Last-Used Icon

**Change**: 260723-l317-open-button-ssh-refresh-icon
**Intake**: `intake.md`

## Requirements

### run-kit: Open-context freshness (SSH-host setting reaches deeplinks)

#### R1: Invalidatable external store for the open context
`app/frontend/src/hooks/use-open-targets.ts` SHALL convert its module-level `cached`/`pending` pair into a small invalidatable external store and SHALL export `invalidateOpenContext(): void`. Invalidation MUST clear the cached context; with mounted consumers it SHALL eagerly refetch the full bundle (`GET /api/health` + `GET /api/open-apps` — the cache holds both halves) and notify subscribers when the fresh data resolves, so mounted consumers re-render with fresh context without a reload; with zero subscribers it MUST at minimum drop the stale cache so the next `useOpenTargets(true)` mount fetches fresh. `useOpenTargets(enabled)` MUST keep its exact signature and semantics: `enabled` gates the fetch; data still returns when another consumer already populated the cache; both halves stay individually fail-silent (failing health read ⇒ `sshHost: ""`, never a thrown error). No polling and no per-render refetch may be introduced — invalidation is event-driven from the settings commit only; the once-per-page-load behavior is otherwise preserved. `resetOpenTargetsCacheForTest()` MUST be kept (or adapted). The file's doc comment MUST be updated: the context is static *between settings commits*, no longer "static per page load".

- **GIVEN** a mounted consumer (`top-bar.tsx` TopBar entry or `app.tsx` palette builder) holding a cached context with a stale `sshHost`
- **WHEN** `invalidateOpenContext()` is called
- **THEN** the bundle is refetched and the consumer re-renders with the fresh `sshHost` without a page reload

- **GIVEN** a populated cache and zero mounted consumers
- **WHEN** `invalidateOpenContext()` is called
- **THEN** the stale cache is dropped and the next `useOpenTargets(true)` mount fetches fresh data

- **GIVEN** the health read fails during a (re)fetch
- **WHEN** the bundle resolves
- **THEN** `sshHost`/`sshUser` degrade to `""` with no thrown error (fail-silent preserved)

#### R2: Settings dialog invalidates on successful SSH-host commit only
`app/frontend/src/components/settings-dialog.tsx` SHALL call `invalidateOpenContext()` in the SSH host `TextSetting` `commit` handler after `await setSSHHost(...)` succeeds. A rejected `setSSHHost` MUST NOT invalidate (the commit failed; the server value is unchanged). This covers both set and clear (clearing falls back server-side to `RK_SSH_HOST` or empty). No other commit handler (instance name, theme, accent, font) calls the seam.

- **GIVEN** the Settings dialog with a new SSH host typed
- **WHEN** the commit (`setSSHHost`) resolves
- **THEN** `invalidateOpenContext()` is called exactly once

- **GIVEN** the Settings dialog with an invalid SSH host typed
- **WHEN** the commit (`setSSHHost`) rejects
- **THEN** `invalidateOpenContext()` is NOT called (the inline error renders as today)

### run-kit: Open-button last-used icon

#### R3: Primary segment renders the last-used target's icon
`app/frontend/src/components/open-button.tsx` SHALL render `<OpenTargetIcon target={lastUsed} />` inside the primary segment button, before the text, when `lastUsed` resolves non-null from `resolveLastUsedTarget(targets, readLastUsedOpenTarget())`. The "Open" text label MUST be kept (the icon is additive decoration). When `lastUsed` is null (nothing stored, or the stored id no longer resolves against live targets), NO icon renders — the segment looks exactly as today. The icon is `aria-hidden` decoration (already true inside `OpenTargetIcon`); the accessible name stays `Open in {label}` when `lastUsed` resolves, `Open in app` otherwise — unchanged. Scope is the split-button primary segment ONLY — dropdown rows, overflow `OpenMenuRows`, and palette entries are untouched.

- **GIVEN** localStorage `runkit-open-last-used` holds an id that resolves against live targets
- **WHEN** the split-button renders
- **THEN** the primary segment contains the target's `aria-hidden` glyph plus the "Open" text, and its accessible name is `Open in {label}`

- **GIVEN** no stored preference, or a stored id that no longer resolves
- **WHEN** the split-button renders
- **THEN** the primary segment contains no glyph and its accessible name is `Open in app`

### Non-Goals

- No backend, API, or route changes — `app/backend/api/health.go` is already correct and untouched.
- No client polling and no per-render refetching (code-quality anti-pattern; rejected in intake).
- No changes to the menu rows, overflow rows, or palette entries (they already carry icons).
- No e2e spec changes — `open-in-app.spec.ts` asserts accessible names only, which the `aria-hidden` icon does not affect.
- No backend persistence for the last-used preference (Constitution II — stays localStorage).

### Design Decisions

#### Store primitive: `useSyncExternalStore` over a hand-rolled subscriber array
**Decision**: implement the store with a module-level listener `Set` consumed via React's `useSyncExternalStore` (subscribe/getSnapshot), with the fetch kicked from a `useEffect` gated on `enabled`.
**Why**: it is React 19's canonical external-store primitive — tear-free snapshots, automatic unsubscription on unmount, and no `alive` flag bookkeeping; the intake explicitly names it acceptable.
**Rejected**: a hand-rolled subscriber array driving per-consumer `useState` — more code for the same behavior and re-implements what the hook provides.
*Introduced by*: 260723-l317-open-button-ssh-refresh-icon

#### Epoch guard discards in-flight results fetched before an invalidation
**Decision**: a module-level `epoch` counter, bumped on invalidation; a fetch records the epoch at start and only writes `cached`/notifies when it still matches at resolve time.
**Why**: two rapid SSH-host commits would otherwise let the first (now stale) refetch resolve after the second invalidation and resurrect pre-commit data.
**Rejected**: ignoring the race (small window, but silently serves exactly the stale data this change exists to kill); aborting via `AbortController` (heavier — the fetch helpers don't take signals).
*Introduced by*: 260723-l317-open-button-ssh-refresh-icon

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rework `app/frontend/src/hooks/use-open-targets.ts` into an invalidatable external store: listener `Set` + `useSyncExternalStore`, exported `invalidateOpenContext()` (clear cache, epoch bump, eager refetch + notify when listeners exist, plain drop when none), keep `useOpenTargets(enabled)` signature + fail-silent halves, keep `resetOpenTargetsCacheForTest()`, update the doc comment to "static between settings commits" <!-- R1 -->
- [x] T002 Extend `app/frontend/src/hooks/use-open-targets.test.tsx`: mounted-consumer invalidation delivers a changed `/api/health` `sshHost` without remount (refetch observed); zero-subscriber invalidation drops the cache so the next mount fetches fresh; existing cache/fail-silent tests keep passing unmodified <!-- R1 -->
- [x] T003 In `app/frontend/src/components/settings-dialog.tsx`, call `invalidateOpenContext()` in the SSH host `TextSetting` `commit` after `await setSSHHost(...)` succeeds (success only) <!-- R2 -->
- [x] T004 Extend `app/frontend/src/components/settings-dialog.test.tsx`: mock `@/hooks/use-open-targets`; a successful SSH-host commit calls `invalidateOpenContext()` once; a rejected commit does not call it <!-- R2 -->
- [x] T005 [P] In `app/frontend/src/components/open-button.tsx`, render `<OpenTargetIcon target={lastUsed} />` before the "Open" text in the primary segment when `lastUsed` is non-null (small `gap` for spacing); no icon when null; keep label text and aria-labels unchanged <!-- R3 -->
- [x] T006 [P] Extend `app/frontend/src/components/open-button.test.tsx`: primary segment carries the resolved target's `data-icon` glyph (aria-hidden) with the "Open" text when a last-used target resolves; no `svg` in the primary segment when localStorage is empty or the stored id is stale; accessible names unchanged <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Run `just test-frontend` and `cd app/frontend && npx tsc --noEmit`; fix any failures (max 3 attempts per failure before escalating) <!-- R1 R2 R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `use-open-targets.ts` exports `invalidateOpenContext()`; calling it with a mounted consumer refetches the bundle and the consumer re-renders with the fresh context without a reload
- [x] A-002 R2: the Settings dialog's SSH-host commit handler calls `invalidateOpenContext()` after a successful `setSSHHost`, and nowhere else
- [x] A-003 R3: the split-button primary segment renders the resolved last-used target's `OpenTargetIcon` (aria-hidden) before the kept "Open" text

### Behavioral Correctness

- [x] A-004 R1: `useOpenTargets(enabled)` keeps its signature and semantics — `enabled` gates the fetch, cache is shared across consumers, both halves fail-silent (all pre-existing tests in `use-open-targets.test.tsx` pass unmodified)
- [x] A-005 R2: a rejected `setSSHHost` does not invalidate (inline error behavior unchanged)
- [x] A-006 R3: with no stored preference or a non-resolving stored id, the primary segment carries no icon and accessible names stay `Open in app` / `Open in {label}`

### Scenario Coverage

- [x] A-007 R1: Vitest covers mounted-consumer invalidation (fresh `sshHost` reaches the hook) and zero-subscriber invalidation (cache dropped, next mount fetches fresh)
- [x] A-008 R2: Vitest covers both the success (invalidate called) and failure (not called) commit paths
- [x] A-009 R3: Vitest covers icon presence (resolved last-used) and absence (empty/stale localStorage) in the primary segment

### Edge Cases & Error Handling

- [x] A-010 R1: an invalidation while a fetch is in-flight cannot resurrect stale data (epoch guard: the pre-invalidation result is discarded, never cached or notified). Verified by code trace at `use-open-targets.ts:54,71,78` — the `fetchedAt`/`epoch` guard skips both the cache write and the `pending=null` reset when a later invalidation bumped `epoch`. Not covered by a dedicated Vitest case (the epoch guard is implementation detail; behavioral coverage is via A-007's refetch tests)

### Code Quality

- [x] A-011 Pattern consistency: new code follows the file's existing naming/comment style; `runkit-*`/hook conventions untouched
- [x] A-012 No unnecessary duplication: `OpenTargetIcon` reused verbatim; no new icon or fetch utilities introduced
- [x] A-013 No client polling and no per-render refetch introduced (code-quality anti-pattern respected); invalidation is event-driven from the settings commit only

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Tests run only via `just` recipes (`just test-frontend`); frontend type check via `cd app/frontend && npx tsc --noEmit`. E2E untouched — `open-in-app.spec.ts` asserts accessible names only.

## Deletion Candidates

- None — this change reworks the existing `use-open-targets.ts` cache into an external store in place (same module, same `cached`/`pending` names, same `useOpenTargets`/`resetOpenTargetsCacheForTest` exports) and adds one new export (`invalidateOpenContext`, already consumed at `settings-dialog.tsx:356`). No file, function, branch, or config was made redundant; the old `useState`/`alive`-flag fetch path was replaced, not left dangling.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Store primitive is `useSyncExternalStore` + listener `Set` (not a hand-rolled subscriber array) | Intake names both acceptable; `useSyncExternalStore` is React 19's canonical external-store hook — less bookkeeping, tear-free, auto-unsubscribe | S:75 R:85 A:85 D:65 |
| 2 | Confident | Add an epoch/generation guard so a fetch started before an invalidation cannot write the cache after it | Intake is silent on the rapid-double-commit race; the guard is a few lines, easily removed, and prevents resurrecting exactly the stale data this change kills | S:55 R:85 A:85 D:75 |
| 3 | Confident | Zero-subscriber invalidation drops the cache without an eager refetch | Intake explicitly allows this ("must at minimum drop the stale cache even if it chooses not to eagerly refetch with zero subscribers"); avoids a wasted fetch nobody consumes | S:80 R:85 A:85 D:75 |
| 4 | Confident | Disabled consumers (`enabled=false`) now also subscribe to store updates via `useSyncExternalStore` | Consistent with the existing "data still returns when another consumer populated the cache" semantic — subscription just makes that live; strictly more correct rendering | S:60 R:80 A:80 D:70 |
| 5 | Confident | Icon spacing via a small `gap` utility on the primary segment's existing flex classes | Pure visual detail; matches the row treatment (`gap-2` rows, tighter `gap-1` fits the 24px segment) | S:55 R:95 A:85 D:80 |
| 6 | Confident | `settings-dialog.test.tsx` observes the seam by mocking the `@/hooks/use-open-targets` module | Standard Vitest seam for asserting call/no-call without dragging the real store (and its fetches) into dialog tests | S:65 R:90 A:85 D:75 |
| 7 | Certain | Only `just test-frontend` + `npx tsc --noEmit` run; e2e specs and their `.spec.md` companions untouched | Intake explicit: aria-hidden icon does not affect the name-based e2e assertions; companion-doc rule binds only if a `.spec.ts` is extended (none is) | S:90 R:90 A:90 D:90 |

7 assumptions (1 certain, 6 confident, 0 tentative).
