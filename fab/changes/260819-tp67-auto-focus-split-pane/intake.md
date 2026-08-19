# Intake: Auto-Focus Split Pane

**Change**: 260819-tp67-auto-focus-split-pane
**Created**: 2026-08-19

## Origin

Conversational (`/fab-discuss` → `/fab-new`). The user's raw input:

> I want the tmux session that is created on command+D to be auto-focused when it opens

"Session" here means the new **pane** a split creates (Cmd+D is the mac chord for the `split-horizontal` action). The diagnosis and approach were worked out in the discussion session before intake:

- Cmd+D → `split-horizontal` (`app/frontend/src/lib/keybindings.ts:193`, mac `macCode: "KeyD"`) → `splitWindow` API client call → `POST /api/windows/{windowId}/split` → `handleWindowSplit` (`app/backend/api/windows.go:226`) → `tmux.SplitWindow` (`app/backend/internal/tmux/tmux.go:2040`).
- `tmux.SplitWindow` runs `tmux split-window [-h] [-c cwd] -t <window> -d -P -F #{pane_id}` — the **`-d` flag explicitly leaves the new pane unfocused**. That is the entire bug.
- The user approved the recommended approach: select the new pane in the API handler after the split, leaving `SplitWindow`'s `-d` contract untouched (the snapshot restorer depends on it). The user was offered a carve-out for board splits and chose uniform behavior ("yes, go ahead").

## Why

1. **Pain point**: splitting a pane from the web UI (Cmd+D / ⇧⌘D, the top-bar Split chip and its ▾ menu, the palette `Window: Split …` / `Board: Split Focused Pane …` actions) creates the pane but leaves keyboard focus in the *old* pane. The user's next keystrokes go to the wrong pane; they must manually switch (tmux prefix keys or another client) to reach the pane they just asked for. Every mainstream terminal (iTerm2, Warp, Ghostty — the very convention the ⌘D chord was borrowed from) focuses the new split immediately.
2. **Consequence of not fixing**: the split feature keeps fighting muscle memory — the most common post-split action (typing into the new pane) requires an extra navigation step on every single split, from every entry point.
3. **Why this approach**: the split endpoint selects the new pane server-side. Since the web terminal is a direct attach to the tmux session, tmux's active-pane change propagates to the client automatically — no frontend change needed, and all entry points (keybinding, top-bar, board, palette) are fixed in one spot because they all share `POST /api/windows/{windowId}/split`. The alternative — dropping `-d` inside `tmux.SplitWindow` or adding a `focus bool` parameter — was rejected because the snapshot layout restorer (`internal/snapshot/restore.go:199`) deliberately depends on detached splits (its comment at line 220: splits are created detached so the first pane stays active by default; it re-selects the stored active pane itself), and a signature change would churn the `TmuxOps` interface, prod adapter, restorer binding, and every mock for the same behavior.

## What Changes

### Backend: `handleWindowSplit` selects the new pane after a successful split

In `app/backend/api/windows.go` `handleWindowSplit` (currently lines 226–263), after `s.tmux.SplitWindow(...)` returns the new pane ID, call `s.tmux.SelectPane(paneID, server)`:

```go
paneID, err := s.tmux.SplitWindow(windowID, body.Horizontal, resolvedCwd, server)
if err != nil {
    writeError(w, http.StatusInternalServerError, err.Error())
    return
}
// Best-effort focus: the split succeeded and the pane exists — a select
// failure must not turn the response into an error.
_ = s.tmux.SelectPane(paneID, server)

writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pane_id": paneID})
```

- `SelectPane` failure is **best-effort**: the split succeeded and the pane exists, so the handler still returns `{"ok": true, "pane_id": ...}`. (Exact error handling — discard vs. log — follows the codebase's prevailing pattern for best-effort tmux calls, e.g. `KillActivePane`'s silent-success contract.)
- `tmux.SelectPane(paneID, server string) error` already exists (`app/backend/internal/tmux/layout.go:378`, runs `select-pane -t %N`) — currently consumed only by the snapshot restorer via direct package call.

