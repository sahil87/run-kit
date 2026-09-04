# Plan: Mux Help Groups + Messaging Topic Page (Agent-Messaging Part C)

**Change**: 260904-fvpu-mux-help-groups-messaging-topic
**Intake**: `intake.md`

## Requirements

### CLI: `rk mux -h` command grouping

#### R1: Three-group help presentation via native cobra groups
`rk mux -h` SHALL present the family's twelve members under three cobra command
groups — *Messaging* (`send`, `await`), *Pane mechanics* (`capture`, `kill`,
`process`, `panes`), *Server ops* (`new`, `adopt`, `reap`, `snapshot`,
`init-conf`, `guard`) — registered with `muxCmd.AddGroup` and per-command
`GroupID` in `app/backend/cmd/rk/mux.go`'s `init()`. Every one of the twelve
members MUST carry a `GroupID` so cobra renders no leftover "Additional
Commands" bucket. `GroupID` SHALL be stamped only on the **family-member
instances** (in `mux.go`), never inside the shared two-instance constructors
(`newReapCmd`/`newSnapshotCmd`/`newInitConfCmd`/`newTmuxGuardCmd`): the hidden
root aliases those constructors also produce have `rootCmd` as parent, which
registers none of these groups, and cobra panics at Execute on an undefined
group ID. Membership, names, flags, behavior, and the hidden root deprecation
aliases are unchanged — this is help rendering only.

- **GIVEN** `rk mux -h`
- **WHEN** the help renders
- **THEN** the three group headings appear with exactly the memberships above,
  no "Additional Commands" section renders under `mux`
- **AND** `rk reaper --yes`, `rk snapshot list`, `rk init-conf`, and
  `rk tmux-guard` still execute without panic (root aliases carry no GroupID)

#### R2: Family prose stays coherent with the grouped rendering
The `mux.go` family comment block and `muxCmd` `Short`/`Long` SHOULD be checked
against the three-group presentation and reworded only where they now
contradict it (e.g. "Twelve members in two tiers" narration vs. the rendered
three groups). No content beyond coherence edits.

- **GIVEN** the grouped help ships
- **WHEN** a reader compares `rk mux -h` output with `muxCmd.Long` and the
  file-top comment
- **THEN** the prose does not contradict the grouping (tier language updated or
  reconciled)

### Skill bundle: `rk skill messaging` topic page

#### R3: New messaging topic page teaching the channel matrix and readiness standard
A new canonical topic page `docs/site/skill/messaging.md` SHALL exist —
static-only, ≤150 lines, opening with the standard `command -v rk` gate block —
teaching, per `docs/specs/agent-messaging.md`:

1. **The channel matrix**: write → `rk mux send` (plain / `--answer` /
   `--force` / `--no-enter` / `--key` / stdin `-`); read-screen →
   `rk mux capture` (the only screen truth for alt-screen TUIs); read-state →
   `rk mux await` / `rk mux panes` / `rk mux process`; read-results →
   **artifact files** the worker is told to write (alt-screen agents have zero
   scrollback — artifact-first is a consequence, not a preference); wait →
   `rk mux await` (`--until` / `--any` / `--file` / `--ready`) and composed
   `send --await`; multi-turn cross-provider conversation → an MCP bridge, not
   pane-driving.
2. **The readiness standard** (the parked verdict from Part B): the
   spawn-then-deliver composite (open bare → classify → answer → verified
   deliver); classification outcomes `ready %N (state)` (state-present,
   touch-nothing, preferred), `ready %N (echo)` (sentinel echoed at a live
   input box), `parked %N` (exit 0, screen snippet on stderr — a wall: trust
   dialog, survey, theme picker, login); `booting` never returns — the await
   blocks through boot churn and ends only on `ready`, `parked`, `gone`, or
   timeout (`running`).
3. **The scope rule**: the sentinel is typed only into pre-delivery panes (no
   agent state, nothing yet delivered); against a live delivered worker
   readiness verbs are illegal — use `await --until` / `capture`.
4. **The judgment split**: classification is mechanical and rk-owned; what a
   `parked` wall wants is the caller's judgment, answered via the standard
   write channel (`rk mux send --key Enter`, `--key Down`, …);
   login/credential walls escalate to a human — rk never auto-answers. The
   hook-less pairing stays `rk mux await --ready %5 && rk mux send --force %5
   '<prompt>'` (branch on the report word — `parked` also exits 0).

The page SHALL cross-link `rk skill mux` for verb-reference depth (flags,
gates, report words, gotchas) instead of duplicating it.

- **GIVEN** `rk skill messaging`
- **WHEN** an agent reads the page
- **THEN** it can select the right channel for each need and interpret every
  `--ready` report word without opening the spec repo
- **AND** the page is ≤150 lines and contains no live/session-derived values

