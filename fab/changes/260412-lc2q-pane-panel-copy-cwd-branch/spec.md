# Spec: Pane Panel — Copy CWD & Git Branch

**Change**: 260412-lc2q-pane-panel-copy-cwd-branch
**Created**: 2026-04-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Copying from the "run" process-only row (when no fab change is active) — process names aren't useful to paste
- Copying from the "agt" agent-state row — idle durations aren't useful to paste
- Copying arbitrary rows elsewhere in the sidebar (Sessions, Tmux panels) — this change is scoped to the Pane panel
- Toast notifications or cross-panel status messages — feedback is strictly inline on the row
- Keyboard shortcut to copy without clicking (e.g., `Cmd+C` when row is focused) — reserved for future work if desired

## Frontend: Pane Panel Copy Interactions

### Requirement: Copyable Rows

The Pane panel (`WindowPanel` / `WindowContent` in `app/frontend/src/components/sidebar/status-panel.tsx`) SHALL render the `tmx`, `cwd`, `git`, and `fab` rows as interactive elements that copy the row's underlying value to the clipboard on activation. The `run` (process-only) and `agt` rows SHALL remain non-interactive plain text.

Copy values per row:

| Row | Copy value | Source field |
|-----|------------|--------------|
| `tmx` | Pane ID | `activePane.paneId` (e.g., `%5`) |
| `cwd` | Full unshortened path | `activePaneCwd` (`activePane.cwd ?? win.worktreePath`) |
| `git` | Branch name | `activePane.gitBranch` |
| `fab` | Change ID | `fabChange.id` (parsed from `win.fabChange`) |

When the `fab` row would be rendered as the `run` variant (no fab state — `fabLine` is null, only `processLine` is shown), the row SHALL be rendered as non-interactive plain text and SHALL NOT be copyable.

When the `tmx` row's pane ID is an empty string (unknown pane), the row SHALL remain non-interactive.

When the `git` row is not rendered (no `gitBranch`), no copyable element exists — there is nothing to make interactive.

#### Scenario: CWD row copies full expanded path
- **GIVEN** the Pane panel displays `cwd …/code/run-kit` (shortened display of `/home/sahil/code/run-kit`)
- **WHEN** the user clicks the cwd row
- **THEN** the clipboard SHALL contain `/home/sahil/code/run-kit`
- **AND** the row label SHALL briefly change from `cwd` to `copied ✓`

#### Scenario: git row copies full branch
- **GIVEN** the Pane panel displays `git 260412-lc2q-pane-panel-copy-cwd-branch`
- **WHEN** the user clicks the git row
- **THEN** the clipboard SHALL contain `260412-lc2q-pane-panel-copy-cwd-branch`

#### Scenario: tmx row copies pane ID
- **GIVEN** the Pane panel displays `tmx pane 1/2 %5`
- **WHEN** the user clicks the tmx row
- **THEN** the clipboard SHALL contain `%5`

#### Scenario: fab row copies change ID
- **GIVEN** the Pane panel displays `fab lc2q some-slug · apply`
- **WHEN** the user clicks the fab row
- **THEN** the clipboard SHALL contain `lc2q`

#### Scenario: run-only row is not copyable
- **GIVEN** the window has no active fab change and the Pane panel displays `run zsh — idle 5m`
- **WHEN** the user clicks the run row
- **THEN** nothing SHALL be copied
- **AND** the row SHALL NOT render as a button (no focus ring, no hover effect)

### Requirement: Inline Copied Feedback

After a successful copy, the affected row's prefix label SHALL briefly swap to a "copied ✓" indicator, then revert to the original label. The swap SHALL persist for approximately 1000ms. Only one row SHALL show the "copied" indicator at a time — clicking a different row SHALL immediately transition the indicator to the new row.

#### Scenario: Feedback reverts after timeout
- **GIVEN** the user has just clicked the cwd row
- **WHEN** 1000ms elapse
- **THEN** the row label SHALL revert from `copied ✓` to `cwd`

#### Scenario: Feedback moves between rows
- **GIVEN** the cwd row is showing `copied ✓`
- **WHEN** the user clicks the git row within the 1000ms window
- **THEN** the cwd row SHALL immediately revert to `cwd`
- **AND** the git row SHALL display `copied ✓`

### Requirement: Hover Affordance

Interactive rows SHALL render with `cursor: pointer` on hover and a subtle background tint (using the `bg-bg-inset` design token or equivalent). Non-interactive rows (`run` process-only, `agt`) SHALL NOT have hover affordance.

