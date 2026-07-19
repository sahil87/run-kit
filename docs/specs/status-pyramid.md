# Status Pyramid — What Wins When

> The precedence model for every status signal run-kit renders: which signal owns
> which visual channel, on which surface, under what preconditions. This spec is
> the design intent for the UI-surfacing change that follows the Generic
> Agent-State Tier (PR #314); sections marked **[target]** differ from shipped
> code, sections marked **[current]** describe behavior that already exists.
>
> Companions: [`agent-state.md`](agent-state.md) defines the `@rk_agent_state`
> convention this spec consumes (states, staleness, reconciler, rollup);
> the dot's shape/hue rendering vocabulary lives in `status-dot.tsx` /
> `pr-status-line.tsx` (`statusDotState`, `PHASE_HUE`, `fabShape`, `prShape`).

---

## The Signal Inventory

Four signal layers, each with a precondition that determines whether it exists
for a given window. Layers are facts about the world; *tiers* (below) are the
display-precedence ladder built on them.

| Layer | Signal | Exists when | Source |
|-------|--------|-------------|--------|
| L0 — tmux output | `activity` (active/idle), `activityTimestamp` | always, every window | `#{window_activity}` within 10s (`ActivityThresholdSeconds`) |
| L1 — agent lifecycle | `agentState` (active / waiting / idle) + epoch | an instrumented agent runs in a pane of the window | `@rk_agent_state` pane option, window rollup `waiting > active > idle`; absent = unknown; PID-liveness reconciler clears dead-agent values, shell-name fallback for legacy two-segment values (see agent-state.md) |
| L2 — fab pipeline | `fabChange`, `fabStage`, `fabDisplayState` | the pane's worktree has an active change | cwd → `.fab-status.yaml` → `.status.yaml`, via the pane-map join |
| L3 — PR | `prNumber`/`prUrl` + `prState`/`prChecks`/`prReview`/`prIsDraft` | the pane's branch resolves to a PR — never for the repo's default branch (#389, see invariant 6) | branch → `gh` lookup in the prstatus collector (post-#314; previously fab's `.status.yaml` `prs:` list) |

Two orthogonal *axes* run across these layers:

- **Journey** (where is this work): L2 stage → L3 PR. Encoded in **hue + shape**.
- **Attention** (does this need a human *now*): L1 `waiting` (and, future, "stuck").
  Encoded in **animation** — never in hue or shape.

### Why L0 exists (and what it no longer does)

L0 is the **floor**: the only layer whose precondition is "always", and therefore
the only signal for the non-agent majority of a terminal console — builds,
REPLs, ssh sessions, `htop`, dev servers, log tails. Dropping it would make the
pyramid describe only agent/fab/PR panes: an agent-dashboard model, contradicting
run-kit's terminal-underneath positioning (an agent is just one thing you run in
a pane).

L0 speaks about **bytes, not intent** — it answers "is output happening", never
"does this need me" — so it is never an attention signal. Its historically
misleading cases were all *agent* panes (a spinner repainting below a permission
prompt reads "active"; a silently thinking agent reads "idle"); the agent tier
now owns every such window, and L0 never speaks for a pane with a fresh
`@rk_agent_state`. What remains is its honest domain, exactly three jobs:

1. Bottom-tier solid/ring for windows with no PR, no change, no agent.
2. The elapsed ticker for those windows (`idle 23m` on a forgotten shell pane).
3. The duration-mute rule (output flowing → hide elapsed), pierced only by `waiting`.

A future refinement MAY consult `#{pane_current_command} ≠ shell` (already
collected as `PaneCommand`) as a complementary process-running signal for the
floor tier — a silent long build reads busy correctly by process, wrongly by
output. Not v1.

---

## The Channel Model

| Channel | Carries | Vocabulary |
|---------|---------|------------|
| Core hue **[current — palette v3]** | which journey + position in it | **cool = fab pipeline**: blue (intake) → green (apply→review-pr, collapsed) → purple (PR) · **warm = ad-hoc agent**: yellow (working) → orange (PR) · gray = floor (no agent, no journey) |
| Shape | health/status of the owning tier | solid (live/healthy) · ring (pending/idle) · failed (dotted ring + red center) · done (sharp square) · skipped (gray hollow ring) |
| Animation **[current]** | attention — **additive, never destructive** | constant-**yellow** pulsing halo = `waiting`, over any tier; core hue AND shape are kept. (future) slow-pulse halo = stuck. No halo = no attention needed |
| Duration text | how long in the current resting state | `waiting Xm` (attention token) · `idle Xm` · tmux elapsed |
| Tip (StatusDotTip) | full detail | phase + status label, agent line, PR link, docs link |
| Rollup badges **[current]** | attention counts up the hierarchy | session row → server tile → board header |

**Palette v3 — two families + floor.** The palette encodes *which journey* by
temperature: **cool = fab pipeline** (blue intake → green working → purple PR —
blue and purple keep their long-learned meanings; amber retires), **warm =
ad-hoc agent** (yellow working → orange PR), **gray = floor**. The glance rule:
warm core = my ad-hoc agents, cool core = my pipeline, gray = just a terminal,
**yellow glow = needs me now**. The only adjacent hue pair (yellow/orange) sits
*within* the warm family, where both read "ad-hoc agent" and the phase detail
lives in the panel — cross-family pairs are all strongly separated. Deliberate
consequence: the docs-site's alignment with fab-kit's 4-phase README grouping is
broken by the green collapse — document it, don't hide it. (Supporting fact:
the old ship/review-pr green barely ever rendered — `/git-pr` creates the PR
mid-ship, and purple takes the dot the moment `prNumber` exists.)

