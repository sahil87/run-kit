# Plan: Fix rk riff Copilot Review Feedback

**Change**: 260417-aaon-fix-riff-copilot-feedback
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 2: Core Edits

- [x] T001 [P] Fix `escapeSingleQuotes` doc comment in `app/backend/cmd/rk/riff.go:263-265` — replace the garbled first line (which contains a curly closing quote `'\”` U+201D) with an ASCII-only description. Name the 4-character `'\''` sequence literally and briefly explain the close-escape-reopen trick. Preserve the function body byte-for-byte; only comment lines change. Final comment MUST contain no characters in U+2018–U+201F. (Spec: "Doc Comment Accurately Describes the Escape Encoding")

- [x] T002 [P] Fix `parseWorktreePath` doc comment in `app/backend/cmd/rk/riff.go:198-200` — remove the phrase "Exported for direct testing" (and any similar export-claim phrasing). Replace with text that states the real rationale: the parsing logic is factored into its own function so `riff_test.go` can assert the parsing rules directly, without staging a full `wt` invocation. The function identifier `parseWorktreePath` MUST remain lowercase (not renamed/exported). (Spec: "Comment Reflects Real Visibility and Rationale")

- [x] T003 [P] Remove the unused `wantSuffix` field from the anonymous struct in `TestResolveLauncher` in `app/backend/cmd/rk/riff_test.go:101-108`. Specifically: delete line 106 (`wantSuffix string // allow OS path normalization where relevant`). Do not modify any case literals — none populate `wantSuffix`. After the edit, the struct's field list is exactly: `name`, `setup`, `withChdir`, `want`. Verify with `grep -c 'wantSuffix' riff_test.go` → 0. (Spec: "Struct Field `wantSuffix` Removed")

- [x] T004 [P] Fix the `subsitutions` typo in `fab/changes/260416-r1j6-add-riff-command/spec.md:328` → change to `substitutions` (insert `t` between `i` and `u`). Change exactly one character on that line; do not touch any other content in the file. Do NOT modify that change folder's `.status.yaml`. Verify with `grep -c 'subsitutions' spec.md` → 0. (Spec: "`subsitutions` → `substitutions`")

- [x] T005 [P] Rewrite line 30 of `docs/memory/run-kit/rk-riff.md` — replace the incorrect `cmd.Args` claim with a description of how forwarded args reach `RunE` via the `args []string` parameter. Proposed wording (from intake): `Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args straight through to `RunE`'s `args []string` parameter unmolested (rather than being mis-parsed as flags for `rk riff`). No other user-facing flags exist.` Preserve lines 29 and 31 byte-identical. Also re-grep the whole file for any additional `cmd.Args` references — spec confirmed none at spec-gen time, but re-verify at apply time and fix any that surface. (Spec: "Correct Description of Forwarded-Arg Handling" + "Memory Accuracy Preserved Across Sections")

## Phase 3: Verification Gates

- [x] T006 Run `grep -n 'wantSuffix' app/backend/cmd/rk/riff_test.go` and confirm zero hits. Run `grep -n 'subsitutions' fab/changes/260416-r1j6-add-riff-command/spec.md` and confirm zero hits. Run `grep -n 'cmd\.Args' docs/memory/run-kit/rk-riff.md` and confirm zero hits. Run `grep -n 'Exported for' app/backend/cmd/rk/riff.go` and confirm zero hits (the old misleading comment must be gone). Any non-zero result fails the task. (Spec: scenarios "Field is absent after the edit", "Typo fixed in place", "File audit confirms no other `cmd.Args` misuses", "No false export claim")

- [x] T007 Run `grep -n '[\x{2018}-\x{201F}]' app/backend/cmd/rk/riff.go` (or ripgrep with `[‘-‟]`) to confirm no Unicode General Punctuation quote characters remain in the file. Zero hits = pass. (Spec: scenario "Minimum grammar fix present" — curly-quote absence)

- [x] T008 Run `cd app/backend && go vet ./cmd/rk/...` — exit 0, no diagnostics. Then `go build ./...` from `app/backend/` — exit 0. (Spec: "Code-Quality Gates Still Clean")

- [x] T009 Run `cd app/backend && go test ./cmd/rk/...` — all pre-existing subtests pass (`TestParseWorktreePath`, `TestEscapeSingleQuotes`, `TestResolveLauncher`, `TestResolveLauncher_ReadsFromSubdir`, `TestFabconfigIntegration`). Belt-and-suspenders: also run `go test ./internal/fabconfig/...` — expect pass with zero changes (no file in that package touched). (Spec: "No New Tests Required, No Existing Tests Broken")

- [x] T010 Confirm the r1j6 pipeline status is preserved: `diff <(git show HEAD:fab/changes/260416-r1j6-add-riff-command/.status.yaml) fab/changes/260416-r1j6-add-riff-command/.status.yaml` → empty diff. (Spec: scenario "r1j6 pipeline status is preserved")

---

## Execution Order

