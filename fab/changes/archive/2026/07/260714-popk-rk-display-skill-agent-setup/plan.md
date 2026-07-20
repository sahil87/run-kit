# Plan: rk-display Skill Installed by rk agent-setup

**Change**: 260714-popk-rk-display-skill-agent-setup
**Intake**: `intake.md`

## Requirements

### rk-display: Skill Artifact

#### R1: Skill content ships in the binary as a fixed literal
The rk binary SHALL carry the full `rk-display/SKILL.md` content as a fixed Go
string literal with no machine-derived or user-provided interpolation, so it is
versioned with rk and updated by `brew upgrade rk` + re-running `rk agent-setup`.

- **GIVEN** the rk binary is built
- **WHEN** `rk agent-setup` proposes the skill artifact
- **THEN** the proposed content is a compile-time constant with no runtime-substituted values (no rk path, no user input)
- **AND** the content matches the intake's authoritative skill shape (frontmatter `name`/`description`/`managed-by`, thin-pointer body: gate → `rk context` → follow the Visual Display Recipe)

#### R2: The skill body is a thin pointer, never embedding recipe content
The skill body SHALL instruct the agent to (1) gate on `command -v rk` and
`$TMUX_PANE`, silently falling back to text on failure, (2) run `rk context` to
discover the current recipe, and (3) follow the Visual Display Recipe from that
output — it SHALL NOT reproduce the recipe, server URL, or pane identity.

- **GIVEN** the skill body literal
- **WHEN** it is inspected
- **THEN** it contains the fail-silent gate, the `rk context` discovery step, and a "do not reproduce the recipe from memory" instruction
- **AND** it does NOT embed the proxy URL pattern, iframe tmux options, or any use-time value the agent learns from `rk context`

### rk-display: Installer Extension

#### R3: `agentConfig` gains a `skillsDir` field
The `agentConfig` struct SHALL gain a `skillsDir string` field. The Claude Code
registry row SHALL set it to `filepath.Join(home, ".claude", "skills")`. An empty
`skillsDir` SHALL mean "no skill install for that agent" (for future
codex/copilot/gemini/opencode rows).

- **GIVEN** the per-agent registry
- **WHEN** the Claude Code row is constructed
- **THEN** its `skillsDir` is `{home}/.claude/skills`
- **AND** a row with an empty `skillsDir` performs no skill install

