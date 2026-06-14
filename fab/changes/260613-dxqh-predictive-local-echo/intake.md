# Intake: Predictive Local Echo (mosh-style)

**Change**: 260613-dxqh-predictive-local-echo
**Created**: 2026-06-13

## Origin

Initiated from backlog item `[dxqh]` (2026-06-10), invoked one-shot via `/fab-new dxqh`. The backlog entry is itself a near-complete design brief — it specifies the mechanism (overlay layer, not buffer writes), the scope guards (mosh-style adaptive confidence), reconciliation, cursor handling, and acceptance. No prior `/fab-discuss` or free-form conversation preceded this invocation, so the design below is sourced entirely from the backlog text plus codebase grounding.

> Predictive local echo (mosh-style) — uniform near-0ms perceived keystroke latency regardless of pane load or network. WHY: PR #255 proved under-load echo is bimodal ~4ms/~22ms with the slow mode upstream of the client flush (see [4qq2]); prediction is the only approach that is both uniform AND fast, and it is mandatory anyway if remote rk serve ever ships (over a real network the round-trip dominates and no server-side fix helps). MECHANISM: on terminal.onData for predictable inputs, paint the glyph locally immediately with tentative styling (mosh uses underline-until-confirmed), queue the prediction, and reconcile against the real inbound echo stream — confirm (restyle to normal) on match, rollback (let server truth repaint) on mismatch. KEY DESIGN DECISION up front: render predictions in an overlay layer (DOM or canvas positioned over the xterm cell grid) rather than writing into the xterm buffer. SCOPE GUARDS (mosh-style adaptive confidence): start passive; begin predicting only after observed round-trips confirm the pane echoes typed printables within N ms; auto-disable on first mismatch and re-enter passive observation; never predict in the alternate-screen buffer; never predict control chars or the EFFECTS of Enter; restrict to printable ASCII first, then extend grapheme-aware; skip during IME composition and bracketed paste; the compose-buffer path bypasses prediction entirely. RECONCILIATION: ordered pending-prediction queue keyed by expected echo bytes + predicted cell positions. CURSOR: predictions render at the live cursor cell and advance a shadow cursor. MEASUREMENT/ACCEPTANCE: extend echo-latency.spec.ts with a perceived-echo metric plus a misprediction counter; target under-load perceived p50 under ~5ms with a single-cluster histogram, zero visible mispredictions in non-echoing panes, throughput guard unchanged. RELATED: [4qq2] is the source-side alternative; PRs #242-#245, #255.

## Why

**Problem.** Keystroke→echo latency in run-kit's web terminal is bimodal under load. PR #255's controlled benchmark proved the slow mode (~22ms vs. ~4ms idle, a 1:2 ratio) originates **upstream of the client flush** — it is a property of tmux pacing redraws to the attached client, not of the browser's adaptive write batching (PR #244). The adaptive flush already collapsed the *idle* path (40ms→10ms, the rAF tail), but it cannot touch the slow mode because the bytes simply arrive late from tmux. So the user feels inconsistent, occasionally laggy typing whenever a pane is busy (a build streaming, a log tailing).

**Consequence if unaddressed.** Two compounding costs:
1. **Local UX today** — typing in a window whose pane is streaming output feels sticky and unpredictable. The companion ticket `[4qq2]` attacks this at the source (tmux/relay attribution + pacing bypass), but its own acceptance explicitly allows the conclusion "structurally unavoidable with a regular attached client" — in which case prediction is the *only* remaining local lever.
2. **Remote `rk serve` is blocked.** The moment run-kit serves over a real network (not loopback), the network round-trip dominates perceived latency and **no server-side fix helps** — the bytes physically cannot return faster than the RTT. Predictive echo is the only technique that decouples *perceived* latency from the round-trip, exactly as mosh does for SSH. This makes prediction mandatory infrastructure for the remote story, not just a local nicety.

