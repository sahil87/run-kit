# Spec: Active-Window Event-Driven Derivation

**Change**: 260530-v6hm-active-window-event-derivation
**Created**: 2026-05-30
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- **Changing the ephemeral grouped-session relay model** — `rk-relay-*` ephemerals stay exactly as they are; this change only corrects how "active window" is *derived*, not how terminals attach.
- **Fixing any window creator** (`rk riff`, `wt open`, the REST `/select` handler) — the fix is creator-agnostic, in the derivation path. `rk riff`'s bare `new-window` is intentionally left unchanged.
- **Per-tab independent active window** — multi-window side-by-side remains the boards feature's responsibility; the main `/$server/$window` view assumes shared per-session active semantics.
- **A new persistent store** — the tracker is in-memory, mirroring kernel-observable tmux state (Constitution §II).
- **Frontend selection-logic changes** — the existing URL-writeback effect is reused as-is; only its input (`isActiveWindow`) becomes correct.

## tmuxctl: Active-Window Event Tracking

### Requirement: Consume the `%session-window-changed` payload

The tmuxctl layer SHALL record the window id (`@wid`) reported by each `%session-window-changed $sid @wid` notification as the active window for the **session group** that `$sid` belongs to. The recorded value SHALL be exposed to the SSE/fetch path as the authoritative active-window signal for that group. The existing per-server generation-counter bump (which wakes the SSE poll loop) SHALL be preserved unchanged — payload tracking is an additive side effect, not a replacement.

`hubSink.OnSessionWindowChanged` (`api/tmuxctl_bridge.go`), currently a no-op, is the designated hook (its doc comment already anticipates "future code can hook in per-event side effects").

