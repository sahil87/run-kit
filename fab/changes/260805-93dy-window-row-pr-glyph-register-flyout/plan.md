# Plan: Sidebar Window-Row PR Glyph + Register Flyout Card

**Change**: 260805-93dy-window-row-pr-glyph-register-flyout
**Intake**: `intake.md`

## Requirements

### Sidebar: Rest-state PR glyph (trailing cluster)

#### R1: Rest-state PR glyph for owned PRs
When a sidebar window row's window has an **owned PR** (`prOwnsDot(win)`: `!!prNumber && prState !== "closed"`), the trailing cluster MUST show a `GitPullRequestIcon` stroke-SVG glyph at rest, right-aligned so its right edge lands exactly where the hover ✕'s right edge sits (same 24px box, same right anchor inside the absolute icon-cluster container). The glyph MUST be informational only — `aria-hidden`, never focusable, never mouse-clickable. It MUST be colored via the shared PR vocabulary: `text-red-400` when `prDotState(win) === "fail"` (i.e. `isFailish`), else `text-purple-400` (open/merged). Ghost rows and rows without an owned PR MUST render no glyph. On coarse pointers the glyph MUST NOT be visible (the always-visible action cluster wins the slots).

- **GIVEN** a non-ghost window row whose window has `prNumber: 386, prState: "open", prChecks: "pass"`
- **WHEN** the row renders at rest (no hover)
- **THEN** a purple (`text-purple-400`) git-pull-request stroke glyph renders in the far-right (✕) slot, `aria-hidden`, non-interactive

- **GIVEN** the same window but `prChecks: "fail"` (or `prReview: "changes_requested"`)
- **WHEN** the row renders at rest
- **THEN** the glyph renders `text-red-400`

- **GIVEN** a window with `prState: "closed"` or no `prNumber`, or a ghost row
- **WHEN** the row renders
- **THEN** no PR glyph renders

#### R2: In-place hover swap + pinned-row slot discipline
On row hover the rest glyph MUST disappear entirely (display swap — `group-hover:hidden`-style conditional visibility, NOT an opacity fade over reserved space) and the existing pin + kill action cluster takes its place. A row pinned to a board keeps its persistent pin glyph in its own slot: rest = `[pin][PR]`, hover = `[pin][✕]` — the pin holds its slot; only the last slot swaps. The cluster container's rest inertness (`pointer-events-none` at rest, restored via `group-hover:` / `coarse:` / `has-[:focus-visible]:`) MUST be preserved, and the row button's reserved right padding (`pr-[68px]` / `pr-11`) MUST stay unchanged. When keyboard focus reveals the action cluster (`:focus-visible` within it), the glyph MUST also hide (no overlap with the revealed ✕).

- **GIVEN** a row with an owned PR pinned to a board
- **WHEN** the row is at rest
- **THEN** the persistent pin glyph and the PR glyph render (`[pin][PR]`)
- **AND WHEN** the pointer hovers the row
- **THEN** the PR glyph hides and the ✕ takes the last slot (`[pin][✕]`)

### Sidebar: Row-hover register flyout card

#### R3: Whole-row hover flyout, fixed-x anchor
A new flyout card (new module `app/frontend/src/components/sidebar/row-flyout-card.tsx`) MUST open on WHOLE-ROW hover of a sidebar window row, anchored to the ROW element (not the mouse, not the dot) with floating-ui `placement: "right"` + `FloatingPortal` (escaping the sidebar's overflow clip), so its x-position is fixed at the sidebar's right edge and vertically tracks the hovered row. Middleware: `offset(6)` / `flip()` / `shift({ padding: 8 })` / `autoUpdate`; width capped `max-w-xs`. Hover MUST use an open delay (`FLYOUT_OPEN_DELAY_MS = 350`) with a warm-window (`FLYOUT_WARM_WINDOW_MS = 500`) shared across ALL window rows so moving between rows retargets instantly instead of strobing — the flyout's own delay-group scope, a sibling mechanism to `TipGroup` (NOT a fatter tier-1 `Tip`, and NOT nested inside the sidebar's `TipGroup` context). `safePolygon()` MUST keep the pointer able to travel row → card to click the PR link. Only one card may be open at a time (opening a card closes any other open card).

