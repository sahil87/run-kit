# Plan: Rotated Shell Layout

**Change**: 260509-17m3-rotated-shell-layout
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/contexts/focused-terminal-context.tsx` with `FocusedTerminal` type, `FocusedTerminalContext`, `FocusedTerminalProvider`, and `useFocusedTerminal()` hook (mirrors `chrome-context.tsx` split-context style) <!-- rework: must-fix #3 — added composeOpen + setComposeOpen to context value so shell-level BottomBar can open compose for the focused terminal across single-terminal and board routes -->
- [x] T002 Mount `<FocusedTerminalProvider>` inside `RootWrapper` in `app/frontend/src/app.tsx`, adjacent to `<SessionProvider>` (per spec § Context shape — Provider mounts above `<Outlet />`)
- [x] T003 [P] Update `app/frontend/src/contexts/chrome-context.tsx`: add `sidebarWidth: number` state + `setSidebarWidth(width: number)` dispatch (with `runkit-sidebar-width` localStorage initializer + setter); remove `drawerOpen`/`setDrawerOpen` from `ChromeState`/`ChromeDispatch`/provider <!-- rework: should-fix #1 — split persistence: setSidebarWidth is in-memory only (called per-pointermove); persistSidebarWidth dispatch added for one-write-per-drag-end commit -->
- [x] T004 Create `app/frontend/src/components/shell/shell.tsx` — CSS Grid wrapper with `useVisualViewport`, named areas (sidebar/topbar/content/bottombar), desktop ↔ mobile breakpoint switching driven by `useIsMobile`, mobile overlay rendering for sidebar with backdrop + `role="dialog" aria-modal="true"`, animated `grid-template-columns` (150ms ease-out) <!-- rework: must-fix #1 — mobile overlay now renders below the topbar via grid-row span (matches project convention in fab/project/context.md and the existing mobile-layout.spec.ts:53 `sidebarBox.y > 0` assertion); should-fix #2 — Cmd+\ guard tightened to skip xterm-host TEXTAREA -->

### Phase 2: Core Implementation

- [x] T005 Update `app/frontend/src/components/sidebar/index.tsx`: reorder JSX so `<BoardsSection />` renders before `<ServerPanel />` (Boards → Servers → Sessions)
- [x] T006 Update `app/frontend/src/components/sidebar/boards-section.tsx`: drop the `boards.length === 0 && !activeBoardName` early-return; render the `Pin a window to start a board` hint whenever `boards.length === 0`, regardless of route
- [x] T007 Update `app/frontend/src/components/bottom-bar.tsx`: remove `wsRef` from `BottomBarProps`; consume `useFocusedTerminal()` and use `focused?.wsRef` in place of the prop in `send`/`sendWithMods`/keydown handler
- [x] T008 [P] Update `app/frontend/src/components/terminal-client.tsx`: on mount call `setFocused({ wsRef, server, session: sessionName, windowIndex })`; on unmount call `setFocused(null)`. Use `useEffect` keyed on identifiers
- [x] T009 [P] Update `app/frontend/src/components/board/board-pane.tsx`: when `isFocused` becomes true (and on mount when initial pane), call `setFocused({ wsRef, server, session, windowIndex })` from focused-terminal context — do NOT clear on focus loss <!-- rework: must-fix #3 — composeOpen/setComposeOpen now sourced from FocusedTerminalContext (lifted from local state) and ComposeBuffer rendering gated on isFocused so cycle-while-compose-open doesn't retarget; scrollLocked prop forwarded from BoardPage -->
- [x] T010 Update `app/frontend/src/components/top-bar.tsx`: add `mode: "terminal" | "board" | "root"` prop (default `"terminal"`); add optional `boardName`, `paneCount`, `serverCount` props for `mode="board"`; render board breadcrumb + inline info (`{n} pane[s] · {n} server[s] · ⌘[⌘] cycle`) hidden on `< 640px` via `hidden sm:inline`; replace internal `drawerOpen` reference and animation driver with `sidebarOpen` only; preserve right-section chrome unchanged <!-- rework: should-fix #3 — FixedWidthToggle lifted out of `currentWindow` block so board mode (currentWindow always null) still exposes the toggle -->
- [x] T011 Update `app/frontend/src/components/compose-buffer.tsx`: snapshot `wsRef` ref into a ref captured on mount so it freezes for the buffer's lifetime even if the prop's underlying ref changes (caller passes the live ref; internal capture freezes target)
- [x] T012 Refactor `app/frontend/src/app.tsx` `AppShell` to use `<Shell>` wrapper with grid-area children (sidebar, topbar, content, bottombar); lift `sidebarWidth` reads to `useChromeState`; drop `wsRef` plumbing into `BottomBar` (BottomBar now reads context); remove all `drawerOpen`/`setDrawerOpen` references; let mobile overlay live inside `<Shell>` driven by `sidebarOpen` + `isMobile`; sidebar drag-resize uses `setSidebarWidth` from chrome dispatch <!-- rework: must-fix #3 — composeOpen state lifted from local AppShell to FocusedTerminalContext (so shell-level BottomBar on board route can open compose for the focused pane); should-fix #1 — drag-resize handler now persists localStorage in handleEnd via persistSidebarWidth (one write per drag) -->
- [x] T013 Refactor `app/frontend/src/components/board/board-page.tsx` `BoardPageContent`: replace bespoke `h-screen w-screen flex` root with `<Shell>` wrapper; render `<Sidebar>` in `gridArea: "sidebar"` (no per-route `<aside>` 240px wrapper); render `<TopBar mode="board" boardName={name} paneCount={entries.length} serverCount={uniqueServers}>` in `gridArea: "topbar"`; render `DesktopRow`/`MobileCarousel` in `gridArea: "content"`; render `<BottomBar />` in `gridArea: "bottombar"`; remove inline `<header>` (Board ▸ name ▾) — `TopBar` board-mode renders breadcrumb dropdown <!-- rework: must-fix #2 — `<BottomBar />` now passes onOpenCompose, onFocusTerminal, onScrollLockChange (matching AppShell) so compose >_, focus toggle, and scroll-lock long-press all work on the board route; scrollLocked plumbed to BoardPanes -->

### Phase 3: Integration & Edge Cases

- [x] T014 Register keyboard shortcut: in `AppShell` (and via shared hook ideally) bind `Cmd+\` / `Ctrl+\` (when not in input/textarea) to toggle `sidebarOpen`; surface entry in `KeyboardShortcuts` modal under the App section
- [x] T015 Audit and update remaining call-sites: `top-bar.test.tsx` (drop `drawerOpen` prop, drop `onToggleDrawer`); `bottom-bar.test.tsx` (drop `wsRef` prop, wrap in `FocusedTerminalProvider`); ensure no stray `drawerOpen` references compile

### Phase 4: Tests

- [x] T016 Create `app/frontend/src/components/shell/shell.test.tsx` — assert grid template areas (desktop sidebar open + collapsed: `0 1fr` columns), mobile single-column grid + overlay rendering with backdrop and `role="dialog"`
- [x] T017 Create `app/frontend/src/contexts/focused-terminal-context.test.tsx` — default `focused === null`, `setFocused` updates value, useFocusedTerminal throws outside provider
- [x] T018 Update `app/frontend/src/components/sidebar.test.tsx` — assert DOM order of section headers is `Boards`, then `Server`, then `Sessions`
- [x] T019 Create `app/frontend/tests/e2e/shell-rotation.spec.ts` + sibling `shell-rotation.spec.md` — board-route BottomBar focus tracking across cycle (pane 1 receives input, cycle to pane 2, pane 2 receives input, pane 1 unchanged)

## Execution Order

- T001 blocks T002, T007, T008, T009, T012, T013, T017
- T003 blocks T004, T010, T012, T013, T015
- T004 blocks T012, T013, T016
- T005 blocks T018
- T006 blocks T018
- T007, T008, T009 must all land before T013 (BoardPage uses BottomBar context)
- T010 blocks T012, T013, T015
- T012, T013 block T014 (keyboard shortcut wired through chrome dispatch in shells)
- T015 happens after T010 + T007 (test fixtures depend on new APIs)

## Acceptance

### Functional Completeness

- [x] A-001 Shell wrapper exists at `src/components/shell/shell.tsx` and is imported by both `AppShell` and `BoardPage`
- [x] A-002 Shell grid template areas on desktop equal `"sidebar topbar" / "sidebar content" / "sidebar bottombar"`; rows `auto 1fr auto`; columns `${sidebarWidth}px 1fr` when open and `0 1fr` when closed
- [x] A-003 Shell grid on `< 640px` switches to single column with rows `topbar / content / bottombar`; sidebar renders outside the grid as a fixed-position overlay
- [x] A-004 `<Shell>` root carries inline `height: var(--app-height, 100vh)` and `useVisualViewport` is invoked inside Shell (preserves iOS keyboard handling)
- [x] A-005 `AppShell` renders Sidebar/TopBar/(Terminal|Iframe|Dashboard)/BottomBar in their grid areas via `<Shell>`; the iframe-banner row remains inside the `content` area
- [x] A-006 `BoardPage` renders Sidebar/TopBar(board mode)/DesktopRow|MobileCarousel/BottomBar in their grid areas via `<Shell>`; bespoke `h-screen w-screen flex` root is gone
- [x] A-007 Board horizontal-scroll viewport begins at the `content` grid area's left edge (no left gutter)
- [x] A-008 Sidebar collapses to 0px (no 48px rail); `grid-template-columns` transitions with `150ms ease-out`; drag handle is hidden when collapsed
- [x] A-009 Hamburger renders inside `<TopBar>` at its left edge in both `sidebarOpen === true` and `false` states; clicking toggles `sidebarOpen`
- [x] A-010 `ChromeContext` exposes `sidebarOpen`, `sidebarWidth`, `setSidebarOpen(open)`, `setSidebarWidth(width)`; `sidebarOpen` persists to `runkit-sidebar-open`; `sidebarWidth` persists to `runkit-sidebar-width`
- [x] A-011 `Cmd+\` / `Ctrl+\` (when no input/textarea has focus) toggles `sidebarOpen` and the binding is listed in the `KeyboardShortcuts` modal under "Toggle sidebar"
- [x] A-012 Sidebar section order is `BoardsSection`, `ServerPanel`, Sessions header + per-server groups, `WindowPanel`, `HostPanel`
- [x] A-013 `BoardsSection` always visible; renders `Pin a window to start a board` hint when `boards.length === 0` (regardless of route)
- [x] A-014 `FocusedTerminalContext` exists at `src/contexts/focused-terminal-context.tsx` with the spec'd shape; `FocusedTerminalProvider` mounted in `RootWrapper` adjacent to `SessionProvider`; default `focused === null`
- [x] A-015 `TerminalClient` calls `setFocused(...)` on mount with wsRef + identifiers and `setFocused(null)` on unmount
- [x] A-016 `BoardPane` calls `setFocused(...)` whenever the pane gains focus (click, cycle, initial pane); does NOT call `setFocused(null)` on focus loss
- [x] A-017 `BottomBar` no longer accepts a `wsRef` prop; reads `focused?.wsRef` from context; existing `readyState !== OPEN` guard handles the `null` case
- [x] A-018 `BoardPage` renders a `<BottomBar>` instance for the first time (board route had none pre-change)
- [x] A-019 Compose buffer snapshots `wsRef` at open and uses the snapshot for its lifetime; cycling focus while compose is open does not retarget
- [x] A-020 `TopBar` accepts `mode: "terminal" | "board" | "root"` (default `"terminal"`); board mode renders breadcrumb + `{n} pane(s) · {n} server(s) · ⌘[⌘] cycle` info; inline info hidden on `< 640px` via `hidden sm:inline`; right-section chrome unchanged
- [x] A-021 Mobile sidebar overlay renders as fixed-position with `role="dialog" aria-modal="true"`, backdrop, dismissible by backdrop tap, destination tap (auto-close after navigation), and explicit close

### Behavioral Correctness

- [x] A-022 `BottomBar` byte-identical across single-terminal and board routes (same component, same props except removed `wsRef`); compose, function-key palette, modifier toggles, scroll-lock all unchanged
- [x] A-023 Hamburger animation chevron is driven by `sidebarOpen` alone (no `drawerOpen` involvement)

### Removal Verification

- [x] A-024 `BottomBar` `wsRef` prop fully removed from type signature and all call sites; tests no longer pass `wsRef`
- [x] A-025 `ChromeContext.drawerOpen` and `setDrawerOpen` removed from type, provider, and all consumers (`AppShell`, `TopBar`, sidebar deeper components)
- [x] A-026 `BoardPage` inline `<header>` (Board ▸ {name} ▾) removed; replaced by `<TopBar mode="board">` invocation; `BoardSwitcherDropdown` import path stays usable from TopBar in board mode
- [x] A-027 Pre-change "BoardsSection hidden when zero boards" early-return is removed

### Scenario Coverage

- [x] A-028 Shell unit test asserts grid template areas (desktop open/collapsed) and mobile overlay rendering
- [x] A-029 FocusedTerminalContext unit test asserts default `null`, `setFocused` updates value
- [x] A-030 BottomBar unit tests updated: provider wraps fixtures with `FocusedTerminalProvider`; no `wsRef` prop is passed
- [x] A-031 Sidebar test asserts section order `Boards` → `Server` → `Sessions`
- [x] A-032 New e2e `shell-rotation.spec.ts` exercises board-route BottomBar focus tracking across two panes; sibling `shell-rotation.spec.md` documents it per Constitution Test Companion Docs

### Edge Cases & Error Handling

- [x] A-033 `BottomBar` with `focused === null` (Dashboard or no-terminal route) does not error and input handlers no-op via the existing `readyState` guard
- [x] A-034 Drag-resize seam hidden when `sidebarOpen === false`; hamburger is the only re-open affordance

### Code Quality

- [x] A-035 Pattern consistency: new context follows the `useChromeState`/`useChromeDispatch` split pattern; localStorage keys follow `runkit-*` convention; transition timing follows existing 150ms ease-out idiom
- [x] A-036 No unnecessary duplication: `Shell` is the single grid wrapper; both `AppShell` and `BoardPage` import it
- [x] A-037 Type narrowing over assertions: new code uses discriminated unions / `if` guards (no `as` casts) where state can be null
- [x] A-038 No god functions: `Shell` stays focused on layout; new context module is small and focused
- [x] A-039 No new dependencies (`app/frontend/package.json` `dependencies` and `devDependencies` byte-identical pre/post)
- [x] A-040 No backend changes (`app/backend/`) and no `configs/tmux/` modifications
- [x] A-041 `useChromeContext` keeps a sole UI-state surface; FocusedTerminalContext stays separate (DD-5)
- [x] A-042 No new routes added to `app/frontend/src/router.tsx`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Notes — Rework cycle 1 (fix code)

- Must-fix #1 (mobile overlay covers topbar): rendered the mobile sidebar overlay as a grid child spanning `gridRow: 2 / 4` (content + bottombar) inside `Shell` (`app/frontend/src/components/shell/shell.tsx:97-141`), with `position: relative` on the Shell root and `position: absolute` on the backdrop + aside. The overlay now starts below the topbar — matches the existing convention recorded in `fab/project/context.md` ("Mobile sidebar drawer is `absolute` inside the main area (not `fixed inset-0`) so the top bar stays visible") and the existing `app/frontend/tests/e2e/mobile-layout.spec.ts:53` assertion (`sidebarBox.y > 0`). Spec tension: spec § Mobile Overlay Sidebar literally specifies `fixed inset-y-0 left-0 z-50` classes; per orchestrator guidance the spec's "Mobile overlay open" scenario is satisfied as long as the overlay is fixed-position-style with backdrop, regardless of whether it covers the topbar — pragmatic resolution chosen for project consistency. Spec wording left untouched (per orchestrator).
- Must-fix #2 (BottomBar not byte-identical across routes): wired `onOpenCompose`, `onFocusTerminal`, `onScrollLockChange` on `<BottomBar>` in `BoardPage` (`app/frontend/src/components/board/board-page.tsx:443-452`). `onOpenCompose` calls `setComposeOpen(true)` from `FocusedTerminalContext`. `onFocusTerminal` invokes a ref-tracked `focusFocusedPaneRef.current()` that re-focuses the currently-focused board pane via its `paneRefs[focusedIndex].focus()`. `onScrollLockChange` writes a new local `scrollLocked` boolean which is plumbed through `DesktopRow`/`MobileCarousel` → `BoardPane` → `TerminalClient.scrollLocked`.
- Must-fix #3 (compose unreachable for focused pane on board): chose **option (a)** — lifted compose state to `FocusedTerminalContext` (`app/frontend/src/contexts/focused-terminal-context.tsx:33-90`). Each `BoardPane` reads `composeOpen` from context and gates its own ComposeBuffer rendering on `isFocused && composeOpen`. The frozen-target requirement (spec scenario "Compose target frozen") is satisfied because (1) only the focused pane's `TerminalClient` renders ComposeBuffer at any time, (2) the ComposeBuffer mounts inside that specific TerminalClient's subtree, and (3) `compose-buffer.tsx:34` already snapshots wsRef on mount — so cycling focus while compose is open neither retargets the buffer nor unmounts it. **Rationale for option (a) over (b)**: option (b) requires lifting ComposeBuffer to shell-level along with the file-upload integration (`composeFiles`/`composeInitialText`/`useFileUpload` chain in `terminal-client.tsx`), which is invasive (~3-4 components touched, file upload routing rewritten). Option (a) reuses the existing per-TerminalClient ComposeBuffer mount, keeps file upload local to the dropping pane, and only adds a `composeOpen` boolean to the existing FocusedTerminalContext. The frozen-target spec requirement is still satisfied via the existing wsRef snapshot, so option (a)'s correctness is equivalent. Files: `focused-terminal-context.tsx`, `app.tsx`, `board-page.tsx`, `board-pane.tsx`, `terminal-client.tsx` (setComposeOpen signature tightened to `(open: boolean) => void`).
- Should-fix #1 (setSidebarWidth persists per-pointermove): split `setSidebarWidth` (in-memory only, called per-pointermove) from `persistSidebarWidth` (one localStorage write at drag-end) in `chrome-context.tsx:73-94`. AppShell's `handleDragStart` now tracks the last-seen width in `dragLastWidthRef` and calls `persistSidebarWidth(dragLastWidthRef.current)` once in `handleEnd` (`app.tsx:212-244`) — restoring the pre-change one-write-per-drag behavior.
- Should-fix #2 (Cmd+\ suppressed when xterm has focus): tightened the input-suppression guard in `shell.tsx:22-28` to bail only when the focused element is a "real" text input outside an xterm (`target.closest('.xterm') == null && (TAGNAME match)`). xterm.js focuses `.xterm-helper-textarea`, which is the user's most-common focus state — without this fix the toggle silently failed in the typical case.
- Should-fix #3 (FixedWidthToggle gated out in board mode): lifted `<FixedWidthToggle />` out of the `currentWindow && (...)` block in `top-bar.tsx:228-241`. Since board mode passes `currentWindow={null}`, the toggle previously never rendered there. The toggle is now route-agnostic (matches its semantics — fixed-width is a viewport preference, not a per-window setting).

## Deletion Candidates

- `app/frontend/src/components/board/board-page.tsx:28-31` — `interface BoardPageRouteProps {}` is empty (just a comment) and the `_props: BoardPageRouteProps` parameter in `BoardPage` is unused. Replace with `export function BoardPage()` taking no args.
- `app/frontend/src/components/shell/shell.tsx` `sidebarChildren` prop — duplicated construction at the call sites: in `app.tsx:924-962` and `board-page.tsx:334-351` the consumer assigns the Sidebar JSX to `sidebarElement` and then passes it both as `<Shell sidebarChildren={sidebarElement}>` (used on mobile) AND wraps it in a desktop-branch `<aside style={{gridArea:"sidebar"}}>{sidebarElement}</aside>` (used on desktop). Shell could instead accept a single sidebar slot (e.g., a render prop or named child) and own the desktop-vs-mobile branch internally, eliminating the duplicate JSX in both consumers. Tradeoff: the desktop branch in app.tsx also includes the drag-handle aside wrapper (lines 972-991), which BoardPage does NOT need — collapsing this requires Shell to know about the drag-handle (small leak) or expose a named "desktopChrome" slot.
- `app/frontend/src/components/board/board-page.tsx:264-297` `boardRouteActions` cycle-pane closures — the `setFocusedIndex((prev) => (prev + 1) % entries.length)` and `(prev - 1 + entries.length) % entries.length` math also lives in the keydown handler at lines 174-178. Three call sites, identical formulas. Extracting a `cycleFocus(direction: 1 | -1)` callback removes the duplication.
- `app/frontend/src/components/board/board-page.tsx:355` outer `<div className="bg-bg-primary text-text-primary">` wrapping `<Shell>` — Shell already establishes the root element with `className="app-shell"` and `height: var(--app-height, 100vh)`. The wrapper adds bg/text classes but since Shell's children fill it via grid placement, the bg/text is mostly invisible (only narrow seams between grid cells could show through). Could move these classes onto the Shell root or its grid cells.
- None at the type-removal level: `BottomBar` `wsRef` prop, `ChromeContext.drawerOpen` / `setDrawerOpen`, `BoardPage` inline `<header>`, "BoardsSection hidden when zero boards" early-return — all already removed by the apply step (covered under § Removal Verification A-024 through A-027).
