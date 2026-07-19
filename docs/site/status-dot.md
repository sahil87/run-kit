# Status Dot — Lifecycle Color Journey

> [← Back to the README](https://github.com/sahil87/run-kit/blob/main/README.md#status-dots--read-every-window-at-a-glance)

> The single status dot reused on the sidebar window row, the dashboard window cards, and the
> pane-panel header. It encodes a window's place in the two-family lifecycle using **two orthogonal
> visual channels** plus an **additive attention overlay**: **core hue = journey** (which family +
> position), **shape = status** (health), and a **constant-yellow pulsing halo = the agent is
> waiting on you**. One learned shape language covers the entire pipeline; the halo never touches the
> core hue or shape.

Implementation: `app/frontend/src/components/status-dot.tsx` (rendering) +
`app/frontend/src/components/pr-status-model.ts` (`statusDotState` / `fabPhase` / `fabShape` /
`prShape` / `PHASE_HUE`). Design authority: [`docs/specs/status-pyramid.md`](https://github.com/sahil87/run-kit/blob/main/docs/specs/status-pyramid.md).

## Precedence — which input drives the dot (two families joined at the top)

The dot's core hue + shape are owned by **two ladders joined at the top** — the first precondition
that holds wins. `waiting` is an *additive overlay*, computed independently (it is ladder-exempt and
never a tier of its own):

```
fabChange ?  (prNumber ? purple-PR : stage == intake ? blue : green)      [cool = fab pipeline]
          :  (fresh agentState ? (prNumber ? orange-PR : yellow) : gray)  [warm = ad-hoc agent / floor]
waiting   →  additive constant-yellow halo, over anything (core hue + shape kept)
```

The glance rule: **cool core = my pipeline, warm core = my ad-hoc agents, gray = just a terminal,
yellow glow = needs me now.**

1. **Cool family — fab pipeline** (the pane's worktree has an active fab change):
   - `prNumber` present → **purple** PR tier (the PR owns the dot).
   - else `stage == intake` → **blue**.
   - else → **green** (the "green collapse" — see below).
2. **Warm family — ad-hoc agent** (no fab change, but a fresh `@rk_agent_state`):
   - `prNumber` present → **orange** PR tier.
   - else → **yellow** (solid mid-turn, ring when the agent is idle).
3. **Floor** (no fab change, no fresh agent) → **monochrome gray** tmux activity.

### D1 — per-family PR ownership

PR dot-ownership exists in *both* families but is colored by family: **purple = a fab change at its
PR phase**, **orange = an ad-hoc agent's branch has a PR**. A plain pane with *neither* a fab change
*nor* a fresh agent stays on the **gray floor even when its branch has a PR** — the PR still shows in
the PANE panel's L3 register, the PR-status line, and the tip (derivation stays universal,
[Constitution Principle X](https://github.com/sahil87/run-kit/blob/main/fab/project/constitution.md)),
but a plain shell never renders a mystifying PR dot.

### D2 — merged / closed-PR derivation

The branch→PR derivation queries **all** PR states (`gh pr list --state all`) and picks by
precedence: an **open** PR (most recently updated) wins; else the most recent **merged** PR; else the
most recent **closed** PR. A **merged** PR therefore keeps resolving positive on every pass, so its
purple/orange **done-square is durable statelessly** — derived fresh from `gh` each cycle, with **no
in-memory grace clock** to expire and nothing for an rk restart to wipe (the earlier `--state open` +
10-minute grace window decayed the merged square into a green fab square minutes after merge; that
machinery is gone). A **closed-unmerged** PR is still derived (it shows in the L3 register / tip) but
never owns the dot: a window with a live fab change falls back to its **green working tier** (the live
stage), not a dead PR's skipped ring. Branch-reuse edge: an open PR always outranks an older merged
one on the same branch.

## The channel model — palette v3 (two families + floor)

![StatusDot family × status matrix](https://raw.githubusercontent.com/sahil87/run-kit/main/docs/img/status-dot-matrix.svg)

### Core hue = journey

Palette v3 encodes *which journey* by temperature. **Cool = fab pipeline**, **warm = ad-hoc agent**,
**gray = floor**:

| Family | Phase | Stage(s) / condition | Hue token | Hex (ref) |
|--------|-------|----------------------|-----------|-----------|
| cool (fab) | intake | `intake` | `text-blue-400` | `#60a5fa` |
| cool (fab) | apply *(collapsed)* | `apply`, `review`, `hydrate`, `ship`, `review-pr` | `text-accent-green` | theme green |
| cool (fab) | PR | the live fab PR | `text-purple-400` | `#c084fc` |
| warm (agent) | agent | a fresh `@rk_agent_state` | `text-yellow-400` | `#facc15` |
| warm (agent) | agent PR | an ad-hoc agent's branch PR | `text-orange-400` | `#fb923c` |
| — (floor) | none | plain window, no journey | `text-text-secondary` | gray |

> **The green collapse — a deliberate break from fab-kit's 4-phase README grouping.** The prior
> palette gave `apply`/`review`/`hydrate` amber and `ship`/`review-pr` green, mirroring the README's
> Intake / Execution / Completion / Shipping phases. Palette v3 **collapses every non-intake fab
> stage to a single green** so blue → green → purple reads as one clean pipeline progression and the
> amber hue is freed for the retired attention role. (Supporting fact: the old ship/review-pr green
> barely ever rendered — `/git-pr` creates the PR mid-ship, and purple takes the dot the moment
> `prNumber` exists.) The break from the README grouping is intentional; it is documented here, not
> hidden.

### Attention = the additive waiting halo

When the window's rolled-up `agentState` is **`waiting`** (an agent blocked on a human — the most
notification-worthy state), the dot is wrapped in a **constant-yellow pulsing halo**. The halo is
**additive**: the core hue AND shape are untouched, so a blue intake dot keeps its blue core
(`"fab intake asking"`), and a green failed review dot keeps its green failed shape
(`"review failed and the agent is asking"`). Yellow is the agent color in both roles — **yellow
core** = "an ad-hoc agent lives here", **yellow halo** = "an agent needs you now" — the glow never
claims the window is ad-hoc, because family identity lives strictly in the core.

Under `prefers-reduced-motion` the halo renders as a **static yellow outer ring** (no pulse) —
attention is never encoded in motion alone. Rejected alternatives, for the record: hue-flip on
waiting (destroys family identity exactly when attention is highest), a self-colored halo (its
reduced-motion form nearly vanishes and reads like the hollow `ring` shape), and a fuchsia attention
hue (its motivating amber collision no longer exists once fab collapses to blue/green).

### Shape = status

ONE shape vocabulary across **all** phases (fab stages AND PR):

| Status (`fabDisplayState` / PR equivalent) | Shape | Rendering |
|--------------------------------------------|-------|-----------|
| `pending` (PR: checks running) | ring | hollow circle, 1.8px solid border in the core hue, transparent fill |
| `active` / `ready` (PR: open / healthy) | solid circle | filled circle in the core hue |
| `failed` (PR: checks fail / changes requested) | **dotted ring + red center** | dotted 1.2px border in the core hue on a slightly larger 9px footprint, transparent fill, with a small **red** (`bg-red-400`) dot centered inside |
| `done` (PR: merged) | square | filled sharp-cornered square (`rounded-none`) in the core hue |
| `skipped` (PR: closed unmerged) | gray ring | hollow ring forced to gray (`text-text-secondary`) |

All shapes render at one uniform 7px footprint (the `failed` dot is a slightly larger 9px so its
dotted bead-ring stays legible), so the filled square and the hollow circles read as the same size in
the dense sidebar — the square is distinguished by its sharp (`rounded-none`) corners, not by size.

### floor (tmux fallback)

The lowest-precedence plain-window signal is **monochrome gray** — color is reserved for a journey:

- `active` → gray solid circle
- `idle` → gray hollow ring

## Full matrix (rows = family/phase, cols = status; halo is an overlay)

| Family / phase (hue) | pending | active/ready | failed | done | skipped |
|----------------------|---------|--------------|--------|------|---------|
| fab intake (blue) | blue ring | blue solid | blue dotted-ring + red center | blue square | gray ring |
| fab apply *(collapsed: apply/review/hydrate/ship/review-pr)* (green) | green ring | green solid | green dotted-ring + red center | green square | gray ring |
| fab PR (purple) | purple ring | purple solid | purple dotted-ring + red center | purple square (merged) | gray ring |
| ad-hoc agent (yellow) | yellow ring (idle) | yellow solid (active/mid-turn) | — | — | — |
| ad-hoc agent PR (orange) | orange ring | orange solid | orange dotted-ring + red center | orange square (merged) | gray ring |
| plain (gray) | — | gray solid (active) | — | — | gray ring (idle) |

> **Waiting is an OVERLAY, not a row.** Any cell above, when the agent is `waiting`, additionally gets
> the constant-yellow halo — the core hue and shape in that cell are unchanged. It is applicable to
> every tier, so it is not a new matrix row.

## Row Minimalism — the dot is the row's only status signal

The sidebar window row's trailing status cluster — the stage word (`intake`, red when failed) and the
duration text — is **removed**. The **StatusDot is the row's only externally visible status signal**;
the window name gets the freed width back (less truncation, especially on mobile).

Where each removed signal survives:

| Removed from the row | Survives as |
|----------------------|-------------|
| stage word (`review`) | the dot's core hue at a glance; the exact stage in the StatusDotTip and the PANE panel |
| failed-red stage text | the dot's `failed` shape (dotted ring + red center) |
| `done`-parking suppression | the dot's `done` square |
| idle / elapsed duration | the StatusDotTip agent line + the PANE panel register view |
| `waiting Xm` | the additive halo + the tip agent line + the PANE panel |

**The PANE panel becomes the register view.** The four signal layers render as separate, orthogonal
lines — never collapsed — so the dot is a *pure function* of what the panel shows and can be mentally
derived from it:

```
out  active · 4s since last output        (L0: tmux activity)
agt  waiting 3m                            (L1: @rk_agent_state + epoch)
fab  260705-dmex · review · failed         (L2: fabChange · stage · displayState)
PR   #314 open · checks fail · draft        (L3: prNumber/state/checks/review/draft)
```

The register keys are fixed-width 3-char (`out`/`agt`/`fab`/`PR`), matching the panel's existing
`tmx`/`cwd`/`git` vocabulary. Absent layers render as absent (a plain shell pane shows only `out`).
The L3 PR register shows for **any** pane with a `prNumber` (universal derivation — even a plain pane
whose dot stays gray).

## Red is used in exactly one way

Across the entire system, **red appears only as the small center dot inside a `failed` dotted
ring** — never as a whole-dot color, and never as an attention signal (attention is the yellow halo).

## Accessibility

Every dot carries `role="img"` + `aria-label` composed from **phase + status + attention**, so
neither color nor motion is ever the sole channel (colorblind a11y + the keyboard-first constitution).
Examples: `"apply — active"`, `"review — failed — agent waiting 3m"`, `"intake — pending"`,
`"PR — merged"`, `"agent — idle"`; the floor uses the bare `"active"` / `"idle"`. The halo respects
`prefers-reduced-motion` (a static yellow ring), and the same waiting fact is carried by the duration
text and the tip agent line.

## Scope notes

- **Mostly frontend.** The dot's inputs flow on `WindowInfo` via SSE (`fabChange`, `fabStage`,
  `fabDisplayState`, `activity`, `agentState`, and the branch-derived PR fields). The one backend
  touch is the D2 branch→PR derivation: it queries all PR states and picks by precedence
  (open > merged > closed), so a merged PR keeps resolving and its done-square stays visible
  statelessly — no grace clock, restart-proof.
- The existing PR color vocabulary (`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`,
  `prDotState`, `PrStatusLine`) is preserved — it serves the dashboard PR line and the pane-panel PR
  register.

*Palette v3 introduced by change `260706-y1ar-status-pyramid-ui-surfacing`, surfacing
`docs/specs/status-pyramid.md` on the Generic Agent-State Tier (#314). Extends the lifecycle journey
(`260615-0hsz`) and the unified StatusDot (`260615-yg7f`).*
