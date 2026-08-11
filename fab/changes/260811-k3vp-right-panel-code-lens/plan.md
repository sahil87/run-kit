# Plan: Right Panel Phase 2 — Code Lens & CODE Surface

**Change**: 260811-k3vp-right-panel-code-lens
**Intake**: `intake.md`

## Requirements

### Backend: Proxy prerequisites (spiked, proven 2026-08-11)

#### R1: X-Forwarded headers on proxied requests
The `/proxy/{port}` ReverseProxy MUST call `r.SetXForwarded()` inside its `Rewrite` hook (beside the existing `r.Out.Host = target.Host`), so code-server's `authenticateOrigin` sees an `X-Forwarded-Host` matching the browser's `Origin` host. Without it every WebSocket handshake and POST is 403'd while plain GETs load — "editor loads, then sits disconnected forever".

- **GIVEN** the rk backend proxies a request for `/proxy/{port}/...`
- **WHEN** the request is forwarded upstream (plain HTTP AND the WS upgrade path)
- **THEN** the upstream receives `X-Forwarded-Host` (and `X-Forwarded-Proto`) derived from the inbound request

#### R2: Trailing-slash redirect
A request for `/proxy/{port}` (no trailing slash) MUST redirect (308, query string preserved) to `/proxy/{port}/` instead of being proxied, so relative-base apps (code-server) resolve `./x` against the correct base for ANY client, not only ones that always append a path.

- **GIVEN** a request to `/proxy/8080?folder=/repo` (no trailing slash)
- **WHEN** the backend handles it
- **THEN** it responds with a 308 redirect to `/proxy/8080/?folder=/repo`
- **AND** requests to `/proxy/8080/...` are proxied exactly as before (no redirect loop)

#### R3: `RK_CODE_SERVER_PORT` configuration
The backend MUST read an optional `RK_CODE_SERVER_PORT` env var (`.env` / `.env.local`, Constitution IV). Unset, empty, or invalid (non-numeric / out of 1–65535) ⇒ 0 ⇒ the code lens/surface is OFF everywhere (no rail button, no switcher segment, no availability). The value is a PORT, not a URL, because the embed rides the same-origin relative `/proxy/{port}/` path. The port is state identity (code-server keys browser workspace state by the proxy pathname) — this MUST be documented beside the env var.

- **GIVEN** `RK_CODE_SERVER_PORT=8080` in the environment
- **WHEN** the backend loads config
- **THEN** `Config.CodeServerPort == 8080`
- **AND** with the var unset or `abc`/`99999`, it is 0 (feature off)

### Backend: Derived availability (Constitution II/X — derive, don't store)

#### R4: Per-window `gitRoot` on the session payload
Every window in the FetchSessions result (GET `/api/sessions` AND the state-socket `sessions` event — same marshal) MUST carry a derived `gitRoot`: the window's active-pane cwd (else first pane's cwd, else the window's worktree path) resolved through `config.FindGitRoot` (the shipped filesystem-walk precedent; api/riff.go's `deriveRepoRoot`/`windowCwd` is the pattern source). Empty when the cwd is not inside a git repo. Keyed by git ROOT, never window id or raw cwd.

- **GIVEN** a window whose active pane cwd is `<repo>/app/backend`
- **WHEN** sessions are fetched
- **THEN** the window's JSON carries `gitRoot: "<repo>"`
- **AND** a window whose cwd is not a repo (e.g. `/tmp`) carries no `gitRoot`

#### R5: TTL-cached reachability probe + host-level broadcast
When `CodeServerPort` is configured, the SSE hub MUST broadcast a host-global `code-server` event `{"port": N, "reachable": bool}` on its existing poll tick, with reachability from a TTL-cached (~5s) TCP dial of `127.0.0.1:{port}` (short dial timeout; NEVER a per-request dial). The latest payload MUST be cached in a replay slot and re-sent on connect (mirroring `cachedServicesJSON`), so late-joining clients see it. When the port is unconfigured, nothing is broadcast and the slot stays empty.

