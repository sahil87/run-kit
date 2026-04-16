# Quality Checklist: Iframe Proxy Windows

**Change**: 260416-6b0h-iframe-proxy-windows
**Generated**: 2026-04-16
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Reverse proxy: `/proxy/{port}/*` routes to `localhost:{port}/*` for valid ports
- [x] CHK-002 WebSocket upgrade: proxy handles `Connection: Upgrade` transparently
- [x] CHK-003 HTML rewriting: `localhost:{port}` and `127.0.0.1:{port}` in src/href/action attributes rewritten to `/proxy/{port}`
- [x] CHK-004 Tmux state: `@rk_type` and `@rk_url` read via extended `ListWindows` format string
- [x] CHK-005 URL update endpoint: `PUT .../url` sets `@rk_url` and returns 200
- [x] CHK-006 Window creation: `POST .../windows` with `rkType`/`rkUrl` sets tmux options
- [x] CHK-007 Rendering branch: iframe windows render `IframeWindow`, terminal windows render `TerminalClient`
- [x] CHK-008 URL bar: displays current URL, editable, submits on Enter, refresh button reloads
- [x] CHK-009 Command palette: "Window: New Iframe Window" action creates iframe window
- [x] CHK-010 SSE reactivity: `@rk_url` changes propagate to frontend via existing SSE stream

## Behavioral Correctness
- [x] CHK-011 Backward compatible: existing terminal windows (no `@rk_type`) render unchanged
- [x] CHK-012 Iframe src stability: iframe not reloaded when SSE pushes unchanged URL
- [x] CHK-013 URL bar sync: external `@rk_url` changes update URL bar text

## Scenario Coverage
- [x] CHK-014 Successful proxy request: dev server page loads through `/proxy/{port}/`
- [x] CHK-015 Invalid port rejected: non-numeric or out-of-range port returns 400
- [x] CHK-016 Target not running: request to non-listening port returns 502
- [x] CHK-017 Non-HTML passthrough: JSON/CSS/JS responses not rewritten
- [x] CHK-018 Mixed window types: session with both terminal and iframe windows renders correctly
- [x] CHK-019 Create iframe via palette: window appears in sidebar, renders iframe


## Edge Cases & Error Handling
- [x] CHK-020 Empty URL rejected: PUT with empty URL returns 400
- [x] CHK-021 Proxy port validation: ports 0, 65536, negative, non-numeric all rejected
- [x] CHK-022 Large HTML response: rewriting handles responses of reasonable size without timeout

## Code Quality
- [x] CHK-023 Pattern consistency: proxy handler follows existing handler patterns (chi params, writeJSON, error responses)
- [x] CHK-024 No unnecessary duplication: reuses existing `validate` package, `tmuxExecServer`, `writeJSON`
- [x] CHK-025 exec.CommandContext: all tmux calls for setting window options use CommandContext with timeouts
- [x] CHK-026 No shell strings: tmux option setting uses argument slices, not shell concatenation
- [x] CHK-027 No polling from client: URL updates flow through existing SSE, not setInterval
- [x] CHK-028 Type narrowing: frontend uses type guards for `rkType` checks, not type assertions

## Security
- [x] CHK-029 Localhost only: proxy validates target is localhost, no SSRF to remote hosts
- [x] CHK-030 Port validation: numeric range check prevents open redirect
- [x] CHK-031 URL input sanitized: URL values validated before passing to tmux subprocess

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
