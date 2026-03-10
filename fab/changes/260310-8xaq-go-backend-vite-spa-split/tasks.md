# Tasks: Go Backend + Vite SPA Split

**Change**: 260310-8xaq-go-backend-vite-spa-split
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

<!-- Monorepo scaffolding, Go module init, Vite project init. No business logic. -->

- [x] T001 Create monorepo structure — `packages/api/`, `packages/web/`, `pnpm-workspace.yaml` (packages: `["packages/web"]`), update root `.gitignore` for `bin/`
- [x] T002 [P] Initialize Go module — `packages/api/go.mod`, `packages/api/cmd/run-kit/main.go` (stub: parse flags, start server), create `internal/` package directories (`tmux/`, `config/`, `fab/`, `worktree/`, `sessions/`, `validate/`, `relay/`), `api/` handler directory
- [x] T003 [P] Initialize Vite project — `packages/web/package.json`, `packages/web/vite.config.ts` (React plugin, `server.proxy` for `/api` and `/relay` with `ws: true`), `packages/web/index.html`, `packages/web/tsconfig.json` (with `@/` alias → `src/`), `packages/web/postcss.config.mjs`, migrate `globals.css` to `packages/web/src/globals.css`, Tailwind CSS 4 config

## Phase 2: Core Implementation

<!-- Go backend internal packages, HTTP layer, then frontend migration. Ordered by dependency. -->

<!-- Go internal packages -->
- [x] T004 [P] Implement `packages/api/internal/config/` — `Config` struct (`Port`, `Host`), `Load()` with resolution order: CLI flags > `run-kit.yaml` > defaults (3000, 127.0.0.1). YAML via `gopkg.in/yaml.v3`. Port validation (1-65535)
- [x] T005 [P] Implement `packages/api/internal/validate/` — `ExpandTilde()` with `$HOME` security boundary (reject `..`, absolute outside home, `~username`), `ValidateName()` for session/window names, `SanitizeFilename()` (strip path separators, null bytes, leading dots, collapse dot sequences)
- [x] T006 Implement `packages/api/internal/tmux/` — `ListSessions()` with byobu session-group filtering, `ListWindows()` with `IsActiveWindow` flag from `#{window_active}`, `SendKeys()`, `CreateSession()` (optional CWD), `CreateWindow()`, `KillSession()`, `KillWindow()`, `RenameWindow()`, `SplitWindow()`. All via `os/exec.CommandContext` with 10s timeout. Port parsing logic from `src/lib/tmux.ts`
- [x] T007 [P] Implement `packages/api/internal/fab/` and `packages/api/internal/worktree/` — fab: read progress-line, current change, change list via fab-kit CLI. worktree: wrap `wt-list`, `wt-create`, `wt-delete` scripts. Both via `os/exec.CommandContext`
- [x] T008 Implement `packages/api/internal/sessions/` — `EnrichSessions()`: derive project roots from tmux window 0 `pane_current_path`, auto-detect fab-kit via `os.Stat("fab/project/config.yaml")`, enrich with fab state. Parallel enrichment via goroutines with indexed assignment to preserve tmux ordering. Port from `src/lib/sessions.ts`

<!-- Go HTTP layer -->
- [x] T009 Implement HTTP server setup — `packages/api/cmd/run-kit/main.go`: chi router, middleware stack (chi CORS, slog-based request logger, chi recoverer), graceful shutdown via `signal.NotifyContext(SIGINT, SIGTERM)` with 5s drain timeout. Wire config loading
- [x] T010 Implement API routes — `packages/api/api/routes.go`: `GET /api/health` (200 ok), `GET /api/sessions` (list+enrich), `POST /api/sessions` (action dispatch: createSession/createWindow/killSession/killWindow/renameWindow/sendKeys with validation), `GET /api/directories` (prefix autocomplete with $HOME boundary). JSON request/response
- [x] T011 Implement SSE endpoint — `packages/api/api/sse.go`: module-level goroutine polling tmux every 2.5s, `sync.RWMutex`-protected client set, fan-out full snapshots on change, dedup (skip if unchanged), 30-min connection lifetime, clean disconnect handling, `Flusher` interface assertion
- [x] T012 [P] Implement upload endpoint — `packages/api/api/upload.go`: `POST /api/upload`, multipart form parsing, 50MB `MaxBytesReader`, resolve project root via `sessions.ProjectRoot()`, write to `.uploads/{YYMMDD-HHmmss}-{sanitized}`, auto-manage `.gitignore`, return file path JSON
- [x] T013 Implement terminal relay — `packages/api/api/relay.go`: `GET /relay/{session}/{window}` WebSocket upgrade via `gorilla/websocket`, `tmux split-window` to create pane, spawn `tmux attach-session -t {paneId}` via `creack/pty`, bidirectional I/O relay (goroutines for each direction), kill pty + pane on disconnect. `Upgrader` with permissive `CheckOrigin` <!-- rework: relay.go uses exec.Command without context/timeout (must use exec.CommandContext); does not create split-window pane per spec; no pane cleanup on disconnect -->
- [x] T014 Implement SPA static serving — `packages/api/api/spa.go`: `http.FileServer` for `dist/` directory, catch-all handler: serve file if exists, else `index.html`. Mount after API and relay routes on chi router

