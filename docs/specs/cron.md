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
> tiered (§ UI): a sidebar `CLOCK` section for the glance, the reserved
> [`surface-layout.md`](surface-layout.md) `agents` tile as the operator
> dashboard, boards for immersion — the right panel is retired, so no
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
   derived state (idle epochs, pane liveness, the fab operator state file),
   and the delivery log; compute what is due; deliver; append to the log;
   exit. It holds **no in-memory schedule state**, so every invoker is
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
    schedule: { kind: backoff, anchor: operator-idle, min: 60s, max: 30m }
    wake_on: { event: agent-state-change, scope: server, debounce: 10s }
    suppress_while: [operator-loop-fresh, nothing-tracked]
    target: { kind: role, role: operator }
    payload: "operator tick"
    deliver: immediate           # immediate | when-idle
    if_absent: respawn           # skip | notify | respawn
    pinned: true                 # never orphan-expired
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

**Union predicates and guards** (both optional per entry, both derivable):

- `wake_on` — an edge trigger OR'd with the schedule: fire when the named
  transition occurs (v1: `agent-state-change`, server-scoped), debounced so a
  burst coalesces into one delivery.
- `suppress_while` — named guards evaluated at fire time; while any holds,
  the fire is skipped silently (not a missed fire). The operator-tick entry
  ships with two: `operator-loop-fresh` (skip while `last_tick_at` in the fab
  operator state file is fresh — the staleness arbitration that keeps the
  cron silent while the in-session `/loop` is alive, so the two clocks never
  double-tick) and `nothing-tracked` (skip while `monitored`, `watches`, and
  `autopilot` are all empty — the same condition under which the skill stops
  its own loop).

**Catch-up policy**: a wall-clock `cron` fire missed while no invoker ran
defaults to **skip** (never fire late); `catch_up: once` is the per-entry
opt-in for at-most-one late fire.

## Targets & Fire-Time Resolution

| Kind | Names | Resolution at fire | Lifetime |
|------|-------|--------------------|----------|
| `role` | A server role (only `operator` initially) | The window carrying `@rk_win_role=operator` (shipped radio semantics; equivalently the `_rk-operator` member) → its agent pane | Never orphans — the role outlives any pane |
| `session` | An agent chat session (`@rk_pane_agent_session` id) | The live pane carrying that session id | Orphans when no pane resolves |
| `pane` | A raw pane id | That pane, if alive | Dies with the pane (discouraged; exists for scripts) |

**Creator auto-capture**: `rk cron add` run inside a pane derives the caller's
identity from `$TMUX_PANE` + socket → its `@rk_pane_agent_session` session and role, and
defaults `target` to the session (role if one is held). "The agent that uses it
becomes the target" costs no arguments.

**`if_absent` ladder** when resolution fails at fire time:

- `skip` — record a missed fire; entry trends toward orphaned.
- `notify` — `rk notify` (fail-silent contract) with entry name and server.
- `respawn` — role targets: relaunch via `rk operator` (one-per-server holds,
  below); session targets **[phase 3]**: resume the agent
  (`claude --resume <session-id>` through the launcher seam) and deliver into
  the resumed pane. A cron that brings its dead agent back. Either respawn
  runs the standard spawn-then-deliver composite
  ([`agent-messaging.md`](agent-messaging.md) § Spawn and trust walls):
  `await --ready` classifies the fresh pane (`ready`/`parked`), a `parked`
  wall escalates via `rk notify` (the clock never auto-answers walls —
  judgment is caller-side and the daemon has no judge), and delivery proceeds
  only on `ready`. **A respawn never delivers the bare tick**: a fresh
  session has no tick convention in context, so the first delivery is the
  launcher's kickoff (`/fab-operator` for the operator role — which runs
  startup and re-establishes context); bare payloads resume from the second
  fire.

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
   state clears, with a bounded hold window); `immediate` sends now.
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
(`$XDG_STATE_HOME/fab/operator/<server-slug>.yaml`, written only through
`fab operator` verbs — `tick-start`, `enroll`, `update`, …) carrying
`tick_count`, `last_tick_at`, and the full `monitored:` set: change ID, pane
ID (the join key), repo, stage, last-known agent state, branch. rk **derives**
the watchlist from this file — the same posture as its `.status.yaml` and
`.fab-dispatch/` reads (Constitution II) — joining `monitored` entries to
windows by pane ID. Constitution X is satisfied by there being nothing
underivable left: the earlier tick-doc-push design is superseded.

`last_tick_at` is the **single staleness timestamp** serving every consumer:
the UI tick-age stamp, the dimmed watched-row indicators, the CLOCK-header
warning, and the backstop's `operator-loop-fresh` suppress guard. A stale
watchlist in the UI *is* the dead-loop alarm's evidence.

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
   is a row-level "watched" indicator plus a detail line on the row's
   existing flyout card (beside `@rk_win_note`). Staleness past the pulse
   threshold dims the indicators and renders a warning strip in the CLOCK
   header.
