# shortcut-registry.spec.ts

Verifies the **keyboard shortcut registry** (260730-g40a): the uniform
`Shift+CmdOrCtrl+<key>` run-kit action tier dispatched by the window-level
registry dispatcher, the shortcuts cheatsheet overlay (⇧CmdOrCtrl+/, a dialog
— not a route), click-to-capture rebinding persisted as diffs to
`localStorage["runkit-keybindings"]`, palette `shortcut` hints sourced from
the effective map, and browser-reserved key inertness (Playwright is a plain
browser host, so the shifted N/T/W defaults resolve disabled while their
actions stay palette-reachable).

## Shared setup

- Fully mocked — no tmux, no real backend state. Injected via `page.route` /
  `page.routeWebSocket`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `/ws/state` (via `mockStateSocket`) → session `dev` with three windows:
    `@1` "win-one" (active), `@2` "win-two", `@3` "win-three".
  - The terminals mux WebSocket (`/ws/terminals`) is stubbed.
- `gotoWindowOne(page)` navigates to `/default/1` and gates on "win-one"
  rendering.
- Chords are pressed as `Shift+Control+<code>` — the registry matches on
  `KeyboardEvent.code` and accepts Ctrl in place of Meta on every platform.
  Presses land while the xterm textarea owns focus, so each dispatch also
  exercises the terminal seam (the custom key handler refuses shifted-tier
  chords so they bubble to the dispatcher instead of reaching the pane).

## Tests

### `Shift+Ctrl+L / Shift+Ctrl+H cycle the current session's windows with wraparound`

**What it proves:** the `window-next`/`window-prev` starter bindings cycle the
current session's windows in sidebar order, wrapping at both ends.

**Steps:**
1. Mock the backend; open `/default/1`.
2. Press Shift+Ctrl+L three times → URL walks `/default/2`, `/default/3`,
   then wraps to `/default/1`.
3. Press Shift+Ctrl+H → URL wraps backward to `/default/3`.

### `Shift+Ctrl+[ / Shift+Ctrl+] retrace history (back / forward)`

**What it proves:** the `go-back`/`go-forward` bindings drive router history —
a window switch pushes an entry that the chords retrace.

**Steps:**
1. Open `/default/1`; press Shift+Ctrl+L → `/default/2` (pushes history).
2. Press Shift+Ctrl+[ → back to `/default/1`.
3. Press Shift+Ctrl+] → forward to `/default/2`.

### `Shift+CmdOrCtrl+/ toggles the overlay; filter narrows; Escape closes`

**What it proves:** the cheatsheet overlay opens/closes on its chord (including
from inside the overlay's own filter input — the binding is `ignoreInputs`),
the filter narrows rows, and Escape closes.

**Steps:**
1. Open `/default/1`; press Shift+Ctrl+/ → the `shortcuts-overlay` dialog is
   visible.
2. Fill the filter with "waiting" → the "Next waiting agent" row remains, the
   "New session" row is filtered out.
3. Press Shift+Ctrl+/ again (focus in the filter input) → overlay closes.
4. Reopen with the chord; press Escape → overlay closes.

### `the Help: Shortcuts palette entry opens the overlay`

**What it proves:** the overlay is palette-reachable (Constitution V) via the
`shortcuts-overlay` action.

**Steps:**
1. Open the palette (`Meta+k`), fill "Help: Shortcuts", press Enter.
2. Assert the overlay dialog is visible.

### `click-to-capture rebinds, persists the diff, and the new chord dispatches`

**What it proves:** clicking a row's combo arms capture, pressing a chord
rebinds the action, the override persists as a diff in
`localStorage["runkit-keybindings"]`, and dispatch honors the override (the new
chord fires; the vacated default no longer does).

**Steps:**
1. Open `/default/1`; open the overlay with Shift+Ctrl+/.
2. Click the combo button for "Next window"; press Shift+Ctrl+U.
3. Assert localStorage holds `{"window-next":{"code":"KeyU","tier":"shifted"}}`.
4. Close the overlay (Escape).
5. Press Shift+Ctrl+L (the vacated default) → URL stays `/default/1`.
6. Press Shift+Ctrl+U → URL navigates to `/default/2`.

### `registered palette entries render effective per-platform combos`

**What it proves:** a registered action's palette entry carries its effective
combo as the `shortcut` hint, formatted for the host platform (non-mac →
`Shift+Ctrl+A` on `Agent: Next waiting`).

**Steps:**
1. Open `/default/1`; open the palette; fill "Agent: Next waiting".
2. Assert the hint text `Shift+Ctrl+A` is visible.

### `Shift+Ctrl+N is inert in a browser host (create-session stays palette-only)`

**What it proves:** browser-reserved shifted keys (N/T/W) resolve disabled in a
plain browser host — the chord dispatches nothing (no create-session POST, no
navigation); the action remains reachable via the palette (asserted by the
hint/overlay tests' host-neutral entries).

**Steps:**
1. Mock the backend plus a POST-tracking route on `**/api/sessions*`.
2. Open `/default/1`; press Shift+Ctrl+N.
3. Wait 300ms; assert no POST fired and the URL is unchanged.
