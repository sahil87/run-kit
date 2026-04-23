# Intake: Pane Lanes

**Change**: 260423-zq87-pane-lanes
**Created**: 2026-04-23
**Status**: Draft

## Origin

> Conversational — arose from a `/fab-discuss` session. Arbaaz described the pain of switching between agent panes one at a time when multiple Claude agents are running. After exploring grid views, attention badges, and snapshot-based previews, the mental model converged on **TweetDeck / X Pro lanes**: pinned columns of live terminal content, side by side, with horizontal scroll. Confirmed with "like twitter pro lanes — you subscribe and see everything at one place."

## Why

When running multiple Claude agents across tmux panes, the current UI forces single-pane viewing — you navigate to `/$server/$session/$window`, interact with one agent, then navigate away to check another. This creates two pain points:

1. **Blind spots**: You can't see which agent needs your attention without manually cycling through panes. An agent may be waiting for a response while you're working in a different pane, wasting agent time.
2. **Switching cost**: Each navigation (sidebar click → page load → context regain) takes several seconds. Multiply by 5-10 active agents and the overhead dominates your workflow.

If we don't fix this, agent orchestration scales poorly — the human becomes the bottleneck not because of decision speed, but because of UI friction. The TweetDeck model solves both problems: all pinned panes are visible (no blind spots) and interaction is immediate (no navigation, just scroll and type).

## What Changes

### New View: Pane Lanes

A multi-column layout where each column ("lane") displays a live terminal pane. Lanes are arranged horizontally and the container scrolls horizontally to reveal more lanes than fit on screen.

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ session-1 │ │ session-2 │ │ session-1 │ │ session-3 │
│ window-3  │ │ window-0  │ │ window-1  │ │ window-2  │
│           │ │           │ │           │ │           │
│  live     │ │  live     │ │  live     │ │  live     │
│  terminal │ │  terminal │ │  terminal │ │  terminal │
│  output   │ │  output   │ │  output   │ │  output   │
│           │ │           │ │           │ │           │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
      ◄──── horizontal scroll ────►
