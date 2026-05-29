# Intake: Window-ID Routing (stable `@N` identity)

**Change**: 260529-chgz-window-id-routing
**Created**: 2026-05-29
**Status**: Draft

## Origin

Initiated during a `/fab-discuss` session that turned into a code investigation. The user
asked how the left panel, the URL, and the Go server each identify a unique "window" and
"session". A two-pronged code scan (backend + frontend, with the zustand stores) revealed a
**split identity model**:

- The **Zustand store and sidebar** already identify windows by the stable tmux **window ID**
  (`@N`), keying entries as `${server}:${windowId}` and using `windowId` for React keys and
  `data-window-id`.
- The **URL, all HTTP/WS API routes, and every tmux target** identify windows by the **mutable
  window index** (the ordinal position `0,1,2…`), built as `fmt.Sprintf("%s:%d", session, index)`.

The seam between these two identities (the sidebar click handler converting `win.index` → URL/API)
is the root of a class of selection/sync bugs already logged in recent commits (`efa4cf9`,
`10816f6` — "windowId-routing root cause"). When a window is reordered/killed/moved, the index
shifts but the windowId does not, so the URL can point at a *different* window than the store
believes is selected until the next SSE refresh reconciles them.

> **User's raw request**: "We should switch to a standard way to identify window, sessions, that
> also matches the tmux nomenclature? (Yes, you are right, this would fix a lot of index related
> bugs as a side effect). Yes - do sketch what a windowId based routing migration would touch."

**Interaction mode**: Conversational. The user explicitly confirmed the direction (match tmux
nomenclature, accept the bug-fix as a side effect) and asked for a migration sketch, which was
produced and reviewed before this intake.

**Key decision reached**: Adopt the tmux **window ID** (`@N`) as the canonical window identity
across all layers. A window ID is **globally unique on a tmux server and is itself a complete
target** — `tmux kill-window -t @5` needs no session prefix. This lets the migration not merely
swap identifiers but **collapse the `(session, index)` pair to a single `windowId`** for every
window-targeting operation. The session name remains in the URL for human readability and
breadcrumbs but stops being load-bearing for identity.

## Why

**Problem**: Window identity is inconsistent across layers. The frontend store/sidebar use the
stable `windowId`; the URL, API, and tmux layer use the mutable `index`. The two are bridged
only at the sidebar click handler, and the bridge breaks whenever a window's index changes
(reorder, kill, move-to-session).

**Consequence if unfixed**: Index-vs-windowId races persist. After a reorder or kill, the URL
and the actually-selected terminal can disagree until SSE reconciles, producing "clicked window
A, terminal shows window B" bugs. The codebase carries workaround logic (string↔number
conversions, SSE-confirmation reconciliation in `app.tsx`, nearest-index-distance fallback in
`navigation.ts`) purely to paper over the mismatch.

**Why this approach over alternatives**:
- *Make everything use index consistently* — rejected. Index is inherently unstable; it would
  require re-deriving the URL on every reorder and still races with concurrent mutations.
- *Make everything use windowId* — chosen. The windowId is tmux's own stable handle, is already
  the store's key, and is a self-contained tmux target. Aligning on it removes the seam entirely
  and deletes the workaround code as a side effect. This is the "match tmux nomenclature" the
  user asked for.

## What Changes

The identity used for *addressing a specific window* changes from `(session, index)` to a single
`windowId` (`@N`) across the URL, HTTP API, WebSocket relay, and tmux target construction. The
session name is retained in the URL for display/breadcrumbs only. The window **index** is **not
purged** — it remains a property used for *ordering* (move/reorder operations are inherently
positional and cannot be expressed by ID).

End-state mapping:

| Layer | Today | After |
|-------|-------|-------|
| URL | `/$server/$session/$window` (window = index) | `/$server/$session/$windowId` (session = display only) |
| HTTP API routes | `/api/sessions/{session}/windows/{index}/*` | `/api/windows/{windowId}/*` (session drops out) |
| WS relay | `/relay/{session}/{window}` | `/relay/{windowId}` |
| tmux target | `fmt.Sprintf("%s:%d", session, index)` | `windowId` directly (`@5`) |
| Pane-map cache keys | `name:index` | `windowId` |
| Validation | `ValidateName` on the index string | new `ValidateWindowID` (`^@\d+$`) |

### Backend — new validator

Add `ValidateWindowID(id string) string` to `internal/validate/validate.go`, enforcing
`^@[0-9]+$`. This is **stricter** than `ValidateName` (which forbids `:` and `.` but allows `@`)
and is the security boundary for the new path parameter passed into subprocess args
(constitution §I — Security First). Window IDs are never user-typed; they originate from tmux's
`#{window_id}`.

