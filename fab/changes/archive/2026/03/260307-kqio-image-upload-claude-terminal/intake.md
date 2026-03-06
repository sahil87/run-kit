# Intake: Image Upload to Claude via Terminal

**Change**: 260307-kqio-image-upload-claude-terminal
**Created**: 2026-03-07
**Status**: Draft

## Origin

> "many times you need to upload images to claude. 1) Can you even upload images to claude on a terminal? 2) if so, how should one do it via run-kit?"

One-shot request. The user wants to send images (screenshots, diagrams, UI mockups) to Claude Code sessions running inside tmux windows. Since run-kit wraps tmux in a web UI, this is a question about bridging the browser's rich media capabilities to the terminal's text-only transport.

## Why

1. **Problem**: Claude Code CLI supports image input (via file paths, drag-drop in supported terminals, or piped input), but run-kit's terminal view is a WebSocket-to-tmux relay with no mechanism for transferring binary files from the browser to the remote filesystem. Users currently must SSH/scp files manually or use a separate file manager to place images where Claude can read them.

2. **Consequence**: Users who want Claude to analyze screenshots, UI designs, error screenshots, or diagrams must leave run-kit, transfer the file via another tool, then return and type the file path — a multi-step friction that breaks flow.

3. **Approach**: Leverage the web browser's native file handling (drag-drop, paste from clipboard, file picker) to accept images in the run-kit UI, write them to the project directory on the server, and provide the path to the terminal session so Claude Code can read them.

## What Changes

### Research: Claude Code CLI Image Support

Claude Code supports images via:
- **File path references** — mentioning a path to an image file in a prompt; Claude Code's `Read` tool can read images
- **Paste in supported terminals** — terminals like iTerm2 support image paste via OSC sequences, but this is terminal-emulator-specific and not available through tmux/node-pty relay
- **`/add` command** — Claude Code's `/add` can add files to context, though this is typically for code files

The practical approach for a tmux-relayed session is **file path reference**: place the image on disk where the session can access it, then reference the path in the conversation.

### Feature: Image Upload via Run-Kit UI

#### Upload Trigger (Browser Side)
- **Clipboard paste** — `Ctrl+V` / `Cmd+V` with image data in clipboard (e.g., after taking a screenshot)
- **Drag-and-drop** — drag an image file onto the terminal view area
- **File picker button** — explicit button in the bottom bar or compose buffer area

All three entry points feed into the same upload flow.

#### Server Endpoint
New API endpoint `POST /api/upload` that:
1. Accepts `multipart/form-data` with the file and `session` (session name) + `window` (tmux window index) fields
2. Resolves the project root directory for that session (from tmux, same as existing session enrichment)
3. Writes the file to a deterministic location within the project: `.uploads/{timestamp}-{original-name}` (or similar)
4. Returns the absolute file path in the response

#### Terminal Integration
After upload completes, the file path is either:
- **Auto-inserted into compose buffer** — if compose is open, append the path
- **Copied to clipboard** — with a toast notification showing the path
- **Auto-sent as sendKeys** — type the path directly into the terminal (most seamless but most opinionated)

The exact insertion behavior needs user input — see Open Questions.

### Upload Directory Convention
- `.uploads/` directory at the project root
- On first upload, the endpoint creates `.uploads/` and appends `.uploads/` to the project's `.gitignore` (if not already present). Self-contained — no fab-kit setup dependency
- Files named `{YYMMDD-HHmmss}-{sanitized-original-name}`
- No cleanup mechanism in v1 — users manage manually

## Affected Memory

- `run-kit/architecture`: (modify) Add upload endpoint to API layer, document upload flow
- `run-kit/ui-patterns`: (modify) Add upload UI triggers and interaction patterns

## Impact

- **New API endpoint**: `POST /api/upload` — file write to project filesystem
- **Terminal page component**: New event handlers for paste/drag-drop/file picker
- **Compose buffer**: May need integration for path insertion
- **Bottom bar**: Possible new upload button
- **Security**: File write to arbitrary project directory — needs validation (file type, size limits, path traversal prevention)
- **Dependencies**: May need `multer` or similar for multipart parsing, or use Next.js built-in `formData()`

## Open Questions

- ~~What should happen after upload?~~ Auto-insert path into compose buffer (opens compose if closed).
- ~~Should there be a file size limit?~~ Yes, 50MB. Generous for screenshots/PDFs, prevents accidental huge uploads.
- ~~Should the upload directory be configurable?~~ No — always `.uploads/`. Convention over configuration.
- ~~Should the feature support non-image files too?~~ Yes — any file type, not just images.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Claude Code CLI can read images via file paths | Documented Claude Code capability — the `Read` tool handles image files | S:90 R:95 A:95 D:95 |
| 2 | Certain | Images cannot be sent through tmux/node-pty WebSocket relay as binary data | Terminal protocol is text-based; tmux relay has no image passthrough | S:85 R:90 A:95 D:95 |
| 3 | Certain | Web browsers support clipboard paste, drag-drop, and file picker APIs | Standard Web APIs available in all modern browsers | S:95 R:95 A:95 D:95 |
| 4 | Certain | File-path-on-disk approach is the right strategy | Clarified — user confirmed. Server and tmux are co-located; browser is the remote part. Upload lands on the same filesystem tmux sessions use | S:95 R:85 A:80 D:75 |
| 5 | Certain | `.uploads/` at project root is a reasonable convention | Clarified — user confirmed | S:95 R:85 A:70 D:70 |
| 6 | Certain | Next.js App Router can handle multipart file uploads without external deps | Clarified — user confirmed | S:95 R:90 A:75 D:80 |
| 7 | Certain | Auto-insert file path into compose buffer after upload | Clarified — user chose compose buffer insertion. Opens compose if closed, inserts path, user adds context before sending | S:95 R:80 A:50 D:40 |
<!-- clarified: compose buffer insertion — user confirmed over direct sendKeys and clipboard copy alternatives -->
| 8 | Certain | Support any file type, not just images | User confirmed — upload mechanism is file-type-agnostic, UI labels as "file upload" not "image upload" | S:95 R:90 A:95 D:95 |

8 assumptions (8 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-03-07 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 4 | Confirmed | User asked about remote server — explained server+tmux are co-located, browser is the remote part |
| 5 | Confirmed | — |
| 6 | Confirmed | — |

### Session 2026-03-07 (taxonomy)

| # | Question | Answer |
|---|----------|--------|
| 1 | Post-upload behavior | Auto-insert path into compose buffer (opens compose if closed) |
| 2 | File size limit | 50MB |
| 3 | Upload directory configurable? | No — always `.uploads/`, convention over configuration |
| 4 | How is `.uploads/` gitignored? | Upload endpoint auto-appends to `.gitignore` on first use — no setup dependency |
