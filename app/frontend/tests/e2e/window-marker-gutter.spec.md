# window-marker-gutter.spec.ts

Validates the left-gutter window marker axis (260718-3prk): clicking the gutter
cycles the 4-state marker and persists it via the `@rk_marker` tmux window
option, the gutter click does not select the row (stopPropagation), and
selecting a colored window renders a real family tint (deep-tint background) as
tint depth + typography with NO left border (the axis split removed the 4px
selection border).

## Shared setup

- `beforeAll` creates `e2e-marker-<timestamp>` so every test has its own
  isolated session; `afterAll` kills it.
- Tests run sequentially (`fullyParallel: false`).
- `resolveWindow(page, name)` polls `GET /api/sessions` until a window with the
  given name appears, returning its stable tmux window id (`@N`), index, and
  current `marker`. Rows are selected by `data-window-id="@N"` (unique for the
  window's lifetime; names collide and indices are reused).
- `expectMarker(page, name, expected)` polls the same snapshot until the named
  window's `marker` field equals `expected` — the marker persists as the
  `@rk_marker` window option and surfaces on the SSE window payload, so a UI
  cycle is observable server-side within a couple of poll cycles.
- The marker gutter is a POINTER-ONLY affordance (no ARIA button role — the
  command palette is the keyboard/touch path, intake #12); it is named for
  screen readers and test selection by its `aria-label` `Cycle window marker`
  (`getByLabel`).

## Tests

### `clicking the gutter cycles the marker and persists via @rk_marker`

**What it proves:** The gutter cycles empty→dotted→solid→double→empty on
repeated clicks, and each state persists as the `@rk_marker` window option
(read back through the sessions snapshot).

**Steps:**
1. Create `marker-win-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
3. `resolveWindow` the window; assert its row is visible and its marker is
   empty.
4. Click the row's `Cycle window marker` gutter; `expectMarker` → `dotted`.
5. Click again; `expectMarker` → `solid`.
6. Click again; `expectMarker` → `double`.
7. Click again; `expectMarker` → `` (double wraps back to empty/cleared).

### `gutter click does not select the row (stopPropagation)`

**What it proves:** A gutter click cycles the marker WITHOUT selecting the row —
the marker axis is independent of selection, and the click's `stopPropagation`
prevents the row-select handler and the URL writeback from firing.

**Steps:**
1. Create `marker-noselect-<ts>` via `execSync`.
2. Navigate to `/${TMUX_SERVER}` (dashboard) and wait for `Connected`.
3. `resolveWindow` the window; assert the row button is not `aria-current`.
4. Click the row's `Cycle window marker` gutter; `expectMarker` → `dotted`.
5. Assert the row button is still not `aria-current="page"` and the URL still
   has no window segment (`windowId.slice(1)`).

### `selecting a colored window applies the deep family tint with no left border`

**What it proves:** Selection is carried by tint depth + typography alone — a
selected colored row paints a REAL family tint background (not transparent) and
bold text, with NO left border (the 4px selection border was removed in the axis
split). Crucially the color is stored in the legacy vocabulary the backend
accepts, so the tint half is actually exercised (an earlier version set the
family name via the tmux CLI, which the backend dropped on read, leaving the row
uncolored and the tint assertion unwritten — the masking bug this fix closes).

**Steps:**
1. Create `marker-sel-<ts>` via `execSync`; navigate + wait for `Connected`.
2. `resolveWindow` it, then set `@color` = `"1+3"` (the LEGACY descriptor for the
   `orange` family — the vocabulary the picker maps to at the write seam and the
   backend validates) via the `POST /api/windows/{id}/options` endpoint the UI
   uses; assert the response is OK.
3. Click the row button; assert it becomes `aria-current="page"`.
4. Poll the button's computed `background-color` until it is a real color (not
   `rgba(0, 0, 0, 0)`), then assert it is not `transparent` — the orange family
   tint is actually painted.
5. Read the button's computed `border-left-width` — assert it is `0px` (no
   selection border).
6. Read the computed `font-weight` — assert it is ≥ 500 (`font-medium`, the
   typographic half of the selection cue).
