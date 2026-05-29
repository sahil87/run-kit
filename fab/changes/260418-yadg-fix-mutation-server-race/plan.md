# Plan: Fix Mutation APIs Targeting Wrong tmux Server

**Change**: 260418-yadg-fix-mutation-server-race
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: API Client — remove ambient state, add explicit server arg

- [x] T001 Edit `app/frontend/src/api/client.ts`: delete the module-level `let _getServer` declaration and the exported `setServerGetter` function. Change `withServer(url: string)` to `withServer(url: string, server: string)` — the second argument becomes required. All internal call sites within `client.ts` that use `withServer(someUrl)` SHALL be updated to forward the `server` they received as the new first positional parameter of each mutation function (this task creates a transient compile error that T002 resolves).
- [x] T002 Edit `app/frontend/src/api/client.ts`: update every exported function listed in spec §"API Client: Explicit Server Parameter" to take `server: string` as its first positional argument. Full list: `getSessions`, `createSession`, `renameSession`, `killSession`, `createWindow`, `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `sendKeys`, `splitWindow`, `closePane`, `selectWindow`, `updateWindowUrl`, `updateWindowType`, `setWindowColor`, `setSessionColor`, `reloadTmuxConfig`, `uploadFile`, `getKeybindings`. Do NOT add `server` to `listServers`, `createServer`, `killServer`, theme-settings, or server-color-settings functions.

## Phase 2: SessionProvider — stop wiring the getter

- [x] T003 Edit `app/frontend/src/contexts/session-context.tsx`: remove the `import { setServerGetter ... }` reference, remove the `serverRef` and the `useEffect(() => setServerGetter(() => serverRef.current), [])` block. Keep the `server` context value and the `serverRef` only if used elsewhere (grep first — if unused after removing the effect, delete it).

## Phase 3: Optimistic Context — key overlays by (server, name)

- [x] T004 Edit `app/frontend/src/contexts/optimistic-context.tsx`: add `server: string` to the `ghosts` (session-type entries), `killed` (session-type entries), and `renamed` entry shapes. Update setter signatures so callers pass `server`: `addGhostSession(server, name)`, `markKilled("session", server, name)` (or a new signature that bundles server as an argument — implementation's call), `markRenamed("session", server, oldName, newName)`, `removeGhost(server, optimisticId)`, `unmarkKilled(server, name)`, `unmarkRenamed(server, name)`. Keep `addGhostServer(name)` and `markKilled("server", name)` without a server arg — they target the server list itself. Update all consumers in the same file (the context's provider) accordingly.
- [x] T005 Update every reader of the optimistic context that renders an overlay to filter by `(currentServer, name)`. Search targets: all files using `useOptimisticContext()` that touch `ghosts`, `killed`, or `renamed` for session-level entries. Read `currentServer` via `useSessionContext().server` in each consumer. <!-- clarified: [P] removed — consumers (sidebar/index.tsx, top-bar.tsx, app.tsx, create-session-dialog.tsx, server-list-page.tsx, use-dialog-state.ts) overlap with Phase 4 tasks T006/T007/T008/T009/T014/T017 which mutate the same files. Execute T005's reader-filter updates as part of the same edit pass within each Phase 4 file rather than as a separate parallel task -->

## Phase 4: Call Sites — capture server at trigger time

- [x] T006 Edit `app/frontend/src/hooks/use-dialog-state.ts`: read `server` from `useSessionContext()`. Change each `useOptimisticAction` instantiation so the action tuple takes `server` as the first element and the `action` callback invokes the API function with the server argument. Thread `server` through `handleRenameSession`, `handleRename` (window), `handleKillSession`, `handleKillWindow`; capture `server` inside each `useCallback`, list it in the deps array. Update the `onOptimistic` / rollback calls on the optimistic context to pass `server` where the new signatures require it.
- [x] T007 [P] Edit `app/frontend/src/components/sidebar/index.tsx`: read `server` from `useSessionContext()`. Update every call to `renameSession`, `renameWindow`, `moveWindow`, `moveWindowToSession`, `setSessionColor`, `setWindowColor`, `getAllServerColors` (if it's actually a server-color-settings call, leave it) and any other mutation API to pass `server` as the first argument. List `server` in the deps of the relevant `useCallback`s.
- [x] T008 [P] Edit `app/frontend/src/components/top-bar.tsx`: read `server` from `useSessionContext()`. Thread it into `splitWindow` and `closePane` calls (confirmed via grep at lines 335, 395) and any other mutation API calls (session/window create via breadcrumb menu). <!-- clarified: top-bar.tsx imports splitWindow and closePane directly — these must be updated in addition to breadcrumb create calls -->
- [x] T009 [P] Edit `app/frontend/src/components/create-session-dialog.tsx`: read `server` and pass it to `createSession`.
- [x] T010 [P] Edit `app/frontend/src/components/iframe-window.tsx`: pass `server` (from `useSessionContext()`) to `updateWindowUrl` (and any other API calls in this file).
- [x] T011 [P] Edit `app/frontend/src/components/keyboard-shortcuts.tsx`: pass `server` to any API calls.
- [x] T012 [P] Edit `app/frontend/src/hooks/use-file-upload.ts`: pass `server` to `uploadFile`.
- [x] T013 [P] Edit `app/frontend/src/components/terminal-client.tsx`: verify — this file does NOT currently import `@/api/client` (grep confirms zero matches for `sendKeys`/`splitWindow`/`closePane`/`selectWindow`/`@/api/client` in terminal-client.tsx). No change expected; leave as-is unless an import is added later. <!-- clarified: terminal-client.tsx has no api/client imports; sendKeys has no frontend call site (test-only); splitWindow/closePane live in top-bar.tsx (T008) and app.tsx (T014); selectWindow lives in app.tsx (T014) -->
- [x] T014 [P] Edit `app/frontend/src/app.tsx`: thread `server` through all direct API-client usages. Confirmed imports at line 22: `selectWindow`, `createSession`, `createWindow`, `splitWindow`, `closePane`, `moveWindow`, `moveWindowToSession`, `reloadTmuxConfig`, `setWindowColor`, `setSessionColor`, `updateWindowType`. Call sites include the command palette `reloadTmuxConfig()` action (line 773) and the `initTmuxConf().then(() => reloadTmuxConfig())` action (line 779), plus `selectWindow` (line 336) and the `splitWindow`/`closePane` optimistic-action definitions (lines 174, 178). `createServer` and `killServerApi` do NOT take `server`. <!-- clarified: app.tsx owns the `reloadTmuxConfig` call site (command palette), not sidebar/server-panel — T015 stays as no-op -->
- [x] T015 [P] Edit `app/frontend/src/components/sidebar/server-panel.tsx`: verify — it calls only server-management APIs (`listServers`, `createServer`, `killServer`); no change expected. `reloadTmuxConfig` is owned by `app.tsx` (see T014), not server-panel. <!-- clarified: reloadTmuxConfig call site confirmed in app.tsx via grep; server-panel.tsx scope stays server-management only -->
- [x] T016 [P] Edit `app/frontend/src/contexts/theme-context.tsx`: theme endpoints are global → no change expected; confirm and leave as-is.
- [x] T017 [P] Edit `app/frontend/src/components/server-list-page.tsx`: server list UI operates globally → no change expected; confirm and leave as-is.

## Phase 5: Tests

- [x] T018 Edit `app/frontend/src/api/client.test.ts`: update every `renameWindow(...)`, `renameSession(...)`, `killSession(...)`, `killWindow(...)`, `createSession(...)`, `createWindow(...)` invocation to include `server` as the first argument. Add at least one test per mutation function asserting the `?server=<arg>` query parameter reflects the argument passed — the test invokes with a distinguishable server name (e.g., `"server-B"`) and asserts the fetched URL contains `?server=server-B` (URL-encoded).
- [x] T019 Add regression test — if `app/frontend/src/hooks/use-dialog-state.test.tsx` exists, extend it; else create it. Scenario from spec §Tests: mount `SessionProvider` with `server="server-A"`, mount `useDialogState`, call `openRenameSessionDialog("foo")`, rerender the provider with `server="server-B"`, call `setRenameSessionName("bar")` then `handleRenameSession()`. Assert the spy on `renameSession` (mocked via `vi.mock("@/api/client")`) sees `("server-B", "foo", "bar")`. Use `@testing-library/react` `renderHook` with a `wrapper` that re-renders with new props.
- [x] T020 [P] Update `app/frontend/src/components/sidebar.test.tsx` — every mocked API call assertion (`renameWindowMock`, `renameSessionMock`, `killSessionMock`, `killWindowMock`, etc.) SHALL update its expected arg list to include `server` as the first arg. The mocks themselves don't need changing — only the `.toHaveBeenCalledWith(...)` assertions.
- [x] T021 [P] Update `app/frontend/src/store/window-store.test.ts` — only if the test exercises API client calls directly. If it mocks or injects only, no change; otherwise align with the new signatures.
- [x] T022 [P] Update `app/frontend/src/components/iframe-window.test.tsx` and any other touched test files whose assertions reference the old arg order.

## Phase 6: Verify

- [x] T023 Run `just test-frontend` from repo root — all unit/Vitest tests MUST pass. Fix any signature mismatches surfaced by `tsc --noEmit && vite build` (which runs as part of `test-frontend` setup). If `just test-frontend` doesn't include typecheck, also run `pnpm --dir app/frontend run build` (tsc + vite) and verify no type errors.
- [x] T024 Run `just test-e2e` if the change risks breaking end-to-end flows (rename/create/delete session, move window). If e2e tests pass without modification, note it. If they fail due to signature drift in helper code, fix.
- [x] T025 Smoke-test manually per spec regression scenario: `RK_PORT=3020 just dev`, open UI, open a rename dialog for a session on server A, switch to server B via the sidebar selector, submit the rename. Verify (via DevTools Network panel or server logs) that the request goes to `?server=server-B`. Then test the corrected behavior: rename without switching servers mid-flight still works.

---

## Execution Order

- T001 → T002 are sequential (T001 breaks compilation, T002 fixes all call sites within `client.ts`).
- T003 depends on T002 (can only delete `setServerGetter` once it's no longer exported/imported).
- T004 is independent of T001-T003 (different file, different concern) but T005 depends on T004.
- T005 can run in parallel with T006–T017 only if each consumer is a distinct file and the optimistic-context type changes from T004 are already in place.
- T006–T017 are parallelizable among each other (each touches a distinct file) but ALL depend on T002 (new API signatures) and T004 (new optimistic-context signatures).
- T018–T022 depend on T002 + T004 + T006 (the complete new shape).
- T023 depends on Phase 1–5 completion.
- T024, T025 depend on T023.

Critical path: T001 → T002 → T004 → (T006 | T018) → T023 → T025.

## Acceptance

## Functional Completeness

- [x] CHK-001 Remove module-level server getter: `_getServer` and `setServerGetter` no longer exist in `app/frontend/src/api/client.ts` (grep returns zero matches)
- [x] CHK-002 `withServer` signature: `withServer(url: string, server: string): string` — the second arg is required and typed `string`
- [x] CHK-003 Every mutation/read function listed in spec takes `server: string` as its first positional argument: `getSessions`, `createSession`, `renameSession`, `killSession`, `createWindow`, `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `sendKeys`, `splitWindow`, `closePane`, `selectWindow`, `updateWindowUrl`, `updateWindowType`, `setWindowColor`, `setSessionColor`, `reloadTmuxConfig`, `uploadFile`, `getKeybindings`
- [x] CHK-004 Server-management endpoints unchanged: `listServers`, `createServer`, `killServer` do NOT take `server` as a parameter; they SHALL NOT append `?server=` to their URLs
- [x] CHK-005 SessionProvider no longer wires a server getter: `setServerGetter` is not imported or called in `app/frontend/src/contexts/session-context.tsx`
- [x] CHK-006 Optimistic overlays carry `server`: `ghosts` (session-type), `killed` (session-type), and `renamed` entries in `optimistic-context.tsx` each have a `server: string` field
- [x] CHK-007 Overlay consumers filter by `(server, name)`: every reader of `useOptimisticContext()` that renders session-level overlays filters by the current `useSessionContext().server` before applying

