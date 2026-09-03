# Plan: Web Tile Empty-Tab Entry Points

**Change**: 260902-g2ga-web-strip-empty-tab-entry
**Intake**: `intake.md`

## Requirements

### Frontend: Strip Visibility

#### R1: Strip always renders with the web tile
The tab strip SHALL render unconditionally whenever the web tile renders (drop the `tabs.length >= 1 || drafts.length > 0` gate at `iframe-window.tsx:~1197` and update the stale comment at ~1019). At 0 tabs and 0 drafts the strip shows only the trailing `+`; drafts render in it as today. The onboarding panel remains the empty-family CONTENT below the strip (the `onboarding = tabs.length === 0` derivation and the content ternary are unchanged), the reduced URL bar keeps its existing `!onboarding` chrome gates, and the direct address-bar boot of slot 1 coexists. Double-click on empty strip space MUST open a draft at 0 tabs (existing handler, now reachable). The `+` keeps its cap-disable at 8.

- **GIVEN** a window with an empty web-tab family and the web tile open
- **WHEN** the tile renders
- **THEN** the strip renders with the `+` affordance and the onboarding panel renders below it

- **GIVEN** the 0-tab strip
- **WHEN** the user clicks `+` three times, then types an address and presses Enter (three times with different addresses)
- **THEN** three drafts open, and each Enter materializes one draft into the next dense slot (1, 2, 3) via the ordinary add verb + select

#### R2: Palette `Web: New tab` ungated (two seams)
`buildWebTabActions` (`lib/palette/web-tabs.ts`) SHALL emit the `web-tab-new` / `Web: New tab` entry unconditionally (remove the `count === 0` early return; every other entry keeps its exact count/boundary gate; the wrap math MUST NOT run at count 0). The `app.tsx` call-site SHALL move out of the `hasWebUrl` content-gate ternary to the enclosing `layout.order.includes("web")` level (beside `web-address`); `Web: Find in page` and the `Web: Zoom *` group stay content-gated. Doc comments at both seams update.

- **GIVEN** a window with an empty family and the web tile open
- **WHEN** the palette opens
- **THEN** `Web: New tab` is listed (and Next/Previous/Close/Move are absent), and selecting it opens + focuses a draft on the onboarding tile

### Tests

#### R3: Test updates prove the new rule
The e2e case at `web-tabs.spec.ts:109` (second scenario: 0 tabs → no strip) SHALL flip to assert the strip AND `web-tab-add` render at 0 tabs with the onboarding panel visible; a NEW e2e case SHALL prove 2–3 drafts opened from a 0-tab window materialize sequentially into dense tmux slots 1..n. Unit flips: `iframe-window.test.tsx:765` (strip present at 0 tabs; onboarding panel still renders with the strip mounted) and `palette/web-tabs.test.ts:33` + its `:9` header ("offers only `Web: New tab` for an empty family"). Every new/changed `test()` carries the Test Intent JSDoc; stale file-header prose updates.

- **GIVEN** the updated suites
- **WHEN** `just test-frontend` and the web-tabs e2e run
- **THEN** all pass, including the drafts-from-0 dense-slot case asserted against real tmux options

### Specs

#### R4: Spec updated
`docs/specs/ui-state.md` § Web Tabs Rendering (:276-278) SHALL state: the strip always renders with the web tile; onboarding is the empty-family content state below the strip, not stripless chrome.

- **GIVEN** the shipped change
- **WHEN** § Web Tabs is read
- **THEN** no text claims a stripless onboarding state

### Non-Goals

- Draft mechanics, add/select verbs, backend, CLI, tmux options — all untouched (intake § 3/Impact).
- Onboarding panel copy changes (no fourth "click +" row).

### Design Decisions

#### Strip is chrome, onboarding is content
**Decision**: The strip renders unconditionally; the onboarding state is demoted from "stripless chrome variant" to "empty-family content below the strip".
**Why**: Revives all three shipped draft entry points at once (`+`, double-click, palette) exactly where a browser user expects them; smallest possible change (one render gate + one palette gate).
**Rejected**: An onboarding-only "open a tab" affordance — a fourth entry point instead of unifying on the shipped three.
*Introduced by*: 260902-g2ga-web-strip-empty-tab-entry

