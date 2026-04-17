# Spec: Fix rk riff Copilot Review Feedback

**Change**: 260417-aaon-fix-riff-copilot-feedback
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- No behavior change to `rk riff` runtime — all edits are documentation, test-struct, or typo level. No new arguments, flags, exit codes, or execution paths.
- No new tests — the unused-field removal does not expand or contract coverage; existing tests still exercise the same code paths.
- No change to the exported API surface — `parseWorktreePath` stays package-private (item 5 rejects the "export it" branch).
- No rework of the already-shipped `260416-r1j6-add-riff-command` pipeline — only a one-character typo edit inside its spec.md.
- No audit or refactor beyond the single-file rk-riff.md `cmd.Args` audit (confirmed zero additional occurrences; if later grep finds more during apply, fix in place but do not expand scope).

## Code: `escapeSingleQuotes` Doc Comment

### Requirement: Doc Comment Accurately Describes the Escape Encoding

The doc comment on `escapeSingleQuotes` in `app/backend/cmd/rk/riff.go` MUST describe the replacement pattern using valid ASCII characters (`'` U+0027), and SHALL NOT contain curly/smart quotes (`”` U+201D, `’` U+2019, or similar). The comment SHALL name the 4-character sequence (`'\''`) that the replacement produces, and SHOULD briefly explain why that sequence is shell-safe inside a single-quoted string.

#### Scenario: Minimum grammar fix present

