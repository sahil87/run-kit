# Plan: Mux Sessions Role Query

**Change**: 260905-csk9-mux-sessions-role-query
**Intake**: `intake.md`

## Requirements

### CLI: `rk mux sessions` — session enumeration with derived roles

#### R1: The verb — 13th `rk mux` member, enumeration query
`rk mux sessions [--json] [--all]` SHALL enumerate the sessions of the resolved tmux server — one row per session, **no positional target** (an enumeration query like `panes`; a stray argument is usage, exit 2). It SHALL be registered in the *Pane mechanics* help group beside `panes`, SHALL consume the family's inherited `-L/--server` with the standard resolution order (`-L` wins → the caller's `$TMUX` socket basename → `default`), SHALL NOT call `muxRejectInheritedServerFlag`, and SHALL have no daemon dependency (tmux addressed directly via `internal/tmux`). Family prose (the `mux.go` header comment, `muxCmd` `Long:`, the twelve-member wording) SHALL be updated to thirteen members.

- **GIVEN** a live tmux server with sessions
- **WHEN** `rk mux sessions` runs from a pane on that server
- **THEN** one row per user-facing session prints on stdout
- **AND** `rk mux sessions -L other` enumerates the `other` server instead

#### R2: Derived role taxonomy — never stamped
Each session SHALL be classified at request time from its name against the reserved constants in `internal/tmux` — no new tmux option is written or read:

| Role | Rule |
|------|------|
| `pin` | `strings.HasPrefix(name, PinSessionPrefix)` (`_rk-pin-*`) |
| `control` | `name == ControlAnchorSessionName` (`_rk-ctl`) |
| `operator` | `name == OperatorSessionName` (`_rk-operator`) |
| `reserved` | any other name with the `_rk-` prefix (future infrastructure) |
| `user` | everything else |

The classifier SHALL be a pure exported function in `internal/tmux` (e.g. `SessionRole(name string) string`). `role: operator` is **unconditional structural** classification — deliberately independent of the dashboard's content-conditional `operatorSessionHidden` rule, which is untouched.

- **GIVEN** sessions `_rk-ctl`, `_rk-operator`, `_rk-pin-42`, `_rk-future-thing`, `fabKit`
- **WHEN** each name is classified
- **THEN** the roles are `control`, `operator`, `pin`, `reserved`, `user` respectively

