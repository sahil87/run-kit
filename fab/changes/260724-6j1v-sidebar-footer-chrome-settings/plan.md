# Plan: Sidebar Footer Global Chrome + Desktop Settings Dialog

**Change**: 260724-6j1v-sidebar-footer-chrome-settings
**Intake**: `intake.md`

## Requirements

### Sidebar: footer global-chrome row

#### R1: Footer layout — readouts left, actions right
The sidebar footer row (`app/frontend/src/components/sidebar/index.tsx`) SHALL become `justify-between`: a left passive-readout segment (connection dot, then version line) and a right action cluster in the order **Help · Theme · Gear**.

- **GIVEN** a route that renders the Sidebar (terminal, tmux Server, board)
- **WHEN** the sidebar is visible
- **THEN** the footer shows the connection dot + version text left-aligned and Help/Theme/Gear right-aligned
- **AND** all three right-cluster icons use the gear's borderless footer idiom (`min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]`, no border, `text-text-secondary hover:text-text-primary transition-colors`) with `Tip placement="top"`

#### R2: Connection dot moves to the footer
The connection dot SHALL move from the top bar to the sidebar footer with identical semantics and markup: per-page "this page's live data is flowing" (`isConnected`), `w-2 h-2 rounded-full`, `bg-accent-green` connected / `bg-text-secondary` disconnected, wrapped in `role="status" aria-live="polite"`, `aria-label` `Connected`/`Disconnected`, Tip carrying the dot title (`Connected — run-kit v…` when the daemon version is known), a non-focusable span (readout, not a control). `isConnected` is threaded as a new required `SidebarProps` prop: AppShell passes its chat-aware `dotConnected`, BoardPage passes `boardConnected`.

- **GIVEN** a connected server page
- **WHEN** the sidebar footer renders
- **THEN** `[aria-label='Connected']` resolves to the footer dot (green), and no dot exists in the top bar
- **GIVEN** the page's stream drops
- **WHEN** `isConnected` flips false
- **THEN** the footer dot turns `bg-text-secondary` with `aria-label="Disconnected"`

#### R3: Version readout in the footer
A NEW version line SHALL render immediately right of the dot: `displayVersion(daemonVersion)` (e.g. `v0.9.3`) from `useUpdateNotification`, 10px `text-text-secondary`, click-to-copy using the overflow menu's pattern (`copyToClipboard(displayVersion(...))` + "Version copied"/"Copy failed" toast). When `daemonVersion` is null it renders nothing (no `RunKit` fallback). The overflow menu's fixed version row is unchanged — it remains the update surface; the footer version is a passive readout only.

- **GIVEN** the daemon reported a version
- **WHEN** the footer version text is clicked
- **THEN** the displayed `v…` form is copied and a toast confirms
- **GIVEN** no `event: version` yet (`daemonVersion === null`)
- **WHEN** the footer renders
- **THEN** no version element is present (never `vundefined`)

#### R4: Help + Theme actions in the footer
The footer SHALL carry a Help anchor (same `HELP_URL`, `target="_blank" rel="noopener noreferrer"`, same question-mark SVG, aria-label "Help — run-kit docs") and a Theme button with the top-bar `ThemeToggle`'s exact behavior: click cycles system→light→dark→system via the shared `cycleTheme`, Ctrl/Cmd-click dispatches `theme-selector:open`, aria-label `{System|Light|Dark} theme`, and the same three mode SVGs.

- **GIVEN** the footer theme button shows "System theme"
- **WHEN** clicked
- **THEN** the theme preference becomes the light theme (label flips to "Light theme")
- **GIVEN** any footer state
- **WHEN** Ctrl/Cmd-clicking the theme button
- **THEN** the `theme-selector:open` CustomEvent fires and no cycle happens

### Top bar: removals

