# Plan: Link-Based Board Pinning — Dual Presence + Kill-vs-Unpin Legibility

**Change**: 260718-co9z-link-based-board-pinning
**Intake**: `intake.md`

## Requirements

### Backend — Pin (link, not move)

#### R1: Pin links the window instead of moving it
`Pin` (`app/backend/internal/tmux/board.go`) SHALL make the target window a member of BOTH its home session AND its `_rk-pin-<id>` pin-session, using `tmux link-window` in place of `move-window`. All existing pin-session mechanics (placeholder creation + kill, STAMP-BEFORE-LINK of `@rk_home`/`@rk_board`/`@rk_board_order`, idempotent re-pin re-stamp, rollback on stamp/link failure) SHALL be preserved.

- **GIVEN** a window `@42` living in home session `dev`
- **WHEN** `Pin(ctx, server, "@42", "work")` runs
- **THEN** `@42` remains a member of `dev` (visible in the sidebar at its original index) AND is also the sole window of `_rk-pin-42`
- **AND** `_rk-pin-42` carries `@rk_home=dev`, `@rk_board=work`, and a valid `@rk_board_order`

#### R2: Pin-session stays single-window
The pin-session SHALL contain exactly one window (the linked target) after the placeholder is killed, preserving the independent-current-window-pointer property that lets each board pane attach directly.

- **GIVEN** a freshly created `_rk-pin-<id>` with a placeholder window
- **WHEN** the target is linked in and the placeholder killed
- **THEN** `list-windows -t <pinSession>` reports exactly one window, the target

#### R3: LinkWindowToSession helper
A new `LinkWindowToSession(windowID, dstSession, server)` helper SHALL be added to `internal/tmux/tmux.go`, mirroring `MoveWindowToSession` (same signature, `exec.CommandContext` + explicit argv, `ExactSessionTarget` on the destination), issuing `tmux link-window -s <windowID> -t =<dstSession>:`.

- **GIVEN** a window `@42` in session `dev`
- **WHEN** `LinkWindowToSession("@42", "pin", server)` runs
- **THEN** `@42` is a member of both `dev` and `pin`, and its window ID is unchanged

### Backend — Unpin (kill-session + last-link recovery)

#### R4: Unpin kills the pin-session; the window survives in home
`Unpin` SHALL, on the normal path (window still linked in a live home session), `kill-session` the pin-session. Because tmux destroys a window only when its LAST link dies, the window survives in home at its existing position — no move-back, no append, no index loss. Validation, idempotency (missing pin-session → silent success), and the board-match guard SHALL be preserved.

- **GIVEN** `@42` linked into live home `dev` and pin-session `_rk-pin-42`
- **WHEN** `Unpin(ctx, server, "@42", "work")` runs
- **THEN** `_rk-pin-42` is gone AND `@42` is still in `dev` at its original position

#### R5: Last-link recovery when home is dead
When the pin link is the LAST remaining link (home session died while pinned, or a legacy move-based pin), a plain `kill-session` would destroy the window, so `Unpin` SHALL detect this and instead take the recovery behavior: `@rk_home` recorded and dead → rename the pin-session to the home name and clear the three membership options; `@rk_home` empty/corrupt → rename to `recovered<id>`. A window SHALL never be left unrecoverable.

- **GIVEN** `@42` whose only link is `_rk-pin-42` (home `dev` was killed), `@rk_home=dev`
- **WHEN** `Unpin` runs
- **THEN** `_rk-pin-42` is renamed to `dev`, `@42` resurfaces in the sidebar under `dev`, and the membership options are cleared

### Backend — Dual-membership resolution + relay pin-preference

#### R6: ResolveWindowSession resolves the home (non-pin) session
`ResolveWindowSession` SHALL keep its name and not-found contract but, under dual membership, resolve the window's HOME (non-pin) session: when the naive `display-message` result is a `_rk-pin-*` name, re-resolve deterministically to the non-pin owner by enumerating `list-windows -a` and picking the session for `@N` that does not carry `PinSessionPrefix`. A window whose ONLY link is its pin-session (home died) SHALL legitimately resolve to the pin-session.

