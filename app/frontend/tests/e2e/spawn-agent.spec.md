# spawn-agent.spec.ts

Verifies the **web-UI agent spawn** flow (260713-sbk1) — surfacing `rk riff` as
a one-action spawn dialog. It proves the dialog opens from BOTH entry points
(Cmd+K `Agent: Spawn` and the window-switcher `+ New Agent`), that submitting a
task spawns and navigates to the returned window, and that a 400 renders its
error in-dialog without navigating.

## Shared setup

- Fully mocked — no tmux, no `wt`, no `fab`, no real backend. Injected via
  `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` for the appended `?server=`).
  - `**/api/sessions/stream*` → one `event: sessions` frame: session `dev` with
    one active window `@1` "main".
  - `**/api/riff/presets*` → `{presets: [...]}` (empty by default). **Trailing
    `*`** — the client's `withServer` appends `?server=`, so a no-star glob would
    fall through and hit live tmux (playwright-glob memory).
  - `**/api/riff*` → intercepts **POST only** (falls back otherwise so the
    presets GET, which also matches this glob, is not swallowed); captures the
    request body and fulfills with the mock's status/body. **Trailing `*`** for
    the same appended-`?server=` reason.
  - The relay WebSocket is stubbed.
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
spawn-agent dialog on the terminal route.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaPalette`.
3. Assert the `Spawn agent` dialog and its `Task` field are visible.

### `opens the spawn dialog from the window-switcher + New Agent item`

**What it proves:** the second entry point — the `+ New Agent` item beside
`+ New Window` in the top-bar window switcher — opens the same dialog.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaDropdown` (click `Switch window`, then `+ New Agent`).
3. Assert the `Spawn agent` dialog and its `Task` field are visible.

### `submitting a task spawns and navigates to the returned window`

**What it proves:** typing a task and pressing Enter POSTs `/api/riff` with the
task + session and, on success, navigates to the returned window.

**Steps:**
1. Mock the backend (`OK_SPAWN`); `gotoTerminal`.
2. `openViaPalette`; fill the `Task` field with "fix the bug"; press Enter.
3. Assert the URL navigated to `/default/7` (the returned `windowId` `@7`).
4. Assert the captured POST body matches `{ task: "fix the bug", session: "dev" }`.

### `a 400 renders its error in-dialog and does not navigate`

**What it proves:** a 400 (e.g. non-repo cwd) renders the error message inside
the still-open dialog and performs no navigation (nothing was created).

**Steps:**
1. Mock `POST /api/riff` → 400 `{error: "The session's working directory is not
   inside a git repository"}`.
2. `gotoTerminal`; `openViaPalette`; fill the `Task` field; press Enter.
3. Assert the error text is visible, the `Spawn agent` dialog is still visible,
   and the URL is unchanged (`/default/1`).
