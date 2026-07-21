# Plan: Sessions-Pane Server-Group Header — Color-Picker and Close Buttons

**Change**: 260721-x4sf-sessions-header-color-close-actions
**Intake**: `intake.md`

## Requirements

### Sidebar: Server-Group Header Action Cluster

#### R1: Three-button cluster in palette → plus → close order
The `ServerGroupInner` header bar (`app/frontend/src/components/sidebar/index.tsx`) MUST render a three-button action cluster at the right end of the tinted header container, in this fixed left-to-right DOM order: (1) color palette (`PaletteIcon`), (2) `+` new-session, (3) `✕` close. The expand/collapse toggle button MUST keep `flex-1` and remain the dominant click target; the cluster occupies only the right-end slot where `+` sits today.

- **GIVEN** a server group header in the SESSIONS pane
- **WHEN** the header renders
- **THEN** three `<button>` elements appear after the toggle button, in DOM order palette, plus, close
- **AND** the toggle button retains `flex-1 min-w-0` and its existing `Expand/Collapse {server} sessions` aria-labels

#### R2: Palette button opens a portalled SwatchPopover wired to the shared color seam
The palette button MUST toggle a `SwatchPopover` (no `onSelectMarker` — pure color grid). A swatch pick MUST invoke the single shared server-color-change handler (optimistic `setServerColors` update + `setServerColorApi` POST + toast on failure), lifted from the inline handler currently passed to `ServerPanel`, so `ServerGroup` and `ServerPanel` funnel through ONE implementation. The popover MUST be portalled to `document.body` with `position: fixed` coordinates anchored at the palette button (flip-above when it would overflow the viewport bottom), escaping the session list's `overflow-y: auto` clip.

- **GIVEN** a server group header for server `alpha`
- **WHEN** the palette button is clicked and a swatch is picked
- **THEN** the shared handler updates `serverColors` optimistically (header tint repaints immediately) and calls `setServerColorApi("alpha", <legacy descriptor>)`
- **AND** the popover DOM node is a child of `document.body` (portalled), not of the header container
- **AND** picking a swatch (or Escape/outside click) closes the popover

#### R3: Close button routes through the lifted kill-confirmation flow
The `✕` button MUST call the existing `onKillServer(server)` prop (forwarded from `Sidebar` into `ServerGroup`/`ServerGroupInner`), inheriting the parents' confirmation dialogs (`app.tsx` `killServerTarget` dialog, `board-page.tsx` equivalent), daemon warning, navigation-after-kill, and API call. NO new dialog, handler, or API surface SHALL be introduced.

