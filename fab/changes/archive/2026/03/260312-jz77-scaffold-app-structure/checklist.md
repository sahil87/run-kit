# Quality Checklist: Scaffold app/ Folder Structure

**Change**: 260312-jz77-scaffold-app-structure
**Generated**: 2026-03-12
**Spec**: `spec.md`

## Functional Completeness
<!-- Every requirement in spec.md has working implementation -->
- [x] CHK-001 Go module init: `app/backend/go.mod` exists with module `run-kit`, Go 1.22.0, and all 5 dependencies
- [x] CHK-002 Entry point: `app/backend/cmd/run-kit/main.go` prints "run-kit" and exits 0
- [x] CHK-003 API placeholders: All 9 handler files exist in `app/backend/api/` with `package api`
- [x] CHK-004 Internal packages: All 5 packages exist under `app/backend/internal/` with `.go` + `_test.go` files
- [x] CHK-005 No `internal/worktree/`: Directory does NOT exist in `app/backend/internal/`
- [x] CHK-006 Frontend package: `app/frontend/package.json` has correct name, type, scripts, and all dependencies
- [x] CHK-007 Vite config: proxy for `/api` and `/relay`, React plugin, `@` alias
- [x] CHK-008 TypeScript config: strict mode, bundler resolution, `@/*` path alias
- [x] CHK-009 Vitest config: jsdom environment, setup file, `@` alias
- [x] CHK-010 React entry: `main.tsx`, `app.tsx`, `router.tsx`, `index.html` all exist
- [x] CHK-011 API client stubs: All 9 functions exist, all throw "not implemented", POST-only mutations
- [x] CHK-012 Shared types: `WindowInfo` and `ProjectSession` match API spec response shapes
- [x] CHK-013 MSW handlers: `handlers.ts` exports handler array with stubs for 5 endpoints
- [x] CHK-014 Playwright config: desktop project, base URL, test dir, smoke test placeholder
- [x] CHK-015 Justfile: All 14 recipes present with correct paths
- [x] CHK-016 Supervisor: `build_all` uses `app/backend/` and `app/frontend/` paths
- [x] CHK-017 Workspace: `pnpm-workspace.yaml` references `app/frontend`
- [x] CHK-018 dev.sh removed: File does not exist at repo root

## Behavioral Correctness
<!-- Changed requirements behave as specified -->
- [x] CHK-019 `just dev` runs Go backend + Vite concurrently (replaces dev.sh behavior)
- [x] CHK-020 `just build` builds Go binary to `bin/run-kit` AND frontend to `app/frontend/dist/`

## Scenario Coverage
<!-- Key scenarios from spec.md have been exercised -->
- [x] CHK-021 `go build ./...` from `app/backend/` exits 0
- [x] CHK-022 `go test ./...` from `app/backend/` exits 0 (zero tests, no failures)
- [x] CHK-023 `pnpm install` from repo root succeeds
- [x] CHK-024 `pnpm build` from `app/frontend/` succeeds (Vite build)
- [x] CHK-025 `tsc --noEmit` from `app/frontend/` reports no type errors
- [x] CHK-026 `just build` succeeds end-to-end
- [x] CHK-027 `just test-backend` exits 0
- [x] CHK-028 `just check` exits 0

## Edge Cases & Error Handling
<!-- Boundary conditions -->
- [x] CHK-029 Empty test files: Go test files have package declaration but no test functions — `go test` still passes
- [x] CHK-030 Playwright smoke test: Uses `test.skip` so `just test-e2e` doesn't fail without a running server

## Code Quality
<!-- Pattern consistency and anti-patterns -->
- [x] CHK-031 Pattern consistency: Go package structure mirrors architecture spec (`api/`, `internal/{pkg}/`, `cmd/run-kit/`)
- [x] CHK-032 No unnecessary duplication: Frontend config files (`vite.config.ts`, `tsconfig.json`, `vitest.config.ts`) follow same patterns as current `packages/web/` equivalents
- [x] CHK-033 All subprocess calls use `execFile` with argument arrays: **N/A** — scaffold has no subprocess code
- [x] CHK-034 No `exec()` or template-string shell commands: **N/A** — scaffold has no executable code
- [x] CHK-035 Justfile recipes use explicit paths (no magic strings)

## Security
<!-- Security surface -->
- [x] CHK-036 No secrets or credentials in scaffolded files
- [x] CHK-037 API client stubs do not make real HTTP calls (all throw "not implemented")

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
