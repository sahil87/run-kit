# Intake: Stage Bottom-Gap Parity

**Change**: 260815-g08a-stage-bottom-gap-parity
**Created**: 2026-08-15

## Origin

User bug report with screenshot on the just-merged composed-frame chrome (change `260815-19me` / PR #622), dispatched promptless via `/fab-proceed`:

> The gap from the bottom for the left panel vs the other tiles isn't the same.

Root-caused in-session with a live headless measurement before this intake was created (1440×900 desktop, `/runKit` server route): status bar top = 876; sidebar card bottom = 870 (6px gap — correct); content column bottom = 864 (12px gap — wrong). The fix was decided in the same session; this intake transfers that decision.

## Why

1. **The pain point**: On every desktop route the Shell stage renders the sidebar card and the content column above the status bar, and their bottom edges are supposed to land on the same line — 6px above the status bar, per the floating-cards vocabulary (6px gaps on the inset ground). Instead the content column sits 12px above the status bar while the sidebar sits 6px above it, a visible 6px misalignment the user spotted immediately after PR #622 merged.

2. **The root cause (measured)**: `app/frontend/src/components/shell/shell.tsx` `stageStyle` (~line 188) sets an unconditional `rowGap: "6px"` on the nested stage grid (rows `1fr auto`, areas `"sidebar content" / "sidebar bottombar"`). The bottombar row exists only in the content column and is 0-height in the normal desktop resting state (fine pointer: BottomBar self-gates to null, compose strip closed; measured `footerChildren: 0`, footer height 0). But CSS grid row-gaps apply between tracks regardless of track size, so the content column pays 6px (row-gap) + 0 (empty row) + 6px (stage padding) = 12px, while the row-spanning sidebar (`gridArea: "sidebar"` spans both rows) pays only the 6px padding.

3. **What happens if we don't fix it**: A permanently misaligned frame on every desktop route (terminal, server, board) — the composed-frame chrome that PR #622 just shipped looks visually broken at its bottom edge.

4. **Why this approach over alternatives**: Shell cannot know whether `bottomBarChildren` renders anything — BottomBar self-gates on pointer type and the compose strip mounts/unmounts on toggle — so a JS-conditional gap in Shell is not available without new prop plumbing. Moving the seam into the footer, gated on rendered content via CSS `:has`, is the established project lesson from PR #598 ("frames live in the gating component / gate the frame on the same predicate"), applied to a gap instead of a height: an empty footer contributes zero height AND zero seam; a populated footer contributes the 6px seam plus its content. Keeping a row-gap and compensating elsewhere (e.g., negative margins, conditional grid templates) was rejected as fighting the grid rather than fixing the seam's owner.

## What Changes

### 1. Remove `rowGap` from `stageStyle` (`app/frontend/src/components/shell/shell.tsx`, ~line 195)

Delete the `rowGap: "6px"` line from the `stageStyle` object. Keep `columnGap: sidebarOpen ? "6px" : "0"` and its `column-gap 150ms ease-out` transition **exactly as is** — the sidebar collapse animation is untouched.

Current code (the line to remove is `rowGap`):

```ts
const stageStyle: React.CSSProperties = {
  gridArea: "stage",
  display: "grid",
  gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px 1fr` : "0 1fr",
  gridTemplateRows: "1fr auto",
  gridTemplateAreas: '"sidebar content" "sidebar bottombar"',
  columnGap: sidebarOpen ? "6px" : "0",
  rowGap: "6px",          // ← remove
  padding: "6px",
  minWidth: 0,
  minHeight: 0,
  transition: "grid-template-columns 150ms ease-out, column-gap 150ms ease-out",
};
```

### 2. Footer gains a content-gated 6px top seam (`shell.tsx`, ~lines 249–251)

The stage's bottombar footer:

```tsx
{bottomBarChildren != null && (
  <footer style={{ gridArea: "bottombar" }}>{bottomBarChildren}</footer>
)}
```

gains a conditional top margin applied only when the footer has element children — the CSS `:has` form as a Tailwind arbitrary variant, e.g. `className="has-[>*]:mt-[6px]"` (the codebase already uses the `has-[...]` variant form, e.g. `has-[:focus-visible]:pointer-events-auto` in `window-row.tsx` / `status-panel.tsx`; use `[&:has(>*)]:mt-[6px]` only if the `>` combinator inside `has-[]` doesn't compile under the project's Tailwind 4 setup). Behavior:

- Footer with no rendered children (fine pointer, compose strip closed — the normal desktop resting state): zero height AND zero seam; the content column's bottom edge lands at the stage's inner bottom edge, flush with the sidebar card's bottom.
- Footer with content (compose strip open, or coarse-pointer BottomBar): the 6px seam appears above it, its bottom edge lands flush with the sidebar card's bottom (both at the stage's inner bottom edge), and the tile column keeps a 6px seam above the strip.

### 3. Comment updates in `shell.tsx`

Update the comments that describe the row-gap seam so they match the new mechanism — at minimum:

- The stage header comment block (~lines 60–103) where the grid's gap is described.
- The bottombar placement comment (~lines 244–248), which currently says "with the stage gap as its seam" — now the footer owns its own content-gated seam.

### 4. Regression e2e: bottom-edge parity assertion

Add an e2e assertion of the bottom-edge parity in the most natural existing suite — implementer's choice between `app/frontend/tests/e2e/surface-layout.spec.ts`'s geometry cases and the rewritten right-panel/surface-toggles spec (`right-panel.spec.ts`) — asserting, in the resting desktop state:

- sidebar `<aside>` bottom == content card bottom == status-bar top − 6px.

Update the sibling `.spec.md` in the same commit (Constitution: Test Companion Docs). A unit test cannot prove this — jsdom has no layout — so e2e is the right layer (same reasoning as the project's roving-focus precedent).

### Acceptance invariant (the definition of done)

- Resting desktop state: sidebar-card bottom == content-column bottom == status-bar top − 6px, on terminal, server, and board routes.
- Compose strip open: the strip's bottom edge == sidebar bottom, and the tile column keeps a 6px seam above the strip.

## Affected Memory

- `run-kit/ui/routes-and-shell`: (modify) The stage grid description's row-gap/seam sentences — `bg-bg-inset p-[6px] gap-[6px]` becomes padding + column-gap only, and the bottombar footer's seam is described as footer-owned and content-gated (`:has(>*)`), not a stage row-gap. Touches the stage description (~lines 107, 113) and the "Universal stage is a nested grid" Design Decision entry (~line 241).

## Impact

- `app/frontend/src/components/shell/shell.tsx` — `stageStyle` rowGap removal, footer conditional margin, comment updates. Desktop-only: the mobile grid has no stage, so the mobile branch is untouched by construction.
- One e2e spec (`surface-layout.spec.ts` or `right-panel.spec.ts`) + its sibling `.spec.md`.
- No backend, API, or routing changes. No new dependencies.

**Constraints**:

- Tests only via `just` recipes (`just test-frontend`, `just test-e2e "<spec>"`). Known pre-existing flakes not attributable to this change: "Maximum update depth exceeded" console noise, window-heading history-arrows forward-nav timeout, back-to-back test-e2e ECONNREFUSED.
- The working tree carries an UNRELATED uncommitted archive move (`fab/changes/archive/...` for the completed 260815-19me change + index/pointer edits) that must ride along into the eventual commit — do not revert it.

## Open Questions

- None — the fix, mechanism, test layer, and acceptance invariant were all decided in the originating session with live measurements.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove `rowGap: "6px"` from `stageStyle`; keep `columnGap` + its collapse transition untouched | Decided in-session from a live measured root cause (12px vs 6px bottom gaps); the row-gap is provably the source | S:95 R:90 A:95 D:95 |
| 2 | Certain | Seam moves into the footer, gated on rendered content via CSS `:has(>*)` conditional top margin | Decided in-session; direct application of the PR #598 project lesson (gate the frame in the gating component); Shell cannot know `bottomBarChildren` render state | S:90 R:85 A:90 D:90 |
| 3 | Certain | Tailwind variant form: `has-[>*]:mt-[6px]`, falling back to `[&:has(>*)]:mt-[6px]` if the combinator doesn't compile | Codebase already uses `has-[...]` variants (window-row.tsx, status-panel.tsx); exact compile behavior of `>` inside `has-[]` under this Tailwind 4 setup verified at apply | S:80 R:95 A:75 D:80 |
| 4 | Certain | E2E parity assertion lands in an existing suite — surface-layout.spec.ts geometry cases or right-panel.spec.ts, implementer's choice; sibling `.spec.md` updated same commit | Explicitly delegated to the implementer in the originating decision; both suites exist and either placement is trivially reversible | S:75 R:95 A:85 D:70 |
| 5 | Certain | E2E is the sole test layer for the parity invariant — no unit test | jsdom has no layout engine; established project precedent (roving-focus) | S:85 R:90 A:95 D:95 |
| 6 | Certain | Mobile branch untouched | The stage grid is desktop-only by construction; the mobile grid has no stage | S:95 R:95 A:100 D:100 |
| 7 | Certain | The unrelated uncommitted 260815-19me archive move rides along into the eventual commit — never reverted | Explicit constraint from the dispatching session | S:90 R:85 A:95 D:95 |

7 assumptions (7 certain, 0 confident, 0 tentative, 0 unresolved).
