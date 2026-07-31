# Plan: Board E2E Helper Consolidation (_boards.ts)

**Change**: 260731-2kio-board-e2e-helpers
**Intake**: `intake.md`

## Requirements

### E2E Helpers: `_boards.ts` module

- **R1**: A new module `app/frontend/tests/e2e/_boards.ts` MUST export the base board-API helpers `pinWindow(request, board, server, windowId)` and `unpinWindow(request, board, server, windowId)`, each POSTing `/api/boards/{board}/pin|/unpin` with `{ data: { server, windowId } }` on the given `APIRequestContext` (callers pass `page.request` or the `request` fixture) using **relative paths**, and ok-asserting the response with the message form `` `pin ${windowId} → ${res.status()}` `` / `` `unpin ${windowId} → ${res.status()}` ``. The module header comment MUST document the consolidation and the `_rk-pin-<id>` persistence hazard (matching `_tmux.ts` documentation style).
  - GIVEN a spec importing `pinWindow` WHEN it calls `pinWindow(page.request, "b1", TMUX_SERVER, "@3")` THEN a POST to `/api/boards/b1/pin` with body `{server, windowId}` is issued and a non-ok response fails the test with `pin @3 → <status>`.
- **R2**: `_boards.ts` MUST export an opt-in cleanup-registry layer: `interface PinEntry { board; server; windowId }`, `trackPin(entry: PinEntry)` appending to a module-level registry, and `unpinAll(request: APIRequestContext)` performing a best-effort (try/catch per entry, **no** ok-assert) unpin of every tracked entry and finishing with `registry.length = 0`. Entries carry `board` because `board-autofit.spec.ts` pins onto two boards behind one registry. No convenience `pinTracked` combo SHALL be added — call sites compose `pinWindow` + `trackPin` explicitly.
  - GIVEN two tracked entries on different boards WHEN `unpinAll(request)` runs in `afterAll` THEN each entry's own board receives the unpin POST, a failed unpin does not throw, and the registry is empty afterwards.
- **R3**: `_boards.ts` MUST fold in the small verbatim dupes with the same home: `apiBase(baseURL)` returning `baseURL ?? \`http://localhost:${process.env.RK_PORT ?? 3020}\`` and `isTerminalsSocket(url)` testing `/\/ws\/terminals(\?|$)/` — byte-equivalent to the existing copies.
  - GIVEN `baseURL` undefined and `RK_PORT` unset WHEN `apiBase(undefined)` is called THEN it returns `http://localhost:3020`; GIVEN `ws://host/ws/terminals?x=1` WHEN passed to `isTerminalsSocket` THEN it returns true (and false for `/ws/state`).

### E2E Specs: migration (behavior-preserving)

- **R4**: The 11 board specs from the intake's What Changes table MUST be migrated onto `_boards.ts`, mechanically and behavior-preserving — no spec gains or loses cleanup semantics:
  - `boards-pin-flow.spec.ts` — pin sites (:27, :99) → `pinWindow`; unpins stay inline (the :72 unpin is itself under test; :148/:151 are non-asserted cleanup).
  - `board-autofit.spec.ts` — local `pin()` becomes a thin wrapper composing `pinWindow` + `trackPin` (the file's 4 pin loops keep their shape; thin per-file wrappers over shared helpers are the established idiom); `pinned[]` + `afterAll` loop → `unpinAll`; mid-test unpin sites (:159/:203/:250/:255) → `unpinWindow`.
  - `boards-desktop-suspend.spec.ts` — local `isTerminalsSocket` → import; pin loop + `pinnedEntries` + `afterAll` → registry layer.
  - `boards-same-session-multi-pane.spec.ts` — local `isTerminalsSocket` → import; pin :80 → `pinWindow`, ok-asserted mid-test unpin :112 → `unpinWindow`.
  - `boards-mobile.spec.ts` — pin :63 + `pinnedEntries` + `afterAll` → registry layer.
  - `boards-multi-server.spec.ts` — pins :51/:56 + `pinnedEntries` + `afterAll` → registry layer.
  - `board-reorder.spec.ts` — local `apiBase` → import; pin loops (:48, :103) → `pinWindow` (relative path); non-asserted cleanup unpins stay inline.
  - `board-list-reorder.spec.ts` — local `apiBase` → import; pin loop :91 → `pinWindow`.
  - `board-close-and-unpin.spec.ts` — pins :29/:72/:114/:179 → `pinWindow`; unpins stay inline (UI-driven or awaited requests).
  - `compose-strip.spec.ts` — pin loop :228 → `pinWindow` (no registry adopted — pins reaped by global teardown, as today).
  - `connection-budget.spec.ts` — local `isTerminalsSocket` → import; pin :150 → `pinWindow`, finally-block cleanup unpin :167 → `unpinWindow`.
  - GIVEN any migrated spec WHEN `just test-e2e` runs it THEN it passes with the same test steps, the same cleanup semantics, and no new `pinnedEntries`/local-helper declarations remaining.
- **R4a**: `server-reorder.spec.ts`'s verbatim `apiBase` copy (a third copy the intake's 2-copy count missed; confirmed byte-identical) SHALL also be migrated to the `_boards.ts` import — same fold-in clause, import-swap only, no other edits to that spec.

