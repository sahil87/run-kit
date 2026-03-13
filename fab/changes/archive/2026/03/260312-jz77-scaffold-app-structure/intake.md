# Intake: Scaffold app/ Folder Structure

**Change**: 260312-jz77-scaffold-app-structure
**Created**: 2026-03-12
**Status**: Draft

## Origin

> Phase 1 of the run-kit reimplementation plan (docs/specs/project-plan.md). User initiated a discussion session to re-evaluate run-kit's architecture, decided to reimplement with a clean API surface, POST-only mutations, and a new `app/backend` + `app/frontend` folder structure. This change creates the scaffolding — no functional code, just the skeleton that subsequent phases build on.

Discussion covered: folder naming (`app/` over `packages/` and `src/`), POST-only API convention, Go test co-location, justfile as single task runner, removal of `dev.sh`.

## Why

1. **Clean foundation for reimplementation** — the current `packages/api/` and `packages/web/` structure is being replaced. The new `app/` layout needs to exist with working build toolchains before any functional code lands.
2. **If we skip this** — Phase 2 (backend) and Phase 3 (frontend) have no verified build targets. Toolchain issues discovered mid-implementation waste time.
3. **Why a dedicated scaffold phase** — confirms Go compiles, Vite builds, test runners find zero tests, justfile recipes work, and Playwright config resolves. Problems surface here, not during feature work.

## What Changes

### New `app/backend/` Go Module

- `go.mod` with module name and Go version (match current `packages/api/go.mod`)
- `cmd/run-kit/main.go` — minimal `main()` that prints "run-kit" and exits
- `api/` — empty handler files with package declarations only:
  - `router.go`, `sessions.go`, `windows.go`, `directories.go`, `upload.go`, `sse.go`, `relay.go`, `health.go`, `spa.go`
- `internal/` packages — each with one exported placeholder and an empty `_test.go`:
  - `internal/tmux/`, `internal/sessions/`, `internal/fab/`, `internal/config/`, `internal/validate/`
- No `internal/worktree/` — removed per architecture spec (dead code, not exposed via API)

### New `app/frontend/` Vite Project

- `package.json` with React, Vite, TanStack Router, xterm.js, Tailwind CSS dependencies
- `tsconfig.json`, `vite.config.ts` (with proxy config for `/api/*` and `/relay/*` to `:3000`)
- `vitest.config.ts` with jsdom environment
- `src/main.tsx` — minimal React entry rendering the router
- `src/app.tsx` — single-view layout skeleton: top bar + sidebar + terminal + bottom bar
- `src/router.tsx` — TanStack Router with one route: `/:session/:window` (defaults to first session, first window)
- `src/api/client.ts` — type stubs for all API endpoints per `docs/specs/api.md`. Functions throw "not implemented". Typed signatures match the spec.
- `src/types.ts` — `ProjectSession` and `WindowInfo` types matching the API spec response shapes
- `tests/msw/handlers.ts` — MSW handler stubs for API + SSE mocking
- `tests/e2e/` — Playwright config at `app/frontend/playwright.config.ts`, one smoke test placeholder
- `src/test-setup.ts` — Vitest setup importing `@testing-library/jest-dom/vitest`

### Updated `justfile`

Replace current pnpm-centric recipes with new paths:

```
just dev          — go run + vite dev concurrently
just build        — go build + pnpm build
just test         — go test + vitest + playwright
just test-backend — go test ./... from app/backend/
just test-frontend — vitest from app/frontend/
just test-e2e     — playwright from app/frontend/
just check        — tsc --noEmit from app/frontend/
just verify       — check + test + build
just up           — supervisor.sh (updated paths)
just bg           — supervisor in detached tmux
just logs         — attach to supervisor tmux
just down         — kill supervisor tmux
just https        — caddy run
just trust        — caddy trust
```

### Updated `supervisor.sh`

- Go build path: `app/backend/` → `bin/run-kit`
- Frontend build: `pnpm build` from `app/frontend/`
- SPA dist path: `app/frontend/dist/`

### Updated `pnpm-workspace.yaml`

Change from `["packages/web"]` to `["app/frontend"]`.

### Removed: `dev.sh`

Replaced by `just dev` recipe. The justfile handles concurrent Go + Vite processes.

## Affected Memory

- `run-kit/architecture`: (modify) Update paths from `packages/` to `app/`, reflect justfile as task runner, remove `dev.sh` reference

## Impact

- **Build toolchain**: Go module path changes (new `go.mod`)
- **pnpm workspace**: Frontend package location changes
- **justfile**: All recipes get new paths
- **supervisor.sh**: Build and dist paths change
- **No functional code changes** — existing `packages/` is untouched until Phase 4

## Open Questions

- None — all structural decisions were resolved in the discussion session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `app/backend` and `app/frontend` | Discussed — user chose `app/` over `packages/` (publishable connotation) and `src/` (Go GOPATH baggage) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Go tests co-located with source (`_test.go`) | Discussed — standard Go convention, user confirmed | S:95 R:95 A:95 D:95 |
| 3 | Certain | Playwright E2E at `app/frontend/tests/e2e/` | Discussed — user specified this location | S:95 R:85 A:90 D:95 |
| 4 | Certain | Remove `internal/worktree/` | Architecture spec decision — dead code not exposed via API | S:90 R:90 A:90 D:95 |
| 5 | Certain | `just dev` replaces `dev.sh` | Discussed — justfile is the single task runner | S:95 R:85 A:90 D:95 |
| 6 | Certain | POST-only mutations in API client stubs | Discussed — user mandated POST for all mutations, intent in URL path | S:95 R:80 A:90 D:95 |
| 7 | Confident | Go module name matches current (`run-kit`) | Current `packages/api/go.mod` uses this; no reason to change | S:70 R:90 A:85 D:90 |
| 8 | Confident | Keep same frontend dependencies (React 19, Tailwind 4, TanStack Router, xterm.js 5) | Philosophies unchanged per spec; dependency versions carry forward | S:75 R:80 A:85 D:85 |
| 9 | Confident | `pnpm-workspace.yaml` updated to `["app/frontend"]` | Workspace config must match new path; straightforward | S:80 R:90 A:90 D:90 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
