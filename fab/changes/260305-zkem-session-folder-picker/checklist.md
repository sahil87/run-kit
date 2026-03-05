# Quality Checklist: Create Session from Folder

**Change**: 260305-zkem-session-folder-picker
**Generated**: 2026-03-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Directory listing endpoint: `GET /api/directories` exists and returns matching directories for a given prefix
- [ ] CHK-002 Tilde expansion: `~` and `~/` in prefix are expanded to server `$HOME`
- [ ] CHK-003 Security boundary: paths outside `$HOME` and `..` traversal are rejected with 400
- [ ] CHK-004 CWD on session creation: `POST /api/sessions` createSession action accepts optional `cwd` and passes to tmux
- [ ] CHK-005 tmux.ts CWD: `createSession(name, cwd)` passes `-c <cwd>` when cwd provided
- [ ] CHK-006 Quick picks: dialog shows deduplicated project roots from existing sessions
- [ ] CHK-007 Autocomplete: path input calls `/api/directories` with debounce, shows dropdown results
- [ ] CHK-008 Session name auto-derivation: last path segment fills name field on path selection
- [ ] CHK-009 Create sends CWD: dialog includes `cwd` in POST when path is selected

## Behavioral Correctness

- [ ] CHK-010 Existing createSession (no cwd): behavior unchanged when `cwd` is omitted
- [ ] CHK-011 Empty prefix returns empty array (not error)
- [ ] CHK-012 Directory paths end with trailing `/` in response

## Scenario Coverage

- [ ] CHK-013 Valid prefix with matches returns correct directories
- [ ] CHK-014 No matches returns empty array
- [ ] CHK-015 Path traversal attempt returns 400
- [ ] CHK-016 Quick pick selection fills path + name
- [ ] CHK-017 Create without path sends no cwd field

## Edge Cases & Error Handling

- [ ] CHK-018 Prefix to non-existent directory returns empty array (not 500)
- [ ] CHK-019 Permission-denied directories are skipped gracefully
- [ ] CHK-020 Bare relative path resolves relative to $HOME

## Code Quality

- [ ] CHK-021 Pattern consistency: new code follows naming and structural patterns of surrounding code (execFile conventions, route structure, component patterns)
- [ ] CHK-022 No unnecessary duplication: reuses existing `validatePath`, `validateName`, `tmuxExec` patterns
- [ ] CHK-023 execFile with argument arrays: no `exec()` or shell strings anywhere in new code
- [ ] CHK-024 Server Components default: new UI code uses Client Components only where interactivity requires it
- [ ] CHK-025 No useEffect for data fetching: autocomplete uses event handlers, not effect-based polling
- [ ] CHK-026 No inline tmux command construction: all tmux interaction through `lib/tmux.ts`

## Security

- [ ] CHK-027 Directory listing restricted to $HOME — no absolute paths outside home accepted
- [ ] CHK-028 No `..` traversal in directory listing input
- [ ] CHK-029 CWD validated via `validatePath` before reaching tmux subprocess
- [ ] CHK-030 No shell injection vectors: all subprocess calls use argument arrays

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
