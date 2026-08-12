# Plan: Retire View Rows, Demote Chat, Rebind Ctrl+`

**Change**: 260812-0c6o-retire-view-rows-demote-chat
**Intake**: `intake.md`

## Requirements

All frontend (`app/frontend/src/`). No backend, no API changes.

### Top Bar: Retire the `View: …` menu rows and the ViewSwitcher

#### R1: The view-switcher registry entry and its components are removed
The `view-switcher` entry (first entry in `rightItems`, `src/components/top-bar.tsx` ~line 549) MUST be deleted, along with `ViewSwitcher` and `ViewSwitcherMenuRows` (`src/components/view-switcher.tsx` — delete the file and its `view-switcher.test.tsx`) and the import at `top-bar.tsx:18`. The `fixed-width` and `terminal-font` menu rows MUST stay (the VIEW `menuGroup` section header remains as long as any row occupies it).

- **GIVEN** a window offering tty+web+chat lenses
- **WHEN** the top-bar chevron ("More controls") menu opens at any width
- **THEN** no `View: …` `menuitemradio` rows render and no `view-toggle` testid exists anywhere in the DOM
- **AND** the Fixed width and Terminal font rows still render under the VIEW section

#### R2: The now-unused TopBar view props are pruned
The TopBar props `availableViews` / `activeView` / `onSelectView` (`top-bar.tsx` ~lines 181–188, destructured ~428–430), their slot-context fields, and their threading from `app.tsx` (~lines 529–531 and the `useRegisterTopBarSlot` payload ~3217–3220) MUST be removed — after verifying no other registry entry or consumer reads them. **The `availableViews(win)` FUNCTION in `lib/window-view.ts` is a different symbol and MUST NOT be touched** — `app.tsx:679` keeps calling it to derive `currentViews`.

- **GIVEN** the pruned TopBar props
- **WHEN** `npx tsc --noEmit` runs
- **THEN** the frontend type-checks clean with no dangling references

#### R3: The palette stays the only lens-switch surface
The command-palette `View: …` actions (`buildViewActions` in `src/lib/palette-view.ts`, consumed in `app.tsx` `viewActions`) and the `view-cycle` chord (`⌘.`) MUST keep working unchanged — they are now the only lens-switch surfaces (plus the rail's open-tile toggles for non-hidden surfaces).

- **GIVEN** a multi-lens window
- **WHEN** the palette opens
- **THEN** the applicable `View: …` actions are present and switch the lens via `single:<view>` layouts
- **AND** `⌘.` still cycles lenses

### Rail: Demote the chat surface

#### R4: A registry-level demotion flag hides chat from the rail
`src/lib/surface-layout.ts` MUST export a per-surface demotion flag — `export const SURFACE_RAIL_HIDDEN: ReadonlySet<SurfaceKind> = new Set(["chat"]);` — with a comment stating the un-hide path (delete the entry when chat ships). `availableTiles` MUST remain unchanged: chat stays an available surface so the palette's `Layout: Add Chat` / `Layout: Close Chat` entries (`src/lib/palette-layout.ts`) keep working as chat's entry points. The right rail (`src/components/right-panel.tsx`) and the mobile surface sheet (`src/components/mobile-surface-sheet.tsx`) filter by the flag **at render**, not at availability.

- **GIVEN** a chat-capable window (`chatProvider` non-empty)
- **WHEN** the right rail renders
- **THEN** no chat toggle button appears while tty/web/code buttons render per capability
- **AND** `buildLayoutActions` still offers `Layout: Add Chat` for that window

#### R5: An open chat tile is never stranded
The flag hides only the rail/sheet toggle — never the tile. A chat tile already open (via palette or a persisted `?layout=`/localStorage value) MUST still render and be closable via the tile's ✕, `Layout: Close Chat`, or layout verbs.

- **GIVEN** a persisted `?layout=split-h:tty,chat` URL on a chat-capable window
- **WHEN** the layout resolves on desktop
- **THEN** the chat tile renders and its ✕ closes it, while the rail shows no chat button (lit or unlit)

### Keybindings: remove `chat-toggle`, bind `layout-zoom`

#### R6: The chat-toggle binding and its plumbing are removed
The `chat-toggle` registry entry (`src/lib/keybindings.ts:209`) MUST be deleted. The component-local listener hook `src/hooks/use-chat-view-shortcut.ts` (and its test) MUST be deleted along with its `app.tsx` call site (~line 1651) and import (~line 68). The effective-combo hint lookup `bindingByAction.get("chat-toggle")` (`app.tsx` ~2516) goes with it: `src/lib/palette-view.ts`'s chat hint becomes the empty string (renders no hint) — simplify `shortcutFor`/`CHAT_SHORTCUT` rather than leaving a dead default, and update `palette-view.test.ts`. Registry-driven surfaces (shortcuts overlay, palette hints) update automatically; any hardcoded `Ctrl+\`` chat mention MUST be swept. Stale localStorage overrides keyed `chat-toggle` are ignored by the tolerant loader (verify, don't migrate).

