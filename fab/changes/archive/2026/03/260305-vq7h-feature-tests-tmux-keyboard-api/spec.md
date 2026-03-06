# Spec: Feature Tests for tmux, Keyboard Nav, and Sessions API

**Change**: 260305-vq7h-feature-tests-tmux-keyboard-api
**Created**: 2026-03-05
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Testing tmux mutation functions (`createSession`, `createWindow`, `killSession`, `killWindow`, `sendKeys`, `splitPane`, `killPane`, `capturePane`) in isolation — these are thin `tmuxExec` wrappers with no transform logic
- Testing the GET handler on `/api/sessions` — it delegates to `fetchSessions()` with no validation logic
- Testing the SSE stream endpoint — out of scope for this change
- Integration testing against a real tmux server — all tests mock subprocess/tmux calls

## Testing: tmux.ts

### Requirement: listSessions parses tmux output into session names

`listSessions()` SHALL parse tab-delimited `tmux list-sessions` output (fields: `session_name`, `session_grouped`, `session_group`) and return an array of session name strings.

#### Scenario: Parse standard sessions
- **GIVEN** tmux returns two sessions with `session_grouped=0`
- **WHEN** `listSessions()` is called
- **THEN** it returns both session names

#### Scenario: Filter session-group copies
- **GIVEN** tmux returns sessions where one has `session_grouped=1` and `name !== group`
- **WHEN** `listSessions()` is called
- **THEN** the derived copy is excluded from the result

#### Scenario: Keep group-named session
- **GIVEN** tmux returns a session where `session_grouped=1` and `name === group`
- **WHEN** `listSessions()` is called
- **THEN** the group-named session is included in the result

#### Scenario: tmux not running
- **GIVEN** `execFile` throws an error (tmux server not running)
- **WHEN** `listSessions()` is called
- **THEN** it returns an empty array `[]`

### Requirement: listWindows parses window info with activity status

`listWindows(session)` SHALL parse tab-delimited `tmux list-windows` output (fields: `window_index`, `window_name`, `pane_current_path`, `window_activity`) and return `WindowInfo[]` with computed `activity` status.

#### Scenario: Active window
- **GIVEN** tmux returns a window whose `window_activity` timestamp is within `ACTIVITY_THRESHOLD_SECONDS` of now
- **WHEN** `listWindows(session)` is called
- **THEN** the window's `activity` field is `"active"`

#### Scenario: Idle window
- **GIVEN** tmux returns a window whose `window_activity` timestamp exceeds `ACTIVITY_THRESHOLD_SECONDS` from now
- **WHEN** `listWindows(session)` is called
- **THEN** the window's `activity` field is `"idle"`

#### Scenario: Parse multiple fields
- **GIVEN** tmux returns a line `0\tdev\t/home/user/project\t1709600000`
- **WHEN** `listWindows(session)` is called
- **THEN** the result contains `{ index: 0, name: "dev", worktreePath: "/home/user/project", activity: ... }`

#### Scenario: Session does not exist
- **GIVEN** `execFile` throws (session not found)
- **WHEN** `listWindows("nonexistent")` is called
- **THEN** it returns an empty array `[]`

## Testing: use-keyboard-nav.ts

### Requirement: j/k navigation moves focusedIndex

The hook SHALL increment `focusedIndex` on `j` keypress and decrement on `k` keypress, clamped to `[0, itemCount - 1]`.

#### Scenario: j increments
- **GIVEN** `focusedIndex` is 0 and `itemCount` is 3
- **WHEN** the user presses `j`
- **THEN** `focusedIndex` becomes 1

#### Scenario: j clamps at max
- **GIVEN** `focusedIndex` is 2 and `itemCount` is 3
- **WHEN** the user presses `j`
- **THEN** `focusedIndex` remains 2

#### Scenario: k decrements
- **GIVEN** `focusedIndex` is 1 and `itemCount` is 3
- **WHEN** the user presses `k`
- **THEN** `focusedIndex` becomes 0

#### Scenario: k clamps at zero
- **GIVEN** `focusedIndex` is 0
- **WHEN** the user presses `k`
- **THEN** `focusedIndex` remains 0

### Requirement: Enter triggers onSelect

The hook SHALL call `onSelect(focusedIndex)` when the user presses `Enter`.

#### Scenario: Enter with current index
- **GIVEN** `focusedIndex` is 1
- **WHEN** the user presses `Enter`
- **THEN** `onSelect` is called with `1`

### Requirement: Skip input elements

The hook SHALL ignore keystrokes when the event target is `<input>`, `<textarea>`, or has `contentEditable` set.

#### Scenario: Typing in input
- **GIVEN** the focused element is an `<input>`
- **WHEN** the user presses `j`
- **THEN** `focusedIndex` does not change

### Requirement: Clamp on itemCount decrease

The hook SHALL clamp `focusedIndex` to `itemCount - 1` when `itemCount` decreases below the current index.

#### Scenario: Items removed
- **GIVEN** `focusedIndex` is 4 and `itemCount` was 5
- **WHEN** `itemCount` changes to 3
- **THEN** `focusedIndex` becomes 2

### Requirement: Custom shortcuts

The hook SHALL invoke functions from the `shortcuts` map when the corresponding key is pressed.

#### Scenario: Custom key handler
- **GIVEN** `shortcuts` contains `{ "x": handler }`
- **WHEN** the user presses `x`
- **THEN** `handler` is called

## Testing: api/sessions POST handler

### Requirement: Action dispatch with validation

The POST handler SHALL dispatch to the correct tmux function based on `body.action`, validating inputs per action. Invalid input SHALL return 400. tmux errors SHALL return 500.

