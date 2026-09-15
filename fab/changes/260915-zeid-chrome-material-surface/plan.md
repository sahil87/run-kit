# Plan: Chrome Material — a derived gray surface for the sidebar, top bar and status bar

**Change**: 260915-zeid-chrome-material-surface
**Intake**: `intake.md`

## Requirements

### Themes: Chrome tokens

#### R1: Two palette-derived chrome tokens
`deriveUIColors(palette, category)` in `app/frontend/src/themes.ts` MUST emit two additional keys, `bgChrome` and `bgChromeRaised`, both OKLCH transforms of `palette.background`: lightness stepped by named constants `CHROME_L_DELTA` (0.06) and `CHROME_L_DELTA + CHROME_RAISED_L_DELTA` (0.06 + 0.035) — up for the `dark` category, down for `light` — with chroma scaled by `CHROME_CHROMA_KEEP` (0.35) and hue preserved, brought into sRGB by the existing `oklchToHexInGamut` (chroma reduction, never channel clamping). The polar conversion of the background MUST reuse `hexToOklab` (extract a shared `hexToOklch` helper rather than duplicating the `Math.hypot`/`Math.atan2` pair that `oklabChroma` already carries).

- **GIVEN** the `default-dark` palette (`background #0f1117`, OKLab L ≈ 0.178)
- **WHEN** `deriveUIColors(palette, "dark")` runs
- **THEN** `bgChrome` is a valid hex whose OKLab L is within 0.01 of L + 0.06 and whose chroma is ≤ 35% of the background's (+ hex-rounding epsilon)
- **AND** `bgChromeRaised` is a further 0.035 (± 0.01) up, same chroma bound

- **GIVEN** a light palette (`solarized-light`, `background #fdf6e3`)
- **WHEN** `deriveUIColors(palette, "light")` runs
- **THEN** both tokens step DOWN by the same magnitudes

- **GIVEN** a `#000000`-background theme (`tomorrow-night-bright`, `synthwave`, `dark-pastel`)
- **WHEN** the tokens derive
- **THEN** both are distinct from the background (the step goes up, so nothing clamps at black)

#### R2: Tokens registered end to end with static fallbacks
Both keys MUST be added to the `UIColors` type and `COLOR_CSS_MAP` (`bgChrome → --color-bg-chrome`, `bgChromeRaised → --color-bg-chrome-raised`) so `applyThemeToDOM` writes them without further change, and to `globals.css` in all three blocks (`@theme`, `html[data-theme="dark"]`, `html[data-theme="light"]`) so Tailwind v4 emits `bg-bg-chrome` / `bg-bg-chrome-raised` (and `hover:` variants) and first paint has a value. The static fallbacks MUST equal `deriveUIColors` output for the default dark and default light palettes, pinned by a unit test. Doc comments and tests that count "9 UI colors" MUST say 11.

- **GIVEN** `globals.css`
- **WHEN** the fallback test reads the four `--color-bg-chrome*` values from the dark and light blocks
- **THEN** each equals the corresponding `deriveUIColors(DEFAULT_*_THEME.palette, category)` value

### Shell: surfaces that become chrome

#### R3: Sidebar card and mobile drawer paint the chrome
The desktop `<aside>` in `components/shell/shell.tsx` MUST replace `bg-bg-primary` with `bg-bg-chrome`, keeping `rounded-md border rk-card-border` (card shape unchanged). The mobile drawer `<aside>` MUST replace `bg-bg-primary` with `bg-bg-chrome`, keeping its `border-r border-border`. Doc comments naming the old token for these surfaces MUST name the new one.

- **GIVEN** the desktop Shell with the sidebar visible
- **WHEN** the aside renders
- **THEN** its class list contains `bg-bg-chrome` and not `bg-bg-primary`

#### R4: Stage ground and host-page root become chrome-raised
The Shell stage `<div>` (`className="bg-bg-inset"`, `shell.tsx:281`) MUST become `bg-bg-chrome-raised`, and the host page root (`components/host-overview-page.tsx:304`, `flex flex-col h-full bg-bg-inset`) MUST become `bg-bg-chrome-raised`, so every route sits on one ground under the chrome top bar. The 6px padding and column gap are unchanged. Doc comments (`shell.tsx:96-97, 119, 287`) MUST name the new token.

