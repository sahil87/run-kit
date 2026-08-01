# Intake: Per-Target Persistent Compose Drafts

**Change**: 260801-cyth-per-target-persistent-compose-drafts
**Created**: 2026-08-01

## Origin

Conversational (`/fab-discuss` session). The user's request:

> Another change - I don't wnat to lost messages that I type on the Componse input box, even if I refresh the page for any reason. Persist using localStorage or some other technique that survives refresh. Also - you should remember the Compose input on a per window (or a per URL) basis - moving back to a different page should rememeber its compose input separately. Compose input should not "travel" with the current page like it does now.

The agent recommended keying drafts by **send target** (`server + windowId`) rather than URL, persisting **text only** to localStorage, and deleting the now-unnecessary re-home machinery; the user proceeded to draft without objection.

## Why

1. **Pain point — refresh loss**: the compose draft lives in a module-level store (`compose-draft-store.ts`) that survives strip toggle-off and route navigation but dies on page refresh. A long half-written prompt to an agent is lost to an accidental ⌘R, a PWA reload, or a dev-server restart.
2. **Pain point — the traveling draft**: there is exactly ONE global draft. Composing a message for window A, then navigating to window B, shows A's draft aimed at B — the draft "travels" with the user instead of staying with its addressee. This is also the root cause of the re-home machinery's existence (attachments re-uploaded whenever the focused target changes).
3. **If unfixed**: draft loss keeps punishing exactly the long, carefully-composed prompts the strip exists for; the wrong-target draft remains a footgun the `→ {window}` label only partially mitigates.
4. **Why this approach**: keying by send target (not URL) matches the strip's live-target send model — on terminal routes target and URL are equivalent, and on boards per-URL would keep one draft on screen while pane focus cycles (the exact wrong-pane-send risk). Per-target also makes attachment re-homing structurally impossible, deleting a whole failure path.

## What Changes

### 1. Draft store: single slot → keyed map (`app/frontend/src/lib/compose-draft-store.ts`)

The module store's single `{text, attachments}` slot becomes a **Map keyed by the send-target key** — the existing `entryKey(server, windowId)` from `@/store/window-store` (the same key `focusedKey()` in `compose-strip.tsx` already computes). API shape (contract, not prescription):

- `getComposeDraft(key)` / `subscribeComposeDraft` — snapshot + subscribe per the existing `useSyncExternalStore` seam; stable snapshot identity per key while unchanged.
- `setComposeText(key, next)`, `setComposeAttachments(key, next)`, `clearComposeDraft(key)` — all writes are key-scoped. Clear-after-send clears only that target's draft.
- The strip resolves the key from the live focused target each render; **no target → strip disabled, no draft displayed** (unchanged disabled state).

### 2. Persistence: text-only, localStorage

- One localStorage key **`runkit-compose-drafts`** holding a JSON map `{ [entryKey]: { text: string, updatedAt: number } }`.
- **Write-through on store commit** (a short debounce, ~300ms, is acceptable but not required — drafts are small).
- **Hydration on module load**: seed the in-memory map from localStorage (tolerant parse — malformed JSON degrades to empty, mirroring `parseOverrides` in `keybindings.ts`).
- **Pruning on write**: delete entries whose text is empty; cap at the ~30 most-recent by `updatedAt`; drop entries older than ~7 days. (Exact caps are low-stakes tunables — tmux window IDs are reused after a server restart, so aging out stale drafts matters.)
- **Multi-tab**: last-write-wins; no `storage`-event sync in v1.
- localStorage (not sessionStorage — must survive browser restart too; not IndexedDB — see attachments below).

### 3. Attachments: per-key in memory, NOT persisted

