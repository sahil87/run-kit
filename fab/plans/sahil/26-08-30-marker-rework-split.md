# Plan: Window-row marker rework, re-executed as three changes

**Authored**: 2026-08-30
**Author**: discussion + post-mortem session with Claude
**Executor**: agents picking up phases one at a time, each via the normal fab pipeline
(`/fab-new` → `/fab-fff`). Each phase below is self-contained enough to intake from.
**Status**: Phases 1–3 open for pickup, strictly in order. The design is settled and
unchanged — see the studies in `docs/wiki/`. PR
[#767](https://github.com/sahil87/run-kit/pull/767) implements all of it in one change and
is **not to be merged**; it is the parts bin and the reference implementation.

## Goal

Ship the agreed marker design — a 3×3 **mode × stage** model in a drawn well, set by a
spring-loaded pad — as three changes split on **risk class** rather than feature boundary,
so each is reviewable against a single question and each is independently shippable.

The design is not being revisited. What changes is only *how it is delivered*.

**Why re-execute rather than merge #767**: the change passed every gate, but it took ten
review cycles against a budget of three, and two user-visible interaction defects survived
the passing pipeline. The reasons are recorded in
[`docs/findings/marker-rework-review-cycles.md`](../../../docs/findings/marker-rework-review-cycles.md);
the short version is that a storage migration, a visual rework, a new interaction component
and a docs move shared one pass/fail verdict, so review attention never landed where the
risk was. Six of seven real defects were in the pad — ~30% of the diff.

## The authority for the design

| Source | What it settles |
|--------|-----------------|
| [`docs/wiki/marker-3x3-studies.html`](../../../docs/wiki/marker-3x3-studies.html) | **Canonical final state.** The 3×3 grid, stage widths, chevron geometry, the T4 well, the ink pair, the well→dot gap study. Live demos are the gesture spec in motion. |
| [`docs/wiki/mode-axis-studies.html`](../../../docs/wiki/mode-axis-studies.html) | Why the vertical axis is `manual`/`auto`/`blocked` and why shapes are solid / `»` / hatch |
| [`docs/wiki/marker-axis-studies.html`](../../../docs/wiki/marker-axis-studies.html) | Why two axes at all; the encodings considered; the spring-loaded gesture vs the alternatives |
| [`docs/wiki/window-row-studies.html`](../../../docs/wiki/window-row-studies.html) | The row anatomy the change starts from; the label-zone and mobile-dot-trigger cases |

Settled values, for quick reference: modes `manual` / `auto` / `blocked`; stages `1` / `2` /
`3` glossed *early / mid / done*; fill widths **7 / 15 / 22px** (manual solid, blocked hatch)
and **1 / 2 / 3 chevrons** for auto (4.2 × 10px, 7.2px pitch, ~1.8px stroke, vertically
centred, single row); the well is `left: 0; width: 22px`, 12% ink wash + 1px 30%-ink right
edge, **drawn only on rows that carry a marker**; ink `--color-marker-ink` = **#f59e0b dark
/ #d97706 light**; content start `pl-[30px]` on both pointer classes.

## Strategic framing

**Expand → migrate → contract.** The stored vocabulary and the renderer are genuinely
coupled: you cannot narrow the token set without changing what draws it. Rather than fight
that, phase 1 *widens* the accepted set and lands the new model unconsumed, phase 2 flips
the read path and narrows the set in the same change that teaches the UI to draw it, and
phase 3 adds the interaction on top of a settled data model. No phase leaves a running
server holding a token its own validator rejects.

**One question per phase.** Phase 1: *does every stored value survive?* Phase 2: *does it
look right, and did anything stale survive the removal?* Phase 3: *does the gesture hold at
every edge?* A reviewer that knows the question spends its attention correctly.

**The docs land first.** This plan, the findings, and the four study pages ship as their own
PR (this one), so none of the three implementation changes carries documentation ballast —
~42% of #767's diff was docs and pipeline artifacts.

## Source material — copying from #767

The reference implementation is durable via GitHub's PR ref even if the branch is deleted:

```sh
git fetch origin refs/pull/767/head:pr767
git show pr767:app/frontend/src/marker.tsx > app/frontend/src/marker.tsx
```

Branch `260829-yneo-window-row-marker-well-3x3` (origin head `790120eb`; a locally rebased
variant `f0a8a121` exists in the `buffed-pika` worktree, which additionally resolves six
conflicts against current main and fixes the `reopen_test.go` fixture).

**Copy, then read.** Copied code carries #767's bugs unless the phase's "known traps"
section says otherwise. Every trap listed below was a real review finding or a manual-test
defect on that branch — treat each as a required check, not a suggestion.

## Rules that bind every phase

These come straight out of the post-mortem. Carry them into each intake.

1. **Scope comment-hygiene acceptance to the diff.** Write it as *"no plan/change IDs
   (`R#`/`T###`/`A-###`) or removed-feature narration in comments **this change adds or
   modifies**"*. Never as a repo-wide rule — the repo's own convention is to cite change ids,
   so an unscoped rule makes every review re-litigate untouched files. This single mistake
   cost five of #767's ten cycles.
2. **Put the provenance sweep in the apply prompt, not the review.** Instruct the worker to
   run, before writing its result:
   `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files incl. tests>`
   and clear every hit. Workers mirror plan IDs into comments by habit; the sweep must
   include test and e2e files, not just `src/`.
3. **Do not re-run the full gate set for a comment fix.** Re-run what the edit touches.
4. **Treat the 3-cycle exhaustion stop as a design signal.** If a phase exhausts its budget,
   stop and re-plan that phase rather than hand-driving it.
5. **Exercise new interaction by hand before ship.** #767 shipped two user-visible
   interaction defects through a fully green pipeline.
6. **Pre-warm the worker pane** (`fab dispatch open` → `ready` → clear any trust/update wall)
   before the pipeline needs it.

## Phase 1 — Expand: accept the `mode:stage` vocabulary

**One question: does every stored value survive?**

Purely additive and invisible. Nothing renders differently; no API shape changes. The
validator accepts *both* vocabularies, and the new model lands with tests as its only
consumer.

### Scope

- `app/backend/internal/validate/validate.go` — `markerTokens` becomes the **union**: the
  existing eight (`pipe`, `dotted`, `dashed`, `solid`, `double`, `thick`, `hatch`, `block`)
  **plus** the twelve new (`manual`, `manual:1..3`, `auto`, `auto:1..3`, `blocked`,
  `blocked:1..3`). `""` still means unset. Error copy lists the new set first.
- `app/backend/internal/tmux/tmux.go` — `NormalizeMarker(raw string) string` plus the
  `legacyMarkerValues` table, as a **pure exported function with tests**. Mapping:
  `pipe|dotted|dashed|solid → manual:1`, `double → manual:2`, `thick → manual:3`,
  `hatch → blocked:2`, `block → blocked:3`; new-scheme values pass through; anything else
  → `""`. **Do not wire it into `parseWindows` or `layout.go` yet** — that is phase 2.
- `app/frontend/src/marker.tsx` *(new; copy from #767)* — `MARKER_MODES`, `MARKER_STAGES`,
  `MARKER_STAGE_GLOSS`, the `Marker` type, `parseMarker`, `formatMarker`. **Ship only the
  parse/format half in this phase**; the fill/chevron renderers come with phase 2 alongside
  their first consumer.
- Tests: `validate_test.go` (both vocabularies accepted, flair tokens still rejected), a
  `NormalizeMarker` table test, `marker.test.ts` (round-trip, bare mode → stage 1, empty /
  malformed / out-of-range → null, never throws).

### Explicitly out of scope

`markerStripeStyle` and `MARKER_STATES` stay exactly as they are; the row renders as it does
today; no `--color-marker-ink`; no UI file is touched.

### Known traps

- **The reviewer will flag the new API as having zero production call sites.** It did on
  #767 cycle 1. State in the intake that phase 1 deliberately lands the migration's first
  half with tests as its consumer, and name phase 2 as the production consumer, so this is a
  recorded decision rather than a finding.

### Acceptance

- Every legacy token and every new token validates; every legacy token maps forward through
  `NormalizeMarker`; `parseMarker`/`formatMarker` round-trip for all nine mode×stage pairs.
- `git diff --stat` touches no file under `app/frontend/src/components/`.
- A live server with existing markers renders **identically** before and after.

### Gates

`cd app/backend && go test ./...` · `cd app/frontend && npx tsc --noEmit && npx vitest run
src/marker.test.ts`. **No Playwright, no `just build`** — cycles here should cost ~1 minute,
not ~9.

### Size estimate

~13 backend files, one new frontend module. Roughly +270 / −150.

## Phase 2 — Migrate + contract: the well, the ink, the retirements

**One question: does it look right, and did anything stale survive the removal?**

This phase flips the read path, narrows the vocabulary, and does the whole visual rework in
one change — they are inseparable, and this is the part of #767 that produced **zero**
defects.

### Scope

**Backend (flip + contract)**

- Wire `NormalizeMarker` into `parseWindows` (`tmux.go`) and the snapshot reader's field 27
  (`layout.go`), *before* the closed-set drop, so the frontend never sees a legacy token.
- `snapshot/restore.go` — normalize on the **write** path too:
  `add(tmux.MarkerOption, tmux.NormalizeMarker(win.Marker))`. A stored snapshot must not
  restore a token the validator now rejects.
- Narrow `markerTokens` to the twelve new tokens; legacy tokens now 400 through
  `POST /api/windows/{id}/options` with zero tmux calls.
- `api/operator.go` — the `color-tabs` prompt vocabulary; the
  `promptVocab == closedSetTokens(validate.MarkerValues)` invariant test keeps it honest.
- No `legacy_options.go` row: that table maps option *names*, and this is a same-name *value*
  remap.

**Frontend (the visual rework)**

- `marker.tsx` — add `markerFillStyle` (solid/hatch at 7/15/22px) and the `MarkerChevrons`
  renderer; both the row and, later, the pad consume them, so the vocabulary lives in one
  place.
- `globals.css` — `--color-marker-ink` in the `@theme`, `[data-theme="dark"]` (#f59e0b) and
  `[data-theme="light"]` (#d97706) blocks, following the `--color-signal-yellow` pattern.
- `window-row.tsx` — the T4 well (drawn only when `parseMarker(marker) !== null`);
  `STRIPE_EDGE_INSET` 4 → 0 and `LABEL_ZONE_WIDTH` → `MARKER_WELL_WIDTH = 22`; `blocked`
  mounts `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`; `pl-[30px]` on both
  pointer classes (`coarse:pl-4` removed); **delete the interactive `LabelZone`** (component,
  `zoneHover`, `openLabelPicker`, `ICON_ZONE_WIDTH`, `ICON_EDGE_INSET`, and any
  `aria-label="Set tab label"`); plain hover no longer shades the row background — the shade
  is reserved for the held state (`flyout.open`), which the code already distinguishes;
  the coarse dot loses `scrub.handlers`, its `stopPropagation` and its
  `coarse:min-w-[32px]` box, so the 56px rail is the sole coarse flyout trigger and a dot
  tap selects the row.
- `swatch-popover.tsx` — remove the marker band, `selectedMarker`/`onSelectMarker`,
  `markerOverride`, the `clear-marker` keyboard row, and the marker leg of the combo caption
  and clear-all. The picker becomes color + flair.
- The marker no longer reads the row's family colour; `markerColor` survives only as the
  `FlairOverlay` colour.

### Explicitly out of scope

**No pad, no strip press target, no wheel, no palette action, no card Marker row.** Markers
are display-only after this phase — set them with `tmux set-option -w @rk_win_marker
manual:2` while phase 3 is pending, and say so in the PR body.

### Known traps

- **Fixtures carrying legacy tokens will fail once the write path normalizes**:
  `snapshot/restore_test.go` (`restoreFixture`), `snapshot/reopen_test.go` (`reopenFixture`
  — main's reopen engine shares restore's option-write path) and `snapshot/integration_test.go`.
  Move each fixture to the current vocabulary; keep one dedicated test that feeds a *legacy*
  value and asserts the normalized result.
- **The removal sweep must include e2e specs**, not just `src/`:
  `grep -rn "Set tab label\|LabelZone\|MARKER_STATES\|markerStripeStyle\|coarse:pl-4\|status-dot-tap" app/frontend`.
- **Touched e2e tests need their `Proves:` / `Steps:` JSDoc updated in the same edit**
  (constitution § Test Intent Comments).
- Do not rewrite comments outside the change's own lines — #767 churned ~200 lines of
  unrelated `app.tsx` comments chasing an unscoped hygiene rule.

### Acceptance

- A live window carrying `hatch` is served as `blocked:2`; an old snapshot restores as
  `blocked:2`; a retired token POSTed to `/options` returns 400 with zero tmux calls.
- A marked row renders the well at `left:0; width:22px` with the 12% wash and 30% right edge
  in `var(--color-marker-ink)`; an unmarked row renders nothing in the strip.
- No element with `aria-label="Set tab label"` exists on either pointer class; the colour +
  flair picker still opens from the card's `Change color…` and the `Tab: Label` palette
  action.
- Plain hover changes no row background; the held state does.
- A coarse dot tap selects the row; the rail still opens the card.

### Gates

Full set: `go test ./...` · `tsc` · `vitest` · `just test-e2e "window-marker-gutter"` ·
`just test-e2e "row-flyout"` · `just build`. **One e2e invocation at a time** — the runner
kills any listener on :3020 machine-wide, and a second run started during the first's
teardown fails with a real-looking `ECONNREFUSED`.

### Size estimate

~8 frontend files + the backend flip. Roughly +600 / −900 (it deletes more than it adds).

## Phase 3 — The spring-loaded pad

**One question: does the gesture hold at every edge?**

Six of #767's seven defects were here. Keep this change small and review it hard.

### Scope

- `app/frontend/src/components/sidebar/marker-pad.tsx` *(new; copy from #767, then apply the
  traps below)* — the 3 mode rows × (∅ + 3 stage columns) grid, the pure
  `selectCell(current, dx, dy, pitch)` relative-displacement helper, `stepStage`, the header
  line `<mode> · <gloss>`, the highlight ring, and the placement helpers.
- `window-row.tsx` — the fine-pointer press target (`absolute inset-y-0 left-0 w-[22px]`),
  the press → 2D drag → release-commits gesture with live row preview, the no-move release
  leaving a click menu, Escape/outside dismissal, wheel stage-stepping, and the
  `marker-pad:open` CustomEvent listener.
- `app.tsx` — `buildTabPickerActions(server, windowId)` exporting the `window-label` and
  `window-marker` (`Tab: Marker`) palette entries, registered in the terminal group.
- `sidebar/index.tsx` — the marker write seam becomes an **optional** `onWindowMarkerChange`
  prop supplied by `app.tsx` and omitted by `board-page.tsx`, mirroring `onForkWindow`.

### The two defects found by hand after #767 shipped

**(a) No Marker section in the row hover card.** Do not port #767's `Marker` action row into
`row-flyout-card.tsx`, and do not build the pad's `inline` mode or its 28px cell variant. The
card keeps `Change color…` → fork → fix-tab-name → pin → kill. **This changes the
coarse-pointer story — resolve OQ-1 before building.**

**(b) Opening one pad must dismiss another.** On #767, pressing another row's marker strip
left the first pad open; dismissal only fired when the press landed elsewhere on a row.
Verified cause: `onStripDown` calls `e.stopPropagation()`, so the pad's document-level
**bubble-phase** `pointerdown` listener never sees a press that lands on another strip.
Fix with the pattern this codebase already uses for exactly this class of problem — the
module-scoped single-open registry in
`app/frontend/src/components/sidebar/row-flyout-card.tsx` (`let activeFlyout: { close: () =>
void } | null`, closed by the next opener). Give the pad the same registry so opening any pad
closes the previous one regardless of event plumbing; registering the outside-dismiss
listener in the **capture** phase (the idiom the tree's Escape-to-clear already uses) is a
reasonable belt alongside it. Cover it with a test that mounts two rows, opens the first
pad, presses the second row's strip, and asserts exactly one pad is mounted.

### Known traps (each was a real #767 finding)

- **The pad must fit the smallest sidebar.** `chrome-context.tsx` allows a 160px sidebar; a
  ~180px pad clips because the placement clamp collapses `maxLeft` to `minLeft`. Make the
  width a function of the available sidebar width and let the grid shrink (label column
  `minmax(0, 54px)`, cells no smaller than ~22px). Test placement at 160px **and** 300px, for
  the first and last visible rows, asserting the box stays inside the sidebar.
- **From ∅, the first vertical step must land on `manual`**, not `auto`. The ∅ cell spans all
  three mode rows, so an unmarked row has no row of its own; only *further* downward pitches
  advance the mode.
- **Wheel: only a vertical wheel steps.** `deltaY === 0` (a horizontal or momentum-tail
  event) must return without `preventDefault`. And React registers `wheel` **passively** at
  the root, so `preventDefault` inside `onWheel` is a no-op — attach a native non-passive
  listener via a ref, or the sidebar scrolls out from under the row being stepped.
- **Escape must revert the preview**, not merely close: an arrow walk previews cells, so
  Escape restores the committed marker.
- **Board route gets no marker seam.** `BoardPage` mounts `Sidebar` with `currentServer=null`
  and must supply no `onWindowMarkerChange`; assert the strip is absent there.
- **Test the palette action through the production registry**, not a copy of the builder —
  deleting the real `window-marker` registration must fail the test.

### Acceptance

- Press → drag one pitch right → release commits the next stage; drag down commits the next
  mode; over-drag clamps to the edge cell; a no-move release commits nothing and leaves the
  click menu open.
- Opening a second row's pad dismisses the first (exactly one pad mounted).
- The pad's box stays inside the sidebar at 160px and 300px, on the first and last rows.
- Wheel steps only on marked rows, only for non-zero `deltaY`, and does not scroll the
  sidebar.
- `Tab: Marker` opens the pad on the current row; arrows move, Enter/Space commit, Escape
  reverts and closes.
- The row hover card contains **no** Marker section.
- A strip press never selects the row and never starts an HTML5 drag.

### Gates

Full set, plus **manual exercise on a real server at desktop and mobile widths** before ship
— open two pads in sequence, drag past both edges, wheel over marked and unmarked rows, and
walk the pad by keyboard.

### Size estimate

~5 files + one new component. Roughly +900 / −100.

## Open questions

**OQ-1 — how are markers set on a coarse pointer, now that the card's Marker section is
gone?** Phase 2 leaves coarse rows displaying markers with no way to set one, and phase 3's
strip press target is fine-pointer-only. Options:

1. *(recommended)* Make the strip tappable on coarse: a tap opens the pad in click-menu mode.
   The strip is 22 × 36px on a coarse row — narrow but deliberate, and unlike the retired dot
   zone it opens the marker pad rather than competing with the flyout card.
2. Leave coarse display-only and reach the pad through the `Tab: Marker` palette entry, which
   is already keyboard/touch reachable. Zero new touch targets.
3. Keep a Marker row in the card on coarse only — closest to #767, but contradicts the
   "no Marker section in the hover popup" decision if that was meant to apply everywhere.

**Confirm with the author before building phase 3.** The choice changes phase 3's scope but
nothing in phases 1–2.

**OQ-2 — does `auto` ever get written by tooling?** The design allows a later writer (e.g.
`fab fff` stamping `auto` on entry and clearing on exit) to stamp the same option at
lifecycle boundaries. All three phases keep the option user-owned and the names generic;
nothing here wires fab. Revisit only after phase 3 ships.

## Sequencing and pickup

| Phase | Depends on | Ship independently? |
|-------|-----------|---------------------|
| 1 — expand | this PR merged | Yes — invisible, safe to sit indefinitely |
| 2 — migrate + contract | phase 1 merged | Yes — a visible improvement even if phase 3 never lands |
| 3 — the pad | phase 2 merged, OQ-1 answered | Yes |

Pick up a phase with `/fab-new` using that phase's section as the description, then
`/fab-fff`. Each phase's "one question", known traps and acceptance list are written to be
pasted into the intake.
