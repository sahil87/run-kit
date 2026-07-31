# Plan: Navbar Consolidation — Uniform Control Sizing, History-Nav Move, Control Demotion, Menu Density

**Change**: 260731-oiho-navbar-consolidation-menu-density
**Intake**: `intake.md`

## Requirements

### Frontend: Top-Bar Shared Button Token

#### R1: One shared fixed-size button token
`top-bar-overflow-menu.tsx` SHALL host shared button-size constants (alongside the existing `MENU_ROW_*` host precedent — the file every consumer already imports, no cycle): a full square token (`TOP_BAR_BUTTON_BASE` geometry `w-[28px] h-[28px] coarse:w-[30px] coarse:h-[30px] rounded border flex items-center justify-center transition-colors shrink-0`, a `TOP_BAR_BUTTON_REST` color set, and the composed `TOP_BAR_BUTTON` with `rk-glint`) plus height-only tokens for content-width chips: `TOP_BAR_BUTTON_H = h-[28px] coarse:h-[30px]` for self-bordered chips (UpdateChip) and `TOP_BAR_SEGMENT_H = h-[26px] coarse:h-[28px]` for segments inside a bordered chip wrapper (the wrapper border adds 2px, keeping chip totals equal to the squares). Every top-bar icon control MUST use the shared token instead of the copy-pasted `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] …` string: HistoryNav arrows, sidebar toggle, the split control, FixedWidthToggle, TerminalFontControl trigger, ClosePaneButton, RefreshButton, BoardAutofitToggle, the TerminalFontMenuRow stepper buttons, the overflow-menu chevron trigger, and the version row's check-⟳ button. Content-width chips normalize the HEIGHT axis: UpdateChip (self-bordered) via `TOP_BAR_BUTTON_H`; the OpenButton / split control / ViewSwitcher segments (inside a bordered wrapper) via `TOP_BAR_SEGMENT_H`. The brand crumb's `min-h-[24px]` normalizes to `min-h-[28px]` so the left cluster shares one height axis.

- **GIVEN** the terminal route at a desktop width
- **WHEN** the top bar renders
- **THEN** the sidebar toggle, HistoryNav arrows, and every right-cluster icon button render as identical 28×28 boxes (30×30 on coarse pointers) — content can no longer stretch a box
- **AND** per-callsite variations (disabled states, accent color overrides) compose around the shared constants

#### R2: HistoryNav ◀ ▶ in the LEFT cluster
The back/forward pair MUST move from the center heading box to the left cluster, immediately right of the sidebar toggle (macOS convention). On Host mode (no sidebar toggle) the arrows sit before the brand crumb. Arrows remain on ALL four modes with unchanged semantics (`router.history.back()`/`.forward()`, aria-labels `Go back`/`Go forward`). The pair is `hidden lg:flex` — below `lg` the rigid left cluster (toggle + arrows + the nav's `sm:min-w-[150px]` floor) exceeds its equal-`1fr` side track against a 28ch-capped long-name heading (worst case needs ~832px), and the overflowing nav would paint over the centered prefix, violating the 260715-q8ey no-overlap invariant (`top-bar-overlap.spec.ts`); browser back gestures + the palette's `Go: Back`/`Go: Forward` cover narrow viewports. The center box's width-compensation hack (`mr-2.5` offsetting HeadingPrefix's `-mr-1`, and its comment) MUST be deleted.

- **GIVEN** any of the four page modes at an `lg+` viewport
- **WHEN** the top bar renders
- **THEN** the ◀ ▶ arrows render in the left cluster (after the sidebar toggle where present, before the brand crumb on Host) and no longer inside the `sm:min-w-[28ch]` anchored center box
- **AND** the heading's left anchor stays stable across window-name lengths (the anchor e2e still holds)
- **GIVEN** a viewport below `lg`
- **WHEN** the top bar renders
- **THEN** the arrows are hidden and the breadcrumb nav never overlaps the centered heading (the q8ey overlap e2e sweep holds)

### Frontend: Right-Cluster Consolidation

