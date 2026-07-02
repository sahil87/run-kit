# Intake: Session/Window Tile Grid on /$server with Live Pane Previews

**Change**: 260701-70a0-session-window-tile-grid
**Created**: 2026-07-01

## Origin

Backlog item `[70a0]` (2026-07-01), one-shot invocation via `/fab-new 70a0`. Raw input:

> Session/window tile grid on /$server with live pane previews — give the /$server empty state (serverIndexRoute, currently a near-empty "select a window above" hint, router.tsx:42) a real job: a tile grid of the server's sessions that EXPAND into per-window tiles, each window tile showing a PREVIEW of what that pane is doing. This is the multi-agent monitoring-DENSITY view — the differentiator vs single-session tools (CC Remote Control, Happy) — "what is every agent doing right now" at a glance. PREVIEW MECHANISM (critical — do NOT use N live terminal relays): render a periodic TEXT SNAPSHOT via tmux capture-pane -p (last ~15-20 lines) pushed over the EXISTING SSE hub, as static text — NOT a live xterm per tile. [...] Upgrade a tile to a real live terminal ONLY on focus/click (navigate to /$server/$window).

The mechanism, anti-pattern, scope, files, acceptance, and Constitution ties were all specified in the backlog item. No prior conversation to mine.

## Why

**Problem.** The `/$server` index (`serverIndexRoute`, `router.tsx:42`) has no component — it renders an empty "select a window above" hint. run-kit's core value proposition is multi-agent monitoring density: seeing *what every agent is doing right now* at a glance. That view does not exist today; an operator must click into each window one at a time to see its state, which is exactly the single-session workflow that competitors (CC Remote Control, Happy) already offer. The density view is the differentiator.

**Consequence of not fixing.** run-kit stays at parity with single-session tools on its home surface. The empty index route wastes the most natural place for the density view — the route you land on when you pick a server but no window.

**Why this approach.** The hard constraint is the documented HTTP/1.1 6-per-origin connection-pool starvation (`docs/memory/run-kit/` — board-route dynamic-import hang + pane-resize suspension). N live terminal relays for N tiles would re-trigger exactly that failure. The chosen mechanism sidesteps it entirely: render a periodic **text snapshot** via `tmux capture-pane -p` pushed over the **existing SSE hub** as static text — derive-from-tmux (Constitution II), adds no relay, no pool pressure. A tile upgrades to a real live terminal only on click (navigate to the existing `/$server/$window` route). The backend primitive already exists: `tmux.CapturePane(paneID, lines, server)` at `app/backend/internal/tmux/tmux.go:1320`.

## What Changes

### Backend: capture-pane snapshots joined into the sessions enrichment

Add a periodic text-snapshot capture to the sessions enrichment path, keyed per window, bounded to only the windows a client is actually viewing (expanded sessions).

