# shortcut-registry.spec.ts

Verifies the **keyboard shortcut registry** (260730-g40a): the
`Shift+CmdOrCtrl+<key>` run-kit action tier dispatched by the window-level
registry dispatcher, the shortcuts cheatsheet overlay (⇧CmdOrCtrl+/ on
Win/Linux hosts, demoted to ⌘/ on mac — 260730-n789; a dialog — not a
route), click-to-capture rebinding persisted as diffs to
`localStorage["runkit-keybindings"]`, palette `shortcut` hints sourced from
the effective map, and browser-reserved key inertness (Playwright is a plain
browser host, so the shifted N/T/W defaults resolve disabled while their
actions stay palette-reachable). Also covers the **macOS ⌘-tier demotions**
(260730-n789) via a spoofed-platform block: ⌘[/⌘] back/forward and ⌘/
overlay resolve on mac hosts (deep mac paths — shell-host N/T/W demotion,
claimed sets — are unit-tested in `lib/keybindings.test.ts`; e2e runs on
Linux). It also covers the **split-pane chords** (260807-rbx5): the
divider pair ⇧Ctrl+\/⇧Ctrl+- splitting side-by-side then stacked on this
host, and ⌘D/⇧⌘D doing the same on a spoofed mac (the `macCode` refinement —
both actions bound and palette-hinted on every host). Finally it covers the
**VS Code-aligned chrome chords**: `sidebar-toggle` on the B keycap (⇧Ctrl+B
here, ⌘B on a spoofed mac — both mac hosts, no shell gate), `code-toggle` on
J (⇧Ctrl+J / ⌘J — toggles the code tile on a code-capable window), and
`focus-hop` on Backquote (⇧Ctrl+` here, ⌃` on a spoofed mac via the seam's
mac-only ctrl-tier refusal rule — open-then-focus on a closed code tile,
then the hop back to the tty tile).

## Shared setup

- Fully mocked — no tmux, no real backend state. Injected via `page.route` /
  `page.routeWebSocket`:
  - `**/api/servers` → a single server `default`.
  - `**/api/windows/*/select*` → 200 (trailing `*` so the client's appended
    `?server=` query is still intercepted).
  - `**/api/keybindings*` → three curated tmux bindings (two root-table, one
    prefix-table) for the overlay's read-only TMUX section (260801-sm6g).
  - `**/api/windows/*/split*` (via `mockSplit`, per split test) → 200; each
    POST body is captured for assertion (260807-rbx5).
  - `/ws/state` (via `mockStateSocket`) → session `dev` with three windows:
    `@1` "win-one" (active), `@2` "win-two", `@3` "win-three".
    `codeCapablePayload()` re-stamps the payload with `gitRoot` on `@1` —
    the code surface's availability is the window's derived gitRoot.
  - The terminals mux WebSocket (`/ws/terminals`) is stubbed.
- `gotoWindowOne(page)` navigates to `/default/1` and gates on "win-one"
  rendering.
- Chords are pressed as `Shift+Control+<code>` — the registry matches on
  `KeyboardEvent.code` and accepts Ctrl in place of Meta on every platform.
  Presses land while the xterm textarea owns focus, so each dispatch also
  exercises the terminal seam (the custom key handler refuses shifted-tier
  chords so they bubble to the dispatcher instead of reaching the pane).
- `spoofMacPlatform(page)` (the 260730-n789 block) installs an init-script
  getter override on `Navigator.prototype.platform` (`"MacIntel"`) so
  `detectPlatform()` resolves `mac` and the per-platform defaults demote to
  the ⌘ tier; those chords are pressed as `Meta+<code>`, exercising the mac
  terminal-seam refusal (metaKey-gated cmd-tier matches).

## Tests

### `Shift+Ctrl+L / Shift+Ctrl+H cycle the current session's windows with wraparound`

**What it proves:** the `window-next`/`window-prev` starter bindings cycle the
current session's windows in sidebar order, wrapping at both ends.

**Steps:**
1. Mock the backend; open `/default/1`.
2. Press Shift+Ctrl+L three times → URL walks `/default/2`, `/default/3`,
   then wraps to `/default/1`.
