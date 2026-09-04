# Plan: Operator Chat Console

**Change**: 260904-qa85-operator-chat-console
**Intake**: `intake.md`

## Requirements

### Console: surface & lifecycle

#### R1: Pull-down overlay on every route
The frontend SHALL provide an operator console as a global overlay — a drawer that slides down from under the top bar — mounted once at the persistent root layout (the layer that owns the single `CommandPalette` mount in `app/frontend/src/app.tsx`), available on every route (Host `/`, tmux Server `/$server`, Terminal `/$server/$window`, Board `/board/$name`). The console is an overlay, NOT a route: opening/closing it never navigates and never writes URL or tmux state. Its open/closed state is ephemeral per-viewer component state (Constitution IV — no localStorage persistence of open-ness, no `@rk_*` option). Esc and the toggle chord close it; closing tears down cleanly (the conversation persists in the operator window itself).

- **GIVEN** any route (Host, Server, Terminal, Board)
- **WHEN** the console chord or palette action fires
- **THEN** the drawer opens below the top bar without navigation, and Esc closes it
- **AND** a page reload starts with the console closed

#### R2: Console anatomy — title strip, embedded terminal, compose strip
The console SHALL render, top to bottom: (a) a title strip naming `OPERATOR`, the resolved server, the operator window's rolled-up agent state from the sessions payload, and a close affordance; (b) an embedded live terminal view of the operator window (R3); (c) a compose strip (R4). Desktop geometry: a centered drawer (bounded width, fixed height proportion of the viewport) with the terminal filling the space above the compose strip.

- **GIVEN** an open console on a server with an operator window
- **WHEN** it renders
- **THEN** the title strip shows the server name and live operator state, the terminal shows the operator window's live frame, and the compose input has focus

### Console: embedded operator terminal

#### R3: Live terminal embed over the existing relay mux
The embedded terminal MUST be a normal `/ws/terminals` stream rendered by the existing terminal client machinery (`app/frontend/src/components/terminal-client.tsx` + the `RelayMux` singleton) pointed at the operator window's `windowId` on the resolved server — the same mechanism a Board pane uses to render a cross-server window. No new backend endpoint, no transcript read path, no new WS subscription kind. The stream opens at the console viewport's cols/rows and closes on console unmount (the mux `close` op). Sizing follows existing multi-client attach semantics — identical to a second browser tab viewing the same window. If `TerminalClient` (or its mount context) requires extraction to render outside the terminal-route context, the extraction MUST be a reuse seam (props for server + windowId), not a fork of the component.

- **GIVEN** an open console
- **WHEN** the operator prints output in its TUI
- **THEN** the embedded terminal shows it live over the existing `/ws/terminals` socket
- **AND** closing the console sends the stream `close` op (no orphaned streams)

### Console: compose & delivery

