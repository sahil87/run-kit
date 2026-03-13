# Quality Checklist: Cleanup Old Implementation

**Change**: 260312-n11e-cleanup-old-implementation
**Generated**: 2026-03-12
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Remove Legacy Backend: `packages/api/` no longer exists
- [x] CHK-002 Remove Legacy Frontend: `packages/web/` no longer exists
- [x] CHK-003 Remove Legacy E2E: `e2e/` no longer exists
- [x] CHK-004 Remove Root Playwright Config: root `playwright.config.ts` no longer exists
- [x] CHK-005 Update pnpm Workspace: `pnpm-workspace.yaml` contains only `["app/frontend"]`
- [x] CHK-006 Clean Root package.json: old scripts and `@playwright/test` removed

## Removal Verification
- [x] CHK-007 No stale `packages/` references: `git grep 'packages/' -- ':!fab/' ':!pnpm-lock.yaml' ':!.gitignore'` returns zero matches
- [x] CHK-008 No stale `e2e/` references: `git grep '"e2e/'` returns zero matches outside `app/frontend/`

## Scenario Coverage
- [x] CHK-009 Workspace updated: `pnpm install` succeeds with updated workspace config
- [x] CHK-010 Build passes: `just check` + `just test-backend` + `just test-frontend` exit 0 (E2E failures are pre-existing per T010)

## Code Quality
- [x] CHK-011 Pattern consistency: documentation updates follow existing formatting conventions in memory files
- [x] CHK-012 No unnecessary duplication: no leftover references to deleted paths (aside from CHK-011 issue)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
