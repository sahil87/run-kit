# Intake: Label Picker Panel-Level − (Clear All Axes)

**Change**: 260822-wryh-label-picker-clear-all
**Created**: 2026-08-23

## Origin

Promptless dispatch (create-intake procedure, `{questioning-mode} = promptless-defer`) from a synthesized design-session description. The user ran a design session on the banded Label picker (`swatch-popover.tsx`, shipped in PRs #668 + #702) and decided to add an **unset-everything verb** — a panel-level − that clears every axis the caller offers. All placement, ring, write-seam, keyboard, variant, and docs decisions below are user decisions from that session, captured faithfully.

> **Change: Label picker panel-level − (clear all axes).** The banded Label picker has per-axis − clear cells in each band header, under the scope grammar "a − clears whatever its row names". Add an unset-everything verb: the panel header row (composite preview + ✕ close cell) gains its own − clear-all cell, sitting between the preview and ✕. Its row names the whole label, so it clears ALL axes the caller offers.

Design reference: [`assets/picker-layout-studies.html`](assets/picker-layout-studies.html) § "B · ITERATION 5 · UNSET EVERYTHING" — treat its content as the user-approved design (the live clear-all mock, its caveats, and rejected shapes).

## Why

1. **The pain point**: the picker's scope grammar is "a − clears whatever its row names" — each band header's − clears one axis. But resetting a fully-labelled row (color + marker + flair) takes three clicks across three bands. There is no verb at the label scope, even though the panel header row already *names* that scope (the composite preview shows the whole label).
2. **Consequence of not doing it**: the grammar stays incomplete — the one row whose name is "the whole label" is the only row without a −. Users who want "back to unset" must know and hit all three per-axis clears.
3. **Why this approach**: the panel header row extends the existing grammar instead of inventing new chrome. Rejected alternatives (user decisions, record for posterity):
   - A "Clear all" **text row** — heavier chrome, breaks the glyph grammar.
   - Hanging clear-all on the **caption** — the caption is STATE (`∅ · ∅ · ∅`), never action.
   - **Long-press on a band −** — invisible, keyboard-hostile.
4. **Accepted tradeoff** (user-accepted): the clear-all sits one cell from ✕ — a misclick clears the axes instead of closing; mitigated by the gap, hover tip, and the never-dismiss rule making recovery an immediate re-pick.

## What Changes

### 1. Placement — panel header row gains a − clear-all cell

In `app/frontend/src/components/swatch-popover.tsx`, the panel header row (currently: composite preview `div` + ✕ close cell) gains a **− clear-all cell between the preview and ✕**. Its row names the whole label, so it clears ALL axes the caller offers.

Treatment matches the band −s exactly:
- Same glyph: `&#x2212;` (U+2212, neutral minus), fontSize 10.
- Same colors: `text-text-secondary hover:text-text-primary`.
- Same cell chrome: the band-header clear-cell treatment including the `bg-bg-inset` inset background, 18px cell (`CELL` const).
- `Tip` wrapper + `aria-label` — accessible name **"Clear all"** (verified idiom: the verb-first form matches the color band's existing `clearLabel="Clear color"`; the other bands use "Marker none" / "Flair none", and the close cell is "Close picker" — "Clear all" is consistent with the verb-first color idiom).
- `role="option"` like every other cell in the listbox.

### 2. Ring rule at its scope

The panel − carries `aria-selected` + the unset ring (`ring-1 ring-text-primary`) when **EVERY offered axis is unset**: color null AND — where the bands are offered — marker `""` AND flair `""`. Follow the band-header idiom and compute from the **props** (`selectedValue == null`, `currentMarker === ""`, `currentFlair === ""`), not the preview overrides — that is how the band −s ring today, so after a clear-all (caller echoes the writes back through props) the panel − and all offered band −s ring together: "label fully unset" is legible at every scope.

### 3. Write seam — no new API

Clicking the panel − emits the **existing clears only**:
- `onSelect(null)` — always (via the existing `emit(null)` seam, which also sets the preview override).
- `onSelectMarker("")` — only when `onSelectMarker` is supplied.
- `onSelectFlair("")` — only when `onSelectFlair` is supplied.

Callers without a band just don't receive that axis. No new props, no new backend values: `null` color and `""` marker/flair are already in the backend closed sets (`internal/validate/validate.go` — `ValidateColorValue`, `ValidateMarkerValue`, flair tokens; empty string means unset) — **verified: validate.go needs nothing**.

The picker **stays open** (selection never dismisses — existing dismissal contract), and the composite preview + combo caption drop to the unset state (`∅ · ∅ · ∅` on the full variant) via the existing preview-override repaint (`setPreviewOverride(null)` / `setMarkerOverride("")` / `setFlairOverride("")` for the offered axes, matching the immediacy the band clears already have).

### 4. Keyboard — top row becomes two cells

The logical row stack's top row (currently `[cellId("close")]`, the grid's row 0) becomes **TWO cells**: `[− clear-all] [✕ close]` — both reachable by arrows:
- ArrowLeft/Right within the top row (the existing clamped-column horizontal move).
- ArrowUp from the color band's header − (row 1) lands on the top row per the existing goal-column model (raw column carried through single-cell rows, clamped to the target row's extent).
- Enter/Space activates (extend the `activate` callback with the new cell id).

### 5. Applies to every caller variant

