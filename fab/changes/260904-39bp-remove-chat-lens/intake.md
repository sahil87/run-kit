# Intake: Remove Chat Lens

**Change**: 260904-39bp-remove-chat-lens
**Created**: 2026-09-04

## Origin

Promptless dispatch (`/fab-proceed` create-new path, `{questioning-mode} = promptless-defer`) from a synthesized user-conversation description. The user decided on **full deletion** of the chat lens rather than a dormant availability-kill; a prior partial attempt (`260904-zw1w-kill-chat-lens-availability`) was discarded at the user's instruction and this change starts fresh.

> Remove the chat lens (ChatView) entirely — kill every entrance and delete the dead wing, in one change. ChatView is a half-built WIP lens. Change 260812-0c6o made it rail-hidden (`SURFACE_RAIL_HIDDEN`), but users still land in it accidentally and exiting is a hassle (palette-only exit; the shared `@rk_win_layout` tmux option persists `single:chat` for every viewer). The compose strip has won the "answer the agent" role.

**Rejected alternatives** (from the conversation):
- Availability-kill only / keeping the code dormant — user chose full deletion.
- Deleting `app/backend/internal/chat` wholesale — impossible; it has shared consumers (operator actuation, fork/resume, auto-name).

## Why

1. **Pain point**: ChatView is a half-built lens users land in accidentally. Once in it, exiting is a hassle — the exit is palette-only, and the shared `@rk_win_layout` tmux option persists `single:chat` for *every* viewer of that window, so one viewer's accidental entry traps all viewers. Three navigation paths still deep-link into it (`?view=chat`): the sidebar waiting-badge click, the `Agent: Next waiting` palette action, and the Web Push notification URL.
2. **Consequence of not fixing**: a dead-end WIP surface keeps receiving traffic from the highest-urgency flows in the product (an agent is waiting — click — land in a broken lens), and ~2k+ lines of frontend + backend code (lens, WS subscription kind, backfill/send endpoints, tests) rot unmaintained.
3. **Why full deletion over dormancy**: the compose strip has definitively won the "answer the agent" role, so the lens has no future; dormant code would still carry the `SurfaceKind`/`ViewName` members, the WS subscription kind, and two HTTP endpoints, all needing maintenance for zero user value. Shared infrastructure the lens sat on (`internal/chat` transcripts/adapters, `internal/inject`) is explicitly kept — it serves operator actuation, fork/resume, and auto-name.

## What Changes

### Part 1 — Kill every entrance

**1a. Lens/tile availability** — `chat` is removed from both availability functions:
- `availableViews` in `app/frontend/src/lib/window-view.ts` (line ~116: `if (hasChat(win)) views.push("chat")`) — delete the branch and the `"chat"` member of `ViewName` (line 24) and `HINT_ORDER` (line 53).
- `availableTiles` in `app/frontend/src/lib/surface-layout.ts` (line ~210: `if (hasChat(win)) tiles.push("chat")`) — delete the branch, the `"chat"` member of `SURFACE_KINDS` / `SurfaceKind` (via `ViewName`), the `chat` entries in `SURFACE_LABEL` ("Chat") and `SURFACE_GLYPH` ("⌸"), and `SURFACE_RAIL_HIDDEN` entirely (its only member was `chat`; delete the set and its render-time consumers).

