# operator-pinned-row.spec.ts

Validates the operator pinned row (260813-ifya): when a window on the server
carries `@rk_role=operator`, its sidebar row is MOVED (not copied) out of its
session group and pinned at the top of the server's session area — directly
below the SESSIONS header, above all session groups. Placement is the only UI
treatment (no badge, frame, label, or divider), the pinned row does not
participate in window drag-reorder (`draggable="false"`), and unmarking the
window returns its row to the session group with no placeholder left behind.

## Shared setup

- `beforeAll` creates `e2e-operator-<timestamp>` so the file has its own
  isolated session; `afterAll` kills it.
- Tests run sequentially (`fullyParallel: false`).
- `resolveWindow(page, server, session, name)` polls `GET /api/sessions` until
  a window with the given name appears, returning its stable tmux window id
  (`@N`). Rows are selected by `data-window-id="@N"`; session groups carry
  `data-session-group="<name>"` wrappers.
- `setRole(page, windowId, role)` POSTs the partial-merge window-options body
  (`{"options": {"@rk_role": role}}`, `null` unsets) to
  `POST /api/windows/{id}/options` — the same route the palette's
  `Window: Mark as Operator` / `Window: Unmark Operator` commands use.

## Tests

### `marking a window operator pins its row above the session groups and removes it from its own group; unmarking restores`

**What it proves:** Marking a window as the operator via the options POST moves
its row out of its session group to a pinned slot above all session groups
(rendered exactly once, above the group box, not draggable), and clearing the
role restores the ordinary in-group row with no placeholder or wrapper left in
the DOM.

**Steps:**
1. Create `worker-<ts>` and `operator-<ts>` windows in the test session via the
   shared `_tmux` helper.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` the operator window; assert its row renders exactly once and
   is inside its `data-session-group` wrapper (the unmarked baseline).
4. POST `@rk_role: "operator"` to the window's `/options` route; assert 200.
5. Assert the row is gone from the session group, still renders exactly once in
   the sidebar, its bounding box sits ABOVE the session group's box, and the
   row is `draggable="false"`.
6. POST `@rk_role: null` (the partial-merge unset); assert 200.
7. Assert the row is back inside its session group, still renders exactly once,
   and now sits BELOW the session group header (the pinned slot is gone).
