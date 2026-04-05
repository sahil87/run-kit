# Intake: Inline Output Peek and Live Activity Previews

**Change**: 260405-7l79-inline-output-peek-live-previews
**Created**: 2026-04-06
**Status**: Draft

## Origin

> Inline output peek and live activity previews — Two related sidebar enhancements: (1) Inline output peek: on hover or via a small expand toggle on a sidebar window row, show the last 2-3 lines of terminal output directly in the sidebar without switching context. (2) Live activity previews: show a tiny last-N-lines preview or status indicator per window in the sidebar — a scrolling last line of output, or a mini status badge beyond just active/idle. These both answer the question "what is happening across all my agents at a glance" and should share infrastructure (streaming last N lines from a pane). Discuss: should this use a new SSE stream, extend the existing one, or poll? What's the tmux mechanism for reading last N lines from a pane?

One-shot input with explicit design questions. The user wants at-a-glance visibility into what each agent/window is doing without switching terminal tabs.

## Why

The sidebar currently shows per-window metadata — activity dot (active/idle), idle duration, fab stage badge, process name, and an info popover. But none of this answers the most fundamental question: **what is the window actually outputting right now?** To check, the user must click into each window one by one, losing context on the current terminal.

For agent orchestration workflows with 3-10+ concurrent agents, this is a significant friction point. The user needs a "mission control" view — at a glance, see what each agent is doing, whether it's stuck, what it just produced, or whether it's waiting for input. The existing active/idle indicator is binary and coarse; actual output content is the missing dimension.

If we don't fix it, users continue tab-switching to monitor agents, which is disruptive, slow, and scales poorly with window count.

## What Changes

Two related features that share backend infrastructure:

### 1. Inline Output Peek (hover/toggle)

A per-window expand mechanism in the sidebar that shows the last 2-3 lines of terminal output.

**Trigger**: Either hover (with a short delay to avoid flicker) or a small expand/collapse toggle icon on the window row. The toggle approach is more accessible and mobile-friendly. Recommend: **toggle icon** (`▾`/`▸` or similar) on the right side of the window row, near the existing info button.

**Content**: The last 2-3 non-empty lines of terminal output from the pane, rendered in a small monospace block below the window row. Truncated to ~60 characters per line with ellipsis. Background slightly different from sidebar (`bg-bg-card` or similar) to visually distinguish output from navigation.

**Behavior**:
- Clicking the toggle expands/collapses the peek for that window
- Multiple windows can be expanded simultaneously
- Expanded state persists during the session (not persisted to localStorage — transient)
- Content refreshes when new SSE data arrives (or via the chosen streaming mechanism)

### 2. Live Activity Preview (always-visible)

A compact, always-visible preview per window row showing a single scrolling line of the most recent output.

**Content**: The last meaningful line of terminal output, shown inline on the window row itself (below the window name, in `text-xs text-text-secondary` styling). Truncated to fit the sidebar width. Updates live as new output arrives.

**Behavior**:
- Always visible for every window (no toggle needed)
- Replaces or augments the current idle duration display
- Shows the last non-empty, non-whitespace line from the pane
- Updates at the same cadence as the data source (SSE tick or dedicated stream)

### 3. Backend: Pane Content Capture API

**tmux mechanism**: `tmux capture-pane -t {pane} -p -l {N}` captures the last N lines of visible terminal content from a pane. The project already has `fab pane capture` which wraps this. The Go backend needs a new endpoint or an extension to the existing SSE stream.

**Design discussion — data delivery**:

- **Option A: Extend existing SSE stream** — Add a `paneContent` field (last N lines per window) to the existing `GET /api/sessions/stream` payload. Pro: single connection, no new infrastructure. Con: significantly increases SSE payload size (N lines × M windows × every tick), even when nobody is looking at previews. The existing SSE polls at 2.5s with 500ms cache — this is already optimized for lightweight metadata.

- **Option B: New dedicated SSE stream** — A separate `GET /api/sessions/stream/pane-content?windows=session:0,session:1` endpoint that streams pane content only for subscribed windows. Pro: opt-in (only streams data for windows the client cares about), payload is scoped. Con: second SSE connection per client, more server complexity.

- **Option C: Polling** — Frontend calls `GET /api/sessions/{session}/windows/{index}/capture?lines=3` on demand (hover, toggle, or periodic). Pro: simplest backend, no streaming infrastructure. Con: anti-pattern per `code-quality.md` ("Polling from the client — use the SSE stream, not `setInterval` + fetch"). However, this anti-pattern is about replacing SSE with polling for session state — a targeted, on-demand capture for expanded windows is arguably different.

**Recommendation**: **Option A (extend SSE)** with a key optimization: only include pane content for windows that have changed since last tick (diff-based, matching the existing `previousJSON` dedup pattern). The SSE payload already includes all window metadata; adding 1-3 lines per window is a modest increase. The backend already runs `fab-go pane-map` every tick — extending to include a small content capture is the natural path.

Alternatively, a **hybrid of A+C**: SSE delivers the last-line preview (1 line, always), and the expanded peek (2-3 lines) is fetched on-demand when toggled. This keeps the SSE payload small while supporting both features.