**Attention is additive: a constant-yellow pulsing halo around the dot, with the
core hue and shape untouched.** Blue core + yellow halo = "pipeline at intake,
needs me" (intake is the *asking* stage — fab-waiting-at-intake is a common
case, not a corner). Yellow is the agent color in both roles: yellow core = "an
ad-hoc agent lives here", yellow halo = "an agent needs you" — the glow never
claims the window is ad-hoc, because family identity lives strictly in the
core. Under `prefers-reduced-motion` the halo renders as a static yellow outer
ring — attention is never encoded in motion alone. Rejected alternatives, for
the record: **hue-flip on waiting** (destroys family identity exactly when
attention is highest); **self-colored halo** (pulse in the core's own hue —
fine animated, but its reduced-motion form nearly vanishes and reads like the
hollow `ring` shape; also leaves colorblind + reduced-motion users with no
cue); **fuchsia attention hue** (superseded — the amber collision that forced
it no longer exists once fab collapses to blue/green).

---

## The Tier Ladder (dot ownership)

The dot's core hue + shape are owned by **two ladders joined at the top** —
first precondition wins **[current — palette v3]**:

```
fabChange ?  (prNumber ? purple-PR : stage == intake ? blue : green)
          :  (fresh agentState ? (prNumber ? orange-PR : yellow, shape by state) : gray floor)
waiting   →  additive yellow halo, over anything (core hue + shape kept)
```

- **[D1 — resolved]** PR dot-ownership exists in *both* families but is colored
  by family: **purple = fab change at PR phase** (unambiguous again),
  **orange = ad-hoc agent's branch has a PR**. A pane with *neither* a fab
  change *nor* a fresh agent stays on the gray floor even when its branch has a
  PR — derivation stays universal (the L3 register, PR-status line, and tip
  show the PR for any pane; Principle X), but a plain shell never renders a
  mystifying PR dot.
- **[current]** the agent tier is new and **warm**: a fresh `agentState` gives a
  yellow core (solid mid-turn even while quiet; ring when idle — an agent
  parked here), replacing the 10-second output heuristic for those windows.
  Freshness rules are #314's (absent option / shell reconciler → fall through
  to the floor).
