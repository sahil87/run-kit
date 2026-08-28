# protected-kill-confirm.spec.ts

E2E coverage for the protected-server kill confirm dialog (the typed-name
force-kill unlock). Runs against a scratch server created through the UI and
marked `@rk_srv_protected` via raw tmux — the same mark the UI Protect toggle
writes — inside this worktree's isolated e2e socket family.

## Shared setup

- Desktop viewport (1024×768) — `gotoServerReady` gates on the desktop-only
  status-bar Connected dot.
- `beforeAll` creates the scratch server via tmux (`new-session` on its own
  socket inside this worktree's e2e socket family) and marks it
  `@rk_srv_protected 1` server-scoped — the same option the UI Protect toggle
  writes through `POST /api/servers/protect`.
- `afterAll` kills the scratch server best-effort (a protected server needs
  the named kill — the reaper's family glob skips it).
- Each interaction starts from the primary e2e server route — the palette's
  `Server: Kill <name>` entries live in the shared app shell, and the kill
  target need not be the current server.

## Tests

### Force kill stays locked on a wrong name, unlocks on the exact name, Esc cancels

**What it proves**: the protected kill-confirm forks away from the plain
two-button confirm: the destructive action is `Force kill`, it stays disabled
until the typed text exactly equals the server name, Enter submits only on a
match, Esc always cancels without killing, and a completed force kill removes
the server from the UI.

**Steps**:

1. `beforeAll` has already created and `@rk_srv_protected`-marked the scratch
   server; the test starts on the primary e2e server route.
2. Open the palette, run `Server: Kill <name>`; assert the guarded dialog
   shows the typed-name input and a `Force kill` button — and NO plain `Kill`
   button.
3. Type a wrong name; assert `Force kill` stays disabled and Enter leaves the
   dialog open.
4. Type the exact server name; assert `Force kill` enables.
5. Press Esc; assert the dialog closes and the server still answers
   `tmux has-session` (nothing was killed).
6. Reopen the dialog, type the exact name, click `Force kill`; assert the
   dialog closes and the server stops answering `tmux has-session`.
