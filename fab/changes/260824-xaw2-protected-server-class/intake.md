# Intake: Protected Server Class

**Change**: 260824-xaw2-protected-server-class
**Created**: 2026-08-24

## Origin

> Implement Change 1 (Protected Server Class) from fab/plans/sahil/26-08-23-rk-daemon-protection.md — read that plan file in full for the exact decisions, scope, and Non-Goals before drafting the intake (the plan already resolved the open questions; do not re-derive them from scratch). Ship off fresh origin/main per the Execution section (Wave 1).

One-shot `/fab-new` invocation. The design authority is the pre-resolved plan `fab/plans/sahil/26-08-23-rk-daemon-protection.md` (drafted 2026-08-23, rebased against `b1359bc7`, presented as artifact e25185b5). This intake transcribes the plan's Change 1 decisions verbatim and grades only the seams the plan left to implementation. Change 2 (SYSTEM presentation — host-page system card, shield glyph on server lists) is Wave 2 and is explicitly OUT of this change. All plan anchors were re-verified against this worktree's HEAD (`e3d93c10`) during intake: `handleServerKill` (`app/backend/api/servers.go:187`), `EphemeralOption`/`IsEphemeralServer` (`app/backend/internal/tmux/tmux.go:55`, `:2881`), the reaper's ephemeral enumeration + daemon hard-skip (`app/backend/internal/tmux/reaper.go`), `rk mux kill`'s agent-state gate (`app/backend/cmd/rk/mux_kill.go`), `POST /api/restart` (`app/backend/api/restart.go`, `router.go:744`), `DAEMON_SERVER`/`isInfraServer` and the `ephemeral` payload field (`app/frontend/src/api/client.ts:860`, `:854`), the kill confirm dialog (`app/frontend/src/components/server-dialogs.tsx`, 182 lines), and the palette-entry precedent (`app/frontend/src/lib/palette-server-kill.ts`).

## Why

`rk-daemon` is presented today as a peer tmux server with peer verbs: it is dimmed and pinned last (`isInfraServer`), but the palette offers `Server: Kill rk-daemon`, the confirm dialog's daemon warning is copy-only, and `POST /api/servers/kill` has **no guard at all** — any client or agent can decapitate the daemon, taking down the dashboard, `rk-jobs` (possibly mid-update, a documented past incident), code-server, and every remote tunnel. If we don't fix it, the accident class stays one misclick or one agent tool-call wide.

The tension: a power user genuinely wants force-kill; a new user kills the daemon because it looks like every other row. Resolution per the plan: **reframe, don't hide; guard, don't remove.** The mechanism is **born general** rather than daemon-special-cased: a `@rk_protected` server class (exact `@rk_ephemeral` mirror, inverted intent), with `rk-daemon` protected **by derivation** from its constant name — derivation beats options per Constitution Principle X — so one `tmux -L X set -s @rk_protected 1` gives any long-lived server the daemon's armor. Born-general beats build-then-generalize, and it deletes a stacked PR (the plan collapsed 3 changes into 2 on this reasoning).

Target lifecycle taxonomy after this change (three classes, unchanged count):

| Class | Source | Kill posture | List posture |
|-------|--------|--------------|--------------|
| ephemeral | `@rk_ephemeral` (shipped) | bulk-reapable, no ceremony | sinks to bottom, scratch badge |
| normal | default | existing confirm | normal |
| **protected** | derived for `rk-daemon`; `@rk_protected` opt-in elsewhere | 409 without force + typed confirm | shield glyph (Wave 2); service verbs for the daemon (Wave 2) |

## What Changes

### The class — `app/backend/internal/tmux`

