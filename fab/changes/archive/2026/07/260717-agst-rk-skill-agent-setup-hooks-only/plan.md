# Plan: rk skill bundle + agent-setup hooks-only

**Change**: 260717-agst-rk-skill-agent-setup-hooks-only
**Intake**: `intake.md`

## Requirements

### Skill Bundle: `docs/site/skill.md` (canonical source)

#### R1: Canonical skill bundle exists and conforms to the shll standard
run-kit SHALL ship a canonical `docs/site/skill.md` — a static, agent-facing usage briefing that conforms to the merged shll `skill` standard: static-only (no timestamps, no environment lookups, no session state), ≤150 lines, in usage-briefing genre (When to use / Capabilities map / Composition patterns / Output & exit-code contracts / Gotchas), NOT a README clone or flag table. It renders at `/run-kit/skill` on shll.ai for free as part of the pulled `docs/site/**` tree (no nav registration).

- **GIVEN** the merged shll standard (readable via `shll standards skill`)
- **WHEN** `docs/site/skill.md` is authored
- **THEN** it covers the five briefing sections keyed to rk subcommands (notify, context, iframe windows, proxy, Visual Display Recipe) seeded from fab-kit `_cli-external.md` § "## rk (run-kit)" plus the STATIC half of `cmd/rk/context.go` (`writeCapabilities`/`writeConventions`)
- **AND** it excludes the dynamic Environment section (session/window/pane/server URL — those stay exclusive to `rk context`)
- **AND** it is ≤150 lines with a `# Title` + one-paragraph lede (no frontmatter), matching sibling `docs/site/*.md` style

#### R2: Content is static-only and version-lockable
The bundle SHALL contain no dynamic content — no current session, pane, or server-URL value hardcoded. Composition guidance for discovering the server URL at use-time SHALL point the reader at `rk context` (never a literal URL).

- **GIVEN** the static-only rule of the standard
- **WHEN** the bundle documents server-URL discovery
- **THEN** it prescribes `rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'` at use-time and states the URL changes between sessions

### CLI: `rk skill` subcommand (embed + sync + drift-guard)

#### R3: `rk skill` prints the bundle byte-identical to stdout
run-kit SHALL add a cobra `skill` subcommand that prints the embedded bundle to stdout byte-identical to `docs/site/skill.md`, with empty stderr and exit 0. No added framing, no pager, no rendering.

- **GIVEN** an installed run-kit binary
- **WHEN** the user runs `rk skill`
- **THEN** stdout equals the embedded `skill/skill.md` bytes exactly, stderr is empty, and the exit code is 0

#### R4: Committed embed copy compiles a clean `go build`
The bundle SHALL be embedded via a committed copy at `app/backend/cmd/rk/skill/skill.md` and `//go:embed skill/skill.md`, so a clean `go build ./...` (which runs no script) compiles. This mirrors shll's `standards` mechanism (the standard names it as the one to reuse). This repo has no reusable committed-doc embed precedent (`build/tmux.conf` is a gitignored build-time copy — it fails the commit+drift-guard requirement).

- **GIVEN** a fresh checkout with no sync script run
- **WHEN** `go build ./...` runs
- **THEN** it compiles because the embedded copy is committed in the package directory

#### R5: Sync script refreshes the embed copy from canonical
A `scripts/sync-skill.sh` SHALL copy `docs/site/skill.md` → `app/backend/cmd/rk/skill/skill.md` (`set -euo pipefail`, run from repo root regardless of CWD, echo a confirmation). A `//go:generate` directive in `skill.go` SHALL invoke it. No new justfile recipe is required (Constitution VIII: logic in scripts/).

- **GIVEN** an edited canonical `docs/site/skill.md`
- **WHEN** `scripts/sync-skill.sh` runs
- **THEN** the committed embed copy is overwritten to match and a confirmation is printed

#### R6: Drift-guard + budget + command tests
A `skill_test.go` at `app/backend/cmd/rk/` SHALL enforce: (a) the embedded bytes equal `../../../../docs/site/skill.md` byte-for-byte (drift guard, hinting `scripts/sync-skill.sh` on failure); (b) the command's stdout equals the embedded bytes with empty stderr; (c) the bundle is ≤150 lines.

