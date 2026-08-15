# Plan: Mux Guard Move (CLI Layering Part 4)

**Change**: 260815-mi5s-mux-guard-move
**Intake**: `intake.md`

## Requirements

### CLI: `rk mux guard` family member + permanent root alias

#### R1: Visible family member `rk mux guard`
The guard SHALL be invocable as `rk mux guard [tmux args...]` — a visible member of the `mux` family. Both instances SHALL be built by a factory (`newTmuxGuardCmd(use string)` in `app/backend/cmd/rk/tmux_guard.go`, the `newReapCmd`/`newAgentHookCmd` precedent) sharing the untouched `runTmuxGuard` core, each carrying `Args: cobra.ArbitraryArgs`, `DisableFlagParsing: true`, `SilenceUsage`/`SilenceErrors`, and the RunE `*exitCodeError` print-verbatim + `os.Exit(code)` handling. The decision functions (`tmuxGuardBlocks`, `parseTmuxGlobalFlags`, `tmuxCommandWords`, `isKillServerWord`), `findRealTmux`, `sniffsAsTmuxShim`, `tmuxGuardExecEnv`, and the exec seam are unchanged. The `mux` parent's header comment and `Long` (currently "Five members") SHALL name guard as the sixth member.

- **GIVEN** the built binary
- **WHEN** `rk mux guard kill-server` runs inside a tmux pane
- **THEN** the invocation is blocked with the refusal message and exit 1, identical in decision to today's `rk tmux-guard kill-server`
- **AND** `rk mux guard list-panes` execs the real tmux verbatim (argv, stdio, exit code preserved)

#### R2: `tmux-guard` becomes a PERMANENT hidden root alias
The root form `rk tmux-guard` SHALL remain registered, `Hidden: true`, with **no cobra `Deprecated`** and no warning of any kind — byte-identical behavior to the family member (same decision, same messages, same exit codes). It SHALL be comment-marked permanent (mirroring `agentHookAliasCmd`, `agent_hook.go:132-142`): installed PATH shims carry the literal `tmux-guard` invocation frozen at install time, fronting every PATH-resolved tmux call, so this form must resolve silently forever (cli-layering delegation rule 3); no cleanup sweep may remove it. `root.go` SHALL register the alias beside the other hidden aliases with a comment distinguishing permanent (agent-hook, tmux-guard) from deprecation-grade (reaper/snapshot/init-conf/agent-setup).

- **GIVEN** an installed shim exec'ing `"<abs-rk>" tmux-guard "$@"`
- **WHEN** any `tmux …` resolves through it
- **THEN** the alias runs the identical guard with zero extra stderr output
- **AND** a test asserts the alias command's `Deprecated == ""` and `Hidden == true`, so a future sweep converting it to a warning alias fails

#### R3: `-L` flows into the tmux argv; no silent retarget
The guard member SHALL NOT consume the mux parent's persistent `-L/--server` flag and SHALL NOT call `muxRejectInheritedServerFlag` — `DisableFlagParsing` means every token after `guard` flows verbatim into the tmux argv, where `-L` is genuinely tmux's socket flag. Tests SHALL pin: (a) `rk mux guard -L x kill-server` reaches the decision function as `["-L","x","kill-server"]` → explicit socket → passes verbatim to the real tmux; (b) the flag-before-subcommand shape `rk mux -L x guard kill-server` is pinned to actual cobra behavior with the invariant that no invocation is silently retargeted — the explicit socket either rides into tmux or the invocation is blocked with the canonical remedy.

- **GIVEN** argv `rk mux guard -L scratch kill-server`
- **WHEN** the guard decides
- **THEN** it passes and the exec'd argv is `[tmux, -L, scratch, kill-server]`

### Shim: second-generation script writes the new form

