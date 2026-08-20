# surface-focus-chords.spec.ts

Proves the stateful surface focus chords end-to-end (260819-qwr7, R4/R5/R7):
the three-state tile chords (⌘1 tty / ⌘2 code), the zen zoom toggle (⇧⌘⏎),
and the stateful sidebar chord (⌘B) with its Escape return — including the
steal-guard recording asymmetry (a chord must never write `code` into focus
memory; only genuine in-frame interaction may).

The rig runs a Linux browser host, so the chords resolve to their base
shifted tier: ⇧Ctrl+1/2, ⇧Ctrl+Enter, ⇧Ctrl+B. The mac ⌘ forms are pinned
by unit tests (`keybindings.test.ts` per-host resolution).

## Shared setup

- **tmux server**: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`),
  started by `scripts/test-e2e.sh` on port 3020. Never run Playwright
  directly — `just test-e2e surface-focus-chords`.
- **Workbench grab stub**: same stub as `focus-restore.spec.ts` — `beforeAll`
  binds an HTTP server on `RK_CODE_SERVER_PORT` serving one focusable button
  that grabs focus once per load (300ms in) and retitles its document
  `grabbed`. The stub makes the backend's reachability probe genuinely true,
  so the code tile renders a real iframe.
- **`beforeAll`**: one dedicated session `e2e-sfc-<ts>`, the stub, and a
  throwaway terminal-route page load to absorb Vite's cold transform outside
  any test's budget (90s hook budget).
- **`afterAll`**: close the stub, kill the session.
- **`beforeEach`**: desktop viewport (1440×800) — the chords' stateful arms
  are desktop-only.
- **Chord keydowns disarm the visit's steal guard** (the restore effect's
  capture-phase `keydown` disarm), exactly like the rail click's pointerdown
  in `focus-restore.spec.ts` — so the stub's grab STANDS on the visit where a
  chord opens the tile, and the revert under test happens on the
  away-and-back return.
- **Window switches go through the sidebar row** (`switchToWindow`), never
  `page.goto`: focus memory is in-memory by design.
- **Tile focus vs DOM focus**: the focus seam's contract is the focused-SLOT
  (the accent-green border, the tmux active-pane metaphor — the observable
  `shortcut-registry.spec.ts`'s focus-hop test already asserts); DOM focus
  enters the iframe only via the stub's grab or a genuine click.
  `expectTileFocused` asserts the border; `expectActiveElement` asserts DOM
  focus; `expectGrabFired` gates every grab-dependent assertion on the grab
  having actually fired.
- **Budgets**: every test calls `test.setTimeout(30_000)` — each drives
  iframe reloads and/or in-app window switches, past the 10s default.

## Tests

### (a) ⌘2 cycles hidden→open+focus, visible-unfocused→focus, focused→hide+restore; the chord never records `code`
What it proves: all three states of the code tile chord against a real
iframe stub — including focus landing after the open — and the recording
asymmetry: ⌘2 writes no focus memory, so on an away-and-back return the
armed guard reverts the remounted workbench's grab to the tty default (had
the chord recorded `code`, the grab would stand — the focus-restore spec's
(c) behavior).
Steps:
1. Create windows A and B; navigate to A; assert the xterm holds focus (the
   first-visit tty default).
2. Press ⌘2; assert the code iframe appears, the stub's grab fires, DOM focus
   lands on the iframe element, and the code tile carries the focused-slot
   border (hidden → open+focus).
3. Click the terminal tile (a genuine pointerdown: focused slot → tty,
   records `tty`, DOM focus → xterm); assert both.
4. Press ⌘2; assert the focused-slot border moves to code and BOTH tiles stay
   visible (visible-unfocused → focus; no layout mutation).
5. Press ⌘2 again; assert the code tile hides (display-level — the P3
   hide-never-unmount rule), the tty tile stays, and DOM focus is on the
   xterm (focused → hide + restore through the router).
6. Switch to B via the sidebar; press ⌘2; assert the grab fires and DOM focus
   lands in the iframe (B has NO focus memory — nothing was ever recorded).
7. Switch to A and back to B via the sidebar; assert the remounted iframe's
   grab fires again but DOM focus lands on the xterm — the armed guard
   reverted it, proving ⌘2 recorded nothing.

### (b) ⌘1 focuses the tty tile from code (recording `tty` via the seam), then hides and reopens it
What it proves: the tty chord's focus arm works from INSIDE the code iframe
(the chord-reclaim seam re-dispatches it to the parent) and records `tty`
through the seam's own `recordTtySlot`; the focused arm hides the tty tile
at arity 2; the hidden arm reopens and focuses it.
Steps:
1. Create window C; navigate; assert xterm focus.
2. Open the code tile via the `Code tile` rail toggle; wait for the grab;
   click the stub editor's button through the frame (the genuine in-frame
   interaction that focuses the code tile); assert iframe DOM focus and the
   code tile's focused-slot border.
3. Press ⌘1; assert the focused-slot border moves to the tty tile with BOTH
   tiles still visible (focus arm, no layout mutation).
4. Click the terminal tile (the hide arm is a PARENT-side gesture: a chord
   reclaimed from inside the iframe fires the frame's `onInteract` first,
   re-flipping the focused slot to code before the dispatcher runs, so an
   in-frame ⌘1 always takes the focus arm); assert xterm DOM focus.
5. Press ⌘1; assert the tty tile hides and the code tile stays (hide arm at
   arity 2).
6. Press ⌘1 again; assert the tty tile reappears and carries the focused-slot
   border (hidden → open+focus on landing).

### (c) ⇧⌘⏎ zooms the focused tile and unzooms on a second press; a no-op at arity 1
What it proves: the zen chord toggles the existing zoom seam on the FOCUSED
tile (with code focused, code zooms — not slot A by fiat), the second press
unzooms (reclaimed from inside the iframe), and at arity 1 the chord mounts
no handler and changes nothing.
Steps:
1. Create windows D (the zoom window) and E (the arity-1 window); navigate
   to D.
2. Open the code tile via the rail toggle; wait for the grab; click the stub
   editor's button through the frame — the genuine in-frame interaction
   (`onInteract`) is what flips the focused slot to code (the script grab
   alone produces no parent-side focus event in Chromium); assert iframe DOM
   focus and the code tile's focused-slot border.
3. Press ⇧⌘⏎; assert the tty tile hides at display level while the code
   tile stays visible (the focused tile zoomed full-center).
4. Press ⇧⌘⏎ again (from inside the iframe, via the reclaim seam); assert
   both tiles are visible again (unzoom).
5. Switch to E via the sidebar; assert xterm focus on the single-tty layout;
   press ⇧⌘⏎; assert the tty tile stays visible and DOM focus never leaves
   the xterm (the no-op).
6. Open the code tile on E via the rail toggle; assert BOTH tiles render
   unzoomed — the arity-1 press latched nothing (keeps the no-op
   non-vacuous).

### (d) ⌘B focuses the current window's sidebar row (roving synced); Escape returns focus without hiding; a second ⌘B hides + returns
What it proves: the stateful sidebar chord's three arms — visible + focus
outside → focus the current window's row with the roving tab stop synced;
visible + focus inside → hide + return focus through the route's registered
restorer; hidden → open + focus the row — plus the nav-scoped Escape return
that restores focus WITHOUT hiding, and the sidebar's no-recording contract
(the return target is the remembered surface, here the tty default).
Steps:
1. Create window F; navigate; assert xterm focus and a visible sidebar; wait
   for F's row to render AND carry `aria-current="page"` (both arrive via SSE
   after route mount — the chord's focus arm queries `[aria-current="page"]`
   at press time, so pressing earlier would hit the no-row fallback).
2. Press ⌘B; assert the current row's button holds DOM focus, the row's
   treeitem carries `tabindex="0"` (roving sync — the Wave-2 #262
   invariant), and the sidebar stays visible.
3. Press Escape (up to twice: the row flyout, if keyboard focus opened it,
   gets Escape first-refusal — the nav handler is layered after its
   dismiss); assert DOM focus returns to the xterm and the sidebar stays
   visible.
4. Press ⌘B (row focused again), then ⌘B once more from inside the sidebar;
   assert the sidebar unmounts and DOM focus returns to the xterm (hide +
   return arm).
5. Press ⌘B with the sidebar hidden; assert it reopens and the row takes
   focus once mounted (hidden → open+focus arm).
