# window-marker-gutter.spec.ts

Validates the window row's left-edge label zone (260719-hwtr, extended by
260723-wwoi, reworked by 260819-9hh6): the whole 26px to the left of the status
dot is ONE target that opens the banded Label picker (color · marker · flair
bands under a composite preview row) — it does NOT cycle. Picking a marker
state (8-state closed set: pipe/dotted/dashed/solid/double/thick/hatch/block)
persists via the `@rk_marker` window option; picking a NORMAL-shade color
persists via `@color` in the legacy vocabulary (`familyToLegacy` write seam)
while a DARK-shade color persists as the verbatim `{family}-dark` value;
picking a flair (12-state closed set, rain/scan leading) persists via
`@rk_flair`. The picker STAYS OPEN across picks (the dismissal contract —
selection never closes; the ✕ cell, an outside click, or Escape dismisses), so
combos are toggled live in one open session; each band's header − clears ONLY
its own axis; hatch rows carry the static hazard wedge while thick/double/
dashed rows are texture-free (the motion split — rain and scan moved to the
flair axis); the zone click does not select the row (`stopPropagation`); and
selecting a colored window renders a real family tint (deep-tint background +
bold text) with NO left border (the axis split removed the 4px selection
border).

## Shared setup

- `beforeAll` creates `e2e-marker-<timestamp>` so every test has its own
  isolated session; `afterAll` kills it.
