# Intake: Rotated Shell Layout

**Change**: 260509-17m3-rotated-shell-layout
**Created**: 2026-05-09
**Status**: Draft

## Origin

This change emerged from a `/fab-discuss` session reviewing the just-shipped pane-boards (`260507-4vuv-pane-boards`) and multi-server SessionProvider (`260508-dc0t-multiserver-session-provider`) work. With dc0t's unification of the sidebar (BoardPage no longer rendering its own mini-sidebar), the `app-shell` topology — TopBar spanning full width on top, Sidebar | terminal-column-with-bottombar below — became the limiting factor for two distinct UX outcomes:

1. The sidebar is now visibly the **navigation spine** of the app (Servers, Boards, per-server-grouped Sessions), but it's structurally a *panel* underneath the TopBar. Users perceive it as the primary navigation surface; the layout doesn't reflect that.
2. The board view's horizontal scroll viewport is bounded on the left by sidebar.right — but the TopBar above the board content has its own left edge (also sidebar.right). When sidebar collapses, both edges should move in lockstep; today the topbar's hamburger orphans alone on the left while everything else widens differently.

> **User input**: "I am thinking about a new overall layout structure. Left panel takes 100% height. The top panel starts from the right side of the left panel. The structure would be — the whole page gets divided horizontally into two parts — left panel, body. Left panel is collapsible — but this collapsibility is controlled by the hamburger icon, which resides on the left side of the top bar. The body itself is divided into two parts — top bar, content, bottom panel. The content itself is takes two different forms — board view, or single terminal. Board view is horizontally scrollable."

The discussion resolved several substantive design questions:

1. **Collapsed mode**: Sidebar collapses to **0px (fully hidden)**, not a 48px rail. When collapsed, the hamburger relocates from sidebar-adjacent to topbar.left. Tradeoff accepted: a small layout shift on toggle, in exchange for max content width when collapsed.

2. **Sidebar section order**: User corrected the initial mockup — Boards section MUST be **above Servers**, not below. The reasoning: a board is a curated workspace; Servers/Sessions are raw material. The top-of-sidebar is the highest-affinity destination, and that's the boards. As a side effect, the Boards section should remain visible even when empty (with a hint), to avoid a layout shift when the first board materializes.

3. **BottomBar's role**: User corrected the assumption that BottomBar would carry route-specific informational content. The BottomBar is the **terminal-input toolbar** (Tab, Ctrl, Alt, F-key palette, Arrow pad, Compose, ⌘K, mobile keyboard toggle) — it's an input device, not an info strip. Therefore it must be **byte-identical across single-terminal and board routes**, because a board pane is just a terminal that wants the same input affordances. The role-flip: TopBar absorbs the informational variation by route.

4. **BottomBar target in board mode**: Because the BottomBar is unchanged but the board has multiple terminals, the BottomBar's input target (`wsRef`) must point at the **focused pane**, not at "the route's terminal". Cycling focus via `Cmd+[` / `Cmd+]` re-points the BottomBar.

5. **Mobile model**: The rotation applies conceptually but mobile sidebar is **overlay-mode** (almost-fullscreen on open, dismissed by user before resuming work). Sidebar overlays content rather than pushing it. On mobile, expanding the sidebar is a modal interaction.

6. **Board scroll origin**: Board horizontal-scroll viewport starts **flush with sidebar.right** (no left gutter). Maximizes scrollable real estate; board-level actions stay in the topbar.

## Why

### The problem

The current `app-shell` topology has three structural awkwardnesses that compound after the dc0t multi-server refactor:

1. **The sidebar visually says "I am the spine" but structurally is a panel.** It now contains three first-class navigation surfaces (Servers, Boards, per-server-grouped Sessions) that, post-dc0t, can be tall enough to scroll. Capping it with a horizontal TopBar that owns the full top edge creates a visual hierarchy where the topbar reads as the parent container — but the sidebar carries the actual navigation. The mismatch costs ~40-48px of vertical real estate in the most-scrolled element on the page.

2. **The board view is bounded twice on the left.** The board's horizontal scroll viewport's left edge sits at sidebar.right. The TopBar above it has its own left edge — also at sidebar.right today (after a ☰ icon at topbar.left), but the relationship is incidental, not structural. When the sidebar resizes (drag-handle today, collapse-toggle proposed) the topbar's left edge moves separately from the content's left edge. The hamburger floats alone in the topbar while the rest of the topbar slides.