### Backend — tmux target construction (12 sites)

`internal/tmux/tmux.go` currently builds `"%s:%d"` targets at lines 726, 727, 743, 751, 758, 786,
805, 815, 844, 854, 864, 876. After the migration, the target *is* the `windowId`:

```go
// before
target := fmt.Sprintf("%s:%d", session, index)
cmd := exec.CommandContext(ctx, "tmux", "kill-window", "-t", target)
// after
cmd := exec.CommandContext(ctx, "tmux", "kill-window", "-t", windowID) // windowID == "@5"
```

Two sites are special because they are inherently positional:
- **`MoveWindow`** (726-727) — reorders by index. You cannot "move to position 2" by ID. It keeps
  an index/position concept internally; the handler resolves the incoming `windowId` to its
  *current* index, then performs the positional swap.
- **`MoveWindowToSession`** (743) — `tmux move-window -s @5 -t dst:` works with an ID source and a
  session destination.

### Backend — `TmuxOps` interface + handlers

`api/router.go:27-63` — ~11 method signatures change from `(session string, index int, …)` to
`(windowID string, …)`, dropping `session` for most. `api/windows.go` — `parseWindowIndex`
(93-100) becomes `parseWindowID` (validate via `ValidateWindowID`, return string, no `Atoi`).
Every handler (kill, rename, select, split, close-pane, move, move-to-session, color, url, type,
keys) drops its `session`+`index` pair for `windowID`. Routes in `api/router.go:337-347` change
to `/api/windows/{windowId}/*`.

### Backend — WebSocket relay (`api/relay.go`)

The relay is the **trickiest spot**. Today (lines 67-135) it parses `session`+`window index`,
calls `ListWindows(session)` to verify existence, creates an **ephemeral grouped session** keyed
off the *real session name*, then `SelectWindow(ephemeral, winIdx)`. The grouped-session
ephemeral trick is the linchpin of multi-client active-window isolation and **requires the real
session name**.

With a windowId, the relay must **resolve `windowId → session`** before it can build the grouped
ephemeral. Proposed mechanism:

```go
// derive the owning session from the window ID (timeout per constitution §Process Execution)
sessionName := display-message -t @id -p '#{session_name}'   // exec.CommandContext, 5s timeout
```

The relay route becomes `/relay/{windowId}`. The ephemeral-naming, grouped-session, and
`SelectWindow` logic is preserved — `SelectWindow` on the ephemeral can target the windowId
directly (window IDs are shared across grouped sessions).

### Backend — cache keys & lookups (`internal/sessions/sessions.go`)

Pane-map keys at lines 81 and 380 (`fmt.Sprintf("%s:%d", …)`) switch to `windowId` keys.
`ProjectRoot(session, windowIndex, server)` (401-417) switches its lookup to match on `WindowID`.
The `#{window_index}` field in the pane format string (484) MAY stay for *grouping panes within a
window*, but the join key between panes and windows becomes `windowId`.

### Frontend — router + param plumbing

`router.tsx:47-54` — `$window` param semantics change to `windowId` (a string like `@5`). The
`String(w.index)` ↔ `Number(windowIndex)` conversions throughout `app.tsx` (lines 118, 136, 296,
335, 372, 399, 402, 416-427) vanish — `windowId` is a string everywhere, no casting.

### Frontend — API client (11 functions)

`api/client.ts:128-359` — every `index: number` parameter becomes `windowId: string`, URLs change
from `/windows/${index}/*` to `/windows/${windowId}/*`, and `session` drops from most signatures:
`killWindow`, `moveWindow`, `moveWindowToSession`, `renameWindow`, `sendKeys`, `splitWindow`,
`closePane`, `updateWindowUrl`, `updateWindowType`, `selectWindow`, `setWindowColor`.

### Frontend — WS URL + navigation + matching (the bug-fix payoff)

- `terminal-client.tsx:434-437` — `/relay/${session}/${index}` → `/relay/${windowId}`.
- `lib/navigation.ts:49-55` — "find nearest window by index distance" after a kill becomes "the
  windowId is gone; pick a neighbor by list position" (cleaner, no arithmetic).
- `app.tsx:392, 399` — the `String(activeWindow.index) === windowIndex` SSE-reconciliation race
  is replaced by stable `windowId === urlWindowId`. **This is the side-effect bug fix.**
- Sidebar comparisons (`sidebar/index.tsx:582, 604, 908, 1195, 1239`) and top-bar URL building
  (`top-bar.tsx:102-129`) switch index comparisons → windowId. The sidebar already keys React
  rows by windowId, so the click/nav path finally aligns with the rendering path.

