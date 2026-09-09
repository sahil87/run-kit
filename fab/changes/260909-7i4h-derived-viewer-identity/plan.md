# Plan: Derived Viewer Identity

**Change**: 260909-7i4h-derived-viewer-identity
**Intake**: `intake.md`

## Requirements

### Relay: Per-connection facts (`api/terminals_ws.go`)

#### R1: Capture peer, device, connectedAt, lastInbound on the terminals connection
`terminalsConn` MUST carry `peer string`, `device string`, `connectedAt time.Time`, and `lastInbound atomic.Int64` (unix seconds). `peer` and `device` SHALL be derived once in `handleTerminalsWS` after `Upgrade` from the upgrade request; `connectedAt` SHALL be set at upgrade; `lastInbound` SHALL be stored at the single site where the liveness read deadline is re-armed after a successful `ReadMessage()`. The deadline-expiry `slog.Info` MUST include `device` and `peer`.

- **GIVEN** a browser upgrades `/ws/terminals` with `User-Agent: ... iPhone ... Mobile ...` from `X-Forwarded-For: 100.64.0.12, 10.0.0.1`
- **WHEN** the connection is established
- **THEN** `tc.peer == "100.64.0.12"`, `tc.device == "phone"`, `tc.connectedAt` is set
- **AND** every inbound frame (data, control op, ping) updates `tc.lastInbound` to the current unix second

#### R2: `deviceClass` is a pure closed-set classifier
`deviceClass(ua string) string` MUST return exactly one of `phone`, `tablet`, `desktop`, `desktop-shell`, `unknown`, evaluated in this order: empty → `unknown`; contains `Electron/` → `desktop-shell`; contains `iPad` OR (`Android` AND NOT `Mobile`) OR `Tablet` → `tablet`; contains `iPhone` OR `iPod` OR `Mobi` → `phone`; else `desktop`. The known iPadOS-Safari-as-Macintosh limitation MUST be stated in the function's doc comment.

- **GIVEN** UA `Mozilla/5.0 (Linux; Android 14) ... Mobile Safari` **THEN** `phone`
- **GIVEN** UA `Mozilla/5.0 (Linux; Android 14) ... Safari` (no `Mobile`) **THEN** `tablet`
- **GIVEN** UA `... Electron/31.0.0 ...` **THEN** `desktop-shell` regardless of other tokens
- **GIVEN** UA `""` **THEN** `unknown`
- **GIVEN** UA `Mozilla/5.0 (Macintosh; Intel Mac OS X) ... Safari` **THEN** `desktop`

#### R3: `peerFromRequest` prefers the first forwarded hop, display-only
`peerFromRequest(r *http.Request) string` MUST return the trimmed first comma-separated element of `X-Forwarded-For` when that header is non-empty, else the host half of `r.RemoteAddr` via `net.SplitHostPort` (the raw `RemoteAddr` when the split fails). A code comment at the function MUST state that `X-Forwarded-For` is trusted for display only and never for authorization.

- **GIVEN** `X-Forwarded-For: 100.64.0.12, 10.0.0.1` **THEN** `100.64.0.12`
- **GIVEN** no `X-Forwarded-For` and `RemoteAddr` `10.0.0.7:51234` **THEN** `10.0.0.7`
- **GIVEN** no `X-Forwarded-For` and `RemoteAddr` `10.0.0.7` (no port) **THEN** `10.0.0.7`

### Relay: Attach registry

#### R4: A Server-level registry maps attach pids to relay facts
`api` SHALL define `attachRegistry` (mutex-guarded `map[int]sessions.AttachMeta`) with `register(pid, meta)`, `unregister(pid)`, `Lookup(pid) (sessions.AttachMeta, bool)`, and `snapshot() map[int]sessions.AttachMeta`. `Server` gains an `attachRegistry *attachRegistry` field constructed in `NewServer`. `Lookup` on a nil `*attachRegistry` MUST return `(zero, false)` so test `Server{}` literals need no registry.

- **GIVEN** a `Server` built by `NewServer` **WHEN** `attachStream` publishes an attach with pid P **THEN** `s.attachRegistry.Lookup(P)` returns `(meta, true)`
- **GIVEN** `var r *attachRegistry` (nil) **WHEN** `r.Lookup(1)` **THEN** `false` and no panic

