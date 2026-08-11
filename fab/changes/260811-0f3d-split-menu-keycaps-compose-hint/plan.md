# Plan: Split-Menu Keycaps + Compose Chip Placement & Hint

**Change**: 260811-0f3d-split-menu-keycaps-compose-hint
**Intake**: `intake.md`

## Requirements

### Frontend: Split-button keycaps (`app/frontend/src/components/top-bar.tsx`)

#### R1: SplitControl primary tip keycap
The SplitControl primary segment's `Tip` (`Split horizontally`) SHALL carry a `kbd` slot with the host-effective `split-horizontal` chord, derived from `useKeybindings().byAction` + `formatCombo(…, host.platform)`, and SHALL omit the keycap when the binding is unbound/disabled (the `open-button.tsx:101-109` / `260811-ke2s` pattern).

- **GIVEN** a terminal or board route with the split control rendered
- **WHEN** the user hovers the primary split segment on a fine pointer
- **THEN** the tip shows `Split horizontally` with the effective `split-horizontal` keycap (⇧⌘D on mac, Shift+Ctrl+\ elsewhere by default)
- **AND** when the `split-horizontal` binding is disabled via override, the tip shows no keycap

#### R2: Split direction-menu row keycaps
The two rows of the SplitControl direction popover SHALL each render a trailing right-aligned (`ml-auto`) `<kbd>` keycap showing the effective chord for their action (`split-horizontal` on the `Split horizontal` row, `split-vertical` on the `Split vertical` row), registry-derived and omitted when unbound/disabled. The chevron segment's Tip (`Split… (choose direction)`) SHALL remain keycap-free. The rows SHALL NOT wrap with keycaps present.

- **GIVEN** the split direction menu is open
- **WHEN** the rows render with default bindings
- **THEN** each row shows its label followed by a right-aligned muted keycap matching the palette rows' kbd visual weight (`command-palette.tsx:194-198`)
- **AND** with `split-vertical` disabled via override, the `Split vertical` row renders no keycap while the horizontal row keeps its own

### Frontend: Overflow-menu keycap audit (`app/frontend/src/components/top-bar.tsx` menu rows)

#### R3: Overflow rows with matching registry bindings gain keycaps
The chevron overflow menu's `SplitMenuRow` rows (`Split horizontal` / `Split vertical`, `top-bar.tsx:2450-2473`) SHALL render the same right-aligned keycap treatment as R2. Rows whose action has NO matching registry binding SHALL remain untouched.

