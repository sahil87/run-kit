---
type: memory
description: "The operator chat console — a quake-style overlay (slide-animated, mouse-resizable glass desktop drawer; mobile full-height sheet) mounted once at the root layout. Covers the rk:operator-console document-event seam for all entry points, the embedded live terminal over /ws/terminals, compose/send semantics (send target:\"agent\", chat-send allow+probe, inline errors), file paste/drop as insert-staged attachments, geometry/opacity stores, server-context resolution, and degrade-to-absent gating."
---
# run-kit UI — Operator Console

**Domain**: run-kit/ui

## Overview

The operator chat console is the talk-to-the-operator surface: a global overlay that slides down from under the top bar on every route (Host, tmux Server, Terminal, Board) carrying a live embedded view of the server operator's window plus a compose strip, so a message is written and its reply read without leaving the current route. It is frontend-only — no backend route, no transcript read path: delivery rides the existing `POST /api/windows/{id}/send` agent-target lane and reading rides the existing `/ws/terminals` relay mux. The implementation is `app/frontend/src/components/operator-console.tsx` (the overlay plus the mobile tongue) plus pure helpers and per-viewer stores in `app/frontend/src/lib/operator-console.ts` (colocated tests for both).

## Requirements

### Requirement: Root-layout mount; overlay, not a route
The console SHALL mount exactly once at the persistent root layout in `app/frontend/src/app.tsx` (lazy-imported beside the single `CommandPalette` mount), as an `absolute` overlay inside the main area (the `relative flex-1 min-h-0` region under the top bar), so pages below keep their layout. Opening/closing never navigates and never writes URL or tmux state — open/closed is ephemeral per-viewer component state (Constitution IV; the geometry/opacity localStorage stores below are the carve-out preferences), so a reload always starts closed. Esc closes it via a bubble-phase document keydown listener that honors `defaultPrevented` (a nested modal's Escape wins — the console is a non-modal drawer, not a focus trap). Every close path (Esc, the chord, the ✕, the top-bar ◉ button, the tongue) funnels through the exit slide below — the unmount, which closes the terminal stream, fires only after the slide completes. Focus moves to the compose input on open (the strip's first control when the operator-absent hint is showing) and the previously focused element is restored once the close completes (after the exit slide, not at close intent). The console publishes its rendered flag to a module slot in `lib/operator-console.ts` (`setOperatorConsoleOpen` / `useOperatorConsoleOpen` — the compose-strip module-store idiom) so surfaces that must not own the state can read it: the mobile tongue hides while the sheet covers it.

### Requirement: True quake slide, mounted through exit (desktop drawer)
The desktop drawer SHALL slide in both directions: it mounts raised fully above the top-bar seam (the `.rk-console-closed` class on `.rk-console-slide` — `transform: translateY(-102%)`, transform-only so the motion composes with the centering `translate` property — with the raised portion hidden by a dedicated `pointer-events-none absolute inset-0 overflow-clip` wrapper around the console only, not the shared main area) and transitions to rest over 240ms (`cubic-bezier(0.2, 0.9, 0.25, 1)` in `globals.css`), the raised class dropping two animation frames after mount so the transition animates. A close request drives an internal `closing` state that re-applies the raised class and holds the unmount until the root's `transform` `transitionend` fires (with a slide-duration-plus-margin timeout fallback), so the terminal stream tears down AFTER the slide, not mid-animation; a re-open mid-exit cancels the close and the drawer transitions back down from wherever the slide had reached. `prefers-reduced-motion` zeroes the transition in CSS AND skips the mounted-through-exit delay in JS (immediate unmount). The mobile sheet never rides the slide — it keeps the short `rk-console-drop` settle-in animation (transform-only, zeroed under reduced motion).

#### Scenario: Toggle from any route
- **GIVEN** a closed console on desktop
- **WHEN** the chord fires
- **THEN** the drawer slides down from fully above the top-bar seam in ~240ms
- **AND WHEN** Esc is pressed, **THEN** it slides back up and unmounts only after the transition ends
- **AND GIVEN** reduced motion, **THEN** open/close are instant

