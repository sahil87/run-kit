# Plan: tmux Option Dual-Read for Externally-Written Keys

**Change**: 260828-5jlp-tmux-option-dual-read-external-keys
**Intake**: `intake.md`

## Requirements

### tmux: Option constants and dual-read

#### R1: Scope-named constants with exported legacy siblings
`internal/tmux` SHALL define `EphemeralOption = "@rk_srv_ephemeral"`, `ProtectedOption = "@rk_srv_protected"`, `AgentStateOption = "@rk_pane_agent_state"`, `ChatOption = "@rk_pane_chat"`, and exported `LegacyEphemeralOption`, `LegacyProtectedOption`, `LegacyAgentStateOption`, `LegacyChatOption` carrying the retired names. No raw `"@rk_ephemeral"` / `"@rk_protected"` / `"@rk_agent_state"` / `"@rk_chat"` string literal MAY remain in non-test Go code outside these constant declarations (comments excepted).

- **GIVEN** the Go tree after apply
- **WHEN** `grep -rn '"@rk_\(ephemeral\|protected\|agent_state\|chat\)"' app/backend --include='*.go'` runs excluding `_test.go`
- **THEN** the only hits are the four `Legacy*Option` declarations in `internal/tmux/tmux.go`

#### R2: Server predicates read new-then-old
`IsEphemeralServer` and `IsProtectedServer` MUST read the new name first via `show-option -sv`; when it is unset (the existing `invalid option`/`unknown option` taxonomy) they MUST read the legacy name the same way. A non-empty trimmed value of whichever resolved is truthy. `IsServerGone` → `(false, nil)` and wrapped-error propagation are unchanged.

- **GIVEN** a live test server carrying only `@rk_ephemeral 1`
- **WHEN** `IsEphemeralServer` runs
- **THEN** it returns `(true, nil)`
- **AND** a server carrying only `@rk_srv_protected 1` makes `IsProtectedServer` return `(true, nil)`
- **AND** a server carrying neither returns `(false, nil)` for both

#### R3: Pane format carries both names, new wins
`paneFormat` MUST append `#{@rk_pane_agent_state}` and `#{@rk_pane_chat}` after `#{alternate_on}` (11 fields; indexes 0–8 unchanged). `parsePanes` MUST resolve the agent-state raw value as field 9 when non-empty else field 6, and the chat raw value as field 10 when non-empty else field 7, then feed the existing `parseAgentState` / `parseChatRef` and pid-liveness reconcile unchanged. Lines with fewer than 11 fields are skipped (the existing minimum-field rule, raised to 11). `PaneFactsCtx` MUST request `#{@rk_agent_state}\t#{@rk_pane_agent_state}` as fields 2–3 and `parsePaneFacts` MUST prefer field 3 when non-empty.

- **GIVEN** a `list-panes` line whose field 6 is `idle:100` and field 9 is `active:200:4242`
- **WHEN** `parsePanes` runs (pid 4242 alive)
- **THEN** the pane's `AgentState` is `active` with epoch 200
- **AND** a line with field 9 empty and field 6 `idle:100` yields `idle`/100
- **AND** a line with both empty yields an empty `AgentState`
- **AND** the same three cases hold for chat (fields 7 / 10 → `ChatProvider`/`ChatSessionRef`)

### tmux: Writers

#### R4: Server-key writers use the new names; unprotect clears both
`MarkServerEphemeral`, `MarkServerProtected` MUST write `@rk_srv_*`. `UnmarkServerProtected` MUST unset `@rk_srv_protected` AND `@rk_protected` (either may be the armed name during the window; a demote must fully disarm the guard). `scripts/test-e2e.sh`, `app/frontend/tests/e2e/_tmux.ts`, and `tests/e2e/protected-kill-confirm.spec.ts` MUST set the new names.

- **GIVEN** a live test server carrying legacy `@rk_protected 1`
- **WHEN** `UnmarkServerProtected` runs
- **THEN** `IsProtectedServer` returns `(false, nil)`

