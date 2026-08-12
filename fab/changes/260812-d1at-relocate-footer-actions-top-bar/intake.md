# Intake: Relocate Footer Actions to Top Bar

**Change**: 260812-d1at-relocate-footer-actions-top-bar
**Created**: 2026-08-12

## Origin

Conversational (`/fab-discuss` session, continuing the thread that shipped #550). The user proposed reserving the sidebar-footer row for "version number + hints / status updates" and moving the four actions elsewhere, suggesting a split (keyboard+settings → right rail bottom; theme+help → top-right menu):

> I am thinking we reserve the left panel last row of version number + hints / status updates. The 4 buttons there can be moved to other places. Candidates: bottom of the right rails for keyboard shortcuts, settings. Top right menu for theme, help. Thoughts?

The right-rail candidate was rejected during discussion: the rail (`right-panel.tsx`) is a per-window surface switcher rendered only on desktop terminal routes — app-global actions parked there would mix scopes and vanish on Host/server/board routes and mobile. The agreed direction (confirmed via a rendered HTML mock, "yes, create a mock" → "run it through fab-fff"): **consolidate all four in the top-right** — Settings as a persistent top-bar chip, Help/Keyboard/Theme as overflow-menu App-section rows — and free the footer for version + status.

Post-mock rebase note: `#566` (260812-nm4p) added a **right-rail toggle as the outermost right-cluster element** (mirroring the far-left sidebar toggle). The gear therefore slots **before the overflow chevron**, and the corner stays with the rail toggle.

## Why

1. **Pain point**: the footer row spends ~120px of the sidebar's only always-visible bottom row on four low-frequency action chips, leaving no room for status/hints; meanwhile app-global actions live on a surface that hides with the sidebar/drawer.
2. **Consequence of not changing**: no home for one-line status (update available, transient connection state); the four actions stay unavailable whenever the sidebar is hidden (mobile especially).
3. **Why this approach**: the top bar exists on **every** route, and its overflow menu already has View / Window / **App** section labels with `menuOnly` rows — zero new chrome. One home instead of two avoids "where did settings go?" hunting. Settings (highest-frequency of the four) stays one click as a chip; the other three tolerate a second click, with keyboard chords and command-palette entries remaining the fast paths (Constitution V intact — every action stays palette-reachable). The chip vocabulary shipped in #550 transfers directly: the gear changes corners, not species.

## What Changes

### 1. Settings gear → top-bar right cluster chip (`top-bar.tsx`)

- Add a Settings chip to the right cluster using the standard `TOP_BAR_BUTTON` composition (`rk-glint` + `TOP_BAR_BUTTON_BASE` + `TOP_BAR_BUTTON_REST`, 28×28 fine / 30×30 coarse), with `GearIcon` and a Tip carrying the HOST-effective `settings-open` chord (same `useKeybindings()` + `formatCombo` derivation the footer gear used; omit kbd when unbound/disabled).
- **Position**: inside the right cluster immediately **before the overflow chevron**; the right-rail toggle (260812-nm4p) remains the outermost element. Order: … · Refresh · **Gear** · chevron `▾` · rail-toggle.
- **Trigger seam**: consume `useSettingsDialog()` from `@/contexts/settings-dialog-context` — the dialog mounts once in AppLayout, so the top bar can call `openSettings` directly (same hook the sidebar uses at `sidebar/index.tsx:207`; no new event needed).
- **Width budget**: the gear MUST participate in the top bar's existing width-fit/overflow ladder so the bar never wraps or overflows horizontally at 375px — if the cluster cannot fit, the gear degrades to an overflow-menu row (`menuOnly`-style fallback) rather than shrinking or clipping. Verify 375px and 1024px+ per the Playwright-driven workflow.
- The gear appears on ALL top-bar modes (terminal/board/server/host) — it is app-global chrome, not a terminal-route control.

### 2. Help · Keyboard · Theme → overflow-menu App-section rows (`top-bar-overflow-menu.tsx`)

Three new rows in the existing **App** section (above the fixed version row), reusing the shared definitions in `global-chrome.tsx` (`HelpIcon`, `ThemeModeIcon`, HELP_URL — no drift with the palettes):

- **Help — run-kit docs** — external link (`HELP_URL`, `target="_blank"`, ↗ affordance), `HelpIcon`.
- **Keyboard shortcuts** — dispatches the `shortcuts-overlay:open` document CustomEvent (the footer button's exact mechanism); kbd slot shows the HOST-effective `shortcuts-overlay` chord when bound.
- **Theme…** — opens the theme selector via the `theme-selector:open` document CustomEvent. This **replaces click-cycling**: the footer button's click-cycles-modes behavior is retired; the current Ctrl/Cmd-click behavior (open selector) becomes the only behavior. The row's trailing slot shows the current effective mode (e.g. `dark`). Rationale: cycle-on-click doesn't map to a menu row, and the selector is the clearer interaction.
- Rows appear in the App section on every top-bar mode (matching the section's existing app-scoped semantics).

### 3. Freed footer → version + status/hints slot (`sidebar/index.tsx` SidebarFooter)

- **Remove** the four action buttons and the `FOOTER_ICON_CLASS` constant (its last consumers go away). Remove now-unused imports (`HelpIcon`, `ThemeModeIcon`, `KeyboardIcon`, `GearIcon`, `cycleTheme`, HELP_URL, `useSettingsDialog`/`onOpenSettings` prop, the theme hooks) from the footer path.
- **Keep** the left readouts exactly as-is: connection dot (role=status, aria) + version text (click-to-copy with toast).
- **Add** a right-aligned, truncating, non-interactive status/hints span filling the remaining row width. Initial content policy (deliberately quiet):
  - When `useUpdateNotification` reports an update is available: an `accent-green` hint (e.g. `v3.16.0 available`). Non-interactive readout — the overflow menu's version row REMAINS the update surface (unchanged, per its existing contract).
  - Otherwise: empty. No resting hint text (Constitution IV: minimal surface; resting copy is noise).
- **SelectionIndicator is NOT moved** — it stays where it is (bottom of the sessions list, adjacent to the rows being selected; 260807-nf9f). The freed footer does not absorb it.

### 4. Tests

- `sidebar/index.test.tsx` — footer assertions: four actions gone, dot+version intact, update-hint state renders/omits correctly.
- `top-bar` tests — gear chip renders on all modes, opens the settings dialog, carries the chord Tip; overflow menu App rows render and fire their events/link.
- e2e: the `sidebar-footer` spec (and its `.spec.md` companion, same commit — constitution) updated: footer actions removed there, new coverage for the top-bar gear + App menu rows either extending an existing top-bar spec or in the same spec renamed appropriately. Verify 375px single-row top-bar budget in the responsive checks.

## Affected Memory

- `run-kit/ui-patterns`: (modify) footer/app-global-chrome entries — footer becomes a passive status row (dot + version + status slot); the four actions relocate to the top bar (gear chip + App-section menu rows); the #550 chip-idiom-in-footer state is superseded; theme click-cycling retired in favor of the selector.

## Impact

- `app/frontend/src/components/top-bar.tsx` — gear chip in right cluster + fit-ladder participation.
- `app/frontend/src/components/top-bar-overflow-menu.tsx` — three App-section rows.
- `app/frontend/src/components/sidebar/index.tsx` — SidebarFooter rewrite (readouts + status slot; actions removed), `FOOTER_ICON_CLASS` deleted, prop/import cleanup at the Sidebar→Footer seam.
- `app/frontend/src/components/global-chrome.tsx` — definitions reused; `cycleTheme` may lose its last consumer (deletion candidate).
- Tests + companion `.spec.md` files per above. No backend/API changes; no new routes; no keybinding changes (`settings-open`, `shortcuts-overlay` chords unchanged).

## Open Questions

None — direction confirmed on a rendered mock; the one post-mock structural change (#566 rail toggle) is folded in above.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Consolidate all four actions top-right (gear chip + three App-section menu rows); footer becomes version + status row | Discussed — user approved the mock and said "run it through fab-fff"; rail candidate explicitly rejected in discussion | S:95 R:85 A:95 D:90 |
| 2 | Certain | Gear position: before the overflow chevron; rail toggle (#566) keeps the outermost corner | Post-rebase adjustment stated to the user; mirrors the toggle-pair symmetry #566 established | S:85 R:90 A:90 D:85 |
| 3 | Confident | Theme row opens the selector; click-cycling is retired | Stated in the mock's annotation the user approved; cycle-on-click cannot map to a menu row | S:75 R:80 A:85 D:75 |
| 4 | Confident | Footer status slot ships quiet: update-available hint only, non-interactive, overflow version row remains the update surface | Mock showed richer states as examples; "hints/status" scope kept minimal per Constitution IV — more states can layer on later | S:60 R:90 A:80 D:70 |
| 5 | Confident | SelectionIndicator stays at the sessions-list bottom (not folded into the footer) | Flagged the adjacency trade-off explicitly with the mock; user proceeded without requesting the fold-in | S:65 R:90 A:80 D:75 |
| 6 | Confident | Settings trigger via `useSettingsDialog()` context in the top bar (no new CustomEvent) | Dialog mounts once in AppLayout; context already exists for exactly this decoupling | S:75 R:85 A:90 D:85 |
| 7 | Confident | Gear participates in the top-bar fit ladder and degrades to an overflow row at narrow widths | 375px single-row budget is a documented hard constraint; the ladder is the existing mechanism for it | S:70 R:85 A:80 D:75 |
| 8 | Certain | All four actions remain palette-reachable via their existing palette entries (unchanged) | Constitution V; no palette changes needed — relocation touches chrome only | S:85 R:95 A:95 D:90 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
