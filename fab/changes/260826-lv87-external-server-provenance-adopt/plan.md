# Plan: External Server Provenance & Adopt

**Change**: 260826-lv87-external-server-provenance-adopt
**Intake**: `intake.md`

## Requirements

### Backend: `@rk_managed` provenance marker

#### R1: Managed server class — option, helpers, daemon derivation
A new server-scoped tmux user option `@rk_managed` (const `ManagedOption`, canonical value `"1"`) SHALL mark a server as rk-managed, mirroring the `@rk_ephemeral`/`@rk_protected` precedent exactly (`app/backend/internal/tmux/tmux.go:55`/`:67`). Writers `MarkServerManaged(ctx, server)` (`set-option -s @rk_managed 1`) and `UnmarkServerManaged(ctx, server)` (`set-option -s -u`) SHALL require a live server. The exported reader SHALL be the **combined** predicate `IsManagedServer(ctx, name)`: true when `name == productionDaemonServer` (derivation from the constant name, short-circuiting BEFORE any tmux read — the `IsGuardedServer` pattern) OR the option reads present with a non-empty trimmed value; the option read SHALL follow `IsProtectedServer`'s taxonomy verbatim — unset option or dead/absent socket (`IsServerGone`) reads `(false, nil)`, other subprocess failures propagate wrapped. Everything reads from tmux at request time — no new state store (Constitution II/X).

- **GIVEN** a server marked `set-option -s @rk_managed 1`
- **WHEN** `IsManagedServer(ctx, name)` runs
- **THEN** it returns `(true, nil)`; **AND GIVEN** the name `rk-daemon` on a socket with no live server, **THEN** it returns `(true, nil)` with no subprocess spawned; **AND GIVEN** an unmarked live server, **THEN** `(false, nil)`.

#### R2: Birth stamping at every rk server-birth seam
Every rk path that births (starts) a tmux server SHALL stamp `@rk_managed` on the newborn server — the moment its `-f <managed conf>` actually applies:

1. **`tmux.CreateSession`** (`internal/tmux/tmux.go:1365`): probe `ServerAlive` immediately BEFORE the `new-session` exec; when the probe read dead/absent (this call births the server) and the create succeeds, call `MarkServerManaged`. A stamp failure SHALL log at warn and MUST NOT fail the create (the server degrades to external; adopt recovers). This seam transitively covers `rk mux new` (`cmd/rk/mux_new.go` — its own pre-probe already guarantees its create births), `POST` session create (`api/sessions.go:50`), server create (`api/servers.go:146`), and riff (no `new-session` exists in `internal/riff/` — verify during implementation).
2. **`tmux.CreateSessionForRestore`** (`internal/tmux/layout.go:302`): the same probe-before/stamp-after-birth treatment, so a restored server is stamped (restore applies the managed conf — see intake assumption 14).
3. **Daemon start** (`internal/daemon/daemon.go` `startSession`, the `new-session` around lines 317–393): stamp `rk-daemon` after birth, best-effort (belt-and-braces beside R1's derivation).

External = unmarked: NO option write occurs for external servers at detection time, and external servers stay fully first-class (attach, edit, kill, color, rename — guest mode; only conf-pushing stops, R3). `CreateSession`'s `-f` flag needs NO gating — tmux ignores `-f` on an already-running server.

- **GIVEN** no server on socket `scratch`
- **WHEN** `rk mux new scratch` runs
- **THEN** `IsManagedServer(ctx, "scratch")` reads true after return
- **AND GIVEN** an already-live server, **WHEN** `CreateSession` adds a session to it, **THEN** no stamp write occurs.

### Backend: Config isolation

#### R3: The three conf-apply paths are gated on `@rk_managed`
rk SHALL never source its managed tmux.conf into an external server. All three conf-apply paths gate on `IsManagedServer`, skipping unmarked servers:

1. **`RefreshSweep`** (`internal/tmux/managedconf.go:211`, invoked from `cmd/rk/serve.go:129`): per-server gate before `sweepReloadConfig(server)`; a skipped external server logs at debug and the sweep continues (the sweep still never fails daemon start). Add a `sweepIsManaged` seam var beside `sweepListServers`/`sweepReloadConfig` (`managedconf.go:197-201`) so tests substitute it.
2. **WS-attach best-effort `ReloadConfig`** (`api/terminals_ws.go:469`): call `ReloadConfig` only when the target server reads managed; a read failure or external verdict skips the reload (debug log) — the attach itself is unchanged and external servers remain fully attachable.
3. **`POST /api/tmux/reload-config`** (`api/tmux_config.go:10`, route `api/router.go:754`): an external target returns `200 {"status":"skipped","reason":"external"}` — a report, not an error; a managed target behaves as today.

- **GIVEN** a live unmarked server `ext` and a marked server `dev`
- **WHEN** a stale managed conf forces a rewrite and the sweep runs
- **THEN** `dev` receives `source-file` and `ext` receives nothing
- **AND WHEN** a terminal WS attaches to a window on `ext`, **THEN** no `ReloadConfig` subprocess runs and the attach succeeds
- **AND WHEN** `POST /api/tmux/reload-config?server=ext` runs, **THEN** the response is `200` with `status: "skipped"`.

### Backend: Adopt verb

#### R4: `POST /api/servers/adopt`
A new mutating endpoint `POST /api/servers/adopt` (Constitution IX) SHALL convert an external server to managed, mirroring the protect endpoint shape (`api/servers.go:260` `handleServerProtect`): body `{name}`, validated via `validate.ValidateServerName` before any subprocess. Behavior: an already-managed target (including `rk-daemon` by derivation) returns `200 {"status":"already-managed"}` idempotently; otherwise **stamp first, then reload** — `MarkServerManaged` then `ReloadConfig`; a failed reload SHALL best-effort `UnmarkServerManaged` and return an error (a stamped server whose conf never applied is never left behind). On success return `200 {"status":"ok"}` and wake the SSE hub so tiles repaint without waiting for the safety poll (the protect-endpoint precedent).

- **GIVEN** a live unmarked server `ext`
- **WHEN** `POST /api/servers/adopt {"name":"ext"}` succeeds
- **THEN** the server reads managed and its config was sourced; **AND GIVEN** the reload fails, **THEN** the mark is unset and the response is an error; **AND GIVEN** an already-managed target, **THEN** `200 already-managed` with no tmux mutation.

#### R5: `rk mux adopt <server>` CLI verb
A new operator-tier `rk mux` member `adopt` (new `cmd/rk/mux_adopt.go`, `mux_new.go` as the template) SHALL take exactly one positional socket name, validated via `validate.ValidateServerName` (usage error, exit 2, on violation), reject an explicitly-set inherited `-L/--server` via `muxRejectInheritedServerFlag` (exit 2), and require a live server (`tmux.ServerAlive` probe; dead/absent is operational, exit 1). It is **non-interactive** — invocation is consent (the bulk-migration role requires scriptability). Semantics match R4: already-managed prints `already managed <name>` and exits 0; otherwise stamp → reload, a failed reload unmarks and exits 1. Success prints exactly one stdout report line `adopted <name>`; diagnostics ride stderr; toolkit exit codes (0/1/2). The new surface conforms to the toolkit standards (Constitution § Toolkit Standards): registered unconditionally with `Short`/`Long`/`Example` (no backticks in flag help), the help-dump member-count assertions updated (eleven → twelve `mux` members), stdout report as data under the `outputSink` convention. The `rk skill` mux topic page is deliberately NOT extended — adopt is an operator config-mutation verb, the `reap` attractive-nuisance posture.

- **GIVEN** a live unmarked server `ext`
- **WHEN** `rk mux adopt ext` runs
- **THEN** stdout is `adopted ext`, exit 0, and the server reads managed; **AND GIVEN** it runs again, **THEN** `already managed ext`, exit 0, no mutation; **AND GIVEN** `rk mux -L foo adopt ext`, **THEN** usage error exit 2 naming `--server`; **AND GIVEN** no live server on the socket, **THEN** exit 1.

### API plumbing

#### R6: `managed` on the servers payload
`serverInfo` (`api/servers.go:34-44`) SHALL gain a `managed` bool mirroring the `Ephemeral`/`Protected` fields: read via `IsManagedServer` per live server per request in the `GET /api/servers` fan-out; a read failure logs at warn and yields `managed: false` (reads external), never a 5xx — the exact `protected` contract. The frontend `ServerInfo` type (`app/frontend/src/api/client.ts`) gains `managed?: boolean` (the additive optional-field idiom).

- **GIVEN** a marked server, the daemon server, and an unmarked server
- **WHEN** `GET /api/servers` is served
- **THEN** the marked server and `rk-daemon` carry `managed: true` and the unmarked server `managed: false`.

### Frontend: unified server-class glyph axis

#### R7: External ↗ glyph + treatments
A new external-link glyph (↗) SHALL join the shared control-glyph register (`app/frontend/src/components/top-bar-icons.tsx`, a `ControlGlyph` member beside `ShieldGlyph`), aria-hidden decoration. A server is rendered **external** only when `managed === false` (field present and false — an old backend omitting the field renders no external treatment). Provenance NEVER rides the style channel (the left-gutter marker/texture vocabulary is user-owned — `window-row.tsx:36-38`); the glyph slot is the system-owned axis. Surfaces:

1. **Sidebar server-strip tile** (`sidebar/server-panel.tsx` `ServerTile`): ↗ glyph leading the name row + dimmed name (the exact `isInfraServer` `text-text-secondary` treatment at `server-panel.tsx:230`) + the top stripe renders a **hatched** placeholder (repeating-linear-gradient in border color) ONLY when the external server has no assigned color — an assigned `server_colors` color still wins the stripe (colors are rk-side config, available to external servers under guest mode); border stays solid.
2. **Sessions-tree server header row** (`sidebar/index.tsx`, the shield's slot at `:2796`): ↗ + dimmed name on the external server's header row ONLY; nested session/window rows are completely untouched.
3. **Host-overview TMUX SERVERS tile** (`host-overview-page.tsx:462` area): ↗ inline before the name (beside the shield/`scratch`-chip slots) + the grey-name de-emphasis extended to external (`isInfraServer(name) || ephemeral || external`).
4. **Identity tip** (the ServerTile hover card body): appends ` · external — not started by run-kit` for external servers.

External tiles/rows stay fully clickable, draggable, and attachable — the treatment is identity, never a disabled state.

- **GIVEN** a server whose payload carries `managed: false`
- **WHEN** the sidebar renders
- **THEN** its strip tile shows the ↗ glyph, `text-text-secondary` name, and (uncolored) hatched stripe, and its tree header row shows ↗ + dimmed name while its session/window rows render unchanged; **AND GIVEN** `managed` absent (old backend), **THEN** no external treatment renders anywhere.

#### R8: Shield joins the server-strip tile
The `ServerTile` name row SHALL render the shared shield glyph for protected servers — the same `name === DAEMON_SERVER || protected` predicate the tree header and host tile use (`data-testid="shield-${name}"` idiom) — closing the one surface the protected-class marker missed. When a server is both protected and external (a user-protected foreign server), both glyphs render, shield first.

- **GIVEN** the `rk-daemon` server
- **WHEN** the SERVER panel renders
- **THEN** its tile name row carries the shield glyph; **AND GIVEN** an unprotected managed server, **THEN** no glyph renders and there is no layout shift.

#### R9: Palette adopt entries + confirm dialog
A new pure builder `buildServerAdoptActions(servers, onAdopt)` (`app/frontend/src/lib/palette/server-adopt.ts` + colocated vitest — the `server-protect.ts` pattern: pure, dependency-free, thin caller-supplied callback) SHALL emit one `Server: Adopt <name> into run-kit` entry (id `adopt-server-<name>`) per **external** server only (managed servers and `rk-daemon` excluded — context-scoping per Constitution V), wired in `app.tsx` beside the protect entries. Selecting an entry opens a confirm dialog in `server-dialogs.tsx` (the single layout-mounted server-dialog home, via a `requestAdoptServer` context trigger — the `requestKillServer` pattern) whose copy states the semi-irreversibility: applying run-kit's tmux config now, the user's own config returning only on server restart. Confirm calls a new `adoptServer(name)` client function (POST `/api/servers/adopt`) then `ctx.refreshServers()`; failures toast. **Explicitly out of scope** (user-rejected): a release/un-adopt verb anywhere; adopt auto-assigning a server color.

- **GIVEN** one external and one managed server
- **WHEN** the palette opens
- **THEN** exactly one `Server: Adopt … into run-kit` entry exists (the external one); **WHEN** selected and confirmed, **THEN** `POST /api/servers/adopt` fires and the server list refreshes; **AND** no `Server: Release …` entry exists anywhere.

### Non-Goals

- No `release`/un-adopt verb (user: "3 not needed") — `UnmarkServerManaged` exists only as the adopt-failure rollback.
- No auto-color on adopt — color assignment remains its own action.
- No automatic bulk stamping of pre-feature rk-born servers — they read external until restarted or adopted; `rk mux adopt` is the documented recovery (migration posture accepted by decision).
- No `rk skill` bundle/topic-page teaching of `adopt` (operator verb, the reap posture).
- No read-only mode for external servers — guest mode keeps full editing.

### Design Decisions

#### Birth detection by pre-probe inside the create seams
**Decision**: `CreateSession`/`CreateSessionForRestore` detect "this call births the server" via a `ServerAlive` probe immediately before the `new-session` exec, stamping only on dead→create-success.
**Why**: puts the stamp at the single seam every rk birth flows through (mux new, API create paths, riff-transitive, restore) instead of per-caller logic; the probe mirrors the existing `probeServerAlive` idiom. The TOCTOU window degrades safely: a concurrent rk birth winning the race is still an rk birth, so the stamp stays truthful.
**Rejected**: per-caller stamping (misses future callers — the leak `@rk_ephemeral` adoption had to chase); unconditional post-create stamping (would stamp pre-existing external servers on a mere session create — provenance lies).
*Introduced by*: 260826-lv87-external-server-provenance-adopt

#### Stamp failure never fails the create
**Decision**: a failed `MarkServerManaged` after a successful birth logs at warn and the create succeeds; the server reads external until adopted.
**Why**: killing a user's just-created server over a bookkeeping mark is hostile, and the degraded state (conf applied once, no future reloads) is safe and recoverable via adopt.
**Rejected**: the `rk mux new --ephemeral` kill posture — appropriate there because an unmarked scratch server recreates the leak that verb exists to stop; here the failure mode is merely a stale-conf window.
*Introduced by*: 260826-lv87-external-server-provenance-adopt

#### One combined reader, daemon short-circuit first
**Decision**: a single exported `IsManagedServer` = daemon-name derivation ∨ option read; no separate exported raw reader.
**Why**: every consumer (three gates, the servers fan-out, adopt idempotency) wants the combined answer; `rk-daemon` must read managed even against a pre-feature daemon server (Constitution VI restart survival), and the short-circuit needs no live server — the `IsGuardedServer` shape verbatim.
**Rejected**: exporting the raw option reader too (no consumer; surface for drift).
*Introduced by*: 260826-lv87-external-server-provenance-adopt

#### Frontend gates external on `managed === false`, never on absence
**Decision**: external treatment renders only when the field is present and false.
**Why**: the additive optional-field idiom — an old backend omitting `managed` must not paint every server external mid-deploy; degradation lands on today's rendering, never on a wrong one.
**Rejected**: `!managed` (treats absence as external).
*Introduced by*: 260826-lv87-external-server-provenance-adopt

#### Assigned color outranks the hatch stripe
**Decision**: the hatched stripe renders only for an uncolored external tile; an assigned `server_colors` color paints the stripe as today.
**Why**: server colors are rk-side config.yaml state available to external servers under guest mode; the ↗ glyph is the primary provenance signal, the hatch merely fills the empty signature slot.
**Rejected**: hatch always (hides a user-assigned color); hatch as the primary signal (the style channel is user-owned vocabulary — the glyph axis decision).
*Introduced by*: 260826-lv87-external-server-provenance-adopt

## Tasks

### Phase 1: Backend marker + helpers

- [x] T001 Add `ManagedOption = "@rk_managed"` const beside `ProtectedOption`, writers `MarkServerManaged`/`UnmarkServerManaged` (mirror `MarkServerProtected`/`UnmarkServerProtected`), and the combined reader `IsManagedServer(ctx, name)` (daemon-name short-circuit ∨ `IsProtectedServer`-taxonomy option read) in `app/backend/internal/tmux/tmux.go`; unit tests for the reader taxonomy (marked/unmarked/dead-socket/daemon-derivation, no subprocess on the daemon path) in `tmux_test.go` <!-- R1 -->

### Phase 2: Birth stamps + gates

- [x] T002 Stamp at the `CreateSession` seam (`internal/tmux/tmux.go:1365`): `ServerAlive` pre-probe, stamp on dead→create-success, warn-and-continue on stamp failure; verify `internal/riff` has no `new-session` (transitively covered); unit-test the birth-vs-existing branch via the package's existing seam/test patterns <!-- R2 -->
- [x] T003 [P] Stamp at the `CreateSessionForRestore` seam (`internal/tmux/layout.go:302`) with the same probe/stamp/warn posture; extend layout tests <!-- R2 -->
- [x] T004 [P] Stamp `rk-daemon` after birth in `internal/daemon/daemon.go` `startSession` (best-effort, logged) <!-- R2 -->
- [x] T005 Gate `RefreshSweep` (`internal/tmux/managedconf.go:211`) per server on managed, debug-log skips; add the `sweepIsManaged` seam var beside `sweepListServers`/`sweepReloadConfig`; unit tests proving external servers receive no reload and the sweep never fails daemon start <!-- R3 -->
- [x] T006 [P] Gate the WS-attach best-effort reload (`app/backend/api/terminals_ws.go:469`) on managed (skip on external or read failure, debug log; attach unchanged); test via the handler's existing seams <!-- R3 -->
- [x] T007 [P] Gate `POST /api/tmux/reload-config` (`app/backend/api/tmux_config.go`): external target → `200 {"status":"skipped","reason":"external"}`; handler test for both branches <!-- R3 -->

### Phase 3: Adopt verb + API plumbing

- [x] T008 Add `POST /api/servers/adopt` (`app/backend/api/servers.go` + route in `api/router.go`, `handleServerProtect` as template): validate name, already-managed idempotent 200, stamp→reload with unmark-on-failure, SSE-hub wake on success; handler tests (success, already-managed incl. rk-daemon, failed-reload rollback, invalid name 400) <!-- R4 -->
- [x] T009 Add `rk mux adopt <server>` (`app/backend/cmd/rk/mux_adopt.go`, `mux_new.go` as template): positional name validation, `muxRejectInheritedServerFlag`, `ServerAlive` requirement, `adopted <name>` / `already managed <name>` stdout reports, unmark-on-failed-reload exit 1; cmd tests mirroring `mux_new`'s (usage/operational/report-line cases) <!-- R5 -->
- [x] T010 Update the help-dump / mux-family member-count assertions (eleven → twelve members, `adopt` in the captured-children check) and confirm no backticks in flag help <!-- R5 -->
- [x] T011 Add `managed` bool to `serverInfo` (`app/backend/api/servers.go:34-44`) read via `IsManagedServer` in the `GET /api/servers` fan-out (warn + false on read failure); extend `servers_test.go`; add `managed?: boolean` to `ServerInfo` in `app/frontend/src/api/client.ts` plus an `adoptServer(name)` client function <!-- R6 -->

### Phase 4: Frontend glyph axis + palette

- [x] T012 Add the external ↗ glyph to the control-glyph register (`app/frontend/src/components/top-bar-icons.tsx`, `ControlGlyph` member beside `ShieldGlyph`) and an exported `isExternalServer(info)` helper (`managed === false`) in `api/client.ts` <!-- R7 -->
- [x] T013 `ServerTile` (`app/frontend/src/components/sidebar/server-panel.tsx`): shield glyph for protected/daemon (R8), ↗ + dimmed name for external, hatched stripe when external AND uncolored, identity-tip `· external — not started by run-kit` suffix; component tests for glyphs, dim, hatch-vs-color, tip text, and no-treatment when `managed` is absent <!-- R7 R8 -->
- [x] T014 [P] Sessions-tree server header (`app/frontend/src/components/sidebar/index.tsx`, the shield slot at `:2796`): ↗ + dimmed name for external servers, nested rows untouched; extend `sidebar/index.test.tsx` <!-- R7 -->
- [x] T015 [P] Host-overview tile (`app/frontend/src/components/host-overview-page.tsx:462` area): ↗ before the name + grey-name extended to external; extend `host-overview-page.test.tsx` <!-- R7 -->
- [x] T016 Palette builder `buildServerAdoptActions` (`app/frontend/src/lib/palette/server-adopt.ts` + colocated vitest, external-only entries, ids `adopt-server-<name>`), wired in `app.tsx` beside the protect entries <!-- R9 -->
- [x] T017 Adopt confirm dialog in `app/frontend/src/components/server-dialogs.tsx` via a `requestAdoptServer` context trigger (the `requestKillServer` pattern), semi-irreversibility copy, confirm → `adoptServer` + `refreshServers()`, failure toast; dialog tests <!-- R9 -->

### Phase 5: Verification

- [x] T018 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted vitest for touched components, and `just build`; run sibling e2e specs touching the sidebar/host-overview surfaces if the rig is available (new e2e coverage is N/A-eligible — the treatments are unit-covered and the e2e fixture's server provenance is mixed by construction) <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->

## Execution Order

- T001 blocks everything (the helpers).
- T002–T007 depend on T001; within the group T003/T004 and T006/T007 are parallel.
- T008/T009 depend on T001 (+ T005's seam patterns for tests); T010 depends on T009; T011 depends on T001.
- T012 blocks T013–T015; T016/T017 depend on T011 (client fn) and T012.
- T018 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ManagedOption`/`MarkServerManaged`/`UnmarkServerManaged`/`IsManagedServer` exist with the `IsProtectedServer` read taxonomy and the rk-daemon short-circuit, unit-tested
- [x] A-002 R2: every rk birth seam (CreateSession, CreateSessionForRestore, daemon startSession) stamps `@rk_managed` on birth only; a session create on an existing server writes no stamp
- [x] A-003 R3: all three conf-apply paths skip external servers (sweep, WS-attach reload, reload-config endpoint) and only those paths changed — external servers remain fully attachable/editable
- [x] A-004 R4: `POST /api/servers/adopt` stamps+reloads atomically with unmark-on-failed-reload, is idempotent on managed targets, validates input, and wakes the hub
- [x] A-005 R5: `rk mux adopt` conforms to the mux operator-tier grammar (positional, `-L` rejection, toolkit exit codes, one-line stdout reports)
- [x] A-006 R6: `GET /api/servers` carries `managed` with the warn-and-false failure contract; `ServerInfo` extended
- [x] A-007 R7: ↗ renders on the strip tile, tree header, and host tile for `managed === false` servers only; identity tip carries the provenance line; nested session/window rows untouched
- [x] A-008 R8: shield renders on the server-strip tile for protected/daemon servers
- [x] A-009 R9: palette lists adopt entries for external servers only; the confirm dialog gates the POST with the semi-irreversibility copy

### Behavioral Correctness

- [x] A-010 R3: opening a terminal on an external server no longer rewrites its tmux config (the `terminals_ws.go:469` behavior reversal is explicit and tested)
- [x] A-011 R7: an old-backend payload without `managed` renders zero external treatment (absence ≠ external)

### Scenario Coverage

- [x] A-012 R4: the failed-reload rollback scenario is exercised by a test (no stamped-but-unconfigured server survives)
- [x] A-013 R5: adopt-twice idempotency and the dead-socket operational error are exercised by cmd tests

### Edge Cases & Error Handling

- [x] A-014 R1: a dead/absent socket reads `(false, nil)` from the option path and `(true, nil)` for `rk-daemon`; other read failures propagate (helpers) but degrade to external/false at the fan-out and gates

### Code Quality

- [x] A-015 Pattern consistency: new code mirrors the named precedents (`IsGuardedServer`, `handleServerProtect`, `mux_new.go`, `server-protect.ts`, `ShieldGlyph`) and all subprocess calls use `exec.CommandContext` with timeouts via the existing `internal/tmux` core
- [x] A-016 No unnecessary duplication: gates and adopt reuse `IsManagedServer`/`ReloadConfig`; no inline tmux command construction outside `internal/tmux/`
- [x] A-017 Tests accompany every behavior change (Go unit, handler, cmd; frontend component + palette-builder vitest); no client polling introduced

### Security

- [x] A-018 R4 R5: every user-supplied server name (endpoint body, CLI positional) is validated via `internal/validate` before any subprocess

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (provenance mark, gates, adopt verb, glyph axis) without making existing code redundant. The three conf-apply paths were gated in place (their pre-gate call sites were replaced, not orphaned), `ReloadConfig` keeps all prior callers plus the adopt verb, and no symbol lost its last consumer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Birth detection via `ServerAlive` pre-probe inside `CreateSession`/`CreateSessionForRestore`, not per-caller stamping | Single-seam coverage of all birth paths; TOCTOU degrades to a truthful stamp; mirrors existing probe idiom | S:60 R:80 A:80 D:70 |
| 2 | Confident | Stamp failure logs warn and never fails the create (no `mux new --ephemeral` kill posture) | Failure mode is a stale-conf window, recoverable via adopt; killing user work over bookkeeping is worse | S:55 R:85 A:75 D:65 |
| 3 | Confident | One exported combined reader `IsManagedServer` (derivation ∨ option); raw reader stays unexported | Every consumer wants the combined answer; smaller surface | S:55 R:85 A:80 D:70 |
| 4 | Confident | Frontend renders external only on `managed === false` (absence = no treatment) | The additive optional-field idiom; protects rolling deploys from painting everything external | S:50 R:85 A:80 D:70 |
| 5 | Confident | Assigned server color outranks the hatch stripe; hatch fills only the uncolored external slot | Colors are rk-side config available under guest mode; glyph is the primary signal per the discussion | S:55 R:85 A:70 D:65 |
| 6 | Confident | Adopt endpoint returns `200 already-managed` for rk-daemon rather than the protect endpoint's 400 | Adopt is idempotent by contract (CLI `already managed` exit 0); a 400 would break bulk-migration scripts | S:50 R:80 A:70 D:60 |
| 7 | Confident | Palette entry label `Server: Adopt <name> into run-kit`, one entry per external server (list-scoped, like protect), rather than a single focused-server entry | Matches the per-server entry pattern of kill/protect; context-scoping achieved by listing external servers only | S:50 R:85 A:70 D:60 |
| 8 | Confident | `rk skill` mux topic page NOT extended with adopt | The reap attractive-nuisance posture: operator config mutation, not an agent capability; avoids the byte-equality drift guard churn | S:45 R:90 A:75 D:65 |
| 9 | Tentative | Both glyphs render (shield then ↗) when a server is both protected and external | Rare combination; showing both preserves information; the mock showed one glyph per tile but never this combination | S:35 R:85 A:60 D:50 |
| 10 | Confident | Birth probe uses `probeServerAlive` (bool, 2s sub-timeout) immediately before the `new-session` exec | R1 says "probe `ServerAlive`" but the design decision names the `probeServerAlive` idiom; only the bool helper fits the branch | S:40 R:80 A:75 D:55 |
| 11 | Certain | `internal/tmux` birth/stamp tests use the package's live-tmux integration idiom (real sockets) — no function-variable exec seams exist there | The brief assumed seam vars; the package's only test idiom for these paths is live sockets | S:35 R:85 A:80 D:60 |
| 12 | Confident | One shared unexported `stampManagedOnBirth` helper serves both create seams; `IsManagedServer` inlines the option read (no separate raw reader) | Identical warn policy at both seams; plan decision 3 keeps the raw reader unexported | S:40 R:80 A:75 D:55 |
| 13 | Confident | WS-attach gate extracted as `reloadConfigForAttach` with `attachIsManaged`/`attachReloadConfig` seam vars (the `getWindowOptionFn` pattern); all gated skips log at debug | terminals_ws had no reload seam; debug per the plan's silent-with-debug-log posture | S:40 R:80 A:70 D:55 |
| 14 | Confident | `ReloadConfig` rides the `TmuxOps` router interface (like `IsGuardedServer`) rather than a new injection seam; adopt CLI dead-socket refusal wraps `server <name> is not running`; rollback unmarks run under a fresh timeout ctx | Minimal intrusion; mirrors mux_new's operational-refusal and `--ephemeral` mark patterns | S:40 R:80 A:70 D:55 |
| 15 | Certain | No second SSE/state payload path carries server class flags — `managed` flows only via `GET /api/servers` | Verified: `state_ws.go` has no Protected/Ephemeral flow | S:30 R:85 A:75 D:55 |
| 16 | Confident | Hatch stripe renders only on the ACTIVE tile (the stripe slot is transparent on inactive tiles today); ↗ glyph spans use the shield's `role="img"`/`aria-label`/`data-testid="external-<name>"` idiom; register seam `data-icon="external"` | A 24/7 hatch would paint an otherwise-empty slot; the color-wins rule is preserved by only setting the hatch when uncolored | S:35 R:80 A:70 D:50 |
| 17 | Confident | Adopt confirm dialog uses neutral (not danger-red) styling; `adoptServerTarget` joins the app.tsx `dialogOpenRef` gating; no optimistic marking (kill's `markKilled` has no adopt analog); palette builder uses the inline `s.managed === false` predicate | Adopt is a config mutation, not destruction; ungated dialog state would let URL writeback interrupt mid-render; backend wakes the SSE hub on success | S:35 R:80 A:65 D:50 |

17 assumptions (2 certain, 14 confident, 1 tentative).
