# Intake: Daemon SYSTEM Presentation

**Change**: 260824-j2k6-daemon-system-presentation
**Created**: 2026-08-24

## Origin

> Implement Change 2 (SYSTEM presentation) from fab/plans/sahil/26-08-23-rk-daemon-protection.md — read that plan file in full for the exact decisions, scope, and Non-Goals before drafting the intake (the plan already resolved the open questions; do not re-derive them from scratch). This change is stacked on Change 1 (Protected Server Class, PR run-kit#730, branch 260824-xaw2-protected-server-class) which this worktree is already branched off of — the protected field and shield-glyph payload from Change 1 already exist in this branch. Ship this as a PR based on 260824-xaw2-protected-server-class, not main.

One-shot `/fab-new` invocation. The design authority is the pre-resolved plan `fab/plans/sahil/26-08-23-rk-daemon-protection.md` (drafted 2026-08-23, rebased against `b1359bc7`, presented as artifact e25185b5). This intake transcribes the plan's Change 2 decisions and grades the seams the plan left to implementation. The plan's one remaining open decision (HOST HEALTH zone vs a distinct SYSTEM zone) carries the plan's own recommendation — extend HOST HEALTH — adopted here as a Confident assumption.

**Change 1 state, verified in this branch at HEAD `64870cae`** (commit `b4bf612b`): the `protected: bool` server-payload field (`GET /api/servers`), `DAEMON_SERVER` export + `setServerProtected` client call (`app/frontend/src/api/client.ts:864`), the kill-dialog protected fork with `protectedBlastRadius(target, sessions)` deriving live copy from the rk-jobs/rk-code-server/rk-remotes sibling sessions (`app/frontend/src/components/server-dialogs.tsx:16`), the sidebar flyout Protect/Unprotect toggle (`sidebar/index.tsx`), the `Daemon: Restart` + `Server: Protect`/`Unprotect` palette entries (`app/frontend/src/lib/palette-server-protect.ts`), and the backend 409 guard + `POST /api/servers/protect`. **No shield glyph is rendered anywhere yet** (verified: zero "shield" hits in `app/frontend/src`) — the glyph is this change's work, consuming Change 1's payload flag.

Change 2 anchors verified at this HEAD: HOST HEALTH zone (`app/frontend/src/components/host-overview-page.tsx:314–342`, `SectionHeading label="Host Health"`, body renders `HostMetrics` from `useHostMetrics`); TMUX SERVERS tile grid with the ephemeral scratch-chip + grey-name precedent (`host-overview-page.tsx:408–439`); `sessionsByServer` map + lazy `attachServer(name)` seam (`contexts/session-context.tsx:134,166`); daemon version over the cached SSE `event: version` slot `{version, boot, brew}` seeded by `SetVersion` at boot (`api/sse.go:925`, `cmd/rk/serve.go:180` — `boot` is random hex, NOT a timestamp, so daemon uptime is not currently derivable client-side); `POST /api/restart` (`router.go:759`); the `/$server/$window` terminal route where the URL segment is the numeric part of the `@N` window id (`router.tsx:88–103`); sibling-session constants `JobsSessionName = "rk-jobs"` (`internal/daemon/jobs.go:20`), `SessionName = "rk-remotes"` (`internal/remote/store.go:37`), rk-code-server (`daemon.go:214` — all sibling sessions on the rk-daemon socket).

## Why

Change 1 armed the guards: killing `rk-daemon` now takes a 409-backed typed confirm, and `@rk_protected` generalizes the armor. But the daemon still *reads* as a peer workspace — a dimmed row in a server list with tmux-server verbs. The UX reframe is the second half of the plan's resolution ("reframe, don't hide; guard, don't remove"): the daemon should read as **the system** — daemon version/uptime/port with a *Restart* service verb, and its cargo (jobs, code-server, remote tunnels) as service rows with live status and *View* links — while protected servers everywhere get a visible class marker (the shield glyph) so the guard Change 1 added has a legible cause.

If we don't ship this, the protection is invisible until the moment it blocks you: a user learns a server is protected only by hitting the 409 dialog, and the daemon's actual services (is a job running? is code-server up? how many tunnels?) stay buried behind terminal spelunking into sibling sessions. Verb-shaping is the safety mechanism the plan chose over concealment — the section-visibility rail already covers hiding, and nothing here removes terminal access.

## What Changes

### Backend — daemon uptime/port over the version SSE slot (`app/backend/api/sse.go`, `cmd/rk/serve.go`)

The system card shows daemon **version / uptime / port**. Version already rides the cached server-global `event: version` SSE payload (`{version, boot, brew}`, replayed to every client on connect). Uptime and port have no client-visible source today (`boot` is random hex; the client's origin port is unreliable behind the Tailscale HTTPS proxy). Extend the same seam:

- `SetVersion` payload gains `started` (daemon process start, epoch seconds) and `port` (the resolved `RK_PORT` the daemon bound). Both are known at the existing `apiServer.SetVersion(version, newBootID(), selfBrew)` call site (`serve.go:180`).
- Client renders uptime as `now − started` using the existing `formatUptime` helper (`components/host-metrics.tsx:9` — already exported and unit-tested).
- No new endpoint, no new route (plan Non-Goal: no new routes). Older-daemon payloads without the fields degrade gracefully (the card omits the uptime/port line) — the mixed-version pattern the `boot` field already established.

### Frontend — run-kit system card in the HOST HEALTH zone (`app/frontend/src/components/host-overview-page.tsx` + new component)

A *run-kit system card* rendered inside the existing HOST HEALTH zone (extend, not a new zone — plan recommendation; the scaffolding and `SectionHeading` idiom already exist at `host-overview-page.tsx:314`). Content:

- **Daemon line**: version (session-context's `version`), uptime (`formatUptime(now − started)`), port → **Restart** action wired to the exact same restart flow Change 1's `Daemon: Restart` palette entry uses (`POST /api/restart` → `daemon.Restart`; reuse the existing action/confirm seam — no new endpoint, no second restart implementation).
- **Service rows** — jobs, code-server, remotes — with live status derived from `sessionsByServer.get(DAEMON_SERVER)` exactly as `protectedBlastRadius` does (`server-dialogs.tsx:16–29`): `rk-jobs` window count = running jobs, `rk-code-server` session presence = code-server up, `rk-remotes` window count = active tunnels. The host page calls `attachServer(DAEMON_SERVER)` (the existing lazy-attach seam) so the rows are live.
- Each present service row gets a **View** action deep-linking to the ordinary `/$server/$window` terminal route for that session's active (or first) window on the rk-daemon server — the same navigation the sidebar rows use, so **nothing loses terminal access**. An absent sibling session renders the row with a not-running status and no View link.
- The card renders independently of `hostMetrics` (the daemon serving the page is by definition up even when the metrics stream hasn't reported).

### Frontend — shield glyph on server lists (`host-overview-page.tsx`, `sidebar/index.tsx`)

- A shared shield glyph rendered from Change 1's `protected` payload flag, with `rk-daemon` shown protected by client-side derivation (`name === DAEMON_SERVER || server.protected` — the same `∨` Change 1's sidebar toggle already computes at `sidebar/index.tsx` `serverProtected`).
- Surfaces: the host TMUX SERVERS tile (beside the ephemeral scratch-chip precedent, `host-overview-page.tsx:437–439` — note the tile map currently destructures `{ name, sessionCount, ephemeral }` and must pick up `protected`) and the sidebar server row header. Both are "server lists" per the plan.
- `rk-daemon` **keeps its dim-and-pin-last treatment unchanged** (`isInfraServer` sort + grey name) — the glyph is additive.
- Glyph is an inline SVG in the shared control-glyph register (`top-bar-icons.tsx` per the register convention) or a sibling shared module — one definition, both surfaces consume it.

### Palette parity (Constitution V, v1.9.0)

No new palette entries: *Restart* is covered by Change 1's `Daemon: Restart`; *View* rows ride the existing window/session navigation entries (palette switch actions already reach every `/$server/$window` target). The card adds no action that is not already palette-reachable — verified against the plan's explicit statement.

### Tests

- Card render units: daemon line (version/uptime/port formatting, graceful omission on old payloads), service-row derivation (present/absent sessions, counts), Restart wiring, View link targets.
- Shield glyph units: renders for `protected: true` servers and for `rk-daemon` (derived), absent otherwise — both surfaces.
- e2e: the HOST HEALTH zone card renders on `/` with service rows, and a View deep-link lands on the terminal route — with the mandatory `.spec.md` companion (constitution Test Companion Docs).
- Go unit: `SetVersion` payload carries `started`/`port` (extend the existing sse_test.go version-slot tests).

## Affected Memory

- `run-kit/ui/routes-and-shell`: (modify) run-kit system card in the HOST HEALTH zone (daemon line + service rows + View deep-links); shield glyph on the TMUX SERVERS tile grid beside the scratch-chip treatment
- `run-kit/ui/sidebar`: (modify) shield glyph on server row headers; host-page zone content (HOST HEALTH extension)
- `run-kit/ui/status-signals`: (modify) the shield glyph as the protected-class marker shared across server lists
- `run-kit/architecture`: (modify) `event: version` SSE payload extension (`started`, `port`)
- `run-kit/ui/updates-and-notifications`: (modify) the version-event payload schema note (fields ride the same cached slot the reload guard consumes; guard semantics unchanged)

## Impact

- **Backend**: `app/backend/api/sse.go` (SetVersion payload) + `sse_test.go`, `app/backend/api/tmuxctl_bridge.go` (SetVersion signature), `app/backend/cmd/rk/serve.go` (call site).
- **Frontend**: `app/frontend/src/components/host-overview-page.tsx` (+ test), a new system-card component (+ test), `app/frontend/src/components/sidebar/index.tsx` (+ test), `app/frontend/src/contexts/session-context.tsx` (version-event fields), shared glyph module (`top-bar-icons.tsx` or sibling), one e2e spec + `.spec.md`.
- **No new pages, routes, endpoints, or settings surfaces** (Constitution IV; plan Non-Goal). No new palette entries.
- **Out of scope** (plan Non-Goals): shell-level protection (tmux guard shim's jurisdiction); hiding infra from new users (verb-shaping, not concealment); protecting test/ephemeral classes; all Change 1 guard mechanics (already shipped in this branch).
- **Ships stacked**: PR based on `260824-xaw2-protected-server-class` (PR #730), NOT main; retarget to main after #730 merges (plan Execution, Wave 2).

## Open Questions

*None — the plan pre-resolved Change 2's decisions; its one flagged open decision (zone placement) came with a recommendation, adopted below as assumption #1.*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The system card extends the existing HOST HEALTH zone — no distinct SYSTEM zone | The plan's one open decision, with an explicit recommendation ("scaffolding and heading idiom already exist" — verified at host-overview-page.tsx:314); zone placement is cheap to move later | S:60 R:75 A:70 D:65 |
| 2 | Certain | Card verbs: Restart reuses `POST /api/restart` via Change 1's existing action seam; View deep-links to ordinary `/$server/$window` terminal routes; nothing loses terminal access | Plan explicit; endpoint and route verified at router.go:759 / router.tsx:88 | S:90 R:85 A:90 D:90 |
| 3 | Confident | Daemon uptime + port ship as `started` (epoch) + `port` fields on the existing cached `event: version` SSE payload; older payloads degrade to omitting the line | Plan names version/uptime/port but no data source; `boot` is random hex (not a timestamp) so a new field is required; SetVersion boots with both values in hand; no-new-routes Non-Goal rules out a new endpoint | S:55 R:80 A:80 D:70 |
| 4 | Confident | Service rows derive from `sessionsByServer.get(DAEMON_SERVER)` after `attachServer(DAEMON_SERVER)`: rk-jobs windows = jobs, rk-code-server presence = code-server, rk-remotes windows = tunnels; absent session ⇒ not-running row, no View link | Exact mirror of Change 1's `protectedBlastRadius` derivation (server-dialogs.tsx:16); sibling-session constants verified in internal/daemon + internal/remote; the lazy-attach seam is the established pattern | S:65 R:80 A:85 D:75 |
| 5 | Certain | Shield glyph renders from the `protected` payload flag with rk-daemon derived client-side (`name === DAEMON_SERVER ∨ protected`) — the same predicate Change 1's flyout toggle computes | Plan explicit ("rendered from the protected payload flag"); Change 1's `serverProtected` precedent in sidebar/index.tsx | S:85 R:85 A:90 D:90 |
| 6 | Confident | Glyph surfaces are the host TMUX SERVERS tiles and the sidebar server row headers; one shared inline-SVG definition | Plan says "server lists" (plural) without enumerating; these are the two server-list surfaces; the scratch-chip precedent marks the tile insertion point | S:55 R:85 A:75 D:65 |
| 7 | Certain | rk-daemon keeps its dim-and-pin-last treatment unchanged; the glyph and card are additive | Plan explicit | S:90 R:85 A:95 D:95 |
| 8 | Certain | No new palette entries: Restart is Change 1's `Daemon: Restart`; View rides existing navigation entries (Constitution V parity holds without additions) | Plan explicit ("Restart is covered by change 1's entry; View rows ride the existing switch/navigation entries") | S:90 R:85 A:90 D:90 |
| 9 | Certain | Ships as a stacked PR based on `260824-xaw2-protected-server-class` (PR #730), not main; retarget after #730 merges | User instruction verbatim + plan Execution Wave 2; worktree already branched off Change 1 | S:95 R:80 A:95 D:95 |
| 10 | Confident | The card renders independently of the hostMetrics stream (no metrics ⇒ card still shows; the daemon serving the page is up by definition) | The zone's existing empty-state gates only the HostMetrics body; coupling the card to an unrelated stream would fabricate a dependency | S:50 R:85 A:80 D:75 |
| 11 | Confident | View targets the session's active (or first) window; the card is read-only otherwise — no kill/create verbs on service rows | Plan gives View + Restart as the card's only verbs ("service verbs instead of tmux-server verbs"); richer per-row verbs would re-widen the surface the reframe narrows | S:55 R:85 A:75 D:70 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
