# Spec: Move Visual Display Recipe into `rk context`, collapse fab-kit duplicate

**Change**: 260419-l1ja-fix-rk-iframe-relative-urls
**Created**: 2026-04-19
**Affected memory**: `docs/memory/run-kit/architecture.md` (modify — add Visual Display Recipe to `rk context` summary)

## Non-Goals

- Rewriting any other `rk context` subsection (Iframe Windows, Proxy, Server URL Discovery, Terminal Windows, CLI Commands, Conventions). They remain byte-identical.
- Touching fab-kit's other Run-Kit (rk) Reference subsections (`### Detection`, `### Iframe Windows`, `### Proxy`, `### Server URL Discovery`). They remain as-is.
- Changing the `/proxy/{port}/...` server-side proxy documentation anywhere — it is correct.
- Modifying `app/frontend/src/components/iframe-window.tsx` — it already uses the relative form.
- Changing the `serverURL()` helper or `RK_HOST`/`RK_PORT` handling in `rk context`.
- Adding new CLI flags, config keys, or env vars.
- Any change to the run-kit HTTP API, tmux integration, or SSE transport.

## Background

Two documentation sources currently describe how agents should construct iframe URLs:

1. **`rk context` output** (`app/backend/cmd/rk/context.go`) — run-kit's authoritative self-documentation. Its `### Iframe Windows` section uses a `<url>` placeholder (no absolute composition). Its `### Proxy` section already uses a relative `/proxy/{port}/...` pattern. **Correct but incomplete** — there is no combined recipe that stitches iframe + local HTTP server + relative proxy URL into a full workflow.