### Companion Docs

- **R5**: Sibling `.spec.md` companions MUST be updated only where a test's steps or documented shared-setup mechanics change (constitution § Test Companion Docs; PR #490 posture): `boards-mobile.spec.md`, `boards-desktop-suspend.spec.md`, `boards-multi-server.spec.md` (the "module-scoped `pinnedEntries` array" wording → the `_boards.ts` registry via `trackPin`/`unpinAll`), and `board-autofit.spec.md` (the local `pin()` helper wording). Companions whose wording stays accurate (behavioral `apiBase` descriptions, step sequences) SHALL NOT be edited.
  - GIVEN the migrated specs WHEN a reviewer reads each sibling `.spec.md` THEN no companion describes a mechanic that no longer exists in the spec file.

### Verification

- **R6**: Verification MUST run through `just test-e2e` only (never raw `playwright`, never `just pw`), scoped to the affected specs first, serialized against any other e2e run (box-wide mutex: port 3020 + shared `rk-test-e2e` tmux server). TypeScript check (`pnpm exec tsc --noEmit` in `app/frontend`) runs before any e2e run.
  - GIVEN the migration is complete WHEN `cd app/frontend && pnpm exec tsc --noEmit` and `just test-e2e <the 12 affected specs>` run THEN both pass (known pre-existing flakes re-run once before being attributed to this change).

### Non-Goals

