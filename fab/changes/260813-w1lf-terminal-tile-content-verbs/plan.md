# Plan: Terminal Tile Content Verbs

**Change**: 260813-w1lf-terminal-tile-content-verbs
**Intake**: `intake.md`

## Requirements

### Surface Layout: tty pane segment (content verbs)

#### R1: Content-verb pane segment on tty tile headers
The tty tile header in `app/frontend/src/components/surface-layout.tsx` SHALL render a **bordered pane segment** (Option A) — a rounded bordered container (`border border-border rounded`, ~24px tall) holding three content-verb buttons: **Split H**, **Split V**, **Close Pane** — placed right-aligned in the header's verb area, immediately LEFT of the layout-verb cluster, separated from it by the existing hairline pattern (`mx-0.5 h-3.5 w-px bg-border`). Content verbs are per-kind: the segment renders on **tty tiles only** (never code/web/chat), on **both** duplicate tty tiles (both act on the same window's active pane — the relay is per-window), at **any arity including `single:tty`** (the current `showVerbs` arity gate MUST NOT apply to the segment), and **stays visible while the tile is zoomed** (only the layout ◧/⇄ verbs hide there, as today). At arity 1 the layout cluster is absent, so the header shows only the pane segment on the right. Buttons keep the existing `VERB_BUTTON_CLASS` chrome (22×22, 26×26 coarse, rest opacity 65%) and the standard verb hover (`hover:text-text-primary` for the splits). Mobile renders no tile headers (existing `!mobile` gate) — no mobile work.

- **GIVEN** a desktop terminal route with the default `single:tty` layout (which today renders zero header verbs)
- **WHEN** the tty tile header renders
- **THEN** the bordered pane segment with Split H · Split V · Close Pane appears right-aligned, and no layout verbs (⛶/◧/⇄/✕) render

- **GIVEN** a multi-tile layout (e.g. `split-h:tty,code`)
- **WHEN** headers render
- **THEN** the tty tile shows the pane segment followed by a hairline then the layout verbs (⛶ ◧ ⇄ | ✕); the code tile shows only layout verbs, no segment

- **GIVEN** a zoomed tty tile (arity > 1)
- **WHEN** the header renders
- **THEN** the pane segment remains visible while ◧/⇄ hide (✕ and ⛶ stay, as today)

#### R2: Split verbs are two one-click buttons calling the existing API
Split H and Split V SHALL be two **separate one-click buttons** (un-merging the top bar's combined SplitControl), reusing `SplitHorizontalGlyph` / `SplitVerticalGlyph` from `top-bar-icons.tsx`. Horizontal = side-by-side (rk's existing direction vocabulary, listed/rendered first). They SHALL call the same `splitWindow` API path the top-bar SplitControl uses today, with the current window's `{server, windowId, cwd: worktreePath}`.

- **GIVEN** the tty tile's pane segment
- **WHEN** Split H is clicked
- **THEN** `splitWindow(server, windowId, true, worktreePath)` fires (optimistic action, error toast on failure); Split V fires the same with `false`

#### R3: Close Pane — boxed ⊠ glyph, immediate, distinction contract
Close Pane SHALL use a **new boxed ⊠ glyph** component in `top-bar-icons.tsx` (lucide `square-x` shape: rounded rect + inner cross — deliberately NOT the bare-✕ `ClosePaneGlyph`), hover `text-signal-red`, with a Tip whose wording states the consequence: `Close pane — kills the tmux pane`. The action is **immediate** (no confirm dialog — terminal-mode close-pane is deliberately immediate today), calling the existing `closePane` API for the current window's active pane. The distinction contract vs the tile-close ✕ (unchanged, far right behind the hairline): different glyph shape (boxed ⊠ vs bare ✕), different grouping (inside the segment vs isolated), spatial separation (opposite ends of the verb area).

- **GIVEN** a tty tile at any arity
- **WHEN** the Close Pane button is clicked
- **THEN** `closePane(server, windowId)` fires immediately (no dialog); its hover color is `text-signal-red`; the tile-close ✕ (`Close Terminal`) is unchanged

#### R4: Presentational wiring — parent owns the API calls
`SurfaceLayout` SHALL stay presentational: it gains callback props (e.g. `onSplitPane(horizontal: boolean)` and `onClosePane()`), and `app.tsx` wires them to its existing `executeSplit` / `executeClosePane` optimistic actions (`app.tsx` ~line 955) with `currentWindow?.worktreePath` as cwd — no API imports added to `surface-layout.tsx`.

- **GIVEN** the `SurfaceLayout` mount in `app.tsx` (~line 3491)
- **WHEN** the new props are passed
- **THEN** tile verb clicks route through the parent's optimistic actions (same error-toast path the palette split/close actions use)

