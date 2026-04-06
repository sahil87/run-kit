# Intake: Pane CWD Tracking and Sidebar Hover Info

**Change**: 260405-rx38-pane-cwd-tracking
**Created**: 2026-04-06
**Status**: Draft

## Origin

Split from 260405-gle4-quick-session-launch. The parent change covered instant session launch; this change covers the complementary goal of surfacing current working directory and pane metadata throughout the app. The core insight: what matters is where a terminal *is now*, not where it *started*.

## Why

The sidebar currently shows session and window names with no indication of where each pane is. Users navigating multiple sessions have to mentally track which session is in which directory. The window-level `worktreePath` field exists in the data model and flows through SSE, but is only displayed in the dashboard and top-bar — not in the sidebar where navigation happens.

Additionally, run-kit has no structured pane-level data anywhere in the stack. Tmux tracks pane state internally (`pane_id`, `pane_index`, `pane_current_path`, `pane_current_command`, `pane_active`) but the backend only surfaces a single active-pane snapshot per window. Storing rich pane data in the frontend Zustand store opens the door for future features (pane-level targeting, multi-pane layouts, per-pane status indicators) without requiring further backend changes.

## What Changes

### 1. Backend: Add Pane Data to Window Info

Replace the single `pane_current_path` field in `list-windows` with a proper pane array sourced from `list-panes`:

- Add a `list-panes -s -t <session>` call (one call per session, returns all panes across all windows)
- Group pane results by window index
- Populate a `Panes []PaneInfo` field on `WindowInfo`

**`PaneInfo` struct** (backend `tmux.go`):
```go
type PaneInfo struct {
    PaneID    string `json:"paneId"`    // %N — global unique ID
    PaneIndex int    `json:"paneIndex"` // 0, 1, 2 within the window
    Cwd       string `json:"cwd"`       // pane_current_path
    Command   string `json:"command"`   // pane_current_command
    IsActive  bool   `json:"isActive"`  // pane_active
}
```

Keep `worktreePath` on `WindowInfo` for backward compatibility — populated from the active pane's `cwd` (i.e., `panes.find(p => p.isActive)?.cwd`).

### 2. Frontend: Types and Zustand Store

**`types.ts`**: Add `PaneInfo` type and `panes: PaneInfo[]` to `WindowInfo`:

```ts
export type PaneInfo = {
  paneId: string;       // %N
  paneIndex: number;    // 0, 1, 2 within the window
  cwd: string;          // pane_current_path
  command: string;      // pane_current_command
  isActive: boolean;    // pane_active
};
```

**`window-store.ts`**: Add `panes: PaneInfo[]` to `WindowEntry`. Update `setWindowsForSession` to sync pane data from incoming `WindowInfo`.

### 3. Sidebar: Hover Tooltip on Window Rows

Window rows in the sidebar show a hover tooltip (key-value map) revealing:

- `cwd` — active pane's current working directory (`panes.find(p => p.isActive)?.cwd`)
- `win` — window index and `@N` ID (e.g., `3 (@5)`)
- `panes` — list of pane IDs with their index (e.g., `%8 (0)`, `%9 (1)*` where `*` marks active)

Implementation: absolutely-positioned tooltip div inside the existing `relative group` window row, revealed via `group-hover` CSS. Same pattern as the existing kill button reveal. Tooltip appears to the right or above the row (avoid clipping by sidebar edge).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar window row hover tooltip
- `run-kit/tmux-sessions`: (modify) Pane data surfaced in SSE stream
- `run-kit/architecture`: (modify) `PaneInfo` type, Zustand store shape

## Impact

**Backend** (`app/backend/`):
- `internal/tmux/tmux.go` — add `PaneInfo` struct, add `list-panes` call, populate `Panes` on `WindowInfo`, keep `WorktreePath` derived from active pane
- `internal/sessions/` — may need updates if it wraps `WindowInfo`

**Frontend** (`app/frontend/src/`):
- `types.ts` — add `PaneInfo` type, add `panes: PaneInfo[]` to `WindowInfo`
- `store/window-store.ts` — add `panes` to `WindowEntry`, sync in `setWindowsForSession`
- `components/sidebar.tsx` — add hover tooltip to window rows

**Tests**: Unit tests for `parseWindows`/`parsePanes` (backend), `setWindowsForSession` (store), and sidebar tooltip rendering.

## Decisions Made in Design

- **CWD detection**: `tmux pane_current_path` via existing SSE stream (2.5s poll interval). OSC 7 ruled out — adds shell dependency and frontend parser complexity for marginal gain.
- **SSE lag**: 2.5s acceptable for CWD display.
- **Tooltip visibility**: hover-only, not always shown. Keeps sidebar uncluttered.
- **`worktreePath` kept**: backward compat with dashboard, top-bar, split/new-window CWD defaulting.
- **Pane data in Zustand**: store the full pane array for future use, not just active pane.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `tmux pane_current_path` via SSE is sufficient — no OSC 7 needed | 2.5s lag acceptable; OSC 7 adds shell dependency for no meaningful gain at this stage | S:95 R:95 A:95 D:90 |
| 2 | Certain | `list-panes -s -t <session>` (one call per session) is the right approach | Cheap — single tmux subprocess per session per tick; groups naturally by window | S:90 R:90 A:90 D:90 |
| 3 | Certain | `PaneInfo` shape: paneId, paneIndex, cwd, command, isActive | Discussed and confirmed. Sufficient for tooltip and future use | S:90 R:95 A:90 D:90 |
| 4 | Certain | Window-level CWD is derived from active pane: `panes.find(p => p.isActive)?.cwd` | Cleaner than maintaining a separate field; `worktreePath` kept only for compat | S:90 R:95 A:90 D:90 |
| 5 | Certain | Panes stored in Zustand `WindowEntry` for future access, not just in `WindowInfo` | Explicit user decision — pane data useful for future features beyond tooltip | S:95 R:95 A:95 D:95 |
| 6 | Confident | Tooltip uses `group-hover` pattern already established in sidebar (kill button) | Consistent with existing UI pattern; no new tooltip component needed | S:80 R:85 A:80 D:80 |
| 7 | Tentative | Tooltip positioned to the right of the window row | Avoids sidebar edge clipping but may overlap content area. Could go above instead | S:55 R:70 A:60 D:55 |

7 assumptions (5 certain, 1 confident, 1 tentative). Ready for spec.
