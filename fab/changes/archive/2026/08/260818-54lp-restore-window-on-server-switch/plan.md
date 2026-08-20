# Plan: Restore Window on Server Switch

**Change**: 260818-54lp-restore-window-on-server-switch
**Intake**: `intake.md`

## Requirements

### Navigation: Per-server last-window memory

#### R1: Client-side per-server window memory
A pure module SHALL persist, per tmux server, the window the user last viewed, and SHALL read it back. Reads and writes MUST be best-effort — a `localStorage` failure (private mode, quota, SSR) MUST NOT throw.

The storage key SHALL be `runkit-last-window:{server}`. The stored value SHALL be the canonical `@N` window id (the form used throughout code and API); URL-segment conversion stays a `lib/router-url.ts` concern.

- **GIVEN** a server named `work` and window `@3`
- **WHEN** `writeLastWindow("work", "@3")` runs
- **THEN** `localStorage` holds `runkit-last-window:work` → `@3`
- **AND** `readLastWindow("work")` returns `"@3"`

- **GIVEN** `localStorage` throws on access
- **WHEN** `readLastWindow` or `writeLastWindow` is called
- **THEN** the call returns `null` / completes silently, and no exception escapes

#### R2: Recording on every window view
The current window SHALL be recorded against its server whenever the terminal route is showing a window, regardless of how the user arrived (sidebar click, palette, deep link, board hop, or the tmux-driven URL writeback).

Recording MUST be write-only: it MUST NOT navigate, and MUST NOT interfere with the mount-time alignment guard (`hasAlignedToUrlRef`) or the click-suppression window (`pendingClickRef`).

- **GIVEN** the user is on `/work/3`
- **WHEN** the window param resolves
- **THEN** `runkit-last-window:work` is `@3`

- **GIVEN** the user is on `/$server` with no window param
- **WHEN** the route renders
- **THEN** no write occurs and any previously stored value for that server is left intact

#### R3: Window resolution for a server
A pure resolver SHALL take a target server, that server's live session snapshot, the server's effective session order, and the remembered window id, and SHALL return either a window id to open or `null` (meaning "show the overview").

Resolution order:

1. **Remembered window** — when a remembered id exists AND the live snapshot for that server is non-empty AND the id is present in it, return the remembered id.
2. **Optimistic remembered window** — when a remembered id exists but the live snapshot for that server is **empty** (the server's session stream has not attached yet — only attached servers have windows streamed), return the remembered id anyway. A stale id self-heals: `SurfaceLayout`'s `onSessionNotFound` already bounces to `/$server`.
3. **Derived fallback** — no remembered id, or a remembered id absent from a non-empty snapshot: take the first session in the effective session order that is present in the snapshot, then that session's `isActiveWindow` window, falling back to its `windows[0]`.
4. **Nothing** — no sessions, or the chosen session has no windows: return `null`.

The resolver MUST be pure — no `localStorage` access, no navigation, no React.

- **GIVEN** server `work` has sessions `[api(@1,@2), web(@5)]` and `runkit-last-window:work` is `@5`
- **WHEN** the resolver runs
- **THEN** it returns `@5`

- **GIVEN** the same server but the remembered id is `@9` (killed)
- **WHEN** the resolver runs
- **THEN** it falls through to the derived pick, not `@9`

- **GIVEN** an effective session order of `["web","api"]` and no remembered id, where `web` has `@5` (active) and `@6`
- **WHEN** the resolver runs
- **THEN** it returns `@5`

- **GIVEN** a session whose windows carry no `isActiveWindow: true`
- **WHEN** that session is chosen
- **THEN** the resolver returns its `windows[0]`

- **GIVEN** an empty snapshot and a remembered id `@3`
- **WHEN** the resolver runs
- **THEN** it returns `@3` (optimistic — the stream has not attached)

- **GIVEN** an empty snapshot and no remembered id
- **WHEN** the resolver runs
- **THEN** it returns `null`

#### R4: The three switch entry points resolve to a window
The sidebar server tile, the command-palette `Server: Switch to {name}` action, and the Host page's TMUX SERVERS tile SHALL each resolve a window for the target server and navigate to `/$server/$window` when one is found, falling back to `/$server` when the resolver returns `null`.

Navigation SHALL push history (no `replace: true`), matching the convention that user-initiated switches push while tmux writeback and lens toggles replace.

- **GIVEN** the user last viewed `@5` on server `work` and is currently on server `home`
- **WHEN** they click the `work` tile in the sidebar
- **THEN** the app navigates to `/work/5`

- **GIVEN** server `fresh` has sessions but no remembered window
- **WHEN** the user switches to it from the palette
- **THEN** the app navigates to the derived window, not `/fresh`

- **GIVEN** server `empty` has no sessions
- **WHEN** the user switches to it
- **THEN** the app navigates to `/empty` and the session-tiles overview renders

#### R5: Every non-switch path to `/$server` is unchanged
The following MUST continue to navigate to a bare `/$server` and MUST NOT consult the resolver:

- The breadcrumb server crumb (`<a href="/$server">` in `components/top-bar.tsx`) — it means "take me to the tmux Server page" and stays a plain anchor.
- The palette `Go: tmux Server` action (`hooks/use-global-palette-actions.ts` / `lib/palette-nav.ts`).
- Every fallback/redirect: kill-redirect (`lib/navigation.ts` and its `app.tsx` consumer), `handleDialogKillComplete`, `handleDialogSessionRenamed`, `onSessionNotFound`, the palette window-move success path, and the sidebar optimistic cross-session move. These mean "the thing you were looking at is gone" — resolving them to a remembered window would be wrong.
- Server-creation navigations in `components/host-overview-page.tsx` and `components/server-dialogs.tsx`.
- The desktop-shell `Server: Switch to "<name>"` block (`lib/palette-shell.ts`) — a whole-instance URL swap via the shell bridge, not an SPA navigation.

The `/$server` route, `serverIndexRoute`, and `SessionTiles` MUST NOT be modified.

- **GIVEN** the user is on `/work/5` with a remembered window for `work`
- **WHEN** they click the server crumb in the breadcrumb
- **THEN** they land on `/work` and see the session-tiles overview

- **GIVEN** the user's current window is killed
- **WHEN** the kill-redirect fires with no surviving windows in the session
- **THEN** they land on `/$server`, not on a remembered window

#### R6: Stale boards documentation corrected
`docs/memory/run-kit/ui/boards.md` claims `Board: Leave Board View` navigates to the "last viewed window route, or `/` if none". `components/board/board-page.tsx` navigates unconditionally to `/`. The documentation SHALL be corrected to describe actual behavior.

`board-page.tsx` MUST NOT be changed — wiring boards into this memory is a separate feature.

- **GIVEN** the corrected doc
- **WHEN** a reader consults the `Board: Leave Board View` row
- **THEN** it states the action navigates to `/` (Host)

### Non-Goals

- Redirecting `/$server` itself — the session-tiles overview is the multi-agent monitoring density view and stays reachable at that URL.
- Backend changes — no `session_activity` / `session_last_attached` fetch, no struct, API, or SSE change.
- Wiring `Board: Leave Board View` to the new memory.
- Cross-tab coordination of the remembered window; last write wins, as with every other `runkit-*` preference key.

### Design Decisions

#### Remembered position over a tmux-derived landing window

**Decision**: The primary landing signal is a client-side per-server record of the window the user last viewed, with a tmux/session-order-derived pick only as fallback.

**Why**: A tmux server holds many sessions, and `isActiveWindow` is scoped per session (`applyActiveWindow` enforces at most one per session). tmux can therefore answer "the active window of session X" but not "the session the user was last in" — the signals that would (`session_activity`, `session_last_attached`) are not in the sessions format string and are absent from `SessionInfo` / `ProjectSession` / `types.ts`. Remembering client-side answers the user's actual complaint ("the window I was on"), needs no backend surface, and degrades to a derived pick when nothing is stored.

**Rejected**: Extending the backend to fetch `session_last_attached` — three type definitions, a format string, and a positional parse changed to serve a client-side navigation preference, and it still answers "last attached by any client on the host", not "where this browser was".

*Introduced by*: 260818-54lp-restore-window-on-server-switch

#### Resolution is scoped to switch entry points, not to the route

**Decision**: The three switch call sites resolve a window; `/$server` renders the overview for every other path.

**Why**: The overview is the multi-agent monitoring density view — a deliberate surface with its own purpose. A route-level redirect would delete it. Scoping to the switch action fixes the reported friction while leaving the URL as an explicit way to ask for the overview, so nothing becomes unreachable.

**Rejected**: A `beforeLoad` redirect or an `AppShell` effect on `serverIndexRoute` — a smaller diff, but it removes the overview entirely and would also hijack the kill/not-found redirects, which must keep landing on `/$server`.

*Introduced by*: 260818-54lp-restore-window-on-server-switch

#### Optimistic navigation when the target server's stream has not attached

**Decision**: When a remembered window exists but the target server's session snapshot is empty, navigate to it without validation.

**Why**: Only attached servers have their windows streamed, so an empty snapshot means "not yet known", not "no windows". Refusing to navigate would make the feature fail exactly on the first switch to a server — its most common case. A stale id is already self-healing: `SurfaceLayout`'s `onSessionNotFound` bounces to `/$server`.

**Rejected**: Blocking on a loaded snapshot (feature silently does nothing on the common path), and pre-fetching the target server's sessions before navigating (a fetch on the critical path of every switch, for a preference).

*Introduced by*: 260818-54lp-restore-window-on-server-switch

## Tasks

### Phase 1: Setup

- [x] T001 [P] Create `app/frontend/src/lib/last-window-per-server.ts` — export `LAST_WINDOW_KEY_PREFIX`, `lastWindowStorageKey(server)`, `readLastWindow(server)`, `writeLastWindow(server, windowId)` (try/catch-noop bodies, module docblock in the style of `lib/last-pinned-board.ts`), plus the pure `resolveServerLandingWindow({ sessions, sessionOrder, remembered })` implementing R3's four-step order. Reuse `deriveEffectiveSessionOrder` from `lib/palette-move.ts` at the call sites — the resolver itself takes an already-derived order so it stays pure. <!-- R1 -->
- [x] T002 [P] Create `app/frontend/src/lib/last-window-per-server.test.ts` — Vitest covering the storage round-trip, the localStorage-throws path, and every R3 scenario (remembered hit, stale remembered falls through, empty-snapshot optimistic return, session-order-driven pick, no-active-window `windows[0]` fallback, empty server → `null`). <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 Add the recording effect in `app/frontend/src/app.tsx` — inside `AppShell`, an effect keyed on `[server, windowParam]` that calls `writeLastWindow(server, windowParam)` when both are non-empty. Place it alongside the existing per-window effects; it must not navigate or touch `hasAlignedToUrlRef` / `pendingClickRef`. <!-- R2 -->
- [x] T004 Wire the palette switch in `app/frontend/src/app.tsx` — `handleSwitchServer` resolves via `readLastWindow(name)` + `resolveServerLandingWindow` over `ctx.sessionsByServer.get(name) ?? []` and `deriveEffectiveSessionOrder` of that server's names against `ctx.sessionOrderByServer.get(name) ?? []`, then navigates to `/$server/$window` or `/$server`. Keep the existing `if (name !== server)` no-op guard and push history (no `replace`). <!-- R4 -->
- [x] T005 Wire the sidebar tile in `app/frontend/src/components/sidebar/index.tsx` — same resolution in `handleSwitchServer`, reading the same two context maps. <!-- R4 -->
- [x] T006 Wire the Host page tile in `app/frontend/src/components/host-overview-page.tsx` — same resolution in the TMUX SERVERS tile `onClick`. `useSessionContext()` is already in scope; do NOT touch the create-server or "Open in window" navigations in this file. <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Verify R5 by inspection — confirm the breadcrumb server crumb (`components/top-bar.tsx`), `lib/palette-nav.ts` / `hooks/use-global-palette-actions.ts`, `lib/navigation.ts` and its `app.tsx` kill-redirect consumer, `handleDialogKillComplete`, `handleDialogSessionRenamed`, `onSessionNotFound`, the palette window-move success path, the sidebar optimistic cross-session move, `components/server-dialogs.tsx`, and `lib/palette-shell.ts` are all untouched and still navigate to bare `/$server`. Confirm `router.tsx` and `components/session-tiles/session-tiles.tsx` are unmodified. <!-- R5 -->

### Phase 4: Polish

- [x] T008 Correct the `Board: Leave Board View` row in `docs/memory/run-kit/ui/boards.md` to state it navigates to `/` (Host). Do not modify `components/board/board-page.tsx`. <!-- R6 -->

## Execution Order

- T001 blocks T002–T006 (they import from it)
- T003–T006 are independent of one another once T001 lands
- T007 is verification only; run after T003–T006
- T008 is independent of everything

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/last-window-per-server.ts` exists with the storage key `runkit-last-window:{server}`, stores canonical `@N` ids, and never throws on a failing `localStorage`
- [x] A-002 R2: Viewing any window on the terminal route records it against its server, on every arrival path
- [x] A-003 R3: The resolver implements the four-step order and is pure (no `localStorage`, no navigation, no React imports)
- [x] A-004 R4: All three switch entry points resolve and navigate to `/$server/$window` when a window is found
- [x] A-005 R6: The `Board: Leave Board View` row in `ui/boards.md` matches `board-page.tsx` behavior

### Behavioral Correctness

- [x] A-006 R4: Switching to a server previously visited lands on the remembered window rather than the session-tiles overview
- [x] A-007 R4: Switch navigation pushes history (the top-bar Back arrow returns to the prior route)
- [x] A-008 R5: `router.tsx`, `serverIndexRoute`, and `session-tiles.tsx` are byte-unchanged by this change

### Removal Verification

- [x] A-009 **N/A**: no requirements are removed by this change

### Scenario Coverage

- [x] A-010 R1: Vitest covers the storage round-trip and the localStorage-throws path
- [x] A-011 R3: Vitest covers remembered-hit, stale-remembered fallthrough, empty-snapshot optimistic return, session-order-driven pick, no-active-window `windows[0]`, and empty-server `null`
- [x] A-012 R4: Switching to a server with no sessions lands on `/$server` and renders the overview

### Edge Cases & Error Handling

- [x] A-013 R3: A remembered window absent from a **non-empty** snapshot never causes navigation to that dead window
- [x] A-014 R3: A remembered window with an **empty** snapshot navigates optimistically and self-heals via the existing `onSessionNotFound` bounce
- [x] A-015 R5: Kill-redirect and not-found paths still land on `/$server`, never on a remembered window

### Code Quality

- [x] A-016 Pattern consistency: The new module follows the small-pure-module convention of `lib/last-pinned-board.ts` / `lib/code-folder-latch.ts` (key composer + read/write pair, try/catch-noop, module docblock)
- [x] A-017 No unnecessary duplication: `deriveEffectiveSessionOrder` from `lib/palette-move.ts` is reused rather than reimplemented; the resolution logic lives in one shared function used by all three call sites, not copied three times
- [x] A-018 Type narrowing over assertions: no `as` casts introduced in the new code (`code-quality.md` § Principles)
- [x] A-019 No magic strings: the storage key prefix is a named constant
- [x] A-020 No client polling: the change reads the existing SSE-derived snapshot and adds no `setInterval` or fetch (`code-quality.md` § Anti-Patterns)
- [x] A-021 Comment discipline: comments state constraints (why optimistic navigation is safe, why non-switch paths are excluded), never narrate the next line or cite change IDs
- [x] A-022 Tests accompany behavior: the new module ships colocated Vitest coverage (`code-quality.md` § Principles)
- [x] A-023 Verification gates: `cd app/frontend && npx tsc --noEmit` passes and the frontend unit suite is green

### Security

- [x] A-024 **N/A**: frontend-only navigation preference — no subprocess execution, no user input reaching a shell, no new network surface

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Frontend tests need `PNPM_CONFIG_STRICT_DEP_BUILDS=false` prefixed on this machine (pnpm 11 `ERR_PNPM_IGNORED_BUILDS`)
- No Playwright e2e is planned: the e2e harness runs a single allowlisted infra server (`RK_SERVER_ALLOWLIST=rk-test-e2e`), so a genuine two-server switch is not expressible — the same constraint that descoped the server-drag e2e to Vitest. Unit coverage is the correct level here. No `.spec.ts` is added or changed, so the constitution's `.spec.md` companion rule does not engage.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The resolver takes an already-derived session order as a parameter rather than deriving it internally | Keeps it pure and unit-testable; `deriveEffectiveSessionOrder` already exists and its inputs live at the call sites | S:80 R:90 A:90 D:85 |
| 2 | Certain | No Playwright e2e; unit coverage only | The e2e harness allowlists a single server, making a two-server switch inexpressible — the documented precedent that descoped the server-drag e2e to Vitest | S:75 R:85 A:90 D:85 |
| 3 | Confident | An empty session snapshot for the target server triggers optimistic navigation to the remembered window rather than falling back to the overview | Only attached servers stream windows, so empty means "unknown" not "none"; blocking would break the feature on the most common path, and `onSessionNotFound` already self-heals a stale id | S:65 R:80 A:80 D:65 |
| 4 | Confident | The recording effect lives in `AppShell` keyed on `[server, windowParam]` rather than inside `navigateToWindow` | Recording must cover every arrival path (deep link, board hop, tmux writeback), not just explicit navigation calls | S:70 R:85 A:85 D:75 |
| 5 | Confident | One shared resolver function is called from all three sites rather than a hook | The sites differ in component type and context access; a pure function plus a two-line call keeps `lib/` DOM-free per the existing pure-builder convention (`palette-move.ts`, `palette-shell.ts`) | S:65 R:85 A:80 D:70 |
| 6 | Confident | The derived fallback picks the first session in effective order that is present in the snapshot, then its active window, then `windows[0]` | Reuses the user's own arranged order and the existing `windows[0]` convention shared by the sidebar session-row click and the kill-redirect helper | S:60 R:85 A:75 D:60 |

6 assumptions (2 certain, 4 confident, 0 tentative).