#### R5: `rk agent hook` dual-writes the pane keys in one exec
`writeAgentStateImpl` and `writeChatImpl` MUST each issue a single `tmux` invocation whose argv is `[-S <socket>] set-option -pt <pane> <new> <value> ; set-option -pt <pane> <old> <value>` — the `;` is its own argv element (tmux command chaining, no shell). Value, socket derivation from `tmux.OriginalTMUX`, `agentHookCmdTimeout`, and the never-fail contract are unchanged. Hook command text (`agentStateHookCommand`) and the `rkHookMarker*` constants' semantics are unchanged; `rkHookMarker` MUST be bound to `tmux.LegacyAgentStateOption` so first-generation inline one-liners keep being recognised by `isRkEntry`.

- **GIVEN** `runAgentHook` fires with state `active` for pane `%3`
- **WHEN** the `writeAgentStateFn` seam captures the argv passed to `tmux.Run`
- **THEN** the argv contains `@rk_pane_agent_state` once and `@rk_agent_state` once, both with the identical `active:<epoch>[:<pid>]` value, separated by a `;` element
- **AND** a settings.json entry whose command inlines `@rk_agent_state` is still matched by `isRkEntry`

### tmux: Migration table

#### R6: `CopyOnly` rows and the four new rows
`legacyOption` MUST gain `CopyOnly bool`. `moveLegacyAt` MUST skip the trailing `unsetOptionAt(Old)` when `row.CopyOnly` is true (the copy-when-New-unset step still runs; a carrier already holding both issues nothing). `purgeLegacyAt` is unchanged. The table MUST gain `{@rk_ephemeral → @rk_srv_ephemeral, scopeServer}`, `{@rk_protected → @rk_srv_protected, scopeServer}`, `{@rk_agent_state → @rk_pane_agent_state, scopePane, CopyOnly}`, `{@rk_chat → @rk_pane_chat, scopePane, CopyOnly}`. `CountLegacyOptions` MUST NOT count a `CopyOnly` row's `Old` held at its right scope, and MUST still count it at a wrong scope.

- **GIVEN** a live test server with `@rk_agent_state idle:1` on pane `%0` and `@rk_ephemeral 1` on the server
- **WHEN** `MigrateLegacyOptions` runs
- **THEN** pane `%0` holds `@rk_pane_agent_state idle:1` AND still holds `@rk_agent_state idle:1`
- **AND** the server holds `@rk_srv_ephemeral 1` and no longer holds `@rk_ephemeral`
- **AND** a second `sweepLegacyOptions` reports `changed == false`
- **AND** `CountLegacyOptions` returns 0 afterwards
- **AND** `@rk_agent_state` set at window scope is purged and counted before the sweep

### rk doctor: agent hooks row

