# Intake: Defer Terminal Reset to First Write (Window-Switch Flicker Fix)

**Change**: 260610-qf25-defer-terminal-reset-flicker
**Created**: 2026-06-10
**Status**: Draft

## Origin

Synthesized from a `/fab-discuss` conversation — a fully-investigated, fully-decided fix. The root cause was traced in the actual source before intake. Interaction mode: one-shot intake from a pre-decided design; all decisions below were made during the discussion, not assumed here.

> **Problem**: When switching tmux windows in the web terminal, there is a flash of black/empty screen for a few milliseconds, even when the visible content is already current. Most evident in the tmux-status-bar-click flow: the click travels over the existing WebSocket, tmux switches the real session's active window and redraws the attached PTY in place (screen is already correct), then SSE reports the new active window, the URL writeback in app.tsx navigates to the new @N, and TerminalClient's WebSocket effect (deps include windowId, terminal-client.tsx:696) closes the live socket and opens a new one to /relay/@new. On the new connection's FIRST message, the client calls `terminal.reset()` synchronously at message-receipt time (terminal-client.tsx ~614-619: `needsReset` flag), wiping the xterm screen — while the first redraw chunk is >64 bytes so it takes the requestAnimationFrame-coalescing path (adaptive flush) and only paints on the NEXT animation frame. That guarantees ≥1 fully-cleared frame between reset and repaint. That cleared frame is the flicker.
>
> **Decisions**: (1) Defer `terminal.reset()` into the first write — keep the per-connection `needsReset` flag, but reset immediately BEFORE writing the first chunk of the new connection, in BOTH write paths (immediate small-chunk synchronous path and rAF-coalesced flush path). (2) Rewrite the stale comment block at terminal-client.tsx ~479-492 — it justifies reconnect-on-windowId by describing the OLD per-WebSocket ephemeral grouped-session relay design (260508-hdjr era); the backend has since moved to the move-based pin-session model.
>
> **Out of scope** (agreed follow-up): skipping the reconnect when the owning session is unchanged (keying the WS effect teardown on resolved owning session instead of windowId).

Root-cause claims were re-verified against the working tree at intake time: `needsReset` is declared per-connection inside `connect()` (terminal-client.tsx:604), consumed at receipt time in `ws.onmessage` (616-619); the stale comment is at 479-492; the WS effect deps are `[terminalReady, sessionName, windowId, server, wsRef]` (696); `app/backend/api/relay.go` resolves the owning session via `ResolveWindowSession` (79), runs session-scoped `SelectWindowInSession` (100), and attaches the PTY directly to the real session with no ephemeral and no defer-kill (140-143).

## Why

1. **The pain point**: Every window switch in the web terminal flashes black for at least one frame — even when the on-screen content is already correct (the tmux-status-bar-click flow redraws the attached PTY in place *before* the reconnect happens). The flash is a direct artifact of ordering: `terminal.reset()` runs synchronously at first-message receipt, but the first redraw chunk (>64 bytes, over the `IMMEDIATE_WRITE_MAX_BYTES` threshold) is rAF-coalesced and paints only on the *next* animation frame. The browser is guaranteed to present ≥1 fully-cleared frame between the two.

2. **Consequence of not fixing**: The flicker degrades every window-switch interaction (sidebar click, tmux status bar click, command palette, `rk riff` navigation, board pane focus churn) and undermines the perceived-latency work already shipped (adaptive flush, 40→10ms echo). The existing code comment even acknowledges the flicker ("A future protocol-level 'select-window' message would avoid the reconnect flicker") but its rationale is stale — the backend design it describes no longer exists.

3. **Why this approach**: Deferring the reset into the first write makes clear + new-content paint in the *same* frame; until the redraw arrives, the user keeps seeing the OLD content instead of black — strictly better perceptually, in every reconnect path. It is a small, frontend-only change that composes with the adaptive-flush design instead of modifying it. Rejected alternatives are recorded under Design Decisions in What Changes.

## What Changes

Single affected source file: `app/frontend/src/components/terminal-client.tsx`. Frontend only — **no backend changes**.

