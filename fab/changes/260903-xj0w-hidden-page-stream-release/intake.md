# Intake: Hidden-Page Terminal Stream Release

**Change**: 260903-xj0w-hidden-page-stream-release
**Created**: 2026-09-03

## Origin

Conversational — diagnosed live in a `/fab-discuss` session (2026-09-03) investigating "why does tmux constantly resize when switching tabs?" (user accessing a US server from India, high latency).

> While switching tabs tmux always goes to its smaller size … After a few seconds it expands to take the whole space. Why is tmux constantly resizing?

Root cause established by live forensics on the affected box (`tmux -L rK list-clients`, tailscale peer-traffic diffing, process inspection):

- Every run-kit terminal view is a full `tmux attach-session` client with its own PTY sized to that view (`app/backend/api/terminals_ws.go`, `pty.StartWithSize`).
- The user had three desktop-shell windows (Cmd+N) on different hosts. The desktop shell keeps **one persistent `WebContentsView` per (window, host) pair** whose renderer — including its `/ws/terminals` streams — stays fully alive while detached (by design, for instant host switching; see `docs/memory/run-kit/desktop-shell.md` § Host Views). A *background* window's detached view of this host therefore held a live tmux attach client at that window's size (116×37) while the foreground view was 145×44.
- The managed tmux conf sets no `window-size`, so tmux's default `window-size latest` governs: each window is sized to the client that most recently sent input in it. Every network blip (frequent on the high-latency link) kills all attach clients simultaneously; when a client dies, windows whose "latest" pointer was that client lose it and tmux falls back to the **smallest** attached client — the invisible background view. Windows snapped to 116×36 after every reconnect wave and expanded only as the user's input re-claimed each one.
- User confirmed: closing the extra desktop-shell windows eliminated the symptom entirely.

Key user decisions from the discussion: `window-size largest`/`smallest`/`manual` mitigations were **explicitly rejected** ("window-size largest is not the answer" — they treat the symptom and are wrong for phone viewers). The agreed fix: **a view you're not looking at should hold no tmux client at all.**

## Why

