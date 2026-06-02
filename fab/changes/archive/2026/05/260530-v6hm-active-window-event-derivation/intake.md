# Intake: Active-Window Event-Driven Derivation

**Change**: 260530-v6hm-active-window-event-derivation
**Created**: 2026-05-30
**Status**: Draft

## Origin

> `/fab-new this` — where "this" refers to a fix designed across a `/fab-discuss` session.

Initiated conversationally. The user reported: after running `rk riff` (which opens a new tmux window with a Claude session), the **terminal** switches to the new window but the **left-panel sidebar** keeps highlighting the previously-active window (`zsh`). A screenshot confirmed: breadcrumb + sidebar showed `zsh` while the terminal pane showed the new `riff-steady-urchin` session, and tmux's own status bar marked window 3 active.

The session diagnosed the root cause via static code reading **plus live tmux control-mode probing** (capturing `%`-notifications with `tmux -CC attach` + `script`). Key decisions reached during discussion:

1. **The fix must NOT live in `rk riff`.** The user explicitly rejected a riff-local fix because the same discrepancy occurs for *any* window creator — `wt open`, a raw `tmux new-window` in iTerm/Ghostty, another tmux client, or a script. The bug is in run-kit's *derivation* of "active window," not in any creator.
2. **Keep the per-WebSocket ephemeral grouped sessions** (`rk-relay-*`). Chosen over dropping them / attaching the relay directly to the base session, because ephemerals provide board-pane isolation and the lower-blast-radius fix is to correct which signal run-kit reads.
3. **Per-session scope** for "active window" (preserve today's behavior: each session highlights its own active window), NOT a single per-server highlight.
4. **Auto-follow = yes.** When a window becomes active externally, the run-kit main-view tab SHALL navigate its URL to that window (mirroring a normal tmux client following `select-window`). Accepted because multi-tab side-by-side is the **boards** feature's job; the main `/$server/$window` view can assume single-active-per-session semantics.

## Why

**Problem.** run-kit reports a window's `isActiveWindow` flag by reading the **base session's** `#{window_active}` pointer (`internal/tmux/tmux.go` `ListWindows`). But due to tmux **session groups**, there are *N+1* independent active-window pointers for one logical session:

- The base session (e.g. `runKit`) — what the sidebar/SSE reads.
- One per live per-WebSocket ephemeral `rk-relay-*` (created via `tmux new-session -d -s <eph> -t <base>`, `api/relay.go`) — what each browser terminal PTY is actually attached to.
- Any other attached tmux client (iTerm/Ghostty).

The browser terminal is a live `attach-session -t <ephemeral>` PTY; it re-renders automatically when the ephemeral's active window changes (no frontend code involved). When `rk riff` runs a bare `tmux new-window` (no `-t`) from inside an ephemeral pane, tmux flips the **ephemeral's** active pointer (so the terminal follows) but **never touches the base session's** pointer — so the sidebar, which reads the base pointer, stays stale. This is the same defect class the codebase already documented for `select-window` (see the `SelectWindowInSession` comment in `tmux.go`: *"A bare window-id target is ambiguous inside a tmux session group… tmux may set the active window on the wrong member"*).

**Consequence if unfixed.** The sidebar highlight is unreliable for every externally-driven window activation, not just `rk riff`. Users cannot trust the left panel to reflect where they actually are. The terminal and the sidebar disagree, which is confusing and erodes the keyboard-first, glanceable model the UI depends on.

**Why this approach.** The authoritative signal **already arrives** at run-kit but is **discarded**. tmux emits `%session-window-changed $sid @wid` to the control-mode client whenever a session's active window changes — including on `new-window`. run-kit's control client receives it (verified: this event is delivered globally to a `-CC` client, NOT prefixed `unlinked-`, for all sessions). But `hubSink.OnSessionWindowChanged` (`api/tmuxctl_bridge.go:82`) is a **no-op** — the `@wid` payload is thrown away, and the hub merely bumps a generation counter that triggers a re-fetch of the *stale base pointer*. The fix is to stop discarding the payload: track the last-active `@wid` per session-group and derive `isActiveWindow` from it. This rides the existing, working event path (PR #198) and requires **no frontend logic change** — the existing URL-writeback effect (`app.tsx`) already auto-navigates when `isActiveWindow` flips, which delivers the desired auto-follow for free.

## What Changes

### 1. Stop discarding the `%session-window-changed` payload (`api/tmuxctl_bridge.go`)

Today (`tmuxctl_bridge.go:80-89`), `hubSink` implements every `EventSink` callback as a no-op, with a comment that explicitly invites this change: *"They exist so future code can hook in per-event side effects … without disrupting the generation-counter path."*

`OnSessionWindowChanged(sid, wid string)` SHALL record `wid` as the active window for the **session group** that `sid` belongs to. The recorded value becomes the authoritative source for `isActiveWindow` derivation. The generation-bump path (which wakes the SSE poll loop) is retained unchanged — this change only adds the per-group tracking as a side effect.

Open design point: the event carries the session **id** (`$sid`), not the group name. The handler must resolve `$sid` → its session group so the tracked active window is keyed per-group (so a window activated via *any* group member — base or ephemeral — updates the same per-session highlight). Resolution options to be settled in spec: a cached `$sid`→group map maintained from `%sessions-changed`, or a targeted `display-message -t $sid -p '#{session_group}'` lookup. (`@wid` is globally unique per server, so the window id itself is unambiguous; only the *which-session-it-belongs-to* mapping needs care.)

### 2. Two-tier active-window derivation (`internal/tmux/tmux.go` / `internal/sessions/sessions.go`)

A window's `isActiveWindow` SHALL be derived as:

- **Tier 1 (authoritative):** the window whose `@wid` matches the per-group tracked value from `%session-window-changed` events.
- **Tier 2 (fallback):** the base session's `#{window_active}` flag — used **only** when Tier 1 has no entry for that group yet (cold start, or after a control-client reconnect, until the first post-attach event arrives).

**Cold-start is load-bearing (verified).** On a fresh `tmux -CC attach`, tmux replays `%session-changed` and `%output` paints but does **NOT** replay `%session-window-changed`. So the per-group tracker is empty until the first active-window change after attach. The Tier-2 fallback guarantees a sensible highlight in that window.

Exactly one window per session SHALL be marked active (the sidebar's single-highlight invariant must hold).

### 3. Reset / re-seed the tracker on control-client reconnect

The tmuxctl control client reconnects on PTY drop (the `readLoop` FSM in `internal/tmuxctl/client.go`). Across that gap, the per-group tracked `@wid` goes stale (a window that was active *before* the drop could be shown as current after reconnect, indefinitely, since tmux won't replay it).

On reconnect (connection re-established), the tracker for that server SHALL be either:
- **(a) cleared** — falling back to Tier 2 (base pointer) until the next real event, OR
- **(b) re-seeded** — proactively query `#{window_active}` per group (one `list-windows`) right after attach and seed Tier 1.

Spec to choose (a) vs (b). (b) collapses the two tiers into one consistent source and removes the "fallback is a separate code path" smell, at the cost of one query per group on (re)connect. (a) is simpler. Recommendation: lean (b) if the query cost is acceptable.

### 4. Frontend: no logic change (verify only)

The existing URL-writeback effect (`app/frontend/src/app.tsx`, ~line 398) watches `activeWindow = currentSession.windows.find(w => w.isActiveWindow)` and navigates the URL via `replace` when it differs from the current window. Once `isActiveWindow` carries the correct value, this effect auto-navigates to the newly-active window (auto-follow), the terminal follows via its reconnect-on-windowId path, and the sidebar highlight (`components/sidebar/index.tsx:1165`) tracks it. **Boards are unaffected** — board panes pin explicit window IDs and never read `isActiveWindow`.

### Residual risk to verify in spec/implementation: feedback-loop / oscillation

The relay's own attach path calls `SelectWindowInSession(ephemeral, windowID)` (`api/relay.go:152`) when a tab opens, which emits `%session-window-changed` for the window that tab is opening. Expected convergence: open tab → select-window → event → tracker = that window → writeback navigates URL to it (already there) → stable. Must confirm no oscillation, especially when two tabs open near-simultaneously on the same session (now sharing one per-group active value).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Document the two-tier active-window derivation (events + base-pointer fallback), the per-group tracking, and the cold-start/reconnect behavior. Supersedes the current "active window = base session `#{window_active}`" description.
- `run-kit/architecture`: (modify) Update the control-mode → SSE → active-window data-flow description to reflect that `%session-window-changed` payload is now consumed (not just used as a generation pulse).

## Impact

- **Backend (Go):**
  - `app/backend/api/tmuxctl_bridge.go` — `hubSink.OnSessionWindowChanged` gains per-group tracking; likely a new small concurrent-safe store keyed by group.
  - `app/backend/internal/tmuxctl/client.go` — reconnect hook to reset/re-seed the tracker (`OnConnectionEstablished` / `OnConnectionLost` already exist as sink callbacks).
  - `app/backend/internal/tmux/tmux.go` and/or `app/backend/internal/sessions/sessions.go` — `isActiveWindow` derivation reads Tier 1 with Tier 2 fallback; needs access to the tracker (dependency wiring through the SSE/fetch path).
  - `$sid`→group resolution helper (new) if the cached-map approach is chosen.
- **Frontend:** none functional. Possible Playwright e2e coverage for the auto-follow behavior.
- **Contracts touched:** control-mode (`tmuxctl`) → SSE hub → `FetchSessions` active-window derivation. This is the same contract PR #198 ("event-driven active window via tmux control mode") established.
- **Constitution alignment:** No database (tracker is in-memory, derived from tmux events — acceptable as it mirrors tmux state, not a persistent store); `exec.CommandContext` with timeouts for any new tmux query; uniform POST n/a (read path only).
- **Concurrency:** the per-group tracker is read on every `FetchSessions` (SSE poll + REST) and written from the control-mode read loop — needs a mutex / `sync.Map` / atomic discipline.

## Open Questions

<!-- Resolved 2026-05-30 via /fab-clarify — see ## Clarifications:
     - Reconnect recovery: re-seed via list-windows query (was open).
     - $sid→group: cached map from %sessions-changed (was open).
     - Tier conflict: latest event wins, base never overrides (was open). -->

- Where to hang the concurrency-safe tracker — on the `tmuxctl.Client` (per socket), on the SSE hub, or a new type. Implementation detail for the spec/plan; not blocking.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives in active-window derivation (tmuxctl→SSE→FetchSessions), NOT in `rk riff` or any window creator | Discussed — user explicitly rejected a riff-local fix because `wt open` / iTerm / raw `tmux new-window` reproduce it identically | S:98 R:80 A:90 D:95 |
| 2 | Certain | Keep per-WebSocket ephemeral `rk-relay-*` grouped sessions; do not attach relay to base session | Discussed — user chose "keep ephemerals, fix derivation" over "drop ephemerals" to preserve board isolation and minimize blast radius | S:95 R:70 A:90 D:90 |
| 3 | Certain | "Active window" is scoped per-session (each session keeps its own highlight), not per-server | Discussed — user chose per-session to preserve current visible behavior | S:95 R:75 A:88 D:92 |
| 4 | Certain | Auto-follow: main-view tab navigates URL to a window activated externally | Discussed — user chose "yes, jump to it"; multi-tab side-by-side is boards' responsibility | S:95 R:85 A:85 D:90 |
| 5 | Certain | `%session-window-changed $sid @wid` is the authoritative signal and already reaches run-kit's control client (delivered globally, non-`unlinked`, for all sessions) | Verified via live `tmux -CC` probe on tmux 3.6a during discussion | S:98 R:60 A:95 D:95 |
| 6 | Certain | `hubSink.OnSessionWindowChanged` is currently a no-op that discards the `@wid` payload | Verified by reading `api/tmuxctl_bridge.go:82`; comment invites the hook | S:99 R:60 A:99 D:99 |
| 7 | Confident | Two-tier derivation needed: events authoritative, base `#{window_active}` as cold-start/reconnect fallback | Verified tmux does NOT replay `%session-window-changed` on fresh `-CC` attach, so fallback is load-bearing | S:90 R:55 A:90 D:80 |
| 8 | Confident | Frontend needs no logic change — existing `app.tsx` URL-writeback delivers auto-follow once `isActiveWindow` is correct; boards immune (pin explicit window IDs) | Verified writeback effect at `app.tsx:398` and board-pane window targeting at `board-pane.tsx:101` | S:88 R:70 A:85 D:80 |
| 9 | Confident | Memory updates limited to `run-kit/tmux-sessions` and `run-kit/architecture` (no new domain) | Behavior change is in an already-documented subsystem | S:85 R:80 A:80 D:85 |
| 10 | Certain | Re-seed the tracker on reconnect (query `#{window_active}` per group via `list-windows`) rather than clear-and-fallback | Clarified — user confirmed: re-seed gives one consistent source and no stale highlight; reconnects are rare so the per-group query cost is acceptable | S:95 R:65 A:60 D:50 |
| 11 | Certain | Resolve `$sid`→group via a cached map maintained from `%sessions-changed` (and on connect) rather than per-event `display-message` lookup | Clarified — user confirmed: O(1) lookup per active-window event, no per-event subprocess churn; bounded staleness acceptable | S:95 R:65 A:60 D:50 |
| 12 | Certain | Latest event wins: Tier 1 (events) is authoritative once set; base pointer is consulted ONLY as cold-start/reconnect fallback, never overrides a tracked value | Clarified — user confirmed: external non-relay clients (iTerm/Ghostty) also emit `%session-window-changed`, so "latest event wins" covers them natively; trusting the base pointer would re-introduce the original stale-pointer bug | S:95 R:55 A:55 D:55 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-05-30

| # | Question | Resolution |
|---|----------|------------|
| 10 | Reconnect recovery: re-seed vs clear+fallback? | Re-seed via `list-windows` query per group on reconnect — Tier 1 live immediately, no stale-highlight gap |
| 11 | `$sid`→group resolution: cached map vs per-event lookup? | Cached map refreshed from `%sessions-changed` (+ on connect); O(1) per-event lookup, no subprocess churn |
| 12 | Tier conflict: does base pointer override event-tracked value? | No — latest event wins; base is cold-start/reconnect fallback only. External clients emit the event too, so no real conflict |
