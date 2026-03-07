# Quality Checklist: Playwright E2E Tests for UI Design Spec

**Change**: 260305-r7zs-playwright-e2e-design-spec
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Playwright config: `playwright.config.ts` exists with desktop and mobile projects, webServer config, testDir `e2e/`
- [x] CHK-002 Test scripts: `package.json` includes `test:e2e` and `test:e2e:ui` scripts
- [x] CHK-003 Test isolation: `e2e/` excluded from Vitest, `__tests__/` excluded from Playwright
- [x] CHK-004 Chrome stability tests: `e2e/chrome-stability.spec.ts` covers bounding box invariance, Line 2 height, max-width
- [x] CHK-005 Breadcrumb tests: `e2e/breadcrumbs.spec.ts` covers all three page depths with correct segments and links
- [x] CHK-006 Bottom bar tests: `e2e/bottom-bar.spec.ts` covers page scope, modifier armed state, Fn dropdown, special keys
- [x] CHK-007 Compose buffer tests: `e2e/compose-buffer.spec.ts` covers open/close, send button, multiline
- [x] CHK-008 Kill button tests: `e2e/kill-button.spec.ts` covers always-visible kill buttons and confirmation dialog
- [x] CHK-009 Mobile tests: `e2e/mobile.spec.ts` covers mobile viewport bottom bar, tap target sizes

## Behavioral Correctness
- [x] CHK-010 Session management: All test files create/teardown tmux sessions in beforeAll/afterAll hooks
- [x] CHK-011 No flaky selectors: Tests use accessible selectors (aria-label, role, semantic elements), not CSS classes

## Scenario Coverage
- [x] CHK-012 Chrome stability: Navigate Dashboard→Project→Terminal→Dashboard with bounding box assertions
- [x] CHK-013 Breadcrumbs: Verify logo-only on Dashboard, two-segment on Project, three-segment on Terminal
- [x] CHK-014 Bottom bar scope: Verify visible on Terminal, absent on Dashboard and Project
- [x] CHK-015 Compose flow: Open→type→dismiss via Escape
- [x] CHK-016 Kill flow: Click kill→confirmation dialog appears with Cancel and Kill buttons

## Edge Cases & Error Handling
- [x] CHK-017 Empty Line 2: Verify Line 2 maintains min-height even when no action buttons are injected
- [x] CHK-018 Mobile bottom bar: Verify bottom bar renders in mobile viewport on terminal page

## Code Quality
- [x] CHK-019 Pattern consistency: Test files follow Playwright conventions (test.describe, test.beforeAll/afterAll, expect assertions)
- [x] CHK-020 No unnecessary duplication: Shared session setup/teardown extracted into helpers or fixtures
- [x] CHK-021 No `exec` or shell strings: Any subprocess calls in test helpers use `execFile` with argument arrays (per constitution)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
