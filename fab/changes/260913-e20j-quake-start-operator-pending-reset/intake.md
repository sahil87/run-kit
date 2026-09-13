# Intake: Quake Terminal — Start Operator Pending State Reset

**Change**: 260913-e20j-quake-start-operator-pending-reset
**Created**: 2026-09-13

## Origin

Conversational, from a `/fab-discuss` session on 2026-09-13 diagnosing a live incident. The user's raw reports:

> Starting the operator using the "start operator" button led to a trust wall that I accepted — which then led to a claude session starting but no "/fab-operator". So I exited that claude session and terminal. But the operator tab doesn't detect it. Its stuck at this state.

and, after switching the drawer to a second server:

> Which of these solves this issue?

Two screenshots showed the quake terminal's operator-less body on `runKit` and then on `fabKit`, each with a disabled button reading `starting…` above the hint `no operator on this server — run rk operator`. The daemon log showed `POST /api/operator/start?server=runKit` → 202 at 17:39:41 and **no** start request for `fabKit` at all.

**Diagnosis established in the discussion** (verified in `app/frontend/src/components/quake-terminal.tsx`):

- `startPending` is a single `useState(false)` on the `QuakeTerminal` component. The click handler sets it true and clears it only on a **non-409 rejection** of `startOperator(server)`. The success path (202) and the 409 `operator_exists` path never clear it; the code comment relies on the operator-less body **unmounting** once the sessions payload carries the operator window.
- The drawer component itself stays mounted for the page's lifetime, so the flag survives the body swap. When the operator window later disappears (the user exited Claude and the shell; the `_rk-operator` session died), the operator-less body re-renders with the flag still true: a permanently disabled `starting…` button. A page reload is the only reset.
- The flag is not keyed to a server. A click on `runKit` set it; switching the drawer's server (the pinned/picked/route server) to `fabKit` renders `fabKit`'s operator-less body with the same flag — `starting…` on a server where nothing was ever requested.
- The existing tests (`quake-terminal.test.tsx`, the "Start operator" block around lines 320–400) assert only the happy body swap, the 409 stays-pending behavior, and the failure re-arm; none covers the window-vanishes-after-success or server-switch paths.

**Decisions made in the discussion**: scope the flag to the server it was requested for; clear it when that server's operator target resolves (the SSE payload carrying the window), not on unmount; add a bounded fallback re-arm so a request whose window never appears does not leave the button dead. The launch-side defects (window in `$HOME`, silent kickoff miss) are the sibling change `260913-t7vy-operator-daemon-launch-root-kickoff`; this change is only the drawer's state.

## Why

**The pain.** After one click of Start operator, the button is dead for the rest of the page's life on every server the drawer can show, regardless of what actually happened to the operator. The body reads `starting…` while the hint beneath it says there is no operator — the UI contradicts itself, and the one on-screen door back onto `POST /api/operator/start` is closed. Today's incident needed exactly that door: the first operator died on a trust wall and the user wanted to try again.

**The consequence of not fixing it.** Every operator start that does not end in a healthy, long-lived operator (a trust wall, an `Unknown command`, an agent exit, a user closing the pane) strands the drawer in a lying state until a full reload, and the lie spreads to unrelated servers on a switch. The sibling change makes bad starts rarer; it cannot make them impossible (a fresh checkout, a walled provider), so the drawer must recover on its own.

**Why this approach.** The drawer already derives operator presence per server (`target = findOperatorWindow(sessionsByServer.get(server))`, a `useMemo` over the SSE-fed session context) and already keys everything else it does — the compose target, the send queue, the hint throttle — on that derivation. Pending should be one more thing keyed the same way: a request is pending **for a server** until **that server's** target resolves. Effects over `target` are the existing idiom in this file (the queued send in the `pendingSend` effect waits for `target` exactly this way), so the fix is a small, pattern-consistent state change rather than a new mechanism. A bounded timeout is the only addition, because no SSE event says "the start you requested will never produce a window".

