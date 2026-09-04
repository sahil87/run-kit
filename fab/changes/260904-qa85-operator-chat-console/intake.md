# Intake: Operator Chat Console

**Change**: 260904-qa85-operator-chat-console
**Created**: 2026-09-04

## Origin

> operator chat console — pull-down overlay with palette free-text on-ramp

Conversational — this intake closes a `/fab-discuss` design session. The arc:

1. User's framing: the operator should be "the helper you talk to to get anything done using your terminals" — the missing piece is sending it text **without switching tabs**. PR #807 (voice round-trip) was judged a folly: voice input belongs to OS dictation tools typing into an ordinary textarea, outside run-kit's purview. PR #807 is expected to be closed; its disposition is separate from this change.
2. Reply-channel analysis: deriving replies beats pushing them (#807's `rk say` pushes state derivable from the transcript — Constitution X). After PR #817 removed the chat lens (deleting transcript rendering, the `kind:"chat"` WS subscription, and the backfill endpoints), the surviving read path is the **live terminal view**: the tty + compose pair is exactly what #817 consolidated on.
3. Four UX candidates were mocked in an HTML design study (pull-down console / palette free-text fallback / right-panel lens / sidebar row expansion). **User agreed with the recommendation: ship the pull-down console with the palette fallback as its on-ramp**; defer the docked variant until the surface-layout `agents` tile is built (the right panel itself is retired — #826); reduce the sidebar option to a pinned-row pulse + open-console affordance.
4. Post-rebase adjustments folded in: the new `docs/specs/agent-messaging.md` communication standard (HTTP routes are doors onto the one injection engine); the #830 identity rename (`@rk_pane_agent_session` / `agentSessionRef` / `internal/transcript`).

## Why

**Problem**: Talking to the operator today means either a templated request (closed registry — `spawn-task`/`find-discussion` are the only free-text lanes, each single-shot through a dialog) or switching to the operator tab and typing into its TUI. Reading any answer *always* means switching tabs: templates are delivered fire-and-forget and the operator replies "in its own window". On mobile — where long instructions are most painful — the friction is worst. This throttles the operator's actual value: it can already rename, color, annotate, spawn, answer waiting panes, and search transcripts, but every interaction costs a context switch.

**If we don't fix it**: the operator stays a background janitor reachable through buttons. The "get anything done" concierge role the user wants never materializes, and pressure builds for another #807-shaped detour (a new modality bolted on instead of a low-friction text channel).

**Why this approach**: a pull-down console (global overlay: embedded live operator terminal + compose strip) with a palette free-text on-ramp solves read-and-write in one surface with **zero new backend**: delivery rides `POST /api/windows/{id}/send` with `target:"agent"` (shipped in #817), reading rides the existing `/ws/terminals` relay mux. Rejected alternatives, from the discussion:

- **Voice round-trip (#807)**: input belongs to OS dictation; `rk say` pushes derivable state (Constitution X); confirm-HUD redundant with a compose box.
- **Transcript-rendered chat panel**: would rebuild the wing #817 just deleted (backfill endpoint, live transcript stream, message rendering). Kept as a *fallback* only if the embedded TUI frame proves unreadable in practice.
- **Right-panel lens**: the panel/rail is retired (#826); the `agents` surface remains a `[target]` in surface-layout — the console can later dock there as a tile without redesign. Deferred, not rejected.
- **Sidebar-row composer**: a conversation in a ~210px column repeats the chat-lens mistake in miniature. Only its pulse survives (see What Changes).

## What Changes

### 1. Operator console overlay (the pull-down)

A global overlay that slides down from under the top bar, available on **every route** (Host, Server, Terminal, Board). Contents, top to bottom:

- **Title strip**: `◉ OPERATOR · {server}` + live agent state (from the sessions payload rollup) + close affordance. On the Host route with multiple servers, the strip carries a server picker; with exactly one server it is preselected.
- **Embedded operator terminal**: a live terminal view of the operator window, implemented as a normal `/ws/terminals` stream (`open` op at the console viewport's cols/rows) rendered by the existing terminal client machinery — the same thing the terminal route does, in a smaller box. No new protocol, no transcript endpoint. Sizing follows existing multi-client attach semantics (identical to a second browser tab viewing the same window).
- **Compose strip**: a text input + send. Enter sends via the existing client seam for `POST /api/windows/{operatorWindowId}/send` with body `{"text": ..., "mode": "submit", "target": "agent"}` — the #817 agent-targeting lane, which resolves the operator's agent pane server-side and runs the full injection engine (sanitize → paste → novelty probe → probe-gated Enter → observation/recovery). OS dictation (keyboard mic) works here untouched — that is the entire voice story.

Behavior:

- **Busy semantics are chat-send's, not the template seam's**: a console message is a *steer a human typed* — allow + probe, no 409 busy gate, no `operatorQueueTracker` enqueue. The probe remains the fail-closed floor. Structured send errors (probe failure, staged_send_failure, submit-unverified) surface inline in the console (not toasts — the user is looking at this surface).
- **Close is cheap**: Esc or the chord closes the overlay; the conversation lives in the operator window regardless, so nothing is lost. The stream sends `close` on unmount.
- **Availability degrades to absent** (the established operator-seam posture): no operator window on the selected server ⇒ the console renders a single "no operator on this server" line with the `rk operator` hint, and entry points that can know this in advance (palette fallback row, pinned row) are omitted, never disabled.
- **Open/closed is ephemeral per-viewer state** (component state; Constitution IV — no tmux option, no server state). No persistence of open-ness across reloads.

### 2. Entry points

- **Global chord**: default ⌘J (mac) / Ctrl+Alt+J-class on Win/Linux — final chord chosen at apply time within the keybindings system's claims data; ⌘J sits in the documented page-interceptable class (the ⌘L precedent), so mac-browser interception is the same pre-ship manual verification gate, with the palette as Constitution V's guaranteed fallback. Registered through the normal bindings registry with a `mapLabel`, rebindable like any action.
- **Palette action**: `Operator: Open console` — the palette is the action registry of record (Constitution V); every new user-facing action here registers.
- **Palette free-text fallback row (the on-ramp)**: when the palette query matches no action, a standing last row renders `Ask operator: "{query}"`. Enter **opens the console with the query pre-filled and immediately sent** — one gesture from ⌘K to a delivered message with the reply visible. The row is omitted when the current server has no operator window.
- **Pinned operator row (sidebar)**: the existing row gains (a) click/keyboard affordance to open the console, and (b) a **pulse** — a one-line preview under the row rendering the operator window's `@rk_win_note` when set (data already on the sessions payload; no new derivation). No composer in the sidebar.
- **Top-bar overflow menu row** on mobile (where no keyboard exists): `Operator console` under the App section.

### 3. Mobile degradation

Below the mobile breakpoint (the shared `isMobileViewport()` rule) the drawer becomes a **full-height sheet under the top bar** (the top bar stays visible, matching the sidebar-drawer precedent of `absolute`-in-main placement). The embedded terminal takes the remaining height above the compose strip. This is the long-instruction phone surface #807 was chasing: OS keyboard dictation into the compose input.

### 4. Non-goals (explicit)

- **No new operator powers**: the operator keeps actuating through its own shell (tmux options, `rk riff`, `rk mux send --answer`). No viewer-navigation channel ("open this tab in *your* browser" is per-viewer state and multi-viewer-ambiguous). Clickable window references in replies: out of scope.
- **No transcript endpoint, no `rk say`, no TTS/STT**: the reply channel is the live TUI; voice is OS-level.
- **No changes to the template seam**: the closed registry, its queue, auto-name, and the compose dialog all continue unchanged. The console is a parallel conversational lane, not a replacement. (A later change may fold the compose dialog's spawn/find into the console.)
- **No `agents` tile / docked variant**: deferred until the surface-layout `agents` target is built; the console's terminal-embed + compose pair is designed to dock there later unchanged.
- **No escalation badges** in the console title strip (whats-stuck/waiting cards) — noted as future synergy only.

### 5. Spec/standard alignment

- **`docs/specs/agent-messaging.md`**: the console writes through the one injection engine via an existing HTTP door (`/send` `target:"agent"`) — a textbook citizen of the single-engine invariant. The spec's Conversation row (multi-turn cross-provider ⇒ MCP bridge) governs *agent-to-agent tool-mediated dialogue*; the console is a **human** surface driving a pane through the gated engine — the sanctioned write channel. State this distinction where the console is documented so review doesn't flag it.
- **Vocabulary**: post-#830 names throughout — `agentSessionRef`, `@rk_pane_agent_session`, `internal/transcript`.
- **Constitution IV**: the console is an overlay, not a route; no settings surface; per-viewer state stays client-side. **Constitution V**: every action palette-registered; chord fallback guaranteed. **Constitution IX**: the one mutating call is an existing POST.

## Affected Memory

- `run-kit/ui/operator-console`: (new) The console overlay — entry points, embedded terminal stream, compose/send semantics, availability gating, mobile sheet, server-context rule
- `run-kit/ui/keyboard-and-palette`: (modify) New chord + palette action + the free-text fallback row contract (omit-when-no-operator)
- `run-kit/ui/sidebar`: (modify) Pinned operator row — open-console affordance + `@rk_win_note` pulse line
- `run-kit/ui/routes-and-shell`: (modify) The overlay's placement in the app shell (top-bar-anchored drawer, mobile sheet)
- `run-kit/operator-actuation`: (modify) Note the conversational lane beside the template seam (chat-send busy posture, bypasses the queue) and the human-surface/MCP distinction
- `run-kit/agent-send`: (modify) The console as a consumer of `target:"agent"` (inline error surfacing contract)

## Impact

- **Frontend (all new code lives here)**: new console overlay component (drawer + sheet), a small terminal-embed reuse of the existing relay-mux client (`RelayMux` singleton + terminal client port), compose strip wiring to the existing send client function, palette registry additions (action + fallback row), pinned-row changes in the sidebar, keybinding registration. E2E specs for: open/close via chord and palette, fallback-row send flow, no-operator degradation, mobile sheet, send-error inline surfacing.
- **Backend**: expected **zero routes added**. Possible small change only if the send client seam or sessions payload lacks something the console needs (e.g., operator window discovery is already derivable from the sessions payload `role === "operator"`).
- **Dependencies**: none new. Rides `/ws/terminals`, `/api/windows/{id}/send`, the sessions payload, the keybindings + palette registries.
- **Tests**: Vitest for the palette fallback-row logic, availability predicate, server-context rule; Playwright for the console flows (desktop + 375px).

## Open Questions

- Console height: fixed proportion vs user-resizable (and if resizable, whether height persists per-viewer in localStorage). Low-stakes; apply may pick fixed-proportion first.
- Whether the palette fallback row should require a minimum query length (avoid firing on 1–2 character typos).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery via existing `POST /api/windows/{id}/send` `target:"agent"` at the operator window; zero new backend routes | Discussed and decided; #817 shipped the lane for exactly this shape | S:90 R:85 A:95 D:95 |
| 2 | Certain | Reply channel = embedded live terminal over `/ws/terminals`; no transcript endpoint, no `rk say` | Discussed and decided; Constitution X (derive over push) + #817 direction | S:90 R:70 A:90 D:90 |
| 3 | Certain | Ship console (A) + palette free-text fallback (B) composed: fallback row opens console prefilled and sent | User explicitly agreed with this recommendation from the design study | S:95 R:75 A:85 D:90 |
| 4 | Certain | Voice is out of scope — OS dictation into the compose input; #807 disposition handled separately | User's own framing ("outside run-kit's purview") | S:95 R:90 A:95 D:95 |
| 5 | Certain | Availability degrades to absent (no operator ⇒ hint line; entry points omitted, never disabled) | Established operator-seam posture in memory | S:85 R:85 A:95 D:90 |
| 6 | Confident | Console sends use chat-send busy semantics (allow + probe), bypassing the template queue | A console message is a human steer; memory records the steer-vs-work-order distinction | S:75 R:80 A:85 D:80 |
| 7 | Confident | Server context: route's server; Host route preselects a sole server, else a title-strip picker | Natural default; picker detail not discussed but low-risk and contained | S:50 R:80 A:70 D:60 |
| 8 | Confident | Chord defaults to the ⌘J class with palette fallback; final chord resolved at apply within the claims data; mac interception is a pre-ship manual gate | Keybindings memory documents the exact precedent (⌘L/⌘J class) and the fallback rule | S:55 R:90 A:75 D:55 |
| 9 | Confident | Mobile = full-height sheet under the top bar, `absolute`-in-main placement | Mirrors the documented sidebar-drawer precedent; discussed in the study | S:70 R:85 A:80 D:80 |
| 10 | Confident | Console open state is ephemeral per-viewer (no persistence, no tmux option) | Constitution IV state-layering rules answer this | S:60 R:90 A:85 D:80 |
| 11 | Confident | Embedded-terminal sizing follows existing multi-client attach semantics (as a second tab on the same window does today) | The relay attaches per-stream at the open op's size; behavior class already exists | S:60 R:75 A:75 D:70 |
| 12 | Tentative | Pinned-row pulse renders the operator's `@rk_win_note` line (no new data source) | In the agreed verdict but detail-thin; note may often be unset — pulse then hidden | S:45 R:85 A:60 D:50 |
| 13 | Confident | Send errors surface inline in the console rather than as toasts | The user is looking at the surface; toasts are the fire-and-forget pattern | S:55 R:85 A:75 D:70 |

13 assumptions (5 certain, 7 confident, 1 tentative, 0 unresolved).