#### R5: Theme / Help / Notification leave the registry; the dot leaves the bar
`top-bar.tsx` SHALL remove the `theme`, `help`, and `notification` registry entries and the trailing connection dot (the exempt block becomes chevron-only; trailing-width reservation measures just the chevron). Dead components are DELETED, not orphaned: `ThemeToggle`, `HelpLink`, `NotificationControl`, `ThemeMenuRow`, `HelpMenuRow`, `NotificationMenuRows`, plus the bell glyph constants and the now-unused `usePushSubscription`/`isConnected` wiring in TopBar. `HELP_URL`, `cycleTheme`, and the theme/help SVGs move to a shared module (`src/components/global-chrome.tsx`) consumed by the footer and both palettes; `NOTIFICATIONS_HELP_URL` moves with the notifications UI to the settings dialog. `TopBarProps.isConnected` is removed; the slot context's `isConnected` field is removed (Sidebar gets the value as a prop per R2), and the Host page's now-empty slot registration is dropped. **Stays untouched**: view-switcher, Open-in-App, SplitButtons, fixed-width, terminal-font, autofit, close/kill ✕, UpdateChip, RefreshButton, the overflow chevron, and the menu's fixed version row (with its ⟳ check affordance).

- **GIVEN** any route at any width
- **WHEN** the top bar renders
- **THEN** no theme/help/bell control exists in the bar or in the chevron menu, and no `[role="status"]` dot exists in the top bar; the chevron is the right-most element
- **GIVEN** the L3 tier after removal
- **WHEN** the pyramid renders in-bar at a wide width
- **THEN** the order is UpdateChip (when qualifying) → Refresh → chevron

#### R6: Keyboard reachability preserved (Constitution V)
Palette coverage for the moved chrome SHALL be verified: `Help: Documentation` (app palette + board palette via `HELP_URL`), `Theme: *` actions, `Settings: Open`, and the existing `Notifications: *` actions from `usePushSubscription().actions` remain reachable. No new palette actions are required (all four surfaces already exist) — imports simply retarget to the shared module.

- **GIVEN** the command palette on any route
- **WHEN** filtering "Help", "Theme", "Notifications", "Settings"
- **THEN** each still lists its action(s), backed by the same shared definitions the footer/dialog use

### Settings dialog: Notifications block

#### R7: Notifications row under This device
`settings-dialog.tsx` SHALL add a **Notifications** preference row under **This device**, mapping 1:1 from the bell popover model (`usePushSubscription`): a status line (small dot + "Subscribed on this device" / "Not subscribed" / "Blocked in browser settings"), an "Enable notifications" button when not subscribed, a "Send test notification" button disabled until subscribed (same Tip semantics), the denied re-allow note, and a "Setup & troubleshooting guide" link (same `NOTIFICATIONS_HELP_URL`, new tab). When push is unsupported the row SHALL render a short "Not supported in this browser" note instead of hiding (a settings pane explains absence). No Disable action — the push lib has no unsubscribe and the intake maps 1:1 from the existing control (no backend changes).

- **GIVEN** push state `subscribed`
- **WHEN** the dialog opens
- **THEN** the row shows the green-dot "Subscribed on this device" line and an enabled test button
- **GIVEN** push state `unsupported`
- **WHEN** the dialog opens
- **THEN** the Notifications row is present with the "Not supported in this browser" note and no action buttons

### Settings dialog: desktop layout

#### R8: Dialog width variant
`dialog.tsx` SHALL gain a `size?: "sm" | "lg"` prop defaulting to `"sm"` (`max-w-sm`); `"lg"` maps to `max-w-2xl`. Every existing consumer keeps `sm` implicitly; only the settings dialog passes `lg`.

- **GIVEN** any existing dialog (spawn/kill/create-session/…)
- **WHEN** rendered without a `size` prop
- **THEN** it keeps `max-w-sm` byte-identically
- **GIVEN** the settings dialog
- **WHEN** rendered
- **THEN** its panel carries `max-w-2xl`

#### R9: Preference-row grid, one responsive code path
Each setting SHALL become a preference row: a CSS grid `190px 1fr` (label column left — label plus a small `text-text-secondary` sublabel hint underneath; control column right so controls align on one vertical rule), hairline separators between rows (low-opacity border), scope headings as full-width underlined rules with the storage hint right-aligned on the same line, text inputs capped at ~320px. Below ~480px the grid collapses to a single column (label above control) via a `min-[480px]:` variant on `grid-template-columns` — one markup path, no second dialog. Field inventory and scopes UNCHANGED: This host = Instance name, SSH host, Accent color, Theme (mode + dark/light pair); This device = Terminal font size + Notifications (R7).

