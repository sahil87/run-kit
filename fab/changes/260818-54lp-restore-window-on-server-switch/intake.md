# Intake: Restore Window on Server Switch

**Change**: 260818-54lp-restore-window-on-server-switch
**Created**: 2026-08-18

## Origin

Conversational — surfaced during a `/fab-discuss` session, then scoped over two exchanges before `/fab-new`.

> When I switch from one server to another, the selected window is open when we revisit, we just see the 'tmux Server Overview', 'Sessions'. Can you help me understand on how we can fix this?

Investigation established the mechanism (below). The user was then asked to choose between two scopes — (a) switching servers always lands on a window, with `/$server` still reachable as the overview, or (b) `/$server` redirects unconditionally and the overview goes away. The answer was explicit:

> I don't want to change the overview page. It's just need it while switching and nothing else

That answer is the scope boundary for this change: **the switch entry points resolve to a window; every other path to `/$server` is untouched.**

## Why

### The problem

Switching tmux servers drops you on the session-tiles overview every time, even when you were mid-work in a window on that server moments earlier. You then have to re-find and re-click your window. For a user hopping between servers — the multi-server workflow run-kit exists to serve — this is friction on the most frequent navigation action there is.

### The mechanism (why it happens today)

Two independent facts combine:

1. **Every server-switch call site navigates to a bare `/$server`.** There is no window in the URL. `serverIndexRoute` (`app/frontend/src/router.tsx`) is componentless; `AppShell` branches on `windowParam` presence (`app/frontend/src/app.tsx`) and renders `SessionTiles` when it is absent.
2. **The existing "follow tmux" URL writeback cannot fire on that URL.** `currentSession` is derived *from* `windowParam` (`app.tsx` — `if (!windowParam) return null`), so `activeWindow` is `null` on `/$server`, and the writeback effect early-returns on its `if (!activeWindow || !sessionName) return;` guard. The route therefore has no auto-select at all.

Nothing anywhere remembers which window you were on. A repo-wide audit found no per-server window pointer in any form: the only navigation-ish storage is `runkit-server` (last-used server name, written in `contexts/session-context.tsx` and **never read**). The per-window keys that do exist (`rk-layout:{server}:{windowId}`, `runkit-window-panel:…`, `runkit-code-folder:…`) are all keyed *by* a window you are already on, so none of them can answer "which window".

This has never been implemented. The single place in the repo where the idea was ever written down is `docs/memory/run-kit/ui/boards.md`, which claims `Board: Leave Board View` navigates to the "last viewed window route" — the implementation (`components/board/board-page.tsx`) unconditionally navigates to `/`. That doc line is stale and describes a feature that does not exist.

### Why remembered position rather than asking tmux

The obvious constitution-friendly instinct is to derive the landing window from tmux, since tmux is the declared source of truth for "current window" and the backend already ships `isActiveWindow` on every window record.

**It cannot answer the question on its own.** A tmux server holds *many* sessions, and `isActiveWindow` is scoped per session — at most one active window *per session* (`internal/sessions/sessions.go` `applyActiveWindow`). So tmux can say "the active window of session X", but nothing tells us which *session* the user was last in. The signals that would answer it — `session_activity`, `session_last_attached` — are **not fetched**: the sessions format string in `internal/tmux/tmux.go` requests `session_name`, `session_grouped`, `session_group`, `session_group_size`, `@session_color`, `session_windows`, `@rk_session_flair`, `session_id`, `session_path` and nothing else, and `SessionInfo`/`ProjectSession`/`types.ts` carry no attached flag or timestamp. Adding them would mean touching the format string, the positional parse in `parseSessions`, and all three struct/type definitions — backend surface area for a purely client-side navigation preference.

Remembering the window client-side answers the user's actual complaint directly ("the window *I* was on"), needs no backend change, and degrades to a derived pick when it has nothing stored.

### Consequence of not doing it

The friction stays, and the stale `boards.md` claim keeps describing a capability the product does not have.

### Why not the alternative scope

Redirecting `/$server` unconditionally would be a smaller diff (one effect, one place) but deletes the session-tiles density view — the multi-agent monitoring surface whose whole purpose is showing every session at once. The user rejected this explicitly.