`File` objects cannot go to localStorage. Uploads are **eager** (already on the target worktree's disk at attach time) and their path lines live in the draft **text**, which persists. After a refresh: preview thumbnails and × remove chips are gone, but the path lines and the uploaded files survive — sending still works. IndexedDB `File` persistence is deliberately out of scope (real complexity, cosmetic benefit). Blob-URL lifecycle stays per-mount as today.

### 4. Delete the re-home machinery (`app/frontend/src/components/compose-strip.tsx`)

With drafts bound to their target, an attachment can never face a different worktree than it was uploaded to. Remove:

- the target-change re-home effect (the `lastTargetKeyRef` effect: re-upload of held Files, `rewritePathLine`, the cancelled-async guard),
- its non-blocking `role="alert"` error state and the `compose-strip-error` UI for re-home failures (keep the element only if other errors use it — currently re-home is its sole writer, so it goes),
- the doc-comment paragraphs describing re-homing.

`rewritePathLine` survives only if still used by `removeFile`'s path-line splice (it is separate — `removeFile` has its own splice; verify and remove dead code).

### 5. Behavioral consequences (intentional)

- **Board panes**: cycling pane focus swaps the visible draft (draft follows target). This is the designed behavior, not a bug.
- The same window's draft appears whether reached via its terminal route or a board pane; drafts survive window renames (`windowId` is tmux-stable).
- **Reverses intake §7/R2 of 260718-dhdj** ("draft travels across route navigation"): the draft now stays with its target. All doc comments in `compose-draft-store.ts` and `compose-strip.tsx` describing the single-global-draft/travel model MUST be rewritten to the per-target model.

### 6. Tests + companion docs

- `compose-draft-store` unit tests: keyed isolation, persistence round-trip, tolerant parse, pruning (empty/cap/age), clear-per-key.
- `compose-strip.test.tsx`: target-switch shows the new target's draft; send clears only that draft; disabled no-target state.
- `tests/e2e/compose-strip.spec.ts`: the existing draft-survives-navigation assertions change meaning — update to assert per-target recall (navigate away, draft hidden; navigate back, draft restored) and refresh survival. Constitution: sibling `.spec.md` updated in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) compose strip draft model — per-target keyed store, localStorage persistence, re-home machinery removal

## Impact

- `app/frontend/src/lib/compose-draft-store.ts` — store rework (single slot → keyed map + persistence layer)
- `app/frontend/src/components/compose-strip.tsx` — key-scoped store calls, re-home deletion, doc comments
- `app/frontend/src/components/board-page.tsx` footer mount — no structural change expected (store is module-level), verify only
- Unit tests + `tests/e2e/compose-strip.spec.ts` + `.spec.md`
- No backend, no API. Frontend store + one component.
- **Coordination note**: `260801-hsxm-compose-enter-policy-readline-keys` also edits `compose-strip.tsx` (the `onKeyDown`/Enter layer — a different region than the store/re-home edits). Parallel execution is feasible; expect a small merge at integration.

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Drafts keyed by send target `entryKey(server, windowId)`, not by URL | Recommended with board-pane rationale (per-URL recreates the wrong-pane-send risk); user proceeded to draft without objection | S:80 R:70 A:85 D:75 |
| 2 | Confident | Text-only persistence; attachments stay in-memory per key | `File` objects can't reach localStorage; eager uploads + persisted path lines make loss cosmetic (previews only) | S:70 R:80 A:90 D:80 |
| 3 | Confident | localStorage over sessionStorage/IndexedDB | User named localStorage; survives browser restart; IndexedDB complexity unjustified | S:85 R:85 A:90 D:85 |
| 4 | Confident | Re-home machinery (effect + error path) is deleted | Per-target binding makes cross-worktree attachments impossible; presented to user without objection | S:70 R:65 A:90 D:85 |
| 5 | Confident | Prune policy: drop empty, keep newest ~30, drop >7 days | Exact caps are low-stakes tunables, easily adjusted; some pruning is required (tmux id reuse) | S:50 R:95 A:80 D:70 |
| 6 | Confident | Multi-tab is last-write-wins; no `storage`-event sync in v1 | Two tabs composing to the same window is rare; sync adds moving parts for marginal benefit | S:55 R:90 A:80 D:75 |
| 7 | Certain | Reversal of 260718-dhdj §7/R2 is intentional and must be reflected in e2e specs, `.spec.md`, and doc comments in the same change | Discussed explicitly as the honest caveat; constitution requires companion-doc same-commit updates | S:90 R:80 A:95 D:90 |
| 8 | Confident | Board pane-focus cycling swaps the visible draft | Direct consequence of per-target keying; flagged to user as the designed behavior | S:75 R:80 A:90 D:85 |

8 assumptions (1 certain, 7 confident, 0 tentative, 0 unresolved).