- **GIVEN** `RK_CODE_SERVER_PORT=3999` and a listener on `127.0.0.1:3999`
- **WHEN** the poll loop ticks
- **THEN** every state-socket connection receives `event: code-server` with `{"port":3999,"reachable":true}`
- **AND** when the listener goes away, a later tick reports `reachable:false` (within the probe TTL)

### Frontend: the `code` lens (view registry)

#### R6: `code` joins the View Registry
`ViewName` MUST gain `"code"`; `availableViews` includes it exactly when the window's `gitRoot` is non-empty AND the code-server port is configured (host-level signal); `resolveView` MUST fall through to `tty` for an unavailable `?view=code`. The switcher grows a `code` segment / `View: Code` menu row and the palette gains `View: Code` (Constitution V parity). `code` contributes NO default-view hint (mirroring `chat`).

- **GIVEN** a window with `gitRoot` set and the port configured
- **WHEN** the terminal route renders
- **THEN** `code` is in the capability set and `?view=code` renders the code lens in the main slot
- **AND** the same URL on a window without `gitRoot` (or with the port unset) renders the terminal

#### R7: Code lens renderer
The main slot MUST render the code lens as a NEW lean `code-surface.tsx` component (NOT `IframeWindow` — the URL bar is `@rk_url` substrate state, meaningless for a fully derived URL): an iframe of the RELATIVE path `/proxy/{port}/?folder=<absolute git root>` (never a composed absolute origin). When the port is configured but unreachable, the surface renders a terse monospace empty state ("code-server not running on :{port}") instead of a dead iframe.

- **GIVEN** `?view=code` on a code-available window with a reachable code-server
- **WHEN** the main slot renders
- **THEN** the iframe `src` is exactly `/proxy/{port}/?folder=<gitRoot>` (folder value URL-encoded)
- **AND** when the probe reports unreachable, the empty state renders in place of the iframe

### Frontend: the CODE panel surface

#### R8: `code` joins the Surface Registry
`SurfaceName` MUST gain `"code"` with `availableSurfaces` mirroring the view gate (gitRoot present AND port configured); the rail gains the code button with the phase-1 availability-dot treatment; the palette gains `Panel: Code` beside `Panel: Web`; `?panel=code` deep-links open it; per-window persistence (P1), one-surface-at-a-time (P6), and the desktop-only gate apply unchanged.

- **GIVEN** a desktop terminal route on a code-available window
- **WHEN** the user clicks the code rail button (or opens `?panel=code`)
- **THEN** the panel renders the code surface beside the live terminal and the URL/localStorage state round-trips
- **AND** a window without `gitRoot` shows no code button and `?panel=code` resolves closed

#### R9: Hide-never-unmount across surface switches (P3)
Switching between surfaces (or collapsing the panel) MUST hide the inactive surface at display level, never unmount it — both the `web` and `code` subtrees stay mounted while the route lives, so iframe state (editor tabs/scroll) survives.

- **GIVEN** the `web` surface open, then the user switches to `code`
- **WHEN** the swap renders
- **THEN** the web iframe element stays in the DOM (display-hidden) and the same element handle is visible again when switching back

### Frontend: iframe sandbox

#### R10: `allow-downloads`
The shared iframe sandbox attribute (`iframe-window.tsx`, reused shape in `code-surface.tsx`) MUST include `allow-downloads` — without it VS Code file downloads break.

- **GIVEN** any proxied iframe run-kit renders
- **WHEN** the sandbox attribute is inspected
- **THEN** it contains `allow-downloads` alongside the existing tokens

### Spike: keyboard capture (time-boxed, non-blocking)

#### R11: Chord-reclaim spike
The change MUST spike a capture-phase `keydown` listener attached to the code iframe's same-origin `contentDocument` (after load) that intercepts run-kit's registry chords before the embedded app's keybinding service sees them and re-dispatches them to the parent window. If the spike works, wire it for the registry chords; if it does not, ship WITHOUT chord-reclaim and document the limitation (click-out remains the escape). The spike MUST NOT block the rest of the change; its outcome MUST be recorded either way (plan Notes + memory at hydrate).

- **GIVEN** focus inside the code iframe (a same-origin stub page in e2e)
- **WHEN** the user presses a run-kit registry chord (e.g. the palette chord)
- **THEN** the spike determines whether the parent's handler fires despite iframe focus