## What Changes

### 1. Pending state is keyed to the requesting server (`app/frontend/src/components/quake-terminal.tsx`)

Replace

```ts
const [startPending, setStartPending] = useState(false);
```

with

```ts
// Start operator: the server whose POST /api/operator/start is in flight, or
// null. Keyed per server so a switch to another server renders that server's
// own idle button; cleared by the target-resolves effect below (the SSE
// sessions payload carrying the new operator window), by a non-409 failure,
// or by the pending timeout.
const [startPendingServer, setStartPendingServer] = useState<string | null>(null);
const startPending = startPendingServer !== null && startPendingServer === server;
```

- The click handler sets `setStartPendingServer(server)` and clears `startError`; on a non-409 rejection it sets the error and `setStartPendingServer(null)` **only if the pending server is still the one that failed** (a stale rejection for a server the user has since left must not re-arm a different server's button — compare against a ref mirror of the pending server, the `targetRef` precedent).
- The 409 `operator_exists` branch stays a no-op: the operator appeared under us, and the target-resolves effect (§2) clears pending.
- The button's `disabled`, `aria-busy`, and label read the derived `startPending`; nothing else about the operator-less body changes.
- `startError` is likewise shown only for the server it was produced on: store it as `{ server, message } | null` and render when `startError?.server === server`. <!-- assumed: the error line is server-scoped too — a 502 for runKit rendering under fabKit's button is the same class of lie; trivially reverted to a bare string if judged over-scoped -->

### 2. Target-resolves effect clears pending

```ts
// Success is observed, not assumed: the request is done when the pending
// server's operator window shows up in the sessions payload. Keyed on the
// pending server's own target (not the drawer's current server) so a
// resolution on runKit clears runKit's pending while the drawer shows fabKit.
useEffect(() => {
  if (startPendingServer === null) return;
  const tgt = findOperatorWindow(sessionsByServer.get(startPendingServer) ?? []);
  if (tgt) setStartPendingServer(null);
}, [startPendingServer, sessionsByServer]);
```

- Runs on every sessions-payload change; `findOperatorWindow` is the same derivation `target` uses.
- Because clearing happens on **appearance**, a window that appears and later vanishes leaves the button idle and re-armed — the incident's stuck state cannot recur.

### 3. Bounded fallback re-arm

```ts
// No SSE event says "the start you requested produced no window". The daemon
// answers the POST within its 30 s receipt bound (operatorStartReceiptTimeout)
// and wakes the hub on 202, so a window that has not appeared in 45 s is not
// coming from this request: re-arm with an inline note instead of holding the
// button dead.
const START_OPERATOR_PENDING_TIMEOUT_MS = 45_000;
```

- Armed when `startPendingServer` becomes non-null; cleared on unmount, on a pending change, or when pending clears. On expiry: `setStartPendingServer(null)` and `setStartError({ server, message: "operator did not appear — check the operator terminal or run rk operator" })` for that server.
- Hidden behind the existing `startError` rendering (`role="alert"`, `data-testid="quake-terminal-start-error"`); no new element.
- The `setTimeout` is the only timer; there is no polling (code-quality anti-pattern: no `setInterval` + fetch — SSE stays the truth source). <!-- assumed: 45 s — the daemon's 30 s receipt bound plus SSE wake latency with margin; the value is a named constant, not load-bearing -->

### 4. Tests (`app/frontend/src/components/quake-terminal.test.tsx`)

Extend the "Start operator" block:

- **Window appears then vanishes re-arms the button**: click → 202 → rerender with the operator window (embedded terminal mounts) → rerender with the window gone → the operator-less body shows an **enabled** `Start operator` button (today it would read `starting…` disabled — the incident).
- **Pending is per server**: click on `srv1` → switch the drawer's server (the picker or a pinned-server path the file already tests) to `srv2` with no operator → `srv2`'s button is enabled and reads `Start operator`; switch back → `srv1` still reads `starting…` until its window appears.
- **Target resolution on the pending server clears pending while the drawer shows another server**: pending on `srv1`, drawer on `srv2`, sessions payload gains `srv1`'s operator → switching back to `srv1` shows the embedded terminal, and if `srv1`'s operator is then removed the button is idle.
- **Timeout re-arms with an inline note**: fake timers; click → 202 → no window for 45 s → button enabled, `quake-terminal-start-error` renders the note; a window arriving at 10 s cancels the timer (no note).
- **Stale failure does not re-arm another server**: pending on `srv1`, switch to `srv2`, `srv1`'s POST rejects 502 → `srv2`'s body shows no error line; switching back to `srv1` shows the error and an enabled button.
- Existing cases keep passing unchanged: happy body swap, 409 stays pending (until the payload carries the window), failure re-arm inline.

Playwright: no new e2e — the `operator-compose.spec` / quake specs exercise the operator-less body already; the state paths above are unit-testable and the e2e rig cannot cheaply kill a spawned operator mid-test. <!-- assumed: unit coverage suffices; add an e2e only if the plan finds an existing spec that already spawns and kills an operator -->

### Non-goals

- No change to `POST /api/operator/start`, its 202/409/5xx contract, or `startOperator` in `api/client.ts`.
- No client polling; no new SSE event.
- No change to the operator-less body's layout, the hint text, or the mobile toast path.
- The launch-side fixes (project-root cwd, kickoff visibility, wall wait) are `260913-t7vy`.

## Affected Memory

- `run-kit/ui/quake-terminal`: (modify) the operator-less body requirement and its "Operator-less server" scenario — `starting…` is per server, clears when that server's operator window appears (not on unmount), re-arms when the window later vanishes, and re-arms with an inline note after the 45 s pending timeout; add a Design Decisions entry (pending keyed to the requesting server and cleared on observed appearance, rejected: clear-on-unmount, clear-on-202).

## Impact

- **Frontend**: `app/frontend/src/components/quake-terminal.tsx` (state shape, one effect, one timeout, the button/error render), `quake-terminal.test.tsx` (five new cases). Nothing outside the component; `findOperatorWindow` and the session context are consumed as-is.
- **Backend/API**: none.
- **Docs**: `docs/memory/run-kit/ui/quake-terminal.md`.
- **Gate**: `just test-frontend` (the quake terminal unit suite); `just test-e2e operator-compose.spec` and the quake terminal specs as the regression check that the operator-less body still renders and the palette entry count is unchanged.

## Open Questions

- None blocking. Whether to also surface the sibling change's "kickoff undelivered" toast inside this body is that change's call; this body only needs to be idle and clickable when it should be.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pending is keyed to the requesting server and cleared when that server's operator target resolves, not on unmount | Discussed — user confirmed this change; the incident's two symptoms are exactly the two missing keys | S:90 R:90 A:95 D:95 |
| 2 | Certain | Effect over `sessionsByServer` using `findOperatorWindow` (the existing `target` derivation) | Pattern already in the file (`pendingSend` effect); no new mechanism | S:85 R:95 A:95 D:90 |
| 3 | Certain | Bounded fallback re-arm via one `setTimeout`; no polling | Code-quality rule forbids client polling; SSE cannot signal "no window is coming" | S:75 R:90 A:85 D:75 |
| 4 | Confident | Timeout value 45 s (named constant) | Daemon receipt bound is 30 s plus wake latency; margin is a judgment call | S:60 R:95 A:70 D:60 |
| 5 | Confident | `startError` is server-scoped too, with stale rejections ignored for other servers | Same class of lie; a small extension that could be dropped without affecting the core fix | S:55 R:95 A:75 D:55 |
| 6 | Confident | Unit tests only; no new Playwright spec | Existing quake/operator-compose specs cover the body; killing a spawned operator mid-e2e is expensive | S:65 R:90 A:80 D:70 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
