# Spec: Window-ID Routing (stable `@N` identity)

**Change**: 260529-chgz-window-id-routing
**Created**: 2026-05-29
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/tmux-sessions.md`

<!--
  This change migrates the *addressing identity* of a window from the mutable tmux
  window index to the stable tmux window ID (@N) across the URL, HTTP API, WebSocket
  relay, and tmux target construction. The window index is RETAINED for positional
  operations (reorder/move). Sessions are unaffected — they remain identified by name.
-->

## Non-Goals

- **Changing how sessions are identified** — sessions remain identified by name across all layers. Only window *addressing* changes.
- **Removing the window index entirely** — `index` is retained as a `WindowInfo` field and as the positional argument for reorder/move operations. Reordering is inherently positional and cannot be expressed by ID.
- **Back-compat for old index-based URLs** — old bookmarked URLs of the form `/$server/$session/3` (numeric window segment) are a hard break. No redirect shim. (Assumption #7.)
- **Changing the create-window / list-windows routes** — these operate on a *session*, not a specific window; they remain session-scoped (`/api/sessions/{session}/windows` for POST create, session enumeration for list). Only window-*targeting* routes move to windowId. (Assumption #6.)
- **Altering the tmux-authoritative selection model** — the `isActiveWindow`-driven selection and SSE writeback contract from `260528-nvlp-active-window-sync` is preserved; this change only stabilizes the *identifier* those mechanisms compare.

---

## Backend: Window Identity & Validation

### Requirement: Window ID validation
The backend SHALL provide a `validate.ValidateWindowID(id string) string` function that accepts a tmux window ID and returns an empty string when valid or an error message when invalid. A valid window ID MUST match `^@[0-9]+$`. This validator MUST be used for every window-ID path parameter and request-body field that is subsequently passed into a subprocess argument (constitution §I — Security First). `ValidateName` SHALL NOT be reused for window IDs because it permits `@` but does not constrain the value to the `@N` shape.

#### Scenario: Valid window ID accepted
- **GIVEN** the input string `@5`
- **WHEN** `ValidateWindowID("@5", ...)` is called
- **THEN** it returns the empty string (valid)

#### Scenario: Malformed window ID rejected
- **GIVEN** an input that does not match `^@[0-9]+$` (e.g., `5`, `@`, `@5;rm`, `window-5`, empty string)
- **WHEN** `ValidateWindowID(...)` is called
- **THEN** it returns a non-empty error message
- **AND** no subprocess is invoked with the rejected value

### Requirement: tmux targets use window ID directly
All tmux window-*targeting* commands (`kill-window`, `rename-window`, `select-window`, `split-window`, `send-keys`, `set-option -w`, `set-option -wu`) SHALL target a window by its window ID (`@N`) passed directly as the `-t` target, rather than constructing a `session:index` target string. A window ID is a server-global, self-contained tmux target and MUST NOT be prefixed with the session name.

#### Scenario: Kill window by ID
- **GIVEN** a window with ID `@7` on server `runkit`
- **WHEN** the backend kills that window
- **THEN** it runs `tmux -L runkit kill-window -t @7`
- **AND** the command contains no `session:index` target string

#### Scenario: Set window option by ID
- **GIVEN** a window with ID `@7`
- **WHEN** the backend sets the `@rk_url` option on it
- **THEN** it runs `tmux set-option -w -t @7 @rk_url <value>`

### Requirement: Window-targeting tmux operation signatures take window ID
The `TmuxOps` interface methods that target a specific existing window — `KillWindow`, `RenameWindow`, `SelectWindow`, `SplitWindow`, `SendKeys`, `KillActivePane`, `SetWindowColor`, `UnsetWindowColor`, `SetWindowOption`, `UnsetWindowOption` — SHALL accept a `windowID string` parameter identifying the target window, and SHALL NOT require both a `session` and a numeric `index` to identify it. The corresponding concrete `internal/tmux` functions SHALL be updated in lockstep.

#### Scenario: Interface method targets by ID
- **GIVEN** the `KillWindow` method
- **WHEN** its signature is inspected after the change
- **THEN** it takes a `windowID string` (e.g., `KillWindow(windowID, server string) error`)
- **AND** it does not take a separate `session` + `index` pair to identify the window

### Requirement: Positional operations retain index semantics
`MoveWindow` (reorder within a session) and `MoveWindowToSession` (move to another session) are inherently positional. They SHALL identify the *source* window by its window ID, but the *destination* SHALL remain a position/session: `MoveWindow` accepts a source `windowID` and a numeric `targetIndex`; `MoveWindowToSession` accepts a source `windowID` and a `targetSession` name. The reorder/move MUST preserve the window's ID (tmux's documented `move-window` contract — see `tmux-sessions.md` § Window ID stability), changing only its index.

#### Scenario: Reorder by source ID to target position
- **GIVEN** a window `@7` at index 2 in session `proj`
- **WHEN** the backend reorders it to index 0
- **THEN** the operation identifies the source as `@7` and the destination as position 0
- **AND** after the move the window still has ID `@7` at index 0

#### Scenario: Move to another session by source ID
- **GIVEN** a window `@7` in session `proj`
- **WHEN** the backend moves it to session `other`
- **THEN** the source is identified as `@7` and the destination as session `other`
- **AND** the window retains ID `@7` in its new session

---

## Backend: API Routes

### Requirement: Window-targeting routes keyed by window ID
HTTP routes that mutate or act on a *specific existing window* SHALL be keyed by window ID under `/api/windows/{windowId}/...`: `kill`, `move`, `move-to-session`, `rename`, `color`, `url` (PUT), `type` (PUT), `keys`, `select`, `split`, `close-pane`. The `{windowId}` path parameter MUST be validated via `ValidateWindowID` before use. Routes that create a window or enumerate a session's windows SHALL remain session-scoped (`/api/sessions/{session}/windows` POST for create; session enumeration unchanged).

#### Scenario: Kill route uses window ID
- **GIVEN** the kill-window endpoint after the change
- **WHEN** a client kills window `@7`
- **THEN** it POSTs to `/api/windows/@7/kill?server=<name>`
- **AND** the handler validates `@7` via `ValidateWindowID` and returns 400 on a malformed ID

#### Scenario: Create-window route stays session-scoped
- **GIVEN** the create-window endpoint
- **WHEN** a client creates a window in session `proj`
- **THEN** it POSTs to `/api/sessions/proj/windows` (session in the path, no window ID — the window does not exist yet)

### Requirement: Window-ID parse helper
`api/windows.go` SHALL provide a `parseWindowID(r) (string, bool)` helper that extracts the `{windowId}` path parameter, validates it via `ValidateWindowID`, and returns `(id, true)` on success or `("", false)` on failure. It replaces `parseWindowIndex`. Handlers SHALL return HTTP 400 when the helper reports failure.

#### Scenario: Handler rejects malformed ID
- **GIVEN** a request to `/api/windows/bogus/kill`
- **WHEN** the handler calls `parseWindowID`
- **THEN** the helper returns `("", false)`
- **AND** the handler responds 400 without invoking tmux

---

## Backend: WebSocket Relay

### Requirement: Relay route keyed by window ID with session resolution
The relay endpoint SHALL be `/relay/{windowId}?server=<name>`. The `{windowId}` MUST be validated via `ValidateWindowID`. Because the per-WebSocket ephemeral grouped-session mechanism (`tmux-sessions.md` § Per-WebSocket Ephemeral Grouped Sessions) keys off the *real session name*, the relay handler SHALL resolve the owning session from the window ID before creating the ephemeral, by running `tmux [-L <server>] display-message -t <windowId> -p '#{session_name}'` via `exec.CommandContext` with a timeout consistent with sibling tmux operations (5s). If the window ID does not exist (resolution fails or returns empty), the relay SHALL close the WebSocket with code `4004` ("Window not found"), preserving the existing not-found contract. The ephemeral creation, grouped-session indirection, `select-window` on the ephemeral (now targeting the window ID), `attach-session`, and disconnect cleanup SHALL otherwise be unchanged.

#### Scenario: Relay resolves session from window ID
- **GIVEN** a WebSocket connection to `/relay/@7?server=runkit` where `@7` lives in session `proj`
- **WHEN** the relay handler starts
- **THEN** it resolves the owning session to `proj` via `display-message -t @7 -p '#{session_name}'`
- **AND** creates the ephemeral grouped session against `proj`
- **AND** selects `@7` on the ephemeral

#### Scenario: Relay rejects unknown window ID
- **GIVEN** a WebSocket connection to `/relay/@999` where no window `@999` exists on the server
- **WHEN** session resolution runs
- **THEN** resolution fails or returns empty
- **AND** the WebSocket closes with code `4004`

#### Scenario: Relay rejects malformed window ID
- **GIVEN** a WebSocket connection to `/relay/notanid`
- **WHEN** the handler validates the path parameter
- **THEN** `ValidateWindowID` fails and the handler responds 400 (before upgrade) — no tmux call is made

---

## Backend: Caching & Lookups

### Requirement: Pane-map enrichment keyed by window ID
The fab pane-map enrichment join in `internal/sessions` SHALL key windows by window ID rather than `session:index`. The `dedupEntries` collision key and the `FetchSessions` enrichment lookup key SHALL both use the window ID. The pane-map source data already carries enough information to associate panes with their window; `#{window_index}` MAY remain in the pane format string solely for grouping panes within a window, but the join key between a `WindowInfo` and its fab/agent enrichment SHALL be the window ID.

