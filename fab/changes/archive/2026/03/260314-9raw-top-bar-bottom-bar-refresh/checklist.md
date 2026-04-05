# Quality Checklist: Top Bar & Bottom Bar UI Refresh

**Change**: 260314-9raw-top-bar-bottom-bar-refresh
**Generated**: 2026-03-14
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Cmd toggle removal: No Cmd button in bottom bar DOM
- [ ] CHK-002 Compose button removal from bottom bar: No `>_` button in bottom bar
- [ ] CHK-003 Button size increase: KBD_CLASS uses 36px desktop / 44px touch targets
- [ ] CHK-004 Hamburger icon: Renders ☰ SVG (not logo img) as first top bar left element
- [ ] CHK-005 Hamburger animation: Transitions to X when sidebar/drawer open
- [ ] CHK-006 Breadcrumb format: Uses `/` separator, not `❯`
- [ ] CHK-007 Session name dropdown: Session name text is tappable dropdown trigger
- [ ] CHK-008 Window name dropdown: Window name text is tappable dropdown trigger
- [ ] CHK-009 Session name truncation: `max-w-[7ch] truncate` on session name span
- [ ] CHK-010 Right section branding: Logo img + "Run Kit" text present (desktop)
- [ ] CHK-011 Connection dot only: No "live"/"disconnected" text in DOM
- [ ] CHK-012 Compose in top bar: `>_` button present as rightmost right-section item
- [ ] CHK-013 Mobile right section: Only ⋯ and >_ visible below sm breakpoint
- [ ] CHK-014 Compose wiring: TopBar receives onOpenCompose, BottomBar does not

## Behavioral Correctness
- [ ] CHK-015 Modifier state: `ModifierSnapshot` has only ctrl/alt (no cmd)
- [ ] CHK-016 Armed bridging: keydown handler references only ctrl/alt snapshots
- [ ] CHK-017 modParam: Returns correct xterm param without cmd branch
- [ ] CHK-018 Hamburger toggle: Calls onToggleSidebar (desktop) / onToggleDrawer (mobile)

## Removal Verification
- [ ] CHK-019 No `cmd` in use-modifier-state.ts: Type, ref, useMemo, deps all clean
- [ ] CHK-020 No `onOpenCompose` in BottomBarProps: Prop and button both removed
- [ ] CHK-021 No "live"/"disconnected" text span in top bar
- [ ] CHK-022 No logo `<img>` in top bar left section (moved to right)
- [ ] CHK-023 No `❯` separator icons in breadcrumb nav

## Scenario Coverage
- [ ] CHK-024 Bottom bar renders Esc, Tab, Ctrl, Alt, Fn, arrows (no Cmd, no compose)
- [ ] CHK-025 Hamburger animates to X on sidebar open, back on close
- [ ] CHK-026 Session dropdown opens on session name click, includes + New Session
- [ ] CHK-027 Window dropdown opens on window name click, includes + New Window
- [ ] CHK-028 Compose button in top bar opens compose buffer overlay
- [ ] CHK-029 Mobile viewport shows only ⋯ and >_ in top bar right

## Edge Cases & Error Handling
- [ ] CHK-030 Long session name (>7 chars): Truncated with ellipsis
- [ ] CHK-031 No session selected: Breadcrumb gracefully omits session/window segments
- [ ] CHK-032 Disconnected state: Gray dot only (no text), compose button still functional

## Code Quality
- [ ] CHK-033 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-034 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-035 No shell strings or exec without context: All subprocess calls use exec.CommandContext (Go convention — N/A for frontend-only change)
- [ ] CHK-036 Type narrowing over assertions: No `as` casts in new/changed code
- [ ] CHK-037 No magic strings: Named constants for repeated values
- [ ] CHK-038 No inline tmux construction: N/A (frontend-only)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