**1b. Persisted-layout healing** — the shared `@rk_win_layout` option may hold `single:chat` (the trap this change fixes) or a multi-tile layout containing `chat`. Once `chat` leaves `SURFACE_KINDS`, `isSurfaceKind("chat")` is false, so `parseLayout` returns `null` for any stored layout containing it, and the existing fallback path lands on `single:tty` — verified against current code (`parseLayout` line ~176 rejects unknown parts; the read path at line ~247/253 documents the `single:tty` fallback). No active tmux-option migration/sweep is added; healing is parse-time, and the stale option value is overwritten on the next layout write. (See Assumptions #7 for the multi-tile nuance.)

**1c. Drop `?view=chat` at all three navigation sites** — waiting-badge and push clicks land on the plain terminal route (tty is where the compose strip answers the agent):
- **Sidebar waiting-badge click** and **`Agent: Next waiting` palette action**: both flow through `chatSearchForTarget(hasChat)` in `app/frontend/src/lib/palette/agent-nav.ts` (line 50), called from `navigateToWaitingTarget` in `app/frontend/src/app.tsx` (line ~3781) and the next-waiting handler (line ~3845/3856). Delete `chatSearchForTarget` and the `hasChat` plumbing through `navigateToWaitingTarget` / the `chatByKey` lookup; navigation targets the plain `/{server}/{window}` route with empty search. Update the extensive `?view=chat`-preservation comments in `app.tsx` (lines ~1457, ~1873, ~3756-3762, ~4257, ~4305-4334) and `waiting-badge.tsx` (line 31) that narrate the old deep-link contract.
- **Push-notification deep link**: `app/backend/api/waiting_push.go` — the URL builder (line ~55: `return base + "?view=chat"`) drops the chat branch and always returns the plain window URL; the chat-capability (`chatProvider`) lookup that fed the branch goes with it. Tests asserting `?view=chat` URLs update to plain URLs: `api/waiting_push_test.go` (lines ~197-236) and the opaque fixture strings in `api/sse_test.go` (lines 816, 834).

**1d. Legacy `?view=chat` shim** — `translateLegacyParams` / `validateTerminalSearch` (consumed in `app.tsx` lines ~823, ~843) must stop producing a chat layout: a legacy `view=chat` param degrades to tty (i.e., the chat mapping is removed; unknown/removed values fall through to the default). `?view=web` / `?view=code` mappings are unchanged.

### Part 2 — Delete the dead wing

**Frontend deletions:**
- `app/frontend/src/components/chat-view.tsx` (incl. `ChatSendForm`) + `chat-view.test.tsx`
- `app/frontend/src/hooks/use-chat-subscription.ts` + `use-chat-subscription.test.tsx`
- `app/frontend/src/lib/chat-stream.ts` + `chat-stream.test.ts`
- `app/frontend/tests/e2e/chat-view.spec.ts` (the lens's e2e spec)
- In `app/frontend/src/app.tsx`: the chat subscription bundle (`useChatSubscription` import line 92; `chatViewActive` / `chatStream` lines ~2092-2095) and the connection-dot chat branch — `dotConnected = chatViewActive ? chatStream.connected : isConnected` (line ~4358) collapses to plain `isConnected`.
- `hasChat` in `window-view.ts` (line 83) — deletable: after this change its only consumers (`availableViews`, `availableTiles`, the waiting-nav plumbing) are gone; the remaining references in `right-panel.ts` (line 37) and `surface-layout.ts` (line 20) are doc comments to update.
- `View: Chat` palette label in `app/frontend/src/lib/palette/view.ts` (line 29); the `Tile: Show Chat` / `Tile: Hide Chat` entries are generated from `SURFACE_LABEL`, so they disappear with the `SurfaceKind` member — their tests in `lib/palette/layout.test.ts` (line ~86) and any chat rows in `view.test.ts` / `agent-nav.test.ts` / `window-view.test.ts` / `surface-layout` tests update or delete accordingly.
- `sendChatMessage` / `getWindowChat` client functions in `app/frontend/src/api/client.ts` (lines ~421, ~447) + their `client.test.ts` coverage.

**Backend deletions:**
- `app/backend/api/chat.go` (backfill + send endpoints: `handleChatBackfill`, `handleChatSend`) and tests `api/chat_test.go`, `api/chat_send_test.go`.
- `app/backend/api/chat_ws.go` (the `kind:"chat"` state-socket subscription/tail) and `api/chat_ws_test.go`; the `kindChat` constant and its dispatch in `api/state_ws.go` (line ~60).
- Route registrations in `api/router.go` (lines 827-828: `r.Get("/api/windows/{windowId}/chat", ...)`, `r.Post("/api/windows/{windowId}/chat/send", ...)`).
- Note: `api/operator.go` line ~627 carries a comment "see handleChatSend" — update the comment; the operator's injection logic itself is untouched.

### MUST KEEP — shared infrastructure (do NOT delete)

- **`app/backend/internal/chat` package** (TranscriptPath, schema, adapter registry) — consumed by operator actuation (`api/operator.go` transcript feeds), fork/resume (`api/fork.go`, riff `ResumeSessionRef`, `internal/riff/shell.go`), and auto-name dispatch (`api/auto_name.go` requires ChatSessionRef). Verified consumers: `operator.go`, `fork.go`, `internal/riff/shell.go` import it today.
- **`app/backend/internal/inject`** (injection engine + its tests) — used by `api/send.go` and `api/operator.go`.
- **`classifyComposeEnter`'s `"chat"` `ComposeSurface`** in `app/frontend/src/lib/compose-keys.ts` (line 42) — the compose strip's selection-broadcast mode passes surface `"chat"` (`compose-strip.tsx` ~line 717). The classifier and both its policies stay; the surface name stays `"chat"` (renaming to e.g. `"broadcast"` was deferred by the user — default is keep).
- **`@rk_pane_chat` pane option** (`ChatOption`, `internal/tmux/tmux.go` line 531) and the `chatProvider`/`chatSessionRef` fields on the backend `Window`/`Pane` structs (`tmux.go` lines ~709-741) and frontend `WindowInfo` (`types.ts` lines ~179-186) — they gate operator features (fix-name/annotate palette + flyout gates), not just the lens.

### Non-goals / out of scope

- The CI flaky tests `TestWaitingPushBroadcastsNotifyEvent` (`api/waiting_push_test.go`, TempDir cleanup race) and `TestSnapshotterStartStopsWithContext` — a separate future fix. (The waiting-push test's asserted `?view=chat` URL *will* change in this change, but the cleanup race itself is not addressed here.)
- Renaming the kept `ComposeSurface` `"chat"` value — deferred; keep the name.
- Any change to the kept `internal/chat` / `internal/inject` packages beyond compile-neutral touch-ups forced by deleted callers (none expected — the deleted endpoints are leaf consumers).

## Affected Memory

- `run-kit/ui/chat-view`: (remove) the chat lens memory retires with the lens
- `run-kit/ui/lenses-and-layout`: (modify) chat leaves the lens/tile taxonomy, `SURFACE_RAIL_HIDDEN` gone, layout healing note
- `run-kit/chat`: (modify) the send/WS/backfill halves go; the transcript/schema/adapter half stays (shared consumers)
- `run-kit/api-and-sockets`: (modify) `kind:"chat"` state-socket subscription and the two chat HTTP routes removed
- `run-kit/ui/keyboard-and-palette`: (modify) `View: Chat` / `Tile: Show|Hide Chat` entries removed
- `run-kit/pwa-and-push`: (modify) push notify URL is now always the plain window URL (no `?view=chat` branch)
- `run-kit/ui/status-signals`: (modify) waiting-badge click behavior (plain terminal route; connection-dot chat branch gone)
- `run-kit/ui/sidebar`: (modify) waiting-badge navigation contract

Spec impact (human-curated — note the drift, do not rewrite in-pipeline): `docs/specs/window-views.md` and `docs/specs/surface-layout.md` describe the chat lens.

## Impact

- **Frontend** (`app/frontend/src/`): `lib/window-view.ts`, `lib/surface-layout.ts`, `lib/palette/agent-nav.ts`, `lib/palette/view.ts`, `lib/compose-keys.ts` (comments only), `app.tsx`, `api/client.ts`, `components/waiting-badge.tsx` (comment), deletions of `components/chat-view.tsx`, `hooks/use-chat-subscription.ts`, `lib/chat-stream.ts` + all colocated tests + `tests/e2e/chat-view.spec.ts`.
- **Backend** (`app/backend/`): deletions of `api/chat.go`, `api/chat_ws.go` + 3 test files; edits to `api/router.go`, `api/state_ws.go`, `api/waiting_push.go` + `waiting_push_test.go`, `api/sse_test.go` fixture strings, `api/operator.go` comment. `internal/chat`, `internal/inject`, `internal/tmux` chat fields untouched.
- **Behavioral contract change**: `?view=chat` URLs (bookmarks, stale push notifications) degrade to the plain terminal view; stored `single:chat` layouts heal to `single:tty` on next load; the `kind:"chat"` WS subscribe becomes unknown (SPA is embedded and versioned with the server, so no client-skew concern).
- **Verification gates**: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test`; `just build`.
- Starting state note: worktree is clean; HEAD is 408a8def (ahead of the dd46311c baseline named in the conversation); the discarded zw1w change folder is gone.

## Open Questions

- None — the originating conversation resolved every scope decision; see `## Assumptions` for the graded record (including the user-deferred compose-surface rename, kept at its stated default).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Full deletion of the chat lens (frontend + backend endpoints), not an availability-kill or dormant code | Discussed — user explicitly chose full deletion; dormancy and availability-kill recorded as rejected alternatives | S:95 R:70 A:95 D:95 |
| 2 | Certain | Keep `internal/chat` and `internal/inject` packages intact | Discussed + verified: `operator.go`, `fork.go`, `riff/shell.go`, auto-name consume `internal/chat`; `send.go`/`operator.go` consume `inject` | S:95 R:80 A:95 D:95 |
| 3 | Certain | Waiting-badge, `Agent: Next waiting`, and push deep-links land on the plain terminal route (no search params); the push URL builder's `chatProvider` branch is removed with it | Discussed — "tty is where the compose strip answers the agent"; all three sites named by the user | S:95 R:90 A:90 D:90 |
| 4 | Certain | Keep `@rk_pane_chat`, `ChatOption`, and `chatProvider`/`chatSessionRef` on backend `Window`/`Pane` and frontend `WindowInfo` | Discussed + verified: they gate operator fix-name/annotate features, not just the lens | S:95 R:85 A:90 D:90 |
| 5 | Certain | Delete `hasChat` from `window-view.ts` | Verified: after this change no keeper consumes it — remaining mentions in `right-panel.ts`/`surface-layout.ts` are doc comments | S:80 R:90 A:90 D:85 |
| 6 | Certain | Connection dot collapses to plain `isConnected` (the `chatViewActive ? chatStream.connected : ...` branch is deleted) | Direct consequence of removing the chat subscription bundle; single obvious form | S:85 R:95 A:95 D:90 |
| 7 | Confident | Layout healing is parse-time only: stored layouts containing `chat` fail `isSurfaceKind` → `parseLayout` returns null → existing `single:tty` fallback; no tmux-option migration sweep; a multi-tile layout containing chat degrades whole to `single:tty` rather than preserving sibling tiles | Verified the fallback path exists and covers `single:chat` (the actual trap); multi-tile-with-chat is rare (chat was rail-hidden, palette-only). Alternative — recognize `chat` as a legacy token and filter it, preserving siblings — is available if review prefers it | S:60 R:85 A:75 D:50 |
| 8 | Certain | Keep the `ComposeSurface` value `"chat"` in `compose-keys.ts` (no rename to e.g. `"broadcast"`); classifier and both policies stay | Discussed — user deferred the rename with an explicit default of keeping the name; candidate follow-up change | S:85 R:95 A:85 D:80 |
| 9 | Certain | Legacy `?view=chat` shim (`translateLegacyParams`/`validateTerminalSearch`) degrades to tty; `web`/`code` mappings unchanged | Stated requirement; single obvious implementation (remove the chat mapping, fall through to default) | S:80 R:90 A:85 D:85 |
| 10 | Certain | Spec drift in `docs/specs/window-views.md` / `docs/specs/surface-layout.md` is noted (hydrate/PR note), not rewritten by the pipeline | Project convention: specs are human-curated; the intake records the drift per that convention | S:75 R:90 A:85 D:80 |
| 11 | Confident | `api/sse_test.go` fixture strings embedding `?view=chat` (lines 816/834 — opaque notify payloads) update to plain URLs | Not strictly required (opaque test data), but "kill every entrance" implies no `view=chat` residue; trivially reversible | S:55 R:95 A:85 D:70 |
| 12 | Certain | The flaky `TestWaitingPushBroadcastsNotifyEvent` TempDir race and `TestSnapshotterStartStopsWithContext` are out of scope (only the asserted URL string changes here) | Discussed — user explicitly scoped these to a separate future fix | S:90 R:90 A:90 D:90 |

12 assumptions (10 certain, 2 confident, 0 tentative, 0 unresolved).