- **GIVEN** a server group header for server `alpha`
- **WHEN** the `✕` button is clicked
- **THEN** `onKillServer("alpha")` is invoked exactly once
- **AND** no kill API call happens directly from the sidebar (confirmation is the parent's)

#### R4: Presentation follows the session-row hover-reveal convention with touch fallback
The palette button MUST be hover-revealed with touch fallback (`opacity-0 group-hover:opacity-100 coarse:opacity-100`); `+` and `✕` MUST be always visible. The header container MUST carry `group` (or a scoped variant if `group` is already claimed in the subtree — it is not) to drive the reveal. The SERVER-tile behavior of hiding actions on mobile (`showActions = !isMobile`) MUST NOT be copied — palette and close stay reachable on coarse pointers.

- **GIVEN** a rendered server group header
- **WHEN** inspecting the palette button's classes
- **THEN** it carries `opacity-0`, `group-hover:opacity-100`, and `coarse:opacity-100`
- **AND** the `+` and `✕` buttons carry none of those reveal classes (always visible)

#### R5: Icon legibility on the tinted fill
The cluster buttons MUST follow the header's existing text treatment: the contrast-guarded `headerAccent` (`rowBorders`) color for non-current headers, `text-text-primary` for the current one — not the flat `text-text-secondary` the old `+` used. The close button hover MUST go red (`hover:text-red-400`, the tile/session-row precedent); palette/plus hover MAY brighten to `text-text-primary`. Hover colors MUST actually apply — since inline `style.color` beats hover classes, the rest color is carried on a cluster wrapper (inline `headerAccent` / `text-text-primary` class) and buttons inherit it, letting per-button Tailwind `hover:` classes win on hover.

- **GIVEN** a non-current colored server group header
- **WHEN** the cluster renders
- **THEN** the cluster wrapper carries the resolved `headerAccent` as inline color (buttons inherit)
- **GIVEN** the current server's header
- **THEN** the wrapper uses `text-text-primary` with no inline accent

#### R6: Accessibility, selectors, and back-compat
New buttons MUST use the SERVER-tile aria wording — `Set color for server {name}`, `Kill server {name}` — and be real `<button>`s in tab order (Constitution V). Existing selectors MUST keep working unchanged: `data-server` on the header container, `New session on {server}`, `Expand/Collapse {server} sessions`, `aria-current`/`data-current-server`, and the tint/border inline styles asserted by the t1ca suite. Unit-test queries MUST scope within the header container (`[data-server="…"]`) to avoid duplicate-label ambiguity with the SERVER-panel tiles.

- **GIVEN** the existing t1ca unit suite and the e2e specs (`multi-server-sidebar.spec.ts`, `sessions-scope-toggle.spec.ts`)
- **WHEN** the cluster is added
- **THEN** all pre-existing assertions pass unmodified

#### R7: Memo contract preserved
New props threaded into `ServerGroup` (`onKillServer`, `onServerColorChange`) MUST be referentially stable across SSE ticks (identity-arg `useCallback` for the color handler; the `onKillServer` prop passed through as-is), preserving the `React.memo(ServerGroupInner)` skip behavior documented at the memo comment.

- **GIVEN** an SSE session tick on server B
- **WHEN** `Sidebar` re-renders
- **THEN** server A's `ServerGroup` still skips re-render (no new handler identities introduced per render)

### Non-Goals

- No `Server: Set Color` command-palette action — a pre-existing parity gap (the SERVER-tile palette affordance is mouse-only too); recorded as a follow-up candidate, not scope. `Server: Kill` already exists in the palette (app.tsx ~:2156).
- No new Playwright spec — coverage is unit-only (intake Assumption #10); server-kill e2e is destructive on the shared test server.
- No backend, endpoint, or route changes; no fix for the 12s safety-poll repaint latency on covered servers (memory `row-color-safety-poll-latency`) — the optimistic local update is what keeps the local UI instant.

### Design Decisions

#### Shared server-color handler lifted to a named useCallback
**Decision**: Lift the inline `onServerColorChange` closure (index.tsx ~:1104–1113) into a named `handleServerColorChange` `useCallback` in `Sidebar`, passed to BOTH `ServerPanel` and every `ServerGroup`.
**Why**: One write seam (optimistic state + POST + toast) with a stable identity — required by both the intake's no-duplication mandate and the ServerGroup memo contract (an inline closure would churn every render).
**Rejected**: Duplicating the optimistic-update/POST logic inside `ServerGroupInner` — a parallel path the intake explicitly forbids.
*Introduced by*: 260721-x4sf-sessions-header-color-close-actions

#### Rest color on a cluster wrapper, hover colors on buttons
**Decision**: Carry the header text treatment (inline `headerAccent` / `text-text-primary`) on the cluster's wrapper element; buttons inherit at rest and apply their own Tailwind `hover:` classes.
**Why**: Inline `style.color` on a button would defeat `hover:text-red-400`/`hover:text-text-primary` (inline beats any class); inheritance + per-button hover classes gives both legibility on the tinted fill and working hover states without imperative mouse handlers.
**Rejected**: Imperative onMouseEnter/onMouseLeave color mutation per button — more code for the same effect; the imperative pattern is reserved for the container background where CSS genuinely can't express it.
*Introduced by*: 260721-x4sf-sessions-header-color-close-actions

## Tasks

### Phase 1: Setup

*(none — frontend-only change reusing existing components; no scaffolding needed)*

### Phase 2: Core Implementation

- [x] T001 Lift the inline `onServerColorChange` handler in `app/frontend/src/components/sidebar/index.tsx` (~:1104–1113) into a stable `handleServerColorChange` `useCallback` in `Sidebar`; pass it to `ServerPanel` (replacing the inline closure) and to each `ServerGroup` as a new `onServerColorChange` prop; also forward the existing `onKillServer` prop into each `ServerGroup`. Extend `ServerGroupProps` with `onServerColorChange: (server: string, color: string | null) => void` and `onKillServer: (name: string) => void`. <!-- R2, R3, R7 --> <!-- rework: R7 violated one level up — BOTH Sidebar parents pass `onKillServer` as an inline arrow (`(name) => setKillServerTarget(name)` at app.tsx:2513 and board-page.tsx:1055), so the memoized ServerGroup sees a fresh identity every SSE tick and re-renders all groups. Fix: wrap in `useCallback` with `[]` deps in BOTH callers (setKillServerTarget is a stable setter), mirroring the sibling stabilized handleSidebar* handlers; add a unit test asserting ServerGroup memo skip survives a re-render with stable props if the existing pattern supports it -->
- [x] T002 In `ServerGroupInner` (`app/frontend/src/components/sidebar/index.tsx`), replace the lone `+` with the three-button cluster (palette → plus → close) inside a wrapper that carries the header text treatment (inline `headerAccent` for non-current / `text-text-primary` for current); add `group` to the header container; palette button gets `opacity-0 group-hover:opacity-100 coarse:opacity-100` reveal, `+`/`✕` stay always visible; aria-labels `Set color for server {server}`, `New session on {server}` (unchanged), `Kill server {server}`; `✕` calls `onKillServer(server)` with `hover:text-red-400`. <!-- R1, R3, R4, R5, R6 -->
- [x] T003 In `ServerGroupInner`, add local `showColorPicker` state + palette-button ref; render `SwatchPopover` (color-only: `selectedColor={serverColor}`, `onSelect` → `onServerColorChange(server, c)` + close, `onClose` → close) portalled to `document.body` with fixed positioning anchored at the palette button, mirroring the `ServerTile` flip-above `useLayoutEffect` (`server-panel.tsx` ~:273–287). <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add a new describe block to `app/frontend/src/components/sidebar/index.test.tsx` following the t1ca pattern (`renderWithColors` helper, `headerContainer`/`within` scoping): cluster DOM order palette→plus→close; palette toggle opens the SwatchPopover portalled outside the header container and a swatch pick calls the mocked `setServerColor` with the legacy descriptor and repaints the header tint optimistically; `✕` invokes the `onKillServer` prop with the server name (no direct API call); reveal classes present on palette only; existing toggle/`+` labels and t1ca tint assertions unchanged; wrapper carries `headerAccent` inline color (non-current) / `text-text-primary` (current). Extend `renderSidebar` opts with an `onKillServer` override. <!-- R1, R2, R3, R4, R5, R6 -->

### Phase 4: Polish

- [x] T005 Update the `ServerGroup` memo comment (~:1795) to note the two new stable props (`onKillServer`, `onServerColorChange`) ride the same identity-arg contract; run `just test-frontend` and `cd app/frontend && npx tsc --noEmit`. <!-- R7 --> <!-- rework: re-verify after the T001 parent-caller useCallback fix; the memo comment's claim ("onKillServer is the Sidebar prop passed through unchanged") must be true end-to-end, i.e. stable at the app.tsx/board-page.tsx source -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The server-group header renders palette, plus, and close buttons in that DOM order after the flex-1 toggle button
- [x] A-002 R2: Palette click opens a color-only SwatchPopover; a pick funnels through the single shared `handleServerColorChange` (optimistic `serverColors` update + `setServerColorApi` POST + failure toast), shared verbatim with `ServerPanel`
- [x] A-003 R3: Close click calls `onKillServer(server)`; the confirmation dialog, daemon warning, and kill API remain solely the parents' (no new dialog/handler in the sidebar)

### Behavioral Correctness

- [x] A-004 R2: The header popover is portalled to `document.body` with fixed positioning anchored at the palette button (flip-above near the viewport bottom), so the sessions list's overflow clip cannot cut it off
- [x] A-005 R5: Cluster rest color follows the header text treatment (inline `headerAccent` non-current / `text-text-primary` current) via wrapper inheritance; close hovers red, and hover classes actually win (no inline color on the buttons themselves)

### Scenario Coverage

- [x] A-006 R4: Palette button carries `opacity-0 group-hover:opacity-100 coarse:opacity-100`; `+` and `✕` carry no reveal classes (always visible, including on coarse pointers — unlike the SERVER-tile `!isMobile` hide)
- [x] A-007 R6: New unit tests cover cluster order, popover open/pick/close + seam invocation, kill prop invocation, and reveal classes — all queries scoped within `[data-server]` to dodge tile-label duplicates

### Edge Cases & Error Handling

- [x] A-008 R6: All pre-existing selectors and suites pass unmodified — t1ca tint assertions, `Expand/Collapse {server} sessions`, `New session on {server}`, `data-server`/`data-current-server`; `just test-frontend` (1625/1625 green) and `tsc --noEmit` are green
- [x] A-009 R7: `ServerGroup` memo skip behavior is preserved — both new props are referentially stable across renders (named `useCallback` / pass-through prop), and the memo comment documents them <!-- MET (rework cycle 1): `onServerColorChange` is the lifted `handleServerColorChange` useCallback (stable), and `onKillServer` is now stabilized at BOTH Sidebar callers as `handleSidebarKillServer` — a `useCallback(…, [])` wrapping the stable `setKillServerTarget` state setter (app.tsx:2517, board-page.tsx:1046) — so identity holds end-to-end from the setter source through Sidebar's pass-through to the memoized ServerGroup. tsc + 1625/1625 unit tests green. -->

### Code Quality

- [x] A-010 Pattern consistency: Cluster follows the session-row icon-cluster idiom (PaletteIcon glyph, `✕` glyph, stopPropagation-free simple buttons in a flex row) and the established portal/flip pattern from `ServerTile`
- [x] A-011 No unnecessary duplication: `SwatchPopover`, `PaletteIcon`, the lifted color handler, and the lifted kill flow are reused — no parallel color-write or kill path introduced
- [x] A-012 Type narrowing: no `as` casts introduced; new props typed on `ServerGroupProps`
- [x] A-013 Tests: new behavior covered by unit tests colocated in `index.test.tsx` (code-quality mandate: changed behavior MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `None` — this change adds new functionality (the header action cluster) by reusing existing seams (`SwatchPopover`, `PaletteIcon`, the lifted `handleServerColorChange`, the lifted `onKillServer` kill flow). It made no prior code redundant; it consolidated one previously-inline color handler into a shared `useCallback` (a lift, not a deletion). The near-duplicate portal-position `useLayoutEffect` (index.tsx ~:1584 vs `server-panel.tsx` ~:273) is a *consolidation opportunity* (extract a shared anchored-popover-position hook), not a deletion candidate — both call sites remain needed. Recorded as a should-fix in review, not a removal.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Rest color rides a cluster wrapper (inherited) rather than per-button inline styles, so Tailwind `hover:` classes can win | Inline `style.color` on a button beats any hover class; Tailwind preflight gives buttons `color: inherit`, making wrapper inheritance the minimal working mechanism honoring intake Assumption #7 | S:55 R:90 A:85 D:75 |
| 2 | Confident | Plain `group` on the header container (no scoped `group/…` variant) | No ancestor of the header container carries `group` (verified: nav → panes → section → header div), and the header's only descendants are the toggle + cluster — no collision | S:50 R:90 A:90 D:85 |
| 3 | Confident | Per-group local `showColorPicker` boolean state (not a lifted `colorPickerFor` map) | Each `ServerGroupInner` renders exactly one header; the tile pattern's keyed map exists only because `ServerPanel` maps many tiles in one component — session-row precedent uses the same local boolean | S:45 R:85 A:90 D:85 |
| 4 | Confident | Popover anchor rect measured from the palette button, right-aligned (`right: window.innerWidth - rect.right`), flip-above with the tile's ~100px height heuristic | Direct reuse of the proven `ServerTile` portal geometry; the header spans the sidebar width so anchoring to the button (not the container) keeps the popover by the affordance | S:45 R:85 A:80 D:75 |

4 assumptions (0 certain, 4 confident, 0 tentative).
