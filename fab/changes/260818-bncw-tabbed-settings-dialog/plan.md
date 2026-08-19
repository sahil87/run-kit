# Plan: Tabbed Settings Dialog

**Change**: 260818-bncw-tabbed-settings-dialog
**Intake**: `intake.md`

## Requirements

### UI: Tabbed Settings Dialog Structure

#### R1: Three topic-organized tabs with scope groups retained
`SettingsDialog` (`app/frontend/src/components/settings-dialog.tsx`) SHALL render exactly three tabs — **General** (instance display name, SSH host, notifications), **Appearance** (theme mode + preferred dark/light theme selects, instance accent color, terminal font size), **Shortcuts** (the ported shortcuts body, R6). Every control MUST be the existing control component moved, never rebuilt (`TextSetting`, `NotificationsControl`, `ThemePairControl`, `AccentColorControl`, `TerminalFontControl` — the second-surface rule). The `ScopeHeading` persistence-scope groups (**This host** / **This device**, uppercase name left + storage hint right on the same baseline) MUST survive inside each of General and Appearance (both mix scopes: General = name+SSH host / notifications; Appearance = theme+accent / terminal font). `PreferenceRow` stays the row primitive, unchanged.

- **GIVEN** the settings dialog is open **WHEN** the user selects the Appearance tab **THEN** the theme mode control, theme-pair selects, and accent control render under a "This host" ScopeHeading, and the terminal-font stepper renders under a "This device" ScopeHeading
- **GIVEN** any tab is active **WHEN** its controls are used **THEN** they drive the same hooks/models as today (`useInstanceName`, `getSSHHost`/`setSSHHost`, `usePushSubscription`, `useTheme`/`useThemeActions`, `useInstanceAccent`, `ChromeContext.terminalFontSize`) with no behavioral change

#### R2: Dialog shell gains an `xl` fixed-height variant
`components/dialog.tsx` SHALL gain a third `size` value `"xl"`: width `max-w-4xl`, and a **fixed panel height** (bounded by the existing `calc(100vh-2rem)` outer cap, e.g. `h-[min(40rem,calc(100vh-2rem))]`) with panel-level `overflow-hidden` so the tab rail never jumps between short and tall tabs — each tab panel owns its own `overflow-y-auto` internal scroll. The existing `sm`/`lg` variants MUST be byte-identical in behavior (including their panel scroll path).

- **GIVEN** `size="xl"` **WHEN** the dialog renders **THEN** the panel carries the `max-w-4xl` width and fixed-height classes and does not itself scroll
- **GIVEN** `size="sm"` or `size="lg"` (or no size) **WHEN** any existing dialog renders **THEN** classes and scroll behavior are unchanged from today

#### R3: Left nav rail on desktop, horizontal tab strip under 480px
The tab list SHALL be ONE `role="tablist"` markup: at `min-[480px]:` and up a vertical left rail inside the dialog body (accent-tinted active tab state, per the accepted mock direction); below 480px the same element restyles into a horizontal scrollable strip under the dialog title. No second code path, no drill-down navigation. Rows keep the existing 480px label-over-control collapse.

- **GIVEN** a ≥480px viewport **WHEN** the dialog opens **THEN** the tabs render as a vertical left rail beside the active panel
- **GIVEN** a 375px viewport **WHEN** the dialog opens **THEN** the same tablist renders as a horizontal strip under the title, all three tabs reachable, no horizontal page overflow

#### R4: Roving tablist keyboard navigation
The tablist SHALL implement roving-tabindex arrow-key navigation (`role="tab"`, `aria-selected`, one tab stop for the list; ArrowUp/ArrowDown on the vertical rail and ArrowLeft/ArrowRight on the strip — accepting both axes on both layouts is acceptable). Selecting a tab moves the active panel; Tab leaves the tablist into the panel.