### Requirement: One document-event seam for every entry point
All entry points SHALL reach the layout-mounted console by dispatching the `rk:operator-console` document CustomEvent (`OPERATOR_CONSOLE_EVENT`) via `requestOperatorConsole(req)` in `lib/operator-console.ts` — never by prop threading or direct state access, because the entry points live in route shells the layout does not compose directly (the `palette:open` / `HOST_MENU_OPEN_EVENT` seam idiom). The request shape is `{ action: "toggle" | "open", server?, send? }`: `toggle` flips open/closed through the slide machinery (the chord, palette action, top-bar ◉ button, mobile tongue, and overflow-menu row); `open` always opens (the sidebar pinned row, which also pins `server` to its own row's server); `send` carries text to deliver immediately once open (the palette fallback row's query — dropped unsent when the resolved server has no operator window, the hint line being the answer there). The entry points are: the registry chord (⌘J/⇧Ctrl+J — [keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md)), the palette action `Operator: Open console`, the palette's Ask-operator fallback row, the sidebar pinned operator row's activation ([sidebar](/run-kit/ui/sidebar.md) § Operator Pinned Row), the desktop top-bar ◉ operator button ([top-bar](/run-kit/ui/top-bar.md) § Right cluster), the mobile tongue (the affordance-pair requirement below), and the top-bar overflow-menu row ([top-bar](/run-kit/ui/top-bar.md)).

### Requirement: Anatomy — title strip, embedded terminal, compose strip
The console SHALL render, top to bottom: (a) a title strip with `◉ OPERATOR`, the resolved server name (or a server picker when the route carries no server param and more than one server exists), the operator window's live agent state from the sessions payload (`agentState` + idle duration), and a close affordance; (b) an embedded live terminal; (c) a compose strip. Desktop geometry is a centered drawer sized from the persisted per-viewer geometry (defaults 55vh × 760px — the resize requirement below), with the terminal filling the space above the compose strip and a glass background (the glass requirement below). The Send/✕ buttons carry the compose strip's button idiom: `coarse:` ≥36px touch targets and the `rk-glint` hover treatment.

#### Scenario: Open console on an operator-bearing server
- **GIVEN** an open console on a server with an operator window
- **WHEN** it renders
- **THEN** the title strip shows the server and live operator state, the terminal shows the operator window's live frame, and the compose input has focus

### Requirement: Embedded terminal over the shared relay mux
The embedded terminal MUST be the existing `TerminalClient` (`components/terminal-client.tsx`) over the shared `/ws/terminals` `RelayMux` — the same mechanism a board pane uses to render a cross-server window — pointed at the operator window's `(server, windowId)` with `registerFocus={false}` so the BottomBar keeps its own focus target (the BoardPane precedent). No new backend endpoint, no transcript read path, no new WS subscription kind. The stream opens at the console viewport's cols/rows under the existing multi-client attach semantics (identical to a second browser tab on the same window) and closes on console unmount; the mount is keyed `${server}:${windowId}` so a server switch re-attaches cleanly. The console instance passes `transparent={!isMobile}` — TerminalClient's opt-in per-instance prop (xterm `allowTransparency` + a transparent theme background) — so the desktop drawer's glass shows through the cells; route and board terminals never set it and keep the opaque theme background with no renderer cost.

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

### Requirement: Mouse resize with per-viewer geometry persistence (desktop drawer)
The desktop drawer SHALL be mouse-resizable; the mobile sheet is not (it stays full-height). The bottom tongue-grip (a 64×12px pull tab hanging from the drawer's bottom edge, `cursor-ns-resize`) drags HEIGHT, clamped 25–85% of the viewport height; side grips on both edges (`cursor-ew-resize`) drag WIDTH symmetrically about the center line — an edge delta moves both sides (the width changes by twice the pointer delta, sign flipped on the left grip), clamped 420px–96vw, so the drawer stays centered. Grips use pointer capture and suspend the slide transition during a drag (the `.rk-console-dragging` class — no animated fighting); the live drag drives an in-component override and the store write lands on pointer-up. Geometry persists per-viewer in one localStorage JSON key `runkit-operator-console-geometry` (`{heightVh, widthPx}`) via the geometry store in `lib/operator-console.ts` (the `use-local-storage-enum.ts` pub/sub idiom: same-tab subscriber notify plus the cross-tab `storage` event, with numeric clamping in place of the enum hook's allowed-list validation), read on mount with try/catch and defaults (55vh / 760px) on absent, corrupt, or out-of-clamp values — no tmux, URL, or server state (Constitution IV). The width ceiling rides a `maxWidth: 96vw` style so it keeps tracking live viewport resizes.

#### Scenario: Resize persists across reload
- **GIVEN** a viewer who resized the drawer to 70vh × 900px
- **WHEN** the page reloads and the console reopens
- **THEN** it opens at 70vh × 900px
- **AND GIVEN** a corrupted stored value, **THEN** the defaults apply without error

