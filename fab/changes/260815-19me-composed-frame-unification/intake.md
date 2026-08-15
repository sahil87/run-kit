# Intake: Composed-Frame Unification

**Change**: 260815-19me-composed-frame-unification
**Created**: 2026-08-15

## Origin

Design discussion session on the desktop chrome (conversational). The user approved an HTML mock (built at the session scratchpad `sidebar-card-mock.html`, presented via rk) showing all four routes (Terminal / Board / Server / Host) with three composed ideas applied. This is a user-approved decision, ready for implementation — not an open exploration.

> Composed-frame unification — sidebar as floating card, universal stage ground, right-rail retirement into the top bar, desktop sidebar-footer removal. Three approved changes plus their route consequences, captured from the approved mock.

## Why

1. **Redundant chrome on desktop.** The desktop sidebar footer duplicates surfaces the frame already carries: the full-width status bar owns the connection dot (never drops at any width) and version (≥700px with overflow-row degradation), and the update path is covered by the top-bar UpdateChip (actionable, per-version dismissible) plus the overflow menu's version row (the documented update surface). Keeping a third copy of dot + version + update hint in the sidebar wastes vertical space and splits attention.

2. **Two-family inconsistency and the square T-junction.** The current two-family rule (from change 260814-ldbs) welds the sidebar to the frame (square, `border-r`, flush on the status bar) while tiles float as cards on a `bg-bg-inset` stage — but the stage exists only when `rightPanelChildren` is passed (terminal route). Each route composes its ground differently: board panes sit square on the primary background, the server column is square and edge-to-edge-height, the host page floats cards on `bg-bg-primary`. Unifying on one continuous inset ground with the sidebar as a card resolves the old square sidebar/status-bar T-junction and gives all four routes one visual floor.

3. **The 40px rail is a whole chrome column for three buttons.** The vertical right rail exists solely to host three surface toggles. Retiring it into the top-bar right cluster wins back 40px of terminal width and deletes a chrome column plus its collapse machinery (`rightPanelVisible`, the display-hide never-unmount dance, the `auto`-track drop) — Constitution IV (minimal surface area).

If we don't do this: the chrome stays visually inconsistent across routes, desktop carries redundant status surfaces, and the rail's collapse plumbing remains in Shell for a column that no longer earns its width.

**Alternatives rejected** (from the discussion):
- Keeping the rail as the "top-bar cluster's vertical twin" — rejected: retiring it wins back 40px, kills a whole chrome column (Constitution IV).
- Keeping a desktop footer for the update hint — rejected: UpdateChip + overflow version row suffice.

## What Changes

### 1. Desktop sidebar footer removal

`SidebarFooter` (app/frontend/src/components/sidebar/index.tsx ~line 1787) today holds a connection dot, a click-to-copy version readout, and a quiet update hint. On desktop all three are redundant (see Why). **Decision**: render `SidebarFooter` only when `isMobile` — exactly like the `BottomPanels` gate two lines above it (sidebar/index.tsx:1680, `{isMobile && (...)}`).

- **Mobile drawer keeps the footer byte-identical.** No status bar exists on mobile; the drawer is the sole home of dot + version there. Mobile e2e locates the Connected dot inside the closed drawer — that contract is untouched.
- **Test fallout**: footer unit tests in sidebar/index.test.tsx (~lines 1963–1986) need a mobile-context render; any desktop e2e touching the sidebar dot shifts to the status-bar dot.

### 2. Sidebar becomes a floating card + the stage ground goes universal

