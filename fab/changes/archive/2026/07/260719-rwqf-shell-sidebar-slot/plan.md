# Plan: Shell-Owned Sidebar Slot

**Change**: 260719-rwqf-shell-sidebar-slot
**Intake**: `intake.md`

## Requirements

### Shell: Desktop sidebar ownership

#### R1: Shell renders the desktop sidebar aside
`Shell` SHALL render the desktop sidebar `<aside style={{ gridArea: "sidebar" }}>` itself, gated on `!isMobile && sidebarOpen && !!sidebarChildren`, so consumers no longer place the `sidebar` grid area. The aside SHALL wrap `sidebarChildren` in a `<div className="flex-1 min-w-0 overflow-hidden">` content wrapper and carry `aria-label="Sidebar"`.

- **GIVEN** a desktop viewport (`isMobile === false`) with `sidebarOpen === true` and non-empty `sidebarChildren`
- **WHEN** `Shell` renders
- **THEN** an `<aside aria-label="Sidebar">` appears in the `sidebar` grid area containing the `sidebarChildren`
- **AND** the `sidebarChildren` render exactly once (Shell owns the single placement per breakpoint)

#### R2: Sidebar aside unmounts on collapse and on mobile
`Shell` SHALL NOT render the desktop aside when `sidebarOpen === false` or when `isMobile === true` (matching today's caller-side `!isMobile && sidebarOpen` gate — unmount-on-collapse preserved). The mobile overlay path is unchanged and remains the only place `sidebarChildren` renders on mobile.

- **GIVEN** a desktop viewport with `sidebarOpen === false`
- **WHEN** `Shell` renders
- **THEN** no `<aside aria-label="Sidebar">` is present (fully unmounted, not merely zero-width)
- **AND GIVEN** a mobile viewport with `sidebarOpen === true`, the mobile overlay `<aside aria-label="Navigation">` renders instead and the desktop aside does not

#### R3: Optional `sidebarResizeHandle` slot
`Shell` SHALL accept a new optional prop `sidebarResizeHandle?: ReactNode`, rendered inside the desktop aside immediately after the content wrapper (at the aside's right edge). The mobile overlay SHALL NOT render it. When a handle is provided, the aside SHALL use `className="relative flex flex-row overflow-hidden"` (no border — the handle bar is the visual seam); when absent, the aside SHALL use `className="relative flex flex-row overflow-hidden border-r border-border"` (the border is the seam).

- **GIVEN** a desktop-open `Shell` with a `sidebarResizeHandle` node
- **WHEN** it renders
- **THEN** the handle node appears inside the aside after the content wrapper, and the aside class has no `border-r`
- **AND GIVEN** no `sidebarResizeHandle`, the aside class includes `border-r border-border` and no handle node renders
- **AND** the mobile overlay never renders `sidebarResizeHandle` regardless of whether it is passed

### AppShell: Delegate to Shell + pass handle

#### R4: AppShell drops its desktop aside and passes the drag handle via the slot
`AppShell` (`app/frontend/src/app.tsx`) SHALL delete its own `{!isMobile && sidebarOpen && (<aside …>)}` desktop block and instead pass the drag-resize handle element (moved verbatim) as `sidebarResizeHandle` on `<Shell>`. All drag state and handlers (`handleDragHandlePointerDown`, `handleDragStart`, `sidebarWidth`, `SIDEBAR_MIN_WIDTH`, `SIDEBAR_MAX_WIDTH`) SHALL remain in `AppShell`.

- **GIVEN** the AppShell render on desktop
- **WHEN** the change is applied
- **THEN** AppShell contains no `<aside style={{ gridArea: "sidebar" }}>` block, and `<Shell sidebarChildren={sidebarElement} sidebarResizeHandle={<div role="separator" aria-label="Resize sidebar" …/>}>` supplies the handle
- **AND** the handle's `onPointerDown={handleDragHandlePointerDown}` and its `aria-valuenow`/`aria-valuemin`/`aria-valuemax` wiring are unchanged (drag logic stays in AppShell)

### BoardPage: Delegate to Shell, no handle

#### R5: BoardPage drops its desktop aside and passes no handle
`BoardPage` (`app/frontend/src/components/board/board-page.tsx`) SHALL delete its `{!isMobile && sidebarOpen && (<aside … aria-label="board sidebar">{sidebarElement}</aside>)}` desktop block; `<Shell sidebarChildren={sidebarElement}>` alone covers both breakpoints. No `sidebarResizeHandle` is passed (drag-resize stays intentionally absent on the board route). The former `aria-label="board sidebar"` is replaced by Shell's uniform `aria-label="Sidebar"` — the border-r visual is preserved because Shell applies `border-r border-border` when no handle is passed. BoardPage's local `isMobile`/`sidebarOpen` reads SHALL remain (used elsewhere: `handleSelectWindow`, swipe handling).

- **GIVEN** the BoardPage render on desktop-open
- **WHEN** the change is applied
- **THEN** BoardPage contains no `<aside style={{ gridArea: "sidebar" }}>` block, `<Shell sidebarChildren={sidebarElement}>` is the sole sidebar placement, and no `sidebarResizeHandle` prop is passed
- **AND** the board's desktop sidebar keeps a `border-r border-border` seam (via Shell's no-handle branch) and carries `aria-label="Sidebar"`

### Docs

#### R6: Shell doc comment reflects Shell-owned sidebar area
`Shell`'s doc comment SHALL state that consumers place only `content`/`bottombar` grid areas; the `sidebar` area is Shell-owned (rendered from `sidebarChildren` + optional `sidebarResizeHandle`).

- **GIVEN** the `Shell` doc comment after the change
- **WHEN** a reader consults it
- **THEN** it no longer instructs consumers to grid-area-place the `sidebar`, and documents the `sidebarResizeHandle` slot

### Tests

#### R7: shell.test.tsx covers the desktop sidebar branch
`shell.test.tsx` SHALL be extended with desktop-branch coverage: (a) desktop + open renders an `<aside aria-label="Sidebar">` containing `sidebarChildren`; (b) a passed `sidebarResizeHandle` node renders inside that aside; (c) desktop + closed renders no such aside; (d) no handle ⇒ aside carries `border-r`, with handle ⇒ it does not; (e) the mobile overlay never renders the resize handle. Existing mobile-overlay tests SHALL continue to pass, updated only where they asserted desktop does NOT render `sidebarChildren` (that assertion inverts under R1).

- **GIVEN** the extended `shell.test.tsx`
- **WHEN** `just test-frontend` runs
- **THEN** all Shell unit tests pass, including the new desktop-branch assertions and the unchanged mobile-overlay behavior

### Non-Goals

- Adding drag-resize to the board route — intentionally still absent (BoardPage passes no `sidebarResizeHandle`).
- A render-prop (`sidebar={(ctx) => …}`) API — rejected in the intake; no caller needs Shell-provided context, so a plain `ReactNode` slot is used.
- Moving drag state/handlers into Shell — rejected; the handle is passed as an opaque node, drag logic stays in AppShell.
- Any API/backend/route change — this is a pure frontend layout-ownership refactor.

### Design Decisions

#### Shell owns the desktop aside; the resize handle is an opaque node slot
**Decision**: `Shell` renders the desktop `<aside gridArea:"sidebar">` (gated `!isMobile && sidebarOpen && !!sidebarChildren`) and exposes an optional `sidebarResizeHandle?: ReactNode` rendered at the aside's right edge; the border-r is applied only when no handle is passed.
**Why**: Both `<Shell>` consumers duplicated the aside scaffolding, the grid-area placement, and the `!isMobile && sidebarOpen` gate, and the two copies had already drifted (AppShell flex-row + handle; BoardPage border-r + different aria-label). Shell already reads `sidebarOpen`/`isMobile`, so the branch moves in with zero new data dependencies. The one per-caller divergence (AppShell's drag handle) rides through an opaque slot, keeping Shell dumb about drag logic.
**Rejected**: A render-prop (`sidebar={(ctx) => …}`) — no caller needs Shell-provided context, so a plain node prop is simpler. Shell owning the drag handle — it would pull `handleDragStart`/width persistence into Shell and couple it to AppShell-only state.
*Introduced by*: 260719-rwqf-shell-sidebar-slot

#### Uniform `aria-label="Sidebar"` on the Shell-owned aside
**Decision**: The Shell-owned desktop aside carries `aria-label="Sidebar"`, replacing BoardPage's former `aria-label="board sidebar"` and adding the previously-missing a11y name on AppShell's aside.
**Why**: A single owner means a single label; uniformity also fixes AppShell's aside, which had no accessible name. Grep confirms no test or code references the old `"board sidebar"` label, so the rename is safe.
**Rejected**: Keeping per-route labels — would require Shell to accept a label prop for a cosmetic difference no consumer relies on.
*Introduced by*: 260719-rwqf-shell-sidebar-slot

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `sidebarResizeHandle?: ReactNode` to `Shell`'s props and render the desktop sidebar aside (gated `!isMobile && sidebarOpen && !!sidebarChildren`) inside the grid root before `{children}` in `app/frontend/src/components/shell/shell.tsx`: `<aside style={{ gridArea: "sidebar" }} aria-label="Sidebar" className={sidebarResizeHandle ? "relative flex flex-row overflow-hidden" : "relative flex flex-row overflow-hidden border-r border-border"}>` with `<div className="flex-1 min-w-0 overflow-hidden">{sidebarChildren}</div>` then `{sidebarResizeHandle}`; the mobile overlay stays unchanged and never renders the handle <!-- R1 R2 R3 -->
- [x] T002 Update `Shell`'s doc comment in `app/frontend/src/components/shell/shell.tsx` so it states the `sidebar` area is Shell-owned and consumers place only `content`/`bottombar`, and documents the `sidebarResizeHandle` slot <!-- R6 -->
- [x] T003 In `app/frontend/src/app.tsx` (AppShell): delete the `{!isMobile && sidebarOpen && (<aside style={{ gridArea: "sidebar" }} …>)}` desktop block and pass its drag-handle `<div … role="separator" aria-label="Resize sidebar" …/>` verbatim as `sidebarResizeHandle` on `<Shell sidebarChildren={sidebarElement} sidebarResizeHandle={…}>`; keep all drag state/handlers (`handleDragHandlePointerDown`, `handleDragStart`, width bounds) in AppShell <!-- R4 -->
- [x] T004 In `app/frontend/src/components/board/board-page.tsx` (BoardPage): delete the `{!isMobile && sidebarOpen && (<aside … aria-label="board sidebar">{sidebarElement}</aside>)}` desktop block; leave `<Shell sidebarChildren={sidebarElement}>` as the sole sidebar placement (no `sidebarResizeHandle`); keep local `isMobile`/`sidebarOpen` reads <!-- R5 -->

### Phase 2: Tests

- [x] T005 Extend `app/frontend/src/components/shell/shell.test.tsx` with desktop-branch coverage: desktop+open renders `<aside aria-label="Sidebar">` containing `sidebarChildren`; a passed `sidebarResizeHandle` node renders inside the aside; desktop+closed renders no such aside; no-handle aside has `border-r border-border`, with-handle aside does not; mobile overlay never renders the handle. Update the existing desktop test that asserts `sidebarChildren` do NOT render on desktop (that assertion inverts under R1) <!-- R7 -->
- [x] T006 Run `cd app/frontend && npx tsc --noEmit` (typecheck) and `just test-frontend` (Vitest); fix any failures <!-- R7 -->

## Execution Order

- T001 blocks T003, T004, T005 (they depend on the new prop + Shell-owned aside)
- T002 is independent (doc comment) — can run alongside T001
- T005 depends on T001; T006 depends on T001–T005

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Shell` renders an `<aside style={{ gridArea: "sidebar" }} aria-label="Sidebar">` containing `sidebarChildren` on desktop when `sidebarOpen` and `sidebarChildren` are present, with the `flex-1 min-w-0 overflow-hidden` content wrapper
- [x] A-002 R3: `Shell` accepts `sidebarResizeHandle?: ReactNode` and renders it inside the desktop aside after the content wrapper; a with-handle aside omits `border-r`, a no-handle aside carries `border-r border-border`
- [x] A-003 R4: AppShell has no desktop `<aside gridArea:"sidebar">` block and passes the drag handle via `sidebarResizeHandle`, with all drag state/handlers still in AppShell
- [x] A-004 R5: BoardPage has no desktop `<aside gridArea:"sidebar">` block, passes no `sidebarResizeHandle`, and its board sidebar keeps a `border-r` seam via Shell's no-handle branch
- [x] A-005 R6: `Shell`'s doc comment states the `sidebar` area is Shell-owned and documents the `sidebarResizeHandle` slot

### Behavioral Correctness

- [x] A-006 R2: The desktop sidebar aside is fully unmounted (absent from DOM) when `sidebarOpen === false`; on mobile the overlay (`aria-label="Navigation"`) renders instead of the desktop aside
- [x] A-007 R3: The mobile overlay never renders `sidebarResizeHandle` even when the prop is passed
- [x] A-008 R5: The board sidebar's accessible name changes from `"board sidebar"` to the uniform `"Sidebar"` with no other behavioral change; drag-resize remains absent on the board route

### Scenario Coverage

- [x] A-009 R7: `shell.test.tsx` exercises desktop+open (aside + children + handle rendering), desktop+closed (no aside), border-r with/without handle, and mobile-overlay-never-renders-handle; all pass under `just test-frontend`

### Edge Cases & Error Handling

- [x] A-010 R1: When `sidebarChildren` is undefined/absent, no desktop aside renders (gate includes `!!sidebarChildren`)

### Code Quality

- [x] A-011 Pattern consistency: New Shell prop follows the existing optional-`ReactNode`-prop and `useIsMobile`/`useChromeState` idioms; the opaque-node slot mirrors the existing `sidebarChildren` pattern
- [x] A-012 No unnecessary duplication: The desktop aside scaffolding + `!isMobile && sidebarOpen` gate now live once in Shell rather than duplicated (and drifted) across AppShell and BoardPage
- [x] A-013 Type narrowing over assertions: No new `as` casts introduced; `ReactNode` typing is exact (constitution/code-quality frontend rule)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- No e2e is added — pure layout-ownership refactor covered at unit level; existing e2e already exercises both routes' sidebars (intake assumption 5).

## Deletion Candidates

- None — the redundancy this change targeted (the caller-side desktop `<aside gridArea:"sidebar">` blocks in AppShell and BoardPage) was deleted within the change itself; no further code, symbols, or config became unused (BoardPage's local `isMobile`/`sidebarOpen` reads and all AppShell drag state remain referenced).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shell renders the desktop aside gated `!isMobile && sidebarOpen && !!sidebarChildren` (unmount-on-collapse preserved) | Intake directs exactly this; Shell already consumes both state sources | S:80 R:85 A:90 D:85 |
| 2 | Confident | Drag handle passed as opaque `sidebarResizeHandle?: ReactNode`; drag state/handlers stay in AppShell | Opaque slot keeps Shell decoupled from AppShell-only drag state — intake's chosen front-runner | S:70 R:80 A:85 D:70 |
| 3 | Confident | Unified aside markup: `relative flex flex-row overflow-hidden` + `flex-1 min-w-0 overflow-hidden` content wrapper; `border-r border-border` only when no handle | Preserves current visuals on both routes (handle bar is AppShell's seam; border is BoardPage's) | S:65 R:85 A:85 D:75 |
| 4 | Confident | Board aside's `aria-label="board sidebar"` replaced by uniform `aria-label="Sidebar"` | No test/code references the old label (grep-verified in this worktree); uniform label also adds AppShell's missing a11y name | S:50 R:90 A:75 D:60 |
| 5 | Certain | Test coverage = extend shell.test.tsx unit tests; no new e2e; update the existing desktop test whose "sidebarChildren absent on desktop" assertion inverts under R1 | Pure layout-ownership refactor; the inverting assertion is a direct consequence of Shell now owning the desktop render | S:65 R:90 A:85 D:80 |

5 assumptions (2 certain, 3 confident).
