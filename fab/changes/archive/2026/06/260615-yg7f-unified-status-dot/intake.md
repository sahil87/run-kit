# Intake: Unified Status Dot

**Change**: 260615-yg7f-unified-status-dot
**Created**: 2026-06-15

## Origin

Initiated from a `/fab-discuss` session exploring the sidebar's two dot systems. The user identified that the sidebar window row currently shows **two independent dots**:

1. **Left dot** (leading bullet, every row) — the **activity dot** (`win.activity === "active"` → filled, else hollow ring), monochrome (`text-text-secondary`, red only when `fabDisplayState === "failed"`). Source: `app/frontend/src/components/sidebar/window-row.tsx:251-258`.
2. **Right dot** (only on change-bound windows with a PR) — the **PR traffic-light dot** (`prDotState` → merged/fail/pending/healthy/neutral → purple/red/yellow/green/hollow). Source: `window-row.tsx:290-306`, driven by exports in `pr-status-line.tsx`.

User feedback, verbatim across the conversation:
> "The dots on the left - don't help."
> "I know purple dots work - and they actually the most useful."
> "What can happen is we unify both activity and pr status as a single 'status' dot. And that dot gets used at both places - the left panel and the dashboard."

The user also observed that the **dashboard** renders the activity signal differently from the sidebar — confirmed in code: `dashboard.tsx:130-134` uses `bg-accent-green` (green) for active and `bg-text-secondary/40` for idle, whereas the sidebar uses monochrome fill-vs-ring. The user wants the colors to match across surfaces, which falls out for free once both render the same component.

Interaction mode: conversational (multi-turn `/fab-discuss`). Design decisions were resolved via three `AskUserQuestion` rounds — recorded as Certain/Confident assumptions below.

This change builds directly on two recently-merged PRs:
- **#267** (`260615-2olv-pr-status-dot-traffic-light`) — added the 5-state sidebar PR dot.
- **#268** (`14828c4`, `match PR status colors across dashboard, sidebar, and pane panel`) — unified the PR **color vocabulary** (`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `PR_DOT_COLOR` in `pr-status-line.tsx`). This change is the natural next step: #268 unified the *colors*; this unifies the *dot component itself* and extends it to subsume activity.

## Why

**Problem.** The sidebar carries two dots per row with different meanings, different color systems, and different positions. The user finds the left (activity) dot low-value and the right (PR) dot high-value — but the high-value one sits in the secondary (right, hover-adjacent) position while the low-value one occupies the primary scan anchor (left). Meanwhile the dashboard renders activity in a *third* style (green fill), so "active" looks different on the dashboard than in the sidebar, and "green" means two different things depending on surface (active terminal vs. healthy PR).

**Consequence if unfixed.** The most useful signal (PR lifecycle, especially the purple "merged" dot) stays visually subordinated; the color vocabulary stays ambiguous (green = active OR healthy); and the activity rendering stays inconsistent between sidebar and dashboard. Every future surface that wants "the window's status at a glance" must re-derive the precedence and re-pick colors, risking further drift.

**Why this approach (single `StatusDot` component) over alternatives.**
- *Considered: straight swap (PR dot to left, activity dot to right).* Rejected — keeps two dots and two code paths; doesn't fix the dashboard inconsistency.
- *Considered: drop activity entirely, PR-dot-only on left.* Rejected — loses the active/idle signal on non-PR windows, which is most windows.
- **Chosen: one `StatusDot` with a single precedence rule, reused on all three surfaces.** One source of truth for "what does this window's dot look like." PR status wins when present; activity is the fallback. Because the same component renders everywhere, the dashboard↔sidebar color match is automatic, and the color vocabulary becomes unambiguous (all color = PR meaning; activity is shape-only).

## What Changes

### 1. New `statusDotState` precedence helper (in `pr-status-line.tsx`)

A single function deciding what the unified dot shows, colocated with the existing `prDotState` / `PR_DOT_COLOR` / `isFailish` (so the "fail" definition stays one source of truth):

```ts
// PR status wins when the window is change-bound AND has a PR; otherwise the
// dot falls back to the window's terminal activity. One dot, one meaning at a
// time — durable PR lifecycle dominates transient activity.
export type StatusDotState =
  | { kind: "pr"; pr: PrDotState }            // merged | fail | pending | healthy | neutral
  | { kind: "activity"; active: boolean };    // active=filled, idle=hollow ring

export function statusDotState(win: WindowInfo): StatusDotState {
  if (win.fabChange && win.prNumber) return { kind: "pr", pr: prDotState(win) };
  return { kind: "activity", active: win.activity === "active" };
}
```

The PR gate (`fabChange && prNumber`) is identical to the existing gate used by `prDotState` callers and the backend attach gate (`sse.go:365`) — single source of truth.

### 2. New `StatusDot` component (new file `app/frontend/src/components/status-dot.tsx`)

