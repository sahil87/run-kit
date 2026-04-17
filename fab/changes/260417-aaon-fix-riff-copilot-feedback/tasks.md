# Tasks: Fix rk riff Copilot Review Feedback

**Change**: 260417-aaon-fix-riff-copilot-feedback
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  All 5 edits are localized, independent, and low-risk. Phase 2 tasks are all [P] —
  they touch different files (or different functions within riff.go) and have no
  ordering dependency. Phase 3 runs the verification gates. No setup phase
  (no dependencies or scaffolding), no polish phase (no docs/readme to write).
-->

## Phase 2: Core Edits

- [x] T001 [P] Fix `escapeSingleQuotes` doc comment in `app/backend/cmd/rk/riff.go:263-265` — replace the garbled first line (which contains a curly closing quote `'\”` U+201D) with an ASCII-only description. Name the 4-character `'\''` sequence literally and briefly explain the close-escape-reopen trick. Preserve the function body byte-for-byte; only comment lines change. Final comment MUST contain no characters in U+2018–U+201F. (Spec: "Doc Comment Accurately Describes the Escape Encoding")

- [x] T002 [P] Fix `parseWorktreePath` doc comment in `app/backend/cmd/rk/riff.go:198-200` — remove the phrase "Exported for direct testing" (and any similar export-claim phrasing). Replace with text that states the real rationale: the parsing logic is factored into its own function so `riff_test.go` can assert the parsing rules directly, without staging a full `wt` invocation. The function identifier `parseWorktreePath` MUST remain lowercase (not renamed/exported). (Spec: "Comment Reflects Real Visibility and Rationale")

- [x] T003 [P] Remove the unused `wantSuffix` field from the anonymous struct in `TestResolveLauncher` in `app/backend/cmd/rk/riff_test.go:101-108`. Specifically: delete line 106 (`wantSuffix string // allow OS path normalization where relevant`). Do not modify any case literals — none populate `wantSuffix`. After the edit, the struct's field list is exactly: `name`, `setup`, `withChdir`, `want`. Verify with `grep -c 'wantSuffix' riff_test.go` → 0. (Spec: "Struct Field `wantSuffix` Removed")

- [x] T004 [P] Fix the `subsitutions` typo in `fab/changes/260416-r1j6-add-riff-command/spec.md:328` → change to `substitutions` (insert `t` between `i` and `u`). Change exactly one character on that line; do not touch any other content in the file. Do NOT modify that change folder's `.status.yaml`. Verify with `grep -c 'subsitutions' spec.md` → 0. (Spec: "`subsitutions` → `substitutions`")

- [x] T005 [P] Rewrite line 30 of `docs/memory/run-kit/rk-riff.md` — replace the incorrect `cmd.Args` claim with a description of how forwarded args reach `RunE` via the `args []string` parameter. Proposed wording (from intake): `Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args straight through to `RunE`'s `args []string` parameter unmolested (rather than being mis-parsed as flags for `rk riff`). No other user-facing flags exist.` Preserve lines 29 and 31 byte-identical. Also re-grep the whole file for any additional `cmd.Args` references — spec confirmed none at spec-gen time, but re-verify at apply time and fix any that surface. (Spec: "Correct Description of Forwarded-Arg Handling" + "Memory Accuracy Preserved Across Sections")

## Phase 3: Verification Gates

- [x] T006 Run `grep -n 'wantSuffix' app/backend/cmd/rk/riff_test.go` and confirm zero hits. Run `grep -n 'subsitutions' fab/changes/260416-r1j6-add-riff-command/spec.md` and confirm zero hits. Run `grep -n 'cmd\.Args' docs/memory/run-kit/rk-riff.md` and confirm zero hits. Run `grep -n 'Exported for' app/backend/cmd/rk/riff.go` and confirm zero hits (the old misleading comment must be gone). Any non-zero result fails the task. (Spec: scenarios "Field is absent after the edit", "Typo fixed in place", "File audit confirms no other `cmd.Args` misuses", "No false export claim")

- [x] T007 Run `grep -n '[\x{2018}-\x{201F}]' app/backend/cmd/rk/riff.go` (or ripgrep with `[\u2018-\u201F]`) to confirm no Unicode General Punctuation quote characters remain in the file. Zero hits = pass. (Spec: scenario "Minimum grammar fix present" — curly-quote absence)

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
