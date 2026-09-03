# Intake: Retire `.spec.md` Companion Docs for In-File Test Intent Comments

**Change**: 260828-0daa-retire-spec-md-companion-docs
**Created**: 2026-08-28

## Origin

Promptless dispatch from `/fab-proceed` (no questions asked; every would-be question is recorded in `## Assumptions` with a `Deferred — promptless dispatch` rationale and the default taken — rows 12–15). The change description was synthesized from a discussion on 2026-08-28 that reviewed evidence on the constitution's "Test Companion Docs (`.spec.md`)" constraint (added 2026-04-17, PR #157) and decided to retire it.

> Retire the `.spec.md` Playwright companion-doc convention in favor of in-file doc-comments. Amend the constitution (replace the "Test Companion Docs" constraint with a "Test Intent Comments" rule), fold each of the 86 companion mds into a `/** Proves: … Steps: … */` JSDoc block above the matching `test()` plus a file-header comment for shared setup, delete the 86 `.spec.md` files, and sweep the rest of the repo (skills, in-spec `// See foo.spec.md` pointers, memory-file `(+ .spec.md)` pointers). Tests must not change behavior — comments and deletions only.

Decisions carried from the discussion: (1) doc-comments over a CI drift-check for the mds; (2) one convention, not "mds only for long specs"; (3) change-ID citations and "Since <id>…" history are dropped during the fold — memory files own history; (4) where md and test have drifted, the test body is the source of truth; (5) a cross-file extraction recipe is optional, not core scope.

## Why

**Problem.** The constitution requires every `app/frontend/tests/e2e/*.spec.ts` to ship a sibling `*.spec.md` (per-test "what it proves" + numbered steps, plus a Shared setup section). Verified on this worktree at intake time:

- 86 `.spec.ts` / 86 `.spec.md`; the mds total **9,503 lines** against **18,707 lines** of tests (~51%). Six mds are ≥ 90% the length of their test file: `smoke` (433%), `pwa-assets` (107%), `server-panel-grid` (100%), `sessions-scope-toggle` (92%), `host-health-home` (92%), `sse-connection` (90%).
- Per the discussion's git survey, 186 of 753 commits since the rule landed touched a `.spec.md` (~25% of commits pay the tax).
- **Nothing consumes them.** No CI step, script, `justfile` recipe, `playwright.config.ts` entry, or fab skill reads `.spec.md` (grep over `justfile`, `scripts/`, `.github/`, `README.md`, `docs/site/` returns nothing). The constitution is the only binding reference.
- **Drift exists.** The discussion found 7 of 366 test titles no longer appear verbatim in their sibling md (`chat-view` ×2, `macro-riff-bindings`, `shortcut-registry`, `sync-latency` ×2, `window-heading`). Drift is low only because agents rewrite the md on every change — that rewrite is the cost.
- **Scope bleed.** The mds carry **291** change-ID citations (`2YMMDD-xxxx`) and "Since <id>…" history paragraphs — provenance narration that `fab/project/code-quality.md` § Anti-Patterns ("Comment narration … never cite change IDs / PR numbers — git history owns provenance") bans from code comments and that `docs/memory/` already owns. The mds have become a shadow memory layer.
- The genuinely useful part — a plain-language "what it proves" + steps per test, readable without knowing Playwright APIs — is fully served by a doc-comment directly above each `test()`, in the same diff hunk a reviewer already reads. Several specs already carry header comments of this shape (`top-bar-refresh`, `zen-mode`, `sidebar-section-rail`, `compose-strip`, …).

**Consequence of not fixing.** Every e2e change keeps paying a ~50% documentation tax to maintain a parallel artifact nobody reads, while the artifact silently accumulates history narration and drifts from the tests it describes.

**Why this approach.** Rejected alternatives: (a) keep the mds and add a CI drift check — adds tooling to protect a parallel artifact nobody reads; (b) keep mds only for long specs — two conventions is worse than one. In-file JSDoc keeps the intent text adjacent to the code it describes, so it moves in the same hunk and drift becomes visible in review.

