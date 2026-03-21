# Intake: Split Pane Buttons

**Change**: 260321-s5pw-split-pane-buttons
**Created**: 2026-03-21
**Status**: Draft

## Origin

> User added horizontal and vertical split pane buttons to the top bar, with full backend API support. This was implemented independently alongside the icon color normalization work. The change adds the ability to split tmux panes from the web UI.

## Why

The web UI had no way to split tmux panes — users had to use tmux keybindings or commands directly. Adding split buttons to the top bar makes pane management discoverable and accessible, especially on mobile/touch devices where tmux keybindings aren't available. This aligns with the keyboard-first but mouse-supported design philosophy.

## What Changes

### Backend — `app/backend/`

#### New API endpoint: `POST /api/sessions/{session}/windows/{index}/split`

Request body:
```json
{ "horizontal": true }
```

Response:
```json
{ "ok": "true", "pane_id": "%5" }
```

The `horizontal` field controls split direction: `true` = left/right split (`-h` flag), `false` = top/bottom split.

#### Modified: `internal/tmux/tmux.go` — `SplitWindow` function

Added `horizontal bool` parameter. When true, passes `-h` flag to `tmux split-window`. Uses `exec.CommandContext` with timeout per constitution.

#### Modified: `api/router.go` — `TmuxOps` interface

Updated `SplitWindow` signature to include `horizontal bool` parameter. Route registered at `r.Post("/api/sessions/{session}/windows/{index}/split", s.handleWindowSplit)`.

#### Modified: `api/sessions_test.go` — mock implementation

Updated `mockTmuxOps.SplitWindow` signature to match new interface.

### Frontend — `app/frontend/`

#### New: `splitWindow` API client function (`src/api/client.ts`)

```typescript
export async function splitWindow(
  session: string,
  index: number,
  horizontal: boolean,
): Promise<{ ok: string; pane_id: string }>
```

#### New: `SplitButton` component (`src/components/top-bar.tsx`)

Inline component in top-bar.tsx rendering two split buttons:
- Horizontal split (vertical divider icon) — `<SplitButton horizontal />`
- Vertical split (horizontal divider icon) — `<SplitButton />`

Both use custom SVG icons (square-split pattern), `text-text-secondary` default color, `hover:border-text-secondary` hover state. Hidden on mobile (`hidden sm:flex`). Only rendered when `currentWindow` exists. Error handling is best-effort (catch and swallow — tmux may reject if pane is too small).

### Top bar layout order

Controls section now: `[●] [⇔] [⫼] [⊟] [◑] [⌘K] [>_]` — connection dot, fixed-width toggle, horizontal split, vertical split, theme toggle, command palette hint, compose button.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document split pane buttons in Chrome (Top Bar) section
- `run-kit/architecture`: (modify) Document new split endpoint in API surface

## Impact

- **Backend**: New route + handler in `api/windows.go`, modified `TmuxOps` interface (breaking change for mock), modified `tmux.SplitWindow` signature
- **Frontend**: New API function, new component in top-bar
- **Tests**: Mock updated to match new interface signature

## Open Questions

None — fully implemented.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Split buttons hidden on mobile | Discussed — follows existing pattern where FixedWidthToggle and ThemeToggle are `hidden sm:flex` | S:90 R:85 A:90 D:95 |
| 2 | Certain | Best-effort error handling (catch and swallow) | Implementation choice — tmux may reject splits on small panes, no meaningful recovery action | S:85 R:90 A:85 D:90 |
| 3 | Certain | Buttons only render when `currentWindow` exists | Implementation choice — can't split a pane without a window context | S:90 R:90 A:95 D:95 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).
