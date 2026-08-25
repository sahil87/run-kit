# Intake: Remove Session Create at Folder

**Change**: 260823-fe74-remove-session-create-at-folder
**Created**: 2026-08-23

## Origin

Conversational follow-up to 260823-qe3n (the session name prompt). During that change the user asked for an analysis of whether the palette's `Session: Create at Folder` action is really needed ("I have never used it"), then explicitly ordered the removal:

> and yes, after you are done with this PR, start working on the "Session: Create at Folder" removal as a different change

The analysis (delivered in-conversation): the action's only unique capability is rooting a *session* at an arbitrary directory from the web UI; its component (`CreateSessionDialog`) is shared with the still-wanted `Tab: Create at Folder` window mode; the cost of keeping it is near zero but the user confirmed it is unused and wants it gone.

## Why

1. **Pain point**: the palette carries an action the user never uses. With 260823-qe3n landed, the keyboard flow (`Session: Create`) already prompts for a name; the at-folder variant's remaining value — picking a starting directory for a *session* — has no observed use. Unused actions dilute the palette (Constitution V makes the palette the primary discovery surface; every listed action competes for attention).
2. **Consequence of not fixing**: permanent palette noise, plus dead session-mode code paths in `CreateSessionDialog` that every future dialog change must reason about.
3. **Why removal over hiding**: hiding leaves the code and the maintenance cost; the user's decision is that the capability itself is not needed. The escape hatch remains trivial — create a session (prompted or instant) and `cd` in the pane, or use `Tab: Create at Folder` for the per-window case, which stays.

## What Changes

### 1. Palette action removed (`app.tsx`)

Delete from `sessionActions`: the `create-session-at-folder` entry (`Session: Create at Folder`). Delete its supporting wiring: the `showCreateSessionAtFolderDialog` state, its term in the `dialogOpenRef` predicate, its `setShowCreateSessionAtFolderDialog` memo dep, and the session-mode `<CreateSessionDialog sessions=… defaultPath=…>` mount. `Tab: Create at Folder` (`create-window-at-folder`, `showCreateWindowAtFolderDialog`, the `mode="window"` mount) is **untouched in behavior**.

### 2. `CreateSessionDialog` becomes window-only

With the session-mode entry gone, the component's session branch is dead code (the removed palette entry was its only session-mode caller). Trim `create-session-dialog.tsx` to the window flow: drop the `mode`/`sessions` props and the session-name input, collision check, `createSession` optimistic-ghost path, making `session` a required prop; keep the path input + `getDirectories` autocomplete + quick-picks + `createWindow` submit exactly as they are. The dialog title is always "Create tab at folder". (File keeps its name — renaming would churn imports for no behavioral gain; a rename can ride a later cleanup if wanted.)

### 3. Reference cleanup

- `app.test.tsx`: remove/adjust the palette cases asserting the `Session: Create at Folder` row (present-row test, the "both create entries" search test); keep the `Window: Create at Folder` cases.
- Comment mentions of the removed entry updated minimally: the `top-bar.tsx` breadcrumb comment (lists creation entry points) and the `session-name-prompt.tsx` doc comment ("`Session: Create at Folder` remains the path flow" → point at `Tab: Create at Folder`).
- Unit tests for `create-session-dialog` (if any exist) updated to the window-only surface.

### 4. Stacking note (branch/PR mechanics)

This change edits the exact `app.tsx` regions 260823-qe3n touched (adjacent `sessionActions` entries, `dialogOpenRef`, adjacent mounts), so its branch is deliberately **stacked on qe3n's branch** (PR #717, unmerged at creation time). The PR diff will include qe3n's commits until #717 merges; after the merge a rebase onto main cleans it. The PR body must carry a "stacked on #717" note.

## Affected Memory

- `run-kit/ui/keyboard-and-palette`: (modify) remove the `create-session-at-folder` row from the creation-actions table
- `run-kit/ui/routes-and-shell`: (modify) § Folder-Prompted Creation becomes window-only (`Tab: Create at Folder`); the design decision referencing the secondary session entry updated
- `run-kit/ui/dialogs-and-state`: (modify) § Create Session Dialog rewritten to the window-only surface; § Session Name Prompt's "no path picker" sentence re-pointed; frontmatter description updated

## Impact

- `app/frontend/src/app.tsx` — palette entry + dialog state/mount removal
- `app/frontend/src/components/create-session-dialog.tsx` — session-mode trim (window-only)
- `app/frontend/src/app.test.tsx`, `create-session-dialog` unit tests — case updates
- `app/frontend/src/components/top-bar.tsx`, `session-name-prompt.tsx` — comment-only touches
- No backend/API change (`getDirectories`, `createSession` endpoints untouched — `createSession` still serves the prompt/instant flows)

## Open Questions

- None — the removal is user-ordered; remaining choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove the palette entry + its dialog state/mount; keep `Tab: Create at Folder` fully intact | User's explicit order scoped to the Session variant; the window variant was never questioned | S:90 R:75 A:90 D:90 |
| 2 | Confident | Trim `CreateSessionDialog` to window-only (drop `mode`/`sessions` props, session-name input, session create path) rather than leaving dead session code | Dead-code anti-pattern in code-quality.md; the removed entry was the only session-mode caller; git history preserves the code | S:55 R:70 A:85 D:70 |
| 3 | Confident | Keep the filename `create-session-dialog.tsx` despite the window-only surface | Rename churns imports for zero behavior; can ride a later cleanup | S:40 R:90 A:75 D:60 |
| 4 | Certain | Branch stacked on qe3n's branch (not fresh main) | Both changes edit the same adjacent `app.tsx` lines; basing on main guarantees conflicts; PR body flags the stack on #717 | S:75 R:80 A:90 D:85 |
| 5 | Confident | Comment references updated minimally in the same commit | Stale comments naming a removed action are misinformation; minimal touch respects the sibling-change overlap posture | S:60 R:90 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
