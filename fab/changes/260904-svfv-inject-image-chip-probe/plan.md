# Plan: Echo Probe Recognizes the `[Image #N]` Composer Chip

**Change**: 260904-svfv-inject-image-chip-probe
**Intake**: `intake.md`

## Requirements

### Inject Engine: Image-Chip Echo Signal

#### R1: Gated `[Image #N]` chip counts as a fresh echo signal
`CountOccurrences` SHALL count occurrences of the image-chip placeholder — pattern `\[Image#\d+\]` over the `stripForProbe`-normalized capture, declared as a package-level `imageCollapseRe` mirroring `pasteCollapseRe` — IN ADDITION to raw needle occurrences, but ONLY when the paste is *imageish* (R2). The strict-increase-over-baseline rule is unchanged: a stale chip already in the pre-paste baseline is a floor to beat, never a false positive. The chip arm is EITHER-signal: a fresh raw-needle occurrence still satisfies the probe on its own (the TUI leaves raw text when the file does not exist, and the engine cannot predict chip-vs-raw from text alone). The regex doc comment SHALL record the empirical basis (Claude Code 2.1.260, 2026-09-04: bare existing image path → chip at every length, beating the `[Pasted text #N]` collapse; nonexistent path → raw text) following the file's existing empirical-comment convention (`CollapseMinRunes`, `pasteCollapseRe`).

- **GIVEN** an imageish paste whose pre-paste baseline contains zero `[Image #N]` chips
- **WHEN** the TUI renders the paste as `[Image #1]` and `probeEcho` captures the frame
- **THEN** the occurrence count strictly exceeds the baseline and the probe passes (Enter proceeds for `submit:true`).
- **AND GIVEN** a stale `[Image #1]` already in the baseline and no fresh chip or needle appears, **THEN** the count does not rise and the probe fails closed (`ProbeFailure`, Enter withheld).
- **AND GIVEN** an imageish paste of a nonexistent file that echoes as raw text, **THEN** the raw-needle arm satisfies the probe (either-signal).

