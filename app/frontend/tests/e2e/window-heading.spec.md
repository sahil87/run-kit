# window-heading.spec.ts

Proves the universal, centered top-bar page heading (change 260703-5ilm's
editable window heading, extended by 260704-pr0p into a `PageType: name` heading
on every route with the boot-sweep animation): the current tmux window name is
the prominent centered identity on the Terminal route (prefixed by the static
`Window:` per 260714-uco1, which replaced the retired lens-following
`Terminal:`/`Web:`/`Chat:` prefix), renaming happens in place (click → inline
input, Enter/blur commit, Escape cancel), the command-palette rename path enters
the same inline edit, the 375px bar stays single-line, the hover-animation
vocabulary classes are present and CSS-gated under `prefers-reduced-motion`, and
the same centered heading fills the Server Cabin (`Server Cabin: <server>`,
display-only), the Board (`Board: <name>` + relocated ▾ switcher, display-only)
and the Cockpit (solo `Cockpit`) — with the retired in-page PageHeading row's
bracket idiom now carried by the Cockpit's `<h2>` section headings. A separate
260714-uco1 block asserts the four top-bar heading-nav sub-features: the stable
left anchor (the heading's left edge does not drift with name length), the
static `Window:` prefix, the ancestor hierarchy dropdown, and the browser-history
◀ ▶ arrows. A motion-opted-in block additionally asserts the boot sweep itself
runs on hover (an inverse-video cursor cell attaches inside the top-bar header,
then resolves to rest).

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
4. Assert the static `Window:` page-type prefix (260714-uco1) is visible — its
   `Window` word run is the stable locator, since the hierarchy ▾ splits the
   prefix between the word and its colon (`Window ▾:`) — and is NOT contained
   inside the rename button; it is a sibling span, so clicking it never starts
   an edit (the edit input binds only to the name).

### `root route shows the centered `Server Cabin: <server>` heading (not a left leaf crumb)`

**What it proves:** Move-don't-copy (260704-pr0p): on the Server Cabin
(`/$server`, no window) the server name is the CENTERED `Server Cabin: <server>`
heading, display-only (no rename), and is NOT duplicated as a left breadcrumb
leaf crumb — the left breadcrumb ends at its parent.

**Steps:**
1. Navigate to `/${server}`.
2. Assert the `Server Cabin <server>` heading (its accessible name carries the
   type prefix) is visible.
3. Assert there is no `Rename window …` button (the server name is display-only).
4. Assert the `Breadcrumb` nav does NOT contain the server name.

### `cockpit route (/) shows the solo `Cockpit` center heading and bracket section headings`

**What it proves:** The Cockpit `/` carries the solo `Cockpit` center heading
(no prefix, no instance name) in the top bar; the old in-page `[ cockpit ]`
PageHeading `<h1>` row is gone; and the bracket idiom transferred to the zone
`<h2>` section headings (brackets `[`/`]` + reserved `▊` caret cell around a
TypedLabel — 260704-pr0p).

**Steps:**
1. Navigate to `/`.
2. Assert the solo `Cockpit` heading is visible.
3. Assert there is no `<h1>` on the page (the PageHeading row was removed).
4. Locate the `Host Health` `<h2>` section heading; assert its enclosing
   `.rk-bracket-group` carries the `[`/`]` bracket spans, a reserved
   `.rk-bracket-caret` cell, and a `.rk-typed-label` whose text is the label.

### `board route shows the centered `Board: <name>` heading + relocated ▾ switcher (name display-only, no left `Board ▸`)`

**What it proves:** Move-don't-copy (260704-pr0p): on a board route
(`/board/$name`) the board name is the CENTERED `Board: <name>` heading with the
▾ board switcher relocated beside it (moved out of the left breadcrumb),
display-only (no rename — boards have no rename API), and neither the board name
nor the old left `Board ▸` home button appears in the left breadcrumb.

**Steps:**
1. Create a window, pin it to a board via `POST /api/boards/<board>/pin` (the
   deterministic API seam), then navigate to `/board/<board>`.
2. Assert the `Board <name>` heading (its accessible name carries the type
   prefix) is visible.
3. Assert the relocated ▾ board switcher (`Switch board`) is visible beside it.
4. Assert there is no `Rename window …` button (the board name is display-only).
5. Assert the `Breadcrumb` nav does NOT contain the board name and does NOT
   contain the old left `Board ▸` home button (move-don't-copy).
6. Cleanup: unpin the window via `POST /api/boards/<board>/unpin` so the empty
   board disappears and the shared server stays clean (`finally`).

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
6. Assert truncation is left-anchored, not center-clipped: the name lives in
   an inner `truncate` span whose bounding box fits inside the button's box
   (under the old bug — `truncate` on the flex button itself — the text box
   overhung both ends, cutting the head of the name with no ellipsis), and the
   span still carries the full name as text (the ellipsis is visual only).

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

## Tests — top-bar heading anchor + nav (260714-uco1)

*(A separate describe block in the same file, sharing the file-level session
lifecycle. Covers the four heading sub-features added by 260714-uco1.)*

### `the heading's left edge does not drift as the window name length changes within the anchor band (sm+)`

**What it proves:** the stable left anchor — the center heading's inner container
carries a `sm:`-gated min-width (~28ch) with left-aligned content, so for names
WITHIN that reserved band the heading's left edge stays put as the name
grows/shrinks (it no longer recenters with name length). Names longer than the
band grow rightward and the centered box drifts — an accepted tradeoff (intake
#1) — so the test deliberately exercises the band, not arbitrarily long names.

**Steps:**
1. Create two windows in the same session with different (band-fitting) name
   lengths.
2. Set a desktop viewport (1200px) so the `sm:` min-width anchor is active.
3. Navigate to the shorter-named window; record the `Window` prefix word run's
   left x (the leftmost prefix text — the anchor under test).
4. Navigate to the longer-named window; record the prefix word run's left x.
5. Assert the two x values differ by ≤2px (the anchor held; no drift).

### the heading prefix is a static `Window:` on the terminal route (all lenses)

**What it proves:** the terminal-route heading prefix is a static `Window:`, never
the retired lens-following `Terminal:`/`Web:`/`Chat:`.

**Steps:**
1. Create a plain window; navigate to it.
2. Assert the `Window` prefix word run is visible (the hierarchy ▾ splits the
   prefix between the word and its colon, so the assertion targets the `Window`
   word) and that no `Terminal:`/`Web:`/`Chat:` text is present.

### `the hierarchy ▾ lists the ancestor chain and navigates up (Server Cabin → Cockpit)`

**What it proves:** the prefix hierarchy dropdown lists exactly the current page's
ancestors (Server Cabin then Cockpit on a window route — no window/lateral
entries) and navigates up when an ancestor is chosen.

**Steps:**
1. Create a window; navigate to it.
2. Open the `Switch hierarchy` ▾; assert the `Server Cabin: <server>` and
   `Cockpit` menuitems are visible.
3. Click the `Server Cabin: <server>` item; assert the URL is `/<server>` and the
   `Server Cabin <server>` heading is visible (the up-navigation landed).

### `the ◀ ▶ arrows drive browser history (back returns to the prior window)`

**What it proves:** the ◀ ▶ arrows drive BROWSER HISTORY (`router.history.back()`
/`.forward()`), NOT sibling-window cycling.

**Steps:**
1. Create two windows; build a real history stack by visiting the first then the
   second.
2. Click `Go back`; assert the URL and heading return to the FIRST window.
3. Click `Go forward`; assert the URL and heading return to the SECOND window.

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

### `terminal page heading runs the boot sweep on hover: cursor cell attaches, then resolves to rest`

*(Also in the "animated path" block — the boot sweep is JS-gated on the same
`prefers-reduced-motion` query as the typed sweep, so asserting it needs the
motion opt-in.)*

**What it proves:** The universal top-bar page heading (260704-pr0p) actually
runs its combined boot sweep on hover: an inverse-video accent-green cursor cell
(`.rk-typed-cursor`) attaches inside the top-bar header while the sweep runs,
then the sweep resolves back to plain text (cursor cell gone) with the
accessible name intact. All assertions are DOM-observable frame states — no
pixel diffs (honoring the "NO pixel assertions" e2e constraint). The sweep is
driven by a DISPATCHED `mouseover`/`mouseout` pair (React derives the button's
`onMouseEnter`/`onMouseLeave` from delegated `mouseover`/`mouseout`), the same
churn-proof seam the typed-sweep test uses, avoiding real hit-testing flake.

**Steps:**
1. Create + navigate to a window; confirm the `Rename window <name>` heading is
   visible.
2. Wait ~1200ms for the mount-replay sweep (which auto-plays once on navigation)
   to settle, then assert no `.rk-typed-cursor` remains inside the header (a
   clean rest baseline before the hover pass).
3. Dispatch `mouseover` on the heading; assert an `.rk-typed-cursor` cell
   attaches inside `header` (the sweep started — scoped to the header so the
   sidebar TypedLabels aren't mistaken for it; `playDeferred` waits the 140ms
   hover-intent before the first frame).
4. Dispatch `mouseout`; assert no `.rk-typed-cursor` cell remains inside the
   header (the sweep resolved to rest) and the heading text still equals the
   window name (the accessible name never churned).