## Behavioral Correctness

- [x] CHK-008 Request carries the captured server: any mutation API call records `?server=<server-arg>` in the fetched URL (URL-encoded via `encodeURIComponent`)
- [x] CHK-009 Captured-at-trigger semantics: when `SessionProvider`'s `server` prop changes between dialog open and submit, the request uses the **current** server at submit time — not the server at dialog open time
- [x] CHK-010 Optimistic overlays don't leak across servers: a rename/kill/ghost optimistically marked on `server-A` is NOT rendered when the UI context is `server-B`

## Removal Verification

- [x] CHK-011 `_getServer` removed: `grep -r "_getServer" app/frontend/src/` returns no matches
- [x] CHK-012 `setServerGetter` removed: `grep -r "setServerGetter" app/frontend/src/` returns no matches
- [x] CHK-013 No import of `setServerGetter` remains in any test file

## Scenario Coverage

- [x] CHK-014 `renameSession` test asserts the URL contains `?server=<arg>` — covered by `app/frontend/src/api/client.test.ts`
- [x] CHK-015 `renameWindow` test updated to new signature and asserts `?server=<arg>` — covered in `client.test.ts`
- [x] CHK-016 `killSession` / `killWindow` / `createSession` / `createWindow` test updates complete with server query assertion
- [x] CHK-017 Regression test: SessionProvider rerender with changed `server` between `openRenameSessionDialog` and `handleRenameSession` — `renameSession` spy observes `("server-B", "foo", "bar")` and NOT `("server-A", …)`. Location: `app/frontend/src/hooks/use-dialog-state.test.tsx` (added or extended)
- [x] CHK-018 Optimistic overlay scenarios: rename/kill/ghost filtered by `(server, name)` — verified by unit tests on `optimistic-context.tsx` or via consumer-level integration test

