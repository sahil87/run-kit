# Intake: StatusDot Compositional Vocabulary (PR Eviction)

**Change**: 260810-aqo6-statusdot-compositional-vocabulary
**Created**: 2026-08-10

## Origin

Conversational — a `/fab-discuss` session (2026-08-09/10) that walked the full design space with
visual mocks before this intake was drafted via `/fab-draft`.

> I want to relook all of StatusDot's states, now that PR state has been moved to separate icon on
> the right. The separation of PR state should allow us simplify the StatusDots a bit, maybe remove
> one visual dimension from StatusDot (I am trying to remove the square shape).

The session compared four configurations side by side (Current / A: full PR eviction / B:
square-only removal / C: eviction + square kept), iterated on hue semantics, and locked the final
vocabulary. **The user's decisions, in order:**

1. Chose configuration **A** (full PR eviction, square retired) over B and C.
2. **Blue = building** (intake · apply · review), **green = PR-ready/landed/done** (ship ·
   review-pr · done) — apply/review turn blue; green is reserved for a change that has completed
   its local work ("PR is ready"). Explicitly capped at these TWO fab hues — the maximal
   one-fab-hue reduction was offered and **rejected**.
3. Parked-done changes render **green** (not gray floor fall-through) — "green denoting done fab
   changes" — as the resting **ring**, since the square is retired.
4. The **yellow checks-running glyph state is kept** — "actually a good idea, very informational"
   (it had been offered as a cut; the user overrode).
5. Accepted the remaining recommendations: the doc matrix is replaced by the **compositional
   legend reference**, and the code reductions below.

**Binding visual reference** (in this change folder — the execution agent MUST match these rather
than re-deriving the design):

- `reference-status-dot-final.svg` — the final compositional reference diagram (4 hue strips,
  3 shape strips, 5-state glyph strip, halo, composed examples). This file is the intended
  replacement content for the doc diagram.
- `reference-mock.html` — the full comparison mock; its "A" column is the authoritative
  row-by-row rendering for all 18 representative window states, and its "FINAL reference" section
  embeds the SVG above.

## Why

