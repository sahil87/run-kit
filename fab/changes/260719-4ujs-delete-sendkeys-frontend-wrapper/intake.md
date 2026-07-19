# Intake: Delete Unused sendKeys Frontend Client Wrapper

**Change**: 260719-4ujs-delete-sendkeys-frontend-wrapper
**Created**: 2026-07-20

## Origin

Backlog item `[4ujs]` (fab/backlog.md:24), worked by a backlog-cleanup agent in one-shot mode:

> [4ujs] 2026-07-19: Delete the sendKeys frontend client wrapper (app/frontend/src/api/client.ts + its test block) — zero production callers; the backend /keys endpoint stays (possible external callers); chat-send provides the pane-targeted alternative for the only contemplated UI use. (relocated from docs/memory/run-kit/chat.md by /docs-distill-memory)

Validity was verified in-session before intake creation: a `grep -rn sendKeys` across `app/frontend/src/` and `app/frontend/tests/`, plus a NUL-safe `perl` sweep (which catches `session-tiles.tsx`, a file grep silently skips due to a deliberate NUL join), found references only at the definition (`client.ts:197`) and its own test (`client.test.ts:16` import, `:212-223` test body). Zero production callers — the claim holds exactly as written.

## Why

1. **Problem**: `sendKeys` in `app/frontend/src/api/client.ts` is dead code — an exported wrapper for `POST /api/windows/{windowId}/keys` that no production code calls. Its only "coverage" is a test that exercises the wrapper itself, which is test weight spent proving nothing about the product.
2. **Consequence of not fixing**: dead exports invite accidental reuse (the chat-send path is the sanctioned pane-targeted alternative for UI use), inflate the client surface that future refactors (like the `server`-threading change `yadg`) must mechanically drag along, and mislead readers into thinking the UI has a keystroke-injection path.
3. **Why this approach**: straight deletion is the cheapest correct move. The backend endpoint is deliberately NOT touched — it may have external (non-SPA) callers, and the backlog item explicitly scopes it to stay.

## What Changes

### Remove the wrapper — `app/frontend/src/api/client.ts`

Delete the `sendKeys` function (lines 197-212 at time of writing):

```ts
export async function sendKeys(
  server: string,
  windowId: string,
  keys: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/keys`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}
```

Nothing else in `client.ts` changes — `renameWindow` (above it) and `HttpError` (below it) are untouched.

### Remove the test block — `app/frontend/src/api/client.test.ts`

1. Remove `sendKeys` from the import list at line 16.
2. Delete the test `it("sendKeys sends POST /api/windows/:windowId/keys with server query", ...)` (lines 212-223 at time of writing). Neighboring tests (`renameWindow` above, `sendChatMessage` below) are untouched.

### Explicitly out of scope

- **Backend `/keys` endpoint** (`POST /api/windows/{windowId}/keys`, handled in `app/backend/api/`): stays as-is — possible external callers.
- **`docs/specs/api.md`**: specs document the API surface (which is unchanged — the endpoint remains); no spec edit needed.
- **Backend tests for the endpoint**: untouched.

## Affected Memory

- `run-kit/architecture`: (modify) remove the `sendKeys(server, windowId, keys)` row from the frontend API-client table (~line 227); the backend endpoint documentation stays
- `run-kit/tmux-sessions`: (modify) remove `sendKeys` from the window-mutation client-function list (~line 295)

## Impact

- `app/frontend/src/api/client.ts` — one function removed (~16 lines)
- `app/frontend/src/api/client.test.ts` — one import identifier + one test removed (~13 lines)
- No route, component, or backend change. No behavior change for any user-facing feature.
- Verification: frontend type check (`npx tsc --noEmit`) proves zero remaining references at compile time; frontend unit tests (`just test-frontend`) prove the remaining client tests still pass.

## Open Questions

None — the backlog item is fully specified and the dead-code claim was re-verified against current code before intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `sendKeys` has zero production callers today | Verified in-session with grep AND a NUL-safe perl sweep over `app/frontend/src` + `tests` (covers the NUL-joined `session-tiles.tsx` grep blind spot); only the definition and its own test reference it | S:95 R:90 A:95 D:95 |
| 2 | Certain | Backend `POST /api/windows/{windowId}/keys` endpoint stays untouched | Explicit in the backlog item ("the backend /keys endpoint stays — possible external callers") | S:95 R:85 A:95 D:95 |
| 3 | Certain | The test block and its import are removed alongside the wrapper | Explicit in the backlog item ("+ its test block"); leaving the test would break the build after the export is removed | S:90 R:95 A:95 D:95 |
| 4 | Confident | No spec (`docs/specs/api.md`) edit needed | Specs document the HTTP surface, which is unchanged — only the unused SPA-side wrapper is deleted; memory files (architecture, tmux-sessions) that enumerate client functions are updated at hydrate instead | S:70 R:90 A:85 D:80 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