3. Press Shift+Ctrl+H → URL wraps backward to `/default/3`.

### `Shift+Ctrl+[ / Shift+Ctrl+] retrace history (back / forward)`

**What it proves:** the `go-back`/`go-forward` bindings drive router history —
a window switch pushes an entry that the chords retrace.

**Steps:**
1. Open `/default/1`; press Shift+Ctrl+L → `/default/2` (pushes history).
2. Press Shift+Ctrl+[ → back to `/default/1`.
3. Press Shift+Ctrl+] → forward to `/default/2`.

### `Shift+CmdOrCtrl+/ toggles the overlay; filter narrows; Escape closes`

**What it proves:** the cheatsheet overlay opens/closes on its chord (including
from inside the overlay's own filter input — the binding is `ignoreInputs`),
the filter narrows rows, and Escape closes.

**Steps:**
1. Open `/default/1`; press Shift+Ctrl+/ → the `shortcuts-overlay` dialog is
   visible.
2. Fill the filter with "waiting" → the "Next waiting agent" row remains, the
   "New session" row is filtered out.
3. Press Shift+Ctrl+/ again (focus in the filter input) → overlay closes.
4. Reopen with the chord; press Escape → overlay closes.

### `the Help: Keyboard Shortcuts palette entry opens the overlay`

**What it proves:** the overlay is palette-reachable (Constitution V) via the
`shortcuts-overlay` action.

**Steps:**
1. Open the palette (`Meta+k`), fill "Help: Keyboard Shortcuts", press Enter.
2. Assert the overlay dialog is visible.

### `the merged overlay carries the jump nav and the read-only tmux section (260801-sm6g)`

**What it proves:** the overlay is the single merged shortcuts surface — it
renders the sticky jump-nav chip row (key map · global · terminal · board ·
tmux), folds the current server's curated tmux keybindings in as a read-only
locked section (prefix rows as `Ctrl` `S` *then* `\` sequences), and one
filter spans app + tmux rows with live per-chip match counts (zero-hit chips
dim).

**Steps:**
1. Mock the backend (incl. `**/api/keybindings*`); open `/default/1`; open the
   overlay with Shift+Ctrl+/.
2. Assert every jump chip renders in the nav (`shortcuts-jump-nav`).
3. Assert the TMUX section (`tmux-section`) shows the mocked root rows and the
   prefix row's "then" sequence separator.
4. Fill the filter with "split" → the tmux "Split horizontally" row stays
   visible; the tmux chip shows count 1 and the global chip shows 0.

### `the legacy Help: tmux Keybindings palette entry is gone (260801-sm6g)`

**What it proves:** the legacy tmux keybindings dialog was deleted with its
palette entry — `Help: Keyboard Shortcuts` (the overlay) is the single
shortcuts entry.

**Steps:**
1. Open the palette (`Meta+k`); fill "tmux Keybindings" → no
   `Help: tmux Keybindings` entry renders.
2. Fill "Keyboard Shortcuts" → the `Help: Keyboard Shortcuts` entry is
   visible.

### `click-to-capture rebinds, persists the diff, and the new chord dispatches`

**What it proves:** clicking a row's combo arms capture, pressing a chord
rebinds the action, the override persists as a diff in
`localStorage["runkit-keybindings"]`, and dispatch honors the override (the new
chord fires; the vacated default no longer does).

**Steps:**
1. Open `/default/1`; open the overlay with Shift+Ctrl+/.
2. Click the combo button for "Next window"; press Shift+Ctrl+U.
3. Assert localStorage holds `{"window-next":{"code":"KeyU","tier":"shifted"}}`.
4. Close the overlay (Escape).
5. Press Shift+Ctrl+L (the vacated default) → URL stays `/default/1`.
6. Press Shift+Ctrl+U → URL navigates to `/default/2`.

### `registered palette entries render effective per-platform combos`

**What it proves:** a registered action's palette entry carries its effective
combo as the `shortcut` hint, formatted for the host platform (non-mac →
`Shift+Ctrl+A` on `Agent: Next waiting`).

**Steps:**
1. Open `/default/1`; open the palette; fill "Agent: Next waiting".
2. Assert the hint text `Shift+Ctrl+A` is visible.

### `⌘[ / ⌘] retrace history on a mac host; the shifted default is vacated`

**What it proves:** on a macOS host (spoofed platform) the `go-back`/
`go-forward` defaults demote to the unshifted ⌘ tier — ⌘[/⌘] navigate
history while the terminal owns focus (the mac seam refusal bubbles the
chord), window cycling stays shifted (H/L unchanged), and the old
⇧CmdOrCtrl+[ combo no longer dispatches.

**Steps:**
1. Spoof the mac platform; mock the backend; open `/default/1`.
2. Press Shift+Ctrl+L → `/default/2` (shifted cycling unchanged on mac).
3. Press Meta+[ → back to `/default/1`; Meta+] → forward to `/default/2`.
4. Press Shift+Ctrl+[ ; wait 300ms → URL unchanged (`/default/2`).

### `⌘/ toggles the overlay on a mac host and the ⌘ map layer is selectable`

**What it proves:** the `shortcuts-overlay` default demotes to ⌘/ on macOS,
and the overlay's macOS display (initialized from the detected host) offers
the single keyboard map's modifier picker ("Holding ⇧⌘ | ⌘" — 260801-r8j2)
with ⇧⌘ selected by default; selecting ⌘ renders the ⌘ layer with the mac
claimed set.

**Steps:**
1. Spoof the mac platform; mock the backend; open `/default/1`.
2. Press Meta+/ → the overlay opens.
3. Assert the "Keyboard map modifier" picker group is visible and its ⌘
   option is unselected (`aria-pressed="false"` — ⇧⌘ is the default layer).
4. Click the ⌘ option → it selects (`aria-pressed="true"`) and the ⌘ layer's
   mac-browser claimed set renders (the "address bar" ⌘L cell).
5. Press Meta+/ again → the overlay closes.

### `⌘N and ⇧⌘N stay inert in a mac browser host (create-session palette-only)`

**What it proves:** the N/T/W demotion is desktop-shell-only — in a mac
BROWSER host `create-session` keeps its shifted default, which resolves
browser-reserved (disabled), and no cmd-tier binding exists on N; neither
chord dispatches.

**Steps:**
1. Spoof the mac platform; mock the backend plus a POST-tracking route on
   `**/api/sessions*`; open `/default/1`.
2. Press Meta+N, then Shift+Meta+N.
3. Wait 300ms; assert no POST fired and the URL is unchanged.

### `Shift+Ctrl+\ and Shift+Ctrl+- split side-by-side then stacked on the terminal route`

**What it proves:** the divider-pair chords reuse the
`Window: Split Horizontal|Vertical` palette bodies — each fires one
`POST /api/windows/@1/split` carrying its direction and the window's worktree
path — while the terminal owns focus (the shifted-tier seam refusal bubbles
both chords).

**Steps:**
1. Mock the backend plus a body-capturing route on `**/api/windows/*/split*`;
   open `/default/1`.
2. Press Shift+Ctrl+\ → one POST; press Shift+Ctrl+- → a second POST.
3. Assert the two bodies are `{horizontal: true, cwd: "/tmp/win-one"}` then
   `{horizontal: false, cwd: "/tmp/win-one"}`.

### `the palette hints both splits with the divider-pair chords`

**What it proves:** the effective map reaches the palette — on a Win/Linux
host `Window: Split Horizontal` advertises `Shift+Ctrl+\` and
`Window: Split Vertical` advertises `Shift+Ctrl+-` (both bound; the mac
`macCode` refinement never applies here).

**Steps:**
1. Mock the backend; open `/default/1`; open the palette (`Meta+k`).
2. Fill the filter with "Window: Split" → both split entries render.
3. Assert the texts `Shift+Ctrl+\` and `Shift+Ctrl+-` each appear exactly
   once.

### `⌘D and ⇧⌘D split horizontally then vertically on a mac host`

**What it proves:** on macOS (spoofed platform) both splits refine to the D
keycap (`macCode`), with `split-horizontal` also demoting to the unshifted ⌘
tier while `split-vertical` keeps the shifted ⇧⌘ tier — so the pair fires
from one keycap on different modifiers, ⌘D exercising the mac cmd-tier seam
refusal and ⇧⌘D the shifted-tier one.

**Steps:**
1. Spoof the mac platform; mock the backend plus the split-capturing route;
   open `/default/1`.
2. Press Meta+D → one POST; press Shift+Meta+D → a second POST.
3. Assert the two bodies are `{horizontal: true, cwd: "/tmp/win-one"}` then
   `{horizontal: false, cwd: "/tmp/win-one"}`.

### `Shift+Ctrl+B toggles the sidebar`

**What it proves:** the `sidebar-toggle` binding lives on the B keycap — the
shifted tier on Win/Linux — and fires from the component-local shell listener
while the terminal owns focus.

**Steps:**
1. Mock the backend; open `/default/1`; assert the `aside[aria-label="Sidebar"]`
   is visible.
2. Press Shift+Ctrl+B → the sidebar unmounts.
3. Press Shift+Ctrl+B again → it returns.

### `Shift+Ctrl+J toggles the code tile on a code-capable window`

**What it proves:** the `code-toggle` binding (⇧Ctrl+J on Win/Linux) toggles
the code surface's tile through the shared layout-mutation path, gated on the
window carrying a derived `gitRoot`.

**Steps:**
1. Mock the backend with the code-capable payload (`gitRoot` on `@1`); open
   `/default/1`; assert no code tile exists.
2. Press Shift+Ctrl+J → the `surface-tile-code` tile appears.
3. Press Shift+Ctrl+J again → the tile hides (mounted-hidden — the
   hide-never-unmount rule).

### `Shift+Ctrl+` opens the closed code tile and hops focus, then hops back to the tty`

**What it proves:** the `focus-hop` binding implements VS Code's ⌃` gesture:
pressed with the code tile closed it OPENS the tile and moves the
focused-tile accent border to it (open-then-focus); pressed again it hops
focus back to the tty tile without closing anything.

**Steps:**
1. Mock the backend with the code-capable payload; open `/default/1` (slot A /
   tty holds the default focus).
2. Press Shift+Ctrl+` → the code tile appears and carries
   `border-accent-green`; the tty tile loses it.
3. Press Shift+Ctrl+` again → the tty tile carries the accent border, the code
   tile stays open and loses it.

### `⌘B toggles the sidebar on a mac host (both mac hosts — no shell gate)`

**What it proves:** the `sidebar-toggle` `macTier: "cmd"` demotion applies in
a mac BROWSER host (⌘B is page-interceptable; no claimed-keys entry on KeyB) —
no `macShellOnly`.

**Steps:**
1. Spoof the mac platform; mock the backend; open `/default/1`.
2. Press Meta+B → the sidebar unmounts; press Meta+B again → it returns.

### `⌘J toggles the code tile and ⌃` hops focus on a mac host`

**What it proves:** on a mac host the `code-toggle` default resolves to ⌘J and
`focus-hop` to ⌃` (the registry's first shipped ctrl-tier default), and ⌃`
reaches the dispatcher from under terminal focus via the seam's mac-only
ctrl-tier refusal rule (rule 3).

**Steps:**
1. Spoof the mac platform; mock the backend with the code-capable payload;
   open `/default/1`.
2. Press Meta+J → the code tile appears; press Meta+J again → it hides
   (mounted-hidden).
3. Press Control+` → the closed code tile reopens and takes the
   `border-accent-green` focused-tile border.
4. Press Control+` again → the accent border hops back to the tty tile; the
   code tile stays open.

### `Shift+Ctrl+N is inert in a browser host (create-session stays palette-only)`

**What it proves:** browser-reserved shifted keys (N/T/W) resolve disabled in a
plain browser host — the chord dispatches nothing (no create-session POST, no
navigation); the action remains reachable via the palette (asserted by the
hint/overlay tests' host-neutral entries).

**Steps:**
1. Mock the backend plus a POST-tracking route on `**/api/sessions*`.
2. Open `/default/1`; press Shift+Ctrl+N.
3. Wait 300ms; assert no POST fired and the URL is unchanged.
