# Plan: Pane-Panel PR Row Open-First Action

**Change**: 260703-41ks-pr-row-open-first-action
**Intake**: `intake.md`

## Requirements

<!-- Derived from the intake's four user-confirmed decisions. Scope is a single
     interaction/affordance change on the `pr` row inside `WindowContent`
     (`app/frontend/src/components/sidebar/status-panel.tsx`). getPrSegments,
     PR_STATE_COLORS/PR_CHECKS_COLORS/PR_REVIEW_COLORS, the render gate
     (fabChange && prNumber), and the segment text/colors are all UNCHANGED. -->

### PR Row: Open-First Interaction

#### R1: Row body is a real anchor when a PR URL is present
When `prSegments` is non-null AND `win.prUrl` is present, the `pr` row body SHALL render as a real
`<a href={win.prUrl} target="_blank" rel="noopener noreferrer">` spanning the row content (the `pr`
prefix + PR icon + colored segment text) — NOT a `<button>` calling `window.open` — so native
middle-click, Ctrl/Cmd+click, and right-click → "Copy link address" work. The anchor SHALL keep
`title={win.prUrl}` and an accessible name equivalent to the current open link (`aria-label="Open PR
#<n> in a new tab"`). The existing row hover treatment (`hover:bg-bg-inset`, segment
`group-hover:text-accent`) SHALL be preserved as the row-level affordance.

- **GIVEN** a change-bound window with `prNumber` and `prUrl` set
- **WHEN** the Pane panel renders its `pr` row
- **THEN** the row body is an `<a>` with `href` = `win.prUrl`, `target="_blank"`, `rel="noopener noreferrer"`, `title` = `win.prUrl`, and an accessible name "Open PR #<n> in a new tab"
- **AND** clicking the anchor body navigates (opens a new tab) rather than copying

#### R2: The `↗` glyph renders inline, immediately after the PR text, always visible
The `↗` glyph SHALL move from its current absolute/right-aligned/hover-revealed placement to
**inline, immediately after the PR segment text, always visible** (no `opacity`/hover gating). To
survive narrow-sidebar truncation, the anchor content SHALL be a flex row whose segment text lives
in a `min-w-0 truncate` child and whose `↗` is a `shrink-0` sibling immediately after that child —
so the glyph hugs the (possibly truncated) text end and is never eaten by truncation nor floated to
the far right of a wide row.

- **GIVEN** the anchor `pr` row from R1
- **WHEN** it renders at any sidebar width
- **THEN** an always-visible `↗` glyph sits inline immediately after the segment-text child, which is `min-w-0 truncate`, with the `↗` as a `shrink-0` sibling
- **AND** the `↗` carries no opacity/hover-gating classes

#### R3: Copy role-swaps to a hover-revealed right-side icon button
Copy SHALL NOT be dropped. A copy icon `<button>` SHALL appear on the right side of the anchor row,
hover-revealed, reusing the sidebar window-row icon-cluster gating: an absolutely-positioned
container (`absolute right-* top-1/2 -translate-y-1/2 ...`) that is inert at rest
(`pointer-events-none`) with `group-hover:pointer-events-auto coarse:pointer-events-auto
has-[:focus-visible]:pointer-events-auto`, and a button that is `opacity-0 group-hover:opacity-100
coarse:opacity-100 focus-visible:opacity-100`. The button's `onClick` SHALL call
`e.preventDefault()` (so the click never navigates the enclosing anchor) and `e.stopPropagation()`,
then `handleCopy("pr", win.prUrl)`. The button SHALL carry `aria-label="Copy PR URL"` and be
keyboard-focusable. The anchor row SHALL reserve right padding (the current `pr-6`) so the hover
copy icon does not overlap the inline `↗`/text.

- **GIVEN** the anchor `pr` row from R1
- **WHEN** the user hovers the row (or is on a coarse pointer, or focuses the copy button)
- **THEN** a copy icon button is revealed on the right side
- **WHEN** the copy button is clicked
- **THEN** `handleCopy("pr", win.prUrl)` runs, the click does not navigate the anchor, and the row shows the `copied ✓` feedback