3. **The hamburger's collapse origin doesn't match its placement.** Today the hamburger is at TopBar.left; clicking it collapses the Sidebar that sits *below* it on the right. The animation pulls a thing that doesn't visually originate from the icon. After rotation, sidebar.right and topbar.left share a vertical seam, and the hamburger sits exactly at that seam. The collapse animation pulls the sidebar's right edge to where the hamburger is — the gesture's natural origin.

### What happens if we don't fix it

The mismatch between "sidebar is structurally a panel" and "sidebar is conceptually the spine" entrenches as more navigation moves into the sidebar. dc0t already added per-server grouping (multiplying sidebar height by N servers). Future features that are sidebar-native (saved searches, recent windows, idle/active filtering) will face the same vertical-real-estate squeeze. Each one will tempt a workaround — collapsing sections by default, smaller fonts, condensed spacing — instead of fixing the structural cause.

The board scroll bounded-twice-on-the-left issue is less severe but cumulatively painful: every time the sidebar drag handle moves, it's costing pane visibility. With sidebar collapsed today, the topbar still reserves its lonely left-side hamburger area; the board content widens but the topbar widens *differently*, creating visual jank across the seam.

### Why this approach over alternatives

Three approaches were considered:

- **Status quo with cosmetic touchup** (rejected): minor padding/border adjustments to make the seam look intentional. Doesn't address the spatial mismatch — the hamburger still doesn't originate at the sidebar.

- **Rail-mode sidebar (48px collapsed)** (rejected by user, recommended by analysis): when collapsed, sidebar narrows to a 48px icon rail (logo, hamburger, server tiles, board pins). Hamburger never moves; matches VS Code/Linear/Slack patterns. Cleaner structurally but rejected by user in favor of fully-hidden mode for max content width when collapsed.

- **Full rotation with 0px collapse** (chosen): sidebar is full-height, collapses to width 0, hamburger relocates to topbar.left when collapsed. Matches user's literal phrasing; maximizes content width when collapsed; introduces a minor layout shift (hamburger position) on toggle but is otherwise structurally simpler than rail-mode (the collapsed state is equivalent to "no sidebar at all").

Boards-above-Servers ordering: the alternative is Servers-above-Boards (today's order, per dc0t intake §2). Servers-first matches a hierarchical "where am I?" mental model (server → session → window). Boards-first matches a "what am I trying to do?" model — boards are curated destinations, servers are infrastructure. The user chose Boards-first explicitly: a fresh user sees the boards section at top, the empty-state hint teaches the value proposition, and curated workspaces outrank raw infrastructure. Aligns with run-kit's project description ("Web based agent orchestration framework") — boards are the orchestration surface.

BottomBar-unchanged: the alternative is route-aware BottomBar (different content for board vs single-terminal). User rejected — the BottomBar is the terminal-input toolbar; a board pane is a terminal; therefore the toolbar applies identically. The route-varying informational content (pane count, server count, cycle hints, board breadcrumb) belongs in the topbar where it doesn't compete with input affordances.

CSS Grid over nested flex: the alternative is keeping nested flex (today's pattern) and just reordering. Grid is materially cleaner here because the rotation makes sidebar a column that spans all three rows (topbar, content, bottombar). Expressing "sidebar spans 3 rows; right column is 3 stacked rows" with flex requires either (a) sidebar as a sibling of a flex-col right column, which needs `align-items: stretch` and explicit height management, or (b) a 2-row layout with sidebar inside row 1, which doesn't match the visual spec. Grid encodes the topology directly: `grid-template-areas: "sidebar topbar" "sidebar content" "sidebar bottombar"`. Collapse becomes a single CSS variable (`--sidebar-width: 0`) that auto-collapses the column.

## What Changes

### 1. New shell topology — CSS Grid

**File**: `app/frontend/src/app.tsx` (the `AppShell` function, ~line 920) and `app/frontend/src/components/board/board-page.tsx` (the BoardPage layout).

**Current shell structure** (AppShell, abridged):

```tsx
<div className="app-shell flex flex-col" style={{ height: "var(--app-height, 100vh)" }}>
  <div className="shrink-0">                      {/* TopBar — full width */}
    <TopBar onToggleSidebar={...} ... />
  </div>
  <div className="flex-1 flex flex-row min-h-0">  {/* Main row */}
    {sidebarOpen && (
      <div style={{ width: sidebarWidth }}>       {/* Sidebar */}
        <Sidebar ... />
      </div>
    )}
    <div className="flex-1 flex flex-col">        {/* Terminal column */}
      <TerminalClient .../>
      <BottomBar wsRef={wsRef} .../>
    </div>
  </div>
</div>
```

**New shell structure** — both AppShell and BoardPage share a `<Shell>` wrapper component:

```tsx
// new file: src/components/shell/shell.tsx
export function Shell({ children }: { children: ReactNode }) {
  const { sidebarOpen, sidebarWidth } = useChromeState();
  return (
    <div
      className="app-shell"
      style={{
        height: "var(--app-height, 100vh)",
        display: "grid",
        gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px 1fr` : "0 1fr",
        gridTemplateRows: "auto 1fr auto",
        gridTemplateAreas: `
          "sidebar topbar"
          "sidebar content"
          "sidebar bottombar"
        `,
      }}
    >
      {children}
    </div>
  );
}
```

Children use named grid-area placement:

```tsx
<Shell>
  <aside style={{ gridArea: "sidebar" }}>
    <Sidebar ... />
  </aside>
  <header style={{ gridArea: "topbar" }}>
    <TopBar ... />
  </header>
  <main style={{ gridArea: "content" }}>
    {/* TerminalClient | BoardContent | IframeWindow */}
  </main>
  <footer style={{ gridArea: "bottombar" }}>
    <BottomBar />
  </footer>
