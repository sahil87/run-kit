# Window Views — Rows Are Substrates, Views Are Lenses

> The model for every "parallel view" of a tmux window run-kit renders: what a
> window row *is*, what a view *is*, how view availability is derived, and how
> view choice is expressed. This spec unified three features that grew up with
> three unrelated mechanisms — iframe windows (`@rk_win_lens=iframe`), desktop
> streaming (PR #71), and the agent chat view (since removed — see the removal
> note below; historically
> [`fab/plans/sahil/26-07-13-agent-chat-view.md`](../../fab/plans/sahil/26-07-13-agent-chat-view.md)).
> Sections marked **[current]** describe shipped behavior; **[target]** is the
> design intent this spec commits to.
>
> **Removal note (2026-09-04)**: the agent chat **view is removed** — PR #817
> (`260904-39bp-remove-chat-lens`) deleted the `?view=chat` lens, the `chat`
> surface kind, and the chat backfill/stream backend; chat-send merged into
> `POST /api/windows/{id}/send` (`target:"agent"`). `@rk_pane_chat` survives
> as agent-session identity ([`agent-state.md`](agent-state.md)). Chat
> mentions below are historical, kept where the taxonomy's history still
> teaches.
>
> Companions: [`agent-state.md`](agent-state.md) defines `@rk_pane_chat`
> (agent-session identity — consumed by operator actuation, fork/resume,
> closed-resume, auto-name); [`status-pyramid.md`](status-pyramid.md) is
> untouched by this model — status signals describe the substrate, never the
> lens.
>
> **Succession note (2026-08-12)**: [`surface-layout.md`](surface-layout.md)
> **[target]** generalizes *placement* — the exclusive main slot becomes a
> multi-tile surface layout, and R4's switcher retires in its phase 3. R1–R3
> and R5–R7 (availability derivation, per-viewer choice, tty reachability,
> default hints, dot semantics, substrate/view split) carry over unchanged.

---

## The Problem [current]

Three features each render "a second output of the same underlying thing", and
each invented its own typing and view-state machinery:

| Feature | Availability signal | View choice | Who sees a flip |
|---------|--------------------|-------------|-----------------|
| iframe window | `@rk_win_lens=iframe` + `@rk_win_url` window options | server-side mutation — the `>_` button POSTs `@rk_win_lens: null` | everyone; the window's identity changes globally |
| desktop (PR #71, unmerged) | `desktop:` window-name prefix + `@rk_vnc_port` | fixed at creation — the relay sniffs the type and branches, so the tty is unreachable | everyone, permanently |
| chat (shipped, then removed — PR #817) | `@rk_pane_chat` pane option | client-side `?view=chat` + localStorage, per-viewer | just you |

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
| `web` | always (the lens exists on every window, like `tty`); `@rk_win_url` selects the renderer's CONTENT — empty/whitespace renders the onboarding state (a reduced live URL bar + fill-path instructions), non-empty renders the live iframe — mirroring the `code` row's availability-vs-content split | `IframeWindow` (proxy iframe + URL bar; onboarding content state when `@rk_win_url` is empty) | **[current]** as a lens — change `260714-t97o-web-view-lens`; always-available + onboarding `260821-zqlq-web-tile-always-tileable-onboarding` |
| `chat` | — | — | **[removed]** — shipped per [`agent-chat-view.md`](../../fab/plans/sahil/26-07-13-agent-chat-view.md), removed by PR #817 (`260904-39bp-remove-chat-lens`); `@rk_pane_chat` survives as agent-session identity ([`agent-state.md`](agent-state.md)) |
| `code` | the window's code folder is LATCHED, or a git root is derivable from the active pane's cwd — derivation seeds the latch once, at first open, and the terminal never moves it afterwards (right-panel.md § The `code` lens); the code-server endpoint always resolves by convention, so it gates nothing, and reachability governs the renderer's CONTENT (live iframe vs not-running empty state), never availability | `CodeSurface` (lean proxy iframe, no URL bar) | **[current]** — change `260811-k3vp-right-panel-code-lens`, endpoint by convention `260811-a2bo`, folder latched `260813-if5d`; also the right panel's CODE surface (right-panel.md § Surface Registry) |
| `desktop` | VNC-port window option present (set by the desktop launcher, reconciler-cleared) | noVNC canvas | **[target]** — [`fab/plans/sahil/26-07-14-desktop-view.md`](../../fab/plans/sahil/26-07-14-desktop-view.md) |

The registry is open-ended: a new projection adds a row here, a capability
signal, and a renderer — it does not add a window type, a name convention, or
a route.

---

## Rules

### R1 — Availability is derived, never declared as identity

A lens's capability signal is a pane/window option or a request-time
derivation. `@rk_win_lens` as a *mutable identity* is retired; it survives only as
a creation-time **default-view hint** (§ Migration). No window-name prefixes
(`desktop:`) — names belong to users.

Web availability carries no signal at all: the `web` lens is **always
available** (like `tty`). `@rk_win_url` is its *content selector*, never its
availability gate — an empty/whitespace value renders the tile's onboarding
state (whose live address bar is itself the initialization path), a non-empty
value renders the live iframe. This is the `code` row's model: a stable
capability signal gates presence; a fluctuating condition governs content.

### R2 — Lens choice is shared tab state

Which lenses a tab shows is shared tab state: the `@rk_win_layout` window
option carries shape and order, and every viewer of the tab renders the same
arrangement ([`ui-state.md`](ui-state.md) § Layout in tmux). Unknown shapes or
unavailable surfaces degrade tile-by-tile toward `tty`; the option itself is
left as written. Deep links (push notifications, Host tiles) address the tab's
bare route. The only per-viewer part of lens choice is the viewer's zoom /
mobile single-tile choice, held in the `rk-layout-zoom:{server}:{@N}`
localStorage key (a surface kind; absent = no zoom).

### R3 — The tty is always reachable

Every window offers `tty`, whatever else it offers. A desktop window's tty
shows the Xvfb/x11vnc supervisor logs; a headless codex-server pane's tty
shows the server logs. Watching the raw process is the run-kit ethos — no
lens may hide it, and no relay may sniff-and-branch it away.

The `web` lens is likewise always *reachable* (always tileable): a `?view=web`
(or `?layout=…web…`) deep link on a URL-less window keeps its tile and renders
the onboarding content state — it never degrades away to `tty`. The
`defaultView` hint is unaffected: a URL-less window still defaults to `tty`
unless the viewer chose otherwise.

### R4 — One switcher UX, shared by all lenses

A segmented chip in the top-bar right cluster's **L1 tier** (terminal-route
tier), rendered only when the capability set exceeds `{tty}`: two states
render `[tty|web]`-style, more render as a compact segmented group. Active
segment inverse-video. Palette parity (`View: Terminal` / `View: Web` / …)
and a keyboard shortcut are mandatory (Constitution V). The chip
**participates in the right-cluster overflow registry** (change
`260717-6anu-mobile-view-switcher-overflow`; the `260715-h1ck` priority+
registry): it is the **first candidate — so the first to yield** when the
cluster is squeezed (before any L1 split), and when it overflows it is
represented in the "More controls" chevron menu as **per-view rows** (`View:
Terminal` / `View: Web` / `View: Code`, the active row marked). This is
space-driven, not a mobile breakpoint gate — the pill stays inline whenever
there is room (on any viewport) and yields precisely when the heading needs the
space (the common phone case). The center page
heading does **not** follow the lens — it reads a static `Window: <window>` in
every lens (reversed by change `260714-uco1-topbar-heading-anchor-nav`; it
formerly read `Terminal:`/`Web:`/`Chat:`/`Desktop:` per the active lens). The
heading identifies the *substrate* (the tmux window); which *lens* you look
through is shown by this switcher, not the heading — so the switcher is the
sole lens indicator (**while collapsed into the menu, the marked menu row plus
the view content itself carry lens identity; deliberately no new inline lens
indicator is added to the bar**), and the heading's left anchor no longer jumps
on a lens switch. The generalized switcher shipped with `web-view-lens`
(change `260714-t97o`).

### R5 — retired

R5 — retired: the default-view hint is subsumed by an explicit `single:web`
layout ([`ui-state.md`](ui-state.md)).

### R6 — The connection dot reports the current lens's health

"Dot-everywhere = per-page live-data health" extends per-lens: tty → relay WS,
web → n/a (falls back to SSE health), desktop → VNC WS.

### R7 — Content address and lens choice are substrate state; postures stay local

Mutating the *content address* of a lens (`@rk_win_web_<n>`, edited in the web
view's URL bar) and choosing *which lenses the tab shows* (`@rk_win_layout`)
are both substrate state — shared tmux window options, POSTed, visible to
every viewer and agent. Only render postures stay local to the viewer: tile
zoom (`rk-layout-zoom:*`), divider ratios (`rk-layout-ratios:*`), and focus.

---

## Two Species (and the residual case)

**Pane-coupled projections** — desktop, and `web` on the row that actually
serves the port: the pane's process genuinely has multiple outputs. This is
the model's home turf.

**Row-less surfaces wearing a window costume** [current] — an iframe window
created from the Host SERVICES zone has an inert shell pane; the tmux
window exists only to give a URL identity, a sidebar seat, and
board-pinnability. Two-step exit path:

1. **[target, near]** Derive port → owning pane (listening-services collector
   already probes; `rk agent hook` already walks pid ancestry) and surface the
   `web` lens on the *owning* row. Host "Open in window" deep-links to
   `/$server/$window?view=web` when an owner derives; synthetic-window
   creation remains the fallback for non-derivable services.
2. **[target, far]** External URLs (staging sites, other hosts) are the honest
   residual — no pane can own them. If demand persists, they become board-level
   **URL tiles** persisted like `board_order` in settings.yaml, and synthetic
   iframe windows retire entirely. Until then, the synthetic window stays as
   the compat shim.

Boards, later: a board pin generalizes from *window* to *(window, view)* pair
— "pin the same window twice, tty and web side by side". Out of scope for
every current change; noted so nobody designs against it.

---

## Migration Map

| Feature | From [current] | To [target] | Vehicle |
|---------|---------------|-------------|---------|
| iframe | `@rk_win_lens` mutation flips the view for everyone; render gate `rkType === "iframe" && rkUrl` | `web` lens: `?view=web`, chip, no type mutation; `@rk_win_lens=iframe` demoted to default-view hint; `@rk_win_url` stays global substrate state | change `260714-t97o-web-view-lens` (drafted) |
| desktop | PR #71: name-prefix typing, relay sniffing, tty unreachable, bitrotted against current main | `desktop` lens per [`desktop-view.md`](../../fab/plans/sahil/26-07-14-desktop-view.md); supersede PR #71, salvage its components | new change stack (planned) |
| chat | shipped as `?view=chat` (chat plan changes 1–3) | **removed** — the lens, `chat` surface kind, and backfill/stream backend deleted; `?view=chat` is now a dropped legacy param (heals to the stored layout); chat-send merged into `POST /send` (`target:"agent"`) | PR #817 (`260904-39bp-remove-chat-lens`) |
| Host "Open in window" | creates a synthetic iframe window | deep-link to owning row's `?view=web` when derivable; synthetic fallback | follow-up after `web-view-lens` |
