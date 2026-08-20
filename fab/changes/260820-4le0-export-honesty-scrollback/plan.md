# Plan: Export Honesty + Scrollback

**Change**: 260820-4le0-export-honesty-scrollback
**Intake**: `intake.md`

## Requirements

### Frontend: Client scrollback

#### R1: Device-split scrollback default on the xterm Terminal
`terminal-client.tsx` SHALL set the xterm `Terminal` constructor's `scrollback` option from a new optional prop `scrollback?: number`, defaulting when absent to a device-split value via the existing `isMobileViewport()` rule (the font-size precedent): exported constants `SCROLLBACK_DESKTOP = 25_000` and `SCROLLBACK_MOBILE = 10_000`.

- **GIVEN** a desktop terminal-route mount with no `scrollback` prop
- **WHEN** the Terminal is constructed
- **THEN** its `scrollback` option is 25000 (10000 when `isMobileViewport()` is true)
- **GIVEN** an explicit `scrollback={1000}` prop
- **WHEN** the Terminal is constructed
- **THEN** the option is exactly 1000

#### R2: Board panes pinned to 1000
`board/board-pane.tsx`'s `TerminalClient` mount SHALL pass `scrollback={1000}` explicitly — boards mount many live terminals as preview surfaces; the previous effective default is kept, now explicit.

- **GIVEN** a board with pane cards
- **WHEN** panes mount
- **THEN** each TerminalClient receives `scrollback={1000}`

### Backend: altScreen surfaced

#### R3: `#{alternate_on}` in the pane enumeration
The pane format list in `internal/tmux/tmux.go` (the `#{pane_id}`/`#{pane_active}`… list feeding `FetchSessions`) SHALL gain `#{alternate_on}`, parsed into a new `PaneInfo` bool field (e.g. `AltScreen`). Parsing follows the existing field conventions (positional split, `"1"` → true).

- **GIVEN** a pane whose app is on the alternate screen
- **WHEN** sessions are enumerated
- **THEN** its `PaneInfo.AltScreen` is true; false otherwise

#### R4: `altScreen` on WindowInfo (active-pane rule)
`WindowInfo` (internal/sessions + its JSON payload) SHALL gain `altScreen` — the ACTIVE pane's `AltScreen` (the same active-pane rule `CaptureWindowHistoryCtx` targets). Derived at request time, no state (Constitution II). Mirror the field in the frontend `WindowInfo` type (`src/api/client.ts` or wherever the SSE window type lives).

- **GIVEN** a window whose active pane is alt-screen
- **WHEN** the SSE snapshot renders
- **THEN** the window's JSON carries `altScreen: true`
- **GIVEN** a split where a NON-active pane is alt-screen but the active pane is not
- **THEN** `altScreen` is false

### Frontend: Honest server row