#### R4: `tmuxShimTemplate` execs `mux guard`; parse/sniff contracts hold
The shim template's steady-state exec line SHALL become `exec "%[2]s" mux guard "$@"` (template prose comments naming `rk tmux-guard` updated alongside). Constraints: the line stays the FIRST `exec ` line with the rk path spelled literally (the `tmuxShimExecTarget` contract — its first-quoted-value parse is generation-agnostic and SHALL NOT change); the frozen `tmuxShimMarker` text and the PATH-block markers (`# >>> rk tmux guard >>>` / `# <<< rk tmux guard <<<`) SHALL NOT change; the Go and shell sniff terms (`tmuxShimMarker` OR `tmux-guard`) SHALL stay as they are — the marker on line 2 recognizes every generation within the 512-byte window, and the retained `tmux-guard` term still catches old-generation copies. Installed shims are never proactively rewritten; rollover happens only via `rk agent setup`'s existing idempotent replace-in-place under the existing consent flow.

- **GIVEN** a freshly rendered shim script
- **WHEN** `tmuxShimExecTarget` parses it
- **THEN** it returns the embedded rk path
- **AND** the rendered script execs `"<abs-rk>" mux guard "$@"` on the steady-state path (behavioral stub test: stdout `RK mux guard <args>`)

#### R5: Message prefixes name the canonical command
The guard's user-facing message prefixes SHALL update from `rk tmux-guard:` to `rk mux guard:` in: `tmuxGuardBlockedMessage`, `findRealTmux`'s no-real-tmux error, `runTmuxGuard`'s exec-error message, and the NEW shim template's fallback-stage messages (backstop refusal, unguarded notice, no-real-tmux). Remedy lines (`tmux -L <scratch-name> kill-server`, `RK_TMUX_GUARD=off tmux kill-server`) are unchanged. Old installed shims keep their frozen old-prefix text by design.

- **GIVEN** a blocked bare `kill-server` through either invocation form
- **WHEN** the refusal prints
- **THEN** it begins `rk mux guard: BLOCKED:` and still names both remedies

#### R6: `rk agent setup` writes the new form going forward
The consent-summary text in `agent_setup.go` naming `` `rk tmux-guard` `` (~line 351) SHALL name `` `rk mux guard` ``. Re-running `rk agent setup` on a machine with an old-generation shim registers the new script as a content change under the existing consent flow (no migration, no new file). The `agent_setup_test.go` pin (`exec "/opt/homebrew/bin/rk" tmux-guard "$@"`, ~line 1160) SHALL assert the new form.

- **GIVEN** a home with an old-generation marker-owned shim
- **WHEN** `rk agent setup --yes` re-runs
- **THEN** the shim is replaced in place with the `mux guard` form, mode 0755, marker intact

### Doctor: generation-agnostic verification

#### R7: Doctor reports both shim generations identically
`tmuxGuardShimCheck` SHALL keep its check `Name`/`failLabel` `"tmux-guard shim"` (they name the artifact, not the command spelling). Doctor tests SHALL add coverage proving a NEW-form shim (exec `mux guard`) reports the same states as an old-form shim: healthy install, dangling embedded path, unparseable exec target. No hint text changes are required beyond any that literally name the old command form (the `rk agent setup` and PATH-block hints are already correct).

- **GIVEN** a healthy install whose shim execs `"<abs-rk>" mux guard "$@"`
- **WHEN** `tmuxGuardShimCheck` runs with PATH resolving tmux to the shim
- **THEN** the check is OK with the "installed" note, identically to an old-form shim

### Surface conformance

#### R8: help-dump and root wiring reflect the move
`help_dump_test.go` SHALL assert the mux family captures exactly 6 members (send, await, reap, snapshot, init-conf, guard) and that `tmux-guard` joins the excluded-hidden-root-forms list. `root_test.go` SHALL add `tmux-guard` to the hidden-root-alias assertions and `{"mux","guard"}` to the family-member paths.

- **GIVEN** `buildDump(rootCmd, …)`
- **WHEN** the real tree is captured
- **THEN** `mux` has exactly 6 children including `guard`, and no root-level `tmux-guard` node appears

