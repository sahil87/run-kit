# Intake: Reload Failed Local View on Connect

**Change**: 260901-ggjb-reload-failed-local-view
**Created**: 2026-09-01

## Origin

Conversational (`/fab-discuss` session, 2026-09-01). The user reported: after a machine reboot, opening the desktop shell shows a blank black screen (no run-kit server running), and `Hosts → Local Daemon → Connect` does nothing — the only recovery was `rk daemon restart --full` in a terminal. Investigation during the discussion found a concrete bug on the local connect path, distinct from the broader UX gaps (those are the sibling change `260901-ijiz-dead-host-interstitial-daemon-menu`). The user approved splitting into two changes: "yes, you can do this via two changes."

> On a local machine, if you restart your comp, when you restart run-kit — you see a blank black screen — because no run-kit server is running. Then when you go to Hosts > Local Daemon > "Connect", nothing happens.

## Why

**Problem.** `attachHostView` (app/desktop/src/main.ts) navigates a `WebContentsView` only at creation — that is the deliberate design that makes warm host switches instant. But when a restored window's local-host view loads while the daemon is down, the view commits Chromium's `ERR_CONNECTION_REFUSED` error page and then **never reloads**. The shell already tracks this per view (`viewLoadFailed`, a `(windowId, hostId)`-keyed map fed by the pure `nextLoadFailed` transition in `src/views.ts`), and the SSH-remote arm already consumes it: `ensureRemoteConnected` (main.ts:1203–1208) reloads the view after a successful tunnel heal when `viewLoadFailed.get(key) === true`. The **local arm has no equivalent consumer**. `startAndConnectLocal` → `connectLocalHost` → `switchToHost` → `attachHostView` finds the existing view and performs a warm no-op flip onto the same dead error page.

**Consequence.** Even when Connect fully succeeds — daemon starts, `/api/health` answers — the window stays black. This is the literal "Connect does nothing" the user observed, and it also produces the dissonant state where the Local Daemon menu status reads `● running · v{X}` while the window shows nothing. Any daemon started from a terminal has the same symptom: the already-created view sits on the error page until the app is relaunched.

**Approach.** Port the remote heal's reload gate to the local connect tail. The gate, the pure transition, and the cache-clearing lifecycle (`viewLoadFailed.delete` on view destruction) all exist; this change adds the one missing consumer. No new state, no new IPC, no polling — the viewer constitution (no auto-start, explicit-action-only subprocess use) is untouched because the reload happens only inside the existing user-initiated connect flow after health has answered.

## What Changes

### Local connect reloads a failed view (`app/desktop/src/main.ts`)

`connectLocalHost(win, origin, hostname)` currently resolves-or-adds the host entry and calls `switchToHost`. After the switch resolves the target host id, the flow MUST check `viewLoadFailed` for `(win.id, hostId)` and, when `true`, mirror the remote heal verbatim (main.ts:1203–1208 pattern):

```ts
const key = viewKey(win.id, hostId);
if (viewLoadFailed.get(key) === true) {
  const entry = getView(views, win.id, hostId);
  if (entry && !entry.handle.webContents.isDestroyed()) {
    viewLoadFailed.set(key, false);
    void entry.handle.webContents.loadURL(host.url + (host.lastPath ?? ""));
  }
}
```

Placement detail: `connectLocalHost` is the shared connect tail for both consumers (the welcome card's `daemon:start` IPC and the menu's Connect item), so putting the gate there covers both paths with one edit. The gate runs **after** `switchToHost` (the view must exist and be attached; a just-created view loaded fresh and its flag is unset, so the gate is naturally a no-op on the add-host branch).

Reload target: `url + (lastPath ?? "")` — the same target the remote heal uses. The known remote-arm caveat (a user who navigated after the failure is sent back to the captured path) is accepted here identically: a failed local view is on the error page, where the captured path is the right target.

### Behavior contract

- GIVEN a window whose local-host view sits on a failed main-frame load (daemon was down), WHEN the user runs the menu's Connect (or the welcome card's Start & connect in another window) and the daemon comes up healthy, THEN the failed view reloads to `url + lastPath` and the flag clears.
- GIVEN the same connect flow with a view whose last load succeeded (live SPA), THEN no reload occurs — the warm-flip state preservation is untouched.
- GIVEN the daemon was started from a terminal and the user clicks Connect, THEN the probe reports running, no `rk daemon start` runs, and the failed view still reloads (the gate is on the connect tail, not the start branch).

### Tests

`main.ts` is not loadable under `node --test` (imports electron at module top). The pure pieces (`nextLoadFailed`, `getView`) are already covered in `views.test.ts`. If the reload gate is extracted as a small pure decision (e.g., "should-reload given flag + entry-liveness"), cover it in the electron-free module beside its siblings; if it stays as inline glue mirroring the remote arm (which is uncovered glue today), no new test file is required — pattern consistency with the existing remote-heal glue is the review bar.

## Affected Memory

- `run-kit/desktop-shell`: (modify) § Local Daemon Control — record that the connect tail consumes `viewLoadFailed` (the reload gate is no longer remote-only); update the § SSH Remote Hosts cross-reference that describes the gate as the remote arm's.

## Impact

- `app/desktop/src/main.ts` — one function (`connectLocalHost`), plus possibly a small extraction into `src/views.ts` or `src/local-daemon.ts` if the reviewer-preferred shape is a pure decision.
- No IPC, preload, store, or menu changes. No backend changes.
- Sibling change `260901-ijiz-dead-host-interstitial-daemon-menu` builds on this (its interstitial auto-reload uses the same flag); this change lands first.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mirror the remote heal's reload gate (flag check → liveness check → clear flag → `loadURL(url + lastPath)`) rather than inventing a new mechanism | The pattern exists at main.ts:1203–1208, is documented in memory, and pattern-consistency is a project code-quality principle | S:90 R:90 A:95 D:95 |
| 2 | Certain | Gate lives in `connectLocalHost` so the welcome card and the menu item are both covered by one edit | It is the documented shared connect tail for both consumers | S:85 R:90 A:90 D:90 |
| 3 | Confident | Reload target is `url + (lastPath ?? "")`, accepting the same navigated-after-failure caveat the remote arm records as a known gap | Consistency with the remote arm; a failed view is on the error page in practice, where the captured path is correct | S:70 R:85 A:80 D:75 |
| 4 | Confident | No new test file if the change stays as inline glue mirroring the remote arm; extract-and-test only if extraction is the cleaner shape | The remote-arm glue it mirrors is itself uncovered; `main.ts` is untestable under node --test by design | S:60 R:90 A:75 D:70 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
