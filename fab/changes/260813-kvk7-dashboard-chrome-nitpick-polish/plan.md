# Plan: Dashboard Chrome Nitpick Polish

**Change**: 260813-kvk7-dashboard-chrome-nitpick-polish
**Intake**: `intake.md`

## Requirements

### Sidebar: Scroll-Edge Fade (Fix 1)

#### R1: Partial content at sidebar scroll boundaries fades instead of slicing
The sessions-tree scroll viewport (`app/frontend/src/components/sidebar/index.tsx` ~1530, the `role="tree"` container with `flex-1 min-h-0 overflow-y-auto`) and the SERVER panel's resizable scroll area (`app/frontend/src/components/sidebar/collapsible-panel.tsx` `contentStyle` resizable branch, hosting `server-panel.tsx`'s tile grid) MUST render a bottom-edge fade so partially-clipped rows/tiles read as "more below" rather than sliced glyphs. The fade MUST render only when the viewport is actually scrollable AND not scrolled to the end; a short or fully-scrolled list shows no fade. The treatment MUST be reusable (shared hook + `rk-*` utility in `globals.css` per the project's utility-class convention) and SHOULD use `mask-image` (content fades to transparent) rather than an opaque overlay, because rows/tiles carry per-item color tints. It MUST NOT change viewport geometry, panel heights, or drag-resize behavior, and MUST NOT be applied app-wide beyond these two viewports. Portalled popovers (SwatchPopover et al., already portalled to `document.body`) are unaffected by construction.

- **GIVEN** the Completed session group has more rows than fit the sessions viewport
- **WHEN** the list is not scrolled to its end
- **THEN** the bottom cut edge fades content to transparent over a short gradient instead of slicing a row mid-glyph
- **AND** scrolling to the very end removes the fade so the last row renders at full opacity

- **GIVEN** the SERVER panel is drag-resized to a height that clips a tile row partially
- **WHEN** the grid is scrollable below the cut
- **THEN** the partial tile row fades at the boundary; a fully-visible grid shows no fade

### Top Bar: Heading Punctuation (Fix 2)

#### R2: Single-caret `PageType: name ▾` heading in all modes
The center heading MUST render the `PageType: name` convention with the colon contiguous to the prefix and exactly one caret, owned by the name-side switcher. The `caret={<HierarchyDropdown …/>}` usage MUST be removed from all three non-host modes in `app/frontend/src/components/top-bar.tsx` (terminal `Window ▾:` ~1061, board `Board ▾:` ~1093, server `tmux Server ▾:` ~1108), and the now-dead `HierarchyDropdown` component (~340) MUST be deleted. The prefix renderer's existing no-caret path (comment ~1483) renders `Window:` contiguous. There MUST be NO replacement UI for ancestor navigation: palette parity already exists (`lib/palette-nav.ts` `buildNavActions` emits `Go: tmux Server` / `Go: Host`), satisfying Constitution V with zero new code. The breakpoint degradation ladder MUST stay unchanged (the below-`md` server-crumb hiding keeps its behavior; below-`md` ancestor navigation is palette + browser back — record this consequence in code comment where the ladder cites the hierarchy ▾, do not redesign the ladder).

- **GIVEN** a terminal route at desktop width
- **WHEN** the heading renders
- **THEN** it reads `Window: <name> ▾` — no caret between the prefix and the colon, no space before the colon, and the single `▾` opens the window switcher

- **GIVEN** board and server routes
- **WHEN** their headings render
- **THEN** `Board: <board> ▾` and `tmux Server: <server>` render with no prefix caret

- **GIVEN** the command palette
- **WHEN** opened on a terminal route
- **THEN** `Go: tmux Server` and `Go: Host` actions still navigate the ancestor chain

### Compose Strip: Send Enablement (Fix 3)

#### R3: Send button disabled on empty text; chord behavior unchanged
In `app/frontend/src/components/compose-strip.tsx` (~681–689), the terminal-target arm of `canSubmit` MUST gain the `text.trim() !== ""` condition so that with an empty/whitespace-only composer BOTH Insert and Send render disabled (Send loses its primary fill via the existing `disabled:opacity-40`), and with text present both are enabled with Send keeping the primary fill. The Cmd/Ctrl+Enter chord's empty-composer bare-`\r` send ("press Enter in the pane", keydown path via `classifyComposeEnter`) MUST remain unchanged — user decision: only the button disables; the button/chord divergence on empty is accepted. The 260802-lj98 code comment (button mirrors chord) MUST be updated to record the new rationale: button state = "is there text to send"; chord = power-user pane keystroke. Selection-target mode MUST be unchanged (its `canSubmit` already requires text; Insert stays disabled there).

- **GIVEN** a terminal target and an empty (or whitespace-only) composer
- **WHEN** the button row renders
- **THEN** Insert and Send are both disabled and no primary fill renders
- **AND** pressing Cmd/Ctrl+Enter still sends a bare `\r` to the pane

- **GIVEN** a terminal target and non-empty composer text
- **WHEN** the button row renders
- **THEN** both buttons are enabled and Send carries the primary fill; clicking Send transmits `text + "\r"`

### Top Bar: Breadcrumb Session Chip (Fix 4)

#### R4: Session crumb is a static boxed chip; session dropdown removed
The final session crumb in `app/frontend/src/components/top-bar.tsx` (~979–995, currently a `BreadcrumbDropdown` with `items={sessionItems}` and the `+ New Session` action) MUST be replaced by a NON-interactive static span carrying the sibling chips' box styling (border, radius, padding from `LINK_CRUMB_CLASS`'s box, `max-w-[16ch] truncate`) WITHOUT hover treatment or pointer cursor — sessions have no route of their own. The `sessionItems` construction MUST be removed, and the `onCreateSession` plumbing into the top bar (prop + `top-bar-slot-context` field) MUST be removed if nothing else consumes it. The `BreadcrumbDropdown` component itself MUST stay (window switcher and board switcher use it). The `LINK_CRUMB_CLASS` "bordered = clickable" comment (~243) MUST be updated: the chip box is crumb styling; hover is reserved for the interactive crumbs. Entry-point coverage (verified at intake): session switching = sidebar rows + palette `Window: Switch to …`; session creation = palette `Session: Create` / `Session: Create at Folder` + sidebar server-header `+`.

