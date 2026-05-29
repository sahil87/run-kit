# Plan: Window-ID Routing (stable `@N` identity)

**Change**: 260529-chgz-window-id-routing
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Add `validate.ValidateWindowID(id, label string) string` to `app/backend/internal/validate/validate.go` enforcing `^@[0-9]+$` (compiled package-level regexp); empty/malformed → non-empty error message. Add table-driven `TestValidateWindowID` to `app/backend/internal/validate/validate_test.go` following the existing test style.

### Phase 2: Core Implementation (Backend)

- [x] T002 Update window-targeting tmux funcs in `app/backend/internal/tmux/tmux.go` to take `windowID string` and pass it directly as the `-t` target (drop `fmt.Sprintf("%s:%d", session, index)`): `KillWindow`, `RenameWindow`, `SelectWindow`, `SplitWindow`, `SendKeys`, `KillActivePane`, `SetWindowColor`, `UnsetWindowColor`, `SetWindowOption`, `UnsetWindowOption`.
- [x] T003 Update positional ops in `app/backend/internal/tmux/tmux.go`: `MoveWindow(windowID string, targetIndex int, server string)` — add `#{window_id}` to the `list-windows` format, resolve `windowID`→current index, then perform the existing adjacent-swap reorder. `MoveWindowToSession(windowID, targetSession, server string)` — `move-window -s <windowID> -t <targetSession>:`.
- [x] T004 Add `tmux.ResolveWindowSession(ctx context.Context, server, windowID string) (string, error)` to `app/backend/internal/tmux/tmux.go` running `display-message -t <windowID> -p '#{session_name}'` via `tmuxExecServer`; return error/empty when the window is gone.
- [x] T005 Update `TmuxOps` interface + `prodTmuxOps` methods in `app/backend/api/router.go` in lockstep with T002–T004 signatures; add `ResolveWindowSession` to the interface. Change window-targeting routes to `/api/windows/{windowId}/...` (kill, move, move-to-session, rename, color, url PUT, type PUT, keys, select, split, close-pane); keep create at `/api/sessions/{session}/windows`; change relay route to `/relay/{windowId}`.
- [x] T006 In `app/backend/api/windows.go`: replace `parseWindowIndex` with `parseWindowID(r) (string, bool)` (validate via `ValidateWindowID`, 400 on failure). Update every window handler (kill, rename, select, split, close-pane, move, move-to-session, color, url, type, keys) to read `windowId` and drop the `session` lookup/validation where no longer needed to address the window; `MoveWindow`/`MoveWindowToSession` handlers pass `windowID` source.
- [x] T007 In `app/backend/api/relay.go`: read `windowId` path param, validate via `ValidateWindowID` (400 before upgrade on failure), resolve owning session via `tmux.ResolveWindowSession` (5s `exec.CommandContext` timeout) before creating the ephemeral grouped session; on resolution failure/empty close WS `4004`. Create ephemeral against the resolved session, `SelectWindow(windowID,...)` on the ephemeral, attach — otherwise unchanged.
- [x] T008 In `app/backend/internal/sessions/sessions.go`: switch the `FetchSessions` enrichment join and `dedupEntries` collision key from `session:index` to window ID. Since `fab pane map` (external, immutable per constitution §III) emits only `session`+`window_index`, build the per-session `index→windowID` translation from the live `WindowInfo` snapshot and key enrichment by `windowID`. Change `ProjectRoot` to identify the target window by `windowID` (`ProjectRoot(ctx, windowID, server string)`); update its callers.
- [x] T009 In `app/backend/api/upload.go`: `handleUpload` (session-scoped route, unchanged) — change the optional `window` form value from a numeric index to a `windowId`, validate via `ValidateWindowID` when present, and match the target window by `WindowID` instead of `Index`.

### Phase 3: Core Implementation (Frontend)

