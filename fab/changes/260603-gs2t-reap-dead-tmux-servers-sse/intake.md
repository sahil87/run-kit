# Intake: Reap Dead Tmux Servers from SSE Poll Set

**Change**: 260603-gs2t-reap-dead-tmux-servers-sse
**Created**: 2026-06-03
**Status**: Draft

## Origin

Initiated from a `/fab-discuss` session investigating a runtime symptom: after killing a
tmux server, the rk daemon never stops polling its now-deleted socket. The user supplied
~40 seconds of daemon logs showing a steady WARN drumbeat every ~2.5s:

> `time=2026-06-03T10:04:20.244+05:30 level=WARN msg="SSE poll error" err="exit status 1: error connecting to /tmp/tmux-1001/utils (No such file or directory)" server=utils`

The session traced the full lifecycle across backend SSE polling, the `/api/servers`
enumeration, and the frontend `SessionProvider` / route guard via three read-only Explore
sub-agents. The root cause and a four-part fix were established **before** this intake, and
two design decisions were put to the user:

1. **Reap vs. quiesce a dead server** — user chose: *"A dead server should be removed from
   the poll set entirely. No tmux socket = no polling."* (rejected the backoff/quiesce
   alternative).
2. **Signal style** — user chose: *emit a one-time `server-gone` SSE event* (rejected the
   silent refresh-only approach for its ~3s latency and reliance on the onerror fallback).
3. User also explicitly requested the frontend be wired to react (*"yes"*) and the shared
   sentinel refactor (*"ok"*).

Interaction mode: conversational discussion → code trace → two-question decision gate → this intake.

## Why

**The problem.** The SSE poll goroutine in `app/backend/api/sse.go` (`sseHub.poll`) derives
its per-tick work-list from the `h.clients` map. A server name enters that map exactly once —
when a browser opens `GET /api/sessions/stream?server=<name>` — and only leaves when the
*last client for that server disconnects* (`removeClient`). Killing the tmux server does **not**
disconnect the browser's `EventSource`, so the dead server lingers in `h.clients`. Every tick,
`FetchSessions` shells out to `tmux -L <name> list-sessions`, the socket is gone, tmux exits 1,
and the loop logs `"SSE poll error"` then `continue`s — re-polling the corpse forever. There is
**no server-liveness re-check after the initial connect**.

**The consequence if unfixed.** (1) Log noise — a steady WARN-per-tick that buries real signal
and makes incident triage harder (the very `utils` incident referenced in the existing
`sse.go:477-507` comment). (2) Wasted work — a subprocess spawn + failed connect every ~2.5s per
dead server, indefinitely, for the life of the daemon. (3) A stale UX — a user viewing the dead
server sees frozen session data with no indication the server is gone, because the frontend never
re-queries `/api/servers` after mount.

**Why this approach.** The codebase already has everything needed; the bug is purely a *missing
re-check*, on both ends:
- `GET /api/servers` already self-heals — enumeration is socket-file-based
  (`ListServers → ScanSocketDir → probeServerAlive`) with **no in-memory registry**, so a killed
  server drops out of the list on the next request. The frontend pool-diff
  (`session-context.tsx:357-369`) and `resolveServerView` guard (`app.tsx:143-153`) already turn a
  vanished server into a `not-found` view. The frontend simply never *asks again*.
- The dead-server error sentinels already exist as unexported `matchesServerDeadText` in
  `internal/tmuxctl/client.go`.

So the fix is to (a) reuse the existing sentinel logic via a single shared helper, (b) make the
poll loop reap on that error, and (c) make the frontend re-query on a `server-gone` signal +
onerror. The alternative — backoff/quiesce instead of full reaping — was rejected by the user:
a dead socket has no reason to stay in the poll set, and a reconnecting client re-registers it
naturally via `addClient`.

## What Changes

### Backend §1 — Shared dead-server detection helper (`internal/tmux/`)

The three sentinel substrings currently live unexported in `internal/tmuxctl/client.go`:

```go
const (
    noServerRunningText = "no server running"
    failedToConnectText = "failed to connect"
    noSocketFileText    = "No such file or directory"
)

func matchesServerDeadText(s string) bool {
    if s == "" {
        return false
    }
    return strings.Contains(s, noServerRunningText) ||
        strings.Contains(s, failedToConnectText) ||
        strings.Contains(s, noSocketFileText)
}
```

Lift the single source of truth into `internal/tmux/` as an exported helper that accepts an
`error` (the form the call sites actually hold):

```go
// IsServerGone reports whether err indicates the tmux server's socket is gone —
// killed, never started, or otherwise unreachable. Matches tmux's stderr for a
// missing/dead socket across the known phrasings.
func IsServerGone(err error) bool {
    if err == nil {
        return false
    }
    s := err.Error()
    return strings.Contains(s, "no server running") ||
        strings.Contains(s, "failed to connect") ||
        strings.Contains(s, "No such file or directory")
}
```

