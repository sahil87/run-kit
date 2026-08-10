# Status Dot — The Compositional Vocabulary

> [← Back to the README](https://github.com/sahil87/run-kit/blob/main/README.md#status-dots--read-every-window-at-a-glance)

> The single status dot reused on the sidebar window row, the dashboard window cards, and the
> pane-panel header. It tells the window's **local story** — what runs in this pane: which journey,
> is it healthy, does it need me — using **two orthogonal visual channels** plus an **additive
> attention overlay**: **core hue = journey**, **shape = status** (the same meaning in every hue),
> and a **constant-yellow pulsing halo = the agent is waiting on you**. The **remote story** — the
> branch's PR on GitHub — lives on the row's right-edge **PR glyph**, never on the dot. There is no
> matrix to memorize: hue × shape compose freely and no cell is special.

Implementation: `app/frontend/src/components/status-dot.tsx` (rendering) +
`app/frontend/src/components/pr-status-model.ts` (`statusDotState` / `fabPhase` / `fabShape` /
`PHASE_HUE` / `prOwnsGlyph` / `prGlyphColor`). Design authority:
[`docs/specs/status-pyramid.md`](https://github.com/sahil87/run-kit/blob/main/docs/specs/status-pyramid.md).

## Precedence — which input drives the dot (two families joined at the top)

The dot's core hue + shape are owned by **two ladders joined at the top** — the first precondition
that holds wins. `waiting` is an *additive overlay*, computed independently (it is ladder-exempt and
never a tier of its own). **No PR branch exists anywhere in the ladder** — the dot never consults PR
fields:

```
fabChange ?  (stage ∈ {intake, apply, review} ? blue-building : green-PR-ready)  [cool = fab pipeline]
          :  (fresh agentState ? yellow agent : gray floor)                      [warm = ad-hoc agent / floor]
waiting   →  additive constant-yellow halo, over anything (core hue + shape kept)
```

The glance rule: **blue = still cooking, green = out the door / done, yellow core = my ad-hoc
agents, gray = just a terminal, yellow glow = needs me now.**

1. **Cool family — fab pipeline** (the pane's worktree has an active fab change):
   - `stage ∈ {intake, apply, review}` → **blue building** (pre-PR work).
   - every other stage (`ship`, `review-pr`, `done`, unknown) → **green PR-ready** — the change has
     completed its local work ("the PR is ready"). The blue↔green split is **stage-based, never
     `prNumber`-based**; its alignment with PR existence is emergent (`/git-pr` creates the PR
     mid-ship), not a stage check.
   - a **`skipped`** display-state makes the window *not fab-owned* — the change has left its
     journey, so the ladder simply falls through (agent tier, then floor).
2. **Warm family — ad-hoc agent** (no fab change, but a fresh `@rk_agent_state`) → **yellow**
   (solid mid-turn, ring when the agent is idle).
3. **Floor** (no fab change, no fresh agent) → **monochrome gray** tmux activity.

## The four legend strips

![StatusDot compositional reference](https://raw.githubusercontent.com/sahil87/run-kit/main/docs/img/status-dot-reference.svg)

### 1 · Core hue = journey (4)

| Hue | Token | Hex (ref) | Means |
|-----|-------|-----------|-------|
| blue | `text-blue-400` | `#60a5fa` | fab **building** — intake · apply · review (pre-PR work) |
| green | `text-accent-green` | theme green | fab **PR-ready / done** — ship · review-pr · done (local work complete) |
| yellow | `text-yellow-400` | `#facc15` | **ad-hoc agent** — a fresh `@rk_agent_state`, no fab change |
| gray | `text-text-secondary` | gray | **floor** — plain terminal; color is reserved for a journey |

The purple and orange PR hues are **retired from the dot** — purple survives in the glyph and the
PR text surfaces. The fab hue is a **two-stop progress bar, not a stage map**: exactly two fab
hues, answering "still cooking vs out the door" at a glance; the exact stage lives in the `fab`
register on the hover card and the PANE panel.

### 2 · Shape = status (3 — the same meaning in every hue)

| Shape | Rendering | Means |
|-------|-----------|-------|
| solid | filled circle in the core hue | running / live (stage active·ready, mid-turn agent, output flowing) |
| ring | hollow circle, 1.8px border in the core hue | at rest — stage pending · **parked done** · idle agent · quiet shell |
| failed | dotted 1.2px border on a 9px footprint + a small **red** center dot | review / review-pr failed |

A **parked-done change is a green resting ring** — resting, journey complete; the purple merged
glyph (when a PR exists) says how it ended. The `done` square and the `skipped` shape are retired.
All shapes render at one uniform 7px footprint; the `failed` dot is the lone exception (9px, so its
dotted bead-ring stays legible).

### 3 · PR = the right-edge row glyph (one channel, six states — never the dot)

A window with an **owned PR** (`prOwnsGlyph`: `prNumber` present with a known owned state — `open`, `merged`, or `closed`; unknown/unconfident states never own) shows a
git-pull-request glyph at the row's right edge, colored by `prGlyphColor` — first match wins, and
the order is the design:

| Color | Token | Icon | Means |
|-------|-------|------|-------|
| gray | `text-text-secondary` | ✕ closed icon | **closed** — a dead PR, muted; sits above fail (stale checks are noise); the ✕ shape separates it from draft |
| red | `text-red-400` | normal | checks fail / changes requested — fail stays on top (of open states) |
| gray | `text-text-secondary` | normal | open **draft** — muted even while its checks run (draft outranks pending) |
| yellow | `text-yellow-400` | normal | open, **checks running** (`prChecks: pending`) |
| green | `text-accent-green` | normal | open, checks pass or no decisive signal |
| purple | `text-purple-400` | normal | merged |

A closed-unmerged PR earns the **muted ✕ glyph** (its register line is unchanged) — a dead PR is a
glance-level "this window needs a decision" signal, and shape (not color) separates it from both a
failing PR (red normal icon) and a draft (gray normal icon). The glyph is
deliberately **not family-gated**: any pane whose branch has an owned PR shows it — even a plain
floor pane whose dot stays gray (derivation is universal, Constitution Principle X).

### 4 · Attention = the additive waiting halo

When the window's rolled-up `agentState` is **`waiting`** (an agent blocked on a human — the most
notification-worthy state), the dot is wrapped in a **constant-yellow pulsing halo**. The halo is
**additive**: the core hue AND shape are untouched, so a blue building dot keeps its blue core
(`"fab agent asking"`), and a failed review dot keeps its failed shape (`"review failed and the
agent is asking"`). Yellow is the agent color in both roles — **yellow core** = "an ad-hoc agent
lives here", **yellow halo** = "an agent needs you now" — the glow never claims the window is
ad-hoc, because family identity lives strictly in the core.

Under `prefers-reduced-motion` the halo renders as a **static yellow outer ring** (no pulse) —
attention is never encoded in motion alone.

## Reading a row — composed examples

Read hue, then shape, then glyph:

| Dot | Glyph | Reads as |
|-----|-------|----------|
| blue solid | — | building — a fab change mid-work |
| blue dotted + red center, yellow halo | — | review failed and the agent is asking |
| green solid | green | PR open, landing |
| green solid | yellow | shipped; checks running on the PR |
| green ring | purple | merged and parked — archive me |
| yellow solid | — | ad-hoc agent mid-turn |
| gray ring | — | quiet shell |

## D2 — merged / closed-PR derivation (feeds the glyph)

The backend branch→PR derivation queries **all** PR states (`gh pr list --state all`) and picks by
precedence: an **open** PR (most recently updated) wins; else the most recent **merged** PR; else
the most recent **closed** PR. A **merged** PR therefore keeps resolving positive on every pass, so
the **glyph's purple merged state is durable statelessly** — derived fresh from `gh` each cycle,
with no in-memory grace clock and nothing for an rk restart to wipe. A **closed-unmerged** PR is
still derived (it shows in the L3 register) and now feeds the muted ✕ glyph as well. Branch-reuse
edge: an open PR always outranks an older merged one on the same branch. (Pre-eviction this
durability fed the dot's purple done-square; the mechanism is unchanged — only its consumer moved
to the glyph.)

## Row Minimalism — glyphs on the row, detail on hover

The sidebar window row's trailing status **text** cluster — the stage word (`intake`, red when
failed) and the duration text — is **removed**; the window name gets the freed width back (less
truncation, especially on mobile). The row's status signals are glyphs only: the leading StatusDot,
plus the rest-state PR glyph above. The PR glyph is informational — it swaps out for the pin and ✕
actions the moment you hover the row.

Where each removed signal survives:

| Removed from the row | Survives as |
|----------------------|-------------|
| stage word (`review`) | the dot's core hue at a glance (blue = pre-PR, green = PR-ready); the exact stage in the hover card and the PANE panel |
| failed-red stage text | the dot's `failed` shape (dotted ring + red center) |
| `done`-parking suppression | the dot's green resting ring |
| PR states (merged / failing / pending / closed) | the right-edge PR glyph (purple / red / yellow / muted ✕) |
| idle / elapsed duration | the hover card's `agt` register + the PANE panel register view |
| `waiting Xm` | the additive halo + the `agt` register on both surfaces |

**Hover any row for the full picture.** Resting the pointer on a window row opens a card at the
sidebar's right edge — same position every time, so it never jumps around under the pointer. It
shows the dot's own label, the four registers below, how long ago the PR status was checked, and an
"Open PR #N" link. The card also opens when you focus a row with the keyboard (Escape dismisses
it), and on a touch device by tapping the row's status dot.

**The PANE panel is the same register view for the selected window.** The four signal layers render
as separate, orthogonal lines — never collapsed — so the dot is a *pure function* of what they show
and can be mentally derived from it:

```
out  active · 4s since last output        (L0: tmux activity)
agt  waiting 3m                            (L1: @rk_agent_state + epoch)
fab  260705-dmex · review · failed         (L2: fabChange · stage · displayState)
PR   #314 open · checks fail · draft        (L3: prNumber/state/checks/review/draft)
```

The register keys are fixed-width 3-char (`out`/`agt`/`fab`/`PR`), matching the panel's existing
`tmx`/`cwd`/`git` vocabulary. Absent layers render as absent (a plain shell pane shows only `out`).
The L3 PR register shows for **any** pane with a `prNumber` (universal derivation, even a plain
pane whose dot stays gray). The row's rest-state PR glyph is stricter — it renders only for an
**owned** PR; a closed PR keeps its register line and shows the muted ✕ row glyph (unknown or
unconfident states still show no glyph). The **session tiles**
(the `/$server` dashboard) carry the same dot + rest-state glyph pair per window tile.

## Where red appears

- **On the dot**: only as the small center dot inside a `failed` dotted ring — never as a whole-dot
  color, and never as an attention signal (attention is the yellow halo).
- **On the glyph**: a failing PR (checks fail / changes requested) — the remote-failure signal.

The two channels never share a fact: dot-red is *your pipeline failed here*, glyph-red is *the PR
is failing on GitHub*.

## Accessibility

Every dot carries `role="img"` + `aria-label` composed from **hue word + status word +
attention** — a pure function of what the dot shows — so neither color nor motion is ever the sole
channel (colorblind a11y + the keyboard-first constitution). Examples: `"building — active"`,
`"building — failed — agent waiting 3m"`, `"PR-ready — parked"`, `"agent — idle"`; the floor uses
the bare `"active"` / `"idle"`. PR facts are deliberately absent from the label (the glyph is
`aria-hidden` decoration; the flyout card and PANE panel carry the PR detail). The halo respects
`prefers-reduced-motion` (a static yellow ring), and the same waiting fact is carried by the
duration text and the register surfaces.

## Scope notes

- **Frontend only.** The dot's inputs flow on `WindowInfo` via SSE (`fabChange`, `fabStage`,
  `fabDisplayState`, `activity`, `agentState`); the glyph reads the branch-derived PR fields. The
  backend D2 derivation (state-all precedence, default-branch carve-out #389) is unchanged.
- The shared PR color vocabulary (`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`,
  `prDotState`) is preserved — it serves the glyph chain and the pane-panel PR register.

*Compositional vocabulary introduced by change `260810-aqo6-statusdot-compositional-vocabulary`
(PR evicted to the glyph, square + skipped retired, blue building → green PR-ready). Supersedes
palette v3 (`260706-y1ar`), which extended the lifecycle journey (`260615-0hsz`) and the unified
StatusDot (`260615-yg7f`).*
