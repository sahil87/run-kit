# Tasks: Shorten CWD in Status Panel

**Change**: 260406-65f1-shorten-cwd-status-panel
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Rewrite `shortenPath` in `app/frontend/src/components/sidebar/status-panel.tsx` to handle Linux `/home/`, macOS `/Users/`, and `/root` prefixes with `~` substitution, then truncate paths with >2 non-empty segments to `…/<last-two>`

## Phase 2: Tests

- [x] T002 Update `app/frontend/src/components/sidebar/status-panel.test.tsx` — fix existing tests that use macOS paths (now truncated if >2 segments), add new cases for Linux home, `/root`, exact home match, and truncation scenarios per spec

---

## Execution Order

- T001 before T002 (tests validate the implementation)
