# Plan: Remove Chat Lens

**Change**: 260904-39bp-remove-chat-lens
**Intake**: `intake.md`

## Requirements

### Frontend: Lens/tile availability

#### R1: `chat` leaves the lens and tile registries
The `ViewName` union in `app/frontend/src/lib/window-view.ts` SHALL no longer carry `"chat"`; `HINT_ORDER`, `availableViews`, and the `hasChat` predicate SHALL be removed accordingly (`hasChat` is deleted outright — after this change nothing consumes it). In `app/frontend/src/lib/surface-layout.ts`, `SURFACE_KINDS`, `SURFACE_LABEL`, `SURFACE_GLYPH` (`⌸`), and `availableTiles` SHALL lose their `chat` members, and the `SURFACE_RAIL_HIDDEN` set SHALL be deleted entirely (its only member was `chat`) along with its render-time consumers (the surface-toggle group filter). The `ViewWindow` structural type drops its now-unused `chatProvider?` field; the `WindowInfo` type in `types.ts` KEEPS `chatProvider`/`chatSessionRef` (operator gates consume them — R8).

- **GIVEN** a window whose pane carries `@rk_pane_chat` (a `chatProvider`)
- **WHEN** `availableViews(win)` / `availableTiles(win)` run
- **THEN** neither returns `chat`; the palette emits no `View: Chat` / `Tile: Show Chat` entries and the surface-toggle group renders exactly as before (chat was already rail-hidden).

#### R2: Persisted chat layouts heal to `single:tty`
A stored `@rk_win_layout` containing `chat` (e.g. `single:chat`, `split-h:chat,tty`) SHALL fail `parseLayout` (the `chat` part is no longer a `SurfaceKind`), so `effectiveLayout` falls back to `single:tty`. No tmux-option migration or sweep is added — healing is parse-time; the stale value is overwritten on the next layout write.

