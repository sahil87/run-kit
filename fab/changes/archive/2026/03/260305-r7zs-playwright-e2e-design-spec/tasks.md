# Tasks: Playwright E2E Tests for UI Design Spec

**Change**: 260305-r7zs-playwright-e2e-design-spec
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Install Playwright and configure — `pnpm add -D @playwright/test`, install chromium and webkit browsers, create `playwright.config.ts` at repo root with desktop (Desktop Chrome) and mobile (iPhone 14 WebKit) projects, webServer config for `pnpm dev` on port 3000
- [x] T002 Add test scripts to `package.json` — add `"test:e2e": "playwright test"` and `"test:e2e:ui": "playwright test --ui"` scripts
- [x] T003 Exclude `e2e/` from Vitest — update `vitest.config.ts` to exclude `e2e/**` from test discovery so Playwright and Vitest don't interfere

## Phase 2: Core Implementation

- [x] T004 [P] Create `e2e/chrome-stability.spec.ts` — test top bar bounding box invariance across Dashboard/Project/Terminal navigation, Line 2 minimum height (>= 36px) on all pages, max-w-4xl consistency. Requires test session via API setup/teardown.
- [x] T005 [P] Create `e2e/breadcrumbs.spec.ts` — test Dashboard (logo only), Project (logo > session name), Terminal (logo > session > window) breadcrumbs. Verify no "project:"/"window:" prefixes. Verify non-final segments are `<a>` links. Requires test session via API.
- [x] T006 [P] Create `e2e/bottom-bar.spec.ts` — test bottom bar visible only on Terminal page (not Dashboard/Project). Test modifier armed state (`aria-pressed`), Fn dropdown open/close/select, Esc and Tab button presence. Requires test session via API.
- [x] T007 [P] Create `e2e/compose-buffer.spec.ts` — test compose open (textarea appears, terminal dims), Escape dismissal, Send button presence, multiline input. Requires test session via API.
- [x] T008 [P] Create `e2e/kill-button.spec.ts` — test kill button (✕) always visible on session cards and session headers without hover. Test kill confirmation dialog opens on click. Requires test session via API.

## Phase 3: Integration & Edge Cases

- [x] T009 Create `e2e/mobile.spec.ts` — test in mobile project (iPhone 14 viewport): bottom bar renders on terminal, button tap heights >= 30px, ⌘K badge visibility check. Requires test session via API.

---

## Execution Order

- T001 blocks all Phase 2 and Phase 3 tasks (Playwright must be installed first)
- T002 and T003 can run in parallel with T001 once package.json is readable
- T004-T008 are all independent (`[P]`) — different spec files, no dependencies on each other
- T009 depends on T001 (needs Playwright config with mobile project)