- **GIVEN** a chat-capable window with the terminal focused
- **WHEN** `` Ctrl+` `` is pressed
- **THEN** the layout does not flip to `single:chat` and no chat affordance responds
- **AND** the `View: Chat` palette entry renders with no shortcut hint

#### R7: `layout-zoom` takes ctrl+Backquote
`src/lib/keybindings.ts` MUST gain `{ actionId: "layout-zoom", code: "Backquote", tier: "ctrl", scope: "terminal", kind: "builtin", label: "Zoom tile", description: "toggle layout zoom", mapLabel: "zoom" }`. The dispatch handler in `app.tsx` calls the existing slot-A zoom seam `layoutZoomToggleRef.current?.()` (ref ~line 814, registered via `zoomToggleRef` ~3473) — deliberately the same action as the palette's `Layout: Zoom`/`Layout: Unzoom` entries, NOT a focused-tile zoom. Both zoom palette entries (`layout-zoom`/`layout-unzoom` ids in `src/lib/palette-layout.ts`) MUST carry the new chord as their shortcut hint, tracking the effective binding. The conflict detector MUST stay green (`findConflicts` fixtures in `keybindings.test.ts` that used `chat-toggle` as the ctrl-tier collision fixture are updated to `layout-zoom`).

- **GIVEN** a desktop terminal route with a 2-tile layout
- **WHEN** `` Ctrl+` `` is pressed (including while the xterm textarea owns focus)
- **THEN** the slot-A zoom toggles (one tile full-center), and pressing again unzooms
- **AND** the palette shows the chord on `Layout: Zoom` / `Layout: Unzoom`
- **GIVEN** a single-tile layout
- **WHEN** `` Ctrl+` `` is pressed
- **THEN** nothing visibly changes (visual no-op — acceptable per intake)

### Non-Goals

- The rest of the surface-layout Phase 3 sweep (`@rk_type` identity → hint, the `>_` POST retirement, snapshot option-set update, `view-cycle` retirement) — backend-touching, its own change.
- Any chat feature work; deciding a new tenant for `⌘.`.
- The severable rider (terminal-route tile-focus cycling on `⌘[`/`⌘]`) — **dropped to backlog** (see Design Decisions).

### Design Decisions

#### Rider dropped: terminal-route tile-focus cycling
**Decision**: Do not implement the optional `⌘[`/`⌘]` tile-focus-cycle rider; file it as a backlog item in `fab/backlog.md` instead.
**Why**: The intake's include condition — "only if a lightweight mechanism suffices" — fails: the terminal route's `SurfaceLayout` has no tile-focus concept (xterm focus lives inside the tty tile; web/code tiles are iframes), so cycling needs a new focused-tile notion, a visible focus indicator, and a terminal-scoped binding pair that shadows macOS history navigation on `⌘[`/`⌘]`. That is a cross-component focus protocol, not transient state.
**Rejected**: Tracking the last clicked/promoted/zoomed slot in `SurfaceLayout`'s transient state — it yields a focus target but no user-visible focus semantics (nothing observable happens on "focus" without an indicator and verb-targeting), so the lightweight version delivers no value.
*Introduced by*: 260812-0c6o-retire-view-rows-demote-chat

#### layout-zoom dispatches via a dedicated handler, not `fromPalette`
**Decision**: Register `layout-zoom` in AppShell's dispatcher handler map as a direct `layoutZoomToggleRef.current?.()` call rather than resolving through `fromPalette("layout-zoom")`.
**Why**: The zoom palette entry's id flips with state (`layout-zoom` when unzoomed, `layout-unzoom` when zoomed — `palette-layout.ts` ~129–133), so a `fromPalette` lookup by the binding's actionId would find no handler exactly when zoomed and the chord would go dead half the time.
**Rejected**: Renaming both palette entries to one stable id — churns the palette contract and its tests for no user-visible gain; the ref seam already exists and is what the palette bodies call anyway.
*Introduced by*: 260812-0c6o-retire-view-rows-demote-chat

## Tasks

### Phase 1: Top-bar view-row retirement

- [x] T001 Delete the `view-switcher` registry entry from `rightItems` in `app/frontend/src/components/top-bar.tsx` (~549–575) plus the import at line 18 and the stale registry comments referencing it; delete `app/frontend/src/components/view-switcher.tsx` and `app/frontend/src/components/view-switcher.test.tsx` <!-- R1 -->
- [x] T002 Prune TopBar props `availableViews`/`activeView`/`onSelectView` (`top-bar.tsx` ~181–188, ~428–430), the slot-context view fields, and the `app.tsx` threading (~529–531, ~3217–3220) after verifying no other reader; keep `lib/window-view.ts`'s `availableViews()` function and `app.tsx:679`'s `currentViews` derivation untouched <!-- R2 -->
- [x] T003 Update unit tests referencing the removed entry/props: `app/frontend/src/components/top-bar.test.tsx`, `app/frontend/src/lib/top-bar-overflow.test.ts` (drop/adjust ViewSwitcher cases; assert the VIEW menu section still carries fixed-width + terminal-font rows) <!-- R1 -->

### Phase 2: Chat rail demotion

- [x] T004 Add `SURFACE_RAIL_HIDDEN: ReadonlySet<SurfaceKind> = new Set(["chat"])` to `app/frontend/src/lib/surface-layout.ts` with the un-hide comment; leave `availableTiles` unchanged <!-- R4 -->
- [x] T005 Filter by the flag at render in `app/frontend/src/components/right-panel.tsx` (rail buttons) and `app/frontend/src/components/mobile-surface-sheet.tsx` (tabs); tiles themselves stay ungated <!-- R4 -->
- [x] T006 [P] Unit tests: rail renders no chat button on a chat-capable window while web/code remain (`right-panel` tests or colocated); `palette-layout.test.ts` (or existing suite) proves `Layout: Add Chat` is still built; `surface-layout.test.ts` covers the flag export <!-- R4 -->

### Phase 3: Keybinding swap

- [x] T007 In `app/frontend/src/lib/keybindings.ts`: delete the `chat-toggle` entry (line 209) and add the `layout-zoom` entry (`code: "Backquote", tier: "ctrl", scope: "terminal", kind: "builtin", label: "Zoom tile", description: "toggle layout zoom", mapLabel: "zoom"`) <!-- R7 -->
- [x] T008 Delete `app/frontend/src/hooks/use-chat-view-shortcut.ts` + `use-chat-view-shortcut.test.ts`; remove the `app.tsx` import (~68) and call site (~1651); sweep for any remaining hardcoded chat `Ctrl+\`` mention (shortcuts overlay, docs strings) <!-- R6 -->
- [x] T009 Simplify `app/frontend/src/lib/palette-view.ts`: chat hint becomes the empty string (no hint), remove/simplify `CHAT_SHORTCUT` + `shortcutFor`'s chat branches as warranted; update the `app.tsx` hint lookup (~2516) to stop reading `chat-toggle`; update `palette-view.test.ts` <!-- R6 -->
- [x] T010 Wire the `layout-zoom` dispatch handler in `app.tsx` (AppShell handler map) calling `layoutZoomToggleRef.current?.()`; give both `Layout: Zoom`/`Layout: Unzoom` palette entries the effective `layout-zoom` combo as their `shortcut` hint (registry-driven via `bindingByAction`) <!-- R7 -->
- [x] T011 Update `app/frontend/src/lib/keybindings.test.ts`: default-set expectation (line ~165) moves from `chat-toggle` to `layout-zoom`; the ctrl-tier conflict/steal fixtures (~468–477, ~565–579) retarget `layout-zoom`; conflict detector stays green <!-- R7 -->

