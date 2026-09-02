# Plan: Status Bar Copyable Segments

**Change**: 260902-3m72-status-bar-copyable-segments
**Intake**: `intake.md`

## Requirements

### Frontend: Shared copy-feedback hook

#### R1: Extract the Pane panel's copy interaction into a shared hook
The copy-interaction logic currently local to `WindowContent` in `app/frontend/src/components/sidebar/status-panel.tsx` (selection guard → `copyToClipboard` → keyed `copied` state → single feedback timer with re-copy reset and unmount cleanup) SHALL be extracted into a shared hook `useCopyFeedback` at `app/frontend/src/hooks/use-copy-feedback.ts`, and `status-panel.tsx` SHALL consume it with **zero behavior change** (same 1000ms feedback window, same `window.getSelection()?.toString()` guard, same per-key feedback). The hook returns `{ copiedKey, copy(key, value) }`: `copy` short-circuits when a text selection exists, otherwise fires `void copyToClipboard(value)` and sets `copiedKey` for `COPY_FEEDBACK_MS` (1000ms, owned by the hook).

- **GIVEN** the Pane panel after the refactor
- **WHEN** a user clicks the `cwd` row
- **THEN** the full absolute path is copied and the row prefix shows `copied ✓` for 1s, exactly as before
- **AND** clicking while a text selection exists copies nothing

### Frontend: Status bar left cluster