### Top Bar: terminal-mode split demotion

#### R5: Terminal-mode split becomes menuOnly; board unchanged
The `split` registry entry in `top-bar.tsx` (~line 543) SHALL stop rendering **in-bar** for terminal mode while keeping the chevron-menu rows: set `menuOnly: mode === "terminal"` on the existing entry (the `260722-n2n4` demotion mechanism, dynamic like the `hidden` predicates — no entry split needed). The terminal-mode bar end state becomes **Open · ▦ Layout · Refresh · Gear · chevron** (+ UpdateChip when qualifying). The chevron menu keeps **Split horizontal, Split vertical** rows (converting from overflow-fallback to always-present menuOnly rows) and the **Close pane** row (already menuOnly today — unchanged). **Board mode is untouched**: in-bar SplitControl wired to `focusedPane` + the consequence-gated Kill row stay exactly as today. Palette entries (`Pane: Close`, `Window: Split …`) are unchanged.

- **GIVEN** a terminal route at a wide viewport
- **WHEN** the top bar renders
- **THEN** no in-bar split chip renders (`Split horizontally` button absent from the bar); opening the chevron menu shows `Split horizontal`, `Split vertical`, and `Close pane` rows under the Window section

- **GIVEN** a board route with a focused tile
- **WHEN** the top bar renders
- **THEN** the in-bar SplitControl renders and the chevron menu's Kill row keeps the `onRequestKill` confirm path — byte-for-byte today's board behavior

### Tests

#### R6: Unit + e2e coverage, `.spec.md` siblings in the same commit
Unit tests SHALL cover the segment rules (`surface-layout.test.tsx`) and the registry change (`top-bar.test.tsx`). E2e specs SHALL be updated where behavior moved, each `.spec.ts` edit updating its sibling `.spec.md` (constitution § Test Companion Docs): new assertions — pane segment renders on the tty tile at arity 1, does NOT render on code/web tiles, stays visible while zoomed; terminal-mode bar has no in-bar split chip; chevron menu carries the three rows; board-mode bar unchanged. Specs that used the in-bar split chip as their currentWindow-gated anchor (`open-in-app.spec.ts:94`, `top-bar-refresh.spec.ts:107`) SHALL re-anchor to the ▦ Layout chip (`aria-label="Layout"`, gated on `mode === "terminal" && currentWindow && layout` — same gating semantics). `top-bar-overflow.spec.ts`'s L1 constant and "split control is the first fit candidate to yield" test SHALL be reworked for the new fit-candidate set (the ▦ Layout chip is terminal's only remaining L1 fit candidate after Open).

- **GIVEN** the updated e2e suite
- **WHEN** `surface-layout.spec.ts` and `top-bar-overflow.spec.ts` run on the isolated port-3020 rig
- **THEN** the moved-verbs assertions pass and every touched `.spec.ts` has its `.spec.md` updated in the same commit

### Non-Goals

