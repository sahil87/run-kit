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

### `section-label caret (rk-label-caret) actually appears on hover`

*(Lives in the separate "animated path" describe block, which opts back into
motion via `test.use({ contextOptions: { reducedMotion: "no-preference" } })` —
under the config's global reduce emulation the vocabulary correctly hides the
caret, so this paint assertion needs real motion.)*

**What it proves:** The shared caret-only treatment (`rk-label-caret`) actually
renders its `▊` caret (accent-green) on hover, not just carries the class. This is a
behavioral guard against the shipped no-op where `.rk-label-caret::after` had
`width: 0; overflow: hidden`, which clipped the glyph entirely so it never
became visible — a bug that class-presence and `opacity` checks alone did not
catch (opacity read `1` even while the glyph was clipped).

**Steps:**
1. Create + navigate to a window; locate the sidebar `SESSIONS` heading (it
   carries `rk-label-caret`) and confirm it is visible.
2. Read the `::after` computed style at rest: assert `opacity` is `0` and the
   `content` contains the `▊` glyph (caret present, not removed).
3. Compute a 12px-wide clip strip immediately to the RIGHT of the label box —
   where the caret glyph paints (the 0-width unclipped cell overflows right).
4. Screenshot that strip at rest.
5. Hover the label; wait into the visible half of the blink; assert `::after`
   `opacity` is `1`.
6. Screenshot the strip on hover and assert its pixels differ from rest — the
   caret actually paints there. This is the discriminator that catches the
   shipped no-op: under `width: 0; overflow: hidden` the glyph was clipped
   inside the 0-width box and never reached this strip (opacity alone read `1`
   in the buggy version, so it would not have caught it).
