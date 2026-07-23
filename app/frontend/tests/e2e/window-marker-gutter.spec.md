# window-marker-gutter.spec.ts

Validates the window row's left-edge label zone (260719-hwtr, extended by
260723-wwoi): the whole 26px to the left of the status dot is ONE target that
opens a combined Label picker (colors + marker) — it does NOT cycle. Picking a
marker state (5-state closed set: dotted/dashed/solid/double/thick) persists via
the `@rk_marker` window option; picking a NORMAL-shade color persists via
`@color` in the legacy vocabulary (`familyToLegacy` write seam) while a
DARK-shade color persists as the verbatim `{family}-dark` value (no legacy form
exists); the zone click does not select the row (`stopPropagation`); and
selecting a colored window renders a real family tint (deep-tint background +
bold text) with NO left border (the axis split removed the 4px selection
border).

## Shared setup

- `beforeAll` creates `e2e-marker-<timestamp>` so every test has its own
  isolated session; `afterAll` kills it.
- Tests run sequentially (`fullyParallel: false`).
- `resolveWindow(page, name)` polls `GET /api/sessions` until a window with the
  given name appears, returning its stable tmux window id (`@N`), index, and
  current `marker`/`color`. Rows are selected by `data-window-id="@N"` (unique for
  the window's lifetime; names collide and indices are reused).
- `expectMarker(page, name, expected)` / `expectColor(page, name, expected)` poll
  the same snapshot until the named window's `marker` / `color` field equals
  `expected` — both persist as tmux window options (`@rk_marker` / `@color`) and
  surface on the SSE window payload, so a UI change is observable server-side
  within a couple of poll cycles.
- The left-edge label zone is a single target named for screen readers and test
  selection by its `aria-label` `Set window label` (`getByLabel`). Clicking it
  opens the combined picker, a `role="listbox"` named `Label picker`, whose 20
  color swatches (paired shade grid) are `role="option"` `Color <family>` /
  `Color <family>-dark` and whose 6 marker cells are `role="option"`
  `Marker <state>` (`none`/`dotted`/`dashed`/`solid`/`double`/`thick`). Color
  locators use `exact: true` — Playwright's accessible-name matching is
  substring-based, so `Color orange` would otherwise also match
  `Color orange-dark`.

## Tests

### `the label zone opens the combined picker; picking a marker persists via @rk_marker (no cycling)`

**What it proves:** The left-edge zone opens the combined picker (not a cycle);
picking a marker state directly persists it as `@rk_marker`, ANY state is
reachable in one pick (no stepping through intermediate states), and the two
260723-wwoi additions (`dashed` = "working", `thick` = "completed") round-trip
through the widened backend closed set exactly like the original three.

**Steps:**
1. Create `marker-win-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` the window; assert its row is visible and its marker is empty.
4. Click the row's `Set window label` zone; assert the `Label picker` listbox is
   visible.
5. Click the `Marker solid` option; `expectMarker` → `solid`.
6. Re-open the picker; click `Marker double`; `expectMarker` → `double` (reached
   directly, not by cycling through intermediate states).
7. Re-open the picker; click `Marker dashed`; `expectMarker` → `dashed` (new
   state persists through the widened closed set).
8. Re-open the picker; click `Marker thick`; `expectMarker` → `thick` (the
   hazard-wedge pairing's state persists too).
9. Re-open the picker; click `Marker none`; `expectMarker` → `` (cleared).

### `picking a color persists via @color — normal shade through the legacy seam, dark shade verbatim`

**What it proves:** The combined picker's color section writes through the
`familyToLegacy` seam — picking the `orange` family (normal shade) persists
`@color` as the legacy descriptor `1+3` (the vocabulary pre-existing colors are
stored in), not the family name — while picking `orange-dark` persists the
verbatim `orange-dark` value: dark shades have no legacy form and the backend's
`ValidateColorValue`/`NormalizeColorValue` accept the family-name vocabulary.

**Steps:**
1. Create `marker-color-<ts>` via `execSync`; navigate + wait for `Connected`.
2. `resolveWindow` it; assert its color is empty.
3. Click the `Set window label` zone; assert the `Label picker` listbox is
   visible.
4. Click the `Color orange` option (`exact: true` — `Color orange-dark` sits
   beside it in the paired grid); `expectColor` → `1+3`.
5. Re-open the picker; click `Color orange-dark` (`exact: true`); `expectColor`
   → `orange-dark`.

### `clicking the label zone does not select the row (stopPropagation)`

**What it proves:** Clicking the zone opens the picker WITHOUT selecting the row —
the label target is independent of selection, and the click's `stopPropagation`
prevents the row-select handler and the URL writeback from firing.

**Steps:**
1. Create `marker-noselect-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` (dashboard) and wait for `Connected`.
3. `resolveWindow` the window; assert the row button is not `aria-current`.
4. Click the row's `Set window label` zone; assert the `Label picker` listbox is
   visible.
5. Assert the row button is still not `aria-current="page"` and the URL still
   has no window segment (`windowId.slice(1)`).

### `selecting a colored window applies the deep family tint with no left border`

**What it proves:** Selection is carried by tint depth + typography alone — a
selected colored row paints a REAL family tint background (not transparent) and
bold text, with NO left border (the 4px selection border was removed in the axis
split). The color is stored in the legacy vocabulary the backend accepts, so the
tint half is actually exercised.

**Steps:**
1. Create `marker-sel-<ts>` via `execSync`; navigate + wait for `Connected`.
2. `resolveWindow` it, then set `@color` = `"1+3"` (the LEGACY descriptor for the
   `orange` family) via the `POST /api/windows/{id}/options` endpoint the UI
   uses; assert the response is OK.
3. Click the row button; assert it becomes `aria-current="page"`.
4. Poll the button's computed `background-color` until it is a real color (not
   `rgba(0, 0, 0, 0)`), then assert it is not `transparent` — the orange family
   tint is actually painted.
5. Read the button's computed `border-left-width` — assert it is `0px` (no
   selection border).
6. Read the computed `font-weight` — assert it is ≥ 500 (`font-medium`, the
   typographic half of the selection cue).