- [x] T010 `app/frontend/src/router.tsx`: keep `$window` segment but treat it as the windowId string (no parse change needed beyond docs); ensure no numeric coercion.
- [x] T011 `app/frontend/src/api/client.ts`: change `killWindow`, `moveWindow`, `moveWindowToSession`, `renameWindow`, `sendKeys`, `splitWindow`, `closePane`, `updateWindowUrl`, `updateWindowType`, `selectWindow`, `setWindowColor` to take `windowId: string` and build `/api/windows/${encodeURIComponent(windowId)}/...`; keep `server` first positional; drop `session` where no longer needed. `moveWindow` keeps numeric `targetIndex`; `moveWindowToSession` keeps `targetSession`.
- [x] T012 `app/frontend/src/components/terminal-client.tsx`: rename `windowIndex` prop usage to a windowId string; build relay WS URL as `/relay/${encodeURIComponent(windowId)}?server=...` (drop session segment); update `useFileUpload` arg.
- [x] T013 `app/frontend/src/app.tsx`: param plumbing — `currentWindow` lookup by `w.windowId === windowParam` (remove `String(w.index)`); mount-time alignment + URL writeback compare `activeWindow.windowId` vs URL windowId; `navigateToWindow(session, windowId)`; `pendingClickRef` keyed by windowId; command-palette window actions (type/move/split/close/select/color) and TmuxCommandsDialog pass `currentWindow.windowId`; pass `currentWindow.windowId` to IframeWindow/TerminalClient and `currentWindowIndex={windowParam}` (now windowId) to Sidebar; `onSelectWindow` passes windowId. Move-left/right still compute a numeric `targetIndex` for the move API but navigate to the moved window's `windowId`.
- [x] T014 `app/frontend/src/lib/navigation.ts`: `computeKillRedirect` returns the neighbor's `windowId` (list-position neighbor, no index arithmetic). Update `RedirectTarget` to `{ to: "window"; session: string; windowId: string }` and the `currentSessionWindows` element type to include `windowId`.
- [x] T015 `app/frontend/src/components/iframe-window.tsx`: prop `windowId: string`; pass to `updateWindowUrl`/`updateWindowType`.
- [x] T016 `app/frontend/src/components/top-bar.tsx`: breadcrumb session/window `href`s use `w.windowId`; "current" detection compares `w.windowId === currentWindow.windowId`; `handleDropdownNavigate` parses the windowId segment (string, no `Number()`) and calls `onNavigate(session, windowId)`.
- [x] T017 `app/frontend/src/components/sidebar/index.tsx`: `currentWindowIndex` prop → windowId string (rename to `currentWindowId`); `isSelected` compares `currentWindowId === win.windowId`; `onSelectWindow(server, session, windowId)`; kill/rename/move-to-session optimistic actions pass `windowId` to the client fns (drag payload already carries `windowId`); DnD reorder keeps numeric index target but identifies source by windowId; `selectedWindow`/`BottomPanels` match by windowId; rename-redirect URLs use windowId.
- [x] T018 `app/frontend/src/hooks/use-dialog-state.ts`: `executeRenameWindow`/`executeKillWindow` actions pass `windowId` to `renameWindow`/`killWindow` (windowId already in scope; index no longer needed for addressing).
- [x] T019 `app/frontend/src/store/window-store.ts`: keep `${server}:${windowId}` key and `index` field for ordering unchanged; verify `moveWindowOrder` (positional reorder by index) still works and no selection logic keys off index.

### Phase 4: Tests & Companion Docs

- [x] T020 Update `app/backend/internal/tmux/tmux_test.go` (`TestSwapWindowArgs`/`TestMoveWindowToSessionArgs` around 784-844) to reflect windowID source targets; any other compile-affected expectations.
- [x] T021 Update `app/backend/api/sessions_test.go` `mockTmuxOps` window methods + capture fields to the new signatures (windowID instead of session+index; add `resolveWindowSession*` fields + method) and `app/backend/api/windows_test.go` + `relay_test.go` to use `/api/windows/{windowId}/...` and `/relay/{windowId}` (resolve live window IDs from tmux in the integration relay test). Update `app/backend/api/upload_test.go` if it asserts window-index behavior. Update `internal/sessions/sessions_test.go` `TestProjectRootDerivation` to the windowID lookup.
- [x] T022 Update frontend unit tests referencing window-index URLs/API/props: `src/api/client.test.ts`, `src/components/sidebar.test.tsx`, `src/components/terminal-client.test.tsx`, `src/components/iframe-window.test.tsx`, `src/hooks/use-dialog-state.test.tsx`, `src/lib/navigation.test.ts`, `src/store/window-store.test.ts`, `src/components/sidebar/window-row.test.tsx` (as needed).
- [x] T023 Update e2e spec `app/frontend/tests/e2e/sidebar-window-sync.spec.ts` URL assertions to match `${target.windowId}` (regex-escaped) instead of `${target.index}`, and update the companion `app/frontend/tests/e2e/sidebar-window-sync.spec.md` in the same commit (constitution § Test Companion Docs).

### Phase 5: Verification

- [x] T024 Run gates: `just test-backend`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; and `just test-e2e` (touches navigation/URL e2e). Fix failures and retry.

## Execution Order

- T001 → T002/T003/T004 (validator first) → T005 (interface depends on concrete sigs) → T006/T007/T009 (handlers depend on interface) → T008 (independent backend).
- Frontend: T011 (client) → T012–T018 (consumers) ; T010/T019 independent.
- Tests (T020–T023) after their corresponding implementation; T024 last.

## Acceptance

### Functional Completeness

