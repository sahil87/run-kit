# Plan: Condense agent-setup Consent Output

**Change**: 260812-7a58-condense-agent-setup-consent-output
**Intake**: `intake.md`

## Requirements

### CLI: agent-setup consent rendering

#### R1: Hooks-merge consent shows a semantic summary
On the interactive and `--yes` paths, `applyAgentHooks` SHALL render a per-entry semantic summary of the hooks merge instead of the full current+proposed JSON bodies: one line per rk hook entry (event, matcher when present, state token), derived from the registry rows actually being installed, plus a preservation note (`all other settings and non-rk hooks preserved`). When the merge replaces existing rk-owned entries, the summary SHALL state the replaced count derived from the actual current settings (never hardcoded). On `--uninstall`, the summary SHALL state the count of rk-owned entries being removed, derived from the actual current settings.

- **GIVEN** a fresh machine (no `~/.claude/settings.json`) and an interactive TTY
- **WHEN** `rk agent-setup` reaches the hooks-merge consent
- **THEN** the output lists the 6 rk entries semantically (e.g. `+ UserPromptSubmit → active`, `+ Notification (idle_prompt) → idle`, `+ SessionStart → chat stamp`) and does NOT contain the `--- current` / `+++ proposed` full-body block

- **GIVEN** settings.json carrying 6 old-generation rk entries plus user hooks
- **WHEN** `rk agent-setup` re-runs
- **THEN** the summary notes the in-place replacement count (6) and the preservation of non-rk hooks

- **GIVEN** settings.json carrying 6 rk entries
- **WHEN** `rk agent-setup --uninstall` reaches the hooks consent
- **THEN** the summary states 6 rk-owned entries will be removed and does not dump full bodies

#### R2: tmux shim consent is one summary line
On the interactive and `--yes` paths, `installTmuxShimFile` SHALL render a single summary line instead of the full shim-script diff: on fresh install, the shim path plus an rk-owned description with the actual script line count (computed from the rendered script, not hardcoded); on an rk-owned content update, an "update the rk-owned tmux shim" line naming the path. Marker-less foreign files keep today's earlier skip note and never reach this rendering.

- **GIVEN** no shim at `~/.local/share/rk/shims/tmux`
- **WHEN** install reaches the shim consent
- **THEN** exactly one summary line names the path and the rk-owned script (with its line count); the script body is not printed

#### R3: PATH-block consent shows the owned block, not the whole file
On the interactive and `--yes` paths, `applyTmuxGuardPathBlocks` SHALL render the exact marker-owned block (the 3 lines: begin marker, `export PATH=…`, end marker) plus the target file and placement — `appended at end` when no block exists, `replaced in position` when an existing block is being updated — instead of the full current+next file contents. On uninstall, a single line SHALL name the removal (`will remove the 3-line rk PATH block from {file}`) without echoing file contents.

- **GIVEN** a `~/.zshenv` with user content and no rk block
- **WHEN** install reaches that file's consent
- **THEN** the output shows the 3 block lines and `appended at end`, and the user's own file content is not echoed back

- **GIVEN** a startup file carrying the rk block
- **WHEN** `--uninstall` reaches that file's consent
- **THEN** one line names the block removal; no file contents are printed

#### R4: `--dry-run` retains the full-body diffs
Under `--dry-run`, all three sites SHALL keep today's full `renderArtifactDiff` rendering (complete current+proposed bodies) as the explicitly-requested preview data, routed to the data channel as today.

- **GIVEN** any pending write at any of the three sites
- **WHEN** `rk agent-setup --dry-run` runs
- **THEN** the output contains the `--- current` / `+++ proposed` full-body block followed by the existing dry-run note, and nothing is written

#### R5: Consent semantics and channel routing are unchanged
The change SHALL NOT alter `consent`/`authorizeWrite` behavior (non-TTY refusal, `--dry-run` wins over `--yes`, `[y/N]` default-No), channel routing (`consent.diffWriter`: chatter on `--yes`, data on interactive/`--dry-run`; `--yes --quiet` fully silent on success), what is written, idempotence, or marker-ownership rules. Summary rendering SHALL write to the same `cons.diffWriter(sink)` writer the full diff uses today.

- **GIVEN** `rk agent-setup --yes --quiet` on a fresh machine
- **WHEN** the run completes
- **THEN** stdout/stderr are silent on success, exactly as today

### Design Decisions

#### Summary-vs-full keyed on `cons.dryRun` at each render site
**Decision**: each of the three sites branches locally — `if cons.dryRun` → today's `renderArtifactDiff` full bodies, else the new semantic summary — with the writer unchanged (`cons.diffWriter(sink)`).
**Why**: `--dry-run` is the one path where the full body is the requested output; the consent flags already encode that, so no new flag or plumbing is needed.
**Rejected**: a new `--verbose` flag (extra surface for a need `--dry-run` already covers); changing `diffWriter` routing (orthogonal, and `--yes --quiet` net-effect must hold).
*Introduced by*: 260812-7a58-condense-agent-setup-consent-output