- New server-scoped user option constant `ProtectedOption = "@rk_protected"` beside `EphemeralOption` (`tmux.go:55`).
- `IsProtectedServer(ctx, server) (bool, error)` — an exact mirror of `IsEphemeralServer` (`tmux.go:2881`) including its error taxonomy: unset option (`invalid option`/`unknown option` stderr) OR a dead/absent socket (`IsServerGone`) reads as `(false, nil)`; other subprocess failures propagate wrapped. A non-empty trimmed value is truthy; `"1"` is the documented convention.
- `MarkServerProtected` (set `"1"`, mirrors `MarkServerEphemeral`) and an unset counterpart (`set-option -s -u` — **unset demotes**; there is no tombstone value).
- **The guard predicate is `rk-daemon (derived) ∨ @rk_protected` from day one.** The daemon's identity derives from its constant socket name (`daemon.ServerSocket == "rk-daemon"`; `internal/tmux` already carries the same string as `productionDaemonServer` in `reaper.go`, avoiding an import cycle — the daemon package imports tmux, not vice versa). `rk-daemon` is protected by derivation, **never by option** — a hypothetical option write on it must not become the source of truth, and the derived state is not unmarkable.
- **Precedence: protected beats ephemeral** when both options are set on one server (a protected server is never bulk-reapable, whatever else it carries).
- Register `@rk_protected` in the `@rk_*` user-option registry (`docs/memory/run-kit/tmux-sessions.md`) at hydrate.

### Backend guard — `app/backend/api/servers.go`

- `handleServerKill` (`servers.go:187`) request body gains `force bool` (`json:"force"`). Guard order: validate name → evaluate the protected predicate → if protected and `!force`, respond **409** with a structured error that names the restart alternative and lets clients branch without string-matching, e.g. `{"error": "rk-daemon is protected — it hosts the run-kit daemon. Use Restart (POST /api/restart) instead, or pass force to kill anyway.", "protected": true}`. With `force: true` (or a non-protected target) the existing path runs unchanged (kill-notify audit, `KillServer`).
- `GET /api/servers` payload gains `protected bool` per entry, following the `ephemeral` field precedent exactly: the read joins the existing per-server best-effort fan-out (`servers.go:52–99`) — a per-server read failure degrades that entry to `protected: false`, never a 5xx.
- New mutation endpoint for the UI toggle: `POST /api/servers/protect` with body `{name, protected: bool}` (Constitution IX: POST-only; partial-state mutations ride the body). Validates the server name, **rejects `rk-daemon`** (derived protection is not togglable — 400), sets/unsets `@rk_protected`, and wakes the SSE hub so covered clients repaint without waiting for the safety poll (the known user-option-mutations-emit-no-control-mode-event gap — mirror whatever wake seam the color POST handlers use).

### CLI gates — `app/backend/cmd/rk`

- `rk mux kill` (`mux_kill.go`): the gate extends beyond `@rk_agent_state` — a target pane residing on a **protected server** is refused without the existing `--force` flag (no new flag). Refusal follows the established shape: names the reason on stderr, exits 1, performs no tmux mutation. `--force` skips both gates (target existence still validated). The pane's server is the resolved `-L` scope (`muxServer()`).
- `rk mux reap` (`reaper.go`): **skips protected servers unconditionally** — even under `--ephemeral` and even on a prefix match. Implementation mirrors `enumerateEphemeralServers`: enumerate `@rk_protected` among **live** servers (options are unreadable on dead sockets, and dead sockets are never resurrected by queries) and hard-skip matches in classification. Removing a *dead socket file* whose server was formerly protected remains allowed — a dead socket is inert and its removal harms nothing. The daemon is already covered on every path by the existing `productionDaemonServer` hard-skip. This is where protected-beats-ephemeral is observable: a server carrying both marks is skipped.
- Toolkit-standards pass over the changed CLI surface (help text for `mux kill`/`mux reap`): help-dump regeneration, readme-extraction, Principle 9 check, per the constitution's Toolkit Standards clause.

### Frontend — `server-dialogs.tsx`, `api/client.ts`, palette, flyout card

