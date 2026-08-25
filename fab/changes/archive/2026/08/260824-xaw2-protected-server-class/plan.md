# Plan: Protected Server Class

**Change**: 260824-xaw2-protected-server-class
**Intake**: `intake.md`

## Requirements

### tmux: The protected server class

#### R1: `@rk_protected` option, reader, and writers
`internal/tmux` SHALL define `ProtectedOption = "@rk_protected"` (beside `EphemeralOption`, `tmux.go:55`), a reader `IsProtectedServer(ctx, server) (bool, error)` that is an exact mirror of `IsEphemeralServer` (`tmux.go:2881`) — same `show-option -sv` read, same error taxonomy (unset option or `IsServerGone` → `(false, nil)`; other failures propagate wrapped; non-empty trimmed value is truthy, `"1"` documented) — and writers `MarkServerProtected` (set `"1"`, mirrors `MarkServerEphemeral`) and `UnmarkServerProtected` (`set-option -s -u` — unset demotes, no tombstone).

- **GIVEN** a live server with `@rk_protected 1` set
- **WHEN** `IsProtectedServer` is called
- **THEN** it returns `(true, nil)`; after `UnmarkServerProtected` it returns `(false, nil)`; on a never-marked or dead server it returns `(false, nil)`

#### R2: Combined guard predicate — daemon by derivation
`internal/tmux` SHALL expose a combined predicate (`IsGuardedServer(ctx, name)` or equivalent) that is true when `name` equals the daemon server name (the package's existing `productionDaemonServer` constant — same string as `daemon.ServerSocket`, used to avoid an import cycle) **OR** `IsProtectedServer` reads true. The daemon MUST be protected by derivation alone: its derived state is not togglable and a hypothetical option write on it is never the source of truth. **Protected beats ephemeral**: a server carrying both marks behaves as protected wherever the two classes conflict.

- **GIVEN** the server name `rk-daemon` with no options set
- **WHEN** the predicate is evaluated
- **THEN** it returns true (derived), while a normal unmarked server returns false

### API: Kill guard, payload field, protect toggle

#### R3: `handleServerKill` force gate
`POST /api/servers/kill` (`app/backend/api/servers.go:187`) SHALL accept `force bool` in the body. A protected target (per R2) without `force` MUST be refused with **409** and a structured body `{"error": "<message naming the restart alternative>", "protected": true}` before the kill-notify audit fires. With `force: true`, or for a non-protected target, the existing path (audit notify → `KillServer`) runs unchanged.

- **GIVEN** `{"name": "rk-daemon"}` (no force)
- **WHEN** the handler runs
- **THEN** it responds 409 with `protected: true` and performs no kill; **AND** with `{"name": "rk-daemon", "force": true}` the kill proceeds

#### R4: `protected` field on `GET /api/servers`
The servers listing SHALL carry `protected bool` per entry, read inside the existing per-server best-effort fan-out (`servers.go:52–99`, the `ephemeral` precedent): a per-server read failure logs at warn and degrades that entry to `protected: false`, never a 5xx. The daemon entry reports `protected: true` by derivation.

- **GIVEN** a server marked `@rk_protected`
- **WHEN** `GET /api/servers` is called
- **THEN** its entry carries `protected: true`; the `rk-daemon` entry always does

#### R5: `POST /api/servers/protect` toggle endpoint
A new endpoint `POST /api/servers/protect` with body `{"name": string, "protected": bool}` SHALL validate the name (`validate.ValidateServerName`), reject the daemon with **400** (derived protection is not togglable), set or unset `@rk_protected` accordingly, wake the SSE hub for that server (the existing `wake` seam — user-option mutations emit no control-mode event), and return `{"ok": true}`. Registered in `router.go` beside the other server POSTs (Constitution IX: POST-only).

- **GIVEN** `{"name": "myserver", "protected": true}`
- **WHEN** the handler runs
- **THEN** `@rk_protected` is set on `myserver` and the hub is woken; **AND** `{"name": "rk-daemon", ...}` responds 400

### CLI: `rk mux` gates

#### R6: `rk mux kill` protected-server gate
`rk mux kill` (`app/backend/cmd/rk/mux_kill.go`) SHALL refuse a target pane residing on a protected server (per R2, evaluated against the resolved `-L` scope from `muxServer()`) unless the existing `--force` flag is passed — no new flag. The refusal follows the established gate shape: reason on stderr naming the protected server, exit 1, no tmux mutation. `--force` skips both the agent-state and protected gates (target existence still validated). Implemented through the existing `muxKill*Fn` seam pattern for testability.

- **GIVEN** an idle pane on a server marked `@rk_protected`
- **WHEN** `rk mux kill %N` runs without `--force`
- **THEN** it exits 1 with a protected-server refusal on stderr and kills nothing; with `--force` it kills

#### R7: `rk mux reap` unconditional protected skip
`rk mux reap` SHALL skip protected servers unconditionally — under `--ephemeral`, under any `--prefix` match, always. Implementation mirrors `enumerateEphemeralServers` (`reaper.go`): enumerate `@rk_protected` among **live** servers only (dead sockets are never queried — no resurrection; the existing `_rk-ctl`/`productionDaemonServer` hard-skips stay), and thread the protected name-set into `reapCandidates` as data so `classifyReap` stays pure. A live server carrying **both** `@rk_ephemeral` and `@rk_protected` is skipped (R2 precedence). Removing a *dead socket file* whose server was formerly protected remains allowed (a dead socket is inert).

- **GIVEN** a live prefix-matched server marked both `@rk_ephemeral` and `@rk_protected`
- **WHEN** `rk mux reap --ephemeral --prefix <its-prefix>` runs
- **THEN** the server is skipped (reported, not killed); unmarked siblings are reaped as before

#### R8: Toolkit-standards conformance for the changed CLI surface
The changed `mux kill`/`mux reap` help text SHALL pass the toolkit-standards checks that govern it: help-dump fixture regeneration, readme-extraction, and Principle 9, per the constitution's Toolkit Standards clause.

- **GIVEN** the updated help text
- **WHEN** the help-dump test suite runs
- **THEN** fixtures match and the standards checks pass

### Frontend: client, dialog fork, palette, flyout

#### R9: Client payload and calls
`app/frontend/src/api/client.ts` SHALL add `protected?: boolean` to the server payload type (beside `ephemeral?`, `:854`), extend the kill call with the `force` body field, and add `setServerProtected(name, protected)` posting to `/api/servers/protect`. The existing `restartDaemon` (`:711`) is reused untouched.

- **GIVEN** the extended client
- **WHEN** the dialog force-kills or toggles protection
- **THEN** the calls carry `force`/`protected` correctly; type-check passes

#### R10: Kill-confirm dialog fork on protected targets
The kill confirm dialog (`app/frontend/src/components/server-dialogs.tsx`) SHALL fork on the target's `protected` payload flag:
- **Daemon target**: primary action **"Restart run-kit"** wired to the existing `restartDaemon` client call (`POST /api/restart` — no new endpoint); destructive secondary **"Force kill"** unlocked only when a text input's value exactly equals the server name (auto-focused, Enter submits only on match, Esc cancels — keyboard-first).
- **Non-daemon protected target**: same typed-name unlock for the kill action; no Restart primary; Cancel is the safe default.
- **Blast-radius copy** derived live from client-held session data: for the daemon, dashboard + `rk-jobs`/code-server/`rk-remotes` counts; for other protected servers, session/window counts.
- **Non-protected targets: the dialog is byte-for-byte unchanged — zero behavior drift** (the existing copy-only daemon warning is subsumed by the fork).

- **GIVEN** the kill dialog opened on `rk-daemon`
- **WHEN** the user types a wrong name
- **THEN** Force kill stays locked; **AND** typing `rk-daemon` unlocks it; **AND** Restart fires `restartDaemon`; **AND** a normal server still gets the old two-button confirm

#### R11: Palette entries — Protect/Unprotect; restart parity via the existing action
A new pure builder (`app/frontend/src/lib/palette-server-protect.ts`, following the `palette-server-kill.ts` pattern) SHALL emit one `Server: Protect <name>` / `Server: Unprotect <name>` action per server from the `protected` payload flag — the daemon excluded (derived, not togglable). Wired in the same host that wires `buildServerKillActions`, calling `setServerProtected`. Restart palette parity (Constitution V) is satisfied by the **existing** `run-kit: Restart Daemon` maintenance action (`palette-update.ts` `buildMaintenanceActions`) — no new restart entry. Force-kill stays reachable through the existing `Server: Kill` entries → guarded dialog.

- **GIVEN** a non-daemon server with `protected: false`
- **WHEN** the palette opens
- **THEN** it lists `Server: Protect <name>` (and `Unprotect` once marked); no protect/unprotect entry exists for `rk-daemon`

#### R12: Server flyout-card toggle row
The server-tier flyout card (`app/frontend/src/components/sidebar/row-flyout-card.tsx` — coarse-pointer surface; the palette is the keyboard surface) SHALL gain a Protect/Unprotect toggle row driven by the `protected` payload flag. For `rk-daemon` the row renders as protected with the toggle **disabled** (derived, not unmarkable).

- **GIVEN** the server card for a normal server
- **WHEN** the toggle row is tapped
- **THEN** `setServerProtected` fires and the row reflects the new state; the daemon's row is visibly protected and inert

### e2e

#### R13: Typed-confirm e2e with `.spec.md` companion
A Playwright spec SHALL cover the typed-name confirm flow (locked → exact-match unlock → Esc cancel) with its mandatory sibling `.spec.md` (constitution Test Companion Docs).

- **GIVEN** the e2e rig with a protected test server
- **WHEN** the spec runs
- **THEN** it proves lock/unlock/cancel; the `.spec.md` documents what each test proves and its steps

### Non-Goals

- Shell-level protection (`tmux -L rk-daemon kill-server`) — the tmux guard shim's jurisdiction; this change closes the UI and API accident paths
- Hiding infra servers from new users — safety via verb-shaping, not concealment
- Protecting test/ephemeral classes — taxonomy stays three states
- SYSTEM presentation card and shield glyph on server lists — Wave 2 (Change 2 of the plan)
- New rk CLI protect/unprotect verb — raw `tmux set -s @rk_protected 1` + UI toggle are the mark surfaces

### Design Decisions

#### Born-general protected class
**Decision**: Ship the guard predicate as `rk-daemon (derived) ∨ @rk_protected` from day one, as one change.
**Why**: Born-general beats build-then-generalize — the option class costs one constant + one reader beside the daemon check, and deletes a stacked PR.
**Rejected**: Daemon-only special-case first, generalize later — same guard seams touched twice.
*Introduced by*: 260824-xaw2-protected-server-class

#### Daemon identity by derivation, never by option
**Decision**: The daemon's protected state derives from its constant socket name; the toggle endpoint rejects it (400) and the UI renders its toggle disabled.
**Why**: Constitution X — derivation beats options; an option write could be unset, leaving the daemon killable.
**Rejected**: Marking `@rk_protected` on rk-daemon at daemon start — resurrectable/unsettable state for a fact the name already carries.
*Introduced by*: 260824-xaw2-protected-server-class

#### Restart parity rides the existing maintenance action
**Decision**: The dialog's Restart primary reuses `restartDaemon` → `POST /api/restart`, and palette parity is satisfied by the existing `run-kit: Restart Daemon` entry (`buildMaintenanceActions`).
**Why**: The action and endpoint already exist and are palette-registered; a second `Daemon: Restart` entry would duplicate the registry.
**Rejected**: Registering a new `Daemon: Restart` palette entry (the intake's literal wording) — discovered redundant during plan grounding.
*Introduced by*: 260824-xaw2-protected-server-class

#### Combined predicate lives in `internal/tmux`
**Decision**: The R2 predicate uses `internal/tmux`'s existing `productionDaemonServer` constant.
**Why**: `internal/daemon` imports `internal/tmux`; the reverse import would cycle. The constant already exists for the reaper's hard-skip.
**Rejected**: Referencing `daemon.ServerSocket` from tmux — import cycle; a third shared package — overkill for one string.
*Introduced by*: 260824-xaw2-protected-server-class

## Tasks

### Phase 1: The class (Go substrate)

- [x] T001 Add `ProtectedOption`, `IsProtectedServer`, `MarkServerProtected`, `UnmarkServerProtected` to `app/backend/internal/tmux/tmux.go` (exact `@rk_ephemeral` mirrors) + unit quartet in `tmux_test.go` (set/unset-after-set/never-set/dead-server, mirroring `TestIsEphemeralServer_*` at `:2342+`) <!-- R1 -->
- [x] T002 Add the combined guard predicate (daemon name via `productionDaemonServer` ∨ `IsProtectedServer`) in `app/backend/internal/tmux` + units (daemon name, marked server, unmarked, dead) <!-- R2 -->

### Phase 2: Backend API

- [x] T003 `handleServerKill`: add `force` to the body struct, guard protected targets with 409 `{"error", "protected": true}` before the audit notify, in `app/backend/api/servers.go` + handler tests (daemon ± force, option-marked ± force, normal unaffected) <!-- R3 -->
- [x] T004 [P] Add `Protected bool` to `serverInfo` and join the read into the existing per-server fan-out in `app/backend/api/servers.go` + listing test (marked → true, read-failure → false, daemon → true) <!-- R4 -->
- [x] T005 Add `handleServerProtect` (`POST /api/servers/protect`: validate → daemon 400 → set/unset → SSE `wake` → `{"ok": true}`) in `app/backend/api/servers.go`, route in `router.go` + handler tests <!-- R5 -->

### Phase 3: CLI gates

- [x] T006 Extend `runMuxKill` in `app/backend/cmd/rk/mux_kill.go`: protected-server refusal (stderr names the server, exit 1) unless `--force`; add a `muxKill*Fn`-style seam for the protected read; update help text + units in `mux_kill_test.go` <!-- R6 -->
- [x] T007 Add protected enumeration to `app/backend/internal/tmux/reaper.go` (mirror `enumerateEphemeralServers`), thread the set into `reapCandidates`/`classifyReap` as data, skip protected regardless of prefix/ephemeral + units (both-marks precedence, prefix-match skip, dead-socket file removal unaffected); update `mux reap` help text <!-- R7 -->
- [x] T008 Regenerate help-dump fixtures and run the toolkit-standards checks (help-dump, readme-extraction, Principle 9) over the changed `mux kill`/`mux reap` surface <!-- R8 -->

### Phase 4: Frontend

- [x] T009 `app/frontend/src/api/client.ts`: `protected?: boolean` on the server payload type, `force` on the kill call, new `setServerProtected` + client unit coverage <!-- R9 -->
- [x] T010 Fork the kill confirm in `app/frontend/src/components/server-dialogs.tsx`: daemon Restart primary (reuse `restartDaemon`), typed-name Force-kill unlock (exact match, Enter-on-match, Esc cancels), non-daemon protected variant, live blast-radius copy, unchanged path for non-protected + dialog unit tests <!-- R10 -->
- [x] T011 [P] New pure builder `app/frontend/src/lib/palette-server-protect.ts` (+ `.test.ts`) emitting `Server: Protect/Unprotect <name>` per non-daemon server; wire beside `buildServerKillActions` in the palette host, calling `setServerProtected` <!-- R11 -->
- [x] T012 [P] Add the Protect/Unprotect toggle row to the server tier of `app/frontend/src/components/sidebar/row-flyout-card.tsx` (daemon: protected + disabled) + component tests <!-- R12 -->

### Phase 5: e2e & verification

- [x] T013 Playwright spec for the typed confirm flow (locked / exact-match unlock / Esc cancel) under `app/frontend/tests/` + sibling `.spec.md` companion <!-- R13 -->
- [x] T014 Verification gates in order: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted `just pw test <new spec>`, then the full `just test` smoke <!-- R1 -->

## Execution Order

- T001 → T002 block everything downstream (the predicate is the shared guard)
- T003–T005 need T002; T004 can run parallel to T003/T005
- T006–T007 need T002; T008 needs T006+T007
- T009 needs T004/T005 (payload + endpoint shapes); T010–T012 need T009
- T013 needs T010; T014 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ProtectedOption`/reader/writers exist and the unit quartet passes
- [x] A-002 R2: The combined predicate returns true for `rk-daemon` (no option) and for marked servers; false otherwise
- [x] A-003 R3: Protected kill without force → 409 `{"protected": true}`; with force → kill proceeds; normal servers unaffected
- [x] A-004 R4: `GET /api/servers` carries `protected` per entry via the best-effort fan-out (no 5xx on read failure)
- [x] A-005 R5: `POST /api/servers/protect` sets/unsets the option, rejects the daemon with 400, and wakes the SSE hub
- [x] A-006 R6: `rk mux kill` refuses panes on protected servers without `--force` (stderr reason, exit 1, no mutation)
- [x] A-007 R7: `rk mux reap` skips protected servers under `--ephemeral` and prefix matches; both-marks servers are skipped
- [x] A-008 R9: Client types/calls extended; `tsc --noEmit` passes
- [x] A-009 R10: Dialog forks per target class; typed-name gating works; non-protected dialog unchanged
- [x] A-010 R11: Protect/Unprotect palette entries exist per non-daemon server; no new restart entry (existing `run-kit: Restart Daemon` is the parity carrier)
- [x] A-011 R12: Flyout server card carries the toggle row; daemon's is disabled-protected

### Behavioral Correctness

- [x] A-012 R3: The 409 fires BEFORE the kill-notify audit (no audited-kill record for a refused attempt)
- [x] A-013 R7: Dead-socket file removal is unaffected by protection (inert sockets still cleaned)
- [x] A-014 R10: Enter submits the force kill only when the typed name matches exactly; Esc always cancels

### Scenario Coverage

- [x] A-015 R13: The typed-confirm e2e passes with its `.spec.md` companion in the same commit
- [x] A-016 R6/R7: CLI gate units cover force-override and precedence paths

### Edge Cases & Error Handling

- [x] A-017 R1: Dead/absent socket reads as `(false, nil)` — never an error, never a resurrection
- [x] A-018 R5: Invalid server name → 400 via `validate.ValidateServerName`; option write failure surfaces as 500, not silent success

### Code Quality

- [x] A-019 Pattern consistency: New code mirrors the `@rk_ephemeral` precedent shapes (reader taxonomy, fan-out join, pure palette builder)
- [x] A-020 No unnecessary duplication: reuses `restartDaemon`, `/api/restart`, the existing `--force` flag, the existing wake seam
- [x] A-021 All subprocess calls use `exec.CommandContext` with timeouts (via `tmuxExecRawServer`/`TmuxTimeout`)
- [x] A-022 No client polling: repaint rides the SSE wake, not `setInterval`
- [x] A-023 Tests accompany every behavior change (units per gate; e2e for the dialog flow)

### Security

- [x] A-024 R5: Server names validated before any subprocess use (Constitution I)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The two superseded pieces were removed in place by the apply diff itself: the kill-confirm dialog's copy-only daemon warning (subsumed by the protected fork) and `enumerateEphemeralServers` (folded into `enumerateMarkedServers`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Restart palette parity via the existing `run-kit: Restart Daemon` maintenance action; no new `Daemon: Restart` entry (deviates from the intake's literal label) | Discovered at plan grounding: `buildMaintenanceActions` already registers it; duplicating the registry would violate the single-registry spirit | S:70 R:85 A:85 D:75 |
| 2 | Confident | Combined predicate lives in `internal/tmux` keyed on `productionDaemonServer` | `daemon` imports `tmux`; reverse import cycles; constant already exists for the reaper | S:65 R:80 A:85 D:75 |
| 3 | Confident | Daemon rejection on the protect endpoint is 400 (client error: un-togglable target), distinct from the kill guard's 409 (conflict: needs force) | Semantics differ — 400 = invalid request shape for this target, 409 = actionable conflict | S:55 R:85 A:75 D:65 |
| 4 | Certain | Flyout toggle row is coarse-pointer-only (the card's existing constraint); palette entries are the keyboard surface | Memory: session/server flyout tiers exist only on coarse pointers (`row-flyout-card.tsx:822`) | S:80 R:85 A:90 D:85 |
| 5 | Confident | New palette builder module named `palette-server-protect.ts`, wired where `buildServerKillActions` is wired | Follows the established one-module-per-action-family pattern in `lib/` | S:60 R:90 A:85 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
