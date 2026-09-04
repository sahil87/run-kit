# Plan: Agent-setup tutorial invoker skill

**Change**: 260903-kqps-agent-setup-tutorial-invoker-skill
**Intake**: `intake.md`

## Requirements

### Installer: run-kit-tutorial invoker skill

#### R1: Tracked, embedded payload
The invoker skill's full `SKILL.md` content MUST be tracked in-repo as a standalone markdown file under `app/backend/cmd/rk/` (new subdir `agentskill/`, outside the docs/site-synced `cmd/rk/skill/` bundle namespace) and embedded into the binary via `//go:embed`. The payload MUST contain, in order:

1. YAML frontmatter with `name: run-kit-tutorial`, a `description:` that (a) triggers on tutorial / tour / walkthrough / onboarding / "show me around" phrasing about run-kit or its dashboard, and (b) states that this skill — not a repo's `ONBOARDING.md` and not an improvised tour — is the route for such requests; and the ownership marker as a YAML comment line `# managed-by: rk agent-setup (run-kit-tutorial skill)`.
2. A thin router body: gate `command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]` — on failure STOP and tell the user to open the run-kit dashboard, create a session/window for this directory, run the agent inside it, and ask again; on pass run `rk skill tutorial` and follow its output exactly (it owns chapters, pacing, degradation, cleanup — never summarize, reorder, or substitute).

- **GIVEN** the repo at this change
- **WHEN** `go build ./cmd/rk` runs
- **THEN** the payload is embedded and available to the installer as a string, and no tour content is duplicated into it (the router names `rk skill tutorial` as the sole content source)

#### R2: Install step — third managed artifact family
`rk agent setup` MUST install the payload at `{skillsDir}/run-kit-tutorial/SKILL.md` for every registry row with a non-empty `skillsDir` (v1: Claude Code → `~/.claude/skills/run-kit-tutorial/SKILL.md`), as a step of `applyAgentConfig` running between the hooks merge and the legacy rk-display cleanup, independently of both (declining or no-op-ing one never skips another). The step MUST follow the established managed-artifact contract:

- An existing file WITHOUT the marker (including zero-byte — existence-aware read via `readFileIfExists`) is left untouched with a skip note (chatter).
- Content byte-equal to the embedded payload → reported no-op (chatter), no prompt.
- Otherwise (fresh install or stale generation): a one-line summary on the interactive/`--yes` paths, the full current/proposed body via `renderArtifactDiff` only under `--dry-run`, and the write gated through `consent.authorizeWrite` (interactive `[y/N]`, `--yes` writes, `--dry-run` writes nothing and wins over `--yes`, non-TTY with neither flag refuses via `errNonInteractiveConsent`).
- On consent: `MkdirAll` the skill dir 0755, write `SKILL.md` 0644 (skill content is not secret — settings.json's 0600 does not apply), replacing a stale rk-owned file in place.

- **GIVEN** a fresh machine with no `~/.claude/skills/run-kit-tutorial/`
- **WHEN** `rk agent setup --yes` runs
- **THEN** the file is written with the embedded content and the run reports it (chatter)
- **GIVEN** an installed current copy
- **WHEN** `rk agent setup --yes` re-runs
- **THEN** the step reports "already installed — nothing to do" and writes nothing
- **GIVEN** a user-rewritten (marker-less) file at the path
- **WHEN** `rk agent setup --yes` runs
- **THEN** the file is left byte-identical and a skip note names the marker

#### R3: Uninstall
`rk agent setup --uninstall` MUST remove a marker-owned `{skillsDir}/run-kit-tutorial/` directory (`os.RemoveAll` after consent through the same `authorizeWrite` seam, dir-level like the legacy rk-display cleanup). An absent file is silent; a marker-less file is left untouched with a skip note.

- **GIVEN** an installed marker-owned copy
- **WHEN** `rk agent setup --uninstall --yes` runs
- **THEN** the `run-kit-tutorial/` directory is removed
- **GIVEN** no installed copy
- **WHEN** `rk agent setup --uninstall --yes` runs
- **THEN** the step produces zero output

#### R4: Housekeeping — comments and help
The `agent_setup.go` header comment MUST be updated from "two artifact families" to three, and its "no longer installs any skill" narrative revised: the retired artifact was the *content-injection* rk-display skill; the new artifact is a *discovery router* whose content stays behind `rk skill tutorial` (binary-served, upgrade-tracking). The `agentConfig.skillsDir` doc comment MUST drop its "scheduled for removal" note (the field regains a consumer; the legacy rk-display cleanup keeps its own one-release schedule untouched). The `rk agent setup` `Long` help text SHOULD name the skill install alongside hooks and the shim.

- **GIVEN** the merged change
- **WHEN** a reader opens `agent_setup.go` or runs `rk agent setup --help`
- **THEN** the described artifact inventory matches what the command actually manages

#### R5: Tests
`agent_setup_test.go` MUST cover the new step: fresh install, idempotent re-run no-op, stale-content replace-in-place, marker-less skip (install and uninstall), uninstall removal, absent-file silence on uninstall, `--dry-run` writes nothing, and the marker constant appearing in the embedded payload (guarding against a payload edit dropping the marker, which would orphan installed copies). Tests MUST be verified with `env -u TMUX -u TMUX_PANE go test` (ambient tmux env produces false local greens for cmd/rk tests).

- **GIVEN** the test suite
- **WHEN** `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` runs
- **THEN** all new and existing cases pass

### Non-Goals

- No `rk doctor` row for the skill (drift is repaired by the documented `rk agent setup` re-run; add-only follow-up).
- No non-Claude registry rows; no change to `rk skill tutorial` content or `rk tutorial`.
- No numeric generation counter — marker identifies ownership, byte-compare identifies staleness.

### Design Decisions

#### Payload as embedded file, not Go const, outside the skill bundle dir
**Decision**: the payload lives at `cmd/rk/agentskill/run-kit-tutorial.md`, embedded via `//go:embed agentskill/run-kit-tutorial.md`.
**Why**: multiline markdown reviews and diffs better as a file; `cmd/rk/skill/` is the `rk skill` bundle namespace synced from docs/site with embed drift-guard tests, and an installer payload is neither a servable topic nor docs/site-synced.
**Rejected**: a Go string const (the shim's approach — right for a shell script full of format verbs, noisy for prose markdown); placing it in `cmd/rk/skill/` (would conflate two artifact families and invite the sync script to fight it).
*Introduced by*: 260903-kqps-agent-setup-tutorial-invoker-skill

#### Ownership marker as a YAML comment inside the frontmatter
**Decision**: `# managed-by: rk agent-setup (run-kit-tutorial skill)` as a comment line inside the frontmatter block; recognition is whole-file `strings.Contains` (the `skillHasMarker` shape).
**Why**: invisible to skill consumers (YAML comments are dropped by frontmatter parsers), follows `tmuxShimMarker`'s parenthesized-family pattern, frozen text once shipped.
**Rejected**: a frontmatter *field* (unknown fields risk harness validation churn); an HTML comment in the body (works, but the frontmatter is the file's identity block and the legacy precedent put the marker there).
*Introduced by*: 260903-kqps-agent-setup-tutorial-invoker-skill

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/agentskill/run-kit-tutorial.md` — full SKILL.md payload per R1 (frontmatter with name/description/marker comment; gate + route body) — and wire `//go:embed agentskill/run-kit-tutorial.md` plus the `tutorialSkillDir`/`tutorialSkillFile`/`tutorialSkillMarker` constants in `app/backend/cmd/rk/agent_setup.go` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Implement `installTutorialSkill` (install path: marker-less skip, byte-equal no-op, summary/diff + consent, MkdirAll 0755 + write 0644) and `removeTutorialSkill` (uninstall path: absent silent, marker-less skip, consent + `os.RemoveAll`) in `app/backend/cmd/rk/agent_setup.go`, wired into `applyAgentConfig` between `applyAgentHooks` and `removeLegacySkill`, gated on non-empty `skillsDir`, branching on `uninstall` <!-- R2 -->
- [x] T003 Update `agent_setup.go` header comment (three artifact families; router-vs-content rationale), `agentConfig.skillsDir` doc comment (rescind removal note), and the `Long` help text (name the skill install) <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add `agent_setup_test.go` cases per R5 (fresh install, idempotent, stale replace, marker-less skip both modes, uninstall removal, absent silence, dry-run, payload-carries-marker guard); run `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` <!-- R5 -->

### Phase 4: Polish

- [x] T005 Full-package verification: `env -u TMUX -u TMUX_PANE go test ./...` in `app/backend` and `go vet ./cmd/rk/` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The embedded payload exists at `cmd/rk/agentskill/run-kit-tutorial.md` with frontmatter (name, triggering description forbidding the ONBOARDING.md detour, marker comment) and the gate-then-`rk skill tutorial` router body; no tour content duplicated
- [x] A-002 R2: `rk agent setup` installs `{skillsDir}/run-kit-tutorial/SKILL.md` as an independent `applyAgentConfig` step following the full managed-artifact contract (marker-less skip, no-op detection, consent modes, replace-in-place)
- [x] A-003 R3: `--uninstall` removes a marker-owned `run-kit-tutorial/` dir after consent; absent silent; marker-less untouched

### Behavioral Correctness

- [x] A-004 R2: `--dry-run` renders the full artifact diff and writes nothing (wins over `--yes`); non-TTY with neither flag refuses with `errNonInteractiveConsent` before any write

### Scenario Coverage

- [x] A-005 R5: Tests cover every R5 scenario and pass under `env -u TMUX -u TMUX_PANE`

### Edge Cases & Error Handling

- [x] A-006 R2: A zero-byte user file at the skill path is treated as user-owned (existence-aware read) and never overwritten

### Code Quality

- [x] A-007 Pattern consistency: the new step reuses `consent`/`authorizeWrite`, `readFileIfExists`, `renderArtifactDiff`, and the chatter/data channel routing — no parallel consent or diff machinery
- [x] A-008 No unnecessary duplication: recognition and removal mirror the established helpers; no re-implementation of marker matching beyond a whole-file contains
- [x] A-009 Comment discipline: updated comments state constraints (ownership, frozen marker, why-router), never narrate the change or cite the change ID

### Security

- [x] A-010 R2: All writes are Go file ops with fixed embedded content — nothing user-provided or machine-derived is interpolated into the payload or any shell string

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (`readSkill`/`skillHasMarker`/`removeLegacySkill` remain consumed by the legacy rk-display cleanup, which keeps its own one-release removal schedule).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Payload subdir named `cmd/rk/agentskill/` | Any name outside `skill/` works; this one states the family | S:60 R:85 A:75 D:60 |
| 2 | Confident | Marker as YAML comment inside frontmatter | Invisible to consumers, matches legacy frontmatter placement; HTML comment equally viable | S:65 R:60 A:75 D:60 |
| 3 | Confident | Step ordering: hooks → tutorial skill → legacy cleanup | Install-before-cleanup keeps the two skill flows adjacent; steps are independent so order is cosmetic | S:55 R:90 A:80 D:70 |
| 4 | Confident | File modes 0755 dir / 0644 file | Skill content is not secret; matches startup-file/shim posture rather than settings.json's 0600 | S:60 R:85 A:85 D:75 |

4 assumptions (0 certain, 4 confident, 0 tentative).
