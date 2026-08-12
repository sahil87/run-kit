# Plan: Relocate Footer Actions to Top Bar

**Change**: 260812-d1at-relocate-footer-actions-top-bar
**Intake**: `intake.md`

## Requirements

### Top Bar: Settings gear chip

#### R1: Gear chip in the right cluster, all modes
The top-bar right cluster SHALL carry a Settings chip on ALL four modes (terminal, board, server, host), composed from the standard `TOP_BAR_BUTTON` token (`rk-glint` + `TOP_BAR_BUTTON_BASE` + `TOP_BAR_BUTTON_REST`, 28×28 fine / 30×30 coarse) with the shared `GearIcon` and a `Tip` whose `kbd` slot carries the HOST-effective `settings-open` chord (`useKeybindings()` → `byAction.get("settings-open")` → `formatCombo`, omitted when unbound/disabled). The chip SHALL open the settings dialog via `useSettingsDialog().openSettings()` (no new event, no prop threading). In the registry order the gear SHALL sit immediately after Refresh (i.e. immediately before the exempt overflow chevron); the right-rail toggle (260812-nm4p) remains the outermost right element.

- **GIVEN** any top-bar mode (terminal / board / server / host)
- **WHEN** the bar renders with enough width for the gear to fit
- **THEN** an `Open settings` icon button appears between Refresh and the overflow chevron
- **AND** clicking it opens the settings dialog; its hover Tip shows "Settings" plus the host-effective chord keycap (no keycap when the binding is unbound/disabled); it carries no native `title`

#### R2: Gear participates in the width-fit/overflow ladder
The gear SHALL be an ordinary (non-`menuOnly`) registry fit candidate — the LAST candidate (L3 tail), so it survives longest in-bar and, when the cluster cannot fit it, degrades to a "Settings" row in the chevron menu's App section. The bar MUST NOT wrap, clip, or overflow horizontally at 375px or any wider width after the gear is added.

- **GIVEN** a terminal-route top bar at 375px viewport width
- **WHEN** the fit computation runs
- **THEN** the bar stays a single row with no horizontal page overflow, and any non-fitting candidates (including the gear) appear as chevron-menu rows instead
- **AND** at 1024px+ the gear renders in-bar

### Top Bar: Overflow-menu App-section rows

#### R3: Help · Keyboard shortcuts · Theme… rows
The chevron overflow menu's App section SHALL carry three new always-present rows (every mode), rendered above the fixed version row and reusing the shared `global-chrome.tsx` definitions (`HelpIcon`, `ThemeModeIcon`, `HELP_URL` — no drift with the palettes):

