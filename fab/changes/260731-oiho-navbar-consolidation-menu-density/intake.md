# Intake: Navbar Consolidation — Uniform Control Sizing, History-Nav Move, Control Demotion, Menu Density

**Change**: 260731-oiho-navbar-consolidation-menu-density
**Created**: 2026-07-31

## Origin

Synthesized from a design discussion with the user (dispatched promptless via `/fab-proceed`). The user reviewed an HTML mock and explicitly chose **"Variant B + menu density fix"** — five concrete decisions covering the top bar (`app/frontend/src/components/top-bar.tsx`) and the overflow menu (`app/frontend/src/components/top-bar-overflow-menu.tsx`). Frontend-only; no backend changes.

> navbar consolidation — uniform control sizing, history-nav move, control demotion, menu density. Five decisions: (1) one shared fixed-size button token; (2) move HistoryNav ◀ ▶ to the left cluster; (3) merge the two split buttons into one split control with a ▾ affordance; (4) demote terminal-font, fixed-width, and close-pane via `menuOnly: true`; (5) overflow-menu density restyle with section labels.

The user's original complaint: the sidebar toggle renders visibly smaller than the right-cluster buttons because the shared icon-button styling uses `min-*` floors, so rendered sizes drift with content.

**Rejected alternatives** (from the discussion):
- Deleting the Aa/fixed-width registry entries outright — rejected in favor of reversible `menuOnly` demotion (reverting = deleting the flag).
- Keeping ◀ ▶ in the center heading box — rejected (macOS convention favors the left cluster, and moving them deletes the width-compensation anchor hack).
- "Variant A" (uniform sizing + history-nav move + Aa demotion only, 7 controls kept) — the user explicitly chose the further-reduced Variant B.

## Why

1. **Pain point**: The icon-button class string `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border ...` is copy-pasted ~8× through top-bar.tsx. Because `min-*` is only a floor, rendered sizes drift with content — the sidebar toggle renders visibly smaller than the right cluster. The bar also hosts too many permanent controls: two sticky per-device preferences (Aa, fixed-width) that don't earn permanent slots, and a destructive ✕ sitting one slot from Refresh (misclick trap). The overflow menu rows are looser (`text-sm px-3 py-2`) than the rest of the chrome, and the menu has grown enough rows to need grouping.
2. **Consequence of not fixing**: visible size inconsistency in the primary chrome persists; every future control copy-pastes the class string and drifts further; the ✕-next-to-Refresh misclick trap remains; the overflow menu keeps getting taller and harder to scan as more entries demote into it.
3. **Why this approach**: one shared constant with a FIXED square size eliminates drift structurally (not per-callsite); `menuOnly: true` demotion is the proven reversible mechanism (exact precedent: view-switcher, change 260722-n2n4 — one flag, revert = delete the flag); the split-button merge follows the in-bar `OpenButton` precedent (260722-6d0f); moving ◀ ▶ left follows macOS convention (sidebar toggle → back → forward → brand crumb) and deletes a documented width-compensation hack rather than preserving it.

## What Changes

### 1. One shared button-size token (fixed square)

Extract ONE shared constant (e.g. `TOP_BAR_BUTTON`) with a **fixed** square size — **28×28 on fine pointers** (mocked and approved), keeping the **`coarse:` 30px** touch variant per the existing convention — and apply it to every top-bar control so all boxes render identical.

Current duplication sites in `top-bar.tsx` (verified at HEAD):
- HistoryNav `arrowClass` (~line 232)
- sidebar toggle (~line 773)
- SplitButton ×2 (~lines 1857, 1944)
- FixedWidthToggle (~line 2020)
- font-trigger (~line 2112), close (~line 2268), refresh (~line 2331)
- font-stepper class constant (~line 2435)

Plus in `top-bar-overflow-menu.tsx`: the chevron trigger (~line 310) and the menu's stepper buttons (~line 405).

The duplicated string being replaced (representative form):
```
rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center
```

The replacement uses fixed dimensions (e.g. `w-[28px] h-[28px] coarse:w-[30px] coarse:h-[30px]`, or `size-*` equivalents) so content can no longer stretch a box. Per-callsite variations (disabled states, color overrides, `shrink-0`) compose around the shared constant. The brand crumb (`min-h-[24px]` + `LINK_CRUMB_CLASS`) is normalized to the same height axis so the left cluster aligns.

Note: `docs/memory/run-kit/ui-patterns.md` and `fab/project/context.md` document the current "24px fine / 30px coarse" convention — the memory file updates at hydrate; the sizes change to "28px fine / 30px coarse".

### 2. Move HistoryNav ◀ ▶ to the LEFT cluster

Move the back/forward pair from the center heading box to the left cluster, immediately right of the sidebar toggle (macOS convention: sidebar toggle → back → forward → brand crumb). Arrows remain on ALL four modes (Host / Server / Terminal / Board); on Host mode (no sidebar toggle) they sit before the brand crumb.

