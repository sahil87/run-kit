# Tasks: Create Session from Folder

**Change**: 260305-zkem-session-folder-picker
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Add `expandTilde` utility to `src/lib/validate.ts` — resolves `~` to `os.homedir()`, validates path is under `$HOME`, rejects `..` traversal
- [x] T002 [P] Update `createSession` signature in `src/lib/tmux.ts` — add optional `cwd?: string` parameter, pass `-c <cwd>` to tmux when provided

## Phase 2: Core Implementation

- [x] T003 Create `src/app/api/directories/route.ts` — `GET` handler that accepts `prefix` query param, expands tilde, reads directory with `fs.readdir({ withFileTypes: true })`, filters to directories matching prefix, returns `{ directories: string[] }` with tilde-prefixed paths
- [x] T004 Update `POST /api/sessions` `createSession` action in `src/app/api/sessions/route.ts` — accept optional `cwd` field, validate with `validatePath`, expand tilde, pass to `createSession(name, cwd)`

## Phase 3: Integration & Edge Cases

- [x] T005 Update Create Session dialog in `src/app/dashboard-client.tsx` — add quick picks section (deduplicated project roots from `sessions`), path input with debounced autocomplete calling `/api/directories`, session name auto-derivation from last path segment, send `cwd` in create request
- [x] T006 Register "Create session" keyboard shortcut and any new actions in the command palette within `src/app/dashboard-client.tsx`

## Phase 4: Polish

- [x] T007 Verify end-to-end: `pnpm build` passes, type check clean (`npx tsc --noEmit`)

---

## Execution Order

- T001 and T002 are independent, can run in parallel
- T003 depends on T001 (expandTilde utility)
- T004 depends on T001 (expandTilde) and T002 (createSession cwd param)
- T005 depends on T003 (directories API) and T004 (createSession cwd)
- T006 is part of T005 (same file), runs sequentially after
- T007 runs last