## Tasks

### Phase 1: Implementation

- [x] T001 Drop the strip render gate in `app/frontend/src/components/iframe-window.tsx` (~1197) + update the ~1019 comment; confirm roving focus tolerates a tabless tablist (adjust aria only if needed — intake assumption 9); flip/extend `iframe-window.test.tsx` (:765 strip-at-0-tabs, onboarding-panel-with-strip coverage, strip-first-child ordering) <!-- R1 -->
- [x] T002 Ungate `Web: New tab` in `app/frontend/src/lib/palette/web-tabs.ts` (remove the count-0 early return, guard wrap math, keep other gates; update doc comment) and move the `app.tsx` call-site out of the `hasWebUrl` ternary to the `layout.order.includes("web")` level (comments updated); flip `palette/web-tabs.test.ts` :33 + :9 header <!-- R2 -->
- [x] T003 e2e `app/frontend/tests/e2e/web-tabs.spec.ts`: flip the :109 second scenario (strip + `+` at 0 tabs, onboarding visible) and add the drafts-from-0 case (2–3 drafts, sequential materialization → dense slots asserted via `_tmux.ts` `windowOption`); Test Intent JSDoc on both; update stale header prose <!-- R3 -->
- [x] T004 [P] Update `docs/specs/ui-state.md` § Web Tabs Rendering paragraph to the strip-always rule <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The strip (with `+`) renders at 0 tabs/0 drafts; onboarding panel renders below it; double-click-empty-space opens a draft at 0 tabs
- [x] A-002 R2: `Web: New tab` is offered with an empty family (both seams changed); Next/Prev/Close/Move stay count-gated; Find/Zoom stay content-gated
- [x] A-003 R3: e2e flip + drafts-from-0 dense-slot case pass; unit flips pass
- [x] A-004 R4: `docs/specs/ui-state.md` no longer claims stripless onboarding

### Behavioral Correctness

- [x] A-005 R1: The address-bar direct boot (Enter → slot 1) still works at 0 tabs with no draft selected; reduced-URL-bar chrome gates unchanged
- [x] A-006 R1: Materializing from 0 lands slot 1 and selects it; subsequent drafts land 2, 3 (dense)
- [x] A-007 R2: The wrap math in the builder never executes at count 0 (no NaN/throw path)

### Scenario Coverage

- [x] A-008 R1, R3: The three-drafts-from-empty GIVEN/WHEN/THEN is exercised end-to-end against real tmux

### Edge Cases & Error Handling

- [x] A-009 R1: `+` still disables at the 8-tab cap; Esc/× discard drafts at 0 tabs with no POST
- [x] A-010 R1: The empty tablist (zero `role="tab"` children) causes no roving-focus error and no console warning in unit/e2e runs — Isolation evidence (rework cycle 1): the `Maximum update depth exceeded` console error is PRE-EXISTING on clean HEAD c38dc5d4 — a baseline run of the pre-change spec with all g2ga edits reverted emits it 51× across 14 tests vs 54× across 15 tests with the change (same per-test rate; sources attribute to /ws/state + the closed-ring fetch, not the strip); this change neither introduces nor amplifies it, and no NEW warning appears in the empty-tablist scenario

### Code Quality

- [x] A-011 Pattern consistency: gates removed, not special-cased; comments state constraints, no change-id provenance in code or tests
- [x] A-012 No unnecessary duplication: no new entry-point mechanism, events, or state — existing seams only

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate.
- If an item is not applicable, mark checked and prefix with **N/A**.

## Deletion Candidates

- None — this fix exposes existing draft entry points without making other code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The strip-at-0-tabs a11y posture ships as-is unless roving focus or a console warning objects during T001; aria adjustments are made only reactively | Intake assumption 9 delegated this to apply; drafts already render as non-tab strip children so the precedent exists | S:60 R:80 A:70 D:60 |

1 assumptions (0 certain, 1 confident, 0 tentative).
