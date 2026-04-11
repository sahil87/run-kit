# Spec: Sidebar Host & Window Panels

**Change**: 260411-z63r-sidebar-host-window-panels
**Created**: 2026-04-11
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- macOS-native metrics (darwin `/proc` equivalent) — graceful degradation to zeros is sufficient
- Per-process CPU/memory breakdown — host-level aggregates only
- Configurable poll intervals — hardcoded 2.5s matching existing SSE tick
- Resizable or draggable panel boundaries

## Backend: System Metrics Collector

### Requirement: Metrics Package

The system SHALL provide a `internal/metrics/` package that collects host-level system metrics by reading Linux procfs files. The collector MUST run a background goroutine polling every `ssePollInterval` (2.5s). All shared state MUST be protected by `sync.RWMutex`.

#### Scenario: CPU Usage Collection
- **GIVEN** the metrics collector is running on Linux
- **WHEN** a poll tick fires
- **THEN** the collector reads `/proc/stat` and computes CPU usage percentage from the delta between consecutive readings
- **AND** appends the sample to a fixed-size ring buffer of 60 entries
- **AND** the ring buffer is pre-filled with zeros on startup so the sparkline always has full width

#### Scenario: Memory Usage Collection
- **GIVEN** the metrics collector is running on Linux
- **WHEN** a poll tick fires
- **THEN** the collector reads `/proc/meminfo` for `MemTotal` and `MemAvailable`
- **AND** computes used = total - available
- **AND** returns both values in bytes

#### Scenario: Load Average Collection
- **GIVEN** the metrics collector is running on Linux
- **WHEN** a poll tick fires
- **THEN** the collector reads `/proc/loadavg` for 1-minute, 5-minute, and 15-minute averages
- **AND** reads CPU count from the number of `cpu\d+` lines in `/proc/stat`

#### Scenario: Disk Usage Collection
- **GIVEN** the metrics collector is running
- **WHEN** a poll tick fires
- **THEN** the collector calls `syscall.Statfs("/")` to get total and used bytes for the root filesystem

#### Scenario: Uptime Collection
- **GIVEN** the metrics collector is running on Linux
- **WHEN** a poll tick fires
- **THEN** the collector reads `/proc/uptime` and parses the first field as uptime in seconds

#### Scenario: Hostname Resolution
- **GIVEN** the metrics collector initializes
- **WHEN** `Start()` is called
- **THEN** the collector calls `os.Hostname()` once and caches the result

#### Scenario: Collector Shutdown
- **GIVEN** the metrics collector is running
- **WHEN** the provided context is cancelled (server shutdown)
- **THEN** the background poll goroutine exits cleanly
- **AND** no further `/proc` reads or ring buffer writes occur
<!-- clarified: collector lifecycle — Start() accepts a context.Context; the poll goroutine selects on ctx.Done() for graceful shutdown, matching existing Go patterns in this codebase -->

#### Scenario: Non-Linux Graceful Degradation
- **GIVEN** the metrics collector is running on a non-Linux platform (e.g., macOS)
- **WHEN** `/proc/*` files are not available
- **THEN** the collector SHALL return zero values for CPU, memory, load, and uptime
- **AND** disk collection via `syscall.Statfs` SHOULD still work (cross-platform)
- **AND** the collector MUST NOT crash or log errors repeatedly

### Requirement: Collector API

The collector MUST expose a `Snapshot() MetricsSnapshot` method returning the current state. The constructor or `Start()` method SHALL accept a `context.Context` for lifecycle management. The `MetricsSnapshot` struct SHALL contain:

```go
type MetricsSnapshot struct {
    Hostname   string    `json:"hostname"`
    CPU        CPUMetrics    `json:"cpu"`
    Memory     MemoryMetrics `json:"memory"`
    Load       LoadMetrics   `json:"load"`
    Disk       DiskMetrics   `json:"disk"`
    UptimeSecs float64       `json:"uptime"`
}

type CPUMetrics struct {
    Samples []float64 `json:"samples"` // ring buffer, 60 entries
    Current float64   `json:"current"` // latest percentage 0-100
    Cores   int       `json:"cores"`   // logical CPU count
}

type MemoryMetrics struct {
    Used  uint64 `json:"used"`  // bytes
    Total uint64 `json:"total"` // bytes
}

type LoadMetrics struct {
    Avg1  float64 `json:"avg1"`
    Avg5  float64 `json:"avg5"`
    Avg15 float64 `json:"avg15"`
    CPUs  int     `json:"cpus"` // same as CPU.Cores, for frontend normalization
}

type DiskMetrics struct {
    Used  uint64 `json:"used"`  // bytes
    Total uint64 `json:"total"` // bytes
}
```

#### Scenario: Thread-Safe Snapshot Access
- **GIVEN** the collector is running and polling
- **WHEN** `Snapshot()` is called from the SSE broadcast goroutine
- **THEN** a consistent copy of all metrics is returned under RLock
- **AND** no data race occurs with the poll goroutine's writes

## Backend: SSE Metrics Event

### Requirement: Separate SSE Event Type

The SSE stream SHALL emit a new `event: metrics` event alongside the existing `event: sessions` event. The metrics event MUST be broadcast on every poll tick (not deduplicated like sessions), since CPU samples change every tick.

#### Scenario: Metrics Broadcast
- **GIVEN** at least one SSE client is connected
- **WHEN** the SSE poll tick fires
- **THEN** the hub calls `metricsCollector.Snapshot()` and broadcasts `event: metrics\ndata: {json}\n\n` to all connected clients

#### Scenario: New Client Receives Metrics Immediately
- **GIVEN** a client connects to the SSE stream
- **WHEN** the client is added to the hub
- **THEN** the hub sends the latest cached metrics snapshot immediately (alongside the cached sessions snapshot)
- **AND** the client receives a full 60-sample CPU history

#### Scenario: Metrics Broadcast Is Server-Independent
- **GIVEN** multiple clients are connected to different tmux servers
- **WHEN** the metrics tick fires
- **THEN** all clients receive the same metrics payload regardless of their server parameter
- **AND** the metrics event is broadcast once, not per-server

## Frontend: Collapsible Panel Component

### Requirement: Reusable CollapsiblePanel

The system SHALL provide a `CollapsiblePanel` component used by both Window and Host panels. The component MUST accept: `title` (string), `storageKey` (string for localStorage persistence), `defaultOpen` (boolean), and `children` (ReactNode).

#### Scenario: Default Open State
- **GIVEN** a CollapsiblePanel with `defaultOpen={true}`
- **WHEN** the component renders for the first time (no localStorage entry)
- **THEN** the panel content is visible
- **AND** the chevron points downward

#### Scenario: Collapse Toggle
- **GIVEN** a CollapsiblePanel is open
- **WHEN** the user clicks the panel header
- **THEN** the content area collapses with a smooth `max-height` CSS transition
- **AND** the chevron rotates from pointing down to pointing right
- **AND** the new state is persisted to `localStorage[storageKey]`

#### Scenario: Expand Toggle
- **GIVEN** a CollapsiblePanel is collapsed
- **WHEN** the user clicks the panel header
- **THEN** the content area expands with a smooth `max-height` transition
- **AND** the chevron rotates from pointing right to pointing down
- **AND** the new state is persisted to `localStorage[storageKey]`

#### Scenario: State Persistence
- **GIVEN** the user has collapsed a panel (stored in localStorage)
- **WHEN** the page is reloaded
- **THEN** the panel renders in the collapsed state

#### Scenario: Header Always Visible
- **GIVEN** a CollapsiblePanel in any state
- **WHEN** the component renders
- **THEN** the header row (title + chevron) is always visible regardless of collapse state

## Frontend: Window Panel

