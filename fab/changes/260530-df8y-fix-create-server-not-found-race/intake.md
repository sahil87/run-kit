# Intake: Fix Transient "Server not found" Flash After Server Create

**Change**: 260530-df8y-fix-create-server-not-found-race
**Created**: 2026-05-30
**Status**: Draft

## Origin

Initiated from a `/fab-discuss` session investigating a UI bug. When the user creates a new tmux server via the command palette ("Server: Create") and the UI navigates to it, a terminal error screen flashes:

> **Server not found** — No tmux server named `<name>` was found. [Go to server list]

The user expects a brief waiting/loading state instead. Currently they must click "Go to server list" and navigate back before the freshly-created server appears.

The discussion traced the code path end-to-end and confirmed the root cause is **entirely frontend** — the backend create is synchronous and correct. Two design decisions were settled with the user (see Assumptions #1, #2) and a mechanism was agreed (pending-server marker + three-way route guard). This is a one-shot `/fab-new` from a fully-synthesized discussion summary; the intake encodes those decisions verbatim.

## Why

**Problem.** Creating a server is a first-class, keyboard-first flow (command palette → "Server: Create"). The moment the user creates a server and the UI navigates to `/$server`, they are greeted with a hard error screen ("Server not found") even though the server was created successfully. It is jarring, looks like a failure, and forces a manual round-trip ("Go to server list" → click the new server) to reach the working state.

**Consequence if unfixed.** Every server creation looks broken. The error screen actively misleads — it implies the create failed when it succeeded. Users lose trust in the create flow and adopt a superstitious "click away and back" workaround.

**Why this approach.** The backend `POST /api/servers` is *synchronous* — `handleServerCreate` (`app/backend/api/servers.go`) calls `s.tmux.CreateSession` (`app/backend/internal/tmux/tmux.go`), which blocks until `tmux new-session` completes. So the tmux server genuinely exists by the time the POST resolves. The bug is two stacked **frontend** defects:

1. **The server list is a one-time fetch, never refreshed after create.** In `app/frontend/src/contexts/session-context.tsx`, `fetchServers()` calls `listServers()` once on mount via an empty-dependency `useEffect` (lines ~158-169) and only re-runs when `refreshServers()` is explicitly called. The create handler `handleCreateServer` (`app/frontend/src/app.tsx`, lines ~606-613) navigates to the new server but **never** calls `refreshServers()` and **never** marks the new server pending. The cached `servers` array stays stale — the new server may not appear until a manual reload.

2. **The "not found" route guard can't tell "list still loading / mid-refresh" from "genuinely absent".** In `app/frontend/src/app.tsx` (lines ~1018-1021) the guard is:

   ```ts
   // Server not found check — once server list loads, verify server exists
   if (servers.length > 0 && !servers.some((s) => s.name === server)) {
     return <ServerNotFound serverName={server} />;
   }
   ```

   It uses `servers.length > 0` as a proxy for "list has loaded". But when the user *already has at least one server*, `servers.length > 0` is already true while the list is stale, so the guard fires **immediately** for the just-created server. (This is exactly why the screenshot showed `test2` failing — pre-existing servers meant there was no loading grace period.)

The agreed fix repairs both defects at their source: refresh the list after create, and give the guard a third state ("provisioning") so it never fires transiently for a server the user just created — without introducing an artificial timer.

## What Changes

Frontend-only. Backend untouched (synchronous create is already correct). The mechanism is a **"pending server" marker** in `SessionContext` plus a **three-way route guard** in `AppShell`.

### Change 1 — `SessionContext` gains a pending-server marker

`app/frontend/src/contexts/session-context.tsx`

Add `pendingServer` state (a `string | null`) plus a setter/helper to the context value, alongside the existing `servers` / `refreshServers`. Suggested shape:

```ts
// in the context type
pendingServer: string | null;
markServerPending: (name: string) => void;   // sets pendingServer = name
// (clearing is handled by the guard/effect once the server appears — see Change 4)
```

The `markServerPending` setter and `pendingServer` value are threaded through the same provider value object that currently exposes `servers` and `refreshServers` (and through the default/fallback context value so consumers reading outside a provider get safe no-ops, matching the existing `refreshServers: () => {}` fallback at session-context.tsx ~line 445).

### Change 2 — `handleCreateServer` marks pending + refreshes, then navigates

`app/frontend/src/app.tsx` (~line 606)

Current handler navigates but does neither refresh nor mark-pending — that is the core bug:

```ts
const handleCreateServer = useCallback(() => {
  const trimmed = createServerName.trim();
  if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
  executeCreateServer(trimmed);
  navigate({ to: "/$server", params: { server: trimmed } });
  setShowCreateServerDialog(false);
  setCreateServerName("");
}, [createServerName, navigate, executeCreateServer]);
```

After `executeCreateServer(trimmed)`, the handler MUST `markServerPending(trimmed)` AND trigger `refreshServers()`, THEN navigate. The waiting state applies ONLY to the server the user just created (keyed on `pendingServer`).

**Wiring (resolved — see Assumption #5):** `executeCreateServer` is built from `useOptimisticAction` (`app/frontend/src/app.tsx` ~line 587, with `onOptimistic`/`onRollback`/`onError`/`onSettled` callbacks already present). Hang `refreshServers()` (and the pending-clear) on a `useOptimisticAction` success/completion hook (e.g. `onSettled`) IF that hook exists on the current API — preferred, because it ties the refresh to actual create success; otherwise fall back to doing it imperatively in `handleCreateServer` after `executeCreateServer`. The exact hook is to be confirmed by reading the `useOptimisticAction` implementation at apply — a small either/or with no product impact. `onError` already rolls back the ghost, so a failed create MUST NOT leave a dangling `pendingServer`.
<!-- clarified: refreshServers + pending-clear wiring — prefer a useOptimisticAction completion hook (e.g. onSettled) if present, else imperative in handleCreateServer; exact hook confirmed at apply (Assumption #5) -->

### Change 3 — Three-way route guard + `ServerWaiting` component

`app/frontend/src/app.tsx` (guard at ~line 1018; new component sibling to `ServerNotFound` at ~line 96)

Replace the binary guard with three-way logic. When `server` is not in `servers`:

- **`server` IN list** → render the server view (and clear `pendingServer` if it matches — see Change 4).
- **`server` NOT in list AND `server === pendingServer`** → render a new `ServerWaiting` component (the brief "Creating… / waiting for `<name>`" state).
- **`server` NOT in list AND `server !== pendingServer` AND the list has loaded** → render `ServerNotFound` immediately (no artificial delay, so a typo'd URL still fails fast).

`ServerWaiting` is a new component sibling to `ServerNotFound` (`app/frontend/src/app.tsx` ~lines 96-112), a spinner/"Creating…" loading state. It SHOULD reuse the existing centered-full-screen layout idiom from `ServerNotFound` (`flex flex-col items-center justify-center h-screen ... bg-bg-primary`) and an existing spinner if one is available (e.g. the `LogoSpinner` referenced by ServerPanel in `docs/memory/run-kit/ui-patterns.md`).

Note on "list has loaded" (resolved — see Assumption #6): the current `servers.length > 0` proxy is part of the bug. Add an explicit `serversLoaded` boolean to `SessionContext`, set true after the first `fetchServers()` resolves (even to an empty list). The route guard MUST use `serversLoaded` — NOT `servers.length > 0` — to decide whether the list has loaded, so the not-found branch never fires before the first fetch resolves.
<!-- clarified: list-loaded signal — add an explicit serversLoaded boolean (true after first fetchServers() resolves, even empty) and gate the not-found branch on it instead of the buggy servers.length > 0 proxy (Assumption #6) -->

### Change 4 — Clear pending once the server appears

`app/frontend/src/app.tsx` (in the guard or a dedicated effect)

Once the refreshed list contains `pendingServer`, clear it (set `pendingServer = null`). This ensures a *later* genuine deletion of that same server correctly shows "Server not found" again rather than spinning on a stale pending marker. Clearing on appearance (rather than on a timer) is the key to swapping waiting → view automatically when the refresh lands.

### Bounded fallback — OMITTED for v1 (resolved — see Assumption #7)

The optional ~5s bounded-fallback timeout (surface an error if `pendingServer` never resolves) is OMITTED for v1. Given the synchronous, near-instant backend create, a timer is speculative complexity, and a polling loop would violate the no-client-polling anti-pattern (constitution / code-quality: "no `setInterval` + fetch"). The waiting state simply persists until the refreshed list contains the server. This can be added later if real latency ever appears; if it is, it MUST use a single `setTimeout` guard, never a polling loop.
<!-- clarified: bounded-fallback timeout omitted for v1 — synchronous near-instant backend makes a timer speculative; waiting persists until the refreshed list contains the server (Assumption #7) -->

## Affected Memory

- `run-kit/ui-patterns`: (modify) — record the create-server → pending-marker → waiting-then-view pattern and the three-way route-guard distinction (loading vs provisioning vs genuinely-not-found). Likely a new subsection under § URL Structure / "Server not found", documenting `ServerWaiting` alongside `ServerNotFound` and the `pendingServer` context field. The server-list-fetch lifecycle (one-time fetch + explicit refresh, no SSE for the list) should be noted here too.
- `run-kit/architecture`: (modify, conditional) — only if the server-list-fetch lifecycle (one-time `listServers()` on mount, explicit `refreshServers()`, NOT part of the per-server SSE stream) is documented there and needs the post-create-refresh contract added. Spec to confirm whether architecture.md already covers the server-list fetch; if not, ui-patterns is the sole home.

## Impact

- **Frontend only.**
  - `app/frontend/src/contexts/session-context.tsx` — new `pendingServer` state + `markServerPending` in the context type, provider value, and default/fallback value.
  - `app/frontend/src/app.tsx` — `handleCreateServer` (refresh + mark pending), the route guard (~line 1018, three-way), a new `ServerWaiting` component (sibling to `ServerNotFound`), and pending-clear logic.
- **Backend: untouched.** `POST /api/servers` (`app/backend/api/servers.go` `handleServerCreate`) and `CreateSession` (`app/backend/internal/tmux/tmux.go`) are already synchronous and correct.
- **No SSE changes.** The server list is NOT part of the SSE stream (SSE streams per-server sessions only); it is the one-time fetch + explicit refresh described above.
- **No new routes** (Principle IV preserved). **No database/state store** (Principle II preserved — `pendingServer` is transient in-memory UI state, not persisted). **Keyboard-first command-palette create flow unchanged** (Principle V). **No new config** (Principle VII).

### Tests (required — this is a fix; `code-quality.md` mandates tests for changed behavior)

- **`session-context` unit test** (`*.test.tsx`, colocated) — asserts `markServerPending` sets `pendingServer` and that it is exposed through the context value (and the fallback no-op).
- **`app.tsx` / route-guard test** asserting the three-way state:
  - (a) the just-created server shows `ServerWaiting` while absent from the list, then swaps to the server view once the refreshed list includes it (and `pendingServer` clears);
  - (b) a genuinely-unknown server name still shows `ServerNotFound` **immediately** when the list is loaded;
  - (c) (recommended) before the first fetch resolves, neither error nor waiting fires spuriously for an unknown name (the "loaded" signal gates not-found).
- **Playwright e2e** SHOULD cover the create → waiting → view flow if feasible (per code-quality "UI changes SHOULD include Playwright e2e tests"); any new `*.spec.ts` requires a sibling `*.spec.md` (constitution: Test Companion Docs).

## Open Questions

All previously open questions are RESOLVED (user-confirmed). Retained here for traceability:

- ~~Should `useOptimisticAction` expose an `onSuccess` hook for the refresh, or is the existing `onSettled` (or imperative call in `handleCreateServer`) the right site?~~ RESOLVED (Assumption #5): hang the refresh + pending-clear on a `useOptimisticAction` completion hook (e.g. `onSettled`) if present, else imperative in `handleCreateServer`; confirm the exact hook by reading the implementation at apply.
- ~~What is the canonical "server list has loaded" signal that replaces the buggy `servers.length > 0` proxy?~~ RESOLVED (Assumption #6): add an explicit `serversLoaded` boolean (true after the first `fetchServers()` resolves, even to an empty list) and gate the not-found branch on it.
- ~~Include the optional ~5s bounded-fallback timeout, or ship without it given the synchronous backend?~~ RESOLVED (Assumption #7): OMIT for v1; the waiting state persists until the refreshed list contains the server. Can be added later (single `setTimeout`, never polling) if real latency appears.

## Clarifications

### Session 2026-05-30

| # | Question | Resolution |
|---|----------|------------|
| 5 | Wire `refreshServers()` + pending-clear via a `useOptimisticAction` hook or imperatively? | Prefer a completion hook (e.g. `onSettled`) if present, else imperative in `handleCreateServer` after `executeCreateServer`; confirm the exact hook by reading the implementation at apply. Upgraded to Certain. |
| 6 | Canonical "server list loaded" signal replacing `servers.length > 0`? | Add an explicit `serversLoaded` boolean (true after the first `fetchServers()` resolves, even to an empty list); the guard MUST use it instead of the buggy proxy. Upgraded to Certain. |
| 7 | Include the optional ~5s bounded-fallback timeout for v1? | OMIT for v1 (synchronous near-instant backend; a timer is speculative and a polling loop is an anti-pattern). Waiting persists until the refreshed list contains the server. Upgraded to Certain. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Landing UX = a BRIEF WAITING STATE ("Creating… / waiting for `<name>`") after create, swapping to the server view once the server appears in the refreshed list. | Discussed — user explicitly chose "Brief waiting state" over an instant optimistic-insert no-spinner approach. Settled, not open. | S:95 R:75 A:90 D:95 |
| 2 | Certain | Keep the existing "Server not found" screen for genuinely-bad URLs (typo, deleted server), but fix it so it NEVER fires transiently during/after a legitimate create. | Discussed — user explicitly chose "Keep, but fix the race" over reworking it into a generic waiting+timeout for all unknown servers. Settled. | S:95 R:70 A:90 D:95 |
| 3 | Certain | Mechanism = a `pendingServer` marker in `SessionContext` + a three-way route guard (in list → view; not-in-list & === pending → waiting; not-in-list & !== pending & loaded → not-found). Waiting applies only to the just-created server. | Discussed — this is the exact agreed design that honors both Decisions A and B without an artificial timer. Grounded in the real code (session-context.tsx servers/refreshServers; app.tsx guard ~line 1018; ServerNotFound ~line 96). | S:90 R:55 A:85 D:90 |
| 4 | Certain | Change is frontend-only; backend `POST /api/servers` → `CreateSession` is synchronous and correct, so the tmux server exists by the time the POST resolves. | Confirmed by tracing servers.go `handleServerCreate` and tmux.go `CreateSession` during the discussion and re-verified against the working tree. Backend stays untouched. | S:95 R:80 A:95 D:95 |
| 5 | Certain | Hang `refreshServers()` + pending-clear on a `useOptimisticAction` success/completion hook (e.g. `onSettled`) if that hook exists on the current API; else do it imperatively in `handleCreateServer` after `executeCreateServer`. Exact hook to be confirmed by reading the `useOptimisticAction` implementation at apply — a small either/or with no product impact. | Clarified — user confirmed. Low blast radius (single handler), easily reversed; either wiring site is acceptable. | S:95 R:70 A:60 D:50 |
| 6 | Certain | Add an explicit `serversLoaded` boolean to `SessionContext`, set true after the first `fetchServers()` resolves (even to an empty list). The route guard MUST use `serversLoaded` instead of the buggy `servers.length > 0` proxy to decide whether the list has loaded — the root-cause fix for "can't distinguish loading from genuinely-absent". | Clarified — user confirmed. Resolves the defect at its source; reversible, localized to the context + guard. | S:95 R:65 A:65 D:55 |
| 7 | Certain | OMIT the optional ~5s bounded-fallback timeout for v1. The synchronous, near-instant backend create makes a timer speculative complexity (and a polling loop would violate the no-client-polling anti-pattern). The waiting state simply persists until the refreshed list contains the server; can be added later if real latency ever appears. | Clarified — user confirmed (decision = omit). Reversible to add later; respects the no-client-polling rule. | S:95 R:75 A:70 D:55 |
| 8 | Confident | `ServerWaiting` reuses the centered full-screen layout idiom of `ServerNotFound` and an existing spinner (e.g. `LogoSpinner`) rather than introducing new layout primitives. | Strong codebase signal — ServerNotFound's layout (`flex flex-col items-center justify-center h-screen bg-bg-primary`) and `LogoSpinner` (per ui-patterns memory) are the established patterns; one obvious interpretation. Cheap to adjust. | S:75 R:80 A:80 D:80 |
| 9 | Confident | Tests: a session-context unit test for the pending-server state + an app.tsx/route-guard test asserting the three-way behavior (waiting-then-swap, immediate not-found for unknown). Playwright e2e if feasible (with sibling `.spec.md`). | code-quality.md mandates tests for changed behavior; the test shape was described concretely in the discussion. Standard project test conventions answer the "how". | S:80 R:85 A:85 D:80 |
| 10 | Confident | Memory impact: modify `run-kit/ui-patterns` (pending-marker + three-way guard + server-list fetch lifecycle); touch `run-kit/architecture` only if it already documents the server-list fetch. | Discussed affected-memory mapping; ui-patterns is clearly the primary home (it already documents the "Server not found" page and URL structure). Architecture touch is conditional but low-stakes. | S:75 R:80 A:80 D:75 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