### Docs

#### R12: Spec amendment — availability vs reachability
`docs/specs/right-panel.md` § Surface Registry's `code` row MUST be amended so availability = port configured AND git root derived (stable capability signals), while reachability governs the rendered CONTENT (live iframe vs the not-running empty state) — resolving the spec's internal tension.

- **GIVEN** the current spec row ("configured and reachable")
- **WHEN** the change lands
- **THEN** the row reads availability as configured+derivable, with reachability called out as content state

### Non-Goals

- rk-managed code-server lifecycle (install/start/stop) — v1 is configured, not managed (spec § The code lens, Topology)
- `@rk_owner` companions + `agents` surface — phase 3 (backlog [w7qc])
- Mobile panel/sheet — desktop-only, unchanged from phase 1
- URL bar / refresh chrome on the code surface — the URL is fully derived
- Per-browser layout-state UI callout (spec Open Question 2) — accepted silently in v1

## Tasks

### Phase 1: Backend — proxy prerequisites & config

- [x] T001 Add `r.SetXForwarded()` to the proxy `Rewrite` hook in `app/backend/api/proxy.go` + httptest coverage in `app/backend/api/proxy_test.go` asserting `X-Forwarded-Host` reaches the upstream (plain request; the upgrade path shares the Rewrite hook) <!-- R1 -->
- [x] T002 Redirect `/proxy/{port}` → `/proxy/{port}/` (308, RawQuery preserved) in `handleProxy` in `app/backend/api/proxy.go` + tests (redirect target, no loop on slashed path, invalid ports still 400) <!-- R2 -->
- [x] T003 Add `CodeServerPort int` to `app/backend/internal/config/config.go` reading `RK_CODE_SERVER_PORT` (invalid/out-of-range ⇒ 0) + cases in `app/backend/internal/config/config_test.go` <!-- R3 -->
- [x] T004 [P] Add `allow-downloads` to the iframe sandbox in `app/frontend/src/components/iframe-window.tsx` <!-- R10 -->

### Phase 2: Backend — derived availability

- [x] T005 Add `GitRoot string \`json:"gitRoot,omitempty"\`` to `tmux.WindowInfo` (`app/backend/internal/tmux/tmux.go`) and derive it in `internal/sessions/sessions.go` `FetchSessions` enrichment (active-pane cwd → first pane cwd → worktree path, then `config.FindGitRoot`) + unit coverage in `internal/sessions/sessions_test.go` (temp repo fixture, non-repo case) <!-- R4 -->
- [x] T006 <!-- rework: review must-fix: SetCodeServerPort has zero call sites — delete the setter or exercise it from a router-level test --> Wire the code-server signal through the SSE hub (`app/backend/api/sse.go`, `router.go`): `Server.codeServerPort` seeded from `config.Load()` (+ `SetCodeServerPort` test seam), TTL-cached (~5s) TCP reachability probe of `127.0.0.1:{port}` on the poll tick, host-global `code-server` event `{"port":N,"reachable":bool}` + `cachedCodeServerJSON` replay slot in `replayGlobalSlots`; tests in `app/backend/api/sse_test.go` (listener up/down, unconfigured ⇒ no event) <!-- R5 -->

### Phase 3: Frontend — registries, renderer, wiring