### Phase 4: E2E, backlog, verification

- [x] T012 Rework e2e specs that reach lenses via the removed `View: …` menu rows — `app/frontend/tests/e2e/web-view-lens.spec.ts`, `chat-view.spec.ts`, `code-surface.spec.ts`, `top-bar-overflow.spec.ts` — to switch lenses via the palette `View: …` actions (or legacy deep links where the case is about the shim); drop/replace the `` Ctrl+` `` chat-toggle case in `chat-view.spec.ts`; keep or retire `view-toggle`-absence assertions as each case warrants; update every companion `.spec.md` in the same commit (constitution: Test Companion Docs) <!-- R1 -->
- [x] T013 [P] E2E coverage for the demotion + rebind: rail shows no chat button on a chat-capable window (extend `chat-view.spec.ts` or `right-panel.spec.ts`); `` Ctrl+` `` toggles zoom on a 2-tile layout (extend `surface-layout.spec.ts` or the keybinding spec); companion `.spec.md` updates <!-- R4, R7 -->
- [x] T014 [P] Append the dropped rider to `fab/backlog.md` as a new `- [ ] [xxxx] 2026-08-12: …` entry (4-char id, terminal-route tile-focus cycling on `⌘[`/`⌘]`, noting the missing tile-focus concept + macOS history-nav shadowing) <!-- R8 — Design Decisions -->
- [x] T015 Verification gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; affected e2e via `just test-e2e "<spec>"` for the reworked specs (never raw playwright — port isolation) <!-- R2 -->

