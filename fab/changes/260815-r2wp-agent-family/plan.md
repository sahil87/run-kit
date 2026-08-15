# Plan: The rk agent family — `agent setup` / `agent hook`

**Change**: 260815-r2wp-agent-family
**Intake**: `intake.md`

## Requirements

### CLI Surface: The `rk agent` family

#### R1: `rk agent` family parent
A new cobra parent command `agent` SHALL be registered at root (`app/backend/cmd/rk/agent.go`, following the `mux.go` precedent from cli-layering Part 1) grouping the instrumentation verbs. It SHALL carry **no shared persistent flag** (the members' flag sets are disjoint) and SHALL be a pure grouping node: bare `rk agent` prints the family help.

- **GIVEN** the built binary
- **WHEN** `rk agent` runs with no subcommand
- **THEN** cobra's family help prints, listing `setup` and `hook`
- **AND** `rk -h` lists `agent` and no longer lists `agent-setup`/`agent-hook`

#### R2: `rk agent setup` + hidden deprecation alias `agent-setup`
The installer SHALL be invocable as `rk agent setup` with behavior identical to today's `rk agent-setup` (flags `--uninstall`/`--yes`/`-y`/`--dry-run`, consent flow, JSON merge, tmux-shim leg, legacy rk-display cleanup, exit codes). The old root form `agent-setup` SHALL remain registered as a **hidden deprecation alias**: it runs the same core with the same flags and exit codes, prints a one-line deprecation pointer to **stderr** (e.g. via cobra's `Deprecated` field: ``use `rk agent setup` instead``), and is excluded from `rk -h` and the help-dump. Because one cobra command object cannot be parented twice, both instances SHALL be built by a factory sharing one RunE core, with flag variables bound per-instance. The family member SHALL wrap its own `Args` with `usageArgs(cobra.NoArgs)` (root's init loop only covers direct children — the mux members' pattern).

- **GIVEN** a machine with existing rk-owned hook entries
- **WHEN** `rk agent setup --dry-run` runs
- **THEN** it behaves byte-identically to today's `rk agent-setup --dry-run`
- **GIVEN** the old form
- **WHEN** `rk agent-setup --dry-run` runs
- **THEN** a deprecation line naming `rk agent setup` prints to stderr AND the command still completes with today's behavior and exit code

#### R3: `rk agent hook` + PERMANENT hidden root alias `agent-hook`
The hook writer SHALL be invocable as `rk agent hook <state>` and the old root form `agent-hook <state>` SHALL remain registered **permanently** (never removed, never deprecated, never warning): installed `settings.json` hook lines carry the literal `agent-hook` and must keep working unmodified forever (cli-layering delegation rule 3). **Both instances** SHALL carry the complete never-fail machinery: `Args: cobra.ArbitraryArgs`, `FParseErrWhitelist{UnknownFlags: true}`, `SilenceErrors`/`SilenceUsage`, per-command `SetFlagErrorFunc(→ nil)`, and a RunE that always returns nil. The alias SHALL be `Hidden: true` with a code comment marking it permanent (so no future cleanup sweep removes it). The root.go comment explaining the FlagErrorFunc shadowing SHALL name both instances.

- **GIVEN** an existing install whose settings.json carries `"<abs-rk>" agent-hook --agent claude idle`
- **WHEN** that hook line fires
- **THEN** behavior is byte-identical to today: `@rk_agent_state` written, exit 0, nothing printed
- **GIVEN** any malformed invocation of either form (`rk agent hook`, `rk agent-hook`, wrong arg count, unknown flag, `--agent` with missing value)
- **WHEN** it executes
- **THEN** it exits 0 silently (never-fail contract holds on both forms)

#### R4: Installer writes the new form; recognition spans all three generations
`agentStateHookCommand` SHALL emit the new invocation in freshly installed hook lines:
```
/bin/sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent hook --agent <comm> <state> 2>/dev/null || true'
```
`isRkEntry` SHALL recognize rk-owned entries by any of THREE markers: the legacy option-name marker (`rkHookMarker` = `@rk_agent_state`), the second-generation `" agent-hook "` marker, and a new third-generation `" agent hook "` marker (spaces included on both). Re-running `rk agent setup` SHALL replace any older-generation entry in place (idempotent, no duplicates); `--uninstall` SHALL remove all three generations; a re-run over a settings file already carrying only new-form entries SHALL be a no-op. Existing installs are NOT proactively migrated.

