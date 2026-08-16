# Intake: Status-Bar Segment Reorder + `out` Register Removal

**Change**: 260816-499u-status-bar-reorder-drop-out
**Created**: 2026-08-16

## Origin

Synthesized from a `/fab-discuss` session on 2026-08-16, dispatched promptless (`/fab-draft`-style create-intake, `{questioning-mode} = promptless-defer` — no questions asked; would-be questions recorded as deferred Unresolved rows). The user's decisions from that session:

> **Change: Status-bar segment reorder + `out` register removal** (desktop StatusBar, `app/frontend/src/components/status-bar.tsx`; register resolvers in `app/frontend/src/components/sidebar/registers.ts`).
>
> Problem: the left cluster's display order today is status-pyramid ascending (cwd → tmx → out → ⑂ git → agt → fab → pr), which puts the items the user finds most useful (PR link/status, branch) at the END of the cluster while the least useful hold the prime left-edge positions. The `out` register ("last output" line) has not been useful in the strip.
>
> Decisions: (1) reorder the left cluster to relevance-descending ⑂ branch → pr → fab → agt → tmx → cwd (branch-first deliberately — stable anchor; PR-first rejected as twitchy); (2) delete the `out` segment outright — strip segment, overflow-menu row, and the now-unused per-second `useNow` clock in `WindowCluster` — while `getOutputLine` itself stays in `sidebar/registers.ts`; (3) keep `tmx` in the strip (demote-to-menu proposal explicitly rejected), slotted before `cwd`; (4) survival/breakpoint ladder preserved (cwd <xl, tmx <lg, git <md; agt/fab/pr never drop), overflow rows keep the inverse-breakpoint mirror; (5) right cluster unchanged; (6) update the R5 survival-order comment framing in `status-bar.tsx` and check `docs/specs/status-pyramid.md` for display-order claims.

## Why

1. **The pain point**: the desktop status bar's left window cluster renders in status-pyramid *ascending* order (`cwd → tmx → out → ⑂ git → agt → fab → pr` — see `WindowCluster` in `app/frontend/src/components/status-bar.tsx:194–271`). The segments the user reads most — the PR link/status and the git branch — sit at the far *end* of the cluster, while the least-consulted identity rows (`cwd`, `tmx`) hold the prime left-edge positions. The eye has to scan past four low-value segments to reach the high-value ones.
2. **The `out` register earns no place in the strip**: the "last output" line (`out active · claude` / `zsh — idle 3m since last output`) has not been useful in this compact surface. It also carries a real cost: it is the *only* consumer of the per-second `useNow()` clock in `WindowCluster` (`status-bar.tsx:180,189`), so the entire window cluster re-renders every second solely to tick a line nobody reads there.
3. **Consequence of not fixing**: the most-used affordances stay hardest to find on every terminal-route glance, and the strip keeps paying a per-second re-render for a dead segment.
4. **Why this approach**: pure presentational reordering + segment deletion inside the existing mirror architecture — no derivation changes, no new state, no new fetches. A PR-first "pure relevance" order was considered and **rejected**: pr/fab/agt are volatile per-window segments (a window without a PR renders no `pr` segment at all), so putting them leftmost makes the bar's left edge jump as the user switches windows. Branch-first wins because the branch is the stable anchor (always present in a worktree pane) and pairs naturally with the PR segment beside it.

## What Changes

All changes are in the desktop StatusBar (`app/frontend/src/components/status-bar.tsx`) and its tests. Mobile renders no status bar; only desktop ≥640px is affected. The bar remains a MIRROR, not a rollup — nothing is re-derived, nothing new is fetched.

### 1. Left-cluster reorder (relevance-descending)

Reorder the JSX in `WindowCluster` (`status-bar.tsx:194–271`) from the current
`cwd → tmx → out → ⑂ git → agt → fab → pr`
to
**`⑂ git → pr → fab → agt → tmx → cwd`**.

