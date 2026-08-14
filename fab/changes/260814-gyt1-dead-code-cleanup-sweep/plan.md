# Plan: Dead-Code Cleanup Sweep

**Change**: 260814-gyt1-dead-code-cleanup-sweep
**Intake**: `intake.md`

## Requirements

### Frontend: BreadcrumbDropdown labeled-trigger removal (pw7g)

#### R1: Delete the dead `icon` prop branch
`BreadcrumbDropdown` (`app/frontend/src/components/breadcrumb-dropdown.tsx`) SHALL drop the `icon?: string` prop, the `{icon ?? "▾"}` trigger substitution, and the `{icon != null && ...}` persistent-caret block — the trigger renders the bare `▾` caret unconditionally. No call site changes are needed (none passes `icon`).

- **GIVEN** the two production call sites (window switcher `top-bar.tsx:989`, board switcher `top-bar.tsx:1829`)
- **WHEN** the `icon` prop and its render branches are removed
- **THEN** both switchers render byte-identically (bare `▾` trigger) and `tsc --noEmit` passes
- **AND** no test references the removed prop (any breadcrumb-dropdown test exercising `icon` is deleted/updated)

### Backend: dead session-color helpers (hn3j)

#### R2: Delete the session-color helper family from `internal/config`
`app/backend/internal/config/runkit_yaml.go` SHALL retain only `FindGitRoot`. `ReadSessionColor`, `parseSessionColor`, `WriteSessionColor`, and their private support code used by nothing else (`setSessionColorInContent`, `removeSessionColorKey`, `splitYAMLLine`, the `runkitYAMLFile` const) MUST be deleted, with imports pruned. `runkit_yaml_test.go` SHALL drop all `TestReadSessionColor_*`/`TestWriteSessionColor_*` functions and keep any `FindGitRoot` tests.

- **GIVEN** zero non-test call sites for the session-color trio (session color lives in the tmux `@session_color` string option)
- **WHEN** the helpers, support code, and their tests are deleted
- **THEN** `go build ./...` and `go test ./...` pass, and `FindGitRoot`'s live callers (`internal/sessions`, `api/riff.go`, `api/fork.go`, `cmd/rk/riff.go`) are untouched

### Frontend: dead API-client function (zc6m)

#### R3: Delete `updateWindowType()`
`app/frontend/src/api/client.ts` SHALL drop `updateWindowType` (line ~376). `client.test.ts` SHALL drop its import and its single test case. The stale prose mention in `iframe-window.test.tsx:8` SHOULD be reworded so the deleted name greps clean. The backend `POST /api/windows/{windowId}/options` endpoint, `setWindowOptions`, `updateWindowUrl`, and `@rk_type` substrate semantics MUST NOT change.

- **GIVEN** zero non-test references to `updateWindowType`
- **WHEN** the function and its test case are deleted
- **THEN** `tsc --noEmit` and the client unit suite pass, and `grep -rn updateWindowType app/frontend/src` returns nothing

### Backend: PWA asset seam (tk8p)

#### R4: Route `readSPAAsset` through `embeddedSPASub`
`app/backend/api/pwa.go` `readSPAAsset` SHALL call `embeddedSPASub()` (the package-var seam in `spa.go:28`) instead of inlining `fs.Sub(build.Frontend, "frontend")`. The filesystem branch (`spaDir` + `spaPublicFallbackDirs`) and route registration MUST NOT change. The now-unused `rk/build` import is pruned (`io/fs` stays for `fs.ReadFile`).

- **GIVEN** a test that overrides `embeddedSPASub` (the `spa_test.go:105` pattern)
- **WHEN** `readSPAAsset` reads in embedded mode
- **THEN** it reads through the overridden FS — the same seam `mountSPA` branches on — with byte-identical production behavior

### Frontend: PR status model collapse (dq2v)

#### R5: Collapse `prGlyphColor`'s fail branch to `isFailish`; retire `prDotState`/`PrDotState`
In `app/frontend/src/components/pr-status-model.ts`, `prGlyphColor`'s `if (prDotState(win) === "fail")` SHALL become `if (isFailish(win))`, and `prDotState` + the `PrDotState` type SHALL be deleted. `isFailish` stays exported as the single fail predicate. The glyph color output MUST stay byte-identical for every input (the closed branch precedes fail; merged maps to purple later in the chain — apply MUST re-confirm the merged+failish input still renders purple). Doc comments referencing `prDotState` (in `pr-status-model.ts` and `palette-selection.ts:186`) SHALL be updated. In `pr-status-model.test.ts`, the direct-call `describe("prDotState precedence")` block SHALL be removed, with any fail-dominance/precedence coverage not already asserted through `prGlyphColor` folded into the `prGlyphColor` tests.

- **GIVEN** the six-way `prGlyphColor` chain and the existing unit suites (`pr-status-model.test.ts`, `signal-color-tokens.test.ts`, `session-tiles.test.tsx`)
- **WHEN** the branch is collapsed and `prDotState`/`PrDotState` deleted
- **THEN** all surviving suites pass unchanged except the removed/folded direct-call block, and `grep -rn 'prDotState\|PrDotState' app/frontend/src` (with `-a` for NUL-containing files) hits nothing

### Non-Goals

- No behavior, API-surface, route, or endpoint changes anywhere — this is deletion + seam rerouting only.
- No memory-file edits during apply (hydrate owns `run-kit/ui/top-bar.md`, `run-kit/ui/status-signals.md`, `run-kit/architecture.md`).
- Backlog ticking is a ship-tail action (see Notes), not an apply task.

### Design Decisions

