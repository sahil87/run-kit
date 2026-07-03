# Intake: Pane-Panel PR Row Open-First Action

**Change**: 260703-41ks-pr-row-open-first-action
**Created**: 2026-07-03

## Origin

Synthesized from a user conversation and dispatched promptless (`{questioning-mode} = promptless-defer` — no questions asked; the description below is the sole source). All four numbered decisions were explicitly confirmed by the user in that conversation.

> **Feature**: In the Pane panel (`app/frontend/src/components/sidebar/status-panel.tsx`, `WindowContent`), the `pr` row currently follows the panel-wide "click row = copy" pattern: the row body is a `CopyableRow` that copies the PR URL, and a hover-revealed `↗` link (absolutely positioned, right-aligned, always visible on coarse pointers) opens the PR in a new tab. The user decided the PR row's default action should be **open**, not copy.
>
> **Decisions made (all confirmed by the user):**
> 1. The row body becomes a real `<a href={prUrl} target="_blank" rel="noopener noreferrer">` — NOT a button calling window.open — so middle-click, Ctrl+click, and right-click → "Copy link address" work natively. Rationale: cross-surface consistency (the other PR surface, `PrStatusLine` in `app/frontend/src/components/pr-status-line.tsx`, already renders `PR #<n>` as a link that opens in a new tab) and frequency (opening a PR is the common action; copying its URL is occasional).
> 2. The `↗` icon moves from right-aligned/absolute/hover-revealed to **inline, immediately after the PR text**, always visible (not hover-gated) — it is the affordance signaling this row opens rather than copies. Layout constraint: the row truncates on narrow sidebars, so the text goes in a flex child with `min-w-0 truncate` and the `↗` is a `shrink-0` sibling right after it, so the icon hugs the (possibly truncated) text end and is never eaten by truncation.
> 3. Copy is NOT dropped — the roles swap: copy moves to a hover-revealed icon on the right side of the row (the same row-body vs hover-icon split the sidebar window row uses for its icon cluster), keeping the existing `copied ✓` inline feedback (the `copiedRow === "pr"` state and `COPY_FEEDBACK_MS` mechanism).
> 4. No-URL fallback: when `prNumber` exists but `prUrl` is absent, the row stays a plain `CopyableRow` copying the segment text (current behavior unchanged — nothing to open).
>
> **Alternatives rejected:**
> - Keeping copy as the row default with a right-aligned open icon (status quo) — rejected: wrong frequency match, inconsistent with PrStatusLine.
> - Dropping the copy affordance entirely and relying on right-click → Copy link address — considered acceptable but the role-swap was preferred (cheap, keeps one-click copy for the Slack/commit-message paste workflow).
> - A button calling window.open — rejected in favor of a real anchor.

## Why

1. **Frequency mismatch (the pain point)**: opening a PR in the browser is the common action on the Pane panel's `pr` row; copying its URL is occasional (Slack/commit-message paste). Today the frequent action hides behind a hover-revealed right-aligned `↗` while the occasional one owns the whole row body.
2. **Cross-surface inconsistency**: the project's other PR text surface, `PrStatusLine` (`app/frontend/src/components/pr-status-line.tsx`), already renders `PR #<n>` as a real `<a target="_blank" rel="noopener noreferrer">`. The Pane panel row behaving differently (click = copy) violates the "three PR surfaces stay consistent" story documented in the code comments and `run-kit/ui-patterns` memory.
3. **Consequence of not fixing**: users keep mis-clicking the row expecting navigation and getting a silent clipboard write, or hunting for the hover-only `↗`; the inconsistency also keeps confusing anyone who learned the link behavior from `PrStatusLine`.
4. **Why this approach**: a real anchor (not `window.open`) preserves native browser affordances — middle-click, Ctrl/Cmd+click, right-click → "Copy link address" — and is keyboard-focusable for free (Constitution V, Keyboard-First). The role-swap (copy → hover icon) keeps one-click copy at near-zero cost using an already-established pattern (the sidebar window-row hover icon cluster).

## What Changes

All changes are in `app/frontend/src/components/sidebar/status-panel.tsx` (the `pr` row block inside `WindowContent`, currently lines ~258–298) plus its unit test file. `getPrSegments`, `PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`, the render gate (`fabChange && prNumber`), and segment text/colors are all **unchanged** — this is purely an interaction/affordance change on the row.

### 1. Row body becomes a real anchor (when `prUrl` is present)

