# Intake: Default Session Name from Folder Path

**Change**: 260317-qiza-default-session-name-from-folder
**Created**: 2026-03-17
**Status**: Draft

## Origin

> If a Session Name isn't provided in the "New Session" dialog, use the folder name (last bit of the path) as the session name.

One-shot request. The user wants the Create Session dialog to automatically fall back to deriving a session name from the entered path when the user hasn't explicitly typed a name.

## Why

Currently, the "Create" button is disabled when the session name field is empty (`!name.trim()`). If a user manually types a path into the Path field (rather than selecting from the autocomplete dropdown), the name field stays empty and they must manually type a name. The `deriveNameFromPath()` function already exists and is used when selecting a path from the dropdown via `selectPath()`, but it's not applied when the user submits the form with an empty name field.

This creates unnecessary friction — the user has to manually copy or type the folder name even though the system already knows how to derive a sensible default.

## What Changes

### Frontend: `app/frontend/src/components/create-session-dialog.tsx`

Modify `handleCreate()` to derive the session name from `path` when `name` is empty:

```typescript
async function handleCreate() {
  let trimmedName = name.trim();
  if (!trimmedName && path.trim()) {
    trimmedName = deriveNameFromPath(path.trim());
  }
  if (!trimmedName) return;
  if (existingNames.has(trimmedName)) return;
  // ... rest unchanged
}
```

Additionally, update the "Create" button's `disabled` condition to allow submission when a path is provided even if name is empty:

```tsx
disabled={(!name.trim() && !path.trim()) || nameCollision}
```

The collision check (`nameCollision`) already handles the case where the derived name conflicts — but since it's computed from `name` state (which is empty), it won't flag a collision for the derived name. The `handleCreate` function should check `existingNames.has(trimmedName)` directly after deriving.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the session name derivation behavior

## Impact

- **Frontend only** — single file change in `create-session-dialog.tsx`
- No backend changes needed — the backend already accepts any valid name
- No API contract changes
- `deriveNameFromPath()` and `toByobuSafeName()` are already tested implicitly through the dropdown selection flow

## Open Questions

None — the scope is clear and the mechanism (`deriveNameFromPath`) already exists.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `deriveNameFromPath()` for name derivation | Function already exists and handles sanitization for tmux/byobu compatibility | S:90 R:95 A:95 D:95 |
| 2 | Certain | Frontend-only change, no backend modification needed | Backend already validates and accepts any valid session name via `ValidateName()` | S:85 R:90 A:95 D:95 |
| 3 | Certain | Enable Create button when path is provided but name is empty | Clarified — user confirmed | S:95 R:90 A:80 D:75 |
| 4 | Certain | Check derived name collision in `handleCreate` rather than via `nameCollision` memo | Clarified — user confirmed | S:95 R:85 A:80 D:70 |

4 assumptions (4 certain, 0 confident, 0 tentative, 0 unresolved).
