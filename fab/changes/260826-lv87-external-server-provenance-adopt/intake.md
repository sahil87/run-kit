# Intake: External Server Provenance & Adopt

**Change**: 260826-lv87-external-server-provenance-adopt
**Created**: 2026-08-26

## Origin

Promptless dispatch via `/fab-proceed` from a `/fab-discuss` session (2026-08-24..26). The synthesized description is the sole source; all decisions below were made in that discussion (including explicit rejections), and every file/line anchor has been re-verified against this worktree's HEAD.

> Feature: External server provenance — `@rk_managed` server class, config isolation, adopt verb, unified glyph UI. run-kit enumerates every live tmux server in the socket dir (`ListServers`), including servers the user started outside run-kit (the `default` socket, hand-started `-L` servers). These "external" servers are visually indistinguishable from rk-born servers, and — worse — run-kit actively pushes its managed tmux.conf into them: three conf-apply paths exist today, including one that fires merely on viewing a terminal. The user's own tmux.conf regime and rk's managed conf are different regimes and must not be mixed silently.

Key decisions from the discussion (verbatim intent, not re-derived): the `@rk_managed` provenance marker stamped at server birth; external = unmarked and fully first-class ("guest mode with full editing"); gate all three conf-apply paths; an adopt verb (palette + `rk mux adopt` CLI + confirm dialog) with a `release`/un-adopt verb explicitly REJECTED ("3 not needed") and adopt auto-color explicitly rejected; a unified system-owned leading-glyph axis (shield = protected, ↗ = external) with the style channel (dashed gutter marker), `EXT` text badge, and hatch-only treatments explicitly rejected; migration posture (pre-feature rk-born servers read external, `rk mux adopt` is the recovery) accepted by decision.

## Why