#### R4: Compose sends via `send target:"agent"` with chat-send busy semantics
The compose strip SHALL deliver on Enter via the existing client function `sendToWindow(server, windowId, text, "submit", "agent")` (`app/frontend/src/api/client.ts` — the #817 agent-target lane resolving the operator's agent pane server-side through the full injection engine). Busy semantics are chat-send's allow + probe: no client-side busy gate, no 409 template-queue behavior — a console message is a human steer. The input supports multi-line text (the OS dictation story is "a plain textarea"); Enter sends, Shift+Enter inserts a newline. The in-flight state disables re-send until the POST resolves.

- **GIVEN** an open console with text in the compose input
- **WHEN** Enter is pressed
- **THEN** exactly one `sendToWindow(..., "agent")` fires at the operator window on the resolved server
- **AND** a busy operator still receives the send attempt (probe remains the fail-closed floor)

#### R5: Send errors surface inline
Structured send failures (probe failure, `staged_send_failure`, submit-unverified — the thrown Error messages from `sendToWindow`'s `throwOnError` shape) SHALL surface inline in the console (an error line between terminal and compose, dismissed on the next successful send or edit), NOT as toasts. The composed text is preserved in the input on failure so the user can retry or edit.

- **GIVEN** a send that fails with a structured 409
- **WHEN** the error resolves
- **THEN** the server's message renders inline in the console and the input still holds the text

### Console: availability & server context

#### R6: Server context resolution
The console SHALL resolve its server context as: the current route's server (Server/Terminal routes); on Host and Board routes, the sole server when exactly one exists, else a server picker in the title strip (defaulting to the most recently viewed server when available). The operator window on that server is found client-side from the sessions payload (`role === "operator"` — the existing discovery rule).

- **GIVEN** the Terminal route on server `fabKit1`
- **WHEN** the console opens
- **THEN** it targets `fabKit1`'s operator window
- **AND GIVEN** the Host route with three servers, **THEN** the title strip offers a picker

#### R7: Degrade to absent
When the resolved server has no operator window, the console body SHALL render a single hint line (`no operator on this server — run rk operator`) instead of terminal + compose, and entry points that can know in advance (the palette fallback row R9, the pinned-row affordance R10) are OMITTED, never disabled. The console itself (chord, palette open action) still opens — the hint is the answer.

- **GIVEN** a server with no `role === "operator"` window
- **WHEN** the console opens
- **THEN** the hint line renders, no terminal stream opens, and no send is possible
- **AND** the palette fallback row is absent for that server

### Entry points

#### R8: Chord + palette action
Opening the console SHALL be registered as a bindings-registry action (`operator-console` in `app/frontend/src/lib/keybindings.ts` `DEFAULT_BINDINGS`, with `mapLabel` and `ignoreInputs: true` — a chrome-level opener) and a palette action (`Operator: Open console`) — the palette is the action registry of record (Constitution V). Default chord: the ⌘J class on mac (page-interceptable per the documented ⌘L/⌘J precedent — mac-browser interception is a pre-ship manual verification gate; the palette action is the guaranteed fallback), with a Win/Linux default chosen within the claims data at apply time (avoiding claimed/xterm-consumed combos per the keybindings memory). The chord toggles (open ⇄ close). A mobile entry rides the top-bar overflow menu (`Operator console` under the App section).

- **GIVEN** any route with no text input focused
- **WHEN** the chord fires
- **THEN** the console toggles, and the palette lists `Operator: Open console`
- **AND** the shortcuts panel renders the binding with its `mapLabel`

#### R9: Palette free-text fallback row (the on-ramp)
When the palette query matches no action AND the current server context has an operator window AND the trimmed query is ≥ 3 characters, the palette SHALL render a standing last row `Ask operator: "{query}"`. Enter on it closes the palette, opens the console, and immediately sends the query text through R4's delivery path — one gesture from ⌘K to a delivered message with the reply visible. The row is omitted (not disabled) when no operator exists or the query is under the length floor.

- **GIVEN** a palette query matching no registered action on a server with an operator
- **WHEN** Enter fires on the `Ask operator` row
- **THEN** the palette closes, the console opens, and exactly one send fires with the query text
- **AND GIVEN** a 2-character query or an operator-less server, **THEN** the row is absent

#### R10: Pinned operator row — open affordance + note pulse
The sidebar's pinned operator row (`app/frontend/src/components/sidebar/index.tsx` — the existing pinned-row rendering) SHALL gain: (a) activating the row (click / keyboard) opens the console for that row's server (replacing nothing — the existing compose-dialog icon affordance stays as-is); (b) a pulse — one line under the row rendering the operator window's `@rk_win_note` text (already on the sessions payload; the existing note-line rendering idiom from the flyout card) when a note is set, hidden when unset. No composer is added to the sidebar.

- **GIVEN** a pinned operator row whose window carries `@rk_win_note`
- **WHEN** the sidebar renders
- **THEN** the note preview line renders under the row and activating the row opens the console
- **AND GIVEN** no note set, **THEN** no pulse line renders (no reserved space)

### Mobile

#### R11: Full-height sheet under the top bar
Below the mobile rule (`isMobileViewport()` — the shared narrow-width-OR-coarse-pointer predicate), the console SHALL render as a full-height sheet `absolute` inside the main area under the persistent top bar (the sidebar-drawer placement precedent), with the embedded terminal filling the height above the compose strip. The compose input is an ordinary textarea so the OS keyboard mic (dictation) works untouched.

- **GIVEN** a 375px viewport
- **WHEN** the console opens (via the overflow-menu row)
- **THEN** it covers the main area below the top bar, the top bar stays visible and functional, and no horizontal page overflow is introduced

### Non-Goals

- No new operator powers, no viewer-navigation channel, no clickable window references in replies
- No transcript endpoint, no `rk say`, no TTS/STT — the reply channel is the live TUI; voice is OS-level dictation
- No changes to the operator-request template seam (registry, queue, auto-name, `OperatorComposeDialog` all unchanged)
- No `agents` surface tile / docked variant (deferred until surface-layout's `agents` target lands)
- No escalation badges in the console title strip
- No backend route additions (expected zero backend diff)

### Design Decisions

#### Reply channel is the live TUI embed, not transcript rendering
**Decision**: the console reads replies by embedding a live terminal view of the operator window over the existing `/ws/terminals` mux.
**Why**: Constitution X (derive over push — `rk say` pushes derivable state) and the #817 direction (the chat-render wing was deliberately deleted; tty + compose is the surviving pair). Zero new backend.
**Rejected**: a transcript-rendered chat panel (rebuilds the deleted wing: backfill endpoint, live transcript stream, message rendering — kept only as a future fallback if the TUI frame proves unreadable); `rk say` push cards (derivable state pushed; the #807 approach).
*Introduced by*: 260904-qa85-operator-chat-console

#### Console sends are chat-send steers, not template work orders
**Decision**: compose delivery uses `send target:"agent"` with allow+probe busy semantics and bypasses the `operatorQueueTracker`.
**Why**: the memory-recorded distinction — a template request is work handed over (busy ⇒ queue), a typed message is a human steer (allow + probe); the console user is watching the pane, exactly the chat-send posture.
**Rejected**: routing console text through a new `acceptsText` template (fire-and-forget semantics, queue on busy — wrong for a conversation); a client-side busy gate (strands hookless operators; the probe is the floor).
*Introduced by*: 260904-qa85-operator-chat-console

#### Human surface vs the agent-messaging Conversation row
**Decision**: the console is documented as a HUMAN surface driving a pane through the one gated injection engine (an HTTP door per `docs/specs/agent-messaging.md`), distinct from the spec's Conversation row (multi-turn cross-provider agent dialogue ⇒ MCP bridge).
**Why**: the single-engine invariant is satisfied (the console adds no typing path); the MCP row governs agent-to-agent tool-mediated dialogue, not humans.
**Rejected**: treating the console as an agent-conversation consumer requiring MCP (wrong layer — no agent is conversing).
*Introduced by*: 260904-qa85-operator-chat-console

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/operator-console.ts`: pure helpers — `resolveConsoleServer(routeServer, servers, lastViewed)` (R6 rule), `findOperatorWindow(sessions)` (`role === "operator"`), `shouldShowAskOperatorRow(query, matchCount, hasOperator)` (R9 predicate incl. the ≥3-char floor) — with colocated `operator-console.test.ts` unit tests <!-- R6 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/frontend/src/components/operator-console.tsx`: the overlay component — title strip (server label, live operator state from SessionContext, server picker when R6 requires one, close button), body switching between the operator-absent hint (R7) and terminal+compose, desktop drawer geometry; open/close state owned by the mounting layer via props <!-- R2 -->
- [x] T003 Embed the live terminal: mount the existing terminal client machinery (`terminal-client.tsx` / `RelayMux`) inside the console for (server, operatorWindowId), sized to the console viewport, stream closed on unmount; extract a reuse seam (props for server + windowId) only if the current component cannot mount outside the terminal route — no fork <!-- R3 -->
- [x] T004 Compose strip in `operator-console.tsx`: textarea (Enter sends, Shift+Enter newline), in-flight guard, delivery via `sendToWindow(server, windowId, text, "submit", "agent")` from `api/client.ts`; inline error line preserving input text on failure (R5) <!-- R4 -->
- [x] T005 Mount the console at the persistent root layout in `app/frontend/src/app.tsx` (the layer owning the single `CommandPalette` mount), with lazy import matching the palette's pattern; wire Esc-to-close and focus handling (focus compose on open, restore focus on close) <!-- R1 -->
- [x] T006 Register the `operator-console` action: `DEFAULT_BINDINGS` entry in `app/frontend/src/lib/keybindings.ts` (⌘J-class mac default + a claims-clean Win/Linux default, `ignoreInputs: true`, `mapLabel`), palette action `Operator: Open console` in a new `app/frontend/src/lib/palette/operator-console.ts` (+ test), and the mobile overflow-menu row (`top-bar-overflow-menu.tsx`, App section) <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Palette fallback row in `app/frontend/src/components/command-palette.tsx`: when zero actions match, render `Ask operator: "{query}"` as the last row gated on `shouldShowAskOperatorRow`; Enter closes the palette, opens the console, and fires the send (thread an `onAskOperator(query)` callback from the layout mount); colocated tests in `command-palette.test.tsx` <!-- R9 -->
- [x] T008 Pinned operator row in `app/frontend/src/components/sidebar/index.tsx`: row activation opens the console (thread an `onOpenOperatorConsole` prop beside the existing compose-dialog prop); render the `@rk_win_note` pulse line under the row when set (reuse the note-line idiom); update `index.test.tsx`/`window-row.test.tsx` as needed <!-- R10 -->
- [x] T009 Mobile sheet: below `isMobileViewport()` render the console as a full-height sheet `absolute` in the main area under the top bar (sidebar-drawer placement precedent); verify no horizontal overflow at 375px <!-- R11 -->
- [x] T010 Operator-absent + server-context edges: hint line rendering (R7), Host/Board picker + sole-server preselect (R6), omit fallback row and skip pulse when no operator; unit tests for the predicates' edge cases (empty servers list, operator on a different server than the route) <!-- R7 -->
- [x] T011 E2E spec `app/frontend/tests/e2e/operator-console.spec.ts` (with the constitution-required intent comments): chord/palette open + Esc close on desktop; fallback-row flow (query → row → console open + send fired, asserted via the mocked send route); no-operator degradation (hint line, row absent); mobile sheet at 375px (top bar visible, no horizontal overflow); send-error inline surfacing (mocked 409) <!-- R9 -->

### Phase 4: Polish

- [x] T012 Run the gates: `cd app/backend && go test ./...` (expected untouched), `cd app/frontend && npx tsc --noEmit`, targeted Vitest for changed suites, and the changed-surface e2e specs via `just test-e2e "operator-console"` (plus sibling specs touching command-palette and sidebar surfaces) <!-- R1 -->

## Execution Order

- T001 → T002 → T003/T004 (same file, sequential) → T005 → T006
- T007, T008, T009, T010 depend on T005 (console mount + open callback exists); T007 also on T006 (palette action landed)
- T011 last among Phase 3; T012 final

## Acceptance

### Functional Completeness

- [x] A-001 R1: The console mounts once at the root layout, opens/closes on every route via chord and palette, Esc closes, and no URL or tmux state is written
- [x] A-002 R2: Title strip shows server, live operator state, and close; compose has focus on open
- [x] A-003 R3: The embedded terminal is a `/ws/terminals` stream via the existing terminal client machinery (no new endpoint, no transcript path); stream closes on unmount
- [x] A-004 R4: Enter fires exactly one `sendToWindow(..., "agent")` at the operator window; no client-side busy gate; Shift+Enter inserts a newline
- [x] A-005 R6: Route-server resolution + Host/Board sole-server preselect + multi-server picker behave per R6
- [x] A-006 R8: `operator-console` binding registered with `mapLabel` + `ignoreInputs`; palette action present; mobile overflow-menu row present
- [x] A-007 R9: The `Ask operator` fallback row appears only at zero matches + operator present + query ≥ 3 chars, and Enter delivers the query through the console
- [x] A-008 R10: Pinned-row activation opens the console; `@rk_win_note` pulse renders when set, absent when unset

### Behavioral Correctness

- [x] A-009 R4: Console sends bypass the operator-request template seam entirely (no `/operator-request` call, no queue interaction)
- [x] A-010 R7: Operator-less server renders the hint line; fallback row and pulse are omitted (not disabled); no terminal stream opens

### Scenario Coverage

- [x] A-011 R9: E2E covers the palette-to-delivered-message flow with the send route mocked (trailing-`*` glob per the mutating-route rule)
- [x] A-012 R11: E2E covers the 375px sheet — top bar visible, no horizontal page overflow
- [x] A-013 R5: E2E covers a mocked structured 409 surfacing inline with input text preserved

### Edge Cases & Error Handling

- [x] A-014 R5: Send failure preserves the composed text and renders the server's message inline; next successful send clears it
- [x] A-015 R6: Empty/loading servers list opens the console without crashing (picker/hint degrade gracefully)

### Code Quality

- [x] A-016 Pattern consistency: new components follow existing idioms (lazy palette-style import, `SectionHeading`/kbd chip vocabulary where applicable, coarse-pointer touch targets)
- [x] A-017 No unnecessary duplication: terminal embed reuses `terminal-client.tsx`/`RelayMux` (no forked terminal component); send reuses `sendToWindow`; note pulse reuses the note-line idiom
- [x] A-018 No client polling: console state rides SessionContext/SSE-derived data; no `setInterval` + fetch
- [x] A-019 Type narrowing over assertions; no new `as` casts beyond existing patterns
- [x] A-020 E2E intent comments: every new `test()` carries the Proves/Steps JSDoc block and the spec file opens with the shared-setup header (constitution Test Intent Comments)
- [x] A-021 No comment narration: no change-ID/PR citations in code or test comments

### Security

- [x] A-022 R4: No new subprocess or injection path — delivery is exclusively the existing `POST /api/windows/{id}/send` engine; no shell string construction anywhere in the change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Console open state lives in the root layout component (lifted state + callbacks threaded to palette/sidebar), not a new context provider | Matches the single-palette-mount precedent; a context is easy to add later if threading gets deep | S:60 R:85 A:80 D:70 |
| 2 | Confident | Fallback-row minimum query length fixed at 3 characters | Intake open question resolved with the obvious low-stakes default | S:50 R:90 A:80 D:70 |
| 3 | Confident | Console height is a fixed viewport proportion on desktop (no resize, no persistence) in this change | Intake open question resolved minimal-first; resizable height is an easy follow-up | S:55 R:90 A:80 D:75 |
| 4 | Tentative | `TerminalClient` can mount for an arbitrary (server, windowId) outside the terminal route (the Board precedent); if its context assumptions block that, extract a reuse seam rather than fork | Board renders cross-server panes so the machinery supports it; exact prop surface unverified until T003 | S:50 R:70 A:60 D:60 |
| 5 | Confident | Win/Linux chord default picked at apply within claims data (⌘J-class on mac), palette fallback guaranteed | The keybindings memory documents the claims process and the ⇧-tier alias precedent | S:55 R:90 A:75 D:60 |
| 6 | Confident | Chord resolved to `KeyJ`: ⌘J on mac via `macTier:"cmd"` (page-interceptable, unclaimed), ⇧Ctrl+J base on Win/Linux — KeyJ carried no claim in any tier; the pre-existing "⌘J retired outright" tests were updated to the reclaimed truth | Claims data verified in `keybindings.ts`; the retirement was residue of the surface-digits recode, not a ban | S:70 R:85 A:80 D:70 |
| 7 | Confident | Entry points reach the layout-mounted console through a document CustomEvent seam (`rk:operator-console`) rather than prop threading | The sidebar/overflow-menu/palette live in route shells the layout does not compose; the codebase's established seam idiom (palette:open, HOST_MENU_OPEN_EVENT, WEB_FIND_OPEN_EVENT) | S:65 R:85 A:80 D:70 |
| 8 | Confident | Pinned-row activation (click / Enter / Space) opens the console INSTEAD of navigating to the operator window; the compose icon, selection gestures, and rename are untouched | The intake's "gains a click/keyboard affordance to open the console" read against the without-switching-tabs purpose; navigation remains via direct URL | S:55 R:75 A:70 D:65 |
| 9 | Confident | Console Esc-close is a document keydown listener honoring `defaultPrevented` (no focus trap) — the console is a non-modal overlay, and a nested modal's Escape wins | The palette's modal trap contract is wrong for a drawer the page stays live under; cheap-close is the only stated requirement | S:60 R:80 A:75 D:65 |
| 10 | Confident | The palette fallback row rides the ordinary row machinery as a synthesized single row at zero matches, replacing the "No results" line when shown | Selection/Enter/scroll-into-view come free; the row is definitionally the only thing to show when it appears | S:60 R:85 A:75 D:70 |
| 11 | Confident | The picker's "most recently viewed server" is tracked ephemerally (an in-component ref fed by route-server changes) — no localStorage | Constitution IV ephemeral per-viewer state; no persisted last-server store exists to reuse | S:55 R:80 A:75 D:65 |
| 12 | Confident | Whitespace-only compose text is never sent (trim guard); the composed text is otherwise delivered verbatim | An empty send through the injection engine would paste nothing and probe-fail; the guard is the obvious floor | S:60 R:90 A:75 D:70 |

12 assumptions (0 certain, 11 confident, 1 tentative).