#### Scenario: Enrichment joins by window ID
- **GIVEN** two windows in the same session at indices 0 and 1 with IDs `@3` and `@4`
- **WHEN** pane-map enrichment runs
- **THEN** each window's fab/agent state is joined by its window ID, not its index
- **AND** a reorder that swaps indices 0↔1 does not misattribute enrichment

### Requirement: ProjectRoot lookup by window ID
`internal/sessions.ProjectRoot` SHALL identify the target window by window ID rather than by `(session, windowIndex)`.

#### Scenario: ProjectRoot resolves by ID
- **GIVEN** a request for the project root of window `@7`
- **WHEN** `ProjectRoot` runs
- **THEN** it matches the window whose `WindowID == "@7"` and returns its worktree path

---

## Frontend: Routing & Identity

### Requirement: URL window segment is the window ID
The terminal route SHALL be `/$server/$session/$windowId`, where the third segment is the tmux window ID (`@N`). The `$session` segment is retained for human readability and breadcrumb display but is NOT the window's identity. All `String(index)` ↔ `Number(windowParam)` conversions in the route-param plumbing SHALL be removed — the window ID is a string at every layer.

#### Scenario: Navigating to a window uses its ID
- **GIVEN** a window with ID `@7` in session `proj` on server `runkit`
- **WHEN** the app navigates to that window
- **THEN** the URL is `/runkit/proj/@7`
- **AND** no numeric index appears in the path

