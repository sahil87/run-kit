# Quality Checklist: Move Visual Display Recipe into `rk context`, collapse fab-kit duplicate

**Change**: 260419-l1ja-fix-rk-iframe-relative-urls
**Generated**: 2026-04-20
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 `rk context` output Capabilities section contains a new `### Visual Display Recipe` subsection placed between `### Proxy` and `### CLI Commands`.
- [x] CHK-002 Visual Display Recipe step 3 in `rk context` output contains the exact string `tmux set-option -w @rk_url /proxy/<port>/<filename>` — relative path, no host, no scheme.
- [x] CHK-003 Visual Display Recipe step 2 in `rk context` output contains the loopback-bound example `python3 -m http.server --bind 127.0.0.1`.
- [x] CHK-004 Visual Display Recipe includes a fail-silent step-4 statement (any step's failure causes the skill to skip remaining steps without error).
- [x] CHK-005 Visual Display Recipe narrative explains the relative path is resolved against the user's browser origin — works identically direct or reverse-proxied.
- [x] CHK-006 `rk context` output outside the new subsection is byte-identical to pre-change (existing Environment, Terminal Windows, Iframe Windows, Proxy, CLI Commands, Conventions sections untouched).
- [x] CHK-007 fab-kit `~/code/sahil87/fab-kit/src/kit/skills/_preamble.md` `### Visual Display Recipe` subsection replaced with a pointer to `rk context`; 4-step prose removed.
- [x] CHK-008 fab-kit Visual-Explainer Integration sub-subsection preserved.
- [x] CHK-009 fab-kit other rk-reference subsections (Detection, Iframe Windows, Proxy, Server URL Discovery) untouched.
- [x] CHK-010 fab-kit edit committed locally in `~/code/sahil87/fab-kit/` (single commit, single file in diff); not pushed.

## Behavioral Correctness

- [x] CHK-011 Local `.claude/skills/_preamble/SKILL.md` in the run-kit worktree is byte-identical to `~/.fab-kit/versions/1.5.0/kit/skills/_preamble.md` (the transient edit is reverted).
- [x] CHK-012 `.claude/skills/_preamble/SKILL.md` does not appear in `git status` output from the run-kit worktree (confirmed gitignored; no accidental tracking).

## Scenario Coverage

- [x] CHK-013 Existing `TestContextCapabilitiesSections` and all other tests in `app/backend/cmd/rk/context_test.go` still pass.
- [x] CHK-014 New test assertion(s) for Visual Display Recipe heading presence pass.
- [x] CHK-015 New test assertion for exact relative `@rk_url` string `/proxy/<port>/<filename>` passes.
- [x] CHK-016 New test assertion for loopback-bound python server example passes.
- [x] CHK-017 New test assertion that the Visual Display Recipe appears between `### Proxy` and `### CLI Commands` (ordering via `strings.Index`) passes.
- [x] CHK-018 Regression guard: new test assertion that `{server_url}/proxy` does not appear inside the Visual Display Recipe subsection passes.

## Edge Cases & Error Handling

- [x] CHK-019 `rk context` still exits 0 and produces non-empty output outside tmux (existing `TestContextOutsideTmux`, `TestContextExitsZero` still pass).
- [x] CHK-020 Environment-variable-driven server URL behavior preserved (existing `TestContextServerURLFromEnv` still passes — serverURL() remains untouched).

## Code Quality

- [x] CHK-021 Pattern consistency: the new subsection in `writeCapabilities` follows the existing `b.WriteString(...)` style — no refactor, no new helpers, same formatting cadence as the surrounding subsections.
- [x] CHK-022 Constitution compliance — "No Database" (unchanged; no state introduced), "Security First" (loopback-only example explicitly directs `--bind 127.0.0.1` to avoid LAN exposure).
- [x] CHK-023 No unnecessary duplication: after this change, the Visual Display Recipe exists in exactly one place (`rk context` output). fab-kit holds only a pointer.
- [x] CHK-024 fab-kit commit message follows Conventional Commits style (`docs(preamble): ...` or similar) consistent with fab-kit's prior commit history.

## Security

- [x] CHK-025 Local HTTP server example uses loopback `--bind 127.0.0.1` (never `0.0.0.0`). Run-kit's proxy is the only exposure path.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
