# Intake: Go Backend API

**Change**: 260312-r4t9-go-backend-api
**Created**: 2026-03-12
**Status**: Draft

## Origin

> Phase 2 of the run-kit reimplementation plan (docs/specs/project-plan.md). After Phase 1 creates the `app/` scaffold, this phase implements the Go backend from `docs/specs/api.md` — the full HTTP, SSE, and WebSocket surface with robust testing. Internal packages are ported from `packages/api/internal/`; the `api/` handler layer is rewritten with resource-oriented POST-based routes.

## Why

1. **Clean API surface** — the current implementation uses a multiplexed `POST /api/sessions { action: "..." }` pattern. The new design uses path-based intent (`POST /api/sessions/:session/kill`) with POST-only mutations, making the API self-documenting and simpler to consume.
2. **Handler-level test coverage** — the current backend has unit tests for `internal/` packages but no handler integration tests. This phase adds `httptest.NewRecorder` + chi router tests for every endpoint.
3. **Backend must be complete before frontend** — Phase 3 (frontend) develops against these endpoints. The API spec is the contract between the two.

## What Changes

### Port `internal/` Packages

Copy verbatim from `packages/api/internal/` to `app/backend/internal/`. These are already well-tested:

- `internal/validate` — name, path, tilde expansion, filename sanitization
- `internal/config` — CLI > YAML > defaults config resolution
- `internal/tmux` — tmux operations via `os/exec.CommandContext` with argument slices
- `internal/fab` — fab-kit state (current change, progress line, change list)
- `internal/sessions` — session enrichment with parallel fab detection

Do NOT port `internal/worktree/` — removed per architecture spec.

### New `api/` Handler Layer

Implement per `docs/specs/api.md`. Each file handles one resource domain:

- `router.go` — chi router setup, CORS (GET POST OPTIONS), logger, recovery middleware, route registration
- `health.go` — `GET /api/health` → `{"status":"ok"}`
- `sessions.go` — `GET /api/sessions`, `POST /api/sessions`, `POST /api/sessions/:session/kill`
- `windows.go` — `POST /api/sessions/:session/windows`, `POST .../windows/:index/kill`, `POST .../windows/:index/rename`, `POST .../windows/:index/keys`
- `directories.go` — `GET /api/directories?prefix=...`
- `upload.go` — `POST /api/sessions/:session/upload` (multipart, 50MB limit)
- `sse.go` — `GET /api/sessions/stream` (hub singleton, 2.5s poll, dedup, 30min cap)
- `relay.go` — `WS /relay/:session/:window` (split-window, PTY attach, bidirectional relay, cleanup)
- `spa.go` — static file serving from `app/frontend/dist/` + SPA fallback

### Handler Integration Tests

Each handler file gets a `_test.go` with `httptest.NewRecorder` tests:

- Request/response shape validation (correct JSON structure, status codes)
- Validation error messages (400 responses for invalid input)
- URL parameter parsing (`:session`, `:index`)
- Content-type enforcement
- Mock `internal/` interfaces for tmux isolation

### Server Entry Point

`cmd/run-kit/main.go` — config loading, router creation, HTTP server startup, graceful shutdown on SIGINT/SIGTERM (5s timeout).

## Affected Memory

- `run-kit/architecture`: (modify) Update handler file descriptions, test coverage notes, API endpoint table

## Impact

- **All API endpoints** — new route structure (POST-only mutations, path-based intent)
- **Go dependencies** — same as current: chi, cors, gorilla/websocket, creack/pty, yaml.v3
- **Frontend contract** — API client in Phase 3 must match these endpoints exactly

## Open Questions

- None — API spec and architecture spec are the source of truth.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | POST-only mutations | Discussed — user mandated, captured in api.md design principles | S:95 R:80 A:95 D:95 |
| 2 | Certain | Port `internal/` packages verbatim | Discussed — logic is proven, copy don't rewrite | S:90 R:90 A:90 D:95 |
| 3 | Certain | No `internal/worktree/` | Architecture spec — dead code, not API-exposed | S:90 R:90 A:90 D:95 |
| 4 | Certain | Handler files split by resource domain | Architecture spec — `sessions.go`, `windows.go`, etc. | S:90 R:85 A:90 D:90 |
| 5 | Certain | chi router with CORS, logger, recovery middleware | Same stack as current, proven in production | S:90 R:85 A:90 D:95 |
| 6 | Confident | Handler tests use `httptest.NewRecorder` + chi router | Standard Go HTTP testing pattern; mock internal interfaces | S:80 R:85 A:85 D:85 |
| 7 | Confident | SSE hub architecture unchanged (module-level singleton, 2.5s poll, dedup) | Current implementation works well; no architectural changes planned | S:75 R:80 A:85 D:85 |
| 8 | Confident | WebSocket relay architecture unchanged (split-window, PTY attach, sync.Once cleanup) | Current implementation is robust; port the pattern | S:75 R:75 A:85 D:85 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
