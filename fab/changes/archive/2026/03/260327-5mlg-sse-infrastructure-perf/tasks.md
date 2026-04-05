# Tasks: SSE Infrastructure Performance

**Change**: 260327-5mlg-sse-infrastructure-perf
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core SSE Hub Restructure

- [x] T001 Restructure `sseClient` and `sseHub` types in `app/backend/api/sse.go`: add `dropped bool` field to `sseClient`, change `clients` from `map[*sseClient]struct{}` to `map[string][]*sseClient`, update `newSSEHub()` initializer
- [x] T002 Update `addClient()` in `app/backend/api/sse.go`: append client to `h.clients[c.server]` slice, send cached snapshot, start polling if needed
- [x] T003 Update `removeClient()` in `app/backend/api/sse.go`: swap-delete from server's slice, delete map key if slice becomes empty

## Phase 2: Poll Loop + Buffer + Drop Logging

- [x] T004 Rewrite `poll()` in `app/backend/api/sse.go`: use `RLock()` for client-count check and server-key collection, `Lock()` for broadcast; iterate only the target server's client slice; add drop logging with debounce; reset `dropped` on successful send
- [x] T005 [P] Increase channel buffer from 8 to 32 in `handleSSE` in `app/backend/api/sse.go`

## Phase 3: Relay Race Fix

- [x] T006 [P] Fix reader goroutine in `app/backend/api/relay.go`: replace `conn.Close()` with `cleanup()` call in the PTY reader goroutine

## Phase 4: Tests

- [x] T007 Update `app/backend/api/sse_test.go`: fix `TestSSEHubDeduplication` and `TestSSEHubStopsPollingWhenNoClients` for new `map[string][]*sseClient` type — `sseClient` construction must include `server` field; add test for drop logging behavior

---

## Execution Order

- T001 blocks T002, T003, T004
- T002, T003 block T004
- T005 is independent (single line change)
- T006 is independent (different file)
- T007 depends on T001-T006