- **GIVEN** the terminal route at desktop width
- **WHEN** the stage renders
- **THEN** the ground between the sidebar card and the content tile is `--color-bg-chrome-raised`, one step past the chrome, and the tile is `--color-bg-primary`

#### R5: Top bar paints the chrome on the wash element
The top bar MUST paint `bg-bg-chrome`. The `TopBar` `<header>` has no background today and the instance-accent wash is painted inline by the wrapper `<div className="shrink-0">` in `app.tsx:510`; the chrome class MUST go on that same wrapper so the inline `washHex` (when set) overrides the class and the chrome shows when it is not. The wrapper's comment stating "the TopBar header has no background of its own" MUST be updated to describe the chrome-on-wrapper contract.

- **GIVEN** no instance accent
- **WHEN** the app renders
- **THEN** the top-bar wrapper's computed background is the chrome hex

- **GIVEN** an instance accent
- **WHEN** the app renders
- **THEN** the wrapper's computed background is `washHex` (which blends into the chrome per R10)

#### R6: Status bar paints the chrome
`components/status-bar.tsx:1106` MUST replace `bg-bg-primary` with `bg-bg-chrome` (frame chrome: flush, square, `border-t border-border` unchanged). The doc comment at `status-bar.tsx:46-47` MUST say `bg-bg-chrome`.

- **GIVEN** the desktop status bar
- **WHEN** it renders
- **THEN** its class list contains `bg-bg-chrome`

### Sidebar: rows on the chrome

#### R7: Row tints blend into the surface they sit on
`computeRowTints` MUST take a required second argument `surface: string` (the hex the rows render on) and blend every family tint (0.14 / 0.22 / 0.40) and the uncolored-selected gray sentinel (0.5) into `surface` instead of `palette.background`. Both callers MUST pass the chrome hex: `components/sidebar/index.tsx:236` and `components/swatch-popover.tsx:150` (the picker previews a sidebar row), each memoized on `theme`.

- **GIVEN** the default-dark palette and its chrome hex as `surface`
- **WHEN** `computeRowTints(palette, chrome)` runs
- **THEN** the `base` tint of any family is closer (OKLab ΔE) to the chrome than to `palette.background`
- **AND** the gray sentinel's `selected` blend is farther from the chrome than `bgChromeRaised` is, on both default palettes (selection still beats hover)

#### R8: Uncolored row hover is the raised chrome step
Rows sitting on the sidebar surface MUST hover with the opaque `hover:bg-bg-chrome-raised` (and the matching held-open state) instead of `hover:bg-bg-card/50` at exactly these sites: `sidebar/window-row.tsx:647` (flyout-open held state `bg-bg-card/50` → `bg-bg-chrome-raised`), `sidebar/session-row.tsx:333`, `sidebar/server-panel.tsx:285` (`uncoloredHoverClass`), `sidebar/boards-section.tsx:148-149` (active `bg-bg-card` → `bg-bg-chrome-raised`; hover likewise), `sidebar/index.tsx:2990`. Popups on `bg-bg-primary` (`pin-popover.tsx`, `row-flyout-card.tsx`, identity tips, `marker-pad.tsx`) MUST keep their classes.

- **GIVEN** an uncolored window row on the chrome
- **WHEN** hovered
- **THEN** its background is `--color-bg-chrome-raised`

### Global CSS: gap furniture

#### R9: Lit sash grip dots vanish into the new ground
`.rk-divider.rk-sash-hot .rk-grips i` and `.rk-divider.rk-sash-lit .rk-grips i` (`globals.css:1609-1610`) MUST invert to `var(--color-bg-chrome-raised)` instead of `var(--color-bg-inset)`. `.rk-scroll-fade-bottom` (a `mask-image`, surface-agnostic) and `.rk-band-fade` (lives in `bg-primary` popovers) MUST NOT change.

- **GIVEN** the sidebar drag sash is hovered
- **WHEN** the grip dots light
- **THEN** their color equals the stage ground

### Titlebar: theme-color follows the chrome