- **GIVEN** a terminal route at `sm+` width
- **WHEN** the breadcrumb renders
- **THEN** three consistently boxed chips render (brand, server, session), the session chip has no `▾`, opens nothing on click, and shows no hover affordance

- **GIVEN** the command palette
- **WHEN** searched for session actions
- **THEN** `Session: Create` and `Session: Create at Folder` still create sessions (nothing orphaned by the dropdown's removal)

### Sidebar: Header Trailing-Icon Alignment (Fix 5)

#### R5: Server group header adopts the session-row icon-cluster metrics
The server group header's trailing icon cluster (`app/frontend/src/components/sidebar/index.tsx` ~2331–2369: `px-1` text glyphs `+`/`✕` at `text-[13px]`, no wrapper right padding) MUST adopt the session group headers' metrics (`app/frontend/src/components/sidebar/session-row.tsx` ~221–268): SVG `PlusIcon`/`CloseIcon` from `sidebar/icons.tsx`, per-button `px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px]` slots, and wrapper right padding matching the session rows' `pr-2` — so `+` and `×` icons align vertically down the sidebar across all header tiers. Hover-reveal behavior (palette icon) and the server header's color/tint inheritance MUST be unchanged.

- **GIVEN** a server group header rendered above session group headers
- **WHEN** both are visible in the sidebar
- **THEN** the server header's `+` and `×` centers align vertically with the session headers' `+` and `×`, at the same glyph size

### Non-Goals

- No app-wide fade sweep of every scrollable container (only the two evidenced viewports).
- No replacement UI for hierarchy/ancestor navigation or the session switcher (palette/sidebar already cover both).
- No change to the ⌘/Ctrl+Enter chord semantics, selection-broadcast mode, or the Enter classifier (`lib/compose-keys.ts` policy table is untouched).
- No changes to the breakpoint degradation ladder, the overflow chevron registry, or the boot-sweep heading animation.
- The review's other findings (ghost pill, pane-identity notation, `›` prefix, attention-slab merge, terminal-rendered content) stay out of scope.

### Design Decisions

#### Scroll-edge fade is a conditional mask, not a permanent veil
**Decision**: Implement the fade as a shared hook (scrollable-and-not-at-end detection) + a `mask-image` utility class applied conditionally to the two sidebar viewports.
**Why**: Rows/tiles carry per-item color tints; a mask fades whatever is there. Rendering only when more content exists preserves the approved "reads as more below" semantic — a permanent veil would dim the final row of a short list.
**Rejected**: Row-quantized viewport heights (user explicitly rejected); opaque background-colored overlay (mismatches tinted content).
*Introduced by*: 260813-kvk7-dashboard-chrome-nitpick-polish

#### Button/chord divergence on empty is deliberate
**Decision**: Only the Send button gains the empty-disable; the Cmd/Ctrl+Enter chord keeps its empty-composer bare-`\r` send.
**Why**: User decision (clarified 2026-08-14): the misleading affordance was the lit primary button, not the chord — the chord is a power-user "press Enter in the pane" keystroke and the only compose-strip path for it.
**Rejected**: Making the chord a no-op too (loses a real remote-control affordance); keeping Send enabled (the original 260802-lj98 mirror — the lit CTA over nothing sendable is what read as broken).
*Introduced by*: 260813-kvk7-dashboard-chrome-nitpick-polish

#### Session crumb keeps the chip box but no interactivity
**Decision**: The session crumb becomes a static boxed span; its dropdown (session switcher + `+ New Session`) is removed with no replacement.
**Why**: User judgment: the dropdown is essentially unused; sidebar + palette own session switching/creation. Visual chip consistency across the trail was the approved fix.
**Rejected**: Boxed chip retaining the ▾ dropdown (keeps the affordance inconsistency the fix targets); bare-text non-interactive crumb (keeps the 2-of-3 styling mismatch).
*Introduced by*: 260813-kvk7-dashboard-chrome-nitpick-polish

## Tasks

### Phase 1: Setup

- [x] T001 Add the reusable scroll-edge fade primitives: a `useScrollEdgeFade` hook (new file `app/frontend/src/hooks/use-scroll-edge-fade.ts` — returns whether the observed element is scrollable and not at its end, listening to scroll + resize/content changes) and an `rk-scroll-fade-bottom` utility in `app/frontend/src/globals.css` (bottom `mask-image` gradient, following the existing `rk-*` utility conventions). Colocated unit test `use-scroll-edge-fade.test.ts`. <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Apply the fade to the sessions-tree scroll viewport in `app/frontend/src/components/sidebar/index.tsx` (~1530, the `role="tree"` `overflow-y-auto` container): wire `useScrollEdgeFade`, toggle `rk-scroll-fade-bottom` only while more content exists below. <!-- R1 -->
- [x] T003 Apply the same treatment to the SERVER panel's resizable scroll area (`app/frontend/src/components/sidebar/collapsible-panel.tsx` resizable `contentStyle` branch; grid in `server-panel.tsx`) — fade only in the resizable/clipping mode, not the legacy `overflow: visible` mode. <!-- R1 -->
- [x] T004 [P] Remove the prefix hierarchy caret in `app/frontend/src/components/top-bar.tsx`: drop `caret={<HierarchyDropdown …/>}` from terminal (~1061), board (~1093), and server (~1108) headings; delete the `HierarchyDropdown` component (~340); update the degradation-ladder comment (~960) that justifies the below-`md` server-crumb hiding by the hierarchy ▾ (coverage is now palette `Go:` + browser back). Verify `Window:` renders contiguous via the existing no-caret prefix path (~1483). <!-- R2 -->
- [x] T005 [P] In `app/frontend/src/components/compose-strip.tsx` (~681–689): add `text.trim() !== ""` to the terminal-target arm of `canSubmit`; leave `canInsert`, selection mode, and the keydown/chord path untouched; rewrite the 260802-lj98 comment to document the deliberate button/chord divergence (button = "is there text to send", chord = pane keystroke). <!-- R3 -->
- [x] T006 [P] Replace the session `BreadcrumbDropdown` in `app/frontend/src/components/top-bar.tsx` (~979–995) with a static non-interactive boxed chip span (chip box + `max-w-[16ch] truncate`, no hover classes, no cursor-pointer); remove `sessionItems`; remove the `onCreateSession` prop + `contexts/top-bar-slot-context.tsx` field if no other consumer remains; update the `LINK_CRUMB_CLASS` comment (~243). <!-- R4 -->
- [x] T007 [P] Align the server group header icon cluster in `app/frontend/src/components/sidebar/index.tsx` (~2331–2369) to the session-row metrics from `session-row.tsx` (~221–268): swap text `+`/`✕` for `PlusIcon`/`CloseIcon` SVGs, per-button `px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px]`, wrapper right padding equivalent to `pr-2`; keep hover-reveal + tint behavior. <!-- R5 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T008 Update unit tests for the top bar (`app/frontend/src/components/top-bar.test.tsx`, `breadcrumb-dropdown.test.tsx`): remove/rework hierarchy-dropdown and session-dropdown assertions; assert no-caret contiguous prefix in all three modes; assert the static session chip (boxed, no `▾`, no menu on click); keep `BreadcrumbDropdown` component tests via its remaining call sites. <!-- R2 -->
- [x] T009 [P] Update `app/frontend/src/components/compose-strip.test.tsx`: Send disabled + no primary fill on empty/whitespace (terminal target), both enabled with text, chord empty-submit still sends bare `\r`, selection mode unchanged. <!-- R3 -->
- [x] T010 [P] Update sidebar unit tests (`sidebar/index.test.tsx`, `sidebar/session-row.test.tsx` or nearest existing suites): server-header cluster renders `PlusIcon`/`CloseIcon` in the shared slot metrics; fade class toggles with the hook state (jsdom-level: hook mocked or scroll metrics stubbed). <!-- R5 -->
- [x] T011 Update affected e2e specs AND their sibling `.spec.md` companions in the same commit: `window-heading.spec.ts` (heading renders `Window: name` with single caret; any hierarchy-▾ assertions removed), `top-bar-overlap.spec.ts` (hierarchy/session-dropdown references), `compose-strip.spec.ts` (button enablement states), sidebar specs touched by the fade/header changes (`sidebar-panels.spec.ts`, `multi-server-sidebar.spec.ts`, `sidebar-autoscroll.spec.ts` — only where assertions actually break). Run through `just` recipes only (`just test-e2e "<spec>"`). <!-- R2 -->
- [x] T012 Verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, targeted `just test-e2e` for the specs in T011. Fix fallout. <!-- R1 -->

## Execution Order

- T001 blocks T002–T003 (they consume the hook/utility).
- T004–T007 are independent of each other and of T001–T003.
- T008–T010 follow their implementation tasks; T011–T012 run last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both sidebar viewports (sessions tree, SERVER panel resizable area) fade partial bottom content via the shared `rk-scroll-fade-bottom` + `useScrollEdgeFade` primitives; no other scrollables are touched.
- [x] A-002 R2: No heading mode renders a prefix caret; `HierarchyDropdown` no longer exists; the name-side `▾` switcher still opens window/board switching.
- [x] A-003 R3: Terminal-target `canSubmit` requires non-empty trimmed text; Insert/Send share the enablement rule on empty.
- [x] A-004 R4: The session crumb is a static boxed chip with no dropdown; `sessionItems` is gone.
- [x] A-005 R5: Server group header renders `PlusIcon`/`CloseIcon` in session-row slot metrics with matching right padding.

### Behavioral Correctness

- [x] A-006 R1: The fade renders ONLY while scrollable-and-not-at-end — a short list and a fully-scrolled list show no fade; drag-resize behavior of the SERVER panel is unchanged.
- [x] A-007 R3: Cmd/Ctrl+Enter on an empty composer still sends a bare `\r` (chord unchanged); a delivered empty submit still clears nothing destructive (existing semantics intact); selection-broadcast mode behavior is byte-identical.
- [x] A-008 R2: Palette `Go: tmux Server` / `Go: Host` actions still navigate (Constitution V preserved with the hierarchy ▾ gone).
- [x] A-009 R4: Session switching (sidebar + palette `Window: Switch to …`) and creation (palette `Session: Create`/`Create at Folder`, sidebar server-header `+`) all still work — nothing orphaned.

### Removal Verification

- [x] A-010 R2: No dead code remains from `HierarchyDropdown` (component, imports, props).
- [x] A-011 R4: No dead code remains from the session dropdown (`sessionItems`, and `onCreateSession` plumbing unless another consumer exists).

### Scenario Coverage

- [x] A-012 R2: `window-heading.spec.ts` (+ `.spec.md`) covers the single-caret heading; unit tests cover all three modes' no-caret prefixes.
- [x] A-013 R3: `compose-strip.test.tsx` covers the empty/non-empty button matrix and the unchanged chord empty-submit.
- [x] A-014 R1: Unit coverage exists for the fade hook's scrollable/at-end states.

### Edge Cases & Error Handling

- [x] A-015 R1: Portalled popovers (color pickers) remain unclipped/unfaded; the legacy non-resizable `CollapsiblePanel` mode (`overflow: visible`) gets no fade.
- [x] A-016 R4: Below `sm` (mobile), the breadcrumb still collapses per the existing rules — the static session chip rides the existing `hidden sm:flex` wrapper without new breakpoint behavior.

### Code Quality

- [x] A-017 Pattern consistency: fade utility follows `rk-*` conventions; icon swap reuses `sidebar/icons.tsx`; no new components where a class change suffices.
- [x] A-018 No unnecessary duplication: one shared hook/utility serves both viewports; `PlusIcon`/`CloseIcon` reused, not redrawn.
- [x] A-019 Type narrowing over assertions: no new `as` casts; hook returns typed state.
- [x] A-020 Tests included for changed behavior (constitution): unit + e2e updates land with the change; every touched `.spec.ts` updates its sibling `.spec.md` in the same commit.
- [x] A-021 No client polling introduced: the fade hook listens to scroll/resize events, no `setInterval`.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/breadcrumb-dropdown.tsx:14,173-183` (`icon` prop + the trigger's icon/persistent-caret branch) — its only call site was the removed session crumb; the surviving window/board switchers never pass `icon`, so the labeled-trigger branch is now dead in production.
- `app/frontend/src/components/top-bar.tsx` (`sessions` in `TopBarProps` / `TopBarSlot`, contexts/top-bar-slot-context.tsx) — TopBar no longer reads `sessions` after `sessionItems` was removed; kept deliberately (plan Assumption 8) to avoid churning every slot-registration call site, but now dead data flowing through the slot.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Fade detection lives in a new shared `useScrollEdgeFade` hook + one `rk-scroll-fade-bottom` CSS utility (hook + class, not a wrapper component) | Matches the `rk-*` utility convention and the two consumers' differing DOM shapes; a wrapper component would churn both call sites more | S:70 R:85 A:80 D:70 |
| 2 | Confident | No NEW e2e spec file for the fade; coverage is unit-level (hook) + existing sidebar specs updated only where they break | Scroll-edge fade is a CSS mask whose observable is a class toggle — jsdom unit tests cover the logic; a dedicated Playwright spec for a gradient adds flake risk without behavioral signal | S:60 R:80 A:75 D:60 |
| 3 | Confident | `onCreateSession` plumbing removal is conditional: removed only if the top-bar path is its last consumer (verify at apply with a usage sweep) | Intake marks it "if nothing else consumes them"; a live consumer elsewhere means only the top-bar wiring is removed | S:75 R:90 A:85 D:80 |
| 4 | Certain | The chord path (`classifyComposeEnter`, `lib/compose-keys.ts`) is untouched — only `canSubmit` in `compose-strip.tsx` changes for Fix 3 | User decision recorded in intake (clarified 2026-08-14) | S:95 R:85 A:90 D:90 |
| 5 | Confident | Fade geometry: 32px bottom gradient (`black → transparent`) and a 1px end-of-scroll epsilon in the hook | Plan specified "a short gradient" without a length; 32px ≈ one sidebar row height, so the fade covers exactly the partially-clipped row; the epsilon absorbs sub-pixel scroll reports so the fade never flickers at the end | S:80 R:80 A:70 D:65 |
| 6 | Confident | The hook observes content changes via ResizeObserver (element) + MutationObserver (childList subtree), no polling | Plan said "listening to scroll + resize/content changes"; row add/remove changes scrollHeight without firing scroll or a container resize, and Constitution/code-quality ban client polling | S:75 R:80 A:75 D:65 |
| 7 | Certain | The `caret` prop machinery was deleted from `HeadingPrefix`/`WindowHeading`/`PageHeadingDisplay` (not just left unused) | Acceptance A-010 requires no dead HierarchyDropdown props; the split-at-colon render path existed solely for the hierarchy ▾ | S:90 R:85 A:85 D:80 |
| 8 | Confident | `sessions` stays in `TopBarProps`/`TopBarSlot` even though TopBar no longer reads it | It remains page-registered slot data passed by app.tsx and every test harness; removing the type field would churn unrelated call sites for no behavioral gain (A-011 covered `sessionItems`/`onCreateSession`, both removed) | S:70 R:75 A:65 D:60 |
| 9 | Confident | The static session chip reuses a factored `CRUMB_BOX_CLASS` (box-only base) with `LINK_CRUMB_CLASS = CRUMB_BOX_CLASS + hover` | Plan required the chip to carry the siblings' box with no hover; factoring the shared base avoids duplicating the box classes while keeping hover reserved for interactive crumbs | S:80 R:80 A:75 D:70 |
| 10 | Confident | CollapsiblePanel gates the fade on `!legacyMode && isOpen && !transitioning` | Legacy mode keeps `overflow: visible` (not a clipping surface) per the intake; during the height transition overflow is `hidden`, so masking then would fade content that isn't actually clipped | S:80 R:75 A:70 D:60 |

10 assumptions (2 certain, 8 confident, 0 tentative).
