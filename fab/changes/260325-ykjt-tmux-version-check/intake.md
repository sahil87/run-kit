# Intake: Tmux Version Check

**Change**: 260325-ykjt-tmux-version-check
**Created**: 2026-03-25
**Status**: Draft

## Origin

> User reported terminal jitter on tmux sessions with accumulated history: "every line of update loads pages from a few pages back, and the pages jitter back to the current position." Investigation revealed the running tmux version is 3.2a, which does not support the `sync` terminal feature (DEC mode 2026 synchronized output). The run-kit tmux config already declares `set -as terminal-features ',xterm-256color:sync'` but tmux 3.2a silently ignores it.

Conversational — diagnosis led directly to this change. `scrollback: 0` was applied to xterm.js as a supplementary fix but didn't resolve the core jitter issue.

## Why

1. **Problem**: Without synchronized output, tmux sends screen redraws as raw escape sequences without begin/end markers. xterm.js renders each arriving chunk immediately, showing intermediate states — cursor jumps to top, rows redraw top-to-bottom — causing visible jitter that worsens as the session accumulates history.
2. **Consequence**: Every tmux session eventually becomes visually broken, making the terminal unreliable for agent work. Users must kill and recreate sessions to temporarily fix it.
3. **Approach**: A version check at startup is the simplest, most robust fix — fail fast with a clear upgrade message rather than silently degrading. The `rk doctor` command already checks for tmux existence but not version, so the version check extends the existing pattern.

## What Changes

### 1. `internal/tmux/version.go` — Version parsing

Add a `Version()` function to `app/backend/internal/tmux/` that:
- Runs `tmux -V` and parses the output (format: `tmux 3.6a`, `tmux next-3.5`)
- Extracts the major.minor version as a comparable value
- Returns a struct with `Major`, `Minor` int fields and the raw version string

Add a `CheckMinVersion(major, minor int) error` function that:
- Calls `Version()`
- Returns nil if >= minimum, or an error with a clear upgrade message including the found version and required version

### 2. `cmd/rk/serve.go` — Startup check

Add a tmux version check early in the `serve` command's `RunE`, before the server starts listening. Call `tmux.CheckMinVersion(3, 3)` and fatal if it returns an error. The error message should include:
- The found version
- The required minimum (3.3)
- Platform-appropriate install hint (brew on macOS, apt/building from source on Linux)

This check runs for both foreground `rk serve` and daemon mode (`rk serve -d`).

### 3. `cmd/rk/doctor.go` — Version check in doctor

Extend the existing tmux check in `rk doctor` to also verify the version after confirming tmux exists. Display the found version on success, warn on failure:

```
  [ OK ] tmux 3.6a
  [FAIL] tmux 3.2a — version 3.3+ required for synchronized output
```

## Affected Memory

- `run-kit/architecture`: (modify) Note minimum tmux version requirement

## Impact

- **Server startup**: Will fail on systems with tmux < 3.3 — this is intentional, as the terminal relay produces broken output without sync
- **`rk doctor`**: Now also reports tmux version
- **No API changes**: Backend-only, no frontend impact
- **`scrollback: 0`**: Already applied to xterm.js Terminal in this branch (supplementary fix, reduces memory)

## Open Questions

None — the approach was discussed and agreed upon.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Minimum version is 3.3 (not 3.3a) | Discussed — `sync` terminal feature was introduced in tmux 3.3a but 3.3 is the safe semver floor for comparison | S:90 R:85 A:90 D:90 |
| 2 | Certain | Check runs in `serve` command, not in the tmux package init | Discussed — fail at startup with a clear message, consistent with constitution's "fail fast" posture | S:85 R:90 A:85 D:90 |
| 3 | Certain | Version parsing lives in `internal/tmux/` | Codebase convention — all tmux operations are in this package | S:90 R:95 A:95 D:95 |
| 4 | Confident | Fatal on version mismatch (not warn) | Discussed — terminal relay produces broken output without sync, warning would let users hit the jitter | S:80 R:70 A:75 D:80 |
| 5 | Certain | `rk doctor` extended rather than creating a separate check command | Existing pattern — doctor already checks tmux existence | S:90 R:90 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
