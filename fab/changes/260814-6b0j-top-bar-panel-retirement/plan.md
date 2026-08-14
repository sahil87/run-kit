# Plan: Top-Bar & Panel Retirement Sweep

**Change**: 260814-6b0j-top-bar-panel-retirement
**Intake**: `intake.md`

## Requirements

### Frontend Lib: window-view retirement

#### R1: Delete the stranded lens-resolution helpers
`lib/window-view.ts` SHALL no longer export `resolveView` or `writeStoredView`; every other export (`readStoredView`, `defaultView`, `availableViews`, `nextView`, `windowViewStorageKey`, `hasWebUrl`, `hasChat`, `hasCode`, `ViewName`, `ViewWindow`) MUST remain unchanged. The module header comment MUST stop claiming that `app.tsx` / the window-switch transition classification call `resolveView`.

- **GIVEN** the surface-layout ladder (`resolveLayout` in `lib/surface-layout.ts`) owns lens resolution
- **WHEN** `resolveView` and `writeStoredView` are deleted
- **THEN** `tsc --noEmit` passes and the remaining `window-view.test.ts` suites pass
- **AND** `readStoredView` keeps serving `app.tsx:1807` (legacy layout seed) untouched

### Frontend Lib: right-panel retirement

#### R2: Delete the panel resolver and the `runkit-panel-width` machinery
`lib/right-panel.ts` SHALL no longer export `resolvePanel`, `writeStoredPanel`, `removeStoredPanel`, `PANEL_WIDTH_STORAGE_KEY`, `DEFAULT_PANEL_WIDTH_PCT`, `MAX_PANEL_WIDTH_PCT`, `clampPanelWidth`, `readStoredPanelWidth`, or `writeStoredPanelWidth`. It MUST keep `readStoredPanel` (the layout shim's legacy-seed source — `app.tsx:1808`; user-designated must-stay), `panelStorageKey` (its key builder), `clampRatio` + `MIN_PANEL_WIDTH_PX` (live in `components/surface-layout.tsx:19`), and `SurfaceName` + `availableSurfaces` (live in `app.tsx:10,12`).

- **GIVEN** the layout ladder replaced the `?panel=` slot model and nothing reads/writes `runkit-panel-width`
- **WHEN** the nine symbols are deleted
- **THEN** `tsc --noEmit` passes, `components/surface-layout.tsx` still imports `clampRatio`/`MIN_PANEL_WIDTH_PX`, and `app.tsx` still imports `readStoredPanel`/`availableSurfaces`/`SurfaceName`
- **AND** existing browsers' stale `runkit-panel-width` localStorage keys are simply never read (no migration needed)

### Frontend Components: top-bar in-bar component deletion

#### R3: Delete the demoted in-bar component forms
`components/top-bar.tsx` SHALL no longer define `ClosePaneButton`, `TerminalFontControl`, or `FixedWidthToggle`. The three `menuOnly: true` registry entries (`fixed-width`, `terminal-font`, `close-pane`) MUST remain with their `menuRender` rows unchanged (`FixedWidthMenuRow`, `TerminalFontMenuRow`, `ClosePaneMenuRow` — including the board-mode Kill wiring through `onRequestKill`) and their `barRender` fields switched to the existing `barRender: () => null` pattern (top-bar.tsx:657–673). The registry item type keeps `barRender` required.

- **GIVEN** all three entries are `menuOnly`, so their `barRender` output can never render
- **WHEN** the component functions are deleted and `barRender` returns `null`
- **THEN** the chevron menu still carries the Fixed width / Terminal font stepper / Close pane–Kill rows with identical behavior
- **AND** `settings-dialog.tsx`'s own separate `TerminalFontControl` (line 297) is untouched
- **AND** `FixedWidthGlyph` stays in `top-bar-icons.tsx` (consumed by `FixedWidthMenuRow`, top-bar.tsx:2478); only the state-driven `expanded` flip usage disappears
- **AND** the terminal-font RESET affordance is gone from chrome (user decision 2026-08-14) — reset remains reachable via the palette's `Reset terminal font` and the settings dialog

#### R4: Stale-comment hygiene
No comment in the frontend source SHALL present a deleted symbol as live code after this change. Specifically: the `terminal-font` registry comment ("stays intact but unreachable, n2n4-style"), the window-view.ts header (R1), pattern-analogy comments naming `clampPanelWidth`/`readStoredPanelWidth` (`lib/surface-layout.ts:386`, `components/surface-layout.tsx:80,223`), and doc-comments in `top-bar-icons.tsx` / `open-button.tsx:60` / `top-bar.test.tsx:602` that reference the deleted components as existing code MUST be reworded (past tense, or describe the discipline without naming a deleted symbol). Unused imports left behind by the deletions MUST be removed.

- **GIVEN** the deletions in R1–R3
- **WHEN** a repo-wide search for the deleted symbol names runs over `app/frontend/src` + `tests` (use `grep -a` or perl — plain grep silently skips `session-tiles.tsx`, which contains a deliberate NUL)
- **THEN** the only remaining hits are historical references that read unambiguously as "this used to exist" (or zero hits)

### Non-Goals

- No relocation of the terminal-font reset stepper — explicitly dropped from chrome by the user.
- No change to the overflow-menu registry type, fit math, or `menuOnly` semantics.
- No backend, route, API, or e2e-behavior changes.
- `fab/backlog.md` box-ticking happens at ship, not during apply.

### Design Decisions

#### Reverting a demotion now means reimplementing, not un-flagging
**Decision**: Delete the demoted in-bar component forms outright; the `260722-n2n4` "reverting = removing the flag" escape lapses for these three controls.
**Why**: The demotions (260731-oiho) have stuck; keeping unreachable components compiling with live-looking tests costs more than the cheap-revert option is worth. Git history preserves the code.
**Rejected**: Keeping the components behind the flag (status quo — perpetual dead weight); relocating the reset stepper to the menu row (user explicitly dropped the affordance).
*Introduced by*: 260814-6b0j-top-bar-panel-retirement

## Tasks

### Phase 2: Core Implementation

- [x] T001 Delete `resolveView` + `writeStoredView` from `app/frontend/src/lib/window-view.ts`; fix the stale header comment; in `window-view.test.ts` delete the `resolveView` describe-block, and rework the "localStorage helpers" describe to exercise `readStoredView` by seeding via `localStorage.setItem(windowViewStorageKey(...))` (drop the write-failure test) <!-- R1 -->
- [x] T002 [P] Delete `resolvePanel`, `writeStoredPanel`, `removeStoredPanel`, and the panel-width machinery (`PANEL_WIDTH_STORAGE_KEY`, `DEFAULT_PANEL_WIDTH_PCT`, `MAX_PANEL_WIDTH_PCT`, `clampPanelWidth`, `readStoredPanelWidth`, `writeStoredPanelWidth`) from `app/frontend/src/lib/right-panel.ts`; update the module header; in `right-panel.test.ts` delete the `resolvePanel` / `clampPanelWidth` / "panel width storage" describes and rework "panel storage keys" to seed via `localStorage.setItem(panelStorageKey(...))`, keeping `readStoredPanel` and `clampRatio` coverage <!-- R2 -->
- [x] T003 [P] Delete `ClosePaneButton`, `TerminalFontControl`, `FixedWidthToggle` from `app/frontend/src/components/top-bar.tsx`; switch the `fixed-width` / `terminal-font` / `close-pane` entries to `barRender: () => null`; update the registry comments; remove imports that become unused <!-- R3 -->
- [x] T004 Stale-comment sweep: rewrite pattern-analogy and doc comments naming deleted symbols in `app/frontend/src/lib/surface-layout.ts`, `components/surface-layout.tsx`, `components/open-button.tsx`, `components/top-bar-icons.tsx`, `components/top-bar.test.tsx`; verify with a NUL-tolerant repo-wide grep (`grep -ra`) over `app/frontend/src` + `app/frontend/tests` <!-- R4 -->
- [x] T005 Verification gates: `cd app/frontend && npx tsc --noEmit`; run the Vitest suites for `window-view`, `right-panel`, `top-bar` (via the project's test runner conventions) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/window-view.ts` exports neither `resolveView` nor `writeStoredView`; all other exports byte-compatible
- [x] A-002 R2: `lib/right-panel.ts` exports none of the nine deleted symbols; `readStoredPanel`, `panelStorageKey`, `clampRatio`, `MIN_PANEL_WIDTH_PX`, `SurfaceName`, `availableSurfaces` remain
- [x] A-003 R3: `top-bar.tsx` defines none of the three components; the three `menuOnly` entries carry `barRender: () => null` and unchanged `menuRender` rows

### Removal Verification

- [x] A-004 R1: no non-historical reference to `resolveView`/`writeStoredView` remains anywhere in `app/frontend`
- [x] A-005 R2: no non-historical reference to the deleted right-panel symbols (incl. the `runkit-panel-width` literal) remains
- [x] A-006 R3: no reference to the deleted components remains except reworded historical comments; `settings-dialog.tsx`'s `TerminalFontControl` untouched; `FixedWidthGlyph` still consumed by `FixedWidthMenuRow`

### Scenario Coverage

- [x] A-007 R1: reworked `window-view.test.ts` still covers `readStoredView` round-trip, key scoping, and read-failure swallowing
- [x] A-008 R2: reworked `right-panel.test.ts` still covers `readStoredPanel` (incl. key scoping) and full `clampRatio` behavior

### Edge Cases & Error Handling

- [x] A-009 R4: the comment sweep used a NUL-tolerant search (plain grep skips `session-tiles.tsx`); no comment presents a deleted symbol as live code

### Code Quality

- [x] A-010 Pattern consistency: `barRender: () => null` matches the existing registry pattern; test rework matches the try/catch-noop localStorage test idiom
- [x] A-011 No dead weight: no unused imports or orphaned constants left behind (`tsc --noEmit` clean)
- [x] A-012 Tests: `window-view`, `right-panel`, and `top-bar` Vitest suites green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `barRender: () => null` over making the field optional | Existing pattern at top-bar.tsx:657–673; smallest type change | S:70 R:90 A:80 D:70 |
| 2 | Confident | Keeper tests reworked by seeding localStorage directly instead of via deleted writers; writer-failure tests deleted with their writers | The read paths keep identical coverage; a writer test without a writer is meaningless | S:65 R:90 A:85 D:70 |
| 3 | Certain | `SurfaceName`/`availableSurfaces` stay (not in the user's deletion list; live in app.tsx) | Grep-verified consumers at app.tsx:10,12 | S:85 R:90 A:95 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).
