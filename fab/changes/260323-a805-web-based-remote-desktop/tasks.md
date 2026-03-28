# Tasks: Web-Based Remote Desktop

**Change**: 260323-a805-web-based-remote-desktop
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `Type` field to `WindowInfo` struct in `app/backend/internal/tmux/tmux.go` — add `Type string \`json:"type"\`` field. Update `parseWindows()` to set `Type` based on `desktop:` name prefix. Update `ListWindows` format string if needed.

- [x] T002 [P] Add `@novnc/novnc` npm dependency in `app/frontend/` — run `pnpm add @novnc/novnc` and verify the package installs correctly. Check TypeScript types availability (may need `@types/novnc` or manual type declarations).

- [x] T003 [P] Add `tmux show-options` helper in `app/backend/internal/tmux/tmux.go` — add `GetWindowOption(session string, windowIndex int, key string, server string) (string, error)` that runs `tmux show-options -wv -t {session}:{windowIndex} {key}` and returns the value. Also add `SetWindowOption(session string, windowIndex int, key, value, server string) error` that runs `tmux set-option -w -t {session}:{windowIndex} {key} {value}`.

- [x] T004 [P] Add resolution validation helper in `app/backend/internal/validate/validate.go` — add `ValidateResolution(res string) string` that validates against `^\d{3,5}x\d{3,5}$` regex and returns error message or empty string.

## Phase 2: Core Implementation

- [x] T005 Add desktop window creation to `handleWindowCreate` in `app/backend/api/windows.go` — extend the request body struct to include `Type string` and `Resolution string` fields. When `Type == "desktop"`: validate resolution (default "1920x1080"), allocate a free port via `net.Listen("tcp", ":0")`, derive display number, create tmux window named `desktop:{name}`, send desktop startup script via `send-keys`, set `@rk_vnc_port` window option. Add `TmuxOps` interface methods as needed: `GetWindowOption`, `SetWindowOption`.

- [x] T006 Add desktop startup script generation in `app/backend/api/windows.go` (or `app/backend/internal/tmux/desktop.go`) — function that generates the shell script string for a given display number, port, resolution. Script: start Xvfb, detect WM (x-session-manager → XDG_CURRENT_DESKTOP → probe list), launch WM in background, start x11vnc with `-ws` flag, store VNC port via `tmux set-option -w @rk_vnc_port`.

- [x] T007 Add VNC proxy branch to `handleRelay` in `app/backend/api/relay.go` — after session/window validation, check window type via `ListWindows()`. If desktop: read `@rk_vnc_port` via `GetWindowOption`, dial `ws://localhost:{port}`, bidirectional copy between browser WS and VNC WS with `sync.Once` cleanup. If terminal: existing PTY behavior unchanged.

- [x] T008 Add `DesktopClient` component in `app/frontend/src/components/desktop-client.tsx` — import noVNC `RFB` class, connect to `/relay/{session}/{window}?server={server}` WebSocket, configure `scaleViewport: true`, mount canvas in a container div that fills available space. Handle connect/disconnect/error events. Cleanup on unmount.

- [x] T009 Add window type switch in `app/frontend/src/app.tsx` — in the `sessionName && windowIndex` branch, look up current window's `type` from the sessions data. Render `DesktopClient` for `"desktop"`, `TerminalClient` for `"terminal"`. Hide terminal bottom bar for desktop windows.

## Phase 3: Integration & Edge Cases

- [x] T010 Add desktop creation to frontend API client in `app/frontend/src/api/client.ts` — add `createDesktopWindow(session: string, name?: string, resolution?: string): Promise<void>` that calls `POST /api/sessions/{session}/windows` with `{name, type: "desktop", resolution}`.

- [x] T011 Add "New Desktop Window" to command palette in `app/frontend/src/app.tsx` — add palette action `"create-desktop"` that calls `createDesktopWindow(sessionName)`. Only show when `sessionName` is set.

- [x] T012 [P] Add `+ New Desktop` to window breadcrumb dropdown in `app/frontend/src/components/top-bar.tsx` — add a second action item to the window breadcrumb dropdown that creates a desktop window.

- [x] T013 [P] Add `+ New Desktop` button to dashboard session cards in `app/frontend/src/components/dashboard.tsx` — add a dashed-border button next to the existing `+ New Window` button inside expanded session cards. Add desktop badge to desktop window cards.

- [x] T014 Add desktop bottom bar in `app/frontend/src/components/desktop-bottom-bar.tsx` — new component with clipboard paste button, resolution picker dropdown, and fullscreen toggle. Wire clipboard paste to noVNC clipboard API. Resolution picker triggers command palette or inline dropdown.

- [x] T015 Add resolution change endpoint `POST /api/sessions/{session}/windows/{index}/resolution` in `app/backend/api/windows.go` — validate resolution, read existing `@rk_vnc_port` from window option, send restart script via `send-keys` (kill Xvfb+x11vnc, restart at new resolution reusing same port/display). Register route in `app/backend/api/router.go`.

- [x] T016 Add resolution change to frontend API client and command palette — add `changeDesktopResolution(session, windowIndex, resolution)` in `client.ts`. Add "Change desktop resolution" command palette action (visible only when current window is desktop type) with preset resolution options.

- [x] T017 Add `TmuxOps` interface methods and prod implementations — add `GetWindowOption` and `SetWindowOption` to `TmuxOps` interface in `router.go` and implement in `prodTmuxOps`. Update `NewTestRouter` mock support.

## Phase 4: Tests

- [x] T018 [P] Add Go tests for window type detection in `app/backend/internal/tmux/tmux_test.go` — test `parseWindows()` with `desktop:` prefixed names returns `Type: "desktop"`, plain names return `Type: "terminal"`.

- [x] T019 [P] Add Go tests for resolution validation in `app/backend/internal/validate/validate_test.go` — test valid resolutions ("1920x1080", "800x600"), invalid ("foo", "1920x1080; rm -rf /", ""), edge cases.

- [x] T020 [P] Add Go tests for desktop window creation in `app/backend/api/windows_test.go` — test the extended `handleWindowCreate` with `type: "desktop"`, default resolution, custom resolution, invalid resolution rejection.

- [x] T021 [P] Add frontend component test for `DesktopClient` in `app/frontend/src/components/desktop-client.test.tsx` — test mount/unmount, connection lifecycle, scaleViewport configuration.

---

## Execution Order

- T001 blocks T005, T006, T007 (WindowInfo.Type needed by all)
- T003 blocks T005, T006, T007, T015 (tmux option helpers needed)
- T004 blocks T005, T015 (resolution validation needed)
- T002 blocks T008 (noVNC package needed)
- T005, T006 block T007 (desktop creation before relay can proxy)
- T008 blocks T009, T014 (DesktopClient before app.tsx switch and desktop bar)
- T009 blocks T011, T012, T013 (type switch before creation UX)
- T010 blocks T011, T012, T013, T016 (API client before UI callers)
- T017 should run alongside T005 (interface extension)
- Phase 4 tests (T018-T021) can run in parallel after their targets are complete
