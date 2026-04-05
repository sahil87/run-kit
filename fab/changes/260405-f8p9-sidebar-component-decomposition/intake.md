# Intake: Sidebar Component Decomposition

**Change**: 260405-f8p9-sidebar-component-decomposition
**Created**: 2026-04-06
**Status**: Draft

## Origin

> Sidebar component decomposition — Extract the ~700-line sidebar into sub-components: SessionRow, WindowRow, ServerSelector, KillDialog, and any other logical pieces. Each sub-component should be independently testable. Keep all existing behavior identical — this is a pure refactor with no user-facing changes. Goal: make the sidebar easier to iterate on for upcoming features (inline output peek, activity previews, etc.).

One-shot description with clear scope and explicit sub-component list. Pure refactor — no behavioral changes.

## Why

The sidebar (`app/frontend/src/components/sidebar.tsx`) is currently 713 lines in a single component. It contains at least five distinct responsibilities: session row rendering with inline rename, window row rendering with inline rename and drag-and-drop, server selector dropdown, kill confirmation dialog, and all supporting state/hooks for optimistic actions. This monolithic structure makes it difficult to:

1. **Iterate on new features** — upcoming work (inline output peek, activity previews) would add more complexity to an already dense file. Each feature change risks unintended side-effects across unrelated sidebar regions.
2. **Test in isolation** — the existing 810-line test file (`sidebar.test.tsx`) must mount the entire sidebar to test any individual piece. Focused unit tests for, say, the kill dialog or server selector are impossible without extracting them.
3. **Review changes** — code review of any sidebar PR requires understanding the entire file rather than a self-contained sub-component.

If this refactor is not done, each subsequent sidebar feature will compound the maintenance burden, and the test surface will become increasingly brittle.

## What Changes

### Sub-Component Extraction

Extract the following from `sidebar.tsx` into separate files under `app/frontend/src/components/sidebar/`:

#### `SessionRow`
- The session header row: collapse toggle, session name (with inline rename on double-click), new-window `+` button, kill `✕` button
- Ctrl/Cmd+click force-kill behavior
- Drag-over styling for cross-session window moves (drop target highlighting)
- Props: session data, collapsed state, editing state, event handlers

#### `WindowRow`
- Individual window row: activity dot, window name (with inline rename on double-click), fab stage badge, duration display
- Selected state styling (`bg-accent/10 border-accent`)
- Drag-and-drop reordering within a session (draggable, drag-over indicator)
- Hover-reveal kill button (desktop) / always-visible kill button (touch)
- Props: window data, selected state, editing state, drag state, event handlers

#### `ServerSelector`
- The pinned-bottom server dropdown: current server label, dropdown toggle, server list, `+ tmux server` create button
- Outside-click dismiss via `useEffect` + ref
- Refresh-on-open with `LogoSpinner` loading state
- Props: server, servers list, event handlers

#### `KillDialog`
- Kill confirmation dialog for both sessions and windows
- Uses existing `<Dialog>` component
- Props: kill target (session or window), onConfirm, onCancel

#### `sidebar/index.tsx` (orchestrator)
- Re-exports the `Sidebar` component
- Contains the top-level state: `collapsed`, `killTarget`, `editingWindow`, `editingSession`, `dragSource`, `dropTarget`, `serverDropdownOpen`
- Contains optimistic action hooks (`useOptimisticAction` for kill session, kill window, rename session, rename window)
- Wires sub-components together with callbacks
- The public API (`SidebarProps`) remains identical — existing consumers (`app.tsx`) require zero changes

### File Structure

```
app/frontend/src/components/
  sidebar/
    index.tsx          # Orchestrator — Sidebar component (re-export)
    session-row.tsx    # SessionRow sub-component
    window-row.tsx     # WindowRow sub-component
    server-selector.tsx # ServerSelector sub-component
    kill-dialog.tsx    # KillDialog sub-component
  sidebar.test.tsx     # Existing tests — updated imports only
```

The old `sidebar.tsx` is replaced by the `sidebar/` directory with `index.tsx`. Import paths like `@/components/sidebar` continue to resolve correctly because bundlers (Vite) resolve `sidebar/index.tsx` for directory imports.

### Existing Tests

The existing `sidebar.test.tsx` (810 lines) should continue to pass with only import path changes (if any). New focused tests for individual sub-components are out of scope for this change but become possible after extraction. The test file stays at `app/frontend/src/components/sidebar.test.tsx` — Vitest resolves `@/components/sidebar` to `sidebar/index.tsx` the same way Vite does.

### Behavioral Constraints

- Zero user-facing changes — every interaction (click, double-click, ctrl+click, drag, drop, keyboard) must behave identically
- No new dependencies
- No prop drilling beyond one level — if a sub-component needs deep context, pass explicit props (no new React contexts for this refactor)
- Ghost window/session rendering (optimistic UI) must remain intact in all sub-components

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the sidebar's sub-component structure in the Sidebar section

## Impact

- **Frontend only** — no backend changes
- **Files created**: `sidebar/index.tsx`, `sidebar/session-row.tsx`, `sidebar/window-row.tsx`, `sidebar/server-selector.tsx`, `sidebar/kill-dialog.tsx`
- **Files removed**: `sidebar.tsx` (replaced by directory)
- **Files modified**: `sidebar.test.tsx` (import path update if needed)
- **APIs affected**: None — `SidebarProps` type and public API unchanged
- **Risk**: Low — pure refactor with existing test coverage

## Open Questions

None — the description is specific about sub-components, the codebase provides clear boundaries, and this is a mechanical refactor.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `sidebar/` directory with `index.tsx` barrel | Vite resolves directory imports to `index.tsx` — standard pattern in this codebase | S:90 R:95 A:95 D:95 |
| 2 | Certain | Keep `SidebarProps` type unchanged | Description explicitly says "no user-facing changes" — the public API is part of that contract | S:95 R:90 A:90 D:95 |
| 3 | Certain | Use kebab-case filenames (`session-row.tsx`) | Matches existing codebase convention (`logo-spinner.tsx`, `command-palette.tsx`) | S:85 R:95 A:95 D:95 |
| 4 | Confident | State and optimistic hooks stay in orchestrator `index.tsx` | Keeps sub-components pure/presentational, avoids duplicating hook wiring. The description says "independently testable" which is easier with prop-driven components | S:80 R:80 A:75 D:70 |
| 5 | Confident | Existing `sidebar.test.tsx` stays as integration tests, no new unit tests | Description scope is "pure refactor" — new tests are out of scope. Existing tests validate behavioral parity | S:75 R:85 A:70 D:75 |
| 6 | Certain | No new React contexts introduced | Constitution says "Derive state from tmux + filesystem" and code-quality says "prefer composition." Props are sufficient for one level of nesting | S:85 R:85 A:90 D:90 |
| 7 | Confident | Drag-and-drop handlers split between SessionRow and WindowRow | SessionRow handles cross-session drop target; WindowRow handles intra-session drag/reorder. This follows the existing code structure where drag-over handlers are scoped to their DOM element | S:70 R:80 A:80 D:70 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
