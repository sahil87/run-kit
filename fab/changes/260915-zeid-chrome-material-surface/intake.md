# Intake: Chrome Material — a derived gray surface for the sidebar, top bar and status bar

**Change**: 260915-zeid-chrome-material-surface
**Created**: 2026-09-15

## Origin

Conversational — a `/fab-discuss` session on 2026-09-15 produced the design study `docs/wiki/sidebar-material-studies.html` (on the working tree, uncommitted) and its row in the wiki table of `docs/specs/index.md` (uncommitted edit). Both files ride in this change's commit. The user reviewed the study's live mock over 14 palettes, approved the **chrome material** variant with the **6px gap seam**, and said "proceed". The intake was created by `/fab-proceed`'s promptless dispatch from the synthesized description below.

> **Title:** Chrome Material — a derived gray surface for the sidebar, top bar and status bar
>
> **Problem.** Every desktop surface — the sidebar card, the terminal tile, the top bar (inherits body) and the status bar — paints `--color-bg-primary` = `palette.background`. They are separated only by the Shell stage ground `bg-bg-inset` and the 55%-alpha `rk-card-border`. Measured live in OKLab: on dark themes `inset` (`darken 5%`) is ΔL 0.005–0.011 from the background — invisible — while `card` (`lighten 8%`) is ΔL 0.06–0.08; on light themes it flips: `inset` (`darken 6%`) is ΔL 0.045 and `card` (`darken 3%`) is ΔL 0.02. Neither existing token is the same visible step in both categories, so neither can serve as a sidebar material. The user wants the left panel on a gray distinct from the terminal, the way macOS window chrome (sidebar + toolbar) sits on a gray material while the content well keeps its color.
>
> **Decision (user-approved).** The chrome material variant: sidebar, top bar, status bar and the mobile sidebar drawer move to one new derived token; the terminal tile and every other content card (board panes, server-route column, flyout cards) keep `palette.background`. The 6px stage gap is kept — the stage ground steps one further ΔL past the chrome so the gap between the chrome-colored sidebar card and the palette-colored terminal tile finally reads. Rejected: recessed (sidebar becomes the ground — clamps at black on #000 themes, no room on ayu-dark), flush and hairline seams, full-height sidebar (a layout change — parked), and lifted card first as a shipped intermediate step (a gray card inside a palette-colored frame is the least coherent state; the eyeball check can be done in devtools).
>
> **Out of scope.** Moving the quake-terminal launcher chip from the top bar's center cell to the right cluster (separate change). Full-height sidebar. Hairline/flush seams. Recoloring board panes or server-route cards.

Key decisions from the discussion (all encoded in `## Assumptions`):

- Chrome material over lifted-card / recessed / full-height — "chrome is chrome, content is content"; maps 1:1 onto the existing two-family chrome vocabulary.
- ~~Keep the 6px gap seam; the stage ground becomes a second chrome step (`chrome-raised`)~~ **Amended 2026-09-16 after a live preview of PR #984: flush stage** — the stage ground (and host-page root) paint the chrome itself, the sidebar drops its card border and radius and sits flat on it, and `chrome-raised` is the row-hover step only.
- Derivation constants: ΔL 0.06 (chrome), a further 0.035 (raised), chroma kept at 35% — OKLCH of `palette.background`, gamut-reduced by chroma the way the row families already are.
- Row tints re-base onto the chrome hex (`computeRowTints` takes a surface argument) — otherwise tinted rows carry a terminal-colored halo on the gray.
- The PWA `theme-color` / desktop-shell titlebar tint follows the chrome hex, because the chrome is now the titlebar's truthful neighbor.
- No intermediate shipped state; no tmux / xterm palette changes — xterm keeps painting `palette.background`, which is the whole point.

## Why

**The pain.** On desktop the sidebar card, the terminal tile, the top bar and the status bar are all the same color (`palette.background`), so the left panel does not read as a distinct panel. The only separation is the stage ground (`bg-bg-inset`) showing through the 6px gap plus a dimmed hairline. On dark themes `inset` is `darken(background, 5%)`, which in OKLab is a ΔL of 0.005–0.011 — perceptually nothing — so the gap is invisible and the sidebar and the terminal blur into one field. On light themes `inset` is ΔL 0.045 (visible) but `card` is only ΔL 0.02, so the asymmetry flips and there is still no single token that is "one visible step" in both categories. The user's reference is macOS window chrome: sidebar + toolbar on a gray material, the content well keeping its own color.

**If we don't fix it.** The desktop frame keeps reading as one undifferentiated slab on every dark theme (the majority of the 70 shipped palettes), the 6px gap seam the two-family vocabulary depends on stays decorative rather than functional, and any per-surface polish (row tints, hover fills, the popup elevation contract) keeps being tuned against a ground that is not visually there.

**Why this approach.** The study (`docs/wiki/sidebar-material-studies.html` § D–F) measured the alternatives:

- **Reuse `bg-bg-card` or `bg-bg-inset`** — rejected: neither is the same visible step in both theme categories (numbers above). The real change is a new token derived in a perceptual space (OKLCH ΔL), not a percentage lighten/darken in sRGB.
- **Recessed** (the sidebar drops its card and becomes the ground) — rejected: clamps at black on the `#000000` themes (`tomorrow-night-bright`, `synthwave`, `dark-pastel`), nearly invisible on `ayu-dark` / `night-owl`, and on light themes indistinguishable from lifted-with-flush-seam. The card also carries the drag-resize sash affordance.
- **Lifted card only** (sidebar gray, frame stays terminal-colored) — rejected as a shipped intermediate: a gray card inside a palette-colored frame is the least coherent state. The devtools eyeball check covers what a live trial would have shown.
- **Full-height sidebar** (sidebar column spans the top bar) — parked: a layout change (the sidebar toggle, history arrows and breadcrumb live in the top bar's left cell), not a color change.
- **Flush / hairline seams** — rejected for this change; the 6px gap is kept and made functional by stepping the stage ground one further ΔL past the chrome.
- **Chrome material** — chosen: the attached frame (top bar + status bar) and the sidebar share one gray material; content tiles keep `palette.background`. It maps 1:1 onto the existing two-family chrome vocabulary (`visual-design.md` § Design Decisions → Two-family chrome vocabulary) and makes the PWA titlebar color truthful.

Derivation must be palette-derived (`docs/specs/themes.md` § UI Color Derivation) — 70 palettes ship in `configs/themes.json`, so a hardcoded gray is not an option; the static hexes in `globals.css` are first-paint fallbacks only.

## What Changes

### 1. Two new derived tokens in `app/frontend/src/themes.ts`

Extend `deriveUIColors(palette, category)` with two keys. Both are OKLCH transforms of `palette.background`, brought into sRGB by the existing stepwise chroma reduction (`oklchToHexInGamut`, `themes.ts:335`) — L and hue are preserved, only chroma moves, exactly as the row-family pipeline does.

```ts
/** OKLab lightness step from the palette background to the chrome material
 *  (sidebar, top bar, status bar, mobile drawer). Up on dark, down on light. */
const CHROME_L_DELTA = 0.06;
/** Further lightness step, same direction, for the surface one level above the
 *  chrome: uncolored row hover on the chrome, and the Shell stage ground. */
const CHROME_RAISED_L_DELTA = 0.035;
/** Fraction of the background's OKLab chroma the chrome keeps — a gray that
 *  still leans the palette's way rather than a neutral slab. */
const CHROME_CHROMA_KEEP = 0.35;

// inside deriveUIColors:
const bgLab = hexToOklab(palette.background);
const bgChroma = Math.hypot(bgLab.a, bgLab.b);
const bgHueDeg = (Math.atan2(bgLab.b, bgLab.a) * 180) / Math.PI;
const dir = isDark ? 1 : -1;
bgChrome: oklchToHexInGamut(bgLab.L + dir * CHROME_L_DELTA, bgChroma * CHROME_CHROMA_KEEP, bgHueDeg),
bgChromeRaised: oklchToHexInGamut(bgLab.L + dir * (CHROME_L_DELTA + CHROME_RAISED_L_DELTA), bgChroma * CHROME_CHROMA_KEEP, bgHueDeg),
```

(`oklchToHexInGamut` takes hue in degrees — `themes.ts:309`. A private `oklabChroma(hex)` helper already exists at `themes.ts:346`; reuse or extract a shared `hexToOklch` rather than duplicating the polar conversion.)

Register both keys:

- `UIColors` type (`themes.ts:20`) — add `bgChrome` and `bgChromeRaised`. The type goes from 9 keys to 11; `themes.test.ts:174` asserts `toHaveLength(9)` and must become 11.
- `COLOR_CSS_MAP` (`themes.ts:43`) — `bgChrome: "--color-bg-chrome"`, `bgChromeRaised: "--color-bg-chrome-raised"`. `applyThemeToDOM` (`contexts/theme-context.tsx:72`) iterates the map, so the runtime write needs no other change.
- Doc comments in `deriveUIColors` / `applyThemeToDOM` that say "9 UI colors" become 11.

Indicative values (computed with the same OKLab matrices as `themes.ts`; the apply agent MUST take the authoritative values from `deriveUIColors` output, not from this table):

| Palette | background | L | chrome | ΔL | chrome-raised | further ΔL |
|---------|-----------|---|--------|----|---------------|------------|
| default-dark | `#0f1117` | 0.178 | `#1e1f21` | +0.061 | `#262729` | +0.034 |
| default-light | `#f8f9fb` | 0.982 | `#e5e5e6` | −0.060 | `#d9dada` | −0.035 |
| solarized-light | `#fdf6e3` | 0.974 | `#e5e2dc` | −0.060 | `#d9d7d0` | −0.035 |
| gruvbox-light | `#fbf1c7` | 0.956 | `#e0ddcf` | −0.060 | `#d5d1c3` | −0.036 |
| ayu-dark | `#0b0e14` | 0.163 | `#1a1b1e` | +0.059 | `#222426` | +0.037 |

### 2. Static fallbacks + Tailwind utilities in `app/frontend/src/globals.css`

Add `--color-bg-chrome` and `--color-bg-chrome-raised` to all three blocks so Tailwind v4 emits `bg-bg-chrome` / `bg-bg-chrome-raised` (and `hover:` variants) and first paint has a value before `applyThemeToDOM` runs:

- `@theme { … }` (`globals.css:29`) — default-dark values.
- `html[data-theme="dark"] { … }` (`globals.css:51`) — default-dark values.
- `html[data-theme="light"] { … }` (`globals.css:69`) — default-light values.

The fallbacks are `deriveUIColors(DEFAULT_DARK_THEME.palette, "dark")` and `deriveUIColors(DEFAULT_LIGHT_THEME.palette, "light")` outputs — add a unit test that reads the CSS file (or a small exported constant) and pins the four fallback hexes equal to the derived values so they cannot drift.

### 3. Re-points — surfaces that become chrome

| Surface | File | Today | After |
|---------|------|-------|-------|
| Desktop sidebar `<aside>` | `components/shell/shell.tsx:290-294` | `rounded-md border rk-card-border bg-bg-primary` | `… bg-bg-chrome` (card shape unchanged) |
| Mobile sidebar drawer | `components/shell/shell.tsx:361-366` | `bg-bg-primary border-r border-border …` | `bg-bg-chrome …` (border kept) |
| Shell stage ground | `components/shell/shell.tsx:281` | `className="bg-bg-inset"` | `className="bg-bg-chrome-raised"` |
| Host page `/` root ground | `components/host-overview-page.tsx:304` | `flex flex-col h-full bg-bg-inset` | `… bg-bg-chrome-raised` — the host page mounts no Shell and carries its own ground under the same chrome-colored top bar; moving it keeps every route on one ground |
| Top bar | `components/top-bar.tsx:1092` `<header>` + the wash wrapper `app.tsx:510` | header has no bg (inherits body = `bg-primary`); the wrapper paints `washHex` inline when an instance accent is set | chrome paint: `bg-bg-chrome` on the element the wash wrapper targets (or on the header with the wash moved inline there — one element must own both so the inline wash overrides the class, never the reverse); `washHex` blends into the chrome hex (§ 7) |
| Status bar | `components/status-bar.tsx:1106` | `border-t border-border bg-bg-primary` | `border-t border-border bg-bg-chrome` (frame chrome, never a card — shape unchanged); update the doc comment at `status-bar.tsx:47` |

Doc comments in `shell.tsx:96-97, 119, 287` and `status-bar.tsx:47` that name `bg-bg-inset` / `bg-bg-primary` for these surfaces must be updated to the new tokens (they state the family contract, so they stay — with the right token names).

### 4. Row tints blend into the surface — `computeRowTints(palette, surface)`

`computeRowTints(palette)` (`themes.ts:621`) blends every family tint (rest `TINT_BASE_RATIO` 0.14 · hover `TINT_HOVER_RATIO` 0.22 · selected `TINT_SELECTED_RATIO` 0.40) and the uncolored-selected gray sentinel (`UNCOLORED_SELECTED_RATIO` 0.5) into `palette.background`. Rows now sit on the chrome, so blending into the terminal color gives every tinted band a terminal-colored halo on the gray (the study's § B toggle shows it).

Change the signature to `computeRowTints(palette: ThemePalette, surface: string)` where `surface` is the hex the rows render on, and blend into `surface` instead of `palette.background`. Callers:

- `components/sidebar/index.tsx:236` — `computeRowTints(theme.palette, uiColors.bgChrome)` where the chrome hex comes from `deriveUIColors(theme.palette, theme.category)` (memoized on `theme`).
- `components/swatch-popover.tsx:150` — the label picker's live preview of the row tint; pass the same chrome hex so the preview matches the row it previews.

The uncolored-selected 0.5 sentinel was tuned to "beat the `bg-card/50` hover"; the hover is now `bg-bg-chrome-raised` (ΔL +0.035 from the chrome). Add a test that the gray sentinel's `selected` blend is farther from the chrome than the raised hover on both default palettes so selection still wins.

### 5. Uncolored row hover on the chrome → `hover:bg-bg-chrome-raised`

Rows that sit on the sidebar surface currently hover at `hover:bg-bg-card/50` — on the chrome that alpha fill of a palette-derived card color no longer reads as "one step up". Replace with the opaque `hover:bg-bg-chrome-raised` at these sites (and the matching non-hover held-open state):

- `components/sidebar/window-row.tsx:647` — the flyout-open held state `bg-bg-card/50` → `bg-bg-chrome-raised`
- `components/sidebar/session-row.tsx:333` — `hover:bg-bg-card/50`
- `components/sidebar/server-panel.tsx:285` — `uncoloredHoverClass` `hover:bg-bg-card/50`
- `components/sidebar/boards-section.tsx:148-149` — active row `bg-bg-card` → `bg-bg-chrome-raised`; hover `hover:bg-bg-card/50` → `hover:bg-bg-chrome-raised`
- `components/sidebar/index.tsx:2990` — the empty-session create row `hover:bg-bg-card/50`

Popups that sit on `bg-bg-primary` keep their current classes — they are not on the chrome: `pin-popover.tsx:151/165/185/238`, `row-flyout-card.tsx` (`bg-bg-card` + `.rk-popup-elev`), identity tips, marker pad.

### 6. `globals.css` details

- **`.rk-scroll-fade-bottom`** (`globals.css:580`) — the study inventory listed it as a gradient to `--color-bg-primary`; it is in fact a `mask-image` to transparent (no background color involved), so it fades correctly on any surface. **No change** — verify by screenshot at the sidebar's bottom edge.
- **`.rk-band-fade`** (`globals.css:1631`) — a gradient to `--color-bg-primary` inside popovers that sit on `bg-primary`. **No change.**
- **Sash grip dots** (`globals.css:1609-1610`) — `.rk-sash-hot .rk-grips i` / `.rk-sash-lit .rk-grips i` invert to `var(--color-bg-inset)` when lit; the dots sit in the stage gap, whose ground is now `chrome-raised`. Change both rules to `var(--color-bg-chrome-raised)` so the lit dots still vanish into the ground.

### 7. PWA `theme-color` and the desktop titlebar follow the chrome — `src/instance-accent.ts`

The single theme-color writer holds `lastBackground` (bare path) and `currentAccentHex` (accent path, the 35% `titlebarHex` blend). Both are derived from `theme.palette.background` today. With a chrome-colored top bar the truthful neighbor of the titlebar is the chrome hex:

- `applyThemeToDOM` (`contexts/theme-context.tsx:94`) calls `applyThemeColorMeta(uiColors.bgChrome)` instead of `theme.palette.background`.
- `deriveAccentHexes(value, theme)` (`instance-accent.ts:80`) blends `titlebarHex` (`INSTANCE_TITLEBAR_RATIO` 0.35) and `washHex` (`INSTANCE_WASH_RATIO` 0.065) into the chrome hex, and contrast-guards `stripeHex` (`adjustBorderForContrast`) against the chrome — all three accent surfaces (titlebar band, top-bar wash, 2px stripe / HOST hostname tint) now sit on the chrome. The chrome hex comes from `deriveUIColors(theme.palette, theme.category).bgChrome`.
- `index.html`'s blocking pre-paint script falls back to per-mode defaults (`#0f1117` dark / `#f8f9fb` light) when no echoed hex exists — update those two literals to the default chrome fallbacks so an accent-less cold start does not flash terminal-colored then snap to chrome. The `runkit-instance-color` echo self-corrects at runtime as today.

### 8. Leave as-is, verify by screenshot

- Coarse status rail / PANE wells / switch-off track on `bg-bg-inset` (`session-row.tsx:474`, `sidebar/index.tsx:2834`, `window-row.tsx:1066`, `status-panel.tsx:282/363`) — on a lifted gray they become darker wells. Accepted on dark; check they do not read as holes on `solarized-light` / `gruvbox-light`.
- `--color-border` stays derived against the palette background — hairlines inside the sidebar lose ~10% contrast on the chrome at ΔL 0.06; acceptable.
- Row-flyout card (`bg-bg-card` + `.rk-popup-elev`) — unchanged; occlusion separation now also gets lightness contrast.
- xterm keeps painting `palette.background` (`deriveXtermTheme` untouched); the quake terminal's glass (`bg-primary` at α) is unchanged.
- Board panes, the `/$server` 900px column, and every other content card stay on `bg-bg-primary`.

### 9. Docs and memory

- `docs/specs/themes.md` § UI Color Derivation — the table says "8 CSS custom properties" (it is 9 today with `--color-accent-bright`); make it 11 and add rows:
  - `--color-bg-chrome` | `oklch(L ± 0.06, C × 0.35, h)` of `background` — up on dark, down on light; gamut-reduced by chroma
  - `--color-bg-chrome-raised` | one further `0.035` L step in the same direction, same chroma
- `docs/memory/run-kit/ui/visual-design.md` (hydrate): the color-token table (rows for both tokens with the default-dark / default-light fallback hexes; the `--color-bg-inset` row loses "Shell stage, host page root" from its description), the § Design Decisions → Two-family chrome vocabulary entry (the attached frame AND the sidebar share the chrome material while the sidebar keeps the card shape; content tiles keep the palette background; the stage ground is `chrome-raised`), the "9 UIColors keys" statement (→ 11), and the theme-color / instance-accent paragraphs (base = chrome hex).
- `routes-and-shell.md` — stage ground token (`bg-bg-inset` → `bg-bg-chrome-raised`), the host page root line (`host-overview-page.tsx:240` is stale — it is `:304`).
- `sidebar.md` — "Row-hover fill is ONE alpha everywhere — `bg-bg-card/50`" → `bg-bg-chrome-raised` on the chrome; the held-open flyout state.
- `status-signals.md` — the status bar's `bg-bg-primary` → `bg-bg-chrome`.
- `updates-and-notifications.md` / `visual-design.md` — theme-color source is the chrome hex.
- `docs/wiki/sidebar-material-studies.html` (new, as-is) and the `docs/specs/index.md` wiki row (as-is) are committed with this change.

### 10. Tests

**Unit (`app/frontend/src/themes.test.ts`)**:
- `deriveUIColors` emits `bgChrome` and `bgChromeRaised` as valid hex for all 70 themes (extend the all-keys test to 11).
- For a dark palette (`default-dark`) and a light palette (`solarized-light`): `|ΔL(chrome, background) − 0.06| < 0.01`, direction up on dark / down on light; `|ΔL(raised, chrome) − 0.035| < 0.01` same direction.
- Chroma of both tokens ≤ 35% of the background's chroma (+ a small epsilon for hex rounding).
- The `#000000` themes produce a chrome distinct from the background (no clamp to black).
- `computeRowTints(palette, surface)` blends into `surface`: with a chrome surface the `base` tint of a family is closer to the chrome than to `palette.background`; the gray sentinel's `selected` beats the raised hover step.
- The four `globals.css` fallback hexes equal the derived default values.

**Component tests**: `components/shell/shell.test.tsx:92` (stage `bg-bg-inset` → `bg-bg-chrome-raised`), `:139` (aside `bg-bg-primary` → `bg-bg-chrome`); `components/status-bar.test.tsx:173` (`bg-bg-primary` → `bg-bg-chrome`); `components/top-bar.test.tsx` (add an assertion for the chrome class on whichever element owns it); an `instance-accent` test that `deriveAccentHexes` blends into the chrome hex, and a theme-context test that the meta receives the chrome hex.

**Gate**: `just test-frontend` in full (touched-file-only runs have missed cross-file breaks).

**E2e**: grep `app/frontend/tests/e2e/*.spec.ts` for `bg-bg-primary` / `bg-bg-inset` assertions on the aside or stage (none found at intake time — confirm). `control-gallery` snapshot baselines: the gallery is not the sidebar and the Control primitive emits none of these tokens, so baselines should be unaffected — confirm with `just test-e2e control-gallery.spec`. Add a committed spec (e.g. `chrome-material.spec.ts`, with the constitution's Proves/Steps intent comments) that, at 1440×900 on the terminal route, reads `getComputedStyle(...).backgroundColor` of the aside, the top bar, the status bar and the terminal tile and asserts chrome ≠ terminal, aside = top bar = status bar, and the xterm `.xterm-screen`/viewport background = `palette.background`; run it under `page.emulateMedia({ colorScheme })` dark and light (the `present-viewer.spec.ts:287` precedent) and with `localStorage["runkit-theme-light"] = "solarized-light"` for the warm-light case.

**Visual verification** (ad hoc, not committed): headless Playwright screenshots against a `just dev` rig on default-dark, default-light and solarized-light at 1440×900 — sidebar bottom edge (no fade smear), the light-theme wells (§ 8), the lit sash grip dots, and a tinted + a selected row on the chrome.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) color-token table (+2 rows, inset row description), Two-family chrome vocabulary DD, UIColors key count, theme-color / instance-accent base = chrome hex
- `run-kit/ui/routes-and-shell`: (modify) stage ground token, host page root ground + stale line ref
- `run-kit/ui/sidebar`: (modify) uncolored row hover / held-open fill on the chrome
- `run-kit/ui/status-signals`: (modify) status bar surface token
- `run-kit/ui/updates-and-notifications`: (modify) theme-color source

## Impact

- **Frontend source** (`app/frontend/src/`): `themes.ts` (+2 tokens, 3 constants, `computeRowTints` signature), `globals.css` (3 blocks + 2 sash rules), `components/shell/shell.tsx` (3 classes), `components/host-overview-page.tsx` (1 class), `components/top-bar.tsx` / `app.tsx` (chrome paint + wash base), `components/status-bar.tsx` (1 class), 5 sidebar row files (hover classes), `components/sidebar/index.tsx` + `components/swatch-popover.tsx` (tint call sites), `contexts/theme-context.tsx` + `instance-accent.ts` (chrome base), `index.html` (2 fallback literals).
- **Tests**: `themes.test.ts`, `shell.test.tsx`, `status-bar.test.tsx`, `top-bar.test.tsx`, instance-accent/theme-context tests, one new e2e spec.
- **Docs**: `docs/specs/themes.md`, five memory files, the new wiki study + specs-index row.
- **No backend, no API, no tmux, no keyboard, no route changes** (Constitution IV/V untouched). No dependency changes.
- **Risk**: every theme re-derives two more colors on switch (two OKLCH conversions — negligible). Visual regression risk is on light themes (wells, hairline contrast) — covered by the § 8 screenshot pass.

## Open Questions

- If the `bg-bg-inset` wells (§ 8) read as holes on `solarized-light` / `gruvbox-light`, is the fix a third chrome-relative token (`chrome-inset`) or accepting it? Decide at review from the screenshots; the default is to accept.
- Should the swatch popover's tint preview use the chrome hex (§ 4) — recorded as assumption 7.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chrome material variant: sidebar + top bar + status bar + mobile drawer on one new derived gray; content tiles stay on `palette.background` | Discussed — user approved this variant explicitly over lifted/recessed/full-height and said "proceed" | S:95 R:70 A:90 D:95 |
| 2 | Certain | Flush stage seam: the stage ground and host-page root paint `--color-bg-chrome`, the sidebar is a flat borderless column on it, `--color-bg-chrome-raised` is hover only (amended 2026-09-16; the 6px-gap seam shipped first and was dropped after a live preview) | User decision after seeing both live; hairline seam still rejected | S:95 R:85 A:90 D:95 |
| 3 | Certain | Derivation: OKLCH of `palette.background`, `CHROME_L_DELTA` 0.06 (up dark / down light), `CHROME_RAISED_L_DELTA` 0.035, `CHROME_CHROMA_KEEP` 0.35, gamut-reduced via the existing `oklchToHexInGamut` | Discussed — the study's § D/F mechanism with the exact constants; the row-family pipeline is the precedent | S:95 R:80 A:95 D:90 |
| 4 | Certain | Both tokens registered in `UIColors`, `COLOR_CSS_MAP`, `@theme` and both `html[data-theme]` blocks with static fallbacks from the default palettes | Follows the existing token pattern (`bgInset`); `applyThemeToDOM` iterates the map | S:90 R:90 A:95 D:95 |
| 5 | Certain | Host page `/` root ground moves from `bg-bg-inset` to `bg-bg-chrome-raised` | Description asked for this "for cross-route consistency (assumption to record)"; the host page mounts no Shell and sits under the same chrome top bar | S:80 R:90 A:80 D:80 |
| 6 | Certain | `computeRowTints` gains a required `surface` argument; the sidebar passes the chrome hex | Discussed — study § E: blending into the terminal color leaves a halo on the gray | S:90 R:85 A:90 D:85 |
| 7 | Confident | `swatch-popover.tsx:150` also passes the chrome hex to `computeRowTints` (its preview represents a sidebar row) | Second caller not named in the discussion; the popover itself sits on `bg-primary`, so either base is defensible — the preview's referent (a row on the chrome) decides. Would have asked; deferred — promptless dispatch | S:40 R:90 A:55 D:45 |
| 8 | Certain | Uncolored hover on chrome rows: `hover:bg-bg-card/50` → opaque `hover:bg-bg-chrome-raised` at the five listed sites; popups on `bg-primary` keep their classes | Description item 4 names the sites; opaque step because the raised token IS the hover step by definition | S:85 R:90 A:80 D:80 |
| 9 | Certain | `.rk-scroll-fade-bottom` needs no change — it is a `mask-image` to transparent, not a color gradient (the description/study inventory was wrong on this point); `.rk-band-fade` stays on `bg-primary` | Verified in `globals.css:580-583` | S:80 R:95 A:95 D:95 |
| 10 | Certain | Lit sash grip dots invert to `--color-bg-chrome-raised` (the new gap ground) | Description item 6; the dots sit in the stage gap | S:85 R:95 A:90 D:90 |
| 11 | Confident | `applyThemeColorMeta` receives the chrome hex, and `deriveAccentHexes` re-bases all three hexes (titlebar, wash, stripe guard) onto the chrome | Description names the titlebar path for both bare and accent-blended cases; wash and stripe render on the same chrome surface, so the same truthful-neighbor rule applies. Would have asked about the wash/stripe extension; deferred — promptless dispatch | S:65 R:85 A:75 D:65 |
| 12 | Certain | The chrome paint and the inline `washHex` share one element (the wash wrapper `app.tsx:510` or the header) so the inline wash overrides the class | Verified: the header has no bg today and the wrapper paints the wash inline; two elements would let the class hide the wash | S:70 R:90 A:85 D:75 |
| 13 | Certain | `index.html` pre-paint fallback literals move to the default chrome hexes | Same single-writer contract; avoids a terminal-colored flash before `applyThemeToDOM` | S:60 R:95 A:85 D:80 |
| 14 | Confident | `bg-bg-inset` wells / rail / switch-off track, `--color-border`, row-flyout elevation, xterm background, board panes and the server column are left unchanged; light-theme wells verified by screenshot with "accept" as the default outcome | Description item 8 and the out-of-scope list; the wells' fate if they read as holes is the one open question — decide at review. Would have asked; deferred — promptless dispatch | S:75 R:90 A:60 D:65 |
| 15 | Confident | Computed-style assertions land as a committed e2e spec (chrome ≠ terminal; aside = top bar = status bar; xterm = `palette.background`) on dark, light and solarized-light; screenshots stay ad hoc | code-quality.md: UI changes SHOULD include e2e tests where possible; `present-viewer.spec.ts` shows the `emulateMedia` colorScheme precedent | S:60 R:90 A:80 D:70 |
| 16 | Certain | Study HTML + specs-index row committed as-is; memory hydrated per § 9; Themes-spec rows added | Description "Docs" section; the always-load layer and hydrate stage own the mechanics | S:90 R:95 A:90 D:95 |
| 17 | Certain | No tmux, xterm palette, route, keyboard or backend change; quake-terminal launcher move and full-height sidebar are separate changes | Description constraints and out-of-scope list; Constitution IV/V | S:95 R:95 A:95 D:95 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).