- **GIVEN** focus on the active tab **WHEN** ArrowDown/ArrowRight is pressed **THEN** the next tab receives focus and (on Enter/Space or immediately — follow the simpler activate-on-focus if consistent) its panel activates
- **GIVEN** the dialog is open **WHEN** Escape is pressed (outside an armed rebind capture, R6) **THEN** the dialog closes via the existing focus-trap seam

### UI: Deep Links & Entry Points

#### R5: `openSettings(tab?)` with per-binding chord semantics
`SettingsDialogContext` (`contexts/settings-dialog-context.tsx`) SHALL gain a `SettingsTab = "general" | "appearance" | "shortcuts"` union, `activeTab` state, `setActiveTab`, and `openSettings(tab?: SettingsTab)`. Semantics: a call WITH `tab` opens (if closed) and activates that tab; a tab-less call opens on **General** when closed and is a tab-preserving no-op when already open (no last-tab persistence across closes — reopening tab-less always lands General). Chord/palette bodies:

- `settings-open` (`Settings: Open` global entry) stays a **pure opener** calling tab-less `openSettings()` — re-fire while open never closes and never yanks the tab.
- `shortcuts-overlay` (`Help: Keyboard Shortcuts` global entry, id unchanged) becomes a **toggle into the Shortcuts tab**: closed → `openSettings("shortcuts")`; open on Shortcuts → `closeSettings()`; open on another tab → `openSettings("shortcuts")` (switch, don't close).

Both route shells (`keybindingHandlers` in `app.tsx`, `boardKeyHandlers` in `board-page.tsx`) already resolve these two ids from the layout global list, so swapping the entry bodies in `use-global-palette-actions.ts` re-routes both chords with no dispatcher changes — verify, don't rewire.

- **GIVEN** the dialog is closed **WHEN** the `shortcuts-overlay` chord fires **THEN** the dialog opens on the Shortcuts tab
- **GIVEN** the dialog is open on Shortcuts **WHEN** the `shortcuts-overlay` chord fires **THEN** the dialog closes
- **GIVEN** the dialog is open on Appearance **WHEN** the `shortcuts-overlay` chord fires **THEN** the active tab switches to Shortcuts and the dialog stays open
- **GIVEN** the dialog is open on Shortcuts **WHEN** the `settings-open` chord fires **THEN** nothing changes (no close, no tab reset)
- **GIVEN** any route including `/board/$name` **WHEN** either chord fires **THEN** the same behavior applies (layout-level mount + global-entry resolution)

#### R6: Shortcuts body ported intact; standalone shell retired
The `shortcuts-overlay.tsx` standalone shell — its `fixed inset-0` backdrop, own focus trap, and the `LayoutShortcutsOverlay` mount + open state in `app.tsx` — SHALL be retired. Its **body** becomes the Shortcuts tab panel, functionally intact — nothing dropped: sticky jump-nav chips with live filter counts, the single filter input, the foldable keycap map + "Holding" modifier picker, the platform display toggle, the header chord hint, grouped GLOBAL/TERMINAL/BOARD rows with click-to-rebind capture (steal/claimed warnings, per-row reset, `unbound`/`browser` badges), the shell-owned locked subgroup, the `[ CUSTOM ]` macro section + inline add flow, the read-only `[ TMUX ]` section, and the reset-all footer. Constraints:

- The capture-phase rebind listener MUST keep working inside the settings dialog's focus trap, and an armed capture's Escape MUST cancel the capture without closing the dialog.
- The per-open data plumbing moves with the panel keeping its gating semantics: `riffPresetNames` best-effort fetch and `paletteTargets` gating only while the dialog is open on the Shortcuts tab on a route with a server + session; the tmux keybindings fetch (scoped to `useSessionContext().currentServer`) only while the Shortcuts panel is visible, cancel-flagged on close/server change.
- All three entry points re-route to the Shortcuts tab: the chord + palette entry (R5) and the top-bar chevron menu's "Keyboard shortcuts" row — today via the `shortcuts-overlay:open` CustomEvent listeners at `app.tsx:314` and `board-page.tsx:351`; prefer retiring the CustomEvent seam in favor of a direct `useSettingsDialog().openSettings("shortcuts")` call at the menu-row site (it renders under `AppLayout`, so the context is reachable), else re-route both listeners.
- The panel gets a stable testid (e.g. `data-testid="settings-shortcuts-panel"`); e2e re-anchoring is R8's job.

- **GIVEN** the Shortcuts tab is active **WHEN** the user clicks a row's combo button and presses a chord **THEN** capture applies with the same steal/claimed-warning behavior as today, and the dialog stays open
- **GIVEN** the Shortcuts tab is active on a session route **WHEN** the add flow is used **THEN** riff presets + palette targets are offered exactly as today; on board/host routes the CUSTOM rows stay read/rebind/delete-only
- **GIVEN** any route **WHEN** searching the DOM **THEN** no `fixed inset-0` standalone shortcuts shell exists and `LayoutShortcutsOverlay` is gone from `app.tsx`

#### R7: Per-tab palette action
`use-global-palette-actions.ts` SHALL add a `Settings: Appearance` layout-global entry (id `settings-appearance`) calling `openSettings("appearance")`. `Settings: Open` (id `settings-open`) and `Help: Keyboard Shortcuts` (id `shortcuts-overlay`) keep their ids and labels — the registry actionIds MUST NOT be renamed (stored per-device override diffs in `localStorage["runkit-keybindings"]` key on them). `withShortcutHints` decoration continues to join by id.

- **GIVEN** the palette is open on any route **WHEN** the user types "appearance" **THEN** `Settings: Appearance` appears and opens the dialog on the Appearance tab
- **GIVEN** stored keybinding overrides for `settings-open`/`shortcuts-overlay` **WHEN** this change ships **THEN** the overrides still apply

### Tests

#### R8: Test port + new coverage, `.spec.md` companions in the same commit
Unit: `dialog.test.tsx` gains `xl` assertions (and keeps `sm`/`lg` ones); `settings-dialog.test.tsx` re-anchored to the tabbed structure; the shortcuts panel's test file re-anchored to the panel mount — the **ArrowDown "closes and releases key handling" assertion family MUST be carried forward** (adapted to the new close semantics), never silently dropped (known CI-flake area — flake is rerun territory, not deletion territory); `settings-dialog-context` and `use-global-palette-actions` tests updated. E2E: `shortcut-registry.spec.ts`, `macro-riff-bindings.spec.ts`, `top-bar-overflow.spec.ts` re-anchored (open/close choreography, `data-testid`, palette entry flows) **with their `.spec.md` companions updated in the same commit** (Constitution Test Companion Docs). New coverage: tab switching (pointer + arrow keys), both chord deep-links (incl. the three-state toggle), the 375px mobile tab strip, and the `Settings: Appearance` palette action.

- **GIVEN** the full suite (`just test`) **WHEN** run after the change **THEN** it passes with the ported assertions present

### Non-Goals

- Drill-down mobile navigation — explicitly rejected at ≤3 tabs; revisit past ~5–6 tabs
- Last-visited-tab persistence — tab-less open always lands General
- Any change to the top-bar `ThemeSelector` modal (stays the live-preview surface) or to backend/API surface
- Renaming registry actionIds or adding new chords
- New settings/controls — this change moves existing ones

### Design Decisions

#### Tab state lives in SettingsDialogContext
**Decision**: `activeTab` + `openSettings(tab?)` live in `SettingsDialogContext`, not in dialog-local state.
**Why**: The deep-link writers (global palette entry bodies, the chevron menu row) live outside the dialog body; context state lets them target a tab without prop drilling or a CustomEvent side channel, and the context is already the dialog's open/close seam.
**Rejected**: dialog-local tab state + a CustomEvent carrying the tab (a second event seam exactly when the change retires one); a router search param (Constitution IV — settings are not a route).
*Introduced by*: 260818-bncw-tabbed-settings-dialog

#### Chord semantics stay per-binding: toggle for shortcuts, pure opener for settings-open
**Decision**: `shortcuts-overlay` keeps its documented TOGGLE behavior, refined for tabs (closed→open on Shortcuts; open-on-Shortcuts→close; open-elsewhere→switch to Shortcuts). `settings-open` stays a pure opener (re-fire = no-op, never closes, never yanks the tab).
**Why**: Each binding preserves its established semantics (`260801-mqim` fixed settings-open as open-only per the macOS ⌘, convention; the overlay chord has always toggled) — muscle memory survives the consolidation. Switch-not-close on the third state: a user pressing "show me shortcuts" while looking at Appearance wants shortcuts, not a closed dialog.
**Rejected**: making both toggles (contradicts the settings-open decision); close-on-any-tab for the shortcuts chord (punishes the switch intent).
*Introduced by*: 260818-bncw-tabbed-settings-dialog

#### `Help: Keyboard Shortcuts` remains the Shortcuts entry; only `Settings: Appearance` is added
**Decision**: No duplicate `Settings: Shortcuts` palette entry — the existing `Help: Keyboard Shortcuts` (id `shortcuts-overlay`) IS the per-tab Shortcuts action; the one new entry is `Settings: Appearance`.
**Why**: One action per intent — a second entry with a different label targeting the same panel is palette drift, and the existing id carries the chord hint join + stored user overrides.
**Rejected**: adding `Settings: Shortcuts` alongside (duplicate); renaming the Help entry (breaks the id/label contract and e2e anchors for zero user gain).
*Introduced by*: 260818-bncw-tabbed-settings-dialog

## Tasks

### Phase 1: Shell primitives

- [x] T001 Add `size: "xl"` to `app/frontend/src/components/dialog.tsx` (`max-w-4xl`, fixed height `h-[min(40rem,calc(100vh-2rem))]`, panel `overflow-hidden`; `sm`/`lg` untouched) and extend `dialog.test.tsx` with the xl width/height/overflow assertions while keeping the existing variant assertions <!-- R2 -->
- [x] T002 [P] Extend `app/frontend/src/contexts/settings-dialog-context.tsx`: `SettingsTab` union, `activeTab`, `setActiveTab`, `openSettings(tab?)` with tab-less-lands-General-when-closed / tab-preserving-no-op-when-open semantics; update its unit tests <!-- R5 -->

### Phase 2: Core implementation

- [x] T003 Restructure `app/frontend/src/components/settings-dialog.tsx` into the tabbed shell on `Dialog size="xl"`: one `role="tablist"` markup (vertical left rail ≥480px, horizontal strip <480px via `min-[480px]:` classes), roving-tabindex arrow-key nav, accent-tinted active state, per-tab panels with internal `overflow-y-auto`; General + Appearance panels reuse the existing control components under retained `ScopeHeading` groups <!-- R1 -->
- [x] T004 Port the shortcuts body out of `app/frontend/src/components/shortcuts-overlay.tsx` into a panel component (new file `components/settings-shortcuts-panel.tsx` or in-place refactor — keep the body functionally intact per R6), retire the standalone shell (backdrop, own focus trap, `data-testid="shortcuts-overlay"` shell), mount it as the Shortcuts tab panel with `data-testid="settings-shortcuts-panel"`, and move the per-open data plumbing (riff-presets fetch, `paletteTargets` gating, tmux keybindings fetch) to the dialog/panel seam with today's gating; ensure armed-capture Escape cancels capture without closing the dialog <!-- R6 -->
- [x] T005 Re-route entry points: swap the `Help: Keyboard Shortcuts` entry body in `app/frontend/src/hooks/use-global-palette-actions.ts` to the R5 toggle over `useSettingsDialog()`, keep `Settings: Open` tab-less, add `Settings: Appearance` (id `settings-appearance`); remove `LayoutShortcutsOverlay` + its open state from `app/frontend/src/app.tsx`; re-route the chevron "Keyboard shortcuts" row to `openSettings("shortcuts")` directly and retire the `shortcuts-overlay:open` CustomEvent listeners (`app.tsx:314`, `board-page.tsx:351`) — or re-route the listeners if the row cannot reach the context <!-- R5 -->

### Phase 3: Integration & edge cases

- [x] T006 Verify both route shells' chord flows post-swap (`keybindingHandlers` in `app.tsx`, `boardKeyHandlers` in `board-page.tsx` — both resolve the swapped global-entry bodies; no dispatcher rewiring expected), including the three-state toggle on the board route and `settings-open` no-op-while-open <!-- R5 -->
- [x] T007 Re-anchor unit tests: shortcuts panel tests (carry the ArrowDown close/release assertion family forward, adapted to dialog-hosted close), `settings-dialog.test.tsx` (tab structure, scope headings per tab), `use-global-palette-actions` test (new entry, swapped bodies) <!-- R8 -->
- [x] T008 Re-anchor e2e: `shortcut-registry.spec.ts`, `macro-riff-bindings.spec.ts`, `top-bar-overflow.spec.ts` — open/close choreography, testids, palette flows — updating each sibling `.spec.md` in the same commit <!-- R8 -->
- [x] T009 New coverage: tab switching (pointer + arrow keys), chord deep-links incl. toggle states, 375px mobile tab strip (all three tabs reachable, no horizontal page overflow), `Settings: Appearance` palette action — extend the re-anchored specs or add a focused spec + `.spec.md` <!-- R8 -->

### Phase 4: Polish

- [x] T010 Run the verification gates in order: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`; visually verify 375px and ≥1024px dialog layouts via Playwright against the accepted mock direction <!-- R8 -->

## Execution Order

- T001 and T002 are independent [P]
- T003 depends on T001+T002; T004 depends on T003; T005 depends on T002+T004
- T006–T009 depend on T005; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Three tabs render with the exact control mapping; General and Appearance keep This host / This device `ScopeHeading` groups; all controls are the existing components driving the existing hooks — verified in `settings-dialog.tsx` (`SETTINGS_TABS`, `GeneralPanel`, `AppearancePanel`) + `settings-dialog.test.tsx` (23 tests pass)
- [x] A-002 R2: `Dialog` supports `size="xl"` (max-w-4xl, fixed height, panel overflow-hidden) with `sm`/`lg` behavior unchanged and asserted — `dialog.tsx:29-32`; `dialog.test.tsx` keeps sm/lg assertions and adds the xl width/height/overflow test (11 tests pass)
- [x] A-003 R3: ≥480px shows the left rail; <480px shows the horizontal strip; one tablist markup, one breakpoint — one `role="tablist"` with `min-[480px]:` classes (`settings-dialog.tsx:458-491`); e2e 375px strip test passes (`settings-dialog.spec.ts:167`)
- [x] A-004 R4: Roving-tabindex arrow-key navigation works across the tablist — roving tabindex + both-axis arrows, activate-on-focus (`settings-dialog.tsx:443-456`); unit + e2e (`shortcut-registry.spec.ts:277`) pass
- [x] A-005 R5: `openSettings(tab?)` semantics hold (tab-less lands General when closed, no-op when open); `settings-open` is a pure opener; `shortcuts-overlay` toggles per the three-state rule on both route shells — `settings-dialog-context.tsx:34-42`, `use-global-palette-actions.ts:140-152`; both shells resolve via `fromPalette`/global entry (`app.tsx:3317,3333`, `board-page.tsx:340,346`); context + palette unit tests and both-shell e2e pass
- [x] A-006 R6: Standalone overlay shell + `LayoutShortcutsOverlay` are gone; the Shortcuts panel is functionally intact (jump-nav, filter+counts, foldable map+picker, platform toggle, rebind capture with steal/claimed warnings, locked subgroup, CUSTOM+add flow, TMUX section, reset-all); armed-capture Escape does not close the dialog — `shortcuts-overlay.tsx` deleted, panel at `settings-shortcuts-panel.tsx` with all sections present; capture-phase listener `stopPropagation`s before the bubble-phase focus trap (`settings-shortcuts-panel.tsx:319-356`); 32 panel tests + dialog-level armed-capture-Escape test pass
- [x] A-007 R6: Data plumbing gating preserved (riff presets/paletteTargets only on session routes with the panel visible; tmux fetch cancel-flagged); chevron menu row reaches the Shortcuts tab — `settings-dialog.tsx:642-704` (mount-gated fetch, cancel flag), `settings-shortcuts-panel.tsx:296-313`; chevron row calls `openSettings("shortcuts")` directly (`top-bar-overflow-menu.tsx:185`)
- [x] A-008 R7: `Settings: Appearance` exists layout-globally; ids `settings-open`/`shortcuts-overlay` unrenamed; hints still join — `use-global-palette-actions.ts:160-166`; `withShortcutHints` join by id unchanged; unit + e2e (`shortcut-registry.spec.ts:296`) pass

### Behavioral Correctness

- [x] A-009 R5: Re-firing `settings-open` while open on Shortcuts neither closes nor switches tabs; the shortcuts chord open-on-other-tab switches without closing — unit (`use-global-palette-actions.test.tsx:118-151`) + e2e (`shortcut-registry.spec.ts:249`) cover all three toggle states and the no-op re-fire

### Removal Verification

- [x] A-010 R6: No `fixed inset-0` shortcuts shell, no `shortcuts-overlay:open` dead listeners (seam retired or fully re-routed), no orphaned overlay-only code left behind — grep over `app/frontend/src` shows only comment/test references to the retired seam; no import of the deleted module remains

### Scenario Coverage

- [x] A-011 R8: The ArrowDown close/release assertion family is present in the re-anchored panel tests; new tab/deep-link/mobile-strip/palette coverage exists and passes — per plan assumption 8 the ArrowDown family lives in `shell-titlebar-strip.test.tsx` (untouched, 50 tests pass); the ported overlay families live in `settings-shortcuts-panel.test.tsx`; new coverage in `settings-dialog.test.tsx` + `shortcut-registry.spec.ts`/`settings-dialog.spec.ts`; scoped e2e all green (settings-dialog 6, shortcut-registry 23, macro-riff-bindings 3, top-bar-overflow 11)

### Edge Cases & Error Handling

- [x] A-012 R6: Shortcuts panel on board/host routes: add flow gated off, TMUX section shows the "No tmux server running" empty state, no crash/spinner deadlock — `paletteTargets == null` gates the add flow; unit tests (`settings-shortcuts-panel.test.tsx:314,320,530`) + board-route e2e (`settings-dialog.spec.ts:220`) pass

### Code Quality

- [x] A-013 Pattern consistency: tabbed shell follows existing dialog/section idioms (ScopeHeading, PreferenceRow, accent states, `Tip`-not-`title`); comments state constraints only — icon-only controls use `Tip`; `title=` attributes in the panel are verbatim ports from the overlay; comments state constraints
- [x] A-014 No unnecessary duplication: control components and the tablist markup are single-sourced; no rebuilt controls, no second mobile code path — all controls reused; one tablist markup; panel plumbing replaces (not duplicates) the deleted `LayoutShortcutsOverlay`
- [x] A-015 Type narrowing over assertions: `SettingsTab` is a closed union; no `as` casts introduced — the two `as` casts in the new code (`settings-dialog.tsx:650`, `settings-shortcuts-panel.tsx:836`) are verbatim ports of pre-existing casts, not introduced
- [x] A-016 Tests cover added/changed behavior per code-quality.md (unit + Playwright e2e for the UI change) — 251 unit tests across the 7 touched files pass; 43 scoped e2e pass; `go test ./...` and `npx tsc --noEmit` green
- [x] A-017 `.spec.md` companions updated in the same commit as their `.spec.ts` changes — all four touched specs carry sibling `.spec.md` updates in the same working-tree change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- The accepted visual mock is session-local (`settings-tabs-mock.html`, not in repo); intake § Visual direction is the authoritative transcription
- Known CI-flake context: the ArrowDown close/release family flakes on clean main — rerun, don't bisect; and "Maximum update depth exceeded" e2e console errors pre-exist on main

## Deletion Candidates

- `app/frontend/src/components/dialog.tsx:29-32` — the `size="lg"` variant (`max-w-2xl`) now has zero non-test consumers: memory records the settings dialog as its only consumer, and the dialog moved to `xl`. R2 required keeping `sm`/`lg` byte-identical, so this is surfaced for the human reviewer, not acted on.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shortcuts-chord third state = switch-to-Shortcuts (not close) when open on another tab | Intake pins toggle behavior for the two-state cases; switch honors the "show me shortcuts" intent; trivially revisable | S:50 R:85 A:75 D:65 |
| 2 | Confident | Per-tab palette additions = `Settings: Appearance` only; `Help: Keyboard Shortcuts` stays the Shortcuts entry unrenamed | Intake lists entries as "e.g."; one-action-per-intent avoids palette drift; ids carry overrides + hints | S:55 R:90 A:75 D:60 |
| 3 | Confident | `activeTab` lives in `SettingsDialogContext` | Deep-link writers live outside the dialog; the context is already the open/close seam | S:60 R:80 A:85 D:75 |
| 4 | Confident | `xl` variant implies the fixed height + panel `overflow-hidden` (per-tab internal scroll), not a separate height prop | One consumer; a second orthogonal prop is speculative surface | S:65 R:90 A:80 D:70 |
| 5 | Confident | The `shortcuts-overlay:open` CustomEvent seam is retired in favor of a direct context call from the chevron row (fallback: re-route the listeners) | The row renders under `AppLayout` where the context is reachable; the event existed to reach app-local overlay state that no longer exists | S:55 R:85 A:80 D:65 |
| 6 | Confident | Panel testid becomes `settings-shortcuts-panel`; e2e re-anchors to it plus the dialog's accessible name | The shell testid names a retired shell; re-anchoring is already an intake cost | S:50 R:90 A:80 D:70 |
| 7 | Confident | The Shortcuts panel mounts only while its tab is active (mount == visible); the old `open`-gated transient-reset effect is replaced by unmount, and the documented session-scoped view prefs (map fold, modifier layer, platform display toggle) are hoisted to module scope (`viewPrefs` + a `resetShortcutsPanelViewPrefs()` test seam) so they survive dialog close | R6 gates all data plumbing on "panel visible"; unmount is the simplest exact gate, but the old never-unmounted overlay kept those three reading preferences across closes — hoisting preserves the documented behavior without a persistent mount | S:55 R:80 A:75 D:70 |
| 8 | Certain | The ArrowDown "closes and releases key handling" assertion family lives in `shell-titlebar-strip.test.tsx` (the shell server-switcher menu), NOT in the overlay tests — carried forward untouched; the overlay-side assertions (armed-capture Escape cancels without closing, close-on-Escape, capture/steal/warning family) were ported to `settings-shortcuts-panel.test.tsx` plus a dialog-level armed-capture-Escape test in `settings-dialog.test.tsx` | Verified by grep over `app/frontend/src` — no ArrowDown assertions ever existed in `shortcuts-overlay.test.tsx`; nothing dropped | S:60 R:95 A:95 D:90 |
| 9 | Confident | The panel drops the retired shell's ✕ close button and `[ Shortcuts: keyboard ]` h2; the `{chord} toggles this sheet` hint text is kept verbatim | The settings `Dialog` owns title + close (Escape/backdrop); the tab provides the label; keeping the hint text preserves the header-hint test family | S:45 R:80 A:80 D:70 |
| 10 | Confident | The chevron "Keyboard shortcuts" row is a pure deep-link (`openSettings("shortcuts")`), not a toggle — re-clicking while open on Shortcuts no longer closes | Plan R6 instructs the direct `openSettings("shortcuts")` call; only the chord/palette entry carries the toggle semantics (R5) | S:40 R:80 A:75 D:60 |

10 assumptions (1 certain, 9 confident, 0 tentative).
