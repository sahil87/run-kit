# Intake: Relay-Side Device Attributes Responder

**Change**: 260801-f715-relay-device-attributes-responder
**Created**: 2026-08-01

## Origin

Promptless dispatch (create-intake procedure, `{questioning-mode} = promptless-defer`) from a synthesized diagnosis discussion. Raw input:

> Junk characters like `1;2c0;276;0c1;2c0;276;0c…` keep appearing at shell prompts inside tmux panes viewed through run-kit. These are xterm.js Device Attributes replies minus their escape prefixes: `ESC[?1;2c` (DA1 reply) and `ESC[>0;276;0c` (DA2 reply; 276 is xterm.js's hardcoded version). Agreed fix: (1) backend — intercept DA1/DA2 queries from the tmux client in the PTY read loop, answer them with canned xterm.js-equivalent replies written back to the ptmx, and strip them from the browser-bound stream; (2) frontend — clear stale `binaryBuffers` (and pending flush state) where `stream.onOpened` arms `pendingReset`.

The root-cause chain below was verified against this repo during the discussion; the fix shape (relay-side responder + frontend buffer clear) and the rejected alternative (frontend-only reply filtering) were decided there.

## Why

**Problem**: Shell prompts in rk-viewed tmux panes intermittently accumulate junk like `1;2c0;276;0c1;2c0;276;0c…`. These are xterm.js Device Attributes (DA) replies with the escape prefix swallowed by zsh: `ESC[?1;2c` (Primary DA / DA1 reply) and `ESC[>0;276;0c` (Secondary DA / DA2 reply — 276 is xterm.js's hardcoded version number). The junk is typed INTO the pane as if the user had typed it, polluting prompts and — worse — command lines.

**Verified root-cause chain**:

1. Every rk terminal stream is a real `tmux attach-session` client running in a PTY (`app/backend/api/terminals_ws.go` — attach at ~line 473, `pumpPTY` read loop at ~lines 525–549 reading `streamFrameSize` = 4096-byte chunks). On each attach, tmux sends DA1/DA2 identification queries to that client's tty to feature-detect it.
2. The queries travel down the relay to the browser; xterm.js auto-answers them; the answers flow back through `terminal.onData → ws.send` (`app/frontend/src/components/terminal-client.tsx:343`), indistinguishable from keystrokes, into the tmux client's PTY.
3. tmux consumes exactly one DA1 and one DA2 reply per client tty (its `TTY_HAVEDA`/`TTY_HAVEDA2` flags); extra or late replies fall through its key parser and are delivered to the active pane as typed input. zsh swallows the `ESC[?` / `ESC[>` prefixes and echoes the printable tail — the observed junk.
4. Duplicates/lateness arise because inbound PTY bytes are flushed to xterm on `requestAnimationFrame` (`terminal-client.tsx` adaptive write flushing — `binaryBuffers` + `scheduleFlush`, ~lines 771–906). On a backgrounded tab (especially mobile) rAF never fires, so tmux's queries sit unparsed in `binaryBuffers`; RelayMux reconnects on wake and the server re-attaches, producing fresh queries; on tab wake xterm parses stale + new queries in one flush and answers ALL of them into the CURRENT connection's tmux client — which already has HAVEDA/HAVEDA2 set — so the extras get typed into the pane.

**If not fixed**: every backgrounded-tab wake (routine on mobile, common on desktop) risks typing garbage into the active pane — including into running programs and half-composed command lines, not just prompts. It erodes trust in the terminal relay as a faithful conduit.

**Why this approach**: answering DA queries at the relay (where the tmux client's PTY lives) makes replies synchronous and exactly-once per attach — the browser round-trip, and with it the entire timing pathology, is removed structurally. The rejected alternative — frontend-only filtering of DA replies out of `onData` — leaves tmux's feature detection unanswered (tmux would wait on capability probes) and depends on matching xterm.js's reply strings verbatim across xterm.js upgrades; the relay-side responder is the structurally sound spot.

## What Changes

### 1. Backend: DA1/DA2 interceptor in the PTY read loop (root fix)

In `app/backend/api/terminals_ws.go`, in the per-stream PTY pump (`pumpPTY`, ~lines 525–549), intercept Device Attributes queries coming FROM the tmux client (i.e., appearing in the bytes read from `st.ptmx`) and handle them at the relay:

- **Recognized query sequences** (exact set — nothing else is intercepted):
  - DA1: `ESC [ c` (`\x1b[c`) and `ESC [ 0 c` (`\x1b[0c`)
  - DA2: `ESC [ > c` (`\x1b[>c`) and `ESC [ > 0 c` (`\x1b[>0c`)
- **On match**: immediately write the canned xterm.js-equivalent reply back to the ptmx (which tmux reads as client input):
  - DA1 reply: `\x1b[?1;2c`
  - DA2 reply: `\x1b[>0;276;0c` (276 = xterm.js's hardcoded version, matching what the browser would have sent)
- **Strip** the matched query bytes from the browser-bound stream — xterm.js never sees the queries, so it never answers them. Replies become synchronous and exactly-once per attach; the browser round-trip is gone.
- **Chunk-boundary straddling**: a query can straddle the 4096-byte read boundary (e.g., chunk N ends `…\x1b[>` and chunk N+1 starts `0c`). A small carry-over buffer / state machine across chunks is required: hold back a trailing partial-match prefix, resume matching on the next read, and — if the held bytes turn out NOT to be a DA query — forward them to the browser unmodified and in order. The carry-over is bounded (longest recognizable query is 4 bytes), so it cannot grow or add meaningful latency.
- Reply strings and query patterns get named constants (no magic strings), per code-quality.md.
- The interceptor is pure stream processing — no new subprocesses (Constitution §I's `exec.CommandContext` rule is not implicated), no persisted state (Constitution §II).

### 2. Frontend: wipe stale buffers on stream (re)open (complement)

In `app/frontend/src/components/terminal-client.tsx`, in the `stream.onOpened` handler (~line 930) where `pendingReset = true` is armed, also clear the adaptive-flush state carried over from the dead connection:

- `binaryBuffers = []` — bytes buffered from a previous connection are wiped by the deferred reset anyway; replaying them into xterm is exactly what re-answers old queries (and repaints stale content) after a reconnect.
- Neutralize pending flush state as appropriate (e.g., cancel/clear `flushRafId`), mirroring the existing effect-cleanup neutralization at ~lines 1014–1015. The empty-flush guard in `flushToTerminal` already ensures an empty drain neither consumes nor executes `pendingReset`, so clearing buffers here is safe with respect to the deferred-reset handoff semantics documented in the file.

This is defense-in-depth once the backend strips queries, but it independently fixes the "replay dead-connection bytes into the live connection" class of bugs.

### 3. Tests

- **Go unit tests** (colocated `*_test.go` in `app/backend/api/`) for the interceptor state machine: plain passthrough, each of the four query variants matched and replaced, reply bytes written to the (test-doubled) ptmx writer, queries stripped from output, a query straddling the chunk boundary at every split point, a false-prefix (`\x1b[` followed by non-matching bytes) forwarded intact, interleaved queries + payload.
- **Frontend unit test** in the existing `terminal-client.test.tsx` (mocked RelayMux/stream harness already covers reset ordering): buffered-but-unflushed bytes from connection A are NOT written after `onOpened` fires for connection B.

### Explicitly rejected alternative

Frontend-only filtering of DA replies out of `onData` — rejected because it leaves tmux's feature detection unanswered and depends on matching xterm.js's reply strings verbatim. Recorded here so the apply agent does not resurrect it.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) Terminal relay section — document the relay-side DA1/DA2 responder in the PTY pump (queries answered at the ptmx, stripped from the browser-bound stream, carry-over across 4KB chunk reads).
- `run-kit/ui-patterns`: (modify) Terminal Relay (frontend) / adaptive-flush + deferred-reset section — document that `stream.onOpened` now also wipes `binaryBuffers`/pending flush state, and why (stale-connection bytes must never replay into the new connection).
- `run-kit/architecture`: (modify) Terminal Relay section — brief note that the relay answers terminal identification (DA1/DA2) on behalf of the browser terminal.

## Impact

- `app/backend/api/terminals_ws.go` — `pumpPTY` gains the interceptor (or delegates each read chunk to a small filter type in the same package); new named constants for query/reply byte sequences; new colocated unit tests. No protocol change on the `/ws/terminals` wire format (frames stay `[u32 BE streamId][payload]`); no API surface change.
- `app/frontend/src/components/terminal-client.tsx` — a few lines in the `onOpened` handler; existing handoff/reset semantics preserved; `terminal-client.test.tsx` gains one test.
- Behavior: tmux clients created by rk get their DA feature-detection answered immediately and exactly once per attach; browsers never see or answer DA queries. No visible change for users except the junk disappears.
- No dependencies added; no e2e surface change (no UI chrome touched — per the e2e-assertions-on-ui-chrome caution, no Playwright specs assert on this).
- Review scope: changed files only (per code-review.md).

## Open Questions

None — the root cause and both fix parts were fully resolved in the diagnosis discussion; remaining choices are implementation-level and recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix at the relay (backend DA responder), not frontend-only reply filtering | Discussed — alternative explicitly rejected (leaves tmux feature detection unanswered; couples to xterm.js reply strings verbatim) | S:95 R:70 A:90 D:95 |
| 2 | Certain | Canned replies are exactly `\x1b[?1;2c` (DA1) and `\x1b[>0;276;0c` (DA2), matching xterm.js's hardcoded responses (version 276) | Specified verbatim in the discussion; must match what tmux previously feature-detected from real xterm.js clients | S:95 R:85 A:90 D:90 |
| 3 | Certain | Intercepted queries are stripped from the browser-bound stream, never forwarded | Specified in the discussion — stripping is what makes replies exactly-once (xterm.js can no longer answer) | S:95 R:80 A:90 D:90 |
| 4 | Certain | A bounded carry-over buffer / state machine across read chunks is required (queries can straddle the 4096-byte `streamFrameSize` boundary) | Specified in the discussion; longest query is 4 bytes so carry-over is trivially bounded | S:90 R:80 A:90 D:90 |
| 5 | Certain | Frontend complement: clear `binaryBuffers` where `stream.onOpened` arms `pendingReset` | Specified in the discussion — dead-connection bytes are wiped by the reset anyway; replaying them is what re-answers old queries | S:90 R:85 A:90 D:90 |
| 6 | Certain | Tests: Go table-driven unit tests colocated in `app/backend/api/` for the interceptor (incl. straddling); frontend case added to existing `terminal-client.test.tsx` | code-quality.md mandates tests for changed behavior and defines colocation; the frontend mock harness already exists (reset-ordering tests), so "if feasible" resolves to feasible | S:70 R:90 A:90 D:85 |
| 7 | Confident | Interceptor implemented as a small self-contained scanner in the `api` package (chunk-in/chunk-out with carried state + a reply writer), unit-testable without a real PTY | Implementation-level; agent competence high, easily reversed; keeps `pumpPTY` readable per code-quality anti-pattern rules | S:65 R:80 A:85 D:70 |
| 8 | Confident | Interception scope is exactly the four DA query forms (`\x1b[c`, `\x1b[0c`, `\x1b[>c`, `\x1b[>0c`) — no DSR/XTVERSION/OSC or other query handling | The diagnosis names DA1/DA2 as the junk source; broadening scope is out of the agreed fix ("do not invent beyond it") | S:80 R:85 A:75 D:65 |
| 9 | Confident | False-prefix bytes held at a chunk boundary are forwarded to the browser unmodified and in order once the match fails; bytes still held at stream teardown are dropped (the pane is closing — moot) | Detail the discussion left to implementation; ordering-preservation is the only hard constraint | S:60 R:80 A:80 D:70 |
| 10 | Confident | `onOpened` also neutralizes pending flush state (`flushRafId`) alongside `binaryBuffers`, mirroring the existing effect-cleanup neutralization; `pendingReset` handoff semantics unchanged (empty-flush guard already protects them) | Discussion said "and any pending flush state as appropriate"; the file's documented handoff semantics determine what "appropriate" is | S:65 R:85 A:80 D:70 |
| 11 | Confident | No input-direction (browser→ptmx) filtering of DA-reply lookalikes is added | The agreed fix has exactly two parts; server-side stripping makes browser DA replies structurally impossible on new connections, and filtering keystrokes risks eating legitimate input | S:75 R:75 A:80 D:70 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