#### R4: `copied ✓` feedback keeps the prefix-swap presentation on the anchor row
The existing `copiedRow === "pr"` + `COPY_FEEDBACK_MS` mechanism SHALL be kept. Because the row body
is no longer a `CopyableRow`, the anchor row SHALL replicate `CopyableRow`'s prefix-swap: its leading
`pr` label swaps to `copied ✓` while `copiedRow === "pr"`, matching how the other rows render the
feedback today.

- **GIVEN** the anchor `pr` row
- **WHEN** the copy button is clicked
- **THEN** the leading `pr` prefix swaps to `copied ✓` for `COPY_FEEDBACK_MS` (1000ms), then reverts
- **AND** the existing `handleCopy` timer/single-active-feedback semantics are unchanged

#### R5: No-URL fallback is unchanged
When `prSegments` is non-null but `win.prUrl` is absent, the `pr` row SHALL stay a plain
`CopyableRow` copying the segment text (`prText`) — exactly as today: no anchor, no inline `↗`, no
hover copy icon (the row body IS the copy action).

- **GIVEN** a change-bound window with `prNumber` set but `prUrl` absent
- **WHEN** the Pane panel renders its `pr` row
- **THEN** the row is a `CopyableRow` (a `<button>`) copying `prText`, there is no `<a>` (link), and there is no inline `↗` or hover copy icon

### Non-Goals

- No change to `getPrSegments`, the render gate (`fabChange && prNumber`), segment text, or segment colors (`PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`).
- No change to `CopyableRow` itself or to the other rows (`tmx`/`cwd`/`git`/`run`/`agt`/`fab`).
- No change to `pr-status-line.tsx` (consistency target) or `window-row.tsx` (pattern source).
- No backend, API, routing, state, or dependency changes.
- No new Playwright spec; the existing `pr-status-sidebar.spec.ts` keeps passing via the `[title]` locator (see A-010).

### Design Decisions

1. **Copy icon glyph**: use the Nerd Font copy glyph `` styled with the panel's `ICON_CLASS` nerd-font vocabulary — *Why*: matches the panel's existing accent-icon idiom (``/``/``/`` are all Nerd Font glyphs); presentational and trivially reversible — *Rejected*: an inline SVG icon (heavier, inconsistent with the row-icon vocabulary).
2. **Anchor row structure**: a `relative` wrapper (keeping the `group/pr` and `pr-6` right-padding) containing the `<a>` (row body) and the sibling hover-icon container — *Why*: mirrors the window-row row-button-plus-sibling-cluster split, avoiding a `<button>` nested inside the `<a>` — *Rejected*: putting the copy button inside the anchor (invalid interactive-in-interactive nesting).
3. **preventDefault + stopPropagation on the copy button**: the copy button lives visually inside the anchor's hover region; `preventDefault` stops anchor navigation and `stopPropagation` stops bubbling — *Why*: the window-row pattern uses `stopPropagation`; the added `preventDefault` is because the parent here is an anchor, not a select-button — *Rejected*: relying on `stopPropagation` alone (would still let the anchor's default navigation fire since the button sits inside the anchor's DOM subtree — but the button is a sibling of the anchor, so `preventDefault` is belt-and-suspenders and harmless).

## Tasks

### Phase 2: Core Implementation