#### R2: Imageish gate predicate
The engine SHALL compute the imageish gate in `Send` alongside `collapsible`: the sanitized text, after trimming leading/trailing whitespace, is a **single line** (no interior `\n`) **ending in a recognized image extension**, case-insensitive: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`. A non-imageish paste keeps today's exact signal set (needle, plus the collapse chip when collapsible) — the chip arm never widens the false-positive window for ordinary text. `.svg`/`.bmp` are deliberately excluded (verified: CC does not chip them).

- **GIVEN** text `"/wt/.uploads/260904-shot.PNG"` (bare path, uppercase extension) or the same with a trailing newline
- **WHEN** the gate is computed
- **THEN** imageish is true.
- **AND GIVEN** `"look at /a/b.png please"` (mixed text), `"/a/b.png\n/c/d.jpg"` (two paths), or `"/a/b.svg"`, **THEN** imageish is false.

#### R3: Flag threaded through the package-internal probe chain
The imageish flag SHALL be threaded from `Send` through `retrySubmit`, `probeEcho`, and `verifySubmit` into `CountOccurrences`, so the post-Enter non-submission evidence arm and the recovery re-probe use the same predicate that established the echo (the existing collapse-chip principle). `CountOccurrences` has no callers outside `internal/inject/` (verified), so the signature change is package-local; the threading shape (an added parameter vs a small probe-signals value) follows the file's existing style at the author's discretion. `SendRaw`, `PressEnter`, `Sanitize`, `Needle`, and every exported error type are unchanged.

- **GIVEN** an imageish paste whose chip established the echo and Enter produced a frame unchanged through the full `SubmitBackoff` ladder with the chip still present
- **WHEN** `verifySubmit` evaluates evidence
- **THEN** the chip counts as the still-present echo (via the same gated predicate) and the non-submission verdict authorizes the existing bounded recovery.

#### R4: Unit tests mirror the paste-collapse coverage
The inject package tests SHALL cover: the gate predicate over the extension set, case-insensitivity, trimming, trailing-newline, mixed-text, multi-path, and excluded-extension cases; chip counting only under the gate; strict-increase with a stale chip in baseline; either-signal acceptance (raw needle passes for an imageish paste with no chip); and an end-to-end `Send` pass where the fake tmux renders the paste as a chip. No e2e tests — the probe is a backend-internal signal with no UI contract change.

- **GIVEN** the inject package test suite
- **WHEN** `go test ./internal/inject/...` runs
- **THEN** all cases above pass alongside the existing paste-collapse tests, unchanged.

### Design Decisions

#### Image chip is a gated third echo signal, either-signal with the raw needle
**Decision**: Count `[Image #N]` chips as fresh echo only when the paste is a bare single-line image path (trimmed, case-insensitive `.png/.jpg/.jpeg/.gif/.webp`), and accept EITHER a fresh chip OR a fresh raw needle for such pastes.
**Why**: Claude Code chips only a paste that is exactly one existing image path (verified CC 2.1.260 — mixed text, multi-path, `.svg`/`.bmp`, and nonexistent paths all stay raw text), and chip-vs-raw depends on filesystem state the engine cannot see; gating mirrors the collapsible-gate stance of keeping the concurrent-fresh-chip false-positive window off ordinary sends.
**Rejected**: counting the chip unconditionally (widens the false-positive window for all sends); matching CC's exact chip-eligibility rule via file existence/media sniffing (unknowable from text; either-signal makes it unnecessary); a frontend workaround (changes what the agent receives).
*Introduced by*: 260904-svfv-inject-image-chip-probe

### Non-Goals

- No frontend or API change — the staged-send toast behavior is already correct once the probe passes.
- No change to `pasteCollapseRe`, `CollapseMinRunes`, or the collapsible gate.
- No attempt to recognize other composer transformations (e.g. attachment chips of other agent TUIs) — additive later behind the same gate pattern.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `imageCollapseRe` (pattern `\[Image#\d+\]`) and the imageish gate predicate (trimmed single line ending in `.png/.jpg/.jpeg/.gif/.webp`, case-insensitive) to `app/backend/internal/inject/inject.go`, with doc comments recording the CC 2.1.260 empirical matrix per the file's convention <!-- R1, R2 -->
- [x] T002 Compute the gate in `Send` alongside `collapsible` and thread it through `retrySubmit`, `probeEcho`, `verifySubmit` into `CountOccurrences`, counting fresh chips additively under the unchanged strict-increase rule (`app/backend/internal/inject/inject.go`) <!-- R1, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Unit tests in `app/backend/internal/inject/` mirroring the paste-collapse tests: gate predicate matrix (extensions, case, trim, trailing newline, mixed text, multi-path, `.svg`/`.bmp`), chip counted only under the gate, stale-chip baseline strict-increase, either-signal raw-needle pass, and a full `Send` pass via a chip-rendering fake tmux <!-- R4 -->
- [x] T004 Run `go test ./internal/inject/...` then `go test ./...` in `app/backend/`; fix any fallout <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: A bare-image-path send whose paste renders as `[Image #N]` passes the probe and (for `submit`) sends Enter — no `ProbeFailure`, no staged-send toast path.
- [x] A-002 R2: The gate predicate matches exactly the trimmed single-line image-path shape for the five extensions case-insensitively, and rejects mixed text, multi-path, and excluded extensions.
- [x] A-003 R3: The flag reaches `verifySubmit`/`retrySubmit` so post-Enter evidence and recovery re-probe use the same gated predicate; no signature leaks outside `internal/inject/`.

### Behavioral Correctness

- [x] A-004 R1: A stale `[Image #N]` chip in the pre-paste baseline does not satisfy the probe (strict increase preserved); non-imageish sends have byte-identical behavior to today.
- [x] A-005 R1: An imageish paste that echoes as raw text (nonexistent file) still passes via the needle arm (either-signal).

### Scenario Coverage

- [x] A-006 R4: Unit tests cover the R2 gate matrix, the R1 baseline/either-signal scenarios, and an end-to-end `Send` chip pass; `go test ./internal/inject/...` is green.

### Code Quality

- [x] A-007 Pattern consistency: new regex, gate, and comments mirror `pasteCollapseRe`/`CollapseMinRunes` style, including the empirical-version doc-comment convention (CC 2.1.260 cited).
- [x] A-008 No unnecessary duplication: reuse `stripForProbe`/`CountOccurrences` plumbing; no parallel counting path.
- [x] A-009 Comment discipline: comments state constraints the code can't show (the empirical CC behavior, the gate rationale); no narration, no change-ID/PR citations in code or tests.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Threading shape left as an implementation-time choice (added parameter vs small signals value), following the file's plain-parameter style | Intake assumption 5 delegates this; package-local and fully reversible | S:70 R:90 A:85 D:65 |
| 2 | Certain | Gate requires a single trimmed line (interior `\n` disqualifies) — a trailing newline is trimmed away, matching the verified still-chips behavior | Empirical matrix: trailing newline chips, two newline-separated paths do not | S:90 R:90 A:90 D:90 |
| 3 | Confident | Verification scope: `go test` on the inject package then the backend module; no frontend type check or e2e (no frontend/API surface touched) | Intake assumption 7 + code-quality gates scoped to changed surface | S:80 R:85 A:85 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).
