# Intake: Unified Top Bar

**Change**: 260303-vag8-unified-top-bar
**Created**: 2026-03-03
**Status**: Draft

## Origin

> Conversational design session via `/fab-discuss`. User reviewed the three existing page headers (dashboard, project, terminal) and identified that navigation, actions, and status information are inconsistent across pages. Discussion explored what actions users need on each page, resulting in a concrete two-line top bar design with breadcrumb navigation and contextual action bars.

Interaction mode: conversational (extended `/fab-discuss` → `/fab-new` flow). All major design decisions were resolved during discussion — no unresolved questions remain.

## Why

1. **Inconsistent navigation**: Each page has its own ad-hoc header — dashboard shows a title, project shows a back button + name, terminal shows a back button + `project/index`. There's no unified wayfinding.
2. **Hidden actions**: High-frequency operations (create session, create window, kill window, filter) are keyboard-only with no visible affordance. New users have no way to discover them without opening the command palette.
3. **Missing capabilities**: Kill session is impossible. Kill window from the dashboard is impossible. The terminal page has no command palette, no connection status, and shows a numeric window index instead of the semantic name.
4. **No global status**: Connection indicator (live/disconnected) only appears on the dashboard. Users on the project or terminal page can't tell if SSE is connected.

If we don't fix this: the app remains keyboard-expert-only, key actions are undiscoverable, and navigation between the three levels requires memorizing shortcuts or using the browser back button.

## What Changes

### Top Bar Structure (all pages)

Replace the three ad-hoc `<header>` elements with a shared two-line top bar component:

**Line 1 — Breadcrumb + Global Status**

```
Dashboard                                               ● live  ⌘K
Dashboard  ›  project: run-kit                          ● live  ⌘K
Dashboard  ›  project: run-kit  ›  window: agent-main   ● live  ⌘K
```

- "Dashboard" is always the root segment, clickable → navigates to `/`
- "project: {name}" segment clickable → navigates to `/p/{project}`
- "window: {name}" segment shows the actual window name (resolved from tmux), not the numeric index
- `›` as segment separator
- Right side: connection indicator dot (green = live, gray = disconnected) + `⌘K` hint badge
- Connection indicator uses the existing `useSessions` hook's `isConnected` state, made available globally

**Line 2 — Contextual Action Bar**

Content varies per page:

#### Dashboard (`/`)

```
[+ New Session]    [🔍 ________________]              3 sessions, 7 windows
```

- **+ New Session** button — opens the existing create-session dialog. Replaces the keyboard-only `c` shortcut with a visible affordance.
- **Always-visible search input** — replaces the current `/`-to-toggle filter. Users can click into it or press `/` to focus. Filters by window name, project name, or worktree path (same logic as current filter).
- **Right-aligned summary**: `{N} sessions, {M} windows` — ambient context.

#### Project (`/p/:project`)

```
[+ New Window]    [→ Send Message]                      3 windows
```

- **+ New Window** button — opens the existing create-window dialog. Replaces keyboard-only `n`.
- **→ Send Message** button — opens the existing send-message dialog for the focused window. Disabled if no window is focused. Replaces keyboard-only `s`.
- **Right-aligned**: `{N} windows` count.
- Kill Window is NOT in the action bar — it moves to inline `✕` on each card (see below).

#### Terminal (`/p/:project/:window`)

```
[✕ Kill Window]                                    ● active | fab: apply
```

- **✕ Kill Window** button — kills the current window with confirmation dialog: "Kill window **{name}**?"
- **Right-aligned status**: activity indicator (● active / ● idle) + fab stage badge if this is a fab-kit project (e.g., "fab: apply"). If not a fab-kit project, just the activity status.

### Inline Kill on Cards and Groups

#### Window Card `✕`

- Every `SessionCard` (on both dashboard and project pages) gets a right-aligned `✕` button.
- **Visual**: dimmed/subtle by default (`text-text-secondary`), becomes visible on card hover.
- **Click**: opens confirmation dialog — "Kill window **{name}**?"
- **Click stops propagation** — must not trigger the card's navigation.
- Replaces the `x` keyboard shortcut on the project page as the primary kill affordance. The `x` shortcut still works for the focused card.

#### Session Group `✕` (dashboard only)

- Each session group header (the row showing session name + window count) gets a `✕` button.
- **Visually distinct from window `✕`**: slightly larger, different hover color (e.g., red tint on hover), or shows "Kill session" label on hover.
- **Click**: opens confirmation dialog — "Kill session **{name}** and all {N} windows?"
- **API**: calls `POST /api/sessions` with a new `killSession` action (must be added — currently only `killWindow` exists).