All Phase 2 tasks (T001-T005) are independent and MAY execute in parallel — each touches a different file (or a different function within `riff.go` for T001 vs T002). Phase 3 verification tasks (T006-T010) MUST run after all Phase 2 edits are applied. Within Phase 3, T006-T007 (grep checks) MAY run in parallel; T008 and T009 are sequential on the Go toolchain but independent of each other; T010 is independent.

**Minimum successful path**: apply T001-T005 → run T006-T010 → all green. If T001-T005 are done serially, total apply time is <5 min; verification <2 min.

## Edit Scope Summary

| Task | File | Change Type | LOC Impact |
|------|------|-------------|------------|
| T001 | `app/backend/cmd/rk/riff.go:263-265` | Comment rewrite | ~3-5 lines |
| T002 | `app/backend/cmd/rk/riff.go:198-200` | Comment rewrite | ~3-4 lines |
| T003 | `app/backend/cmd/rk/riff_test.go:106` | Field deletion | 1 line removed |
| T004 | `fab/changes/260416-r1j6-add-riff-command/spec.md:328` | 1-char typo fix | 1 char changed |
| T005 | `docs/memory/run-kit/rk-riff.md:30` | Sentence rewrite | 1 line |

Total: ~10-15 lines of diff across 4 files. Zero behavior change. Zero new tests. Zero deleted tests.

## Acceptance

## Functional Completeness

- [ ] CHK-001 `escapeSingleQuotes` doc comment fixed: the comment preceding `func escapeSingleQuotes` in `app/backend/cmd/rk/riff.go` names the 4-character `'\''` sequence using only ASCII characters, and contains no curly/smart quotes (U+2018–U+201F). Verify via `grep -n 'escapeSingleQuotes' riff.go` → view the comment block; check for absence of `”` / `’` / `‘` / `“`.

- [ ] CHK-002 `parseWorktreePath` doc comment corrected: the comment preceding `func parseWorktreePath` in `app/backend/cmd/rk/riff.go` does NOT contain the phrases "Exported for" or "Public for" or "Exposed for testing" (no false-export claim). The comment describes the real rationale (direct unit testing of parsing rules without staging a full `wt` invocation). The function identifier remains lowercase (`parseWorktreePath`, not `ParseWorktreePath`).

- [ ] CHK-003 `wantSuffix` field removed: in `app/backend/cmd/rk/riff_test.go`, the anonymous struct inside `TestResolveLauncher` has exactly 4 fields (`name`, `setup`, `withChdir`, `want`) — no `wantSuffix`. The trailing comment `// allow OS path normalization where relevant` is also removed (it existed only to document the removed field). Verify via `grep -n 'wantSuffix' riff_test.go` → 0 hits.

- [ ] CHK-004 `subsitutions` typo fixed: `fab/changes/260416-r1j6-add-riff-command/spec.md` contains `substitutions` (correctly spelled) on the line that previously held the typo. Verify via `grep -c 'subsitutions' spec.md` → 0 AND `grep -c 'substitutions' spec.md` → ≥ 1.

- [ ] CHK-005 `rk-riff.md` line 30 corrected: line 30 of `docs/memory/run-kit/rk-riff.md` describes forwarded-arg handling via `RunE`'s `args []string` parameter, not via `cmd.Args`. Verify via `grep -c 'cmd\.Args' rk-riff.md` → 0, AND the line mentions `args []string` (or `args` as a named RunE parameter).

## Behavioral Correctness

- [ ] CHK-006 Zero runtime behavior change: no new/removed/modified code paths in `riff.go` function bodies. Verify via `git diff HEAD -- app/backend/cmd/rk/riff.go` — the only diff hunks are on comment lines (no lines starting with `func`, no lines starting with non-comment statements inside existing functions).

- [ ] CHK-007 Zero signature change on `parseWorktreePath`: `func parseWorktreePath(output string) string` is byte-identical (same name, same parameter types/names, same return type). Verify via `grep 'func parseWorktreePath' riff.go` → exactly one hit with the unchanged signature.

- [ ] CHK-008 Zero signature change on `escapeSingleQuotes`: `func escapeSingleQuotes(s string) string` is byte-identical. Body unchanged (`return strings.ReplaceAll(s, "'", \`'\\''\`)`).

- [ ] CHK-009 Zero test case additions or removals in `TestResolveLauncher`: the `cases` slice has the same 5 literals (same `name:` strings as before). Verify via `grep -c 'name:.*"' riff_test.go` — case-count inside TestResolveLauncher is unchanged. Only the struct type loses a field.

## Removal Verification

- [ ] CHK-010 No dead code introduced: the `wantSuffix` removal does not leave any test logic referencing a non-existent field (would be a compile error). `go build ./cmd/rk/...` passes cleanly.

- [ ] CHK-011 No orphaned comments on removed field: the trailing `// allow OS path normalization where relevant` comment is gone. Verify via `grep -n 'OS path normalization' riff_test.go` → 0 hits.

