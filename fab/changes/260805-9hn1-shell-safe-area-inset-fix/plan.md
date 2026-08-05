# Plan: Shell Safe-Area Inset Fix

**Change**: 260805-9hn1-shell-safe-area-inset-fix
**Intake**: `intake.md`

## Requirements

### Frontend: Top-Bar Safe-Area Guard

#### R1: Safe-area padding gated on `isShell()`
The top bar's `<header>` (`app/frontend/src/components/top-bar.tsx`, ~line 794) MUST carry the `pt-[env(safe-area-inset-top)]` class when `isShell()` is false and MUST NOT carry it when `isShell()` is true. The gate SHALL use a conditional template literal (no `cn()` utility exists in this codebase) with `isShell` imported from `@/lib/shell`, read once per render (the shell preload injects `window.runkitShell` before any SPA script runs, so the value is stable for the page's lifetime — no subscription/reactivity). The adjacent comment MUST state the interaction rule: the guard is for standalone-PWA `viewport-fit=cover`; inside the desktop shell the titlebar strip already reserves the titlebar band and macOS hidden-titlebar windows can report that band as `safe-area-inset-top`, so the padding is dropped in-shell to avoid double reservation.

- **GIVEN** the SPA is running in a plain browser or standalone PWA (`window.runkitShell` absent)
- **WHEN** the top bar renders
- **THEN** the `<header>` className contains `pt-[env(safe-area-inset-top)]` — byte-identical behavior to today

- **GIVEN** the SPA is running inside the desktop shell (`window.runkitShell` injected, well-formed)
- **WHEN** the top bar renders
- **THEN** the `<header>` className does NOT contain `pt-[env(safe-area-inset-top)]` (the `ShellTitlebarStrip` already reserves the titlebar band; no second reservation)

#### R2: Unit test coverage for the gate
`app/frontend/src/components/top-bar.test.tsx` MUST assert, on the rendered `<header>`, that the safe-area class is present when `isShell()` is false (default jsdom — `window.runkitShell` absent) and absent when `isShell()` is true. The test SHALL drive `isShell()` through its real seam — setting `window.runkitShell = { version: …, platform: … }` before render and deleting it in cleanup (the pattern in `app/frontend/src/lib/shell.test.ts`) — not `vi.mock("@/lib/shell")`. The existing test harness (router-hook mocks, ChromeProvider/ThemeProvider/ToastProvider wrappers, `renderTopBar`) is reused as-is.

- **GIVEN** the top-bar vitest suite with `window.runkitShell` absent (jsdom default)
- **WHEN** `TopBar` is rendered
- **THEN** the header element's className contains `pt-[env(safe-area-inset-top)]`

- **GIVEN** `window.runkitShell` set to a well-formed bridge before render
- **WHEN** `TopBar` is rendered
- **THEN** the header element's className does not contain `pt-[env(safe-area-inset-top)]`
- **AND** the bridge is deleted in cleanup so no state leaks into other tests

### Non-Goals

- Bottom bar (`bottom-bar.tsx` `pb-[max(0.375rem,env(safe-area-inset-bottom))]`) — the `max()` floor degrades to the normal 6px at inset 0; no shell symptom implicates it
- `app/desktop` (shell side) — no changes
- Memory files (`docs/memory/run-kit/ui-patterns.md`, `desktop-shell.md`) — written at the hydrate stage, not apply
- The DevTools probe / Electron-native paint investigation — explicitly not a blocker; reopens as a separate change only if the band survives this fix in a release build
- Playwright e2e coverage — `isShell()` is false in e2e; the unit test + a manual in-shell check post-release are the coverage surface

## Tasks

### Phase 2: Core Implementation

- [x] T001 Gate `pt-[env(safe-area-inset-top)]` on `isShell()` in `app/frontend/src/components/top-bar.tsx` (~line 794): import `isShell` from `@/lib/shell`, switch the header className to a conditional template literal (class present when `isShell()` false, absent when true), and rewrite the adjacent comment to state the double-reservation interaction rule <!-- R1 -->
- [x] T002 Add a describe block to `app/frontend/src/components/top-bar.test.tsx` asserting the safe-area class on the rendered `<header>`: present with `window.runkitShell` absent (default jsdom), absent with a well-formed `window.runkitShell` injected before render and deleted in cleanup (shell.test.ts pattern; reuse the existing `renderTopBar` harness) <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Verification: `cd app/frontend && npx tsc --noEmit`, then `just test-frontend` (full vitest suite; scope to top-bar.test.tsx first if iterating). Do NOT run e2e <!-- R1, R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The top-bar `<header>` className contains `pt-[env(safe-area-inset-top)]` when `isShell()` is false and does not contain it when `isShell()` is true; `isShell` is imported from `@/lib/shell` and read via a conditional template literal
- [x] A-002 R2: top-bar.test.tsx contains assertions covering both branches (class present with bridge absent, class absent with bridge injected), driven via `window.runkitShell` injection/deletion rather than `vi.mock`

### Behavioral Correctness

- [x] A-003 R1: Browser/PWA rendering is byte-identical to before — the class (and the rest of the header className: `px-3 … border-b-[3px] border-border`) is unchanged when `isShell()` is false; only the in-shell render drops the padding class
- [x] A-004 R1: The adjacent comment states the interaction rule (strip reserves the titlebar band; macOS hidden-titlebar windows can report it as `safe-area-inset-top`; padding dropped in-shell to avoid double reservation) — the stale "env() is 0 in browsers/desktop" claim is gone

### Scenario Coverage

- [x] A-005 R2: `just test-frontend` passes including the new assertions; `npx tsc --noEmit` is clean; no e2e run (not covered by this change)

### Edge Cases & Error Handling

- [x] A-006 R2: The injected-bridge test cleans up `window.runkitShell` (afterEach/finally deletion) so subsequent tests in the suite still see `isShell()` false

### Code Quality

- [x] A-007 Pattern consistency: The conditional template literal matches local className patterns; the test follows the shell.test.ts bridge-injection pattern and reuses the existing harness
- [x] A-008 No unnecessary duplication: Existing `isShell()` seam reused — no new detection logic, no new utilities

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The gate replaces the static header className in place; no symbol, branch, or config became unused.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Query the header in tests via `screen.getByRole("banner")` (the intake's suggested locator — `<header>` maps to the `banner` landmark in jsdom/Testing Library) | Intake offers "getByRole(\"banner\") or equivalent"; banner role is the idiomatic Testing Library locator and the header is the only banner in the tree | S:80 R:95 A:90 D:85 |

1 assumptions (0 certain, 1 confident, 0 tentative).