#### R4: Topic wiring follows the established embed pattern
`rk skill messaging` SHALL print the page byte-identically (stdout is data,
empty stderr, exit 0), backed by the established mechanism: a
`sync "docs/site/skill/messaging.md" "$DEST_DIR/messaging.md"` row in
`scripts/sync-skill.sh`, a `//go:embed skill/messaging.md` var and
`skillTopics["messaging"]` row in `app/backend/cmd/rk/skill.go`, and the
committed synced copy `app/backend/cmd/rk/skill/messaging.md`. The `Topics:`
help line, `rk skill topics` enumeration, and unknown-topic error derive from
the map and SHALL pick the new topic up without further edits. The core bundle
`docs/site/skill.md` `## Topics` index SHALL gain a messaging line (with the
mux line reworded so the two entries are distinct: mux = driving panes /
verb reference, messaging = choosing the channel / readiness standard), and
the synced core-bundle copy SHALL be regenerated.

- **GIVEN** the wiring lands
- **WHEN** `rk skill messaging`, `rk skill topics`, and `rk skill bogus` run
- **THEN** the page prints byte-identical to canonical, `messaging` appears in
  the sorted topics list, and the unknown-topic error names it among valid
  topics

### Tests

#### R5: Skill tests cover the fifth topic; help tests cover the grouping
The three table-driven skill tests (`TestSkillTopicsPrintByteIdentical`,
`TestSkillTopicsMatchCanonical`, `TestSkillTopicsWithinLineBudget` in
`app/backend/cmd/rk/skill_test.go`) SHALL each gain a `messaging` row. Help
coverage SHALL assert the grouped presentation: the mux node's captured help
text (`UsageString`) contains the three group headings, and no "Additional
Commands" heading renders under `mux` (all twelve grouped). The existing
help-dump structural assertions (exactly 12 mux members, snapshot's 3
children, hidden-alias exclusion) are unchanged and MUST keep passing.

- **GIVEN** `go test ./cmd/rk/...` in `app/backend`
- **WHEN** the suite runs
- **THEN** the new messaging rows and group assertions pass alongside the
  untouched 12-member help-dump assertions

### Standards

#### R6: Toolkit standards audit over the touched surfaces
Per constitution § Toolkit Standards and the spec's execution-plan note, the
change SHALL be audited against the governing standards before ship:
`shll standards help-dump` (tree shape unchanged; text changes stay
conformant), `shll standards skill` (fifth topic page: static-only,
stdout-is-data, line budget, topic enumeration), `shll standards
readme-extraction` (new file in the `docs/site/` tree), and `shll standards
principles`. Findings are fixed in this change or recorded explicitly.

- **GIVEN** the HEAD build of this branch
- **WHEN** the four standards are read and checked against the changed
  surfaces
- **THEN** each is PASS, or a deviation is fixed/recorded

### Non-Goals

- No renames or behavior changes to any `rk mux` member (spec non-goal); no
  new flags, no gate changes.
- No `rk msg` family, no root-level elevation of `send`/`await` (rejected by
  the spec, not reopened).
- No edit to `docs/specs/agent-messaging.md` — the spec stays the target
  shape; shipped state lands in memory at hydrate.
- No grouping of other command families (`rk tab`, `rk daemon`, …) — mux only.

### Design Decisions

#### GroupID stamped on family instances in mux.go, never in constructors
**Decision**: The three `cobra.Group`s and all twelve `GroupID` assignments
live in `mux.go`'s `init()`; the two-instance constructors are untouched.
**Why**: The constructors also produce hidden root aliases parented to
`rootCmd`, which registers none of these groups — cobra panics at Execute on a
`GroupID` not defined on the parent. Stamping at the family seam also keeps
the whole grouping readable in one place.
**Rejected**: `GroupID` inside each constructor (panics the root aliases);
per-file stamping at each command literal (scatters a single presentation
decision across nine files).
*Introduced by*: 260904-fvpu-mux-help-groups-messaging-topic