</Shell>
```

**Sidebar collapse**: setting `sidebarOpen = false` zeroes the first column. The `sidebar` grid area becomes 0-width but still exists; the `topbar` / `content` / `bottombar` cells extend to page.left automatically. No JS-side conditional rendering needed for the collapse; the CSS does it.

**Sidebar resize**: the existing drag-handle pattern from `app.tsx` (drag handle between Sidebar and content) becomes a vertical seam between the `sidebar` grid area and the `topbar/content/bottombar` stack. Width clamping (160-400px) is unchanged.

### 2. Hamburger relocation on collapse

**Current**: `TopBar` always renders `☰` at its left edge ([app.tsx:934](app/frontend/src/app.tsx#L934) — `onToggleSidebar` prop).

**New**:

- When `sidebarOpen` is true: `☰` renders inside `TopBar` at its left edge (same as today). Visually it sits at the sidebar.right / topbar.left seam.
- When `sidebarOpen` is false: `☰` still renders inside `TopBar` at its left edge, but topbar.left is now page.left (sidebar column is 0-width). Visually the icon has "moved" from sidebar-adjacent to page-adjacent, but in component terms it never moved — it's always at TopBar's left.

This means **no component-level relocation logic is needed**. The hamburger's home is `TopBar.left`. The visual relocation is a side effect of the grid column collapsing.

There IS one nuance: when sidebar is open, the user might expect the hamburger to look "attached" to the sidebar (its right edge). With the static-in-topbar placement, it's instead "attached" to the topbar's left edge. These are pixel-identical positions when sidebar is open and the seam is shared, so no visible difference — but worth noting that the gesture origin (mouse down on ☰, sidebar slides closed) reads correctly regardless.

### 3. Sidebar section order — Boards → Servers → Sessions

**File**: `app/frontend/src/components/sidebar/index.tsx`

**Current order** (per dc0t intake §2 and the rendered structure):
```
[Server panel]    ← server tiles
[Boards section]  ← cross-server boards
[Sessions]        ← per-server grouped tree (post-dc0t)
```

**New order**:
```
[Boards section]  ← always visible, hint when empty
[Server panel]    ← server tiles
[Sessions]        ← per-server grouped tree
```

**Boards-section visibility change**: 4vuv §5 said "hidden entirely when zero boards exist." With Boards now at the top, hiding-when-empty creates a layout shift (Servers jumps to top, then jumps back when first board materializes). New rule: **always visible at top**, with a one-line empty-state hint:

```
▾ Boards
   (no boards yet — pin a window to start one)
