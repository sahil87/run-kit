# Quality Checklist: Fix rk riff Copilot Review Feedback

**Change**: 260417-aaon-fix-riff-copilot-feedback
**Generated**: 2026-04-17
**Spec**: `spec.md`

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