- **GIVEN** a settings.json carrying second-generation (` agent-hook `) rk entries
- **WHEN** `rk agent setup --yes` runs
- **THEN** each rk-owned entry is replaced in place with the ` agent hook ` form and non-rk hooks are untouched
- **GIVEN** the freshly written settings
- **WHEN** `rk agent setup --yes` runs again
- **THEN** the merge is a reported no-op (no prompt, no write)

#### R5: Help surface and help-dump
The help-dump SHALL include the `agent` family with exactly two members (`setup`, `hook`) and SHALL exclude both root aliases (hidden). `rk -h` root command count drops by one net (two removed, one family added). Tests: `help_dump_test.go` gains agent-family assertions mirroring the mux ones; `root_test.go`'s inventory expects `agent` present and the two aliases still registered-but-hidden; the NoArgs usage-error table keeps alias coverage and adds the new form.

- **GIVEN** `rk help-dump` output
- **WHEN** parsed
- **THEN** node `agent` exists with children exactly {`setup`, `hook`}, and no root node `agent-setup` or `agent-hook` exists

#### R6: Docs, hints, and comments renamed; on-disk markers untouched
User-facing text SHALL name the new form: README.md (§ heading "Agent state — `run-kit agent setup`" + its anchor, quick-start line, command table, troubleshooting), docs/site/install.md (incl. the README cross-link anchor), doctor.go's three hint strings. Code comments describing what gets typed or written SHALL use the new form; comments describing installed/historical artifacts stay. The on-disk recognition literals `skillManagedByMarker` (`managed-by: rk agent-setup`) and `tmuxShimMarker` (`managed-by: rk agent-setup (tmux guard shim)`) SHALL NOT change — they identify artifacts already on user machines.

- **GIVEN** the repo after the change
- **WHEN** grepping for `rk agent-setup` in user-facing docs/hints
- **THEN** only deliberate references remain (deprecation notice, upgrade notes describing old installs, marker literals)

#### R7: Toolkit conformance (implicit obligations)
The change SHALL pass the shll standards audit: run `shll standards`, check the change against `help-dump`, `principles`, `readme-extraction`, and `skill`. The `rk skill` core bundle and topic pages SHALL be audited for family references (grep found none — expected no-op; no new `agent` topic page). `go test ./...` green; help-dump regenerated if the build pipeline consumes it.

- **GIVEN** the finished change
- **WHEN** the standards audit runs
- **THEN** no standard governing the touched surfaces is violated, and the audit result is recorded for the PR

### Non-Goals

- `role` stays at root — operator-workflow verb, not instrumentation (spec).
- No move of `tmux-guard`/shim regeneration (Part 4), no mux consolidation (Part 3).
- No proactive migration of installed hook lines; no change to `@rk_agent_state`/`@rk_chat` schemas, readers, or the reconciler.
- No new `agent` skill topic page.

### Design Decisions