**Backend implementation**:
- New function in `internal/tmux/tmux.go`: `CapturePane(ctx context.Context, session string, windowIndex int, lines int, server string) (string, error)` — wraps `tmux capture-pane -t {session}:{windowIndex} -p -l {lines}`
- Either extend `FetchSessions` to include capture data, or add a new endpoint `GET /api/sessions/{session}/windows/{index}/capture`

### 4. Frontend: Sidebar Enhancements

**Window row changes** (`sidebar.tsx`):
- Add a toggle icon for the peek expand/collapse
- Add a last-line preview text element below or beside the window name
- Add an expandable block below the window row for the 2-3 line peek

**New component or inline**: Given the sidebar is already a single file with substantial logic, the peek block could be an inline conditional render within the window row map.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar section gains inline output peek and live activity preview documentation
- `run-kit/architecture`: (modify) SSE payload or new endpoint for pane content capture
- `run-kit/tmux-sessions`: (modify) New CapturePane function in tmux package

## Impact

- **Backend**: `internal/tmux/tmux.go` (new CapturePane function), `internal/sessions/sessions.go` (enrichment with pane content), `api/sse.go` (extended payload or new endpoint), potentially `api/windows.go` (new capture endpoint)
- **Frontend**: `src/components/sidebar.tsx` (UI changes), `src/api/client.ts` (new API function if polling/on-demand), SSE consumer updates
- **Performance**: Pane capture adds subprocess calls — must be bounded (short timeout, limited line count). If done via SSE, scales linearly with window count
- **Dependencies**: No new dependencies — uses existing tmux infrastructure

## Open Questions

- Should the always-visible last-line preview and the expanded peek share the same data source, or should the last-line come from SSE and the expanded peek be on-demand?
- What is the right polling/refresh cadence for pane content — every SSE tick (2.5s) may be too frequent for subprocess-heavy capture, but less frequent may feel stale?
- Should expanded peek state be per-session (collapse all when switching sessions) or global?
- How should the output preview handle binary/garbled terminal content (e.g., ncurses-based apps, raw escape sequences)?

## Assumptions

<!-- STATE TRANSFER: This table is the sole continuity mechanism between the intake-stage
     agent and the spec-stage agent. Pipeline stages may execute in separate agent contexts
     with no shared memory — this table is what gives downstream agents visibility into
     what was decided, assumed, or left open. Every row must be substantive. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | tmux capture-pane is the mechanism for reading pane content | Constitution III (Wrap, Don't Reinvent) — `tmux capture-pane -t {pane} -p -l {N}` is the standard tmux command, already wrapped by `fab pane capture` | S:90 R:95 A:95 D:95 |
| 2 | Certain | No database or persistent cache for pane content | Constitution II (No Database) — content derived from tmux at request time | S:90 R:95 A:95 D:95 |
| 3 | Certain | Go backend with exec.CommandContext and timeout for capture | Constitution I (Security First) — all subprocess calls use CommandContext with explicit args | S:90 R:95 A:95 D:95 |
| 4 | Confident | Toggle-based expand (not hover) for the inline peek | Hover is not accessible on touch/mobile; toggle is more predictable and works across devices. Constitution V (Keyboard-First) supports explicit interaction | S:70 R:85 A:80 D:65 |
| 5 | Confident | Extend existing SSE stream rather than new endpoint or polling | code-quality.md anti-pattern explicitly prohibits client-side polling. Extending SSE is the simplest path that reuses existing infrastructure. New SSE stream adds complexity without clear benefit | S:65 R:70 A:75 D:60 |
| 6 | Confident | Last-line preview shows 1 line, expanded peek shows 2-3 lines | User description says "last 2-3 lines" for peek and "scrolling last line" for preview — two tiers of detail map naturally | S:75 R:90 A:70 D:70 |
| 7 | Confident | Capture limited to 3-5 lines with short timeout (2-3 seconds) | Performance concern — capture is a subprocess per window. Must be bounded to avoid blocking SSE tick | S:60 R:85 A:80 D:75 |
| 8 | Tentative | Strip ANSI escape sequences from captured content before display | Terminal output contains colors, cursor movement, etc. Raw display would be garbled. But stripping loses semantic info (error colors). Need to decide: strip all, or render a subset | S:50 R:75 A:55 D:45 |
<!-- assumed: ANSI stripping — most terminal content includes escape sequences that would render as garbage in a text preview; stripping is the safe default but loses color info -->
| 9 | Tentative | Hybrid approach: SSE carries last-line, on-demand fetch for expanded peek | Balances payload size (1 line per window in SSE is modest) with detail-on-demand (2-3 lines only when user asks). But adds two code paths | S:55 R:70 A:50 D:40 |
<!-- assumed: Hybrid data delivery — splitting last-line (SSE) from expanded peek (on-demand) reduces SSE payload growth while still providing detail when needed -->
| 10 | Tentative | Pane content captured in parallel with existing pane-map enrichment | The existing `fetchPaneMapCached` runs `fab-go pane-map` with 5s TTL. Capture could piggyback on the same cycle. But adding capture to every tick increases subprocess load | S:50 R:65 A:55 D:45 |
<!-- assumed: Capture piggybacks on pane-map cycle — reusing the existing enrichment timing avoids a separate polling mechanism, though it increases per-tick work -->

10 assumptions (3 certain, 4 confident, 3 tentative, 0 unresolved).
