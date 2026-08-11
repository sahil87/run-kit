# Intake: Sidebar Tree ARIA Presentational Server Wrappers

**Change**: 260811-exsp-sidebar-tree-aria-presentation
**Created**: 2026-08-11

## Origin

Backlog item `[exsp]` (2026-07-19, relocated from `docs/memory/run-kit/ui-patterns.md` by /docs-distill-memory), invoked one-shot via `/fab-new exsp`:

> Sidebar tree ARIA: interpose role='presentation' on the server `<section>` wrappers under role='tree' for a stricter APG structure.

No prior conversation context — cold invocation. All design decisions below were derived from the backlog text, the current code, and the WAI-ARIA spec.

## Why

The sidebar session/window tree is a W3C-APG two-level multiselectable tree (`260807-nf9f`): a `<div role="tree" aria-label="Session tree">` (`app/frontend/src/components/sidebar/index.tsx:1522`) containing per-server `ServerGroup` components. Each `ServerGroup` renders a `<section aria-labelledby={`server-header-${server}`}>` wrapper (`index.tsx:2320-2323`), inside which sit the `role="treeitem"` session rows (level 1) and their `role="group"` window lists (level 2 treeitems).

The problem: a `<section>` element **with an accessible name** (here via `aria-labelledby`) maps to the implicit ARIA role `region` — a landmark. A `region` landmark is not a valid intervening node between a `tree` and its `treeitem`s: the APG tree pattern expects owned children to be `treeitem`/`group` nodes or semantically transparent containers. Screen readers may announce a spurious "region" landmark per server inside the tree widget, and strict ARIA validators flag the structure.

If left unfixed: the tree remains functional (browsers are tolerant), but the accessibility tree is noisier than it needs to be and the structure fails strict APG conformance — the exact gap the memory file's "APG caveats" paragraph documents as open (`docs/memory/run-kit/ui-patterns.md` § Keyboard Navigation & Tree ARIA).

Why this approach: `role="presentation"` makes the wrapper semantically transparent, so the accessibility tree reads `tree → treeitem(level 1) → group → treeitem(level 2)` with no landmark interposed. The alternative — `role="group"` per server — was rejected: the server header row (chevron button, palette/+/✕ action cluster) lives inside the same wrapper and is deliberately NOT a treeitem, so a `group` would still contain non-treeitem interactive content; the backlog item also explicitly prescribes `presentation`.

## What Changes

### 1. `role="presentation"` on the server `<section>` wrapper — with `aria-labelledby` removed

In `ServerGroup` (`app/frontend/src/components/sidebar/index.tsx:2320-2323`), current code:

```tsx
<section
  className="border-b border-border last:border-b-0"
  aria-labelledby={`server-header-${server}`}
>
```

becomes:

```tsx
<section
  role="presentation"
  className="border-b border-border last:border-b-0"
>
```

The `aria-labelledby` removal is **required, not optional**: per WAI-ARIA 1.2 § Presentational Roles Conflict Resolution, user agents MUST NOT expose an element as presentational if it carries global WAI-ARIA states/properties — and `aria-labelledby` is a global property. Keeping it would silently void the `role="presentation"`, leaving the section exposed as a named `region` and making the change a no-op.
<!-- assumed: none — spec-determined; see Assumptions #2 -->

The `id={`server-header-${server}`}` on the header toggle button (`index.tsx:2350`) exists solely as the `aria-labelledby` target (verified: no other reference in `src/` or tests). Remove it in the same edit — dead code otherwise. The button keeps its `aria-expanded` and `aria-label` (`Collapse/Expand {server} sessions`), so the server name remains announced on the actual control.

### 2. Element stays `<section>`

Keep the `<section>` element rather than swapping to `<div>`: with `role="presentation"` the element's implicit semantics are neutralized either way, so the swap would be pure churn. Minimal diff wins.

### 3. Test coverage