#### R10: PWA theme-color, desktop titlebar and accent hexes re-base onto the chrome
`applyThemeToDOM` (`contexts/theme-context.tsx:94`) MUST call `applyThemeColorMeta(uiColors.bgChrome)` instead of `theme.palette.background`. `deriveAccentHexes` (`instance-accent.ts:80-90`) MUST use the chrome hex (`deriveUIColors(theme.palette, theme.category).bgChrome`) as the blend base for `washHex` and `titlebarHex` and as the contrast ground for `stripeHex`. `index.html` MUST use the default chrome fallbacks in place of `#0f1117` / `#f8f9fb` in the pre-paint script's per-mode fallback (line 34) and in the static `<meta name="theme-color">` (line 8) so an accent-less cold start does not flash terminal-colored.

- **GIVEN** a theme switch with no instance accent
- **WHEN** `applyThemeToDOM` runs
- **THEN** `<meta name="theme-color">` content equals that theme's `bgChrome`

- **GIVEN** an instance accent
- **WHEN** `deriveAccentHexes` runs
- **THEN** `titlebarHex === blendHex(src, bgChrome, 0.35)` and `washHex === blendHex(src, bgChrome, 0.065)`

### Docs

#### R11: Themes spec rows
`docs/specs/themes.md` § UI Color Derivation MUST say 11 derived properties and add rows for `--color-bg-chrome` (`oklch(L ± 0.06, C × 0.35, h)` of `background`, up on dark / down on light, gamut-reduced by chroma) and `--color-bg-chrome-raised` (one further 0.035 L step, same direction, same chroma). The uncommitted `docs/wiki/sidebar-material-studies.html` and the `docs/specs/index.md` wiki row stay in the working tree as-is (they ride the ship commit). Memory files are hydrate's, not apply's.

- **GIVEN** the spec
- **WHEN** read
- **THEN** both tokens have a derivation row and the count matches `UIColors`

### Tests

#### R12: Unit coverage in `themes.test.ts`
Tests MUST cover: both keys present and valid hex for all 70 themes (key-count assertions 9 → 11 at `themes.test.ts:129, 176`); the ΔL / direction / chroma bounds of R1 for `default-dark` and `solarized-light`; the `#000000` themes' distinctness; `computeRowTints(palette, surface)` blending into `surface` and the sentinel-beats-hover property of R7; the `globals.css` fallback pin of R2 (read the file with `fs`, regex the four values). Existing `computeRowTints(palette)` calls in tests MUST pass a surface.

- **GIVEN** `just test-frontend`
- **WHEN** run in full
- **THEN** all Vitest suites pass

#### R13: Component tests updated
`shell/shell.test.tsx:92` (`bg-bg-inset` → `bg-bg-chrome-raised`) and `:139` (`bg-bg-primary` → `bg-bg-chrome`), `status-bar.test.tsx:173` (→ `bg-bg-chrome`), an `app`/top-bar-wrapper assertion that the wash wrapper carries `bg-bg-chrome`, an `instance-accent` test that `deriveAccentHexes` blends into the chrome hex, and a `theme-context` test that `applyThemeColorMeta` receives `bgChrome` MUST pass.

- **GIVEN** the updated component tests
- **WHEN** `just test-frontend` runs
- **THEN** they pass and no test still asserts the retired tokens on these surfaces

#### R14: Committed e2e spec proving the surfaces
A new `app/frontend/tests/e2e/chrome-material.spec.ts` MUST, at 1440×900 on the terminal route, read `getComputedStyle(...).backgroundColor` of the sidebar aside, the top-bar wrapper, the status bar and the content tile, and assert aside = top bar = status bar = `--color-bg-chrome` and chrome ≠ tile. The tile's primary color is canvas-painted — xterm.css hardcodes `.xterm-viewport` to opaque `#000` and the theme never overrides it, so no computed-style probe can read the terminal's color — therefore the tile contract is asserted as: the tile wrapper carries NO opaque DOM background (transparent; a stray chrome class would show through the xterm letterbox) AND the xterm instance's theme background equals `--color-bg-primary`, probed through the dev-only `window.__rkTerminals` registry (the spec MUST poll for the registry entry — registration lags the `.xterm` element mount). It MUST run under `page.emulateMedia({ colorScheme: "dark" })` and `"light"` (precedent `present-viewer.spec.ts:287-295`) and once with a warm light theme selected through the app's persisted theme preference mechanism (verify the storage key / API in `contexts/theme-context.tsx` before writing it). Each test MUST carry the constitution's Proves / Steps JSDoc and the file its shared-setup header. Each run MUST attach a full-page screenshot via `testInfo.attach` so review can inspect the light-theme `bg-bg-inset` wells, the sidebar's bottom fade edge and a tinted + selected row. `just test-e2e control-gallery.spec` MUST still pass with unchanged baselines.

