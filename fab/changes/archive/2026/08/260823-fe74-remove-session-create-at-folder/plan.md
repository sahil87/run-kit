# Plan: Remove Session Create at Folder

**Change**: 260823-fe74-remove-session-create-at-folder
**Intake**: `intake.md`

## Requirements

### Frontend: Palette Surface

#### R1: `Session: Create at Folder` is gone from the palette
The `create-session-at-folder` entry SHALL be removed from `app.tsx`'s `sessionActions`, along with its supporting wiring: the `showCreateSessionAtFolderDialog` state, its `dialogOpenRef` term, its memo dep, and the session-mode `CreateSessionDialog` mount. `Session: Create` (the name prompt), the sidebar/tiles instant paths, and `Tab: Create at Folder` MUST behave exactly as before.

- **GIVEN** the command palette on any route
- **WHEN** the user searches "create"
- **THEN** `Session: Create` and (on a window route) `Tab: Create at Folder` appear, and `Session: Create at Folder` does not

#### R2: `CreateSessionDialog` is window-only
With its only session-mode caller gone, `create-session-dialog.tsx` SHALL be trimmed to the window flow: the `mode` prop, the session-name input with its live conversion and collision check, and the `createSession` optimistic-ghost path are removed; `session` becomes a required prop; the title is always "Create tab at folder". The `sessions` prop STAYS — the quick-picks ("Recent:") list derives from it. The path input, `getDirectories` autocomplete, quick-picks, and the `createWindow` submit MUST be unchanged. The filename stays.

- **GIVEN** the palette's `Tab: Create at Folder` on a window route
- **WHEN** the dialog opens and a folder is picked and confirmed
- **THEN** an unnamed window is created at that folder exactly as before (tmux auto-names it)

### Tests & References

#### R3: Tests and comments reflect the removed surface
`app.test.tsx`'s palette cases SHALL be updated: the `Session: Create at Folder` present-row test is removed, the "both create entries" search test asserts its absence or is reshaped around the remaining entries; the `Window: Create at Folder` cases stay green. Comment references in `top-bar.tsx` and `session-name-prompt.tsx` SHALL be updated minimally to stop naming the removed action.

- **GIVEN** the frontend unit suite
- **WHEN** it runs
- **THEN** no test references the removed session entry and all pass

### Non-Goals

- No backend/API changes (`getDirectories`, `createSession` endpoints stay)
- No rename of `create-session-dialog.tsx`
- No new e2e (no existing e2e covers the removed entry; the remaining window flow is unchanged)

### Design Decisions

#### Dead session mode is removed with the entry, not left latent
**Decision**: Trimming `CreateSessionDialog` to window-only lands in the same change as the palette-entry removal.
**Why**: The entry was the only session-mode caller; leaving the branch invites drift and future reasoning cost (dead-code anti-pattern). Git history preserves the code.
**Rejected**: Removing only the palette entry — ships a component mode nothing can reach.
*Introduced by*: 260823-fe74-remove-session-create-at-folder

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/frontend/src/app.tsx`: remove the `create-session-at-folder` palette entry, `showCreateSessionAtFolderDialog` state, its `dialogOpenRef` term and memo dep, and the session-mode `CreateSessionDialog` mount (keep the `mode="window"` mount, now prop-adjusted) <!-- R1 -->
- [x] T002 `app/frontend/src/components/create-session-dialog.tsx`: trim to window-only — drop the `mode` prop, session-name input + collision + `createSession` ghost path; `session` required; `sessions` kept (quick-picks); title fixed; path/autocomplete/`createWindow` untouched <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 `app/frontend/src/app.test.tsx`: drop the `Session: Create at Folder` row test, reshape the combined "create" search test, keep `Window: Create at Folder` cases; update the mock action list accordingly <!-- R3 -->
- [x] T004 [P] Comment touches: `top-bar.tsx` breadcrumb comment and `session-name-prompt.tsx` doc comment stop naming the removed action (point at `Tab: Create at Folder` where a path flow is referenced) <!-- R3 -->

### Phase 4: Polish

- [x] T005 Verification gates: `pnpm exec tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "session-name-prompt"` (adjacent surface) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Session: Create at Folder` absent from the palette; no `showCreateSessionAtFolderDialog` remains in `app.tsx`
- [x] A-002 R2: `CreateSessionDialog` exposes only the window flow; `session` is required; no `createSession` import/path remains in it

### Behavioral Correctness

- [x] A-003 R1: `Session: Create` (prompt), sidebar/tiles instant creates, and `Tab: Create at Folder` behave exactly as before
- [x] A-004 R2: window-at-folder submit still calls `createWindow(server, session, undefined, cwd)` with no name

### Removal Verification

- [x] A-005 R1: no dead references — `create-session-at-folder` and the session-mode dialog props appear nowhere in `src/` (comments included)

### Scenario Coverage

- [x] A-006 R3: unit suite green with the reshaped palette cases; `Window: Create at Folder` cases untouched and passing

### Code Quality

- [x] A-007 Pattern consistency: the trimmed dialog keeps existing conventions (combobox a11y, debounce, quick-picks) unchanged
- [x] A-008 No unnecessary duplication introduced; no new `as` casts
- [x] A-009 Tests updated in the same commit as the surface change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The combined "create" search unit test asserts the removed row's absence (regression guard) rather than being deleted outright | Cheapest way to pin the removal; mirrors the removal-verification acceptance | S:50 R:90 A:80 D:75 |
| 2 | Certain | No new e2e — no existing e2e exercises the removed entry, and the surviving window flow is behaviorally unchanged | Verified by grep over `tests/e2e`; code-quality's e2e mandate applies to added/changed behavior, and the remaining behavior is unchanged | S:70 R:85 A:90 D:85 |

2 assumptions (1 certain, 1 confident, 0 tentative).

## Deletion Candidates

- None — the diff itself removes all code made dead by the palette-entry removal (palette entry, dialog state/ref/mount, session-mode branch, name input, collision check, ghost path); remaining live references to `createSession`/`deriveNameFromPath`/`addGhostSession` serve other flows. Stale prose survives only in `docs/memory/run-kit/ui/*` (hydrate scope) and `app/frontend/tests/e2e/session-name-prompt.spec.md:15` (should-fix finding).