## Execution Order

- T001 → T002 → T003 (prop pruning depends on the entry deletion; tests last)
- T004 → T005 → T006
- T007 → {T008, T009, T010, T011}
- T012/T013 after all source phases; T014 independent; T015 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `view-switcher` registry entry, `ViewSwitcher`, and `ViewSwitcherMenuRows` are gone (file deleted); no `View: …` menuitemradio rows and no `view-toggle` testid render anywhere
- [x] A-002 R2: `availableViews`/`activeView`/`onSelectView` TopBar props and slot fields are removed with zero dangling references; `lib/window-view.ts`'s `availableViews()` and `currentViews` derivation remain intact
- [x] A-003 R4: `SURFACE_RAIL_HIDDEN` exists in `surface-layout.ts` with the un-hide comment; the rail and mobile sheet filter by it at render; `availableTiles` is byte-unchanged
- [x] A-004 R6: `chat-toggle` registry entry, `use-chat-view-shortcut.ts` (+ test), its `app.tsx` call, and the chat hint lookup are all removed
- [x] A-005 R7: The `layout-zoom` binding exists on ctrl+Backquote and its dispatch reaches `layoutZoomToggleRef`

### Behavioral Correctness

- [x] A-006 R3: Palette `View: …` actions still switch lenses and `⌘.` still cycles (unchanged behavior)
- [x] A-007 R4: `Layout: Add Chat` / `Layout: Close Chat` palette entries still appear for a chat-capable window
- [x] A-008 R7: Both `Layout: Zoom`/`Layout: Unzoom` palette entries carry the effective ctrl+Backquote hint; `findConflicts` over the shipped defaults is empty in every host

### Removal Verification

- [x] A-009 R1: The Fixed width and Terminal font rows survive under the VIEW menu section
- [x] A-010 R6: `` Ctrl+` `` no longer flips to the chat lens anywhere; no hardcoded chat-toggle chord mention survives (overlay, hints, docs strings)

### Scenario Coverage

- [x] A-011 R5: An open chat tile (persisted layout or palette-opened) still renders and is closable via ✕ / `Layout: Close Chat` while the rail shows no chat button — covered by unit or e2e test
- [x] A-012 R7: `` Ctrl+` `` zoom toggle proven with terminal focus (the xterm textarea owning focus) — the ctrl-tier chord reaches the handler

### Edge Cases & Error Handling