- **GIVEN** the canonical and embedded copies
- **WHEN** they drift (canonical edited without re-sync)
- **THEN** `TestSkillEmbedMatchesCanonical` fails, naming the fix
- **AND** a >150-line bundle fails the budget guard
- **AND** the command test asserts byte-identical stdout + empty stderr

#### R7: `skill` is registered and expected
`rk skill` SHALL be registered in `root.go` via `rootCmd.AddCommand(skillCmd)` and appear automatically in `rk help-dump` (cobra-tree walk, no schema change). `root_test.go`'s expected-subcommands map SHALL include `"skill"`.

- **GIVEN** the root command tree
- **WHEN** `rk help-dump` is emitted or `TestRootCmdHasSubcommands` runs
- **THEN** `skill` is present in both

### Installer: `rk agent-setup` hooks-only + one-release legacy cleanup

#### R8: agent-setup installs hooks only (no skill install)
`rk agent-setup` SHALL no longer install any `rk-display` SKILL.md. The install-side machinery — `rkDisplaySkillContent`, the install branch of `applyAgentSkill` (diff/confirm/`writeSkill`), `writeSkill`, and the "SECOND managed artifact" header comment — SHALL be deleted. Going-forward net behavior is hooks-only.

- **GIVEN** a fresh machine
- **WHEN** `rk agent-setup` runs
- **THEN** only the agent-state hooks are installed; no skill file is written and no `rk-display` output is printed

#### R9: One-release legacy rk-display cleanup on BOTH passes
For one release, `rk agent-setup` SHALL offer to remove a stale marker-owned `{skillsDir}/rk-display/SKILL.md` on BOTH the install and uninstall passes (via `applyAgentConfig`). A marker-owned file → confirm prompt + `os.RemoveAll` of the directory; a marker-less (user-rewritten) file → the existing skip note; an ABSENT file → silent in both modes (a fresh machine sees zero rk-display output). The retained code is: marker constants (`rkDisplaySkillDir`/`rkDisplaySkillFile`/`skillManagedByMarker`), `readSkill`, `skillHasMarker`, and the removal flow (`uninstallAgentSkill` renamed to a legacy-cleanup name), plus `agentConfig.skillsDir` (locates the legacy skill) with a doc comment rewritten to "legacy rk-display cleanup only — scheduled for removal one release after this change".

- **GIVEN** a machine with a marker-owned legacy `rk-display/SKILL.md`
- **WHEN** `rk agent-setup` runs (install mode) OR `rk agent-setup --uninstall` runs
- **THEN** removal is offered (confirm) and, on confirm, the directory is removed
- **AND GIVEN** a marker-less user rewrite, the file is left untouched with a skip note
- **AND GIVEN** an absent file, nothing is printed in either mode

#### R10: Help/comment text reflects hooks-only reality
The cobra `Short`/`Long` (already hooks-only) SHALL carry no skill mention; the file-header comment SHALL be updated to the hooks-only + legacy-cleanup reality.

- **GIVEN** the slimmed `agent_setup.go`
- **WHEN** its help text and header comment are read
- **THEN** they describe hooks installation + one-release legacy cleanup only, with no context-injection/skill-install prose

### Tests: agent_setup_test.go pruned & adapted

#### R11: Dead install-path tests removed; retained tests adapted; new cleanup tests added
`agent_setup_test.go` SHALL delete the four install-path tests (`TestApplyAgentSkillInstallWritesAt0644`, `TestApplyAgentSkillDeclineDoesNotWrite`, `TestApplyAgentSkillReinstallIsNoOp`, `TestApplyAgentSkillDiffRendersCurrentAndProposed`); adapt `TestSkillHasMarker` (drop the `rkDisplaySkillContent` assertion, keep marker/no-marker/empty cases on inline fixtures) and the uninstall test to the renamed cleanup function seeded with an inline marker-bearing fixture; and add two tests — (a) install-mode run on a machine with a marker-owned legacy skill offers and performs removal, (b) install-mode run on a fresh machine writes no skill file and prints no rk-display output.

- **GIVEN** the slimmed implementation
- **WHEN** `just test-backend` runs
- **THEN** all `cmd/rk` tests pass, no test references the deleted `rkDisplaySkillContent`/`writeSkill`/install branch, and the new cleanup + fresh-machine tests pass

### Docs: the split (agent-setup = hooks only; rk skill = usage briefing)

