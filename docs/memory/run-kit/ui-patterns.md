# run-kit UI Patterns

## URL Structure

| Route | Page | Component Pattern |
|-------|------|-------------------|
| `/` | Dashboard | Server Component → Client Component (SSE) |
| `/p/:project` | Project view | Server Component → Client Component (SSE) |
| `/p/:project/:window?name=` | Terminal view | Server Component → Client Component (xterm.js + WebSocket + SSE) |

The terminal page accepts an optional `name` query parameter for the window name (used in breadcrumb). Falls back to the numeric window index if not provided. Navigation from dashboard/project cards always includes the `name` param.

## Top Bar

All three pages render a shared `TopBar` component (`src/components/top-bar.tsx`) with two lines:

**Line 1**: Breadcrumb navigation + connection indicator + `⌘K` hint badge.

| Page | Breadcrumb |
|------|-----------|
| Dashboard | `Dashboard` |
| Project | `Dashboard › project: {name}` |
| Terminal | `Dashboard › project: {name} › window: {name}` |

Segments are separated by `›`. All segments except the last are clickable links navigating to their respective routes. Connection indicator shows a green/gray dot with "live"/"disconnected" label, driven by `useSessions.isConnected`.

**Line 2**: Contextual action bar (varies per page, passed as `children`).

| Page | Left content | Right content |
|------|-------------|---------------|
| Dashboard | "+ New Session" button, always-visible search input | `{N} sessions, {M} windows` |
| Project | "+ New Window" button, "Send Message" button (disabled when no windows) | `{N} windows` |
| Terminal | "Kill Window" button (red hover) | Activity dot + fab stage badge |

### Inline Kill Controls

- **Window card `✕`**: Every `SessionCard` has a hover-reveal `✕` button. Click opens confirmation dialog. Click uses `stopPropagation` to prevent card navigation.
- **Session group `✕`** (dashboard only): Always-visible button on session group headers with red hover. Click opens confirmation dialog: "Kill session **{name}** and all {N} windows?"

## Keyboard Shortcuts

### Global
| Key | Action | Context |
|-----|--------|---------|
| `Cmd+K` | Open command palette | All pages |
| `j` / `k` | Navigate cards down/up | Dashboard, Project view |
| `Enter` | Drill into focused item | Dashboard, Project view |
| `Esc Esc` | Navigate back | Terminal view (300ms window) |

### Dashboard
| Key | Action |
|-----|--------|
| `c` | Create new tmux session |
| `/` | Focus search input |

### Project View
| Key | Action |
|-----|--------|
| `n` | Create new window |
| `x` | Kill focused window (confirmation) |
| `s` | Send message to focused window's agent |

All keyboard shortcuts are registered in the command palette.

## Visual Design

Dark theme only. Linear/Raycast aesthetic.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#111111` | Page background |
| `--color-bg-card` | `#1a1a1a` | Card backgrounds |
| `--color-text-primary` | `#ffffff` | Primary text |
| `--color-text-secondary` | `#888888` | Secondary text, labels |
| `--color-border` | `#333333` | Borders, dividers |
| `--color-accent` | `#3b82f6` | Active states, focus rings |
| `--color-accent-green` | `#22c55e` | Activity indicators |
| `--font-mono` | JetBrains Mono, etc. | Everywhere |

## Component Conventions

- **Server Components by default** — Client Components only for keyboard handlers, xterm.js, SSE consumers
- **No loading spinners** — SSE keeps data fresh, pages render with whatever data is available
- **No `useEffect` for data fetching** — Server Components fetch initial data, passed to Client Components
- **SSE via `useSessions` hook** — replaces entire state on each event, auto-reconnects. Used on all three pages (terminal page added for connection indicator + window status)
- **Shared `Dialog` component** (`src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click. Used for create, kill, send dialogs across all pages

## Session-to-Project Mapping

Every tmux session is a project — derived from tmux, no config file needed. Project root derived from window 0's `pane_current_path`.

## Activity Status

Windows are `"active"` (last tmux activity within 10 seconds) or `"idle"`. No "exited" state.

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial UI patterns — three pages, keyboard-first, dark theme | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Unified top bar — shared breadcrumb + action bar, inline kill controls, command palette on terminal, always-visible search | `260303-vag8-unified-top-bar` |