- **GIVEN** `just test-e2e chrome-material.spec`
- **WHEN** run (after `just setup` in this worktree if the rig is missing pieces)
- **THEN** all three color-scheme cases pass and screenshots are attached

### Non-Goals
- Moving the quake-terminal launcher chip out of the top bar's center cell — separate change.
- Full-height sidebar, flush or hairline seams — rejected/parked in the study.
- Recoloring board panes, the `/$server` 900px column, flyout cards, xterm, tmux, or any backend/API/route/keyboard surface.
- A third `chrome-inset` token for the coarse rail / PANE wells / switch-off track — left on `bg-bg-inset`; review decides from the attached light-theme screenshots (default: accept).
- Changing `--color-border` derivation (hairlines lose ~10% contrast on the chrome at ΔL 0.06 — accepted).
- Memory hydration — hydrate stage.

### Design Decisions

#### Chrome material over lifted card / recessed / full-height
**Decision**: The attached frame (top bar + status bar) and the sidebar share one derived gray material; content tiles keep `palette.background`.
**Why**: It is the macOS reading the user asked for and maps 1:1 onto the existing two-family chrome vocabulary; a gray card inside a palette-colored frame is the least coherent state, and recessed clamps at black on #000 themes.
**Rejected**: Lifted card as a shipped intermediate (no new information over a devtools check); recessed (clamp, no room on ayu-dark); full-height (layout change, not color).
*Introduced by*: 260915-zeid-chrome-material-surface

#### OKLCH ΔL derivation with partial chroma
**Decision**: `oklch(L ± 0.06, C × 0.35, h)` of the background, gamut-reduced by chroma; raised is a further 0.035.
**Why**: Today's `card`/`inset` are sRGB percentage steps that are visible on one theme category and invisible on the other (dark: card ΔL 0.06–0.08, inset 0.005–0.011; light: card 0.02, inset 0.045). An OKLab step is the same visible step on every palette; keeping 35% chroma stops the gray fighting tinted terminals (solarized, ubuntu) without inheriting the full tint.
**Rejected**: Pure neutral gray (pasted-on against tinted backgrounds); 100% chroma (stops reading as gray on the same themes); `mix(fg, 6%)` (tracks foreground hue — warm-on-cold themes go beige).
*Introduced by*: 260915-zeid-chrome-material-surface

#### One raised token for hover and ground
**Decision**: `--color-bg-chrome-raised` serves both the uncolored row hover and the Shell stage ground.
**Why**: Both are "one step past the chrome"; a hovered row matching the gap ground is harmless, and one token keeps the family to two.
**Rejected**: Separate hover and ground tokens (a third derived color with no distinct meaning).
*Introduced by*: 260915-zeid-chrome-material-surface

#### Theme-color follows the chrome
**Decision**: The PWA `theme-color` meta, the desktop titlebar blend and the accent wash/stripe all base on `bgChrome`.
**Why**: The top bar is the titlebar's neighbor; a palette-colored band above a gray bar would read as a seam.
**Rejected**: Leaving the writer on `palette.background` (visible band in the PWA/desktop shell).
*Introduced by*: 260915-zeid-chrome-material-surface

## Tasks

### Phase 1: Setup

