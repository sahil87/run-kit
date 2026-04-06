# Quality Checklist: Sidebar Component Decomposition

**Change**: 260405-f8p9-sidebar-component-decomposition
**Generated**: 2026-04-06
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Directory layout: `sidebar/` directory exists with `index.tsx`, `session-row.tsx`, `window-row.tsx`, `server-selector.tsx`, `kill-dialog.tsx`; old `sidebar.tsx` deleted
- [ ] CHK-002 Public API preserved: `SidebarProps` type is identical to original; `Sidebar` export present in `sidebar/index.tsx`
- [ ] CHK-003 KillDialog: component accepts `killTarget`, `onConfirm`, `onCancel` props; renders session vs window variants correctly; uses `<Dialog>` component
- [ ] CHK-004 ServerSelector: owns dropdown state (`serverDropdownOpen`, `refreshingServers`, ref, outside-click `useEffect`); accepts `server`, `servers`, `onSwitchServer`, `onCreateServer`, `onRefreshServers` props
- [ ] CHK-005 SessionRow: pure presentational; accepts all required props for collapse, inline rename, drag, kill; no hook imports for optimistic/store logic
- [ ] CHK-006 WindowRow: pure presentational; accepts all required props for selection, drag-and-drop, inline rename, kill; no hook imports for optimistic/store logic
- [ ] CHK-007 Orchestrator owns all state: `collapsed`, `killTarget`, `editingWindow`, `editingSession`, `dragSource`, `dropTarget`, `sessionDropTarget`, all refs, all `useOptimisticAction` hooks, all handler functions in `index.tsx`

## Behavioral Correctness

- [ ] CHK-008 Import resolution: `@/components/sidebar` resolves to `sidebar/index.tsx` — `app.tsx` requires no changes
- [ ] CHK-009 No behavioral changes: all interactions (click, double-click, Ctrl+click, drag, drop, rename) function identically to pre-refactor

## Removal Verification

- [ ] CHK-010 Original `sidebar.tsx` deleted: no dead code; no leftover monolithic file at `app/frontend/src/components/sidebar.tsx`

## Scenario Coverage

- [ ] CHK-011 Session kill dialog: "Kill session?" title with window count renders for session targets
- [ ] CHK-012 Window kill dialog: "Kill window?" title with session name renders for window targets
- [ ] CHK-013 ServerSelector outside-click dismiss: clicking outside the selector closes the dropdown
- [ ] CHK-014 SessionRow collapsed/expanded chevron: `▶`/`▼` and `aria-expanded` toggle correctly
- [ ] CHK-015 SessionRow cross-session drag-over: accent border style applied when `isSessionDropTarget === true`
- [ ] CHK-016 WindowRow selected styling: `bg-accent/15` applied when `isSelected === true`
- [ ] CHK-017 WindowRow drag-over indicator: `borderTop: "2px solid var(--color-accent)"` when `isDragOver === true`
- [ ] CHK-018 WindowRow ghost: `draggable={false}`, kill button is no-op, opacity+pulse styling applied
- [ ] CHK-019 Inline rename — window: double-click shows input; Enter commits; Escape cancels; blur commits unless cancelled
- [ ] CHK-020 Inline rename — session: double-click shows input; Enter commits; Escape cancels; cross-cancellation works
- [ ] CHK-021 All existing `sidebar.test.tsx` tests pass with `just test-frontend`

## Edge Cases & Error Handling

- [ ] CHK-022 Ghost window: kill button click is guarded by `!ghost` check in `WindowRow`
- [ ] CHK-023 Ghost session: row has `opacity-50 animate-pulse` class; kill and rename interactions behave as in original
- [ ] CHK-024 Empty sessions state: "No sessions" text + "+ New Session" button renders when `sessions.length === 0`
- [ ] CHK-025 Cross-cancellation: starting window rename cancels active session rename (and vice versa) without committing

## Code Quality

- [ ] CHK-026 Pattern consistency: kebab-case filenames, prop type definitions co-located with component, existing import aliases (`@/`) used throughout
- [ ] CHK-027 No unnecessary duplication: `getWindowDuration` and `isGhostWindow` imported from existing modules, not reimplemented
- [ ] CHK-028 Readability: sub-components are < 200 lines each; no god functions > 50 lines without clear reason
- [ ] CHK-029 Type safety: no `as` casts introduced; props typed with explicit TypeScript interfaces; `tsc --noEmit` passes
- [ ] CHK-030 No anti-patterns: no polling, no inline tmux construction, no new dependencies, no new routes

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