#### Scenario: createSession — valid
- **GIVEN** `{ action: "createSession", name: "my-session" }`
- **WHEN** POST is called
- **THEN** `createSession("my-session")` is invoked and response is `200 { ok: true }`

#### Scenario: createSession — empty name
- **GIVEN** `{ action: "createSession", name: "" }`
- **WHEN** POST is called
- **THEN** response is `400` with error containing "cannot be empty"

#### Scenario: createSession — forbidden chars
- **GIVEN** `{ action: "createSession", name: "bad;name" }`
- **WHEN** POST is called
- **THEN** response is `400` with error containing "forbidden characters"

#### Scenario: createWindow — valid
- **GIVEN** `{ action: "createWindow", session: "s", name: "w", cwd: "/tmp" }`
- **WHEN** POST is called
- **THEN** `createWindow("s", "w", "/tmp")` is invoked and response is `200 { ok: true }`

#### Scenario: createWindow — missing fields
- **GIVEN** `{ action: "createWindow", session: "", name: "", cwd: "" }`
- **WHEN** POST is called
- **THEN** response is `400` (first failing validation)

#### Scenario: killSession — valid
- **GIVEN** `{ action: "killSession", session: "my-session" }`
- **WHEN** POST is called
- **THEN** `killSession("my-session")` is invoked and response is `200 { ok: true }`

#### Scenario: killWindow — valid
- **GIVEN** `{ action: "killWindow", session: "s", index: 2 }`
- **WHEN** POST is called
- **THEN** `killWindow("s", 2)` is invoked and response is `200 { ok: true }`

#### Scenario: killWindow — non-integer index
- **GIVEN** `{ action: "killWindow", session: "s", index: 1.5 }`
- **WHEN** POST is called
- **THEN** response is `400` with "Invalid window index"

#### Scenario: sendKeys — valid
- **GIVEN** `{ action: "sendKeys", session: "s", window: 0, keys: "ls" }`
- **WHEN** POST is called
- **THEN** `sendKeys("s", 0, "ls")` is invoked and response is `200 { ok: true }`

#### Scenario: sendKeys — empty keys
- **GIVEN** `{ action: "sendKeys", session: "s", window: 0, keys: "" }`
- **WHEN** POST is called
- **THEN** response is `400` with "Keys cannot be empty"

#### Scenario: Unknown action
- **GIVEN** `{ action: "unknownAction" }`
- **WHEN** POST is called
- **THEN** response is `400` with "Unknown action"

#### Scenario: Missing action field
- **GIVEN** `{ noAction: true }`
- **WHEN** POST is called
- **THEN** response is `400` with "Missing or invalid action"

#### Scenario: tmux error propagates as 500
- **GIVEN** `{ action: "createSession", name: "valid" }` and `createSession` throws
- **WHEN** POST is called
- **THEN** response is `500` with the error message

## Design Decisions

1. **Mock `execFile` for tmux.ts, mock tmux functions for route.ts**: tmux.ts tests mock at the `child_process.execFile` level to verify parsing logic. Route tests mock at the `@/lib/tmux` module level to focus on validation and dispatch — avoids duplicating tmux parsing tests.
   - *Why*: Each test layer exercises its own logic without coupling to the layer below.
   - *Rejected*: Mocking `execFile` in route tests — would duplicate tmux parsing coverage and make tests fragile to tmux.ts internals.

2. **Direct function invocation for route handler**: Import and call `POST(new Request(...))` directly rather than spinning up a test HTTP server.
   - *Why*: Next.js route handlers are async functions accepting standard `Request` objects. Direct invocation is simpler, faster, and sufficient for testing validation + dispatch logic.
   - *Rejected*: `supertest` / test server — unnecessary overhead for unit tests, adds a dependency.

3. **Test files in `__tests__/` folders**: Per project convention (`code-quality.md`, `vitest.config.ts` include pattern), test files go in `__tests__/` subdirectories adjacent to source — not as sibling `.test.ts` files.
   - *Why*: Matches existing pattern (`src/lib/__tests__/validate.test.ts`, etc.) and vitest include glob.
   - *Rejected*: Sibling test files — breaks the established `__tests__/` convention.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Test targets: tmux.ts, use-keyboard-nav.ts, api/sessions/route.ts | Confirmed from intake #1 — user explicitly chose these | S:95 R:95 A:90 D:95 |
| 2 | Certain | Vitest infrastructure from 260303-07iq-setup-vitest is prerequisite | Confirmed from intake #2 — additive test files only | S:95 R:90 A:95 D:95 |
| 3 | Certain | vi.mock for child_process.execFile in tmux.ts tests | Confirmed from intake #3 — standard Vitest mocking for subprocess isolation | S:85 R:95 A:90 D:90 |
| 4 | Certain | renderHook + fireEvent for use-keyboard-nav tests | Confirmed from intake #4 — @testing-library/react standard | S:85 R:95 A:90 D:90 |
| 5 | Certain | Mock @/lib/tmux module for route tests | Confirmed from intake #5 — higher-level mocking, test validation not tmux | S:80 R:95 A:85 D:85 |
| 6 | Certain | Direct POST(new Request(...)) invocation for route tests | Confirmed from intake #6 — reviewed route.ts source, it's a standard async function | S:90 R:90 A:90 D:90 |
| 7 | Certain | Test files in __tests__/ folders per existing convention | Codebase pattern confirmed — vitest.config.ts uses `**/__tests__/**/*.test.{ts,tsx}` glob | S:95 R:95 A:95 D:95 |

7 assumptions (7 certain, 0 confident, 0 tentative, 0 unresolved).