```

Each lane:
- Has a **header** showing session name, window name, and an unpin button
- Contains a **live xterm.js terminal** with its own WebSocket relay connection
- Is **independently scrollable** vertically (terminal scrollback)
- Accepts **keyboard input** when focused (click a lane to focus it, type to interact)

### Pin/Unpin Mechanism

Users "subscribe" to panes they want to monitor. Multiple discovery paths:
- **Command palette**: "Lanes: Pin Current Window" / "Lanes: Unpin Window" (keyboard-first, primary discovery per constitution)
- **Sidebar**: Pin/unpin icon on window rows in the left panel
- **Right-click context menu**: Right-click a window row in the sidebar → "Pin to Lanes" / "Unpin from Lanes"
- **Lane header**: Unpin button in each lane's header bar
- **Pin state**: Persisted in `localStorage` as an array of `{server, session, windowIndex}` tuples, surviving page refreshes

### Navigation to Lanes View

<!-- clarified: Lanes view as a new route /lanes (root-level, cross-server) — confirmed by user; justified because neither dashboard nor terminal view can accommodate multi-column live terminals -->

The lanes view is a **root-level route** at `/lanes` — not scoped to a single server. This enables cross-server pinning (see below). Accessible via:
- Direct URL: `/lanes`
- Command palette action: "View: Open Lanes"
- A persistent button/link in the dashboard or top bar

When no panes are pinned, the view shows an empty state with guidance on how to pin panes.

### Cross-Server, Cross-Session Pinning

<!-- clarified: Cross-server and cross-session pinning — user explicitly requested "cross server also" -->

Pins are **not scoped to a single server or session**. A pin is a `{server, session, windowIndex}` tuple. The lanes view aggregates panes from any tmux server and any session — a true command center across the entire tmux fleet.

- Each lane header shows **server · session · window** for full identification
- Pin state stored in `localStorage` as an array of `{server, session, windowIndex}` objects
- SSE subscriptions span multiple servers (one connection per server with pinned panes)
- WebSocket relay connections use the `?server=` query param to target the correct server

### Lane Width

<!-- clarified: Resizable per-lane — user chose resizable over fixed uniform -->

Each lane is **resizable** via drag handle on its right edge, matching the existing sidebar resize pattern. Width is persisted per-lane in `localStorage`. A reasonable default width (~480px, enough for ~80 terminal columns at 13px font) applies to newly pinned lanes.

### WebSocket Connection Management

Each pinned lane establishes its own WebSocket connection to `/relay/:session/:window?server=<server>`. The existing relay infrastructure supports this — each connection is independent. Considerations:
- Connections are established when the lanes view is mounted and torn down on unmount
- If a pinned pane's window is killed in tmux, the lane should show a "window closed" state and auto-unpin after a brief delay
- A reasonable soft cap on simultaneous lanes (e.g., 8-12) to prevent resource exhaustion, with a warning when approaching the limit

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the lanes view route, layout, pin/unpin interactions, and lane component structure
- `run-kit/architecture`: (modify) Document WebSocket multi-connection pattern and localStorage pin persistence

## Impact

- **Frontend**: New route, new components (lanes container, lane component, pin state management), xterm.js multi-instance rendering, command palette actions
- **Backend**: No backend changes expected — existing `/relay/:session/:window` WebSocket and SSE endpoints are sufficient
- **API spec**: No new endpoints — uses existing relay and SSE
- **Constitution**: Adds a new root-level route (`/lanes`). The constitution says "two routes" and "new pages SHOULD only be added when an existing page genuinely cannot accommodate." This feature genuinely cannot fit into the existing single-pane terminal view or the dashboard — it requires a fundamentally different layout with multiple live terminal instances across servers. This justifies the addition
- **Performance**: Multiple xterm.js instances + WebSocket connections. CPU/memory scales with number of pinned lanes. Need to validate performance at 8-12 simultaneous terminals

## Open Questions

None — all questions resolved during clarification.

## Clarifications

### Session 2026-04-23

| # | Action | Detail |
|---|--------|--------|
| 7 | Changed | Route changed from `/$server/lanes` to root-level `/lanes` (cross-server) |
| 8 | Changed | Expanded from cross-session to cross-server + cross-session pinning |
| 9 | Changed | All three interaction models: click-to-focus, hover-to-focus, keyboard cycling |
| — | Resolved | Lane width: resizable per-lane with drag handle, ~480px default, persisted in localStorage |
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Changed | Added sidebar icon and right-click context menu as pin/unpin discovery paths |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Horizontal scroll layout with columns | Discussed — user explicitly described "infinite horizontal scroll" like X Pro lanes | S:95 R:85 A:90 D:90 |
| 2 | Certain | Live terminal content in each lane, not static snapshots | Discussed — user chose TweetDeck model after being presented with both live and snapshot options; TweetDeck columns are definitionally live | S:85 R:45 A:70 D:80 |
| 3 | Certain | Pin/unpin model for selecting which panes to show | Discussed — user said "pin all the panes I'm interested in" and "you subscribe" | S:90 R:85 A:85 D:90 |
| 4 | Certain | Each lane uses a full xterm.js instance with its own WebSocket relay | Clarified — user confirmed | S:95 R:40 A:70 D:65 |
| 5 | Certain | Pin state persisted in localStorage as array of {server, session, windowIndex} tuples | Clarified — user confirmed | S:95 R:85 A:75 D:75 |
| 6 | Certain | Pin/unpin via command palette, sidebar icon, right-click context menu, and lane header unpin | Clarified — user confirmed command palette + added sidebar and right-click context menu | S:95 R:90 A:85 D:70 |
| 7 | Certain | Root-level route at /lanes (not server-scoped) | Clarified — user confirmed new route; changed to root-level to support cross-server pinning | S:95 R:50 A:65 D:50 |
| 8 | Certain | Cross-server and cross-session pinning | Clarified — user explicitly requested "cross server also" | S:95 R:55 A:50 D:45 |
| 9 | Certain | Triple interaction model: click-to-focus, hover-to-focus, keyboard cycling | Clarified — user said "all feels right" when presented with all three options | S:95 R:75 A:60 D:55 |
| 10 | Tentative | Soft cap of ~8-12 simultaneous pinned lanes | Performance boundary — each lane is an xterm.js instance + WebSocket. No hard data yet on resource cost at scale | S:25 R:70 A:50 D:50 |
| 11 | Certain | Resizable lane width with drag handle, ~480px default, persisted in localStorage | Clarified — user chose resizable over fixed uniform | S:95 R:85 A:70 D:70 |

11 assumptions (10 certain, 0 confident, 1 tentative, 0 unresolved).