This **deletes the center box's width-compensation hack**: HistoryNav's `mr-2.5` exists solely to offset HeadingPrefix's `-mr-1` so the pair is width-neutral inside the `sm:min-w-[28ch]` anchor box (documented in top-bar.tsx ~line 236, referencing the stable-anchor e2e). With the arrows gone from the center box, both the `mr-2.5` and the compensation comment go away; the heading anchor logic simplifies.

Test impact: the e2e describe block **"Top-bar heading — anchor, hierarchy dropdown, history arrows (260714-uco1)"** in `app/frontend/tests/e2e/window-heading.spec.ts` asserts the arrows' placement/behavior and the heading anchor — those specs (and `window-heading.spec.md`, per constitution § Test Companion Docs) must move/update with the change. Sweep `app/frontend/tests/e2e/` for other chrome assertions before moving elements (known project failure mode — Playwright specs assert chrome details that Vitest won't catch).

### 3. Merge the two split buttons into one split control

Collapse the `split-vertical` (~line 518) and `split-horizontal` (~line 539) registry entries into **one** entry rendering a single split control: **primary click = split vertical** (current default) plus a small **▾ affordance for split horizontal** (split-button pattern; the in-bar `OpenButton` — 260722-6d0f, with `aria-haspopup`/`aria-expanded` — is the precedent, ~line 2061 comment).

- The overflow menu keeps **BOTH** actions as rows (menu rows stay one-action-per-row).
- Board mode uses the same split controls against `focusedPane` (wired from `components/board/board-page.tsx` via `useRegisterTopBarSlot`, ~lines 994–1041) — **behavior parity must hold**, including the board keybindings that call `executeSplit` directly (~lines 810/817), which are independent of the in-bar buttons.
- The fit machinery's documented invariants (probe/registry index alignment, pyramid L1→L2→L3 drop order, exempt chevron) must stay correct with one fewer L1 entry — the merged entry takes a single L1 slot and a single probe segment.

### 4. Demote three controls via `menuOnly: true`

Set `menuOnly: true` on three registry entries (exact precedent: the view-switcher entry, 260722-n2n4 — one flag; reverting = deleting the flag):

- `terminal-font` (Aa, ~line 568) — sticky per-device preference; already in the settings dialog AND the palette (`Increase/Decrease/Reset terminal font` actions, app.tsx ~lines 2094–2096).
- `fixed-width` (~line 560) — sticky per-device preference.
- `close-pane` (✕, ~line 589) — destructive, sat one slot from Refresh (misclick trap).

**Coverage invariant (Constitution V, keyboard-first)**: every demoted action must remain reachable via the command palette and the chevron menu. Board mode's ✕ is the consequence-gated **Kill** — demotion applies uniformly there too: the Kill row in the menu keeps the `onRequestKill` confirm-dialog path (with its `Unpin instead` option).

The board-only `autofit` entry (~line 574) is NOT in the demotion list and stays in-bar unchanged.

**End state of the right cluster in terminal mode**: **Open · Split(▾) · Refresh · chevron** (+ UpdateChip when a qualifying update exists). The overflow fit machinery (probe/registry index alignment, `menuOnly` exclusion from the fit budget and the measurement probe) must stay correct — the existing `menuOnly` plumbing (fitCandidates filter ~line 650, probe exclusion ~line 1057, menu-row inclusion ~line 723) already handles all of this; the change is flag flips plus the split-entry merge.

### 5. Overflow-menu density restyle

In `top-bar-overflow-menu.tsx`:

- `MENU_ROW_BASE` (~line 46, feeding `MENU_ROW_CLASS` ~line 53) goes from `text-sm px-3 py-2` to **`text-xs px-2.5 py-1.5`**.
- The two other row styles in that file match the same scale: the update/version rows (~line 363) and the version copy button (~line 392) — currently hardcoding `px-3 py-2 text-sm`.
- The version row and the font-stepper row restyle to the denser scale.
- Add **thin uppercase section labels** grouping rows (e.g. **View / Window / App**) using the existing divider styling (`border-t border-border my-1`, ~line 352).
- Right-aligned shortcut hints on rows were mocked as **optional polish — nice-to-have, not core scope**.

Consumers of `MENU_ROW_CLASS`/`MENU_ROW_BASE` outside this file (e.g. `ViewSwitcherMenuRows` in `view-switcher.tsx`) inherit the density change automatically — that is intended (uniform menu density).

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome — new shared fixed-size button token (28px fine / 30px coarse), HistoryNav in the left cluster (anchor hack deleted), merged split control, `menuOnly` demotions (terminal-font, fixed-width, close-pane/Kill), overflow-menu density + section labels, right-cluster end state.

## Impact

