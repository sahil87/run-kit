# Quality Checklist: Name the tmux window created by `rk riff` after the worktree

**Change**: 260417-w4af-name-riff-window-after-worktree
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Stable window name derived from worktree basename: `runTmuxNewWindow` (via `buildNewWindowArgs`) emits `-n riff-<filepath.Base(worktreePath)>` as distinct argv elements in the `tmux new-window` invocation
- [x] CHK-002 Name stability for the window's lifetime: `-n <name>` alone is the mechanism; no test or code path couples to tmux's `automatic-rename` option
- [x] CHK-003 Backward-compatible invocation surface: No change to `rk riff` flags, arguments, exit codes (0/2/3), or stdout/stderr — the only observable change is the window name
- [x] CHK-004 Test seam exists: `buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string` is a pure, exported-within-package helper with no side effects, and `runTmuxNewWindow` calls it to produce the argv slice
- [x] CHK-005 Memory documentation reflects the new invocation: `docs/memory/run-kit/rk-riff.md` Step 5 shows `tmux new-window -n riff-<worktree-basename> -c <worktree-path> "<launcher> '<cmd>'"` and explains the rationale (hydrate stage will complete this)

## Behavioral Correctness
- [x] CHK-006 Argv order is `new-window -n <name> -c <path> <shellCmd>`: helper returns slice in that exact order per Design Decision #5
- [x] CHK-007 Name derivation uses `filepath.Base` (no pre-`Clean`, no regex): helper source implements the literal string concat `"riff-" + filepath.Base(worktreePath)`
- [x] CHK-008 Trailing-slash worktree paths yield stripped basenames: `/tmp/myrepo.worktrees/alpha/` → `riff-alpha`
- [x] CHK-009 Relative worktree path with no directory component yields bare basename: `alpha` → `riff-alpha`

## Scenario Coverage
- [x] CHK-010 "Typical worktree under `.worktrees/` directory" scenario exercised by `TestBuildNewWindowArgs` with `/home/sahil/.../run-kit.worktrees/pacing-canyon`
- [x] CHK-011 "Worktree path with trailing slash" scenario exercised by `TestBuildNewWindowArgs` with `/tmp/myrepo.worktrees/alpha/`
- [x] CHK-012 "Relative worktree path" scenario exercised by `TestBuildNewWindowArgs` with `alpha`
- [x] CHK-013 "Security constraint — argv-distinct flag" scenario exercised: the test asserts `-n` and the name are **adjacent separate slice elements**, never a single concatenated string
- [x] CHK-014 "Helper is called by runTmuxNewWindow" scenario: code path verified by reading `runTmuxNewWindow` — the `exec.CommandContext` argv after `"tmux"` equals `buildNewWindowArgs(...)`

## Edge Cases & Error Handling
- [x] CHK-015 `cmdArg` containing single quotes is correctly escaped in the shell-command slice element (e.g., `it's a test` → `'it'\''s a test'`), verified by `TestBuildNewWindowArgs` escape-case row
- [x] CHK-016 Empty launcher tolerated — helper produces a slice even when launcher is `""`; no panic, no error. This is a defensive assertion that the helper is purely compositional and does not pre-validate its inputs
- [x] CHK-017 Split-window path (optional `--split` flag) does NOT receive `-n`: `runTmuxSplitWindow` is unchanged — the split inherits the window's name

## Code Quality
- [x] CHK-018 Pattern consistency: `buildNewWindowArgs` follows the existing riff.go helper pattern (pure functions with short doc comments, e.g., `parseWorktreePath`, `escapeSingleQuotes`, `resolveLauncher`)
- [x] CHK-019 No unnecessary duplication: `buildNewWindowArgs` reuses `escapeSingleQuotes` for the single-quote encoding; does not reimplement it
- [x] CHK-020 Go backend subprocess discipline (code-quality §Principles): `-n` is a distinct argv element to `exec.CommandContext` — no shell-string interpolation for user-derived input
- [x] CHK-021 No god functions (code-quality §Anti-Patterns): `buildNewWindowArgs` is <10 lines; `runTmuxNewWindow` remains short (<30 lines including the new call)
- [x] CHK-022 No magic strings: the `"riff-"` prefix is a module-local literal used in exactly one place (the helper); adding a const is not warranted for a single use site
- [x] CHK-023 New features include tests (code-quality §Principles): `TestBuildNewWindowArgs` covers the added behavior with 5+ cases

## Security
- [x] CHK-024 Constitution §I (Security First) preserved: window-name construction does not shell-escape or interpolate the basename into a shell string — it's an argv slice element, passed verbatim to `exec.CommandContext`
- [x] CHK-025 `worktreePath` is already `os.Stat`-validated by `runWtCreate` before reaching the helper — no additional validation is required in the helper itself

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-nnn **N/A**: {reason}`
