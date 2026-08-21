# Intake: Label Picker Clear-Cell Neutral Minus

**Change**: 260821-k17a-picker-clear-cell-neutral-minus
**Created**: 2026-08-21

## Origin

Promptless dispatch (deferred questioning) from a design session, synthesizing user decisions made while reviewing the merged banded Label picker (PR #668, change `260819-9hh6-banded-label-picker-rework`). The user's decisions, captured verbatim:

> **Change: Label picker clear-cell glyph — ∅ → neutral minus.**
>
> 1. **Glyph**: the three header clear cells replace `∅` with a neutral **minus** (`−`, U+2212), in exactly the ✕ close button's treatment — `text-secondary`, brightening to `text-primary` on hover, no color accent. Rationale: the header cell is an ACTION ("clear this axis"); ∅ is a STATE symbol and read as alien chrome. ✕ and − form a verb pair: ✕ closes the panel, − clears the axis.
> 2. **Rejected: red minus** (user's own alternative, rejected on discussion): red is this UI's kill/danger vocabulary (kill controls, error states); clearing a label is cheap and reversible, and the hover accent in this design language is green — a red glyph over-signals and has no hover story. Recorded in the design study's glyph-comparison strip.
> 3. **∅ keeps exactly one job**: the STATE token for "unset" axes in the composite preview's combo caption (e.g. `teal · ∅ · scan`) — unchanged.
> 4. **Aria stability**: accessible names unchanged. Glyph-only change; tests keyed on aria stay stable, any test asserting the ∅ TEXT in a header clear cell updates.
> 5. **Docs ride along**: update the "header-∅" wording to describe the minus clear cell in memory and specs; sync the wiki design-study page from this change's assets copy.

The updated design-study page (additive over the version PR #668 merged: it adds the clear-cell glyph comparison strip — ∅ / − neutral / − red — and switches the iteration-4 mock to the neutral minus) is checked in at [`assets/picker-layout-studies.html`](assets/picker-layout-studies.html) (glyph strip: "CLEAR-CELL GLYPH · ∅ (SHIPPED) vs − NEUTRAL vs − RED").

## Why

1. **Pain point**: the banded Label picker's three band headers (`[ color ]` / `[ marker ]` / `[ flair ]`) each carry a right-aligned clear cell currently rendering `∅`. The cell is an **action** ("clear this axis"), but `∅` is a **state** symbol (this UI's token for "unset") — using it as a button glyph reads as alien chrome and blurs the state/action split the picker otherwise keeps clean (the caption uses ∅ as state; the header cell performs a verb).
2. **Consequence of not fixing**: the glyph vocabulary stays internally inconsistent — the same symbol means "is unset" in the caption and "make unset" in the header — a small but permanent legibility tax on every picker open, and a precedent for reusing state tokens as action glyphs elsewhere.
3. **Why this approach**: a neutral minus (`−`, U+2212) in exactly the ✕ close button's treatment makes ✕/− a coherent verb pair (✕ closes the panel, − clears the axis) with zero layout or behavior change. The red-minus alternative was considered and rejected by the user: red is this UI's kill/danger vocabulary, clearing a label is cheap and reversible, the design language's hover accent is green — a red glyph over-signals and has no hover story. The comparison is recorded in the design study's glyph strip.

## What Changes

### 1. Header clear-cell glyph — `swatch-popover.tsx`

`BandHeader` (`app/frontend/src/components/swatch-popover.tsx:98–138`) renders the clear cell's glyph at line 133:

```tsx
<span style={{ fontSize: 10, lineHeight: 1 }}>&#x2205;</span>
```

Replace `&#x2205;` (∅) with `&#x2212;` (−, U+2212 MINUS SIGN — not the ASCII hyphen). Everything else in the cell stays: the cell **already carries the ✕ close button's color treatment** (`text-text-secondary hover:text-text-primary`, matching the ✕ at line 452), plus `bg-bg-inset`, `role="option"`, `aria-selected={isUnset}` (the unset ring `ring-1 ring-text-primary`), the focus ring, the `Tip`/`aria-label` from `clearLabel`, and the 10px size (= the ✕'s `text-[10px]`). This is a glyph-only diff — no class, size, ring, or handler changes.

All three band headers go through this one component (call sites at lines 472, ~526, ~577 with `clearLabel="Clear color"` / `"Marker none"` / `"Flair none"`), so one glyph edit covers color, marker, and flair.

Comment/doc-string wording in the file that describes the **header clear cell** as "∅" updates to the minus (e.g. lines 45, 49, 56, 83–84, 95–97, 198–199, 228, 522, 574). The caption references (lines 394–399) keep ∅ — see §2. Also `app/frontend/src/components/sidebar/index.tsx:2750` (`// "" (the header ∅ cell) clears.`) — comment wording only.

### 2. ∅ keeps exactly one job — combo caption (unchanged)

The composite preview's combo caption keeps `∅` as the STATE token for unset axes (`swatch-popover.tsx:394–399`: `parseColorValue(previewValue)?.family.name ?? "∅"`, `previewMarker || "∅"`, `previewFlair || "∅"` — rendering e.g. `teal · ∅ · scan`). No code or test touching the caption changes.

### 3. Tests — no assertion changes; wording rides along

Verified against the merged tree: **no unit or e2e test asserts the lone ∅ text of a header clear cell.** All header-cell queries are aria-name based (`getByRole("option", { name: "Clear color" | "Marker none" | "Flair none" })` in `swatch-popover.test.tsx`, `sidebar/index.test.tsx`, `settings-dialog.test.tsx`, and `tests/e2e/window-marker-gutter.spec.ts:89,116,195`). The only ∅ **text** assertions are the caption (`swatch-popover.test.tsx:299` and `window-marker-gutter.spec.ts:252`, both `∅ · ∅ · ∅`) — they keep ∅ and stay untouched. Aria names are unchanged, so all tests stay green on the glyph swap itself.

What does update, cosmetically, is test-name/comment wording that calls the header cell "∅":

- `app/frontend/src/components/swatch-popover.test.tsx` — test names and comments (e.g. lines 71, 76, 169, 226, 381, 404, 414, 463–474, 577–708 keyboard-model comments)
- `app/frontend/src/components/sidebar/index.test.tsx:2076` — test name
- `app/frontend/src/components/settings-dialog.test.tsx:408` — comment
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` — comments (lines 84–85, 114, 194)
- `app/frontend/tests/e2e/window-marker-gutter.spec.md` — the companion doc describes the "header ∅ clear cell" (lines 14, 45–46, 62, 66, 77, 84, 111, 121); per the constitution's Test Companion Docs rule it updates in the same commit as the `.spec.ts`

### 4. Docs ride along

- `docs/memory/run-kit/ui/visual-design.md` — § Banded Label picker (line ~205: "right-aligned ∅ clear cell … the ∅ cells keep the accessible names") and the keyboard-model paragraph ("header ∅ is row 0 of the band") describe the minus clear cell instead; the caption-∅ description (line ~207) stays. The action-vs-state / ✕-− verb-pair rationale is Design-Decision material for hydrate.
- `docs/memory/run-kit/ui/sidebar.md:469` — "the ∅ in the band header … `""` clears via the header ∅ … whose header ∅ is row 0" wording updates (verified mention).
- `docs/memory/run-kit/ui/status-signals.md:176` — "green-bracket headers carry the right-aligned **∅ clear cells**" wording updates (verified mention).
- `docs/specs/themes.md:170,179` — "right-aligned **∅ clear cell** (ringed …)" and "each header ∅ is row 0" update; line 169's caption `∅` stays.
- `docs/wiki/picker-layout-studies.html` — synced from this change's `assets/picker-layout-studies.html` (additive over the PR #668 version: the clear-cell glyph comparison strip ∅ / − neutral / − red with the rejection rationale, and the iteration-4 mock switched to the neutral minus). Optionally extend the page's one-line description in `docs/specs/index.md` (wiki table) to mention the glyph strip.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) — § Banded Label picker header clear-cell description (∅ → neutral minus in the ✕ treatment) + keyboard-model wording; candidate Design Decision: neutral minus over ∅/red-minus (action-vs-state, ✕/− verb pair, red = kill vocabulary)
- `run-kit/ui/sidebar`: (modify) — flair-band picker entry-point wording at line 469 mentions the header ∅ (verified)
- `run-kit/ui/status-signals`: (modify) — `Change color…` handoff wording at line 176 mentions the ∅ clear cells (verified)

## Impact

- `app/frontend/src/components/swatch-popover.tsx` — one-glyph code change in `BandHeader` (line 133) + comment wording; no layout, behavior, keyboard-model, aria, or handler changes
- `app/frontend/src/components/swatch-popover.test.tsx`, `sidebar/index.test.tsx`, `settings-dialog.test.tsx` — comment/test-name wording only; zero assertion changes (verified: header-cell queries are aria-based; caption ∅ assertions stay)
- `app/frontend/src/components/sidebar/index.tsx` — one comment
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` + `.spec.md` — comment/doc wording only, same commit
- `docs/memory/run-kit/ui/{visual-design,sidebar,status-signals}.md`, `docs/specs/themes.md`, `docs/wiki/picker-layout-studies.html` (+ optional `docs/specs/index.md` wiki-row description)
- No backend, no stored-value, no keyboard, no behavior changes; no data migration. Visual-only.

## Open Questions

None — the design session resolved glyph, treatment, rejected alternative, ∅'s remaining role, and doc scope; the VERIFY items (aria names, ∅-text assertions, status-signals mention) were checked against the merged tree during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Header clear glyph = neutral minus (U+2212) in the ✕ treatment (`text-secondary` → `text-primary` hover, no color accent) | Discussed — user decided; iteration-4 mock in the study page already renders it | S:95 R:90 A:95 D:95 |
| 2 | Certain | Red minus rejected | Discussed — user's own alternative, rejected: red = kill/danger vocabulary, hover accent is green, clearing is cheap/reversible; recorded in the study's glyph strip | S:95 R:90 A:95 D:95 |
| 3 | Certain | ∅ keeps exactly one job — the caption's unset-state token; caption code + `∅ · ∅ · ∅` assertions untouched | Discussed — user decided; caption is a separate code path (swatch-popover.tsx:394–399) | S:95 R:90 A:95 D:90 |
| 4 | Certain | Accessible names unchanged: `Clear color` / `Marker none` / `Flair none` | Verified against merged swatch-popover.tsx `clearLabel` call sites (lines 474/528/579); glyph-only change | S:90 R:85 A:100 D:95 |
| 5 | Confident | Glyph-only diff in `BandHeader`: keep `bg-bg-inset`, rings, size (fontSize 10 = ✕'s 10px); do NOT drop the inset background to literally mirror the ✕ | "Exactly the ✕'s treatment" enumerates the color pair, which the cell already has; user said "glyph-only change"; the inset bg is cell chrome the ✕ lacks — mild interpretation, easily reversed | S:80 R:90 A:75 D:65 |
| 6 | Certain | Zero test-assertion changes; only comments/test names/spec.md wording update | Verified: every header-cell query is aria-name based; the only ∅ text assertions are the caption, which keeps ∅ | S:85 R:90 A:95 D:90 |
| 7 | Certain | `run-kit/ui/sidebar` and `run-kit/ui/status-signals` memory files also modify (beyond the listed visual-design) | Description's VERIFY clause resolved: header-∅ mentions confirmed at sidebar.md:469 and status-signals.md:176 | S:75 R:85 A:90 D:85 |
| 8 | Confident | Comment/test-name rewording rides in the same commit, including `window-marker-gutter.spec.md` per the Test Companion Docs rule | Constitution requires `.spec.md` sync when its `.spec.ts` changes; keeping "header ∅" comments would leave code lying about its own glyph | S:65 R:90 A:80 D:70 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
