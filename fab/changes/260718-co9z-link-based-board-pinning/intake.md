# Intake: Link-Based Board Pinning — Dual Presence + Kill-vs-Unpin Legibility

**Change**: 260718-co9z-link-based-board-pinning
**Created**: 2026-07-18

## Origin

Promptless pipeline dispatch (`/fab-proceed`-style create-intake subagent, `{questioning-mode} = promptless-defer`) from a change description synthesized out of a prior design discussion. No questions were asked; the description below is the authoritative record of what was decided. Decisions captured verbatim in What Changes; agent-added implementation decisions are graded in Assumptions.

> **Link-based board pinning: dual presence in SESSIONS sidebar + board, with kill-vs-unpin consequence legibility**
>
> Today `Pin` (app/backend/internal/tmux/board.go:257) MOVES a window into a single-window `_rk-pin-<id>` session, so a pinned window disappears from its home session and the SESSIONS sidebar (pin-sessions are excluded from the snapshot at api/sse.go:1086). Goal: a pinned window stays visible in its original position in the SESSIONS pane AND on the board it's pinned to.
>
> **Decisions made:**
>
> 1. **Switch Pin from `move-window` to `link-window`.** Keep the exact pin-session mechanics — create `_rk-pin-<id>` with placeholder, STAMP-BEFORE-LINK the same three session options (`@rk_board`, `@rk_home`, `@rk_board_order`), then `tmux link-window` the target window in and kill the placeholder. The window remains a member of its home session (sidebar shows it natively, honestly derived per Constitution II) and of the pin-session (board membership derivation, ordering, Reorder unchanged).
> 2. **Pin-session stays single-window**, preserving the original move-model rationale (board.go:248 "removes window sharing and lets a board pane attach directly"): each board pane still attaches to a session whose only window is the pinned one, so panes keep independent current-window pointers and never fight.
> 3. **Relay resolution gains a deterministic preference.** `ResolveWindowSession` (internal/tmux/tmux.go:1264) currently assumes a window lives in exactly ONE session (invariant also stated at api/terminals_ws.go:394). With dual membership, the relay checks `has-session` on the derivable pin-session name (`PinSessionName(windowID)`) FIRST and attaches there when it exists, else attaches to the resolved home session. Side benefit: viewing a pinned window never changes the home session's active window.
> 4. **Unpin simplifies to `kill-session` on the pin-session** — tmux destroys a window only when its last link dies, so the window survives in home. The move-back/append and home-recreation logic in `Unpin` (board.go:391) largely disappears; `@rk_home` is retained only for the home-died-while-pinned recovery path (pin link became the last link).
> 5. **Board ✕ stays kill, but consequence-legible:**
>    - Verb discipline on board surfaces: retire "close"; only **Unpin** (safe — "removes from board, stays in `{session}`") and **Kill** (destructive — "closes the window everywhere") in tooltips, aria labels, palette entries.
>    - Confirm-gate the board kill with a dialog offering the safe alternative, reusing the existing kill-dialog pattern (rk-daemon warning in app/frontend/src/app.tsx): "Kill `{window}`? This closes it everywhere — including session `{home}`. [Unpin instead] [Kill] [Cancel]". Default focus on the safe action; keyboard-operable; works on touch. Palette close action routes through the same dialog.
>    - Tile-header pin-glyph = unpin stays unconfirmed (reversible action).
> 6. **Dual residence made ambient:** board pane header shows the home session (`{session} › {window}`, same crumb vocabulary as top bar) — derivable at render time from the sessions snapshot. Sidebar row for a pinned window gets a pin indicator (join already-fetched board entries on windowId) linking to the board.
>
> **Alternatives rejected:**
> - Ghost-row synthesis in the sidebar from `@rk_home` (keep move-based pin, frontend fakes the row): shows a window tmux says isn't in the session, can't preserve original index, violates derive-from-tmux honesty.
> - Flipping ✕ back to unpin: 260715-6jwn already flipped ✕ from unpin to kill once; flipping again churns muscle memory and removes quick-kill; the confirm dialog buys the same safety.
>
> **Constraints / consequences identified:**
> - "Exactly ONE session" invariant sites flip: terminals_ws.go:394 comment, sessions_test.go:80, ResolveWindowSession doc contract, Pin doc comment; tests asserting move-based invariants change.
> - Scope: only the BOARD kill gains the confirm dialog; sidebar window ✕ semantics unchanged (blast radius unchanged there).
> - Waiting/rollup surfaces: a pinned window's waiting badge lights its home session row again (intended feature win, watch for double-count across board header + session row — separate surfaces, acceptable).
> - Kill/rename affect both surfaces (same window entity — correct). Simultaneous viewing from sidebar row and board pane = two tmux clients on the pin-session; tmux `window-size` policy applies (already true today via direct URL, not new).
> - Keyboard-first (Constitution V): all new actions palette-reachable; dialog keyboard-operable.

