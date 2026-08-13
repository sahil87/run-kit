# Plan: Swap Web Surface Glyph and Compose Chip Face

**Change**: 260813-z84r-swap-web-compose-glyphs
**Intake**: `intake.md`

## Requirements

### Surface Rail: Web glyph

#### R1: Web surface glyph is `⧉`
The `SURFACE_GLYPH.web` entry (`app/frontend/src/lib/surface-layout.ts:140`) MUST change from `◫` to `⧉` (U+29C9). The `tty`, `chat`, and `code` entries MUST NOT change. Doc comments enumerating the glyph set (`surface-layout.ts:134-136`, `right-panel.tsx:35`) MUST be updated to match.

- **GIVEN** the terminal route's right rail (or a surface tile header, or the mobile surface sheet)
- **WHEN** the Web surface button/tab renders
- **THEN** its glyph is `⧉` (inherited from the single `SURFACE_GLYPH` map entry)
- **AND** Terminal renders `>_`, Code renders `{}` unchanged

### Bottom Bar: Compose chip face

#### R2: Compose chip face is the digraph `a▏`
The Compose chip face (`app/frontend/src/components/bottom-bar.tsx` ~447) MUST change from `>_` to `a▏` (letter `a` + U+258F left one-eighth block), with the `▏` wrapped in its own `<span>` so it can animate independently. `aria-label="Compose text"`, `aria-pressed`, the `Tip` tooltip, chord chip, and click handler MUST NOT change. The compose education hint (~468) MUST swap its `>_` prefix to `a▏` (`a▏ compose — type here, send to the pane`); all hint gating is unchanged.

- **GIVEN** the bottom bar with the compose strip OFF
- **WHEN** the Compose chip renders
- **THEN** its face is `a▏` with a static (non-animated) bar
- **AND** the education hint (when its gates pass) reads `a▏ compose — type here, send to the pane`

#### R3: Bar blinks while the strip is active; zeroed under reduced motion
While `composeStripEnabled` is true (the same condition driving the accent styling and `aria-pressed`), the `▏` span MUST carry a blink animation reusing the existing `rk-caret-blink` keyframes (globals.css:219) via a new `rk-*` utility class; when false the class MUST be absent (static bar). Under `prefers-reduced-motion: reduce` the blink MUST be zeroed with the bar remaining visible and static (the face must stay legible — unlike `.rk-bracket-caret`, which hides at rest).

- **GIVEN** the compose strip is active (`aria-pressed="true"`)
- **WHEN** the chip renders
- **THEN** the `▏` span carries the blink utility class (terminal-cursor blink)
- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** the strip is active
- **THEN** the bar renders static at full opacity (animation zeroed in the existing reduced-motion block)

### Tests & Docs: conformance

#### R4: Tests conform to the new glyphs
`right-panel.test.tsx:54` MUST expect `⧉` instead of `◫` (and its glyph-enumeration comment at :50-51 updated). `bottom-bar.test.tsx` MUST gain assertions that the blink class is present on the `▏` span when `composeStripEnabled` is true and absent when false; its three stale `>_`-chip comments (:40, :263, :358) MUST say `a▏`. No other literal glyph assertions exist (verified: surface-layout.test.tsx asserts only `{}`; no Playwright spec asserts either glyph).

- **GIVEN** `just test-frontend`
- **WHEN** the suites run after the swap
- **THEN** all pass, including the updated `⧉` assertion and the new blink-class assertions

#### R5: Companion doc prose stays accurate
`app/frontend/tests/e2e/compose-strip.spec.md` MUST replace its "the `>_` chip" prose references (~10 places) with "the `a▏` chip". Discovered at apply: `compose-strip.spec.ts` itself carries `>_` in a test NAME (`test("toggle via >_ chip and …")`, :99) and two comments (:10, :153) — the companion heading mirrors the test name, so both MUST be renamed in sync (name/comment only, zero behavioral change; the same-commit `.spec.md` rule is satisfied by this change itself).

- **GIVEN** the companion doc and spec after the change
- **WHEN** a reviewer reads them
- **THEN** every chip-face reference matches the shipped `a▏` face, and the `.spec.md` heading still mirrors the `.spec.ts` test name verbatim

### Non-Goals

- Any change to the `tty`/`chat`/`code` glyphs, rail semantics, or compose strip behavior.
- New e2e coverage — existing e2e targets the chip via `aria-label`, unaffected by design.
- `docs/memory/run-kit/ui-patterns.md` glyph enumerations — hydrate's job.

### Design Decisions

