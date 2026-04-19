# Tasks: Move Visual Display Recipe into `rk context`, collapse fab-kit duplicate

**Change**: 260419-l1ja-fix-rk-iframe-relative-urls
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

<!-- No setup steps required. -->

## Phase 2: Core Implementation

- [x] T001 Revert the earlier transient edit to `.claude/skills/_preamble/SKILL.md` (the gitignored `fab sync`-deployed copy). Run `diff ~/.fab-kit/versions/1.5.0/kit/skills/_preamble.md .claude/skills/_preamble/SKILL.md`, then copy the sync-source over the deployed copy so the two are byte-identical. Verify with a second `diff` (should produce no output).

- [x] T002 Extend `rk context` output with a new Visual Display Recipe subsection. Edit `app/backend/cmd/rk/context.go` — inside the `writeCapabilities` function, after the `### Proxy` block (currently ending at line ~122) and before the `### CLI Commands` block (currently starting at line ~124), insert:
    - A subsection heading `### Visual Display Recipe`
    - A one-sentence intro explaining this is the recipe for displaying HTML content in an iframe window, and that steps SHALL fail silently if prerequisites (rk, port, server) are unavailable
    - Step 1: Generate HTML to a known location
    - Step 2: Serve it via `python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &` (loopback-bound — not exposed on LAN)
    - Step 3: Open an iframe window pointing to the relative proxy path:
      ```sh
      tmux new-window -n <name>
      tmux set-option -w @rk_type iframe
      tmux set-option -w @rk_url /proxy/<port>/<filename>
      ```
      With narrative text explaining the relative path is resolved by the run-kit frontend against whatever origin the user is using, so the recipe works identically on `localhost:3000` or behind a reverse proxy.
    - Step 4: Fail silently if any step's prerequisite is unavailable.

- [x] T003 Extend `app/backend/cmd/rk/context_test.go` with a new test (or extend `TestContextCapabilitiesSections`) that asserts:
    - Output contains `### Visual Display Recipe`
    - Output contains `tmux set-option -w @rk_url /proxy/<port>/<filename>` (exact substring — verifies step 3 uses relative form)
    - Output contains `python3 -m http.server --bind 127.0.0.1` (verifies loopback-bound example)
    - Output does NOT contain `{server_url}/proxy` anywhere in the Visual Display Recipe's step 3 (guard against regression)
    - The Visual Display Recipe appears after `### Proxy` and before `### CLI Commands` in the output (verify ordering via `strings.Index`)
  Run `go test ./app/backend/cmd/rk/...` — all tests MUST pass.

- [x] T004 Edit fab-kit preamble at `~/code/sahil87/fab-kit/src/kit/skills/_preamble.md`. Replace the entire `### Visual Display Recipe` subsection (lines ~228–247, including the `#### Visual-Explainer Integration` sub-subsection) with a short subsection that:
    - Keeps the `### Visual Display Recipe` heading
    - Replaces the 4-step recipe body with a pointer directing the reader to call `rk context` at use-time (explain: the recipe is authored in run-kit since it's run-kit-specific; `rk context` is the single source of truth; duplication caused past drift)
    - Preserves the fail-silent rule (any step failing causes the skill to skip remaining steps without error)
    - Preserves the `#### Visual-Explainer Integration` sub-subsection about delegating HTML generation to the `visual-explainer` plugin when available (falling back to the `rk context` recipe for display)

- [x] T005 Commit the fab-kit edit locally. In `~/code/sahil87/fab-kit/`:
    - Run `git status` and `git diff -- src/kit/skills/_preamble.md` to confirm only the Visual Display Recipe subsection is in the diff (no other subsection changes).
    - Stage only `src/kit/skills/_preamble.md` (`git add src/kit/skills/_preamble.md`).
    - Create a commit with a message summarizing the move: subject like `docs(preamble): collapse Visual Display Recipe to rk context pointer` and a short body explaining the run-kit `rk context` is now the single source of truth for the iframe/loopback/relative-proxy workflow.
    - Do NOT push, do NOT open a PR — leave that to the user.

## Phase 3: Integration & Edge Cases

- [x] T006 Cross-check verification greps (run from run-kit worktree root):
    - `grep -rn '{server_url}/proxy' .claude/skills/ 2>&1` — after T001's revert, should show 2 matches, both in the preserved `### Proxy` subsection of the deployed `_preamble` copy (server-side pattern, correct). No matches should be inside any Visual Display Recipe or iframe-composition context.
    - `grep -rn '/proxy/<port>/<filename>' app/backend/cmd/rk/context.go` — MUST show exactly 1 match, inside the new Visual Display Recipe subsection.
  Report pass/fail for each.

- [x] T007 Cross-check fab-kit verification greps (run from `~/code/sahil87/fab-kit/`):
    - `grep -n '{server_url}/proxy' src/kit/skills/_preamble.md` — MUST show matches only within the `### Proxy` subsection (server-side pattern). No match inside the collapsed Visual Display Recipe subsection or any iframe-composition context.
    - `grep -n 'Visual Display Recipe' src/kit/skills/_preamble.md` — MUST show the heading is still present (pointer, not deletion).
    - `grep -c '4-step' src/kit/skills/_preamble.md` — SHOULD be 0 (the 4-step prose is gone, replaced by a pointer).
  Report pass/fail for each.

- [x] T008 Update `docs/memory/run-kit/architecture.md` — add a short sentence to the `rk context` entry (or create one if absent) noting that `rk context` now documents the Visual Display Recipe (iframe display flow with relative `@rk_url`) as the canonical recipe. Keep the edit to a single sentence or clause; do not rewrite surrounding context.

## Phase 4: Polish

<!-- Not applicable. -->

---

## Execution Order

- T001 is independent — do it first to revert the stale local edit.
- T002 and T003 are tightly coupled (implementation + tests); run T002 then T003.
- T004 (fab-kit edit) is independent of T002/T003 but should happen before T005 (its commit).
- T005 depends on T004.
- T006 depends on T001.
- T007 depends on T004 (and optionally T005 — diff-vs-worktree is the same either way).
- T008 is independent; can run any time after T002.

Parallelizable groups (after T001, T002, T003):
- T004 → T005 (fab-kit side)
- T006 (run-kit verification)
- T008 (memory update)
