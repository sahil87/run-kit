# Intake: Shell-Owned Sidebar Slot

**Change**: 260719-rwqf-shell-sidebar-slot
**Created**: 2026-07-20

## Origin

Backlog item `[rwqf]` (fab/backlog.md), processed by an autonomous backlog-sweep agent:

> Collapse the sidebarChildren prop duplication on `<Shell>`: AppShell and BoardPage each build sidebar JSX into a local sidebarElement and pass it both as `<Shell sidebarChildren={...}>` (mobile overlay) and wrapped in a desktop `<aside style={{gridArea:'sidebar'}}>` — use a render-prop or a Shell-owned 'sidebar' slot; needs either Shell knowing the drag handle (AppShell's desktop branch wraps it, BoardPage's doesn't) or a separate desktopChrome slot. Deferred refactor (260509-17m3-rotated-shell-layout).

Validity was verified against current code before intake creation: the duplication exists exactly as described at `app/frontend/src/app.tsx:2514-2560` (AppShell) and `app/frontend/src/components/board/board-page.tsx:915-946` (BoardPage).

## Why

1. **Pain point**: Both `<Shell>` consumers must remember to render the same `sidebarElement` twice — once as the `sidebarChildren` prop (consumed only by Shell's mobile overlay) and once inside their own desktop `<aside style={{gridArea:'sidebar'}}>` gated on `!isMobile && sidebarOpen`. The gate condition, the grid-area placement, and the aside scaffolding are duplicated per caller and have already drifted (AppShell's aside is `relative flex flex-row overflow-hidden` with an inner `flex-1 min-w-0 overflow-hidden` wrapper plus a drag handle; BoardPage's is `overflow-hidden border-r border-border` with `aria-label="board sidebar"` and no handle).
2. **Consequence of not fixing**: every future `<Shell>` consumer repeats the double-render, and the desktop/mobile sidebar placement rules continue diverging — exactly the drift `<Shell>` was created to prevent (memory: architecture.md § Shell wrapper design decision, "one topology, many routes").
3. **Approach**: make Shell own the desktop aside too. Shell already reads `sidebarOpen`/`isMobile` from `ChromeContext`/`useIsMobile` (it uses them for the grid template and the mobile overlay), so the desktop branch moves in with zero new data dependencies. The one per-caller divergence — AppShell's drag-resize handle — is passed as an opaque `ReactNode` slot prop, keeping Shell dumb about drag logic (handlers, width state, and aria-value wiring stay in AppShell). Rejected: a render-prop (`sidebar={(ctx) => ...}`) — no caller needs Shell-provided context, so a plain node prop is simpler; rejected: Shell owning the drag handle — it would pull `handleDragStart`/width persistence into Shell and couple it to AppShell-only state.

## What Changes

### 1. `Shell` renders the desktop sidebar aside (`app/frontend/src/components/shell/shell.tsx`)

Shell gains ownership of the desktop grid placement. New rendering inside the grid root, before `{children}`:

```tsx
{!isMobile && sidebarOpen && sidebarChildren && (
  <aside
    style={{ gridArea: "sidebar" }}
    aria-label="Sidebar"
    className={
      sidebarResizeHandle
        ? "relative flex flex-row overflow-hidden"
        : "relative flex flex-row overflow-hidden border-r border-border"
    }
  >
    <div className="flex-1 min-w-0 overflow-hidden">{sidebarChildren}</div>
    {sidebarResizeHandle}
  </aside>
)}
```

- New optional prop: `sidebarResizeHandle?: ReactNode` — desktop-only chrome rendered at the aside's right edge (after the content wrapper). Mobile overlay never renders it.
- Border rule preserves current visuals: with a handle (AppShell) the 3px handle bar is the visual seam, so no `border-r`; without one (BoardPage) the aside keeps `border-r border-border`.
- The existing `sidebarChildren` prop keeps its name and its mobile-overlay role; it is now rendered in exactly one place per breakpoint, by Shell.
- Update Shell's doc comment: children now use grid-area placement for `content`/`bottombar` only; the `sidebar` area is Shell-owned.

### 2. `AppShell` (`app/frontend/src/app.tsx` ~2514-2560)

- Delete the desktop `{!isMobile && sidebarOpen && (<aside ...>...)}` block.
- Pass the drag handle as the new slot:

```tsx
<Shell
  sidebarChildren={sidebarElement}
  sidebarResizeHandle={
    <div
      className="relative w-[3px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary transition-colors before:content-[''] before:absolute before:inset-y-0 before:-left-2 before:right-0"
      onPointerDown={handleDragHandlePointerDown}
      style={{ touchAction: "none" }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={sidebarWidth}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
    />
  }
>
```

The handle element (with its existing comment about the 3px seam and the `before:` grab-area extension) moves verbatim — all drag state/handlers stay in AppShell.

### 3. `BoardPage` (`app/frontend/src/components/board/board-page.tsx` ~933-946)

- Delete the desktop `{!isMobile && sidebarOpen && (<aside ...>{sidebarElement}</aside>)}` block; `<Shell sidebarChildren={sidebarElement}>` alone now covers both breakpoints. No `sidebarResizeHandle` passed (drag-resize stays intentionally absent on the board route).
- The board aside's `aria-label="board sidebar"` is replaced by Shell's uniform `aria-label="Sidebar"` (no test or code references the old label — verified via grep).
- BoardPage's local `isMobile`/`sidebarOpen` reads remain (used elsewhere: `handleSelectWindow`, swipe handling).

### 4. Tests (`app/frontend/src/components/shell/shell.test.tsx`)

Extend the existing Shell unit tests with desktop-branch coverage:
- desktop + `sidebarOpen: true` → aside with `aria-label="Sidebar"` renders `sidebarChildren`; passed `sidebarResizeHandle` node renders inside the aside.
- desktop + `sidebarOpen: false` → no aside (unmounted, matching today's caller-side gate).
- no `sidebarResizeHandle` → aside carries `border-r`; with handle → it doesn't.
- mobile overlay behavior unchanged (existing tests keep passing; overlay must NOT render the resize handle).

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Sidebar desktop section — "Drag-handle wiring is AppShell-only" stays true but the handle now flows through Shell's `sidebarResizeHandle` slot; § Shell Grid Layout — the `sidebar` grid area is Shell-owned, consumers place only `content`/`bottombar`.
- `run-kit/architecture`: (modify) § Shell wrapper (CSS Grid topology) — Shell renders the desktop sidebar aside itself; consumers pass `sidebarChildren` (+ optional `sidebarResizeHandle`) instead of grid-area-placing sidebar JSX.

## Impact

- `app/frontend/src/components/shell/shell.tsx` — new prop + desktop aside rendering (+ doc comment update).
- `app/frontend/src/app.tsx` — AppShell desktop aside block removed; handle passed as prop.
- `app/frontend/src/components/board/board-page.tsx` — desktop aside block removed.
- `app/frontend/src/components/shell/shell.test.tsx` — new desktop-branch tests.
- No API/backend/route changes; pure frontend refactor with behavior preserved (one benign a11y label change on the board aside).

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shell renders the desktop aside gated `!isMobile && sidebarOpen && !!sidebarChildren` (unmount-on-collapse preserved) | Backlog item directs exactly this; Shell already consumes both state sources | S:80 R:85 A:90 D:85 |
| 2 | Confident | Drag handle passed as opaque `sidebarResizeHandle?: ReactNode` prop; drag state/handlers stay in AppShell | Backlog offered slot vs. Shell-owned handle; opaque slot keeps Shell decoupled from AppShell-only drag state — clear front-runner | S:70 R:80 A:85 D:70 |
| 3 | Confident | Unified aside markup: `relative flex flex-row overflow-hidden` + `flex-1 min-w-0 overflow-hidden` content wrapper; `border-r border-border` only when no handle | Preserves current visuals on both routes (handle bar is AppShell's seam; border is BoardPage's) | S:65 R:85 A:85 D:75 |
| 4 | Confident | Board aside's `aria-label="board sidebar"` replaced by uniform Shell-owned `aria-label="Sidebar"` | No test/code references the old label (grep-verified); uniform label also adds the missing a11y name on AppShell's aside | S:50 R:90 A:75 D:60 |
| 5 | Certain | Test coverage = extend shell.test.tsx unit tests; no new e2e | Pure layout-ownership refactor; existing e2e exercises both routes' sidebars already; code-quality.md requires tests for changed behavior — unit level is the right altitude | S:60 R:90 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