## What Changes

### 1. New module: per-server last-window memory

New file `app/frontend/src/lib/last-window-per-server.ts`, modelled on the existing small-pure-module convention (`lib/last-pinned-board.ts`, `lib/code-folder-latch.ts`): a key composer plus a read/write pair, each body wrapped in `try { … } catch { /* localStorage unavailable */ }` per the codebase-wide convention.

- **Storage key**: `runkit-last-window:{server}` — the `runkit-*` family (navigation/preference keys), matching the `runkit-last-pinned-board` / `runkit-open-last-used` precedent rather than the newer `rk-*` per-window-layout family.
- **Value**: the window id in its canonical `@N` form (the form used everywhere in code and API; the URL-segment `N` form is a router-codec concern only, per `lib/router-url.ts`).
- **Surface**: `lastWindowStorageKey(server)`, `readLastWindow(server)`, `writeLastWindow(server, windowId)`.
- **Colocated Vitest** (`last-window-per-server.test.ts`) following the convention of its sibling modules.

`localStorage`, not `sessionStorage` — the repo uses no `sessionStorage` anywhere, and the memory should survive a browser restart.

### 2. Recording: write on every window view

Record the current window against its server whenever the terminal route is showing a window — regardless of how the user got there (sidebar click, palette, deep link, board hop, tmux-driven URL writeback). The natural seam is `app/frontend/src/app.tsx` alongside the existing per-window effects that already key on `(server, windowParam)`.

Recording must be write-only and side-effect free: it must not trigger navigation, and it must not interfere with the `hasAlignedToUrlRef` mount-time alignment guard or the `pendingClickRef` suppression window.

### 3. Resolution: a shared helper for the switch paths

New pure resolver — colocated with the storage module or as a sibling `lib/` function, in the style of the existing pure palette builders (`lib/palette-move.ts`, `lib/palette-shell.ts`, `lib/navigation.ts`) — that takes the target server plus the live session snapshot for that server and returns either a window id to open or "no window, show the overview".

Resolution order:

1. **Remembered window**, if `readLastWindow(server)` returns an id **and that window still exists** in the target server's live sessions. Validation is mandatory — a killed or stale window must never be navigated to.
2. **Derived fallback** — the first session in the user's own effective session order, then that session's `isActiveWindow` window. The order comes from the existing pure `deriveEffectiveSessionOrder(liveNames, sseOrder)` in `lib/palette-move.ts`, which folds the persisted `@rk_session_order` (tmux server option, delivered on SSE `event: session-order`) over the natural backend order — so the fallback honours the ordering the user already arranged in the sidebar rather than inventing a new one. If that session reports no active window, take its first window (the same `windows[0]` rule the sidebar session-row click and the kill-redirect helper already use).
3. **Nothing** — the server has no sessions or no windows: navigate to bare `/$server` exactly as today.

The resolver is pure and unit-testable; it performs no navigation itself.

### 4. Wiring: exactly three call sites

Only the **switch** paths consult the resolver:

| Call site | File |
|---|---|
| Sidebar server tile | `app/frontend/src/components/sidebar/index.tsx` — `handleSwitchServer` (the `ServerTile` click seam is `sidebar/server-panel.tsx`) |
| Palette `Server: Switch to {name}` | `app/frontend/src/app.tsx` — `handleSwitchServer` |
| Host page server tile | `app/frontend/src/components/host-overview-page.tsx` — the TMUX SERVERS zone tile `onClick` |

Each resolves a window and navigates to `/$server/$window` when one is found, falling back to `/$server` when none is. Navigation **pushes** history (not `replace`), matching the existing convention that user-initiated switches push while tmux-driven writeback and lens toggles replace.

### 5. Explicitly unchanged

These are deliberate non-changes, and the review should treat any drift here as a defect:

- **The `/$server` route and `SessionTiles`** — same component, same rendering condition, same everything. Typing or bookmarking `/$server` still shows the overview.
- **The breadcrumb server crumb** — the plain `<a href="/$server">` in `components/top-bar.tsx` means "take me to the tmux Server page". It keeps landing on the overview and is not converted to a router navigation.
- **The palette `Go: tmux Server`** — `hooks/use-global-palette-actions.ts` / `lib/palette-nav.ts`. Same reasoning; it is an explicit ancestor-navigation action, not a server switch.
- **All fallback/redirect navigations to `/$server`** — kill-redirect (`lib/navigation.ts` + its `app.tsx` consumer), `handleDialogKillComplete`, `handleDialogSessionRenamed`, `onSessionNotFound`, the palette window-move success path, and the sidebar optimistic cross-session move. These mean "the thing you were looking at is gone" — resolving them to a remembered window would be actively wrong.
- **Server creation paths** — `host-overview-page.tsx` create-server and `components/server-dialogs.tsx` both navigate to `/$server` for a brand-new server. Nothing to remember, nothing to derive.
- **The desktop-shell `Server: Switch to "<name>"` palette block** (quoted-name variant, `lib/palette-shell.ts`) — that switches the whole rk *instance* by URL via the shell bridge and causes a full page swap, not an SPA navigation. Entirely out of scope; the quoted/unquoted distinction documented in `ui/keyboard-and-palette.md` is exactly this boundary.
- **The backend** — no format-string, struct, API, or SSE change. This is a frontend-only change.
- **tmux realignment** — no new `selectWindow` call is needed. Landing on `/$server/$window` re-arms the existing deep-link intent effect (`hasAlignedToUrlRef` re-arms on every `windowParam` change), which realigns tmux for free. This is the same mechanism that already covers history Back/Forward arrow navigation.

### 6. Stale-doc correction

`docs/memory/run-kit/ui/boards.md` claims `Board: Leave Board View` navigates to the "last viewed window route, or `/` if none". The code unconditionally navigates to `/`. Correct the doc line to describe actual behavior. **Do not** change `board-page.tsx` — wiring boards into this memory is a separate idea, not this change.

## Affected Memory

- `run-kit/ui/routes-and-shell.md`: (modify) The § URL as Resumable Bookmark contract gains a third element — server-switch window resolution — alongside mount-time alignment and continuous writeback. Also records that `/$server` remains the overview for every non-switch path, and the new `runkit-last-window:{server}` key.
- `run-kit/ui/sidebar.md`: (modify) The server-tile click no longer lands unconditionally on the session-tiles view. Note the fallback's reuse of `deriveEffectiveSessionOrder`, which ties the landing choice to the existing session-order feature documented in this file.
- `run-kit/ui/keyboard-and-palette.md`: (modify) The unquoted tmux `Server: Switch to {name}` entry resolves to a window; reinforce the quoted-vs-unquoted boundary (the shell variant is unchanged).
- `run-kit/ui/boards.md`: (modify) Correct the stale `Board: Leave Board View` "last viewed window route" claim to match the code.

## Impact

**Frontend only.** No Go, no API, no SSE, no tmux interaction.

New files:
- `app/frontend/src/lib/last-window-per-server.ts`
- `app/frontend/src/lib/last-window-per-server.test.ts`

Modified:
- `app/frontend/src/app.tsx` — recording effect; `handleSwitchServer` resolution
- `app/frontend/src/components/sidebar/index.tsx` — `handleSwitchServer` resolution
- `app/frontend/src/components/host-overview-page.tsx` — server-tile resolution

Reused as-is (no edits expected): `lib/palette-move.ts` `deriveEffectiveSessionOrder`, `lib/router-url.ts` window-id codec, the SSE session snapshot already available at all three call sites.

**Storage footprint**: one small key per server the user has visited. No migration needed — absence of the key is a first-class case handled by the fallback.

**Testing**: Vitest for the storage module and the resolver (the natural home for the interesting cases — stale window id, empty server, no stored value, session-order-driven pick). A Playwright e2e for the switch round-trip is desirable but constrained: the e2e harness runs a single allowlisted infra server (`RK_SERVER_ALLOWLIST=rk-test-e2e`), so a genuine two-server switch may not be expressible — the same constraint that descoped the server-drag e2e to Vitest. If e2e proves infeasible, unit coverage is the correct level and the constraint should be recorded rather than worked around. Per the constitution, any `.spec.ts` added or changed ships its sibling `.spec.md` in the same commit.