#### Scenario: Current window resolved from URL by ID
- **GIVEN** the URL `/runkit/proj/@7`
- **WHEN** the app resolves the current window from session data
- **THEN** it matches the window whose `windowId === "@7"` (no `String(index)` comparison)

### Requirement: Selection matching compares window IDs
Mount-time URL alignment and the continuous URL writeback (see `ui-patterns.md` § URL as Resumable Bookmark) SHALL compare the URL's window ID against the active window's `windowId`, not its index. Sidebar selection (`WindowRow.isSelected`), top-bar breadcrumb "current" detection, and the "navigate to nearest window after kill" logic SHALL all key off window ID.

#### Scenario: Writeback compares IDs
- **GIVEN** the SSE-derived active window has ID `@7` and the URL window segment is `@4`
- **WHEN** the writeback effect runs
- **THEN** it detects the mismatch via `activeWindow.windowId !== urlWindowId` and navigates to `@7`

#### Scenario: Reorder does not trigger spurious navigation
- **GIVEN** the user is viewing window `@7` (at index 2) and a reorder shifts `@7` to index 0
- **WHEN** the SSE snapshot arrives with the new indices
- **THEN** the URL window segment `@7` still matches `activeWindow.windowId` and no navigation fires
- **AND** the terminal does not reconnect or switch windows

