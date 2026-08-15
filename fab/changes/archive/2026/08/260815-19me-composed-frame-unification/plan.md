# Plan: Composed-Frame Unification

**Change**: 260815-19me-composed-frame-unification
**Intake**: `intake.md`

## Requirements

### Chrome: Desktop Sidebar Footer

#### R1: SidebarFooter renders on mobile only
`SidebarFooter` (in `app/frontend/src/components/sidebar/index.tsx`) SHALL render only when `isMobile` is true — gated exactly like the `BottomPanels` mount two lines above it. The mobile drawer footer stays byte-identical (connection dot, click-to-copy version, update hint). The desktop sidebar SHALL end at the session list / selection indicator with no footer row.

- **GIVEN** a desktop viewport (fine pointer, ≥640px) on any sidebar-bearing route
- **WHEN** the sidebar renders
- **THEN** no footer status row is present (no footer connection dot, no version readout, no update hint in the sidebar)
- **AND** the full-width status bar still carries the connection dot and version

- **GIVEN** the mobile drawer is open
- **WHEN** the sidebar renders
- **THEN** the footer row renders byte-identical to today (dot + version + update hint slot)

### Shell: Universal Stage Ground & Sidebar Card

#### R2: The stage ground is Shell's universal desktop composition
The `bg-bg-inset` stage ground with 6px padding/gap SHALL apply on every desktop route that mounts `<Shell>` (terminal, tmux Server, board) — no longer gated on `rightPanelChildren`. The `hasRightPanel` template fork in `shell.tsx` SHALL be deleted. The status bar row SHALL remain full-width, flush, square attached frame chrome OUTSIDE the padded stage (never inset by stage padding); the top bar likewise stays attached above it. The mobile grid template SHALL be byte-identical to today (no stage, no statusbar row, drawer overlay unchanged).

- **GIVEN** a desktop board route (`/board/$name`), which today passes no `rightPanelChildren`
- **WHEN** the Shell renders
- **THEN** the sidebar and the content region float as cards on one continuous `bg-bg-inset` ground with 6px padding and 6px gaps
- **AND** the status bar spans the full viewport width flush at the bottom, un-inset

- **GIVEN** a mobile viewport
- **WHEN** the Shell renders
- **THEN** the grid template, drawer overlay, and absence of a statusbar row are unchanged

#### R3: The sidebar is a floating card
The desktop sidebar aside SHALL carry the card vocabulary — `rounded-md` + the shared 55%-dimmed `rk-card-border` + `bg-bg-primary` — and SHALL drop its attached `border-r` seam. It floats 6px above the status bar (resolving the old square T-junction). The sidebar aside keeps its unmount-on-collapse gating and the 150ms width-collapse transition. The two-family comments in `shell.tsx` SHALL be rewritten: frame = top bar + status bar only; sidebar joins the card family.

- **GIVEN** a desktop route with the sidebar open
- **WHEN** the sidebar renders
- **THEN** it is a rounded card with the dimmed card border on the inset ground, with no `border-r`

#### R4: Sidebar drag-resize keeps working across the card seam
The terminal route's sidebar drag-resize SHALL keep working with the card + 6px gap. The handle's exact affordance is an apply-time decision (explicitly delegated), but it MUST live in/over the gap without doubling the card's border seam, and drag state/handlers stay in AppShell.

- **GIVEN** a desktop terminal route
- **WHEN** the user drags the sidebar's resize handle
- **THEN** the sidebar column resizes exactly as today (same clamps, same persistence)

### Rail Retirement: Top-Bar Surface Toggles

#### R5: The right rail component and Shell rail plumbing are removed
`app/frontend/src/components/right-panel.tsx` and `right-panel.test.tsx` SHALL be removed. Shell's `rightPanelChildren` / `rightPanelVisible` props and the collapse dance (display-hide never-unmount, the `auto`-track drop) SHALL be deleted. Layout tiles are content-area state and are untouched (they were never inside the rail); `lib/right-panel.ts` (the shared surface registry / `availableSurfaces` / `clampRatio` module) SHALL be kept.

- **GIVEN** the terminal route with any tile layout open
- **WHEN** the rail is removed
- **THEN** tiles render exactly as before (add/close/promote/swap/zoom, `?layout=` deep links, `⇧⌘.` all work), and no 40px rail column exists