### Requirement: Refactored StatusPanel

The existing `StatusPanel` component (`status-panel.tsx`) SHALL be refactored into a `WindowPanel` that wraps its content in a `CollapsiblePanel` with `title="Window"`, `storageKey="runkit-panel-window"`, and `defaultOpen={true}`. The inner content (3 lines: cwd, win, fab/run) SHALL remain unchanged.

#### Scenario: Window Selected
- **GIVEN** a window is selected in the sidebar
- **WHEN** the WindowPanel renders
- **THEN** it displays the same 3 lines as the current StatusPanel (cwd, win, fab/run)
- **AND** the content is inside a collapsible panel with "Window" header

#### Scenario: No Window Selected
- **GIVEN** no window is selected
- **WHEN** the WindowPanel renders
- **THEN** the collapsible header "Window" is still visible
- **AND** the content area shows "No window selected" in secondary text

## Frontend: Host Panel

### Requirement: Host Metrics Panel

A new `HostPanel` component SHALL render inside a `CollapsiblePanel` with `title="Host"`, `storageKey="runkit-panel-host"`, and `defaultOpen={true}`. It displays 5 lines of server metrics.

#### Scenario: Hostname + Connection Status (Line 1)
- **GIVEN** the SSE metrics stream is providing data
- **WHEN** the HostPanel renders
- **THEN** line 1 shows the hostname on the left and a connection indicator dot on the right
- **AND** the dot is green (`text-accent-green`) when SSE is connected, gray when disconnected

#### Scenario: CPU Sparkline (Line 2)
- **GIVEN** the metrics stream provides CPU samples
- **WHEN** the HostPanel renders
- **THEN** line 2 shows `cpu` label + a Unicode braille sparkline rendered from the 60-sample array + current percentage
- **AND** the sparkline uses `text-accent` color
- **AND** the percentage uses `text-text-primary`
- **AND** braille characters map sample values to the 8-level braille range (`⣀⣤⣶⣿` and intermediates)

#### Scenario: Memory Gauge (Line 3)
- **GIVEN** the metrics stream provides memory used/total
- **WHEN** the HostPanel renders
- **THEN** line 3 shows `mem` label + a filled/empty block gauge (`████░░░`) + `used/totalG` text
- **AND** the gauge bar is green when usage < 70%, yellow when 70-90%, red when > 90%
- **AND** values are formatted in human-readable units (e.g., `3.1/8G`, `512M/2G`)

#### Scenario: Load Average (Line 4)
- **GIVEN** the metrics stream provides load averages and CPU count
- **WHEN** the HostPanel renders
- **THEN** line 4 shows `load` label + three percentages for 1/5/15 minute averages
- **AND** each percentage is computed as `(loadAvg / cpuCount) * 100`, rounded to integer
- **AND** any percentage exceeding 90% renders in red (`text-red-500` or accent-red equivalent)

#### Scenario: Disk + Uptime (Line 5)
- **GIVEN** the metrics stream provides disk and uptime data
- **WHEN** the HostPanel renders
- **THEN** line 5 shows `dsk` label + `used/totalG` + ` · up ` + formatted uptime
- **AND** text uses `text-text-secondary` color
- **AND** uptime is formatted as `{N}d {N}h` (days + hours), or `{N}h {N}m` if < 1 day

## Frontend: Sidebar Layout

### Requirement: Bottom-Aligned Collapsible Panels

The sidebar layout SHALL position both panels at the bottom of the flex container, with the session list filling remaining space above. The order top-to-bottom is: server selector → session list (flex-1 scrollable) → Window panel → Host panel.

#### Scenario: Both Panels Open
- **GIVEN** both Window and Host panels are open
- **WHEN** the sidebar renders
- **THEN** both panels are visible at the bottom, taking approximately 140px combined
- **AND** the session list scrollable area fills the remaining height

