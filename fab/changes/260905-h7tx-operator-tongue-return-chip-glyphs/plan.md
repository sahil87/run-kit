# Plan: Operator Tongue Return Toggle + Compose-Chip Glyph Fixes

**Change**: 260905-h7tx-operator-tongue-return-chip-glyphs
**Intake**: `intake.md`

## Requirements

### Operator Console: Tongue return toggle

#### R1: The tongue renders a return state on the operator route
On the operator window's terminal route (the exact condition that today returns `null` — `routeServer === server && routeWindow === target.window.windowId`), `OperatorConsoleTongue` (`app/frontend/src/components/operator-console.tsx`) SHALL render in a **return state** instead of hiding: visually distinct from the down-tab (a `⌃` glyph or the origin window's name in the tab, with a testable state attribute), with the amber `waiting` dot suppressed. Tap navigates BACK with priority: (a) a validated `?from=` origin window on the same server → `/$server/$from`; (b) else router history back when a back entry exists; (c) else the server route `/$server`. A `?from=` naming an unknown, cross-server, or self window falls through to (b)/(c). Non-operator routes, operator-less servers (hidden), and the mobile-only gate are byte-unchanged.

- **GIVEN** a mobile viewport on `/$srv/<opWin>?from=@5` (valid same-server origin)
- **WHEN** the tongue renders and is tapped
- **THEN** it shows the return state (no amber dot) and navigates to `/$srv/@5`
- **AND GIVEN** no/invalid `?from=` with history, **THEN** the tap goes history-back; with neither, to `/$srv`
- **AND GIVEN** a non-operator route, **THEN** today's down-tab (dot when waiting) renders unchanged

#### R2: Context-chip label is tappable at the operator-route mount only
`OperatorContextChip` (`app/frontend/src/components/operator-context-chip.tsx`) SHALL gain an opt-in navigate prop; when provided, the `from: @N "name"` label becomes a tappable control that navigates to the subject window's terminal route. The ✕ stays dismiss-only. The prop is passed ONLY at the operator-route compose-strip mount in `compose-strip.tsx`; the desktop omnibox mount passes nothing and is byte-unchanged.

- **GIVEN** the operator route's compose strip with the chip attached
- **WHEN** the label is tapped
- **THEN** the app navigates to the origin window's route (chip not dismissed by the tap)
- **AND GIVEN** the omnibox chip, **THEN** the label is inert exactly as today

### Compose Strip: Chip glyphs and order

#### R3: History and newline glyphs sized to match the attach chip; history glyph becomes ↺
In `compose-strip.tsx` (~:1049–1104) the history and newline chips' glyph spans SHALL move from `text-xs` to the larger step that visually matches 📎's emoji weight (`text-base` or `text-lg` — implementer judgment); button boxes, `coarse:` targets, and the 375px single-row budget are untouched. The history glyph SHALL become `↺` (U+21BA); `aria-label="Recall sent text"`, `data-testid="compose-strip-history"`, the flyout, the recall walk, and ↑-key recall behavior are all unchanged. The fine-pointer close chip's glyph MAY be bumped for consistency if trivial.

- **GIVEN** the mobile card
- **WHEN** it renders with sent history
- **THEN** the ↺ and ⏎ glyphs read at the attach chip's visual weight and the history chip shows ↺, not ↑

#### R4: Chip order — attach · newline · history
The card row order SHALL become: attach 📎 first, newline ⏎ second, history ↺ third; each chip's render conditions are byte-unchanged (only relative position moves), the fine-pointer close chip keeps its slot after 📎, and the compact row follows the same relative order where both render.

- **GIVEN** a coarse-pointer card with a non-empty composer and sent history
- **WHEN** the footer renders
- **THEN** the chips read 📎 · ⏎ · ↺ (· Send)

### Tests

#### R5: Coverage moves with the behavior
Unit: `operator-console.test.tsx` tongue suites gain return-state cases (render instead of null, tap priority a/b/c, dot suppression, non-operator unchanged); `compose-strip.test.tsx` covers the ↺ glyph and new order; chip navigate-prop coverage (tap navigates when provided, inert otherwise, ✕ still dismisses). e2e: the `operator-console.spec.ts` mobile-navigation suite gains the return-toggle assertions (return-state tongue, tap back to `?from=` origin, chip-label return); `compose-strip.spec.ts` swept for glyph/order assumptions. Mobile e2e uses direct `goto` + `__rkTerminals` poll; every added/modified `test()` carries updated Proves/Steps intent comments in the same commit.

- **GIVEN** the changed surfaces
- **WHEN** `just test-frontend` and the scoped e2e run
- **THEN** all pass with intent comments matching the behavior

### Non-Goals

- Desktop console behavior (drawer, machine, omnibox chip) — untouched beyond the unused opt-in prop.
- Any change to send/recall semantics — glyph, size, and position only on the strip.
- New palette actions — the taps are pointer conveniences over navigation with existing keyboard paths.

