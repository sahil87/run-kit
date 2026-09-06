# Intake: Control Tokens, Global Focus Ring & Hue-Free Glint

**Change**: 260905-drcc-control-tokens-focus-glint
**Created**: 2026-09-06

## Origin

> Control vocabulary retrofit — slice 1: control token module + two global rules. Extract control-state tokens (heights 28/40-coarse bar, 33x35/40 chip, radius, ring, durations, latch/press fills as color-mix) into a dedicated controls module + CSS custom properties (out of top-bar-overflow-menu.tsx); add one global :focus-visible green-ring rule; convert the rk-glint hover to a hue-free brightness sweep and delete its unlayered green color-override (scheme C: neutral interaction, green = state only); add user-select/-webkit-user-select/-webkit-touch-callout none to the shared control recipes. Decisions and evidence: docs/wiki/control-state-audit.html and control-contract-preview.html (settled 2026-09-05).

Conversational origin: a `/fab-discuss` session (2026-09-05) scoped a control-vocabulary retrofit (buttons/toggles/menus state layer; identity untouched), ran a four-agent audit of every interactive control (`docs/wiki/control-state-audit.html`), and settled a contract in two iterations of live previews (`docs/wiki/control-contract-preview.html`, `docs/wiki/control-hue-size-options.html`). The user explicitly decided: **hue scheme C (neutral + green)**, **40px coarse floor** (rejecting both today's 30/36 as "way too small" on their phone and full 44 HIG), and the **long-press select guard**. This change is the first migration slice from the audit's §9 plan; the user said "rebase to latest, then yes, begin".

## Why

1. **The pain**: the audit found the control state layer is ad-hoc per file — `active:` appears 3× in the whole frontend (touch taps are visually silent), there is **no focus rule in globals.css** (three competing ring idioms across 24 sites; 37 of 39 `outline-none` usages suppress focus with no replacement — a Principle V "keyboard-first" violation), and the unlayered `.rk-glint:hover:not(:disabled)` color override (globals.css:266) silently defeats every Tailwind `hover:` utility on glint controls, making ~12 call sites' declared hover colors dead code and **destroying latched accent states on hover** (a latched Ctrl chip flips green under the cursor). Coarse controls (30px top-bar, 36px chips) are below every platform recommendation and the user reports them too small on their phone. Long-pressing a chip on iOS selects the glyph / pops the callout.
2. **If unfixed**: every later surface migration (slices 3–7 of the audit's plan) has no tokens or global rules to consume — each would re-improvise states, which is exactly the drift being retired. The keyboard-focus invisibility and silent taps stay shipped.
3. **Why this approach**: global rules + a token module fix the two worst bug classes (invisible focus, hover-vs-latch instability) with near-zero call-site churn, and the same unlayered-CSS mechanism that caused the glint bug is used deliberately for the focus ring (an unlayered rule beats layered Tailwind utilities, so the 37 naked `outline-none` suppressions are overridden without touching them). Scheme C makes the glint fix a **deletion**: with hover carrying no hue, there is no override left to layer-manage.

## What Changes

### 1. Control token module — `app/frontend/src/components/controls.ts` (new)

Move the shared control className constants out of `top-bar-overflow-menu.tsx` (they live there today only to avoid an import cycle, per its own comment at :129-131) into a new dependency-free module `app/frontend/src/components/controls.ts`:

- `TOP_BAR_BUTTON_BASE`, `TOP_BAR_BUTTON_REST`, `TOP_BAR_BUTTON`, `TOP_BAR_BUTTON_H`, `TOP_BAR_SEGMENT_H` (from `top-bar-overflow-menu.tsx:106-112`)
- `MENU_ROW_BASE`, `MENU_ROW_REST`, `MENU_ROW_DISABLED`, `MENU_ROW_ACTIVE`, `MENU_ROW_CLASS`, `MENU_ROW_KBD_CLASS`, `POPOVER_ROW_CLASS` (from `:61-79, :138`)

Update all imports (consumers: `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `surface-layout.tsx`, `layout-chip.tsx`, `open-button.tsx`) — no re-export shim; the consumer set is five files. `KBD_CLASS` stays in its existing clean home `components/kbd-chip.ts` (values updated per §6). `ARROW_BTN` stays file-local in `arrow-pad.tsx` (values updated per §6).

### 2. Control CSS custom properties — `globals.css`

Add control-layer tokens to `:root` (theme-independent geometry; colors stay derived from existing `--color-*`):

```css
:root {
  --ctl-radius: 4px;            /* matches today's `rounded` */
  --ctl-duration: 150ms;        /* matches Tailwind transition default in use */
  --ctl-h-bar: 28px;            /* fine icon button */
  --ctl-h-bar-coarse: 40px;     /* settled coarse floor */
  --ctl-chip-h: 33px; --ctl-chip-w: 35px;          /* fine chip mins */
  --ctl-chip-coarse: 40px;                          /* coarse chip min (both axes) */
}
```

The TS constants keep their Tailwind literal classes (Tailwind's scanner cannot read the vars) with a lockstep comment on each pointing at the custom property — the same documented-lockstep convention already used by `COARSE_POINTER_QUERY` (`use-coarse-pointer.ts:16`) and `STATUS_RAIL_WIDTH_PX` (`row-flyout-card.tsx:82`). The custom properties exist for CSS-side consumers (the global rules below, and future slices).

### 3. Global focus-visible ring — `globals.css` (unlayered, deliberate)

```css
/* One focus ring for every control. Unlayered ON PURPOSE: it must beat the
   ~37 Tailwind `outline-none` utilities that currently suppress focus with no
   replacement (control-state-audit.html §1). Interactive text inputs keep
   their focus:border idiom and are excluded here. */
:where(button, [role="button"], [role="option"], [role="menuitem"],
       [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"],
       [role="switch"], a, summary):focus-visible {
  outline: 2px solid var(--color-accent-green);
  outline-offset: 2px;
}
```

- `input`, `textarea`, and `select` are **excluded** — text inputs keep the existing `focus:border-*` live-input idiom (unifying its three colors is a later slice).
- The unlayered rule also outranks the three existing per-site ring idioms (`outline-1`/`outline-2`, `accent`/`accent-green`), so focus becomes uniformly green immediately; removing those now-redundant utilities is deferred to their surface slices.
- Menus with roving focus (`tabIndex={-1}` rows) become keyboard-visible with no JS change — `:focus-visible` fires on `.focus()` from keyboard interaction.

### 4. Global pressed feedback — `globals.css` (same selector set)

```css
:where(button, [role="button"], [role="option"], [role="menuitem"],
       [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"],
       [role="switch"]):active:not(:disabled) {
  background-color: var(--color-bg-card);
  transition: none;
}
```

Touch's only feedback channel — generalizes `KBD_CLASS`'s existing `active:bg-bg-card` (the audit's one complete recipe) to every control. Rows with inline tint styles keep their tint (inline wins), which is acceptable: those rows already have hover/selected fills.

### 5. Long-press select guard — `globals.css`

Extend the existing "clickable elements should feel clickable" block (globals.css ~:90, which already enumerates `button, [role="button"], [role="option"], [role="menuitem"], a, …`) with:

```css
user-select: none;
-webkit-user-select: none;
-webkit-touch-callout: none;   /* iOS: no magnifier/callout on long-press */
```

Explicit user requirement: a long-press on any control must never select the glyph or pop the iOS callout.

### 6. Glint goes hue-free; the color override is deleted

Scheme C (settled): hover is pure brightness; **green appears only when something is ON**.

- `.rk-glint::after` sweep gradient recolors from `color-mix(in srgb, var(--color-accent-green) 45%, transparent)` to `color-mix(in srgb, var(--color-text-primary) 22%, transparent)` (globals.css:242-257).
- **Delete** the `.rk-glint:hover:not(:disabled) { border-color/color: accent-green }` rule (globals.css:266) entirely. Consequences, all intended: the call-site Tailwind hover utilities (`hover:border-text-secondary`, `hover:text-text-primary`) become live again as the neutral hover; latched controls (`bg-accent/20 border-accent text-accent` etc.) become hover-stable with no further work; the ~12 sites of dead hover code start rendering as written.
- Update the motion-doctrine comment block (globals.css:140-152) and the glint comment (:155-161) to describe the hue-free sweep and the green-means-state rule. The `prefers-reduced-motion` zeroing of the sweep (:1537-1538) is unaffected.

### 7. Coarse sizes move to 40px on the existing shared constants

Per the settled 40px coarse floor (fine sizes unchanged):

- `TOP_BAR_BUTTON_BASE`: `coarse:w-[30px] coarse:h-[30px]` → `coarse:w-[40px] coarse:h-[40px]`; `TOP_BAR_BUTTON_H`: `coarse:h-[30px]` → `coarse:h-[40px]`
- `TOP_BAR_SEGMENT_H`: `coarse:h-[28px]` → `coarse:h-[38px]` (keeps the existing 2px inset relative to its `TOP_BAR_BUTTON_H` wrapper)
- `KBD_CLASS`: `coarse:min-h-[36px] coarse:min-w-[36px]` → 40/40
- `ARROW_BTN` (`arrow-pad.tsx:17`): `min-h-[36px] min-w-[36px]` → 40/40 (it renders in the coarse-only arrow popup)
- Update `app/frontend/tests/e2e/bottom-bar-chip-size.spec.ts` to assert the new 40px coarse values (Test Integrity: tests conform to the spec), and sweep for any other specs asserting the 30/36 coarse geometry.

Other size stragglers (breadcrumb-dropdown 24px triggers, dialogs' missing `coarse:`, sub-target icon buttons) are **later slices** — this change only re-values the already-shared constants.

### Non-goals (later slices of the audit's §9 plan)

- Bottom-bar recomposition (⌥ + arrow pad into the F▴ menu) — its own slice.
- The `Control` React primitive and per-surface migrations (top bar, compose strip, sidebar, menus, dialogs).
- Latch-vocabulary unification at call sites; input focus-border unification; disabled-opacity sweep.
- The dev-only control-gallery route.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) hover-animation vocabulary — glint becomes a hue-free brightness sweep with no color override; new color algebra (neutral interaction / green = state); global focus-ring + pressed + select-guard rules; control token inventory; touch-target section moves to the 40px coarse floor
- `run-kit/ui/top-bar`: (modify) shared control-glyph register / control constants relocate to `components/controls.ts`; coarse button sizes 30→40 (segments 38)
- `run-kit/ui/compose-and-bottom-bar`: (modify) bottom-bar chip coarse floor 36→40 (`KBD_CLASS`, `ARROW_BTN`)

## Impact

- **Files**: `app/frontend/src/globals.css` (token block, three global rules, glint edit, comment updates); new `app/frontend/src/components/controls.ts`; `top-bar-overflow-menu.tsx` (constants removed, imports); `top-bar.tsx`, `surface-layout.tsx`, `layout-chip.tsx`, `open-button.tsx` (imports); `kbd-chip.ts`, `arrow-pad.tsx` (coarse values); `app/frontend/tests/e2e/bottom-bar-chip-size.spec.ts` (+ any other geometry-asserting specs found during apply).
- **Visible behavior deltas** (all intended, per the settled contract): every control gains a green focus ring under keyboard focus; every control gains a pressed fill; glint hover loses its green and call-site hover colors render as written; latched controls stay accent under hover; coarse-pointer bars/chips grow to 40px; long-press no longer selects control glyphs.
- **Risk surface**: e2e specs asserting sizes or colors on coarse viewports; the top bar grows taller on coarse (layout uses min-heights and flex, expected to absorb it — verify at 375px per the project's Playwright-driven workflow); the global `:active` rule painting `bg-card` on tinted rows (inline styles win, verified acceptable).
- **No backend, API, or tmux impact.** Frontend-only.

## Open Questions

- None — the contract decisions were settled interactively in the originating discussion (2026-09-05); remaining judgment calls are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hue scheme C (neutral hover + green = state), 40px coarse floor, long-press select guard | Discussed — user explicitly chose each from rendered options (control-hue-size-options.html) | S:95 R:70 A:95 D:95 |
| 2 | Certain | Slice scope = tokens + global rules + shared-constant re-values only; bar recomposition and per-surface Control migrations are later slices | Discussed — audit §9 migration order; user approved "slice 1+2" framing | S:90 R:85 A:90 D:90 |
| 3 | Certain | Update `bottom-bar-chip-size.spec.ts` (and any other geometry-asserting specs) to the 40px contract values | Constitution Test Integrity: tests conform to spec; sizes are the spec being changed | S:85 R:90 A:90 D:90 |
| 4 | Confident | Token module home is `app/frontend/src/components/controls.ts`; TS constants keep Tailwind literals with lockstep comments; CSS custom props serve CSS-side consumers | Follows the repo's documented-lockstep precedent (COARSE_POINTER_QUERY, STATUS_RAIL_WIDTH_PX); Tailwind's scanner can't read vars | S:70 R:85 A:82 D:72 |
| 5 | Confident | Deleting the glint override makes call-site hover utilities the live neutral hover for this slice (full brighten-to-text-primary unification rides the per-surface slices) | Existing classes already encode a neutral hover; zero-churn now, unified later | S:72 R:82 A:85 D:78 |
| 6 | Confident | Global pressed rule (`:active` → `bg-card` fill, `transition: none`) on the control selector set | Generalizes the audit's one complete recipe (KBD_CLASS); inline-tinted rows keep their tint (inline wins) | S:65 R:80 A:78 D:70 |
| 7 | Confident | `TOP_BAR_SEGMENT_H` coarse derives as 38px (preserves the existing 2px inset inside the 40px bar) | Today's ratio is 26-in-28 fine / 28-in-30 coarse; same construction | S:60 R:90 A:82 D:75 |
| 8 | Confident | Existing per-site `focus-visible:` utilities are left in place; the unlayered global rule outranks them uniformly | Unlayered beats layered utilities (the audited glint mechanism, used deliberately); removal deferred to surface slices | S:68 R:85 A:82 D:75 |
| 9 | Tentative | The global focus ring excludes `input`/`textarea`/`select` — text inputs keep the `focus:border-*` live-input idiom for now | Two idioms coexist today; ringing inputs too may double-signal on the 13 focus:border sites — excluding is the conservative slice-1 read <!-- assumed: inputs excluded from the global focus ring; unify input focus treatment in a later slice --> | S:55 R:75 A:60 D:45 |

9 assumptions (3 certain, 5 confident, 1 tentative, 0 unresolved).