#### Scenario: One Panel Collapsed
- **GIVEN** the Host panel is collapsed
- **WHEN** the sidebar renders
- **THEN** only the Host header is visible (single line)
- **AND** the Window panel and session list get more vertical space

#### Scenario: Mobile Drawer
- **GIVEN** the viewport is < 768px (mobile)
- **WHEN** the sidebar drawer is open
- **THEN** both collapsible panels render identically to desktop
- **AND** the drawer is full-height with panels at the bottom

## Frontend: Bottom Bar Hostname Removal

### Requirement: Remove Hostname from Bottom Bar

The hostname display SHALL be removed from the right side of `bottom-bar.tsx`. The hostname is now shown exclusively in the Host panel.

#### Scenario: Bottom Bar Without Hostname
- **GIVEN** the terminal view is active
- **WHEN** the bottom bar renders
- **THEN** the right section no longer contains the hostname span
- **AND** the keyboard toggle button remains in the right section

## Frontend: Metrics SSE Integration

### Requirement: Consume Metrics SSE Event

The frontend SHALL listen for `event: metrics` on the SSE stream and parse the JSON payload into a React state object accessible by the HostPanel. The metrics event listener SHALL be added to the existing `EventSource` in `session-context.tsx` (which owns the SSE connection), and the parsed metrics state SHALL be exposed via the existing `SessionContext` (new `metrics` field on the context value, typed as `MetricsSnapshot | null`). <!-- clarified: metrics state ownership — session-context.tsx owns the EventSource, adding metrics there avoids a second SSE connection or cross-context coordination -->

#### Scenario: Metrics State Update
- **GIVEN** the SSE stream is connected
- **WHEN** a `metrics` event arrives
- **THEN** the metrics state is updated with the new payload
- **AND** the HostPanel re-renders with fresh data

#### Scenario: SSE Disconnected
- **GIVEN** the SSE stream is disconnected
- **WHEN** the HostPanel renders
- **THEN** the connection dot shows gray/disconnected
- **AND** the last known metrics data continues to display (stale but visible)

## Frontend: Braille Sparkline Renderer

### Requirement: Braille Character Mapping

A utility function SHALL convert an array of float64 values (0-100 range) into a string of Unicode braille characters. The mapping SHALL use 8 vertical levels per character cell, using braille patterns from the U+2800-U+28FF range that fill from bottom to top (e.g., `⣀⣄⣤⣦⣶⣷⣾⣿` — progressively filling both columns of the braille cell upward). Level 0 uses `⣀` (bottom row only), level 7 uses `⣿` (all dots filled). The exact character set is an implementation detail provided the visual effect is a smooth bottom-to-top fill matching the intake's `⣀⣤⣶⣿` aesthetic. <!-- clarified: braille level mapping — intake's `⣀⣤⣶⣿` was shorthand showing endpoints and midpoints; the spec requires 8 distinct levels filling bottom-to-top -->

#### Scenario: Full Range Mapping
- **GIVEN** an array of CPU samples ranging from 0 to 100
- **WHEN** the sparkline renderer is called
- **THEN** 0% maps to `⣀` (lowest braille) and 100% maps to `⣿` (highest braille)
- **AND** intermediate values are linearly interpolated across 8 levels

#### Scenario: Zero-Filled Buffer
- **GIVEN** the collector just started and the buffer is all zeros
- **WHEN** the sparkline renders
- **THEN** all characters show the lowest braille level (`⣀` repeated)

## Design Decisions

1. **Separate SSE event type (`event: metrics`) rather than embedding in sessions payload**
   - *Why*: Metrics are server-wide, not per-tmux-server. Sessions data is per-tmux-server and deduplicated; metrics change every tick (CPU samples). Separation avoids inflating session payloads and allows independent future evolution (e.g., different cadences).
   - *Rejected*: Embedding in sessions payload — would require sending metrics N times (once per tmux server) and complicates dedup logic.