#### R12: README + context.go cross-discoverability
README.md § Command reference table SHALL add a `run-kit skill` row; `cmd/rk/context.go`'s `writeCapabilities` "### CLI Commands" → **Info** group SHALL add a `run-kit skill` line beside `run-kit context` (keeping the static/dynamic complements cross-discoverable). No `docs/specs/` edits are needed (verified: no rk-display/skill-install references there). The `docs/memory/run-kit/agent-state.md` rewrite is deferred to hydrate.

- **GIVEN** the new command
- **WHEN** README's command table and `rk context`'s CLI Commands Info group are read
- **THEN** each lists `run-kit skill` with a one-line description

### Design Decisions

1. **Mirror shll's `standards` embed mechanism verbatim** (committed copy under a package subdir + sync script + `//go:embed` + drift-guard test against the four-levels-up canonical) — *Why*: the standard explicitly names it as the one to reuse, and it is the only pattern that satisfies "clean `go build` compiles" + drift-guard together. *Rejected*: `build/tmux.conf`-style build-time copy (gitignored — breaks clean build) and a raw runtime file read (no drift guard, not embedded).
2. **Legacy cleanup runs on BOTH install and uninstall for one release** — *Why*: re-running plain `rk agent-setup` is the documented upgrade action (install.md), so uninstall-only cleanup would never reach most machines. *Rejected*: uninstall-only cleanup (misses upgraders); immediate hard delete of all machinery (leaves stale files behind forever).
3. **`skill` command as its own file `skill.go` (not folded into context.go)** — *Why*: mirrors shll's `standards.go` single-file layout and keeps the embed directive + generate directive co-located with the command. *Rejected*: adding to context.go (mixes static-bundle embed with dynamic context command).

## Tasks

### Phase 1: Canonical bundle + embed scaffolding

- [x] T001 Author `docs/site/skill.md` — the canonical static skill bundle: `# ` title + one-paragraph lede, no frontmatter, ≤150 lines; sections When to use / Capabilities map (notify, context, iframe windows, proxy, Visual Display Recipe) / Composition patterns (use-time server-URL discovery) / Output & exit-code contracts (notify fail-silent-by-contract; skill/context/help-dump print to stdout; generic exit 1 otherwise) / Gotchas; seeded from fab-kit `_cli-external.md` § rk + the static half of `context.go`; Environment section excluded. <!-- R1 R2 -->
- [x] T002 Create the committed embed copy directory `app/backend/cmd/rk/skill/` and copy `docs/site/skill.md` → `app/backend/cmd/rk/skill/skill.md` (via the sync script authored in T004). <!-- R4 -->

### Phase 2: `rk skill` command + sync script

- [x] T003 Add `app/backend/cmd/rk/skill.go` — cobra `skillCmd` (`Use: "skill"`, `Short: "Print run-kit's agent skill bundle (static usage briefing)"`), `//go:embed skill/skill.md` into a package var, `//go:generate ../../scripts/sync-skill.sh` directive, RunE writes the embedded bytes verbatim to `cmd.OutOrStdout()` and returns nil. <!-- R3 -->
- [x] T004 [P] Add `scripts/sync-skill.sh` — `#!/usr/bin/env bash`, `set -euo pipefail`, cd to repo root (`cd "$(dirname "$0")/.."`), `cp -f docs/site/skill.md app/backend/cmd/rk/skill/skill.md`, echo a confirmation. <!-- R5 -->
- [x] T005 Register `skillCmd` in `app/backend/cmd/rk/root.go` via `rootCmd.AddCommand(skillCmd)`. <!-- R7 -->

### Phase 3: Installer slimming

- [x] T006 Slim `app/backend/cmd/rk/agent_setup.go`: delete `rkDisplaySkillContent`, the install branch of `applyAgentSkill` + `writeSkill` + the "SECOND managed artifact" comment block; keep the marker constants, `readSkill`, `skillHasMarker`, and rename `uninstallAgentSkill` → a legacy-cleanup name run on BOTH passes (absent = silent both modes; marker-owned = confirm+RemoveAll; marker-less = skip note); rewrite the `agentConfig.skillsDir` doc comment and the file-header comment to the hooks-only + one-release-legacy-cleanup reality; verify `Short`/`Long` carry no skill mention. <!-- R8 R9 R10 -->

### Phase 4: Tests + docs

