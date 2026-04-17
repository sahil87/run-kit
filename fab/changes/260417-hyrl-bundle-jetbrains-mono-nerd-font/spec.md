# Spec: Bundle JetBrainsMono Nerd Font as a webfont in the frontend

**Change**: 260417-hyrl-bundle-jetbrains-mono-nerd-font
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Investigating tmux 3.2a vs 3.6a environment drift on the Ubuntu VM — tracked separately in the intake's Issue (1). This change does NOT address byte-level differences in the tmux output stream.
- Updating `font-family` for non-terminal surfaces (sidebar, command palette, session cards). The `--font-mono` Tailwind variable already lists `"JetBrainsMono Nerd Font"` first, so those surfaces will pick up the bundled font automatically; no further scope is in this change.
- Subsetting the font to reduce bundle size. The full Nerd Font is kept for coverage of powerline/icon codepoints.
- Adding a second theme-specific font family. The terminal uses one font everywhere.

## Frontend Assets: Webfont Bundling

### Requirement: Three-weight webfont bundle

The frontend SHALL bundle JetBrainsMono Nerd Font in three weights — Regular (400 normal), Bold (700 normal), Italic (400 italic) — served from the same origin as the app. Sources MAY be (a) an `@fontsource/*`-style npm package imported into the frontend build, or (b) `.woff2` files in `app/frontend/public/fonts/` referenced by hand-authored `@font-face` rules in `globals.css`. The choice between (a) and (b) SHALL be made at apply time by verifying the current npm registry state.

#### Scenario: npm package available
- **GIVEN** an `@fontsource/*` package publishing JetBrainsMono Nerd Font (Regular, Bold, Italic) is available on the npm registry
- **WHEN** the apply step resolves the font source
- **THEN** the package SHALL be added as a `dependencies` entry in `app/frontend/package.json`
- **AND** its CSS sub-path imports (or equivalent) SHALL be wired into the frontend so all three weights are served at build time
- **AND** `app/frontend/public/fonts/` MAY be left empty or removed for the affected weights

#### Scenario: no suitable npm package
- **GIVEN** no current `@fontsource/*` (or equivalent) npm package publishes the three JetBrainsMono Nerd Font weights
- **WHEN** the apply step resolves the font source
- **THEN** the three `.woff2` files (Regular, Bold, Italic) SHALL be downloaded from the Nerd Fonts GitHub release (OFL 1.1 licensed)
- **AND** placed in `app/frontend/public/fonts/` as `JetBrainsMonoNerdFont-Regular.woff2`, `JetBrainsMonoNerdFont-Bold.woff2`, `JetBrainsMonoNerdFont-Italic.woff2`
- **AND** three hand-authored `@font-face` rules in `app/frontend/src/globals.css` SHALL reference them via `/fonts/*.woff2`

#### Scenario: Regular weight already bundled
- **GIVEN** `app/frontend/public/fonts/JetBrainsMonoNerdFont-Regular.woff2` already exists (seeded in commit `817e3cc`) and `globals.css` already declares a single `@font-face` rule for Regular with `font-display: swap`
- **WHEN** the apply step takes path (b)
- **THEN** the existing Regular file SHALL be retained
- **AND** Bold + Italic SHALL be added
- **AND** the existing `font-display: swap` SHALL be changed to `font-display: block` for all three rules (see Font-Loading Timing)

### Requirement: Single `font-family` name resolves all glyphs

All three `@font-face` rules SHALL expose the same `font-family: "JetBrainsMono Nerd Font"` name. The patched single-file Nerd Font variant (one font covers both text and Nerd Font glyphs) is chosen over the split `JetBrains Mono + Symbols Nerd Font Mono` approach for CSS simplicity.

#### Scenario: consuming code references one name
- **GIVEN** the three weights are installed per the Three-weight webfont bundle requirement
- **WHEN** any frontend code sets `font-family` to `"JetBrainsMono Nerd Font"` (with the appropriate `font-weight` / `font-style`)
- **THEN** the browser SHALL resolve all glyphs (ASCII + Nerd Font private-use-area codepoints) from the same physical font file for that weight/style

