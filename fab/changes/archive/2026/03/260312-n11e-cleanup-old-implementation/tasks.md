# Tasks: Cleanup Old Implementation

**Change**: 260312-n11e-cleanup-old-implementation
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Deletions

- [x] T001 [P] Delete `packages/` directory entirely (legacy Go backend + legacy Vite frontend)
- [x] T002 [P] Delete `e2e/` directory (legacy Playwright E2E tests)
- [x] T003 [P] Delete root `playwright.config.ts` (config now at `app/frontend/playwright.config.ts`)

## Phase 2: Configuration Updates

- [x] T004 Update `pnpm-workspace.yaml` — remove `packages/web`, keep only `app/frontend`
- [x] T005 Update root `package.json` — remove `test`, `test:e2e`, `test:e2e:ui` scripts and `@playwright/test` devDependency
- [x] T006 Run `pnpm install` to regenerate `pnpm-lock.yaml` after workspace and dependency changes

## Phase 3: Documentation Updates

- [x] T007 [P] Update `docs/memory/run-kit/architecture.md` — remove legacy notes, `packages/` paths, `e2e/` entry from repo structure tree, legacy test sections; update `pnpm-workspace.yaml` reference
- [x] T008 [P] Update `docs/memory/run-kit/ui-patterns.md` — replace any remaining `packages/web/` path references with `app/frontend/` equivalents

## Phase 4: Verification

- [x] T009 Run `git grep 'packages/' -- ':!fab/' ':!pnpm-lock.yaml' ':!.gitignore'` and confirm zero matches
- [x] T010 Run build/test verification (`just verify` or equivalent) and confirm exit 0 (check + unit tests + build pass; E2E failures are pre-existing)

---

## Execution Order

- T001, T002, T003 are independent (parallel)
- T004, T005 depend on T001-T003 (deletions first, then config cleanup)
- T006 depends on T004, T005
- T007, T008 are independent of each other but should run after deletions
- T009, T010 run last (verification after all changes)
