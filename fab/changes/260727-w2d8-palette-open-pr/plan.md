# Plan: Palette Open PR

**Change**: 260727-w2d8-palette-open-pr
**Intake**: `intake.md`

## Requirements

### Command Palette: `Open: PR #{n}` action

#### R1: PR palette action exists only when the current window has a PR
The command palette on the terminal window page (`/$session/$window`) SHALL include an action with id `open-pr` and label `Open: PR #{n}` (the real PR number from `currentWindow.prNumber`) when `currentWindow.prUrl` is set. When `prUrl` is present but `prNumber` is absent, the label SHALL fall back to `Open: PR`. When `prUrl` is absent (no PR bound, or not on a terminal window page), the action MUST NOT exist in the palette.

- **GIVEN** a terminal window whose `WindowInfo` carries `prUrl` and `prNumber: 123123`
- **WHEN** the palette is opened
- **THEN** an action labeled `Open: PR #123123` with id `open-pr` is present, grouped with the other `Open:` entries

- **GIVEN** a window with `prUrl` set but no `prNumber`
- **WHEN** the palette is opened
- **THEN** the action is labeled `Open: PR`

- **GIVEN** a window with no `prUrl` (or a non-terminal route where `currentWindow` is null)
- **WHEN** the palette is opened
- **THEN** no `open-pr` action exists

#### R2: Selection opens the PR client-side only
Selecting the action SHALL call `window.open(prUrl, "_blank", "noopener,noreferrer")` in the viewer's browser (the `Help: Documentation` pattern, `app.tsx:2092`). The change MUST NOT add any backend endpoint, server-side exec, `OpenTarget` entry, top-bar Open-menu row, or keyboard chord.

- **GIVEN** the `Open: PR #123123` action is present
- **WHEN** the user selects it
- **THEN** the PR URL opens in a new tab with `noopener,noreferrer`
- **AND** no network call to the run-kit backend is made for the open

#### R3: Pure builder seam with colocated unit tests
The gating and label composition SHALL live in a pure builder `buildOpenPrAction(prUrl, prNumber, onOpen)` in `app/frontend/src/lib/palette-open.ts` (the file already owning the `Open:` label family), returning `OpenPaletteAction[]` — `[]` without `prUrl`, one action otherwise, with `onSelect` delegating to `onOpen` so `window.open` stays out of the pure lib. Unit tests MUST cover label composition with/without `prNumber`, the empty result without `prUrl`, and the `onSelect` delegation, in the existing `app/frontend/src/lib/palette-open.test.ts`.

- **GIVEN** the builder is called with `prUrl` undefined
- **WHEN** it returns
- **THEN** the result is `[]`

- **GIVEN** the builder is called with a `prUrl` and an `onOpen` spy
- **WHEN** the returned action's `onSelect` runs
- **THEN** `onOpen` is called with the `prUrl`

### Non-Goals

