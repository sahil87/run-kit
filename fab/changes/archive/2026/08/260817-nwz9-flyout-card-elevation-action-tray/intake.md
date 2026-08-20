# Intake: Flyout Card Elevation + Action Tray

**Change**: 260817-nwz9-flyout-card-elevation-action-tray
**Created**: 2026-08-17

## Origin

Conversational. The user posted a screenshot of the window row-flyout card open over the terminal, with the card outlined in red, and wrote:

> This image depicts the window hover info, i have highlighted with red color, but below the window hover info panel, the text is also the same theme/color etc. so it's not readable and also couple of option: Change color etc. are clickable and hard to know, how do you suggest we can improve this, get back to me with a few options with the exact design (take from code)

A code audit produced three cumulative options (A elevate, B contrast split, C tray + hover rail), each rendered as a live mockup built from the shipped classes and measured against the real tokens. The user reviewed them and replied:

> Option C — A + B + inset tray and green hover trail. Just for kill window, i want red hover trail

then:

> implement option C, we are clear with planning

So the design is settled: **Option C in full, with the hover rail split two ways — `accent-green` for the three safe actions, `signal-red` for Kill.** The red-for-Kill split is the user's own amendment to the proposed green-only rail, not an inference.

A prior interrupted `/fab-new` created `260817-r65p-row-popup-elevation-contrast` covering the narrower A+B scope with no `intake.md`; at the user's direction it was archived (`fab change archive`, recoverable via `fab change restore`) and this change supersedes it.

## Why

**The problem.** `row-flyout-card.tsx:1011` paints the card on `bg-bg-primary`. The xterm terminal surface behind it is *also* `bg-primary` (`globals.css:349`). They are the same hex, so nothing separates the card from the content it covers except:

- a 1px `--color-border` edge measuring **2.25:1 in dark and 1.40:1 in light** — both under the 3:1 WCAG 1.4.11 non-text bar; and
- Tailwind's stock `shadow-lg`, which is `rgb(0 0 0 / 0.1)`. Black at 10% over a near-black ground is invisible.

That is exactly what the screenshot shows: the card's right edge dissolves into the terminal text running underneath it.

**Why lightness alone cannot fix it.** Swapping to the elevated token is necessary but not sufficient — `bg-bg-card` against `bg-bg-primary` measures **1.10:1 in dark and 1.05:1 in light**. In a dark theme, surface *lightness* has no room to do the separating. The separation has to come from **occlusion** (a shadow the card casts on the terminal), not from brightness. The token swap matters for a different reason: it makes the card agree with `tip.tsx:168`, where the smaller tier-1 tooltip already sits on `bg-bg-card` — today the bigger, heavier surface is the *less* elevated of the two.

**The second, independent defect.** `ACTION_ROW_CLASS` (line 402) sets the four action rows to `text-text-secondary` — the identical color as the read-only `out` / `agt` register lines directly above them. A 13px icon is the entire rest-state difference between a fact and a button. The hover feedback barely rescues it either: `hover:bg-bg-inset` on a `bg-primary` card is a **1.04:1** step, so even hovering gives almost no confirmation. And `ACTION_ROW_HINT_CLASS` (line 409) stacks `opacity-60` on top of an already-secondary color, putting "not pinned", "confirms first" and "new window, same directory" at **2.52:1 dark / 2.27:1 light** against a 4.5:1 requirement.

**Consequence of not fixing.** On coarse pointers this card is the *only* home for Change color, Pin and Kill (the in-row hover cluster is fine-pointer-only), so an operator on touch cannot tell which lines of the single most action-dense surface in the app are actionable. Kill window is one of them.

**Why Option C over A or B alone.** A fixes only the bleed. B fixes only the affordance. C is the union plus a structural cue: giving the action list its own inset ground turns the card into three legible zones — identity (inset band, already shipped), facts (card ground), actions (inset tray) — so the split reads without hovering anything. The two-color rail then encodes the one distinction that matters most inside the tray: three reversible actions versus one that kills a window.

## What Changes

### 1. Card shell — elevate (`row-flyout-card.tsx:1011`)

```diff
- z-50 flex flex-col gap-1 bg-bg-primary border border-border rounded-md shadow-lg px-2 py-1.5 text-xs font-mono w-max
+ z-50 flex flex-col gap-1 bg-bg-card    border border-border rounded-md rk-popup-elev px-2 py-1.5 text-xs font-mono w-max
```

Everything else on the line is untouched, including the `coarse ? "" : " max-w-xs"` suffix and the `rk-flyout-in` cold-open class.

### 2. New elevation utility (`globals.css`, beside the other `rk-*` rules)

