# Quality Checklist: tmux Server Switcher

**Change**: 260320-1335-tmux-server-switcher
**Generated**: 2026-03-20
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Server-parameterized tmux layer: All tmux functions accept server parameter and route commands correctly
- [ ] CHK-002 ListSessions single-server: Queries only the specified server, no dual-server merge
- [ ] CHK-003 ListServers discovery: Scans socket directory and returns running server names
- [ ] CHK-004 KillServer: Kills the specified tmux server via kill-server command
- [ ] CHK-005 Server creation via session: CreateSession on non-existent server starts the server with cwd=$HOME
- [ ] CHK-006 All API endpoints accept ?server= query param with "default" fallback
- [ ] CHK-007 GET /api/servers returns server list
- [ ] CHK-008 POST /api/servers creates server with initial session
- [ ] CHK-009 POST /api/servers/kill kills the server
- [ ] CHK-010 SSE endpoint filters to requested server
- [ ] CHK-011 Frontend server state in localStorage with "runkit" default
- [ ] CHK-012 SessionProvider exposes server, setServer, servers, refreshServers
- [ ] CHK-013 Sidebar server dropdown at bottom, pinned below scrollable session tree
- [ ] CHK-014 Command palette: Create tmux server (with dialog)
- [ ] CHK-015 Command palette: Kill tmux server (with confirmation)
- [ ] CHK-016 Command palette: Switch tmux server

## Behavioral Correctness
- [ ] CHK-017 Default server is "default" when ?server= param is absent (not "runkit")
- [ ] CHK-018 SSE reconnects when server is switched (new EventSource with updated param)
- [ ] CHK-019 Navigate to "/" on server switch (current session may not exist on new server)

## Removal Verification
- [ ] CHK-020 ProjectSession.Server field removed from Go struct and TypeScript type
- [ ] CHK-021 ↗ server marker removed from sidebar session rows
- [ ] CHK-022 tmuxExecDefault() function removed
- [ ] CHK-023 Dual-server merge logic removed from ListSessions
- [ ] CHK-024 SessionInfo.Server field removed

## Scenario Coverage
- [ ] CHK-025 Named server command execution includes -L flag
- [ ] CHK-026 Default server command execution has no -L flag
- [ ] CHK-027 Create server via palette → session created on new server → UI switches
- [ ] CHK-028 Kill server → switches to next available server or empty state
- [ ] CHK-029 Switch server via sidebar dropdown → sessions update
- [ ] CHK-030 SSE with explicit server param → receives only that server's data

## Edge Cases & Error Handling
- [ ] CHK-031 No servers running → empty server list, sidebar shows empty state
- [ ] CHK-032 Kill last server → no crash, empty state shown
- [ ] CHK-033 Server name validation rejects empty, spaces, special characters
- [ ] CHK-034 Socket directory missing or empty → ListServers returns empty slice

## Code Quality
- [ ] CHK-035 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-036 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-037 All exec.CommandContext calls use timeouts (constitution requirement)
- [ ] CHK-038 No shell string construction — argument slices only
- [ ] CHK-039 Server name validated before passing to subprocess (security)
- [ ] CHK-040 No polling from client — uses SSE stream

## Security
- [ ] CHK-041 Server name input sanitized to prevent shell injection in tmux -L argument
- [ ] CHK-042 serverFromRequest validates/sanitizes the query param value
