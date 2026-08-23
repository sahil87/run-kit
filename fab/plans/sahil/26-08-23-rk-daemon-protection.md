# rk-daemon Protection — Protected Server Class + SYSTEM Presentation

**Drafted**: 2026-08-23 · rebased against `b1359bc7` · follows the shipped `@rk_ephemeral` arc (#695 #696 #698 #700) · traces backlog `[f2b7]` follow-on discussion
**Shape**: 2 changes (collapsed from an earlier 3-change draft — see Execution)
**Presented**: artifact <https://claude.ai/code/artifact/e25185b5-c54a-4ecc-8bd1-0c2708203834>

## Diagnosis

`rk-daemon` is shown today — dimmed and pinned last (`isInfraServer`, `app/frontend/src/api/client.ts`) — but presented as a **peer server with peer verbs**. The palette offers `Server: Kill rk-daemon`; the confirm dialog's daemon warning (`server-dialogs.tsx`) is copy, not enforcement; and `POST /api/servers/kill` (`app/backend/api/servers.go`, `handleServerKill`) has **no guard at all**. Any client or agent can decapitate the daemon — taking down the dashboard, `rk-jobs` (possibly mid-update, a documented past incident), code-server, and every remote tunnel.

The tension: a power user genuinely wants force-kill, job-watching, and code-server access; a new user kills the daemon because it looks like every other row. Resolution: **reframe, don't hide; guard, don't remove.**

The `@rk_ephemeral` trick extends here *inverted* — not for the daemon itself (its identity is derivable from the `DAEMON_SERVER` / `daemon.ServerSocket` constant; derivation beats options per Constitution Principle X), but as a user-settable `@rk_protected` class.

### Server lifecycle taxonomy (target state)

| Class | Source | Kill posture | List posture |
|-------|--------|--------------|--------------|
| ephemeral | `@rk_ephemeral` (shipped) | bulk-reapable, no ceremony | sinks to bottom, scratch badge |
| normal | default | existing confirm | normal |
| **protected** | derived for `rk-daemon`; `@rk_protected` opt-in elsewhere | 409 without force + typed confirm | shield glyph; service verbs for the daemon |

### Constraints picked up on rebase (2026-08-23)

- **Constitution v1.9.0 (Principle V amendment)**: the command palette is the *complete action registry* — every action reachable via a shortcut or UI control MUST also be palette-registered. `Daemon: Restart`, `Force kill`, and the Protect/Unprotect toggles are palette entries by mandate.
- **PR #716** (per-worktree e2e isolation): parallel worker worktrees run e2e safely now.
- Anchors verified untouched at `b1359bc7`: `handleServerKill`, `server-dialogs.tsx`, host-page zones, `internal/daemon`.

## Change 1 — Protected Server Class (ships first, off main; MEDIUM)

The safety core, **born general**: the guard predicate is `rk-daemon (derived) ∨ @rk_protected` from day one. One `tmux -L X set -s @rk_protected 1` gives any long-lived server the daemon's armor.

### The class — `internal/tmux`

- Server-scoped option `@rk_protected`, exact mirror of `@rk_ephemeral`: constant + `IsProtectedServer` reader; unset demotes; register in the `@rk_*` registry memory (`docs/memory/run-kit/tmux-sessions.md`).
- **Precedence: protected beats ephemeral** when both are set. `rk-daemon` is protected by derivation (`daemon.ServerSocket`), never by option.

### Backend guard — `app/backend/api/servers.go`

- `handleServerKill` gains `force: bool`; a protected target without force → **409** with a structured error naming the restart alternative.
- `GET /api/servers` carries `protected: bool` (the `ephemeral` field precedent).

### CLI gates — `rk mux`

- `rk mux kill`: refuses protected targets without `--force` (extends its existing agent-state gate).
- `rk mux reap`: skips protected servers unconditionally — even under `--ephemeral` or a prefix match.
- Toolkit-standards pass for the flag surfaces (help-dump, readme-extraction, Principle 9).

### Frontend — `server-dialogs.tsx`, `api/client.ts`

- Confirm dialog forks on protected targets: **primary = "Restart run-kit"** for the daemon (wired to the existing `POST /api/restart` → `daemon.Restart` — no new endpoint); destructive secondary = **"Force kill"**, unlocked only by *typing the server name* (keyboard-first, Esc cancels).
- Blast-radius copy enumerated live from session data: "kills the dashboard, 1 running job, code-server, 2 remote tunnels."
- Toggles: `Server: Protect / Unprotect` palette entries + a row in the server flyout card. `rk-daemon` shows protected with the toggle disabled (derived, not unmarkable).
- Palette parity (v1.9.0): register `Daemon: Restart`; force-kill stays reachable through the existing `Server: Kill` entry → guarded dialog.
- Non-protected servers: dialog unchanged — zero behavior drift.

### Tests

Reader units (set/unset/absent); handler guard cases (daemon ± force, option ± force, normal server unaffected); reap-precedence and kill-gate units; dialog units (typed-name gating, restart wiring, toggle rows); e2e for the typed confirm + `.spec.md` companion.

## Change 2 — SYSTEM presentation (stacked on 1; MEDIUM, UI)

The UX reframe: the daemon reads as what it is — the system, not another workspace. Service verbs instead of tmux-server verbs.

- **Host page**: a *run-kit system card* in an existing zone — daemon version/uptime/port → *Restart*; jobs, code-server, remotes rows with live status → *View*, deep-linking to ordinary `/$server/$window` terminal routes. Nothing loses terminal access.
- **Server lists**: `rk-daemon` keeps its dim-and-pin-last treatment, plus a shield glyph shared with `@rk_protected` servers — rendered from the `protected` payload flag.
- **Palette parity (v1.9.0)** for every card verb — *Restart* is covered by change 1's entry; *View* rows ride the existing switch/navigation entries.
- Tests: card render units; e2e on the zone card + deep links; `.spec.md` companions.

**Open decision (the one remaining)**: extend the HOST HEALTH zone (recommended — scaffolding and heading idiom already exist) vs. a distinct SYSTEM zone.

## Non-Goals

- **Shell-level protection** — `tmux -L rk-daemon kill-server` stays the tmux guard shim's jurisdiction. This plan closes the *UI and API* accident paths.
- **Hiding infra from new users** — safety comes from verb-shaping and guards, not concealment; the section-visibility rail already covers show/hide preference.
- **Protecting test/ephemeral classes** — orthogonal; the taxonomy stays three states.
- **No new routes, pages, or settings surfaces** (Constitution IV).

## Execution

1. Draft two intakes carrying these decisions as graded SRAD assumptions (the f2b7 pattern: intakes drafted in one worktree, copied into each worker worktree before dispatch).
2. **Wave 1** = Protected Server Class off fresh `origin/main`. **Wave 2** = SYSTEM presentation, stacked on wave 1's branch once its draft PR ships (retarget to main after merge) — or off main after the merge; no parallelism needed in this shape.

> Collapsed from three changes: the guard seam and the `@rk_protected` class that widens it ship as one change — born-general beats build-then-generalize, and it deletes a stacked PR. The SYSTEM card stays separate: it is the only piece with an open design decision and UI-review churn, and the safety core shouldn't wait on it.
