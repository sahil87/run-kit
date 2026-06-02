# Plan: Window-State API Stability Remediation

**Change**: 260529-jad6-window-api-stability
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

<!--
  AUTO-GENERATED at apply entry. Apply parses `## Tasks`; review parses `## Acceptance`.
  Test strategy: test-alongside. Tests run ONLY via `just` recipes:
    - Backend: `just test-backend`
    - Frontend typecheck / unit: `just test-frontend` (Vitest), `just` tsc recipe
    - E2E: `just test-e2e` / `just pw` (NEVER raw `go test`/`pnpm test`/`playwright`)
  Any touched `*.spec.ts` MUST update its sibling `*.spec.md` in the same commit
  (constitution Test Companion Docs).
-->

## Tasks

### Phase 1: Setup

<!-- Shared tmux primitives extracted first — both /options and handleWindowCreate consume them. -->

- [x] T001 Extract a chained `set-option` primitive in `app/backend/internal/tmux/tmux.go`: add a function (e.g. `SetWindowOptions(ctx, windowID, server string, opts []WindowOptionOp) error`, where each op is a `{Key string; Value *string}` — non-nil = set via `set-option -w -t {windowID} <key> <value>`, nil = unset via `set-option -w -u -t {windowID} <key>`) that issues the whole sequence as ONE `\;`-chained `tmuxExecServer` invocation, mirroring the `";"`-chaining pattern in `CreateWindowWithOptions` (tmux.go:881-894). All args passed via argv slice — no shell strings (§I). <!-- A-006, A-031 -->
- [x] T002 Add `decodeWindowID(r *http.Request) (string, bool)` helper in `app/backend/api/windows.go` that does `url.PathUnescape(chi.URLParam(r, "windowId"))` then `validate.ValidateWindowID`, returning `("", false)` on either failure — extracted verbatim from the current `parseWindowID` body (windows.go:99-109). Correct the doc comment to state actual chi v5 behavior: `URLParam` returns the path param as it appears in the matched route (`%40` stays encoded), so an explicit `PathUnescape` is required; `RawPath` is set by net/http only when decoded path ≠ raw path, and the decode here does not depend on it. <!-- A-004 -->

### Phase 2: Core Implementation

<!-- Order: helpers (Phase 1) → backend handlers/routes that consume them → frontend client → frontend route/identity. -->