**Risk**: low and self-contained. Worst case is landing on a window the user did not expect, which is one click from correction; the existence check prevents navigating to a dead window; a cleared or unavailable `localStorage` degrades to exactly today's behavior.

## Open Questions

None. The scope boundary was resolved explicitly in conversation, and every remaining decision graded Certain or Confident below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Only the three switch entry points (sidebar tile, palette `Server: Switch to`, Host page tile) resolve to a window; `/$server` and every other path to it are untouched | User stated the boundary verbatim when asked to choose between the two scopes: "I don't want to change the overview page. It's just need it while switching and nothing else" | S:95 R:85 A:90 D:95 |
| 2 | Certain | `SessionTiles` and the `/$server` route are not modified at all | Same explicit instruction; the overview is the multi-agent monitoring density view and must stay reachable | S:95 R:85 A:95 D:95 |
| 3 | Certain | No `selectWindow` call is added on the switch path — tmux realignment rides the existing deep-link intent effect | Documented existing contract in `ui/routes-and-shell.md` § URL as Resumable Bookmark; `hasAlignedToUrlRef` re-arms on every `windowParam` change, which is how history Back/Forward already gets realignment for free | S:80 R:75 A:95 D:90 |
| 4 | Certain | Frontend-only — no backend change to fetch `session_activity` / `session_last_attached` | Adding them would touch the format string, positional parse, and three type definitions for a client-side navigation preference; the remembered-window approach makes them unnecessary | S:75 R:70 A:95 D:90 |
| 5 | Confident | Remembered position (localStorage) is the primary signal, not a tmux-derived pick | tmux scopes `isActiveWindow` per session and exposes no last-attached-session signal, so it cannot answer "which window was I on" for a multi-session server; discussed and agreed | S:80 R:75 A:85 D:70 |
| 6 | Confident | Storage key `runkit-last-window:{server}` holding the canonical `@N` window id | Follows the `runkit-*` navigation/preference family (`runkit-last-pinned-board`, `runkit-open-last-used`) over the newer `rk-*` layout family; `@N` is the canonical in-code form, URL-segment conversion is a router-codec concern | S:70 R:90 A:85 D:80 |
| 7 | Confident | The remembered window is validated against the live session snapshot before navigating; a missing window falls through to the derived pick | Windows are killed and servers change out of band; navigating to a dead window would be a worse bug than the one being fixed | S:70 R:85 A:90 D:85 |
| 8 | Confident | Recording happens on every window view on the terminal route, regardless of how the user arrived | "Last window I was on" is only correct if every arrival path records; recording solely on switch would miss deep links, board hops, and tmux-driven writeback | S:70 R:85 A:85 D:80 |
| 9 | Confident | A server with no stored value still resolves to a window (via the derived fallback) rather than showing the overview | "Switching should land me in a window" reads as the general intent; a first visit is the same user action as any other switch. Cheaply reversible if the user prefers overview-on-first-visit | S:50 R:90 A:60 D:55 |
| 10 | Confident | Switch navigation pushes history rather than replacing it | Established convention: user-initiated switches push (window hops already retrace via the top-bar arrows), while tmux writeback and lens toggles use `replace: true` | S:60 R:90 A:85 D:80 |
| 11 | Tentative | Fallback order is: user session order (`deriveEffectiveSessionOrder`) → first session → its active window → its `windows[0]` → overview | Reuses the ordering the user already arranged and the existing `windows[0]` convention from the sidebar session-row click and kill-redirect helper — but other orderings are defensible (most-recent window activity via `activityTimestamp`, or the operator-role window if present) <!-- assumed: fallback ordering when no window is remembered — session-order-first reuses an existing user-arranged signal; activity-timestamp and operator-role picks are the rejected alternatives --> | S:45 R:85 A:55 D:40 |
| 12 | Tentative | The stale `Board: Leave Board View` doc line in `ui/boards.md` is corrected to match the code, and `board-page.tsx` is left alone | The doc is demonstrably wrong and this change is the natural moment to fix it; wiring boards into the new memory is a plausible but separate feature <!-- assumed: doc-only correction — implementing last-viewed-route for boards is deliberately out of scope --> | S:35 R:90 A:70 D:45 |

12 assumptions (4 certain, 6 confident, 2 tentative, 0 unresolved).
