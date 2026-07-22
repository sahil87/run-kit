# Plan: Instance-Accent PWA Titlebar Wash (Mock Parity)

**Change**: 260722-y5c3-instance-accent-titlebar-wash
**Intake**: `intake.md`

## Requirements

### Frontend: Accent hex derivation

#### R1: `deriveAccentHexes` gains a third derived hex — `titlebarHex`
`deriveAccentHexes(value, theme)` in `app/frontend/src/instance-accent.ts` SHALL return a third field `titlebarHex` computed as `blendHex(src, theme.palette.background, INSTANCE_TITLEBAR_RATIO)`, where `INSTANCE_TITLEBAR_RATIO = 0.12` is a new exported named constant defined beside the existing `INSTANCE_WASH_RATIO = 0.065` with the same doc-comment style (noting mock parity ≈ 12% and the granted ~0.12–0.15 tunable band). The blend MUST derive from the active theme's `palette.background` via the existing `blendHex` (`themes.ts`) — no hardcoded hexes; light themes get a light-background blend by construction. The function's return type annotation MUST include the new field.

- **GIVEN** a resolvable accent descriptor and the active theme
- **WHEN** `deriveAccentHexes(value, theme)` runs
- **THEN** the result carries `{stripeHex, washHex, titlebarHex}` where `titlebarHex` is a valid `#rrggbb`, differs from both `stripeHex` (full contrast-guarded hue) and `washHex` (6.5% blend), and recomputes per palette (dark vs light differ)

- **GIVEN** an unrecognized descriptor (e.g. `"99"`)
- **WHEN** `deriveAccentHexes` runs
- **THEN** the result is `null` (unchanged)

#### R2: The titlebar hex — NOT `stripeHex` — becomes the meta content and the echo `hex`
The bridge effect in `InstanceAccentProvider` (`app/frontend/src/contexts/instance-accent-context.tsx`) SHALL switch both of its writes from `hexes.stripeHex` to `hexes.titlebarHex`: (a) `setAccentThemeColor(hexes.titlebarHex)` so the single theme-color meta writer receives the subtle dark blend, and (b) `writeInstanceColorEcho({ value: resolved, hex: hexes.titlebarHex })` so the `index.html` blocking pre-paint script — which applies the echoed `hex` verbatim — tints the titlebar with the wash on cold start with **no change to `index.html`**.

- **GIVEN** a resolved accent under the active theme
- **WHEN** the bridge effect runs
- **THEN** `meta[name="theme-color"]` content equals the derived `titlebarHex` (and does NOT equal `stripeHex`), and the `runkit-instance-color` echo's `hex` field carries the same `titlebarHex`

- **GIVEN** no accent resolved (authoritative null)
- **WHEN** the bridge effect runs
- **THEN** the meta content is the theme background and the echo is cleared (current behavior, unchanged)

#### R3: All other surfaces and the resolution chain are untouched
`stripeHex` (contrast-guarded full hue) SHALL remain the hex for the 2px top-bar stripe (`app.tsx` AppLayout) and the HOST-panel hostname tint; `washHex` (`INSTANCE_WASH_RATIO` = 6.5%) SHALL remain the top-bar background wash. The no-default resolution chain (explicit setting → echo seed → none), the `useInstanceAccent()` exposed shape, and `index.html` SHALL NOT change. Doc comments that currently state "stripeHex … and the theme-color meta content" (`instance-accent.ts` `deriveAccentHexes` doc, `instance-accent-context.tsx` `stripeHex` field doc) MUST update to reflect the split: stripe/hostname surfaces keep `stripeHex`; the meta surface takes `titlebarHex`.

- **GIVEN** the change is applied
- **WHEN** `git diff` is inspected
- **THEN** only `instance-accent.ts`, `instance-accent-context.tsx`, and their two test files are modified — no `index.html`, `app.tsx`, or `host-panel.tsx` edits

### Frontend: Tests

#### R4: Unit tests cover the three-hex split and the meta/echo switch
`app/frontend/src/instance-accent.test.ts` SHALL extend the `deriveAccentHexes` assertions: `titlebarHex` is a valid `#rrggbb`, differs from both `stripeHex` and `washHex`, and recomputes per palette. `app/frontend/src/contexts/instance-accent-context.test.tsx` SHALL flip the meta-content assertion from `stripeHex` to the titlebar hex: the meta carries the derived `titlebarHex`, explicitly does NOT equal the stripe hex, and the rewritten echo's `hex` matches the meta content. No new Playwright e2e (verified: no e2e touches theme-color/instance-accent surfaces); the existing suites run as the regression gate.

- **GIVEN** the provider resolves an explicit accent in the context test
- **WHEN** the bridge effect settles
- **THEN** the test asserts `meta.content === deriveAccentHexes(value, theme).titlebarHex`, `meta.content !== stripeHex`, and `readInstanceColorEcho().hex === meta.content`

### Non-Goals

