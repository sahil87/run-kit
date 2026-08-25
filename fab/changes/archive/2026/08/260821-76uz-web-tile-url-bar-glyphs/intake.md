# Intake: Web Tile URL-Bar Glyphs Join the ControlGlyph Register

**Change**: 260821-76uz-web-tile-url-bar-glyphs
**Created**: 2026-08-21

## Origin

Promptless dispatch (synthesized from a user conversation; created via the `/fab-proceed` create-new path). The user reviewed a rendered two-theme mock (current vs proposed, dark + light) and **approved the proposed variant (B)**. This is the follow-up explicitly noted as out-of-scope by the merged change `260820-pjqd-tile-verb-button-visibility` (archived-pending on main via PR #688) — its intake.md:75 records: "unifying their unicode glyphs onto the same SVG register is a noted follow-up, **not** part of this change."

> Web-tile URL-bar glyphs join the ControlGlyph SVG register: replace the URL bar's five unicode glyph buttons (Back ◀, Forward ▶, Refresh ↻, Find ⌕, Open in browser ↗) with 14px `ControlGlyph` register SVGs — reusing `RefreshGlyph` and `FindGlyph`, adding `web-back` / `web-forward` / `open-external` — and add the tile-verb `hover:text-text-primary` hover brighten. Geometry and behavior unchanged. The user framed it as "button fixes... just like the terminal" (the pjqd change was pinned `fix`).

## Why

1. **The pain point**: The web tile's URL bar (`app/frontend/src/components/iframe-window.tsx` ~495–580) renders its five buttons as unicode `<span class="text-sm">` glyphs (`&#x25c0;` `&#x25b6;` `&#x21bb;` `&#x2315;` `&#x2197;`) inside 28×28 buttons. Since pjqd shipped, the tile header directly above renders its find/export/zoom/promote/swap/close verbs as 14px `ControlGlyph` SVGs from `app/frontend/src/components/top-bar-icons.tsx` — so the URL bar's thin, platform-font-dependent glyph ink now visibly mismatches the SVG verbs one row up. Unicode glyph rendering varies by platform font stack; SVG strokes are deterministic.
2. **NOT a contrast/size repair**: 28×28 ≥ SC 2.5.8 minimum; full-opacity `text-text-secondary` passes 1.4.11/AA. Size and contrast are FINE and unchanged. This is glyph-consistency polish only.
3. **If we don't fix it**: two glyph vocabularies coexist inside one tile's chrome — the exact drift the shared control-glyph register exists to prevent ("one glyph vocabulary across the chrome", top-bar memory § Shared top-bar control glyphs).
4. **Why this approach**: the register already hosts `RefreshGlyph` and `FindGlyph` (the latter added by pjqd for the tty tile), so refresh and find get one identity across surfaces for free; the three missing verbs (back/forward/open-external) join as new register members following the module's established conventions, keeping the register the single glyph source.

## What Changes

### 1. Three new glyph exports in `app/frontend/src/components/top-bar-icons.tsx`

All three on the `ControlGlyph` wrapper's 24-viewBox / strokeWidth-2 / round-caps-and-joins defaults, `currentColor`, `aria-hidden`, `shrink-0`, kebab-case `data-icon` test seam, doc comments in the file's idiom (lucide source named, consumer named). Export names may follow the register's naming judgment; the **`data-icon` values below are the stable test seam** (user-approved, do not change):

| Export (suggested) | `data-icon` | Design (paths verbatim) |
|---|---|---|
| `WebBackGlyph` | `web-back` | lucide arrow-left: `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>` |
| `WebForwardGlyph` | `web-forward` | lucide arrow-right: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>` |
| `OpenExternalGlyph` | `open-external` | lucide arrow-up-right: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>` |

### 2. `iframe-window.tsx` URL bar swaps its five `<span>` glyphs for register SVGs

At `app/frontend/src/components/iframe-window.tsx` ~495–580, per button:

| Button | Today (`<span className="text-sm">`) | New child |
|---|---|---|
| Back | `&#x25c0;` ◀ | `<WebBackGlyph />` (NEW) |
| Forward | `&#x25b6;` ▶ | `<WebForwardGlyph />` (NEW) |
| Refresh | `&#x21bb;` ↻ | `<RefreshGlyph />` (REUSE — top-bar refresh parity) |
| Find | `&#x2315;` ⌕ | `<FindGlyph />` (REUSE — one find identity across tty tile and web tile) |
| Open in browser | `&#x2197;` ↗ | `<OpenExternalGlyph />` (NEW) |

### 3. Hover brighten — the tile-verb hover contract

Add `hover:text-text-primary` to all five URL-bar buttons (the tile-verb hover brighten the surface-layout verb buttons carry, e.g. `surface-layout.tsx:1428/1446/1532/1542/1570`), KEEPING the existing `hover:bg-bg-card`. The find button keeps its open state exactly: `text-accent-green` when `findOpen` else `text-text-secondary`, plus `aria-pressed={findOpen}`.

### 4. Everything else untouched (behavior that MUST survive)

- Geometry: `w-7 h-7` (28×28) buttons, `shrink-0 flex items-center justify-center rounded`, bar layout, button order ◀ ▶ ↻ [address] ⌕ ↗.
- Back/Forward hidden on cross-origin frames (`!crossOrigin` guard).
- All aria-labels: `Back` / `Forward` / `Refresh` / `Find in page` / `Open in browser`.
- All `Tip` labels and the warm-tip `TipGroup` cluster.
- All click handlers (`navigateFrameHistory(±1)`, `handleRefresh`, `setFindOpen` toggle, `handleOpenExternal`).
- The address input, its edit/display split, and the `role="alert"` error span.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window → URL Bar — the per-button glyph claims (◀ `&#x25c0;` / ▶ `&#x25b6;` / ↻ `&#x21bb;` / ⌕ `&#x2315;` / ↗ `&#x2197;` described inline at bullets ~14–18) become the register SVGs (`web-back`/`web-forward`/`refresh`/`find`/`open-external`); the refresh bullet's styling string gains `hover:text-text-primary`. Also: the file's tty-find prose parenthetical claiming the web tile "still renders unicode ⌕ in its own URL bar" (the pjqd-era wording — sweep § Surface Layout → tile chrome/find) is stale and must be rewritten: both surfaces now render `FindGlyph`.
- `run-kit/ui/top-bar`: (modify) § Shared top-bar control glyphs — register membership grows by three (`web-back`, `web-forward`, `open-external` added to the export enumeration and the `data-icon` seam list — the section currently says "fourteen components", so 14 → 17 in that enumeration's own counting, which excludes the separately-documented `LayoutGlyph`/`LayoutShapeGlyph`); the web-tile URL bar joins the consumers prose (a third consumer class beside in-bar and menu/popover: tile chrome).
- The pjqd follow-up notes in memory/intake are satisfied by this change.

## Impact

- `app/frontend/src/components/top-bar-icons.tsx` — +3 exports (new glyphs only; the wrapper and existing exports untouched).
- `app/frontend/src/components/iframe-window.tsx` — URL-bar button children + className hover addition; no logic changes.
- `app/frontend/src/components/iframe-window.test.tsx` — the tests at ~:517 ("renders ◀ ▶ ↻ ⌕ ↗ on a same-origin tile") and ~:364 (⌕ button reference) name the glyphs in their TITLES but already select by aria-label (`getByLabelText`), so they pass unchanged; sweep the file for any textContent/glyph-string assertions (none found on these buttons in pre-intake grounding) and add `svg[data-icon="…"]` seam assertions per the pjqd precedent (surface-layout.test.tsx migrated its ⛶ assertion to `svg[data-icon="zoom"]`) so glyph identity is proven, not just button presence.
- E2E: `web-tile-find.spec.ts`, `web-view-lens.spec.ts` locate by aria-label — expected to pass unchanged. Constitution (Test Companion Docs): `.spec.md` sibling updates only if a `.spec.ts` is actually touched.
- No backend, API, routing, or layout changes. Glyphs are `currentColor` — theme tokens unchanged, so both themes inherit correctness.

**Out of scope**: behavior/layout changes; contrast/size changes (already passing); the code-surface tile (no URL bar) and chat view.

**Verification**: frontend Vitest (iframe-window suite first, then full), `tsc --noEmit`, `just test-e2e` for `web-tile-find.spec.ts` + `web-view-lens.spec.ts`; both-theme visual check optional.

**Change type**: pinned `fix` explicitly (`fab status set-change-type`) — parity with pjqd (the user framed both as button fixes); pinning prevents refresh-seam re-inference flips.

## Open Questions

- None — the user approved a rendered mock specifying glyph designs, data-icon names, and the hover treatment.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace the five unicode glyphs with register SVGs: reuse `RefreshGlyph`+`FindGlyph`, add three new exports with the exact lucide paths above | Discussed — user viewed the two-theme mock and approved variant B with these designs | S:95 R:85 A:95 D:95 |
| 2 | Certain | `data-icon` values `web-back`/`web-forward`/`open-external` are the stable test seam; export NAMES follow the register's naming judgment | Description fixes the seam explicitly and delegates only naming | S:90 R:90 A:90 D:90 |
| 3 | Certain | Add `hover:text-text-primary` keeping `hover:bg-bg-card`; find keeps `text-accent-green` open state + `aria-pressed` | Discussed — the tile-verb hover contract named in the approved design | S:95 R:90 A:90 D:95 |
| 4 | Certain | Geometry, order, cross-origin hiding, handlers, aria-labels, Tips all untouched | Description enumerates the must-survive set verbatim | S:95 R:90 A:95 D:95 |
| 5 | Confident | Pin change_type `fix` via `set-change-type` | User framed as "button fixes... just like the terminal"; pjqd (the precedent change) was pinned `fix`; description says "prefer fix" | S:80 R:90 A:85 D:80 |
| 6 | Confident | Test migration = ADD `data-icon` seam assertions (pjqd precedent); no textContent rewrites needed — grounding found the existing tests select by aria-label only | Verified against iframe-window.test.tsx:517/:364 during intake; glyphs appear only in test titles | S:75 R:90 A:85 D:80 |
| 7 | Confident | Hydrate reconciles the top-bar memory's export count against the actual file: the "fourteen components" enumeration excludes `LayoutGlyph`/`LayoutShapeGlyph` (documented separately in the same section), so the growth is 14 → 17 in that enumeration's terms | Grounded: top-bar-icons.tsx has 16 exports today; memory's count is a scoped enumeration, not a file total | S:65 R:85 A:80 D:70 |
| 8 | Confident | E2E specs pass unchanged (aria-label locators), so no `.spec.md` sibling updates unless a `.spec.ts` is touched | Constitution's companion rule triggers only on `.spec.ts` edits; description confirms | S:80 R:90 A:85 D:85 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