Today the Shell (app/frontend/src/components/shell/shell.tsx) has a two-family rule from change 260814-ldbs: attached frame chrome (top bar, sidebar with `border-r`, status bar — square, welded) vs floating cards (tiles + the rail card on the nested "stage" grid's `bg-bg-inset` ground with 6px padding/gap). The stage exists ONLY when `rightPanelChildren` is passed (terminal route).

**Decision**: the sidebar crosses families and becomes a floating card — `rounded-md` + the shared 55%-dimmed `rk-card-border` + `bg-bg-primary` — and the stage/inset ground is promoted from a `hasRightPanel` special case to Shell's UNIVERSAL desktop composition: on every desktop route the grid's content region (and the sidebar) float as cards on one continuous `bg-bg-inset` ground with 6px padding/gap. This deletes the `hasRightPanel` template fork in shell.tsx (currently: `hasRightPanel` at shell.tsx:209, template switch ~224, nested stage grid ~230–239).

Consequences per route:

- **Terminal** (`/$server/$window`): sidebar card + tiles on the shared ground (tiles already are cards). The sidebar's drag-resize handle needs rework: today the handle bar IS the seam and the aside drops `border-r` when a handle is present (shell.tsx:255); with a rounded card edge + 6px gap the handle must live in/over the gap without doubling the seam. **Design intent: keep drag-resize working; exact handle treatment is an implementation decision** (explicitly delegated by the user).
- **Board** (`/board/$name`): the route today passes no `rightPanelChildren` so it has NO stage — the pane row (`gap-1 p-1`, 4px, board-page.tsx DesktopRow ~line 1286) sits directly on the primary background, and board panes are square (border `rk-card-border` since 260814-011r but no rounding, board-pane.tsx ~170). **Decision**: board panes pick up `rounded-md`, and the row adopts the universal stage ground (gap moves 4px→6px). **Status borders unchanged**: waiting keeps the 3px pulsing amber seam, focused keeps the accent border + shadow ring — status signals stay full-strength on the rounded card.
- **Server** (`/$server`): already renders on `bg-bg-inset` (`fixedWidth` mode in app.tsx ~3570) with a centered 900px `bg-bg-primary` column that is square and edge-to-edge-height. **Decision**: the column becomes a rounded card (`rounded-md` + dimmed `rk-card-border`), framed by the stage's 6px inset.
- **Host** (`/`): no sidebar (unchanged — changes 1–2 don't apply; `/` renders ServerListPage/host overview with NO sidebar), tiles already rounded `bg-card` cards. Only the ground flips from `bg-bg-primary` to `bg-bg-inset` so all four routes share one floor (host-overview-page.tsx:240).
- **Status-bar junction**: the sidebar no longer sits flush on the status bar; as a card it floats 6px above it (this resolves the old square T-junction). **Top bar and status bar REMAIN attached square frame chrome — the frame family is never rounded.**
- **Mobile**: byte-identical. The mobile drawer, mobile template (no statusbar row), and drawer panels are untouched.
- **Documentation**: the two-family rule comments in shell.tsx must be updated to the new model — frame = top bar + status bar only; sidebar joins the card family.

### 3. Right-rail retirement into the top bar

The 40px vertical rail (app/frontend/src/components/right-panel.tsx — the whole component) is removed; its surface toggles (`>_` tty, `://` web, `{}` code — glyphs from `SURFACE_GLYPH`) move into the top-bar right cluster as a bordered sub-group with a divider, sitting LEFT of the existing terminal-route chips (Open · Split ▾ · ⟳ · gear · chevron). Terminal route only, exactly like the rail today.

**Exact button grammar preserved**:
- Lit green (`aria-pressed`, accent-green border/text/10% bg) = open tile
- Corner availability dot
- Unlit buttons disabled at 3 open tiles with the "Close a tile first" tooltip (Tip wrapping a span so disabled buttons still tip)
- `SURFACE_RAIL_HIDDEN` surfaces (currently chat) still render no toggle
- The caller's `togglePanel` mutation semantics unchanged: unlit→addSurface (1→2 split-h / 2→3 main-left), lit→closeSurface, closing last tile is a null no-op

Consequences:
- The top-bar **rail-toggle chip** (which collapsed/expanded the rail, ~top-bar.tsx:627) is removed — the toggles themselves are now always visible on the terminal route. Its companions go with it: the `Panel: Toggle rail` palette action (app.tsx:2716, `panel-rail-toggle`) and the persisted `railOpen` ChromeContext state become dead and are removed.
- Shell's `rightPanelChildren` / `rightPanelVisible` props and the collapse dance (display-hide, never-unmount, the `auto`-track drop) are deleted — the never-unmount P3 contract concerned the rail card's iframes context; layout TILES live in the content area and already survive independently (they were never inside the rail).
- **Top-bar width pressure**: the right cluster gains 3 chips; the overflow-menu degradation ladder needs a **Tiles section** so narrow widths still reach the toggles. Follow the existing degradation-ladder pattern in top-bar-overflow-menu.tsx.
- **e2e**: tests depend on the `right-panel-rail` testid (right-panel.tsx:69) — tests must move to the new top-bar group; keep an equivalent stable testid on the group.
- right-panel.test.tsx is removed with the component (its assertions migrate to the new top-bar group's tests where still meaningful).
- Palette entries for `Layout: Add/Close <Surface>` already exist and are unaffected (keyboard-first, Constitution V, stays covered).

## Affected Memory

- `run-kit/ui/sidebar`: (modify) footer becomes mobile-only; sidebar joins the card family (rounded, dimmed card border, floats on the stage ground)
- `run-kit/ui/routes-and-shell`: (modify) shell grid — universal desktop stage ground, `hasRightPanel` fork deleted, `rightPanelChildren`/`rightPanelVisible` props removed, new two-family model (frame = top bar + status bar only)
- `run-kit/ui/lenses-and-layout`: (modify) right-rail toggles relocate to the top bar; rail component and collapse machinery retired; toggle grammar/`togglePanel` semantics unchanged
- `run-kit/ui/top-bar`: (modify) new bordered surface-toggle sub-group in the right cluster, rail-toggle chip removed, overflow-menu Tiles section in the degradation ladder
- `run-kit/ui/boards`: (modify) board panes rounded, pane row on the universal stage ground (gap 4px→6px)
- `run-kit/ui/keyboard-and-palette`: (modify) `Panel: Toggle rail` palette action removed
- `run-kit/ui/visual-design`: (modify) card-family membership and the universal `bg-bg-inset` floor across all four routes

## Impact

**Affected code (non-exhaustive)**:
- `app/frontend/src/components/shell/shell.tsx` — universal stage ground, sidebar card, `hasRightPanel`/`rightPanelChildren`/`rightPanelVisible` deletion, handle rework, two-family comment rewrite
- `app/frontend/src/components/sidebar/index.tsx` — `SidebarFooter` gated on `isMobile` (+ sidebar/index.test.tsx footer tests move to a mobile-context render)
- `app/frontend/src/components/right-panel.tsx` — component removed (+ right-panel.test.tsx removed)
- `app/frontend/src/components/top-bar.tsx` + `top-bar-overflow-menu.tsx` — new surface-toggle group, Tiles overflow section, rail-toggle chip removal
- `app/frontend/src/app.tsx` — rightPanel wiring, `railOpen`/palette-action removal, fixedWidth server column card
- `app/frontend/src/components/board/board-page.tsx` (DesktopRow ground/gap) + `board/board-pane.tsx` (rounded)
- `app/frontend/src/components/host-overview-page.tsx` — ground flip (`bg-bg-primary`→`bg-bg-inset`)
- Affected e2e specs + their `.spec.md` companions (Constitution: Test Companion Docs — any modified `*.spec.ts` updates its sibling `*.spec.md` in the same commit)

**Constraints**:
- UI changes should include Playwright e2e where possible (code-quality).
- Minimal surface area (Constitution IV); keyboard-first (Constitution V) — palette entries for Layout: Add/Close surfaces already exist and are unaffected.
- Board route sidebar mounts with `currentServer === null`; `/` renders the host page with NO sidebar — don't assume the sidebar exists on every route.
- Run tests through `just` recipes only (never raw playwright/go test/pnpm test): `just test-backend`, `just test-frontend`, `just test-e2e` (port 3020, isolated tmux server).
- Known pre-existing e2e flakes that must NOT be attributed to this change: "Maximum update depth exceeded" console errors; window-heading history-arrows forward-nav timeout.

Backend: untouched. Mobile: byte-identical.

## Open Questions

- None — the design was approved via mock; the one open point (exact drag-resize handle treatment in the 6px gap) was explicitly delegated to implementation by the user.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Desktop sidebar footer removed by gating `SidebarFooter` on `isMobile`, mirroring the `BottomPanels` gate (sidebar/index.tsx:1680); mobile drawer footer byte-identical | Discussed — user approved the mock; desktop redundancy fully mapped (status-bar dot/version, UpdateChip, overflow version row) | S:95 R:85 A:90 D:95 |
| 2 | Certain | Sidebar joins the card family (`rounded-md` + 55%-dimmed `rk-card-border` + `bg-bg-primary`); stage `bg-bg-inset` ground with 6px padding/gap becomes Shell's universal desktop composition; `hasRightPanel` template fork deleted; top bar + status bar stay square attached frame | Discussed — user approved the mock showing all four routes; frame-family boundary stated explicitly | S:95 R:70 A:90 D:90 |
| 3 | Certain | Route consequences: board panes `rounded-md` + row on stage ground (gap 4px→6px, status borders full-strength); server 900px column becomes a rounded card; host ground flips to `bg-bg-inset`; mobile byte-identical | Discussed — each route's treatment shown in the approved mock with exact values | S:95 R:75 A:90 D:90 |
| 4 | Certain | Rail retired into a bordered top-bar sub-group (divider, left of terminal chips, terminal route only) with exact button grammar preserved (aria-pressed lit green, availability dot, disabled-at-3 Tip-wrapped tooltip, SURFACE_RAIL_HIDDEN, unchanged `togglePanel` semantics); rail-toggle chip + Shell rightPanel props/collapse dance deleted; overflow ladder gains a Tiles section; stable testid kept on the group | Discussed — user approved; grammar and mutation semantics enumerated verbatim in the design | S:95 R:65 A:85 D:90 |
| 5 | Confident | `Panel: Toggle rail` palette action (app.tsx:2716) and the persisted `railOpen` ChromeContext state are removed with the rail | Not explicitly discussed, but both are dead once toggles are always visible — leaving them strands a no-op action and orphaned persisted state | S:60 R:85 A:85 D:80 |
| 6 | Confident | Drag-resize handle reworked to live in/over the 6px gap without doubling the seam; exact affordance decided at apply, reusing the existing gap-seam tile-chrome precedent | Discussed — user explicitly delegated the exact treatment as an implementation decision; drag-resize must keep working | S:60 R:80 A:60 D:40 |
| 7 | Confident | Overflow-menu Tiles section follows the existing degradation-ladder pattern in top-bar-overflow-menu.tsx; exact breakpoint thresholds decided at apply within that pattern | Discussed — pattern named in the design; ladder mechanics are established in the file | S:70 R:90 A:80 D:70 |
| 8 | Confident | Human-curated spec docs describing the rail (docs/specs/right-panel.md, surface-layout.md rail sections) are NOT edited by this change; hydrate captures the new reality in memory, spec staleness is flagged for a human docs pass | Specs are human-curated by charter (docs/specs/index.md ownership note); hydrate owns memory, not specs | S:40 R:90 A:75 D:75 |
| 9 | Certain | e2e migration contract: tests on the `right-panel-rail` testid move to the new top-bar group's equivalent stable testid; desktop sidebar-dot e2e move to the status-bar dot; every modified `*.spec.ts` updates its sibling `*.spec.md` in the same commit | Constitution (Test Companion Docs) + migration paths named explicitly in the design | S:85 R:90 A:90 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