#### Group heading strings are "Messaging:", "Pane mechanics:", "Server ops:"
**Decision**: Sentence-case titles with cobra's conventional trailing colon;
group IDs `messaging` / `mechanics` / `serverops`.
**Why**: The spec names the groups as lowercase concepts; cobra's rendered
headings conventionally read as `Title:` section labels (matching "Available
Commands:", "Flags:").
**Rejected**: all-lowercase headings (inconsistent with cobra's own section
labels); "Pane Mechanics:"-style title case (inconsistent with the toolkit's
sentence-case help style).
*Introduced by*: 260904-fvpu-mux-help-groups-messaging-topic

#### Messaging page teaches concepts and links the mux page for verb depth
**Decision**: `messaging.md` carries the channel matrix, readiness standard,
scope rule, and judgment split; it cross-links `rk skill mux` rather than
restating flag tables, gate matrices, or report-word contracts.
**Why**: Both pages are bounded at 150 lines; the mux page is at its cap and
already documents `parked` at verb-reference depth — duplication would drift.
**Rejected**: folding the matrix into the mux page (over budget); duplicating
the verb reference in messaging.md (two copies to keep honest).
*Introduced by*: 260904-fvpu-mux-help-groups-messaging-topic

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add three `cobra.Group`s + twelve `GroupID` stamps in `app/backend/cmd/rk/mux.go` `init()`; reconcile the file-top family comment and `muxCmd.Short`/`Long` wording with the grouped rendering <!-- R1, R2 -->
- [x] T002 [P] Write `docs/site/skill/messaging.md` (≤150 lines): gate block, channel matrix, readiness standard (`ready (state)`/`ready (echo)`/`parked`), scope rule, judgment split, hook-less pairing, cross-link to `rk skill mux` <!-- R3 -->
- [x] T003 Wire the topic: `scripts/sync-skill.sh` row; `//go:embed` var + `skillTopics` row in `app/backend/cmd/rk/skill.go`; run the sync (creates `app/backend/cmd/rk/skill/messaging.md`); add the messaging line to `docs/site/skill.md` `## Topics` (reword the mux line for contrast) and re-sync the core copy <!-- R4 -->

### Phase 2: Tests & Audit

- [x] T004 Tests: add `messaging` rows to the three table-driven skill tests in `app/backend/cmd/rk/skill_test.go`; add mux-help group assertions (three headings present, no "Additional Commands") near the help-dump mux coverage in `app/backend/cmd/rk/help_dump_test.go`; run `go test ./cmd/rk/...` <!-- R5 -->
- [x] T005 Standards audit: read `shll standards help-dump|skill|readme-extraction|principles`, check each against the changed surfaces on the HEAD build, fix or record findings; then run the wider `go test ./...` gate in `app/backend` <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux -h` renders Messaging (send, await), Pane mechanics (capture, kill, process, panes), and Server ops (new, adopt, reap, snapshot, init-conf, guard) group headings, with no "Additional Commands" bucket
- [x] A-002 R3: `docs/site/skill/messaging.md` exists, ≤150 lines, opens with the rk gate block, and teaches the channel matrix, the three readiness verdicts, the pre-delivery scope rule, and the caller-side judgment split
- [x] A-003 R4: `rk skill messaging` prints the page byte-identically; `rk skill topics` lists `messaging`; the core bundle's `## Topics` index points at it

### Behavioral Correctness

- [x] A-004 R1: hidden root aliases (`reaper`, `snapshot`, `init-conf`, `tmux-guard`) execute without panic — no `GroupID` rides the root-alias instances
- [x] A-005 R2: `muxCmd` prose (file comment, Short/Long) does not contradict the three-group presentation

### Scenario Coverage

- [x] A-006 R5: skill test tables each carry a `messaging` row (byte-identical, canonical drift, line budget) and pass
- [x] A-007 R5: a test asserts the mux help text contains the three group headings and no "Additional Commands"; the existing 12-member help-dump assertions still pass

### Edge Cases & Error Handling

- [x] A-008 R4: `rk skill <unknown>` error names `messaging` among valid topics (derived, verified by existing unknown-topic test still passing)

### Standards & Docs

- [x] A-009 R6: standards audit run over help-dump, skill, readme-extraction, principles — each PASS or the deviation fixed/recorded

### Code Quality

- [x] A-010 Pattern consistency: grouping and topic wiring follow the existing file/idiom patterns (mux.go init registration, two-instance constructor left untouched, embed + drift-guard pattern)
- [x] A-011 No unnecessary duplication: messaging.md links the mux page for verb depth instead of restating it; no copied gate/flag tables
- [x] A-012 Comment discipline: new/edited comments state constraints only (e.g. the root-alias panic constraint), no narration or change-ID citations in code

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Ship-time: branch carries r7uk cherry-pick `5573ac67`; once PR #835 merges, rebase onto main so it drops out (do not revert r7uk content here)
- Standards audit record (2026-09-04, HEAD build): **help-dump PASS** (envelope/filter rules untouched; mux node text carries the three group headings, no "Additional Commands", 12 members — verified via `rk help-dump` JSON); **skill PASS** (messaging.md canonical at docs/site/skill/messaging.md, 74/150 lines, static-only, sync + drift-guard, core-bundle topic index, `Topics:` help line + `skill topics` enumeration derive from the map, unknown-topic error names it); **readme-extraction PASS** (the one relative link `mux.md` stays inside docs/site/, no images, `messaging` not a reserved slug); **principles PASS** (no new commands/flags/prompts; P3 layered help improved by grouping, exit-code conventions untouched)

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | GroupIDs stamped only on family instances in mux.go init() | Verified in-repo: the two-instance constructors also build root aliases whose parent registers no groups — cobra panics on undefined GroupID | S:85 R:90 A:95 D:90 |
| 2 | Confident | Group IDs `messaging`/`mechanics`/`serverops`, headings `Messaging:`/`Pane mechanics:`/`Server ops:` | Cobra heading idiom; exact strings are presentation, trivially reversible | S:70 R:95 A:80 D:70 |
| 3 | Confident | Help grouping coverage lives beside the existing help-dump mux assertions (text-contains checks), not a full help-text golden file | A golden file would churn on every unrelated flag edit; contains-assertions pin exactly the grouped contract | S:70 R:90 A:85 D:75 |
| 4 | Certain | Core-bundle `## Topics` mux line reworded for contrast with the new messaging line | Two adjacent entries both saying "messaging" would misroute readers; the index is the only place both appear | S:80 R:95 A:90 D:85 |

4 assumptions (2 certain, 2 confident).