#### Scenario: Hover shows clickable affordance
- **GIVEN** the user hovers over the cwd row
- **THEN** the cursor SHALL be a pointer
- **AND** the row background SHALL tint subtly

#### Scenario: Non-interactive rows have no hover affordance
- **GIVEN** the user hovers over the agt row
- **THEN** the cursor SHALL remain the default text cursor
- **AND** the row background SHALL NOT change

### Requirement: Keyboard Accessibility

Interactive rows SHALL be rendered as `<button type="button">` elements with visible focus state (focus ring or outline) and SHALL be activatable via keyboard (`Enter` or `Space`). Button styling SHALL preserve the panel's compact plain-text aesthetic — no default button chrome (no default padding, border, or background in the rest state).

#### Scenario: Keyboard activation triggers copy
- **GIVEN** the cwd row is focused via keyboard tab navigation
- **WHEN** the user presses `Enter`
- **THEN** the clipboard SHALL contain the full cwd path
- **AND** the row label SHALL display `copied ✓`

#### Scenario: Focus ring visible on keyboard focus
- **GIVEN** the user navigates to the cwd row via `Tab`
- **THEN** a visible focus indicator (outline or ring) SHALL be present on the row

### Requirement: Text Selection Guard

When the user has an active text selection (e.g., has dragged across part of a row label to select text for manual copy), activating a copyable row SHALL NOT trigger the copy action. The guard checks `window.getSelection()?.toString() !== ""`. This preserves the native text-selection UX for users who prefer selecting and copying manually.

#### Scenario: Click with active selection does not hijack
- **GIVEN** the user has selected `run-kit` text within the cwd row display
- **WHEN** a click event fires on the row (e.g., releasing the mouse to end the drag)
- **THEN** the clipboard SHALL NOT be overwritten with the full cwd path
- **AND** the "copied ✓" indicator SHALL NOT be shown

#### Scenario: Click without selection copies normally
- **GIVEN** there is no active text selection in the document
- **WHEN** the user clicks the cwd row
- **THEN** the full cwd path SHALL be copied to the clipboard

## Frontend: Clipboard Utility

### Requirement: Shared Clipboard Utility Module

The existing `copyToClipboard` function currently defined in `app/frontend/src/components/terminal-client.tsx` SHALL be moved to a dedicated module at `app/frontend/src/lib/clipboard.ts` so it can be imported without pulling in terminal-client concerns. The function signature and behavior (async, `navigator.clipboard` primary path with `execCommand` fallback) SHALL be preserved unchanged. All existing callers SHALL be updated to import from the new location. No behavioral regression in existing copy flows.

#### Scenario: Existing terminal-client callers continue to work
- **GIVEN** a terminal is open and the user triggers the existing copy flow
- **WHEN** copy is invoked via the terminal's existing mechanism
- **THEN** the clipboard SHALL contain the same content as before this change
- **AND** no console errors SHALL be raised

#### Scenario: Sidebar imports clipboard utility cleanly
- **GIVEN** the sidebar `status-panel.tsx` imports `copyToClipboard` from `@/lib/clipboard`
- **WHEN** the build and typecheck run
- **THEN** the build SHALL succeed without circular-dependency or import errors

## Design Decisions

1. **Row-level click target (Option A) chosen over hover-reveal icon or right-click context menu**
   - *Why*: Matches the sidebar's compact, no-chrome aesthetic. Largest possible click target. Hover affordance (cursor + tint) provides discoverability without adding persistent visual noise.
   - *Rejected*: Hover-reveal icon adds visual clutter and breaks touch-device UX; context menu is hidden, platform-inconsistent, and heavier to implement.

2. **Inline label swap ("cwd" → "copied ✓") chosen as feedback style**
   - *Why*: No layout shift, no new visual element, zero incremental chrome. Compact-panel-friendly.
   - *Rejected*: Inline check icon adds a sibling element and layout shift; background flash is harder to spot on dense text; toast notifications are overkill for a sidebar micro-action.

3. **Copy fully expanded path, not tilde-form**
   - *Why*: Fully expanded paths are universally pasteable (shell, file managers, browsers, docs). Tilde form only works in shells.
   - *Rejected*: Tilde-form copy would require users to mentally re-expand in non-shell contexts.