- **GIVEN** `app/backend/cmd/rk/riff.go` contains `func escapeSingleQuotes(s string) string`
- **WHEN** a reader inspects the doc comment immediately preceding the function
- **THEN** the comment mentions `'\''` literally (four ASCII chars: `'`, `\`, `'`, `'`)
- **AND** the comment contains no characters in the Unicode General Punctuation block (U+2018–U+201F)

#### Scenario: Explanation is pedagogically useful

- **GIVEN** the revised comment
- **WHEN** a reader unfamiliar with POSIX shell quoting reads it
- **THEN** the comment identifies `'\''` as a 4-character sequence (avoiding visual ambiguity)
- **AND** briefly notes that the trick closes the current single-quoted string, escapes a literal quote, and reopens — either inline or via concise wording that conveys the same idea

#### Scenario: Implementation stays untouched

- **GIVEN** the comment fix
- **WHEN** `git diff` is inspected on `riff.go`
- **THEN** only comment lines on this function are changed
- **AND** the function body (`return strings.ReplaceAll(s, "'", \`'\\''\`)`) is byte-identical to before the change

## Code: `parseWorktreePath` Doc Comment

### Requirement: Comment Reflects Real Visibility and Rationale

The doc comment on `parseWorktreePath` in `app/backend/cmd/rk/riff.go` MUST NOT claim the function is "Exported". The function SHALL remain package-private (lowercase identifier) — no rename. The comment SHOULD state the real reason the parsing logic is factored into its own function: same-package tests assert the parsing rules without staging a full `wt` invocation.

#### Scenario: No false export claim

- **GIVEN** the revised comment
- **WHEN** a reader compares the comment against the function signature
- **THEN** the comment contains no phrase implying the function is exported (e.g., "Exported for", "Public for", "Exposed for testing")
- **AND** the function identifier remains `parseWorktreePath` (first character lowercase)

#### Scenario: Comment explains the real factoring rationale

- **GIVEN** the revised comment
- **WHEN** a reader asks "why is this a separate function?"
- **THEN** the comment answers: separated to enable direct unit testing of the parsing rules, without standing up a real `wt` subprocess

#### Scenario: Same-package test keeps compiling and passing

- **GIVEN** the revised comment
- **WHEN** `go test ./app/backend/cmd/rk/...` runs
- **THEN** `riff_test.go` compiles (it still calls `parseWorktreePath` from the same package at `riff_test.go:65`)
- **AND** all existing `parseWorktreePath` test cases pass unchanged

## Code: `TestResolveLauncher` Unused Field

### Requirement: Struct Field `wantSuffix` Removed

The anonymous struct in `TestResolveLauncher` (`app/backend/cmd/rk/riff_test.go`) MUST NOT declare a `wantSuffix` field. The adjoining trailing comment (`// allow OS path normalization where relevant`) SHALL be removed in the same edit — it exists only to document the removed field. No case-literal body is modified (no case populates `wantSuffix` currently).

#### Scenario: Field is absent after the edit

- **GIVEN** `app/backend/cmd/rk/riff_test.go`
- **WHEN** the file is searched for the literal `wantSuffix`
- **THEN** zero matches are returned (confirmed via `grep -n 'wantSuffix' riff_test.go`)

#### Scenario: Orphaned comment removed with the field

- **GIVEN** the field removal
- **WHEN** the surrounding struct declaration is inspected
- **THEN** no trailing comment references the removed field (no dangling `// allow OS path normalization where relevant`)

#### Scenario: Test continues to pass

- **GIVEN** the field is gone
- **WHEN** `go test -run TestResolveLauncher ./app/backend/cmd/rk/...` runs
- **THEN** the test binary compiles without errors
- **AND** all 5 subtests pass (`config present with spawn_command returns value`, `config missing key returns fallback`, `empty spawn_command returns fallback`, `no git repo returns fallback`, `config file missing returns fallback`)

#### Scenario: Struct field count goes from 5 to 4

- **GIVEN** the test-case struct type definition
- **WHEN** its declared field list is enumerated
- **THEN** it contains exactly `name`, `setup`, `withChdir`, `want` — in that order — and nothing else

## Docs: Historical Spec Typo

### Requirement: `subsitutions` → `substitutions`

The string `subsitutions` in `fab/changes/260416-r1j6-add-riff-command/spec.md` (currently at line 328 inside Design Decision #5) SHALL be replaced with `substitutions`. No other character on that line or in that file is modified. The `.status.yaml` of the r1j6 change MUST remain unchanged (stage `hydrate: done`, stage `ship`/`review-pr` state as-is).

#### Scenario: Typo fixed in place

- **GIVEN** `fab/changes/260416-r1j6-add-riff-command/spec.md`
- **WHEN** the file is grepped for the incorrect spelling
- **THEN** `grep -c 'subsitutions' spec.md` returns 0
- **AND** `grep -c 'substitutions' spec.md` returns >= 1 on the line that previously held the typo

#### Scenario: r1j6 pipeline status is preserved

- **GIVEN** the typo fix
- **WHEN** `fab/changes/260416-r1j6-add-riff-command/.status.yaml` is inspected
- **THEN** the file content is byte-identical to its state before this change

## Docs: rk-riff Memory — Cobra Arg Plumbing

### Requirement: Correct Description of Forwarded-Arg Handling

Line 30 of `docs/memory/run-kit/rk-riff.md` MUST NOT claim that `SetInterspersed(false)` routes passthrough args into `cmd.Args`. The corrected description SHALL state that forwarded args are delivered to `RunE`'s `args []string` parameter (the second parameter of the cobra `RunE` function signature). The rewritten sentence SHOULD preserve the adjacent context (mention of the `--` terminator, the purpose of `SetInterspersed(false)`, and the closing phrase "No other user-facing flags exist.").

#### Scenario: Line 30 rewrite

- **GIVEN** `docs/memory/run-kit/rk-riff.md` after the edit
- **WHEN** line 30 is read
- **THEN** the line references `args []string` (or `args` as a named parameter of `RunE`) — not `cmd.Args`

#### Scenario: File audit confirms no other `cmd.Args` misuses

- **GIVEN** the post-edit `rk-riff.md`
- **WHEN** the file is grepped for the literal `cmd.Args`
- **THEN** zero matches are returned (confirmed pre-edit: only line 30 matched; audit completes with zero other hits to fix)

#### Scenario: Surrounding content preserved

- **GIVEN** the edited line 30
- **WHEN** diff is inspected
- **THEN** line 29 and line 31 are byte-identical to their pre-edit state
- **AND** the `## Flag Surface` heading (line 22), the flag table (lines 24-28), and the `## Precondition Checks` heading (line 32) are all unmodified

### Requirement: Memory Accuracy Preserved Across Sections

All other factual claims in `rk-riff.md` (launcher resolution algorithm, workflow step order, exit-code discipline, single-quote escaping examples, fabconfig subset, `tmux.OriginalTMUX` usage, tests summary, related files, changelog) MUST remain byte-identical. This change is a line-30 surgical edit, not a memory refresh.

#### Scenario: Unrelated sections unchanged

- **GIVEN** the post-edit `rk-riff.md`
- **WHEN** a diff is produced against the pre-edit file
- **THEN** only line 30 content is modified (plus possibly wrapping adjustments if the rewritten sentence exceeds original width — adjustment MUST NOT spill into neighboring headings)

## Tests: Regression Coverage

### Requirement: No New Tests Required, No Existing Tests Broken

No new test files MAY be added. Existing test invocations (`go test ./app/backend/cmd/rk/...` and `go test ./app/backend/internal/fabconfig/...`) MUST continue to pass with zero case failures and zero compile errors after this change.

#### Scenario: Full rk package tests pass

- **GIVEN** the five edits applied
- **WHEN** `cd app/backend && go test ./cmd/rk/...` runs
- **THEN** exit code is 0
- **AND** every pre-existing subtest in `TestParseWorktreePath`, `TestEscapeSingleQuotes`, `TestResolveLauncher`, `TestResolveLauncher_ReadsFromSubdir`, and `TestFabconfigIntegration` still reports PASS

#### Scenario: Affected-module test scope is sufficient

- **GIVEN** this change touches only `app/backend/cmd/rk/riff.go`, `app/backend/cmd/rk/riff_test.go`, and two `.md` files
- **WHEN** a reviewer asks "what tests cover this change?"
- **THEN** running the `cmd/rk` package tests is sufficient — no other Go package depends on symbols altered by this change

### Requirement: Code-Quality Gates Still Clean

`go vet` and `go build` MUST succeed on the backend module after the edits. Comment-only and struct-field-only changes SHALL NOT introduce unused-import warnings or other lint regressions.

#### Scenario: go vet passes

- **GIVEN** the edits applied
- **WHEN** `cd app/backend && go vet ./cmd/rk/...` runs
- **THEN** exit code is 0 with no diagnostics

#### Scenario: go build passes

- **GIVEN** the edits applied
- **WHEN** `cd app/backend && go build ./...` runs
- **THEN** exit code is 0

## Design Decisions

1. **Fresh change folder, not reopening `r1j6`**
   - *Why*: The `260416-r1j6-add-riff-command` pipeline is at `hydrate: done` (ship stage). Treating this follow-up as a new change preserves the shipped pipeline's artifact history and gives Copilot's review-feedback cycle its own traceable pipeline (intake → spec → tasks → apply → review → hydrate → ship → review-pr).
   - *Rejected*: Reopening `r1j6` — would rewrite the shipped intake/spec/tasks, hiding the fact that these issues were a post-merge cleanup pass. Reviewer attribution (Copilot on PR #146) would also get buried.

2. **Update `parseWorktreePath` comment rather than export the function**
   - *Why*: The only caller outside `riff.go` is `riff_test.go` — same package, which can access lowercase identifiers freely. Exporting would widen the package's public API surface for zero benefit.
   - *Rejected*: Renaming to `ParseWorktreePath` — pointless API expansion; would require updating `riff.go` call site and `riff_test.go` call site, with no external consumer.

3. **Expand `escapeSingleQuotes` comment beyond minimal character fix**
   - *Why*: The comment's purpose is to demystify a non-obvious POSIX shell trick. Fixing only the curly quote (`'\”` → `'\''`) leaves the reader still staring at a cryptic 4-character sequence. A brief explanatory rewrite (name the sequence, name the trick) is more useful.
   - *Rejected*: Minimal one-character edit — satisfies Copilot but fails the "comment should help future readers" bar.

4. **Delete `wantSuffix` field and its trailing comment together**
   - *Why*: The `// allow OS path normalization where relevant` comment exists solely to document the removed field. Keeping it orphaned would puzzle the next reader ("what field does this refer to?").
   - *Rejected*: Keep the comment as a "reminder" — it'd re-invite someone to re-add the field without understanding why it was removed.

5. **One-char spec.md typo fix is acceptable despite r1j6 being shipped**
   - *Why*: Spec files in change folders are historical artifacts but not immutable — correcting a typo preserves historical accuracy without altering decisions, semantics, or pipeline state. The alternative (leaving the typo in perpetuity) accumulates cruft in the docs surface.
   - *Rejected*: Leave the typo to preserve "the exact text as shipped" — this privileges historical literalism over documentation quality. Typo fixes are routine in any codebase.

6. **All 5 edits go in one change and one PR**
   - *Why*: All 5 are Copilot comments on the same PR, touch tightly related files, and are low risk. One PR keeps the review surface focused ("here's my response to Copilot"). Splitting into 5 PRs (or 2: code vs docs) would be review overhead without benefit.
   - *Rejected*: Split by file type (code vs docs) — would force artificial dependency coordination for work that has no coupling.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All 5 Copilot review items in scope; no other changes | User enumerated exactly 5 items with file:line specificity. Confirmed from intake #1 | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fresh change folder, not reopening `r1j6` | Preserves shipped pipeline history; confirmed from intake #2 | S:95 R:75 A:90 D:95 |
| 3 | Certain | Update comment on `parseWorktreePath`, don't export | Only caller outside `riff.go` is same-package test; exporting is pointless API widening. Confirmed from intake #3 | S:90 R:85 A:95 D:90 |
| 4 | Certain | Delete `wantSuffix` + its trailing comment together | Orphaned comment would puzzle readers; confirmed from intake #6 | S:85 R:90 A:90 D:90 |
| 5 | Confident | Expand `escapeSingleQuotes` comment beyond minimal grammar fix | Minimal fix leaves the shell trick still cryptic; confirmed from intake #4 | S:75 R:90 A:80 D:80 |
| 6 | Certain | `rk-riff.md` audit complete — only one `cmd.Args` occurrence | `grep -c 'cmd.Args' rk-riff.md` returned 1 (line 30). Upgrade from intake Confident #5 — audit actually ran during spec generation | S:95 R:90 A:95 D:95 |
| 7 | Confident | Historical spec.md typo fix is acceptable | Spec artifacts not immutable; 1-char correction preserves accuracy without altering decisions. Confirmed from intake #8 | S:70 R:80 A:75 D:85 |
| 8 | Certain | No new tests, no new files; existing tests continue to pass | Doc/typo/unused-field fixes don't change behavior. Confirmed from intake #7 | S:95 R:85 A:95 D:95 |
| 9 | Confident | One PR, not split by file type | Tight cohesion (all 5 are Copilot-on-PR-#146 comments); splitting adds review overhead without benefit. New assumption at spec level | S:75 R:80 A:85 D:85 |
| 10 | Confident | Test-package scope sufficient: `cmd/rk/...` (no wider gates needed) | Only `cmd/rk` package symbols/comments affected; `internal/fabconfig` tests unaffected though they MAY be run as a belt-and-suspenders check | S:75 R:80 A:85 D:85 |
| 11 | Confident | `go vet` + `go build` also pass (not only `go test`) | Comment/field changes don't introduce new imports or syntax; lint is safe. New assumption at spec level | S:80 R:85 A:85 D:85 |
| 12 | Confident | Minimal diff on rk-riff.md: only line 30 modified (line 29/31 byte-identical) | Line 30 is a standalone sentence; rewrite fits on one line without wrap-over. New assumption at spec level | S:75 R:80 A:80 D:85 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
