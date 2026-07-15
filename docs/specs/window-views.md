# Window Views — Rows Are Substrates, Views Are Lenses

> The model for every "parallel view" of a tmux window run-kit renders: what a
> window row *is*, what a view *is*, how view availability is derived, and how
> view choice is expressed. This spec unifies three features that grew up with
> three unrelated mechanisms — iframe windows (`@rk_type=iframe`), desktop
> streaming (PR #71), and the agent chat view
> ([`fab/plans/sahil/agent-chat-view.md`](../../fab/plans/sahil/agent-chat-view.md)).
> Sections marked **[current]** describe shipped behavior; **[target]** is the
> design intent this spec commits to.
>
> Companions: [`agent-state.md`](agent-state.md) defines `@rk_chat` (the chat
> view's capability signal); [`status-pyramid.md`](status-pyramid.md) is
> untouched by this model — status signals describe the substrate, never the
> lens.

---

## The Problem [current]

Three features each render "a second output of the same underlying thing", and
each invented its own typing and view-state machinery:

| Feature | Availability signal | View choice | Who sees a flip |
|---------|--------------------|-------------|-----------------|
| iframe window | `@rk_type=iframe` + `@rk_url` window options | server-side mutation — the `>_` button POSTs `@rk_type: null` | everyone; the window's identity changes globally |
| desktop (PR #71, unmerged) | `desktop:` window-name prefix + `@rk_vnc_port` | fixed at creation — the relay sniffs the type and branches, so the tty is unreachable | everyone, permanently |
| chat (planned) | `@rk_chat` pane option | client-side `?view=chat` + localStorage, per-viewer | just you |

Three conventions for "what kind of thing is this window", three for "which
view am I in". Left alone, every future projection (log viewer, diff viewer,
…) would invent a fourth.

---

## The Model [target]

Separate **what runs** from **what you can look at**:

1. **A window row is a substrate** — a supervised process in a tmux pane.
   Rows never exist purely to display something; if there is no process worth
   supervising, it should not be a window (see § Two Species).
2. **A view is a lens** — a renderer over one derivable output of that
   process. The tty is a lens. An iframe of the HTTP service the pane serves
   is a lens. The parsed agent transcript is a lens. The VNC framebuffer is a
   lens.
3. **Availability is derived; choice is per-viewer.** Which lenses a window
   offers is a *capability set* computed from pane/window options and
   derivable facts (Constitution II/X). Which lens *you* are looking through
   is client-side view state — never a server-side mutation, never part of
   the window's identity.

### The View Registry

| View | Available when | Renderer | Status |
|------|---------------|----------|--------|
| `tty` | always | xterm.js `TerminalClient` | **[current]** |
| `web` | `@rk_url` set (later: a listening HTTP port derived to be owned by the pane's process subtree) | `IframeWindow` (proxy iframe + URL bar) | **[current]** as a window *type*; **[target]** as a lens — change `260714-t97o-web-view-lens` |
| `chat` | `@rk_chat` pane option present | chat renderer | **[target]** — [`agent-chat-view.md`](../../fab/plans/sahil/agent-chat-view.md) changes 2–3 |
| `desktop` | VNC-port window option present (set by the desktop launcher, reconciler-cleared) | noVNC canvas | **[target]** — [`fab/plans/sahil/desktop-view.md`](../../fab/plans/sahil/desktop-view.md) |

The registry is open-ended: a new projection adds a row here, a capability
signal, and a renderer — it does not add a window type, a name convention, or
a route.

---

## Rules

### R1 — Availability is derived, never declared as identity

A lens's capability signal is a pane/window option or a request-time
derivation. `@rk_type` as a *mutable identity* is retired; it survives only as
a creation-time **default-view hint** (§ Migration). No window-name prefixes
(`desktop:`) — names belong to users.

### R2 — Choice is per-viewer, in the URL

View state lives in a `?view=` search param on the existing
`/$server/$window` route (Constitution IV: no new routes). Unknown or
unavailable values fall back to `tty`. Deep links (push notifications, Host
tiles) address a lens by URL. Last-chosen view per window persists in
localStorage as a **value-bearing key** (stores the view name; absent = the
window's default view). *This supersedes the chat plan's key-present
`board-autofit`-style convention — value-bearing generalizes past two states;
chat change 3 should read this spec at pickup.*

### R3 — The tty is always reachable

Every window offers `tty`, whatever else it offers. A desktop window's tty
shows the Xvfb/x11vnc supervisor logs; a headless codex-server pane's tty
shows the server logs. Watching the raw process is the run-kit ethos — no
lens may hide it, and no relay may sniff-and-branch it away.

### R4 — One switcher UX, shared by all lenses

A segmented chip in the top-bar right cluster's **L1 tier** (terminal-route
tier), rendered only when the capability set exceeds `{tty}`: two states
render `[tty|chat]`-style, more render as a compact segmented group. Active
segment inverse-video. Palette parity (`View: Terminal` / `View: Web` / …)
and a keyboard shortcut are mandatory (Constitution V). The center page
heading does **not** follow the lens — it reads a static `Window: <window>` in
every lens (reversed by change `260714-uco1-topbar-heading-anchor-nav`; it
formerly read `Terminal:`/`Web:`/`Chat:`/`Desktop:` per the active lens). The
heading identifies the *substrate* (the tmux window); which *lens* you look
through is shown by this switcher, not the heading — so the switcher is the
sole lens indicator, and the heading's left anchor no longer jumps on a lens
switch. Whichever change ships first (`web-view-lens` or chat change 3) builds
the generalized switcher; the other reuses it.

### R5 — Default view is a derived hint, not a lock

A window MAY carry a default lens (e.g. `@rk_type=iframe` legacy windows
default to `web`; a headless codex-server pane defaults to `chat`). The
default applies only when the URL carries no `?view=` and localStorage has no
entry. It never removes the switcher.

Capabilities are **orthogonal and stack**: nothing prevents one window from
offering `web` + `chat` + `desktop` simultaneously (an agent pane in a window
with `@rk_url` set, say). The switcher simply grows segments (R4); the only
question stacking raises is which *default* wins when several hints apply, and
the registry's fixed order answers it: `desktop > chat > web > tty` (a
desktop window's tty is supervisor logs; a chat hint is more specific to the
pane's process than a URL hint). The user's own choice — URL param, then
localStorage — always outranks any hint.

### R6 — The connection dot reports the current lens's health

"Dot-everywhere = per-page live-data health" extends per-lens: tty → relay WS,
web → n/a (falls back to SSE health), chat → chat stream, desktop → VNC WS.

### R7 — Substrate state stays global; view state stays local

Mutating the *content address* of a lens (e.g. editing `@rk_url` in the web
view's URL bar) is substrate state — shared, POSTed, visible to everyone.
Switching *which lens you look through* is view state — local, URL-carried.
The current `>_` button conflates these; the retrofit separates them.

---

## Two Species (and the residual case)

**Pane-coupled projections** — chat, desktop, and `web` on the row that
actually serves the port: the pane's process genuinely has multiple outputs.
This is the model's home turf.

**Row-less surfaces wearing a window costume** [current] — an iframe window
created from the Host SERVICES zone has an inert shell pane; the tmux
window exists only to give a URL identity, a sidebar seat, and
board-pinnability. Two-step exit path:

1. **[target, near]** Derive port → owning pane (listening-services collector
   already probes; `rk agent-hook` already walks pid ancestry) and surface the
   `web` lens on the *owning* row. Host "Open in window" deep-links to
   `/$server/$window?view=web` when an owner derives; synthetic-window
   creation remains the fallback for non-derivable services.
2. **[target, far]** External URLs (staging sites, other hosts) are the honest
   residual — no pane can own them. If demand persists, they become board-level
   **URL tiles** persisted like `board_order` in settings.yaml, and synthetic
   iframe windows retire entirely. Until then, the synthetic window stays as
   the compat shim.

Boards, later: a board pin generalizes from *window* to *(window, view)* pair
— "pin the same window twice, tty and chat side by side". Out of scope for
every current change; noted so nobody designs against it.

---

## Migration Map

| Feature | From [current] | To [target] | Vehicle |
|---------|---------------|-------------|---------|
| iframe | `@rk_type` mutation flips the view for everyone; render gate `rkType === "iframe" && rkUrl` | `web` lens: `?view=web`, chip, no type mutation; `@rk_type=iframe` demoted to default-view hint; `@rk_url` stays global substrate state | change `260714-t97o-web-view-lens` (drafted) |
| desktop | PR #71: name-prefix typing, relay sniffing, tty unreachable, bitrotted against current main | `desktop` lens per [`desktop-view.md`](../../fab/plans/sahil/desktop-view.md); supersede PR #71, salvage its components | new change stack (planned) |
| chat | planned as `?view=chat` | already conforms; adopt R2's value-bearing localStorage + R4's shared switcher | chat plan changes 1–4 (change 1 in progress) |
| Host "Open in window" | creates a synthetic iframe window | deep-link to owning row's `?view=web` when derivable; synthetic fallback | follow-up after `web-view-lens` |