- **GIVEN** the top-bar overflow chevron menu open on a terminal route at a narrow width (split entry overflowed)
- **WHEN** the `Window` section rows render
- **THEN** both split rows carry their right-aligned keycaps
- **AND** the ViewSwitcher, FixedWidth, TerminalFont, Autofit, Close-pane/Kill, Refresh, and Open rows render exactly as before (audit outcome: no registry binding matches their action — close-pane ≠ `kill-window`; per-view lens rows select a specific view while `view-cycle` only cycles; `open-last-used` re-runs only the last-used target, not an arbitrary row's target)

### Frontend: Bottom-bar chip order (`app/frontend/src/components/bottom-bar.tsx`)

#### R4: Palette chip precedes compose chip
In the bottom bar's fine-pointer chip run, the command-palette chip (`⌘K`) SHALL render BEFORE the compose chip (`>_`), making compose the rightmost of the pair. Both chips keep their existing tips, kbd slots, aria attributes, active styling, and `onOpenCompose` gating. The `ml-auto` far-right cluster (coarse-only ⌨/🔒 toggle) is untouched.

- **GIVEN** the bottom bar rendered with `onOpenCompose` provided
- **WHEN** the chip run renders
- **THEN** the `Open command palette` button precedes the `Compose text` button in DOM order
- **AND** both chips behave exactly as before (toggle compose, open palette)

### Frontend: Compose hint (`app/frontend/src/components/bottom-bar.tsx`)

#### R5: Compose education hint in the free space
When `onOpenCompose` is present, the compose strip is OFF (`composeStripEnabled === false`), the pointer is fine, and the viewport is wide (≥ `lg`), the bottom bar SHALL render a dimmed, non-interactive (`aria-hidden`) hint line in the free space right of the chip pair (before the `ml-auto` cluster): `>_ compose — type to the pane with autocorrect`, with the effective `compose-toggle` chord appended as a keycap when the binding is enabled (omitted when unbound, per the § Education micro-copy convention). The hint SHALL NOT render on coarse pointers, below the `lg` breakpoint, when the strip is on, or when there is no compose target, and SHALL NOT compromise the single-row 375px budget.

- **GIVEN** a fine pointer, viewport ≥ lg, strip off, `onOpenCompose` provided
- **WHEN** the bottom bar renders
- **THEN** the hint line is present with the compose chord keycap (Shift+Ctrl+E on Win/Linux, ⇧⌘E on mac)
- **AND** with the strip enabled, a coarse pointer, or no `onOpenCompose`, the hint is absent entirely

### Frontend: Tests

#### R6: Unit coverage for the changed surfaces
`bottom-bar.test.tsx` SHALL cover the chip order (palette before compose) and the hint's visibility branches (fine+wide+strip-off renders; strip on / coarse / no `onOpenCompose` absent). `top-bar.test.tsx` SHALL cover the split menu row keycaps (chord text present per row; omitted when the binding is unbound) and the primary tip's kbd slot.

- **GIVEN** the new implementation
- **WHEN** `just test-frontend` runs
- **THEN** the new assertions pass alongside the existing suite

### Non-Goals

- Open-button primary tip keycap — already shipped in #551 (`open-button.tsx:123`); intake assumption #1 marks it out of scope.
- A keycap on the SplitControl chevron tip — it opens a menu, there is no chord.
- Changing any default chords or adding new registry bindings.
- Playwright e2e changes — the `shortcut-registry` spec asserts only tmux-overlay `Split horizontally` labels, not the top-bar tips/rows, so no spec or `.spec.md` changes are required.

### Design Decisions

#### Content-sized split direction menu (`w-max`)
**Decision**: The SplitControl direction menu keeps its `min-w-[170px]` floor but gains `w-max` so its width is content-driven.
**Why**: The menu is absolutely positioned inside the tiny chip container, so without help it shrink-wraps and wraps rows; the existing `min-w` comment documents exactly this. `w-max` sizes the menu to its rows with keycaps present on every platform (short ⇧⌘D on mac, long Shift+Ctrl+\ elsewhere) without a per-platform fixed bump.
**Rejected**: A larger fixed `min-w` (e.g. 240px) — wastes space on mac where the keycaps are short, and still risks wrapping if copy changes.
*Introduced by*: 260811-0f3d-split-menu-keycaps-compose-hint

#### Compose hint hidden once the strip is on
**Decision**: The hint renders only while `composeStripEnabled === false`.
**Why**: The hint is educate-toward copy — once the strip is open the feature has been found and the hint is redundant noise.
**Rejected**: Always-on hint (reads as a label, not education); first-run/dismissal tracking (violates the stateless-hints rule in § Education micro-copy).
*Introduced by*: 260811-0f3d-split-menu-keycaps-compose-hint

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/frontend/src/components/top-bar.tsx` — SplitControl: add `kbd` (registry-derived `split-horizontal` chord) to the primary segment Tip; add trailing `ml-auto` keycaps to both direction-menu rows; add `w-max` to the menu container so rows never wrap; chevron tip stays keycap-free <!-- R1 -->
- [x] T002 [P] `app/frontend/src/components/bottom-bar.tsx` — swap the chip pair so the palette chip renders first and the compose chip last; add the compose hint line (gates: `onOpenCompose` present, strip off, `useCoarsePointer()` false, `hidden lg:flex`; `aria-hidden`, non-interactive, keycap omitted when `compose-toggle` unbound) <!-- R4 -->
- [x] T003 `app/frontend/src/components/top-bar.tsx` — SplitMenuRow: add the same trailing keycap per direction (registry-derived, omitted when unbound); record the audit outcome for the remaining overflow rows (untouched) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 `app/frontend/src/components/bottom-bar.test.tsx` — chip-order assertion (palette before compose in DOM) + hint visibility branches (renders fine/wide/strip-off; absent when strip on, coarse via `stubMatchMedia`, no `onOpenCompose`; keycap omitted when `compose-toggle` disabled) <!-- R5 -->
- [x] T005 [P] `app/frontend/src/components/top-bar.test.tsx` — split keycap assertions: primary tip kbd, both popover rows' chord text, overflow SplitMenuRow keycaps, omission when a binding is disabled (localStorage `runkit-keybindings` override) <!-- R1 -->
- [x] T006 Run `just test-frontend` and `cd app/frontend && npx tsc --noEmit`; fix any failures (tests conform to the implementation spec, never the reverse) <!-- R6 -->

## Execution Order

- T001 before T005 (tests assert the implementation); T002 before T004; T003 before T005
- T001/T003 share `top-bar.tsx` — run sequentially despite the file split; T002 is the only true parallel candidate
- T006 runs last, after all implementation and test tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: SplitControl primary tip shows the host-effective `split-horizontal` keycap; omitted when the binding is disabled
- [x] A-002 R2: Both direction-menu rows show right-aligned keycaps with their effective chords; the chevron tip has none; rows do not wrap
- [x] A-003 R3: Overflow-menu split rows carry keycaps; all other overflow rows are unchanged
- [x] A-004 R4: Bottom bar renders palette chip before compose chip; all chip behavior/aria/tips preserved
- [x] A-005 R5: Compose hint renders with the effective compose chord keycap under all four gates, and only then
- [x] A-006 R6: New unit tests cover chip order, hint branches, and split keycap presence/omission; `just test-frontend` and `tsc --noEmit` pass

### Behavioral Correctness

- [x] A-007 R4: Both chips keep tips, kbd slots, aria, active styling, and `onOpenCompose` gating after the reorder
- [x] A-008 R5: Hint is absent when the strip is on, the pointer is coarse, the viewport is below `lg`, or `onOpenCompose` is absent; the 375px single-row budget is unaffected (hint is `hidden` below `lg`)

### Scenario Coverage

- [x] A-009 R2: Unbound-omission scenario exercised — disabling `split-vertical` removes only that row's keycap
- [x] A-010 R5: Unbound-omission scenario exercised — disabling `compose-toggle` drops the hint's keycap while the text stays

### Edge Cases & Error Handling

- [x] A-011 R3: Overflow rows without matching registry bindings (close-pane/Kill, view lens rows, Open target rows, fixed-width, terminal-font, autofit, refresh) render no keycaps
- [x] A-012 R2: mac tier chords (⌘D / ⇧⌘D via `macCode`) resolve correctly through the same `formatCombo(…, host.platform)` path (unit-level; e2e runs Linux)

### Code Quality

- [x] A-013 Pattern consistency: keycap derivation follows the established inline `useKeybindings()` + `formatCombo` + enabled-else-`undefined` pattern (no new shared helper); hint follows the § Education micro-copy convention
- [x] A-014 No unnecessary duplication: palette-row kbd class composition reused for the menu-row keycaps; existing `chordFor` derivation in `bottom-bar.tsx` reused for the hint
- [x] A-015 Tests: new behavior covered by colocated unit tests per `code-quality.md` (no e2e needed — no existing spec asserts the touched strings)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new rendering (menu-row keycaps, primary-tip kbd, compose hint) without making any existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Hint hides below the `lg` breakpoint via `hidden lg:flex` (CSS) plus a `useCoarsePointer()` JS gate | Intake proposes `hidden lg:flex` with breakpoint at apply's judgment; lg (1024px) is where the top bar's own degradation ladder stops hiding chrome, and the 375px budget is the hard constraint | S:70 R:95 A:80 D:75 |
| 2 | Confident | Split direction menu sized with `w-max min-w-[170px]` instead of a fixed min-width bump | Content-sizing never wraps rows on any platform and wastes no space on mac's short chords; trivially reversible | S:55 R:90 A:80 D:70 |
| 3 | Certain | Overflow-menu audit outcome: only the two split rows match a registry binding; all other rows untouched | Verified against `lib/keybindings.ts` DEFAULT_BINDINGS — close-pane ≠ `kill-window`, view rows select a lens while `view-cycle` only cycles, `open-last-used` covers only the last-used target, fixed-width/font/autofit/refresh unbound | S:80 R:95 A:90 D:85 |
| 4 | Confident | Hint text renders even when `compose-toggle` is unbound — only the keycap is omitted | Matches the § Education micro-copy clause-omission rule (the clause drops, the pointer path remains); reversible copy decision | S:60 R:95 A:75 D:65 |
| 5 | Certain | Keycap chips reuse the palette-row kbd class composition (`text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border`) with `ml-auto`; rows keep their `gap-2` minimum separation | Intake names this exact visual target; both row classes already carry `gap-2` | S:85 R:90 A:90 D:85 |
| 6 | Confident | Copy kept as proposed: `>_ compose — type to the pane with autocorrect` | Intake marks copy as tunable but the proposal already names the required facts (compose, typing to the pane, autocorrect) | S:75 R:95 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
