# Intake: Top-Bar & Panel Retirement Sweep

**Change**: 260814-6b0j-top-bar-panel-retirement
**Created**: 2026-08-14

## Origin

One-shot `/fab-new` invocation combining two items from the 08-14 memory-distillation backlog batch (`fab/backlog.md`, relocated there by PR #602). User's raw input:

> Combined retirement sweep, 2 items from the 08-14 memory-distillation backlog batch (fab/backlog.md, relocated by PR #602): (1) [rs5t] Retirement sweep — delete the unreferenced view/panel helpers: resolveView, writeStoredView (lib/window-view.ts), resolvePanel, writeStoredPanel/removeStoredPanel, and the runkit-panel-width machinery (lib/right-panel.ts). CRITICAL: readStoredPanel must STAY — it is the layout shim's legacy-seed source. Deletion candidates are also listed in fab/changes/260812-ab5v-surface-layout-core/plan.md section Deletion Candidates. (2) [v3kd] Delete the demoted in-bar top-bar components: ClosePaneButton, FixedWidthToggle, and the TerminalFontControl popover (app/frontend/src/components/top-bar.tsx). All registry entries are menuOnly, so the in-bar forms never render. DECISION (user, 2026-08-14): delete them — the terminal-font RESET affordance is dropped from chrome; reset remains reachable via the command palette and the settings dialog, no relocation needed. Land as ONE change, one PR. When shipped, tick the 2 boxes [x] in fab/backlog.md (ids rs5t, v3kd).

Key decisions carried in from the invocation: land both items as ONE change/one PR; the terminal-font RESET affordance is **dropped from chrome** (explicit user decision, 2026-08-14 — no relocation; reset stays reachable via the command palette's `Reset terminal font` and the settings dialog); tick both backlog boxes at ship.

Note: the referenced `fab/changes/260812-ab5v-surface-layout-core/plan.md` § Deletion Candidates is not present in this worktree (the change folder is gone/archived elsewhere). The deletion set was instead **verified directly against the code at intake time** — see Assumptions #1.

## Why

1. **The pain point**: two demotions left dead exports and unreachable components behind. The surface-layout core change (260812-ab5v) replaced the single-lens `resolveView`/panel resolution path with the layout ladder (`lib/surface-layout.ts`), stranding `resolveView`, `writeStoredView`, `resolvePanel`, `writeStoredPanel`/`removeStoredPanel`, and the whole per-viewer `runkit-panel-width` machinery — all now referenced only by their own unit tests. Separately, the 260731-oiho top-bar demotions made the `fixed-width`, `terminal-font`, and `close-pane` registry entries `menuOnly`, so their in-bar component forms (`FixedWidthToggle`, `TerminalFontControl`, `ClosePaneButton` in `top-bar.tsx`) can never render — the chevron-menu rows carry all reachable behavior.
2. **The consequence of not fixing**: dead code with live-looking unit tests reads as load-bearing; stale header comments actively lie (window-view.ts's header still claims "the render branch in `app.tsx` AND the window-switch transition classification both call `resolveView`" — nothing calls it). Future changes waste effort keeping unreachable code compiling and its tests green.
3. **Why deletion over keeping/relocating**: the `menuOnly` demotions have stuck (the backlog's own condition); the one affordance that existed only in a deleted component — the terminal-font RESET stepper in the in-bar `TerminalFontControl` popover — was explicitly ruled droppable by the user (reset remains in the palette and the settings dialog). Everything else is byte-for-byte unreachable.

## What Changes

### 1. `app/frontend/src/lib/window-view.ts` — delete two helpers

- **Delete** `resolveView` (the URL → localStorage → default lens resolver) and `writeStoredView`.
- **Keep** everything else — grep-verified live consumers:
  - `readStoredView` — `app.tsx:1807` (layout-shim legacy seed)
  - `defaultView`, `windowViewStorageKey` — `lib/surface-layout.ts`
  - `availableViews`, `nextView` — `app.tsx`
  - `hasWebUrl`, `hasChat`, `hasCode`, `ViewName`, `ViewWindow`, `HINT_ORDER` — capability sources for the shared registry
- **Delete the corresponding unit tests** in `lib/window-view.test.ts` (`resolveView` precedence describe-block; `writeStoredView` cases — keep the `readStoredView` cases, splitting the shared read/write round-trip tests to exercise `readStoredView` via direct `localStorage.setItem` where needed).
- **Fix the stale header comment** claiming `app.tsx` and the window-switch transition classification call `resolveView`.
- Comment-only mentions elsewhere (`tests/e2e/connection-budget.spec.ts:120` + its `.spec.md`) describe capability *fallback* behavior generically; reword only if the sentence stops being true — no test-behavior change.

### 2. `app/frontend/src/lib/right-panel.ts` — delete the panel resolver + width machinery

- **Delete** `resolvePanel`, `writeStoredPanel`, `removeStoredPanel`.
- **Delete the `runkit-panel-width` machinery**: `PANEL_WIDTH_STORAGE_KEY`, `DEFAULT_PANEL_WIDTH_PCT`, `MAX_PANEL_WIDTH_PCT`, `clampPanelWidth`, `readStoredPanelWidth`, `writeStoredPanelWidth`.
- **KEEP (critical)**:
  - `readStoredPanel` — the layout shim's **legacy-seed source** (`app.tsx:1808`). Explicitly named must-stay by the user.
  - `panelStorageKey` — `readStoredPanel`'s key builder.
  - `clampRatio` and `MIN_PANEL_WIDTH_PX` — live consumers in `components/surface-layout.tsx:19` (the layout-divider clamp).
  - `SurfaceName`, `availableSurfaces` — verify at apply time; delete only if grep shows no non-test consumer (they delegate to `surface-layout.ts`'s `availableTiles`), otherwise keep. <!-- assumed: availableSurfaces/SurfaceName not in the user's deletion list — treated as keep-unless-provably-dead at apply -->
- **Delete the corresponding unit tests** in `lib/right-panel.test.ts` (`resolvePanel`, `clampPanelWidth`, panel-width describe-blocks; keep `readStoredPanel` and `clampRatio` coverage, seeding localStorage directly where the deleted writers were used as test setup).
- Comment-only references to the deleted names used as pattern analogies (`lib/surface-layout.ts:386`, `components/surface-layout.tsx:80,223` — "the `readStoredPanelWidth` discipline", "the `clampPanelWidth` approach") are rewritten to describe the discipline without naming a deleted symbol.

### 3. `app/frontend/src/components/top-bar.tsx` — delete the demoted in-bar components

- **Delete the component functions** `ClosePaneButton` (~line 2034), `TerminalFontControl` (~line 2163), and `FixedWidthToggle` (~line 2354).
- The three `menuOnly: true` registry entries (`fixed-width`, `terminal-font`, `close-pane`) **stay** — their `menuRender` rows (`FixedWidthMenuRow`, `TerminalFontMenuRow`, `ClosePaneMenuRow`) carry all reachable behavior. Their `barRender` fields switch to the existing `barRender: () => null` pattern already used by other registry entries (top-bar.tsx:657–673). The registry item type keeps `barRender` required.
- **Terminal-font RESET affordance is dropped from chrome** (user decision 2026-08-14): the in-bar Aa popover was its only chrome home; reset remains reachable via the command palette (`Reset terminal font`) and the settings dialog. `TerminalFontMenuRow` is unchanged.
- **`FixedWidthGlyph` stays** in `top-bar-icons.tsx` (used by `FixedWidthMenuRow` at top-bar.tsx:2478); the state-driven `<FixedWidthGlyph expanded={fixedWidth}>` arrow flip goes with `FixedWidthToggle` (accepted in the backlog caveat).
- **`settings-dialog.tsx` is untouched** — it has its own separate `TerminalFontControl` component (settings-dialog.tsx:297), a different function that merely shares the name.
- **Stale comments updated**: the `terminal-font` registry comment ("The in-bar Aa popover (TerminalFontControl) stays intact but unreachable, n2n4-style") and any other comment that names a deleted component as existing code (e.g. `open-button.tsx:60`'s "the TerminalFontControl popover pattern", `top-bar-icons.tsx` glyph doc-comments) are reworded to past-tense/pattern language or trimmed.
- `top-bar.test.tsx` comment at line 602 (references the demoted popover) updated if its claim goes stale; no test currently renders the deleted components (grep-verified — only comments).

### 4. `fab/backlog.md` — tick both boxes at ship

When the change ships, mark `[x]` on the two items with ids `rs5t` (line ~68) and `v3kd` (line ~66).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) drop/retire references to `resolveView`/`resolvePanel`/panel-width as live mechanisms; the layout ladder is the sole resolver, `readStoredPanel`/`readStoredView` noted as legacy-seed-only survivors
- `run-kit/ui/top-bar`: (modify) the three `menuOnly` entries no longer have in-bar component forms; menu rows are the only rendering; terminal-font reset affordance dropped from chrome
- `run-kit/ui/visual-design`: (modify) the state-driven `FixedWidthGlyph expanded` arrow-flip treatment is gone (glyph itself survives in the menu row)

## Impact

- **Frontend only**, no behavior change — every deleted symbol is unreachable or unreferenced outside its own unit tests (grep-verified at intake, 2026-08-14).
- Files: `app/frontend/src/lib/window-view.ts` + `.test.ts`, `app/frontend/src/lib/right-panel.ts` + `.test.ts`, `app/frontend/src/components/top-bar.tsx`, comment-only touches in `lib/surface-layout.ts`, `components/surface-layout.tsx`, `open-button.tsx`, `top-bar-icons.tsx`, `top-bar.test.tsx`; `fab/backlog.md` at ship.
- No Go/backend changes; no route, API, or localStorage-format changes (`runkit-panel-width` stops being *written*; stale keys in existing browsers are simply ignored — nothing reads them).
- Verification: `npx tsc --noEmit` + Vitest unit suites for the two lib files and top-bar; e2e unaffected (no e2e test references the deleted symbols other than in comments).

## Open Questions

*(none — the one genuine decision, dropping vs relocating the terminal-font reset affordance, was decided by the user in the invocation)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The deletion set is exactly: `resolveView`, `writeStoredView`, `resolvePanel`, `writeStoredPanel`, `removeStoredPanel`, `PANEL_WIDTH_STORAGE_KEY`, `DEFAULT_PANEL_WIDTH_PCT`, `MAX_PANEL_WIDTH_PCT`, `clampPanelWidth`, `readStoredPanelWidth`, `writeStoredPanelWidth`, plus components `ClosePaneButton`/`TerminalFontControl`/`FixedWidthToggle` in top-bar.tsx; keepers `readStoredPanel`, `panelStorageKey`, `clampRatio`, `MIN_PANEL_WIDTH_PX`, `readStoredView` all have grep-verified live consumers | Verified by direct grep at intake — every candidate is referenced only by its own unit test; keepers referenced from app.tsx / surface-layout | S:90 R:85 A:95 D:90 |
| 2 | Certain | Terminal-font RESET affordance is dropped from chrome, no relocation | Explicit user decision (2026-08-14) recorded in the invocation; reset remains in palette + settings dialog | S:95 R:70 A:95 D:95 |
| 3 | Confident | The three `menuOnly` registry entries switch to `barRender: () => null` rather than making `barRender` optional in the item type | Matches the existing pattern at top-bar.tsx:657–673; smallest type-surface change, easily revisited | S:70 R:90 A:80 D:70 |
| 4 | Confident | Unit tests of deleted symbols are deleted; tests of keepers are preserved (seeding localStorage directly where a deleted writer was test setup); stale comments naming deleted symbols as live code are reworded, pattern-analogy comments rewritten to not name deleted symbols | Standard retirement hygiene; test-file surgery is mechanical and reversible | S:65 R:90 A:85 D:70 |
| 5 | Certain | One change, one PR covering both backlog items; both boxes (`rs5t`, `v3kd`) ticked `[x]` in fab/backlog.md at ship | Explicit user instruction in the invocation | S:95 R:90 A:95 D:95 |
| 6 | Certain | `FixedWidthGlyph` stays in top-bar-icons.tsx; only the state-driven `expanded` flip usage is dropped | Grep-verified: `FixedWidthMenuRow` (top-bar.tsx:2478) renders it; backlog caveat explicitly accepts dropping the flip | S:80 R:85 A:85 D:80 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
