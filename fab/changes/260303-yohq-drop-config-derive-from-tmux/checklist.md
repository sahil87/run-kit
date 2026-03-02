# Quality Checklist: Drop Config File — Derive Project State from tmux

**Change**: 260303-yohq-drop-config-derive-from-tmux
**Generated**: 2026-03-03
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Project root derivation: `fetchSessions()` derives project root from window 0's `worktreePath`
- [ ] CHK-002 All sessions shown: Every tmux session appears as a `ProjectSession` — no filtering
- [ ] CHK-003 Tmux ordering: Sessions appear in `listSessions()` order, no re-sorting
- [ ] CHK-004 Fab detection: `hasFabKit()` uses `fs.access()` on `fab/project/config.yaml` at project root
- [ ] CHK-005 Fab enrichment: All windows in a fab-kit session are enriched with `fabStage`/`fabProgress`

## Behavioral Correctness

- [ ] CHK-006 No config imports: `sessions.ts` has zero imports from `./config`
- [ ] CHK-007 No "Other" bucket: No "Other" group in `fetchSessions()` return value
- [ ] CHK-008 Empty state text: Dashboard empty state does not mention `run-kit.yaml`

## Removal Verification

- [ ] CHK-009 `src/lib/config.ts` deleted — file does not exist
- [ ] CHK-010 `run-kit.example.yaml` deleted — file does not exist
- [ ] CHK-011 `ProjectConfig` type removed from `src/lib/types.ts`
- [ ] CHK-012 `Config` type removed from `src/lib/types.ts`
- [ ] CHK-013 `.gitignore` entry for `run-kit.yaml` removed

## Scenario Coverage

- [ ] CHK-014 Normal session: Session with multiple windows derives root from window 0
- [ ] CHK-015 No sessions: Empty tmux returns empty array
- [ ] CHK-016 Fab-kit session: Session with `fab/project/config.yaml` gets enrichment
- [ ] CHK-017 Non-fab session: Session without fab config gets no enrichment (no error)
- [ ] CHK-018 `fs.access` failure: Permission error on fab config check treated as non-fab (no throw)

## Edge Cases & Error Handling

- [ ] CHK-019 Single-window session: Window 0 is both the only window and the root source
- [ ] CHK-020 Worktree windows: Windows with worktree paths still enrich correctly via their own `worktreePath`

## Code Quality

- [ ] CHK-021 Pattern consistency: `hasFabKit()` follows async function patterns in `src/lib/`
- [ ] CHK-022 No unnecessary duplication: Reuses existing `enrichWindow()`, `listWindows()`, `listSessions()`
- [ ] CHK-023 execFile with argument arrays: No `exec()` or template-string shell commands introduced
- [ ] CHK-024 No `exec()`/`execSync()`: No shell injection vectors added
- [ ] CHK-025 No database/ORM imports: No persistent state introduced

## Security

- [ ] CHK-026 No shell injection: All subprocess calls use `execFile` with argument arrays (verify no `exec` calls in changed files)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