- Each segment keeps its existing markup, conditional rendering, and breakpoint class verbatim — only DOM order moves: `cwd` keeps `hidden xl:flex`, `tmx` keeps `hidden lg:flex`, `⑂ git` keeps `hidden md:flex` and its `gitBranch &&` guard; `agt` (with its leading `StatusDot`), `fab`, and `pr` (open-first anchor when `prUrl`) keep no breakpoint class (never drop).
- Branch-first (not PR-first) is deliberate: the branch is the stable left-edge anchor; the volatile per-window segments (pr/fab/agt) come next; identity rows (`tmx`, `cwd`) trail.

### 2. `out` segment deletion

- **Strip segment**: delete the `out` `<Segment>` (`status-bar.tsx:208–210`, `hidden min-[900px]:flex`). The `min-[900px]` breakpoint disappears from the strip entirely (no other segment uses it).
- **Overflow-menu row**: delete the `out` `textRow` (`status-bar.tsx:399`, `min-[900px]:hidden`).
- **Clock subscription**: delete `const nowSeconds = useNow()` and the `outLine` resolution in `WindowCluster` (`status-bar.tsx:180,189`) — `out` is the only consumer there, so removal stops the cluster re-rendering every second. Remove the now-unused `useNow` and `getOutputLine` imports from `status-bar.tsx` (`getAgentLine`/`getFabLine`/`getPrSegments` stay).
- **`getOutputLine` STAYS in `app/frontend/src/components/sidebar/registers.ts`**: the sidebar row-flyout card (`row-flyout-card.tsx:314`) and the PANE panel (`status-panel.tsx:426`) still consume it. No change to `registers.ts` itself.

### 3. `tmx` kept in the strip

An earlier proposal to demote `tmx` to the overflow menu only was **explicitly rejected by the user**. `tmx` stays a strip segment, slotted before `cwd` in the new order, keeping its `hidden lg:flex` breakpoint.

### 4. Survival/breakpoint ladder preserved

- Unchanged drop thresholds: `cwd` drops <xl, `tmx` drops <lg, `git` drops <md; `agt`/`fab`/`pr` never drop. The right cluster's ladder is untouched.
- With the new display order this becomes the single simpler rule the comments can now state: **rightmost dies first** — display order matches survival order (descending relevance), so the droppable segments die right-to-left (`cwd` → `tmx` → `git`).
- The overflow `…` menu rows keep their inverse-breakpoint mirror (`cwd` → `xl:hidden`, `tmx` → `lg:hidden`, `git` → `md:hidden`); the `out` menu row is deleted with the segment. Menu window rows are reordered to mirror the new strip order (`git` → `tmx` → `cwd`) so the menu reads as the strip's continuation (Confident assumption #8 — not explicitly discussed; consistency default, trivially reversible).

### 5. Right cluster unchanged

cpu/mem/ld metrics + flyout, server name, hostname+version, ⌘K hint, compose hint, overflow chevron, connection dot — all untouched, including their own degradation ladder.

### 6. Doc/comment touchpoints

- `status-bar.tsx` frames the current order as status-pyramid-ordered in three places: the file-header R5 ladder doc (lines ~61–74, "the left cluster dies in status-pyramid order — cwd (≥xl), tmx (≥lg), out (≥900px), git (≥md)"), the `WindowCluster` docstring (~175–178, "Owns the leaf-scoped `useNow` clock for the `out` register"), and the in-JSX survival-order comment (~196–198). Update the framing rather than silently contradicting it: display = descending relevance (rightmost dies first); survival semantics unchanged; drop the `out`/`useNow` references.
- `docs/specs/status-pyramid.md` was checked during intake: it makes **no claim** about the status bar's display order (no "status bar"/"strip"/"display order" mentions) — no spec edit needed.
- The status-bar section of memory (`docs/memory/run-kit/ui/status-signals.md` § Status Bar) states the old left-cluster order and ladder — hydrate updates it (see Affected Memory).

### 7. Tests (Test Integrity: tests conform to spec)

- **Unit `app/frontend/src/components/status-bar.test.tsx`**: update to the new order and the absence of `out` —
  - "renders the tmx/cwd/git/out registers…" (line 79–87): drop the `out` expectation (`zsh` text) and rename; optionally assert the new left-to-right DOM order.
  - Overflow-menu test (line 240): drop `expect(texts.some((t) => t?.startsWith("out ")))`.
  - Ladder test comment (line 262): drop the `out at ≥900px` mention.
