# Intake: Pre-render Broadcast Envelopes Once Per Event

**Change**: 260811-sqe7-prerender-broadcast-envelopes
**Created**: 2026-08-11

## Origin

One-shot `/fab-new sqe7` from the backlog (no prior conversation). Raw backlog item:

> [sqe7] 2026-07-18: Pre-render state-socket broadcast envelopes once per event, not once per recipient. CONTEXT: deferred optimization from the sockets-v2 merge review (PR #378). Every fan-out event (sessions, session-order, metrics, services, server-order, board-order, version, update-available, status-refresh, board-changed) is enqueued as a kind/typ/data hubEvent on each recipient's channel and each connection's writer pump marshals the IDENTICAL envelope independently (render site: state_ws.go writer pump renderEnvelope; fan-out sites: broadcastGlobalLocked + the per-server loops in poll/broadcastSessionOrder/broadcastBoardChanged in sse.go). C connections = C identical marshals per event. FIX: render once at the broadcast site and ship hubEvent{raw: bytes, typ: name} — the raw bypass already exists (emitError + subscribe ack use it); keep typ populated so the drop-log stays informative. EXCLUDE preview events (per-subscriber filtered subsets, correctly per-conn). Cost today is only envelope-alloc + payload memcpy per recipient — negligible at personal-tool scale, so do this when next touching the hub or if connection counts grow. WATCH: state_ws_test.go's hubEvent.String() + drain helpers assert on kind/typ/data and must learn to decode raw frames. OPTIONAL rider: relay-mux.ts sendData allocates a DataView per outbound keystroke frame just to write the BE u32 stream id — 4 direct byte stores remove it (micro; outbound only, inbound hot path is already alloc-clean).

The code was re-verified against HEAD (2026-08-11) before this intake was written: every site named below exists at the noted line and the described per-recipient marshal is still the current behavior.

## Why

1. **The pain point**: every state-socket fan-out event is enqueued as a *structured* `hubEvent{kind, typ, key, data}` onto each recipient connection's channel, and each connection's writer pump independently calls `renderEnvelope()` (`app/backend/api/state_ws.go:155`, invoked at `state_ws.go:256`) — a `json.Marshal` of the identical `eventFrame` per recipient. With C connected clients, one broadcast costs C identical marshals plus C envelope allocations, where 1 marshal would do.
2. **Consequence of not fixing**: pure waste that scales linearly with connection count. Negligible at personal-tool scale today, but the desktop shell (one persistent WebContentsView per host), multiple browser tabs, and remote hosts all multiply live state-socket connections; the metrics event fires on a steady cadence, and `sessions` fires on every poll delta, so the redundant work sits on the hottest fan-out paths.
3. **Why this approach**: the raw-bypass mechanism already exists and is proven — `renderEnvelope()` returns `e.raw` verbatim when non-nil, and both `emitError` (`sse.go:537`) and the subscribe `ack` (`sse.go:652`) already ride it. Rendering once at the broadcast site and shipping `hubEvent{raw: <rendered>, typ: <name>}` reuses that path with no protocol change: the bytes on the wire are byte-identical, only *where* the marshal happens moves. Keeping `typ` populated on the raw event preserves the drop-log's usefulness (`sendLocked` / `sendConnLockedOK` log `"event", ev.typ` on channel-full drops — `sse.go:485`, `sse.go:551`).

This was explicitly deferred at the sockets-v2 merge review (PR #378) with the note "do this when next touching the hub or if connection counts grow" — this change is that deliberate pickup.

## What Changes

### Backend: pre-render at the fan-out sites (`app/backend/api/sse.go`)

Each **fan-out** site (one event delivered to N recipients) renders the envelope once and enqueues the pre-rendered raw event. The mechanical pattern at every converted site:

```go
// before — structured event, marshalled per recipient in each writer pump
h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "metrics", data: metricsStr})

// after — rendered once here; raw passes through renderEnvelope verbatim.
// typ stays populated so the drop-log line remains informative.
ev := hubEvent{kind: kindGlobal, typ: "metrics", data: metricsStr}
h.broadcastGlobalLocked(hubEvent{raw: ev.renderEnvelope(), typ: ev.typ})
```

(Whether this stays inline or becomes a tiny helper, e.g. `preRendered(ev hubEvent) hubEvent`, is a plan-stage choice — behavior is identical.)

**Sites to convert** (all verified at HEAD):

| Site | File:line | Event type | Fan-out shape |
|------|-----------|------------|---------------|
| `broadcastServerOrder` | `sse.go:765` | `server-order` | global via `broadcastGlobalLocked` |
| `broadcastBoardOrder` | `sse.go:795` | `board-order` | global |
| `broadcastUpdateAvailable` | `sse.go:912` | `update-available` | global |
| `broadcastStatusRefresh` | `sse.go:940` | `status-refresh` | global |
| metrics tick | `sse.go:1516` | `metrics` | global |
| services tick | `sse.go:1530` | `services` | global |
| poll sessions delta loop | `sse.go:1339` | `sessions` | per-server loop over that server's clients |
| `broadcastSessionOrder` | `sse.go:734` | `session-order` | per-server loop |
| `broadcastBoardChanged` | `sse.go:967` | `board-changed` (`boardEventName`) | per-server loop |

For the per-server loops the render happens once *before* the loop, not per iteration — that is the entire point.

**Note on `version`**: the backlog lists `version` among the fan-out events, but at HEAD it has no broadcast site — it is a set-once cached slot delivered only from the single-recipient `replayGlobalSlots` (`sse.go:518`). Nothing to convert; recorded here so the plan doesn't hunt for a nonexistent site.

### Backend: explicitly NOT converted

- **`preview` events** (`sse.go:1023`, `sse.go:1366`) — per-subscriber *filtered subsets*; each recipient's payload genuinely differs, so per-conn structured events are correct. Directed exclusion from the backlog item.
- **Single-recipient sends** — `replayGlobalSlots` (`sse.go:506–521`), the subscribe-time cached replay (`sse.go:434`, `sse.go:439`), and any other one-connection delivery. These render exactly once already; converting them buys nothing and would churn the cached-slot code. The caches keep storing payload strings (`cachedMetricsJSON` etc.), not rendered envelopes.
- **`gone` reap markers** (`sse.go:1476`) — fan per-server but are rare (server death), tiny, and ride the dedicated `gone: true` marker path in `renderEnvelope`; not in the backlog's enumerated list. Left structured.
- **Chat events** — chat delivery is per-subscription via `sendConnLockedOK` with its own reset-on-drop recovery contract; not in the enumerated list, untouched.

### Backend: `hubEvent` doc comment (`app/backend/api/state_ws.go`)

The `raw` field's doc comment (`state_ws.go:144–148`) currently says raw is "Used for the subscribe `ack` frame" — it must be updated to describe the new primary use: pre-rendered broadcast fan-out (plus ack/error), and the convention that raw broadcast events carry `typ` for drop-logging.

### Backend tests: teach the helpers about raw frames (`app/backend/api/state_ws_test.go`)

Directed by the backlog's WATCH note. At HEAD:

- `drainFrames` (`state_ws_test.go:46`) already calls `renderEnvelope()` per event, and raw passes through verbatim as the envelope JSON — `decodeEnvelopes` then parses it fine. **This path survives unchanged.**
- `hubEvent.String()` (`state_ws_test.go:28`) renders the legacy SSE-style debug frame from `typ`/`data` — for a raw event it returns `string(e.raw)` (envelope JSON, not SSE shape). Any test asserting the SSE-style shape on a now-raw event breaks.
- Tests that read `ev.typ` / `ev.data` **directly off the channel** (rather than through `drainFrames`) will see empty `data` on converted events.

The task is an audit: run the suite after conversion, and update `String()` and/or direct-field assertions so every existing test asserts the same *decoded* semantics (op/kind/type/data) regardless of whether the event rode structured or raw. Per the Test Integrity constitution rule, tests adapt to the spec'd behavior (byte-identical wire frames), never the reverse.

### Frontend rider: drop the per-keystroke DataView (`app/frontend/src/lib/relay-mux.ts`)

`sendData` (`relay-mux.ts:410`) allocates a `DataView` per outbound data frame just to write the big-endian u32 stream id:

```ts
// before
new DataView(frame.buffer).setUint32(0, id, false); // big-endian

// after — same bytes, no DataView allocation
frame[0] = (id >>> 24) & 0xff;
frame[1] = (id >>> 16) & 0xff;
frame[2] = (id >>> 8) & 0xff;
frame[3] = id & 0xff;
```

Outbound only (per keystroke); the inbound hot path is already alloc-clean. Wire bytes are identical, so the existing mux-header-decoding test stubs pass unchanged.

## Affected Memory

- `run-kit/architecture`: (modify) The § State Socket / SSE Hub material describes the writer-pump render model ("a per-connection writer pump drains the send channel") and the broadcast helpers; update to record that fan-out events are pre-rendered once at the broadcast site and ride the raw bypass, with `typ` retained for drop-logging.

## Impact

- `app/backend/api/sse.go` — the nine fan-out sites above (mechanical, localized).
- `app/backend/api/state_ws.go` — `hubEvent.raw` doc comment only; `renderEnvelope` itself is untouched (the raw passthrough already exists).
- `app/backend/api/state_ws_test.go` — test-helper/assertion updates per the audit above; possibly `sse_test.go` if it constructs structured events at converted sites.
- `app/frontend/src/lib/relay-mux.ts` — 1-line-to-4-line rider in `sendData`; `relay-mux` unit tests and e2e send-capture stubs decode the same bytes, unchanged.
- **No wire/protocol change** — frames are byte-identical; no API, frontend-consumer, or spec surface moves. No new dependencies. Risk is concentrated in test-helper churn, not runtime behavior.

## Open Questions

*(none — the backlog item is unusually complete: fix shape, exclusions, test watch-list, and the optional rider are all specified)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pre-render at each fan-out site and ship `hubEvent{raw: rendered, typ: name}`, keeping `typ` populated for the drop-log | Directed verbatim by the backlog item; raw bypass already exists and is proven (ack/error) | S:95 R:90 A:95 D:95 |
| 2 | Certain | `preview` events stay per-conn structured | Directed exclusion (per-subscriber filtered subsets — payloads genuinely differ per recipient) | S:95 R:90 A:95 D:100 |
| 3 | Certain | Single-recipient sends (`replayGlobalSlots`, subscribe-time replay, `version` slot) stay structured; caches keep storing payload strings | "Once per event, not once per recipient" targets fan-out; single-recipient sends already render exactly once — converting them is churn with zero win. `version` has no broadcast site at HEAD despite appearing in the backlog list | S:70 R:85 A:90 D:80 |
| 4 | Confident | `gone` reap markers (`sse.go:1476`) stay structured | Not in the backlog's enumerated event list; rare (server death) and rides the dedicated gone-marker render path | S:65 R:85 A:85 D:75 |
| 5 | Confident | Include the optional `relay-mux.ts` `sendData` rider (4 direct byte stores replace the per-frame DataView) | Backlog marks it OPTIONAL — either choice acceptable; it is ~4 lines, byte-identical output, trivially revertible, and this change is the designated pickup for the deferred perf items | S:55 R:90 A:90 D:65 |
| 6 | Certain | Update `state_ws_test.go` helpers/assertions (`String()`, direct `ev.typ`/`ev.data` reads) to decode raw frames; `drainFrames`→`decodeEnvelopes` already survives | Directed by the backlog's WATCH note; verified at HEAD which helpers break and which don't | S:90 R:90 A:90 D:90 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