### Design Decisions

#### The tongue is a toggle, mirroring desktop ⌘J
**Decision**: on the operator route the tongue renders a return state (tap = back: `?from=` origin → history back → server route) instead of hiding.
**Why**: mobile entry to the operator is one tap but exit had no standing affordance; one tab that goes in and out matches the desktop ⌘J model and uses the `?from=` fact the URL already carries.
**Rejected**: keeping the tongue hidden (one-way door); a top-bar back button (the history arrows are hidden below `lg` by the degradation ladder and a second affordance splits the model).
*Introduced by*: 260905-h7tx-operator-tongue-return-chip-glyphs

#### History glyph is ↺, sized with the row
**Decision**: the sent-history chip's glyph becomes `↺` at a glyph-span size matching the attach emoji; order becomes 📎 · ⏎ · ↺.
**Why**: `↑` collides with the recall walk's cursor meaning and reads as a plain arrow; `↺` reads "recall". The emoji/text glyph size gap made the row read as one big chip and two small ones; the more frequent newline action moves ahead of history.
**Rejected**: `🕘` (breaks the glyph register everywhere but the attach chip); enlarging button boxes (the 375px row budget is fixed — the glyph, not the box, was small).
*Introduced by*: 260905-h7tx-operator-tongue-return-chip-glyphs

## Tasks

### Phase 2: Core Implementation

- [x] T001 Tongue return state in `app/frontend/src/components/operator-console.tsx`: replace the on-operator-route `null` return with the return-state tab (distinct visual + state attribute, dot suppressed); tap-back priority `?from=` (validated same-server, non-self) → router history back → `/$server`. <!-- R1 -->
- [x] T002 Opt-in navigate prop on `app/frontend/src/components/operator-context-chip.tsx` (label becomes a control when provided; ✕ unchanged); pass it only at the operator-route compose-strip mount in `app/frontend/src/components/compose-strip.tsx`. <!-- R2 -->
- [x] T003 Chip glyphs + order in `app/frontend/src/components/compose-strip.tsx`: bump history/newline glyph spans to the matching size step, swap `↑` → `↺`, reorder the card row to 📎 · ⏎ · ↺ with render conditions unchanged. <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Unit tests: tongue return-state suites (`operator-console.test.tsx`), chip navigate-prop coverage, `compose-strip.test.tsx` glyph/order updates; run `just test-frontend`. <!-- R5 -->
- [x] T005 e2e: return-toggle assertions in `operator-console.spec.ts` mobile suite (return tongue, tap to `?from=` origin, chip-label return); sweep `compose-strip.spec.ts`; intent comments updated; run the scoped specs via `just test-e2e`. <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The tongue renders the return state on the operator route (dot suppressed) and tap-back follows the a/b/c priority with invalid-`?from=` fall-through
- [x] A-002 R2: The chip label navigates at the operator-route mount; the omnibox chip is byte-unchanged; ✕ still dismisses
- [x] A-003 R3: History shows ↺ and both glyphs match the attach chip's visual weight in the same button boxes
- [x] A-004 R4: Card order is 📎 · ⏎ · ↺ with unchanged render conditions

### Behavioral Correctness

- [x] A-005 R1: Non-operator routes and operator-less servers keep today's tongue behavior exactly (existing suites pass)
- [x] A-006 R3: Recall semantics untouched — flyout opens, ↑-key walk works, aria/testid unchanged

### Scenario Coverage

- [x] A-007 R5: e2e proves the round trip on a 375px viewport: terminal route → tongue → operator (`?from=`) → return tongue → origin
- [x] A-008 R5: Rewritten/added specs follow the mobile pattern and carry updated intent comments

### Edge Cases & Error Handling

- [x] A-009 R1: `?from=` naming an unknown, cross-server, or self window falls through to history-back/server-route without error

### Code Quality

- [x] A-010 Pattern consistency: return-state derivation is route-fact-derived (no new state channels); chip prop follows existing optional-prop idioms
- [x] A-011 No unnecessary duplication: navigation reuses the established route/navigate helpers; no comment narration or change-ID citations in code or tests
- [x] A-012 375px single-row budget intact after the glyph bump (no wrap, no horizontal scroll)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the tongue's hide-on-operator-route branch was replaced in place by the return state, not orphaned)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Return-state visual: `⌃` glyph in the tab with a `data-*` state attribute (name-in-tab rejected for width on 375px) | Intake delegates the rendering; ⌃ is the minimal distinct mark | S:60 R:85 A:75 D:55 |
| 2 | Confident | Glyph size step resolved at `text-base` unless it visibly underweights 📎, then `text-lg` — decided against the rendered row | Intake delegates the exact step; one-class change | S:70 R:95 A:70 D:60 |

2 assumptions (0 certain, 2 confident, 0 tentative).