#### R6: Surface toggles move into the top-bar right cluster
A surface-toggle group SHALL render in the top-bar right cluster as a new ordered-registry entry — terminal-route-only (`mode === "terminal" && currentWindow`), rendered as a bordered sub-group with a divider, sitting LEFT of the remaining terminal chips (i.e. at the registry's L1 head, first fit candidate to drop). The group SHALL carry a stable testid (`surface-toggles`) replacing the e2e-load-bearing `right-panel-rail`. The exact button grammar is preserved:

- One `Tip`-wrapped button per available surface not in `SURFACE_RAIL_HIDDEN` (chat renders no toggle), `tty` first, glyphs from `SURFACE_GLYPH`
- Lit (`aria-pressed`, accent-green border/text/10% bg) = open tile (`layout.order`)
- Corner availability dot on every button
- Unlit buttons disabled at 3 open tiles with the "Close a tile first" tooltip (Tip wraps a span so disabled buttons still tip)
- Click routes through the caller's `togglePanel` semantics unchanged: unlit→`addSurface` (1→2 `split-h`, 2→3 `main-left`), lit→`closeSurface`, closing the last tile is a null no-op

- **GIVEN** a terminal-route window offering tty+web+code
- **WHEN** the top bar renders on desktop
- **THEN** the toggle group shows three buttons (`>_`, `://`, `{}`) with the open tiles lit, and clicking an unlit button adds that surface's tile

- **GIVEN** three tiles are open
- **WHEN** the user hovers a disabled unlit toggle
- **THEN** the "Close a tile first" tooltip shows

#### R7: The overflow menu gains a Tiles section
Under width pressure the toggle group SHALL degrade into the overflow chevron menu following the existing priority+ ladder: a new `tiles` menu section (extending `MenuGroup` / `MENU_SECTIONS`) whose rows are one toggle row per shown surface (`role="menuitemcheckbox"`, checked = tile open, leading `SURFACE_GLYPH` glyph per the leading-glyph parity rule, honoring the disabled-at-3 condition). The group participates in the probe/fit measurement like any fit candidate.

- **GIVEN** a narrow desktop width where the group no longer fits in-bar
- **WHEN** the chevron menu opens
- **THEN** a Tiles section lists one row per shown surface with checked state matching open tiles, and clicking a row toggles that tile

#### R8: The rail-toggle chip, palette action, and railOpen state are removed
The top-bar rail-toggle chip (the trailing exempt block's outermost element), its `onToggleRail`/`railOpen` slot registration, the `Panel: Toggle rail` palette action (`panel-rail-toggle` in `app.tsx`), and the persisted `railOpen` ChromeContext state (localStorage `runkit-rail-open`) SHALL all be removed. The `⇧⌘.` `panel-toggle` chord (toggles the first non-tty tile) is unrelated and SHALL be kept.

- **GIVEN** the terminal route
- **WHEN** the top bar renders
- **THEN** no rail-toggle chip exists after the chevron, and the palette contains no `Panel: Toggle rail` entry
- **AND** `⇧⌘.` still toggles the first non-tty surface's tile

### Route Grounds: Board, Server, Host

#### R9: Board panes join the card family on the stage ground
Board panes (`board/board-pane.tsx`) SHALL pick up `rounded-md`; the desktop pane row (`DesktopRow` in `board/board-page.tsx`, today `flex gap-1 p-1`) SHALL adopt the universal stage ground with 6px gaps (dropping its own padding where the stage's 6px inset covers it). Status borders stay full-strength and unchanged: waiting keeps the 3px pulsing amber seam, focused keeps the accent border + shadow ring. The mobile carousel is untouched.

- **GIVEN** a desktop board with idle, focused, and waiting panes
- **WHEN** the board renders
- **THEN** panes are rounded cards with 6px gaps on the inset ground; the waiting pane's amber seam and the focused pane's accent ring render exactly as today

#### R10: The server route's centered column becomes a card
The tmux Server route's centered 900px `bg-bg-primary` column (the `fixedWidth` wrapper in `app.tsx`) SHALL become a rounded card (`rounded-md` + dimmed `rk-card-border`) framed by the stage's 6px inset, instead of a square edge-to-edge-height strip.

- **GIVEN** the `/$server` route on desktop
- **WHEN** the page renders
- **THEN** the centered SessionTiles column is a rounded card with the dimmed border on the inset ground

#### R11: The host page ground flips to inset
`HostOverviewPage`'s root ground SHALL flip `bg-bg-primary` → `bg-bg-inset` (host-overview-page.tsx:240) so all four routes share one floor. Its `bg-bg-card` tiles, sections, layout, and its own StatusBar mount are otherwise untouched (the host page has no sidebar — unchanged).

- **GIVEN** the `/` host page
- **WHEN** it renders
- **THEN** the page ground is `bg-bg-inset` and the existing card tiles render on it unchanged

### Tests: Migration Contract

#### R12: Unit and e2e coverage migrates with the chrome
Tests SHALL move with the surfaces they prove, and every modified `*.spec.ts` SHALL update its sibling `*.spec.md` in the same commit (Constitution: Test Companion Docs):

- Footer unit tests in `sidebar/index.test.tsx` move to a mobile-context render; a desktop render asserts the footer's absence
- `tests/e2e/sidebar-footer.spec.ts` migrates: desktop asserts no sidebar footer + the status-bar dot/version; the footer assertions run in a mobile-drawer context
- Rail e2e (`right-panel.spec.ts`) is rewritten against the top-bar `surface-toggles` group (toggle gating by capability, glyphs/tooltips, add/close arity walk, disabled-at-3, legacy `?panel=` deep links) — rail-collapse cases are deleted with the feature
- `surface-layout.spec.ts`, `code-surface.spec.ts`, `chat-view.spec.ts` swap rail-button interactions for top-bar toggle interactions
- `top-bar-overflow.spec.ts` folds the toggle group into the fit/pyramid assertions and the Tiles menu section
- `right-panel.test.tsx` is removed; still-meaningful assertions migrate to the new group's tests

- **GIVEN** the full frontend gates (`just test-frontend`, `npx tsc --noEmit`, affected e2e via `just test-e2e "<spec>"`)
- **WHEN** the change is complete
- **THEN** all pass, with the known pre-existing flakes ("Maximum update depth exceeded" console errors; window-heading history-arrows forward-nav timeout) not attributed to this change

### Non-Goals

- No spec-doc edits: `docs/specs/right-panel.md` / `surface-layout.md` rail sections stay as-is (human-curated; hydrate updates memory, spec staleness is a human docs pass)
- No mobile behavior changes anywhere (drawer, panels, carousel, bottom bar)
- No backend changes
- No changes to tile/layout semantics (`resolveLayout`, mutations, persistence, `?layout=` URL model)

### Design Decisions

#### Universal stage is a nested grid; the status bar stays outside it
**Decision**: Restructure Shell's desktop grid as outer rows `"stage" / "statusbar"` (columns `1fr`), where the stage is a nested grid (`bg-bg-inset p-[6px] gap-[6px]`, columns `${sidebarWidth}px 1fr` / `0 1fr`, areas `"sidebar content" / "sidebar bottombar"`) holding the sidebar card, the consumer's content, and the bottombar footer; the statusbar row stays a direct outer-grid child.
**Why**: grid padding/gap apply to the whole grid — padding on the outer grid would inset the status bar from the viewport edges and gap would open seams around it, but the status bar must stay full-width flush attached chrome. Nesting scopes the inset ground to exactly the region that floats cards, and the sidebar column keeps its width-collapse transition inside the stage.
**Rejected**: padding/gap on the outer grid (insets the status bar — breaks the attached-frame contract); keeping the stage as a content-column-only wrapper with the sidebar attached outside it (the sidebar card would sit on the default background, not the shared ground — defeats the unification).
*Introduced by*: 260815-19me-composed-frame-unification

#### Surface toggles are one registry entry at the L1 head
**Decision**: The toggle group is a single `RegistryEntry` (`id: "surface-toggles"`, `menuGroup: "tiles"`, terminal-gated `hidden`) whose `barRender` renders the whole bordered group and whose `menuRender` emits one checkbox row per shown surface; it sits at the registry head so it is the first fit candidate to drop.
**Why**: the right cluster is registry-driven by contract — one ordered source drives bar and menu so they cannot drift, the probe measures the group's real width, and the pyramid drop-order invariants the overflow e2e asserts hold without special-casing. First-to-drop matches the intake's "left of the existing chips" placement (drop order = leftmost first).
**Rejected**: one registry entry per surface button (three entries fragment the bordered-group rendering and triple the probe/fit bookkeeping for no behavioral gain); rendering the group in the trailing exempt block (exempt items never overflow — the group must degrade under width pressure).
*Introduced by*: 260815-19me-composed-frame-unification

#### The sidebar keeps unmount-on-collapse
**Decision**: Joining the card family does not change the sidebar aside's mount gating — it still fully unmounts when `sidebarOpen` is false.
**Why**: the rail's old never-unmount contract existed for iframe in-memory state (web/code); the sidebar holds no iframes, and its unmount-on-collapse is long-established behavior with the 150ms column transition.
**Rejected**: display-hiding the sidebar like the old rail (adds a mounted-but-hidden subtree with zero benefit).
*Introduced by*: 260815-19me-composed-frame-unification

## Tasks

### Phase 1: Shell Restructure

- [x] T001 Restructure `app/frontend/src/components/shell/shell.tsx`: universal desktop stage (outer `"stage" / "statusbar"` grid; nested stage grid `bg-bg-inset p-[6px] gap-[6px]` with areas `"sidebar content" / "sidebar bottombar"`, columns `${sidebarWidth}px 1fr`/`0 1fr` + transition); delete `hasRightPanel`, `rightPanelChildren`, `rightPanelVisible`, and the rail aside/collapse machinery; sidebar aside gets card chrome (`rounded-md border rk-card-border bg-bg-primary`, drop `border-r`); mobile branch byte-identical; rewrite the two-family doc comments <!-- R2, R3, R5 -->
- [x] T002 Rework the sidebar drag-resize handle for the card seam (handle placement in/over the 6px gap; drag state/handlers stay in `app.tsx`; same clamps and persistence) <!-- R4 -->
- [x] T003 `app/frontend/src/app.tsx`: remove the `rightPanelChildren` wiring and `<RightPanel>` mount, `railOpen` consumption, and the `onToggleRail`/`railOpen` top-bar slot registration; remove the `Panel: Toggle rail` palette action (`panel-rail-toggle`); keep `togglePanel` and the `⇧⌘.` `panel-toggle` chord <!-- R5, R8 -->
- [x] T004 [P] `app/frontend/src/contexts/chrome-context.tsx`: remove the `railOpen` state and its `runkit-rail-open` localStorage persistence <!-- R8 -->

### Phase 2: Top-Bar Surface Toggles

- [x] T005 Create the surface-toggle group component (bordered sub-group + divider, `data-testid="surface-toggles"`, per-surface Tip-wrapped buttons with `SURFACE_GLYPH` glyphs, lit `aria-pressed` state, availability dot, disabled-at-3 with span-wrapped Tip, `SURFACE_RAIL_HIDDEN` filter, `tty` first) wired to `availableSurfaces`/`layout.order`/`togglePanel`; register it as a new ordered-registry entry at the L1 head in `app/frontend/src/components/top-bar.tsx` (terminal-gated `hidden`, `menuGroup: "tiles"`), threading the needed slot data; remove the rail-toggle chip from the trailing exempt block <!-- R6, R8 -->
- [x] T006 `app/frontend/src/components/top-bar-overflow-menu.tsx`: extend `MenuGroup`/`MENU_SECTIONS` with the `tiles` section (ordered first); implement the group's `menuRender` — one `menuitemcheckbox` row per shown surface with leading glyph, checked = open, disabled-at-3 <!-- R7 -->
- [x] T007 [P] Delete `app/frontend/src/components/right-panel.tsx` and `right-panel.test.tsx`; migrate still-meaningful unit assertions into the new group's tests in `top-bar.test.tsx` (gating by capability, lit/disabled states, toggle callback routing) <!-- R5, R6, R12 -->

### Phase 3: Route Grounds & Footer

- [x] T008 [P] `app/frontend/src/components/sidebar/index.tsx`: gate `SidebarFooter` on `isMobile` (mirroring the `BottomPanels` gate); move footer unit tests in `sidebar/index.test.tsx` to a mobile-context render and add a desktop absence assertion <!-- R1, R12 -->
- [x] T009 [P] Board ground: `board/board-page.tsx` `DesktopRow` row adopts 6px gaps on the stage ground (drop redundant own padding); `board/board-pane.tsx` adds `rounded-md` with status borders (waiting seam, focus ring) unchanged; mobile carousel untouched <!-- R9 -->
- [x] T010 [P] Server column card: the `fixedWidth` wrapper in `app.tsx` gains `rounded-md` + dimmed `rk-card-border` card chrome on the stage ground (drop the now-redundant `bg-bg-inset` main special-casing where the stage supplies it) <!-- R10 -->
- [x] T011 [P] `app/frontend/src/components/host-overview-page.tsx`: flip the root ground `bg-bg-primary` → `bg-bg-inset`; tiles and StatusBar mount untouched <!-- R11 -->

### Phase 4: Test Migration & Gates

- [x] T012 Rewrite `tests/e2e/right-panel.spec.ts` (+ `.spec.md`) against the top-bar `surface-toggles` group: capability gating, glyph/tooltip assertions, add/close arity walk (1→2 `split-h`, 2→3 `main-left`), disabled-at-3 tooltip, legacy `?panel=` deep links; delete rail-collapse/`runkit-rail-open` cases <!-- R6, R12 -->
- [x] T013 Update `tests/e2e/surface-layout.spec.ts`, `code-surface.spec.ts`, `chat-view.spec.ts` (+ their `.spec.md`s): swap rail-button interactions for top-bar toggle interactions (chat-view asserts no chat toggle in the GROUP) <!-- R12 -->
- [x] T014 Migrate `tests/e2e/sidebar-footer.spec.ts` (+ `.spec.md`): desktop asserts footer absence + status-bar dot/version; footer content assertions move to a mobile-drawer context <!-- R1, R12 --> <!-- rework: the readiness-gate retarget this task's footer removal forced across specs missed one companion — code-folder-latch.spec.md:24 still documents the old nav-scoped Connected-dot gate; update it to the status-bar dot gate (A-019). Also fix the stale registry-ordering comment at top-bar.tsx:573 (should-fix). -->
- [x] T015 Update `tests/e2e/top-bar-overflow.spec.ts` (+ `.spec.md`): fold the toggle group into the pyramid/fit assertions and assert the Tiles menu section under overflow <!-- R7, R12 -->
- [x] T016 Run gates in order: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; affected e2e via `just test-e2e` (right-panel/surface-toggles, surface-layout, sidebar-footer, top-bar-overflow, code-surface, chat-view, board + mobile-layout smoke); fix regressions (known pre-existing flakes exempt) <!-- R12 -->

## Execution Order

- T001 blocks T002 (handle placement needs the new stage) and T003 (prop deletion lands together with Shell's signature change)
- T005 blocks T006 (menu rows render the group's entry) and T012
- T003/T004 can land with T005 in either order but before T016
- Phase 3 tasks are independent ([P]) once T001 is in
- T016 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Desktop sidebar renders no footer row; mobile drawer footer is byte-identical (dot, version copy, update hint)
- [x] A-002 R2: All desktop Shell routes (terminal, server, board) render sidebar + content as cards on one `bg-bg-inset` ground with 6px padding/gap; `hasRightPanel` fork is gone
- [x] A-003 R3: Sidebar aside carries `rounded-md` + `rk-card-border` + `bg-bg-primary`, no `border-r`
- [x] A-004 R4: Sidebar drag-resize works with the same clamps and persistence
- [x] A-005 R6: Top-bar `surface-toggles` group renders on desktop terminal routes with exact grammar (lit aria-pressed, availability dot, disabled-at-3 tooltip, SURFACE_RAIL_HIDDEN filter, tty first)
- [x] A-006 R7: Overflowed group renders a Tiles menu section with per-surface checkbox rows honoring open/disabled state
- [x] A-007 R9: Board panes are `rounded-md` cards with 6px gaps on the stage ground
- [x] A-008 R10: Server route's centered column is a rounded card with the dimmed border
- [x] A-009 R11: Host page ground is `bg-bg-inset`; tiles unchanged

### Behavioral Correctness

- [x] A-010 R6: Toggle clicks route through `togglePanel` semantics unchanged (unlit→add 1→2 `split-h` / 2→3 `main-left`, lit→close, last-tile close is a no-op)
- [x] A-011 R2: Status bar stays full-width flush at the viewport bottom (never inset by stage padding); top bar stays attached
- [x] A-012 R2: Mobile grid template, drawer overlay, and mobile board carousel are byte-identical (no stage, no statusbar row)
- [x] A-013 R9: Waiting pane's 3px amber seam and focused pane's accent ring render full-strength on the rounded card

### Removal Verification

- [x] A-014 R5: `right-panel.tsx` and `right-panel.test.tsx` are deleted; no `rightPanelChildren`/`rightPanelVisible` props remain on Shell; no `right-panel-rail` testid remains anywhere
- [x] A-015 R8: Rail-toggle chip, `onToggleRail`/`railOpen` slot fields, `Panel: Toggle rail` palette action, `railOpen` ChromeContext state, and the `runkit-rail-open` key are all gone (repo-wide grep clean)

### Scenario Coverage

- [x] A-016 R6: e2e proves toggle gating by capability, the add/close arity walk, and disabled-at-3 via the `surface-toggles` testid
- [x] A-017 R5: e2e proves tiles + `?layout=` deep links and `⇧⌘.` work with no rail present
- [x] A-018 R1: e2e proves desktop footer absence + status-bar dot, and the mobile-drawer footer content
- [x] A-019 R12: `code-folder-latch.spec.md:24` now documents the status-bar `Connected`-dot readiness gate (`getByTestId("status-bar")`), matching the retargeted gate in `code-folder-latch.spec.ts:110,134`

### Edge Cases & Error Handling

- [x] A-020 R6: A window with zero non-tty surfaces renders the group with only the lit tty toggle (no dead buttons); a null `currentWindow` renders no group
- [x] A-021 R7: At very narrow desktop widths the exempt chevron stays visible/clickable and the Tiles rows remain reachable in the menu

### Code Quality

- [x] A-022 Pattern consistency: New code follows the registry/probe/menu-row patterns in `top-bar.tsx`/`top-bar-overflow-menu.tsx` and the card vocabulary tokens (`rk-card-border`, `rounded-md`)
- [x] A-023 No unnecessary duplication: `SURFACE_GLYPH`/`SURFACE_LABEL`/`SURFACE_RAIL_HIDDEN` and `togglePanel` are reused, never re-declared
- [x] A-024 No polling, no new routes, no settings pages (Constitution IV); every new action stays keyboard-reachable via existing palette entries (Constitution V)
- [x] A-025 Comment discipline: shell.tsx two-family comments state the new model; no reviewer-addressed narration or change-ID citations in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `docs/specs/right-panel.md` + the rail sections of `docs/specs/surface-layout.md` — describe the retired rail/collapse chrome; intake assumption 8 explicitly defers spec edits to a human docs pass, so these are stale-but-planned, not forgotten
- `app/frontend/tests/e2e/right-panel.spec.ts` (file name + `right-panel.spec.md`) — the spec now covers the top-bar surface toggles; the rail-derived file name is vestigial (rename to e.g. `surface-toggles.spec.ts`)
- `SURFACE_RAIL_HIDDEN` (`app/frontend/src/lib/surface-layout.ts:220`) — the constant's name still references the retired rail; a rename (e.g. `SURFACE_TOGGLE_HIDDEN`) would touch several files, so it is optional follow-up
- The rail itself (`right-panel.tsx`, `right-panel.test.tsx`), `railOpen` state + `runkit-rail-open` persistence, the `Panel: Toggle rail` palette action, `ShellGridRefContext`/`useShellGridRef`, and Shell's `rightPanelChildren`/`rightPanelVisible` collapse machinery were already deleted by this change — nothing further made redundant in-tree

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Universal stage = nested stage grid holding sidebar+content+bottombar; statusbar stays an outer-grid child so it is never inset | Forced by CSS grid mechanics (padding/gap would inset the attached status bar); matches the approved mock's geometry | S:80 R:75 A:85 D:80 |
| 2 | Confident | Surface toggles are ONE registry entry (`surface-toggles`, `menuGroup: "tiles"`) at the L1 head; menu rows are per-surface checkboxes | Registry-driven cluster is the documented contract; L1-head = first-to-drop matches "left of the existing chips" | S:75 R:85 A:85 D:75 |
| 3 | Confident | Tiles menu section renders first in `MENU_SECTIONS` order (before View) | Pyramid order puts the group's rows first among overflowed candidates; section order follows drop order | S:60 R:90 A:75 D:70 |
| 4 | Confident | Sidebar keeps unmount-on-collapse; only the rail's never-unmount contract dies with the rail | The never-unmount existed for iframe state; the sidebar holds none | S:70 R:85 A:90 D:85 |
| 5 | Confident | `sidebar-footer.spec.ts` migrates to desktop-absence + status-bar assertions plus a mobile-context footer case (file kept, not deleted) | The footer still exists (mobile); the spec's subject moved, not vanished | S:65 R:90 A:80 D:75 |
| 6 | Confident | The bottombar (compose strip) row lives inside the stage's content column with the stage gap as its seam | Keeps the strip scoped to the content column as today; a full-width strip under the sidebar would be a layout change the mock never showed | S:60 R:80 A:70 D:65 |

6 assumptions (0 certain, 6 confident, 0 tentative).
