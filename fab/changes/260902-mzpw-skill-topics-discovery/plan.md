# Plan: rk skill Topic Discovery Conformance

**Change**: 260902-mzpw-skill-topics-discovery
**Intake**: `intake.md`

## Requirements

### CLI: rk skill topic discovery

#### R1: Help text enumerates shipped content topics
The `skill` subcommand's long help SHALL carry a `Topics:` line naming every shipped content-topic page, composed from `skillTopicNames()` so the enumeration cannot go stale when a topic page is added. The reserved name `topics` SHALL NOT appear in this line.

- **GIVEN** the built `rk` binary with four shipped topic pages
- **WHEN** a caller runs `rk skill -h` (or `--help`)
- **THEN** the long help contains a line naming `code`, `display`, `mux`, and `tutorial`
- **AND** the line does not name `topics`

#### R2: Reserved positional topic `topics` enumerates content topics machine-readably
`rk skill topics` SHALL print the content-topic names one per line (sorted, matching `skillTopicNames()` order), raw to stdout with a trailing newline and no framing, with empty stderr and exit 0. The name `topics` is reserved: the `skillTopics` map SHALL NOT gain a `topics` key, no canonical `docs/site/skill/topics.md` is created, and the core bundle's `## Topics` index is not modified.

- **GIVEN** the built `rk` binary with four shipped topic pages
- **WHEN** a caller runs `rk skill topics`
- **THEN** stdout is exactly `code\ndisplay\nmux\ntutorial\n`, stderr is empty, and the exit code is 0

#### R3: Existing skill contract unchanged
Bare `rk skill`, each `rk skill <topic>` for a content topic, and the unknown-topic fail-fast path SHALL behave exactly as before: byte-identical bundle printing, and `rk skill <bogus>` exiting non-zero with an error naming the valid content topics (which exclude `topics`).

- **GIVEN** the built `rk` binary
- **WHEN** a caller runs `rk skill bogus`
- **THEN** the command exits non-zero with `unknown topic "bogus" (valid: code, display, mux, tutorial)` on stderr
- **AND** bare `rk skill` and `rk skill display` still print their embedded bundles byte-identically

### Non-Goals

- No `--list` flag — explicitly rejected by the `shll standards skill` document (the shll composer forwards positional args verbatim; a flag would be intercepted by the composer's flag parsing)
- No change to `docs/site/skill.md`, any `docs/site/skill/*.md` page, or `scripts/sync-skill.sh` — the reserved name is a code-only machine affordance with no canonical file

### Design Decisions

#### Compose the Topics: help line from skillTopicNames()
**Decision**: Append the `Topics:` line to `skillCmd.Long` by composing it from `skillTopicNames()` at package init, rather than hardcoding the names.
**Why**: The standard's format is illustrative, not prescribed; only the names must appear. Composition is static by construction (topic embeds are fixed at build time) and cannot go stale when a fifth topic page is added — the map row is the single point of truth.
**Rejected**: Hardcoding `Topics: code, display, mux, tutorial` — a future topic addition would need a second edit site and could silently violate the standard's "help text MUST enumerate the shipped topic names" mandate.
*Introduced by*: 260902-mzpw-skill-topics-discovery

#### Intercept the reserved name before the map lookup
**Decision**: Handle `args[0] == "topics"` in `RunE` before consulting `skillTopics`, printing `skillTopicNames()` joined with newlines plus a trailing newline.
**Rejected**: Adding a synthetic `topics` entry to the `skillTopics` map — the standard reserves the name outside the topic namespace (no canonical file, no line budget, excluded from indexes), and a map entry would leak it into `skillTopicNames()` and the error message.
**Why**: Keeps the reserved name out of the content-topic namespace entirely; `skillTopicNames()` and the unknown-topic error message stay correct with no filtering.
*Introduced by*: 260902-mzpw-skill-topics-discovery

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/cmd/rk/skill.go`, add the reserved-topic branch to `skillCmd.RunE`: when `args[0] == "topics"`, print `strings.Join(skillTopicNames(), "\n") + "\n"` to stdout and return nil, before the `skillTopics` map lookup <!-- R2 -->
- [x] T002 In `app/backend/cmd/rk/skill.go`, append a `Topics: ...` line to the `skill` command's long help composed from `skillTopicNames()` (e.g. set `Long` in an `init()` or compose via a helper if var-init ordering with the `skillTopics` composite literal is awkward), and mention the `topics` enumeration form in the prose <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T003 In `app/backend/cmd/rk/skill_test.go`, add tests: (a) `rk skill topics` via the `runSkill` seam → stdout exactly the sorted content-topic names one per line with trailing newline, stderr empty, err nil; (b) `skillCmd.Long` contains every name from `skillTopicNames()` and the `skillTopics` map has no `topics` key; (c) unknown-topic error message still lists exactly the content topics <!-- R2 -->
- [x] T004 Run the Go test gate for the package: `cd app/backend && go test ./cmd/rk/` — all existing skill tests (byte-identical, canonical drift, line budget, fail-fast) plus the new ones pass <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk skill --help` long output contains a `Topics:` line naming code, display, mux, and tutorial, and not naming `topics`
- [x] A-002 R2: `rk skill topics` prints exactly the four content-topic names, one per line, sorted, to stdout with empty stderr and exit 0

### Behavioral Correctness

- [x] A-003 R2: The `skillTopics` map carries no `topics` key; `skillTopicNames()` output and the unknown-topic error message are unchanged (content topics only)

### Scenario Coverage

- [x] A-004 R2: A test covers the `rk skill topics` output shape (exact bytes, stderr, error) via the existing `runSkill` test seam
- [x] A-005 R1: A test pins the help-line contract (every `skillTopicNames()` name appears in `skillCmd.Long`; no `topics` map key)

### Edge Cases & Error Handling

- [x] A-006 R3: `rk skill <bogus>` still fails fast non-zero naming the valid content topics; bare `rk skill` and every content topic still print byte-identically (existing tests remain green)

### Code Quality

- [x] A-007 Pattern consistency: New code follows the existing skill.go/skill_test.go patterns (runSkill seam, table-driven cases, comment style stating constraints not narration)
- [x] A-008 No unnecessary duplication: `skillTopicNames()` is the single source for both new affordances — no second sorted-name list
- [x] A-009 No comment provenance: no change-IDs, R#/T# references, or reviewer-addressed narration in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Trailing newline after the last topic name | "One per line" with raw-stdout convention; matches line-oriented consumption (`wc -l`, `while read`) and every other toolkit data output | S:80 R:95 A:90 D:85 |
| 2 | Confident | Help-line placement at the end of `Long`, prose mentioning `rk skill topics` | Standard prescribes only that the names appear in help text; end-of-Long matches cobra convention | S:75 R:95 A:85 D:80 |

2 assumptions (1 certain, 1 confident, 0 tentative).
