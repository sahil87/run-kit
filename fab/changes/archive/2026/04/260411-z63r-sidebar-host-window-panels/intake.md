# Intake: Sidebar Host & Window Panels

**Change**: 260411-z63r-sidebar-host-window-panels
**Created**: 2026-04-11
**Status**: Draft

## Origin

> Add two collapsible, bottom-aligned panels to the sidebar: "Window" (top) and "Host" (bottom). Window panel refactors the existing StatusPanel into a collapsible section showing cwd, win, fab/run lines. Host panel is a new server-level metrics section with hostname + SSE indicator, CPU sparkline, memory gauge, load averages, and disk + uptime. Backend streams system metrics via SSE from /proc. Detailed discussion established specific visualization choices: braille sparklines for CPU (matching existing BrailleSpinner aesthetic), gauge bar for memory (green-yellow-red gradient), percentages for load (avoiding visual blur with two sparklines), plain text for disk (extremely slow-changing metric). Window panel positioned above Host because window info is high-frequency glance vs ambient host data.

## Why

The sidebar currently shows a flat, always-visible StatusPanel with cwd, window name, and fab state. There is no server-level health information visible anywhere in the UI — users must open a separate terminal to check CPU, memory, load, or disk usage. For an agent orchestration dashboard where users manage long-running processes across multiple tmux sessions, ambient visibility into host health is essential: a runaway process consuming CPU or memory should be visible at a glance without context-switching.

Collapsible panels also improve information density management — users who don't need host metrics can collapse that panel, while the window panel (most frequently glanced at) stays compact. The bottom-aligned design keeps these panels anchored regardless of sidebar content length, similar to status bars in IDEs.

## What Changes

### Frontend: Window Panel (refactor of StatusPanel)

Refactor `app/frontend/src/components/sidebar/status-panel.tsx` into a collapsible panel within the sidebar. The panel retains the same 3-line content:

1. **cwd** — shortened current working directory (existing logic from the shorten-cwd change)
2. **win** — window name + pane info
3. **fab/run** — fab change name or process state

The panel gets a collapsible header with "Window" title, chevron icon that rotates on toggle, and smooth max-height CSS transition for expand/collapse animation. Open by default, collapse state persisted to localStorage key (e.g., `runkit-panel-window`).

### Frontend: Host Panel (new component)

New component (e.g., `app/frontend/src/components/sidebar/host-panel.tsx`) rendering 5 lines of server metrics:

1. **Hostname + SSE indicator** — hostname string from backend + green dot (matching existing connection indicator pattern) showing SSE connection health.

2. **CPU sparkline** — Unicode braille characters (`⣀⣤⣶⣿` range) rendering ~60 samples as a sliding sparkline, updated every 2-3 seconds. Uses accent color (`text-accent`). Displays percentage alongside (e.g., `▪▪▪▪ 42%`). ~60 samples ring buffer maintained server-side, sent in full on each SSE tick so new clients get history immediately.

3. **Memory gauge** — filled/empty block characters (`████░░░`) showing usage proportion + `used/total` text (e.g., `3.1/8G`). Bar color gradient based on thresholds:
   - Green (`text-accent-green` or similar) when < ~70%
   - Yellow when ~70-90%
   - Red when > ~90%

4. **Load average** — three percentages for 1/5/15 minute averages, normalized as `(load / nCPU) * 100`. Text turns red when any value exceeds 90%. Format: `12% 8% 6%` or similar compact display.

5. **Disk + uptime** — combined plain text line in secondary color (`text-text-secondary`). Format: `82/250G · up 14d 6h`. Disk from root filesystem, uptime from system.

Same collapsible behavior as Window panel — header with "Host" title, chevron rotation, max-height transition. Open by default, collapse state persisted to localStorage key (e.g., `runkit-panel-host`).

### Frontend: Sidebar Layout

Both panels are bottom-aligned in the sidebar, positioned below existing sidebar content. Window panel sits above Host panel. Combined height target ~140px at typical sidebar width (~32 monospace characters). The panels use `mt-auto` or equivalent to push to the bottom of the sidebar flex container.

### Frontend: Collapsible Panel Shared Component

Extract a reusable `CollapsiblePanel` component (or equivalent pattern) used by both Window and Host panels. Features:
- Header always visible with title text and chevron icon
- Chevron rotates 90 degrees on toggle (CSS `transform: rotate()` with transition)
- Content area uses `max-height` transition for smooth expand/collapse
- `overflow: hidden` during transition, visible when fully expanded
- Accepts `storageKey` prop for localStorage persistence
- Default open state configurable via prop

### Frontend: Bottom Bar Hostname Removal

Move hostname display from `app/frontend/src/components/bottom-bar.tsx` right side into the Host panel's first line. The bottom bar no longer shows hostname — it moves entirely into the sidebar Host panel.

### Backend: System Metrics Collector

New Go package (e.g., `app/backend/internal/metrics/`) that reads system metrics from procfs:

- **CPU**: Read `/proc/stat` to compute per-tick CPU usage percentage. Maintain a ring buffer of ~60 samples server-side. Each sample is a float64 percentage (0-100). Buffer pre-populated with zeros on startup so sparkline always has full width.
- **Memory**: Read `/proc/meminfo` for `MemTotal`, `MemAvailable` (or `MemFree + Buffers + Cached` as fallback). Compute used = total - available. Return total and used in bytes.
- **Load**: Read `/proc/loadavg` for 1/5/15 minute load averages. Also read CPU count from `/proc/stat` (count `cpu\d+` lines) or `/proc/cpuinfo` to expose `nCPU` for frontend normalization.
- **Disk**: Use `syscall.Statfs` (or `golang.org/x/sys/unix.Statvfs`) on `/` to get total and used disk space.
- **Uptime**: Read `/proc/uptime` for system uptime in seconds.
- **Hostname**: Use `os.Hostname()`.

The collector runs a background goroutine polling every 2-3 seconds, updating the ring buffer and current snapshot. Thread-safe access via `sync.RWMutex`.

### Backend: SSE Integration

Add system metrics to the existing SSE stream in `app/backend/api/sse.go`. Options:
1. New SSE event type (`event: metrics`) alongside existing session state events, OR
2. New field on the existing state payload

The metrics payload includes:
```json
{
  "hostname": "myhost",
  "cpu": {
    "samples": [0, 0, 12.5, 15.3, ...],
    "current": 42.1,
    "cores": 4
  },
  "memory": {
    "used": 3355443200,
    "total": 8589934592
  },
  "load": {
    "avg1": 0.52,
    "avg5": 0.31,
    "avg15": 0.22,
    "cpus": 4
  },
  "disk": {
    "used": 88046829568,
    "total": 268435456000
  },
  "uptime": 1234567
}
```

Polled and broadcast every 2-3 seconds, matching the existing SSE tick interval. Full CPU sample history sent each tick so newly connected clients get the complete sparkline immediately.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the new collapsible panel pattern, Host panel visualization specs (sparkline, gauge, load), and sidebar layout changes
- `run-kit/architecture`: (modify) Document the new metrics collector package and SSE metrics payload

## Impact

- **Frontend**: `status-panel.tsx` refactored into collapsible Window panel, new `host-panel.tsx`, sidebar layout changes in `sidebar/index.tsx`, bottom-bar hostname removal
- **Backend**: New `internal/metrics/` package, SSE handler modification in `api/sse.go`
- **API**: SSE stream gains metrics data (new event type or payload field)
- **Dependencies**: Possibly `golang.org/x/sys/unix` for `Statvfs` if `syscall.Statfs` is insufficient; otherwise no new dependencies
- **Performance**: Background goroutine polling /proc every 2-3s is negligible. SSE payload size increases by ~200-400 bytes per tick. Ring buffer is fixed-size (~60 float64s)
- **Platform**: /proc-based metrics are Linux-only. The collector should gracefully degrade on non-Linux (return zeros or skip metrics) since dev may happen on macOS

## Open Questions

- None — the description is comprehensive with specific visualization choices, thresholds, and design rationale documented.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Braille sparkline for CPU, not SVG chart | Discussed — matches existing BrailleSpinner aesthetic, terminal-native feel | S:95 R:85 A:90 D:95 |
| 2 | Certain | Load as percentages, not sparkline | Discussed — two similar sparkline graphs would blur together visually | S:95 R:90 A:85 D:90 |
| 3 | Certain | Disk as plain text, not gauge bar | Discussed — extremely slow-changing metric doesn't need visualization | S:95 R:90 A:85 D:95 |
| 4 | Certain | Window panel above Host panel | Discussed — window info is high-frequency glance, host is ambient monitoring | S:95 R:90 A:85 D:90 |
| 5 | Certain | ~140px total height for both panels | Discussed — specific size target for both panels at typical sidebar width | S:90 R:85 A:80 D:85 |
| 6 | Certain | ~60 samples ring buffer for CPU sparkline | Discussed — server-side buffer, sent in full each SSE tick | S:90 R:85 A:85 D:90 |
| 7 | Certain | Memory gauge color thresholds: ~70% yellow, ~90% red | Discussed — specific thresholds from the description | S:90 R:85 A:80 D:85 |
| 8 | Confident | Use new SSE event type rather than embedding in existing state payload | Cleaner separation of concerns — metrics are independent of session state, different update cadence possible in future | S:70 R:80 A:75 D:60 |
| 9 | Confident | New `internal/metrics/` package for system metrics collector | Follows existing package structure convention (internal/tmux, internal/sessions, etc.) | S:70 R:85 A:80 D:75 |
| 10 | Confident | localStorage keys: `runkit-panel-window`, `runkit-panel-host` | Follows existing localStorage key convention (`runkit-theme`, `runkit-server`) | S:65 R:90 A:80 D:80 |
| 11 | Confident | Graceful degradation on non-Linux (return zeros/skip metrics) | macOS dev environment lacks /proc — collector must not crash, but full macOS support not required | S:65 R:75 A:70 D:65 |
| 12 | Confident | Use `syscall.Statfs` for disk metrics, avoid new dependency | Standard library sufficient for basic disk stats; `golang.org/x/sys/unix` only if needed | S:60 R:85 A:75 D:70 |
| 13 | Confident | Hostname sourced from `os.Hostname()` server-side, not tmux | More reliable than tmux-derived hostname; already available in Go stdlib | S:70 R:90 A:80 D:80 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
