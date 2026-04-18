# Intake: Sidebar header "current item" affordances — Server collapsed shade + Sessions header name

**Change**: 260418-zar8-server-panel-collapsed-selected-shade
**Created**: 2026-04-18
**Status**: Draft

> Note: slug retained from initial scope; title reflects expanded scope after the user's follow-up to include the Sessions header.

## Origin

One-shot `/fab-new` with a mid-flight scope expansion.

**Initial user input:**

> When the Server Panel is collapsed, it shows the background color of the selected server. But the shade it is using is that of the unselected mode. Instead, switch the shade to selected mode

**Scope-expanding follow-up:**

> Also - add another change to the scope. The ServerPanel header shows the current server. Similarly, make the Sessions header panel show to current session.

## Why

Two related visual-affordance fixes to the sidebar's collapsible/top-level sections:

1. **Collapsed ServerPanel header tint uses the wrong shade.** The header tint on a collapsed panel stands in for "the selected server lives here." It is currently painted with `tint.base` (14% blend — the *unselected* shade used by non-active tiles), so it reads as a faint ambient accent instead of a selection indicator. The active tile inside the expanded panel uses `tint.selected` (32% blend — over 2× more saturated), so the collapsed header visibly *under-announces* what it represents.
2. **Sessions header has no current-session affordance.** The Sessions panel header (`app/frontend/src/components/sidebar/index.tsx:511`) only shows the static label "Sessions" plus the `+` button. Meanwhile the ServerPanel header at the top of the sidebar *does* show the current server name on the right (`server-panel.tsx:81-86`). This is an inconsistency: a user glancing at the sidebar sees "which server is active" at the top but has to visually scan the session list to see "which session is active." Surfacing the current session name in the Sessions header mirrors the ServerPanel affordance and restores symmetry.

If unfixed: the collapsed ServerPanel is a weak selection indicator; the Sessions panel forces a scan to identify the active session. Neither is acutely broken, but both chip away at the "at-a-glance sidebar orientation" design goal baked into run-kit's UI (see `docs/memory/run-kit/ui-patterns.md` session/server row conventions).

The chosen approaches reuse existing primitives (`RowTint.selected`, the `headerRight` pattern from `CollapsiblePanel`) and don't require new theme tokens, API surface, or layout changes.

## What Changes

### 1. `CollapsiblePanel` collapsed-header tint shade

`app/frontend/src/components/sidebar/collapsible-panel.tsx:252-264` currently paints the header background from `tint.base`, with hover → `tint.hover`:

```tsx
const headerTint = tint && (!tintOnlyWhenCollapsed || !isOpen) ? tint : null;
// ...
<div
  style={headerTint ? { backgroundColor: headerTint.base } : undefined}
  onMouseEnter={headerTint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = headerTint.hover; } : undefined}
  onMouseLeave={headerTint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = headerTint.base; } : undefined}
>
```

