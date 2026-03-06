# Intake: Feature Tests for tmux, Keyboard Nav, and Sessions API

**Change**: 260305-vq7h-feature-tests-tmux-keyboard-api
**Created**: 2026-03-05
**Status**: Draft

## Origin

> During a codebase scan for test candidates (in the context of setting up Vitest in 260303-07iq-setup-vitest), six modules were identified as high-value test targets. The user chose three for this change: `tmux.ts`, `use-keyboard-nav.ts`, and `api/sessions/route.ts` POST handler. The remaining three (`validate.ts`, `config.ts`, `command-palette.tsx`) are covered in the parent Vitest setup change.

Interaction mode: conversational (arose from test candidate scan). Specific modules chosen by user from a prioritized list.

## Why

1. **tmux.ts has non-trivial parsing logic**: `listSessions()` filters byobu session-group copies by parsing tab-delimited tmux output and evaluating `session_grouped`/`session_group` fields. `listWindows()` computes activity status from Unix timestamps against a threshold. Both are transform-heavy functions where bugs would silently corrupt the dashboard's session list.

2. **use-keyboard-nav.ts is the core navigation hook**: The constitution mandates keyboard-first interaction. This hook implements j/k/Enter navigation, input-element skip logic, and focusedIndex clamping on item count changes. A regression here breaks the primary interaction model.

3. **api/sessions/route.ts POST is the most complex server endpoint**: 5-action dispatch (`createSession`, `createWindow`, `killSession`, `killWindow`, `sendKeys`), each with different validation rules. It's the only endpoint that mutates tmux state — validation bugs here could lead to malformed tmux commands.

If we don't do this: the three most logic-dense modules in the codebase remain untested, and regressions in tmux parsing, keyboard navigation, or API validation would go undetected.

## What Changes

### Test: `src/lib/tmux.test.ts`

Tests for `listSessions()` and `listWindows()` with `execFile` mocked via `vi.mock`.

**`listSessions` coverage:**
- Parses tab-delimited tmux output into session names
- Filters out session-group copies (`session_grouped === "1"` and name !== group)
- Keeps the original session when `session_grouped === "0"`
- Keeps the group-named session when `session_grouped === "1"` but `name === group`
- Returns `[]` when tmux is not running (execFile throws)

**`listWindows` coverage:**
- Parses window index, name, pane_current_path, and window_activity from tab-delimited output
- Computes `activity: "active"` when `now - activityTs <= ACTIVITY_THRESHOLD_SECONDS`
- Computes `activity: "idle"` when threshold exceeded
- Returns `[]` when session doesn't exist (execFile throws)

### Test: `src/hooks/use-keyboard-nav.test.ts`

Tests using `renderHook` from `@testing-library/react` and `fireEvent` for keyboard simulation.

**Coverage:**
- `j` key increments focusedIndex (clamped to `itemCount - 1`)
- `k` key decrements focusedIndex (clamped to 0)
- `Enter` calls `onSelect` with current `focusedIndex`
- Keys ignored when target is `<input>`, `<textarea>`, or `contentEditable`
- `focusedIndex` clamps down when `itemCount` decreases below current index
- Custom `shortcuts` map invoked on matching key press

### Test: `src/app/api/sessions/route.test.ts`

Tests for the POST handler with tmux functions mocked via `vi.mock`.

**Coverage per action:**
- `createSession`: valid name succeeds, empty name returns 400, forbidden chars return 400
- `createWindow`: valid params succeed, missing session/name/cwd returns 400
- `killSession`: valid session succeeds, invalid returns 400
- `killWindow`: valid session+index succeeds, non-integer index returns 400
- `sendKeys`: valid params succeed, empty keys returns 400
- Unknown action returns 400 with "Unknown action"
- Missing `action` field returns 400
- tmux error returns 500

## Affected Memory

- `run-kit/architecture`: (modify) Note test coverage for tmux, keyboard nav, and API modules

## Impact

- **New files**: `src/lib/tmux.test.ts`, `src/hooks/use-keyboard-nav.test.ts`, `src/app/api/sessions/route.test.ts`
- **Modified files**: None — purely additive test files
- **Dependencies**: Requires Vitest infrastructure from `260303-07iq-setup-vitest`
- **No source code changes** — tests exercise existing code as-is

## Open Questions

None — module selection and test approach resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | tmux.ts, use-keyboard-nav.ts, api/sessions/route.ts as test targets | Discussed — user explicitly chose items 3, 5, 6 from candidate scan | S:95 R:95 A:90 D:95 |
| 2 | Certain | Depends on 260303-07iq-setup-vitest for Vitest infrastructure | Discussed — this change adds test files only, no framework setup | S:95 R:90 A:95 D:95 |
| 3 | Certain | vi.mock for execFile in tmux.ts tests | Standard Vitest mocking for subprocess calls; no real tmux in test env | S:85 R:95 A:90 D:90 |
| 4 | Certain | renderHook + fireEvent for use-keyboard-nav tests | Standard @testing-library/react approach for hook testing | S:85 R:95 A:90 D:90 |
| 5 | Certain | Mock tmux functions (not execFile) for API route tests | Higher-level mocking — test validation logic, not tmux internals | S:80 R:95 A:85 D:85 |
| 6 | Confident | Test POST handler by importing and calling the function directly | Next.js route handlers are async functions accepting Request objects; direct invocation avoids needing a test server | S:70 R:90 A:80 D:75 |

6 assumptions (5 certain, 1 confident, 0 tentative, 0 unresolved).