- The **attention overlay is ladder-exempt and additive**: `waiting` wraps any
  tier's dot in the constant-yellow pulsing halo — a fab intake agent asking a
  question keeps its blue core; a review-failed window keeps its green failed
  shape; only the halo is added.

### What-wins-when facts (the crisp version)

1. **"PR state shows only from ship onward" is emergent, not a stage check.**
   For a pipeline-run change, the PR is created by `/git-pr` at ship — so the
   purple PR tier *in practice* begins at ship and the amber/blue fab tiers own
   the dot before it. But the rule is *PR presence*, not `stage == ship`: an
   adopted change (PR pre-exists) or a reused branch with an open PR shows the
   PR tier earlier. There is deliberately no `stage` conditional in the ladder.
2. **A live fab stage never outranks its own PR.** Once a PR exists, stage
   progress (hydrate done, review-pr active…) surfaces in the tip and the
   PR-status line, not the dot. The dot answers "how is the PR" from ship on.
3. **Agent state owns the warm family, but never surfaces in the dot on
   fab windows** — a fab window's shape carries pipeline/PR health, which is
   rarer and more actionable than routine agent state. Agent state on fab
   windows lives in: the tip's agent line, the PANE panel's agent register, and
   (when waiting) the additive halo.
4. **`waiting` is never a tier and never destructive** — it cannot displace
   core hue or shape anywhere. It is an additive overlay: constant-yellow halo
   pulse + tip/panel `waiting Xm` + rollup counts + push.
5. **tmux output recency surfaces in exactly two places**: the bottom tier's
   solid/ring (no change, no PR, no agent), and the duration-mute rule (below).
   It is never an attention signal — output ≠ needs-me.
6. **Merged-PR durability is derived, not remembered** **[current — D2 revised]**.
   The first implementation resolved D2 with an `--state open` lookup plus a
   10-minute **in-memory grace window** (`branchPRMergedGrace`) — which proved
   wrong in production: the grace expires (and any rk restart wipes it), so a
   merged PR's purple done-square silently decayed into a green fab done-square
   minutes after merge. The revised rule: the branch→PR derivation queries
   **all states** and picks by precedence **open (most recently updated) >
   merged (most recent)**; closed-unmerged is derived (register/tip) but never
   owns the dot (fab fallback / floor — unchanged). A merged PR then renders
   its purple/orange done-square **statelessly and restart-proof** for as long
   as the pane sits on that branch — no grace clock, no negative-stamp
   machinery (`wentNegativeAt` retires). Branch-reuse edge: an open PR always
   outranks an older merged one on the same branch.
   **Default-branch carve-out (#389)**: a pane on the repo's *default* branch
   never derives a branch-PR at all. `gh pr list --head` matches by head-ref
   *name* only, so every default-branch match is degenerate (a fork PR whose
   head is named `main`, or a historical same-repo PR whose head was the
   default branch) — and the durability rule above would pin that wrong PR
   forever. The refresher detects the default branch locally
   (`git symbolic-ref refs/remotes/origin/HEAD`, per-repo cached, fail-open
   on lookup failure) and resolves excluded pairs to an authoritative
   negative, clearing any stale positive within one pass.
7. **Unknown beats wrong**: absent `@rk_agent_state`, or a value on a pane whose
   command is a plain shell (reconciler), means *no agent tier* — the ladder
   falls through to tmux. Nothing renders a guessed agent state.

---

## Decision Table

`—` = signal absent. Palette v3; the halo column is the additive waiting
overlay (core hue/shape unchanged by it).

| # | journey | signals | Dot (core hue · shape [· halo]) | Tip/panel duration |
|---|---------|---------|--------------------------------|--------------------|
| 1 | floor | no agent · output flowing | gray · solid | *(none — muted)* |
| 2 | floor | no agent · quiet | gray · ring | tmux elapsed |
| 3 | ad-hoc | agent active | yellow · solid | *(none)* |
| 4 | ad-hoc | agent idle | yellow · ring | `idle Xm` (from epoch) |
| 5 | ad-hoc | agent **waiting** | yellow · solid · **halo** | `waiting Xm` — push after sustain |
| 6 | ad-hoc | PR open · healthy | orange · solid | per agent state |
| 7 | ad-hoc | PR checks fail | orange · failed | |
| 8 | ad-hoc | PR merged | orange · done (square) | durable via state-all derivation (D2 revised) |
| 9 | ad-hoc | PR open + **waiting** | orange · solid · **halo** | `waiting Xm` |
| 10 | floor | PR on branch · no agent · no change | gray (floor) | PR in L3 register/tip only |
| 11 | fab | intake · active/ready | blue · solid | |
| 12 | fab | intake · pending | blue · ring | |
| 13 | fab | intake + **waiting** | blue · solid · **halo** | the asking stage — common case |
| 14 | fab | apply→review-pr · active | green · solid | idle→`idle Xm`, else none |
| 15 | fab | review · failed | green · failed | |
| 16 | fab | review · failed + **waiting** | green · failed · **halo** | shape and hue survive the overlay |
| 17 | fab | PR open · healthy | purple · solid | |
| 18 | fab | PR checks fail / changes requested | purple · failed | |
| 19 | fab | PR merged | purple · done (square) | durable via state-all derivation (D2 revised) |
| 20 | fab | PR closed-unmerged · change live | green working tier (closed never owns the dot) **[current]** | |

---

## Row Minimalism **[decided]**

The WindowRow's trailing status cluster — the stage word (`intake`, red when
failed) and the duration text — is **removed**. The **StatusDot is the row's
only externally visible status signal**; the name gets the freed width back
(less truncation, especially on mobile).

