# Plan: Desktop View (GUI streaming as a lens, superseding PR #71)

**Authored**: 2026-07-14
**Author**: discussion session with Claude (`/fab-discuss`)
**Executor**: agents picking up changes one by one, each via the normal fab pipeline
**Status**: Plan only — no changes drafted yet (change 1 of the stack is drafted separately)

## Goal

Web-based desktop (GUI) streaming in run-kit — Xvfb + x11vnc + noVNC — delivered as a
**`desktop` lens on a normal window row** per
[`docs/specs/window-views.md`](../../../docs/specs/window-views.md), not as a special
window type. This plan supersedes **PR #71**
(`260323-a805-web-based-remote-desktop`): same proven stack, different integration
model, rebuilt against current main.

## Why supersede PR #71 instead of rebasing it

PR #71 validated the hard parts. It also predates both the window-views model and four
months of main. Two independent reasons to restart:

**Model conflicts** (each violates a spec rule):

1. **Name-prefix typing** — window type derived from a `desktop:` window-name prefix.
   Violates R1 (capability signals are options/derivations, names belong to users).
2. **Relay sniffing** — `/relay/{session}/{window}` auto-detects the window type and
   branches to a VNC proxy, making the tty **unreachable** for desktop windows. Violates
   R3: the pane runs the Xvfb/x11vnc supervisor, and watching that raw process is the
   run-kit ethos (and the debugging seam when VNC breaks).
3. **Fixed-at-creation view** — no way to flip between desktop and logs; view is
   identity. Violates R2/R5 (per-viewer `?view=desktop`, default-view hint only).

**Bitrot** (a rebase would fight all of it): the PR edits `dashboard.tsx` (deleted —
SessionTiles replaced it), `breadcrumb-dropdown.tsx` (gone — universal top-bar heading
redesign), `top-bar.tsx` (rewritten twice: 3-column grid, RootTopBar/AppLayout root
mount), and predates unified StatusDot, name-optional window creation, and the
(server, owning session)-keyed relay identity.

**What PR #71 got right — salvage as reference, cherry-pick judiciously:**

- The stack: Xvfb + WM detection + x11vnc **inside a tmux window** — tmux supervises,
  so desktops survive rk restarts (Constitution VI). Keep exactly this shape.
- Dynamic display/port allocation via `net.Listen(":0")` — no collisions.
- VNC port stored in a tmux window option — derivable, no DB (Constitution II).
- `DesktopClient` (noVNC canvas, `scaleViewport` client-side scaling), the desktop
  bottom bar (clipboard paste, resolution picker, fullscreen), `novnc.d.ts` typings.
- Resolution-change endpoint concept (`POST`, Constitution IX).

Branch `260323-a805-web-based-remote-desktop` stays available as the reference
implementation; close the PR with a comment linking this plan.

## Decision log (committed by this plan — intakes should treat these as Certain)