The sidebar window row now carries a rest-state git-pull-request glyph at its right edge
(93dy / PR #452-era work), colored from the shared PR vocabulary. This made the StatusDot's PR
tier **redundant**: a merged fab PR renders a purple `done` square on the dot AND a purple glyph
on the same row — the same fact encoded twice, two pixels apart (user's screenshot showed 4 such
rows at once). Beyond the duplication:

1. **The dot is overloaded.** Palette v3 packs 6 hues × 5 shapes into a 7px dot, where the PR
   tier displaces live pipeline state (a fab window with a PR never shows its stage on the dot).
2. **The vocabulary is non-compositional.** Shape meaning shifts per row (pending = "checks
   running" only on PR rows; done = "merged" there, "parked" elsewhere), so the doc needs a 6×5
   matrix with per-cell captions and two special-cased rows.
3. **If we don't fix it**: every new PR-adjacent state (draft, pending) pressures the dot further,
   and the double-encoding grows with the glyph's vocabulary.

**The chosen approach**: split by *story*, not by precedence — the **dot tells the local story**
(what runs in this pane: which journey, is it healthy, does it need me) and the **glyph tells the
remote story** (the branch's PR on GitHub). This removes two hues (purple, orange) and two shapes
(done square, skipped ring) from the dot, makes shape meaning uniform across every hue
(fully compositional), and lets the doc replace the matrix with four small legend strips.
Alternatives rejected: square-only removal (keeps the double-encoding and makes merged
indistinguishable from open on the dot), one-fab-hue maximal reduction (loses the "still cooking
vs out the door" glance the user explicitly wants).

## What Changes

### 1. Dot model — `app/frontend/src/components/pr-status-model.ts`

The ladder loses its PR branches entirely:

```
fabChange ?  (stage ∈ {intake, apply, review} ? blue-building : green-prReady, shape by fabDisplayState)
          :  (fresh agentState ? yellow agent (solid mid-turn / ring idle) : gray floor)
waiting   →  additive yellow halo, unchanged
```

- **`DotPhase`** shrinks 6 → 4: `building | prReady | agent | none` (replacing
  `intake | apply | pr | agent | agentPr | none`). `PHASE_HUE`:
  `building: text-blue-400`, `prReady: text-accent-green`, `agent: text-yellow-400`,
  `none: text-text-secondary`. `text-purple-400` / `text-orange-400` leave the dot's hue map
  (purple stays in the glyph/segment vocabularies).
- **`fabPhase(stage)`** becomes the two-stop split: `intake`/`apply`/`review` → `building`;
  `ship`/`review-pr`/`done` and unknown/absent → `prReady`. The split is **stage-based, never
  `prNumber`-based** — the dot must not consult PR fields (alignment with PR existence stays
  emergent, since `/git-pr` creates the PR mid-ship, mirroring the old spec's "emergent, not a
  stage check" fact).
- **`DotShape`** shrinks 5 → 3: `ring | solid | failed`. **`done` and `skipped` are deleted.**
- **`fabShape(displayState)`**: `pending` → `ring`, `failed` → `failed`, **`done` → `ring`**
  (parked = resting), `active`/`ready`/unknown → `solid`. A `skipped` display-state no longer maps
  to a shape — see the ladder note below.
- A **`skipped`** fabDisplayState falls through to the **gray floor** in `statusDotState` (a
  skipped change has left its journey; the old behavior forced gray anyway — now it simply isn't a
  fab-owned dot). <!-- assumed: skipped-displayState → floor fall-through rather than a green/gray fab ring — matches the old forced-gray rendering with less machinery -->
- **`prShape()` is deleted.** `prDotState()` is retained (the glyph color logic and PR text
  surfaces consume its semantics).
- **`prOwnsDot()` is retained as the glyph gate only** (`prNumber` present and not
  closed-unmerged) and SHOULD be renamed to reflect that (e.g. `prOwnsGlyph`), updating its
  import sites. <!-- assumed: rename prOwnsDot→prOwnsGlyph since it no longer gates any dot; keeping the old name is acceptable if the rename churns too many sites -->
- **`statusDotState()`** loses both `prOwnsDot(...)` branches; the fab arm becomes
  `{ phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState), waiting }` (plus the
  skipped fall-through), the agent arm becomes
  `{ phase: "agent", shape: idle ? "ring" : "solid", waiting }` with no `agentPr` case.

### 2. Glyph vocabulary — `prGlyphColor()` gains a pending state

New five-way mapping (branch order IS the design; first match wins):

1. `text-red-400` — fail-ish (`prDotState` → `fail`): checks fail / changes requested. Fail stays
   on top.
2. `text-text-secondary` — open draft (unchanged; draft stays muted-gray even while its checks
   run, matching GitHub's draft-gray treatment). <!-- assumed: draft outranks the new pending-yellow — drafts are deliberately muted today and pending would un-mute them -->
3. **`text-yellow-400` — open with `prChecks === "pending"` (NEW: checks running).** The row-level
   compensation for losing the purple pending ring; reuses the established
   `PR_CHECKS_COLORS.pending` token choice.
4. `text-accent-green` — open, checks pass or no decisive signal.
5. `text-purple-400` — merged.

Closed never reaches the glyph (gate unchanged). No dot involvement.

### 3. Dot rendering — `app/frontend/src/components/status-dot.tsx`

- Delete the `done` (sharp square) and implicit `skipped` branches; three renderers remain:
  `solid`, `ring`, `failed` (dotted 9px ring + 3px red center — unchanged), plus the additive
  waiting halo (unchanged, including reduced-motion static ring).
- The `skipped`-forces-gray color special case in `StatusDot` is deleted along with the shape.
- Header comment rewritten to the compositional model (dot = local story, glyph = remote story).

### 4. Labels — `status-dot-label.ts`

`dotLabel` composes from the new vocabulary: phase word (`building` / `PR-ready` / `agent` /
floor-bare) + status word (`active`·`ready` / `pending`·`idle`·`parked` / `failed`) + the waiting
suffix. PR-specific labels (`"PR — merged"` etc.) leave the dot's label space — the PR facts live
in the flyout/register surfaces, which already render them. Exact wording is apply's to settle;
the composition rule (hue-word + shape-word, no PR words) is the requirement.

### 5. Glyph surfaces — parity where the dot renders without a register view

- `sidebar/window-row.tsx` — glyph already present; picks up the yellow pending state via
  `prGlyphColor`.
- `session-tiles/session-tiles.tsx` — **add the rest-state glyph** to the window-row line (same
  gate, same color fn, same `aria-hidden` decoration semantics), since evicting PR from the dot
  would otherwise leave board/dashboard tiles with no PR signal at all.
  <!-- assumed: session tiles get the glyph for parity; the pane panel does NOT (its register view already shows the full PR line) -->
- `sidebar/status-panel.tsx` (pane panel) — no glyph; its register view is the detail surface.
- `board-pane.tsx` — inspect at apply: if its header renders a StatusDot without any PR register,
  add the glyph under the same rule; otherwise leave untouched.

### 6. Documentation — `docs/site/status-dot.md` + `docs/img/`

- Replace `docs/img/status-dot-matrix.svg` with the **compositional reference** — content is this
  change folder's `reference-status-dot-final.svg`, verbatim (minus any final polish apply needs
  for rendering fidelity). SHOULD be renamed to `status-dot-reference.svg` (it is no longer a
  matrix), updating the image reference in `docs/site/status-dot.md`; keeping the old filename is
  the fallback if external links matter. <!-- assumed: rename the SVG to status-dot-reference.svg + update referencing markdown; overwrite-in-place is the fallback -->
- Rewrite `docs/site/status-dot.md` to the compositional structure: the four legend strips (hue /
  shape / glyph / halo) replace the precedence prose + 6×5 matrix. Specifically:
  - The ladder section drops both PR branches; D1 (per-family PR ownership) **dissolves** — no
    family owns the dot via PR; the glyph is un-family-gated as it already is today.
  - D2 (merged durability via `--state all` derivation) **survives untouched** but is reworded:
    it feeds the **glyph's** durable purple merged state, not a dot square.
  - "Red is used in exactly one way" becomes the honest split: **dot-red appears only as the
    failed center; glyph-red = failing PR** (the glyph already uses red today — the old absolute
    claim was stale).
  - The Row Minimalism "survives as" table updates: `done`-parking → green resting ring;
    PR states → the glyph column.
- Update `docs/specs/status-pyramid.md` (the design authority): channel-model table, tier ladder,
  and the decision table collapse to the compositional vocabulary (rows 6–10 and 17–20 rewrite;
  the fab family becomes blue building → green PR-ready). Mark the palette-v3 sections as
  superseded rather than deleting the rationale history.

### 7. Tests

- `status-dot.test.tsx`, `status-dot-label` coverage, `window-row.test.tsx`,
  `sidebar.test.tsx`, `row-flyout-card.test.tsx` — update expectations to the new
  phases/shapes/labels and the glyph's pending state; add session-tiles glyph coverage.
- Playwright specs asserting dot/glyph rendering (e.g. `pr-status-sidebar`, `status-dot-tip`
  lineage) — update per the new vocabulary, and update sibling `.spec.md` companions in the same
  commit (constitution: Test Companion Docs).

### 8. Explicitly unchanged

- The waiting halo (additive, constant-yellow, reduced-motion static ring) — mechanism and CSS.
- The two-family top of the ladder (fabChange > fresh agent > floor) and #314 freshness rules.
- The backend D2 branch→PR derivation, default-branch carve-out (#389), and all `WindowInfo`
  fields — **zero backend changes**.
- The register view (`out`/`agt`/`fab`/`pr`), flyout card, and pane-panel PR segments.
- `PR_STATE_COLORS` / `PR_CHECKS_COLORS` / `PR_REVIEW_COLORS` and `prDotState`.

## Affected Memory

- `run-kit/ui-patterns`: (modify) StatusDot vocabulary — replace the palette-v3 6-hue/5-shape
  model with the compositional 4-hue/3-shape + glyph-channel model; record the dot=local /
  glyph=remote ownership split and the blue→green two-stop fab hue.

## Impact

- **Frontend only.** Core: `pr-status-model.ts`, `status-dot.tsx`, `status-dot-label.ts`,
  `sidebar/window-row.tsx`, `session-tiles/session-tiles.tsx` (+ `board-pane.tsx` inspection).
  Consumers to sweep for `DotPhase`/`DotShape`/`prShape`/`prOwnsDot` imports:
  `sidebar/registers.ts`, `sidebar/row-flyout-card.tsx`, `sidebar/status-panel.tsx`.
- **Docs**: `docs/site/status-dot.md`, `docs/img/status-dot-matrix.svg` (replaced/renamed),
  `docs/specs/status-pyramid.md`.
- **Tests**: unit tests colocated with the components above; Playwright specs + `.spec.md`
  companions covering dot/glyph rendering.
- **No backend, no API, no SSE payload changes.** No new routes (Constitution IV untouched).
- Note: `session-tiles.tsx` contains a deliberate NUL byte at line ~63 — plain `grep` sweeps skip
  it silently; use `grep -a` or perl when sweeping import sites.

## Open Questions

- None — all decision points were resolved in the originating discussion or graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | PR is fully evicted from the dot; the right-edge glyph is the row's only PR channel (config A over B/C) | User chose A explicitly after viewing all four mocked configurations | S:95 R:60 A:90 D:95 |
| 2 | Certain | Fab hues: blue = building (intake·apply·review), green = PR-ready/landed/done (ship·review-pr·done); exactly two fab hues | User directed the blue/green split across two iterations and explicitly rejected the one-hue reduction | S:95 R:70 A:90 D:90 |
| 3 | Certain | Done square + skipped shape retired; parked-done = green resting ring | User: "green denoting done fab changes" after choosing A (square gone); ring is the only resting shape left | S:90 R:70 A:90 D:85 |
| 4 | Certain | Glyph gains yellow checks-running state (`text-yellow-400`, open + checks pending) | User overrode the offered cut: "actually a good idea, keep it - very informational" | S:95 R:90 A:90 D:95 |
| 5 | Certain | Doc matrix replaced by the compositional legend reference; `reference-status-dot-final.svg` in this folder is the binding artwork | User approved the final reference render and asked for it to ride with the intake | S:90 R:85 A:90 D:90 |
| 6 | Certain | blue↔green split is stage-based (`fabStage`), never `prNumber`-based | Recommended with rationale (dot must not consult PR fields; alignment stays emergent) and accepted in "ok with the rest" | S:80 R:75 A:90 D:85 |
| 7 | Confident | `skipped` fabDisplayState falls through to the gray floor | Old rendering already forced gray; fall-through achieves it with less machinery; state is rare | S:55 R:85 A:75 D:70 |
| 8 | Confident | Glyph precedence: fail > draft > pending-yellow > open-green > merged-purple (draft outranks pending) | Draft is deliberately muted today; letting pending un-mute drafts would contradict the e30p draft-gray decision | S:50 R:90 A:75 D:65 |
| 9 | Confident | Session tiles gain the rest-state PR glyph; pane panel does not (register view covers it); board-pane inspected at apply | Discussed as the coverage gap ("glyph is sidebar-only"); parity rule follows the dot=local/glyph=remote split; easily reversed | S:60 R:85 A:70 D:65 |
| 10 | Confident | `docs/specs/status-pyramid.md` is updated in this same change (supersede palette-v3 sections, keep rationale history) | Spec is the named design authority; shipping code that contradicts it violates the repo's spec-first testing posture | S:55 R:80 A:80 D:75 |
| 11 | Confident | Rename `prOwnsDot` → `prOwnsGlyph` (import sites updated) | Name becomes false after eviction; trivially reversible naming call with a clear front-runner | S:35 R:90 A:60 D:45 |
| 12 | Confident | Rename `docs/img/status-dot-matrix.svg` → `status-dot-reference.svg` + update markdown refs | It is no longer a matrix; external raw-path links are the only risk and overwrite-in-place is the documented fallback | S:35 R:75 A:55 D:40 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
