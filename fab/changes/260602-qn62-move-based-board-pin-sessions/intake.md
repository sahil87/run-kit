# Intake: Move-Based Server-Scoped Boards (Pin Sessions)

**Change**: 260602-qn62-move-based-board-pin-sessions
**Created**: 2026-06-03
**Status**: Draft

## Origin

<!-- How was this change initiated? Include the user's raw input/prompt, the interaction
     mode (one-shot vs. conversational), and key decisions from the conversation. -->

> Initiated via `/fab-discuss` → free-form, first-principles design conversation. The user asked
> why all run-kit terminal sessions are `rk-relay-*` ephemerals and what reverting to a 1:1
> session↔tmux mapping would imply. Through a multi-turn exploration (with live tmux probing on
> tmux 3.6a), we converged on a model that removes the relay-ephemeral isolation layer entirely.

This was a **conversational** design session, not a one-shot. The reasoning chain (each step
verified empirically against a throwaway tmux server) was:

1. The `rk-relay-*` ephemeral exists because tmux gives each session exactly **one active-window
   pointer**, shared across all attachments to that session. run-kit is multi-viewer (two tabs,
   laptop+phone, board panes), so two attachments wanting different active windows on one shared
   session collide. The ephemeral grouped session gives each WebSocket its own active-window
   pointer → isolation.