```

The hint is informational, not interactive. Pinning happens from the sidebar's pin icon on each window row (existing 4vuv behavior) or the command palette.

### 4. BottomBar moves up the tree, reads from FocusedTerminalContext

**Today**: `BottomBar` is rendered inside `AppShell`'s terminal column, with `wsRef` prop pointing at the single terminal's WebSocket ([app.tsx:1004-1018](app/frontend/src/app.tsx#L1004-L1018) area, `BottomBar` line varies). `BoardPage` does NOT render a BottomBar at all — board panes have no terminal-input toolbar.

**New**:

#### 4a. BottomBar relocates to shell-level

The BottomBar lives in the shell's `bottombar` grid area, rendered once per route by `AppShell` and `BoardPage`. It is no longer scoped to the terminal column.

#### 4b. New `FocusedTerminalContext`

A new file: `app/frontend/src/contexts/focused-terminal-context.tsx`.

```tsx
type FocusedTerminal = {
  wsRef: RefObject<WebSocket | null>;
  server: string;
  session: string;
  windowIndex: string;
} | null;

type FocusedTerminalContextValue = {
  focused: FocusedTerminal;
  setFocused: (t: FocusedTerminal) => void;
};
```

The context tracks the currently-focused terminal across the app. There is exactly one focused terminal at any time (or `null` if no terminal is mounted, e.g., on a future dashboard route).

**Producers**:

- **`TerminalClient`** (single-terminal route): on mount, calls `setFocused({ wsRef, server, session, windowIndex })`. On unmount, clears via `setFocused(null)`. This was implicit before — there was only one terminal — and is now explicit.
- **`BoardPane`** (board route): tracks per-pane focus state internally (already does, for the visual focus border and `Cmd+[`/`Cmd+]` cycling). When this pane gains focus (click, cycle-to, or initial pane on mount), call `setFocused({ wsRef, server, session, windowIndex })`. When focus is lost or pane unmounts, leave the context alone (next pane to gain focus overwrites).

**Consumers**:

- **`BottomBar`**: reads `focused.wsRef` from context; uses it where today it consumes the `wsRef` prop. The `wsRef` prop is removed from `BottomBar`'s API.

#### 4c. BottomBar API change

```ts
// Before
type BottomBarProps = {
  wsRef: React.RefObject<WebSocket | null>;
  onOpenCompose?: () => void;
  onFocusTerminal?: () => void;
  onScrollLockChange?: (locked: boolean) => void;
};