- [x] T001 In `app/frontend/src/themes.ts` add `CHROME_L_DELTA = 0.06`, `CHROME_RAISED_L_DELTA = 0.035`, `CHROME_CHROMA_KEEP = 0.35` (doc-commented constants beside the other derivation constants), extract a shared `hexToOklch(hex): { L, C, hueDeg }` from `hexToOklab` and refactor `oklabChroma` to use it, and emit `bgChrome` / `bgChromeRaised` from `deriveUIColors` via `oklchToHexInGamut` <!-- R1 -->
- [x] T002 Register both keys in `UIColors`, `COLOR_CSS_MAP` (`--color-bg-chrome`, `--color-bg-chrome-raised`) and update the "9 UI colors" doc comments in `themes.ts` and `contexts/theme-context.tsx` to 11 <!-- R2 -->
- [x] T003 Add `--color-bg-chrome` / `--color-bg-chrome-raised` to the `@theme`, `html[data-theme="dark"]` and `html[data-theme="light"]` blocks in `app/frontend/src/globals.css`, with values printed from `deriveUIColors` for `default-dark` and `default-light` (e.g. a one-off `pnpm exec tsx`/vitest snippet — never hand-computed) <!-- R2 -->

### Phase 2: Core Implementation

- [x] T004 [P] `components/shell/shell.tsx`: aside `bg-bg-primary` → `bg-bg-chrome`; mobile drawer `bg-bg-primary` → `bg-bg-chrome`; stage `bg-bg-inset` → `bg-bg-chrome-raised`; update the doc comments at lines 96-97, 119, 287 <!-- R3 -->
- [x] T005 [P] `components/host-overview-page.tsx:304`: root `bg-bg-inset` → `bg-bg-chrome-raised` <!-- R4 -->
- [x] T006 [P] `app.tsx:510`: add `bg-bg-chrome` to the top-bar wash wrapper (`className="shrink-0 bg-bg-chrome"`, inline `washHex` still wins) and rewrite its comment for the chrome-on-wrapper contract <!-- R5 -->
- [x] T007 [P] `components/status-bar.tsx:1106`: `bg-bg-primary` → `bg-bg-chrome`; update the doc comment at lines 46-47 <!-- R6 -->
- [x] T008 `themes.ts` `computeRowTints(palette, surface)`: blend all tints and the gray sentinel into `surface`; update callers `components/sidebar/index.tsx:236` and `components/swatch-popover.tsx:150` to pass `deriveUIColors(theme.palette, theme.category).bgChrome` (memoized on `theme`) <!-- R7 -->
- [x] T009 [P] Hover re-points: `sidebar/window-row.tsx:647`, `sidebar/session-row.tsx:333`, `sidebar/server-panel.tsx:285`, `sidebar/boards-section.tsx:148-149`, `sidebar/index.tsx:2990` — `bg-bg-card/50` / `bg-bg-card` → `bg-bg-chrome-raised` (hover and held-open); leave popup files untouched <!-- R8 -->
- [x] T010 [P] `globals.css:1609-1610`: sash grip lit color `var(--color-bg-inset)` → `var(--color-bg-chrome-raised)` <!-- R9 -->
- [x] T011 Titlebar: `contexts/theme-context.tsx:94` → `applyThemeColorMeta(uiColors.bgChrome)`; `instance-accent.ts` `deriveAccentHexes` blends/guards against `deriveUIColors(theme.palette, theme.category).bgChrome`; `index.html` line 8 meta and line 34 per-mode fallbacks → the default chrome hexes from T003 <!-- R10 -->

### Phase 3: Integration & Edge Cases

