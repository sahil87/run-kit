# window-heading.spec.ts

Proves the centered, editable top-bar window heading (change 260703-5ilm):
the current tmux window name is the prominent centered identity on the Terminal
route, renaming happens in place (click → inline input, Enter/blur commit,
Escape cancel), the command-palette rename path enters the same inline edit,
the 375px bar stays single-line, and the hover-animation vocabulary classes are
present and CSS-gated under `prefers-reduced-motion`.

## Shared setup

- FILE-LEVEL `beforeAll` creates a dedicated tmux session (`e2e-heading-<ts>`)
  on the isolated test server (`rk-test-e2e`, or `E2E_TMUX_SERVER`) so this
  file never collides with other specs; file-level `afterAll` kills it. The
  hooks sit outside the describe blocks because the file has TWO: the default
  block (which inherits the global `reducedMotion: "reduce"` emulation from
  `playwright.config.ts`) and an animated-path block that opts back into motion
  with `test.use({ contextOptions: { reducedMotion: "no-preference" } })` — the
  convention `window-switch-transition.spec.ts` documents.
- `resolveWindow(page, name)` polls `GET /api/sessions` until the CLI-created
  window surfaces in the backend snapshot, returning its stable `@N` id (the
  handle for the terminal route and the `Rename window <name>` heading label).
- `gotoWindow(page, id)` navigates to `/${server}/${encodedId}` and waits for
  the `Connected` indicator.
- The centered heading is a `<button aria-label="Rename window <name>">`; its
  inline editor is a `<input aria-label="Window name">`.

## Tests

### `renders the current window name as the centered click-to-rename heading`

**What it proves:** On a Terminal route the window name renders once, as the
centered click-to-rename heading — NOT as a trailing breadcrumb crumb (the
breadcrumb now ends at the session).

**Steps:**
1. Create a window with a known name; resolve its `@N` id; navigate to it.
2. Assert the `Rename window <name>` button is visible and its text equals the
   window name.
3. Assert the `Breadcrumb` nav does NOT contain the window name (no duplication).

### `click name → inline input → type + Enter commits the rename`

**What it proves:** Clicking the heading opens an inline input; typing a new
name and pressing Enter commits via the rename API, and both the sidebar and
the heading reflect the new name.

**Steps:**
1. Create + navigate to a window.
2. Click the heading; assert the `Window name` input appears.
3. Fill a new name and press Enter.
4. Assert the sidebar shows the new name (rename API + SSE round-trip).
5. Assert the heading button now carries the new name.

### `Escape cancels the edit and restores the original name`

**What it proves:** Escape abandons the edit — no rename call, original name
restored.

**Steps:**
1. Create + navigate to a window; open the inline edit.
2. Type a throwaway value and press Escape.
3. Assert the input is gone and the original-name heading is back.
4. Re-resolve the window by its original name and assert its id is unchanged
   (proving no rename happened).

### `command-palette rename path enters inline edit (CustomEvent wiring)`

**What it proves:** The keyboard/command-palette rename path (Constitution V)
enters the SAME inline edit. The palette action dispatches a
`window-heading:rename` CustomEvent; asserting that event wiring is the stable
seam (palette-item selection itself is covered by command-palette unit tests).

**Steps:**
1. Create + navigate to a window; confirm the heading is visible.
2. `page.evaluate` dispatches `new CustomEvent("window-heading:rename")`.
3. Assert the `Window name` input appears (inline edit engaged).

### `375px top bar stays single-line with the heading (no horizontal overflow)`

**What it proves:** With the centered heading present and a long window name,
the 375px top bar stays single-line and introduces no horizontal page overflow
(the name truncates in the center cell).

**Steps:**
1. Create a window with a deliberately long name; resolve its id.
2. Set a 375×812 viewport; navigate to the window.
3. Assert the heading is visible.
4. Assert `document.body.scrollWidth ≤ 375` (no horizontal overflow).
5. Assert the header's rendered height is under one-and-a-half lines of chrome
   (a wrap would roughly double it).

### `hover treatments carry their classes; a reduced-motion context still renders them (gate is CSS-only)`

**What it proves:** The hover-animation vocabulary is wired via shared classes
(`rk-brand-glitch`, `rk-glint`, …) — class presence is the stable seam for CSS
animations (no pixel assertions). The `prefers-reduced-motion` gate is a CSS
`@media` rule that zeroes the animation, so the elements/classes are unchanged
under reduced motion; and the decode is skipped in JS so the rename input never
shows scrambled text.

**Steps:**
1. Create + navigate to a window; confirm the heading is visible.
2. Assert `.rk-brand-glitch` and `.rk-glint` elements are attached.
3. Open a second context with `reducedMotion: "reduce"`, navigate to the same
   window, and assert `.rk-glint` is still attached.
4. In the reduced-motion context, click the heading and assert the inline input
   value equals the real window name (no scrambled text leaks into edit).
5. Still in the reduced context, dispatch `pointerover` on a sidebar section
   label (a dispatched event makes this a TRUE negative — the handler ran and
   declined) and wait longer than one full sweep (~450ms): assert no
   `.rk-typed-cursor` cell appears and the label never gains `rk-typed-done` —
   the typed sweep is JS-gated on the same media query, and the rest state IS
   the reduced-motion state.

### `section labels type themselves out on hover (typed sweep)`

*(Lives in the separate "animated path" describe block, which opts back into
motion via `test.use({ contextOptions: { reducedMotion: "no-preference" } })` —
under the config's global reduce emulation the typed sweep never starts, so
asserting it needs real motion.)*

**What it proves:** The shared section-label treatment (`TypedLabel`,
`.rk-typed-label`) actually runs its invisible-hand typing sweep on pointer
enter: the label fades, an inverse-video cursor (accent-green cell OVER the
character) sweeps from the first cell brightening characters as it passes, the
label lands bright (`rk-typed-done`) with its text intact, and pointer leave
restores the rest state. All assertions are DOM-observable frame states — no
pixel diffs (honoring the "NO pixel assertions" e2e constraint).

The sweep is driven by DISPATCHED `pointerover`/`pointerout` events, not real
mouse hit-testing: on CI runners the sidebar re-layouts under SSE churn, and a
label shifting beneath a stationary pointer fires spurious enter/leave events
that cancel the sweep mid-pass or swallow the unhover (the flake this seam
replaced). React derives `onPointerEnter`/`onPointerLeave` from delegated
`pointerover`/`pointerout` pairs (`relatedTarget: null` reads as
entering-from/leaving-to outside), so the dispatched events exercise the exact
component handlers a real pointer does. (A dispatched `pointerenter` does NOT
work in real Chromium — it never reaches React's delegated listener.)

**Steps:**
1. Create + navigate to a window; locate the sidebar `Sessions` heading (a
   `TypedLabel`, class `rk-typed-label`, pinned by exact text — the nav holds
   several TypedLabels) and confirm it is visible with its text and no
   `rk-typed-done` class at rest.
2. Dispatch `pointerover`: assert an `.rk-typed-cursor` cell attaches (the
   sweep started — the cursor renders synchronously on the first character,
   and the ~350ms pass outlasts Playwright's first assertion poll).
3. Assert the label gains `rk-typed-done` (the pass completed), the cursor
   cell is gone (frame spans collapse back to plain text), and the text is
   fully intact.
4. Dispatch `pointerout`: assert `rk-typed-done` is removed and the text is
   unchanged (rest state restored).