#### R9: Skill topic page carries a guard gotcha, byte-identical site copy
`app/backend/cmd/rk/skill/mux.md` SHALL gain one Gotcha bullet: bare `tmux kill-server` (no `-L`/`-S`) is refused machine-wide by the rk tmux guard shim — use `tmux -L <name> kill-server` for scratch servers (`rk mux guard` is the verb the shim execs). `docs/site/skill/mux.md` SHALL stay byte-identical (pinned by `skill_test.go`). No other page or README change.

- **GIVEN** the updated embedded page
- **WHEN** `go test ./cmd/rk` runs
- **THEN** the byte-equality pin passes

#### R10: Standards audit + full test suite pass
The change SHALL pass `cd app/backend && go test ./...`, and the changed surface SHALL be re-checked against the shll toolkit standards (`shll standards` — help-dump, ten principles, skill) per the constitution's Toolkit Standards clause.

- **GIVEN** the completed change
- **WHEN** the backend suite and standards check run
- **THEN** both pass with no regressions

### Non-Goals

- No change to the guard decision logic, block rule, escape hatch, probe/fail-open stages, PATH-block file matrix, or installer consent machinery.
- No proactive migration of installed shims; no fab-kit changes (Part 5+).

### Design Decisions

#### Factory-built two instances for the guard
**Decision**: `newTmuxGuardCmd(use)` builds the family member and the permanent root alias off the shared `runTmuxGuard` core.
**Why**: a cobra command object cannot have two parents; two hand-declared literals would drift (the exit-code handling and DisableFlagParsing must be provably identical on both forms).
**Rejected**: cobra `Aliases` (cannot span root↔family); a re-dispatching alias (breaks raw-argv passthrough).
*Introduced by*: 260815-mi5s-mux-guard-move

#### Permanent alias is silent; no deprecation machinery
**Decision**: `tmux-guard` root alias is `Hidden` with no `Deprecated` and no stderr output, comment-marked permanent.
**Why**: installed shims front EVERY PATH-resolved tmux invocation; a deprecation line would leak onto stderr of every guarded tmux call on old installs, and removal would re-open the kill-server death vector (cli-layering rule 3).
**Rejected**: deprecation alias (Part 3 treatment — wrong class; these artifacts are never re-typed by humans).
*Introduced by*: 260815-mi5s-mux-guard-move

#### Guard skips `muxRejectInheritedServerFlag`
**Decision**: unlike reap/snapshot/init-conf, the guard member does not reject an inherited `-L`; flags flow into the tmux argv.
**Why**: `DisableFlagParsing` means nothing is parsed and nothing is silently ignored — `-L` in a guard invocation IS tmux's socket flag, and consuming it would change the guarded command's meaning.
**Rejected**: rejecting `-L` (would break `rk mux guard -L x kill-server`, the canonical explicit-socket form).
*Introduced by*: 260815-mi5s-mux-guard-move

## Tasks

### Phase 1: Core command move

- [x] T001 Refactor `app/backend/cmd/rk/tmux_guard.go`: replace the `tmuxGuardCmd` var with factory `newTmuxGuardCmd(use string)` (preserving Args/DisableFlagParsing/Silence*/RunE exit handling verbatim); add `muxGuardFamilyCmd = newTmuxGuardCmd("guard [tmux args...]")` and `tmuxGuardAliasCmd` (`"tmux-guard [tmux args...]"`, `Hidden: true`, no `Deprecated`, PERMANENT comment mirroring `agent_hook.go:132-142`); update the file-header comment naming the canonical form <!-- R1, R2 -->
- [x] T002 `app/backend/cmd/rk/mux.go`: `muxCmd.AddCommand(muxGuardFamilyCmd)` in `init()`; update the family header comment and parent `Long` from five to six members, naming guard; note guard's `-L` posture (DisableFlagParsing — flags flow to tmux) beside the `muxRejectInheritedServerFlag` comment <!-- R1, R3 -->
- [x] T003 `app/backend/cmd/rk/root.go`: replace `rootCmd.AddCommand(tmuxGuardCmd)` with `rootCmd.AddCommand(tmuxGuardAliasCmd)` next to the other hidden aliases; update the registration comment to distinguish permanent (agent-hook, tmux-guard) from deprecation-grade aliases <!-- R2 -->