- [x] T007 `app/frontend/src/lib/window-view.ts`: `ViewName` gains `"code"`, `ViewWindow` gains `gitRoot?: string`, new `hasCode(win, codeServerPort)` gate, `availableViews`/`resolveView` take an optional `codeServerPort` (default 0); update `window-view.test.ts` (availability, fall-through, no default hint) <!-- R6 -->
- [x] T008 [P] `app/frontend/src/lib/right-panel.ts`: `SurfaceName` gains `"code"`, `availableSurfaces`/`resolvePanel` mirror the gate (optional `codeServerPort` param); update `right-panel.test.ts` <!-- R8 -->
- [x] T009 [P] `app/frontend/src/lib/router-url.ts`: `TerminalSearch` unions gain `"code"` for `view` and `panel`, `validateTerminalSearch` accepts them; update `router-url.test.ts` <!-- R6 -->
- [x] T010 <!-- rework: review should-fix: chord-reclaim effect runs once with [] deps; iframe mounted after a reachability flip never gets the listener — key on reachable + cleanup --> New `app/frontend/src/components/code-surface.tsx`: lean renderer — `codeServerSrc(port, gitRoot)` pure helper (relative `/proxy/{port}/?folder=<encoded root>`), iframe with the sandbox incl. `allow-downloads`, monospace not-running empty state when `reachable` is false; unit test `code-surface.test.tsx` (src shape, sandbox, empty-state branch) <!-- R7 -->
- [x] T011 Frontend plumbing: `gitRoot?: string` on `WindowInfo` in `app/frontend/src/types.ts`; `code-server` global event handled in `app/frontend/src/contexts/session-context.tsx` (raw-payload dedup like `services`) + a `useCodeServer()` hook returning `{ port, reachable }`; context test addition <!-- R5 -->
- [x] T012 <!-- rework: review should-fix: panel-toggle chord hint absent on code-only windows (Panel: Code carries no shortcut hint) — palette-parity gap --> `app/frontend/src/app.tsx`: pass the configured port into `availableViews`/`resolveView`/`availableSurfaces`/`resolvePanel` (incl. the window-transition `resolveView` call at ~line 1446); render `CodeSurface` for `resolvedView === "code"` in the main slot; restructure the `RightPanel` children so EACH available surface renders its own subtree hidden unless active (P3 across surface switches); palette `Panel: Code` beside `Panel: Web`; generalize the `panel-toggle` chord (⇧⌘.) to toggle the open surface, else the first available (spec P7 "last-used") <!-- R6, R7, R8, R9 -->
- [x] T013 `app/frontend/src/components/view-switcher.tsx` + `app/frontend/src/lib/palette-view.ts`: `code` labels/short glyphs, `DISPLAY_ORDER` (`tty, web, code, chat`), `View: Code` palette label <!-- R6 -->
- [x] T014 Keyboard-capture spike (time-boxed): capture-phase `keydown` listener on the code iframe's `contentDocument` in `code-surface.tsx` gated by a `shouldReclaimChord` predicate prop (app.tsx passes "matches a resolved registry binding"); on match `preventDefault`/`stopPropagation` + re-dispatch a synthetic `KeyboardEvent` on the parent window. Verify via e2e (T017). If it fails: remove the wiring, record the outcome in `## Notes` here; the spike MUST NOT block other tasks <!-- R11 -->

### Phase 4: Docs & e2e

- [x] T015 <!-- rework: review should-fix: window-views.md View Registry table still lacks the code row this change's own spec amendment promises --> Amend `docs/specs/right-panel.md` § Surface Registry `code` row (availability vs reachability split) + mark the `code` lens shipped in the header note; document `RK_CODE_SERVER_PORT` + the port-stability warning as a commented var in the committed `.env` <!-- R12, R3 -->
- [x] T016 E2E harness support: `scripts/test-e2e.sh` exports `RK_CODE_SERVER_PORT` (default 3939) to the dev backend AND to the playwright run; `tests/e2e/_tmux.ts` `newWindow` gains a `cwd` option (`-c` flag) for non-repo windows <!-- R4, R5 -->
- [x] T017 New `app/frontend/tests/e2e/code-surface.spec.ts` + sibling `code-surface.spec.md` (constitution Test Companion Docs): stub HTTP server on the configured port (node `http` in the spec); assert rail button + `View: Code` menu row appear only with git-repo cwd AND configured port; panel iframe `src` is `/proxy/{port}/?folder=<git root>`; not-running empty state when the stub is down; `?view=code` and `?panel=code` resolve; unavailable on a `/tmp` cwd window; keyboard-spike assertion (registry chord fires the parent handler with focus inside the iframe) <!-- R6, R7, R8, R11 -->

### Phase 5: Gates

