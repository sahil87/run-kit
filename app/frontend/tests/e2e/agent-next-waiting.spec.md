# agent-next-waiting.spec.ts

Verifies the **`Agent: Next waiting`** command-palette action (260706-y1ar;
`docs/specs/status-pyramid.md` § Attention Propagation) — the keyboard-first
attention nav (Constitution V): it navigates to the next window whose rolled-up
`agentState` is `waiting`, and no-ops with a "No agents waiting" toast when none
are waiting.

## Shared setup

- Fully mocked — no tmux, no `gh`, no real backend. Injected via `page.route`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `/ws/state` (state socket, via `mockStateSocket`) → the subscribe ack + `sessions` event carry the mocked payload, session `dev` with
    two windows: `@1` "active-win" (`agentState: active`, the active window) and
    `@2` "waiting-win", whose `agentState` is `waiting` (test 1) or `idle`
    (test 2).
  - The terminals mux WebSocket (`/ws/terminals`) is stubbed.
- `runNextWaiting(page)` opens the palette (`Meta+k`), fills "Agent: Next
  waiting" into the `Type a command...` input, and presses Enter.

## Tests

### `navigates to the waiting window when one exists`

**What it proves:** invoking the action from a non-waiting window navigates to
the waiting window.

**Steps:**
1. Mock the backend with `@2` waiting; navigate to `/default/1` (the active
   window).
2. Assert "active-win" is visible.
3. Run the `Agent: Next waiting` palette action.
4. Assert the URL navigated to `/default/2` (the waiting window `@2`).

### `no-op with a 'No agents waiting' toast when none are waiting`

**What it proves:** with no waiting windows the action does not navigate and
surfaces the "No agents waiting" info toast.

**Steps:**
1. Mock the backend with `@2` idle (no window waiting); navigate to
   `/default/1`.
2. Assert "active-win" is visible.
3. Run the `Agent: Next waiting` palette action.
4. Assert the URL is still `/default/1` (no navigation) and the "No agents
   waiting" toast is visible.

### `waiting halo is a static ring under prefers-reduced-motion`

**What it proves:** (A-019) under `prefers-reduced-motion: reduce` the waiting
halo renders as a STATIC yellow ring — the pulse animation is disabled by the
`globals.css` reduced-motion block, but a visible box-shadow ring remains
(attention is never encoded in motion alone). Real-browser CSS is required
because jsdom does not evaluate media queries or `globals.css`.

**Steps:**
1. `emulateMedia({ reducedMotion: "reduce" })`.
2. Mock the backend with `@2` waiting; navigate to `/default/1`.
3. Locate the waiting window's status dot by its aria-label
   (`agent — active — agent waiting 3m`) and assert it carries the
   `rk-waiting-halo` class.
4. Assert its computed `animation-name` is `none` (no pulse).
5. Assert its computed `box-shadow` is non-empty (the static ring still paints).
