# Intake: Lift TopBar to Persistent Root Layout

**Change**: 260707-4vq2-lift-topbar-root-layout
**Created**: 2026-07-07

## Origin

Conversational — via `/fab-new`, with a gap-analysis reframe confirmed by the user.

> Evaluate / discuss / and execute - conversion of the run-kit app into an SPA. right now its an MPA. I can see the navbar reload via flicker duing page chnages. My hope is after becoming an SPA, Navbar becomes a common component, and page changes just re-render it, removing the flicker.

**Gap analysis finding (presented to and accepted by the user)**: the app is **already an SPA** — Vite + React 19 + TanStack Router, single `index.html`, all in-app navigation via client-side `router.navigate()` (the only `window.location.reload()` calls are explicit refresh buttons; the only raw `<a href>` links are the Not-Found / Server-Not-Found escape hatches). No MPA→SPA conversion exists to perform. The observed navbar flicker has two concrete, verified causes:

1. **`TopBar` is mounted three separate times, once inside each page component**: `AppShell` (`app/frontend/src/app.tsx:1598`, modes `terminal`/`root`) for `/$server` + `/$server/$window`, `ServerListPage` (`app/frontend/src/components/server-list-page.tsx:180`, mode `cockpit`) for `/`, and `BoardPage` (`app/frontend/src/components/board/board-page.tsx:525`, mode `board`) for `/board/$name`. Cross-page navigation unmounts one instance and mounts a fresh one — the perceived "navbar reload". (Terminal ↔ Cabin within one server does NOT remount — both routes share `AppShell` via `serverLayoutRoute`.)
2. **`BoardPage` is lazy-loaded behind the root `<Suspense fallback={null}>`** (`app.tsx:91`, `router.tsx:10`) — while the board chunk loads, the entire screen (navbar included) goes blank. Over plaintext HTTP the chunk fetch can be slow (known HTTP/1.1 connection-pool starvation on this app), making the blank very visible.

**User's scope decision** (asked via SRAD question, answered explicitly): **Lift TopBar to root** — mount `TopBar` once in the root layout above the router `<Outlet>`; pages stop rendering their own. The alternatives "full persistent chrome" (also lift Sidebar/BottomBar/Shell), "reproduce/verify first", and "drop the change" were offered and declined.

## Why

1. **Pain point**: navigating between the Cockpit (`/`), a Server Cabin/Terminal (`/$server`, `/$server/$window`), and a Board (`/board/$name`) visibly flickers the top navigation bar. The user reads this as "the navbar reloads", making the app feel like an MPA even though it is an SPA. Navigating to a board additionally blanks the whole screen while the lazy chunk loads.
2. **Consequence of not fixing**: every cross-page navigation feels janky; the app's SPA architecture is invisible to the user. As more top-bar affordances accumulate (page heading, connection dot, notification/theme/refresh cluster), the remount cost and visual discontinuity grow.
3. **Why this approach**: the flicker is a *component-identity* problem, not an architecture problem. Mounting `TopBar` once at the root gives it stable identity across route changes — React then re-renders it in place (props change, no unmount), which is exactly the user's stated hope ("Navbar becomes a common component, and page changes just re-render it"). Rejected alternatives: (a) MPA→SPA conversion — void premise, already an SPA; (b) full persistent chrome (Sidebar + BottomBar + Shell grid at root) — larger refactor and risk, the Cockpit has no sidebar/bottombar so the root layout would need chrome-less modes; explicitly descoped by the user; (c) do nothing — flicker persists.

## What Changes

### 1. Root layout: persistent TopBar mount in `RootWrapper` (`app.tsx`)

`RootWrapper` (currently providers + `<Suspense fallback={null}><Outlet/></Suspense>`) gains a layout row structure inside the existing provider stack:

```tsx
// inside the existing provider stack (ThemeProvider → … → OptimisticProvider)
<TopBarSlotProvider>
  <div className="flex flex-col" style={{ height: "var(--app-height, 100vh)" }}>
    <header className="shrink-0">
      <RootTopBar />   {/* the single persistent TopBar mount */}
    </header>
    <div className="flex-1 min-h-0">
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  </div>
</TopBarSlotProvider>
```