#### R3: One merged split control
The `split-vertical` and `split-horizontal` registry entries MUST collapse into ONE entry (id `split`) rendering a single split control: a bordered chip with a primary segment (vertical-split icon, aria-label `Split vertically`, click = split vertical) and a small ▾ segment (`aria-haspopup="menu"`/`aria-expanded`, the `OpenButton` precedent) opening a dropdown with `Split vertical` and `Split horizontal` menu rows. The overflow menu keeps BOTH actions as one-action-per-row rows (`menuRender` emits both `SplitMenuRow`s). Board mode uses the same control against `focusedPane` with behavior parity; the board keybindings that call `executeSplit` directly (`board-page.tsx` ~810/817) are untouched. The merged entry takes a single L1 slot and a single probe segment (probe/registry index alignment preserved).

- **GIVEN** a terminal route with a current window
- **WHEN** the split control's primary segment is clicked
- **THEN** `splitWindow(server, windowId, false /* vertical */, cwd)` fires exactly as the old vertical SplitButton did
- **GIVEN** the ▾ segment is clicked
- **WHEN** the `Split horizontal` row is chosen
- **THEN** the horizontal split fires and the dropdown closes
- **GIVEN** board mode with a focused tile
- **WHEN** the split control is used
- **THEN** it acts on `focusedPane` (server/windowId/cwd) exactly as the two old board SplitButtons did

#### R4: Demote terminal-font, fixed-width, close-pane via `menuOnly: true`
The `terminal-font`, `fixed-width`, and `close-pane` registry entries MUST gain `menuOnly: true` (the 260722-n2n4 view-switcher precedent — reverting = deleting the flag). Their bar forms become unreachable (excluded from the visible row, the measurement probe, and the fit budget); their menu rows ALWAYS render in the chevron menu. Coverage invariant (Constitution V): each demoted action stays reachable via the command palette (existing `Pane: Close`, `View: Fixed Width (900px)`/`Full Width`, `Increase/Decrease/Reset terminal font` actions — no new palette entries needed) and the chevron menu. Board mode's ✕ (consequence-gated Kill) demotes uniformly: the Kill menu row keeps the `onRequestKill` confirm-dialog path (with `Unpin instead`). The board-only `autofit` entry stays in-bar unchanged. Terminal-mode right-cluster end state: **Open · Split(▾) · Refresh · chevron** (+ UpdateChip when a qualifying update exists).

- **GIVEN** the terminal route at ANY viewport width
- **WHEN** the top bar renders
- **THEN** no in-bar Aa, fixed-width, or ✕ button exists (bar or probe), while the chevron menu always carries the Fixed width checkbox row, the Terminal font stepper row, and the Close pane row
- **GIVEN** board mode with a focused tile
- **WHEN** the menu's Kill row is clicked
- **THEN** BoardPage's consequence-gated kill dialog opens (never a direct closePane)

### Frontend: Overflow-Menu Density

#### R5: Denser menu rows + section labels
`MENU_ROW_BASE` MUST change from `text-sm px-3 py-2` to `text-xs px-2.5 py-1.5`. The other hardcoded row styles in `top-bar-overflow-menu.tsx` — the update-surface row (~line 363) and the version copy button (~line 392) — and the `TerminalFontMenuRow` wrapper MUST match the same scale. Consumers of `MENU_ROW_*` (e.g. `ViewSwitcherMenuRows`, `OpenMenuRows`) inherit the density automatically (intended). The menu MUST group rows under thin uppercase section labels (**View / Window / App**): registry entries carry a menu group, `TopBarOverflowMenu` renders non-empty groups in fixed order with the existing divider styling (`border-t border-border my-1`) plus an uppercase label (the `OpenButton` "on host" header treatment); the always-present version row rides in the App section. When the menu holds only the version row (nothing overflowed, no menuOnly rows — server/host modes at wide widths), no labels render. Right-aligned shortcut hints are OUT of core scope (nice-to-have only).

- **GIVEN** the chevron menu is open on a terminal route
- **WHEN** the rows render
- **THEN** rows use the `text-xs px-2.5 py-1.5` scale and appear grouped under View / Window / App uppercase section labels
- **GIVEN** a server/host route at a wide width (nothing overflowed)
- **WHEN** the menu opens
- **THEN** only the version row renders, with no section labels

### Tests