#### R2: Window-register segments become click-to-copy of raw values
In `app/frontend/src/components/status-bar.tsx`, the `git`, `fab`, `tmx`, and `cwd` segments of `WindowCluster` SHALL become real `<button type="button">` elements (Constitution V — focusable, Enter/Space activatable) that copy the **raw underlying value**, not the display text: git → `activePane.gitBranch`; fab → `parseFabChange(win.fabChange).id` (the 4-char change id); tmx → `activePane.paneId` (e.g. `%42`); cwd → the full absolute path (`activePane.cwd ?? win.worktreePath`). Each carries an `aria-label` naming the action (e.g. `Copy git branch`). The `agt` segment SHALL stay passive (no raw value; mirrors the Pane panel). The `tmx` segment SHALL stay passive when `paneId` is empty (the Pane panel's fork). Feedback: the segment's 3-char label swaps to `copied ✓` for the feedback window (via `useCopyFeedback`); the value span gains `group-hover:text-accent` as the clickability reveal. Existing breakpoint classes (`hidden md:flex`, `hidden lg:flex`, `hidden xl:flex`), truncation (`min-w-0 truncate`), register-name `Tip`s, and display order MUST be preserved — the degradation ladder is untouched.

- **GIVEN** the terminal route at ≥xl width
- **WHEN** the user clicks the `cwd` segment
- **THEN** the full absolute path lands on the clipboard and the `cwd` label reads `copied ✓` for 1s
- **AND** clicking the `fab` segment copies the 4-char change id, `tmx` the pane id, `git` the branch name

#### R3: Right-cluster identity segments become click-to-copy; metrics stay passive
The **server name**, **hostname**, and **version** fragments SHALL become click-to-copy buttons copying their displayed raw strings (server as passed in props; host as displayed — `instanceName ?? metrics.hostname`; version as displayed via `displayVersion`), with `aria-label`s and the same feedback window. These fragments have no 3-char prefix label, so the fragment's own text swaps to `copied ✓` transiently. The **cpu/mem/ld** metrics (and their `MetricsFlyout` hover/focus card), the **connection dot**, **⌘K**, **compose**, and **zen exit** SHALL be unchanged. The hostname+version pair renders as two independently copyable buttons within the existing truncating span (host copies the host string, version copies the version string).

- **GIVEN** any desktop route with metrics and version present
- **WHEN** the user clicks the version fragment
- **THEN** the displayed version string (e.g. `v0.42.1`) is copied and the fragment shows `copied ✓` for 1s
- **AND** the cpu/mem/ld segment renders no button and the MetricsFlyout still opens on hover/focus

### Frontend: Overflow menu

#### R4: Dropped copyable segments get copy-action menu rows
In `OverflowMenu`, the informational rows mirroring **copyable** strip segments (`git`, `tmx`, `cwd`, `version`) SHALL become `role="menuitem"` **buttons** (the existing `actionRow` pattern's element, keeping `tabIndex={-1}` roving-focus reachability and each row's inverse breakpoint class) that copy the same raw values as their strip segments (tmx → pane id; cwd → the **full** path, not the basename shown in the row). The **ld** and **cpu · mem** rows SHALL stay informational spans. The menu SHALL NOT close on copy; feedback is the row's leading register key swapping to `copied ✓` within the row text for the feedback window. Rows MUST remain reachable and activatable via the menu's ArrowUp/ArrowDown roving focus + Enter/Space.

- **GIVEN** a viewport below `lg` with the `…` menu open
- **WHEN** the user arrows to the `tmx` row and presses Enter
- **THEN** the pane id is copied, the row shows `copied ✓`, and the menu stays open

### Frontend: Command palette parity

#### R6: Copy actions register in the command palette (Constitution V)
Every new copy control SHALL have a command-palette entry (Constitution V: the palette is the complete action registry). In `app/frontend/src/app.tsx`: the `windowActions` group (currentWindow branch) gains `Copy: Git Branch`, `Copy: Working Directory`, `Copy: tmux Pane Id`, and `Copy: Fab Change Id` entries — each gated on its raw value's presence and copying the same raw value as the strip segment, with the version palette action's toast feedback pattern (`copyToClipboard(...).then(ok => addToast(...))`); the `serverActions` group gains `Copy: Server Name` (gated on a current server) and `Copy: Host Name` (the InstanceName context's `displayName` — the settings override, else the health hostname; the palette-appropriate equivalent of the bar's `instanceName ?? metrics.hostname`, without subscribing AppShell to the metrics stream). The version copy action already exists (`buildVersionAction`) and is untouched.

- **GIVEN** the palette open on a terminal route with a git branch and fab change
- **WHEN** the user runs `Copy: Git Branch`
- **THEN** the branch name is copied and a confirmation toast shows
- **AND** `Copy: Server Name` / `Copy: Host Name` are available on server routes

### Testing

#### R5: Unit and e2e coverage for the copy affordances
`app/frontend/src/components/status-bar.test.tsx` SHALL be extended (with `copyToClipboard` mocked) to assert: raw values copied per segment (full cwd path, pane id, branch, change id, server, host, version); the selection guard short-circuits; `copied ✓` appears and reverts after the timer; overflow-menu copy rows copy via click and keyboard without closing the menu; `agt`, metrics, and the connection dot render no copy button. The refactored Pane panel keeps its existing `status-panel.test.tsx` suite green unchanged (the behavior-neutral proof). One Playwright case SHALL be added to `app/frontend/tests/e2e/status-bar.spec.ts` following the `sidebar-footer.spec.ts` clipboard precedent (`context.grantPermissions(["clipboard-read", "clipboard-write"])`, click, `navigator.clipboard.readText()`), carrying the constitution-mandated Proves/Steps intent comment.

- **GIVEN** the unit suite with `copyToClipboard` mocked
- **WHEN** the suite runs
- **THEN** every copyable segment's raw-value copy, feedback swap/revert, guard, and overflow keyboard path is asserted
- **AND** the e2e case proves a real clipboard write from a status-bar segment click

### Non-Goals

- The **pr** segment is untouched: it keeps its open-first anchor (no hover copy icon in the 24px strip); the no-URL pr branch stays passive.
- No changes to `sidebar/registers.ts`, the status-pyramid machinery, the mobile experience (no status bar there), or any backend/API surface.
- No visual redesign — segment look at rest is unchanged (transparent button, inherited mono type).

### Design Decisions

#### Feedback for unlabeled right-cluster fragments
**Decision**: Server/host/version fragments swap their own displayed text to `copied ✓` during the feedback window (labeled window-register segments swap only their 3-char label).
**Why**: These fragments have no label prefix; a text swap reuses the one feedback vocabulary without adding tooltips or layout machinery, and a 1s width shift in a truncating flex strip is benign (intake assumption 7).
**Rejected**: A floating "Copied" tooltip — new UI machinery for a transient hint, inconsistent with the Pane panel's swap contract.
*Introduced by*: 260902-3m72-status-bar-copyable-segments

#### Hook shape over component extraction
**Decision**: Share the copy *interaction* as a hook (`useCopyFeedback`), not a shared row/segment component.
**Why**: The two surfaces render differently (sidebar rows vs. 24px strip segments vs. menu rows) but share the identical interaction contract; a hook shares the logic without forcing a common render shape.
**Rejected**: Lifting `CopyableRow` into a shared component — the strip's `Segment` look and the menu's `MENU_ROW_CLASS` rows cannot reuse the Pane panel's row markup.
*Introduced by*: 260902-3m72-status-bar-copyable-segments

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/frontend/src/hooks/use-copy-feedback.ts` (`useCopyFeedback` — keyed copied state, selection guard, `copyToClipboard`, 1000ms timer with re-copy reset + unmount cleanup) and refactor `app/frontend/src/components/sidebar/status-panel.tsx` `WindowContent` to consume it, behavior-neutral (existing `status-panel.test.tsx` stays green unchanged) <!-- R1 -->
- [x] T002 In `app/frontend/src/components/status-bar.tsx`, make the `WindowCluster` git/fab/tmx/cwd segments copy buttons via `useCopyFeedback` (raw values: branch, change id, pane id, full path; label→`copied ✓` swap; `group-hover:text-accent`; aria-labels; agt and empty-paneId tmx stay passive; breakpoint/truncate/Tip structure preserved) <!-- R2 -->
- [x] T003 In `status-bar.tsx`, make the right-cluster server/host/version fragments copy buttons (text→`copied ✓` swap) and convert the `OverflowMenu` git/tmx/cwd/version rows to copy-action menuitem buttons (menu stays open, roving focus + Enter/Space, ld and cpu·mem rows stay informational) <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Extend `app/frontend/src/components/status-bar.test.tsx`: per-segment raw-value copy assertions (mocked `copyToClipboard`), selection-guard short-circuit, feedback swap + revert via fake timers, overflow-row click + keyboard copy with menu kept open, no-button assertions for agt/metrics/dot <!-- R5 -->
- [x] T005 Add one clipboard e2e case to `app/frontend/tests/e2e/status-bar.spec.ts` (grantPermissions + segment click + `navigator.clipboard.readText()`, Proves/Steps intent comment per constitution), then run the frontend unit suite and the status-bar e2e spec <!-- R5 --> <!-- rework: extend with a KEYBOARD-driven overflow-row copy assertion (ArrowDown roving + Enter in a real browser — jsdom cannot synthesize Enter→click on buttons and user-event is not a dep), proving the raw value copies and the menu stays open -->
- [x] T006 In `app/frontend/src/app.tsx`, add the palette copy actions: `Copy: Git Branch` / `Copy: Working Directory` / `Copy: tmux Pane Id` / `Copy: Fab Change Id` in `windowActions` (gated on value presence, raw values, toast feedback per the version action) and `Copy: Server Name` / `Copy: Host Name` in `serverActions`; assert the new entries in the palette/app action tests where the existing groups are covered <!-- R6 --> <!-- rework: cwd palette entry re-gated on the raw value and switched off activePaneCwd (first-pane fallback) to the bar's active-pane rule; change-id comment references swept -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useCopyFeedback` exists at `app/frontend/src/hooks/use-copy-feedback.ts` and `status-panel.tsx` consumes it with no behavioral delta (existing `status-panel.test.tsx` passes unmodified)
- [x] A-002 R2: git/fab/tmx/cwd status-bar segments are real buttons copying branch name / 4-char change id / pane id / full absolute path respectively, with aria-labels
- [x] A-003 R3: server, hostname, and version fragments copy their displayed raw strings; cpu/mem/ld, MetricsFlyout, connection dot, ⌘K, compose, and zen exit are unchanged
- [x] A-004 R4: overflow-menu git/tmx/cwd/version rows are copy-action menuitem buttons copying the same raw values; ld and cpu·mem rows remain informational spans; the menu does not close on copy

### Behavioral Correctness

- [x] A-005 R2: the copied segment's label swaps to `copied ✓` for ~1s and reverts; clicking with an active text selection copies nothing
- [x] A-006 R2: the agt segment and an empty-paneId tmx segment render no button; the pr segment renders the same anchor as before (unchanged markup contract)
- [x] A-007 R2: the degradation ladder is intact — copyable segments keep their exact breakpoint classes (`md`/`lg`/`xl` drops) and truncation behavior

### Scenario Coverage

- [x] A-008 R4: keyboard path proven — menu roving focus reaches a copy row (unit) and a real-browser Enter activation copies the raw value with the menu kept open (e2e)
- [x] A-014 R6: every new copy control has a palette entry — `Copy: Git Branch` / `Copy: Working Directory` / `Copy: tmux Pane Id` / `Copy: Fab Change Id` (window-gated) and `Copy: Server Name` / `Copy: Host Name`; each copies the same raw value and toasts
- [x] A-009 R5: unit assertions cover every copyable segment, the guard, the timer revert, and the overflow keyboard copy; one e2e case proves a real clipboard write from a segment click with the Proves/Steps intent comment

### Code Quality

- [x] A-010 Pattern consistency: new code follows the existing segment/menu-row idioms (Tip usage, MENU_ROW_CLASS, LABEL_CLASS/VALUE_CLASS, presentational-by-contract — copied state component-local, no new props or fetches)
- [x] A-011 No unnecessary duplication: the copy interaction lives once in `useCopyFeedback`, consumed by both `status-panel.tsx` and `status-bar.tsx`; no re-derivation in the bar (mirror-not-rollup preserved)
- [x] A-012 Type narrowing over assertions: no new `as` casts; guards used for optional pane fields
- [x] A-013 Tests included for the added behavior (code-quality MUST); e2e added for the UI change (SHOULD)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- If an item is not applicable, mark checked and prefix with **N/A**

## Deletion Candidates

- None — the shared hook replaces and removes the Pane panel's inline copy state/timer; no existing symbol, file, branch, or configuration is left redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Hook shape (`useCopyFeedback` returning `{copiedKey, copy}`) rather than a shared component; `COPY_FEEDBACK_MS` moves into the hook | Surfaces share the interaction, not the markup; the Pane panel's `handleCopy` is lifted nearly verbatim | S:55 R:85 A:80 D:70 |
| 2 | Confident | Unlabeled right-cluster fragments swap their own text to `copied ✓` (labeled segments swap only the label) | No prefix exists to swap; one feedback vocabulary, no new tooltip machinery; transient width shift benign in a truncating strip | S:45 R:90 A:70 D:60 |
| 3 | Confident | Overflow-row feedback = leading register key swaps to `copied ✓` inside the row text; menu stays open | Mirrors the strip's label swap in the row's own text; intake fixed menu-stays-open | S:50 R:90 A:75 D:70 |
| 4 | Confident | E2e = one chromium-project clipboard case following sidebar-footer.spec.ts's grantPermissions precedent (feasible), added to the existing status-bar.spec.ts | Working precedent in-repo removes the feasibility question; one case satisfies the SHOULD without width-sweep duplication | S:60 R:85 A:85 D:75 |
| 5 | Certain | Host and version copy as two independent buttons inside the existing truncating span | They are distinct values (host string vs `v…` version); a joint copy would fuse unrelated raw values | S:70 R:90 A:85 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