- `app/frontend/src/components/top-bar.tsx` — shared button constant, HistoryNav relocation, split-entry merge, `menuOnly` flips, fit/probe comment updates.
- `app/frontend/src/components/top-bar-overflow-menu.tsx` — `MENU_ROW_*` density, section labels, version/stepper row restyle, chevron trigger sizing.
- `app/frontend/src/components/view-switcher.tsx` — inherits `MENU_ROW_CLASS` density (verify rendering only).
- `app/frontend/src/components/board/board-page.tsx` — inventory, not just app.tsx: the board route wires the same TopBar via `useRegisterTopBarSlot` props (`focusedPane`, `onRequestKill`) — known project failure mode: changes that inventory only app.tsx + feature page miss the board twin.
- Unit tests: colocated `*.test.tsx` for touched components.
- E2E tests (+ `.spec.md` companions in the same commit, per constitution): `window-heading.spec.ts` (history-arrows describe block, heading anchor), `top-bar-overflow.spec.ts`, `top-bar-refresh.spec.ts`, `top-bar-overlap.spec.md`/`.ts`, board specs referencing splits/✕ (`board-close-and-unpin`, `board-autofit`, `board-reorder`), `open-in-app.spec.ts`, plus a full sweep of `app/frontend/tests/e2e/` for chrome assertions (titles/aria/dots).
- No backend changes; no route changes; no API changes.
- Verification gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, e2e via `just test-e2e` / `just pw` (never direct playwright — port 3020 isolation).

## Open Questions

- None — the design discussion resolved all decision points; remaining choices are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One shared constant (e.g. `TOP_BAR_BUTTON`) with FIXED 28×28 fine / `coarse:` 30×30, applied to every top-bar control; brand crumb normalized to the same height axis | Discussed — user approved the 28px mock; fixes the min-floor drift complaint at the root | S:95 R:85 A:90 D:90 |
| 2 | Certain | HistoryNav ◀ ▶ moves to the left cluster right of the sidebar toggle (before brand crumb on Host); arrows stay on all four modes; `mr-2.5`/`-mr-1` width-compensation hack deleted | Discussed — user chose the macOS-convention placement over keeping arrows in the center box | S:95 R:80 A:90 D:95 |
| 3 | Certain | `split-vertical` + `split-horizontal` registry entries collapse to ONE split control: primary click = vertical, ▾ affordance = horizontal; menu keeps both rows; `OpenButton` is the pattern precedent | Discussed — explicit Variant B decision; precedent exists in the same bar | S:90 R:75 A:85 D:85 |
| 4 | Certain | Demote exactly `terminal-font`, `fixed-width`, `close-pane` via `menuOnly: true` (260722-n2n4 precedent); palette + chevron-menu coverage invariant holds; board Kill row keeps the `onRequestKill` dialog path | Discussed — user chose reversible menuOnly demotion over entry deletion; Constitution V coverage named explicitly | S:95 R:90 A:90 D:90 |
| 5 | Certain | Menu density: `MENU_ROW_BASE` `text-sm px-3 py-2` → `text-xs px-2.5 py-1.5`; the two hardcoded row styles (~lines 363, 392) and the font-stepper/version rows match the same scale | Discussed — exact values specified in the approved mock | S:95 R:90 A:95 D:90 |
| 6 | Certain | Terminal-mode right-cluster end state is Open · Split(▾) · Refresh · chevron (+ UpdateChip when qualifying); `menuOnly` entries stay excluded from the fit budget and probe | Discussed — end state stated verbatim; existing menuOnly plumbing already implements the exclusion | S:90 R:85 A:90 D:90 |
| 7 | Certain | E2E specs and their `.spec.md` companions update in the same commit; sweep `tests/e2e/` for chrome assertions before moving elements | Constitution § Test Companion Docs + known project failure mode named in the discussion | S:85 R:70 A:85 D:85 |
| 8 | Certain | Board-only `autofit` entry stays in-bar unchanged | Discussed demotion list is exactly three entries; autofit was never mentioned | S:80 R:85 A:85 D:80 |
| 9 | Confident | Menu section labels grouped as View / Window / App (thin uppercase, existing divider styling); exact row-to-group assignment decided at apply | Discussion gave the grouping as an example ("e.g."); trivially reversible styling | S:60 R:90 A:70 D:55 |
| 10 | Confident | Right-aligned shortcut hints on menu rows are OUT of core scope (optional polish; may be added only if trivial, never at the cost of the five core decisions) | Discussed — explicitly "nice-to-have, not core scope" | S:70 R:95 A:75 D:65 |
| 11 | Confident | Merged split entry takes a single L1 pyramid slot (split-vertical's position); probe index alignment preserved with one fewer entry | Follows from the fit machinery's documented invariants; verified plumbing exists | S:65 R:70 A:80 D:75 |
| 12 | Confident | Board keybindings that call `executeSplit` directly (board-page.tsx ~810/817) are untouched; split behavior parity on board mode via `focusedPane` props | Bindings are independent of the in-bar buttons; parity requirement stated in discussion | S:85 R:75 A:80 D:80 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