- `api/client.ts`: `protected?: boolean` joins the server payload type (beside `ephemeral?` at `:854`); `killServer` gains the `force` body field; new `setServerProtected(name, protected)` client call for the toggle endpoint.
- Kill confirm dialog (`server-dialogs.tsx`) **forks on protected targets**:
  - For `rk-daemon`: **primary action = "Restart run-kit"**, wired to the **existing** `POST /api/restart` → `daemon.Restart` (no new endpoint). Destructive secondary = **"Force kill"**, unlocked only by **typing the exact server name** into a text input (keyboard-first: input auto-focused, Enter submits when the name matches, Esc cancels).
  - For non-daemon protected servers: same typed-name unlock for the kill action; no Restart primary (`/api/restart` restarts the daemon, not arbitrary servers) — Cancel is the safe default.
  - Blast-radius copy enumerated **live from already-fetched session data** (no new endpoint): for the daemon, e.g. "kills the dashboard, 1 running job, code-server, 2 remote tunnels" derived from the `rk-jobs`/`rk-remotes` session/window counts the client already holds; for other protected servers, session/window counts.
  - **Non-protected servers: dialog unchanged — zero behavior drift.**
- Toggles: `Server: Protect` / `Server: Unprotect` palette entries (follow the `palette-server-kill.ts` registration pattern) + a toggle row in the server flyout card (the three-tier row flyout card). `rk-daemon` shows protected with the toggle **disabled** (derived, not unmarkable).
- Palette parity (Constitution V, v1.9.0 amendment — the palette is the complete action registry): register `Daemon: Restart`; force-kill stays reachable through the existing `Server: Kill` entry → guarded dialog (no separate force-kill palette entry).

### Tests

- Go units: `IsProtectedServer` set/unset/absent/dead-socket (mirror the `IsEphemeralServer` quartet at `tmux_test.go:2342+`); handler guard cases (daemon ± force, option-marked ± force, normal server unaffected, protect-endpoint daemon rejection); reap precedence (protected beats ephemeral, prefix-match skip) and mux-kill gate units (protected refusal, `--force` override) via the existing `muxKill*Fn` seams.
- Frontend units: dialog fork (typed-name gating — wrong name keeps the button locked, exact match unlocks, Esc cancels; restart wiring for the daemon; unchanged dialog for normal servers), toggle rows, palette registration.
- e2e: the typed confirm flow, with the mandatory `.spec.md` companion (constitution Test Companion Docs).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) register `@rk_protected` in the `@rk_*` user-option registry; protected class semantics and precedence over ephemeral
- `run-kit/agent-messaging`: (modify) `rk mux kill` protected-server gate; `rk mux reap` unconditional protected skip
- `run-kit/architecture`: (modify) `POST /api/servers/kill` force/409 guard, `protected` payload field, `POST /api/servers/protect` endpoint
- `run-kit/toolkit-standards`: (modify) help-dump/Principle 9 surface check over the changed `mux kill`/`mux reap` help text
- `run-kit/ui/dialogs-and-state`: (modify) kill-confirm fork — typed-name force unlock, daemon restart primary, blast-radius copy
- `run-kit/ui/keyboard-and-palette`: (modify) `Daemon: Restart` + `Server: Protect`/`Unprotect` palette actions
- `run-kit/ui/status-signals`: (modify) server flyout card protect toggle row

## Impact