- [x] T003 Rewrite `handleWindowSelect` in `app/backend/api/windows.go` (currently windows.go:154-167) to resolve the owning session for `{windowId}` via `s.tmux.ResolveWindowSession(ctx, server, windowID)` (5s timeout context, not `r.Context()`), then call `s.tmux.SelectWindowInSession(session, windowID, server)`. Surface a non-2xx error when resolution fails; MUST NOT fall back to a bare `SelectWindow`. <!-- A-001, A-002 -->
- [x] T004 Point `parseWindowID` (windows.go:99-109) at the new `decodeWindowID` helper so it delegates instead of duplicating the decode+validate block. Behavior (400 on malformed/non-decodable id before any tmux call) preserved exactly. <!-- A-004 -->
- [x] T005 Replace the inline percent-decode + `ValidateWindowID` block in `handleRelay` (`app/backend/api/relay.go`:67-82) with a call to `decodeWindowID`; on failure return `400` ("Invalid window ID") before the WS upgrade and before any tmux call, identical to today. Remove the misleading "chi v5 preserves the encoded form … when RawPath is set" comment (relay.go:68-70). <!-- A-004, A-005 -->
- [x] T006 Make `MoveWindow` atomic in `app/backend/internal/tmux/tmux.go` (currently tmux.go:778-851): resolve source index once via `resolveWindowSessionIndex`, compute the same insert-before swap sequence, but emit all `swap-window -s <src> -t <dst>` steps as ONE `\;`-chained `tmuxExecServer` invocation instead of the per-step loop at tmux.go:840-849. Preserve insert-before / sentinel / single-step / no-op (`srcIndex == dstIndex`, `srcPos == endPos`) semantics; destination stays a positional index. <!-- A-007, A-008, A-009 -->
- [x] T007 Remove `KillPane` from `app/backend/internal/tmux/tmux.go` (tmux.go:1032+), from the `TmuxOps` interface (`app/backend/api/router.go`:44), and from the `prodTmuxOps` wrapper (router.go:156-158). Update `KillActivePane`'s doc comment (tmux.go:1018-1021) to document the silent-success contract as canonical, removing the now-dangling "matching the KillPane pattern" reference. <!-- A-010, A-011 -->
- [x] T008 Add `handleWindowOptions` in `app/backend/api/windows.go` for `POST /api/windows/{windowId}/options`: decode body `{"options": map[string]*string}`; validate ALL keys before any tmux call — allowlist `@color`/`@rk_url`/`@rk_type` only (unknown key → 400, never passed to tmux, §I), `@color` when set must parse as int in 0–15 (non-numeric/out-of-range → 400), `@rk_url` when set must be non-empty after trim (empty → 400), `@rk_type` non-empty sets verbatim / empty-or-null unsets (no enum validation, preserving old `handleWindowTypeUpdate`). Map `null` → unset, present string → set. Apply the whole merge through the T001 chained primitive in one invocation. Returns `200 {"ok":true}`. <!-- A-012..A-020, A-031, A-032 -->
- [x] T009 Delete `handleWindowColor`, `handleWindowUrlUpdate`, `handleWindowTypeUpdate` from `app/backend/api/windows.go` (windows.go:288-391) and remove their route registrations from `app/backend/api/router.go` (`POST /color` router.go:349, `PUT /url` router.go:350, `PUT /type` router.go:351). <!-- A-021, A-022 -->
- [x] T010 Simplify `handleWindowCreate` (windows.go:16-90): replace the inline `opts := map[string]string{...}` construction + `CreateWindowWithOptions` branch (windows.go:69-82) so post-create `@rk_type`/`@rk_url` setting routes through the shared T001 chained primitive — no separate ad-hoc options-map path. (Confirm whether `CreateWindowWithOptions` itself should delegate to T001 or remain; keep window creation + option-set atomic at creation.) <!-- A-020, A-031 -->
- [x] T011 Register `POST /api/windows/{windowId}/options` → `handleWindowOptions` in `app/backend/api/router.go` `buildRouter` (alongside the other window routes ~router.go:345-355). <!-- A-012, A-022 -->
- [x] T012 Migrate the five `.Put(` registrations in `app/backend/api/router.go` to `.Post(`: `sessions/order` (router.go:335), `settings/theme` (router.go:372), `settings/server-color` (router.go:374); the `windows/{id}/url` and `windows/{id}/type` PUTs are removed (T009), not migrated. After this there are zero `.Put`/`.Patch`/`.Delete` registrations. <!-- A-023, A-024, A-025, A-027 -->
- [x] T013 Drop `PUT` from CORS `AllowedMethods` in `app/backend/api/router.go`:322 → `[]string{"GET", "POST", "OPTIONS"}`. <!-- A-026 -->
- [x] T014 [P] Rename handlers for verb clarity if warranted in `app/backend/api/sessions.go` (`handleSessionOrderPut`, sessions.go:140) and `app/backend/api/settings.go` (`handlePutTheme` settings.go:24, `handlePutServerColor` settings.go:104) — bodies/response shapes unchanged (theme returns `{"status":"ok"}` / 400 on empty; server-color persists identically). Update router references if renamed. <!-- A-023, A-024, A-025 -->
- [x] T015 [P] Add `setWindowOptions(server, windowId, options: Record<string, string | null>)` to `app/frontend/src/api/client.ts` calling `POST /api/windows/{windowId}/options`; rewrite `setWindowColor` (client.ts:333-348), `updateWindowUrl` (client.ts:240-255), `updateWindowType` (client.ts:257-272) to delegate to it (`@color` sent as stringified number or null; `@rk_url`; `@rk_type`). Remove the old `PUT`-to-`/url` and `/type` fetches. <!-- A-021, A-028, A-031 -->
- [x] T016 [P] Migrate `setSessionOrder` (client.ts:57-64), `setThemePreference` (client.ts ~440), `setServerColor` (client.ts ~465) in `app/frontend/src/api/client.ts` from `method: "PUT"` to `method: "POST"`; request/response bodies unchanged. <!-- A-023, A-024, A-025, A-028 -->
- [x] T017 Change the terminal route in `app/frontend/src/router.tsx` from `path: "/$session/$window"` (router.tsx:47-54) to `path: "/$window"` under `serverLayoutRoute` (yielding `/$server/$window`); drop `session` from `parseParams`. <!-- A-029 -->
- [x] T018 Rework window identity in `app/frontend/src/app.tsx`: change `pendingClickRef` to hold the window id only (drop `session`, app.tsx:288) and make `urlMatchesPending` compare `windowId` only (app.tsx:391-392) — `pending.windowId === windowParam`, regardless of session-name string match. <!-- A-029, A-030 -->
- [x] T019 Update all `navigate({ to: "/$server/$session/$window", params: {server, session, window} })` call sites in `app/frontend/src/app.tsx` to `navigate({ to: "/$server/$window", params: {server, window} })` — at minimum the kill-redirect (app.tsx:334-336), URL writeback (app.tsx:401-405), `navigateToWindow` (app.tsx:419-423), `onSessionRenamed` (app.tsx:437-439), and breadcrumb/dropdown navigates (~app.tsx:743, 768, 1019). Remove the now-unused `session` arg from `navigateToWindow` and any callbacks that no longer need it. <!-- A-029 -->

### Phase 3: Integration & Edge Cases