## Why

1. **Pain point — pinning a window makes it vanish from its home.** `Pin` physically `move-window`s the target into `_rk-pin-<id>`; `parseSessions` filters every `_rk-pin-*` name at the single chokepoint (app/backend/internal/tmux/tmux.go:554), so the window disappears from the SESSIONS sidebar, its session's window list, its original index, and every session-scoped rollup (waiting badges, tile previews). Board membership silently costs sidebar presence — users lose track of where their agent windows live, and the sidebar lies by omission about the home session's contents.

2. **Pain point — the board ✕ has an illegible blast radius.** Since 260715-6jwn the board top-bar ✕ / `Board: Close Focused Pane` palette action performs a real unconfirmed kill (closePane on the focused tile, app/frontend/src/components/board/board-page.tsx:411-422,614-623). Nothing on the board surface distinguishes "remove from this board" (unpin — safe, reversible) from "destroy the window everywhere including its home session" (kill). One misclick on a board destroys a live agent window.

3. **Consequence if not fixed:** the dual-bookkeeping confusion compounds as boards get used more — every pinned window is a sidebar hole, and every board ✕ press is an unguarded destructive action against a window whose home-session identity the user can't even see.

4. **Why this approach:** `link-window` keeps membership *tmux-derived truth* on both surfaces (Constitution II — the sidebar shows the window because tmux says it's in the home session, at its real index), while preserving the entire pin-session mechanism (board derivation from `_rk-pin-*` session options, single-window attach semantics, ordering, Reorder, idempotency) unchanged. Rejected: ghost-row synthesis (frontend fakes a row tmux disowns — dishonest, index-lossy) and re-flipping ✕ to unpin (260715-6jwn already flipped it once; churning muscle memory again removes quick-kill; a confirm dialog with an "Unpin instead" escape buys the same safety without the flip).

## What Changes

### 1. Backend — `Pin` switches from `move-window` to `link-window` (board.go)

`Pin` (app/backend/internal/tmux/board.go:257) keeps its exact sequence with one verb change and a doc-contract update:

- Create `_rk-pin-<id>` detached with its placeholder window; capture placeholder window ID (unchanged, board.go:327-342).
- **STAMP-BEFORE-LINK** (rename of STAMP-BEFORE-MOVE, board.go:344-366): write `@rk_home`, `@rk_board`, `@rk_board_order` onto the still-empty pin-session first; a stamp failure still rolls back by killing the placeholder-only pin-session with the window untouched. The crash-safety rationale carries over verbatim — after a successful link, `@rk_home` is already durable.
- Replace `MoveWindowToSession(windowID, pinSession, server)` (board.go:371) with a **link**: `tmux link-window -s <windowID> -t <pinSession>:` (new `LinkWindowToSession` helper in internal/tmux, mirroring `MoveWindowToSession` at tmux.go:1452 — same `exec.CommandContext` + explicit-argv discipline, Constitution I). Kill the placeholder afterwards (unchanged).
- Result: the window is a member of BOTH its home session (sidebar shows it natively at its original index — tmux never removed it) and the pin-session (sole window after placeholder kill).
- Pin doc comment rewritten: the window **stays** in its home session; the pin-session grants the board an attach target. Idempotent re-pin path (board.go:281-298) unchanged (re-stamp board, repair order key).
- `@rk_home` is still stamped (decision 4 retains it for the recovery path), and the resolve-home call before stamping (board.go:302) still runs pre-link when the window has exactly one session, so it is unambiguous.

### 2. Backend — `Unpin` simplifies to `kill-session` + last-link recovery (board.go)

`Unpin` (app/backend/internal/tmux/board.go:391) keeps validation, idempotency (missing pin-session → silent success), and the board-match guard (board.go:418-424), then:

- **Normal path:** the window is still linked in a live home session → `kill-session` on the pin-session. tmux destroys a window only when its **last** link dies, so killing the pin-session removes the pin link and the window survives in home, at its existing position (no move-back, no append, no index loss). The `MoveWindowToSession`-back + `killPinSessionIfPresent` dance and the home-recreation-by-rename logic largely disappear.
- **Recovery path (pin link is the LAST link):** if the home session died while pinned (or the pin predates this change — see Assumptions #10), `kill-session` would destroy the window. Detect last-link before killing (e.g. the window's linked-session count, or membership check against the live home / any non-pin session) and instead take today's recovery behavior: home recorded and dead → rename the pin-session to the home name and clear the three membership options (board.go:469-481); `@rk_home` empty/corrupt → rename to `recovered<id>` (board.go:458-467). A window is never left unrecoverable.

### 3. Backend — dual-membership resolution + relay pin-preference (tmux.go, terminals_ws.go)

- **`ResolveWindowSession` contract flips** (internal/tmux/tmux.go:1250-1281): the doc contract "a window lives in exactly ONE session" is no longer true for pinned windows. A single `display-message -t @N -p "#{session_name}"` may report either linked session (tmux picks one — order unspecified). The function's contract becomes **"resolve the window's home (non-pin) session"**: when the naive resolve returns a `_rk-pin-*` name, re-resolve deterministically to the non-pin owner (e.g. enumerate `list-windows -a -F "#{session_name}<sep>#{window_id}"` and pick the session not carrying `PinSessionPrefix`; a window whose ONLY link is its pin-session — home died — legitimately resolves to the pin-session). Not-found contract (empty output / `can't find window` → `window %q not found`) unchanged.
- **Relay attach preference** (api/terminals_ws.go:394-410): before resolving, check `has-session -t =<PinSessionName(windowID)>`; when the pin-session exists, attach there (and scope `SelectWindowInSession` to it — selecting the sole window is a no-op in effect), else resolve home and attach as today. Side benefit (decided): merely viewing a pinned window — board pane or direct URL — never moves the home session's active-window pointer.
- **Invariant-comment flips:** terminals_ws.go:394 ("a window lives in exactly ONE session"), terminals_ws.go:47 flow comment, the `Pin`/`Unpin` doc comments, tmux.go:546-553 parseSessions filter comment ("physically MOVED" → linked), sse.go realSessionNameSet comment context, and api/sessions_test.go:80's fake-comment block (`listWindowsBySession` "moved-based board world" modeling) — plus every test asserting move-based invariants (window absent from home after Pin, move-back on Unpin).
- **Unchanged consumers, verified:** `boards.go` GET join (boards.go:95-115) reads window metadata from the pin-session by name — still holds the window under link. `windowExistsOnServer` (boards.go:366) — both its pin-session fast path and home-session scan now succeed; behavior preserved. `parseSessions` pin-filter (tmux.go:554) stays — the pin-session itself remains hidden; the window now appears via its home membership. `ProjectRoot` (internal/sessions/sessions.go:779) and `handleWindowSelect` (api/windows.go:208) consume the flipped ResolveWindowSession and get home-session semantics (see Assumptions #11 for the select seam).
- Board API endpoints (`POST /api/boards/{name}/pin|unpin|reorder`, `GET /api/boards*`) keep their routes, bodies, and validation — only the tmux-level semantics beneath them change (Constitution IX untouched).

### 4. Frontend — board kill becomes confirm-gated and verb-disciplined

- **Verb discipline on board surfaces:** retire "close". The two actions are **Unpin** (safe — tooltip/aria copy "removes from board, stays in `{session}`") and **Kill** (destructive — "closes the window everywhere"). Applies to the board top-bar ✕ slot, tile-header glyph, palette entries (`Board: Close Focused Pane` → kill-verb naming routed through the dialog), tooltips, and aria labels. Sidebar and terminal-mode ✕ vocabulary/semantics are OUT of scope (blast radius unchanged there).
- **Confirm dialog** (reuse the existing `Dialog` kill-confirm pattern with contextual warning, per the rk-daemon precedent at app/frontend/src/app.tsx:2861-2887):

  > **Kill `{window}`?** This closes it everywhere — including session `{home}`.
  > `[Unpin instead]` `[Kill]` `[Cancel]`

  Default focus on the safe action (`Unpin instead`); fully keyboard-operable (Tab/Enter/Escape, matching existing Dialog); works on touch. When `{home}` is not derivable (legacy pin / home died — window absent from the sessions snapshot), fall back to window-only copy. The confirmed **Kill** kills the window entity (window-kill — the "closes it everywhere" semantics; see Assumptions #7), and `[Unpin instead]` invokes the shared `unpinFocused` derivation (board-page.tsx:419).
- **Routing:** the board top-bar ✕ (focused tile) and the board palette kill entry both open this dialog instead of firing immediately. The tile-header pin-glyph unpin (board-header.tsx:35-66) stays **unconfirmed** — unpin is reversible.
- Constitution V: dialog + both actions palette-reachable; existing board palette parity structure (board-page.tsx `boardRouteActions`) extends rather than forks.

### 5. Frontend — dual residence made ambient

- **Board pane header crumb:** `{session} › {window}` using the top-bar crumb vocabulary (`›` separator), where `{session}` is the home session derived at render time by joining the entry's `windowId` against the SSE sessions snapshot (`ctx.sessionsByServer`) — possible now precisely because the window is linked into a visible session (the board-page.tsx:391-402 comment explaining why this lookup was impossible under move flips). Fallback: window-only header when no visible session carries the window.
- **Sidebar pin indicator:** the window row of a pinned window shows a pin indicator that links/navigates to `/board/{board}`. The join infrastructure exists — `useWindowPins()` already aggregates the pin map across servers/boards into `pinnedSet`/`pinnedToBoard` (sidebar/index.tsx:290-298) and `window-row.tsx` already renders a `PinIcon` fill driven by `isPinnedToAny` — under move-pinning those rows were invisible, so the states were mostly latent. New bit: the pinned row's indicator becomes a navigation affordance to the owning board (a window has exactly one pin-session → exactly one board). Palette-reachable equivalent per Constitution V.
- **Waiting/rollup surfaces:** no code sought — a pinned window's home-row waiting badge re-lights automatically once the window is home-linked (intended win). Board-header badge + session-row badge may both show for the same window — separate surfaces, accepted in the discussion.

<!-- assumed: explicit navigation (selectWindow POST → handleWindowSelect) resolves to the HOME session for pinned windows, so the 260715-38kg SSE active-window confirmation + URL-writeback seams keep working unchanged; the decided "viewing never changes home's active window" side benefit is delivered by the RELAY attach preference (board panes, direct-URL views), not by the explicit click-nav path -->

### 6. Migration / legacy pins

No auto-migration sweep. Pins created under the move model present exactly as the "pin link is the last link" case: board rendering, relay attach, and Reorder keep working; the sidebar continues not to show them (tmux truth — the window really isn't in home); `Unpin`'s last-link recovery path restores them to home. Unpin + re-pin converts a legacy pin to link-based. (Assumptions #9, #10.)

### Non-Goals

- Sidebar window ✕ / terminal-mode ✕ semantics (unchanged; only the BOARD kill gains the dialog).
- Multi-board membership for one window (pin-session model stays one-pin-per-window; re-pin to another board re-stamps).
- Restoring original window index on unpin — obsolete: the window never leaves home, so its position is simply never disturbed.
- tmux `window-size` policy tuning for simultaneous viewers (two clients on the pin-session was already possible via direct URL).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) pin-sessions flip from move-based to link-based (dual membership, STAMP-BEFORE-LINK, unpin = kill-session + last-link recovery); ResolveWindowSession home-session contract; relay pin-session attach preference
- `run-kit/ui-patterns`: (modify) board kill confirm-gate + Unpin/Kill verb discipline (updates the 260715-6jwn "✕ = close-pane kill, no confirm" record), board pane-header `{session} › {window}` crumb, sidebar pinned-row indicator → board link
- `run-kit/architecture`: (modify) /ws/terminals per-stream attach now prefers the pin-session; ResolveWindowSession "exactly one session" claims corrected where stated

## Impact

**Backend** (`app/backend/`):
- `internal/tmux/board.go` — Pin (link verb, doc), Unpin (kill-session + last-link recovery), comments
- `internal/tmux/tmux.go` — new `LinkWindowToSession` helper; `ResolveWindowSession` dual-membership hardening + doc contract; parseSessions filter comment
- `api/terminals_ws.go` — pin-session-first attach preference; invariant comments
- `api/windows.go` — handleWindowSelect consumes home-resolving ResolveWindowSession (behavioral note, Assumptions #11)
- `api/boards.go`, `api/sse.go`, `internal/sessions/sessions.go` — comment/contract touch-ups; join paths verified unchanged
- Tests: `internal/tmux` board/tmux tests, `api/sessions_test.go` (the `listWindowsBySession` move-world fake at :80 and dependents), `api/boards_test.go`, terminals-ws tests — move-based assertions flip to link-based (window present in home AND pin-session; unpin leaves home intact)

**Frontend** (`app/frontend/src/`):
- `components/board/board-page.tsx` — kill confirm dialog state + routing (top-bar ✕ slot handler, `board-close-focused` palette action), kill = window-kill, `[Unpin instead]` wiring
- `components/board/board-header.tsx` — `{session} › {window}` crumb; unpin glyph copy
- `components/sidebar/window-row.tsx`, `components/sidebar/index.tsx` — pinned-row indicator → board navigation (reusing `useWindowPins`)
- `api/client.ts` — window-kill call from board context (existing killWindow path)
- Unit tests colocated; Playwright e2e for the dialog (keyboard focus order, Unpin-instead path, palette routing) + sidebar dual-presence — each `.spec.ts` with its `.spec.md` companion (constitution: Test Companion Docs)

**Constitution touchpoints:** I (new tmux verb via ctx+argv helpers), II (dual presence stays fully tmux-derived — the core motivation), V (dialog + all new actions keyboard/palette-reachable), IX (no new endpoints/verbs).

**Risk concentration:** the dual-membership resolution seam (every `ResolveWindowSession` consumer + the frontend active-window-keyed seams — pending-switch confirmation, URL writeback, sidebar highlight) is where regressions would surface; Assumptions #8 and #11 pin the intended behavior.

## Open Questions

- None blocking — the design discussion resolved the major decisions. Agent-decided implementation details are graded in Assumptions (#7–#12); #11 is the one Tentative worth a `/fab-clarify` glance.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin switches `move-window` → `link-window`, keeping pin-session mechanics exactly (placeholder, STAMP-BEFORE-LINK of `@rk_board`/`@rk_home`/`@rk_board_order`, kill placeholder) | Discussed — decision 1, verbatim | S:90 R:70 A:85 D:90 |
| 2 | Certain | Pin-session stays single-window; board panes attach directly with independent current-window pointers | Discussed — decision 2 preserves board.go:248 rationale | S:90 R:75 A:90 D:90 |
| 3 | Certain | Relay checks `has-session` on `PinSessionName(windowID)` FIRST, attaches there when present, else resolved home | Discussed — decision 3 | S:90 R:75 A:85 D:85 |
| 4 | Certain | Unpin = `kill-session` on the pin-session; `@rk_home` retained only for the last-link (home-died) recovery path | Discussed — decision 4 | S:85 R:70 A:85 D:85 |
| 5 | Certain | Board ✕ stays kill but confirm-gated with `[Unpin instead]` default-focused; Unpin/Kill verb discipline on board surfaces; tile-header pin-glyph unpin stays unconfirmed; palette routes through the dialog | Discussed — decision 5, dialog copy given verbatim | S:90 R:80 A:85 D:85 |
| 6 | Certain | Dual residence ambient: pane-header `{session} › {window}` crumb (render-time snapshot join) + sidebar pinned-row indicator linking to the board | Discussed — decision 6 | S:85 R:85 A:85 D:85 |
| 7 | Confident | The confirmed board **Kill** performs a window-kill (window entity destroyed everywhere), retiring the pane-level close verb on board surfaces; current ✕ is closePane (active pane) — the multi-pane nuance was not discussed | Verb discipline "retire close" + decided copy "closes the window everywhere" imply window semantics; frontend-scoped and easily revised | S:60 R:80 A:55 D:50 |
| 8 | Confident | `ResolveWindowSession` keeps its name/not-found contract but resolves the **home (non-pin)** session under dual membership (re-resolve when the naive result is `_rk-pin-*`); the relay layers its pin preference above it | Decision 3's "else attaches to the resolved home session" requires a home-deterministic resolve; tmux target resolution across links is order-unspecified | S:70 R:70 A:75 D:70 |
| 9 | Confident | Unpin detects "pin link is the last link" before kill-session (linked-session count or live non-pin membership check) and takes today's recovery behavior (rename to `@rk_home` / `recovered<id>`) | Direct consequence of decision 4's retained recovery path; mechanism choice is plan-level | S:60 R:70 A:75 D:70 |
| 10 | Confident | Legacy move-based pins get NO auto-migration; they keep working via the last-link paths and convert on unpin/re-pin | Not addressed in discussion; recovery path already guarantees correctness, migration is optional polish addable later | S:40 R:70 A:65 D:55 |
| 11 | Tentative | Explicit navigation (`selectWindow` POST → handleWindowSelect) resolves to the **home** session for pinned windows, keeping the 260715-38kg SSE active-window confirmation, URL writeback, and sidebar highlight seams intact; the decided "viewing never changes home's active window" side benefit is delivered by the relay attach preference (board panes, direct-URL views), not by click-nav | Not discussed; alternative (select the pin-session too) preserves the side benefit universally but breaks the SSE-confirm seam (5s bounce-back toast on every pinned-window click) unless the intricate pending-switch machinery gains a pinned carve-out — front-runner is the seam-preserving reading | S:45 R:50 A:50 D:45 |
| 12 | Confident | `{home}` in the dialog and the pane-header crumb are frontend render-time joins on the sessions snapshot; when home is not derivable (legacy pin / home died) both fall back to window-only copy | Decision 6 specifies render-time derivability; fallback is the only graceful degradation consistent with it | S:65 R:85 A:80 D:75 |
| 13 | Certain | Scope guards: only the BOARD kill gains the dialog (sidebar/terminal ✕ unchanged); waiting badge re-lighting the home row is an intended win, board-header + session-row double-showing accepted | Discussed — constraints list, verbatim | S:85 R:80 A:85 D:85 |
| 14 | Certain | Sidebar pin indicator reuses the existing `useWindowPins` join (`pinnedSet`/`pinnedToBoard`) and window-row `PinIcon` (`isPinnedToAny`) — only the board-link navigation affordance is new | Verified in code: sidebar/index.tsx:290-298 aggregates the pin map today; window-row.tsx already renders the pin glyph | S:70 R:85 A:90 D:80 |

14 assumptions (8 certain, 5 confident, 1 tentative, 0 unresolved).
