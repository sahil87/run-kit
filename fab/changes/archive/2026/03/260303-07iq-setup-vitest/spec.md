# Spec: Set Up Vitest Testing Infrastructure

**Change**: 260303-07iq-setup-vitest
**Created**: 2026-03-05
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Playwright or E2E testing — deferred to a separate change
- CI pipeline integration — no CI exists yet; out of scope
- Tests for tmux.ts, use-keyboard-nav.ts, or API routes — deferred to a follow-up change

## Testing Infrastructure: Vitest Configuration

### Requirement: Vitest as the project test runner

The project SHALL use Vitest as its test framework. Vitest MUST be installed as a devDependency along with the React testing ecosystem: `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom`.

#### Scenario: Install test dependencies

- **GIVEN** a fresh checkout of run-kit with no testing dependencies
- **WHEN** `pnpm install` completes
- **THEN** `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` are present in `node_modules/`
- **AND** all five packages appear in `devDependencies` in `package.json`

### Requirement: Vitest configuration file

A `vitest.config.ts` file MUST exist at the repo root. The configuration SHALL:

1. Use `@vitejs/plugin-react` for JSX transformation
2. Set `environment: "jsdom"` for browser-like DOM simulation
3. Configure the `@/` path alias to resolve to `./src/` (matching `tsconfig.json` paths)
4. Reference a setup file for `@testing-library/jest-dom` matchers
5. Set `include` pattern for `**/*.test.{ts,tsx}` to support co-located test files

#### Scenario: Path alias resolution in tests

- **GIVEN** a test file that imports from `@/lib/validate`
- **WHEN** Vitest resolves the import
- **THEN** the import resolves to `./src/lib/validate.ts`

#### Scenario: jsdom environment available in tests

- **GIVEN** a test file using DOM APIs (e.g., `document.createElement`)
- **WHEN** Vitest executes the test
- **THEN** the jsdom environment provides the DOM APIs without error

### Requirement: Test setup file

A setup file MUST exist at `src/test-setup.ts`. This file SHALL import `@testing-library/jest-dom` to make extended DOM matchers (e.g., `toBeInTheDocument`, `toBeDisabled`) available in all test files globally.

#### Scenario: jest-dom matchers available

- **GIVEN** the test setup file is configured in `vitest.config.ts`
- **WHEN** a test file uses `expect(element).toBeInTheDocument()`
- **THEN** the matcher resolves and executes without "unknown matcher" errors

### Requirement: Package.json test scripts

`package.json` MUST include two test scripts:

- `"test": "vitest run"` — single run for CI and verification gates
- `"test:watch": "vitest"` — watch mode for development

#### Scenario: Run tests via pnpm

- **GIVEN** the test scripts are defined in `package.json`
- **WHEN** a developer runs `pnpm test`
- **THEN** Vitest executes all `**/*.test.{ts,tsx}` files and exits with code 0 if all pass

## Testing Infrastructure: Smoke Test

### Requirement: Smoke test for validate.ts

A smoke test file MUST exist at `src/lib/validate.test.ts` that tests the existing `validateName` function from `src/lib/validate.ts`. This test SHALL verify that the test runner, path alias resolution, and basic assertions all work end-to-end.

The smoke test SHOULD cover:

1. Valid names return `null`
2. Empty/whitespace names return an error message
3. Names with forbidden characters return an error message
4. Names exceeding max length return an error message
5. Names containing colons or periods return an error message

#### Scenario: Smoke test passes on clean setup

- **GIVEN** all test infrastructure is configured
- **WHEN** `pnpm test` is executed
- **THEN** `src/lib/validate.test.ts` passes with all assertions green
- **AND** the exit code is 0

#### Scenario: Valid name accepted

- **GIVEN** the `validateName` function from `src/lib/validate.ts`
- **WHEN** called with `("my-session", "Session name")`
- **THEN** the return value is `null`

#### Scenario: Empty name rejected

- **GIVEN** the `validateName` function
- **WHEN** called with `("", "Session name")`
- **THEN** the return value contains "cannot be empty"

#### Scenario: Forbidden characters rejected

- **GIVEN** the `validateName` function
- **WHEN** called with `("my;session", "Session name")`
- **THEN** the return value contains "forbidden characters"

#### Scenario: Colon rejected

- **GIVEN** the `validateName` function
- **WHEN** called with `("my:session", "Session name")`
- **THEN** the return value contains "colons or periods"

## Feature Tests: config.ts

### Requirement: Port validation tests

Tests SHALL exist at `src/lib/config.test.ts` verifying the `validPort` logic and config resolution. Since `config.ts` executes at module load (top-level `const config = ...`), tests use `vi.resetModules()` + dynamic re-import to test different `process.argv` configurations.

**Limitation**: Mocking `node:fs` with `vi.resetModules()` is not viable in Vitest 4 due to CJS/ESM interop issues with built-in Node modules. YAML reading is tested naturally (no `run-kit.yaml` in test env → ENOENT → defaults). The `validPort` logic is exercised indirectly through CLI arg parsing.