Because the `<Suspense>` boundary now wraps only the content region, the lazy-board chunk load blanks only the page body — the navbar stays painted (this fixes flicker cause #2 for the navbar without touching the lazy-loading strategy; improving the `null` fallback itself is out of scope).

### 2. TopBar props delivery: route-derived identity + page-registered slot

`TopBar`'s props are page-specific today (sessions, current window, create/navigate handlers, board metadata). Delivery splits into two channels:

- **Route-derived (synchronous, at root)**: `RootTopBar` derives `mode` and the page identity from `useMatches()`/route params — `/` → `cockpit`, `/board/$name` → `board` (with `boardName` from the `$name` param), `/$server` → `root` (Server Cabin), `/$server/$window` → `terminal`. This flips the moment the URL changes, so the heading never waits on the incoming page's mount (important for the lazy board: `Board: <name>` renders from the URL param while the chunk is still loading).
- **Page-registered (a slot context, `TopBarSlotProvider`)**: pages publish their data/handler props (`sessions`, `currentSession`, `currentWindow`, `isConnected`, `onNavigate`, `onCreateSession`, `onCreateWindow`, `onToggleSidebar`, board extras `paneCount`/`serverCount`/`waitingPaneCount`/`boards`/`onCloseFocused`/`closeDisabled`, …) into the context via an effect on mount/update and clear on unmount. This follows the existing `FocusedTerminalProvider` registration precedent (`app.tsx:82` comment block) and keeps the heavy handlers (`navigateToWindow` with its View-Transitions gate, `handleCreateSessionInstant` with optimistic ghosts) where they live today — no logic migration out of `AppShell`/`BoardPage`.
- **Tolerant-empty defaults**: when no page has registered yet (first frame after navigation, or lazy chunk still loading), `RootTopBar` renders the route-derived mode with the tolerant-empty prop shape the cockpit/board mounts already use (`sessions=[]`, `currentSession=null`, `currentWindow=null`, no-op callbacks). `TopBar` already supports this shape in every mode.

### 3. Page components: remove the three per-page `<TopBar>` mounts

- `AppShell` (`app.tsx:1598`): delete the `<header style={{ gridArea: "topbar" }}><TopBar …/></header>` block; register its TopBar props into the slot context instead (mode stays derived from route at root — `windowParam ? "terminal" : "root"` logic moves into the root derivation).
- `ServerListPage` (`server-list-page.tsx:180`): delete its `<TopBar mode="cockpit" …/>` mount (it already passes the tolerant-empty shape, so it may need to register little or nothing beyond `isConnected={hostMetricsConnected}`). Its `flex flex-col h-screen` wrapper becomes `h-full` (the root layout now owns the viewport height).
- `BoardPage` (`board-page.tsx:525`): delete its `<header>…<TopBar mode="board" …/></header>` block; register the board extras into the slot.

### 4. Shell grid: drop the `topbar` row (`components/shell/shell.tsx`)

The Shell grid currently spans the topbar full-width above the sidebar (`"topbar topbar" / "sidebar content" / "sidebar bottombar"`), so extracting it is geometrically a no-op — the visual stack (full-width topbar above sidebar+content) is preserved by the root layout. Shell changes:

- Desktop `gridTemplateAreas` → `'"sidebar content" "sidebar bottombar"'`, rows `1fr auto`; mobile → `'"content" "bottombar"'`.
- Shell height `var(--app-height, 100vh)` → `100%` (it now fills the root layout's `flex-1` region). The `--app-height` consumer moves to the root layout div; `useVisualViewport()` (which maintains the var for iOS keyboards) can stay in Shell or move to `RootWrapper` — decided at apply.
- The mobile drawer's `gridRow: "2 / 4"` overlay placement shifts to the new row indices (`"1 / 3"`).
- `useSidebarKeyboardToggle` (Cmd+\\) stays in Shell — unchanged behavior (the chord is only registered on routes that mount a Shell, as today).

### 5. Edge routes: Not-Found / ServerNotFound / ServerWaiting

- `NotFoundPage` (`router.tsx:36`) is the root `notFoundComponent` and renders in the outlet region — i.e., below the persistent TopBar. The root mode derivation needs an unmatched-route fallback (cockpit-like minimal mode). Its `h-screen` centering becomes `h-full`.
- `ServerNotFound` / `ServerWaiting` (`app.tsx:111`, `app.tsx:133`) render inside `AppShell`'s early returns — their `h-screen` also becomes `h-full` so they don't overflow under the persistent bar.

### 6. Explicitly out of scope (non-goals)

- **Sidebar/BottomBar/Shell persistence**: they remain per-page; the Sidebar still remounts on `/$server` ↔ `/board/$name` navigation (user descoped "full persistent chrome").
- **Lazy-loading strategy / Suspense fallback design**: `fallback={null}` stays; only its blast radius shrinks to the content region.
- **TopBar internal behavior**: all four modes keep their exact current rendering (breadcrumbs, center heading, button pyramid, connection dot semantics per `docs/memory/run-kit/ui-patterns.md`). This change relocates the mount; it does not redesign the bar.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The "full-width-topbar Shell grid + TopBar universal-page-heading navbar" description changes — TopBar now mounts once at the root layout above the router outlet (persistent across routes, slot-context prop delivery, route-derived mode); the Shell grid loses its `topbar` row.

## Impact

- **Frontend only** — no backend/API/tmux changes. Affected files:
  - `app/frontend/src/app.tsx` — `RootWrapper` layout + `RootTopBar` + `AppShell` TopBar removal/registration (largest file in the change; edit carefully, it is 1965 lines)
  - `app/frontend/src/contexts/` — new slot context (e.g., `top-bar-slot-context.tsx`), following the `FocusedTerminalProvider` pattern
  - `app/frontend/src/components/shell/shell.tsx` — grid row removal, height handoff
  - `app/frontend/src/components/server-list-page.tsx`, `app/frontend/src/components/board/board-page.tsx` — TopBar mount removal + registration
  - `app/frontend/src/router.tsx` — `NotFoundPage` height tweak (TopBar itself, `components/top-bar.tsx`, should need little to no change — same props type, new call site)
- **Tests**: `top-bar.test.tsx` (mount context), `server-list-page.test.tsx`, board page tests, and any Playwright e2e specs that locate the top bar within page structure (`app/frontend/tests/`) — per constitution, any modified `.spec.ts` updates its sibling `.spec.md` in the same commit. A new e2e assertion should verify TopBar DOM-node identity is preserved across `/` → `/$server` → `/board/$name` navigation (element handle comparison), which is the direct regression test for the flicker.
- **Risk concentration**: the registration timing (page registers in an effect → one frame of tolerant-empty props after navigation) and the Shell grid re-index (mobile drawer overlay rows). Both are contained and reversible.
- **Verification gates** (per `fab/project/code-quality.md`): `npx tsc --noEmit`, frontend unit tests, `just test-e2e`, plus Playwright-driven manual verification of all four page modes at mobile (375px) and desktop widths.

## Open Questions

- None — the scope question (TopBar-only vs full chrome) was asked and resolved during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | No MPA→SPA conversion — the app is already an SPA; the change is scoped to the navbar flicker fix | Verified in code: TanStack Router, client-side `navigate()` throughout, single entry; finding presented to and accepted by the user | S:90 R:95 A:100 D:95 |
| 2 | Certain | Scope = lift TopBar only; Sidebar/BottomBar/Shell stay per-page | Asked — user explicitly chose "Lift TopBar to root" over "full persistent chrome" | S:100 R:80 A:100 D:100 |
| 3 | Confident | Root layout = flex column (persistent TopBar header + `flex-1` outlet region); Shell drops its `topbar` grid row | Shell's grid already renders the topbar full-width above the sidebar, so the extraction is geometrically a no-op; straightforward to adjust during apply if a seam shows | S:70 R:75 A:85 D:80 |
| 4 | Confident | Prop delivery = route-derived mode/identity at root + page-registered slot context for data/handlers (FocusedTerminalProvider precedent), with tolerant-empty defaults | Codebase precedent exists and both board/cockpit mounts already use the tolerant-empty shape; the main alternative (moving all handlers to root) migrates heavy AppShell logic for no user-visible gain; implementation-internal and reversible at apply | S:50 R:85 A:75 D:60 |
| 5 | Confident | Keep `Suspense fallback={null}`; shrinking its blast radius to the content region is sufficient for this change | The navbar persisting is the requested outcome; fallback design is a separable follow-up; trivially revisitable | S:55 R:90 A:80 D:75 |
| 6 | Confident | Not-Found/ServerNotFound/ServerWaiting render below the persistent TopBar with `h-screen` → `h-full`; unmatched routes get a minimal cockpit-like TopBar fallback mode | Reasonable default keeping chrome consistent on error pages; alternative (chrome-less full-screen error pages) is valid but less consistent; cheap to flip during apply | S:35 R:75 A:60 D:45 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