Where each removed signal goes:

| Removed from the row | Survives as |
|----------------------|-------------|
| stage word (`review`) | dot hue (coarse: amber trio) at a glance; exact stage in the StatusDotTip and the PANE panel |
| failed-red stage text | already redundant — the dot's `failed` shape (dotted ring + red center) |
| `done`-parking suppression | the dot's `done` square |
| idle/elapsed duration | StatusDotTip + PANE panel; the *attention* half ("sitting too long") migrates to the future `stuck` overlay |
| `waiting Xm` | the waiting overlay itself (see D3 resolution) + tip + PANE panel |

**The PANE panel becomes the pyramid's register view**: the four layers render
as separate, orthogonal lines — never collapsed — so the dot is a *pure
function* of what the panel shows and can be mentally derived from it:

```
out  active · 4s since last output        (L0)
agt  waiting 3m                           (L1)
fab  260705-dmex · review · failed        (L2)
PR   #314 open · checks fail · draft      (L3)
```

Register keys are fixed-width 3-char lowercase (`out` / `agt` / `fab` / `pr`),
matching the panel's existing `tmx`/`cwd`/`git` vocabulary. **[current]**

Absent layers render as absent (no placeholder rows for a plain shell pane
beyond `output`).

## Duration-Text Ladder (tip + PANE panel)

