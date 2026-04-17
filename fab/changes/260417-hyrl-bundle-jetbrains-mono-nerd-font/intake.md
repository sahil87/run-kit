# Intake: Bundle JetBrainsMono Nerd Font as a webfont in the frontend

**Change**: 260417-hyrl-bundle-jetbrains-mono-nerd-font
**Created**: 2026-04-17
**Status**: Draft

## Origin

Discussion-mode session with `/fab-discuss`. User reported that xterm.js 6 text rendering "works fine" on their local Mac (both server and browser on the Mac) but shows wobbly per-character vertical baselines when running `rk serve` on a remote Ubuntu VM and viewing it from the Mac browser.

Debugging surfaced two independent issues:

1. **Environment drift between VM and Mac**: `tmux 3.2a` on the VM vs `tmux 3.6a` on the Mac (4 minor versions apart, spanning tmux's Unicode/grapheme-cluster rewrite in 3.4/3.5); `TERM=tmux-256color`, `LANG=C.UTF-8`, `LC_ALL=`, `LC_CTYPE=` on the VM. Likely a byte-level difference in the tmux output stream. Tracked separately.
2. **Font-fallback wobble**: The frontend's xterm `fontFamily` stack (`JetBrainsMono Nerd Font, JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace`) depends on whatever the viewer's browser has installed. When Nerd Font glyphs (powerline separators, icons) resolve to a different physical font than the ASCII text, per-glyph baseline metrics mismatch and text wobbles vertically within a row. Bundling the font eliminates this class of bug by making rendering deterministic across all viewers.

This change addresses (2) only. Issue (1) is out of scope and will be investigated separately.

Key decisions from the discussion:
- **Font package**: JetBrainsMono Nerd Font (patched, single-file variant) — one font covers both text and Nerd Font glyphs. Rejected the split `JetBrains Mono + Symbols Nerd Font Mono` approach for simplicity despite the slightly smaller bundle.
- **Weights**: Regular + Bold + Italic (all 3).
- **Source**: npm package (fontsource-compatible). Manual drop-in of `.woff2` files in `public/fonts/` only as fallback if no suitable npm package exists.
- **Loading timing**: `await document.fonts.load(...)` must complete before `terminal.open()` and `fitAddon.fit()`, because xterm measures the character cell grid at `open()` and does not re-measure when fonts arrive later.

> Bundle JetBrainsMono Nerd Font as a webfont in the frontend.
>
> Problem: xterm.js renders with whatever monospace font the viewer's browser happens to have installed. On environments without JetBrains Mono / Nerd Font, per-character font fallback causes baseline wobble and inconsistent glyph widths. Bundling the font makes terminal rendering deterministic across viewers.

## Why

1. **Problem**: xterm.js text rendering quality depends on the viewer's browser having the right monospace fonts installed. When it doesn't, browsers perform per-glyph font fallback, picking different physical fonts for different Unicode ranges (e.g., JetBrains Mono for ASCII, a generic emoji or symbol font for Nerd Font private-use-area codepoints). Different physical fonts have different ascender/descender metrics, producing visible baseline wobble within a single terminal row.

2. **Consequence if we don't fix it**: Every viewer environment is a new rendering variable. Ubuntu VMs, Windows machines without JetBrains Mono installed, phones, tablets, anyone opening the dashboard from a fresh browser profile all see subtly (or dramatically) different terminal output. This undermines the core value proposition of rk as a remote-terminal dashboard — if the rendering isn't trustworthy, the tool isn't trustworthy.

3. **Why bundling over alternatives**:
   - **Documentation ("install these fonts")** — fragile, invites support burden, won't work for mobile viewers.
   - **CDN webfont (jsdelivr, Google Fonts)** — adds a runtime network dependency on a third party, can be blocked by corporate proxies, contradicts the "self-contained dashboard" design principle.
   - **System-font stack (current)** — what we have now, produces the bug.
   - **Bundled webfont via npm** — deterministic, self-contained, works offline, no external runtime dependency, versioned with the rest of the frontend.

The patched-single-file approach (vs. split `JetBrains Mono + Symbols Nerd Font`) was chosen for CSS simplicity: one `font-family` value resolves all glyphs. The bundle-size delta (roughly 1–4 MB vs 400 KB–1 MB) is acceptable for a local-first developer tool that already bundles xterm.js, React, TanStack Router, and Tailwind.

## What Changes

### 1. Frontend dependency

Add JetBrainsMono Nerd Font as a versioned npm dependency in `app/frontend/package.json`.

**Research step required at apply time**: Verify the canonical npm package for JetBrainsMono Nerd Font. Candidates (ordered by preference):

- `@fontsource/jetbrains-mono-nerd-font` — if it exists, it's the cleanest fit (fontsource ecosystem matches our expected import conventions).
- Alternative fontsource-style packages (e.g., `nerd-fonts`, `jetbrains-mono-nf`) — evaluate if the primary isn't published.
- **Fallback**: Manual drop-in. Download `JetBrainsMonoNerdFont-{Regular,Bold,Italic}.woff2` from the Nerd Fonts GitHub release (OFL 1.1 licensed, OK to vendor), place in `app/frontend/public/fonts/`, author `@font-face` declarations in `globals.css` pointing at `/fonts/*.woff2`.

The fallback path is viable if no npm package is current/trustworthy. The decision SHOULD be made during apply based on actual npm registry state, not assumed now.

### 2. `@font-face` declarations

Three `@font-face` rules (Regular, Bold, Italic) for JetBrainsMono Nerd Font, exposing a single `font-family: "JetBrainsMono Nerd Font"` with:
- `font-weight: 400; font-style: normal;` → Regular
- `font-weight: 700; font-style: normal;` → Bold
- `font-weight: 400; font-style: italic;` → Italic
- `font-display: block;` — block the initial paint until the font loads (xterm measures cells on `open()`; we must not render with fallback metrics).

Implementation location:
- If fontsource package: import from the package in `globals.css` (or `main.tsx`) using the package's documented sub-path imports.
- If manual: author the three `@font-face` rules directly in `globals.css`, referencing `/fonts/*.woff2`.

### 3. xterm `fontFamily` update

Change [terminal-client.tsx:131-132](app/frontend/src/components/terminal-client.tsx#L131-L132) from the current long fallback stack to:

```ts
fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace',
```

`ui-monospace` + generic `monospace` as final fallbacks guard against total font-load failure (e.g., corporate proxy blocking the woff2). The intermediate `JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas` entries become redundant once the webfont is bundled.

### 4. Font-load timing (critical)

xterm.js measures the character cell dimensions at `terminal.open()` time. If the webfont hasn't loaded yet, the measurement uses fallback metrics and is not re-taken when the font arrives. This produces misaligned terminal output until a resize event triggers a re-fit.

The init flow in [terminal-client.tsx:119-142](app/frontend/src/components/terminal-client.tsx#L119-L142) needs an `await document.fonts.load(...)` call before `terminal.open()` + `fitAddon.fit()`:

```ts
async function init() {
  if (!terminalRef.current) return;
  const { Terminal } = await import("@xterm/xterm");
  const { FitAddon } = await import("@xterm/addon-fit");
  if (cancelled || !terminalRef.current) return;

  const isMobile = !window.matchMedia("(min-width: 640px)").matches;
  const fontSize = isMobile ? 11 : 13;

  // Ensure webfont is loaded before xterm measures cell dimensions.
  // Load the three faces we actually use: Regular, Bold, Italic.
  await Promise.all([
    document.fonts.load(`${fontSize}px "JetBrainsMono Nerd Font"`),
    document.fonts.load(`bold ${fontSize}px "JetBrainsMono Nerd Font"`),
    document.fonts.load(`italic ${fontSize}px "JetBrainsMono Nerd Font"`),
  ]);
  if (cancelled || !terminalRef.current) return;

  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace',
    fontSize,
    theme: deriveXtermTheme(activeTheme.palette),
  });
  // ... rest unchanged
}
```

The `await` must be followed by a fresh `cancelled` check, per the existing pattern in this effect. Font loads in all major browsers complete in <50ms when cached and a few hundred ms on first paint.

### 5. Font-size touch point

[terminal-client.tsx:272](app/frontend/src/components/terminal-client.tsx#L272) (`LINE_HEIGHT` derivation in the touch-scroll effect) already reads from `xtermRef.current?.options.fontSize` — no change needed.

### 6. Build verification

- `just build-frontend` — verify Vite includes the font file(s) in the output bundle and path references resolve.
- `just test-e2e` — verify the golden-path terminal rendering test still passes.
- Manual Playwright check at desktop (1024×768, 13px) and mobile (375×812, 11px) viewports — confirm no visible baseline wobble in a rendered prompt.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — Add a short subsection under "Terminal Font Scaling" (currently at §Terminal Font Scaling) documenting that JetBrainsMono Nerd Font is bundled as a webfont, loaded before `terminal.open()` via `document.fonts.load(...)`, and that the primary `font-family` is `"JetBrainsMono Nerd Font"` with `ui-monospace, monospace` as fallbacks. Codifies the pattern so future UI work (e.g., monospace code blocks elsewhere in the app) can reuse the same font rather than re-introducing a system-font stack.

## Impact

**Files touched**:
- `app/frontend/package.json` — add dependency
- `app/frontend/src/globals.css` — either `@import` the fontsource package or author three `@font-face` rules (and possibly add a font preload `<link>` in `index.html` for LCP)
- `app/frontend/src/components/terminal-client.tsx` — update `fontFamily` string, add `document.fonts.load(...)` await before `terminal.open()`
- `app/frontend/index.html` (optional) — `<link rel="preload" as="font" type="font/woff2" href="...">` for fastest first-paint

**Secondary artifacts**:
- `pnpm-lock.yaml` — updated by `pnpm add`
- `app/frontend/public/fonts/*.woff2` — only if manual-drop-in path is taken

**Bundle size**: +1 to +4 MB static assets (3 weights of a full Nerd Font). Served as separate `.woff2` files cacheable by browsers indefinitely. Not loaded into the JS bundle.

**Dependencies**:
- `@fontsource/*` (if used) — MIT/OFL licensed. No runtime JS, just CSS + font files.

**Risks**:
- **First-paint latency**: `font-display: block` + `await document.fonts.load(...)` gates terminal rendering until the font arrives. On slow connections, this shifts first-paint of the terminal by the font-download time. Mitigable via `<link rel="preload">` in `index.html`.
- **Existing tests**: Unit tests that snapshot xterm dimensions or font-related values may need updates. [terminal-client.test.tsx] and related should be re-run.
- **Playwright visual tests**: If any e2e tests assert pixel dimensions that depend on the current font, they'll need re-baselining.

**Non-risks**:
- No backend change.
- No change to WebSocket/SSE wire format.
- No change to tmux / session handling.
- No new config surface.

## Open Questions

- Is there a canonical `@fontsource/*` npm package for JetBrainsMono **Nerd Font** (not just vanilla JetBrains Mono)? If not, manual drop-in is fine, but it affects the implementation shape. Apply-time verification only — does not block spec.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Font package: patched single-file JetBrainsMono Nerd Font (not split JetBrains Mono + Symbols Nerd Font Mono) | Discussed — user explicitly chose option 1 over option 2 in `/fab-discuss` | S:95 R:70 A:90 D:90 |
| 2 | Certain | Weights: Regular + Bold + Italic (all three) | Discussed — user explicitly answered "All 3" | S:95 R:80 A:90 D:95 |
| 3 | Certain | Source: npm package (fontsource-style) preferred; manual drop-in only if no suitable package exists | Discussed — user explicitly answered "npm" | S:90 R:75 A:85 D:90 |
| 4 | Certain | Font loading MUST complete before `terminal.open()` and `fitAddon.fit()` via `await document.fonts.load(...)` for all three weights | xterm measures cell grid at open; known technical constraint documented during discussion | S:90 R:70 A:90 D:95 |
| 5 | Confident | Primary `fontFamily` becomes `"JetBrainsMono Nerd Font", ui-monospace, monospace` — the current long system-font fallback stack becomes redundant | Once font is bundled, fallbacks to specific system fonts add complexity without value; `ui-monospace` + generic `monospace` covers total-load-failure | S:75 R:70 A:80 D:70 |
| 6 | Confident | Change type is `chore` (frontend dep + rendering change, no user-visible behavior change beyond consistent font) | Discussed — user-visible output stays identical where the font was previously available; this is a consistency/infra improvement | S:80 R:85 A:80 D:75 |
| 7 | Confident | `font-display: block` over `swap` — xterm cell measurement happens once at `open()`, so `swap` would cause a FOUT that persists as misalignment | Tied to the font-load timing requirement (#4); `block` ensures the fallback is never rendered | S:75 R:65 A:85 D:70 |
| 8 | Confident | `app/frontend/src/components/terminal-client.tsx` init effect (lines 113–237) is the only required code change beyond CSS/deps; no other files render xterm | Grepped in discussion — the frontend has a single TerminalClient component | S:80 R:60 A:85 D:75 |
| 9 | Confident | Memory update to `run-kit/ui-patterns.md` is the right place to codify the webfont-loading convention | `ui-patterns.md` already documents `Terminal Font Scaling` adjacent content; new `run-kit/fonts.md` would be over-granular for a single-font project | S:75 R:85 A:80 D:75 |
| 10 | Confident | No other parts of the app (sidebar, command palette, session cards) need their `font-family` updated in this change | Scope was explicit in the user's input: terminal rendering only. App-wide monospace usage in Tailwind can be revisited as a follow-up. | S:80 R:85 A:80 D:80 |
| 11 | Certain | Bundle size of ~1–4 MB across three font weights is acceptable; no subsetting required at this stage | Clarified — user confirmed | S:95 R:75 A:65 D:60 |
| 12 | Certain | Add `<link rel="preload" as="font" type="font/woff2">` for Regular weight in `index.html` | Clarified — user confirmed | S:95 R:80 A:70 D:65 |
| 13 | Certain | `ui-monospace` first in the fallback list after the bundled webfont | Clarified — user confirmed | S:95 R:85 A:70 D:55 |
| 14 | Certain | Existing unit/e2e tests are assumed not to break; verify at apply-time via `just test` | Clarified — user confirmed | S:95 R:75 A:60 D:55 |

14 assumptions (8 certain, 6 confident, 0 tentative, 0 unresolved).
