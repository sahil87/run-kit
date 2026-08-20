# zen-mode.spec.ts

E2E coverage for true zen mode (260820-o8cr): the ⇧⌘⏎ / ⇧Ctrl+⏎ `zen-toggle`
chord at ANY arity on the desktop terminal route, the transient top-bar +
sidebar hide, the always-visible-in-zen status-bar exit button, and the
`View: Enter/Exit Zen Mode` palette entries.

## Shared setup

- Own tmux session (`e2e-zen-<ts>`) created in `beforeAll`, killed in
  `afterAll`; windows are created per test via `_tmux.newWindow` and resolved
  through the SSE snapshot (`_ready.resolveWindow`).
- Desktop viewport (1440×800) — zen is desktop-only.
- `page.addInitScript` seeds localStorage `runkit-sidebar-open = "true"` so
  the round-trip test asserts a KNOWN persisted preference survives untouched.
- The chord resolves on the Linux browser host as `Shift+Control+Enter` (the
  mac ⇧⌘⏎ form is unit-tested in `keybindings.test.ts`).
- The ⇧⌘⏎ chord fires from the xterm pane (its `ignoreInputs` carve-out); the
  ⌃K palette chord does NOT (the pane's key handling swallows Ctrl+K on
  Linux — a pre-existing terminal-routing property, unrelated to zen), so the
  palette-open helper defocuses to the status bar before pressing it.
- A second tile is opened via the top-bar surface-toggle rail's `Code tile`
  button (the surface-layout/code-surface specs' rail precedent — the e2e
  rig's windows offer the code surface from their repo cwd).


## Tests

### enter via ⇧⌘⏎ hides top bar + sidebar at arity 1, keeps the status bar with an exit button; exit via the button restores chrome and never writes the sidebar preference
What it proves: the chord now mounts at arity 1 (the pre-260820-o8cr gap —
a single-tile layout used to swallow the chord); entering zen hides the top
bar and the sidebar while keeping the status bar visible with its exit
affordance; zen is transient — the persisted sidebar preference is never
written on a zen path; exiting via the status-bar button restores exactly
the persisted chrome.
Steps:
1. Create window A; navigate; wait for the tty tile.
2. Assert baseline: top bar, sidebar, status bar all visible; no exit button;
   the seeded preference reads `"true"`.
3. Click into the xterm and press ⇧Ctrl+⏎; assert the top bar and sidebar
   hide, the status bar stays visible, and the `status-bar-exit-zen` button
   appears.
4. Assert localStorage `runkit-sidebar-open` still reads `"true"` mid-zen.
5. Click the exit button; assert top bar + sidebar return, the exit button
   disappears, and the preference still reads `"true"`.

### exit via the chord restores chrome; at arity > 1 entering zen zooms the focused tile and exiting unzooms it
What it proves: at arity > 1 entering zen compounds the chrome hide with the
existing focused-tile zoom seam (non-focused tiles display-hide), and the
chord exit undoes exactly the zen-initiated zoom.
Steps:
1. Create window B; navigate; open the code tile via the top-bar rail (`Code
   tile` button) — arity 2.
2. Click into the xterm and press ⇧Ctrl+⏎; assert top bar + sidebar hide,
   the code tile display-hides, the tty tile stays visible, and the exit
   button appears.
3. Press ⇧Ctrl+⏎ again; assert top bar, sidebar, AND the code tile all return
   (the zen-initiated zoom undone), and the exit button disappears.

### the palette offers `View: Enter Zen Mode` findable by 'zen' at arity 1, flips to the exit form while zen is active, and drives the same toggle
What it proves: the palette gains zen entries findable by "zen" at any arity
(the parity invariant's new equivalence), exactly one form renders keyed on
live zen state, and the entries drive the same enter/exit body as the chord.
Steps:
1. Create window C; navigate; wait for the tty tile (arity 1).
2. Open the palette (⌃K), filter to "zen"; assert `View: Enter Zen Mode` is
   offered and `View: Exit Zen Mode` is absent; select the enter entry.
3. Assert the top bar and sidebar hide (zen entered via the palette).
4. Reopen the palette, filter to "zen"; assert only `View: Exit Zen Mode` is
   offered (the one-form flip); select it.
5. Assert the top bar and sidebar return.