<!-- Derive session from the SSE snapshot, wire deep-link, then tests. -->

- [x] T020 Derive `sessionName` in `app/frontend/src/app.tsx` from the active window's SSE snapshot instead of `params.session` (app.tsx:135). Find the owning session by locating `windowParam` (`@N`) within `sessions[].windows[]` (the snapshot already carries session names per window) rather than `sessions.find(s => s.name === sessionName)` (app.tsx:291-294). Update `currentSession`, the ever-seen URL key (app.tsx:314), mount-time alignment (app.tsx:358-375), `useBrowserTitle` (app.tsx:201), `computeKillRedirect` inputs (app.tsx:323-342), and breadcrumb/dropdown session display (app.tsx:999, 1011, 1084, 1105+) to use the derived session. <!-- A-029, A-033, A-035, A-036 -->
- [x] T021 Verify deep-link `/$server/@N` in `app/frontend/src/app.tsx`: a fresh tab with no session segment must derive the owning session from the first SSE snapshot for breadcrumb display and align tmux to `@N` via the existing mount-time alignment (now comparing window id only). Old `/$server/$session/$window` URLs are a hard break — they fall through to the not-found / server-dashboard fallback (`router.tsx` `NotFoundPage` / `serverIndexRoute`); no redirect shim. <!-- A-034, A-037 -->
- [x] T022 Add `decodeWindowID` unit coverage in `app/backend/api/windows_test.go` (or a focused `parseWindowID`/`decodeWindowID` test): `%402` → `@2` success; bare number rejected; non-decodable / invalid id → false. Run via `just test-backend`. <!-- A-005, A-039 -->
- [x] T023 Add `/select` re-route tests in `app/backend/api/windows_test.go`: a `POST /api/windows/@2/select` resolves the owning session (mock `resolveWindowSessionResult`) and calls `SelectWindowInSession` with `{session, @2}` (assert `selectWindowInSessionCalled` + args, and that `selectWindowCalled` is false); a resolve failure returns non-2xx and issues no select. Run via `just test-backend`. <!-- A-001, A-002, A-039 -->
- [x] T024 Replace the deleted `/color`,`/url`,`/type` tests (`TestWindowColorSet/Clear/InvalidValue/InvalidWindowID` windows_test.go:16-87, `TestWindowUrlUpdate*` :641-705, `TestWindowTypeUpdate*` :707+) with `/options` tests in `app/backend/api/windows_test.go`: set-color-only leaves url untouched; explicit `null` unsets; multi-key merge is one call; out-of-range/non-numeric `@color` → 400 + no tmux call; empty `@rk_url` → 400 + no tmux call; unknown key `@evil` → 400 + key never passed to tmux; `@rk_type` empty/null unsets and non-empty sets verbatim. Extend `mockTmuxOps` to record the chained-options call. Run via `just test-backend`. <!-- A-013..A-019, A-032, A-039 -->
- [x] T025 Add atomic-merge / primitive coverage in `app/backend/internal/tmux/tmux_test.go` for the T001 chained `set-option` primitive (set + unset in one invocation) against the real go-test tmux server, mirroring `TestMoveWindow_reordersAndPreservesID` style. Run via `just test-backend`. <!-- A-031, A-039 -->
- [x] T026 Update `MoveWindow` tmux tests in `app/backend/internal/tmux/tmux_test.go`: keep `TestMoveWindow_reordersAndPreservesID` (:801) green under chained execution and add a multi-step reorder case (≥3 windows, ≥2 swaps) asserting final layout + preserved `@N` after the single chained invocation. Run via `just test-backend`. <!-- A-007, A-008, A-038, A-039 -->
- [x] T027 Remove the `KillPane` stub from `mockTmuxOps` in `app/backend/api/sessions_test.go` (sessions_test.go:264-266) so the mock matches the tightened `TmuxOps` interface; confirm `just test-backend` compiles with zero `KillPane` references backend-wide. <!-- A-010, A-011, A-039 -->
- [x] T028 Migrate `TestSessionOrder_PUT_*` in `app/backend/api/sessions_test.go` (sessions_test.go:797-996, the `http.MethodPut` requests at :802,:831,:848,:867,:890,:913,:928,:971) to `http.MethodPost`; rename to `_POST_` for clarity. Includes the `_triggersBroadcast` SSE wiring test (:941). Run via `just test-backend`. <!-- A-023, A-027, A-039 -->
- [x] T029 [P] Add settings POST handler tests (new `app/backend/api/settings_test.go`): `POST /api/settings/theme` round-trips and returns `{"status":"ok"}`, empty/whitespace theme → 400; `POST /api/settings/server-color` persists and 400s on out-of-range color / missing server. Run via `just test-backend`. <!-- A-024, A-025, A-039 -->
- [x] T030 [P] Add frontend client unit coverage in `app/frontend/src/api/client.test.ts` (MSW): `setWindowColor`/`updateWindowUrl`/`updateWindowType` all hit `POST /api/windows/{id}/options` with the correct `options` payload; `setSessionOrder`/`setThemePreference`/`setServerColor` issue `POST` (not `PUT`). Run via `just test-frontend`. <!-- A-028, A-039 -->
- [x] T031 Update e2e specs that assert the 3-segment URL to the `/$server/$window` shape, updating each sibling `.spec.md` in the SAME commit (constitution Test Companion Docs): `app/frontend/tests/e2e/sidebar-window-sync.spec.ts` (URL assertions at :172, :184, :244) + `sidebar-window-sync.spec.md`; `app/frontend/tests/e2e/multi-server-sidebar.spec.ts` (`toHaveURL` 3-segment regex at :88) + `multi-server-sidebar.spec.md`. Add/adjust a session-rename-survives-selection scenario if exercised. Run via `just test-e2e` / `just pw`. <!-- A-029, A-030, A-040 -->
- [x] T032 Update `app/frontend/tests/e2e/mobile-touch-scroll.spec.ts` — it directly `page.goto`s the old 3-segment shape `${BASE}/${TMUX_SERVER}/${TEST_SESSION}/${encodeURIComponent(windowId)}` at :89, :152, :171; rewrite each to the 2-segment `${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}` (drop the `TEST_SESSION` segment) so the terminal route mounts after T017, and update the sibling `mobile-touch-scroll.spec.md` in the SAME commit. Then audit the remaining e2e specs in `app/frontend/tests/e2e/` for any other incidental 3-segment navigation/regex (`session-reorder.spec.ts` uses the order API; `sidebar-server-coupling`, `boards-*`, `sync-latency`, `api-integration`, `mobile-layout`, `server-panel-grid`, `sse-connection`, `sidebar-panels` were grep-confirmed to `goto` only `/${TMUX_SERVER}` and are shape-agnostic) — update any further hard-coded old-route usages plus their `.spec.md` companions in the same commit. Run via `just test-e2e`. <!-- A-029, A-040 -->
<!-- clarified: incidental-e2e audit resolved by grepping app/frontend/tests/e2e/ — the ONLY specs that hard-code the 3-segment URL are sidebar-window-sync (T031: assertions at :172,:184,:244), multi-server-sidebar (T031: toHaveURL at :88), and mobile-touch-scroll (page.goto at :89,:152,:171 — previously unlisted, now T032; without this fix every test in that file breaks at the first goto once $session leaves the route). All other e2e specs goto only /${TMUX_SERVER} and are route-shape-agnostic. T032 changed from [P] to sequential: it edits the spec body, not just additive. -->

