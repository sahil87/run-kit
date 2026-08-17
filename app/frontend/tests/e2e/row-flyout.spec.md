# row-flyout.spec.ts

Verifies the **sidebar row-hover register flyout card**, the **rest-state PR
glyph** (93dy), and the **right-edge status rail** (b8eu, three-tiered in
260817-ve5m) — the one
status-detail surface that replaced the per-dot `StatusDotTip` hover-card
(whose `status-dot-tip.spec.ts` this file replaces): the card opens on
whole-row hover at a fixed x (the sidebar's right edge) on fine pointers and
BELOW the row (`bottom-start`, width-capped short of the rail) on coarse
pointers, on keyboard row focus, and on coarse-pointer rail-tap/dot-tap; it
carries the four-register view plus the PR/docs links; a window with an owned
PR shows a rest-state git-pull-request glyph that swaps for the pin/✕ actions
on hover (fine pointers) and lives in the rail's fixed 16px slot on coarse. It
also covers the card's **sectioned action rows** — change color / fork / pin /
kill, one row per action with a sub-hint, on BOTH pointer worlds (the title
bar carries only the ⓘ docs link; `Change color…` is the FIRST row of every
tier's card, 260817-ve5m). The **conversation-fork
action row** (260806-s4av) is gated on the window carrying a `claude` chat,
POSTs the window-keyed fork endpoint, and navigates to the returned window.
The **coarse-pointer parity + slide-to-scrub gesture** (ys3q, extended by
b8eu): on touch the pin/✕ cluster relocates into the card's action rows, the
56px status rail is the PRIMARY tap/scrub target (the dot's leading tap zone
is the kept secondary target), and a press-and-slide from the rail retargets
the single-open card across rows without the card ever covering the rail
column. And the **three-tier extension** (260817-ve5m): the same 56px rail
renders on session rows and server-group headers (their always-visible icon
clusters are render-gated off on coarse), rail taps open the session/server
cards (coarse-only surfaces whose actions route to the existing
pickers/dialogs/handlers), the scrub retargets cards ACROSS tiers via the
shared `data-rail-row` handle, and the coarse left label zone is gone (the
display-only marker stripe stays; the row content start reclaims the zone's
width at ≈16px).

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
      action row, and a two-pane list (`%425` active) so the identity title bar
      renders its full `Window @1 · pane %425 · 2 panes` form.
    - `@2` "scratch-shell" — plain window → gray "idle" dot, no glyph,
      out-register-only card, no fork row, no panes (the title bar degrades to
      `Window @2`); carries `color: orange` + `marker: solid` so the coarse
      left-zone-reclaim test can prove the display-only stripe survives the
      interactive zone's removal.
- Rows are located by `[role='treeitem'][data-window-id]`; the card by
  `data-testid="row-flyout-card"`; registers/links by `row-flyout-out|agt|fab|
  pr|checked|pr-link|docs-link`; the card's sectioned action rows by
  `row-flyout-color-action` / `row-flyout-fork-action` /
  `row-flyout-pin-action` / `row-flyout-kill-action` (+ `row-flyout-spawn-action`
  / `row-flyout-create-action` on the session/server tiers);
  the glyph by `row-pr-glyph`; the coarse status rail by `status-rail`; the
  dot's tap wrapper by `status-dot-tap`; the session row by
  `[data-session-row='default:dev']`; the server-group header by
  `[data-server='default']`.
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
inset-bar treatment), carrying ONLY the docs link on its right edge (fork is
gone from the title bar — one affordance, one home); the dot label is demoted
to the first body line, followed by the four registers
(`out`/`agt`/`fab`/`pr`), the "checked Xs ago" freshness line, and the PR link.
The card's bottom carries the **sectioned action rows** in the fixed
change-color → fork → pin → kill order (`Change color…` first — 260817-ve5m),
each with its sub-hint ("new window, same directory" /
pin-state / "confirms first"). The `pr` register line is itself the open-first
anchor (the panel's PrLinkRow idiom): it wraps the colored segments, ends in an
always-visible inline `↗`, and opens the PR in a new tab
(`noopener noreferrer`).

**Steps:**
1. Hover the `@1` row; assert the card is visible.
2. Assert the title bar contains "Window @1 · pane %425 · 2 panes", holds the
   docs link, and contains NO fork affordance; assert the title text precedes
   the dot-label text ("building — active — agent waiting 3m" — hue word +
   status word + waiting suffix, no PR words) in the card, and each register
   testid shows its expected content (`waiting 3m`, the fab id·slug·stage·state
   line, `#386`, the freshness line).
3. Assert the sectioned action rows: change color ("Change color…"), fork
   ("Fork conversation" / "new window,
   same directory"), pin ("Pin to board…" / "not pinned"), kill ("Kill window"
   / "confirms first"), in that vertical order (bounding-box y).
4. Assert the pr-register anchor wraps the segments (`#386`, `↗`), carries
   the "Open PR #386 in a new tab" aria-label + href/target/rel, and the docs
   link href.
5. Assert the row-aligned notch: the card's arrow SVG is present and its
   vertical center falls inside the hovered row's band (the E1 connection
   cue — the notch points at the row that owns the card).
6. Compare bounding boxes: the card's x ≥ the sidebar `<aside>`'s right edge,
   and the card vertically overlaps the hovered row (±8px).
7. Assert no line paints outside the `max-w-xs` card box: the card's
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

### `the fork action row renders only on a claude-chat row and POSTs the fork endpoint`

**What it proves:** the conversation-fork action row (260806-s4av) is gated on
the window carrying a reconciled `claude` chat, its tooltip names the
same-directory semantics, and clicking it POSTs the window-keyed `POST
/api/windows/{windowId}/fork` endpoint — with no body, since every other input
is derived server-side — without selecting or navigating the underlying row.

**Steps:**
1. Hover `@1` (the claude-chat window); assert the fork action row is visible
   and its `title` mentions "same directory".
2. Hover `@2` (a plain shell window, no `chatProvider`); assert the card is the
   scratch one ("idle") and carries zero fork rows.
3. Route `**/api/windows/*/fork*` to a 200 recording each request URL,
   returning an EMPTY `windowId` so the app deliberately skips navigation (the
   best-effort window-id contract) and the assertion stays on this route.
4. Hover `@1` again and click the fork action row; assert exactly one fork
   request fired and its decoded URL is `/api/windows/@1/fork` (window-keyed,
   the source window's id in the path).
5. Assert the URL is still `/default` — forking never also selects the row.

### `a successful fork navigates to the returned window`

**What it proves:** the other half of the fork's navigation contract — a fork
returning a NON-empty `windowId` routes the app to that window's
`/$server/$window` URL, the same navigation the spawn dialog performs with a riff
result. (The empty-`windowId` skip is proven by the test above.)

**Steps:**
1. Route `**/api/windows/*/fork*` to a 200 returning `windowId: "@9"`.
2. Hover `@1` and click the fork action row.
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

### `rail renders on every row with aligned slots; rail-tap opens a contained bottom-start card without selecting the row` *(coarse describe)*

**What it proves:** the status-rail change (b8eu, widened 48→56px in
260817-ve5m) — on coarse pointers every
non-ghost row renders the 56px right-edge rail, the rest-state PR glyph lives
in the rail's fixed 16px slot, and the chevron hint renders on every row
(glyph or not); the pin/✕ cluster is render-gated off (the buttons are absent
from the DOM, not merely hidden); the dot's leading tap zone remains a real
≥32×36px touch target as the SECONDARY opener; tapping the RAIL (the primary
target) opens the card — anchored BELOW the row, fully on-screen, its right
edge stopping before the rail column, notch pointing up — WITHOUT selecting
the row; tapping the row body still selects (navigates) and never hover-opens
a card. Also asserts the widened mobile drawer (92% of the viewport, capped
at 340px) and that the card's `Change color…` row leads the action rows on
coarse too.

**Steps:**
1. With the coarse mock + `hasTouch`: coarse ⇒ `useIsMobile()` ⇒ the sidebar
   is a closed drawer, so first open it via the "Toggle navigation" hamburger
   (the mobile-layout.spec.ts idiom).
2. Assert the drawer width is `min(92vw, 340px)`.
3. Assert both rows render a visible `status-rail` exactly 56px wide; `@1`'s
   rail contains the `row-pr-glyph` and `@2`'s does not; both rails show the
   `›` chevron hint; `@1` contains NO pin/kill buttons.
4. Measure `@1`'s dot tap zone: width ≥ 32px, height ≥ 36px.
5. Tap `@1`'s rail: assert the card opens with "building — active", carries
   the change-color/fork/pin/kill action rows (color first, by bounding-box
   y), and the URL is still the bare server route
   (the tap did not select the row).
6. Assert coarse placement + containment via bounding boxes: the card's top is
   at/below the row's bottom edge (bottom-start), the whole card is inside the
   viewport, the card's right edge is ≤ the rail's left edge, and the arrow
   notch rides the card's top edge (pointing up at the rail).
7. Escape-dismiss, then tap the dot zone (secondary target): the card reopens
   and the URL stays on the server route.
8. Escape-dismiss again, tap `@2`'s row body: assert the URL left the bare
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

### `scrub: press the rail + slide retargets the single card across rows; release keeps it; tap-elsewhere dismisses` *(coarse describe)*

**What it proves:** the slide-to-scrub gesture (ys3q) starting from the RAIL
(b8eu's primary target) — pointerdown on the rail opens that row's card and
captures the pointer; sliding across a sibling row retargets the single-open
card (one card at a time); the retargeted card still never covers the finger's
rail column (the containment invariant mid-scrub); releasing keeps the last
card open; the gesture never selects or navigates a row; and the existing
outside-press dismissal still works afterwards.

**Steps:**
1. Open the drawer; move the mouse to the center of `@1`'s rail and press
   (mouse.down dispatches pointerdown — the scrub trigger under the coarse
   mock).
2. Assert the card opens with "building — active".
3. Slide (mouse.move, still pressed) onto `@2`'s row: assert exactly one card,
   now showing "Window @2", and the URL still `/default` (no navigation).
4. Assert containment on the retargeted card: its right edge is ≤ `@2`'s
   rail's left edge.
5. Release (mouse.up): assert the @2 card stays open and the drawer/rows are
   still visible.
6. Click a neutral spot in the main content: assert the card is dismissed.

### `coarse left-zone reclaim: no interactive zone, the display-only marker stripe stays, content starts ≈16px` *(coarse describe)*

**What it proves:** the 260817-ve5m left-zone reclaim — on coarse pointers the
interactive label zone and its palette-icon reveal are REMOVED from the DOM
(the touch color path is the card's `Change color…` row), while the
display-only marker stripe keeps rendering, and the reclaimed width shifts the
row content start from 30px to ≈16px (4px stripe inset + 10px max stripe + 2px
clearance).

**Steps:**
1. Open the drawer with the coarse mock + `hasTouch`.
2. Assert NO element carries the zone's `aria-label="Set window label"`.
3. Assert `@2` (color orange, marker solid) still renders its left-edge stripe
   (a `div[style*="border-left"]`).
4. Measure: `@2`'s dot tap zone starts ≈16px (±1px) from the row's left edge.

### `session rail tap opens the session card; its actions route (kill confirms first)` *(coarse describe)*

**What it proves:** the session-tier card (260817-ve5m R4) — the session row
renders the rail on coarse, its 4-icon cluster is gone from the DOM, and a
rail tap opens the shared-shell card with the `Session dev` title, the
identity-tip facts line (`$4 · 2 windows · ~/code/sahil87/run-kit`), and the
relocated actions in the fixed order (`Change color…` → `Spawn agent…` → `New
window` → `Kill session`, spawn wired on this route). Kill session routes
through the EXISTING kill confirmation dialog (no force-kill on touch, no kill
POST), and `Change color…` closes the card and opens the row's existing color
popover with popover-over-card precedence (a rail tap while the popover is
open flashes nothing).

**Steps:**
1. Route `**/api/sessions/*/kill*` to a 200 that records each request.
2. Open the drawer; assert the session row's rail is visible and its
   Kill/New-window cluster buttons are absent from the DOM.
3. Tap the session rail: assert the card shows the `Session dev` title bar,
   the facts line, and the four action rows in vertical order; assert the URL
   is still `/default` and the window rows are still visible (no navigation,
   no collapse).
4. Tap `Kill session`: assert the "Kill session?" dialog (with "and all 2
   windows") is visible and ZERO kill requests fired; Cancel it.
5. Re-open the card, tap `Change color…`: assert the card is gone and the
   "Color picker" listbox is visible; tap the rail again and assert NO card
   opens (suppression precedence).

### `server rail tap opens the server card; Kill server routes to the existing dialog without toggling the group` *(coarse describe)*

**What it proves:** the server-tier card (260817-ve5m R5) — the server-group
header renders the rail on coarse, its 3-icon cluster is gone from the DOM,
and a rail tap opens the card with the `Server default` title, the
socket-name facts line (`tmux -L default · 1 session` — the count from the
group's own data), and the action rows (`Change color…` → `New session` →
`Kill server`). Kill server routes through the EXISTING `killServerTarget`
confirm dialog, no kill POST fires, the group is never toggled, and the URL
never changes. (The rk-daemon warning case is NOT exercised here — the mocked
server is not the daemon.)

**Steps:**
1. Route `**/api/servers/kill*` to a 200 that records each request.
2. Open the drawer; assert the `default` header's rail is visible and its
   Kill/New-session cluster buttons are absent from the DOM.
3. Tap the header rail: assert the card shows the `Server default` title bar,
   the `tmux -L default · 1 session` facts line, and the three action rows.
4. Tap `Kill server`: assert the confirm dialog ("and all its sessions") is
   visible, ZERO kill requests fired, the header still reads "Collapse default
   sessions" (never toggled), and the URL is still `/default`; Cancel it.

### `cross-tier scrub: window → session → server retarget; release keeps the server card; nothing navigates or collapses` *(coarse describe)*

**What it proves:** the cross-tier scrub (260817-ve5m R9) — all three tiers
register in the ONE scrub registry and the shared `data-rail-row` hit-test
covers all three DOM shapes, so a single press-and-slide from a window row's
rail across the session row onto the server-group header retargets the
single-open card window → session → server in sequence; release keeps the
last (server) card open; the gesture never selects, navigates, or collapses.

**Steps:**
1. Open the drawer; press (mouse.down) the center of `@1`'s rail; assert the
   card opens with "Window @1".
2. Slide (still pressed) onto the session row's rail: assert exactly one card,
   now titled "Session dev".
3. Slide onto the server header's rail: assert exactly one card, now titled
   "Server default".
4. Release: assert the server card stays open ("tmux -L default · 1
   sessions"), the URL is still `/default`, the group is still expanded, and
   the window rows are still visible.