#### R6: Unit + e2e coverage updated with the chrome changes
Unit tests (`top-bar.test.tsx`) and Playwright specs MUST be updated with the chrome changes, with every touched `.spec.ts`'s sibling `.spec.md` updated in the same commit-unit (constitution § Test Companion Docs). Known impacted: `top-bar-overflow.spec.ts` (tier lists, menuOnly contract, menu contents), `window-heading.spec.ts` (history-arrows describe block — placement notes; behavior assertions unchanged), `top-bar-refresh.spec.ts` + `open-in-app.spec.ts` (the `Close pane` in-bar sync anchor must be replaced by the currentWindow-gated split control), `board-close-and-unpin.spec.ts` (top-bar Kill now reached via the chevron menu). A sweep of `app/frontend/tests/e2e/` for other chrome assertions MUST run before elements move.

- **GIVEN** the change is complete
- **WHEN** `just test-frontend`, `npx tsc --noEmit`, and the affected e2e suites run (via `just pw` / `just test-e2e` — never direct playwright)
- **THEN** all pass, and each modified `.spec.ts` has its `.spec.md` companion updated

### Non-Goals

- No backend, route, or API changes.
- No deletion of the demoted entries or the Aa popover / ViewSwitcher pill components — demotion is the reversible `menuOnly` flag; unreachable bar forms stay intact (n2n4 precedent).
- No right-aligned shortcut hints in menu rows unless trivially free (explicitly nice-to-have).
- No new palette entries (existing ones already cover the demoted actions).
- `docs/memory/run-kit/ui-patterns.md` updates happen at hydrate, not apply.

### Design Decisions

#### Shared button token hosted in top-bar-overflow-menu.tsx
**Decision**: Host `TOP_BAR_BUTTON*` constants in `top-bar-overflow-menu.tsx` beside `MENU_ROW_*`.
**Why**: Every consumer (top-bar.tsx, open-button.tsx, view-switcher.tsx, the menu itself) already imports that file; no import cycle.
**Rejected**: A new `top-bar-button.ts` module — an extra file for four string constants when an established host exists.
*Introduced by*: 260731-oiho-navbar-consolidation-menu-density

#### Split ▾ dropdown lists both split actions
**Decision**: The merged split control's ▾ opens a dropdown listing `Split vertical` AND `Split horizontal`; the primary segment stays a fixed vertical split (not last-used).
**Why**: Split-button convention (and the OpenButton precedent) lists the complete option set in the dropdown; a fixed primary keeps the documented "primary click = split vertical" contract deterministic.
**Rejected**: A single-row dropdown (horizontal only) — hides the complete option set; a last-used-tracking primary — the intake fixed the primary to vertical.
*Introduced by*: 260731-oiho-navbar-consolidation-menu-density

#### Menu grouping at registry-entry granularity
**Decision**: Registry entries carry `menuGroup: "view" | "window" | "app"`; `OverflowMenuRow` carries it; the menu partitions rows by group in fixed View → Window → App order (View = view-switcher, fixed-width, terminal-font, autofit; Window = open, split, close-pane/Kill; App = update-chip, refresh + the built-in version row).
**Why**: The partition preserves registry (pyramid) order within each group with zero re-sorting; the view-switcher rows keep leading the menu.
**Rejected**: Grouping inside the menu by hardcoded id lists — drifts when the registry changes.
*Introduced by*: 260731-oiho-navbar-consolidation-menu-density

## Tasks

### Phase 1: Setup

