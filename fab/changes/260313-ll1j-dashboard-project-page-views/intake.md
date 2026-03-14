# Intake: Dashboard View

**Change**: 260313-ll1j-dashboard-project-page-views
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Conversational brainstorming session via `/fab-discuss`. The user observed that the terminal area shows a dead-end placeholder ("Select a window from the sidebar") when no window is selected, and that killing windows/sessions leaves a stale URL with no recovery path. They proposed enriching the existing `/` route with a Dashboard view that fills the terminal area when no terminal is active, using expandable session cards with inline window cards.

Key decisions from the discussion:
1. Two-tier URL model: `/` = Dashboard, `/$session/$window` = Terminal (no intermediate `/$session` route)
2. Dashboard uses expandable session cards that reveal window cards inline — both levels of info in one view
3. Dashboard session cards show window count + activity summary (simple stats, not resource-style)
4. Sidebar session name click navigates to `/$session/$window` (first window in that session)
5. Kill redirects: all cases → `/` (dashboard)

## Why

1. **Dead-end after kills**: Killing a window or session leaves the URL pointing at a stale target with no automatic recovery. The user must manually click another window in the sidebar. This is especially bad when killing the last window in a session — there's nowhere obvious to go.

2. **No global overview**: The sidebar shows session/window data but there's no landing page that gives a quick overview of all sessions with stats. When run-kit loads with no sessions, the terminal area is blank except for a placeholder message.

The single-view model was correct for the terminal-focused workflow, but it left gaps in navigation and orientation. The Dashboard fills the terminal area contextually rather than replacing the single-view layout.

## What Changes

### Modified Route: `/` (Dashboard)

The existing `/` index route changes from a redirect-on-load to a persistent Dashboard view. It renders in the terminal area when no session is selected.

**Content — Expandable Session Cards + Stats**:
- Simple stats line at top: e.g., "3 sessions, 7 windows"
- Grid of session cards, one per session
- Each session card shows:
  - Session name (primary text)
  - Window count
  - Activity summary (e.g., "2 active, 1 idle")
- Clicking a session card expands it inline to reveal window cards for that session
- Each window card shows:
  - Window name (primary text)
  - Running process (`paneCommand`) if present
  - Activity status (active/idle dot + label)
  - Duration (idle duration or time since last activity)
  - Fab info (change ID + stage badge) if present
- Click a window card → navigate to `/$session/$window`
- "New Session" button (opens existing create session dialog)
- Expanded session card shows "New Window" button (calls existing `createWindow` API)

The initial redirect behavior (navigate to first session's first window on load) is removed. `/` always shows the Dashboard — users drill down via session cards → window cards → terminal.

Card data sourced from the existing `sessions` array in `SessionProvider` — no new API endpoints needed.

### Redirect Logic After Kills

Currently there's no redirect after killing a window or session — the URL goes stale. This change adds redirect behavior:

1. **Kill non-last window** → redirect to `/` (dashboard)
2. **Kill last window in session** → redirect to `/` (dashboard)
3. **Kill session** (or last session killed) → redirect to `/` (dashboard)

All kill operations redirect to the Dashboard. This logic lives in the frontend — after the kill API call succeeds, navigate before the SSE update removes the stale data.

### Chrome Adaptation

The top bar and bottom bar currently derive content from a selected session:window. With the Dashboard:

- **Dashboard** (`/`): Top bar shows logo + "Dashboard" breadcrumb. Line 2 shows `[+ Session]` only (no Rename/Kill — no window selected). Bottom bar hidden (no terminal to send keys to).
- **Terminal** (`/$session/$window`): Unchanged — full chrome with bottom bar.

### Sidebar Interaction

- Clicking a session name navigates to `/$session/$window` (first window in that session) — the sidebar dropdown already provides `+ Session` for creation
- Expand/collapse of the window list is handled by a separate chevron/triangle toggle (not the session name itself)
- Clicking a window navigates to `/$session/$window` (unchanged)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add Dashboard view patterns, update URL structure table, document card components
- `run-kit/architecture`: (modify) Update route table, document redirect logic

## Impact

- **Frontend routing** (`app/frontend/src/`): Modified `/` route (Dashboard instead of redirect)
- **Frontend components**: One new view component (Dashboard) with expandable session cards containing window cards
- **Chrome context**: Top bar and bottom bar need to handle "no window selected" state gracefully
- **App shell** (`app.tsx`): Redirect-on-load logic needs to become conditional; kill handlers need redirect logic
- **No backend changes**: All data already available via existing SSE stream

## Open Questions

None — all questions resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-tier URL model: `/` = Dashboard, `/$session/$window` = Terminal | Revised — user decided `/$session` route is unnecessary, enriching `/` is sufficient | S:95 R:90 A:95 D:95 |
| 2 | Certain | Dashboard uses expandable session cards with inline window cards | Discussed — user chose expandable cards to show both session and window info on one page | S:95 R:85 A:90 D:95 |
| 3 | Certain | Dashboard stats are simple counts (sessions, windows) | Discussed — user chose simple counts over activity overview or resource dashboard | S:90 R:90 A:90 D:95 |
| 4 | Certain | Sidebar session name click → first window in session (`/$session/$window`) | Revised — user chose direct navigation to first window since dropdown has `+ Session` | S:95 R:80 A:90 D:95 |
| 5 | Certain | Kill redirects: all cases → `/` (dashboard) | Revised — simplified from three-tier redirect to always go to dashboard | S:95 R:85 A:90 D:95 |
| 6 | Confident | No new backend API endpoints needed — card data from existing SSE stream | Existing `ProjectSession[]` with `WindowInfo[]` contains all fields needed for cards | S:70 R:90 A:85 D:90 |
| 7 | Confident | Bottom bar hidden on Dashboard (no terminal to target) | Bottom bar sends keys to terminal WebSocket — meaningless without a terminal | S:65 R:90 A:85 D:90 |
| 8 | Confident | Card styling follows existing design tokens (bg-card, border-border, text-primary/secondary) | Constitution + existing visual design patterns give clear answer | S:70 R:95 A:85 D:90 |
| 9 | Certain | `/` always shows Dashboard — no auto-redirect to terminal | Discussed — user chose "always dashboard" | S:95 R:80 A:90 D:95 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
