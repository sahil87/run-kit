# open-in-app.spec.ts

Verifies the top-bar **Open-in-App split-button** (260722-6d0f): with a stubbed
wt host-app registry it renders on a terminal route, its chevron menu lists the
host apps and launching one POSTs the active pane's cwd to `/api/open`; every
target is palette-reachable as an `Open: <label>` entry (Constitution V); and in
the default deployment (empty registry, no `RK_SSH_HOST`) the control is fully
absent — no bar button, no overflow rows, no palette entries.

The e2e client is `localhost`, so only the LOCAL view (host section) is
exercisable here — the remote deeplink branch keys on `location.hostname`,
which cannot be non-local against the e2e server, and is covered by Vitest
(`lib/open-in-app.test.ts`, `components/open-button.test.tsx`).

## Shared setup

- Fully mocked — no tmux server, no `wt` on the host. Routes installed per test
  via `mockBackend(page, registry)`:
  - `**/api/servers` → a single server `default`.
  - `/ws/state` (via `mockStateSocket`) → one session `dev` with window `@1`
    "feature-work" whose ACTIVE pane carries cwd `/tmp/wt/sub` (distinct from
    the window's `worktreePath` `/tmp/wt`, so the launch-body assertion pins
    the active-pane-cwd derivation).
  - `**/api/open-apps*` → the stubbed registry (`wt open --list --json` does
    not exist wt-side yet — backlog [qj66] — so the real backend always serves
    `[]`; the stub is what lights the control up). Test 3 stubs `[]` to
    reproduce the default deployment deterministically.
  - `**/api/windows/*/select*` → `{ok:true}` (trailing `*` — the query string).
  - the `/ws/terminals` mux WebSocket is accepted and held open.
- Each test navigates to the percent-encoded window route `/default/%401` and
  anchors on the **Close pane** button (the `currentWindow` gate) before
  asserting — the Open entry additionally waits on its own async registry
  fetch, so it gets its own visibility wait where needed.

## Tests

### `renders with a stubbed registry; menu lists the host apps; launching POSTs the pane cwd`

**What it proves:** with host apps available, the split-button (primary
"Open in app" + chevron "Open in… (choose app)") renders in the right cluster
at a wide viewport; the chevron menu lists each registry app as a flat
menuitem row with NO "on host" section header (a local client sees a
single-kind list); clicking a target POSTs `{path: <active pane cwd>, app:
<wt app id>}` to `/api/open` and closes the menu; and the primary segment
relabels to the last-used target ("Open in iTerm") after a launch.

**Steps:**
1. Install the mocked backend with a two-app registry (VS Code, iTerm) and a
   recording stub on `**/api/open?*`.
2. Set a 1440px viewport, navigate to `/default/%401`, wait for Close pane.
3. Assert the primary and chevron segments are visible in-bar.
4. Click the chevron; assert the "Open in app" menu shows `VS Code` and
   `iTerm` rows and no "on host" text.
5. Click `iTerm`; poll the recorded POST body until it equals
   `{path: "/tmp/wt/sub", app: "iterm"}`; assert the menu closed.
6. Assert the primary segment now reads "Open in iTerm" (last-used persisted).

### `every target is palette-reachable as an Open: entry (Constitution V)`

**What it proves:** each available open target registers a command-palette
entry (`Open: VS Code`, `Open: iTerm`), keeping the control keyboard-first.

**Steps:**
1. Install the mocked backend with the two-app registry; navigate and wait for
   Close pane, then for the Open primary segment (the registry fetch landed).
2. Open the palette (`Meta+k`), type `Open:`.
3. Assert both `Open: VS Code` and `Open: iTerm` options are listed.

### `absent in the default deployment (empty registry, no sshHost): no button, no menu rows, no palette entries`

**What it proves:** the zero-target state (wt without `--list` → `[]`, no
`RK_SSH_HOST`, local client) renders NO Open surface anywhere — bar, overflow
chevron menu, and palette all stay clean, so the existing top-bar chrome specs
(overflow pyramid, overlap sweep) are unaffected by this feature in the
default e2e environment.

**Steps:**
1. Install the mocked backend with an EMPTY registry; navigate and wait for
   Close pane.
2. Assert neither split-button segment exists (role queries — the aria-hidden
   measurement probe is excluded).
3. Open the "More controls" chevron menu; assert it contains no `Open:` rows;
   close it with Escape.
4. Open the palette, type `Open:`; assert no `Open:` options are listed.