- **Full Label picker** (window rows — `sidebar/window-row.tsx`): clears color + marker + flair.
- **Color+flair** (session rows — `sidebar/session-row.tsx`; server group header — `sidebar/index.tsx`): clears color + flair.
- **Color-only** (settings/host accent pickers — `settings-dialog.tsx`, `sidebar/host-panel.tsx`, `app.tsx`, `sidebar/collapsible-panel.tsx`): the clear-all degenerates to clear color — acceptable and consistent. **User default: render it there too** for grammar consistency (graded assumption below — codebase inspection shows the panel − would exactly duplicate the color band's − on this variant, but nothing makes omission clearly cleaner: the variant fork would itself be new conditional chrome).

### 6. Docs ride along

- `docs/wiki/picker-layout-studies.html` — synced from **this change's assets copy** (`assets/picker-layout-studies.html`), which is additive over the version on main: it adds the "B · ITERATION 5 · UNSET EVERYTHING" section (the live clear-all mock, its caveats, and rejected shapes) AND a "STUDY · A THIRD SHADE" section. The third-shade study documents a **pending SEPARATE change** — this intake covers ONLY the clear-all; the wiki sync ships the whole page since the page is one artifact, but nothing else from the shade study is in scope.
- `docs/specs/themes.md` — the picker section (≈ lines 124–181, "banded Label picker") gains the panel-level − sentence.
- Memory updates at hydrate (see Affected Memory).

### 7. Tests

- `swatch-popover.test.tsx` — new tests: clear-all emits the offered clears only (all three on full; color+flair when no marker; color alone on color-only), ring rule (rings only when every offered axis is unset), keyboard top row (ArrowLeft/Right between − and ✕; ArrowUp from the color header − lands on the top row; Enter activates).
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` (+ sibling `.spec.md` in the **same commit**, per constitution Test Companion Docs) — only if picker chrome assertions need it; the existing spec queries cells by role/name (`Marker none`, `Close picker`), which an additive cell does not break, so e2e changes are expected to be additive-or-none (plan decides).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) § Banded Label picker — panel header row anatomy gains the − clear-all cell; the accessible-names list (`Clear color` / `Marker none` / `Flair none`) gains `Clear all`; the keyboard-model wording's row stack (`[✕] · [color −] · …`) becomes `[− ✕] · [color −] · …`; the "Neutral minus clear glyph (✕/− verb pair)" Design Decision extends to the panel scope. **Verified: the keyboard-model wording lives here**, not in keyboard-and-palette.md (which has no picker keyboard content).
- `run-kit/ui/status-signals`: (modify) § the `Change color…` handoff paragraph — its picker-anatomy sentence mentions the band headers' − clear cells and should note the panel-level −. (It also carries a "the server tier gets color only" claim that predates the shipped server color+flair wiring — verify/correct that stale sentence while touching, since sidebar.md § Picker entry points states server group header = color + flair.)
- `run-kit/ui/sidebar`: (modify) § Picker entry points — mentions the header-− row-0 keyboard wording and the per-axis clears; light touch to acknowledge the panel-level clear-all if the anatomy sentence needs it (verified: it describes band-level −s only; the panel top row is described in visual-design.md).

## Impact

- `app/frontend/src/components/swatch-popover.tsx` — the component change (header row, grid row 0, activate, ring rule). Frontend-only.
- `app/frontend/src/components/swatch-popover.test.tsx` — new unit tests.
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` + `.spec.md` — only if picker chrome assertions need it (same-commit companion rule).
- `docs/specs/themes.md` — picker section, one panel-level − sentence.
- `docs/wiki/picker-layout-studies.html` — full-page sync from `assets/picker-layout-studies.html` (iteration-5 + third-shade study sections).
- **No backend change** — verified: no new stored values; `null` color and `""` marker/flair are already the accepted clear vocabulary in `internal/validate/validate.go`.
- No new API, no new routes, no new props on `SwatchPopover`.

## Open Questions

None — the design session resolved placement, ring rule, write seam, keyboard, variants, rejected shapes, and the misclick tradeoff; the description's VERIFY items were resolved by codebase verification (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Accessible name is "Clear all" | User-suggested name verified against the existing clearLabel idiom — verb-first matches the color band's "Clear color"; Tip + aria-label pattern identical to BandHeader | S:85 R:90 A:95 D:85 |
| 2 | Confident | Color-only variant renders the clear-all (degenerates to clear color) | User default is yes for grammar consistency; codebase check found no structural reason omission is cleaner (a variant fork would itself add conditional chrome), so the default stands | S:80 R:85 A:60 D:55 |
| 3 | Certain | Ring rule computes from props (selectedValue/currentMarker/currentFlair), not preview overrides | Matches the band-header isUnset idiom exactly (swatch-popover.tsx BandHeader call sites); after a clear-all the caller echo makes panel − and band −s ring together, per the user's "ring together" decision | S:80 R:85 A:90 D:85 |
| 4 | Certain | No backend change — clear-all emits only existing clears | Verified internal/validate/validate.go: null color and "" marker/flair are the existing unset vocabulary in the closed sets; no new stored values exist in this design | S:85 R:90 A:95 D:90 |
| 5 | Confident | e2e window-marker-gutter.spec.ts changes are additive-or-none; unit tests carry the behavior coverage | Existing e2e queries cells by role/name, which an additive cell does not break; constitution requires the .spec.md sibling in the same commit if the spec is touched — plan decides at apply | S:70 R:85 A:80 D:70 |
| 6 | Certain | Memory targets are visual-design (anatomy + keyboard wording + ✕/− DD), status-signals (handoff anatomy sentence), sidebar (light touch) | Verified by grep: keyboard-model picker wording lives only in visual-design.md; status-signals § Change color… handoff and sidebar § Picker entry points are the other anatomy mentions | S:80 R:90 A:90 D:85 |
| 7 | Certain | Wiki sync ships the whole assets page including the "STUDY · A THIRD SHADE" section; the shade study itself stays out of scope | Explicit user decision — the page is one artifact; the third-shade section is documentation of a pending separate change | S:90 R:85 A:90 D:90 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