- Dynamic `manifest.json` / tinted dock icons / Badging API — separate follow-up change `260722-eo8e-accent-dock-icon` already in flight
- Reintroducing any default accent color — the no-default resolution chain stays
- Changing the stripe or wash surfaces, or exposing `titlebarHex` through `useInstanceAccent()` (no rendering surface consumes it)
- Echo migration/versioning — an old-build echo carrying the full-hue hex is an accepted self-correcting cold-start transient (same class as the existing cross-mode-load note)

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/instance-accent.ts`: add exported `INSTANCE_TITLEBAR_RATIO = 0.12` beside `INSTANCE_WASH_RATIO` (same doc-comment style, noting mock parity ≈ 12% and the ~0.12–0.15 band); add `titlebarHex: blendHex(src, bg, INSTANCE_TITLEBAR_RATIO)` to `deriveAccentHexes`'s return (and its return type annotation); update the `deriveAccentHexes` doc comment to the stripe/wash/titlebar split (meta content = `titlebarHex`) <!-- R1 R3 -->
- [x] T002 In `app/frontend/src/contexts/instance-accent-context.tsx`: switch the bridge effect's two writes from `hexes.stripeHex` to `hexes.titlebarHex` (`setAccentThemeColor` + `writeInstanceColorEcho` `hex`); update the `InstanceAccent.stripeHex` field doc comment to drop the "theme-color meta content" clause (stripe + HOST hostname only) <!-- R2 R3 -->
- [x] T003 [P] Extend `app/frontend/src/instance-accent.test.ts` `deriveAccentHexes` suite: `titlebarHex` matches `/^#[0-9a-f]{6}$/i`, differs from `stripeHex` and `washHex`, and recomputes per palette (dark vs light `titlebarHex` differ) <!-- R4 R1 -->
- [x] T004 [P] Update `app/frontend/src/contexts/instance-accent-context.test.tsx`: the meta-content assertion in "explicit setting wins over the localStorage echo" asserts meta = derived `titlebarHex`, meta ≠ stripe hex, and the rewritten echo `hex` = meta content <!-- R4 R2 -->

### Phase 4: Verification

- [x] T005 Run the frontend gates: `cd app/frontend && npx tsc --noEmit`, then the two scoped Vitest files (`pnpm vitest run src/instance-accent.test.ts src/contexts/instance-accent-context.test.tsx`), then the full unit suite via `just test-frontend`; fix any failures <!-- R1 R2 R3 R4 -->

## Execution Order

- T001 blocks T002 (the context reads the new field) and T003
- T002 blocks T004
- T003 and T004 are [P] against each other
- T005 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `deriveAccentHexes` returns `{stripeHex, washHex, titlebarHex}` with `titlebarHex = blendHex(src, theme.palette.background, INSTANCE_TITLEBAR_RATIO)` and `INSTANCE_TITLEBAR_RATIO = 0.12` defined as a named exported constant beside `INSTANCE_WASH_RATIO`, same doc-comment style
- [x] A-002 R2: the provider's bridge effect writes `titlebarHex` (not `stripeHex`) to both `setAccentThemeColor` and the echo's `hex` field

### Behavioral Correctness

- [x] A-003 R2: with a resolved accent, `meta[name="theme-color"]` content equals the titlebar blend and does not equal the full-hue stripe hex; the echoed `hex` matches the meta content (cold-start tint via the unchanged pre-paint script)
- [x] A-004 R3: with no accent resolved, the meta content remains the theme background and the echo is cleared — behavior unchanged

### Scenario Coverage

- [x] A-005 R1: tests prove `titlebarHex` is a valid `#rrggbb`, distinct from both `stripeHex` and `washHex`, and theme-aware (dark vs light palettes yield different titlebar hexes)
- [x] A-006 R4: the context test asserts the meta = titlebar hex ≠ stripe hex and the echo round-trips the titlebar hex

### Edge Cases & Error Handling

- [x] A-007 R1: an unrecognized descriptor still yields `null` from `deriveAccentHexes` (no partial object)

### Code Quality

- [x] A-008 Pattern consistency: the new constant and field mirror the existing `INSTANCE_WASH_RATIO`/`washHex` naming, doc-comment, and derivation style
- [x] A-009 No unnecessary duplication: reuses `blendHex` from `themes.ts` — no new blend machinery, no hardcoded hexes (theme-aware by construction)
- [x] A-010 Tests included: both touched behaviors are covered by the two updated Vitest files (code-quality.md mandate; no e2e needed — verified none asserts theme-color/accent chrome)
- [x] A-011 Scope discipline: only the four named files change — `index.html`, `app.tsx`, `host-panel.tsx`, the resolution chain, and the `useInstanceAccent()` shape are untouched

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change replaces the meta/echo `hex` value in place (`stripeHex` → `titlebarHex` at the two bridge writes) and adds one constant + one derived field. `stripeHex` remains actively consumed by the 2px stripe (`app.tsx`) and HOST hostname tint (`host-panel.tsx`), so nothing is made redundant. No dead symbols, files, or branches result.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `titlebarHex` is NOT exposed through `useInstanceAccent()` / the `InstanceAccent` type — only the bridge effect consumes it | Intake specifies "two-line write switch" only; no rendering surface consumes the titlebar hex; smallest diff, trivially reversible | S:85 R:95 A:90 D:85 |
| 2 | Confident | Ratio value 0.12 (mock ≈ 12%) within the granted ~0.12–0.15 band | Carried verbatim from intake assumption #2 — acknowledged taste constant, one-line reversal | S:70 R:95 A:60 D:65 |
| 3 | Certain | Context-test equality assertion computes the expected hex via `deriveAccentHexes(value, DEFAULT_DARK_THEME).titlebarHex` (test env resolves system → dark via the mocked `matchMedia`) | Matches the existing test file's theme setup (matchMedia mocked dark, `#0f1117` meta seed); strongest available assertion for "meta carries the titlebar hex" | S:75 R:90 A:85 D:80 |

3 assumptions (2 certain, 1 confident, 0 tentative).
