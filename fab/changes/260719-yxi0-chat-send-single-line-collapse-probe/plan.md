# Plan: Chat-Send Long-Single-Line Paste-Collapse Probe Fix

**Change**: 260719-yxi0-chat-send-single-line-collapse-probe
**Intake**: `intake.md`

## Requirements

### run-kit/chat: Send-path novelty echo probe — collapse-chip counting

#### R1: Both paste-collapse chip forms match the placeholder regex
`pasteCollapseRe` MUST match BOTH the multiline chip form
`[Pasted text #N +M lines]` AND the suffix-less single-line chip form
`[Pasted text #N]` (against the whitespace-stripped capture), while still NOT
matching arbitrary bracketed text (`[some other note]`). The `+M lines` suffix
SHALL be optional; the singular/plural `line`/`lines` and any digit counts remain
tolerated.

- **GIVEN** a whitespace-stripped capture containing `[Pastedtext#7]`
- **WHEN** `pasteCollapseRe` is applied
- **THEN** it matches (one occurrence)
- **AND GIVEN** a capture containing `[Pastedtext#1+12lines]`, **THEN** it still
  matches
- **AND GIVEN** a capture containing `[someothernote]`, **THEN** it does not match.

#### R2: Placeholder counting is gated on `collapsible`, not `multiline`
`countProbeOccurrences` SHALL count the paste-collapse placeholder when — and only
when — the paste is `collapsible`: the text contains a newline OR its rune length
is at least `chatSendCollapseMinRunes`. A single-line send at or above the rune
threshold is collapsible; a short single-line send below it is not. The raw-needle
count and the strict-increase-over-baseline comparison in the caller are unchanged.

- **GIVEN** a suffix-less chip `[Pasted text #7]` in the capture and
  `collapsible=true`
- **WHEN** `countProbeOccurrences` runs
- **THEN** the chip is counted
- **AND GIVEN** the same capture with `collapsible=false`, **THEN** the chip is NOT
  counted
- **AND GIVEN** the multiline chip `[Pasted text #1 +12 lines]` with
  `collapsible=true`, **THEN** it is still counted.

#### R3: `injectChatMessage` derives `collapsible` from a named threshold constant
`injectChatMessage` SHALL replace the `multiline := strings.Contains(text, "\n")`
derivation with `collapsible := strings.Contains(text, "\n") || len([]rune(text))
>= chatSendCollapseMinRunes`, where `chatSendCollapseMinRunes` is a named
package-level constant set to `200` (a deliberate conservative lower bound; the
empirically observed threshold on Claude Code 2.1.215 is 801, width-independent).
The `collapsible` flag SHALL be threaded to `countProbeOccurrences` and
`probeChatEcho` in place of `multiline`.

- **GIVEN** a single-line message of 801 runes with no newline
- **WHEN** `injectChatMessage` derives the flag
- **THEN** `collapsible` is true (rune length ≥ 200), so a fresh `[Pasted text #N]`
  chip in the post-paste capture satisfies the probe and Enter is sent
- **AND GIVEN** a single-line message of 11 runes, **THEN** `collapsible` is false.

#### R4: `probeChatEcho` / `countProbeOccurrences` parameter renamed to `collapsible`
The threaded boolean parameter in `probeChatEcho` and `countProbeOccurrences` SHALL
be named `collapsible` (not `multiline`), and their doc comments plus
`pasteCollapseRe`'s and `injectChatMessage`'s doc comments SHALL be updated to state
the two chip forms and the empirical collapse facts (>800 chars, CC 2.1.215,
width-independent), and to describe the parameter's new meaning ("the TUI may have
collapsed this paste into a chip, so the chip is a valid fresh-echo signal"). The
NOVELTY baseline strict-increase soundness argument is unchanged.

- **GIVEN** the renamed functions
- **WHEN** the code is read/compiled
- **THEN** no `multiline` identifier remains in these signatures and all call sites
  pass `collapsible`; the code compiles and the doc comments reflect the new
  semantics.

### Non-Goals

- Re-verifying collapse behavior for other providers (codex/gemini) — `claude` is
  the only registered send adapter in v1; the provider-agnostic seam is unchanged.
- Changing the API shape, the frontend, or the tmux layer — none are touched.
- Keying the gate to the exact observed threshold 801 — a conservative lower bound
  (200) is intentional so an upstream threshold reduction cannot silently rebreak
  long single-line sends.

### Design Decisions

#### Widen the gate to `collapsible`, keep the NOVELTY baseline
**Decision**: Count the paste-collapse chip whenever the paste is `collapsible`
(newline OR ≥200 runes) and make the `+M lines` suffix optional in the regex.
**Why**: A single-line paste over 800 chars collapses into a suffix-less chip, so
its raw needle never echoes and the probe always 409s. The strict-increase-over-
baseline design already absorbs a stale chip (it is in the pre-paste floor), so
soundness is independent of the multiline property — widening WHEN the chip counts
is safe.
**Rejected**: Counting the chip unconditionally for all sends (needlessly widens the
concurrent-fresh-chip false-positive window to short interactive sends that never
collapse); keying the gate to the exact 801 threshold (brittle to upstream
changes).
*Introduced by*: `260719-yxi0-chat-send-single-line-collapse-probe`

## Tasks

### Phase 2: Core Implementation