1. **Problem**: Any hidden run-kit page — a detached desktop-shell `WebContentsView`, a backgrounded browser tab, a minimized window, a forgotten PWA — keeps its terminal relay streams open. Server-side each stream is a sized `tmux attach-session` client, which silently participates in tmux's `window-size latest` arbitration. One forgotten background surface degrades every visible view: windows repeatedly snap to the hidden client's grid after connection churn, then expand on input — perceived as "tmux constantly resizing", amplified by latency.
2. **Consequence if unfixed**: The bug class is invisible (it took `list-clients` + tailscale traffic forensics to find the culprit) and self-reinstating (rk's per-stream self-heal re-attaches a detached client within seconds, so even manual `tmux detach-client` cannot clear it). Every multi-window / multi-device user will hit it. Hidden pages also pay for PTY output streaming into an invisible surface.
3. **Why this approach**: Releasing streams on hidden pages fixes the *cause* — with only on-screen pages holding sized clients, `window-size latest` resolves correctly by construction ("the actual user client wins"), phones included. Sizing-policy mitigations (`window-size largest`) were rejected by the user; server-side idle detach can't work (the server cannot know page visibility, and detach self-heals back via the probe re-open).

## What Changes

### 1. Page-visibility stream suspension in the frontend relay layer

When `document.visibilityState` becomes `hidden`, start a grace timer (`HIDDEN_RELEASE_GRACE_MS`, default 60 000 ms — a named constant). If the page is still hidden when it fires, **close every live `/ws/terminals` stream** (the per-stream `close` op; server tears down the attach client and PTY). When the page becomes `visible` again, transparently re-open every suspended stream with its current `opts` (server, windowId, cols, rows).

Implementation seam: `RelayMux` (`app/frontend/src/lib/relay-mux.ts`) is the natural owner — it is the per-tab singleton that already re-issues `open` for every still-live stream in `ws.onopen` after a socket drop. Suspension is the same mechanism pointed at a different trigger: mark streams *suspended* (kept in the mux map with their current `opts`), send `close` ops; on `visible`, re-issue `open` exactly like the reconnect path. Each pane repaints flicker-free via the existing per-stream machinery: `onOpened` re-arms the deferred reset, and the first data frame repaints (see `docs/memory/run-kit/ui/terminal.md` § Terminal Relay (frontend), seams 2/4).

Precedent: this is the IntersectionObserver pane-suspension pattern (seam 3 — board panes close/re-open streams when scrolled off-screen) extended one level up, from element visibility to page visibility. The IntersectionObserver layer is untouched; the page-visibility layer is additive.

Behavior details:

- A quick app-switch (hidden < grace period) does nothing — the timer is cancelled on `visible`.
- With zero live streams the mux already lets the socket stay closed; suspension composes with that (a fully suspended tab may drop to zero streams and close its terminals socket).
- The suspended state must survive a socket drop while hidden: a reconnect during suspension must NOT re-open suspended streams (only the `visible` transition does).
- New streams opened while hidden (unlikely, but e.g. a route change in a background tab) follow the same rule — opened normally, then subject to the same grace timer.

### 2. Keep the state socket alive — terminal streams only

`/ws/state` is deliberately NOT released. Background desktop-shell views must keep reporting waiting-counts for the dock badge (`docs/memory/run-kit/desktop-shell.md` § badge aggregation — background hosts report continuously). Only `/ws/terminals` streams hold tmux attach clients, so only they participate in window sizing; only they are released.

### 3. Spike: verify the visibility signal inside the desktop shell

A detached Electron `WebContentsView` should report `document.visibilityState === "hidden"` to its page (Chromium marks unattached/occluded contents hidden). This must be **verified in the shell** before relying on it:

- If detach/attach already drives `visibilitychange` in the guest page: no shell change at all — the SPA-side listener covers browser tabs, minimized windows, AND detached shell views uniformly.
- If not: add a minimal shell nudge in `app/desktop/src/main.ts` — on view detach/attach, notify the view (e.g. `webContents.setBackgroundThrottling` is NOT the mechanism; use an IPC event the SPA subscribes to via the `runkitShell` bridge, folded into the same suspend/resume entry points).

### 4. Mobile/freeze edge (design note for the plan)

On iOS/Android the browser may freeze a hidden page before the 60s grace timer fires (timers stop on freeze). The plan SHOULD consider listening to `pagehide`/`freeze` as immediate-release triggers (no grace) where available — a frozen page's streams otherwise persist until the socket dies. Not load-bearing for the desktop-shell case (Electron pages keep running), so acceptable as a follow-up hardening item within this change if trivial, or an explicit non-goal if not.

### 5. No backend or protocol change

The existing `open`/`close`/`opened`/`resize` control ops fully express suspend/resume. The server already handles stream close (attach client teardown, review-rule cleanup) and re-open (fresh PTY at the op's cols/rows). Nothing in `app/backend/` changes.

## Affected Memory

- `run-kit/ui/terminal`: (modify) RelayMux stream lifecycle — add the page-visibility suspension layer (grace timer, suspended-stream semantics, interaction with socket-drop re-open and IntersectionObserver suspension)
- `run-kit/desktop-shell`: (modify) only if the spike (§3) requires a shell-side visibility nudge — document the detach/attach → view signal
- `run-kit/tmux-sessions`: (modify) note in the Terminal Relay transport section that hidden pages release their attach clients (the multi-client `window-size latest` interaction)

## Impact

- `app/frontend/src/lib/relay-mux.ts` — suspension state machine + visibility listener + grace timer (primary change)
- `app/frontend/src/lib/relay-mux.test.ts` — suspend/resume unit coverage (close on grace expiry, cancel on quick return, re-open on visible with current opts, no re-open of suspended streams on socket reconnect while hidden)
- `app/frontend/src/components/terminal-client.tsx` — likely no change (deferred reset + `onOpened` already handle re-opens); verify seams
- `app/desktop/src/main.ts` — conditional, per the §3 spike
- e2e: a Playwright spec driving `page.evaluate`-level visibility change (or CDP `Page.setWebLifecycleState`) asserting stream closure after grace and repaint on return, if deterministically testable; otherwise unit-level coverage per the test strategy
- No Go backend changes; no protocol changes

## Open Questions

- None blocking. Grace-period value and the freeze-event hardening are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Release only `/ws/terminals` streams; `/ws/state` stays connected | Discussed and agreed — dock-badge waiting counts ride the state socket; only terminal streams hold sized tmux clients | S:90 R:85 A:95 D:95 |
| 2 | Confident | Implement suspension in `RelayMux` (mark suspended, send `close`; re-issue `open` on `visible`, mirroring the socket-drop re-open path) | The mux already owns re-open-all-live-streams; deferred reset makes resume flicker-free; per-component listeners would duplicate lifecycle | S:80 R:75 A:85 D:80 |
| 3 | Tentative | Grace period 60s via named constant `HIDDEN_RELEASE_GRACE_MS` <!-- assumed: 60s grace — user said "30–60s"; chose the conservative end to avoid churn on quick app-switches over a high-latency link --> | User bounded it 30–60s; exact value is a one-line tunable | S:60 R:95 A:55 D:50 |
| 4 | Confident | Spike the Electron detached-view visibility signal first; add a shell IPC nudge only if `visibilitychange` doesn't fire on detach | Discussed — Chromium generally reports detached contents hidden, but must be verified; fallback path identified | S:75 R:80 A:70 D:75 |
| 5 | Certain | Accepted trade-off: resume wipes local xterm scrollback (deferred reset on re-open) | Discussed and accepted — the grace period keeps it rare; tmux history remains reachable | S:85 R:80 A:90 D:90 |
| 6 | Confident | No backend/protocol change — existing open/close/opened ops suffice | The server already handles stream close/re-open identically for board-pane suspension | S:80 R:85 A:90 D:85 |
| 7 | Confident | IntersectionObserver board-pane suspension untouched; page-visibility layer is additive | Different visibility granularity, same stream verbs; no interaction beyond both using close/open | S:75 R:85 A:85 D:80 |
| 8 | Tentative | `pagehide`/`freeze` immediate-release hardening included only if trivial, else declared a non-goal <!-- assumed: freeze-event hardening is optional scope — mobile freeze defeats the grace timer but the primary target is the desktop shell --> | Mobile freeze semantics vary; desktop-shell case is the driver | S:55 R:80 A:60 D:55 |

8 assumptions (2 certain, 4 confident, 2 tentative, 0 unresolved).
