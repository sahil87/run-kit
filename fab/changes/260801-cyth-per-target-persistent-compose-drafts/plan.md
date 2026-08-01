# Plan: Per-Target Persistent Compose Drafts

**Change**: 260801-cyth-per-target-persistent-compose-drafts
**Intake**: `intake.md`

## Requirements

### Frontend Store: Per-Target Keyed Compose Drafts (`app/frontend/src/lib/compose-draft-store.ts`)

#### R1: Keyed draft store
The module draft store SHALL replace its single `{text, attachments}` slot with a map keyed by the send-target key — the existing `entryKey(server, windowId)` from `@/store/window-store`. `getComposeDraft(key)`, `setComposeText(key, next)`, `setComposeAttachments(key, next)`, and `clearComposeDraft(key)` SHALL all be key-scoped; `subscribeComposeDraft` keeps the `useSyncExternalStore` contract. Snapshot identity MUST stay stable per key while that key's draft is unchanged, and a null/absent key MUST resolve to a single stable empty draft.

- **GIVEN** a draft "for A" stored under key `srv:@1` and nothing under `srv:@2`
- **WHEN** `getComposeDraft("srv:@2")` is read
- **THEN** it returns the empty draft (text `""`, no attachments), and `getComposeDraft("srv:@1")` still returns "for A"
- **AND** two consecutive reads of the same unchanged key return the identical object reference

#### R2: Text-only localStorage persistence
The store SHALL persist draft **text only** to one localStorage key **`runkit-compose-drafts`** holding a JSON map `{ [entryKey]: { text: string, updatedAt: number } }`, written through synchronously on every store commit. On module load the in-memory map SHALL be seeded from localStorage with a tolerant parse (malformed JSON, non-object roots, and entries with wrong-typed fields degrade to empty/skipped — mirroring `parseOverrides` in `keybindings.ts`). All localStorage access is best-effort (`try/catch`, never throws).

- **GIVEN** a draft typed for `srv:@1`
- **WHEN** the page reloads (module re-initializes)
- **THEN** hydration restores that key's text from `runkit-compose-drafts`
- **AND** a corrupted stored value yields an empty store without throwing

#### R3: Pruning
Persistence SHALL prune on every write and on hydration: entries with empty text are never persisted; entries older than 7 days (`updatedAt`) are dropped; at most the 30 newest entries by `updatedAt` are kept. Constants are named exports (no magic numbers).

- **GIVEN** 31 non-empty drafts with distinct `updatedAt` values
- **WHEN** the store persists
- **THEN** the stored map holds the 30 newest and the oldest is gone
- **AND** an entry whose `updatedAt` is older than 7 days is dropped at hydration

#### R4: Attachments per-key, in-memory only
Pending attachments (`File` objects + paths) SHALL live in the in-memory map per key and MUST NOT be persisted (localStorage cannot hold `File`s; uploads are eager and their path lines live in the persisted text). After a refresh, previews/remove-chips are gone but path lines and uploaded files survive.

- **GIVEN** a draft with an attached file under `srv:@1`
- **WHEN** the store hydrates from localStorage
- **THEN** the restored draft has the text (including path lines) and an empty attachments array

### Compose Strip: Key-Scoped Wiring + Re-Home Removal (`app/frontend/src/components/compose-strip.tsx`)

#### R5: Key-scoped strip wiring
The strip SHALL resolve the draft key from the live focused target each render (`focusedKey(focused)`; `null` when no target) and route all draft reads/writes through the key-scoped store API. With no target the strip stays disabled and displays the empty draft (unchanged disabled state). A delivered send SHALL clear only the focused target's draft, revoking only that draft's blob-preview URLs. Switching the focused target swaps the visible draft (board pane-focus cycling included — designed behavior).

- **GIVEN** drafts for windows A and B
- **WHEN** focus moves A → B and a send is delivered on B
- **THEN** B's draft clears while A's draft (text + attachments) remains intact and reappears when A regains focus

#### R6: Re-home machinery removed
The target-change re-home machinery SHALL be deleted: the `lastTargetKeyRef` effect (re-upload of held Files, the cancelled-async guard), the `rewritePathLine` helper (verified dead — `removeFile` carries its own inline path-line splice), and the re-home `role="alert"` error state plus the `compose-strip-error` UI (verified: re-home is its sole writer, so the `error` state, its JSX block, and the `setError` cleanups in `send`/`removeFile` all go).