- [x] T018 Run the verification gates and fix fallout: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e code-surface` and `just test-e2e right-panel` <!-- R1–R12 -->

## Execution Order

- T001–T004 are independent ([P]-able); T005 precedes frontend availability work (T007/T008 need the `gitRoot` field name); T006 precedes T011 (event shape)
- T007–T009 are leaf-lib changes ([P]-able); T010 needs T006's event shape only conceptually (props are explicit); T011–T013 wire everything before T014's spike and T017's e2e
- T016 precedes T017; T018 is last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Proxied upstream requests carry `X-Forwarded-Host` (httptest proves it; existing proxy tests stay green)
- [x] A-002 R2: `/proxy/{port}` 308-redirects to `/proxy/{port}/` with the query preserved; slashed paths proxy without redirect
- [x] A-003 R3: `RK_CODE_SERVER_PORT` drives `Config.CodeServerPort`; unset/invalid ⇒ 0 ⇒ no code affordances anywhere
- [x] A-004 R4: Every session payload window carries `gitRoot` derived from its active pane's cwd (empty for non-repo cwds); covered by Go unit tests
- [x] A-005 R5: The state socket broadcasts `code-server {"port", "reachable"}` from a TTL-cached probe (never per-request), replayed to late-joining clients; unconfigured ⇒ no event
- [x] A-006 R6: `?view=code` renders the code lens when (gitRoot ∧ port) and falls through to `tty` otherwise; switcher + palette offer `View: Code`
- [x] A-007 R7: The code renderer's iframe `src` is the relative `/proxy/{port}/?folder=<gitRoot>`; unreachable ⇒ the not-running empty state renders instead of a dead iframe
- [x] A-008 R8: The rail shows the code button under the same gate; `?panel=code` deep-links; `Panel: Code` palette entry exists; unavailable windows show neither
- [x] A-009 R9: Switching surfaces or collapsing the panel never unmounts either surface's iframe (same element handles across toggles — e2e)
- [x] A-010 R10: Both iframe renderers' sandbox attributes contain `allow-downloads`
- [x] A-011 R11: The keyboard spike ran and its outcome (wired chords OR documented fallback) is recorded in plan Notes
- [x] A-012 R12: `docs/specs/right-panel.md` § Surface Registry reads availability = configured ∧ derivable, reachability = content state

### Scenario Coverage

- [x] A-013 R6/R8: E2E proves rail button + `View: Code` row appear only for a git-repo-cwd window with the port configured, and never for a `/tmp`-cwd window
- [x] A-014 R5/R7: E2E proves the not-running empty state renders when the stub server is down and the iframe renders when it is up

### Edge Cases & Error Handling

- [x] A-015 R2/R3: Invalid ports still 400; invalid `RK_CODE_SERVER_PORT` values disable the feature without crashing
- [x] A-016 R4: A pane whose cwd vanished or is not a repo yields empty `gitRoot` (no error, no availability)

### Code Quality

- [x] A-017 Pattern consistency: New code mirrors the phase-1 shapes (pure lib helpers + colocated tests; `SetSSHHost`-style config seam; `cachedServicesJSON`-style replay slot; `applyHostServices`-style context dedup)
- [x] A-018 No unnecessary duplication: `config.FindGitRoot` reused (not reimplemented); the proxy path discipline reuses the relative-`/proxy/` convention
- [x] A-019 Test integrity: New behavior covered test-alongside (Go, Vitest, Playwright + `.spec.md` companion per constitution)
- [x] A-020 No shell-string subprocess construction; all exec via `exec.CommandContext` with timeouts (no new subprocess calls expected — `FindGitRoot` is a filesystem walk)
- [x] A-021 New/changed keyboard behavior documented in the palette registration (code-review rule)

### Security

- [x] A-022 R1/R7: The proxy changes introduce no open-redirect or header-injection surface (redirect target is path-only; `SetXForwarded` is stdlib); the iframe embed stays same-origin-relative

## Notes

- Check items as you review: `- [x]`
- Keyboard spike outcome (T014, intake §5): **WORKS — chord-reclaim shipped.** A capture-phase `keydown` listener on the code iframe's same-origin `contentDocument` intercepts events matching the keybinding registry (`findMatches` over `useKeybindings().bindings`, injected as `shouldReclaimChord`), stops them before the embedded app's keybinding service, and re-dispatches a synthetic `KeyboardEvent` on the parent **document** (bubbling reaches both the palette's document-level chord listener and the window-level dispatcher). Proven by the e2e test "keyboard spike: a registry chord pressed INSIDE the iframe reaches the parent" (stub same-origin page; Ctrl+K opens the palette). First attempt dispatched on `window` and missed document-level listeners — fixed. Caveat for real code-server (unverifiable here — code-server is not installable in the test env): a hypothetical window-level CAPTURE listener inside the iframe with `stopImmediatePropagation` would still win over a document-level one; VS Code's keybinding service dispatches at window bubble/target, so the reclaim is expected to hold — verify once against a live code-server on first real run.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Cycle-1 review's zero-call-site `Server.SetCodeServerPort` seam was deleted in rework; re-review confirms no new dead symbols.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The code-server signal rides a NEW host-global `code-server` event `{"port", "reachable"}` with a `cachedServicesJSON`-style replay slot — not a `metrics`-JSON piggyback | The metrics snapshot type is owned by `internal/metrics`; a dedicated event mirrors the `services` precedent exactly and keeps both payloads' contracts untouched. Intake §2 explicitly leaves "metrics/hello frame vs dedicated" as apply's call | S:70 R:80 A:80 D:70 |
| 2 | Confident | The port travels INSIDE that event (not on `GET /api/health`) | One mechanism for both facts; env config is process-static so the every-tick broadcast is dedup-stable client-side (raw-payload compare), and late joiners get the replay slot | S:70 R:85 A:75 D:70 |
| 3 | Confident | Probe = bare TCP dial `127.0.0.1:{port}` (~500ms timeout), TTL-cached ~5s inside the hub, executed outside the hub lock | Intake §2's stated shape; localhost refused/fast-fail makes the poll-loop stall bounded; HTTP would add body/redirect handling for zero gating value | S:70 R:85 A:80 D:70 |
| 4 | Confident | `availableViews`/`resolveView`/`availableSurfaces`/`resolvePanel` gain an OPTIONAL trailing `codeServerPort = 0` param rather than a new context object | Existing callers/tests compile unchanged; the gate needs exactly one scalar; a wrapper type would churn every signature for no behavior gain | S:70 R:80 A:75 D:65 |
| 5 | Confident | Registry placement: `code` contributes NO default-view hint (mirrors `chat`); `HINT_ORDER = [chat, code, web, tty]`; switcher `DISPLAY_ORDER = [tty, web, code, chat]` | A code-capable window must keep defaulting to `tty` (terminal-first ethos, window-views R3/R5); display order keeps shipped segments stable, inserting `code` before `chat` | S:65 R:85 A:75 D:65 |
| 6 | Confident | The `panel-toggle` chord (⇧⌘.) generalizes to "toggle the open surface, else the first available" instead of hardcoding `web` | Spec P7 ("toggles the last-used surface") with the value-bearing-key model means stored-last-used only exists while open; first-available is the deterministic fallback. Web-only behavior (phase-1 e2e) is preserved | S:65 R:80 A:75 D:65 |
| 7 | Certain | The `gitRoot` derivation lives in `internal/sessions` `FetchSessions` enrichment beside `rollupChat`, with a local window-cwd helper (api's `windowCwd` is not importable — api imports sessions, not vice versa) | One derivation feeding BOTH `GET /api/sessions` and the state-socket marshal; `config.FindGitRoot` is a cheap stat-walk, no subprocess | S:85 R:85 A:85 D:80 |
| 8 | Confident | The chord-reclaim predicate is injected into `CodeSurface` as a `shouldReclaimChord` prop built in `app.tsx` from the keybinding registry's `findMatches` | Keeps the component free of the registry import graph (the phase-1 presentational-shell contract); reclaiming only registry chords leaves VS Code's own `Ctrl+…` bindings alone | S:60 R:80 A:70 D:65 |
| 9 | Confident | E2E uses port 3939 (env-overridable) with an in-spec node stub server; `scripts/test-e2e.sh` seeds `RK_CODE_SERVER_PORT` for both the backend and the playwright run | code-server is not installable in the test env (intake assumption 13); a fixed default keeps the recipe and the spec in sync with one constant | S:70 R:85 A:80 D:70 |

9 assumptions (1 certain, 8 confident, 0 tentative).
