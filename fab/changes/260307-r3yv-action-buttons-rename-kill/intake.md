# Intake: Rename Action + Kill Label Cleanup

**Change**: 260307-r3yv-action-buttons-rename-kill
**Created**: 2026-03-07
**Status**: Draft

## Origin

> Add new action buttons, both to project and terminal page: Rename. And Change "Kill Window" to just "Kill".

User scoped to two changes: add a Rename action on both pages, and shorten the Kill button label. Additional actions (respawn, clear scrollback, interrupt, kill session) were explored and deferred.

## Why

Renaming a tmux window currently requires dropping to the terminal and running `tmux rename-window` — there's no UI for it. The "Kill Window" label on the terminal page is verbose when the page context already makes "window" obvious.

Both changes make the UI more self-sufficient and align with Constitution V (Keyboard-First) by exposing rename through the command palette.

## What Changes

### 1. Rename Window Action

Add a "Rename" button and command palette entry on **both** pages:

- **Project page**: Palette action "Rename focused window" (shortcut: `r`). Opens a dialog pre-filled with the current window name. On submit, calls `tmux rename-window`.
- **Terminal page**: Line 2 button "Rename" + palette action. Same dialog behavior.
- **API**: New `renameWindow` action in `POST /api/sessions` accepting `{ action: "renameWindow", session, index, name }`.
- **tmux.ts**: New `renameWindow(session, index, name)` function wrapping `tmux rename-window -t {session}:{index} {name}`.
- After rename, the URL `name` query parameter and breadcrumb should reflect the new name (SSE will push the update).

### 2. Shorten "Kill Window" to "Kill"

- **Terminal page**: Change the line 2 button label from "Kill Window" to "Kill".
- **Command palette**: Change terminal page palette action label from "Kill this window" to "Kill window" (keep "window" in palette for searchability, but the button itself is just "Kill").

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Line 2 content table, keyboard shortcuts, and add rename dialog documentation

## Impact

- **API route** (`src/app/api/sessions/route.ts`): New `renameWindow` action case
- **tmux.ts** (`src/lib/tmux.ts`): New `renameWindow` wrapper function
- **project-client.tsx**: New palette action + rename dialog
- **terminal-client.tsx**: New rename button + palette action + rename dialog, kill label change
- **command-palette.tsx**: No structural changes — consumes palette actions from pages
- **validate.ts**: Existing `validateName` reused for rename input

## Open Questions

None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux rename-window` for rename | Only tmux API for this operation; codebase pattern established in tmux.ts | S:80 R:90 A:95 D:95 |
| 2 | Certain | Reuse existing Dialog component for rename input | All dialogs in the app use `src/components/dialog.tsx`; same pattern as create window | S:85 R:95 A:95 D:95 |
| 3 | Certain | Register all new actions in command palette | Constitution V mandates keyboard-first; existing pattern for all actions | S:90 R:90 A:95 D:95 |
| 4 | Confident | Shortcut `r` for rename on project page | Available key, mnemonic, consistent with existing single-char shortcuts (n, x, s) | S:70 R:90 A:80 D:75 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
