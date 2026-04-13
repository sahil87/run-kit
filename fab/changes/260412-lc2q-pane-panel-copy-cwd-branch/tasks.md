# Tasks: Pane Panel — Copy CWD & Git Branch

**Change**: 260412-lc2q-pane-panel-copy-cwd-branch
**Spec**: `spec.md`
**Intake**: `intake.md`

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
