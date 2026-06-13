# Intake: Terminal Font Size Control

**Change**: 260613-oo89-terminal-font-size-control
**Created**: 2026-06-13

## Origin

This change emerged from a `/fab-discuss` exploration of "zoom in / zoom out" in run-kit. The user identified two distinct zoomable zones — (1) the HTML/UI chrome and (2) the terminal — and asked how to handle them, noting that browser-native `Cmd +/-` currently zooms both uniformly.

> Lets discuss zoom in / zoom out in run-kit. there are two different zones we might want to zoom in / out. 1) Just HTML 2) Just terminal. By default Cmd+/- zooms in/out both 1 and 2. What are your thoughts on this?

Key decisions reached in the conversation:

- **Two independent concerns, not one "zoom system".** The HTML zone and terminal zone scale by fundamentally different mechanisms (CSS reflow vs. xterm `fontSize` + FitAddon refit that resizes the PTY). This change implements **only the terminal-zone half**. The HTML/UI-scale half is explicitly deferred.
- **Do NOT intercept `Cmd +/-`.** Browser-native uniform zoom remains the default. The terminal font control is a separate, in-app control — avoiding the well-known fragility of hijacking `Cmd +/-` (preventDefault, `Cmd 0` reset, numpad variants, users who want native zoom).
- **Control surface**: a combo button in the top-bar (`−` / value / `+` / reset) **and** command-palette commands (Increase / Decrease / Reset terminal font). The user explicitly confirmed palette commands ship in v1 — this honors Constitution Principle V (keyboard-first; the palette is the primary discovery mechanism).
- **Storage**: localStorage only. The user explicitly stated "saving the preference in localStorage is enough" — a tmux window-option (`@rk_font_size`) route was discussed and **rejected** for v1 (no cross-restart persistence requirement).
- **Scope**: global (one value for all terminals), not per-pane. Per-pane font sizing was discussed and deferred — it would need per-window storage with no clean home under the no-database constitution.
- **Reset semantics**: reset = "forget preference" → falls back to the device default (11px mobile / 13px desktop), clearing the stored key. The user explicitly confirmed this over "set to a fixed 13 everywhere".
- A codebase check confirmed run-kit's chrome is effectively **rem-based** (no explicit `:root` font-size; Tailwind utility classes are rem-derived), which makes the deferred UI-scale half low-risk later — recorded here as context, out of scope for this change.

## Why

**Problem.** Terminal font size is currently hardcoded by device class — `const fontPx = isMobile ? 11 : 13` in `terminal-client.tsx` (line ~200). There is no way for a user to make terminal text larger or smaller. Browser-native `Cmd +/-` scales the *entire* page (chrome + xterm canvas + iframe content) uniformly, so a user who only wants bigger terminal text also blows up the sidebar and top-bar, and the xterm canvas scales as a bitmap rather than re-fitting cleanly.

**Consequence if unfixed.** Readability is a daily pain point — terminal content is the primary content of the app, and users on varying displays / eyesight have no per-zone lever. The only workaround (browser zoom) is coarse and couples the two zones.

**Why this approach.** Setting xterm's `fontSize` option and calling `fitAddon.fit()` is the *correct* way to resize a terminal — it recomputes rows×cols and resizes the underlying PTY so tmux renders at the right grid, instead of bitmap-scaling a canvas. Routing this through `ChromeContext` + localStorage reuses the exact pattern already proven for `fixedWidth`, `sidebarOpen`, and `sidebarWidth`. Not intercepting `Cmd +/-` sidesteps a class of brittle keyboard-hijacking bugs and keeps native zoom available for users who want whole-page scaling.

## What Changes

### 1. ChromeContext — new persisted `terminalFontSize` state

Add terminal font size to the chrome context, mirroring the existing `fixedWidth` pattern (split state/dispatch contexts, a `*_STORAGE_KEY` const, a `readX()` initializer, and a localStorage write on change).

**Storage key**: `runkit-terminal-font-size` (mirrors `runkit-fixed-width` naming).

**Bounds + defaults** — export a bounds object alongside the existing `SIDEBAR_WIDTH_BOUNDS`:

```ts
const TERMINAL_FONT_STORAGE_KEY = "runkit-terminal-font-size";

const TERMINAL_FONT_MIN = 8;
const TERMINAL_FONT_MAX = 24;
const TERMINAL_FONT_STEP = 1;
// Device defaults (today's hardcoded values), used when no preference is stored:
const TERMINAL_FONT_DEFAULT_MOBILE = 11;
const TERMINAL_FONT_DEFAULT_DESKTOP = 13;

export const TERMINAL_FONT_BOUNDS = {
  min: TERMINAL_FONT_MIN,
  max: TERMINAL_FONT_MAX,
  step: TERMINAL_FONT_STEP,
} as const;

function clampTerminalFont(px: number): number {
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, px));
}

/** Device default when no explicit preference is stored. Reuses the same
 * mobile rule as the rest of the chrome (narrow width OR coarse pointer). */
function deviceDefaultFontSize(): number {
  return isMobileViewport() ? TERMINAL_FONT_DEFAULT_MOBILE : TERMINAL_FONT_DEFAULT_DESKTOP;
}

/** Stored preference (clamped) if present; otherwise null = "no preference,
 * use device default". A null/absent key is the unset state that `reset`
 * returns to. */
function readTerminalFontSize(): number | null {
  try {
    const stored = localStorage.getItem(TERMINAL_FONT_STORAGE_KEY);
    if (stored === null) return null;
    const parsed = Number(stored);
    if (!isNaN(parsed)) return clampTerminalFont(parsed);
  } catch { /* noop */ }
  return null;
}
```