Replace the `CopyableRow` row body with a real `<a href={win.prUrl} target="_blank" rel="noopener noreferrer">` spanning the row (prefix `pr` + icon + segments). NOT a `<button>` calling `window.open` — native middle-click, Ctrl/Cmd+click, and right-click → "Copy link address" must work. This mirrors the existing `PrStatusLine` anchor (`target="_blank" rel="noopener noreferrer"`, `onClick` stops propagation).

- Keep `title={win.prUrl}` on the anchor — besides the tooltip, the existing e2e locator (`app/frontend/tests/e2e/pr-status-sidebar.spec.ts` uses `page.locator("[title='https://github.com/o/r/pull/386']")`) is element-type-agnostic and keeps matching.
- Keep an accessible name equivalent to the current open link's (e.g. `aria-label` naming "Open PR #<n> in a new tab" or letting the visible text serve), so the row reads as a link in the accessibility tree.
- Keep the existing row hover treatment (`hover:bg-bg-inset`, segment `group-hover:text-accent`) as the row-level affordance; the semantic differentiator vs the copy rows is the inline `↗` (next subsection).

### 2. `↗` moves inline, always visible

The `↗` moves from its current placement (absolute, right-aligned, `opacity-0 group-hover/pr:opacity-100 coarse:opacity-100`) to **inline, immediately after the PR segment text**, always visible (no hover gating). It signals "this row opens" and doubles as the visual distinction from the copy-pattern rows.

Truncation layout constraint (narrow sidebars): the anchor's content is a flex row where the segment text sits in a child with `min-w-0 truncate` and the `↗` is a `shrink-0` sibling immediately after it — the icon hugs the (possibly truncated) text end and is never eaten by truncation, and never floats to the far right of a wide row.

### 3. Copy role-swaps to a hover-revealed right-side icon

Copy is NOT dropped. A copy icon button appears on the right side of the row, hover-revealed — the same row-body vs hover-icon split the sidebar window row uses for its icon cluster (`app/frontend/src/components/sidebar/window-row.tsx` lines ~299–349): container `absolute right-* top-1/2 -translate-y-1/2 ... pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto`, buttons `opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100`, `onClick` with `e.stopPropagation()` (and for an icon inside an anchor, `e.preventDefault()` so the click never navigates).

