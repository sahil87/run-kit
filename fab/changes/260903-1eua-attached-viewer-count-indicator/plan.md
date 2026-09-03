# Plan: Attached Viewer Count Indicator

**Change**: 260903-1eua-attached-viewer-count-indicator
**Intake**: `intake.md`

## Requirements

### Backend: list-clients derivation

#### R1: ListClients wrapper in internal/tmux
`internal/tmux` SHALL gain a `ListClients(ctx, server)` wrapper that runs `list-clients` through `tmuxExecServer` (so `-L {server}` handling, config-flag handling, and the `exec.CommandContext` timeout come for free) with a `listDelim`-separated format carrying at minimum `#{client_tty}`, `#{client_width}`, `#{client_height}`, `#{session_name}`, `#{session_group}`, `#{client_flags}`. A pure, exported-for-testing `parseClients(lines)` function SHALL parse the output into per-client entries, mirroring the `parseSessions`/`parsePanes` split (pure parser + thin exec wrapper). A server that is not running SHALL yield `nil, nil` via the existing `containsServerGoneText` idiom (same as `ListSessions`).

- **GIVEN** a tmux server with two attached clients and the rk daemon's control-mode subscription
- **WHEN** `ListClients(ctx, server)` runs
- **THEN** it returns one entry per client with tty, width, height, session key, and flags parsed
- **AND** a dead/absent server returns `nil, nil` (no error)

#### R2: Control-mode / ignore-size exclusion
The client parser SHALL exclude clients whose `#{client_flags}` contain `control-mode` or `ignore-size` (flags are a comma-separated list — match on the split tokens, not substring-of-the-whole-string). It SHOULD also drop entries with a non-positive width or height (an unsized client cannot participate in window-size arbitration). The exclusion lives in the pure parse/derive layer so it is unit-testable without a live server.

- **GIVEN** `list-clients` output containing `/dev/pts/5 144×91 attached`, `/dev/pts/8 116×37 attached`, and `/dev/pts/11 … control-mode,ignore-size`
- **WHEN** the lines are parsed
- **THEN** exactly the two sized `attached` clients survive; the control-mode subscription is excluded

#### R3: Per-session viewer fold in FetchSessions
`internal/sessions.FetchSessions` SHALL call `tmux.ListClients` once per invocation (one extra tmux round-trip per server per snapshot — same cost class as the existing enumeration calls) and fold the surviving clients into each `ProjectSession` as a new additive field `Viewers []Viewer` (`json:"viewers,omitempty"`), where `Viewer` is `{Width int "json:\"width\""; Height int "json:\"height\""}`. Clients are joined to sessions by **group key**: a client attached to a grouped session maps to the session whose name equals `#{session_group}` (the leader `parseSessions` keeps); an ungrouped client maps by `#{session_name}` — mirroring the leader-keeps-name rule so a viewer attached via a derived group copy still counts against the UI session. A `ListClients` failure SHALL degrade to no viewers (log-and-continue), never fail the fetch. No new endpoint, no cache, no pushed state (Constitution §II/§X): the field rides the existing `/api/sessions` REST payload and the state-socket `sessions` event automatically via the `ProjectSession` marshal.

- **GIVEN** two sized clients attached to session `devshell` (one via a derived group copy `devshell-82`)
- **WHEN** `FetchSessions` builds the payload
- **THEN** the `devshell` entry carries `viewers: [{width:144,height:91},{width:116,height:37}]`
- **AND** a session with no attached clients carries no `viewers` key (omitempty)

### Frontend: viewer badge + detail

#### R4: Session-row viewer badge, gated at ≥ 2
The frontend `ProjectSession` type (`src/types.ts`) SHALL gain `viewers?: { width: number; height: number }[]`, and `SessionRow` (`src/components/sidebar/session-row.tsx`) SHALL render a compact viewer-count indicator on the session header row **only when `viewers.length >= 2`** — the 1-viewer case is the norm and must add zero chrome (Constitution §IV). The badge is an informational channel, not an attention overlay (status-signals vocabulary): a small count chip in the neutral count-chip idiom (`text-text-secondary`, monospace, small — the muted sibling of `WaitingBadge`'s geometry, WITHOUT the signal-yellow attention treatment), placed in the header's flex row after the name (before `WaitingBadge`), with an `aria-label` like `"2 viewers attached"`. It is non-interactive decoration — the row's existing card is the detail surface — and MUST NOT introduce a per-second tick or any new props through the memoized tree (render-perf invariants: its input is `session.viewers`, already on the row's `session` prop).