- [x] T007 Add `app/backend/cmd/rk/skill_test.go`: `TestSkillEmbedMatchesCanonical` (embedded bytes == `../../../../docs/site/skill.md`, hint `scripts/sync-skill.sh` on failure), a command test (stdout == embedded bytes, stderr empty, exit 0), and a ≤150-line budget guard. <!-- R6 -->
- [x] T008 Update `app/backend/cmd/rk/root_test.go`: add `"skill"` to the expected-subcommands map (~line 17). <!-- R7 -->
- [x] T009 Prune/adapt `app/backend/cmd/rk/agent_setup_test.go`: delete the four install-path tests; adapt `TestSkillHasMarker` (drop `rkDisplaySkillContent` assertion) + the uninstall test (renamed cleanup fn, inline marker fixture); add install-mode-cleanup and fresh-machine-silent tests. <!-- R11 -->
- [x] T010 [P] Add a `run-kit skill` row to README.md § Command reference table. <!-- R12 -->
- [x] T011 [P] Add a `run-kit skill` Info line beside `run-kit context` in `cmd/rk/context.go`'s `writeCapabilities` "### CLI Commands" group. <!-- R12 -->

### Phase 5: Verification

- [x] T012 Run `just test-backend` and confirm all Go tests pass (drift guard, budget, command, root, agent_setup). <!-- R3 R6 R7 R8 R9 R11 -->

## Execution Order

- T001 blocks T002 (sync copies the authored file) and T007 (drift guard compares against it).
- T003 blocks T005 (root registers the command) and T007 (command test drives it).
- T004 is the mechanism T002 uses; author T004 alongside T003, run it for T002.
- T012 runs last, after all implementation and test tasks.
- T010, T011 are independent docs edits ([P]); T004 is [P] relative to T003.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `docs/site/skill.md` exists, is a usage briefing covering the five capability sections keyed to rk subcommands, follows the `# Title` + lede sibling-doc style, and excludes the dynamic Environment section
- [x] A-002 R2: The bundle contains no hardcoded session/pane/server-URL value; server-URL discovery points at `rk context` at use-time
- [x] A-003 R3: `rk skill` writes the embedded bundle to stdout byte-identical to `docs/site/skill.md`, with empty stderr and exit 0
- [x] A-004 R4: `app/backend/cmd/rk/skill/skill.md` is committed and a clean `go build ./...` compiles with no script run
- [x] A-005 R5: `scripts/sync-skill.sh` exists, is `set -euo pipefail`, copies canonical → embed copy from the repo root, and echoes a confirmation
- [x] A-006 R7: `skillCmd` is registered in `root.go` and appears in `rk help-dump`
- [x] A-007 R8: `rk agent-setup` installs only hooks; `rkDisplaySkillContent`, the install branch, `writeSkill`, and the "SECOND managed artifact" comment are gone
- [x] A-008 R9: legacy rk-display cleanup runs on both install and uninstall passes — marker-owned = offered removal, marker-less = skip note, absent = silent both modes
- [x] A-009 R12: README's command table and `rk context`'s CLI Commands Info group each list `run-kit skill`

### Behavioral Correctness

- [x] A-010 R8: A fresh-machine `rk agent-setup` writes no skill file and prints no rk-display output
- [x] A-011 R9: `agentConfig.skillsDir` and the file-header comment are rewritten to the hooks-only + one-release-legacy-cleanup reality; `Short`/`Long` carry no skill mention

### Removal Verification

- [x] A-012 R11: No code or test references the deleted `rkDisplaySkillContent`, `writeSkill`, or the `applyAgentSkill` install branch; the four dead install-path tests are gone

### Scenario Coverage

- [x] A-013 R6: `TestSkillEmbedMatchesCanonical` fails when canonical and embed drift (hinting the sync script), the command test asserts byte-identical stdout + empty stderr, and the ≤150-line budget guard is present
- [x] A-014 R11: adapted `TestSkillHasMarker` + uninstall test pass on inline fixtures; install-mode-cleanup and fresh-machine-silent tests pass

### Edge Cases & Error Handling

- [x] A-015 R9: An absent legacy `rk-display/SKILL.md` produces no output in EITHER install or uninstall mode (no "nothing to do" line on a fresh machine)

### Code Quality