- [x] T001 Add shared button-size tokens to `app/frontend/src/components/top-bar-overflow-menu.tsx`: `TOP_BAR_BUTTON_BASE` (fixed `w-[28px] h-[28px] coarse:w-[30px] coarse:h-[30px]` square geometry), `TOP_BAR_BUTTON_REST` (border/text rest colors), composed `TOP_BAR_BUTTON` (with `rk-glint`), and `TOP_BAR_BUTTON_H` (height-only `h-[28px] coarse:h-[30px]` for content-width chips/segments), documented alongside `MENU_ROW_*` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Apply the shared token across every duplication site: in `top-bar.tsx` (HistoryNav `arrowClass`, sidebar toggle, split control, FixedWidthToggle, TerminalFontControl trigger, ClosePaneButton, RefreshButton, BoardAutofitToggle, UpdateChip heights, TerminalFontMenuRow `stepClass`, brand crumb `min-h`), in `top-bar-overflow-menu.tsx` (chevron trigger, version-row check-⟳), and normalize segment heights in `open-button.tsx` + `view-switcher.tsx` to `TOP_BAR_BUTTON_H` <!-- R1 -->
- [x] T003 Move `HistoryNav` from the anchored center box to the left cluster in `top-bar.tsx` (after the sidebar toggle; before the brand crumb on Host); delete the `mr-2.5` width-compensation hack + its comment; update the center-box/anchor comments <!-- R2 -->
- [x] T004 Merge `split-vertical`/`split-horizontal` registry entries into one `split` entry in `top-bar.tsx`: new `SplitControl` component (primary vertical segment + ▾ dropdown with both actions, `aria-haspopup`/`aria-expanded`, OpenButton pattern); `menuRender` emits both `SplitMenuRow`s; board mode parity via `focusedPane` <!-- R3 -->
- [x] T005 Set `menuOnly: true` on the `terminal-font`, `fixed-width`, and `close-pane` registry entries in `top-bar.tsx`; update the registry/fit/probe comments and the right-cluster end-state notes <!-- R4 -->
- [x] T006 Overflow-menu density restyle in `top-bar-overflow-menu.tsx`: `MENU_ROW_BASE` → `text-xs px-2.5 py-1.5`; match the update-surface row + version copy button + `TerminalFontMenuRow` wrapper; add `menuGroup` to registry entries + `group` to `OverflowMenuRow`; render View / Window / App uppercase section labels with the existing divider styling (no labels when only the version row renders) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Update `app/frontend/src/components/top-bar.test.tsx`: retarget FixedWidthToggle/TerminalFontControl/ClosePane in-bar assertions to menu rows (menuOnly contract), adapt split tests to the merged control (primary + ▾ dropdown), board Kill via menu row, keep host-mode/L3 assertions correct; run `just test-frontend` <!-- R6 -->
- [x] T008 Update `tests/e2e/top-bar-overflow.spec.ts` + `.spec.md`: new tier lists (L1 = split, L3 = refresh), menuOnly never-in-bar assertions for the three demoted controls, menu-contents + section-label assertions, density-scale row checks <!-- R6 -->
- [x] T009 Update `tests/e2e/window-heading.spec.ts` + `.spec.md`: history-arrows describe block reflects left-cluster placement (behavior assertions unchanged); verify the anchor test still holds with the arrows out of the center box <!-- R2 -->
- [x] T010 Replace the `Close pane` in-bar sync anchor with the split control's primary segment in `tests/e2e/top-bar-refresh.spec.ts` and `tests/e2e/open-in-app.spec.ts` + both `.spec.md`s <!-- R6 -->
- [x] T011 Update `tests/e2e/board-close-and-unpin.spec.ts` + `.spec.md`: reach the consequence-gated Kill via the chevron menu's Kill row (verb discipline preserved: row reads Kill, never Close pane) <!-- R4 -->
- [x] T012 Sweep `app/frontend/tests/e2e/` for remaining chrome assertions on moved/demoted elements; run the affected e2e suites via `just pw test top-bar-overflow top-bar-refresh open-in-app window-heading board-close-and-unpin board-autofit` and fix fallout; then `cd app/frontend && npx tsc --noEmit` <!-- R6 -->

### Phase 4: Polish

- [x] T013 Update `fab/project/context.md`'s top-bar control sizing note (24px fine → 28px fine, coarse 30px unchanged) and the split/✕ chrome descriptions to match the new end state <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Shared `TOP_BAR_BUTTON*` tokens exist in `top-bar-overflow-menu.tsx` and every listed top-bar control consumes them; no copy of the old `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]` icon-button string remains on a top-bar control
- [x] A-002 R2: HistoryNav renders in the left cluster on all four modes at `lg+` (before the brand crumb on Host; `hidden lg:flex` below — the q8ey no-overlap invariant binds); the `mr-2.5`/`-mr-1` width-compensation hack and its comment are gone from the center box
- [x] A-003 R3: One `split` registry entry renders the merged split control (primary = vertical, ▾ dropdown with both actions); the overflow menu carries both one-action split rows
- [x] A-004 R4: `terminal-font`, `fixed-width`, `close-pane` carry `menuOnly: true`; their rows always render in the chevron menu; `autofit` stays in-bar; terminal right-cluster end state is Open · Split(▾) · Refresh · chevron (+ UpdateChip when qualifying)
- [x] A-005 R5: `MENU_ROW_BASE` is `text-xs px-2.5 py-1.5`; update/version/font-stepper rows match; View / Window / App section labels group the rows

