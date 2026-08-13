# Plan: Operator Role Pinned Row

**Change**: 260813-ifya-operator-role-pinned-row
**Intake**: `intake.md`

## Requirements

### Backend: `@rk_role` option contract

#### R1: Closed-set validated window option
A new window user option `@rk_role` SHALL be defined with the closed value set `""` (unset) | `"operator"`. A `RoleOption` constant SHALL live in `internal/tmux/tmux.go` alongside `SessionOrderOption`/`ServerRankOption`; validation SHALL live in `internal/validate/validate.go` mirroring the `MarkerValues`/`ValidateMarkerValue` pattern (validate.go:196) — a `RoleValues` set and `ValidateRoleValue` accepting exactly `""`/`"operator"`.

- **GIVEN** a client-supplied `@rk_role` value
- **WHEN** it is anything other than `""` or `"operator"`
- **THEN** validation returns a non-empty error message and no tmux call is issued

#### R2: Server-scoped radio semantics
Setting `@rk_role=operator` on a window MUST clear `@rk_role` from every other window on the same tmux server (all sessions), so at most one window per server carries the role. A shared helper in `internal/tmux` SHALL implement the clear-others operation (enumerate windows via `list-windows -a` with a `#{window_id}\t#{@rk_role}` format, unset on every carrier except the target), and BOTH writers (the options POST handler and the `rk role` CLI) SHALL apply it. Enforcement lives server-side in rk — never trusted to clients.

- **GIVEN** window `@3` on server `kit` already has `@rk_role=operator`
- **WHEN** `@rk_role=operator` is set on window `@7` (any session, same server)
- **THEN** after the write, `@7` carries `operator` and `@3` carries no `@rk_role`

#### R3: Window-options POST accepts `@rk_role`
The unified `POST /api/windows/{windowId}/options` handler (`api/windows.go`) SHALL accept a new allowlisted key `@rk_role` (`optKeyRole`): value `"operator"` sets it (triggering the R2 radio clear before/with the batched `SetWindowOptions` write), JSON `null` or `""` unsets it (the `@rk_marker` empty-string→unset mapping). The existing validate-all-then-execute contract and the post-write SSE hub wake apply unchanged — no new endpoint, no new verb (Constitution IX).

- **GIVEN** `POST /api/windows/@7/options` with body `{"options": {"@rk_role": "operator"}}`
- **WHEN** the handler runs
- **THEN** validation passes, the radio clear + set execute, the SSE hub is woken, and the response is `200 {"ok": true}`
- **AND** a body with `{"@rk_role": "manager"}` returns 400 with zero tmux calls

#### R4: Enumeration and payload plumbing
The window enumeration format (`internal/tmux/tmux.go` ~:888) SHALL append `#{@rk_role}` as a 12th field; `parseWindows` SHALL parse it into a new `WindowInfo.Role` field (`json:"role,omitempty"`), dropping any value outside `RoleValues` to `""` (the Marker parse idiom at ~:829). The field rides the existing sessions API + SSE snapshot with no extra subprocess cost.

- **GIVEN** a tmux window with `@rk_role=operator`
- **WHEN** sessions are fetched (REST or SSE)
- **THEN** that window's JSON carries `"role": "operator"` and all other windows omit the field

#### R5: Layout-snapshot capture and restore
The snapshot `Window` schema (`internal/snapshot/snapshot.go`) SHALL gain a `Role` field captured from the layout-read format (`internal/tmux/layout.go` ~:81, alongside `#{@rk_marker}`), and restore (`internal/snapshot/restore.go` ~:338) SHALL reapply it via the existing `add("@rk_role", win.Role)` idiom (empty values omitted, never unset; failures are report notes).

- **GIVEN** a snapshot captured while a window carried `@rk_role=operator`
- **WHEN** the server dies and `rk snapshot restore` runs
- **THEN** the recreated window carries `@rk_role=operator`