### Phase 4: Polish

- [x] T033 Run the full verification gate via `just` recipes: `just test-backend`, the frontend tsc/typecheck recipe, `just test-frontend`, and `just test-e2e`. Confirm zero `.Put`/`KillPane`/old-route references remain and the production build passes (`just build`). <!-- A-039, A-027, A-011, A-022 -->

## Execution Order

<!-- Non-obvious cross-task dependencies only. -->

- T001 (chained set-option primitive) blocks T008 (`/options` handler) and T010 (`handleWindowCreate` delegation) — extract before both consume it.
- T002 (`decodeWindowID`) blocks T004 (`parseWindowID` delegate) and T005 (relay call site) — helper before its two call sites.
- T008 + T011 (`/options` route) and T015 (frontend `setWindowOptions` client) must land together — the new route + client contract are a matched pair; T009 (remove old routes/handlers) follows once both exist.
- T017 (route definition `/$window`) blocks T018–T021 (app.tsx identity/navigate/derive/deep-link) — route param shape changes first.
- T020 (derive session from snapshot) depends on T017–T019 (route + navigate sites) being in place.
- T024 (`/options` tests) depends on T008; T023 (`/select` tests) on T003; T028 (order POST tests) on T012; T029 (settings tests) on T012/T014.
- T031/T032 (e2e + `.spec.md`) depend on the frontend route/identity changes T017–T021. T031 (`sidebar-window-sync`, `multi-server-sidebar` URL assertions) and T032 (`mobile-touch-scroll` `goto` rewrite + residual audit) both edit e2e spec bodies — keep sequential, not `[P]`, since they share the e2e-spec + `.spec.md`-companion surface.

## Acceptance

### Functional Completeness

<!-- Every spec requirement has a working implementation. -->

