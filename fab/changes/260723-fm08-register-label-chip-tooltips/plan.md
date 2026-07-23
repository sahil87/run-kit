# Plan: Tooltips for Sidebar Register Labels and Bottom-Bar Key Chips

**Change**: 260723-fm08-register-label-chip-tooltips
**Intake**: `intake.md`

## Requirements

### Frontend: Sidebar PANE-panel register-label tooltips

#### R1: PANE register labels carry tier-1 Tips
Each register LABEL in `app/frontend/src/components/sidebar/status-panel.tsx` SHALL be wrapped in a tier-1 `Tip` (from `app/frontend/src/components/tip.tsx`, unmodified) naming the register in plain words, `placement="right"`, hover-only (labels stay non-focusable spans — no new tab stops). Labels and copy: `tmx` → "tmux pane", `cwd` → "Working directory", `git` → "Git branch", `pr` → "Pull request" (both the `PrLinkRow` and no-URL `CopyableRow` branches), `out` → "Output activity", `agt` → "Agent state", `fab` → "Fab change". `CopyableRow` and `PrLinkRow` MUST gain a minimal label-wiring seam (a `tipLabel?: string` prop; the Tip wraps the prefix `<span>` only, never the row button/anchor). Row-value behavior (copy-on-click, anchor navigation, hover-accent, the transient `copied ✓` prefix swap) MUST be byte-equivalent in behavior; the cwd reveal `title=` and the PR-URL `title={prUrl}` state-reveal seams MUST stay untouched. The tips join the existing sidebar-root `TipGroup` (no new group).

- **GIVEN** a terminal window is selected and the PANE panel shows its registers
- **WHEN** the user hovers the `out` label past the open delay (or instantly while the sidebar cluster is warm)
- **THEN** a `role="tooltip"` quiet-card reading "Output activity" appears to the right of the label
- **AND** clicking a copyable row still copies its value and shows `copied ✓`

- **GIVEN** the cwd row (or the PR anchor row)
- **WHEN** the user hovers the row VALUE
- **THEN** the existing native `title` reveal (`activePaneCwd` / `prUrl`) still behaves exactly as before

### Frontend: HOST metric-label tooltips (shared component)

#### R2: HOST metric labels carry tier-1 Tips on both render surfaces
The metric label spans in `app/frontend/src/components/host-metrics.tsx` SHALL be wrapped in `Tip`s (`placement="right"`): `cpu` → "CPU usage", `mem` → "Memory usage", `dsk` → "Disk usage", `ld` → "Load average". Because the component is shared, both the sidebar HOST panel (`sidebar/host-panel.tsx`) and the Host overview dashboard (`host-overview-page.tsx`) gain them with no per-surface gating. The inline `up` sub-label on the `dsk` row gets NO tip. Label text content MUST be unchanged (e2e `sidebar-panels.spec.ts` / `host-health-home.spec.ts` match on `text=cpu`, `text=/^ld/`, etc.).

- **GIVEN** the sidebar HOST panel (or the Host overview metrics block) is rendered with a metrics snapshot
- **WHEN** the user hovers the `cpu` label
- **THEN** a tooltip reading "CPU usage" appears
- **AND** the sparkline/gauge/load values render exactly as before

### Frontend: Bottom-bar key-chip tooltips

