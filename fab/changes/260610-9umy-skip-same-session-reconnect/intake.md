# Intake: Skip Redundant Same-Session Relay Reconnect (Window-Switch Flicker, Part 2)

**Change**: 260610-9umy-skip-same-session-reconnect
**Created**: 2026-06-10
**Status**: Draft

## Origin

Synthesized from a `/fab-discuss` conversation, as the explicitly-agreed follow-up to the completed part-1 change `260610-qf25-defer-terminal-reset-flicker` (PR #251) — see that change's intake for the shared root-cause investigation. Interaction mode: one-shot intake from a pre-decided design; all decisions below were made during the discussion (or carried over from part 1's investigation), not assumed here.

> **Problem**: After part 1 (deferred reset), window switches no longer flash black, but a same-session window switch STILL tears down and re-establishes the relay WebSocket + PTY + tmux attach — a full reconnect roundtrip, a terminal reset (wiping xterm scrollback), and server-side attach work — even though it is now redundant: `app/backend/api/relay.go` attaches the PTY directly to the window's real owning session (since 260602-qn62), and tmux has already switched the active window in place (a tmux-status-bar click travels over the existing socket) or will switch it (REST `selectWindow` fired by `navigateToWindow` and by mount-time alignment in app.tsx — both already in place). The WebSocket effect in `app/frontend/src/components/terminal-client.tsx` (deps `[terminalReady, sessionName, windowId, server, wsRef]`, line 746) reconnects because `windowId` is in its deps. Part 1's rewritten comment explicitly names this follow-up.
>
> **Decision**: key the WS effect's teardown/reconnect on the resolved owning session — connection identity is **(server, owning session)**, NOT windowId.

Claims re-verified against the working tree at intake time: the WS effect deps are `[terminalReady, sessionName, windowId, server, wsRef]` (terminal-client.tsx:746); the part-1 comment block at 479-495 ends with "A follow-up change will eliminate those reconnects by keying this effect's teardown on the resolved owning session instead of windowId (explicitly out of scope here)"; `connect()` builds the relay URL from `windowIdRef.current` (line 640) so transient-drop reconnects already track the latest windowId; app.tsx fires `selectWindow` from both `navigateToWindow` (app.tsx:487) and the mount-time URL/tmux alignment effect (app.tsx:434), and passes `sessionName ?? ""` to `TerminalClient` (app.tsx:1224); `BoardPane` renders `TerminalClient` with a fixed per-pane `windowId` and `registerFocus={false}` (board/board-pane.tsx:108-118).

## Why

1. **The pain point**: Every same-session window switch (sidebar click, command palette, `navigateToWindow`, URL writeback after a tmux-status-bar click) pays a full, now-redundant reconnect: close the live relay WebSocket, open a new one, server-side `ResolveWindowSession` + `SelectWindowInSession` + PTY `attach-session`, then a client-side `terminal.reset()` that wipes the xterm scrollback. tmux has already switched (or will switch, via the REST `selectWindow` calls already in place) the active window of the attached session in place — the reconnect adds latency and destroys scrollback for zero benefit.

2. **Consequence of not fixing**: The reconnect roundtrip remains the dominant cost of intra-session navigation — visible as a brief `[reconnecting...]`-class delay and a scrollback wipe on every switch — undermining the perceived-latency work already shipped (adaptive flush 40→10ms echo; part 1's no-black-frame switching). Server-side it generates pointless attach/detach churn per switch.

3. **Why this approach**: The reconnect-on-windowId was only ever *needed* under the deleted per-WebSocket ephemeral grouped-session relay design (260508-hdjr era): each socket had independent active-window state, so a URL-only switch required a fresh socket. With direct attach (260602-qn62) the attached PTY tracks its real session's active window natively — switching in place is exactly what a native `tmux attach` client does. Keying the connection on (server, owning session) aligns the frontend's connection identity with the backend's actual attachment identity. Rejected alternatives are recorded under Design Decisions below.

## What Changes

Single affected source file: `app/frontend/src/components/terminal-client.tsx`, plus its test file `terminal-client.test.tsx`. Frontend only — **no backend changes, no app.tsx changes** (verify at apply time that `navigateToWindow` and the mount-time alignment already fire `selectWindow` — re-verified at intake time at app.tsx:487 and app.tsx:434).

### 1. Key the WebSocket effect's teardown/reconnect on the resolved owning session

**Current behavior** (terminal-client.tsx:496-746): the WS effect's deps are `[terminalReady, sessionName, windowId, server, wsRef]`. Any `windowId` change tears the connection down and reconnects; any `sessionName` change (including the cold-deep-link "" → resolved transition) does too.

**New behavior — required semantics** (decided requirements; the exact React mechanism — ref-tracked connection identity, split effects, computed key — is implementor's choice):

1. **Same-session windowId change → NO teardown, NO reconnect, NO reset.** The PTY follows via tmux `select-window`, already issued by the existing paths (REST `selectWindow` from `navigateToWindow` and mount-time alignment in app.tsx; or the in-band tmux-status-bar click that traveled over the existing socket). Accepted consequence (arguably a feature): xterm scrollback is no longer wiped on same-session switches — identical to a native `tmux attach` client.
2. **Owning session changes between two RESOLVED (non-empty) values** — cross-session navigation, a window moved to another session, `_rk-pin-*` pin-session transitions — **→ teardown + reconnect exactly as today.** Part 1's deferred reset guarantees no black frame on these reconnects.
3. **Cold deep-link**: the `sessionName` prop is SSE-derived and is `""` until the first snapshot resolves it (app.tsx passes `sessionName ?? ""`, app.tsx:1224). Connect immediately by windowId as today — the relay resolves the owning session server-side from `@N` (`ResolveWindowSession`). When `sessionName` transitions `""` → resolved, do NOT reconnect: by construction the live connection is already attached to that window's owning session. (Today this transition triggers a redundant reconnect because `sessionName` is in the deps — this change eliminates that one too.)
4. **Session rename** (`sessionName` changes between two non-empty values for the same session entity): ACCEPTED TRADEOFF — treat as a session change and reconnect. The SSE snapshot carries no stable session id, the tmux client follows the renamed entity anyway, and rename is rare; detecting renames adds complexity for negligible benefit (part 1 already removed the black frame from any reconnect). Rejected alternative: entity-continuity tracking (see Design Decisions).
5. **Transient-drop reconnects** (`ws.onclose` → `reconnectTimer` → `connect()`) keep using `windowIdRef.current` (latest windowId) in the relay URL — unchanged (terminal-client.tsx:474-477, 640, 709-714).

### 2. Unchanged surfaces (must not regress)

- **Relay URL semantics**: `/relay/@N?server=` — the URL is still built from the (latest) windowId; only the *teardown/reconnect trigger* changes.
- **Focused-terminal registration, upload hook, aria-label**: all keep following the `windowId`/`sessionName` props as today (separate effects/hooks — terminal-client.tsx:118, 129-135, 753).
- **`onSessionNotFound` / close-code 4004 redirect path** (terminal-client.tsx:703-707): unchanged.
- **BoardPane usage**: fixed per-pane windowIds, `registerFocus={false}` (board/board-pane.tsx:108-118) — must not regress; board panes never change windowId in place, so the new keying is behavior-neutral there.
- **Multi-client shared active-window-pointer tradeoff** documented in relay.go: this change only stops the *reconnect*; it does not alter tmux semantics (all clients attached to one session still share its active-window pointer).
- **Part-1 deferred-reset semantics**: on every connection that IS established (cross-session switch, transient drop, rename), the deferred reset still fires before the first write — both write paths, same-frame clear+repaint.
- **Adaptive-flush invariants** (PR #244/#245): thresholds, UTF-8 byte measurement, one-immediate-write-per-frame guard, once-buffering-always-buffer ordering — untouched.

### 3. Rewrite the WS-effect comment (terminal-client.tsx:479-495)

Part 1 rewrote this block; it currently ends: "A follow-up change will eliminate those reconnects by keying this effect's teardown on the resolved owning session instead of windowId (explicitly out of scope here)." Rewrite it to describe the **implemented** behavior: connection identity is (server, owning session); same-session windowId changes ride the existing socket via tmux `select-window`; cold deep-links connect by windowId and absorb the `""` → resolved transition without reconnecting; and the session-rename-reconnects tradeoff (no stable session id in the SSE snapshot) is recorded.

### 4. Tests

Unit tests in `app/frontend/src/components/terminal-client.test.tsx`, run via `just test-frontend` only — never direct `vitest`/`pnpm test`. New coverage:

- **Same-session windowId switch**: the WebSocket instance survives — no `close()`, no new `MockWebSocket` instance, no `terminal.reset()`.
- **Cross-session switch** (sessionName changes non-empty → different non-empty): old socket closed, new socket opened, deferred reset fires before the first write (part-1 semantics preserved on real reconnects).
- **`""` → resolved sessionName while connected**: no reconnect.
- **Transient drop** still reconnects with the LATEST windowId in the relay URL (windowIdRef path).

**Test Integrity note (constitution § Test Integrity — spec-conformant update, not a weakening)**: part-1 tests in the "TerminalClient deferred reset" describe block use a windowId-change rerender as the teardown trigger — verified: "neutralizes pending write state at effect teardown" (terminal-client.test.tsx:433) switches `@0` → `@1` with the SAME sessionName. Under part-2 semantics that rerender no longer tears down, so those tests MUST be updated to trigger teardown via a session change or unmount instead. The behaviors they prove (teardown neutralization of pending write state, reset re-arm on reconnect) must still be proven — only the trigger changes to conform to the new spec.

The existing suite (579 tests at part-1 completion) must end green.

### Design Decisions (alternatives considered and rejected — for the record)

| Alternative | Why rejected |
|---|---|
| Protocol-level "select-window" WS message | Unnecessary — REST `selectWindow` + tmux already switch the attached session's active window in place; the relay attaches to the real session, so the PTY follows natively. |
| Keep the reconnect but suppress the reset | Still pays the reconnect roundtrip + scrollback wipe; fixes a symptom of the redundant reconnect instead of removing it. |
| Entity-continuity tracking to survive session renames without reconnect | The SSE snapshot carries no stable session id; the tmux client follows the renamed entity anyway; rename is rare; part 1 already removed the black frame from any reconnect — complexity for negligible benefit. |

### Non-Goals

- Any backend change (`app/backend/**` untouched) — relay URL semantics and tmux behavior unchanged.
- Any app.tsx change — `navigateToWindow` and mount-time alignment already fire `selectWindow` (verify again at apply time).
- Any change to part-1 deferred-reset mechanics or adaptive-flush thresholds/measurement/ordering.
- Detecting session renames (entity-continuity tracking) — accepted reconnect-on-rename tradeoff.
- New Playwright e2e specs — coverage is unit-level (connection-lifecycle assertions against the mocked WebSocket are the reliable proof; unit exemption from `.spec.md` policy applies).

## Affected Memory

- `run-kit/ui-patterns`: (modify) The "Terminal Write Batching (Adaptive Flush + Deferred Reset)" section — just rewritten by part 1's hydrate — needs the connection-identity change documented at hydrate time: WS effect keyed on (server, owning session) instead of windowId; same-session switches ride the existing socket (scrollback preserved); ""→resolved absorption; rename-reconnect tradeoff.

## Impact

- **Code**: `app/frontend/src/components/terminal-client.tsx` only — the WebSocket effect's teardown/reconnect keying (deps line 746) and the comment block at 479-495. No API, route, dependency, backend, or app.tsx changes.
- **Tests**: `app/frontend/src/components/terminal-client.test.tsx` — new connection-lifecycle tests + spec-conformant trigger updates to part-1 teardown tests. Run via `just test-frontend`.
- **Behavioral**: same-session window switches become in-place (no reconnect roundtrip, no reset, scrollback preserved — native-tmux-client behavior); cold deep-links no longer pay a redundant reconnect when SSE resolves the session name; cross-session navigation, window moves, pin-session transitions, and session renames reconnect exactly as today (flicker-free per part 1); transient-drop recovery unchanged.
- **Performance**: removes a full WS + PTY + tmux-attach roundtrip per same-session switch; no new overhead on any path.

## Open Questions

None — all decisions were made in the originating discussion (and part 1's shared investigation); claims re-verified against source at intake time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Connection identity is (server, owning session): same-session windowId changes cause NO teardown/reconnect/reset — the PTY follows via tmux `select-window` already issued by existing paths (app.tsx:434, :487; in-band status-bar click) | Discussed — the core decision; redundancy verified: relay.go direct-attaches to the owning session (260602-qn62), part-1 comment (terminal-client.tsx:491-495) explicitly names this follow-up | S:95 R:80 A:90 D:95 |
| 2 | Certain | Owning-session change between two resolved non-empty values (cross-session nav, window moved, `_rk-pin-*` transitions) → teardown + reconnect exactly as today; part-1 deferred reset keeps those flicker-free | Discussed — explicit requirement 2; preserves correct attachment identity where it genuinely changes | S:95 R:85 A:90 D:95 |
| 3 | Certain | Cold deep-link: connect immediately by windowId while `sessionName` is `""` (relay resolves owning session server-side); the `""` → resolved transition does NOT reconnect — the live connection is already attached to that session by construction | Discussed — explicit requirement 3; `sessionName ?? ""` prop verified at app.tsx:1224; eliminates today's redundant resolve-transition reconnect | S:90 R:80 A:85 D:90 |
| 4 | Confident | Session rename (non-empty → different non-empty, same entity) is treated as a session change and reconnects — accepted tradeoff; rejected alternative: entity-continuity tracking | Discussed — accepted explicitly: SSE snapshot has no stable session id, tmux client follows the entity anyway, rename is rare, part 1 removed the black frame from any reconnect; revisitable later without breaking this design | S:90 R:75 A:85 D:80 |
| 5 | Certain | Scrollback preservation on same-session switches is an accepted consequence (arguably a feature) — identical to a native `tmux attach` client | Discussed — consequence called out and accepted as part of requirement 1 | S:90 R:85 A:90 D:90 |
| 6 | Certain | Transient-drop reconnects (`ws.onclose` → `reconnectTimer` → `connect()`) keep using `windowIdRef.current` — unchanged | Discussed — explicit requirement 5; mechanism verified at terminal-client.tsx:474-477, 640, 709-714 | S:95 R:90 A:95 D:95 |
| 7 | Certain | Unchanged surfaces: relay URL semantics (`/relay/@N?server=`), focused-terminal registration, upload hook, aria-label (all keep following windowId props), 4004/onSessionNotFound redirect, BoardPane usage (fixed windowIds, `registerFocus={false}` — verified board-pane.tsx:108-118), relay.go multi-client shared active-window-pointer tradeoff (tmux semantics untouched) | Discussed — explicit requirement 6; surfaces enumerated and verified in source at intake time | S:95 R:85 A:90 D:90 |
| 8 | Confident | Exact React mechanism (ref-tracked connection identity vs. split effects vs. computed key) is implementor's choice, provided semantics #1-#6 hold and part-1 deferred-reset + adaptive-flush invariants are preserved | Discussed — semantics fully specified, mechanism left open; any compliant mechanism is locally reversible within one file | S:80 R:85 A:85 D:70 |
| 9 | Certain | Scope: frontend only — `terminal-client.tsx` + `terminal-client.test.tsx`; no backend changes, no app.tsx changes (re-verify at apply time that `navigateToWindow` and mount-time alignment fire `selectWindow`) | Discussed — stated constraint; selectWindow paths verified at intake time (app.tsx:434, :487) | S:95 R:90 A:95 D:95 |
| 10 | Certain | Rewrite the WS-effect comment (terminal-client.tsx:479-495) to describe the implemented (server, owning session) keying and the rename tradeoff, replacing the "follow-up change will eliminate" paragraph | Discussed — explicit requirement 7; current comment text verified in working tree | S:95 R:90 A:90 D:95 |
| 11 | Certain | Tests: same-session switch keeps the socket (no close/new instance/reset); cross-session switch closes+reopens with deferred reset before first write; `""`→resolved causes no reconnect; transient drop reconnects with latest windowId in URL; via `just test-frontend` only; full suite (579 at part-1 completion) green | Discussed — test plan stated verbatim; matches context.md runner policy and existing MockWebSocket harness in terminal-client.test.tsx | S:95 R:85 A:90 D:90 |
| 12 | Certain | Part-1 tests that use a windowId-change rerender as the teardown trigger MUST be re-triggered via session change or unmount — spec-conformant update per constitution § Test Integrity (behaviors proven unchanged: teardown neutralization, reset re-arm) | Discussed — called out explicitly; verified exactly which test depends on it ("neutralizes pending write state at effect teardown", terminal-client.test.tsx:433, @0→@1 same session) | S:90 R:85 A:90 D:90 |
| 13 | Certain | Change type `fix` — it fixes redundant reconnect behavior; skill keyword rules match "fix" first (refactor was considered) | Skill Step 6 keyword matching is deterministic, first match wins; discussion framed it as fixing redundant behavior | S:85 R:95 A:95 D:85 |

13 assumptions (11 certain, 2 confident, 0 tentative, 0 unresolved).