- **GIVEN** a ≥480px-wide dialog
- **WHEN** rendered
- **THEN** every row is a two-column grid with the control column left edge aligned across rows
- **GIVEN** a <480px viewport
- **WHEN** the dialog renders
- **THEN** rows stack label-above-control (today's phone layout) with no separate mobile implementation

### Tests

#### R10: Unit + e2e coverage updated with `.spec.md` companions
Affected unit tests SHALL be updated (`top-bar.test.tsx` — removals + new pyramid/dot assertions; `sidebar/index.test.tsx` + `sidebar.test.tsx` — footer cluster; `settings-dialog.test.tsx` — layout + notifications; `dialog.test.tsx` — size variant). Affected Playwright specs SHALL be updated (`top-bar-refresh.spec.ts` order test, `top-bar-overflow.spec.ts` L3 set + menu contents + menu-action test retarget, `mobile-layout.spec.ts` theme-reachability tests) and footer coverage added (new `sidebar-footer.spec.ts`); `settings-dialog.spec.ts` gains wide-layout + notifications assertions. Every modified/added `*.spec.ts` updates/creates its sibling `*.spec.md` in the same change (Constitution, Test Companion Docs).

- **GIVEN** the full frontend unit suite and the affected e2e specs
- **WHEN** run via `just` recipes
- **THEN** they pass against the new chrome layout, and each touched `.spec.ts` has a matching updated `.spec.md`

### Non-Goals

- No Disable/unsubscribe push action (no client/back-end unsubscribe path exists; 1:1 mapping from the bell).
- No host-route (`/`) or closed-mobile-drawer connection-dot fallback (intake assumption 8 — routes without a visible sidebar simply lose the indicator).
- No changes to the overflow menu's version row / update surface, UpdateChip, RefreshButton, or any page-scoped top-bar control.
- No backend or route changes.

### Design Decisions

#### Connection state reaches the Sidebar as a prop, not via the top-bar slot
**Decision**: Add `isConnected` to `SidebarProps`; AppShell passes `dotConnected`, BoardPage passes `boardConnected`. Remove the now-consumerless `isConnected` field from `TopBarSlot` and drop the Host page's slot registration (its only payload was the dot's data source).
**Why**: Explicit dataflow, unit-testable without a slot provider harness, and it removes dead slot plumbing instead of orphaning it — the same values the top bar dot showed (chat-aware on terminal routes, AND-over-servers on boards) reach the footer unchanged.
**Rejected**: Sidebar reading `useTopBarSlot()` — keeps a dead-ish field alive, couples the sidebar to top-bar plumbing, and forces every sidebar test to mount a slot provider and register a fake slot.
*Introduced by*: 260724-6j1v-sidebar-footer-chrome-settings