1. **The pain point**: run-kit surfaces every live tmux server, but a server the user started outside run-kit is indistinguishable from an rk-born one — and run-kit actively rewrites its config. Three conf-apply paths push the managed tmux.conf into *every* live server today:
   - `RefreshSweep` at daemon start (`app/backend/cmd/rk/serve.go:129` → `internal/tmux/managedconf.go:211`)
   - best-effort `ReloadConfig` on terminal WS attach (`app/backend/api/terminals_ws.go:469`) — the hot path: merely opening a terminal on an external server rewrites its config ("Best-effort config reload so terminal-overrides … are active even if the server was created outside rk" is the current code's explicit intent — the behavior this change reverses)
   - `POST /api/tmux/reload-config` (`app/backend/api/tmux_config.go:10`, route at `app/backend/api/router.go:754`)

   The user's own tmux.conf regime and rk's managed conf are different regimes; mixing them silently changes keybindings, styling, and options on a server the user configured themselves.
2. **If we don't fix it**: every view of an external server's terminal keeps silently overwriting the user's tmux config, and users cannot tell which servers run-kit "owns" — trust in the dashboard as a safe viewer of foreign servers erodes.
3. **Why this approach**: a server-scoped tmux user option (`@rk_managed`) is the established pattern for underivable creator intent — the exact mirror of `@rk_ephemeral` (changes 260821-zelc / 260821-hbmh) and `@rk_protected` (260824-xaw2), constants at `app/backend/internal/tmux/tmux.go:55` / `:67`. It is derived from tmux at request time — no new state store (Constitution II/X). "Provenance = was the managed conf applied at birth" is exactly when the stamp is written, so the mark is truthful by construction.

## What Changes

### 1. Provenance marker: `@rk_managed` server class (backend)

New server-scoped tmux user option `@rk_managed` (canonical value `"1"`), stamped at server birth by **every rk path that births a server** — the moment its `-f <managed conf>` actually applies:

- **Daemon start** — `daemon.startSession` births the rk-daemon tmux server (`app/backend/internal/daemon/daemon.go`, server-birth-capable `new-session` around lines 317–393).
- **`rk mux new`** — `app/backend/cmd/rk/mux_new.go` (births via `tmux.CreateSession`; already stamps `@rk_ephemeral` on `--ephemeral`, with the failed-mark → kill posture to mirror).
- **`tmux.CreateSession`** (`app/backend/internal/tmux/tmux.go:1365`) **when it births the server** — it already passes `configArgs()` (`-f`), which tmux honors only when this call starts the server process. Callers: `POST` session create (`app/backend/api/sessions.go:50`), server create (`app/backend/api/servers.go:146`), `rk mux new`.
- **Snapshot restore** — `tmux.CreateSessionForRestore` (`app/backend/internal/tmux/layout.go:302`, wired at `app/backend/internal/snapshot/restore.go:37`) is also an rk birth path. Restored servers are stamped managed; the snapshot capture set is NOT extended to carry the old mark. <!-- assumed: restore stamps @rk_managed unconditionally — the stamp records which conf actually applied at birth, and rk restore applies the managed conf; the alternative (capture + faithfully restore the pre-death mark, leaving restored external servers unmarked) was not discussed -->
- **Riff spawns** — `internal/riff` drives windows/panes on an explicit existing `{server, session}` (no `new-session` in `internal/riff/`); riff-driven server births flow through the shared `CreateSession` seams above, so stamping those seams covers riff. Verify at plan time.

Implementation mirrors the `@rk_ephemeral`/`@rk_protected` precedent exactly: a `ManagedOption` constant beside `EphemeralOption`/`ProtectedOption` (`tmux.go:55`/`:67`), `MarkServerManaged` / `IsServerManaged` helpers mirroring `MarkServerEphemeral` (`tmux.go:2968`) / `MarkServerProtected` (`tmux.go:3003`) via `set-option -s` / `show-option -sv`. Derived at request time from tmux — no new state store (Constitution II/X). The option is documented in the `@rk_*` user-option registry (tmux-sessions memory).

**rk-daemon derivation**: the rk-daemon production server is managed **by derivation from its constant name** (mirroring the protected-by-derivation precedent, `IsGuardedServer`) in addition to the birth stamp — a daemon restart against a pre-feature rk-daemon tmux server (Constitution VI: tmux survives server restarts) must not strand rk's own server as external.

**External = unmarked.** No option write for external servers at detection time. External servers stay **fully first-class**: attachable, editable, killable, colorable, renamable ("guest mode with full editing"). Rationale (user-decided): on release day every pre-existing server lacks the stamp and reads external — blocking edits would stop all work. Guest mode still writes `@rk_*` options (colors, notes, protected) and performs renames/kills on user request; those are namespaced runtime state. **What stops is conf-pushing only.**

### 2. Config isolation: gate the three conf-apply paths on `@rk_managed`

Skip unmarked (external) servers in all three paths:

1. **`RefreshSweep`** (`internal/tmux/managedconf.go:211`, invoked from `serve.go:129`): the sweep walks live servers and calls `sweepReloadConfig(server)` — gate each server on `IsServerManaged`, skipping external servers (debug log, no error).
2. **WS-attach best-effort `ReloadConfig`** (`app/backend/api/terminals_ws.go:469`): call only for managed servers. This is the hot path — today merely opening a terminal on an external server rewrites its config. The attach itself is unchanged (external servers remain fully attachable); note the adjacent `-f` on `attachArgs` is harmless on a live server (tmux ignores `-f` unless the command births the server).
3. **`POST /api/tmux/reload-config`** (`app/backend/api/tmux_config.go:10`): gate on the mark; an external target returns 200 with a skipped report (e.g. `{"status":"skipped","reason":"external"}`), not an error.

**`CreateSession`'s `-f` flag needs no gating** — tmux ignores `-f` on an already-running server; it only applies when the command births the server, which is exactly when the stamp is set.

### 3. Adopt verb — convert an external server to managed

Adopt = stamp `@rk_managed` + source the managed conf (reuse `ReloadConfig`), atomically: stamp first, then reload; a failed reload unsets the mark and errors, so a stamped server whose conf never applied is never left behind (mirrors `rk mux new`'s failed-mark → kill posture).

Surfaces:

- **Command palette**: `Server: Adopt into run-kit`, **context-scoped** — offered only when the focused server is external. Mandatory under Constitution V (palette = complete action registry). New pure builder `app/frontend/src/lib/palette/server-adopt.ts` following the `server-protect.ts` / `server-kill.ts` pattern (pure, dependency-free, unit-testable; wired in app.tsx).
- **HTTP**: `POST /api/servers/adopt` (Constitution IX — mutating = POST), mirroring the protect endpoint shape (`app/backend/api/servers.go:260` `handleServerProtect` precedent).
- **CLI parity**: `rk mux adopt <server>` — rk owns the tmux substrate per the CLI-layering spec (`docs/specs/cli-layering.md`); also the **bulk-migration path** for pre-feature rk-born servers. Operator-tier `mux` grammar (positional socket name, reject explicitly-set inherited `-L` — the `new`/`reap`/`snapshot`/`init-conf` pattern, `mux_new.go` as the template). Non-interactive: invocation is consent (the bulk-migration role requires scriptability). New CLI surface MUST be checked against shll toolkit standards (Constitution § Toolkit Standards) and the eleven-member `mux` family docs (agent-messaging + toolkit-standards memory) updated to twelve.
- **Confirm dialog** (web, kill-dialog pattern — dialogs-and-state memory) stating semi-irreversibility: **"applies run-kit's tmux config; your own config returns on server restart."**

**Explicitly REJECTED** (user decisions — do not add): a `release`/un-adopt verb ("3 not needed"); adopt auto-assigning a server color — adopt stays minimal; color assignment remains its own action.

### 4. UI — unified server-class glyph axis

One **system-owned leading-glyph slot** carries all server-class marks: **shield** = protected (`rk-daemon` / `@rk_protected`, existing `ShieldGlyph`), **↗** (external-link arrow) = external. Same slot/size/position in the server-strip tile name row and the sessions-tree server header row. The new glyph is an SVG in the shared control-glyph register (`app/frontend/src/components/top-bar-icons.tsx`, beside `ShieldGlyph`).

- **Rationale (decided)**: provenance must NOT use the style channel — the tree's left-gutter marker is a user-assigned label vocabulary (`"" | dotted | dashed | solid | double | thick`, `app/frontend/src/components/sidebar/window-row.tsx:36-38`, plus hatch textures from the picker vocabulary); "dashed = external" would collide with user labels. The glyph slot is system-owned, a closed set.
- **Rejected alternatives** (from a presented HTML mock, v1/v2): dashed tile border (dropped — the glyph does that work); `EXT` text badge in the count row (competes with the waiting badge's slot); hatched-stripe-only (too quiet).
- **Server-strip tile** (`app/frontend/src/components/sidebar/server-panel.tsx`, `ServerTile` at `:202`): external = ↗ glyph + dimmed name (reuse the exact `isInfraServer` text-secondary treatment at `server-panel.tsx:230`) + hatched top stripe (**secondary** — fills the color-signature slot externals can't join; NOT the primary signal) + solid border. **ALSO**: add the shield glyph to the tile for `rk-daemon`/`@rk_protected` — today the shield renders only on the tree server header (`app/frontend/src/components/sidebar/index.tsx:2796`, `data-testid="shield-${server}"`) and host-overview tiles (`app/frontend/src/components/host-overview-page.tsx:462`); the sidebar server-strip tile has no icon.
- **Sessions tree**: ↗ + dimmed name on the external server's **header row ONLY** (same leading slot the shield uses at `sidebar/index.tsx:2796`). Nested session/window rows completely untouched — content is content; user label axes (colors, gutter markers) remain available on external servers' windows.
- **Host-overview grid tiles**: also render ↗ + dimmed name in the same slot — the tiles already carry class markers (shield + `scratch` chip, routes-and-shell memory), and the unified axis makes the slot system-owned wherever it appears.
- **Identity tip** (tile hover/long-press card): append provenance — e.g. `tmux -L default · 5 sessions · external — not started by run-kit`.

### 5. API + data plumbing

`serverInfo` (`app/backend/api/servers.go:34-44`) gains a `managed` bool mirroring the `Ephemeral`/`Protected` fields (read at request time; read failure or server gone mid-walk yields `false` — i.e. external); the frontend `ServerInfo` type in `app/frontend/src/api/client.ts` is extended to match, and the SSE/state payloads that carry server class flags follow the same route the `protected` flag took.

### 6. Migration posture (decided, acceptable)

Pre-feature rk-born servers are unstamped → they read external and **stop receiving conf reloads** (stale conf until restarted or adopted). `rk mux adopt` is the documented recovery. Accepted by decision — no automatic bulk stamping.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) `@rk_managed` joins the `@rk_*` user-option registry and the server-class set (`@rk_protected` kill-guard class section is the template)
- `run-kit/configuration`: (modify) managed tmux.conf apply paths become `@rk_managed`-gated (daemon-start refresh sweep, WS-attach reload, reload-config endpoint)
- `run-kit/agent-messaging`: (modify) the `rk mux` family gains `adopt` (eleven → twelve members)
- `run-kit/toolkit-standards`: (modify) new CLI surface `rk mux adopt` in the help-dump / Principle 9 new-surface conformance set
- `run-kit/layout-snapshots`: (modify) restore-path provenance stamping (per the restore assumption)
- `run-kit/ui/sidebar`: (modify) server-strip tile glyph slot (shield + ↗, dimmed name, hatched stripe), tree server-header external marker
- `run-kit/ui/status-signals`: (modify) the shared server-class glyph register grows the external ↗ beside the protected shield
- `run-kit/ui/keyboard-and-palette`: (modify) palette action registry gains context-scoped `Server: Adopt into run-kit`
- `run-kit/ui/routes-and-shell`: (modify) host-overview tile class markers gain the external glyph
- `run-kit/ui/dialogs-and-state`: (modify) adopt confirm dialog (kill-dialog pattern)

## Impact

- **Backend (Go)**: `internal/tmux/tmux.go` (constant + mark/read helpers + `CreateSession` birth stamp), `internal/tmux/layout.go` (restore birth stamp), `internal/tmux/managedconf.go` (`RefreshSweep` gate), `internal/daemon/daemon.go` (daemon birth stamp + rk-daemon derivation), `api/terminals_ws.go` (WS-attach gate), `api/tmux_config.go` (endpoint gate), `api/servers.go` + `api/router.go` (`managed` field, adopt endpoint), `cmd/rk/mux_new.go` (birth stamp) + new `cmd/rk/mux_adopt.go`.
- **Frontend (TS/React)**: `components/top-bar-icons.tsx` (external glyph), `components/sidebar/server-panel.tsx` (tile glyph slot + treatments), `components/sidebar/index.tsx` (tree header), `components/host-overview-page.tsx` (grid tiles), `lib/palette/server-adopt.ts` (new), adopt confirm dialog, `api/client.ts` (`ServerInfo.managed`), app.tsx wiring.
- **Constraints**: Constitution I (`exec.CommandContext`, validated input — server names through `internal/validate`), II/X (derive from tmux at request time; the option IS the derivation source), V (palette registration), IX (mutating endpoints are POST), § Toolkit Standards (new CLI surface).
- **Tests** (required per code-quality.md): Go unit tests for the gating and the birth stamps (the `sweepListServers`/`sweepReloadConfig` seams at `managedconf.go:197-201` and the `muxNew*Fn` seam pattern exist for exactly this); frontend Vitest for tile/tree glyph rendering and the palette builder; Playwright e2e where feasible, with `.spec.md` companions per constitution.

## Open Questions

None — the `/fab-discuss` session resolved every surfaced decision (including explicit rejections); the remaining inferences are graded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `@rk_managed` server-scoped tmux user option as the provenance marker, stamped at every rk server-birth path; exact mirror of `@rk_ephemeral`/`@rk_protected` | Discussed — user-decided; Constitution II/X; precedent verified at `tmux.go:55`/`:67` | S:95 R:85 A:95 D:95 |
| 2 | Certain | External = unmarked; external servers stay fully first-class (guest mode with full editing — `@rk_*` writes, renames, kills allowed); only conf-pushing stops | Discussed — user-decided with release-day rationale | S:95 R:80 A:90 D:90 |
| 3 | Certain | Gate all three conf-apply paths on `@rk_managed` (`serve.go:129` sweep, `terminals_ws.go:469` attach reload, `tmux_config.go` endpoint); `CreateSession -f` needs no gating | Discussed — user-decided; anchors verified against HEAD | S:95 R:85 A:95 D:90 |
| 4 | Certain | Adopt verb = stamp + source managed conf; surfaces are palette (context-scoped) + `rk mux adopt <server>` + confirm dialog with the stated copy; NO release/un-adopt verb; NO auto-color on adopt | Discussed — user-decided, rejections explicit ("3 not needed") | S:90 R:80 A:90 D:90 |
| 5 | Certain | Unified system-owned leading-glyph axis: shield = protected, ↗ = external; provenance never rides the style channel (user marker vocabulary collision); tile = ↗ + dimmed name + secondary hatched stripe + solid border; shield added to sidebar tile; tree header row only; identity tip appended | Discussed — user-decided from HTML mock v1/v2 with named rejections | S:90 R:75 A:85 D:85 |
| 6 | Certain | Migration: pre-feature rk-born servers read external and stop receiving conf reloads; `rk mux adopt` is the documented recovery; no automatic bulk stamping | Discussed — user accepted the tradeoff | S:90 R:70 A:90 D:90 |
| 7 | Certain | External ↗ glyph is an SVG in the shared control-glyph register (`top-bar-icons.tsx`), mirroring `ShieldGlyph` | Register precedent verified; top-bar memory names it the shared register | S:75 R:90 A:90 D:85 |
| 8 | Certain | rk-daemon is managed by derivation from its constant name (plus birth stamp) so a daemon restart on a pre-feature rk-daemon server never strands rk's own server as external | Mirrors protected-by-derivation (`IsGuardedServer`); Constitution VI makes the pre-feature case real | S:70 R:80 A:90 D:85 |
| 9 | Confident | API shape: `serverInfo.managed` bool mirroring `Ephemeral`/`Protected`; adopt endpoint `POST /api/servers/adopt` mirroring the protect endpoint | Precedent-determined (`servers.go:34-44`, `:260`); field naming (`managed` vs `external`) inferred | S:65 R:85 A:85 D:70 |
| 10 | Confident | `rk mux adopt` is non-interactive (invocation = consent, no prompt/`--yes`): the bulk-migration role requires scriptability; operator-tier grammar rejecting inherited `-L` per the `mux_new.go` pattern | Discussion fixed the verb + bulk role; interactivity not discussed — inferred from role + family grammar | S:65 R:80 A:75 D:70 |
| 11 | Confident | Riff births are covered by stamping the shared seams (`CreateSession` / daemon / restore): `internal/riff` contains no `new-session` — verify at plan time | Code-verified absence; discussion listed "riff spawns" as a birth path, satisfied transitively | S:60 R:80 A:70 D:70 |
| 12 | Confident | Gated skips are silent-with-debug-log on the sweep and WS-attach paths; the explicit `POST /api/tmux/reload-config` returns 200 with a skipped report, not an error | "Skip unmarked servers" is decided; response shape inferred from best-effort posture of the existing paths | S:55 R:85 A:65 D:55 |
| 13 | Confident | Adopt ordering: stamp first, then reload; failed reload unsets the mark and errors (never leaves a stamped server whose conf never applied) | Interprets "atomically"; mirrors `rk mux new`'s failed-mark → kill posture | S:55 R:80 A:70 D:55 |
| 14 | Tentative | Snapshot restore stamps `@rk_managed` unconditionally (`CreateSessionForRestore` is an rk birth applying managed conf) — including a restored external server; capture set not extended to carry the old mark | Not discussed; "stamp = which conf applied at birth" makes it truthful, but faithful-restore of the pre-death mark is a defensible alternative | S:30 R:45 A:55 D:50 |
| 15 | Confident | `rk mux adopt` on an already-managed server exits 0 idempotently (`already managed` report) | Inferred from the protect toggle's idempotent set posture; toolkit exit-code convention | S:40 R:85 A:60 D:50 |
| 16 | Confident | Host-overview grid tiles also render ↗ + dimmed name in the same leading slot (they already carry shield + scratch-chip class markers) | Unified-axis rationale answers it; the discussion's explicit surface list named only sidebar tile + tree header | S:45 R:80 A:70 D:60 |

16 assumptions (8 certain, 7 confident, 1 tentative, 0 unresolved).
