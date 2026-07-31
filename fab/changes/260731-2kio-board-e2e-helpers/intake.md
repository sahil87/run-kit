# Intake: Board E2E Helper Consolidation (_boards.ts)

**Change**: 260731-2kio-board-e2e-helpers
**Created**: 2026-07-31

## Origin

Backlog item `[2kio]` (dedupe sweep 2026-07-31, cluster 9), invoked via `/fab-new 2kio` (one-shot, no prior conversation):

> Consolidate board e2e spec helpers into tests/e2e/_boards.ts (dedupe sweep 2026-07-31, cluster 9; run AFTER the _tmux.ts/_ready.ts e2e-helpers item — same spec files). ~10 board specs in app/frontend/tests/e2e inline `page.request.post(`/api/boards/${board}/pin` or `/unpin`, {data:{server, windowId}})` + ok-assert … Layered API: base pinWindow/unpinWindow(page, board, server, windowId) with ok-assert (all members); layer: a cleanup registry (trackPin + unpinAll(request) for afterAll) needed by board-autofit-style specs. Fold in the small verbatim dupes with the same home: apiBase(baseURL) … and isTerminalsSocket(url) regex … Update sibling .spec.md docs only where steps change. Verify: just test-e2e (board specs; never raw playwright — port isolation).

**Sequencing precondition met**: the backlog gates 2kio on `yc7n` merging first (same spec files; `_boards.ts` builds on the `_tmux.ts`/`_ready.ts` shapes). `yc7n` merged as PR #490 (`5b4f8f11`, origin/main HEAD); the working branch was fast-forwarded onto it before this intake was written, so all file/line references below are post-yc7n.

## Why

1. **Pain point**: after the yc7n consolidation, the board specs still carry three duplicated helper families that yc7n deliberately left for this follow-up:
   - **Pin/unpin API calls** — ~20 inline `request.post(`/api/boards/${board}/pin|/unpin`, { data: { server, windowId } })` + ok-assert sites across 11 spec files, in three call styles (`page.request` relative, `request` fixture relative, `request` fixture with hand-built absolute base URL).
   - **Cleanup registries** — 4+ files re-declare a module-level `pinnedEntries`/`pinned` array plus a best-effort `afterAll` unpin loop. This cleanup is correctness-critical: pinning MOVES a window into a `_rk-pin-<id>` session that persists on the long-lived `rk-test-e2e` tmux server across runs (killing the source session does not reap it), so a spec that forgets the registry pattern leaks stale pin-sessions into later runs.
   - **Small verbatim dupes** — `apiBase(baseURL)` (2 copies) and `isTerminalsSocket(url)` (3 copies — the backlog counted 2; a third appeared in `connection-budget.spec.ts` during the yc7n rewrite, demonstrating the drift this change stops).
2. **Consequence of not fixing**: every new board spec copies one of the three call styles by example; a future pin-API change (e.g. body shape) fans out across ~20 sites; a missed cleanup copy silently pollutes the persistent e2e tmux server.
3. **Approach**: same underscore-helper convention proven by `_ready.ts` and `_tmux.ts` (yc7n) — one `tests/e2e/_boards.ts` module, layered so the base API helpers are universal and the cleanup registry stays opt-in for the specs that need `afterAll` unpin sweeps. Alternatives rejected: putting the pin helpers into `_ready.ts` or `_tmux.ts` (wrong domain — boards are an HTTP-API concern, not readiness or tmux lifecycle); a Playwright fixture (`test.extend`) (heavier than needed; the existing specs use plain module helpers and yc7n set that precedent).

## What Changes

### 1. New helper module `app/frontend/tests/e2e/_boards.ts`

Follows the `_tmux.ts` documentation style (header comment explaining the consolidation and the `_rk-pin-*` persistence hazard). Exports:

```ts
import { expect, type APIRequestContext } from "@playwright/test";

/** A pinned-window identity, as sent to /api/boards/{board}/pin|/unpin. */
export interface PinEntry {
  board: string;
  server: string;
  windowId: string;
}

/** POST /api/boards/{board}/pin with ok-assert (message carries windowId + status). */
export async function pinWindow(
  request: APIRequestContext,
  board: string,
  server: string,
  windowId: string,
): Promise<void>;

/** POST /api/boards/{board}/unpin with ok-assert — for mid-test unpins that are
 *  themselves under test. afterAll cleanup goes through unpinAll instead. */
export async function unpinWindow(
  request: APIRequestContext,
  board: string,
  server: string,
  windowId: string,
): Promise<void>;

// ---- opt-in cleanup-registry layer (board-autofit-style specs) ----

/** Record a pin for afterAll cleanup. Module-level registry — Playwright runs
 *  each spec file in its own worker, so state is naturally per-file. */
export function trackPin(entry: PinEntry): void;

/** Best-effort unpin of every tracked entry (try/catch per entry, matching the
 *  existing per-file loops), then clears the registry. */
export async function unpinAll(request: APIRequestContext): Promise<void>;

// ---- verbatim-dupe fold-ins with the same home ----

/** baseURL ?? `http://localhost:${RK_PORT ?? 3020}` (board-reorder/-list-reorder copies). */
export function apiBase(baseURL: string | undefined): string;

/** True for the terminals mux URL: /\/ws\/terminals(\?|$)/ . */
export function isTerminalsSocket(url: string): boolean;
```

Behavioral notes (verbatim from the existing copies — this is a behavior-preserving extraction):

- `pinWindow`/`unpinWindow` take an `APIRequestContext` (callers pass `page.request` or the `request` fixture) and use **relative paths** — `playwright.config.ts` always sets `use.baseURL` (`http://localhost:${RK_PORT ?? 3333}`), so both context kinds resolve them. The ok-assert mirrors the best existing message form: `expect(res.ok(), \`pin ${windowId} → ${res.status()}\`).toBeTruthy()`.
- `unpinAll` is best-effort (try/catch per entry) and finishes with `registry.length = 0`, exactly like the existing `afterAll` loops. Entries carry `board` because `board-autofit.spec.ts` pins onto two boards (BOARD_A/BOARD_B) behind one registry.
- No convenience `pinTracked` combo is added — call sites compose `pinWindow` + `trackPin` explicitly, keeping the layer boundary visible.

### 2. Migrate the 11 board-adjacent specs

All in `app/frontend/tests/e2e/` (line refs post-yc7n). Inline `GET /api/boards*` assertions stay inline — the listing/entries contract is the thing under test there, not shared plumbing.

| Spec | What migrates |
|------|---------------|
| `boards-pin-flow.spec.ts` | pin :27 (+ later pins) → `pinWindow` |
| `board-autofit.spec.ts` | local `pin()` (:37) + `pinned[]` + afterAll loop (:79–88) → `pinWindow` + `trackPin` + `unpinAll`; mid-test unpin ok-asserts (:159/:203/:250/:255) → `unpinWindow` |
| `boards-desktop-suspend.spec.ts` | `isTerminalsSocket` :16–18; pin loop :62 + `pinnedEntries` + afterAll :34–43 → registry layer |
| `boards-same-session-multi-pane.spec.ts` | `isTerminalsSocket` :25–27; pin :80, mid-test unpin :112 → base helpers |
| `boards-mobile.spec.ts` | pin :63 + `pinnedEntries` :7 + afterAll :13–28 → registry layer |
| `boards-multi-server.spec.ts` | pins :51/:56 (servers A/B) + `pinnedEntries` + afterAll :23–37 → registry layer |
| `board-reorder.spec.ts` | `apiBase` :7–9 → import; pins :47 → `pinWindow` (relative path via `request` fixture) |
| `board-list-reorder.spec.ts` | `apiBase` :24–26 → import; pin :91 → `pinWindow` |
| `board-close-and-unpin.spec.ts` | pins :29/:72/:114/:179 → `pinWindow` (unpins here are UI-driven or awaited requests — stay inline) |
| `compose-strip.spec.ts` | pin loop :228 → `pinWindow` |
| `connection-budget.spec.ts` | `isTerminalsSocket` :31–33; pin :150, cleanup unpin :167 → base helpers |