### Requirement: Affordance pair — top-bar ◉ button (desktop) / tongue (mobile)
Two pointer affordances SHALL stand beside the chord/palette entry points — exactly one standing affordance per form factor, both gating on the shared narrow-width-OR-coarse-pointer `useIsMobile()` rule so they never overlap or gap. On DESKTOP the standing affordance is the top-bar right-cluster ◉ operator button ([top-bar](/run-kit/ui/top-bar.md) § Right cluster); no tongue renders at rest. On MOBILE the tongue (`OperatorConsoleTongue`, mounted beside the console in the root layout so it renders while the console is closed) is the STANDING affordance: a centered pull tab always visible under the top bar on every route — a 64×12px visual tab whose button box is the ≥36px coarse hit area — whose tap dispatches `toggle` through the same document seam, carrying an amber dot when the resolved server's operator is `waiting`; it hides while the sheet is open (the sheet's own ✕ closes). No bottom-bar chip exists anywhere (the 375px single-row budget is untouched and the bottom bar is tty-route-only); the overflow-menu row stays as the labeled backup on every route. On desktop the tongue exists only attached to the drawer's bottom edge while the console is OPEN, where it IS the height drag grip (it slides with the drawer). Both affordances read the console's resolved server + operator window through the shared `useOperatorConsoleContext()` in `lib/operator-console.ts` (the console's own server rule plus `findOperatorWindow`, with last-viewed tracked ephemerally per consumer), tolerant of a missing `SessionProvider` — chrome degrades to "no operator", never crashes.

#### Scenario: Mobile tongue opens the sheet
- **GIVEN** a closed console on a mobile viewport
- **WHEN** any route renders
- **THEN** the tongue is visible under the top bar and a tap opens the sheet
- **AND GIVEN** desktop at rest, **THEN** no tongue renders (the ◉ button is the standing affordance)

### Requirement: Glass background with a per-viewer opacity setting (desktop drawer)
The desktop drawer's background SHALL be glass: `color-mix(in srgb, var(--color-bg-primary) {α}%, transparent)` over a FIXED `backdrop-filter: blur(6px)` (+ the `-webkit-` prefix; the bottom tongue-grip shares the same background). α is a per-viewer preference stored in localStorage (`runkit-operator-console-opacity`, the same pub/sub store idiom as the geometry store), default 0.90, clamped 0.75–1.0, applied live to an open console via the store's same-tab notify; α = 1.0 disables the backdrop-filter entirely (the zero-cost opaque path). Blur is a constant — not configurable. The mobile sheet stays opaque (full-height over content; glass buys nothing there). The settings dialog surfaces α as a This-device row ([dialogs-and-state](/run-kit/ui/dialogs-and-state.md) § Settings Dialog) — a client-side resident of the one settings surface, NOT an `internal/settings` registry key.

#### Scenario: Glass over busy output
- **GIVEN** default settings
- **WHEN** the drawer opens over busy terminal output
- **THEN** the background shows through at α 0.90 with 6px blur and the xterm cells are transparent
- **AND GIVEN** α set to 1.0, **THEN** no backdrop-filter is applied

### Requirement: Console file paste/drop — upload to the operator's worktree, stage as insert
The console SHALL bind its own file handlers on its root (marked `data-operator-console`): `onPasteCapture` — CAPTURE phase, because xterm's own textarea paste handler stops propagation, so a bubble-phase handler would never see file pastes targeted at the embedded terminal — and `onDrop` (with a `dragover` preventDefault for file drags). Clipboard/dropped files upload via the existing `uploadFile` client (`POST /api/sessions/{session}/upload`, mirroring the compose strip's `useFileUpload` composition) scoped to the OPERATOR window's session, and each returned path is delivered to the operator pane through the send lane as an INSERT — `sendToWindow(server, windowId, path + " ", "raw", "agent")`, the trailing space keeping consecutive inserts from concatenating — staged into the TUI composer where the `[Image #N]` chip renders, NEVER submitted; the user's typed message then submits normally and carries the staged image. Text paste falls through untouched (native textarea behavior in the compose input; xterm bracketed paste in the terminal). In-flight state shows a minimal "uploading…" indicator in the compose strip; failures reuse the inline error line and deliver nothing. With no operator window resolved, file paste is a no-op (the hint line is the answer). Route terminals' document-level strip forward MUST skip console-origin pastes and drops ([compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md) § File Upload — the `isOperatorConsoleTarget` containment guard).

