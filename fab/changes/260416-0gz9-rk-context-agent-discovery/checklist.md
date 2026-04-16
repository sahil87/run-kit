# Quality Checklist: rk context — Agent Discovery

**Change**: 260416-0gz9-rk-context-agent-discovery
**Generated**: 2026-04-16
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Command registration: `contextCmd` registered on `rootCmd`, `rk context` invocable
- [x] CHK-002 Environment section: displays session name, window name, pane ID, server URL, window type when inside tmux
- [x] CHK-003 Capabilities section: includes terminal windows, iframe windows, proxy, and categorized CLI commands
- [x] CHK-004 Conventions section: documents `@rk_type`/`@rk_url` options, window lifecycle, SSE reactivity
- [x] CHK-005 CLI command categories: all 6 registered subcommands appear grouped under Server, Diagnostics, or Info

## Behavioral Correctness

- [x] CHK-006 Outside-tmux degradation: shows `(not in tmux)` for environment, server URL still present, capabilities and conventions sections rendered
- [x] CHK-007 `@rk_type` absent: window type line omitted when option not set on window
- [x] CHK-008 Tmux query failure: failed fields omitted, command exits 0, other sections unaffected

## Scenario Coverage

- [x] CHK-009 Scenario "inside tmux with all fields": environment section shows all 5 fields
- [x] CHK-010 Scenario "outside tmux": environment shows `(not in tmux)`, static sections present
- [x] CHK-011 Scenario "output is markdown-compatible": output renderable as valid markdown

## Edge Cases & Error Handling

- [x] CHK-012 Tmux timeout: `exec.CommandContext` uses 5s timeout for all tmux queries
- [x] CHK-013 No `$TMUX_PANE`: command does not panic or error, gracefully degrades
- [x] CHK-014 `@rk_type` query returns error: field omitted, no error propagated

## Code Quality

- [x] CHK-015 Pattern consistency: `context.go` follows naming and structural patterns of `status.go`, `doctor.go` (Cobra command variable, `RunE` function, `cmd.OutOrStdout()`)
- [x] CHK-016 No unnecessary duplication: server URL derivation reuses env var reading pattern from `internal/config`
- [x] CHK-017 All subprocess calls use `exec.CommandContext` with explicit argument slices — no shell strings
- [x] CHK-018 Functions focused and appropriately sized: `RunE` delegates to helper functions if output logic exceeds ~50 lines
- [x] CHK-019 No inline tmux command construction: tmux queries use argument slices via `exec.CommandContext`
- [x] CHK-020 No database/ORM/migration imports (constitution)

## Security

- [x] CHK-021 All `exec.CommandContext` calls include timeout (5s for tmux queries)
- [x] CHK-022 No shell string construction — all subprocess args are explicit slices

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