Two theme-scoped custom properties plus one class. A single stock shadow value cannot serve both themes — 70% black is right on a near-black ground and far too heavy on a white one.

```css
:root {
  --rk-popup-shadow-a: rgb(0 0 0 / .70);
  --rk-popup-shadow-b: rgb(0 0 0 / .55);
}
html[data-theme="light"] {
  --rk-popup-shadow-a: rgb(15 17 23 / .20);
  --rk-popup-shadow-b: rgb(15 17 23 / .12);
}
.rk-popup-elev {
  box-shadow:
    0 12px 28px -8px var(--rk-popup-shadow-a),
    0 4px 10px -4px var(--rk-popup-shadow-b);
}
```

These are shadow *alphas*, not color tokens — they do not enter `UIColors` and are not re-derived per terminal theme. The `rk-*`-utility-class-in-`globals.css` idiom is the project convention (`fab/project/context.md`); `visual-design.md` already records one custom shadow precedent (the swatch grid's hard offset block shadow, explicitly "not `shadow-lg`").

### 3. Notch fill must follow the card (`popup-title-bar.tsx:29`)

`notchFill` returns the card-surface fill for any arrow landing below the title band. Left unchanged, the `FloatingArrow` would keep painting `bg-primary` and read as a hole punched in the newly-lifted card.

```diff
  return arrowY != null && arrowY < POPUP_TITLE_BAR_HEIGHT_PX
    ? "var(--color-bg-inset)"
-   : "var(--color-bg-primary)";
+   : "var(--color-bg-card)";
```

### 4. Action rows — labels lead, hints clear AA (`row-flyout-card.tsx:402`, `:409`)

The card's new rule: **secondary text is something to read, primary text is something to press.**

```diff
  const ACTION_ROW_CLASS =
    "flex w-full items-center gap-1.5 min-w-0 px-2 text-left whitespace-nowrap min-h-[28px] coarse:min-h-[36px]
-   text-text-secondary hover:bg-bg-inset
+   text-text-primary hover:bg-[color-mix(in_srgb,var(--color-text-primary)_8%,transparent)]
+   border-l-2 border-l-transparent pl-1.5
    focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";
```

```diff
- const ACTION_ROW_HINT_CLASS = "ml-auto min-w-0 truncate pl-2 text-text-secondary opacity-60";
+ const ACTION_ROW_HINT_CLASS = "ml-auto min-w-0 truncate pl-2 text-text-secondary";
```

Dropping `opacity-60` takes the hints from 2.52:1 → **4.51:1 (dark)** and 2.27:1 → **4.83:1 (light)** on the card ground. The hover fill changes because `bg-bg-inset` on a `bg-bg-card` card is only a 1.13:1 step; the neutral 8% primary lift gives a visible fill in both themes without claiming a semantic hue. The rail *geometry* (`border-l-2 border-l-transparent pl-1.5`) lives here, colorless — `pl-1.5` (6px) plus the 2px border restores the original 8px inset so labels do not shift.

### 5. Action list — its own inset tray (`row-flyout-card.tsx:417`, `CardActionList`)

```diff
- "-mx-2 mt-0.5 border-t border-border divide-y divide-border"
+ "-mx-2 -mb-1.5 mt-1 rounded-b-[5px] bg-bg-inset border-t border-border divide-y divide-border"
```

`-mb-1.5` cancels the card's bottom padding so the tray reaches the card edge; `rounded-b-[5px]` matches the title bar's `rounded-t-[5px]` (1px inside the card's 6px radius) so the two bands bookend the card symmetrically.

### 6. Hover rail — two colors, riding the existing danger ternary (`row-flyout-card.tsx:452`)

`CardActionRow` already branches on `danger` to choose the hover text color. The rail color rides that same ternary — no new prop, no new branch:

```diff
- className={`${ACTION_ROW_CLASS} ${danger ? "hover:text-signal-red" : "hover:text-text-primary"}`}
+ className={`${ACTION_ROW_CLASS} ${danger
+   ? "hover:text-signal-red hover:border-l-signal-red"
+   : "hover:text-text-primary hover:border-l-accent-green"}`}
```

Green is the house vocabulary for "interactive" — `globals.css` states it explicitly for the tile gap-seam sash ("green already means interactive/live-pane in the hover vocabulary"). Red is already this row's hover text color, so the rail states the same thing the label states.

**Colour is not the only cue.** `signal-red` and `accent-green` measure 6.23:1 and 7.56:1 on `bg-bg-card`, so they differ in lightness as well as hue, and the row independently brightens and takes the hover fill.

### 7. `ForkActionRow` bypasses the ternary and must be patched directly (`row-flyout-card.tsx:499`)

This is the trap. `ForkActionRow` builds its own `className` instead of going through `CardActionRow`, so it never sees the ternary in §6 and would silently ship with no rail:

```diff
  className={`${ACTION_ROW_CLASS} hover:text-text-primary
+   hover:border-l-accent-green disabled:hover:border-l-transparent
    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary`}
```

`disabled:hover:border-l-transparent` keeps a fork already in flight from lighting up as though it were still clickable, matching the existing `disabled:hover:text-text-secondary` intent.

### 8. `identity-tip.tsx:135` — elevation only

The identity tip carries the identical broken shell (`bg-bg-primary … rounded-md shadow-lg px-2 py-1.5 text-xs font-mono w-max max-w-xs` + `pointer-events-none`). Apply §1 to it — `bg-bg-primary` → `bg-bg-card`, `shadow-lg` → `rk-popup-elev`. It has no action rows, so §§4–7 do not apply. Fixing one sibling popup and not the other would leave two visibly different elevations on the same sidebar.

### 9. What the session and server tiers get for free

`CardActionList`, `CardActionRow` and `ACTION_ROW_CLASS` are shared by all three card tiers (window / session / server) on one shell. The tray, the label promotion, the hint fix and the rail therefore land on the session card (`Change color…` / `Spawn agent…` / `New window` / `Kill session`) and the server card (`Change color…` / `New session` / `Kill server`) with no per-tier edits. `Kill session` and `Kill server` already pass `danger`, so they pick up the red rail automatically — which is the intended behavior, not a side effect.

### 10. Tests

- **`row-flyout-card.test.tsx:211–214`** — four `notchFill` assertions currently expect `"var(--color-bg-primary)"`; all four flip to `"var(--color-bg-card)"`. (Lines 209–210, the `bg-inset` title-band cases, are unaffected.)
- **New unit coverage**: the card shell carries `bg-bg-card` + `rk-popup-elev` and no longer `bg-bg-primary`/`shadow-lg`; `CardActionList` carries `bg-bg-inset`; a non-danger row carries `hover:border-l-accent-green` and a `danger` row carries `hover:border-l-signal-red`; the fork row carries the green rail plus the disabled reset; the hint class no longer carries `opacity-60`.
- **`row-flyout-card.test.tsx:178`** asserts `text-text-secondary` inside the *title bar*, not an action row — unaffected.
- **e2e**: `tests/e2e/row-flyout.spec.ts` and `tests/e2e/row-identity-tips.spec.ts` may need touch-ups. Per the Constitution's Test Companion Docs rule, any `.spec.ts` edit **MUST** update its sibling `.spec.md` in the same commit; both companions exist.

### Non-goals

- Frosted glass / `backdrop-blur` on the card. It was evaluated and rejected for now: `backdrop-filter` promotes a compositing layer over the xterm WebGL canvas, and this card mounts and unmounts on every row sweep with instant warm retargeting inside a 500ms window. Worth prototyping and profiling separately, not shipping blind.
- Moving the actions out to the command palette. The card is deliberately the only home for these actions on coarse pointers.
- Raising `--color-text-secondary` in light theme (see Assumption 9).
- Any change to placement, triggers, delays, the scrub registry, the warm window, or the render-performance contract.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card. Line 151's claim "Surface tokens are the shared ones (`bg-bg-primary border border-border rounded-md shadow-lg`, monospace, `w-max`) — no new color tokens" becomes false and must be rewritten for `bg-bg-card` + `rk-popup-elev`. Line 165's notch-fill description ("the card-surface fill below it") needs the new fill named. Line 169's action-row anatomy needs the inset tray, the primary-label rule, the un-dimmed hints and the two-color rail. Line 185's Tests paragraph needs the new assertions. The Two-Tier Taxonomy note should record that both tiers now share one elevation.
- `run-kit/ui/visual-design`: (modify) Add the `.rk-popup-elev` utility and the two `--rk-popup-shadow-*` alphas to the elevation/shadow vocabulary (beside the existing swatch-grid block-shadow precedent), and record the action-row hover rail in the hover-animation vocabulary — noting it is a static two-color state, not an animated treatment, so `prefers-reduced-motion` does not gate it.
- `run-kit/ui/sidebar`: (modify) The identity-tip descriptions at lines 13 and 19 reference the slim hover-card shell; note the shared elevation change.

## Impact

**Code** (5 files):

| File | Change |
|---|---|
| `app/frontend/src/components/sidebar/row-flyout-card.tsx` | Lines 402, 409, 417, 452, 499, 1011 — six edit sites |
| `app/frontend/src/components/sidebar/popup-title-bar.tsx` | Line 29 — `notchFill` fallback |
| `app/frontend/src/components/sidebar/identity-tip.tsx` | Line 135 — shell tokens |
| `app/frontend/src/globals.css` | New `.rk-popup-elev` + two theme-scoped shadow alphas |
| `app/frontend/src/components/sidebar/row-flyout-card.test.tsx` | Lines 211–214 flip; new assertions |

**Surfaces**: window flyout card (fine + coarse), session card (coarse), server card (coarse), session identity tip (fine), server-tile identity tip (fine). Both themes.

**No change to**: any Go backend code, the API surface, routes, data flow, floating-ui configuration, or component props/signatures. No new colour tokens; no `UIColors`/`themes.ts` changes.

**Verification** (per `fab/project/code-quality.md`): `just test-frontend`, `npx tsc --noEmit`, `just test-e2e`, `just build`. Note the recorded environment quirk — `just test-frontend` and `just setup` fail with `ERR_PNPM_IGNORED_BUILDS` under pnpm 11 unless prefixed with `PNPM_CONFIG_STRICT_DEP_BUILDS=false`. Visual verification should follow the project's Playwright-driven workflow (`RK_PORT=3020 just dev`, then check the card at 375px and 1024px+ in both themes).

## Open Questions

None. Every decision point was settled in the originating conversation or is determined by measured token values and existing codebase convention; see the Assumptions table.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement Option C in full (elevation + contrast split + inset tray + hover rail), not A or B alone | User reviewed three rendered options against the real tokens and named C explicitly | S:95 R:70 A:90 D:95 |
| 2 | Certain | Hover rail is `signal-red` for Kill and `accent-green` for the three safe actions | User's explicit amendment to the proposed green-only rail: "Just for kill window, i want red hover trail" | S:95 R:90 A:85 D:95 |
| 3 | Certain | Separation comes from an occlusion shadow, not surface lightness | Measured: `bg-card` vs `bg-primary` is 1.10:1 dark / 1.05:1 light — lightness has no room to work in either theme | S:70 R:85 A:90 D:80 |
| 4 | Confident | Shadow ships as a `.rk-popup-elev` class + two theme-scoped custom properties in `globals.css`, not an inline arbitrary value | `rk-*` utility classes in `globals.css` is the documented project convention; a single alpha cannot serve both themes | S:60 R:85 A:85 D:75 |
| 5 | Confident | Hover fill becomes a neutral 8% `text-primary` lift, replacing `hover:bg-bg-inset` | `bg-inset` on a `bg-card` card is a 1.13:1 step — effectively invisible; the neutral lift works in both themes without claiming a semantic hue | S:55 R:90 A:80 D:70 |
| 6 | Certain | `ForkActionRow` gets the green rail written directly, plus `disabled:hover:border-l-transparent` | Verified at line 499: it builds its own className and never sees the `danger` ternary, so it would otherwise ship with no rail | S:85 R:85 A:95 D:90 |
| 7 | Certain | `notchFill`'s fallback moves to `var(--color-bg-card)` and its four unit assertions flip | Verified at `popup-title-bar.tsx:29` and `row-flyout-card.test.tsx:211–214`; an unchanged notch would read as a hole in the lifted card | S:85 R:90 A:95 D:95 |
| 8 | Confident | `identity-tip.tsx` receives the elevation half only, not the tray or rail | It carries the identical broken shell but has no action rows; fixing one sibling popup and not the other leaves visibly different elevations | S:50 R:85 A:80 D:75 |
| 9 | Confident | Accept light-theme tray hints at 4.02:1, under the 4.5:1 AA bar | `text-text-secondary` on `bg-bg-inset` is already shipped by `PopupTitleBar` in light, so this sets no new precedent; it is still a large improvement on today's 2.27:1, and raising the token repo-wide is a separate change | S:45 R:90 A:75 D:70 |
| 10 | Certain | Session and server card tiers inherit every change with no per-tier edits | `CardActionList` / `CardActionRow` / `ACTION_ROW_CLASS` are one shared shell across all three tiers | S:80 R:75 A:95 D:90 |
| 11 | Certain | `Kill session` and `Kill server` also take the red rail | They already pass `danger`, so the §6 ternary covers them; consistent destructive signalling across tiers is the intent | S:75 R:85 A:90 D:90 |
| 12 | Certain | Any `.spec.ts` edit updates its sibling `.spec.md` in the same commit | Constitution § Test Companion Docs makes this mandatory; both companions exist | S:70 R:80 A:100 D:95 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
