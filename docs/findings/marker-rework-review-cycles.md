# Window-row marker rework — why one change took ten review cycles (post-mortem)

**Date**: 2026-08-30
**Context**: PR [#767](https://github.com/sahil87/run-kit/pull/767) (`260829-yneo-window-row-marker-well-3x3`)
reworked the sidebar window row's marker into a 3×3 mode × stage model with a spring-loaded pad.
It passed every gate and was never merged: the pipeline needed **ten review cycles** against a
budget of three, and the last five were hand-driven after the auto-rework loop correctly gave up.
This records what the cycles were actually spent on, so the same work can be re-executed as three
changes instead of one. The execution plan is
[`fab/plans/sahil/26-08-30-marker-rework-split.md`](../../fab/plans/sahil/26-08-30-marker-rework-split.md).

## Headline numbers

| Metric | Value |
|--------|-------|
| Review cycles | **10** (budget: 3) |
| Findings raised | 20 |
| Genuine defects among them | **7** |
| Findings that were comment hygiene (one acceptance item) | **8** |
| Requirement reversals — "this isn't what was asked for" | **0** |
| Files changed | 59 (~34 of them code) |
| Plan tasks / acceptance items | 24 / 42 |
| Intake-ready → PR | ~7½ h |

The zero matters most: across ten cycles **no finding ever said the code did the wrong thing
versus the agreed design**. The design conversation (four interactive studies, twenty explicit
decisions) produced an intake specific enough that nothing about intent churned. Every cycle was
spent on execution, and on one badly-scoped acceptance item.

## Where the twenty findings went

| Cycle | Findings |
|------:|----------|
| 1 | comment wording · unused export · dead CSS · inert ref · indentation |
| 2 | **pad clips at a 160px sidebar** · change-id in a comment · stale rail comments |
| 3 | 7 comment sites · **`Tab: Marker` asserted against a copy of the builder, not production** |
| 4 | 7 more comment sites |
| 5 | comment sites — *false positive*: pre-existing citations on lines the diff never touched |
| 6 | **from ∅ the first downward drag landed on `auto:1`, not `manual:1`** |
| 7 | **snapshot restore skipped normalization** · **inline pad Escape was a dead end** · narration wording |
| 8 | **board route received the marker seam it was specified not to have** · 200 lines of unrelated comment churn |
| 9 | **wheel treated `deltaY === 0` as "step back"** · narration wording |
| 10 | PASS |

Bold = genuine defect.

## Three root causes

### 1. The change bundled four risk classes behind one verdict

A storage-contract migration, a pure-visual rework, a brand-new interaction component and a docs
move, all gated on a single pass/fail. Any one nit anywhere reset the whole thing, and every cycle
re-ran the full gate set (Go + `tsc` + ~3,590 vitest + two Playwright suites + build ≈ 6–10 min).
Ten cycles ≈ **90 minutes of pure re-verification** of code that had already passed.

### 2. One acceptance item was unbounded, and contradicted the repo

A-041 was written as a repo-wide rule — *"no change-ids / PR numbers in code comments"* — rather
than scoped to the diff. The reviewer re-grepped whole files every cycle and kept finding the
repo's **existing** convention, which *is* to cite change ids in comments. Cycle 5's finding was a
pure false positive against untouched lines. Compounding it, the apply worker mirrors plan IDs
(`R6`, `T4`) into comments by habit, so the item was a landmine the worker itself kept re-arming.
Scoping it to "lines this diff adds or modifies" at cycle 5 is when real defects started surfacing
instead.

### 3. The exhaustion stop was a design signal, and it was overridden

The pipeline parked at `review: failed` after three cycles. That is the framework saying *this
change is mis-sized*. It was treated as an obstacle and hand-driven for five more cycles. The
correct move at cycle 3 was to stop, split, and re-enter — which is what the execution plan does.

### Contributing friction (orthogonal, but it cost real time)

- **Worker instability.** A kimi pane worker degenerated into a repeated-character wall mid-rewrite
  (killed; `agent.workers` switched to codex). Codex panes parked behind a first-run trust dialog
  and an update prompt. The tmux relay went read-only mid-run and blocked prompt delivery twice.
- **Undirected reviewer strictness.** The reviewer found the passive-wheel-listener bug and the
  160px clipping — genuinely subtle things — but spent equal energy on comment indentation, because
  nothing in the change told it where the risk was.

## The seven real defects clustered in one component

| Defect | Layer | Cycle |
|--------|-------|------:|
| Pad popover (~180px) could not fit the 160px minimum sidebar — clipped outside the box | pad | 2 |
| `Tab: Marker` was tested against a copy of the action builder, not the production registry | pad | 3 |
| From ∅, the first downward drag landed on `auto:1` instead of `manual:1` | pad | 6 |
| Escape inside the card's inline pad was a dead end — no revert, no dismiss | pad | 7 |
| Stored snapshots restored legacy marker tokens verbatim, bypassing normalization | migration | 7 |
| The board-route sidebar received the marker seam it was specified not to have | pad | 8 |
| Wheel treated `deltaY === 0` as "step back"; React's passive listener made `preventDefault` a no-op | pad | 9 |

**Six of seven were in the new interaction component; one was in the migration path; zero were in
the visual rework.** The pad is ~30% of the diff and carried ~85% of the risk — and it was reviewed
as a footnote to a 59-file change.

## Where the diff mass sat

| Area | Share of diff |
|------|--------------:|
| Backend migration | ~6% |
| Row rendering + retirements | ~23% |
| The pad | ~29% |
| Docs, study pages, fab artifacts, e2e churn | **~42%** |

Nearly half the diff was documentation and pipeline artifacts — four study pages (+1,626 lines
under `docs/`), the intake, the plan, six screenshots. Harmless individually, but they turned ~34
files of code into a 59-file PR every reviewer had to scroll past.

## Defects found after the pipeline passed

Manual testing of the merged-shape branch surfaced two more, neither of which any automated gate
caught. Both are folded into the execution plan (PR 3):

1. **The Marker section in the row hover card is unwanted** — it duplicates the strip affordance and
   clutters the card. Removing it raises a real question about the coarse-pointer path (see the
   plan's OQ-1).
2. **Opening a second row's pad does not dismiss the first.** Root cause is verified:
   `onStripDown` calls `e.stopPropagation()`, so the pad's document-level bubble-phase `pointerdown`
   listener never sees a press that lands on *another row's strip* — dismissal only fires when the
   press lands somewhere that does propagate. The codebase already solves this class of problem
   with a module-scoped single-open registry (`activeFlyout` in
   `app/frontend/src/components/sidebar/row-flyout-card.tsx`).

That an interaction defect this visible survived a passing pipeline is itself a finding: the pad
needed manual exercise, and it did not get it until after ship.

## What to change next time

1. **Split on risk class, not feature boundary.** "Migration / display / interaction" is a better
   seam than "the marker work". A change with a new component *and* a stored-format change is two
   changes.
2. **Scope quality acceptance items to the diff.** Write *"no plan or change IDs in comments this
   change adds or modifies"*. Repo-wide conventions belong in the constitution, not in a change's
   acceptance list — otherwise every review re-litigates the whole repository.
3. **Put known worker habits in the apply prompt, not the review.** The comment-provenance grep
   belongs in the dispatch prompt so the worker clears it before a reviewer ever sees it.
4. **Treat the exhaustion stop as a design signal.** Three failed cycles means re-plan, not push
   harder.
5. **Keep study/docs artifacts in their own change.** They inflate the diff and dilute review
   attention, and they do not need the same gates.
6. **Exercise new interaction manually before ship.** Unit + e2e passed while two user-visible
   interaction defects were live.
7. **Pre-warm worker panes.** Trust dialogs and update prompts are one-time per worktree; clearing
   them before the pipeline starts avoids losing a dispatch to a wall.

## What went right, and is worth keeping

- The long design conversation with four interactive HTML studies produced an intake so specific
  that **zero requirements churned** across ten cycles.
- Hydrate, ship and review-pr each passed first time.
- The reviewer, for all the noise, found seven defects a human would plausibly have merged —
  including the passive-wheel listener and the 160px clipping.
- The design itself is unchanged and remains the target; the studies in
  [`docs/wiki/`](../wiki/) are its authority.