- **GIVEN** a session payload with two sized viewers
- **WHEN** the sidebar renders the session row
- **THEN** a viewer-count chip showing the count is visible with an accessible label
- **AND** with zero or one viewer the chip does not render at all

#### R5: Viewer grids in the session flyout card
The session row's existing flyout card (the `useRowFlyout` content in `session-row.tsx`) SHALL show the per-viewer grids when `viewers.length >= 2`: a secondary line listing each viewer's `WxH` (e.g. `2 viewers · 144×91 · 116×37`), rendered beside/below the existing facts line in the same `text-text-secondary` treatment. The size is the diagnostic payload — it identifies the clamping client at a glance. The line is display-only: no actions, no kick/detach affordance. With fewer than 2 viewers the line is absent (card unchanged from today).

- **GIVEN** the badge is showing on a session row
- **WHEN** the user opens the row's card (fine-pointer hover/focus or the coarse rail tap)
- **THEN** the card lists each viewer's grid (`144×91`, `116×37`)
- **AND** no action row is added for viewers

### Tests

#### R6: Coverage across the derivation chain
The change SHALL include: (a) a Go table test for the client parser covering flag exclusion (control-mode/ignore-size), unsized-client drop, and the grouped-session join key; (b) a Go test for the `FetchSessions` fold (or the pure join helper it extracts) asserting viewers land on the right session and `omitempty` behavior; (c) a frontend `.test.tsx` for the badge's ≥2 gating and the card's viewer line; (d) a Playwright e2e extending an existing real-tmux sidebar flow: open the same window in **two pages/contexts** (each relay stream is a real sized `attach-session` client), then assert the badge appears on the session row with both grids reachable in the card — carrying the mandatory **Proves:/Steps:** intent comment (Constitution: Test Intent Comments).

- **GIVEN** the e2e rig with one open terminal page (1 viewer — no badge)
- **WHEN** a second page opens the same window at a different viewport size
- **THEN** the session row's viewer badge appears showing 2

### Non-Goals

- No mutation endpoints (no "kick viewer" — rk streams self-heal re-attach, an action would misrepresent).
- No per-window viewer attribution (clients attach to sessions; not derivable per window — Constitution §X).
- No persistence, no settings, no new routes, no client polling (the state stream is the transport).
- No mandatory command-palette entry — the indicator is passive information, not an action (Constitution §V governs actions).

### Design Decisions

#### Viewer→session join by group key
**Decision**: Join clients to sessions by `#{session_group}` when non-empty, else `#{session_name}`.
**Why**: `parseSessions` keeps the group leader (name == group) as the one UI entry; a client attached through a derived group copy (`devshell-82`) sizes the same shared windows, so it must count against the leader row.
**Rejected**: Joining by raw `#{session_name}` — silently drops viewers attached via group copies, exactly the invisible-second-viewer class this change exists to surface.
*Introduced by*: 260903-1eua-attached-viewer-count-indicator

#### Neutral count chip, not an attention badge
**Decision**: Render the badge in the muted informational idiom (`text-text-secondary` count chip), not the `WaitingBadge` signal-yellow treatment, and keep it non-interactive.
**Why**: Two viewers is a fact, not a problem needing action; the status-signals vocabulary reserves yellow/motion for "an agent needs you now". The card carries the diagnostic detail.
**Rejected**: Reusing `WaitingBadge` styling — would false-alarm every legitimate two-monitor setup.
*Introduced by*: 260903-1eua-attached-viewer-count-indicator

## Tasks

### Phase 1: Setup

- [x] T001 Add `ClientInfo` type + `parseClients(lines)` pure parser + `ListClients(ctx, server)` wrapper in `app/backend/internal/tmux/tmux.go` (listDelim format: client_tty, client_width, client_height, session_name, session_group, client_flags; server-gone → nil,nil) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Implement flag exclusion (token-split `control-mode`/`ignore-size`) and non-positive-size drop inside the parse/derive layer; add table test `TestParseClients` in `app/backend/internal/tmux/tmux_test.go` covering the live-diagnosis fixture (144×91 + 116×37 kept, control-mode excluded) <!-- R2 -->
- [x] T003 Add `Viewer` struct + `Viewers []Viewer` (`json:"viewers,omitempty"`) to `ProjectSession` and fold `ListClients` results in `FetchSessions` via a pure group-key join helper in `app/backend/internal/sessions/sessions.go`; ListClients failure degrades to no viewers <!-- R3 -->
- [x] T004 Add Go tests for the join helper + fold in `app/backend/internal/sessions/` (grouped-copy join, per-session bucketing, omitempty when zero) <!-- R3, R6 -->
- [x] T005 [P] Add `viewers?: { width: number; height: number }[]` to `ProjectSession` in `app/frontend/src/types.ts` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Render the viewer-count chip in `app/frontend/src/components/sidebar/session-row.tsx` header row (gated `viewers.length >= 2`, neutral count-chip idiom, `aria-label`, non-interactive, no new threaded props) and the viewer-grids line in the row's flyout card content <!-- R4, R5 -->
- [x] T007 Add `app/frontend/src/components/sidebar/session-row.test.tsx` coverage (or extend the existing sidebar test file) for: no chip at 0/1 viewers, chip + count at 2, card lists both grids <!-- R4, R5, R6 -->
- [x] T008 Extend an existing real-tmux Playwright spec in `app/frontend/tests/e2e/` — second page/context opens the same window, assert badge appears and card shows both grids; include the Proves:/Steps: intent comment; run via `just` recipes only <!-- R6 -->