- [ ] A-001 Window ID validation: `validate.ValidateWindowID` exists, returns "" for `@5` and a non-empty message for `5`, `@`, `@5;rm`, `window-5`, and empty; covered by a unit test.
- [ ] A-002 tmux targets use window ID directly: the 10 window-targeting tmux funcs pass `windowID` as `-t` with no `session:index` construction.
- [ ] A-003 TmuxOps signatures take window ID: `KillWindow`, `RenameWindow`, `SelectWindow`, `SplitWindow`, `SendKeys`, `KillActivePane`, `SetWindowColor`, `UnsetWindowColor`, `SetWindowOption`, `UnsetWindowOption` take `windowID string` (no session+index pair); interface and concrete funcs in lockstep.
- [ ] A-004 Positional ops retain index semantics: `MoveWindow` takes source `windowID` + numeric `targetIndex`; `MoveWindowToSession` takes source `windowID` + `targetSession`; both preserve the window's ID.
- [ ] A-005 Window-targeting routes keyed by window ID: routes are `/api/windows/{windowId}/...`; create-window stays at `/api/sessions/{session}/windows`; `{windowId}` validated via `ValidateWindowID`.
- [ ] A-006 Window-ID parse helper: `parseWindowID` replaces `parseWindowIndex`, validates via `ValidateWindowID`, handlers return 400 on failure with no tmux call.
- [ ] A-007 Relay keyed by window ID with session resolution: `/relay/{windowId}` validates the ID, resolves the owning session via `display-message`, creates the ephemeral against the resolved session, and selects the window by ID on the ephemeral.
- [ ] A-008 Pane-map enrichment + ProjectRoot keyed by window ID: enrichment join and `dedupEntries` key off window ID; `ProjectRoot` matches `WindowID`.
- [ ] A-009 Frontend client functions take window ID and build `/api/windows/${windowId}/...`; `server` stays first positional; `moveWindow` keeps numeric target, `moveWindowToSession` keeps targetSession.
- [ ] A-010 Relay WS URL uses window ID: terminal client builds `ws(s)://<host>/relay/${windowId}?server=...` with no session segment.
- [ ] A-011 URL window segment + selection matching: `$window` is the windowId; current-window resolution, mount alignment, writeback, sidebar `isSelected`, top-bar "current", and nearest-after-kill all key off windowId (no `String(index)`).
- [ ] A-012 Store unchanged: window store stays keyed by `${server}:${windowId}` with `index` retained for ordering.

### Behavioral Correctness

- [ ] A-013 Reorder does not trigger spurious navigation: viewing `@7`, a reorder shifting its index leaves URL segment `@7` matching `activeWindow.windowId` — no navigation, no terminal reconnect.
- [ ] A-014 Relay rejects unknown/malformed window IDs: unknown ID → WS close `4004`; malformed ID → 400 before upgrade, no tmux call.

### Scenario Coverage

- [ ] A-015 Backend relay integration test attaches by resolved window IDs and each relay sees only its own window's output (no cross-window leak); ephemeral cleanup on close; missing window → 4004.
- [ ] A-016 e2e `sidebar-window-sync`: clicking a window navigates the URL to its windowId and selects the row; switching windows holds selection without bounce-back; companion `.spec.md` updated.

### Edge Cases & Error Handling

- [ ] A-017 Upload handler resolves the target window by windowId form value (validated), falling back to the first window when absent/unmatched, as before.
- [ ] A-018 Old numeric-index URLs are a hard break (no redirect shim) — no back-compat code added.

### Code Quality

- [ ] A-019 Pattern consistency: new code follows surrounding naming/structure (validator style, `tmuxExecServer` usage, client `withServer` helper, optimistic-action patterns).
- [ ] A-020 No unnecessary duplication: reuses `tmuxExecServer`/`withTimeout`, `ValidateWindowID`, existing client helpers; no reimplementation.
- [ ] A-021 Security (constitution §I): all new exec via `exec.CommandContext`/`tmuxExecServer` with argument slices + timeouts; the new `display-message` resolution uses a 5s timeout; `{windowId}` validated before any subprocess use.
- [ ] A-022 No inline tmux construction in handlers; all tmux interaction stays in `internal/tmux/`; no new routes beyond the windowId migration.
- [ ] A-023 Frontend type narrowing: no new `as` casts introduced for the windowId plumbing.

## Notes

- `fab pane map` is an external fab-kit tool (constitution §III) emitting only `session`+`window_index` — the enrichment join bridges index→windowID using the same live `WindowInfo` snapshot rather than expecting a window_id from the tool. See T008.
- `ProjectRoot` has no production callers (the upload handler inlines its own lookup); its signature still changes per spec and its test is updated. The upload route stays session-scoped per Non-Goals; only its `window` form-value semantics change to windowId.
