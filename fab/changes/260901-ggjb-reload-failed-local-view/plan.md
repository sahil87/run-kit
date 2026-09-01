# Plan: Reload Failed Local View on Connect

**Change**: 260901-ggjb-reload-failed-local-view
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Local Connect Reload Gate

#### R1: The local connect tail reloads a failed view
`connectLocalHost` (`app/desktop/src/main.ts`) MUST, after the host entry is activated through `switchToHost`, reload that (window, host) view when its `viewLoadFailed` flag is `true`, clearing the flag as part of the reload. The reload target SHALL be `host.url + (host.lastPath ?? "")` — the same target the SSH-remote heal uses.

- **GIVEN** a window whose local-host view sits on Chromium's `ERR_CONNECTION_REFUSED` error page (the daemon was down when the view was created)
- **WHEN** the user runs the Local Daemon submenu's Connect, or the welcome card's Start & connect, and the daemon answers `/api/health`
- **THEN** the view reloads to `url + lastPath` and its `viewLoadFailed` entry becomes `false`
- **AND** the window shows the SPA rather than the error page

#### R2: A healthy view is never reloaded
The gate MUST NOT navigate a view whose last main-frame load succeeded, and MUST NOT navigate a view whose `webContents` is destroyed. The warm detach/attach flip stays the instant, state-preserving switch the view model depends on.

- **GIVEN** a window whose local-host view holds a live SPA (live `/ws/state` subscription, live terminal relays, xterm scrollback)
- **WHEN** the user runs Connect against the already-running daemon
- **THEN** no `loadURL` is issued and the renderer state survives untouched

#### R3: The reload gate is one shared tail, not a second copy
The flag check → view lookup → liveness check → flag clear → `loadURL` sequence MUST exist in exactly ONE place in `main.ts`, consumed by both heals: the SSH-remote tunnel heal (`ensureRemoteConnected`) and the local connect tail (`connectLocalHost`). Duplicating the block satisfies R1 but violates the project's no-duplication rule, so a shared helper is mandatory rather than optional.

- **GIVEN** the shell has two connect paths that can face a view stranded on an error page
- **WHEN** either path completes successfully
- **THEN** both call the same reload-gate function, and `grep` finds exactly one `viewLoadFailed.set(key, false)` reload site

#### R4: The gate runs on the activate branch only
The gate SHALL be invoked on `connectLocalHost`'s **existing-entry** branch (the branch that activates an already-registered origin through `switchToHost`), and SHALL NOT be invoked on the add-host branch. A newly added host carries a fresh id, so no view exists for it, `attachHostView` creates one and navigates it, and its flag is unset — a gate call there is provably dead code, not a safety net.

- **GIVEN** a machine with no `hosts.json` entry for the local origin
- **WHEN** the user runs Start & connect and the entry is added
- **THEN** the fresh view loads its URL at creation and no reload-gate call is made

### Non-Goals

- Auto-reloading a failed view on any path other than a user-initiated connect — the viewer constitution's explicit-action-only posture is untouched, and no polling or watcher is introduced.
- Fixing the sibling UX gaps (dead-host interstitial, daemon-menu affordances) — those are change `260901-ijiz-dead-host-interstitial-daemon-menu`.
- Fixing the recorded known gap that the reload target is the *captured* `lastPath` rather than the view's current route. R1 deliberately inherits that behavior; a failed view is on the error page, where the captured path is the right target.
- A new test file for `main.ts` glue — see Design Decisions.

### Design Decisions

#### The reload gate is a shared main-side helper, not a mirrored block