#### R5: Register at publish, unregister in teardown before kill
`attachStream` MUST register `cmd.Process.Pid` immediately after the publish-under-lock succeeds (`st.cmd = cmd`), with `AttachMeta{Peer: tc.peer, Device: tc.device, ConnectedAt: tc.connectedAt, LastInbound: closure over tc.lastInbound.Load}`. The publish-race branch (stream already removed) MUST NOT register. `stream` gains `unregister func()`, set at publish; `stream.teardown()` MUST invoke it (nil-safe) inside `cleanup.Do` **before** `killAndReapAttach`.

- **GIVEN** a stream whose attach published with pid P **WHEN** `st.teardown()` runs **THEN** `Lookup(P)` is false before the process is killed and waited
- **GIVEN** the stream was closed during attach (publish-race branch) **THEN** the registry never contains that pid

#### R6: The registry is wired into the production session fetcher
`prodSessionFetcher` gains `resolver sessions.AttachResolver`; `NewServer` MUST set it to `s.attachRegistry.Lookup` (adapted to the `AttachResolver` signature). `FetchSessions` receives it as the resolver argument.

- **GIVEN** production wiring **WHEN** `/api/sessions` is served with a browser viewer attached **THEN** that viewer has `kind: "rk"`

### tmux: Widened client format (`internal/tmux/tmux.go`)

