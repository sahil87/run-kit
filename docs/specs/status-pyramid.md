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
| L1 — agent lifecycle | `agentState` (active / waiting / idle) + epoch | an instrumented agent runs in a pane of the window | `@rk_agent_state` pane option, window rollup `waiting > active > idle`; absent = unknown; shell-command reconciler clears stale values (see agent-state.md) |
| L2 — fab pipeline | `fabChange`, `fabStage`, `fabDisplayState` | the pane's worktree has an active change | cwd → `.fab-status.yaml` → `.status.yaml`, via the pane-map join |
| L3 — PR | `prNumber`/`prUrl` + `prState`/`prChecks`/`prReview`/`prIsDraft` | the pane's branch resolves to a PR | branch → `gh` lookup in the prstatus collector (post-#314; previously fab's `.status.yaml` `prs:` list) |

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
| Hue | journey phase | blue (intake) → amber (apply/review/hydrate) → green (ship/review-pr) → purple (live PR) → gray (no journey) — `PHASE_HUE` |
| Shape | health/status of the owning tier | solid (live/healthy) · ring (pending) · failed (dotted ring + red center) · done (sharp square) · skipped (gray hollow ring) |
| Animation **[target]** | attention | pulsing halo = `waiting`; (future) slow pulse = stuck. No animation = no attention needed |
| Duration text | how long in the current resting state | `waiting Xm` (attention token) · `idle Xm` · tmux elapsed |
| Tip (StatusDotTip) | full detail | phase + status label, agent line, PR link, docs link |
| Rollup badges **[target]** | attention counts up the hierarchy | session row → server tile → board header |

**Hue-collision rule**: no `PHASE_HUE` color can double as the attention color —
`text-amber-400` is the execution/completion phase hue; yellow is adjacent; red
is reserved for exactly one use (the `failed` center dot); green and purple are
taken. Attention therefore gets the channel nothing else uses — **animation** (a
pulsing halo/glow around the dot) — **plus a dedicated attention hue from
outside `PHASE_HUE`** (fuchsia family), per the D3 resolution: with Row
Minimalism the pulse is the sole row-level waiting carrier, so it pairs with the
attention hue rather than relying on motion alone. Under
`prefers-reduced-motion` the halo renders static (a persistent outer ring in the
attention hue) — attention is never encoded in motion alone.

---

## The Tier Ladder (dot ownership)

The dot's hue + shape are owned by the **first tier whose precondition holds**:

```
PR (prNumber resolved)  >  fab (fabChange)  >  agent (fresh agentState)  >  tmux (always)
```

- **[current]** the PR tier gate is `fabChange && prNumber` — PR requires a fab change.
- **[target — D1]** the gate becomes `prNumber` alone. Post-#314 the PR is a
  property of the *branch*, not of fab; a non-fab pane on a branch with an open
  PR gets the purple PR dot. (Principle X: derive, and show what you derived.)
- **[target]** the agent tier is new: for windows with no change and no PR, a
  fresh `agentState` replaces the 10-second output heuristic as the shape
  source. The agent tier keeps **gray** hue — color stays reserved for the
  journey; an agent mid-turn is `solid` even while quiet (thinking), an idle
  agent is `ring` even while `htop` repaints the pane.
- The **attention overlay is ladder-exempt**: `waiting` pulses on any tier —
  a change-bound window at review whose agent hits a permission prompt pulses
  over its amber review dot; a PR-phase window pulses over purple.

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
3. **Agent active/idle never owns hue, and never surfaces in the dot's shape on
   change-bound or PR windows** — those tiers' shapes carry pipeline/PR health,
   which is rarer and more actionable than routine agent state. Agent state on
   those windows lives in: the duration text, the tip's agent line, and (when
   waiting) the attention halo.
4. **`waiting` is never a tier** — it cannot displace hue/shape anywhere. It is
   an overlay: halo pulse + `waiting Xm` duration text + rollup counts + push.
5. **tmux output recency surfaces in exactly two places**: the bottom tier's
   solid/ring (no change, no PR, no agent), and the duration-mute rule (below).
   It is never an attention signal — output ≠ needs-me.
6. **A closed-unmerged PR currently keeps the tier** (gray `skipped` ring) even
   when the fab change is still live **[current]**. **[open — D2]**: when the
   branch's PR is closed-unmerged but `fabChange` is still active (work
   continues toward a new PR), the tier SHOULD fall back to fab so the dot
   shows live stage state instead of a dead PR. Verify against #314's
   derivation semantics (open-PR-only lookup may make this moot by dropping
   closed PRs entirely — which would instead *lose* the merged-purple-square
   terminal state; resolve the two together).
