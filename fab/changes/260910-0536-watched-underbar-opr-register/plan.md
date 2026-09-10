# Plan: Watched underbar overlay + `opr` register

**Change**: 260910-0536-watched-underbar-opr-register
**Intake**: `intake.md`

## Requirements

### StatusDot: the watched underbar overlay

#### R1: Optional `watched` input renders an additive underbar
`StatusDot` (`app/frontend/src/components/status-dot.tsx`) SHALL accept an optional `watched?: WatchedFlag` prop (`WatchedFlag = { stale: boolean }`). When `watched` is undefined the component MUST render exactly what it renders today (same element, classes, and `aria-label`). When `watched` is set, the existing dot element MUST be wrapped in a `relative inline-flex items-center justify-center shrink-0` span with a sibling bar span after it: `aria-hidden="true"`, `data-testid="status-dot-watched-bar"`, `absolute left-0 right-0 h-px`, painted from `currentColor` via the `rk-watched-underbar` utility.

- **GIVEN** a window with no `watched` prop
- **WHEN** `StatusDot` renders
- **THEN** the DOM is byte-identical to the pre-change output (no wrapper, no bar)

- **GIVEN** a window rendered with `watched={{ stale: false }}`
- **WHEN** `StatusDot` renders
- **THEN** the dot element keeps its hue class, shape style, halo class, and failed overlay unchanged
- **AND** a `status-dot-watched-bar` span is present, `aria-hidden`, with no `role`, `title`, or tab stop