- [x] T012 `themes.test.ts`: key counts 9 → 11 (lines 129, 176); ΔL/direction/chroma tests for `default-dark` and `solarized-light`; `#000000` themes distinct; `computeRowTints(palette, surface)` blend + sentinel-beats-raised tests; `globals.css` fallback pin test reading the file with `fs`; fix existing `computeRowTints` call sites in tests <!-- R12 -->
- [x] T013 Component tests: `shell/shell.test.tsx:92,139`, `status-bar.test.tsx:173`, a top-bar-wrapper `bg-bg-chrome` assertion (in `app` or top-bar tests, wherever the wrapper is rendered), an `instance-accent` `deriveAccentHexes`-uses-chrome test, a `theme-context` meta-receives-`bgChrome` test <!-- R13 -->
- [x] T014 New `tests/e2e/chrome-material.spec.ts` per R14 (file header + Proves/Steps JSDoc; dark, light, warm-light cases; computed-style assertions; `testInfo.attach` full-page screenshots) <!-- R14 -->
- [x] T015 Gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend` in full; `just test-e2e chrome-material.spec` and `just test-e2e control-gallery.spec` (single specs only — never the full e2e suite; run `just setup` first if the rig lacks pieces in this worktree) — fix failures at the root <!-- R12 -->

### Phase 4: Polish

- [x] T016 `docs/specs/themes.md` § UI Color Derivation: "8 CSS custom properties" → 11 and the two new rows with formulas <!-- R11 -->

## Execution Order

- T001 → T002 → T003 (the fallback values come from the derivation)
- T004–T007, T009, T010 are independent of each other but need T003's utilities to exist for Tailwind to emit the classes
- T008 and T011 need T001/T002
- T012–T014 after Phase 2; T015 last in Phase 3

## Acceptance

### Functional Completeness

- [x] A-001 R1: `deriveUIColors` returns `bgChrome` and `bgChromeRaised` derived via named constants and `oklchToHexInGamut`, with a shared `hexToOklch` helper (no duplicated polar math)
- [x] A-002 R2: both tokens are in `UIColors`, `COLOR_CSS_MAP` and all three `globals.css` blocks; `bg-bg-chrome` / `bg-bg-chrome-raised` classes are emitted; doc comments say 11
- [x] A-003 R3: the desktop aside and mobile drawer carry `bg-bg-chrome`, card shape and drawer border unchanged
- [x] A-004 R4: the Shell stage and the host-page root carry `bg-bg-chrome-raised`; no `bg-bg-inset` remains on either
- [x] A-005 R5: the top-bar wash wrapper carries `bg-bg-chrome`, and the inline `washHex` still overrides it when an accent is set
- [x] A-006 R6: the status bar carries `bg-bg-chrome`, flush and square as before
- [x] A-007 R7: `computeRowTints(palette, surface)` blends into `surface`; both callers pass the chrome hex
- [x] A-008 R8: the five listed sidebar sites hover/hold on `bg-bg-chrome-raised`; popup files are untouched
- [x] A-009 R9: lit sash grips use `--color-bg-chrome-raised`; `.rk-scroll-fade-bottom` and `.rk-band-fade` unchanged
- [x] A-010 R10: theme-color meta, `deriveAccentHexes` and the `index.html` fallbacks base on the chrome hex
- [x] A-011 R11: the Themes spec lists 11 derived properties with rows for both tokens

### Behavioral Correctness

- [x] A-012 R1: on `default-dark` the chrome's OKLab L is 0.06 ± 0.01 above the background and on `solarized-light` 0.06 ± 0.01 below; chroma ≤ 35% of the background's in both
- [x] A-013 R7: with the chrome as surface, family `base` tints sit closer to the chrome than to the terminal color, and the gray sentinel's `selected` beats the raised hover step on both default palettes
- [x] A-014 R4: on the terminal route the gap between sidebar card and content tile is visibly a different color from both (chrome-raised vs chrome vs primary), on dark and light

### Scenario Coverage

- [x] A-015 R14: `chrome-material.spec.ts` passes for dark, light and a warm light theme, asserting aside = top bar = status bar = chrome, chrome ≠ tile, the tile wrapper unpainted (transparent), and the xterm theme background = primary via the dev registry probe
- [x] A-016 R14: `control-gallery.spec` passes with unchanged snapshot baselines
- [x] A-017 R12: `just test-frontend` passes in full and `tsc --noEmit` is clean

### Edge Cases & Error Handling

- [x] A-018 R1: the three `#000000` themes derive a chrome distinct from the background (no clamp), and every one of the 70 themes yields valid in-gamut hex for both tokens
- [x] A-019 R10: with no `runkit-instance-color` echo, the pre-paint script sets a chrome-colored theme-color (no terminal-colored flash), and the runtime writer overwrites it with the derived chrome
- [x] A-020 R14: the attached light-theme screenshots show the `bg-bg-inset` wells / rail as intended darker wells, not holes (reviewer judgment; record the verdict in the review findings)

### Code Quality

