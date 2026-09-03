# Plan: Test Suite Consolidation — Trim Redundant Tests

**Change**: 260901-aeml-trim-redundant-tests
**Intake**: `intake.md`

## Requirements

> The intake's § What Changes carries the complete per-candidate detail (every deletion with its surviving owner, every merge with its keep-list, every exclusion). Requirements below bind the behavior; tasks reference the intake area they execute. The intake's **global re-verification constraint** applies to every requirement: audit file:line references predate HEAD `c5c1ac8d` (PR #783) — locate tests by title/content, verify owning coverage exists before deleting, skip-and-note any candidate that no longer matches.

### E2E Infrastructure: Perf-Audit Gating

#### R1: Latency-audit specs excluded from the default e2e run
`echo-latency.spec.ts` and `sync-latency.spec.ts` MUST NOT run under `just test-e2e` (and therefore CI), and MUST remain runnable on demand via `just pw test <name>`. The mechanism SHALL be a `@perf` marker in the specs' `test.describe` titles excluded by `grepInvert` in the default config path (intake area 1; env-gated fallback if `just pw test <name>` cannot bypass the exclusion).

- **GIVEN** the default e2e run (`just test-e2e`)
- **WHEN** the suite executes
- **THEN** zero tests from the two latency specs run
- **AND** `just pw test echo-latency` still executes them (verified, not assumed)

### Test Trimming: Deletions

#### R2: E2E strict subsets and duplicates deleted
The e2e deletion candidates in intake area 2 (high-confidence list, plus the medium-confidence list under its explicit drop-on-doubt rule) SHALL be deleted, each only after verifying its cited surviving owner still exists and covers the behavior. Whole-file deletions: `sse-connection.spec.ts`, `smoke.spec.ts`. The reorder trio (`server-reorder`, `board-list-reorder`, `board-reorder`) keeps exactly one happy-path round-trip per endpoint.

- **GIVEN** a deletion candidate and its cited owner (e.g. `operator-digest.spec.ts` "palette absence" vs `operator-compose.spec.ts:220`)
- **WHEN** the owner is located and confirmed to assert the same contract
- **THEN** the candidate is deleted and the touched file's header + surviving `Proves:/Steps:` JSDoc are updated in the same commit
- **AND** if the owner cannot be located, the candidate is skipped and noted in the result

#### R3: Unit/Go strict subsets deleted
The Vitest and Go strict-subset/literal-duplicate candidates in intake area 2 (client.test.ts `:672`/`:752`/`:740`, top-bar `:463`/`:457`, use-optimistic-action granular subsets, palette/move re-runs, optimistic-context near-dup, use-keybinding-dispatch `:53`, Go `TestSessionColorInvalidValue`, windows color pair) SHALL be deleted under the same verify-owner-first rule.

- **GIVEN** `api/sessions_test.go` contains both `TestSessionColorInvalidValue` and the table-driven `TestSessionColorRejectsMalformed`
- **WHEN** the subset relationship is confirmed (same route, same 400 assertion)
- **THEN** only the subset test is removed

### Test Trimming: Table Merges

#### R4: Go near-duplicate families merged into table tests
The four Go merge families in intake area 3 SHALL each become table-driven tests with **zero assertion loss** — every current assertion becomes a table row: `internal/tmux/tmux_test.go` server-flag + round-trip families (~34→7, sharing one live tmux server per family), `internal/settings/settings_test.go` per-key quintuplets (~28→9, registry-driven), api/ per-file guard loops (~19→6, per-file only), `cmd/rk/skill_test.go` topic grid (12→3).

- **GIVEN** the ~21 `TestIs*/TestMark*/TestUnmark*` flag tests each booting a tmux server via `withSessionOrderTmux(t)`
- **WHEN** merged into a table over {option family} × {set/unset-after-set/never-set/no-server}
- **THEN** all prior states remain asserted and the merged test boots at most one server per family group

#### R5: Vitest near-duplicate families merged
The Vitest merge families in intake area 4 SHALL be merged with zero assertion loss, honoring each family's explicit keep-list: `lib/shell.test.ts` bridge groups (~40→5 via one `it.each`; keep `:704` independence, addDirect error-string, optional-fields parse), `api/client.test.ts` (createWindow, error-path representatives, registry-key table), `window-row.test.tsx` (keep threading + shape/slot cases), `status-panel.test.tsx` (keep truncation + title-preservation), `index.core.test.tsx` rename mirrors (`it.each` over {window, session}), `pr-status-model`/`status-dot` enum tables, command-palette/collapsible-panel/top-bar-boot-sweep, and the small scatter (router-url, gauge, chrome-context, theme-context, top-bar-overflow, reorder-hook trio — keep MIME trios).

- **GIVEN** the eleven shell.test.ts bridge groups repeating four shapes verbatim
- **WHEN** collapsed to one `it.each` over `[canFn, invoker, bridgeKey, args]`
- **THEN** all eleven bridges × four shapes remain asserted as table rows and the keep-listed distinct cases survive unmerged

### Compat Lifecycle: Retirement Tagging

#### R6: Compat-shim tests tagged, never deleted
The shim-bound tests in intake area 5 SHALL receive a `retire-with: {shim-name}` comment (above the test; file header for whole-file specs) and MUST NOT be deleted or altered otherwise: `agent_setup_test.go` removeLegacySkill tests, `present_test.go` n-less compat tests, `windows_test.go` legacy key-translation tests, e2e `legacy-color-sweep.spec.ts` + `legacy-scope-sweep.spec.ts`. `internal/tmux/legacy_options_test.go` is explicitly NOT tagged (guards the live migration sweep, not a shim).

- **GIVEN** the shim removal sweep of a future change
- **WHEN** it runs `grep -r "retire-with"`
- **THEN** every shim-bound test (Go and e2e) is found by the grep alone

### Non-Goals

- Fusing the five 1-test boards e2e files (setup-sharing concern, separate change)
- `lib/keybindings.test.ts` per-binding pins, `*CommandRegistered`/`*Flag_Registered` tests, palette-parity e2e tests, `pwa-assets.spec.ts`, and every suite the audit called healthy
- Any production-code change — this change touches tests, test config, and the two whole-file spec deletions only

### Design Decisions

#### Perf gating via title tag, not a Playwright project
**Decision**: `@perf` in `test.describe` titles + `grepInvert` in the default config path.
**Why**: Lighter touch on `playwright.config.ts`/`scripts/test-e2e.sh`; the tag is visible at the spec site; trivially reversible.
**Rejected**: A separate Playwright project — more config surface, and project selection interacts with the per-worktree derived-port rig.
*Introduced by*: 260901-aeml-trim-redundant-tests

#### Category-ordered commits, deletions never mixed with rewrites
**Decision**: Five commits — (1) gating, (2) pure deletions, (3) Go merges, (4) Vitest merges, (5) retire-with tagging — created during apply at each category boundary.
**Why**: User-approved structure; deletions are verifiable by owner-citation alone while merges need assertion-preservation review — mixing them destroys that reviewability.
**Rejected**: One squashed commit at ship — loses the review structure the user asked for.
*Introduced by*: 260901-aeml-trim-redundant-tests

## Tasks

### Phase 1: Gating

- [x] T001 Tag `app/frontend/tests/e2e/echo-latency.spec.ts` and `sync-latency.spec.ts` describe-titles with `@perf`; add `grepInvert` to the default config path (`app/frontend/playwright.config.ts`; touch `scripts/test-e2e.sh`/CI only if needed); VERIFY `just pw test echo-latency` still runs the spec (use `--list` to avoid a real run; if grepInvert blocks it, switch to the env-gated variant per intake area 1); update both spec headers to document the on-demand invocation. Commit: `test: gate latency-audit e2e specs behind @perf` <!-- R1 -->

### Phase 2: Deletions

- [x] T002 Execute intake area 2's e2e deletions (high-confidence list + medium list under drop-on-doubt): whole-file `sse-connection.spec.ts` + `smoke.spec.ts`; per-test deletions across `operator-digest`, `top-bar-overflow`, `chat-view`, `right-panel`, `code-surface`, `zen-mode`, `bottom-bar-chip-size`, `row-identity-tips`, `web-view-lens`, `shortcut-registry`, `web-tile-chrome`, `mobile-layout`, `window-heading`, `status-bar`; reorder trio 8→3; shim-matrix arms ~4; the two in-place merges (right-panel persistence pair → one, status-bar predicate arms → one). Verify each cited owner first; update every touched file's header + `Proves:/Steps:` comments <!-- R2 -->
- [x] T003 Execute intake area 2's unit/Go strict-subset deletions: `src/api/client.test.ts`, `src/components/top-bar.test.tsx`, `src/hooks/use-optimistic-action.test.ts`, `src/lib/palette/move.test.ts`, `src/contexts/optimistic-context.test.tsx`, `src/hooks/use-keybinding-dispatch.test.ts`, `api/sessions_test.go`, `api/windows_test.go` (color pair). Then run `just test-frontend` and `just test-backend`; commit T002+T003 together: `test: delete redundant tests owned elsewhere` <!-- R3 -->

### Phase 3: Table Merges

- [x] T004 Merge `app/backend/internal/tmux/tmux_test.go` server-flag families (~21→4, one shared server per family group) and Get/Set round-trip families (~13→3) per intake area 3; every existing assertion becomes a table row <!-- R4 -->
- [x] T005 [P] Merge `app/backend/internal/settings/settings_test.go` per-key quintuplets into registry-driven tables (~28→9); merge api/ per-file `Test*InvalidWindowID`/`Test*InvalidJSON` guard loops (~19→6, per-file only); merge `app/backend/cmd/rk/skill_test.go` topic grid (12→3). Run `just test-backend`; commit T004+T005: `test: table-merge Go near-duplicate test families` <!-- R4 --> <!-- rework: TestOptionalSettingRoundTrips uses a closed manual cases slice + separate board-order block; R4 requires the round-trip table to iterate the production registry (settings.go:227) so a new registry key is automatically covered -->
- [x] T006 Merge `src/lib/shell.test.ts` bridge groups (~40→5 `it.each`, honor keep-list) and `src/api/client.test.ts` families (createWindow 5→2, error-path representatives, registry-key table) per intake area 4 <!-- R5 -->
- [x] T007 [P] Merge the component families per intake area 4: `window-row.test.tsx` (dot signals 8→2, PR-glyph colors ~5→1, honor keep-lists), `status-panel.test.tsx` shortenPath, `index.core.test.tsx` rename mirrors (`it.each` {window, session}), `pr-status-model.test.ts` closed family, `status-dot.test.tsx` fabShape/fabPhase, `command-palette.test.tsx` Cmd/Ctrl+K, `collapsible-panel.test.tsx`, `top-bar.test.tsx` boot-sweep 3→1 <!-- R5 -->
- [x] T008 [P] Merge the small scatter per intake area 4: `lib/router-url.test.ts`, `lib/gauge.test.ts`, `contexts/chrome-context.test.tsx`, `contexts/theme-context.test.tsx`, `lib/top-bar-overflow.test.ts`, reorder-hook trio (keep MIME trios). Run `just test-frontend`; commit T006+T007+T008: `test: table-merge Vitest near-duplicate test families` <!-- R5 -->

### Phase 4: Tagging & Verification

- [x] T009 Add `retire-with:` markers per intake area 5: `cmd/rk/agent_setup_test.go` (`retire-with: removeLegacySkill`), `api/present_test.go` (`retire-with: present-nless-compat`), `api/windows_test.go` legacy-key tests (`retire-with: legacy-option-key-translation`), file headers of `legacy-color-sweep.spec.ts` + `legacy-scope-sweep.spec.ts`; do NOT tag `internal/tmux/legacy_options_test.go`. Verify `grep -rn "retire-with" app/` finds exactly the tagged set. Commit: `test: tag compat-shim tests with retire-with markers` <!-- R6 -->
- [x] T010 Full verification: `just test-backend`, `just test-frontend` (must be fully green), then `just test-e2e` — confirm the two `@perf` specs did not run; for any e2e failure, check against clean origin/main before attributing to this change (known pre-existing failures exist); fix regressions this change caused, re-run, and amend the owning category commit <!-- R1 -->

## Execution Order

- T001 → T002/T003 → T004–T008 → T009 → T010
- [P] tasks are file-disjoint within their phase; commits happen at the category boundaries named in the tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: `just test-e2e` (or its `--list` equivalent) executes zero tests from `echo-latency.spec.ts`/`sync-latency.spec.ts`, and `just pw test echo-latency --list` still lists them
- [x] A-002 R2: Every high-confidence e2e candidate from intake area 2 is deleted or explicitly skip-noted with a reason; `sse-connection.spec.ts` and `smoke.spec.ts` no longer exist; the reorder trio retains exactly one happy-path test per endpoint
- [x] A-003 R3: The unit/Go strict subsets from intake area 2 are deleted or skip-noted; `TestSessionColorRejectsMalformed` survives, `TestSessionColorInvalidValue` does not
- [x] A-004 R4: The four Go merge families are table-driven; no `TestIsEphemeralServer_*`/`TestIsProtectedServer_*`/`TestIsGuardedServer_*`/`TestIsManagedServer_*` singleton family remains in `tmux_test.go`
- [x] A-005 R5: `shell.test.ts` bridge groups ride one parametrized table with the keep-listed cases intact; the other named Vitest families are merged per their keep-lists
- [x] A-006 R6: `grep -rn "retire-with" app/` returns markers on exactly the intake-area-5 set (agent_setup, present, windows legacy-key, the two legacy e2e sweeps) and nothing in `legacy_options_test.go`

### Behavioral Correctness

- [x] A-007 R4: Every assertion present in a pre-merge Go test exists as a table row or explicit case in the merged test (spot-check the tmux flag families against `git show` of the deleted originals)
- [x] A-008 R5: Every assertion present in a pre-merge Vitest case exists in the merged tables, including the eleven-bridge × four-shape matrix in shell.test.ts

### Removal Verification

- [x] A-009 R2: No deleted e2e test's contract lost its last owner — each cited surviving owner was located and confirmed before deletion (skip-notes list any that were not)
- [x] A-010 R2: No orphaned helpers/imports remain in edited spec files (deleted tests' now-unused fixtures and imports removed)

### Scenario Coverage

- [x] A-011 R1: The `@perf` mechanism is verified in both directions (excluded by default, reachable on demand) — not assumed from config reading
- [x] A-012 R2/R5: Constitution § Test Intent Comments holds — every edited spec file's header and every surviving modified `test()`'s `Proves:/Steps:` JSDoc reflects the post-trim reality, in the same commit as the edit

### Edge Cases & Error Handling

- [x] A-013 R2: Candidates invalidated by PR #783 (web-tab area: `web-tile-chrome`, `web-view-lens`) were re-verified against current HEAD; any mismatch was skipped and noted, not forced

### Code Quality

- [x] A-014 Pattern consistency: merged table tests follow each file's existing table/`it.each` idioms; commit messages follow the repo's `test:` convention with no Co-Authored-By trailers
- [x] A-015 No unnecessary duplication: no new helper duplicates an existing test utility (`withSessionOrderTmux`, existing render harnesses reused)
- [x] A-016 Comment discipline: no comment narrates history or cites change IDs/PR numbers/R#/T# in test files; `retire-with:` markers state only the shim name (the one constraint the code can't show)
- [x] A-017 Tests-conform-to-spec: no implementation file changed anywhere in the diff (`git diff --stat` shows test files, spec files, and test config only)

### Security

- [x] A-018 **N/A**: test-only change, no security surface

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Never run Playwright directly — `just test-e2e` / `just pw` only; do not run e2e concurrently with a sibling worktree's run
- Commit messages: repo `test:` prefix convention, no Co-Authored-By trailers of any kind

## Deletion Candidates

None — this consolidation removed the identified redundant tests and introduced no code that makes another symbol, branch, or file unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Commits are created during apply at the five category boundaries (T001, T003, T005, T008, T009), not left to ship | The approved five-commit structure requires apply-time boundaries; /git-pr pushes existing commits | S:70 R:80 A:75 D:65 |
| 2 | Confident | `just test-e2e` runs once at T010 rather than per-commit | E2E is expensive and serialized per worktree; per-commit unit-suite runs (T003, T005, T008) catch category-local breakage | S:60 R:85 A:80 D:70 |
| 3 | Certain | Deletion candidates whose owner or content no longer matches post-#783 HEAD are skipped and noted, never forced | Intake's global constraint (assumption 6 there); Test Integrity over trim-count | S:85 R:90 A:90 D:85 |

3 assumptions (1 certain, 2 confident).
