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

Replace the hardcoded `paused={false}` (`:579`) with a computed `paused` value per pane, **gated on origin protocol**:

- **On plaintext (`http:`) origins** — where the ~6-connection ceiling exists — drive `paused` from an **IntersectionObserver**: observe each pane element against the `rowRef` scroll container (`:545`). A pane that leaves the viewport (beyond a configurable pre-warm margin, e.g. one pane-width on each side) is paused; re-entering unpauses. Requires a per-pane ref array (the `paneRefs` ref array already exists, `:152`) and an observer wired in an effect alongside the existing wheel handler (`:556-567`). A **hard cap of 4** simultaneously-live relay panes backstops the observer: if more than 4 panes are visible at once (wide monitor), the least-recently-focused live panes beyond 4 are paused to stay under budget. The focused pane is never paused.
<!-- clarified: mechanism = IntersectionObserver (mirrors mobile carousel, geometry-accurate, only pauses genuinely off-screen panes). Decided by user this session. -->
- **On secure (`https:`) origins** — where h2 multiplexes and the ceiling does not exist — behavior is **exactly today's**: every pane renders `paused={false}`, no IntersectionObserver, no cap, no reconnect flicker. The suspension feature is HTTP-only so production behavior over Tailscale HTTPS is provably unchanged.
<!-- clarified: budget = cap 4 on plaintext HTTP only; uncapped (feature off) on HTTPS. The 6-conn ceiling is plaintext-only, so the suspension feature gates on location.protocol === 'http:'. Decided by user this session. -->

Rejected at clarify: a budget *derived* from attached-server count (`6 − servers − devHMR`) — more moving parts to test, and a static cap of 4 is safely under budget for the common single-server board while never exceeding it. Also rejected: running the IntersectionObserver on HTTPS too (would add reconnect flicker on h2 scroll-back for no connection-budget reason).

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

*(Mechanism and budget resolved at clarify — see What Changes. Remaining questions are spec-level tuning, not blocking.)*

- Pre-warm margin and debounce values to avoid reconnect thrash during desktop scroll — needs empirical tuning (Playwright-driven, per the project's Playwright-Driven Development workflow). Spec decision.
- Is the reconnect flicker (`[reconnecting...]`) acceptable for desktop scroll-back, or should re-entry suppress the flicker (e.g. keep the xterm buffer and only re-open the socket silently)? Spec/UX decision; flicker is already accepted on mobile swipe.
- How to detect "plaintext origin" robustly: `location.protocol === 'http:'` is the obvious signal, but confirm it correctly classifies the E2E/dev path (`http://localhost:3020`) and raw-port access vs the Tailscale HTTPS path. Spec decision.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | DesktopRow hardcodes `paused={false}` so no desktop pane ever suspends its relay WS; MobileCarousel already suspends correctly | Verified by reading board-page.tsx (:579 vs :627) and board-pane.tsx this session | S:95 R:90 A:95 D:95 |
| 2 | Certain | The `paused` plumbing already frees the connection: unmount → cancelled=true + ws.close(), and cancelled blocks reconnect; server teardown is sync.Once | Verified in terminal-client.tsx:466-502 and board-pane.tsx:40 comment | S:95 R:85 A:90 D:90 |
| 3 | Confident | Reuse the existing `paused` prop rather than build new suspension machinery | It's proven on mobile and end-to-end correct; the only gap is what drives the desktop value | S:80 R:70 A:85 D:80 |
| 4 | Confident | change_type = fix | Bounds connections to repair the plaintext-origin board-route hang/starvation; matches "fix"/"hang"/"regression" | S:80 R:90 A:90 D:80 |
| 5 | Certain | Mechanism = IntersectionObserver (not LRU cap) | Clarified — user chose IO this session to mirror the mobile carousel model and pause only genuinely off-screen panes; LRU rejected | S:95 R:60 A:90 D:90 |
| 6 | Certain | Budget = static cap of 4 live relay panes, applied on plaintext HTTP only | Clarified — user chose a static cap of 4 (safe under the 6-conn ceiling for single-server boards); derived-from-server-count rejected as over-engineered | S:90 R:65 A:85 D:85 |
| 9 | Certain | Suspension feature is HTTP-only: gated on `location.protocol === 'http:'`; HTTPS keeps today's `paused={false}` behavior with no IO and no cap | Clarified — the 6-conn ceiling is plaintext-only (h2 multiplexes), so production over Tailscale HTTPS is provably unchanged; smallest blast radius | S:90 R:70 A:90 D:90 |
| 7 | Confident | ui-patterns memory gets a (modify) documenting desktop pane suspension | The behavior demonstrably changes (off-screen desktop panes disconnect/reconnect) and mirrors the already-documented mobile-carousel pause; documenting it is the obvious default. Exact scope (whether a new section vs amend existing) is a hydrate detail, not a fork — hydrate-time only, zero implementation impact | S:70 R:85 A:75 D:80 |
| 8 | Confident | Reconnect flicker on scroll-back defaults to the accepted mobile behavior; silent re-open is a possible spec-level enhancement | The intake notes flicker is already accepted on mobile swipe (:33); defaulting desktop to the same proven behavior is the obvious front-runner, with a pre-warm margin mitigating thrash. Silent re-open can be layered later without rework | S:70 R:75 A:70 D:75 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
