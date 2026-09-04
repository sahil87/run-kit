---
type: memory
description: "The operator chat console — a pull-down overlay (desktop drawer, mobile sheet under the top bar) mounted once at the root layout. Covers the rk:operator-console document-event seam for all entry points (chord, palette action, Ask-operator fallback row, pinned sidebar row, overflow-menu row), the embedded live operator terminal over /ws/terminals, compose/send semantics (send target:\"agent\", chat-send allow+probe, inline errors), server-context resolution, and degrade-to-absent gating."
---
# run-kit UI — Operator Console

**Domain**: run-kit/ui

## Overview

The operator chat console is the talk-to-the-operator surface: a global overlay that slides down from under the top bar on every route (Host, tmux Server, Terminal, Board) carrying a live embedded view of the server operator's window plus a compose strip, so a message is written and its reply read without leaving the current route. It is frontend-only — no backend route, no transcript read path: delivery rides the existing `POST /api/windows/{id}/send` agent-target lane and reading rides the existing `/ws/terminals` relay mux. The implementation is `app/frontend/src/components/operator-console.tsx` (the overlay) plus pure helpers in `app/frontend/src/lib/operator-console.ts` (colocated tests for both).

## Requirements

### Requirement: Root-layout mount; overlay, not a route
The console SHALL mount exactly once at the persistent root layout in `app/frontend/src/app.tsx` (lazy-imported beside the single `CommandPalette` mount), as an `absolute` overlay inside the main area (the `relative flex-1 min-h-0` region under the top bar), so pages below keep their layout. Opening/closing never navigates and never writes URL, tmux, or localStorage state — open/closed is ephemeral per-viewer component state (Constitution IV), so a reload always starts closed. Esc closes it via a bubble-phase document keydown listener that honors `defaultPrevented` (a nested modal's Escape wins — the console is a non-modal drawer, not a focus trap); closing unmounts the overlay, which closes the terminal stream. Focus moves to the compose input on open (the strip's first control when the operator-absent hint is showing) and the previously focused element is restored on close. A short `rk-console-drop` settle-in animation (`globals.css`, transform-only) plays on open and is zeroed under `prefers-reduced-motion`.

#### Scenario: Toggle from any route
- **GIVEN** any route (Host, Server, Terminal, Board)
- **WHEN** the console chord, palette action, or overflow-menu row fires
- **THEN** the console opens below the top bar without navigation, and Esc or a chord re-fire closes it

### Requirement: One document-event seam for every entry point
All entry points SHALL reach the layout-mounted console by dispatching the `rk:operator-console` document CustomEvent (`OPERATOR_CONSOLE_EVENT`) via `requestOperatorConsole(req)` in `lib/operator-console.ts` — never by prop threading or direct state access, because the entry points live in route shells the layout does not compose directly (the `palette:open` / `HOST_MENU_OPEN_EVENT` seam idiom). The request shape is `{ action: "toggle" | "open", server?, send? }`: `toggle` flips open/closed (the chord, palette action, and overflow-menu row); `open` always opens (the sidebar pinned row, which also pins `server` to its own row's server); `send` carries text to deliver immediately once open (the palette fallback row's query — dropped unsent when the resolved server has no operator window, the hint line being the answer there). The entry points are: the registry chord (⌘J/⇧Ctrl+J — [keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md)), the palette action `Operator: Open console`, the palette's Ask-operator fallback row, the sidebar pinned operator row's activation ([sidebar](/run-kit/ui/sidebar.md) § Operator Pinned Row), and the mobile top-bar overflow-menu row ([top-bar](/run-kit/ui/top-bar.md)).

### Requirement: Anatomy — title strip, embedded terminal, compose strip
The console SHALL render, top to bottom: (a) a title strip with `◉ OPERATOR`, the resolved server name (or a server picker when the route carries no server param and more than one server exists), the operator window's live agent state from the sessions payload (`agentState` + idle duration), and a close affordance; (b) an embedded live terminal; (c) a compose strip. Desktop geometry is a centered drawer (`w-[min(760px,94vw)] h-[55vh]`) with the terminal filling the space above the compose strip.

#### Scenario: Open console on an operator-bearing server
- **GIVEN** an open console on a server with an operator window
- **WHEN** it renders
- **THEN** the title strip shows the server and live operator state, the terminal shows the operator window's live frame, and the compose input has focus

### Requirement: Embedded terminal over the shared relay mux
The embedded terminal MUST be the existing `TerminalClient` (`components/terminal-client.tsx`) over the shared `/ws/terminals` `RelayMux` — the same mechanism a board pane uses to render a cross-server window — pointed at the operator window's `(server, windowId)` with `registerFocus={false}` so the BottomBar keeps its own focus target (the BoardPane precedent). No new backend endpoint, no transcript read path, no new WS subscription kind. The stream opens at the console viewport's cols/rows under the existing multi-client attach semantics (identical to a second browser tab on the same window) and closes on console unmount; the mount is keyed `${server}:${windowId}` so a server switch re-attaches cleanly.

### Requirement: Compose delivers via `send target:"agent"` with chat-send busy semantics
The compose strip SHALL deliver on Enter (Shift+Enter inserts a newline) through the existing client function `sendToWindow(server, windowId, text, "submit", "agent")` (`api/client.ts`) — the agent-target lane that resolves the operator window's agent pane server-side and runs the full injection engine (sanitize → paste → novelty probe → probe-gated Enter → observation/recovery; [agent-send](/run-kit/agent-send.md) § Send Path). Busy semantics are chat-send's allow + probe: no client-side busy gate, no 409 template-queue behavior, no `operatorQueueTracker` interaction — a console message is a human steer ([operator-actuation](/run-kit/operator-actuation.md)). A whitespace-only input is a guarded no-op; an in-flight guard disables re-send until the POST resolves; the input is an ordinary textarea, so OS keyboard dictation (the voice story) works untouched. The console is a HUMAN surface driving a pane through the one gated injection engine — distinct from the agent-messaging spec's Conversation row (multi-turn cross-provider agent dialogue ⇒ MCP bridge), which governs agent-to-agent tool-mediated dialogue, not humans.

