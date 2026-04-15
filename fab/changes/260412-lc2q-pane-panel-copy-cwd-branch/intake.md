# Intake: Pane Panel — Copy CWD & Git Branch

**Change**: 260412-lc2q-pane-panel-copy-cwd-branch
**Created**: 2026-04-13
**Status**: Draft

## Origin

> Understand the left panel layout. I want easy way to be able to copy cwd and git branch from the Pane panel. Discuss ideas before executing.

Conversational mode — user wants to discuss interaction design before implementation.

## Why

The Pane panel in the sidebar shows useful metadata — cwd and git branch — but there's no way to copy these values. Users frequently need to paste a path or branch name into a terminal, chat, or PR description. Currently the only option is to manually type or navigate elsewhere to get this info.

This is a small but high-frequency UX friction point: the information is visible but not actionable.

## What Changes

### `app/frontend/src/components/sidebar/status-panel.tsx`

Add click-to-copy behavior to the following rows in the `WindowContent` component. Each row becomes a `<button>` element that, when clicked, copies the full unabridged value to clipboard and shows inline feedback.

**Copyable rows and their copy values**:

| Row | Display format | Copy value |
|-----|---------------|-----------|
| `tmx pane 1/2 %5` | pane index + pane ID | Pane ID (e.g., `%5`) |
| `cwd ~/code/run-kit` | shortened path | Full expanded path (e.g., `/home/sahil/code/run-kit`) |
| `git 260412-lc2q-...` | full branch name | Full branch name (no shortening today, copy as-is) |
| `fab lc2q some-slug · apply` | fab state line | Change ID (e.g., `lc2q`) |
| `run process-name — idle 3m` | process line | **Not copyable** — process names aren't useful to paste |
| `agt idle 3m` | agent state | **Not copyable** — not useful to paste |

**Interaction behavior**:

1. **Click**: Full value is copied via the existing `copyToClipboard()` utility.
2. **Feedback**: The row's prefix label briefly swaps to a "copied" indicator for ~1000ms, then reverts. For example, `cwd ~/code/run-kit` → `cwd copied ✓` → (reverts). This matches the panel's compact no-chrome aesthetic (Option 1a).
3. **Hover affordance**: Row shows `cursor: pointer` and a subtle background tint (`hover:bg-bg-inset` or equivalent) to signal clickability.
4. **Keyboard accessibility**: Rows become `<button type="button">` elements with focus ring and keyboard activation (Enter/Space). Styling is reset to preserve the compact plain-text look (no default button chrome — remove padding, border, background, etc.).
5. **Text-selection guard**: The click handler checks `window.getSelection()?.toString()` — if text is currently selected, copy is skipped so the user's manual text selection isn't hijacked.

### State management

Each copyable row tracks its own "just copied" state. Simplest pattern: a single piece of state in `WindowContent` that stores which row was just copied (e.g., `copiedRow: "tmx" | "cwd" | "git" | "fab" | null`), reset via `setTimeout` after 1000ms.

### Existing patterns to reuse

- `copyToClipboard()` utility already exists in `app/frontend/src/components/terminal-client.tsx` (lines 25-50) — handles both `navigator.clipboard` and fallback. May be extracted to `app/frontend/src/lib/clipboard.ts` for cleaner reuse (avoiding circular import from `terminal-client`).
- The "check icon after copy" pattern in `app/frontend/src/components/tmux-commands-dialog.tsx` (lines 24-39, 65-68) shows the general timer-based state reset — we use a simpler text swap, not an icon.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document Pane panel copy interaction pattern

## Impact

- **Files**: `app/frontend/src/components/sidebar/status-panel.tsx` (primary), possibly extract `copyToClipboard` to a shared util
- **Scope**: Frontend-only change, no backend or API modifications needed
- **Risk**: Very low — additive UI enhancement, no existing behavior modified

## Open Questions

None — all interaction details discussed and locked in.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Copy the full unshortened cwd path, not the truncated display | Discussed — user confirmed. Truncated path is useless for pasting; fully expanded path (not tilde form) is universally pasteable | S:95 R:95 A:90 D:95 |
| 2 | Certain | Reuse existing `copyToClipboard()` utility | Function already exists in terminal-client.tsx with proper fallback handling | S:90 R:95 A:95 D:95 |
| 3 | Certain | Frontend-only change — no backend modifications | All required data (cwd, gitBranch, paneId) already available in the PaneInfo type | S:90 R:95 A:95 D:95 |
| 4 | Certain | Click entire row to copy (Option A) | Discussed — user chose row-click over hover icon / context menu. Matches sidebar's compact no-chrome aesthetic | S:95 R:85 A:85 D:90 |
| 5 | Certain | Feedback is inline label swap ("cwd" → "copied ✓") for ~1000ms | Discussed — user chose option 1a over icon / flash / toast. Matches compact aesthetic | S:95 R:90 A:85 D:90 |
| 6 | Certain | Copyable rows: tmx (pane ID), cwd (full path), git (branch), fab (change ID) | Discussed — user added tmx + fab to cwd/git scope. Agent row and process-only run row excluded (values aren't useful to paste) | S:90 R:85 A:85 D:85 |
| 7 | Certain | Hover affordance: cursor-pointer + subtle bg tint (`hover:bg-bg-inset`) | Discussed — user confirmed both together. Standard discoverability without visual noise at rest | S:90 R:95 A:90 D:90 |
| 8 | Certain | Rows become `<button type="button">` with focus ring and keyboard activation | Discussed — user chose button over div-with-onClick. Keyboard-first principle from constitution | S:90 R:90 A:95 D:90 |
| 9 | Certain | Guard click handler against active text selection | Discussed — user confirmed. Preserves manual text-selection UX | S:90 R:95 A:90 D:95 |
| 10 | Confident | Extract `copyToClipboard` into `app/frontend/src/lib/clipboard.ts` | The utility currently lives in `terminal-client.tsx`; importing from there into sidebar creates awkward coupling. Small refactor keeps sidebar decoupled from terminal concerns | S:75 R:90 A:85 D:80 |
| 11 | Confident | Single `copiedRow` state variable tracking which row was last copied (vs per-row state) | Simpler than 4 separate useState hooks; only one row can be in "copied" state at a time so no correctness loss | S:80 R:95 A:90 D:85 |
| 12 | Confident | Feedback duration 1000ms (matches existing pattern in tmux-commands-dialog is 1500ms, but 1000 feels snappier for tight sidebar) | Slightly shorter than existing pattern because panel is more information-dense | S:70 R:95 A:80 D:70 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
