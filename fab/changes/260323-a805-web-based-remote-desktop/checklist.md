# Quality Checklist: Web-Based Remote Desktop

**Change**: 260323-a805-web-based-remote-desktop
**Generated**: 2026-03-23
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Window type detection: `parseWindows()` sets `Type: "desktop"` for `desktop:` prefixed windows, `Type: "terminal"` for all others
- [x] CHK-002 WindowInfo Type field: `Type string` field exists with `json:"type"` tag, serialized in JSON/SSE
- [x] CHK-003 Desktop window creation: `POST /api/sessions/{session}/windows` with `type: "desktop"` creates a `desktop:{name}` tmux window
- [x] CHK-004 Desktop startup script: Xvfb + WM detection + x11vnc with `-ws` flag all launch in sequence
- [x] CHK-005 Dynamic port allocation: Free port obtained via `net.Listen("tcp", ":0")`, no hardcoded ports
- [x] CHK-006 VNC port stored in tmux window option: `@rk_vnc_port` set via `set-option -w`, readable via `show-options -wv`
- [x] CHK-007 Unified relay: `/relay/{session}/{window}` detects desktop type, branches to VNC proxy
- [x] CHK-008 VNC proxy: WebSocket-to-WebSocket proxy copies data bidirectionally with cleanup
- [x] CHK-009 SSE type field: Desktop windows include `"type": "desktop"` in SSE payload
- [x] CHK-010 DesktopClient component: noVNC renders with `scaleViewport: true`, connects to relay endpoint
- [x] CHK-011 Window type switch: `app.tsx` renders DesktopClient for desktop, TerminalClient for terminal
- [x] CHK-012 Desktop bottom bar: Clipboard paste, resolution picker, fullscreen toggle present
- [x] CHK-013 Three creation entry points: Breadcrumb dropdown, dashboard card, command palette all create desktop windows
- [x] CHK-014 Resolution change: Command palette action + API endpoint + restart script
- [x] CHK-015 Dashboard badge: Desktop windows show visual indicator in dashboard cards

## Behavioral Correctness

- [x] CHK-016 Terminal windows unchanged: Existing terminal creation, relay, and rendering behavior is not affected
- [x] CHK-017 Default resolution: Desktop created without explicit resolution uses 1920x1080
- [x] CHK-018 Multiple desktops per session: Two+ desktop windows in same session each get unique port/display
- [x] CHK-019 Client-side scaling: noVNC scales desktop to fit viewport with correct aspect ratio

## Scenario Coverage

- [x] CHK-020 Desktop window created and visible in sidebar/dashboard
- [x] CHK-021 Desktop window renders noVNC canvas on navigation
- [x] CHK-022 Desktop window killed via existing kill endpoint, process tree cleaned up
- [x] CHK-023 Relay connects to desktop window and streams VNC data
- [x] CHK-024 Relay connects to terminal window unchanged
- [x] CHK-025 Browser disconnect triggers VNC proxy cleanup
- [x] CHK-026 Resolution change restarts Xvfb at new size

## Edge Cases & Error Handling

- [x] CHK-027 Invalid resolution rejected: Non-matching regex returns 400 Bad Request
- [x] CHK-028 VNC port not found: Relay handles missing `@rk_vnc_port` gracefully (close with error code)
- [x] CHK-029 x11vnc not started yet: Relay handles connection failure to VNC port (close with error code)
- [x] CHK-030 Desktop window on mobile: noVNC scales down with letterboxing, no overflow

## Code Quality

- [x] CHK-031 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [x] CHK-032 No unnecessary duplication: Existing utilities reused where applicable
- [x] CHK-033 All subprocess calls use `exec.CommandContext` with timeouts — never shell strings (constitution I)
- [x] CHK-034 No duplicating existing utilities — check `internal/tmux/`, `internal/sessions/`, `internal/validate/` (Go) and `src/api/client.ts` (frontend)
- [x] CHK-035 No inline tmux command construction — all tmux interaction through `internal/tmux/`

## Security

- [x] CHK-036 Resolution validation: Strict regex `^\d{3,5}x\d{3,5}$` prevents shell injection in send-keys
- [x] CHK-037 Window name validation: Desktop name validated via existing `ValidateName` before use in tmux commands
- [x] CHK-038 VNC proxy connects only to localhost: No external VNC server connections possible

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
