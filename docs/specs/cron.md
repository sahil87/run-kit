# Cron — rk-Owned Clock Substrate

> A server-scoped scheduling substrate hosted by the rk daemon: durable cron
> entries in one intent file per tmux server, fired into agents resolved at
> delivery time. The operator is the predominant client — its tick rides an
> idle-anchored backoff schedule and survives operator death — but any agent
> can create entries, and the creating agent becomes the default target.
> Everything here is **[target]** — nothing is implemented.
>
> Companions: [`agent-state.md`](agent-state.md) (the idle epoch the backoff
> schedule derives from; the `@rk_pane_agent_session` session key that names targets),
> [`agent-messaging.md`](agent-messaging.md) (the communication standard —
> delivery is one client of its write channel and readiness gate),
> [`api.md`](api.md) (endpoint surface). Visual design:
> [`docs/wiki/cron-clock-design-studies.html`](../wiki/cron-clock-design-studies.html)
> (the three-tier UI mocks, backoff timeline, resolution ladder). The UI is
> tiered (§ UI): a sidebar `CLOCK` section for the glance, the operator
> console's desktop Activity segment and the tmux Server page zones as the
> larger views, boards for immersion — the right panel is retired, so no
> panel/rail placement exists. Cross-repo: this spec supersedes the
> **Clock B ownership** half of fab-kit's operator pulse plan
> (`fab/plans/sahil/26-09-03-operator-pulse-plan.md`, apt-marten worktree) —
> the clock moves into rk; fab keeps owning what a tick *means*. The operator
> substrate it builds on is **shipped** (#839–#842 wave): `@rk_win_role=operator`
> radio semantics with the `_rk-operator` home session, the `rk operator`
> launcher, `rk mux sessions` role facts, and the operator console
> (quake drawer + top-bar omnibox).

---

## The Problem

1. **Monitoring liveness depends on the monitored session.** The operator's
   cadence lives in a `/loop` inside its own Claude session; a Ctrl-C, restart,
   or compaction kills the timer silently and nothing notices (the
   dev-ws-sahil01 incident, 2026-09-03).
2. **Recurring work has no durable home.** A recurring task handed to an agent
   dies with the agent's session. There is no machine-local, session-independent
   scheduler an agent can program.
3. **No visibility.** Neither "what is scheduled" nor "what is the operator
   currently watching" is renderable anywhere — the facts live in transient
   session context.

## Clock Taxonomy & Scope

A "clock" here is anything that **delivers a payload to a target** when a
predicate over (time, derived state) becomes true. Five kinds; the last is
deliberately out of scope:

| Kind | Anchor | In scope? |
|------|--------|-----------|
| Wall-clock schedule (`cron`) | absolute time | yes |
| Interval (`every`) | time since last delivery | yes |
| Duration-since-state (`backoff`) | a derived epoch (pane idle-since) | yes |
| Edge trigger (`wake_on`) | a state *transition* (agent-state change) | yes — a watch, not a timer, but it shares everything except the predicate |
| Ephemeral wait | one-shot, held by a live caller | **no** — `rk mux await` owns it (shipped); the boundary rule: a wait that must **outlive its intender** is a one-shot cron entry, an ephemeral one is an await |

Two scope rules:

- **Internal tickers are not crons.** The safety poll, snapshotter, and
  BranchRefresher have no target and no delivery — they refresh derived
  state, stay anonymous, and never enter the registry. *No target ⇒ not a
  cron.*
- **The operator's compound need is a union predicate**, not a new kind: one
  entry with `schedule: backoff` **and** `wake_on: agent-state-change`
  (debounced, so five workers flipping in one second coalesce into one tick).

## The Model

1. **A stateless evaluator, pluggable invokers.** The clock's core is
   `rk cron tick` — a short-lived idempotent verb: read the entry files,
   derived state (idle epochs, pane liveness), and the delivery log; compute
   what is due; deliver; append to the log; exit. (The fab operator state
   file is read for watchlist display only — § Watchlist — never to decide
   whether a fire is emitted.) It holds **no in-memory schedule state**, so every invoker is
   equivalent, serialized by a non-blocking flock: the **rk-daemon ticker
   goroutine** is the default (an isolated goroutine sharing no locks with
   the serving path — the process-internal separation that actually protects
   the tick from a busy handler), an **OS user timer** is the drop-in
   alternate for machines that reboot unattended, and manual invocation is
   the debug path. Promoting the evaluator to its own process later is a
   config change, not a redesign — the escape hatch if the daemon ever
   proves untrustworthy as a host. A restart's worst case is one duplicate
   idempotent fire.
2. **One cron file per tmux server.** Entries are *intent*, the same class as
   `.status.yaml` and `config.yaml` — read from disk at evaluation/request
   time, never a derived-state store (Constitution II holds; see § Constitution
   Alignment).
3. **Entries name targets, not panes.** A target is resolved at fire time —
   by role, or by agent chat session id — so a killed-and-relaunched operator
   keeps receiving its tick, and a resumed agent keeps receiving its task.
4. **Delivery rides the one injection engine** (`internal/inject`, per
   [`agent-messaging.md`](agent-messaging.md)'s write channel) — never raw
   `send-keys` — so the pane-mode guard, echo probe, and submit verification
   are inherited, not reimplemented.
5. **The operator is one client among many** — the first and most important
   one, but the substrate is agent-generic.

---

## Cron State

**Location**: `$XDG_STATE_HOME/run-kit/cron/<server-slug>.yaml` — one file per
tmux server, keyed by socket name (the pulse-plan sidecar precedent; a
separate subdir, never parsed as anything else).

```yaml
entries:
  - id: a3f9                     # 4-char, rk-generated
    name: operator tick
    schedule: { kind: backoff, min: 60s, max: 30m }
    wake_on: { event: agent-state-change, scope: server, debounce: 60s }
    target: { kind: role, role: operator }
    payload: "operator tick"
    deliver: immediate           # immediate | when-idle
    if_absent: respawn           # skip | notify | respawn
    respawn: ["rk", "operator", "-L", "{server}"]   # argv; {server} → the stamped server name
    pinned: true                 # never orphan-expired
    # muted_until: 1788261200    # optional mute lease (unix seconds) — expiry unmutes with no write
    created_by: { session: 8c1e…, pane: "%12", at: 1788254000 }
  - id: k7q2
    name: hourly PR sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: session, session: 4fe2… }   # @rk_pane_agent_session id
    payload: "check open PRs for new review comments and triage them"
    deliver: when-idle
    if_absent: skip
    created_by: { session: 4fe2…, pane: "%31", at: 1788255100 }
```

Runtime facts (`last_fired`, `next_fire`, backoff rung, orphaned-since) are
**not** stored in the file — they are derived (see § Schedules) or held
in-memory and re-derived on restart. The file changes only on add / rm /
pin / mute.

## Schedules

| Kind | Semantics | State stored |
|------|-----------|--------------|
| `every` | Fixed interval from creation; fires when `now − last_delivery ≥ interval` | none — last delivery derives from the delivery log line |
| `backoff` | Duration-based, anchored on a **derived epoch**: fire times are `anchor + min·(2ⁿ − 1)` (i.e. +1m, +3m, +7m, +15m…), capped at `max` | **none** — the schedule is a pure function of the anchor |
| `cron` | Classic 5-field expression | none | 

The `backoff` anchor for the operator tick is the **agent idle epoch** already
carried by `@rk_pane_agent_state` — rk-owned substrate, re-read each
evaluation. **The anchor-join rule (load-bearing):** the effective anchor is
*the last activity not caused by the clock* — the evaluator joins the raw
idle epoch against the delivery log and ignores idle-epoch resets that
immediately follow its own delivery. Without the join, every delivered tick
makes the operator busy, resets the raw epoch, and pins the ladder at rung 1
forever (the self-resetting-ladder bug). Both inputs live on disk, so the
schedule stays a pure function and a restart at worst re-fires one due tick —
every payload must tolerate that (ticks are idempotent by contract).

**Union predicate** (optional per entry, derivable):

- `wake_on` — an edge trigger OR'd with the schedule: fire when the named
  transition occurs (v1: `agent-state-change`, server-scoped). Three rules
  keep it from feeding on itself:
  - **Self-exclusion (the wake analogue of the anchor-join rule):** the
    entry's own resolved target pane is excluded from the fingerprint the
    entry observes. A delivery makes the target busy; that flip is caused by
    the clock and must never read as the next edge. An unresolved target has
    nothing to exclude.
  - **Transition filter:** a transition to `waiting` or `idle`, or a pane
    disappearing, is actionable and fires; a transition to `active`
    (including a pane first appearing as `active`) advances the observation
    without firing — an agent starting work never needs the target's
    attention, a completion or a question does.
  - **Debounce = hold after own delivery:** an actionable edge inside
    `debounce` of the entry's own newest delivery is held (kept pending, not
    dropped) and fires on a later poll; a burst still coalesces into one
    delivery. The operator tick seeds `60s`, and `rk operator` raises an
    existing below-spec value to it.

**Catch-up policy**: a wall-clock `cron` fire missed while no invoker ran
defaults to **skip** (never fire late); `catch_up: once` is the per-entry
opt-in for at-most-one late fire. Landed semantics (C9): an occurrence stays
due for a grace window of `DefaultCronGrace` (2m — covers tick jitter and
short daemon restarts), extended to `DefaultHoldWindow` (2h) for
`deliver: when-idle` entries so a busy-pane hold can outlive the grace; a
stale occurrence past its window logs exactly one `missed` delivery-log line
per gap (mute-gated like a fire, target-independent — schedule history, not
delivery), which advances the anchor past the gap; `catch_up: once` lifts the
lateness bound and fires the latest stale occurrence exactly once.

## Targets & Fire-Time Resolution

| Kind | Names | Resolution at fire | Lifetime |
|------|-------|--------------------|----------|
| `role` | A server role — any `@rk_win_role` value (`operator` is the predominant one) | The window carrying that `@rk_win_role` value → its agent pane (the operator role rides the shipped radio semantics; equivalently the `_rk-operator` member) | Never orphans — the role outlives any pane |
| `session` | An agent chat session (`@rk_pane_agent_session` id) | The live pane carrying that session id | Orphans when no pane resolves |
| `pane` | A raw pane id | That pane, if alive | Dies with the pane (discouraged; exists for scripts) |

**Creator auto-capture**: `rk cron add` run inside a pane derives the caller's
identity from `$TMUX_PANE` + socket → its `@rk_pane_agent_session` session and role, and
defaults `target` to the session (role if one is held). "The agent that uses it
becomes the target" costs no arguments.

**`if_absent` ladder** when resolution fails at fire time:

- `skip` — record a missed fire; entry trends toward orphaned.
- `notify` — `rk notify` (fail-silent contract) with entry name and server.
- `respawn` — run the entry's own `respawn: [argv...]` command as an
  argv-slice exec (never a shell string) under a timeout; the `{server}`
  placeholder in any element is substituted with the entry's stamped tmux
  server name, so the operator entry reads
  `respawn: ["rk", "operator", "-L", "{server}"]`. The command owns the whole
  bring-back — spawn, readiness classification, and the kickoff
  (`rk operator -L {server}` creates the operator window and delivers the
  `/fab-operator` kickoff itself, which runs startup and re-establishes
  context). Session targets without a `respawn` command keep the default
  **[phase 3]**: resume the agent (`claude --resume <session-id>` through the
  launcher seam) and deliver into the resumed pane — the standard
  spawn-then-deliver composite ([`agent-messaging.md`](agent-messaging.md)
  § Spawn and trust walls): `await --ready` classifies the fresh pane
  (`ready`/`parked`), a `parked` wall escalates via `rk notify` (the clock
  never auto-answers walls — judgment is caller-side and the daemon has no
  judge), and delivery proceeds only on `ready`. A role target without a
  `respawn` command degrades to `notify`. A cron that brings its dead agent
  back. **A respawn never delivers the bare tick**: a fresh session has no
  tick convention in context, so the first contact is the respawn command's
  own kickoff; bare payloads resume from the second fire.

**Orphan GC**: a `session`/`pane` entry that fails resolution goes **orphaned**
— visible in the UI and `rk cron list`, never silently dropped — and expires
after a TTL (default 7d) unless `pinned`. `role` entries never orphan.

## One Operator Per Server

**Shipped substrate** (no longer an assumption): `@rk_win_role=operator` is a
server-scoped radio — every role write routes through the shared promote
helpers, which clear the role from any other window (`ClearWindowRoleExcept`)
and physically move the carrier into the per-server `_rk-operator` home
session; `rk operator`'s create path stamps atomically, and `rk mux sessions`
exposes the role taxonomy as substrate facts. This is what makes
`target: role` well-defined and is the durable identity that lets the
operator's crons survive its death: the entry outlives the pane, the role
outlives the agent, and `if_absent: respawn` closes the loop. The evaluator
resolves the role exactly as the pinned sidebar row and the console do —
never a bare `-t _rk-operator` (exact-match targets only).

## Delivery

1. Resolve target → pane (above).
2. `deliver: when-idle` gates on `@rk_pane_agent_state` (busy ⇒ hold until the
   state clears, bounded by `DefaultHoldWindow` — 2h from the fire's scheduled
   due time: past it the hold expires with a logged `held-expired` outcome
   that advances the anchor and drops the fire, never force-delivering into a
   busy pane); `immediate` sends now.
3. Send through the injection engine (the write channel of the communication
   standard — [`agent-messaging.md`](agent-messaging.md)), inheriting the
   pane-mode guard, paste probe, and submit verification.
4. Append one line to a per-server delivery log (`cron/<slug>.log`,
   size-capped) — the derivation source for `last fired / delivered` in UI and
   `every` schedules. A log is history, not live state (recovery-backup class).

**Evaluator guards** (all load-bearing):

- **Live-server filter first.** Any tmux command against a dead socket
  *resurrects* it as a fresh server — an evaluator that enumerates sockets
  every tick without filtering to live servers is a zombie-server factory.
- **Env discipline** (pulse-plan + `%14`-collision lessons): every
  tmux-touching call scrubs `TMUX`/`TMUX_PANE` and addresses the **stamped
  absolute socket path**, never "current server".
- **Circuit breakers**: a per-target delivery rate cap (default N/hour;
  tripping is visible in the UI, not silent) and a per-server entry cap —
  the dumb guards against tick storms, delivery feedback loops, and
  cron-spam from misbehaving agents.

## Watchlist — Derived from the Operator State File

The complementary visibility surface — and it requires **no push at all**.
The fab operator binary already maintains a server-keyed state file
(`$XDG_STATE_HOME/fab/operator/<slug>.yaml`, written only through
`fab operator` verbs — `tick-start`, `enroll`, `update`, …) carrying
`tick_count`, `last_tick_at`, and the full `monitored:` set: change ID, pane
ID (the join key), repo, stage, last-known agent state, branch. The slug is a
**cross-repo contract**: fab-kit owns the file and derives `<slug>` from the
server's tmux socket path — escape `-` as `--` FIRST, strip the leading `/`,
replace every remaining `/` with `-`, empty ⇒ `default` (e.g.
`/tmp/tmux-1001/runKit` → `tmp-tmux--1001-runKit`, file
`tmp-tmux--1001-runKit.yaml`). rk mirrors the rule exactly
(`tmux.SocketPath` + `cron.FabOperatorSlug`), never writes the file, and
falls back to slug `default` on a socket-path query failure — matching fab.
rk **derives** the watchlist from this file — the same posture as its
`.status.yaml` and `.fab-dispatch/` reads (Constitution II) — joining
`monitored` entries to windows by pane ID. Constitution X is satisfied by
there being nothing underivable left: the earlier tick-doc-push design is
superseded.

`last_tick_at` is the **single staleness timestamp** serving every consumer:
the UI tick-age stamp, the dimmed-and-dashed watched-row underbar, and the
CLOCK-header warning. A stale watchlist in the UI *is* the dead-loop alarm's
evidence.

Cross-tool contract note: rk parses a fab-owned schema. The read is tolerant
(unknown keys ignored, absent file = empty watchlist) and documented as an
external contract, the same class as the dispatch-record reads.

## UI — Three Tiers: Glance, Dashboard, Immersion

Crons and the watchlist are server-scoped monitoring facts. The sidebar is
run-kit's ambient monitoring surface, but it is ~260px — enough for a glance,
not for "what all is the operator doing." The design is tiered; each tier
reuses a shipped (or already-reserved) mechanism:

1. **Glance — a `CLOCK` sidebar section** (always cheap, always there): a
   fifth `CollapsiblePanel` gated by the section-visibility rail (Boards ·
   Server · **Clock** · Pane · Host — the rail is "the designated home for
   future sidebar-level controls"), default **off**, scoped to the active
   server. Condensed rows: name, target chip, live backoff rung, next fire,
   orphaned/muted treatment; mute/delete on the row's flyout card (the
   sidebar's action-row idiom). The **watchlist stays out of the sidebar** —
   watched workers are already window rows in the tree, so the ambient signal
   is the StatusDot's watched underbar on the row plus an `opr` register line
   on the row's existing flyout card (beside `@rk_win_note`). Staleness past
   the pulse threshold dims and dashes the underbar and renders a warning
   strip in the CLOCK header.
2. **Dashboard — the larger view is server-scoped, split in two** (the
   desktop-scale view). **(a) The operator console drawer's Activity
   segment on desktop** (the glimpse; change
   `260910-6ehs-console-activity-segment-status-chip`): the desktop console
   gains the `Terminal | Activity` segment the mobile sheet ships, mounting
   the same Activity feed — computed upcoming fires + recent deliveries
   across a "now" divider, the pinned staleness banner, the entry detail
   sheet as an inline in-drawer panel. Entry points: the status-bar `◷`
   clock chip (soonest next fire; yellow `◷ stale {age}` when the operator
   loop is stale) and the palette entry `Operator: Show clock activity`;
   the console's title strip also carries the operator tick-age stamp after
   the live agent-state line. **(b) The tmux Server page's WATCHED / CRONS
   / RECENT DELIVERIES zones** (the registry; change
   `260910-1rx0-server-page-clock-dashboard`): watched workers with full
   detail (state, rung, what it awaits, age, last note), cron entries with
   next/last/history, and the recent delivery log, on `/$server`. **Shipped**
   — the three zones mount below the Sessions grid inside the same scrolling
   tile area, desktop-only (the mobile answer is the Activity feed), with the
   CRONS row flyout carrying Mute/Pin/Delete and `+ New entry` opening the
   existing create dialog; the palette entry `Server: Clock dashboard`
   navigates to `/$server` and scrolls the CRONS heading into view.

   **Superseded (2026-09-10) — the agents-tile dashboard.** The earlier
   design landed tier 2 in the reserved `agents` surface kind
   ([`surface-layout.md`](surface-layout.md)): opened as
   `main-left: tty,agents` beside the operator terminal, tile-zoom to
   full-center, no compose of its own (output-only per the console's
   one-input rule — the omnibox is the global talk channel). Superseded:
   it was a tab-scoped tile for a server-scoped fact, and `agents` is no
   longer a reserved surface kind — `SURFACE_KINDS` is now
   `tty · web · code · gui` (the `gui` surface took the fourth kind). The
   study's § 1b mock stays as the record of the rejected direction.
3. **Immersion — an operator board** (zero new machinery, optional): boards
   already render pinned windows as live terminal cards. The operator (an
   actuating agent) can pin its watched windows to a `watched` board as the
   set changes — link-based pinning keeps every window in its home session —
   giving a full-screen live view of everything under watch at
   `/board/watched`. This is a *usage pattern* of shipped boards, not a
   feature; at most P3 adds a cron payload that reconciles the board to the
   watchlist.
4. **Mobile — a feed, not a registry.** The desktop tiers collapse badly on
   a phone (a 50px drawer panel + flyout-buried actions), so mobile inverts
   the shape (the Calendar-agenda / PagerDuty pattern: mobile ops surfaces
   are time-ordered triage feeds, not management registries):
   - The **mobile console sheet** — already the operator surface on phones —
     gains a two-segment header, **Terminal | Activity**. Activity is one
     time-ordered timeline merging *recent deliveries* (from the log) and
     *computed upcoming fires* (the evaluator's next-fire function) across a
     "now" divider. Pure derivation — the deterministic-render contract
     holds; it inherits the console's server resolution and
     degrade-to-absent gating.
   - **Staleness is the feed's pinned banner** (the healthchecks.io
     dead-man's-switch model): a stale operator loop is the most important
     item on the timeline, not a side warning.
   - **Tap a feed item → an entry detail sheet** with the alarm-app anatomy:
     name, schedule in plain words, last/next, a first-class **mute toggle
     switch**, delete and pin rows. No flyout cards on mobile.
   - **Push is the mobile entry point**: escalations, orphans, and staleness
     ride `rk notify`; the notification deep-links to the Activity segment.
   - The sidebar CLOCK section is **desktop-only** (its rail toggle hidden on
     mobile); the tree's watched-row underbars remain on both.
   - **Desktop has parity**: the desktop console drawer ships the same
     `Terminal | Activity` segments (tier 2a) — one feed, banner, and
     detail-sheet codebase across both form factors.

Rejected: a dedicated `clock` **surface kind** (a dedicated kind would split
the surface model — the surface set is `tty · web · code · gui`, and crons
ride the console and Server page instead); **Host page** (checking crons
must not cost a navigation); **status bar
only** (no management affordance — the `◷` readout that rides it is an entry
point to the console Activity segment, not the surface); **mobile
registry-in-the-drawer** (the pre-feed mobile design: a pinned-height
`CollapsiblePanel` in the drawer with flyout-card actions — no glanceability,
mute two taps deep; superseded by the Activity feed).

Palette-registered per Constitution V (`Panel: Toggle Clock`,
`Operator: Show clock activity`, `Server: Clock dashboard`, `Cron: new entry`,
`Cron: mute…`, `Cron: delete…`).
Mutations wake the SSE hub explicitly (user-option and file writes emit no
tmux event — the safety-poll lesson).

## API & CLI

| Surface | Form |
|---------|------|
| Read | `GET /api/cron?server=<slug>` — entries + derived next-fire + orphan state; watchlist rides the existing SSE state doc |
| Mutate | `POST /api/cron/create`, `POST /api/cron/delete`, `POST /api/cron/mute` — POST-only (Constitution IX) |
| CLI | `rk cron add <prompt> --every 1h \| --backoff \| --cron "<expr>" [--name N] [--deliver when-idle] [--if-absent skip] [--respawn <arg>…]`, `rk cron list [--json]`, `rk cron rm <id>`, `rk cron mute <id> [--for <dur>] [--off]` — agent-friendly: no flags beyond the schedule are required |

`rk cron mute <id> --for <dur>` mutes until now+dur; expiry unmutes
automatically with no further call — the evaluator reads an expired lease as
unmuted. Plain `mute` is indefinite; `--off` clears both. On `add`,
`--respawn` is repeatable — one argv element per occurrence, passed exactly
as typed; the `{server}` placeholder is substituted with the entry's stamped
server name when the command runs (§ Targets & Fire-Time Resolution).
Entries can be created over the localhost HTTP API, so the API can now make
the daemon exec a command — but it could already type arbitrary text into an
agent's chat (command execution by proxy), so the trust boundary does not
move.

## Constitution Alignment

| Principle | How it holds |
|-----------|--------------|
| II (no database) | Entry files are intent read at request time (`.status.yaml` class); runtime facts derived or in-memory, re-derived on restart; the delivery log is recovery-backup class (history, never a live-state source) |
| VI (tmux independent) | The clock lives in the daemon; tmux sessions and agents are untouched by daemon restarts — at worst one duplicate idempotent fire |
| IX (POST-only) | All mutations are POST |
| X (hooks carry only the underivable) | Nothing is pushed — the watchlist derives from the fab-owned operator state file, staleness from its `last_tick_at`; no new hook exists |
| IV (minimal surface) | No new page or tile — a sidebar section behind the existing section rail; the watchlist reuses the tree rows instead of duplicating them |

## Phasing

> Execution shape — change breakdown, waves, the P1.5 gate, and the fab-kit
> item — lives in
> [`fab/plans/sahil/26-09-06-cron-clock-plan.md`](../../fab/plans/sahil/26-09-06-cron-clock-plan.md).

- **P1 — substrate + operator tick**: the evaluator verb + daemon-ticker
  invoker + flock, entry file, `role` target, `backoff` (with the anchor-join)
  + `every` schedules, `wake_on`, injection-engine
  delivery, evaluator guards (live-server filter, rate caps), `rk cron` CLI,
  API.
- **P1.5 — backstop live** (before any UI): `rk operator` seeds the
  operator-tick entry (`if_absent: respawn` with
  `respawn: ["rk", "operator", "-L", "{server}"]`). Silence while the
  operator's in-session `/loop` lives is **lease arbitration**: the loop
  renews a mute lease (`rk cron mute <id> --for <dur>`) each tick, and when
  the loop dies the lease lapses and the cron backstop resumes on its own.
  The fab-kit side that issues the renewals is a follow-up — until it ships,
  the idle operator is ticked every backoff step (loud but safe; mute by hand
  if needed). Gate before proceeding: kill the loop → a tick arrives within
  one backoff step; with the lease renewing, no double ticks while the loop
  is healthy; `rk cron add/list/rm` works from inside a pane. Kills the
  incident class.
- **P2 — visibility**: the `CLOCK` sidebar section + rail toggle (desktop),
  the console's desktop **Activity** segment and the Server page's
  WATCHED / CRONS / RECENT DELIVERIES zones (shipped), the mobile console sheet's
  **Activity** feed segment + staleness banner + entry detail sheet,
  watched-row underbar + the `opr` register line (watchlist and
  `last_tick_at` read from the fab operator state file), SSE wiring,
  palette actions, notify deep-links.
- **P3 — generalization + replacement posture**: `session` targets with
  auto-capture, orphan GC, the closed-session resume default for
  `if_absent: respawn`, `cron` expressions; then the fab-kit skill change —
  the operator's in-session loop renews the mute lease each tick while it
  runs, and once the loop retires the entry's union predicate (`backoff` +
  `wake_on`) replaces §4 Adaptive cadence as the only clock — the lease
  simply stops being renewed — eliminating the loop-death incident class
  entirely.

## Open Questions

1. Server ≈ one operator's domain assumes per-project servers; a multi-repo
   server would need an optional session/cwd scope on entries. Not built until
   the layout is real.
2. `when-idle` hold window bound — **decided at Wave 4 (C9,
   `260908-qyin-cron-schedule-completions`): drop after a 2h hold window
   (`DefaultHoldWindow`) with a logged `held-expired` outcome.** The bound
   derives from the fire's scheduled due time (`Fire.DueAt`), keeping
   evaluation stateless; the expiry is a logged disposition, so it advances
   the anchor and the next due period fires normally. Drop-with-visible-history
   won over the alternatives because (a) recurring schedules lose nothing —
   the next due period fires on its own; (b) unbounded hold delivers a payload
   that stopped being relevant hours ago, landing mid-context-switch at the
   worst moment; (c) force-delivering at the bound would interrupt a
   busy/waiting agent, contradicting what `when-idle` exists for. Catch-up
   late fires (`DueAt = now`) are exempt by construction — an entry that opted
   into unbounded lateness is not then dropped for being late.
3. Mutual watching's second half — **decided at P1.5 (C4,
   `260906-kbbh-operator-tick-seed-respawn`): no reverse loop-side
   cron-staleness check is built.** The loop does not warn when the cron's
   delivery-log stamp goes stale. (a) The only place such a check could live
   is inside the `/loop` itself — `fab-operator.md` — which this wave's
   zero-skill-change constraint forbids touching. (b) The risk is asymmetric:
   a dead cron backstop while the loop is healthy is a benign no-op — the
   loop is already doing the monitoring job the cron exists to back up; the
   incident class is the reverse direction (backstop alive, loop dead).
   (c) C5 builds the generic staleness mechanism for the primary direction
   (cron watching the loop, via `last_tick_at`); the reverse direction, if
   ever built, would consume the cron's own delivery-log staleness through
   the same UI surface rather than a bespoke loop-side check. (d) C10
   collapses the two clocks into one — once `/loop` retires in favor of the
   entry's union predicate, no second clock remains to watch, so a reverse
   watch built now would be dead code. The pulse plan's sidecar state (ladder
   rung, notify cursor) is otherwise obsolete — the anchor-join makes the
   ladder stateless and the rate cap covers notify throttling.
