# Intake: Fix rk riff Copilot Review Feedback

**Change**: 260417-aaon-fix-riff-copilot-feedback
**Created**: 2026-04-17
**Status**: Draft

## Origin

> User: "Address 5 Copilot review comments on merged PR #146 (rk riff command): 1) riff.go:263 escapeSingleQuotes doc comment has garbled escape sequence, fix to describe the actual single-quote-escape replacement; 2) riff_test.go:107 TestResolveLauncher has unused wantSuffix field, remove it; 3) fab/changes/260416-r1j6-add-riff-command/spec.md:328 typo subsitutions should be substitutions; 4) docs/memory/run-kit/rk-riff.md:30 incorrectly references cmd.Args, cobra passes forwarded args via args []string parameter to RunE; 5) riff.go:200 comment says Exported for direct testing but parseWorktreePath is lowercase, either export it or update the comment. Reviewer: Copilot. Source PR https://github.com/sahil87/run-kit/pull/146 already merged to main."

Interaction mode: one-shot, precise. User supplied exact file, line, and issue for every item — no ambiguity, no follow-up questions needed. Original riff work shipped via PR #146 (commit `9d33e8c`, merged to `main`) under change folder `260416-r1j6-add-riff-command/`. Copilot left 5 review comments that didn't block merge; this change is the cleanup pass.

Key scoping decision made up front: this change is a follow-up *fix* on already-merged code, not a reopening of the `r1j6` change. A fresh change folder keeps the original `r1j6` intake/spec/tasks frozen as shipped and makes the review-feedback cycle traceable as its own pipeline.

## Why

PR #146 shipped the `rk riff` command to production. Copilot's review flagged 5 low-severity issues (4 documentation/typo, 1 unused test field) that were not merge blockers, so the PR landed with them outstanding. Left unaddressed these:

1. **Mislead future readers** — `escapeSingleQuotes`'s doc comment is garbled (`'\”` instead of `'\''`), so a reader trying to understand the POSIX single-quote escape pattern has to stare at the code to work out what the comment *meant* to say. The whole point of that comment is to explain a non-obvious shell-escape trick — if it's wrong, it's worse than no comment.
2. **Leave misleading dead code** — the `wantSuffix` field in `TestResolveLauncher`'s test-case struct is never read by the loop body (only `want` is). A future reader editing the test will add a `wantSuffix:` value expecting it to assert something, which it won't. Dead struct fields in test tables are especially corrosive because they suggest assertion coverage that isn't real.
3. **Permanent documentation errors** — the spec.md typo (`subsitutions`) and the rk-riff.md memory inaccuracy (`cmd.Args` vs `args []string`) live forever in the project's historical record. Memory files in particular are load-bearing for `/fab-*` skills and subagent dispatch; inaccurate memory propagates into future agent-generated code and specs.
4. **Incorrect export-claim comment** — `parseWorktreePath`'s doc comment says "Exported for direct testing" but the function name is lowercase (package-private). Same-package tests can already call package-private functions directly; there's no export requirement. The comment is both inaccurate and rationale-less.

None of these are bugs in behavior, but all five degrade the reading/review experience for the next person (or agent) touching this code. The fix is cheap — under 10 line-level edits across 4 files — and the alternative (deferring indefinitely) accumulates cruft.

**Why not batch with other cleanup work?** No other pending changes touch these files. A dedicated follow-up change is the cleanest traceability for "Copilot review on #146 → addressed."

**Why a new change folder and not reopening r1j6?** The `260416-r1j6-add-riff-command` pipeline is at `hydrate: done` (ship stage). Reopening it would rewrite history on the shipped intake/spec/tasks. A new change folder preserves that record and gives this fix its own independent pipeline (intake → spec → tasks → apply → review → hydrate → ship → PR review).

## What Changes

Five localized edits across four files. No behavior change, no new code paths, no test coverage change.

### 1. `app/backend/cmd/rk/riff.go:263-268` — fix `escapeSingleQuotes` doc comment

**Current** (garbled):
```go
// escapeSingleQuotes returns s with every literal ' replaced by '\” so it
// can be embedded inside a single-quoted shell string. This matches the
// canonical POSIX shell-safe encoding.
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}
```

The ending `'\”` in the first line is a curly closing quote (`”` U+201D) rather than the intended escape sequence. The function body clearly replaces `'` with `'\''` — the comment should say so literally.

**Proposed**:
```go
// escapeSingleQuotes returns s with every literal ' replaced by the 4-character
// sequence '\'' so the result can be embedded inside a single-quoted shell
// string. This matches the canonical POSIX shell-safe encoding: close the
// current single-quoted string, escape a literal quote, then reopen.
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}
```

Rationale for the expanded form: the literal `'\''` is hard to parse visually in a comment. Calling out that it's a 4-character sequence and briefly naming the trick (close-escape-reopen) makes the intent obvious without the reader needing to decode the string.

### 2. `app/backend/cmd/rk/riff_test.go:101-154` — remove unused `wantSuffix` field

The test-case struct in `TestResolveLauncher` declares:

```go
cases := []struct {
    name       string
    setup      func(t *testing.T, root string)
    withChdir  bool
    wantSuffix string // allow OS path normalization where relevant
    want       string
}{
    ...
}
```

The loop body (lines 156-174) only reads `tc.name`, `tc.setup`, `tc.withChdir`, and `tc.want`. No case sets `wantSuffix`; no assertion reads it. Confirmed via `grep -n 'wantSuffix' riff_test.go` → single hit on the field declaration.

**Change**: delete the `wantSuffix string` line and its comment. The struct becomes 4 fields. No case-literal changes are needed because no case populates `wantSuffix`.

### 3. `fab/changes/260416-r1j6-add-riff-command/spec.md:328` — typo fix

**Current**:
> `agent.spawn_command` is a shell-syntax string that may contain shell subsitutions like `$(basename "$(pwd)")`.

**Proposed**: `subsitutions` → `substitutions`. Single-character fix (insert `t`). Nothing else on the line changes.

> **Cross-branch note**: This file lives in the already-shipped `r1j6` change folder but is not worktree-tied — editing it on a fresh branch from `main` is safe. The edit does not invalidate that change's status (still `hydrate: done`).

### 4. `docs/memory/run-kit/rk-riff.md:30` — correct cobra arg plumbing description

**Current**:
> Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args into `cmd.Args` unmolested. No other user-facing flags exist.

The claim that passthrough args land in `cmd.Args` is wrong. Cobra's `RunE` receives forwarded positional arguments via the `args []string` parameter (second parameter of the `func(cmd *cobra.Command, args []string) error` signature). `cmd.Args` is the `cobra.PositionalArgs` *validator* function, not the collected args.

**Proposed rewrite**:
> Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args straight through to `RunE`'s `args []string` parameter unmolested (rather than being mis-parsed as flags for `rk riff`). No other user-facing flags exist.

Also audit the same memory file for any downstream mentions of `cmd.Args` in the same incorrect sense — if any are found, fix them as part of this change.

### 5. `app/backend/cmd/rk/riff.go:198-200` — fix misleading export-claim comment

**Current**:
```go
// parseWorktreePath scans wt's combined output line by line looking for
// `^Path: <path>$` (after trimming whitespace). Returns the path or "" if
// not found. Exported for direct testing.
func parseWorktreePath(output string) string {
```

`parseWorktreePath` is lowercase → package-private. Same-package tests (`riff_test.go` at `riff_test.go:65`) call it directly without any export requirement.

**Preferred fix**: update the comment rather than export. Exporting would widen the package API surface for no external consumer; the only caller outside `riff.go` is `riff_test.go` in the same package.

**Proposed**:
```go
// parseWorktreePath scans wt's combined output line by line looking for
// `^Path: <path>$` (after trimming whitespace). Returns the path or "" if
// not found. Split into its own function so riff_test.go can assert the
// parsing rules directly, without staging a full wt invocation.
func parseWorktreePath(output string) string {
```

Rationale: captures the real "why" — testability through separation of concerns — without falsely claiming exported status.

## Affected Memory

- `run-kit/rk-riff`: (modify) correct the cobra passthrough-args description on line 30 from `cmd.Args` to `args []string` (RunE parameter). No new memory file, no structural change to the existing one. If any other lines in this memory file reference `cmd.Args` in the same incorrect sense, fix them too.

No other memory file is affected. The four code/test/spec edits (items 1, 2, 3, 5) do not change any post-implementation behavior captured in memory — they're documentation-level fixes inside source artifacts, not in memory files.

## Impact

**Affected files (4 total)**:
- `app/backend/cmd/rk/riff.go` — two comment edits (items 1 and 5), no code changes
- `app/backend/cmd/rk/riff_test.go` — one struct-field removal (item 2), no test-logic changes
- `fab/changes/260416-r1j6-add-riff-command/spec.md` — one-character typo fix (item 3)
- `docs/memory/run-kit/rk-riff.md` — one sentence rewrite (item 4), plus possible audit for same error elsewhere in file

**APIs, dependencies, systems**: None affected. No public API change (the `parseWorktreePath` function stays lowercase), no dependency change, no behavior change observable from tests or at runtime.

**Test impact**: `TestResolveLauncher` struct shape changes (one field removed). Test still compiles and passes because no case populated the removed field. No new tests required — these are documentation-level fixes, not behavior fixes.

**CI / review tooling impact**: The build artifacts (`go vet`, `go test ./...`) should pass unchanged. Copilot re-reviewing this PR should see 0 of its original 5 comments resurface.

**Base-branch consideration**: This change must branch from `main` (which contains PR #146's merged code at commit `9d33e8c`) rather than from the current worktree HEAD. The current worktree (`snowy-bobcat` at `9e02980`) is one commit behind `origin/main` and does not contain any of the files being edited. The apply stage MUST rebase onto or branch from `main` before making any edits.

**Scope boundary — what this change is NOT**:
- Not a behavior fix for `rk riff` (no user-facing bug is being patched)
- Not a refactor (no restructuring of the function layout, no API change)
- Not a test-coverage expansion (no new cases; just removes an unused field)
- Not a revisit of architectural decisions in the original spec (those are frozen)

## Open Questions

None. The user provided exact file paths, line numbers, issue descriptions, and preferred resolutions for all 5 items. All resolutions verified against the current state of `main` before intake write:
- `riff.go:263-265` comment garbling confirmed
- `riff_test.go:106` unused `wantSuffix` confirmed (single grep hit on declaration)
- `spec.md:328` typo confirmed
- `rk-riff.md:30` `cmd.Args` error confirmed
- `riff.go:198-200` lowercase `parseWorktreePath` with "Exported for direct testing" comment confirmed

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All 5 review items are in scope; no others will be pulled in | User enumerated exactly 5 items with file:line specificity; no ambient invitation to expand scope | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix is made on a new branch from `main`, not by reopening the `r1j6` change folder | User explicitly framed as "address 5 Copilot review comments on merged PR #146", implying a follow-up cycle. Reopening would rewrite shipped pipeline artifacts | S:95 R:70 A:90 D:95 |
| 3 | Certain | For item 5 (parseWorktreePath), update the comment rather than export the function | User wrote "either export it or update the comment" — exporting widens API surface needlessly since the only external caller is same-package test code. Comment update is the lower-impact fix | S:85 R:85 A:95 D:85 |
| 4 | Confident | For item 1, expand the comment beyond the minimal grammar fix to explain the 4-char close-escape-reopen trick | The whole purpose of that comment is to demystify a non-obvious shell trick. Minimal fix (`'\”` → `'\''`) would leave a cryptic comment; a brief explanatory rewrite is more useful to future readers. Low-reversibility-cost: single comment edit | S:70 R:90 A:80 D:75 |
| 5 | Confident | For item 4, also audit the rest of `rk-riff.md` for the same `cmd.Args` misconception and fix any other instances | Memory files propagate into agent-generated code; if the error appears elsewhere in the same doc, it'll re-infect future work. Grep is cheap | S:65 R:85 A:85 D:80 |
| 6 | Confident | For item 2, delete the `wantSuffix` field and its trailing `// allow OS path normalization where relevant` comment together | The comment only exists to explain a field that's being removed. Keeping the orphaned comment would make the next reader wonder what it refers to | S:75 R:90 A:85 D:90 |
| 7 | Certain | No new test cases needed; no spec change; no memory-file additions | Documentation/typo/unused-field fixes don't change behavior. Existing tests exercise the code; their results are unaffected | S:90 R:85 A:95 D:90 |
| 8 | Confident | Editing `spec.md` of the already-shipped `r1j6` change is acceptable (one-char typo fix) | Spec files in change folders persist as historical records but aren't immutable — typo corrections preserve the record's accuracy without altering its decisions or semantics. Status stays `hydrate: done` | S:65 R:80 A:75 D:85 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