### Phase 4: Polish

- [x] T009 Run verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted frontend tests, and the touched e2e spec via `just pw` <!-- R6 -->

## Execution Order

- T001 → T002 → T003 → T004 (backend chain); T005 is independent [P]
- T006 depends on T005 (type) and T003 (payload shape); T007 depends on T006; T008 depends on T006
- T009 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.ListClients` exists, routes through `tmuxExecServer` with timeout, returns parsed per-client entries, and returns nil,nil on a gone server
- [x] A-002 R3: `ProjectSession.viewers` rides both `/api/sessions` and the state-socket `sessions` event with no new endpoint and no client poll
- [x] A-003 R4: The session row shows the viewer chip exactly when ≥ 2 sized viewers are attached
- [x] A-004 R5: The row's flyout card lists each viewer's `WxH` grid when the chip shows

### Behavioral Correctness

- [x] A-005 R2: Clients flagged `control-mode` or `ignore-size` (the rk daemon's tmuxctl subscription) never count as viewers; unsized clients are dropped
- [x] A-006 R3: A client attached via a derived session-group copy counts against the group-leader session row

### Scenario Coverage

- [x] A-007 R6: Go table tests cover parser exclusion + join; frontend test covers gating + card detail; the e2e two-page scenario passes with the intent comment present

### Edge Cases & Error Handling

- [x] A-008 R3: A `ListClients` error degrades to sessions without viewers (fetch still succeeds); zero-viewer sessions omit the JSON key
- [x] A-009 R4: Old-backend payloads (no `viewers` key) render the sidebar unchanged (optional field, no crash)

### Code Quality

- [x] A-010 Pattern consistency: parser/wrapper split mirrors `parseSessions`/`ListSessions`; no inline tmux command construction outside `internal/tmux/`
- [x] A-011 No unnecessary duplication: reuses `tmuxExecServer`, `listDelim`, `containsServerGoneText`, existing chip/card idioms
- [x] A-012 Render performance: no new props threaded through the memoized `ServerGroup`/`SessionRow`/`WindowRow` tree; no per-second tick added to rows
- [x] A-013 Type narrowing over assertions in frontend changes; new behavior covered by tests (code-quality baseline)

### Security

- [x] A-014 R1: All new subprocess calls use `exec.CommandContext` with timeout via existing wrappers; no shell strings; no user input reaches tmux args unvalidated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Join clients to sessions by `#{session_group}` (fallback `#{session_name}`) so group-copy attaches count against the leader row | parseSessions' leader-keeps-name rule makes the group the UI key; raw-name join would hide exactly the ghost-viewer class this change surfaces | S:70 R:85 A:85 D:80 |
| 2 | Confident | Badge = neutral informational count chip after the session name (not WaitingBadge yellow); detail line in the existing session flyout card | Status-signals vocabulary reserves attention treatment for "needs you now"; card is the established per-row detail surface <!-- assumed: neutral chip idiom + card line — exact glyph/format is reversible styling --> | S:65 R:90 A:80 D:70 |
| 3 | Confident | E2E realizes the second viewer as a second Playwright page/context on the same window (each relay stream is a real sized attach client) | Pure-Playwright, no pty gymnastics; matches the relay's direct-attach model | S:70 R:85 A:85 D:75 |
| 4 | Certain | Viewers field is additive `omitempty` on `ProjectSession`, riding existing REST + state-socket payloads | The established additive-field idiom (sessionId/sessionPath precedent); Constitution §II/§X admit only this shape | S:85 R:90 A:95 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
