# Intake: Latch Vocabulary Unification — Green = State

**Change**: 260906-qqh1-latch-green-unification
**Created**: 2026-09-06

## Origin

> Control retrofit slice 3: unify every latched/on control state on the green latch vocabulary; retire accent-blue from control states; aria + open-latch stragglers

Conversational origin: slice 3 of the control-vocabulary retrofit (contract settled 2026-09-05: **scheme C — neutral interaction, green = state only**; evidence in `docs/wiki/control-state-audit.html` + `control-contract-preview.html`). Slices 1–2 shipped as PR #845 (tokens, global focus ring, hue-free glint, 40px coarse floor, bar recomposition). The user then asked "is the blue/green dual coloring being solved in the coming steps?" and approved this slice to solve exactly that: latched controls still split between accent-blue (`bg-accent/20 border-accent text-accent` — bottom-bar chips, F▴ open-latch, autofit, compose Send armed) and accent-green (surface toggles, section rail, find-bar/tile-verb bare glyphs), so a latched chip today shows a blue latch under the green focus ring.

## Why

1. **The pain**: scheme C's end state is *green = state, only and always* — but the state half is still two-toned. The same "this is on" meaning renders as blue on the bottom bar and green in the top bar, and three latches are ink-only (no fill/border), so on-strength varies by surface. Two controls latch visually with no `aria-pressed`; several open-menu triggers still look identical open and closed.
2. **If unfixed**: the contract's core promise (a hued control always means state) stays false, and slice 4–6 surfaces would keep propagating two latch recipes.
3. **Approach**: one shared latch class-arm in `controls.ts`, consumed everywhere via the REST-swap pattern PR #845's review cycles proved (the latched arm replaces the hover-carrying rest classes, so no hover utility competes). Borderless controls express the border axis as `ring-1 ring-inset` (no layout shift), which the section rail already does.

## What Changes

### 1. Shared latch arm — `app/frontend/src/components/controls.ts`

Add two exported constants (with a doc comment stating the scheme-C rule and the REST-swap requirement):

```ts
/** The one latched/on state arm (scheme C: green = state). Compose with a
 *  BASE that carries NO hover color utilities (REST swapped out) so nothing
 *  competes with the latch border. Lockstep: the latch color algebra is
 *  documented in docs/memory/run-kit/ui/visual-design.md. */
export const LATCHED_ARM = "bg-accent-green/15 border-accent-green text-accent-green hover:bg-accent-green/25";
/** Border-axis equivalent for borderless controls (rail toggles, find-bar and
 *  tile-verb glyph buttons) — ring-inset paints inside, so latching never
 *  shifts layout. */
export const LATCHED_ARM_RINGED = "bg-accent-green/15 ring-1 ring-inset ring-accent-green text-accent-green hover:bg-accent-green/25";
```