### Frontend — store

`store/window-store.ts` is **already keyed by `${server}:${windowId}`** (`entryKey`, line 93-95) —
minimal change. `index` stays as a field for ordering/move (lines 145, 283, 285); it just stops
being the selection key.

## Affected Memory

- `run-kit/architecture`: (modify) Document the window/session identity model — windowId (`@N`)
  as canonical identity across URL/API/relay/tmux; index retained only for ordering.
- `run-kit/ui-patterns`: (modify) URL structure changes from `/$server/$session/$index` to
  `/$server/$session/$windowId`; selection matching is now windowId-based.
- `run-kit/tmux-sessions`: (modify) Note that tmux targets use `windowId` directly (server-global,
  self-contained) rather than `session:index`; relay resolves `windowId → session`.

## Impact

**Backend** (~40 sites, concentrated in 4 files): `internal/validate/validate.go` (new validator),
`internal/tmux/tmux.go` (12 target sites + tests), `api/router.go` (interface + routes),
`api/windows.go` (handlers + parse helper), `api/relay.go` (windowId→session resolution),
`internal/sessions/sessions.go` (cache keys + ProjectRoot). Backend tests
(`tmux_test.go:796-836`) update in lockstep.

**Frontend** (~50 sites, concentrated): `router.tsx`, `app.tsx`, `api/client.ts` (11 fns),
`terminal-client.tsx`, `lib/navigation.ts`, `top-bar.tsx`, `sidebar/index.tsx`, `iframe-window.tsx`,
`window-store.ts` (minimal — already aligned).

**External / behavioral**: Old bookmarked index URLs (`/$server/$session/3`) stop resolving after
the migration. Acceptable — no DB, URLs are ephemeral session state by constitution §II.

**Move/reorder semantics**: Index is **retained** for positional operations. The migration changes
*addressing* (which window), not *ordering* (to which position).

## Open Questions

- For `MoveWindow`/`MoveWindowToSession`, should the API accept `windowId` (source) + a numeric
  `targetIndex` (position), keeping ordering positional? (Proposed: yes — to confirm at spec.)
- Should `/api/sessions/{session}/windows` (the *create-window* and *list* routes, which are
  legitimately session-scoped) stay session-keyed while only window-*targeting* routes move to
  `/api/windows/{windowId}`? (Create/list operate on a session, not a window — likely yes; to
  confirm at spec.)

> **Resolved during intake** (see Assumptions #7, #8):
> - Old index-based bookmarked URLs → **hard break** (no back-compat redirect).
> - Relay derives session via **`display-message -t @id -p '#{session_name}'`** (targeted tmux
>   call, `exec.CommandContext` with 5s timeout).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Adopt tmux window ID (`@N`) as canonical window identity across URL/API/relay/tmux | Discussed and confirmed by user; matches tmux nomenclature; store already keys by windowId | S:95 R:60 A:90 D:90 |
| 2 | Certain | A windowId is a server-global, self-contained tmux target — drop `session:` prefix from window-targeting ops | Verified against tmux behavior during investigation; `kill-window -t @5` needs no session | S:90 R:70 A:95 D:95 |
| 3 | Confident | Retain window `index` for ordering (move/reorder); migrate only *addressing* to windowId | Discussed — reorder is inherently positional, cannot be expressed by ID | S:80 R:65 A:85 D:80 |
| 4 | Confident | Add a new `ValidateWindowID` (`^@\d+$`) rather than reuse `ValidateName` | `ValidateName` is too permissive for the new path param; constitution §I demands strict subprocess-input validation | S:80 R:75 A:85 D:75 |
| 5 | Confident | Relay resolves `windowId → session` to preserve the grouped-session ephemeral mechanism | Grouped ephemeral keys off real session name; relay must derive it from windowId | S:75 R:55 A:80 D:70 |
| 6 | Confident | Window-*targeting* routes move to `/api/windows/{windowId}`; create/list stay session-scoped | Create/list operate on a session, not a specific window — session is the natural key there | S:70 R:60 A:80 D:70 |
| 7 | Confident | Hard break for old index-based bookmarked URLs (no back-compat redirect) | Discussed — user chose hard break; no DB / ephemeral URLs per constitution §II; a shim adds complexity for little value | S:90 R:45 A:80 D:90 |
| 8 | Confident | Relay derives session via `display-message -t @id -p '#{session_name}'` (exec.CommandContext, 5s timeout) | Discussed — user chose the targeted call over folding into ListWindows; O(1), clearest intent, errors cleanly if windowId gone | S:90 R:60 A:80 D:90 |

8 assumptions (2 certain, 6 confident, 0 tentative, 0 unresolved).
