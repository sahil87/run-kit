# Intake: Tooltips for Sidebar Register Labels and Bottom-Bar Key Chips

**Change**: 260723-fm08-register-label-chip-tooltips
**Created**: 2026-07-23

## Origin

Promptless dispatch via `/fab-proceed` (create-intake subagent, `promptless-defer`). Direct
follow-up to the merged tier-1 tooltip system (PR #445, change `260722-73al-tip-tooltip-system`,
archived at `fab/changes/archive/2026/07/260722-73al-tip-tooltip-system/` — its intake/plan are
the binding design contract). The user pointed at two screenshots of surfaces that still lack
tooltips and said:

> Add tooltips here and here.

Screenshot 1: the sidebar PANE panel register rows (`tmx`, `cwd`, `git`, `pr`, `out`, `agt`,
`fab`) and HOST panel rows (`cpu`, `mem`, `dsk`, `ld`). Screenshot 2: the bottom-bar key chips
(⇥, ^, ⌥, F▴, ↑, the `>_` compose toggle, the ⌘K palette chip). Reuse the existing
`Tip`/`TipGroup` component (`app/frontend/src/components/tip.tsx`) — no new tooltip machinery.

## Why

1. **The pain point**: the sidebar register labels are deliberately terse 2-3-char terminal
   vocabulary (`tmx`/`cwd`/`git`/`pr`/`out`/`agt`/`fab` in the PANE panel; `cpu`/`mem`/`dsk`/`ld`
   in the HOST panel) and the bottom-bar chips are bare symbol glyphs (⇥, ^, ⌥, F▴, ↑, `>_`,
   ⌘K). New users cannot decode either surface: the registers' meanings live only in
   `docs/specs/status-pyramid.md` / code comments, and the chips' names live only in
   `aria-label`s that sighted mouse users never see.
2. **The consequence of not fixing**: the two most information-dense chrome surfaces stay
   expert-only. The 73al change gave every *other* chrome control a styled, keyboard-visible
   tooltip — leaving these two surfaces bare is now an inconsistency, not just a gap.
3. **Why this approach**: the tier-1 `Tip` component (73al) exists precisely for
   "name a control" hints — quiet-card shell, 300ms/warm-cluster delays, focus-visible support,
   coarse-pointer suppression, reduced-motion safety all come free. Adding `Tip` wrappers at the
   label/chip seams is a pure call-site change; no new machinery, no new dependency.

## What Changes

### 1. Sidebar PANE-panel register labels (`app/frontend/src/components/sidebar/status-panel.tsx`)

Add a tier-1 `Tip` to each register LABEL (the 3-char prefix span), naming the register in plain
words. Register meanings verified against the code and specs (`docs/specs/status-pyramid.md`,
`docs/specs/agent-state.md`; in-file register-vocabulary comments at status-panel.tsx:579-586):

| Label | Verified meaning | Tip label |
|-------|------------------|-----------|
| `tmx` | tmux pane index/count + pane ID (copies pane ID) | "tmux pane" |
| `cwd` | active pane's working directory | "Working directory" |
| `git` | active pane's git branch | "Git branch" |
| `pr`  | L3 register — live PR number · state · checks · review | "Pull request" |
| `out` | L0 register — tmux output activity + idle elapsed | "Output activity" |
| `agt` | L1 register — agent state + epoch duration | "Agent state" |
| `fab` | L2 register — fab change id/slug · stage · display state | "Fab change" |

Final copy may be polished at apply within the ≤40ch sentence-cased cap, but stays a plain-words
register name (no second line of state — tier-1 taxonomy).

**Label seams** (all inside status-panel.tsx):
- `CopyableRow` (line ~336): prefix span at line ~350 renders `${prefix} ` inside the row's copy
  `<button>` — used by `tmx` (paneId branch), `cwd`, `git`, `fab`, and the no-URL `pr` branch.
  The Tip wraps the prefix `<span>` only, not the row button (the row button's click = copy,
  untouched). The component gains a label-wiring seam (e.g. a `tipLabel` prop) so each call site
  names its register.
- `PrLinkRow` (line ~364): prefix span at ~393-395 (`"pr  "`) inside the row anchor —
  same wrap-the-span treatment.
- Plain (non-copyable) rows: the `tmx` no-paneId fallback (~511), `out` (~592-596), `agt`
  (~599-605) — label spans wrapped directly.
