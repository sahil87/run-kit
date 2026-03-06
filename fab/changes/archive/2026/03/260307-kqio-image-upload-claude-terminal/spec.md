# Spec: File Upload to Terminal Sessions

**Change**: 260307-kqio-image-upload-claude-terminal
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Streaming upload progress UI (simple success/failure is sufficient for v1)
- Automatic cleanup of `.uploads/` directory
- Configurable upload directory path
- Direct binary injection into terminal (not supported by tmux relay)

## API: Upload Endpoint

### Requirement: File Upload Route

The system SHALL expose `POST /api/upload` accepting `multipart/form-data`. The request MUST include a `file` field (the uploaded file) and a `session` field (tmux session name). The request MAY include a `window` field (window index, defaults to `0`).

The route handler SHALL:
1. Parse the request using Next.js `request.formData()`
2. Validate the `session` field using `validateName()` from `src/lib/validate.ts`
3. Validate file size MUST NOT exceed 50MB
4. Resolve the project root by calling `listWindows(session)` and reading `windows[window].worktreePath` (same pattern as `src/lib/sessions.ts`)
5. Ensure `.uploads/` directory exists within the project root (create if missing)
6. Ensure `.uploads/` is in the project's `.gitignore` (append if not present)
7. Write the file as `{YYMMDD-HHmmss}-{sanitized-filename}`
8. Return `{ ok: true, path: "<absolute-path>" }`

The route SHALL use `fs.writeFile` (not `execFile`) for file I/O — this is data writing, not subprocess execution.

#### Scenario: Successful file upload
- **GIVEN** a tmux session `my-project` exists with window 0 at `/home/user/code/my-project`
- **WHEN** `POST /api/upload` receives a 2MB PNG file with `session=my-project`
- **THEN** the file is written to `/home/user/code/my-project/.uploads/260307-120000-screenshot.png`
- **AND** the response is `200 { ok: true, path: "/home/user/code/my-project/.uploads/260307-120000-screenshot.png" }`

