# Spec: Cleanup Old Implementation

**Change**: 260312-n11e-cleanup-old-implementation
**Created**: 2026-03-12
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Refactoring or modifying any code in `app/backend/` or `app/frontend/` — this change is deletion and documentation only
- Changing `supervisor.sh` or `justfile` behavior — they already target `app/`

## Repository: Dead Code Removal

### Requirement: Remove Legacy Backend

The `packages/api/` directory SHALL be deleted entirely. It contains the prior Go backend implementation superseded by `app/backend/`.

#### Scenario: Legacy backend removed

- **GIVEN** the repository contains `packages/api/`
- **WHEN** the cleanup change is applied
- **THEN** `packages/api/` no longer exists on disk
- **AND** no other files reference `packages/api/` as an import or path

### Requirement: Remove Legacy Frontend

The `packages/web/` directory SHALL be deleted entirely. It contains the prior Vite frontend superseded by `app/frontend/`.

#### Scenario: Legacy frontend removed

- **GIVEN** the repository contains `packages/web/`
- **WHEN** the cleanup change is applied
- **THEN** `packages/web/` no longer exists on disk
- **AND** no other files reference `packages/web/` as a path

### Requirement: Remove Legacy E2E Tests

The root-level `e2e/` directory SHALL be deleted. E2E tests now live at `app/frontend/tests/e2e/`.

#### Scenario: Legacy E2E removed

- **GIVEN** the repository contains `e2e/`
- **WHEN** the cleanup change is applied
- **THEN** `e2e/` no longer exists on disk
- **AND** the root `playwright.config.ts` is also deleted

### Requirement: Remove Root Playwright Config

The root `playwright.config.ts` SHALL be deleted. The canonical Playwright config is at `app/frontend/playwright.config.ts`.

#### Scenario: Root playwright config removed

- **GIVEN** `playwright.config.ts` exists at repo root
- **WHEN** the cleanup change is applied
- **THEN** the root `playwright.config.ts` no longer exists

## Configuration: Workspace and Scripts Cleanup

### Requirement: Update pnpm Workspace

`pnpm-workspace.yaml` SHALL reference only `app/frontend`. The `packages/web` entry SHALL be removed.

#### Scenario: Workspace updated

- **GIVEN** `pnpm-workspace.yaml` contains `["packages/web", "app/frontend"]`
- **WHEN** the cleanup change is applied
- **THEN** `pnpm-workspace.yaml` contains only `["app/frontend"]`

### Requirement: Clean Root package.json

Root `package.json` SHALL remove scripts that reference old paths or tools. The `test` script referencing `run-kit-web` filter and the `test:e2e`/`test:e2e:ui` scripts using root playwright SHALL be removed. The `@playwright/test` devDependency SHALL be removed (Playwright is a dependency of `app/frontend/` only).

#### Scenario: Old scripts removed

- **GIVEN** root `package.json` has `test`, `test:e2e`, `test:e2e:ui` scripts
- **WHEN** the cleanup change is applied
- **THEN** those scripts are removed
- **AND** `@playwright/test` is removed from root `devDependencies`
- **AND** `dev` and `supervisor` scripts remain unchanged

## Documentation: Memory File Updates

### Requirement: Update Architecture Memory

`docs/memory/run-kit/architecture.md` SHALL remove all "Legacy note" callouts, legacy test sections, and references to `packages/` paths. The Repository Structure tree SHALL show only the `app/` layout. `pnpm-workspace.yaml` entry SHALL reflect `["app/frontend"]`.

#### Scenario: No legacy references in architecture memory

- **GIVEN** `docs/memory/run-kit/architecture.md` contains legacy notes and `packages/` paths
- **WHEN** the cleanup change is applied
- **THEN** `git grep 'packages/' docs/memory/run-kit/architecture.md` returns zero matches
- **AND** `git grep 'Legacy' docs/memory/run-kit/architecture.md` returns zero matches (case-sensitive — "Legacy" as section marker)
- **AND** the `e2e/` directory entry is removed from the repository structure tree

### Requirement: Update UI Patterns Memory

`docs/memory/run-kit/ui-patterns.md` SHALL remove references to `packages/web/` paths. All component file paths SHALL point to `app/frontend/src/`.

#### Scenario: No legacy paths in UI patterns memory

- **GIVEN** `docs/memory/run-kit/ui-patterns.md` contains `packages/web/` references
- **WHEN** the cleanup change is applied
- **THEN** `git grep 'packages/' docs/memory/run-kit/ui-patterns.md` returns zero matches

## Verification: Clean Repository

### Requirement: No Stale References

After cleanup, `git grep 'packages/'` SHALL return zero matches in tracked, non-archived files (excluding `fab/changes/` artifacts, `pnpm-lock.yaml`, and `.gitignore`).

#### Scenario: Grep verification passes

- **GIVEN** all deletions and updates are applied
- **WHEN** `git grep 'packages/' -- ':!fab/' ':!pnpm-lock.yaml' ':!.gitignore'` is run
- **THEN** it returns zero matches

### Requirement: Build Passes

`just verify` (or the equivalent check + test + build pipeline) MUST pass after all changes.

#### Scenario: Build verification

- **GIVEN** all deletions and updates are applied
- **WHEN** the verification suite runs
- **THEN** it exits 0

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete `packages/` entirely | Confirmed from intake #1 — old implementation fully replaced by `app/` | S:95 R:70 A:95 D:95 |
| 2 | Certain | Delete `e2e/` directory | Confirmed from intake #2 — tests moved to `app/frontend/tests/e2e/` | S:95 R:75 A:95 D:95 |
| 3 | Certain | Delete root `playwright.config.ts` | Config now at `app/frontend/playwright.config.ts` | S:95 R:85 A:95 D:95 |
| 4 | Certain | Remove `@playwright/test` from root devDependencies | Root no longer runs Playwright — `app/frontend/` has its own dependency | S:90 R:90 A:90 D:95 |
| 5 | Confident | Remove `test`, `test:e2e`, `test:e2e:ui` root scripts | These reference old paths; `just` commands replace them | S:80 R:85 A:85 D:90 |
| 6 | Confident | Update memory files with new paths | Upgraded from intake #4 — paths must be accurate post-cleanup | S:80 R:85 A:85 D:90 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
