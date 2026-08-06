# Intake: Split Default Horizontal First

**Change**: 260806-2x2h-split-default-horizontal-first
**Created**: 2026-08-06

## Origin

Conversational — raised during a `/fab-discuss` session with a screenshot of the top-bar split control's ▾ direction menu:

> i want to change the default for switching window splitting, split vertically comes first, i want to ensure split horizontally comes first

Two scope decisions were confirmed interactively:

1. **Scope**: "Primary + menu order" — the split-button's primary click becomes Split horizontal (side-by-side) AND it is listed first in the ▾ menu and overflow menu (split-button convention keeps the default and the first row in sync). Not a menu-reorder-only change.
2. **Palette label inversion**: fix in the same change — the command palette's `Window: Split Vertical` / `Window: Split Horizontal` entries currently send the OPPOSITE `horizontal` boolean from the identically-named top-bar actions. Align the palette to the top-bar chip's semantics.

## Why

1. **Pain point**: the merged split control (`SplitControl`, 260731-oiho) hardwires split **vertical** (stacked top/bottom panes) as its primary-click default and lists it first in the direction menu. The user's dominant workflow is side-by-side panes, so the default is wrong for them — every side-by-side split costs an extra ▾ + menu-row click.
2. **The bug riding along**: two surfaces use the same labels with **opposite meanings**. The top-bar chip's "Split horizontal" sends `horizontal: true` (tmux `split-window -h`, side-by-side), but the command palette's `Window: Split Horizontal` sends `horizontal: false` (stacked) — and the board palette's `Board: Split Focused Pane Horizontal` likewise. This divergence is already documented in memory (`docs/memory/run-kit/ui-patterns.md`, the "documented top-bar-chip-vs-palette flag divergence, left out of scope" note) and in code comments (`board-page.tsx` ~line 818). Left unfixed, a user who learns "horizontal" from the chip gets the opposite split from the palette.
3. **Consequence of not fixing**: the default stays misaligned with actual use, and the label inversion keeps producing wrong-direction splits from the palette — a trust-eroding same-name-opposite-action bug.
4. **Why this approach**: standardize on the **chip's existing naming** (which matches its glyphs and tmux's own flag names: `-h` ⇒ "horizontal" ⇒ side-by-side) and swap the palette booleans to match, rather than relabeling the chip — the chip's glyph↔label↔flag mapping is the internally consistent one, and it is the surface the user sees most.

## What Changes

### Canonical direction semantics (unchanged API, one naming convention)

The backend contract is untouched: `POST /api/windows/{id}/split` with `horizontal: true` runs tmux `split-window -h` (new pane **beside** — side-by-side, vertical divider); `horizontal: false` runs `split-window -v` (new pane **below** — stacked). See `app/backend/internal/tmux/tmux.go:1810`.

