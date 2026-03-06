# Tasks: File Upload to Terminal Sessions

**Change**: 260307-kqio-image-upload-claude-terminal
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create upload API route scaffold at `src/app/api/upload/route.ts` — export `POST` handler stub returning 501, set `export const dynamic = "force-dynamic"`
- [x] T002 [P] Add `sanitizeFilename` utility to `src/lib/validate.ts` — strip `/`, `\`, null bytes, leading dots; return `upload` if empty after sanitization
- [x] T003 [P] Add `UPLOAD_MAX_BYTES` constant (50 * 1024 * 1024) to `src/lib/types.ts`

## Phase 2: Core Implementation

- [x] T004 Implement `POST /api/upload` in `src/app/api/upload/route.ts` — parse FormData, validate session name via `validateName()`, validate file size against `UPLOAD_MAX_BYTES`, resolve project root via `listWindows(session)`, ensure `.uploads/` directory exists, ensure `.gitignore` entry, write file with timestamped sanitized name, return `{ ok: true, path }`
- [x] T005 Add `initialText` prop to `ComposeBuffer` in `src/components/compose-buffer.tsx` — optional string that pre-populates the textarea value on mount

## Phase 3: Integration & Edge Cases

- [x] T006 Add upload handler hook `useFileUpload` in `src/hooks/use-file-upload.ts` — accepts `projectName`, `windowIndex`; exposes `uploadFiles(files: FileList)` that calls `POST /api/upload` for each file and returns array of paths; manages `uploading` state
- [x] T007 Wire paste handler in `src/app/p/[project]/[window]/terminal-client.tsx` — listen for `paste` event on document, check `clipboardData.files`, call `uploadFiles()`, open compose buffer with paths; skip when no files (let xterm handle text paste)
- [x] T008 Wire drag-and-drop in `src/app/p/[project]/[window]/terminal-client.tsx` — add `dragover`/`dragleave`/`drop` handlers to the terminal container div; show border highlight on drag-over; call `uploadFiles()` on drop; open compose with paths
- [x] T009 Add upload button (📎) to `src/components/bottom-bar.tsx` — between extended keys dropdown and compose toggle; clicking opens hidden `<input type="file">`, on file selection calls `onUploadFiles` callback prop
- [x] T010 Wire upload button in `terminal-client.tsx` — pass `onUploadFiles` callback to `BottomBar` that triggers `uploadFiles()` and opens compose with paths

## Phase 4: Polish

- [x] T011 Add upload button to command palette actions in `terminal-client.tsx` — "Upload file" action that triggers the file picker

---

## Execution Order

- T001, T002, T003 are independent (Phase 1 setup)
- T004 depends on T001, T002, T003
- T005 is independent of T004
- T006 depends on T004 (needs working endpoint)
- T007, T008, T009, T010 depend on T005 and T006
- T011 depends on T010
