# Intake: Compose Strip Sent-History with ArrowUp Recall

**Change**: 260806-kadm-compose-send-history-recall
**Created**: 2026-08-06

## Origin

Created via `/fab-proceed`'s promptless create-intake dispatch from a `/fab-discuss` session in this repo. The discussion diagnosed why users perceive the docked compose strip as "losing their hard work" and confirmed a recovery-over-verification design. Synthesized user input:

> Per-target last-sent history with ↑ (ArrowUp) recall in the docked compose strip, so transmitted compose text is always recoverable — "never lose the user's typed text." Keep around 10 messages in history per target. Recovery over verification: terminals cannot reliably confirm acceptance, so instead of gating the draft-clear on delivery confirmation, keep a last-sent history and make recovery one keystroke away. Echo-confirmation before clearing (reusing the chat send path's novelty-echo-probe idea) is explicitly deferred — not part of this change.

Interaction mode: conversational (`/fab-discuss`), decisions user-confirmed; dispatched promptless, so remaining design calls are recorded as graded assumptions below rather than asked.

## Why

**The pain point.** The compose strip (`app/frontend/src/components/compose-strip.tsx`) sends text to the focused pane over the terminal relay WebSocket and then **unconditionally clears the per-target draft** (`clearComposeDraft(draftKey)` at the end of `send()`, ~line 262). Delivery is fire-and-forget at three hops, none of which can confirm acceptance:

1. **Client**: `ws.send()` only queues bytes; the sole guard before clearing is `ws.readyState === WebSocket.OPEN`, and an OPEN socket can be half-dead (laptop sleep, network switch) — bytes queue and vanish.
2. **Backend**: `_, _ = ptmx.Write(msg[4:])` at `app/backend/api/terminals_ws.go:310` ignores PTY write errors.
3. **Pane app**: the receiving TUI can silently swallow the bytes — Claude Code at a permission/select prompt discards typed text; an open autocomplete popup treats Enter as accept; a plain shell executes the line; a busy agent may drop staged input.

All three send modes share this path, differing only in trailing byte (plain Enter / insert-line: `text + "\n"`; Alt+Enter / raw insert: `text`; Cmd/Ctrl+Enter / submit: `text + "\r"`). Plain Enter is where users notice loss most: the `\n` "stage a line in the agent's composer" contract is the most pane-state-dependent and its success is the least observable.

**The consequence of not fixing.** Users compose multi-paragraph prompts in the strip (its whole purpose — a real textarea with IME/autocorrect over a laggy relay), hit Enter, and the text is gone from the strip the instant it is sent. When any hop swallows it, the work is unrecoverable. This erodes trust in the strip as a composition surface.

**Why this approach over alternatives.** Recovery over verification (user-confirmed): terminals cannot reliably confirm acceptance — there is no ack channel through a PTY, and pane-side behavior is app-dependent. Gating the clear on delivery confirmation would need an echo-probe (like the chat send path's novelty-echo probe in the backend chat sender), which is heuristic, adds latency, and still cannot prove the *application* accepted the bytes. A per-target sent-history with one-keystroke recall makes every transmitted text recoverable regardless of which hop lost it, without touching the send semantics. **Rejected for now**: echo-confirmation before clearing — explicitly deferred by the user, not part of this change.

## What Changes

Frontend-only. Two files carry the implementation; the send semantics (payload bytes, clearing behavior, focus contract, `classifyComposeEnter` matrix) are untouched.

### 1. Sent-history in the compose draft store (`app/frontend/src/lib/compose-draft-store.ts`)

The module-level draft store gains a per-target **sent-history**, keyed by the same `entryKey(server, windowId)` the draft store already uses (the strip's `focusedKey()`), living in the same module (keeps the entryKey coupling and persistence discipline in one place). New surface, mirroring the existing store's shape:

```ts
/** Max recallable sent entries kept per target (newest first). */
export const MAX_SENT_HISTORY_PER_TARGET = 10;

/** Push a sent text onto a target's history (called by the strip's send(),
 * all three modes, BEFORE clearComposeDraft). Newest first. No-ops on
 * empty/whitespace-only text (the empty-submit bare `\r` pushes nothing).
 * Adjacent duplicates collapse: pushing text identical to the current newest
 * entry is a no-op (re-sending the same text twice doesn't burn a slot). */
export function pushComposeSentHistory(key: string, text: string): void;

/** Newest-first sent texts for a target; `[]` (stable identity) for
 * null/absent keys. Plain read — recall reads at keydown time. */
export function getComposeSentHistory(key: string | null): readonly string[];

/** Test seam mirroring hydrateComposeDrafts(). */
export function hydrateComposeSentHistory(): void;
```

Trimming policy: the *push guard* is `text.trim() === ""` (whitespace-only pushes nothing), but stored text is the exact sent text (no trim) — recall must reproduce what was transmitted.

### 2. Persistence (sibling localStorage key)

History persists to localStorage under a **sibling key** `runkit-compose-sent-history` (constant `COMPOSE_SENT_HISTORY_STORAGE_KEY`), schema `{[entryKey]: {entries: string[], updatedAt: number}}` — not folded into `runkit-compose-drafts`, so the existing draft schema, its tolerant parser, and its prune pipeline stay byte-compatible and neither surface's corruption can take the other down. Same posture as drafts:

- **Write-through** on every push (best-effort try/catch, remove-when-empty).
- **Tolerant-parse hydration** at module load: malformed JSON / non-object roots / wrong-typed entries degrade to empty/skipped (the `parseOverrides` posture; entries validated as `string[]` + finite-number `updatedAt`).
- **Pruning discipline** on write and hydrate: drop targets with empty `entries`, drop targets outside the age window (reuse `MAX_DRAFT_AGE_MS`, 7 days, two-sided `Math.abs` check so future-dated timestamps age out), cap to the `MAX_PERSISTED_DRAFTS`-style newest-N targets by `updatedAt` (new constant, 30) — tmux window IDs are reused after a server restart, so stale history must not resurrect against a stranger window.
- Multi-tab is last-write-wins (no `storage`-event sync), matching drafts.

### 3. ↑/↓ recall in the strip (`app/frontend/src/components/compose-strip.tsx`)

In the textarea's `onKeyDown`, after the Escape branch and the `handleReadlineKey` call (which handles no arrow keys — Ctrl+U/W, Alt+B/F/D only, so composition is clean) and before `classifyComposeEnter`:

- **ArrowUp** is intercepted **only when it cannot mean cursor movement** — the conservative baseline gate: the textarea is **empty** (or a recall walk is already in progress). A non-empty textarea outside a recall session keeps native ↑ cursor movement untouched. On intercept: recall the most recent sent text into the textarea; repeated ↑ walks back through history (oldest entry pins — no wrap).
- **ArrowDown** during a recall session walks forward (newer); stepping past the newest entry **restores the stashed in-progress draft** (the pre-recall textarea content — empty under the baseline gate) and ends the session. Outside a session, ↓ is untouched.
- **Session model** (component-local refs, e.g. `recallIndexRef` + `recallStashRef`): a session starts on the first intercepted ↑ (stashing the current draft text) and ends on: walking past newest (↓), any user edit (`onChange`), any send, or a target switch (`draftKey` change). Escape keeps its existing blur-only semantics (focus contract unchanged).
- Recalled text is written through `setComposeText(draftKey, …)` — the textarea is store-controlled, so recall behaves like typing (persists as the draft, auto-grow resizes). Recall restores **text only**; attachments are not resurrected (their path lines are part of the recalled text; the `File` objects were revoked at send and cannot be restored from localStorage anyway).
- Intercepted arrows are consumed (`preventDefault` + `stopPropagation`), mirroring the Enter-action handling so they never reach global chords.

### 4. Push wiring in `send()`

In `send()` (compose-strip.tsx, ~line 222), after the readyState guard passes and immediately before `clearComposeDraft(draftKey)`: `pushComposeSentHistory(draftKey, text)` for all three modes (`submit`, `insert`, `insert-line`). The empty-submit path (bare `\r`) never reaches the push (whitespace-only guard). A guard-blocked send (readyState not OPEN, early return preserving the draft) pushes nothing — the draft was never cleared, so there is nothing to recover.

### 5. Tests

Per the colocated `.test.ts(x)` convention (both files already have test siblings — extend them):

- `compose-draft-store.test.ts`: history push/newest-first order, 10-cap eviction, whitespace no-op, adjacent-dedupe, per-target isolation, persistence round-trip (write → `hydrateComposeSentHistory()` → read), tolerant parse of malformed storage, age-out + target-cap pruning.
- `compose-strip.test.tsx`: ↑ on empty textarea recalls newest; repeated ↑ walks older and pins at oldest; ↓ walks newer and past-newest restores the stash and ends the session; ↑ on non-empty textarea outside a session is NOT intercepted (native cursor movement); editing exits the session; send pushes history before clearing (all three modes); empty submit pushes nothing.

No Playwright spec is required (the behavior is fully unit-testable at the store + keydown seams, matching how the Enter matrix is tested); if one is nonetheless added at apply time, its sibling `.spec.md` companion must be updated per the constitution's Test Companion Docs rule.

### Constraints (unchanged surfaces)

- No backend edits.
- Send semantics untouched: payloads, clearing behavior, focus contract, and `classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts`) stay as-is.
- `handleReadlineKey` composes cleanly: it runs first and owns no arrow keys.
- The chat send form (`chat` surface) is **out of scope** — this history is a strip feature (the chat path already has echo-probe verification).

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Docked Compose Strip — add the sent-history + ↑/↓ recall contract (store surface, sibling persistence key, recall session model, empty-textarea gate) alongside the existing draft-store and Enter-matrix coverage.

## Impact

- `app/frontend/src/lib/compose-draft-store.ts` — history API + sibling-key persistence (+ `compose-draft-store.test.ts`).
- `app/frontend/src/components/compose-strip.tsx` — ↑/↓ recall in `onKeyDown`, push wiring in `send()` (+ `compose-strip.test.tsx`).
- No API/backend/route/dependency changes. Prior-change lineage: 260718-dhdj (docked strip), 260801-cyth (per-target persistent drafts — the store this extends), 260802-lj98 (Enter=insert-line matrix).

## Open Questions

- (none — remaining design calls were explicitly delegated to the agent in the discussion and are recorded as graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Recovery over verification: keep a sent-history + one-keystroke recall instead of gating the draft-clear on delivery confirmation; echo-confirmation explicitly deferred | Discussed — user confirmed the decision and rejected the alternative for now | S:95 R:70 A:90 D:95 |
| 2 | Certain | History keyed by `entryKey(server, windowId)` — the draft store's existing target key | User-specified; the store already keys drafts this way | S:95 R:85 A:95 D:95 |
| 3 | Certain | History depth 10 entries per target, newest first | User: "around 10 messages in history" | S:90 R:95 A:90 D:90 |
| 4 | Confident | Adjacent duplicates collapse (pushing text equal to the current newest entry is a no-op) | Explicitly the agent's call in the discussion; re-sends are common (retry after a swallowed send) and must not burn slots | S:65 R:90 A:75 D:70 |
| 5 | Confident | ↑ intercept gate: empty textarea only (or an in-progress recall session); non-empty textarea keeps native cursor movement | User named this the conservative baseline consistent with "up arrow for recovery"; exact gating delegated. First-line gating rejected as a cursor-movement trap in multi-line drafts | S:75 R:85 A:75 D:60 |
| 6 | Confident | Persistence rides a sibling localStorage key `runkit-compose-sent-history`, not the existing `runkit-compose-drafts` schema | Schema choice delegated; a sibling key keeps the shipped draft parser/prune pipeline byte-compatible and isolates corruption | S:70 R:90 A:85 D:65 |
| 7 | Confident | Pruning reuses the draft store's discipline: `MAX_DRAFT_AGE_MS` (7d) age-out, newest-30-targets cap, tolerant-parse hydration, write-through persist | User asked for "the same tolerant-parse hydration posture and pruning discipline"; exact constants delegated — reusing the proven values is the pattern-consistent default | S:80 R:90 A:85 D:75 |
| 8 | Certain | Empty/whitespace-only sends push nothing (the empty-submit bare `\r` never enters history); all three modes (submit/insert/insert-line) push the pre-trailing-byte text before the clear | User-specified | S:90 R:90 A:90 D:90 |
| 9 | Confident | ↓ past the newest entry restores the stashed pre-recall draft and ends the session; editing, sending, or target switch also ends it | User described ↓-returns-to-draft; session-exit triggers are the standard readline/shell recall model | S:75 R:90 A:80 D:70 |
| 10 | Confident | Recall restores text only — attachments are not resurrected (path lines ride the recalled text; `File` objects were revoked at send and are unpersistable) | Follows the store's existing attachment posture (in-memory only, cosmetic loss documented in 260801-cyth) | S:55 R:85 A:80 D:70 |
| 11 | Confident | Test scope: extend the existing colocated unit tests (store + strip keydown); no new Playwright spec required | Unit seams fully cover the behavior (the Enter-matrix precedent); code-quality's e2e SHOULD is satisfied at apply's discretion, with the `.spec.md` companion rule honored if one is added | S:60 R:90 A:75 D:65 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).