- **GIVEN** `@42` linked into home `dev` and `_rk-pin-42`
- **WHEN** `ResolveWindowSession(ctx, server, "@42")` runs
- **THEN** it returns `dev` (the non-pin session), regardless of which link tmux reports first
- **AND GIVEN** `@42` whose only link is `_rk-pin-42`
- **WHEN** resolve runs
- **THEN** it returns `_rk-pin-42`
- **AND GIVEN** a missing `@99`
- **WHEN** resolve runs
- **THEN** it returns `window "@99" not found` (contract unchanged)

#### R7: Relay attach prefers the pin-session
The relay per-stream attach (`api/terminals_ws.go` `attachStream`) SHALL, before resolving, check `has-session` on `PinSessionName(windowID)`; when the pin-session exists it SHALL attach there (scoping `SelectWindowInSession` to it), else resolve home and attach as today. Merely viewing a pinned window SHALL NOT move the home session's active-window pointer.

- **GIVEN** a board pane opens a stream for pinned `@42`
- **WHEN** `attachStream` runs
- **THEN** it attaches to `_rk-pin-42` (its sole window is permanently active), leaving `dev`'s active-window pointer untouched
- **AND GIVEN** a stream for an unpinned `@7`
- **WHEN** `attachStream` runs
- **THEN** it resolves and attaches to `@7`'s home session as today

#### R8: Invariant comments corrected; unchanged consumers verified
All "a window lives in exactly ONE session" / "physically MOVED" / "move-based" invariant comments across the touched files SHALL be corrected to reflect dual membership. The GET-board join, `windowExistsOnServer`, `parseSessions` pin-filter, `handleWindowSelect`, and the SSE snapshot pin-exclusion SHALL continue to behave as before (verified, comment-only touch-ups where needed).

- **GIVEN** the source after the change
- **WHEN** grepping for "exactly ONE session" / "physically MOVED" / "move-based" in `app/backend/`
- **THEN** no stale move-model invariant remains describing pin membership

### Frontend — Board kill confirm-gated + verb discipline

#### R9: Board kill routes through a confirm dialog
The board top-bar ✕ (focused tile) and the board palette kill entry SHALL open a confirm dialog instead of firing immediately. The dialog SHALL read `Kill {window}? This closes it everywhere — including session {home}.` with buttons `[Unpin instead]` (default-focused, safe), `[Kill]` (destructive), `[Cancel]`, reusing the existing `Dialog` component (Escape/Tab/backdrop already handled). When `{home}` is not derivable (legacy pin / home died — window absent from the sessions snapshot), the copy SHALL fall back to window-only. The confirmed **Kill** SHALL perform a window-kill (`killWindow` — closes the window everywhere); `[Unpin instead]` SHALL invoke the shared `unpinFocused` derivation. The tile-header pin-glyph unpin SHALL stay unconfirmed.

- **GIVEN** a board with a focused tile for `@42` (home `dev`)
- **WHEN** the user activates the top-bar ✕ or the `Board: Kill Focused Pane` palette entry
- **THEN** the confirm dialog appears with `Unpin instead` focused and copy naming `dev`
- **AND WHEN** the user confirms Kill
- **THEN** `killWindow(server, @42)` is called (window destroyed everywhere)
- **AND WHEN** the user chooses `Unpin instead`
- **THEN** the focused pane is unpinned via the shared unpin handler, no confirm

#### R10: Unpin / Kill verb discipline on board surfaces
Board surfaces SHALL use only **Unpin** (safe — "removes from board, stays in `{session}`") and **Kill** (destructive — "closes the window everywhere"); the "close"/"close pane" verb SHALL be retired on board surfaces (tooltips, aria labels, palette entries). Sidebar and terminal-mode ✕ vocabulary/semantics are OUT of scope.

- **GIVEN** the board top-bar ✕ and its palette entry
- **WHEN** their labels/aria/tooltips are read
- **THEN** they say "Kill" (not "Close pane"), and the palette entry is `Board: Kill Focused Pane`

### Frontend — Dual residence made ambient

