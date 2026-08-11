# Plan: Right Panel Phase 1 — Rail, Panel Shell & Web Surface

**Change**: 260811-2r1w-right-panel-shell-web-surface
**Intake**: `intake.md`

## Requirements

Derived from `intake.md` (authoritative scope) and `docs/specs/right-panel.md` rules P1–P7, phase 1 ONLY: rail + panel shell + `web` surface on the terminal route. Frontend-only — no backend, API, or route changes.

### Right Panel: Surface Registry & Availability

#### R1: Open-ended surface registry with derived availability
`src/lib/right-panel.ts` SHALL define `type SurfaceName = "web"` (open-ended the way `ViewName` is — `code`/`agents` add members later, no new code path) and `availableSurfaces(win: ViewWindow): SurfaceName[]`. The `web` surface MUST be available exactly when the shipped `hasWebUrl(win)` helper holds (single source of truth — no duplicate URL-trim logic). Availability derives server-side from the existing `@rk_url` → `rkUrl` SSE window field; phase 1 MUST NOT add backend work.

- **GIVEN** a window whose `rkUrl` is a non-whitespace string
- **WHEN** `availableSurfaces(win)` runs
- **THEN** it returns `["web"]`
- **AND** a window with empty/whitespace/absent `rkUrl` returns `[]`

### Right Panel: Panel State Resolution & Persistence (spec P1)

#### R2: `resolvePanel` precedence and fall-through
`resolvePanel(searchPanel: string | undefined, stored: string | undefined, win)` SHALL resolve the open surface with precedence `?panel=` (when available) → per-window localStorage (when available) → `null` (closed). Unknown or unavailable values MUST fall through (mirroring `resolveView`); `null` means collapsed.

- **GIVEN** a web-capable window
- **WHEN** `?panel=web` is present
- **THEN** the panel resolves to `"web"` regardless of localStorage
- **AND** with no param and no stored value it resolves to `null` (closed)
- **AND** an unknown (`?panel=bogus`) or unavailable (`?panel=web` on a window with no `rkUrl`) value falls through to the next tier, bottoming out at `null`

#### R3: Value-bearing storage keys and per-viewer width
Panel surface persistence SHALL use a value-bearing per-window key `runkit-window-panel:{server}:{windowId}` (stores the surface name; opening writes it, closing REMOVES it — absent = closed). Panel width SHALL persist in a single per-viewer key `runkit-panel-width` (percentage of the main area), defaulting to **38%** and clamped to min **280px** / max **65%** on drag and on restore. Read/write wrappers MUST use the try/catch-noop localStorage pattern from `window-view.ts`/`chrome-context.tsx`.

- **GIVEN** the panel was opened on window `@3` of server `srv`
- **WHEN** it is closed
- **THEN** `localStorage["runkit-window-panel:srv:@3"]` is removed (not set to a sentinel)
- **AND** a stored width of `10`% on a 1000px row restores clamped to 28% (280px floor); a stored `90`% restores clamped to 65%

### Right Panel: Rail (spec § The Model, P4)

#### R4: Always-visible desktop rail with per-surface buttons
The terminal route (`/$server/$window`) SHALL render a fixed ~38px vertical icon rail on the right edge of the main area, always present on desktop. The rail renders one focusable button per AVAILABLE surface (phase 1: the `web` button only when `availableSurfaces` includes it), each carrying the availability dot (P4; amber attention semantics deferred to phase 3). The active surface's button MUST render inverse-video (accent-green fill, matching the view-switcher's active-segment treatment). Clicking a button toggles that surface open/closed.

- **GIVEN** a desktop terminal route on a web-capable window
- **WHEN** the rail renders
- **THEN** it shows a focusable `web` button with an availability dot
- **AND** on a window without `rkUrl` the rail renders with no surface buttons
- **AND** clicking the `web` button opens the panel; clicking it again closes the panel

### Right Panel: Panel Shell & Web Surface

#### R5: Panel placement, web renderer reuse, drag-resize with live refit
The panel SHALL open between the main lens slot and the rail at ~35–40% width (default 38%). Its `web` surface MUST reuse the shipped `IframeWindow` component (`src/components/iframe-window.tsx`) with a panel-context seam that suppresses the `>_` "Switch to terminal" affordance (meaningless beside the visible tty) while keeping the URL bar and refresh (editing `@rk_url` there is shared substrate state, window-views R7). A drag handle on the panel's left edge SHALL resize it; during drag the terminal pane MUST stay mounted and live, with refit riding `TerminalClient`'s existing container `ResizeObserver` (`terminal-client.tsx:396`). No IntersectionObserver-based suspension may be introduced (the board-page pane-resize bug class).

