# top-bar-overlap.spec.ts

Proves the top-bar overlap fixes (change 260715-q8ey): in the mid-width band
between the `sm` breakpoint (640px) and ~900px, the left breadcrumb crumbs
compress to an ellipsis and clip inside the nav box instead of overflowing and
painting over the centered `Window: <name>` heading. Specifically, it proves the
degradation ladder — long crumbs truncate (the `min-w-0` chain unblocks the
existing `truncate max-w-[16ch]`), the breadcrumb `<nav>` clips residual overflow
(`overflow-hidden` + an explicit `min-w-[76px] sm:min-w-[180px]` floor), the
server crumb hides below `md` and reappears at `md+` (the hierarchy ▾ covers its
navigation), and the center heading is never compressed into overlap (the center
grid track's `min-w-0` was removed so the `auto` column holds its content floor,
with the `sm:min-w-[28ch]` inner anchor kept at `sm:`). The 375px mobile leaf and
1024px+ desktop layouts are re-verified for no regression.

## Shared setup

- FILE-LEVEL `beforeAll` creates a dedicated tmux session on the isolated test
  server (`rk-test-e2e`, or `E2E_TMUX_SERVER`) with a deliberately LONG session
  name (`e2e-overlap-longsessionname-<ts>`, ~35 chars, well over the crumb's
  16ch cap) and a window with a deliberately LONG name
  (`overlap-verylongwindowname-<ts>`), so both the session crumb and the centered
  heading are under genuine truncation pressure in the overlap band. File-level
  `afterAll` kills the session.
- `resolveWindow(page, name)` polls `GET /api/sessions` until the CLI-created
  window surfaces in the backend snapshot, returning its stable `@N` id. It is a
  thin file-local wrapper over the shared `resolveWindow` in `_ready.ts` (hoisted
  from this file + `window-heading.spec.ts` — the server + session are bound
  here so the call sites keep their two-arg shape).
- `gotoWindow(page, id)` navigates to `/${server}/${encodedId}` and waits for
  the `Connected` indicator — likewise a thin wrapper over the shared
  `gotoWindow` in `_ready.ts`.
- `intersects(a, b)` is a rect-overlap helper (AABB test) used to assert the nav
  box and heading box share no area.
- Viewports: `MOBILE_VIEWPORT` 375×812, `MID_VIEWPORT` 700×800 (heart of the
  pre-fix overlap band), `DESKTOP_VIEWPORT` 1024×800 (>= `md`).

## Tests

### `at ~700px with long names the breadcrumb nav and center heading do NOT overlap; crumbs clip/ellipsis (no visible overflow)`

**What it proves:** The core regression is fixed — at 700px on a terminal route
with a long window name and a long session name, the left breadcrumb nav's
bounding box and the centered heading's bounding box do not intersect, and the
long session crumb is truncated (ellipsis) and clipped inside the nav box rather
than overflowing across the heading. No horizontal page overflow is introduced
at this width.

**Steps:**
1. Resolve the long-named window's id; set a 700×800 viewport; navigate to it.
2. Assert the `Breadcrumb` nav and the `Rename window <long>` heading are visible.
3. Compute both bounding boxes and assert they do NOT intersect (the overlap
   regression assertion).
4. Locate the session crumb trigger (`BreadcrumbDropdown`, accessible name
   "Switch session") and its inner name span (`min-w-0 truncate`); assert
   `scrollWidth > clientWidth` on that span (the name is truncated to an
   ellipsis, not shown at full width) while its text content is still the full
   session name (the ellipsis is visual only).
5. Assert the nav's computed `overflow-x` is `hidden` — the clip backstop is
   active, so content past the nav floor is clipped at the nav edge rather than
   painted over the heading (a clipped child legitimately keeps a layout box
   wider than its clipping parent, so the meaningful proof is the computed
   style + the no-overlap assertion in step 3, not a layout-box comparison).
6. Assert `document.body.scrollWidth ≤ 700` (no horizontal page overflow).

### `across the 375/640/700/768/1024 sweep the nav never overlaps the heading and the page never overflows horizontally`

