# Intake: Toolbar Polish & Split Pane Controls

**Change**: 260321-y11t-normalize-toolbar-icon-colors
**Created**: 2026-03-21
**Status**: Draft

## Origin

> User noticed via visual inspection that the foreground color of toolbar icons was inconsistent, then expanded scope to add split pane controls, fix the connection status indicator, and fill gaps in the command palette.

## Why

The top bar had inconsistent icon colors, lacked split pane controls (requiring users to reach for tmux keybindings), had a broken connection status dot that never turned red, a command palette missing several actions, and the compose dialog was the only dialog without a heading.

## What Changes

### 1. Normalize toolbar icon colors

**Files**: `top-bar.tsx`, `bottom-bar.tsx`, `arrow-pad.tsx`

Toolbar buttons used an inconsistent mix of `text-text-primary` and `text-text-secondary`. Normalized all inactive toolbar buttons to `text-text-secondary`, keeping `text-accent` for active toggle states.

- **Top bar**: compose button `text-text-primary` → `text-text-secondary`
- **Bottom bar**: Esc, Tab, Ctrl/Alt (inactive), Fn popup trigger → `text-text-secondary`
- **Arrow pad**: trigger button → `text-text-secondary`

### 2. Add split pane buttons (full-stack)

**Files**: `tmux.go`, `router.go`, `sessions_test.go`, `windows.go`, `client.ts`, `top-bar.tsx`

Added "Split vertically" and "Split horizontally" buttons to the top bar next to the fixed-width toggle. Hidden on mobile (`hidden sm:flex`). Icons use Lucide's `square-split-horizontal` and `square-split-vertical`.

- **Backend**: `SplitWindow` now accepts a `horizontal bool` param (passes `-h` to tmux for left/right split). New `POST /api/sessions/{session}/windows/{index}/split` endpoint with `{"horizontal": bool}` body.
- **Frontend**: New `splitWindow` API client method. New `SplitButton` component rendered when a window is active.

### 3. Fix SSE connection status dot

**File**: `session-context.tsx`

The green connection dot never turned red because `EventSource` auto-reconnects, firing `onerror` + `onopen` in rapid succession. Added a 3-second debounce: `onerror` starts a timer, `onopen`/successful message cancels it. The dot only turns gray if SSE hasn't recovered within 3 seconds.

### 4. Command palette additions

**File**: `app.tsx`

Added missing actions to the command palette:
- **Split vertically** / **Split horizontally** (when a window is active)
- **Text input** — opens the compose dialog (when a session is active)
- **Fixed width / Full width toggle** — label reflects current state

### 5. Compose dialog heading

**File**: `compose-buffer.tsx`

Added "Text Input" heading to the compose dialog, matching the style of all other dialogs (`text-xs font-medium mb-2.5`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document toolbar color convention, split pane buttons, command palette actions
- `run-kit/architecture`: (modify) Document split pane API endpoint

## Impact

- **10 files changed**: `tmux.go`, `router.go`, `sessions_test.go`, `windows.go`, `client.ts`, `top-bar.tsx`, `bottom-bar.tsx`, `arrow-pad.tsx`, `session-context.tsx`, `app.tsx`, `compose-buffer.tsx`
- New API endpoint: `POST .../windows/{index}/split`
- Visual + behavioral changes across top bar, command palette, connection indicator, compose dialog

## Open Questions

None — all changes are implemented and verified.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All toolbar buttons use `text-text-secondary` as default foreground | User explicitly requested and confirmed via screenshots | S:95 R:90 A:95 D:95 |
| 2 | Certain | Active toggle states keep `text-accent` styling | User only flagged inactive state inconsistency | S:90 R:90 A:90 D:95 |
| 3 | Certain | Split buttons hidden on mobile | User explicitly requested mobile hiding | S:95 R:90 A:90 D:95 |
| 4 | Certain | Use Lucide `square-split-horizontal` / `square-split-vertical` icons | User explicitly requested these icons | S:95 R:90 A:90 D:95 |
| 5 | Certain | 3-second debounce for connection dot | Standard approach for EventSource reconnect flickering, user approved | S:90 R:85 A:85 D:90 |
| 6 | Certain | Compose dialog heading matches other dialog styles | User requested matching style, derived from existing `dialog.tsx` pattern | S:90 R:90 A:90 D:95 |

6 assumptions (6 certain, 0 confident, 0 tentative, 0 unresolved).