- **E2E `app/frontend/tests/e2e/status-bar.spec.ts` + sibling `.spec.md`** (Constitution: Test Companion Docs — same-commit update): the ~800px width-sweep case (line ~140) currently expects `cwd`/`tmx`/`out` dropped and `out` listed in the menu — update to cwd/tmx only; the `.spec.md` steps mirror the change.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Status Bar — left-cluster segment order (now relevance-descending: ⑂ git → pr → fab → agt → tmx → cwd), removal of the `out` segment/menu row from the bar's register surface, and the degradation-ladder wording ("rightmost dies first"; ladder thresholds unchanged; `out` no longer in the ladder).

## Impact

- `app/frontend/src/components/status-bar.tsx` — reorder + deletion + comment updates (single component; `WindowCluster` and `OverflowMenu` internals).
- `app/frontend/src/components/status-bar.test.tsx` — order/absence updates.
- `app/frontend/tests/e2e/status-bar.spec.ts` + `status-bar.spec.md` — width-sweep and menu-content updates.
- `app/frontend/src/components/sidebar/registers.ts` — **no code change** (`getOutputLine` retained for `status-panel.tsx` and `row-flyout-card.tsx`).
- `docs/specs/status-pyramid.md` — verified no display-order claim; no edit.
- No backend, no API, no derivation changes (Constitution X untouched — the bar stays a mirror). Desktop-only (≥640px); mobile unaffected. Small perf win: `WindowCluster` stops re-rendering every second.

## Open Questions

- None — all decision points were resolved in the /fab-discuss session or graded as assumptions below (promptless-defer produced no deferred Unresolved rows).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Left cluster reordered to ⑂ git → pr → fab → agt → tmx → cwd (branch-first) | Discussed — user chose branch-first over PR-first (stable anchor vs volatile segments); exact order given verbatim | S:95 R:90 A:95 D:95 |
| 2 | Certain | Delete the `out` strip segment, its overflow-menu row, and `WindowCluster`'s `useNow` clock; keep `getOutputLine` in `registers.ts` | Discussed — deletion and the resolver-stays carve-out both explicit; other consumers (`status-panel.tsx`, `row-flyout-card.tsx`) verified in source | S:95 R:85 A:95 D:95 |
| 3 | Certain | `tmx` stays in the strip, slotted before `cwd` | Discussed — user explicitly rejected the demote-to-menu proposal | S:95 R:90 A:95 D:90 |
| 4 | Certain | Survival breakpoints unchanged (cwd <xl, tmx <lg, git <md; agt/fab/pr never drop); inverse menu-row mirror kept | Discussed — "ladder preserved" stated; per-segment classes verified in source and carried verbatim | S:90 R:85 A:95 D:90 |
| 5 | Certain | Right cluster untouched | Discussed — stated verbatim | S:95 R:95 A:95 D:95 |
| 6 | Certain | `docs/specs/status-pyramid.md` needs no edit | Decision 6 asked to check; verified during intake — the spec makes no status-bar display-order claim | S:85 R:95 A:95 D:90 |
| 7 | Confident | In-file comment framing becomes "display = descending relevance, rightmost dies first; survival semantics unchanged" across the header doc, `WindowCluster` docstring, and JSX comment | Discussed at the framing level; exact wording left to apply — one obvious reading, trivially revisable | S:75 R:90 A:85 D:80 |
| 8 | Confident | Overflow-menu window rows reordered to mirror the new strip order (git → tmx → cwd) | Not explicitly discussed; consistency with the strip is the clear front-runner and the change is trivially reversible | S:40 R:90 A:60 D:55 |
| 9 | Confident | Unit + e2e tests (incl. `.spec.md` companion) updated to the new order/absence of `out`, same commit | Constraint stated (Test Integrity); exact assertions are mechanical consequences of decisions 1–4 | S:80 R:85 A:90 D:85 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