### New API Action: `killSession`

Add `killSession` action to `POST /api/sessions`:
- Params: `{ action: "killSession", session: string }`
- Implementation: `execFile("tmux", ["kill-session", "-t", session])` via `lib/tmux.ts`
- Validation: session name validated via `lib/validate.ts` before subprocess call
- Timeout: 10 seconds (per constitution)

### Command Palette on Terminal Page

The terminal page currently has no command palette. Add `⌘K` support with at minimum:
- "Kill this window"
- "Back to project"
- "Back to dashboard"

### Window Name Resolution for Terminal Breadcrumb

The terminal page currently receives `windowIndex` (a number) from the URL params. To show the window name in the breadcrumb, either:
- Pass the window name as a query parameter when navigating to the terminal page
- Or fetch it from the sessions API on mount

The simpler approach is to pass it as a query param (e.g., `/p/run-kit/0?name=agent-main`) since the session data is already available when the user clicks a card.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update keyboard shortcuts table, component conventions, add top bar pattern documentation
- `run-kit/architecture`: (modify) Add killSession API action to the API layer table

## Impact

- **Files modified**: `src/app/dashboard-client.tsx`, `src/app/p/[project]/project-client.tsx`, `src/app/p/[project]/[window]/terminal-client.tsx`, `src/components/session-card.tsx`, `src/app/api/sessions/route.ts`, `src/lib/tmux.ts`
- **New components**: Shared top bar component (breadcrumb + status), action bar component (or inline per page)
- **API change**: New `killSession` action in POST `/api/sessions`
- **No new routes or pages** — stays within the three-route structure per constitution

## Open Questions

None — all design decisions resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-line top bar: breadcrumb + action bar | Discussed — user designed and confirmed this structure | S:95 R:80 A:90 D:95 |
| 2 | Certain | Breadcrumb format: "Dashboard › project: {name} › window: {name}" | Discussed — user specified labeled segments | S:95 R:85 A:90 D:95 |
| 3 | Certain | Each breadcrumb segment clickable for navigation | Discussed — user confirmed | S:90 R:90 A:90 D:95 |
| 4 | Certain | Connection status global on all pages | Discussed — user confirmed | S:90 R:90 A:85 D:95 |
| 5 | Certain | ⌘K command palette on terminal page | Discussed — user agreed terminal needs it | S:85 R:90 A:85 D:90 |
| 6 | Certain | Dashboard: always-visible search input (not toggle) | Discussed — user chose this over button | S:95 R:85 A:85 D:95 |
| 7 | Certain | Project action bar: New Window + Send Message (Kill moved to inline) | Discussed — user moved kill to inline ✕ on cards | S:90 R:80 A:85 D:90 |
| 8 | Certain | Terminal action bar: Kill Window + activity status + fab stage | Discussed — user confirmed | S:90 R:80 A:85 D:90 |
| 9 | Certain | Inline ✕ on cards: subtle for windows, visually heavier for session groups | Discussed — user designed and confirmed both visual treatments | S:95 R:80 A:90 D:95 |
| 10 | Certain | Kill session is new capability via session group ✕ | Discussed — user explicitly requested | S:95 R:70 A:90 D:95 |
| 11 | Certain | Confirmation copy differentiates window vs session kill | Discussed — user confirmed both confirmation patterns | S:90 R:75 A:90 D:95 |
| 12 | Certain | Sub-panels / sub-screens out of scope | Discussed — user said "ignore for now" | S:95 R:95 A:95 D:95 |
| 13 | Certain | Always-visible top bar on terminal (not collapsible) | Discussed — user chose this | S:90 R:85 A:85 D:90 |
| 14 | Confident | Window name passed via query param to terminal page | Simpler than fetching from API; session data already available at navigation time | S:60 R:85 A:80 D:70 |
| 15 | Confident | Shared top bar as a reusable component (not duplicated per page) | Standard React pattern; reduces duplication; constitution says minimal surface area | S:60 R:85 A:85 D:80 |
| 16 | Confident | killSession API uses tmux kill-session command | Direct tmux command; consistent with existing killWindow pattern in lib/tmux.ts | S:65 R:80 A:85 D:85 |

16 assumptions (13 certain, 3 confident, 0 tentative, 0 unresolved).