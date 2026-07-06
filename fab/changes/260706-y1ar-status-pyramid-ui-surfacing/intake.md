# Intake: Status-Pyramid UI Surfacing

**Change**: 260706-y1ar-status-pyramid-ui-surfacing
**Created**: 2026-07-06

## Origin

> Status-pyramid UI surfacing: implement docs/specs/status-pyramid.md (PR #316) on top of the merged Generic Agent-State Tier (#314) — 4-tier statusDotState ladder with agent tier + D1 PR-gate decoupling, waiting attention overlay (halo pulse + fuchsia attention hue, reduced-motion static), Row Minimalism (remove window-row stage word + duration cluster, StatusDot only), PANE panel four-register view (L0 output / L1 agent / L2 fab / L3 PR, orthogonal lines), StatusDotTip agent line, attention rollup badges (session row, Cockpit server tiles, board header + pane seam), palette "Agent: Next waiting" nav, Web Push on sustained waiting, and D2 merged/closed-PR retention verification

Conversational mode — the UI-surfacing half of the 2026-07-05/06 agent-status
discussion. The design authority is **`docs/specs/status-pyramid.md`** (merged
via PR #316): the tier ladder, channel model, 15-row decision table, Row
Minimalism, duration ladder, attention propagation, and decision log (D1
decided, D2 open-verify, D3 resolved). This intake summarizes the spec's
decisions for state transfer; where they diverge, **the spec wins**. The data
layer this consumes is the merged Generic Agent-State Tier (#314,
`260705-dmex`): three-state `agentState` (`active|waiting|idle`) from the
`@rk_agent_state` pane option, per-pane + window-rollup fields, branch-derived
`prNumber`/`prUrl`. Key user decisions, verbatim intent:

- StatusDot becomes the row's ONLY externally visible status signal ("Keep the
  StatusDot the only externally visible signal").
- The PANE panel keeps the underlying signals "orthogonal, separate, so we can
  mentally derive the status dot by looking at the PANE panel".
- Palette v3 blessed (2026-07-06): two-family hues — cool = fab (blue → green →
  purple), warm = ad-hoc agent (yellow → orange), gray floor. D3 final form:
  waiting = **additive constant-yellow pulsing halo**, core hue + shape kept
  (hue-flip and self-colored-halo variants explicitly rejected — see spec
  § Open Decisions).
- UI scope was previously deferred out of #314 — this change is that deferred
  work.

## Why

1. **#314 made `waiting` exist; nothing renders it.** The most
   notification-worthy state (agent blocked on a human) now arrives in
   `agentState`, but `statusDotState` still ignores agent state entirely and no
   surface distinguishes waiting from active. The whole point of the three-state
   convention — "which of my N agents needs me, glanceable from a phone" — is
   unrealized until the UI consumes it.
2. **The window row's right-side cluster is redundant-and-confusing.** The
   stage word duplicates the dot's hue (and its failed-red duplicates the dot's
   failed shape); the duration text vanishes whenever output flows, creating a
   false "stage replaces time" illusion; together they steal width from window
   names (truncation, worst on mobile). Removing them (Row Minimalism) makes
   the dot the single scan anchor and the PANE panel the explanation.
3. **The dot's ladder is stale post-#314.** Its PR gate still requires
   `fabChange` although PRs are now branch-derived (D1), and it has no agent
   tier — for no-change windows it still uses the 10s output heuristic that
   misreads a thinking agent as idle.

## What Changes

> Authority: `docs/specs/status-pyramid.md`. Subsections below map 1:1 to spec
> sections; read both.

### 1. `statusDotState` — 4-tier ladder + attention overlay (`pr-status-line.tsx`, `status-dot.tsx`)

Rewrite the 3-tier precedence into the spec's ladder, first tier whose
precondition holds owns hue + shape:

Palette v3 — **two families + floor** (spec § The Channel Model / § The Tier
Ladder): cool = fab pipeline (blue intake → green apply→review-pr collapsed →
purple PR), warm = ad-hoc agent (yellow working → orange PR), gray = floor.
`PHASE_HUE` is reworked accordingly (amber retires; yellow/orange tokens join).

```ts
// target (spec § The Tier Ladder — two ladders joined at the top)
if (fabChange)  → prNumber ? { phase:"pr", purple, shape: prShape(win) }
                           : stage === intake ? { blue,  shape: fabShape(displayState) }
                                              : { green, shape: fabShape(displayState) }
else            → fresh agentState ? (prNumber ? { orange, shape: prShape(win) }
                                                : { yellow, shape: state==="idle" ? "ring" : "solid" })
                                    : { gray, shape: activity==="active" ? "solid" : "ring" }  // L0 floor
```

- **Attention overlay — ladder-exempt and ADDITIVE**: `agentState === "waiting"`
  wraps ANY tier's dot in a **constant-yellow pulsing halo**; the core hue AND
  shape are untouched (blue core + yellow halo = "fab intake asking"; green
  failed core + halo = "review failed and the agent is asking"). NEVER flip the
  core hue — that destroys family identity exactly when attention is highest.
  `prefers-reduced-motion`: static yellow outer ring, no pulse (per the
  existing rk-* animation discipline). Final glow tuning at implementation with
  a visual check against all six core hues.
- **D1 resolved (per-family PR ownership)**: purple requires
  `fabChange && prNumber`; orange requires `fresh agentState && prNumber`; a
  plain pane's PR never owns the dot (its PR stays in the L3 register,
  PR-status line, and tip — derivation universal per Principle X).