- Copying still calls the existing `handleCopy("pr", win.prUrl)` — the `copiedRow === "pr"` state and `COPY_FEEDBACK_MS` (1000ms) mechanism are kept as-is, including the inline `copied ✓` feedback (the row's `pr ` prefix swaps to `copied ✓ ` during the feedback window, exactly as `CopyableRow` renders it today; since the row body is no longer a `CopyableRow`, replicate that prefix swap in the anchor row).
- The copy button MUST be keyboard-focusable with a `focus-visible` reveal (Constitution V) and carry an `aria-label` (e.g. `Copy PR URL`).
- The anchor row likely needs right padding (the current `pr-6` on the row when `prUrl` exists) so the hover icon doesn't overlap the inline `↗`/text.

### 4. No-URL fallback unchanged

When `prNumber` exists but `prUrl` is absent: the row stays a plain `CopyableRow` copying the segment text (`prText`), exactly as today — nothing to open, so no anchor, no inline `↗`, no hover copy icon (the row body IS the copy action). The existing unit test "does not render the open link when the PR has no URL" flips meaning: with a URL the row itself is the link; without a URL there is no link at all.

### 5. Tests

`app/frontend/src/components/sidebar/status-panel.test.tsx` (`pr row` describe block) asserts the current behavior and must be updated to the new split:

- "copies the PR URL on click" → becomes: the row body is a **link** with `href`/`target="_blank"`/`rel="noopener noreferrer"`; clicking the **hover copy icon** copies the URL (and does not navigate).
- "renders an open-in-new-tab link to the PR URL" → asserts the row-body anchor (href/target/rel) instead of the separate `↗` link.
- New assertions: inline `↗` present and not hover-gated; `copied ✓` feedback still appears via the copy icon; no-URL case renders a copy row and `queryByRole("link")` is null (existing test stays valid).
- Playwright note (established project pattern — pointer-events hover gate): hover-revealed icons need a `.hover()` on the row before clicking the icon. The existing e2e spec `app/frontend/tests/e2e/pr-status-sidebar.spec.ts` locates the row by `[title='<prUrl>']` and asserts text content only, so it should keep passing with the title kept on the anchor; if its assertions do change, the sibling `.spec.md` must be updated in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Pane-panel row interaction vocabulary — document the PR row's open-first split (row body = real anchor + inline always-visible `↗`; copy = hover-revealed right icon reusing the window-row icon-cluster gating), superseding the previous "click row = copy, hover `↗` = open" description of the panel's PR surface.

## Impact

- **Primary**: `app/frontend/src/components/sidebar/status-panel.tsx` — the `pr` row block in `WindowContent`; `CopyableRow` itself and all other rows (tmx/cwd/git/fab) unchanged.
- **Tests**: `app/frontend/src/components/sidebar/status-panel.test.tsx` — `pr row` describe block rewritten to the new split; other describe blocks untouched.
- **Unchanged but referenced**: `app/frontend/src/components/pr-status-line.tsx` (consistency target; no edits), `app/frontend/src/components/sidebar/window-row.tsx` (pattern source for the hover icon cluster; no edits), `app/frontend/tests/e2e/pr-status-sidebar.spec.ts` (+ `.spec.md`) — expected to keep passing via the `[title]` locator; update both together only if assertions change.
- **No backend, API, routing, or state changes.** No new dependencies.

## Open Questions

None — all substantive decisions were confirmed by the user in the source conversation; remaining choices are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Row body becomes a real `<a href={prUrl} target="_blank" rel="noopener noreferrer">`, not a button + `window.open` | User-confirmed decision 1; mirrors existing `PrStatusLine` anchor pattern | S:95 R:85 A:95 D:95 |
| 2 | Certain | `↗` renders inline immediately after the PR text, always visible; text in a `min-w-0 truncate` flex child with `↗` as `shrink-0` sibling | User-confirmed decision 2 including the exact truncation layout | S:95 R:90 A:90 D:90 |
| 3 | Certain | Copy role-swaps to a hover-revealed right-side icon, keeping `copiedRow === "pr"` + `COPY_FEEDBACK_MS` inline `copied ✓` feedback | User-confirmed decision 3 | S:95 R:85 A:90 D:90 |
| 4 | Certain | No-URL fallback: row stays a plain `CopyableRow` copying `prText` — no anchor, no `↗`, no hover copy icon | User-confirmed decision 4 (current behavior unchanged) | S:95 R:90 A:95 D:95 |
| 5 | Certain | Hover-icon mechanics reuse the window-row icon-cluster gating (`opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100`, `pointer-events-none` at rest with group-hover/coarse/focus restore, `stopPropagation` + `preventDefault`) | Description names the window-row split as the pattern; `window-row.tsx:299-349` gives the exact class vocabulary (PR #257 pattern) | S:70 R:90 A:85 D:80 |
| 6 | Confident | Copy icon glyph: a clipboard-style glyph consistent with the panel's `ICON_CLASS` nerd-font vocabulary, `aria-label="Copy PR URL"`; exact glyph picked at apply | Presentational, trivially reversible; codebase icon vocabulary constrains the choice | S:45 R:95 A:75 D:65 |
| 7 | Confident | `copied ✓` feedback keeps the prefix-swap presentation (row's `pr ` label swaps to `copied ✓ ` while `copiedRow === "pr"`), replicated on the anchor row since `CopyableRow` no longer wraps it | Description says "keeping the existing copied ✓ inline feedback"; prefix-swap is how that feedback renders today | S:65 R:90 A:80 D:70 |
| 8 | Confident | Anchor keeps `title={win.prUrl}` and the existing row hover treatment (`hover:bg-bg-inset`, segment `group-hover:text-accent`), now signaling open | Preserves the e2e `[title]` locator and the panel's row-hover affordance; only the meaning of the click changes | S:55 R:90 A:80 D:70 |
| 9 | Confident | Test scope: rewrite the unit `pr row` block; no new Playwright spec — existing `pr-status-sidebar.spec.ts` keeps passing via the `[title]` locator (update `.spec.md` alongside only if `.spec.ts` changes) | Description lists only the unit test file; code-quality "SHOULD include e2e where possible" is already satisfied by the existing pane-panel PR e2e coverage | S:60 R:85 A:75 D:65 |
| 10 | Certain | Both the anchor and the copy icon are keyboard-focusable with `focus-visible` affordances | Constitution V (Keyboard-First) mandates it; real anchor + button are focusable natively | S:80 R:90 A:95 D:90 |
| 11 | Confident | The `handleCopy` text-selection guard (`window.getSelection()`) stays as-is for the copy icon; no selection guard added to the anchor (native link click semantics accepted) | User chose a real anchor knowing native behaviors apply; copy path reuses the untouched `handleCopy` | S:55 R:90 A:80 D:70 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