// After
type BottomBarProps = {
  // wsRef removed — read from FocusedTerminalContext
  onOpenCompose?: () => void;
  onFocusTerminal?: () => void;
  onScrollLockChange?: (locked: boolean) => void;
};
```

When `focused` is `null`, BottomBar's input handlers no-op (today's `wsRef.current?.readyState !== OPEN` check covers this naturally — the existing guard pattern continues to work).

#### 4d. Compose buffer target

The compose buffer (`>_` button → opens compose dialog → sends multiline text) captures the current focus when opened. If the user changes focus while compose is open, the compose buffer's target is **frozen** at the originally-focused terminal. This prevents accidental wrong-pane sends.

Implementation: `onOpenCompose` snapshots `focused.wsRef` at the moment the compose UI mounts; the compose component uses the snapshot for its lifetime, not the live context.

### 5. TopBar absorbs route-varying informational content

**File**: `app/frontend/src/components/top-bar/*` (the existing TopBar component family).

**Current TopBar content** (single-terminal route): breadcrumbs (server / session / window), connection status, theme toggle, FixedWidthToggle, ⌘K trigger.

**New TopBar content by route**:

#### Single-terminal route (`/$server/$session/$window`)
Unchanged. Breadcrumbs + status + chrome controls.

#### Board route (`/board/$name`)
Replaces breadcrumbs with **board mode**:

```
☰  Board ▸ main ▾    4 panes · 3 servers · ⌘[⌘] cycle    ⌘K
```

- `Board ▸ main ▾` is the existing board breadcrumb dropdown from 4vuv (already shipped).
- New: **inline board info** — `4 panes · 3 servers` (counts derived from `useBoardEntries(name)`).
- New: **cycle hint** — `⌘[⌘] cycle` (a small visual reminder that focus cycling is keyboard-driven, since the board has no per-pane focus button).

These three move from where they would have lived in BottomBar (per the original mockup) up to the topbar.

#### Root route (`/`)
Unchanged for now. Shows the dashboard's existing chrome.

### 6. BoardPage layout simplification

**File**: `app/frontend/src/components/board/board-page.tsx`

**Current** (post-dc0t): `BoardPage` renders its own root `<div>` containing `<Sidebar/>` and a board-content `<div>`. There is no BottomBar. The container handles its own height/flex management.

**New**: `BoardPage` returns the same content structure but inside the shared `<Shell>` wrapper:

```tsx
export function BoardPage(_props: BoardPageRouteProps) {
  return (
    <Shell>
      <aside style={{ gridArea: "sidebar" }}>
        <Sidebar ... />
      </aside>
      <header style={{ gridArea: "topbar" }}>
        <TopBar mode="board" boardName={name} paneCount={...} serverCount={...} />
      </header>
      <main style={{ gridArea: "content" }}>
        <BoardContent name={name} />  {/* existing horizontal-scroll panes */}
      </main>
      <footer style={{ gridArea: "bottombar" }}>
        <BottomBar />  {/* shared, reads focus from context */}
      </footer>
    </Shell>
  );
}
```

- BoardPage gets a BottomBar for the first time — reads from FocusedTerminalContext; when the user clicks/cycles to a pane, that pane's WS becomes the BottomBar's target.
- Board horizontal scroll viewport (`BoardContent`) lives inside the `content` grid area. Its left edge is sidebar.right (or page.left when sidebar is collapsed). No left gutter.

### 7. AppShell symmetric simplification

**File**: `app/frontend/src/app.tsx`

`AppShell` undergoes the parallel restructure:

```tsx
function AppShell() {
  // ... existing prop derivation ...
  return (
    <Shell>
      <aside style={{ gridArea: "sidebar" }}>
        <Sidebar ... />
      </aside>
      <header style={{ gridArea: "topbar" }}>
        <TopBar mode="terminal" ... />
      </header>
      <main style={{ gridArea: "content" }}>
        {/* TerminalClient | IframeWindow | Dashboard, as before */}
      </main>
      <footer style={{ gridArea: "bottombar" }}>
        <BottomBar />
      </footer>
    </Shell>
  );
}
```

The `wsRef` that today flows from `TerminalClient` (lifted via `useRef` in AppShell) into `BottomBar` is now flowed via `FocusedTerminalContext` instead — `TerminalClient` registers itself as focused on mount.

### 8. Mobile — overlay sidebar

**File**: `app/frontend/src/components/shell/shell.tsx` (new) and the Sidebar wrapper.

On mobile (< 640px breakpoint), the grid topology is different:

```css
@media (max-width: 639px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "topbar"
      "content"
      "bottombar";
  }
}
```

Sidebar is removed from the grid entirely. When `sidebarOpen` is true on mobile, sidebar renders as a **fixed-position overlay**:

```tsx
{sidebarOpen && isMobile && (
  <aside
    className="fixed inset-y-0 left-0 z-50 w-[88%] max-w-[320px] bg-bg-primary shadow-2xl"
    role="dialog"
    aria-modal="true"
  >
    <Sidebar ... />
  </aside>
)}
```

- **Open behavior**: tapping the hamburger (always at TopBar.left on mobile) opens the overlay. The page content is dimmed (backdrop) but not pushed.
- **Close behavior**: explicit `×` close button at sidebar top-right; tap-on-backdrop to dismiss; tap-on-destination (e.g., a session row) auto-closes after navigation.
- **The user dismisses before resuming work** — matches the discussion outcome. The overlay is modal in feel (not a slide-out drawer that lingers).

Mobile sidebar order is still Boards → Servers → Sessions.

### 9. Component boundary changes

A new component file appears: `app/frontend/src/components/shell/shell.tsx` containing the grid wrapper. Both `AppShell` and `BoardPage` import and use it.

`useChromeContext` (`@/contexts/chrome-context`) gains the `sidebarOpen` and `sidebarWidth` state if not already there, so they're shared between AppShell and BoardPage rather than local-state-per-route. (Both routes today manage `sidebarOpen` independently — moving it to chrome-context unifies the toggle behavior across routes.)

## Affected Memory

- `run-kit/architecture.md`: (modify) — Update the shell topology description: app-shell is a CSS grid with sidebar spanning all three rows (topbar/content/bottombar). Document the FocusedTerminalContext as the BottomBar input target. Note that AppShell and BoardPage share the Shell wrapper.
- `run-kit/ui-patterns.md`: (modify) — Update Sidebar section: section order is Boards → Servers → Sessions; Boards always visible with empty hint; rotation pattern (sidebar full-height, hamburger at TopBar.left). Update BottomBar section: terminal-input toolbar shared across routes, target via FocusedTerminalContext. Add note on the mobile overlay-mode sidebar.
- `run-kit/tmux-sessions.md`: no change — this is a frontend layout refactor only; tmux-layer behavior is unaffected.

## Impact

### Frontend (TypeScript/React)

- **New files**:
  - `src/components/shell/shell.tsx` — the grid wrapper used by both AppShell and BoardPage
  - `src/contexts/focused-terminal-context.tsx` — context for the BottomBar's input target
  - `src/components/shell/shell.test.tsx` — grid topology tests (sidebar collapse, mobile overlay)
  - `src/contexts/focused-terminal-context.test.tsx` — focus-tracking tests

- **Modified files**:
  - `src/app.tsx` — `AppShell` adopts `<Shell>`; lift `sidebarOpen`/`sidebarWidth` into `chrome-context` if not already there
  - `src/components/board/board-page.tsx` — wrap in `<Shell>`; render BottomBar; remove now-redundant root-div height/flex management
  - `src/components/sidebar/index.tsx` — reorder sections (Boards top, Servers middle, Sessions bottom); always-visible Boards section with empty-state hint
  - `src/components/sidebar/boards-section.tsx` — empty-state hint UI
  - `src/components/bottom-bar.tsx` — remove `wsRef` prop; consume `useFocusedTerminal()` from context
  - `src/components/bottom-bar.test.tsx` — update tests to provide focused-terminal context instead of `wsRef` prop
  - `src/components/terminal-client.tsx` — register as focused on mount, clear on unmount
  - `src/components/board/board-pane.tsx` — register as focused on focus events (click, cycle-to, initial pane)
  - `src/components/top-bar.tsx` (or `top-bar/*`) — accept a `mode` prop ("terminal" | "board" | "root"); render board info (pane count, server count, cycle hint) when in board mode
  - `src/contexts/chrome-context.tsx` — add `sidebarOpen` and `sidebarWidth` to chrome state if not already there; expose toggles
  - `src/components/compose-buffer.tsx` — snapshot focused wsRef at mount; use snapshot for lifetime (don't re-bind on focus changes)
  - `src/globals.css` — possibly add the mobile-breakpoint grid override (or keep inline in Shell with Tailwind breakpoint utilities)

- **Test files updated**: `bottom-bar.test.tsx`, `sidebar.test.tsx` (per-section ordering assertions), `board-page` tests (BottomBar presence, focus tracking).

- **No new dependencies**.

### Backend (Go)

- **No changes**. This is a frontend layout refactor.

### E2E Tests

- New e2e test: `app/frontend/tests/e2e/shell-rotation.spec.ts` — exercises the rotation across mobile and desktop, sidebar collapse, focus tracking in board mode.
- Existing e2e tests should pass unchanged. The visible UX is the same component tree expressed in a different topology; routes, navigation, and component contracts are stable except where called out above.
- E2E test for BottomBar focus tracking in board mode: open a board with two panes from the same session, focus pane 1, type via Compose, verify pane 1 received the input; cycle to pane 2, type again, verify pane 2 received it (and pane 1 did NOT).

### Constitution alignment

- **IV. Minimal Surface Area** — adds zero routes; consolidates layout (BoardPage's bespoke layout disappears).
- **V. Keyboard-First** — the hamburger gets a keyboard binding (already exists?); cycle hint surfaced in topbar reinforces the keyboard-first principle.
- **VII. Convention Over Configuration** — derives sidebar/topbar/bottombar from a single `<Shell>` wrapper; no new configuration knob.

### Configuration / new env vars

- **None**. Sidebar width persists in localStorage as today (`runkit-sidebar-width`); `sidebarOpen` persistence (TBD — see Open Questions) would also be localStorage-only.

## Open Questions

- **Sidebar-open persistence**: Should `sidebarOpen` persist across reloads/sessions in localStorage? Or always reset to "open on desktop, closed on mobile" on each load? Default plan: persist per-device (single localStorage key `runkit-sidebar-open`), with sensible defaults on first visit.
- **Hamburger keyboard shortcut**: Today's `onToggleSidebar` is wired to a button in TopBar. Is there an existing keyboard binding to toggle? If not, add one (e.g., `Cmd+\`) to the keybindings registry — fits Constitution V.
- **Compose buffer target on focus change**: confirmed in the design as "freeze at compose-open time" — but verify this doesn't conflict with any existing compose-buffer behavior that re-binds.
- **Initial focused pane on board mount**: which pane is focused when a board first renders? Options: (a) first pane in order, (b) last-focused-from-localStorage per-board, (c) no pane focused until user clicks/cycles. Default plan: (a) first pane — simplest and matches users' likely expectation that "focus" starts at the leftmost pane.
- **Drag-to-resize seam in collapsed mode**: when `sidebarOpen` is false, does the drag handle still exist (allowing drag-from-zero to expand)? Default plan: drag handle is hidden when collapsed; the hamburger is the only re-open affordance. Simpler and matches "fully hidden" semantics.
- **Empty-state hint copy**: "Pin a window to start a board" — does this stay verbatim from 4vuv §5, or get a refresh? Default plan: keep verbatim; minimize copy churn.
- **Animation on collapse**: should the grid column width transition smoothly (CSS transition on `grid-template-columns`) or snap? Default plan: smooth transition (~150ms ease-out) — matches the existing sidebar-resize feel; verify `grid-template-columns` is animatable in Safari/Chrome (it is, with caveats about layout thrashing on the right column — measure during spec).
- **Mobile breakpoint**: the project uses 640px in some places and `coarse:` (touch pointer) in others. Which governs the overlay-mode switch? Default plan: 640px width breakpoint, since the overlay vs structural distinction is about screen real estate, not pointer type. Touch on a wide screen still gets structural sidebar.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sidebar is full-height (page.top to page.bottom); TopBar starts at sidebar.right | Discussed — user explicitly described this topology in the seed message | S:100 R:80 A:95 D:100 |
| 2 | Certain | Sidebar collapse hides it fully (width: 0), not a 48px rail | Discussed — user chose "fully hidden (0px) with hamburger in topbar" over rail-mode in the answered AskUserQuestion | S:100 R:75 A:90 D:95 |
| 3 | Certain | Hamburger icon lives at TopBar.left in both states; visually relocates only because the sidebar column collapses | Discussed — user's seed message says "hamburger icon, which resides on the left side of the top bar"; static-in-topbar placement avoids component-level relocation logic | S:95 R:85 A:90 D:90 |
| 4 | Certain | Sidebar section order is Boards → Servers → Sessions (top to bottom) | Discussed — user explicitly corrected the initial mockup that had Servers above Boards | S:100 R:75 A:90 D:100 |
| 5 | Certain | Boards section is always visible (with empty-state hint); does not hide when zero boards exist | Derived — placing Boards at top means hide-when-empty creates a layout shift; always-visible-with-hint avoids it. 4vuv §5 deferred this question to spec; this change resolves it | S:90 R:80 A:85 D:90 |
| 6 | Certain | BottomBar is byte-identical across single-terminal and board routes | Discussed — user explicitly corrected: "BottomBar plays an important role in inputting text in the active terminal. Therefore it shouldn't change in the board mode vs single terminal mode" | S:100 R:90 A:95 D:100 |
| 7 | Certain | BottomBar's input target (`wsRef`) is the focused terminal, exposed via a new FocusedTerminalContext | Derived — required corollary of BottomBar-unchanged + multi-pane board: the toolbar must follow focus | S:90 R:75 A:85 D:90 |
| 8 | Certain | TopBar absorbs route-varying informational content (board breadcrumb + pane/server counts + cycle hint in board mode) | Discussed — user explicitly identified the topbar as the surface that "can change behaviour in and out of board mode" | S:100 R:85 A:90 D:95 |
| 9 | Certain | BoardPage gets a BottomBar for the first time (it had none today) | Derived — BottomBar moves up the tree to shell-level, applies to all terminal-bearing routes including the board route | S:90 R:85 A:90 D:95 |
| 10 | Certain | Implementation uses CSS Grid with three named areas: `sidebar`, `topbar`, `content`, `bottombar`; sidebar spans all three rows | Discussed — agreed in the design discussion as cleaner than nested flex | S:90 R:80 A:90 D:90 |
| 11 | Certain | Mobile sidebar is overlay-mode (almost-fullscreen on open, dismissed before resuming work); not part of the grid | Discussed — user explicitly described this mobile model | S:100 R:85 A:90 D:95 |
| 12 | Certain | Board horizontal scroll viewport's left edge is flush with sidebar.right (no left gutter for board-level actions) | Discussed — user chose "scroll starts flush with sidebar edge" in the answered AskUserQuestion | S:100 R:90 A:90 D:100 |
| 13 | Certain | Builds on dc0t's unified Sidebar — no special-case rendering for board route | Discussed — explicit project context (dc0t already deleted BoardPage's mini-sidebar) | S:95 R:95 A:95 D:100 |
| 14 | Certain | New component `<Shell>` (in `src/components/shell/shell.tsx`) wraps the grid; both AppShell and BoardPage use it | Derived — concrete encoding of the shared topology | S:90 R:80 A:90 D:90 |
| 15 | Certain | New context `FocusedTerminalContext` (in `src/contexts/focused-terminal-context.tsx`) tracks the currently-focused terminal | Derived — required by BottomBar relocation; small dedicated context is cleaner than overloading chrome-context which is UI-state only | S:90 R:80 A:85 D:90 |
| 16 | Certain | TerminalClient registers as focused on mount (single-terminal route trivially) | Derived — straightforward registration | S:95 R:90 A:95 D:95 |
| 17 | Certain | BoardPane registers as focused on focus events (click, cycle-to, initial pane on board mount) | Derived — board panes already track focus internally for visual indication and cycling; this just exposes that state to the context | S:90 R:80 A:85 D:90 |
| 18 | Certain | Compose buffer target is frozen at compose-open time (snapshot focused wsRef; do not re-bind on focus change) | Discussed — flagged in design as "the compose buffer captured a specific target when opened, and changing it under the user is bad" | S:90 R:80 A:85 D:90 |
| 19 | Certain | No backend changes — this is a frontend layout refactor only | Derived — the refactor touches React component topology and CSS; tmux/Go layer is untouched | S:100 R:100 A:100 D:100 |
| 20 | Certain | No new dependencies | Derived — CSS Grid is built-in; React Context is built-in | S:100 R:100 A:100 D:100 |
| 21 | Confident | Initial focused pane on board mount is the first pane in order (leftmost) | Open Question — default plan; matches users' likely "focus starts at the leftmost pane" expectation; reversible if a different default is chosen | S:75 R:80 A:75 D:75 |
| 22 | Confident | Drag handle is hidden when sidebar is collapsed; hamburger is the only re-open affordance | Open Question — default plan; matches "fully hidden" semantics; reversible | S:75 R:85 A:75 D:75 |
| 23 | Confident | Sidebar-open state persists per-device in localStorage (`runkit-sidebar-open`) | Open Question — default plan; matches existing sidebar-width persistence pattern | S:80 R:85 A:80 D:80 |
| 24 | Confident | Mobile breakpoint for overlay-mode is 640px width (not `coarse:` pointer) | Open Question — default plan; the overlay/structural distinction is about screen real estate not pointer type | S:75 R:80 A:75 D:75 |
| 25 | Certain | Animation on collapse is a smooth CSS transition on `grid-template-columns` (~150ms ease-out) | Clarified — user confirmed; matches existing sidebar-resize feel; modern browsers support animating grid columns with caveats | S:95 R:80 A:75 D:75 |
| 26 | Confident | Empty-state hint copy is "Pin a window to start a board" (verbatim from 4vuv §5) | Open Question — default plan; minimize copy churn | S:80 R:90 A:75 D:80 |
| 27 | Confident | A keyboard shortcut to toggle the sidebar is added (e.g., `Cmd+\`); fits Constitution V (Keyboard-First) | Open Question — default plan; reversible | S:70 R:85 A:80 D:70 |
| 28 | Certain | `sidebarOpen` and `sidebarWidth` state lives in `useChromeContext` (lifted from per-route local state) | Clarified — user confirmed; necessary for Shell to read uniformly across AppShell and BoardPage; prop-drilling is the only alternative and is worse | S:95 R:60 A:80 D:80 |

28 assumptions (22 certain, 6 confident, 0 tentative, 0 unresolved).
