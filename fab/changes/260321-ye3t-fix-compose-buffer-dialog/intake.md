# Intake: Fix Compose Buffer Dialog

**Change**: 260321-ye3t-fix-compose-buffer-dialog
**Created**: 2026-03-21
**Status**: Draft

## Origin

> Fix compose buffer dialog: (1) Add image preview using client-side blob URLs — thread File objects alongside paths through upload flow, show thumbnails above textarea for image files, revoke on close. (2) Fix path duplication bug — the defaultValue + useEffect append pattern causes paths to appear twice; replace with simpler approach. (3) Align compose buffer with project's Dialog pattern.

Conversational `/fab-discuss` session preceded this change. User uploads images via paste/drop/file-picker to send to Claude Code running in a tmux pane. The compose buffer dialog opens with the uploaded file's absolute path as text, but no image preview is shown. The path text also appears duplicated. The dialog itself doesn't follow the established `Dialog` component pattern used by other dialogs in the project.

## Why

1. **No image preview**: When uploading an image to send to Claude Code, the user sees only a raw filesystem path (e.g., `/home/user/project/.uploads/260321083210-image.png`) with no visual confirmation of what they're about to send. Claude Code displays `[Image #1]` in the terminal — no way to verify the image content before or after sending.

2. **Path duplication bug**: The compose buffer mixes React's `defaultValue` prop with a `useEffect` that directly manipulates `textarea.value`. This causes the uploaded path to appear twice under certain state transitions (e.g., when the compose buffer is already open and a new upload arrives, or during React re-renders). The user sends duplicate paths to the terminal.

3. **Dialog inconsistency**: The compose buffer is the oldest dialog in the codebase and predates the base `Dialog` component (`dialog.tsx`). It uses `absolute inset-0` instead of `fixed inset-0`, has no separate backdrop layer, lacks ARIA attributes (`role="dialog"`, `aria-modal`), has no focus trap, and no title/header. Every other dialog in the project follows the `Dialog` pattern or matches its structure.

## What Changes

### 1. Image Preview in Compose Buffer

Thread `File` objects alongside upload paths through the entire upload flow:

- **`use-file-upload.ts`**: Return `{ path, file }` tuples instead of bare `string[]` paths
- **`terminal-client.tsx`**: `openComposeWithPaths` accepts `{ path: string, file: File }[]`, stores both path and blob URL in state
- **`compose-buffer.tsx`**: Render image thumbnails above the textarea for files with image MIME types (`image/*`). Use `URL.createObjectURL(file)` for the `<img src>`. Non-image files show filename only. Revoke blob URLs via `URL.revokeObjectURL()` on dialog close.

Preview layout: horizontal thumbnail strip above the textarea, each thumbnail ~60px tall with the filename below. Each thumbnail has an X button to remove it before sending. Clicking a thumbnail shows a larger preview. Non-image files show their filename as text in the strip.

### 2. Fix Path Duplication

Replace the current `defaultValue` + `useEffect` append pattern in `compose-buffer.tsx` with a single controlled approach:

- Remove `defaultValue={initialText}` from the textarea
- Remove the `useEffect` that appends `initialText` to `textarea.value`
- Instead, set `textarea.value` once on mount via a `useEffect` with an empty-ish dependency, and handle subsequent `initialText` changes (from additional uploads while compose is open) by appending only the new paths

The key insight: `defaultValue` is a React concept for uncontrolled inputs, but the `useEffect` fights it by doing imperative DOM manipulation. Pick one approach — imperative via ref is fine since the textarea is already ref-managed for the `send()` function.

### 3. Align with Dialog Pattern

Refactor compose buffer to match the established `Dialog` component structure from `dialog.tsx`:

- **Positioning**: Change from `absolute inset-0` to `fixed inset-0 z-40` with a separate `fixed inset-0 bg-black/50` backdrop layer (`aria-hidden="true"`)
- **ARIA**: Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to a title element
- **Title**: Keep existing "Text Input" header (already added by another PR on main)
- **Focus trap**: Implement Tab cycling within the dialog (matching `dialog.tsx`'s `focusable` querySelectorAll + shift-tab/tab boundary logic)
- **Click outside**: Keep existing click-outside-to-close but restructure to use the two-layer approach (outer container `onClick={onClose}`, inner content `onClick={e.stopPropagation()}`)

Note: The compose buffer has unique features (textarea, file upload button, send button, image previews) that make it unsuitable to wrap in the generic `Dialog` component directly — but it should replicate the same structural pattern.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document compose buffer dialog pattern, image preview approach

## Impact

- **Frontend components**: `compose-buffer.tsx` (major refactor), `terminal-client.tsx` (state type changes)
- **Frontend hooks**: `use-file-upload.ts` (return type change from `string[]` to `{ path, file }[]`)
- **No backend changes**: Image serving not needed — blob URLs from client-side `File` objects suffice
- **No API changes**: Upload endpoint unchanged, still returns `{ ok, path }`

## Open Questions

- ~~Should the image preview be dismissible (X button per thumbnail) to remove an image before sending?~~ **Yes** — X button per thumbnail to remove before sending.
- ~~Should clicking a thumbnail show a larger preview, or is the thumbnail strip sufficient?~~ **Yes** — click to enlarge to a larger preview.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use client-side blob URLs for preview, not a backend serve endpoint | Discussed — user agreed blob URLs are sufficient since preview only matters while compose dialog is open | S:95 R:90 A:95 D:95 |
| 2 | Certain | No xterm.js terminal integration for preview | Discussed — xterm.js cannot render images, and Claude Code's `[Image #N]` labels can't be reliably matched to uploads | S:90 R:95 A:90 D:95 |
| 3 | Certain | Compose buffer replicates Dialog pattern rather than wrapping Dialog component | Discussed — compose buffer has unique features (textarea, upload, send, preview) incompatible with generic Dialog wrapper | S:85 R:85 A:90 D:90 |
| 4 | Certain | Thumbnail strip layout above textarea, ~60px height | Clarified — user confirmed | S:95 R:90 A:70 D:75 |
| 5 | Certain | Revoke blob URLs on dialog close | Clarified — user confirmed | S:95 R:95 A:85 D:90 |
| 6 | Certain | Fix duplication by dropping defaultValue, using only imperative ref-based value setting | Clarified — user confirmed | S:95 R:85 A:80 D:80 |
| 7 | Certain | Keep existing "Text Input" title from main | Clarified — another PR already added the title; user chose to keep it | S:95 R:95 A:90 D:95 |
| 8 | Certain | Non-image files show filename text only (no icon) | Clarified — user confirmed recommendation | S:95 R:90 A:65 D:60 |
| 9 | Certain | Thumbnails are dismissible with X button | Clarified — user confirmed recommendation | S:95 R:90 A:80 D:90 |
| 10 | Certain | Click thumbnail to show larger preview | Clarified — user confirmed recommendation | S:95 R:90 A:80 D:90 |

10 assumptions (10 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-03-21 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Confirmed | — |

### Session 2026-03-21 (suggest)

| # | Action | Detail |
|---|--------|--------|
| 9 | Resolved | Thumbnails dismissible with X button — user accepted recommendation |
| 10 | Resolved | Click thumbnail for larger preview — user accepted recommendation |
| 7 | Resolved | Keep existing "Text Input" title from main — another PR already added it |
| 8 | Resolved | Non-image files show filename text only — user accepted recommendation |
