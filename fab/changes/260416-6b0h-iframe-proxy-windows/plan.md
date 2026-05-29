# Plan: Iframe Proxy Windows

**Change**: 260416-6b0h-iframe-proxy-windows
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

- [x] T001 [P] Add `RkType` and `RkUrl` fields to `WindowInfo` struct in `app/backend/internal/tmux/tmux.go` — extend format string with `#{@rk_type}` and `#{@rk_url}`, update `parseWindows` to parse 9 fields
- [x] T002 [P] Add `rkType` and `rkUrl` optional fields to `WindowInfo` type in `app/frontend/src/types.ts`

## Phase 2: Core Implementation

- [x] T003 Create reverse proxy handler in `app/backend/api/proxy.go` — `handleProxy` using `httputil.ReverseProxy` with per-port caching via `sync.Map`, port validation (1–65535), WebSocket upgrade support
- [x] T004 Add HTML response rewriting to proxy via `ModifyResponse` — scan `text/html` responses, rewrite `localhost:{port}` and `127.0.0.1:{port}` in `src`/`href`/`action` attributes to `/proxy/{port}` paths. Handle gzip-compressed responses (decompress before scanning, re-compress or strip encoding after)
- [x] T005 Register proxy route in `app/backend/api/router.go` — mount `handleProxy` at `/proxy/{port}/*`. Add `/proxy` proxy rule to Vite dev config (`app/frontend/vite.config.ts`) alongside existing `/api` and `/relay` rules
- [x] T006 Add URL update endpoint `handleWindowUrlUpdate` in `app/backend/api/windows.go` — `PUT /api/sessions/{session}/windows/{index}/url`, validates inputs, runs `tmux set-option -w @rk_url`
- [x] T007 Extend `handleWindowCreate` in `app/backend/api/windows.go` — accept optional `rkType` and `rkUrl` in request body. When `rkType` is present, use a single `\;`-chained tmux command (new-window + set @rk_type + set @rk_url) to prevent SSE race
- [x] T008 Create `IframeWindow` component at `app/frontend/src/components/iframe-window.tsx` — URL bar (refresh button, URL input, submit indicator) + `<iframe>` filling remaining space. Skip iframe `src` update when URL unchanged
- [x] T009 Add rendering branch in `app/frontend/src/app.tsx` — when current window has `rkType === "iframe"`, render `<IframeWindow>` instead of `<TerminalClient>`
- [x] T010 Add `updateWindowUrl` function to `app/frontend/src/api/client.ts` — `PUT /api/sessions/{session}/windows/{index}/url` with `{"url": "..."}` body
- [x] T011 Extend `createWindow` in `app/frontend/src/api/client.ts` — accept optional `rkType` and `rkUrl` params, include in POST body when present

## Phase 3: Integration & Edge Cases

- [x] T012 Add "Window: New Iframe Window" command palette action in `app/frontend/src/app.tsx` — prompt for name and URL, call `createWindow` with `rkType: "iframe"` and `rkUrl`
- [x] T013 Wire URL bar submit to API — on Enter in URL input, call `updateWindowUrl`, update iframe `src` after SSE confirmation
- [x] T014 Handle external URL changes — when SSE pushes updated `rkUrl`, update URL bar text and iframe `src` (only when actually changed)
- [x] T015 [P] Add Go tests for proxy handler in `app/backend/api/proxy_test.go` — port validation, successful proxy, HTML rewriting, non-HTML passthrough, WebSocket upgrade
- [x] T016 [P] Add Go test for URL update endpoint in `app/backend/api/windows_test.go` — valid update, empty URL rejection, invalid index
- [x] T017 [P] Add Go test for extended window creation in `app/backend/api/windows_test.go` — create with rkType/rkUrl, verify tmux options set
- [x] T018 [P] Add Go test for extended `parseWindows` in `app/backend/internal/tmux/tmux_test.go` — 9-field format parsing, empty rk fields for terminal windows
- [x] T019 [P] Add frontend test for `IframeWindow` component in `app/frontend/src/components/iframe-window.test.tsx` — renders iframe with URL, URL bar displays current URL, refresh reloads, URL submit calls API
- [x] T020 [P] Extend `TmuxOps` interface in `app/backend/api/router.go` with `SetWindowOption(ctx, session, window, server, option, value)` method for testability

---

## Execution Order

- T001 and T002 are independent setup tasks (parallel)
- T003 → T004 → T005 (proxy handler → rewriting → route registration)
- T006, T007 depend on T001 (need extended WindowInfo for tmux option setting)
- T008 depends on T002 (needs frontend type)
- T009 depends on T008 (needs IframeWindow component)
- T010, T011 are independent API client additions
- T012 depends on T009, T011 (needs rendering branch and extended createWindow)
- T013, T014 depend on T008, T010 (need IframeWindow and updateWindowUrl)
- T015–T020 are parallel test tasks, depend on their respective implementation tasks

## Acceptance

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