- No registry adoption for specs without one today (`compose-strip`, `boards-pin-flow`, `board-close-and-unpin`, `connection-budget`, `boards-same-session-multi-pane`, `board-reorder`, `board-list-reorder`) — their pins are reaped by their own unpin flows or `global-teardown.ts`, as today.
- Inline `GET /api/boards*` assertions stay inline — the listing/entries contract is the thing under test there, not shared plumbing.
- Pin/unpin sites in non-board specs (`sidebar-panels.spec.ts`, `shell-rotation.spec.ts`, `settings-dialog.spec.ts`, `window-heading.spec.ts`) are out of scope — the intake's file set is the 11 board specs; these are follow-up candidates, not part of this consolidation.
- No Playwright fixture (`test.extend`) — plain module helpers per the `_tmux.ts`/`_ready.ts` precedent.

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/tests/e2e/_boards.ts` with `PinEntry`, `pinWindow`, `unpinWindow`, `trackPin`, `unpinAll`, `apiBase`, `isTerminalsSocket` per the intake's API sketch, with a `_tmux.ts`-style header comment documenting the consolidation and the `_rk-pin-<id>` persistence hazard <!-- R1, R2, R3 --> <!-- rework: the registry comment's per-worker-module-state claim is false (Playwright reuses workers across spec files with the same workerHash and never clears the module cache); restate the real invariant — every trackPin caller MUST sweep via afterAll unpinAll -->

### Phase 2: Core Implementation (spec migration)

- [x] T002 [P] Migrate `board-autofit.spec.ts`: rewire local `pin()` as a thin wrapper over `pinWindow`+`trackPin`; drop `pinned[]`/afterAll loop for `unpinAll`; mid-test unpins (:159/:203/:250/:255) → `unpinWindow` <!-- R4 -->
- [x] T003 [P] Migrate the registry-layer specs `boards-desktop-suspend.spec.ts`, `boards-mobile.spec.ts`, `boards-multi-server.spec.ts`: drop `pinnedEntries` + afterAll loops for `trackPin`/`unpinAll`; desktop-suspend also swaps local `isTerminalsSocket` for the import <!-- R4 -->
- [x] T004 [P] Migrate the base-helper specs `boards-pin-flow.spec.ts`, `boards-same-session-multi-pane.spec.ts`, `board-close-and-unpin.spec.ts`, `compose-strip.spec.ts`, `connection-budget.spec.ts`: pin sites → `pinWindow`; same-session :112 unpin → `unpinWindow`; same-session + connection-budget swap local `isTerminalsSocket` for the import; connection-budget's `finally`-block cleanup unpin stays a best-effort NON-asserted post (as at HEAD) <!-- R4 --> <!-- rework: must-fix — unpinWindow inside connection-budget's `finally` turns cleanup into a hard assertion; a throw from `finally` replaces the in-flight try exception, masking the socket-count diagnostic the test exists for (violates R4/A-005 behavior preservation). Revert that one site to a non-asserted post -->
- [x] T005 [P] Migrate the `apiBase` specs `board-reorder.spec.ts`, `board-list-reorder.spec.ts`, `server-reorder.spec.ts`: local `apiBase` → import; board-reorder/-list-reorder pin loops → `pinWindow` <!-- R4, R4a -->

### Phase 3: Integration & Edge Cases

- [x] T006 Update the four companion docs whose shared-setup mechanics wording changed: `boards-mobile.spec.md`, `boards-desktop-suspend.spec.md`, `boards-multi-server.spec.md`, `board-autofit.spec.md`; verify the remaining companions need no edit <!-- R5 -->
- [x] T007 Verify: `cd app/frontend && pnpm exec tsc --noEmit`, then a scoped `just test-e2e` covering the reworked specs (connection-budget at minimum); the full suite already passed this cycle and only connection-budget/_boards.ts change in rework <!-- R6 --> <!-- rework: re-verify after the finally-block fix; full-suite re-run not required for a comment edit + single-site revert -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `_boards.ts` exists with ok-asserted `pinWindow`/`unpinWindow` on `APIRequestContext` using relative paths and the `` pin ${windowId} → ${status} `` message form
- [x] A-002 R2: `trackPin`/`unpinAll` registry layer is module-level, best-effort (try/catch per entry, no ok-assert), clears via `registry.length = 0`, and entries carry `board`
- [x] A-003 R3: `apiBase` and `isTerminalsSocket` are exported byte-equivalent to the removed copies
- [x] A-004 R4: All 11 intake-listed specs import from `_boards.ts`; no spec retains a local `pin()`/`pinnedEntries`/`apiBase`/`isTerminalsSocket` copy

### Behavioral Correctness

- [x] A-005 R4: Migration is behavior-preserving — no spec gains or loses cleanup semantics (registry adopted only where a per-file registry existed; inline non-asserted cleanup unpins stay inline except the four board-autofit sites the intake maps to `unpinWindow`). *(Reviewed: connection-budget :162 correctly stays a non-asserted inline post per the T004 rework — the "and connection-budget :167" clause in this item's original wording was superseded by that rework and is struck here.)*
- [x] A-006 R4a: `server-reorder.spec.ts` uses the imported `apiBase` with no other changes

### Scenario Coverage

- [x] A-007 R6: A scoped `just test-e2e` run covering all 12 migrated spec files passes (with at most one single-spec flake re-run each)

### Edge Cases & Error Handling

- [x] A-008 R2: `board-autofit`'s two-board registry works — `unpinAll` posts each entry against its own board, and already-unpinned entries do not fail the sweep

### Code Quality

- [x] A-009 Pattern consistency: `_boards.ts` follows the `_tmux.ts`/`_ready.ts` underscore-helper conventions (header comment, JSDoc per export, no shell strings)
- [x] A-010 No unnecessary duplication: no remaining verbatim `apiBase`/`isTerminalsSocket`/pin-registry copies in the migrated file set
- [x] A-011 R5: Companion `.spec.md` docs accurate — updated only where mechanics/steps wording changed, unchanged elsewhere
- [x] A-012 R6: No raw `playwright`/`just pw` invocation used for verification; frontend `tsc --noEmit` clean

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/tests/e2e/sidebar-panels.spec.ts:131,163` — inline pin/unpin copies now redundant with `_boards.ts`; declared a Non-Goal here, so this is a follow-up candidate, not a gap.
- `app/frontend/tests/e2e/settings-dialog.spec.ts:187,204` — same inline pin/unpin shape; follow-up candidate per the Non-Goals list.
- `app/frontend/tests/e2e/shell-rotation.spec.ts:45,83` — same inline pin/unpin shape; follow-up candidate per the Non-Goals list.
- `app/frontend/tests/e2e/window-heading.spec.ts:120,146` — same inline pin/unpin shape; follow-up candidate per the Non-Goals list.
- `app/frontend/tests/e2e/board-reorder.spec.ts:80` — the last remaining `Content-Type: application/json` hand-set header on a board POST; now provably redundant (Playwright auto-sets it for object `data`), but it is a non-asserted cleanup unpin the plan keeps inline.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Migrate `server-reorder.spec.ts`'s `apiBase` copy too (12th file, import-swap only) even though the intake counted 2 copies | Direct grep found a third byte-identical copy; the intake's fold-in clause ("apiBase … verbatim dupes with the same home") covers it and leaving it defeats the dedupe intent; trivially reversible | S:60 R:90 A:85 D:75 |
| 2 | Confident | board-autofit's mid-test unpins (:159/:203/:250/:255) gain an ok-assert by becoming `unpinWindow`, though the current code does not assert them | The intake explicitly maps these sites to `unpinWindow` (calling them "unpin ok-asserts"); a failed state-reset unpin between tests is worth surfacing; same for connection-budget :167 (intake: "→ base helpers") | S:70 R:85 A:75 D:65 |
| 3 | Confident | Pin sites keep no explicit `Content-Type: application/json` header when migrated (board-reorder/-list-reorder copies set one) | Playwright's `data:` object serializes to JSON and sets the header automatically — byte-equivalent request; helper stays uniform across the three call styles | S:65 R:90 A:90 D:80 |
| 4 | Certain | Non-board specs with pin sites (`sidebar-panels`, `shell-rotation`, `settings-dialog`, `window-heading`) stay unmigrated | Intake's What Changes table and "~20 sites across 11 spec files" count explicitly scope the file set; recorded as Non-Goal / follow-up candidates | S:80 R:95 A:90 D:85 |
| 5 | Confident | Companion updates limited to the 4 files whose Shared-setup wording names the replaced mechanics (`pinnedEntries` array / local `pin()`); `apiBase` behavioral descriptions stay | Constitution § Test Companion Docs keys on steps; intake §3 sets the PR #490 minimal-edit posture; `apiBase(baseURL)` descriptions remain accurate post-import | S:70 R:90 A:80 D:70 |
| 6 | Confident | `board-autofit` keeps its local `pin()` as a thin wrapper composing `pinWindow`+`trackPin` (the intake's "no `pinTracked` combo" rule governs the shared module's API, not per-file structure) | 4 loop call sites share the wrapper; thin per-file wrappers over shared helpers are the established idiom (cf. `stubMatchMedia` wrappers); the composition stays visible in the file | S:55 R:92 A:80 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative).
