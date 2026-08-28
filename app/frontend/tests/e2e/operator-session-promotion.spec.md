# Operator session physical promotion — e2e spec

Companion to `operator-session-promotion.spec.ts`.

## Shared setup

- Own session `e2e-oppromote-<epoch>` created in `beforeAll` (isolated
  `rk-test-e2e` tmux server), torn down in `afterAll` along with `_rk-operator`.
- Viewport: default desktop.
- All role changes go through the same `POST /api/windows/{windowId}/options`
  partial-merge route the palette client uses (`@rk_win_role: "operator"` to set,
  `null` to clear), never a client-side shortcut.

## Tests

### promote hides the operator session + moves the window out of its work group; pinned row navigates; demote reappears under a visible group

**What it proves:** the three user-visible Phase-1 behaviors — (1) after
promote, the work session's group no longer contains the operator window
(membership moved ⇒ tmux window-cycling no longer jumps to it) and no
`_rk-operator` session group appears (content-hidden); (2) the pinned operator
row still renders once above the groups and navigates to the operator window;
(3) after demote, the window reappears under a visible conventional session
group, no longer pinned.

**Steps:**

1. Create a sibling `worker-<ts>` window (keeps the work session alive after
   the move) and the operator window `operator-<ts>`; open the server page and
   resolve the operator window's id.
2. Assert the fresh operator window renders once inside its work-session
   group, and no `_rk-operator` session group exists.
3. Promote: POST `@rk_win_role: "operator"`; assert it succeeds.
4. Assert the work group no longer lists the operator window (count 0), no
   `_rk-operator` session group renders, and the pinned operator row renders
   exactly once ABOVE the work group (smaller y).
5. Click the pinned row; assert the URL navigates to the operator window's
   `@N` route.
6. Demote: POST `@rk_win_role: null`; assert it succeeds.
7. Assert no `_rk-operator` session group renders, and the window reappears
   under a visible session group exactly once (no longer the pinned slot).
