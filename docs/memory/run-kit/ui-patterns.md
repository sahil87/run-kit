---
description: URL structure, three-way server route guard + create-server/server-gone lifecycle, dashboard/sidebar/boards components, shared PR-status line, chrome, theme system, adaptive terminal write flush + deferred per-connection reset + (server, owning session)-keyed relay connection identity, keyboard shortcuts, component conventions
---
# run-kit UI Patterns

## URL Structure

| Route | View | Component Pattern |
|-------|------|-------------------|
| `/` | Server list | Standalone page (`ServerListPage`) — lists tmux servers with "+" creation button. No sidebar, no SSE. |
| `/$server` | Session dashboard | `AppShell` layout with `Dashboard` content. SSE connected to the specified server. |
| `/$server/$window` | Terminal or Iframe | `AppShell` layout. The second segment is the stable tmux **window ID** (`@N`) — the only window identity. **`$session` was dropped from the route by `260529-jad6-window-api-stability`** (`@N` is server-global, so the session is redundant); the session name shown in chrome is derived from the active window's SSE snapshot, not a URL segment. The router percent-encodes `@` in the path segment (`@2` → `%402`). Rendering branch: `rkType === "iframe"` renders `IframeWindow` (URL bar + iframe), otherwise `TerminalClient` + `BottomBar`. SSE connected. Old 3-segment `/$server/$session/$window` URLs are a hard break (no redirect shim). |
| `/board/$name` | Pane board (cross-server) | `BoardPage` shares the `<Shell>` grid wrapper with AppShell — sidebar / `<TopBar mode="board">` / pane-row content / shared `<BottomBar>`. Retains its own `<CommandPalette>` mount for board-route-only entries. Peer to `/$server`, NOT under it — boards aggregate windows across multiple tmux servers. Invalid `name` (fails `^[A-Za-z0-9_-]{1,32}$`) renders `NotFoundPage`. See § Boards View. |

Two-tier URL model (`/$server/$window`) with server always in path (since `260529-jad6` dropped the `$session` middle segment). URLs are fully shareable — copying a URL and opening it elsewhere on the same host opens the same server and window (the session is re-derived from the snapshot). TanStack Router uses nested routes: `/$server` is a layout route (`serverLayoutRoute`) whose component (`ServerShell`) wraps `SessionProvider` + `AppShell`; the terminal child route is `path: "/$window"` with `parseParams` exposing only `window` (no `session`). Child routes (server index and terminal) are matched by the router but rendered conditionally by `AppShell` based on whether the `window` param exists.

**Window identity is the tmux window ID (`@N`), not the index** (since `260529-chgz-window-id-routing`), and **`@N` is now the *only* identity in the URL** (since `260529-jad6` dropped `$session`). The `$window` route param holds a stable `@N` string; all URL/API/relay/tmux layers address a specific window by this ID, while the window *index* is retained only for positional reorder/move. The owning **session name is derived from the active window's SSE snapshot** (locating `@N` within `sessions[].windows[]`), not read from the URL — `app.tsx` computes `currentSession = sessions.find(s => s.windows.some(w => w.windowId === windowParam))` and `sessionName = currentSession?.name`. Old index-based bookmarked URLs (`/$server/$session/3`) AND old session-bearing URLs (`/$server/$session/@N`) are a **hard break** — they no longer resolve (no redirect shim; constitution §II — ephemeral URLs, no persistent state). See `architecture.md` § API Layer and `tmux-sessions.md` § Window addressing identity for the cross-layer contract.

Server not found: if the `$server` segment doesn't match any known tmux server, a "Server not found" page renders with a link to `/`. A 3-segment URL no longer matches the 2-segment terminal route and falls through to the `NotFoundPage` / server-dashboard fallback.

