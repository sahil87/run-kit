# Intake: Set Up Vitest Testing Infrastructure

**Change**: 260303-07iq-setup-vitest
**Created**: 2026-03-03
**Status**: Draft

## Origin

> During discussion of the unified-top-bar change, the question of test cases came up. The project currently has zero testing infrastructure — no framework, no config, no test files. User confirmed "vitest and/or playwright." Recommendation was to set up Vitest first as a foundational change, defer Playwright E2E to a separate change later.

Interaction mode: conversational (arose from top-bar discussion). Framework choice resolved during discussion.

## Why

1. **No testing exists**: The project has no test framework configured despite `code-quality.md` declaring a "test-alongside" strategy. There are zero test files, no test script in `package.json`, no config.
2. **Blocking downstream work**: The unified-top-bar change (and every future change) needs a test framework to write tests alongside implementation. Without this foundation, "test-alongside" is aspirational only.
3. **Constitution says tests verify spec conformance**: "Tests MUST conform to the implementation spec." This requires a working test runner to be meaningful.

If we don't do this: every subsequent change either ships without tests or has to set up the framework as a side-task, bloating scope.

## What Changes

### Install Dependencies

Add as devDependencies:

```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- **vitest** — test runner, compatible with Vite/Next.js ecosystem
- **@vitejs/plugin-react** — React JSX transform for Vitest
- **@testing-library/react** — component rendering and querying
- **@testing-library/jest-dom** — DOM matchers (`toBeInTheDocument`, `toBeDisabled`, etc.)
- **jsdom** — browser environment simulation

### Create `vitest.config.ts`

At the repo root. Configuration should:

- Use `@vitejs/plugin-react` for JSX
- Set `environment: "jsdom"` for browser-like DOM
- Set up path aliases matching `tsconfig.json` (the project uses `@/` → `src/`)
- Include `@testing-library/jest-dom` setup file for extended matchers
- Set `include` pattern for `**/*.test.{ts,tsx}` (co-located test-alongside pattern)

### Create Test Setup File

A `src/test-setup.ts` (or similar) that imports `@testing-library/jest-dom` to make matchers available globally.

### Add `test` Script to `package.json`

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Add Smoke Test

A single minimal test to verify the setup works end-to-end. Candidates:

- `src/lib/validate.test.ts` — test the existing `validateName` function (pure logic, no React needed, verifies Vitest itself works)
- Or a trivial `src/smoke.test.ts` that asserts `1 + 1 === 2`

The `validate.ts` option is better — it tests real code and verifies the path alias resolution works.

### No Feature Tests

This change does NOT add tests for existing components. Each subsequent change (starting with unified-top-bar) writes its own tests alongside its implementation per the test-alongside strategy.

## Affected Memory

- `run-kit/architecture`: (modify) Note testing infrastructure in the system overview (framework, config location)

## Impact

- **New files**: `vitest.config.ts`, `src/test-setup.ts`, one smoke test file
- **Modified files**: `package.json` (scripts + devDependencies)
- **No source code changes** — purely additive infrastructure
- **CI**: Not addressed in this change (no CI pipeline exists yet)

## Open Questions

None — framework choice and scope resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Vitest as test framework | Discussed — user confirmed "vitest" | S:95 R:90 A:90 D:95 |
| 2 | Certain | Playwright deferred to separate change | Discussed — recommended Vitest-only, user agreed to separate change | S:90 R:95 A:85 D:90 |
| 3 | Certain | Co-located .test.tsx files (test-alongside) | code-quality.md declares "test-alongside" strategy | S:90 R:90 A:95 D:95 |
| 4 | Certain | No feature tests in this change | Discussed — foundational only, smoke test to verify setup | S:90 R:95 A:90 D:95 |
| 5 | Confident | validate.ts as smoke test target | Real code, pure logic, verifies path aliases — better than trivial assert | S:60 R:95 A:85 D:75 |
| 6 | Confident | Setup file at src/test-setup.ts | Standard Vitest convention for jest-dom imports; co-located with source | S:55 R:95 A:85 D:80 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).