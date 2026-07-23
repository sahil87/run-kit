# settings-dialog.spec.ts

Validates the VS Code-style settings dialog (260723-o7q8): mounted once at
`AppLayout` so it opens on every route (server routes AND `/board/$name`,
which renders no AppShell), triggered from the command palette and the
sidebar-footer gear, with a visible This-host/This-device persistence-scope
split, and host-scoped edits persisting through `/api/settings/*`.

Control-level behavior (input commit/cancel semantics, inline errors, theme
selects, font stepper, accent popover) is exercised deterministically by unit
tests (`settings-dialog.test.tsx`, `settings-dialog-context.test.tsx`,
`instance-name-context.test.tsx`); these e2e tests focus on the mount-point,
trigger, and persistence contracts that unit tests can't cover.

## Shared setup

- `beforeAll` snapshots the developer's REAL `~/.rk/settings.yaml` (raw
  bytes) — `scripts/test-e2e.sh` isolates the tmux server/port but NOT
  `$HOME`, and the instance-name test writes through the live API. `afterAll`
  restores the snapshot verbatim (or deletes the file if it did not exist),
  the `board-list-reorder.spec.ts` pattern.
- `beforeAll` creates an `e2e-settings-<timestamp>` tmux session on
  `rk-test-e2e` with one named window (`win-a`); `afterAll` kills it.
- A unique board name (`set<digits>`) and instance name
  (`e2e-name-<digits>`) are used per run so reruns don't collide.

## Tests

### `palette opens the dialog on a server route with the This-host/This-device split`

**What it proves:** The "Settings: Open" palette action opens the single
AppLayout-mounted dialog on a server route, both persistence-scope sections
render with their controls (instance name, SSH host, accent color, theme
pair, terminal font), and Escape closes it (keyboard-first contract).

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. `Meta+K` → type `Settings: Open` → Enter.
3. Assert the `Settings` dialog is visible.
4. Assert "This host" and "This device" section labels render.
5. Assert the Instance name input, SSH host input, `Set instance color`
   button, Dark theme select, and `Increase terminal font` button render.
6. Press Escape; assert the dialog is gone.

### `palette opens the same dialog on /board/$name (no AppShell there)`

**What it proves:** The dialog is reachable on the board route — the whole
point of the AppLayout mount, since `/board/$name` does not render AppShell
and mounts its own palette (`boardRouteActions`).

**Steps:**

1. Read `win-a`'s `#{window_id}` via `tmux list-windows -F` and
   `POST /api/boards/<name>/pin` so the board exists.
2. Navigate to `/board/<name>` (`domcontentloaded`); wait for the `win-a`
   pane header.
3. `Meta+K` → type `Settings: Open` → Enter.
4. Assert the `Settings` dialog is visible with both scope sections.
5. Finally: `POST /api/boards/<name>/unpin` so the board does not outlive
   the run.

### `sidebar footer gear opens the dialog (Tip-named, no native title)`

**What it proves:** The sidebar-footer gear is a working trigger on server
routes, named by `aria-label` + the tier-1 `Tip` system — it carries NO
native `title=` attribute.

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. Locate the `Open settings` button; assert it is visible and has no
   `title` attribute.
3. Click it; assert the `Settings` dialog is visible.

### `editing the instance name persists a host-scoped value (and clears)`

**What it proves:** A This-host edit round-trips through the live backend:
committing the Instance name input POSTs `/api/settings/instance-name`, the
stored setting reflects the value, the HOST panel hostname line prefers the
override live (no reload), and clearing the field clears the setting.

**Steps:**

1. Navigate to `/rk-test-e2e`; open the dialog via the sidebar gear.
2. Fill the Instance name input with the unique test name; press Enter.
3. Poll `GET /api/settings/instance-name` until it returns the test name.
4. Assert the sidebar (HOST panel hostname line) shows the test name.
5. Clear the input; press Enter.
6. Poll `GET /api/settings/instance-name` until it returns `null`.