A small presentational component rendering the unified dot from `statusDotState(win)`. Encodes the agreed visual rules:

- **PR states** render exactly as the current sidebar PR dot does today (`window-row.tsx:290-306`): the four "live" states (`merged`/`fail`/`pending`/`healthy`) render a solid `●` glyph in their `PR_DOT_COLOR` token (purple/red/yellow/green); `neutral` renders a dim hollow ring (`text-text-secondary`, 1.5px border, transparent fill).
- **Activity fallback** is **monochrome fill-vs-ring** (NO green): `active` → gray (`text-text-secondary`) **filled** dot; `idle` → gray **hollow ring** (the same border+transparent technique as `neutral` and as today's activity dot). All color is reserved for PR meaning so green/purple/red/yellow are never ambiguous.
- **Accessibility**: the dot always carries an `aria-label` + `title`. For PR states, reuse `PR_DOT_LABEL`. For activity states, use `"active"` / `"idle"` (matching today's `aria-label={win.activity}`). Color is never the sole channel (colorblind a11y + Constitution V).
- The existing `fabDisplayState === "failed"` red-tint on the activity dot (`window-row.tsx:252`) is preserved for the **activity** branch: a window whose fab change failed shows its activity dot in `text-red-400`. (PR-branch dots already carry their own color, so the override applies only to the activity fallback.)

Visual summary table (the agreed design):

| Window state | Dot | Color | Glyph |
|---|---|---|---|
| PR merged | ● | purple (`text-purple-400`) | solid |
| PR fail (checks fail / changes requested) | ● | red (`text-red-400`) | solid |
| PR pending (checks running) | ● | yellow (`text-yellow-400`) | solid |
| PR healthy (checks pass) | ● | green (`text-accent-green`) | solid |
| PR neutral (open, no signal) | ○ | dim gray | hollow ring |
| No PR, active | ● | gray (`text-text-secondary`) | filled |
| No PR, idle | ○ | gray | hollow ring |
| No PR, idle, fab failed | ○ | red (`text-red-400`) | hollow ring |

### 3. Sidebar `window-row.tsx` — collapse two dots into one `StatusDot`

- **Remove** the separate right-side PR dot block (`window-row.tsx:290-306`).
- **Replace** the left activity dot (`window-row.tsx:251-258`) with `<StatusDot win={win} />`.
- Net effect: one dot in the left/leading position. For a change-bound-with-PR window it shows PR status (so purple "merged" now lands in the high-attention left anchor); for every other window it shows monochrome activity exactly as before. The `aria-label`/`title` semantics carry over.
- Net behavior matches the user's "option 3, generalized": the left slot is PR-if-present-else-activity, and the activity dot is simply not shown separately for PR windows (it's superseded, not duplicated).

### 4. Dashboard `dashboard.tsx` — use `StatusDot`, drop the active/idle word

- **Replace** the inline green/gray activity dot (`dashboard.tsx:129-136`) with `<StatusDot win={win} />`.
- **Drop the activity word** (`{win.activity}` text at `dashboard.tsx:137-140`) per the "dot-only on both" decision — but **keep the idle duration** (`{duration && ...}`) since it's distinct information, and keep it readable (the dot's `title`/`aria-label` carries "active"/"idle" for the removed word).
- Result: the dashboard card's status indicator is now byte-identical in appearance to the sidebar's, and a window's PR status (including purple merged) appears on the dashboard card's status dot — which today shows only activity.

### 5. Pane panel `status-panel.tsx` — add `StatusDot` to the panel header

The pane panel is a multi-row detail view (`tmx/cwd/git/pr/run/agt/fab` rows), where PR (`pr` row) and activity (`run` row) are already **separate rows** spelling out the full status. A summary dot in the body would restate those rows, so the dot goes in the **panel header** instead: render `<StatusDot win={win} />` in the `WindowPanel` `headerRight` (`status-panel.tsx:116-120`), immediately before `{win.name}`:

```tsx
const headerRight = win ? (
  <span className="flex items-center gap-1.5 truncate text-text-secondary font-mono">
    <StatusDot win={win} />
    {win.name}
  </span>
) : null;
```

Rationale: the header is the panel's one at-a-glance slot — it matches the dot's role on the sidebar/dashboard, and (because `CollapsiblePanel` keeps `headerRight` visible when collapsed) the window's status stays glanceable even when the detail rows are hidden. The existing `pr`/`run` detail rows are left untouched — they're the full-detail view; the header dot is the summary. No new body row is added (the panel stays at its current row count). <!-- clarified: pane-panel placement resolved to the panel header (headerRight, next to win.name) via AskUserQuestion — chosen over a new body row (redundant with pr/run rows) and over skipping the panel -->

### 6. Tests

