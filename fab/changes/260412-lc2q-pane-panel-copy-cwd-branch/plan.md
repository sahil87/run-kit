# Plan: Pane Panel — Copy CWD & Git Branch

**Change**: 260412-lc2q-pane-panel-copy-cwd-branch
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/clipboard.ts` exporting `copyToClipboard(text: string): Promise<void>`. Move the implementation from `app/frontend/src/components/terminal-client.tsx` (currently at lines ~25-50). Preserve the exact signature and behavior: `navigator.clipboard.writeText` primary path, with textarea + `execCommand("copy")` fallback for non-secure contexts.
- [x] T002 Update `app/frontend/src/components/terminal-client.tsx` to import `copyToClipboard` from `@/lib/clipboard` and remove the local definition. All existing call sites inside this file use the imported version; no behavior change.

## Phase 2: Core Implementation

- [x] T003 In `app/frontend/src/components/sidebar/status-panel.tsx`, add a `CopyableRowKey` union type (`"tmx" | "cwd" | "git" | "fab"`) and introduce a single state variable `const [copiedRow, setCopiedRow] = useState<CopyableRowKey | null>(null)` inside `WindowContent`. Import `useState` from `react` and `copyToClipboard` from `@/lib/clipboard`.
- [x] T004 In `app/frontend/src/components/sidebar/status-panel.tsx`, implement a `handleCopy(key: CopyableRowKey, value: string)` helper inside `WindowContent` that: (a) guards with `if (window.getSelection()?.toString()) return;`, (b) calls `void copyToClipboard(value)`, (c) calls `setCopiedRow(key)`, (d) schedules `setCopiedRow(null)` via `setTimeout` after 1000ms. Use a `useRef`-backed timer so rapid successive clicks cancel the previous timeout (`clearTimeout` on the stored ID before setting a new one). Also clear the timer on component unmount via `useEffect` cleanup.
- [x] T005 In `app/frontend/src/components/sidebar/status-panel.tsx`, extract a reusable `<CopyableRow>` component (defined in the same file, not exported) that accepts `{ prefix: string; copied: boolean; onCopy: () => void; children: ReactNode; className?: string; title?: string }`. It renders as `<button type="button" onClick={onCopy} className="...base row styles... text-left w-full cursor-pointer hover:bg-bg-inset focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ..." title={title}>` containing `<span className="text-text-secondary">{copied ? "copied ✓ " : \`${prefix} \`}</span>{children}`. Preserve the existing `truncate` class and typography. Reset all default button chrome (no background, border, or padding in rest state — match existing `<div>` styling exactly).
- [x] T006 Convert the `tmx` row in `WindowContent` to use `<CopyableRow>` when `paneId` is non-empty. Pass `prefix="tmx"`, `copied={copiedRow === "tmx"}`, `onCopy={() => handleCopy("tmx", paneId)}`. Body unchanged: `<span className="text-text-secondary">pane {activePaneIndex + 1}/{paneCount}{paneId && \` ${paneId}\`}</span>`. When `paneId` is empty, render the existing non-interactive `<div>` variant.
- [x] T007 Convert the `cwd` row in `WindowContent` to use `<CopyableRow>`. Pass `prefix="cwd"`, `copied={copiedRow === "cwd"}`, `onCopy={() => handleCopy("cwd", activePaneCwd)}`, and `title={activePaneCwd}`. Body unchanged: `<span className="text-text-primary">{cwd}</span>`.
- [x] T008 Convert the `git` row in `WindowContent` to use `<CopyableRow>` (already gated on `gitBranch` truthiness). Pass `prefix="git"`, `copied={copiedRow === "git"}`, `onCopy={() => handleCopy("git", gitBranch)}`. Body unchanged: `<span className="text-accent">{gitBranch}</span>`.
- [x] T009 Convert the `fab` row in `WindowContent` to use `<CopyableRow>` ONLY when `fabLine` is non-null (i.e., `fabChange && win.fabStage`). When `fabLine` is null and `processLine` is shown, render the existing non-interactive `<div>`. For the fab variant, pass `prefix="fab"`, `copied={copiedRow === "fab"}`, `onCopy={() => handleCopy("fab", fabChange.id)}`. Body unchanged: includes the `BrailleSpinner` when active, plus `<span className={fabLine ? "text-accent" : "text-text-secondary"}>{runLine}</span>`. Note: because the fab vs run distinction changes interactivity, the two cases render as separate JSX branches in the component rather than a single unified row.

## Phase 3: Integration & Edge Cases

- [x] T010 [P] Write a Vitest unit test at `app/frontend/src/components/sidebar/status-panel.test.tsx` covering: (a) clicking cwd row copies full path via mocked clipboard, (b) clicking git/tmx/fab rows copies expected values, (c) after click the prefix swaps to "copied ✓" and reverts after ~1000ms (use fake timers), (d) active text selection guards suppress copy, (e) process-only row (no fab state) is not rendered as a button, (f) empty paneId renders non-interactive. Mock `copyToClipboard` from `@/lib/clipboard`. Follow existing sidebar test patterns if any (search `app/frontend/src/components/sidebar/**/*.test.tsx` first).
- [x] T011 [P] Run `just test-frontend` to confirm no regressions in existing frontend tests (particularly any tests touching `terminal-client.tsx` copy behavior). If any tests fail due to the utility move, update their imports to `@/lib/clipboard`.
- [x] T012 Run `just test-backend` as a smoke check — this change is frontend-only so backend tests should be unaffected, but the constitution's test-integrity principle calls for confirming both sides.

## Phase 4: Polish

- [x] T013 Run `just build` (or equivalent full typecheck + bundle) to confirm `tsc --noEmit && vite build` succeeds cleanly with no warnings related to the changed files. Resolve any type errors surfaced by the button conversion or clipboard extraction.

---

## Execution Order

- T001 → T002 (T002 imports the utility created in T001)
- T001, T002 → T003-T009 (status-panel imports the extracted utility)
- T003 → T004 (handleCopy uses state from T003)
- T004 → T005 (CopyableRow accepts the callback from T004)
- T005 → T006, T007, T008, T009 (each row conversion uses CopyableRow)
- T006-T009 can be done as a batch in a single focused edit since they share the same component
- T010 (tests) depends on T003-T009 (needs the component behavior to test)
- T010, T011, T012 [P] — test groups are independent
- T013 runs last — final build validation

## Acceptance

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