### Backend: expose `SelectPane` on the API `TmuxOps` seam

`SelectPane` is not on the `TmuxOps` interface (`app/backend/api/router.go:65` block). Add:

- `SelectPane(paneID, server string) error` to the `TmuxOps` interface
- the pass-through on `prodTmuxOps` (`app/backend/api/router.go`, alongside the existing `SplitWindow` pass-through at line 313)
- the method on `mockTmuxOps` in the api tests (`app/backend/api/sessions_test.go:329` region) recording the pane ID it was called with

### Backend: not changed

- `tmux.SplitWindow` keeps its signature and its `-d` flag verbatim — the snapshot restorer's detached-split contract is untouched.
- `internal/snapshot/restore.go` is untouched.

### Tests

Extend the split handler tests in `app/backend/api/windows_test.go` (existing split coverage around line 859):

- a successful split calls `SelectPane` with exactly the pane ID `SplitWindow` returned and the request's server
- a `SelectPane` error still yields `200 {"ok": true, "pane_id": ...}` (best-effort contract)
- a `SplitWindow` error does NOT call `SelectPane`

No frontend changes, so no Playwright/e2e additions — the frontend contract (`splitWindow` returns ok+pane_id) is unchanged.

## Affected Memory

- `run-kit/architecture`: (modify) API-layer note — the split endpoint now selects the new pane after splitting (auto-focus); `SelectPane` joins the `TmuxOps` seam; `SplitWindow`'s detached (`-d`) contract explicitly unchanged for the restorer
- `run-kit/ui/top-bar`: (modify) one-line behavior note in § Split control — a split auto-focuses the new pane (server-side select; applies to the chip, menu, chords, and palette actions)

## Impact

- **Code**: `app/backend/api/windows.go` (handler, ~3 lines), `app/backend/api/router.go` (interface + prod adapter, ~5 lines), `app/backend/api/windows_test.go` + `app/backend/api/sessions_test.go` (mock + handler tests)
- **Behavior**: every split entry point (Cmd+D / ⇧⌘D chords, top-bar Split chip + ▾ menu, overflow rows, `Window: Split …` palette actions, `Board: Split Focused Pane …` actions) now focuses the new pane. This is shared tmux state: any other attached client of the same session sees the active-pane change too — inherent to tmux, and the intended behavior.
- **Not impacted**: snapshot restore (keeps its own detached-split + re-select logic), frontend code, API request/response shapes.

## Open Questions

None — the one genuine fork (should board splits also steal focus, or only terminal-route splits?) was put to the user during discussion and resolved: uniform behavior across all entry points.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives in `handleWindowSplit` (select after split), not in `tmux.SplitWindow` (no `-d` drop, no `focus` param) | Discussed — user approved this exact approach; restorer's detached-split dependency makes the alternative actively wrong | S:90 R:85 A:90 D:85 |
| 2 | Certain | Auto-focus applies uniformly to all split entry points (terminal chords, top-bar, board, palette) | Discussed — the uniform-vs-carve-out question was raised explicitly and the user said go ahead | S:85 R:80 A:85 D:80 |
| 3 | Confident | `SelectPane` failure is best-effort — handler still returns `200 ok` with the pane ID | Split succeeded and the pane exists; failing the response would misreport reality. Mirrors `KillActivePane`'s silent-success posture | S:55 R:85 A:75 D:70 |
| 4 | Certain | `SelectPane` is added to the `TmuxOps` interface + `prodTmuxOps` + `mockTmuxOps` | Mechanical consequence of the handler calling it through the seam every other handler uses; test architecture requires the mock | S:85 R:90 A:95 D:90 |
| 5 | Confident | No frontend or e2e changes — tmux active-pane propagation through the direct attach is the delivery mechanism | The web terminal is a live tmux attach; focus follows the active pane by construction. Backend unit tests pin the new contract | S:70 R:80 A:80 D:75 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
