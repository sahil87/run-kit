# Intake: StatusDot — Shape = Liveness, Failed → Red-Center Overlay

**Change**: 260903-18ot-statusdot-shape-liveness-overlays
**Created**: 2026-09-03

## Origin

A `/fab-discuss` design session (2026-09-03), dispatched promptlessly (defer-and-surface). The
user observed live that solid dots render for windows whose agent is not working: window
`runKit:ipad-ui-review` showed a green SOLID while its single claude pane carried
`@rk_pane_agent_state = idle:...` for ~7 hours — because today's `fabShape` reads
`fabDisplayState` stage bookkeeping, not liveness. The user proposed linking shape solely to
agent status and questioned the third `failed` shape. An adversarial review then hardened the
proposal; its must-fix findings (L0 poisoning of journey hues, colorblind silhouette for failure,
failure-salience footprint) are folded into the decisions below.

> Rework the StatusDot's shape channel and failure encoding, superseding parts of the shipped
> compositional vocabulary (260810-aqo6). Shape = liveness (2 shapes); `failed` retired as a shape
> and decomposed into an additive red-center overlay (bullseye over solid); waiting = ring + halo;
> PR glyph channel completely untouched.

**Design authority for the target state**: `docs/img/status-dot-reference.svg` — **already
rewritten in this worktree to the final v2 (hardened) design** (uncommitted). Treat it as the
binding visual reference; do NOT re-derive or redraw it. Carry it in this change's commit.

All nine numbered decisions below were made by the user in-session — treat them as fixed.

## Why

1. **The pain**: `fabShape` maps `fabDisplayState` (`active`/`ready` → solid) — pipeline stage
   bookkeeping — so a fab window at a stage marked `active` renders a solid "work happening" dot
   even when its agent has been idle for hours (the `ipad-ui-review` case). Solid currently means
   "a stage is marked active", not "anything is running". The most load-bearing glance question —
   *is anyone working right now?* — is answered wrongly.
2. **The consequence if unfixed**: stale-active stages read healthy forever; users learn to
   distrust the solid shape, which degrades the whole compositional vocabulary (shape is supposed
   to mean the same thing in every hue).
3. **Why this approach**: `@rk_pane_agent_state` is PID-reconciled (a dead agent's value is
   cleared server-side), so the rolled-up `agentState` is the one liveness signal that cannot
   outlive the process. Tying shape to it makes solid physically honest. The third `failed` shape
   is then decomposed into an additive overlay (like the waiting halo), which *adds*
   expressiveness: failure state and liveness become orthogonal, so "failed, nobody on it — act"
   (ring + red center) and "failed, rework agent live" (bullseye) are distinct at a glance.
   Rejected alternatives (explicit, from the session): moving review-failure to the PR glyph
   (a `review`-stage failure is pre-PR — the glyph is gated on an owned PR, so the failure would
   be invisible; and review-pr-failed is fab's verdict, not GitHub's — dot-red = *my pipeline
   failed here*, glyph-red = *the PR is failing/closed on GitHub*); keeping the third shape.

## What Changes

### Target vocabulary (the v2 model — matches the SVG)

- **Shape = liveness, 2 shapes** (was 3). **solid** = work happening NOW; **ring** = at rest
  (no live worker · idle agent · waiting agent · parked done · quiet shell). Same meaning in
  every hue.
- **Per-family shape source** (adversarial finding — L0 poisoning): journey hues (blue · green ·
  yellow) read the window's rolled-up `agentState` ONLY — absent/stale ⇒ ring. The
  output-flowing (L0 `activity`) fallback is the gray floor's ALONE. A dev server flowing output
  in a fab worktree must NOT render solid. Accepted cost: an uninstrumented agent on a fab window
  reads ring.
- **`failed` shape retired — decomposed into an additive red-center OVERLAY** (like the waiting
  halo): a small red center dot flags review / review-pr failure (`fabDisplayState === "failed"`;
  fab hues only in practice — the only dot-red). Over a RING: red center inside the hollow ring.
  Over a SOLID: a **bullseye** — a dark gap ring cut between fill and red center, so failure
  changes the silhouette and is never color alone (colorblind a11y — must-fix adversarial
  finding). New expressiveness: ring + center = "failed, nobody on it — act"; solid + center
  (bullseye) = "failed, rework agent live".