- Tests run sequentially (`fullyParallel: false`).
- `resolveWindow(page, name)` polls `GET /api/sessions` until a window with the
  given name appears, returning its stable tmux window id (`@N`), index, and
  current `marker`/`color`/`flair`. Rows are selected by `data-window-id="@N"`
  (unique for the window's lifetime; names collide and indices are reused).
- `expectMarker` / `expectColor` / `expectFlair` (all via the shared
  `expectWindowField` helper) poll the same snapshot until the named window's
  `marker` / `color` / `flair` field equals `expected` — they persist as tmux
  options (`@rk_marker` / `@color` / `@rk_flair`) and surface on the SSE window
  payload, so a UI change is observable server-side within a couple of poll
  cycles.
- `openLabelPicker(row, page)` clicks the row's `Set tab label` zone and
  returns the visible `Label picker` listbox.
- The left-edge label zone is a single target named for screen readers and test
  selection by its `aria-label` `Set tab label` (`getByLabel`). The banded
  picker is a `role="listbox"` named `Label picker`: the color band's 20
  swatches (2 shade rows × 10 family columns in a horizontal scroll strip) are
  `role="option"` `Color <family>` / `Color <family>-dark`; the marker band's 8
  static cells are `Marker <state>`; the flair band's 12 live cells are `Flair
  <state>`; and each band header's right-aligned − clear cell is an option
  named `Clear color` / `Marker none` / `Flair none` (ringed —
  `aria-selected` — while its axis is unset). The band headers match as the
  bracketed text `[ color ]` / `[ marker ]` / `[ flair ]`. Color locators use
  `exact: true` — Playwright's accessible-name matching is substring-based, so
  `Color orange` would otherwise also match `Color orange-dark`.
- Row-overlay assertions (`div.rk-hazard`, `.rk-flair-rain`, …) are scoped as
  DIRECT children of the row root (`row.locator(":scope > …")`) because the
  open picker mounts inside the row's DOM and its preview/band cells render the
  same overlay classes.

## Tests

### `the label zone opens the banded picker; picking a marker persists via @rk_marker (no cycling)`

**What it proves:** The left-edge zone opens the banded picker (not a cycle);
the band chrome names all three axes (`[ color ]` / `[ marker ]` / `[ flair ]`
headers) and rings the marker header − while the axis is unset; picking a
marker state directly persists it as `@rk_marker`, ANY state is reachable in
one pick (no stepping), the three 9hh6 categorical additions (`pipe`, `hatch`,
`block`) round-trip through the widened backend closed set exactly like the
original five, the header − clears the axis, and the picker stays open across
every pick (one open session), closing only via the ✕ cell.

**Steps:**
1. Create `marker-win-<ts>` via the shared `_tmux` helper.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` the window; assert its row is visible and its marker is empty.
4. Click the row's `Set tab label` zone; assert the `Label picker` listbox
   is visible. (The picker is opened ONCE — all following picks happen inside
   this one open session.)
5. Assert the three band headers render (`color` / `marker` / `flair` text) and
   the `Marker none` header − is `aria-selected` (axis unset ring).
6. Click the `Marker solid` option; `expectMarker` → `solid`.
7. Click `Marker double`; `expectMarker` → `double` (reached directly, not by
   cycling through intermediate states).
8. Click `Marker pipe`, `Marker hatch`, `Marker block` in turn;
   `expectMarker` follows each (the widened closed set persists the new
   categorical states).
9. Click the `Marker none` header −; `expectMarker` → `` (cleared) — the
   picker is still open.
10. Click the `Close picker` (✕) cell; assert the listbox is no longer visible.

### `hatch rows carry the hazard wedge; thick/double rows are texture-free (the motion split)`

**What it proves:** The hazard-wedge texture pairing moved thick → hatch: a
hatch row mounts `.rk-hazard`, a thick row mounts nothing, and no marker mounts
the retired rain/scanline motion (`.rk-dash-rain` / `.rk-scanlines*` are gone
from the marker axis entirely).

**Steps:**
1. Create `marker-texture-<ts>`; navigate + wait for `Connected`;
   `resolveWindow` it.
2. Open the picker; click `Marker hatch`; `expectMarker` → `hatch`; assert the
   row mounts `.rk-hazard`.
3. Click `Marker thick`; `expectMarker` → `thick`; assert the row has NO
   `.rk-hazard`, no `.rk-dash-rain`, no `[class*='rk-scanlines']`.
4. Click `Marker dashed`; `expectMarker` → `dashed`; assert no `.rk-dash-rain`
   (the rain is a flair now).
5. Close via the ✕ cell.

### `rain + scan are FLAIRS: they persist via @rk_flair and compose with any marker`

**What it proves:** The two migrated motion treatments live on the flair axis:
picking `Flair rain` / `Flair scan` persists `@rk_flair` and mounts the
always-on overlay on the row alongside ANY marker (rain composes with its old
owner, dashed), and the flair header − clears only the flair axis.

**Steps:**
1. Create `marker-flair-<ts>`; navigate + wait for `Connected`;
   `resolveWindow` it.
2. Open the picker; click `Flair rain`; `expectFlair` → `rain`.
3. Click `Marker dashed`; `expectMarker` → `dashed`; assert the row mounts
   `.rk-flair-rain` (composed with the marker).
4. Click `Flair scan`; `expectFlair` → `scan`; assert the row mounts
   `.rk-flair-scan`.
5. Click the `Flair none` header −; `expectFlair` → `` while
   `expectMarker` stays `dashed` (axes are independent).
6. Close via the ✕ cell.

### `picking a color persists via @color — normal shade through the legacy seam, dark shade verbatim`

**What it proves:** The banded picker's color band writes through the
`familyToLegacy` seam — picking the `orange` family (normal shade) persists
`@color` as the legacy descriptor `1+3` (the vocabulary pre-existing colors are
stored in), not the family name — while picking `orange-dark` persists the
verbatim `orange-dark` value: dark shades have no legacy form and the backend's
`ValidateColorValue`/`NormalizeColorValue` accept the family-name vocabulary.

**Steps:**
1. Create `marker-color-<ts>` via the shared `_tmux` helper; navigate + wait for `Connected`.
2. `resolveWindow` it; assert its color is empty.
3. Click the `Set tab label` zone; assert the `Label picker` listbox is
   visible.
4. Click the `Color orange` option (`exact: true` — `Color orange-dark` sits in
   the same family column); `expectColor` → `1+3`.
5. In the SAME open session (the picker stays open after a pick), click
   `Color orange-dark` (`exact: true`); `expectColor` → `orange-dark`.
6. Click the `Close picker` (✕) cell; assert the listbox is no longer visible.

### `the composite preview mirrors the live combo (tint + name + caption)`

**What it proves:** The banded picker's composite preview row shows the
target row's real name, and the combo caption under it names the live combo —
`∅ · ∅ · ∅` on a fresh window, `teal · hatch · scan` after one pick per axis —
repainting immediately inside the single open session.

**Steps:**
1. Create `marker-preview-<ts>`; navigate + wait for `Connected`;
   `resolveWindow` it.
2. Open the picker; assert the preview shows the window's name and the caption
   reads `∅ · ∅ · ∅`.
3. Click `Color teal` (exact), `Marker hatch`, `Flair scan`; assert the caption
   reads `teal · hatch · scan`.
4. Close via the ✕ cell.

### `clicking the label zone does not select the row (stopPropagation)`

**What it proves:** Clicking the zone opens the picker WITHOUT selecting the row —
the label target is independent of selection, and the click's `stopPropagation`
prevents the row-select handler and the URL writeback from firing.

**Steps:**
1. Create `marker-noselect-<ts>` via the shared `_tmux` helper.
2. Navigate to `/${TMUX_SERVER}` (dashboard) and wait for `Connected`.
3. `resolveWindow` the window; assert the row button is not `aria-current`.
4. Click the row's `Set tab label` zone; assert the `Label picker` listbox is
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
1. Create `marker-sel-<ts>` via the shared `_tmux` helper; navigate + wait for `Connected`.
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