- [x] A-013 R6: A stale `chat-toggle` localStorage override is ignored harmlessly by the tolerant loader (verified — no migration code added)
- [x] A-014 R7: On a single-tile layout `` Ctrl+` `` is a safe visual no-op (no error, no state corruption)

### Code Quality

- [x] A-015 Pattern consistency: New code follows naming and structural patterns of surrounding code (registry-driven hints, pure-module filters, `ReadonlySet` flag)
- [x] A-016 No unnecessary duplication: Existing seams reused (`layoutZoomToggleRef`, `bindingByAction`, `SURFACE_GLYPH`/`SURFACE_LABEL`); no parallel availability registry introduced
- [x] A-017 Type narrowing over assertions: no new `as` casts; `tsc --noEmit` clean
- [x] A-018 Tests included: unit + e2e coverage per changed behavior, `.spec.md` companions updated in the same commit

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Run e2e only via `just test-e2e "<spec>"` / `just pw` (port isolation; `just pw` is poisoned by RK_PORT in some envs — prefer `just test-e2e`)

## Deletion Candidates

- None outstanding in code — the change deleted what it obsoleted in the same diff (`view-switcher.tsx` + test, `use-chat-view-shortcut.ts` + test, the pruned TopBar props and their threading). Remaining symbols that LOOK orphaned are not: `switchView`/`resolvedView` (app.tsx) still serve the palette `View:` actions and the `view-cycle` chord; `window-view.ts`'s `availableViews()`/`HINT_ORDER` still feed the palette and the lens cycle.
- Stale comment references to the deleted `ViewSwitcher`/`ViewSwitcherMenuRows` survive in `app/frontend/src/components/open-button.tsx:43,120,216`, `app/frontend/src/components/layout-chip.tsx:37,163`, `app/frontend/src/components/board/board-page.tsx:851,991`, `app/frontend/src/components/shell-titlebar-strip.tsx:300`, `app/frontend/src/components/surface-layout.tsx:55` — comment-only sweep candidate (the "precedent" they cite no longer exists); cosmetic, no behavior.
- `docs/memory/run-kit/ui-patterns.md` still documents the ViewSwitcher / `Ctrl+\`` chat-toggle as live surfaces (Window Views, ViewSwitcher chip, Palette parity, Chat View, e2e sections) — expected drift; the hydrate stage owns the rewrite (listed as affected memory), flagged here only so it is not mistaken for an omission.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Drop the rider (tile-focus cycling) and file it to `fab/backlog.md` | The intake's own include condition fails: no tile-focus concept exists on the terminal route, a lightweight slot-tracking version has no user-visible semantics without an indicator, and the intake pre-authorizes the drop ("If it inflates … DROP the rider") | S:70 R:90 A:75 D:70 |
| 2 | Confident | `layout-zoom` dispatches via a dedicated AppShell handler, not `fromPalette` | The zoom palette entry id flips `layout-zoom`/`layout-unzoom` with state, so a `fromPalette` lookup dies when zoomed; the ref seam is the palette bodies' own call path | S:65 R:85 A:90 D:80 |
| 3 | Confident | The mobile sheet filter is applied as intake specifies, and cannot strand an open chat tile: the sheet lists only OPEN tiles, and a hidden chat tab remains reachable via the palette (`View: Chat` → `single:chat`) and closable via `Layout: Close Chat` | Intake names the sheet as a flag consumer AND mandates never-strand; both hold simultaneously because palette paths survive | S:60 R:80 A:80 D:70 |
| 4 | Certain | E2E lens navigation moves to the palette `View: …` actions (or legacy deep links for shim cases) | The intake states the palette is now the only lens-switch surface — the tests must exercise the surviving path | S:85 R:90 A:90 D:85 |
| 5 | Confident | `ViewShortcutHints` drops the `chat` field entirely (and `CHAT_SHORTCUT` with it); `shortcutFor` returns `""` for chat, `hints.cycle` otherwise | The plan's "simplify rather than leave a dead default" — a permanently-`""` chat field would be exactly the dead default warned against; `View: Terminal` when leaving chat correctly shows the cycle chord (⌘. reaches tty from any slot-A lens) | S:70 R:85 A:85 D:75 |
| 6 | Confident | The `layout-zoom` dispatch handler is gated on `windowParam && !isMobile && layout.order.length > 1` (the palette's `zoomEnabled` rule), so a single-tile layout lets Ctrl+` fall through to the pane instead of flipping invisible zoom state | Palette parity — the palette omits the zoom entries under the same gate; the intake accepts a single-tile visual no-op, and handler-absence is the registry's established gating idiom (a chord with no handler falls through untouched) | S:60 R:85 A:80 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