## What Changes

### 1. Constitution amendment (`fab/project/constitution.md`)

Replace the `### Test Companion Docs (\`.spec.md\`)` constraint (under `## Additional Constraints`) with a `### Test Intent Comments` constraint. Proposed text (apply verbatim unless review finds a wording defect):

```markdown
### Test Intent Comments
Every Playwright `test()` in `app/frontend/tests/e2e/*.spec.ts` MUST carry a JSDoc block immediately above it stating (a) **Proves:** the user-visible behavior under test, in one or two sentences, and (b) **Steps:** a numbered list mirroring the test body, so a reviewer can reason about intent without reading Playwright APIs. Each spec file MUST open with a file-header comment covering shared setup — `beforeAll`/`beforeEach`, fixtures, viewport, `page.route` stubs, and any host-global state the file saves/restores. Intent comments state what the test proves and why the setup is shaped as it is; they SHALL NOT narrate history or cite change IDs / PR numbers (git history and `docs/memory/` own provenance). There are no companion `.spec.md` files: PRs that add or modify a `test()` SHALL update its intent comment in the same commit. Unit tests (`*.test.ts`/`*.test.tsx`, `*_test.go`) are exempt — their scope is narrow enough that the test name plus code is self-documenting.
```

Governance line: bump **Version** `1.10.0` → `1.11.0` (minor — a constraint is replaced, not removed outright) and **Last Amended** → `2026-08-28`.

Comment shape (the target for every `test()`):

```ts
/**
 * Proves: entering zen via ⇧Ctrl+⏎ at arity 1 hides the top bar and sidebar,
 * keeps the status bar with its exit button, and never writes the persisted
 * sidebar preference; the exit button restores exactly the persisted chrome.
 *
 * Steps:
 * 1. Create window A; navigate; wait for the tty tile.
 * 2. Assert baseline: top bar, sidebar, status bar visible; no exit button;
 *    the seeded preference reads "true".
 * 3. Click into xterm, press ⇧Ctrl+⏎; assert top bar + sidebar hidden, …
 */