- **Flagged (red-center) dots keep the 9px footprint** with the ~3px red center (today's
  failed-dot geometry: `w-[9px]`, 3px center; normal dots stay `DOT_SIZE` 7px) — failure salience
  must not drop (adversarial finding 3).
- **waiting = ring + halo**: a waiting agent is blocked, therefore at rest — the constant-yellow
  halo wraps a RING (changes shipped decision-table row 5, which renders waiting as solid + halo).
  Halo mechanics unchanged (`rk-waiting-halo` box-shadow, reduced-motion static ring).
- **PR glyph channel completely untouched** — the local/remote story split stands. Glyph
  rendering must be byte-identical to today (`prOwnsGlyph`, `prGlyphColor`, `prGlyphIcon`, the
  six-state table).
- **Solid is not proof of progress** (softened staleness claim): solid cannot outlive the process
  (PID reconciler) but a live-but-wedged agent stays solid until the future `stuck` overlay
  (already reserved in the spec) exists. Known residual, accepted — document it, don't fix it.
- **Known accepted costs (document, don't fix)**: (a) native/headless dispatch topology — real
  pipeline work with no live agent in the change's window reads ring; the hover-card `fab`
  register disambiguates. (b) window rollup is one value (`waiting > active > idle`) — a two-pane
  window with one waiting + one active agent rolls to waiting ⇒ ring + halo.

### docs/img/status-dot-reference.svg

Already at target in the worktree (`git status` shows it modified). No edits — just carry it in
the change. Its strips are the binding reference: strip 2 "SHAPE = liveness (2)", strip 3
"OVERLAYS = additive flags (2 — failed red-center + waiting halo)", composed examples including
`failed — act`, `failed · rework live` (bullseye), `failed · asking` (ring + center + halo),
`intake · asking` (ring + halo), floor `build running` (gray solid).

### docs/site/status-dot.md

Rewrite the prose to match the SVG:

- Shape strip becomes **2 shapes = liveness**, with the per-family source rule stated explicitly
  (journey hues read `agentState` only, absent ⇒ ring; output is the floor's signal alone).
- New **overlays strip**: red center + waiting halo as the two additive flags (never a tier,
  never destructive); failed-over-solid = bullseye silhouette; flagged dots keep the 9px
  footprint; waiting wraps a ring ("blocked is at rest by definition").
- Update the composed-examples table (mirror the SVG's example row), "Where red appears" (red
  center is an overlay, not a shape), the Row-Minimalism survival table's failed entry
  ("failed-red stage text" → survives as the red-center overlay, with liveness readable from the
  base shape), and the aria-label examples (see label section below).
- Provenance footer: this change supersedes parts of `260810-aqo6-statusdot-compositional-vocabulary`
  (the 3-shape vocabulary and shape-from-displayState), which itself superseded palette v3.

### docs/specs/status-pyramid.md

- **Channel model shape row**: solid (work happening now) · ring (at rest); failed moves to the
  Animation/overlay row's family — restate the overlay channel as carrying TWO additive flags
  (waiting halo, failed red-center), or give the red-center flag its own overlay row; either way
  shape has 2 values and failure is an overlay.
- **Tier ladder**: state the per-family shape source (journey hues ← rolled `agentState`, absent
  ⇒ ring; floor ← L0 activity), and that `fabDisplayState` now contributes only the blue/green
  phase via `fabStage`, the fab-ownership gate (`skipped` fall-through unchanged), and the failed
  overlay flag.
- **Decision table**: rework the affected rows — esp. row 5 (ad-hoc waiting: yellow · **ring** ·
  halo), rows 11–16 (fab rows: shape from agentState, e.g. intake·active with idle agent = blue
  ring; review failed = base shape by liveness + red-center overlay; row 16 = ring/solid + center
  + halo), row 20 (parked done stays green ring; "live" solid now means a live agent, not a live
  stage). Sweep every other row's shape column against the new source rule.
- **What-wins-when fact #3** ("agent state never surfaces in the dot on fab windows"): mark
  **superseded** with rationale — solid = physically live (PID-reconciled) beats solid =
  bookkeeping stage-active; a stale-active stage must stop reading healthy.
- **Duration/attention sections**: update references to the failed *shape* (e.g. "a review-failed
  window keeps its blue failed shape" → keeps its red-center flag over whichever base shape its
  liveness gives) and the § Attention "core hue AND shape are kept" wording (still true — the
  halo remains additive; the waiting *state* itself now implies the ring base).
- Keep the superseded-palette-v3 history block; add the aqo6-shape-channel supersession alongside
  it (the spec's convention is to record superseded vocabulary inline).

### app/frontend/src/components/pr-status-model.ts

- `DotShape` narrows to `"ring" | "solid"`; `StatusDotState` gains a `failed?: boolean` overlay
  flag alongside `waiting?` (failed is an overlay, composed with either shape — mirror the
  waiting flag's shape).
- `fabShape(displayState)` is replaced/reworked: on fab windows the shape comes from the rolled
  `agentState` — **solid iff `agentState === "active"`** (mid-turn); `waiting`, `idle`, and
  absent/stale ⇒ ring (waiting is blocked = at rest per decision 5). The
  `failed` flag is `fabDisplayState === "failed"`. `skipped` fall-through and the
  `fabPhase` blue/green stage split are unchanged.
- Agent (yellow) family: same liveness rule restated — solid only mid-turn (`active`), ring for
  `waiting`/`idle` (waiting currently renders solid; this changes).
- Floor: unchanged — gray solid on `activity === "active"`, gray ring quiet; `waiting` overlay
  computation unchanged.
- Update the module's ladder doc comments (they restate the old shape source at length).

### app/frontend/src/components/status-dot.tsx

- Two base shape renderers (solid / ring) + two additive overlays (halo class, red-center flag).
- Red-center overlay rendering: over a ring — the 9px hollow ring with the ~3px `bg-signal-red`
  center (today's failed geometry, minus the dotted border → solid 1.8px-class ring border);
  over a solid — the **bullseye**: 9px filled circle, a dark gap ring cut between fill and red
  center (background-colored ring, per the SVG's `fill + bg-colored inner circle + red center`
  construction). Flagged dots render at the 9px footprint; unflagged dots stay `DOT_SIZE` 7px.
- **Implementation note (in-browser verification required)**: verify the ~1px dark gap reads at
  the real 9px scale in a browser (both themes). Approved fallback if it doesn't: a dotted 1.2px
  border on the solid fill instead of a gap ring — the silhouette changes either way, which is
  the a11y requirement.
- The dotted-border failed branch is deleted; `rk-waiting-halo` handling unchanged.

### app/frontend/src/components/status-dot-label.ts (implied by the aria-label scope)

`dotLabel` lives here (re-exported by status-dot.tsx), so the vocabulary update lands here:

- Fab status words become liveness + flag words, e.g. `"building — worker live"` (solid),
  `"PR-ready — at rest"` (ring), `"failed — rework live"` (bullseye), failed-at-rest form for
  ring + center; the waiting suffix (`— agent waiting Xm`) stays additive and unchanged.
- Agent family: a waiting agent's core no longer reads `"agent — active"` (it rendered solid);
  pick the at-rest word consistent with the new base shape (the additive waiting suffix carries
  the attention, as today).
- Derive the remaining words consistently with the three examples above and the SVG captions;
  keep the label a pure function of what the dot shows (hue word + liveness word + flags).

### README.md § "Status dots — read every window at a glance"

The README embeds the (already-updated) SVG and carries a 3-shape prose bullet
("**solid** = running/live · **ring** = at rest … · **dotted ring + red center** = failed").
Update that bullet to the 2-shapes + overlays vocabulary so the prose stops contradicting the
embedded image.

### Tests

- **Unit**: `status-dot.test.tsx` (ladder × shapes, halo, labels — the shape expectations move to
  agentState-driven; add bullseye/ring+center render cases, 9px flagged footprint, waiting=ring)
  and `pr-status-model.test.ts` (fabShape/statusDotState rework, failed flag, skipped
  fall-through, floor unchanged). `row-flyout-card.test.tsx` / `window-row.test.tsx` reference
  dot labels — sweep them.
- **e2e sweep** (project rule: removal sweeps must include `app/frontend/tests/e2e`; Playwright
  `test()` intent comments MUST be updated in the same commit per the constitution): grep the
  spec.ts files for (a) dotted-failed-shape assertions, (b) solid-on-stage-active assumptions,
  (c) waiting-solid assumptions. Known concrete hits from a pre-scan:
  - `agent-next-waiting.spec.ts` — locates the dot by aria-label
    `"agent — active — agent waiting 3m"` and its intent comment says "waiting → solid agent
    shape + additive halo"; both change (waiting → ring + new label word).
  - `row-flyout.spec.ts` — asserts the `"building — active"` label (flyout header = dotLabel);
    update to the new vocabulary.
  - `pane-register-panel.spec.ts` — fixtures a `fabDisplayState: "failed"` window; verify its
    assertions target the register text (unchanged) vs the dot (changed).
  - Sweep the rest of `tests/e2e/` for further label/shape references before ship.

### Acceptance sketch

- `ipad-ui-review`-class case: fab window at a green stage, instrumented agent stamped `idle` ⇒
  green RING (today: solid).
- Fab window, agent mid-turn (`active`) ⇒ solid in the stage hue.
- Review failed + rework agent live ⇒ bullseye (9px); review failed, agent idle/absent ⇒ 9px
  ring + red center; waiting ⇒ ring + halo (any hue); review failed + waiting ⇒ ring + center +
  halo.
- Floor unchanged: gray solid on flowing output, gray ring quiet.
- PR glyph rendering byte-identical to today.
- aria-labels compose hue word + liveness word + flags (never color/motion alone).

## Affected Memory

- `run-kit/ui/status-signals`: (modify) — the § Status Dot sections (two-family ladder, shape
  channel, failed shape → overlays, `DotShape`/`StatusDotState` impl symbols, dotLabel
  vocabulary, test inventory) all restate the aqo6 3-shape model and must move to the v2
  liveness/overlay model; record the aqo6 partial supersession.

## Impact

- **Frontend only** — no backend/Go changes. The dot's inputs (`agentState`, `fabChange`,
  `fabStage`, `fabDisplayState`, `activity` on `WindowInfo` via SSE) already exist; this is a
  pure re-mapping of inputs → rendering. The PID reconciler, rollup, and D2 glyph derivation are
  untouched.
- Files: `app/frontend/src/components/pr-status-model.ts`, `status-dot.tsx`,
  `status-dot-label.ts`, their unit tests (+ `row-flyout-card.test.tsx` / `window-row.test.tsx`
  label references), swept e2e specs in `app/frontend/tests/e2e/`, `docs/site/status-dot.md`,
  `docs/specs/status-pyramid.md`, `README.md`, and the already-modified
  `docs/img/status-dot-reference.svg`.
- Downstream dot consumers (`sidebar/registers.ts`, `sidebar/row-flyout-card.tsx`,
  `session-tiles.tsx`, the desktop status bar's `agt` segment, pane-panel header) render via
  `statusDotState`/`dotLabel`/`StatusDot` and pick the change up through the shared model — no
  independent redesign expected; verify their tests in the sweep.
- Verification gates: frontend type check + `just test-frontend`; the e2e sweep specs via
  `just test-e2e "<spec>"`; in-browser check of the bullseye gap at 9px (both themes,
  fine + coarse pointer densities).

## Open Questions

- *(none — all decisions were fixed in the design session; the one open verification — bullseye
  gap legibility at 9px — has a pre-approved fallback and is an apply-time check, not a
  question.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shape = liveness, 2 shapes: solid = work happening NOW, ring = at rest — same meaning in every hue | Discussed — user decision 1, fixed in-session | S:95 R:75 A:95 D:95 |
| 2 | Certain | Per-family shape source: journey hues read rolled `agentState` only (absent/stale ⇒ ring); L0 activity fallback is the gray floor's alone | Discussed — user decision 2 (adversarial L0-poisoning finding); uninstrumented-agent-reads-ring cost accepted | S:95 R:70 A:90 D:90 |
| 3 | Certain | `failed` shape retired; failure = additive red-center overlay — red center in ring's hole, bullseye (dark gap ring) over solid so silhouette changes, never color alone | Discussed — user decision 3 + colorblind must-fix finding | S:95 R:65 A:90 D:90 |
| 4 | Certain | Flagged (red-center) dots keep the 9px footprint with ~3px center; unflagged dots stay 7px `DOT_SIZE` | Discussed — user decision 4 (failure salience must not drop) | S:95 R:90 A:95 D:95 |
| 5 | Certain | waiting = ring + halo (blocked is at rest); halo mechanics unchanged (`rk-waiting-halo`, reduced-motion static ring) | Discussed — user decision 5; supersedes shipped decision-table row 5 (waiting-solid) | S:95 R:80 A:90 D:95 |
| 6 | Certain | PR glyph channel completely untouched — byte-identical rendering; review-failure-on-glyph explicitly rejected | Discussed — user decision 6 with recorded rejection rationale | S:95 R:90 A:95 D:100 |
| 7 | Certain | status-pyramid fact #3 recorded as superseded (solid = physically live beats solid = bookkeeping stage-active) | Discussed — user decision 7, wording given | S:90 R:85 A:90 D:95 |
| 8 | Certain | Staleness claim softened: solid ≠ proof of progress; wedged-live-agent residual accepted until the reserved `stuck` overlay | Discussed — user decision 8 | S:90 R:90 A:90 D:90 |
| 9 | Certain | Accepted costs documented, not fixed: native/headless dispatch reads ring (hover `fab` register disambiguates); one-value rollup makes waiting+active roll to ring+halo | Discussed — user decision 9 | S:90 R:90 A:85 D:90 |
| 10 | Certain | Bullseye fallback pre-approved: if the ~1px gap doesn't read at 9px in-browser, use a dotted 1.2px border on the solid fill (silhouette change either way) | Discussed — fallback explicitly approved in-session | S:90 R:85 A:85 D:85 |
| 11 | Certain | Solid on fab/agent hues means agentState === "active" precisely; `waiting` and `idle` are both at rest (ring) | Follows from decisions 1+5 — the only three-state partition consistent with both | S:85 R:75 A:90 D:90 |
| 12 | Certain | `failed` becomes a `failed?: boolean` overlay flag on `StatusDotState` (mirroring `waiting?`); `DotShape` narrows to ring/solid | Description says "overlay flag composed with either shape"; the waiting flag is the established pattern in this module | S:80 R:80 A:85 D:80 |
| 13 | Certain | `status-dot-label.ts` is in scope though unnamed in the description — `dotLabel` lives there (re-exported by status-dot.tsx), so the aria vocabulary update lands there | Codebase fact — the named aria-label work has exactly one home | S:80 R:90 A:95 D:90 |
| 14 | Confident | README.md § Status dots 3-shape bullet updated to the 2-shapes + overlays vocabulary | Not in the described scope, but README embeds the already-changed SVG — leaving the prose would contradict the image; removal-sweep discipline | S:55 R:90 A:80 D:75 |
| 15 | Confident | Remaining aria-label words (beyond the three given examples) derived at apply, consistent with the examples + SVG captions (incl. the waiting-agent core word and whether "parked" survives for done) | Strong signal (3 examples + captions), fully reversible wording; exact words not enumerated in-session | S:55 R:90 A:70 D:60 |
| 16 | Confident | Downstream consumers (registers.ts, row-flyout-card, session-tiles, desktop status bar, pane panel) need no independent redesign — they render via the shared model/label/component; sweep their tests only | All consume `statusDotState`/`dotLabel`/`StatusDot` per memory + import graph; verified in the sweep | S:65 R:80 A:80 D:75 |
| 17 | Confident | e2e sweep anchors: `agent-next-waiting.spec.ts` (waiting-solid label + intent comment), `row-flyout.spec.ts` ("building — active"), `pane-register-panel.spec.ts` (failed fixture) — plus a full grep of tests/e2e before ship | Pre-scan grep hits confirmed at intake time; the residual (further un-enumerated specs) is bounded by the mandated sweep | S:70 R:85 A:80 D:65 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).
