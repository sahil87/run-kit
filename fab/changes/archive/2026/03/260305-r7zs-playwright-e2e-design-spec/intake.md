# Intake: Playwright E2E Tests for UI Design Spec

**Change**: 260305-r7zs-playwright-e2e-design-spec
**Created**: 2026-03-05
**Status**: Draft

## Origin

> During the UI design philosophy discussion, the need for E2E testing was identified as an open design question in `docs/specs/design.md`. The three UI changes (chrome architecture, bottom bar, mobile polish) introduce structural and interactive behavior that cannot be verified by unit tests alone — fixed chrome stability across navigation, modifier key WebSocket integration, compose buffer flow, iOS keyboard adaptation, and mobile responsive collapse all require a real browser.

Interaction mode: conversational (arose from design philosophy session + testing strategy discussion). Scope identified during gap analysis.

**Depends on**: All three UI design changes must be complete:
- `260305-emla-fixed-chrome-architecture` (1/3 chrome)
- `260305-fjh1-bottom-bar-compose-buffer` (2/3 bottom bar)
- `260305-ol5d-mobile-responsive-polish` (3/3 mobile)

## Why

1. **Fixed chrome is a pixel-level guarantee**: The design spec's core promise is that the top bar never shifts between pages. This can only be verified by navigating between all 3 pages in a real browser and asserting the top bar's bounding box doesn't change.
2. **Bottom bar requires WebSocket integration testing**: Modifier keys must send correct ANSI escape sequences through the WebSocket to the terminal. Unit tests can verify state management, but E2E tests verify the full path: button click → armed state → key send → terminal receives correct bytes.
3. **Compose buffer is a multi-step flow**: Open overlay → type/dictate → send burst → verify terminal received text. This crosses component boundaries (textarea overlay, WebSocket, terminal relay, xterm rendering).
4. **Mobile behavior needs real viewport testing**: Line 2 collapse, `⋯` command palette trigger, 44px touch targets, and `visualViewport` keyboard detection all depend on actual viewport dimensions and CSS media queries.
5. **Vitest can't cover these**: jsdom doesn't have real layout, WebSocket connections, or viewport dimensions. These are inherently E2E concerns.

If we don't do this: the design spec's guarantees are aspirational — no automated verification that the chrome doesn't shift, the bottom bar works, or mobile layout collapses correctly.

## What Changes

### Install Playwright

```bash
pnpm add -D @playwright/test
npx playwright install chromium webkit
```

- **Chromium** for desktop testing
- **WebKit** for iOS Safari simulation (mobile viewport + `visualViewport` behavior)
- No Firefox needed initially — can add later

### Playwright Config (`playwright.config.ts`)

```typescript
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

E2E tests live in `e2e/` at the repo root (not `__tests__/` — different runner, different convention).

### Test Scripts in `package.json`

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

### Test Suite: Fixed Chrome Stability (`e2e/chrome-stability.spec.ts`)

Verifies the core design promise — top bar never shifts.

- Navigate to Dashboard → capture top bar bounding box (y, height)
- Navigate to Project page → assert same bounding box
- Navigate to Terminal page → assert same bounding box
- Navigate back to Dashboard → assert same bounding box
- Verify Line 2 has consistent height on all pages (even when empty)
- Verify `max-w-4xl` is applied to chrome and content on all pages

### Test Suite: Breadcrumbs (`e2e/breadcrumbs.spec.ts`)

- Dashboard: only logo visible, no text breadcrumbs
- Project page: logo › ⬡ + session name
- Terminal page: logo › ⬡ + session name › ❯ + window name
- Each non-final segment is a clickable link
- No "project:" or "window:" text prefixes anywhere

### Test Suite: Bottom Bar (`e2e/bottom-bar.spec.ts`)

- Bottom bar visible on terminal page only
- Bottom bar hidden on Dashboard and Project pages
- Modifier keys: click Ctrl → visual armed state → type 'c' → verify Ctrl+C sent
- Arrow keys: click ↑ → verify up-arrow escape sequence sent
- Fn dropdown: open → select F1 → dropdown closes → F1 escape sequence sent
- Esc and Tab buttons send correct sequences

### Test Suite: Compose Buffer (`e2e/compose-buffer.spec.ts`)

- Click ✎ → textarea overlay appears, terminal dims
- Type text in textarea → verify it's local only (nothing sent yet)
- Click Send → entire text appears in terminal output
- Textarea dismisses after send
- Multiline text works (paste a code block, send, verify)

### Test Suite: Mobile Viewport (`e2e/mobile.spec.ts`)

Uses the `mobile` project (iPhone 14 viewport):

- Line 2 actions hidden, status text visible, `⋯` button visible
- Tap `⋯` → command palette opens with page actions
- `⌘K` hint hidden on mobile
- All interactive elements ≥ 44px tap height (measure bounding boxes)
- Terminal font smaller than desktop (10-11px vs 13px)
- Content goes full-width (no max-w-4xl constraint on narrow screens)
- Bottom bar renders above the simulated keyboard area

### Test Suite: Kill Button Visibility (`e2e/kill-button.spec.ts`)

- Kill button (✕) visible on SessionCard without hover
- Kill button visible on project header without hover
- Click ✕ → confirmation dialog appears

## Affected Memory

- `run-kit/architecture`: (modify) Note Playwright E2E setup, test directory structure (`e2e/`), browser targets

## Impact

- **New files**: `playwright.config.ts`, `e2e/chrome-stability.spec.ts`, `e2e/breadcrumbs.spec.ts`, `e2e/bottom-bar.spec.ts`, `e2e/compose-buffer.spec.ts`, `e2e/mobile.spec.ts`, `e2e/kill-button.spec.ts`
- **Modified files**: `package.json` (scripts + devDependency)
- **No source code changes** — purely additive test infrastructure + tests
- **CI consideration**: Playwright tests need a running server + tmux. May need `webServer` config to start `pnpm dev`. Tests that interact with terminals need at least one tmux session running.
- **Test data**: Some tests require a tmux session to exist. Tests should create/teardown sessions via the API or assume a running tmux server.

## Open Questions

None — scope identified during design discussion and gap analysis.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Playwright as E2E framework | Discussed — user mentioned Playwright specifically during testing strategy | S:90 R:90 A:90 D:95 |
| 2 | Certain | Depends on all 3 UI design changes | Discussed — tests verify the integrated result of emla + fjh1 + ol5d | S:90 R:85 A:90 D:90 |
| 3 | Certain | E2E tests in `e2e/` directory (not `__tests__/`) | Different runner (Playwright vs Vitest), different convention. `__tests__/` is for unit tests. | S:80 R:95 A:85 D:85 |
| 4 | Certain | Chromium + WebKit browsers | Discussed — Chromium for desktop, WebKit for iOS Safari mobile simulation | S:80 R:90 A:85 D:85 |
| 5 | Confident | iPhone 14 as mobile viewport target | Common reference device, 390px width. Exact device can be adjusted. | S:55 R:95 A:80 D:75 |
| 6 | Confident | Chrome stability test via bounding box assertion | Standard Playwright approach — `locator.boundingBox()` returns {x, y, width, height}. Compare across navigations. | S:60 R:90 A:85 D:80 |
| 7 | Confident | Tests create/teardown tmux sessions via API | Tests need real tmux state. Using the existing POST /api/sessions endpoint keeps tests self-contained. | S:55 R:85 A:80 D:75 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