### 1. Defer `terminal.reset()` into the first write of each connection

**Current behavior** (terminal-client.tsx 604, 614-619): each `connect()` call declares `let needsReset = true;` next to the new `WebSocket`; `ws.onmessage` consumes it at receipt time, before the chunk is routed to a write path:

```ts
ws.onmessage = (event) => {
  if (cancelled) return;
  if (needsReset) {
    needsReset = false;
    terminal.reset();       // ← synchronous wipe at receipt time
  }
  // ... chunk then takes either the immediate write path (≤64 bytes, idle)
  // or the rAF-coalesced buffer path (paints next frame) → ≥1 black frame
};
```

**New behavior**: keep the per-connection reset *semantic* (each `connect()` arms a reset; the reset runs exactly once per connection), but move the `terminal.reset()` call so it executes immediately BEFORE the first chunk of that connection is written to xterm — in **both** write paths:

- (a) **Immediate path** (`canWriteImmediately` — small chunk, idle, first this frame): reset synchronously, then `terminal.write(chunk)` in the same tick.
- (b) **Coalesced path** (`flushToTerminal`, runs inside the rAF callback): reset at the top of the flush — same rAF callback, same frame as the buffered content paint.

In both cases clear + repaint happen within one presented frame; no fully-cleared frame can be shown. Both string and binary (`ArrayBuffer`/`Uint8Array`) first chunks must trigger the deferred reset, whichever path they take.