### Requirement: Nearest-window fallback after kill uses list position
When the currently-viewed window is killed, the navigation fallback SHALL select a neighbor by its position in the current window list (e.g., the entry that occupied the adjacent slot), rather than computing a numeric index distance. The destination SHALL be expressed as the neighbor's window ID.

#### Scenario: Kill current window navigates to neighbor by ID
- **GIVEN** the user is viewing window `@7` which is then killed
- **WHEN** the kill is observed via SSE
- **THEN** the app navigates to an adjacent surviving window's ID (e.g., `@4`)
- **AND** does not attempt arithmetic on numeric indices

---

## Frontend: API Client

### Requirement: Window-targeting client functions take window ID
Every `api/client.ts` function that targets a specific existing window — `killWindow`, `moveWindow`, `moveWindowToSession`, `renameWindow`, `sendKeys`, `splitWindow`, `closePane`, `updateWindowUrl`, `updateWindowType`, `selectWindow`, `setWindowColor` — SHALL take a `windowId: string` argument in place of the `index: number` argument and build URLs of the form `/api/windows/${windowId}/...`. For `moveWindow`, the source is the `windowId` and the target remains a numeric `targetIndex`; for `moveWindowToSession`, the source is the `windowId` and the target remains a `targetSession` name. These functions SHALL retain `server` as their first positional argument per the frontend server-routing contract (`tmux-sessions.md` § Frontend Server Routing Contract); the `session` argument SHALL be dropped where it is no longer needed to address the window.

#### Scenario: killWindow builds an ID-keyed URL
- **GIVEN** `killWindow(server, "@7")` after the change
- **WHEN** it builds the request URL
- **THEN** the URL is `/api/windows/@7/kill?server=<server>`

#### Scenario: moveWindow keeps positional target
- **GIVEN** `moveWindow(server, "@7", 0)` (source ID, target index 0)
- **WHEN** it builds the request
- **THEN** it POSTs to `/api/windows/@7/move` with body `{ "targetIndex": 0 }`

### Requirement: WebSocket relay URL uses window ID
The terminal client SHALL construct the relay WebSocket URL as `ws(s)://<host>/relay/${windowId}?server=<server>`. The session name SHALL NOT appear in the relay URL.

#### Scenario: Relay URL omits session
- **GIVEN** a terminal for window `@7` on server `runkit`
- **WHEN** the WebSocket URL is built
- **THEN** it is `ws://<host>/relay/@7?server=runkit`

---

## Frontend: Store

### Requirement: Store remains window-ID-keyed; index is non-identifying
The window store SHALL continue to key entries by `${server}:${windowId}` (`entryKey`). The `index` field is retained on each entry solely for ordering and the positional reorder API; it SHALL NOT be used as the selection identity. No new store keying is introduced by this change.

#### Scenario: Store key unaffected
- **GIVEN** the window store after the change
- **WHEN** an entry is looked up
- **THEN** it is keyed by `${server}:${windowId}` exactly as before
- **AND** `index` remains present for reorder operations

---

## Design Decisions

1. **Adopt the tmux window ID (`@N`) as the canonical window identity across URL/API/relay/tmux.**
   - *Why*: The window ID is tmux's own stable handle, is server-global and self-contained as a `-t` target, is already the window store's key, and is already the identity used by the boards feature (`@rk_board` stores `<window_id>:<board>:<order_key>`). Aligning the URL/API/relay/tmux layers on it removes the index↔ID seam and makes mount-time alignment + writeback compare stable values.
   - *Rejected*: Standardize everything on the index — the index is mutable (reorder/kill shift it), so the URL would need re-derivation on every reorder and would still race with concurrent mutations. This is the status quo the change exists to eliminate.

