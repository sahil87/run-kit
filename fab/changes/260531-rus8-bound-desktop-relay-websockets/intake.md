# Intake: Bound desktop relay WebSockets

**Change**: 260531-rus8-bound-desktop-relay-websockets
**Created**: 2026-05-31
**Status**: Draft

## Origin

> Suspend off-screen DesktopRow board panes so the live relay WebSocket count stays under the browser's HTTP/1.1 ~6-connections-per-origin cap on plaintext origins. Drive each pane's `paused` prop from visibility (IntersectionObserver) or an LRU cap, instead of the current hardcoded `paused={false}`.

Conversational mode. Second of two fixes drafted from a `/fab-discuss` transport-analysis session. The first (`260531-m3pl-static-xterm-imports`) removes the xterm chunk fetches from the runtime connection budget; this one bounds the *persistent* streams (relay WebSockets) that hold connection slots indefinitely. Together they make the board route fit under the 6-connection cap on any plaintext origin. See memory `e2e-flakiness-board-route-dynamic-import-hang`.

## Why

**Problem.** On the desktop board, `DesktopRow` renders every pinned pane with `paused={false}` hardcoded (`board-page.tsx:579`). Each unpaused `<BoardPane>` mounts a `<TerminalClient>` that opens one long-lived `/relay/<wid>` WebSocket. That WebSocket is **never released while the pane is mounted** — even when the pane is scrolled out of the horizontal viewport (`DesktopRow` is an `overflow-x-auto` strip, `board-page.tsx:570`). Nothing observes scroll position or intersection, so a board with K pinned windows holds K live relay WebSockets regardless of how many are visible.

**Consequence.** On a plaintext HTTP/1.1 origin (the E2E/dev path `http://localhost:3020`, and any raw-port `http://...:3000` access), the browser caps persistent connections at ~6 per origin. The budget is consumed by: the Vite HMR socket (dev), one pooled SSE `EventSource` per attached server (boards attach **all** known servers, so multi-server boards open one SSE *each*), and K relay WebSockets. Once `1 (SSE) + K (relay)` approaches 6, transient REST `fetch` calls queue behind freed slots — and on a cold board, the xterm chunk fetches (addressed by the sibling change) starve. With enough panes the SSE stream itself can be crowded out. This is invisible in production over Tailscale HTTPS (h2 multiplexes and WebSockets ride separate connections with a ~255 limit), but bites on every plaintext origin. The mobile `MobileCarousel` already does the right thing — `paused={idx !== carouselIndex}` (`board-page.tsx:627`) keeps only the visible pane's WebSocket open; only `DesktopRow` lacks the equivalent.

**Why this approach over alternatives.** The `paused` plumbing already exists end-to-end and is proven on mobile: `BoardPane` gates `<TerminalClient>` on `!paused` (`board-pane.tsx:98`); unmounting runs `TerminalClient`'s cleanup which sets `cancelled = true` and calls `ws.close()` (`terminal-client.tsx:494-502`), and the `cancelled` flag prevents the `onclose` handler from scheduling a reconnect (`:474`), so the close is final and the connection slot genuinely frees. Server-side teardown is sound (`sync.Once` on the relay). So the fix is to **drive `paused` on the desktop row** rather than build new machinery. Two candidate mechanisms (decision deferred to spec): (a) **visibility-driven** via `IntersectionObserver` on the `rowRef` scroll container, pausing panes outside the viewport with a pre-warm margin; (b) **LRU cap** — keep the K most-recently-focused panes live and pause the rest, bounding live connections to a fixed number independent of scroll geometry. Rejected: capping the *number of pins* (too restrictive — users want many pinned panes, just not all connected at once); switching transport to h2 for tests (hard, and only hides the ceiling).

## What Changes

### `app/frontend/src/components/board/board-page.tsx` — `DesktopRow`

Replace the hardcoded `paused={false}` (`:579`) with a computed `paused` value per pane. Mechanism TBD at spec — one of:

- **IntersectionObserver**: observe each pane element against the `rowRef` scroll container (`:545`). A pane that leaves the viewport (beyond a configurable pre-warm margin, e.g. one pane-width on each side) is paused; re-entering unpauses. Requires a per-pane ref array (the `paneRefs` ref array already exists, `:152`) and an observer wired in an effect alongside the existing wheel handler (`:556-567`).
- **LRU cap**: track focus order; keep the K most-recently-focused panes (K chosen to stay safely under budget, e.g. 4) unpaused, pause the rest. Simpler — no geometry — and directly bounds connections.

### Behavior to preserve

- The focused pane is **always** live (never paused), so `Cmd+]`/`Cmd+[` focus cycling and BottomBar targeting (`board-pane.tsx:74-82`) keep working.
- Pausing a previously-live pane shows the existing reconnect UX: unmount → `ws.close()` → on re-mount, `TerminalClient` re-connects and replays from the relay (`needsReset` / `terminal.reset()`, `terminal-client.tsx:452`). The visible `[reconnecting...]` flicker (`:481`) is acceptable on mobile swipe but more frequent on desktop scroll — a pre-warm margin and/or debounce mitigates thrash. The exact margin/debounce is a spec decision.
- `MobileCarousel` is unchanged — it already suspends correctly.