4. **Extract `copyToClipboard` into `src/lib/clipboard.ts`**
   - *Why*: Sidebar importing from `terminal-client.tsx` creates awkward coupling (sidebar pulls in terminal module just for a utility). Small, low-risk refactor that keeps concerns separated.
   - *Rejected*: Inline duplication in status-panel would drift over time; direct import from terminal-client creates a module-graph smell.

5. **`<button>` semantics with reset styling chosen over `<div onClick>`**
   - *Why*: Constitution principle "Keyboard-First" — every user-facing action MUST be reachable via keyboard. `<button>` is keyboard-activatable and screen-reader-friendly by default.
   - *Rejected*: `<div onClick>` would require manual `tabindex`, `role="button"`, and key handlers — more code for worse a11y.

6. **Single `copiedRow` state variable, not per-row state**
   - *Why*: Only one row can be "just copied" at a time; a single state value avoids four parallel `useState` calls and simplifies the "move feedback between rows" scenario to a single state transition.
   - *Rejected*: Per-row state adds no correctness benefit and complicates the transition logic.

7. **1000ms feedback duration (vs. 1500ms used elsewhere)**
   - *Why*: The Pane panel is denser and the feedback is inline text (more immediate than a popup icon). 1000ms feels snappier without being too fleeting to notice.
   - *Rejected*: 1500ms (matching `tmux-commands-dialog.tsx`) lingers unnecessarily in a tight sidebar.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Copy full expanded cwd path, not the shortened display | Confirmed from intake #1. User explicitly chose option 3a (fully expanded) | S:95 R:95 A:90 D:95 |
| 2 | Certain | Reuse `copyToClipboard()` utility | Confirmed from intake #2. Utility already exists with working fallback | S:90 R:95 A:95 D:95 |
| 3 | Certain | Frontend-only — no backend changes | Confirmed from intake #3. All required fields already on `PaneInfo` | S:90 R:95 A:95 D:95 |
| 4 | Certain | Click entire row to copy (Option A) | Confirmed from intake #4. User explicitly chose over hover-icon and context-menu alternatives | S:95 R:85 A:85 D:90 |
| 5 | Certain | Inline label swap "cwd" → "copied ✓" for ~1000ms | Confirmed from intake #5. User explicitly chose option 1a | S:95 R:90 A:85 D:90 |
| 6 | Certain | Copyable set: tmx, cwd, git, fab; run-only and agt excluded | Confirmed from intake #6. User explicitly added tmx + fab to cwd + git | S:90 R:85 A:85 D:85 |
| 7 | Certain | Hover: cursor-pointer + `bg-bg-inset` tint | Confirmed from intake #7. User explicitly confirmed both | S:90 R:95 A:90 D:90 |
| 8 | Certain | Render interactive rows as `<button type="button">` with reset styling | Confirmed from intake #8. User explicitly chose over `<div onClick>` | S:90 R:90 A:95 D:90 |
| 9 | Certain | Guard copy against active text selection | Confirmed from intake #9. User explicitly confirmed | S:90 R:95 A:90 D:95 |
| 10 | Certain | Extract `copyToClipboard` into `app/frontend/src/lib/clipboard.ts` | Upgraded from intake #10 Confident → Certain. Clean module boundary, all existing callers update, preserves signature | S:90 R:90 A:90 D:90 |
| 11 | Certain | Single `copiedRow` state var tracking last-copied row | Upgraded from intake #11 Confident → Certain. Only one active "copied" indicator possible by design; single state is simplest and matches the spec's row-transition scenario | S:90 R:95 A:90 D:90 |
| 12 | Certain | 1000ms feedback duration | Upgraded from intake #12 Confident → Certain. Codified as spec requirement; existing 1500ms is a different context (modal dialog) | S:85 R:95 A:85 D:85 |
| 13 | Certain | Visual check indicator is "✓" character, not an icon component | Discussed inline in intake (label swap `cwd` → `copied ✓`). Using a Unicode character avoids adding an icon import and matches the sidebar's minimalist text style | S:80 R:95 A:90 D:90 |
| 14 | Certain | Pane ID with empty string is not copyable | Defensive: the existing display conditionally renders `{paneId && \` ${paneId}\`}`; making the whole row copyable when there's nothing to copy would be misleading. Same rule applies to git row (already conditional on gitBranch) and fab row (conditional on fabChange + fabStage) | S:85 R:90 A:95 D:90 |

14 assumptions (14 certain, 0 confident, 0 tentative, 0 unresolved).