- **GIVEN** a window whose `@rk_win_layout` reads `single:chat`
- **WHEN** `effectiveLayout(win)` runs
- **THEN** it returns `{ shape: "single", order: ["tty"] }` and no chat tile renders.
- **AND GIVEN** a stored `split-h:chat,tty`, **THEN** the whole value degrades to `single:tty` (parse-reject, not member filtering — see Assumptions #2).

### Frontend: Navigation entrances

#### R3: Waiting navigation lands on the bare terminal route
`chatSearchForTarget` in `app/frontend/src/lib/palette/agent-nav.ts` SHALL be deleted. `navigateToWaitingTarget` in `app/frontend/src/app.tsx` and both its callers (the sidebar waiting-badge click handler and the `Agent: Next waiting` palette action) SHALL navigate with empty search — the `hasChat` plumbing and `chatByKey`/`chatProvider` lookups feeding it go with it. The `?view=chat`-preservation narration in `app.tsx` comments and `components/waiting-badge.tsx` SHALL be updated to the new contract (comments state constraints, not history).

- **GIVEN** a session with waiting windows whose panes carry `chatProvider`
- **WHEN** the user clicks the sidebar waiting badge (or runs `Agent: Next waiting`)
- **THEN** the app navigates to `/{server}/{windowId}` with no search params and the window renders its own shared layout.

#### R4: Legacy `?view=chat` degrades to the default
`validateTerminalSearch` in `app/frontend/src/lib/router-url.ts` SHALL drop `"chat"` from its accepted `view` union (accepting `web`/`code` only, unchanged otherwise). A legacy `?view=chat` deep link is therefore dropped at validation (treated as absent, never errored), so the one-shot translation never produces a chat layout and the window renders its stored/default layout.

- **GIVEN** a bookmark `/{server}/{window}?view=chat`
- **WHEN** the route validates its search
- **THEN** the `view` param is dropped, the URL is cleaned to the bare route, and the terminal renders (no chat layout is written to `@rk_win_layout`).
- **AND GIVEN** `?view=web` or `?view=code`, **THEN** behavior is unchanged.

### Backend: Push deep link

#### R5: Push notification URLs are always the plain window URL
The waiting-push URL builder in `app/backend/api/waiting_push.go` SHALL always return the bare `/{server}/{windowNumber}` URL — the `?view=chat` branch and the `chatProvider` capability lookup feeding it are removed. `api/waiting_push_test.go` assertions and the opaque `?view=chat` fixture strings in `api/sse_test.go` SHALL be updated to plain URLs. (The known TempDir cleanup flake in `waiting_push_test.go` is out of scope — only asserted URL strings change.)

- **GIVEN** a window entering the waiting state with a chat-capable pane
- **WHEN** the notify payload is built
- **THEN** its URL is `/{server}/{n}` with no query string.

### Frontend: Dead-wing deletion

#### R6: The chat lens frontend is deleted
These SHALL be deleted: `app/frontend/src/components/chat-view.tsx` (incl. `ChatSendForm`) + `chat-view.test.tsx`, `app/frontend/src/hooks/use-chat-subscription.ts` + `use-chat-subscription.test.tsx`, `app/frontend/src/lib/chat-stream.ts` + `chat-stream.test.ts`, and `app/frontend/tests/e2e/chat-view.spec.ts`. In `app.tsx`: the `useChatSubscription` owner-hook bundle (`chatViewActive`, `chatStream`), the chat tile mount in the `SurfaceLayout` renderer, and the connection-dot branch (`dotConnected = chatViewActive ? chatStream.connected : isConnected` collapses to `isConnected`). The `chat` entry leaves `VIEW_ACTION_LABEL` in `lib/palette/view.ts`. The `sendChatMessage`/`getWindowChat` client functions leave `src/api/client.ts` with their `client.test.ts` coverage. Chat rows in `window-view.test.ts`, `surface-layout` tests, `palette/layout.test.ts`, `palette/view.test.ts`, `palette/agent-nav.test.ts`, `app.test.tsx`, and other touched test files update or delete accordingly.

- **GIVEN** the frontend source tree after this change
- **WHEN** grepping `app/frontend/src` and `app/frontend/tests` for `ChatView`, `useChatSubscription`, `chat-stream`, `sendChatMessage`, `getWindowChat`, `view=chat`, `single:chat`
- **THEN** no functional references remain (the kept `ComposeSurface` `"chat"` value in `lib/compose-keys.ts` and the kept `chatProvider`/`chatSessionRef` `WindowInfo` fields are the only surviving `chat` identifiers, per R8).

### Backend: Dead-wing deletion

#### R7: The chat endpoints and WS subscription kind are deleted
These SHALL be deleted: `app/backend/api/chat.go` (`handleChatBackfill`, `handleChatSend`, `injectChatMessage`, `resolveWindowChat` if chat-only — verify remaining consumers before removing shared helpers), `api/chat_test.go`, `api/chat_send_test.go`, `api/chat_ws.go` (the `kind:"chat"` producer), `api/chat_ws_test.go`. The `kindChat` constant and its dispatch arm leave `api/state_ws.go`. The two route registrations (`GET /api/windows/{windowId}/chat`, `POST /api/windows/{windowId}/chat/send`) leave `api/router.go`. `TmuxOps` members used ONLY by the deleted handlers (e.g. the chat-send buffer primitives) are removed from the interface, `prodTmuxOps`, and `mockTmuxOps` ONLY if `api/send.go`/`api/operator.go` do not consume them — the shared `internal/inject` engine and its tmux primitives in `internal/tmux` stay (R8). The `handleChatSend` reference in the `api/operator.go` comment is updated.

- **GIVEN** the backend after this change
- **WHEN** `cd app/backend && go build ./... && go test ./...` runs
- **THEN** it compiles and passes with no chat endpoint, no `kindChat`, and no orphaned (uncalled) chat-send helpers; a `kind:"chat"` subscribe over `/ws/state` receives the unknown-kind error path.

### Shared infrastructure: keep contract

#### R8: Shared consumers are untouched
`app/backend/internal/chat` (schema, adapter registry, `TranscriptPath`), `app/backend/internal/inject` (+ its tests), the `@rk_pane_chat` option (`ChatOption`) and `ChatProvider`/`ChatSessionRef` fields on backend `Window`/`Pane` structs, the frontend `WindowInfo.chatProvider`/`chatSessionRef` fields, and the `ComposeSurface` value `"chat"` in `lib/compose-keys.ts` (the compose strip's selection-broadcast policy) SHALL remain functionally unchanged. Only compile-neutral touch-ups forced by deleted callers are permitted (none expected — the deleted endpoints are leaf consumers).

- **GIVEN** the tree after this change
- **WHEN** the operator fix-name/annotate gates, fork/resume, auto-name, compose-strip send (`/api/windows/{id}/send`), and selection broadcast are exercised (existing tests)
- **THEN** all behave exactly as before; `internal/chat` and `internal/inject` diffs are empty.

### Deprecated Requirements

#### The chat lens (`?view=chat` / `single:chat`)
**Reason**: Half-built WIP surface; users landed in it accidentally via waiting-badge/push deep links and the shared `single:chat` layout trapped every viewer; the compose strip won the "answer the agent" role.
**Migration**: Waiting/push navigation lands on the plain terminal route; the compose strip is the send surface; stored chat layouts heal to `single:tty` at parse time.

### Non-Goals

- Fixing the `TestWaitingPushBroadcastsNotifyEvent` TempDir race or `TestSnapshotterStartStopsWithContext` (separate change).
- Renaming the kept `ComposeSurface` `"chat"` value (user-deferred; keep the name).
- Any behavior change in `internal/chat` / `internal/inject` / operator actuation / fork-resume / auto-name.
- Rewriting `docs/specs/window-views.md` / `docs/specs/surface-layout.md` (human-curated; drift noted at hydrate/PR).

## Tasks

### Phase 1: Backend removals

- [x] T001 Delete `app/backend/api/chat.go`, `api/chat_test.go`, `api/chat_send_test.go`; remove the two chat route registrations from `api/router.go`; prune `TmuxOps`/`prodTmuxOps`/`mockTmuxOps` members whose ONLY consumers were the deleted handlers (verify `api/send.go`/`api/operator.go` usage first); update the `handleChatSend` comment reference in `api/operator.go` <!-- R7 -->
- [x] T002 Delete `app/backend/api/chat_ws.go` + `api/chat_ws_test.go`; remove `kindChat` and its dispatch arm from `api/state_ws.go` <!-- R7 -->
- [x] T003 [P] `app/backend/api/waiting_push.go`: URL builder always returns the plain window URL (drop the `?view=chat` branch + `chatProvider` lookup); update `api/waiting_push_test.go` assertions and `api/sse_test.go` fixture strings <!-- R5 -->
- [x] T004 Backend gate: `cd app/backend && go build ./... && go test ./...` green; verify `internal/chat` + `internal/inject` diffs are empty <!-- R7 -->

### Phase 2: Frontend availability + entrances

- [x] T005 `app/frontend/src/lib/window-view.ts`: remove `"chat"` from `ViewName` + `HINT_ORDER`, delete `hasChat` and the chat branch in `availableViews`, drop `ViewWindow.chatProvider`; update `window-view.test.ts` (add the R2 healing cases: `single:chat` and `split-h:chat,tty` degrade to `single:tty`) <!-- R1 -->
- [x] T006 `app/frontend/src/lib/surface-layout.ts`: remove `chat` from `SURFACE_KINDS`/`SURFACE_LABEL`/`SURFACE_GLYPH` and the `availableTiles` branch; delete `SURFACE_RAIL_HIDDEN` + its consumers (surface-toggle group filter in top-bar / surface-layout components); update `surface-layout.test.ts`, `surface-layout.test.tsx`, `palette/layout.test.ts` <!-- R1, R2 -->
- [x] T007 `app/frontend/src/lib/palette/agent-nav.ts`: delete `chatSearchForTarget`; `app.tsx`: `navigateToWaitingTarget` + waiting-badge/next-waiting callers navigate with empty search (drop `hasChat` plumbing); update stale deep-link comments in `app.tsx` and `components/waiting-badge.tsx`; update `agent-nav.test.ts` <!-- R3 -->
- [x] T008 [P] `app/frontend/src/lib/router-url.ts`: drop `"chat"` from `validateTerminalSearch`'s view union; update `router-url.test.ts` (legacy `?view=chat` is dropped; `web`/`code` unchanged) <!-- R4 -->

### Phase 3: Frontend wing deletion

- [x] T009 Delete `components/chat-view.tsx` + `chat-view.test.tsx`, `hooks/use-chat-subscription.ts` + `use-chat-subscription.test.tsx`, `lib/chat-stream.ts` + `chat-stream.test.ts`, `tests/e2e/chat-view.spec.ts` <!-- R6 -->
- [x] T010 `app.tsx`: remove the `useChatSubscription` bundle (`chatViewActive`/`chatStream`), the chat tile mount in the `SurfaceLayout` renderer, and collapse `dotConnected` to `isConnected`; remove the `chat` entry from `lib/palette/view.ts` `VIEW_ACTION_LABEL`; delete `sendChatMessage`/`getWindowChat` from `src/api/client.ts` + their `client.test.ts` coverage; fix `app.test.tsx`, `top-bar.test.tsx`, `row-flyout-card.test.tsx` and other touched tests <!-- R6 -->
- [x] T011 Residue sweep: grep `app/frontend/src`, `app/frontend/tests`, `app/backend` for `view=chat`, `single:chat`, `ChatView`, `useChatSubscription`, `chat-stream`, `sendChatMessage`, `getWindowChat`, `kindChat`, `SURFACE_RAIL_HIDDEN` — fix functional stragglers and stale comments; confirm the only surviving `chat` identifiers are the R8 keep set (`compose-keys.ts` surface value, `WindowInfo`/backend struct fields, `internal/chat`, `@rk_pane_chat`) <!-- R6, R8 -->

### Phase 4: Verification

- [x] T012 Full gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test`; `just build` <!-- R7 -->

### Phase 5: Rework cycle 1 — restore broadcast agent-pane semantics (review must-fix)

<!-- rework: review cycle 1 must-fix — the executeBulkSend rewiring (deleted /chat/send → /send) lost agent-pane resolution and fail-closed 404 semantics; on a non-agent window the broadcast pastes into the active pane's shell and presses Enter, executing the text -->

- [x] T013 Backend: give `POST /api/windows/{id}/send` an agent-pane targeting mode (optional body field `target:"agent"`): when set, resolve the pane by the SAME rollup rule the deleted `handleChatSend` used (`sessions.ResolveChatPane` — active-pane-first among panes carrying `@rk_pane_chat`, else first such pane; reuse, don't duplicate) and return `404` ("no chat session for this window") when no pane carries chat — restoring the fail-closed counted-failure contract. Without the field, behavior is byte-identical to today (active pane). Handler tests: agent-pane targeting on a split (agent pane not active), the 404 fail-closed case, the default-path no-change case. `app/backend/api/send.go` + tests <!-- R8 -->
- [x] T014 Frontend: `executeBulkSend` (`app.tsx`) sends `target:"agent"` (plumb the field through `src/api/client.ts`) so selection broadcast targets agent panes and counts a 404 as that window's failure, exactly as before; fix the stale chat-consumer comments review flagged — `lib/compose-keys.ts` (~4-5, 16-18, 40-41) and `components/compose-strip.tsx` (~67, 76-79, 697-698): the `"chat"` surface's live consumer is selection broadcast now — plus the example-only staleness in `lib/window-transition.ts` (~167, 201) / `window-transition.test.ts` (~290); mark plan A-013 when done. Re-run gates: `cd app/backend && go test ./api/...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend` <!-- R8 -->

## Execution Order

- T001–T002 before T004 (backend gate); T003 is independent of T001/T002.
- T005 blocks T006 (SurfaceKind aliases ViewName) and T007/T010 (hasChat consumers).
- T009 before T010 (delete files, then fix the imports that referenced them — one tsc pass).
- T011 and T012 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `availableViews`/`availableTiles` never return `chat`; `ViewName`/`SurfaceKind` carry no `"chat"` member; `SURFACE_RAIL_HIDDEN` no longer exists
- [x] A-002 R3: Waiting-badge click and `Agent: Next waiting` navigate to the bare `/{server}/{window}` route with empty search
- [x] A-003 R5: The waiting-push notify URL is the plain window URL for every window, chat-capable or not
- [x] A-004 R7: `GET /api/windows/{id}/chat`, `POST /api/windows/{id}/chat/send`, and the `kind:"chat"` WS subscription no longer exist (unknown route / unknown-kind error paths)

### Behavioral Correctness

- [x] A-005 R2: A stored `single:chat` (and a multi-tile layout containing `chat`) resolves to `single:tty` via the parse-reject fallback — unit-tested
- [x] A-006 R4: `?view=chat` is dropped at search validation (bare-route cleanup, no chat layout written); `?view=web`/`?view=code` behavior unchanged — unit-tested

- [x] A-015 R8: Selection broadcast targets each window's AGENT pane (active-pane-first among `@rk_pane_chat` carriers, else first carrier) and a window with no agent pane counts as a fail-closed 404 failure — never a paste+Enter into the active pane's shell; the default `/send` path (no `target` field) is byte-identical to before — handler-tested — verified cycle 2: `resolveWindowAgentPane` delegates to the shared `sessions.ResolveChatPane` rollup (active-pane-first, else first carrier); `TestWindowSendAgentTargetResolvesAgentPane` (split, agent pane not active → delivers to %2), `TestWindowSendAgentTargetNoAgent404` (404 with zero tmux injection calls), `TestWindowSendDefaultTargetsActivePane`, and the `target:"shell"` 400 case all pass; `executeBulkSend` sends `sendToWindow(..., "submit", "agent")` and a thrown 404 counts via `executeSelectionBatch.failedKeys`; the default handler path is unchanged

### Removal Verification

- [x] A-007 R6: The six frontend lens files + e2e spec are gone; no functional reference to `ChatView`/`useChatSubscription`/`chat-stream`/`sendChatMessage`/`getWindowChat` remains
- [x] A-008 R7: `api/chat.go`/`chat_ws.go` + 3 test files are gone; no orphaned chat-send helpers or `TmuxOps` members remain (zero call sites)

### Scenario Coverage

- [x] A-009 R2: `window-view.test.ts`/`surface-layout` tests cover the healing scenarios (`single:chat`, `split-h:chat,tty` → `single:tty`)
- [x] A-010 R3: **N/A**: the search-decision function (`chatSearchForTarget`) was deleted outright — bare-route navigation is now unconditional (`search: {}` in `app.tsx`'s `navigateToWaitingTarget`) and type-enforced (`TerminalSearch.view` no longer admits `"chat"`), so no agent-nav branch remains to pin; the residual surface is covered by `router-url.test.ts` (drop) and `use-shell-notifications.test.tsx` (stale deep link lands on the bare route)

### Edge Cases & Error Handling

- [x] A-011 R7: A `kind:"chat"` subscribe on `/ws/state` yields the standard unknown-kind/error frame, not a crash or hang (covered by existing state-ws unknown-kind handling)

### Code Quality

- [x] A-012 R8: `internal/chat`, `internal/inject`, operator actuation, fork/resume, and auto-name are diff-empty (compile-neutral only); `compose-keys.ts` `"chat"` surface and `WindowInfo.chatProvider`/`chatSessionRef` survive — verified: `internal/chat` + `internal/inject` diffs are empty; `internal/push/send.go` + `internal/tmux/pane_target.go` carry comment-only touch-ups (they referenced the deleted `?view=chat` example / `resolveWindowChat`); `internal/sessions`, fork, operator, auto-name behavior unchanged (rk/api tests green)
- [x] A-013 Pattern consistency: comment updates state constraints, not history (no change-ID narration added); deletions leave no commented-out code — rework cycle 1 (T014) re-anchored the `compose-keys.ts` header/policy comments and `compose-strip.tsx` broadcast comments on the selection broadcast as the `"chat"` surface's live consumer, and swapped the stale `web/chat` examples in `window-transition.ts` / `window-transition.test.ts` for `web/code`
- [x] A-014 No unnecessary duplication: no replacement utilities added — this change only deletes and rewires — verified: the only added backend symbols are the relocated injection helpers (moved verbatim from the deleted `api/chat.go`, all with call sites); the one out-of-intake addition is the `NODE_OPTIONS=--no-experimental-webstorage` test-script fix (pre-existing Node 26 breakage, baseline-verified by apply)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/api/fork.go:28` — comment still says "Compare the chat endpoints (api/chat.go), whose contract this mirrors"; `api/chat.go` is deleted by this change (the mirrored window-keyed derive-server-side contract now lives in `api/send.go` / `api/operator.go`)
- `app/frontend/src/app.tsx:1141` — comment cites "the chat-view autofocus precedent"; the chat view no longer exists (example-level staleness, behavior unchanged)
- None beyond comment drift — all code made redundant by this change (chat WS seam, `.rk-chat-input` carve-out, `.chat-markdown` CSS, e2e mock chat arm, `chatSearchForTarget`, `hasChat`) was deleted in the apply diff; the cycle-1 comment-drift candidates (compose-keys.ts, compose-strip.tsx, window-transition.ts) were re-anchored by T014; `sessions.ResolveChatPane` keeps live consumers (fork, operator, closed-window records, window rollup, and now `resolveWindowAgentPane`)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `ViewWindow.chatProvider` is dropped (structural helper type) while `WindowInfo.chatProvider`/`chatSessionRef` (types.ts) are kept | The helper field's only consumer was `hasChat`; the WindowInfo fields gate operator features (intake R8/keep list) | S:85 R:90 A:90 D:85 |
| 2 | Confident | Multi-tile layouts containing `chat` degrade whole to `single:tty` via parse-reject (no legacy-token filtering that preserves sibling tiles) | Intake assumption #7 carried forward: chat was rail-hidden/palette-only so multi-tile-with-chat is rare; parse-reject is the zero-new-code path; the filtering alternative is available if review objects | S:60 R:85 A:75 D:50 |
| 3 | Certain | R4 is implemented by narrowing `validateTerminalSearch`'s view union (drop `"chat"`), leaving `translateLegacyParams` generic | The validator is the single inbound gate; a dropped param never reaches translation — minimal diff, existing unknown-value drop semantics | S:80 R:90 A:90 D:85 |
| 4 | Confident | `TmuxOps` chat-send members are pruned only after verifying `send.go`/`operator.go` don't consume them; shared `internal/inject`-backing primitives in `internal/tmux` stay | The compose strip and operator routes share the injection engine — memory (chat.md § Send Path) documents `send.go` using `Engine.Send`/`SendRaw`/`PressEnter`, so most primitives likely stay; verification is in-task | S:70 R:80 A:80 D:70 |

4 assumptions (2 certain, 2 confident, 0 tentative).