**State shape**: store the *preference* (`number | null`) internally so "unset" is distinguishable from "happens to equal the default". Expose the **effective** size (preference ?? device default) to consumers so the terminal and the button always have a concrete number.

Add to `ChromeState`:
- `terminalFontSize: number` — the **effective** size (preference if set, else device default). This is what `TerminalClient` reads and what the combo button displays.

Add to `ChromeDispatch`:
- `increaseTerminalFont: () => void` — `effective + step`, clamped, persisted.
- `decreaseTerminalFont: () => void` — `effective − step`, clamped, persisted.
- `resetTerminalFont: () => void` — clears the stored key and returns to device default (the "forget preference" semantic).

Each mutator follows the `toggleFixedWidth` shape: compute next from previous, write to localStorage in a `try/catch { /* noop */ }`, and update React state. `reset` calls `localStorage.removeItem(TERMINAL_FONT_STORAGE_KEY)`.

> **Edge case — increment/decrement from the unset state**: when the preference is `null`, the first `increase`/`decrease` operates on the *device default* (e.g., desktop 13 → 14), and that result becomes the stored preference. So the very first step always produces a concrete stored value adjacent to the device default.

### 2. TerminalClient — read effective font size from context

Replace the local device-based computation:

```ts
// BEFORE (terminal-client.tsx ~line 200):
const isMobile = !window.matchMedia("(min-width: 640px)").matches;
const fontPx = isMobile ? 11 : 13;
```

with the effective size from `ChromeContext` (`terminalFontSize`). On creation, pass it as `fontSize` in the xterm options. On **change** (the user steps the size or resets), an effect MUST:

1. Set `term.options.fontSize = terminalFontSize`
2. Call `fitAddonRef.current?.fit()` to recompute rows×cols (this resizes the PTY)

**Scope behavior — all live terminals react.** On the board route (`/board/$name`) there can be N mounted `TerminalClient` instances. Because the value lives in `ChromeContext`, **every** mounted terminal re-runs the font-apply effect when the value changes. This is intended: the setting is global. A side effect is that bumping the font visibly reflows any running full-screen TUI in a pane (its PTY resizes). This is correct/expected behavior, not a bug.

> The mobile font-size CSS media query in `globals.css` (terminal font 11px under `min-width: 640px`) interacts with this — the device-default branch must stay consistent with that query. The xterm `fontSize` option is the authoritative value at runtime; the CSS rule is the cosmetic baseline. Keep the JS device default (11/13) aligned with the existing 640px breakpoint.

### 3. Top-bar — combo button (`−` / value / `+` / reset)

