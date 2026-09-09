# Intake: Relay Liveness Deadline

**Change**: 260909-4mhg-relay-liveness-deadline
**Created**: 2026-09-10

## Origin

> Implement Phase 1 (Server-side liveness deadline) from fab/plans/sahil/26-09-09-relay-viewer-liveness-identity-kick.md -- the SMALL, ships-first change that closes the root cause of relay-viewer ghosts via a server-side liveness deadline (api/terminals_ws.go, lib/relay-mux.ts), per that plan section. Then continue the full pipeline.

One-shot `/fab-new` invocation. The design was worked out beforehand in the plan file `fab/plans/sahil/26-09-09-relay-viewer-liveness-identity-kick.md` (drafted 2026-09-09 against `e5d799d8`); this intake implements **Phase 1 only** of that three-phase plan. Phases 2 (derived viewer identity) and 3 (kick) are explicitly out of scope — the plan's sequencing rule is "ship Phase 1 alone, observe for a day before Phase 2."

Every claim the plan makes about the code was re-verified at HEAD `26937ad7` during intake (see Why → Verified facts). One pointer in the plan is stale: the client-heartbeat memory prose lives in `docs/memory/run-kit/api-and-sockets.md` § Client heartbeat + wake probes, not `architecture.md` — Affected Memory below names the real location.

## Why

**The pain.** Every browser terminal tile is one real, sized `tmux attach-session` client that the daemon forks on a PTY (`api/terminals_ws.go` `attachStream` → `pty.StartWithSize`). The managed tmux conf runs `window-size smallest` + `aggressive-resize on`, so tmux sizes a window to the **narrowest** client currently viewing it. That guard is deliberate (it works around the tmux ≤3.7c pane-status redraw wedge) and is not negotiable. The consequence: a stale attach client holding a phone-sized grid clamps every co-viewer of that window to phone width until the attach dies. Users see phone/iPad tabs that "reconnect no matter what" and pin their desktop terminals at ~40 columns.

**Why the ghosts linger — the root cause.** The relay heartbeat is one-directional. The client sends `{op:"ping"}` every 30 s (`relay-mux.ts` `HEARTBEAT_INTERVAL_MS`) and gives up on a silent server after 60 s (`LIVENESS_TIMEOUT_MS`). The server pongs (`terminals_ws.go` read loop, `case "ping"`) but sets **no read deadline** on the socket outside teardown — the only `SetReadDeadline` call is the 100 ms `terminalsCleanupWait` that `runWriter` sets after a *write* fails, to unblock the read loop. A socket whose peer simply stops talking therefore lives until the kernel or a reverse proxy tears down TCP. Behind a proxy or tunnel the daemon's TCP peer is the proxy, which stays healthy, so the ghost lives as long as the proxy's idle timeout — minutes to hours.

Two client-side mechanisms exist but cannot close this gap:
- **Hidden-page suspension** (260903-xj0w) closes streams after a 60 s hidden grace, or immediately on `pagehide`/`freeze` — but it needs JS to run. A phone/iPad tab the OS freezes before the grace fires never sends its `close` ops; its attach clients survive as a frozen tab's sockets.
- **Client liveness** (260723-rma2) only detects a *dead server* from the client's side. Nothing on the server detects a dead client.

**What happens if we don't fix it.** Every multi-device user keeps hitting width clamps that only clear when they find and kill the phone tab, or when some proxy's idle timeout eventually fires. The Phase 2 identity work would *name* the ghost but not remove it; Phase 3 would kick it but the mux would re-open it within seconds unless a no-reopen close code ships too. Phase 1 alone removes the ghost at its source, with no protocol change, so it is the right first ship.

**Why this approach.** A server-side read deadline is the smallest possible closure: the client already emits a frame at least every 30 s while it has live streams (heartbeat pings, plus data and control ops), so "no inbound frame for 90 s" is an unambiguous dead-client signal. Expiry surfaces as a `ReadMessage` error, which drops the read loop into the **existing** `tc.teardown()` path that already kills and reaps every stream's attach client and PTY (`killAndReapAttach`). No new teardown code, no new wire op, no client change. Alternatives rejected:
- *Server-initiated WebSocket protocol pings* — browsers answer those in the network stack invisibly to JS, so they prove the browser process is alive, not that the tab's JS is; a frozen tab would still pass. The app-level inbound-frame deadline is what tracks the tab's actual activity.
- *Shortening the proxy idle timeout* — not under the daemon's control and deployment-specific.
- *tmux-side `detach-client` sweeps* — undone within seconds by the mux's reconnect (the reported symptom).