- **Backend**: `app/backend/internal/tmux/tmux.go` (+ tests), `app/backend/internal/tmux/reaper.go` (+ tests), `app/backend/api/servers.go` (+ tests), `app/backend/api/router.go` (one route), `app/backend/cmd/rk/mux_kill.go` (+ tests), help-dump fixtures.
- **Frontend**: `app/frontend/src/api/client.ts`, `app/frontend/src/components/server-dialogs.tsx` (+ tests), `app/frontend/src/lib/palette-server-kill.ts` or sibling palette registration (+ tests), server flyout card component (+ tests), one e2e spec + `.spec.md`.
- **No new pages, routes (frontend), or settings surfaces** (Constitution IV; plan Non-Goal). One new POST API endpoint (`/api/servers/protect`) — an API route, not a UI route.
- **Out of scope** (plan Non-Goals): shell-level protection (`tmux -L rk-daemon kill-server` stays the tmux guard shim's jurisdiction — this change closes the UI and API accident paths); hiding infra from new users; protecting test/ephemeral classes; the SYSTEM presentation card and shield glyph (Wave 2).
- **Ships off fresh `origin/main`** (Wave 1; Wave 2 stacks on this branch).

## Open Questions

*None — the plan pre-resolved the open questions for Change 1; the one remaining open decision in the plan (HOST HEALTH zone vs distinct SYSTEM zone) belongs to Change 2.*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Guard predicate is `rk-daemon (derived) ∨ @rk_protected` from day one; daemon protected by name derivation, never by option | Plan explicit; Constitution X (derivation beats options); `daemon.ServerSocket`/`productionDaemonServer` constants verified | S:95 R:70 A:95 D:95 |
| 2 | Certain | `@rk_protected` is an exact `@rk_ephemeral` mirror: constant + `IsProtectedServer` reader with the same error taxonomy; unset demotes | Plan explicit; precedent verified at `tmux.go:55`/`2881` | S:90 R:85 A:95 D:95 |
| 3 | Certain | Precedence: protected beats ephemeral when both options are set | Plan explicit | S:95 R:80 A:90 D:95 |
| 4 | Certain | `handleServerKill` gains `force bool`; protected target without force → 409 with a structured error naming the restart alternative | Plan explicit; handler verified guardless at `servers.go:187` | S:95 R:80 A:90 D:90 |
| 5 | Certain | `GET /api/servers` carries `protected: bool` via the existing best-effort per-server fan-out | Plan explicit; `ephemeral` field precedent at `servers.go:27–99` | S:90 R:85 A:95 D:95 |
| 6 | Confident | New `POST /api/servers/protect {name, protected}` mutation endpoint backing the UI toggle; rejects `rk-daemon` (400); wakes the SSE hub after the option write | Plan names the toggle but no endpoint; POST-only per Constitution IX; shape follows the kill/reorder handlers; hub wake mirrors the color-POST seam (known safety-poll lag otherwise) | S:60 R:75 A:80 D:70 |
| 7 | Confident | `rk mux kill` "protected targets" = a pane residing on a protected server; refusal reuses the existing `--force` flag and refusal shape (stderr reason, exit 1, no mutation) | Plan says "extends its existing agent-state gate"; `mux kill` is pane-scoped (`mux_kill.go`), so server-of-pane is the only coherent reading | S:55 R:80 A:75 D:60 |
| 8 | Certain | `rk mux reap` skips protected servers unconditionally (even `--ephemeral`/prefix match), enumerated among live servers only; dead-socket file removal stays allowed | Plan explicit; mirrors `enumerateEphemeralServers`; options are unreadable on dead sockets and dead-socket queries must not resurrect servers (reaper.go comment contract) | S:90 R:80 A:90 D:85 |
| 9 | Certain | Daemon dialog fork: primary "Restart run-kit" wired to existing `POST /api/restart` (no new endpoint); destructive secondary "Force kill" unlocked only by typing the exact server name; keyboard-first, Esc cancels | Plan explicit; endpoint verified at `restart.go`/`router.go:744` | S:95 R:80 A:90 D:90 |
| 10 | Confident | Non-daemon protected servers get the same typed-name unlock but no Restart primary (restart is daemon-only); Cancel is the safe default | Plan specifies the fork "for the daemon" only; `/api/restart` restarts the daemon, so a Restart primary elsewhere would be wrong | S:55 R:80 A:70 D:60 |
| 11 | Confident | Blast-radius copy derives from session/window data the client already holds (rk-jobs/rk-remotes counts for the daemon; session/window counts elsewhere); no new endpoint | Plan says "enumerated live from session data"; exact copy shape left to apply | S:60 R:85 A:65 D:60 |
| 12 | Certain | Palette: register `Daemon: Restart` + `Server: Protect`/`Unprotect`; force-kill reachable only through the existing `Server: Kill` → guarded dialog; `rk-daemon`'s flyout toggle renders disabled | Plan explicit; Constitution V complete-action-registry mandate | S:90 R:85 A:90 D:90 |
| 13 | Certain | Non-protected servers see zero behavior drift: dialog, kill path, reap, and mux kill unchanged without the mark | Plan explicit ("zero behavior drift") | S:90 R:85 A:95 D:95 |
| 14 | Confident | No new rk CLI verb for protect/unprotect: raw `tmux -L X set -s @rk_protected 1` + the UI toggle are the mark surfaces | Plan names only the raw tmux command; adding a verb would widen the toolkit-standards surface for no stated need | S:55 R:85 A:70 D:65 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
