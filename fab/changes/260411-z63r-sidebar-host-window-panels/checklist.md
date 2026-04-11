# Quality Checklist: Sidebar Host & Window Panels

**Change**: 260411-z63r-sidebar-host-window-panels
**Generated**: 2026-04-11
**Spec**: `spec.md`

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