#### Delete orphaned private support code with the hn3j trio
**Decision**: hn3j removes `setSessionColorInContent`, `removeSessionColorKey`, `splitYAMLLine`, and `runkitYAMLFile` alongside the three named helpers.
**Why**: they are private and verified used only by the deleted trio; leaving them would recreate the exact dead-code smell the sweep exists to remove.
**Rejected**: deleting only the three named functions — leaves unreferenced private code the compiler won't flag.
*Introduced by*: 260814-gyt1-dead-code-cleanup-sweep

### Deprecated Requirements

#### `run-kit.yaml` session-color read/write path
**Reason**: session color moved to the tmux `@session_color` option (string descriptor); the `*int`-typed helpers never matched it and have had zero non-test callers since `260615-6rnr`.
**Migration**: N/A — the tmux option path is the only live path already.

#### `PrDotState` five-state PR enum
**Reason**: the non-`fail` states never gained a UI consumer; the one live read collapses to the `isFailish` boolean.
**Migration**: `isFailish(win)` (fail predicate) + `prGlyphColor`'s own chain cover every live use.

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Delete the `icon` prop, its trigger substitution, and the persistent-caret block from `app/frontend/src/components/breadcrumb-dropdown.tsx`; update/delete any breadcrumb-dropdown test exercising `icon` <!-- R1 -->
- [x] T002 [P] Delete `ReadSessionColor`/`parseSessionColor`/`WriteSessionColor` + orphaned private support code from `app/backend/internal/config/runkit_yaml.go` (keep `FindGitRoot`); delete their tests from `runkit_yaml_test.go`; prune imports <!-- R2 -->
- [x] T003 [P] Delete `updateWindowType` from `app/frontend/src/api/client.ts`; remove its import + test case from `client.test.ts`; reword the `iframe-window.test.tsx:8` comment <!-- R3 -->
- [x] T004 [P] Replace the inline `fs.Sub(build.Frontend, "frontend")` in `app/backend/api/pwa.go` `readSPAAsset` with `embeddedSPASub()`; prune the `rk/build` import <!-- R4 -->
- [x] T005 [P] Collapse `prGlyphColor`'s fail branch to `isFailish(win)`, delete `prDotState` + `PrDotState`, update doc comments (`pr-status-model.ts`, `palette-selection.ts:186`), and fold/remove the `prDotState precedence` test block in `pr-status-model.test.ts` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `breadcrumb-dropdown.tsx` has no `icon` prop or conditional-caret branch; both top-bar call sites compile and render the bare-▾ trigger
- [x] A-002 R2: `runkit_yaml.go` contains only `FindGitRoot`; no `SessionColor`/`splitYAMLLine` symbol remains anywhere in `app/backend/`
- [x] A-003 R3: `updateWindowType` has zero occurrences under `app/frontend/` (code, tests, comments)
- [x] A-004 R4: `readSPAAsset`'s embedded branch calls `embeddedSPASub()`; no inline `fs.Sub(build.Frontend, ...)` remains in `pwa.go`
- [x] A-005 R5: `prDotState`/`PrDotState` have zero code references under `app/frontend/src` (checked with a NUL-tolerant grep; one historical retirement note in the test-file header is allowed, matching the file's existing `PrStatusLine` retirement-note precedent); `isFailish` remains exported

### Behavioral Correctness

- [x] A-006 R5: `prGlyphColor` output is unchanged for every input class (closed, fail-ish open, open draft, pending, healthy open, merged — including merged+failish → purple); surviving unit suites pass
- [x] A-007 R4: PWA asset routes serve byte-identical stock bytes in embedded and filesystem modes

### Removal Verification

- [x] A-008 R2: all `TestReadSessionColor_*`/`TestWriteSessionColor_*` funcs are gone; `FindGitRoot` tests (if any existed in the file) are preserved
- [x] A-009 R1/R3/R5: no dead re-exports, unused imports, or stale type references left behind (`tsc --noEmit` + `go vet ./...` clean)

### Scenario Coverage

- [x] A-010 R5: fail-dominance coverage (fail beats healthy/pending on open PRs; closed beats fail) is asserted through `prGlyphColor` tests after the fold

### Code Quality

- [x] A-011 Pattern consistency: edits match surrounding code style (comment density, naming); no new utilities introduced
- [x] A-012 No unnecessary duplication: `pwa.go` no longer duplicates the embedded-sub-FS lookup owned by `spa.go`'s seam

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Ship tail** (owned by the fab-fff Step 4 ship step, per the user directive "when shipped, tick"): flip the 5 backlog boxes `- [ ]` → `- [x]` on the `fab/backlog.md` lines carrying `[pw7g]`, `[hn3j]`, `[zc6m]`, `[tk8p]`, `[dq2v]` (match by ID, not line number), so the ticks ride the same PR commit.
- Verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; scoped Vitest runs for the touched suites (through `just` recipes per project convention where applicable).

## Deletion Candidates

- `app/frontend/src/components/breadcrumb-dropdown.tsx` (trigger button `className`) — `gap-1` is now vestigial: with the icon prop branch gone, the trigger has a single child (the bare-▾ span), so the flex gap has nothing to space.
- Otherwise none — this change is itself a deletion sweep; the apply stage already removed every symbol it made redundant (session-color helpers + support code, `updateWindowType`, `prDotState`/`PrDotState`, the icon-prop branch), and NUL-tolerant greps confirm zero remaining references.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Backlog ticking is executed at the ship step (before the git-pr commit) rather than as an apply task | User directive says "when shipped, tick"; ticking at ship still rides the same PR commit atomically | S:75 R:90 A:85 D:70 |
| 2 | Confident | Scoped unit-test runs (touched suites) rather than the full `just test` e2e sweep are sufficient verification for apply | No user-visible behavior changes; e2e specs don't reference any deleted symbol; full sweep still available to review | S:70 R:85 A:85 D:75 |

2 assumptions (0 certain, 2 confident, 0 tentative).