- [x] A-001 Session-scoped REST `/select`: `POST /api/windows/{windowId}/select` resolves the owning session via `ResolveWindowSession` and issues `SelectWindowInSession` (`select-window -t <session>:@N`), never a bare `SelectWindow`. (windows.go:179-206)
- [x] A-002 Select error path: when the owning session cannot be resolved (stale `@N`), the handler returns a non-2xx error and issues no select against the stale id. (windows.go:192-198; test windows_test.go:241-258)
- [x] A-003 Client never supplies the session: the `/select` request body and path carry no session identifier; the session is derived server-side only. (client.ts:281-291 POSTs to `/select` with no body; handler derives via ResolveWindowSession)
- [x] A-004 Single `decodeWindowID` helper: percent-decode + `ValidateWindowID` exists in exactly one `api/` helper; both `parseWindowID` and `handleRelay` obtain their validated id through it; the duplicated blocks are gone and the chi-v5 comment is corrected. (windows.go:110-127; relay.go:70)
- [x] A-005 Decode behavior preserved: a malformed/non-decodable id yields 400 (REST) / pre-upgrade 400 (relay) before any tmux subprocess, identical to today. (windows.go:110-118 returns false → 400; relay.go:70-74 → 400 before upgrade; test windows_test.go:281-312)
- [x] A-006 Chained `set-option` primitive: a single tmux function emits set/unset window-option ops as one `\;`-chained invocation, reusing the `CreateWindowWithOptions` chaining pattern. (tmux.go appendOptionOps:900, SetWindowOptions:928)
- [x] A-007 `MoveWindow` chains swaps atomically: the full swap sequence is one `\;`-chained tmux invocation; source index resolved exactly once. (tmux.go:778-857, resolve at :784, single chained exec at :853)
- [x] A-008 Reorder semantics preserved: insert-before / index-destination / sentinel / single-step / no-op behavior is unchanged from the prior loop. (tmux.go:788-835 sentinel/insert-before/no-op logic intact; test TestMoveWindow_reordersAndPreservesID + multiStepReorder)
- [x] A-009 No interleave mid-reorder: a concurrent kill/move observes only the pre- or post-reorder layout, never a partially-swapped intermediate. (single chained `swap-window` invocation, tmux.go:844-855)
- [x] A-010 `KillPane` removed: gone from `tmux.go`, the `TmuxOps` interface, the `prodTmuxOps` wrapper, and the `sessions_test.go` mock. (grep: zero references backend-wide)
- [x] A-011 `KillActivePane` contract documented: its silent-success comment is the canonical pane-kill contract and references no deleted `KillPane`. (tmux.go:1079-1096)
- [x] A-012 Unified `/options` endpoint: `POST /api/windows/{windowId}/options` exists with body `{"options": {string: string|null}}` decoded as `map[string]*string`. (windows.go:377-430; router.go:349)
- [x] A-013 Set-only merge: `{"options":{"@color":"5"}}` sets `@color` and leaves `@rk_url`/`@rk_type` untouched; returns `200 {"ok":true}`. (test TestWindowOptionsSetColorOnly)
- [x] A-014 Null unsets: `{"options":{"@color":null}}` runs `set-option -w -u -t @N @color`, clearing the option. (windows.go nil Value op; tmux.go appendOptionOps:906-908 emits `-w -u`; test TestWindowOptionsNullUnsets)
- [x] A-015 `@color` validation: a string parseable as int 0–15 sets; non-numeric or out-of-range → 400 + no tmux call. (windows.go validateWindowOption:346-355; tests ColorOutOfRange/ColorNonNumeric)
- [x] A-016 `@rk_url` validation: non-empty-after-trim sets; empty → 400 + no tmux call. (windows.go:356-358; test TestWindowOptionsEmptyUrl)
- [x] A-017 `@rk_type` behavior: non-empty sets verbatim (no enum validation); empty/null unsets (`-w -u`). (windows.go:360-362, :409-411; tests RkTypeEmptyUnsets/RkTypeNullUnsets/RkTypeSetVerbatim)
- [x] A-018 Unknown-key rejection: any key not in `@color`/`@rk_url`/`@rk_type` → 400; the key is never passed to tmux. (windows.go:396-401; test TestWindowOptionsUnknownKeyRejected)
- [x] A-019 Validate-all-then-execute: if any key fails validation the endpoint returns 400 and issues zero tmux calls (no partial application). (windows.go:394-413 builds+validates all ops before single SetWindowOptions call at :424; test UnknownKeyRejected uses mixed valid+invalid body)
- [x] A-020 `handleWindowCreate` reuses the primitive: `@rk_type`/`@rk_url` are set via the same chained primitive, atomically at creation, with no separate inline options-map path. (windows.go:75-88 builds `[]tmux.WindowOptionOp` → CreateWindowWithOptions → appendOptionOps)
- [x] A-021 Frontend options client: `setWindowColor`/`updateWindowUrl`/`updateWindowType` route through a single `/options` POST call. (client.ts:246-279, :340-350 all delegate to setWindowOptions)
- [x] A-022 `/options` route registered: `POST /api/windows/{windowId}/options` is the only window-option mutation route. (router.go:349; no /color, /url, /type routes)
- [x] A-023 Session order is POST: `POST /api/sessions/order` accepted; SSE `session-order` broadcast unchanged. (router.go:335; sessions.go:140-172 broadcast intact)
- [x] A-024 Theme is POST: `POST /api/settings/theme` accepted; returns `{"status":"ok"}` (400 on empty theme). (router.go:370; settings.go:24-82; test TestSetTheme_roundTrip/_emptyRejected)
- [x] A-025 Server color is POST: `POST /api/settings/server-color` persists identically to the former PUT. (router.go:372; settings.go:104-128; test TestSetServerColor_persists)
- [x] A-026 CORS allowlist: `AllowedMethods` is exactly `[GET, POST, OPTIONS]` (no PUT). (router.go:322)
- [x] A-027 No PUT/PATCH/DELETE routes: zero `.Put(`/`.Patch(`/`.Delete(` registrations remain in the router. (grep: zero matches)
- [x] A-028 Frontend verbs migrated: `setSessionOrder`/`setThemePreference`/`setServerColor` issue POST with unchanged bodies. (client.ts:57-64, :432-448, :466-473; grep: zero PUT in frontend src)
- [x] A-029 Route is `/$server/$window`: `$session` is removed from the route definition and `parseParams`; all `app.tsx` navigates target the 2-segment shape. (router.tsx:47-56; app.tsx 6 navigate sites all `/$server/$window`)
- [x] A-030 Identity keyed on `@N`: `pendingClickRef`/`urlMatchesPending` compare window id only — the session name is not ANDed into identity. (app.tsx:307 `{windowId}`, :411 `pending.windowId === windowParam`)