- `dotLabel`/aria: labels compose attention too — `"review — failed — agent
  waiting 3m"`.
- The ad-hoc agent tier consumes the freshness rules #314 shipped (absent
  option / shell reconciler → tier falls through to L0).

### 2. Row Minimalism (`window-row.tsx`)

Remove the trailing status cluster entirely: the stage-word span
(`win.fabStage && win.fabDisplayState !== "done"`, red-when-failed) and the
`WindowDuration`/`TickingDuration` leaves (and their per-second `useNow` tick).
The StatusDot is the row's only status signal; the name gets the freed width.
Hover-reveal action icons (pin/color/kill) are untouched — they are actions,
not status. `getWindowDuration` loses its window-row caller; rescope or move it
to the tip/panel layer (spec § Duration-Text Ladder) — do not leave dead code.

### 3. PANE panel four-register view (`status-panel.tsx`)

Replace the current mixed lines with the pyramid's register view — one line per
layer, orthogonal, never collapsed, so the dot is mentally derivable:

```
output  active · 4s since last output        (L0: activity + activityTimestamp)
agent   waiting 3m                           (L1: agentState + epoch duration)
fab     260705-dmex · review · failed        (L2: fabChange · fabStage · fabDisplayState)
PR      #314 open · checks fail · draft      (L3: prNumber/State/Checks/Review/IsDraft)
```

Absent layers render as absent (a plain shell pane shows only `output`). The
existing `PrStatusLine` behavior (link, click-to-refresh) folds into the L3
register line. Waiting duration is NOT muted by flowing output (the spec's
pierce rule); the L0 register always shows its own elapsed value.

### 4. StatusDotTip agent line (`status-dot-tip.tsx`)

The hover card gains an agent line on every tier (`agent: waiting 3m` /
`active` / `idle 12m`; omitted when no agent) and keeps the exact stage label —
post-Row-Minimalism the tip is the at-a-glance recovery path for the removed
stage word and durations.

### 5. Attention rollups (sidebar, Cockpit, board)

`waiting` counts propagate as badges, styled per the existing chip vocabulary:

- **Session row**: count badge when > 0 (its windows' waiting count).
- **Cockpit TMUX SERVERS zone**: per-server tile badge (sum over sessions) — one
  glance at `/` answers "does anything need me".
- **Board**: header count of waiting panes; a waiting pane gets a pulsing seam
  (3px, border-width system; reduced-motion: static seam in the attention hue).

No top banner, no new pages, no second per-row indicator (spec's deliberate
non-goals; Constitution IV).

### 6. Palette nav: `Agent: Next waiting`

Command-palette action cycling focus/navigation through waiting windows —
current server first, then other servers (board panes count via their windows).
No-op with a "no agents waiting" toast/hint when none. Keyboard-first
(Constitution V); register the action per the palette conventions.

### 7. Web Push on sustained waiting (backend + existing push subsystem)

Server-side: when a window's rolled-up `agentState` is `waiting` sustained
≥ 15s, send ONE push per waiting episode via the existing `internal/push`
subsystem (`/api/notify` path) — dedupe on the state's epoch (a new episode =
new epoch), re-arm when the state changes. Body: window name + `waiting for
input` (+ question text when a future `@rk_agent_msg` exists — not this
change). `idle`/`active` never push. The natural seam is the SSE hub's
per-tick assembly where rolled-up window state already exists; keep it
poll-derived, no new state store beyond in-memory episode tracking
(Constitution II applies to durable state; in-memory dedupe mirrors the
existing prstatus/metrics collectors).

### 8. D2 verification: merged/closed PR retention (`internal/prstatus` + ladder)

First READ #314's branch→PR derivation: does the lookup drop merged/closed PRs
(losing the purple done-square) or retain them? Then implement the spec's D2
leaning: a merged PR stays visible for a grace window (collector retains
last-known state); a closed-unmerged PR on a window whose fab change is still
live falls back to the fab tier (dot shows live stage, not a dead PR). If the
verified implementation already satisfies this, record it and adjust only the
ladder gate. This is the one task that may adjust backend behavior; everything
else in this change is frontend.

### 9. Docs-site page + state-matrix SVG (user-added scope)

Update the public docs to match the new model, in the same change:

- **`docs/site/status-dot.md`** — the page the StatusDotTip docs link targets.
  Rewrite the "Precedence" section from the 3-tier `PR > fab > tmux` to the
  4-tier ladder + attention overlay (mirroring spec § The Tier Ladder, incl.
  D1's gate change), and document Row Minimalism (the dot is the row's only
  signal; stage/duration live in the tip + PANE-panel register view).