#### R5: History row disabled with hint on altScreen
When the current window's `altScreen` is true, the export menu's "Download pane history" row SHALL render disabled (`disabled` + `aria-disabled`, dimmed per the menu's row vocabulary) with the subtitle replaced by `agent TUI on alternate screen — tmux holds no scrollback`. No click handler fires, no fetch. The section header and the three client rows are unchanged; `altScreen: false` behaves exactly as shipped.

- **GIVEN** an agent window (`altScreen: true`) with the export menu open
- **WHEN** the "Full history — server capture" section renders
- **THEN** the history row is disabled and shows the alt-screen hint
- **AND** clicking it fetches nothing

#### R6: Palette action gated
The `Terminal: Download full history` palette action SHALL be absent while the current window's `altScreen` is true (availability gating, the existing idiom — not a disabled entry). The other three `Terminal:` actions are unaffected.

- **GIVEN** `altScreen: true` on the current window
- **WHEN** the palette opens on the terminal route
- **THEN** `Terminal: Download full history` is not listed; the other three export actions are

### Non-Goals

- No chat-JSONL transcript arm (explicitly declined).
- No change to the history endpoint or capture helper (correct for normal-screen panes).
- No tmux.conf change; the rk-update conf-refresh gap is a separate follow-up change.
- No user-facing scrollback setting — constants only.

### Design Decisions

#### Scrollback is a prop-with-device-split-default, not a context preference
**Decision**: optional `scrollback?: number` prop; absent → `isMobileViewport() ? 10_000 : 25_000`.
**Why**: the terminal-route tile (and duplicate tty tiles) want the big buffer with zero plumbing; boards opt down explicitly; sizing came from measured sessions (19k–31k rendered lines for the heaviest; ~25–60MB worst-case filled desktop buffer is acceptable for one tile, not for N board panes).
**Rejected**: a ChromeContext preference (no user asked for a knob); a flat global (mobile memory); resizing live buffers on viewport change (xterm applies `options.scrollback` live, but the split is a mount-time device rule like `fontPx` — not worth a reactive effect).
*Introduced by*: 260820-4le0-export-honesty-scrollback

#### Menu-time honesty over click-time failure
**Decision**: gate the row/action on a new SSE `altScreen` field rather than returning an error shape from the endpoint.
**Why**: the artifact is not merely unavailable — it structurally cannot exist for alt-screen panes; advertising it and failing on click would keep the lie one step longer. The field is one format-list token + one derived bool.
**Rejected**: endpoint 409/422 + toast (click-time); probing `history_size` too (an alt-screen pane with stale pre-TUI history would re-enable a misleading row).
*Introduced by*: 260820-4le0-export-honesty-scrollback

## Tasks

### Phase 1: Backend

- [x] T001 Add `#{alternate_on}` to the pane format list in `app/backend/internal/tmux/tmux.go`, parse into `PaneInfo.AltScreen` (follow the `pane_active` parse convention); update any positional-parse tests <!-- R3 -->
- [x] T002 Derive `WindowInfo.altScreen` from the active pane in `app/backend/internal/sessions/sessions.go` (+ JSON tag); extend the sessions tests for the active-pane rule (active alt → true; non-active alt only → false) <!-- R4 -->

### Phase 2: Frontend

- [x] T003 [P] `terminal-client.tsx`: `SCROLLBACK_DESKTOP`/`SCROLLBACK_MOBILE` constants, optional `scrollback` prop, device-split default, pass to the Terminal constructor; unit tests for default split + explicit override <!-- R1 -->
- [x] T004 [P] `board/board-pane.tsx`: pass `scrollback={1000}` <!-- R2 -->
- [x] T005 Mirror `altScreen` in the frontend WindowInfo type; disable the export menu's history row with the hint `agent TUI on alternate screen — tmux holds no scrollback` when the current window's `altScreen` is true (`surface-layout.tsx`); unit test both row states <!-- R4, R5 -->
- [x] T006 Gate the `Terminal: Download full history` palette action on `!altScreen` in `app.tsx`; unit or existing-pattern test for the gate <!-- R6 -->

### Phase 3: Gates

- [x] T007 Run gates: `cd app/backend && go test ./internal/... ./api/...`; `cd app/frontend && npx tsc --noEmit`; targeted vitest (terminal-client, surface-layout, board-pane, client); `just test-e2e "terminal-export"` still green (its rig pane is normal-screen; run `just setup` first if node_modules is missing) <!-- R1–R6 -->

## Execution Order

- T002 depends on T001. T005 depends on T002 (field name) and can follow T003/T004. T006 after T005. T007 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Terminal constructor receives 25000/10000 by device, or the explicit prop value
- [x] A-002 R2: board panes mount with `scrollback={1000}`
- [x] A-003 R3: `#{alternate_on}` enumerated and parsed into `PaneInfo.AltScreen`
- [x] A-004 R4: `WindowInfo.altScreen` = active pane's alt state, in the JSON payload and the frontend type
- [x] A-005 R5: altScreen window → history row disabled + hint, no fetch on click
- [x] A-006 R6: altScreen window → `Terminal: Download full history` absent from the palette; other three present

### Behavioral Correctness

- [x] A-007 R5: non-altScreen windows keep the shipped row behavior byte-identical
- [x] A-008 R4: split with only a non-active alt pane → `altScreen: false`

### Scenario Coverage

- [x] A-009 R1: unit test proves the device split and the explicit override
- [x] A-010 R5: unit test proves both row states (enabled subtitle vs disabled hint)

### Edge Cases & Error Handling

- [x] A-011 R4: zero-pane/missing-window enumeration degrades to `altScreen: false` (no panic, no lie toward true)

### Code Quality

- [x] A-012 Pattern consistency: parse follows the positional pane-format conventions; menu disabled state follows the existing disabled vocabulary; palette gating follows the availability idiom
- [x] A-013 No unnecessary duplication: one constants pair, no second device-split rule (reuse `isMobileViewport()`)
- [x] A-014 Type narrowing over assertions: no new `as` casts

### Security

- [x] A-015 R3: format-list addition introduces no new subprocess surface (same list-panes argv shape)

## Notes

- This worktree previously ran `just setup`; re-run only if frontend deps are missing.
- e2e: `just test-e2e "<spec>"` only; sibling-worktree 3020 contention — if waiting, poll `ss -tln | grep ':3020 '`, never a `pgrep -f` guard (self-matches its own subshell and deadlocks).

## Deletion Candidates

- None — this change adds new functionality (a pane-format field, a window-level rollup, a constructor option, a menu-row state) without making existing code redundant; the boards' former implicit xterm 1000-line default is now explicit, not removed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `PaneInfo` field named `AltScreen`, JSON `altScreen` | Matches Go/JSON naming conventions in the payload; trivially renamed | S:60 R:95 A:85 D:85 |
| 2 | Confident | Board pin uses the literal `1000` (xterm's former effective default) rather than a third constant | The value's meaning is "keep what boards had"; a constant would imply a tunable that isn't | S:55 R:90 A:80 D:75 |
| 3 | Confident | Scrollback default resolved at Terminal construction (mount-time), not reactive to viewport changes | Matches the fontPx mount-time device rule; a live viewport flip mid-session is rare and self-heals on remount | S:55 R:85 A:80 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
