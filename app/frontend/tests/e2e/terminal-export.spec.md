# terminal-export.spec.ts

Verifies the tty tile header's **⇩ export affordance** (260819-shqo): the
button renders on the desktop tty tile header, opens the approved two-section
menu ("This view — client buffer" / divider / "Full history — server
capture"), picking **Download snapshot** fires a real browser download whose
filename matches the `{session}-{window}-{YYMMDD-HHmmss}.html` convention, and
the four export rows are palette-reachable as `Terminal: …` entries on the
terminal route (Constitution V).

## Shared setup

- Real tmux rig on the isolated e2e server (`rk-test-e2e`): `beforeAll`
  creates a detached 80×24 session (`e2e-texp-<ts>`, per-spec so files never
  collide) with one window `export` running `echo export-e2e-marker; sleep
  300` (an idle pane with one printed line, so the client buffer is
  non-empty); `afterAll` kills it.
- Desktop viewport (1440×800) — the tile header is desktop-only chrome; the
  status bar's `Connected` dot (the readiness gate) is too.
- Each test navigates straight to the window's terminal route
  (`/<server>/<%40id>`), resolved via `resolveWindow` from the backend
  snapshot.

## Tests

### `⇩ button opens the two-section menu; Download snapshot downloads a convention-named .html`

**What it proves:** the export button is present on the tty tile header; the
menu shows both labeled sections with exactly four rows; the snapshot row
produces a client-side `.html` download named per the convention (zero-padded
clock, session + window tokens); and the menu closes after the pick.

**Steps:**
1. Resolve the `export` window and navigate to its terminal route; wait for
   the `Connected` dot and the `surface-tile-tty` tile, then for the sidebar's
   session row (`Navigate to <session>`) — the filename tokens derive from the
   SSE snapshot (sessionName + statusWindow), and that row renders from the
   same payload.
2. Assert the `Export terminal output` button is visible; click it.
3. Assert the menu is visible with both section labels and 4 menuitem rows.
4. Start listening for a `download` event; click `Download snapshot`.
5. Assert the suggested filename matches
   `^e2e-texp-<ts>-export-\d{6}-\d{6}\.html$`; assert the menu closed.

### `the palette carries the four Terminal: export entries on the terminal route`

**What it proves:** all four export actions (`Terminal: Download snapshot
(HTML)`, `Terminal: Download transcript`, `Terminal: Copy visible screen`,
`Terminal: Download full history`) are registered and discoverable through
the command palette while a tty tile is mounted.

**Steps:**
1. Resolve the `export` window and navigate to its terminal route; wait for
   the `surface-tile-tty` tile.
2. Open the palette with `Meta+k` (retried up to 3× — right after first paint
   the keybinding registry may still be loading); fill `Terminal:`.
3. Assert each of the four `Terminal: …` options is listed.
