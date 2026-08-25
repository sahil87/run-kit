# Plan: Operator Session Physical Promotion

**Change**: 260822-skcr-operator-session-physical-promotion
**Intake**: `intake.md`

## Requirements

### Backend tmux layer: operator session primitives

#### R1: Operator session constant and detached creation
`internal/tmux` SHALL export `OperatorSessionName = "_rk-operator"` (beside `PinSessionPrefix` / `ControlAnchorSessionName`, tmux.go:235/239) and provide a primitive that ensures the session exists on a server: exact-match `HasSession` probe, then `new-session -d -s _rk-operator -c <ServerBirthDir()>` when missing (the `board.go:347` Pin pattern — the server is already alive at promote time, so `-c` is session-path hygiene, not a server birth). All targeting of the session MUST use `ExactSessionTarget` / `@N` / `$N` forms — never a bare `-t _rk-operator`.

- **GIVEN** a server with no `_rk-operator` session
- **WHEN** the ensure primitive runs
- **THEN** a detached `_rk-operator` session exists with `session_path` = ServerBirthDir()
- **AND** a second run is a no-op (idempotent)

#### R2: Promote on role-set — both seams
Setting `@rk_role=operator` on a window SHALL physically move that window into `_rk-operator` (ensure session per R1, then `move-window -s @N -t =_rk-operator:` — `MoveWindowToSession`, tmux.go:1660). This MUST happen on **both** role-set seams: the HTTP options endpoint (`api/windows.go` `handleWindowOptions`, the `roleSet` path at :474–490) and the `rk role operator` CLI (`cmd/rk/role.go` `runRole`). The shared move logic lives in `internal/tmux` (prefix-parameterized like `ClearWindowRoleExcept`, so the CLI's `-S socket` prefix and the API's `serverArgs(server)` prefix both work). Sequencing: the option write completes successfully **before** the move, so a mid-sequence failure degrades to the current cosmetic-only behavior, never to a moved-but-roleless window.

- **GIVEN** window `@7` at index 3 of 5-window session `work` on server `s`
- **WHEN** `POST /api/windows/@7/options {"options":{"@rk_role":"operator"}}` succeeds (or `rk role operator` runs in a pane of `@7`)
- **THEN** `@7` is a member of `_rk-operator` (created detached if missing) and no longer a member of `work`
- **AND** cycling `work`'s windows traverses only its remaining 4 windows

#### R3: Demote on role-clear — move out to the cwd-basename session
Clearing `@rk_role` from a window that is currently a member of `_rk-operator` SHALL move it out to the conventional session named after its active pane's cwd basename (create detached if missing, else move into the existing session; folder auto-naming convention, tmux.go:203). Role-clear on a window NOT in `_rk-operator` remains a plain option unset — no move. When the demoted window was `_rk-operator`'s last window, tmux destroys the empty session — expected; it is recreated on the next promote. Demotion is explicit only (role-clear); an agent process exiting never auto-demotes.

- **GIVEN** operator window `@7` in `_rk-operator`, its active pane cwd `/home/u/code/myproj`
- **WHEN** `@rk_role` is cleared (HTTP `null`/`""`, or `rk role clear`)
- **THEN** `@7` is a member of session `myproj` (created if missing) and `_rk-operator` is gone (was last window) or no longer contains `@7`

