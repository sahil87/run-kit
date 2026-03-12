# Tasks: Go Backend API

**Change**: 260312-r4t9-go-backend-api
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/backend/` Go module — `go.mod` (module `run-kit`, go 1.22), `go.sum`, directory skeleton for `cmd/run-kit/`, `api/`, `internal/{validate,config,tmux,fab,sessions}/`

## Phase 2: Core Implementation — Internal Packages

- [x] T002 [P] Port `internal/validate/` verbatim — copy `validate.go` and `validate_test.go` from `packages/api/internal/validate/` to `app/backend/internal/validate/`
- [x] T003 [P] Port `internal/config/` verbatim — copy `config.go` and `config_test.go` from `packages/api/internal/config/` to `app/backend/internal/config/`
- [x] T004 [P] Port `internal/tmux/` verbatim — copy `tmux.go` and `tmux_test.go` from `packages/api/internal/tmux/` to `app/backend/internal/tmux/`. Update `WindowInfo` struct: replace `FabStage`/`FabProgress` fields with `FabChange string` (`json:"fabChange,omitempty"`) and `FabStage string` (`json:"fabStage,omitempty"`)
- [x] T005 Rewrite `internal/fab/` — new `fab.go` that reads `.fab-status.yaml` via `os.ReadFile` + `yaml.Unmarshal`. Export function returning change name + active stage. Write `fab_test.go` with table-driven tests (active change, no file, dangling symlink, all stages done)
- [x] T006 Update `internal/sessions/` — copy from `packages/api/internal/sessions/`, rewrite enrichment to per-session model: read fab state once from window 0's project root, apply `FabChange`/`FabStage` to all windows. Update `sessions_test.go`

## Phase 3: Core Implementation — API Layer

- [x] T007 Create `api/router.go` — define dependency interfaces (`SessionFetcher`, `TmuxOps`), server struct, `NewRouter()` with chi, CORS, logger, recovery middleware, route registration. Export `writeJSON`/`writeError` helpers
- [x] T008 Create `api/health.go` + `api/health_test.go` — `GET /api/health` handler and httptest integration test
- [x] T009 Create `api/sessions.go` + `api/sessions_test.go` — `GET /api/sessions`, `POST /api/sessions` (create), `POST /api/sessions/:session/kill`. Tests cover response shapes, validation errors, 201 vs 200 status codes
- [x] T010 Create `api/windows.go` + `api/windows_test.go` — `POST .../windows` (create), `POST .../windows/:index/kill`, `POST .../windows/:index/rename`, `POST .../windows/:index/keys`. Tests cover URL param parsing, validation, all four actions
- [x] T011 Create `api/directories.go` + `api/directories_test.go` — `GET /api/directories?prefix=...`. Tests cover prefix filtering, empty prefix, hidden dir exclusion
- [x] T012 Create `api/upload.go` + `api/upload_test.go` — `POST /api/sessions/:session/upload`. Session from URL param (not form field). Tests cover multipart parsing, size limit, filename sanitization, gitignore management
- [x] T013 Create `api/sse.go` + `api/sse_test.go` — `GET /api/sessions/stream`. Port hub singleton from `packages/api/api/sse.go`. Tests cover initial snapshot delivery, deduplication, client lifecycle
- [x] T014 Create `api/relay.go` — `WS /relay/:session/:window`. Port from `packages/api/api/relay.go`. Split-window, PTY attach, bidirectional relay, sync.Once cleanup. No unit test (requires live tmux + PTY)
- [x] T015 Create `api/spa.go` + `api/spa_test.go` — `GET /*` catch-all. Port from `packages/api/api/spa.go`, update `spaDir` to `app/frontend/dist`. Tests cover static file serving, SPA fallback, path traversal prevention

## Phase 4: Integration

- [x] T016 Create `cmd/run-kit/main.go` — config loading, router creation with production deps, HTTP server, graceful shutdown on SIGINT/SIGTERM (5s timeout)
- [x] T017 Verify full build and test suite — `go build ./...` and `go test ./...` from `app/backend/` both pass cleanly. Fix any compilation or test failures

---

## Execution Order

- T001 blocks all subsequent tasks (module must exist)
- T002, T003, T004, T005 are parallel (independent packages — fab rewrite reads `.fab-status.yaml` via os.ReadFile, no tmux dependency) <!-- clarified: removed false T005→T004 dependency — internal/fab does not import internal/tmux -->
- T006 depends on T004 and T005 (sessions uses tmux.WindowInfo and fab.ReadState)
- T007 depends on T006 (router uses sessions interfaces)
- T008 through T015 depend on T007 (handlers register on the router)
- T008 through T015 are mostly parallel (independent handler files), except T009 should come before T012 (upload uses session resolution pattern from sessions)
- T016 depends on T007 (main.go creates the router)
- T017 depends on all previous tasks