- **Help — run-kit docs**: an external-link row (`HELP_URL`, `target="_blank"`, `rel="noopener noreferrer"`, ↗ affordance, `HelpIcon`).
- **Keyboard shortcuts**: dispatches the `shortcuts-overlay:open` document CustomEvent (the retired footer button's exact mechanism); a trailing keycap shows the HOST-effective `shortcuts-overlay` chord when bound (omitted when unbound/disabled).
- **Theme…**: dispatches the `theme-selector:open` document CustomEvent (opens the theme selector); the trailing slot shows the current effective mode (`system` / `light` / `dark`).

- **GIVEN** the chevron menu opened on any top-bar mode
- **WHEN** the App section renders
- **THEN** it lists Help — run-kit docs, Keyboard shortcuts, and Theme… above the version row
- **AND** activating Keyboard shortcuts toggles the shortcuts overlay, activating Theme… opens the theme selector, and Help opens the docs URL in a new tab

#### R4: Theme click-cycling retired
The click-to-cycle theme behavior (system → light → dark → system) SHALL be removed with the footer button; the theme selector (via `theme-selector:open`, formerly the Ctrl/Cmd-click path) is the only chrome theme-switch surface. Palette theme entries are unchanged. `cycleTheme` in `global-chrome.tsx` loses its last consumer and SHALL be deleted.

- **GIVEN** the change is applied
- **WHEN** the codebase is searched for `cycleTheme`
- **THEN** no definition and no consumers remain

### Sidebar: Footer becomes a passive status row

#### R5: Footer actions removed, readouts kept
`SidebarFooter` (`app/frontend/src/components/sidebar/index.tsx`) SHALL render only the left readouts exactly as before (connection dot with `role="status"`/aria semantics, version click-to-copy with toast) plus a right-aligned status slot. The four action buttons (Help · Keyboard · Theme · Gear), the `FOOTER_ICON_CLASS` constant, the `onOpenSettings` prop, and all now-unused imports (`HelpIcon`, `ThemeModeIcon`, `KeyboardIcon`, `GearIcon`, `cycleTheme`, `HELP_URL`, `useSettingsDialog`, the theme hooks) SHALL be removed. `SelectionIndicator` stays at the sessions-list bottom (unchanged).

- **GIVEN** a mounted sidebar on any route
- **WHEN** the footer renders
- **THEN** it contains the connection dot and (once known) the version readout, and NO Help/Keyboard/Theme/Settings controls
- **AND** the footer contains no `FOOTER_ICON_CLASS` chips and the Sidebar component no longer consumes `useSettingsDialog`

#### R6: Quiet update-hint status slot
The footer's right-aligned, truncating, non-interactive status span SHALL show an `accent-green` update hint when `useUpdateNotification()` reports a qualifying update (`qualifies`): `v{latest} available` for a single run-kit update, `{N} updates available` for any other tool set. Otherwise the slot SHALL render nothing (no resting hint text). The span is a readout only — the overflow menu's version row REMAINS the update surface.

- **GIVEN** a sidebar whose session context reports a qualifying update (`v3.16.0` for run-kit)
- **WHEN** the footer renders
- **THEN** a non-interactive `v3.16.0 available` hint appears right-aligned in accent green
- **AND** when no update qualifies, no status content renders

### Tests

#### R7: Unit + e2e coverage moves with the chrome
Unit tests SHALL be updated: `sidebar/index.test.tsx` (footer = dot + version + update-hint slot; four actions gone) and `top-bar.test.tsx` (gear renders on all modes, opens settings, carries the chord Tip; App-section menu rows render and fire their link/events). E2E SHALL be updated with `.spec.md` companions in the same commit: `sidebar-footer.spec.ts` (actions gone, readouts intact), `top-bar-overflow.spec.ts` (gear in the pyramid, App rows, 375px budget), `mobile-layout.spec.ts` (theme reachability via the chevron menu), `settings-dialog.spec.ts` (gear trigger now in the top bar).

- **GIVEN** the implementation is complete
- **WHEN** `just test-frontend` and the touched e2e specs run (via `just pw test <name>`)
- **THEN** all pass, including the 375px single-row budget and 1024px+ desktop layout checks

### Non-Goals

- Command-palette entries, keybinding registry (`settings-open`, `shortcuts-overlay` chords), and backend/API — unchanged; relocation touches chrome only.
- Moving `SelectionIndicator` into the footer — it stays at the sessions-list bottom (260807-nf9f).
- Resting hint copy in the footer status slot (Constitution IV — quiet by default; more states can layer on later).
- Moving the shared icon definitions — `GearIcon`/`KeyboardIcon` stay in `sidebar/icons.tsx` and are imported by the top bar (the gear changes corners, not species).

### Design Decisions

#### Gear as the last registry fit candidate
**Decision**: The Settings gear is a regular registry entry placed AFTER Refresh (the L3 tail), not `menuOnly`.
**Why**: The intake requires a persistent one-click chip that participates in the existing fit/overflow ladder; the last candidate survives longest in-bar and degrades to a menu row for free (no new mechanism).
**Rejected**: `menuOnly` placement (violates "persistent chip"); a hardcoded bar slot outside the registry (breaks the single-source bar↔menu invariant, 260715-h1ck).
*Introduced by*: 260812-d1at-relocate-footer-actions-top-bar

#### App rows as menuOnly registry entries
**Decision**: Help / Keyboard shortcuts / Theme… are `menuOnly` registry entries with `menuGroup: "app"`, ordered after the settings entry.
**Why**: `menuOnly` rows always render in the menu; the registry's group partition places them in the App section above the fixed version row (which rides the App tail) with zero changes to the menu component.
**Rejected**: hardcoding the three rows inside `TopBarOverflowMenu` (forks the single ordered source; rows could drift from registry ordering).
*Introduced by*: 260812-d1at-relocate-footer-actions-top-bar

### Deprecated Requirements

#### Sidebar-footer action cluster (Help · Keyboard · Theme · Gear)
**Reason**: The footer row is reserved for version + status/hints; the actions relocate to the top bar (gear chip) and the overflow menu's App section.
**Migration**: Settings → top-bar gear chip (R1); Help/Keyboard/Theme → App-section menu rows (R3); palette entries unchanged.

#### Footer theme click-to-cycle
**Reason**: Cycle-on-click does not map to a menu row; the selector is the clearer interaction.
**Migration**: The Theme… menu row dispatches `theme-selector:open` (the former Ctrl/Cmd-click behavior becomes the only behavior).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add exported `HelpMenuRow`, `KeyboardMenuRow`, `ThemeMenuRow` App-section rows to `app/frontend/src/components/top-bar-overflow-menu.tsx` (shared `global-chrome.tsx` icons/URL; keyboard chord via `useKeybindings()` + `formatCombo`; theme effective mode via `useTheme()`) <!-- R3 -->
- [x] T002 Add `SettingsGearButton` + `SettingsMenuRow` to `app/frontend/src/components/top-bar.tsx` and extend the right-cluster registry: `settings` fit candidate after `refresh` (all four modes, App group) plus `menuOnly` `help` / `keyboard` / `theme` entries; update stale comments (L3 tier, right-cluster) <!-- R1, R2, R3 -->
- [x] T003 Rewrite `SidebarFooter` in `app/frontend/src/components/sidebar/index.tsx`: remove the four action buttons + `FOOTER_ICON_CLASS` + `onOpenSettings` prop (+ its `useSettingsDialog` seam in `Sidebar`), keep dot + version, add the right-aligned truncating update-hint status span <!-- R5, R6 -->
- [x] T004 Remove the now-consumerless `cycleTheme` from `app/frontend/src/components/global-chrome.tsx` <!-- R4 -->

### Phase 2: Tests

- [x] T005 Update `app/frontend/src/components/sidebar/index.test.tsx` footer describe: actions gone, dot/version intact, update-hint renders/omits per `updateAvailable` <!-- R5, R6, R7 -->
- [x] T006 Update `app/frontend/src/components/top-bar.test.tsx`: wrap `renderTopBar` in `SettingsDialogProvider`; gear on all modes + opens settings + chord Tip; App menu rows render/fire; fix the L3-pyramid and "theme/help gone" assertions <!-- R1, R2, R3, R7 -->
- [x] T007 Update `app/frontend/tests/e2e/sidebar-footer.spec.ts` + `.spec.md` (same commit): footer readouts intact, four actions gone <!-- R5, R7 -->
- [x] T008 Update `app/frontend/tests/e2e/top-bar-overflow.spec.ts` + `.spec.md` (same commit): gear in the L3 pyramid, App-section rows present, 375px single-row budget, menu contents assertions <!-- R2, R3, R7 -->
- [x] T009 Update `app/frontend/tests/e2e/mobile-layout.spec.ts` + `.spec.md` and `app/frontend/tests/e2e/settings-dialog.spec.ts` + `.spec.md` (same commit): theme reachable via the chevron-menu Theme… row (not the footer); the settings gear trigger now lives in the top bar <!-- R3, R4, R7 -->

### Phase 3: Verification

- [x] T010 Run `just test-frontend` and the touched e2e specs via `just pw test …` (port 3020 isolation); verify 375px and 1024px+ top-bar budgets; fix any failures <!-- R2, R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: A Settings gear chip renders in the top-bar right cluster on all four modes, immediately before the chevron, opens the settings dialog, and its Tip carries the host-effective `settings-open` chord (omitted when unbound)
- [x] A-002 R2: The gear is a registry fit candidate (last/L3 tail); at 375px the bar stays single-row with no horizontal overflow; at 1024px+ the gear renders in-bar
- [x] A-003 R3: The chevron menu's App section lists Help — run-kit docs (external link, safe attrs), Keyboard shortcuts (dispatches `shortcuts-overlay:open`, chord keycap when bound), and Theme… (dispatches `theme-selector:open`, shows the effective mode) above the version row on every mode
- [x] A-004 R4: `cycleTheme` and the footer theme-cycle behavior are gone; the theme selector is the only chrome theme surface
- [x] A-005 R5: `SidebarFooter` renders only dot + version + status slot; the four action buttons, `FOOTER_ICON_CLASS`, the `onOpenSettings` prop, and the footer's unused imports are removed
- [x] A-006 R6: The footer status span shows an accent-green `v{latest} available` (single run-kit) / `{N} updates available` (other) hint only while an update qualifies; otherwise it renders nothing and stays non-interactive

### Behavioral Correctness

- [x] A-007 R1: Clicking the top-bar gear on terminal, server, board, and host modes opens the same single AppLayout-mounted settings dialog
- [x] A-008 R3: The Keyboard row's kbd slot reflects the host-effective (platform + user overrides) `shortcuts-overlay` chord and vanishes when unbound — same derivation the footer used

### Removal Verification

- [x] A-009 R4: No `cycleTheme` references remain anywhere in `app/frontend/`
- [x] A-010 R5: No `FOOTER_ICON_CLASS` references remain; the sidebar renders no Help/Keyboard/Theme/Settings controls

### Scenario Coverage

- [x] A-011 R2: `top-bar-overflow.spec.ts` proves the gear in the L3 pyramid (drops last, menu-row fallback) and a single-row, non-overlapping bar across the 1280→375 width sweep
- [x] A-012 R7: Unit tests cover the gear (all modes, dialog trigger, chord Tip) and the footer status slot (hint shown/omitted)

### Edge Cases & Error Handling

- [x] A-013 R6: A null/unknown daemon version or absent update payload renders no status-slot artifacts (no `vundefined`, no empty styled remnants)
- [x] A-014 R3: The Help row never unloads the live dashboard (external `target="_blank"` anchor, never a button-driven navigation)

### Code Quality

- [x] A-015 Pattern consistency: new chips/rows reuse `TOP_BAR_BUTTON`, `MENU_ROW_CLASS`, `GearIcon`/`HelpIcon`/`ThemeModeIcon`, and the `useKeybindings()`+`formatCombo` chord derivation — no re-implemented variants
- [x] A-016 No unnecessary duplication: `global-chrome.tsx` remains the single definition source for `HELP_URL`/`HelpIcon`/`ThemeModeIcon`; no magic strings without named constants
- [x] A-017 Test integrity: every modified `.spec.ts` ships its `.spec.md` companion update in the same commit (constitution); unit tests assert the implementation spec, not fixtures
- [x] A-018 Keyboard-first: all four relocated actions remain palette-reachable via their existing entries (no palette changes); the new menu rows are arrow-navigable like existing rows

## Deletion Candidates

- None outstanding — the change's planned removals (`cycleTheme` in `global-chrome.tsx`, `FOOTER_ICON_CLASS` + the four-action cluster in `sidebar/index.tsx`) were fully executed during apply (verified: zero code references remain), and review found no additional code this change makes redundant or unused.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Gear chip + settings menu row use the shared `GearIcon` imported from `sidebar/icons.tsx` (no icon move) | Intake names `GearIcon` verbatim and says "the gear changes corners, not species"; moving the icon file is out of the intake's impact list | S:85 R:85 A:85 D:80 |
| 2 | Confident | App rows are `menuOnly` registry entries (not hardcoded in the menu component) | The registry is the documented single ordered source; `menuOnly` gives always-in-menu + App-section placement above the version row with zero menu-component changes | S:70 R:85 A:85 D:75 |
| 3 | Confident | Update-hint text: `v{latest} available` (single run-kit) / `{N} updates available` (other tool sets), gated on `qualifies` | Intake gives the `v3.16.0 available` example and "reports an update is available"; `qualifies` is the hook's is-available verdict; the multi-tool form mirrors the chip's count wording | S:65 R:90 A:80 D:70 |
| 4 | Confident | The settings entry's menu fallback row is labeled "Settings" and rides the standard registry overflow (not literally `menuOnly`) | Intake: the gear "degrades to an overflow-menu row (`menuOnly`-style fallback)" — i.e. menu-row-shaped, via the existing ladder | S:70 R:90 A:85 D:75 |
| 5 | Confident | `settings-dialog.spec.ts` gear test retargeted to the top-bar gear (same accessible name), not deleted | The gear still opens the dialog; only its surface moved — the trigger contract the spec proves is unchanged | S:75 R:85 A:85 D:75 |

5 assumptions (1 certain, 4 confident, 0 tentative).