- No `OpenTarget` entry — the top-bar Open split-button menu is untouched (preserves the documented palette↔menu target mirror)
- No backend change — no `POST /api/open`, no `wt open`, no exec
- No keyboard chord — the palette entry itself is the keyboard path (documented in the registration comment per the code-review shortcut rule)
- No board/server-page variant — v1 is the terminal window page only

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add pure builder `buildOpenPrAction(prUrl, prNumber, onOpen)` to `app/frontend/src/lib/palette-open.ts` — returns `[]` without `prUrl`; otherwise one `{ id: "open-pr", label: "Open: PR #{n}" | "Open: PR", onSelect: () => onOpen(prUrl) }`; header comment documents no-chord + no-OpenTarget rationale <!-- R3 -->
- [x] T002 [P] Add unit tests for `buildOpenPrAction` to `app/frontend/src/lib/palette-open.test.ts`: label with `prNumber`, fallback label without `prNumber`, empty result without `prUrl`, `onSelect` delegates the url to `onOpen` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Wire `buildOpenPrAction` into the `openActions` useMemo in `app/frontend/src/app.tsx` (~line 2018): spread its result after the existing `buildOpenActions(...)`, sourcing `currentWindow?.prUrl` / `currentWindow?.prNumber`, with `onOpen` = `(url) => window.open(url, "_blank", "noopener,noreferrer")`; add the two sourced values to the deps array; registration comment documents the keyboard path <!-- R1 -->
- [x] T004 Run gates: `just test-frontend` (Vitest) and `cd app/frontend && npx tsc --noEmit` — both green <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: With `prUrl` + `prNumber` on the current window, the palette carries an `open-pr` action labeled `Open: PR #{n}`, grouped with the `Open:` family; without `prUrl` (or off the terminal route) no such action exists — `palette-open.ts:72-79` gates on `prUrl`; `app.tsx:2039` spreads it after `buildOpenActions` inside the same `openActions` memo; `currentWindow` is null off the terminal route (`app.tsx:460-463`)
- [x] A-002 R2: Selecting the action calls `window.open(prUrl, "_blank", "noopener,noreferrer")`; the diff contains no backend, `OpenTarget`, top-bar menu, or keyboard-chord changes — `app.tsx:2040`; diff touches only `app.tsx`, `lib/palette-open.ts`, `lib/palette-open.test.ts`
- [x] A-003 R3: `buildOpenPrAction` is a pure builder in `lib/palette-open.ts` with passing colocated unit tests covering both labels, the empty result, and `onSelect` delegation — `palette-open.test.ts:60-83`, 9/9 green

### Edge Cases & Error Handling

- [x] A-004 R1: `prUrl` present with `prNumber` absent yields the `Open: PR` fallback label (verified by unit test) — `palette-open.test.ts:74-76`; `prNumber != null` guard is stricter than the truthiness check at `status-dot-tip.tsx:85`

### Code Quality

- [x] A-005 Pattern consistency: New code follows the established pure-builder pattern (`palette-view`/`palette-pin`/`palette-open`) and surrounding naming/structure
- [x] A-006 No unnecessary duplication: Reuses `OpenPaletteAction` type and the existing `openActions` composition; no new utilities duplicating existing ones
- [x] A-007 Tests included: The new behavior ships with unit tests in the same commit (code-quality.md: new features MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **T004 gate caveat**: `npx tsc --noEmit` is clean and all 4 new `palette-open` tests pass. The full `just test-frontend` suite carries 292 **pre-existing** failures (20 files, `localStorage`/jsdom environment errors under Node 26 + pnpm 11 on this machine) — verified identical with the change stashed (1536 passed baseline → 1540 with this change, zero new failures). Unrelated to this diff.
- **Env note (not part of this change's diff intent)**: pnpm 11 no longer reads `package.json` `pnpm.onlyBuiltDependencies`; a fresh worktree fails `just setup`/`pnpm install` with `ERR_PNPM_IGNORED_BUILDS`. Unblocked locally via `pnpm approve-builds esbuild sharp '!msw'`, which wrote the untracked `app/frontend/pnpm-workspace.yaml` (`allowBuilds:` map). Whether to commit that file (the pnpm-11 home for build approvals) is a repo-infra decision outside this change's scope.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The mouse affordances it complements (`components/sidebar/status-panel.tsx:373` `PrLinkRow`, `components/status-dot-tip.tsx:80-88` "Open PR #N" tip link) remain the pointer-driven paths and are unaffected by adding a keyboard path.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Builder signature matches the intake's sketch verbatim: `(prUrl: string \| undefined, prNumber: number \| undefined, onOpen: (url: string) => void) => OpenPaletteAction[]` | Intake gave the sketch with discretion; it fits the file's existing `buildOpenActions` shape exactly | S:80 R:95 A:90 D:85 |
| 2 | Certain | PR action is spread after the OpenTarget actions inside the same `openActions` useMemo (last in the `Open:` group), with `currentWindow?.prUrl`/`prNumber` added to the deps array | Intake says "rendered alongside the existing `Open:` actions" in the `openActions` block; appending is the minimal, obvious composition | S:70 R:95 A:85 D:75 |

2 assumptions (2 certain, 0 confident, 0 tentative).