#### R7: `agent hooks` check
`rk doctor` MUST add an `agent hooks` check (`failLabel: "agent hooks"`) implemented as a pure function over `(home, readFile, stat)` seams in the `tmuxGuardShimCheck` style. For each `agentRegistry(home)` entry it reads the settings file and classifies each rk-owned hook command (reusing `isRkEntry`'s three markers): gen-1 = contains `LegacyAgentStateOption` inline, gen-2 = contains ` agent-hook `, gen-3 = contains ` agent hook `. Outcomes: absent file / no rk entries → OK, Note `not installed (optional — install with \`rk agent setup\`)`; any gen-1 or gen-2 entry → FAIL, Hint `N stale hook entr(y|ies) in <path> (generation <g>) — they write legacy option names; re-run \`rk agent setup\` to replace them`; a gen-3 entry whose embedded rk path (the first double-quoted token after `; `) is not an existing regular executable → FAIL, Hint naming the path and `re-run \`rk agent setup\``; otherwise OK, Note `installed (generation 3, <agent>); writes @rk_pane_agent_state + @rk_agent_state`. The check MUST be registered in `runDoctorChecks`.

- **GIVEN** a fixture settings.json with one gen-3 entry pointing at an existing executable
- **WHEN** the check runs
- **THEN** `OK == true` and the Note names generation 3
- **AND** a fixture with a gen-1 inline entry yields `OK == false` with a Hint containing `generation 1`
- **AND** a fixture whose gen-3 path does not exist yields `OK == false` with the path in the Hint
- **AND** a missing settings file yields `OK == true` with the `not installed` Note

### Docs

#### R8: Cross-repo contract and site docs name both keys
`docs/specs/agent-state.md` MUST name `@rk_pane_agent_state` / `@rk_pane_chat` as canonical, state that `rk agent hook` writes both names and readers prefer new-then-old, and carry a "Naming / Deprecation window" subsection reproducing the intake's Deprecation ledger with the removal gate (no sooner than one release after fab-kit Change 4 ships and `rk doctor` `agent hooks` reports clean for ~a week). `docs/site/skill/mux.md`, `docs/site/skill.md`, `docs/site/status-dot.md` MUST use the new names. Changed `.spec.ts` files MUST have their `.spec.md` companions updated in the same commit (Constitution § Test Companion Docs).

- **GIVEN** the docs after apply
- **WHEN** `grep -rn '@rk_agent_state\|@rk_chat\|@rk_ephemeral\|@rk_protected' docs/specs/agent-state.md docs/site` runs
- **THEN** every hit is inside a sentence that also names the new key or the deprecation window

### Non-Goals
- Removing any legacy read, the second `set-option`, or the `CopyOnly` rows — the follow-up change owns removal.
- Changing hook command text or bumping a hook generation.
- fab-kit changes (plan Change 4).
- Any API payload change (`ephemeral`, `protected`, `agentState`, `chat*` fields are unchanged).

### Design Decisions

#### Dual-write the pane keys instead of switching writers
**Decision**: `rk agent hook` writes both `@rk_pane_agent_state`/`@rk_agent_state` (and both chat names) in one chained tmux exec.
**Why**: fab-kit reads only the legacy name until its Change 4 ships; the migration copies old→new, never new→old, so a write-side switch would blind fab's pane map.
**Rejected**: switch writers now (breaks fab-kit until Change 4); keep old-only writes (defers the whole rename another release).
*Introduced by*: 260828-5jlp-tmux-option-dual-read-external-keys

#### Doctor row instead of a hook-generation bump
**Decision**: add an `agent hooks` doctor check classifying installed generations; leave hook text alone.
**Why**: gen-3 hook text names no option — the write lives in the binary — so a text bump would force every user through `rk agent setup` for no behavioural change. Only gen-1 inline one-liners still write the legacy name.
**Rejected**: bump text + doctor (pure churn); skip doctor (stragglers invisible).
*Introduced by*: 260828-5jlp-tmux-option-dual-read-external-keys

#### Append new pane-format fields rather than replace
**Decision**: `paneFormat` fields 9–10 carry the new names; legacy fields 6–7 stay.
**Why**: every existing parser index stays valid; the follow-up drops 6–7 — same shape as Change 2's `@rk_win_note` dual-read.
**Rejected**: swap in place (touches every index and every fixture twice).
*Introduced by*: 260828-5jlp-tmux-option-dual-read-external-keys

## Tasks

### Phase 1: Setup

- [x] T001 In `app/backend/internal/tmux/tmux.go` rename the four constants to `@rk_srv_ephemeral` / `@rk_srv_protected` / `@rk_pane_agent_state` / `@rk_pane_chat` and add exported `LegacyEphemeralOption`, `LegacyProtectedOption`, `LegacyAgentStateOption`, `LegacyChatOption`; update the doc comments to state the dual-read window <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Dual-read `IsEphemeralServer` / `IsProtectedServer` in `app/backend/internal/tmux/tmux.go` via a shared `readServerMarkDual(ctx, server, new, old)` helper (new first, legacy on unset); make `UnmarkServerProtected` unset both names; `Mark*` write new names. Add socket tests in `tmux_test.go` (legacy-only / new-only / neither / unmark-legacy) <!-- R2 --> <!-- R4 -->
- [x] T003 Extend `paneFormat` to 11 fields and `parsePanes` new-wins resolution in `app/backend/internal/tmux/tmux.go`; update the field-count comments; extend `PaneFactsCtx` / `parsePaneFacts` in `app/backend/internal/tmux/pane_target.go`; re-point every `_test.go` fixture line to 11 fields and add new-only / old-only / both-set / neither cases for agent-state and chat <!-- R3 -->
- [x] T004 In `app/backend/cmd/rk/agent_hook.go` make `writeAgentStateImpl` / `writeChatImpl` chain two `set-option` commands with a `;` argv element; in `app/backend/cmd/rk/agent_setup.go` bind `rkHookMarker` to `tmux.LegacyAgentStateOption`; update `agent_hook_test.go` argv assertions and add an `isRkEntry` gen-1 regression in `agent_setup_test.go` <!-- R5 -->
- [x] T005 In `app/backend/internal/tmux/legacy_options.go` add `CopyOnly bool` to `legacyOption`, honour it in `moveLegacyAt`, exclude right-scope CopyOnly holds from `CountLegacyOptions`, and append the four rows; add socket tests in `legacy_options_test.go` (pane copy-only keeps old, server row moves, wrong-scope pane name purged, idempotent second run, count excludes sanctioned holds) <!-- R6 -->
- [x] T006 Add `agentHooksCheck(home, readFile, stat)` + `classifyHookGeneration` to `app/backend/cmd/rk/doctor.go`, register it in `runDoctorChecks`; unit tests in `doctor_test.go` with fixture JSON for gen-1, gen-2, gen-3-ok, gen-3-dangling, absent file, no-rk-entries <!-- R7 --> <!-- rework: doctor.go rkHookCommands duplicates isRkEntry hooks[] walk — share one walk -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Replace remaining literals with constants: `app/backend/cmd/rk/doctor.go` ephemeral Note, `app/backend/api/servers.go` protected 409 message, any other non-test hit of the four legacy strings; run `just test-backend` <!-- R1 -->
- [x] T008 [P] Switch external writers: `scripts/test-e2e.sh` (`@rk_srv_ephemeral`), `app/frontend/tests/e2e/_tmux.ts` (`@rk_srv_ephemeral`), `app/frontend/tests/e2e/protected-kill-confirm.spec.ts` (`@rk_srv_protected`), `app/frontend/tests/e2e/sort-windows.spec.ts` (`@rk_pane_agent_state`), `app/frontend/tests/e2e/right-panel.spec.ts` (`@rk_pane_chat`); update the matching `.spec.md` companions; run the touched specs via `just test-e2e "<spec>"` <!-- R4 --> <!-- R8 -->

### Phase 4: Polish

- [x] T009 Update `docs/specs/agent-state.md` (title, § The Option, § Chat Session Identity, new "Naming / Deprecation window" subsection carrying the intake's ledger and removal gate) and `docs/site/skill/mux.md`, `docs/site/skill.md`, `docs/site/status-dot.md` option names; run `shll standards` check for the `rk mux new --ephemeral` help surface <!-- R8 --> <!-- rework: run scripts/sync-skill.sh so app/backend/cmd/rk/skill/ embeds match docs/site; also refresh retired names in docs/specs/{status-pyramid,window-views,surface-layout,index,cli-layering,themes}.md and frontend comment literals -->

## Execution Order

- T001 blocks everything else (constants)
- T002–T006 are independent of each other after T001
- T007/T008 after T002–T005 (they depend on the final constant set)

## Acceptance

### Functional Completeness

- [x] A-001 R1: The four constants carry the `@rk_<scope>_` names and four exported `Legacy*Option` constants exist; the non-test literal grep yields only those declarations
- [x] A-002 R2: `IsEphemeralServer` / `IsProtectedServer` return true for a server carrying only the legacy mark and for one carrying only the new mark
- [x] A-003 R3: `paneFormat` has 11 fields; `parsePanes` and `parsePaneFacts` prefer the new field and fall back to the legacy field
- [x] A-004 R4: `Mark*` write new names; `UnmarkServerProtected` clears both names; the three e2e writers and `scripts/test-e2e.sh` set new names
- [x] A-005 R5: `writeAgentStateImpl` / `writeChatImpl` produce one argv with both option names chained by `;`; `rkHookMarker` equals `@rk_agent_state`
- [x] A-006 R6: `legacyOption.CopyOnly` exists, `moveLegacyAt` honours it, `CountLegacyOptions` excludes right-scope CopyOnly holds, and the four rows are present
- [x] A-007 R7: `agent hooks` appears in `rk doctor` output and is registered in `runDoctorChecks`
- [x] A-008 R8: `docs/specs/agent-state.md` carries the deprecation-window subsection and canonical new names; site docs use new names — spec + site sources updated, embedded copies under `app/backend/cmd/rk/skill/` byte-match the canonical docs (verified by diff), embed-match tests green

### Behavioral Correctness

- [x] A-009 R3: With both pane fields set to different values the new field's value is the one parsed
- [x] A-010 R6: After a sweep, a pane still holds the legacy agent-state option (copy-only) while the server no longer holds `@rk_ephemeral`
- [x] A-011 R4: Unprotecting a server that carries only the legacy protected mark disarms the kill guard

### Scenario Coverage

- [x] A-012 R2: Socket tests cover legacy-only, new-only, neither for both predicates
- [x] A-013 R5: `agent_hook_test.go` asserts both names once each in the captured argv; `agent_setup_test.go` proves a gen-1 inline entry is still matched by `isRkEntry`
- [x] A-014 R6: `legacy_options_test.go` covers copy-only keep, server move, wrong-scope pane purge, idempotency, count exclusion
- [x] A-015 R7: `doctor_test.go` covers gen-1, gen-2, gen-3-ok, gen-3-dangling, absent file, no-rk-entries

### Edge Cases & Error Handling

- [x] A-016 R3: A `list-panes` line with fewer than 11 fields is skipped, not mis-parsed
- [x] A-017 R5: A failing second `set-option` in the chain does not fail the hook (never-fail contract preserved; errors swallowed)
- [x] A-018 R7: An unreadable-but-present settings file is reported as FAIL, not as "not installed"

### Code Quality

- [x] A-019 Pattern consistency: new tmux reads go through `tmuxExecRawServer` under `TmuxTimeout`; doctor check follows the `tmuxGuardShimCheck` seam style; no `exec.Command` without context
- [x] A-020 No unnecessary duplication: the two server predicates share one dual-read helper; the dual-write shares one chained-argv builder
- [x] A-021 Comments state constraints (the dual-read window, why `;` chaining, why CopyOnly), not narration; no change IDs / PR numbers in code comments
- [x] A-022 Tests accompany every behaviour change (`just test-backend` green; touched e2e specs green); `.spec.md` companions updated in the same commit — companions updated; `just test-backend` green (skill-embed tests included); all four touched e2e specs green (right-panel: 12 passed + 1 flaky retried pass — a pre-existing rig-timing flake in `_ready.ts` status-dot wait, unrelated to the option rename)

### Security

- [x] A-023 R5: The chained tmux argv contains no shell interpolation — pane, socket, option names, and values are discrete argv elements

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change deliberately keeps every legacy read/write in place for the deprecation window; the removable pieces are already enumerated in the intake's Deprecation ledger (§ Naming / Deprecation window in `docs/specs/agent-state.md`) and owned by the follow-up removal change

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shared `readServerMarkDual` helper name and shape for the two predicates | Intake asks for dual-read; helper name is a plan choice | S:70 R:95 A:85 D:80 |
| 2 | Confident | `parsePanes` minimum-field rule rises to 11 (lines from an older format are skipped) | Both fields are always emitted by the same binary's format; a short line is a parse anomaly | S:65 R:85 A:85 D:75 |
| 3 | Confident | Doctor gen-3 rk-path extraction = first double-quoted token after `; ` in the command string | Matches `agentStateHookCommand`'s exact template | S:70 R:90 A:85 D:80 |
| 4 | Certain | `CountLegacyOptions` excludes right-scope CopyOnly holds | Otherwise the doctor row is permanently dirty on instrumented servers | S:85 R:90 A:90 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
