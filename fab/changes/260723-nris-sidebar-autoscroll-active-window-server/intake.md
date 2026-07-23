# Intake: Sidebar Autoscroll to Active Window and Active Server

**Change**: 260723-nris-sidebar-autoscroll-active-window-server
**Created**: 2026-07-23

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent) from a live conversation that included code inspection of this worktree. Interaction mode: one-shot synthesized description; all design decisions below were agreed in that conversation.

> Sidebar autoscroll to the active window and active server. Both the sidebar Sessions pane and the Server panel should autoscroll so the currently active window row / active server tile is visible. Today, if the selected window (or active server tile) is below the fold of its scroll container, it stays out of view until the user scrolls manually. This affects desktop; the behavior already exists on mobile only.

## Why

1. **Pain point**: On desktop, navigating to a window (click, palette, deep link) does not bring its sidebar row into view. If the selected window row — or the active server tile in the Server panel — sits below the fold of its scroll container, the user loses the visual anchor for "where am I" and must scroll manually to find the highlighted row/tile. On direct URL loads this is especially disorienting: the route resolves and the terminal renders, but the sidebar shows an unrelated scroll position.

2. **Consequence of not fixing**: A persistent desktop/mobile behavior asymmetry — mobile already scrolls+focuses the selected row when the drawer opens (`index.tsx:770-793`) and scrolls the active server tile on mount (`server-panel.tsx:91-97`), while desktop (the primary environment) gets neither. Users with many sessions/windows or many tmux servers routinely land with the active item hidden.

3. **Why this approach**: Both fixes reuse mechanisms already in the codebase (existing refs, `aria-current="page"` marker, `rowsVersion` counter, `scrollIntoView` guards) rather than introducing new scroll infrastructure. `block: "nearest"` semantics make a single call correct for both the vertical desktop layouts and the horizontal mobile server row, so the mobile-only gates can simply widen instead of forking new code paths.

## What Changes

### 1. Server panel (`app/frontend/src/components/sidebar/server-panel.tsx`)

Current code (lines 91–97):

```tsx
// Scroll active tile into view on mount (important for mobile single-row layout).
useEffect(() => {
  if (!isMobile) return;
  const el = activeTileRef.current;
  if (!el || typeof el.scrollIntoView !== "function") return;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}, [isMobile, server]);
```

**Change**: drop the `if (!isMobile) return;` gate. `scrollIntoView({ block: "nearest", inline: "nearest" })` already handles both layouts — vertical for the desktop tile grid that wraps inside the resizable CollapsiblePanel, horizontal for the mobile single-row layout. The effect already re-runs on `server` change, which is the correct trigger for both. The `typeof el.scrollIntoView !== "function"` jsdom guard stays.

### 2. Sessions pane (`app/frontend/src/components/sidebar/index.tsx`)

Add a **desktop-applicable** effect (alongside — not replacing — the existing mobile drawer-open effect at lines 770–793) keyed on the selected window identity (`${server}:${windowId}`):

- Query the selected row the same way the mobile effect does: `navRef.current?.querySelector('[data-window-id] [aria-current="page"]')` — the selected window row's button carries `aria-current="page"` (`window-row.tsx:338`), and scoping to a `[data-window-id]` ancestor excludes the active BoardsSection row.
- Scroll it with `scrollIntoView({ block: "nearest" })` inside the `role="tree"` scroll container (the `overflow-y-auto` div, `index.tsx:1170-1176`).
- **Scroll only — NO `focus()`**. The mobile drawer effect focuses because it must beat the focus trap's first-focus; on desktop, stealing focus on navigation would break terminal typing.
- Keep the `typeof row.scrollIntoView === "function"` guard (jsdom lacks `scrollIntoView`).

### 3. Row-not-rendered-yet retry (deep-link load)

On direct URL load the route resolves before SSE data lands, so the row may not exist when the selection-identity effect first fires. Mechanism:

- Track a **pending-scroll ref**: set when the selected window identity changes; cleared once the row is found and scrolled.
- Re-run the scroll attempt when the visible-row set changes — the existing `rowsVersion` counter (`index.tsx:821`, bumped ONLY when a group's visible-row set signature changes: add/remove, collapse/expand, rename) is the retry trigger.
- The pending ref guarantees the scroll happens **once per selection change**, not on every SSE tick — passive SSE activity ticks must not change roving/focus/scroll state (Wave-2 #262 invariant, documented at `index.tsx:818-820` and `index.tsx:887`).

### 4. Explicitly out of scope / behavior preserved

- **Collapsed groups**: if the selected window's session/server group is collapsed, the row is not in the DOM — the effect no-ops. Auto-expanding on navigation was considered and **rejected** (it fights the user's explicit collapse).
- **Roving tabindex (`rovingKey`)**: the desktop autoscroll does NOT touch `rovingKey` — it is scroll-only, leaving roving/focus state unchanged (which trivially preserves the #262 invariant). The mobile drawer effect keeps its existing `setRovingKey` sync (it moves focus, so it must sync).
- The existing mobile drawer-open scroll+focus effect (`index.tsx:770-793`) is unchanged in behavior.

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar section — desktop autoscroll of the selected window row and active server tile (selection-keyed, scroll-only, `rowsVersion`-retried, collapsed-group no-op); mobile-only gates removed/widened.

## Impact

- **Files**: `app/frontend/src/components/sidebar/server-panel.tsx` (one-line gate removal + comment), `app/frontend/src/components/sidebar/index.tsx` (new effect + pending-scroll ref, ~20-30 lines). No backend, no API, no routes.
- **Tests**: new/updated Vitest unit tests colocated with the components (jsdom — mock/spy `scrollIntoView`); Playwright e2e where feasible per code-quality.md ("UI changes SHOULD include Playwright e2e tests"; any new/modified `.spec.ts` requires its sibling `.spec.md` per constitution § Test Companion Docs). Existing specs that touch adjacent behavior and must not regress: `app/frontend/tests/e2e/sidebar-window-sync.spec.ts`, `server-panel-grid.spec.ts`, `mobile-layout.spec.ts`, and `top-bar-overlap.spec.ts` (its line 267 comment references the mobile focus-on-open scrollIntoView dragging nav content — verify the desktop scroll doesn't recreate that overlap).
- **Risk**: low — additive UI effect, easily reverted; the main invariant to protect is #262 (no state churn on passive SSE ticks).

## Open Questions

- None — the design was resolved in the originating conversation; remaining choices are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server panel: remove the `!isMobile` gate; single `scrollIntoView({block:"nearest", inline:"nearest"})` serves both layouts, re-running on `server` change | Discussed — agreed approach; verified against `server-panel.tsx:91-97` | S:90 R:90 A:90 D:90 |
| 2 | Certain | Sessions pane: new effect keyed on `${server}:${windowId}` scrolls the `[data-window-id] [aria-current="page"]` row with `block:"nearest"`; scroll only, NO `focus()` | Discussed — focus-steal on desktop would break terminal typing; mobile effect focuses only to beat the focus trap | S:90 R:85 A:90 D:85 |
| 3 | Confident | Deep-link retry rides the existing `rowsVersion` counter with a pending-scroll ref — one scroll per selection change, never on passive SSE ticks | Discussed — `rowsVersion` bumps exactly when the visible-row set changes; Wave-2 #262 invariant forbids per-tick state churn | S:80 R:75 A:80 D:75 |
| 4 | Confident | Collapsed group containing the selected window → no-op (no auto-expand) | Discussed — auto-expand rejected as fighting the user's explicit collapse | S:85 R:80 A:75 D:80 |
| 5 | Confident | Desktop autoscroll does not sync `rovingKey` (scroll-only; roving/focus state untouched) | Conversation left sync optional with a never-on-SSE-ticks constraint; not syncing satisfies the constraint trivially and matches "scroll only, no focus" | S:40 R:85 A:65 D:55 |
| 6 | Certain | Keep `typeof el.scrollIntoView === "function"` guards on all scroll calls | Existing pattern at both sites; jsdom lacks `scrollIntoView` | S:85 R:95 A:95 D:95 |
| 7 | Confident | Desktop sidebar collapse/reopen does not re-trigger the scroll (effect keys on selection identity, not sidebar visibility) | Not discussed explicitly; selection-keyed dependency is the natural shape and re-scroll-on-reopen can be added trivially if wanted | S:35 R:85 A:60 D:50 |
| 8 | Confident | Change type `feat` (small feature: new desktop behavior, mobile behavior unchanged) | Conversation said "likely fix or small feature"; desktop never had this behavior, so it is additive; gate threshold is flat 3.0 either way | S:50 R:90 A:70 D:55 |
| 9 | Confident | Tests: Vitest unit tests for both effects (spy on `scrollIntoView`) plus e2e coverage where feasible, with `.spec.md` companions for any touched Playwright spec | code-quality.md mandates tests for changed behavior; exact unit/e2e mix left to plan | S:55 R:90 A:70 D:60 |

9 assumptions (3 certain, 6 confident, 0 tentative, 0 unresolved).
