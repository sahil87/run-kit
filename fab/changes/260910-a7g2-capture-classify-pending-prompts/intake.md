# Intake: Capture Classify — Pending-Prompt Detection on Uninstrumented Panes

**Change**: 260910-a7g2-capture-classify-pending-prompts
**Created**: 2026-09-10

## Origin

Backlog item `[a7g2]` (fab/backlog.md, 2026-09-10, tagged *fab-kit operator follow-up*), invoked one-shot via `/fab-new a7g2` with no prior discussion in this session:

> rk mux capture --classify: detect pending prompts on an UNINSTRUMENTED pane from its screen text (yes/no, [Y/n], numbered menus, permission dialogs, open questions) and report {indicator, snippet} or 'none'. fab-kit ships this as `fab pane questions --panes <ids>` (src/go/fab/cmd/fab/pane_questions.go: mechanical guards + indicator-pattern classes + skip reasons) because hook-less harnesses never flip @rk_pane_agent_state to waiting, so the operator's per-tick sweep needs a capture-scan fallback (fab-operator.md §5 Question Detection). It is substrate work living in fab: rk owns capture, the reconciled agent-state read, and the readiness sentinel probe, so the classifier belongs beside them. Port the pattern classes + skip-reason enum, expose `--classify` on capture (and a `questions` field in `--json`), then fab pane questions delegates rk-first with its own scan as the rk-absent fallback (the fab pane map delegation precedent). Lowest priority of the operator follow-ups; small.

Grounding read for this intake: `app/backend/cmd/rk/mux_capture.go` (the verb being extended), `~/code/sahil87/fab-kit/src/go/fab/cmd/fab/pane_questions.go` (the classifier being ported), `fab-operator.md` §5 Question Detection and `_cli-fab.md` § fab pane · questions (the consumer contract), `docs/memory/run-kit/agent-messaging.md` § `rk mux capture` (the current rk contract), and `docs/specs/cli-layering.md` § Delegation rules.

## Why

**The pain point.** The operator's per-tick question sweep relies on `@rk_pane_agent_state` flipping to `waiting` when an agent asks a question. That option is written by agent-harness hooks installed via `rk agent setup`. Hook-less harnesses (and any pane whose hooks are missing or stale) never write it, so a pane sitting on `Proceed? [Y/n]` or a numbered menu looks identical to an idle or unknown pane. fab-kit closed this gap with a capture-scan classifier — `fab pane questions` captures the last 20 lines of each candidate, applies two mechanical guards (blank capture, Claude turn-boundary `>` prompt), and scans bottom-most-first for seven indicator classes.

**Why it belongs in rk.** That classifier is substrate work sitting in the choreography layer. `docs/specs/cli-layering.md` rule 1 says each tool owns its layer and delegates for the other's facts: rk already owns pane capture (`rk mux capture`), the reconciled agent-state read (`tmux.PaneFactsCtx`), and the boot-readiness classification (`rk mux await --ready` → `ready`/`parked`/`narrow`). "Is this screen showing a pending prompt?" is the same kind of mechanical read of pane text as "is this screen parked behind a wall?" — it has no dependency on fab's `.status.yaml`, changes, or stages. Keeping the only copy in fab means two harness-agnostic pattern tables drift independently, and rk's own future consumers (the dashboard's attention overlay, the MCP `capture` tool, `rk mux send` refusals) would have to reimplement it.

**What happens if we don't.** Nothing breaks today — fab's copy works. The cost is structural: the classifier's patterns evolve as new harnesses show new prompt shapes, and every evolution lands in fab-kit only, while rk — the tool that actually reads panes for the dashboard — stays blind to pending prompts on uninstrumented panes.

