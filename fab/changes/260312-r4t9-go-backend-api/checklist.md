# Quality Checklist: Go Backend API

**Change**: 260312-r4t9-go-backend-api
**Generated**: 2026-03-12
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Module structure: `app/backend/` exists with `go.mod` (module `run-kit`, go 1.22+), correct directory layout per architecture spec
- [ ] CHK-002 validate port: All functions (`ValidateName`, `ValidatePath`, `ExpandTilde`, `SanitizeFilename`) present and unchanged in `app/backend/internal/validate/`
- [ ] CHK-003 config port: `Config` struct + `Load()` with CLI > YAML > defaults resolution present in `app/backend/internal/config/`
- [ ] CHK-004 tmux port: All functions (`ListSessions`, `ListWindows`, `CreateSession`, `CreateWindow`, `KillSession`, `KillWindow`, `RenameWindow`, `SendKeys`, `SplitWindow`, `KillPane`) present in `app/backend/internal/tmux/`
- [ ] CHK-005 fab rewrite: `internal/fab` reads `.fab-status.yaml` via `os.ReadFile` + YAML parse. No subprocess calls. Returns change name + active stage
- [ ] CHK-006 sessions enrichment: Per-session fab enrichment — reads `.fab-status.yaml` once from window 0's project root, applies to all windows
- [ ] CHK-007 WindowInfo fields: `FabChange` and `FabStage` fields with `omitempty` JSON tags replace old `FabStage`/`FabProgress`
- [ ] CHK-008 Router: chi router with CORS (`*` origin, `GET POST OPTIONS`), logger, recovery middleware
- [ ] CHK-009 Health endpoint: `GET /api/health` returns `200 {"status":"ok"}`
- [ ] CHK-010 Sessions list: `GET /api/sessions` returns JSON array with fab-enriched windows
- [ ] CHK-011 Session create: `POST /api/sessions` with `{"name","cwd"}`, returns `201 {"ok":true}`
- [ ] CHK-012 Session kill: `POST /api/sessions/:session/kill` returns `200 {"ok":true}`
- [ ] CHK-013 Window create: `POST /api/sessions/:session/windows` with `{"name","cwd"}`, returns `201 {"ok":true}`
- [ ] CHK-014 Window kill: `POST /api/sessions/:session/windows/:index/kill` returns `200 {"ok":true}`
- [ ] CHK-015 Window rename: `POST /api/sessions/:session/windows/:index/rename` with `{"name"}`, returns `200 {"ok":true}`
- [ ] CHK-016 Window keys: `POST /api/sessions/:session/windows/:index/keys` with `{"keys"}`, returns `200 {"ok":true}`
- [ ] CHK-017 Directories: `GET /api/directories?prefix=...` with tilde expansion, child listing, hidden dir skip
- [ ] CHK-018 Upload: `POST /api/sessions/:session/upload` — session from URL param, multipart, 50MB limit, `.uploads/` + gitignore management
- [ ] CHK-019 SSE: `GET /api/sessions/stream` — hub singleton, 2.5s poll, dedup, cached snapshot, 30min cap
- [ ] CHK-020 Relay: `WS /relay/:session/:window` — split-window, PTY attach, bidirectional, sync.Once cleanup
- [ ] CHK-021 SPA: `GET /*` serves from `app/frontend/dist/`, SPA fallback to `index.html`, path traversal prevention
- [ ] CHK-022 Main: `cmd/run-kit/main.go` — config load, router create, HTTP server, graceful shutdown (5s)

## Behavioral Correctness

- [ ] CHK-023 POST-only mutations: All mutating endpoints use POST (not PUT/DELETE/PATCH). Intent in URL path, not action field
- [ ] CHK-024 Resource-based routes: Each endpoint uses path-based intent (e.g., `/api/sessions/:session/kill` not `POST { action: "killSession" }`)
- [ ] CHK-025 Per-session (not per-window) fab: `.fab-status.yaml` read once per session, not per window. All windows share same fab state
- [ ] CHK-026 Upload session from URL: `:session` comes from URL param, not form field (changed from old implementation)
- [ ] CHK-027 SPA directory updated: `spaDir` points to `app/frontend/dist/` not `packages/web/dist/`

## Removal Verification

- [ ] CHK-028 No `internal/worktree/`: Package not present in `app/backend/internal/`
- [ ] CHK-029 No subprocess fab calls: `internal/fab` has no `exec.Command`, no `statusman.sh`, no `changeman.sh`, no `fab/current` reads
- [ ] CHK-030 No multiplexed POST: No `action` field dispatch pattern in any handler

## Scenario Coverage

- [ ] CHK-031 Name validation: Tests verify forbidden chars, empty name, max length for session/window names
- [ ] CHK-032 Path validation: Tests verify tilde expansion, `~user` rejection, home directory boundary
- [ ] CHK-033 Fab state scenarios: Tests cover active change, no file, dangling symlink, all stages done
- [ ] CHK-034 Session enrichment: Tests verify per-session model — all windows get same fab state from window 0
- [ ] CHK-035 Handler response shapes: Each handler test verifies JSON structure, status codes, content-type
- [ ] CHK-036 Validation error paths: Handler tests verify 400 responses with `{"error":"..."}` for invalid input

## Edge Cases & Error Handling

- [ ] CHK-037 Invalid window index: Non-integer `:index` params return 400
- [ ] CHK-038 Upload size limit: Files > 50MB return 413
- [ ] CHK-039 Empty prefix: `GET /api/directories` with no prefix returns `{"directories":[]}`
- [ ] CHK-040 SPA not built: Requests when `app/frontend/dist/` doesn't exist return 404
- [ ] CHK-041 SSE client disconnect: Handled gracefully (no panics, client removed from hub)
- [ ] CHK-042 Relay cleanup: PTY + pane killed on WebSocket disconnect via sync.Once

## Code Quality

- [ ] CHK-043 Pattern consistency: New code follows naming and structural patterns of existing `packages/api/` code
- [ ] CHK-044 No unnecessary duplication: Existing utilities (`validate`, `tmux`, `config`) reused — not reimplemented
- [ ] CHK-045 execFile with argument arrays: All subprocess calls use `os/exec.CommandContext` with argument slices, never `sh -c` or shell strings
- [ ] CHK-046 No exec/execSync: No `exec()` or string shell commands anywhere in `app/backend/`
- [ ] CHK-047 Timeouts on tmux operations: All `exec.CommandContext` calls include timeout via `context.WithTimeout`
- [ ] CHK-048 No database imports: No ORM, migration, or database packages imported
- [ ] CHK-049 Handler test isolation: Tests use mock interfaces, not live tmux
- [ ] CHK-050 Type narrowing: Prefer `if` guards over `.(type)` assertions where applicable

## Security

- [ ] CHK-051 No shell injection: All tmux calls via argument slices, user input validated before subprocess
- [ ] CHK-052 Path traversal: SPA serving prevents path escape via `filepath.Abs` boundary check
- [ ] CHK-053 Upload filename sanitization: `SanitizeFilename` strips null bytes, path separators, leading dots, dot sequences
- [ ] CHK-054 Home directory boundary: All path operations restricted to `$HOME` via `ExpandTilde` checks
- [ ] CHK-055 Upload size enforcement: `http.MaxBytesReader` applied before multipart parsing

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
