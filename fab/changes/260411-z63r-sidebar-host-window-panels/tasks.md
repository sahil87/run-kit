# Tasks: Sidebar Host & Window Panels

**Change**: 260411-z63r-sidebar-host-window-panels
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/backend/internal/metrics/` package with `MetricsSnapshot`, `CPUMetrics`, `MemoryMetrics`, `LoadMetrics`, `DiskMetrics` struct definitions and `Collector` interface (Start/Snapshot)
- [x] T002 [P] Create `app/frontend/src/components/sidebar/collapsible-panel.tsx` — reusable CollapsiblePanel component with title, chevron rotation, max-height transition, localStorage persistence via `storageKey` prop

## Phase 2: Core Implementation

- [x] T003 Implement metrics collector in `app/backend/internal/metrics/collector.go` — background goroutine reading `/proc/stat` (CPU), `/proc/meminfo` (memory), `/proc/loadavg` (load), `/proc/uptime` (uptime), `syscall.Statfs` (disk), `os.Hostname()`. Ring buffer of 60 CPU samples, `sync.RWMutex`, `context.Context` for lifecycle, graceful non-Linux degradation
- [x] T004 Add `event: metrics` SSE broadcast in `app/backend/api/sse.go` — initialize collector in `NewRouter` (passing server context for lifecycle), store on sseHub, call `Snapshot()` each poll tick, broadcast to all clients (not per-server), send cached snapshot to new clients on connect <!-- clarified: collector lifecycle — initialized in NewRouter where context is available, stored on sseHub for poll-loop access; matches spec requirement that Start() accepts context.Context -->
- [x] T005 [P] Create braille sparkline renderer in `app/frontend/src/lib/sparkline.ts` — converts float64 array (0-100) to Unicode braille string using 8-level bottom-to-top fill (`⣀⣄⣤⣦⣶⣷⣾⣿`)
- [x] T006 [P] Create memory gauge bar renderer in `app/frontend/src/lib/gauge.ts` — converts used/total to filled/empty block string (`████░░░`), returns color class based on thresholds (<70% green, 70-90% yellow, >90% red), formats bytes to human-readable (e.g., `3.1/8G`)
- [x] T007 Add `metrics` field to SSE event handling in `app/frontend/src/contexts/session-context.tsx` — listen for `event: metrics`, parse JSON into `MetricsSnapshot` type, expose via `SessionContext` as `metrics: MetricsSnapshot | null`

## Phase 3: Integration & Edge Cases

- [x] T008 Create `app/frontend/src/components/sidebar/host-panel.tsx` — HostPanel component consuming metrics from SessionContext, rendering 5 lines (hostname+dot, cpu sparkline, mem gauge, load percentages, disk+uptime) inside CollapsiblePanel
- [x] T009 Refactor `app/frontend/src/components/sidebar/status-panel.tsx` into WindowPanel — wrap existing 3-line content in CollapsiblePanel with title="Window", storageKey="runkit-panel-window", handle null window with "No window selected" fallback text <!-- clarified: added null-window fallback per spec scenario "No Window Selected" -->
- [x] T010 Update `app/frontend/src/components/sidebar/index.tsx` — replace `<StatusPanel>` with `<WindowPanel>` + `<HostPanel>` bottom-aligned below session list
- [x] T011 Remove hostname display from `app/frontend/src/components/bottom-bar.tsx` — delete the hostname span from the right section

## Phase 4: Polish

- [x] T012 Add Go tests for metrics collector in `app/backend/internal/metrics/collector_test.go` — test ring buffer behavior, snapshot thread safety, zero-value degradation
- [x] T013 [P] Add frontend tests for sparkline renderer (`app/frontend/src/lib/sparkline.test.ts`) and gauge renderer (`app/frontend/src/lib/gauge.test.ts`)
- [x] T014 [P] Add frontend test for CollapsiblePanel (`app/frontend/src/components/sidebar/collapsible-panel.test.tsx`) — toggle behavior, localStorage persistence

---

## Execution Order

- T001 blocks T003, T004
- T002 blocks T008, T009, T010
- T003 blocks T004
- T004 blocks T007
- T005, T006 are independent, can run alongside T003-T004
- T007 blocks T008
- T008, T009 block T010
- T010 blocks T011 (verify layout before removing hostname)
- T012 depends on T003
- T013 depends on T005, T006
- T014 depends on T002