test("enter via ⇧⌘⏎ hides top bar + sidebar at arity 1, …", async ({ page }) => {
```

`test.describe` blocks need no block of their own; the per-`test()` block is the unit. Tests inside a `describe` still get their own block.

### 2. Mechanical migration of 86 spec files (`app/frontend/tests/e2e/`)

For each `X.spec.ts` with sibling `X.spec.md`:

1. **File header.** Fold the md's `## Shared setup` (and any file-level intro paragraph) into a `/** … */` or `//` header comment at the top of the spec file (after imports is acceptable if a header already exists there — keep one header, merge rather than duplicate). Where the file already has a header comment (`top-bar-refresh`, `zen-mode`, `sidebar-section-rail`, `compose-strip`, `chat-view`, `open-in-app`, `right-panel`, `surface-layout`, …), merge: keep the existing constraints text, add missing setup facts, and remove any `See X.spec.md for intent + steps.` / `see the sibling .spec.md` sentence (22 spec files carry such a pointer — list below).
2. **Per-test block.** For each `test()`, fold the md's matching `### <title>` section (`What it proves:` + `Steps:`) into a JSDoc block immediately above the `test(` line, in the shape above. Match md sections to tests by title; where a title does not match verbatim (the 7 drift cases: `chat-view` ×2, `macro-riff-bindings`, `shortcut-registry`, `sync-latency` ×2, `window-heading` — re-verify the list during apply), read the test body and write the comment to match the **test**, not the stale md.
3. **Drop history.** While folding, drop change-ID citations (`2YMMDD-xxxx`), PR numbers, and "Since <id> …" / "the pre-<id> gap" narration. Keep only constraints the code can't show (why a stub is shaped a certain way, why a wait is needed, cross-file contracts). Target: zero `2[0-9]{5}-[a-z0-9]{4}` matches in `app/frontend/tests/e2e/*.spec.ts` comments introduced by this change (pre-existing citations in spec.ts comments may be cleaned when touched but are not a hard requirement).
4. **Delete** `X.spec.md` (`git rm`). End state: `ls app/frontend/tests/e2e/*.spec.md` is empty.

No `test()` body, title, fixture, import, or helper changes. `test.skip`/`test.fixme` entries are documented like any other test.

Spec files with in-code `.spec.md` pointers to remove (22): `agent-next-waiting`, `chat-view`, `compose-strip`, `macro-riff-bindings`, `open-in-app`, `operator-compose`, `operator-digest`, `pane-register-panel`, `pr-status-sidebar`, `recovery-section`, `right-panel`, `row-flyout`, `row-identity-tips`, `row-minimalism`, `shortcut-registry`, `sidebar-section-rail`, `sort-windows`, `spawn-agent`, `status-bar`, `surface-layout`, `top-bar-persistence`, `top-bar-refresh`.

Scale hint for planning: 366 `test()` calls across 86 files (107 `test.describe` blocks). Parallelizable per file; a per-file subagent fan-out off a shared brief is the natural shape.

### 3. Repo-wide sweep for the convention

- **`.claude/skills/_generation/SKILL.md` and `.claude/skills/_cli-fab/SKILL.md`** — verified at intake: their `spec.md` mentions refer to fab's **legacy change artifact** `fab/changes/*/spec.md` (the removed `spec` stage), **not** the Playwright companion doc. Both files are `fab sync` copies of `~/.fab-kit/versions/2.21.0/kit/skills/*.md` (upstream fab-kit). **No edit** — they are out of scope; record this so apply does not touch generated copies.
- **Memory files** (`docs/memory/run-kit/**`, 33 non-log mentions across 14 files): `architecture.md:866`, `tmux-sessions.md:286,387`, `ui/keyboard-and-palette.md:236,240,244,248`, `ui/boards.md:83,108`, `ui/top-bar.md:84(×2),137,203,238(×2)`, `ui/routes-and-shell.md:207`, `ui/terminal.md:80,114`, `ui/dialogs-and-state.md:34`, `ui/status-signals.md:195,216,249`, `ui/focus-ownership.md:53`, `ui/lenses-and-layout.md:26,38,65,112,152,160,180,182,197`, `ui/sidebar.md:335,402(×2)`, `ui/visual-design.md:165`. Edit rule: drop the `(+ .spec.md)` / `(+ sibling .spec.md)` / `+ companion .spec.md` parenthetical, keep the `.spec.ts` pointer; where prose says "documented in the `.spec.md`" or "per the constitution's Test Companion Docs rule" (`architecture.md:866`, `ui/top-bar.md:238`, `ui/terminal.md:80,114`, `ui/dialogs-and-state.md:34`, `ui/lenses-and-layout.md:182`), reword to "documented in the spec's intent comments" / "per the constitution's Test Intent Comments rule". `log.md` / `log.seed.md` are historical logs — leave untouched.
- **`fab/backlog.md`** and archived/closed `fab/changes/*/intake.md` mention "companion .spec.md" only inside already-closed items — leave untouched (history).
- **`fab/plans/sahil/*.md`** mentions (`26-08-12-surface-layout.md`, `26-07-14-desktop-view.md`) are personal plan notes — leave untouched.
- **Docs/site/README surfaces**: grep found no mention in `README.md` or `docs/site/`; the Toolkit Standards clause imposes no extra check. Re-grep at apply.
- The removal sweep MUST include `app/frontend/tests/e2e/**` (both `.spec.ts` comments and the `.spec.md` files themselves) — a prior src-only sweep broke CI on PR #751.

### 4. Optional: cross-file skim recipe

Nice-to-have, not core scope: a `just` recipe (one-liner delegating to `scripts/`, per Constitution VIII) that prints every spec file's header + per-test JSDoc blocks so the cross-file "skim the contracts" affordance the mds offered is restored, drift-proof by construction. Deferred decision — see Assumptions.

### Verification

- `just test-frontend` (Vitest + `tsc --noEmit` via the frontend build path) — comment-only edits must type-check.
- `just test-e2e` on a representative subset (e.g. `zen-mode`, `chat-view`, `smoke`) to prove no accidental body edits; full e2e via CI on the PR.
- `ls app/frontend/tests/e2e/*.spec.md` → empty; `grep -rn 'spec\.md' app/frontend/tests/e2e docs/memory --include='*.ts' --include='*.md' | grep -v '/log'` → empty; `grep -c 'Test Companion Docs' fab/project/constitution.md` → 0.
- Every `test(` in `app/frontend/tests/e2e/*.spec.ts` is immediately preceded (modulo blank lines) by a `*/` closing a block containing `Proves:` — a one-off shell/awk check during review.

## Affected Memory

- `run-kit/architecture.md`: (modify) line 866 rewording; the "testing layers" section should state the Test Intent Comments rule (no companion docs) if it describes the e2e layer.
- `run-kit/tmux-sessions.md`: (modify) drop `(+ companion .spec.md)` / `+ .spec.md` at lines 286, 387.
- `run-kit/ui/keyboard-and-palette.md`: (modify) drop `(+ .spec.md)` in four e2e sub-headings.
- `run-kit/ui/boards.md`: (modify) drop companion parentheticals at 83, 108.
- `run-kit/ui/top-bar.md`: (modify) drop parentheticals at 84, 137, 203; reword 238 (constitution rule name).
- `run-kit/ui/routes-and-shell.md`: (modify) line 207.
- `run-kit/ui/terminal.md`: (modify) lines 80, 114 (reword "documented in the `.spec.md`").
- `run-kit/ui/dialogs-and-state.md`: (modify) line 34 (reword to intent-comment header).
- `run-kit/ui/status-signals.md`: (modify) lines 195, 216, 249.
- `run-kit/ui/focus-ownership.md`: (modify) line 53.
- `run-kit/ui/lenses-and-layout.md`: (modify) lines 26, 38, 65, 112, 152, 160, 180, 182, 197.
- `run-kit/ui/sidebar.md`: (modify) lines 335, 402.
- `run-kit/ui/visual-design.md`: (modify) line 165.

## Impact

- **Tests**: `app/frontend/tests/e2e/*.spec.ts` (86 files, comment-only edits); `app/frontend/tests/e2e/*.spec.md` (86 deletions, ~9.5k lines removed). No runtime, API, or UI change.
- **Governance**: `fab/project/constitution.md` (one constraint replaced, version bump).
- **Docs**: 14 memory files under `docs/memory/run-kit/` (pointer edits).
- **Not touched**: `.claude/skills/**` (upstream fab-kit copies; their `spec.md` mentions are unrelated), `fab/backlog.md`, `fab/changes/**`, `fab/plans/**`, `docs/memory/run-kit/log*.md`, `justfile`/`scripts/` (unless the optional recipe is taken).
- **Risk**: large mechanical diff; the main failure mode is an accidental edit inside a `test()` body while inserting comments. Mitigation: diff review that every hunk in `.spec.ts` is comment-only (`git diff -U0 -- '*.spec.ts' | grep '^[-+]' | grep -v -E '^[-+]\s*(/\*\*|\*|\*/|//)'` should show only the removed pointer lines and blank-line churn).

## Open Questions

- Should the constitution's exemption list stay as-is, or should the new rule also cover any future non-e2e Playwright specs (there are none today; `playwright.config.ts` `testDir` is `./tests/e2e`)?
- Is the optional `just` skim recipe wanted in this change, a follow-up, or not at all?
- Version bump: minor (`1.11.0`) vs. major (`2.0.0`) for replacing a MUST constraint?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace the "Test Companion Docs" constraint with a "Test Intent Comments" JSDoc rule; delete all 86 `.spec.md` files | Discussed — decided in the 2026-08-28 evidence review; alternatives (CI drift check, mds-for-long-specs-only) explicitly rejected | S:95 R:70 A:90 D:95 |
| 2 | Certain | Per-`test()` JSDoc shape is `/** Proves: … Steps: 1. … */`; per-file header covers shared setup/mocks | Discussed — shape given verbatim in the change description; matches existing header comments in 7+ spec files | S:90 R:90 A:90 D:90 |
| 3 | Certain | Drop change-ID citations and "Since <id>…" history during the fold; keep only constraints the code can't show | Discussed — mirrors `code-quality.md` § Anti-Patterns comment rule; memory files own provenance | S:90 R:85 A:95 D:90 |
| 4 | Certain | Where md and test drifted, the test body is the source of truth for the comment | Discussed — explicit in the change description | S:90 R:90 A:95 D:95 |
| 5 | Certain | No `test()` body, title, fixture, or helper edits — comments and file deletions only | Discussed — explicit constraint; verifiable via comment-only diff check | S:95 R:90 A:95 D:95 |
| 6 | Certain | `.claude/skills/_generation` and `_cli-fab` are NOT edited — their `spec.md` mentions are fab's legacy change-artifact `spec.md`, not the Playwright companion doc, and both are `fab sync` copies of upstream fab-kit | Verified at intake by reading the lines; the description flagged "check if upstream" — it is | S:85 R:90 A:95 D:90 |
| 7 | Confident | Memory sweep edits the 33 non-log mentions across 14 files (drop parenthetical, keep `.spec.ts` pointer; reword the 6 prose references to the rule); `log.md`/`log.seed.md`, `fab/backlog.md`, `fab/changes/**`, `fab/plans/**` left untouched as history | Description says "drop the parenthetical, keep the spec.ts pointer"; log/backlog/plan files are provenance records, not living docs | S:75 R:90 A:85 D:80 |
| 8 | Confident | `test.describe` blocks get no block of their own; every `test()` inside gets its own JSDoc | One obvious reading of "every e2e test() carries a block"; easily adjusted | S:60 R:95 A:80 D:80 |
| 9 | Certain | Unit tests (`*.test.ts(x)`, `*_test.go`) remain exempt; rule scoped to `app/frontend/tests/e2e/*.spec.ts` (the only Playwright `testDir`) | Description states the exemption; `playwright.config.ts` confirms the single testDir | S:85 R:90 A:90 D:90 |
| 10 | Confident | Existing spec-file header comments are merged (keep constraints, add setup, remove the `See X.spec.md` sentence) rather than replaced wholesale | Reasonable default preserving hand-written context; the description does not say merge vs. replace | S:45 R:85 A:70 D:55 |
| 11 | Confident | Pre-existing change-ID citations already inside `.spec.ts` comments are cleaned only when the surrounding comment is touched; zero-citation target applies to text introduced by this change | Description bans citations in the *folded* text; a full citation purge of existing spec.ts comments is adjacent scope | S:40 R:85 A:65 D:50 |
| 12 | Confident | Constitution version bump is minor: `1.10.0` → `1.11.0`; Last Amended 2026-08-28 | Deferred — promptless dispatch; default = minor, as the description says "Bump constitution version (minor)" and a one-line governance edit is trivially revisable | S:70 R:95 A:60 D:65 |
| 13 | Confident | The `just` intent-comment skim recipe is OUT of core scope — recorded as an optional follow-up (§ 4), not a plan task | Deferred — promptless dispatch; default = exclude, as the description says "record as an assumption/optional task rather than core scope" | S:75 R:95 A:70 D:70 |
| 14 | Confident | The proposed "Test Intent Comments" wording in § 1 binds as written unless `/fab-clarify` tunes it | Deferred — promptless dispatch; default = use the draft, which reproduces every element the description enumerates (Proves/Steps, file header, exemptions, no history narration) | S:65 R:90 A:65 D:65 |
| 15 | Confident | `architecture.md`'s testing-layers section gains one sentence naming the Test Intent Comments rule (no companion docs) during hydrate, beyond the pointer edits | Deferred — promptless dispatch; default = let hydrate add it, since the memory file's "testing layers" description is where a reader would look for the convention | S:55 R:95 A:65 D:60 |

15 assumptions (7 certain, 8 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
