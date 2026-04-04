# Tasks: Optimistic UI Feedback

**Change**: 260403-32la-optimistic-ui-feedback
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Create `useOptimisticAction` hook at `app/frontend/src/hooks/use-optimistic-action.ts` — implement the core hook with `execute`, `isPending`, unmount guard, and all optional callbacks (`onOptimistic`, `onRollback`, `onSettled`, `onError`). Add unit tests in `app/frontend/src/hooks/use-optimistic-action.test.ts`
- [x] T002 [P] Create toast system: `ToastProvider` context and `Toast` component at `app/frontend/src/components/toast.tsx` — auto-dismiss after 4s, error/info variants, bottom-right fixed positioning, stacked, theme-aware styling (`bg-bg-card border border-border`, ANSI accent colors). Add `ToastProvider` to the component tree in `app/frontend/src/app.tsx`. Add unit tests in `app/frontend/src/components/toast.test.tsx`
- [x] T003 [P] Create `OptimisticProvider` context at `app/frontend/src/contexts/optimistic-context.tsx` — manages ghost sessions/windows/servers, exposes `addGhost`, `removeGhost`, `markKilled`, `markRenamed`, and `useMergedSessions` (merges optimistic entries with real SSE data). Wire into the component tree in `app/frontend/src/app.tsx` wrapping `SessionProvider` consumers. Add unit tests in `app/frontend/src/contexts/optimistic-context.test.tsx`

## Phase 2: Core Implementation

- [x] T004 Migrate session CRUD to optimistic pattern — update `app/frontend/src/components/create-session-dialog.tsx` (create session: ghost entry + retain inline errors), `app/frontend/src/hooks/use-dialog-state.ts` (rename session: optimistic name update, kill session: optimistic removal), and `app/frontend/src/components/sidebar.tsx` (Ctrl+click kill: optimistic removal). All call sites use `useOptimisticAction` with `onError` calling `addToast`
- [x] T005 Migrate window CRUD to optimistic pattern — update `app/frontend/src/app.tsx` (handleCreateWindow: ghost window entry), `app/frontend/src/components/sidebar.tsx` (rename window: optimistic inline update, kill window: optimistic removal, "+" button: ghost window), `app/frontend/src/components/top-bar.tsx` (breadcrumb "+ New Window": ghost window). All call sites use `useOptimisticAction`
- [x] T006 [P] Migrate server CRUD to optimistic pattern — update `app/frontend/src/components/server-list-page.tsx` (create server: ghost card) and `app/frontend/src/app.tsx` (handleKillServer: optimistic removal). All call sites use `useOptimisticAction`
- [x] T007 [P] Add button loading states to fire-and-forget actions — update `SplitButton` and `ClosePaneButton` in `app/frontend/src/components/top-bar.tsx` to use `useOptimisticAction` with `isPending` driving disabled/spinner state. Add CSS spinner (small `animate-spin` element)

## Phase 3: Integration & Edge Cases

- [x] T008 Wire config reload feedback — update command palette config actions in `app/frontend/src/app.tsx` to use `useOptimisticAction` with `onSettled` showing info toast "Tmux config reloaded" and `onError` showing error toast
- [x] T009 [P] Wire file upload indicator — render the existing `uploading` boolean from `use-file-upload.ts` as an "Uploading..." badge in `app/frontend/src/components/terminal-client.tsx` (above bottom bar, `text-xs text-text-secondary`)
- [x] T010 [P] Add directory autocomplete spinner — update `app/frontend/src/components/create-session-dialog.tsx` to show a small spinner in the path input trailing slot while directory suggestions are fetching
- [x] T011 [P] Add server list refresh spinner — update `app/frontend/src/components/sidebar.tsx` server dropdown trigger to show a spinner while server list is re-fetching
- [x] T012 Update sidebar and dashboard to consume `useMergedSessions` from `OptimisticProvider` instead of raw `sessions` from `SessionProvider` — ensure ghost entries render with `opacity-50 animate-pulse` styling and killed entries are filtered out. Update `app/frontend/src/components/sidebar.tsx`, `app/frontend/src/components/dashboard.tsx`, and `app/frontend/src/app.tsx`

## Phase 4: Polish

- [x] T013 Add integration tests — test ghost entry lifecycle (create → SSE reconciliation → ghost cleared) and rollback (create → API failure → ghost removed + toast shown) in `app/frontend/src/hooks/use-optimistic-action.test.ts` and `app/frontend/src/contexts/optimistic-context.test.tsx`

---

## Execution Order

- T001, T002, T003 are independent (Phase 1 parallelizable)
- T004 and T005 depend on T001, T002, T003 (need hook, toast, and optimistic context)
- T006 and T007 depend on T001 and T002 (need hook and toast, but not necessarily optimistic context for T007)
- T008-T012 depend on T001 and T002 (hook and toast)
- T012 depends on T003 (optimistic context)
- T013 depends on all prior tasks