#### R4: `applyAgentConfig` manages the skill as a second artifact
`applyAgentConfig` SHALL, alongside the existing settings-hooks merge, propose
`{skillsDir}/rk-display/SKILL.md` — but SHALL skip the skill artifact entirely
when `skillsDir` is empty. The skill flow SHALL reuse the existing artifact
pattern: tolerant read of current content (missing file → empty), diff of current
vs proposed, no-op skip with a message when identical, and a y/N confirm
(default No) before writing. It SHALL `MkdirAll` `{skillsDir}/rk-display/` and
write the file with mode **0644** (skill text is not a secret — deliberately
unlike settings.json's 0600).

- **GIVEN** a `skillsDir` is set on the agent config
- **WHEN** the skill file is absent
- **THEN** the diff shows the full proposed content and, on confirm, writes it at 0644 after creating the directory
- **GIVEN** the installed skill file is byte-identical to the proposed content
- **WHEN** `rk agent-setup` re-runs
- **THEN** it reports "nothing to do" and does not prompt
- **GIVEN** a `skillsDir` is empty
- **WHEN** `applyAgentConfig` runs
- **THEN** no skill artifact is proposed, diffed, or written

#### R5: Ownership marker gates uninstall
Ownership of the skill file SHALL be determined by the `managed-by: rk agent-setup`
frontmatter marker (rk owns the WHOLE file — no merging into user content). On
`--uninstall`, the `rk-display/` directory SHALL be removed only when the marker
is present in the installed file; a user-rewritten file lacking the marker SHALL
be left untouched with a printed note explaining the skip. A hand-edited file that
still carries the marker SHALL surface as a reinstall diff, protected by the
existing confirm gate.

- **GIVEN** an installed `rk-display/SKILL.md` carrying the `managed-by: rk agent-setup` marker
- **WHEN** `rk agent-setup --uninstall` runs
- **THEN** the `rk-display/` directory is removed (after confirm)
- **GIVEN** a `rk-display/SKILL.md` rewritten by the user without the marker
- **WHEN** `rk agent-setup --uninstall` runs
- **THEN** the file/directory is left untouched and a skip note is printed
- **GIVEN** a hand-edited but still-marked skill file
- **WHEN** `rk agent-setup` re-runs (install)
- **THEN** the difference surfaces as a diff behind the existing y/N confirm gate

#### R6: Command surface unchanged
The command surface SHALL be unchanged: same `rk agent-setup` /
`rk agent-setup --uninstall`, now managing two artifacts per agent. No new flags,
no new commands. The Constitution §I interpolation surface SHALL NOT grow — the
skill content embeds nothing machine-derived or user-provided.

- **GIVEN** the CLI
- **WHEN** `rk agent-setup [--uninstall]` is invoked
- **THEN** the flag/command set is identical to before this change
- **AND** the skill write introduces no new path-safety surface (no `resolveRkPath`/`validateHookPath`-style interpolation for the skill)

### rk-display: Unit Tests

#### R7: New behavior is covered by unit tests
New unit tests in `agent_setup_test.go` SHALL cover, at minimum: marker detection
(marked file recognized as rk-owned, marker-less file not), idempotent reinstall
(installing over an identical skill is a no-op with a "nothing to do" message and
no prompt), uninstall-only-with-marker (`--uninstall` removes `rk-display/` when
the marker is present, leaves a marker-less file untouched with the skip note),
and diff rendering (the current-vs-proposed skill diff renders through the same
confirm flow as the settings merge).

- **GIVEN** the test suite
- **WHEN** `just test-backend` runs
- **THEN** the four listed behaviors are exercised and pass

### Non-Goals

- SessionStart hook injecting context — rejected (compaction, per-session token cost).
- User-global CLAUDE.md pointer — rejected (passive, noisy on non-run-kit sessions).
- Launch-time `--append-system-prompt "$(rk context)"` — rejected (misses hand-launched agents).
- MCP server with a `display_html` tool — rejected (Constitution §IV; duplicates existing tmux options).
- Trigger-verb expansion beyond the agreed `description:` wording (screenshot/preview/report is a documented post-ship tuning knob, out of scope).
- Any API, frontend, tmux, or daemon change; any UI surfacing.

### Design Decisions

1. **Skill content storage: Go raw-string `const`, not `//go:embed`**: store the SKILL.md text as a raw-string constant in `agent_setup.go` — *Why*: `cmd/rk` already stores small fixed text/shell blobs as raw-string consts (`shell_init.go`'s `zshCompinitShim`/`bashAliasComplete`); `//go:embed` in this backend is reserved for external file *trees* (`build/embed.go`: frontend, tmux.conf). The skill body is a single small literal with zero interpolation, so a const is the matching, simplest pattern — *Rejected*: `//go:embed` (would introduce an embedded-file surface for one tiny inline literal, diverging from `cmd/rk` convention for no benefit).
2. **Skill artifact reuses the settings-artifact flow, generalized over content type**: the skill install mirrors the read → diff → no-op → confirm → write pipeline of the hooks merge — *Why*: the intake mandates reusing the existing flow; it is proven and testable (injected `io.Reader`/`io.Writer`). The skill differs only in being a whole-file overwrite (no JSON merge) at mode 0644 — *Rejected*: a bespoke second flow (needless duplication of the confirm/diff machinery).
3. **Ownership by frontmatter marker string, analogous to `isRkEntry` but whole-file**: a `skillHasMarker` predicate checks for `managed-by: rk agent-setup` in the file content — *Why*: mirrors the existing `isRkEntry` marker discipline; rk owns the whole file so no in-place merge is needed, just a presence check to gate destructive removal — *Rejected*: tracking ownership out-of-band (a manifest/state file — violates Constitution §II "no persistent state store").

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the `rkDisplaySkillContent` raw-string `const` and the `managedByMarker`/skill-relative-path constants to `app/backend/cmd/rk/agent_setup.go`, holding the full `rk-display/SKILL.md` text (frontmatter `name`/`description`/`managed-by` + thin-pointer body per intake §1). <!-- R1 R2 -->
- [x] T002 Add the `skillsDir string` field to the `agentConfig` struct and set it to `filepath.Join(home, ".claude", "skills")` on the Claude Code registry row in `agentRegistry` (`app/backend/cmd/rk/agent_setup.go`). <!-- R3 -->

### Phase 2: Integration & Edge Cases

- [x] T003 Add skill install/uninstall helpers to `app/backend/cmd/rk/agent_setup.go`: a tolerant read of the current skill file (missing → empty), a `skillHasMarker` predicate matching `managed-by: rk agent-setup`, a diff+confirm+write path (MkdirAll `{skillsDir}/rk-display/`, mode 0644), a no-op "nothing to do" report when content is identical, and a marker-gated `--uninstall` that removes the `rk-display/` directory only when the marker is present (else prints a skip note). <!-- R4 R5 -->
- [x] T004 Wire the skill artifact into `applyAgentConfig` (`app/backend/cmd/rk/agent_setup.go`): after the settings-hooks merge, run the skill artifact flow when `ac.skillsDir != ""`, skipping it entirely when empty; reuse the injected `io.Writer`/`*bufio.Reader` so it stays TTY-free testable, and keep the command surface (flags/commands) unchanged. <!-- R4 R6 -->

### Phase 3: Tests

- [x] T005 Add unit tests to `app/backend/cmd/rk/agent_setup_test.go` covering: marker detection (`skillHasMarker` true for a marked file, false for a marker-less rewrite), idempotent reinstall no-op (identical skill → "nothing to do", no prompt consumed), uninstall-only-with-marker (marked → `rk-display/` removed; marker-less → untouched + skip note), skip-when-empty-`skillsDir`, and diff rendering through the shared confirm flow. <!-- R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The rk binary carries the full skill content as a compile-time literal with no runtime interpolation, matching the intake's authoritative shape.
- [x] A-002 R2: The skill body contains only the gate → `rk context` → follow-the-recipe pointer and never embeds the recipe, proxy pattern, iframe options, server URL, or pane identity.
- [x] A-003 R3: `agentConfig` has a `skillsDir` field; the Claude Code row sets it to `{home}/.claude/skills`; an empty value means no skill install.
- [x] A-004 R4: `applyAgentConfig` proposes `{skillsDir}/rk-display/SKILL.md` via the shared read/diff/no-op/confirm flow, writes at 0644 after MkdirAll, and skips the artifact when `skillsDir` is empty.
- [x] A-005 R5: Ownership is determined by the `managed-by: rk agent-setup` marker; `--uninstall` removes `rk-display/` only when the marker is present and leaves a marker-less file untouched with a skip note.
- [x] A-006 R6: The CLI flag/command set is unchanged and the skill write adds no new interpolation/path-safety surface.

### Behavioral Correctness

- [x] A-007 R4: A re-run over an identical installed skill reports "nothing to do" and does not prompt.
- [x] A-008 R5: A hand-edited but still-marked skill file surfaces as a reinstall diff behind the existing y/N confirm gate.

### Edge Cases & Error Handling

- [x] A-009 R4: A missing skill file is read tolerantly as empty (never an error); the directory is created on first write.
- [x] A-010 R5: `--uninstall` on a marker-less user rewrite prints an explanatory skip note and mutates nothing.

### Scenario Coverage

- [x] A-011 R7: Unit tests exercise marker detection, idempotent reinstall no-op, uninstall-only-with-marker, skip-when-empty-`skillsDir`, and diff rendering; `just test-backend` is green.

### Code Quality

- [x] A-012 Pattern consistency: New code follows the pure-function-over-injected-`io.Reader`/`io.Writer`, tolerant-read, explicit-y/N-confirm, per-artifact no-op-reporting patterns already in `agent_setup.go`.
- [x] A-013 No unnecessary duplication: The skill flow reuses the existing confirm/diff/read machinery rather than duplicating it; convention strings are single-sourced (no magic-string re-declaration). *(Review note: the 5-line `--- current`/`+++ proposed`/confirm-prompt render block is inlined in both artifact flows — flagged should-fix, not blocking.)*
- [x] A-014 Security (Constitution §I): All file writes go through Go; no shell strings; the skill content is a fixed literal with nothing user-provided or machine-derived interpolated, so it adds no new injection surface.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Skill content stored as a Go raw-string `const` (not `//go:embed`) in `agent_setup.go` | Codebase check: `cmd/rk` stores small fixed text blobs as raw-string consts (`shell_init.go`); `//go:embed` is reserved for external file trees (`build/embed.go`). Intake Assumption 9 left this to the apply-time pattern check; the pattern is unambiguous | S:90 R:90 A:95 D:90 |
| 2 | Certain | Skill artifact runs after the hooks merge inside `applyAgentConfig`, reusing the injected `io.Writer`/`*bufio.Reader` and the read/diff/no-op/confirm machinery | Intake §2.3 mandates reusing the existing flow; the existing `applyAgentConfig` structure and test seams make this the direct fit | S:95 R:85 A:95 D:90 |
| 3 | Certain | Ownership predicate is a whole-file `managed-by: rk agent-setup` string presence check (analogous to `isRkEntry`), not a JSON/state-file mechanism | Intake §2.4 specifies the marker gates uninstall and rk owns the whole file; Constitution §II forbids a persistent state store | S:90 R:85 A:95 D:90 |
| 4 | Certain | Uninstall removes the whole `rk-display/` directory (marker present), via `os.RemoveAll` on `{skillsDir}/rk-display/`, behind the existing confirm prompt | Intake Assumption 10 (directory-level deletion is the agreed design; confirm surfaces it) | S:80 R:80 A:90 D:85 |
| 5 | Confident | Skill file basename is `SKILL.md` inside a `rk-display/` directory (`{skillsDir}/rk-display/SKILL.md`), matching the Claude Code skill discovery convention | Intake states this path verbatim in §1 and §2.3; it matches the harness's `.claude/skills/{name}/SKILL.md` layout | S:85 R:80 A:80 D:85 |

5 assumptions (4 certain, 1 confident, 0 tentative).

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The `applyAgentConfig` rename to `applyAgentHooks` plus the new two-artifact wrapper leaves no orphaned symbol: all previous callers now go through the wrapper, and no code path, flag, or config field was superseded.)