#### Scenario: First upload creates directory and gitignore entry
- **GIVEN** `/home/user/code/my-project/.uploads/` does not exist
- **AND** `/home/user/code/my-project/.gitignore` does not contain `.uploads/`
- **WHEN** a file is uploaded to session `my-project`
- **THEN** `.uploads/` directory is created
- **AND** `.uploads/` is appended to `.gitignore` (creating the file if it doesn't exist)

#### Scenario: File too large
- **GIVEN** a file larger than 50MB
- **WHEN** `POST /api/upload` receives the file
- **THEN** the response is `400 { error: "File exceeds 50MB limit" }`
- **AND** no file is written to disk

#### Scenario: Invalid session
- **GIVEN** session name `bad;session` containing forbidden characters
- **WHEN** `POST /api/upload` receives the request
- **THEN** the response is `400 { error: "Session name contains forbidden characters" }`

#### Scenario: Session not found
- **GIVEN** no tmux session named `nonexistent` exists
- **WHEN** `POST /api/upload` receives the request
- **THEN** the response is `400 { error: "Session not found or has no windows" }`

### Requirement: Filename Sanitization

Uploaded filenames SHALL be sanitized to remove path separators (`/`, `\`), null bytes, and leading dots. The sanitized name SHALL be prefixed with `{YYMMDD-HHmmss}-`. If the original filename is empty or entirely sanitized away, the system SHALL use `upload` as the base name.

#### Scenario: Filename with path traversal attempt
- **GIVEN** a file with name `../../../etc/passwd`
- **WHEN** uploaded
- **THEN** the sanitized filename is `260307-120000-etc-passwd`

#### Scenario: Empty filename
- **GIVEN** a file with no name (clipboard paste)
- **WHEN** uploaded
- **THEN** the filename is `260307-120000-upload`

## Client: Upload Triggers

### Requirement: Clipboard Paste Handler

The terminal page SHALL listen for `paste` events on the document. When a paste event contains file data (`event.clipboardData.files`), the handler SHALL upload each file to `POST /api/upload` and insert the returned path into the compose buffer.

The handler MUST NOT interfere with text paste (when `clipboardData.files` is empty, the event propagates normally to xterm).

#### Scenario: Paste screenshot from clipboard
- **GIVEN** the user is on the terminal page for session `dev` window `0`
- **AND** the clipboard contains an image (e.g., screenshot)
- **WHEN** the user presses Cmd+V
- **THEN** the file is uploaded to `POST /api/upload` with `session=dev`
- **AND** the compose buffer opens with the file path inserted

#### Scenario: Paste plain text
- **GIVEN** the clipboard contains plain text (no files)
- **WHEN** the user presses Cmd+V
- **THEN** the paste event propagates normally to xterm (no upload triggered)

### Requirement: Drag-and-Drop Handler

The terminal page SHALL accept files dropped onto the terminal area. A visual drop zone indicator (border highlight) SHALL appear when files are dragged over the terminal. On drop, each file SHALL be uploaded and the path inserted into the compose buffer.

#### Scenario: Drop an image onto terminal
- **GIVEN** the user drags a file over the terminal area
- **WHEN** the file is dropped
- **THEN** a drag overlay appears during drag-over
- **AND** the file is uploaded on drop
- **AND** the compose buffer opens with the file path

#### Scenario: Drop non-file content
- **GIVEN** the user drags text (not a file) over the terminal
- **WHEN** the content is dropped
- **THEN** no upload occurs (event ignored)

### Requirement: File Picker Button

The bottom bar SHALL include a file upload button (📎 icon or similar) between the extended keys and the compose toggle. Clicking it SHALL open the browser's native file picker. Selected files SHALL be uploaded and paths inserted into the compose buffer.

#### Scenario: Upload via file picker
- **GIVEN** the user clicks the upload button in the bottom bar
- **WHEN** the user selects a file from the native picker
- **THEN** the file is uploaded
- **AND** the compose buffer opens with the file path

### Requirement: Compose Buffer Path Insertion

After a successful upload, the system SHALL:
1. Open the compose buffer if it is not already open
2. Insert the absolute file path at the cursor position (or append if no cursor)
3. Add a newline after the path if inserting multiple files

The compose buffer's `ComposeBuffer` component SHALL accept an optional `initialText` prop to support path pre-population from the upload flow.

#### Scenario: Multiple files uploaded
- **GIVEN** the user pastes or drops 3 files
- **WHEN** all uploads complete
- **THEN** the compose buffer contains all 3 file paths, one per line

#### Scenario: Compose already open with text
- **GIVEN** the compose buffer is open with existing text "analyze this:"
- **WHEN** a file is uploaded
- **THEN** the file path is appended after the existing text with a newline separator

## Design Decisions

1. **FormData over JSON+base64**: FormData is the standard browser API for file upload and avoids the ~33% size overhead of base64 encoding. Next.js App Router natively supports `request.formData()`.
   - *Why*: Simpler, smaller payloads, no encoding/decoding needed
   - *Rejected*: JSON with base64-encoded file data — adds size overhead and complexity

2. **Separate `/api/upload` route over extending `/api/sessions`**: The sessions route uses JSON body parsing. File upload requires FormData parsing which is incompatible. A dedicated route keeps concerns separated.
   - *Why*: Clean separation, no refactoring of existing route
   - *Rejected*: Adding a `uploadFile` action to the existing sessions POST — incompatible content types

3. **Upload button in bottom bar over dedicated toolbar**: The bottom bar is already the terminal page's action area. Adding a button there follows the existing pattern and avoids new UI chrome.
   - *Why*: Consistent with existing UI patterns, no new surfaces
   - *Rejected*: Floating upload overlay, separate toolbar

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | File-on-disk via upload endpoint | Confirmed from intake #4 — server+tmux co-located, browser is remote | S:95 R:85 A:80 D:75 |
| 2 | Certain | `.uploads/` at project root, auto-gitignored | Confirmed from intake #5 — endpoint handles .gitignore on first use | S:95 R:85 A:70 D:70 |
| 3 | Certain | Next.js formData() for multipart parsing | Confirmed from intake #6 — no external deps needed | S:95 R:90 A:75 D:80 |
| 4 | Certain | Auto-insert path into compose buffer | Confirmed from intake #7 — opens compose if closed | S:95 R:80 A:50 D:40 |
| 5 | Certain | Support any file type | Confirmed from intake #8 | S:95 R:90 A:95 D:95 |
| 6 | Certain | 50MB file size limit | User confirmed during clarification | S:95 R:90 A:80 D:85 |
| 7 | Certain | Separate /api/upload route | FormData incompatible with existing JSON sessions route | S:90 R:90 A:90 D:90 |
| 8 | Certain | Project root from listWindows | Reuses existing tmux-derived project root pattern from sessions.ts | S:90 R:95 A:95 D:95 |
| 9 | Certain | Upload button in bottom bar | Follows existing terminal page UI pattern | S:85 R:90 A:85 D:80 |
| 10 | Confident | initialText prop on ComposeBuffer | Simple prop addition; alternative is imperative ref — prop is more React-idiomatic | S:75 R:95 A:80 D:70 |
| 11 | Confident | Filename sanitization strips path separators and leading dots | Standard security practice; prevents path traversal | S:80 R:95 A:90 D:85 |
| 12 | Confident | Drag overlay as border highlight | Minimal visual feedback; consistent with dark theme aesthetics | S:70 R:95 A:75 D:70 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