With row minimalism, this ladder governs the **StatusDotTip and PANE panel**
text — the row itself renders no duration. (The Decision Table's "Duration
text" column henceforth describes tip/panel content.)

**[current]** (the pre-y1ar `getWindowDuration` row ladder is retired with Row
Minimalism — the function is deleted; this ladder now governs tip/panel text):

```
waiting Xm   (attention token; NOT muted by output)   ← new
(output flowing → no duration)                        ← unchanged mute
idle Xm      (computed from @rk_agent_state epoch)     ← source swap
tmux elapsed (activityTimestamp ticker)                ← unchanged
```

The waiting exemption is load-bearing: a Claude blocked on a permission prompt
keeps rendering its spinner *below* the prompt, so L0 reads "flowing" — the mute
rule would hide exactly the duration that matters most. `waiting` is the only
state that pierces the mute. (In the PANE panel's register view the L0 line may
always show its elapsed value — the mute rule applies where space is contested,
i.e. the tip's one-line summary.)

---

## Attention Propagation **[current]**

The `waiting` overlay rolls up the hierarchy as a count of waiting windows:

| Surface | Treatment |
|---------|-----------|
| Window row (sidebar) / window tile (SessionTiles) / pane-panel header | halo pulse on the existing StatusDot (free — same component) |
| Session row | count badge when > 0 (e.g. `2⚠` styled per chip vocabulary) |
| Server tile (Host TMUX SERVERS zone) | count badge; one glance at `/` answers "does anything need me" |
| Server tile (sidebar SERVER panel) | count badge, right-aligned on the tile's "N sess" line (inline flex, not absolute — avoids the hover-revealed palette/kill action cluster at the tile top-right); same attached-server-only semantics as the Host tile |
| Board header + board pane | header count; waiting pane gets a pulsing seam (3px, border-width system) — reduced-motion: static seam |
| Command palette | `Agent: Next waiting` — cycles waiting windows (current server first, then others), the keyboard-first attention nav (Constitution V) |
| Web Push | `waiting` sustained ≥ 15s → one push per waiting episode (dedupe on the state's epoch; re-arm when the state changes). Body: window + `waiting for input`; carries the question text when a future `@rk_agent_msg` option exists. `idle`/`active` never push |
| StatusDotTip | gains an agent line on every tier: `agent: waiting 3m` / `active` / `idle 12m` |

Not built (deliberately): a top attention banner (fights the minimal top bar —
the rollup badges + palette nav cover discovery), a second per-row indicator
(mobile clutter), any new page (Constitution IV).

---

## Future Tenants of the Animation Channel

- **Stuck** — `idle` ≥ threshold (default 15m, matching the fab-operator's 🔴
  rule) at a non-terminal fab stage → *slow* pulse, distinct from waiting's
  fast pulse. Attention-tier, so it overlays like waiting; not v1.
- **Error** — the `@rk_agent_state` convention has no error state in v1; if one
  is added, it joins the overlay (never the tier ladder).

One overlay at a time: `waiting` outranks `stuck`.

---

## Accessibility

- `aria-label` composes phase + status + attention: `"review — failed — agent
  waiting 3m"`. Color and motion are never the sole channel (the halo has a
  static reduced-motion form; the duration text and tip carry the same fact).
- The pulse respects `prefers-reduced-motion` per the existing animation
  discipline (`rk-*` utilities zero out; JS treatments skip themselves).

---

## Open Decisions

| ID | Question | Resolution |
|----|----------|-----------|
| ~~D1~~ | ~~PR tier gate: `prNumber` alone?~~ | **Resolved (palette v3)**: PR dot-ownership is per-family — purple requires `fabChange && prNumber`, orange requires `fresh agentState && prNumber`. A plain pane's PR never owns the dot (derivation stays universal in register/tip/PR-status-line) |
| D2 | Merged/closed PR retention under branch-derivation | **Revised after production observation** (first resolution — `--state open` + 10-min in-memory grace — decayed merged purple into green on grace expiry or rk restart): derivation queries **all PR states**; precedence open (most recent) > merged (most recent); merged owns the dot statelessly (durable done-square); closed-unmerged never owns (green fab fallback / floor — shipped). Grace-window machinery retired. **Default-branch carve-out (#389)**: the derivation never runs for a pane on the repo's default branch — head-name-only matching makes every such candidate degenerate, so excluded pairs resolve to an authoritative negative (invariant 6). **[current]** |
| ~~D3~~ | ~~Is a 7px halo pulse salient enough for `waiting`?~~ | **Resolved (additive halo, palette v3)**: `waiting` = constant-**yellow** pulsing halo around the dot, core hue and shape untouched. Rejected: hue-flip (destroys family identity precisely when attention is highest — e.g. fab intake asking); self-colored halo (reduced-motion form nearly invisible + collides with the `ring` shape); fuchsia (its motivating amber collision no longer exists). Reduced-motion: static yellow outer ring. Final glow tuning at implementation with a visual check against all six core hues |
