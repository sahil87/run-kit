# Intake: Operator Session Physical Promotion

**Change**: 260822-skcr-operator-session-physical-promotion
**Created**: 2026-08-22

## Origin

One-shot `/fab-new` invocation implementing **Phase 1 (physical promotion)** of the
operator-session plan at `fab/plans/sahil/26-08-22-operator-session.md` (read in full; design
decisions below are lifted from it). Phases 2 (actuation seam / operator-request
endpoint) and 3 (control-room features) are **explicitly out of scope** — separate
follow-up changes once Phase 1 lands. The fab-kit prerequisite (pane-identity-keying
contract, fab-kit PR #612 / kit v2.20.10) has shipped and this worktree is synced to
it — per the user, it is NOT re-verified in this change.

> Implement Phase 1 (physical promotion) of the operator-session plan documented at
> fab/plans/sahil/26-08-22-operator-session.md. The operator tmux window (@rk_role=operator) is
> currently only cosmetically hoisted in the sidebar but stays at its old tmux index in
> its original session, causing window-cycling to jump. Phase 1 makes the hoist
> physical: on role-set, move the window into a new hidden per-server session named
> `_rk-operator` (create if missing, detached); on role-clear, move it back out to a
> cwd-basename conventional session. The `_rk-operator` session must be filtered from
> the normal session list only while every window in it carries the operator role.
> Cover the plan's edge cases (exit-empty, ephemeral-churn reaper, snapshot/restore,
> dispatch pane workers) and add backend role-endpoint move/demote/collision tests plus
> e2e coverage per plan item 6.

All plan anchors were verified against current code before this intake was written;
line numbers below are current as of this worktree's HEAD (8db96eda). Two plan claims
needed correction — see What Changes §1 (two role-set seams, not one endpoint path) and
§4 (the pin-session filter seam cannot be reused literally).

## Why

1. **The pain**: the sidebar pins the operator window (`@rk_role=operator`) to a row
   above all session groups (`components/sidebar/index.tsx:2316` — change 260813-ifya),
   but the window physically stays at its old index in its original work session.
   Display order and tmux traversal order disagree: cycling windows in a 5-window
   session where the operator sits at index 3 goes 1, 2, jump-to-operator, 4, 5.
2. **If unfixed**: every window-cycle keybinding and tmux-native `next-window` hits the
   operator mid-sequence — a navigation bug that gets worse the more the operator
   pattern is used, and Phase 2/3 (the control-room surface) build on the operator
   being a real "home" rather than a lodger in a work session.