- [x] T001 <!-- rework cycle 2: MUST-FIX (both reviewers, status-panel.tsx:192) — PrLinkRow's at-rest prefix renders "pr"+NBSP (3 monospace advances) with the icon immediately adjacent, while CopyableRow renders `${prefix} ` (prefix + gap space = 4 advances); the URL-present pr row's icon/content sit one column LEFT of tmx/cwd/git/fab and the no-URL branch. The copied state ("copied ✓"+NBSP = 9 advances) already matches. Fix: at-rest prefix "pr  " (one more non-collapsing char, escape form) and correct the false alignment comment at :188-190. ALSO (low-effort follow-ups, do them): (a) :363 no-URL prefix uses a raw invisible NBSP source char — restore the visible   escape form (an invisible source char is how this pad regressed in cycle 1); (b) drop CopyableRow's now-dead className prop (:138/:143/:150, zero call sites — already listed in Deletion Candidates); (c) test:509-510 dispatches a raw MouseEvent outside act() — use fireEvent.click (its boolean return is false when defaultPrevented) to assert the same thing without act-warning noise. --> <!-- rework cycle 1: (1) MUST-FIX flex whitespace regression — the anchor is a flex container, so the {" "} between the icon span and the segments span is an unrendered whitespace-only flex item and the prefix span's trailing space is trimmed as end-of-line collapsible space; the row renders 'pr'+glyph+'#241 · open' fused with no gaps. Use non-collapsing spacing (NBSP inside the spans, flex gap-*, or one inline truncating child holding prefix+icon+segments). (2) MUST-FIX prSegments.map segment JSX duplicated verbatim between the anchor branch and the no-URL CopyableRow branch — hoist to one shared expression (unblocks A-012). (3) SHOULD-FIX copy button combines ICON_CLASS (contains text-accent-bright) with text-text-secondary — same-specificity conflict, indeterminate at-rest color; drop one color declaration (window-row cluster precedent: text-text-secondary hover:text-text-primary). --> In `app/frontend/src/components/sidebar/status-panel.tsx`, rewrite the `pr` row block inside `WindowContent` (currently lines ~258-298): when `win.prUrl` is present, render a `group/pr relative` wrapper containing (a) a real `<a href={win.prUrl} target="_blank" rel="noopener noreferrer" title={win.prUrl} aria-label={`Open PR #${win.prNumber} in a new tab`}>` spanning `pr`/`copied ✓` prefix + PR icon + a `min-w-0 truncate` segment-text child + an always-visible `shrink-0` inline `↗` sibling, with the existing `hover:bg-bg-inset` + `group-hover:text-accent` treatment and `pr-6` right padding; and (b) a sibling hover-icon container (`absolute right-* top-1/2 -translate-y-1/2 ... pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto`) holding a copy `<button aria-label="Copy PR URL">` (`opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100`) whose `onClick` does `e.preventDefault(); e.stopPropagation(); handleCopy("pr", win.prUrl!)` and renders the `` copy glyph via `ICON_CLASS`. Replicate the `copiedRow === "pr"` prefix-swap (`pr` → `copied ✓`) on the anchor. <!-- R1 R2 R3 R4 -->
- [x] T002 <!-- rework: MUST-FIX no-URL branch prefix regressed from "pr " (NBSP) to "pr " (plain space) — CopyableRow renders `${prefix} `, the two collapsible spaces collapse to one, and the row falls out of the 3-char monospace prefix column shared with tmx/cwd/git/fab (the NBSP was the deliberate alignment pad from PR #247). R5 requires this branch exactly as before: restore prefix={"pr "}. Verify the anchor branch's prefix rendering keeps the same alignment. --> In the same `pr` row block, keep the no-URL branch as a plain `CopyableRow` copying `prText` (`onCopy={() => handleCopy("pr", prText)}`, no anchor, no `↗`, no hover copy icon) — branch on `win.prUrl` presence. <!-- R5 -->

### Phase 3: Tests

- [x] T003 <!-- rework: follow-ups from review — (a) NICE-TO-HAVE reword test comments claiming the copy button is "enclosed by"/"prevented from navigating" the anchor (it is a sibling, not enclosed; preventDefault is belt-and-suspenders); (b) SHOULD-FIX update app/frontend/tests/e2e/pr-status-sidebar.spec.md:35 stale "copyable" wording to describe the open-first row (row body = link, copy = hover icon) — companion-doc constitution rule; (c) add/adjust unit assertions if the whitespace fix changes DOM structure (e.g. NBSP in prefix, gap classes). --> In `app/frontend/src/components/sidebar/status-panel.test.tsx` (`pr row` describe block), rewrite the interaction assertions: (a) "renders an open-in-new-tab link to the PR URL" now asserts the ROW-BODY anchor (`getByRole("link", { name: "Open PR #241 in a new tab" })` has `href`/`target="_blank"`/`rel="noopener noreferrer"`); (b) replace "copies the PR URL on click" with a test that clicks the hover copy button (`getByRole("button", { name: "Copy PR URL" })`), asserts `copyToClipboard` was called with the URL, and that it did not navigate; (c) add an assertion that the inline `↗` is present and NOT hover-gated (rendered inline, no `opacity-0`); (d) add a `copied ✓` feedback assertion driven via the copy button; (e) keep "does not render the open link when the PR has no URL" (`queryByRole("link")` is null) and confirm the no-URL row still copies `prText`. Leave the segment-text/color tests untouched. <!-- R1 R2 R3 R4 R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: For a window with `prUrl`, the `pr` row body is an `<a>` with `href`=`win.prUrl`, `target="_blank"`, `rel="noopener noreferrer"`, `title`=`win.prUrl`, and accessible name "Open PR #<n> in a new tab".
- [x] A-002 R2: The `↗` glyph renders inline immediately after a `min-w-0 truncate` segment-text child, as a `shrink-0` sibling, always visible (no opacity/hover-gating classes on it).
- [x] A-003 R3: A hover-revealed copy button (`aria-label="Copy PR URL"`) on the right of the row copies `win.prUrl` via `handleCopy("pr", ...)` on click, with `preventDefault`+`stopPropagation` so the anchor does not navigate; the button is keyboard-focusable with a `focus-visible` reveal.
- [x] A-004 R4: The `copied ✓` feedback (prefix swap, `copiedRow === "pr"`, `COPY_FEEDBACK_MS`) still fires from the copy button on the anchor row.
- [x] A-005 R5: With `prNumber` set but `prUrl` absent, the `pr` row is a plain `CopyableRow` copying `prText` — no link, no inline `↗`, no hover copy icon.

### Behavioral Correctness

- [x] A-006 R1: The row's default click action changed from copy to open (the row body is a link, not a copy button) for the URL-present case.
- [x] A-007 R3: Clicking the copy button does not open a new tab / does not navigate the anchor.

### Scenario Coverage

- [x] A-008 R1 R3 R4 R5: `status-panel.test.tsx` `pr row` block covers: anchor href/target/rel + a11y name; copy-button copy + no-navigate; inline non-gated `↗`; `copied ✓` via the copy button; no-URL copy-row + `queryByRole("link")` null.

### Edge Cases & Error Handling

- [x] A-009 R2: At narrow sidebar width the `↗` is not eaten by truncation (guaranteed structurally by `min-w-0 truncate` text child + `shrink-0` `↗` sibling).
- [x] A-010 R1: The existing e2e spec `app/frontend/tests/e2e/pr-status-sidebar.spec.ts` keeps passing — its `[title='<prUrl>']` locator (element-type-agnostic) still matches the anchor, which contains the `#<n>`/`open` text it asserts (verified by inspection; e2e not run in this environment). No `.spec.ts`/`.spec.md` change needed.

### Code Quality

- [x] A-011 Pattern consistency: the hover copy icon reuses the window-row icon-cluster gating vocabulary; the anchor mirrors the `PrStatusLine` anchor attributes (`target="_blank" rel="noopener noreferrer"`, `stopPropagation`).
- [x] A-012 No unnecessary duplication: `handleCopy`, `copiedRow`/`COPY_FEEDBACK_MS`, `ICON_CLASS`, `getPrSegments`, and the shared PR color tokens are reused unchanged; the text-selection guard in `handleCopy` is untouched. *(Rework: the previously-duplicated `prSegments.map(...)` segment-rendering JSX is now hoisted to a single shared `segmentSpans` const in `WindowContent`, consumed by both the anchor `PrLinkRow` and the no-URL `CopyableRow` branches — the styling can no longer drift.)*
- [x] A-013 Type narrowing: `win.prUrl` presence is narrowed via an `if`/ternary guard (no `as` cast beyond the already-guarded non-null on the copy handler where `prUrl` is proven present).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

<!-- Re-derived in review cycle 2 re-review from the current working tree. -->

None — the sole prior candidate (`CopyableRow`'s dead `className` prop in `app/frontend/src/components/sidebar/status-panel.tsx`) was already deleted during rework cycle 2 (follow-up (b)); nothing in the current tree is left redundant or unused by this change. (`CopyableRow`'s `title` prop remains live — the `cwd` row uses it.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Row body becomes a real `<a href={prUrl} target="_blank" rel="noopener noreferrer">`, not a button + `window.open` | Intake assumption 1 (user-confirmed); mirrors `PrStatusLine` | S:95 R:85 A:95 D:95 |
| 2 | Certain | `↗` renders inline immediately after the PR text, always visible; text in `min-w-0 truncate` child, `↗` a `shrink-0` sibling | Intake assumption 2 (user-confirmed, exact layout) | S:95 R:90 A:90 D:90 |
| 3 | Certain | Copy role-swaps to a hover-revealed right-side icon, keeping `copiedRow === "pr"` + `COPY_FEEDBACK_MS` `copied ✓` feedback | Intake assumption 3 (user-confirmed) | S:95 R:85 A:90 D:90 |
| 4 | Certain | No-URL fallback: row stays a plain `CopyableRow` copying `prText` — no anchor/↗/hover copy icon | Intake assumption 4 (user-confirmed) | S:95 R:90 A:95 D:95 |
| 5 | Certain | Hover-icon mechanics reuse the window-row icon-cluster gating (`opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100`, `pointer-events-none` at rest + group-hover/coarse/focus restore, `stopPropagation` + `preventDefault`) | Intake assumption 5; `window-row.tsx:299-349` gives the exact class vocabulary | S:70 R:90 A:85 D:80 |
| 6 | Confident | Copy icon glyph `` (Nerd Font copy glyph) via `ICON_CLASS`, `aria-label="Copy PR URL"` | Intake assumption 6; presentational + reversible; the panel's icons are all Nerd Font glyphs styled with `ICON_CLASS`, so `` is the consistent pick | S:50 R:95 A:80 D:70 |
| 7 | Confident | `copied ✓` keeps the prefix-swap presentation (`pr` → `copied ✓` while `copiedRow === "pr"`), replicated on the anchor since `CopyableRow` no longer wraps it | Intake assumption 7; prefix-swap is how the feedback renders today | S:65 R:90 A:80 D:70 |
| 8 | Confident | Anchor keeps `title={win.prUrl}` and the existing row hover treatment (`hover:bg-bg-inset`, `group-hover:text-accent`), now signaling open | Intake assumption 8; preserves the e2e `[title]` locator + the row-hover affordance | S:55 R:90 A:80 D:70 |
| 9 | Confident | Test scope: rewrite the unit `pr row` block only; no new Playwright spec — existing `pr-status-sidebar.spec.ts` keeps passing via `[title]` (no `.spec.md` change unless `.spec.ts` changes) | Intake assumption 9; existing pane-panel PR e2e already satisfies "SHOULD include e2e" | S:60 R:85 A:75 D:65 |
| 10 | Certain | Both the anchor and the copy icon are keyboard-focusable with `focus-visible` affordances | Intake assumption 10; Constitution V; real anchor + button are natively focusable | S:80 R:90 A:95 D:90 |
| 11 | Confident | `handleCopy`'s text-selection guard (`window.getSelection()`) stays as-is for the copy icon; no selection guard added to the anchor (native link click semantics accepted) | Intake assumption 11; the copy path reuses the untouched `handleCopy` | S:55 R:90 A:80 D:70 |

11 assumptions (6 certain, 5 confident, 0 tentative).
