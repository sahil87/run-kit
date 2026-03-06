# Intake: 1/3 Fixed Chrome Architecture

**Change**: 260305-emla-fixed-chrome-architecture
**Created**: 2026-03-05
**Status**: Draft

## Origin

> During a `/fab-discuss` session, a full UI design philosophy was developed for run-kit (documented in `docs/specs/design.md`). A gap analysis comparing the design spec to the current codebase revealed the root layout is minimal (`<body>` wrapper only), each page renders its own TopBar with inconsistent widths/padding, and there is no mechanism for pages to inject content into a shared chrome. This change is the structural foundation (1 of 3) that all subsequent UI work depends on.

Interaction mode: conversational (arose from design philosophy session + gap analysis). All decisions resolved during discussion.

## Why

1. **Top bar shifts between pages**: Dashboard and Project use `max-w-4xl mx-auto p-6`, Terminal uses `max-w-[900px] px-4`. Different widths and padding cause visible layout shift on navigation.
2. **No architectural constraint**: Each page renders its own TopBar. Nothing prevents a page from accidentally changing the chrome's height, width, or position. The spec requires it to be "architecturally difficult for the shift to occur."
3. **Line 2 collapses**: TopBar conditionally renders Line 2 (`{children && (...)}`), so height changes when a page has no actions.
4. **Breadcrumbs are verbose**: Current format uses text prefixes ("Dashboard › project: X › window: Y"). The spec requires compact icon-driven format (`{logo} › ⬡ X › ❯ Y`).
5. **Kill buttons invisible on mobile**: SessionCard uses `opacity-0 group-hover:opacity-100` — unreachable on touch devices.
6. **Blocks changes 2/3**: The bottom bar (change 2) and mobile polish (change 3) both need the chrome architecture to exist.

If we don't do this: every subsequent UI change fights the same structural problems. The bottom bar has nowhere to slot into.

## What Changes

### Root Layout Refactor (`src/app/layout.tsx`)

Transform from a minimal wrapper to the chrome owner:

```tsx
<html lang="en" className="dark">
  <body className="h-screen antialiased">
    <ChromeProvider>
      <div className="h-screen flex flex-col">
        {/* Top chrome — fixed height, shrink-0 */}
        <div className="shrink-0 max-w-4xl mx-auto w-full px-6">
          <TopBarChrome />
        </div>

        {/* Content — flex-1, scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-4xl mx-auto w-full px-6">
            {children}
          </div>
        </div>

        {/* Bottom slot — shrink-0, rendered by terminal page via context */}
        <BottomSlot />
      </div>
    </ChromeProvider>
  </body>
</html>
```

The `max-w-4xl mx-auto w-full px-6` wrapper appears on both chrome and content, ensuring identical width/padding. Pages can never override it.

### ChromeProvider Context (`src/contexts/chrome-context.tsx`)

New React context for slot injection:

```typescript
type ChromeContextType = {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  line2Left: React.ReactNode;
  setLine2Left: (node: React.ReactNode) => void;
  line2Right: React.ReactNode;
  setLine2Right: (node: React.ReactNode) => void;
  bottomBar: React.ReactNode;
  setBottomBar: (node: React.ReactNode) => void;
};
```

Each page's client component calls these setters via `useEffect` on mount/update. The layout renders whatever is in the slots. Height never changes regardless of slot content.

### TopBarChrome Component (`src/components/top-bar-chrome.tsx`)

Replaces the current `TopBar`. Reads from ChromeProvider context:

**Line 1** (fixed height):
- Left: Breadcrumbs with icon format
- Right: Connection dot + "live"/"disconnected", `⌘K` kbd hint

**Line 2** (fixed height — ALWAYS rendered, even when empty):
- Left: `line2Left` from context (or empty div)
- Right: `line2Right` from context (or empty div)
- Uses `min-h-[36px]` or equivalent to guarantee height

### Breadcrumb Icon Format

Replace text-based breadcrumbs with icon-driven format:

```
Dashboard:  {RunKit logo SVG}
Project:    {logo} › ⬡ run-kit
Terminal:   {logo} › ⬡ run-kit › ❯ zsh
```

