# Quality Checklist: Pane Panel — Copy CWD & Git Branch

**Change**: 260412-lc2q-pane-panel-copy-cwd-branch
**Generated**: 2026-04-13
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Copyable Rows: `tmx`, `cwd`, `git`, `fab` rows in `WindowContent` render as interactive `<button>` elements when their underlying values exist
- [ ] CHK-002 Copyable Rows: `run` (process-only) and `agt` rows remain non-interactive plain text with no cursor/hover effects
- [ ] CHK-003 Copyable Rows: `tmx` row copies `activePane.paneId` (e.g., `%5`)
- [ ] CHK-004 Copyable Rows: `cwd` row copies the full unshortened path (`activePaneCwd`), not the `~`-abbreviated display
- [ ] CHK-005 Copyable Rows: `git` row copies `activePane.gitBranch`
- [ ] CHK-006 Copyable Rows: `fab` row copies `fabChange.id` (4-char change ID)
- [ ] CHK-007 Inline Copied Feedback: prefix swaps to `copied ✓` after a successful copy and reverts after ~1000ms
- [ ] CHK-008 Inline Copied Feedback: only one row shows the `copied ✓` indicator at a time
- [ ] CHK-009 Hover Affordance: interactive rows render `cursor: pointer` and a subtle `bg-bg-inset` (or equivalent) tint on hover
- [ ] CHK-010 Keyboard Accessibility: interactive rows are `<button type="button">` with visible focus ring and keyboard activation (Enter/Space)
- [ ] CHK-011 Text Selection Guard: click with active text selection does not copy; click without selection copies normally
- [ ] CHK-012 Shared Clipboard Utility: `copyToClipboard` lives at `app/frontend/src/lib/clipboard.ts`; `terminal-client.tsx` imports from the new location; signature and fallback behavior preserved

## Behavioral Correctness
- [ ] CHK-013 `<button>` styling reset preserves the existing row visual density — no added padding, border, or background in the rest state
- [ ] CHK-014 Pane ID conditional: when `paneId` is empty string, `tmx` row falls back to non-interactive `<div>` (no button rendered)
- [ ] CHK-015 Fab/run distinction: when `fabLine` is null and `processLine` is shown, the row renders as non-interactive `<div>` (run mode never interactive)

## Scenario Coverage
- [ ] CHK-016 Scenario "CWD row copies full expanded path" verified via unit test with fake `navigator.clipboard`
- [ ] CHK-017 Scenario "git row copies full branch" verified via unit test
- [ ] CHK-018 Scenario "tmx row copies pane ID" verified via unit test
- [ ] CHK-019 Scenario "fab row copies change ID" verified via unit test
- [ ] CHK-020 Scenario "run-only row is not copyable" verified via unit test (assertion that no `<button>` rendered)
- [ ] CHK-021 Scenario "Feedback reverts after timeout" verified via unit test with fake timers advancing 1000ms
- [ ] CHK-022 Scenario "Feedback moves between rows" verified via unit test clicking row A then row B within the window
- [ ] CHK-023 Scenario "Keyboard activation triggers copy" verified (focus + Enter triggers copy)
- [ ] CHK-024 Scenario "Click with active selection does not hijack" verified via unit test mocking `window.getSelection()`

## Edge Cases & Error Handling
- [ ] CHK-025 Rapid successive clicks on same row extend/restart the feedback timer without leaving ghost state (timer is cleared before being reset)
- [ ] CHK-026 Component unmount clears any pending feedback timer (no `setState` after unmount warning)
- [ ] CHK-027 Missing fields (empty `paneId`, null `fabChange`, no `gitBranch`) gracefully skip their row's interactive behavior

## Code Quality
- [ ] CHK-028 Readability: extracted `<CopyableRow>` component and `handleCopy` helper keep `WindowContent` body scannable
- [ ] CHK-029 Pattern consistency: new code follows existing sidebar component patterns (same Tailwind utility classes, same file-local helper placement)
- [ ] CHK-030 No unnecessary duplication: reuses extracted `copyToClipboard` utility rather than inlining
- [ ] CHK-031 Frontend type safety: `CopyableRowKey` union type used; no `as` casts introduced (per code-quality principle "Type narrowing over type assertions")
- [ ] CHK-032 Tests cover added behavior: new unit tests exist in `status-panel.test.tsx` for the copy flows (per code-quality principle "New features MUST include tests")
- [ ] CHK-033 No unnecessary magic numbers: 1000ms feedback duration defined as a named constant

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