#### R2: Neutral ink and geometry
The bar SHALL be `text-text-secondary` in every state (selected rows included) and MUST never carry `text-accent-green` or the dot's phase hue. It SHALL sit `-bottom-[4px]` under the 7px unflagged dot and `-bottom-[3px]` under the 9px flagged (`state.failed`) dot, so the watched footprint is ~12px tall in both cases and the bar clears the waiting halo's 3px box-shadow. The wrapper MUST carry no overflow rule (the halo paints outside the dot's border-box).

- **GIVEN** a watched fab window whose agent is `waiting`
- **WHEN** `StatusDot` renders
- **THEN** the dot carries `rk-waiting-halo` AND the bar is present at `-bottom-[4px]`

- **GIVEN** a watched fab window with `fabDisplayState: "failed"` and a live agent (bullseye)
- **WHEN** `StatusDot` renders
- **THEN** the 9px bullseye renders unchanged AND the bar sits at `-bottom-[3px]`

#### R3: Stale treatment is dimmed AND dashed
When `watched.stale` is true the bar MUST add `rk-watched-underbar-stale opacity-50` and `data-stale="true"`. `globals.css` SHALL define `.rk-watched-underbar { background: currentColor }` and `.rk-watched-underbar-stale { background: repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 3px) }` beside `.rk-waiting-halo`, with a one-line entry in the `prefers-reduced-motion` audit block noting the underbar is static by design. Staleness is consumed verbatim from `operatorStale`; nothing recomputes a threshold client-side.

- **GIVEN** `watched={{ stale: true }}`
- **WHEN** `StatusDot` renders
- **THEN** the bar has `rk-watched-underbar-stale`, `opacity-50`, and `data-stale="true"`
- **AND** with `stale: false` none of the three is present

#### R4: Accessible name grows one trailing clause
`dotLabel` (`app/frontend/src/components/status-dot-label.ts`) SHALL accept a third optional argument `watched?: WatchedFlag` and append ` — watched` (or ` — watched (operator stale)` when `watched.stale`) AFTER the waiting suffix. `StatusDot` passes its prop through. The label is unchanged when `watched` is undefined. `WatchedFlag` is exported from `status-dot-label.ts` (no import cycle) and re-exported by `status-dot.tsx`.

- **GIVEN** a building fab window at rest, watched, not stale
- **WHEN** the label is composed
- **THEN** it reads `building — at rest — watched`

- **GIVEN** an idle ad-hoc agent waiting 3m, watched, operator stale
- **WHEN** the label is composed
- **THEN** it reads `agent — idle — agent waiting 3m — watched (operator stale)`

### Sidebar row: `WatchedIndicator` retired, dot carries the flag

#### R5: `window-row.tsx` passes `watched` and drops the glyph
`WindowRow` SHALL render `<StatusDot win={win} watched={!ghost && win.monitored === true ? { stale: operatorStale } : undefined} />` inside the unchanged `status-dot-tap` wrapper. The `WatchedIndicator` component, its render site, and the now-unused `Tip` import MUST be removed; `data-testid="row-watched-indicator"` MUST no longer exist anywhere in `app/frontend/src`. The comments above the dot and in the Row Minimalism block SHALL name the row's signals as hue = journey, shape = liveness, additive halo = waiting, additive red center = failed, additive underbar = watched by the operator.

- **GIVEN** a non-ghost window with `monitored: true`
- **WHEN** the row renders
- **THEN** the dot carries `status-dot-watched-bar` and its `aria-label` ends with `— watched`
- **AND** `row-watched-indicator` is absent

- **GIVEN** a window with `monitored` false/absent, or a ghost window
- **WHEN** the row renders
- **THEN** no bar renders and the dot's label is unchanged

#### R6: `operatorLastTickAt` threads beside `operatorStale`
`WindowRow` SHALL gain `operatorLastTickAt?: number` (unix seconds, 0/absent = never ticked; threaded unchanged from `ProjectSession.operatorLastTickAt`) and pass `operator={{ stale: operatorStale, lastTickAt: operatorLastTickAt }}` to `WindowFlyoutContent`. `sidebar/index.tsx` SHALL thread it at the three existing `operatorStale` sites (operator-entry builder ~2502, pinned operator row ~2879, tree row ~3059).

- **GIVEN** a session with `operatorLastTickAt: 1700000000`
- **WHEN** its tree row and the pinned operator row render
- **THEN** each `WindowRow` receives that value as `operatorLastTickAt`

### Registers: the fifth `opr` register

#### R7: Shared resolver `getOperatorParts`
`sidebar/registers.ts` SHALL export `OperatorLoopFacts = { stale: boolean; lastTickAt?: number }`, `OperatorParts = { head: string; facets?: string }`, and `getOperatorParts(win, operator, nowSeconds): OperatorParts | null`. Null unless `win.monitored === true`. `head` = `watched` + ` · <monitoredStage>` (omitted when absent) + ` · tick <formatDuration(nowSeconds - lastTickAt)> ago` (omitted when `lastTickAt` is 0/undefined or `operator` is undefined; a non-positive elapsed renders `tick 0s ago`). `facets` = `<monitoredRepo> · <monitoredBranch>` with empty segments omitted, undefined when both absent. Uses the existing `formatDuration` from `@/lib/format`; holds no clock.

- **GIVEN** `monitored: true, monitoredStage: "apply", monitoredRepo: "run-kit", monitoredBranch: "fab/wuiu"`, `operator = { stale: false, lastTickAt: now - 120 }`
- **WHEN** resolved
- **THEN** `head` is `watched · apply · tick 2m ago` and `facets` is `run-kit · fab/wuiu`

- **GIVEN** `monitored: true, monitoredStage: "review"` and no `lastTickAt`
- **WHEN** resolved
- **THEN** `head` is `watched · review` and `facets` is undefined

- **GIVEN** `monitored` false or absent
- **WHEN** resolved
- **THEN** the result is null

#### R8: Flyout card renders `opr` last; `WatchedLine` is removed
`WindowFlyoutContent` (`sidebar/row-flyout-card.tsx`) SHALL gain `operator?: OperatorLoopFacts`, delete `WatchedLine` (and `row-flyout-watched-line`), and render the `opr` register as the LAST body register after the `pr` block: a `RegisterLine` with `prefix="opr "`, `testid="row-flyout-opr"`, head text `text-text-primary` (or `text-text-secondary` with `data-stale="true"` on the line when `operator.stale`), plus a `ContinuationLine` (`testid="row-flyout-opr-facets"`) for `facets` when present. The `nowSeconds` argument is `Math.floor(Date.now() / 1000)` read once per render (the card holds no clock, matching `NoteLine`). `hasBody` keeps its existing `win.monitored` term.

- **GIVEN** a monitored window with stage, repo, branch and a live tick
- **WHEN** the card opens
- **THEN** `row-flyout-opr` reads `opr watched · apply · tick 2m ago`, `row-flyout-opr-facets` reads `run-kit · fab/wuiu`, and both follow the `pr`/`fab` registers in DOM order

- **GIVEN** an unmonitored window
- **WHEN** the card opens
- **THEN** neither `row-flyout-opr` nor `row-flyout-watched-line` exists

#### R9: PANE panel renders `opr` after `fab`
`WindowPanel` and `WindowContent` (`sidebar/status-panel.tsx`) SHALL accept `operator?: OperatorLoopFacts`. When `getOperatorParts` is non-null, render after the `fab` row: `<div className="truncate" data-testid="register-operator" data-stale=…>` with a `Tip label="Operator watchlist"` on an `opr ` prefix span (`text-text-secondary`), then head + (` · ` + facets when present) in `text-text-primary` (stale ⇒ `text-text-secondary`). No per-layer icon. The "four orthogonal signal registers" comment and the `tmx/cwd/git/out/agt/fab/pr` vocabulary comment SHALL be updated to five / include `opr`.

- **GIVEN** the PANE panel shows a monitored window with `operator = { stale: true, lastTickAt: now - 2460 }`
- **WHEN** it renders
- **THEN** `register-operator` reads `opr watched · … · tick 41m ago …`, carries `data-stale="true"`, and its value text is `text-text-secondary`

- **GIVEN** an unmonitored window
- **WHEN** it renders
- **THEN** `register-operator` is absent

#### R10: `BottomPanels` resolves the owning session's operator facts
`BottomPanels` (`sidebar/index.tsx`) SHALL derive `{ stale: session.operatorStale === true, lastTickAt: session.operatorLastTickAt }` from the session that owns `selectedWindow` (the route session on a server route; on the board route the session found for `focusedPane.server`/`windowId`) and pass it as `operator` to `WindowPanel`; the thin pin-only fallback window passes undefined.

- **GIVEN** a server route with a monitored selected window whose session is stale
- **WHEN** the PANE panel renders
- **THEN** `register-operator` carries `data-stale="true"`

### Documentation

#### R11: Reference set counts three overlays and five registers
`docs/specs/status-pyramid.md` § The Channel Model SHALL list the watched underbar as a third additive overlay (geometry, neutral ink, stale = dimmed + dashed, sidebar window row only), note the five registers on the hover-card row, mention the `— watched` label clause, link the study `docs/wiki/watched-row-indicator-studies.html`, and record the rejected watched placements. `docs/specs/cron.md` SHALL replace its "watched-row ◉ indicators" mentions with the underbar and point the detail line at the `opr` register. `docs/site/status-dot.md` SHALL add the overlay row to § 3, update the header count, add composed examples, and count five registers. `README.md` § Status dots SHALL name the third overlay in one clause. `docs/img/status-dot-reference.svg` SHALL gain a third overlay legend row and updated overlay counts.

- **GIVEN** the docs after the change
- **WHEN** grepping `docs/specs`, `docs/site`, `README.md` for `◉`
- **THEN** no reference to the row glyph remains outside the study and the archive

### Non-Goals

- The marker well (`@/marker`, mode × stage) — human-declared; no marker code is read or written, and the auto-chevron never stands in for watched
- The other four `StatusDot` mounts (dashboard window cards, PANE header, status bar, tty tile header) — they pass no `watched` and render byte-identical output
- Backend — `monitored*`, `operatorStale`, `operatorLastTickAt` already ride the payload
- e2e coverage — no spec asserts the watched surface and the e2e rig stages no fab operator state file; vitest owns coverage

### Design Decisions

#### Watched is an additive overlay, never a hue or a shape
**Decision**: "On the operator's watchlist" renders as a 1px neutral underbar beneath the StatusDot, on the sidebar window row only.
**Why**: The pyramid's channels are all owned (hue = journey, shape = liveness, red center = failed, yellow halo = waiting, glyph = remote story). A relation flag must be additive; above/below the dot is the one free slot, and neutral ink cannot be misread as journey.
**Rejected**: green ◉ (spends the PR-ready hue, second dot silhouette); neutral ◉ (bullseye trap beside a gray ring); orbit ring (17px footprint in a 24px row, third concentric shape); reticle ticks (noise at 7px, halo collision); dashed dot border (border style IS the liveness channel and was the pre-#802 failed rendering); marker-well texture (human-owned well); ghost headset (headset = "this row IS the operator"); dotted name underline (reads as a link, rides inline rename — parked fallback); nothing on the row (no glance surface — interim fallback).
*Introduced by*: 260910-0536-watched-underbar-opr-register

#### Every dot overlay has a register
**Decision**: The watched overlay is backed by a fifth `opr` register (`watched · stage · tick age`, facets `repo · branch`) on both register surfaces, resolved by one shared `getOperatorParts`.
**Why**: The dot is documented as a pure function of the register lines; an overlay without a register breaks that contract and leaves the stale dimming unexplainable from the card.
**Rejected**: keeping the free-form `WatchedLine` (a fifth signal with no register key, placed among notes rather than registers).
*Introduced by*: 260910-0536-watched-underbar-opr-register

### Deprecated Requirements

#### `WatchedIndicator` ◉ glyph (wuiu)
**Reason**: Off-grid — spends the PR-ready hue on a relation and adds a second dot silhouette.
**Migration**: the `StatusDot` `watched` prop / underbar (R1–R5).

#### `WatchedLine` flyout line (wuiu)
**Reason**: A fifth signal rendered as a note rather than a register.
**Migration**: the `opr` register (R7–R10).

## Tasks

### Phase 1: Setup

- [x] T001 Add `.rk-watched-underbar` / `.rk-watched-underbar-stale` utilities beside `.rk-waiting-halo` in `app/frontend/src/globals.css` (comment states the neutral-ink + dimmed-AND-dashed contract, no narration) and one audit line in the `prefers-reduced-motion` block noting the underbar is static <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 In `app/frontend/src/components/status-dot-label.ts` export `WatchedFlag`, add the optional third `watched` argument to `dotLabel`, and append the ` — watched` / ` — watched (operator stale)` clause after the waiting suffix; update the module docblock <!-- R4 -->
- [x] T003 In `app/frontend/src/components/status-dot.tsx` add the `watched?: WatchedFlag` prop (re-export the type), pass it to `dotLabel`, and wrap the dot in the relative span with the `status-dot-watched-bar` sibling (`h-px left-0 right-0 text-text-secondary rk-watched-underbar`, `-bottom-[4px]` / `-bottom-[3px]` when `state.failed`, stale ⇒ `rk-watched-underbar-stale opacity-50` + `data-stale`); byte-identical output when `watched` is undefined; docblock "TWO additive overlay flags" → three <!-- R1, R2, R3 -->
- [x] T004 [P] In `app/frontend/src/components/sidebar/registers.ts` add `OperatorLoopFacts`, `OperatorParts`, and `getOperatorParts(win, operator, nowSeconds)` using `formatDuration`; update the module docblock to five registers <!-- R7 -->
- [x] T005 In `app/frontend/src/components/sidebar/window-row.tsx` delete `WatchedIndicator` and its render site, drop the unused `Tip` import, pass `watched` to `StatusDot`, add the `operatorLastTickAt?: number` prop (doc shape mirrors `operatorStale`), pass `operator={{ stale: operatorStale, lastTickAt: operatorLastTickAt }}` to `WindowFlyoutContent`, and update the dot / Row Minimalism comments <!-- R5, R6 -->
- [x] T006 In `app/frontend/src/components/sidebar/row-flyout-card.tsx` delete `WatchedLine`, add `operator?: OperatorLoopFacts` to `WindowFlyoutContent`, and render the `opr` register (`RegisterLine prefix="opr " testid="row-flyout-opr"` + `ContinuationLine testid="row-flyout-opr-facets"`, stale ⇒ `text-text-secondary` + `data-stale`) as the last body register after the `pr` block; update the body comment <!-- R8 -->
- [x] T007 In `app/frontend/src/components/sidebar/status-panel.tsx` add `operator?: OperatorLoopFacts` to `WindowPanel`/`WindowContent`, render the `register-operator` row after the `fab` row with the `Operator watchlist` Tip on the `opr ` prefix (stale ⇒ `text-text-secondary` value + `data-stale`), and update the "four orthogonal signal registers" and `tmx/cwd/git/out/agt/fab/pr` comments <!-- R9 -->
- [x] T008 In `app/frontend/src/components/sidebar/index.tsx` thread `operatorLastTickAt` at the three `operatorStale` sites (operator-entry builder, pinned operator row, tree row) and derive `operator` for `WindowPanel` in `BottomPanels` from the owning session (route session, or the board-route focused pane's session; undefined for the thin fallback) <!-- R6, R10 -->

### Phase 3: Integration & Edge Cases

- [x] T009 [P] Extend `app/frontend/src/components/status-dot.test.tsx`: describe "additive watched underbar" — bar only when `watched` passed; `aria-hidden`; `text-text-secondary` and never `text-accent-green`/phase hue; stale classes + `data-stale`; base dot classes identical with and without `watched`; halo + bar compose; flagged dot ⇒ `-bottom-[3px]`; `dotLabel` cases from R4 (order after the waiting suffix, stale phrasing) <!-- R1, R2, R3, R4 -->
- [x] T010 [P] Replace the `WatchedIndicator (wuiu)` describe in `app/frontend/src/components/sidebar/window-row.test.tsx` with underbar assertions: bar present when `monitored`; none when false/absent or ghost; `operatorStale` ⇒ stale bar; `row-watched-indicator` absent; the dot's `aria-label` ends with `— watched` / `— watched (operator stale)` <!-- R5 -->
- [x] T011 [P] Add `getOperatorParts` cases to `app/frontend/src/components/sidebar/registers.test.ts`: null when unmonitored; head/facets composition; omitted stage; omitted tick when `lastTickAt` is 0/undefined or `operator` undefined; age formatting via `formatDuration` <!-- R7 -->
- [x] T012 [P] Replace the `Watched register (wuiu)` describe in `app/frontend/src/components/sidebar/row-flyout-card.test.tsx` with `row-flyout-opr` / `row-flyout-opr-facets` assertions: text, DOM position after the `pr`/`fab` registers, absent when unmonitored, stale dimming via `data-stale`; assert `row-flyout-watched-line` is gone <!-- R8 -->
- [x] T013 [P] Extend `app/frontend/src/components/sidebar/status-panel.test.tsx`: `register-operator` renders for a monitored window with the `opr` key and the `Operator watchlist` tip, absent otherwise, stale dimming via `data-stale` and `text-text-secondary` <!-- R9, R10 -->
- [x] T014 Run `just test-frontend` and `cd app/frontend && npx tsc --noEmit` to green; then a scoped `just test-e2e "row-flyout"` smoke to confirm no sidebar regression; visually verify in `just dev` (or a Playwright screenshot of a monitored row) that the 1px bar reads at both themes and composes with the halo <!-- R1, R2, R3, R5 -->

### Phase 4: Polish

- [x] T015 [P] Update `docs/specs/status-pyramid.md` (third overlay row, five registers, label clause, study link, rejected placements) and `docs/specs/cron.md` (◉ mentions → underbar; detail line → `opr` register) <!-- R11 -->
- [x] T016 [P] Update `docs/site/status-dot.md` (§ 3 overlay row, header count, composed examples, five registers) and the `README.md` § Status dots overlays clause <!-- R11 -->
- [x] T017 [P] Update `docs/img/status-dot-reference.svg`: third OVERLAYS legend row (blue ring + 1px gray underbar, caption "watched underbar = on the fab operator's watchlist (sidebar row only) · stale: dimmed + dashed") and the overlay counts in the footer lines <!-- R11 -->

## Execution Order

- T002 blocks T003 (the `WatchedFlag` type and label signature)
- T004 blocks T006, T007 (the resolver)
- T003, T005, T006, T007 block T008 (props must exist before threading)
- T009–T013 run after T008; T014 after all of T009–T013
- T015–T017 are independent of code tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: `StatusDot` renders the `status-dot-watched-bar` only when `watched` is passed, and byte-identical output otherwise
- [x] A-002 R2: The bar is `text-text-secondary`, sits at `-bottom-[4px]` (unflagged) / `-bottom-[3px]` (flagged), and composes with the waiting halo
- [x] A-003 R3: Stale renders `rk-watched-underbar-stale opacity-50` + `data-stale="true"`; the two utilities exist in `globals.css` with the reduced-motion audit line
- [x] A-004 R4: `dotLabel` appends ` — watched` / ` — watched (operator stale)` after the waiting suffix and is unchanged when `watched` is undefined
- [x] A-005 R5: `WindowRow` passes `watched` for non-ghost monitored windows and `WatchedIndicator` is gone
- [x] A-006 R6: `operatorLastTickAt` reaches `WindowRow` at all three sidebar sites and flows to the flyout card as `operator`
- [x] A-007 R7: `getOperatorParts` composes head/facets per the scenarios and returns null when unmonitored
- [x] A-008 R8: The flyout card renders `row-flyout-opr` (+ facets) last, with stale dimming, and `WatchedLine` is removed
- [x] A-009 R9: The PANE panel renders `register-operator` after `fab` with the `Operator watchlist` tip and stale dimming
- [x] A-010 R10: `BottomPanels` passes the owning session's operator facts to `WindowPanel` (undefined for the thin fallback)
- [x] A-011 R11: spec, cron spec, site page, README, and SVG legend reflect three overlays / five registers with no stray ◉

### Behavioral Correctness

- [x] A-012 R2: No watched rendering path emits `text-accent-green` or the phase hue on the bar
- [x] A-013 R3: Staleness is read from the `operatorStale` prop only — no client-side threshold computation
- [x] A-014 R1: The other four `StatusDot` mounts pass no `watched` and their snapshots/labels are unchanged

### Removal Verification

- [x] A-015 R5: `row-watched-indicator`, `WatchedIndicator`, and the `Tip` import are absent from `window-row.tsx`; no test references `row-watched-indicator`
- [x] A-016 R8: `WatchedLine` and `row-flyout-watched-line` are absent from source and tests

### Scenario Coverage

- [x] A-017 R1: Vitest covers watched + halo, watched + bullseye, and unwatched byte-identity
- [x] A-018 R7: Vitest covers `watched · apply · tick 2m ago` with facets, `watched · review` without tick, and the null case
- [x] A-019 R8: Vitest covers `opr` position after `pr`/`fab` and absence when unmonitored
- [x] A-020 R9: Vitest covers the PANE `opr` row present/absent and stale

### Edge Cases & Error Handling

- [x] A-021 R7: `lastTickAt` of 0/undefined omits the tick segment; a non-positive elapsed renders `tick 0s ago`
- [x] A-022 R5: Ghost rows never render the bar even when `monitored` is set

### Code Quality

- [x] A-023 Pattern consistency: new code follows the `rk-*` utility convention, the `RegisterLine`/`ContinuationLine` idiom, and the registers.ts pure-resolver pattern
- [x] A-024 No unnecessary duplication: `formatDuration` and the shared resolver are reused; no second age formatter or second register renderer
- [x] A-025 Type narrowing over assertions: no new `as` casts; `watched`/`operator` are narrowed with guards
- [x] A-026 Comments state constraints, not narration: no change IDs, no "this preserves X", no next-line narration in new comments
- [x] A-027 Tests cover the added/changed behavior in all five touched test files and `just test-frontend` is green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None discovered — the planned removals (`WatchedIndicator`, `WatchedLine`, the `Tip` import in `window-row.tsx`, `row-watched-indicator`, `row-flyout-watched-line`) were fully executed and are tracked under `## Acceptance > ### Removal Verification`. `resolveFocusedWindow` (`app/frontend/src/lib/focused-pane-window.ts:21`) lost its `sidebar/index.tsx` call site to the inline owning-session lookup in `BottomPanels`, but keeps live call sites in `operator-console.tsx` and `lib/operator-console.ts` — not redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `WatchedFlag` lives in `status-dot-label.ts` and is re-exported by `status-dot.tsx` | Mirrors the existing `dotLabel` extraction that avoids the label↔dot import cycle | S:80 R:90 A:85 D:75 |
| 2 | Confident | The flyout card reads `Math.floor(Date.now() / 1000)` once per render for the `opr` tick age rather than subscribing to `useNow` | Matches `NoteLine`'s as-of-last-frame contract and the card's render-performance rule; the PANE panel already has `nowSeconds` from `useNow` | S:75 R:90 A:85 D:70 |
| 3 | Confident | A non-positive elapsed (clock skew) renders `tick 0s ago` instead of omitting the segment | Omission would misreport a live tick as "never ticked"; `getOutputLine` also clamps at zero | S:65 R:90 A:80 D:65 |
| 4 | Confident | `opr` on the PANE panel is a plain `div` (not `CopyableRow`) with no per-layer icon | The watchlist has no animated mark and no copyable identity token; the `pr` row already establishes the icon-less variant | S:70 R:90 A:80 D:70 |
| 5 | Confident | The flyout title (`WindowFlyoutTitle`) does not add the watched clause; only the dot's `aria-label` does | The `opr` line beneath already carries the fact; duplicating it in the title restates a register | S:65 R:95 A:80 D:65 |
| 6 | Certain | Stale `opr` head text uses `text-text-secondary` + `data-stale`, not `opacity-50` | Intake assumption 19; matches `NoteLine`'s stale text idiom while the bar owns dimmed+dashed | S:80 R:95 A:85 D:80 |
| 7 | Confident | The e2e smoke is the existing `row-flyout` spec scoped run; no new e2e spec | Intake assumption 15; the rig stages no operator state file | S:60 R:85 A:60 D:55 |

7 assumptions (1 certain, 6 confident, 0 tentative).