- [x] T001 Make the `+M lines` suffix optional in `pasteCollapseRe` (`\[Pastedtext#\d+(?:\+\d+lines?)?\]`) in `app/backend/api/chat.go`, and update its doc comment to describe both chip forms (`[Pasted text #N +M lines]` multiline, suffix-less `[Pasted text #N]` single-line) plus the empirical collapse facts (>800 chars, CC 2.1.215, width-independent) <!-- R1 -->
- [x] T002 Add the named constant `const chatSendCollapseMinRunes = 200` with a doc comment (observed threshold 801 on CC 2.1.215, 200 a deliberate conservative lower bound) in `app/backend/api/chat.go` <!-- R3 -->
- [x] T003 In `injectChatMessage` (`app/backend/api/chat.go`) replace the `multiline` derivation with `collapsible := strings.Contains(text, "\n") || len([]rune(text)) >= chatSendCollapseMinRunes`, update the surrounding doc comment, and pass `collapsible` to `countProbeOccurrences` and `probeChatEcho` <!-- R3 -->
- [x] T004 Rename the threaded parameter `multiline` → `collapsible` in `probeChatEcho` and `countProbeOccurrences` (`app/backend/api/chat.go`) and update their doc comments to the new semantics ("the TUI may have collapsed this paste into a chip") <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 In `app/backend/api/chat_send_test.go`, extend `TestCountProbeOccurrences` (rename its `multiline` field to `collapsible`) with cases: suffix-less chip counted when collapsible, suffix-less chip NOT counted when not collapsible, multiline chip still counted; keep the existing non-placeholder-bracketed-text case <!-- R1 R2 -->
- [x] T006 Add a handler-level test in `app/backend/api/chat_send_test.go` (mid-file, adjacent to `TestChatSendMultilinePlaceholderNovelty`): a >800-char single-line send whose baseline lacks `[Pasted text #1]` and whose post-paste capture contains it succeeds (200, Enter sent); a companion assertion that a stale suffix-less chip already in the baseline with no fresh occurrence → 409, Enter withheld <!-- R2 R3 -->

## Execution Order

- T001–T004 (chat.go) precede T005–T006 (tests reference the renamed field/constant and new behavior).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `pasteCollapseRe` matches both `[Pasted text #N +M lines]` and suffix-less `[Pasted text #N]` (whitespace-stripped) and rejects arbitrary bracketed text.
- [x] A-002 R2: `countProbeOccurrences` counts the placeholder iff `collapsible` is true (both chip forms), and never when `collapsible` is false.
- [x] A-003 R3: `chatSendCollapseMinRunes = 200` exists as a named constant and `injectChatMessage` derives `collapsible` from newline OR the rune-length threshold.
- [x] A-004 R4: `probeChatEcho` and `countProbeOccurrences` take a `collapsible` parameter (no `multiline` identifier remains) with updated doc comments.

### Behavioral Correctness

- [x] A-005 R3: A >800-char single-line send whose post-paste capture shows only `[Pasted text #1]` (absent from baseline) returns 200 and sends Enter — the previously-deterministic 409 is fixed.
- [x] A-006 R2: A short single-line send (< 200 runes) whose raw needle does not echo does NOT ride a chip — it remains a 409 when no fresh needle occurrence appears.

### Scenario Coverage

- [x] A-007 R2: `TestCountProbeOccurrences` covers suffix-less-counted-when-collapsible, suffix-less-not-counted-when-not, and multiline-still-counted.
- [x] A-008 R3: A handler-level test exercises the long-single-line success path (200, Enter) and the stale-suffix-less-chip 409 (Enter withheld).

### Edge Cases & Error Handling

- [x] A-009 R2: The NOVELTY baseline strict-increase remains the sole soundness guard — a stale chip already in the pre-paste baseline does not false-pass the probe.

### Code Quality

- [x] A-010 Pattern consistency: New code follows the surrounding naming (named constant per the anti-magic-number rule), doc-comment style, and test-seam conventions (`mockTmuxOps`/`chatSessions`/`sendReq`/`fastChatSendProbe`).
- [x] A-011 No unnecessary duplication: The fix extends the existing placeholder-counting mechanism rather than adding a parallel path; the new tests reuse existing fixtures/helpers.
- [x] A-012 Magic numbers: The collapse threshold is a named constant (`chatSendCollapseMinRunes`), not an inline literal.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Merge-overlap: sibling branch `260719-t9uk` appends at EOF of both files; new tests here are inserted mid-file to reduce conflicts.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (it widens an existing gate and regex in place; the sole superseded artifact — the old "malformed chip not counted" unit case, whose input is now a genuine chip form — was already replaced within this change's own diff).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = optional-suffix regex + widen the gate from `multiline` to `collapsible`; NOVELTY baseline keeps chip-counting sound | Directly specified by the intake's What Changes and empirically grounded; strict-increase absorbs stale chips independent of the multiline property | S:95 R:90 A:95 D:95 |
| 2 | Confident | `chatSendCollapseMinRunes = 200` (conservative lower bound, not the observed 801) | Intake-specified value; robust to upstream threshold reductions while keeping short interactive sends on exact-needle matching | S:75 R:90 A:85 D:70 |
| 3 | Certain | Rename the threaded param `multiline` → `collapsible` in both functions and the test struct field | Semantics changed (no longer tests for newlines); keeping the old name would lie — code-quality naming rule | S:85 R:95 A:95 D:90 |
| 4 | Confident | Handler test placed adjacent to `TestChatSendMultilinePlaceholderNovelty` (mid-file), not at EOF | Intake mandates mid-file insertion to reduce conflicts with sibling branch t9uk which appends at EOF | S:80 R:90 A:85 D:80 |

4 assumptions (2 certain, 2 confident, 0 tentative).
