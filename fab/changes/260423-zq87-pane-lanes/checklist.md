# Quality Checklist: Pane Lanes

**Change**: 260423-zq87-pane-lanes
**Generated**: 2026-04-23
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Lanes route: `/lanes` route exists as root-level sibling of `/` and `/$server`
- [x] CHK-002 Pin data model: pins stored as `{server, session, windowIndex}` tuples in localStorage key `runkit-lanes-pins`
- [x] CHK-003 Pin hook: `usePinnedLanes()` provides pins, pinWindow, unpinWindow, isPinned, clearPins
- [x] CHK-004 Command palette: "Lanes: Pin Current Window", "Lanes: Unpin Current Window", "View: Open Lanes" actions registered
- [x] CHK-005 Sidebar pin icon: hover-reveal pin button on window rows, filled when pinned
- [x] CHK-006 Right-click context menu: "Pin to Lanes"/"Unpin from Lanes" on window row right-click
- [x] CHK-007 Lane header: shows server·session·window, connection dot, unpin button, "open in terminal" link
- [x] CHK-008 Horizontal scroll: lanes container scrolls horizontally with scroll-snap
- [x] CHK-009 Lane terminal: each lane renders xterm.js with live WebSocket relay connection
- [x] CHK-010 Lane resize: right-edge drag handle, width persisted per-lane in localStorage, 480px default, 280px min
- [x] CHK-011 Focus — click: clicking lane terminal area focuses it with accent ring
- [x] CHK-012 Focus — hover: mouseenter on lane terminal area focuses it
- [x] CHK-013 Focus — keyboard: Ctrl+] next lane, Ctrl+[ previous, wrap-around
- [x] CHK-014 Empty state: "No panes pinned" message with guidance when no pins exist
- [x] CHK-015 SSE multi-server: one SSE connection per unique server among pinned lanes
- [x] CHK-016 Window kill detection: lane shows "window closed" overlay, auto-unpins after 5s
- [x] CHK-017 Connection indicator: green/gray dot per lane header matching connection state

## Behavioral Correctness

- [x] CHK-018 Duplicate prevention: pinning an already-pinned window is silently ignored
- [x] CHK-019 Cross-tab sync: pinning in one tab reflects in another via storage event
- [x] CHK-020 Cross-server pinning: lanes from different tmux servers coexist in the same view
- [x] CHK-021 Navigate back: "open in terminal" link navigates to correct `/$server/$session/$window`
- [x] CHK-022 Lanes page uses own chrome, not AppShell — no sidebar rendered

## Scenario Coverage

- [x] CHK-023 Pin via command palette → lane appears in lanes view
- [x] CHK-024 Pin via sidebar icon → window row shows filled pin icon
- [x] CHK-025 Pin via right-click context menu → context menu dismisses, pin added
- [x] CHK-026 Unpin via lane header → lane removed from view
- [x] CHK-027 Multiple lanes scroll horizontally with snap
- [x] CHK-028 Resize a lane → width persists across page reload
- [x] CHK-029 Kill tmux window → lane shows overlay → auto-unpins after 5s

## Edge Cases & Error Handling

- [x] CHK-030 Zero pins: lanes view shows empty state, not blank page
- [x] CHK-031 WebSocket disconnect: lane shows gray dot, reconnects with backoff
- [x] CHK-032 All lanes unpinned while on /lanes: transitions to empty state gracefully
- [x] CHK-033 Invalid pin in localStorage (stale server/session): lane handles gracefully, shows "window closed"

## Code Quality

- [x] CHK-034 Pattern consistency: new components follow naming and structural patterns of existing components (terminal-client.tsx, sidebar/window-row.tsx)
- [x] CHK-035 No unnecessary duplication: WebSocket/xterm.js setup reuses patterns from terminal-client.tsx (or extracts shared logic)
- [x] CHK-036 All subprocess calls use exec.CommandContext with timeouts (Go — N/A if no backend changes) **N/A**: No backend changes in this change
- [x] CHK-037 No `any` types in new TypeScript code
- [x] CHK-038 Resize handle follows existing pointer-event drag pattern (document-level listeners, body cursor override)
- [x] CHK-039 localStorage access wrapped in try/catch (matching existing convention)

## Security

- [x] CHK-040 No XSS via pin data: localStorage values are parsed as JSON, not interpolated as HTML
- [x] CHK-041 WebSocket URLs constructed safely: server/session/window values validated before URL construction

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