### Behavioral Correctness

<!-- Changed behaviors verified, not the old behavior. -->

- [x] A-031 Atomic option application: `/options`, `handleWindowCreate`, and `MoveWindow` mutations are each a single tmux invocation; the SSE poll never observes a half-applied state. (SetWindowOptions:928 one exec; CreateWindowWithOptions:944 one exec; MoveWindow:853 one chained exec)
- [x] A-032 `@color` wire-type change: the unified body carries `@color` as a string, integer-parsed and range-checked server-side, preserving the old `Color *int` 0–15 contract in effect. (windows.go validateWindowOption:346-355; client.ts:347-349 String(color))
- [x] A-033 Session derived from snapshot: the breadcrumb/title session name comes from `@N`'s active-window SSE snapshot, not a URL segment. (app.tsx:144-154 currentSession via `sessions.find(...windows...windowId===windowParam)`, sessionName = currentSession?.name)
- [x] A-034 Deep link resolves session server-side: `/$server/@N` derives the owning session from the first snapshot and aligns tmux to `@N` via mount-time alignment (window-id-only comparison). (app.tsx:368-392, compares `activeId !== windowParam`)
- [x] A-035 URL writeback uses window id only: an external `select-window`/`rk riff` change navigates to `/$server/@9` (no session param) and all tabs converge. (app.tsx:419-424 navigates `{server, window: activeWindow.windowId}`)
- [x] A-036 Selection survives session rename: a pending click on `@N` whose session is renamed keeps `urlMatchesPending` true; the suppression is not released early and the selection does not bounce. (app.tsx:406-417 matches on windowId only; onSessionRenamed app.tsx:454-459 no longer navigates when a window is in view)
- [x] A-037 Selection survives cross-session move: a pending click on `@N` moved to a different session (`@N` preserved) holds the click intent. (app.tsx:411 windowId-only match — session change does not release suppression)
- [x] A-038 Single-step move still works: an adjacent-target move executes in one invocation and returns `200 {"ok":true}`. (tmux.go:836-855 single-step emits one swap in the chain; test TestMoveWindow_reordersAndPreservesID)

### Removal Verification

<!-- Deprecated requirements are actually gone, no dead code. -->

- [x] A-021b Old option routes gone: `POST /color`, `PUT /url`, `PUT /type` are unregistered; `handleWindowColor`/`handleWindowUrlUpdate`/`handleWindowTypeUpdate` are deleted with no orphaned references. (grep: zero handler/route references)
- [x] A-010b `KillPane` fully removed: a backend-wide search finds zero `KillPane` references; the build succeeds. (grep exit 2 = no matches; `just test-backend` compiles rk/api + rk/internal/tmux ok)
- [x] A-027b Old PUT verbs gone: `sessions/order`, `settings/theme`, `settings/server-color` no longer register PUT; the frontend issues no PUT. (router.go all `.Post`; client.ts grep: zero PUT)
- [x] A-029b Old route shape gone: `/$server/$session/$window` no longer matches; a session-bearing bookmark falls through to the not-found / server-dashboard fallback (hard break, no redirect shim). (router.tsx:47-56 only `/$window`; notFoundComponent NotFoundPage wired at :27)

### Scenario Coverage

<!-- Key spec scenarios exercised by tests. -->

