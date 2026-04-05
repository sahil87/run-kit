# Spec: Fix Compose Buffer Dialog

**Change**: 260321-ye3t-fix-compose-buffer-dialog
**Created**: 2026-03-21
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend image serve endpoint — blob URLs are sufficient for compose-time preview
- xterm.js inline image rendering — not supported by the terminal emulator
- Post-send image preview (tracking `[Image #N]` labels in terminal output)

## Upload Flow: File Object Threading

### Requirement: Upload hook returns file metadata alongside paths

The `useFileUpload` hook SHALL return `{ path: string; file: File }[]` instead of `string[]`. Each tuple pairs the server-assigned absolute path with the original `File` object from the browser.

#### Scenario: Single image upload via paste
- **GIVEN** a user pastes an image from clipboard
- **WHEN** the upload completes successfully
- **THEN** the hook returns `[{ path: "/abs/path/file.png", file: File }]`
- **AND** the `File` object is the original from `clipboardData.files`

#### Scenario: Multiple files uploaded via drag-and-drop
- **GIVEN** a user drops 3 files onto the terminal
- **WHEN** all uploads complete
- **THEN** the hook returns 3 tuples in upload order
- **AND** failed uploads are excluded from the result

### Requirement: Terminal client threads file metadata to compose buffer

The `openComposeWithPaths` callback in `terminal-client.tsx` SHALL accept `{ path: string; file: File }[]` and store both paths (for textarea text) and file references (for preview) in state. The compose buffer SHALL receive uploaded files as a prop.

#### Scenario: Upload triggers compose buffer with preview data
- **GIVEN** an upload completes with 2 image files
- **WHEN** the compose buffer opens
- **THEN** the textarea contains both paths (one per line)
- **AND** the compose buffer receives both `File` objects for preview rendering

## Compose Buffer: Image Preview

### Requirement: Image thumbnails render above textarea

The compose buffer SHALL render a horizontal thumbnail strip above the textarea for uploaded files. Image files (`file.type.startsWith("image/")`) SHALL display as `<img>` thumbnails using `URL.createObjectURL(file)`. Non-image files SHALL display their filename as text.

#### Scenario: Image file shows thumbnail preview
- **GIVEN** the compose buffer has an uploaded PNG file
- **WHEN** the dialog renders
- **THEN** a thumbnail (~60px tall) of the image appears above the textarea
- **AND** the image source is a blob URL created from the File object

#### Scenario: Non-image file shows filename
- **GIVEN** the compose buffer has an uploaded `.json` file
- **WHEN** the dialog renders
- **THEN** the filename appears as text in the preview strip (no image)

### Requirement: Thumbnails are dismissible

Each preview item SHALL have an X button. Clicking X SHALL remove the file from the preview strip AND remove the corresponding path line from the textarea.

#### Scenario: Remove uploaded image before sending
- **GIVEN** the compose buffer shows 2 image thumbnails and 2 path lines
- **WHEN** the user clicks X on the first thumbnail
- **THEN** the first thumbnail is removed from the strip
- **AND** the first path line is removed from the textarea
- **AND** the second file remains unchanged

### Requirement: Click thumbnail for larger preview

Clicking a thumbnail SHALL toggle a larger preview view of the image within the dialog.

#### Scenario: Enlarge and dismiss preview
- **GIVEN** the compose buffer shows an image thumbnail
- **WHEN** the user clicks the thumbnail
- **THEN** a larger version of the image renders (constrained to dialog width)
- **WHEN** the user clicks the enlarged image or presses Escape
- **THEN** the view returns to the thumbnail strip

### Requirement: Blob URLs are revoked on close

All blob URLs created via `URL.createObjectURL()` SHALL be revoked via `URL.revokeObjectURL()` when the compose buffer closes (via close, send, or escape).

#### Scenario: Cleanup on dialog close
- **GIVEN** the compose buffer has 3 blob URLs for uploaded images
- **WHEN** the user closes the dialog
- **THEN** all 3 blob URLs are revoked

## Compose Buffer: Path Duplication Fix

### Requirement: Textarea value set via imperative ref only

The compose buffer SHALL NOT use `defaultValue` on the textarea. Initial text SHALL be set imperatively via `textareaRef.current.value` in a single `useEffect`. Subsequent `initialText` changes (additional uploads while compose is open) SHALL append only the new text.

