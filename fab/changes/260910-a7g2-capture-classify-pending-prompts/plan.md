# Plan: Capture Classify — Pending-Prompt Detection on Uninstrumented Panes

**Change**: 260910-a7g2-capture-classify-pending-prompts
**Intake**: `intake.md`

## Requirements

### run-kit: Pending-prompt classifier (`internal/promptscan`)

#### R1: Pure-text classification with fab-parity names
A new package `app/backend/internal/promptscan` SHALL expose `Scan(content string) Result` where `Result{Indicator, Snippet, Reason string}`. `Scan` MUST have no tmux, exec, or I/O dependency. Indicator names MUST be exactly `question_mark`, `yes_no`, `action_word`, `imperative_question`, `colon_prompt`, `enumerated_options`, `press_key`, and `none`; reasons MUST be exactly `blank_capture`, `turn_boundary`, `no_indicator`. Guards run first, in order: empty/all-whitespace content → `none`/`blank_capture`; either of the last two lines matching `^\s*>\s*$` → `none`/`turn_boundary`. Otherwise non-empty lines are walked bottom-most first: class 1 (`question_mark` — line ends in `?`, `< 120` chars, does not start with `#`, `//`, `*`, `>`, no leading timestamp `^\s*[\[(]?\d{1,4}[-/:]\d{1,2}`) is tested against the actual last non-empty line only; classes 2–7 (`(?i)(\[y/n\]|\(y/n\)|\(yes/no\))`, `\b(Allow|Approve|Confirm|Proceed)\?`, `(?i)(Do you want to|Should I|Would you like)`, trailing `:` after trimming whitespace, `[1-9]\)`, `(?i)(Press.*key|press.*enter|hit.*enter)`) are tested against every line in that order. The first matching line wins; `Snippet` is that line verbatim. No match → `none`/`no_indicator`. A single trailing empty element produced by a terminating `\n` is dropped before scanning; nothing else is trimmed.

- **GIVEN** content `"Allow?\n1) yes  2) no"`
- **WHEN** `Scan` runs
- **THEN** `Indicator` is `enumerated_options` and `Snippet` is `"1) yes  2) no"` (bottom-most line wins over the earlier `Allow?`)

- **GIVEN** content `"output\n > \ntrailing"`
- **WHEN** `Scan` runs
- **THEN** `Indicator` is `none` and `Reason` is `turn_boundary`

- **GIVEN** content `"Continue [Y/n]?"`
- **WHEN** `Scan` runs
- **THEN** `Indicator` is `question_mark` (class 1 is tested before classes 2–7 on the last line)

### run-kit: `rk mux capture --classify`

#### R2: Flag semantics
`rk mux capture` SHALL accept a `--classify` bool flag (no shorthand). It MUST be mutually exclusive with `--raw` via `MarkFlagsMutuallyExclusive` (usage error, exit 2). It SHALL classify exactly the text returned by the capture for the requested `--lines` window; there is no separate classification depth. It MUST NOT gate on the pane's agent state — any resolvable pane classifies, including `active` and uninstrumented panes. Exit codes are unchanged: 0 whether or not a prompt is found, 1 on capture/tmux failure, 2 on usage error.

- **GIVEN** `rk mux capture %5 --classify --raw`
- **WHEN** it runs
- **THEN** exit is 2 and no capture is performed

