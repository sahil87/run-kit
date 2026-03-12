# Tasks: Scaffold app/ Folder Structure

**Change**: 260312-jz77-scaffold-app-structure
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

<!-- Go module and frontend package scaffolding — no business logic. -->

- [x] T001 [P] Create `app/backend/go.mod` with module `run-kit`, Go 1.22.0, and same dependencies as `packages/api/go.mod` (chi, cors, gorilla/websocket, creack/pty, yaml.v3). Run `go mod tidy` to generate `go.sum`.
- [x] T002 [P] Create `app/backend/cmd/run-kit/main.go` — package `main`, `func main()` that prints "run-kit" and exits.
- [x] T003 [P] Create API handler placeholder files in `app/backend/api/`: `router.go`, `sessions.go`, `windows.go`, `directories.go`, `upload.go`, `sse.go`, `relay.go`, `health.go`, `spa.go`. Each file: `package api` declaration only.
- [x] T004 [P] Create internal package placeholders in `app/backend/internal/`: `tmux/tmux.go` + `tmux/tmux_test.go`, `sessions/sessions.go` + `sessions/sessions_test.go`, `fab/fab.go` + `fab/fab_test.go`, `config/config.go` + `config/config_test.go`, `validate/validate.go` + `validate/validate_test.go`. Each `.go` file: package declaration + one exported placeholder. Each `_test.go`: package declaration only. No `internal/worktree/`.

## Phase 2: Core Implementation

<!-- Frontend package, configs, source files. -->

- [x] T005 Create `app/frontend/package.json` with name `run-kit-web`, type `module`, scripts (`dev`, `build`, `preview`, `test`, `test:watch`), dependencies (React 19, TanStack Router, xterm.js 5, react-dom), devDependencies (Tailwind 4, Vite 7, Vitest 4, TS 5.7+, @vitejs/plugin-react, testing-library, jsdom, postcss, msw, @playwright/test).
- [x] T006 [P] Create `app/frontend/vite.config.ts` — React plugin, `@` alias to `./src`, proxy `/api/*` → `http://localhost:3000`, `/relay/*` → `ws://localhost:3000`.
- [x] T007 [P] Create `app/frontend/tsconfig.json` — ES2022 target, bundler module resolution, strict, React JSX, `@/*` path alias.
- [x] T008 [P] Create `app/frontend/vitest.config.ts` — jsdom environment, setup file `./src/test-setup.ts`, `@` alias. Create `app/frontend/src/test-setup.ts` importing `@testing-library/jest-dom/vitest`.
- [x] T009 [P] Create `app/frontend/index.html` — standard Vite HTML entry with `<div id="root">` and `<script type="module" src="/src/main.tsx">`.
- [x] T010 Create `app/frontend/src/types.ts` — `WindowInfo` and `ProjectSession` types matching API spec response shapes.
- [x] T011 [P] Create `app/frontend/src/main.tsx` — minimal React entry rendering router into `#root`.
- [x] T012 [P] Create `app/frontend/src/router.tsx` — TanStack Router with one route `/:session/:window`, defaults to first session/first window, renders App.
- [x] T013 [P] Create `app/frontend/src/app.tsx` — single-view layout skeleton: `h-screen flex flex-col` with top bar (`shrink-0`), main area (`flex-1 flex flex-row min-h-0` with sidebar + terminal placeholders), bottom bar (`shrink-0`). Placeholder divs only.
- [x] T014 Create `app/frontend/src/api/client.ts` — typed function stubs for all API spec endpoints. All functions throw "not implemented". POST-only mutations. URL patterns match new API spec (path-based intent).

## Phase 3: Integration & Edge Cases

<!-- Test infrastructure, MSW, Playwright, justfile, supervisor, workspace config. -->

- [x] T015 [P] Create `app/frontend/tests/msw/handlers.ts` — MSW handler stubs for `GET /api/sessions` (empty array), `GET /api/sessions/stream` (no-op), `GET /api/directories` (empty array), `POST /api/sessions` (ok), `POST /api/sessions/:session/kill` (ok). Export `handlers` array.
- [x] T016 [P] Create `app/frontend/playwright.config.ts` — desktop project (Chromium), base URL `http://localhost:5173`, test dir `tests/e2e/`. Create `app/frontend/tests/e2e/smoke.spec.ts` with `test.skip('smoke', () => {})`.
- [x] T017 Replace `justfile` with updated recipes: `dev` (Go + Vite concurrent), `build` (Go build + pnpm build), `test` (backend + frontend + e2e), `test-backend`, `test-frontend`, `test-e2e`, `check`, `verify`, `up`, `bg`, `logs`, `down`, `https`, `trust`.
- [x] T018 Update `supervisor.sh` paths: Go build from `app/backend/`, frontend build from `app/frontend/`, dist path from `app/frontend/dist/`.
- [x] T019 [P] Update `pnpm-workspace.yaml` to `["app/frontend"]`.
- [x] T020 [P] Delete `dev.sh`.

## Phase 4: Polish

<!-- Verification gate. -->

- [x] T021 Run `pnpm install` from repo root, then verify: `just build` succeeds, `just test-backend` exits 0, `just test-frontend` exits 0, `just check` exits 0.

---

## Execution Order

- T001-T004 are independent (all [P]), can run in parallel — they create the Go module
- T005 must complete before T006-T009 (package.json needed for pnpm install)
- T010 must complete before T014 (types needed for client stubs)
- T011-T013 are independent of each other but need T005
- T015-T016 are independent, need T005
- T017-T020 are independent of frontend tasks but T017 needs both Go and frontend scaffolds to be meaningful
- T021 depends on all prior tasks