#### R11: Board pane-header home crumb
The board pane header SHALL show `{session} › {window}` where `{session}` is the home session derived at render time by joining the entry's `windowId` against the SSE sessions snapshot (`ctx.sessionsByServer`). When no visible session carries the window (legacy pin / home died), the header SHALL fall back to window-only.

- **GIVEN** a pinned `@42` whose home session `dev` is visible in the snapshot
- **WHEN** the board pane header renders
- **THEN** it shows `dev › win-a`
- **AND GIVEN** a pinned window absent from the snapshot
- **WHEN** the header renders
- **THEN** it shows the window name alone

#### R12: Sidebar pinned-row indicator surfaces a board-navigation affordance
A pinned window's sidebar row SHALL show its pin indicator (reusing the existing `useWindowPins`/`PinIcon` infrastructure). Because the pin indicator is the existing pin-management affordance, activating it opens the pin popover, which — for a pinned window — offers a "Go to {board}" row that navigates to the owning board (`/board/{board}`). This is a deliberate two-step interaction (indicator → popover → "Go to {board}"), reusing the pin popover rather than hijacking the indicator's existing pin/unpin management role. Since a window has exactly one pin-session, it maps to exactly one board. Keyboard/palette reachability per Constitution V.

- **GIVEN** `@42` pinned to board `work`, visible in the sidebar (now that it stays home-linked)
- **WHEN** the user activates its pin indicator
- **THEN** the pin popover opens showing a "Go to work" navigation row
- **AND WHEN** the user activates "Go to work"
- **THEN** the app navigates to `/board/work`

### Non-Goals

- Sidebar window ✕ / terminal-mode ✕ semantics — unchanged; only the BOARD kill gains the dialog.
- Multi-board membership for one window — the one-pin-per-window model stays; re-pin re-stamps.
- Restoring original window index on unpin — obsolete; the window never leaves home, so position is never disturbed.
- tmux `window-size` policy tuning for simultaneous viewers — pre-existing behavior, unchanged.
- Auto-migration of legacy move-based pins — they work via the last-link recovery path and convert on unpin/re-pin.

### Design Decisions