## Affected Memory

<!-- The board route's user-visible behavior (which panes show terminal content) changes
     subtly: off-screen desktop panes now disconnect and reconnect on re-entry. This is a
     spec-level behavior change to the board/relay UI patterns, so the ui-patterns memory
     likely warrants an update during hydrate to document desktop pane suspension (mirroring
     the already-documented mobile carousel behavior). Marked (modify) tentatively — confirm
     at spec/hydrate whether ui-patterns already covers pane lifecycle. -->

- `run-kit/ui-patterns`: (modify) document desktop board-pane WebSocket suspension (off-screen panes disconnect/reconnect), mirroring the existing mobile-carousel pause behavior. Confirm scope at hydrate.

## Impact

- **Code**: `app/frontend/src/components/board/board-page.tsx` (`DesktopRow` only). Possibly a small hook (`use-visible-panes` / `use-lru-live-panes`) if the logic warrants extraction.
- **Tests**: New/updated board E2E coverage — assert that off-screen desktop panes pause (relay WS closes) and re-entering re-establishes content. Companion `.spec.md` required per the Test Companion Docs constitution rule for any new/modified `*.spec.ts`. Unit coverage for the LRU/visibility selection logic if extracted to a hook.
- **No backend, API, or protocol impact.** Relay WS handshake and tmux behavior unchanged — this only changes *when* the client opens/closes a relay connection.
- **Interaction with sibling change**: independent and composable. `260531-m3pl` removes runtime chunk-fetch pressure; this removes persistent-stream pressure. Either helps; both together make the board route robust under 6 connections.

## Open Questions

- IntersectionObserver (visibility-accurate, geometry-aware, pre-warm margin) vs LRU cap (simpler, fixed bound, no scroll math)? Tradeoff: IO matches the mobile model and only pauses genuinely off-screen panes; LRU is simpler and guarantees a hard connection ceiling but may pause a visible pane if many are on-screen at once on a wide monitor.
- What is the connection budget target? With one SSE per attached server and a possible Vite HMR socket in dev, the safe number of simultaneously-live relay panes is roughly `6 − (servers) − (1 if dev)`. Should the cap be static (e.g. 4) or derived from attached-server count?
- Pre-warm margin and debounce values to avoid reconnect thrash during desktop scroll — needs empirical tuning (Playwright-driven, per the project's Playwright-Driven Development workflow).
- Is the reconnect flicker (`[reconnecting...]`) acceptable for desktop scroll-back, or should re-entry suppress the flicker (e.g. keep the xterm buffer and only re-open the socket silently)?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | DesktopRow hardcodes `paused={false}` so no desktop pane ever suspends its relay WS; MobileCarousel already suspends correctly | Verified by reading board-page.tsx (:579 vs :627) and board-pane.tsx this session | S:95 R:90 A:95 D:95 |
| 2 | Certain | The `paused` plumbing already frees the connection: unmount → cancelled=true + ws.close(), and cancelled blocks reconnect; server teardown is sync.Once | Verified in terminal-client.tsx:466-502 and board-pane.tsx:40 comment | S:95 R:85 A:90 D:90 |
| 3 | Confident | Reuse the existing `paused` prop rather than build new suspension machinery | It's proven on mobile and end-to-end correct; the only gap is what drives the desktop value | S:80 R:70 A:85 D:80 |
| 4 | Confident | change_type = fix | Bounds connections to repair the plaintext-origin board-route hang/starvation; matches "fix"/"hang"/"regression" | S:80 R:90 A:90 D:80 |
| 5 | Tentative | Mechanism: IntersectionObserver vs LRU cap | Both viable with different tradeoffs (geometry-accurate vs fixed-ceiling); front-runner is IntersectionObserver to mirror mobile, but not decided — deferred to spec | S:50 R:60 A:60 D:45 |
| 6 | Tentative | Connection-budget target (static cap e.g. 4 vs derived from attached-server count) | Depends on SSE-per-server count and dev HMR socket; needs the mechanism decision first | S:45 R:65 A:55 D:50 |
| 7 | Tentative | ui-patterns memory needs a (modify) for desktop pane suspension | Plausible spec-level UI behavior change, but unconfirmed whether ui-patterns already covers pane lifecycle — confirm at hydrate | S:50 R:75 A:55 D:60 |
| 8 | Tentative | Reconnect flicker on scroll-back is acceptable vs needs silent re-open | UX judgment requiring empirical Playwright tuning; not resolvable from context alone | S:45 R:70 A:45 D:55 |

8 assumptions (2 certain, 2 confident, 4 tentative, 0 unresolved).
