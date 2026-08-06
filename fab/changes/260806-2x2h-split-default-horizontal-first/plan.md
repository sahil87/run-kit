# Plan: Split Default Horizontal First

**Change**: 260806-2x2h-split-default-horizontal-first
**Intake**: `intake.md`

## Requirements

Canonical direction semantics (unchanged API): `horizontal: true` → tmux `split-window -h` → side-by-side (NEW DEFAULT); `horizontal: false` → `split-window -v` → stacked. After this change every UI surface uses the chip's naming convention (matching tmux flag names).

### Top Bar: SplitControl default direction

#### R1: Primary segment splits horizontally
The `SplitControl` primary segment (`app/frontend/src/components/top-bar.tsx`) MUST perform a horizontal (side-by-side) split: `onClick={() => run(true)}`, glyph `SplitHorizontalGlyph` (the shared `top-bar-icons.tsx` definition carrying `data-icon="split-horizontal"`, preserving the leading-glyph-parity contract from 260801-3q1z), and `aria-label`/`Tip` label "Split horizontally". The spinner-while-pending behavior MUST be unchanged, and the primary MUST remain a fixed direction (not last-used) — only which direction is fixed flips.

- **GIVEN** a terminal window route (or a board with a focused tile) rendering the merged split control in-bar
- **WHEN** the user clicks the primary segment
- **THEN** `splitWindow(server, windowId, true, cwd)` is called (side-by-side split)
- **AND** the segment's accessible name is "Split horizontally" with the `split-horizontal` glyph

#### R2: ▾ direction menu lists horizontal first
The `role="menu" aria-label="Split direction"` popover MUST list `Split horizontal` (with `SplitHorizontalGlyph`) FIRST, then `Split vertical`. Both rows MUST keep their existing behavior (leading direction glyph, `disabled` dim while pending, `POPOVER_ROW_CLASS`), and the menu MUST continue to list BOTH directions (complete-option-set split-button convention).

- **GIVEN** the SplitControl ▾ segment is clicked
- **WHEN** the direction menu opens
- **THEN** the first `menuitem` is "Split horizontal" (fires `run(true)`) and the second is "Split vertical" (fires `run(false)`)

#### R3: Overflow-menu split rows horizontal first
The registry `split` entry's `menuRender` (top-bar.tsx, ~line 572) MUST emit the `horizontal` `SplitMenuRow` first, then the vertical one — in BOTH the board-mode and terminal-mode branches of the closure. `SplitMenuRow` itself MUST be unchanged.

- **GIVEN** the split control has overflowed into the chevron menu (e.g., 375px viewport)
- **WHEN** the "More controls" menu opens
- **THEN** the `Split horizontal` row precedes the `Split vertical` row in the Window group

#### R4: Doc comments describe the new default
The load-bearing comments MUST be updated: the registry `split` entry comment ("primary click = split vertical (the long-standing default)", ~lines 554–558) and the `SplitControl` doc block ("PRIMARY segment: split VERTICAL (the long-standing default)", ~lines 1890–1897) — both now describe horizontal as the primary with a note that the default flipped in this change (260806-2x2h).

- **GIVEN** the updated top-bar.tsx
- **WHEN** reading the registry entry and SplitControl doc comments
- **THEN** neither declares vertical the default; both describe the horizontal primary and note the flip

### Command Palette: label/boolean alignment

#### R5: Terminal palette booleans fixed, horizontal first
The terminal palette pair in `app/frontend/src/app.tsx` (~lines 1864–1877) MUST send booleans matching the chip semantics: `Window: Split Horizontal` → `executeSplit(..., true, ...)`, `Window: Split Vertical` → `executeSplit(..., false, ...)`, with the Horizontal entry listed first (default-first ordering).