#### Shared chrome definitions live in `src/components/global-chrome.tsx`
**Decision**: `HELP_URL`, `NOTIFICATIONS_HELP_URL`, `cycleTheme`, `HelpIcon`, and `ThemeModeIcon` move to a new `src/components/global-chrome.tsx`; `top-bar.tsx` stops exporting them and `app.tsx`/`board-page.tsx`/footer/dialog import from the shared module.
**Why**: The intake mandates single definitions with no drift; after the deletions top-bar no longer uses any of them, so re-exporting from top-bar would be an orphan seam.
**Rejected**: Re-export from `top-bar.tsx` (dead indirection); duplicating the SVGs in the sidebar (drift).
*Introduced by*: 260724-6j1v-sidebar-footer-chrome-settings

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/global-chrome.tsx` with `HELP_URL`, `NOTIFICATIONS_HELP_URL`, `cycleTheme`, `HelpIcon`, `ThemeModeIcon` (moved verbatim from `top-bar.tsx`); retarget `HELP_URL` imports in `src/app.tsx` and `src/components/board/board-page.tsx` <!-- R5, R6 -->
- [x] T002 [P] Add `size?: "sm" | "lg"` prop to `app/frontend/src/components/dialog.tsx` (default `"sm"` → `max-w-sm`; `"lg"` → `max-w-2xl`) <!-- R8 --> <!-- rework: M1 — the taller settings dialog overflows short viewports with NO scroll path (measured 815px panel in a 667px viewport at 375x667, top clipped at -74). Add a scroll path in dialog.tsx: `max-h-[calc(100vh-2rem)] overflow-y-auto` on the panel and vertical padding (e.g. p-4) on the backdrop flex container, applied to BOTH sizes (safe for sm dialogs too) — DONE: panel carries `max-h-[calc(100vh-2rem)] overflow-y-auto`, container carries `p-4`, both sizes -->

### Phase 2: Core Implementation

- [x] T003 Rework the sidebar footer in `app/frontend/src/components/sidebar/index.tsx`: `justify-between` row; left readout segment (connection dot per R2 + version click-to-copy per R3); right cluster Help · Theme · Gear in the borderless idiom with `Tip placement="top"`; add required `isConnected` to `SidebarProps` <!-- R1, R2, R3, R4 -->
- [x] T004 Pass `isConnected` at both Sidebar call sites: `dotConnected` in `src/app.tsx` (AppShell), `boardConnected` in `src/components/board/board-page.tsx` <!-- R2 -->
- [x] T005 Remove `theme`/`help`/`notification` registry entries + the trailing dot from `app/frontend/src/components/top-bar.tsx`; delete `ThemeToggle`, `HelpLink`, `NotificationControl`, `ThemeMenuRow`, `HelpMenuRow`, `NotificationMenuRows`, bell constants, `pushUnsupported`, `dotTitle`; drop `isConnected` from `TopBarProps`; simplify the trailing exempt block to chevron-only <!-- R5 -->
- [x] T006 Remove `isConnected` from `TopBarSlot` (`src/contexts/top-bar-slot-context.tsx`) and from the slot registrations in `src/app.tsx` and `src/components/board/board-page.tsx`; drop the Host page's now-empty registration in `src/components/host-overview-page.tsx`; stop passing `isConnected` from `RootTopBar` <!-- R5 -->
- [x] T007 Rework `app/frontend/src/components/settings-dialog.tsx` to the desktop preference-pane layout: `size="lg"` Dialog, scope-heading rules with right-aligned hints, `PreferenceRow` grid (`min-[480px]:grid-cols-[190px_1fr]`, sublabels under labels, hairline separators, 320px input cap) for Instance name / SSH host / Accent color / Theme / Terminal font size <!-- R9 -->
- [x] T008 Add the Notifications preference row (This device) to `settings-dialog.tsx` per R7, using `usePushSubscription` + `NOTIFICATIONS_HELP_URL` from `global-chrome.tsx`, including the unsupported-state note <!-- R7 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T009 Update `src/components/top-bar.test.tsx`: drop ThemeToggle/HelpLink/NotificationControl/dot suites, retarget the pyramid-order test (UpdateChip→Refresh→chevron, no dot/theme/help/bell in bar), remove the `isConnected` harness prop <!-- R5, R10 -->
- [x] T010 [P] Update sidebar unit tests (`src/components/sidebar/index.test.tsx`, `src/components/sidebar.test.tsx`): harness passes `isConnected`; new footer-cluster tests (dot aria + states, version copy + null-version absence, Help attrs, theme cycle + Ctrl-click event, gear intact) <!-- R1, R2, R3, R4, R10 -->
- [x] T011 [P] Update `src/components/dialog.test.tsx` (default `sm` byte-identical, `lg` → `max-w-2xl`) and `src/components/settings-dialog.test.tsx` (mock `@/lib/push`; notifications states incl. unsupported note; wide-layout smoke: size prop + preference-row grid; existing commit-semantics tests keep passing) <!-- R7, R8, R9, R10 --> <!-- rework: M1 — extend dialog.test.tsx to assert the panel scroll path (max-h + overflow-y-auto present on both sizes); extend the e2e settings-dialog (or sidebar-footer) coverage with a short-viewport geometry assertion (e.g. 375x667: dialog boundingBox fits within viewport and the last row is reachable by scroll) so this class of regression is no longer invisible to the suite — DONE: `dialog.test.tsx:96` (scroll classes + backdrop padding, both sizes), `settings-dialog.spec.ts:156` (375x667 geometry: boundingBox within viewport, scrollHeight>clientHeight, last row reachable by scroll) -->
- [x] T012 Update e2e: `top-bar-refresh.spec.ts` (+`.spec.md`) order test → Refresh→chevron, assert bar has no dot/theme/help; `top-bar-overflow.spec.ts` (+`.spec.md`) L3=["Refresh page"], menu-contents test drops Theme/Help rows + asserts their absence, theme-cycle menu test → fixed-width checkbox menu action <!-- R5, R10 -->
- [x] T013 [P] Update `tests/e2e/mobile-layout.spec.ts` (+`.spec.md`): theme reachable via the mobile drawer footer; desktop theme button lives in the sidebar footer <!-- R4, R10 -->
- [x] T014 [P] Add `tests/e2e/sidebar-footer.spec.ts` + `.spec.md`: footer dot left (Connected), version copy, Help anchor attrs, theme cycle from the footer, gear opens settings; extend `tests/e2e/settings-dialog.spec.ts` (+`.spec.md`) with the wide dialog + Notifications row assertions <!-- R1, R3, R4, R7, R9, R10 -->

### Phase 4: Polish

- [x] T016 Delete the dead `hostMetricsConnected` plumbing from `src/contexts/session-context.tsx` (field at :132, the `useMemo` derivation, value entries at :1064/:1095, standalone default at :1316) and its test-harness setters — this change removed its only consumer (the Host page's slot registration); plan R5/A-010 requires dead plumbing be deleted, not orphaned <!-- R5 --> <!-- rework: review finding S1 -->
- [x] T017 Fix stale comments left by the removals: `src/hooks/use-push-subscription.ts:14` (names deleted `NotificationControl`; now the settings-dialog Notifications row), `src/components/view-switcher.tsx:135` (cites deleted `NotificationMenuRows`), `src/components/pin-icon.tsx:6` (cites deleted `HelpLink`), `tests/e2e/web-view-lens.spec.ts:326` (claims a `hidden sm:inline` dot class that never existed; the dot now lives in the sidebar footer). Add a precondition comment to `tests/e2e/_ready.ts` (~:29): the `[aria-label='Connected']` gate now depends on a MOUNTED sidebar (Shell unmounts it when collapsed/mobile) — specs using the gate must run at a desktop viewport with the sidebar open. Add a line under `## Notes` in this plan recording that the accepted connection-dot-loss tradeoff (intake assumption 8) also covers the COLLAPSED DESKTOP sidebar (Cmd+\), not just Host `/` and the closed mobile drawer <!-- R10 --> <!-- rework: review findings S2, S3, S4 + NTH1 -->
- [x] T018 Remove the dead `vi.mock("@/lib/push", …)` blocks from `src/components/update-chip.test.tsx:13-20` and `src/components/host-overview-page.test.tsx:31-38` — they existed only for the TopBar-mounted `NotificationControl`, which no longer exists; verify both suites still pass without them <!-- R10 --> <!-- rework: review finding S5 -->
- [x] T015 Verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, affected e2e via `just test-e2e "<spec>"` (top-bar-refresh, top-bar-overflow, mobile-layout, sidebar-footer, settings-dialog, sse-connection) <!-- R10 --> <!-- rework: re-run after M1/S1-S5 fixes; include the dialog-affected suites (dialog, settings-dialog, update-chip, host-overview-page unit) — DONE: tsc clean; `just test-frontend` 106 files / 1880 tests pass (dialog, settings-dialog, update-chip, host-overview-page, session-context, sidebar suites included); e2e: all 6 affected specs pass (26 tests; two first-run flakes — palette hotkey race + non-atomic pyramid tier reads — hardened in-spec, then settings-dialog+top-bar-overflow re-ran 14/14 clean) -->

