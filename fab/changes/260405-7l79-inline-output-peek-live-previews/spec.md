# Spec: Inline Output Peek and Live Activity Previews

**Change**: 260405-7l79-inline-output-peek-live-previews
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`

<!--
  Two related sidebar enhancements sharing a single pane-capture backend:
  1. Live last-line preview (always visible, from SSE)
  2. Inline peek with 2-3 lines (toggled, on-demand fetch)
-->

## Non-Goals

- Persisting the expanded/collapsed toggle state in `localStorage` — state is session-transient (in-memory React state only), resets on page reload.
- Rendering ANSI color/styling in the sidebar preview — all escape sequences are stripped; monochrome plain text only.
- A polling-only delivery mode (`setInterval` + `fetch` tick) for the last-line preview — violates `code-quality.md` ("Polling from the client — use the SSE stream, not `setInterval` + fetch").
- A second dedicated SSE stream (`/api/sessions/stream/pane-content?windows=...`) — hybrid SSE + on-demand capture covers both features with one streaming connection and one REST endpoint.
- Structured output parsing (detecting prompts, errors, fab stages from content) — out of scope; we deliver raw last-line text only, callers do not interpret it.
- Support for pane splits in the peek view — captures target the active pane of the window; split-pane per-pane previews are not exposed.

---

## Frontend — Sidebar UI

### Requirement: Always-visible last-line preview

The sidebar `WindowRow` component (`app/frontend/src/components/sidebar/window-row.tsx`) SHALL render a single-line preview of the most recent non-empty terminal output beneath the window name row, styled `text-xs text-text-secondary` and truncated with CSS (`truncate min-w-0`) to fit the sidebar width. The preview text SHALL be taken from the `lastLine` field on `WindowInfo` (populated by SSE — see API Client requirements). Empty/whitespace-only captures SHALL render nothing (the row collapses to its current height — no placeholder reserved space, no dash, no empty block).

#### Scenario: Active window emits new output
- **GIVEN** a window whose last non-empty output line is `npm run build` and the sidebar is rendered
- **WHEN** the SSE tick delivers an updated `sessions` event with `lastLine: "npm run build"` for that window
- **THEN** the sidebar row for that window displays `npm run build` below the window name row in `text-xs text-text-secondary`
- **AND** when the content overflows the sidebar width, the overflow is clipped via CSS truncation with ellipsis

#### Scenario: Window pane has no output yet
- **GIVEN** a freshly created window with an empty pane (no output captured)
- **WHEN** the sidebar renders for that window
- **THEN** no last-line element is emitted in the DOM (the row keeps its existing single-line layout)

#### Scenario: Pane content contains only whitespace
- **GIVEN** a window whose capture returns only blank lines and whitespace
- **WHEN** the SSE event arrives with `lastLine: ""`
- **THEN** no preview element is rendered for that window

### Requirement: Peek expand/collapse toggle

`WindowRow` SHALL render a toggle button on the right of the row, adjacent to (before, in visual order) the existing kill/color hover-reveal buttons inside the `absolute right-2` cluster. The toggle SHALL display a right-pointing chevron (`\u25B8`) when collapsed and a down-pointing chevron (`\u25BE`) when expanded. The toggle SHALL be keyboard-focusable, have an `aria-label` of `Expand output peek for {window.name}` (or `Collapse output peek for {window.name}` when expanded), and `aria-expanded` set to the current state. Clicking the toggle SHALL NOT trigger window selection (the click MUST call `stopPropagation`).

The toggle SHALL be visible in the same hover-reveal pattern as the existing color/kill buttons (`opacity-0 group-hover:opacity-100 coarse:opacity-100`) — always visible on touch devices, revealed on hover on pointer devices.

#### Scenario: User toggles peek open
- **GIVEN** a collapsed window row with visible toggle `\u25B8`
- **WHEN** the user clicks the toggle
- **THEN** the toggle flips to `\u25BE`
- **AND** `aria-expanded` becomes `"true"`
- **AND** the window is NOT selected as a side-effect
- **AND** the peek content block renders below the row

#### Scenario: User toggles peek closed
- **GIVEN** an expanded window row with toggle `\u25BE` and peek block visible
- **WHEN** the user clicks the toggle
- **THEN** the toggle flips to `\u25B8`
- **AND** `aria-expanded` becomes `"false"`
- **AND** the peek content block is removed from the DOM

### Requirement: Expanded peek block

When a window is expanded, `WindowRow` SHALL render a block below the window row that displays the last 2-3 non-empty lines of pane output. The block SHALL use monospace styling (`font-mono`), `text-xs`, `text-text-secondary`, a distinct background (`bg-bg-card` or equivalent theme token) to visually separate it from navigation rows, and internal padding (`px-2 py-1`). Each line SHALL be truncated via CSS to the sidebar width (no hard character cap at render time; truncation SHALL be by CSS ellipsis, allowing the text to expand naturally on wider sidebars).

Peek content SHALL be fetched on-demand via the capture endpoint (see API Client requirements) when the toggle transitions from collapsed to expanded. While the fetch is in flight, the block SHALL display a muted placeholder (`Loading\u2026` in `text-text-secondary`). On fetch error, the block SHALL display an inline error (`Unable to load output` in `text-text-secondary`) rather than a toast — the error is scoped to the expanded panel.

The peek block SHALL re-fetch whenever the window's `lastLine` value on a new SSE event differs from the previous rendered value AND the toggle is currently expanded (so the content stays fresh without polling). A transition from a non-empty `lastLine` to an empty/undefined `lastLine` SHALL NOT trigger a re-fetch (the previously rendered peek content remains visible until a new non-empty `lastLine` arrives). The re-fetch SHALL debounce to at most one in-flight request per window at a time; if an event arrives while a request is in flight, the new content SHALL be re-fetched after the in-flight request settles.
<!-- clarified: Disambiguated re-fetch trigger — only fires on lastLine value changes (not identity), and empty/undefined lastLine transitions do not trigger fetches (preserves last-known peek content on transient capture failures). Resolved from context: SSE dedup already guards against identity-triggered re-fetches, and empty lastLine from capture failure per backend spec should not clear peek content. -->

#### Scenario: User expands a window for the first time
- **GIVEN** a collapsed window row
- **WHEN** the user clicks the expand toggle
- **THEN** the peek block appears below the row with `Loading\u2026` placeholder
- **AND** a single `GET /api/sessions/{session}/windows/{index}/capture?lines=3` request is issued
- **WHEN** the response returns `content: "line1\nline2\nline3"`
- **THEN** the placeholder is replaced with three lines rendered in `font-mono text-xs text-text-secondary` on a `bg-bg-card` block

#### Scenario: SSE last-line updates while peek is open
- **GIVEN** an expanded window whose peek currently shows 3 lines
- **WHEN** an SSE event arrives with an updated `lastLine` value for that window
- **THEN** a fresh capture fetch is issued (no more than one in flight at a time)
- **AND** the peek block updates in place with the new 3 lines when the fetch resolves

#### Scenario: Capture fetch fails
- **GIVEN** an expanded window and the capture endpoint returns 500
- **WHEN** the fetch promise rejects
- **THEN** the peek block renders `Unable to load output` in `text-text-secondary`
- **AND** no global toast is triggered

### Requirement: Multiple simultaneous expansions

Multiple windows MAY be expanded simultaneously. Each window's expanded state SHALL be tracked independently in a `Set<string>` or `Record<string, boolean>` keyed by a stable identifier (e.g., `${session}:${windowId}`). Switching between sessions SHALL NOT clear the expanded state (the state is per-page-session, not per-tmux-session).

Expanded state SHALL NOT be persisted to `localStorage`, `sessionStorage`, URL, or any backend store. Refreshing the page SHALL reset all windows to collapsed.

#### Scenario: User expands three windows across two sessions
- **GIVEN** sessions `s1` and `s2`, each with windows; user expands `s1:w0`, `s2:w1`, and `s2:w2`
- **WHEN** the sidebar re-renders due to an SSE event
- **THEN** all three windows remain expanded
- **AND** each window's peek block reflects its own captured content

#### Scenario: Page reload clears expanded state
- **GIVEN** a user has three windows expanded
- **WHEN** the user reloads the page
- **THEN** all windows render collapsed (empty `Set`)

---

## Frontend — API Client

### Requirement: SSE payload extension — `lastLine` field

The frontend `WindowInfo` TypeScript type SHALL gain an optional `lastLine?: string` field sourced from the backend SSE payload. Type narrowing SHALL be used when consuming the field (`if (win.lastLine) { ... }`) — no `as` casts. Missing/empty values SHALL be treated uniformly as "no preview."

#### Scenario: SSE event includes lastLine
- **GIVEN** an SSE `sessions` event whose JSON contains `{ "windows": [{ ..., "lastLine": "npm build" }] }`
- **WHEN** the frontend deserializes the event
- **THEN** `win.lastLine === "npm build"`

#### Scenario: SSE event omits lastLine for a window
- **GIVEN** an SSE event without `lastLine` on a window
- **WHEN** the frontend deserializes the event
- **THEN** `win.lastLine` is `undefined`
- **AND** the last-line preview element is not rendered for that window

### Requirement: `capturePane` client function

`src/api/client.ts` SHALL export:

```ts
export async function capturePane(
  session: string,
  index: number,
  lines: number,
): Promise<{ content: string; lines: string[] }>;
```

The function SHALL call `GET /api/sessions/{session}/windows/{index}/capture?lines={N}` (URL-encoded `session`) with the standard `withServer` query string. On non-2xx responses the function SHALL throw via the existing `throwOnError` helper. The function SHALL NOT participate in `deduplicatedFetch` (each call is distinct intent — do not dedupe captures; the WindowRow component is responsible for its own in-flight coordination).

#### Scenario: Successful capture request
- **GIVEN** `capturePane("s1", 2, 3)` is called
- **WHEN** the backend returns 200 with `{"content":"a\nb\nc","lines":["a","b","c"]}`
- **THEN** the function resolves with that object

#### Scenario: Backend returns 500
- **GIVEN** the backend returns 500 with `{"error":"capture failed: timeout"}`
- **WHEN** `capturePane` is awaited
- **THEN** the promise rejects with `Error("capture failed: timeout")`

---

## Backend — tmux capture wrapper

### Requirement: Extend existing `CapturePane` to accept session+window addressing

`internal/tmux/tmux.go` already exports `CapturePane(paneID string, lines int, server string) (string, error)` (uses `-S {start}` with a package-level `TmuxTimeout = 10s`). That function SHALL remain unchanged for backward compatibility with existing callers.

A new function SHALL be added:

```go
func CapturePaneByWindow(ctx context.Context, session string, windowIndex int, lines int, server string) (string, error)
```

It SHALL:
- Use `exec.CommandContext` with the provided context (callers MUST pass a context with a bounded timeout; see "Performance and resource" section for the 3-second recommendation).
- Build the target as `fmt.Sprintf("%s:%d", session, windowIndex)` (tmux resolves to the active pane of that window).
- Invoke `tmux [server-args] capture-pane -t {target} -p -S {-lines}` (the existing `-S -N` convention captures the last N lines; `-p` prints to stdout).
- Return raw stdout (ANSI stripping happens in a separate helper — see next requirement).
- Validate `session` via `internal/validate.ValidateName` and `lines` within `[1, 100]` before invoking tmux; return an error on validation failure without executing the subprocess.

The function SHALL be added to the `api.TmuxOps` interface in `app/backend/api/router.go` and implemented on `prodTmuxOps`, with a corresponding mock method added to `mockTmuxOps` in `sessions_test.go`.

#### Scenario: Valid session and window
- **GIVEN** a running session `s1` with window index `0` whose active pane contains output
- **WHEN** `CapturePaneByWindow(ctx, "s1", 0, 3, "default")` is invoked
- **THEN** tmux is called with `capture-pane -t s1:0 -p -S -3`
- **AND** the function returns the raw captured string

#### Scenario: Invalid session name
- **GIVEN** `session = "s1; rm -rf /"`
- **WHEN** `CapturePaneByWindow` is invoked
- **THEN** the function returns an error without calling tmux
- **AND** the error message identifies the validation failure

#### Scenario: Out-of-range lines parameter
- **GIVEN** `lines = 0` or `lines = 500`
- **WHEN** `CapturePaneByWindow` is invoked
- **THEN** the function returns an error without calling tmux

#### Scenario: Context timeout while tmux hangs
- **GIVEN** a context with a 100ms timeout and a simulated slow `tmux` binary
- **WHEN** `CapturePaneByWindow` is invoked
- **THEN** the function returns the context's deadline-exceeded error within ~100ms
- **AND** no zombie tmux process is left running (child exits via `exec.CommandContext` cancellation)

### Requirement: ANSI stripping helper

A helper `stripANSI(s string) string` SHALL be added to `internal/tmux/` (or a new `internal/tmux/ansi.go`) that removes all ANSI CSI (`\x1b\[[0-9;?]*[a-zA-Z]`), OSC (`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`), and other `\x1b[\x40-\x5f].` escape sequences from the input. The helper SHALL also strip non-printable control characters except `\n` and `\t`.

The helper SHALL be applied to capture output before it is consumed by callers (SSE enrichment and the HTTP capture handler). Color semantics are intentionally discarded — callers render plain monochrome text only.

The helper SHALL be compiled once (package-level `var ansiRegex = regexp.MustCompile(...)`); not per-call.

#### Scenario: Strip standard colored prompt
- **GIVEN** input `"\x1b[32m$ \x1b[0mgo build\n"`
- **WHEN** `stripANSI` is called
- **THEN** the result is `"$ go build\n"`

#### Scenario: Strip OSC sequences (title setters)
- **GIVEN** input `"\x1b]0;title\x07hello"`
- **WHEN** `stripANSI` is called
- **THEN** the result is `"hello"`

#### Scenario: Preserve newlines and tabs
- **GIVEN** input `"a\n\tb"`
- **WHEN** `stripANSI` is called
- **THEN** the result is `"a\n\tb"`

### Requirement: `LastLine` helper

A helper `LastLine(s string) string` SHALL extract the last non-empty, non-whitespace-only line from the stripped capture output. Empty input or input containing only whitespace SHALL return `""`. Trailing whitespace on the chosen line SHALL be trimmed.

#### Scenario: Typical output
- **GIVEN** input `"$ go build\nhello\n\n"`
- **WHEN** `LastLine` is called
- **THEN** the result is `"hello"`

#### Scenario: All blank lines
- **GIVEN** input `"\n\n   \n"`
- **WHEN** `LastLine` is called
- **THEN** the result is `""`

---

## Backend — SSE enrichment

### Requirement: Per-window `LastLine` field on `tmux.WindowInfo`

`tmux.WindowInfo` (in `internal/tmux/tmux.go`) SHALL gain a new field:

```go
LastLine string `json:"lastLine,omitempty"`
```

The field SHALL serialize as `lastLine` in the SSE JSON payload and be omitted when empty (`omitempty`). No change is required to `parseWindows` — the field is populated only during enrichment in `internal/sessions`.

### Requirement: Piggyback capture during enrichment

`internal/sessions.FetchSessions` SHALL, after `fetchPaneMapCached` returns successfully, capture the last 3 lines from each window's active pane in parallel, strip ANSI, take the last non-empty line via `LastLine`, and assign it to `sd.windows[j].LastLine`. Specifically:

- Capture MUST occur in parallel across windows using a bounded goroutine pool (size `min(len(windows), 16)`) to limit subprocess concurrency.
- Each per-window capture MUST use a dedicated `context.WithTimeout` of **3 seconds** derived from the `FetchSessions` ctx (not the full `TmuxTimeout = 10s`).
- Capture failures (timeout, tmux error, missing pane) MUST be logged at `slog.Debug` and result in an empty `LastLine` for that window — failures MUST NOT propagate and MUST NOT abort the broader `FetchSessions` result (graceful degradation, same posture as `fetchPaneMapCached`).
- Capture results SHALL piggyback on the existing `sessions` SSE event (same JSON envelope, same dedup via `previousJSON`, same 500ms result cache, same 2.5s poll cadence). No new event type.

The capture SHALL call `CapturePaneByWindow(ctx, session, windowIndex, 3, server)` — reuse 3 (not 1) so `LastLine` has surrounding context if the most recent line is blank. Only the last non-empty line is emitted over SSE; the 2-3 lines for the peek block come from the on-demand endpoint (see next section).

#### Scenario: Typical enrichment tick
- **GIVEN** three sessions with a total of eight windows
- **WHEN** `FetchSessions` runs
- **THEN** `fetchPaneMapCached` returns the pane map
- **AND** up to eight parallel `CapturePaneByWindow` calls execute with 3-second timeouts
- **AND** each window's `LastLine` is populated in the returned `ProjectSession.Windows` slice
- **AND** the result is cached in the SSE hub for 500ms and deduped against `previousJSON`

#### Scenario: One window's capture times out
- **GIVEN** window `s1:2` has a hung tmux pane
- **WHEN** `FetchSessions` runs with 3-second per-capture timeouts
- **THEN** `s1:2`'s `LastLine` is `""`
- **AND** other windows' `LastLine` values are populated normally
- **AND** a debug log is emitted identifying the timeout

#### Scenario: Capture text identical to previous tick
- **GIVEN** no windows changed output since the last tick
- **WHEN** `FetchSessions` result is JSON-marshalled
- **THEN** the JSON matches `previousJSON[server]`
- **AND** no SSE `sessions` event is broadcast for this tick (existing dedup behavior)

---

## Backend — On-demand capture endpoint

### Requirement: `GET /api/sessions/{session}/windows/{index}/capture`

A new handler `handleWindowCapture` SHALL be registered in `api/router.go` at:

```
r.Get("/api/sessions/{session}/windows/{index}/capture", s.handleWindowCapture)
```

The handler SHALL:

1. Validate `session` via `validate.ValidateName`; on failure return 400 with `{"error":"..."}`.
2. Parse `{index}` via `parseWindowIndex`; on failure return 400 `{"error":"Invalid window index"}`.
3. Parse `lines` from the query string; default to `3`; clamp to `[1, 100]`; reject non-integer input with 400.
4. Derive `server` via `serverFromRequest(r)`.
5. Call `s.tmux.CapturePaneByWindow(ctx, session, index, lines, server)` with a `context.WithTimeout(r.Context(), 3*time.Second)`.
6. On success: apply `tmux.StripANSI`, split on `\n`, drop trailing empty line(s), return:

   ```json
   { "content": "<full stripped text>", "lines": ["line1", "line2", "line3"] }
   ```

7. On tmux error: return 500 `{"error":"..."}`.
8. On context deadline: return 504 `{"error":"capture timeout"}`.
9. The handler SHALL NOT modify any tmux state; it is read-only.

#### Scenario: Default lines parameter
- **GIVEN** a valid request `GET /api/sessions/s1/windows/0/capture`
- **WHEN** the handler runs
- **THEN** `lines = 3` is used
- **AND** the response `lines` array has at most 3 entries

#### Scenario: Explicit lines parameter
- **GIVEN** `GET /api/sessions/s1/windows/0/capture?lines=5`
- **WHEN** the handler runs
- **THEN** `lines = 5` is used

#### Scenario: Invalid lines (too high)
- **GIVEN** `GET /api/sessions/s1/windows/0/capture?lines=1000`
- **WHEN** the handler runs
- **THEN** `lines` is clamped to `100`
- **AND** the response returns 200

#### Scenario: Non-integer lines
- **GIVEN** `GET /api/sessions/s1/windows/0/capture?lines=abc`
- **WHEN** the handler runs
- **THEN** the response is 400 `{"error":"Invalid lines parameter"}`

#### Scenario: Invalid session name
- **GIVEN** `GET /api/sessions/s1%3Brm%20-rf%20%2F/windows/0/capture`
- **WHEN** the handler runs
- **THEN** the response is 400 with a validation error message
- **AND** no tmux subprocess is executed

#### Scenario: Shell-injection attempt in session
- **GIVEN** session name `s$(rm -rf /)` after URL decoding
- **WHEN** the handler runs
- **THEN** `validate.ValidateName` rejects it with 400
- **AND** no subprocess is spawned

#### Scenario: Backend timeout
- **GIVEN** a hung tmux pane
- **WHEN** the handler's 3-second context expires
- **THEN** the response is 504 `{"error":"capture timeout"}`

---

## Performance and resource constraints

### Requirement: Bounded per-tick capture work

The added per-SSE-tick capture work MUST be bounded:

- At most `min(len(windows), 16)` concurrent `tmux capture-pane` subprocesses per enrichment cycle.
- Per-capture timeout MUST be 3 seconds.
- Capture lines MUST be 3 (for SSE enrichment); the on-demand endpoint MAY request up to 100 but defaults to 3.
- Capture subprocesses MUST use `exec.CommandContext` (per Constitution I: Security First) — never `exec.Command` without context, never shell strings.

The total per-tick added latency SHOULD be <= 100ms typical and MUST NOT exceed the existing 2.5s SSE poll interval (`ssePollInterval`). If capture exceeds the interval, the existing poll loop's `time.Sleep(ssePollInterval)` provides backpressure naturally.

#### Scenario: Tick completes within poll interval
- **GIVEN** 10 sessions with 50 total windows and typical capture latency of 10-30ms each
- **WHEN** an SSE tick runs enrichment
- **THEN** total enrichment time is <= 500ms (well under the 2.5s poll interval)

#### Scenario: Subprocess cap prevents storm
- **GIVEN** 100 windows active
- **WHEN** an enrichment tick begins
- **THEN** no more than 16 `tmux capture-pane` subprocesses are concurrent
- **AND** the remaining captures queue against the semaphore

### Requirement: No client-side polling

The frontend MUST NOT implement `setInterval`-based polling to refresh either the last-line preview or the expanded peek. The last-line preview is SSE-driven; the expanded peek re-fetches only in response to SSE events that signal the window's `lastLine` changed (event-driven, not time-driven). This preserves the `code-quality.md` anti-pattern prohibition.

#### Scenario: Idle sidebar issues no capture requests
- **GIVEN** no SSE events are being delivered (idle server)
- **WHEN** the sidebar remains open with one window expanded
- **THEN** no periodic `GET /capture` requests are issued
- **AND** the Network panel shows no capture traffic after the initial expand fetch

---

## Design Decisions

1. **Hybrid SSE + on-demand delivery**
   - *Decision*: SSE enrichment carries a single `lastLine` string per window (always visible, low payload overhead); the expanded 2-3 line peek fetches on-demand via `GET /api/sessions/{s}/windows/{i}/capture`.
   - *Why*: Minimizes steady-state SSE payload (one short string per window vs. 3 lines per window per tick), while still giving both features a fresh data source. The on-demand fetch runs only when the user explicitly expands a window, which is the rare case.
   - *Rejected*: **Option A (extend SSE with full 3-line peek content)** — pays 3x payload cost on every tick for data that is rarely visible, even with `previousJSON` dedup the per-tick marshal cost grows. **Option B (dedicated SSE stream for pane content)** — doubles the SSE connection count and duplicates the dedup/hub machinery for a marginal gain. **Option C (pure polling)** — violates the `code-quality.md` polling anti-pattern for steady-state refresh.

2. **Piggyback on pane-map enrichment cycle (5s pane-map TTL / 2.5s SSE tick)**
   - *Decision*: Run capture in parallel with `fetchPaneMapCached` inside `FetchSessions`; each capture gets its own 3-second timeout, bounded by a goroutine pool of 16.
   - *Why*: Zero new tickers; reuses the existing cache, dedup, and error-tolerance pattern; one subprocess per window per tick is well within tmux's normal workload. The pane-map is already cached 5s — our capture runs as often as SSE polls (2.5s) but against the active pane via `tmux capture-pane -t {session}:{index}`, which is fast and does not benefit from longer TTLs.
   - *Rejected*: **Separate capture ticker** (e.g., 10s dedicated loop) — complicates ownership, duplicates cache/dedup logic, and adds cross-ticker coordination. **Lazy per-client capture** (fetch only when UI requests) — removes the always-visible live preview feature entirely.

3. **Strip all ANSI escape sequences (no color rendering in sidebar)**
   - *Decision*: Apply `stripANSI` to all captured output before it reaches the frontend (both SSE path and HTTP endpoint).
   - *Why*: Raw terminal output contains cursor positioning, color codes, OSC title sequences, and bracketed paste markers; rendering any subset in HTML/CSS is a substantial project (xterm.js does this in the terminal view, but adopting it in the sidebar would balloon scope). Stripping produces human-readable plain text that fits the sidebar's information-dense aesthetic.
   - *Rejected*: **Pass raw ANSI to frontend and render with xterm.js** — heavyweight for a two-line preview; defeats sidebar compactness. **Pass raw ANSI and let CSS handle it** — CSS does not interpret ANSI; would produce garbled display.

4. **Reuse existing `CapturePane(paneID, ...)`, add new `CapturePaneByWindow` variant rather than change signature**
   - *Decision*: Keep the existing `CapturePane(paneID string, lines int, server string)` function unchanged for backward compatibility and introduce a new `CapturePaneByWindow(ctx, session, windowIndex, lines, server)` variant for the new callers.
   - *Why*: The existing function is used by archived/pending paths that target a specific paneID (reference: `260302-fl88-web-agent-dashboard` intake). Changing the signature would touch unrelated callers; adding a variant is additive and lower-risk. The new variant takes `ctx` up front (the existing one uses `TmuxTimeout = 10s` hardcoded via `withTimeout()`), enabling the caller-controlled 3-second timeout required here.
   - *Rejected*: **Refactor existing `CapturePane` to accept a context and change all callers** — scope creep; unrelated to this change's goals. **Reuse existing `CapturePane` by first resolving pane ID** — requires an extra tmux call per capture (list-panes), doubling subprocess count per tick.

---

## Assumptions

<!-- SCORING SOURCE: this table is what `fab score` reads.
     All 10 intake Assumptions are re-affirmed here (Certain from intake), plus
     any new assumptions surfaced during spec generation. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `tmux capture-pane` is the mechanism for reading pane content | Confirmed from intake #1. Constitution III (Wrap, Don't Reinvent). The existing `CapturePane` function already wraps this at `internal/tmux/tmux.go:779`. | S:95 R:95 A:95 D:95 |
| 2 | Certain | No database or persistent cache for pane content | Confirmed from intake #2. Constitution II (No Database). Content derived from tmux at request time; only the 500ms SSE result cache and 5s pane-map TTL apply. | S:95 R:95 A:95 D:95 |
| 3 | Certain | Go backend uses `exec.CommandContext` with timeout for capture | Confirmed from intake #3. Constitution I (Security First). All subprocess calls MUST use `exec.CommandContext`; this spec mandates a 3-second timeout per capture. | S:95 R:95 A:95 D:95 |
| 4 | Certain | Toggle-based expand (not hover) for the inline peek | Confirmed from intake #4. User confirmed toggle over hover during clarification; chevron `\u25B8`/`\u25BE` on the right of the row. | S:95 R:85 A:80 D:80 |
| 5 | Certain | Hybrid SSE + on-demand delivery (NOT extend-SSE-only) | Upgraded from intake #5. Intake initially recommended extending SSE for both features; user confirmed hybrid (SSE for last-line, on-demand for peek) during clarification. Spec #5 here supersedes intake #5 wording. | S:95 R:70 A:75 D:80 |
| 6 | Certain | Last-line preview is 1 line; expanded peek is 2-3 lines | Confirmed from intake #6. User confirmed. SSE carries 1 line (derived from `LastLine(stripANSI(capture(3)))` server-side); peek endpoint returns up to N lines (default 3, capped at 100). | S:95 R:90 A:80 D:85 |
| 7 | Certain | Capture limited to 3 lines with 3-second per-capture timeout | Confirmed from intake #7. User confirmed. Spec fixes 3 lines for SSE enrichment; on-demand endpoint defaults 3, clamps at 100. Timeout is 3s (within the 2-3s range the user confirmed). | S:95 R:85 A:85 D:85 |
| 8 | Certain | Strip ANSI escape sequences from captured content before display | Confirmed from intake #8. User confirmed strip-all. Color semantics are an accepted loss; avoids rendering complexity and garbled preview. | S:95 R:75 A:70 D:70 |
| 9 | Certain | Hybrid delivery: SSE carries last-line, on-demand fetch for expanded peek | Confirmed from intake #9. See Design Decision 1. Endpoint: `GET /api/sessions/{session}/windows/{index}/capture`. | S:95 R:70 A:75 D:75 |
| 10 | Certain | Pane content captured in parallel with existing pane-map enrichment cycle | Confirmed from intake #10. See Design Decision 2. Piggybacks on SSE's 2.5s poll; per-window parallel captures bounded by a 16-goroutine pool, each with 3s timeout. | S:95 R:65 A:75 D:80 |
| 11 | Certain | New `CapturePaneByWindow(ctx, session, windowIndex, lines, server)` function (not signature change to existing `CapturePane`) | Surfaced during spec generation — actual code read shows `CapturePane(paneID, lines, server)` already exists at `internal/tmux/tmux.go:779` with a `paneID` signature. Spec chooses additive variant for backward compatibility (see Design Decision 4). | S:95 R:80 A:95 D:90 |
| 12 | Certain | `lastLine` field on `tmux.WindowInfo` (not a new SSE event type) | Surfaced during spec generation. Piggybacks on the existing `sessions` SSE event envelope; `previousJSON` dedup handles change detection without new infrastructure. Matches existing patterns for `FabChange`, `FabStage`, `AgentState`. | S:95 R:85 A:95 D:90 |
| 13 | Certain | `TmuxOps` interface and mocks must be updated to include `CapturePaneByWindow` | Surfaced during spec generation — `api/router.go` defines a `TmuxOps` interface that the handler uses for dependency injection; `sessions_test.go` defines a `mockTmuxOps` that must gain the new method or tests won't compile. | S:95 R:85 A:95 D:95 |
| 14 | Certain | Peek block re-fetches when SSE last-line value changes (event-driven, not timed; empty transitions suppressed) | Surfaced during spec generation to satisfy the "no client polling" constraint while still keeping the peek block fresh. `useEffect` on `win.lastLine` (when expanded) triggers a new fetch; single-flight guard prevents overlap. Empty/undefined `lastLine` transitions do not re-fetch (preserves last-known peek on transient capture failures). | S:95 R:80 A:85 D:75 |
| 15 | Certain | Peek state is in-memory React state (Set keyed by `${session}:${windowId}`) | Surfaced during spec generation. No `localStorage` per Non-Goals; stable `windowId` (not index) keys prevent mis-attribution on window reorder/rename; session-scoped key prevents collisions across sessions. | S:90 R:90 A:90 D:85 |

15 assumptions (15 certain, 0 confident, 0 tentative, 0 unresolved).