#### R4: Radio displacement demotes the displaced carrier
When role-set on window B displaces current carrier A (the server-scoped radio clears A's role — `ClearWindowRoleExcept`, tmux.go:1757), and A is a member of `_rk-operator`, A SHALL be moved out per R3's destination rule as part of the same promote flow. The radio clear MUST surface which windows it cleared (e.g. return the cleared IDs) so the callers/flow can demote them. A pre-existing user-created `_rk-operator` session with foreign windows is tolerated: promote still moves the window in; the mixed session simply stays visible per R5.

- **GIVEN** window A is the promoted operator (in `_rk-operator`); window B is in session `work`
- **WHEN** B is set to operator
- **THEN** A's role is cleared AND A is moved out to its cwd-basename session; B is moved into `_rk-operator`; `_rk-operator` contains exactly B

### Sessions payload: content-conditional hiding

#### R5: Hidden marker computed at the FetchSessions join
`internal/sessions.FetchSessions` (sessions.go:518) SHALL mark a `ProjectSession` hidden when and only when its name is `OperatorSessionName` AND it has ≥1 window AND every window carries `role == "operator"` (window roles are available post fan-out — `ListWindows` format already carries `#{@rk_role}`, tmux.go:1003). The session and its windows STAY in the payload (REST `/api/sessions` + SSE `sessions` event) with a new optional field (e.g. `hidden,omitempty` on `ProjectSession`, sessions.go:36) — it MUST NOT be name-skipped in `parseSessions` (the window is *moved*, not linked, so a parse-level skip would erase the pinned row's data source; contrast the `_rk-pin-*` skip which relies on link dual-membership). A mixed or stray population (any non-operator window) yields `hidden` false — the session surfaces normally, so no window can ever become invisible.

- **GIVEN** `_rk-operator` holding exactly one window with `role=operator`
- **WHEN** `/api/sessions?server=s` is fetched (or the SSE `sessions` event fires)
- **THEN** the session appears in the payload with `hidden: true` and its window data intact
- **AND** after a non-operator window lands in `_rk-operator` (e.g. a dispatch pane worker), `hidden` is absent/false

### Frontend: sidebar consumption

#### R6: Sidebar hides the session, keeps the pinned row and nav intact
The sidebar SHALL exclude `hidden` sessions from the rendered session groups (and window-count aggregates where sessions are user-enumerated), while the `operatorEntry` memo (sidebar/index.tsx:2323) continues to walk the UNFILTERED session data so the pinned operator row still resolves its carrier from the hidden session's windows. The pinned row's behavior is unchanged: renders once above all groups, navigates on click/Enter, participates in roving tabindex leading the group's visible-row slice. The move-don't-copy skip (index.tsx:2372) is RETAINED — it still guards the duplicate-row case when the operator's containing session is visible (mixed `_rk-operator`, or a legacy cosmetic-era operator still sitting in a work session). Other user-facing session enumerations that render from the same payload (e.g. session switcher/palette listings, server-page session tiles) SHOULD exclude hidden sessions in the same pass; window-level data of hidden sessions stays available (terminal routes by `@N` are unaffected).

- **GIVEN** a promoted operator (hidden `_rk-operator`)
- **WHEN** the sidebar renders
- **THEN** no `_rk-operator` session group appears; the pinned operator row renders once and navigates; arrow-nav reaches it as the first row of the server group
- **AND** when `_rk-operator` is mixed (visible), the operator window's row appears ONLY as the pinned row (the group's copy is skipped)

### Edge cases

#### R7: Infra interactions hold
(a) exit-empty: no new mechanism — `SetExitEmptyOff` is already applied per server (tmux.go:2370–2388); an emptied `_rk-operator` dying with its last window is expected. (b) The ephemeral-churn reaper (`internal/tmux/reaper.go`) operates on server sockets, never sessions — `_rk-operator` is structurally out of scope; pin this with a cheap `classifyReap` assertion. (c) Snapshot/restore: capture is session-generic and restore already re-applies `@rk_role` (snapshot/restore.go:340); a round-trip test SHALL prove a snapshot taken with a promoted operator restores the `_rk-operator` session containing the window with its role option (restored state = hidden + pinned, not a visible stray).

- **GIVEN** a snapshot captured while `@7` is promoted in `_rk-operator`
- **WHEN** the snapshot is restored onto a fresh server
- **THEN** `_rk-operator` exists containing the restored window and its `@rk_role=operator` option

### Tests

#### R8: Backend and e2e coverage
Backend tests SHALL cover: HTTP promote move (session created when missing), demote move-out, radio displacement demote, pre-existing-`_rk-operator` collision tolerance, sole-window source-session death, hidden-marker truth table (all-operator ⇒ hidden; mixed ⇒ visible; parseSessions does NOT name-skip `_rk-operator`), and the CLI seam (`cmd/rk/role_test.go` — move argv issued through the existing run seams). A Playwright spec (+ sibling `.spec.md` per the constitution) SHALL prove: after promote, the work session's group no longer contains the operator row (membership = traversal order fixed); the pinned row still navigates to the operator window; after demote, the window reappears under a visible session group.

- **GIVEN** the e2e harness (`just test-e2e`, isolated :3020 / rk-test-e2e socket)
- **WHEN** the new spec runs
- **THEN** all three user-visible behaviors above pass

### Non-Goals

- Phase 2 (operator-request endpoint / actuation seam) and Phase 3 (control-room features) — separate follow-up changes.
- No detector loop — promotion rides role-set only; no auto-demote on process exit.
- No request queue, no persisted operator state (Constitution II).
- Multi-window operator sessions, cross-server consolidation, making `_rk-operator` user-visitable as a session group.
- No re-verification of the fab-kit pane-identity prerequisite (shipped: fab-kit PR #612 / kit v2.20.10).

### Design Decisions

#### Shared move logic in internal/tmux, prefix-parameterized
**Decision**: Promote/demote/displacement move logic lives in `internal/tmux` beside `ClearWindowRoleExcept`, parameterized by the server-targeting argv prefix, invoked by both the HTTP options handler and `rk role`.
**Why**: There are two role-set seams (verified — the CLI does not ride the HTTP endpoint); the prefix-parameterized shape is exactly how the existing radio clear serves both. Handler-local logic would leave `rk role operator` (fab-operator's self-mark) cosmetic-only.
**Rejected**: Routing the CLI through the HTTP endpoint — `rk role` deliberately targets the pane's own `$TMUX` socket and hard-errors outside tmux; adding an HTTP dependency would break its contract and require origin resolution.
*Introduced by*: 260822-skcr-operator-session-physical-promotion

#### Hidden marker at the FetchSessions join, not a parseSessions name-skip
**Decision**: `_rk-operator` stays in the sessions payload; a content-conditional `hidden` field is computed in `FetchSessions` after the per-session window fan-out; the frontend excludes hidden sessions at render.
**Why**: The payload nests windows under sessions and the operator window is moved (single membership) — a parse-level skip would erase the pinned row's data source. The content rule (all windows operator) needs window roles, known only post fan-out.
**Rejected**: parseSessions early-skip (the `_rk-pin-*` seam) — correct for linked pin-sessions whose windows keep home membership, data-destroying here. Also rejected: a second "operator windows" side-channel payload — more moving parts than one boolean field.
*Introduced by*: 260822-skcr-operator-session-physical-promotion

#### Option-write-first sequencing
**Decision**: The role option write (set or unset, batched as today) completes successfully before any move; the move is the trailing step of the flow.
**Why**: A mid-sequence failure then degrades to the current cosmetic-only behavior (role set, window unmoved) — a known-good state the sidebar already handles — never a moved-but-roleless stray.
**Rejected**: Move-first — a crash would leave a roleless window inside `_rk-operator`; recoverable (session turns visible) but a worse resting state.
*Introduced by*: 260822-skcr-operator-session-physical-promotion

#### Displaced carrier is demoted, not stranded
**Decision**: The radio clear surfaces the cleared window IDs, and any cleared window residing in `_rk-operator` is moved out per the demote destination rule within the same promote flow.
**Why**: A stranded roleless window flips the session visible with a confusing mixed population; demote-out preserves the "one operator, hidden home" invariant on every transfer.
**Rejected**: Leave-in-place (session becomes visible) — honest but confusing; the plan's collision-test item exists precisely for this transfer case.
*Introduced by*: 260822-skcr-operator-session-physical-promotion

## Tasks

### Phase 1: Setup

- [x] T001 Add `OperatorSessionName = "_rk-operator"` const + `ensureOperatorSession(ctx, prefix []string)` (exact-match has-session probe, detached create with `-c ServerBirthDir()`) in `app/backend/internal/tmux/tmux.go`; unit-test the argv/probe composition via the existing pure-helper pattern <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Extend `ClearWindowRoleExcept` (tmux.go:1757) to return the cleared window IDs (adapt both callers); add `MoveWindowIntoOperatorSession(ctx, prefix, windowID)` (ensure + move-in) and `DemoteWindowFromOperatorSession(ctx, prefix, windowID)` (membership check → cwd-basename destination derivation from the window's active pane → ensure destination detached → move-out; no-op when not a member) in `app/backend/internal/tmux/tmux.go`, with pure helpers unit-tested (`tmux_test.go`) <!-- R2 R3 R4 -->
- [x] T003 Wire the HTTP seam in `app/backend/api/windows.go` `handleWindowOptions`: roleSet path — radio clear (collect displaced) → demote displaced → existing `SetWindowOptions` batch → move-in; role-CLEAR detection (a `@rk_role` op with nil value) — batch first, then demote the target window; SSE wake unchanged <!-- R2 R3 R4 -->
- [x] T004 Wire the CLI seam in `app/backend/cmd/rk/role.go` `runRole`: operator → clear (collect) + demote displaced + set + move-in; clear → unset + demote; keep the existing testable-seam pattern (extend `roleRunFn`/`roleClearExceptFn` seams as needed) <!-- R2 R3 -->
- [x] T005 Hidden marker: add `Hidden bool \`json:"hidden,omitempty"\`` to `ProjectSession` (`app/backend/internal/sessions/sessions.go:36`) and compute it in `FetchSessions` post fan-out (name == `tmux.OperatorSessionName` && len(windows) > 0 && all roles == "operator"); unit-test the truth table in `sessions_test.go` <!-- R5 -->
- [x] T006 Frontend: thread `hidden?: boolean` through the session type (`app/frontend/src/api/` ProjectSession) and exclude hidden sessions from sidebar session-group rendering (`app/frontend/src/components/sidebar/index.tsx`) while `operatorEntry` keeps walking unfiltered data; retain the :2372 skip; sweep other session enumerations rendering from the same payload (palette session actions, server-page session tiles) for hidden exclusion; update/add colocated `.test.tsx` coverage <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Backend endpoint/CLI tests in `app/backend/api/windows_test.go` + `app/backend/cmd/rk/role_test.go`: promote move (creates session when missing), demote move-out, radio displacement demote, pre-existing user `_rk-operator` collision tolerance, sole-window source-session death, role-clear on a non-member (plain unset, no move) <!-- R2 R3 R4 R8 -->
- [x] T008 [P] Snapshot round-trip test in `app/backend/internal/snapshot/` (integration_test.go pattern): capture with a promoted operator → restore → `_rk-operator` exists with the window + `@rk_role` option restored <!-- R7 -->
- [x] T009 [P] Reaper scope assertion: `classifyReap("_rk-operator", ...)` → skip (session names are outside the socket sweep) in `app/backend/internal/tmux/reaper` tests; assert `parseSessions` does NOT name-skip `_rk-operator` in `tmux_test.go` <!-- R7 R5 -->
- [x] T010 Playwright spec `app/frontend/tests/e2e/operator-session-promotion.spec.ts` + sibling `.spec.md`: promote → work-session group no longer lists the window (membership moved) + no `_rk-operator` group appears; pinned row navigates; demote → window reappears under its cwd-basename session group <!-- R8 -->

### Phase 4: Polish

- [x] T011 Run the verification gates (`just test-backend`, frontend `tsc --noEmit`, targeted `just test-e2e "operator-session-promotion"`, then the full relevant suites) and fix fallout <!-- R8 -->

## Execution Order

- T001 → T002 → (T003, T004 in either order) → T005 → T006
- T007 after T003+T004; T008/T009 [P] anytime after T002; T010 after T006
- T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `OperatorSessionName` exported; ensure-primitive creates `_rk-operator` detached with ServerBirthDir path, idempotently, via exact-match targets
- [x] A-002 R2: Role-set through the HTTP endpoint AND through `rk role operator` moves the window into `_rk-operator`
- [x] A-003 R3: Role-clear through both seams moves a member window out to its cwd-basename session (created if missing); non-members get a plain unset
- [x] A-004 R5: Sessions payload carries `_rk-operator` with windows + `hidden: true` when all-operator; `hidden` false/absent when mixed or empty
- [x] A-005 R6: Sidebar renders no hidden session group; pinned operator row still renders once, navigates, and leads roving order

### Behavioral Correctness

- [x] A-006 R2: After promote, the source session's window list (tmux truth) no longer contains the operator — cycling traverses only remaining windows
- [x] A-007 R4: Role transfer (B set while A holds) leaves `_rk-operator` containing exactly B; A lands in its cwd-basename session with no role

### Scenario Coverage

- [x] A-008 R7: Snapshot round-trip test restores `_rk-operator` + window + role option
- [x] A-009 R8: Playwright spec covers promote-hides/pinned-nav/demote-reappears with a sibling `.spec.md`

### Edge Cases & Error Handling

- [x] A-010 R3: Demoting `_rk-operator`'s last window leaves no stray session (tmux destroys it); next promote recreates it
- [x] A-011 R4: Promote with a pre-existing user `_rk-operator` (foreign windows) succeeds; session stays visible (mixed ⇒ not hidden)
- [x] A-012 R7: Reaper classification skips `_rk-operator`; `parseSessions` does not name-skip it

### Code Quality

- [x] A-013 Pattern consistency: new tmux helpers follow the prefix-parameterized + pure-helper-test pattern; exact-match targets everywhere
- [x] A-014 No unnecessary duplication: reuses `HasSession`, `MoveWindowToSession`, `ExactSessionTarget`, `ServerBirthDir`, existing seams
- [x] A-015 All subprocess calls via `exec.CommandContext` argv slices with timeouts (Constitution I); no client-side radio/move enforcement
- [x] A-016 New/changed behavior has tests (backend + e2e per code-quality.md); `.spec.md` companion shipped with the new spec

### Security

- [x] A-017 R2: No user-supplied strings reach tmux targets unvalidated — windowIDs validated (`ValidateWindowID`), session names composed from constants or validated cwd basenames

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. `MoveWindowToSession` retains live call sites (the palette/bulk "move to session" paths); the sidebar move-don't-copy skip is retained by design (R6) for the visible mixed `_rk-operator` and legacy cosmetic-operator cases. The create→placeholder-capture→move→placeholder-kill sequence is duplicated between `MoveWindowIntoOperatorSession` and `DemoteWindowFromOperatorSession` — a shared-helper extraction opportunity (nice-to-have), not a deletion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Split helpers (clear-returns-IDs + move-in + demote) with callers keeping their option writes, rather than one monolithic promote | Mirrors the existing prefix-parameterized radio-clear shape; keeps both seams' ordering explicit and testable | S:60 R:85 A:80 D:70 |
| 2 | Confident | Option-write-first sequencing (move is the trailing step) | Mid-crash degrades to the known cosmetic-era state; recorded as a Design Decision | S:55 R:85 A:80 D:70 |
| 3 | Confident | `hidden` boolean (`json:"hidden,omitempty"`) on ProjectSession; frontend excludes at render, window data stays | Smallest additive payload change following the `sessionColor` optional-field idiom | S:60 R:80 A:80 D:70 |
| 4 | Certain | `_rk-operator` created with `-c ServerBirthDir()` (session-path hygiene, Pin precedent) | board.go:347 is the exact analogous create on a live server | S:80 R:90 A:90 D:85 |
| 5 | Confident | Demote cwd derives from the window's active pane current path; fallback to ServerBirthDir basename when unreadable | riff repo-root derivation precedent; fallback keeps demote total | S:50 R:80 A:70 D:60 |
| 6 | Confident | e2e proves traversal-order fix via membership + sidebar rendering (no synthetic tmux key-cycling in the browser) | Membership IS traversal order in tmux; avoids flaky key-injection e2e | S:55 R:85 A:75 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative).