## Edge Cases & Error Handling

- [x] CHK-019 Cross-server optimistic overlay isolation: switching servers mid-rename does not leak the optimistic state into the new server's view
- [x] CHK-020 URL-encoding of server names preserved: server names with special characters (e.g., `server with spaces`) are correctly `encodeURIComponent`-ed in the query string (covered by existing `withServer` behavior — verify unchanged)
- [x] CHK-021 `uploadFile` with multipart body still sends `?server=<arg>` correctly (no Content-Type override breakage)

## Code Quality

- [x] CHK-022 Pattern consistency: new first-positional-`server` convention applied uniformly; no mix-and-match with trailing `server` args
- [x] CHK-023 No unnecessary duplication: existing `withServer` helper is the single place that appends `?server=`; no call site bypasses it
- [x] CHK-024 Type narrowing over assertions: if any new type work is needed (e.g., for optimistic entry discriminated unions), prefer `if` guards over `as` casts per `code-quality.md`
- [x] CHK-025 Tests included: every behavioral change ships with a covering test (new features & bug fixes require tests per `code-quality.md`)
- [x] CHK-026 No polling from the client: change does not introduce any `setInterval`+fetch pattern (unrelated to SSE)
- [x] CHK-027 Verification gates run: `cd app/frontend && npx tsc --noEmit` passes; `just test-frontend` passes

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NN **N/A**: {reason}`