- [x] A-016 Pattern consistency: `skill.go`, `sync-skill.sh`, and the drift-guard test mirror the shll `standards` precedent and surrounding rk cobra-command/script conventions
- [x] A-017 No unnecessary duplication: the embed mechanism reuses the established shll pattern; no new bespoke embedding is invented; `readSkill`/`skillHasMarker`/marker constants are reused, not re-declared
- [x] A-018 Security (Constitution I): the `skill` command interpolates no user input and embeds fixed bytes; no `exec` surface is added; agent-setup's retained `os.RemoveAll` stays gated behind the marker check + confirm

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `renderArtifactDiff` (`app/backend/cmd/rk/agent_setup.go:441`) — down to a single caller (`applyAgentHooks`) now that the skill-install branch is deleted; its "shared between two artifacts" reason is gone (its own comment documents the deliberate keep, but it is now inlinable)
- Legacy rk-display cleanup machinery (`removeLegacySkill`, `readSkill`, `skillHasMarker`, `rkDisplaySkillDir`/`rkDisplaySkillFile`/`skillManagedByMarker`, `agentConfig.skillsDir` + its Claude Code registry value, and tests `TestRemoveLegacySkill`/`TestApplyAgentConfigCleansLegacySkillOnInstall` + fixtures `seedLegacySkill`/`legacyMarkerSkill` in `agent_setup.go`/`agent_setup_test.go`) — deliberately retained one release per R9; scheduled follow-up deletion is documented in the code comments and should be tracked for the release after this change

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle contract taken verbatim from the merged shll standard (command `skill`, raw markdown to stdout, stderr empty, exit 0, byte-identical to `docs/site/skill.md`, ≤150 lines, static-only) | Standard merged (shll b9aca55/PR #42), constitution § Toolkit Standards binds it, read via `shll standards skill` | S:95 R:90 A:95 D:100 |
| 2 | Certain | Bundle content = fab-kit `_cli-external.md` rk rows + static half of `context.go`; Environment section excluded | Intake enumerates exactly this seed list and the exclusion | S:95 R:85 A:90 D:95 |
| 3 | Confident | Embed mechanism mirrors shll's `standards` pattern: committed copy at `app/backend/cmd/rk/skill/skill.md`, `scripts/sync-skill.sh`, `//go:generate` directive, drift-guard test at `../../../../docs/site/skill.md` | No committed-doc embed precedent in this repo (tmux.conf copy is gitignored build-time — fails commit+drift-guard); standard names shll's mechanism as the one to reuse; file location/script name are the intake's adaptation | S:80 R:75 A:85 D:80 |
| 4 | Confident | Legacy rk-display cleanup runs on BOTH install and uninstall for one release (remove-if-marker-owned behind confirm; silent when absent); install machinery (content literal, writeSkill, install branch) deleted outright | Intake grants judgment; install-time cleanup needed because re-running `rk agent-setup` is the documented upgrade action, so uninstall-only cleanup would miss most machines | S:75 R:80 A:85 D:70 |
| 5 | Confident | Rename `uninstallAgentSkill` → `removeLegacySkill` and call it from `applyAgentConfig` on both passes; keep `applyAgentSkill` deleted (whole install/uninstall split collapses into the single cleanup call) | Cleanest expression of "run the removal flow on both passes" given the deleted install branch; the removal flow no longer needs the `applyAgentSkill` wrapper | S:70 R:80 A:80 D:65 |
| 6 | Confident | `//go:generate` directive path is `../../scripts/sync-skill.sh` (from `app/backend/cmd/rk/` up two dirs is `app/`, so the repo-root `scripts/` is `../../../scripts`) — verify exact depth at implementation and use the correct relative path | go:generate runs from the file's package dir (`app/backend/cmd/rk/`); repo root is four levels up so `scripts/` is `../../../../scripts` — confirm and fix the directive during T003 | S:70 R:90 A:80 D:70 |
| 7 | Confident | README row + `context.go` Info line phrasing: "Print the agent skill bundle — a static usage briefing for agents operating run-kit" | Keeps static/dynamic complements cross-discoverable, consistent with existing command-table/Info-group entries; small and reversible | S:65 R:90 A:80 D:75 |
| 8 | Certain | No `docs/specs/` edits; the only context-injection doc is `docs/memory/run-kit/agent-state.md`, updated at hydrate | Intake verified by grep that specs/README/install.md carry no rk-display/skill-install references | S:80 R:85 A:90 D:85 |

8 assumptions (3 certain, 5 confident, 0 tentative).