The test file SHOULD cover:

1. `validPort` rejects non-integer, negative, zero, and >65535 values (via CLI args)
2. `validPort` accepts integers in 1–65535 range (via CLI args)
3. Missing `run-kit.yaml` falls back to defaults silently (natural ENOENT)
4. CLI `--port`, `--relay-port`, `--host` override defaults
5. Invalid CLI port values are rejected (defaults used)
6. Port boundary values (1 and 65535) accepted
7. `process.argv` is restored after tests to prevent pollution

#### Scenario: Valid port accepted

- **GIVEN** the port validation logic
- **WHEN** called with `3000`
- **THEN** the value `3000` is returned

#### Scenario: Out-of-range port rejected

- **GIVEN** the port validation logic
- **WHEN** called with `70000`
- **THEN** `undefined` is returned

#### Scenario: Non-integer port rejected

- **GIVEN** the port validation logic
- **WHEN** called with `3000.5`
- **THEN** `undefined` is returned

#### Scenario: Missing YAML uses defaults

- **GIVEN** no `run-kit.yaml` exists on disk
- **WHEN** config is resolved
- **THEN** `config.port` is `3000`, `config.relayPort` is `3001`, `config.host` is `"127.0.0.1"`

#### Scenario: YAML overrides defaults

- **GIVEN** a `run-kit.yaml` with `server.port: 4000`
- **WHEN** config is resolved
- **THEN** `config.port` is `4000` and other fields retain defaults

## Feature Tests: command-palette.tsx

### Requirement: Command palette interaction tests

Tests SHALL exist at `src/components/command-palette.test.tsx` verifying the `CommandPalette` component's rendering and keyboard interaction. Tests MUST use `@testing-library/react` for rendering and `fireEvent` or `userEvent` for interaction simulation.

The test file SHOULD cover:

1. Palette is not visible by default (returns null when closed)
2. Cmd+K toggles the palette open
3. Typing in the search input filters actions by label (case-insensitive)
4. ArrowDown/ArrowUp navigates the selected action
5. Enter selects the currently highlighted action and calls `onSelect`
6. Escape closes the palette
7. Clicking the backdrop closes the palette
8. "No results" message shown when filter matches nothing
9. Shortcut badges render when `shortcut` prop is provided

#### Scenario: Palette hidden by default

- **GIVEN** a `CommandPalette` rendered with a list of actions
- **WHEN** no interaction has occurred
- **THEN** no palette UI is visible in the document

#### Scenario: Cmd+K opens palette

- **GIVEN** a `CommandPalette` rendered with actions
- **WHEN** the user presses `Cmd+K`
- **THEN** the palette UI becomes visible
- **AND** the search input is focused

#### Scenario: Filtering narrows results

- **GIVEN** the palette is open with actions `["New Session", "Kill Window", "New Window"]`
- **WHEN** the user types `"new"` in the search input
- **THEN** only `"New Session"` and `"New Window"` are visible

#### Scenario: Enter selects action

- **GIVEN** the palette is open with actions and the first action is highlighted
- **WHEN** the user presses `Enter`
- **THEN** the first action's `onSelect` callback is invoked
- **AND** the palette closes

#### Scenario: Escape closes palette

- **GIVEN** the palette is open
- **WHEN** the user presses `Escape`
- **THEN** the palette is no longer visible

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Vitest as test framework | Confirmed from intake #1 — user explicitly chose Vitest | S:95 R:90 A:90 D:95 |
| 2 | Certain | Playwright deferred to separate change | Confirmed from intake #2 — user agreed | S:90 R:95 A:85 D:90 |
| 3 | Certain | Co-located .test.{ts,tsx} files | Confirmed from intake #3 — code-quality.md declares test-alongside | S:90 R:90 A:95 D:95 |
| 4 | Certain | Feature tests for validate.ts, config.ts, command-palette.tsx in this change | User explicitly chose these three from candidate scan; tmux/keyboard-nav/api-route deferred to follow-up | S:95 R:95 A:95 D:95 |
| 5 | Certain | validate.ts as smoke test target | Upgraded from intake #5 (Confident) — real code, pure logic, verifies path aliases | S:80 R:95 A:90 D:85 |
| 6 | Certain | Setup file at src/test-setup.ts | Upgraded from intake #6 (Confident) — standard Vitest convention, co-located with source per project patterns | S:75 R:95 A:90 D:85 |
| 7 | Certain | vitest.config.ts at repo root (separate from next.config.ts) | Vitest docs recommend standalone config for Next.js projects; avoids coupling test config to build config | S:85 R:95 A:90 D:90 |
| 8 | Confident | config.ts tests mock readFileSync and process.argv | Module executes at load time; testing resolution logic requires mocking I/O at the fs/process level | S:70 R:90 A:80 D:75 |
| 9 | Confident | command-palette tests use fireEvent for keyboard simulation | Standard @testing-library/react approach; userEvent is heavier and not yet a dependency | S:65 R:95 A:85 D:75 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