2. **Retain the window index for positional operations only.**
   - *Why*: Reordering a window is inherently "move to position N"; a stable ID cannot express a position. Move/reorder identify the *source* by ID but keep a numeric/session *destination*.
   - *Rejected*: Purge index entirely — impossible for reorder semantics, and the index is still the natural pane-grouping field in the tmux pane format string.

3. **Relay resolves `windowId → session` via `display-message`.**
   - *Why*: The grouped-session ephemeral mechanism keys off the real session name. A targeted `display-message -t @id -p '#{session_name}'` is O(1), expresses intent clearly, and errors cleanly (→ 4004) when the window is gone.
   - *Rejected*: Fold resolution into a `list-windows -a` enumeration — couples the relay to the enumeration path and scans all windows to find one. (Assumption #8.)

4. **Hard break for old index-based URLs.**
   - *Why*: No database, URLs are ephemeral session pointers (constitution §II). A redirect shim adds a transitional code path for negligible value.
   - *Rejected*: Back-compat redirect resolving a numeric segment to the current window ID — extra resolution logic to maintain. (Assumption #7.)

5. **Window-targeting routes move to `/api/windows/{windowId}`; create/list stay session-scoped.**
   - *Why*: Creating a window and listing a session's windows operate on a *session*, not a specific window — the session is the natural key. Only operations on an *existing specific window* gain a stable ID key. (Assumption #6.)
   - *Rejected*: Move every window route (including create) under `/api/windows/...` — there is no window ID to key on at create time.

---

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Adopt tmux window ID (`@N`) as canonical window identity across URL/API/relay/tmux | Confirmed from intake #1; user-confirmed and corroborated by spec analysis — store and boards already use windowId; matches tmux nomenclature | S:95 R:60 A:92 D:92 |
| 2 | Certain | A windowId is a server-global, self-contained tmux target — drop `session:` prefix from window-targeting ops | Confirmed from intake #2; verified against tmux behavior; `kill-window -t @5` needs no session | S:92 R:70 A:95 D:95 |
| 3 | Certain | Retain window `index` for positional ops (reorder/move); migrate only *addressing* to windowId | Upgraded from intake Confident #3 — spec analysis confirms reorder cannot be ID-expressed and `move-window` preserves windowId per documented tmux contract (tmux-sessions.md) | S:88 R:70 A:90 D:88 |
| 4 | Certain | Add a new `ValidateWindowID` (`^@\d+$`); do not reuse `ValidateName` | Upgraded from intake Confident #4 — `ValidateName` permits `@` but not the `@N` shape; constitution §I demands strict subprocess-input validation; the boards feature already validates windowId with the same regex | S:90 R:75 A:92 D:90 |
| 5 | Confident | Relay resolves `windowId → session` via `display-message -t @id -p '#{session_name}'` (5s timeout) | Confirmed from intake #5/#8 (user choice); grouped ephemeral keys off real session name; targeted call is O(1) and errors cleanly to 4004 | S:88 R:55 A:85 D:85 |
| 6 | Confident | Window-targeting routes → `/api/windows/{windowId}`; create/list stay session-scoped | Confirmed from intake #6; create/list operate on a session, not a specific window — no windowId exists at create time | S:82 R:60 A:85 D:80 |
| 7 | Confident | Hard break for old index-based bookmarked URLs (no back-compat redirect) | Confirmed from intake #7 (user choice); no DB / ephemeral URLs per constitution §II | S:90 R:45 A:82 D:90 |
| 8 | Confident | Preserve the tmux-authoritative selection model (`isActiveWindow` + SSE writeback) from 260528-nvlp; only the compared identifier changes index→windowId | New (spec-discovered) — memory shows selection is already tmux-authoritative; this change must not regress that, only stabilize the identifier | S:85 R:55 A:88 D:82 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
