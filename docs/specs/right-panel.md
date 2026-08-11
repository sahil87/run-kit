# Right Panel — A Second Slot Beside the Terminal

> A collapsible right-side panel on the terminal route that renders a **second
> (substrate, lens) pair** beside the tty, behind an always-visible icon rail.
> This spec extends [`window-views.md`](window-views.md) — that spec defines
> what lenses *are* and how availability derives; this one adds a second
> *placement* for them, one new lens (`code`), and the **companion window**
> convention (`@rk_owner`) that lets hidden sibling substrates render in the
> panel. Phase 1 — the always-on rail, the panel shell (resize + per-viewer
> width, hide-never-unmount), and the `web` surface with its toggle chord and
> palette entry — is **[current]** as of change
> `260811-2r1w-right-panel-shell-web-surface`; phase 2 — the `code` lens
> (`?view=code` + the panel's CODE surface), the proxy prerequisites
> (`SetXForwarded`, the trailing-slash redirect, `allow-downloads`), and the
> git-root/reachability derivation — is **[current]** as of change
> `260811-k3vp-right-panel-code-lens`; the `@rk_owner` companion convention and
> the `agents` surface, the amber attention dot, and mobile remain
> **[target]**.
>
> Companions: [`agent-state.md`](agent-state.md) (the rollup the agents
> surface feeds), [`status-pyramid.md`](status-pyramid.md) (untouched — status
> describes substrates, and companions roll into their owner's substrate).

---

## The Problem

1. **Lenses are exclusive.** The main slot renders one lens at a time — choose
   `web` and the tty is gone. But the highest-value projections are naturally
   *beside* the work, not instead of it: the editor/diff of the pane's
   checkout, the page the pane serves, the tier-2 workers the pane spawned.
2. **Subagents pollute the operator surface.** Tier-2 workers spawned as panes
   in the main window (or as sibling windows) clutter exactly the surface the
   operator is trying to keep readable.

Both needs share one substrate: a collapsed-by-default right panel.

---

## The Model

1. **The terminal route gains a second render slot.** The main slot keeps the
   existing lens model unchanged (window-views R2–R5). The **panel slot**
   renders one additional (substrate, lens) pair — the substrate is the
   current window *or one of its companions*. This is the
   [`window-views.md`](window-views.md) § Boards "(window, view) pair"
   generalization landing on the terminal route first.
2. **The rail is the affordance.** A ~38px icon rail on the right edge, always
   visible on desktop, one button per available surface. Availability is
   derived server-side and rides the SSE window payload (Constitution II/X);
   buttons carry an availability dot and an amber **attention dot** when the
   surface holds a waiting agent.
3. **A surface = a named (substrate, lens) pairing** registered below. The
   registry is open-ended the same way the view registry is.

### Surface Registry (initial)

| Surface | Substrate | Lens | Available when |
|---------|-----------|------|----------------|
| `web` | current window | `web` | `@rk_url` set — same capability signal as the view registry row |
| `code` | current window | `code` (new lens, below) | git root derivable from the active pane's cwd AND a code-server endpoint configured (`RK_CODE_SERVER_PORT`). **Availability is the two STABLE capability signals only** — code-server *reachability* never gates the button/segment (it would strobe the rail); reachability selects the surface's CONTENT instead: live iframe when up, the "not running on :{port}" empty state when down (amended 2026-08-11, change `260811-k3vp`, resolving the former "configured and reachable" wording's tension with the not-running state) |
| `agents` | companion window | `tty` | a window with `@rk_owner=<this window's id>` exists |

### The `code` lens (new view-registry row)

`code` joins the [`window-views.md`](window-views.md) View Registry as a
full lens — so it is also reachable in the **main** slot via `?view=code` and
the shared switcher; the panel is merely its natural home.

- **Renderer**: iframe of code-server at `?folder=<git root>`, same-origin via
  the relative `/proxy/{port}/` path.
- **Keyed by git root, not window id and not raw cwd** — editor state follows
  the code; agents `cd` constantly; two windows on one worktree deliberately
  share one editor state.
- **Persistence is split across four stores** (researched 2026-08-11):
  settings/keybindings and hot-exit unsaved buffers live on the **server**
  (user-data-dir — dirty buffers survive reload and even a browser switch);
  open tabs and layout live in **browser IndexedDB keyed by the proxy
  pathname**; the undo stack is in-memory and dies on reload. Consequence:
  **the proxy path is state identity** — the code-server port/path MUST be
  stable across restarts, or users silently get a blank workspace that reads
  as data loss.
- **Topology**: one code-server instance per host. **v1: configured, not
  managed** — run-kit reads an endpoint setting and renders "not running"
  when unreachable. A run-kit-managed lifecycle (service window on the daemon
  socket, mirroring Constitution VI's independence) is a later change.
- **Diff is not a separate surface** — code-server's own git decorations, SCM
  view, and diff editors carry it.

---

## Companion Windows (`@rk_owner`)

A **companion** is a real tmux window owned by another window in the same
session, hidden from navigation, rendered through its owner's panel.

- **Ownership is a window option**: `@rk_owner=<owner window id>` (the
  immutable `@N` id — rename-proof in both directions). The companion's
  *name* is sugar for raw-tmux readability (e.g. `<owner-name>-subagents`)
  and is **never parsed** — names belong to users (window-views R1).
- **Annotate, don't omit.** The snapshot/SSE payload keeps companions, tagged
  with their owner. Navigation and aggregation consumers (sidebar, switcher,
  palette, boards, counts) filter them via one shared helper; the terminal
  relay and the panel can still reach them.
- **Rollup**: a companion's agent-state rolls into its **owner's** window
  rollup — a waiting tier-2 worker turns the owner's dot amber. Hidden must
  never mean invisible-when-stuck.
- **Orphans unhide.** If the owner id no longer resolves (owner killed,
  companion moved), the companion loses companion status and appears as a
  normal window. Fail-open — never silently strand a live worker. There is no
  kill-cascade; companions outlive their owner until reaped deliberately.
- **`@rk_owner` joins every `@rk_*` round-trip set** — snapshot
  capture/restore in particular (it round-trips an explicit option list;
  dropping `@rk_owner` would resurrect companions as visible orphans on every
  restore). Note: owner window *ids* are not stable across a restore, so
  restore must remap the stored owner reference like any other id.
- **Creation**: `rk riff` grows a spawn shape that targets tier-2 workers
  into the owner's companion window instead of sibling panes/windows.

---

## Rules

### P1 — Panel choice is per-viewer, URL-addressable

Mirrors window-views R2: an optional `?panel=<surface>` search param on the
existing `/$server/$window` route (Constitution IV — no new routes) for deep
links (a waiting-agent notification opens `?panel=agents`); last state per
window persists in localStorage as a value-bearing key (surface name or
closed; absent = closed). Panel width is a per-viewer localStorage value.

### P2 — The panel is additive; the tty stays put

Opening a surface never changes the main slot's lens. On mobile the sheet
*covers* rather than splits (P5), but the tty remains one tap away —
window-views R3's spirit extends to placement.

### P3 — Hide, never unmount

Collapsing the panel or switching surfaces hides the surface's
iframe/terminal (`display`-level), preserving in-memory state (editor
selection, undo stack, scroll). Eviction beyond that is a small LRU decision
deferred until latency data exists.

### P4 — Attention must escape the panel

The rail button and the owner's sidebar/board dot both carry the companion
rollup. A collapsed panel may hide *content*, never *state that wants a
human*.

### P5 — Desktop rail, mobile sheet

Below the mobile threshold (`isMobileViewport()` — width OR coarse pointer)
the rail is not rendered; a single bottom-bar chip (with the same attention
dot) opens the panel as a **full-height sheet inside the main area** — the
sidebar-drawer pattern: absolute within main, top bar visible and
dismissing. Surfaces become tabs in the sheet header. Terminal and panel
never share width on mobile.

### P6 — One surface at a time

The panel renders one surface; switching swaps content in place (accordion).
Multiple simultaneous panels are out of scope (Constitution IV — resist
creep); boards remain the "many things at once" answer.

### P7 — Keyboard-first

`⇧⌘.` toggles the last-used surface (the shifted tier of `⌘.`, which is the
shipped `view-cycle` lens chord — the spec originally named `⌘.` before that
collision was known); the palette gains `Panel: Code` / `Panel: Web` /
`Panel: Agents`; rail buttons are focusable. (Constitution V.)

---

## Constitution Mapping

- **II / X** — surface availability, git root, companion links, and rollups
  are all derived server-side from tmux options, cwd, and processes; nothing
  is pushed, nothing stored.
- **IV** — no new routes; one search param; one rail; one surface at a time.
- **V** — P7.
- **VI** — code-server (when later managed) runs under tmux, not the Go
  server; server restarts never touch it.

---

## Interaction with Existing Plans

- **`260714-t97o-web-view-lens` (drafted)** — unchanged and complementary:
  it moves iframe rendering from window *identity* to a main-slot lens. The
  panel's `web` surface reuses that lens renderer in the panel slot.
  Whichever ships first, the renderer is shared.
- **Synthetic iframe windows** (window-views § Two Species) — the panel does
  **not** replace them and does not change their exit path. A standalone
  full-page surface (e.g. a generated report) is still legitimately a window;
  the panel serves content that belongs *beside* a specific window.
- **Boards (window, view) pins** — the panel introduces the pair model on the
  terminal route; boards adopt it later per window-views § Two Species note.

---

## Open Questions

1. **Keyboard capture** — focus handed to the code-server iframe swallows
   run-kit shortcuts (and `⌘K` collides). The same-origin proxy provides the
   likely answer: the parent can attach a capture-phase `keydown` listener on
   `iframe.contentDocument` and reclaim rk chords before VS Code's keybinding
   service sees them — possible *only* because of the same-origin design.
   Unproven pattern; spike during phase 2.
2. **Layout state is per-browser** — tabs/layout live in browser IndexedDB
   (settings and dirty buffers follow the server), so a new browser or
   profile opens a blank layout. Decide: surface this to users or accept
   silently.
3. **Mobile in v1?** — recommendation: desktop-only first; the sheet is
   additive.
4. **Companion reaping** — who kills a done companion (riff, fab, the user)?
   Deferred to the agents-surface change.

Resolved 2026-08-11 (two spikes + source research): the proxy path is viable
— WS passthrough proven end-to-end, the Content-Length rewrite bug is fixed,
code-server's relative-base design fits the prefix-stripping proxy exactly,
no frame-blocking headers, auth cookie is deliberately sub-path-scoped. The
feared **service-worker collision is benign**: `Service-Worker-Allowed: /` is
a ceiling, not a claim — the registration requests a base-relative scope
(`./` → `/proxy/{port}/`), so run-kit's root-scope Web Push worker is not
evicted; registrations at different scopes coexist.

---

## Phasing

| # | Change | Ships |
|---|--------|-------|
| 1 | Rail + panel shell + `web` surface | The layout, resize/refit mechanics, P1–P7; smallest slice, immediate value |
| 2 | `code` lens + surface | Registry row, git-root derivation, code-server embed. Proxy prerequisites (spiked, proven): `SetXForwarded()` in the proxy's Rewrite hook (without it code-server's origin check 403s every WS handshake — loads, then sits disconnected), a `/proxy/{port}` → `/proxy/{port}/` redirect, `allow-downloads` in the iframe sandbox. First-run checks against a live code-server: SW registration scope reads `/proxy/{port}/` in devtools (expected per source), hot-exit round-trip. Open Question 1 (keyboard) spikes here |
| 3 | `@rk_owner` companions + `agents` surface | The convention, annotate+filter sweep, rollup, riff spawn shape |