2. **fab-kit `_preamble.md`** (at `~/code/sahil87/fab-kit/src/kit/skills/_preamble.md`, deployed via `fab sync` into `.claude/skills/_preamble/SKILL.md`) — contains a duplicated `### Visual Display Recipe` subsection. Its step 3 instructs callers to compose an absolute URL as `{server_url}/proxy/<port>/<filename>`. **Wrong** — when the user accesses rk through a reverse proxy, `{server_url}` (the server's bind address returned by `rk context`) does not match the browser origin, and the iframe fails to load.

The duplication is the root cause of the drift. The architectural fix is for run-kit to own the recipe in `rk context` output, and for fab-kit to drop the duplicate and point at `rk context` instead.

## Run-Kit: `rk context` extension

### Requirement: `rk context` output SHALL include a Visual Display Recipe section

The Capabilities section of `rk context` output SHALL include a new `### Visual Display Recipe` subsection, placed after the existing `### Proxy` subsection and before the `### CLI Commands` subsection. The subsection SHALL document the 4-step flow an agent follows to display HTML content to the user: (1) generate HTML to a known location, (2) serve it via a loopback-bound local HTTP server, (3) open an iframe window whose `@rk_url` is a **relative path** of the form `/proxy/<port>/<filename>`, (4) fail silently at any step if prerequisites are unavailable.

#### Scenario: Recipe is present in output

- **GIVEN** `rk context` is run (inside or outside tmux)
- **WHEN** the caller inspects the Capabilities section
- **THEN** the output contains a line matching `### Visual Display Recipe`
- **AND** the subsection appears between `### Proxy` and `### CLI Commands`

#### Scenario: Recipe uses relative `@rk_url`

- **GIVEN** `rk context` is run
- **WHEN** the caller reads step 3 of the Visual Display Recipe
- **THEN** the `tmux set-option -w @rk_url ...` example shows exactly `/proxy/<port>/<filename>` (no host, no scheme, no `{server_url}` substitution)
- **AND** the step explains that the relative path is resolved by the run-kit frontend against whatever origin the user is using, so the recipe works identically whether accessed at `localhost:3000` directly or behind a reverse proxy

#### Scenario: Recipe includes loopback-bound local server example

- **GIVEN** `rk context` is run
- **WHEN** the caller reads step 2
- **THEN** the recipe shows a local-HTTP-server example bound to `127.0.0.1` (loopback-only, not LAN-exposed) — e.g., `python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &`

#### Scenario: Recipe includes fail-silent guidance

- **GIVEN** `rk context` is run
- **WHEN** the caller reads step 4
- **THEN** the recipe states that any failure (rk missing, port in use, server start fails) SHALL cause the skill to skip remaining steps without error

### Requirement: Existing `rk context` subsections SHALL remain byte-identical

All existing subsections of `rk context` output outside the newly added Visual Display Recipe (Environment, Terminal Windows, Iframe Windows, Proxy, CLI Commands, Conventions) SHALL produce byte-identical output to their pre-change form.

#### Scenario: Existing output preserved

- **GIVEN** `rk context` is run before and after the change
- **WHEN** the two outputs are diffed
- **THEN** the diff is entirely additive — only the new Visual Display Recipe subsection appears as added lines, no existing lines are modified or removed

### Requirement: Tests SHALL verify the new subsection

`app/backend/cmd/rk/context_test.go` SHALL include coverage asserting: (a) the `### Visual Display Recipe` subsection heading is present, (b) the step-3 `@rk_url` example value is exactly `/proxy/<port>/<filename>` (no `{server_url}`, no host, no scheme), (c) the step-2 loopback-bound `python3 -m http.server --bind 127.0.0.1` example is present.

#### Scenario: Tests pass

- **GIVEN** `go test ./app/backend/cmd/rk/...` is run
- **WHEN** the test binary executes
- **THEN** the test suite exits 0
- **AND** all new assertions about the Visual Display Recipe are in the passing set

## Fab-Kit: collapse duplicated Visual Display Recipe

### Requirement: fab-kit `_preamble.md` Visual Display Recipe SHALL be replaced with a `rk context` pointer

In `~/code/sahil87/fab-kit/src/kit/skills/_preamble.md`, the `### Visual Display Recipe` subsection (including its `#### Visual-Explainer Integration` sub-subsection) SHALL be replaced with a short pointer directing readers to call `rk context` at use-time for the authoritative recipe. The pointer SHALL retain the fail-silent rule and the Visual-Explainer Integration note.

#### Scenario: Duplicated recipe removed

- **GIVEN** a reader opens the post-change fab-kit `_preamble.md`
- **WHEN** they look for a 4-step Visual Display Recipe
- **THEN** no such recipe is present
- **AND** in its place is a short subsection pointing to `rk context` output as the authoritative source

#### Scenario: Visual-Explainer Integration note preserved

- **GIVEN** the post-change fab-kit `_preamble.md`
- **WHEN** a reader looks for guidance on the `visual-explainer` plugin
- **THEN** the note about delegating HTML generation to `visual-explainer` (when available) and falling back to the `rk context` recipe is preserved

#### Scenario: Absolute-URL pattern removed from iframe-composition contexts

- **GIVEN** the post-change fab-kit `_preamble.md`
- **WHEN** an operator runs `grep -n '{server_url}/proxy' src/kit/skills/_preamble.md` inside the fab-kit repo
- **THEN** matches appear **only** within the `### Proxy` subsection (the server-side pattern, preserved)
- **AND** no match appears within any `@rk_url` or iframe-composition context

### Requirement: Other fab-kit rk-reference subsections SHALL remain unchanged

`### Detection`, `### Iframe Windows`, `### Proxy`, and `### Server URL Discovery` subsections of fab-kit `_preamble.md` SHALL remain byte-identical. Their content is still useful, still correct for server-side consumers, and is out of scope for this change.

#### Scenario: Other subsections untouched

- **GIVEN** the fab-kit change is committed
- **WHEN** `git diff HEAD~1 -- src/kit/skills/_preamble.md` is run in the fab-kit repo
- **THEN** the diff lines are entirely within the Visual Display Recipe subsection replacement
- **AND** no other subsection appears in the diff

### Requirement: fab-kit change SHALL be committed in the fab-kit repo

The fab-kit edit SHALL be committed locally in `~/code/sahil87/fab-kit/` (git working tree directly, not via the run-kit PR). Push/PR creation is out of scope for this change — it is left for the user to perform at their discretion.

#### Scenario: Commit lands in fab-kit

- **GIVEN** the fab-kit edit is complete
- **WHEN** `git log -1 --name-only` is run in `~/code/sahil87/fab-kit/`
- **THEN** the top commit contains `src/kit/skills/_preamble.md` in the changed-files list
- **AND** the commit message mentions the Visual Display Recipe collapse or `rk context` pointer

## Run-kit deployed copy: revert transient edit

### Requirement: The run-kit-worktree deployed copy SHALL NOT contain local edits

Any edits previously made to `.claude/skills/_preamble/SKILL.md` in the run-kit worktree (the `fab sync`-deployed, gitignored copy of fab-kit's preamble) SHALL be reverted. The deployed copy SHALL be byte-identical to `~/.fab-kit/versions/1.5.0/kit/skills/_preamble.md` (the sync source). Post-fab-kit-edit, the correct recipe will arrive via `fab sync`.

#### Scenario: Deployed copy matches sync source

- **GIVEN** the run-kit worktree's `.claude/skills/_preamble/SKILL.md` after the revert
- **WHEN** it is diffed against `~/.fab-kit/versions/1.5.0/kit/skills/_preamble.md`
- **THEN** `diff` reports no differences

#### Scenario: No run-kit repo diff from the deployed copy

- **GIVEN** `.claude/` is gitignored in run-kit (`/.claude` in `.gitignore:146`)
- **WHEN** `git status` is run in the run-kit worktree
- **THEN** `.claude/skills/_preamble/SKILL.md` does not appear — gitignored — and does not contribute to the run-kit PR surface area

## Design Decisions

1. **Make `rk context` output the single source of truth for run-kit workflow recipes.**
   - *Why*: `rk context` is the run-time communication layer between run-kit and agents. Agents already call it to discover capabilities. Centralizing the Visual Display Recipe here eliminates the drift class of bugs that caused this issue in the first place. It also means the recipe is tested by Go tests in `app/backend/cmd/rk/` rather than existing only as un-validated prose in a sibling repo.
   - *Rejected*: Leave the recipe duplicated in both places and add a lint check. Adds test infrastructure to enforce consistency of two sources that don't need to exist.
   - *Rejected*: Move the recipe to fab-kit's `_preamble.md` as the canonical home and remove the `rk context` duplication. Wrong direction — the recipe is run-kit-specific (loopback HTTP server, `/proxy/...` path, rk iframe windows). Fab-kit should not carry run-kit-specific workflow knowledge.

2. **Replace fab-kit's recipe with a `rk context` pointer instead of deleting the subsection.**
   - *Why*: The pointer tells future readers where the recipe moved. Outright deletion loses the discovery path and would confuse agents that previously relied on the subsection.
   - *Rejected*: Delete the subsection entirely. Less discoverable; breaks existing agent heuristics that scan the preamble.

3. **Preserve the Visual-Explainer Integration note in fab-kit.**
   - *Why*: This note describes how fab-kit skills may delegate HTML generation to the `visual-explainer` plugin — independent of the run-kit-specific display mechanics. It is not drift; it is genuinely fab-kit-side integration guidance.
   - *Rejected*: Move it to `rk context`. `visual-explainer` is a plugin in the fab-kit/Claude-Code ecosystem, not run-kit; the note belongs where fab-kit agents will read it.

4. **Do not also collapse `### Iframe Windows`, `### Proxy`, or `### Server URL Discovery` in fab-kit.**
   - *Why*: Those subsections document run-kit primitives that remain useful in fab-kit's preamble (they are short, factual, and agents use them as quick reference without needing to call `rk context`). They do not carry the drift risk the Visual Display Recipe did, because they document primitives (not workflows that duplicate logic). Scope creep otherwise.
   - *Rejected*: Collapse all four into a single "see `rk context`" pointer. Over-reach — deletes useful reference content; could be revisited as a follow-up.

5. **Do not push or PR the fab-kit change as part of this flow.**
   - *Why*: The user explicitly asked to `git commit` in the fab-kit folder. Pushing or opening a PR is a separate action with a different blast radius and is out of scope. The user will push when they choose to.
   - *Rejected*: Auto-push to fab-kit's `origin/main`. Violates the spirit of asking before taking shared-state actions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `rk context` is the single source of truth for run-kit workflow recipes. | User-confirmed reframe: "rk context is the communication layer between run-kit and fab-kit." | S:95 R:80 A:95 D:95 |
| 2 | Certain | The Visual Display Recipe lives in `rk context` output (Capabilities section, between Proxy and CLI Commands). | Natural placement — after the primitives (Iframe Windows, Proxy) it stitches together, before the command index. | S:90 R:85 A:90 D:90 |
| 3 | Certain | Step-3 `@rk_url` value is `/proxy/<port>/<filename>` (relative, no host, no scheme). | Core fix. Matches `iframe-window.tsx:119` runtime behavior and user's explicit instruction. | S:100 R:90 A:100 D:100 |
| 4 | Certain | fab-kit's Visual Display Recipe subsection collapses to a "call `rk context`" pointer. | Eliminates duplication = eliminates drift. User confirmed the direction. | S:95 R:85 A:95 D:95 |
| 5 | Certain | Visual-Explainer Integration note stays in fab-kit. | It's fab-kit-side ecosystem integration, not run-kit workflow. Preserves the existing fallback flow. | S:90 R:90 A:95 D:95 |
| 6 | Confident | Other fab-kit rk-reference subsections (Detection, Iframe Windows, Proxy, Server URL Discovery) remain unchanged. | They document primitives, are short and correct, and don't carry drift risk. Scope discipline. Reversible via a follow-up. | S:80 R:90 A:85 D:75 |
| 7 | Certain | Revert the earlier edit to the deployed `.claude/skills/_preamble/SKILL.md`. | Avoids local/upstream divergence; the corrected content arrives via `fab sync` after fab-kit commits. Also gitignored, so keeping the edit contributes nothing to the run-kit PR. | S:95 R:95 A:95 D:95 |
| 8 | Certain | fab-kit change is committed locally in its own repo; no push/PR in this flow. | User said "git commit in that folder" — commit only. Push/PR is a separate, user-initiated action. | S:100 R:80 A:95 D:100 |
| 9 | Certain | Change type is `fix`. | Framing is still "fix the iframe URL recipe" — the architectural reframe doesn't change the type classification. | S:95 R:85 A:95 D:95 |
| 10 | Certain | Memory update: `docs/memory/run-kit/architecture.md` (modify) to add a line about the Visual Display Recipe now living in `rk context` output. | Architectural facts about `rk context` belong in the run-kit architecture memory. Small one-line addition. | S:85 R:90 A:90 D:90 |
| 11 | Certain | Go tests extend `context_test.go` with assertions for the new subsection and its step-3 relative-path value. | Matches the existing test style (`TestContextCapabilitiesSections` already asserts on `### Proxy`, `/proxy/{port}/`, etc.). | S:95 R:90 A:95 D:95 |

11 assumptions (10 certain, 1 confident, 0 tentative, 0 unresolved).