Migration is mechanical and behavior-preserving: no spec gains or loses cleanup semantics (specs without a registry today — e.g. `compose-strip`, `boards-pin-flow`, `board-close-and-unpin` — do not adopt one; their pins are reaped by each test's own unpin flow or the `global-teardown.ts` server-socket kill, as today).

### 3. `.spec.md` companion docs

Update only where a test's *steps* change (constitution § Test Companion Docs). Helper extraction leaves what-it-proves and step sequences unchanged, so most companions need no edit — same posture PR #490 took for the `_tmux.ts` migration.

### 4. Verification

`just test-e2e` scoped to the affected board specs (e.g. `just test-e2e boards-pin-flow board-autofit …`), then a full `just test-e2e` if scoped runs pass. Never raw `playwright`/`just pw` (port isolation; `just pw` is additionally poisoned by `RK_PORT=3000` in this environment). e2e is a box-wide mutex (port 3020 + the `rk-test-e2e` tmux server are shared across all worktrees) — do not overlap runs with any other agent's e2e verification.

## Affected Memory

- `run-kit/architecture`: (modify) extend the "Playwright E2E Tests" helper-module inventory (currently `_tmux.ts`, `_ready.ts`, `_state-socket-mock.ts`) with `_boards.ts` — exports, the opt-in registry layer, and the `_rk-pin-*` persistence rationale for `unpinAll`.

## Impact

- **Test-only change** — no production code, no API surface, no user-visible behavior. `source_paths` includes `app/frontend/tests/` via `app/frontend/src/`-adjacent test tree; true impact is `app/frontend/tests/e2e/` only.
- 1 new file (`_boards.ts`), 11 spec files edited, net deletion expected (~150+ lines of duplication removed).
- Risk: board e2e specs are the flakiest suite family (connection-pool budget, suspension) — behavior-preserving extraction plus scoped `just test-e2e` runs keep the diff auditable per spec.

## Open Questions

- None — the backlog entry specifies the layered API, the fold-ins, the file set, and the verification path; the post-yc7n codebase was surveyed directly while writing this intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New helpers live in `app/frontend/tests/e2e/_boards.ts` (underscore-helper convention) | Backlog names the file; matches `_ready.ts`/`_tmux.ts` precedent | S:95 R:90 A:100 D:95 |
| 2 | Confident | `pinWindow`/`unpinWindow` accept an `APIRequestContext` (not `Page`) and use relative paths | Backlog wrote `(page, …)` loosely, but afterAll hooks have no `page`, `unpinAll(request)` already needs the context, and `playwright.config.ts` always sets `baseURL` so relative paths resolve for both context kinds | S:55 R:90 A:85 D:70 |
| 3 | Certain | Base helpers ok-assert; `unpinAll` is best-effort try/catch that clears the registry | Backlog: "ok-assert (all members)"; every existing afterAll loop is try/catch + `length = 0` | S:80 R:92 A:90 D:85 |
| 4 | Confident | Registry is module-level state in `_boards.ts` (`trackPin` + `unpinAll`), entries carry `board` | Playwright isolates spec files per worker, so module state is per-file — same shape as today's per-file arrays; `board-autofit` needs two boards in one registry | S:65 R:88 A:80 D:70 |
| 5 | Certain | `isTerminalsSocket` migrates 3 copies (desktop-suspend :16, same-session-multi-pane :25, connection-budget :31), not the backlog's 2 | Direct grep of post-yc7n tree; connection-budget grew a copy in the #490 rewrite | S:80 R:95 A:95 D:90 |
| 6 | Confident | Behavior-preserving scope: specs without a cleanup registry today do not adopt one | Backlog frames the registry as the opt-in layer "needed by board-autofit-style specs"; adding new cleanup semantics would change behavior under a consolidation change | S:55 R:85 A:70 D:60 |
| 7 | Certain | `.spec.md` companions updated only where steps change; verification via `just test-e2e` only, serialized against other agents | Backlog states both; constitution § Test Companion Docs; e2e mutex note in backlog § operator notes | S:85 R:90 A:95 D:90 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