2. **Ring buffer server-side, full history sent each tick**
   - *Why*: New clients immediately get complete sparkline history. No client-side accumulation logic needed. At 60 float64s, the payload cost is ~500 bytes — negligible.
   - *Rejected*: Client-side accumulation from deltas — would require reconnection logic to rebuild history and complicates the frontend.

3. **Braille sparkline for CPU, percentages for load**
   - *Why*: Two adjacent sparklines would be visually indistinguishable in a narrow sidebar. Percentages for load are immediately readable and distinct. Load as percentage (normalized by core count) is meaningful on any machine.
   - *Rejected*: Sparkline for load — discussed and rejected for visual clarity.

4. **Disk as plain text, not gauge bar**
   - *Why*: Disk usage changes extremely slowly (hours/days). A gauge bar would never visibly change during a session. Combined with uptime on one line saves vertical space.
   - *Rejected*: Gauge bar for disk — overkill for a near-static metric.

5. **Window panel above Host panel**
   - *Why*: Window info changes with every click (high-frequency glance). Host info is ambient/slow-changing. Top-to-bottom flow mirrors frequency: session list → selected window → server context.
   - *Rejected*: Host above Window — would push the more frequently consulted info further down.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Braille sparkline for CPU, not SVG chart | Confirmed from intake #1 — discussed and agreed | S:95 R:85 A:90 D:95 |
| 2 | Certain | Load as percentages, not sparkline | Confirmed from intake #2 — discussed and agreed | S:95 R:90 A:85 D:90 |
| 3 | Certain | Disk as plain text, not gauge bar | Confirmed from intake #3 — discussed and agreed | S:95 R:90 A:85 D:95 |
| 4 | Certain | Window panel above Host panel | Confirmed from intake #4 — discussed and agreed | S:95 R:90 A:85 D:90 |
| 5 | Certain | ~140px total height for both panels | Confirmed from intake #5 — discussed design target | S:90 R:85 A:80 D:85 |
| 6 | Certain | ~60 samples ring buffer for CPU sparkline | Confirmed from intake #6 — ~2.5 min history at 2.5s interval | S:90 R:85 A:85 D:90 |
| 7 | Certain | Memory gauge color thresholds: ~70% yellow, ~90% red | Confirmed from intake #7 — discussed thresholds | S:90 R:85 A:80 D:85 |
| 8 | Confident | Separate SSE event type for metrics | Upgraded from intake #8 — spec confirms: metrics are server-wide, sessions are per-tmux-server; separation cleaner | S:75 R:80 A:80 D:65 |
| 9 | Certain | New `internal/metrics/` package | Follows deterministic `internal/` convention (tmux, sessions, config, validate, daemon, settings) | S:75 R:85 A:90 D:90 |
| 10 | Confident | localStorage keys: `runkit-panel-window`, `runkit-panel-host` | Follows `runkit-*` convention but specific key names are a judgment call | S:65 R:90 A:80 D:80 |
| 11 | Confident | Graceful degradation on non-Linux (zeros, no crash) | macOS dev, Linux prod — reasonable default but behavior specifics are a judgment call | S:65 R:75 A:70 D:65 |
| 12 | Confident | `syscall.Statfs` for disk, no new dependency | stdlib sufficient for basic stats; only alternative would be x/sys/unix | S:60 R:85 A:75 D:70 |
| 13 | Certain | Hostname from `os.Hostname()` cached once | router.go:141 already does exactly this — direct reuse of existing pattern | S:80 R:90 A:90 D:95 |
| 14 | Certain | Metrics broadcast every tick, not deduplicated | CPU samples change every tick by definition — dedup is logically impossible | S:80 R:85 A:85 D:90 |
| 15 | Certain | Braille 8-level mapping using U+2800-U+28FF range | Standard Unicode braille block — only viable approach given braille sparkline decision | S:80 R:90 A:85 D:95 |

15 assumptions (11 certain, 4 confident, 0 tentative, 0 unresolved).
