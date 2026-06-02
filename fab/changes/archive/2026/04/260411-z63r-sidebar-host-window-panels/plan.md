# Plan: Sidebar Host & Window Panels

**Change**: 260411-z63r-sidebar-host-window-panels
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

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

## Acceptance

## Functional Completeness
- [ ] CHK-001 Metrics collector reads CPU, memory, load, disk, uptime from procfs and exposes via Snapshot()
- [ ] CHK-002 CPU ring buffer holds 60 samples, pre-filled with zeros on startup
- [ ] CHK-003 SSE stream emits `event: metrics` on every poll tick with full MetricsSnapshot JSON
- [ ] CHK-004 New SSE clients receive cached metrics snapshot immediately on connect
- [ ] CHK-005 CollapsiblePanel component supports title, chevron rotation, max-height transition, localStorage persistence
- [ ] CHK-006 WindowPanel wraps existing StatusPanel content in CollapsiblePanel with "Window" header
- [ ] CHK-007 HostPanel renders 5 lines: hostname+dot, CPU sparkline, memory gauge, load percentages, disk+uptime
- [ ] CHK-008 Braille sparkline renders 8-level bottom-to-top fill from CPU sample array
- [ ] CHK-009 Memory gauge bar shows green (<70%), yellow (70-90%), red (>90%) color thresholds
- [ ] CHK-010 Load percentages computed as (load/nCPU)*100, red when >90%
- [ ] CHK-011 Disk + uptime combined on one line in secondary text color
- [ ] CHK-012 Hostname removed from bottom-bar.tsx right section
- [ ] CHK-013 Metrics state consumed via SessionContext (new `metrics` field)

## Behavioral Correctness
- [ ] CHK-014 Both panels open by default, collapse state persisted to localStorage
- [ ] CHK-015 Panels bottom-aligned: server selector → session list → Window panel → Host panel
- [ ] CHK-016 WindowPanel shows "No window selected" fallback when no window is selected
- [ ] CHK-017 Connection indicator dot reflects SSE connection state (green/gray)
- [ ] CHK-018 Metrics continue displaying stale data when SSE disconnects

## Scenario Coverage
- [ ] CHK-019 Collapse toggle: click header → content collapses, chevron rotates, state saved
- [ ] CHK-020 Expand toggle: click collapsed header → content expands, state saved
- [ ] CHK-021 State persistence: reload page → panels restore saved open/closed state
- [ ] CHK-022 New client: connect SSE → receive immediate metrics + full CPU sparkline history
- [ ] CHK-023 Non-Linux: collector returns zeros without crash or repeated error logs

## Edge Cases & Error Handling
- [ ] CHK-024 Collector shutdown: context cancellation stops poll goroutine cleanly
- [ ] CHK-025 Zero CPU samples: sparkline renders full-width lowest braille characters
- [ ] CHK-026 Metrics broadcast is server-independent (same payload to all clients)

## Code Quality
- [ ] CHK-027 Pattern consistency: metrics collector uses `exec.CommandContext`-equivalent patterns (context + timeout)
- [ ] CHK-028 Pattern consistency: CollapsiblePanel follows existing component conventions (Tailwind, text-xs, border-border)
- [ ] CHK-029 No unnecessary duplication: reuses existing SSE hub infrastructure, SessionContext, existing color tokens
- [ ] CHK-030 Anti-pattern check: no shell string construction, no inline tmux commands, no polling from client
- [ ] CHK-031 All `sync.RWMutex` usage correct (RLock for reads, Lock for writes)
- [ ] CHK-032 New code follows naming conventions of surrounding code in each package

## Security
- [ ] CHK-033 Metrics collector reads only /proc files and syscall.Statfs — no user input in file paths

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