- [x] A-039 Backend unit tests cover: `/select` re-route + resolve-failure, `decodeWindowID` (REST + decode-failure), `/options` (set/unset/multi/invalid-color/empty-url/unknown-key), `MoveWindow` multi-step + single-step + chained primitive, session-order POST, theme/server-color POST, and the `KillPane` removal compiles — all run via `just test-backend`. (windows_test.go + tmux_test.go + sessions_test.go + settings_test.go; `just test-backend` passes for rk/api + rk/internal/tmux)
- [x] A-040 E2E + companion docs: every touched `*.spec.ts` (`sidebar-window-sync`, `multi-server-sidebar`, plus `mobile-touch-scroll`) exercises the `/$server/$window` shape and ships an updated sibling `*.spec.md` in the same commit; specs run via `just test-e2e`/`just pw`. (all 3 `.spec.ts` migrated to 2-segment URLs; all 3 `.spec.md` modified in this change — verified via git status. NOTE: `just test-e2e` not executed — sandbox infra cannot run Playwright; code + companions verified statically)

### Edge Cases & Error Handling

- [x] A-041 Stale `@N` on `/select`: resolution failure surfaces an error and spawns no tmux subprocess against the stale id. (windows.go:192-198; test TestWindowSelectResolveFailure)
- [x] A-042 Decode failure pre-tmux: a segment failing `PathUnescape` or `ValidateWindowID` is rejected (400 REST / WS close) before any tmux call, at both entry points. (windows.go:110-118; relay.go:70-74 pre-upgrade; test TestDecodeWindowID)
- [x] A-043 `/options` partial failure is atomic: a body mixing one valid and one invalid key yields 400 with zero tmux calls. (windows.go:394-413; test TestWindowOptionsUnknownKeyRejected uses `{"@color":"5","@evil":"x"}`)
- [x] A-044 Empty/whitespace theme on POST: still returns 400, matching the former PUT handler. (settings.go:34-63; test TestSetTheme_emptyRejected covers `{}`,`""`,`"   "`)
- [x] A-045 Move no-op / sentinel: `srcIndex == dstIndex` returns without a swap; a past-the-end target lands the window at the end (full swaps), unchanged from before. (tmux.go:788-790 no-op, :818-823 sentinel)

### Code Quality

<!-- Baseline + items per fab/project/code-quality.md principles & anti-patterns relevant to this change. -->

- [x] A-046 Pattern consistency: new code follows surrounding naming/structure (handler shape, `withTimeout`/context usage, `tmuxExecServer` argv style, client.ts fetch helpers). (handlers mirror existing parseWindowID→validate→writeJSON shape; SetWindowOptions uses tmuxExecServer argv; client.ts uses withServer + throwOnError)
- [x] A-047 No unnecessary duplication: the decode+validate logic and the chained set-option logic each live in exactly one place (helper / primitive reused), per the anti-pattern "duplicating existing utilities". (decodeWindowID single helper; appendOptionOps shared by SetWindowOptions + CreateWindowWithOptions)
- [x] A-048 §I Security First: every new/changed tmux call uses `exec.CommandContext` via `tmuxExecServer` with an argv slice and a timeout context — no shell strings, no inline tmux construction outside `internal/tmux/`. (all new tmux mutations route through tmuxExecServer with argv slices; handlers use 5s timeout contexts)
- [x] A-049 No dead code: `KillPane` and the three removed handlers leave no orphaned references, imports, or mock stubs. (grep: zero KillPane / handleWindowColor / handleWindowUrlUpdate / handleWindowTypeUpdate references)
- [x] A-050 Test coverage: new/changed behavior (select, options, decode, move, verb migrations, frontend identity/route) is covered by tests per "new features and bug fixes MUST include tests"; touched e2e specs use the `coarse:`/viewport conventions only where already present (no regressions). (backend + client.test.ts + e2e all updated)
- [x] A-051 Type narrowing (frontend): the `options` payload and derived-session logic use `if` guards / discriminated handling over `as` casts where reasonable. (app.tsx:144-154 uses `.find`/`.some` + `?.` narrowing, no casts; client.ts `Record<string, string|null>` typed payload, no `as`)

### Security

- [x] A-052 `/options` allowlist bounds the surface: only `@color`/`@rk_url`/`@rk_type` reach `tmux set-option`; arbitrary client-supplied option names are rejected with 400 before any subprocess (§I — closed key set, per-key validation). (windows.go:396-401 switch-default rejects unknown keys before any SetWindowOptions call; test TestWindowOptionsUnknownKeyRejected)
- [x] A-053 Window id validated before tmux at both entry points: `decodeWindowID` enforces `^@[0-9]+$` (via `ValidateWindowID`) before any `/select`, `/options`, or relay tmux call. (windows.go:110-118; both parseWindowID and handleRelay gate on it before any tmux op)

## Notes