- [ ] CHK-012 r1j6 `.status.yaml` untouched: `fab/changes/260416-r1j6-add-riff-command/.status.yaml` is byte-identical to its state before this change. Verify via `git diff HEAD -- fab/changes/260416-r1j6-add-riff-command/.status.yaml` → empty diff.

## Scenario Coverage

- [ ] CHK-013 Scenario "Minimum grammar fix present" verified: `app/backend/cmd/rk/riff.go` contains `'\''` literally in the `escapeSingleQuotes` doc comment. No Unicode U+2018–U+201F characters anywhere in the file.

- [ ] CHK-014 Scenario "Explanation is pedagogically useful" verified: the revised `escapeSingleQuotes` comment identifies `'\''` as a 4-character sequence and describes the close-escape-reopen trick.

- [ ] CHK-015 Scenario "No false export claim" verified: `parseWorktreePath` comment contains no phrase implying exported status.

- [ ] CHK-016 Scenario "Same-package test keeps compiling and passing" verified: `go test -run 'TestParseWorktreePath|TestResolveLauncher' ./cmd/rk/...` passes.

- [ ] CHK-017 Scenario "Struct field count goes from 5 to 4" verified: manual field-count confirmation in the `cases` anonymous struct.

- [ ] CHK-018 Scenario "r1j6 pipeline status is preserved" verified: diff check on `.status.yaml` shows empty.

- [ ] CHK-019 Scenario "File audit confirms no other `cmd.Args` misuses" verified: `grep -n 'cmd\.Args' docs/memory/run-kit/rk-riff.md` → 0 hits post-edit.

- [ ] CHK-020 Scenario "Surrounding content preserved" verified: lines 29 and 31 of `rk-riff.md` are byte-identical to their pre-edit state.

## Edge Cases & Error Handling

- [ ] CHK-021 If `rk-riff.md` audit (T005) surfaces additional `cmd.Args` occurrences beyond line 30, those are also fixed in the same commit. Spec confirmed 1 hit pre-edit, but the audit re-runs during apply as defense-in-depth.

- [ ] CHK-022 If the line-30 rewrite exceeds the pre-edit line width and wraps, the overflow MUST NOT spill into neighboring headings or tables (lines 22–28 table, line 32 heading stay intact).

## Code Quality

- [ ] CHK-023 Principle "Readability and maintainability over cleverness" applied: the rewritten `escapeSingleQuotes` comment is clearer than the original (even the non-garbled intent), not just fixed.

- [ ] CHK-024 Principle "Follow existing project patterns unless there's compelling reason to deviate" applied: comment style (lowercase start, sentence-cased, no emojis, no trailing periods on single-line comments when inline) matches neighboring doc comments in `riff.go`.

- [ ] CHK-025 Principle "Go backend: Use `exec.CommandContext` with timeouts" — N/A for this change (no subprocess code changed).

- [ ] CHK-026 Principle "New features and bug fixes MUST include tests covering the added/changed behavior" — N/A: this is documentation/typo/unused-field cleanup, no behavior change. Existing tests continue to cover the unchanged behavior.

- [ ] CHK-027 Anti-pattern "God functions (>50 lines without clear reason)" — N/A: no function body changed.

- [ ] CHK-028 Anti-pattern "Magic strings or numbers without named constants" — N/A: no constants added or removed.

- [ ] CHK-029 Anti-pattern "Shell string construction for subprocess calls" — N/A: no subprocess calls changed.

- [ ] CHK-030 Pattern consistency: comment style and formatting in the two rewritten doc comments matches the surrounding `riff.go` conventions (GoDoc style: comment immediately precedes the function, first word is the identifier, concluded with a period).

- [ ] CHK-031 No unnecessary duplication: no helper function, constant, or type was added that duplicates existing `internal/tmux/`, `internal/sessions/`, or `internal/fab/` utilities (N/A — nothing was added; this is removal/rewrite only).

## Verification Gates (from `fab/project/code-quality.md` §Verification)

- [ ] CHK-032 `cd app/backend && go test ./cmd/rk/...` passes (exit 0). All pre-existing subtests in `TestParseWorktreePath`, `TestEscapeSingleQuotes`, `TestResolveLauncher`, `TestResolveLauncher_ReadsFromSubdir`, and `TestFabconfigIntegration` still PASS.

- [ ] CHK-033 `cd app/backend && go vet ./cmd/rk/...` passes (exit 0, no diagnostics).

- [ ] CHK-034 `cd app/backend && go build ./...` passes (exit 0).

- [ ] CHK-035 Belt-and-suspenders: `cd app/backend && go test ./internal/fabconfig/...` passes. (Not strictly required — this package isn't touched — but confirms nothing downstream broke.)

- [ ] CHK-036 `just test` — full backend + frontend + e2e sweep. Optional for doc-only change but recommended for merge-ready confidence. Expect 0 regressions attributable to this change. N/A if the change has zero Go or frontend diff (only .md fixes) — but here we do have two .go files modified, so full sweep is warranted.
