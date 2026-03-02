# Quality Checklist: Web-Based Agent Orchestration Dashboard

**Change**: 260302-fl88-web-agent-dashboard
**Generated**: 2026-03-02
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Component Separation: Three independent processes (supervisor, Next.js, relay) can start/stop independently
- [ ] CHK-002 Session Listing: `listSessions()` returns session names, returns `[]` when tmux not running
- [ ] CHK-003 Window Listing: `listWindows()` returns parsed WindowInfo with activity derived from 10s threshold
- [ ] CHK-004 Session/Window CRUD: `createSession`, `createWindow`, `killWindow`, `sendKeys` all functional via execFile
- [ ] CHK-005 Pane Operations: `splitPane` creates independent pane and returns ID, `killPane` destroys it, `capturePane` captures content
- [ ] CHK-006 Worktree Wrappers: `lib/worktree.ts` delegates to wt-* scripts, does not reimplement
- [ ] CHK-007 Fab Integration: `getStatus`, `getCurrentChange`, `listChanges` read fab state from worktree paths
- [ ] CHK-008 Config Loading: `run-kit.yaml` parsed with project paths, missing file throws descriptive error
- [ ] CHK-009 Convention Derivation: Project IDs derived from config keys, tmux session names match exactly
- [ ] CHK-010 Health Endpoint: `GET /api/health` returns `200 { "status": "ok" }`
- [ ] CHK-011 Sessions Endpoint: `GET /api/sessions` returns ProjectSession[] with project mapping and fab enrichment
- [ ] CHK-012 SSE Endpoint: `GET /api/sessions/stream` establishes SSE, polls every 2-3s, emits full snapshots on change
- [ ] CHK-013 Dashboard Page: Projects as sections, cards with window info, empty state, "Other" section for unmatched sessions
- [ ] CHK-014 Project View: Focused single-project view with create/kill/send actions
- [ ] CHK-015 Terminal View: Full-screen xterm.js, WebSocket to relay via URL path, minimal chrome top bar
- [ ] CHK-016 Keyboard Navigation: j/k, Enter, /, n, c, x, s, Cmd+K, Esc Esc all functional
- [ ] CHK-017 Command Palette: Cmd+K opens modal with fuzzy search over contextual actions
- [ ] CHK-018 Dark Theme: #111/#1a1a1a backgrounds, white/gray text, monospace font, no light elements
- [ ] CHK-019 Terminal Relay: WebSocket on port 3001, URL path routing, independent pane per client
- [ ] CHK-020 Relay Cleanup: Pane killed on WebSocket close/error, no orphaned panes
- [ ] CHK-021 Supervisor Restart: .restart-requested triggers build, kill, start, health check
- [ ] CHK-022 Supervisor Rollback: Build/health failure triggers git revert HEAD + rebuild

## Behavioral Correctness

- [ ] CHK-023 SSE Disconnect: Client disconnect stops polling interval, no thrown errors
- [ ] CHK-024 tmux Not Running: All tmux operations gracefully handle missing tmux server (empty arrays, not throws)
- [ ] CHK-025 Session Mapping: Exact name match only, no prefix matching, unmatched → "Other"
- [ ] CHK-026 Activity Status: Only "active"/"idle" — no "exited" state in WindowInfo type
- [ ] CHK-027 Joint Restart: Supervisor restarts both Next.js and relay together as single unit

## Scenario Coverage

- [ ] CHK-028 Scenario: Server restart does not affect tmux sessions
- [ ] CHK-029 Scenario: Malicious session name handled safely (execFile, not interpolated)
- [ ] CHK-030 Scenario: tmux command timeout (execFile timeout fires, API returns error)
- [ ] CHK-031 Scenario: Browser client connects → independent pane created
- [ ] CHK-032 Scenario: Browser tab closed → pane cleaned up
- [ ] CHK-033 Scenario: Multiple browser clients → separate panes, agent pane untouched
- [ ] CHK-034 Scenario: Network interruption → WebSocket ping/pong timeout → pane cleanup
- [ ] CHK-035 Scenario: Optimistic window creation (card appears before SSE confirms)
- [ ] CHK-036 Scenario: Build failure triggers rollback (git revert HEAD)

## Edge Cases & Error Handling

- [ ] CHK-037 Non-existent session: `listWindows("nonexistent")` returns `[]`
- [ ] CHK-038 Missing run-kit.yaml: Clear error message, not silent failure
- [ ] CHK-039 tmux pane killed externally: Relay catches write error, closes WebSocket gracefully
- [ ] CHK-040 Invalid WebSocket path: Missing/invalid session/window → immediate close with error code
- [ ] CHK-041 No fab state in worktree: `getCurrentChange` returns `null`, fab fields omitted from WindowInfo

## Code Quality

- [ ] CHK-042 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-043 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-044 execFile with argument arrays: No `exec()`, `execSync()`, or template-string shell commands anywhere
- [ ] CHK-045 All execFile calls include timeout option (5-10s tmux, 30s build)
- [ ] CHK-046 Server Components by default: Client Components only for interactivity (keyboard handlers, xterm.js, SSE consumers)
- [ ] CHK-047 Type narrowing over assertions: Prefer `if` guards and discriminated unions over `as` casts
- [ ] CHK-048 No in-memory state caches: Derive from tmux + filesystem at request time
- [ ] CHK-049 Wrap scripts in typed async functions: No direct shell script calls from components or API routes
- [ ] CHK-050 No god functions (>50 lines without clear reason)
- [ ] CHK-051 No magic strings/numbers: Named constants for ports, timeouts, thresholds, colors
- [ ] CHK-052 No useEffect for data fetching: Use Server Components or server actions
- [ ] CHK-053 No client-side polling: Use SSE stream, not setInterval + fetch
- [ ] CHK-054 No database/ORM imports anywhere in codebase

## Security

- [ ] CHK-055 No shell injection: All subprocess calls use execFile with argument arrays
- [ ] CHK-056 Input validation: Session names, window names, paths validated before subprocess use
- [ ] CHK-057 WebSocket cleanup: All browser-created panes killed on disconnect (no tmux session leaks)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
