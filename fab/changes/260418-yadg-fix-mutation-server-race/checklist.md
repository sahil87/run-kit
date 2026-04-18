# Quality Checklist: Fix Mutation APIs Targeting Wrong tmux Server

**Change**: 260418-yadg-fix-mutation-server-race
**Generated**: 2026-04-18
**Spec**: `spec.md`

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
