# Plan: Delete Unused sendKeys Frontend Client Wrapper

**Change**: 260719-4ujs-delete-sendkeys-frontend-wrapper
**Intake**: `intake.md`

## Requirements

### Frontend API Client: Dead-Code Removal

#### R1: The `sendKeys` wrapper is removed from the frontend client
The `sendKeys` function exported from `app/frontend/src/api/client.ts` (the wrapper around `POST /api/windows/{windowId}/keys`) MUST be deleted. It has zero production callers, so its removal SHALL NOT affect any user-facing behavior. Adjacent exports (`renameWindow` above it, `HttpError` below it) MUST remain untouched.

- **GIVEN** `client.ts` currently exports `sendKeys(server, windowId, keys)`
- **WHEN** the change is applied
- **THEN** the `sendKeys` function no longer exists anywhere in `client.ts`
- **AND** `renameWindow` and `HttpError` are byte-for-byte unchanged

#### R2: The `sendKeys` unit test and its import are removed
The `sendKeys` identifier in the import list of `app/frontend/src/api/client.test.ts` and the test case `it("sendKeys sends POST /api/windows/:windowId/keys with server query", ...)` MUST both be deleted. Neighboring tests (`renameWindow` above, `sendChatMessage` below) MUST remain untouched. Removing the export without removing the test would break the type check, so both edits SHALL land together.

- **GIVEN** `client.test.ts` imports `sendKeys` and contains a test that calls it
- **WHEN** the change is applied
- **THEN** neither the import identifier nor the test case references `sendKeys`
- **AND** the `renameWindow` and `sendChatMessage` tests are unchanged

#### R3: The frontend compiles and its unit tests pass after removal
After R1 and R2, the frontend MUST type-check clean (`npx tsc --noEmit`) and the frontend unit suite MUST pass (`just test-frontend`), proving zero dangling references to `sendKeys` and no regression in the remaining client tests.

- **GIVEN** the wrapper and its test have been deleted
- **WHEN** `cd app/frontend && npx tsc --noEmit` runs
- **THEN** it exits 0 with no errors
- **AND WHEN** `just test-frontend` runs, the suite passes

### Non-Goals

- Backend `POST /api/windows/{windowId}/keys` endpoint (`app/backend/api/`) — stays as-is; possible external (non-SPA) callers.
- `docs/specs/api.md` — the HTTP surface is unchanged (endpoint remains), so no spec edit.
- Backend tests for the endpoint — untouched.
- `docs/memory/run-kit/architecture.md` and `docs/memory/run-kit/tmux-sessions.md` — client-function lists there are updated at hydrate, not apply.

## Tasks

### Phase 1: Removal

- [x] T001 Delete the `sendKeys` function (the full `export async function sendKeys(...) { ... }` block) from `app/frontend/src/api/client.ts`, leaving `renameWindow` and `HttpError` intact. <!-- R1 -->
- [x] T002 Remove the `sendKeys,` identifier from the import list and delete the `it("sendKeys sends POST /api/windows/:windowId/keys with server query", ...)` test case in `app/frontend/src/api/client.test.ts`, leaving the `renameWindow` and `sendChatMessage` tests intact. <!-- R2 -->

### Phase 2: Verification

- [x] T003 Run `cd app/frontend && npx tsc --noEmit` and confirm a clean type check (proves no dangling `sendKeys` references). <!-- R3 -->
- [x] T004 Run `just test-frontend` and confirm the frontend unit suite passes. <!-- R3 -->

## Execution Order

- T001 and T002 must both land before T003 (the type check fails if only one side is removed).
- T003 before T004.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `sendKeys` function is absent from `app/frontend/src/api/client.ts`; `renameWindow` and `HttpError` remain.
- [x] A-002 R2: The `sendKeys` import identifier and its test case are absent from `app/frontend/src/api/client.test.ts`; `renameWindow` and `sendChatMessage` tests remain.

### Removal Verification

- [x] A-003 R1: A repo-wide search (`grep -rna sendKeys app/frontend/src app/frontend/tests`) returns zero matches — no dead export, no dangling reference.

### Scenario Coverage

- [x] A-004 R3: `cd app/frontend && npx tsc --noEmit` exits 0 with no errors.
- [x] A-005 R3: `just test-frontend` passes.

### Code Quality

- [x] A-006 Pattern consistency: The edits are pure deletions that preserve the surrounding client and test file structure.
- [x] A-007 No unnecessary duplication: No new code introduced; the sanctioned pane-targeted alternative (`sendChatMessage`) is unaffected.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Backend `/keys` endpoint intentionally retained (out of scope).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete both the wrapper and its test in one apply pass | Intake and backlog item are explicit ("+ its test block"); removing the export alone would break the type check | S:95 R:95 A:95 D:95 |
| 2 | Certain | Backend `/keys` endpoint and its tests stay untouched | Intake Non-Goals + backlog item scope the endpoint to remain (possible external callers) | S:95 R:85 A:95 D:95 |
| 3 | Certain | Memory-file client-function lists are updated at hydrate, not apply | Apply does not edit `docs/memory/`; the intake's Affected Memory feeds hydrate | S:95 R:90 A:95 D:95 |

3 assumptions (3 certain, 0 confident, 0 tentative).