<!-- Frontend migration -->
- [x] T015 [P] Migrate components to `packages/web/src/components/` — copy all from `src/components/`: `session-card.tsx`, `command-palette.tsx`, `bottom-bar.tsx`, `compose-buffer.tsx`, `breadcrumb-dropdown.tsx`, `top-bar-chrome.tsx`, `arrow-pad.tsx`, `dialog.tsx`. Remove any Server Component imports. Update import paths to `@/` <!-- clarified: removed `ui/` (shadcn) reference — no src/components/ui/ directory exists in codebase -->
- [x] T016 [P] Migrate hooks to `packages/web/src/hooks/` — `use-sessions.ts` (update EventSource URL to relative `/api/sessions/stream`), `use-keyboard-nav.ts`, `use-visual-viewport.ts`, `use-modifier-state.ts`, `use-file-upload.ts` (update upload fetch to relative `/api/upload`)
- [x] T017 [P] Migrate contexts to `packages/web/src/contexts/` — `ChromeProvider` (split state/dispatch pattern preserved), `SessionProvider` (EventSource to `/api/sessions/stream`, forward `isConnected` to ChromeProvider)
- [x] T018 Create API client module — `packages/web/src/api/client.ts`: typed wrappers for `getSessions()`, `postSessionAction()`, `getDirectories()`, `uploadFile()`. Relative URLs. Export `ProjectSession`, `WindowInfo`, and action types
- [x] T019 Set up TanStack Router — `packages/web/src/router.tsx`: install `@tanstack/react-router`, define route tree with `/` (dashboard), `/p/$project` (project), `/p/$project/$window` (terminal with `name` search param). Root layout wraps with `ChromeProvider` → `SessionProvider`
- [x] T020 Rewrite page components — `packages/web/src/pages/dashboard.tsx` (consume `useSessions()`, set chrome slots via `useChromeDispatch()`), `pages/project.tsx` (same pattern), `pages/terminal.tsx` (WebSocket to `ws://${location.host}/relay/{session}/{window}`, xterm.js, bottom bar injection, compose buffer, file upload)

## Phase 3: Integration & Edge Cases

<!-- Tests, dev workflow, infrastructure config, E2E. -->

- [x] T021 [P] Write Go unit tests — `internal/validate/validate_test.go` (tilde expansion, path traversal, filename sanitization), `internal/config/config_test.go` (CLI > YAML > defaults, port validation), `internal/tmux/tmux_test.go` (session parsing, byobu filtering, window activity), `internal/sessions/sessions_test.go` (enrichment). Table-driven tests porting cases from existing Vitest suites <!-- rework: tmux_test.go and sessions_test.go are missing -->
- [x] T022 [P] Migrate frontend tests to `packages/web/` — `vitest.config.ts`, `src/test-setup.ts` (jest-dom), migrate `command-palette.test.tsx`, `breadcrumb-dropdown.test.tsx`, `use-keyboard-nav.test.ts`, `use-visual-viewport.test.ts`. Update import paths <!-- clarified: added breadcrumb-dropdown.test.tsx and use-visual-viewport.test.ts — both exist in src/ and were missing from task -->
- [x] T023 Create `dev.sh` — run `go run ./cmd/run-kit` and `pnpm --filter web dev` concurrently, trap SIGINT to kill both, print startup banner with URLs
- [x] T024 [P] Update `supervisor.sh` — Go build (`cd packages/api && go build -o ../../bin/run-kit ./cmd/run-kit`), frontend build (`cd packages/web && pnpm build`), start `./bin/run-kit`, health check `GET /api/health` (10s timeout), rollback via `git revert HEAD`
- [x] T025 [P] Update `Caddyfile.example` — single `reverse_proxy localhost:3000` block (remove two-port config)
- [x] T026 Update E2E config — `playwright.config.ts`: `webServer` to start Go + Vite (or built SPA), update `baseURL`. Verify existing test suites pass (chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile)

## Phase 4: Polish

<!-- Config updates, cleanup, verification. -->

- [x] T027 [P] Update `fab/project/config.yaml` — `source_paths: [packages/api/, packages/web/src/]`
- [x] T028 [P] Remove stale files — delete `src/`, `next.config.ts`, `next-env.d.ts`, root `tsconfig.json`, root `vitest.config.ts`, `postcss.config.mjs`. Remove `next` and backend Node.js deps from root `package.json`
- [x] T029 Full stack verification — `cd packages/api && go build ./...` + `go test ./...`, `cd packages/web && pnpm build` + `pnpm test`, root `pnpm test:e2e`. Fix any integration issues

---

## Execution Order

- T001 blocks T002, T003 (need directory structure first)
- T002, T003 are parallel (Go and Vite init are independent)
- T004, T005 are parallel and independent
- T006 blocks T008 (sessions needs tmux)
- T007 blocks T008 (sessions needs fab/worktree for enrichment)
- T008 blocks T010 (API routes need sessions), T011 (SSE needs sessions)
- T009 blocks T010, T011, T012, T013, T014 (all HTTP handlers need the server)
- T004 blocks T009 (server needs config)
- T003 blocks T015, T016, T017, T018, T019 (frontend tasks need Vite project)
- T015, T016, T017, T018, T019 block T020 (pages need components, contexts, API client, router) <!-- clarified: added T019 — pages use TanStack Router routes -->
- T021 depends on T004-T008 (test what's built)
- T022 depends on T015, T016 (test migrated components)
- T023 depends on T009, T019 (dev script needs both servers runnable)
- T026 depends on T020, T023 (E2E needs full stack)
- T028 depends on T020 (don't delete src/ until frontend is migrated)
- T029 depends on all prior tasks