## Execution Order

- T001, T002 first (shared module + size prop are dependencies).
- T003 → T004 (prop threading depends on the new SidebarProps). T005 → T006 (slot cleanup follows the bar removals).
- T007 → T008 (notifications row builds on the row layout).
- Tests (T009–T014) after their subject code; T015 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Sidebar footer is `justify-between` with dot+version left and Help·Theme·Gear right, all right icons in the borderless idiom with top-placed Tips — verified `sidebar/index.tsx:1414` (`flex items-center justify-between`), shared `FOOTER_ICON_CLASS` (`:1348`), all three `Tip placement="top"`; unit-asserted by the document-order test (`sidebar/index.test.tsx:1381`) and the borderless-idiom assertion (`:1360`)
- [x] A-002 R2: Footer dot keeps the exact top-bar semantics/markup (`role="status"`, aria-labels, colors, Tip title) and `isConnected` is threaded from both callers — markup at `sidebar/index.tsx:1418-1427` is byte-equivalent to the retired top-bar block (same `w-2 h-2 rounded-full`, `bg-accent-green`/`bg-text-secondary`, `role="status" aria-live="polite"`, non-focusable span) with the same `dotTitle` derivation; threaded from `app.tsx:2596` (`dotConnected`) and `board-page.tsx:1075` (`boardConnected`)
- [x] A-003 R3: Footer version renders `displayVersion(daemonVersion)` at 10px secondary, click-copies with toast, and renders nothing when the version is unknown — `sidebar/index.tsx:1429-1441`; unit-asserted (`sidebar/index.test.tsx:1330`, `:1338`) and e2e-asserted (`sidebar-footer.spec.ts:69`, clipboard equals displayed text)
- [x] A-004 R4: Footer Help/Theme reuse the single shared `HELP_URL`/`cycleTheme`/SVG definitions; Ctrl/Cmd-click opens the theme selector — imports from `global-chrome.tsx` (`sidebar/index.tsx:18`); repo sweep confirms exactly one definition of each; Ctrl-click event unit-asserted (`sidebar/index.test.tsx:1369`)
- [x] A-005 R7: Settings dialog has the Notifications row under This device with status line, enable, gated test button, help link, denied note, and the unsupported-state note — `settings-dialog.tsx:346-414`; all six behaviors unit-asserted across the `Notifications row` describe block (`settings-dialog.test.tsx:248-307`)
- [x] A-006 R8: `Dialog` exposes `size` defaulting to `sm`; settings uses `lg` (~`max-w-2xl`); all other dialogs unchanged — `dialog.tsx:14,33`; all 11 other `<Dialog` call sites pass no `size` (verified by sweep); `dialog.test.tsx:74`/`:86` assert both variants
- [x] A-007 R9: Preference rows use the 190px/1fr grid with sublabels, hairline separators, ruled scope headings with right-aligned hints, and ~320px input caps — `PreferenceRow` (`settings-dialog.tsx:68-96`), `divide-y divide-border/40` wrappers (`:472`, `:511`), `ScopeHeading` rule + right-aligned hint (`:41-51`), `max-w-[320px]` input (`:171`)