### Phase 2: Shim template + messages

- [x] T004 `tmux_guard.go` `tmuxShimTemplate`: change the steady-state exec line to `exec "%[2]s" mux guard "$@"`; update template prose comments and the `tmuxShimScript`/`tmuxShimExecTarget` doc comments that name `rk tmux-guard`; leave `tmuxShimMarker`, PATH-block markers, probe constants, and sniff terms byte-identical <!-- R4 -->
- [x] T005 Update Go message prefixes to `rk mux guard:` — `tmuxGuardBlockedMessage`, `findRealTmux`'s error, `runTmuxGuard`'s exec-error — and the NEW shim template's fallback-stage message prefixes (backstop refusal, unguarded notice, no-real-tmux); remedy lines unchanged <!-- R5 -->
- [x] T006 `app/backend/cmd/rk/agent_setup.go`: consent-summary text `` blocked via `rk tmux-guard` `` → `` `rk mux guard` `` (~line 351); sweep the file for any other old-form command mention (comments included) <!-- R6 -->

### Phase 3: Tests

- [x] T007 `app/backend/cmd/rk/tmux_guard_test.go`: update `TestTmuxGuardCommandRegistered` for both instances (family member at `{"mux","guard"}` visible with DisableFlagParsing; root alias `tmux-guard` Hidden, `Deprecated == ""`, DisableFlagParsing); update the shim-script shape pin (`exec "<rk>" mux guard "$@"`), message pins (`rk mux guard:` prefixes), and the rendered-script behavioral assertions (stub stdout `RK mux guard …`) <!-- R1, R2, R4, R5 -->
- [x] T008 [P] Add `-L` semantics tests in `tmux_guard_test.go` (or `mux_test.go` per existing placement): `rk mux guard -L x kill-server` passes with argv intact through the exec seam; pin the `rk mux -L x guard kill-server` flag-before-subcommand shape to actual behavior with the no-silent-retarget invariant asserted <!-- R3 -->
- [x] T009 [P] `app/backend/cmd/rk/agent_setup_test.go`: update the shim exec-line pin (~1160) to the `mux guard` form; verify the old→new replace-in-place path is covered (re-run over an old-generation marker-owned shim replaces content) <!-- R6 -->
- [x] T010 [P] `app/backend/cmd/rk/doctor_test.go`: add NEW-form shim content coverage — healthy state, dangling embedded target, and unparseable-exec-target states report identically to old-form fixtures; keep the `"tmux-guard shim"` name/failLabel pins <!-- R7 -->
- [x] T011 [P] `app/backend/cmd/rk/root_test.go` + `help_dump_test.go`: add `tmux-guard` to the hidden-root-alias loop and `{"mux","guard"}` to family paths; mux captured-member count 5 → 6; `tmux-guard` added to the excluded-hidden-root-forms dump assertion <!-- R8 -->

### Phase 4: Surface polish + verification

- [x] T012 Add the guard Gotcha bullet to `app/backend/cmd/rk/skill/mux.md` and copy byte-identically to `docs/site/skill/mux.md` <!-- R9 -->
- [x] T013 Run `cd app/backend && go test ./...`; run `shll standards` and re-check the changed surface (help-dump contract, ten principles, skill standard); fix any conformance drift <!-- R10 -->

## Execution Order

