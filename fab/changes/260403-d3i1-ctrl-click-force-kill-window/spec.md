# Spec: Ctrl+Click Force Kill Window

**Change**: 260403-d3i1-ctrl-click-force-kill-window
**Created**: 2026-04-03
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Sidebar: Ctrl+Click Force Kill

### Requirement: Window Kill Button Ctrl+Click Bypass

The sidebar window × button (`sidebar.tsx`, positioned as an absolute overlay on each window row) SHALL check for `ctrlKey || metaKey` on the click event. When a modifier is held, the button SHALL call `killWindowApi(session, windowIndex)` directly with best-effort error handling (`.catch(() => {})`), stop event propagation, and return — bypassing the `setKillTarget` confirmation flow entirely.

When no modifier is held, the existing behavior SHALL be preserved: `setKillTarget` is called, which opens the kill confirmation dialog.

#### Scenario: Ctrl+Click kills window immediately
- **GIVEN** a sidebar with a visible window × button
- **WHEN** the user Ctrl+clicks (or Cmd+clicks on macOS) the × button
- **THEN** `killWindowApi` is called immediately with the session name and window index
- **AND** no confirmation dialog is shown
- **AND** the click event does not propagate to the parent window-select button

#### Scenario: Normal click shows confirmation
- **GIVEN** a sidebar with a visible window × button
- **WHEN** the user clicks the × button without holding Ctrl/Cmd
- **THEN** the existing kill confirmation dialog is shown
- **AND** no API call is made until the user confirms

### Requirement: Session Kill Button Ctrl+Click Bypass

The sidebar session × button (`sidebar.tsx`, inline in the session row header) SHALL check for `ctrlKey || metaKey` on the click event. When a modifier is held, the button SHALL call `killSessionApi(session)` directly with best-effort error handling (`.catch(() => {})`), and return — bypassing the `setKillTarget` confirmation flow entirely.

When no modifier is held, the existing behavior SHALL be preserved.

#### Scenario: Ctrl+Click kills session immediately
- **GIVEN** a sidebar with a visible session × button
- **WHEN** the user Ctrl+clicks (or Cmd+clicks on macOS) the × button
- **THEN** `killSessionApi` is called immediately with the session name
- **AND** no confirmation dialog is shown

#### Scenario: Normal click shows confirmation
- **GIVEN** a sidebar with a visible session × button
- **WHEN** the user clicks the × button without holding Ctrl/Cmd
- **THEN** the existing kill confirmation dialog is shown

### Requirement: No Backend Changes

The backend kill endpoints (`handleWindowKill`, `handleClosePaneKill`) SHALL NOT be modified. The confirmation bypass is purely a frontend concern — the kill APIs already execute unconditionally.

#### Scenario: API contract unchanged
- **GIVEN** the existing kill window and kill session API endpoints
- **WHEN** this change is applied
- **THEN** the API request/response format remains identical
- **AND** no new endpoints are added

### Requirement: No Top Bar Changes

The `ClosePaneButton` in `top-bar.tsx` SHALL NOT be modified. It already kills without confirmation.

#### Scenario: Top bar close pane unaffected
- **GIVEN** the ClosePaneButton in the top bar
- **WHEN** this change is applied
- **THEN** the button's click behavior remains unchanged (immediate kill, no confirmation)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `ctrlKey \|\| metaKey` for modifier detection | Confirmed from intake #1 — matches ThemeToggle pattern in top-bar.tsx | S:90 R:95 A:95 D:95 |
| 2 | Certain | No backend changes needed | Confirmed from intake #2 — kill endpoints execute unconditionally | S:85 R:95 A:95 D:95 |
| 3 | Certain | No top bar ClosePaneButton changes | Confirmed from intake #3 — already kills without confirmation | S:90 R:95 A:95 D:95 |
| 4 | Confident | Best-effort error handling on force kill (`.catch(() => {})`) | Confirmed from intake #4 — matches ClosePaneButton and SplitButton patterns; SSE reflects actual state | S:70 R:90 A:85 D:80 |
| 5 | Confident | Apply to both session × and window × buttons | Confirmed from intake #5 — user explicitly said "window or session" | S:80 R:85 A:80 D:85 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
