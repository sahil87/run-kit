# Plan: Shell Stage + Status Bar — the Composed Frame

**Change**: 260814-ldbs-shell-stage-status-bar
**Intake**: `intake.md`

## Requirements

### Shell: stage + status-bar grid

#### R1: Shell composes a single-row stage and a full-width status-bar row
`components/shell/shell.tsx` SHALL gain a `statusBarChildren` slot (the `sidebarChildren` mirror), rendered on BOTH desktop grids as a new bottom row spanning ALL columns (sidebar included); the mobile grid is unchanged and never renders it. On the `hasRightPanel` branch (`!isMobile && !!rightPanelChildren`) the non-sidebar region becomes a **nested stage grid**: `bg-bg-inset p-[6px] gap-[6px]`, single row, columns `1fr auto`, areas `"content rightpanel"`, wrapping Shell's `{children}` and the rightpanel aside (consumers' `gridArea` styles rebind to the nested template — areas bind to direct children). A bare grid-template-areas flip MUST NOT be used (grid `gap` applies to all tracks and would open a seam against the sidebar, which stays attached via its `border-r`/drag-handle seam; the top bar stays attached, the stage's 6px top padding being the gap below it). When `rightPanelVisible === false` the stage template flips to `1fr` (dropping the `auto` column) while the aside stays MOUNTED and hidden — an explicit `auto` track keeps its column-gap even with a hidden item, which would strand a 6px gap. `ShellGridRefContext` stays on the outer grid. The no-`rightPanelChildren` desktop grid keeps its current content/bottombar shape apart from the added status-bar row.

- **GIVEN** the desktop terminal route
- **WHEN** Shell renders
- **THEN** the tile grid and rail card float on one continuous inset ground, the status bar spans the full frame width below (under the sidebar too, flush T-junction, no gap, no radius), and no bottom-bar row exists on fine pointers

- **GIVEN** the rail is collapsed (`runkit-rail-open`)
- **WHEN** the stage renders
- **THEN** the tile grid takes the full stage width, no empty track or stray gap remains, and the rail aside is still mounted

- **GIVEN** the board/host/server routes (no `rightPanelChildren`) or mobile
- **WHEN** Shell renders
- **THEN** the grids match today's byte-for-byte apart from the desktop status-bar row (mobile: fully unchanged)

#### R2: The rail becomes a detached card, chrome only
`components/right-panel.tsx:74` SHALL drop `border-l border-border` and gain `rounded-md rk-card-border bg-bg-primary`. Width (`w-[46px]`), every behavior (toggles, lit states, dots, disabled-at-3 tooltip, `⇧⌘.`, collapse pref) and the `right-panel-rail` testid are unchanged. The rail stays purely surface toggles — no meta cluster.

- **GIVEN** the terminal route with the rail visible
- **WHEN** it renders
- **THEN** the rail is a rounded dimmed-border card from 6px below the top bar to 6px above the status bar

### Bottom bar: pointer-gated deletion

#### R3: BottomBar does not render on fine pointers; coarse keeps today's bar verbatim
On fine pointers `BottomBar` SHALL NOT render at either site — the app-shell footer (`app.tsx:3694`) and the board twin (`board-page.tsx` ~1057). On coarse pointers (mobile AND desktop-width touch devices) the bar renders exactly as today: attached `border-t-[3px] border-border` frame (`bottom-bar.tsx:357`), key chips, all behavior — no card treatment anywhere. The gate MUST reuse the existing coarse-pointer seam (the `coarse:` variant infrastructure or `isMobileViewport()`'s pointer half — no new one-off media query) and MUST preserve the PR #598 property: no caller-side fixed-height wrapper or effect survives when the bar is gone (frames and effects live inside/behind the same gating predicate). <!-- rework cycle 1 (review must-fix 2): the original "width decides the status bar, pointer decides the chip bar — iPad renders BOTH" premise was WRONG for this codebase: `useIsMobile()` is width-OR-coarse, so a coarse desktop-width device renders the MOBILE grid app-wide (no desktop-layout-with-coarse-pointer state exists). Revised rule below. --> The revised device rule: **coarse = the mobile experience everywhere** — a coarse desktop-width device (iPad) gets the mobile grid, today's chip bar, the drawer panels, and NO status bar; the status bar exists exactly where the desktop grids exist (`!isMobile`), and ALL routes must agree on that gate (the host overview page's width-only `hidden sm:block` gate aligns to `!isMobile`).

- **GIVEN** a fine-pointer desktop on the terminal or board route
- **WHEN** the shell renders
- **THEN** no BottomBar exists in the DOM and no reserved height remains

- **GIVEN** a coarse-pointer device at any width
- **WHEN** the shell renders
- **THEN** the bar renders byte-identical to today

### Status bar

#### R4: A new StatusBar component renders window and host segments from existing state
A NEW `components/status-bar.tsx` SHALL render the attached strip: ~24px, `border-t border-border bg-bg-primary`, mono ~10.5–11px, `role="status"`-appropriate semantics. Segments (presentational; ALL values arrive via props/context from EXISTING derivations — `sidebar/registers.ts` resolvers, the PANE-panel register sources (`sidebar/status-panel.tsx`), host metrics (`sidebar/host-panel.tsx` sources), the shared PR vocabulary (`pr-status-model.ts`) — nothing re-derived, no new fetches):
- **Left (window cluster — terminal route only)**: `tmx <a/b %id>` · `cwd <basename>` (full path in tooltip) · `⑂ <branch>` · `out <agent · state>` · `agt <state + age>` (status-dot hue vocabulary) · `fab <id slug>` · the PR register (click → open PR).
- **Right (host cluster — every desktop route)**: `cpu N% · mem X/YG · ld .NN` (compact text; the cpu sparkline + mem bar graphs render in a hover FLYOUT on this segment — the row-flyout-card pattern) · `<server>` · `<host> v<version>` · connection dot · `⌘K` hint (click → palette) · `a` hint (click → open compose).
The bar is a **current-window mirror, never a rollup**: no aggregation, no attention logic (the status pyramid machinery is untouched). Every clickable segment has palette parity. Mobile renders no status bar; the drawer keeps the panels (R6).

- **GIVEN** the desktop terminal route
- **WHEN** the status bar renders
- **THEN** both clusters show, values matching the same registers the old PANE/HOST panels showed, with the graphs reachable via the host-segment flyout

- **GIVEN** a desktop board/host/server route
- **WHEN** the status bar renders
- **THEN** only the host cluster (+ hints) shows

#### R5: Overflow degrades by ladder, never scrolls
The bar SHALL NOT scroll horizontally. Three stages: (1) flexible segments truncate in place (`min-w-0 truncate` on branch/fab-slug/cwd; `out` drops the agent name; labels degrade to glyphs); (2) whole segments drop by priority at deterministic width thresholds (breakpoint or container-query driven — no JS measurement): left-cluster survival order `PR → fab → agt → git → out → tmx → cwd` (status-pyramid-ordered; last listed dies first), right cluster drops hints first, then `ld → cpu/mem → version`, the connection dot last; clusters degrade independently; (3) a trailing `…` overflow chevron (the top-bar `menuOnly` pattern) lists every dropped segment. Only the ~700–1100px band must survive — below it the mobile branch renders no bar.

- **GIVEN** a ~800px-wide desktop window on the terminal route
- **WHEN** the bar renders
- **THEN** low-priority segments are absent from the strip, present under the `…` chevron, and nothing scrolls

### Sidebar

#### R6: PANE/HOST panels become drawer-only
The desktop sidebar SHALL stop rendering the PANE panel (`sidebar/status-panel.tsx`) and HOST panel (`sidebar/host-panel.tsx`) — gated, NOT deleted: the mobile drawer keeps both byte-identical. The session list absorbs the freed height. Panel components and their tests stay; only the desktop render path changes.

- **GIVEN** the desktop sidebar
- **WHEN** it renders
- **THEN** no PANE/HOST panels appear and the sessions region extends to the sidebar bottom

- **GIVEN** the mobile drawer
- **WHEN** it opens
- **THEN** both panels render exactly as today

### Compose

#### R7: Compose opener and closer relocate
The status bar's `a` hint SHALL open the compose strip (same action as the killed bar's toggle; the `compose-toggle` chord and palette entry are unchanged). The EXPANDED compose strip (`components/compose-strip.tsx`) SHALL gain an `a|` close affordance rendered next to the attach (📎) button — clicking it closes the strip. Strip chrome, the in-tile dock, and all send behavior are otherwise unchanged.

- **GIVEN** the compose strip is open on desktop
- **WHEN** the user clicks the `a|` button beside attach
- **THEN** the strip closes (same as the toggle/chord)

### Surface layout

#### R8: The tile grid cedes its inset to the stage
`components/surface-layout.tsx:1101` (`relative flex-1 min-h-0 min-w-0 grid gap-[6px] p-[6px] bg-bg-inset`) SHALL drop `p-[6px]` and `bg-bg-inset`, keeping `gap-[6px]` and ALL divider/sash/intersection machinery — including the #603 window-level drag listeners, which this change must not disturb. Net tile geometry unchanged (6px from every edge via the stage). Mobile branch untouched. The component doc comment's chrome description updates.

- **GIVEN** a desktop multi-tile layout on the stage
- **WHEN** it renders and a seam is dragged
- **THEN** tiles sit 6px from stage edges with single seams, and drag behavior (incl. #603 semantics) is unchanged

### Non-Goals

- Sidebar/top-bar card-ification (full Tier 2) — both stay attached; no sidebar bottom gap or corner radius (rejected half-card).
- A mobile status bar; any mobile chrome change at all.
- Card chrome for the coarse-pointer bottom bar.
- Stage-gap drag affordances (static seams; rail/bar/status aren't resizable).
- Settings gear relocation (stays in the top bar).
- New derivations or fetches for status data (mirror only).

### Design Decisions

#### Two-family chrome vocabulary
**Decision**: Attached frame (top bar, sidebar, status bar — flush, 1px seams, square) vs floating cards (tiles, rail — 6px gaps, 6px radius, 55% dimmed borders). The status bar joins the frame; the sidebar ends flush above it.
**Why**: One organizing rule keeps every seam decidable; a scrolling bar, a half-card sidebar corner, or a stage-scoped status bar each break it.
**Rejected**: sidebar bottom gap + rounded corner (half-card); status bar starting right of the sidebar (stage-scoped strip carrying host-global segments); scrollable overflow.
*Introduced by*: 260814-ldbs-shell-stage-status-bar

#### Pointer decides the chip bar; width decides the status bar
**Decision**: BottomBar existence is pointer-gated (fine: none; coarse: verbatim); the status bar is layout-gated (desktop widths only).
**Why**: `isMobileViewport()` is width-OR-coarse — a viewport gate would strand iPads at desktop width without Ctrl/Tab/F-keys; two independent gates give every device exactly what it can use.
**Rejected**: viewport-gated bar removal; carding the coarse bar.
*Introduced by*: 260814-ldbs-shell-stage-status-bar

#### The stage is a nested grid
**Decision**: Shell nests the stage grid inside the non-sidebar region, wrapping `{children}` + the rightpanel aside.
**Why**: grid `gap` cannot scope to a subset of tracks; nesting scopes the stage seams exactly and consumers' `gridArea` styles rebind without churn.
**Rejected**: bare template flip (sidebar gap); wrapping in app.tsx (splits grid ownership).
*Introduced by*: 260814-ldbs-shell-stage-status-bar

## Tasks

### Phase 2: Core Implementation

- [x] T001 Restructure `app/frontend/src/components/shell/shell.tsx`: add the `statusBarChildren` slot rendered as a full-width bottom row on both desktop grids (never mobile); on the `hasRightPanel` branch nest the single-row stage grid (`bg-bg-inset p-[6px] gap-[6px]`, `1fr auto`, `"content rightpanel"`) wrapping `{children}` + the rightpanel aside, with the collapse branch dropping the `auto` column while the aside stays mounted-hidden; keep the no-panel and mobile grids otherwise byte-identical; `ShellGridRefContext` on the outer grid; update the doc comment <!-- R1, R2 -->
- [x] T002 <!-- rework: must-fix 1 — useMetrics() ?? useHostMetrics() conditional hook (fix per HostPanel precedent: call both unconditionally, coalesce); should-fix — overflow chevron must list EVERY dropped segment incl. hint chips + version; should-fix — extract shared loadPercent helper (host-metrics.tsx LoadLine formula) --> Create `app/frontend/src/components/status-bar.tsx` (+ colocated `status-bar.test.tsx`): presentational strip with left window cluster + right host cluster, segment tooltips, host-metrics hover flyout (row-flyout-card pattern), PR/⌘K/compose click seams, and the 3-stage degradation ladder with the `…` overflow chevron (`menuOnly` rows; deterministic width thresholds) <!-- R4, R5 -->
- [x] T003 [P] Rail card chrome in `app/frontend/src/components/right-panel.tsx:74`: swap `border-l border-border` for `rounded-md rk-card-border bg-bg-primary` <!-- R2 -->
- [x] T004 [P] Pointer-gate BottomBar (`app/frontend/src/components/bottom-bar.tsx`, both call sites incl. board twin `board-page.tsx` ~1057): fine pointers render nothing (gate + frame + effects behind one predicate, PR #598 property; reuse the existing coarse-detection seam); coarse renders today's bar verbatim <!-- R3 -->
- [x] T005 [P] Add the `a|` close affordance next to the attach button in the EXPANDED `app/frontend/src/components/compose-strip.tsx`; wire it to the existing close path <!-- R7 -->
- [x] T006 [P] Gate the PANE panel (`sidebar/status-panel.tsx` usage) and HOST panel (`sidebar/host-panel.tsx` usage) to the mobile drawer render only; the desktop sidebar's session region absorbs the height <!-- R6 -->
- [x] T007 <!-- rework: must-fix 2 — align host-overview-page.tsx:489 status-bar gate from width-only (hidden sm:block) to !isMobile so all routes agree (coarse = mobile experience, no status bar) --> Wire it in `app/frontend/src/app.tsx`: fill `statusBarChildren` (window cluster on the terminal route via the existing register/PR/agent state, host cluster on every desktop route), compose-opener + palette-parity entries for clickable segments, remove the fine-pointer footer BottomBar render, reconcile the `fixedWidth` inset/primary split (~3528–3541) against the stage ground <!-- R1, R3, R4, R7 -->
- [x] T008 Drop `p-[6px]` and `bg-bg-inset` at `app/frontend/src/components/surface-layout.tsx:1101` (keep `gap-[6px]`; leave the #603 drag machinery untouched); update the component doc comment chrome description <!-- R8 -->

### Phase 3: Integration & Tests

- [x] T009 <!-- rework: cover the fixes — coalesced-hooks StatusBar renders across metric-arrival re-renders; host-page gate parity (!isMobile); overflow menu lists every dropped segment --> Update/extend unit tests: `shell.test.tsx` (stage/collapse/status-row/no-panel/mobile templates), `bottom-bar.test.tsx` (pointer gate, no reserved height), `surface-layout.test.tsx` (ceded inset), sidebar tests (panels drawer-only), plus T002's new `status-bar.test.tsx` (segments per route, ladder thresholds, flyout, click seams) <!-- R1, R3, R4, R5, R6, R8 -->
- [x] T010 <!-- rework: add the coarse-desktop-width seam assertion (hasTouch at desktop width => mobile experience, no status bar — the kb-sim pattern) where it fits; fix surface-layout.spec.ts:506-558 mixed indentation; touch the six .spec.md companions for the nav-scoped Connected-locator edits --> e2e: flip `tests/e2e/right-panel.spec.ts` (~411) reversals (rail card ends above the status bar; no desktop bottom bar) + `right-panel.spec.md`; add status-bar coverage (presence + no-bottom-bar on desktop, window-cluster only on terminal route, one width-sweep degradation case) in the fitting spec file with its `.spec.md`; adjust `surface-layout.spec.ts` if it asserts grid padding <!-- R1, R3, R4, R5 -->
- [x] T011 <!-- rework: re-run all gates after the fixes --> Verification gates, sequentially: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e "right-panel"`, `just test-e2e "surface-layout"`, plus the spec file touched in T010 if distinct; fix fallout <!-- all -->

## Execution Order

- T001 first (the stage + slot exist before anything fills them); T003/T004/T005/T006 are `[P]`; T002 before T007 (app.tsx fills the component); T008 after T001
- T009/T010 after implementation; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Desktop terminal route renders the nested single-row stage + full-width status-bar row; sidebar/top-bar seams unchanged; board/host/server desktop grids differ only by the status-bar row; mobile fully unchanged
- [x] A-002 R2: Rail is a `rounded-md rk-card-border bg-bg-primary` card, `w-[46px]`, all behavior + testid intact
- [x] A-003 R3: Fine-pointer desktops render no BottomBar at either site with no reserved height; coarse devices render today's bar byte-identical
- [x] A-004 R4: StatusBar renders both clusters on the terminal route, host-cluster-only elsewhere, all values from existing resolvers (no new derivation), graphs in the host-segment flyout — rework cycle 1 verified: both metrics hooks are called unconditionally and coalesced after (status-bar.tsx:434-436, the HostPanel precedent), with a rerender-across-metric-arrival regression test in status-bar.test.tsx and no hooks-order console error in the targeted e2e output
- [x] A-005 R6: Desktop sidebar renders no PANE/HOST panels; the mobile drawer renders both unchanged
- [x] A-006 R7: The status-bar `a` hint opens compose; the expanded strip's `a|` beside attach closes it; chord/palette unchanged
- [x] A-007 R8: Tile grid keeps `gap-[6px]`, loses `p-[6px]`/`bg-bg-inset`; net geometry 6px from every edge, single seams

### Behavioral Correctness

- [x] A-008 R1: Rail collapse leaves no stray gap or empty track; aside stays mounted
- [x] A-009 R8: Seam drags (incl. #603's window-level listener semantics) behave identically pre/post inset cede
- [x] A-010 R4: The status bar performs no aggregation and adds no attention logic (mirror-not-rollup); status-pyramid surfaces untouched

### Scenario Coverage

- [x] A-011 R5: At a narrow desktop width the ladder drops the specified segments in pyramid order and the `…` chevron lists them; nothing scrolls
- [x] A-012 R1–R5: Unit + e2e cover the flipped reversals, status-bar presence/degradation, and the pointer gate; every touched `.spec.ts` has its `.spec.md` updated in the same commit — re-verified rework cycle 1: the six locator-only edits (code-folder-latch, connection-budget, create-server-waiting, session-reorder, sessions-scope-toggle, web-view-lens) now carry the nav-scoped-`Connected` note in their `.spec.md` companions

### Edge Cases & Error Handling

- [x] A-013 R3/R4: Coarse desktop-width (iPad) renders the MOBILE experience — chip bar, drawer panels, NO status bar — and ALL routes agree on the `!isMobile` status-bar gate (host overview page aligned from width-only `hidden sm:block`); covered by a hasTouch-at-desktop-width assertion <!-- rework cycle 1: requirement revised — the original "renders BOTH" premise contradicted useIsMobile widthORcoarse convention -->
- [x] A-014 R4: A route with no live window data (host/server) renders the host cluster without errors; missing registers render nothing rather than placeholders
- [x] A-015 R1: `fixedWidth` mode shows no double grounds — the centered column sits on the stage ground

### Code Quality

- [x] A-016 Pattern consistency: StatusBar follows the presentational-by-contract pattern (state in app.tsx, props in); chrome reuses `rk-card-border`/`rounded-md`; comments match surrounding density
- [x] A-017 No unnecessary duplication: registers/PR/host values reuse `sidebar/registers.ts`, panel sources, and `pr-status-model.ts`; the panels are gated, not forked; one stage template definition — rework cycle 1: `loadPercent` is now the shared `normalizeLoadPercent` helper in host-metrics.tsx (one formula, two consumers); one minor dup remains filed as a should-fix (the tmx/cwd identity-row formatting inline-parallels `status-panel.tsx`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/bottom-bar.tsx` — the 260811-0f3d compose education hint block (`a▏ compose — type here, send to the pane`): ALREADY removed by this change (it was `!coarse`-gated, so the coarse-only pointer gate made it unrenderable); noted here for the record, nothing left to delete.
- `app/frontend/src/components/sidebar/index.tsx` `SidebarFooter` desktop readouts (connection dot + version line) — now duplicated by the status bar's right cluster on every desktop route; the drawer still needs the footer, so this is a follow-up decision (gate the desktop render or accept the duplication), not an auto-delete.
- None otherwise — the PANE/HOST panels, `shortenPath`, and `BottomPanels` all survive as the drawer's mobile home (gated, not unused), and every new symbol (`StatusBar`, `bottomBarChildren`/`statusBarChildren`) has call sites.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shell owns the status bar via a `statusBarChildren` slot on both desktop grids (the `sidebarChildren` mirror); app.tsx fills it | Matches the established slot pattern; keeps grid ownership in Shell | S:70 R:80 A:85 D:75 |
| 2 | Confident | The degradation ladder uses CSS breakpoints/container queries with the chevron's `menuOnly` rows rebuilt from the same segment model — no ResizeObserver measurement | Deterministic thresholds keep e2e simple (the intake's stated preference); the top-bar ladder precedent | S:70 R:80 A:75 D:70 |
| 3 | Confident | The host-metrics flyout reuses the row-flyout-card component/pattern rather than a new popover | Anti-duplication; the flyout already renders register-style content on hover | S:60 R:85 A:75 D:70 |
| 4 | Confident | Window-cluster data flows through app.tsx from the SAME SSE-derived window record + register resolvers the sidebar uses; no new context provider unless prop-drilling proves unreasonable at implementation | Constitution X + presentational contract; exact seam is implementation latitude | S:60 R:80 A:75 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