**Verified facts at HEAD `26937ad7`** (all re-checked during intake):
- `terminals_ws.go`: constants block at ~L80–104 (`terminalsWriteWait = 10s`, `terminalsCleanupWait = 100ms`, `resolveTimeout`, `terminalsReadLimit`); `stream` struct ~L169; `terminalsConn` struct ~L183; `handleTerminalsWS` ~L206 with the read loop `for { msgType, msg, err := conn.ReadMessage() ... }` at ~L243–285 and `tc.teardown()` after loop exit; `runWriter` sets the cleanup deadline at ~L645; `stream.teardown` ~L850; `killAndReapAttach` ~L874.
- Only two `SetReadDeadline` sites exist in the file: none after `Upgrade`, one in `runWriter`'s dead-socket branch.
- `relay-mux.ts`: `RECONNECT_BASE_MS = 1000`, `RECONNECT_CAP_MS = 30000` (L80–81); `HEARTBEAT_INTERVAL_MS = 30000`, `LIVENESS_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS`, `WAKE_PROBE_TIMEOUT_MS = 3000` (L94–96); `HIDDEN_RELEASE_GRACE_MS = 60000`; `scheduleReconnect` (L299) returns early with `this.ws = null` when `liveCount() === 0`; `resumeSuspended` (L379) calls `this.connect()` after un-suspending; `ws.onmessage` calls `noteInbound()` on ANY frame.
- `relay-mux.test.ts` L592 already has the test "a socket reconnect while hidden does NOT re-open suspended streams; a drop while fully suspended stays closed until visible" — it drops the socket while fully suspended, asserts no reconnect for 60 s, then flips `visible` and asserts a fresh socket with one re-issued `open`. This is exactly the interaction Phase 1 needs guarded (a server-side deadline closing a fully-suspended socket must not strand resume).
- `state_ws.go` L210–216 is the sibling pattern for a read deadline: `conn.SetReadDeadline(time.Now().Add(10 * time.Second))` for the `hello` handshake, then `conn.SetReadDeadline(time.Time{})` to clear it.
- Existing Go tests in `terminals_ws_test.go`: `TestTerminals_PingRepliesPong` (L249) dials a real `httptest` server via `newTestRouter(&slowSessionFetcher{}, &mockTmuxOps{})` and reads frames with a client-side deadline; `TestStreamTeardownReapsAttachChild` (L439) builds a `stream` around a real `pty.StartWithSize(sh -c "sleep 30")` and asserts `cmd.ProcessState != nil` after teardown; `TestKillAndReapAttach` (L468). These are the patterns the new tests follow.

## What Changes

### 1. `app/backend/api/terminals_ws.go` — server-side liveness deadline

**New constant** in the existing `const (...)` block beside `terminalsWriteWait` / `terminalsCleanupWait`:

```go
// terminalsLivenessTimeout is the inbound-silence deadline on a terminals
// socket. The client heartbeats {op:"ping"} every 30s (relay-mux.ts
// HEARTBEAT_INTERVAL_MS) while it has live streams and gives up on a silent
// server after 60s (LIVENESS_TIMEOUT_MS); 90s is three missed heartbeats and
// strictly longer than the client's own give-up, so a live client always
// disconnects itself first and this deadline only ever fires on a peer that
// has stopped running JS (a frozen phone tab, a proxy-kept TCP peer). Expiry
// surfaces as a ReadMessage error → teardown → every stream's attach client
// is killed and reaped, releasing its sized tmux client.
terminalsLivenessTimeout = 90 * time.Second
```