- **Desktop is a lens, not a type.** A desktop window is a normal window whose pane
  runs the display supervisor; `?view=desktop` renders noVNC, `?view=tty` (spec R3)
  shows the supervisor logs. Default view is `desktop` (spec R5 derived hint — same
  pattern as the chat plan's headless codex-server default).
- **Capability signal**: `@rk_desktop = <vnc-port>` window option, set by the launcher
  once x11vnc is listening, cleared by liveness reconciliation when the supervisor dies
  (mirror the `@rk_agent_state` reconciler pattern; a stale option must not leave a
  dead `[tty|desktop]` chip). Port ownership is verifiable at read time (the option is
  a hint; the probe is the truth — Constitution X spirit).
- **Explicit relay addressing, no sniffing**: the existing tty relay is untouched for
  every window; VNC gets its own WebSocket endpoint (e.g. `/relay-vnc/{server}/{window}`,
  resolved from `@rk_desktop`). The frontend picks the endpoint from the resolved view.
- **Creation**: the unified window-creation endpoint accepts a desktop kind (POST body
  field, like the existing `rkType`/`rkUrl` creation path — NOT a name convention). The
  pane command is the supervisor script/binary invocation; entry points are the `▾`
  switcher's `+ New Window` flow and a palette action, current-model equivalents of
  PR #71's three entry points.
- **Host-dependency probe**: `Xvfb`/`x11vnc`/WM presence is probed server-side
  (`exec.LookPath`, no shell strings — Constitution I); creation affordances hide (or
  error cleanly) when absent. run-kit gains no hard dependency.
- **Security**: x11vnc binds localhost-only (`-localhost`); the browser reaches it only
  through rk's authenticated WS proxy, same trust boundary as the terminal relay and
  `/proxy/{port}/`. Session/window inputs validated per Constitution I.
- **Switcher/UX machinery is inherited**, not built here: chip, palette parity,
  shortcut, heading (`Desktop: <window>`), localStorage — all from
  `260714-t97o-web-view-lens` (spec R4). This stack adds a segment, not a component.
- **Connection dot** in desktop view = VNC WS health (spec R6).

## The change stack

Linear dependency order. Each row becomes one fab change / one PR.
Agents: fill in your row when you create the change; mark Done when the PR merges.

| # | Slug (suggested) | Depends on | Change folder | PR | Status |
|---|------------------|-----------|---------------|----|--------|
| 1 | `web-view-lens` | — | `260714-t97o-web-view-lens` | | drafted (intake ready) |
| 2 | `desktop-capability-backend` | 1 merged | | | not started |
| 3 | `desktop-view-frontend` | 2 | | | not started |
| 4 | `desktop-resolution-clipboard` (optional polish) | 3 | | | not started |

---

### Change 2 — `desktop-capability-backend`

**Purpose**: everything Go — a desktop window can be created, carries a live
`@rk_desktop` capability, and its VNC socket is reachable over an rk WebSocket.

**Scope**:
- Supervisor launcher (script under `scripts/` or a `rk desktop-launch` subcommand —
  decide at intake; the pane command must be transparent in the tty view): allocate
  display + port (`net.Listen(":0")` pattern from PR #71), start Xvfb → WM → x11vnc
  `-localhost`, stamp `@rk_desktop=<port>`, clear on exit (trap). Restarts inside the
  same pane re-stamp.
- Liveness reconciliation for `@rk_desktop` (sessions enrichment seam — same place
  agent-state reconciles): option present but port not listening → treat as absent,
  optionally clear.
- Unified creation endpoint: desktop kind on the existing window-creation POST
  (`api/windows.go`), name-optional like every window.
- `/relay-vnc/{server}/{window}` WS endpoint (`api/relay.go` sibling): resolve
  `@rk_desktop`, proxy binary WS ⇄ TCP to the VNC port. Timeouts, connection cleanup on
  client disconnect (code-review.md rules), no orphaned sockets.
- Host-dep probe surfaced to the frontend (e.g. a `desktopAvailable` capability on an
  existing GET — no new route).
- Surface `@rk_desktop` in the sessions payload + SSE (per-window field, like
  `rkType`/`rkUrl`).

**Salvage**: PR #71's `relay.go` VNC proxy code, window/option plumbing in `tmux.go`,
`validate.go` additions — as reference; the option name, no-sniffing relay, and
reconciler are new.

**Acceptance**: `curl`-level — create a desktop window on a test tmux server, see
`@rk_desktop` stamped within seconds, WS dial to `/relay-vnc/...` reaches the VNC
handshake (RFB banner); kill x11vnc → capability disappears from the payload; `rk serve`
restart mid-session loses nothing. Go tests for allocation, option lifecycle, proxy
teardown. Zero frontend work.

---

### Change 3 — `desktop-view-frontend`

**Purpose**: the user-facing desktop lens.

**Scope**:
- noVNC dependency (re-verify current package/API at pickup — PR #71 used
  `scaleViewport`; the typings in its `novnc.d.ts` are a starting point).
- `DesktopClient` renderer mounted when `resolveView(...) === "desktop"` (machinery from
  change 1): connect to `/relay-vnc/...`, client-side scaling with aspect ratio,
  clipboard paste, fullscreen toggle (bottom-bar treatment per PR #71's
  `desktop-bottom-bar.tsx`, restyled to current house vocabulary).
- `desktop` registered in `availableViews` (gate: `@rk_desktop` present) +
  `defaultView` (desktop-capable → default `desktop`); chip shows `[tty|desktop]`;
  palette `View: Desktop`; heading `Desktop: <window>`.
- Creation UX: `+ New Window` flow gains a desktop option when `desktopAvailable`;
  palette action.
- Connection dot ⇒ VNC WS health in desktop view.
- Vitest for view-registry integration; Playwright e2e gated on host capability (skip
  cleanly when Xvfb absent — CI may not have it; the ungated assertions are chip/palette
  gating off a mocked payload). `.spec.md` companions, 375px + desktop viewports
  (mobile: canvas scales, tmux 80-col overflow rule doesn't apply here).

**Acceptance**: flip `[tty|desktop]` on a live desktop window and watch supervisor logs
in tty view while the desktop keeps running; deep link `?view=desktop` cold-loads; a
non-desktop window never shows the segment; dead supervisor → segment disappears, tty
still fine.

---

### Change 4 (optional) — `desktop-resolution-clipboard`

**Purpose**: quality-of-life once the lens is real.

**Scope**: resolution-change endpoint (POST; PR #71 restarted Xvfb at the new size —
evaluate `xrandr` on a virtual display first, since an Xvfb restart kills every X client:
if xrandr works, prefer it; either way surface the destructive case in the UI), resolution
picker, richer clipboard (read back from guest), mobile ergonomics pass
(`useVisualViewport` interplay).

---

## Pickup protocol (for the agent taking the next change)

1. Read this plan in full, plus: `docs/specs/window-views.md` (the authority),
   `fab/project/constitution.md`, the `ui-patterns` / `architecture` / `tmux-sessions`
   memory files, and the change-1 intake
   (`fab/changes/260714-t97o-web-view-lens/intake.md`).
2. Skim PR #71's branch (`260323-a805-web-based-remote-desktop`) for the salvage list —
   reference material, not a merge base.
3. Check the tracking table + `fab change list` — take the lowest-numbered change whose
   dependencies are **merged to main**.
4. Draft via `/fab-new <slug>`; reference this plan in the intake. Treat the Decision
   log as Certain in SRAD scoring; the per-change "decide at intake" items are where
   clarification effort goes.
5. Fill in your row in the tracking table in the same PR; mark Done when the PR merges.
6. Run the normal pipeline (`/fab-fff` or stage-by-stage `/fab-continue`).

## Out of scope (entire plan)

- Desktop lenses on board panes (boards render tty panes; `(window, view)` pins are a
  spec-flagged future).
- Audio, GPU acceleration, multi-monitor, session recording.
- Any VNC exposure that bypasses rk's WS proxy.
- Windows/macOS host support (Xvfb is X11/Linux; probe simply reports unavailable).

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Host deps (Xvfb/x11vnc/WM) missing or version-drifted | Server-side probe gates all affordances; zero hard dependency; document install hints in README |
| 2 | e2e can't run the X stack on CI | Capability-gated e2e (clean skip); proxy + option lifecycle covered by Go tests; chip/palette gating covered against mocked payloads |
| 3 | noVNC package drift since PR #71 (2026-03) | Change 3 starts with a verification pass; typings re-derived |
| 4 | WS⇄TCP proxy leaks connections | code-review.md rules apply (timeouts, cleanup on disconnect); teardown is an explicit Go test |
| 5 | Stale `@rk_desktop` after supervisor death → dead chip | Reconciler + read-time probe are in change 2's acceptance, not an afterthought |
| 6 | Resolution restart kills X clients (change 4) | Prefer xrandr-on-virtual-display if viable; otherwise explicit destructive-action UI |
| 7 | Scope creep back toward "desktop window type" | The spec's R1–R5 are binding; anything keying behavior off window names or hiding the tty is out |
