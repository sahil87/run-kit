# spawn-agent.spec.ts

Verifies the **web-UI agent spawn** flow (260713-sbk1; extended to the full
mockup in 260714-q9cg) — surfacing `rk riff` as a one-action spawn dialog. It
proves the dialog opens from BOTH entry points (Cmd+K `Agent: Spawn` and the
window-switcher `+ New Agent`), renders the mockup-v2 field set (Where radio /
Worktree name / Agent tier) with the correct defaults and conditional Worktree
visibility, that a checkout + tier task-submit spawns and navigates carrying
`where`/`tier` in the POST body, and that a 400 renders its error in-dialog
without navigating.

## Shared setup

- Fully mocked — no tmux, no `wt`, no `fab`, no real backend. Injected via
  `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` for the appended `?server=`).
  - `**/api/sessions/stream*` → one `event: sessions` frame: session `dev` with
    one active window `@1` "main".
  - `**/api/riff/presets*` → `{presets: [...], tiers: [...]}` (empty presets +
    the fab-kit built-in tiers by default). **Trailing `*`** — the client's
    `withServer` appends `?server=`, so a no-star glob would fall through and hit
    live tmux (playwright-glob memory).
  - `**/api/riff*` → intercepts **POST only** (falls back otherwise so the
    presets GET, which also matches this glob, is not swallowed); captures the
    request body and fulfills with the mock's status/body. **Trailing `*`** for
    the same appended-`?server=` reason.
  - The relay WebSocket is stubbed.
- `BUILTIN_TIERS` mirrors the backend's `fabconfig.BuiltinTiers`
  (`default, doing, fast, operator, review`); the presets mock returns these as
  `tiers` unless a test overrides them.
- `gotoTerminal(page)` navigates to `/default/1` and waits for the "main" window
  to render (the SSE payload landed).
- `openViaPalette(page)` opens the palette (`Meta+k`), fills "Agent: Spawn", and
  presses Enter.
- `openViaDropdown(page)` clicks the window-switcher trigger (`Switch window`)
  then the `+ New Agent` menu item.
- `OK_SPAWN` is the success mock: `POST /api/riff` → 200
  `{server, session:"dev", window:"riff-swift-fox", windowId:"@7"}`, no presets.

## Tests

### `opens the spawn dialog from the Cmd+K Agent: Spawn action`

**What it proves:** the palette action (Constitution V parity) opens the
spawn-agent dialog on the terminal route, titled with the target session.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaPalette`.
3. Assert the `Spawn agent in dev` dialog and its `Task` field are visible.

### `opens the spawn dialog from the window-switcher + New Agent item`

**What it proves:** the second entry point — the `+ New Agent` item beside
`+ New Window` in the top-bar window switcher — opens the same dialog.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaDropdown` (click `Switch window`, then `+ New Agent`).
3. Assert the `Spawn agent in dev` dialog and its `Task` field are visible.

### `renders the mockup-v2 fields (Where radio, Worktree, Agent tier)`

**What it proves:** the v2 dialog renders the new fields with the mockup
defaults — the Where radio defaults to "new worktree", the Worktree name field
is visible in worktree mode, the Agent tier dropdown defaults to "default", and
selecting "this checkout" hides the Worktree field.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`; `openViaPalette`.
2. Assert the "new worktree" radio is checked and "this checkout" is not.
3. Assert the Worktree name field is visible and the Agent dropdown value is
   "default".
4. Check the "this checkout" radio; assert the Worktree name field is hidden.

### `submitting a task spawns and navigates to the returned window`

**What it proves:** typing a task and pressing Enter POSTs `/api/riff` with the
task + session and, on success, navigates to the returned window; a defaults-only
body omits `where`/`tier` (backend defaults), keeping the shipped path's body.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaPalette`; fill the `Task` field with "fix the bug"; press Enter.
3. Assert the URL navigated to `/default/7` (the returned `windowId` `@7`).
4. Assert the captured POST body matches `{ task: "fix the bug", session: "dev" }`
   and carries neither `where` nor `tier`.

### `a checkout + tier task-submit carries where and tier in the POST body`

**What it proves:** selecting "this checkout" and a non-default tier sends those
choices in the POST body (and omits `worktreeName` in checkout mode), then
navigates on success.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`; `openViaPalette`.
2. Check the "this checkout" radio; select tier "doing" in the Agent dropdown.
3. Fill the `Task` field with "explore the code"; press Enter.
4. Assert the URL navigated to `/default/7`.
5. Assert the captured POST body matches
   `{ task: "explore the code", session: "dev", where: "checkout", tier: "doing" }`
   and carries no `worktreeName`.

### `a 400 renders its error in-dialog and does not navigate`

**What it proves:** a 400 (e.g. non-repo cwd) renders the error message inside
the still-open dialog and performs no navigation (nothing was created).

**Steps:**
1. Mock `POST /api/riff` → 400 `{error: "The session's working directory is not
   inside a git repository"}`.
2. `gotoTerminal`; `openViaPalette`; fill the `Task` field; press Enter.
3. Assert the error text is visible, the `Spawn agent in dev` dialog is still
   visible, and the URL is unchanged (`/default/1`).
