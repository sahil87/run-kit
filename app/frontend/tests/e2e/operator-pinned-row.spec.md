# operator-pinned-row.spec.ts

Validates the operator pinned row (260813-ifya): when a window on the server
carries `@rk_role=operator`, its sidebar row is MOVED (not copied) out of its
session group and pinned at the top of the server's session area — directly
below the SESSIONS header, above all session groups. Placement is the only UI
treatment (no badge, frame, label, or divider), the pinned row does not
participate in window drag-reorder (`draggable="false"`), and unmarking the
window demotes it out of the hidden `_rk-operator` session into the session
named after its pane cwd's basename (260822-skcr physical promotion) — its row
reappears there as an ordinary in-group row, with no placeholder left behind.

## Shared setup

- `beforeAll` creates `e2e-operator-<timestamp>` so the file has its own
  isolated session; `afterAll` kills it, plus the demote-destination session
  (the temp dir's basename) and the temp dir itself.
- The operator window is created with a unique `mkdtemp` cwd so its demote
  destination — the cwd-BASENAME session role-clear moves it to — is
  deterministic and cannot collide with a real session.
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
role demotes the window to its cwd-basename session — the row reappears there
as an ordinary in-group row (not in its original session), with no placeholder
or pinned wrapper left in the DOM.

**Steps:**
1. Create `worker-<ts>` and `operator-<ts>` windows in the test session via the
   shared `_tmux` helper — the operator window with the unique temp-dir cwd.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` the operator window; assert its row renders exactly once and
   is inside its `data-session-group` wrapper (the unmarked baseline).
4. POST `@rk_role: "operator"` to the window's `/options` route; assert 200.
5. Assert the row is gone from the session group, still renders exactly once in
   the sidebar, its bounding box sits ABOVE the session group's box, and the
   row is `draggable="false"`.
6. POST `@rk_role: null` (the partial-merge unset); assert 200.
7. Assert the row reappears inside the DESTINATION session group (the temp
   dir's basename), is absent from the original test session's group, still
   renders exactly once, and now sits BELOW the destination group header (the
   pinned slot is gone).