Add a compact combo control to `top-bar.tsx`, placed near the existing `FixedWidthToggle` (lines ~513–558). Layout: a small inline group showing `[−] {size}px [+]` with a reset affordance (a small "reset" / circular-arrow button, or clicking the value label resets — pick the pattern consistent with the existing toggle's styling).

- `−` button → `decreaseTerminalFont()`, disabled at `TERMINAL_FONT_MIN`.
- `+` button → `increaseTerminalFont()`, disabled at `TERMINAL_FONT_MAX`.
- value label → shows effective `terminalFontSize` (e.g., `13`).
- reset → `resetTerminalFont()`.
- Touch targets follow the established mobile sizing (`coarse:36px` square for top-bar buttons, per `context.md` § Mobile Responsive Design).
- Each interactive element needs an `aria-label` (`Decrease terminal font`, `Increase terminal font`, `Reset terminal font`).

### 4. Command palette — three new actions

The palette consumes a flat `PaletteAction[]` (`{ id, label, shortcut?, onSelect }`) assembled by the parent and passed as the `actions` prop (see `command-palette.tsx`). Add three actions wherever that array is built (the component rendering `<CommandPalette actions={...} />` — `app.tsx`):

- `{ id: "terminal-font-increase", label: "Increase terminal font", onSelect: increaseTerminalFont }`
- `{ id: "terminal-font-decrease", label: "Decrease terminal font", onSelect: decreaseTerminalFont }`
- `{ id: "terminal-font-reset", label: "Reset terminal font", onSelect: resetTerminalFont }`

No new global keybinding is registered (we are deliberately NOT intercepting `Cmd +/-`); the `shortcut` field stays unset.

### Out of scope (explicitly deferred)

- **UI/HTML-zone scaling** — the second zone from the discussion. Lever would be `:root { font-size }` (chrome is rem-based). Not in this change.
- **`Cmd +/-` interception** — browser-native zoom is retained as-is.
- **Per-pane / per-window font size** — global only for v1.
- **Cross-restart persistence via tmux `@rk_font_size`** — localStorage only for v1.
- **Iframe windows** are unaffected by this control (separate document; the child app owns its own zoom).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the terminal font-size control — ChromeContext-backed global preference (localStorage `runkit-terminal-font-size`), effective-size = preference ?? device default (11/13), bounds 8–24px step 1, reset = forget preference; surfaced via top-bar combo button and three command-palette actions; applied to xterm via `options.fontSize` + `fitAddon.fit()` (reflows the PTY for every live terminal). Note the deliberate non-interception of `Cmd +/-`.

## Impact

**Frontend only — no backend changes.**

- `app/frontend/src/contexts/chrome-context.tsx` — new state (`terminalFontSize`), three mutators, storage key, bounds export, `readTerminalFontSize`/`deviceDefaultFontSize`/`clampTerminalFont` helpers. Reuses the existing `isMobileViewport()` helper.
- `app/frontend/src/components/terminal-client.tsx` — read effective size from context; apply on create and on change via `options.fontSize` + `fitAddon.fit()`. Touches the touch-scroll `LINE_HEIGHT` fallback (line ~420) which already reads `options.fontSize` — verify it still resolves correctly.
- `app/frontend/src/components/top-bar.tsx` — new combo button near `FixedWidthToggle`.
- `app/frontend/src/app.tsx` (or wherever `<CommandPalette actions={...} />` is built) — three new `PaletteAction`s.

**Tests** (per Constitution Test Integrity + code-quality "new features MUST include tests"):
- Unit: `chrome-context.test.tsx`-style coverage for read/clamp/increase/decrease/reset and the unset→first-step behavior; component test for the top-bar combo button (disabled at bounds, reset behavior). Palette action wiring covered by a `command-palette`-adjacent test.
- E2E (SHOULD, per code-quality): a Playwright spec exercising the top-bar control changing terminal font and a palette command doing the same — **with a sibling `.spec.md`** per Constitution § Test Companion Docs.

**Dependencies**: none new. Uses existing xterm `FitAddon` already wired in `terminal-client.tsx`.

## Open Questions

None — all design decisions were resolved during the `/fab-discuss` conversation (storage, scope, bounds, step, reset semantics, control surfaces, no key interception).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement only the terminal-zone half; defer HTML/UI-scale, `Cmd +/-` interception, per-pane, and tmux-option persistence | User explicitly scoped each of these in the discussion (localStorage "is enough", combo button + palette, reset = forget); recorded as decisions, not guesses | S:95 R:85 A:90 D:95 |
| 2 | Certain | Store via localStorage key `runkit-terminal-font-size`, global, through ChromeContext | User said "localStorage is enough"; ChromeContext + `runkit-*` key is the established pattern (`fixedWidth`, `sidebar*`) read directly from the code | S:90 R:80 A:95 D:90 |
| 3 | Certain | Reset = forget preference → device default (11 mobile / 13 desktop) | User explicitly confirmed "reset = forget preference" over a fixed 13; device defaults are today's hardcoded values | S:95 R:80 A:95 D:95 |
| 4 | Confident | Bounds 8–24px, step ±1px | Proposed and not contested; readable floor/ceiling, ±1 avoids jumpiness at small sizes; easily tunable later via the exported bounds const | S:70 R:90 A:75 D:80 |
| 5 | Confident | Apply via `term.options.fontSize = N; fitAddon.fit()` on create and on change, for every live terminal | The only correct xterm resize path (recomputes rows×cols, resizes PTY); FitAddon already wired; global value means all mounted terminals react | S:75 R:75 A:90 D:85 |
| 6 | Confident | Combo button placed in top-bar near `FixedWidthToggle`; three palette actions added where `<CommandPalette actions>` is built | Mirrors where `FixedWidthToggle` lives and how palette actions are assembled (flat prop array), both confirmed in code | S:75 R:85 A:85 D:80 |
| 7 | Confident | Internal state stores preference as `number \| null` (null = unset); exposes effective = preference ?? device default | "Forget preference" REQUIRES distinguishing unset from "equals default" — `null`-sentinel is the one faithful representation (the `isDefault`-flag alternative encodes the same bit more clumsily), so there is one obvious front-runner once the reset semantic is fixed | S:75 R:80 A:85 D:80 |
| 8 | Confident | Reset affordance is a dedicated icon/button within the combo control | The combo is `[−] {size} [+]` plus reset; a dedicated control is the conventional shape and matches the explicit "+,-,reset" the user described — exact glyph/styling is a trivial apply-time detail bounded by the existing toggle styling, not a competing interpretation | S:80 R:90 A:75 D:75 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