7. **Unknown beats wrong**: absent `@rk_agent_state`, or a value on a pane whose
   command is a plain shell (reconciler), means *no agent tier* — the ladder
   falls through to tmux. Nothing renders a guessed agent state.

---

## Decision Table

`—` = signal absent. Anim/Text columns are **[target]**; hue/shape rows marked ✓
match current `statusDotState` behavior.

| # | PR | fab | agent | tmux out | Dot (hue · shape · anim) | Duration text | |
|---|----|-----|-------|----------|--------------------------|---------------|---|
| 1 | — | — | — | flowing | gray · solid | *(none — muted)* | ✓ |
| 2 | — | — | — | quiet | gray · ring | tmux elapsed | ✓ |
| 3 | — | — | active | any | gray · solid | *(none)* | agent replaces 10s heuristic |
| 4 | — | — | idle | any | gray · ring | `idle Xm` (from epoch) | |
| 5 | — | — | **waiting** | any | gray · solid · **pulse** | `waiting Xm` | push after sustain |
| 6 | — | apply·active | any but waiting | any | amber · solid | idle→`idle Xm`, else none | ✓ hue/shape |
| 7 | — | review·failed | any but waiting | any | amber · failed | per agent state | ✓ |
| 8 | — | stage·pending | — | any | phase hue · ring | tmux elapsed | ✓ |
| 9 | — | any stage | **waiting** | any | phase hue · stage shape · **pulse** | `waiting Xm` | the permission-prompt-at-review case |
| 10 | open·healthy | any | any but waiting | any | purple · solid | per agent state | ✓ |
| 11 | checks running | any | — | any | purple · ring | | ✓ |
| 12 | checks fail / changes requested | any | any | any | purple · failed | | ✓ |
| 13 | merged | any | any | any | purple · done (square) | | ✓ — see D2 for derivation survival |
| 14 | closed-unmerged | live change | any | any | **[current]** gray · skipped / **[D2 target]** fall back to fab tier | | |
| 15 | open | any | **waiting** | any | purple · solid · **pulse** | `waiting Xm` | |

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
output  active · 4s since last output        (L0)
agent   waiting 3m                           (L1)
fab     260705-dmex · review · failed        (L2)
PR      #314 open · checks fail · draft      (L3)
```

Absent layers render as absent (no placeholder rows for a plain shell pane
beyond `output`).

## Duration-Text Ladder (tip + PANE panel)

With row minimalism, this ladder governs the **StatusDotTip and PANE panel**
text — the row itself renders no duration. (The Decision Table's "Duration
text" column henceforth describes tip/panel content.)

**[current]** `getWindowDuration`: output flowing (L0 active) mutes everything;
then `idle` + `agentIdleDuration` shows the static fab-provided string; then
tmux elapsed; agent `active` shows nothing.

**[target]** one insertion at the top, one exemption:

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

## Attention Propagation **[target]**

The `waiting` overlay rolls up the hierarchy as a count of waiting windows:

| Surface | Treatment |
|---------|-----------|
| Window row (sidebar) / window tile (SessionTiles) / pane-panel header | halo pulse on the existing StatusDot (free — same component) |
| Session row | count badge when > 0 (e.g. `2⚠` styled per chip vocabulary) |
| Server tile (Cockpit TMUX SERVERS zone) | count badge; one glance at `/` answers "does anything need me" |
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

| ID | Question | Leaning |
|----|----------|---------|
| D1 | PR tier gate: `prNumber` alone (drop `fabChange &&`)? | Yes — branch-derived PRs make the fab coupling arbitrary |
| D2 | Closed/merged PR retention: does branch-derivation (open-PR lookup) drop merged/closed PRs, losing the purple done-square and mooting the closed-vs-live-fab conflict? | Keep a merged PR visible for a grace window (collector retains last-known state); closed-unmerged with a live change falls back to fab tier. Verify against #314 implementation |
| ~~D3~~ | ~~Is a 7px halo pulse salient enough for `waiting`?~~ | **Resolved by Row Minimalism**: with the row's text signals removed, the pulse is the sole row-level waiting carrier and must not be subtle — `waiting` renders **halo pulse + a dedicated attention hue together** (outside `PHASE_HUE`, fuchsia family — never amber/yellow/red). Reduced-motion: static halo + the attention hue. Final glyph tuning at implementation with a visual check against all five phase hues |