**Why this approach over alternatives.**
- **vs. `[4qq2]` (source-side fix):** complementary, not competing. `[4qq2]` can at best make the *real* echo uniformly fast on loopback; it does nothing for a real network. Prediction is uniform AND fast AND network-independent. The two can ship independently; if `[4qq2]` fully collapses the local slow mode, prediction remains the remote-serve lever (the backlog says so explicitly).
- **vs. an interim de-jitter buffer** (the cheap option noted in `[4qq2]`): a de-jitter buffer trades median latency for *uniformity* (everything becomes uniformly ~22ms). Prediction gives uniformity *at* near-0ms. Strictly better when it works; the de-jitter buffer becomes unnecessary if prediction lands.
- **vs. writing predictions into the xterm buffer:** rejected up front (see Design Decisions). xterm has no undo; a buffer write would corrupt scrollback/state on misprediction. An overlay makes rollback trivial and keeps the inbound stream the single source of truth for the real buffer.

## What Changes

A new **frontend-only** prediction layer in `app/frontend/src/components/terminal-client.tsx` (plus extracted helper modules and tests). No backend, API, relay, or tmux changes — the relay byte stream and the `onData → ws.send` path are untouched; prediction is a purely client-side overlay that observes the same two streams already flowing through `TerminalClient` (outbound `terminal.onData`, inbound relay WebSocket data).

### 1. Prediction Rendering: Buffer-Write + Self-Authored VT Rollback (port VS Code / sshx typeahead)

Predicted glyphs are written into the terminal via `terminal.write()` — they become **real xterm cells** — and a misprediction is undone by writing **hand-authored VT escape sequences** that overwrite/delete the predicted cells. This is the proven approach: it is exactly what VS Code's `terminalTypeAheadAddon.ts` ships (behind the `terminal.integrated.localEcho*` settings) and what **sshx** — the closest browser-xterm.js analog to run-kit — ports as a near-standalone `src/lib/typeahead.ts`. v1 ports/adapts sshx's typeahead; a DOM overlay (§1b) is the **fallback** if the port fights xterm 6.0's buffer/SGR seams. See Design Decisions D1 for why this reverses the original "never the buffer" framing, and the Render Approach Research subsection for the full evidence.

**Why buffer-write, not an overlay (corrected premise).** The original intake assumed "xterm has no undo, therefore never write to the buffer." The research overturned the *conclusion*, not the premise: xterm v6 indeed has no buffer-rollback API (`IBufferCell` is read-only, `terminal.write()` is append-only — verified against our installed `@xterm/xterm@6.0.0` typings). But the proven pattern doesn't *need* an xterm undo — it constructs the undo itself:

- **Apply a prediction**: snapshot the cell about to be overwritten (old char + old SGR attributes, read via the public read-only `buffer.getLine().getCell()` / `IBufferCell`), then `terminal.write(<tentative SGR><predicted glyph><reset SGR>)`. The glyph lands as a real cell, pixel-perfectly aligned because xterm renders it (no cell-geometry math, no font re-measurement, no scroll/resize re-sync — these are *free*).
- **Roll back a prediction**: `terminal.write()` a reconstructed sequence — cursor-move to the cell + (rewrite the saved original char+attrs **or** emit a `DeleteChar` VT op) — restoring the pre-prediction state. sshx already solves the fiddly bookkeeping (tracking inbound server SGR via the equivalent of `onWriteParsed` so the undo sequences stay correct).
- **Tentative styling**: mosh-style underline-until-confirmed via the SGR wrapper (underline/dim on for the predicted glyph, normal on confirmation). Colors constrained to existing theme tokens (no new hardcoded hex), consistent with `deriveXtermTheme` usage.

**What this buys us**: the intake's three biggest risk areas — cell-geometry drift, off-by-one auto-wrap, and scroll/resize re-sync — **disappear**, because predictions are real buffer content that xterm lays out and reflows itself. The cost moves entirely to the VT-rollback bookkeeping, which is the part sshx has already written.

**WebGL-safe**: the approach is renderer-agnostic (it only calls `write()`), so it works identically under the WebGL renderer and the canvas fallback (`setActiveRenderer`/`__rkRenderer` unaffected).

### 1b. Fallback: DOM overlay (only if the port fights xterm 6.0)

If porting Approach A proves infeasible against `@xterm/xterm@6.0.0` (e.g. the buffer/SGR seams sshx relies on behave differently on our pinned build), fall back to an **absolutely-positioned DOM overlay**:

- A positioned element over `terminalRef.current` (its parent is already `relative` — see `terminal-client.tsx:887`) draws tentative glyph **DOM text nodes** at computed cell coordinates, restyled-to-normal on confirm and removed on rollback (rollback is trivial — just remove the node; the real buffer is never touched, so no residue).
- **Canvas overlay is explicitly rejected** (was a v1 option, now dropped): at human-keystroke volume canvas's batching advantage is irrelevant, and it forces re-implementing xterm's exact font shaping/baseline (the repo already fights subtle glyph-width drift — see the `UnicodeGraphemesAddon` + `font-display: block` history) plus an un-introspectable test surface. DOM reuses xterm's font/theme for free and is assertable in Playwright/jsdom. If an overlay at all, it is DOM.
- **Cost of this fallback** (the reason it is the fallback, not the primary): cell geometry must be re-derived from xterm's render dimensions — and the only accessor is the **private** `terminal._core._renderService.dimensions.css.cell.{width,height}` (not in the public 6.0.0 typings; requires a version-pinned cast), kept in sync via the public `onRender` / `onResize` / `onScroll` / `onCursorMove` events. Wrap and pending-wrap (DECAWM last-column) math become the client's responsibility again. These are exactly the risks Approach A avoids.

### 2. Outbound Hook (`terminal.onData`)

The existing handler (`terminal-client.tsx:290`) currently does only:

```ts
terminal.onData((data) => {
  if (wsRef.current?.readyState === WebSocket.OPEN)
    wsRef.current.send(data);
});
```

Prediction wraps this **without changing the send** — the keystroke is still sent to the WS unconditionally and unmodified. Additionally, for *predictable* input, the handler:
1. Checks the **predictability gate** (printable ASCII first; not a control char; not the alternate-screen buffer via `term.buffer.active.type`; not during IME composition or bracketed paste; prediction currently ENABLED per the confidence state machine).
2. If predictable: snapshots the target cell, `terminal.write()`s the tentatively-styled glyph at the live cursor, advances a **shadow cursor**, and enqueues a pending prediction holding `{expected echo bytes, the cell snapshot needed for rollback, predicted cell position}`. (Fallback §1b instead paints a DOM node and enqueues its handle.)
3. Enter (`\r`) is NOT predicted as a glyph — it flushes/confirms pending predictions only (its *effects* — new prompt line, command output — are unpredictable). Backspace is predicted only against the client's own queued predictions, never against pre-existing real cells.

### 3. Reconciliation Against the Inbound Stream

The inbound relay data already flows through the adaptive flush (`flushToTerminal` / immediate path, lines ~673–834). Reconciliation observes the inbound bytes and matches them against the pending-prediction queue:

- **Ordered queue** keyed by expected echo bytes + predicted cell positions. Incoming chunk bytes are matched **prefix-wise** against the head of the queue and consumed on match → the corresponding prediction is **confirmed**: its tentative SGR styling is replaced with normal styling so the predicted cell visually settles (Approach A re-`write()`s the confirmed glyph without the tentative SGR; the §1b fallback restyles/removes the DOM node).
- **ANY divergence** (a byte that doesn't match the expected echo) triggers **rollback of all outstanding predictions and a clear of the queue**: Approach A `write()`s the saved-cell-restore VT sequences (then the in-flight server bytes repaint authoritatively); the §1b fallback just drops the overlay nodes. Recovery is automatic because the server repaint is already in flight.
- The **inbound stream remains the source of truth**. Under Approach A a confirmed prediction and the server's real echo describe the *same* cell content, so they converge; under divergence the rollback + server repaint reconcile the buffer to server truth. Net invariant either way: once the dust settles, the buffer equals exactly what the server sent — predictions never leave residue.

### 4. Adaptive Confidence State Machine (Scope Guards)

**The feature is always ON** (no feature flag — see Design Decisions D2). PASSIVE/ACTIVE is **not** a user-facing toggle; it is a per-moment *safety reflex* that decides whether it is safe to bet on the next echo. The two notions are orthogonal: the feature is permanently enabled, and within it the confidence machine adaptively gates each prediction. "Always predict unconditionally" is unsafe and is explicitly NOT the design — a password prompt echoes nothing (predicting would paint secret characters on screen), and vim/TUIs echo cursor motions rather than the typed glyph (predicting would flash garbage). PASSIVE means "not yet confirmed this pane echoes printables 1:1, so don't guess," NOT "feature disabled." This mirrors mosh, which predicts only while confident and goes quiet otherwise.

The estimator is **mosh-style adaptive** from the start (Design Decisions D3): maintain an SRTT-style adaptive round-trip estimate per connection rather than a fixed threshold, so the confirm-window self-tunes across loopback and (future) real-network latency — important because remote `rk serve` is a primary motivation and a fixed threshold tuned for loopback would mis-gate over a network.

- **PASSIVE (initial / default)**: observe only. Feed each typed-printable→confirming-echo round-trip into the adaptive RTT estimator. Do NOT paint predictions.
- **ACTIVE**: entered once observed round-trips show the pane echoes typed printables within the adaptive estimate's confirm-window. While active, predict per the gate in §2.
- **Auto-disable → PASSIVE on first mismatch**: any reconciliation divergence drops back to PASSIVE and re-enters observation. This is what covers password prompts (no echo), vim normal mode, and full-screen TUIs — the moment the echo doesn't match, prediction stops and re-learns.
- **Hard exclusions (never predict, regardless of state)**:
  - Alternate-screen buffer (`term.buffer.active.type === "alternate"`) — full-screen apps (vim, less, htop) never get predictions.
  - Control characters and escape sequences.
  - The *effects* of Enter (Enter only flushes/confirms).
  - During IME composition and bracketed paste.
  - The compose-buffer path (`compose-buffer.tsx`) bypasses prediction entirely — it already batches text and sends via the WS without going through interactive `onData` echo.
- **Character scope**: printable ASCII first; extend grapheme-aware later (the `UnicodeGraphemesAddon` is already loaded — `terminal.unicode.activeVersion = "15-graphemes"`), so cell-width computation for predicted glyphs can reuse xterm's width tables.

### 5. Cursor Handling

- Predictions render at the **live cursor cell** and advance a **shadow cursor** (a prediction-local cursor position, distinct from xterm's real cursor which only advances when the real echo arrives).
- **Wrap at `cols`**: under Approach A, wrap is **handled by xterm itself** — writing a glyph at the last column reflows per the terminal's own DECAWM/pending-wrap logic, so the off-by-one and last-column "pending wrap" edge cases are no longer the client's problem (this is a primary reason A is favored over the overlay). Under the §1b fallback only, the shadow cursor must replicate wrap math manually.
- **Backspace** is predicted only by retracting the client's own most-recent queued prediction — Approach A `write()`s the rollback (restore the saved cell + retreat the cursor); the fallback un-paints the node. It NEVER edits a pre-existing real cell — if there are no queued predictions, backspace is sent to the WS and not predicted.

### 6. Measurement & Acceptance Harness

Extend `app/frontend/tests/e2e/echo-latency.spec.ts` (audit-style, like sync-latency — records distributions, does not gate on a budget):

- **Perceived-echo metric**: keystroke dispatch → **predicted glyph visible** (distinct from the existing keystroke → server-glyph-in-buffer metric). Under Approach A the predicted glyph IS a buffer cell, so the metric stops when the tentatively-styled cell appears; this needs a DEV-gated test handle to the prediction engine's state (a parallel `__rkPredictions` handle mirroring `__rkTerminals`) to distinguish a *predicted* cell from the *server-echoed* one and to read the misprediction counter.
- **Misprediction counter** per 1k keystrokes, recorded across three scenarios:
  1. **Idle `cat`** — clean echo, prediction should be active and near-instant.
  2. **Under-load tick stream** (the PR #255 harness) — prediction should hold perceived latency near-0 while real echo is slow.
  3. **vim / alternate-screen pane** — prediction MUST remain OFF (zero predictions painted; the misprediction/visible-prediction count is 0).
- **Targets** (audit signals, not asserted budgets unless noise allows): under-load perceived p50 < ~5ms with a single-cluster histogram; zero visible mispredictions in non-echoing panes; the existing 20k-line throughput guard unchanged.
- The companion `echo-latency.spec.md` MUST be updated in the same commit (constitution: Test Companion Docs).

### 7. Module Structure

To keep `terminal-client.tsx` (924 lines) from ballooning, the prediction logic SHOULD be extracted into focused, unit-testable modules (mirroring the `select-live-panes.ts` + colocated-tests precedent). Adapting sshx's `typeahead.ts` gives a natural seam:
- A **pure prediction engine** (the pending-prediction queue, the confidence state machine, the byte-matching/reconciliation, the VT apply/rollback **string** construction) — no `terminal` dependency beyond an injected reader/writer interface, so it is fully unit-testable without a DOM. The VT-string builders are pure functions over a cell snapshot + position.
- A **thin binding** in `TerminalClient` that wires the engine's `write()` calls to `terminal.write()`, its cell-snapshot reads to `buffer.getLine().getCell()`, and its inbound observation to the relay data path.

`terminal-client.tsx` wires the engine into the existing `onData` and inbound-flush seams. The §1b DOM-overlay fallback, if taken, swaps the binding (DOM nodes instead of `write()`) but keeps the same pure engine.

### Design Decisions

- **D1 — Buffer-write + self-authored VT rollback (Approach A), not an overlay.** Reverses the backlog's original "render in an overlay, never the buffer" instruction. The backlog's premise (xterm has no undo) is true, but the conclusion was wrong: the proven pattern doesn't rely on an xterm undo — it snapshots the cell and writes its own VT undo sequence. Choosing A makes the three hardest sub-problems (cell-geometry alignment, auto-wrap, scroll/resize sync) free, and lets us port proven code (sshx/VS Code) instead of writing bespoke geometry. Rejected alternative: **DOM overlay** (kept as the §1b fallback). Rejected outright: **canvas overlay** (no benefit at keystroke rate; re-implements font shaping; un-testable). See Render Approach Research below.
- **D2 — Always-ON, no feature flag.** The adaptive-confidence reflex is the safety; a flag adds surface. (Clarified with user.)
- **D3 — Mosh-style adaptive (SRTT-like) RTT estimator from the start.** A fixed loopback-tuned threshold would mis-gate over a real network, and remote `rk serve` is a primary motivation. (Clarified with user.)

### Render Approach Research

The render-path decision (intake Assumption #9) was resolved by researching the xterm.js v6 API and prior art, verified against our installed `@xterm/xterm@6.0.0` typings:

- **No buffer rollback in xterm v6.** `IBufferCell` is read-only (`getCell`/`getChars`, no setters); `terminal.write()` is append/process-only. There is no transaction/undo. Verified in `node_modules/.pnpm/@xterm+xterm@6.0.0/.../typings/xterm.d.ts`.
- **Decorations cannot paint glyphs.** `registerDecoration`/`registerMarker` are public, but `IDecorationOptions` only styles a background/foreground rectangle over a cell range — no text. Usable as a positioned `<div>` you fill yourself (via the public `IDecoration.onRender` element), which is just a DOM overlay parented to xterm's decoration layer. So decorations don't provide a glyph-rendering shortcut.
- **The reference implementation writes glyphs into the buffer with hand-authored VT rollback.** VS Code's `terminalTypeAheadAddon.ts` (behind `terminal.integrated.localEcho*`) is the canonical mosh-style predictive-echo implementation; **sshx** ships a near-standalone port as `src/lib/typeahead.ts` ("forked from VSCode's typeahead implementation"). Both `terminal.write()` a tentatively-styled glyph and, on misprediction, `write()` a reconstructed cursor-move + restore-saved-char / `DeleteChar` sequence. They track inbound server SGR (`onWriteParsed`-class hook) to keep undo sequences correct. This is renderer-agnostic (WebGL-safe) because it only uses `write()`.
- **Cell geometry, if an overlay is needed (fallback only), is private API.** The cell pixel size lives at `terminal._core._renderService.dimensions.css.cell.{width,height}` — `_core` is NOT in the public 6.0.0 typings (cast + version-pin required). Public sync events `onRender` / `onScroll` / `onCursorMove` / `onResize` (all confirmed present in 6.0.0) keep an overlay aligned. This private-API dependency is part of why the overlay is the fallback, not the primary.
- **No comparable browser project uses a canvas overlay or a pure DOM overlay for this.** The `local-echo` addon family (wavesoft, etc.) solves a *different* problem — readline-style line editing where the server does NOT echo — with no confirm/rollback against server output. For mosh-style predictive echo on xterm.js, VS Code's addon (and sshx's port) is the de-facto reference.

Citations: xterm.js issue #1519 (Predictive Typing); microsoft/vscode `terminalTypeAheadAddon.ts`; ekzhang/sshx `src/lib/typeahead.ts`; xtermjs.org API typings (verified locally at 6.0.0).

**Apply-time validation owed**: port sshx's `typeahead.ts` against `@xterm/xterm@6.0.0` specifically (it pins an older fork) — confirm the `IBufferCell` read shape and the SGR-tracking hook behave on 6.0; if they don't, take the §1b DOM-overlay fallback.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add a "Predictive Local Echo" subsection under the terminal area, alongside "Terminal Write Batching (Adaptive Flush + Deferred Reset)". Document the buffer-write + self-authored-VT-rollback approach (ported from sshx/VS Code typeahead) and the DOM-overlay fallback, the PASSIVE/ACTIVE adaptive-confidence reflex (and that the feature itself is always-on), the mosh-style SRTT estimator, the hard exclusions (alternate-screen, control chars, IME, bracketed paste, compose buffer), the reconciliation queue, and shadow-cursor handling. Cross-reference the adaptive-flush entry (the inbound path prediction reconciles against) and `[4qq2]` (the source-side alternative).

## Impact

- **Code (frontend only)**:
  - `app/frontend/src/components/terminal-client.tsx` — wrap `onData` (prediction hook), tap the inbound flush path (reconciliation), bind the engine's `write()`/cell-read/observe calls, add the DEV-gated `__rkPredictions` test handle.
  - New modules (names TBD at plan time): a pure prediction engine (ported/adapted from sshx `typeahead.ts`) + colocated unit tests; the thin `terminal`-binding (or the §1b DOM-overlay view if the port is infeasible).
  - `app/frontend/tests/e2e/echo-latency.spec.ts` + `.spec.md` — perceived-echo metric, misprediction counter, three scenarios.
  - Unit tests for the engine (confidence transitions, queue match/divergence, backspace, VT apply/rollback string construction).
- **No backend / API / relay / tmux changes** — constitution-relevant: this is purely client-side; the `onData → ws.send` and relay byte streams are untouched. Constitution IX (uniform HTTP verb) and II (no database) are unaffected (no new endpoints, no persisted state — confidence is per-connection ephemeral, derived at runtime).
- **Constitution V (keyboard-first)**: prediction operates on keyboard input directly; no new mouse affordance.
- **Performance**: prediction must not regress the inbound throughput guard (20k-line burst). The prediction hot path runs per-keystroke (human-rate, not flood-rate), so its cost is negligible; but reconciliation observes every inbound chunk and MUST stay allocation-light on the hot path (mirroring the `textByteLength` tiny-ASCII discipline). Approach A adds extra `terminal.write()` calls for apply/confirm/rollback — bounded by keystroke rate, not flood rate.
- **Risk areas** (Approach A — note several are *removed* vs. an overlay): (a) **VT-rollback correctness** — the saved-cell snapshot + reconstructed undo sequence must exactly restore prior content, including SGR state (the part sshx solved; the main porting risk); (b) confidence threshold tuning (too eager → visible mispredictions; too shy → no benefit); (c) correctly detecting alternate-screen transitions to suppress predictions in TUIs; (d) **porting risk** — sshx pins an older xterm fork, so the buffer-read/SGR-tracking seams need validation against 6.0.0 (fallback: §1b). Cell-geometry drift and auto-wrap math — the dominant risks under an overlay — are NOT in this list because Approach A delegates layout to xterm; they reappear only if the §1b fallback is taken.

## Open Questions

_All blocking design questions were resolved during intake (see Assumptions #9–#11). Remaining items are apply-time implementation details, not blockers:_

- **Render path decided** (Assumption #9, clarified + researched): buffer-write + self-authored VT rollback (port sshx/VS Code typeahead), DOM overlay as fallback, canvas rejected. The only open sub-item is the apply-time **port validation** against `@xterm/xterm@6.0.0` (the sshx fork is older) — if it fails, take the §1b fallback. This is a verify-during-apply step, not an undecided design question.
- Exact tentative-style visual token (underline vs. dim vs. both) — pick from existing theme tokens; minor, resolvable at apply time.
- The adaptive RTT estimator's concrete parameters (smoothing factor, variance multiplier, minimum confirm-window floor) — port mosh's / VS Code's constants as a starting point and refine via the latency harness. Mechanism is decided (Assumption #11); only the tuning constants are open.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Render predictions by **writing glyphs into the xterm buffer with self-authored VT rollback** (port sshx/VS Code typeahead); DOM overlay is the fallback, canvas rejected | REVERSES the backlog's "overlay, never buffer" instruction after research (verified against 6.0.0 typings): xterm has no undo, but the proven pattern constructs its own VT undo, which makes alignment/wrap/scroll-sync free and reuses battle-tested code. Reversal of an explicit brief instruction + an owed apply-time port-validation keep this Confident, not Certain. <!-- clarified: buffer-write + VT rollback chosen over overlay; see Render Approach Research --> | S:88 R:62 A:85 D:82 |
| 2 | Certain | Frontend-only change — no backend/API/relay/tmux edits | Prediction observes the two streams already in `TerminalClient`; the `onData → ws.send` and relay paths are untouched. Codebase + constitution confirm. | S:90 R:75 A:95 D:95 |
| 3 | Certain | Hard-exclude alternate-screen buffer, control chars, Enter-effects, IME, bracketed paste, and the compose-buffer path from prediction | Enumerated explicitly in the backlog scope guards; each maps to a concrete xterm/codebase signal (`buffer.active.type`, compose-buffer.tsx bypass). | S:95 R:85 A:90 D:95 |
| 4 | Certain | Adaptive confidence: start PASSIVE, go ACTIVE only after observed echoes confirm within threshold, auto-disable to PASSIVE on first mismatch | Mosh-style adaptive confidence is specified verbatim in the brief; it is the core safety mechanism. | S:95 R:70 A:85 D:95 |
| 5 | Certain | Ordered pending-prediction queue keyed by expected echo bytes + cell positions; any divergence rolls back all outstanding predictions + clears the queue | Reconciliation algorithm specified in full in the brief; server repaint makes recovery automatic (rollback restores prior cells under Approach A). | S:95 R:75 A:90 D:95 |
| 6 | Confident | Extend `echo-latency.spec.ts` with a perceived-echo metric + misprediction counter across idle/under-load/alternate-screen scenarios; audit-style (no asserted budget) | Acceptance specified in the brief; the spec is already an on-demand audit (its header says so), so a perceived-echo metric fits the existing pattern; `.spec.md` update required by constitution. | S:88 R:90 A:85 D:85 |
| 7 | Confident | Expose prediction state via a DEV-gated `window` test handle, mirroring `__rkTerminals` | The perceived-echo metric needs a programmatic handle to overlay paint; the existing DEV-gated registry is the established precedent (the harness already uses `__rkTerminals` to read the buffer). | S:80 R:92 A:88 D:88 |
| 8 | Confident | Extract the prediction engine into a pure, DOM-free, unit-testable module (queue, confidence machine, VT apply/rollback string builders) with colocated tests; thin `terminal`-binding in `TerminalClient` | `terminal-client.tsx` is already 924 lines; the `select-live-panes.ts` pure-helper-plus-colocated-tests pattern is the established precedent, and sshx's `typeahead.ts` already factors along this seam. | S:78 R:85 A:90 D:82 |
| 9 | Confident | Overlay rendering decided: buffer-write + VT rollback primary, DOM overlay fallback, canvas rejected (folds into #1) | Clarified with user ("spike A first, DOM fallback") and backed by the Render Approach Research — no longer a deferred/guessed decision. Now a verify-during-apply (port validation) rather than an open design choice. <!-- clarified: render path resolved; canvas dropped --> | S:85 R:65 A:82 D:80 |
| 10 | Certain | Feature ships always-ON with no feature flag; safety is the adaptive-confidence reflex (PASSIVE/ACTIVE), not a user toggle | Clarified — user chose "on by default" and confirmed the always-on vs. adaptive-gate distinction. The confidence machine (passive until echo confirmed, auto-disable on mismatch) is the self-protecting safety; password/TUI cases are covered by it. <!-- clarified: always-on, no flag, adaptive gate is the safety --> | S:92 R:75 A:90 D:92 |
| 11 | Confident | Implement a mosh-style adaptive (SRTT-like) round-trip estimator from the start, not a fixed threshold | Clarified — user chose mosh-style adaptive. Justified by the remote-`rk serve` motivation: a fixed loopback-tuned threshold would mis-gate over a real network. Only the smoothing constants remain a tuning detail (Open Questions). <!-- clarified: mosh-style adaptive RTT estimator chosen --> | S:82 R:70 A:78 D:82 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