2. The user accepted the consequences of losing multi-client isolation (#1) and of viewer
   navigation mutating the real session (#3), but wanted to keep **boards**.
3. We established (probed) that a board renders **N live panes simultaneously**, each a different
   window → needs **N independent active-window pointers** → N sessions. A single shared "board
   session" does NOT solve this (probe: selecting A1 then A2 in one session just moves the one
   pointer). So link-based or option-based membership still requires a per-pane isolation session.
4. **Key unlock (user's idea):** remove window *sharing*. A window lives in exactly ONE place —
   either a home session (SESSIONS view) or moved onto a board (BOARDS view), never both. PIN =
   `move-window` (not `link-window`) into the window's OWN single-window session. With one window
   per session, that session's single active-window pointer is *permanently* that window — a
   viewer attaches **directly**, no isolation layer. Probed end-to-end including the dead-home
   restore fallback.

Decisions locked interactively (see Assumptions table for SRAD grades):
- Boards are **server-scoped** (`move-window` can't cross tmux servers).
- Pin **relocates** the window out of its home session (intended — this is what enables the deletion).
- Unpin restores to a **remembered home** (`@rk_home` session var), recreating the home session if it died.
- Pins are **persistent across rk restarts** (durable user intent; tmux survives restarts per Constitution VI) → **no restore-sweep needed**.

## Why

**Problem.** Today every terminal WebSocket attaches to a per-connection ephemeral grouped session
(`rk-relay-*`, `app/backend/api/relay.go`). This isolation layer is load-bearing but expensive in
surface area:

- Ephemeral lifecycle + ownership stamping (`@rk_owner_pid` via `SetSessionOwnerPID`/`GetSessionOwnerPID`).
- A startup PID-liveness sweep (`cmd/rk/serve_sweep.go`: `sweepOrphanedRelaySessions`, `pidAlive`, `relayOwnerIsDead`) to reap orphans left by a crashed predecessor.
- The `rk-relay-*` filter chokepoint in `parseSessions` + the `ListRawSessionNames` escape hatch.
- A large slice of the active-window event-derivation (`260530-v6hm`) that exists *because* the
  ephemeral moves the active-window pointer off the base session, leaving `#{window_active}` stale.

Separately, board membership is a hand-rolled comma/colon encoding inside the `@rk_board` **server
option** (`<window_id>:<board>:<order_key>` triples), with fractional `ComputeOrderKey` ordering,
cross-server read+union, and lazy + eager stale cleanup (`RemoveAllByWindowID`, SSE poll-tick
window-kill diffing). That is a bespoke serialization layered on top of tmux state.

**Consequence of not fixing.** The ephemeral isolation layer and the `@rk_board` encoding are two
independent subsystems that together carry the bulk of the relay/board complexity. They are the
reason the "common case" (a single terminal) cannot be the dumb thing — direct attach to a real
session. Every new board/relay feature pays the isolation + encoding tax.

**Why this approach over alternatives (all explored and rejected in-conversation):**

- *Revert to 1:1, drop boards.* Rejected — user wants boards.
- *1:1 terminals + keep ephemeral-per-pane for boards only.* Rejected — forks the relay into two
  codepaths (`board-pane.tsx` currently shares `TerminalClient`/`/relay/{windowId}` with the normal
  terminal); more code, not less; cuts against Constitution IV.
- *One `_rk-board-<name>` session holding all pins (link-window).* Rejected — proven by probe to
  still collide (one shared active-window pointer for N panes).
- *Keep ephemeral for everything (status quo).* Viable but does not achieve the "dumb common case"
  goal and retains both subsystems.
- **Chosen: move-based single-location pin sessions.** Removes *sharing*, which is the root cause of
  the isolation requirement. One window per pin-session → direct attach → no ephemeral. Membership
  becomes "where the window lives" + two session vars → no `@rk_board` encoding. This is the most
  idiomatic "tmux as source of truth" answer and the only one that lets us delete the ephemeral
  while keeping boards.

## What Changes

### Core principle

Every window lives in **exactly one** session at a time:

- **In SESSIONS view** → it's a window of a normal (home) session. A viewer attaches directly to the
  home session. This is the dumb common case — no ephemeral.
- **In BOARDS view** → it has been *moved* into its own single-window session `_rk-pin-<windowID>`.
  A board pane attaches directly to that pin-session.

Never both. A "board" is **not a tmux session** — it is the *set of pin-sessions that share an
`@rk_board` value*.

### Reserved naming

- New reserved session-name prefix `_rk-pin-` (one pin-session per pinned window). Constant lives
  alongside `tmux.RelaySessionPrefix`/`tmux.ControlAnchorSessionName` in `internal/tmux/tmux.go`.
- `parseSessions` gains an early-skip for `_rk-pin-` and **loses** the `rk-relay-*` skip (relay
  ephemerals are gone). The `_rk-ctl` anchor skip is **unchanged**.

### Source-of-truth model (all in tmux — Constitution II)

| Concept | tmux representation |
|---------|---------------------|
| Pinned window | its own single-window session `_rk-pin-<windowID>` |
| Board membership | session var `@rk_board=<name>` set on the pin-session (`set-option -t <pinSession> @rk_board <name>`) |
| Restore target | session var `@rk_home=<homeSessionName>` stamped at pin time |
| Order within board | session var on the pin-session (e.g. `@rk_board_order=<key>`) |
| The window identity | unchanged `@N` — `move-window` preserves `#{window_id}` (tmux contract) |

### Operations (full tmux surface)

**PIN** (window `@id` on server `S`, into board `<name>`):
```
new-session -d -s _rk-pin-@id            # creates with a placeholder window
move-window -s <homeSession>:@id -t _rk-pin-@id:
kill-window -t _rk-pin-@id:<placeholder> # leave only the moved window
set-option -t _rk-pin-@id @rk_home <homeSession>
set-option -t _rk-pin-@id @rk_board <name>
set-option -t _rk-pin-@id @rk_board_order <key>
```
Refinement (probe-surfaced): construct so the pin-session ends with the moved window as its sole
window — no stray `new-session` placeholder left behind.

**UNPIN** (`@id`):
```
home = show-options -t _rk-pin-@id -v @rk_home
if has-session =home:  move-window -s _rk-pin-@id:@id -t home:
else:                  recreate home (moved window becomes its only window — no placeholder)
kill-session _rk-pin-@id
```

**LIST boards** = `list-sessions` filtered to `_rk-pin-*`, grouped by `@rk_board`.
**LIST a board's pins** = pin-sessions where `@rk_board == name`, ordered by `@rk_board_order`.
**RENDER a board pane** = attach PTY **directly** to `_rk-pin-<id>` (its sole window is permanently
active). No ephemeral, no scoped select needed.
**REORDER** = rewrite `@rk_board_order` on the pin-session (keep the existing fractional
`ComputeOrderKey`? — see Open Questions; index-within-board is no longer meaningful since each pin
is its own session, so ordering must be an explicit key).

### Relay simplification (`app/backend/api/relay.go`)

- Remove the per-WebSocket ephemeral allocation: no `newEphemeralRelayName`, no
  `NewGroupedSession`, no `SetSessionOwnerPID` stamp, no scoped `SelectWindowInSession` on an
  ephemeral, no `defer KillSessionCtx` for an ephemeral.
- The relay resolves the owning session via `ResolveWindowSession(windowID)` (kept) and attaches the
  PTY directly to that session (be it a home session or a `_rk-pin-*` session). Active-window
  selection for the common case becomes a direct `select-window` on the real session (the accepted
  multi-client collision, #1).

### Deletions (backend)

- `cmd/rk/serve_sweep.go` — entire file (`sweepOrphanedRelaySessions`, `pidAlive`,
  `relayOwnerIsDead`) and its wiring in `cmd/rk/serve.go`. Pins are persistent; ephemerals are gone;
  nothing to sweep. (Confirm: no other orphan class needs sweeping.)
- `internal/tmux/tmux.go` — `NewGroupedSession`, `SetSessionOwnerPID`, `GetSessionOwnerPID`,
  `ListRawSessionNames`, `RelaySessionPrefix`, `OwnerPIDOption`.
- `internal/tmux/board.go` — `parseBoardValue`, `serializeBoardValue`, `setBoardValue`,
  `ListBoardEntries`, `ListAllBoardEntries`, `nextAppendKey`, `RemoveAllByWindowID`, and the
  `@rk_board` server-option format. `ComputeOrderKey` MAY survive if reused for `@rk_board_order`
  (see Open Questions).
- `api/sse.go` — eager board-cleanup (`BoardEntriesFetcher.RemoveAllByWindowID`, the per-tick
  window-kill diff that emits `board-changed {cleanup}`) and the `@rk_board` bootstrap broadcast.
  Board membership now changes only via explicit pin/unpin (which emit their own SSE), and a killed
  pinned window simply empties+removes its pin-session.

### Additions (backend)

- `_rk-pin-` prefix constant + `parseSessions` skip.
- Pin/unpin/list/reorder rewritten in `internal/tmux/board.go` + `api/boards.go` around
  `new-session`/`move-window`/`kill-session` + the `@rk_board`/`@rk_home`/`@rk_board_order` session
  vars. `windowExistsOnServer` (kept) still gates pin.
- Recreate-home fallback for a dead `@rk_home` on unpin.

### Frontend

- `src/components/board/board-pane.tsx` — still renders `<TerminalClient windowId=... server=... />`;
  the windowId now resolves to a `_rk-pin-*` session server-side, transparent to the component.
- `src/api/boards.ts`, `src/hooks/use-boards.ts` — board list/pin/unpin/reorder contracts updated to
  the new derivation (server-scoped; no cross-server union; ordering via the new key). SESSIONS
  sidebar must not show pinned windows (they're physically moved out — already true once the home
  session no longer contains them; verify the sidebar reflects the post-move session list).

### Investigate (NOT assumed deletable)

The active-window event-derivation subsystem (`internal/tmuxctl/*`, `260530-v6hm`, ~10 files) is
**also** driven by the `_rk-ctl` control-mode anchor and serves the SESSIONS sidebar highlight
*independent of boards*. It is **not** purely downstream of the ephemeral. Scope: *investigate*
whether it simplifies once nothing moves the active pointer off the base session for the common
case — but do **not** assume removal. The `_rk-ctl` anchor and the `exit-empty off` backstop
(`260602-a1wo`) are **unaffected and must stay** (Constitution VI).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) — §"Per-WebSocket Ephemeral Grouped Sessions (`rk-relay-*`)"
  largely removed; add §"Pin Sessions (`_rk-pin-*`)" describing the move-based board model; replace
  §"`@rk_board` — Pane Board Membership"; update the §"Startup sweep" content (sweep removed); update
  the Server-Scoped User Options table (drop `@rk_owner_pid`/`@rk_board` server-option rows, add
  `@rk_board`/`@rk_home`/`@rk_board_order` session-scoped rows on pin-sessions).
- `run-kit/architecture`: (modify) — §"Boards Feature" (server-scoped, move-based), §"Terminal Relay"
  (direct attach, no ephemeral), Data Model `@rk_board` row, caching/SSE board-cleanup notes.
- `run-kit/ui-patterns`: (modify) — board pane rendering; SESSIONS-vs-BOARDS exclusivity (a pinned
  window leaves its home session's tab list).

## Impact

- **Backend**: `app/backend/api/relay.go`, `api/boards.go`, `api/sse.go`,
  `internal/tmux/tmux.go`, `internal/tmux/board.go`, `cmd/rk/serve_sweep.go` (delete),
  `cmd/rk/serve.go` (unwire sweep). Tests: `internal/tmux/board_test.go`,
  `internal/tmux/socketsweep_test.go`, `api/*_test.go` for boards/relay/sse.
- **Frontend**: `src/components/board/*`, `src/api/boards.ts`, `src/hooks/use-boards.ts`, plus their
  `.test.ts(x)` and any `*.spec.ts`/`*.spec.md` board e2e companions (Constitution Test Companion Docs).
- **Constitution checkpoints**: §I (all new tmux calls via `exec.CommandContext` + timeout, validate
  `@id`/board names — reuse `ValidWindowID`/`ValidBoardName`); §II (no DB — membership stays derived
  from tmux sessions + vars; flag the philosophical shift from "tiny derived option value" to "tmux
  session structure as the record" for review); §IV (one rendering path; fewer subsystems); §VI
  (`_rk-ctl` anchor + `exit-empty off` untouched; pins survive restarts); §IX (mutations stay POST).
- **Behavioral changes the user accepted**: multi-client active-window collisions on a shared real
  session; viewer navigation mutates the real session's active window; pinned windows disappear from
  their home session until unpinned.

## Open Questions

All four open questions were resolved during the 2026-06-03 clarify session (see
`## Clarifications`). Resolutions, with the lowest-surface choice taken in each case:

- **Ordering key** → **Reuse the fractional `ComputeOrderKey`**, stored per pin-session in the
  `@rk_board_order` session var. Reorder rewrites exactly one var; no renumbering of sibling pins;
  preserves drag-to-insert-between. `ComputeOrderKey` is therefore the one piece of the old
  `board.go` that survives the rewrite.
  <!-- clarified: ordering = reuse ComputeOrderKey in @rk_board_order (one var per reorder, no renumber) -->
- **Empty-board semantics** → **No empty boards** — a board is purely the set of `_rk-pin-*`
  sessions sharing an `@rk_board` value; when the last pin is unpinned its pin-session is killed and
  the board is no longer listed. No board-name registry, no placeholder. Matches today's behavior.
  <!-- clarified: empty boards vanish (derive board list from pin-sessions; no separate name registry) -->
- **Pin home session's *only* window** → **Empty home session persists.** `exit-empty off`
  (already set, `260602-a1wo`) keeps the now-empty home session alive; unpin later finds it via
  `@rk_home` and moves the window back. No special-casing on pin. Consistent with the session-floor
  model.
  <!-- clarified: emptied home session persists via exit-empty off; unpin restores via @rk_home -->
- **Multi-unpin placement** → **Append in unpin order.** Each unpin appends the window to its home
  session at tmux's auto-assigned next index — no stored original index, no slot reconstruction.
  Return order reflects unpin order, not original tab position.
  <!-- clarified: unpin appends at next index (no @rk_home_index, no original-position restore) -->

## Clarifications

### Session 2026-06-03 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 8 | Confirmed | — |

### Session 2026-06-03 (open questions)

| Q | Question | Answer |
|---|----------|--------|
| 1 | Pin ordering storage | Reuse fractional `ComputeOrderKey` in `@rk_board_order` (one var per reorder, no renumber) — resolves Tentative #9 |
| 2 | Empty-board semantics | No empty boards — board derives from pin-sessions; vanishes on last unpin; no name registry |
| 3 | Pinning a home session's only window | Empty home session persists via `exit-empty off`; unpin restores via `@rk_home` |
| 4 | Multi-unpin placement | Append in unpin order at next index; no stored original position |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Boards are server-scoped; `move-window` can't cross tmux servers, so a pin-session lives on its window's server and cross-server union logic is removed | User explicitly decided server-scoped this session; tmux constraint is hard (verified `move-window`/`link-window` are server-local) | S:98 R:70 A:95 D:95 |
| 2 | Certain | PIN moves the window out of its home session (it disappears from SESSIONS until unpinned) | User explicitly confirmed "Yes — that's the point"; it is the mechanism that removes sharing and enables deleting the ephemeral | S:98 R:55 A:90 D:95 |
| 3 | Certain | UNPIN restores to the `@rk_home` session var; if home was killed, recreate it (moved window as its only window) | User selected "Remember home session" with recreate fallback; probed end-to-end including dead-home recreate | S:95 R:65 A:90 D:90 |
| 4 | Certain | Pins persist across rk restarts → no restore-sweep; the relay startup sweep is deleted | User decided pins are persistent; tmux survives restarts (Constitution VI); a persisted pin is valid state, not an orphan | S:95 R:60 A:85 D:90 |
| 5 | Certain | Each pinned window is its OWN single-window session (`_rk-pin-<id>`), NOT co-located in one per-board session | Proven by live tmux probe: one session has one active-window pointer, so N visible panes require N sessions; co-location collides | S:95 R:75 A:98 D:95 |
| 6 | Certain | Membership = `@rk_board`/`@rk_home`/`@rk_board_order` session vars on pin-sessions; the `@rk_board` server-option encoding (+ fractional cross-server union, lazy/eager cleanup) is removed | Clarified — user confirmed | S:95 R:55 A:80 D:80 |
| 7 | Certain | The relay attaches the PTY directly to the resolved session (home or pin); the `rk-relay-*` ephemeral path and `@rk_owner_pid` stamping are removed | Clarified — user confirmed | S:95 R:50 A:85 D:85 |
| 8 | Certain | The `tmuxctl/` active-window event-derivation is scoped as "investigate, likely simplifiable" — NOT assumed deletable; `_rk-ctl` anchor + `exit-empty off` backstop stay | Clarified — user confirmed | S:95 R:60 A:80 D:75 |
| 9 | Certain | Board ordering reuses the existing fractional `ComputeOrderKey`, stored in `@rk_board_order` per pin-session | Clarified — user confirmed | S:95 R:80 A:60 D:55 |

9 assumptions (9 certain, 0 confident, 0 tentative, 0 unresolved).
