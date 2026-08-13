# Intake: Operator Role Pinned Row

**Change**: 260813-ifya-operator-role-pinned-row
**Created**: 2026-08-13

## Origin

> @rk_role=operator window option — server-scoped operator marking with pinned sidebar row under the SESSIONS header, palette mark/unmark commands, and rk role CLI verb

Conversational (`/fab-discuss` exploration → `/fab-new`). Key decisions reached in discussion:

- The operator window (typically running the `/fab-operator` skill) is the orchestrator of a server's other agent windows and deserves special placement in the sidebar.
- Mechanism: a new `@rk_role` tmux **window option** (value `operator`), following the existing `@rk_marker` closed-set-validated option pattern — chosen over (a) `tmux move-window -t 0` (mutates indices, invisible, fragile) and (b) a generic per-session `@rk_window_order` (different feature — pure preference, no role semantics).
- Placement evolved across the discussion: first "top of its session's window rows", then the user chose to go further — **pull the row out of its session group entirely and pin it directly below the SESSIONS section header**. This widens the radio scope from per-session to **per-server** (one operator per tmux server).
- **Explicitly rejected by the user**: any new chrome — framed slot, badge/glyph, micro-label, divider, left-edge accent (mockup variants A/B were shown and declined). *The only UI impact of `@rk_role=operator` is the placement of its row.*
- "Move, don't copy": the operator row leaves its session group (renders once, under the header); confirmed by user.
- Empty state: when no operator is marked, the sidebar looks exactly as it does today (no placeholder). Confirmed by user.
- Manual fallback = command palette mark/unmark commands only (keyboard-first, zero layout change); a flyout action row was considered and dropped with the chrome.
- Writers: the `/fab-operator` skill self-marks via a fail-silent `rk role operator` call — that is a **companion change in the fab-kit repo** (backlog `[swun]` there), out of scope here. This change ships the option contract, the CLI verb, the POST path, and the sidebar placement, so manual marking works before fab-kit ships.
- Ownership split: rk owns the option contract + radio semantics; fab (and any other agent harness) is just a producer — mirroring the `@rk_agent_state` two-tier convention.
- Strategic context: the marker makes the operator **addressable** ("give me server X's operator window"), which future changes can use as a command seam (dispatching instructions to the operator). Deliberately not part of this change.

## Why

1. **Pain point**: the operator window is the control plane for a server's worker windows (it monitors panes, answers prompts, routes commands), but it renders as just another window row, buried wherever tmux index order puts it among the workers it coordinates. Finding it — especially when it is waiting for input — takes scanning.
2. **Consequence of not fixing**: as multi-agent sessions grow (riff fan-outs, fab worktree workers), the one window the user most often needs to glance at or jump to keeps getting harder to locate; a blocked operator (which blocks everything downstream) looks no different from an idle shell.
3. **Why this approach**: a tmux window option is derived state (Constitution II — read from tmux at request time), follows the established `@rk_marker`/`@rk_session_order` option family, survives server restarts with the window, works for non-fab orchestrators via manual marking, and makes the operator addressable for future features. Sorting-by-render (no tmux mutation) keeps window indices and `@N` addressing untouched.

## What Changes

### 1. `@rk_role` window option contract (backend)

- New window user option `@rk_role`, closed value set: `""` (unset) | `"operator"`.
- Constant in `internal/tmux/tmux.go` alongside `SessionOrderOption`/`ServerRankOption` (e.g. `RoleOption = "@rk_role"`).
- Validation in `internal/validate` mirroring `ValidateMarkerValue` (validate.go:196): accept exactly `""`/`"operator"`, reject everything else.
- **Server-scoped radio, enforced in the write path**: setting `operator` on a window clears `@rk_role` from every other window on that tmux server (single tmux server = the scope; sessions on the same server share the one slot). Enforcement lives server-side in rk (POST handler / shared helper + the CLI verb) — never trusted to clients.
- Unset via the documented partial-merge body contract (`"@rk_role": null` unsets), per Constitution IX.

### 2. Enumeration, payload, and snapshot plumbing

- Add `#{@rk_role}` to the window enumeration format strings (`internal/tmux/tmux.go` ~:888 and `internal/tmux/layout.go` ~:81, alongside `#{@rk_marker}`).
- Surface as a `role` field on the window payload (`WindowInfo` on the frontend; the sessions API + SSE snapshot on the backend).
- Layout snapshots capture and restore it (`internal/snapshot/restore.go` alongside the `@rk_marker` add at ~:338), so an operator marking survives snapshot restore.
- Freshness: user-option mutations emit no tmux control-mode event, so the write path must wake the SSE hub the same way the existing color/marker POST handlers do — the pinned row should move on the next SSE tick, not the 12s safety poll.

### 3. Window-options POST

- The existing window-options endpoint (`api/windows.go` — `optKeyMarker` idiom at ~:353, handler at ~:390) accepts a new `"@rk_role"` key: `"operator"` to mark (triggering the radio clear), `null` to unmark.
- No new endpoint, no new HTTP verb (Constitution IX).

### 4. Sidebar pinned row (the only UI change)

- In the sidebar's SESSIONS tree: when any window on the server carries `role=operator`, render that window's row **directly beneath the SESSIONS section header, above all session groups**.
- **Move, don't copy** — the row is excluded from its session group's window rows (the session renders one fewer row; its displayed window count, derived from tmux, is unchanged).
- The pinned row is the **ordinary `WindowRow` component**: same styling, status dot, hover icons, flyout, kill, label zone, pin — placement is the only difference. It shows just the window name (no session prefix); the flyout carries the rest of the context.
- No new chrome: no badge, frame, label, or divider. No empty-state placeholder — with no operator marked the sidebar is pixel-identical to today.
- The pinned row is not draggable (it does not participate in window drag-reorder).
- Multi-server sidebars (board route): the slot is per-server — each server group renders its own operator row at the top of that server's session area.
- Radio semantics guarantee at most one pinned row per server.