- **Capture primitive (exists).** `tmux.CapturePane(paneID string, lines int, server string) (string, error)` at `tmux.go:1320` already runs `capture-pane -t <paneID> -p -S -<start>` via `tmuxExecRawServer` (context + timeout, Constitution I). Reuse it; do not add a new tmux helper unless a per-window pane-ID resolution gap requires one.
- **Snapshot field on the per-window payload.** `WindowInfo` (`tmux.go:215`) is the per-window struct serialized into the `event: sessions` SSE payload. Add a preview field, e.g. `Preview string \`json:"preview,omitempty"\`` (last ~15–20 lines of the window's active pane, as raw text with blank lines preserved).
- **Bounded cost.** Capturing every pane on every 2.5s poll is the cost risk. Snapshot **only expanded/visible windows** — the set the client currently has expanded. The client declares its expanded sessions via a per-connection **preview-scope POST** (see below); the enrichment captures panes only for windows in those expanded sessions. Respect the existing cache layers: the 500ms `sseCacheTTL` on the session fetch and the 2.5s `legacyPollInterval`. The snapshot rides the existing poll cadence — no new goroutine, no new poll loop.

### Backend: preview-scope endpoint (bounding signal)

The client tells the backend which windows to capture via a **per-connection expanded-set POST** — the tightest cost bound, matching "only expanded/visible" exactly.
<!-- clarified: expanded-window signal — per-connection preview-scope POST chosen over capturing all windows on the server; capture cost scales with what's actually expanded, not total window count -->

- **Endpoint**: `POST /api/preview-scope` (Constitution IX — all mutating endpoints are POST), body `{ "expanded": ["<sessionId>", ...] }`. Present keys set the connection's expanded-session set; the enrichment then captures panes only for windows belonging to those sessions.
- **Per-connection state**: the expanded set is scoped to the requesting SSE connection (correlated by a connection/client identifier, consistent with the existing per-connection relay identity model — see `docs/memory/run-kit/ui-patterns.md`). No database (Constitution II) — the set lives in the in-memory hub for the life of the connection and is dropped on disconnect.
- **Default (empty scope)**: with no expanded sessions declared, capture nothing — previews are opt-in per expansion, so an operator sitting on the tiles view with everything collapsed incurs zero capture cost.
- The frontend re-POSTs the scope whenever the expanded set changes (session expand/collapse), and the next poll tick emits `event: preview` for the new set.

### Backend: SSE delivery — separate `event: preview`

The snapshot text is delivered over the existing SSE hub as a **dedicated lightweight `event: preview`**, decoupled from the `sessions` dedup/order machinery.
<!-- clarified: SSE delivery — separate `event: preview` chosen over extending the `sessions` payload; keeps the sessions payload lean and lets preview cadence stay independent of structural updates -->

- The event body is a map of `{windowId → previewText}` covering only the expanded windows (see the preview-scope mechanism below), e.g.:
  ```
  event: preview
  data: {"@3": "...last 18 lines...", "@5": "...last 18 lines..."}
  ```
- The `event: sessions` payload is **unchanged** — no `preview` field on `WindowInfo`. Structural session/window updates and preview text travel on separate events, so growing preview text never bloats the sessions dedup cache and preview cadence can differ from the 2.5s sessions tick if warranted.
- New clients get the latest cached preview map on connect (mirroring how `sessions`/`session-order`/`metrics` snapshots are sent immediately in `subscribe`), so a freshly-mounted tiles view is not blank until the next tick.

### Frontend: tiles view rendered by serverIndexRoute

Give `serverIndexRoute` (`router.tsx:42-45`) a real component — a new `components/session-tiles/` view.

- **Session tiles.** One tile per session on the current server. Reuse the existing `StatusDot` (the unified lifecycle-journey dot — see `docs/memory/run-kit/ui-patterns.md`) on each tile.
- **Expand → window tiles.** Clicking/expanding a session tile reveals per-window tiles. Each window tile shows the **text preview** (the `capture-pane` snapshot) as static, monospace text — NOT an xterm instance.
- **Live SSE updates.** Previews update on the SSE tick for expanded windows. Only expanded/visible windows are captured (bounded cost — see backend).
- **Click → live terminal.** Clicking a window tile navigates to `/$server/$window` (the existing terminal route), which is where the single live relay connection is opened. No relay is opened for previews.
- **No new route.** This enriches the existing empty `serverIndexRoute` (Constitution IV — resist new routes/pages).

### Explicit non-goals

- **NO N-live-relay grid.** Previews are static text snapshots, never live xterm relays per tile. This is the load-bearing constraint.
- **No new route.** `serverIndexRoute` is enriched in place.
- **No unbounded capture.** Only expanded/visible windows are snapshotted.

## Affected Memory

- `run-kit/ui-patterns`: (modify) new session-tiles density view rendered by `serverIndexRoute`; the `/$server` index route gains a component (was an empty hint); tile expand/collapse model, StatusDot reuse on tiles, click-to-live-terminal navigation.
- `run-kit/architecture`: (modify) sessions enrichment gains a per-window `capture-pane` text snapshot (bounded to expanded windows) delivered over the SSE hub; SSE payload shape change on `WindowInfo` or a new `preview` event.
- `run-kit/tmux-sessions`: (modify, conditional) if a per-window active-pane resolution helper is added to feed `CapturePane`, note it here; skip if the existing pane addressing suffices.

## Impact

- **Backend**: `app/backend/internal/tmux/tmux.go` (possibly a per-window active-pane-ID resolution helper — `CapturePane` itself already exists; `WindowInfo` is left unchanged since preview rides a separate event), `app/backend/internal/sessions/sessions.go` (capture panes for expanded windows during enrichment), `app/backend/api/sse.go` (new `event: preview` broadcast + cached-on-connect delivery + per-connection expanded-set state), a new preview-scope handler (`POST /api/preview-scope`) registered in `app/backend/api/router.go`. All tmux exec via `exec.CommandContext` + timeout (Constitution I).
- **Frontend**: `app/frontend/src/router.tsx` (give `serverIndexRoute` a component), new `app/frontend/src/components/session-tiles/*` (tiles view, session tile, window tile), reuse of `components/status-dot.tsx`. SSE client subscription in the tiles view.
- **Tests**: Go tests for the capture-snapshot enrichment (bounded to expanded windows) and SSE payload; Playwright spec + sibling `.spec.md` (Constitution Test Companion Docs) for the tiles view. WATCH: this route has known mount-race/SSE fragility in E2E (`docs/memory/run-kit/` board-route entries) — be deliberate about the SSE subscription lifecycle.
- **Dependencies**: none new. Reuses existing tmux capture primitive and SSE hub.
- **Related backlog**: `[9lxa]` (graphical desktop window type — a desktop tile would show a thumbnail instead of capture-pane text; sequence after this); the `/` host-console "Cockpit" item (sibling surface).

## Open Questions

Both prior design forks were resolved at intake (see the What Changes subsections and the `<!-- clarified -->` markers):

- **SSE delivery shape** → *resolved*: separate lightweight `event: preview` (not extending the `sessions` payload).
- **Expanded-window signal** → *resolved*: per-connection `POST /api/preview-scope` expanded-set (not capture-all-on-server).

Remaining minor implementation detail (safe for apply to decide-and-record): the exact per-connection correlation mechanism for the preview-scope set (which SSE-connection identifier the POST keys on) — to be wired consistently with the existing per-connection relay identity model.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Preview = periodic `capture-pane -p` text snapshot over SSE, NOT N live xterm relays | Explicitly specified as the critical mechanism; the anti-pattern (relay pool starvation) is documented in memory; Constitution II (derive-from-tmux) | S:100 R:70 A:95 D:95 |
| 2 | Certain | Enrich the existing `serverIndexRoute` in place — no new route | Explicitly specified; Constitution IV (minimal surface, resist new routes) | S:95 R:80 A:100 D:95 |
| 3 | Certain | Reuse the existing `tmux.CapturePane` primitive (tmux.go:1320) rather than add a new capture helper | Primitive already exists with correct exec-context+timeout shape (Constitution I); verified in code | S:90 R:85 A:100 D:90 |
| 4 | Confident | Capture only expanded/visible windows to bound cost; ride the existing 2.5s poll + 500ms cache, no new poll loop | Specified ("snapshot only visible/expanded windows to bound cost"); existing cache/poll cadence is the natural seam | S:75 R:65 A:80 D:70 |
| 5 | Confident | Capture last ~15–20 lines per pane | Specified as a range; exact value (18) is a trivial, reversible constant | S:70 R:90 A:85 D:80 |
| 6 | Confident | Tile model: session tiles → expand → window tiles (text preview) → click routes to /$server/$window live terminal; reuse StatusDot | Fully specified interaction model; StatusDot reuse is an established pattern in ui-patterns memory | S:80 R:60 A:75 D:75 |
| 7 | Confident | SSE delivery: separate lightweight `event: preview` ({windowId → text}), sessions payload unchanged; cached-on-connect | User-resolved at intake — decoupled cadence, leaner sessions payload; one obvious shape now that the fork is decided | S:90 R:55 A:75 D:90 |
| 8 | Confident | Expanded-window signal: per-connection `POST /api/preview-scope` {expanded:[...]}, in-memory per-connection set, capture-nothing default | User-resolved at intake — tightest cost bound; POST per Constitution IX, in-memory per Constitution II; only the connection-correlation detail is left for apply | S:85 R:50 A:75 D:90 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