#### Counts derived from the computed merge, never hardcoded
**Decision**: replaced/removed rk-entry counts come from counting `isRkEntry` matches in the current settings at the call site; the entry list comes from the `agentRegistry` rows being installed; the shim line count from the rendered script.
**Why**: the summary must stay honest as the registry grows (new agents/events) without a stale literal.
**Rejected**: hardcoding "6 entries" (drifts the moment the registry changes).
*Introduced by*: 260812-7a58-condense-agent-setup-consent-output

### Non-Goals

- No unified-diff engine (intake assumption #2 — semantic summary chosen)
- No changes to `rk agent-setup` write behavior, flags, or the legacy rk-display cleanup path (its prompts are already one-liners)

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/backend/cmd/rk/agent_setup.go`, add the hooks-merge semantic summary: a `countRkEntries(settings map[string]any) int` helper and a summary renderer over `ac.hooks` (event, matcher, state per line; replaced/removed counts; preservation note); branch `applyAgentHooks` on `cons.dryRun` — full `renderArtifactDiff` on dry-run, summary otherwise, same `cons.diffWriter(sink)` writer <!-- R1, R4, R5 -->
- [x] T002 In `installTmuxShimFile` (`agent_setup.go`), branch on `cons.dryRun`: keep the full diff on dry-run; otherwise render one summary line (fresh install with computed script line count vs rk-owned update), path included <!-- R2, R4 -->
- [x] T003 In `applyTmuxGuardPathBlocks` (`agent_setup.go`), branch on `cons.dryRun`: keep the full diff on dry-run; otherwise render the 3-line marker block + target file + placement (append vs in-position replace, derived from whether the block exists in `current`), and the one-line removal form on uninstall <!-- R3, R4 -->

### Phase 2: Tests

- [x] T004 Update `app/backend/cmd/rk/agent_setup_test.go`: adjust any assertions relying on full-body output; add cases for the fresh-install hooks summary (entry lines present, `+++ proposed` absent), re-run replacement count, uninstall removal count, shim one-liner (script body absent), PATH-block excerpt (user content not echoed, block lines present), and `--dry-run` still emitting full bodies at all three sites; run `go test ./...` in `app/backend` <!-- R1, R2, R3, R4, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Interactive/`--yes` hooks-merge consent renders the per-entry semantic summary with preservation note; full JSON bodies no longer appear on those paths
- [x] A-002 R2: Interactive/`--yes` shim consent is a single summary line naming the path; the shim script body no longer appears on those paths
- [x] A-003 R3: Interactive/`--yes` PATH-block consent shows exactly the owned 3-line block + placement; user file contents are never echoed

### Behavioral Correctness

- [x] A-004 R1: Replacement and removal counts are computed from the actual current settings (verified by a test with pre-existing rk entries)
- [x] A-005 R4: `--dry-run` output at all three sites still contains the full `--- current` / `+++ proposed` bodies and writes nothing

### Scenario Coverage

- [x] A-006 R1: Tests cover fresh install, re-run replacement, and uninstall summary forms for the hooks merge
- [x] A-007 R5: `--yes --quiet` remains fully silent on success (existing net-effect test still passes unmodified or equivalent coverage exists)

### Edge Cases & Error Handling

- [x] A-008 R3: Placement wording is correct for both the append case and the in-position replace case
- [x] A-009 R5: Non-TTY refusal, marker-less skip notes, and no-op reports are byte-identical to today (no assertions on those paths needed changing except where they asserted full bodies)

### Code Quality

- [x] A-010 Pattern consistency: New rendering helpers follow the file's existing comment density and doc-comment style; output goes through `outputSink` channels per Toolkit Principle 9
- [x] A-011 No unnecessary duplication: `renderArtifactDiff` is reused for the dry-run path rather than duplicated; no new diff machinery introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `countRkEntries` test helper (`agent_setup_test.go`) — was a test-only duplicate of the count logic; the change moved it into production (`agent_setup.go`) and deleted the test copy, so the redundancy is already resolved within this change
- None otherwise — presentation-only change; all three `renderArtifactDiff` call sites remain live on the `--dry-run` path, so no existing symbol became unused

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shim update line ("will update the rk-owned tmux shim") carries no line count — only the fresh-install line does | The update case is rare (rk path change); the count matters for conveying bulk on first install | S:50 R:90 A:75 D:70 |
| 2 | Confident | The legacy rk-display cleanup and no-op/skip notes are untouched | Already one-line prompts; the backlog targets the three diff dumps only | S:60 R:90 A:85 D:75 |
| 3 | Certain | Summary output writes to `cons.diffWriter(sink)` exactly as the diff does today | R5 requires unchanged channel routing; the writer selection already encodes the `--yes`/interactive/dry-run split | S:80 R:90 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