- `{logo}` — inline SVG of the RunKit hex logo (already exists as favicon/logo), always links to `/`
- `⬡` — Unicode hexagon character, `text-text-secondary`, followed by session name
- `❯` — Unicode heavy right angle, `text-text-secondary`, followed by window name
- Each segment except the last is a clickable link
- No "project:" or "window:" text prefixes

### Page Rewiring

Each page's client component removes its own `<TopBar>` rendering and instead calls context setters:

**Dashboard** (`dashboard-client.tsx`):
- Remove `<TopBar>` JSX and its wrapping `max-w-4xl mx-auto p-6` container
- On mount: `setBreadcrumbs([])` (logo only on Dashboard)
- On mount: `setLine2Left(<>+ New Session button, search input</>)`
- On mount: `setLine2Right(<>session/window counts</>)`
- Content becomes just the session list (no wrapper div — layout provides it)

**Project** (`project-client.tsx`):
- Same pattern. `setBreadcrumbs([{ icon: '⬡', label: projectName, href: ... }])`
- Line 2: New Window + Send Message buttons (left), window count (right)

**Terminal** (`terminal-client.tsx`):
- Same pattern. Breadcrumbs with both project and window segments.
- Line 2: Kill Window button (left), activity/fab status (right)
- Remove the page-level `h-screen flex flex-col` — layout owns this now
- Terminal div becomes `flex-1` child of the layout's content area (not its own flex container)

### Kill Button Always Visible (`src/components/session-card.tsx`)

Change:
```tsx
className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-text-primary transition-opacity"
```
To:
```tsx
className="text-text-secondary hover:text-text-primary transition-colors"
```

Always visible on both desktop and mobile.

### Max-Width Standardization

Terminal page's `max-w-[900px]` → removed entirely (layout provides `max-w-4xl`). All three pages inherit the same width from the layout wrapper.

## Affected Memory

- `run-kit/architecture`: (modify) Note ChromeProvider, layout-owned chrome, TopBarChrome component
- `run-kit/ui-patterns`: (modify) Update TopBar section (icon breadcrumbs, Line 2 always-render, kill button visibility), note ChromeProvider pattern

## Impact

- **New files**: `src/contexts/chrome-context.tsx`, `src/components/top-bar-chrome.tsx`
- **Modified files**: `src/app/layout.tsx`, `src/components/top-bar.tsx` (removed or replaced), `src/components/session-card.tsx`, `src/app/dashboard-client.tsx`, `src/app/p/[project]/project-client.tsx`, `src/app/p/[project]/[window]/terminal-client.tsx`
- **Removed/replaced**: Current `TopBar` component (replaced by `TopBarChrome`)
- **Breaking**: All three pages fundamentally rewired. No incremental path — must be done atomically.
- **Risk**: Terminal page's xterm.js relies on `flex-1` to size correctly. Must verify FitAddon still works when the flex container moves from the page to the root layout.

## Open Questions

None — all decisions resolved during design discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root layout owns chrome (flex-col skeleton) | Discussed — spec § Layout Architecture, user confirmed | S:95 R:75 A:90 D:95 |
| 2 | Certain | ChromeProvider context for slot injection | Discussed — spec § Slot Injection, agreed on React Context approach | S:90 R:85 A:85 D:90 |
| 3 | Certain | Icon breadcrumbs: logo › ⬡ name › ❯ window | Discussed — user chose ⬡ (hexagon) and ❯ (prompt) specifically | S:95 R:95 A:90 D:95 |
| 4 | Certain | Line 2 always renders with fixed height | Discussed — spec explicitly states "EVEN WHEN EMPTY" | S:95 R:90 A:95 D:95 |
| 5 | Certain | Kill button always visible (no hover-reveal) | Discussed — Resolved Decision #8 in design spec | S:95 R:95 A:90 D:95 |
| 6 | Certain | max-w-4xl (896px) everywhere | Discussed — Resolved Decision #5, Tailwind native | S:90 R:95 A:95 D:95 |
| 7 | Confident | TopBarChrome as new component (not refactor of TopBar) | Clean break preferred — old TopBar has conditional rendering baked in, easier to build fresh | S:60 R:90 A:85 D:75 |
| 8 | Confident | Terminal xterm.js flex-1 will work under layout-owned container | FitAddon observes its container's size via ResizeObserver, should adapt regardless of which ancestor provides the flex context. Needs verification. | S:50 R:70 A:80 D:80 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