#### Scenario: ⌘V of an image lands in the operator composer
- **GIVEN** an open console with a resolvable operator and an image on the clipboard
- **WHEN** ⌘V fires in the console
- **THEN** exactly one upload posts to the operator window's session and one insert-mode send delivers the returned path — and nothing lands on the tab below
- **AND** no submit fires until the user sends their message
- **AND GIVEN** an upload failure, **THEN** the inline error line shows it and nothing is delivered

### Requirement: Server-context resolution
The console SHALL resolve its server context via `resolveConsoleServer(routeServer, servers, lastViewed)`: the current route's server param always wins — read through the shared exported `useCurrentServerFromRoute()` hook (`contexts/session-context.tsx`), the single implementation of the deepest-first route-param walk, consumed by the console, `LayoutCommandPalette`'s Ask-operator gate, and the console-context resolution below; on param-less routes (Host, Board) the sole server is preselected when exactly one exists, else a title-strip picker defaults to the most recently viewed server still listed (tracked ephemerally in a component ref — no persistence), then the first listed server; `null` only when the server list is empty. The operator window is discovered client-side from the sessions payload by `findOperatorWindow` (`role === "operator"` with a non-empty `windowId` — the server-scoped radio makes the first hit the only hit). The read-only surfaces (the top-bar ◉ button, the mobile tongue) share the same resolution through `resolveOperatorConsoleTarget` / `useOperatorConsoleContext` in `lib/operator-console.ts`. A pinned or picked server is scoped to the route it was requested from: navigation clears both, retargeting the console to the new route's server.

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
- **WHEN** the console opens (via the tongue or the overflow-menu row)
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
**Decision**: the chord, palette action, palette fallback row, sidebar pinned row, top-bar ◉ button, mobile tongue, and overflow-menu row all dispatch the `rk:operator-console` CustomEvent rather than threading callbacks to the layout-mounted console.
**Why**: the entry points live in route shells the root layout does not compose directly; the document-event seam is the codebase's established idiom for crossing that boundary (`palette:open`, `HOST_MENU_OPEN_EVENT`, `WEB_FIND_OPEN_EVENT`).
**Rejected**: lifting open state into a new context provider with prop-threaded callbacks (a provider is easy to add later if threading deepens; the seam keeps every caller to one line).
*Introduced by*: 260904-qa85-operator-chat-console

### Esc-close is a bubble-phase listener honoring `defaultPrevented`, not a focus trap
**Decision**: the console closes on a document keydown listener that skips `defaultPrevented` Escapes, with no focus trap.
**Why**: the console is a non-modal overlay the page stays live under; a nested modal's Escape must win, and cheap-close is the only stated requirement.
**Rejected**: the palette's modal focus-trap contract (wrong for a drawer; would capture keys the live page below still owns).
*Introduced by*: 260904-qa85-operator-chat-console

### The tongue serves mobile instead of a bottom-bar chip
**Decision**: on mobile the tongue under the top bar is the standing affordance for the console; no bottom-bar button exists.
**Why**: the bottom bar exists only on terminal tty views and its 375px single-row budget is fixed; the tongue hangs under the top bar, so it costs no bar space and works on every route.
**Rejected**: a bottom-bar chip (budget + route-scope); a hover-reveal affordance (invisible — contradicts the visual-indication goal).
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste

### Opacity is a localStorage-backed settings-dialog row
**Decision**: the console's glass α is a per-viewer localStorage key surfaced as a This-device row in the settings dialog; the blur is fixed at 6px and not exposed.
**Why**: Constitution IV layering puts per-viewer state in localStorage while "exposed in settings" is honored by the dialog being the one settings surface, which already hosts client-side residents (the terminal-font stepper); α=1 disables the filter for a zero-cost opaque path.
**Rejected**: an `internal/settings` registry key (per-instance daemon config — the wrong layer for a per-eye preference); a console-strip-only control (the user asked for settings).
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste

### Attachments deliver as insert, not submit
**Decision**: console file paste/drop uploads and then delivers each returned path as a send-lane insert (staged into the TUI composer as its `[Image #N]` chip); the user's own Enter submits.
**Why**: it mirrors the TUI-composer staging behavior the injection engine's echo probe already recognizes; auto-submitting an image without its message would be wrong.
**Rejected**: appending the path to the console textarea (the path would ride the submit as plain text — the user sees raw paths and can mangle them); auto-submit per file.
*Introduced by*: 260905-sh7y-console-slide-resize-glass-paste