#### R3: Default filter — user-facing only; `--all` adds labeled infrastructure
The default invocation SHALL list only `role: user` sessions (the spawn-candidate set a consumer like fab's operator needs). `--all` SHALL include every session, each labeled with its role.

- **GIVEN** a server holding `_rk-ctl`, `_rk-operator`, and `fabKit`
- **WHEN** `rk mux sessions --json` runs
- **THEN** the array contains exactly the `fabKit` row
- **AND WHEN** `rk mux sessions --all --json` runs
- **THEN** all three rows appear with roles `control`, `operator`, `user`

#### R4: Output shapes and exit codes — the `panes` conventions
Default output SHALL be an aligned table (columns: `NAME  ROLE  ATTACHED  WINDOWS  PATH`) on stdout with diagnostics on stderr; `--json` SHALL emit a two-space-indented array with exactly the keys `name`, `role`, `attached`, `windows`, `path`, `grouped` per row. Exit codes follow the toolkit convention: **0** success — including an alive server with nothing to list (`[]` under `--json`; empty enumeration is liveness-probed via `tmux.ServerAlive` to separate "alive, empty" from "no server"); **1** operational (no server on the resolved socket, tmux failure — carrying tmux's diagnostic); **2** usage.

- **GIVEN** an alive server whose only sessions are infrastructure
- **WHEN** `rk mux sessions --json` runs
- **THEN** it prints `[]` and exits 0
- **AND GIVEN** no server on socket `nope`, **WHEN** `rk mux sessions -L nope` runs, **THEN** exit is 1 with tmux's diagnostic on stderr
- **AND GIVEN** a stray positional argument, **THEN** exit 2

#### R5: Group folding and attached semantics
Session-group copies SHALL NOT appear as rows: enumeration folds each group onto its leader via the group-list rule (`baseGroupName` — never the numeric `#{session_group}`), with `grouped: true` on the leader row. `attached` SHALL count **size-arbitrating human clients** via the `tmux.ListClients` group-key join (`ClientInfo.SessionKey`) — control-mode/ignore-size and unsized clients are already excluded by `ListClients`, so the dashboard's own relay attaches never inflate the count, and a viewer attached via a group copy credits the leader.

- **GIVEN** session `work` with a grouped copy `work-82` holding one attached sized client
- **WHEN** `rk mux sessions --json` runs
- **THEN** exactly one row `work` appears with `grouped: true` and `attached: 1`

#### R6: Existing enumeration consumers untouched
`parseSessions`, `ListSessions`, the dashboard REST/SSE paths, `rk mux panes`, and the `Hidden` operator-home rule SHALL be behaviorally unchanged. The new enumeration reads raw `list-sessions` itself (the chokepoint unconditionally drops pin/ctl rows, so `--all` cannot ride it); it MAY share format-field constants and the group-fold helper.

- **GIVEN** the existing internal/tmux and internal/sessions test suites
- **WHEN** the change is applied
- **THEN** they pass without modification (new tests are additive)

### Non-Goals

- fab-kit consumption edits — amended onto fab-kit PR #645 separately (intake coordination note)
- Per-session repo-affinity rollup — stays fab's pane-map join (cli-layering delegation)
- A `@rk_ses_role` tmux option — role is derivable; Constitution II/X
- Dashboard/API/SSE surface changes — CLI-only, additive

### Design Decisions

#### Session role is a derived query, not a stamped option
**Decision**: Expose roles via `rk mux sessions` classifying names at request time against the reserved constants; write no `@rk_ses_role` option.
**Why**: Role is fully derivable from session names (Constitution II: derive from tmux at request time; Constitution X: options carry only the underivable). A stamped option can drift from the name that actually drives run-kit's own behavior.
**Rejected**: `@rk_ses_role` session option (drift risk, write-path complexity, migration burden); extending `rk mux panes` rows with session facts (wrong grain — empty sessions would vanish).
*Introduced by*: 260905-csk9-mux-sessions-role-query

#### `reserved` catch-all formalizes `_rk-*` as run-kit's namespace
**Decision**: Any `_rk-*` name not matching a known constant classifies as `reserved`, and `_rk-*` is documented as run-kit's reserved session-name namespace.
**Why**: Consumers filtering `role != "user"` stay correct when rk adds a fourth infrastructure kind — the drift-proofing that makes the query strictly better than the prefix-copying it replaces (fab-kit cx52).
**Rejected**: Enumerating only the three known kinds (every new reserved name would silently classify `user` and leak into consumers' candidate sets).
*Introduced by*: 260905-csk9-mux-sessions-role-query

#### Raw enumeration beside the chokepoint, not a chokepoint flag
**Decision**: `ListSessionFacts` issues its own `list-sessions` (all sessions, including pin/ctl) and folds groups itself, rather than adding an include-infrastructure flag to `parseSessions`.
**Why**: The chokepoint's unconditional pin/ctl drop is the single guarantee that no infrastructure session leaks into any dashboard consumer; a bypass flag would weaken that invariant for every caller to protect one.
**Rejected**: Parameterizing `parseSessions` (invariant erosion); post-hoc re-adding filtered rows (the chokepoint discards them before they can be labeled).
*Introduced by*: 260905-csk9-mux-sessions-role-query

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/tmux/tmux.go` (+ `tmux_test.go`): add `SessionRole(name string) string` (five-role classifier over the existing reserved constants) and `SessionFacts`/`ListSessionFacts(ctx, server)` — raw `list-sessions` enumeration (name, group list, windows, path), group folding via `baseGroupName` (leader keeps name, copies dropped, `grouped` set), `attached` via `ListClients` + `SessionKey` count fold; unit tests for the classifier truth table and the fold (pure parse helpers, no live tmux) <!-- R2, R5, R6 -->
- [x] T002 `app/backend/cmd/rk/mux_sessions.go` + `mux.go`: new `rk mux sessions [--json] [--all]` command on the `mux_panes.go` model (seam functions, tabwriter table `NAME ROLE ATTACHED WINDOWS PATH`, two-space `--json` array with keys name/role/attached/windows/path/grouped, `ServerAlive` probe on empty, exit codes 0/1/2); register in the mechanics help group; update `mux.go` header comment, `muxCmd` `Long:`, and twelve→thirteen member wording <!-- R1, R3, R4 -->
- [x] T003 `app/backend/cmd/rk/mux_sessions_test.go` (+ `mux_test.go` group test): seam-based command tests — default user-only filter, `--all` labeled rows, `--json` exact key shape, empty `[]` exit 0, dead-socket exit 1, stray-arg exit 2; update `TestMuxHelpPresentsThreeGroups` membership for `sessions` <!-- R1, R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 `docs/site/skill/mux.md`: add the `rk mux sessions` section (examples, role table, exit codes); sweep repo for stale twelve-member family phrasing (`docs/site/skill.md`, `docs/site/skill/messaging.md`, comments) and update; confirm help-dump needs no code change (cobra tree walk) and the surface passes the toolkit help-dump + Principle 9 posture <!-- R1, R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux sessions` is registered under `rk mux` in the *Pane mechanics* group, takes no positional args, consumes inherited `-L`, and carries a `Long:` block (help-dump publishes `UsageString`)
- [x] A-002 R2: `SessionRole` classifies all five roles per the truth table, covered by unit tests
- [x] A-003 R3: default output lists `role: user` rows only; `--all` includes infrastructure rows labeled with their roles
- [x] A-004 R4: `--json` emits exactly `name`/`role`/`attached`/`windows`/`path`/`grouped` per row; table and JSON shapes verified by tests

### Behavioral Correctness

- [x] A-005 R6: `parseSessions`, `ListSessions`, and `internal/sessions` behavior unchanged — existing tests pass without modification

### Scenario Coverage

- [x] A-006 R4: empty enumeration prints `[]`/empty table with exit 0 (liveness-probed); dead socket exits 1 with tmux's diagnostic; stray argument exits 2 — each covered by a test
- [x] A-007 R5: group copies fold onto the leader (`grouped: true`, one row); `attached` counts group-credited sized clients — covered by fold unit tests

### Edge Cases & Error Handling

- [x] A-008 R2: an unknown `_rk-*` name classifies `reserved` (never `user`); names merely containing `_rk-` mid-string classify `user`

### Code Quality

- [x] A-009 Pattern consistency: command follows the `mux_panes.go` seam/test pattern; table/JSON/exit conventions match the family
- [x] A-010 No duplication: reuses `PinSessionPrefix`/`ControlAnchorSessionName`/`OperatorSessionName`, `baseGroupName`, `ListClients`; no parallel constants or fold logic
- [x] A-011 All tmux interaction via `internal/tmux` with `exec.CommandContext` timeouts; no shell strings
- [x] A-012 Comments state constraints only — no narration, no change-ID/PR provenance in code or tests
- [x] A-013 New behavior has tests (classifier, fold, command shapes, exit codes)

### Security

- [x] A-014 R1: the `-L` server name flows only through the existing validated `internal/tmux` exec paths (argument slices, contexts with timeouts)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. `parseSessions`/`ListSessions` remain the dashboard chokepoint (the new enumeration reuses both read-only), and the `sessionListFormat` extraction shares rather than supersedes the previous inline format string.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | JSON row keys are exactly `name`/`role`/`attached`/`windows`/`path`/`grouped`; later additions are additive | Intake fixed the fact set; `panes` precedent pins exact-key discipline | S:80 R:85 A:90 D:85 |
| 2 | Confident | `attached` = `ListClients` group-key count (human sized clients), not `#{session_attached}` | `#{session_attached}` counts control-mode relays — the dashboard's own attach would inflate it; `ListClients` already excludes those | S:70 R:85 A:85 D:75 |
| 3 | Confident | Table columns `NAME ROLE ATTACHED WINDOWS PATH`; rows in tmux enumeration order | Presentation detail; matches `panes`' aligned-table posture | S:60 R:90 A:80 D:70 |
| 4 | Confident | `ListSessionFacts` lives in `internal/tmux` beside the constants and `baseGroupName` it reuses | Locality of the classifier with the names it classifies; sessions-package would invert the dependency | S:65 R:85 A:85 D:75 |

4 assumptions (1 certain, 3 confident, 0 tentative).
