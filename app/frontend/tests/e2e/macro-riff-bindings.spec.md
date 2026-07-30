# macro-riff-bindings.spec.ts

Verifies **macro shortcut bindings over riff presets** (260730-hbyh): the
shortcuts overlay's editable CUSTOM section (add-macro flow, resolved-command
preview, missing-preset badge), macro chords executing through the existing
`POST /api/riff` spawn seam with the **preset name only** (never shell text),
success toast + navigation to the spawned window, the kind-tagged
`Macro: {label}` command-palette entry decorated with its effective combo,
and the no-silent-fallback error path (a preset gone from fabconfig surfaces
the backend 400 as an error toast).

## Shared setup

- Fully mocked — no tmux, no `wt`, no real backend. Injected via `page.route`
  / `page.routeWebSocket` (globs carry a trailing `*` so the client's appended
  `?server=` / `?session=` queries are intercepted):
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200.
  - `**/api/riff/presets*` → one preset `discuss` (deck-h, 2 panes), tier
    `default` — the preflight the overlay fetches while open.
  - `**/api/riff?*` → the spawn seam; each POST body is captured for
    assertion. Per test it returns 200
    `{server, session, window: "riff-swift-fox", windowId: "@9"}` or a 400
    `{"error": "unknown preset …"}`. The glob matches only the spawn URL —
    `/api/riff/presets` needs a `/`, which glob `?`/`*` never match.
  - `/ws/state` (via `mockStateSocket`) → session `dev` with windows `@1`
    "win-one" (active), `@2` "win-two", and `@9` "riff-swift-fox". `@9` is
    the window the mocked spawn "creates" — present in the static snapshot
    from the start so post-spawn navigation confirms instead of tripping the
    switch-confirm watchdog.
- `gotoWindowOne(page)` navigates to `/default/1` and gates on "win-one".
- `seedMacro(page, macro, code)` pre-seeds `localStorage["runkit-macros"]`
  (the definition) and `localStorage["runkit-keybindings"]` (the combo diff —
  a macro's key binding is an ordinary override entry) before page load.
- Chords are pressed as `Shift+Control+<code>` — the registry matches on
  `KeyboardEvent.code` and accepts Ctrl in place of Meta on every platform.

## Tests

### `add a riff-preset macro, capture a key, and the chord spawns + navigates`

**What it proves:** the whole macro lifecycle works end-to-end from the
overlay — target picking (riff preset from the fetched preflight), naming,
one-flow key capture, persistence into the two localStorage stores, and the
chord dispatching a validated riff spawn that toasts and navigates.

**Steps:**
1. Mock the backend; open `/default/1`.
2. Press Shift+Ctrl+/ to open the overlay; click
   `+ bind a key to a palette action or riff preset…`.
3. Search targets for "discuss"; pick `riff: discuss`; the name input
   pre-fills with the target label; click `add + capture key`.
4. Capture arms on the fresh row (`press keys…`); press Shift+Ctrl+D.
5. Assert `runkit-macros` holds the definition
   (`macro:riff-discuss` → preset `discuss`) and `runkit-keybindings` holds
   `{code: "KeyD", tier: "shifted"}`; the row shows the preview
   `rk riff --preset discuss`.
6. Escape closes the overlay; press Shift+Ctrl+D.
7. Assert exactly one POST with body `{session: "dev", preset: "discuss"}`
   (preset name only — no shell text), the `Spawned riff-swift-fox` toast,
   and navigation to `/default/9`.

### `a seeded macro appears as a kind-tagged Macro: entry with its hint and executes`

**What it proves:** macros are palette-reachable without their key
(Constitution V) — the `Macro: {label}` entry renders the effective combo as
its shortcut hint (via the shared `withShortcutHints` join on actionId) and
selecting it runs the same execution path as the chord.

**Steps:**
1. Seed the `discuss` macro bound to ⇧Ctrl+D; mock the backend; open
   `/default/1`.
2. Open the palette (Meta+K) and filter for "Macro".
3. Assert `Macro: riff: discuss` is listed with the hint `Shift+Ctrl+D`
   (non-mac host formatting).
4. Press Enter to select it; assert the spawn toast and the single POST body
   `{session: "dev", preset: "discuss"}`.

### `the overlay flags the row and the chord surfaces the backend 400 as a toast`

**What it proves:** a macro whose preset no longer exists in fabconfig is
never a silent no-op — the CUSTOM row shows a `missing preset` badge once the
fetched preset list is known, and pressing the chord still POSTs (the backend
validates authoritatively) with the 400 error text surfacing as a toast and
no navigation.

**Steps:**
1. Seed a macro targeting preset `gone` bound to ⇧Ctrl+G; mock the backend
   with the spawn route returning 400 `unknown preset "gone" …`.
2. Open `/default/1`; open the overlay (⇧Ctrl+/).
3. Assert the `missing preset` badge renders on the macro row (the mocked
   preflight defines only `discuss`); Escape closes the overlay.
4. Press Shift+Ctrl+G; assert the error toast with the backend message, the
   single POST body `{session: "dev", preset: "gone"}`, and that the URL
   stays `/default/1`.
