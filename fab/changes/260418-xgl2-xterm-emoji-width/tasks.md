# Tasks: Fix xterm.js emoji / wide-character rendering

**Change**: 260418-xgl2-xterm-emoji-width
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Install `@xterm/addon-unicode-graphemes` as a dependency in `app/frontend/` via `pnpm -C app/frontend add @xterm/addon-unicode-graphemes`. Verify the resulting entry in `app/frontend/package.json` and the updated `app/frontend/pnpm-lock.yaml`.

## Phase 2: Core Implementation

- [x] T002 Add `allowProposedApi: true` to the Terminal constructor options block in `app/frontend/src/components/terminal-client.tsx` (around line 153). Preserve existing options (`cursorBlink`, `fontFamily`, `fontSize`, `theme`).

- [x] T003 In `app/frontend/src/components/terminal-client.tsx`, after `terminal.open(terminalRef.current)` and `fitAddon.fit()` (around line 165) but **before** the WebGL addon load (around line 178), add a dynamic import + load of `UnicodeGraphemesAddon` and set `terminal.unicode.activeVersion = "15-graphemes"`. Match the existing Clipboard / WebLinks pattern: `await import("@xterm/addon-unicode-graphemes")`, a `cancelled` guard that disposes the terminal and returns on teardown, then `terminal.loadAddon(new UnicodeGraphemesAddon())` followed by the `activeVersion` assignment. Place a single-line comment immediately above explaining that xterm defaults to Unicode 6 widths, tmux lays out with wcwidth-based widths, and enabling Unicode 15 graphemes keeps the two in sync.

## Phase 3: Integration & Edge Cases

- [x] T004 Run `cd app/frontend && npx tsc --noEmit` and resolve any type errors. Expected outcome: clean type check.

- [x] T005 Run `just test-frontend` (Vitest unit suite). If a test that exercises the TerminalClient init path fails on the new dynamic import, extend the existing mock surface (e.g. `vi.mock("@xterm/addon-unicode-graphemes", ...)`) to return a no-op addon with a `dispose()` method, matching the pattern used for Clipboard / WebLinks / WebGL mocks. Do not change behavioral assertions.

- [x] T006 Run `just test-e2e` (Playwright). Expected outcome: suite passes without modification. If a test fails due to addon-load timing, investigate and adjust only the mock surface — do not alter visible behavior.

- [x] T007 **N/A**: `TestFetchPaneMapIntegration` in `app/backend/internal/sessions/sessions_test.go:350` fails identically on this branch with frontend changes stashed out and on `main` — pre-existing environmental flake (test's `fab pane map` subprocess returns `tmux list-sessions: exit status 1` in this sandbox). Unrelated to the frontend-only xterm change. To be addressed separately.

## Phase 4: Polish

- [x] T008 **Proceeded without manual smoke** — user opted to ship the pipeline before running the visual verification (Playwright MCP unavailable in the autonomous session). Manual smoke check (`printf 'ASCII before \xe2\x9c\x85 ASCII after\n'` in a pane at desktop + mobile viewports) is still the definition-of-done; if ghost overlap persists post-merge, open a follow-up to investigate the WebGL renderer (Non-Goal in this change).

- [x] T009 Update `docs/memory/run-kit/ui-patterns.md`: add a short subsection adjacent to `### Terminal Font Bundling` (new heading e.g. `### Terminal Unicode Width Handling`) documenting that TerminalClient constructs `new Terminal({ allowProposedApi: true, ... })` and activates `"15-graphemes"` via `@xterm/addon-unicode-graphemes`, with a one-line rationale (tmux / xterm width alignment).

---

## Execution Order

- T001 blocks T002, T003 (addon import fails without the dep).
- T002 and T003 both edit `terminal-client.tsx` and MUST run sequentially.
- T004 blocks T005 / T006 (type errors surface first).
- T005 / T006 / T007 are independent test gates once code is in place and can be verified in any order.
- T008 (manual smoke) runs after T005–T007 pass.
- T009 (memory) can run in parallel with T004–T008; no code dependency.