2. **Dashboard — land the reserved `agents` surface as the operator panel**
   (the desktop-scale view). The layout encoding already reserves the
   `agents` kind (`tty`/`code`/`web`/`agents` —
   [`surface-layout.md`](surface-layout.md)); it was specced as "the tier-2
   workers the pane spawned" and never built. For the operator window its
   companions *are* the watched fleet, so the agents tile IS the operator
   dashboard: **watched workers** with full detail (state, rung, what it
   awaits, age, last note), **cron entries** with next/last/history,
   **pending escalations** (open questions awaiting the user), and a **recent
   delivery log**. Opened as `main-left: tty,agents` (operator terminal
   big-left, dashboard beside it) via the shipped top-bar surface toggles;
   the shipped **tile zoom** verb makes it momentarily full-center — the
   "larger view" is one action away, no new route and no new surface kind.
   The **operator chat console shipped** (#839 + #840's quake v2) with a
   design that reshapes the dock story: on desktop the console's input is the
   **top-bar omnibox** (⌘J three-state machine) and the drawer is
   **output-only** — the one-input rule. The agents tile therefore carries
   **no compose of its own**: the omnibox is already the global talk channel
   on every route, so the tile is a pure dashboard (and can embed the
   operator terminal via the same `TerminalClient`/RelayMux path the console
   drawer and board panes proved). What the tile adds over the drawer is the
   *dashboard* half — watched/crons/escalations/log — and the console
   intake's "escalation badges — future synergy" note is exactly this spec's
   escalations section; the console title strip's live agent-state line is
   the natural later home for the tick-age stamp.
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
     mobile); the tree's watched-row ◉ indicators remain on both.

Rejected: a dedicated `clock` **surface kind** (the reserved `agents` kind
already owns "agent fleet beside the work" — a second kind would split it);
**Host page** (checking crons must not cost a navigation); **status bar
only** (no management affordance — a next-tick readout may ride it later);
**mobile registry-in-the-drawer** (the pre-feed mobile design: a pinned-height
`CollapsiblePanel` in the drawer with flyout-card actions — no glanceability,
mute two taps deep; superseded by the Activity feed).

Palette-registered per Constitution V (`Panel: Toggle Clock`,
`Surface: Agents`, `Cron: new entry`, `Cron: mute…`, `Cron: delete…`).
Mutations wake the SSE hub explicitly (user-option and file writes emit no
tmux event — the safety-poll lesson).

## API & CLI

| Surface | Form |
|---------|------|
| Read | `GET /api/cron?server=<slug>` — entries + derived next-fire + orphan state; watchlist rides the existing SSE state doc |
| Mutate | `POST /api/cron/create`, `POST /api/cron/delete`, `POST /api/cron/mute` — POST-only (Constitution IX) |
| CLI | `rk cron add <payload> --every 1h \| --backoff \| --cron "<expr>" [--name N] [--deliver when-idle] [--if-absent skip]`, `rk cron list [--json]`, `rk cron rm <id>`, `rk cron mute <id>` — agent-friendly: no flags beyond the schedule are required |

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
  + `every` schedules, `wake_on` + `suppress_while`, injection-engine
  delivery, evaluator guards (live-server filter, rate caps), `rk cron` CLI,
  API.
- **P1.5 — backstop live** (before any UI): `rk operator` seeds the
  operator-tick entry; **zero fab-operator skill changes** — the
  `operator-loop-fresh` guard keeps the cron silent while the in-session
  `/loop` lives. Gate before proceeding: kill the loop → a tick arrives
  within one backoff step; no double ticks while the loop is healthy;
  `rk cron add/list/rm` works from inside a pane. Kills the incident class.
- **P2 — visibility**: the `CLOCK` sidebar section + rail toggle (desktop),
  the agents-tile dashboard, the mobile console sheet's **Activity** feed
  segment + staleness banner + entry detail sheet, watched-row indicator +
  flyout-card detail (watchlist and `last_tick_at` read from the fab
  operator state file), SSE wiring, palette actions, notify deep-links.
- **P3 — generalization + replacement posture**: `session` targets with
  auto-capture, orphan GC, `if_absent: respawn` via closed-session resume,
  `cron` expressions; then the fab-kit skill change — the operator stops
  running `/loop`, and the entry's union predicate (`backoff` + `wake_on`)
  replaces §4 Adaptive cadence, eliminating the dual-clock arrangement and
  the loop-death incident class entirely.

## Open Questions

1. Server ≈ one operator's domain assumes per-project servers; a multi-repo
   server would need an optional session/cwd scope on entries. Not built until
   the layout is real.
2. `when-idle` hold window bound (drop vs. deliver-late after N hours).
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
