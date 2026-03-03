# Tasks: Drop Config File — Derive Project State from tmux

**Change**: 260303-yohq-drop-config-derive-from-tmux
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Remove Config Surface

- [x] T001 [P] Delete `src/lib/config.ts`
- [x] T002 [P] Remove `ProjectConfig` and `Config` types from `src/lib/types.ts` (keep `WindowInfo`, `ProjectSession`, `TmuxExecOptions`, constants)
- [x] T003 [P] Delete `run-kit.example.yaml`

## Phase 2: Core Implementation

- [x] T004 Rewrite `src/lib/sessions.ts` — remove config imports, add `hasFabKit(projectRoot)` helper using `fs.access()`, rewrite `fetchSessions()` to derive project root from window 0's `worktreePath`, auto-enrich via `hasFabKit()`, no "Other" bucket, tmux natural order
- [x] T005 Update empty state text in `src/app/dashboard-client.tsx` (~line 174) — remove "run-kit.yaml" reference, replace with "start a tmux session to get started"

## Phase 3: Cleanup

- [x] T006 [P] Remove `.gitignore` entry for `run-kit.yaml`
- [x] T007 [P] Remove "Other" session filtering in `src/app/dashboard-client.tsx` — remove `s.name !== "Other"` filter in command palette actions (~line 109) and `session.name === "Other"` guard (~line 186)
- [x] T008 Verify build: run `pnpm exec tsc --noEmit` to confirm no type errors remain

---

## Execution Order

- T001, T002, T003 are independent — can run in parallel
- T004 depends on T001+T002 (config imports removed, types removed)
- T005 is independent of T004
- T006, T007 are independent cleanup tasks
- T008 blocks on all prior tasks (final verification)