#### Scenario: Initial open with uploaded path
- **GIVEN** the compose buffer opens with `initialText="/path/to/image.png"`
- **WHEN** the textarea renders
- **THEN** the textarea contains exactly one copy of the path

#### Scenario: Additional upload while compose is open
- **GIVEN** the compose buffer is open with one path in the textarea
- **WHEN** a second file is uploaded via the paperclip button
- **THEN** the second path is appended on a new line
- **AND** the first path is not duplicated

## Compose Buffer: Dialog Pattern Alignment

### Requirement: Fixed positioning with separate backdrop

The compose buffer SHALL use `fixed inset-0 z-40` positioning (matching `dialog.tsx`) instead of `absolute inset-0 z-50`. A separate `<div className="fixed inset-0 bg-black/50" aria-hidden="true" />` SHALL serve as the backdrop layer.

#### Scenario: Dialog renders above all content
- **GIVEN** the compose buffer is open
- **WHEN** the dialog renders
- **THEN** the overlay covers the full viewport (`fixed inset-0`)
- **AND** the backdrop is a separate element with `aria-hidden="true"`

### Requirement: ARIA dialog attributes

The compose buffer's content panel SHALL have `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing the title element's ID.

#### Scenario: Screen reader announces dialog
- **GIVEN** the compose buffer opens
- **WHEN** a screen reader reads the dialog
- **THEN** it announces the dialog role with the "Text Input" title

### Requirement: Focus trap within dialog

The compose buffer SHALL trap Tab/Shift+Tab focus cycling within its focusable elements (textarea, upload button, send button, dismiss buttons). This SHALL match the focus trap implementation in `dialog.tsx`.

#### Scenario: Tab cycles through dialog elements
- **GIVEN** focus is on the Send button (last focusable element)
- **WHEN** the user presses Tab
- **THEN** focus moves to the textarea (first focusable element)

#### Scenario: Shift+Tab wraps backward
- **GIVEN** focus is on the textarea (first focusable element)
- **WHEN** the user presses Shift+Tab
- **THEN** focus moves to the Send button (last focusable element)

### Requirement: Click-outside close uses two-layer pattern

The compose buffer SHALL use the `dialog.tsx` two-layer close pattern: outer container has `onClick={onClose}`, inner content panel has `onClick={(e) => e.stopPropagation()}`.

#### Scenario: Click outside closes dialog
- **GIVEN** the compose buffer is open
- **WHEN** the user clicks the backdrop
- **THEN** the dialog closes

#### Scenario: Click inside does not close
- **GIVEN** the compose buffer is open
- **WHEN** the user clicks the textarea or a button
- **THEN** the dialog remains open

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Client-side blob URLs for preview | Confirmed from intake #1 — user agreed | S:95 R:90 A:95 D:95 |
| 2 | Certain | No xterm.js terminal integration | Confirmed from intake #2 | S:90 R:95 A:90 D:95 |
| 3 | Certain | Replicate Dialog pattern, don't wrap Dialog component | Confirmed from intake #3 — unique features | S:85 R:85 A:90 D:90 |
| 4 | Certain | Thumbnail strip ~60px above textarea | Confirmed from intake #4 | S:95 R:90 A:70 D:75 |
| 5 | Certain | Revoke blob URLs on dialog close | Confirmed from intake #5 | S:95 R:95 A:85 D:90 |
| 6 | Certain | Drop defaultValue, imperative ref only | Confirmed from intake #6 | S:95 R:85 A:80 D:80 |
| 7 | Certain | Keep existing "Text Input" title from main | Confirmed from intake #7 | S:95 R:95 A:90 D:95 |
| 8 | Certain | Non-image files show filename text only | Confirmed from intake #8 | S:95 R:90 A:65 D:60 |
| 9 | Certain | Thumbnails dismissible with X button | Confirmed from intake #9 | S:95 R:90 A:80 D:90 |
| 10 | Certain | Click thumbnail for larger preview | Confirmed from intake #10 | S:95 R:90 A:80 D:90 |

10 assumptions (10 certain, 0 confident, 0 tentative, 0 unresolved).