### Behavioral Correctness

- [x] A-006 R3: Primary split click fires a vertical split with the same args as before (terminal: currentWindow + worktreePath; board: focusedPane + cwd); board `executeSplit` keybindings unchanged
- [x] A-007 R4: The board Kill menu row routes through `onRequestKill` (confirm dialog with `Unpin instead`), never a direct closePane; the terminal Close pane row still closes the active pane
- [x] A-008 R1: All rendered top-bar boxes are equal-height (28px fine / 30px coarse); the sidebar toggle no longer renders smaller than the right cluster

### Removal Verification

- [x] A-009 R2: No `HistoryNav` render remains inside the anchored center box; the anchor e2e (left-edge stability) still passes without the compensation hack

### Scenario Coverage

- [x] A-010 R6: `top-bar-overflow.spec.ts` proves the menuOnly never-in-bar contract for the three demoted controls and the new pyramid (split first to yield) across the width sweep
- [x] A-011 R6: `board-close-and-unpin.spec.ts` drives Kill via the chevron menu and still proves the consequence-gated dialog + `Unpin instead`
- [x] A-012 R6: `top-bar-refresh.spec.ts` and `open-in-app.spec.ts` pass with the new currentWindow-gated anchor; `window-heading.spec.ts` history/anchor tests pass

### Edge Cases & Error Handling

- [x] A-013 R3: Empty board (no focusedPane): the split entry is hidden and the menu Kill row is disabled — matching the old per-button gating
- [x] A-014 R5: Server/host modes at wide width: the menu shows only the version row with no section labels; reduced-motion behavior unaffected

### Code Quality

- [x] A-015 Pattern consistency: New code follows the registry/menuOnly/OpenButton precedents and the decomposed-constant style (`MENU_ROW_*`)
- [x] A-016 No unnecessary duplication: shared constants replace the ~10 copy-pasted class strings; existing `SplitMenuRow`/palette actions reused
- [x] A-017 Tests included: unit + e2e coverage updated for every changed behavior; `.spec.md` companions updated in the same commit-unit
- [x] A-018 Type narrowing over assertions: no new `as` casts in the touched frontend code — verified; the sole `as` in the diff is `e.target as Node` in `SplitControl`'s outside-click handler (top-bar.tsx:1919), a verbatim copy of the `OpenButton` precedent (open-button.tsx:61) and the standard DOM `EventTarget`→`Node` narrowing, not a domain-type assertion

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

The `menuOnly` demotions made three in-bar components unreachable-but-intact. This is a deliberate Non-Goal of this change (the n2n4 precedent — revert = deleting one flag), so these are follow-up candidates for a LATER change that confirms the demotions stick, not omissions in this one:

- `TerminalFontControl` (`app/frontend/src/components/top-bar.tsx:2196-2310`) — the in-bar Aa popover is unreachable under `menuOnly`. It is the only remaining home of the **`Reset terminal font`** stepper button (the surviving `TerminalFontMenuRow` has −/+ only); reset stays reachable via the palette (`app.tsx:2096`, `board-page.tsx:657`) and the settings dialog (`settings-dialog.tsx:334`), so deleting the popover loses no coverage.
- `FixedWidthToggle` (`app/frontend/src/components/top-bar.tsx:2387-2430`) — unreachable in-bar toggle; `FixedWidthMenuRow` + the palette's `View: Fixed Width` cover it.
- `ClosePaneButton` (`app/frontend/src/components/top-bar.tsx:2036-2110`) — unreachable in-bar ✕/Kill chip; the `close-pane` menu row (with the board `onRequestKill` dialog path) plus the palette's `Pane: Close` cover it.
- `ViewSwitcher` pill (`app/frontend/src/components/view-switcher.tsx:95-130`) — pre-existing (`menuOnly` since 260722-n2n4), listed for completeness: this change re-pointed its segments at `TOP_BAR_SEGMENT_H`, so it is now a live consumer of a token no reachable UI renders.
- `RegistryEntry.barRender` for the four `menuOnly` entries (`top-bar.tsx:582`, `594`, `624-634`, `511`) — the call sites that keep the above components referenced; they go away with the components.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `TOP_BAR_BUTTON*` tokens hosted in `top-bar-overflow-menu.tsx` beside `MENU_ROW_*` | Same no-cycle host precedent; every consumer already imports it | S:70 R:90 A:85 D:75 |
| 2 | Confident | Split ▾ dropdown lists BOTH split actions; primary stays fixed vertical (not last-used) | OpenButton lists the complete target set; intake fixes primary = vertical | S:65 R:85 A:80 D:70 |
| 3 | Confident | Merged registry entry id is `split`; `menuRender` emits both one-action rows | Registry ids are internal identity; one entry ⇒ one id; menu rows stay one-action-per-row per intake | S:70 R:85 A:85 D:80 |
| 4 | Confident | Group assignment: View = {view-switcher, fixed-width, terminal-font, autofit}, Window = {open, split, close-pane/Kill}, App = {update, refresh, version row}; labels only for non-empty groups, none when the menu is version-row-only | Intake left row-to-group assignment to apply ("e.g."); partition preserves registry order | S:60 R:90 A:75 D:60 |
| 5 | Confident | E2E sync anchor swaps from the in-bar `Close pane` button to the split control's primary segment (both currentWindow-gated) | Close pane leaves the bar; the split primary is the surviving currentWindow-gated in-bar control | S:65 R:90 A:85 D:75 |
| 6 | Confident | Content-width chips normalize the height axis only, staying content-width: self-bordered chips (UpdateChip) use `TOP_BAR_BUTTON_H` (28px), segments inside a bordered wrapper (Open/Split/ViewSwitcher) use `TOP_BAR_SEGMENT_H` (26px — the wrapper border adds 2px, so chip totals equal the 28px squares exactly) | Fixed square width would break labeled chips; intake's "identical boxes" reads as equal TOTAL box heights | S:70 R:85 A:80 D:75 |
| 7 | Certain | No new palette entries: `Pane: Close`, `View: Fixed Width`, and the terminal-font trio already satisfy the coverage invariant; board keybindings untouched | Verified in app.tsx/board-page.tsx at apply; intake names the invariant, not new entries | S:85 R:90 A:90 D:85 |
| 8 | Confident | `fab/project/context.md`'s sizing note updates at apply (project config, not a hydrate-owned memory file) | Hydrate owns docs/memory only; leaving context.md stale would misdocument the shipped state | S:60 R:95 A:80 D:70 |
| 9 | Confident | The top-bar Aa popover (`TerminalFontControl` in top-bar.tsx) stays intact-but-unreachable; its popover-specific unit tests retarget to the menu stepper row | Exact n2n4 ViewSwitcher-pill precedent (revert = delete the flag); testing dead UI is noise | S:65 R:85 A:80 D:70 |
| 10 | Confident | History arrows are `hidden lg:flex` — visible only at `lg+` viewports | Measured at apply: below ~832px the rigid left cluster (toggle + arrows + nav `sm:min-w-[150px]` floor) overflows its `1fr` track against a 28ch long-name heading and paints over the centered prefix (the q8ey overlap class; e2e-verified at 700px). Joins the existing left-cluster degradation ladder (server crumb hides < `md`); palette `Go: Back/Forward` + browser gestures keep coverage | S:30 R:90 A:80 D:60 |
| 11 | Confident | The mobile leaf keeps the L3 Refresh in-bar at 375px — the pyramid ORDER, not an all-controls-overflow cliff, is the asserted contract | The consolidation lightened the cluster to 2 fit candidates; e2e measured Refresh surviving at 375px. The old all-gone-at-375 assertion was incidental to the heavy pre-oiho cluster | S:40 R:95 A:85 D:70 |

11 assumptions (1 certain, 10 confident, 0 tentative).
