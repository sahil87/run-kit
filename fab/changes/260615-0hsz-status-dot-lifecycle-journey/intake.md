# Intake: Status Dot Lifecycle Journey

**Change**: 260615-0hsz-status-dot-lifecycle-journey
**Created**: 2026-06-15

## Origin

Follow-on to the merged `StatusDot` (#269, `260615-yg7f-unified-status-dot`), which unified the activity dot and PR dot into one component with **PR-wins-else-activity** precedence. This change extends that into a full **lifecycle color journey** and adds the **fab pipeline** as a first-class third input.

Initiated conversationally via `/fab-discuss`. The user's asks, in sequence:
1. Add **fab pipeline status** as a third input to the dot, with colors. Precedence: **PR > fab > tmux** ("if PR status exists that takes precedence. Then if fab status exists. Then tmux status").
2. Key correction from the user (after reading the fab-kit README): fab has **two orthogonal axes** — the **stage** itself (intake/apply/review/hydrate/ship/review-pr) carries meaning, not just the stage's *status* (`display_state`). "you are considering the stage's status. Not the stage itself. The stages themselves also have meaning."
3. The user defined the color journey explicitly: "fab: intake - blue. apply, review, hydrate - amber. ship and review pr - green. this is where we would also transition to PR state. PR created - green (continues)." → a single continuous timeline where fab hands off to PR at the shipping boundary.
4. Resolved interactively (via preview iterations, see Visual Design below): **hue = stage/phase**, **shape = status**; PR becomes a **purple phase** using the *same* shape language; failed = **dashed ring + red center**; done = **rounded square**; tmux stays monochrome.
5. Also requested: preserve the resulting **stage × status matrix** as docs (chosen: a new `docs/specs/status-dot.md` spec page + committed SVG matrix).

The design was validated against a live HTML preview (served via the `rk context` iframe recipe) over several iterations until the user approved it.

## Why

**Problem.** The merged `StatusDot` only knows two inputs (PR, activity). For a fab-driven workspace, the **pipeline stage a window is in** is the single most useful at-a-glance signal — and it's currently invisible in the dot (the sidebar shows the stage *word*, but the dot itself ignores fab entirely except for a `fabDisplayState === "failed"` red tint on the activity branch). A window mid-`apply` looks identical to an idle shell.

**Consequence if unfixed.** The operator can't scan the sidebar/dashboard and see "what phase is each change in, and is it healthy" — the highest-value information for someone running many parallel fab changes. The dot wastes its prime scan-anchor position on terminal activity.

**Why this approach (one continuous color journey, two axes) over alternatives.**
- *Considered: fab = one flat color (e.g. all blue).* Rejected — collapses the stage axis the user explicitly called out as meaningful; can't distinguish intake from ship.
- *Considered: fab = full traffic-light reusing PR's red/yellow/green for status.* Rejected — yellow/green collide with PR's status meanings AND throw away the stage information.
- **Chosen: hue encodes the journey phase (blue→amber→green→purple), shape encodes status, one shape vocabulary across fab AND PR.** This uses the dot's two visual channels (hue, shape) for the two orthogonal axes. PR is not a special case — it's the final purple phase using the same shapes. The result: the dot's *color* tells you where in the lifecycle, its *shape* tells you the health, and a single learned shape language covers the whole pipeline. fab-vs-PR disambiguation falls out for free (blue/amber are fab-only, purple is PR-only, green is the deliberate shipping handoff).

## What Changes

### 1. The lifecycle model — precedence, hue (phase), shape (status)

**Precedence (which input drives the single dot):** `PR > fab > tmux`.
- PR drives the dot when the window is change-bound AND has a PR (`fabChange && prNumber`).
- Else fab drives it when the window has a fab change (`fabChange` present, with a `fabStage`/`fabDisplayState`).
- Else tmux activity drives it (plain window).

**Hue = phase** — uses the fab-kit README's canonical **4-phase grouping** (Intake / Execution / Completion / Shipping), then assigns our own palette so the journey reads blue → amber → green → purple. The README's *grouping* is honored exactly (hydrate stays its own "Completion" phase, not folded into Execution); only the *colors* differ, and Execution + Completion share amber so the rendered dots match what was approved.

| README phase | Stage(s) | Hue token | Hex (ref) |
|--------------|----------|-----------|-----------|
| Intake | `intake` | `text-blue-400` | #60a5fa |
| Execution | `apply`, `review` | `text-amber-400` | #fbbf24 |
| Completion | `hydrate` | `text-amber-400` | #fbbf24 (same as Execution) |
| Shipping | `ship`, `review-pr` | `text-accent-green` | (theme green) |
| PR | the live PR | `text-purple-400` | #c084fc |
| (none) | plain window | `text-text-secondary` | gray |

> **Palette vs. README, not grouping**: the README uses blue/amber/green/purple for Intake/Execution/Completion/Shipping. We keep its 4-phase **structure** (so `hydrate` is conceptually "Completion", distinct from "Execution") but recolor: Execution and Completion both render **amber**, Shipping renders **green**, and **purple is reserved for the PR phase** (the live PR endpoint is the more useful purple signal than purple-as-shipping). Because Execution and Completion share amber, the rendered dot for `apply`/`review`/`hydrate` is identical — the 4-phase model is an internal refinement that aligns with fab-kit's canonical structure without changing any visible dot. Document the palette mapping (not a "divergence") in the spec.

**Shape = status** — ONE vocabulary across all phases (fab stages AND PR):

| Status (`fabDisplayState` / PR equivalent) | Shape | Rendering |
|--------------------------------------------|-------|-----------|
| `pending` (PR: checks running) | ring | hollow circle, 1.8px border in phase hue, transparent fill |
| `active` / `ready` (PR: open / healthy) | solid circle | filled circle in phase hue |
| `failed` (PR: checks fail / changes requested) | **dashed ring + red center** | hollow circle, **dashed** 1.8px border in phase hue, with a small **red** (`text-red-400`) dot in the center |
| `done` (PR: merged) | rounded square | filled rounded square (`border-radius: 3px`) in phase hue |
| `skipped` (PR: closed unmerged) | gray ring | hollow ring in gray (`text-text-secondary`) |

**tmux fallback** (lowest precedence, monochrome — color reserved for the fab/PR journey):
- `active` → gray solid circle
- `idle` → gray hollow ring

**Resulting full matrix** (rows = stage/phase, cols = status):

| Stage (hue) | pending | active/ready | failed | done | skipped |
|-------------|---------|--------------|--------|------|---------|
| intake (blue) | blue ring | blue solid | blue dashed-ring + red center | blue square | gray ring |
| apply/review/hydrate (amber) | amber ring | amber solid | amber dashed-ring + red center | amber square | gray ring |
| ship/review-pr (green) | green ring | green solid | green dashed-ring + red center | green square | gray ring |
| PR (purple) | purple ring (checks pending) | purple solid (open/healthy) | purple dashed-ring + red center (failing) | purple square (merged) | gray ring (closed) |
| plain (gray) | — | gray solid (active) | — | — | gray ring (idle) |

> **Red is used in exactly one way** across the entire system: the small center dot inside a `failed` dashed ring. It is never a whole-dot color anymore (this removes the merged StatusDot's `fabDisplayState === "failed"` red-tint special case and the PR dot's old solid-red `fail` state — both become dashed-ring + red-center in their phase hue).

### 2. Precedence + state derivation (in `pr-status-line.tsx`, colocated with the existing `prDotState`/`statusDotState`)

Replace the current two-way `statusDotState` (PR | activity) with a three-way model. Suggested shape (apply may refine the exact types):

```ts
export type DotShape = "ring" | "solid" | "failed" | "done" | "skipped";
// 4-phase model matching the fab-kit README grouping, plus pr + none.
export type DotPhase = "intake" | "execution" | "completion" | "shipping" | "pr" | "none";

export type StatusDotState = {
  phase: DotPhase;     // → hue
  shape: DotShape;     // → shape
};

// fabStage → phase (README grouping): intake→intake; apply,review→execution;
// hydrate→completion; ship,review-pr→shipping
export function fabPhase(stage: string | undefined): DotPhase { /* per the table above */ }
// fabDisplayState → shape
export function fabShape(displayState: string | undefined): DotShape { /* pending|active|ready|done|failed|skipped → shape */ }
// PR fields → {phase:"pr", shape} reusing the existing prDotState semantics
// activity → {phase:"none", shape: active?"solid":"ring"}

export function statusDotState(win: WindowInfo): StatusDotState {
  if (win.fabChange && win.prNumber) return { phase: "pr", shape: prShape(win) };   // PR wins
  if (win.fabChange)                 return { phase: fabPhase(win.fabStage), shape: fabShape(win.fabDisplayState) }; // then fab
  return { phase: "none", shape: win.activity === "active" ? "solid" : "ring" };    // then tmux
}

// PHASE_HUE — execution and completion BOTH map to amber (README grouping kept,
// palette shared) so apply/review/hydrate render identically:
//   intake→text-blue-400, execution→text-amber-400, completion→text-amber-400,
//   shipping→text-accent-green, pr→text-purple-400, none→text-text-secondary
```

- **Phase → hue** and **shape → rendering** are two small lookup maps (`PHASE_HUE`, plus the shape-renderer in the component). No new hex — `text-blue-400`/`text-amber-400` are standard Tailwind classes (consistent with the existing `text-yellow-400` usage); `text-accent-green`/`text-purple-400`/`text-red-400`/`text-text-secondary` already exist in the shared vocabulary.
- The existing PR color vocabulary (`PR_STATE_COLORS` etc. from #268) is preserved for the `PrStatusLine` text line and the Pane-panel `pr` segments — those are unaffected. This change is about the **dot** only.
- `prShape(win)` maps the existing `prDotState` outcomes onto the unified shapes: merged→`done`, fail→`failed`, pending→`ring`, healthy→`solid`, neutral(open)→`solid`, closed→`skipped`. (Confirm the open-vs-neutral mapping during apply — `prDotState` currently returns `neutral` for "open, no decisive signal"; under the journey that should read as a healthy/open solid purple, with `failed`/`pending`/`done` taking precedence as today.)

### 3. `StatusDot` component (`status-dot.tsx`) — render the two-axis dot

Rewrite `StatusDot` to render from `{phase, shape}`:
- Resolve `color = PHASE_HUE[phase]`.
- Render per `shape`:
  - `ring` → `w-1.5 h-1.5 rounded-full` + `border: 1.8px solid currentColor; background: transparent`
  - `solid` → `w-1.5 h-1.5 rounded-full` + `background: currentColor; border: none`
  - `failed` → `w-1.5 h-1.5 rounded-full` + `border: 1.8px dashed currentColor; background: transparent`, with a centered child span: a ~4px `rounded-full` `bg-red-400` dot (the red center). (CSS dashed borders on a 6px circle render as a few dashes — acceptable; if it reads poorly at the real ~6px size, apply may bump the dot to 8px or use an SVG ring with `stroke-dasharray`. Flag this as a render-tuning point.)
  - `done` → `w-2 h-2 rounded-[3px]` + `background: currentColor` (rounded square; slightly larger box to read as a square)
  - `skipped` → gray `ring` (phase hue forced to `text-text-secondary`)
- **Accessibility**: every dot keeps `role="img"` + `aria-label` + `title`. Compose the label from phase + status, e.g. `"apply — active"`, `"PR — merged"`, `"review — failed"`, `"intake — pending"`, `"active"`/`"idle"` for the tmux fallback. Color is never the sole channel (Constitution V + colorblind).

### 4. Surfaces — no structural change, the component does the work

The three surfaces already call `<StatusDot win={win} />` (from #269): sidebar `window-row.tsx`, dashboard `dashboard.tsx`, pane-panel `status-panel.tsx` header. They need **no change** beyond rendering the new dot — the redesign is entirely inside `StatusDot` + `statusDotState`. Verify each still renders correctly. (The sidebar row's separate `fabStage` *text* at `window-row.tsx:286-289` stays — the dot complements it.)

### 5. Hover

Confirmed working in the merged code (the dot carries `title`+`aria-label`+`role="img"`, is the innermost element under the pointer, no `pointer-events-none`). The expanded `aria-label`/`title` (phase + status) from item 3 is the only hover-related change — richer tooltip text. No mechanism change; native `title` is acceptable (user confirmed).

### 6. Docs — new spec page + committed SVG matrix

- Create **`docs/specs/status-dot.md`**: a spec page documenting the lifecycle journey — the precedence rule, the hue=phase / shape=status model, the full stage × status matrix (as a markdown table for precision/searchability), the README-grouping-with-our-palette note (4-phase structure honored; Execution+Completion=amber, Shipping=green, PR=purple), and the "red only as a center dot" rule.
- Commit a **visual SVG** of the matrix (e.g. `docs/img/status-dot-matrix.svg` or under `docs/specs/`) embedded in the spec via `![...](...)`, mirroring how the fab-kit README commits its pipeline diagrams. The SVG renders the actual dot shapes/colors so the visual is preserved in version control and renders on GitHub.
- Add a row to **`docs/specs/index.md`** for the new spec.
- The existing HTML preview at `/tmp/rk-statusdot-preview/index.html` is the visual source of truth to translate into the SVG.

### 7. Tests

- **Update** `status-dot.test.tsx`: cover the three-way precedence (PR > fab > tmux), the `fabPhase`/`fabShape` mappings (all 6 stages, all 6 display-states), the PR-phase shape mapping (merged→done, fail→failed, etc.), the tmux fallback, and the a11y label composition per state.
- **Update** `pr-status-line.test.tsx` only if shared exports change shape (the `prDotState`/`PR_*` exports used by `PrStatusLine`/status-panel must keep working — those surfaces are unchanged).
- Conform any window-row/dashboard tests that assert the old dot structure to the new one (tests follow spec — Constitution § Test Integrity).
- Consider an e2e assertion (+ `.spec.md`) if an existing PR/fab dot spec is a clean extension point; otherwise unit coverage suffices.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The § Status Dot subsection (added by #269) currently documents the PR-or-activity two-way model. Rewrite it for the three-input lifecycle journey: precedence PR > fab > tmux, hue=phase / shape=status, the full matrix, the unified shape vocabulary (ring/solid/dashed-ring+red-center/rounded-square/gray-ring), the README 4-phase grouping with our palette (Execution+Completion=amber, Shipping=green, PR=purple), and the "red only as a failed-ring center dot" rule. Cross-reference the new `docs/specs/status-dot.md`.

## Impact

- **Frontend only.** All inputs already on `WindowInfo` and flowing via SSE: `fabChange`, `fabStage`, `fabDisplayState`, `activity`, plus the PR fields. **No backend/API/SSE/tmux change.** (Verified: `fabStage` and `fabDisplayState` are populated from `fab pane map` and confirmed to carry the 6 stage values and 6 display-state values via live `fab pane map --json`.)
- **Modified**: `app/frontend/src/components/pr-status-line.tsx` (new `statusDotState` three-way + `fabPhase`/`fabShape`/`prShape` + `PHASE_HUE`), `app/frontend/src/components/status-dot.tsx` (render the `{phase, shape}` dot incl. the new dashed-ring+red-center and rounded-square shapes), `status-dot.test.tsx`.
- **New**: `docs/specs/status-dot.md` + a committed SVG; `docs/specs/index.md` gets a row.
- **No new color tokens / no raw hex** — `text-blue-400` and `text-amber-400` are standard Tailwind classes (the one genuinely new-to-this-component classes, used the same way `text-yellow-400` already is); everything else reuses the established vocabulary. (Code-quality anti-pattern check: no magic hex.)
- **Keyboard/palette**: dot is display-only, no new actions → no Constitution V palette obligation.
- **Risk**: low blast radius — presentational, reversible, no data-flow change. Two render-tuning risks to watch in apply/review: (a) a CSS dashed border on a ~6px circle may show only 2-3 dashes — may need a size bump or an SVG ring; (b) the rounded-square "done" needs to read as a square vs. the circles at small size. Both are visual-polish, caught by the live preview / Playwright.

## Open Questions

- None blocking. Two render-tuning details (dashed-ring legibility at ~6px; square vs circle distinguishability at small size) are deferred to apply as visual polish, with the live HTML preview as the reference — recorded as Tentative below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add fab as a third input; precedence PR > fab > tmux | User stated verbatim ("if PR status exists that takes precedence. Then if fab status exists. Then tmux") | S:95 R:80 A:95 D:95 |
| 2 | Certain | Two axes: hue = phase/stage, shape = status | User's explicit correction (stage itself has meaning, not just status) + interactively confirmed via preview | S:95 R:75 A:90 D:95 |
| 3 | Certain | Phase hues: intake=blue, apply/review/hydrate=amber, ship/review-pr=green, PR=purple, none=gray | User defined the journey verbatim; PR-as-purple-phase confirmed in preview iterations | S:95 R:80 A:90 D:95 |
| 4 | Certain | One shape vocabulary across fab+PR: ring=pending, solid=active/ready, dashed-ring+red-center=failed, rounded-square=done, gray-ring=skipped/closed | Each shape chosen interactively across preview iterations; final dashed-ring + red-center for failed and rounded-square for done were explicit user requests | S:95 R:75 A:90 D:90 |
| 5 | Certain | PR is a purple phase using the same shape language (not a separate color set); red only as the failed-ring center dot | User: "make PR follow the same language, but in purple color" — removes the old solid-red PR-fail and the activity red-tint special cases | S:95 R:75 A:90 D:95 |
| 6 | Certain | tmux stays monochrome gray (color reserved for fab/PR journey) | Carried from #269; preserves "gray = no pipeline" | S:90 R:85 A:90 D:90 |
| 7 | Certain | Frontend-only; no backend/API/SSE/tmux change | All fields already on WindowInfo + SSE; verified fabStage/fabDisplayState values via live `fab pane map --json` | S:90 R:80 A:95 D:90 |
| 8 | Certain | Keep the README's 4-phase grouping (Intake/Execution/Completion/Shipping) but recolor: Execution+Completion=amber, Shipping=green, purple=PR. Document as a palette mapping | User chose to honor the README grouping (hydrate stays "Completion") and only change colors; Execution+Completion share amber so rendered dots are unchanged. Aligns with fab-kit's canonical structure — no "divergence" | S:90 R:80 A:85 D:90 |
| 9 | Confident | Preserve the existing PR color vocabulary (PR_STATE_COLORS etc.) and prDotState for PrStatusLine + Pane-panel pr segments — this change touches the DOT only | Those surfaces are out of scope and must keep working; the dot is the only redesigned element | S:85 R:80 A:90 D:85 |
| 10 | Confident | Docs: new docs/specs/status-dot.md + committed SVG matrix + specs index row | User chose this option explicitly; mirrors fab-kit's committed pipeline diagrams | S:90 R:85 A:80 D:85 |
| 11 | Tentative | Render-tuning: dashed ring may need a size bump or SVG (stroke-dasharray) to read at ~6px; rounded-square must read as a square at small size | CSS dashed border on a tiny circle shows few dashes; exact pixel tuning is a visual-polish judgment best made against the live preview during apply | S:55 R:80 A:60 D:55 |

11 assumptions (8 certain, 2 confident, 1 tentative, 0 unresolved).