#### Reuse `rk-caret-blink` for the compose bar
**Decision**: The active-state blink applies the existing `rk-caret-blink` keyframes (globals.css:219, 1.06s `steps(1)`) through a new `.rk-compose-caret` utility, zeroed in the existing `prefers-reduced-motion` block with `opacity: 1` retained.
**Why**: One blink cadence across the UI (the section-heading caret already blinks at this rhythm); no duplicate keyframes; the reduced-motion audit block stays the single gate.
**Rejected**: A new dedicated keyframes block — duplicates an existing animation for no visual difference. Hiding the bar under reduced motion (what `.rk-bracket-caret` does) — the bar is part of the chip's face, not a hover flourish; hiding it would change the glyph itself.
*Introduced by*: 260813-z84r-swap-web-compose-glyphs

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Swap `SURFACE_GLYPH.web` `◫` → `⧉` in `app/frontend/src/lib/surface-layout.ts:140`; update the map doc comment (:134-136) and the `right-panel.tsx:35` doc comment glyph enumeration <!-- R1 -->
- [x] T002 Rework the Compose chip face in `app/frontend/src/components/bottom-bar.tsx` (~447): `>_` → `a` + `<span>` -wrapped `▏` carrying the blink utility class only when `composeStripEnabled`; swap the education hint prefix (~468) to `a▏`; add `.rk-compose-caret` to `app/frontend/src/globals.css` (animation: `rk-caret-blink 1.06s steps(1) infinite`) plus its zero entry (`animation: none; opacity: 1`) in the `prefers-reduced-motion` block <!-- R2, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Update tests: `right-panel.test.tsx:54` expectation `◫` → `⧉` + comment (:50-51); `bottom-bar.test.tsx` — update stale `>_` comments (:40, :263, :358) to `a▏` and add blink-class assertions (present when `composeStripEnabled` true, absent when false) <!-- R4 -->
- [x] T004 [P] Update `app/frontend/tests/e2e/compose-strip.spec.md` prose: "the `>_` chip" → "the `a▏` chip" (all occurrences) <!-- R5 -->

### Phase 4: Polish

- [x] T005 Run `just test-frontend`; all suites green <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SURFACE_GLYPH.web === "⧉"`; rail, tile headers, and mobile sheet all render it via the shared map; tty/chat/code entries byte-identical to before
- [x] A-002 R2: Compose chip face is `a▏` with the bar in its own span; aria-label/aria-pressed/Tip/chord/click wiring unchanged; hint prefix reads `a▏`
- [x] A-003 R3: Blink class present on the `▏` span iff `composeStripEnabled`; `.rk-compose-caret` reuses `rk-caret-blink` and is zeroed (visible, static) under `prefers-reduced-motion: reduce`

### Behavioral Correctness

- [x] A-004 R2: With the strip off, the chip is fully static (no animation class in the DOM)

### Scenario Coverage

- [x] A-005 R4: `just test-frontend` green, including the updated `⧉` assertion and new blink-class assertions (both states)

### Edge Cases & Error Handling

- [x] A-006 R3: Reduced-motion zero entry keeps `opacity: 1` — the bar never disappears from the face

### Code Quality

- [x] A-007 Pattern consistency: blink utility follows the `rk-*` vocabulary and lives with the other treatments; the reduced-motion audit block gains the new class
- [x] A-008 No unnecessary duplication: no new keyframes (reuses `rk-caret-blink`); glyph changed only at the single-source map
- [x] A-009 R5: compose-strip.spec.md prose matches the shipped face; the `.spec.ts` test rename is name/comment-only (no assertion or behavior change) and the `.spec.md` heading mirrors the renamed test verbatim (same-commit rule satisfied)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — both glyphs were swapped in place at their single sources (`SURFACE_GLYPH.web`, the compose chip JSX); the change makes no existing file, symbol, or branch redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse the existing `rk-caret-blink` keyframes for the compose bar instead of new keyframes | Verified present at globals.css:219 with the exact terminal-cursor cadence; one-cadence consistency; trivially reversible | S:85 R:95 A:95 D:90 |
| 2 | Confident | Reduced-motion zero keeps the bar visible (`opacity: 1`), diverging from `.rk-bracket-caret`'s hide | The bar is the chip's face, not a hover flourish — hiding it would change the glyph; matches the "attention/labels never motion-only" pattern in the same block | S:70 R:95 A:90 D:80 |
| 3 | Confident | Blink-class unit assertions live in bottom-bar.test.tsx querying the chip's span by class, toggling `composeStripEnabled` via the existing ChromeProvider test setup | The file already fixtures `composeStripEnabled` (comment :40); smallest conforming coverage for R3 | S:65 R:90 A:85 D:80 |
| 4 | Confident | Rename the `compose-strip.spec.ts` test name (`toggle via >_ chip…` → `toggle via a▏ chip…`) and its two `>_` comments, in sync with the `.spec.md` heading | Discovered at apply — the intake's "no `.spec.ts` glyph references" claim covered assertions only; the companion heading must mirror the test name, and a stale name contradicts the shipped face. Name/comment-only, zero behavioral risk | S:70 R:95 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
