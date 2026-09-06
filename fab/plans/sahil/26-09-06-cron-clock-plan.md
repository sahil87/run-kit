# Cron clock execution plan — rk-owned scheduling substrate

> Plan doc — written 2026-09-06 from the braided-canyon `/fab-discuss` thread.
> Authority for design: `docs/specs/cron.md` (the spec) +
> `docs/wiki/cron-clock-design-studies.html` (visual design). This doc owns
> only the execution shape: the change breakdown, waves, gates, and the
> cross-repo fab-kit item. Supersedes the **Clock B ownership** half of
> fab-kit's `fab/plans/sahil/26-09-03-operator-pulse-plan.md` (apt-marten);
> that plan's OS-timer fallback and reboot analysis carry forward here.

**Goal**: durable, agent-programmable scheduling (cron / interval /
idle-anchored backoff / edge triggers) with fire-time target resolution, so
the operator's cadence no longer dies with its session — then visibility,
then generalization to any agent.

---

## Change breakdown

Each row is one fab change (run-kit repo unless marked). Sizes are gut-feel
pipeline sizes, not estimates.

### Wave 1 — P1 substrate

| # | Change | Scope | Size |
|---|--------|-------|------|
| C1 | `internal/cron` core + evaluator | Entry-file schema + tolerant load (`$XDG_STATE_HOME/run-kit/cron/<slug>.yaml`); the stateless evaluator (`every` + `backoff` with the **anchor-join rule**; `wake_on` approximated by the poll — state-delta since last eval, debounced; `suppress_while` guards reading the fab operator state file); delivery log (append, size-cap); live-server filter; TMUX scrub; flock. Pure functions unit-tested hard (anchor-join, ladder math, suppression truth table) | M |
| C2 | `rk cron` CLI | `add` (schedule flags, creator auto-capture from `$TMUX_PANE` → role/pane target; session capture lands in C9), `list [--json]`, `rm`, `mute`, `pin`, and the invoker verb `rk cron tick` (flock-guarded, idempotent) | S |
| C3 | Daemon ticker + delivery | Ticker goroutine invoker (isolated, settings key default ON, doctor row); injection-engine delivery with `deliver: immediate\|when-idle` gating; `if_absent: skip\|notify`; circuit breakers (per-target rate cap — trips visibly, per-server entry cap) | M |

C1 → C2 and C1 → C3; C2 ∥ C3.

### Wave 2 — P1.5 backstop (before any UI)

| # | Change | Scope | Size |
|---|--------|-------|------|
| C4 | Operator-tick seeding + role respawn | `rk operator` idempotently seeds the operator-tick entry (backoff 60s→30m, `wake_on` agent-state-change, `suppress_while: [operator-loop-fresh, nothing-tracked]`, pinned); `if_absent: respawn` for role targets — spawn-then-deliver composite, **kickoff prompt (`/fab-operator`) on first delivery**, bare ticks after. Also resolves spec open question 3: no reverse loop-side cron-staleness check this wave ([docs/specs/cron.md](../../docs/specs/cron.md) § Open Questions; change `260906-kbbh-operator-tick-seed-respawn`) | S |

**GATE (manual, blocks Wave 3+):** on a live server with a monitored change —
(a) kill the operator's `/loop`: a tick arrives within one backoff step;
(b) healthy loop for 30+ min: zero cron deliveries (suppression holds — no
double ticks); (c) `rk cron add/list/rm` from inside an agent pane works
without flags beyond the schedule; (d) an orphaned socket in the state dir
spawns no server on the next tick. Zero fab-operator skill changes in this
wave — the backstop must be invisible to a healthy operator.

Decide open question 3 here (mutual watching: does the loop warn when the
cron's delivery-log stamp goes stale?).

### Wave 3 — P2 visibility

| # | Change | Scope | Size |
|---|--------|-------|------|
| C5 | API + derivations | `GET /api/cron` (entries + derived next-fire/rung/orphaned), `POST /api/cron/create·delete·mute` (+ explicit SSE hub wake); the fab-operator-state reader (tolerant parse; `monitored` + `last_tick_at` joined to windows by pane ID) feeding watchlist + staleness onto the sessions payload | M |
| C6 | Desktop UI | `CLOCK` sidebar section (`CollapsiblePanel`, 5th section-rail toggle, desktop-only), watched-row ◉ indicator + flyout-card detail line, staleness dimming + header warning, palette actions | M |
| C7 | Mobile UI | Console sheet **Terminal \| Activity** segments; the Activity feed (upcoming computed + delivered log, now-divider, pinned staleness banner); entry detail sheet (plain-words schedule, mute toggle, pin, delete); `rk notify` deep-links | M |

C5 → C6 ∥ C7. The **agents-tile operator dashboard** is deliberately NOT a
row here: it requires landing the reserved `agents` surface kind — a shared
prerequisite with the console's dock-later story (qa85 intake) — and gets its
own plan when scheduled. The spec's tier-2 mock is its design authority.

### Wave 4 — P3 generalization

| # | Change | Scope | Size |
|---|--------|-------|------|
| C8 | Session targets + GC | `session` target kind (`@rk_pane_agent_session` capture + fire-time resolve), orphan marking + TTL expiry (7d, `pinned` exempt), `if_absent: respawn` via closed-session resume + readiness composite | M |
| C9 | Schedule completions | 5-field `cron` expressions, `catch_up: once`, `when-idle` hold-window bound (open question 2 decided here) | S |
| C10 | **(fab-kit repo)** Replacement posture | `fab-operator.md` §4 rewrite: retire `/loop` + Adaptive cadence in favor of the cron entry's union predicate; ready-line copy; pulse-plan supersession cleanup. Only after C4's gate has held in daily use | M |

C8 ∥ C9; C10 last, gated on lived experience, not tests.

---

## Risks / standing rules (from the spec — repeated because they gate merges)

- **Anchor-join is correctness, not polish** — without it the ladder pins at
  rung 1 (each delivery resets the raw idle epoch). C1 review must reject a
  raw-epoch implementation.
- **Live-server filter before any socket touch** — a dead socket resurrects
  on any tmux command; the evaluator must never be a zombie factory.
- **Payload discipline**: ticks are idempotent by contract; a duplicate fire
  after restart is acceptable, a missed suppression is not.
- **UI is a pure projection** of (entry YAML + delivery log + derived state)
  — no runtime fact may live only in daemon memory.

## Sequencing summary

C1 → (C2 ∥ C3) → C4 → **GATE** → C5 → (C6 ∥ C7) → (C8 ∥ C9) → C10.
Operator benefit begins at the gate (Wave 2), before any UI exists. Agent
adoption (announcing `rk cron` to agents beyond the operator) waits for C8's
orphan GC — agent-created entries without GC are the immortal-cron hazard.
