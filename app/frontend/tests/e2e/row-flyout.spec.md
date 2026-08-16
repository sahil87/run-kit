# row-flyout.spec.ts

Verifies the **sidebar row-hover register flyout card** and the **rest-state PR
glyph** (93dy) — the one status-detail surface that replaced the per-dot
`StatusDotTip` hover-card (whose `status-dot-tip.spec.ts` this file replaces):
the card opens on whole-row hover at a fixed x (the sidebar's right edge), on
keyboard row focus, and on coarse-pointer dot-tap; it carries the four-register
view plus the PR/docs links; a window with an owned PR shows a rest-state
git-pull-request glyph that swaps for the pin/✕ actions on hover (fine
pointers). It also covers the card's **conversation-fork link** (260806-s4av) —
gated on the window carrying a `claude` chat, POSTing the window-keyed fork
endpoint, and navigating to the returned window — and the **coarse-pointer
parity + slide-to-scrub gesture** (ys3q): on touch the rest glyph stays
visible, the pin/✕ cluster relocates into the card as Pin/Kill action rows,
the dot's leading tap zone widens to the touch-target convention, and a
press-and-slide from the zone retargets the single-open card across rows.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads (the retired
  `status-dot-tip.spec.ts` idiom):
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (window-select POSTs don't error).
  - `/ws/terminals` WebSocket → accepted and held open.
  - `/ws/state` (via `mockStateSocket`) → a session `dev` (carrying the new
    `sessionId` / `sessionPath` fields) with two windows:
    - `@1` "feature-work" — change-bound (`fabChange`/`fabStage`), a waiting
      agent (`agentState: waiting`, `3m`), a reconciled claude chat
      (`chatProvider: claude` + a uuid `chatSessionRef`), and an owned open PR
      (`prNumber: 386`, `prUrl`, `prState: open`, `prChecks: pass`,
      `prReview: approved`, fresh `prFetchedAt`) → blue
      "building — active — agent waiting 3m" dot (the PR never owns the dot —
      compositional vocabulary), rest PR glyph, full four-register card, fork
      link, and a two-pane list (`%425` active) so the identity title bar
      renders its full `Window @1 · pane %425 · 2 panes` form.
    - `@2` "scratch-shell" — plain window → gray "idle" dot, no glyph,
      out-register-only card, no fork link, no panes (the title bar degrades to
      `Window @2`).
- Rows are located by `[role='treeitem'][data-window-id]`; the card by
  `data-testid="row-flyout-card"`; registers/links by `row-flyout-out|agt|fab|
  pr|checked|pr-link|docs-link|fork-link`; the card's Pin/Kill action rows by
  `row-flyout-pin-action` / `row-flyout-kill-action`; the glyph by
  `row-pr-glyph`; the dot's tap wrapper by `status-dot-tap`.
- The coarse-pointer describe additionally mocks `(pointer: coarse)` via
  `matchMedia` (Playwright desktop Chromium cannot flip the real pointer media
  feature — the `tooltips.spec.ts` precedent) and enables `hasTouch` so `tap()`
  dispatches real touch input.

## Tests

### `hovering a row opens the register card at the sidebar's right edge`

**What it proves:** whole-row hover (350ms delay) opens the flyout card
anchored at the sidebar's right edge and vertically aligned to the hovered row.
Its first element is the **identity title bar** (`Window @1 · pane %425 · 2
panes` — the tmux window id, the active pane's id, and the pane count, in the
inset-bar treatment), carrying the fork + docs affordances on its right edge;
the dot label is demoted to the first body line, followed by the four registers
(`out`/`agt`/`fab`/`pr`), the "checked Xs ago" freshness line, and the PR link.
The `pr` register line is itself the open-first anchor (the panel's PrLinkRow
idiom): it wraps the colored segments, ends in an always-visible inline `↗`,
and opens the PR in a new tab (`noopener noreferrer`).

**Steps:**
1. Hover the `@1` row; assert the card is visible.
2. Assert the title bar contains "Window @1 · pane %425 · 2 panes" and holds
   the docs + fork links; assert the title text precedes the dot-label text
   ("building — active — agent waiting 3m" — hue word + status word + waiting
   suffix, no PR words) in the card, and each register testid shows its
   expected content (`waiting 3m`, the fab id·slug·stage·state line, `#386`,
   the freshness line).
3. Assert the pr-register anchor wraps the segments (`#386`, `↗`), carries
   the "Open PR #386 in a new tab" aria-label + href/target/rel, and the docs
   link href.
4. Assert the row-aligned notch: the card's arrow SVG is present and its
   vertical center falls inside the hovered row's band (the E1 connection
   cue — the notch points at the row that owns the card).
5. Compare bounding boxes: the card's x ≥ the sidebar `<aside>`'s right edge,
   and the card vertically overlaps the hovered row (±8px).
6. Assert no line paints outside the `max-w-xs` card box: the card's
   `scrollWidth` does not exceed its `clientWidth` (the long mocked fab
   register would overflow without the register lines' `truncate`).

### `moving between rows retargets the card (warm window, single card)`

**What it proves:** sweeping the pointer to a sibling row closes the first card
and opens the sibling's (the shared warm-window delay scope) — only one card
exists at a time, and the content follows the hovered row (the scratch row's
card has no PR link). It also proves the title's **degradation**: the pane-less
scratch window's title bar reads `Window @2` alone, with no pane segment.

**Steps:**
1. Hover `@1`; assert the card shows "building — active".
2. Hover `@2`; assert exactly one card exists, containing "idle", with zero
   PR links, and its title bar reads "Window @2" without any "pane" segment.

### `the fork link renders only on a claude-chat row and POSTs the fork endpoint`

**What it proves:** the conversation-fork affordance (260806-s4av) is gated on the
window carrying a reconciled `claude` chat, its tooltip names the same-directory
semantics, and clicking it POSTs the window-keyed `POST
/api/windows/{windowId}/fork` endpoint — with no body, since every other input is
derived server-side — without selecting or navigating the underlying row.

**Steps:**
1. Hover `@1` (the claude-chat window); assert the fork link is visible and its
   `title` mentions "same directory".
2. Hover `@2` (a plain shell window, no `chatProvider`); assert the card is the
   scratch one ("idle") and carries zero fork links.
3. Route `**/api/windows/*/fork*` to a 200 recording each request URL, returning
   an EMPTY `windowId` so the app deliberately skips navigation (the best-effort
   window-id contract) and the assertion stays on this route.
4. Hover `@1` again and click the fork link; assert exactly one fork request
   fired and its decoded URL is `/api/windows/@1/fork` (window-keyed, the source
   window's id in the path).
5. Assert the URL is still `/default` — forking never also selects the row.

### `a successful fork navigates to the returned window`

**What it proves:** the other half of the fork's navigation contract — a fork
returning a NON-empty `windowId` routes the app to that window's
`/$server/$window` URL, the same navigation the spawn dialog performs with a riff
result. (The empty-`windowId` skip is proven by the test above.)

**Steps:**
1. Route `**/api/windows/*/fork*` to a 200 returning `windowId: "@9"`.
2. Hover `@1` and click the fork link.
3. Assert the URL becomes `/default/9` — `@9` with the route's `@` stripped.

### `clicking the card's PR link does not select/navigate the window row`

**What it proves:** the PR link's `stopPropagation` guard — activating a card
link never selects the underlying row (the SPA URL stays on the server route).

**Steps:**
1. Hover `@1`; wait for the PR link.
2. Remove the link's `href` (so no real new-tab navigation) and click it.
3. Assert the URL is still `/default` (no window route).

### `keyboard: focusing the row opens the card; Tab reaches its links; Escape dismisses it`

**What it proves:** the card opens on row focus (the roving-tabindex treeitem —
Constitution V, replacing the retired dot `tabIndex` stop); the card's links
are Tab-reachable from the focused row (`FloatingFocusManager modal={false}` +
the portal's tab-order guards — Constitution V again: the PR/docs links must
not be mouse-only); Escape closes it (floating-ui `useDismiss`) with focus
returning into the row so arrow-key tree nav continues.

**Steps:**
1. Focus the `@1` row element; assert the card is visible with
   "building — active".
2. Press Tab (up to 6 times, walking the row's action icons first) and assert
   the docs link receives focus; one more Tab focuses the PR link.
3. Press Escape (focus inside the card); assert the card is removed and the
   active element is the row or a descendant of it.

### `rest PR glyph shows for an owned PR and hover swaps it for the actions`

**What it proves:** the user-approved partial Row-Minimalism reversal — a row
with an owned PR carries a rest-state git-pull-request glyph in the far-right
(✕) slot; on hover it display-swaps away while the kill ✕ takes the slot; the
no-PR row never shows a glyph; leaving the row restores it.

**Steps:**
1. At rest: assert `@1`'s glyph is visible and `@2` has none.
2. Hover `@1`: assert the glyph is hidden and the kill button's computed
   opacity is 1 (the opacity-revealed action now owns the slot).
3. Hover `@2`: assert `@1`'s glyph is visible again.

### `rest PR glyph is visible and pin/✕ are gone at rest; dot-tap opens the card without selecting the row` *(coarse describe)*

**What it proves:** the mobile parity change (ys3q) — on coarse pointers the
rest-state PR glyph IS visible (the pin/✕ cluster is render-gated off: the
buttons are absent from the DOM, not merely hidden, so they are neither
visible nor hittable nor focusable on touch); the dot's leading tap zone is a
real ≥32×36px touch target; tapping it opens the card (which now carries the
Pin/Kill action rows) WITHOUT selecting the row; tapping the row body still
selects (navigates) and never hover-opens a card.

**Steps:**
1. With the coarse mock + `hasTouch`: coarse ⇒ `useIsMobile()` ⇒ the sidebar
   is a closed drawer, so first open it via the "Toggle navigation" hamburger
   (the mobile-layout.spec.ts idiom).
2. Assert `@1`'s glyph is visible, `@2` has none, and `@1` contains NO
   pin/kill buttons.
3. Measure `@1`'s dot tap zone: width ≥ 32px, height ≥ 36px.
4. Tap the zone: assert the card opens with "building — active", carries the
   `row-flyout-pin-action` and `row-flyout-kill-action` rows, and the URL is
   still the bare server route (the tap did not select the row).
5. Escape-dismiss the card, tap `@2`'s row body: assert the URL left the bare
   server route (tap = select) and, after waiting past the 350ms open delay,
   no card appeared.

### `card kill row opens the existing kill confirmation dialog (no force-kill on touch)` *(coarse describe)*

**What it proves:** the card's Kill action row routes through the EXISTING
`KillDialog` confirmation path — no new kill path, no confirm bypass (there is
no modifier-force on touch) — and activating it never selects the row.

**Steps:**
1. Route `**/api/windows/*/kill*` to a 200 that records each request.
2. Open the drawer, tap `@1`'s dot tap zone to open the card.
3. Tap the card's Kill action row: assert the "Kill window?" dialog is
   visible, ZERO kill requests have fired, and the URL is still `/default`.
4. Tap Cancel: assert the dialog closes and still no kill request fired.

### `card pin row closes the card and opens the existing pin popover` *(coarse describe)*

**What it proves:** the card's Pin action row closes the card and hands off to
the row's existing `PinPopover` (popover-over-flyout precedence is pre-wired
via the flyout's `suppressed` gate) — the coarse pin path — without selecting
the row.

**Steps:**
1. Open the drawer, tap `@1`'s dot tap zone to open the card.
2. Tap the card's Pin action row.
3. Assert the card is gone, the "Pin window to board" dialog is visible, and
   the URL is still `/default`.

### `scrub: press + slide retargets the single card across rows; release keeps it; tap-elsewhere dismisses` *(coarse describe)*

**What it proves:** the slide-to-scrub gesture (ys3q) — pointerdown on the tap
zone opens that row's card and captures the pointer; sliding across a sibling
row retargets the single-open card (one card at a time); releasing keeps the
last card open; the gesture never selects or navigates a row; and the existing
outside-press dismissal still works afterwards.

**Steps:**
1. Open the drawer; move the mouse to the center of `@1`'s tap zone and press
   (mouse.down dispatches pointerdown — the scrub trigger under the coarse
   mock).
2. Assert the card opens with "building — active".
3. Slide (mouse.move, still pressed) onto `@2`'s row: assert exactly one card,
   now showing "Window @2", and the URL still `/default` (no navigation).
4. Release (mouse.up): assert the @2 card stays open and the drawer/rows are
   still visible.
5. Click a neutral spot in the main content: assert the card is dismissed.