- **GIVEN** the web panel is open beside the terminal
- **WHEN** the user drags the panel's left edge
- **THEN** the panel width changes (clamped per R3) and the terminal stays mounted and refits its grid
- **AND** the panel's iframe shows no `>_` switch-to-terminal button but keeps the URL bar and refresh

#### R6: Hide, never unmount (spec P3)
Collapsing the panel SHALL hide the surface subtree at `display` level (e.g. `hidden` class), preserving iframe in-memory state. The panel subtree MUST mount lazily on first open and never unmount while the route (window) lives.

- **GIVEN** the web panel was opened and then closed
- **WHEN** the DOM is inspected
- **THEN** the iframe element is still mounted but not visible (display-level hide), so re-opening preserves its in-memory state

### Right Panel: Layout & URL Integration

#### R7: Content-row layout and the `?panel=` search param
The terminal-route content area SHALL become a horizontal flex row `[ main lens slot | panel (when open) | rail ]`, leaving the main-slot lens model unchanged (window-views R2–R5; spec P2 — the panel never changes the main slot's lens) and the `.app-shell`/terminal-column `overflow: hidden` guards intact. A new optional `?panel=<surface>` search param on the existing `/$server/$window` route (Constitution IV — no new routes) SHALL be handled exactly like `?view=`: read raw, validated by `validateTerminalSearch` (unknown values dropped) and `resolvePanel`, written on open/switch, dropped when closed (closed is the clean-URL default), and cleared on window switch by the existing `search: {}` seams. `switchView` MUST preserve an active `?panel=` param and `togglePanel` MUST preserve an active `?view=` param. `?view=web` and `?panel=web` MAY be active simultaneously — two independent slots rendering two `IframeWindow` instances, no special-casing.

- **GIVEN** the panel is open via click
- **WHEN** the URL is inspected
- **THEN** it carries `?panel=web`; closing the panel drops the param
- **AND** switching the main lens while the panel is open keeps `?panel=web` in the URL
- **AND** a cold load of `/$server/$window?view=web&panel=web` renders the web lens in the main slot AND the web surface in the panel

#### R8: Desktop-only phase 1
Below `isMobileViewport()` (narrow width OR coarse pointer) neither the rail nor the panel SHALL render, and `?panel=` MUST be ignored (resolves closed). The mobile sheet (spec P5) is a deferred follow-up per spec Open Question 3.

- **GIVEN** a 375px-wide (or coarse-pointer) viewport
- **WHEN** a web-capable window loads with `?panel=web`
- **THEN** no rail and no panel render

### Right Panel: Keyboard & Palette (spec P7, Constitution V)

#### R9: `panel-toggle` chord, palette entry, focusable rail
`src/lib/keybindings.ts` SHALL gain a `panel-toggle` registry action — chord **`⇧⌘.`** (shifted tier, code `Period`, terminal scope) — toggling the last-used surface (phase 1: `web`) open/closed. (Spec P7 names `⌘.`, but `⌘.` is already shipped as `view-cycle`, `keybindings.ts:193`; the panel toggle takes the shifted tier of the same key, leaving the lens cycle untouched.) The command palette SHALL gain a `Panel: Web` entry (id `panel-toggle`, so the registry hint decorates it) registered alongside the `View: …` entries, offered only when the web surface is available on desktop. Rail buttons MUST be focusable with a visible focus treatment.

- **GIVEN** a desktop terminal route on a web-capable window
- **WHEN** the user presses `⇧⌘.` (Shift+Ctrl+. on Win/Linux)
- **THEN** the web panel toggles open/closed
- **AND** the palette lists `Panel: Web` with the effective chord as its shortcut hint
- **AND** `findConflicts` over the default registry stays clean (`shifted` Period is disjoint from `view-cycle`'s `cmd` Period)

### Non-Goals

- Phase 2 (`code` lens/surface, backlog `[k3vp]`) and phase 3 (`@rk_owner` companions + `agents` surface, backlog `[w7qc]`) — separate changes per `right-panel.md` § Phasing.
- Mobile sheet (spec P5) — deferred per Open Question 3's recommendation.
- Backend/API/route changes — availability rides the existing `rkUrl` SSE field.
- Multiple simultaneous surfaces (spec P6) and amber attention dots (P4's phase-3 half).
- IntersectionObserver-based suspension anywhere in the panel/terminal interaction.

### Design Decisions

#### Shifted-tier chord for the panel toggle
**Decision**: `panel-toggle` ships as `⇧⌘.` (shifted tier, code `Period`), NOT spec P7's `⌘.`.
**Why**: `⌘.` is already shipped as `view-cycle` (`keybindings.ts:193`, PR #475); the shifted tier of the same key is the least-surprise free chord, tiers are disjoint (`findConflicts` stays clean), and the registry's per-device override layer lets a user rebind either action.
**Rejected**: Reassigning `⌘.` to the panel and rebinding the lens cycle — changes shipped muscle memory for a chord the spec wrote before the collision was known; spec P7 should be amended to match.
*Introduced by*: 260811-2r1w-right-panel-shell-web-surface

#### Panel-context seam is an optional `onSwitchToTty`
**Decision**: `IframeWindow` makes `onSwitchToTty` optional and renders the `>_` button only when it is provided; the panel omits it.
**Why**: The `>_` affordance switches the MAIN slot to tty — meaningless in the panel where the tty is already beside it. An absent-callback gate keeps the component's main-slot call sites byte-identical and avoids a parallel `inPanel` flag that could drift from the callback's presence.
**Rejected**: An `inPanel?: boolean` prop — two sources of truth for "is this the panel context" (flag + callback), and every main-slot caller would have to pass `inPanel={false}` explicitly.
*Introduced by*: 260811-2r1w-right-panel-shell-web-surface

#### `RightPanel` owns width/drag/mount-once; `app.tsx` owns open state
**Decision**: The `RightPanel` component owns panel-width state (per-viewer localStorage + drag interaction + container measurement) and the mount-once/hide-never-unmount subtree; `app.tsx` owns surface open/closed resolution (URL + per-window localStorage) and passes the surface content as `children`.
**Why**: Open state is route-integrated (search params, navigation seams) and belongs beside `switchView`; width and drag are self-contained interaction state. Children composition keeps `RightPanel` free of the `IframeWindow`/session-context import graph, so its rail/toggle/hide behavior is unit-testable in jsdom without the xterm/proxy stack, and later surfaces (`code`, `agents`) slot in as different children without touching the shell.
**Rejected**: `RightPanel` importing `IframeWindow` and owning surface-content selection — couples the shell to one surface's renderer and makes the component untestable without mocking the session context.
*Introduced by*: 260811-2r1w-right-panel-shell-web-surface

## Tasks

### Phase 1: Pure helpers & registry entries

- [x] T001 [P] Create `app/frontend/src/lib/right-panel.ts`: `SurfaceName = "web"`, `availableSurfaces(win)` (via shipped `hasWebUrl`), `resolvePanel(searchPanel, stored, win)` (param → stored → `null`, availability-gated fall-through), `panelStorageKey(server, windowId)` → `runkit-window-panel:{server}:{windowId}` + `readStoredPanel`/`writeStoredPanel`/`removeStoredPanel` (try/catch-noop), width constants (`DEFAULT_PANEL_WIDTH_PCT = 38`, `MIN_PANEL_WIDTH_PX = 280`, `MAX_PANEL_WIDTH_PCT = 65`, `PANEL_WIDTH_STORAGE_KEY = "runkit-panel-width"`), `clampPanelWidth(pct, containerWidthPx)` (280px floor wins over the 65% cap when they collide, mirroring CSS `clamp`), `readStoredPanelWidth`/`writeStoredPanelWidth` <!-- R1 R2 R3 -->
- [x] T002 [P] Create `app/frontend/src/lib/right-panel.test.ts`: unit tests for availability, `resolvePanel` precedence/fall-through, storage key read/write/remove round-trip, width clamp edges (floor, cap, floor-beats-cap on narrow containers, unparseable stored width → default) <!-- R1 R2 R3 -->
- [x] T003 [P] Extend `app/frontend/src/lib/router-url.ts`: `TerminalSearch` gains `panel?: "web"`; `validateTerminalSearch` passes `panel` through only for the known value (unknown dropped, mirroring `view`); extend `app/frontend/src/lib/router-url.test.ts` for the new param <!-- R7 -->
- [x] T004 [P] Add the `panel-toggle` action to `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts`: `{ code: "Period", tier: "shifted", scope: "terminal", label: "Toggle right panel" }`; extend `keybindings.test.ts` (default shape + no-conflict assertions) <!-- R9 -->
- [x] T005 [P] Make `onSwitchToTty` optional in `app/frontend/src/components/iframe-window.tsx`; render the `>_` "Switch to terminal" button only when provided (panel omits it; URL bar + refresh unchanged) <!-- R5 -->

### Phase 2: Panel shell component

- [x] T006 Create `app/frontend/src/components/right-panel.tsx`: the ~38px rail (always rendered by the caller on desktop terminal routes; one focusable `Tip`-wrapped button per available surface with availability dot + active inverse-video, click toggles) and the panel shell between main slot and rail (drag handle on the left edge — pointer events with `setPointerCapture`, iframe `pointer-events: none` during drag; width via `clampPanelWidth` over the row container measured with a `ResizeObserver`; per-viewer width persistence; lazy first mount then `hidden`-class hide, never unmount; surface content received as `children`) <!-- R4 R5 R6 -->
- [x] T007 Create `app/frontend/src/components/right-panel.test.tsx`: rail render gating (button only when available), click → `onToggle`, active inverse-video/`aria-pressed`, hide-never-unmount (`hidden` class, child still mounted), no content before first open <!-- R4 R6 -->

### Phase 3: Integration & tests

- [x] T008 Wire `app/frontend/src/app.tsx`: resolve panel state (`search.panel` → `readStoredPanel` → `resolvePanel`, gated `!isMobile`), `togglePanel` (write/remove stored key + navigate with `?panel=` written on open / dropped on close, preserving `?view=`), `switchView` preserves an active `?panel=`, the content area becomes the `[ main | panel | rail ]` flex row with `RightPanel` (keyed by `server:windowId`) mounted only on desktop window routes, the `panel-toggle` keybinding handler (gated on availability + desktop), and the `Panel: Web` palette entry (id `panel-toggle`) in `viewActions` <!-- R5 R7 R8 R9 -->
- [x] T009 Create `app/frontend/tests/e2e/right-panel.spec.ts` + sibling `app/frontend/tests/e2e/right-panel.spec.md` (constitution Test Companion Docs), on the isolated port-3020 tmux server via `_tmux.ts` helpers (`web-view-lens.spec.ts` patterns): rail button gating by `@rk_url`; click opens the panel with the proxied iframe beside a live terminal; `?panel=web` deep link (and unavailable/invalid fall-through to closed); persistence across reload (open → open, close → closed); collapse hides but does not unmount the iframe; drag-resize changes width with the xterm surviving; `?view=web` + `?panel=web` simultaneously; 375px mobile renders neither rail nor panel <!-- R4 R5 R6 R7 R8 -->

### Phase 4: Verification

- [x] T010 Run the gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e "right-panel"` (never invoke playwright directly) <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->

## Execution Order

- T001–T005 are independent leaf-module edits (`[P]`).
- T006 depends on T001 (helpers) and T005 (panel-context seam); T007 depends on T006.
- T008 depends on T001, T003, T004, T006.
- T009 depends on T008; T010 is last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `availableSurfaces` returns `["web"]` exactly when `hasWebUrl(win)` holds and `[]` otherwise; no backend changes exist in the diff
- [x] A-002 R2: `resolvePanel` implements param → stored → `null` precedence with availability-gated fall-through, unit-tested
- [x] A-003 R3: `runkit-window-panel:{server}:{windowId}` is written on open and removed on close; `runkit-panel-width` persists a percentage clamped to 280px/65% with a 38% default
- [x] A-004 R4: A ~38px rail renders on every desktop terminal route; the focusable `web` button (with availability dot) appears only when available and toggles the panel; the active surface is inverse-video
- [x] A-005 R5: The panel opens between the main lens slot and the rail reusing `IframeWindow` without the `>_` button (URL bar + refresh kept); drag-resize keeps the terminal mounted and refitting
- [x] A-006 R6: Closing the panel hides the iframe at display level without unmounting it; re-opening preserves in-memory iframe state
- [x] A-007 R7: `?panel=web` deep-links open the panel; closing drops the param; `switchView` preserves `?panel=` and `togglePanel` preserves `?view=`; `?view=web&panel=web` renders two independent `IframeWindow` instances
- [x] A-008 R8: At mobile viewport / coarse pointer no rail or panel renders and `?panel=` is ignored
- [x] A-009 R9: `⇧⌘.` toggles the web panel; the palette shows `Panel: Web` with the registry shortcut hint; the shortcuts overlay lists `panel-toggle` via the registry; default-registry conflict detection stays clean

### Behavioral Correctness

- [x] A-010 R7: Window switches (sidebar click, SSE writeback) clear `?panel=` exactly like `?view=`, and the target window resolves its own persisted panel state
- [x] A-011 R5: The main-slot lens model is unchanged — `?view=` resolution, `switchView`, the menu rows, and the window-switch transition classification behave exactly as before when the panel is closed

### Scenario Coverage

- [x] A-012 R4: e2e proves the rail button appears only on `@rk_url`-carrying windows
- [x] A-013 R5: e2e proves drag-resize changes panel width while the same xterm instance survives
- [x] A-014 R6: e2e proves collapse hides but does not unmount the iframe (element present + hidden)
- [x] A-015 R2/R7: e2e proves `?panel=web` deep link, invalid/unavailable fall-through to closed, and reload persistence in both directions
- [x] A-016 R8: e2e proves 375px mobile renders neither rail nor panel

### Edge Cases & Error Handling

- [x] A-017 R2: `?panel=bogus` is dropped by `validateTerminalSearch` and resolves closed (no error state)
- [x] A-018 R3: An unparseable/garbage stored width falls back to the 38% default; a stored width outside the clamps restores clamped
- [x] A-019 R5: During drag the panel's iframe cannot swallow pointer events (pointer-events disabled mid-drag), so the drag cannot stall over the iframe

### Code Quality

- [x] A-020: Type narrowing over type assertions — no new `as` casts for the search-param/panel plumbing (`TerminalSearch` types carry it)
- [x] A-021: No duplicated utilities — `hasWebUrl`, `IframeWindow`, the try/catch-noop localStorage pattern, and the `_tmux.ts` e2e helpers are reused, not reimplemented
- [x] A-022: New behavior is covered by tests (colocated Vitest for the pure helpers + component, Playwright for the UI), and the new spec ships its `.spec.md` companion
- [x] A-023 Pattern consistency: New code follows the `window-view.ts` pure-helper pattern and surrounding naming/structure
- [x] A-024 No unnecessary duplication: panel state mirrors — not forks — the shipped lens-resolution code path

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the `IframeWindow.onSwitchToTty` prop only became *optional*; both main-slot call sites still pass it).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `panel-toggle` ships on `⇧⌘.` (shifted `Period`), resolving intake's tentative #10 in favor of the intake's own pick; spec P7 should be amended to match | `⌘.` is shipped as `view-cycle`; tiers are disjoint so the registry stays conflict-free; the override layer makes the choice user-reversible | S:70 R:85 A:75 D:70 |
| 2 | Certain | The rail renders on every desktop terminal route even when no surface is available (empty 38px strip) | Spec § The Model "always visible on desktop" + intake assumption 12; the strip is the phase-2/3 landing pad | S:80 R:85 A:80 D:75 |
| 3 | Confident | `RightPanel` receives surface content as `children` (app.tsx composes `IframeWindow`) rather than importing renderers itself | Keeps the shell presentational and jsdom-testable; later surfaces add children, not branches | S:65 R:85 A:80 D:70 |
| 4 | Certain | Window switches clear `?panel=` through the existing `search: {}` seams — no new code | "Handled exactly like `?view=`" (intake §3); both switch paths already pass `search: {}` | S:85 R:90 A:85 D:80 |
| 5 | Confident | When the 280px floor exceeds the 65% cap (narrow rows), the floor wins — mirroring CSS `clamp()` | CSS clamp semantics prefer MIN when MIN > MAX; a <280px panel is unusable, a >65% one merely large | S:60 R:90 A:70 D:60 |

5 assumptions (2 certain, 3 confident, 0 tentative).