- The prefix span swaps to `copied ✓` during copy feedback; the tip label describes the register,
  not the transient feedback state (implementation detail at apply — the wrap survives the swap).

**MUST stay untouched** (73al promotion rule — these are state/content-reveal native `title=`
seams deliberately left native, e2e-asserted): the cwd reveal `title=` at status-panel.tsx:525
and the PR-URL `title={prUrl}` at status-panel.tsx:377. Row VALUES keep all existing behavior:
copy-on-click, anchor navigation, hover-accent affordances.

**Hover-only is acceptable**: labels are non-focusable spans; per the 73al connection-dot
precedent (73al plan assumption 8) no new tab stops are added for non-actionable elements.

**Placement**: `right` (the 73al sidebar convention); floating-ui `flip()`/`shift()` handles the
sidebar edge — verify it renders well at apply and adjust only if it visibly fights the edge.

**Warm cluster**: 73al already wrapped the sidebar root in a `TipGroup` (73al T008) — the
register-label tips join that existing cluster; verify at apply, add no redundant group.

### 2. Sidebar HOST-panel metric labels (`app/frontend/src/components/host-metrics.tsx`)

The HOST rows live in the shared `HostMetrics` component (`host-metrics.tsx`), rendered by
`sidebar/host-panel.tsx:117` AND by the Host overview dashboard
(`host-overview-page.tsx:267`). Tips are added to the label spans inside `host-metrics.tsx`,
so both surfaces gain them (the labels are equally cryptic on the dashboard):

| Label | Verified meaning | Tip label |
|-------|------------------|-----------|
| `cpu` (line ~38) | CPU sparkline + current % | "CPU usage" |
| `mem` (line ~93) | memory gauge used/total | "Memory usage" |
| `dsk` (line ~51) | disk used/total (row also shows `· up <uptime>`) | "Disk usage" |
| `ld` (line ~122) | 1/5/15-min load averages, normalized per-CPU % | "Load average" |

The inline `up` sub-label on the `dsk` row is not a row prefix and gets no tip in this change.

### 3. Bottom-bar key chips (`app/frontend/src/components/bottom-bar.tsx` + `arrow-pad.tsx`)

Full chip inventory of the toolbar row (verified against the file; the chips carry `aria-label`s
but no visual tooltip):

| Chip | Site | Accessible name | Tip |
|------|------|-----------------|-----|
| ⇥ | bottom-bar.tsx:280 | "Tab" | label "Tab" |
| ^ | :284-295 | "Control" (latch, `aria-pressed`) | label describing the latch, e.g. "Ctrl for next key" |
| ⌥ | :284-295 | "Option" (latch, `aria-pressed`) | label describing the latch, e.g. "Alt for next key" |
| F▴ | :298-307 | "Function keys" (menu trigger) | label "Function keys" |
| ↑ | arrow-pad.tsx:99-111 | "Arrow keys" (tap = popup, drag = send arrow) | label "Arrow keys" |
| `>_` | :360-371 | "Compose text" (toggle, `aria-pressed`) | label "Compose text" |
| ⌘K | :372-378 | "Open command palette" | label "Command palette" + kbd "⌘K" |
| ⌨/🔒 | :382-393 | "Show keyboard"/"Hide keyboard"/"Scroll lock on — tap to unlock" | none — chip is `hidden coarse:inline-flex` (touch-only) and `Tip` self-suppresses under `pointer: coarse`, so a tip could never render |

**Modifier-latch semantics verified** (`hooks/use-modifier-state.ts` + the bottom-bar capture
keydown handler): clicking ^/⌥ toggles a one-shot latch; the armed modifier is applied to the
NEXT key sent (chip or physical keystroke) and consumed. Tip copy says what the chip does
("Ctrl for next key" — exact wording polished at apply, ≤40ch sentence-cased).

**⌘K kbd slot**: canonical shortcut string is "⌘K" with label "Command palette"
(`keyboard-shortcuts.tsx:93`). The `>_` toggle has no registered keyboard shortcut → no kbd slot.