- Check items as you review: `- [x]`.
- All acceptance items must pass before `/fab-continue` (hydrate).
- Spec/code reconciliations the plan accounts for:
  - `handleWindowUrlUpdate` and `handleWindowTypeUpdate` **already** use `SetWindowOption`/`UnsetWindowOption` (windows.go:350,379,384) rather than raw tmux — only `handleWindowColor` uses the dedicated `SetWindowColor`/`UnsetWindowColor`. The `/options` handler converges all three onto the T001 chained primitive; the URL/type migration is therefore a route+shape consolidation, not a from-raw-tmux rewrite.
  - There is **no existing `TestWindowSelect`** in `windows_test.go`; the `/select` re-route requires a brand-new test (T023). The mock already exposes `selectWindowInSessionCalled`/`resolveWindowSessionResult` to support it.
  - `TestMoveWindow_reordersAndPreservesID` and `TestMoveWindowToSession_*` run against a real go-test tmux server (tmux_test.go:801,837); T026 keeps them green and adds a multi-step case.
  - No `settings_test.go` exists yet — theme/server-color POST coverage is net-new (T029).
  - Constitution §IV doc-lag (route still textually `/$session/$window`) is reconciled at hydrate, not in this change (per spec note).

## Deletion Candidates

- `tmux.SelectWindow` (`app/backend/internal/tmux/tmux.go:1030-1037`) — the bare-target select is now dead in production: `handleWindowSelect` was re-routed to `SelectWindowInSession` (A-001), and the relay already uses the scoped form. Only the `TmuxOps` interface (router.go:39), the `prodTmuxOps` wrapper (router.go:141-143), and the test mock (sessions_test.go:257) still reference it. Out of this change's stated scope (spec only mandated `KillPane` removal), but it is now a zero-production-call-site function whose existence re-invites the exact group-ambiguous bare-select bug this change fixed — strong candidate for follow-up removal.
- `tmux.SetWindowColor` / `tmux.UnsetWindowColor` (`tmux.go:1012-1028`) — sole production caller was the deleted `handleWindowColor`. Now referenced only by the `TmuxOps` interface (router.go:47-48), the wrapper (router.go:165-170), and the mock (sessions_test.go:290-306). Superseded by the `@color` path through `SetWindowOptions`.
- `tmux.SetWindowOption` / `tmux.UnsetWindowOption` (singular) (`tmux.go:872-882`) — sole production callers were the deleted `handleWindowUrlUpdate`/`handleWindowTypeUpdate`. Now referenced only by the `TmuxOps` interface (router.go:53-54), the wrapper (router.go:183-188), and the mock (sessions_test.go:322-334). Superseded by the batched `SetWindowOptions` primitive.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plan inherits all 14 spec assumptions verbatim | Plan generation does not re-open spec decisions; the spec's Assumptions table is the scoring source | S:95 R:80 A:95 D:95 |
| 2 | Confident | `CreateWindowWithOptions` is refactored to delegate to the new chained primitive (T001/T010) rather than keeping its own `";"` loop | Spec requires `handleWindowCreate` to reuse the primitive "with no separate inline option-map construction path"; the cleanest read is one shared chaining function, though keeping `CreateWindowWithOptions`'s internal loop and only routing the handler through it is a valid alternative — left to the implementer | S:75 R:70 A:80 D:70 |
| 3 | Confident | Session is derived by locating `@N` within the existing per-session SSE `windows[]` arrays (no new backend endpoint) | The snapshot already carries session names per window (`sessions[].windows[]`); spec says "derive from the active window's SSE snapshot", and a new server endpoint would violate §IV minimal-surface | S:80 R:65 A:85 D:80 |
| 4 | Confident | Old session-bearing URLs render the existing `NotFoundPage`/server-dashboard fallback (no new not-found UI) | Spec mandates a hard break "consistent with the documented hard-break policy"; `router.tsx` already wires `notFoundComponent: NotFoundPage` and a `serverIndexRoute` dashboard | S:80 R:70 A:85 D:75 |
| 5 | Confident | Handler renames (`handlePutTheme` etc.) are optional polish, not required by spec | Spec only mandates the verb on the route + client; bodies/responses are unchanged, so renaming is a readability nicety gated on reviewer preference | S:80 R:85 A:80 D:80 |
| 6 | Certain | The incidental-e2e audit resolved: exactly three specs hard-code the 3-segment URL — `sidebar-window-sync` (:172,:184,:244) + `multi-server-sidebar` (:88) via assertions (T031), and `mobile-touch-scroll` (:89,:152,:171) via direct `page.goto` (T032). All other e2e specs `goto` only `/${TMUX_SERVER}` and are route-shape-agnostic | Clarified — grepped `app/frontend/tests/e2e/` for every `goto`/`toHaveURL`/`url()`; confirmed the complete set of 3-segment usages. `mobile-touch-scroll` was missing from the original T032 list and would have broken at its first `goto` once `$session` left the route; now explicitly covered | S:95 R:60 A:90 D:90 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
