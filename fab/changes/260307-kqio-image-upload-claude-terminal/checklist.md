# Quality Checklist: File Upload to Terminal Sessions

**Change**: 260307-kqio-image-upload-claude-terminal
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Upload endpoint: POST /api/upload accepts FormData, writes file to `.uploads/`, returns path
- [ ] CHK-002 Gitignore management: First upload auto-creates `.uploads/` and appends to `.gitignore`
- [ ] CHK-003 Filename sanitization: Path separators, null bytes, leading dots stripped; empty names default to `upload`
- [ ] CHK-004 Clipboard paste: Paste with file data triggers upload and opens compose with path
- [ ] CHK-005 Drag-and-drop: Dropping files on terminal area triggers upload and opens compose
- [ ] CHK-006 File picker button: Bottom bar upload button opens native file picker
- [ ] CHK-007 Compose buffer insertion: Uploaded file paths pre-populate compose buffer via `initialText`

## Behavioral Correctness
- [ ] CHK-008 Text paste passthrough: Cmd+V with text-only clipboard still works normally in xterm
- [ ] CHK-009 Compose buffer existing text: Path appended with newline separator when compose already has text
- [ ] CHK-010 Multiple file upload: All paths inserted, one per line

## Scenario Coverage
- [ ] CHK-011 File too large (>50MB) returns 400 error, no file written
- [ ] CHK-012 Invalid session name returns 400 error
- [ ] CHK-013 Session not found returns 400 error
- [ ] CHK-014 Filename traversal attempt sanitized (../../../etc/passwd → safe name)
- [ ] CHK-015 Empty filename (clipboard paste) defaults to `upload`

## Edge Cases & Error Handling
- [ ] CHK-016 Upload to project without existing `.gitignore` — file created with `.uploads/` entry
- [ ] CHK-017 Upload to project where `.gitignore` already contains `.uploads/` — no duplicate entry
- [ ] CHK-018 Drag non-file content over terminal — no upload triggered

## Code Quality
- [ ] CHK-019 Pattern consistency: Upload route follows existing `src/app/api/sessions/route.ts` patterns (error handling, validation, response format)
- [ ] CHK-020 No unnecessary duplication: Project root resolution reuses `listWindows` from `src/lib/tmux.ts`
- [ ] CHK-021 execFile with argument arrays: No `exec()` or shell strings in new code
- [ ] CHK-022 No unnecessary duplication: Filename validation reuses/extends `src/lib/validate.ts`

## Security
- [ ] CHK-023 File size validated server-side (not just client-side)
- [ ] CHK-024 Filename sanitized to prevent path traversal
- [ ] CHK-025 Session name validated via `validateName()` before tmux interaction
- [ ] CHK-026 No shell injection: File write uses `fs.writeFile`, not subprocess

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