- **GIVEN** an `active` pane whose last line is `Proceed? [Y/n]`
- **WHEN** `rk mux capture %5 --classify` runs
- **THEN** the classification reports `yes_no` (or `question_mark` per R1's last-line rule) and exit is 0

#### R3: `--json` carries an opt-in `questions` object
With `--classify --json`, the output object SHALL carry a `questions` key after `agent_state_duration`, with exactly three keys: `indicator` (string), `snippet` (string; `""` when `indicator` is `none`), `reason` (string when `indicator` is `none`, otherwise JSON `null`). Without `--classify`, the `questions` key MUST be absent and the existing six-key output MUST be byte-identical to today's.

- **GIVEN** a pane whose capture ends in `Overwrite file [y/N]`
- **WHEN** `rk mux capture %5 --json --classify` runs
- **THEN** the output contains `"questions": {"indicator": "yes_no", "snippet": "Overwrite file [y/N]", "reason": null}` (two-space indented)

- **GIVEN** a blank capture
- **WHEN** `rk mux capture %5 --json --classify` runs
- **THEN** `questions` is `{"indicator": "none", "snippet": "", "reason": "blank_capture"}`

- **GIVEN** `rk mux capture %5 --json` (no `--classify`)
- **WHEN** it runs
- **THEN** the output has no `questions` key

#### R4: Human output carries a `question:` header line
With `--classify` and neither `--json` nor `--raw`, the header block SHALL contain exactly one line beginning `question: ` placed after the context line (or directly after `--- pane %N ---` when the context line is omitted) and before the closing `---`. On a match the line is `question: {indicator} — {snippet}`; on none it is `question: none ({reason})`. The line is present under `--classify` even when the context line is omitted.

- **GIVEN** an uninstrumented pane with empty cwd whose capture ends in `Enter your name:`
- **WHEN** `rk mux capture %5 --classify` runs
- **THEN** stdout is `--- pane %5 ---\nquestion: colon_prompt — Enter your name:\n---\n<content>`

### run-kit: Documentation

#### R5: Skill topic page documents the flag
`docs/site/skill/mux.md` § `rk mux capture` SHALL gain a `--classify` example line and a paragraph describing: the seven indicator classes and the `none` reasons, the `questions` JSON object, the `question:` human line, the `--raw` exclusivity, that rk never answers a detected prompt, and the pairing with `rk mux send --answer` / `--key` for a caller that chooses to respond. The embedded copy `app/backend/cmd/rk/skill/mux.md` MUST be regenerated via `scripts/sync-skill.sh` so both files stay identical.

- **GIVEN** the edited site page
- **WHEN** `scripts/sync-skill.sh` runs
- **THEN** `diff docs/site/skill/mux.md app/backend/cmd/rk/skill/mux.md` is empty

### Non-Goals
- No classification on `rk mux panes` — the operator sweeps a candidate subset via capture.
- No new indicator classes or harness-specific turn-boundary guards — parity with fab's set so both copies agree during the delegation window.
- No agent-state gate, auto-answer, or notification — policy is fab-operator's.
- The fab-kit delegation (`fab pane questions` rk-first with silent fallback) is a separate fab-kit change; rk ships first.
- The MCP `capture` tool (spec-only, not implemented) is untouched.

### Design Decisions

#### Prompt classification is substrate, prompt policy is fab's
**Decision**: rk classifies any resolvable pane's screen text on request and reports `{indicator, snippet}` or `none` + reason; which panes to sweep, what to answer, and when to escalate stay in fab-operator.
**Why**: cli-layering rule 1 — rk owns pane reads (capture, reconciled state, readiness); fab owns choreography. A state gate in rk would bake operator policy into a substrate verb and diverge from `rk mux capture`'s "read anything" contract.
**Rejected**: filtering to `waiting`/`idle` inside rk (duplicates fab's candidate policy and blocks the dashboard from classifying an `active` hook-less pane); a new `rk mux questions` verb (a second capture with its own flags for one extra field).
*Introduced by*: 260910-a7g2-capture-classify-pending-prompts

#### `questions` is opt-in and fixed-shape
**Decision**: the JSON key appears only under `--classify` and always carries the three keys `indicator`/`snippet`/`reason`.
**Why**: keeps the existing six-key shape byte-identical for current consumers; a fixed shape lets fab map fields structurally without probing for presence.
**Rejected**: always emitting `questions` (silent shape change for every `--json` caller); omitting `snippet`/`reason` when empty (variable schema).
*Introduced by*: 260910-a7g2-capture-classify-pending-prompts

#### Classifier is a pure package, names ported verbatim
**Decision**: `internal/promptscan` is pure text → `Result`; class/reason identifiers match `fab pane questions` exactly.
**Why**: a pure package is unit-testable without tmux fakes and reusable by future rk consumers; identical names make fab's rk-first mapping a pass-through.
**Rejected**: placing the scanner in `internal/tmux` (not a tmux wrapper) or `internal/inject` (the write engine); renaming classes to rk vocabulary (forces a translation table in fab).
*Introduced by*: 260910-a7g2-capture-classify-pending-prompts

## Tasks

### Phase 1: Core Implementation

- [x] T001 Create `app/backend/internal/promptscan/scan.go` (constants, `Result`, `Scan`, guards, class matchers ported from fab's `pane_questions.go`) and `app/backend/internal/promptscan/scan_test.go` (table tests for every class, the last-line-only rule, the 120-char/comment-prefix/timestamp exclusions, bottom-most-first tie-breaking, both guard reasons, `no_indicator`, trailing-newline tolerance) <!-- R1 -->
- [x] T002 Extend `app/backend/cmd/rk/mux_capture.go`: `--classify` flag + `MarkFlagsMutuallyExclusive("classify", "raw")`, `muxCaptureQuestions` struct and `omitempty` pointer field on `muxCaptureJSON`, `question:` header line in human output, `Long`/`Example` help text <!-- R2, R3, R4 -->

### Phase 2: Integration & Edge Cases

- [x] T003 Add cases to `app/backend/cmd/rk/mux_capture_test.go`: `--json --classify` matched and `none` shapes, `--json` without `--classify` has no `questions` key, human `question:` line with and without a context line, `--classify --raw` is exit 2 with no capture, `active` pane still classifies <!-- R2, R3, R4 -->

### Phase 3: Polish

- [x] T004 Update `docs/site/skill/mux.md` § `rk mux capture` (example line + classify paragraph) and run `scripts/sync-skill.sh` to regenerate `app/backend/cmd/rk/skill/mux.md`; verify `rk mux capture --help` lists the flag <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `promptscan.Scan` exists with the specified `Result` shape and constant names, and has no tmux/exec imports
- [x] A-002 R2: `rk mux capture --classify` is accepted, exclusive with `--raw`, and applies no agent-state gate
- [x] A-003 R3: `--json --classify` emits the fixed three-key `questions` object; plain `--json` output is unchanged
- [x] A-004 R4: human output under `--classify` carries exactly one `question:` line in the documented position
- [x] A-005 R5: `docs/site/skill/mux.md` documents the flag and `app/backend/cmd/rk/skill/mux.md` is identical after sync

### Behavioral Correctness

- [x] A-006 R1: guards precede classes (blank → `blank_capture`, bare `>` in last two lines → `turn_boundary`) and the bottom-most matching line wins
- [x] A-007 R2: exit code is 0 on `none`, 1 on capture failure, 2 on `--classify --raw`

### Scenario Coverage

- [x] A-008 R1: unit tests cover every indicator class, the last-line-only `question_mark` rule, the `Continue [Y/n]?` class-1-first case, and the `Allow?` / `1) yes 2) no` bottom-most case
- [x] A-009 R3: capture tests assert the exact `--json --classify` string for a matched and a `none` capture
- [x] A-010 R4: capture tests assert the `question:` line renders when the context line is omitted

### Edge Cases & Error Handling

- [x] A-011 R1: a 119-char `?` line matches and a 120-char one does not; `#`/`//`/`*`/`>`-prefixed and timestamp-prefixed `?` lines do not match class 1
- [x] A-012 R2: `--classify` on an `active` or uninstrumented pane classifies normally (no refusal)

### Code Quality

- [x] A-013 Pattern consistency: new code follows `mux_capture.go`'s seam/sink/usageError conventions and the `internal/` package layout
- [x] A-014 No unnecessary duplication: the scanner lives once in `promptscan`; `mux_capture.go` calls it rather than re-implementing matching
- [x] A-015 No magic strings: indicator/reason identifiers are named constants used by both the scanner and the capture verb
- [x] A-016 Tests accompany the change: `just test-backend` passes with the new promptscan and capture cases
- [x] A-017 Comments state constraints, not narration; no change IDs or PR numbers in code comments

### Security

- [x] A-018 R2: no new subprocess; classification is pure text over the existing `CapturePanePlainCtx` result under `muxCmdTimeout`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `docs/site/skill/mux.md` is the source and `app/backend/cmd/rk/skill/mux.md` the synced copy, regenerated by `scripts/sync-skill.sh` | The script's sync rows name site → embedded; the capture sections are currently identical | S:80 R:95 A:95 D:90 |
| 2 | Confident | The `question:` human line uses an em-dash separator (`question: yes_no — snippet`) matching the intake's rendering | Intake specified the form; purely presentational and trivially changed | S:70 R:95 A:85 D:70 |
| 3 | Confident | `questions` is a pointer field with `omitempty` so absence is structural, not a post-hoc key deletion | Simplest Go idiom for an opt-in JSON key; `encoding/json` handles it natively | S:65 R:90 A:90 D:80 |

3 assumptions (1 certain, 2 confident).