1. **Pin uses `link-window`, keeping the entire pin-session mechanism** — *Why*: dual membership stays fully tmux-derived (Constitution II) — the sidebar shows the window because tmux says it's home, and the board derives from `_rk-pin-*` session options exactly as before. *Rejected*: ghost-row synthesis (frontend fakes a row tmux disowns — dishonest, index-lossy).
2. **Board ✕ stays kill but confirm-gated with an `Unpin instead` escape** — *Why*: 260715-6jwn already flipped ✕ from unpin to kill once; re-flipping churns muscle memory and removes quick-kill. A confirm dialog buys the same safety without the flip. *Rejected*: flipping ✕ back to unpin.
3. **Confirmed board Kill is a window-kill (`killWindow`), not `close-pane`** — *Why*: the decided copy "closes it everywhere" is window-entity semantics; `killWindow -t @N` destroys all links (home + pin) in one call. The prior board ✕ was a `close-pane` (active-pane kill); the multi-pane nuance was not discussed and this is frontend-scoped/easily revised (Assumption #7).
4. **ResolveWindowSession re-resolves to the non-pin home under dual membership** — *Why*: decision 3's "else attaches to the resolved home session" requires a home-deterministic resolve, and tmux target resolution across links is order-unspecified. The relay layers its pin-session preference ABOVE resolve. *Rejected*: leaving resolve ambiguous (would break the home-select and the click-nav seam).
5. **Home crumb + sidebar link are frontend render-time joins on the sessions snapshot** — *Why*: the window is now linked into a visible home session, so the join is possible; render-time derivation stays honest (Constitution II) with graceful window-only fallback.

## Tasks

### Phase 1: Backend tmux verb + resolution

- [x] T001 Add `LinkWindowToSession(windowID, dstSession, server string) error` to `app/backend/internal/tmux/tmux.go`, mirroring `MoveWindowToSession` (`link-window -s <windowID> -t =<dstSession>:` via `ExactSessionTarget`, `withTimeout`, explicit argv). Add doc comment. <!-- R3 -->
- [x] T002 Rewrite `ResolveWindowSession` in `app/backend/internal/tmux/tmux.go` to resolve the home (non-pin) session: keep the naive `display-message` fast path, but when the result has `PinSessionPrefix`, re-resolve via a `list-windows -a -F "#{session_name}\t#{window_id}"` enumeration that picks the non-pin session owning `@N`; fall back to the pin-session only when it is the sole link. Preserve the not-found contract. Update the doc comment (flip "exactly ONE session" / "move-based"). <!-- R6 -->

### Phase 2: Backend Pin/Unpin link semantics

- [x] T003 Switch `Pin` (`app/backend/internal/tmux/board.go`) from `MoveWindowToSession` to `LinkWindowToSession`. Rename STAMP-BEFORE-MOVE → STAMP-BEFORE-LINK in code comments; rewrite the `Pin` doc comment (window STAYS in home, pin-session grants a board attach target). Keep placeholder create/kill, stamp ordering, rollback, and idempotent re-pin unchanged. <!-- R1 R2 -->
- [x] T004 Rewrite `Unpin` (`app/backend/internal/tmux/board.go`): normal path = detect the window is still linked in a live non-pin session and `kill-session` the pin-session (window survives in home). Add last-link detection (the window's only membership is the pin-session) that takes today's recovery behavior (rename to `@rk_home` / `recovered<id>`, clear options). Update the doc comment and remove the move-back/append logic. <!-- R4 R5 --> <!-- rework RESOLVED: last-link recovery with a LIVE recorded home now LINKS the window into that live home then kills the pin-session (lands in the real home), not a stray recovered<id>; recovered<id> rename is collision-guarded via `recoverPinToRenamedSession` (suffix fallback); the dead-home rename to `@rk_home` can no longer collide (guarded by has-session). -->

### Phase 3: Backend relay + comment/contract corrections

- [x] T005 Add the pin-session-first attach preference to `attachStream` in `app/backend/api/terminals_ws.go`: before resolving, `has-session` on `PinSessionName(op.WindowID)`; if present, use the pin-session as the attach session (and scope the select to it), else keep today's resolve-home path. Flip the "exactly ONE session" / "move-based" comments at lines ~44-52 and ~394-396. <!-- R7 R8 -->
- [x] T006 Correct move-model invariant comments (no behavior change) in: `app/backend/internal/tmux/tmux.go` (PinSessionPrefix doc ~195, parseSessions filter ~546-553), `app/backend/internal/tmux/board.go` (residual placeholder/sole-window comments), `app/backend/api/boards.go` (GET join ~93-101, `windowExistsOnServer` ~354-362), and `app/backend/api/sse.go` (~1312-1317 poll comment). Verify GET-join, `windowExistsOnServer`, `parseSessions`, `handleWindowSelect`, SSE snapshot exclusion are behaviorally unchanged. <!-- R8 -->

### Phase 4: Backend tests

- [x] T007 Add `TestLinkWindowToSession_linksAndPreservesID` to `app/backend/internal/tmux/tmux_test.go` (window present in BOTH source and dst after link, id preserved). <!-- R3 -->
- [x] T008 Flip move-based assertions in `app/backend/internal/tmux/board_test.go`: `TestPin_*` (window MUST remain in home after Pin; pin-session holds the linked window), `TestUnpin_RestoresToLiveHome` (window stays in home, pin-session gone, no move-back), `TestUnpin_RecreatesDeadHome` / `TestUnpin_HomelessPinRecoversWindow` (last-link recovery), and the associated move-framed comments. <!-- R1 R4 R5 --> <!-- rework RESOLVED: added `TestUnpin_LegacyPinLiveHomeRestoresIntoHome` (unlink from home → last-link state with LIVE recorded home → window restored INTO that home, no stray recovered<id>) and `TestUnpin_RecoveryNameCollisionFallsBackToSuffix` (stale recovered<id> → suffix fallback, no strand). -->
- [x] T009 Update `ResolveWindowSession` tests in `app/backend/internal/tmux/tmux_test.go`: flip the doc comment; add a dual-membership case asserting home (non-pin) resolution and a last-link case asserting pin-session resolution; keep the not-found case. <!-- R6 -->
- [x] T010 Update `app/backend/api/sessions_test.go` (the `listWindowsBySession` fake comment at ~80 — a pinned window now appears in BOTH its pin-session AND home) and `app/backend/api/boards_test.go` (`TestBoard_GET_byName_windowInPinSession` fake premise — the window ALSO appears in home; the join still reads from the pin-session). Update `app/backend/api/relay_test.go` move-model comments (~260, ~279). <!-- R8 -->

### Phase 5: Frontend board kill dialog + verb discipline

- [x] T011 Add `killWindow` import + a kill-confirm dialog to `app/frontend/src/components/board/board-page.tsx`: state for the pending-kill target (focused pane), a `requestKillFocused` opener, and a `Dialog` (mirroring the app.tsx server-kill pattern) with copy `Kill {window}? This closes it everywhere — including session {home}.`, `[Unpin instead]` (default focus, calls `unpinFocused`), `[Kill]` (calls `killWindow` then `refetch`), `[Cancel]`. Derive `{home}` + `{window}` by joining the focused entry's `windowId` against `ctx.sessionsByServer`, with window-only fallback. <!-- R9 -->
- [x] T012 Route the board palette kill entry through the dialog: rename `board-close-focused` → `board-kill-focused` labeled `Board: Kill Focused Pane`, `onSelect: requestKillFocused`. <!-- R9 R10 -->
- [x] T013 Route the board top-bar ✕ through the dialog: add an optional `onRequestKill?: () => void` to the top-bar slot (`top-bar-slot-context.tsx`) and register it from `board-page.tsx`; in `top-bar.tsx`, when `mode === "board"` and `onRequestKill` is present, the ✕ (`ClosePaneButton`/`ClosePaneMenuRow`) calls `onRequestKill` instead of `closePane`, and its label/aria/tooltip become "Kill". Terminal-mode ✕ unchanged. <!-- R9 R10 -->

### Phase 6: Frontend dual residence

- [x] T014 Add the `{session} › {window}` home crumb to `app/frontend/src/components/board/board-header.tsx`: accept a resolved `homeSession?: string` (derived by the parent from `ctx.sessionsByServer`) and render `{homeSession} › {windowName}` with the `›` separator, falling back to `{windowName} · {server}` (or window-only) when `homeSession` is absent. Thread the derivation through `board-pane.tsx` from `board-page.tsx`. <!-- R11 -->
- [x] T015 Make the sidebar pinned-row pin indicator a board-navigation affordance: extend `useWindowPins` (or derive in `sidebar/index.tsx`) to expose the board name a window is pinned to, thread it to `window-row.tsx`, and wire the pin button (when `isPinnedToAny`) to navigate to `/board/{board}` (keyboard/palette reachable). <!-- R12 -->

### Phase 7: Frontend tests

- [x] T016 Update the `board-header.test.tsx` unit test for the `{session} › {window}` crumb; add/adjust `window-row.test.tsx` (or `pin-icon` / sidebar index test) for the pinned-row navigation affordance. <!-- R11 R12 -->
- [x] T017 Rework the `board-close-and-unpin.spec.ts` + `.spec.md` e2e: the top-bar ✕ now opens the confirm dialog (assert dialog appears, `Unpin instead` focused, keyboard operability), the confirmed Kill fires `POST /api/windows/{id}/kill` (window-kill), and `Unpin instead` fires `POST /unpin`; add a sidebar dual-presence assertion (a pinned window still appears in the sidebar). Keep the tile-header unpin (unconfirmed) assertion. <!-- R9 R11 R12 --> <!-- rework RESOLVED: .spec.md rewritten to mirror the .spec.ts body — dual-presence section now documents the GET /api/sessions assertion (not sidebar-DOM/treeitem steps), heading matches the actual test name ("stays a member of its home session"), Shared-setup board prefixes corrected to unpin/dual/krm/esc, and the fourth heading uses a plain backtick code span (no leaked JS concatenation). Also corrected the .spec.ts self-heal comment (executeKillWindow onSettled, not onPaneClosed). -->

## Execution Order

- T001, T002 (Phase 1) block T003, T004 (Phase 2) — Pin/Unpin consume the new helper and the reworked resolve.
- T003, T004 block T005 (relay preference builds on the link/dual-membership model).
- T005, T006 block Phase 4 tests (T007–T010) which assert the new backend behavior.
- Phase 5 (T011–T013) is independent of the backend and can proceed in parallel, but T013 depends on T011 (shared dialog opener).
- Phase 6 (T014–T015) is independent of the backend; T017 depends on T011/T013/T014/T015.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Pin` links the target so it is a member of both its home session and `_rk-pin-<id>`; all pin-session mechanics preserved.
- [x] A-002 R2: The pin-session holds exactly one window (the linked target) after the placeholder is killed.
- [x] A-003 R3: `LinkWindowToSession` exists in `internal/tmux`, mirrors `MoveWindowToSession`, uses `link-window` + `ExactSessionTarget` + explicit argv.
- [x] A-004 R4: `Unpin` normal path kills the pin-session and the window survives in home at its original position (no move-back/append).
- [x] A-005 R5: `Unpin` last-link recovery renames the pin-session to `@rk_home`/`recovered<id>` and clears options; no window left unrecoverable.
- [x] A-006 R6: `ResolveWindowSession` resolves the home (non-pin) session under dual membership, the pin-session when it is the sole link, and preserves the not-found contract.
- [x] A-007 R7: The relay attach prefers the pin-session when present (scoped select), else resolves home; viewing a pinned window does not move home's active-window pointer.
- [x] A-008 R9: The board top-bar ✕ and palette kill entry open the confirm dialog; confirmed Kill calls `killWindow`; `Unpin instead` unpins; the tile-header unpin stays unconfirmed.
- [x] A-009 R11: The board pane header shows `{session} › {window}` from the snapshot join, window-only when home is not derivable.
- [x] A-010 R12: A pinned window's sidebar pin indicator opens the pin popover whose "Go to {board}" row navigates to `/board/{board}` (two-step).

### Behavioral Correctness

- [x] A-011 R1: After `Pin`, `board_test.go` asserts the window is STILL in home (the move-based "absent from home" assertion is inverted).
- [x] A-012 R4: After `Unpin`, the window is unmoved in home and the pin-session is gone (no append/index churn).
- [x] A-013 R6: `ResolveWindowSession` returns the non-pin session even when tmux would naively report the pin-session first.
- [x] A-014 R9: The confirmed board Kill is a window-kill (`POST /api/windows/{id}/kill`), NOT the prior `close-pane`.
- [x] A-015 R10: Board surfaces label the destructive action "Kill" (not "Close pane"); the "close" verb is retired on board surfaces; sidebar/terminal ✕ unchanged.

### Scenario Coverage

- [x] A-016 R3: `TestLinkWindowToSession_*` proves link creates dual membership and preserves the window id.
- [x] A-017 R6: A `ResolveWindowSession` dual-membership test and a last-link test exist and pass.
- [x] A-018 R9: The e2e exercises the dialog (appearance, default focus, keyboard), the Kill path (`/kill`), and the `Unpin instead` path (`/unpin`).
- [x] A-019 R11 R12: A test asserts the `{session} › {window}` crumb and a test asserts the sidebar pinned-row → board navigation.

### Edge Cases & Error Handling

- [x] A-020 R5: Home-died-while-pinned, homeless, AND legacy-move-pin-with-live-home all recover via the last-link path (integration-tested): live-home pins are restored INTO their real home (`TestUnpin_LegacyPinLiveHomeRestoresIntoHome`), dead/homeless pins recover via recreate/`recovered<id>` rename (collision-guarded — `TestUnpin_RecoveryNameCollisionFallsBackToSuffix`).
- [x] A-021 R11: When the pinned window is absent from the sessions snapshot (legacy pin / home died), the pane header and dialog copy fall back to window-only without error.
- [x] A-022 R8: `windowExistsOnServer`, the GET-board join, `parseSessions` pin-filter, `handleWindowSelect`, and the SSE snapshot exclusion are behaviorally unchanged (existing tests still pass).

### Code Quality

- [x] A-023 Pattern consistency: New Go code follows the `internal/tmux` helper conventions (`exec.CommandContext` + timeout + explicit argv, `ExactSessionTarget`); new frontend code follows board/sidebar/dialog patterns.
- [x] A-024 No unnecessary duplication: `LinkWindowToSession` mirrors `MoveWindowToSession`; the kill dialog reuses the shared `Dialog`; the crumb/sidebar joins reuse `ctx.sessionsByServer` and `useWindowPins`; `unpinFocused`/`focusedPane` derivations are reused, not re-inlined.
- [x] A-025 Security (Constitution I): all new tmux calls use `exec.CommandContext` with a timeout and explicit argument slices — no shell strings; window ids/board names validated before subprocess use.
- [x] A-026 No new HTTP verbs/endpoints (Constitution IX): board API routes/bodies/validation unchanged; only tmux-level semantics beneath them change.
- [x] A-027 Keyboard-first (Constitution V): the kill dialog is keyboard-operable (Escape/Tab/Enter via `Dialog`), and all new board/sidebar actions are palette-reachable.
- [x] A-028 Test companion docs: the reworked `board-close-and-unpin.spec.ts` ships an updated `board-close-and-unpin.spec.md` whose every section mirrors the test body — the dual-presence section documents the `GET /api/sessions` assertion, headings match the actual `test()` names, Shared-setup board prefixes are correct (unpin/dual/krm/esc), and no heading leaks JS string concatenation (constitution Test Companion Docs).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/command-palette.boards.test.tsx:140-141` (+ assertions at :397, :411, :431-443) — the hand-written palette mirror still models the RETIRED `board-close-focused` / "Board: Close Focused Pane" entry; production renamed it to `board-kill-focused` / "Board: Kill Focused Pane" (confirm-dialog routed, board-page.tsx:661). The stale mirror block (and its 260715-6jwn "split/close" comment) should be updated to the Kill entry or dropped — it pins an entry-shape production no longer has.
- `closePane` import in `top-bar.tsx` stays live for terminal mode (the ✕ close-pane and its menu row) — correctly retained.
- No backend candidates: `MoveWindowToSession` keeps a live caller (`api/windows.go:335` move-to-session endpoint), `killPinSessionIfPresent` is the Unpin normal path, and `@rk_home` is deliberately retained for last-link recovery.
- Prior-cycle candidate RESOLVED (verified this pass): the dead `onPaneClosed` board-mode self-heal seam is fully removed — grep finds no `onPaneClosed`/`handlePaneClosed` references; the only remaining `executeClosePane` is app.tsx's terminal-mode palette close-pane (live). The confirmed board kill's refetch rides `executeKillWindow`'s own `onSettled`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The confirmed board **Kill** performs a window-kill via the existing `killWindow`/`POST /api/windows/{id}/kill` (not the prior `close-pane`), destroying all links (home + pin) in one call | Decided copy "closes it everywhere" implies window-entity semantics; `kill-window -t @N` destroys the whole window; frontend-scoped and easily revised (intake Assumption #7) | S:60 R:80 A:60 D:55 |
| 2 | Confident | `ResolveWindowSession` re-resolves to the non-pin home via a `list-windows -a` enumeration (mirrors the existing `list-windows -a -F` pattern at tmux.go:1047); relay layers its pin preference above it | Decision 3 requires a home-deterministic resolve; tmux cross-link target order is unspecified; the enumeration pattern already exists in-file (intake Assumption #8) | S:70 R:70 A:75 D:70 |
| 3 | Confident | Unpin detects "pin link is the last link" by checking whether the window is still a member of any live non-pin session (via the same `list-windows -a` enumeration / a membership check), then kill-session vs. recover accordingly | Direct consequence of decision 4's retained recovery path; mechanism choice is plan-level (intake Assumption #9) | S:60 R:70 A:75 D:70 |
| 4 | Confident | Legacy move-based pins get NO auto-migration; they present as the last-link case, keep working, and convert on unpin/re-pin | Not addressed in discussion; the recovery path already guarantees correctness; migration is optional polish (intake Assumption #10) | S:40 R:70 A:65 D:55 |
| 5 | Tentative | Explicit click-navigation (`selectWindow` POST → `handleWindowSelect` → `ResolveWindowSession`) resolves to the HOME session for pinned windows, keeping the 260715-38kg SSE active-window-confirmation, URL-writeback, and sidebar-highlight seams intact; the "viewing never changes home's active window" benefit is delivered by the RELAY attach preference (board panes, direct-URL views), NOT the click-nav path | Not discussed; the alternative (select the pin-session on click too) breaks the SSE-confirm seam unless the pending-switch machinery gains a pinned carve-out — the seam-preserving reading is the front-runner (intake Assumption #11) | S:45 R:50 A:50 D:45 |
| 6 | Confident | `{home}` in the dialog and the pane-header crumb are frontend render-time joins on `ctx.sessionsByServer` (join `windowId` → owning `ProjectSession.name`); when home is not derivable both fall back to window-only copy | Decision 6 specifies render-time derivability; the window is now home-linked so the join resolves; window-only fallback is the only graceful degradation (intake Assumption #12) | S:65 R:85 A:80 D:75 |
| 7 | Confident | The board top-bar ✕ routes to the dialog via a new optional `onRequestKill` slot callback registered by `BoardPage`; when present in board mode the ✕ calls it instead of `closePane`, and its label/aria flip to "Kill" — keeping one `ClosePaneButton` component, mode-branched, with terminal-mode ✕ untouched | The slot context is the established seam for board-owned top-bar handlers (`focusedPane`/`onPaneClosed`); a callback override is the minimal-diff routing that avoids forking the button | S:70 R:75 A:75 D:70 |
| 8 | Confident | The sidebar pinned-row → board navigation resolves the single owning board by extending `useWindowPins` to expose a `windowId → board` reverse lookup (a window has exactly one pin-session → exactly one board), reusing the existing `PinIcon`/`isPinnedToAny` render path | Intake decision 6 + Assumption #14; `useWindowPins` already aggregates the per-board pin map, so a reverse lookup is a small additive derivation, not new infrastructure | S:65 R:80 A:80 D:70 |
| 9 | Confident | Unpin's last-link recovery with a LIVE recorded `@rk_home` restores the window by `LinkWindowToSession` into that home + `killPinSessionIfPresent` (window lands in the real home), rather than renaming the pin-session to `recovered<id>`; a link failure falls back to the collision-guarded recovered-name rename | Rework must-fix #1; link-into-home is the natural realization of the link-based model (the window rejoins its recorded home honestly, Constitution II), reversible + backend-only, and the fallback preserves "never strand a window" | S:80 R:70 A:80 D:75 |
| 10 | Confident | The `recovered<id>` recovery rename is collision-guarded by a bounded numeric-suffix probe (`recovered<id>`, then `-2`, `-3`, … via `has-session`, capped at 100) so a stale prior-recovery session never makes Unpin error and strand the window; the dead-home recreate rename to `@rk_home` is guarded by a `has-session` precheck and can no longer collide | Rework should-fix #3; deterministic + bounded, reuses the package `has-session`/`RenameSession` helpers, matches the "window is never left unrecoverable" contract | S:75 R:75 A:80 D:75 |
| 11 | Confident | The sidebar pin indicator opens the pin popover, whose "Go to {board}" row navigates to `/board/{board}` — a deliberate two-step (indicator → popover → row), reusing the popover's existing pin-management role rather than hijacking the indicator into a direct navigation | Rework should-fix #6 records shipped behavior; R12's "activate the indicator → navigate" wording is reconciled to the two-step reality; reversible UI wording, palette-reachable per Constitution V | S:85 R:80 A:80 D:75 |

11 assumptions (0 certain, 10 confident, 1 tentative).
