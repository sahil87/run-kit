# Plan: Relay-Side Device Attributes Responder

**Change**: 260801-f715-relay-device-attributes-responder
**Intake**: `intake.md`

## Requirements

### Terminal Relay (backend): DA1/DA2 interceptor in the PTY pump

#### R1: Relay answers DA1/DA2 queries at the ptmx
The per-stream PTY pump (`pumpPTY` in `app/backend/api/terminals_ws.go`) MUST intercept Device Attributes queries appearing in the bytes read from `st.ptmx` (i.e., coming FROM the tmux client) and immediately write the canned xterm.js-equivalent reply back to the ptmx (which tmux reads as client input). The recognized query set is exactly:

- DA1: `\x1b[c` and `\x1b[0c` → reply `\x1b[?1;2c`
- DA2: `\x1b[>c` and `\x1b[>0c` → reply `\x1b[>0;276;0c` (276 = xterm.js's hardcoded version)

Nothing else is intercepted (no DSR/XTVERSION/OSC handling). The interceptor is pure stream processing — no new subprocesses, no persisted state.

- **GIVEN** a relay stream attached to a tmux session
- **WHEN** tmux emits a DA1 query (`\x1b[c` or `\x1b[0c`) into the stream's PTY output
- **THEN** the relay writes `\x1b[?1;2c` back to the ptmx
- **AND** a DA2 query (`\x1b[>c` or `\x1b[>0c`) is answered with `\x1b[>0;276;0c`

#### R2: Intercepted queries are stripped from the browser-bound stream
Matched query byte sequences MUST be removed from the data forwarded to the browser — xterm.js never sees the queries, so it never answers them (replies become synchronous and exactly-once per attach). All non-query bytes MUST be forwarded unmodified and in their original order. A read chunk whose filtered output is empty SHALL NOT be enqueued as a data frame.

- **GIVEN** a PTY read chunk containing `payload-A + \x1b[c + payload-B`
- **WHEN** the chunk passes through the interceptor
- **THEN** the browser-bound frame contains exactly `payload-A + payload-B`
- **AND** a chunk consisting solely of query bytes produces no browser-bound frame

#### R3: Chunk-boundary straddling via a bounded carry-over
A query can straddle the `streamFrameSize` (4096-byte) read boundary. The interceptor MUST carry a trailing partial-match prefix across reads: hold back bytes that are a proper prefix of a recognized query, resume matching on the next read, and — if the held bytes turn out NOT to be a DA query — forward them to the browser unmodified and in order (before subsequent bytes). The carry-over is bounded (a held prefix is at most 4 bytes — `\x1b[>0` awaiting `c`) and MUST NOT grow unboundedly. Bytes still held at stream teardown are dropped (the pane is closing — moot).

- **GIVEN** chunk N ending `…\x1b[>` and chunk N+1 starting `0c`
- **WHEN** both chunks pass through the interceptor
- **THEN** the DA2 reply is written to the ptmx and neither chunk's output contains any query byte
- **AND** given chunk N ending `…\x1b[` and chunk N+1 starting `Zfoo` (a false prefix), the output stream contains `\x1b[Zfoo` in order with nothing dropped

#### R4: Named constants for query and reply byte sequences
The query patterns and reply strings MUST be named constants/package-level values (no magic strings inline in the scanning logic), per `fab/project/code-quality.md`.

- **GIVEN** the interceptor implementation
- **WHEN** reviewing the code
- **THEN** the four query forms and two replies are defined once as named package-level declarations referenced by the matcher

### Terminal Relay (frontend): wipe stale flush state on stream (re)open

#### R5: `stream.onOpened` clears carried-over adaptive-flush state
In `app/frontend/src/components/terminal-client.tsx`, the `stream.onOpened` handler (where `pendingReset = true` is armed) MUST also clear the adaptive-flush state carried over from the dead connection: set `binaryBuffers = []` and cancel/clear any pending `flushRafId`. The `pendingReset` deferred-reset handoff semantics MUST be preserved (the empty-flush guard in `flushToTerminal` already ensures an empty drain neither consumes nor executes `pendingReset`). No input-direction (browser→ptmx) filtering is added.

- **GIVEN** a stream with bytes buffered in `binaryBuffers` (flush rAF pending) from a connection that then drops at the socket level
- **WHEN** `onOpened` fires for the transparent re-open
- **THEN** the buffered bytes are discarded and never written to the terminal
- **AND** the re-opened connection's first chunk still consumes the freshly armed `pendingReset` before its write

### Tests

#### R6: Unit tests for both fix parts
Go table-driven unit tests (colocated in `app/backend/api/`) MUST cover the interceptor: plain passthrough, each of the four query variants matched and replaced (reply written to a test-doubled writer, query stripped from output), a query straddling the chunk boundary at every split point, a false-prefix (`\x1b[` followed by non-matching bytes) forwarded intact and in order, and interleaved queries + payload. A frontend unit test in the existing `terminal-client.test.tsx` mock harness MUST assert that buffered-but-unflushed bytes from connection A are NOT written after `onOpened` fires for connection B.

- **GIVEN** the test suites
- **WHEN** `just test-backend` and `just test-frontend` run
- **THEN** the new interceptor and buffer-wipe tests exist and pass

### Non-Goals

- Frontend-only filtering of DA replies out of `onData` — explicitly rejected in the intake (leaves tmux feature detection unanswered; couples to xterm.js reply strings verbatim).
- Broadening interception beyond the four DA query forms (no DSR/XTVERSION/OSC).
- Any `/ws/terminals` wire-format or API surface change.
- Playwright/e2e coverage — no UI chrome is touched.

### Design Decisions

#### DA filter as a self-contained scanner type
**Decision**: Implement the interceptor as a small self-contained filter type in the `api` package (`app/backend/api/terminals_da.go`): chunk-in/chunk-out `process([]byte) []byte` with carried held-prefix state, replies written to an injected `io.Writer` at match time. `pumpPTY` owns one filter instance per stream as a local.
**Why**: Unit-testable without a real PTY (inject a `bytes.Buffer`); keeps `pumpPTY` readable per code-quality anti-pattern rules; the local's lifetime naturally implements drop-held-on-teardown.
**Rejected**: Inlining the state machine into `pumpPTY` (pushes it past the god-function threshold and makes straddling untestable in isolation).
*Introduced by*: 260801-f715-relay-device-attributes-responder

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/backend/api/terminals_da.go`: named query/reply constants (DA1 `\x1b[c`/`\x1b[0c` → `\x1b[?1;2c`; DA2 `\x1b[>c`/`\x1b[>0c` → `\x1b[>0;276;0c`) and a `daFilter` type — `process(chunk []byte) []byte` scanning with a bounded held-prefix carry-over, replies written to an injected `io.Writer`, false prefixes flushed in order <!-- R1, R2, R3, R4 -->
- [x] T002 Wire the filter into `pumpPTY` in `app/backend/api/terminals_ws.go`: one filter per stream (reply writer = `st.ptmx`), run each read chunk through it, skip enqueueing when the filtered output is empty <!-- R1, R2 -->
- [x] T003 [P] In `app/frontend/src/components/terminal-client.tsx` `stream.onOpened`: clear `binaryBuffers`, cancel/clear `flushRafId`, preserving the `pendingReset` arm and handoff semantics <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add `app/backend/api/terminals_da_test.go`: table-driven tests — passthrough, all four query variants (reply + strip), straddle at every split point of every query, false prefixes (incl. bare trailing `\x1b` and `\x1b[` + non-match) forwarded intact, interleaved queries + payload, multi-query chunks <!-- R6, R1, R2, R3 -->
- [x] T005 [P] Add a test to `app/frontend/src/components/terminal-client.test.tsx` (deferred-reset describe block): buffered-but-unflushed bytes from connection A are not written after `onOpened` fires for connection B; the next connection's first chunk still resets-then-writes <!-- R6, R5 -->
- [x] T006 Run `just test-backend` and `just test-frontend`; fix any failures <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The relay writes `\x1b[?1;2c` to the ptmx for each DA1 query and `\x1b[>0;276;0c` for each DA2 query read from the PTY, and only the four specified query forms are intercepted
- [x] A-002 R2: Matched query bytes never reach the browser-bound stream; all other bytes are forwarded unmodified and in order; empty filtered chunks produce no data frame
- [x] A-003 R3: A query split across two reads at any split point is still matched exactly once; the held prefix never exceeds 4 bytes
- [x] A-004 R4: Query and reply sequences are named package-level declarations, not inline magic strings
- [x] A-005 R5: `stream.onOpened` clears `binaryBuffers` and cancels `flushRafId` alongside arming `pendingReset`

### Behavioral Correctness

- [x] A-006 R2: xterm.js never receives a DA query, so no browser-originated DA reply can be typed into the pane on a new connection
- [x] A-007 R5: The deferred-reset handoff is unchanged — an empty flush neither consumes nor executes `pendingReset`, and the re-opened connection's first chunk resets before its write

### Scenario Coverage

- [x] A-008 R6: Go table-driven tests in `app/backend/api/terminals_da_test.go` cover passthrough, all four variants, every straddle split point, false prefixes, and interleaved payload — and pass via `just test-backend`
- [x] A-009 R6: `terminal-client.test.tsx` gains a test proving connection A's unflushed buffers are not written after connection B's `onOpened` — and passes via `just test-frontend`

### Edge Cases & Error Handling

- [x] A-010 R3: A false-prefix held at a chunk boundary is forwarded unmodified and in order once the match fails; bytes held at stream teardown are dropped without error

### Code Quality

- [x] A-011 Pattern consistency: New code follows naming and structural patterns of surrounding code (`terminals_*` file grouping, doc-comment style, test conventions)
- [x] A-012 No unnecessary duplication: Existing utilities reused where applicable; no reimplementation of stream plumbing
- [x] A-013 No magic strings: query/reply byte sequences are named constants (code-quality anti-pattern rule)
- [x] A-014 No shell strings / subprocess additions: the interceptor is pure stream processing — no new `exec` calls (constitution §I untouched)
- [x] A-015 Tests included for changed behavior (code-quality principle: new features and bug fixes MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Verified: the filter is additive stream processing wired into `pumpPTY`; no prior DA-handling code existed to retire, and the pre-existing `ansiEscapeRe` in `app/backend/api/chat.go:480` serves an unrelated purpose — whole-string sanitization of captured pane text for chat — so it is neither superseded nor a reuse target for an incremental chunk-boundary filter.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Filter lives in new files `app/backend/api/terminals_da.go` + `terminals_da_test.go` | Intake specifies "small filter type in the same package"; separate files keep `terminals_ws.go` readable and follow the package's one-file-per-concern layout | S:70 R:90 A:85 D:75 |
| 2 | Confident | Filter API: `newDAFilter(reply io.Writer)` + `process(chunk []byte) []byte`; replies written at match time; `pumpPTY` holds the filter as a local so teardown drops held bytes implicitly | Matches intake assumption 7 (self-contained scanner, unit-testable without a PTY); the local's lifetime realizes intake assumption 9's teardown-drop | S:70 R:85 A:85 D:75 |
| 3 | Certain | An all-query read chunk (empty filtered output) enqueues no data frame | A zero-payload data frame carries no information; skipping it avoids pointless writer work and cannot affect ordering | S:80 R:90 A:95 D:90 |
| 4 | Confident | `onOpened` neutralization scope: clear `binaryBuffers` + cancel/null `flushRafId`; the immediate-write frame guard (`wroteImmediatelyThisFrame`/`frameResetRafId`) is left untouched | The guard is per-frame pacing state, not connection data — it self-resets on the next rAF tick and holds no stale bytes; intake assumption 10 says "as appropriate" per the file's documented semantics | S:65 R:85 A:80 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