Refactor `tmuxctl.matchesServerDeadText` to delegate to `tmux.IsServerGone` (constructing an
`error` from its string input, or — cleaner — having `IsServerGone` retain a string-accepting
inner so both call shapes share one substring list). The exact internal shape is an
implementation detail; the requirement is **one definition of the sentinel set** (Constitution III:
Wrap, Don't Reinvent — no drift between the two layers).

### Backend §2 — Reap dead servers in the SSE poll loop (`api/sse.go`)

In `sseHub.poll`, the per-tick `servers` slice is snapshotted under `RLock` (sse.go:384-388), then
iterated. Today the fetch-error branch is (sse.go:405-410):

```go
result, err = h.fetcher.FetchSessions(context.Background(), server)
if err != nil {
    slog.Warn("SSE poll error", "err", err, "server", server)
    continue
}
```

New behavior — when the error is a dead-server error, mark the server for reaping instead of
re-polling it forever:

```go
result, err = h.fetcher.FetchSessions(context.Background(), server)
if err != nil {
    if tmux.IsServerGone(err) {
        slog.Info("SSE: tmux server gone, reaping from poll set", "server", server)
        deadServers = append(deadServers, server) // collected during the loop
    } else {
        slog.Warn("SSE poll error", "err", err, "server", server)
    }
    continue
}
```

After the per-server loop completes, for each reaped server: (1) emit a one-time
`event: server-gone` to that server's currently-registered clients, then (2) delete the server
from `h.clients` **and** all associated per-server maps so no stale state leaks:

- `h.clients[server]`
- `h.cache[server]`
- `h.previousJSON[server]`
- `h.previousRealSessions[server]`
- `h.orderBootstrapAttempts[server]`
- `h.previousOrderJSON[server]`
- `perServerGen[server]` / `eventDrivenServers[server]` (the loop-local maps)

```go
// after the `for _, server := range servers` loop, before metrics broadcast:
if len(deadServers) > 0 {
    h.mu.Lock()
    for _, server := range deadServers {
        goneEvent := []byte("event: server-gone\ndata: {}\n\n")
        for _, c := range h.clients[server] {
            select {
            case c.ch <- goneEvent:
            default:
            }
        }
        delete(h.clients, server)
        delete(h.cache, server)
        delete(h.previousJSON, server)
        delete(h.previousRealSessions, server)
        delete(h.orderBootstrapAttempts, server)
        delete(h.previousOrderJSON, server)
        delete(perServerGen, server)
        delete(eventDrivenServers, server)
    }
    h.mu.Unlock()
}
```

**Concurrency note (must-honor):** the work-list is read under `RLock`; the reap mutates the maps
and so requires the write lock. Collect dead servers into a loop-local slice *during* iteration and
perform all deletes *after* the iteration under a single `h.mu.Lock()` — never delete from a map
mid-range over its snapshot, and never hold the write lock across `FetchSessions`. Verify the exact
field names of the per-server maps against the live `sseHub` struct before writing the deletes
(the list above is from the trace and must be reconciled with the struct definition).

**Re-registration is free:** if a client later opens `?server=<name>` again (e.g. the user
restarts the server and navigates back), `addClient` re-adds it to `h.clients` and the existing
`!h.polling` guard re-spawns the goroutine if it had exited — no extra wiring needed.

### Frontend §3 — Handle `server-gone` in `SessionProvider` (`session-context.tsx`)

Where the named event listeners are registered (~sse.go-frontend lines 282-342), add a handler for
the new event. It must mirror the existing pool-diff cleanup (lines 357-369): clear the disconnect
timer, close the `EventSource`, remove the pool entry, delete the server's state slice, then call
`refreshServers()` to re-query `/api/servers`:

```ts
es.addEventListener("server-gone", () => {
  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
  entry.es.close();
  poolRef.current.delete(name);
  setSlicesByServer((prev) => {
    if (!prev.has(name)) return prev;
    const next = new Map(prev);
    next.delete(name);
    return next;
  });
  refreshServers();
});
```

Once `refreshServers()` lands (the dead server already absent from `/api/servers`), the servers
list shrinks. If the user is currently viewing the gone server, `resolveServerView(server, servers,
pendingServer, serversLoaded)` returns `not-found` (serversLoaded is already `true` post-mount), and
the existing `ServerNotFound` component renders — "No tmux server named **<name>** was found" with a
"Go to server list" link. **No new UI component** is introduced.

### Frontend §4 — onerror fallback (`session-context.tsx` ~line 344)

The catastrophic case: the socket dies so abruptly the backend's poll never gets a tick in to emit
`server-gone` (or the daemon itself is mid-restart). Today `es.onerror` only arms a 3s
`markDisconnected` timer. Augment the disconnect path to also re-query the server list, so the
list-shrink → guard-flip path still eventually fires:

```ts
const markDisconnected = () => {
  updateSlice(name, { isConnected: false });
  refreshServers(); // fallback: catch deaths the backend couldn't signal
};
```

This is the belt-and-suspenders layer: the `server-gone` event is the fast path (sub-second); the
onerror refresh is the guaranteed-eventual path (~3s). First to fire wins; both are idempotent.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document the SSE poll-loop server-reaping lifecycle — a server
  enters the poll set on client connect and is now *reaped* on a dead-server fetch error
  (`tmux.IsServerGone`), not merely on last-client-disconnect. Note the shared `IsServerGone`
  sentinel helper as the single source of dead-server detection across `tmux` and `tmuxctl`.
- `run-kit/ui-patterns`: (modify) Document the `server-gone` SSE event and how it (plus the onerror
  fallback) drives `refreshServers()` → servers-list shrink → `resolveServerView` flip to the
  existing `not-found` view. Extends the existing three-way server route guard documentation.

## Impact

**Backend:**
- `app/backend/internal/tmux/` — new exported `IsServerGone(err error) bool` (+ unit test).
- `app/backend/internal/tmuxctl/client.go` — `matchesServerDeadText` refactored to delegate to the
  shared helper; behavior unchanged.
- `app/backend/api/sse.go` — `sseHub.poll` reap logic + `server-gone` emission; imports `internal/tmux`.

**Frontend:**
- `app/frontend/src/contexts/session-context.tsx` — `server-gone` listener + `markDisconnected`
  fallback. No new types, no new endpoints, no new components.
- `app/frontend/src/app.tsx` — unchanged (existing `resolveServerView` / `ServerNotFound` reused).

**APIs / contracts:** New SSE event type `server-gone` on the existing
`GET /api/sessions/stream` channel (additive — joins `sessions`, `metrics`, `session-order`,
`board-changed`, `: heartbeat`). No HTTP endpoints added or changed (Constitution IX preserved —
GET/POST only, no new verbs).

**Constitution touchpoints:** III (single sentinel definition — Wrap, Don't Reinvent), VI (this is
cleanup of *stale polling state*, not management of tmux itself — the server is already dead; the
daemon merely stops chasing it), IX (no new HTTP verbs/endpoints).

## Open Questions

- None blocking. The two design decisions (full reap; emit `server-gone`) were resolved with the
  user during discussion. The only implementation-time verification needed is reconciling the exact
  per-server map field names on the `sseHub` struct (captured as a must-honor note in §2), which is
  a code-reading task, not a decision.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Dead servers are reaped from the poll set entirely ("no socket = no polling"), not backed-off/quiesced | Discussed — user chose full reaping over the backoff alternative explicitly | S:98 R:70 A:80 D:95 |
| 2 | Certain | Backend emits a one-time `event: server-gone` SSE event before reaping | Discussed — user chose the event over silent refresh-only for responsiveness | S:98 R:75 A:80 D:95 |
| 3 | Certain | Dead-server detection sentinels are consolidated into one exported `tmux.IsServerGone`; `tmuxctl` delegates to it | Discussed — user approved the shared-helper refactor; Constitution III mandates one definition | S:95 R:75 A:90 D:90 |
| 4 | Confident | Frontend reuses the existing `ServerNotFound` guard via `refreshServers()` — no new UI component | Code trace established `resolveServerView`+pool-diff already turn a vanished server into not-found; only the re-query was missing | S:90 R:85 A:90 D:88 |
| 5 | Confident | An onerror→`refreshServers()` fallback is added alongside the event path | Discussed — covers catastrophic socket death the backend can't signal; cheap and idempotent | S:85 R:88 A:85 D:85 |
| 6 | Confident | `server-gone` carries an empty `{}` data payload (event name is the whole signal) | Mirrors `board-changed` (no meaningful payload); the server name is implicit in the per-server stream | S:80 R:90 A:85 D:80 |
| 7 | Confident | All per-server maps (`cache`, `previousJSON`, `previousRealSessions`, `orderBootstrapAttempts`, `previousOrderJSON`) are cleared on reap, not just `h.clients` | Leaving stale per-server state risks incorrect diffs/bootstrap on re-registration; thorough cleanup is the safe default | S:82 R:78 A:88 D:80 |
| 8 | Certain | This is a `fix:` change type | Symptom is a behavioral bug (runaway polling) with an identified root cause; matches the `fix` keyword rule | S:99 R:90 A:95 D:99 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