#### Factory-built command instances for both verbs
**Decision**: build `setup` and `hook` commands via factory functions returning fresh `*cobra.Command` instances (family member + root alias), flag vars bound per-instance; the shared logic stays in the existing `runAgentSetup`/`runAgentHook` cores.
**Why**: a cobra command object cannot have two parents; two hand-declared near-identical literals would drift (especially agent-hook's four-part never-fail machinery, which must be provably identical on both forms).
**Rejected**: cobra `Aliases` (only aliases a name at the same tree level, cannot span root↔family); a root alias that shells out/re-dispatches to the family member (needless indirection, breaks flag passthrough).
*Introduced by*: 260815-r2wp-agent-family

#### Deprecation alias hidden; permanent alias silent
**Decision**: `agent-setup` alias = `Hidden: true` + cobra `Deprecated` (stderr pointer, still runs); `agent-hook` alias = `Hidden: true`, NO `Deprecated`, comment-marked permanent.
**Why**: the spec's root-count target and § Hidden plumbing hide aliases; cobra's `Deprecated` gives the standard warn-and-run behavior for the human-typed form; the machine-invoked form must stay byte-silent (never-fail contract — a deprecation line on stderr would leak into hook contexts that don't redirect stderr).
**Rejected**: visible deprecated twin (defeats the grouping); warning on agent-hook (contract violation).
*Introduced by*: 260815-r2wp-agent-family

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/agent.go`: `agentCmd` family parent (Use "agent", Short/Long per intake § 1, no persistent flags), register in `root.go` `init()` (`rootCmd.AddCommand(agentCmd)`) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Refactor `app/backend/cmd/rk/agent_setup.go`: factory `newAgentSetupCmd(use string, deprecated bool)` (or equivalent) building the command with per-instance flag vars sharing `runAgentSetup`; register `setup` under `agentCmd` with `usageArgs(cobra.NoArgs)`; register hidden+Deprecated `agent-setup` at root; update root.go registration <!-- R2 -->
- [x] T003 Refactor `app/backend/cmd/rk/agent_hook.go`: factory `newAgentHookCmd(use string)` carrying the FULL never-fail machinery (ArbitraryArgs, FParseErrWhitelist, SilenceErrors/Usage, SetFlagErrorFunc→nil, RunE→nil) with per-instance `--agent` var; register `hook <state>` under `agentCmd` and permanent hidden `agent-hook <state>` at root with the permanence comment; update root.go's FlagErrorFunc comment to name both instances <!-- R3 -->
- [x] T004 In `agent_setup.go`: change `agentStateHookCommand` to emit `agent hook`; add third marker const (`" agent hook "`) and extend `isRkEntry` to match all three generations; update the marker doc comments <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Update `agent_hook_test.go`: alias-parity coverage — both `agent hook` and `agent-hook` invocations exercise the same never-fail matrix (extend `TestAgentHookCmdNeverErrorsOnMalformedInvocation` or add a sibling) and both write paths behave identically <!-- R3 -->
- [x] T006 Update `agent_setup_test.go`: wrapper-literal expectations (` agent hook `), three-generation `isRkEntry`/merge tests (gen-2 replaced in place, gen-1 replaced, all removed on uninstall, new-form re-run no-op), deprecation-alias test (stderr pointer + still runs) <!-- R4 -->
- [x] T007 Update `root_test.go` (inventory: `agent` present; `agent-setup`/`agent-hook` registered-but-hidden; usage-error table rows for `agent setup x` and `agent-setup x`) and `help_dump_test.go` (agent family exactly {setup, hook}; both aliases absent from the dump) <!-- R5 -->
- [x] T008 Update `doctor.go` hint strings (`rk agent-setup` → `rk agent setup`) and any `doctor_test.go` assertions on them <!-- R6 -->

### Phase 4: Polish

- [x] T009 Docs + comment sweep: README.md (heading/anchor/table/quick-start/troubleshooting), docs/site/install.md (3 sites + cross-link anchor), invocation-form comments in agent_setup.go/agent_hook.go/root.go/tmux_guard.go:25/role.go:29/internal/tmux/tmux.go; verify both `managed-by:` marker literals unchanged <!-- R6 -->
- [x] T010 Conformance pass: `cd app/backend && go test ./...`; `shll standards` audit against help-dump/principles/readme-extraction/skill; grep-audit `docs/site/skill.md` + `docs/site/skill/*.md` for family references (expected no-op); record audit outcome in plan `## Notes` <!-- R7 -->

## Execution Order

- T001 blocks T002/T003 (family must exist to attach members)
- T004 depends on T003's rename existing conceptually but touches only agent_setup.go; run after T002
- T005–T008 after their subjects; T009–T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk agent` family registered; bare `rk agent` prints family help listing setup and hook
- [x] A-002 R2: `rk agent setup` runs the full installer identically to the old form (flags, consent, exit codes)
- [x] A-003 R3: `rk agent hook <state>` writes `@rk_agent_state`/`@rk_chat` identically to the old form
- [x] A-004 R4: fresh installs write the ` agent hook ` wrapper form; `isRkEntry` matches all three generations

### Behavioral Correctness

- [x] A-005 R2: `rk agent-setup` still works, prints a stderr deprecation pointer naming `rk agent setup`, exits with today's codes
- [x] A-006 R3: `rk agent-hook <state>` is byte-identical to today — exit 0 always, silent on every malformed path, no deprecation output ever
- [x] A-007 R4: re-run over gen-2 entries replaces in place (no duplicates, non-rk hooks preserved); `--uninstall` removes all generations; new-form re-run is a no-op

### Scenario Coverage

- [x] A-008 R3: never-fail matrix (arg-count, unknown flag, known-flag-missing-value, unknown state token) proven by tests for BOTH invocation forms
- [x] A-009 R5: help-dump test asserts agent family = exactly {setup, hook} and neither alias appears; root inventory test updated
- [x] A-010 R2: `rk agent setup x` and `rk agent-setup x` both classify as usage errors (exit 2)

### Edge Cases & Error Handling

- [x] A-011 R4: a settings file mixing gen-1, gen-2, and non-rk entries: merge replaces exactly the rk-owned ones, preserves the rest
- [x] A-012 R6: on-disk marker literals (`managed-by: rk agent-setup`, tmux shim marker) byte-unchanged; installed-artifact recognition unaffected

### Code Quality

- [x] A-013 Pattern consistency: family parent mirrors mux.go structure; members wrap own usageArgs; comments state constraints not narration
- [x] A-014 No unnecessary duplication: one RunE core per verb via factories; no re-declared convention strings (A-021 aliasing intact)
- [x] A-015 Tests: all new/changed behavior covered (`go test ./...` green); no `exec` shell-string construction introduced

### Documentation

- [x] A-016 R6: README + install.md name the new form; anchors/links consistent; doctor hints updated
- [x] A-017 R7: standards audit run and recorded; skill topic pages audited (no stale family references)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Apply-stage audit record (T010)

- `cd app/backend && go test ./...` — **green** (full suite, incl. the new alias-parity, three-generation merge/uninstall, root-inventory, help-dump, and doctor-hint tests).
- Binary smoke (built `rk`): bare `rk agent` prints family help listing exactly `setup`+`hook`; `rk -h` lists `agent` and neither alias; `rk agent-setup` prints the deprecation pointer on stderr and still runs (exit 0); `rk agent-hook --agent` / `rk agent hook --bogus x` exit 0 with zero output (never-fail holds on both forms); `rk agent setup x` and `rk agent-setup x` both exit 2 (usage).
- **shll standards audit** (`shll standards` run 2026-08-15): `help-dump` — conformant (both aliases are `Hidden` ⇒ excluded from the dump per the filter rules; the `agent` family dumps with exactly {setup, hook}; envelope unchanged). `principles` — №2: the deprecation pointer is diagnostics on stderr (cobra `Deprecated` prints via OutOrStderr — stderr in production); the machine-invoked alias prints nothing ever. №4: usage-class exit 2 preserved for both forms. №1/№5: consent/dry-run flow untouched. `readme-extraction` — conformant (heading renamed in place, command-table row and install.md updated; rule 7 command accuracy now names the real `run-kit agent setup`). `skill` — audit of `docs/site/skill.md` + `docs/site/skill/*.md`: **no family references found (no-op)**, as predicted; no new `agent` topic page added.
- On-disk marker literals verified byte-unchanged: `skillManagedByMarker = "managed-by: rk agent-setup"` (agent_setup.go) and `tmuxShimMarker = "managed-by: rk agent-setup (tmux guard shim)"` (tmux_guard.go).
- README anchor: the renamed heading `## Agent state — ` + "`run-kit agent setup`" slugifies to the SAME GitHub anchor `#agent-state--run-kit-agent-setup` as before (em dash stripped, spaces → hyphens), so the in-repo table link and the install.md cross-link needed no edit (see Assumption 4 below).

## Deletion Candidates

- None outstanding — apply already removed the symbols this change made redundant: the single-instance `agentSetupCmd`/`agentHookCmd` vars and the package-level flag bindings (`agentSetupUninstall`/`agentSetupYes`/`agentSetupDryRun`, `agentHookAgent`) are gone, replaced by per-instance bindings inside the two factories; a repo-wide grep finds no dangling references.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Family members wrap their own `Args` with `usageArgs` (root's init loop covers only direct children) | Verified: mux_send.go:77 / mux_await.go:66 do exactly this | S:85 R:90 A:95 D:90 |
| 2 | Confident | Use cobra's `Deprecated` field (+ `Hidden`) for the agent-setup alias — cobra prints the pointer via `Print` (stderr by default) and still runs the command | Standard cobra mechanism; if its output channel proves wrong in tests, a manual stderr Fprintln in RunE is the fallback — same observable contract | S:70 R:85 A:80 D:75 |
| 3 | Confident | Third marker named alongside the existing pair (e.g. `rkHookMarkerAgentHookFamily = " agent hook "`), matched in `isRkEntry` as a simple third disjunct | Mirrors the existing two-generation mechanism verbatim | S:80 R:85 A:90 D:85 |
| 4 | Certain | The renamed README heading keeps the SAME GitHub anchor (`#agent-state--run-kit-agent-setup`) — the slugger strips the em dash and maps the `agent setup` space to a hyphen, so no link re-pointing was needed | Verified against github-slugger rules; both in-repo links (README table, install.md) left pointing at the unchanged anchor | S:85 R:90 A:95 D:85 |
| 5 | Certain | Cobra's `Deprecated` print fires BEFORE arg validation and goes to OutOrStderr (stderr in production — rootCmd never calls SetOut), so `rk agent-setup x` warns AND exits 2 | Verified in cobra v1.10.2 source (`command.go:911`, `Print` → `OutOrStderr`) and by binary smoke test | S:90 R:90 A:95 D:90 |

5 assumptions (3 certain, 2 confident, 0 tentative).
