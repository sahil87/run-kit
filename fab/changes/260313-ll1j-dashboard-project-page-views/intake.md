# Intake: Dashboard & Project Page Views

**Change**: 260313-ll1j-dashboard-project-page-views
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Conversational brainstorming session via `/fab-discuss`. The user observed that the terminal area shows a dead-end placeholder ("Select a window from the sidebar") when no window is selected, and that killing windows/sessions leaves a stale URL with no recovery path. They proposed two new views that fill the terminal area when a terminal window isn't active, forming a clean URL hierarchy: `/` = Dashboard, `/$session` = Project page, `/$session/$window` = Terminal.

Key decisions from the discussion:
1. URL hierarchy maps directly to content depth: global → session → window
2. Both Dashboard and Project page use card layouts (not lists or minimal prompts)
3. Dashboard session cards show window count + activity summary (simple stats, not resource-style)
4. Clicking a session card navigates to `/$session` (project page), not directly to a window
5. Kill redirects: last window → `/$session`, last session → `/`, non-last window → `/$session`

## Why

1. **Dead-end after kills**: Killing a window or session leaves the URL pointing at a stale target with no automatic recovery. The user must manually click another window in the sidebar. This is especially bad when killing the last window in a session — there's nowhere obvious to go.

2. **No global overview**: The sidebar shows session/window data but there's no landing page that gives a quick overview of all sessions with stats. When run-kit loads with no sessions, the terminal area is blank except for a placeholder message.

3. **No session-scoped view**: There's no intermediate view between "everything" and "one specific terminal window." When you want to see all windows in a session at a glance and pick one, you scan the sidebar tree — but the main content area is wasted space showing a terminal you may not care about.

The single-view model was correct for the terminal-focused workflow, but it left gaps in navigation and orientation. These views fill the terminal area contextually rather than replacing the single-view layout.

## What Changes

### New Route: `/$session` (Project Page)

A new TanStack Router route matching `/$session` (session param only, no window param). Renders in the terminal area (the same slot where `TerminalClient` renders for `/$session/$window`).

**Content — Window Cards**:
- Grid of cards, one per window in the session
- Each card shows:
  - Window name (primary text)
  - Running process (`paneCommand`) if present
  - Activity status (active/idle dot + label)
  - Duration (idle duration or time since last activity)
  - Fab info (change ID + stage badge) if present
- Click a card → navigate to `/$session/$window`
- "New Window" button (calls existing `createWindow` API)

Card data sourced from the existing `sessions` array in `SessionProvider` — no new API endpoints needed. Filter to the session matching the `$session` URL param.

### Modified Route: `/` (Dashboard)

The existing `/` index route changes from a redirect-on-load to a persistent Dashboard view. It renders in the terminal area when no session is selected.

**Content — Session Cards + Stats**:
- Simple stats line at top: e.g., "3 sessions, 7 windows"
- Grid of cards, one per session
- Each card shows:
  - Session name (primary text)
  - Window count
  - Activity summary (e.g., "2 active, 1 idle")
- Click a card → navigate to `/$session` (project page)
- "New Session" button (opens existing create session dialog)

The initial redirect behavior (navigate to first session's first window on load) is removed. `/` always shows the Dashboard — users drill down via session cards.

### Redirect Logic After Kills

Currently there's no redirect after killing a window or session — the URL goes stale. This change adds redirect behavior:

1. **Kill non-last window** → redirect to `/$session` (project page for that session)
2. **Kill last window in session** → redirect to `/$session` (project page shows empty state + "New Window" button)
3. **Kill session** (or last session killed) → redirect to `/` (dashboard)

This logic lives in the frontend — after the kill API call succeeds, navigate before the SSE update removes the stale data.

### Chrome Adaptation

The top bar and bottom bar currently derive content from a selected session:window. With the new views:

- **Dashboard** (`/`): Top bar shows logo + "Dashboard" breadcrumb. Line 2 shows `[+ Session]` only (no Rename/Kill — no window selected). Bottom bar hidden (no terminal to send keys to).
- **Project page** (`/$session`): Top bar shows `logo ❯ session` breadcrumb. Line 2 shows `[+ Session]` + `[+ Window]`. Bottom bar hidden.
- **Terminal** (`/$session/$window`): Unchanged — full chrome with bottom bar.

### Sidebar Interaction

The sidebar gains navigation behavior on session names:
- Clicking a session name navigates to `/$session` (project page) — consistent with the URL hierarchy
- Expand/collapse of the window list is handled by a separate chevron/triangle toggle (not the session name itself)
- Clicking a window navigates to `/$session/$window` (unchanged)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add Dashboard and Project page view patterns, update URL structure table, document card components
- `run-kit/architecture`: (modify) Update route table, note new TanStack Router routes, document redirect logic

## Impact

- **Frontend routing** (`app/frontend/src/`): New `/$session` route in TanStack Router, modified `/` route (Dashboard instead of redirect)
- **Frontend components**: Two new view components (Dashboard, ProjectPage) with card layouts
- **Chrome context**: Top bar and bottom bar need to handle "no window selected" state gracefully
- **App shell** (`app.tsx`): Redirect-on-load logic needs to become conditional; kill handlers need redirect logic
- **No backend changes**: All data already available via existing SSE stream

## Open Questions

None — all questions resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | URL hierarchy: `/` = Dashboard, `/$session` = Project, `/$session/$window` = Terminal | Discussed — user explicitly chose hierarchical URL model | S:95 R:90 A:95 D:95 |
| 2 | Certain | Both views use card layouts | Discussed — user chose cards for both Dashboard and Project page | S:90 R:85 A:90 D:95 |
| 3 | Certain | Dashboard stats are simple counts (sessions, windows) | Discussed — user chose option 1 (simple counts) over activity overview or resource dashboard | S:90 R:90 A:90 D:95 |
| 4 | Certain | Session card click → `/$session` (not directly to terminal) | Discussed — user explicitly chose drill-down to project page | S:95 R:85 A:90 D:95 |
| 5 | Certain | Kill redirects: non-last window → `/$session`, last window → `/$session`, last session → `/` | Discussed — user agreed to all three redirect behaviors | S:95 R:80 A:90 D:95 |
| 6 | Confident | No new backend API endpoints needed — card data from existing SSE stream | Existing `ProjectSession[]` with `WindowInfo[]` contains all fields needed for cards | S:70 R:90 A:85 D:90 |
| 7 | Confident | Bottom bar hidden on Dashboard and Project page (no terminal to target) | Bottom bar sends keys to terminal WebSocket — meaningless without a terminal | S:65 R:90 A:85 D:90 |
| 8 | Confident | Card styling follows existing design tokens (bg-card, border-border, text-primary/secondary) | Constitution + existing visual design patterns give clear answer | S:70 R:95 A:85 D:90 |
| 9 | Certain | `/` always shows Dashboard — no auto-redirect to terminal | Clarified — user chose "always dashboard" | S:95 R:80 A:90 D:95 |
| 10 | Certain | Sidebar session click navigates to `/$session` (project page) | Clarified — user chose navigation over expand/collapse on session name | S:95 R:75 A:85 D:95 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
