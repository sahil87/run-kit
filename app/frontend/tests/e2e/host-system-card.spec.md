# host-system-card.spec.ts

Verifies the run-kit system card in the HOST HEALTH zone on `/`: the daemon
reads as a SYSTEM surface — a daemon line (version / uptime / port) with a
Restart verb, live service rows (jobs / code-server / remotes) derived from the
rk-daemon server's sessions with View deep-links, and the shield glyph marking
the rk-daemon tile on the TMUX SERVERS grid.

## Shared setup

- `mockBackend(page)` before each navigation: a full mock — no real tmux state
  is seeded.
  - `GET /api/servers` is fulfilled with two servers: `regular` (unprotected)
    and `rk-daemon` (2 sessions).
  - The `/ws/state` state socket is the shared protocol mock
    (`_state-socket-mock.ts`): a server subscribe for `rk-daemon` answers with
    an `rk-jobs` session (one window, `@7` active) and an `rk-remotes` session
    (two windows) — no `rk-code-server` session, so the card proves the
    running/not-running fork. The `version` global slot carries the additive
    `started` (≈1h ago) + `port` fields. No `metrics` slot is mocked, so the
    card renders against a metrics-less zone (proving its independence from the
    host-metrics stream).
  - `/ws/terminals` is accepted and held open (the terminal route after the
    View navigation mounts a relay socket).

## Tests

### `renders the daemon line, service rows, and the rk-daemon shield glyph on the tile grid`

**What it proves**: The system card renders inside the Host health zone with
the version/uptime/port daemon line and a Restart control; the service rows
derive live status from the rk-daemon server's sessions (jobs and remotes
running with View links, code-server not running without one); and the shield
glyph marks the rk-daemon tile (derived protection) while the unprotected
`regular` tile stays unmarked.

**Steps**:
1. Install the mocked backend, navigate to `/`.
2. Assert the `run-kit system` card is visible inside the `Host health` region.
3. Assert the daemon line shows `v3.9.1`, an `up 1h…` uptime, and `:3000`.
4. Assert the Restart button is visible.
5. Assert the service rows: `1 job` and `2 tunnels` visible, one
   `not running` row (code-server), and exactly two View buttons.
6. Assert the `shield-rk-daemon` glyph is visible on the TMUX SERVERS tile
   grid and no `shield-regular` glyph exists.

### `a service row's View deep-link lands on the daemon window's terminal route`

**What it proves**: A service row's View action navigates to the ordinary
`/$server/$window` terminal route for that sibling session's active window on
the rk-daemon server — the reframe loses no terminal access.

**Steps**:
1. Install the mocked backend, navigate to `/` and wait for the card.
2. Click the first View button (the jobs row — `rk-jobs`' active window `@7`).
3. Assert the URL is `/rk-daemon/7` (the window id's numeric URL segment).
4. Assert the terminal route renders the window name `update-check` (the
   center page heading) — the window is reachable, not hidden.
