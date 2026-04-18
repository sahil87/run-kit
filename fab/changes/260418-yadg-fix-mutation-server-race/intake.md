# Intake: Fix Mutation APIs Targeting Wrong tmux Server

**Change**: 260418-yadg-fix-mutation-server-race
**Created**: 2026-04-18
**Status**: Draft

## Origin

> There is a subtle bug during renaming session. Sometimes the rename happens in another tmux server. Take a relook at all rename/create/delete APIs - for such subtle bugs and fix

One-shot intake. No prior conversation — reasoning inferred from the codebase.

## Why

Under the single-active-server model, every mutation API call (rename, create, delete, kill, split, move, color, keys, url/type update, color) carries a `?server=` query parameter. The backend routes the operation via `tmuxExecServer(ctx, server, ...)` to the correct tmux server. The user report says rename sometimes lands on a *different* tmux server than the one the UI appears to be on — which implies `?server=` is wrong at send time.

**Root cause** — the frontend client stores a single module-level getter that points into the live `SessionProvider` state:

```ts
// app/frontend/src/api/client.ts
let _getServer: () => string = () => "runkit";

function withServer(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}server=${encodeURIComponent(_getServer())}`;  // reads live state
}
```

```tsx
// app/frontend/src/contexts/session-context.tsx:32-36
const serverRef = useRef(server);
serverRef.current = server;                        // updated every render
useEffect(() => {
  setServerGetter(() => serverRef.current);        // installed once on mount
}, []);
```

Because `withServer()` dereferences `serverRef.current` at **fetch time** (not at action-initiation time), *any* server switch between "user intent" and "fetch dispatch" silently redirects the mutation to the new server. Concretely:

1. User opens the rename dialog for session `foo` on server A.
2. User switches to server B via sidebar / Cmd+K / route change (flips `serverRef.current` → B).
3. User returns, presses Enter to commit. `renameSession("foo", "bar")` runs; `withServer()` reads B; backend dispatches `tmux -L B rename-session -t foo bar`.
4. If B has a session named `foo`, *that* session is renamed. If B has no `foo`, the API returns an error but the frontend's optimistic rename (keyed by session name, not server) still displays the rename on A — the SSE poll eventually contradicts it, causing flicker/confusion.

**Why it's subtle**: the dialog UI has no visible indication of which server "owns" the pending mutation. A Cmd+K server switch (near-instant and keyboard-driven) is the most likely trigger — the user's hands can easily do: type new name → Cmd+K → pick server → think "wait, I didn't submit yet" → Enter. The optimistic update further hides the bug, because the UI looks correct for ~2–5 s until SSE reconciles.

**If we don't fix it**: the bug compounds with any workflow that routinely toggles servers — pane-CWD tracking, cross-session window moves, or the FAB/AGT flows that spawn windows on named servers. Renames target random sessions; kills nuke the wrong session; creates populate the wrong server. None of it is reliably reproducible in tests today because the race is timing-driven.

**Why thread `server` explicitly over patching the getter**: the backend already takes `server string` as an explicit parameter on every tmux function — the client is the *only* layer using an implicit ambient. Making the client match the backend eliminates an entire class of closure-over-mutable-global bugs and makes the captured server visible at every call site (easier to review, trivial to test).

## What Changes

### 1. API client — explicit `server` parameter on every mutation (and explicit read)

All mutation functions in `app/frontend/src/api/client.ts` SHALL accept `server: string` as the **first** positional argument. `withServer()` SHALL become `withServer(url, server)` — it no longer reads a module-level getter. The `_getServer` module-level state and `setServerGetter()` exports SHALL be removed.

Functions to update (complete list — every `withServer(...)` call site):

| Function | Category |
|----------|----------|
| `getSessions` | read |
| `createSession`, `renameSession`, `killSession` | session mutation |
| `createWindow`, `renameWindow`, `killWindow` | window mutation |
| `moveWindow`, `moveWindowToSession` | window mutation |
| `sendKeys`, `splitWindow`, `closePane`, `selectWindow` | window mutation |
| `updateWindowUrl`, `updateWindowType` | window mutation |
| `setWindowColor`, `setSessionColor` | color mutation |
| `reloadTmuxConfig` | server-scoped |
| `uploadFile` | session-scoped |
| `getKeybindings` | read |

Out of scope (intentionally do NOT take `server`): `listServers`, `createServer`, `killServer`, theme settings, server-color settings (all already global/server-management endpoints).

Example transformation:

```ts
// Before
export async function renameSession(session: string, name: string) {
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/rename`), { ... });
}

// After
export async function renameSession(server: string, session: string, name: string) {
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/rename`, server), { ... });
}
```

### 2. Call sites — capture `server` at action initiation

Every caller SHALL read `server` from `useSessionContext()` and pass it through. The snapshot is taken when the action **is initiated** (dialog submit, button click, drag end) — not lazily at fetch time.

Two capture patterns, both correct:

**Pattern A — inline capture in the handler**:
```tsx
const { server } = useSessionContext();
const handleRenameSession = useCallback(() => {
  if (!renameSessionName.trim() || !sessionName) return;
  const newName = renameSessionName.trim();
  const targetServer = server;  // explicit capture at trigger time
  executeRenameSession(targetServer, sessionName, newName);
  ...
}, [renameSessionName, sessionName, server, executeRenameSession]);
```

**Pattern B — `useOptimisticAction` threads server through**:
```tsx
const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
  action: (server, oldName, newName) => renameSession(server, oldName, newName),
  ...
});
```

Both patterns preserve the current optimistic-update behavior; the only change is that `server` is now an explicit argument to the action rather than resolved from a global.

Call site inventory (identified in Step 1 research):

- `app/frontend/src/hooks/use-dialog-state.ts` — `executeRenameSession`, `executeRenameWindow`, `executeKillSession`, `executeKillWindow`
- `app/frontend/src/components/sidebar/index.tsx` — rename actions, move, color updates
- `app/frontend/src/components/create-session-dialog.tsx` — session create
- `app/frontend/src/components/top-bar.tsx` — session/window create via breadcrumb
- `app/frontend/src/app.tsx` — dialog state wiring
- Any additional callers surfaced by `grep -R "from \"@/api/client\"" app/frontend/src` during implementation

### 3. Optimistic store — key by `(server, sessionName)` where relevant

The optimistic context (`contexts/optimistic-context.tsx`) currently keys ghosts/killed/renamed state by name only. A secondary but related bug: if the user switches servers mid-action, the optimistic overlay can render on the *new* server too (because it's keyed by session name alone). This is a latent issue that the fix SHALL address: optimistic entries SHALL carry the `server` they were created against, and consumers SHALL filter by `(server, name)` before applying the overlay.

Scope: only the `renamed` / `killed` / `ghosts` maps in `optimistic-context.tsx`. Window-store entries (`window-store.ts`) are already keyed by `(session, windowId)` — windows never migrate between servers, so no changes needed there.

### 4. Tests

- Unit test for `withServer(url, server)` — new signature, no ambient state.
- Unit test for `renameSession` / `renameWindow` / `killSession` / `killWindow` / `createSession` / `createWindow` — verify they send `?server=<arg>` (asserting the explicit server argument reaches the URL, not a module-level default).
- React test in `use-dialog-state.test.tsx` (add if missing) — when the session context's `server` value changes between `openRenameDialog` and `handleRename`, the API call SHALL use the server value from `server` at `handleRename` invocation time. A focused regression test that asserts the correct `server` argument is passed.
- Existing `api/client.test.ts` mocks of `renameWindow("run-kit", 1, "new-name")` SHALL be updated to include the server as the first arg, e.g. `renameWindow("runkit", "run-kit", 1, "new-name")`.

### 5. Non-goals

- No change to the backend — `serverFromRequest(r)` already reads `?server=` correctly.
- No change to SSE / WebSocket URL construction — those already build `?server=` inline (not via `withServer()`), and they reconnect on server change, so the bug does not apply.
- No change to server-management endpoints (`listServers`, `createServer`, `killServer`) — these intentionally don't carry a server parameter.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) document that the client threads `server` through every mutation call explicitly; note the retired `_getServer` global and the closure-race rationale.
- `run-kit/ui-patterns`: (modify) record the explicit-capture-at-trigger convention for optimistic actions; add a short "don't introduce ambient state for request parameters" note.

## Impact

**Affected code**:
- `app/frontend/src/api/client.ts` (signatures of ~17 functions; removal of `_getServer`/`setServerGetter`)
- `app/frontend/src/contexts/session-context.tsx` (remove `setServerGetter` usage)
- `app/frontend/src/contexts/optimistic-context.tsx` (key overlays by `server`)
- `app/frontend/src/hooks/use-dialog-state.ts` (thread server through optimistic actions)
- `app/frontend/src/components/sidebar/index.tsx`, `sidebar/session-row.tsx`, `sidebar/window-row.tsx`
- `app/frontend/src/components/top-bar.tsx`, `components/create-session-dialog.tsx`
- `app/frontend/src/app.tsx`
- `app/frontend/src/api/client.test.ts`, any test file importing mutation functions
- Any store that calls API client mutations

**APIs/dependencies**: no new dependencies; public HTTP API surface unchanged (same URLs, same query parameters).

**Systems**: frontend-only change. Backend untouched.

## Open Questions

_None — all open questions resolved during /fab-clarify (see Clarifications)._

## Clarifications

### Session 2026-04-18 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 2 | Confirmed | — |
| 3 | Confirmed | — |
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Confirmed | — |
| 9 | Confirmed | — |

### Session 2026-04-18 (tentative resolution)

| # | Q&A |
|---|-----|
| 7 | Q: Should window-store key by `(server, session, windowId)`? A: No — keep `(session, windowId)`. No cross-server move API; `MoveWindowToSession` stays within one server. |
| 8 | Q: Same PR or split API fix from overlay keying? A: Same PR — intermediate state would still leak overlays across servers. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is stale module-level `_getServer` closure over `serverRef.current` in `api/client.ts` | Confirmed by reading `api/client.ts:5-16` and `session-context.tsx:32-36`; the getter dereferences live state at fetch time, providing no capture boundary | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix by threading `server` as an explicit first positional argument through every mutation API call | Clarified — user confirmed | S:95 R:70 A:85 D:75 |
| 3 | Certain | Read APIs (`getSessions`, `getKeybindings`) also take explicit `server` — for consistency and to remove the global entirely | Clarified — user confirmed | S:95 R:80 A:75 D:70 |
| 4 | Certain | Optimistic overlays in `optimistic-context.tsx` MUST be keyed by `(server, name)` | Clarified — user confirmed | S:95 R:55 A:75 D:70 |
| 5 | Certain | `server` is captured at action-trigger time (inside `onClick`/`onSubmit`/`handleX`), not at component render time | Clarified — user confirmed | S:95 R:65 A:80 D:70 |
| 6 | Certain | Scope is frontend-only; backend `serverFromRequest(r)` is correct | Clarified — user confirmed | S:95 R:85 A:90 D:85 |
| 7 | Certain | Window-store entries keyed only by `(session, windowId)` do NOT need server keying because windows cannot migrate between servers (no cross-server move API exists; `MoveWindowToSession` uses a single `tmuxExecServer` call) | Clarified — user confirmed | S:95 R:50 A:55 D:55 |
| 8 | Certain | The optimistic fix lands in the same PR as the API fix | Clarified — user confirmed | S:95 R:60 A:55 D:50 |
| 9 | Certain | Server-management endpoints (`listServers`, `createServer`, `killServer`) stay as-is — they intentionally don't scope to a server | Clarified — user confirmed | S:95 R:85 A:95 D:90 |

9 assumptions (9 certain, 0 confident, 0 tentative, 0 unresolved).
