# Quality Checklist: Rich Sidebar Window Status

**Change**: 260313-txna-rich-sidebar-window-status
**Generated**: 2026-03-13
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Fetch pane foreground command: `ListWindows()` returns `PaneCommand` populated from `#{pane_current_command}`
- [x] CHK-002 Expose activity timestamp: `WindowInfo` JSON includes `activityTimestamp` field with Unix epoch
- [x] CHK-003 Read `.fab-runtime.yaml`: `ReadRuntime()` returns correct `AgentState`/`AgentIdleDuration` for active, idle, and unknown states
- [x] CHK-004 Cache runtime file: `.fab-runtime.yaml` read at most once per project root within `FetchSessions()`
- [x] CHK-005 WindowInfo struct extended: `PaneCommand`, `AgentState`, `AgentIdleDuration`, `ActivityTimestamp` fields present and serialized correctly
- [x] CHK-006 Activity dot ring: `isActiveWindow: true` windows show `ring-1` outline on dot
- [x] CHK-007 Duration display: idle windows show duration (agentIdleDuration for fab, activityTimestamp-derived for non-fab), active windows omit
- [x] CHK-008 Info popover: "i" button with hover-reveal (desktop) and persistent ⓘ (mobile), tap-to-toggle popover with key-value layout
- [x] CHK-009 Top bar enrichment: Line 2 right shows paneCommand, duration, fab stage + ID + slug for selected window
- [x] CHK-010 TypeScript types: `WindowInfo` in `types.ts` includes all 4 new fields

## Behavioral Correctness
- [x] CHK-011 `parseWindows()` correctly handles 6-field format (was 5)
- [x] CHK-012 `enrichSession()` populates runtime fields alongside existing fab state fields
- [x] CHK-013 Non-fab windows: `agentState`/`agentIdleDuration` omitted from JSON (omitempty)
- [x] CHK-014 Unknown agent state: sidebar/top bar fall back to `activityTimestamp`-based duration
- [x] CHK-015 Fab change display: 4-char ID + slug parsed from `fabChange` (not full folder name)

## Scenario Coverage
- [x] CHK-016 Scenario: tmux-focused active window shows green dot with green ring
- [x] CHK-017 Scenario: tmux-focused idle window shows dim dot with dim ring
- [x] CHK-018 Scenario: non-focused window shows no ring
- [x] CHK-019 Scenario: fab window idle 3m shows "3m" in sidebar
- [x] CHK-020 Scenario: non-fab window idle 1h shows "1h" in sidebar
- [x] CHK-021 Scenario: active window shows no duration
- [x] CHK-022 Scenario: desktop hover reveals "i" button
- [x] CHK-023 Scenario: mobile "i" always visible
- [x] CHK-024 Scenario: popover dismiss on outside click/Escape/re-tap
- [x] CHK-025 Scenario: full fab status in top bar Line 2
- [x] CHK-026 Scenario: non-fab status in top bar Line 2
- [x] CHK-027 Scenario: mobile Line 2 collapse

## Edge Cases & Error Handling
- [x] CHK-028 Empty `paneCommand`: field omitted from JSON, sidebar/top bar skip display
- [x] CHK-029 Missing `.fab-runtime.yaml`: `ReadRuntime` returns "unknown", UI degrades gracefully
- [x] CHK-030 Missing change entry in runtime file: returns "active" (not error)
- [x] CHK-031 Non-fab popover: "Change" row omitted

## Code Quality
- [x] CHK-032 Pattern consistency: `exec.CommandContext` with timeouts for tmux (no new subprocess patterns)
- [x] CHK-033 No unnecessary duplication: `FormatIdleDuration` shared between runtime.go tests; frontend `formatDuration` in shared util (note: `parseFabChange` and `getWindowDuration` are duplicated across sidebar.tsx and top-bar.tsx -- should-fix, not blocking)
- [x] CHK-034 No shell string construction: all tmux interaction through `internal/tmux/`
- [x] CHK-035 No polling from client: SSE stream delivers new fields (no setInterval + fetch)
- [x] CHK-036 Type narrowing over assertions: frontend uses `if` guards for optional fields (not `as` casts)

## Security
- [x] CHK-037 No new subprocess calls: `pane_current_command` added to existing format string, `.fab-runtime.yaml` read via `os.ReadFile`

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
