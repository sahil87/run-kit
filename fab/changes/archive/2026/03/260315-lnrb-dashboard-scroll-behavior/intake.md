# Intake: Per-Region Scroll Behavior

**Change**: 260315-lnrb-dashboard-scroll-behavior
**Created**: 2026-03-15
**Status**: Draft

## Origin

> Discussed via `/fab-discuss`: how scroll should work across the two views (Dashboard, Terminal). User confirmed scoped scroll on the Dashboard container (option 1 over toggling fullbleed per route) and pinning the stats line at the top of the Dashboard area. Captured as Resolved Decision #28 in `docs/specs/design.md`.
>
> During implementation investigation, discovered that the `fullbleed` CSS class is never applied to `<html>`, meaning the `overflow: hidden` and `position: fixed` rules in `globals.css` (lines 52-71) never activate. This causes a browser scrollbar to appear on the terminal page when xterm.js output grows — the terminal container expands instead of staying fixed with internal scrollback.

## Why

Two scroll bugs, same root cause (missing scroll containment):

1. **Terminal view**: xterm.js output causes the terminal container to grow unbounded, producing a browser scrollbar. Pressing Enter repeatedly adds lines that push the page taller instead of scrolling internally within xterm. Refreshing the page resets it. The `html.fullbleed` CSS rules that should prevent this (`overflow: hidden`, `position: fixed` on html/body/app-shell) exist in `globals.css` but are gated on a `fullbleed` class that is never added to `<html>`.

2. **Dashboard view**: The session cards grid can overflow the viewport when many sessions exist. Even once fullbleed is activated (fixing the terminal), the Dashboard needs its own scoped scroll container so cards are reachable.

## What Changes

### 1. Activate fullbleed class (`app/frontend/src/hooks/use-visual-viewport.ts` or `app/frontend/src/app.tsx`)

Add the `fullbleed` class to `document.documentElement` (`<html>`) unconditionally on mount. In the single-view model, fullbleed is always on — there's no toggle. This activates the existing CSS rules in `globals.css`:

```css
html.fullbleed, html.fullbleed body {
  position: fixed;
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

html.fullbleed .app-shell {
  position: fixed;
  inset: 0;
  width: 100%;
  height: var(--app-height, 100vh);
  top: var(--app-offset-top, 0px);
  overflow: hidden;
}
```

The most logical place is `useVisualViewport` since it already manages `--app-height` and `--app-offset-top`. Adding `fullbleed` there keeps all viewport-related side effects in one hook.

Alternatively, since fullbleed is unconditional, the CSS rules could be applied directly to `html` and `body` without a class gate — removing the `.fullbleed` class dependency entirely. This is simpler but changes the meaning of the existing CSS structure.

### 2. Dashboard scroll container (`app/frontend/src/components/dashboard.tsx`)

The Dashboard component currently wraps everything in a single `<div className="flex-1 overflow-y-auto p-4 sm:p-6">` — the stats line and card grid scroll together. Split this into two sibling divs:

1. **Stats line** — `shrink-0` with padding. Stays pinned at the top of the Dashboard area regardless of scroll position.
2. **Scrollable card area** — `flex-1 min-h-0 overflow-y-auto` containing the session cards grid and the "+ New Session" button.

The outer wrapper becomes `flex-1 flex flex-col` (no `overflow-y-auto` on the wrapper itself — that moves to the inner scrollable div).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Dashboard section to document pinned stats line and scrollable card area
- `run-kit/architecture`: (modify) Note that fullbleed is always active and how it's applied

## Impact

- **`app/frontend/src/hooks/use-visual-viewport.ts`** (or `globals.css`) — activate fullbleed / remove class gate
- **`app/frontend/src/components/dashboard.tsx`** — restructure JSX layout (stats pinned, cards scrollable)
- **`app/frontend/src/components/dashboard.test.tsx`** — may need updates if tests assert on container structure
- No backend changes
- No API changes
- No new dependencies

## Open Questions

None — the design was fully resolved in the preceding discussion. The fullbleed activation is a bug fix (existing CSS never applied).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scoped scroll on Dashboard container, not fullbleed toggle per route | Discussed — user explicitly chose option 1 | S:95 R:90 A:90 D:95 |
| 2 | Certain | Stats line pinned at top of Dashboard area | Discussed — parallels fixed chrome philosophy | S:90 R:95 A:85 D:90 |
| 3 | Certain | html/body stay overflow:hidden always | Discussed — no body-level scroll toggling between routes | S:90 R:85 A:90 D:90 |
| 4 | Certain | Fullbleed class must be activated — existing CSS rules are correct but dormant | Codebase inspection — `html.fullbleed` rules exist in globals.css but class never added to `<html>` | S:95 R:80 A:95 D:95 |
| 5 | Certain | Terminal scroll is xterm-internal, not browser scroll | Design spec + user confirmation — wheel/touch events go to xterm.js for tmux scrollback | S:95 R:95 A:95 D:95 |
| 6 | Certain | Sidebar scroll unchanged | Already has overflow-y:auto, independent scroll works | S:95 R:95 A:95 D:95 |
| 7 | Confident | Activate fullbleed in useVisualViewport hook | Not discussed, but this hook already manages viewport CSS side effects — logical colocation | S:60 R:90 A:80 D:70 |
| 8 | Confident | Padding split between stats and scrollable area | Not explicitly discussed, follows from pinning stats while keeping consistent alignment | S:60 R:90 A:80 D:75 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