### Requirement: `font-display: block` for all three faces

Each `@font-face` rule (Regular, Bold, Italic) SHALL declare `font-display: block`. Fallback metrics MUST NOT be used for any visible render, because xterm.js measures the character cell grid once at `terminal.open()` and does not re-measure when a deferred font arrives.

#### Scenario: webfont not yet loaded
- **GIVEN** a browser has not yet loaded the JetBrainsMono Nerd Font woff2 file(s)
- **WHEN** text with `font-family: "JetBrainsMono Nerd Font"` must be painted
- **THEN** the browser SHALL block painting that text for up to the block period (typically ~3s)
- **AND** SHALL NOT render the text using a system-font fallback during that period

### Requirement: Preload for Regular weight

`app/frontend/index.html` SHALL include a `<link rel="preload" as="font" type="font/woff2" crossorigin>` element for the Regular weight `.woff2` to minimize first-paint latency. The preload href MUST match the actual path served (either the fontsource package's built output path or `/fonts/JetBrainsMonoNerdFont-Regular.woff2`).

#### Scenario: first load of the app
- **GIVEN** a browser opens the app for the first time (no cached fonts)
- **WHEN** the HTML parses
- **THEN** the browser SHALL start downloading the Regular `.woff2` in parallel with the JS bundle
- **AND** the font SHALL be available when `await document.fonts.load(...)` is reached during terminal init

#### Scenario: preload href matches served path
- **GIVEN** a preload `<link>` is present in `index.html`
- **WHEN** the browser fetches the font via CSS `@font-face`
- **THEN** both fetches SHALL resolve to the same URL so the preload is actually reused (not double-fetched)

## Terminal Client: Font-Load Timing

### Requirement: Await three font weights before `terminal.open()`

The terminal init routine in `app/frontend/src/components/terminal-client.tsx` SHALL, before constructing `new Terminal(...)` and calling `terminal.open()` / `fitAddon.fit()`, await `document.fonts.load(...)` for all three weights at the exact pixel size the terminal will use. The three load calls MUST be issued concurrently (`Promise.all`), not sequentially.

The pixel size is computed as `isMobile ? 11 : 13` (unchanged from the current logic at `app/frontend/src/components/terminal-client.tsx:127`).

After the `await`, a fresh `cancelled` / `!terminalRef.current` guard SHALL be re-checked before proceeding, matching the existing pattern for `await import(...)` sites in the same effect (see `app/frontend/src/components/terminal-client.tsx:125`).

#### Scenario: first paint, webfont not cached
- **GIVEN** a fresh browser session (no cached fonts)
- **AND** the terminal component mounts
- **WHEN** the init routine runs
- **THEN** it SHALL issue three concurrent `document.fonts.load(...)` calls — one each for Regular, Bold, Italic at the chosen pixel size
- **AND** SHALL NOT call `new Terminal(...)` until all three promises resolve
- **AND** SHALL re-check `cancelled` / `!terminalRef.current` after the await returns

#### Scenario: subsequent navigations, webfont cached
- **GIVEN** the app has already loaded the font in a prior navigation
- **WHEN** the terminal component re-mounts
- **THEN** the three `document.fonts.load(...)` promises SHALL resolve near-instantly (typically < 50 ms)
- **AND** `terminal.open()` SHALL proceed without user-visible delay

#### Scenario: component unmounts during font load
- **GIVEN** the init routine is awaiting `Promise.all([document.fonts.load(...), ...])`
- **WHEN** the terminal component unmounts (cleanup runs, sets `cancelled = true`)
- **THEN** the init routine SHALL return without calling `new Terminal(...)` once the await resolves
- **AND** SHALL NOT leak a constructed terminal instance

### Requirement: Primary `fontFamily` is the bundled webfont

The `fontFamily` option passed to `new Terminal(...)` in `app/frontend/src/components/terminal-client.tsx` SHALL be `'"JetBrainsMono Nerd Font", ui-monospace, monospace'` — the bundled webfont first, then `ui-monospace` as the system-default monospace, then the generic `monospace` keyword. The current intermediate entries (`JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas`) SHALL be removed.

#### Scenario: webfont loads successfully
- **GIVEN** the preceding font-load requirement is satisfied
- **WHEN** xterm renders terminal content
- **THEN** all glyphs SHALL resolve to the bundled "JetBrainsMono Nerd Font"

#### Scenario: webfont load catastrophically fails
- **GIVEN** the webfont URL is unreachable (e.g., corporate proxy blocks the woff2, bundle serving is broken)
- **AND** `document.fonts.load(...)` eventually rejects OR the `font-display: block` period expires
- **WHEN** xterm renders terminal content
- **THEN** the browser SHALL fall back to `ui-monospace`
- **AND** if `ui-monospace` is not available, fall back to the generic `monospace` keyword

### Requirement: `LINE_HEIGHT` derivation unchanged

The touch-scroll `LINE_HEIGHT` derivation at `app/frontend/src/components/terminal-client.tsx:272` reads from `xtermRef.current?.options.fontSize` and SHALL NOT require any change. The font-size source of truth remains the Terminal options.

#### Scenario: touch scroll after font change
- **GIVEN** the bundled font is installed and the terminal is running on mobile
- **WHEN** a touch gesture triggers the SGR-wheel scroll calculation
- **THEN** the `LINE_HEIGHT` SHALL resolve from `xtermRef.current.options.fontSize` without modification

## Global Font Stack: Tailwind `--font-mono`

### Requirement: Keep a webfont-first `--font-mono` stack

The `--font-mono` custom property in `app/frontend/src/globals.css` SHALL continue to list `"JetBrainsMono Nerd Font"` first. The long system-font tail (`"JetBrains Mono"`, `"Fira Code"`, `"SF Mono"`, `"Menlo"`, `"Monaco"`, `"Consolas"`) MAY be trimmed to `"JetBrainsMono Nerd Font", ui-monospace, monospace` for consistency with the terminal's `fontFamily`, but this is not required for correctness and SHOULD only be done if it does not require rebaselining unrelated visual snapshots.

#### Scenario: non-terminal monospace surfaces
- **GIVEN** a non-terminal UI surface (e.g., a code block in the command palette) uses `font-family: var(--font-mono)`
- **WHEN** the webfont is loaded
- **THEN** text SHALL render in the bundled "JetBrainsMono Nerd Font"

## Build & Tests

### Requirement: Frontend build succeeds with the bundled font

`just build-frontend` SHALL succeed, producing a Vite bundle that includes the three `.woff2` files (either vendored via fontsource or copied from `public/fonts/`). All `@font-face` URLs in the built CSS MUST resolve to paths actually served from the `dist/` output.

#### Scenario: fresh build
- **GIVEN** the frontend source tree with the font bundled per the earlier requirements
- **WHEN** `just build-frontend` runs
- **THEN** the command SHALL exit 0
- **AND** the `app/frontend/dist/` output SHALL contain three `.woff2` files (Regular, Bold, Italic) referenced by the built CSS

### Requirement: Existing tests continue to pass

`just test` SHALL succeed. No existing unit, component, or e2e tests are expected to fail as a consequence of this change. If any existing test breaks, the fix SHALL either (a) update the test to match the new specification or (b) correct an actual regression in the implementation — never silently patch the test to make failure disappear without investigation.

#### Scenario: full test run
- **GIVEN** the change is fully applied (deps, CSS, preload, `fontFamily`, font-load await)
- **WHEN** `just test` runs
- **THEN** the command SHALL exit 0
- **AND** no test file SHALL be modified purely to accommodate the font change unless its assertion was genuinely invalidated by the new behavior

#### Scenario: visual e2e rebaseline needed
- **GIVEN** a Playwright e2e test asserts pixel-exact dimensions or visual snapshots of terminal output
- **WHEN** the font change produces a legitimate visible difference (e.g., slightly different glyph widths) that invalidates the snapshot
- **THEN** the snapshot SHALL be rebaselined
- **AND** the rebaseline SHALL be noted explicitly in the apply log / tasks.md as a visual change

## Design Decisions

1. **Font source preference**: fontsource-style npm package if available, manual drop-in otherwise.
   - *Why*: An npm package gives us versioning, dedup with other deps, and cleaner imports. It's also the ecosystem convention for bundled webfonts.
   - *Rejected*: Always-manual drop-in — loses versioning & dedup benefits; CDN webfont — adds runtime dependency on a third party and contradicts the self-contained-dashboard design principle; system-font stack — is the current state and produces the bug.

2. **Patched single-file variant over split `JetBrains Mono + Symbols Nerd Font`**:
   - *Why*: One `font-family` value resolves all glyphs including Nerd Font private-use-area codepoints. CSS stays simple (three `@font-face` rules, not six). Bundle-size delta (~1–4 MB vs 400 KB–1 MB) is acceptable for a local-first developer tool.
   - *Rejected*: The split approach saves bundle size but doubles the `@font-face` declarations and requires a `unicode-range` split, adding complexity disproportionate to its benefit.

3. **`font-display: block` over `swap`**:
   - *Why*: xterm measures the character cell grid exactly once at `terminal.open()`. `swap` would cause a FOUT that persists as permanent cell-measurement misalignment until resize. `block` ensures fallback metrics are never used for the initial measurement.
   - *Rejected*: `swap` (better for body text) — wrong choice here; `fallback` / `optional` — similar rendering-timing issues for xterm; `auto` — browser default varies and is not deterministic.

4. **`await document.fonts.load(...)` with three explicit weights**:
   - *Why*: `document.fonts.ready` waits for every face that CSS has requested, which on a complex page can include unrelated fonts. Three explicit `document.fonts.load(size, family)` calls scope the await to exactly the weights xterm will request.
   - *Rejected*: `document.fonts.ready` — over-broad; no await at all — the bug we're fixing; `setTimeout` after render — racy and unreliable.

5. **Preload Regular only, not all three weights**:
   - *Why*: First paint of any terminal content needs Regular. Bold/Italic are used for SGR-styled text and are a smaller fraction of the initial paint. Preloading only Regular keeps the critical-path footprint small (~1 MB, not 3 MB) while still eliminating first-paint wait for the most common case.
   - *Rejected*: Preload all three — doubles/triples the critical-path byte count for a minor ancillary benefit; preload none — gives up the first-paint win that motivated this change.

6. **Trim the long system-font fallback list in `fontFamily`**:
   - *Why*: Once the webfont is bundled, the intermediate entries (`JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas`) are unreachable in practice — `font-display: block` plus a successful load means the webfont always wins. Keeping them adds noise without value. `ui-monospace` + generic `monospace` guard against total load failure.
   - *Rejected*: Keep the full list — adds complexity, and the long tail is now dead code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Font package: patched single-file JetBrainsMono Nerd Font (not split JetBrains Mono + Symbols Nerd Font Mono) | Confirmed from intake #1 — user explicitly chose this variant during `/fab-discuss` | S:95 R:70 A:90 D:90 |
| 2 | Certain | Weights: Regular + Bold + Italic (all three) | Confirmed from intake #2 — user explicitly answered "All 3" | S:95 R:80 A:90 D:95 |
| 3 | Certain | Font source preference: fontsource-style npm package if available, manual drop-in otherwise | Confirmed from intake #3; the intake's "research step" becomes an explicit apply-time decision gate | S:90 R:75 A:85 D:90 |
| 4 | Certain | Font loading MUST complete before `terminal.open()` / `fitAddon.fit()` via three concurrent `document.fonts.load(...)` awaits | Confirmed from intake #4 — xterm cell measurement is once-at-open and not re-taken; concurrency via `Promise.all` is codified | S:90 R:70 A:90 D:95 |
| 5 | Certain | Post-await `cancelled` / `!terminalRef.current` re-check matches existing pattern (lines 125, 146, 151, 161, 210 of terminal-client.tsx) | Confirmed by reading the current effect body — five existing sites already use this guard | S:95 R:85 A:95 D:95 |
| 6 | Certain | Primary `fontFamily` becomes `'"JetBrainsMono Nerd Font", ui-monospace, monospace'`, dropping the intermediate system-font tail | Upgraded from intake #5 (Confident → Certain) — `font-display: block` on a successful load makes the tail unreachable; `ui-monospace` + `monospace` are sufficient failure guards | S:85 R:70 A:85 D:80 |
| 7 | Certain | `font-display: block` on all three faces (not `swap`) | Upgraded from intake #7 (Confident → Certain) — direct consequence of xterm's once-at-open cell measurement; `swap` produces persistent misalignment | S:90 R:70 A:90 D:90 |
| 8 | Certain | Only `app/frontend/src/components/terminal-client.tsx` needs code changes (no other xterm instances) | Upgraded from intake #8 (Confident → Certain) — grep confirms TerminalClient is the only xterm consumer | S:95 R:70 A:95 D:95 |
| 9 | Certain | Add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for Regular weight only in `index.html` | Confirmed from intake #12; preloading Regular-only is the smallest critical-path footprint that still wins the first-paint case | S:95 R:80 A:85 D:80 |
| 10 | Certain | Change type is `fix` (or `chore`) — no user-visible behavior change beyond consistent glyph rendering | Confirmed via preflight: `fab score` shows `change_type: fix`. Intake #6 had `chore`; preflight's stored type is `fix`, which we accept | S:90 R:85 A:90 D:80 |
| 11 | Certain | Regular `JetBrainsMonoNerdFont-Regular.woff2` already exists at `app/frontend/public/fonts/` (seeded in commit 817e3cc) and the current `@font-face` rule uses `font-display: swap` — both facts are load-bearing | Verified by reading `app/frontend/src/globals.css` and `git log` | S:100 R:95 A:100 D:100 |
| 12 | Certain | Memory update lives in existing `docs/memory/run-kit/ui-patterns.md` (new subsection under "Terminal Font Scaling"), not a new `run-kit/fonts.md` | Confirmed from intake #9 — single-font project doesn't warrant a dedicated file | S:85 R:90 A:90 D:85 |
| 13 | Certain | `ui-monospace` first in the post-webfont fallback list | Confirmed from intake #13 — generic-family-before-legacy-names is the modern pattern | S:95 R:85 A:70 D:55 |
| 14 | Certain | Bundle-size delta of ~1–4 MB (three woff2 weights) is acceptable; no subsetting at this stage | Confirmed from intake #11; subsetting is a possible future follow-up, not this change | S:95 R:75 A:65 D:60 |
| 15 | Certain | No change to backend, WebSocket/SSE wire format, tmux/session handling, or new config surface | Derived from "files touched" in intake §Impact — all touched files are in `app/frontend/` | S:100 R:95 A:100 D:100 |
| 16 | Confident | Non-terminal monospace surfaces already pick up the bundled font via `--font-mono` (which lists JetBrainsMono Nerd Font first); no per-component `font-family` changes needed | Read `globals.css` — the Tailwind `--font-mono` variable is already webfont-first | S:85 R:90 A:90 D:90 |
| 17 | Confident | Trimming `--font-mono` tail (dropping JetBrains Mono, Fira Code, etc.) is OPTIONAL and SHOULD only be done if it does not rebaseline unrelated snapshots | Symmetry with fontFamily trim; leaving tail unchanged is a safe no-op; trimming is aesthetic cleanup | S:75 R:65 A:85 D:70 |
| 18 | Confident | Apply step prefers retaining the existing Regular `.woff2` if path (b) is taken, rather than re-downloading | File is already there; re-download adds churn without benefit | S:85 R:85 A:90 D:85 |
| 19 | Confident | No Playwright visual-regression rebaseline is expected — the prior renderer already used the bundled Regular weight for most glyphs; the visible change is the elimination of per-character baseline wobble | Memory: `run-kit/ui-patterns.md` §"Terminal Font Scaling" already covers the 11/13px split; only font-metric determinism changes | S:75 R:65 A:75 D:70 |

19 assumptions (15 certain, 4 confident, 0 tentative, 0 unresolved).