- Board tile chrome (board keeps its own header verbs, in-bar SplitControl, Kill dialog) — out of scope per intake.
- Mobile tile headers (headers don't render on mobile; the chevron rows are the mobile path).
- Confirm dialog on Close Pane (Option C rejected in discussion).
- Keybinding changes (split-horizontal/split-vertical chords keep their existing handlers in `app.tsx`).
- Deleting the now-unreachable in-bar `SplitControl` terminal branch (the n2n4 revert-by-flag mechanism keeps it; deletion-candidate territory for a later change).

### Design Decisions

#### Two verb families on tile headers
**Decision**: Tile-header verbs split into layout verbs (generic, arity-gated, unchanged) and content verbs (per-kind, any-arity, zoom-visible) — the tty tile gets a bordered pane segment holding Split H / Split V / Close Pane.
**Why**: Pane operations act on the tmux pane inside the tty tile; proximity is the disambiguation. The tile header is already per-kind on its left side (StatusDot, meta chips), so per-kind verbs on the right are an evolution, not a break.
**Rejected**: Keeping pane verbs in the top bar (target invisible on multi-tile layouts); Option B (move only splits) and Option C (confirm-on-close) — user chose Option A.
*Introduced by*: 260813-w1lf-terminal-tile-content-verbs

#### Close distinction is glyph + grouping + distance (Option A)
**Decision**: Close Pane = boxed ⊠ inside the bordered segment; tile-close ✕ = bare glyph isolated far right behind a hairline. Both keep `text-signal-red` hover.
**Why**: Two destructive closes in one header need structural distinction, not just labels; the misclick-trap mitigation is shape + grouping + ~5-button spatial separation.
**Rejected**: Confirm dialog (Option C — terminal close-pane is deliberately immediate); identical glyphs with different tooltips (invisible at rest).
*Introduced by*: 260813-w1lf-terminal-tile-content-verbs

#### Terminal split demotion rides the existing menuOnly mechanism
**Decision**: `menuOnly: mode === "terminal"` on the single existing `split` registry entry, mirroring the dynamic `hidden` predicates.
**Why**: The registry rebuilds per render with `mode` in scope; a dynamic flag is the minimal diff and keeps one entry driving both modes' bar and menu forms (no drift).
**Rejected**: Splitting into separate terminal/board registry entries — duplicates menuRender and risks bar↔menu drift the single-source registry exists to prevent.
*Introduced by*: 260813-w1lf-terminal-tile-content-verbs

## Tasks

### Phase 1: Setup

- [x] T001 Add the boxed ⊠ glyph component (`ClosePaneBoxedGlyph`, `data-icon="close-pane-boxed"`, rounded rect + inner cross, 24-viewBox strokeWidth-2 `ControlGlyph` defaults) to `app/frontend/src/components/top-bar-icons.tsx` <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 Add the pane segment to the tty tile header in `app/frontend/src/components/surface-layout.tsx`: new props `onSplitPane(horizontal)` / `onClosePane()`; bordered segment (Split H · Split V · Close Pane with Tips, `VERB_BUTTON_CLASS`, splits `hover:text-text-primary`, close `hover:text-signal-red` + `Close pane — kills the tmux pane` Tip) rendered for `kind === "tty"` at any arity incl. single, on duplicate tty tiles, visible while zoomed; hairline between segment and layout cluster when the cluster renders <!-- R1 -->
- [x] T003 Wire the new props in `app/frontend/src/app.tsx` (~line 3491): `onSplitPane` → `executeSplit(server, windowParam, horizontal, currentWindow?.worktreePath)`, `onClosePane` → `executeClosePane(server, windowParam)` <!-- R4 -->
- [x] T004 Demote the terminal-mode split in `app/frontend/src/components/top-bar.tsx` (~line 543): `menuOnly: mode === "terminal"` on the `split` entry; update the registry/end-state comments (board branch untouched) <!-- R5 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T005 [P] Unit coverage in `app/frontend/src/components/surface-layout.test.tsx`: segment renders on tty at arity 1 (zero layout verbs), absent on code/web/chat tiles, present + visible while zoomed, both duplicate tty tiles carry it, clicks fire `onSplitPane(true/false)` / `onClosePane`, close-pane glyph is `close-pane-boxed` (not bare ✕) <!-- R1 -->
- [x] T006 [P] Unit coverage in `app/frontend/src/components/top-bar.test.tsx`: terminal mode renders NO in-bar split control while the chevron menu carries both split rows (menuOnly contract); board-mode in-bar SplitControl tests keep passing unchanged <!-- R5 -->
- [x] T007 Update `app/frontend/tests/e2e/top-bar-overflow.spec.ts` + `.spec.md`: L1 constant drops `Split horizontally` (▦ Layout is the surviving L1 fit candidate), wide-width menu now ALWAYS contains the two split rows, rework the "first fit candidate to yield" test around the layout chip <!-- R5, R6 -->
- [x] T008 Extend `app/frontend/tests/e2e/surface-layout.spec.ts` + `.spec.md`: pane segment on the tty tile at `single:tty` (arity 1), absent on code/web tiles, visible while zoomed, terminal bar has no in-bar split chip, chevron menu carries Split H / Split V / Close pane rows (respect the ≤2-tile perf budget — reuse existing flows) <!-- R1, R5, R6 -->
- [x] T009 [P] Re-anchor `app/frontend/tests/e2e/open-in-app.spec.ts` (`splitAnchor`, line ~94) and `app/frontend/tests/e2e/top-bar-refresh.spec.ts` (`splitButton`, line ~107) to the ▦ Layout chip (`getByRole("button", { name: "Layout" })`); update their `.spec.md` files if they name the anchor <!-- R6 -->

### Phase 4: Polish

- [x] T010 Run gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, then the affected e2e (`just test-e2e "surface-layout"`, `"top-bar-overflow"`, `"top-bar-refresh"`, `"open-in-app"`) <!-- R6 -->

## Execution Order

- T001 blocks T002 (glyph import); T002 blocks T003 (props exist); T004 is independent of T001–T003
- T005–T009 follow their implementation tasks; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The tty tile header renders the bordered pane segment (Split H · Split V · Close Pane) right-aligned at arity 1 (`single:tty` — a header that today renders zero verbs); code/web/chat tiles render no segment
- [x] A-002 R2: Split H / Split V are separate one-click buttons reusing `SplitHorizontalGlyph`/`SplitVerticalGlyph`, calling `splitWindow` with `{server, windowId, cwd: worktreePath}` (horizontal first)
- [x] A-003 R3: Close Pane renders the new boxed ⊠ glyph (`close-pane-boxed`, not `ClosePaneGlyph`'s bare ✕), hover `text-signal-red`, Tip `Close pane — kills the tmux pane`, immediate `closePane` call (no dialog)
- [x] A-004 R4: `SurfaceLayout` stays presentational — verbs call new parent callbacks; `app.tsx` routes them through its existing `executeSplit`/`executeClosePane` optimistic actions
- [x] A-005 R5: Terminal-mode bar has no in-bar split chip (end state Open · ▦ · Refresh · Gear · chevron); the chevron menu always carries Split horizontal / Split vertical / Close pane rows

### Behavioral Correctness

- [x] A-006 R1: The segment is present at arity > 1 with the hairline separating it from the layout cluster, and remains visible while the tile is zoomed (◧/⇄ hide as today); both duplicate tty tiles render it
- [x] A-007 R5: Board mode is byte-for-byte untouched — in-bar SplitControl on `focusedPane`, Kill row keeps the `onRequestKill` confirm path

### Scenario Coverage

- [x] A-008 R6: Unit tests cover the segment visibility matrix + callback wiring (`surface-layout.test.tsx`) and the terminal menuOnly / board in-bar contract (`top-bar.test.tsx`)
- [x] A-009 R6: E2e updates land with sibling `.spec.md` updates in the same commit (`surface-layout`, `top-bar-overflow`, `open-in-app`, `top-bar-refresh`)

### Edge Cases & Error Handling

- [x] A-010 R2: Split/close failures surface the existing error-toast path (`useOptimisticAction` onError) — no silent failures
- [x] A-011 R1: Width budget holds — 7 verbs + dot + label fit the 280px tile floor with the meta chip truncating first (no new overflow handling)

### Code Quality

- [x] A-012 Pattern consistency: segment buttons reuse `VERB_BUTTON_CLASS`, `Tip`, and shared glyph components; the registry change follows the n2n4 menuOnly mechanism
- [x] A-013 No unnecessary duplication: no new API wrappers (existing `splitWindow`/`closePane` client calls via existing `executeSplit`/`executeClosePane`); glyphs imported, not redrawn

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/top-bar.tsx:559-561` (`split` entry `barRender` terminal branch) — unreachable since `menuOnly: mode === "terminal"` means `barRender` only ever renders in board mode; plan `## Non-Goals` deliberately keeps it (the n2n4 revert-by-flag mechanism) — surfaced for a later cleanup change, NOT for this one

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Terminal split demotion via dynamic `menuOnly: mode === "terminal"` on the single entry, not an entry split | Intake names `menuOnly` as the mechanism; registry rebuilds per render so a dynamic flag mirrors the existing dynamic `hidden` predicates; minimal diff | S:70 R:90 A:85 D:75 |
| 2 | Confident | Tile split aria-labels `Split pane horizontally` / `Split pane vertically` (distinct from the board chip's `Split horizontally` and the menu rows' `Split horizontal`) | Avoids strict-mode locator collisions in e2e and states the pane target explicitly; no user-facing wording was mandated <!-- assumed: tile verb aria-label wording --> | S:55 R:90 A:80 D:70 |
| 3 | Confident | E2e anchors re-keyed to the ▦ Layout chip (`aria-label="Layout"`) | Same `currentWindow` gating semantics as the departing split chip (`hidden: !(mode === "terminal" && currentWindow && layout … )`), terminal-only, in-bar at wide widths | S:65 R:90 A:85 D:80 |
| 4 | Confident | New glyph named `ClosePaneBoxedGlyph` with `data-icon="close-pane-boxed"` | Follows the module's control-named (not lucide-named) convention; `data-icon` is the established test seam | S:60 R:95 A:85 D:75 |
| 5 | Tentative | Split buttons use the standard verb hover (`hover:text-text-primary`), not the mock's accent-green | Carried from intake assumption 9 — existing `VERB_BUTTON_CLASS` vocabulary wins; trivially reversible styling <!-- assumed: split-verb hover color follows existing verb chrome, not the mock's green --> | S:45 R:95 A:55 D:50 |
| 6 | Confident | Tile segment Tips carry no keyboard chord keycaps in v1 | The chords (`split-horizontal`/`split-vertical`) stay advertised via the chevron-menu rows + shortcuts overlay; adding `useKeybindings` to the presentational `SurfaceLayout` is scope the intake didn't ask for | S:50 R:90 A:75 D:70 |

6 assumptions (0 certain, 5 confident, 1 tentative).