#### Scenario: Enter sends exactly once
- **GIVEN** an open console with text in the compose input
- **WHEN** Enter is pressed
- **THEN** exactly one `sendToWindow(..., "submit", "agent")` fires at the operator window on the resolved server, and a busy operator still receives the attempt (the probe remains the fail-closed floor)

### Requirement: Send errors surface inline, text preserved
Structured send failures (probe failure, `staged_send_failure`, submit-unverified — the thrown `ApiError` messages from `sendToWindow`'s `throwOnError` shape) SHALL render as an inline error line between the terminal and the compose strip (`role="alert"`), never as toasts — the user is looking at this surface. The composed text stays in the input on failure for retry/edit; the line clears on the next successful send or on any edit.

#### Scenario: A structured 409 surfaces inline
- **GIVEN** a send that fails with a structured 409
- **WHEN** the error resolves
- **THEN** the server's message renders inline in the console and the input still holds the text

### Requirement: Server-context resolution
The console SHALL resolve its server context via `resolveConsoleServer(routeServer, servers, lastViewed)`: the current route's server param always wins (the same deepest-first route-param walk `RootTopBar` uses); on param-less routes (Host, Board) the sole server is preselected when exactly one exists, else a title-strip picker defaults to the most recently viewed server still listed (tracked ephemerally in a component ref — no persistence), then the first listed server; `null` only when the server list is empty. The operator window is discovered client-side from the sessions payload by `findOperatorWindow` (`role === "operator"` with a non-empty `windowId` — the server-scoped radio makes the first hit the only hit). A pinned or picked server is scoped to the route it was requested from: navigation clears both, retargeting the console to the new route's server.

### Requirement: Availability degrades to absent
When the resolved server has no operator window, the console body SHALL render a single hint line (`no operator on this server — run rk operator`) instead of terminal + compose — no stream opens and no send is possible. Entry points that can know in advance (the palette Ask-operator fallback row, the sidebar pinned row) are omitted on such servers, never disabled; the console openers themselves (chord, palette action, menu row) stay available — the hint line is the answer.

#### Scenario: Operator-less server
- **GIVEN** a server with no `role === "operator"` window
- **WHEN** the console opens
- **THEN** the hint line renders, no terminal stream opens, and no send is possible

### Requirement: Mobile full-height sheet
Below the shared `isMobileViewport()` rule (narrow-width-OR-coarse-pointer), the console SHALL render as a full-height sheet `absolute inset-0` inside the main area under the persistent top bar (the sidebar-drawer placement precedent — the top bar stays visible and functional), with the embedded terminal filling the height above the compose strip.

#### Scenario: 375px sheet
- **GIVEN** a 375px viewport
- **WHEN** the console opens (via the overflow-menu row)
- **THEN** it covers the main area below the top bar, the top bar stays visible, and no horizontal page overflow is introduced

## Design Decisions

### Reply channel is the live TUI embed, not transcript rendering
**Decision**: the console reads replies by embedding a live terminal view of the operator window over the existing `/ws/terminals` mux.
**Why**: Constitution X (derive over push) and the surviving tty + compose pair are the read path; the embed adds zero backend surface — no transcript endpoint, no new WS subscription kind.
**Rejected**: a transcript-rendered chat panel (rebuilds a deliberately deleted wing — backfill endpoint, live transcript stream, message rendering); an `rk say`-style push card channel (pushes state derivable from the transcript).
*Introduced by*: 260904-qa85-operator-chat-console

### Console sends are chat-send steers, not template work orders
**Decision**: compose delivery uses `send target:"agent"` with allow+probe busy semantics and bypasses the operator-request queue entirely.
**Why**: a template request is work handed over (busy ⇒ enqueue); a typed console message is a human steer from a user watching the pane — exactly the chat-send posture, whose novelty probe is the fail-closed floor.
**Rejected**: routing console text through a new `acceptsText` template (fire-and-forget semantics, queue on busy — wrong for a conversation); a client-side busy gate (strands hookless operators; the probe is the floor).
*Introduced by*: 260904-qa85-operator-chat-console

### Entry points reach the console through a document-event seam
**Decision**: the chord, palette action, palette fallback row, sidebar pinned row, and overflow-menu row all dispatch the `rk:operator-console` CustomEvent rather than threading callbacks to the layout-mounted console.
**Why**: the entry points live in route shells the root layout does not compose directly; the document-event seam is the codebase's established idiom for crossing that boundary (`palette:open`, `HOST_MENU_OPEN_EVENT`, `WEB_FIND_OPEN_EVENT`).
**Rejected**: lifting open state into a new context provider with prop-threaded callbacks (a provider is easy to add later if threading deepens; the seam keeps every caller to one line).
*Introduced by*: 260904-qa85-operator-chat-console

### Esc-close is a bubble-phase listener honoring `defaultPrevented`, not a focus trap
**Decision**: the console closes on a document keydown listener that skips `defaultPrevented` Escapes, with no focus trap.
**Why**: the console is a non-modal overlay the page stays live under; a nested modal's Escape must win, and cheap-close is the only stated requirement.
**Rejected**: the palette's modal focus-trap contract (wrong for a drawer; would capture keys the live page below still owns).
*Introduced by*: 260904-qa85-operator-chat-console
