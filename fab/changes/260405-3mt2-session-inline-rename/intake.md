# Intake: Session Name Inline Rename

**Change**: 260405-3mt2-session-inline-rename
**Created**: 2026-04-05
**Status**: Draft

## Origin

> Allow double click rename for session name on the left panel also - just like window name

One-shot request. User identified the asymmetry between window name inline rename (double-click to edit) and session name rename (dialog-only). The desired behavior is explicitly "just like window name" — a direct pattern match to the existing implementation.

## Why

Window names in the sidebar already support double-click to edit inline: the name becomes an input, Enter/blur commits, Escape cancels. Session names in the sidebar do not — renaming a session requires opening a separate dialog (via the command palette or `app.tsx`).

This inconsistency creates a friction point: users who discover window rename by double-clicking expect the same to work on session names. It doesn't, which is surprising and slightly slower (modal vs. inline).

Adding inline rename for session names in the sidebar eliminates that inconsistency. The dialog-based rename in `app.tsx` can remain for command-palette access — the two mechanisms can coexist.

## What Changes

### `app/frontend/src/components/sidebar.tsx`

**Imports**: Add `renameSession` from `@/api/client` to the existing import line.

**New state and refs**:
```tsx
const [editingSession, setEditingSession] = useState<string | null>(null);
const [editingSessionName, setEditingSessionName] = useState("");
const sessionInputRef = useRef<HTMLInputElement>(null);
const sessionCancelledRef = useRef(false);
const sessionOriginalNameRef = useRef("");
```

**New optimistic action** (mirrors `executeRenameWindow` pattern):
```tsx
const lastRenameSessionRef = useRef<string | null>(null);
const { execute: executeRenameSession } = useOptimisticAction<[string, string]>({
  action: (oldName, newName) => renameSession(oldName, newName),
  onOptimistic: (oldName, newName) => {
    lastRenameSessionRef.current = oldName;
    markRenamed("session", oldName, newName);
  },
  onRollback: () => {
    if (lastRenameSessionRef.current) unmarkRenamed(lastRenameSessionRef.current);
  },
  onError: (err) => {
    addToast(err.message || "Failed to rename session");
  },
});
```

**New `useEffect`** to auto-focus/select the session input when editing starts:
```tsx
useEffect(() => {
  if (editingSession && sessionInputRef.current) {
    sessionInputRef.current.focus();
    sessionInputRef.current.select();
  }
}, [editingSession]);
```

**New handlers**:
```tsx
function handleStartSessionEditing(sessionName: string) {
  cancelledRef.current = true;    // cancel any in-progress window edit
  setEditingWindow(null);
  sessionCancelledRef.current = true;
  setEditingSession(sessionName);
  setEditingSessionName(sessionName);
  sessionOriginalNameRef.current = sessionName;
  sessionCancelledRef.current = false;
}

function handleSessionRenameCommit() {
  if (!editingSession) return;
  const trimmed = editingSessionName.trim();
  const originalName = sessionOriginalNameRef.current;
  const sessionName = editingSession;
  setEditingSession(null);
  if (trimmed && trimmed !== originalName) {
    executeRenameSession(sessionName, trimmed);
  }
}

function handleSessionRenameCancel() {
  sessionCancelledRef.current = true;
  setEditingSession(null);
}

function handleSessionRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSessionRenameCommit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    handleSessionRenameCancel();
  }
}

function handleSessionRenameBlur() {
  if (sessionCancelledRef.current) return;
  handleSessionRenameCommit();
}
```

**Updated `handleStartEditing`** — add cross-cancellation of session editing:
```tsx
function handleStartEditing(session: string, index: number, currentName: string) {
  sessionCancelledRef.current = true;  // cancel any in-progress session edit
  setEditingSession(null);
  cancelledRef.current = true;          // cancel any in-progress window edit before switching
  setEditingWindow({ session, index });
  setEditingName(currentName);
  originalNameRef.current = currentName;
  cancelledRef.current = false;
}
```

**Updated JSX** — the session name span inside the navigation button:

Before:
```tsx
<button
  onClick={() => onSelectWindow(session.name, session.windows[0]?.index ?? 0)}
  className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[36px] min-w-0"
  aria-label={`Navigate to ${session.name}`}
>
  <span className="font-medium truncate">{session.name}</span>
</button>
```

After:
```tsx
<button
  onClick={() => onSelectWindow(session.name, session.windows[0]?.index ?? 0)}
  className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[36px] min-w-0"
  aria-label={`Navigate to ${session.name}`}
>
  {editingSession === session.name ? (
    <input
      ref={sessionInputRef}
      type="text"
      value={editingSessionName}
      onChange={(e) => setEditingSessionName(e.target.value)}
      onKeyDown={handleSessionRenameKeyDown}
      onBlur={handleSessionRenameBlur}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="text-sm font-medium bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
      aria-label="Rename session"
    />
  ) : (
    <span
      className="font-medium truncate"
      onDoubleClick={(e) => {
        e.stopPropagation();
        handleStartSessionEditing(session.name);
      }}
    >
      {session.name}
    </span>
  )}
</button>
```

### `app/frontend/src/components/sidebar.test.tsx`

**Mock addition**: Add `renameSession` to the `vi.mock("@/api/client")` block:
```tsx
renameSession: vi.fn().mockResolvedValue({ ok: true }),
```

**New test suite** `describe("inline rename session")` — mirrors the window rename tests:
- Double-click on session name activates inline input with `aria-label="Rename session"`
- Enter commits rename and calls `renameSession(oldName, newName)`
- Escape cancels without calling `renameSession`
- Blur commits rename
- Empty input cancels without API call
- Unchanged name skips API call
- Double-click on session B while editing session A cancels A without committing
- Single-click navigates without triggering edit

## Affected Memory

- `run-kit/ui-patterns`: (modify) document inline rename pattern now applies to both session and window names in the sidebar

## Impact

- `app/frontend/src/components/sidebar.tsx` — all changes are additive (new state, refs, handlers) plus a targeted JSX update for the session name element
- `app/frontend/src/components/sidebar.test.tsx` — add mock entry and new test suite
- `app/frontend/src/api/client.ts` — no changes (API already exists)
- `app/frontend/src/app.tsx` — no changes (dialog-based rename continues working unchanged)
- No backend changes

## Open Questions

None. The implementation is a direct pattern-match to the existing window rename, with the `renameSession` API already present.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mirror window inline rename pattern exactly (double-click → input → Enter/blur commit, Escape cancel) | User explicitly said "just like window name"; window pattern is fully implemented and tested | S:90 R:90 A:90 D:95 |
| 2 | Confident | Cross-cancel: starting session edit cancels any open window edit (and vice versa) | Only one inline edit should be active at a time; existing window-to-window cancel pattern extends naturally | S:60 R:85 A:80 D:80 |
| 3 | Confident | Keep dialog-based session rename in app.tsx unchanged | User said "also" — additive, not replacement; dialog serves command-palette access | S:85 R:60 A:90 D:90 |
| 4 | Confident | Blur commits rename (same as window) | "Just like window name" implies full behavioral parity including blur-commit | S:65 R:90 A:90 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