**Reset flag handoff semantics** (must be reasoned through explicitly in the implementation; these are decided requirements, the exact mechanism — per-effect flag vs. per-connection ownership token — is implementor's choice):

- **Per-connection arming preserved**: every `connect()` call re-arms the reset (current code sets `needsReset = true` per connection). All reconnect paths get a reset before their first write: same-session redundant reconnects, cross-session switches, and transient-drop reconnects (the `reconnectTimer` → `connect()` path in `ws.onclose`).
- **Close-time flush must not fire the new reset on old data**: `ws.onclose` (652-663) cancels pending rAFs and calls `flushToTerminal()` to drain the old connection's tail data — note this flush runs BEFORE the `cancelled` check, so it also runs at effect teardown. A deferred reset armed for a connection must not be consumed/triggered by a flush that is draining a *previous* connection's buffered tail. Sequencing note from the investigation: within one effect, the onclose flush runs before the reconnect timer's `connect()` re-arms the flag, so a flag re-armed in `connect()` is not yet set during the old connection's close-time flush — the implementation must keep this property (e.g., not arm the reset earlier than `connect()`).
- **No leak from zero-message connections**: a connection that received zero messages (reset armed but never fired) must not corrupt the next connection's state. Its close-time `flushToTerminal()` runs with empty buffers — an empty flush must NOT consume or execute the pending reset (resetting on no data would wipe the screen with nothing to repaint, recreating the bug). The next `connect()` re-arms; arming an already-armed flag is fine (idempotent).
- **Reset runs exactly once per connection**: after the first chunk of a connection is written (via either path), subsequent chunks and flushes of that connection perform no reset.

**Adaptive-flush invariants — must not regress** (PR #244/#245 work): the deferral composes with the adaptive flush; it does not modify `IMMEDIATE_WRITE_MAX_BYTES` (64), the UTF-8 byte-length measurement (`textByteLength`), the one-immediate-write-per-frame guard (`wroteImmediatelyThisFrame`/`markImmediateWrite`), or the ordering guarantee (once anything is buffered, subsequent chunks buffer until drain; an immediate write only happens when the buffer is empty AND no flush is pending).

### 2. Rewrite the stale comment block above the WebSocket effect (~479-492)

**Current comment** (verbatim, to be replaced):

```
// WebSocket connection — reconnects when session or windowId changes.
//
// Pre-hdjr (260507-4vuv era), the relay called `tmux select-window` then
// `tmux attach-session -t <real-session>`, so all clients shared the
// session's "active window" state and a window switch within the same
// session needed no reconnect — the next select-window from any client
// moved everyone. Post-hdjr (260508-hdjr) each WebSocket runs against
// its own ephemeral grouped session with INDEPENDENT active-window
// state, by design. That fixed the board-pane cross-talk bug, but it
// also means a URL-only window switch no longer flips the relay's
// ephemeral. Reconnecting on windowId change is the simplest fix:
// the new connection creates a fresh ephemeral pointing at the new
// window. (A future protocol-level "select-window" message would
// avoid the reconnect flicker.)
```

This describes the 260508-hdjr per-WebSocket "ephemeral grouped session" design, which was deleted wholesale by `260602-qn62-move-based-board-pin-sessions`. The new comment must describe the **current** backend design accurately:

- `app/backend/api/relay.go` resolves the window's real owning session via `ResolveWindowSession` — in the move-based model a window lives in exactly ONE session: its home session or its `_rk-pin-*` board pin-session (relay.go 71-86).
- It runs a session-scoped `SelectWindowInSession` (`tmux select-window -t <session>:@N`, relay.go 88-105) and attaches the PTY **directly** to that real session (`attach-session -t <session>`, relay.go 140-143) — no ephemeral, no defer-kill.
- Consequence to note in the comment: **same-session reconnects are now redundant** — the REST selectWindow already redraws the attached PTY in place, because the PTY is attached to the real session. A follow-up change will eliminate them by keying the WS effect teardown on the resolved owning session instead of windowId. (That follow-up is explicitly NOT part of this change.)

### 3. Tests

Extend the existing terminal-client unit tests (`app/frontend/src/components/terminal-client.test.ts` / `.test.tsx`) to cover reset-deferred-to-first-write ordering:

- reset must NOT run before the first chunk write of a connection (no receipt-time reset);
- reset runs exactly once per connection;
- reset fires for both string and binary first chunks (covering both the immediate and the rAF-coalesced path);
- reset is re-armed on reconnect (a new connection's first write resets again).

The existing `.test.tsx` already mocks `@xterm/xterm` with `reset: vi.fn()` / `write: vi.fn()` spies and renders `TerminalClient` — the natural harness for asserting reset/write call ordering (see Assumption #10).

Per project policy, tests run via `just` recipes only (`just test-frontend` for these Vitest units) — never `pnpm test`/`vitest` directly.

### Design Decisions (alternatives considered and rejected — for the record)

| Alternative | Why rejected |
|---|---|
| Protocol-level "select-window" WS message | Unnecessary now that the relay attaches to the real session; the REST selectWindow already achieves in-place switching. Superseded by the agreed follow-up (skip redundant same-session reconnects). |
| Overlap old/new connections, swap after first redraw chunk | More complex connection lifecycle for marginal gain over reset-deferral. |
| Do nothing | The current comment even acknowledges the flicker, but its rationale describes a deleted backend design; the flicker is fixable with a narrow frontend change. |

### Non-Goals

- **Skipping the redundant same-session reconnect** (keying WS teardown on resolved owning session instead of windowId) — explicitly agreed follow-up change, do not include.
- Any backend change (`app/backend/**` untouched).
- Any change to adaptive-flush thresholds, measurement, or ordering guarantees.
- New Playwright e2e specs — coverage is unit-level per the agreed test plan (flicker is a sub-frame rendering artifact, not e2e-observable; unit-level call-ordering assertions are the reliable proof — see Assumption #10).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update the "Terminal Write Batching" section (currently describes pure rAF coalescing; predates adaptive flush) to document the per-connection reset deferred into the first write (both paths) and the close-time-flush/zero-message handoff semantics.

## Impact

- **Code**: `app/frontend/src/components/terminal-client.tsx` only — the WebSocket effect (reset handling in `ws.onmessage`, `flushToTerminal`, immediate-write path) and the comment block at ~479-492. No API, route, dependency, or backend changes.
- **Tests**: `app/frontend/src/components/terminal-client.test.tsx` (and/or `.test.ts`) extended with reset-ordering tests. Run via `just test-frontend`.
- **Behavioral**: window switches (sidebar, tmux status bar click, palette, board pane churn) and transient-drop reconnects keep showing the old content until the new redraw paints — no black frame. The reset still happens on every reconnect, so stale content never survives past the first chunk of the new connection.
- **Performance**: no change to echo latency or flood behavior — adaptive-flush thresholds and ordering untouched; the deferral adds one boolean check on the write paths.

## Open Questions

None — all decisions were made in the originating discussion; root cause and care points verified against source at intake time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Defer `terminal.reset()` from message-receipt time into the first write of each connection, in BOTH write paths (immediate synchronous and rAF-coalesced flush) | Discussed — explicit decision item 1; root cause (receipt-time reset + next-frame coalesced paint ⇒ ≥1 cleared frame) verified at terminal-client.tsx 604/616-619 | S:95 R:85 A:90 D:95 |
| 2 | Certain | Preserve per-connection reset semantics: every `connect()` re-arms; reset runs exactly once per connection; covers same-session, cross-session, and transient-drop reconnects | Discussed — stated as a semantic that "must be preserved"; current code already arms per-connection inside `connect()` | S:95 R:80 A:90 D:90 |
| 3 | Certain | Close-time `flushToTerminal()` of an old connection's tail data must NOT trigger the deferred reset; an empty flush must not consume a pending reset; a zero-message connection's armed-but-unfired reset must not leak into the next connection | Discussed — care points called out explicitly in the intake brief; onclose flush sequencing (runs before reconnect's re-arm, and before the `cancelled` check) verified at terminal-client.tsx 652-663 | S:90 R:75 A:85 D:85 |
| 4 | Confident | Exact flag mechanism (per-effect deferred-reset flag consumed at first data write vs. per-connection ownership token) is implementor's choice, provided the handoff semantics in #2/#3 hold and are reasoned through explicitly | Discussed — semantics fully specified, mechanism left open ("must be reasoned through explicitly"); either mechanism satisfies the requirements and is locally reversible | S:75 R:85 A:85 D:70 |
| 5 | Certain | Rewrite the comment block at terminal-client.tsx ~479-492 to describe the current move-based pin-session relay design (ResolveWindowSession → session-scoped SelectWindowInSession → direct attach, no ephemeral/defer-kill) and note same-session reconnects are now redundant, with the keying follow-up named | Discussed — explicit decision item 2; backend design verified at relay.go 71-105 and 124-143, and in memory `run-kit/tmux-sessions` (260602-qn62) | S:95 R:90 A:90 D:95 |
| 6 | Certain | Out of scope: skipping the redundant same-session reconnect (keying WS teardown on resolved owning session instead of windowId) — separate agreed follow-up | Discussed — explicitly excluded with rationale | S:95 R:90 A:95 D:95 |
| 7 | Certain | Frontend only; single source file `app/frontend/src/components/terminal-client.tsx`; no backend changes | Discussed — stated constraint; verified the fix needs no relay change | S:95 R:90 A:95 D:95 |
| 8 | Certain | Must not regress adaptive flush: thresholds (`IMMEDIATE_WRITE_MAX_BYTES` 64), UTF-8 byte measurement, one-immediate-write-per-frame guard, and once-buffering-always-buffer-until-drain ordering all unchanged; deferral composes with them | Discussed — stated constraint; invariants enumerated from the shipped adaptive-flush code (terminal-client.tsx 505-596) | S:95 R:80 A:90 D:90 |
| 9 | Certain | Tests: extend existing terminal-client unit tests to cover (a) no reset before first write, (b) exactly once per connection, (c) string and binary first chunks, (d) re-armed on reconnect; run via `just` recipes only | Discussed — test plan and runner policy stated verbatim; matches context.md testing policy | S:95 R:85 A:90 D:90 |
| 10 | Confident | New ordering tests live in `terminal-client.test.tsx` (component harness with existing xterm `reset`/`write` spies + mocked WebSocket); no new Playwright e2e spec for this fix | Brief allows .test.ts/.test.tsx; .test.tsx already has the mock harness needed for call-ordering assertions; sub-frame flicker is not e2e-observable, and unit exemption from `.spec.md` policy applies | S:70 R:90 A:85 D:75 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