**In-menu items get no tips**: the F▴ menu's `role="menuitem"` entries (F1–F12, Esc,
PgUp/PgDn/Home/End/Ins/Del at :315-350) and the arrow-pad popup's ↑←↓→ buttons show visible
text labels / self-evident glyphs already — a tip repeating the visible name is noise, and the
73al taxonomy exists to *name* controls that lack visible names. (Esc is the borderline case —
visible "Esc", aria-label "Escape" — still skipped; see Assumptions #5.)

**Placement/behavior**: `placement="top"` (bottom-of-screen strip, 73al per-region convention).
Wrap the toolbar chip row in a `TipGroup` warm cluster inside `bottom-bar.tsx` itself — this
covers BOTH render sites (app shell `app.tsx` and the board twin `board/board-page.tsx:1153`,
which reuses the same component — board-twin check resolved: both BottomBar and the Sidebar
panels are shared components on the board route, no separate twin implementation exists for
these surfaces). Do NOT regress the coarse-pointer touch targets (`KBD_CLASS`
`coarse:min-h-[36px] coarse:min-w-[36px]`) or the `preventFocusSteal` mousedown handling —
`Tip`'s clone-child API merges props without a wrapper element, and floating-ui composes
existing event handlers, so both survive; verify at apply.

### 4. Binding constraints (inherited from the 73al contract, all in force)

- Tier-1 taxonomy only: name-a-control, never interactive, `role="tooltip"` + `aria-describedby`.
- ≤40ch one-line sentence-cased labels.
- NO native `title=` added anywhere; existing `aria-label`s stay untouched.
- `StatusDotTip` untouched.
- Reduced-motion + coarse-pointer behavior comes free from `Tip` — no extra handling.

### 5. Tests

- **Per-site unit tests** (73al idiom — per-site tests guard the wiring, deep behavior stays in
  `tip.test.tsx`): extend `sidebar/status-panel.test.tsx`, `sidebar/host-panel.test.tsx` (or a
  host-metrics-scoped test), and `bottom-bar.test.tsx` to assert the Tip label wiring at the new
  sites.
- **E2E**: extend `app/frontend/tests/e2e/tooltips.spec.ts` AND its sibling `tooltips.spec.md`
  companion (Constitution: Test Companion Docs, same commit) with at least one register-label
  case and at least one bottom-bar chip case.
- **Selector seams grepped** (`app/frontend/tests/` + colocated unit tests — the known
  "e2e asserts chrome details" trap): `shell-rotation.spec.ts:83`
  (`getByLabel("Open command palette")` — survives, aria-labels untouched),
  `pane-register-panel.spec.ts` (`register-output`/`register-agent` testids +
  `toContainText("out"/"agt")` — survives, label text unchanged), `compose-strip.spec.ts`
  (`getByRole("button", { name: "Compose text" })` — survives),
  `status-panel.test.tsx:313,438` (`getByRole name /pane 1\/1 %5/`, `getByText("tmx")` —
  survive), `bottom-bar.test.tsx` (`getByLabelText` throughout — survives). Re-grep at apply
  before changing markup; also re-check `mobile-layout.spec.ts` / `host-health-home.spec.ts`
  for chip/metric assertions.

## Affected Memory

- `run-kit/ui-patterns`: (modify) grow the Tip section's migrated-surfaces list by these two
  surfaces (sidebar PANE/HOST register labels — hover-only span tips; bottom-bar chip row).
  Small addition; the file is large (~617KB) — surgical edits only.

## Impact

- **Frontend only** — no backend, no API, no routes, no new dependencies. Files touched:
  `sidebar/status-panel.tsx`, `host-metrics.tsx`, `bottom-bar.tsx`, `arrow-pad.tsx`
  (+ their colocated tests), `tests/e2e/tooltips.spec.ts` + `tooltips.spec.md`. `tip.tsx` itself
  is expected to need NO changes.
- **Board route covered for free**: both surfaces are shared components rendered by the board
  twin (`board-page.tsx` renders `Sidebar` and `BottomBar`) — verify at apply, no separate work
  expected.
- **Risk**: low — additive call-site wrappers. Known failure modes: test selectors on chrome
  (inventoried above) and accidental behavior changes to copy-rows/latch chips (tips wrap
  labels/chips without altering handlers).
- **Verification gates**: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`,
  `just test-e2e`, `just build`. Note: `scripts/build.sh` has a known pre-existing VERSION-file
  issue — the 73al workaround was an untracked VERSION file; do NOT fix build.sh in this change.

## Open Questions

- None — the 73al contract plus the synthesized follow-up description resolve design, scope, and
  behavior; residual judgment calls are graded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `Tip`/`TipGroup` from `tip.tsx` verbatim — no new tooltip machinery, no `tip.tsx` changes | Explicit in the follow-up mandate; component verified to cover hover-only spans, kbd slot, placement, coarse suppression | S:95 R:90 A:95 D:95 |
| 2 | Certain | Tips go on register LABELS only; the cwd reveal (status-panel.tsx:525) and PR-URL (:377) native `title=` seams and all row-value behaviors stay byte-untouched | 73al promotion rule is binding; two e2e specs assert those native seams | S:95 R:85 A:95 D:95 |
| 3 | Confident | Register tip copy: tmx "tmux pane", cwd "Working directory", git "Git branch", pr "Pull request", out "Output activity", agt "Agent state", fab "Fab change", cpu "CPU usage", mem "Memory usage", dsk "Disk usage", ld "Load average" — polish allowed at apply within ≤40ch/sentence-case | Meanings verified against status-panel.tsx, host-metrics.tsx, status-pyramid.md, agent-state.md; description supplied the copy with a verify mandate ("Memory"→"Memory usage" is the one refinement: the row is a usage gauge) | S:75 R:90 A:85 D:80 |
| 4 | Confident | Register-label tips are hover-only (labels stay non-focusable spans; no new tab stops) | 73al plan assumption 8 (connection-dot precedent) sanctions exactly this for non-actionable elements | S:80 R:85 A:85 D:80 |
| 5 | Confident | Bottom-bar tip scope = the symbol-glyph chips (⇥ ^ ⌥ F▴ ↑ `>_` ⌘K); F▴-menu items (F1–F12, Esc, PgUp…Del) and arrow-popup buttons get NO tips (visible text already names them); the coarse-only ⌨/🔒 chip gets none (Tip self-suppresses under coarse — it could never render) | Tier-1 exists to name controls lacking visible names; a tip repeating visible text is noise. The description's "inventory ALL chips (e.g. Esc)" is read as an inventory mandate, satisfied above — Esc inventoried, consciously excluded | S:45 R:90 A:70 D:55 |
| 6 | Confident | Modifier chips ^/⌥ get behavior-describing labels ("Ctrl for next key" / "Alt for next key" — exact wording at apply) | Latch semantics verified in use-modifier-state.ts + the capture keydown handler: one-shot latch consumed by the next key; description mandates saying what the chip does | S:75 R:90 A:85 D:75 |
| 7 | Confident | ⌘K chip → label "Command palette" + kbd "⌘K"; `>_` toggle gets no kbd slot | Canonical shortcut string at keyboard-shortcuts.tsx:93; compose toggle has no registered shortcut | S:85 R:90 A:90 D:85 |
| 8 | Confident | HOST tips live in the shared `host-metrics.tsx`, so the Host overview dashboard's metrics block gains them too (not just the sidebar) | The labels are identical and equally cryptic on both surfaces; prop-gating tips to the sidebar would add a seam for strictly less consistency | S:55 R:85 A:80 D:65 |
| 9 | Confident | Placement: `right` for sidebar register labels, `top` for bottom-bar chips; `TipGroup` added inside bottom-bar.tsx (covers app shell + board twin); sidebar tips join 73al's existing sidebar-root TipGroup | 73al per-region conventions; flip/shift middleware handles edges; verified BottomBar/Sidebar are shared components on the board route | S:80 R:90 A:85 D:85 |
| 10 | Confident | `CopyableRow`/`PrLinkRow` gain a minimal label-wiring seam (Tip wrapped around the prefix span, e.g. via a `tipLabel` prop); wrap survives the transient `copied ✓` swap; chip handlers (`preventFocusSteal`, latch toggles) survive via Tip's prop-merging clone API | Smallest-diff seam consistent with the row components' current shape; floating-ui composes existing handlers (proven across 73al's ~40 sites) | S:60 R:90 A:80 D:70 |
| 11 | Confident | Tests: per-site unit assertions for label wiring (73al idiom) + ≥1 register-label and ≥1 chip e2e case appended to tooltips.spec.ts with its .spec.md updated in the same commit; inventoried selectors all survive since aria-labels and visible text are unchanged | Explicit test mandate in the description; selector grep performed at intake and re-run at apply | S:80 R:90 A:85 D:80 |
| 12 | Certain | Verification gates: `npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, `just build`; build.sh's VERSION-file issue worked around (untracked VERSION file), not fixed here | Gates named verbatim in the description; build.sh fix explicitly out of scope | S:90 R:90 A:95 D:90 |

12 assumptions (3 certain, 9 confident, 0 tentative, 0 unresolved).