#### R3: Bottom-bar symbol chips carry tier-1 Tips inside a new TipGroup
`app/frontend/src/components/bottom-bar.tsx` SHALL wrap its toolbar row in a `TipGroup` (inside the component, covering both render sites — app shell and board twin) and add `placement="top"` Tips to exactly these chips: ⇥ → "Tab"; ^ → "Ctrl for next key"; ⌥ → "Alt for next key" (behavior-describing one-shot-latch copy); F▴ → "Function keys"; `>_` → "Compose text"; ⌘K → label "Command palette" + `kbd="⌘K"`. The ArrowPad trigger (↑, `app/frontend/src/components/arrow-pad.tsx`) SHALL get a Tip labeled "Arrow keys". NO tips on: the F▴ menu's `role="menuitem"` entries (F1–F12, Esc, PgUp/PgDn/Home/End/Ins/Del), the arrow-popup's ↑←↓→ buttons, and the coarse-only ⌨/🔒 toggle. All `aria-label`s / `aria-pressed` wiring, the `preventFocusSteal` mousedown handling, the ArrowPad drag handlers, and the `KBD_CLASS` coarse touch targets MUST be preserved (Tip's clone-child API merges props without a wrapper element).

- **GIVEN** the terminal route with the bottom bar on a fine pointer
- **WHEN** the user hovers the ⌘K chip past the open delay
- **THEN** a tooltip shows "Command palette" with a ⌘K keycap chip
- **AND** clicking the chip still opens the palette (tip dismisses on activation)

- **GIVEN** the ^ modifier chip
- **WHEN** the user clicks it
- **THEN** the latch arms exactly as before (`aria-pressed=true`, accent styling) and the tooltip named it "Ctrl for next key"

#### R4: 73al contract conformance
The change SHALL add NO native `title=` anywhere, SHALL NOT modify `tip.tsx` or `StatusDotTip`, SHALL keep every existing `aria-label` byte-identical, and all tip labels SHALL be ≤40ch one-line sentence-cased control names (tier-1 taxonomy — no state lines, nothing interactive).

- **GIVEN** the full diff of this change
- **WHEN** it is inspected for `title=` additions or `tip.tsx`/`status-dot-tip.tsx` edits
- **THEN** none exist, and every new `Tip` `label` is a ≤40ch plain-words control name

### Tests

#### R5: Per-site unit tests, e2e cases, and the .spec.md companion
Unit tests SHALL be extended per the 73al idiom (wiring assertions per site; deep behavior stays in `tip.test.tsx`): `sidebar/status-panel.test.tsx` (≥1 register-label hover → tooltip), `host-metrics.test.tsx` (≥1 metric-label hover → tooltip), `bottom-bar.test.tsx` (⌘K chip → tooltip with kbd slot; a modifier-chip tip; no `title` attribute on tipped chips). `tests/e2e/tooltips.spec.ts` SHALL gain at least one register-label case and one bottom-bar chip case, and its sibling `tooltips.spec.md` MUST be updated in the same change (Constitution: Test Companion Docs). Inventoried existing selectors (`register-output`/`register-agent` testids, `getByText("tmx")`, `getByLabel("Open command palette")`, `Compose text`, `text=cpu`…) MUST all still pass.

- **GIVEN** the extended suites
- **WHEN** `just test-frontend` and `just test-e2e` run
- **THEN** the new assertions pass and no inventoried existing selector breaks

### Non-Goals

- No tips for the F▴ menu items, arrow-popup buttons, or the coarse-only ⌨/🔒 chip (visible text / coarse suppression make them noise or unreachable).
- No shortcut-registry wiring for the `kbd` slot (static string, 73al deferred follow-up).
- No fix for `scripts/build.sh`'s VERSION-file issue (known pre-existing; untracked-VERSION workaround only).
- No focusability change for register-label spans (hover-only, per the 73al connection-dot precedent).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add a `tipLabel?: string` seam to `CopyableRow` and `PrLinkRow` in `app/frontend/src/components/sidebar/status-panel.tsx` (Tip wraps the prefix span only, `placement="right"`, falsy label = pass-through), wire all call sites (`tmx`, `cwd`, `git`, `fab`, both `pr` branches), and wrap the plain-row labels (tmx no-paneId fallback, `out`, `agt`) directly <!-- R1 -->
- [x] T002 [P] Wrap the `cpu`, `mem`, `dsk`, `ld` label spans in `app/frontend/src/components/host-metrics.tsx` with `Tip` (`placement="right"`; labels "CPU usage" / "Memory usage" / "Disk usage" / "Load average") <!-- R2 -->
- [x] T003 [P] In `app/frontend/src/components/bottom-bar.tsx`: wrap the toolbar row in `TipGroup`; add `placement="top"` Tips to ⇥ ("Tab"), ^ ("Ctrl for next key"), ⌥ ("Alt for next key"), F▴ ("Function keys"), `>_` ("Compose text"), ⌘K ("Command palette" + `kbd="⌘K"`); leave menu items and the coarse-only ⌨/🔒 chip untouched <!-- R3 -->
- [x] T004 [P] Wrap the ArrowPad trigger button in `app/frontend/src/components/arrow-pad.tsx` with `Tip` label "Arrow keys" `placement="top"` (popup arrow buttons untouched) <!-- R3 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T005 Extend `app/frontend/src/components/sidebar/status-panel.test.tsx`: hover a register label (fake timers + `TIP_OPEN_DELAY_MS`) asserts the tooltip text; confirm copy-on-click and the `copied ✓` swap still pass alongside the tip wiring <!-- R5 -->
- [x] T006 [P] Extend `app/frontend/src/components/host-metrics.test.tsx`: hover the `cpu` label asserts a "CPU usage" tooltip; existing value assertions unchanged <!-- R5 -->
- [x] T007 [P] Extend `app/frontend/src/components/bottom-bar.test.tsx`: ⌘K chip hover asserts "Command palette" + `<kbd>` "⌘K"; a modifier chip asserts its latch tip label; tipped chips carry no native `title` <!-- R5 -->
- [ ] T008 Extend `app/frontend/tests/e2e/tooltips.spec.ts` with a mocked-backend describe (the `pane-register-panel.spec.ts` `mockStateSocket` idiom): ≥1 register-label hover case and ≥1 bottom-bar chip hover case; update `tests/e2e/tooltips.spec.md` in the same change <!-- R5 -->

### Phase 4: Polish (gates)

- [ ] T009 Run the verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, `just build` (untracked-VERSION workaround; verify any e2e failure against the known baseline flakes before treating it as caused here) <!-- R4 -->

## Acceptance

### Functional Completeness

- [ ] A-001 R1: Every PANE register label (`tmx`, `cwd`, `git`, `pr` both branches, `out`, `agt`, `fab`) shows its plain-words tier-1 tip on hover, placement right, via the `tipLabel` seam / direct span wraps
- [ ] A-002 R2: All four HOST metric labels show their tips in both the sidebar HOST panel and the Host overview dashboard (shared `host-metrics.tsx`, no per-surface gating)
- [ ] A-003 R3: The seven inventoried bottom-bar chips (⇥ ^ ⌥ F▴ ↑ `>_` ⌘K) show their tips with `placement="top"` inside a `TipGroup` local to `bottom-bar.tsx`; ⌘K carries the `kbd="⌘K"` keycap slot
- [ ] A-004 R5: Per-site unit assertions exist in `status-panel.test.tsx`, `host-metrics.test.tsx`, and `bottom-bar.test.tsx`; `tooltips.spec.ts` gains ≥1 register-label and ≥1 chip case with `tooltips.spec.md` updated in the same change

### Behavioral Correctness

- [ ] A-005 R1: Copy rows still copy on click with the `copied ✓` swap; the PR anchor still navigates; the cwd reveal `title=` (status-panel) and PR-URL `title={prUrl}` remain byte-untouched
- [ ] A-006 R3: Modifier latch chips still arm/consume one-shot (`aria-pressed` and accent styling unchanged); `preventFocusSteal`, ArrowPad drag handlers, and `KBD_CLASS` coarse touch targets are preserved

### Scenario Coverage

- [ ] A-007 R5: All inventoried existing selectors still pass — `register-output`/`register-agent` testids, `getByText("tmx")`, `getByRole name /pane 1\/1 %5/`, `getByLabel("Open command palette")`, `Compose text`, `text=cpu`/`text=mem`/`text=/^ld/`/`text=dsk`, `getByLabelText` in bottom-bar tests

### Edge Cases & Error Handling

- [ ] A-008 R4: No native `title=` added anywhere in the diff; `tip.tsx` and `status-dot-tip.tsx` are unmodified; every new label is ≤40ch sentence-cased; register spans stay non-focusable (no new tab stops); the coarse-only ⌨/🔒 chip and in-menu items have no Tip

### Code Quality

- [ ] A-009 Pattern consistency: New wrappers follow the 73al call-site idiom (clone-child `Tip`, per-region placement, warm clusters); naming/structure matches surrounding code
- [ ] A-010 No unnecessary duplication: `Tip`/`TipGroup` reused verbatim; no new tooltip machinery; the colored PR segment spans and row components keep their single-source shape

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `CopyableRow`/`PrLinkRow` always wrap the prefix span in `<Tip label={tipLabel}>` — the falsy-label pass-through carries the "no tip" case, so no conditional branching at the seam | Matches tip.tsx's documented conditional-tooltip idiom; smallest diff | S:70 R:95 A:90 D:85 |
| 2 | Confident | No `TipGroup` added inside `host-metrics.tsx`: sidebar HOST tips join the sidebar-root group; the Host overview metrics block runs standalone (300ms per tip, no warm cluster) | A nested group inside the sidebar would split the sidebar's warm cluster; a 4-tip dashboard block without warm sweep is acceptable and intake specifies no dashboard group | S:55 R:95 A:85 D:70 |
| 3 | Confident | Modifier-chip copy fixed as "Ctrl for next key" / "Alt for next key" (19/18 ch, sentence-cased) | Intake supplied these as the example wording with polish latitude; they describe the verified one-shot latch | S:75 R:95 A:90 D:80 |
| 4 | Confident | New e2e cases run in a separate fully-mocked describe inside `tooltips.spec.ts` (the `mockStateSocket` + `page.route` idiom from `pane-register-panel.spec.ts`) rather than real-tmux fixtures | Registers and bottom bar need a selected window; the mocked idiom is the established deterministic path for exactly these surfaces | S:65 R:90 A:85 D:75 |
| 5 | Confident | HOST unit assertions live in `host-metrics.test.tsx` (not `host-panel.test.tsx`) | Intake offers either; the labels live in `host-metrics.tsx`, so its colocated test is the right seam and covers both render surfaces | S:70 R:95 A:90 D:85 |
| 6 | Confident | ArrowPad's Tip wraps only the trigger button; the drag-vs-tap handlers ride through `getReferenceProps(child.props)` prop-merging unchanged | floating-ui composes existing handlers (proven across 73al's ~40 sites); popup buttons excluded by intake | S:70 R:90 A:85 D:80 |

6 assumptions (0 certain, 6 confident, 0 tentative).