#### Scenario: New window becomes active in a group member
- **GIVEN** run-kit's control client is subscribed to a tmux server hosting session group `runKit` (with ephemeral members `rk-relay-*`)
- **WHEN** any group member activates window `@27` (e.g. `rk riff`'s `new-window`, a relay `select-window`, or an external `tmux select-window`), emitting `%session-window-changed $sid @27`
- **THEN** the tracker SHALL resolve `$sid` to group `runKit` and record `@27` as `runKit`'s active window
- **AND** the SSE poll loop SHALL be woken via the existing generation-counter path

#### Scenario: Latest event wins
- **GIVEN** the tracker holds `@27` as group `runKit`'s active window
- **WHEN** a later `%session-window-changed` for a `$sid` in group `runKit` reports `@9`
- **THEN** the tracker SHALL overwrite the recorded value to `@9` (most recent event is authoritative)

### Requirement: Resolve `$sid` to session group via a cached map

The tmuxctl layer SHALL maintain an in-memory `$sid` → session-group map per server, refreshed when `%sessions-changed` fires and on control-client (re)connect. Active-window event handling SHALL resolve `$sid` via this map in O(1) without spawning a per-event subprocess. A `$sid` absent from the map (a session newer than the last refresh) SHALL be tolerated: the event MAY be dropped for tracking purposes until the next `%sessions-changed` refresh repopulates the map — it MUST NOT error or block.

#### Scenario: Cached resolution
- **GIVEN** the map holds `$0 → runKit` and `$34 → runKit` (an ephemeral grouped to `runKit`)
- **WHEN** `%session-window-changed $34 @27` arrives
- **THEN** the handler SHALL look up `$34 → runKit` (O(1), no subprocess) and update group `runKit`'s active window to `@27`

#### Scenario: Map refresh on session-set change
- **GIVEN** a new session group appears on the server
- **WHEN** `%sessions-changed` fires
- **THEN** the `$sid` → group map SHALL be refreshed to include the new session(s)

#### Scenario: Unknown sid tolerated
- **GIVEN** `%session-window-changed $99 @5` arrives for a `$99` not yet in the map
- **WHEN** the handler attempts resolution and finds no entry
- **THEN** it SHALL NOT error, panic, or block — the event MAY be skipped for tracking and corrected on the next `%sessions-changed` refresh

### Requirement: Re-seed the tracker on control-client (re)connect

On control-client connection establishment (initial attach and every reconnect), the tmuxctl layer SHALL re-seed the per-group active-window tracker by querying current state — for each session group, read `#{window_active}` (e.g. via `list-windows`) and record the active window id. This SHALL run because tmux does NOT replay `%session-window-changed` on a fresh `-CC` attach (verified on tmux 3.6a), so without re-seeding the tracker would hold a stale value (or be empty) across the reconnect gap.

The `OnConnectionEstablished` sink callback (already defined) is the designated hook.

#### Scenario: Re-seed after reconnect
- **GIVEN** the control client drops and the tracker holds a now-stale `@27` for group `runKit`
- **WHEN** the control client reconnects (`OnConnectionEstablished` fires)
- **THEN** the tracker SHALL query each group's current `#{window_active}` and overwrite its entry with the live value before serving the next derivation

#### Scenario: Cold start seed
- **GIVEN** `rk serve` has just started and no `%session-window-changed` has fired yet
- **WHEN** the control client completes its initial attach
- **THEN** the tracker SHALL be seeded from the current `#{window_active}` per group, so the first SSE snapshot reflects the genuinely-active window

### Requirement: Concurrency safety

The tracker SHALL be safe for concurrent access: written from the single control-client read-loop goroutine and read on every `FetchSessions` call (SSE poll + REST). Access SHALL be guarded (mutex, `sync.Map`, or equivalent). Reads MUST NOT block the control-client read loop, and the read loop MUST NOT block SSE fetches.

#### Scenario: Concurrent read during write
- **GIVEN** the SSE poll loop is reading the tracker while the control read-loop is updating it
- **WHEN** both access the tracker concurrently
- **THEN** access SHALL be race-free (no torn reads, no data race under `-race`)

## Active-Window Derivation (`internal/tmux` / `internal/sessions`)

### Requirement: Two-tier active-window derivation

`isActiveWindow` for a window SHALL be derived as follows:

- **Tier 1 (authoritative):** the window whose `@wid` matches the per-group tracked value from `%session-window-changed` events (including re-seeded values). When a tracked value exists for the window's group, exactly that window is marked active.
- **Tier 2 (fallback):** the base session's `#{window_active}` flag — used ONLY when Tier 1 has no entry for the window's group (i.e. before the first event/seed for that group).

Tier 1, once set, SHALL be authoritative; the base `#{window_active}` flag SHALL NOT override a tracked Tier-1 value. (External non-relay clients that move the base pointer also emit `%session-window-changed`, so "latest event wins" subsumes them — no override path is needed.)

#### Scenario: Tracked value wins over stale base pointer
- **GIVEN** group `runKit`'s tracker holds `@27`, but the base session's `#{window_active}` still points at `@24` (stale because a relay/ephemeral moved the active window)
- **WHEN** `FetchSessions` derives `isActiveWindow` for `runKit`'s windows
- **THEN** `@27` SHALL be marked `isActiveWindow: true` and `@24` SHALL be `false`

#### Scenario: Fallback before first event
- **GIVEN** a group with no tracked entry yet (cold, pre-seed, or a brand-new group between refreshes)
- **WHEN** `FetchSessions` derives `isActiveWindow`
- **THEN** it SHALL fall back to the base session's `#{window_active}` flag

#### Scenario: External client move is followed
- **GIVEN** the user activates `@9` of `runKit` from iTerm (not a run-kit relay)
- **WHEN** tmux emits `%session-window-changed` for that activation and the tracker records `@9`
- **THEN** `FetchSessions` SHALL mark `@9` active — without any base-pointer-override logic

### Requirement: Exactly one active window per session

For each session reported to the frontend, the derivation SHALL mark at most one window `isActiveWindow: true` (the single-highlight invariant the sidebar depends on). Active-window scope SHALL remain per-session (each session keeps its own highlighted window), NOT collapsed to a single per-server highlight.

#### Scenario: Single highlight preserved
- **GIVEN** a session with windows `@0`, `@24`, `@27`
- **WHEN** the derivation runs with a tracked active of `@27`
- **THEN** exactly one window (`@27`) SHALL be `isActiveWindow: true`; the others SHALL be `false`

## Frontend: Auto-Follow (verification only)

### Requirement: Main-view tab follows the active window without logic change

The frontend SHALL require no new selection or navigation logic. The existing URL-writeback effect (`app/frontend/src/app.tsx`) — which navigates (`replace`) when the SSE-reported active window differs from the URL window — SHALL deliver auto-follow once `isActiveWindow` carries the corrected value. Board panes SHALL remain unaffected (they pin explicit window IDs and never read `isActiveWindow`).

#### Scenario: Sidebar and URL follow an externally-activated window
- **GIVEN** the main view is at `/$server/@24` and the user runs `rk riff`, which activates new window `@36`
- **WHEN** the corrected `isActiveWindow` (`@36`) arrives via SSE
- **THEN** the URL-writeback effect SHALL navigate to `/$server/@36`, the terminal SHALL follow, and the sidebar SHALL highlight `@36` — with no frontend code change

#### Scenario: Boards unaffected
- **GIVEN** a board with panes pinned to `@1` and `@5`
- **WHEN** the active window changes elsewhere
- **THEN** the board panes SHALL continue rendering their pinned windows, unaffected by the active-window tracker

## Design Decisions

1. **Fix in derivation, not in any creator**
   - *Why*: The discrepancy reproduces for every window creator (`rk riff`, `wt open`, raw `tmux new-window` in iTerm/Ghostty, another tmux client). A creator-local fix is whack-a-mole; the real defect is run-kit reading a session pointer that creators don't reliably move.
   - *Rejected*: Qualifying `rk riff`'s `new-window`/`select-window` with the base session — fixes only one creator and re-litigates the same bug for the next one.

2. **Keep ephemeral grouped sessions; correct the read signal**
   - *Why*: Ephemerals provide board-pane isolation and per-connection navigation. The lower-blast-radius fix is to read the right signal.
   - *Rejected*: Dropping ephemerals / attaching the relay directly to the base session — larger change, and two plain tabs on one session would fight over the active window.

3. **Two-tier derivation (events authoritative, base pointer as cold-start/reconnect fallback)**
   - *Why*: tmux does NOT replay `%session-window-changed` on a fresh `-CC` attach (verified on 3.6a), so the event tracker is empty until the first post-attach change; the base pointer is the only sensible bootstrap.
   - *Rejected*: Events-only (blank/stale highlight at cold start); base-pointer-only (the original bug); `#{window_activity}` recency (a background `just dev` would steal the highlight).

4. **Re-seed the tracker on reconnect rather than clear-and-fallback**
   - *Why*: Re-seeding via one `list-windows` per group gives a single consistent source and no stale-highlight gap; reconnects are rare so the query cost is acceptable.
   - *Rejected*: Clear-and-fallback — leaves the highlight on the base pointer (the very thing that goes stale for relay-driven changes) until the next event.

5. **Resolve `$sid` → group via a cached map (refreshed on `%sessions-changed` + connect)**
   - *Why*: O(1) per active-window event with no per-event subprocess churn; active-window events are frequent during navigation.
   - *Rejected*: Per-event `display-message -t $sid -p '#{session_group}'` — a subprocess on every event, against the project's exec-discipline grain.

6. **Latest event wins; base pointer never overrides Tier 1**
   - *Why*: External non-relay clients also emit `%session-window-changed`, so "latest event wins" covers them natively; trusting the base pointer on disagreement would re-introduce the original stale-pointer bug.
   - *Rejected*: Base-pointer-can-override — reintroduces the bug for relay/web-UI-driven changes.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives in active-window derivation (tmuxctl→SSE→FetchSessions), NOT in `rk riff` or any window creator | Confirmed from intake #1 — user explicitly rejected a creator-local fix; reproduces for `wt open`/iTerm/raw `new-window` | S:98 R:80 A:90 D:95 |
| 2 | Certain | Keep per-WebSocket ephemeral `rk-relay-*` grouped sessions; do not attach relay to base session | Confirmed from intake #2 | S:95 R:70 A:90 D:90 |
| 3 | Certain | Active window scoped per-session (each session keeps its own highlight), not per-server | Confirmed from intake #3 | S:95 R:75 A:88 D:92 |
| 4 | Certain | Auto-follow: main-view tab navigates URL to a window activated externally; reuse existing `app.tsx` writeback (no frontend logic change) | Confirmed from intake #4 + #8; verified writeback at `app.tsx` and board-pane isolation at `board-pane.tsx` | S:92 R:80 A:88 D:90 |
| 5 | Certain | `%session-window-changed $sid @wid` is authoritative and already reaches run-kit's control client (global, non-`unlinked`) | Confirmed from intake #5; verified via live `tmux -CC` probe (3.6a) and architecture memory § Control-Mode Subscription | S:98 R:60 A:95 D:95 |
| 6 | Certain | `hubSink.OnSessionWindowChanged` is a no-op discarding `@wid`; it is the designated hook | Confirmed from intake #6; verified `api/tmuxctl_bridge.go` + memory line 286 | S:99 R:60 A:99 D:99 |
| 7 | Certain | Two-tier derivation: events authoritative, base `#{window_active}` cold-start/reconnect fallback | Confirmed from intake #7; tmux does not replay active-window on fresh attach (verified), so fallback is load-bearing | S:92 R:55 A:90 D:85 |
| 8 | Certain | Re-seed tracker on (re)connect via `list-windows` per group (`OnConnectionEstablished` hook) | Clarified — user confirmed re-seed over clear+fallback; reconnects rare, query cost acceptable | S:95 R:65 A:65 D:60 |
| 9 | Certain | Resolve `$sid`→group via cached map refreshed from `%sessions-changed` (+ on connect); O(1), no per-event subprocess; unknown sid tolerated | Clarified — user confirmed cached map over per-event lookup | S:95 R:65 A:65 D:60 |
| 10 | Certain | Latest event wins: Tier 1 authoritative once set; base pointer never overrides a tracked value | Clarified — user confirmed; external clients emit the event too, so no real conflict | S:95 R:55 A:60 D:60 |
| 11 | Certain | Memory updates limited to `run-kit/tmux-sessions` and `run-kit/architecture` (no new domain) | Confirmed from intake #9 — change is in an already-documented subsystem | S:88 R:80 A:82 D:85 |
| 12 | Confident | Tracker placement: hang per-server state on the tmuxctl layer (Client/Supervisor), exposed to the SSE/fetch path; concurrency-guarded | Intake open question; the control read-loop owns the events and `OnConnectionEstablished`, so co-locating the tracker there is the natural seam — but exact type/wiring is an implementation choice the plan settles | S:70 R:55 A:75 D:65 |
| 13 | Confident | Re-seed query reuses existing tmux read helpers (`ListWindows`/`#{window_active}`) under the standard `context.WithTimeout`; no new shell strings (§I) | Standard project pattern; the only new subprocess is a bounded `list-windows` per group on (re)connect | S:80 R:70 A:85 D:75 |

13 assumptions (11 certain, 2 confident, 0 tentative, 0 unresolved).