- **GIVEN** a terminal window route with the palette open
- **WHEN** the user selects `Window: Split Horizontal`
- **THEN** `executeSplit(server, windowId, true, worktreePath)` fires (side-by-side — same result as the chip's "Split horizontally")

#### R6: Board palette booleans fixed, horizontal first, divergence comment removed
The board palette pair in `app/frontend/src/components/board/board-page.tsx` (~lines 818–835) MUST get the same swap: `Board: Split Focused Pane Horizontal` → `executeSplit(..., true, ...)`, `Board: Split Focused Pane Vertical` → `executeSplit(..., false, ...)`, Horizontal listed first. The comment block (~line 818) documenting the divergence as "left out of scope" MUST be replaced — the divergence is resolved; all surfaces share one direction vocabulary.

- **GIVEN** a board route with ≥1 pane and the palette open
- **WHEN** the user selects `Board: Split Focused Pane Horizontal`
- **THEN** `executeSplit(focusedPane.server, focusedPane.windowId, true, focusedPane.cwd)` fires

### Backend: shortcuts-overlay labels

#### R7: Keybinding whitelist labels swapped
`keybindingWhitelist` in `app/backend/api/keybindings.go` (~lines 22–23) MUST map `"split-window -h"` → `"Split horizontally"` and `"split-window -v"` → `"Split vertically"`, so the shortcuts overlay teaches the same vocabulary as the chip. No handler, route, or tmux-layer changes.

- **GIVEN** a tmux server with `split-window -h` / `-v` bindings
- **WHEN** `GET /api/keybindings` responds
- **THEN** the `-h` binding is labeled "Split horizontally" and the `-v` binding "Split vertically"

### Tests

#### R8: Unit/component and Go tests updated to the new semantics
All affected unit tests MUST be updated to assert the new default and swapped booleans: `top-bar.test.tsx` (merged-SplitControl suites — primary label/boolean/glyph, board-mode primary boolean, measurement-probe `data-icon`), `shortcuts-overlay.test.tsx` (fixture + assertions), `command-palette.boards.test.tsx` (board split palette entries), `app/backend/api/keybindings_test.go` (expected label list + matchWhitelist case). Tests conform to the implementation spec (constitution Test Integrity).

- **GIVEN** the updated implementation
- **WHEN** `just test-frontend` and `go test ./...` run
- **THEN** all suites pass with assertions keyed on "Split horizontally" as the primary and the swapped booleans/labels

#### R9: e2e specs and `.spec.md` companions updated in the same commit
The Playwright specs anchoring on the old primary label or old whitelist labels MUST be updated together with their `.spec.md` companions (constitution Test Companion Docs): `top-bar-overflow.spec.ts` (+`.md`), `open-in-app.spec.ts` (+`.md`), `shortcut-registry.spec.ts` (+`.md`), `top-bar-refresh.spec.ts` (+`.md` — its `splitButton` anchor keys on "Split vertically" too).

- **GIVEN** the updated implementation
- **WHEN** `just pw test top-bar-overflow open-in-app shortcut-registry top-bar-refresh` runs
- **THEN** the affected specs pass with anchors keyed on "Split horizontally", and each modified `.spec.ts` has its `.spec.md` updated in the same commit

### Non-Goals

- No last-used split-direction persistence (no localStorage preference, no settings surface) — the primary stays a fixed direction.
- No backend contract change — the `horizontal` boolean semantics and tmux layer are untouched.
- No memory (`docs/memory/`) edits at apply — hydrate owns the `ui-patterns.md` updates.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Swap the SplitControl primary segment in `app/frontend/src/components/top-bar.tsx` (~line 1961): `run(true)`, `SplitHorizontalGlyph`, `Tip`/`aria-label` "Split horizontally"; spinner behavior unchanged <!-- R1 -->
- [x] T002 Reorder the SplitControl ▾ direction menu in `app/frontend/src/components/top-bar.tsx` (~line 2013): `Split horizontal` row (`run(true)`, `SplitHorizontalGlyph`) first, then `Split vertical` <!-- R2 -->
- [x] T003 Reorder the registry `split` entry's `menuRender` in `app/frontend/src/components/top-bar.tsx` (~line 572): `<SplitMenuRow horizontal …/>` before the vertical row in both the board and terminal branches <!-- R3 -->
- [x] T004 Update the doc comments in `app/frontend/src/components/top-bar.tsx`: registry entry comment (~lines 554–558) and SplitControl doc block (~lines 1890–1897) — horizontal is the primary; note the default flipped in 260806-2x2h <!-- R4 -->
- [x] T005 [P] Fix the terminal palette pair in `app/frontend/src/app.tsx` (~lines 1864–1877): swap the `executeSplit` booleans to match labels and list `Window: Split Horizontal` first <!-- R5 -->
- [x] T006 [P] Fix the board palette pair in `app/frontend/src/components/board/board-page.tsx` (~lines 818–835): swap booleans, list `Board: Split Focused Pane Horizontal` first, and replace the "left out of scope" divergence comment (~line 818) with one stating the shared convention <!-- R6 -->
- [x] T007 [P] Swap the two whitelist labels in `app/backend/api/keybindings.go` (~lines 22–23): `"split-window -h"` → "Split horizontally", `"split-window -v"` → "Split vertically" <!-- R7 -->

### Phase 2: Tests

- [x] T008 Update `app/frontend/src/components/top-bar.test.tsx`: merged-SplitControl suites (~lines 844–869, 995–1082) — primary = "Split horizontally"/`splitWindow(..., true, ...)`, ▾ → "Split vertical" fires `false`, board-mode primary boolean, absent-label queries, pending-state anchors; glyph-parity suite (~lines 1332–1450) — probe `aria-label` and `data-icon="split-horizontal"` on the primary + probe <!-- R8 -->
- [x] T009 [P] Update `app/frontend/src/components/shortcuts-overlay.test.tsx`: fixture `split-window -h` label → "Split horizontally" (~line 244) and the three "Split vertically" assertions (~lines 313, 341, 346) <!-- R8 -->
- [x] T010 [P] Update `app/frontend/src/components/command-palette.boards.test.tsx`: reorder the board split fixture entries horizontal-first to mirror `board-page.tsx` and refresh their comments <!-- R8 -->
- [x] T011 [P] Update `app/backend/api/keybindings_test.go`: expected label list (~line 52) and the `matchWhitelist` case (~line 175) reflect the swapped labels <!-- R8 -->
- [x] T012 Update `app/frontend/tests/e2e/top-bar-overflow.spec.ts` + `top-bar-overflow.spec.md`: `L1: ["Split horizontally"]` (~line 50), in-bar anchor (~line 280), menu-row comments (~lines 242–293), first-fit-candidate test (~lines 430–468) retitled/re-anchored on "Split horizontally" <!-- R9 -->
- [x] T013 [P] Update `app/frontend/tests/e2e/open-in-app.spec.ts` + `open-in-app.spec.md`: `splitAnchor` keys on "Split horizontally" (~line 94) <!-- R9 -->
- [x] T014 [P] Update `app/frontend/tests/e2e/shortcut-registry.spec.ts` + `shortcut-registry.spec.md`: tmux keybinding fixture label (~line 60) and assertions (~lines 158, 165) reflect the swapped `keybindings.go` labels <!-- R9 -->
- [x] T015 [P] Update `app/frontend/tests/e2e/top-bar-refresh.spec.ts` + `top-bar-refresh.spec.md`: `splitButton` anchor (~line 107) and prose key on "Split horizontally" <!-- R9 -->

### Phase 3: Verification

- [x] T016 Run the gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just pw test top-bar-overflow open-in-app shortcut-registry top-bar-refresh` <!-- R8 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The SplitControl primary segment calls `splitWindow(..., true, ...)`, renders `SplitHorizontalGlyph` (`data-icon="split-horizontal"`), and is labeled "Split horizontally" (Tip + aria-label); spinner-while-pending unchanged — `top-bar.tsx:1966-1975`
- [x] A-002 R2: The ▾ direction menu lists "Split horizontal" first, "Split vertical" second, both functional with leading glyphs and pending-dim — `top-bar.tsx:2015-2036`
- [x] A-003 R3: The overflow `menuRender` emits the horizontal `SplitMenuRow` before the vertical one in both terminal and board branches; `SplitMenuRow` unchanged — `top-bar.tsx:574-586`, `SplitMenuRow` (2439-2470) untouched in the diff
- [x] A-004 R4: No comment in top-bar.tsx still calls vertical "the long-standing default"; both doc comments describe the horizontal primary and note the flip — `top-bar.tsx:553-559`, `1893-1904`; repo-wide grep for "long-standing default" returns nothing
- [x] A-005 R5: `Window: Split Horizontal` sends `horizontal: true`, `Window: Split Vertical` sends `false`, Horizontal listed first in app.tsx — `app.tsx:1864-1882`
- [x] A-006 R6: `Board: Split Focused Pane Horizontal` sends `true`, `…Vertical` sends `false`, Horizontal first; the "left out of scope" divergence comment is gone from board-page.tsx — `board-page.tsx:813-837`
- [x] A-007 R7: `keybindingWhitelist` maps `-h` → "Split horizontally" and `-v` → "Split vertically"; no other backend change — `keybindings.go:22-23` (backend diff is those two lines plus the two test expectations)

### Behavioral Correctness

- [x] A-008 R1: Primary click on a terminal window and on a board focused tile both produce a side-by-side split (`horizontal: true`), verified by top-bar.test.tsx — board-mode suite (`:844-869`) and terminal-mode suite (`:1035-1043`) both assert `splitWindow(..., true, ...)`
- [x] A-009 R5: Palette and chip now agree — selecting either surface's "Horizontal" action produces the same tmux `split-window -h` result (no same-name-opposite-action divergence remains in the codebase). Traced every `horizontal` boolean across `top-bar.tsx`, `app.tsx`, `board-page.tsx`, `keybindings.go`; the tmux cheatsheet in `configs/tmux/poweruser.conf:129-130` already used the same convention
- [x] A-010 R8: `top-bar.test.tsx`, `shortcuts-overlay.test.tsx`, `command-palette.boards.test.tsx`, and `keybindings_test.go` pass with assertions keyed on the new semantics — `just test-frontend` 121 files / 2198 tests green; `go test ./...` all packages ok
- [x] A-011 R9: `top-bar-overflow`, `open-in-app`, `shortcut-registry`, and `top-bar-refresh` e2e specs pass with "Split horizontally" anchors, and each modified `.spec.ts` has its `.spec.md` companion updated in the same commit — all four `.spec.ts`/`.spec.md` pairs are modified together and every anchor string matches the implementation's accessible names exactly. E2E re-run at review was not possible in this environment (`just test-e2e` aborts: `air` is not installed, so the dev server never comes up); the pass rests on the apply agent's reported 26/26 plus static anchor verification

### Edge Cases & Error Handling

- [x] A-012 R1: Pending state still disables both segments and shows the spinner in the primary; error path still toasts (behavior untouched, verified by the existing pending test updated to the new anchor) — `top-bar.test.tsx:1073-1090`; `run`/`useOptimisticAction` wiring unchanged in the diff

### Code Quality

- [x] A-013 Pattern consistency: Changes follow the existing SplitControl/registry/palette patterns — no new components, no styling changes, shared glyph definitions reused
- [x] A-014 No unnecessary duplication: `SplitMenuRow`, shared glyphs, and `executeSplit` reused as-is; no reimplementation
- [x] A-015 Tests conform to the implementation spec (constitution Test Integrity): only expectations/anchors changed, no implementation code bent to fixtures
- [x] A-016 No magic strings introduced: labels follow the existing literal-label convention used across the top-bar and palette surfaces
- [x] A-017 Frontend type check passes (`npx tsc --noEmit`, exit 0); no `as` casts added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `None — this change swaps in-place defaults, orderings, and booleans; it adds no new symbol, and every symbol it touches (SplitVerticalGlyph, SplitMenuRow, executeSplit, the split registry entry) keeps its call sites.`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `top-bar-refresh.spec.ts` is affected (not just its `.spec.md`): its `splitButton` anchor keys on "Split vertically" at line 107 — update both files | Intake asked to verify; verified in source | S:85 R:90 A:95 D:95 |
| 2 | Confident | `command-palette.boards.test.tsx` changes are fixture reorder + comment refresh only — the fixture's local entries carry no booleans (handlers are injected), and no ordering assertion exists, so horizontal-first mirroring keeps the fixture honest without behavioral churn | Fixture mirrors board-page.tsx entries; booleans live in board-page.tsx, covered by A-006 | S:60 R:90 A:85 D:80 |
| 3 | Confident | The overflow e2e test titled "split-vertical is the first fit candidate…" is retitled/re-anchored to the horizontal primary — the fit-pyramid invariant (L1 split control yields first) is unchanged; only the primary segment's accessible name changed | The test keys on the L1 registry entry via its primary label; registry id `split` and fit order untouched | S:60 R:90 A:85 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).
