# tty-progress.spec.ts

End-to-end coverage for the tty tile's OSC 9;4 task-progress rendering
(change `260819-1vxq-terminal-tile-progress`): a passthrough-wrapped
progress sequence printed inside a real tmux pane lights the tile's 2px
progress line and header percent chip, and a state-0 remove clears them.
The spec doubles as the regression guard on the tmux passthrough transport:
raw OSC 9;4 is swallowed by tmux (spike-verified 2026-08-19), so the wrapped
`\ePtmux;…\e\\` form (inner ESCs doubled) riding the embedded conf's
`allow-passthrough on` is the only viable feed.

## Shared setup

- `beforeAll` creates a detached 80×24 session `e2e-tty-progress` (single
  default-shell window) on the isolated e2e tmux server; `afterAll` kills it.
- `paneRun` types a shell command into the session's current window via
  `tmux send-keys` (argument-array `execFileSync`, exact-match `=session:`
  target); `emitProgress(state, value)` runs a `printf` of the wrapped
  OSC 9;4 sequence with printf-octal escapes.

## wrapped set lights the line + chip; wrapped remove clears both

**What it proves**: A wrapped `OSC 9;4;1;42` emitted by a program inside the
pane renders the determinate progress line (`aria-valuenow` 42) and the `42%`
header chip on the terminal-route tty tile, entirely client-side (no backend,
no SSE); a wrapped `OSC 9;4;0;0` removes both. Progress is per-viewer
ephemeral, so the set-emit retries until the attached client renders it — an
emit that races the relay attach is legitimately lost.

**Steps**:
1. Resolve the session's first window from the snapshot and navigate to its
   terminal route, gated on the status bar's `Connected` dot.
2. Assert no `progress-line` / `progress-chip` testids render at idle.
3. In a `toPass` retry: print the wrapped set-42% sequence in the pane and
   expect the `progress-chip` to become visible.
4. Assert the chip text is `42%` and the `progress-line` carries
   `aria-valuenow="42"`.
5. Print the wrapped remove sequence and assert both testids leave the DOM.