- **GIVEN** attachments pending for window A
- **WHEN** the focused target changes to window B
- **THEN** no re-upload fires (the attachments stay bound to A's draft) and no error UI path exists in the component

#### R7: Doc comments rewritten to the per-target model
All doc comments in `compose-draft-store.ts` and `compose-strip.tsx` describing the single-global-draft/travel model and re-homing SHALL be rewritten to the per-target model (drafts keyed by send target, text persisted to localStorage, attachments in-memory per key). This intentionally reverses intake §7/R2 of 260718-dhdj ("draft travels across route navigation").

- **GIVEN** the updated files
- **WHEN** grepping for re-home/single-global-draft narration
- **THEN** no comment still claims the draft travels with the user or that attachments re-home on focus change

### Tests

#### R8: Test coverage, companion docs same change
Unit tests SHALL cover the store (keyed isolation, persistence round-trip, tolerant parse, pruning empty/cap/age, clear-per-key, stable snapshots, notify-on-change-only). `compose-strip.test.tsx` SHALL cover: target-switch shows the new target's draft; send clears only that target's draft; attachments stay with their target (replacing the deleted re-home test); the disabled no-target state. `tests/e2e/compose-strip.spec.ts` SHALL add per-target recall (navigate away → other target's strip empty; navigate back → draft restored) and refresh survival, with the sibling `.spec.md` updated in the same change (constitution: Test Companion Docs).

- **GIVEN** the e2e run
- **WHEN** a draft is typed on window A, the user navigates to window B and back, then reloads
- **THEN** B showed an empty strip, A's draft was recalled on return, and the reload preserved it

### Non-Goals

- Multi-tab `storage`-event sync — last-write-wins in v1 (intake assumption 6)
- IndexedDB `File` persistence — loss of previews across refresh is cosmetic (intake §3)
- Any change to the `onKeyDown`/Enter-policy layer of `compose-strip.tsx` — owned by parallel change `260801-hsxm`
- Structural changes to the `board-page.tsx` / `app.tsx` footer mounts (store is module-level; verify only)

### Design Decisions

#### Synchronous write-through, no debounce
**Decision**: Persist to localStorage synchronously on every store commit, without the optional ~300ms debounce.
**Why**: Drafts are small (intake calls the debounce "acceptable but not required"); synchronous writes are deterministic in unit and e2e tests and close the lose-a-keystroke-on-instant-reload window entirely.
**Rejected**: Debounced writes — saves negligible I/O and adds a flush-on-unload edge case.
*Introduced by*: 260801-cyth-per-target-persistent-compose-drafts

#### Global subscription, per-key snapshots
**Decision**: Keep one global listener set (any commit notifies all subscribers); per-key reads go through `getComposeDraft(key)` with a per-key stable snapshot cache, consumed as `useSyncExternalStore(subscribeComposeDraft, () => getComposeDraft(key))`.
**Why**: At most one strip is mounted; per-key listener bookkeeping buys nothing. Stable per-key snapshots keep `useSyncExternalStore` re-renders correct and cheap.
**Rejected**: Per-key subscription channels — more moving parts for a single-subscriber store.
*Introduced by*: 260801-cyth-per-target-persistent-compose-drafts

#### `hydrateComposeDrafts()` as the public re-seed seam
**Decision**: Module load calls an exported `hydrateComposeDrafts()`; tests reset the module store via `localStorage.clear()` + `hydrateComposeDrafts()`.
**Why**: The old tests reset via the global `clearComposeDraft()`, which no longer exists argless; re-running the real hydration path is a truthful reset and doubles as the persistence-round-trip test seam.
**Rejected**: A `__resetForTest`-style private export — a second, test-only code path that can drift from real hydration.
*Introduced by*: 260801-cyth-per-target-persistent-compose-drafts

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rework `app/frontend/src/lib/compose-draft-store.ts`: single slot → map keyed by `entryKey`, key-scoped API (`getComposeDraft`/`setComposeText`/`setComposeAttachments`/`clearComposeDraft`), stable per-key snapshots, `runkit-compose-drafts` write-through persistence with tolerant hydration (`hydrateComposeDrafts()`) and pruning (empty/30-cap/7-day named constants), attachments in-memory only; rewrite the module doc comment to the per-target model <!-- R1, R2, R3, R4, R7 --> <!-- rework: review cycle 1 must-fix — the prune pipeline (filter empty+age → sort desc by updatedAt → slice to MAX_PERSISTED_DRAFTS) is duplicated verbatim between persist() (compose-draft-store.ts:112-114) and hydrateComposeDrafts() (:215-217); extract one shared prune helper both call. Also address the review should-fix while in here: compose-strip.tsx:177-191 blob URLs for targets abandoned without sending are never reclaimed while the strip stays mounted — reclaim URLs for files no longer reachable from any draft (or scope the map per target). Optional trivial nice-to-have: guard the one-sided age check so a future-dated updatedAt cannot squat the cap. -->
- [x] T002 Add `app/frontend/src/lib/compose-draft-store.test.ts`: keyed isolation, stable snapshot identity, updater forms, clear-per-key + no-op clear, notify-only-on-change, persistence round-trip via `hydrateComposeDrafts`, tolerant parse of malformed/mistyped stored values, pruning (empty text never stored; cap 30 newest; >7-day dropped at hydrate), attachments never persisted <!-- R1, R2, R3, R4 -->
- [x] T003 Rewire `app/frontend/src/components/compose-strip.tsx`: derive `key` from the live focused target, key-bound `setText`/`setFiles`/`clearComposeDraft(key)` and `useSyncExternalStore` snapshot read; delete the `lastTargetKeyRef` re-home effect, `rewritePathLine`, the `error` state + `compose-strip-error` UI and its `setError` cleanups; scope send's blob-URL revoke to the cleared draft's files; rewrite the component doc comments (module header, store-read comment, removeFile comment) to the per-target model — WITHOUT touching the `onKeyDown`/Enter-policy layer <!-- R5, R6, R7 -->
- [x] T004 Update `app/frontend/src/components/compose-strip.test.tsx`: reset via `localStorage.clear()` + `hydrateComposeDrafts()`; delete the re-home test; add target-switch draft isolation, send-clears-only-focused-target, and attachments-stay-with-their-target tests; keep the disabled no-target and same-key survival tests passing <!-- R5, R6, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Verify the `app.tsx` and `board/board-page.tsx` footer mounts need no change (module-level store; `{composeStripEnabled && <ComposeStrip />}` gating unchanged) <!-- R5 -->
- [x] T006 Update `app/frontend/tests/e2e/compose-strip.spec.ts`: add a per-target + refresh-survival test (draft on window A → window B strip empty → back to A draft recalled → reload preserves it); refresh stale "module store" comments; update the sibling `compose-strip.spec.md` in the same change <!-- R8 -->
- [x] T007 Run the verification gates scoped to the change: frontend unit tests (`just test-frontend`), type check (`cd app/frontend && npx tsc --noEmit`), and the compose-strip e2e spec (`just test-e2e compose-strip`) <!-- R8 -->

## Execution Order

- T001 blocks T002, T003
- T003 blocks T004
- T006 after T003 (asserts the new behavior); T007 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The draft store is keyed by `entryKey(server, windowId)`; reads/writes/clears are key-scoped with stable per-key snapshot identity and a stable empty draft for null/absent keys
- [x] A-002 R2: Draft text persists under localStorage key `runkit-compose-drafts` as `{[key]: {text, updatedAt}}`, written through on commit and tolerantly hydrated on module load
- [x] A-003 R3: Pruning enforces empty-drop, 30-newest cap, and 7-day age-out via named constants
- [x] A-004 R4: Attachments are held in-memory per key and never reach localStorage; hydrated drafts carry empty attachment arrays
- [x] A-005 R5: The strip resolves the key from the live focused target each render; send clears only that target's draft and revokes only its preview URLs; the no-target state stays disabled

### Behavioral Correctness

- [x] A-006 R5: Switching focused targets (routes or board pane cycling) swaps the visible draft — a draft composed for A never displays while B is targeted
- [x] A-007 R2: A page refresh restores the focused target's draft text (path lines included)

### Removal Verification

- [x] A-008 R6: The `lastTargetKeyRef` re-home effect, `rewritePathLine`, the re-home `error` state, and the `compose-strip-error` UI are gone with no dead references
- [x] A-009 R7: No doc comment in `compose-draft-store.ts` / `compose-strip.tsx` still describes the single-global-draft/travel model or re-homing

### Scenario Coverage

- [x] A-010 R8: Store unit tests cover keyed isolation, persistence round-trip, tolerant parse, pruning (empty/cap/age), and clear-per-key
- [x] A-011 R8: `compose-strip.test.tsx` covers target-switch draft isolation, send-clears-only-that-target, attachments-stay-with-target, and the disabled no-target state
- [x] A-012 R8: The e2e spec asserts per-target recall + refresh survival, and the sibling `.spec.md` documents the new/changed tests in the same change

### Edge Cases & Error Handling

- [x] A-013 R2: Malformed or mistyped localStorage content degrades to an empty store without throwing; localStorage access failures are swallowed (best-effort)

### Code Quality

- [x] A-014 Pattern consistency: The store keeps the module-slot + listener-set + stable-snapshot pattern (`window-transition.ts`), and persistence mirrors the `keybindings.ts` tolerant read/best-effort write pattern
- [x] A-015 No unnecessary duplication: `entryKey` is reused from `@/store/window-store` ✓; no new key-composition helper ✓; type narrowing (`isStoredDraft` guard) over `as` casts ✓; the prune pipeline is now the single shared `pruneDraftEntries()` helper (`compose-draft-store.ts:113-121`), called by both `persist()` (:127) and `hydrateComposeDrafts()` (:223) — the cycle-1 duplication is resolved

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Parallel change `260801-hsxm` owns the `onKeyDown`/Enter layer of `compose-strip.tsx` — this change must not modify that layer

## Deletion Candidates

- `app/frontend/src/hooks/use-file-upload.ts:12` — the `uploadFiles` doc comment still justifies the `File[]` overload as "files handed off to the compose strip **for re-homing**"; re-homing no longer exists anywhere in the repo. The `File[]` branch itself is still live (the `COMPOSE_STRIP_ATTACH_EVENT` drag-drop/paste queue passes `File[]`), so only the stale rationale is deletable — not the code.
- `docs/memory/run-kit/ui-patterns.md` § Docked Compose Strip → "**Uploads — eager, worktree-scoped, re-homed on focus change**" — the entire paragraph documents deleted machinery (re-upload on target change, the `lines.indexOf(oldPath)` path rewrite, the non-blocking `role="alert"` re-home error). Delete/rewrite to the per-target model at hydrate.
- `docs/memory/run-kit/ui-patterns.md` § Docked Compose Strip → "**Draft survives everything**" — describes the single global draft read via the now-invalid argless `useSyncExternalStore(subscribeComposeDraft, getComposeDraft)` and omits localStorage persistence entirely. Rewrite at hydrate.
- No production symbol is left unused by this change: `rewritePathLine`, `lastTargetKeyRef`, the `error` state, and the `compose-strip-error` block were all removed in-change; a repo-wide grep confirms zero remaining references to any of them (including in Playwright specs).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Synchronous write-through, no debounce | Intake marks debounce optional; sync writes are deterministic in tests and drafts are tiny | S:75 R:90 A:90 D:80 |
| 2 | Confident | One global listener set + per-key stable snapshots (`useSyncExternalStore(subscribe, () => getComposeDraft(key))`) | Single-subscriber store; per-key channels add complexity for zero benefit | S:70 R:85 A:90 D:80 |
| 3 | Confident | `hydrateComposeDrafts()` exported as the module-load + test-reset seam | Tests need a full reset now that `clearComposeDraft` is key-scoped; re-running real hydration avoids a test-only code path | S:60 R:90 A:85 D:75 |
| 4 | Certain | The re-home `error` state and `compose-strip-error` UI are deleted entirely | Verified in source: the re-home effect is the sole non-null `setError` writer | S:90 R:85 A:95 D:95 |
| 5 | Certain | `rewritePathLine` is deleted as dead code | Verified: `removeFile` carries its own inline path-line splice; re-home was `rewritePathLine`'s only caller | S:90 R:90 A:95 D:95 |
| 6 | Confident | Send revokes only the cleared draft's blob URLs (not the whole per-mount map) | Other targets' previews must survive their drafts; lazy `getBlobUrl` recreation makes over-revoking merely wasteful, but scoping is strictly cleaner | S:65 R:90 A:90 D:80 |
| 7 | Confident | E2E per-target test navigates between the two existing board-session windows via terminal routes with full page loads | Reuses existing fixtures; full loads exercise persistence at every hop, covering both recall and refresh survival | S:65 R:90 A:85 D:75 |
| 8 | Confident | Any commit (text or attachments) bumps `updatedAt` and persists | One commit path keeps the store simple; attachment changes normally accompany text (path-line) changes anyway | S:60 R:90 A:85 D:80 |

8 assumptions (2 certain, 6 confident, 0 tentative).
