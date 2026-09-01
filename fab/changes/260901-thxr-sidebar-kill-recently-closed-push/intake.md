# Intake: Sidebar Kill Paths Push the Recently-Closed Record

**Change**: 260901-thxr-sidebar-kill-recently-closed-push
**Created**: 2026-09-01

## Origin

Promptless dispatch (`/fab-proceed` create-new), synthesized from an investigation conversation into a user-reported bug:

> Kill window A → ⇧⌘T restores A correctly. Kill A again → ⇧⌘T brings back *a different, older window*. The behavior doesn't mirror Chrome's reopen-closed-tab queue.

The investigation traced the root cause in code and decided the fix; this intake transfers those verified findings. All code claims below were re-verified against the current worktree during intake generation.

## Why

**Problem**: The `Tab: Reopen closed` action (⇧⌘T / palette) reopens the top of a **client-side mirror** of the backend recently-closed ring — and two kill paths never update that mirror, so after a sidebar kill the chord reopens a stale older record ("something else comes back") or silently no-ops on an empty mirror.

**Mechanism (verified)**:

- The backend ring (`{server}.closed/`, cap 10, `internal/snapshot`) is **authoritative** and is updated by EVERY window kill: `api/closed.go` `recordClosedWindow` runs inside `handleWindowKill` before `tmux.KillWindow`, and the kill response carries the record as `closed` (`api/client.ts` `killWindow` returns `Promise<{ ok: boolean; closed?: ClosedWindow }>`).
- The frontend mirror (`app/frontend/src/hooks/use-recently-closed.ts`, module-level `stacks: Map<string, ClosedWindow[]>`) is seeded from `GET /api/windows/closed` only on `useRecentlyClosed(server)` hook mount (AppShell mount / server change). After that it relies on each kill call site pushing the response record via the standalone export `pushRecentlyClosed(server, res.closed)`.
- **Pushing call sites today**:
  - `app/frontend/src/hooks/use-dialog-state.ts:119` — the ⌘W / palette "Tab: Kill" confirm-dialog path (`if (res.closed) pushRecentlyClosed(srv, res.closed);` inside the `action`)
  - `app/frontend/src/app.tsx:2997` — bulk close (`executeBulkClose`)
  - `app/frontend/src/components/board/board-page.tsx:552` — board-page kill
- **NON-pushing call sites (the defect)** — both in `app/frontend/src/components/sidebar/index.tsx`:
  - `executeKillWindow` (~line 529) — ctrl+click window-row kill; its `action` is `(srv, _session, windowId) => killWindowApi(srv, windowId)` and drops the response
  - `executeKillFromDialog` (~line 554) — the sidebar row/flyout kill confirm dialog; its window arm `return killWindowApi(srv, target.windowId);` drops the response

**Consequence if unfixed**: every sidebar-initiated kill records server-side but drifts the mirror — the most common kill surface (the sidebar) is exactly the one that breaks the reopen queue. The prior change that introduced the feature (`260829-11t0-reopen-closed-tab-recently-closed-stack`) explicitly intended the push from "the sidebar kill controls" too (its intake names them among the paths through `handleWindowKill`) — the omission is a gap against its own intake, not a design choice.

**Why this approach**: push `res.closed` at the two missing call sites exactly the way `use-dialog-state.ts` does. `pushRecentlyClosed` is exported standalone for precisely this cross-call-site use (its doc comment: "Exported standalone so kill flows can push with the exact server the response came from, outside any hook's server binding") and dedupes by record id. Alternatives (re-seeding from `GET /api/windows/closed` after every kill, or moving the push into `api/client.ts` `killWindow`) were not chosen: the established per-call-site push pattern is already the codebase convention across three sites, and a client-level push would couple the API client to hook state.

## What Changes

### 1. `executeKillWindow` (sidebar ctrl+click kill) pushes the closed record

`app/frontend/src/components/sidebar/index.tsx` — change the `action` from the response-dropping one-liner to the `use-dialog-state.ts:114-121` shape:

```ts
// before
action: (srv, _session, windowId) => killWindowApi(srv, windowId),

// after (mirrors use-dialog-state.ts executeKillWindow)
action: async (srv, _session, windowId) => {
  const res = await killWindowApi(srv, windowId);
  if (res.closed) pushRecentlyClosed(srv, res.closed);
  return res;
},
```

Import `pushRecentlyClosed` from `@/hooks/use-recently-closed` (the file currently has no import of it). The `srv` used is the per-call captured server (Server Capture Convention — Shape B), never an ambient one.

### 2. `executeKillFromDialog` (sidebar kill confirm dialog) pushes on its window arm

Same file — the window arm of the dialog executor's `action`:

```ts
// before
if (target.type === "window" && target.windowId) {
  return killWindowApi(srv, target.windowId);
}
return killSessionApi(srv, target.session);

// after
if (target.type === "window" && target.windowId) {
  const res = await killWindowApi(srv, target.windowId);
  if (res.closed) pushRecentlyClosed(srv, res.closed);
  return res;
}
return killSessionApi(srv, target.session);
```

(The `action` becomes `async`.) The **session arm is untouched** — sessions have no closed ring; only window kills carry `closed`.

### 3. Unit tests covering the added push behavior

Required per `fab/project/code-quality.md` ("New features and bug fixes MUST include tests covering the added/changed behavior"). Cover both sidebar executors: a kill whose response carries `closed` pushes that record onto the killed window's server mirror (and a response without `closed` pushes nothing). Existing patterns to mirror:

- `app/frontend/src/hooks/use-recently-closed.test.ts` — mirror push/pop/seed behavior tests
- `app/frontend/src/hooks/use-dialog-state.test.tsx` — how the analogous dialog-state kill push is exercised
- sidebar unit suites are colocated (`app/frontend/src/components/sidebar/index.test.tsx`, `index.core.test.tsx`)

No new e2e spec is required: this is state plumbing behind existing UI surfaces; the reopen palette flow already has e2e coverage from the prior change (unit-level verification of the push is the added contract).

### Explicit non-goal (record, do not task)

Agent-window records deliberately SURVIVE plain reopen server-side until the reopen toast's 4s timeout fires `dismissClosedWindow` (`api/closed.go:166-176`; `app.tsx` `reopenClosed`/`dismissRecord`; `toast.tsx` TOAST_DURATION=4000) so the "Resume agent" toast action can still resolve the record. A reload before the toast timeout can leave a consumed record that reseeds later (duplicate reopen offer). This is a known design tradeoff surfaced during the investigation; the user did not ask to change it — out of scope.

## Affected Memory

- `run-kit/ui/dialogs-and-state`: (modify) § Recently-closed mirror — the pushing-call-site list ("the three `use-dialog-state.ts` kill flows and the board route's `executeKillWindow`") gains the two sidebar executors; the § Window Kill instance table's sidebar rows (which also carry a stale `components/sidebar.tsx` path — actual home is `components/sidebar/index.tsx`) can note the push
- `run-kit/ui/sidebar`: (modify) kill-controls coverage — one line noting the ctrl+click and dialog window kills now feed the recently-closed mirror

Server-side memory (`run-kit/layout-snapshots` § Recently-closed window ring) is unaffected — no backend change. `run-kit/ui/keyboard-and-palette` (the stack-gated `Tab: Reopen closed` entry) is unaffected — the gate's behavior contract is unchanged, only its inputs stop drifting.

## Impact

- **Frontend only**: one file changed in `src` (`app/frontend/src/components/sidebar/index.tsx` — two executors + one import), plus unit tests. No backend, API, route, or schema change; no new dependency.
- **Behavioral blast radius**: sidebar window kills (ctrl+click row kill and the row/flyout kill confirm dialog) start updating the reopen mirror; every other kill path already does, so this converges behavior rather than adding a new one. `pushRecentlyClosed` dedupes by record id, so a double push (should any path overlap) is harmless.
- **Risk**: low — the exact pattern already ships at three call sites; the change makes a fourth and fifth.

## Open Questions

- None — the fix, its shape, the test requirement, and the non-goal were all decided during the investigation and verified against the worktree.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = push `res.closed` inside the two sidebar kill executors' `action`s, mirroring `use-dialog-state.ts:119` (await kill, `if (res.closed) pushRecentlyClosed(srv, res.closed)`, return res) | Decided during investigation; pattern verified at three shipped call sites; `pushRecentlyClosed` is exported standalone for exactly this | S:95 R:90 A:95 D:95 |
| 2 | Certain | `executeKillFromDialog`'s session arm stays untouched — only the window arm pushes | Sessions have no closed ring; `killSession` response carries no `closed` | S:90 R:90 A:95 D:90 |
| 3 | Certain | Non-goal recorded, not tasked: agent-record survival until the reopen toast's 4s dismiss (duplicate-reopen-offer-after-reload tradeoff) stays as designed | Explicitly scoped out during investigation — user did not ask to change it | S:95 R:95 A:90 D:95 |
| 4 | Confident | Unit-test placement: colocated per project test strategy, mirroring `use-recently-closed.test.ts` / `use-dialog-state.test.tsx` patterns (extend the sidebar suites or a focused colocated test — apply's call) | Test requirement is mandated (code-quality MUST); exact file placement has a clear colocation convention with minor latitude | S:70 R:90 A:85 D:65 |
| 5 | Confident | No new Playwright e2e spec — unit tests around the executors' push suffice | State plumbing behind existing surfaces; reopen flow e2e exists from 260829-11t0; code-quality's e2e clause is SHOULD/where-possible | S:65 R:85 A:80 D:70 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
