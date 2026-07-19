# Intake: Rename pr-status-line to pr-status-model

**Change**: 260719-8hc6-pr-status-model-rename
**Created**: 2026-07-20

## Origin

Backlog item `[8hc6]` (fab/backlog.md), processed by an autonomous backlog-sweep agent:

> Rename pr-status-line.tsx -> pr-status-model.ts: the namesake PrStatusLine component is removed and the module is now only the shared PR color-vocab + status-dot-model home; 5 consumers need import updates.

Validity verified against current code: `app/frontend/src/components/pr-status-line.tsx` contains no JSX and no React import — the `PrStatusLine` component was retired in `260715-jykd` (only NOTE comments remain). The module exports only pure model code: `isFailish`, `PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `PrDotState`, `prDotState`, `DotShape`, `DotPhase`, `StatusDotState`, `fabPhase`, `fabShape`, `prShape`, `PHASE_HUE`, `statusDotState`. Consumer count has drifted from the backlog's 5 to **7** import sites (grep `pr-status-line`, excluding the module's own test file): `status-dot.tsx`, `status-dot-tip.tsx`, `status-dot-label.ts`, `sidebar/status-panel.tsx`, `status-dot.test.tsx`, `status-dot-tip.test.tsx`, `sidebar/window-row.test.tsx`.

## Why

1. **Pain point**: the filename says "line" (a retired dashboard component) and the `.tsx` extension says "contains JSX" — both are now false. Readers grepping for the status-dot model land on a file whose name points at a component that no longer exists.
2. **Consequence of not fixing**: the misleading name keeps accruing importers (already 5 → 7 since the backlog note was written), making the eventual rename churn bigger; new contributors waste time looking for a `PrStatusLine` component that isn't there.
3. **Approach**: plain `git mv` rename to `pr-status-model.ts` + mechanical import-path updates. No logic changes. The sibling test file renames in the same commit for the same reason (it holds pure model tests, no renders).

## What Changes

### 1. File renames (`git mv`, content edits limited to stale self-references)

- `app/frontend/src/components/pr-status-line.tsx` → `app/frontend/src/components/pr-status-model.ts`
- `app/frontend/src/components/pr-status-line.test.tsx` → `app/frontend/src/components/pr-status-model.test.ts`

Inside both files, update the retirement NOTE comments if they self-reference the old filename (keep the `260715-jykd` retirement provenance intact — the note explains WHY there is no component here, which stays useful).

### 2. Import-site updates (7 files)

Replace `from "./pr-status-line"` / `from "../pr-status-line"` (whatever each site uses) with the `pr-status-model` path in:

- `app/frontend/src/components/status-dot.tsx`
- `app/frontend/src/components/status-dot-tip.tsx`
- `app/frontend/src/components/status-dot-label.ts`
- `app/frontend/src/components/sidebar/status-panel.tsx`
- `app/frontend/src/components/status-dot.test.tsx`
- `app/frontend/src/components/status-dot-tip.test.tsx`
- `app/frontend/src/components/sidebar/window-row.test.tsx`

The `window-row.test.tsx` reference at line ~161 is a comment mentioning the former `PrStatusLine` dashboard component — comments that describe the retirement history stay; only module-path references change.

Sweep note: `grep` can silently skip `session-tiles.tsx` (deliberate NUL byte at line 63) — verify it with `grep -a` or `perl` so a hidden import there isn't missed.

### 3. No API/behavior change

Exports keep their names; only the module path changes. TypeScript compile (`just check`) is the primary correctness gate; the existing unit tests (`just test-frontend`) cover the model functions.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — only if it references the `pr-status-line` module path by name (grep at hydrate time); the status-dot model description itself is unchanged.

## Impact

- 9 files touched (2 renames + 7 import updates), zero runtime behavior change.
- No backend, routes, or e2e surface affected.

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Target name `pr-status-model.ts` (drop `.tsx` — file has no JSX) | Backlog names the target explicitly; grep-verified no JSX/React import | S:90 R:90 A:95 D:90 |
| 2 | Certain | Update all 7 current import sites (not the backlog's stale count of 5) | Grep is authoritative over the stale note; compile gate catches any miss | S:75 R:90 A:95 D:90 |
| 3 | Confident | Sibling test file renames to `pr-status-model.test.ts` in the same change | Same rationale as the module (no renders, pure model tests); keeping the pair co-named follows colocation convention | S:60 R:90 A:85 D:75 |
| 4 | Confident | Retirement NOTE comments (260715-jykd provenance) are kept, updated only where they self-reference the old path | History-explaining comments remain useful; renaming shouldn't erase provenance | S:55 R:85 A:80 D:70 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