- T001 blocks T002, T003, T007
- T004 blocks T005 (same template region), both block T007/T009
- T008–T011 are parallel after Phase 2
- T013 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux guard` is a visible mux family member; both instances share `runTmuxGuard` via the factory; decision/resolution/exec code untouched
- [x] A-002 R2: `rk tmux-guard` resolves at root, Hidden, `Deprecated == ""`, zero warning output, byte-identical behavior
- [x] A-003 R4: rendered shim execs `"<abs-rk>" mux guard "$@"` as the first exec line; `tmuxShimExecTarget` parses it; marker/sniff/PATH-block text unchanged
- [x] A-004 R6: `rk agent setup` writes the new-form shim and its consent summary names `rk mux guard`

### Behavioral Correctness

- [x] A-005 R3: `rk mux guard -L x kill-server` passes through with argv intact (test-pinned); flag-before-subcommand shape pinned with no silent retarget
- [x] A-006 R5: blocked-message and fallback prefixes read `rk mux guard:`; remedy lines unchanged; old installed shim text untouched by design
- [x] A-007 R7: doctor reports old- and new-form shims identically across healthy/dangling/unparseable states; check name/failLabel unchanged

### Scenario Coverage

- [x] A-008 R1: blocked and pass scenarios exercised through the family member path (wiring test + runTmuxGuard tests still green)
- [x] A-009 R2: alias scenario — a shim-shaped invocation (`tmux-guard <args>`) runs the guard with no stderr beyond the guard's own messages
- [x] A-010 R8: help-dump captures mux with exactly 6 members; `tmux-guard` excluded from the dump; root_test alias loop covers it

### Edge Cases & Error Handling

- [x] A-011 R4: old-generation shim content still sniffs as a shim (marker term) in both Go and shell walks; new-generation content sniffs via marker within 512 bytes

### Code Quality

- [x] A-012 Pattern consistency: factory/alias shapes mirror `newReapCmd`/`newAgentHookCmd`; comments follow the constraint-not-narration rule
- [x] A-013 No unnecessary duplication: no second copy of guard logic, messages composed from shared constants where they already are
- [x] A-014 Tests conform to spec (Constitution Test Integrity): no live tmux server touched by any test; shim behavior tested via rendered-script execution against stubs

### Security

- [x] A-015 R4: nothing environment-derived is newly interpolated into the shim script; the validated rk path remains the only run-time interpolation (Constitution §I posture preserved)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is a naming/registration move: the old `tmuxGuardCmd` var was already replaced in-place by the `newTmuxGuardCmd` factory during apply, and the old root form must stay registered forever as the permanent hidden alias (cli-layering delegation rule 3). No further existing code was made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `-L` semantics tests live beside the existing guard wiring tests in `tmux_guard_test.go` (not a new file) | Colocated with the code under test per repo convention; trivial to move | S:60 R:95 A:85 D:80 |
| 2 | Confident | The flag-before-subcommand pin asserts cobra's actual behavior (args including `-L x` reach RunE under DisableFlagParsing) rather than mandating a specific outcome first | Cobra internals are the authority; the invariant that matters (no silent retarget) is asserted regardless of which shape cobra produces | S:55 R:85 A:70 D:65 |
| 3 | Certain | Behavioral shim tests keep the stub-executable pattern (no live tmux) | Constitution Test Integrity + the memory doc's tests-never-touch-a-live-server decision | S:90 R:90 A:95 D:95 |
| 4 | Confident | (apply) Old-generation shim fixtures are rendered by string-replacing the new template's exec line back to the `tmux-guard` form, not a frozen literal script | One source of truth for the script shape; the replace is asserted non-empty so a template drift fails loudly instead of silently testing the new form twice | S:60 R:90 A:85 D:75 |
| 5 | Confident | (apply) Doctor both-generation coverage is a new parity test (`TestTmuxGuardShimCheckBothGenerations`) alongside the existing fixtures rather than parameterizing them | The existing tests now exercise the new form for free (they render via `tmuxShimScript`); a dedicated parity test pins old↔new equivalence across the three states without disturbing the per-state narrative fixtures | S:55 R:90 A:80 D:70 |
| 6 | Confident | (apply) `mux.go`'s Short gains "tmux guard" in its member list to match the new sixth member | Short names the family's scope; leaving it at five named classes would misdescribe the surface in `rk -h` | S:55 R:90 A:80 D:70 |

6 assumptions (2 certain, 4 confident, 0 tentative).