The `/15` rest + `/25` hover fills are the unified values (today's mix: `/10`, `/20`, `/30`). `ring` is not focus's token (focus is `outline`), so no collision.

### 2. Accent-blue latches → `LATCHED_ARM` (the REST-swap sites)

All currently `bg-accent/20 border-accent text-accent hover:bg-accent/30` (or `/10`) with `KBD_BASE`/button bases:

- `components/bottom-bar.tsx`: the `^` Ctrl chip, the compose `a▏` chip, the scroll-lock `⌨`/`🔒` chip, the F▴ open-latch trigger, and the F▴ menu's `⌥` latch row (its row form: `bg-accent/20 text-accent` → `bg-accent-green/15 text-accent-green`, row keeps no border)
- `components/status-bar.tsx:~743`: the fine-pointer compose `a▏` twin (`border-accent bg-accent/20 text-accent` → `LATCHED_ARM`; note it composes with a plain border-box class, not KBD — swap its hover-carrying classes out when latched, same pattern)
- `components/top-bar.tsx:~2595`: board autofit toggle (`border-accent text-accent bg-accent/10` → `LATCHED_ARM`)
- `components/compose-strip.tsx:~1108`: the Send button's **armed** arm (`border-accent bg-accent/20 text-accent` + `hover:bg-accent/30` → `LATCHED_ARM`) — armed-to-send is a state
- `components/sidebar/window-row.tsx:~1012`: the pin glyph's "pinned to the viewed board" state ink `text-accent` → `text-accent-green` (glyph-only control; ink is its whole treatment)

### 3. Green latches → the shared constants (value alignment)

- `components/top-bar.tsx:~437`: surface-toggle segments (`border-accent-green bg-accent-green/10 text-accent-green` → `LATCHED_ARM`)
- `components/sidebar/section-rail.tsx:~57`: rail toggles (`bg-accent-green/10 ring-1 ring-inset ring-accent-green text-accent-green` → `LATCHED_ARM_RINGED`)
- `components/find-bar.tsx` `Aa`/`.*` toggles and `components/surface-layout.tsx` tile Find (~:1609) / Zoom (~:1751): bare `text-accent-green` ink-only latches upgrade to `LATCHED_ARM_RINGED` at their existing sizes

### 4. Aria + open-latch stragglers

- **Missing `aria-pressed`**: the scroll-lock chip (`bottom-bar.tsx:~494`) and tile Zoom (`surface-layout.tsx:~1751`) latch visually with no aria — add `aria-pressed`
- **Open-menu triggers latch while open** (the F▴ pattern from slice 2 — latched arm swapped in on `aria-expanded`/open state): the top-bar overflow chevron trigger (`top-bar-overflow-menu.tsx:~645`), the Open `▾` and Split `▾` chevron segments (`open-button.tsx:~147`, `top-bar.tsx:~2371`), the LayoutChip trigger (`layout-chip.tsx:~117`), the compose history `↑` chip (`compose-strip.tsx:~1028`), and tile Export (`surface-layout.tsx:~1627`)

### Non-goals (later slices)

- `MENU_ROW_ACTIVE` inverse video and menu checked/selected vocabulary, breadcrumb `item.current` tint — **selection** is slice 4 (menus), not latch
- Input focus-border colors (slice 6); operator-console mobile Send gaining an armed state; the `Control` React primitive (slice 7)
- Any geometry change — sizes shipped in slices 1–2

## Affected Memory

- `run-kit/ui/visual-design`: (modify) color algebra completed — the latch vocabulary section: one green latch arm (`LATCHED_ARM`/`LATCHED_ARM_RINGED`, /15 rest /25 hover), accent-blue retired from control states; open-menu triggers latch while open
- `run-kit/ui/compose-and-bottom-bar`: (modify) chip latch classes now the shared green arm; Send armed = green; scroll-lock gains aria-pressed
- `run-kit/ui/top-bar`: (modify) surface toggles/autofit/chevron+layout triggers on the shared arm; overflow trigger open-latch
- `run-kit/ui/sidebar`: (modify) section-rail latch via shared ringed arm; pin state ink green

## Impact

- **Files**: `controls.ts`, `bottom-bar.tsx`, `status-bar.tsx`, `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `open-button.tsx`, `layout-chip.tsx`, `compose-strip.tsx`, `find-bar.tsx`, `surface-layout.tsx`, `sidebar/section-rail.tsx`, `sidebar/window-row.tsx` + affected unit tests and any e2e asserting `bg-accent/`/`border-accent`/`text-accent` on latched controls (sweep `app/frontend/tests/` + `src/**/*.test.tsx` for the old class strings; constitution Test Integrity — tests follow the spec).
- **Visible deltas** (all intended): every latched control is green; armed Send is green; chevron/layout/history/export triggers show their open state; no blue control states remain (`grep -n "bg-accent/\|border-accent \|text-accent[^-]"` over `src/components` should return only non-control uses afterwards — inputs' `focus:border-accent` and breadcrumb `item.current` are the two known survivors, deferred by non-goals).
- Frontend-only; no backend/API/tmux impact.

## Open Questions

- None — the vocabulary, values, and site list follow the settled contract and the shipped slice-1/2 patterns; judgment calls are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Green is the single latch hue; accent-blue retires from control states | Scheme C settled with the user 2026-09-05; this slice user-approved to fix exactly this | S:95 R:75 A:95 D:95 |
| 2 | Confident | Unified fills are `/15` rest, `/25` hover-deepen (replacing today's /10, /20, /30 mix) | Contract preview used ~16%/28% color-mix; nearest Tailwind steps; single-value rule matters more than the exact step | S:60 R:85 A:75 D:65 |
| 3 | Confident | Borderless latches use `ring-1 ring-inset` (LATCHED_ARM_RINGED) — no layout shift; `ring` ≠ focus token (focus is `outline`) | Section rail already proves the pattern; audit noted ring-as-selection precedent | S:70 R:85 A:82 D:75 |
| 4 | Confident | Latch application is always a REST-swap (base without hover colors + arm), never class stacking | PR #845 review cycles proved stacking ties on specificity and loses on source order | S:80 R:85 A:90 D:85 |
| 5 | Confident | Open-menu triggers latch on their open state (the slice-2 F▴ pattern) at the six listed sites; menu ROWS' selected treatment stays untouched (slice 4) | Latch = binary on-state incl. "menu open"; selection is a different vocabulary | S:70 R:80 A:82 D:72 |
| 6 | Confident | The pin glyph keeps ink-only treatment (green ink), no fill/ring — it is a 24px hover-revealed glyph where a fill would read as a button | Glyph-cluster idiom; upgrading its box is slice 5's sidebar work | S:62 R:82 A:78 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