### 5. Command palette (manual fallback)

- `Window: Mark as Operator` — sets `@rk_role=operator` on the current window (the window the route is on), via the window-options POST.
- `Window: Unmark Operator` — clears it; listed when the current window is the operator.
- These are the manual fallback for operators not started via fab (hand-driven sessions, other orchestrators) and the escape hatch for a stale/wrong marker. Registered per the palette-registration convention (code-review.md: new shortcuts documented in the palette registration).

### 6. `rk role` CLI verb

- `rk role operator` — mark the current window (derived from `$TMUX`/`$TMUX_PANE`), applying the same validation + radio clear.
- `rk role clear` — unmark the current window.
- Primary consumer: the fab-kit `/fab-operator` skill's fail-silent self-mark (companion change, fab-kit backlog `[swun]`).
- New command surface ⇒ toolkit-standards conformance check (help-dump, Principle 9 `--quiet` posture) per constitution § Toolkit Standards.

### Non-goals

- **No visual badge/glyph/frame/divider** — placement is the entire UI treatment (explicit user decision).
- **No liveness reconciliation** — the option persists until explicitly cleared or the window is killed; a dead/idle operator staying pinned is desired signal, not staleness (unlike `@rk_agent_state`).
- **No "Go to Operator" palette action** — natural follow-on once the resolver exists; separate change.
- **No instruction-dispatch / command-seam features** (sending prompts to the operator) — future changes build on the addressability this creates.
- **No fab-kit changes** — the skill self-mark is tracked in the fab-kit repo (`[swun]`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar operator pinned row (placement rules, move-don't-copy, per-server slot) + palette mark/unmark commands
- `run-kit/architecture`: (modify) `@rk_role` option in the API/SSE payload, window-options POST key, new `rk role` CLI subcommand
- `run-kit/layout-snapshots`: (modify) `@rk_role` joins the capture/restore option set
- `run-kit/toolkit-standards`: (modify) `rk role` added to the per-command audit ledger (help-dump + Principle 9)

## Impact

- **Backend** (`app/backend/`): `internal/tmux/tmux.go` (constant, format strings, radio-clear helper), `internal/tmux/layout.go`, `internal/validate/validate.go`, `internal/snapshot/restore.go` (+ snapshot capture struct), `api/windows.go` (options POST key + hub wake), sessions/SSE payload plumbing, `cmd/rk` (new `role` subcommand). Go unit tests for validation, radio semantics, payload plumbing.
- **Frontend** (`app/frontend/src/`): `types` (`WindowInfo.role`), `components/sidebar/index.tsx` (pinned-row extraction + exclusion from session groups), command-palette registration. Vitest unit tests for placement (operator present/absent, radio single-row, count unchanged); e2e coverage where feasible (with `.spec.md` companion if a new spec file is added).
- **Cross-repo**: fab-kit `[swun]` (skill self-mark) depends on `rk role operator` existing; this change has no dependency on fab-kit.

## Open Questions

*(none — all major decisions were resolved in the preceding discussion)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Option is `@rk_role` with closed value set {`operator`}, validated like `@rk_marker` | Discussed — user approved the option-based approach; naming chosen for future role extensibility over a boolean | S:90 R:70 A:95 D:90 |
| 2 | Certain | Server-scoped radio: one operator per tmux server, enforced in the rk write path | Discussed — top-of-panel placement implies server scope; user confirmed the placement knowing this | S:85 R:65 A:90 D:85 |
| 3 | Certain | UI impact is placement only: ordinary WindowRow pinned under the SESSIONS header, move-don't-copy, no chrome, no empty-state placeholder | Explicit user decisions ("no layout changes… only ui impact is placement", "yes, move don't copy", "things look like they do now if no operator") | S:95 R:80 A:90 D:95 |
| 4 | Confident | Multi-server (board-route) sidebar: per-server slot at the top of each server group's session area | Natural extension of "under the SESSIONS header" to the grouped view; not explicitly discussed | S:60 R:75 A:70 D:65 |
| 5 | Confident | Palette pair acts on the current window; Unmark listed when the current window is the operator | Palette-only fallback agreed; exact command semantics inferred from palette conventions | S:70 R:85 A:75 D:70 |
| 6 | Confident | CLI shape is `rk role operator` / `rk role clear`, defaulting to the current window via `$TMUX_PANE` | `rk role operator` named in discussion (and in fab-kit backlog `[swun]`); the clear-verb shape is assumed | S:65 R:80 A:70 D:60 |
| 7 | Confident | No liveness reconciliation — marking persists until explicit unmark or window kill | Discussed — "the role belongs to the window"; a visible dead operator is signal, not staleness | S:75 R:85 A:80 D:75 |
| 8 | Confident | `@rk_role` joins the layout-snapshot capture/restore set | Consistency with `@rk_marker`'s snapshot treatment; not discussed | S:55 R:85 A:85 D:80 |
| 9 | Confident | Pinned row is not draggable; session header window counts stay tmux-derived (unchanged) | Derived details of move-don't-copy; low-stakes render decisions | S:55 R:85 A:75 D:75 |
| 10 | Confident | The `@rk_role` POST wakes the SSE hub like the color/marker writes (no 12s safety-poll lag) | Known safety-poll latency for option mutations; reusing the existing wake seam is the obvious fix | S:60 R:80 A:75 D:80 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).