- [x] A-021 Pattern consistency: new tokens follow the `bgInset` registration pattern; constants are named and doc-commented like the tint ratios
- [x] A-022 No unnecessary duplication: `hexToOklab` / `oklchToHexInGamut` / `blendHex` reused; no second OKLab conversion
- [x] A-023 Type narrowing over assertions: no new `as` casts in the touched TypeScript
- [x] A-024 Tests included: every changed behavior has a colocated unit/component test and the UI change has the e2e spec
- [x] A-025 No comment narration: touched comments state contracts (chrome-on-wrapper, token meaning), cite no change IDs or PR numbers, and do not narrate the next line
- [x] A-026 Test intent comments: every `test()` in the new spec carries Proves / Steps JSDoc and the file has a shared-setup header; no `.spec.md` companion
- [x] A-027 No polling from the client: the e2e spec uses Playwright waits, not `setInterval`; no new client-side polling introduced
- [x] A-028 Tests conform to spec: assertions encode R1–R14, not implementation accidents (Test Integrity)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Worktree notes for the apply worker: run all tests through `just` recipes; a fresh worktree may need `just setup` before Playwright/Go embed work; run single e2e specs only (`just test-e2e <name>.spec`), never the full suite; the Bash shell is zsh, so never name a variable `status`.

## Deletion Candidates

- None — this change adds the two chrome tokens and re-points surfaces onto them; `bg-bg-inset` stays in use for the coarse status rail / PANE wells / switch-off track (plan Non-Goals leave-as-is), and `bg-bg-card` / `bg-bg-card/50` remain the popup/popover vocabulary (`pin-popover.tsx`, `row-flyout-card.tsx`, `marker-pad.tsx`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Constants `CHROME_L_DELTA` 0.06 / `CHROME_RAISED_L_DELTA` 0.035 / `CHROME_CHROMA_KEEP` 0.35, derivation via `oklchToHexInGamut` | Intake assumption 3, verbatim | S:95 R:85 A:95 D:95 |
| 2 | Confident | Extract a shared `hexToOklch` helper and refactor `oklabChroma` onto it rather than inlining the polar conversion in `deriveUIColors` | code-quality no-duplication rule; `oklabChroma` already carries half of it | S:70 R:95 A:90 D:85 |
| 3 | Confident | The top-bar chrome class lives on the `app.tsx:510` wash wrapper, not on the `<header>` | Intake assumption 12: one element must own class + inline wash so the wash overrides; the wrapper already owns the wash | S:75 R:90 A:85 D:80 |
| 4 | Certain | `computeRowTints` takes a REQUIRED `surface` argument (no default to `palette.background`) | A default would silently keep the halo at any missed caller; there are exactly two callers | S:85 R:90 A:90 D:90 |
| 5 | Confident | `globals.css` fallbacks are pinned by a Vitest test that reads the file with `fs` and regex-extracts the four values | Intake § 2 asks for a drift pin; reading the stylesheet is the least invasive way (no exported constant needed) | S:65 R:95 A:85 D:80 |
| 6 | Confident | The e2e spec asserts the xterm background via the dev-only `window.__rkTerminals` registry theme option plus a transparent-tile-wrapper guard — not a `.xterm-viewport` computed-style read | Apply-time discovery: xterm.css hardcodes `.xterm-viewport` to opaque #000 and the theme never overrides it (globals.css documents this), so the viewport probe cannot see the terminal's color; the canvas is the paint, and the registry is the only truthful read | S:55 R:90 A:75 D:70 |
| 7 | Confident | The warm-light e2e case selects the theme through the app's persisted preference mechanism, verified in `theme-context.tsx` at apply time (localStorage key or API), rather than a hardcoded key name | The intake named `runkit-theme-light` unverified; apply must read the real key | S:50 R:90 A:80 D:70 |
| 8 | Confident | Full-page screenshots for the light-theme wells / fade / grips judgment are attached from the e2e spec via `testInfo.attach`, not produced by an ad hoc dev-rig script | Keeps the visual evidence inside the `just` recipes the project mandates; the reviewer reads the attachments | S:60 R:90 A:80 D:75 |
| 9 | Certain | The static `<meta name="theme-color">` in `index.html` (line 8) moves to the default-dark chrome fallback along with the line-34 per-mode literals | Same single-writer contract; a stale static value would flash before the pre-paint script | S:70 R:95 A:90 D:85 |
| 10 | Certain | Memory files are not touched at apply; hydrate owns them. The wiki study and the specs-index row stay uncommitted in the tree until ship | Pipeline stage ownership | S:90 R:95 A:95 D:95 |

10 assumptions (4 certain, 6 confident, 0 tentative).