#### R7: `clientFormat` carries 11 fields and `ClientInfo` the four new facts
`clientFormat` MUST append `#{client_pid}`, `#{client_created}`, `#{client_activity}`, `#{client_termname}` after the existing seven fields (11 total). `ClientInfo` gains `PID int`, `Created time.Time`, `Activity time.Time`, `TermName string`. The doc comment MUST list all 11 fields and note that `client_pid` is the attach process (for an rk-forked attach, the daemon's own child).

- **GIVEN** an 11-field line `pts/3\t144\t91\tmain\t\t\tattached,focused\t4242\t1757500000\t1757500300\txterm-256color` **WHEN** parsed **THEN** `PID 4242`, `Created` = unix 1757500000, `Activity` = unix 1757500300, `TermName xterm-256color`

#### R8: `parseClients` tolerates short and malformed trailing fields
`parseClients` MUST keep the `len(parts) < 7 → drop` floor; fields 7–10 are parsed only when present; a non-numeric pid/created/activity yields the zero value, never a dropped line. The two exclusion classes (non-sizing flags, unsized) MUST apply unchanged to 11-field lines.

- **GIVEN** a 7-field legacy line **THEN** the viewer survives with `PID 0`, zero `Created`/`Activity`, empty `TermName`
- **GIVEN** an 11-field line with `client_pid` `abc` **THEN** `PID 0`, line kept
- **GIVEN** an 11-field line whose flags include `control-mode` **THEN** dropped

### Sessions: Viewer enrichment (`internal/sessions/sessions.go`)

#### R9: `AttachMeta` and `AttachResolver` live in `internal/sessions`
`internal/sessions` SHALL export `AttachMeta{Peer, Device string; ConnectedAt time.Time; LastInbound func() int64}` and `AttachResolver func(pid int) (AttachMeta, bool)`. `internal/sessions` MUST NOT import `api`.

- **GIVEN** the package graph **WHEN** `go build ./...` **THEN** `api → sessions` is the only direction between the two

#### R10: `Viewer` carries additive omitempty identity fields
`Viewer` gains `Kind string` (`json:"kind,omitempty"`, values `rk`|`tty`), `PID int` (`pid,omitempty`), `Device string` (`device,omitempty`), `Peer string` (`peer,omitempty`), `CreatedAt int64` (`createdAt,omitempty`, unix seconds), `LastActiveAt int64` (`lastActiveAt,omitempty`, unix seconds). `Width`/`Height` are unchanged.

- **GIVEN** a `Viewer{Width:144, Height:91}` **WHEN** marshalled **THEN** the JSON is exactly `{"width":144,"height":91}`
- **GIVEN** an rk viewer **THEN** JSON contains `kind`, `pid`, `device`, `peer`, `createdAt`, `lastActiveAt`

#### R11: `foldViewers` joins list-clients onto the resolver
`foldViewers(clients []tmux.ClientInfo, resolve AttachResolver) map[string][]Viewer`: every surviving client yields `Kind "tty"`, `PID`, `CreatedAt = Created.Unix()` (0 for zero time), `LastActiveAt = Activity.Unix()` (0 for zero time). When `c.PID > 0 && resolve != nil` and the resolver hits, the viewer becomes `Kind "rk"` with `Device`, `Peer` from the meta and `LastActiveAt = meta.LastInbound()` (falling back to `client_activity` when the closure is nil or returns 0). `PID == 0` is always `tty`. The group-key join (`SessionKey`) is unchanged.

- **GIVEN** clients `[{PID 4242, …}, {PID 0, …}]` and a resolver hitting 4242 **THEN** the first is `rk` with the meta's device/peer, the second is `tty`
- **GIVEN** `resolve == nil` **THEN** every viewer is `tty`
- **GIVEN** a resolver that would match pid 0 **THEN** the `PID 0` viewer is still `tty`

#### R12: `FetchSessions` accepts the resolver
`FetchSessions(ctx, server, provider ActiveWindowProvider, resolve AttachResolver)` passes `resolve` through to `foldViewers`. Existing test callers pass `nil`. No other behavior of `FetchSessions` changes (one `list-clients` round-trip, log-and-continue on failure).

- **GIVEN** `listClientsFn` fails **THEN** sessions carry no viewers and the fetch succeeds, as before

#### R13: Absolute timestamps, never counters
The wire MUST carry `createdAt`/`lastActiveAt` as absolute unix seconds; no `ageSec`/`idleSec` counter field exists. (SSE hub dedups sessions JSON; a counter would defeat it on every safety rebuild.)

- **GIVEN** two consecutive `FetchSessions` calls with no inbound frame and no tmux activity between them **THEN** the marshalled `viewers` are byte-identical

### Frontend: Types and session card (`src/types.ts`, `src/components/sidebar/session-row.tsx`)

#### R14: Viewer type widened with optional identity keys
The `viewers` element type in `types.ts` gains optional `kind?: "rk" | "tty"`, `pid?: number`, `device?: "phone" | "tablet" | "desktop" | "desktop-shell" | "unknown"`, `peer?: string`, `createdAt?: number`, `lastActiveAt?: number`. `width`/`height` stay required.

- **GIVEN** an old-backend payload `{width, height}` **THEN** it type-checks and renders

#### R15: One card row per viewer, gated at ≥2, display-only
Behind the unchanged `showViewers` (≥2) gate, the card renders a header line `N viewers` inside the existing `data-testid="row-flyout-viewers"` container plus one `data-testid="row-flyout-viewer"` row per viewer. Row segments joined by ` · `, omitting a segment whose source field is absent: device tag (`device` when `kind === "rk"`; literal `tty` when `kind === "tty"`; nothing when `kind` absent) · `W×H` (always) · `peer` · age `formatDuration(now − createdAt)` · `idle ` + `formatDuration(now − lastActiveAt)` · `narrowest`. `now` is `Date.now()/1000` at render; no ticker. The count chip is unchanged. No new action, palette entry, or tappable surface.

- **GIVEN** viewers `[{116×37, rk, phone, 100.64.0.12, createdAt now−240, lastActiveAt now−31}, {144×91, tty, createdAt now−7200, lastActiveAt now−3}]`
- **WHEN** the card renders
- **THEN** rows read `phone · 116×37 · 100.64.0.12 · 4m · idle 31s · narrowest` and `tty · 144×91 · 2h · idle 3s`

#### R16: `narrowest` marks the minimum-width viewer(s)
Every viewer whose `width` equals the minimum `width` across the session's viewers carries the trailing `narrowest` segment (ties all marked). Computed client-side.

- **GIVEN** widths `[116, 144, 116]` **THEN** rows 1 and 3 carry `narrowest`, row 2 does not

#### R17: Old-payload rows still render
A viewer with only `width`/`height` renders `W×H` plus `narrowest` when applicable, with no device/peer/age/idle segments, and the ≥2 gate and chip behave exactly as before.

- **GIVEN** viewers `[{144×91}, {116×37}]` **THEN** rows read `144×91` and `116×37 · narrowest`; the chip shows `2`
- **GIVEN** one viewer **THEN** no chip and no rows

### Non-Goals

- Phase 3 kick endpoint, close code 4005, and any `relay-mux.ts` / `terminal-client.tsx` change — deferred until a ghost survives Phases 1+2.
- Any new HTTP route, poll, cache, or persisted state.
- An age/idle ticker in the card — values refresh on each `sessions` push.

### Design Decisions

#### Attach registry is a fact about live children, not a state store
**Decision**: `api.attachRegistry` is an in-memory map keyed by the attach pid the daemon itself forked; entries are written at publish and removed at teardown before the process is killed.
**Why**: Constitution §II forbids state stores, and this is not one — it describes processes the daemon owns and dies with them. A daemon restart empties it and kills every attach anyway (each is a child PTY). No request-time read path treats it as a source of truth for anything tmux does not also report; `list-clients` remains the enumeration, the registry only annotates pids tmux already listed.
**Rejected**: writing identity into `@rk_*` tmux options per client — tmux has no per-client user options, and it would push self-reported state where a derivation exists (§X).
*Introduced by*: 260909-7i4h-derived-viewer-identity

#### Viewer timestamps are absolute unix seconds, never counters
**Decision**: `Viewer.CreatedAt`/`LastActiveAt` carry unix seconds; the frontend derives age and idle at render with `formatDuration`.
**Why**: the SSE hub dedups the per-server sessions JSON (`previousJSON`) and rebuilds on a 12 s safety tick. A seconds counter changes on every rebuild and would re-emit every viewed session's snapshot to every state-socket client forever. Timestamps change only when the fact changes.
**Rejected**: the plan's `ageSec`/`idleSec` — strictly worse for the dedup; identical information.
*Introduced by*: 260909-7i4h-derived-viewer-identity

#### Device identity is a text tag derived once from the User-Agent
**Decision**: a five-value closed set (`phone`/`tablet`/`desktop`/`desktop-shell`/`unknown`) classified server-side once at upgrade; the raw UA string never leaves the daemon, and the card renders the tag as text.
**Why**: coarse class is all the card needs to name a culprit; keeping the UA off the wire avoids a fingerprint leak into every sessions snapshot; a text tag is monospace-native and testable by text content.
**Rejected**: sending the UA string for client-side classification (leaks, larger payload, drifts per frontend build); icon glyphs (new assets, untestable by text).
*Introduced by*: 260909-7i4h-derived-viewer-identity

## Tasks

### Phase 1: Backend — tmux and sessions layers

- [x] T001 Widen `clientFormat` to 11 fields, add `PID`/`Created`/`Activity`/`TermName` to `ClientInfo`, extend `parseClients` (tolerant parsing of fields 7–10, 7-field floor kept, exclusions unchanged), update the format doc comment in `app/backend/internal/tmux/tmux.go` <!-- R7, R8 -->
- [x] T002 Extend `TestParseClients` in `app/backend/internal/tmux/tmux_test.go`: 11-field fixture with all four new facts, 7-field legacy line → zero values, non-numeric `client_pid` → 0, `control-mode` on an 11-field line still dropped <!-- R8 -->
- [x] T003 Add `AttachMeta`, `AttachResolver`, the six new `Viewer` fields, the resolver-aware `foldViewers(clients, resolve)` join, and the fourth `FetchSessions` parameter in `app/backend/internal/sessions/sessions.go`; update the `Viewers` field doc comment <!-- R9, R10, R11, R12, R13 -->
- [x] T004 Extend `TestFoldViewers` and `TestProjectSessionViewersJSON` in `app/backend/internal/sessions/sessions_test.go`: resolver hit → `rk` with meta and `LastInbound` closure value; miss → `tty` with tmux times; `PID 0` → `tty` even when the resolver would match; nil resolver → all `tty`; JSON omits zero fields and emits all six for rk; update every existing `FetchSessions(...)` test call to pass `nil` <!-- R11, R12, R13 -->

### Phase 2: Backend — relay facts and registry

- [x] T005 Add `peer`/`device`/`connectedAt`/`lastInbound` to `terminalsConn`, implement `peerFromRequest` (display-only comment) and `deviceClass` (closed set, ordering, iPadOS caveat in doc comment), populate them in `handleTerminalsWS`, store `lastInbound` at the deadline re-arm, add `device`/`peer` to the expiry log in `app/backend/api/terminals_ws.go` <!-- R1, R2, R3 -->
- [x] T006 Add `attachRegistry` (register/unregister/Lookup nil-safe/snapshot) and `stream.unregister`; register after publish in `attachStream` (not in the publish-race branch); call `unregister` in `stream.teardown()` before `killAndReapAttach`; add `Server.attachRegistry` + `prodSessionFetcher.resolver` and wire both in `NewServer` in `app/backend/api/terminals_ws.go` and `app/backend/api/router.go` <!-- R4, R5, R6 -->
- [x] T007 Add tests in `app/backend/api/terminals_ws_test.go`: `deviceClass` table (all five classes + Electron-beats-all, Android±Mobile, iPad, empty); `peerFromRequest` (XFF multi-hop, RemoteAddr with/without port); registry lifecycle (register → Lookup true → teardown → Lookup false, unregister precedes kill), nil-registry Lookup, publish-race never registers <!-- R2, R3, R4, R5 -->

### Phase 3: Frontend — types and card rows

- [x] T008 [P] Widen the `viewers` element type with the six optional identity keys in `app/frontend/src/types.ts` (doc comment: kinds, device set, unix-second timestamps, old-backend absence) <!-- R14 -->
- [x] T009 Replace the single `viewersLine` with the `N viewers` header + per-viewer `row-flyout-viewer` rows (segment order, absent-segment omission, `tty` literal, `formatDuration` age/idle from `Date.now()/1000`, client-side `narrowest` with ties) in `app/frontend/src/components/sidebar/session-row.tsx`; chip and ≥2 gate unchanged <!-- R15, R16, R17 -->
- [x] T010 Update `app/frontend/src/components/sidebar/session-row.test.tsx`: per-viewer rows with all segments (fake `Date.now`), `narrowest` on the min-width row and on ties, old-payload fallback rows, below-2 gate unchanged; adjust the existing `"2 viewers · 144×91 · 116×37"` assertion to the new row shape <!-- R15, R16, R17 -->

### Phase 4: Verification

- [x] T011 Run `just test-backend`, `just test-frontend`, and `cd app/frontend && npx tsc --noEmit`; fix any failure in the touched files <!-- R1, R7, R11, R15 -->

## Execution Order

- T001 → T003 (sessions reads the new `ClientInfo` fields) → T006 (api references `sessions.AttachMeta`)
- T005 blocks T006 (registry meta reads the conn facts)
- T008 blocks T009 blocks T010
- T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `terminalsConn` carries `peer`, `device`, `connectedAt`, `lastInbound`; they are populated at upgrade and `lastInbound` is stored at the deadline re-arm site; the expiry log names `device` and `peer`
- [x] A-002 R2: `deviceClass` exists, is pure, returns only the five closed-set values in the specified order, and documents the iPadOS limitation
- [x] A-003 R3: `peerFromRequest` exists with the display-only comment and the XFF-first / RemoteAddr-host fallback
- [x] A-004 R4: `attachRegistry` with `register`/`unregister`/`Lookup`/`snapshot` exists; `Server.attachRegistry` is constructed in `NewServer`; nil `Lookup` is safe
- [x] A-005 R5: `attachStream` registers after publish only; `stream.unregister` is invoked in `teardown` before `killAndReapAttach`
- [x] A-006 R6: `prodSessionFetcher.resolver` is wired to the registry in `NewServer` and passed to `FetchSessions`
- [x] A-007 R7: `clientFormat` has 11 fields in the specified order; `ClientInfo` has the four new fields; the doc comment is updated
- [x] A-008 R9: `AttachMeta`/`AttachResolver` are exported from `internal/sessions`; `internal/sessions` does not import `api`
- [x] A-009 R10: `Viewer` has the six additive `omitempty` fields with the specified JSON keys
- [x] A-010 R12: `FetchSessions` has the fourth `resolve` parameter and all callers compile
- [x] A-011 R14: the `types.ts` viewer type has the six optional keys with the specified unions
- [x] A-012 R15: the card renders the `N viewers` header and one `row-flyout-viewer` per viewer with the specified segment order

### Behavioral Correctness

- [x] A-013 R11: a resolver hit yields `kind rk` with device/peer and `lastActiveAt` from the `LastInbound` closure; a miss yields `tty` with `client_activity`; `PID 0` is always `tty`
- [x] A-014 R13: no `ageSec`/`idleSec` field exists anywhere in `Viewer` or the TS type; timestamps are unix seconds
- [x] A-015 R16: `narrowest` appears on every minimum-width row and on no other row

### Scenario Coverage

- [x] A-016 R8: `TestParseClients` covers the 11-field fixture, the 7-field legacy line, a non-numeric pid, and a `control-mode` 11-field line
- [x] A-017 R2: a `deviceClass` table test covers all five classes and the ordering cases (Electron beats all; Android with/without Mobile)
- [x] A-018 R5: a registry lifecycle test proves Lookup true after publish and false after teardown
- [x] A-019 R15: `session-row.test.tsx` asserts the full row text for an rk and a tty viewer with faked `Date.now`

### Edge Cases & Error Handling

- [x] A-020 R8: a 7-field legacy line still yields a viewer (older tmux degrades to all-`tty`, nothing breaks)
- [x] A-021 R17: an old-backend payload (`{width,height}` only) renders `W×H` rows with `narrowest` and no other segments; the below-2 gate is unchanged
- [x] A-022 R3: `RemoteAddr` without a port passes through unchanged
- [x] A-023 R5: the publish-race branch in `attachStream` never registers a pid

### Code Quality

- [x] A-024 Pattern consistency: new Go code mirrors the pure-parser + thin-exec split, `omitempty` additive-field idiom, and doc-comment style of surrounding code; TS follows the `data-testid` and `text-text-secondary` card idioms
- [x] A-025 No unnecessary duplication: `formatDuration` is reused for age/idle; no new tmux command construction outside `internal/tmux`
- [x] A-026 Derive state, no caches: the registry annotates only pids tmux already listed; no polling, no persisted state
- [x] A-027 Tests cover added/changed behavior in every touched package
- [x] A-028 Comments state constraints (display-only XFF, iPadOS caveat, unregister-before-kill ordering), no narration and no change-id citations in code comments

### Security

- [x] A-029 R3: `X-Forwarded-For` feeds display only — no authorization or routing decision reads `peer`
- [x] A-030 R1: the raw `User-Agent` string never reaches the wire; only the closed-set `device` tag is marshalled

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The old single-line `viewersLine` rendering in `session-row.tsx` was replaced by the per-viewer rows inside this same diff; the 7-field `clientLine` test helper remains in use for the legacy-line fixtures; no symbol, file, or config outside the diff was orphaned.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `AttachResolver` adapts `attachRegistry.Lookup` directly (same signature shape) | Lookup already returns `(sessions.AttachMeta, bool)`; a method value satisfies the func type | S:85 R:95 A:95 D:95 |
| 2 | Certain | `LastInbound` fallback to `client_activity` when the closure is nil or returns 0 | A conn that has not yet received a frame after upgrade would otherwise report idle since epoch | S:80 R:90 A:95 D:90 |
| 3 | Confident | Registry lifecycle test drives a real `stream` with a short-lived child process (the `TestStreamTeardownReapsAttachChild` idiom) rather than a live tmux | Existing test already forks a child to prove reap; the registry hooks onto the same seams | S:70 R:85 A:80 D:75 |
| 4 | Confident | `session-row.test.tsx` fakes `Date.now` via `vi.spyOn(Date, "now")` for deterministic age/idle text | Vitest idiom; the row reads `Date.now()` once per render | S:70 R:90 A:85 D:85 |

4 assumptions (2 certain, 2 confident, 0 tentative).