### Behavioral Correctness

- [x] A-008 R5: Theme, Help, Notification, and the connection dot are gone from the top bar AND the overflow menu; UpdateChip, Refresh, chevron, and the menu version row (with ⟳) behave as before; the chevron is the right-most bar element — registry now L3 = UpdateChip + Refresh only (`top-bar.tsx:624-640`); trailing exempt block is chevron-only (`:1074`); e2e-verified across the full 1280→375 width sweep (`top-bar-overflow.spec.ts:97`, all 8 tests pass) and the order/absence test (`top-bar-refresh.spec.ts:121`, passes)
- [x] A-009 R9: Below ~480px the settings rows collapse to a single column via the same markup (no second dialog code path) AND the dialog fits or scrolls within short viewports (no unreachable clipped content) — collapse verified (`settings-dialog.tsx:78`, `settings-dialog.test.tsx:245-247`); scroll path fixed (M1): the Dialog panel carries `max-h-[calc(100vh-2rem)] overflow-y-auto` and the backdrop container `p-4`, both sizes (`dialog.tsx:26,36`); unit-asserted for both variants (`dialog.test.tsx:96`) and e2e-verified at 375x667 (`settings-dialog.spec.ts:156` — boundingBox fully inside the viewport, panel is the scroll container, last row reachable by scroll)
- [x] A-010 R5: `ThemeToggle`, `HelpLink`, `NotificationControl`, their menu rows, bell constants, TopBar's `isConnected`/push wiring, and the slot's `isConnected` field are deleted with no orphaned exports or dead imports — repo sweep finds zero live references to any of the six components or `BELL_ON`/`BELL_OFF`; scripted unused-import check across all 9 touched source files finds nothing new (`ServerInfo` in `sidebar/index.tsx` is pre-existing on `HEAD`); `tsc --noEmit` clean. Residual `SessionContext.hostMetricsConnected` DELETED (T016, finding S1) including its transitive-only feeders — the `dedicatedMetricsConnected` write-only state, its setter calls, and the `METRICS_SUB` ack bookkeeping — plus the test-harness setters (`sidebar/index.test.tsx`, `host-overview-page.test.tsx`) and the three removed-feature tests in `session-context.test.tsx` (the StrictMode remount test's end-to-end assertion retargeted to the live `useHostMetrics()` seam); post-deletion sweep finds zero references to `hostMetricsConnected`/`dedicatedMetricsConnected`/`METRICS_SUB`; `tsc --noEmit` clean, full unit suite green
- [x] A-011 R2: e2e readiness helpers (`[aria-label='Connected']`) still pass — the footer dot satisfies them on server/terminal routes — ran `sse-connection` (1/1), `server-panel-grid` (5/5, incl. two mobile-drawer tests), `settings-dialog` (5/5), `sidebar-footer` (5/5); audited every one of the 30+ `[aria-label='Connected']` gate sites: none runs at a narrow viewport in the same test as the gate, and Playwright's `Desktop Chrome` 1280px default leaves the sidebar open (`chrome-context.tsx:88` — `!isMobileViewport()`). **Structural caveat**: the gate is now sidebar-mount-dependent — see finding S2
- [x] A-012 R6: Palette actions for Help, Theme, Notifications, and Settings remain present and functional (Constitution V) — `Help: Documentation` retargeted to `global-chrome` (`app.tsx:65,2092`; `board-page.tsx:19,672`), `Notifications: *` still built from `usePushSubscription().actions` (`use-push-subscription.ts:68-90`, untouched), theme + `Settings: Open` untouched
- [x] A-013 R10: Updated/added unit tests and e2e specs pass; every touched `.spec.ts` has an updated sibling `.spec.md` — `just test-frontend`: 106 files / 1882 tests pass; affected e2e all green (`sidebar-footer` 5/5, `top-bar-refresh` 2/2, `top-bar-overflow` 8/8, `mobile-layout` 4/4, `settings-dialog` 5/5, `sse-connection` 1/1, `server-panel-grid` 5/5); all five touched/added specs ship an updated companion (`sidebar-footer.spec.md` new; the other four diffed)

### Edge Cases & Error Handling

- [x] A-014 R3: Null `daemonVersion` renders no footer version element (no `vundefined`, no dead copy target) — `versionText` is `null`-gated (`sidebar/index.tsx:1394`) and the JSX is `{versionText && …}`; unit-asserted (`sidebar/index.test.tsx:1338`)
- [x] A-015 R7: Unsupported-push browsers see the "Not supported in this browser" note (row present, no buttons); denied state shows the re-allow note with Enable still offered — `settings-dialog.tsx:365` (unsupported branch keeps the row, renders only the note) and `:395-399` (denied note; the Enable button's `!subscribed` gate keeps it offered under `denied`, faithful to the retired bell); both unit-asserted (`settings-dialog.test.tsx:288`, `:296`)

### Code Quality

- [x] A-016 Pattern consistency: footer icons follow the gear idiom; dialog rows follow existing Tailwind token conventions; no native `title=` on tipped controls — one shared `FOOTER_ICON_CLASS` constant, no `rk-glint`/`border-border` on footer icons (unit-asserted, `sidebar/index.test.tsx:1360-1362`); zero native `title=` on any new control (asserted in both the unit tests and `sidebar-footer.spec.ts:41`); rows use existing `text-text-primary`/`text-text-secondary`/`border-border` tokens only
- [x] A-017 No unnecessary duplication: single definitions for HELP_URL/cycleTheme/SVGs; notifications logic reuses `usePushSubscription`; version copy reuses `copyToClipboard`/`displayVersion` — `global-chrome.tsx` is the sole definition site for all five shared symbols (sweep-verified); `NotificationsControl` holds no push logic of its own beyond presentation; the version readout composes the existing `displayVersion` + `copyToClipboard` + `addToast` helpers with no new utility

## Notes

- The accepted connection-dot-loss tradeoff (intake assumption 8) also covers the COLLAPSED DESKTOP sidebar (Cmd+\), not just Host `/` and the closed mobile drawer — any state where Shell unmounts the sidebar loses the indicator (rework NTH1).
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

All five candidates surfaced by the prior review cycle were ACTED ON (T016–T018): `session-context.tsx`'s `hostMetricsConnected` (plus its `dedicatedMetricsConnected`/`METRICS_SUB` feeders and harness setters), the `use-push-subscription.ts` / `view-switcher.tsx` / `pin-icon.tsx` stale citations, and the dead `vi.mock("@/lib/push", …)` blocks in `update-chip.test.tsx` + `host-overview-page.test.tsx`. Post-deletion sweeps find zero references to any of them; `tsc --noEmit` is clean and the full unit suite is green.

Remaining candidates after this cycle:

- `docs/memory/run-kit/architecture.md:330,653,661,665,677` + `docs/memory/run-kit/ui-patterns.md:11,869,887,969` — every `hostMetricsConnected` reference and the "connection dot renders in all four modes / Host passes `hostMetricsConnected` as `isConnected`" prose now document a deleted API and a retired top-bar element. Memory rewrites are the HYDRATE stage's job (not review/apply), so these are hand-offs, not code deletions — but `intake.md` `## Affected Memory` names only `run-kit/ui-patterns`, so `architecture.md` needs adding to the hydrate target list (see review finding S1).
- No remaining production code is redundant: the change is net -73 lines in `app/frontend/src/` (752 added / 910 deleted, plus the new 85-line `global-chrome.tsx`), every new symbol has call sites, and the shared-definition move eliminated the duplication it could have introduced.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | No Disable/unsubscribe button in the Notifications row — Enable/test/status only, mirroring the bell 1:1 | `lib/push.ts` has no unsubscribe and the intake bans backend changes; "Enable/Disable action button" is read as the state-dependent action the existing control models (mockups are visual references) | S:60 R:90 A:85 D:70 |
| 2 | Confident | `isConnected` reaches the Sidebar as a required prop; the slot's `isConnected` field and the Host page's slot registration are removed as dead code | The dot was the field's only consumer; explicit prop threading keeps the same per-page values and testability (see Design Decisions) | S:65 R:85 A:90 D:80 |
| 3 | Certain | Shared definitions land in a new `src/components/global-chrome.tsx` (not re-exported from top-bar) | Intake mandates "moved or re-exported … no drift" and "deleted, not orphaned"; after deletion top-bar has no use for them, so a move is the non-orphaning option | S:80 R:90 A:90 D:85 |
| 4 | Confident | Responsive collapse uses Tailwind's `min-[480px]:` arbitrary variant on the row grid | Intake specifies "~480px" and "media/container query on grid-template-columns"; the arbitrary variant is the project-idiomatic Tailwind-4 spelling | S:70 R:95 A:90 D:85 |
| 5 | Confident | Footer version button aria-label mirrors the menu row's `RunKit v… (copy)` form; visible text is the bare `v…` | Intake fixes the visible form (`v0.9.3`) and the copy pattern; the aria form follows the established overflow-menu precedent | S:60 R:95 A:85 D:80 |
| 6 | Confident | New footer e2e coverage is a dedicated `sidebar-footer.spec.ts` (+ .spec.md) rather than folding into an existing sidebar spec | Intake says "add/extend coverage for the footer cluster"; a focused spec keeps the constitutionally-required companion doc coherent | S:55 R:95 A:85 D:75 |
| 7 | Confident | Status-line wording: "Subscribed on this device" / "Not subscribed" / "Blocked in browser settings" | Intake quotes the subscribed wording verbatim and defers the others to the existing control's states (denied wording reused) | S:70 R:95 A:85 D:80 |

7 assumptions (1 certain, 6 confident, 0 tentative).