**Why this approach.** Port the classifier as a pure-text function into rk, expose it as an opt-in `--classify` flag on the existing capture verb (no new verb — the toolkit's minimal-surface posture and the existing `--json`/`--raw` shape both fit an additive flag), and carry rk-first delegation on the fab side as a separate fab-kit change following the `fab pane map` → `rk mux panes --json` precedent (capability-probed, fail-open, silent fallback). Policy — which panes to sweep, what to answer, when to escalate — stays entirely in fab-operator; rk reports, it never decides.

## What Changes

### 1. New pure-text classifier package: `app/backend/internal/promptscan`

A small package with no tmux or exec dependency — it classifies a string. Ported from `pane_questions.go` with names kept identical so the fab delegation maps 1:1.

```go
package promptscan

// Indicator class names — stable identifiers shared with fab pane questions.
const (
    IndicatorQuestionMark       = "question_mark"
    IndicatorYesNo              = "yes_no"
    IndicatorActionWord         = "action_word"
    IndicatorImperativeQuestion = "imperative_question"
    IndicatorColonPrompt        = "colon_prompt"
    IndicatorEnumeratedOptions  = "enumerated_options"
    IndicatorPressKey           = "press_key"
    IndicatorNone               = "none"
)

// Skip reasons — why a capture classified as none.
const (
    ReasonBlankCapture = "blank_capture"
    ReasonTurnBoundary = "turn_boundary"
    ReasonNoIndicator  = "no_indicator"
)

type Result struct {
    Indicator string // one of the Indicator* constants
    Snippet   string // the matched line, verbatim; "" when Indicator == none
    Reason    string // one of the Reason* constants; "" when matched
}

// Scan classifies captured pane text: guards first (blank → turn boundary),
// then a bottom-most-first walk of non-empty lines testing class 1
// (question-mark ending) against the actual last line only and classes 2–7
// against every line. First (bottom-most) matching line wins; ties within a
// line resolve in class order.
func Scan(content string) Result
```

Patterns ported verbatim from fab (regexes and guard semantics unchanged in v1):

| Class | Rule |
|-------|------|
| `question_mark` | last non-empty line only; `< 120` chars; ends in `?`; not starting with `#`, `//`, `*`, `>`; no leading timestamp (`^\s*[\[(]?\d{1,4}[-/:]\d{1,2}`) |
| `yes_no` | `(?i)(\[y/n\]|\(y/n\)|\(yes/no\))` |
| `action_word` | `\b(Allow|Approve|Confirm|Proceed)\?` |
| `imperative_question` | `(?i)(Do you want to|Should I|Would you like)` |
| `colon_prompt` | line ends in `:` after trimming trailing whitespace |
| `enumerated_options` | `[1-9]\)` |
| `press_key` | `(?i)(Press.*key|press.*enter|hit.*enter)` |

Guards (evaluated before any class): `blank_capture` when the content is empty/all-whitespace; `turn_boundary` when either of the last two lines matches `^\s*>\s*$` (Claude Code's bare human-turn prompt — the screen is at a normal turn boundary, not a question). Trailing-newline handling mirrors fab's `nonEmptyTrailingSplit` (one trailing empty element from the terminating `\n` is dropped, nothing else).

Claude Code permission/tool-approval dialogs are NOT a separate class — as in fab, they are covered by `yes_no`/`action_word`/`imperative_question`/`enumerated_options`.

### 2. `rk mux capture --classify`

`app/backend/cmd/rk/mux_capture.go` gains a `--classify` bool flag (no shorthand).

- **Mutually exclusive with `--raw`** (`MarkFlagsMutuallyExclusive("classify", "raw")`) — `--raw` is contractually byte-identical to tmux's output and can carry no annotation. Combining them is a usage error (exit 2).
- **Composes with `--json`** and with the default human output.
- **Scans exactly the captured window** — whatever `--lines` selected (default 50). No separate classification depth; fab's delegation passes `--lines 20` to keep its published 20-line window.
- **No agent-state gating.** The verb classifies any resolvable pane, including `active` and unknown-state panes. Candidate selection (waiting first, then idle; skip active) is operator policy and stays in fab.
- **Exit code 0 on `none`.** Classification is a report, not a verdict — the same stance as `await --ready` reporting `parked`/`narrow` with exit 0. Exit 1 remains capture/tmux failure; exit 2 usage.

Cobra help (`Long`) gains one sentence, and the `Example` block gains `rk mux capture %5 --lines 20 --classify --json`.

### 3. `--json` shape: additive `questions` field

```json
{
  "pane": "%5",
  "lines": 20,
  "content": "...",
  "cwd": "/home/x/code/repo",
  "agent_state": null,
  "agent_state_duration": null,
  "questions": {
    "indicator": "yes_no",
    "snippet": "Proceed with the rewrite? [Y/n]",
    "reason": null
  }
}
```

- `questions` is present **only when `--classify` is given** (`*muxCaptureQuestions` with `omitempty`); without the flag the existing six-key shape is byte-for-byte unchanged.
- Fixed three-key object: `indicator` (string, one of the seven class names or `"none"`), `snippet` (string, the matched line verbatim; `""` when `none`), `reason` (string or `null`: one of `blank_capture`/`turn_boundary`/`no_indicator` when `none`, `null` when matched).

### 4. Human output: a `question:` header line

With `--classify`, one line is appended to the header block after the context line (or in its place when the context line is omitted), before the closing `---`:

```
--- pane %5 ---
cwd: /home/x/code/repo | agent: idle (5m)
question: yes_no — Proceed with the rewrite? [Y/n]
---
<content>
```

On no match: `question: none (turn_boundary)`. The line is always present under `--classify` (unlike the context line, which is omitted when empty) so a caller grepping for `^question:` always finds exactly one line.

### 5. Documentation and conformance surfaces

- `app/backend/cmd/rk/skill/mux.md` § `rk mux capture` — add the `--classify` example and a paragraph: what the classes mean, that `none` carries a reason, that rk never answers, and the pairing with `rk mux send --answer` / `--key` for the caller that decides to respond. `docs/site/skill/mux.md` is the same topic page published on shll.ai — update it the way the repo's existing sync convention for that file dictates (regenerate if generated, mirror the edit if hand-maintained).
- Help-dump: the new flag appears in `rk mux capture --help`; if the help-dump conformance test keeps a committed baseline, refresh it.

### 6. Tests

- `app/backend/internal/promptscan/scan_test.go` — port fab's `TestScanIndicators`, `TestHasTurnBoundary`, `TestIsBlankCapture` table cases (one case per class, the last-line-only rule for `question_mark`, the 120-char and comment-prefix and timestamp exclusions, bottom-most-first tie-breaking, both guard reasons, `no_indicator`).
- `app/backend/cmd/rk/mux_capture_test.go` — additions through the existing `muxCapturePaneFn`/`muxCaptureFactsFn` seams: `--json --classify` emits the `questions` object (matched and `none` variants); `--json` without `--classify` has no `questions` key; human `question:` line renders in both variants and is present even when the context line is omitted; `--classify --raw` exits 2.

### Non-goals (explicit)

- No classification on `rk mux panes` (would capture every pane per enumeration; the operator sweeps a candidate subset via capture).
- No new indicator classes or harness-specific turn-boundary guards beyond fab's current set — parity first, so the two copies agree during the delegation window.
- No agent-state gate, no auto-answer, no notification — policy is fab-operator's.
- The MCP `capture` tool row in `docs/specs/mcp.md` composes `mux capture <target> --json` with no `--classify`; the MCP server is not yet implemented, so nothing changes there. Whether the future tool exposes `classify` is that spec's call.
- **The fab-kit half is a separate change in the fab-kit repo**: `fab pane questions` delegating to `rk mux capture --lines 20 --classify --json` per candidate when `rk` is on PATH (any failure → silent fallback to its own scan, the `discoverPanesViaRK` pattern), mapping `questions.indicator`/`snippet`/`reason` onto its `matches[]`/`skipped[]` schema. This intake fixes the rk contract fab will consume; ship order is rk first.

## Affected Memory

- `run-kit/agent-messaging`: (modify) § Requirement `rk mux capture` — add `--classify` (raw-exclusive, scans the captured window, no state gate, exit 0 on none), the `questions` JSON object and its three keys, the human `question:` line, the seven indicator classes + three reasons; add a Design Decision "Prompt classification is substrate, prompt policy is fab's" (why rk classifies any pane regardless of state, why `--raw` stays unannotated, why the field is opt-in, why names are ported verbatim from fab) and a "Capture classify" scenario
- `run-kit/architecture`: (modify) backend library list gains `promptscan` (pure-text pending-prompt classifier consumed by `rk mux capture --classify`)
- `run-kit/toolkit-standards`: (modify) note the `--classify` flag under the help-dump/skill conformance sweep for the `mux` family, if that file enumerates per-verb flags (otherwise no change)

## Impact

**Code**
- `app/backend/internal/promptscan/scan.go`, `scan_test.go` (new, ~150 + ~150 lines)
- `app/backend/cmd/rk/mux_capture.go` — flag, exclusivity, `muxCaptureQuestions` struct, header line (~40 lines)
- `app/backend/cmd/rk/mux_capture_test.go` — new cases (~80 lines)
- `app/backend/cmd/rk/skill/mux.md`, `docs/site/skill/mux.md` — capture section

**Contracts**
- `rk mux capture` CLI: additive flag; existing outputs unchanged without it. `--json` gains one optional key. No API/HTTP/SSE/frontend change.
- Cross-repo: fab-kit `fab pane questions` becomes an rk-first consumer in a follow-up change there (this change is its prerequisite).

**Constitution touchpoints**
- I (Security First): no new subprocess — the classifier is pure text; capture keeps `CapturePanePlainCtx` under `muxCmdTimeout`.
- II (No Database): stateless read.
- X (Hooks carry only the underivable): this is the derivation side of that rule — the pending-question fact for hook-less panes is derived from the screen at request time instead of pushed.
- Toolkit Standards: CLI surface/help change → check against `shll standards` (help-dump, skill) before finalizing.

**Verification**: `just test-backend` (promptscan + cmd/rk); `just build`.

## Open Questions

- None blocking. The one judgment call worth a glance at review time: the `turn_boundary` guard is Claude-Code-specific (`>` prompt). Parity with fab is the v1 rule; a per-harness guard table is a later, joint fab/rk decision.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `--classify` is an opt-in bool flag on the existing `rk mux capture` verb, mutually exclusive with `--raw` (exit 2) | Backlog names the flag and the verb; `--raw`'s byte-identical contract (memory § capture) forbids annotation; `MarkFlagsMutuallyExclusive` is the existing pattern | S:85 R:90 A:90 D:90 |
| 2 | Certain | Indicator class names (`question_mark`, `yes_no`, `action_word`, `imperative_question`, `colon_prompt`, `enumerated_options`, `press_key`) and reasons (`blank_capture`, `turn_boundary`, `no_indicator`) are ported verbatim; `state_changed`/`capture_failed` are not (state is fab policy, capture failure is exit 1) | Backlog says "port the pattern classes + skip-reason enum"; identical names make fab's rk-first mapping a pass-through | S:80 R:70 A:90 D:85 |
| 3 | Certain | rk applies no agent-state gate — any resolvable pane classifies, even `active`/unknown | Candidate population is fab-operator §5 policy; cli-layering rule 1 keeps policy in fab and mechanics in rk | S:70 R:85 A:85 D:75 |
| 4 | Certain | Exit 0 whether or not a prompt is found; 1 for capture/tmux failure; 2 usage | Mirrors `await --ready`'s "parked/narrow exit 0 — a report, not a failure" stance documented in memory | S:75 R:90 A:95 D:90 |
| 5 | Certain | The fab-kit delegation (`fab pane questions` rk-first, silent fallback) is a separate fab-kit change; this change ships the rk contract only | Different repo; backlog names the `fab pane map` precedent which was likewise two changes; rk must ship first | S:85 R:80 A:90 D:85 |
| 6 | Confident | `--json` gains a `questions` object `{indicator, snippet, reason}` — fixed keys, `snippet` `""` and `reason` set when `none`, `reason` `null` when matched; the key is absent entirely without `--classify` | Backlog fixes the field name and "{indicator, snippet} or none"; fixed keys keep consumers schema-stable; opt-in presence keeps the existing six-key shape byte-identical | S:70 R:85 A:75 D:60 |
| 7 | Confident | Human output adds one always-present `question:` line in the header block (`question: yes_no — <snippet>` / `question: none (<reason>)`) | Backlog is silent on human form; the header block is the existing enrichment slot; always-present so `^question:` greps deterministically | S:60 R:90 A:80 D:65 |
| 8 | Confident | Classifier lives in a new pure package `app/backend/internal/promptscan` (no tmux/exec dependency) rather than inside `internal/tmux` or `internal/inject` | Backlog says "beside" capture/readiness; a pure-text package is the testable seam and neither existing package is about text classification; naming is a low-cost rename if review prefers otherwise | S:40 R:85 A:70 D:55 |
| 9 | Confident | Regexes and the Claude-only `>` turn-boundary guard port unchanged; no new harness-specific guards in v1 | Parity keeps fab's fallback and rk's primary agreeing during the delegation window; the backlog scopes this as small | S:60 R:85 A:70 D:60 |
| 10 | Confident | `--classify` scans the captured `--lines` window (default 50); no separate classification depth; fab passes `--lines 20` | One knob beats two; bottom-most-first scanning makes depth affect only how far up classes 2–7 reach | S:55 R:90 A:75 D:65 |
| 11 | Certain | Docs: `skill/mux.md` + `docs/site/skill/mux.md` capture section updated; help-dump baseline refreshed if one exists; memory files per Affected Memory | Constitution Toolkit Standards binds help/skill surfaces; both files already carry the capture examples | S:65 R:90 A:85 D:80 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
