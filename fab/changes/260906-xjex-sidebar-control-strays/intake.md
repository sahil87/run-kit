# Intake: Sidebar Control Strays

**Change**: 260906-xjex-sidebar-control-strays
**Created**: 2026-09-06

## Origin

> Operator-dispatched: slice 5 of the control-vocabulary retrofit, per `fab/plans/sahil/26-09-06-control-retrofit-slices.md` (merged, PR #848). Intake seed: the sidebar's interactive strays join the contract — one hover-reveal spelling, touch floors on every tappable, and the remaining ad-hoc recipes onto shared constants.

Slices 1–4 shipped (PR #845 tokens/globals/40px, PR #847 green latch vocabulary, PR #850 menu/popover unification). Contract of record: `docs/wiki/control-state-audit.html` + `control-contract-preview.html` (scheme C, 2026-09-05); post-change truth in `docs/memory/run-kit/ui/visual-design.md`.

### Standing context (binding on apply — do not re-derive)

- **Tokens**: `--ctl-*` custom properties in `globals.css` `:root`; TS constants keep Tailwind literals with lockstep comments (the `COARSE_POINTER_QUERY` convention).
- **Shared arms** in `app/frontend/src/components/controls.ts`: `TOP_BAR_*`, `MENU_ROW_*` (+ `MENU_ROW_CHECKED`/check-mark idiom, `POPOVER_SHELL` since slice 4), `LATCHED_ARM`, `LATCHED_ARM_RINGED`; `KBD_BASE`/`KBD_REST`/`KBD_CLASS` in `kbd-chip.ts`.
- **REST-swap rule** (load-bearing): a latched/selected arm replaces the hover-carrying rest classes — never stacks (specificity ties resolve by compiled source order).
- **Global rules already shipped — do not duplicate per site**: unlayered `:focus-visible` green ring, `:active` pressed fill, long-press select guard, hue-free glint.
- **Color algebra**: hover = brightness only · green = state · signal hues = status · remaining blue is owned by slice 6 (input focus/edit borders) and the zen-exit action chip.
- **Coarse floor**: 40px (38 inset segments); fine minimum 24px for tappables. Fine sizes otherwise unchanged.
- **Verification**: `npx tsc --noEmit` + affected unit suites + scoped e2e only (full suite never a gate). Tests conform to the spec; Playwright intent comments updated in the same edit; no change-ID citations in code comments.

## Why

1. **The pain** (audit §5/§7 + slice-3 leftovers): the sidebar spells the hover-revealed icon-cluster pattern **three different ways** (window-row's container `pointer-events` gate without a coarse arm; status-panel's same idiom plus `coarse:` escapes; host-panel's button-level opacity with no pointer-events gating); several tappables sit **below any floor** (status-panel PR-copy at 20px, swatch-popover/marker-pad cells at 18px, pin-popover's 22px Pin button, px-only hit areas on the server "+", board-header unpin, and the operator context-chip ✕); row-hover fills use three alphas for one meaning; and the server-card Protect switch ignores the `ACTION_ROW_CLASS` recipe its `CardActionList` siblings use while its green track values are duplicated inline against BoolToggle's.
2. **If unfixed**: the sidebar — the most touch-critical surface after the bars — keeps sub-target controls and three reveal dialects, and slice 7's primitive migration would have to normalize them mid-flight.
3. **Approach**: constants-first as in every slice — one reveal pattern, floors via the established tokens, the switch-track recipe extracted once — with fine-pointer visuals unchanged except where a floor genuinely grows a sub-24px target.

## What Changes

### 1. One hover-reveal spelling (the window-row idiom + the coarse escape)

Canonical pattern (documented via a constraint comment at the shared site or a small exported helper string in `controls.ts`, apply's judgment): the **container** carries `pointer-events-none group-hover:pointer-events-auto has-[:focus-visible]:pointer-events-auto` with `coarse:pointer-events-auto`, and the revealed buttons carry `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` with `coarse:opacity-100`.

- `components/sidebar/window-row.tsx` ~:949 (icon cluster): already the container idiom — ADD the `coarse:` escapes ONLY IF the cluster is rendered on coarse (it is deliberately not rendered there today — the status rail owns coarse; in that case leave it and record the fine-only design in the pattern comment).
- `components/sidebar/status-panel.tsx` ~:350 (PR-copy cluster): already container idiom + coarse escapes — becomes the reference; align any divergence.
- `components/sidebar/host-panel.tsx` ~:84 (palette button): migrate off button-level-opacity-only onto the container idiom (or the button-level form WITH pointer-events gating if it has no grouping container — match the actual DOM; the requirement is one *behavioral* pattern: unreachable at rest on fine pointers, always reachable on coarse, focus-visible reveals).

### 2. Touch/size floors on the stray tappables

- `status-panel.tsx` ~:359 PR-copy buttons: `min-h-[20px]` → `min-h-[24px] min-w-[24px] coarse:min-h-[40px] coarse:min-w-[40px]`.
- `window-row.tsx` icon-cluster buttons (~:991/:1012/:1031, 24px, fine-only): keep 24px fine; no coarse variant needed if the cluster stays fine-only (see §1).
- `components/swatch-popover.tsx` `CELL` (~:52, 18×18 both pointer classes): 18 fine stays (a dense picker grid is a deliberate exception — record it in the constant's comment) but gains `coarse:w-[28px] coarse:h-[28px]` so touch pickers are usable; verify the popover still fits 375px with its column count (reduce columns on coarse only if it overflows — apply verifies at 375px).
- `components/sidebar/marker-pad.tsx` cells: geometry is caller-computed via `MARKER_WELL_*` (do NOT break the lockstep or the pad's spring-loaded interaction) — out of scope beyond a comment if already coarse-sized; verify only.
- `components/sidebar/pin-popover.tsx` ~:237 Pin button: `min-h-[22px]` → `min-h-[24px]` (coarse 40 already present — keep).
- px-only hit areas gain floors (24 fine / 40 coarse): server-panel "+" (`server-panel.tsx` ~:132), board-header unpin (`board/board-header.tsx` ~:85), operator context-chip ✕ (`operator-context-chip.tsx` ~:42), flyout docs (i) link (`row-flyout-card.tsx` ~:728).

### 3. One row-hover alpha

`bg-bg-card/50` is the survivor (window/session/boards rows already use it): `sidebar/index.tsx` ~:2910 empty-session create row (`/30` → `/50`); pin-popover rows' full `bg-bg-card` hover → `/50`.

### 4. Protect switch joins ACTION_ROW + the switch-track recipe extracts

- `components/sidebar/server-card.tsx` ~:86: the Protect `role="switch"` row adopts `ACTION_ROW_CLASS` (min-h + left-border hover cue like its `CardActionRow` siblings; the global focus ring already covers it).
- Extract the green switch-track recipe (track ON `bg-accent-green/30 border-accent-green` + solid green knob / OFF `bg-bg-card border-border`) into `controls.ts` (e.g. `SWITCH_TRACK_ON`/`SWITCH_TRACK_OFF` + knob classes) and consume at BOTH switches: server-card Protect and settings `BoolToggle` (`settings-all-panel.tsx` ~:87) — they carry identical inline values today (slice-3 alignment); this de-duplicates them.

### 5. Deletion candidates riding the touched files

While each file is open: remove `select-none` where the global select guard covers the element (e.g. `KBD`-descendant recipes in touched sidebar files), and per-site `focus-visible:` outline utilities the global ring outranks (`row-flyout-card.tsx` ACTION_ROW's `focus-visible:outline-1 outline-accent`, status-panel's `outline-1` variants) — ONLY in files this slice already touches; a repo-wide sweep stays slice 7.

### 6. Tests conform

Sweep for assertions pinned to: 20px PR-copy geometry, 18px swatch cells on coarse, `/30` hover alpha, the Protect switch's pre-ACTION_ROW classes, removed `focus-visible` utilities. Known e2e traps (project memory, binding): row icon clusters need `.hover()` before icon clicks; `filter({ has })` needs page-rooted locators; the marker well width is hardcoded as a Tailwind literal in session-row (grep by value, not name).

### Non-goals

- The status rail, marker pad interaction, flyout card anatomy, row tint system — behavior and geometry stay (only the enumerated stray floors/patterns).
- Dialogs/inputs (slice 6); repo-wide deletion-candidate sweep and the `Control` primitive (slice 7).
- The window-row icon cluster's fine-only rendering decision stands (coarse is served by the status rail) — do not add a coarse arm to it.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) one hover-reveal pattern (+ the window-row fine-only carve-out), stray floors (PR-copy, pin-popover, server "+", flyout docs link), row-hover alpha unified, Protect switch on ACTION_ROW + shared switch-track recipe
- `run-kit/ui/visual-design`: (modify) switch-track recipe joins the shared-constants inventory; picker-cell coarse exception documented; touch-target section gains the 24-fine/40-coarse floor rule for sidebar tappables
- `run-kit/ui/dialogs-and-state`: (modify) swatch-popover coarse cell sizing; BoolToggle consumes the shared switch-track constants
- `run-kit/ui/operator-console`: (modify) operator context-chip ✕ hit-area floor

## Impact

- **Files**: `controls.ts`, `sidebar/window-row.tsx` (comment/verify only unless divergent), `sidebar/status-panel.tsx`, `sidebar/host-panel.tsx`, `sidebar/index.tsx`, `sidebar/pin-popover.tsx`, `sidebar/server-card.tsx`, `sidebar/server-panel.tsx`, `sidebar/row-flyout-card.tsx`, `board/board-header.tsx`, `swatch-popover.tsx`, `operator-context-chip.tsx`, `settings-all-panel.tsx` + affected tests.
- **Visible deltas** (intended): coarse pointers get real hit targets on the enumerated strays; swatch cells grow on touch; Protect row matches its siblings; empty-session and pin-popover row hovers match the rest. Fine-pointer rendering otherwise unchanged.
- **Risk surface**: sidebar e2e is the densest spec area (row hover gates, flyout hit-areas, multi-select) — scope carefully; swatch-popover columns at 375px coarse; `row-flyout-card` focus-utility removal must not regress its e2e focus assertions (the global ring covers, but assertions may pin the old outline classes).
- Frontend-only; no backend/API/tmux impact.

## Open Questions

- None — plan-directed; judgment calls graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Slice scope = the enumerated sidebar/adjacent strays; rail/marker/flyout anatomy untouched | Plan §slice 5 + non-goals | S:90 R:85 A:92 D:90 |
| 2 | Confident | Window-row icon cluster stays fine-only (status rail owns coarse); the pattern comment records this as design, not drift | Audit noted "not rendered on coarse" as deliberate; adding a coarse arm would double the rail | S:70 R:80 A:85 D:78 |
| 3 | Confident | Swatch cells: 18px fine kept as a documented dense-picker exception; 28px coarse (not 40 — an 8-10 column grid at 40px cannot fit 375px) | Floor-vs-density tradeoff; 28px matches the marker-pad's coarse cell ballpark | S:62 R:80 A:75 D:65 |
| 4 | Confident | Switch-track recipe extracts as constants (SWITCH_TRACK_*), consumed by both switches | The two switches carry identical inline values since slice 3 — textbook duplication | S:72 R:85 A:85 D:80 |
| 5 | Confident | Deletion-candidate removal is touched-files-only this slice | Plan reserves the repo-wide sweep for slice 7 | S:70 R:88 A:85 D:80 |
| 6 | Confident | Hover-reveal unification is behavioral (one reveal contract), allowing the host-panel form to keep its own DOM if no grouping container exists | The requirement is reachability semantics, not identical markup | S:64 R:80 A:78 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