Declared as a package-level `var` if the test override approach needs it (see Assumptions #5) — a `const` cannot be overridden from a test; the decision at plan generation is whether to use a `var terminalsLivenessTimeout = 90 * time.Second` (test sets it short in a subtest with `t.Cleanup` restore) or thread a duration through `terminalsConn`. Either is acceptable; the constant's *value* and *doc comment* above are fixed.

**Arm the deadline after upgrade, refresh on every inbound frame.** In `handleTerminalsWS`, immediately before the read loop:

```go
conn.SetReadLimit(terminalsReadLimit)
conn.SetReadDeadline(time.Now().Add(terminalsLivenessTimeout))
for {
    msgType, msg, err := conn.ReadMessage()
    if err != nil {
        // ... liveness-expiry log, see below
        break
    }
    // Any inbound frame — binary data, control op, ping — is proof of life.
    conn.SetReadDeadline(time.Now().Add(terminalsLivenessTimeout))
    ...
```

The refresh happens after every **successful** `ReadMessage()`, before dispatch, so data frames, `open`/`resize`/`close` control ops, and `ping` all count identically. Pongs are outbound and never refresh anything.

**Keep `terminalsCleanupWait` unchanged.** `runWriter`'s dead-socket branch still sets the 100 ms cleanup deadline; it simply overrides the longer liveness deadline (a later `SetReadDeadline` replaces the earlier one), so a write failure still tears down promptly. Nothing in that path changes.

**Log the expiry.** On read-loop exit, when the error is a deadline expiry *caused by liveness* (not the cleanup deadline the writer set after a write failure), emit one `slog.Info`:

```go
slog.Info("terminals: liveness deadline expired; tearing down",
    "streams", tc.streamCount(), "peer", r.RemoteAddr)
```

Distinguishing the two deadline causes: `runWriter` records that it triggered cleanup (e.g. an `atomic.Bool writerDead` on `terminalsConn`, set to true immediately before its `SetReadDeadline(terminalsCleanupWait)`), and the read loop logs the liveness message only when the read error is a timeout (`errors.As(err, &net.Error)` with `Timeout()`, or `errors.Is(err, os.ErrDeadlineExceeded)` — gorilla surfaces the underlying `net.Conn` timeout) **and** `writerDead` is false. A normal client close (`websocket.CloseError`) logs nothing new. `tc.streamCount()` is a small mutex-guarded helper (`len(tc.streams)` under `tc.mu`, excluding the control pseudo-stream if it is registered in the map — match whatever the map actually holds). The peer address is `r.RemoteAddr` as-is (plain string; `X-Forwarded-For` derivation is Phase 2's concern and is **not** introduced here).

**Teardown path is untouched.** Expiry → `ReadMessage` error → `break` → `tc.teardown()` → each `stream.teardown()` → `killAndReapAttach`. That chain already exists and is already tested for reaping.

### 2. `app/frontend/src/lib/relay-mux.ts` — documented invariant, no protocol change

No behavior change. Add a comment next to the heartbeat constants naming the server-side deadline so the two cannot drift silently:

```ts
// Server-side counterpart (terminals_ws.go terminalsLivenessTimeout = 90s):
// the daemon tears a terminals socket down after 90s of inbound silence —
// three missed heartbeats, and longer than LIVENESS_TIMEOUT_MS so a live
// client always gives up on a dead server before the server gives up on it.
// Invariant: HEARTBEAT_INTERVAL_MS < LIVENESS_TIMEOUT_MS < 90s. A fully
// suspended tab (heartbeat stopped, zero live streams) WILL hit the server
// deadline; scheduleReconnect's zero-live-streams check lets that close stand
// and resumeSuspended() reconnects on the visible transition.
export const HEARTBEAT_INTERVAL_MS = 30000;
export const LIVENESS_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS;
```

Optionally export `SERVER_LIVENESS_TIMEOUT_MS = 90000` as a documented constant beside them, used only by the test to assert the ordering invariant (`HEARTBEAT_INTERVAL_MS < LIVENESS_TIMEOUT_MS < SERVER_LIVENESS_TIMEOUT_MS`). Whether to export it is an apply-time call (Assumptions #7); the comment is required either way.

**Runtime interaction to keep true** (already true at HEAD, verified): with every stream suspended the heartbeat is stopped (`syncHeartbeat` keys on `liveCount() > 0`), so a hidden tab's socket goes silent and the server deadline closes it ~90 s after the last frame. `ws.onclose` → `scheduleReconnect` → `liveCount() === 0` → `this.ws = null`, no reconnect. On `visible`, `resumeSuspended()` un-suspends and calls `connect()`, which opens a fresh socket whose `onopen` re-issues `open` for the resumed streams. The user sees the tile reconnect and repaint.

### 3. Tests

**`app/backend/api/terminals_ws_test.go`** — three new cases, following `TestTerminals_PingRepliesPong`'s real-`httptest` dial pattern with the liveness timeout overridden to a short value (tens to a few hundred ms) for the test's duration:

1. **Silent connection is torn down at the deadline and its attach is reaped.** Dial `/ws/terminals`, open a stream (an `open` op with a mocked tmux so `attachStream` forks a real cheap child — or, if forking through the mock is impractical, assert on the socket close and separately rely on the existing `TestStreamTeardownReapsAttachChild` for the reap half; prefer the end-to-end assertion when the existing test scaffolding allows a real `pty.StartWithSize` child). Send nothing further. Assert the server closes the socket within ~2× the shortened deadline (client `ReadMessage` returns an error) and, where the child is real, that its `cmd.ProcessState != nil`.
2. **A pinging connection outlives the deadline.** Same dial; send `{op:"ping"}` at half the shortened deadline, repeatedly, for at least 3× the deadline; assert the socket stays open and pongs keep arriving.
3. **Data frames refresh the deadline, not only pings.** Same dial with a stream open; send binary data frames (`[u32 BE id][bytes]`) at half the deadline instead of pings; assert the socket stays open past 3× the deadline. (Frames addressed to an unknown stream id are dropped by `handleDataFrame` but still count as inbound — that is fine and even simpler: the refresh happens before dispatch.)

Also assert the log line fires on liveness expiry and **not** on a client-initiated close (use `slog` capture via a test handler if the package already has one; otherwise assert via the `writerDead`/timeout branch being reached by a unit-level check — do not over-engineer log assertions).

**`app/frontend/src/lib/relay-mux.test.ts`** — the case at L592 already proves suspended-all → socket drop → no reconnect → `visible` reconnects with one re-issued `open`. Extend its description (or add a sibling `it`) to name the server-side liveness deadline as the drop cause so the test's intent is discoverable, and add an assertion of the constant ordering invariant if `SERVER_LIVENESS_TIMEOUT_MS` is exported. No new mux behavior is under test.

### 4. Manual verification (recorded for the PR body; not automated)

Open a tile on a phone, put the phone to sleep. On the host: `tmux -L <srv> list-clients -F '#{client_pid} #{client_width}x#{client_height} #{t:client_activity}'` shows the phone client gone within ~90 s, and the desktop tile's width recovers on the next redraw. Wake the phone: the tile reconnects and repaints.

### Out of scope (Phases 2 and 3 — do not implement)

- Any per-connection identity capture (`peer`, `userAgent`, `connectedAt`, `lastInbound` fields), the `attachRegistry`, widened `list-clients` format, `Viewer` enrichment, session-card viewer rows.
- Any kick endpoint, `closeKicked = 4005`, or no-reopen client handling.
- `X-Forwarded-For` parsing. The log line uses `r.RemoteAddr` verbatim.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) § Terminal Relay — Direct Attach: the heartbeat paragraph becomes bidirectional-by-deadline; record the 30 s / 60 s / 90 s ladder and why 90 (three missed heartbeats; strictly longer than the client's give-up so a live client always disconnects itself first); note that the deadline is the server-side complement to hidden-page suspension for tabs the OS freezes before their grace fires.
- `run-kit/api-and-sockets`: (modify) § Client heartbeat + wake probes (both sockets): add the server-side deadline as the mux-only counterpart (`/ws/state` gets no deadline in this change), the refresh-on-any-inbound-frame rule, the `terminalsCleanupWait` override relationship, and the expiry log line. A Design Decisions entry for "90 s, refreshed by any inbound frame, over server-initiated WS protocol pings" with the frozen-tab rationale.
- `run-kit/ui/terminal`: (modify) § Hidden-page stream suspension: one sentence — a fully suspended tab's socket is now closed by the server's 90 s deadline (the heartbeat is stopped, so the socket goes silent); `scheduleReconnect`'s zero-check lets it stand and `resumeSuspended()` reconnects on `visible`. The behavior already exists; the memory gains the *why the socket closes*.

## Impact

- **Backend**: `app/backend/api/terminals_ws.go` (one constant/var, two `SetReadDeadline` calls, one log line, one small helper, one atomic flag), `app/backend/api/terminals_ws_test.go` (three new tests). No new routes, no new packages, no `internal/` changes.
- **Frontend**: `app/frontend/src/lib/relay-mux.ts` (comment + optional exported constant), `app/frontend/src/lib/relay-mux.test.ts` (description/assertion touch-up). No runtime behavior change; `tsc --noEmit` and Vitest must stay green.
- **Protocol**: none. Old clients against a new server: any client that heartbeats survives; a client with zero live streams already lets its socket close, and a suspended-all client already reconnects on `visible`. New frontend against an old server: comment-only, nothing to break.
- **Operational**: a legitimately visible tab whose main thread is starved for > 90 s gets dropped and transparently reconnects on the next tick (accepted in the plan — the mux already handles socket drops flicker-free). One new `slog.Info` per ghost teardown.
- **Tests to run**: `just test-backend` scoped first to `go test ./api -run 'TestTerminals'`-equivalent through the `just` recipe where possible; `just test-frontend` for `relay-mux.test.ts`. No e2e changes.

## Open Questions

None blocking. Apply-time calls (recorded as assumptions below): `var` vs. injected duration for the test override; whether to export `SERVER_LIVENESS_TIMEOUT_MS` from `relay-mux.ts`; whether the log-line assertion is worth a slog capture handler.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is Phase 1 of the plan only — deadline + tests + memory; Phases 2 (identity) and 3 (kick) are excluded | The user's request names Phase 1 explicitly and the plan's sequencing rule is "ship Phase 1 alone, observe before Phase 2" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Deadline value is 90 s (`terminalsLivenessTimeout`), i.e. three missed 30 s heartbeats and strictly longer than the client's 60 s give-up | Plan states the value and the reasoning; verified the client constants at HEAD (30 s / 60 s) | S:95 R:90 A:95 D:95 |
| 3 | Certain | Any successful `ReadMessage()` refreshes the deadline before dispatch — data frames, control ops, and pings alike | Plan states it; mirrors the client's own "any inbound frame is proof of life" rule | S:90 R:90 A:95 D:95 |
| 4 | Certain | Expiry reuses the existing read-error → `tc.teardown()` → `killAndReapAttach` path; no new teardown code; `terminalsCleanupWait` unchanged | Plan states it; verified the path exists and is already reap-tested (`TestStreamTeardownReapsAttachChild`) | S:90 R:85 A:95 D:95 |
| 5 | Confident | The test override for the deadline is a package-level `var terminalsLivenessTimeout` shortened per-test with `t.Cleanup` restore, rather than a clock injection or a field on `terminalsConn` | Plan permits either ("clock-injected or a short test override of the constant"); the file's other tunables are package-level and the test file is in-package, so a var is the smallest change; tests using it must not run in parallel | S:70 R:85 A:80 D:70 |
| 6 | Confident | Liveness-expiry log fires only when the read error is a timeout AND the writer did not trigger the cleanup deadline (an `atomic.Bool` set in `runWriter` before its `SetReadDeadline`) — so a write-failure teardown is not mislabelled as a ghost | Plan wants the log to be "the first place the daemon names a ghost"; both deadline causes surface as the same timeout error, so a flag is the minimal disambiguator | S:65 R:85 A:85 D:75 |
| 7 | Certain | `relay-mux.ts` gets a comment documenting the 90 s server deadline and the `HEARTBEAT < LIVENESS < 90 s` ordering; exporting a `SERVER_LIVENESS_TIMEOUT_MS` constant for a test assertion is optional and left to apply | Plan says "comment only" for the invariant; an exported constant is a small addition that makes the invariant testable, but the plan does not require it | S:75 R:95 A:85 D:70 |
| 8 | Certain | The plan's `relay-mux.test.ts` case is already covered by the existing test at L592 (suspended-all → drop → stays closed → `visible` reconnects); apply touches its description/adds an invariant assertion rather than writing a new behavior test | Verified the test body at HEAD does exactly the plan's scenario | S:80 R:95 A:90 D:85 |
| 9 | Certain | Affected Memory names `run-kit/api-and-sockets` § Client heartbeat + wake probes (not `architecture.md` as the plan says) plus `run-kit/tmux-sessions` § Terminal Relay and `run-kit/ui/terminal` § Hidden-page stream suspension | Grepped the memory tree: the heartbeat prose lives in api-and-sockets.md L296; architecture.md has no such section | S:80 R:90 A:95 D:90 |
| 10 | Certain | Change type is `fix` (set explicitly), not the keyword-inferred `feat` | The change closes a live bug (ghost attach clients clamping window width); the description lacks the literal word "fix", so refresh would infer `feat` | S:70 R:95 A:85 D:80 |
| 11 | Certain | The log line's peer address is `r.RemoteAddr` verbatim; no `X-Forwarded-For` parsing in this change | Plan lists the forwarded-for derivation under Phase 2 and flags trust caveats there; introducing it here would widen scope | S:80 R:95 A:90 D:90 |
| 12 | Certain | `/ws/state` receives no liveness deadline in this change | Only `/ws/terminals` holds attach clients; the state socket has no sizing side effect and the plan scopes the deadline to the terminals mux | S:75 R:95 A:90 D:90 |

12 assumptions (10 certain, 2 confident, 0 tentative, 0 unresolved).
