# Tasks: Set Up Vitest Testing Infrastructure

**Change**: 260303-07iq-setup-vitest
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Install test devDependencies: `pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom` — updates `package.json`
- [x] T002 Create `vitest.config.ts` at repo root with React plugin, jsdom environment, `@/` path alias matching `tsconfig.json`, setup file reference, and `**/*.test.{ts,tsx}` include pattern
- [x] T003 Create `src/test-setup.ts` that imports `@testing-library/jest-dom` for global matcher availability
- [x] T004 Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`

## Phase 2: Core Implementation

- [x] T005 Create `src/lib/validate.test.ts` — smoke test for `validateName`: valid names return null, empty/whitespace rejected, forbidden chars rejected, max length rejected, colons/periods rejected. Also test `validatePath` basics.
- [x] T006 Create `src/lib/config.test.ts` — test `validPort` logic (valid range, non-integer, zero, negative, >65535), YAML config reading with mocked `readFileSync` (missing file defaults, partial config merge, malformed YAML warning, invalid port ignored), host string validation
- [x] T007 Create `src/components/command-palette.test.tsx` — test: hidden by default, Cmd+K opens palette, search input filters actions case-insensitively, ArrowDown/ArrowUp navigates, Enter selects and closes, Escape closes, backdrop click closes, "No results" shown for empty filter, shortcut badges render

## Phase 3: Integration & Edge Cases

- [x] T008 Run `pnpm test` to verify all tests pass end-to-end, fix any path alias or configuration issues

---

## Execution Order

- T001 blocks all other tasks (dependencies must be installed first)
- T002, T003, T004 can run in parallel after T001
- T005, T006, T007 depend on T002 + T003 (config and setup file)
- T008 runs last after all test files are written