**Three-way route guard (view / waiting / not-found)** — the `$server` segment is resolved by a pure exported helper `resolveServerView(server, servers, pendingServer, serversLoaded)` in `app.tsx` returning `"view" | "waiting" | "not-found"` (established by `260602-3i5d-fix-create-server-not-found-race`). The branches: (a) `server` IN `servers` → `"view"` (render the server view); (b) NOT in list AND `server === pendingServer` → `"waiting"` (render `ServerWaiting`, a sibling of `ServerNotFound`); (c) NOT in list AND `server !== pendingServer` AND `serversLoaded` → `"not-found"` (render `ServerNotFound` immediately, so a typo'd URL still fails fast); (d) otherwise (e.g. before the first fetch resolves) → `"view"`, falling through to the server view / loading rather than flashing not-found. The guard keys on the explicit `serversLoaded` flag, **NOT** the old `servers.length > 0` proxy — that proxy was the root-cause bug: with pre-existing servers it was already truthy while the list was stale, so the guard fired not-found immediately for a just-created server before the post-create refresh landed. The `pendingServer` waiting state applies only to the one server the user just created. `ServerWaiting` reuses `ServerNotFound`'s centered full-screen idiom (`flex flex-col items-center justify-center h-screen gap-4 bg-bg-primary`) + the shared `LogoSpinner`, showing a brief "Creating server… / Waiting for `<name>`" message.

**Create-server → pending-marker → waiting-then-view lifecycle** (`260602-3i5d`) — `SessionContext` (`app/frontend/src/contexts/session-context.tsx`) carries the transient state for this: `pendingServer: string \| null`, `markServerPending(name)` (an empty-string argument is the clear sentinel → sets `null`), and `serversLoaded: boolean` (set `true` in `fetchServers()`'s `finally`, so it counts as loaded even on an empty list or a caught fetch error — a permanently-false flag would hang the not-found branch forever). All three are threaded through the context type, the live provider value, and the `StandaloneSessionContextProvider` test fallback as safe no-ops/defaults. The create flow (`handleCreateServer` in `app.tsx`): calls `markServerPending(trimmed)` then navigates to `/$server`; the create's `useOptimisticAction` fires `refreshServers()` from its `onAlwaysSettled` hook (unmount-safe — the create dialog unmounts on navigation but `AppShell`, which owns the hook, stays mounted; the refresh touches only root-level `SessionContext`) and clears the pending marker via `onAlwaysRollback` (`markServerPending("")`) so a failed create never strands the UI on the waiting state. `pendingServer` is auto-cleared by an effect **in SessionContext** (not in `app.tsx`) once the refreshed `servers` list contains it — event-driven on the list changing, with **no timer and no polling**. The ~5s bounded-fallback timeout was deliberately OMITTED for v1 (synchronous near-instant backend create makes a timer speculative; a polling loop would violate the no-client-polling anti-pattern) — the waiting state simply persists until the refreshed list contains the server. If ever added it MUST be a single `setTimeout`, never a polling loop.

**Server-list fetch lifecycle**: the server list (`servers`, from `listServers()` → `GET /api/servers`) is a **one-time fetch on `SessionProvider` mount + explicit `refreshServers()`** — it is **NOT** part of the per-server SSE stream (SSE streams per-server *sessions*/order/metrics/board-changed only, never the list of servers). So a newly-created server does not appear until `refreshServers()` is called; the create flow above is what triggers that refresh. The `server-gone` event (below) is the symmetric *removal* trigger — it likewise drives a `refreshServers()` re-query rather than carrying the list inline.

Kill/not-found redirects go to `/$server` (server dashboard), not `/` (server list). The user stays in their server context.

### Server-Gone Reap → not-found flip (`server-gone` SSE event + onerror fallback)

Since `260603-gs2t-reap-dead-tmux-servers-sse`, a per-server stream carries an additive `server-gone` event on `GET /api/sessions/stream?server=<name>` (joining `sessions`, `metrics`, `session-order`, `board-changed`, `: heartbeat`). The backend emits it (payload `data: {}` — the event name is the whole signal; the server is implicit in the per-server stream) right before reaping a server whose tmux socket is gone from the SSE poll set — see `tmux-sessions.md` § SSE Poll-Set Lifecycle. There is **no new HTTP endpoint or component** (Constitution IX) — the event reuses the existing stream and the existing `not-found` route guard.

`SessionProvider` (`app/frontend/src/contexts/session-context.tsx`) registers `es.addEventListener("server-gone", …)` alongside the other named listeners. The handler mirrors the existing pool-diff cleanup: clear the entry's `disconnectTimer`, close the `EventSource` (`entry.es.close()`), delete the pool entry, delete the server's slice from `slicesByServer`, then call `fetchServers()` (the underlying `useCallback` that `refreshServers` aliases). The now-dead server is already absent from `GET /api/servers` (enumeration is socket-file-based and self-healing), so the refreshed list **shrinks**, and if the user is currently viewing that server `resolveServerView(server, servers, pendingServer, serversLoaded)` flips to `"not-found"` (`serversLoaded` is already `true` post-mount), rendering the existing `ServerNotFound` view. This extends the three-way route guard (§ above): the same `not-found` branch that catches a typo'd URL now also catches a reaped server.

**onerror fallback** (belt-and-suspenders): a catastrophic socket death the backend can't signal (no poll tick lands, or the daemon is mid-restart) is covered by `markDisconnected` — the handler armed by `es.onerror`'s 3s timer. Besides setting the slice `isConnected: false`, it **also** calls `fetchServers()`, so the list-shrink → guard-flip path still fires (~3s) even with no `server-gone` event. The two paths are idempotent and **first-to-fire wins**: the `server-gone` event is the fast path (sub-second), the onerror refresh is the guaranteed-eventual path; whichever fires first reaps the entry and the other is a no-op. If the server is in fact still alive, the refreshed list simply still contains it and no flip occurs.

### URL as Resumable Bookmark

**tmux is the sole source of truth for "current window" per server.** The URL is a **resumable bookmark** — consulted on initial mount (and reload), then treated as derived state that follows tmux. Two contracts:

1. **Mount-time alignment (one-shot)**. On the first SSE payload after a route mounts, `app.tsx` compares the URL's `$window` window ID (`windowParam`, a `@N` string) to `currentSession.windows.find(w => w.isActiveWindow)?.windowId`. If they differ, it fires exactly one `selectWindow(server, urlWindowId)` to align tmux to the URL — `selectWindow` takes `(server, windowId)`, no session, since a window ID is a self-contained tmux target (and the backend `/select` handler derives the owning session for group disambiguation; see `architecture.md` § API Layer). Guarded by `hasAlignedToUrlRef: useRef(false)` keyed on the `${server}|${windowParam}` key (since `260529-jad6` the key is window-id-only — `$session` is gone from the URL, so it can no longer be part of the alignment key). Subsequent route changes to the same window never re-fire alignment. This supports reload (URL=active is a no-op) and deep-link (URL≠active aligns tmux, then yanks any other tabs on the same server per multi-client convergence). Since the compared identifier is the stable `@N`, a reorder/kill that shifts indices never spuriously triggers re-alignment.

2. **URL writeback (continuous)**. A separate effect watches the SSE-derived `activeWindow` and calls `navigate({ replace: true, to: "/$server/$window", params: { server, window: activeWindow.windowId } })` whenever `activeWindow.windowId !== windowParam`. Since `260529-jad6` the writeback writes the **window id only** — there is no `session` param to write. No debounce — tmux truth wins always. The effect skips when `dialogOpenRef.current === true` to avoid focus-stealing re-renders mid-dialog (this gates the URL writeback only, not the underlying SSE-derived selection). Comparing `windowId` (not `String(index)`) is the side-effect bug fix from `260529-chgz-window-id-routing`: an index shift from reorder no longer produces a phantom writeback navigation to a different window.

**The 3-second `userNavTimestampRef` debounce is gone.** Pre-change, the URL was the source of truth on every render and a 3000ms `elapsed < 3000` guard tried to protect recent user clicks from being clobbered by SSE-derived URL writebacks. With tmux now authoritative, there is no client-owned window selection state worth protecting; the debounce became dead weight and was deleted entirely.

**Sidebar clicks navigate optimistically AND mutate.** `navigateToWindow(windowId)` in `app.tsx` (app.tsx:479-491) fires an optimistic `navigate({ replace: true, to: "/$server/$window", params: { server, window: windowId } })` at click time *and then* calls `selectWindow(server, windowId)` to bring tmux into agreement. The optimistic navigate is what makes the terminal render immediately (including the first click from the Dashboard and cross-session clicks the SSE writeback alone can't express); `pendingClickRef` suppresses the writeback's bounce-back until the SSE snapshot confirms the switch (typically sub-500ms with the tmuxctl control-mode subscription; see `architecture.md` § tmux Control-Mode Subscription). Server-side overrides during a click (another agent or hook calling `tmux select-window` concurrently) resolve to whichever mutation tmux processed last — there is no client-side timer or debounce that prefers the click's intent over the external event. On mobile, `navigateToWindow` additionally closes the overlay sidebar after a destination tap.

**Keyboard switch path via the command palette.** The window-switch path is also surfaced as `Window: Switch to <session> › <name>` palette entries — the `windowSwitchActions` useMemo in `app.tsx` (renamed from the old `Terminal:`-prefixed `terminalActions` by `260613-o20f-palette-window-switch`), one entry per window across **every** session (built from `flatWindows`, the current server's merged sessions — not cross-server). Each entry reuses `navigateToWindow(fw.window.windowId)`, so it inherits the same `selectWindow` + URL-writeback + mobile-close + `pendingClickRef` suppression as a sidebar click — no separate `selectWindow` plumbing. The URL-active window (`fw.window.windowId === windowParam`) gets a `" (current)"` suffix, mirroring `Server: Switch to <name> (current)`. The `›` separator is U+203A (single right-pointing angle quote) — the chosen precedent for `<session> › <name>` palette labels. The block composes last in `paletteActions` (see § Boards Command Palette).

**Click-intent and URL-match key on `@N` alone** (since `260529-jad6`). `pendingClickRef` holds `{ windowId }` only — the `session` field was dropped. The writeback's `urlMatchesPending` is `pending.windowId === windowParam`, regardless of whether the SSE snapshot reports the window under a session name that string-matches anything. Before the fix it compared `pending.session === sessionName && pending.windowId === windowParam`, so a session rename (or a cross-session move where `@N` survives but the session name changed) flipped the session comparison false and released the pending-click suppression early, **bouncing the selection** — `@N` alone would have matched. With window-id-only matching the selection survives session rename and cross-session move; a normal same-session click is unaffected.

**Sidebar selection follows the URL window ID, falling back to `isActiveWindow`.** `WindowRow.isSelected` derives from `currentSessionName === session.name && (hasUrlWindow ? currentWindowId === win.windowId : (!ghost && win.isActiveWindow))` in `app/frontend/src/components/sidebar/index.tsx`, where `hasUrlWindow = currentWindowId != null` and `currentWindowId` is the URL's `@N` window ID. When the route carries a window ID (the normal terminal-route case), selection is the stable `currentWindowId === win.windowId` comparison. The `isActiveWindow` term (set by the backend `WindowInfo.IsActiveWindow` from tmux's `#{window_active}`) drives selection only when no URL window is present — e.g., the dashboard route, or before the first navigation resolves. Because the URL window ID is now written back from `isActiveWindow` (see contract 2 above), the two stay in lockstep with `tmux select-window` (external switches, `rk riff` window creation) without the index↔ID seam that previously required comparing `String(win.index)`. Ghost windows (mid-creation, before the SSE snapshot includes them) still match only via the `!ghost && win.isActiveWindow` fallback path when no URL window applies.

### Multi-Client Convergence

All clients viewing the same server's window route converge on the same window — the per-server invariant. When the SSE `event: sessions` payload changes which window is `isActiveWindow` for the currently-viewed session, every browser tab on `?server=<same>` and viewing `/$server/$window` navigates to the new window's `windowId` via `navigate({ replace: true })` (the URL writeback effect above).

Clients viewing `/board/$name` SHALL NOT navigate — the board route does not subscribe its URL to `isActiveWindow`. The SSE payload still arrives and `BoardPane` rendering still receives the updated `isActiveWindow` data; the route stays put.

Clients viewing different `?server=` values are independent — each server's SSE stream drives its own clients. Cross-server tabs never yank each other.

**Stale-URL tab yanks other tabs on mount**: when a new tab opens at `/$server/@7` while existing tabs are on `/$server/@2` (tmux active is window `@2`), the new tab's mount-time alignment fires `selectWindow(server, "@7")`. The resulting SSE snapshot then yanks every existing tab on that server to window `@7` via the writeback effect. This is intentional ("yanking is OK" per the change intake) — the new tab represents user intent to view that window, and existing tabs collectively reflect "what tmux is now doing." A URL whose `@N` no longer exists on the server simply fails to resolve a current window (no nearest-index arithmetic) — see § Kill-redirect.

## Dashboard

`app/frontend/src/components/dashboard.tsx` — renders in the terminal area when no `$window` param is present (the `{sessionName && windowParam ? <TerminalClient/> : <Dashboard/>}` branch in `app.tsx`, where `windowParam` is the `@N` window ID and `sessionName` is derived from the active window's SSE snapshot, not a URL segment).

**Layout**: Outer wrapper is `flex-1 flex flex-col` containing two sibling regions: (1) pinned stats line (`shrink-0 px-4 sm:px-6 pt-4 sm:pt-6`) and (2) scrollable card area (`flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6`). The stats line stays fixed at the top of the Dashboard area regardless of scroll position; only the card grid scrolls.

**Stats line**: Top of the Dashboard (pinned) — `"{N} sessions, {M} windows"` (`text-sm text-text-secondary`). Counts derived from the existing `sessions` array.

**Session cards grid**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`. Each card is `bg-bg-card border border-border rounded`.

**Session card header**: Button that toggles inline expansion. Shows session name (`text-text-primary font-medium text-sm`), window count, and activity summary (`{N} active, {M} idle`). Chevron indicator (▶ collapsed, ▼ expanded). Multiple sessions may be expanded simultaneously.

**Window cards** (inside expanded session): Each window card is an outer `<div>` (`rounded border border-border bg-bg-primary hover:border-text-secondary`) wrapping a `<button>` that selects the window (`@N`) on click; the URL follows to `/$server/$window` on the next SSE snapshot. The button (no longer the card root) holds the card body; the `<a>` PR link lives in a sibling `<div>` OUTSIDE the button so no `<a>` nests inside a `<button>` (invalid HTML) — this `<button>`→`<div>`-wrapper refactor is what `260610-596o-pr-status-sidebar` introduced. Shows:
- Window name (primary text) + fab stage badge (`bg-accent/10 text-accent`) when present
- Running process (`paneCommand`), activity dot (green = active, dim = idle) with label + idle duration
- Fab change ID + slug when present
- A `<PrStatusLine win={win} />` (in a `px-2 pb-2 -mt-1` sibling div below the button, non-ghost only) — the shared PR-status line (see § PR Status Line); its own change-bound gate (`fabChange && prNumber`) early-returns null so scratch windows render nothing

**New Window button**: Inside each expanded session card, dashed border button calling `createWindow` API.

**New Session button**: Always-visible dashed border card in the grid. Triggers instant session creation (calls `onCreateSession` → `executeCreateSessionInstant` in `app.tsx`) — no dialog opened. Session name derived from active window's `worktreePath`; no active window → name is `session`, no `cwd` passed.

**Touch targets**: Session card headers and window cards use `coarse:min-h-[44px]`.

## PR Status

Live PR status renders on **two distinct surfaces** (`260610-596o-pr-status-sidebar` introduced it; `260610-obky-pr-status-to-pane-panel` moved the primary surface from the sidebar window rows into the Pane panel):

1. **Pane panel `pr` row** (primary — the per-*selected*-window detail view; see § Pane Panel / `status-panel.tsx`).
2. **Dashboard window cards** — the shared `PrStatusLine` component (the dashboard route has no Pane panel, so the card is its only PR surface).

The sidebar window-tree rows (`WindowRow`) do **NOT** show PR status — `260610-obky` removed `PrStatusLine` from there, because the dense tree is for glancing across windows while the Pane panel is the right home for the selected window's detail.

### Pane panel `pr` row (`status-panel.tsx`)

A copyable metadata row appended after `fab` in `WindowPanel`, following the same `tmx/cwd/git/run/agt/fab` idiom (icon + value, click-to-copy). `getPrLine(win)` returns `null` unless `win.fabChange && win.prNumber` (the change-bound gate — same gate the backend enforces, see `architecture.md` § PR-Status SSE Join); otherwise it composes `#<n> · <state>[ (draft)] · checks <prChecks> · review: <prReview→spaces>` (non-`none` parts only; state is always `open` in practice — the collector queries `states: OPEN`). Clicking the row copies `win.prUrl` (falls back to the line text) via the shared `CopyableRow`; the row's `title` is the PR URL. `prIsFailish` (`prChecks === "fail" || prReview === "changes_requested"`) swaps the value to `text-red-400`. The PR icon uses the Nerd Font git-pull-request glyph, matching the other rows' accent icons.

### Shared `PrStatusLine` (dashboard cards) — `pr-status-line.tsx`

`PrStatusLine({ win })`, the one-line display used by the dashboard window cards.

**Change-bound gate**: returns `null` unless `win.fabChange && win.prNumber` (early return) — a scratch window (a PR number but no bound change, or vice versa) renders nothing. Display-side mirror of the backend attach gate.

**Layout**: `PR #<n> <state-glyph> <state>[ (draft)] · <checks/review summary>`. The state glyph is always the open dot `●` (`stateGlyph` — the collector is OPEN-only, so merged/closed states are unreachable; `260610-596o`'s merged/closed `✓`/`✗` branches were removed in the PR #241 review). The summary (`summaryText`) joins the non-`none` parts with ` · `: `checks <prChecks>` and `review: <prReview with underscores → spaces>`. `prIsDraft` appends ` (draft)`.

**`PR #<n>` link**: when `win.prUrl` is set it is an `<a href={prUrl} target="_blank" rel="noopener noreferrer">` whose `onClick` calls `stopPropagation` so the link opens the PR in a new tab but does NOT select the window. When `prUrl` is absent it degrades to a plain `<span>`. Because the link is an `<a>`, the dashboard card moved it outside the card `<button>` (see § Dashboard window cards) — no `<a>`-in-`<button>`.

**Click-to-refresh**: clicking the line (a plain `onClick` wrapper `div` — NOT a semantic button; the a11y-misleading `role="button" tabIndex={-1}` was removed in the PR #241 review, since the real action is the keyboard-accessible `<a>` link) calls `e.stopPropagation()` then `void refreshPrStatus().catch(() => {})` — a best-effort on-demand `POST /api/pr-status/refresh`. Errors swallowed (`gh` may be absent/unauth); refreshed status arrives via the next SSE `sessions` payload. `title="Refresh PR status"`. `data-testid="pr-status-line"` / `data-testid="pr-status-link"`.

**Color tokens**: the line uses `text-text-secondary` by default and `text-red-400` when `isFailish(win)` (`prChecks === "fail" || prReview === "changes_requested"`). This follows the established convention of using existing color tokens (no new hardcoded hex) — `text-red-400` is the fail-ish accent in the same family as the load-average `text-red-500` and gauge thresholds. The link's hover is `hover:text-text-primary hover:underline`. Touch targets respect the `coarse:` convention (the link carries `coarse:py-1`).

**Placement at the call sites**: sidebar `WindowRow` renders it below the name/`fabStage` row in a `pl-[18px] pr-11` indented sibling div (non-ghost only), so the PR line aligns under the window name and clears the hover-reveal action cluster on the right. Dashboard renders it under the fab-stage badge in a `px-2 pb-2 -mt-1` div (non-ghost only).

## Iframe Window

`app/frontend/src/components/iframe-window.tsx` — renders in the terminal area when the current window has `rkType === "iframe"` and a non-empty `rkUrl`. The rendering branch in `app.tsx` is: `currentWindow?.rkType === "iframe" && currentWindow?.rkUrl ? <IframeWindow> : <TerminalClient>`. Bottom bar is NOT rendered for iframe windows (no terminal to send keys to).

**Layout**: Outer wrapper `flex flex-col flex-1 min-h-0` with two children: URL bar (`shrink-0`) and iframe (`flex-1`).

**URL Bar**: Thin toolbar above the iframe (`border-b border-border bg-bg-primary`). Three elements:
- **Refresh button** (↻ `&#x21bb;`) — forces iframe reload by clearing `src` to `"about:blank"` then re-setting it via `setTimeout(0)`. Styled: `w-7 h-7 rounded hover:bg-bg-card text-text-secondary`
- **URL input field** — shows current `rkUrl`, editable. On Enter, calls `updateWindowUrl(server, windowId, url)` which (since `260529-jad6`) delegates to the unified `setWindowOptions(server, windowId, { "@rk_url": url })` → `POST /api/windows/{windowId}/options` (partial-merge — only `@rk_url` is touched). On API failure, reverts input to the SSE-confirmed `rkUrl`. Styled: `bg-bg-card text-text-primary text-sm px-2 py-1 rounded border border-border`
- **Submit indicator** (⏎ `&#x23ce;`) — decorative visual affordance (`text-text-secondary text-xs`)

**SSE Sync**: A `useEffect` on `rkUrl` syncs both the URL bar text and iframe `src`. Uses a `currentSrcRef` to avoid re-setting iframe `src` when the URL hasn't actually changed (prevents unnecessary reloads on identical SSE ticks). When `rkUrl` changes externally (Claude or another process runs `tmux set-option`), the URL bar updates and iframe navigates automatically.

**Proxy URL conversion**: `toProxySrc(url)` converts localhost URLs to proxy paths: `http://localhost:8080/docs` -> `/proxy/8080/docs`. Non-localhost URLs pass through unchanged. Pattern: `^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$`.

**Iframe attributes**: `sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"`, `title="Proxied content"`, `border-0`.

**Window creation**: "Window: New Iframe Window" command palette action (id `create-iframe-window`) opens a `Dialog` with two inputs: window name (autofocused, Enter focuses URL input) and URL (Enter creates window). Create button disabled until both fields non-empty. Calls `createWindow(server, session, name, undefined, "iframe", url)` — the extended API client function passes `rkType` and `rkUrl` in the POST body. Backend uses `CreateWindowWithOptions` for atomic `\;`-chained tmux command. Only shown when a session is active.

## Boards View

`/board/$name` renders a horizontal pane dashboard for windows pinned to a named board (see `tmux-sessions.md` § Pin Sessions / § `@rk_board` for storage and `architecture.md` § Boards Feature for the route placement rationale). The board view does NOT mount AppShell, but it shares the same root-mounted multi-server `SessionProvider`, the same unified `<Sidebar>`, and as of `260509-17m3-rotated-shell-layout` the same `<Shell>` grid wrapper — the sidebar's per-server session groups stay populated across the route switch because the provider lives at the root.

### SESSIONS-vs-BOARDS exclusivity (a pinned window is physically MOVED)

Since `260602-qn62-move-based-board-pin-sessions`, pinning a window **physically moves** it (`tmux move-window`) out of its home session into its own single-window pin-session (`_rk-pin-<id>`), so a window is in **exactly one** view at a time — SESSIONS (its home session) or BOARDS (a pane on the board), never both. A pinned window therefore **disappears from its home session's window list in the SESSIONS sidebar** until it is unpinned (which moves it back to `@rk_home`, appending at the next index). This is intended and is what lets a board pane attach the relay DIRECTLY to the pin-session (no ephemeral). It is also "already true" for the sidebar with no frontend work: the SSE session snapshot no longer lists the moved window under its home session (pin-sessions are filtered at the `parseSessions` chokepoint), so the sidebar reflects it automatically. The pin-icon filled state and the active-board accent (below) are the only board-aware affordances on a SESSIONS row — and a pinned window's row is simply absent from its home group while pinned.

### BoardPage Layout (`app/frontend/src/components/board/board-page.tsx`)

BoardPage uses the shared `<Shell>` wrapper with `grid-template-areas: "sidebar topbar" / "sidebar content" / "sidebar bottombar"` on desktop (collapses to single-column on `< 640px` with the sidebar overlay). Children are placed into named grid areas:

- **Sidebar** (`gridArea: "sidebar"`) — the unified `<Sidebar currentServer={null}>` (same component as AppShell). No per-server group is marked current on board routes. Per-server session groups + Boards section + ServerPanel + bottom panels render as on AppShell. Mobile (`< 640px`) renders the sidebar as a Shell-level overlay positioned via `gridRow: "2/4"` (below the topbar) — same overlay implementation as AppShell
- **TopBar** (`gridArea: "topbar"`) — `<TopBar mode="board" boardName={name} paneCount={entries.length} serverCount={uniqueServers}>`. Board mode renders `Board ▸ {name} ▾` (the existing `BoardSwitcherDropdown` dropdown listing `← Sessions` + other boards, with `(current)` on the active one — moved into TopBar from BoardPage's pre-rotation inline `<header>`) followed by inline-info `{N} pane[s] · {M} server[s] · ⌘[⌘] cycle` (singular/plural correct, `text-xs text-text-secondary`, `hidden sm:inline`). The right section's chrome (theme toggle, `FixedWidthToggle`, `⌘K`, compose `>_`) is byte-identical to terminal mode; `FixedWidthToggle` is now route-agnostic and renders even though `currentWindow` is null on the board route
- **Content** (`gridArea: "content"`) — the existing `DesktopRow` (desktop) / `MobileCarousel` (mobile) horizontally-scrollable container of pane "cards" sorted by `orderKey`. Each card is a `BoardPane` with a `BoardHeader` (`<window-name> · <server>` + unpin button) and an embedded `TerminalClient` connected via WebSocket to `/relay/{windowId}?server=<entry.server>` (one WS per pane) — **the same `TerminalClient`/relay path as the normal terminal route**. Since `260602-qn62` the `windowId` resolves to the window's `_rk-pin-*` pin-session server-side (the relay attaches directly to it), so `BoardPane`/`board-page.tsx` need NO structural change — the move is transparent to the component (`BoardEntry` shape unchanged). The horizontal-scroll viewport begins at the `content` grid area's left edge — flush with `sidebar.right` (or page.left when `sidebarOpen === false`); no left gutter for board-level chrome
- **BottomBar** (`gridArea: "bottombar"`) — the shared `<BottomBar>` (NEW on this route — board route had no BottomBar pre-rotation). Byte-identical to AppShell's invocation: same three callbacks (`onOpenCompose`, `onFocusTerminal`, `onScrollLockChange`). `onOpenCompose` calls `setComposeOpen(true)` from `FocusedTerminalContext`; `onFocusTerminal` invokes a ref-tracked `focusFocusedPaneRef.current()` that re-focuses the currently-focused board pane via its `paneRefs[focusedIndex].focus()`; `onScrollLockChange` plumbs through `DesktopRow`/`MobileCarousel` → `BoardPane` → `TerminalClient.scrollLocked`. Input target is the focused pane's wsRef (read from `FocusedTerminalContext.focused?.wsRef`)
- **Own `<CommandPalette>` mount** — BoardPage retains its own palette mount because board-route-only entries (Switch / Leave Board View / Cycle Pane Focus →/←) need a registration site, and the AppShell palette doesn't mount on `/board/<name>`. The mount is preserved through the rotation

Empty / non-existent board (`name` exists in URL but `getBoard` returns `[]`): shows "No panes pinned to this board yet. Pin a window from the sidebar." with a back link.

### Pane Cards (Desktop)

- **Default width 480px**, drag-resizable between 280px (min) and viewport-minus-sidebar (max). Resize handle hidden on coarse-pointer devices
- **Persisted per-board** in `localStorage["runkit:board-widths:<name>"]` as `Record<windowId, number>`. `usePaneWidths(boardName)` encapsulates read/write/clamp; missing entries fall back to 480px; malformed JSON is ignored silently. Pane widths are intentionally browser-local view state — they do NOT cross devices (pin state in tmux does)
- **Click-to-focus** transfers focus to the pane's xterm via a `useImperativeHandle`-exposed `focus()` method on `BoardPaneHandle`. **Hover-to-focus is OFF in v1** (no hover handler attached)
- **Visual focus indicator** — focused pane has a distinct border/glow; unfocused panes are de-emphasized
- **Keyboard pane cycling** — `Cmd+]` / `Ctrl+]` next (wraps), `Cmd+[` / `Ctrl+[` previous (wraps). Bound via a `useEffect` keydown listener on the BoardPage component

### Desktop Relay-Connection Suspension

On plaintext origins, `DesktopRow` suspends off-screen panes' relay WebSockets so the live-connection count stays under the browser's HTTP/1.1 ~6-per-origin cap — the desktop analogue of the mobile carousel's `paused={idx !== carouselIndex}` pause. Added by `260531-rus8-bound-desktop-relay-websockets`. The mechanism mirrors the proven mobile pause: a paused pane unmounts its `TerminalClient`, which closes the `/relay/<wid>` WebSocket (the `cancelled` flag blocks the reconnect, so the slot genuinely frees); scroll-back re-mounts and re-opens, replaying terminal content.

- **Plaintext-only gate** — the entire feature is gated on `plaintext = window.location.protocol === "http:"` (`board-page.tsx`). On HTTPS/h2 (production via Tailscale) every desktop pane stays live (`paused={false}`), no `IntersectionObserver` is created, and no cap applies — behavior is byte-identical to before this change. The ~6-connection ceiling is a plaintext HTTP/1.1 artifact (h2 multiplexes; the relay WS limit is ~255), so the fix activates only where the problem exists (E2E/dev `http://localhost:3020`, raw-port `http://...` access)
- **Visibility via `IntersectionObserver`** — on plaintext origins, a single observer rooted on the `rowRef` horizontal-scroll container drives each pane's `paused` prop from viewport intersection. Panes are keyed to indices via a `data-paneIndex` attribute on each pane's root element (forwarded through a `rootRef` callback prop on `BoardPane`, kept distinct from the `paneRefs` imperative `BoardPaneHandle` so neither contract leaks into the other). The observer effect mirrors the existing wheel-handler effect's setup/cleanup discipline (`observer.disconnect()` on unmount) and re-subscribes when the pane count changes
- **Pre-warm margin** — the observer uses `RELAY_PREWARM_ROOT_MARGIN` = `` `0px ${BOARD_PANE_DEFAULT_WIDTH}px` `` (one pane-width of horizontal `rootMargin`, vertical 0) so a pane is kept live slightly before it enters and after it leaves the strict viewport, preventing pause/resume thrash (and the `[reconnecting...]` flicker) on a quick scroll-past. No debounce in v1 — add one only if thrash is observed during Playwright tuning
- **Live-pane cap** — simultaneously-live (unpaused) relay panes are capped at `MAX_LIVE_RELAY_PANES = 4` (named constant, not a magic number), backstopping the observer for the wide-monitor case where more panes fit on-screen than the budget allows (`1 SSE + 4 relay + headroom` stays under 6). When visibility alone would leave more than the cap live, the **least-recently-focused** visible panes are paused first. The selection logic is the pure `selectLivePanes` helper in `app/frontend/src/components/board/select-live-panes.ts` (colocated unit tests), consuming the visible-index set, the focused index, the most-recently-focused order, and the cap; `DesktopRow` passes `paused={!livePanes.has(idx)}` (and short-circuits to `paused={false}` when `livePanes === null`, i.e. on secure origins). The MRU order folds the current `focusedIndex` to the front during render (`useMemo` keyed on `focusedIndex`) so cap eviction never sees a stale focus
- **Focused pane always live** — `selectLivePanes` adds `focusedIndex` unconditionally before filling the remaining slots, so the focused pane is exempt from both visibility-pause and the cap. This preserves `Cmd+]`/`Cmd+[` cycling (cycling to an off-screen paused pane re-selects it → unpauses → re-mounts → imperative `focus()` via `paneRefs`) and BottomBar targeting of the focused terminal
- **Composes with the sibling change** — `260531-m3pl-static-xterm-imports` removes the xterm chunk-fetch pressure from the runtime connection budget while this change bounds the persistent relay streams; together they fit the board route under the 6-connection cap on plaintext origins (the original board-route E2E hang root cause). `MobileCarousel` is untouched — it already suspended correctly

### Mobile Single-Pane Carousel

Below the `min-width: 640px` breakpoint (matching the existing project mobile convention), the BoardPage renders a single-pane swipe carousel:

- One pane fills the viewport width
- Touch swipe left/right cycles in `orderKey` order; threshold 40px on `touchstart` → `touchend` `clientX` delta
- **Off-screen panes pause** by unmounting their `TerminalClient` so the WebSocket closes; on swipe-in, the pane re-mounts and the terminal reattaches
- A pagination dot strip indicates the current pane index (no wrap on edges in v1)

### Sidebar Boards Section (`app/frontend/src/components/sidebar/boards-section.tsx`)

Renders **at the very top of the sidebar** — the section order is **Boards → Servers → Sessions** (`260509-17m3-rotated-shell-layout` reordered this from the previous Servers → Boards → Sessions). Visible on every route that mounts `<Sidebar>` (`/$server/...` and `/board/$name`). The board route reuses the same `BoardsSection` component for board switching; there is no separate BoardPage listing.

- **Always visible**, regardless of `boards.length` or current route
- **Hint mode** — when `boards.length === 0`, the body shows a one-line hint `Pin a window to start a board` (`text-xs text-text-secondary`) verbatim from 4vuv's copy. Applies on every route, not only on `/board/<name>` — placing Boards at the top would cause a layout shift if the section hid/showed dynamically (Servers would jump up, then back down when the first board materializes)
- **First board materializes** — hint replaced by a single board row in place; no other section's vertical position shifts
- **Last board removed** — section reverts to hint mode; no layout shift to ServerPanel or Sessions

Each row: board name (left, truncate with ellipsis), pin count (right, muted), highlighted background when current route matches `/board/<name>`. Clicking the row navigates to `/board/<name>`.

### Sidebar Pin Icon on Window Rows

`window-row.tsx` gains a pin icon button that follows the existing icon-on-hover pattern in the sidebar:

- **Hover-revealed** (always visible on touch devices via `coarse:opacity-100`)
- **Filled** when the window is pinned to ANY board; **outline** when not pinned (computed via `useWindowPins(server, windowId)` which watches every board)
- **Click opens `PinPopover`** (`app/frontend/src/components/sidebar/pin-popover.tsx`) anchored to the icon: list of existing boards (each row pins or unpins on click), plus an inline "Pin to new board…" text input (Enter validates against the board-name regex and creates the board on first pin). Validation errors surface inline. Outside-click + Escape dismiss

### Active-Board Highlight in Sessions Tree

When the current route is `/board/<name>`, `WindowRow` applies an accent left-border to windows pinned to **that specific board only**. Pins to other boards do NOT trigger the highlight. The pin icon's filled state is independent (always reflects "pinned to ANY board"). On non-board routes, no highlight is applied.

### Pin Entry Points

| Entry point | Location | Notes |
|-------------|----------|-------|
| Sidebar pin icon | `WindowRow` (every server's window rows in the unified sidebar — server routes and board routes alike) | Hover-revealed; popover with board picker + inline input |
| Command palette | `boardActions` block in `app.tsx` (AppShell mount) and BoardPage's own mount | See § Boards Command Palette |
| Board pane header | `BoardHeader` (only on `/board/<name>`) | Per-pane unpin button — no confirmation (pin is cheap to restore) |

Right-click context menu was deliberately NOT implemented in v1 — there is no existing context-menu pattern in the sidebar to extend, and the three entry points above cover all flows.

### Boards Command Palette (`Board:` prefix)

`boardActions: PaletteAction[]` is composed in a dedicated `useMemo` block in `app.tsx`, between `windowActions` and `viewActions`:

```ts
const paletteActions = useMemo(
  () => [...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...windowSwitchActions],
  [...]
);
```

| Entry | Visibility | Action |
|-------|------------|--------|
| `Board: Switch to <name>` (one per board, `(current)` on the active one) | Always | Navigate to `/board/<name>` |
| `Board: Pin Current Window` | Only on `/$server/$window` | Dispatches `pin-popover:open` to the matching `WindowRow` |
| `Board: Unpin Current Window` | Only when current window is pinned to ≥1 board | Unpins from all boards the current window is pinned to (single-action — no per-board picker in v1) |
| `Board: Leave Board View` | Only on `/board/<name>` | Navigate to last viewed window route, or `/` if none |
| `Board: Cycle Pane Focus →` | Only on `/board/<name>` and ≥1 pane | Same as `Cmd+]` |
| `Board: Cycle Pane Focus ←` | Only on `/board/<name>` and ≥1 pane | Same as `Cmd+[` |

**v1 limits**: `Board: Reorder Pane` palette action is deferred to v1.1. The right-click context menu pin entry is not implemented (use sidebar pin icon, command palette, or board pane header). Hover-to-focus is disabled in v1.

The AppShell palette mount carries `Switch to <name>` + `Pin Current Window` + `Unpin Current Window`. The BoardPage's own palette mount carries `Switch to <name>` + `Leave Board View` + `Cycle Pane Focus →/←` — board-route-only entries that AppShell's palette can't surface because the board route does not render AppShell.

### Hooks (Frontend)

| Hook | File | Returns |
|------|------|---------|
| `useBoards()` | `hooks/use-boards.ts` | `{ boards, isLoading, error }`. Initial `listBoards()` on mount; subscribes to `board-changed` SSE on every server returned by `listServers()` (boards are server-scoped since `260602-qn62`, but the board LIST is summarized across servers, so it attaches all to catch each one's pin/unpin/reorder events); 50ms debounce coalesces rapid events; preserves last good value on transient error |
| `useBoardEntries(name)` | `hooks/use-boards.ts` | `{ entries, isLoading, error }`. Initial `getBoard(name)`; subscribes on all known servers (the board list spans servers, so a pin/unpin on any server may affect this board); same debounce + error tolerance |
| `usePinActions(board?)` | `hooks/use-pin-actions.ts` | `{ pin, unpin, reorder }` stable callbacks; toast on error; optimistic — SSE re-broadcast reconciles |
| `usePaneWidths(boardName, sidebarWidth)` | `hooks/use-pane-widths.ts` | `{ getWidth, setWidth }`; reads/writes `localStorage["runkit:board-widths:<name>"]`; clamps to `[280, viewport - sidebar]`; default 480px |
| `useIsMobile()` | `hooks/use-is-mobile.ts` | `boolean`; `matchMedia("(max-width: 640px)")` listener |
| `useActiveBoardName()` | `hooks/use-active-board.ts` | active board name from `/board/<name>` route, else `null` |
| `useWindowPins(server, windowId)` | `hooks/use-window-pins.ts` | list of boards the window is pinned to; drives the pin-icon filled state |
| `useNow()` | `hooks/use-now.ts` | current epoch seconds (`Math.floor(Date.now()/1000)`); self-ticks every 1s via `setInterval` (cleared on unmount), re-rendering ONLY the calling leaf. Display-only clock — NOT data polling. Scope to duration leaves so the tick never re-renders ancestors; see § Render Performance (`260613-ect6`) |

## Chrome (Top Bar)

The root layout (`app/frontend/src/app.tsx`) renders `TopBarChrome` which derives its content from the current session:window selection via `ChromeProvider` context. No slot injection — the chrome reads the selection and renders directly. Since `260509-17m3-rotated-shell-layout` `TopBar` accepts a `mode: "terminal" | "board" | "root"` prop (default `"terminal"`) that selects which left/center content to render; right-section chrome is unchanged across modes.

**Line 1** (fixed height, `border-b border-border`): hamburger toggle + mode-specific breadcrumbs/info + branding + controls. Single-line top bar — no Line 2.

**Dashboard route** (`/`, `mode="root"`): Hamburger toggle + "Dashboard" text label (`text-text-primary font-medium`). No session or window breadcrumb segments rendered (no session/window is selected). Connection indicator, FixedWidthToggle, and `⌘K`/`⋯` render as normal.

**Terminal route** (`/$server/$window`, `mode="terminal"`): `☰ session / window` — hamburger icon (three SVG lines, animates to left-pointing chevron `<` via CSS transforms when `sidebarOpen` is true) + session name (dropdown trigger, `max-w-[7ch] truncate`; the session name is snapshot-derived from the active `@N`, not a URL segment, since `260529-jad6`) + `/` plain text separator + window name (dropdown trigger). Syncs with tmux active window via SSE.

**Board route** (`/board/$name`, `mode="board"`): `☰ Board ▸ {name} ▾    {N} pane[s] · {M} server[s] · ⌘[⌘] cycle` — hamburger + breadcrumb (the existing `BoardSwitcherDropdown`, now imported by TopBar in board mode and removed from BoardPage's inline header) + inline-info span (`text-xs text-text-secondary`, hidden on `< 640px` via `hidden sm:inline`). Counts derived from `useBoardEntries(name)`. Singular nouns when `paneCount === 1` / `serverCount === 1`.

- Hamburger icon (`☰`) — sidebar toggle. Animates to back chevron (`<`) when `sidebarOpen` is true. Top and bottom lines rotate ±40deg and shorten to form chevron arms; middle line fades out. Always uses `text-text-primary` color. Driven by `sidebarOpen` alone (the previous `drawerOpen` was removed when `260509-17m3-rotated-shell-layout` collapsed desktop-vs-mobile state into a single boolean)
- `/` — plain text separator between session and window names (replaces `❯` U+276F). Not a click target
- Session name and window name text are the dropdown triggers (tappable to open respective dropdowns). Replaces the `❯` icon-based trigger pattern
- Session name capped at ~7 characters with ellipsis overflow (`max-w-[7ch] truncate`)
- No text prefixes like "session:" or "window:"

**Right section (desktop)**: `{logo} Run Kit  ●  ⇔  ⫼  ⊟  ✕  ◑  ⌘K  >_`
- Logo SVG (`icon.svg`) — decorative (`aria-hidden="true"`), not a button
- "Run Kit" text span (`text-xs text-text-secondary`)
- Green/gray connection dot — no text label ("live"/"disconnected" text removed)
- Split horizontal button (`SplitButton horizontal`) — splits pane left/right. Only rendered when `currentWindow` exists
- Split vertical button (`SplitButton`) — splits pane top/bottom. Only rendered when `currentWindow` exists
- Close pane button (`ClosePaneButton`) — kills the active pane of the current window. Only rendered when `currentWindow` exists
- `FixedWidthToggle`
- `ThemeToggle`
- `⌘K` kbd hint
- Compose button (`>_`) — rightmost item, opens compose buffer. `onOpenCompose` callback passed as prop to `TopBar`

**Right section (mobile < 640px)**: `⋯  >_` — only command palette trigger and compose button visible. Logo, "Run Kit" text, dot, toggle, split buttons, close pane button, ⌘K hidden via `hidden sm:flex` / `hidden sm:inline-flex`

**Split buttons** (`SplitButton` in `top-bar.tsx`): Two inline components calling `splitWindow(server, windowId, horizontal, cwd)` from `api/client.ts`. The active `server` is passed as a prop from `TopBar` (read from `useSessionContext()` at handler scope). Custom SVG icons (square-split pattern). Best-effort error handling — tmux may reject if pane is too small. `POST /api/windows/{windowId}/split` with `{ "horizontal": bool }`.

**Close pane button** (`ClosePaneButton` in `top-bar.tsx`): Inline component calling `closePane(server, windowId)` from `api/client.ts`. X-shaped close icon SVG (`width="14" height="14" viewBox="0 0 24 24"`). Same base styling as `SplitButton` (`min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary`). Hidden on mobile (`hidden sm:flex`). Only rendered when `currentWindow` exists. Best-effort error handling (`.catch(() => {})`), matching split button pattern. Kills the active pane of the current window — no pane ID tracking needed, targets via `POST /api/windows/{windowId}/close-pane`. Also available as "Pane: Close" in the command palette.

**Toolbar button color convention**: All toolbar buttons (top bar and bottom bar) use `text-text-secondary` as their default foreground color. Active toggle states (Ctrl/Alt modifiers when armed, FixedWidthToggle when active) use `text-accent` with accent background. Hover state uses `hover:border-text-secondary` (border highlight). This convention applies to: compose button, theme toggle, fixed-width toggle, split buttons, close pane button, Esc, Tab, Ctrl, Alt, Fn trigger, arrow pad, and ⌘K.

### Theme System

> Full spec: [`docs/specs/themes.md`](../../specs/themes.md) — architecture, ANSI palette structure, tmux colour mapping, import script usage, persistence model.

Palette-based theme model: each theme defines a `ThemePalette` with 22 canonical terminal colors — `foreground`, `background`, `cursorColor`, `cursorText`, `selectionBackground`, `selectionForeground`, plus 16 ANSI colors (indices 0-15) as a fixed-length readonly tuple. The `Theme` type has shape `{ id, name, category, palette }` — no `colors` or `themeColor` properties (both replaced by derivation from palette).

20 built-in themes (14 dark + 6 light) defined in `app/frontend/src/themes.ts` with canonical ANSI palettes sourced from iTerm2-Color-Schemes / official theme repos. Three consumers derive from the same palette:

1. **Web UI CSS** — `deriveUIColors(palette, category)` produces 8 `UIColors` keys (`bgPrimary`, `bgCard`, `bgInset`, `textPrimary`, `textSecondary`, `border`, `accent`, `accentGreen`). Derivation: `bgPrimary` = background, `bgCard` = lighten/darken background, `bgInset` = darken background, `textPrimary` = foreground, `textSecondary` = ansi[8] (bright black), `border` = blend(fg, bg, 0.25), `accent` = ansi[4] (blue), `accentGreen` = ansi[2] (green). Color utility helpers (`hexToRgb`, `rgbToHex`, `lightenHex`, `darkenHex`, `blendHex`) are module-private. CSS custom properties (`--color-bg-primary`, etc.) applied via inline styles on `document.documentElement.style` overriding `globals.css` fallbacks.
2. **xterm.js canvas** — `deriveXtermTheme(palette)` produces an xterm.js `ITheme` with all 22 colors mapped (background, foreground, cursor, cursorAccent, selectionBackground, selectionForeground, and 16 named ANSI colors black through brightWhite). Terminal content (syntax highlighting, colored prompts, git diff output) matches the selected theme.
3. **tmux chrome** — `configs/tmux/default.conf` uses ANSI `colour{N}` indices (colour0-colour15) instead of hardcoded hex. Because tmux renders its chrome as escape sequences that xterm.js interprets, changing the xterm.js ANSI palette automatically themes tmux status bar, pane borders, and pane-border-format. No runtime `tmux set -g` calls needed — the tmux.conf is static.

`data-theme` attribute set to theme's `category` ("dark" or "light") for CSS branching. Theme preferences persisted to both backend API (`GET/PUT /api/settings/theme` writing `~/.rk/settings.yaml`) and localStorage as synchronous cache. Three settings: `theme` (mode: `"system"` or specific ID), `theme_dark` (preferred dark theme, default `"default-dark"`), `theme_light` (preferred light theme, default `"default-light"`). localStorage keys: `runkit-theme`, `runkit-theme-dark`, `runkit-theme-light`. On init, API is canonical source; localStorage is the fast fallback if API fails. Unrecognized `theme` values fall back to `"system"`, while unrecognized `theme_dark`/`theme_light` values fall back to `"default-dark"`/`"default-light"`. PUT accepts partial updates (load-then-merge).

**ThemeToggle** (top bar): Normal click cycles `system → default-light → default-dark`. **Ctrl+Click / Cmd+Click** dispatches `"theme-selector:open"` CustomEvent to open the theme selector.

**Theme Selector** (`app/frontend/src/components/theme-selector.tsx`): Modal overlay matching CommandPalette structure (fixed z-50, backdrop, max-w-lg at 20vh). Search input filters by name (case-insensitive). Themes grouped under "Dark" / "Light" category headers. Arrow key navigation wraps and skips headers. Mouse hover and arrow navigation trigger live preview via `previewTheme()` — CSS custom properties update in real-time. Enter confirms (persists to API + localStorage), Escape/outside-click reverts to original theme via `cancelPreview()`. Opens via `"theme-selector:open"` custom event (same pattern as `"palette:open"`). Theme rows display multi-color palette swatches showing background plus representative ANSI colors (red, green, yellow, blue, magenta, cyan) instead of a single-color swatch.

**Command palette**: "Theme: Select Theme" action dispatches `"theme-selector:open"`. Individual "Theme: System", "Theme: Light", "Theme: Dark" quick-switch actions retained.

**ThemeProvider** (`app/frontend/src/contexts/theme-context.tsx`): `useTheme()` returns `{ preference, resolved, theme, themeDark, themeLight }`. `useThemeActions()` returns `{ setTheme, previewTheme, cancelPreview }`. Preview applies colors to DOM without persistence. Cancel reverts to the last persisted theme. Uses stable `actionsRef` pattern for callback identity. On init: calls `getThemePreference()` from API (returns `{ theme, themeDark, themeLight }`), falls back to localStorage / defaults if API fails. Per-mode theme resolution: in `"system"` mode, resolves to the user's preferred dark or light theme based on OS `prefers-color-scheme`, falling back to `DEFAULT_DARK_THEME` / `DEFAULT_LIGHT_THEME` if the stored ID is invalid. `setTheme` with a specific theme ID saves it to the matching per-mode slot (by `category`), keeps preference as `"system"` (preserving OS auto-toggle), and persists all three values to API and localStorage. `setTheme("system")` resets to system mode without changing per-mode prefs. Backend is canonical source of truth; localStorage is the fast fallback.

### Breadcrumb Dropdowns

Session and window name text are the dropdown triggers. Clicking/tapping the name opens the respective dropdown. No split click-target pattern — the name itself is the trigger. The session name shown in the breadcrumb is the **snapshot-derived** owning session of the active `@N` (since `260529-jad6` dropped `$session` from the URL), not a URL segment.

**Session dropdown**: Lists all tmux sessions. Current session highlighted with `text-accent`. Selecting navigates to the session's first window by its window ID (`/{server}/{windows[0].windowId}` — 2-segment since `260529-jad6`). First item: `+ New Session` action — triggers instant session creation (no dialog).

**Window dropdown**: Lists all windows in the current session. Current window highlighted (`w.windowId === currentWindow.windowId`). Selecting navigates to `/{server}/{windowId}` (2-segment since `260529-jad6`). First item: `+ New Window` action (creates new window in current session).

**Action items in dropdowns**: `BreadcrumbDropdown` accepts an optional `action` prop of type `{ label: string; onAction: () => void }`. When provided, the action item renders before the selection list, separated by a divider (`border-t border-border`). Action items use `text-text-primary` styling (not `text-accent`), close the dropdown on click, and are excluded from ArrowUp/ArrowDown keyboard navigation among selection items.

**Dropdown component** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): Reusable dropdown with outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown keyboard navigation, ARIA `role="menu"`/`role="menuitem"`. Styled with `bg-bg-primary border-border shadow-2xl`, matching bottom-bar Fn key dropdown pattern. Name text serves as the trigger (44px on touch devices via `coarse:min-h-[44px]`). Long names truncated via `max-w-[240px]`.

Connection indicator: green/gray dot only (no text label), driven by `isConnected` from ChromeProvider (set by each page from `useSessions`).

**FixedWidthToggle** (in Line 1 right section): Renders between the connection dot and `⌘K`. Order: `[●] [⇔] [⌘K]`. Self-contained component using `useChrome()`/`useChromeDispatch()`. Route-agnostic — renders unconditionally regardless of `currentWindow`, so the toggle is exposed on the board route too (`260509-17m3-rotated-shell-layout` lifted it out of the `currentWindow &&` block — fixed-width is a viewport preference, not a per-window setting). Touch target: `coarse:min-h-[36px] coarse:min-w-[28px]`. Hidden on mobile (< 640px).

### Sidebar Kill Controls

- **Session row ✕**: Always-visible ✕ button on session rows with red hover. Normal click opens confirmation dialog: "Kill session **{name}** and all {N} windows?" **Ctrl+Click / Cmd+Click** bypasses the confirmation dialog and kills immediately (best-effort `.catch(() => {})`).
- **Window row ✕**: Hover-reveal ✕ button on window rows (always visible on touch devices via `coarse:opacity-100`). Normal click opens confirmation dialog: "Kill window in **{session}**?" **Ctrl+Click / Cmd+Click** bypasses the confirmation dialog and kills immediately (best-effort `.catch(() => {})`).

The Ctrl+Click force-kill pattern matches the established "modifier = power action" convention: ThemeToggle uses Ctrl+Click to open the theme selector instead of cycling. Modifier detection uses `e.ctrlKey || e.metaKey` (Ctrl on Linux/Windows, Cmd on macOS).

## Sidebar

`app/frontend/src/components/sidebar/` — session/window tree navigation. The sidebar is decomposed into an orchestrator and seven sub-components:

- `index.tsx` — `Sidebar` orchestrator; owns all state (`collapsed`, `killTarget`, `editingWindow`, `editingSession`, `dragSource`, `dropTarget`, `sessionDropTarget`) and all `useOptimisticAction` hooks. Accepts `metrics` and `isConnected` props for HostPanel
- `session-row.tsx` — `SessionRow` (exported as `memo(SessionRowInner)`); renders the session header row (chevron, name, + button, ✕ button); handles cross-session drag-over styling; all event handlers passed as props (stable identity-arg `useCallback`s — see § Render Performance)
- `window-row.tsx` — `WindowRow` (exported as `memo(WindowRowInner)`); renders a single window row (activity dot, name, fab stage, duration) plus the absolutely-positioned hover-icon cluster (pin / color swatch / kill); handles drag-and-drop and inline rename display; all event handlers passed as props. **No longer purely presentational**: it embeds a stateful `WindowDuration` leaf (`window-row.tsx:360`) that calls `useNow()` so the per-second clock tick re-renders only that text node, not the row (see § Render Performance). Stage text follows the quiet-row policy — suppressed when `fabDisplayState === "done"` — and the icon cluster is inert at rest (`pointer-events-none` + hover/coarse/focus restore); see § Window rows for both contracts (`260612-epqk-display-state-quiet-rows`). Does NOT render PR status — `260610-obky-pr-status-to-pane-panel` removed the `PrStatusLine` it briefly carried (introduced by `260610-596o`) and relocated PR status to the Pane panel's `pr` row (see § PR Status); the tree row stays compact
- `collapsible-panel.tsx` — `CollapsiblePanel`; reusable collapsible container with header (title + chevron) and localStorage open/closed state persistence via `storageKey` prop. Two modes: (a) legacy `max-height` CSS transition when `resizable` is absent/false (preserves existing Window/Host panel behaviour); (b) resizable mode (opt-in via `resizable` prop) — renders a 6px `ns-resize` drag handle at the bottom, persists user-set height to `localStorage[${storageKey}-height]`, and supports `defaultHeight`/`minHeight`/`maxHeight` props. `maxHeight` accepts a number or a `calc(100vh - Npx)` string form (parsed at drag time using `window.innerHeight`). Mobile breakpoint (`@media (pointer: coarse), (max-width: 639px)`) hides the drag handle and pins the content area to the `mobileHeight` prop (default 56px). All localStorage access wrapped in try/catch. **Header tint**: `tint` prop (`RowTint | null`) paints the header background. By default (legacy mode) the header uses `tint.base` with a `tint.base` ↔ `tint.hover` swap on hover. When `tintOnlyWhenCollapsed` is set, the tint is applied only while the panel is collapsed — and the shade switches to `tint.selected` with the hover swap disabled (stays flat), because in that mode the header is standing in for the selected item inside and a less-saturated hover would read as an inverted effect. `ServerPanel` is the only current consumer of `tintOnlyWhenCollapsed`; the legacy `base`/`hover` behavior is preserved for forward compatibility
- `status-panel.tsx` — `WindowPanel` (exported as both `WindowPanel` and deprecated `StatusPanel`); wraps pane metadata rows (tmx, cwd, git, run, agt, fab, pr) in a `CollapsiblePanel` with copyable row interactions. The `pr` row (added by `260610-obky-pr-status-to-pane-panel`) is the primary live-PR-status surface — copyable (copies the PR URL), gated change-bound, fail-ish → `text-red-400`; see § PR Status
- `host-panel.tsx` — `HostPanel`; 5-line server metrics display (hostname, CPU sparkline, memory gauge, load averages, disk+uptime) inside a `CollapsiblePanel`
- `server-panel.tsx` — `ServerPanel`; swatch-style grid of server tiles (Mock A) inside a `CollapsiblePanel` with `title="Server"`, `storageKey="runkit-panel-server"`, `defaultOpen={false}`, `resizable={true}`, `defaultHeight={140}`, `minHeight={80}`, `mobileHeight={56}`. The active server name is rendered in the panel's `headerRight` slot with `truncate text-text-primary font-mono` (matching the WindowPanel/HostPanel header-right convention); the `LogoSpinner` follows the name when `refreshing` is true. The panel also passes `tint={activeTint}` + `tintOnlyWhenCollapsed` so the collapsed header background matches the selected server's `rowTints.get(activeColor).selected` shade (same body tint used by the active tile inside the panel) — collapsed and expanded readings agree, and the header hover stays flat at the selected shade. Desktop grid: `repeat(auto-fill, minmax(72px, 1fr))`, 6px gap — tiles expand to fill the sidebar width, multi-row, scrolls internally when overflowing the user-set height. Each tile is a focusable `<button role="option">` with a 4px top color stripe (ANSI tint via `rowTints.get(color).base`, neutral `--color-border` for tiles without an assigned color), 11px truncated name, 10px `{N} sess` meta. Active tile: `aria-current="true"` + inset accent ring + `rowTints.get(color).selected` body tint (accent-subtle fallback for untinted active server). Hover-revealed `.actions` cluster (color-picker `■` + kill `✕`) rendered as a sibling to the tile button (not nested — avoids invalid button-in-button) with `group-hover:flex` on the outer wrapper; kill shown only on the active tile; entire cluster hidden on `pointer: coarse`. Mobile layout (`@media (pointer: coarse), (max-width: 639px)`): single-row grid via `grid-auto-flow: column`, `grid-auto-columns: 88px`, `overflow-x: auto; overflow-y: hidden`, `scroll-snap-type: x mandatory` — swipe horizontally, tap to select. Active tile `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on mount when mobile layout active. `ServerInfo` shape (`{name, sessionCount}`) flows through from `/api/servers`
- `server-selector.tsx` — `ServerSelector` (legacy); owns its own dropdown state (`serverDropdownOpen`, `refreshingServers`, `serverDropdownRef`); pinned-bottom server dropdown with outside-click dismiss. Retained for backwards compat — `ServerPanel` is the primary server-switcher in the current UI
- `kill-dialog.tsx` — `KillDialog`; stateless; renders the kill confirmation dialog for sessions and windows using `<Dialog>`

Consumers import `@/components/sidebar` as before — Vite resolves directory imports to `sidebar/index.tsx` automatically.

### Render Performance (memo tree + leaf-scoped `useNow`)

`260613-ect6-sidebar-render-perf` made the sidebar tree stop re-rendering on every SSE session tick. The session SSE stream fires several times/sec; each tick produces a fresh `slicesByServer` Map in `session-context.tsx`, which churns the derived `sessionsByServer`/`sessionOrderByServer`/`isConnectedByServer` Maps (intentional fresh refs, documented in that file) — and before this change there was **no `React.memo` anywhere in the frontend**, so the whole tree (every `ServerGroup`/`SessionRow`/`WindowRow`) re-rendered on each tick. The fix has three coupled parts; **all three are load-bearing — undoing any one silently re-breaks the perf win with no test catching it.**

**1. Row components are `React.memo`'d.** `WindowRow` (`memo(WindowRowInner)`, `window-row.tsx:354`), `SessionRow` (`memo(SessionRowInner)`, `session-row.tsx:200`), and `ServerGroup` (`memo(ServerGroupInner)`, `index.tsx:1280`) are each wrapped in `memo` (bare named import from `react`). **These are the first — and currently only — `React.memo` usages in the frontend.**

**2. The per-second `now` tick lives in a leaf `useNow()` hook (`hooks/use-now.ts`), NOT a threaded prop.** `useNow()` returns `Math.floor(Date.now()/1000)` and self-ticks every 1s. It is consumed by two leaves: a tiny `WindowDuration({ win })` leaf inside `WindowRow` (`window-row.tsx:360` — renders `getWindowDuration(win, now)`, returns nothing for active windows), and `WindowContent` in `status-panel.tsx` (`:171`, feeds `getProcessLine`). The old `const nowSeconds = Math.floor(Date.now()/1000)` computed in the `Sidebar`/`BottomPanels` render bodies and threaded as `nowSeconds` down through `ServerGroup`→`WindowRow`/`WindowPanel` is **gone** — a value that changes every render threaded into a memoized child defeats the memo. **Do NOT reintroduce a `nowSeconds` prop on these components.** The clock tick now re-renders only the handful of duration text nodes (the `WindowDuration` leaf isolates it from `WindowRow`'s body).

**3. Handler/array props are referentially stable, so the memos actually skip.** Per-row/per-group handlers are identity-arg `useCallback`s in `Sidebar` (taking `server`/`session`/`windowId` as arguments, following the existing `toggleSession` pattern — `handleSessionRowKill`/`handleWindowRowKill`/`handleSessionColorChange`/`handleWindowColorChange`/the drag handlers, `index.tsx:723-749` and the rename/drag block above), so a leaf calls a stable callback with its own identity rather than receiving a fresh closure. The Map/array context props (`rowTints`, `ansiPalette`, `allBoards`, `pinnedSet`, `pinnedToBoard`, `isPinnedToActiveBoardFor`) are verified stable across session ticks (sourced from `useMemo`/`useWindowPins`, changing only on theme/board events).

**THE SUBTLE INVARIANT (R6a — most regression-prone):** the three handler props `Sidebar` *receives from its parents* — `onSelectWindow`, `onCreateWindow`, `onCreateSession` — MUST be `useCallback`s **at their source in the parents**, because both parents (`AppShell` in `app.tsx`, `BoardPage` in `board-page.tsx`) consume `useSessionContext()` and therefore re-render on **every** SSE tick. An inline arrow re-added at either parent recreates these references each tick and silently defeats `ServerGroup`'s memo for **every** group (including the currently-viewed one), with **no test catching it** — the initial implementation memoized the rows but missed this caller-side leak, and review caught it as rework. The stable callbacks are `handleSidebarSelectWindow`/`handleSidebarCreateWindow`/`handleSidebarCreateSession` (`app.tsx:1116-1154`) and `handleSelectWindow` (`board-page.tsx:363`). **Root-cause fix:** `handleCreateSessionInstant` (`app.tsx:583`) and board-page's `handleCreateSession` (`board-page.tsx:145`) read churning values (`currentWindow`, `isSessionCreatePending`, `ctx.sessionsByServer`) via **render-time-mutated refs** (`currentWindowRef`/`isSessionCreatePendingRef`/`sessionsByServerRef`, set `ref.current = value` on each render) — the same `dialogOpenRef`/`orderOverrideRef` idiom used elsewhere — so the callbacks stay referentially stable across ticks instead of taking those churning values as `useCallback` deps.

**Why the memo skip is cross-server, not full per-row:** `updateSlice` (`session-context.tsx:216-227`) builds a `new Map(prev)` and replaces only the **changed** server's slice via `next.set(server, ...)`; every other server's slice object — and its `slice.sessions` array ref — carries over unchanged. So a tick on server B leaves server A's `sessions` prop referentially identical, and `ServerGroup`'s memo skips A's whole subtree. The currently-ticking server's own rows DO still re-render on its own data tick (correct — its `sessions` ref changed); the `useNow` leaf is what additionally isolates the pure clock tick from even that server's row bodies.

**Invariants this change preserved (cross-linked, not re-described here):** the derive-over-store session-order pattern (`orderOverrideRef ?? sseOrder` + render-time `arraysEqual` reconcile, `260609-ebks` — see § Session drag-and-drop reorder; memoization did NOT reintroduce a whole-Map watcher effect); #259's triage signals (`fabDisplayState === "failed"` red text/dot + `isFailish` PR-fail glyph — see § Window rows); and single-source `isSelected` selection (URL window-id first, `isActiveWindow` fallback — see § URL as Resumable Bookmark). The intra-`WindowRow` `useMemo`s (`tint`/`uncoloredSelectedTint`/`borderColor`/`buttonStyle`/`buttonClass`) are unchanged.

**Desktop** (`>= 640px`): Sidebar occupies the `<Shell>` `sidebar` grid area (full-height, spanning topbar/content/bottombar rows). Drag-resizable panel, default 220px width. Width persisted to `localStorage` key `runkit-sidebar-width` via `persistSidebarWidth(width)` (called once at drag-end; `setSidebarWidth` updates in-memory state per-pointermove). Constraints: min 160px, max 400px. Drag handle (4-6px) on right edge with `col-resize` cursor, driven by pointer events (unified mouse/touch/pen). The drag handle is hidden when `sidebarOpen === false` — the only re-open affordance is the hamburger at TopBar.left. Collapse animation: `grid-template-columns 150ms ease-out` (zero-width column when closed; no 48px rail). Drag-handle wiring is AppShell-only — BoardPage doesn't render a drag handle (the dimension lives in `ChromeContext` and is shared across routes).

**Mobile** (`< 640px`, breakpoint changed from 768px in `260509-17m3-rotated-shell-layout` to match the existing project `sm:` Tailwind breakpoint and `useIsMobile()` hook): Sidebar renders as an overlay positioned via `gridRow: "2/4"` inside the `<Shell>` (NOT `fixed inset-0`) — backdrop and `<aside>` use `position: absolute` so the topbar stays visible during overlay open (matches the existing project convention recorded in `fab/project/context.md`). Backdrop classes include `absolute z-40 bg-black/50`; aside classes include `absolute left-0 z-50 w-[88%] max-w-[320px] bg-bg-primary shadow-2xl` plus `role="dialog" aria-modal="true"`. Open/close is driven by `sidebarOpen` (the previous separate `drawerOpen` was removed when the rotation collapsed mobile-vs-desktop into one boolean). Dismissal: tapping the backdrop, tapping a destination row (auto-closes after navigation), the explicit close affordance at TopBar.left (the hamburger), or **Escape** (added by `260613-o20f-sidebar-drawer-a11y`).

**Mobile drawer focus trap** (`260613-o20f-sidebar-drawer-a11y`): the overlay's `role="dialog" aria-modal="true"` contract is now honored. `Shell` attaches a `drawerRef` to the `<aside>` and drives the shared `useFocusTrap(containerRef, active, onEscape)` hook (`app/frontend/src/hooks/use-focus-trap.ts` — extracted from the focus-cycle logic in `dialog.tsx`/`command-palette.tsx`, adopted by the drawer only; refactoring those two modals to consume it is a documented follow-up Non-Goal). Active **only** when `isMobile && sidebarOpen && !!sidebarChildren` — the mobile overlay; the desktop sidebar is a grid region and is NEVER trapped. On activation the hook focuses the first focusable element inside the `<aside>`; Tab/Shift+Tab cycle within it (wrap at the boundaries, `preventDefault` only there); Escape closes the drawer via `setSidebarOpen(false)` (additive to the dismissals above). The `document` `keydown` listener attaches only while active and is removed on deactivate/unmount; `onEscape` is read through a stable `onEscapeRef` so a fresh closure each render still fires the latest. **No focus-return on close** (matches `Dialog`/`CommandPalette`).

**Nested-modal deference** (R10): while a nested **modal** dialog — a `[role="dialog"][aria-modal="true"]` **descendant** of the `<aside>` (e.g. `KillDialog`→non-portaled `Dialog`, which renders inside the Sidebar tree, hence inside the drawer) — is open, `hasNestedDialog(container)` detects it and the trap stands down entirely: its `handleKeyDown` early-returns before both Escape and Tab. So a single Escape dismisses only the topmost modal (not the whole drawer), and the drawer-wide Tab wrap can't pull focus out of the nested dialog into the rows behind it. The `<aside>` itself carries `role="dialog"` but is correctly excluded: `querySelector` returns descendants only, backed by an explicit `!== container` guard. **The `aria-modal="true"` part of the selector is load-bearing** (`260613-o20f-sidebar-drawer-a11y` PR review): `PinPopover` carries `role="dialog"` but is NON-modal (no `aria-modal`, no internal Tab-trap) — matching it would have made the drawer trap stand down for a layer that doesn't contain focus itself, letting Tab escape the drawer and regressing the `aria-modal` contract; restricting to modal dialogs keeps the trap live for `PinPopover`/`SwatchPopover`. (Those two popovers attach capture-phase `document` keydown listeners with `stopPropagation`, which independently suppress the trap's bubble-phase Escape listener — so there's no Escape collision with them even though they are not caught by `hasNestedDialog`.)

**Resize separator cursor convention**: Horizontal separator (server↔session panel divider, inside `CollapsiblePanel`) uses `cursor-row-resize`; vertical separator (sidebar↔terminal, in `app.tsx`) uses `cursor-col-resize`. Both are the double-arrow-with-middle-bar vocabulary (not `ns-resize`/`ew-resize`). Hover highlight on both uses full-opacity `hover:bg-text-secondary`.

**Document-body cursor override during drag**: Thin drag handles lose their `:hover` cursor once a drag starts because the pointer moves off the narrow strip. Both handlers work around this by writing `document.body.style.cursor = "<axis>-resize"` on drag start and `""` on drag end — so the cursor persists at document level across the whole gesture, regardless of where the pointer lands. Both handlers (horizontal `CollapsiblePanel` and vertical sidebar-width) drive this from pointer-event handlers; the vertical handler migrated to pointer events so the corner affordance's `preventDefault()` on pointerdown wouldn't suppress the mouse compatibility events the vertical drag would otherwise rely on. `CollapsiblePanel`'s unmount cleanup also clears the body cursor to prevent a leaked cursor if the component unmounts mid-drag (navigation, hot-reload). Future thin-handle drag affordances should follow this pattern rather than relying on element-level `:hover`.

**Multi-axis corner affordance**: Both sidebar drag handlers use independent document-level listeners (horizontal tracks `clientY` only, vertical tracks `clientX` only) with independent state refs, so they coexist without coordination. The corner element at the separator intersection exploits this: its pointerdown invokes the horizontal handler, then the vertical handler, then writes `document.body.style.cursor = "nwse-resize"` last so the diagonal cursor wins over the axis-specific writes. Corner visibility is coupled to the horizontal handle's `showDragHandle` (`resizable && isOpen && !isMobile`) — same guard, no separate source of truth. Wired via optional props: `app.tsx` → `Sidebar` (`onSidebarResizeStart`) → `ServerPanel` (`onSidebarResizeStart`) → `CollapsiblePanel` (`onCornerPointerDown`). All optional at every level so other `CollapsiblePanel` consumers (WindowPanel, HostPanel, mobile drawer) render the default single-handle path unchanged.

**Padding**: `px-3 sm:px-6` (matches top bar and bottom bar chrome padding).

**Sessions header**: The Sessions panel in `sidebar/index.tsx` is a plain always-open `<div>` (intentionally not a `CollapsiblePanel` — the session tree is a core always-visible nav surface). Its header row uses `text-text-secondary` as the baseline text color, with the "Sessions" label in `font-medium`. When `currentSession` is non-null, its name is rendered to the right of the label in `truncate text-text-primary font-mono` — exactly mirroring the ServerPanel `headerRight` pattern (`server-panel.tsx:81-86`). No background tint on this header — per-server tints live on the `ServerGroup` headers below.

**Per-server `ServerGroup`s**: Below the Sessions header, the sidebar renders one `ServerGroup` per server in `servers` (the list returned by `/api/servers`). Each group is a `CollapsiblePanel`-style collapsible whose header carries the server name and the `+` new-session affordance (creates against that section's server, regardless of `currentServer`); the body contains that server's session tree, fed by `sessionsByServer.get(server)` and ordered by `sessionOrderByServer.get(server)`. Per-server slice isolation is the rule — drag-and-drop, rename, kill, ghost reconciliation, and optimistic-action keys all carry the server they originated on so cross-server overlays do not leak.

**Default collapse + persistence**: By default the `currentServer` group is open and all other groups are collapsed. User toggles persist per-server in `localStorage["runkit-panel-sessions-{server}"]`. On board routes (`currentServer === null`) no group is the implicit default — collapse follows persisted state, falling back to all-collapsed. The legacy single-server `runkit-panel-sessions` key is migrated best-effort into the current server's namespaced key on first read when `currentServer` is non-null; if the user first lands on a board route, the migration is skipped (acceptable per the spec's "best-effort, no error if missing" rule). Expanding a non-current server's group also calls `attachServer(name)` on the provider so its slice starts populating from SSE. **`toggleServerSection`'s `setServerSectionsOpen` updater MUST be pure** — it MUST NOT `localStorage.setItem` or call `attachServer` inside the updater body. Under React 19 StrictMode (active via `main.tsx`, dev + e2e) updaters are double-invoked, so a `localStorage` write inside the updater is observed by the second pass (`readServerOpen` re-reads it), inverting the computed `next` and turning a single Expand click into a net no-op (the group never opens). Instead, snapshot `current = readServerOpen(server)` once, compute `next = !current`, run the persist + lazy `attachServer` side-effects ONCE outside the updater, then commit a pure functional update that derives `next` from `prev` (falling back to the pre-write `current` snapshot for an untouched group, never a fresh `readServerOpen`) for batch-safety. Established by `260602-mss7-fix-sidebar-group-expand`.

**Server Pane ↔ Sessions Pane scope coupling**: The Sessions Pane's per-server `ServerGroup` list is gated by the Server Pane's open state, so the sidebar exposes exactly one "see all servers" surface and one "switch servers" surface at any moment. Two cases: when the Server Pane is collapsed (the `defaultOpen={false}` first-run state), the Sessions Pane iterates the full `servers` array — the pre-coupling baseline behaviour. When the Server Pane is open AND `currentServer !== null`, the Sessions Pane renders exactly one `ServerGroup` (the entry whose `name === currentServer`) and omits all other groups from the rendered tree (not hidden via CSS — absent from the DOM). When the Server Pane is open AND `currentServer === null` (e.g., route `/` before resolution, or the previously-current server was killed), no `ServerGroup` is rendered and an empty-state hint takes its place: `Select a server above to see its sessions.`, styled with `text-text-secondary text-xs py-4 text-center` (matching the existing "No sessions" empty-state convention). The transition between the all-servers tree and the current-server-only tree snaps in the next React commit — no fade/slide/height/opacity animation is added at the group-list level; only the existing per-group `CollapsiblePanel` body transitions remain. Other servers' persisted collapse states (`runkit-panel-sessions-{server}`) sit dormant while filtered out — never cleared or overwritten by the coupling logic — and each group re-renders with its persisted value when the Server Pane closes. The current server's group is force-opened while filtered: `Sidebar` passes `isOpen={true}` to the rendered `ServerGroup` regardless of `localStorage["runkit-panel-sessions-{currentServer}"]`, so the filtered view always shows content rather than a degenerate collapsed header. This override is render-time only — the persisted key is not written by the force-open path, and chevron clicks still flow through `toggleServerSection(currentServer)` so the persisted state advances; the persisted value takes visible effect once the Server Pane closes. The source-of-truth read path is the `runkit-panel-server` localStorage key (the same key `ServerPanel`'s `CollapsiblePanel` writes via its `storageKey` prop) — no new state is introduced. Both `Sidebar` and `CollapsiblePanel` read this key through the shared `useLocalStorageBoolean` hook (`app/frontend/src/hooks/use-local-storage-boolean.ts`), which provides same-tab reactivity via an in-module pub/sub keyed on the storage key (a localStorage write alone does not trigger a React render, and the native `storage` event fires only across tabs); cross-tab parity is a free byproduct of the hook also subscribing to `storage`. `CollapsiblePanel`'s external API surface is unchanged — the hook is an internal refactor of its previous `readPersistedState` + manual `setItem` pattern, so `WindowPanel`, `HostPanel`, `ServerPanel`, and other consumers keep their existing prop sets.

**Current-server visual marker**: The `currentServer`'s group header carries the same selected-tile shade convention used by `ServerPanel` — `rowTints.get(serverColors.get(currentServer)).selected` when the server has a color assigned, with a neutral `UNCOLORED_SELECTED` fallback otherwise. No marker is drawn when `currentServer === null` (board routes / index). The marker tracks `currentServer` reactively, so server-route switches re-paint the marker without remounting the group.

**Cross-server window navigation**: Clicking a session name or window row in a non-current server's group navigates to that server's route (`/$server/$window`) via `navigate({ to: "/$server/$window", params: { server: thatServer, window } })`. The provider picks up the new `currentServer` via `useMatches()` on the next route match — no explicit `setCurrentServer` call. The previously-current server's group remains rendered (per default-collapse rules); its EventSource and slice persist so re-visiting is instant.

**Cross-server drag-and-drop is rejected**: Dragging a window from one server's group and dropping it on another server's session/group fires a toast `"Moving windows across tmux servers isn't supported yet"` and skips any move API call. tmux's `move-window` does not span servers, so cross-server move is a separate problem. Within-server drag-and-drop (window reorder within a session, cross-session window move within the same server, session reorder within the same server) is preserved verbatim.

**Session rows**: Chevron toggle (left, expands/collapses window list), session name (selects the session's first window via `onSelectWindow(server, session, windows[0].windowId)` → `selectWindow(server, windowId)`), + new window button (right), ✕ kill button (right, always visible). Click session name fires the select mutation for the first window's `@N`; the URL follows on the next SSE snapshot to `/$server/<windowId>` (2-segment since `260529-jad6`); click chevron toggles expand/collapse. The session-level `+` button triggers instant session creation against the parent group's server (calls `onCreateSession` → `executeCreateSessionInstant`), not a dialog. The window-level `+` button triggers instant window creation (existing `executeCreateWindow` behavior, passes `activeWin?.worktreePath` as CWD).

**Window rows**: Single line with activity dot + window name (left), right-side cluster (fab stage, duration). All rows have `border-l-2` (transparent when not selected to prevent layout shift). Currently selected window highlighted with `bg-accent/10` + `border-accent` + `font-medium` + `rounded-r`. Selection compares the URL window ID against `win.windowId` (falling back to `isActiveWindow` when no URL window) — clicking a row fires `selectWindow(server, win.windowId)` (a pure tmux mutation; window ID is a self-contained tmux target, so no session arg); the selection state and URL update follow on the next SSE snapshot. See § URL as Resumable Bookmark for the full sidebar-click contract.

**Current-row focus on mobile drawer open** (`260613-o20f-sidebar-drawer-a11y`): `Sidebar` attaches `navRef` to its `<nav aria-label="Sessions">` and runs a `useEffect` (reading `useIsMobile()` + chrome `sidebarOpen`) that, when the drawer is visible on mobile, queries `[data-window-id] [aria-current="page"]` then `scrollIntoView({ block: "nearest" })` + `focus()`es that row — landing the keyboard user on their current context. Deferred via `requestAnimationFrame` so it supersedes the focus trap's first-focus (which is committed in `Shell`'s effect). The selector is scoped to WINDOW rows: the active `BoardsSection` row also carries `aria-current="page"` but has no `[data-window-id]` ancestor, so it is excluded — board routes (no selected window) no-op and the trap's first-focusable focus stands. Mirrors the `server-panel.tsx:77-82` mount-scroll pattern.

1. **Activity dot (shape-based)** — filled circle (`currentColor` background) = active, hollow ring (`1.5px solid currentColor` border, transparent background) = idle; border and fill both draw via `currentColor`, so the color token flows through both without touching the inline `style`. Dot color is decoupled from row tint color: `text-text-secondary` by default, switching to `text-red-400` when `fabDisplayState === "failed"` (`260613-o20f-sidebar-triage-signal`) — a failed change reads as red even on quiet/short rows where the stage text is absent. The shape (filled/hollow) is driven by `win.activity` and is unchanged by the failed token. Pure CSS, no animation.

2. **Fab stage text** (right cluster, `text-xs`): renders `win.fabStage` only when `win.fabDisplayState !== "done"` — the quiet parked-row policy (`260612-epqk-display-state-quiet-rows`). The gate is unchanged; only the color token is conditional: `text-red-400` when `fabDisplayState === "failed"`, else `text-text-secondary` (`260613-o20f-sidebar-triage-signal`) — before this, every non-`done` state (including `failed`) shared the secondary token, so a failed change looked identical to a healthy in-progress one. `fabDisplayState` carries fab pane map's `display_state` (`active`/`ready`/`done`/`failed`/`pending`/`skipped`; absent when fab reports `null` or omits the field — fab < 2.1.7). A `done` window is a finished change parked until archived (fab's `DisplayStage` falls back to the last done stage, so it would otherwise show `review-pr` forever); suppressing the stale stage frees the row's name budget and the duration stands alone. An empty right cluster (duration also absent) is the quiet row working as intended — no placeholder. Compatibility fallthrough: any other value, unknown future values, or an absent field (older fab binaries) keep the secondary token exactly as before.

3. **PR-fail triage glyph** (right cluster, rendered *before* the stage text and duration so the needs-attention signals group at the same edge): a small red `●` (U+25CF, `text-xs text-red-400`) shown when `win.fabChange && win.prNumber && isFailish(win)` — i.e. `prChecks === "fail" || prReview === "changes_requested"` (`260613-o20f-sidebar-triage-signal`). `isFailish` is the same predicate `PrStatusLine` uses; it was promoted from module-private to `export` in `pr-status-line.tsx` so the row and the Pane panel share a single source of truth for the fail definition. The `fabChange && prNumber` gate mirrors `PrStatusLine`'s own `if (!win.fabChange || !win.prNumber) return null` gate so a non-change-bound window never shows a stray glyph. A bare glyph needs an accessible name, hence `aria-label="PR needs attention"` + `title="PR checks failing or changes requested"`. **This is a single-glyph triage signal, NOT the full PR line**: `260610-obky-pr-status-to-pane-panel` deliberately removed `PrStatusLine` from the row to keep the tree compact (PR status lives in the Pane panel's `pr` row, see § PR Status). The glyph respects that "stays compact" boundary while restoring a minimal at-a-glance needs-attention signal — one bullet, not the `PR #<n> <glyph> <state> · <summary>` line.

4. **Duration display** (right-aligned, `text-xs text-text-secondary`, after the stage text when shown — standing alone on quiet rows): For fab windows with `agentState === "idle"`, shows `agentIdleDuration` (e.g., `2m`). For non-fab or unknown-state idle windows, computes elapsed time from `activityTimestamp` on the frontend. Omitted for active windows. Computed via `getWindowDuration()` from `lib/format.ts`.

5. **Hover-icon cluster** (pin / color swatch / kill) — absolutely-positioned container (`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10`) rendered as a sibling of the row button (avoids nested interactive elements); the row button reserves `pr-[68px]` when the pin is wired (`pr-11` otherwise) so labels don't run under the icons. **Inert at rest** (`260612-epqk-display-state-quiet-rows`): the container carries `pointer-events-none` plus `group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto`, so on fine pointers a stray click near the row's right edge falls through to the row-select button instead of hitting an invisible kill/pin/swatch target (deliberate icon clicks are unaffected — any mouse interaction hovers the row first, restoring interactivity). Each hover-revealed `opacity-0` button (pin's not-pinned branch, color swatch, kill) carries `focus-visible:opacity-100` so keyboard focus never sits on an invisible control — the reveal is per-button because a container-level `opacity-100` cannot reveal children carrying their own `opacity-0` (element opacity is independent/multiplicative); the container-level `has-[:focus-visible]:pointer-events-auto` restores interactivity while a child is focused. First codebase use of the Tailwind v4 `has-[]` variant. No geometry change: the `pr-[68px]` reservation, `coarse:opacity-100` always-visible icons on touch, and the pin's permanent visibility when pinned-to-any are untouched. (The former info `ⓘ` button + popover and the pane-CWD hover tooltip are gone — window metadata lives in the Pane panel's rows instead, `status-panel.tsx`; see design.md decision #27.)

**Empty state**: When no sessions exist (`sessions.length === 0`), the sidebar displays "No sessions" text with a centered `+ New Session` button. The button triggers instant session creation (same as the sidebar `+` button and breadcrumb dropdown `+ New Session` action). With no active window, `cwd` is omitted and the name falls back to `session`.

**Inline rename** (double-click — windows and sessions): Both window names and session names in the sidebar support double-click inline rename. The pattern is identical for both:

- Double-clicking a name `<span>` replaces it with a text `<input>` pre-filled with the current name, auto-focused with all text selected.
- Enter or blur commits the rename if the trimmed value is non-empty and differs from the original name. Empty or unchanged input dismisses the editor without an API call.
- Escape cancels editing. A `cancelledRef` / `sessionCancelledRef` prevents blur from committing after an Escape (or cross-cancel).
- Single-click behavior is preserved (navigate to window / navigate to session's first window) — only `onDoubleClick` triggers editing.

**Window rename**: calls `renameWindow(server, windowId, newName)` via `useOptimisticAction` (`server` captured at handler time from `useSessionContext()`; window ID is a self-contained tmux target, so no session arg). The UI updates immediately via `windowStore.renameWindow(session, windowId, newName)`; on API failure it rolls back via `windowStore.clearRename(session, windowId)` and shows a toast error. SSE still reconciles the canonical updated name once the server event arrives.

**Session rename**: calls `renameSession(server, oldName, newName)` via `useOptimisticAction`. The UI updates immediately via `markRenamed("session", server, oldName, newName)`; on API failure it rolls back via `unmarkRenamed(server, oldName)` (`lastRenameSessionRef` snapshots `{ server, name }` together for cross-server-safe rollback). Toast error on failure. The dialog-based session rename in `app.tsx` remains unchanged — inline editing is an additional path.

**Cross-cancellation**: Only one inline edit (window or session) may be active at a time. Starting any new inline edit cancels the currently active one without committing it. `handleStartEditing` (window edit) sets `sessionCancelledRef.current = true` and clears `editingSession` before activating the window input; `handleStartSessionEditing` sets `cancelledRef.current = true` and clears `editingWindow` before activating the session input. This ensures blur on the cancelled input is a no-op.

**Window drag-and-drop reorder**: Window items in the sidebar are `draggable={true}` (ghost windows excluded). Uses native HTML5 drag-and-drop — no external library (constitution IV). Drag state managed via `dragSource` and `dropTarget` state in `Sidebar`. On `dragStart`, sets `dataTransfer` with JSON `{ session, index, windowId, name }` and `effectAllowed: "move"`. The `windowId` and `name` fields were added for cross-session optimistic operations; within-session drops use only `session` and `index`. Within-session drops: drop indicator is a 2px accent-colored top border (`borderTop: 2px solid var(--color-accent)`) on the hovered window item when source and target differ. On `drop`, uses `useOptimisticAction` to immediately swap window indices in the Zustand store via `swapWindowOrder(session, srcIndex, dstIndex)`, then fires `moveWindow(server, srcWindowId, dstIndex)` API call in the background (server captured at drop-handler time; the move targets the source by its stable `windowId` and the destination by position). The optimistic action's arg tuple is `(server, session, srcWindowId, srcIndex, dstIndex)` — `session`/`srcIndex` retained for the store-side swap/rollback, while the API call uses only `srcWindowId` + `dstIndex`. `onSelectWindow` is called immediately (not deferred to API success). On API failure, `onAlwaysRollback` reverses the swap via `swapWindowOrder(session, dstIndex, srcIndex)` and shows a toast error. SSE reconciliation naturally clears the optimistic state when `setWindowsForSession` replaces all entries with server-confirmed data. Same-position drops are no-ops (source === target check). All drag visual state (drop indicators) cleared on `dragEnd` and `drop` — handles both successful drops and cancelled drags (Escape, drag outside sidebar).

**Cross-session drag-and-drop**: Dropping a window onto a different session's header moves it to that session. `handleDragOver` accepts drag events on session headers when the dragged window is from a different session. Visual feedback: the session header shows an accent border (`border-accent`) when a valid cross-session drop is hovering. The drag data payload includes `{ session, index, windowId, name }` — `windowId` and `name` were added for optimistic store operations (within-session drop ignores the extra fields). On drop, `handleSessionDrop` calls `executeMoveToSession` (a `useOptimisticAction` instance) with all six arguments `(server, srcSession, srcIndex, windowId, windowName, dstSession)`. The optimistic lifecycle:

- **`onOptimistic`**: calls `killWindow(srcSession, windowId)` to hide the window from the source session, `addGhostWindow(dstSession, windowName)` to show it in the target (using the source window's display name, not a placeholder), and navigates to `/$server` immediately. The `optimisticId` is stored in a ref for rollback.
- **`action`**: calls `moveWindowToSession(server, srcSession, srcIndex, dstSession)` — the API client function with `server` as the first positional argument.
- **`onAlwaysRollback`** (API failure): calls `restoreWindow(srcSession, windowId)` to un-hide in source + `removeGhost(optimisticId)` to remove from target. Toast: "Failed to move window to session".
- **`onAlwaysSettled`** (success): clears the ref. SSE reconciliation handles final state — `setWindowsForSession` removes the entry from the source (not in incoming list), adds it to the target (new incoming entry), and reconciles the ghost (new `windowId` not in ghost's `snapshotWindowIds`).

Same-session header drops are ignored (not a valid cross-session target). Within-session window-to-window drag-and-drop is unchanged. The sidebar handles the move internally — no `onMoveWindowToSession` prop or `handleMoveWindowToSession` callback in `app.tsx` (the sidebar imports `moveWindowToSession` directly from `@/api/client`, matching the pattern of other sidebar API calls).

**Session drag-and-drop reorder**: Session header rows are themselves draggable (the row root, not the chevron / name button) — except optimistic ghost sessions, which set `draggable={false}` because they have no canonical name to persist yet. The reorder feature shares the SAME `<SessionRow>` `onDragOver` handler used by cross-session window drops; the two are disambiguated by `dataTransfer.types`: window drags use the default JSON payload, session reorder drags use a custom MIME `application/x-session-reorder` (so a window-drag never accidentally triggers a session reorder, and vice versa). Native HTML5 drag-and-drop, no external library (Constitution IV).

The persisted order lives server-side in tmux user-option `@rk_session_order` (see `tmux-sessions.md` § "Server-Scoped User Options"), broadcast to all connected clients via SSE event `session-order`. Frontend pipeline:

- **Source of truth**: `SessionContext.sessionOrder: string[]` populated from the SSE `session-order` event handler in `session-context.tsx` (`es.addEventListener("session-order", ...)`). The handler ignores events whose `server` field doesn't match the current `server` prop — defense-in-depth alongside the backend's per-server filtering.
- **Render-time order computation**: `Sidebar` derives `orderedSessions` via `useMemo` over `sessions` and an effective order. Sessions absent from the saved order render at the bottom in their natural sequence (`Number.POSITIVE_INFINITY` rank) so newly created sessions never disappear from the sidebar.
- **Snappy drag (derive-over-store)**: The transient drag override is held in a server-keyed `orderOverrideRef = useRef<Record<string, string[]>>({})` (NOT React state), and the displayed order is *derived at render* as `orderOverrideRef.current[server] ?? (sessionOrderByServer.get(server) ?? [])` — `handleSessionReorderStart`/`handleSessionReorderOver` compute the new order via `splice` and write it into the ref for instant visual feedback. Because writing a ref does not re-render, the handlers call a minimal `forceRender` nudge (`useReducer((x) => x + 1, 0)`). The override clears via a **per-server, render-time SSE-equality reconcile** (since `260609-ebks-derive-sidebar-order`): while computing each visible server's props, if `arraysEqual(orderOverrideRef.current[server], sseOrder)` the override is deleted and `localOrder` rendered as `null` in the same pass (no nudge needed — the displayed output is unchanged). This replaced the former `localOrderByServer` `useState` + a whole-`sessionOrderByServer`-Map watcher `useEffect`, which re-ran on every unrelated SSE slice tick (sessions/metrics/connection fire a fresh Map reference several times a second) — pure render-efficiency churn, not a correctness bug. The per-server equality check (not a whole-Map effect) fires only on the relevant server's echo, so unrelated churn no longer triggers reconcile work. No snap-back: the override outlives the debounced PUT until that server's SSE order echoes the new arrangement. The user-facing behavior (snappy reorder, persist via SSE, no snap-back) is unchanged.
- **Debounced PUT**: 250ms trailing debounce via `orderPutTimerRef` + `setTimeout`. Drag events fire on every cursor frame; coalescing avoids one HTTP call per frame. `handleSessionReorderEnd` (dragend) does NOT cancel the pending timer — a fast drag-and-release within 250ms still flushes via the timer, otherwise the user's edit is lost.
- **Drag visual**: Source row gets `opacity-50` while it is the drag source (driven by the `isDragSource` prop on `<SessionRow>`).

`<SessionRow>` exposes optional drag props (`draggable`, `isDragSource`, `onDragStart`, `onDragEnd`) — present for the new feature, absent for any future caller that doesn't want session reorder. The row root passes them straight through to the underlying `<div>`.

**Test ergonomics**: `session-context.tsx` exports a `StandaloneSessionContextProvider` test helper that accepts a partial multi-server shape (`sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer`, `metricsByServer`, `currentServer`, etc.) and synthesizes the full context value without opening any network connection. Tests requiring SSE-driven behavior use the full `SessionProvider` with a stubbed `EventSource`; `MockEventSource` is keyed by URL so per-server streams can be driven independently (see `session-context.test.tsx` for the pattern).

**Server selector footer** — pinned at the bottom of the sidebar below the scrollable session tree, separated by `border-t border-border`. Displays `Server: {name}` with a dropdown trigger. Clicking opens a dropdown listing all available tmux servers (from `GET /api/servers`); the current server is highlighted with `text-accent`. Selecting a different server calls `setServer(name)`, which updates localStorage (`runkit-server`), reconnects SSE, and navigates to `/`. The session tree area is `flex-1 min-h-0 overflow-y-auto` above the pinned footer.

### Collapsible Panels (Bottom-Aligned)

Two collapsible panels are pinned at the bottom of the sidebar below the scrollable session tree, above the server selector. Layout order top-to-bottom: server selector -> session list (`flex-1 overflow-y-auto`) -> Window panel -> Host panel. Combined height target ~140px when both open.

**CollapsiblePanel** (`app/frontend/src/components/sidebar/collapsible-panel.tsx`) — reusable wrapper used by both Window and Host panels. Props: `title` (string), `storageKey` (string for localStorage persistence), `defaultOpen` (boolean, default `true`), `children` (ReactNode). Header is always visible: title text + chevron (`&#x25B8;` U+25B8) that rotates 90 degrees on toggle via CSS `transform: rotate()` with `transition-transform duration-150`. Content area uses `max-height` transition (`duration-150 ease-in-out`) for smooth expand/collapse. `overflow: hidden` during transition, `visible` when fully expanded (accessibility). Collapse state persisted to `localStorage[storageKey]` on every toggle. Each panel has `border-t border-border`.

**WindowPanel** (`app/frontend/src/components/sidebar/status-panel.tsx`) — collapsible panel with `title="Pane"`, `storageKey="runkit-panel-window"`, `defaultOpen={true}`. Displays per-pane metadata rows: `tmx` (pane index + ID), `cwd` (shortened path), `git` (branch), `fab` (change ID + slug + stage) or `run` (process name), and `agt` (agent state). No window selected -> "No window selected" in secondary text. `StatusPanel` is exported as a deprecated alias for backward compatibility.

**Copyable rows**: The `tmx`, `cwd`, `git`, and `fab` rows are interactive `<button type="button">` elements that copy their underlying value to the clipboard on click or keyboard activation (Enter/Space). Copy values per row:

| Row | Copy value | Source |
|-----|------------|--------|
| `tmx` | Pane ID (e.g., `%5`) | `activePane.paneId` |
| `cwd` | Full unshortened path (e.g., `/home/sahil/code/run-kit`) | `activePane.cwd ?? win.worktreePath` |
| `git` | Branch name | `activePane.gitBranch` |
| `fab` | Change ID (e.g., `lc2q`) | `fabChange.id` (parsed from `win.fabChange`) |

Non-interactive rows: `run` (process-only, when no fab state) and `agt` remain plain text — no hover affordance, no focus ring, no copy behavior. Rows with empty values (`tmx` with empty pane ID, `git` when no branch) are also non-interactive.

**Activity spinners**: Two distinct inline spinner components indicate different activity types on the `run`/`fab` and `agt` rows:

| Component | File | Frames | Interval | Usage | Color |
|-----------|------|--------|----------|-------|-------|
| `BlockPulse` | `block-pulse.tsx` | `░▒▓█▓▒` | 150ms | `run` line (when `activity === "active"`) and `fab` line (when active) | `text-accent-green` (run), `text-accent` (fab) |
| `BrailleSnake` | `braille-snake.tsx` | `⣾⣽⣻⢿⡿⣟⣯⣷` | 80ms | `agt` line (whenever agent state is present) | `text-accent` |

Both components follow the same pattern: `useState(0)` frame counter + `useEffect` with `setInterval` + cleanup on unmount. Rendered as `<span aria-hidden="true">`. BlockPulse conveys "process alive, calm heartbeat"; BrailleSnake conveys "agent actively working, denser activity."

**Inline feedback**: After a successful copy, the row's prefix label swaps to `copied ✓` for 1000ms, then reverts. A single `copiedRow` state variable tracks which row was last copied — only one row shows feedback at a time. Clicking a different row immediately moves the indicator.

**Hover affordance**: Interactive rows render `cursor: pointer` and a subtle background tint (`bg-bg-inset` or equivalent) on hover.

**Keyboard accessibility**: Button elements have visible focus state (outline/ring) and are keyboard-activatable (Enter/Space). Styling is reset to preserve the panel's compact plain-text aesthetic — no default button chrome (padding, border, background removed in rest state).

**Text-selection guard**: The click handler checks `window.getSelection()?.toString()` — if the user has an active text selection (e.g., from drag-selecting text), the copy action is suppressed, preserving native text-selection UX.

**Clipboard utility**: Copy operations use `copyToClipboard()` from `app/frontend/src/lib/clipboard.ts` — see [Clipboard Utility](#clipboard-utility).

**HostPanel** (`app/frontend/src/components/sidebar/host-panel.tsx`) — 5-line server metrics display inside a `CollapsiblePanel` with `title="Host"`, `storageKey="runkit-panel-host"`, `defaultOpen={true}`. Accepts `metrics: MetricsSnapshot | null` and `isConnected: boolean` props. When `metrics` is null, shows "No metrics". Lines:

1. **Hostname + SSE indicator** — hostname on the left (truncated), green dot (`bg-accent-green`) or gray dot (`bg-text-secondary`) on the right indicating SSE connection health
2. **CPU sparkline** — `cpu` label + braille sparkline (`text-accent`) + current percentage (`text-text-primary`). Sparkline rendered by `sparkline()` from `@/lib/sparkline.ts`
3. **Memory gauge** — `mem` label + filled/empty block gauge + `used/totalG` text. Gauge color: green < 70%, yellow 70-90%, red > 90%. Uses `gaugeBar()`, `gaugeColor()`, `formatMemory()` from `@/lib/gauge.ts`
4. **Load averages** — `load` label + three percentages (1/5/15 min) normalized as `(load / cpuCount) * 100`. Any percentage > 90% renders in `text-red-500`
5. **Disk + uptime** — `dsk` label + `used/totalG` + ` · up ` + formatted uptime (`Nd Nh` or `Nh Nm` if < 1 day). All `text-text-secondary`

### Color Tinting

Session and window rows in the sidebar support an optional ANSI-palette color assignment that applies a full-width background tint. Colors come from the active theme's ANSI palette (indices 0-15), so they adapt automatically when the user switches themes.

**Pre-blended row tints**: Colors are pre-blended via `blendHex()` (in `themes.ts`) against the theme background — not rgba opacity. `computeRowTints(palette)` pre-computes a `Map<number, RowTint>` for all 13 picker indices at three blend ratios:

| State | ANSI ratio | Background ratio |
|-------|------------|------------------|
| Base | 12% | 88% |
| Hover | 18% | 82% |
| Selected | 22% | 78% |

Each state gets its own concrete hex value — no stacking of transparent layers. The `RowTint` type (`{ base, hover, selected }`) is exported from `themes.ts`. When a row has a color assigned, the tint backgrounds replace the existing state backgrounds (`bg-accent/10` for selected, `hover:bg-bg-card/50` for hover). The left border on selected colored windows uses the ANSI color at full saturation. Hover state is applied imperatively via `onMouseEnter`/`onMouseLeave` style mutations to avoid CSS specificity issues with dynamic backgrounds.

**ANSI picker indices**: 13 colors offered — `PICKER_ANSI_INDICES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]` (exported from `themes.ts`). Excludes 0 (black), 7 (white), 15 (bright white) to avoid clash with dark/light theme backgrounds. Index 8 (bright black) included as a usable gray.

**SwatchPopover** (`app/frontend/src/components/swatch-popover.tsx`): Shared component used by command palette color actions and hover indicator. Renders 13 color swatches in a compact grid plus a "Clear" action. Props: `selectedColor?: number`, `onSelect(color: number | null)`, `onClose()`. Each swatch displays the ANSI color from `theme.palette.ansi[N]` at full saturation. Currently selected color shown with a checkmark or ring. Swatches re-render live during theme preview. Lazy-loaded in `app.tsx` via `React.lazy()`. Dismisses on selection, Escape, or outside click.

**Hover indicator**: On hover, a small palette icon appears at the row's trailing edge (right side, alongside existing hover-reveal controls). Clicking opens the SwatchPopover inline, anchored to the row. Visible only on hover (desktop) or always visible on touch (`coarse:opacity-100`).

**Command palette actions**: "Session: Set Color" (id `session-set-color`, only when session selected) and "Window: Set Color" (id `window-set-color`, only when window selected) open the SwatchPopover. Selecting a color calls the respective API endpoint; selecting "Clear" sends `null`. Both session and window rows in the sidebar also support direct SwatchPopover via the hover indicator.

**Storage**: Session colors persist in `run-kit.yaml` at the project's git root (survive tmux restarts). Window colors are ephemeral tmux `@color` user options (survive session lifetime, not server restarts). See architecture.md for backend details.

### Braille Sparkline Renderer

`app/frontend/src/lib/sparkline.ts` — converts an array of float values (0-100 range) into a Unicode braille sparkline string. Uses 8 vertical levels from the U+2800-U+28FF braille range filling bottom-to-top: `⣀⣄⣤⣦⣶⣷⣾⣿` (level 0 = `⣀`, level 7 = `⣿`). Values linearly interpolated across 8 levels. Zero-filled buffer renders as repeated `⣀`. Exported as `sparkline(samples: number[]): string`.

### Memory Gauge Renderer

`app/frontend/src/lib/gauge.ts` — utilities for the memory gauge visualization:
- `gaugeBar(ratio: number): string` — builds a filled/empty block string (`█` filled, `░` empty) from a 0-1 ratio. Fixed width of 10 characters
- `gaugeColor(percent: number): string` — returns a Tailwind color class: `text-green-500` (< 70%), `text-yellow-500` (70-90%), `text-red-500` (> 90%)
- `formatBytes(bytes: number): string` — compact human-readable size (`3.1G`, `512M`, `128K`)
- `formatMemory(used: number, total: number): string` — compact `used/total` string (e.g., `3.1G/8G`)

### Clipboard Utility

`app/frontend/src/lib/clipboard.ts` — shared `copyToClipboard(text: string): Promise<void>` function extracted from `terminal-client.tsx`. Primary path uses `navigator.clipboard.writeText()`; fallback uses `document.execCommand('copy')` for non-secure contexts (HTTP). Signature and behavior preserved from the original. All callers (terminal copy, Pane panel row copy) import from this module. Introduced to decouple sidebar copy operations from the terminal-client module.

CWD display (line 1) uses `shortenPath()` to shorten the active pane's `cwd` (falls back to `worktreePath`):
- Home substitution: `/home/<user>/…` → `~/…`, `/Users/<user>/…` → `~/…`, `/root/…` → `~/…` (exact home dir → `~`). Handles Linux and macOS conventions.
- Truncation: if the path (after home substitution) has more than 2 non-empty segments, it is truncated to `…/<second-to-last>/<last>`. Paths with ≤ 2 segments are not truncated.
- Examples: `/home/sahil/code/org/repo/src` → `…/repo/src`; `/home/sahil/code/org` → `~/code/org`; `/var/log/nginx` → `…/log/nginx`.
- The `title` attribute on the CWD element always contains the original unmodified `activePaneCwd` — hover to see the full path.

## Session Creation Pattern

### Instant Creation (Primary)

All primary session creation entry points create a session immediately without a dialog. Implemented by `executeCreateSessionInstant` in `app.tsx`.

**Algorithm**:
1. Derive a name from the active window's `worktreePath` using `deriveNameFromPath(worktreePath)` (exported from `create-session-dialog.tsx`). If the result is empty (CWD is `/`, `~`, or `worktreePath` is undefined), the name is `session`.
2. Deduplicate against `sessions`: if the name is taken, try `{name}-2`, `{name}-3`, … up to `{name}-10`. If all are taken, use `{name}-11` (best-effort).
3. Call `createSession(server, derivedName, worktreePath)`. If no active window exists, call `createSession(server, "session")` (no `cwd` — tmux defaults to server CWD).
4. The session appears in the sidebar via the existing optimistic/ghost mechanism.

**Entry points** (all call `onCreateSession` → `executeCreateSessionInstant`):
- Sidebar `+` button (session level)
- Sidebar empty-state `+ New Session` button
- Dashboard "New Session" dashed-border card
- Top-bar breadcrumb session dropdown `+ New Session` item
- Cmd+K "Session: Create" action

**Name derivation utilities**: `deriveNameFromPath` and `toTmuxSafeName` are exported from `app/frontend/src/components/create-session-dialog.tsx` so `app.tsx` can import them without duplicating logic.

### Folder-Prompted Creation (Secondary, via Cmd+K)

Two secondary entry points open `CreateSessionDialog` for users who want to specify a starting directory:

- **"Session: Create at Folder"** — opens `CreateSessionDialog` (mode `"session"`, default). The dialog's path input is pre-filled with `currentWindow.worktreePath` via the `defaultPath?: string` prop added to `CreateSessionDialogProps`. If no active window, the field starts empty.
- **"Window: Create at Folder"** — opens `CreateSessionDialog` with `mode="window"` and `session={currentSession}`. In window mode: title changes to "Create window at folder", session name input hidden, confirming calls `createWindow(server, session, "zsh", cwd)`.

`CreateSessionDialog` gains three optional backward-compatible props:
- `defaultPath?: string` — pre-fills the path input
- `mode?: "session" | "window"` — controls dialog behavior (default `"session"`)
- `session?: string` — required in window mode to pass to `createWindow`

### Deprecated: Dialog-First Flow

The `showCreateDialog` / `openCreateDialog` / `closeCreateDialog` API in `use-dialog-state.ts` has been removed. `CreateSessionDialog` is no longer opened by the sidebar `+` button or the primary "Session: Create" palette action. Use "Session: Create at Folder" in Cmd+K for folder-prompted session creation.

## Bottom Bar (Shell-level, Shared Across Routes)

Single row of `<kbd>` styled buttons, rendered at shell level via `<Shell>`'s `bottombar` grid area on every route that mounts `<Shell>` — single-terminal, board, and dashboard alike (`260509-17m3-rotated-shell-layout` lifted it from the terminal column up to shell level). Width tracks the right grid column (page width minus sidebar). Styled with `border-t border-border` and `py-1.5` padding. Layout: `Tab Ctrl Alt Fn▴ ArrowPad | >_ ⌘K ⌨`. Hostname removed from bottom bar — now shown exclusively in the sidebar Host panel. Escape moved to the Function key dropdown's extended-keys section. Compose button (`>_`) conditionally rendered when `onOpenCompose` is provided.

`BottomBarProps` no longer contains `wsRef` — the prop was removed when BottomBar moved up the tree. Input handlers read `focused?.wsRef` from `FocusedTerminalContext` and send ANSI escape sequences through it. The component is byte-identical across single-terminal and board routes (same JSX, same callbacks: `onOpenCompose`, `onFocusTerminal`, `onScrollLockChange`) — board panes are terminals, so the input toolbar applies identically. When `focused === null` (Dashboard route, no active terminal), input handlers natural-no-op via the existing `wsRef.current?.readyState !== OPEN` guard — no error, no toast.

**Modifier toggles** (Ctrl, Alt): Sticky armed state with visual indicator (`accent` bg). Click to arm, auto-clears after next key is sent. Click again while armed to disarm. Multiple modifiers can be armed simultaneously. Cmd (`⌘`) removed — on desktop users hold the real Cmd key; on mobile Cmd combos aren't used in terminal workflows.

**Armed modifier bridging**: When modifiers are armed, a capture-phase `keydown` listener intercepts physical keypresses and translates them to terminal escape sequences (Ctrl+letter → control characters, Alt → ESC prefix). Sends via WebSocket, preventing xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.

**ArrowPad** (`arrow-pad.tsx`): Combined directional pad replacing individual arrow buttons. Sends ANSI escape sequences (`[A/B/C/D`). With modifiers, use xterm parameter encoding (`[1;{mod}X`). Modifier parameter: 1 + (alt?2:0) + (ctrl?4:0).

**Function key dropdown** (F▴): Opens a combined popup above the button. Top section: F1-F12 in a 4-column grid. Divider (`border-t border-border`). Bottom section: Esc, PgUp, PgDn, Home, End, Ins, Del in a 3-column grid (3x3, 7 items). Escape uses `sendSpecial` (preserves Ctrl re-arm semantics); other extended keys use `sendWithMods`. Closes after each selection, on outside click, or on Escape.

**Special keys** (Tab in bottom bar, Esc in Fn menu): Direct send via `sendSpecial`. Ctrl is not consumed for Esc/Tab (Esc IS Ctrl+[, Tab IS Ctrl+I in terminal semantics) — Ctrl stays armed for the next key. Alt prefix with ESC (Meta convention).

**All buttons**: 36px minimum height/width on desktop (`min-h-[36px] min-w-[36px]`), 44px height / 36px width on touch devices (`coarse:min-h-[44px] coarse:min-w-[36px]`). `text-xs`, `<kbd>` element styling.

**Focus preservation**: All bottom bar buttons that send terminal input or toggle modifier state have `onMouseDown={(e) => e.preventDefault()}` via a shared `preventFocusSteal` handler. This prevents the browser from shifting focus away from xterm.js's hidden textarea when buttons are tapped, keeping the on-screen keyboard visible on iOS/touch devices. The CmdK button is excluded (it intentionally opens a dialog that takes focus). The ArrowPad handles focus preservation independently via its own `onMouseDown` handler.

### Compose Buffer

Modal dialog (`fixed inset-0 z-40`) triggered by the compose button (`>_` in top bar right section). Follows the same structural pattern as `dialog.tsx`: separate backdrop layer (`fixed inset-0 bg-black/50`, `aria-hidden`), `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap (Tab/Shift+Tab cycling), two-layer click-outside close (outer `onClick={onClose}`, inner `stopPropagation`). Terminal dims (`opacity-50`) while compose is open.

- **Title**: "Text Input" (`<h2>` with `aria-labelledby` ID)
- **Open**: Tap compose button (`>_` icon in top bar)
- **Send**: Click Send button or press Cmd/Ctrl+Enter — entire text transmitted as one WebSocket message
- **Dismiss**: Press Escape — closes without sending, text discarded
- **Why**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste, IME all require a real DOM element. Also useful on desktop for pasting large text blocks over a laggy WebSocket.
- **initialText prop**: Optional string that pre-populates the textarea via imperative ref (no `defaultValue`). On subsequent prop changes while mounted, appends only new text.
- **Image preview**: When files are uploaded, a horizontal thumbnail strip renders above the textarea (~60px height). Image files (`image/*`) show `<img>` thumbnails via `URL.createObjectURL()` blob URLs. Non-image files show filename text. Each item has a dismiss (×) button (visible on hover) that removes the file from preview and its path from the textarea. Clicking an image thumbnail toggles a larger constrained preview within the dialog. All blob URLs are revoked via `URL.revokeObjectURL()` when the dialog closes (unmount cleanup).
- **Upload flow**: `useFileUpload` hook returns `{ path: string; file: File }[]` tuples. `terminal-client.tsx` stores both paths and `File` objects in state, passing `uploadedFiles` and `onRemoveFile` props to the compose buffer.

### File Upload

Four entry points, all on the terminal page:
- **Clipboard paste** (`Cmd+V` / `Ctrl+V`) — document-level paste listener; files in `clipboardData.files` trigger upload, text-only paste passes through to xterm
- **Drag-and-drop** — drop files onto the terminal area; `ring-2 ring-accent` border highlight during drag-over; non-file drag content ignored
- **Compose buffer upload button** (📎) — in compose buffer action row, left of Send button; opens native file picker via hidden `<input type="file">`
- **Command palette** — "Upload file" action opens a separate file picker (hidden input in terminal-client)

After upload: file path auto-inserted into compose buffer (opens compose if closed). Multiple files produce one path per line. Server writes to `.uploads/{YYMMDD-HHmmss}-{sanitized-name}` in the project root. 50MB size limit. `.uploads/` auto-added to `.gitignore` on first use.

### iOS Keyboard Support

`useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) manages all viewport-related CSS side effects: adds the `fullbleed` class to `<html>` on mount (removed on cleanup), and listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. The `scroll` listener catches iOS Safari viewport panning that doesn't trigger `resize`. In fullbleed mode, `globals.css` applies `position: fixed` to the `.app-shell` container with `inset: 0` and `height: var(--app-height, 100vh)`, pinning it to the viewport regardless of document scroll. When the iOS keyboard appears, the bottom bar stays pinned above it, the terminal shrinks, and xterm refits via the existing `ResizeObserver`. The `fullbleed` class is also present in `index.html` as a static default (FOUC prevention); the hook takes over lifecycle management at runtime.

**Keyboard toggle** (`⌨` U+2328): Right-aligned button in the bottom bar, visible only on touch devices (`hidden coarse:inline-flex`). Bidirectional toggle: when terminal is focused (detected via `document.activeElement.closest(".xterm")`), tapping blurs to dismiss the keyboard; when not focused, tapping calls `onFocusTerminal` callback which chains through `app.tsx` → `TerminalClient.focusRef` → `xtermRef.current.focus()` to summon the keyboard. Dynamic `aria-label`: "Hide keyboard" / "Show keyboard". Uses `preventFocusSteal` to avoid stealing focus on the dismiss path.

**Scroll-lock mode**: Long-press (>= 500ms) on the keyboard toggle button activates scroll-lock — a mode that prevents the soft keyboard from appearing when the terminal area is tapped, allowing uninterrupted reading and scrolling. State is a `scrollLocked` boolean in `BottomBar` (default `false`), exposed to the parent via `onScrollLockChange` callback and passed down to `TerminalClient` as a `scrollLocked` prop. When locked, a capture-phase `focusin` listener on the terminal container immediately blurs any `.xterm` element that gains focus, preventing the keyboard from appearing. Touch scroll gestures (SGR mouse sequences) are unaffected — only focus is prevented. Activating scroll-lock while the keyboard is visible auto-dismisses it (`document.activeElement?.blur()`). Optional haptic feedback via `navigator.vibrate?.(50)` on toggle (graceful no-op if unavailable).

- **Long-press detection**: `touchstart`/`touchend`/`touchmove` handlers with a 500ms timer (`LONG_PRESS_MS` constant). Touch move > 10px (`LONG_PRESS_MOVE_THRESHOLD`) cancels the long-press. On timer expiry, scroll-lock toggles and subsequent `touchend`/`click` are suppressed via a ref flag. Desktop click behavior is unaffected (touch events only).
- **Tap in locked mode**: Tapping the keyboard button (< 500ms) when `scrollLocked` is `true` unlocks AND summons the keyboard in one action — matches user intent without requiring a double-tap.
- **Visual indicator**: When locked, the button shows `bg-accent/20 border-accent text-accent` (same armed-state pattern as Ctrl/Alt modifier toggles) and the icon changes from `⌨` (U+2328) to `🔒` (U+1F512). `aria-label` updates to "Scroll lock on — tap to unlock".
- **State lifecycle**: Session-scoped (component-local React state, not persisted). Resets on navigation (component unmount/remount). Compose buffer is unaffected — it has its own input field outside the terminal container.

### Terminal Touch Scroll

The terminal container div has `touch-pan-y` (CSS `touch-action: pan-y`) — allows vertical swipe gestures for scrollback access on mobile/touch devices while blocking horizontal panning (prevents page-level overflow from tmux's ~80 column minimum). The xterm.js `.xterm-viewport` has `overflow-y: scroll` and `overscroll-behavior: none` (in `globals.css`), so the browser delegates vertical touch scroll to xterm natively without page bounce. In the single-view model, fullbleed is always active — `overflow: hidden` and `overscroll-behavior: none` are applied to both `html` and `body` (via `globals.css`), preventing iOS Safari elastic bounce scrolling. The compose buffer and bottom bar are siblings of the terminal container, not children, so their touch behavior is preserved.

## Mobile Responsive

### Breakpoints & Container Width

All zones use `px-3 sm:px-6` — reduced horizontal padding on screens < 640px. No `max-w-4xl` constraint — terminal, top bar, and bottom bar all span full width. The mobile/desktop breakpoint for the `<Shell>` topology is **640px** (matches the existing `sm:` Tailwind breakpoint and `useIsMobile()` hook): `>= 640px` uses the 2-column grid with sidebar full-height; `< 640px` uses the single-column grid with sidebar overlay. Sidebar is drag-resizable on desktop (default 220px, min 160, max 400); terminal fills remaining space via the right grid column. Terminal container has `py-0.5 px-1` padding for breathing room against border lines. Bottom bar uses `py-1.5` vertical padding.

### Touch Targets

A custom Tailwind variant `coarse:` is defined in `globals.css` via `@custom-variant coarse (@media (pointer: coarse))`. On touch devices, interactive elements get `coarse:min-h-[44px]` (Apple HIG minimum). This includes:
- FixedWidthToggle (`coarse:min-h-[36px] coarse:min-w-[28px]`)
- Sidebar session ✕ kill buttons + window rows
- Breadcrumb name dropdown triggers
- `⋯` command palette trigger
- Hamburger icon (sidebar toggle — single state covers desktop column collapse and mobile overlay since `260509-17m3-rotated-shell-layout`)

Bottom bar buttons use `coarse:min-h-[44px] coarse:min-w-[36px]` on touch devices, `min-h-[36px] min-w-[36px]` on desktop.

### Viewport Zoom Prevention

The viewport meta tag in `app/frontend/index.html` includes `maximum-scale=1.0` and `user-scalable=no` to prevent iOS Safari from auto-zooming when text inputs (command palette, compose buffer, text input dialog) receive focus. Without these directives, iOS zooms in on inputs with `font-size < 16px`, displacing the entire interface. Pinch-to-zoom is also disabled — acceptable tradeoff for a keyboard-first tool dashboard where zoom doesn't improve terminal readability. The existing `interactive-widget=resizes-content` directive is preserved (controls keyboard layout resizing, unrelated to zoom).

### Terminal Addons

Addons loaded in `init()` from **static top-of-file imports**, after `terminal.open()`, before `ResizeObserver` setup. Order: FitAddon (existing) → fit() → ClipboardAddon → WebLinksAddon → UnicodeGraphemesAddon → WebglAddon. The Unicode addon MUST precede WebGL so the renderer measures cell widths against the active Unicode 15 table on first paint.

**Static import bundling** (since `260531-m3pl-static-xterm-imports`): all six xterm-family value imports (`@xterm/xterm` `Terminal`, `addon-fit`, `addon-clipboard`, `addon-web-links`, `addon-unicode-graphemes`, `addon-webgl`) are static top-of-file `import` statements in `terminal-client.tsx`, NOT runtime `await import()`. Because `terminal-client.tsx` is already router-lazy, the xterm family bundles into the already-deferred terminal-route chunk and loads **once when that chunk loads** — never as a per-pane-mount runtime module-graph fetch. This removes all six chunk fetches from the browser's per-origin connection budget at terminal-init time, fixing the board-route E2E hang: on the plaintext dev/test origin (no HTTP/2 — only negotiated over TLS), the browser caps ~6 persistent connections per origin, and long-lived streams (Vite HMR socket, pooled SSE `EventSource`, one `/relay/<wid>` WS per visible pane) already saturate the slots, so a 7th xterm chunk fetch hung pending forever → `setTerminalReady(true)` never ran → blank pane → E2E poll timeout. Masked in production over Tailscale HTTPS (h2 multiplexes). The CSS side-effect import (`@xterm/xterm/css/xterm.css`) and type-only `import("@xterm/...")` annotations were already static and are unchanged.

| Addon | Purpose | Notes |
|-------|---------|-------|
| `@xterm/addon-fit` | Auto-resize columns/rows | Existing — loaded first, `fit()` called immediately |
| `@xterm/addon-clipboard` | OSC 52 clipboard sequences | Custom `ClipboardProvider` accepts both `""` (empty/default, tmux's format) and `"c"` (explicit) selection targets. Rejects `"p"`, `"s"`, `"0"`–`"7"`. Provider exported as `clipboardProvider` for testability |
| `@xterm/addon-web-links` | Clickable URLs in terminal output | |
| `@xterm/addon-unicode-graphemes` | Unicode 15 + grapheme-cluster width tables | Requires `allowProposedApi: true` on the Terminal constructor; `terminal.unicode.activeVersion = "15-graphemes"` set after `loadAddon()`. Must load before the WebGL addon |
| `@xterm/addon-webgl` | GPU-accelerated rendering | The `new WebglAddon()` / `loadAddon(...)` construction stays wrapped in try/catch — silently falls back to canvas renderer on GPU/WebGL-context failure. The *module load* is static (resolved at chunk load, cannot fail at `init()` time), but context creation can still throw at runtime, so the runtime guard is retained (`260531-m3pl-static-xterm-imports`) |

### Terminal Font Scaling

Terminal font size adapts at initialization: 13px on viewports >= 640px, 11px below. Determined via `window.matchMedia('(min-width: 640px)')` at xterm Terminal construction time. FitAddon recalculates columns automatically.

### Terminal Font Bundling

The frontend bundles JetBrainsMono Nerd Font (patched single-file variant) as a webfont so terminal rendering is deterministic across all viewers, independent of which monospace fonts the browser happens to have installed. Without bundling, per-glyph font fallback for Nerd Font private-use-area codepoints produces visible baseline wobble within a single terminal row.

**Asset layout**: Three `.woff2` weights served from `/fonts/` — `JetBrainsMonoNerdFont-Regular.woff2` (400 normal), `-Bold.woff2` (700 normal), `-Italic.woff2` (400 italic). All three `@font-face` rules in `app/frontend/src/globals.css` expose the same `font-family: "JetBrainsMono Nerd Font"` name and MUST declare `font-display: block`. `swap` or `fallback` would let xterm measure cells against system-font metrics that persist as misalignment — xterm measures the character cell grid exactly once at `terminal.open()` and does not re-measure when a deferred font arrives. `index.html` includes a `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/JetBrainsMonoNerdFont-Regular.woff2" />` to overlap the Regular download with JS parsing (only Regular is preloaded — Bold/Italic are a smaller fraction of the initial paint and don't justify the extra critical-path bytes).

**Load convention before `terminal.open()`**: The init routine in `app/frontend/src/components/terminal-client.tsx` awaits a concurrent `Promise.all([document.fonts.load(...), document.fonts.load(...), document.fonts.load(...)])` for all three weights at the exact `fontPx` (`isMobile ? 11 : 13`) the Terminal will use, BEFORE `new Terminal(...)` / `terminal.open()` / `fitAddon.fit()`. Three explicit `document.fonts.load(size, family)` calls (not `document.fonts.ready`) scope the await to exactly the weights xterm will request. A fresh `if (cancelled || !terminalRef.current) return;` guard MUST follow the await. Since `260531-m3pl-static-xterm-imports` made all six xterm imports static, this font-load `await Promise.all([...])` is the **only** remaining async boundary in `init()` (the former `await import(...)` boundaries are gone), so it is the sole place a post-await unmount guard is required before `new Terminal(...)`; the inter-addon `cancelled` re-checks that existed solely to guard the removed import awaits were dropped, leaving one post-construction dispose guard before `setTerminalReady(true)`.

**Primary `fontFamily`**: `'"JetBrainsMono Nerd Font", ui-monospace, monospace'` — bundled webfont first, `ui-monospace` as the system-default monospace, generic `monospace` as final guard against total load failure. The older long tail (`JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas`) is dead code once `font-display: block` plus a successful load makes the webfont always win; do not reintroduce it. Non-terminal monospace surfaces pick up the same font automatically via Tailwind's `--font-mono` custom property (webfont-first). Introduced by change `260417-hyrl-bundle-jetbrains-mono-nerd-font`.

**Test caveat**: jsdom does not implement the FontFaceSet API. `src/test-setup.ts` stubs a minimal `document.fonts.load()` / `document.fonts.ready` surface (same pattern as the existing `ResizeObserver` stub) so unit tests that mount `TerminalClient` do not hang on the await.

### Terminal Unicode Width Handling

xterm.js defaults to Unicode 6 width tables, which classify many modern glyphs (most emojis, several Misc Symbols codepoints) as 1 cell. Modern tmux lays out its buffer using wcwidth with a newer Unicode table (typically 14/15), treating the same glyphs as 2 cells. Without alignment, subsequent characters in a row drift between tmux's intended column and xterm's rendered column, producing visible ghost/overlap artifacts — especially with the WebGL renderer.

**Resolution** (`app/frontend/src/components/terminal-client.tsx`):
1. Construct the Terminal with `allowProposedApi: true` — required to access `terminal.unicode` (a proposed-API surface in xterm v6).
2. After `terminal.open()`, `loadAddon(new UnicodeGraphemesAddon())` (statically imported since `260531-m3pl-static-xterm-imports`) and set `terminal.unicode.activeVersion = "15-graphemes"`.
3. Load order MUST precede the WebGL addon so the renderer initialises against the Unicode 15 table on first measure.

The `addon-unicode-graphemes` package (v6-era) supersedes `addon-unicode11`: it covers Unicode 15 and grapheme clusters (ZWJ sequences, flag emoji, skin-tone modifiers) at the same install cost. The `unicodeVersion` Terminal constructor option is a no-op past `"6"` without the addon — the addon is what registers the newer width table.

Introduced by change `260418-xgl2-xterm-emoji-width`.

### Command Palette Mobile Trigger

The `CommandPalette` component listens for a `palette:open` CustomEvent on `document` (in addition to `⌘K`). The `⋯` button in Line 1 dispatches this event on mobile. This is the mobile equivalent of `⌘K` — physical keyboards aren't available on phones.

### Keyboard-Navigable List Scroll Pattern

Both `CommandPalette` and `ThemeSelector` use the same scroll-into-view pattern for arrow key navigation: a `listRef` on the listbox container plus a `useEffect` on `[selectedIndex, open]` that queries `[aria-selected="true"]` and calls `scrollIntoView({ block: "nearest" })`. This ensures the selected item stays visible when navigating past the `max-h-64` scroll boundary. New keyboard-navigable list components SHOULD follow this pattern.

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | Always |
| `Cmd+C` / `Ctrl+C` | Copy selection to clipboard (with selection) or send SIGINT (without selection) | Terminal focused — via `attachCustomKeyEventHandler`, `keydown` only. Uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback for non-secure contexts (HTTP). Selection cleared after copy via `.finally()` |

No single-key shortcuts (`j`/`k`/`c`/`r`) or `Esc Esc` — these conflicted with xterm.js terminal input. All actions are accessible via `Cmd+K` command palette or top bar buttons.

Command palette actions include: create/rename/kill session, create/rename/kill window, move window left/right, theme switching, "Reload tmux config" (targets the active server via `?server=` param), "Create tmux server" (opens name dialog, creates session "0" in $HOME), "Kill tmux server" (confirmation dialog, kills active server, switches to next available), "Switch tmux server: {name}" (one entry per available server, current marked), "Keyboard Shortcuts" (opens modal showing curated tmux keybindings from `GET /api/keybindings` + hardcoded `Cmd+K`), "Copy: tmux Commands" (opens tmux commands dialog — only visible on terminal route when `currentWindow` is available), and terminal navigation (jump to any session/window).

**Session/window creation actions in the palette**:
| Action ID | Label | Behavior |
|-----------|-------|----------|
| `create-session` | "Session: Create" | Instant creation — no dialog (see Instant Session Creation) |
| `create-session-at-folder` | "Session: Create at Folder" | Opens `CreateSessionDialog` pre-filled with `currentWindow.worktreePath`; empty if no active window |
| `create-window` | "Window: Create" | Instant window creation (existing behavior, unchanged) |
| `create-window-at-folder` | "Window: Create at Folder" | Opens `CreateSessionDialog` in `mode="window"` (dialog title changes, session name input hidden, confirms via `createWindow(server, session, "zsh", cwd)`); only shown when a session is active |
| `create-iframe-window` | "Window: New Iframe Window" | Opens dialog with name + URL inputs; creates iframe window via `createWindow(server, session, name, undefined, "iframe", url)`; only shown when a session is active |

**Window move actions**: "Window: Move Left" (id `move-window-left`) and "Window: Move Right" (id `move-window-right`) in the `windowActions` group. Only shown when `currentWindow` exists. "Move Left" excluded when the current window is at the minimum index in the session; "Move Right" excluded when at the maximum index (boundary exclusion, not disabled state). On select, calls `moveWindow(server, currentWindow.windowId, targetIndex)` (source by stable window ID, destination by position) then navigates to the **same** `currentWindow.windowId` — the window keeps its ID across the reorder (only its index changes), so the user stays on their window after the swap.

**Cross-session move actions**: Dynamically generated "Window: Move to {sessionName}" actions (id `move-window-to-session-{sessionName}`) — one per session other than the current one. Only shown when `currentWindow` exists AND there are at least 2 sessions. On select, calls `moveWindowToSession(server, currentWindow.windowId, targetSession)` then navigates to `/$server` (server dashboard) because tmux auto-assigns the window index in the destination session and no `/$server/$session` route exists. Flat action list (not a sub-picker) — works well for typical session counts (2-5) and requires zero changes to the command palette component.

### Keyboard Shortcuts Modal

`app/frontend/src/components/keyboard-shortcuts.tsx` — opened via command palette "Keyboard Shortcuts" action. Fetches `GET /api/keybindings?server=...` on-demand each time (no caching). Displays bindings in three groups:

1. **App** — hardcoded `Cmd+K` (command palette)
2. **tmux** — root-table bindings displayed as bare key names (e.g., `F2`, `Shift+F3`)
3. **tmux (prefix)** — prefix-table bindings displayed as `Ctrl+S, <key>` (e.g., `Ctrl+S, \`)

Key name formatting: `S-` → `Shift+`, `C-` → `Ctrl+`. Shows "Loading..." during fetch, "No tmux server running" when response is empty. Uses the shared `Dialog` component.

### Tmux Commands Dialog

`app/frontend/src/components/tmux-commands-dialog.tsx` — opened via command palette "Copy: tmux Commands" action (id `copy-tmux-attach`). Only available on terminal pages when `currentWindow` exists. Opens a `Dialog` with title "tmux commands" showing three copyable tmux command rows:

| Label | Command |
|-------|---------|
| Attach | `tmux [-L {server}] attach-session -t {session}:{window}` |
| New window | `tmux [-L {server}] new-window -t {session}` |
| Detach | `tmux [-L {server}] detach-client -t {session}` |

**Server-aware command generation**: Commands include the `-L {server}` flag only when the server is not `"default"`. When the server is `"default"`, the flag is omitted. This matches the `tmuxExecServer` convention in the backend (see `tmux-sessions.md`).

Each row has a label (`text-text-secondary text-[11px]`), a monospace code block (`bg-bg-inset border border-border rounded px-2 py-1.5 font-mono text-[11px] select-all`), and a copy button. Clicking the copy button writes the command to the clipboard via `navigator.clipboard.writeText` and swaps the copy icon to a checkmark for 1.5 seconds before reverting. Clipboard failure is silently caught.

Dialog state is a `showTmuxCommands` boolean in `app.tsx` (same pattern as `showCreateServerDialog` / `showKillServerConfirm`). Props: `server`, `session`, `window`, `onClose`.

## Visual Design

Three theme modes: **system** (follows OS), **light**, **dark**. Default: system. Linear/Raycast aesthetic.

Theme is applied via `data-theme` attribute on `<html>` (`"dark"` or `"light"`). CSS custom properties in `globals.css` switch values per `html[data-theme="dark"]` and `html[data-theme="light"]` selectors. The `@theme` block registers token names for Tailwind CSS 4 with dark palette as initial values.

### Color Tokens

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--color-bg-primary` | `#0f1117` | `#f8f9fb` | Page background |
| `--color-bg-card` | `#171b24` | `#ffffff` | Card backgrounds |
| `--color-bg-inset` | `#0a0c12` | `#e8eaef` | Fixed-width outer background |
| `--color-text-primary` | `#e8eaf0` | `#1a1d24` | Primary text |
| `--color-text-secondary` | `#7a8394` | `#6b7280` | Secondary text, labels |
| `--color-border` | `#454d66` | `#d1d5db` | Borders, dividers |
| `--color-accent` | `#5b8af0` | `#4a7ae8` | Active states, focus rings |
| `--color-accent-green` | `#22c55e` | `#16a34a` | Activity indicators |
| `--font-mono` | JetBrains Mono, etc. | (same) | Everywhere |

### Theme Switching

Preference persisted to backend API (`PUT /api/settings/theme` → `~/.rk/settings.yaml`) with localStorage key `runkit-theme` as synchronous cache (values: any theme ID or `"system"`). On init, ThemeProvider calls `getThemePreference()` from API; falls back to localStorage / `"system"` if API fails. `setTheme` writes localStorage immediately and calls `setThemePreference(id)` fire-and-forget. Three switching surfaces: (1) command palette (`Cmd+K` → "Theme: System/Light/Dark", current indicated with "(current)" suffix), (2) top-bar ThemeToggle button (desktop only, hidden on mobile via `hidden sm:flex`, cycles system → default-light → default-dark), and (3) Theme Selector modal (Ctrl+Click / Cmd+Click on ThemeToggle, or command palette "Theme: Select Theme").

### No-Flicker Initialization

A blocking inline `<script>` in `index.html` `<head>` reads `localStorage("runkit-theme")`, resolves system preference via `matchMedia`, and sets `data-theme` on `<html>` before first paint. Static fallback: `data-theme="dark"` on the `<html>` tag.

### PWA Meta Tags & Theme Color

`app/frontend/index.html` includes PWA-related tags in `<head>`:
- `<meta name="theme-color" content="#0f1117" />` — initial value matching dark theme background
- `<meta name="apple-mobile-web-app-capable" content="yes" />` — enables standalone mode on iOS
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />` — content renders behind the status bar
- `<link rel="apple-touch-icon" href="/generated-icons/icon-192.png" />` — homescreen icon for iOS

The `<link rel="manifest">` tag is injected automatically by `vite-plugin-pwa` during build.

**Theme-color synchronization**: The `theme-color` meta tag value is kept in sync with the active theme via two mechanisms:
1. **Initial load** — the blocking inline script in `index.html` sets the `theme-color` meta tag alongside `data-theme` before first paint
2. **Runtime switch** — `applyThemeToDOM` in `ThemeProvider` sets `theme-color` to `theme.palette.background` when the user changes theme

Theme color is per-theme (derived from `palette.background`), not a fixed dark/light pair.

**Icon set**: Canonical mark at `app/frontend/public/icon.svg` (hexagonal cube, transparent). Generated variants in `app/frontend/public/generated-icons/`:
- `favicon.svg` — copy of `icon.svg` (transparent, used as browser favicon)
- `icon-192.png` — 192x192, solid `#0f1117` background, ~20% padding (homescreen icon)
- `icon-512.png` — 512x512, solid `#0f1117` background, ~20% padding (splash screen)
- `icon-512-maskable.png` — 512x512, solid `#0f1117` background, ~40% padding (maskable, safe zone for adaptive icon shapes)

Generated by `scripts/generate-icons.sh` (Node + sharp). Run via `just icons`.

**Standalone display mode**: When installed via "Add to Home Screen" (Android or iOS), the app runs without browser chrome (no address bar, no toolbar). The `display: "standalone"` manifest property and `apple-mobile-web-app-capable` meta tag enable this on their respective platforms.

### ThemeProvider Context

`app/frontend/src/contexts/theme-context.tsx` — split context (ThemeStateContext + ThemeActionsContext) following ChromeContext pattern. Provides `useTheme()` (preference + resolved + theme object) and `useThemeActions()` (setTheme, previewTheme, cancelPreview). Listens to `matchMedia("(prefers-color-scheme: dark)")` change events when preference is "system" for real-time OS theme tracking. On init: calls `getThemePreference()` from API, falls back to localStorage / `"system"` if API fails. `setTheme` writes localStorage immediately and calls `setThemePreference(id)` fire-and-forget. `applyThemeToDOM` computes CSS values via `deriveUIColors(theme.palette, theme.category)` and sets `theme-color` meta tag to `theme.palette.background`.

Provider order: `ThemeProvider > ChromeProvider > SessionProvider > AppShell`.

### xterm Terminal Theme

`terminal-client.tsx` uses `useTheme()` to get the active `Theme` object. Initial theme set at Terminal construction via `deriveXtermTheme(activeTheme.palette)` — all 22 colors (background, foreground, cursor, cursorAccent, selectionBackground, selectionForeground, and 16 named ANSI colors). Live updates via `xtermRef.current.options.theme = deriveXtermTheme(theme.palette)` in a `useEffect` — no terminal recreation needed. The `XTERM_THEMES` constant has been removed.

### Terminal Write Batching (Adaptive Flush + Deferred Reset)

Inbound relay WebSocket data in `terminal-client.tsx` flows through an **adaptive flush** (PR #244, with WebGL-renderer confirmation + context-loss survival in PR #245 — shipped outside the fab pipeline), replacing the original always-rAF coalescing from `260327-cnav-perf-frontend-rendering`:

- **Immediate path** — a chunk that is small (≤ `IMMEDIATE_WRITE_MAX_BYTES` = 64 **UTF-8 bytes**), arrives while **idle** (nothing buffered, no flush pending), and is the **first immediate write this frame** is written synchronously so a keystroke echo paints on the same tick (latency attribution showed the rAF tail dominated perceived input latency ~3:1 over the network hop; keystroke→echo went 40→10ms). The threshold is measured in UTF-8 bytes via `textByteLength` — `String.length` UTF-16 units would under-count multibyte input and weaken the flood guard; the helper only pays for a `TextEncoder` encode in the ambiguous middle band, keeping the tiny-ASCII hot path allocation-free. The one-immediate-write-per-frame guard is `wroteImmediatelyThisFrame`, set by `markImmediateWrite()` and cleared by a one-shot rAF — a program emitting one byte at a time still coalesces after its first byte of the frame.
- **Coalesced path** — everything else (large chunk, already buffering, or a second small chunk in the same frame) accumulates in buffers (string concatenation for text, `Uint8Array[]` for binary) and flushes once per `requestAnimationFrame` (`flushToTerminal`), batching floods (builds, log tailing, `cat largefile`) into one xterm render pass per frame.
- **Ordering guarantee** — terminal bytes are order-sensitive: the moment anything is buffered, every subsequent chunk buffers until the buffer drains; an immediate write only happens when the buffer is empty AND no flush is pending, so a synchronous write can never jump ahead of buffered bytes.
- **Close-time drain** — `ws.onclose` cancels pending rAFs and calls `flushToTerminal()` (try/catch for a disposed terminal) **before** the `cancelled` check, so a transient-drop reconnect within the same effect never loses tail data; `cancelAnimationFrame()` also runs on effect cleanup.

**Deferred per-connection reset** (`260610-qf25-defer-terminal-reset-flicker`): each `connect()` arms an effect-scoped `pendingReset` flag; `consumePendingReset()` (check + clear + `terminal.reset()`) runs **exactly once per connection, immediately before that connection's FIRST chunk write** — in the same tick on the immediate path, at the top of the same rAF callback (same frame) on the coalesced path — so clear + repaint land in **one presented frame**. The previous receipt-time reset in `ws.onmessage` guaranteed ≥1 fully-cleared frame whenever the first chunk took the coalesced path (a redraw is >64 bytes, so it always did): the wipe was synchronous but the repaint waited for the next animation frame. That cleared frame was the window-switch black-frame flicker. Post-change, the old content persists until the new redraw paints — strictly better perceptually on every reconnect path (sidebar click, tmux status-bar click, palette, board pane churn, transient-drop reconnects).

**Handoff semantics**: an **empty flush neither consumes nor executes a pending reset** — `flushToTerminal` early-returns when both buffers are empty, so a zero-message connection's close-time drain is a no-op (resetting with nothing to repaint would recreate the flicker); the next `connect()` simply re-arms, idempotently. Arming stays in `connect()` and nowhere earlier: within one effect, an old connection's close-time drain runs before the reconnect timer's `connect()` re-arms the flag, so a tail drain can never fire a reset armed for a different connection. The **effect cleanup additionally neutralizes the closure's pending write state** (`pendingReset = false; textBuffer = ""; binaryBuffers = []`): a dead connection's asynchronously-delivered `onclose` drain — which deliberately runs before the `cancelled` check so same-effect transient-drop tail drains keep working — can therefore neither reset the shared terminal nor write stale old-window content after a successor effect (e.g. a `windowId` change) has taken over. Reset-ordering unit tests live in `terminal-client.test.tsx` (no receipt-time reset; exactly once per connection; string + binary first chunks; re-armed on reconnect; zero-message close; post-consumption tail drain).

**Relay connection identity is (server, owning session), NOT windowId** (`260610-9umy-skip-same-session-reconnect` — the named follow-up from part 1, now implemented): the connect effect's deps are `[terminalReady, server, wsRef, connectionEpoch]` — `sessionName` and `windowId` are deliberately excluded (the `eslint-disable react-hooks/exhaustive-deps` comment explains why). A same-session windowId switch (sidebar click, palette, URL writeback after a tmux-status-bar click) **rides the existing socket**: tmux has already switched the active window in place (or will, via the REST `selectWindow` already fired by `navigateToWindow` and mount-time alignment in app.tsx) and the directly-attached PTY (since `260602-qn62`) redraws by itself — no WS + PTY + attach roundtrip, no `terminal.reset()`, and **xterm scrollback is preserved** across same-session switches (native `tmux attach` behavior). The relay URL still reads `windowIdRef.current`, so any genuine reconnect — session change, server change, transient drop — attaches to the latest window.

Identity is tracked by `connectedSessionRef` (session the live connection serves; `""` = resolved server-side only) + `connectedServerRef` + a `connectionEpoch` state bumped by a **session-identity watcher** effect on `[sessionName, server]`. The watcher is declared BEFORE the connect effect — ordering is load-bearing: on a same-commit server+session change it must read the PRE-change server from `connectedServerRef` (the connect effect overwrites it) to skip its bump, since the connect effect already re-runs via its own `server` dep — bumping too would tear down and reconnect twice. Watcher direction semantics:

- **`""` → resolved: absorption only** (record, never bump). On a cold deep-link the SSE-derived `sessionName` prop is `""` until the first snapshot; the client connects immediately by windowId and the relay resolves the owning session server-side (`ResolveWindowSession`) — by construction the live connection is already attached to that window's owning session, so the resolution transition costs no reconnect.
- **resolved → resolved: bump** — cross-session navigation, or a window moved to another session. A session RENAME also lands here and reconnects — accepted tradeoff: the SSE snapshot carries no stable session id to tell a rename from a genuine session change, renames are rare, and the deferred reset keeps any reconnect flicker-free.
- **resolved → `""`: LOSS-OF-IDENTITY signal** — record `""` AND bump for a probe reconnect. `sessionName` is derived by locating the URL's `@N` in the SSE snapshot, so it goes `""` and STAYS `""` when the viewed window left the snapshot: killed externally, pinned to a filtered `_rk-pin-*` session (pin transitions present as resolved → `""`, never resolved → resolved), or a dead deep link. The probe (by `windowIdRef.current`) either re-resolves the owning session server-side (an X → `""` → X ghost gap during navigation costs one flicker-free reconnect) or the relay closes 4004 → the `onSessionNotFound` redirect fires. This is the ONLY reachable recovery path in that state — `computeKillRedirect` and the URL writeback are both gated on a non-empty `sessionName` — so the bump is load-bearing (review finding M1, fixed in rework cycle 1: the original "treat `""` as inert in both directions" wedged the UI on kill-while-viewing).
- **`""` → `""`: no-op** (cold mount, still unresolved).

Part-1 deferred-reset and adaptive-flush semantics are unchanged on every connection that IS established (cross-session switch, server change, transient drop, probe reconnect). Connection-lifecycle unit tests live in the "TerminalClient connection identity" block of `terminal-client.test.tsx` (same-session switch keeps the socket; cross-session switch closes old + opens exactly one new with the deferred reset before its first write; `""` → resolved no-reconnect with later genuine change reconnecting; transient drop uses the latest windowId in the URL; server change reconnects exactly once — no watcher double-bump; resolved → `""` probe; 4004 recovery after an external kill).

## Component Conventions

- **All components are client-side** — pure React SPA, no Server Components. Data fetched via typed API client (`app/frontend/src/api/client.ts`) and SSE context
- **No loading spinners** — SSE keeps data fresh, the view renders with whatever data is available
- **Data fetching via context** — `SessionProvider` at layout level owns the `EventSource` connection and provides session data via `useSessions()` hook
- **SSE via `useSessions` hook** — thin wrapper over `SessionProvider` context. Single `EventSource` at layout level. SSE handler diffs incoming `e.data` JSON string against a `useRef<string>` before parsing — if identical, skips `setSessions()` entirely (eliminates ~90% of redundant re-renders). When data has changed, `setSessions()` is wrapped in `startTransition()` to keep user input responsive. Auto-reconnects via `EventSource` built-in. Server-side SSE uses a module-level goroutine hub that deduplicates polling across browser tabs
- **ChromeProvider context** (`app/frontend/src/contexts/chrome-context.tsx`) — split into state/dispatch contexts. Three hooks: `useChromeState()` (state only), `useChromeDispatch()` (dispatch only), `useChrome()` (convenience alias for both). Components that only read state (e.g., `AppShell`, `FixedWidthToggle`) use `useChromeState()` to avoid subscribing to dispatch identity changes. Manages current session:window selection, sidebar open/collapsed state, drawer state (mobile), `isConnected`, `fixedWidth`. Chrome derives content from the selection — no slot injection
- **SessionProvider context** (`app/frontend/src/contexts/session-context.tsx`) — layout-level provider owning the single `EventSource`. Session data consumed via `useSessions()` hook. Connection status forwarded to ChromeProvider internally.
- **Shared `Dialog` component** (`app/frontend/src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click. Used for create, kill, rename dialogs

## Create Session Dialog

The "Create session" dialog (breadcrumb `+ New Session` action, sidebar empty state button, or command palette) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/sahil87/run-kit` yields `run_kit`). Editable — auto-derivation is a convenience, not a lock. When the name field is left empty at submit time, the name is derived from the path automatically via `deriveNameFromPath()`. The Create button is enabled when either a name or a path is provided.

On submit, the dialog calls `createSession(server, name, cwd)` which sends `POST /api/sessions?server={server}` with `{ name, cwd }`. If the name field is empty but a path is set, the name is derived from the path's last segment (sanitized for tmux/byobu: hyphens→underscores, colons/periods replaced with underscores). Collision with existing session names is checked on the derived name and shows an error. The `cwd` field is omitted when no path is selected, preserving the original name-only behavior. Accessible from breadcrumb `+ New Session` dropdown action, sidebar empty state button, and command palette.

## Session-to-Project Mapping

Every tmux session is a project — derived from tmux, no config file needed. Project root derived from window 0's `pane_current_path`.

## Activity Status

Windows are `"active"` (last tmux activity within 10 seconds) or `"idle"`. No "exited" state.

## Zustand Window Store

Window optimistic state is managed by a Zustand store at `app/frontend/src/store/window-store.ts`. This is the single source of truth for what windows are visible and what their display names are during the period between a user action and its SSE confirmation.

**Store location**: `app/frontend/src/store/window-store.ts`

**Store shape:**

```ts
// Flat entry type (not WindowInfo & {...} — stores only the fields needed for display)
type WindowEntry = {
  session: string;
  windowId: string;
  index: number;
  name: string;
  pendingName?: string;    // non-undefined = optimistic rename, pending SSE confirmation
  killed: boolean;         // true = optimistically hidden, pending SSE confirmation
};

type GhostWindow = {
  optimisticId: string;    // client-generated unique key for React rendering / rollback
  session: string;
  name: string;
  createdAt: number;
  snapshotWindowIds: Set<string>; // windowIds present in session at creation time
};

type WindowStore = {
  entries: ReadonlyMap<string, WindowEntry>;  // keyed by windowId (@N)
  ghosts: GhostWindow[];
  // actions (the only ways to mutate window state):
  setWindowsForSession(session, incoming): void;
  addGhostWindow(session, name, currentWindowIds?: Iterable<string>): string;  // returns optimisticId
  removeGhost(optimisticId): void;
  killWindow(session, windowId): void;
  restoreWindow(session, windowId): void;
  renameWindow(session, windowId, newName): void;
  clearRename(session, windowId): void;
  clearSession(session): void;
};
```

**Key identifier**: `windowId` is the tmux `@N` value (e.g., `"@3"`). It is globally unique per tmux server, assigned at window creation, and never renumbered. It is used as the store key — not the mutable numeric index.

**`MergedWindow` type**: defined in and exported from `app/frontend/src/store/window-store.ts`. Includes `windowId: string` as a required non-optional field.

**Action surface (minimal by design)**:

| Action | Effect |
|--------|--------|
| `setWindowsForSession(session, incoming)` | SSE reconciliation — merges by `windowId`, preserves `killed`/`pendingName`, removes absent windows, reconciles ghosts |
| `addGhostWindow(session, name, currentWindowIds?)` | Creates a ghost entry; returns `optimisticId` for rollback |
| `removeGhost(optimisticId)` | Removes a ghost by ID (API failure rollback) |
| `killWindow(session, windowId)` | Sets `killed: true` |
| `restoreWindow(session, windowId)` | Sets `killed: false` (API failure rollback or always-settled cleanup) |
| `renameWindow(session, windowId, newName)` | Sets `pendingName` |
| `clearRename(session, windowId)` | Clears `pendingName` (settled or rollback) |
| `swapWindowOrder(session, srcIndex, dstIndex)` | Swaps index values of two entries (optimistic reorder); no-op if either missing |
| `clearSession(session)` | Removes all windows and ghosts for the session |

**SSE sync**: `AppShell` (in `app.tsx`) calls `setWindowsForSession(s.name, s.windows)` for each session in a `useEffect` on `rawSessions`. This keeps the store in sync with the SSE ground truth.

**Ghost reconciliation**: When `setWindowsForSession` is called, it computes `newIds = incomingIds − priorKnownIds`. For each ghost (oldest first) whose `snapshotWindowIds` does not contain any element of `newIds`, the ghost is removed. This set-difference approach is more reliable than count-based reconciliation — it handles concurrent creates/deletes without false positives.

**useMergedSessions**: `useMergedSessions` in `optimistic-context.tsx` derives window data from the Zustand store rather than from raw `session.windows`. For each session: filters `killed: true` entries, applies `pendingName ?? name` for display, sorts by `index`, then appends ghosts.

**Consumers use the store via `useWindowStore()` hook**:
```ts
const { killWindow, restoreWindow, renameWindow, clearRename, swapWindowOrder } = useWindowStore();
```

**Session/server state** (ghost sessions, ghost servers, session kill/rename) remains in `OptimisticContext` — these use name-based keys and are not subject to index-collision bugs.

## Optimistic UI & Mutation Feedback

All mutating API calls use the `useOptimisticAction` hook (`app/frontend/src/hooks/use-optimistic-action.ts`) which provides `{ execute, isPending }`. The hook calls `onOptimistic` synchronously before the async API call, tracks `isPending`, and calls `onRollback`/`onError` on failure and `onSettled` on success. An unmount guard (`mountedRef`) prevents state-after-unmount warnings.

**Callback contract** — four optional result callbacks with distinct mount-safety guarantees:

| Callback | Called on | Mount guard | Use for |
|----------|-----------|-------------|---------|
| `onAlwaysSettled` | success | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onAlwaysRollback` | failure | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onSettled` | success | behind `mountedRef` | Local component state updates |
| `onRollback` | failure | behind `mountedRef` | Local component state updates |

`onAlwaysSettled`/`onAlwaysRollback` MUST be safe to call after the initiating component unmounts — i.e., they may only interact with root-level stores/contexts like `OptimisticContext` or the Zustand window store (both always available for the lifetime of the app). Using local component state or `setState` in these callbacks will cause state-after-unmount warnings. Use `onSettled`/`onRollback` for anything that touches local component state.

`onError` is also behind the `mountedRef` guard (safe to call `addToast` — `ToastProvider` is root-level, but error display is only meaningful when the user can see it).

**Three feedback patterns:**

1. **Ghost entries** (CRUD operations): Creating a session/window/server immediately inserts a ghost entry with `opacity-50 animate-pulse` styling. SSE reconciliation auto-clears ghosts when real data arrives. Failure removes the ghost and shows an error toast. Kill operations immediately hide the entry; failure restores it. Rename operations immediately update the displayed name; failure reverts. **Window** ghost/kill/rename state is managed by the Zustand window store (`app/frontend/src/store/window-store.ts`); **session and server** ghost/kill/rename state remains in `OptimisticProvider` context (`app/frontend/src/contexts/optimistic-context.tsx`). Both feed into `useMergedSessions(realSessions, currentServer)` which filters session-level overlays by `currentServer` (so cross-server ghosts/kills/renames don't leak — see "Server Capture Convention" below) and merges with SSE data.

2. **Button loading states** (fire-and-forget): Split pane and close pane top-bar buttons show a spinner SVG (`animate-spin`) and `disabled` attribute during `isPending`. Command palette equivalents use the same hook for error toast feedback (palette closes, so spinner not visible).

3. **Inline progress** (async data): File upload shows an "Uploading..." badge in the terminal area. Directory autocomplete shows a spinner in the path input trailing slot. Server list refresh shows a spinner on the dropdown trigger.

**Error toast system**: `ToastProvider` + `Toast` component (`app/frontend/src/components/toast.tsx`). Fixed bottom-right, auto-dismiss after 4 seconds, stacked vertically. Error variant has `var(--color-ansi-1)` (red) left accent border; info variant uses `var(--color-ansi-4)` (blue). Theme-aware via CSS custom properties.

**Type guard**: `isGhostWindow(win)` exported from `optimistic-context.tsx` — narrows `WindowInfo | MergedWindow` to `MergedWindow & { optimistic: true }`. Used in sidebar and dashboard instead of `as` casts. `MergedWindow` type is defined in and exported from `app/frontend/src/store/window-store.ts`; it includes `windowId: string` as a required non-optional field.

### Window Kill: Zustand Store Handles Kill Cleanup

Window kill state is tracked in the Zustand window store by `windowId` (the immutable tmux `@N` identifier), not by mutable index. This eliminates the index-collision bug where killing window N would cause tmux's renumbering to suppress the next window at that index.

**Kill flow** (`useOptimisticAction` pattern):
- `onOptimistic`: calls `windowStore.killWindow(session, windowId)` — sets `killed: true` in the store
- `onAlwaysRollback` (API failure): calls `windowStore.restoreWindow(session, windowId)` — clears `killed`
- `onAlwaysSettled` (API success): calls `windowStore.restoreWindow(session, windowId)` — clears `killed` (SSE absence will remove the entry once tmux confirms)

When the next SSE update arrives without the `windowId`, `setWindowsForSession` removes the entry from the store entirely — regardless of whether `killed` is set. No explicit `confirmKill` action is needed.

**Three `useOptimisticAction` instances** use this pattern:

| Instance | File | Kill path |
|----------|------|-----------|
| `executeKillWindow` | `app/frontend/src/components/sidebar.tsx` | Ctrl+Click direct kill |
| `executeKillFromDialog` | `app/frontend/src/components/sidebar.tsx` | Confirmation dialog kill |
| `executeKillWindow` | `app/frontend/src/hooks/use-dialog-state.ts` | Command palette kill |

**Session kills are unaffected**: Session names are stable across kills (tmux never renumbers sessions). Session kill/restore remain in `OptimisticContext`.

### Cross-Session Move: Compound Optimistic Update

The `executeMoveToSession` hook in `sidebar/index.tsx` combines two store actions (`killWindow` + `addGhostWindow`) for a single optimistic update. This is the only `useOptimisticAction` instance that performs a compound optimistic mutation (hiding in one session while inserting a ghost in another). The ref-based `lastMoveToSessionRef` stores `{ srcSession, windowId, optimisticId }` so `onAlwaysRollback` can reverse both operations even after the component navigates away.

### Server Capture Convention (Optimistic Actions)

The `server` argument that scopes a mutation to a tmux server is **always captured at user-event time**, never read from an ambient module-level global, never frozen at component mount. This is enforced both by the API client signature (every server-scoped function takes `server: string` as its first arg — see `tmux-sessions.md` → "Frontend Server Routing Contract") and by the React handler shape on every call site.

#### The two compliant capture shapes

**Shape A — explicit capture inside `useCallback`**: read `server` from `useSessionContext()` at component scope, list it in the callback's deps array, and pass it as the first argument to the action when the user-event handler fires:

```tsx
const { server } = useSessionContext();
const handleRenameSession = useCallback(() => {
  if (!renameSessionName.trim() || !sessionName) return;
  executeRenameSession(server, sessionName, renameSessionName.trim());
  setShowRenameSessionDialog(false);
}, [renameSessionName, sessionName, server, executeRenameSession]);
```

**Shape B — `server` threaded through the `useOptimisticAction` argument tuple**: extend the tuple's first slot to `string` and forward it inside `action`. This is the standard shape for hooks like `executeRenameSession`, `executeKillFromDialog`, `executeMoveToSession`, etc.:

```tsx
const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
  action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
  onOptimistic: (srv, oldName, newName) => {
    lastRenameSessionRef.current = { server: srv, name: oldName };
    markRenamed("session", srv, oldName, newName);
  },
  onRollback: () => {
    const last = lastRenameSessionRef.current;
    if (last) unmarkRenamed(last.server, last.name);
  },
  ...
});
```

**Refs that bridge async callbacks** (e.g., `lastKillSessionRef`, `lastRenameSessionRef`, `killDialogServerRef`) snapshot `{ server, name }` together inside `onOptimistic`, so `onAlwaysRollback`/`onAlwaysSettled` can target the originating server even if the user has switched servers by the time the API resolves. Snapshotting the name without the server is a bug — rollback would invalidate the wrong server's overlay.

#### Optimistic overlays carry `server` (session-level)

`OptimisticContext` (`app/frontend/src/contexts/optimistic-context.tsx`) stores session-level entries with their originating `server` and filters by `(server, name)` at render time. The discriminated-union types reflect this:

```ts
type GhostEntry =
  | { optimisticId: string; type: "session"; name: string; server: string }
  | { optimisticId: string; type: "server"; name: string };

type KilledEntry =
  | { type: "session"; identifier: string; server: string }
  | { type: "server"; identifier: string };

type RenamedEntry = { type: "session"; identifier: string; newName: string; server: string };
```

API surface (session-level entries take `server` first; server-level entries are global):

| Method | Signature | Notes |
|--------|-----------|-------|
| `addGhostSession` | `(server, name) => optimisticId` | Session ghost |
| `addGhostServer` | `(name) => optimisticId` | Server ghost — global, no `server` arg |
| `markKilled("session", server, name)` | overload | Session kill |
| `markKilled("server", name)` | overload | Server kill — global |
| `unmarkKilled("session", server, name)` | overload | Mirror of `markKilled` |
| `unmarkKilled("server", name)` | overload | Mirror of `markKilled` |
| `markRenamed("session", server, name, newName)` | required `server` | |
| `unmarkRenamed(server, name)` | required `server` | |
| `useMergedSessions(real, currentServer)` | filter | Drops session-level overlays whose `server !== currentServer` |

`useMergedSessions` filters ghosts/kills/renames by `currentServer` before applying them. SSE reconciliation only inspects ghosts whose `server === currentServer` so the other server's pending state is left intact when the user switches servers and back.

**Window-store entries are NOT keyed by server** — windows cannot migrate across tmux servers (`MoveWindowToSession` operates within a single server, and there is no cross-server move API). The `windowId` (tmux `@N`) is unique per server, and `setWindowsForSession` is only ever called with data for the active server. Adding `server` to the window-store key would be defensive bookkeeping with no failure mode to defend against.

#### Why this convention exists

The pre-fix client kept `server` in a module-level closure (`_getServer`) wired to `serverRef.current`. The closure dereferenced live state at fetch time, so any switch between user intent and fetch dispatch silently retargeted the request — most commonly via Cmd+K's near-instant server switcher between opening a rename dialog and pressing Enter. The optimistic overlay made the bug invisible until SSE reconciled (~2–5 s later), which manifested as random renames/kills landing on the wrong server with a flicker on rollback.

#### General rule: don't introduce ambient state for request parameters

Any value that scopes an HTTP request to a particular backend resource (server, project, account, tenant) MUST be passed as an explicit argument to the API call, captured at user-event time. Module-level mutable getters, refs read at fetch time, or context reads inside the action callback (rather than the handler) all create the same closure-race shape that this change retired. If a value travels with a mutation, it travels in the call signature — period.

The regression test in `app/frontend/src/hooks/use-dialog-state.test.tsx` flips `SessionProvider`'s `server` prop between `openRenameSessionDialog("foo")` and `handleRenameSession()` and asserts the API call uses the post-flip server (`server-B`), proving the capture point is the handler invocation, not the dialog open.

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial UI patterns — three pages, keyboard-first, dark theme | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Unified top bar — shared breadcrumb + action bar, inline kill controls, command palette on terminal, always-visible search | `260303-vag8-unified-top-bar` |
| 2026-03-05 | Create Session dialog with folder picker — quick picks, server-side autocomplete, name auto-derivation | `260305-zkem-session-folder-picker` |
| 2026-03-06 | Chrome architecture — layout-owned skeleton, ChromeProvider context, TopBarChrome, icon breadcrumbs, always-visible kill buttons | `260305-emla-fixed-chrome-architecture` |
| 2026-03-06 | Bottom bar with modifier toggles, arrow keys, Fn dropdown, compose buffer, iOS keyboard support | `260305-fjh1-bottom-bar-compose-buffer` |
| 2026-03-06 | Performance: split ChromeContext (state/dispatch), layout-level SessionProvider, inline dashboard search, memoized shortcuts | `260306-0ahl-perf-sse-chrome-sessions` |
| 2026-03-07 | Rename window action (both pages), kill button label shortened to "Kill" | `260307-r3yv-action-buttons-rename-kill` |
| 2026-03-07 | iOS touch scroll fix — `touch-none` on terminal container, fullbleed class toggle for body overflow/overscroll prevention | `260307-8n60-fix-ios-terminal-touch-scroll` |
| 2026-03-07 | File upload: clipboard paste, drag-and-drop, file picker button, compose buffer path insertion, command palette action | `260307-kqio-image-upload-claude-terminal` |
| 2026-03-07 | iOS keyboard viewport overlap fix — scroll+resize listeners on visualViewport, fixed positioning for app-shell in fullbleed | `260307-f3o9-ios-keyboard-viewport-overlap` |
| 2026-03-07 | Active window sync — breadcrumb, URL, rename/kill targets follow byobu/tmux window switches via SSE + `history.replaceState` | `260307-f3li-sync-byobu-active-tab` |
| 2026-03-07 | Breadcrumb dropdown menus — chevron triggers for project/window switching, split click-target pattern | `260307-uzsa-navbar-breadcrumb-dropdowns` |
| 2026-03-07 | Mobile responsive polish — Line 2 collapse with ⋯ palette trigger, 44px touch targets via `coarse:` variant, responsive padding (px-3/px-6), terminal font scaling (11px/13px) | `260305-ol5d-mobile-responsive-polish` |
| 2026-05-31 | **Static xterm imports** — the six xterm-family value imports in `terminal-client.tsx` (`@xterm/xterm` `Terminal`, `addon-fit`, `addon-clipboard`, `addon-web-links`, `addon-unicode-graphemes`, `addon-webgl`) converted from per-pane-mount runtime `await import()` to static top-of-file `import` statements. Because the file is already router-lazy, the xterm family now bundles into the deferred terminal-route chunk and loads **once when that chunk loads**, instead of issuing up to `6×N` runtime chunk fetches when a board mounts N panes. This removes the chunk fetches from the browser's HTTP/1.1 ~6-per-origin connection budget at terminal-init time — the confirmed root cause of the board-route E2E hang (`boards-same-session-multi-pane`, `shell-rotation`): on the plaintext dev/test origin a 7th xterm chunk fetch hung pending behind the saturated long-lived streams (Vite HMR, SSE, per-pane relay WS), so `setTerminalReady(true)` never ran and the pane stayed blank. Masked in prod over Tailscale HTTPS (h2 multiplexes). The font-load `await Promise.all([...])` is now the only async boundary in `init()`; the inter-addon `cancelled` re-checks that guarded the removed import awaits were dropped, leaving one post-construction dispose guard. WebGL `new WebglAddon()`/`loadAddon` `try/catch` retained for GPU-context runtime failures (only the module load moved to static). CSS side-effect import + type-only refs unchanged. Implementation-only — no behavior change; `terminal-client.test.tsx` already mocked all six modules, so it passed unmodified. Second drafted fix (bounding desktop board-row relay WebSockets) remains out of scope. | `260531-m3pl-static-xterm-imports` |
| 2026-03-07 | Mobile cleanup — merged F-key/ext-key popups, moved upload to compose buffer, added keyboard dismiss button, breadcrumb icons as dropdown triggers | `260307-l9jj-mobile-bar-breadcrumb-cleanup` |
| 2026-03-10 | Go backend + Vite SPA split — removed Server Component patterns, all data fetching via API client + SSE context, TanStack Router for client-side routing, terminal WebSocket on same port (no relay port config) | `260310-8xaq-go-backend-vite-spa-split` |
| 2026-03-12 | Single-view UI model — sidebar + terminal replaces three-page navigation, POST-only API client with path-based intent, ChromeProvider derives from selection (no slot injection), fullbleed always on, no max-width constraint, sidebar with session/window tree and mobile drawer | `260312-ux92-vite-react-frontend` |
| 2026-03-12 | UI chrome refinements — simplified breadcrumbs (`☰ {logo} ❯ session ❯ window`, removed `⬡` and `›`), drag-resizable sidebar (default 220px, min 160, max 400, localStorage persist), bottom bar moved inside terminal column (`border-t border-border`, `py-1.5`), top bar `border-b border-border`, `[+ Session]` button in top bar line 2, sidebar footer removed, padding consistency (`px-3 sm:px-6` sidebar, `py-0.5 px-1` terminal container) | `260312-y4ci-ui-chrome-layout-refinements` |
| 2026-03-13 | Rich sidebar window status — activity dot ring for `isActiveWindow`, idle duration display, info popover (change, process, path, state), shared format helpers (`lib/format.ts`). Top bar Line 2 enriched with paneCommand, duration, fab change ID+slug. Backend: `paneCommand` + `activityTimestamp` from tmux, `.fab-runtime.yaml` reading for agent state | `260313-txna-rich-sidebar-window-status` |
| 2026-03-13 | xterm addon activation — ClipboardAddon (OSC 52), WebLinksAddon (clickable URLs), WebglAddon (GPU rendering with silent canvas fallback), Cmd+C selection-aware copy via `attachCustomKeyEventHandler` | `260313-dr60-xterm-clipboard-addons` |
| 2026-03-13 | Removed single-key shortcuts — deleted `useKeyboardNav` (j/k/Enter), `useAppShortcuts` (c/r/Esc Esc), sidebar focus ring (`focusedIndex`). Cmd+K command palette is now the sole keyboard shortcut. Palette actions no longer show shortcut hints for create/rename | `260313-3brm-remove-single-key-shortcuts` |
| 2026-03-13 | Remove top bar Line 2 — deleted action bar (+ Session, Rename, Kill, window status). FixedWidthToggle relocated to Line 1 (between connection indicator and ⌘K). BreadcrumbDropdown gains `action` prop for `+ New Session`/`+ New Window` as first dropdown item with divider. Sidebar empty state shows `+ New Session` button. Top bar is now single-line on all viewports | `260313-zvgc-remove-top-bar-line-2` |
| 2026-03-14 | Top bar & bottom bar refresh — hamburger icon replaces logo as sidebar toggle (animates ☰→✕), `/` separator replaces `❯`, session/window names are dropdown triggers (max 7ch session name). Top bar right: logo (decorative) + "Run Kit" + green dot (no text) + toggle + ⌘K + >_ compose. Mobile right: ⋯ + >_. Bottom bar: removed Cmd modifier and compose button, button sizes increased to 36px desktop / 44px touch | `260314-9raw-top-bar-bottom-bar-refresh` |
| 2026-03-15 | Dashboard view — `/` renders Dashboard component (session cards grid with expandable window cards, stats line, New Session/New Window buttons) instead of redirecting. Top bar shows "Dashboard" text on `/`, no breadcrumbs. Bottom bar hidden on Dashboard. Sidebar session name click navigates to first window (chevron toggles expand/collapse). All kill operations redirect to `/`. Stale URL detection redirects to `/` | `260313-ll1j-dashboard-project-page-views` |
| 2026-03-15 | Per-region scroll behavior — Dashboard split into pinned stats line (`shrink-0`) + scrollable card area (`flex-1 min-h-0 overflow-y-auto`). `useVisualViewport` hook now adds `fullbleed` class to `<html>` on mount (lifecycle management). Fullbleed activates `overflow: hidden` on html/body, preventing browser scrollbar on terminal pages | `260315-lnrb-dashboard-scroll-behavior` |
| 2026-03-17 | Default session name from folder — Create Session dialog derives name from path when name field is empty at submit time. Create button enabled when path is set (even without explicit name). Derived name collision checked with error display | `260317-qiza-default-session-name-from-folder` |
| 2026-03-17 | Fix xterm clipboard copy — `copyToClipboard` helper with `navigator.clipboard.writeText()` primary + `document.execCommand('copy')` fallback for non-secure HTTP contexts. Selection cleared via `.finally()`. Exported for testability | `260317-rpqx-xterm-copy-clipboard` |
| 2026-03-18 | Light theme support — three-mode theme system (system/light/dark), `data-theme` attribute on `<html>`, CSS custom properties per theme, blocking init script for no-flicker, ThemeProvider context (split pattern), xterm live theme update, command palette theme switcher, `--color-bg-inset` token replaces hardcoded fixed-width bg | `260318-eseg-add-light-theme-support` |
| 2026-03-18 | Inline tab rename — double-click window name in sidebar to edit inline (Enter/blur commits, Escape cancels, empty input cancels). Local state in Sidebar, no new dependencies. Existing command palette rename unchanged | `260318-dcl9-inline-tab-rename-double-click` |
| 2026-03-18 | Sidebar external session marker — `ProjectSession` type gains `server` field (`"runkit"` or `"default"`). Session rows show `↗` marker for default-server sessions (`text-[10px] text-text-secondary/50`, `aria-label="external session"`). Runkit-server sessions have no marker. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Multi-server terminal support — `TerminalClient` accepts `server` prop, WebSocket URL includes `?server=` param. "Reload tmux config" command palette action targets current session's server. `selectWindow` API call passes server for correct routing. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | PWA meta tags and theme-color sync — `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon` in `index.html`. Theme-color updated by blocking script (initial) and `applyTheme()` (runtime). Dark `#0f1117`, light `#f8f9fb`. Icon set in `public/icons/`. Standalone display mode. | `260320-j9a2-pwa-compliance` |
| 2026-03-20 | Single-active-server model — Sidebar server selector at bottom (`Server: <dropdown>`, pinned below scrollable session tree). Command palette: "Create tmux server" (name dialog), "Kill tmux server" (confirmation), "Switch tmux server: {name}" per server. Removed `↗` external session marker and `ProjectSession.server` field. `SessionProvider` manages `server`/`setServer`/`servers`/`refreshServers` state. Active server persisted in localStorage `runkit-server` (default: `runkit`). All API calls append `?server=` via `setServerGetter()` mechanism. SSE reconnects on server switch. Navigate to `/` on switch. | `260320-1335-tmux-server-switcher` |
| 2026-03-20 | UI polish + keyboard shortcuts — Breadcrumb left-aligned (removed `justify-center`). Sidebar server dropdown gains `+ tmux server` action. Hostname in bottom bar (hidden on mobile). Sidebar footer and bottom bar aligned at `h-[48px]`. Server label → "tmux server:". Consistent dropdown density (`text-sm py-2`). New "Keyboard Shortcuts" command palette action opens modal fetching `GET /api/keybindings` — shows curated tmux bindings grouped by table (root vs prefix), plus hardcoded `Cmd+K`. | `260320-9ldy-ui-polish-tmux-config-embed` |
| 2026-03-21 | Fix OSC 52 clipboard — custom `ClipboardProvider` for `ClipboardAddon` that accepts empty selection parameter (`""`) in addition to `"c"`. Fixes tmux copy-mode yank not reaching browser clipboard (tmux sends `]52;;base64`, addon default provider only accepted `]52;c;base64`). Provider exported as `clipboardProvider` for testability | `260321-zbdq-fix-osc52-clipboard-provider` |
| 2026-03-23 | ANSI palette theme rework — ThemePalette type (22 colors), deriveUIColors/deriveXtermTheme derivation layer, full xterm.js palette integration, tmux.conf ANSI colour indices (auto-theming via xterm.js), backend settings persistence (`~/.rk/settings.yaml`, `GET/PUT /api/settings/theme`), API + localStorage dual persistence in ThemeProvider, multi-color palette swatches in theme selector | `260323-7wys-ansi-palette-theme-rework` |
| 2026-03-25 | Per-mode theme preferences — `theme_dark`/`theme_light` settings stored alongside `theme` in `~/.rk/settings.yaml` and localStorage. System mode resolves to user's preferred dark/light theme instead of hard-coded defaults. Theme selection saves to matching per-mode slot (by category) and stays in system mode. API extended: GET returns all three fields, PUT accepts partial updates. | `260325-vxj6-per-mode-theme-preferences` |
| 2026-03-27 | Frontend rendering perf — SSE string diff + `startTransition` in SessionProvider (skips ~90% redundant re-renders), `useChromeState()` hook export (state-only consumers avoid merged object allocation), palette actions split into 7 independently memoized groups (session/window/view/theme/config/server/terminal), xterm.js write batching via `requestAnimationFrame` (coalesces WebSocket messages per frame) | `260327-cnav-perf-frontend-rendering` |
| 2026-03-27 | Mobile keyboard scroll-lock — long-press on keyboard toggle (>= 500ms) activates scroll-lock mode preventing soft keyboard from appearing on terminal tap. Focus prevention via capture-phase `focusin` listener. Tap-in-locked-mode unlocks + summons keyboard in one action. Visual indicator uses modifier armed-state pattern (`bg-accent/20 border-accent text-accent`, lock icon). Session-scoped state, optional haptic feedback | `260327-4azv-mobile-keyboard-scroll-lock` |
| 2026-03-28 | Tmux commands dialog — replaced direct clipboard copy with a dialog showing three tmux commands (attach, new-window, detach) with per-row copy buttons and checkmark feedback. Server-aware command generation includes `-L {server}` flag for named servers, omits it for `"default"` | `260328-6xey-tmux-commands-dialog` |
| 2026-04-03 | New pane inherits active pane CWD — `handleCreateWindow` passes `currentWindow?.worktreePath` to `createWindow()` so new windows start in the active pane's current directory (live via tmux `#{pane_current_path}`) instead of defaulting to `windows[0].WorktreePath`. No backend/API changes needed — `cwd` param already supported end-to-end. All three entry points (sidebar "+", top bar, Cmd+K) covered by single handler | `260403-xnq5-new-pane-inherit-cwd` |
| 2026-04-03 | Optimistic UI feedback — `useOptimisticAction` hook replacing all `.catch(() => {})` mutation patterns, `OptimisticProvider` context for ghost entries (create) and optimistic removal (kill) with SSE reconciliation, `ToastProvider` + `Toast` for error/info notifications (auto-dismiss 4s), button loading states (split/close pane spinners), inline progress (upload badge, directory autocomplete spinner, server refresh spinner), `isGhostWindow` type guard | `260403-32la-optimistic-ui-feedback` |
| 2026-04-04 | Window move & reorder — CmdK "Window: Move Left/Right" actions (boundary-excluded, navigate after swap), sidebar drag-and-drop window reordering via native HTML5 DnD (same-session only, accent drop indicator, no external library) | `260404-29qz-window-move-reorder` |
| 2026-04-04 | Cross-session window move — CmdK "Window: Move to {name}" actions (one per other session, flat list), cross-session drag-and-drop to session headers (accent border feedback), `moveWindowToSession` API client function, post-move navigation to `/$server` (server dashboard) | `260404-dq70-move-window-between-sessions` |
| 2026-04-04 | Fix sidebar kill hides extra window — `onSettled` callbacks added to all three `useOptimisticAction` kill instances (`executeKillWindow` in sidebar, `executeKillFromDialog` in sidebar, `executeKillWindow` in use-dialog-state) to call `unmarkKilled` after success, preventing tmux index-renumbering from causing index collision on next SSE update | `260404-dsq9-sidebar-kill-hides-extra-window` |
| 2026-04-05 | Fix left panel window sync — introduced `onAlwaysSettled`/`onAlwaysRollback` callbacks to `useOptimisticAction` that fire regardless of mount state (for root-level context cleanup like `unmarkKilled`), while `onSettled`/`onRollback` remain behind `mountedRef` guard (safe for local component state). Kill handlers in `sidebar.tsx` and `use-dialog-state.ts` migrated to `onAlways*`. E2E test `sidebar-window-sync.spec.ts` rewritten to be self-contained per test with unique window names and Scenario 3 using `page.route()` to intercept the kill API and exercise the unmount-before-response path. | `260405-2a2k-left-panel-window-sync` |
| 2026-04-05 | Session inline rename — double-click session name in sidebar to edit inline (mirrors window rename pattern). Enter/blur commits (non-empty, changed only), Escape cancels. Optimistic update via `markRenamed("session", ...)` with toast on error. Cross-cancel: starting a session edit cancels any active window edit and vice versa — only one inline edit active at a time. Dialog-based session rename in `app.tsx` unchanged | `260405-3mt2-session-inline-rename` |
| 2026-04-05 | Sidebar window state Zustand — window optimistic state migrated from index-based `OptimisticContext` to a Zustand store (`app/frontend/src/store/window-store.ts`) keyed by immutable `windowId` (`@N`). Eliminates index-collision bugs from tmux window renumbering. `WindowInfo` gains `windowId: string`. Backend adds `#{window_id}` to tmux format string. `OptimisticContext` slimmed to session/server scope only. `MergedWindow` moved to `window-store.ts`. `sidebar.tsx`, `app.tsx`, `use-dialog-state.ts` updated to use Zustand store actions. Ghost reconciliation uses snapshot `windowId` set-difference instead of count-based heuristics. | `260405-x3yt-sidebar-window-state-zustand` |
| 2026-04-06 | Shorten CWD in StatusPanel — `shortenPath()` in `status-panel.tsx` rewritten to substitute Linux `/home/<user>/` and macOS `/Users/<user>/` (and `/root`) with `~`, then truncate paths with >2 segments to `…/<last-two-segments>`. `title` attribute retains full unmodified path for hover tooltip. Unit tests updated/added in `status-panel.test.tsx`. | `260406-65f1-shorten-cwd-status-panel` |
| 2026-04-11 | Optimistic sidebar window reorder — drag-drop window reorder in sidebar now uses `useOptimisticAction` with `swapWindowOrder` store action to swap window index values immediately on drop. API call fires in background; rollback reverses the swap on failure. Eliminates ~2.5s SSE poll wait. `swapWindowOrder(session, srcIndex, dstIndex)` added to Zustand window store. Unit tests for store swap + rollback, sidebar tests for optimistic drop + API failure rollback. | `260411-sl01-optimistic-sidebar-window-reorder` |
| 2026-04-11 | Optimistic cross-session drag — `executeMoveToSession` `useOptimisticAction` instance in sidebar wires compound optimistic update: `killWindow` (hide in source) + `addGhostWindow` (show in target with source window's display name) + immediate navigation to `/$server`. Rollback: `restoreWindow` + `removeGhost`. Removed `onMoveWindowToSession` prop from `SidebarProps` — sidebar imports `moveWindowToSession` API directly. Drag data payload extended with `windowId` and `name`. Unit tests for optimistic lifecycle and rollback. | `260411-sl02-cross-session-drag-optimistic-update` |
| 2026-04-11 | Sidebar collapsible panels — `CollapsiblePanel` reusable component (header + chevron + `max-height` transition + localStorage persistence). `StatusPanel` refactored into `WindowPanel` wrapping content in CollapsiblePanel (`storageKey="runkit-panel-window"`). New `HostPanel` (5 lines: hostname+SSE dot, CPU braille sparkline, memory gauge bar, load percentages, disk+uptime) wrapping in CollapsiblePanel (`storageKey="runkit-panel-host"`). Both panels bottom-aligned in sidebar. Hostname removed from bottom bar. New `lib/sparkline.ts` (8-level braille mapping U+2800-U+28FF) and `lib/gauge.ts` (block gauge with green/yellow/red thresholds, byte formatting). `SessionProvider` extended with `metrics: MetricsSnapshot | null` from SSE `event: metrics`. | `260411-z63r-sidebar-host-window-panels` |
| 2026-04-12 | Pane panel copy interactions — `tmx`, `cwd`, `git`, `fab` rows in WindowPanel (`status-panel.tsx`) rendered as `<button>` elements with click-to-copy (pane ID, full path, branch, change ID). Inline "copied ✓" label feedback (1000ms, single `copiedRow` state). Hover affordance (`cursor: pointer` + `bg-bg-inset` tint). Keyboard accessible (Enter/Space). Text-selection guard (`window.getSelection()`). `copyToClipboard` extracted from `terminal-client.tsx` to `lib/clipboard.ts` shared utility module | `260412-lc2q-pane-panel-copy-cwd-branch` |
| 2026-04-16 | Session and window color tinting — ANSI-palette color assignment for sidebar rows with pre-blended `blendHex()` background tints at 12%/18%/22%. `SwatchPopover` component (13 ANSI swatches + Clear). Command palette "Session/Window: Set Color" actions. Hover indicator on sidebar rows. Activity dot changed from green/gray color-based to filled circle/hollow ring shape-based (always `text-text-secondary`). `RowTint` type and `computeRowTints()` in `themes.ts`. `PICKER_ANSI_INDICES` constant | `260416-jn4h-session-window-color-tinting` |
| 2026-04-16 | Iframe proxy windows — `IframeWindow` component (`iframe-window.tsx`) renders URL bar chrome + iframe for windows with `rkType === "iframe"`. Rendering branch in `app.tsx`: `currentWindow?.rkType === "iframe" && currentWindow?.rkUrl` renders `IframeWindow`, otherwise `TerminalClient`. URL bar: refresh button (↻), editable URL input (Enter submits via `updateWindowUrl` PUT API), submit indicator (⏎). SSE-driven URL sync via `useEffect` on `rkUrl` with `currentSrcRef` guard (no reload on identical data). `toProxySrc()` converts localhost URLs to `/proxy/{port}/...` paths. New "Window: New Iframe Window" command palette action (id `create-iframe-window`) opens dialog with name + URL inputs. Bottom bar hidden for iframe windows. | `260416-6b0h-iframe-proxy-windows` |
| 2026-04-18 | Server panel tile grid + resizable CollapsiblePanel — `ServerPanel` rewritten from vertical list to swatch-style tile grid (`repeat(auto-fill, minmax(72px, 1fr))` desktop, single-row horizontal scroll with `scroll-snap-type` on `pointer: coarse` / `<640px`). Tiles: 4px ANSI-tinted top stripe + 11px truncated name + 10px "N sess" meta. Active tile: `aria-current` + inset accent ring + `rowTints.get(color).selected` body tint. Hover-revealed color-picker and kill buttons rendered as siblings to the tile `<button>` (avoids nested-button HTML) with `group-hover:flex`; hidden on coarse pointer. Scrolls internally when tile grid overflows the user-set height. `CollapsiblePanel` gained opt-in `resizable`, `defaultHeight`, `minHeight`, `maxHeight`, `mobileHeight` props: 6px `ns-resize` drag handle persisted to `localStorage[${storageKey}-height]`, height clamping, `calc(100vh - Npx)` maxHeight parsing, mobile drag-handle hide. Window/Host panels unchanged (opt-in preserves legacy behaviour). `/api/servers` now returns `{name, sessionCount}[]` per architecture.md. | `260417-jpkl-server-panel-tile-grid` |
| 2026-04-18 | Right-align server name in ServerPanel header — `ServerPanel` title changed from dynamic `Tmux · {server}` to static `"Server"` (matches WindowPanel/HostPanel convention). Active server name moved into `headerRight` slot with `truncate text-text-primary font-mono` classes (mirrors `host-panel.tsx`); `LogoSpinner` follows the name when `refreshing`. Left-side chevron and title are now visually fixed across server switches — only the right-slot text updates. Playwright spec `server-panel-grid.spec.ts` and its companion `.spec.md` updated to match the new `name: /^Server/` accessible name and `Resize Server panel` separator label. No new patterns introduced — aligns with existing sidebar panel header convention. | `260418-2cjc-right-align-server-name` |
| 2026-04-18 | xterm Unicode 15 grapheme widths — added `@xterm/addon-unicode-graphemes` to the Terminal init chain (loads after WebLinks, before WebGL), set `allowProposedApi: true` on the Terminal constructor, and assigned `terminal.unicode.activeVersion = "15-graphemes"` after `loadAddon()`. Aligns xterm's cell-width measurements with tmux's wcwidth-based layout so emojis and other wide graphemes (ZWJ sequences, flag/skin-tone modifiers) render without ghost/overlap artifacts. The `unicodeVersion` constructor option remains a no-op past `"6"` without the addon. | `260418-xgl2-xterm-emoji-width` |
| 2026-04-18 | Server-capture-at-trigger convention for optimistic actions — every `useOptimisticAction` instance for a server-scoped mutation now threads `server: string` as the first slot of its argument tuple (Shape B), with `server` read from `useSessionContext()` and listed in the calling handler's `useCallback` deps (Shape A). Async-bridge refs (`lastKillSessionRef`, `lastRenameSessionRef`, `killDialogServerRef`) snapshot `{ server, name }` together so rollback/settle target the originating server. `OptimisticContext` switched session-level `GhostEntry`/`KilledEntry`/`RenamedEntry` to discriminated unions carrying `server`; `markKilled`/`unmarkKilled` overloaded by `type` ("session" requires `server`, "server" is global); `useMergedSessions(real, currentServer)` now filters session-level overlays so cross-server overlays don't leak. Window-store keying unchanged — windows don't migrate across servers. Establishes the rule: ambient module-level state for request parameters is prohibited; request-scoping values travel in the call signature, captured at user-event time. Regression test in `use-dialog-state.test.tsx` flips `SessionProvider.server` between dialog open and submit. | `260418-yadg-fix-mutation-server-race` |
| 2026-04-19 | Sidebar separator cursor polish + corner resize affordance — horizontal separator cursor changed from `cursor-ns-resize` to `cursor-row-resize` (matches vertical's `cursor-col-resize` double-arrow-with-bar vocabulary); vertical hover fixed from `/40` opacity to full `hover:bg-text-secondary`. Both drag handlers now write `document.body.style.cursor` on pointerdown/start and clear to `""` on pointerup/end — document-level override survives the pointer leaving the thin handle (solves implicit-pointer-capture hover loss after first drag). `CollapsiblePanel` unmount cleanup also clears body cursor. New optional corner affordance at separator intersection: `CollapsiblePanel` gains `onCornerPointerDown` prop; when supplied + `showDragHandle` is true, renders a `w-[7px] h-[3px] cursor-nwse-resize` corner flush against the handle's right edge. Corner pointerdown invokes horizontal then vertical handlers, then overrides cursor to `nwse-resize` (last-write-wins). Handlers coexist without coordination because they use independent document listeners (clientY-only vs clientX-only). Prop threaded `app.tsx` → `Sidebar` (`onSidebarResizeStart`) → `ServerPanel` → `CollapsiblePanel` (`onCornerPointerDown`); all optional, mobile drawer omits it. | `260419-9ufu-sidebar-separator-cursor-fixes` |
| 2026-05-09 | **Rotated shell layout** — Shared `<Shell>` CSS Grid wrapper (`app/frontend/src/components/shell/shell.tsx`) used by AppShell and BoardPage; desktop topology `"sidebar topbar" / "sidebar content" / "sidebar bottombar"`, sidebar full-height. Sidebar collapses to 0px (no rail) with `grid-template-columns 150ms ease-out`; drag-resize handle hidden when collapsed. Hamburger statically at TopBar.left; visual relocation on collapse is a side effect of column collapse. `Cmd+\` / `Ctrl+\` toggles sidebar from any Shell-bearing route (registered in KeyboardShortcuts modal); chord suppressed on real text inputs but NOT on xterm helper textareas. Mobile (< 640px) collapses to single-column grid; sidebar renders as `position: absolute` overlay positioned via `gridRow: "2/4"` (below topbar, matches project convention) with `role="dialog" aria-modal="true"`. Sidebar section order is **Boards → Servers → Sessions** (was Servers → Boards → Sessions); BoardsSection is always visible with `Pin a window to start a board` hint when empty (was hidden when empty). New `FocusedTerminalContext` (`app/frontend/src/contexts/focused-terminal-context.tsx`) tracks focused terminal across routes; mounts in `RootWrapper`; producers are `TerminalClient` (registers via `registerFocus` prop) and `BoardPane` (registers on focus events, doesn't clear on focus loss). Compose state (`composeOpen`/`setComposeOpen`) lifted to the same context so the shell-level BottomBar can open compose for the focused pane on the board route; focused pane gates `<ComposeBuffer>` rendering on `isFocused && composeOpen`. BottomBar moves up to `<Shell>`'s `bottombar` grid area — rendered once per route by AppShell and BoardPage (board route gets a BottomBar for the first time). `BottomBar.wsRef` prop removed; reads `focused?.wsRef` from context. `TopBar` accepts `mode: "terminal" | "board" | "root"` prop; board mode renders breadcrumb + inline-info `{N} pane[s] · {M} server[s] · ⌘[⌘] cycle` (hidden on `< 640px`). FixedWidthToggle lifted out of the `currentWindow &&` block — now route-agnostic. `ChromeContext` shape: `sidebarOpen`/`sidebarWidth` lifted from per-route state; `drawerOpen`/`setDrawerOpen` removed. New `setSidebarWidth` (in-memory) + `persistSidebarWidth` (localStorage at drag-end) split. BoardPage's bespoke `h-screen w-screen flex` root and inline mini-header are gone; BoardSwitcherDropdown moves into TopBar board-mode rendering. Three pattern captures: shared chrome wrapper for related routes (`<Shell>`), lift focused-input target to context, two-setter pair for in-memory + persisted state. | `260509-17m3-rotated-shell-layout` |
| 2026-05-07 | Pane boards UX — new § Boards View covers `/board/$name` self-contained mini-layout (own sidebar + topbar + main pane area + own `<CommandPalette>` mount; not under AppShell because boards span servers). Pane cards: 480px default, drag-resize 280px–viewport-minus-sidebar, widths persisted per-board to `localStorage["runkit:board-widths:<name>"]`. Click-to-focus + `Cmd+]/Cmd+[` cycle (hover-to-focus OFF in v1). Mobile (< 640px): single-pane swipe carousel with off-screen pause via `TerminalClient` unmount + pagination dots. Sidebar gains `BoardsSection` above Sessions (hidden when zero boards, hint mode when on a now-empty board route), pin icon + `PinPopover` on `WindowRow` (filled state when pinned to ANY board), and active-board accent border on rows pinned to the current board. New `boardActions` `PaletteAction[]` block in `app.tsx`: `Switch to <name>` (one per board, `(current)` on active), `Pin Current Window` (window-route-gated, dispatches `pin-popover:open`), `Unpin Current Window` (unpins from all boards), `Leave Board View`, `Cycle Pane Focus →/←` (board-route-gated). Reorder Pane palette action deferred to v1.1; right-click context menu not implemented (use sidebar pin icon, command palette, or board pane header). Hooks: `useBoards`, `useBoardEntries`, `usePinActions`, `usePaneWidths`, `useIsMobile`, `useActiveBoardName`, `useWindowPins`. | `260507-4vuv-pane-boards` |
| 2026-05-28 | URL as resumable bookmark; tmux is the truth for current window. New § URL as Resumable Bookmark documents the post-change model: tmux drives selection; the URL is consulted on mount only and rewritten by an SSE-driven `navigate({ replace: true })` whenever `currentSession.windows.find(w => w.isActiveWindow).index` differs from `windowIndex`. Mount-time alignment in `app.tsx` fires exactly one `selectWindow(server, session, Number(urlWindow))` per session-route mount, guarded by `hasAlignedToUrlRef: useRef(false)` plus `lastAlignedSessionRef` (resets the guard when `${server}|${sessionName}` changes). `navigateToWindow(session, windowIdx)` simplified to call `selectWindow` only — no `navigate` at click time; URL follows on the next SSE snapshot (typically sub-500ms via the new tmuxctl control-mode subscription). The 3-second `userNavTimestampRef` / `elapsed < 3000` debounce was deleted entirely (it was protecting client-owned selection state that no longer exists). `dialogOpenRef` retained so the URL writeback effect skips navigation mid-dialog (prevents focus-stealing re-renders). `WindowRow.isSelected` derives from `(!ghost && win.isActiveWindow) || currentWindowIndex === String(win.index)` — primary driver is the server-reported `isActiveWindow`; URL fallback covers ghost windows mid-creation and the initial render before the first SSE payload. Multi-client convergence: same-server tabs yank to the new window via the writeback effect; board-route tabs do NOT navigate; different-server tabs are independent. Stale-URL deep-link tabs yank existing tabs as a deliberate side effect of mount-time alignment. Supersedes the 2026-03-07 `history.replaceState` + SSE-polling sync model. | `260528-nvlp-active-window-sync` |
| 2026-05-29 | **Window-ID routing** — URL window segment migrated from mutable tmux window *index* to the stable window ID (`@N`): route is now `/$server/$session/$windowId` (`$session` is display-only; router percent-encodes `@` → `%402`). Mount-time alignment and URL writeback compare `activeWindow.windowId` vs the URL `@N` (was `String(index)` vs `windowIndex`) — eliminates the index-shift phantom-navigation race; `selectWindow(server, windowId)` drops the session arg. `WindowRow.isSelected` is now `hasUrlWindow ? currentWindowId === win.windowId : (!ghost && win.isActiveWindow)` (URL window ID primary when present, `isActiveWindow` fallback otherwise — inverts the prior isActiveWindow-primary/URL-fallback ordering, since the URL is now itself written back from `isActiveWindow`). Top-bar "current" detection and breadcrumb hrefs compare/build `windowId`; window/iframe-URL/split/close-pane/rename actions call client fns by `windowId` (`/api/windows/{windowId}/...`). Window-move palette actions navigate back to the same `windowId` (preserved across reorder). Nearest-window-after-kill picks a list-position neighbor and targets its `windowId` (no index-distance arithmetic). Old index-based bookmarked URLs are a hard break (no redirect). Sidebar drag-reorder optimistic action calls `moveWindow(server, srcWindowId, dstIndex)`. | `260529-chgz-window-id-routing` |
| 2026-05-31 | **Bounded desktop relay WebSockets** — new § Desktop Relay-Connection Suspension. On plaintext origins (`window.location.protocol === "http:"`) `DesktopRow` drives each `BoardPane`'s `paused` prop from an `IntersectionObserver` rooted on `rowRef` (was hardcoded `paused={false}`), unmounting off-screen panes' `TerminalClient` so the `/relay/<wid>` WebSocket closes and the connection slot frees — the desktop analogue of the mobile carousel's `paused={idx !== carouselIndex}`. Pre-warm `RELAY_PREWARM_ROOT_MARGIN` (one pane-width horizontal `rootMargin`, no debounce) prevents scroll-past thrash. Live panes capped at `MAX_LIVE_RELAY_PANES = 4` via the pure `selectLivePanes` helper (`select-live-panes.ts`, colocated unit tests): focused pane always live (exempt from visibility-pause and the cap, preserving `Cmd+]`/`Cmd+[` cycling + BottomBar targeting), then most-recently-focused visible panes fill remaining slots, least-recently-focused paused first beyond the cap. Pane elements observed via a `data-paneIndex` + `rootRef` callback prop on `BoardPane`, distinct from the `paneRefs` imperative `BoardPaneHandle`. On HTTPS/h2 (production via Tailscale) the feature is OFF — every pane stays live, no observer, no cap — because the ~6-connection ceiling is a plaintext HTTP/1.1 artifact (h2 multiplexes; relay WS limit ~255). Composes with sibling `260531-m3pl-static-xterm-imports` (removes xterm chunk-fetch pressure): together they fit the board route under 6 connections, fixing the plaintext board-route E2E hang. `MobileCarousel` untouched. E2E `boards-desktop-suspend.spec.ts` + companion `.spec.md`. | `260531-rus8-bound-desktop-relay-websockets` |
| 2026-05-30 | **`$session` dropped from the route + identity keyed on `@N` alone.** Route shape `/$server/$session/$window` → `/$server/$window` (TanStack `terminalRoute.path: "/$window"`; `parseParams` exposes only `window`). The owning session name is now **derived from the active window's SSE snapshot** (`currentSession = sessions.find(s => s.windows.some(w => w.windowId === windowParam))`, `sessionName = currentSession?.name`) wherever it was previously read from the URL `$session` segment — breadcrumbs, dropdowns, browser title, kill-redirect inputs. `pendingClickRef` holds `{ windowId }` only (dropped `session`) and `urlMatchesPending` is `pending.windowId === windowParam` — so a session rename or cross-session move (where `@N` survives) no longer releases the pending-click suppression early and bounces the selection. Mount-time alignment guard keyed on `${server}|${windowParam}` (window-id-only); URL writeback navigates `{ to: "/$server/$window", params: { server, window } }` (no session param); `navigateToWindow(windowId)` drops the session arg. All `app.tsx` navigate sites target the 2-segment shape. Deep link `/$server/@N` derives the session server-side from the first snapshot for breadcrumb display and aligns tmux to `@N`. Old 3-segment `/$server/$session/$window` URLs are a hard break — they fall through to `NotFoundPage` / the server-dashboard fallback (no redirect shim; constitution §II). The `IframeWindow` URL bar's `updateWindowUrl` now routes through the unified `setWindowOptions` → `POST /api/windows/{windowId}/options` (`{"@rk_url": url}`) instead of the removed `PUT /url`; `setWindowColor`/`updateWindowType` likewise delegate to `/options`. E2E specs migrated to the 2-segment shape with sibling `.spec.md` updates (`sidebar-window-sync`, `multi-server-sidebar`, `mobile-touch-scroll`). | `260529-jad6-window-api-stability` |
| 2026-06-02 | **Fix non-current sidebar group expand (StrictMode purity)** — `toggleServerSection` made pure: the `localStorage.setItem` write to `runkit-panel-sessions-{server}` and the lazy `attachServer(server)` call moved OUT of the `setServerSectionsOpen` updater. Root cause: React 19 StrictMode double-invokes updaters, and the in-updater `localStorage` write was observed by the second pass (which re-read it via `readServerOpen`), inverting `next` and making a single Expand click on a non-current group a no-op (the group never opened — `multi-server-sidebar.spec.ts:70` failed deterministically). Fix snapshots `current = readServerOpen(server)` once, computes `next`, runs side-effects once outside the updater, then commits a pure functional update deriving `next` from `prev` (fallback to the `current` snapshot for untouched groups) for batch-safety. StrictMode-wrapped click-toggle regression test added in `index.test.tsx`. No backend change; existing coupling/persistence behavior preserved. | `260602-mss7-fix-sidebar-group-expand` |
| 2026-06-02 | **Move-based boards — SESSIONS-vs-BOARDS exclusivity.** New § SESSIONS-vs-BOARDS exclusivity: pinning a window physically MOVES it (`tmux move-window`) into its own `_rk-pin-*` pin-session, so it disappears from its home session's window list in the SESSIONS sidebar until unpinned (which moves it back to `@rk_home`, appending at the next index). "Already true" for the sidebar with no frontend work — the SSE snapshot no longer lists the moved window under its home session (pin-sessions filtered at the `parseSessions` chokepoint). Board pane rendering is UNCHANGED: each `BoardPane` still embeds the same `TerminalClient` on `/relay/{windowId}?server=<entry.server>`, and the relay now resolves `windowId` to the pin-session server-side (transparent — `BoardEntry` shape + `board-pane.tsx`/`board-page.tsx` structure untouched). `boards.ts`/`use-boards.ts` doc comments updated from "boards are explicitly cross-server" to server-scoped derivation (pins live on one server; the board LIST is summarized across servers, so `useBoards`/`useBoardEntries` still attach all known servers for `board-changed` events). Frontend-only doc/contract change; pin icon + active-board accent affordances on SESSIONS rows are unchanged. | `260602-qn62-move-based-board-pin-sessions` |
| 2026-06-10 | **Live PR status line in sidebar + dashboard.** New § PR Status Line documents the shared `PrStatusLine({ win })` component (`src/components/pr-status-line.tsx`) reused by the sidebar `WindowRow` and dashboard window cards. Renders `PR #<n> <glyph> <state>[ (draft)] · <checks/review summary>` ONLY under the change-bound gate `fabChange && prNumber` (early-returns null otherwise — the display mirror of the backend's attach gate). `PR #<n>` is an `<a href={prUrl} target="_blank">` with `onClick` stopPropagation (opens the PR, doesn't select the window); clicking the rest of the line triggers best-effort `refreshPrStatus()` (`POST /api/pr-status/refresh`, errors swallowed, refreshed status arrives via SSE). Color tokens: `text-text-secondary` default, `text-red-400` when fail-ish (`prChecks === "fail" || prReview === "changes_requested"`) — established convention, no new hex; link hover `hover:text-text-primary hover:underline`; `coarse:py-1` touch target. State glyphs `merged`→`✓`/`closed`→`✗`/else `●`. Sidebar places it below the name/`fabStage` row (`pl-[18px] pr-11`, non-ghost); dashboard under the fab-stage badge (`px-2 pb-2 -mt-1`, non-ghost). Dashboard window card refactored from a `<button>` root to an outer `<div>` wrapping the `<button>` so the PR `<a>` link sits OUTSIDE the button (valid HTML — no `<a>`-in-`<button>`); sidebar likewise renders the line outside the row `<button>`. `WindowInfo` (`src/types.ts`) gains six PR fields (`prUrl?`, `prNumber?`, `prState?`, `prChecks?`, `prReview?`, `prIsDraft?` with literal-union types); new `refreshPrStatus()` client wrapper. Tests: `pr-status-line.test.tsx`, `window-row.test.tsx` (gate + `prUrl` link), Playwright `pr-status-sidebar.spec.ts` + sibling `.spec.md` (PR line for change-bound window, absent for scratch, 375px + 1024px). | `260610-596o-pr-status-sidebar` |
| 2026-06-10 | **PR status moved to the Pane panel; removed from the sidebar tree.** Reworked § PR Status: the primary PR surface is now a copyable `pr` row in `WindowPanel` (`status-panel.tsx`), appended after `fab` in the `tmx/cwd/git/run/agt/fab` idiom — gated change-bound, copies the PR URL on click, `text-red-400` when checks fail / changes requested, Nerd Font git-pull-request icon. The Pane panel reflects the *selected* window (URL `/$server/$window`), so it's per-window detail rather than a tree-wide glance. `PrStatusLine` was REMOVED from `window-row.tsx` (the sidebar tree no longer shows PR status) but KEPT on the dashboard window cards (the dashboard route has no Pane panel). `window-row.test.tsx` updated to assert the row is absent; new `status-panel.test.tsx` `pr row` describe block (renders/gated/copies-URL/red-on-fail); `pr-status-sidebar.spec.ts` + `.spec.md` rewritten to select a window and assert the Pane panel `pr` row (mobile + desktop). Composes with the PR #241 review fixes (open-only state, no `role="button"` on the dashboard line). | `260610-obky-pr-status-to-pane-panel` |
| 2026-06-10 | **Deferred terminal reset — window-switch flicker fix.** Reworked § Terminal Write Batching: now documents the adaptive flush (immediate synchronous path for ≤64-UTF-8-byte idle chunks, one per frame via `wroteImmediatelyThisFrame`; rAF coalescing under load; once-buffering-always-buffer ordering — PR #244/#245, shipped outside fab) plus the NEW per-connection deferred reset: each `connect()` arms an effect-scoped `pendingReset`, consumed exactly once by `consumePendingReset()` immediately before the connection's first chunk write (same tick on the immediate path / top of the same rAF callback on the coalesced path) so clear + repaint land in one presented frame — the old receipt-time `terminal.reset()` in `ws.onmessage` guaranteed ≥1 fully-cleared frame (the window-switch black-frame flicker) because the >64-byte first redraw chunk always coalesced to the next frame; old content now persists until the new redraw paints. Handoff semantics: empty flush neither consumes nor executes the pending reset (zero-message close-drain no-op; next `connect()` re-arms idempotently); effect cleanup neutralizes `pendingReset`/`textBuffer`/`binaryBuffers` so a dead connection's late-delivered onclose drain (which still runs before the `cancelled` check, keeping same-effect transient-drop tail drains working) can neither reset nor write stale content into a successor effect's terminal. Stale WS-effect comment (260508-hdjr ephemeral-grouped-session rationale) rewritten to the move-based direct-attach model (`260602-qn62`); same-session reconnects noted as redundant, with a named follow-up to key the effect teardown on the resolved owning session instead of `windowId`. Adaptive-flush machinery untouched (thresholds, `textByteLength`, frame guard, ordering). Reset-ordering unit tests added to `terminal-client.test.tsx`. Frontend-only. | `260610-qf25-defer-terminal-reset-flicker` |
| 2026-06-10 | **Same-session relay reconnect eliminated — connection identity keyed on (server, owning session), part 2.** Reworked § Terminal Write Batching's closing paragraph: part 1's "named follow-up" is now implemented. The connect effect's deps changed from `[terminalReady, sessionName, windowId, server, wsRef]` to `[terminalReady, server, wsRef, connectionEpoch]`; same-session windowId switches ride the existing socket (the relay URL reads `windowIdRef.current`; xterm scrollback preserved — native tmux-attach behavior, since the directly-attached PTY redraws in place via the REST `selectWindow` paths already in app.tsx). New session-identity watcher on `[sessionName, server]`, declared BEFORE the connect effect (must read the pre-change server from `connectedServerRef` to skip its bump on a same-commit server+session change — the `server` dep already reconnects; bumping too would double-reconnect): `""`→resolved is absorption-only (cold deep-link — the relay already attached to the owning session server-side, no reconnect); resolved→resolved bumps `connectionEpoch` (cross-session nav, window move; session RENAME also reconnects — accepted tradeoff, no stable session id in the SSE snapshot); resolved→`""` is a LOSS-OF-IDENTITY signal that records `""` AND bumps for a probe reconnect — the window left the snapshot (killed externally, pinned to a filtered `_rk-pin-*` session, dead deep link) and the probe either re-resolves server-side (X→`""`→X ghost gap costs one flicker-free reconnect) or closes 4004 → `onSessionNotFound` redirect — the ONLY reachable recovery path in that state (`computeKillRedirect` and the URL writeback are gated on non-empty `sessionName`; review finding M1, fixed in rework cycle 1); `""`→`""` is a no-op. Part-1 deferred-reset + adaptive-flush semantics unchanged on every connection that IS established. New "TerminalClient connection identity" unit tests in `terminal-client.test.tsx`; part-1 teardown test re-triggered via a cross-session change (spec-conformant per constitution § Test Integrity). Frontend-only — `terminal-client.tsx` + its test file. | `260610-9umy-skip-same-session-reconnect` |
| 2026-06-13 | **Mobile drawer accessibility — focus trap + Escape + current-row focus.** Reworked § Sidebar → Mobile: the overlay's `role="dialog" aria-modal="true"` contract is now honored. New shared `useFocusTrap(containerRef, active, onEscape)` hook (`app/frontend/src/hooks/use-focus-trap.ts`, extracted from the `dialog.tsx`/`command-palette.tsx` focus-cycle; adopted by the drawer only — refactoring those modals is a follow-up Non-Goal). `Shell` attaches a `drawerRef` to the `<aside>` and drives the hook with `active = isMobile && sidebarOpen && !!sidebarChildren` (desktop sidebar is a grid region, NEVER trapped), wiring Escape → `setSidebarOpen(false)` (additive to backdrop/destination/hamburger dismissals). On activation focuses the first focusable; Tab/Shift+Tab wrap within the `<aside>` (`preventDefault` only at boundaries); listener attaches on `document` only while active; `onEscapeRef` stable-ref; no focus-return on close (matches `Dialog`/`CommandPalette`). R10 nested-modal deference: `hasNestedDialog(container)` detects a `[role="dialog"][aria-modal="true"]` DESCENDANT (`KillDialog`→`Dialog`) and the trap's `handleKeyDown` early-returns before Escape AND Tab, so one Escape dismisses only the topmost modal and the drawer-wide Tab wrap can't pull focus out of it; the `<aside>`'s own `role="dialog"` is excluded (`querySelector` descendants-only + `!== container` guard). The `aria-modal="true"` qualifier is load-bearing (PR review): non-modal `PinPopover` (`role="dialog"`, no `aria-modal`, no own trap) must NOT disable the drawer wrap. Capture-phase `stopPropagation` listeners (`PinPopover`/`SwatchPopover`) suppress the bubble-phase trap Escape, so no collision there. Bonus (§ Window rows): `Sidebar` attaches `navRef` to `<nav aria-label="Sessions">`; on mobile drawer open a `useEffect` queries `[data-window-id] [aria-current="page"]`, `scrollIntoView({ block: "nearest" })` + `focus()`es it (deferred via `requestAnimationFrame` to supersede the trap's first-focus), scoped to WINDOW rows so the active `BoardsSection` row (also `aria-current="page"`, no `[data-window-id]` ancestor) and board routes no-op. Frontend-only; no new dependencies. Tests: `use-focus-trap.test.tsx`, extended `shell.test.tsx`, `sidebar/index.test.tsx` current-row case. | `260613-o20f-sidebar-drawer-a11y` |
| 2026-06-12 | **Quiet parked rows + inert hover-icon cluster.** Reworked § Window rows: stage text in the right cluster now renders only when `win.fabDisplayState !== "done"` — a parked finished change (fab pane map `display_state === "done"`) shows duration only (empty right cluster when duration is also absent — intended, no placeholder); any other/unknown/absent value keeps the stage text (backward/forward compatible with fab < 2.1.7). The field plumbs `fab pane map`'s `display_state` (fab ≥ 2.1.7): `paneMapEntry.DisplayState *string` → `WindowInfo.FabDisplayState` (`fabDisplayState,omitempty`) via `derefStr` in the same WindowID-keyed enrichment join as `FabStage` → frontend `WindowInfo.fabDisplayState?: string` (`types.ts`). Independent hardening in the same component: the hover-icon container (pin / color swatch / kill) gains `pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto` (inert at rest — stray right-edge clicks fall through to the row-select button) and each hover-revealed `opacity-0` button gains `focus-visible:opacity-100` (keyboard focus never sits on an invisible control; per-button because container opacity can't reveal children's own `opacity-0`). First codebase use of Tailwind v4 `has-[]`. No geometry change. Tests: `sessions_test.go` (value/null/absent parsing + join), `window-row.test.tsx` (suppression predicate + hardening class assertions), `sidebar.test.tsx` (visible + hidden branches). Spec: `docs/specs/api.md` example + Window fields table. | `260612-epqk-display-state-quiet-rows` |
