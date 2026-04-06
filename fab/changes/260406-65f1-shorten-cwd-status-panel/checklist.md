# Quality Checklist: Shorten CWD in Status Panel

**Change**: 260406-65f1-shorten-cwd-status-panel
**Generated**: 2026-04-06
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Home substitution — Linux: `/home/<username>/...` is displayed as `~/...`
- [x] CHK-002 Home substitution — macOS: `/Users/<username>/...` is displayed as `~/...`
- [x] CHK-003 Home substitution — root: `/root/...` is displayed as `~/...`
- [x] CHK-004 Exact home match: `/home/<username>` (no subdirectory) displays as `~`
- [x] CHK-005 Truncation — >2 segments: paths with more than 2 non-empty segments are displayed as `…/<seg-1>/<seg-2>`
- [x] CHK-006 No truncation — ≤2 segments: paths with 1 or 2 segments are not truncated
- [x] CHK-007 Title attribute unchanged: the `title` prop on the cwd element still receives the original unmodified path

## Behavioral Correctness

- [x] CHK-008 Home substitution replaces old macOS-only logic: the old `/Users/`-only check is gone; both Linux and macOS paths are handled in the same function

## Scenario Coverage

- [x] CHK-009 Test: Linux home path substituted (e.g., `/home/sahil/code/run-kit` → `~/code/run-kit`)
- [x] CHK-010 Test: macOS home path with >2 segments truncated (e.g., `/Users/john/a/b/c/d` → `…/c/d`) — dedicated test added in rework cycle; passes
- [x] CHK-011 Test: Exact home directory (e.g., `/home/sahil` → `~`)
- [x] CHK-012 Test: Non-home deep path truncated (e.g., `/var/log/nginx/access` → `…/nginx/access`)
- [x] CHK-013 Test: Short non-home path not truncated (e.g., `/tmp` → `/tmp`)

## Edge Cases & Error Handling

- [x] CHK-014 Empty string: `shortenPath("")` does not throw (returns `""` or gracefully handles)
- [x] CHK-015 Root path: `shortenPath("/")` does not throw (returns `/`)

## Code Quality

- [x] CHK-016 Pattern consistency: `shortenPath` follows the same pure-function style as the original; no side effects introduced
- [x] CHK-017 No unnecessary duplication: no existing path-shortening utility in `src/lib/` duplicated
- [x] CHK-018 Readability: function is ≤30 lines, readable without comments, no magic numbers

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