Extend `app/frontend/src/components/sidebar/index.test.tsx` with an assertion in the tree-ARIA area: each per-server wrapper under `[role="tree"]` carries `role="presentation"` and no `aria-labelledby`. Existing tree tests (roving tabindex, treeitem enumeration via `[role="treeitem"]`, `data-row-key` selectors) query rows directly and do not depend on the section's region role or the `server-header-*` id (verified by grep) — they should pass unchanged.

Unit tests only (`*.test.tsx` — exempt from the `.spec.md` companion-doc rule); no e2e spec touches the section wrapper semantics.

### Out of scope (explicit non-goals)

- The server **header row** (the `aria-current` div with chevron/palette/+/✕ buttons, `index.tsx:2329+`) remains non-treeitem interactive content inside the tree — a documented deliberate keyboard-first deviation from strict APG purity (memory § APG caveats). Not touched.
- The intermediate plain `<div>`s (header wrapper, `pt-1 pb-1` content div, per-session `data-session-group` divs) have implicit `generic` role, not landmarks; the backlog scopes this change to the `<section>` wrappers only.
- No keyboard-nav, roving-tabindex, or multiselect behavior changes — the `rovingKey`/`getVisibleRows` machinery reads `[role="treeitem"]` from DOM order and is unaffected by wrapper semantics.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Keyboard Navigation & Tree ARIA — the "APG caveats" paragraph currently states `role="tree"` wraps the server `<section>` wrappers "(which are not themselves treeitems)"; update to record that the wrappers are now `role="presentation"` (semantically transparent, `aria-labelledby` removed) and why.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — `ServerGroup` return JSX: 2-attribute edit on the `<section>` (add `role`, drop `aria-labelledby`) + drop the `id` on the header button. No logic changes.
- `app/frontend/src/components/sidebar/index.test.tsx` — one new/extended assertion.
- Frontend-only; no backend, API, routes, or tmux interaction. No visual change (semantics only). Screen-reader-visible effect: per-server "region" landmark announcements inside the tree disappear; server names remain on the header buttons' `aria-label`s.
- Verify with `just test-frontend` (sidebar unit suites); e2e unaffected but `just test-e2e` sidebar specs are the regression net if wanted.

## Open Questions

- None — the backlog directive is explicit and the one non-obvious detail (aria-labelledby conflict resolution) is spec-determined.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add `role="presentation"` to the per-server `<section>` wrapper in `ServerGroup` | Explicit backlog directive; code located at `index.tsx:2320`; one-line, trivially reversible | S:95 R:95 A:95 D:95 |
| 2 | Certain | Remove `aria-labelledby` from the section (and the now-unused `server-header-${server}` id on the header button) | WAI-ARIA 1.2 presentational-conflict-resolution: a global ARIA property voids `role="presentation"` — keeping it would make the change a silent no-op; grep confirms no other consumer of the id | S:70 R:90 A:90 D:85 |
| 3 | Confident | Keep the `<section>` element (no swap to `<div>`) | With `role="presentation"` the implicit semantics are neutralized either way; minimal diff; both options equivalent for a11y | S:55 R:95 A:85 D:70 |
| 4 | Certain | Header row, inner generic divs, and non-treeitem buttons stay as-is (non-goals) | Backlog scopes the change to the `<section>` wrappers; the header-row APG deviation is a documented deliberate choice in memory § APG caveats | S:80 R:90 A:85 D:80 |
| 5 | Confident | Add a unit assertion in `sidebar/index.test.tsx` (wrapper is presentational, no `aria-labelledby`); no e2e changes | Test-paths convention covers `*.test.tsx`; existing tree tests query `[role="treeitem"]`/`data-row-key` and don't touch the section semantics | S:50 R:90 A:80 D:70 |
| 6 | Confident | Set `change_type: fix` explicitly | Correcting invalid ARIA structure is a defect fix, but the description carries no `fix` keyword so inference lands on `feat`; explicit override sticks across refresh | S:55 R:85 A:75 D:65 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