- **`docs/img/status-dot-matrix.svg`** — the stage × status matrix image
  embedded in that page (and referenced from the README): rebuild for palette
  v3 — the two families (cool fab rows: blue/green/purple; warm ad-hoc rows:
  yellow/orange) + gray floor, and the **waiting overlay** (constant-yellow
  halo, shown as an overlay applicable to every tier — not a new tier row).
  Note the deliberate break from fab-kit's 4-phase grouping (green collapse).

## Affected Memory

- `run-kit/ui-patterns`: (modify) StatusDot ladder + attention overlay, Row
  Minimalism, PANE-panel register view, rollup badges, palette action, tip
  agent line
- `run-kit/architecture`: (modify) push-on-waiting episode logic in the SSE/push
  path; any D2 prstatus retention change
- `run-kit/agent-state` (or the memory file #314's hydrate created — check
  `docs/memory/run-kit/index.md` first): (modify) UI-consumption notes

## Impact

- **Frontend**: `pr-status-line.tsx` (`statusDotState` two-family ladder,
  `PHASE_HUE` reworked to palette v3 + halo token), `status-dot.tsx`
  (additive halo rendering, aria),
  `status-dot-tip.tsx`, `sidebar/window-row.tsx` (cluster removal),
  `sidebar/status-panel.tsx` (register view), sidebar session row + Cockpit
  server tiles + board page (badges/seam), command palette registration,
  `lib/format.ts` (`getWindowDuration` rescope), `globals.css` (pulse keyframes
  under the rk-* discipline), `types.ts`.
- **Backend**: push-on-waiting episode watcher at the SSE assembly seam;
  possible prstatus retention tweak (D2).
- **Tests**: unit tests for the new ladder (all 15 decision-table rows are
  enumerable cases), rollup counting, episode dedupe; e2e for row minimalism +
  register panel + palette action, each with `.spec.md` companions
  (Constitution — Test Companion Docs). Run via `just` recipes only.
- **Docs**: spec already merged (#316); this change implements it. Update spec
  `[target]` markers to `[current]` where landed, as part of hydrate. Public
  docs in scope per §9: `docs/site/status-dot.md` + `docs/img/status-dot-matrix.svg`.
- **Depends on**: #314 and #316 merged into main (branch the implementation
  from updated main).

## Open Questions

*(none — the spec + the discussion resolved the design; residual choices are graded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Row Minimalism: remove stage word + duration from window rows; StatusDot is the row's only status signal | User: "agreed. do it." after explicit evaluation; spec section marked [decided] | S:90 R:75 A:90 D:90 |
| 2 | Certain | PANE panel = four orthogonal register lines (L0/L1/L2/L3), never collapsed | User's own framing: "keep them orthogonal, separate, so we can mentally derive the status dot" | S:90 R:80 A:90 D:90 |
| 3 | Certain | Waiting = additive constant-yellow pulsing halo; core hue + shape untouched; reduced-motion static yellow ring | Explicitly iterated with user (hue-flip and self-colored halo both rejected on-screen); "Palette v3 + additive yellow blessed" | S:90 R:80 A:90 D:90 |
| 4 | Certain | Palette v3 two-family hues: cool = fab (blue/green/purple), warm = ad-hoc agent (yellow/orange), gray floor; D1 = per-family PR ownership, plain pane's PR never owns the dot | User proposed the two-journey structure and blessed the family assignment after demo review | S:90 R:75 A:90 D:85 |
| 5 | Confident | Exact color tokens (yellow-400/orange-400 vs adjusted shades) picked at implementation with a visual check vs all six core hues | Spec pins the families and glance semantics; token tuning is a decides-and-records detail | S:65 R:90 A:80 D:75 |
| 6 | Confident | Push rule: sustained ≥15s, one per episode, epoch-keyed dedupe, in-memory only | Spec § Attention Propagation; mirrors existing collector patterns; thresholds tunable later | S:70 R:80 A:75 D:70 |
| 7 | Confident | D2 is verify-then-implement: read #314's prstatus first, then apply grace-window + closed-PR-fallback only as needed | Explicitly flagged in the spec as needing verification; agent-answerable by reading code | S:60 R:70 A:80 D:65 |
| 8 | Confident | Palette action navigates (selects/focuses) the next waiting window, cycling current server first | Spec names the action and Constitution V motivates it; exact focus semantics follow existing palette nav patterns | S:60 R:85 A:75 D:70 |
| 9 | Certain | `stuck` overlay (slow pulse on idle-too-long) and `@rk_agent_msg` question text are OUT — future tenants only | Spec marks both "not v1"; keeps this change's surface bounded | S:75 R:90 A:85 D:80 |
| 10 | Confident | Session-tile grid + pane-panel header get the waiting treatment for free via the shared StatusDot; no tile-specific work | All three surfaces mount the same component; spec relies on this | S:65 R:85 A:85 D:75 |

| 11 | Certain | `docs/site/status-dot.md` + `docs/img/status-dot-matrix.svg` are updated within this change (not deferred to hydrate) | Explicit user instruction during intake: "as a part of this change you also need to update" both | S:90 R:90 A:85 D:90 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