**Desired behavior**: when `tintOnlyWhenCollapsed` is true (the semantic flag meaning "this header tint is a proxy for the selected item inside"), paint the header from `tint.selected` instead. Hover stays at `tint.selected` (see Assumption #5 — no visible hover darken, avoids the inverted-saturation problem of `tint.hover` being *less* saturated than `tint.selected`).

Only `ServerPanel` currently passes `tint` + `tintOnlyWhenCollapsed`; `host-panel.tsx` and `status-panel.tsx` do not (grep-verified). So behavior flip is isolated to the ServerPanel use case.

Two mechanical options:
- **Option A (preferred)** — gate shade on the existing `tintOnlyWhenCollapsed` flag inside `CollapsiblePanel`. Zero new props. Contract: "tint-as-selected-proxy" ⇒ use `.selected`.
- **Option B** — new prop `tintShade?: "base" | "selected"`, default `"base"`, `ServerPanel` passes `"selected"`. Explicit but adds surface for a single caller.

Pick Option A — if a future caller wants "collapse-only tint at base saturation," Option B can be retrofitted.

### 2. Current session name in Sessions header

Current Sessions header (`app/frontend/src/components/sidebar/index.tsx:510-522`):

```tsx
<div className="border-t border-border flex-1 min-h-0 flex flex-col">
  <div className="flex items-center gap-1.5 w-full pl-5 pr-1.5 sm:pr-2 py-1 text-xs text-text-primary shrink-0 border-b border-border">
    <span className="font-medium">Sessions</span>
    <span className="ml-auto">
      <button onClick={onCreateSession} aria-label="New session" ...>+</button>
    </span>
  </div>
  ...
</div>
```

Reference pattern from ServerPanel (`server-panel.tsx:81-86`):

```tsx
const headerRight = (
  <>
    <span className="truncate text-text-primary font-mono">{server}</span>
    {refreshing && <LogoSpinner size={10} />}
  </>
);
```

**Desired behavior**: the Sessions header displays the current session name on the right, between "Sessions" and the `+` button — using the same typographic treatment (`truncate text-text-primary font-mono`) for consistency. When `currentSession` is `null` (no session selected), omit the name (show nothing) rather than a placeholder.

Example target markup:

```tsx
<div className="flex items-center gap-1.5 w-full pl-5 pr-1.5 sm:pr-2 py-1 text-xs text-text-secondary shrink-0 border-b border-border">
  <span className="font-medium">Sessions</span>
  {currentSession && (
    <span className="ml-auto flex items-center gap-1 min-w-0 truncate">
      <span className="truncate text-text-primary font-mono">{currentSession}</span>
    </span>
  )}
  <span className={currentSession ? "" : "ml-auto"}>
    <button onClick={onCreateSession} aria-label="New session" ...>+</button>
  </span>
</div>
```

`currentSession` is already threaded into the `Sidebar` component as a prop (`index.tsx:22, 39`), so no new prop wiring is required.

**Text color note**: ServerPanel's header uses `text-text-secondary` with the name painted `text-text-primary`. The current Sessions header uses `text-text-primary` on the whole bar. For full visual parity we may want to normalize Sessions header to `text-text-secondary` with the session name in `text-text-primary` — captured as Assumption #8.

**Header tint for current session color?** Out of scope by default (see Assumption #9). The Sessions panel is not collapsible (always open), so a persistent selected-shade tint on its header would be visually heavy and potentially double up with the colored active `WindowRow` below. Open Question Q2 flags this for clarify.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Note the collapsed-header tint-shade rule on `CollapsiblePanel` (with `tintOnlyWhenCollapsed`, the header uses `RowTint.selected`, hover stays at selected). Also document the Sessions header showing `currentSession` on the right in the ServerPanel-style `headerRight` pattern.

## Impact

- **Files changed (expected)**:
  - `app/frontend/src/components/sidebar/collapsible-panel.tsx` — header tint shade branch (~4 lines)
  - `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` — unit coverage for shade selection (base vs. selected) when `tintOnlyWhenCollapsed` is set
  - `app/frontend/src/components/sidebar/index.tsx` — Sessions header `currentSession` display (~8 lines)
  - `docs/memory/run-kit/ui-patterns.md` — memory note (during hydrate)
- **Potential**: `app/frontend/tests/**` Playwright specs may assert on sidebar header composition; to be checked at spec stage. Any spec file touched must ship with a sibling `.spec.md` update per Constitution.
- **APIs / contracts**: None.
- **Dependencies**: None.
- **Other sidebar panels** (`HostPanel`, `StatusPanel`): unaffected.

## Open Questions

<!-- clarified: Q1 resolved — Option H1 (hover stays flat at `tint.selected`). See Assumption #5 / Clarifications session 2026-04-18. -->
<!-- clarified: Q2 resolved — Sessions header does NOT tint; name only. See Assumption #9 / Clarifications session 2026-04-18 (bulk confirm). -->
<!-- clarified: Q3 resolved — Option N1 (normalize Sessions header to `text-text-secondary` baseline with session name in `text-text-primary`). See Assumption #8 / Clarifications session 2026-04-18. -->

All open questions resolved.

## Clarifications

### Session 2026-04-18 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 4 | Confirmed | — |
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 9 | Confirmed | — |
| 10 | Confirmed | — |
| 11 | Confirmed | — |

### Session 2026-04-18 (tentatives)

| # | Q | Answer |
|---|---|--------|
| 5 | Hover on tinted collapsed header — flat at `selected` (H1) or deeper hover (H2)? | H1 — stay flat at `tint.selected` |
| 8 | Sessions header text color — normalize to `text-text-secondary` + name in `text-text-primary` (N1), or leave as-is (N2)? | N1 — normalize for ServerPanel parity |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope limited to: (a) collapsed `CollapsiblePanel` header tint shade (triggered by `ServerPanel`), and (b) `currentSession` display in the Sessions panel header | Directly scoped by user's initial message + follow-up | S:95 R:95 A:95 D:95 |
| 2 | Certain | Active-tile body tint in `ServerPanel` (already uses `tint.selected`) is out of scope | Body coloring is correct today (`server-panel.tsx:222-224`) | S:90 R:95 A:95 D:95 |
| 3 | Certain | Fix #1 lands in `app/frontend/src/components/sidebar/collapsible-panel.tsx`; fix #2 lands in `app/frontend/src/components/sidebar/index.tsx` | File locations grep-verified | S:90 R:95 A:95 D:95 |
| 4 | Certain | Use Option A for fix #1 — gate shade on existing `tintOnlyWhenCollapsed` flag; no new prop | Clarified — user confirmed | S:95 R:85 A:80 D:70 |
| 5 | Certain | Hover on tinted collapsed header stays at `tint.selected` (no darken on hover — Option H1) | Clarified — user confirmed H1 | S:95 R:80 A:65 D:55 |
| 6 | Certain | Reuse `RowTint.selected` (`themes.ts:206-232`); no new tint field | Clarified — user confirmed | S:95 R:90 A:90 D:85 |
| 7 | Certain | Sessions header uses the ServerPanel `headerRight` pattern: `<span className="truncate text-text-primary font-mono">{currentSession}</span>`, omitted entirely when `currentSession` is null | Clarified — user confirmed | S:95 R:90 A:85 D:80 |
| 8 | Certain | Sessions header baseline text color normalizes to `text-text-secondary` (with session name in `text-text-primary`) for ServerPanel parity — Option N1 | Clarified — user confirmed N1 | S:95 R:80 A:60 D:55 |
| 9 | Certain | Sessions header does NOT tint from current session color — name only | Clarified — user confirmed | S:95 R:85 A:75 D:65 |
| 10 | Certain | Memory update scoped to `run-kit/ui-patterns`; no spec doc change | Clarified — user confirmed | S:95 R:85 A:85 D:80 |
| 11 | Certain | Unit coverage lives in `collapsible-panel.test.tsx` and (optionally) sidebar-level test; no new Playwright spec required unless existing spec asserts sidebar header composition | Clarified — user confirmed | S:95 R:85 A:70 D:75 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