**Decision**: Extract the remote heal's inline reload gate into one `reloadFailedView(windowId, host)` function in `main.ts`, and call it from both `ensureRemoteConnected` and `connectLocalHost`.
**Why**: The gate needs the live `views` registry and a `webContents.isDestroyed()` probe, so it is impure glue that belongs in `main.ts` beside the `viewLoadFailed` map it owns — but a second verbatim copy of a five-line stateful sequence is exactly the duplication `fab/project/code-quality.md` names as an anti-pattern, and it would give the two heals two places to drift. One function also makes the flag's write set enumerable: the map is set by the pure transition wiring and cleared by this one gate.
**Rejected**: Copying the block into `connectLocalHost` (the intake's literal "mirror verbatim" reading) — pattern-consistent on first read, but it doubles the sequence and leaves the next consumer (the sibling `ijiz` interstitial) a third copy to make. Also rejected: pushing the gate into `views.ts` as a pure decision — the decision content reduces to `failed && alive`, so a test over it would assert a tautology while the impure lookup stayed in `main.ts` anyway.
*Introduced by*: 260901-ggjb-reload-failed-local-view

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `reloadFailedView(windowId: number, host: { id: string; url: string; lastPath?: string }): void` to `app/desktop/src/main.ts`, placed beside the `viewLoadFailed` map declaration (~line 209): return early unless the `viewKey(windowId, host.id)` flag is `true`; resolve the entry via `getView(views, windowId, host.id)`; return unless the entry exists and its `handle.webContents` is not destroyed; set the flag `false` and `void entry.handle.webContents.loadURL(host.url + (host.lastPath ?? ""))`. Carry a doc comment stating the invariant a reader cannot see — that a view whose last load SUCCEEDED is never touched, and why the captured `lastPath` is the right target. <!-- R3 -->
- [x] T002 Repoint the SSH-remote heal at the shared helper: in `ensureRemoteConnected` (`app/desktop/src/main.ts`, ~lines 1202–1209) replace the inline flag/liveness/reload block with `reloadFailedView(windowId, host)`, leaving the surrounding `markRemoteConnected` / in-flight-set choreography and the function's doc comment intact. <!-- R3 -->
- [x] T003 Wire the local connect tail: in `connectLocalHost` (`app/desktop/src/main.ts`, ~line 970) change the existing-entry branch to hold `switchToHost`'s result, call `reloadFailedView(win.id, existing)` only when that result is `ok`, and return the result; leave the add-host branch unchanged. Extend the function's doc comment to record that the tail heals a view stranded on an error page by a daemon that was down at view-creation time. <!-- R1, R2, R4 -->

### Phase 2: Verification

- [x] T004 Run the desktop gates from `app/desktop`: `pnpm run compile` (tsc) then `pnpm test` (`node --test dist/**/*.test.js`) — both MUST be green. No new test file is added (see Design Decisions / Assumption 3); the pure transition `nextLoadFailed` and `getView` keep their existing `views.test.ts` coverage. <!-- R1, R2, R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `connectLocalHost` reloads the activated view to `url + (lastPath ?? "")` and clears its `viewLoadFailed` entry whenever that entry was `true`.
- [x] A-002 R3: Exactly one reload-gate site exists in `app/desktop/src/main.ts` — `reloadFailedView` — and both `ensureRemoteConnected` and `connectLocalHost` call it.
- [x] A-003 R4: The gate is called on the existing-entry branch only; the add-host branch is byte-unchanged apart from surrounding context.

### Behavioral Correctness

- [x] A-004 R2: No `loadURL` is issued for a view whose flag is absent/`false`, nor for a view whose `webContents.isDestroyed()` is `true` — both are early returns before the flag is cleared.
- [x] A-005 R3: The remote heal's observable behavior is unchanged by the extraction — same order of operations (flag check → entry lookup → liveness → clear → load), still inside the post-`markRemoteConnected` tail, still inside the in-flight `finally` guard.

### Scenario Coverage

- [x] A-006 R1: The daemon-started-from-a-terminal path is covered by construction — the gate sits on the connect tail, not on the `rk daemon start` branch, so a probe that reports `running` still reaches it.
- [x] A-007 R2: `views.test.ts` still passes unchanged, so the `did-finish-load` no-op that keeps the flag alive across Chromium's error page remains regression-covered.

### Edge Cases & Error Handling

- [x] A-008 R1: A failed `switchToHost` (unknown host) short-circuits before the gate — no reload is attempted against a view that was never attached.
- [x] A-009 R2: A `loadURL` rejection stays a floating `void` exactly as in the remote arm — no new error surface, no dialog.

### Code Quality

- [x] A-010 Pattern consistency: `reloadFailedView` follows the file's existing shape for main-side glue — early returns, `viewKey` composite, `getView` over the registry, doc comment stating the constraint rather than narrating the code.
- [x] A-011 No unnecessary duplication: the reload sequence exists once; no second copy of the flag/liveness/loadURL block remains.
- [x] A-012 Comment discipline: added comments state invariants and cross-file contracts only — no next-line narration, no reviewer address, no change ID or PR number (`fab/project/code-quality.md` § Anti-Patterns).
- [x] A-013 Type narrowing: the entry and liveness checks use `if` guards, not `as` casts.
- [x] A-014 No new state: no new map, IPC channel, preload surface, store field, or timer is introduced — the change is one function plus one call site.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Memory update (`docs/memory/run-kit/desktop-shell.md` § Local Daemon Control and § SSH Remote Hosts) is hydrate's work, not apply's.

## Deletion Candidates

- None — this change centralizes the existing reload gate and adds its local consumer without making other code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extract the gate into one `reloadFailedView` helper in `main.ts` rather than mirroring the block into `connectLocalHost` | Intake assumption 1 fixes the gate's *mechanics*; the placement is settled by `code-quality.md`'s explicit "Duplicating existing utilities" anti-pattern, and the helper keeps the sequence byte-identical | S:85 R:90 A:95 D:85 |
| 2 | Certain | Invoke the gate on the existing-entry branch only, not after both branches | A newly added host has a fresh id ⇒ no view ⇒ `attachHostView` creates and navigates it ⇒ flag unset; the intake itself calls the add-branch case "naturally a no-op", so the call there is dead code | S:85 R:95 A:90 D:85 |
| 3 | Confident | No new test file; verification is `pnpm run compile` + `pnpm test` in `app/desktop` | Intake assumption 4 — `main.ts` imports electron at module top and is not loadable under `node --test`; the extracted glue is impure by nature and the pure pieces it uses are already covered in `views.test.ts` | S:70 R:85 A:80 D:70 |
| 4 | Confident | Gate on `switchToHost`'s `ok` result rather than calling unconditionally after it | An unknown-host failure means no view was attached; reloading then would act on a stale or absent entry. Cheap guard, no behavior cost on the success path | S:65 R:90 A:85 D:75 |

4 assumptions (2 certain, 2 confident, 0 tentative).