- **New** `status-dot.test.tsx` — unit test the precedence (`statusDotState`) and rendering for each state: PR-present cases (all 5 `prDotState` outcomes), activity fallback (active filled / idle ring), the fab-failed red activity tint, and the a11y label per state.
- **Update** `window-row.test.tsx` (if it asserts the old two-dot structure) to the single-dot structure, conforming tests to the new spec (Constitution § Test Integrity).
- **Update** `pr-status-line.test.tsx` only if shared exports move; the existing `prDotState`/`PR_DOT_COLOR` tests stay valid (the component reuses them).
- Consider a Playwright e2e assertion (+ companion `.spec.md`) that a PR window shows the colored dot in the sidebar/dashboard, if an existing PR-dot spec can be extended.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The sidebar Window-rows section (two-dot description — activity dot + PR traffic-light dot), the Dashboard window-cards section (green activity dot), the Pane panel section, and the PR Status section all describe the per-surface dot rendering. After this change they share one `StatusDot` component with a `statusDotState` precedence (PR-wins-else-activity, monochrome activity fallback). Document the new component, the precedence rule, and the "all color = PR meaning, activity = shape-only" vocabulary.

## Impact

- **Frontend only.** No backend, API, SSE, or tmux changes — all required data (`win.activity`, `win.fabChange`, `win.prNumber`, `win.prState`, `win.prChecks`, `win.prReview`, `win.fabDisplayState`) is already on `WindowInfo` and already flows through SSE.
- **New file**: `app/frontend/src/components/status-dot.tsx` (+ `status-dot.test.tsx`).
- **Modified**: `app/frontend/src/components/sidebar/window-row.tsx`, `app/frontend/src/components/dashboard.tsx`, `app/frontend/src/components/sidebar/status-panel.tsx`, `app/frontend/src/components/pr-status-line.tsx` (add `statusDotState` + `StatusDotState` export).
- **Builds on** #268's shared color vocabulary (`PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`/`PR_DOT_COLOR`) — no new color tokens, no new hex (Constitution / code-quality anti-pattern: magic colors).
- **Keyboard/command-palette**: no new actions (the dot is a display affordance, not an action), so no Constitution V palette-registration obligation.
- **Risk**: low blast radius — presentational, reversible, no data-flow change. Main risk is visual regression in the dense sidebar tree; mitigated by reusing the exact existing PR-dot and activity-dot rendering techniques.

## Open Questions

- None. The one open placement question (pane-panel `StatusDot` location) was resolved to the panel header (`headerRight`, next to `win.name`) — see § What Changes #5.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Unify activity + PR into a single `StatusDot` component reused on sidebar, dashboard, and pane panel | User stated verbatim: "unify both activity and pr status as a single 'status' dot ... used at both places - the left panel and the dashboard"; pane-panel scope chosen in AskUserQuestion round 3 | S:95 R:80 A:90 D:95 |
| 2 | Certain | Precedence: PR status wins when `fabChange && prNumber`; else fall back to activity | Directly follows from "option 3 generalized" + user calling PR the most useful signal; PR is the durable lifecycle signal, activity the transient one; gate mirrors existing `prDotState`/backend attach gate | S:90 R:75 A:95 D:90 |
| 3 | Certain | Activity fallback is monochrome fill-vs-ring (active=filled, idle=hollow ring); NO green | Chosen in AskUserQuestion round 2 ("Dashboard adopts sidebar: monochrome"); reserves all color exclusively for PR meaning so green/purple/red/yellow are unambiguous | S:95 R:85 A:90 D:95 |
| 4 | Certain | Dot-only on both sidebar and dashboard: drop the dashboard's "active"/"idle" word (keep idle duration + a11y label) | Chosen in AskUserQuestion round 2 ("Dot-only on both"); duration is distinct info so it stays; the removed word is preserved as the dot's title/aria-label | S:90 R:90 A:85 D:90 |
| 5 | Certain | Reuse #268's shared PR color vocabulary and the existing `prDotState`/`PR_DOT_COLOR`/`PR_DOT_LABEL` exports — no new color tokens | #268 already established the single source of truth; code-quality forbids magic colors; PR dot rendering is reused verbatim | S:95 R:90 A:95 D:90 |
| 6 | Confident | Preserve the `fabDisplayState === "failed"` red tint on the activity-fallback branch | Existing behavior in `window-row.tsx:252`; preserving it avoids a silent regression; applies only to the activity branch since PR dots carry their own color | S:80 R:85 A:85 D:80 |
| 7 | Confident | Frontend-only; no backend/API/SSE/tmux change | All required fields already on `WindowInfo` and flowing via SSE; verified against `dashboard.tsx`, `window-row.tsx`, `status-panel.tsx`, `pr-status-line.tsx` | S:85 R:80 A:95 D:85 |
| 8 | Certain | Pane-panel `StatusDot` goes in the panel header (`headerRight`, before `win.name`), not a new body row | Resolved via AskUserQuestion: chosen over a redundant body row and over skipping the panel; header is the panel's at-a-glance slot and survives collapse | S:90 R:80 A:85 D:95 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
