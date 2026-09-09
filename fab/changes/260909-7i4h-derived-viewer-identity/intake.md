# Intake: Derived Viewer Identity

**Change**: 260909-7i4h-derived-viewer-identity
**Created**: 2026-09-10

## Origin

> Implement Phase 2 (Derived viewer identity) from `fab/plans/sahil/26-09-09-relay-viewer-liveness-identity-kick.md` — joins relay facts onto list-clients (`api/terminals_ws.go`, `internal/tmux/tmux.go`, `internal/sessions/sessions.go`, frontend `session-row.tsx`/`client.ts`). Phase 1 (liveness deadline, PR #896) is already merged to main and present in this worktree. Then continue the full pipeline.

One-shot invocation against a user-authored plan. The plan is the design of record; this intake carries it across the boundary with the concrete code facts verified at `e9b81c3d` and records two deliberate deviations from the plan text (absolute timestamps instead of second-counters; a text device tag instead of a glyph) in § Assumptions. Phase 3 (kick) is explicitly **out of scope** — the plan defers it until a ghost survives Phases 1+2.

## Why

**Problem.** Every browser terminal tile is one real sized `tmux attach-session` client forked by the daemon (`attachStream`, `pty.StartWithSize`). tmux sizes a window to its narrowest sized client (`window-size smallest` + `aggressive-resize on`, a non-negotiable guard for the tmux ≤3.7c pane-status redraw wedge). When a phone or iPad tab clamps a window, the session card today shows only `2 viewers · 144×91 · 116×37` — grids with no identity. The user cannot tell WHICH device is the narrow one, whether it is a browser tile or an ssh `tmux attach`, where it connects from, or how long it has been silent.

**Consequence of not fixing.** Phase 1's 90 s liveness deadline reaps frozen-tab ghosts, but a live-but-forgotten phone tab is indistinguishable from a legitimate co-viewer, and the operator has no way to name a culprit. If ghosts persist after Phase 1, Phase 3 (kick) needs a pid-level identity to target — Phase 2 is its prerequisite.

**Why this approach.** Constitution §II/§X: identity is **derived** from facts the daemon already holds (the attach process pid it forked, the request's peer address and `User-Agent`, tmux's own `client_created`/`client_activity`), never self-reported by the browser and never persisted. tmux 3.7c `list-clients` exposes `client_pid` — the pid of the `*exec.Cmd` the daemon forked — so an rk-owned attach joins onto its relay stream with **no new tmux state, no new endpoint, no poll**: the enriched `Viewer` rides the existing `/api/sessions` marshal and state-socket `sessions` event. An ssh/local `tmux attach` has no relay stream and stays visible as `kind: "tty"` with tmux-only facts.

## What Changes

### `api/terminals_ws.go` — record what the daemon already knows

**Per-connection facts on `terminalsConn`** (captured once in `handleTerminalsWS` after `Upgrade`, before the read loop):

```go
type terminalsConn struct {
    // ... existing fields ...
    peer        string       // display-only — see peerFromRequest
    device      string       // coarse UA class, derived once — see deviceClass
    connectedAt time.Time
    lastInbound atomic.Int64 // unix seconds; stored where the liveness deadline is re-armed
}
```

- `peerFromRequest(r)`: the first comma-separated hop of `X-Forwarded-For` when the header is non-empty, else the host half of `r.RemoteAddr` (`net.SplitHostPort`; on split failure the raw value). Trimmed. **Code comment required**: `X-Forwarded-For` is trusted for display only, never for authorization — there is no auth decision anywhere on this value.
- `deviceClass(ua string) string` — pure, unit-tested, returns one of the closed set `phone` / `tablet` / `desktop` / `desktop-shell` / `unknown`:
  - `""` → `unknown`
  - contains `Electron/` → `desktop-shell` (Electron's default UA carries its version token; the desktop shell does not override it)
  - contains `iPad` OR (`Android` AND NOT `Mobile`) OR `Tablet` → `tablet`
  - contains `iPhone` OR `iPod` OR `Mobi` (covers `Mobile`) → `phone`
  - otherwise → `desktop`
  - Order matters: `Electron/` first, then tablet, then phone, then desktop. Known limitation (documented in code + memory): iPadOS Safari sends a Macintosh UA by default and classifies as `desktop`.
- `lastInbound` is stored (`time.Now().Unix()`) at exactly the one place the liveness deadline is re-armed after a successful `ReadMessage()` (Phase 1's re-arm on `terminals_ws.go:292`); `connectedAt` is set at upgrade. The existing deadline-expiry `slog.Info` gains `device` and `peer` so the log names the ghost.

**Attach registry** — a `Server`-level `attachRegistry` (mutex-guarded `map[int]sessions.AttachMeta`), constructed in `NewServer` and nil-safe (a zero-value `Server` in tests has no registry; `Lookup` on a nil registry returns `false`):

```go
type attachRegistry struct {
    mu sync.Mutex
    byPID map[int]sessions.AttachMeta
}
func (r *attachRegistry) register(pid int, m sessions.AttachMeta)
func (r *attachRegistry) unregister(pid int)
func (r *attachRegistry) Lookup(pid int) (sessions.AttachMeta, bool) // nil-receiver safe → false
func (r *attachRegistry) snapshot() map[int]sessions.AttachMeta        // read-only copy for tests
```

- **Register** in `attachStream` immediately after the publish-under-lock succeeds (`st.cmd = cmd` at `:617`), keyed by `cmd.Process.Pid`, with `AttachMeta{Peer: tc.peer, Device: tc.device, ConnectedAt: tc.connectedAt, LastInbound: func() int64 { return tc.lastInbound.Load() }}` — `LastInbound` is a **closure onto the conn's atomic**, so the registry never copies a stale idle value; the resolver reads it at fetch time. The publish-race branch (stream already removed) never registers — it kills and reaps the never-published cmd as today.
- **Unregister** from `stream.teardown()` via a new `unregister func()` field on `stream`, set at publish time alongside `st.cmd`, invoked inside the `cleanup.Do` **before** `killAndReapAttach` — so a reused pid can never briefly alias the dead attach. Nil `unregister` (placeholder / control pseudo-stream / failed attach) is a no-op.
- The registry is **not a state store** (Constitution §II): it describes processes the daemon itself forked and dies with them — a fact about live children the daemon already owns. A daemon restart empties it and every attach dies with the daemon anyway (each attach is a child PTY of the daemon). Write this sentence into the memory Design Decision.
- `prodSessionFetcher` gains a `resolver sessions.AttachResolver` field; `NewServer` wires it to `s.attachRegistry.Lookup` when constructing `s.sessions`. Test `Server{}` literals that use `mockSessionFetcher` are untouched.

### `internal/tmux/tmux.go` — widen the client format

`clientFormat` grows from 7 to **11** fields, appended (Design Decision "Append new pane-format fields rather than replace"):

```go
var clientFormat = strings.Join([]string{
    "#{client_tty}",
    "#{client_width}",
    "#{client_height}",
    "#{session_name}",
    "#{session_group}",
    "#{session_group_list}",
    "#{client_flags}",
    "#{client_pid}",      // 7
    "#{client_created}",  // 8  unix seconds
    "#{client_activity}", // 9  unix seconds
    "#{client_termname}", // 10
}, listDelim)
```

`ClientInfo` gains `PID int`, `Created time.Time`, `Activity time.Time`, `TermName string`. `parseClients` keeps its `len(parts) < 7 → drop` floor (a 7-field line from an older tmux still yields a viewer with the zero values — `PID == 0`, zero times, `""`), parses fields 7–10 when present via `strconv.Atoi`/`ParseInt` with a non-parsable value → zero (never a dropped line). The two exclusion classes (non-sizing flags, unsized) are unchanged. The `clientFormat` doc comment is updated to list 11 fields and to note that `client_pid` is the attach process — for an rk-forked attach, the daemon's own child.

### `internal/sessions/sessions.go` — enrich `Viewer`

```go
// AttachMeta is what the relay knows about an attach client it forked. Supplied
// by the api layer through AttachResolver so this package never imports api.
type AttachMeta struct {
    Peer        string
    Device      string
    ConnectedAt time.Time
    LastInbound func() int64 // unix seconds of the conn's last inbound frame, read at fold time
}

// AttachResolver answers "is this list-clients pid one of the relay's forked
// attaches, and what does the relay know about its socket?". nil = every viewer is tty.
type AttachResolver func(pid int) (AttachMeta, bool)

type Viewer struct {
    Width  int `json:"width"`
    Height int `json:"height"`
    // Additive, all omitempty — old frontends ignore them, old backends omit them.
    Kind         string `json:"kind,omitempty"`         // "rk" | "tty"
    PID          int    `json:"pid,omitempty"`
    Device       string `json:"device,omitempty"`       // rk only: phone|tablet|desktop|desktop-shell|unknown
    Peer         string `json:"peer,omitempty"`         // rk only
    CreatedAt    int64  `json:"createdAt,omitempty"`    // unix s, from #{client_created} (both kinds)
    LastActiveAt int64  `json:"lastActiveAt,omitempty"` // unix s: rk → conn lastInbound; tty → #{client_activity}
}
```

- `foldViewers(clients []tmux.ClientInfo, resolve AttachResolver) map[string][]Viewer` — for each surviving client: `Kind = "tty"`, `PID = c.PID`, `CreatedAt = c.Created.Unix()` (0 when zero time), `LastActiveAt = c.Activity.Unix()` (0 when zero). When `c.PID > 0 && resolve != nil` and `resolve(c.PID)` hits: `Kind = "rk"`, `Device`, `Peer` from the meta, `LastActiveAt = meta.LastInbound()` (falls back to `client_activity` if the closure is nil or returns 0). `PID == 0` (older tmux without `client_pid`) is always `tty` — identity degrades, nothing breaks.
- `FetchSessions(ctx, server, provider ActiveWindowProvider, resolve AttachResolver)` — one added parameter, passed through to `foldViewers`. Callers: `prodSessionFetcher` (wired) and tests (pass `nil`).
- **Timestamps, not counters** (deviation from the plan's `ageSec`/`idleSec`): the SSE hub dedups the per-server sessions JSON (`previousJSON`, `sse.go:235`) and rebuilds on a 12 s safety tick; a seconds counter would change on every rebuild and defeat the dedup for every session with an attached viewer. Absolute unix-second timestamps change only when the underlying fact changes (an rk viewer's heartbeat every 30 s, a tty viewer's keystroke). The frontend derives age/idle at render.
- Same marshal, same `/api/sessions` + state-socket `sessions` event — no new endpoint, no poll, no cache.

### Frontend — `types.ts`, `session-row.tsx`, `lib/format.ts`

**`types.ts`** `viewers` element type becomes:

```ts
viewers?: {
  width: number;
  height: number;
  kind?: "rk" | "tty";
  pid?: number;
  device?: "phone" | "tablet" | "desktop" | "desktop-shell" | "unknown";
  peer?: string;
  createdAt?: number;    // unix seconds
  lastActiveAt?: number; // unix seconds
}[];
```

All new keys optional so an old-backend payload still type-checks and renders. (`api/client.ts` carries no `Viewer` type today — the session type lives in `types.ts`; the plan's `client.ts` mention resolves to `types.ts`.)

**`session-row.tsx`** — the card's single `viewersLine` becomes a header line plus **one row per viewer**, still gated at `showViewers` (≥2 sized viewers — the chip and the gate are unchanged, display-only per Constitution §IV/§V):

```
2 viewers
phone   116×37 · 100.64.0.12 · 4m · idle 31s · narrowest
desktop 144×91 · 10.0.0.7 · 2h · idle 3s
```

- Container keeps `data-testid="row-flyout-viewers"`; each row is `data-testid="row-flyout-viewer"`.
- Row segments, joined with ` · `, omitting any segment whose source field is absent: device tag (`device` for `rk`; the literal `tty` for `kind === "tty"`; nothing when `kind` is absent — old backend) · `W×H` (always) · `peer` · age (`formatDuration(now - createdAt)`) · `idle <formatDuration(now - lastActiveAt)>` · `narrowest`.
- `narrowest` marks the viewer(s) with the minimum `width` among the session's viewers (ties all marked) — the clamping client, computed client-side (pure display).
- `now` is `Date.now()/1000` at render; no ticker — every `sessions` push re-renders the row, and an rk viewer's heartbeat pushes one within 30 s. A `narrowest`-only row (old backend: only `width`/`height`) reads `116×37 · narrowest`, so the pre-Phase-2 payload still renders every grid.
- Mobile: rows are display-only text; no new tappable surface.
- No new palette entry (no action was added — display-only).

### Tests

- `internal/tmux/tmux_test.go` `TestParseClients`: 11-field fixtures (pid/created/activity/termname populated), a 7-field legacy line (older tmux → `PID 0`, zero times, still a viewer), a non-numeric `client_pid` → 0, exclusion classes still applied on 11-field lines.
- `api/terminals_ws_test.go`: `deviceClass` table (each class + ordering cases: Electron beats everything; Android+Mobile → phone; Android without Mobile → tablet; iPad → tablet; empty → unknown); `peerFromRequest` (XFF multi-hop → first hop; no XFF → RemoteAddr host; RemoteAddr without port passes through); registry register/unregister lifecycle — a stream that attaches is `Lookup`-able by pid and gone after `teardown()`; `Lookup` on a nil registry is false; the publish-race branch never registers.
- `internal/sessions/sessions_test.go` `TestFoldViewers`: join with a resolver (rk kind + meta), resolver miss → tty with tmux times, `PID 0` → tty even when the resolver would match 0, nil resolver → all tty; `TestProjectSessionViewersJSON`: new keys present for rk, omitted when zero.
- `session-row.test.tsx`: per-viewer rows with all segments; `narrowest` on the min-width row (and tie); old-payload fallback (`{width,height}` only) renders `W×H · narrowest`-style rows with no device/peer/idle; below-2 gate unchanged.
- `just test-backend`, `just test-frontend`, `tsc --noEmit` green.

### Manual verification

- Two devices on one window: the card names the phone row `phone · <peer> · <age> · idle <n>s · narrowest`. An ssh `tmux attach -L <srv>` appears as `tty <W>×<H> · <age> · idle <n>s`. `tmux -L <srv> list-clients -F '#{client_pid} #{client_termname}'` pids match the card's `pid` in the `/api/sessions` payload.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) § Attached-Client Enumeration — 11-field `clientFormat`, the `client_pid` join onto the relay's attach registry, `kind` rk/tty, the degrade path on older tmux; new Design Decisions "Attach registry is a fact about live children, not a state store" and "Viewer timestamps are absolute, never counters (SSE dedup)"; § Terminal Relay — the per-conn peer/device/lastInbound facts and the deadline-expiry log naming the ghost.
- `run-kit/api-and-sockets`: (modify) `/api/sessions` row — the enriched `viewers` element shape (`kind`, `pid`, `device`, `peer`, `createdAt`, `lastActiveAt`, all omitempty), `X-Forwarded-For` display-only trust note.
- `run-kit/ui/sidebar`: (modify) session card viewers rows — per-viewer `row-flyout-viewer` rows, segment order, the `narrowest` marker, the old-payload fallback, the unchanged ≥2 chip gate.

## Impact

- **Backend**: `api/terminals_ws.go` (conn facts, registry, register/unregister seams, log fields), `api/router.go` (`Server.attachRegistry`, `prodSessionFetcher.resolver`, `NewServer` wiring), `internal/tmux/tmux.go` (`clientFormat`, `ClientInfo`, `parseClients`), `internal/sessions/sessions.go` (`AttachMeta`, `AttachResolver`, `Viewer`, `foldViewers`, `FetchSessions` signature). One tmux round-trip unchanged (same `list-clients` call, wider format).
- **Frontend**: `src/types.ts` (viewer shape), `src/components/sidebar/session-row.tsx` (card rows), reuses `lib/format.ts` `formatDuration`. No route, palette, or settings change.
- **Wire compatibility**: additive `omitempty` JSON keys; old frontend ignores them, old backend omits them and the new frontend still renders grids.
- **Payload churn**: an rk viewer's `lastActiveAt` advances every 30 s heartbeat, so a session with a browser viewer re-emits its `sessions` event on the next rebuild after each heartbeat. Accepted — the payload already churns on `agentDuration` strings; a seconds counter would have been strictly worse.
- **Security**: no new subprocess, no new input reaching tmux; `X-Forwarded-For` is display-only and never authorizes anything.
- **Out of scope**: Phase 3 kick endpoint, close code 4005, any relay protocol change, any `relay-mux.ts` change.

## Open Questions

- None blocking. The two plan deviations (timestamps vs counters; text device tag vs glyph) are recorded as Confident assumptions below for the user to veto via `/fab-clarify`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Phase 3 (kick, close code 4005) is out of scope; only Phase 2 ships here | Plan states Phase 3 is optional and gated on ghosts surviving 1+2; user asked for Phase 2 | S:95 R:90 A:95 D:95 |
| 2 | Certain | Identity is derived from daemon-held facts (attach pid, peer, UA, tmux client times); nothing self-reported, nothing persisted | Constitution §II/§X and the plan's stated rule of record | S:95 R:85 A:95 D:95 |
| 3 | Confident | Wire carries absolute unix-second `createdAt`/`lastActiveAt` instead of the plan's `ageSec`/`idleSec`; frontend derives age/idle at render | SSE hub dedups sessions JSON (`sse.go:235`) on a 12 s safety rebuild; counters would re-emit every rebuild for every viewed session. Deviation from plan text, reversible in one file each side | S:80 R:75 A:85 D:75 |
| 4 | Certain | `AttachMeta`/`AttachResolver` live in `internal/sessions`; `FetchSessions` gains a fourth `resolve` parameter; `prodSessionFetcher` carries the wired resolver | api → sessions import direction holds (plan requirement); only two production call paths | S:85 R:80 A:90 D:80 |
| 5 | Certain | `AttachMeta.LastInbound` is a closure over the conn's atomic, read at fold time, not a copied value | A copied value would freeze idle at attach time; the closure costs nothing and needs no registry writes per heartbeat | S:70 R:85 A:90 D:85 |
| 6 | Certain | Unregister runs inside `stream.teardown`'s `cleanup.Do` before `killAndReapAttach`, via an `unregister func()` set at publish | `stream` has no back-pointer to its conn or server; ordering before kill prevents pid-reuse aliasing | S:70 R:85 A:85 D:80 |
| 7 | Certain | `deviceClass` closed set + ordering (Electron → tablet → phone → desktop → unknown); iPadOS-as-Mac limitation documented, not worked around | Plan names the classes; a coarse UA sniff is the only signal available without self-reporting; the limitation is inherent to Safari's default UA | S:75 R:90 A:80 D:70 |
| 8 | Confident | `desktop-shell` is detected by the `Electron/` UA token; no custom UA is set in the desktop shell | grep of `app/desktop/src` finds no UA override; Electron's default UA carries the token | S:65 R:90 A:75 D:80 |
| 9 | Certain | Peer = first hop of `X-Forwarded-For` else `RemoteAddr` host, display-only | Plan's exact rule; no existing forwarded-header handling to conflict with | S:85 R:90 A:85 D:85 |
| 10 | Certain | Card rows use a text device tag (`phone`, `tablet`, `desktop`, `desktop-shell`, `tty`) rather than an icon glyph | Monospace, testable via text content, zero new icon assets; plan's "glyph" reads as illustrative. Cosmetic, trivially reversible | S:60 R:95 A:85 D:70 |
| 11 | Certain | `narrowest` is computed client-side as min `width` with ties all marked; no ticker for age/idle, values refresh on each `sessions` push | Pure display fact; a ticker adds state for a transient hover card whose data refreshes within one heartbeat anyway | S:70 R:90 A:85 D:75 |
| 12 | Certain | `parseClients` keeps the 7-field floor; fields 7–10 parsed when present, unparsable → zero, `PID 0` → `tty` | Plan's degrade rule for older tmux; mirrors the existing "append fields, tolerate short lines" convention | S:80 R:85 A:90 D:85 |
| 13 | Certain | `types.ts` (not `api/client.ts`) is the frontend file that changes — it owns the session/viewer type today | Verified: `client.ts` has no viewer type; plan's file name was approximate | S:80 R:95 A:95 D:90 |

13 assumptions (11 certain, 2 confident, 0 tentative, 0 unresolved).