#### R6: `rk role` CLI verb
A new `rk role <operator|clear>` cobra command (`cmd/rk/role.go`) SHALL set or clear `@rk_role` on the **current window**, derived from `$TMUX_PANE` (the `agent-hook` guard idiom: empty `$TMUX_PANE` ⇒ exit non-zero with a clear message for the explicit CLI, since a user typed it — unlike the fail-silent hook). `operator` applies the R2 radio clear via the shared helper; `clear` unsets. The value is validated (R1) before any tmux call; tmux calls use `exec.CommandContext` with timeouts (Constitution I). Output goes to stdout as data; errors to stderr (Toolkit Principle 9 posture).

- **GIVEN** a shell inside a tmux pane
- **WHEN** `rk role operator` runs
- **THEN** the pane's window carries `@rk_role=operator`, any prior carrier on the server is cleared, and a one-line confirmation prints
- **AND** outside tmux (`$TMUX_PANE` empty) the command exits non-zero with a "not inside tmux" error

### Frontend: pinned row and palette

#### R7: Operator pinned row — placement is the only visual change
When a server has a window with `role === "operator"`, the sidebar SHALL render that window's row **pinned at the top of that server's session area** (directly below the SESSIONS header on the single-server route; at the top of the server's group content on multi-server sidebars), **above all session groups**, and SHALL exclude it from its session group's window rows (move, don't copy — the session renders one fewer row; its window count derivation is untouched). The pinned row:

- is the ordinary `WindowRow` component — same styling, status dot, flyout, kill, label zone, pin popover; **no** badge, frame, label, divider, or any new chrome;
- shows the window name only (no session prefix);
- is **not draggable** (excluded from window drag-reorder; `draggable={false}`);
- participates in the tree's roving-tabindex keyboard navigation like any row;
- renders **nothing** when no operator is marked — the sidebar is identical to today (no placeholder).

- **GIVEN** session `run-kit` on the current server has windows `[hearty-reef, operator, logs]` and `operator` carries `role: "operator"`
- **WHEN** the sidebar renders
- **THEN** the `operator` row renders once, above all session groups, and the `run-kit` group renders only `[hearty-reef, logs]`
- **AND** when no window carries the role, no pinned row or placeholder renders

#### R8: Palette mark/unmark commands
The command palette's window actions (`windowActions` in `app.tsx` ~:2035) SHALL gain `Window: Mark as Operator` (visible when a current window exists and it is not the operator) and `Window: Unmark Operator` (visible when the current window is the operator). Both act on the **current window** via the existing partial-merge options client (`client.ts` — a `setWindowRole(server, windowId, role | null)` helper mirroring the marker helper at ~:643).

- **GIVEN** the terminal route on window `@7` which is not the operator
- **WHEN** the user runs `Window: Mark as Operator` from the palette
- **THEN** the options POST sets `@rk_role=operator` on `@7` and the pinned row appears (and any prior operator's row returns to its session group)

### Non-Goals

- No visual badge/glyph/frame/divider — placement is the entire UI treatment (explicit user decision).
- No liveness reconciliation — the marking persists until explicit unmark or window kill; a dead operator staying pinned is desired signal.
- No `Go to Operator` palette action, no operator-targeted instruction dispatch — future changes.
- No fab-kit changes — the `/fab-operator` skill self-mark is fab-kit backlog `[swun]`.

### Design Decisions

#### Role as a tmux window option, not tmux index mutation
**Decision**: Operator identity is the `@rk_role` window user option; the sidebar floats the row at render time.
**Why**: Derived-from-tmux state (Constitution II), follows the `@rk_marker` option family, survives restarts, keeps window indices and `@N` addressing untouched, and makes the operator addressable for future features.
**Rejected**: `tmux move-window -t 0` (mutates indices, displaced by renumber/new windows, conveys nothing); per-session `@rk_window_order` (pure ordering preference, no role semantics).
*Introduced by*: 260813-ifya-operator-role-pinned-row

#### Server-scoped radio enforced in the write path
**Decision**: One operator per tmux server; every rk writer (POST handler, CLI) clears prior carriers as part of the set.
**Why**: The pinned slot sits above all session groups — one slot per server — and fab-operator coordinates worktree sessions across the whole project. Client-side enforcement would let stale carriers accumulate.
**Rejected**: Per-session radio (contradicts the top-of-panel placement); read-side "first wins" tie-breaking (leaves stale options on windows).
*Introduced by*: 260813-ifya-operator-role-pinned-row

#### CLI acts on the current window via `$TMUX_PANE`
**Decision**: `rk role` targets the invoking pane's window, hard-erroring outside tmux.
**Why**: The primary consumer is an agent marking itself (fab-kit `[swun]`); current-window default makes the fail-silent one-liner trivial. An explicit CLI invocation outside tmux is user error and should say so (unlike the fail-silent `agent-hook`, which is invoked by harness hooks).
**Rejected**: A `--target` flag in v1 (no consumer; the API path covers remote marking).
*Introduced by*: 260813-ifya-operator-role-pinned-row

## Tasks

### Phase 1: Backend option contract

- [x] T001 Add `RoleOption = "@rk_role"` constant to `app/backend/internal/tmux/tmux.go` and `RoleValues`/`ValidateRoleValue` (closed set `""`/`"operator"`) to `app/backend/internal/validate/validate.go`, with validate unit tests mirroring the marker tests <!-- R1 -->
- [x] T002 Append `#{@rk_role}` to the window enumeration format and parse it in `parseWindows` into `WindowInfo.Role` (`json:"role,omitempty"`, closed-set drop) in `app/backend/internal/tmux/tmux.go`; update `parseWindows` tests <!-- R4 -->
- [x] T003 Add the server-wide radio-clear helper to `app/backend/internal/tmux/` (enumerate `list-windows -a` carriers, unset all except the target window ID), with tests <!-- R2 -->
- [x] T004 Wire `optKeyRole` into `app/backend/api/windows.go`: allowlist case, `validateWindowOption` case, empty-string→unset mapping, radio-clear invocation on set (before the batched `SetWindowOptions`); handler tests for set/unset/reject/radio <!-- R3 -->

### Phase 2: Snapshot + CLI

- [x] T005 [P] Add `Role` to the snapshot `Window` schema: capture via `app/backend/internal/tmux/layout.go` format + parse, reapply in `app/backend/internal/snapshot/restore.go` (`add("@rk_role", win.Role)`); update capture/restore tests <!-- R5 -->
- [x] T006 [P] New `rk role <operator|clear>` command in `app/backend/cmd/rk/role.go`: `$TMUX_PANE` guard (hard error outside tmux), value validation, shared radio helper on set, stdout confirmation; command tests <!-- R6 -->

### Phase 3: Frontend

- [x] T007 Add `role?: string` to `WindowInfo` in `app/frontend/src/types.ts` and a `setWindowRole` helper in `app/frontend/src/api/client.ts` mirroring the marker helper (partial-merge `/options` POST, null clears) <!-- R7 -->
- [x] T008 Sidebar pinned row in `app/frontend/src/components/sidebar/` (ServerGroup): find the server's `role === "operator"` window, render its ordinary `WindowRow` (not draggable, name only) at the top of the group's session area, exclude it from its session group's rows; roving-tabindex registration; unit tests (pinned present/absent, exclusion, no placeholder, not draggable) <!-- R7 -->
- [x] T009 Palette commands `Window: Mark as Operator` / `Window: Unmark Operator` in `app/frontend/src/app.tsx` `windowActions` (current-window scoped, visibility per R8) using `setWindowRole`; unit tests <!-- R8 -->

### Phase 4: Integration & verification

- [x] T010 Playwright e2e: mark a window operator (via the options POST route), assert the pinned row renders above session groups and the window leaves its session group; unmark restores; `.spec.md` companion updated in the same commit <!-- R7 -->
- [x] T011 Run verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e "<new spec>"` <!-- R1 -->

## Execution Order

- T001 → T002/T003 (constants/validation first); T003 → T004 and T006 (both consume the radio helper)
- T005, T006 are parallel after Phase 1
- T007 → T008/T009; T010 after T008
- T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ValidateRoleValue` accepts exactly `""`/`"operator"` and rejects everything else with a message; `RoleOption` constant exists and is used by every writer/reader (no bare `"@rk_role"` literals outside the constant + format strings)
- [x] A-002 R3: The options POST sets, unsets (null and `""`), and rejects invalid `@rk_role` values with 400 and zero tmux calls; the SSE hub wake fires on success
- [x] A-003 R4: A window with the option set surfaces `"role": "operator"` in the sessions payload; unknown stored values are dropped to unset at parse
- [x] A-004 R5: Snapshot capture records the role and restore reapplies it (empty omitted)
- [x] A-005 R6: `rk role operator`/`rk role clear` mutate the current window, print a confirmation to stdout, and hard-error outside tmux
- [x] A-006 R7: The pinned row renders above all session groups when an operator exists, and the window is absent from its session group (rendered exactly once)
- [x] A-007 R8: Both palette commands exist, act on the current window, and gate their visibility on the current window's operator state

### Behavioral Correctness

- [x] A-008 R2: Marking a second window clears the first — verified at the tmux layer (helper test) and through the POST handler (handler test)
- [x] A-009 R7: With no operator marked, the sidebar renders pixel-identical structure to today — no placeholder, no wrapper elements around the (absent) slot

### Scenario Coverage

- [x] A-010 R7: E2e proves mark → pinned row appears + row leaves its session group; unmark → row returns; companion `.spec.md` documents both tests
- [x] A-011 R6: CLI test covers the no-`$TMUX_PANE` error path

### Edge Cases & Error Handling

- [x] A-012 R2: Radio clear with zero prior carriers is a no-op (no error); radio clear when the target already carries the role is idempotent
- [x] A-013 R7: An operator window in a **collapsed** server group (board route) does not render a floating orphan row; the ghost-window and multi-select paths ignore the pinned row gracefully

### Code Quality

- [x] A-014 Pattern consistency: new code follows the `@rk_marker` idioms end-to-end (constant, validate, allowlist, parse-drop, snapshot add, client helper)
- [x] A-015 No unnecessary duplication: radio helper is shared by the POST handler and CLI; no inline tmux command construction outside `internal/tmux/` (anti-pattern list)
- [x] A-016 All new subprocess calls use `exec.CommandContext` with timeouts via the `internal/tmux` Run core; no shell strings
- [x] A-017 Tests included for new behavior (validate, parse, radio, handler, CLI, sidebar, palette, e2e) per code-quality baseline

### Security

- [x] A-018 R3: `@rk_role` values reach tmux only through the allowlist + closed-set validation (no client string passes through unvalidated)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (`@rk_role` option contract, radio clear, pinned row, palette pair, `rk role` verb) without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The existing options-POST hub wake covers the freshness requirement — no new wake seam needed | Verified in `handleWindowOptions`: the wake fires for all option keys post-write | S:85 R:90 A:95 D:95 |
| 2 | Confident | Pinned row renders inside the ServerGroup's open content (a collapsed group hides it, like every other row) | "Top of that server's session area" semantics; a floating always-visible row would be new chrome, which the user rejected | S:65 R:85 A:80 D:75 |
| 3 | Confident | CLI hard-errors outside tmux (unlike the fail-silent agent-hook) | An explicitly typed command failing silently would be confusing; the fail-silent contract belongs to the *caller* (the fab skill gates on `command -v rk`) | S:60 R:85 A:80 D:75 |
| 4 | Confident | Radio clear executes as a separate tmux call before the batched `SetWindowOptions` (not folded into one `\;` chain) | Carrier enumeration needs a read; two bounded calls under one context timeout is the simpler, testable shape | S:55 R:85 A:75 D:70 |
| 5 | Certain | `setWindowRole` client helper mirrors the marker helper's partial-merge shape | Direct pattern copy at client.ts:643 | S:80 R:90 A:95 D:95 |
| 6 | Confident | `rk role` prints its confirmation (`@N role=operator` / `@N role cleared`) to stdout as data via the outputSink; the radio-clear helper takes the server-targeting argv prefix so the daemon (-L name) and in-pane CLI (-S socket) share one enforcement point | Principle 9 (stdout = data) plus run.go's documented "callers build their own argv prefix" philosophy — the only shape that lets POST handler and CLI share the helper | S:70 R:80 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