- **GIVEN** a window row in the sidebar
- **WHEN** the pointer rests on the row for ~350ms
- **THEN** the card opens to the right of the sidebar, vertically aligned to the row
- **AND WHEN** the pointer moves to a sibling row
- **THEN** the first card closes and the sibling's card opens without the full delay (warm retarget)

#### R4: Card content — full four-register view + tip extras
The card MUST render: (a) a header line reusing `dotLabel(win, state)` (the dot's aria-label text) plus the docs info-icon link (`STATUS_DOT_DOCS_URL`, external, `stopPropagation`); (b) the full four-register view promoted from the PANE panel — `out` / `agt` / `fab` / `pr` lines with the fixed 3-char prefix vocabulary (`pr` NBSP-padded to the 4-advance column) and the PR line as colored segments, all resolved by the shared register helpers (R6) — absent layers render as absent (a plain shell pane shows only `out`); (c) the `checked Xs ago` freshness line via the `FreshnessLine` leaf component (leaf-scoped `useNow()`, omitted when `prFetchedAt` absent/unparseable); (d) an **"Open PR #N ↗"** anchor when `prUrl` exists (anchor-not-button, `target="_blank" rel="noopener noreferrer"`, `stopPropagation` so clicking never selects the row). Registers are read-only text; the PR link + docs icon are the card's only interactive elements. The tip's former standalone `agent:` line is subsumed by the `agt` register (no duplicate agent line).

- **GIVEN** a window with `fabChange`, `fabStage`, an open PR with `prUrl` + `prFetchedAt`, and `agentState: "waiting"`
- **WHEN** the card opens
- **THEN** it shows the dot label, `out`/`agt`/`fab`/`pr` register lines, the freshness line, the docs icon, and the "Open PR #N ↗" link
- **GIVEN** a plain shell pane (no agent, no fab, no PR)
- **WHEN** the card opens
- **THEN** it shows the label + docs icon and only the `out` register

#### R5: One surface — StatusDotTip replaced; three triggers
`StatusDotTip` (`status-dot-tip.tsx`) MUST be removed entirely; the flyout card is the one surface serving all three triggers: (a) fine-pointer whole-ROW hover; (b) **keyboard row focus** — focusing the row treeitem (roving tabindex) opens the card, Escape dismisses it; (c) **touch dot-tap** — on coarse pointers, tapping the `StatusDot` opens the card (`stopPropagation`, so the tap does not select the row), while the row-hover trigger is suppressed on touch (`mouseOnly` hover). `status-dot.tsx` MUST drop the tip wrapper AND the dot's `tabIndex={0}` tab stop (removing the accepted second-tab-stop tradeoff from `260616-37ub`); `dotLabel` stays as the dot's `aria-label` (unchanged, still in `status-dot-label.ts`). The card MUST close/suppress while a row drag is starting (`onDragStart`) and while the row's popovers (`PinPopover` / label `SwatchPopover`) are open. The card mounts only while open, and hover/open state stays row-local (inside `WindowRow`/the hook — never lifted to `Sidebar`).

- **GIVEN** a window row with the card open
- **WHEN** Escape is pressed, or the pointer leaves row+card, or a drag starts, or the pin/label popover opens
- **THEN** the card closes
- **GIVEN** a coarse-pointer device
- **WHEN** the user taps the row's status dot
- **THEN** the card opens and the row is NOT selected
- **AND WHEN** the user merely touches/moves over the row
- **THEN** no hover-open occurs

### Shared modules: register helpers + PR model exports

#### R6: Register helpers extracted to a shared module
The file-private register helpers in `sidebar/status-panel.tsx` — `getOutputLine`, `getAgentLine`, `getPrSegments` (+ the `PrSegment` type) and the fab-line builder (extracted as `getFabLine`) — MUST move to a shared module (`app/frontend/src/components/sidebar/registers.ts`) consumed by BOTH `WindowContent` (panel) and the flyout card, so the two surfaces render from one source with no duplication. Panel behavior MUST be byte-identical (existing `status-panel.test.tsx` passes unchanged).

- **GIVEN** the extraction is complete
- **WHEN** the panel and the card each render the same `WindowInfo`
- **THEN** their register strings/segments come from the same functions and agree

#### R7: `prOwnsDot` exported + glyph-color helper
`pr-status-model.ts` MUST export `prOwnsDot` (currently file-private) for the row's glyph gate, and MUST add a small exported glyph-color helper (`prGlyphColor(win)`) reusing `prDotState`/`isFailish` — `text-red-400` for fail, `text-purple-400` otherwise. No new color system, no new hex.

- **GIVEN** a window with `prChecks: "fail"`
- **WHEN** `prGlyphColor(win)` is called
- **THEN** it returns `text-red-400`; for open/merged/pending it returns `text-purple-400`

### Performance & accessibility invariants

#### R8: Sidebar memo-tree perf invariants preserved
The change MUST NOT defeat the sidebar memo tree (ui-patterns § Render Performance, hard constraints): `WindowRow` stays `memo`'d with all new state row-local; NO per-row hover/open state lifted to `Sidebar`; NO `nowSeconds` prop threaded into memoized components; every `useNow()` clock stays leaf-scoped inside the open card (card + `FreshnessLine`, both mounted only while open); the row itself never ticks per-second. Rest inertness, the label zone, drag-and-drop, popovers, and the roving-tabindex model MUST keep working.

- **GIVEN** an SSE tick on an unrelated server
- **WHEN** `Sidebar` re-renders
- **THEN** `WindowRow` bodies do not re-execute (existing React.memo unit test still passes)

### Tests

#### R9: Unit + Playwright e2e coverage with `.spec.md` companion
The change MUST ship: colocated unit tests for rest-glyph gating + color mapping + slot discipline (`window-row.test.tsx`), the card content resolver + freshness + register rendering (`row-flyout-card.test.tsx`), the extraction module (`registers.test.ts`), and `prOwnsDot`/`prGlyphColor` (`pr-status-model.test.ts`); AND a Playwright e2e spec (`tests/e2e/row-flyout.spec.ts` + sibling `row-flyout.spec.md` per constitution Test Companion Docs) covering: row-hover opens the card at the sidebar's right edge; warm-window retarget between rows; PR-link presence + row-select isolation (stopPropagation); rest glyph visible → hover swaps to pin+✕; keyboard path (row focus opens, Escape dismisses); coarse-pointer suppression of the hover trigger (+ dot-tap open). The obsolete `status-dot-tip.spec.ts`/`.spec.md` and `status-dot-tip.test.tsx` MUST be removed with the component. All tests run through `just` recipes only.

- **GIVEN** the implementation is complete
- **WHEN** `just test-frontend` and `just test-e2e "row-flyout"` run
- **THEN** all tests pass, and every new `.spec.ts` has a sibling `.spec.md`

### Non-Goals

- No backend changes, no API changes, no new routes, no new dependencies (`@floating-ui/react` already present).
- No hover-card on the `SessionTiles` window tile or PANE-panel-header dots — the tip is removed there without replacement (the PANE panel itself + the row flyout are the recovery surfaces; accepted in intake §4).
- No `docs/specs/status-pyramid.md` / `docs/memory` edits during apply — those are hydrate-stage (intake §5). Only the stale in-code comment in `window-row.tsx` is updated during apply.
- No re-gating of the glyph beyond `prOwnsDot` (deliberately NOT family-gated like dot ownership — intake #13).

### Design Decisions

#### Flyout warm-window via module-scoped delay state, not a nested FloatingDelayGroup
**Decision**: Implement the flyout's shared delay-group scope with module-scoped warm state (`lastClosedAt` + a single-open coordinator) and floating-ui's function-form `delay: () => Delay` on `useHover`, instead of wrapping the sessions tree in a second `FloatingDelayGroup`.
**Why**: `useDelayGroup` binds to the NEAREST `FloatingDelayGroup` context; the session rows render tier-1 `Tip`s inside the same subtree, so a nested provider would capture those tips — changing their delay and mixing tier-1/tier-2 warmth, violating the sidebar-is-one-warm-tip-cluster contract (`260722-73al`). Module state gives the flyout an independent warm cluster spanning all rows, and the installed `@floating-ui/react@0.27` `delay` option accepts a function evaluated at event time, so warmth is always current.
**Rejected**: Nested `FloatingDelayGroup` around the tree (captures session-row Tips); a per-row 350ms constant delay with no warmth (strobing on row sweeps — explicitly against the intake).
*Introduced by*: 260805-93dy-window-row-pr-glyph-register-flyout

#### Rest glyph as an absolute overlay on the last slot, not a third flex slot
**Decision**: Render the rest PR glyph absolutely positioned at the icon-cluster's right edge (over the kill button's slot, same 24px box), hidden via `group-hover:hidden` / `coarse:hidden` / cluster-focus-visible, while the pin/kill buttons keep today's opacity gating.
**Why**: The pin/kill buttons are opacity-gated (they occupy their slots at rest so they stay keyboard-focusable). A display-swap of the buttons themselves would make them unfocusable at rest (keyboard regression); overlaying the glyph on the last slot delivers the exact "PR sits where ✕ sits, only the last slot swaps" geometry with zero layout shift and no focus changes.
**Rejected**: `hidden`/`flex` swap on the buttons (breaks Tab reachability at rest); a third flex slot (glyph would sit left of ✕, not in its place).
*Introduced by*: 260805-93dy-window-row-pr-glyph-register-flyout

## Tasks

### Phase 1: Setup — shared vocabulary + extraction

- [x] T001 Export `prOwnsDot` and add `prGlyphColor(win)` (fail→`text-red-400`, else `text-purple-400`, via `prDotState`) in `app/frontend/src/components/pr-status-model.ts`; add unit tests for both in `app/frontend/src/components/pr-status-model.test.ts` <!-- R7 -->
- [x] T002 [P] Add `GitPullRequestIcon` (lucide git-pull-request: two rails + circles + arc) to `app/frontend/src/components/sidebar/icons.tsx` in the file's fixed idiom (`stroke="currentColor"`, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, `size = 13`, `aria-hidden`) <!-- R1 -->
- [x] T003 [P] Extract `getOutputLine`/`getAgentLine`/`getPrSegments`/`PrSegment` + new `getFabLine` into `app/frontend/src/components/sidebar/registers.ts`; rewire `app/frontend/src/components/sidebar/status-panel.tsx` `WindowContent` to import them (byte-identical panel output); add `app/frontend/src/components/sidebar/registers.test.ts`; verify `status-panel.test.tsx` passes unchanged <!-- R6 -->

### Phase 2: Core Implementation

- [x] T004 <!-- rework: cycle 1 — must-fix: pr-register prefix mojibake ("prÂ  " → "pr\u00a0\u00a0", add prefix assertion); register lines need truncate/min-w-0 inside max-w-xs card (match PANE panel). should-fix: openNow() must early-return when suppressed; stamp lastClosedAt only when this flyout was actually open; wrap card in FloatingFocusManager modal=false order=['reference','content'] so card links are Tab-reachable. nice-to-have: drop unused RowFlyout.open field, make RowFlyout type file-private. ALL APPLIED cycle 1: prefix = "pr\u00a0\u00a0" escapes with a codepoint-pinning unit test; RegisterLine carries min-w-0 truncate + e2e card scrollWidth<=clientWidth assertion; openNow gated on suppressed (unit test); lastClosedAt stamped only when activeFlyout===self (unit test); FloatingFocusManager modal=false order=[reference,content] added with initialFocus=-1 (hover-open must not steal focus; the manager default initial focus targets order[0]=reference) and returnFocus gated on focus-actually-entered-the-card (default returnFocus fired on hover-sweep closes - activeElement===body passes the manager moved-elsewhere guard - yanking focus to the just-left row and breaking the warm retarget; e2e covers Tab-reach + Escape return); RowFlyout.open dropped; RowFlyout type file-private. --> Create `app/frontend/src/components/sidebar/row-flyout-card.tsx`: `useRowFlyout(win, { suppressed })` hook (floating-ui `placement:"right"`, `offset(6)/flip()/shift({padding:8})/autoUpdate`, `FloatingPortal`, `useHover({ mouseOnly, move:false, delay:fn, handleClose: safePolygon() })`, `useFocus`, `useDismiss`; module-scoped warm state `FLYOUT_OPEN_DELAY_MS=350`/`FLYOUT_WARM_WINDOW_MS=500` + single-open coordination + test reset helper) and the card body (dotLabel header + docs `InfoIcon` link, four registers from `registers.ts` with card-level leaf `useNow()`, `FreshnessLine`, "Open PR #N ↗" anchor); migrate `STATUS_DOT_DOCS_URL`/`InfoIcon`/`FreshnessLine`/content resolution from `status-dot-tip.tsx` <!-- R3, R4 -->
- [x] T005 Remove the tip from the dot: `app/frontend/src/components/status-dot.tsx` renders the dot span directly (keep `role="img"`/`aria-label`/shapes/halo; DROP `tabIndex={0}` and the `StatusDotTip` wrapper); DELETE `app/frontend/src/components/status-dot-tip.tsx` and `status-dot-tip.test.tsx`; update `status-dot.test.tsx` (remove the `dotTipContent` describe; keep label/shape/halo suites) <!-- R5 -->
- [x] T006 Wire `app/frontend/src/components/sidebar/window-row.tsx`: rest PR glyph (absolute right-edge overlay in the `group/icons`-named cluster, `group-hover:hidden coarse:hidden group-has-[:focus-visible]/icons:hidden`, `prGlyphColor` + `GitPullRequestIcon`, `data-testid="row-pr-glyph"`); flyout wiring (`useRowFlyout` with `suppressed = ghost || showPinPopover || showLabelPicker`, `ref`/reference props on the row root, `{flyout.card}` render, drag-start close, coarse dot-tap wrapper with `stopPropagation`); update the stale Row-Minimalism comment (lines ~405-414 + trailer) to name the rest glyph + flyout <!-- R1, R2, R5, R8 -->

### Phase 3: Integration & Tests

- [x] T007 [P] Unit tests `app/frontend/src/components/sidebar/row-flyout-card.test.tsx`: card content (registers render per-layer + absent-as-absent, PR segments colored, "Open PR #N ↗" only when `prUrl`, docs link always, label = dotLabel), freshness line present/absent/unparseable (migrated from `status-dot-tip.test.tsx`), warm-state helpers (delay 350 cold / 0 within warm window) <!-- R4, R9 -->
- [x] T008 [P] Unit tests in `app/frontend/src/components/sidebar/window-row.test.tsx`: glyph gating (owned open/merged/failing PR → glyph; closed/no-PR/ghost → none), color mapping (purple vs red), slot-discipline classes (`group-hover:hidden`, `coarse:hidden`, aria-hidden, right-edge overlay inside the cluster; pin slot untouched), cluster inertness unchanged <!-- R1, R2, R9 -->
- [x] T009 New e2e `app/frontend/tests/e2e/row-flyout.spec.ts` + sibling `row-flyout.spec.md` (mocked backend via `mockStateSocket`, the `status-dot-tip.spec.ts` idiom): row-hover opens card at sidebar right edge (boundingBox x ≥ sidebar right); registers + PR link + docs link content; PR-link click does not select the row; warm retarget row A→B; rest glyph → hover swap to pin+✕; keyboard row-focus opens + Escape dismisses; coarse-pointer hover suppression + dot-tap open (mocked `(pointer: coarse)`); DELETE `tests/e2e/status-dot-tip.spec.ts` + `status-dot-tip.spec.md` <!-- R9, R3, R5 -->
- [x] T010 <!-- rework: cycle 1 — nice-to-have: row-minimalism.spec.md still says the StatusDot is the row's ONLY externally visible status signal, contradicted by the rest PR glyph; soften the prose. APPLIED: prose now names the dot PLUS the owned-PR rest glyph (93dy partial reversal) and notes the fixtures carry no prNumber. --> Sweep stale in-code references to `StatusDotTip`: `src/components/tip.tsx` doc comments (tier-2 example → the row flyout card), `src/types.ts` `prFetchedAt` comment, `tests/e2e/row-minimalism.spec.md` wording ("StatusDotTip" → flyout card) — comment-only edits, no behavior <!-- R5 -->

### Phase 4: Verification

- [x] T011 Run gates: `just test-frontend` (all unit suites incl. updated status-dot/window-row/status-panel), `cd app/frontend && npx tsc --noEmit` via the build path (`just build` or the frontend typecheck), then targeted e2e `just test-e2e "row-flyout"` plus regression `just test-e2e "row-minimalism"` and `just test-e2e "pane-register-panel"`; fix failures <!-- R9, R6, R8 -->

## Execution Order

- T001–T003 are independent ([P] where marked); T004 depends on T003 (registers) and T001; T005 depends on T004 (the tip's content must have a new home before deletion); T006 depends on T001, T002, T004.
- T007/T008 after T004–T006; T009 after T006; T010 after T005; T011 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A non-ghost row with an owned PR renders the aria-hidden `GitPullRequestIcon` glyph in the far-right slot at rest, purple for open/merged and red for failing; closed/no-PR/ghost rows render none
- [x] A-002 R2: Hover swaps the glyph out entirely (display swap) for the pin+✕ cluster; pinned rows read rest `[pin][PR]` → hover `[pin][✕]`; cluster rest-inertness classes and row right padding unchanged
- [x] A-003 R3: Whole-row hover opens the flyout card anchored `placement:"right"` to the row element via `FloatingPortal` with the `offset(6)/flip()/shift(8)/autoUpdate` middleware and `max-w-xs`; 350ms open delay with a shared 500ms warm-window retarget across rows; `safePolygon` bridge; single open card
- [x] A-004 R4: Card content = dotLabel header + docs icon link, the four out/agt/fab/pr registers from the shared helpers (absent-as-absent), FreshnessLine, and an "Open PR #N" anchor (stopPropagation) only when prUrl exists - MET after cycle-1 rework: the pr register prefix is now "pr\u00a0\u00a0" (2-char key + 2 NBSPs = the 4-advance column; codepoints pinned by a unit test) and register lines carry min-w-0 truncate so long fab/pr text ellipsizes inside the max-w-xs card (e2e asserts card scrollWidth <= clientWidth)
- [x] A-005 R5: `status-dot-tip.tsx` is deleted; `status-dot.tsx` has no tip wrapper and no `tabIndex`; the card opens on keyboard row-focus and dismisses on Escape; coarse dot-tap opens the card without selecting the row; hover trigger suppressed on coarse pointers
- [x] A-006 R6: `registers.ts` exports `getOutputLine`/`getAgentLine`/`getFabLine`/`getPrSegments`/`PrSegment`; both `WindowContent` and the card consume them; `status-panel.test.tsx` passes unchanged
- [x] A-007 R7: `prOwnsDot` is exported and `prGlyphColor` returns red only for fail-ish PRs, purple otherwise

### Behavioral Correctness

- [x] A-008 R5: The card closes/suppresses on drag start and while `PinPopover`/label `SwatchPopover` are open — met via `suppressed` + `onDragStart` close; the imperative coarse `openNow()` now early-returns when `suppressed` (cycle-1 rework, unit-tested), so no trigger bypasses the gate
- [x] A-009 R8: `WindowRow` stays `memo`'d; all flyout/hover state is row-local; no `nowSeconds` prop threaded into memoized components; `useNow()` only inside the open card (+ `FreshnessLine`); the React.memo stability unit test still passes

### Removal Verification

- [x] A-010 R5: No remaining imports/references to `StatusDotTip`/`dotTipContent`/`status-dot-tip` in `src/` or `tests/` (comments updated; `status-dot-tip.spec.ts`/`.md`/`.test.tsx` deleted) — only historical prose in comments remains; `docs/` refs are hydrate-scoped per Non-Goals

### Scenario Coverage

- [x] A-011 R9: e2e `row-flyout.spec.ts` (+ sibling `.spec.md` documenting each test) covers hover-open at the sidebar right edge, warm retarget, PR-link isolation, rest-glyph hover swap, keyboard focus-open + Escape, and coarse suppression + dot-tap; obsolete `status-dot-tip` e2e removed — all 6 pass
- [x] A-012 R9: Unit coverage exists for glyph gating/colors/slot discipline (`window-row.test.tsx`), card content + freshness + warm delay (`row-flyout-card.test.tsx`), register extraction (`registers.test.ts`), and `prOwnsDot`/`prGlyphColor` (`pr-status-model.test.ts`)

### Edge Cases & Error Handling

- [x] A-013 R4: A plain shell pane's card shows only the `out` register (+ label/docs); missing/unparseable `prFetchedAt` omits the freshness line; `prUrl` without `prNumber` renders "Open PR ↗" without `#undefined`
- [x] A-014 R1: A closed-unmerged PR never earns the glyph (`prOwnsDot` gate); coarse pointers never show the rest glyph

### Code Quality

- [x] A-015 Pattern consistency: New icon follows the icons.tsx idiom; the card reuses the established floating-ui middleware set and theme tokens; type narrowing over assertions - the register lines now use min-w-0 truncate matching the PANE panel rows they were promoted from (status-panel.tsx), resolving the A-004 overflow
- [x] A-016 No unnecessary duplication: register strings/segments resolved in exactly one module; PR colors via the existing shared vocabulary (no new hex); `FreshnessLine`/`InfoIcon`/docs-URL moved, not copied
- [x] A-017 Tests via `just` recipes only; UI change ships Playwright e2e + sibling `.spec.md` (constitution Test Companion Docs)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- ~~`row-flyout-card.tsx` `RowFlyout.open` field~~ — RESOLVED in cycle-1 rework: the zero-reader `open` field is dropped from both the returned object and the type
- ~~`row-flyout-card.tsx` `export type RowFlyout`~~ — RESOLVED in cycle-1 rework: the type is now file-private (`type RowFlyout = …`, line 270)
- `app/frontend/src/components/sidebar/row-flyout-card.tsx:180` (the card-level `useNow()` in `RowFlyoutContent`) — STILL OPEN: a SECOND per-second interval alongside `FreshnessLine`'s own leaf clock (line 141), so an open card runs two `setInterval`s. Both are leaf-scoped inside the open card, so the R8 perf contract holds and this is an optimization, not a defect; the `out` register's elapsed could read a single hoisted clock to collapse them
- `docs/specs/status-pyramid.md` §§ referencing `StatusDotTip` (lines ~70, 222, 225, 247, 283) and `docs/site/status-dot.md` lines ~153/156 — describe a component this change deleted; scheduled for hydrate per Non-Goals, listed here so the sweep is not lost
- `docs/memory/run-kit/ui-patterns.md` line 148's "file-private `hasFreshAgent`/`prOwnsDot`" claim — `prOwnsDot` is now `export`ed (R7), so the module-surface sentence is stale; hydrate-scoped alongside the entries below
- `docs/memory/run-kit/ui-patterns.md` § "Status Dot hover-card (`status-dot-tip.tsx`)" (line ~236) plus the `status-dot-tip.tsx` entries in the § PR-vocabulary consumer list (line 146) and § Impl symbols (line 228) — document deleted symbols (`dotTipContent`, `DotLink`, `DotTipContent`, the dot's `tabIndex={0}`); hydrate-scoped

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Flyout warm-window/delay-group implemented as module-scoped shared state + floating-ui function-form `delay` (not a nested `FloatingDelayGroup`), with single-open coordination | Intake asks for "a sibling mechanism to TipGroup" without pinning the mechanism; a nested provider would capture the session-row tier-1 Tips inside the tree (verified: `session-row.tsx` renders Tips, `TipGroup` wraps the sidebar root); installed floating-ui 0.27 supports `delay: () => Delay` | S:70 R:90 A:85 D:75 |
| 2 | Confident | Rest glyph = absolute overlay on the last (✕) slot; pin/kill buttons keep opacity gating (no display swap on the buttons themselves) | Preserves keyboard focusability of the actions at rest while delivering the user-approved "swap in place, right edges aligned" geometry exactly | S:65 R:85 A:85 D:75 |
| 3 | Confident | Card registers render as prefix+text lines WITHOUT the PANE panel's Nerd-Font/animated icon column (BrailleSnake/StarTwinkle/ClockSpinner) and without copy interactions | Intake pins registers as "read-only text" with the PR link + docs icon as the only interactive elements; the icon column is panel idiom, not part of the extracted string/segment source | S:60 R:90 A:80 D:70 |
| 4 | Confident | The tip's standalone `agent:` line is subsumed by the `agt` register (not rendered twice in the card) | Intake §4 says the tip content "folds into the card"; the agt register carries the identical `waiting 3m`-style value, and duplicating it would contradict the four-register promotion | S:60 R:90 A:80 D:75 |
| 5 | Confident | Ghost (optimistic) rows get no flyout and no glyph | Ghost rows have no real window data (no windowId, no PR/agent state); every other row affordance (drag, label zone, pin) is already ghost-gated | S:55 R:90 A:90 D:80 |
| 6 | Confident | Hover trigger uses `mouseOnly: true` so touch pointers never hover-open; touch path is exclusively the dot-tap (+ PANE panel) | Intake #17: "coarse-pointer suppression of the hover trigger"; tap-to-select must not fight tap-to-open on the row body | S:60 R:85 A:85 D:75 |
| 7 | Confident | New e2e file named `row-flyout.spec.ts` replacing `status-dot-tip.spec.ts` (same mocked-backend idiom); card/link testids renamed to `row-flyout-*` | The surface is renamed; keeping `dot-tip-*` ids on a row-level card would mislead future readers; intake names the spec content, not the ids | S:50 R:95 A:90 D:70 |

7 assumptions (0 certain, 7 confident, 0 tentative).