After this change, every UI surface uses ONE naming convention (the chip's, matching tmux flag names):

| Label | Boolean | tmux | Result |
|---|---|---|---|
| **Split horizontal** | `horizontal: true` | `split-window -h` | side-by-side (NEW DEFAULT) |
| **Split vertical** | `horizontal: false` | `split-window -v` | stacked top/bottom |

### 1. SplitControl primary segment → horizontal (`app/frontend/src/components/top-bar.tsx` ~line 1961)

The primary segment currently calls `run(false)` with `SplitVerticalGlyph`, tooltip/aria-label "Split vertically". It becomes:

- `onClick={() => run(true)}`
- glyph: `SplitHorizontalGlyph` (the shared `top-bar-icons.tsx` definition — the primary segment must share the `data-icon="split-horizontal"` definition with its menu row, preserving the leading-glyph-parity contract from 260801-3q1z)
- `aria-label` / `Tip` label: "Split horizontally"
- spinner-while-pending behavior unchanged; the primary remains a **fixed** direction (not last-used) — only which direction is fixed flips.

### 2. SplitControl ▾ direction menu order (`top-bar.tsx` ~line 2013)

The `role="menu" aria-label="Split direction"` popover lists `Split horizontal` (with `SplitHorizontalGlyph`) FIRST, then `Split vertical`. Both rows keep their existing behavior (leading direction glyph, `disabled` dim while pending, `POPOVER_ROW_CLASS`). The menu continues to list BOTH directions (complete-option-set split-button convention).

### 3. Overflow-menu row order (`top-bar.tsx` registry `split` entry, ~line 572)

The registry entry's `menuRender` emits the `horizontal` `SplitMenuRow` first, then the vertical one — in BOTH terminal mode and board mode (the two branches of the same closure). `SplitMenuRow` itself is unchanged.

### 4. Doc comments declaring vertical "the long-standing default"

Update the load-bearing comments: `top-bar.tsx` ~lines 554–558 (registry entry: "primary click = split vertical (the long-standing default)") and ~lines 1890–1897 (`SplitControl` doc block: "PRIMARY segment: split VERTICAL (the long-standing default)") — both now describe horizontal as the primary with a note that the default flipped in this change.

### 5. Terminal palette boolean fix + order (`app/frontend/src/app.tsx` ~lines 1864–1877)

Swap the booleans so labels match the chip semantics, and list Horizontal first (default-first ordering):

```tsx
// before: split-vertical → executeSplit(..., true, ...); split-horizontal → executeSplit(..., false, ...)
{ id: "split-horizontal", label: "Window: Split Horizontal",
  onSelect: () => { if (sessionName) executeSplit(server, currentWindow.windowId, true, currentWindow.worktreePath); } },
{ id: "split-vertical", label: "Window: Split Vertical",
  onSelect: () => { if (sessionName) executeSplit(server, currentWindow.windowId, false, currentWindow.worktreePath); } },
```

### 6. Board palette boolean fix + order (`app/frontend/src/components/board/board-page.tsx` ~lines 818–835)

Same swap for the board palette pair: `Board: Split Focused Pane Horizontal` → `executeSplit(..., true, ...)` (side-by-side), `Board: Split Focused Pane Vertical` → `executeSplit(..., false, ...)`, Horizontal listed first. Delete/replace the comment block at ~line 818 that documents the divergence as "left out of scope" — the divergence is resolved by this change. Board keybinding handlers (if any bind these actions) follow the same mapping.

### 7. tmux shortcuts-overlay labels (`app/backend/api/keybindings.go` ~lines 22–23)

The keybinding whitelist currently labels `split-window -h` as "Split vertically" and `split-window -v` as "Split horizontally" — the opposite convention from the chip. Swap the two label strings so the shortcuts overlay teaches the same vocabulary:

```go
"split-window -h":      "Split horizontally",
"split-window -v":      "Split vertically",
```

### 8. Tests (update alongside, per constitution Test Integrity + `.spec.md` companion rules)

Unit/component:
- `app/frontend/src/components/top-bar.test.tsx` — the merged-SplitControl suite (~lines 844–869, 995–1070) asserts primary = "Split vertically" / `run(false)` and `data-icon="split-vertical"` on the primary + measurement probe (~lines 1393–1450); all flip to horizontal-first. The board-mode merged-control test (~line 855) asserts `splitWindow(..., false, ...)` on primary — becomes `true`.
- `app/frontend/src/components/shortcuts-overlay.test.tsx` — fixture maps `split-window -h` → "Split vertically" (~line 244); update fixture + assertions to the swapped labels.
- `app/frontend/src/components/command-palette.boards.test.tsx` — board split palette entries and their handler expectations.
- `app/backend/api/keybindings_test.go` — expected label list (~line 52) reflects the swapped whitelist labels.

Playwright e2e + `.spec.md` companions (same commit, per constitution):
- `tests/e2e/top-bar-overflow.spec.ts` (+ `.md`) — `L1: ["Split vertically"]` anchor (~line 50), menu-row assertions (~lines 248–293), `splitVertical()` anchor (~line 442) all key on the primary label; update to "Split horizontally" and horizontal-first row order.
- `tests/e2e/open-in-app.spec.ts` (+ `.md`) — `splitAnchor` keys on the "Split vertically" primary segment (~line 94).
- `tests/e2e/top-bar-refresh.spec.md` — prose references the "Split vertically" primary anchor (verify whether the `.spec.ts` also anchors on it).
- `tests/e2e/shortcut-registry.spec.ts` (+ `.md`) — tmux keybinding fixture/labels (~lines 60, 158–165) reflect the swapped `keybindings.go` labels.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Split control — primary segment is now horizontal (fixed, not last-used), ▾/overflow rows horizontal-first; § Right cluster L1 row and menu-row-representation notes ("primary click = vertical" → horizontal); the board-palette entry table row (~line 619) and any other "documented top-bar-chip-vs-palette flag divergence, left out of scope" notes — the divergence is resolved, all surfaces share one direction vocabulary; `top-bar.test.tsx` assertion summary (~line 1011) re primary sharing the split-vertical definition.

## Impact

- **Frontend**: `top-bar.tsx` (SplitControl, registry `split` entry, doc comments), `app.tsx` (terminal palette pair), `board/board-page.tsx` (board palette pair + comment). No new components, no API-client changes, no styling changes.
- **Backend**: `api/keybindings.go` — two label strings only. No handler, route, or tmux-layer changes; the `horizontal` boolean contract is untouched.
- **Tests**: 3 unit/component files + 1 Go test + up to 4 e2e specs with `.spec.md` companions (label-anchor updates, no behavioral test additions beyond swapped expectations).
- **No persistence**: split direction remains a fixed default — no localStorage preference, no settings surface.

## Open Questions

*(none — scope was resolved interactively; see Origin)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Default flips to Split horizontal on BOTH the primary click and first menu/overflow row | Discussed — user chose "Primary + menu order" over menu-order-only | S:95 R:90 A:95 D:95 |
| 2 | Certain | Palette label inversion fixed in this change, aligning palette booleans to the chip's semantics (chip naming is canonical) | Discussed — user chose "fix in same change"; chip glyph↔label↔tmux-flag mapping is the internally consistent convention | S:90 R:85 A:90 D:90 |
| 3 | Confident | Board palette pair (`Board: Split Focused Pane *`) gets the same boolean swap and ordering | Same inversion, same fix — user approved the palette fix generically; leaving the board pair inverted would recreate the bug on one surface | S:70 R:85 A:90 D:85 |
| 4 | Confident | `keybindings.go` whitelist labels swapped (`-h` → "Split horizontally", `-v` → "Split vertically") so the shortcuts overlay matches the new convention | Not explicitly discussed; follows directly from "one naming convention across surfaces" and is a two-string, easily-reverted edit | S:55 R:85 A:80 D:70 |
| 5 | Confident | Horizontal listed first in the palette entries too (terminal + board), mirroring the menus | Default-first ordering consistency; trivial to reorder later | S:70 R:90 A:85 D:85 |
| 6 | Certain | Backend `horizontal` boolean contract and tmux layer untouched — labels/wiring change at UI surfaces only | Constitution II/III: state and contracts derive from tmux; nothing in the request touches behavior below the UI | S:85 R:85 A:95 D:95 |
| 7 | Confident | Primary stays a FIXED direction (no last-used persistence) — only which direction is fixed changes | Preserves the existing documented design decision ("the primary is a fixed vertical split, not last-used"); adding persistence would be scope creep | S:70 R:90 A:85 D:85 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