**What it proves:** The tunable-floor sweep (intake assumption #6): the explicit
nav floor (`min-w-[76px] sm:min-w-[180px]`) plus `overflow-hidden` holds the
no-overlap invariant across the entire responsive band — not just at 700px —
and no width in the band introduces horizontal page overflow. This is the
harness that would surface a bad floor value (overlap → floor too small; page
overflow at a benign width → floor too large).

**Steps:**
1. Resolve the long-named window's id; navigate to it.
2. For each width in [375, 640, 700, 768, 1024], set a `<width>×800` viewport,
   wait for the heading, and assert: (a) if the nav has a box, it does NOT
   intersect the heading box; (b) `document.body.scrollWidth ≤ width` (no
   horizontal page overflow).

### `the server crumb is hidden below `md` and visible at `md+``

**What it proves:** The server-link crumb was demoted from `sm:` to `md:` — it is
hidden in the 640–768px band (where it is the redundant first-to-give element,
since the hierarchy ▾ covers Server Cabin → Cockpit navigation) and visible again
at `md+`.

**Steps:**
1. Resolve the long-named window's id. Locate the server crumb by its
   `href="/${server}"` scoped to the breadcrumb nav (its accessible name is the
   server text, so href disambiguates it from the brand link `/` and the
   hierarchy ▾ menuitem).
2. Set a 700px viewport; navigate; assert the nav is visible and the server
   crumb is hidden (in the DOM but CSS-hidden via `hidden md:flex`).
3. Set a 1024px viewport; assert the server crumb becomes visible.

### `375px mobile leaf layout is unchanged (single line, no horizontal overflow, crumbs hidden)`

**What it proves:** The change does not regress the 375px mobile leaf — both
crumbs hide below `sm` (session `sm:flex`, server `md:flex`), leaving only the
brand + centered heading; the top bar stays a single line with no horizontal
page overflow (the layout the mobile budget already relied on).

**Steps:**
1. Resolve the long-named window's id; set a 375×812 viewport; navigate (gating
   readiness on the heading, since the connection dot is `hidden sm:inline`).
2. Assert the heading is visible.
3. Assert the server crumb (`a[href="/${server}"]` in the nav) and the session
   crumb ("Switch session") are both hidden.
4. Assert `document.body.scrollWidth ≤ 375` (no horizontal overflow).
5. Assert the header's rendered height is under 56px (a wrap would roughly
   double the ~39px single-line chrome).

### `1024px+ has no regression: nav and heading do not overlap and the `sm:min-w-[28ch]` center anchor is intact`

**What it proves:** At desktop width the fix introduces no regression — the nav
and heading boxes still do not intersect, and the `sm:min-w-[28ch]` center anchor
was NOT demoted to `md:` (it still reserves its width, so the heading's left edge
stays anchored per 260714-uco1).

**Steps:**
1. Resolve the long-named window's id; set a 1024×800 viewport; navigate.
2. Assert the nav and heading are visible; assert their boxes do NOT intersect
   (desktop sanity, no regression while solving the mid-width band).
3. Query the anchored inner center box (the `div.sm:min-w-[28ch]` element) and
   assert its rendered width exceeds a conservative slack floor (>180px) —
   proving the `sm:` anchor is present and reserving width (not dropped to `md:`).

### `the session-switcher dropdown opens fully visible and hit-testable at 700px (nav clip does not swallow it)` / `… at 1024px …`

**What it proves:** The R2a regression guard (rework, review 260715). The nav's
`overflow-hidden` backstop (R2) is a further-out ancestor of the session crumb's
`BreadcrumbDropdown` menu. Before the fix the menu was `position: absolute`
inside the clipped nav, so opening it (a) clipped the menu to the nav's
single-line box and (b) the focus-on-open `scrollIntoView` dragged the whole nav
content off-screen (the open menu landed at y≈-75, hit-test empty). The fix
renders the menu `position: fixed` anchored to the trigger's viewport rect so it
escapes the nav's clip context. This is the exact case the closed-trigger tests
above missed — those only ever measured the crumb *trigger*, never an *open*
menu. Run as a two-width loop (700px = mid-band, 1024px = desktop) so the guard
covers both the pressured band and the roomy layout.

**Steps:**
1. Resolve the long-named window's id; set the viewport (700×800 or 1024×800);
   navigate to the terminal route.
2. Open the session switcher (click the ▾ crumb, accessible name "Switch
   session" — it is `sm:flex`, so present at both widths).
3. Assert the open `role="menu"` (name "Switch session") is visible and has a
   real on-screen bounding box: non-zero width/height, top-left at ≥0 (NOT
   scrolled off the top — the pre-fix symptom was y≈-75), and bottom/right
   within the viewport.
4. Assert hit-testability: `document.elementFromPoint` at the menu's center
   resolves to a node CONTAINED by the menu (nothing clips or covers it).
5. Assert the `+ New Session` action (a `menuitem`) is visible, has a real box,
   and is itself hit-testable at its center (the switcher's primary affordance
   is actually usable, not merely painted).
