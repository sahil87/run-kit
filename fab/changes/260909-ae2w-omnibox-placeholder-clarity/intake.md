# Intake: Omnibox Placeholder Clarity

**Change**: 260909-ae2w-omnibox-placeholder-clarity
**Created**: 2026-09-09

## Origin

One-shot, from a screenshot (`.uploads/260909120528-image.png`) of the desktop top bar on a terminal route, with the operator omnibox engaged (green border, `from: @42…` context chip, `⌘J` keycap) and the user's question:

> What's going on here? Why are the 3 dots in the operator input box?

Investigation (this conversation) established the cause before the change was created:

- The "3 dots" are the trailing `…` of the omnibox input's **placeholder**, not a menu/overflow affordance. The placeholder is rung-dependent in `app/frontend/src/components/operator-omnibox.tsx`: `placeholder={extraWide ? "Ask the operator…" : "Ask ◉…"}` — the short `Ask ◉…` form (`◉` = the operator glyph, i.e. "Ask [the operator]…") renders at every width below `2xl` (1536px), which is most desktop viewports.
- The short form was chosen so the placeholder fits the slim `w-[12ch]` resting box (PR #840, Quake Console v2). But the box **already renders a standing `◉` glyph** (`OperatorStateGlyph`, carrying the live-state dot) immediately left of the input, so the box reads `◉ Ask ◉…` — two operator glyphs and a dangling ellipsis. Nothing in the box says what `◉…` means.
- The screenshot compounds it: the engaged box also mounts the context chip, whose label is width-capped (`max-w-[14ch]`, `truncate`) and therefore ends in its own **truncation** `…` (`from: @42…`). Two ellipses side by side — one a placeholder, one a truncation — make the placeholder's `◉…` read as "something got cut off here".
- The placeholder gate is width-only (`extraWide`); the engaged/morphed state does not change it. Widening the engaged placeholder to the long form is NOT the fix: with the chip mounted, the input's remaining width inside the `w-[34ch]` engaged box is ~12ch, so `Ask the operator…` (18ch) would clip mid-word — worse than today.
- The same `"Ask ◉…"` string is quoted in `docs/site/skill/tutorial.md` and documented as the `lg`/`xl` placeholder in `docs/memory/run-kit/ui/operator-console.md` and `docs/memory/run-kit/ui/top-bar.md`.

Decision reached: drop the redundant `◉` from the short placeholder so the box reads `◉ Ask…` at `lg`/`xl` (rest and engaged), keep `Ask the operator…` at `≥ 2xl`, and update the docs that quote the string.

## Why

**Problem.** The omnibox is the desktop's ONLY input to the operator (the one-input rule, `ui/operator-console`), so its resting appearance is the whole affordance. At `lg`/`xl` — the common desktop band — it reads `◉ Ask ◉…`: the operator glyph appears twice (once as the standing state-dot glyph, once inside the placeholder), and the placeholder's tail `◉…` looks like a truncated label rather than a prompt. When the box is engaged on a terminal route the context chip's truncation ellipsis sits beside it, so the box shows two `…` with different meanings. A user who knows the product well asked what the dots were — the placeholder is failing at its one job.

**Consequence of not fixing.** Every desktop viewer below 1536px sees the confusing form at rest, on every route, permanently. Users read the ellipsis as "content hidden here" (a kebab/overflow affordance, or a truncated label) and look for something to expand; the actual meaning — "type here to ask the operator" — is carried only by the `aria-label`, which sighted users never see.

**Why this approach.** The standing `◉` glyph is the operator's identity in the box and MUST stay (it carries the live-state dot). Given the glyph is already there, the placeholder does not need to name the operator again — `Ask…` beside `◉` is unambiguous, shorter (4ch vs 6ch, comfortably inside the 12ch resting budget where `Ask ◉…` was borderline), and follows the codebase's placeholder convention (trailing `…`/`...`: `search riff presets + palette actions…`, `Session name...`, `Search themes...`). Alternatives rejected: (a) switching to `Ask the operator…` whenever engaged — clips mid-word when the chip is mounted (input ≈ 12ch); (b) removing the ellipsis entirely (`Ask`) — breaks the codebase's placeholder convention and reads like a button label; (c) widening the resting box — the `12ch` cap exists so the box never eats the breadcrumbs' min-useful-width at `lg`/`xl` (a deliberate constraint from #840), not something to trade away for a placeholder.

## What Changes

### 1. Omnibox placeholder — drop the redundant glyph below `2xl`

`app/frontend/src/components/operator-omnibox.tsx`:

```tsx
// before
placeholder={extraWide ? "Ask the operator…" : "Ask ◉…"}
// after
placeholder={extraWide ? "Ask the operator…" : "Ask…"}
```

Exact behavior after the change:

| Rung | Box state | Rendered box (glyph · placeholder · trailing) |
|------|-----------|-----------------------------------------------|
| `lg`/`xl` | rest (`w-[12ch]`) | `◉ Ask… ⌘J` |
| `lg`/`xl` | engaged (`w-[34ch]`, chip may mount) | `◉ Ask… [from: @42… ✕] ⌘J` |
| `≥ 2xl` | rest (`w-[20ch]`) | `◉ Ask the operator… ⌘J` |
| `≥ 2xl` | engaged | `◉ Ask the operator… [from: @42… ✕] ⌘J` |
| md–lg morphed | engaged | `◉ Ask… [chip] ⌘J` (the morph shares the component; `extraWide` is false here) |

Unchanged, deliberately: the `aria-label="Ask the operator"` on both the input and the ghost (the accessible name keeps the full phrase); the `≥ 2xl` long placeholder; the width gate (`extraWide` media query — no new `engaged` branch in the placeholder); the md–lg ghost `· ◉ ask` (one glyph, no doubling there); the `OperatorStateGlyph` and its state dot; the `w-[12ch]` / `2xl:w-[20ch]` / `w-[34ch]` / `max-w-[40vw]` width ladder; the context chip and its `max-w-[14ch]` truncation.

The component's header comment (lines ~57–63) currently says `the short "Ask ◉…" placeholder` — update the quoted string to `"Ask…"` and add one clause of rationale (the standing glyph already names the operator, so the placeholder does not repeat it).

### 2. Unit tests

`app/frontend/src/components/operator-omnibox.test.tsx`:

- The `≥ lg rung` test asserts `toHaveAttribute("placeholder", "Ask ◉…")` — change the expected value to `"Ask…"`.
- The `≥ 2xl rung` test asserting `"Ask the operator…"` stays as is.
- Add one assertion (in an existing engaged-state test at the wide rung, e.g. the one that checks `w-[34ch]` after `requestOperatorConsole({ action: "open" })`) that the placeholder is still `"Ask…"` while engaged below `2xl` — pinning the "width-only gate" decision so a future change does not swap in the long form and clip against the chip.

Run only the omnibox spec first (`just test-frontend` scoped to `operator-omnibox`, per the project's just-only test rule), then the frontend suite.

### 3. Docs that quote the string

- `docs/site/skill/tutorial.md` line 61: `type into the top-bar box ("Ask ◉…")` → `("Ask…")`. This is a `docs/site/` surface — check against `shll standards` for the site/skill surface before editing (Constitution § Toolkit Standards); the edit is a one-token quote correction, no structural change.
- Memory updates are hydrate's job (see Affected Memory), not apply's.

## Affected Memory

- `run-kit/ui/operator-console`: (modify) § the desktop omnibox — the `lg`/`xl` short placeholder is `Ask…` (was `Ask ◉…`); add a Design Decision: the placeholder does not repeat the operator glyph because the standing `◉` beside it already names the operator, and the engaged box keeps the short form below `2xl` because the mounted chip leaves the input ~12ch (the long form would clip).
- `run-kit/ui/top-bar`: (modify) § center cell omnibox paragraph — the rung-dependent placeholder line quotes `Ask ◉…`; update to `Ask…`.

## Impact

- **Code**: `app/frontend/src/components/operator-omnibox.tsx` (one string + header comment), `app/frontend/src/components/operator-omnibox.test.tsx` (one expectation + one added assertion).
- **Docs**: `docs/site/skill/tutorial.md` (one quoted string); two memory files at hydrate.
- **Behavior contract**: visible placeholder text only. No layout, width, focus, keyboard, or send-lane behavior changes; `aria-label`s unchanged, so no accessible-name change. No backend, no API, no e2e spec references the placeholder (grep confirmed: only the unit spec and `row-flyout-card.tsx`'s unrelated `title="Ask the operator to rename…"`).
- **Keyboard-first**: unaffected — ⌘J, Enter, Esc, and the palette entry are untouched.

## Open Questions

- None. All decisions graded Confident or Certain; nothing to ask.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The short placeholder becomes `Ask…` (drop the `◉`), not a different phrasing | The standing glyph already names the operator; `Ask…` fits the 12ch budget with room; the screenshot + question point at the glyph-plus-dots tail. Alternatives (`ask…`, `Ask op…`) have no codebase precedent | S:70 R:95 A:80 D:65 |
| 2 | Confident | Engaged below `2xl` keeps the short form — the placeholder gate stays width-only, no `engaged` branch | With the chip mounted the input inside `w-[34ch]` is ~12ch; `Ask the operator…` (18ch) would clip mid-word. Pinned by a new test assertion | S:50 R:90 A:75 D:60 |
| 3 | Certain | Keep the trailing ellipsis | Codebase placeholder convention (`…`/`...` on search/name inputs); the `≥ 2xl` form already ends in `…` | S:60 R:95 A:90 D:85 |
| 4 | Certain | `≥ 2xl` placeholder `Ask the operator…` unchanged | Not part of the reported confusion; full phrase has no doubling problem | S:60 R:95 A:95 D:90 |
| 5 | Certain | `aria-label="Ask the operator"` unchanged on input and ghost | Accessible name should carry the full phrase regardless of visual abbreviation | S:60 R:95 A:95 D:90 |
| 6 | Certain | md–lg ghost `· ◉ ask` unchanged | One glyph, no doubling; outside the reported surface | S:55 R:95 A:85 D:80 |
| 7 | Certain | Tutorial quote and the two memory files update to the new string; no other doc quotes it | grep across `docs/`, `README.md`, `app/` found exactly these three occurrences plus the source and its spec | S:80 R:95 A:95 D:95 |
| 8 | Certain | Change type is `fix` (overrides the inferred `feat`) | A visible-copy correction of an existing surface, no new capability | S:75 R:95 A:95 D:95 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