3. **Why this approach**: make the cosmetic hoist physical. The move is cheap because
   run-kit is windowId (`@N`) keyed end-to-end and `@N` survives `move-window` (relay,
   pinned row, URL all hold); `MoveWindowToSession` already exists
   (`internal/tmux/tmux.go:1660`). The trigger is the role-set moment — an explicit
   mutation the user (or fab-operator's self-mark) already performs — not a detector
   loop, so run-kit never mutates tmux behind the user's back.

## What Changes

### 1. Promote on role-set — shared helper covering BOTH role-set seams

**Plan correction (verified)**: the plan says fab-operator's self-mark "rides the same
option/endpoint path". It does not — there are **two** role-set seams sharing only the
`internal/tmux` radio-clear helpers:

- **HTTP**: `api/windows.go` `handleWindowOptions` (POST `/api/windows/{windowId}/options`)
  — the `roleSet` flag path calls `s.tmux.ClearWindowRoleExceptOnServer(...)` then
  `SetWindowOptions` (api/windows.go:474–490). Role constants: `optKeyRole = "@rk_role"`
  (api/windows.go:359); `""` maps to unset (op.Value = nil).
- **CLI**: `cmd/rk/role.go` `runRole` — `rk role <operator|clear>` on the current window
  (derived from `$TMUX_PANE`), calling `tmux.ClearWindowRoleExcept` directly via the
  `roleClearExceptFn` seam. This is fab-operator's startup self-mark path.

Therefore the promotion/demotion logic MUST live in `internal/tmux` (beside
`ClearWindowRoleExcept*`, `roleCarriersFormat` at tmux.go:1727, `RoleOption` at
tmux.go:62) as shared helpers — e.g. `PromoteOperatorWindow(ctx, windowID, server)` /
`DemoteOperatorWindow(ctx, windowID, server)` — invoked from both seams. Putting it
only in the HTTP handler would leave `rk role operator` producing the old cosmetic-only
behavior.

**Promote behavior**: on setting `@rk_role=operator` on a window,

1. Ensure session `_rk-operator` exists on that server: exact-match `HasSession`
   (tmux.go ~1690) probe; if missing, detached create. Note `CreateSession`
   (tmux.go:1226) creates a session **with a fresh window** — the promote path must
   instead create-with-move or create-then-move-then-kill-placeholder, or use
   `move-window -s <windowID>` semantics that land the window as the session's sole
   window. Board pin-session creation (`board.go:347`, `new-session -d -s <name> -c ...`)
   is the existing detached-create pattern to mirror; mechanism finalized at plan time.
2. `MoveWindowToSession(windowID, "_rk-operator", server)` (tmux.go:1660 — uses
   `ExactSessionTarget`, i.e. `=name:` form, per the bare-target session/window
   collision hazard).
3. The existing radio semantics are unchanged: `ClearWindowRoleExceptOnServer` still
   clears `@rk_role` from every other window first, and the option write itself is
   untouched.

Add an `OperatorSessionName = "_rk-operator"` constant beside `PinSessionPrefix`
(tmux.go:235). The `_rk-` prefix is the existing infra-session convention. All
targeting uses `=name:` / `$N` / `@N` forms (never bare `-t _rk-operator`).

Ordering note: the move and the option-set must be sequenced so a mid-sequence crash
degrades gracefully (e.g. set option first, then move: a set-but-unmoved operator is
exactly today's cosmetic behavior). Exact ordering is a plan-time decision.

### 2. Demote on role-clear — move back out to a cwd-basename session

On clearing `@rk_role` from a window that currently lives in `_rk-operator` (HTTP: a
present `@rk_role` key with `null`/`""` value; CLI: `rk role clear`):

1. Determine the window's active-pane cwd and derive the conventional session name from
   its folder basename (windows AND sessions are auto-named from folder basenames —
   tmux.go:203; the riff repo-root derivation `api/riff.go:43` shows the
   active-pane-cwd pattern).
2. Create that session if missing (detached), else move into the existing one:
   `MoveWindowToSession`.
3. Apply the normal option unset. When the moved window was `_rk-operator`'s last
   window, tmux destroys the now-empty session automatically — expected and clean; the
   session is recreated on the next promote.

Role-clear on a window NOT in `_rk-operator` (a legacy cosmetic-era operator, or a
stray) is a plain option unset — no move.

Demotion is **explicit only**: an agent process exiting does NOT auto-demote (no
yo-yo). One-way auto-promote + explicit demote, per the plan.

### 3. Radio displacement — the collision case

Setting operator on window B while window A currently holds the role (and lives in
`_rk-operator`): the radio clear (`ClearWindowRoleExcept*`) strips A's role, which
would leave a roleless A stranded inside `_rk-operator` — making the session visible
(per the content rule in §4) with a confusing mixed population. The displaced
ex-operator MUST be demoted out (same §2 destination derivation) as part of the radio
sequence. This is the "collision" the plan's test item names. Same handling from both
seams (it belongs inside the shared internal/tmux helpers, not the callers).

Also covered: promoting a window when a user-created session already named
`_rk-operator` exists with arbitrary windows (promote moves in; session is mixed ⇒
stays visible per §4 — safe by construction, needs a test); promoting the sole window
of a session (source session dies with its last window — benign, test it).

### 4. Hide the session — content-conditional, at the join, not the name-skip

**Plan correction (verified)**: the plan says "reuse the existing pin-session filtering
seam". The literal seam — `parseSessions`' early name-prefix skip (tmux.go:644, which
drops `_rk-pin-*` lines before they become entries) — CANNOT be reused for
`_rk-operator`, for two reasons:

1. **The payload nests windows under sessions**: `FetchSessions`
   (`internal/sessions/sessions.go:518`) fans out `tmux.ListWindows` per session
   returned by `tmux.ListSessions` (sessions.go:525→542) into
   `ProjectSession{..., Windows}` (sessions.go:36). A name-skip in parseSessions would
   remove the operator window's data from the payload entirely — and unlike board
   pin-sessions (whose windows stay visible via **link**-based dual membership,
   board.go:257), the operator window is **moved**, so `_rk-operator` is its ONLY
   membership. The pinned row (which keys on `win.role === "operator"` + windowId,
   sidebar/index.tsx:2323–2326) would lose its data source and the window would vanish
   from the UI.
2. **The filter is content-conditional**: hidden only while EVERY window in the session
   carries `@rk_role=operator`, so a stray or demoted window can never become
   invisible. parseSessions sees only session-level format fields (no window roles);
   window roles are known only after the per-session `ListWindows` fan-out (the
   list-windows format already carries `#{@rk_role}`, tmux.go:1003).

**Design**: keep `_rk-operator` (and its windows) in the payload; compute a
content-conditional hidden marker where sessions and windows join (FetchSessions, post
fan-out — e.g. a `hidden`/`operatorHome` field on `ProjectSession`), and have the
sidebar exclude hidden sessions from the normal SESSIONS groups while still sourcing
the pinned operator row from their windows. The single-chokepoint property the
parseSessions comment guarantees ("every consumer flows through
ListSessions/parseSessions") is preserved in spirit by computing the marker in ONE
place (FetchSessions is the SSE hot path all session consumers ride); exact field name
and frontend consumption finalized at plan time. Other session enumerators (board
derivation `api/boards.go:383`, server aggregates) must be audited at plan time for
whether they should see `_rk-operator` (most iterate FetchSessions output or
by-name targets and are unaffected).

### 5. Sidebar

The pinned operator row logic (sidebar/index.tsx:2316 `operatorEntry` memo, :2765–2805
render) keys on `role === "operator"` + windowId, not on session — it keeps working
once §4 keeps the window data flowing. Verify the roving row order and arrow-nav still
reach the pinned row.

**Plan nuance (verified)**: the plan says to "drop any now-dead 'filter it out of its
home group' special-casing". The move-don't-copy skip (index.tsx:2372) is NOT dead
after promotion: it is the guard that prevents a duplicate row whenever the operator's
containing session is visible — which still happens in the mixed-content
`_rk-operator` case (§4's stray-window rule) and for a legacy cosmetic-era operator
sitting in a work session before its first re-promote. Retain it; drop only branches
proven dead during apply.

### 6. Edge cases (verified against current code)

- **exit-empty**: already neutralized globally — `SetExitEmptyOff` (tmux.go:2370–2388,
  change 260602-a1wo) sets `exit-empty off` per server, and `internal/tmuxctl/client.go:397`
  sets it before the control-mode anchor. An empty `_rk-operator` (last window demoted
  out) is destroyed by tmux as an empty session regardless — benign; recreated on next
  promote. Confirm with a test, no new mechanism expected.
- **Ephemeral-churn reaper**: `internal/tmux/reaper.go` classifies and sweeps tmux
  **server sockets** (name-prefix + `@rk_ephemeral`-marked servers), never sessions —
  `_rk-operator` is a session name and is structurally out of the reaper's domain.
  Confirm via a `classifyReap`-level test or a documented assertion; no code change
  expected.
- **Snapshot/restore**: the snapshot package has NO pin-style session filtering
  (verified: no `PinSessionPrefix` references) — sessions are captured generically, so
  `_rk-operator` is captured as a regular session; `@rk_role` is already restored per
  window (`internal/snapshot/restore.go:340`). Required: round-trip tests proving a
  snapshot taken with a promoted operator restores the `_rk-operator` session, the
  window inside it, and the role option (so the restored state is hidden+pinned, not a
  visible stray session).
- **Dispatch pane workers**: fab dispatch pane workers spawned beside the operator now
  land in `_rk-operator` (their cwd is the worktree). Accepted per the plan — fab-side
  keying is safe under the shipped pane-identity contract (fab-kit PR #612, not
  re-verified here). Note: a non-operator worker window inside `_rk-operator` makes the
  session visible per §4's content rule — that is the honest, designed behavior, not a
  bug; a test should pin it.

### 7. Tests (plan item 6)

- **Backend**: role-endpoint (HTTP) tests — promote moves the window into
  `_rk-operator` (created detached when missing); demote moves it out to the
  cwd-basename session; radio displacement demotes the previous operator; collision
  with a pre-existing user `_rk-operator` session; sole-window source session death;
  content-conditional hidden marker (all-operator ⇒ hidden; mixed ⇒ visible).
  CLI tests for `rk role` gaining the same move behavior (the existing
  `cmd/rk/role_test.go` seam pattern). Snapshot round-trip test per §6.
- **e2e (Playwright, `just test-e2e`)**: cycling a work session's windows skips the
  promoted operator (traversal order no longer jumps); the pinned row still navigates
  to the operator window; a demoted window reappears in a visible session. Each new
  `.spec.ts` ships its sibling `.spec.md` (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) the `_rk-operator` infra-session convention
  (promote/demote moves, `OperatorSessionName`), the content-conditional hidden rule at
  the FetchSessions join, and its contrast with the `_rk-pin-*` name-prefix filter
  (link vs move membership)
- `run-kit/ui/sidebar`: (modify) operator pinned row section — the row's data source
  now rides a hidden session's windows; the retained move-don't-copy skip rationale
- `run-kit/layout-snapshots`: (modify) note that `_rk-operator` + `@rk_role` round-trip
  through snapshot/restore (capture set unchanged, behavior now load-bearing)

## Impact

- `app/backend/internal/tmux/tmux.go` — `OperatorSessionName` const, promote/demote
  helpers beside the `ClearWindowRoleExcept*` radio helpers; possibly a detached
  create-for-move primitive
- `app/backend/api/windows.go` — `handleWindowOptions` roleSet/role-clear paths call
  the shared helpers
- `app/backend/cmd/rk/role.go` — `runRole` calls the same helpers (both seams converge)
- `app/backend/internal/sessions/sessions.go` — content-conditional hidden marker on
  `ProjectSession` at the FetchSessions join
- `app/frontend/src/components/sidebar/index.tsx` — exclude hidden sessions from
  SESSIONS groups; pinned row data-source verification; roving/arrow-nav check
- `app/frontend/src/api/` types — new session field
- Tests: `api/windows_test.go`, `cmd/rk/role_test.go`, `internal/tmux/*_test.go`,
  `internal/snapshot/*_test.go`, new Playwright spec + `.spec.md`
- Out of scope: Phase 2 endpoint, Phase 3 features, fab-kit changes, chat-send
  machinery, `rk mux` surface

## Open Questions

- None — the plan doc plus code verification resolved everything askable; remaining
  choices (helper naming, exact ordering of option-set vs move, hidden-field name) are
  plan-time decisions recorded as assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Move is physical and triggered only at the role-set moment; no detector loop | Plan doc explicit design decision; non-goal guards it | S:95 R:70 A:95 D:95 |
| 2 | Certain | Session named `_rk-operator`, `_rk-` infra prefix, `=name:`/`$N`/`@N` targeting only | Plan doc explicit; bare-target collision hazard documented in memory + code | S:95 R:75 A:95 D:95 |
| 3 | Certain | Hidden by content (all windows operator-role), never by name alone | Plan doc explicit invariant with stated rationale (stray window can never vanish) | S:95 R:80 A:90 D:90 |
| 4 | Certain | Demote destination = cwd-basename conventional session, created if missing | Plan doc explicit; folder auto-naming is the existing convention (tmux.go:203) | S:90 R:80 A:90 D:85 |
| 5 | Confident | Promote/demote helpers live in `internal/tmux`, invoked from BOTH seams (HTTP handler + `rk role` CLI) — correcting the plan's "same endpoint path" claim | Verified: cmd/rk/role.go calls tmux directly, sharing only ClearWindowRoleExcept*; helper placement follows that existing pattern | S:70 R:75 A:90 D:80 |
| 6 | Confident | Hidden filtering = content-computed marker at the FetchSessions join consumed by the sidebar, NOT a parseSessions name-skip | Verified: nested-window payload means a name-skip drops the operator window's data (move ≠ link); content rule needs window roles known only post fan-out | S:65 R:70 A:85 D:75 |
| 7 | Confident | Radio displacement demotes the displaced ex-operator out of `_rk-operator` | Follows from the content rule (§4) — a stranded roleless window makes the session visible/mixed; plan's "collision tests" item names this case | S:55 R:80 A:80 D:65 |
| 8 | Certain | exit-empty interaction is benign; no new mechanism | Verified: SetExitEmptyOff global since 260602-a1wo; empty-session destroy + recreate-on-promote is clean | S:85 R:90 A:95 D:90 |
| 9 | Certain | Ephemeral-churn reaper cannot sweep `_rk-operator`; test/assert only | Verified: reaper.go operates on server sockets, sessions structurally out of scope | S:85 R:90 A:95 D:90 |
| 10 | Confident | Snapshot/restore needs tests only — capture is generic, `@rk_role` already restored (restore.go:340) | Verified restore path; capture set has no session filtering; round-trip proof still owed | S:70 R:85 A:80 D:80 |
| 11 | Certain | Phase 2 (actuation seam) and Phase 3 (control-room) excluded | User instruction explicit; plan sequencing section confirms Phase 1 stands alone | S:100 R:90 A:100 D:100 |
| 12 | Confident | Retain the sidebar move-don't-copy skip (index.tsx:2372); drop only branches proven dead — softening the plan's "drop now-dead special-casing" | Verified: the skip still guards the visible-mixed-`_rk-operator` and legacy cosmetic-operator cases against duplicate rows | S:60 R:90 A:75 D:70 |
| 13 | Certain | fab-kit pane-identity prerequisite (PR #612 / kit v2.20.10) treated as shipped, not re-verified | User instruction explicit | S:100 R:90 A:100 D:100 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).
