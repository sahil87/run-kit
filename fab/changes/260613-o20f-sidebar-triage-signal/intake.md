# Intake: Sidebar Triage Signal

**Change**: 260613-o20f-sidebar-triage-signal
**Created**: 2026-06-13

## Origin

> Sidebar Wave 1 change A (sidebar-triage-signal) from backlog o20f. Wire already-transmitted
> needs-attention fields to the existing red token: `fabDisplayState==="failed"` should render
> fab-stage text (and/or activity dot) in `text-red-400` (window-row.tsx:229 only special-cases
> "done" today, so "failed" looks identical to healthy); AND flag PR failure with a small red
> dot/glyph reusing `isFailish` (`prChecks==="fail"||prReview==="changes_requested"`) from
> pr-status-line.tsx — NOT the full PR line (deliberately removed from rows in 260610-obky, keep
> tree compact). Files: window-row.tsx + window-row.test.tsx. Context: docs/memory/run-kit/ui-patterns.md "## Sidebar".

One-shot invocation via `/fab-new` with a backlog ID (`o20f`). This is change **A** of the Wave 1
sidebar triage trio (`[A]` triage-signal, `[B]` drawer-a11y, `[C]` palette-window-switch) — the
three are dependency-free and ship independently. Coordination note from the backlog: **land A
before Wave 2** because both touch `window-row.tsx`; B and C are orthogonal.

No prior `/fab-discuss` conversation preceded this invocation — the backlog entry is the sole
source of design intent, and it is detailed enough to resolve most decisions directly.

## Why

**Problem.** The sidebar window tree already receives two needs-attention signals over SSE but
renders neither distinctly:

1. `fabDisplayState === "failed"` — a fab pipeline stage that failed (e.g., a review or apply
   stage bounced). Today `window-row.tsx:229` only special-cases `"done"` (the quiet-parked-row
   policy from `260612-epqk`); every *other* value — including `"failed"` — falls through to the
   identical `text-text-secondary` stage text. A failed change looks exactly like a healthy
   in-progress one.
2. PR failure — `prChecks === "fail"` or `prReview === "changes_requested"`. The full
   `PrStatusLine` was deliberately removed from sidebar rows in `260610-obky`
   (relocated to the Pane panel's `pr` row) to keep the tree compact, so there is currently **zero**
   PR-trouble signal anywhere in the tree.

**Consequence if unfixed.** The sidebar is the operator's primary triage surface (it's the always-
visible nav tree across many sessions/windows). Without a distinct red token, an operator scanning
the tree cannot tell which windows need attention — they must open each Pane panel to discover a
failed stage or a broken PR. That defeats the purpose of an at-a-glance tree and is exactly the
friction this Wave 1 batch targets.

**Why this approach.** The data is *already transmitted* (`WindowInfo.fabDisplayState`,
`.prChecks`, `.prReview` all exist on the type and arrive via SSE) and the red token already exists
(`text-red-400`, used by `PrStatusLine`'s fail-ish branch and the kill-icon hover). So the change is
pure presentation: map fields the row already has to a color/glyph it already uses. No new SSE
fields, no backend change, no new PR-status surface (which `260610-obky` deliberately removed). The
single-source-of-truth predicate `isFailish` already encodes the exact PR-fail condition the backlog
names — reusing it (rather than re-deriving the boolean inline) keeps the row and the
`PrStatusLine`/Pane-panel in lockstep if the fail definition ever changes.

## What Changes

Two presentational signals added to `WindowRow` (`app/frontend/src/components/sidebar/window-row.tsx`),
plus a one-line export change in `pr-status-line.tsx` to share the predicate, plus new unit tests.
The row stays a single compact line — no `PrStatusLine` returns.

### 1. Failed fab stage → red stage text

Today (window-row.tsx:229-233):

```tsx
{win.fabStage && win.fabDisplayState !== "done" && (
  <span className="text-xs text-text-secondary">
    {win.fabStage}
  </span>
)}
```

The gate stays identical (still suppressed when `"done"` — the quiet-parked-row policy is
untouched). Only the **color token** becomes conditional: when `fabDisplayState === "failed"`, the
stage text renders in `text-red-400` instead of `text-text-secondary`:

```tsx
{win.fabStage && win.fabDisplayState !== "done" && (
  <span className={`text-xs ${win.fabDisplayState === "failed" ? "text-red-400" : "text-text-secondary"}`}>
    {win.fabStage}
  </span>
)}
```

This is the minimal, surgical edit. The compatibility fallthrough is preserved: any value other than
`"done"`/`"failed"` (including `null`/absent for fab < 2.1.7, and unknown future values) keeps
`text-text-secondary`.

**Activity dot — included as a secondary signal.** The backlog says "fab-stage text (and/or activity
dot)". The activity dot (window-row.tsx:198-205) is currently hard-pinned to
`text-text-secondary` via its className. A failed stage is most legible when *both* the dot and the
stage text turn red — the dot is visible even when the stage text is absent (quiet/short rows) and
even when the window scrolls such that only the left edge is in view. Plan: when
`fabDisplayState === "failed"`, swap the dot's `text-text-secondary` for `text-red-400` (the dot
draws via `currentColor` for both its border and fill, so the color token flows through without
touching the inline `style`). The dot's existing `isActiveWindow` ring logic and shape (filled vs.
hollow) are untouched. See Assumption #2 — this is a Tentative call worth a `/fab-clarify` glance.

### 2. PR failure → small red glyph

A new small red dot/glyph appears in the right cluster (window-row.tsx:223 `<span className="flex
items-center gap-1.5 shrink-0">`) when the window's PR is in trouble. The condition reuses
`isFailish` exactly:

```ts
// pr-status-line.tsx (already exists, currently module-private):
function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}
```

**Reuse mechanism — export the predicate.** `isFailish` is currently a module-private function in
`pr-status-line.tsx:29`. To reuse it without duplicating the fail definition (single source of
truth — the whole point of the backlog's "reusing isFailish" instruction), change line 29 to
`export function isFailish(...)` and import it in `window-row.tsx`:

```tsx
import { isFailish } from "@/components/pr-status-line";
```

Then render a small red glyph, gated so it only appears for change-bound windows that actually have
a PR (mirroring `PrStatusLine`'s own `if (!win.fabChange || !win.prNumber) return null` gate — a
window with no PR has `prChecks`/`prReview` of `"none"`/absent, so `isFailish` is already false, but
gating on `prNumber` is the explicit, readable guard and avoids a stray glyph on edge data):

```tsx
{win.prNumber && isFailish(win) && (
  <span className="text-xs text-red-400 shrink-0" aria-label="PR needs attention" title="PR checks failing or changes requested">
    ●
  </span>
)}
```

**Glyph choice.** A filled red bullet `●` (U+25CF) matches the existing `PrStatusLine` state-glyph
vocabulary (`stateGlyph` returns `●` for open PRs) and the activity-dot dot motif — it reads as "PR
dot, but red = trouble". It is rendered in the right cluster *before* the stage text and duration so
the needs-attention signals group at the same edge. It carries an `aria-label`/`title` because,
unlike the stage text (which has visible text), a bare glyph needs an accessible name. See
Assumption #3 for the glyph-vs-character decision and #4 for placement.

### 3. Tests (`window-row.test.tsx`)

Add a `describe` block (sibling to the existing `fab stage quiet-row policy` block). The existing
test harness (`makeWindow`, `renderRow`) already supports the needed fields — `WindowInfo` carries
`fabDisplayState`, `prChecks`, `prReview`, `prNumber`, `fabChange`. New cases:

- **Failed stage colors the stage text red**: `makeWindow({ fabStage: "review", fabDisplayState: "failed" })`
  → the `"review"` text node carries `text-red-400` (and NOT `text-text-secondary`).
- **Non-failed stage keeps secondary token**: `fabDisplayState: "active"` → stage text is
  `text-text-secondary`, not `text-red-400` (guards against the red leaking to healthy rows).
- **Failed stage colors the activity dot red** (if Assumption #2 is kept): the activity-dot span
  carries `text-red-400` when `fabDisplayState === "failed"`.
- **PR-fail glyph renders when `prChecks === "fail"`**: `makeWindow({ fabChange: "…", prNumber: 386,
  prChecks: "fail" })` → the PR-attention glyph (by `aria-label`/`title` or `text-red-400` query) is
  present.
- **PR-fail glyph renders when `prReview === "changes_requested"`**.
- **No PR-fail glyph when checks pass and review is clean** (`prChecks: "pass"`, `prReview:
  "approved"`) — guards against a false-positive glyph.
- **No PR-fail glyph when the window has no PR** (`prNumber` absent) even if some stray field is set
  — guards the `prNumber` gate.

Per the constitution's Test Companion Docs rule, unit tests (`*.test.tsx`) are **exempt** from the
`.spec.md` companion requirement (that rule applies to Playwright `*.spec.ts` only) — so no companion
doc is needed for `window-row.test.tsx`.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The `## Sidebar` → **Window rows** subsection items #1 (activity
  dot) and #2 (fab stage text) document the current color tokens. Item #2 says the stage text is
  always `text-text-secondary`; item #1 says the dot color is "always `text-text-secondary`". Both
  gain a `failed → text-red-400` clause. A new item documents the PR-fail red glyph and that it
  reuses the now-exported `isFailish`. This is a spec-level (user-visible behavior) change, so the
  memory update is warranted — it will be applied during hydrate, not now.

## Impact

- **`app/frontend/src/components/sidebar/window-row.tsx`** — primary. Two presentational additions
  (failed-stage red token on stage text + activity dot; new PR-fail glyph) plus one import.
- **`app/frontend/src/components/pr-status-line.tsx`** — one-word change: `function isFailish` →
  `export function isFailish`. No behavior change; the existing internal call site is unaffected.
  `pr-status-line.test.tsx` already exists and does not test `isFailish` directly (it tests the
  rendered line), so exporting is non-breaking.
- **`app/frontend/src/components/sidebar/window-row.test.tsx`** — new test cases (see §3).
- **No backend change.** All fields (`fabDisplayState`, `prChecks`, `prReview`, `prNumber`,
  `fabChange`) are already on `WindowInfo` (`types.ts:57-69`) and arrive via the existing SSE hub /
  `fab pane map` pipeline. Constitution II (No Database) and the SSE contract are untouched.
- **No new dependency, no new component, no new route.** Constitution IV (Minimal Surface Area) is
  satisfied — this reuses the existing red token and adds no UI chrome beyond a single glyph.
- **Risk: low.** Pure presentation in one leaf component; the gate logic for the quiet-parked-row
  policy is unchanged; fully reversible via `/fab-clarify` or a one-line revert.

## Open Questions

- Should the failed-stage red token apply to **both** the stage text and the activity dot, or just
  the stage text? (Backlog says "and/or" — leaning both for legibility; see Assumption #2.)
- Is a filled bullet `●` the right glyph for PR-fail, or would a distinct shape (e.g., `!`, a small
  triangle `▲`, or a Lucide-style SVG matching the pin icon) read better and avoid confusion with
  the activity dot? (See Assumption #3.)
- Should the PR-fail glyph sit at the left of the right-cluster (grouped with stage/duration, as
  planned) or adjacent to the activity dot on the *left* side of the row? (See Assumption #4.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `isFailish` by exporting it from `pr-status-line.tsx` (one-word `export`) and importing into `window-row.tsx`, rather than duplicating the predicate. | The backlog explicitly says "reusing isFailish"; single-source-of-truth for the fail definition is the obvious, low-risk interpretation. Export is non-breaking (existing call site unaffected, no test asserts privacy). | S:90 R:90 A:95 D:90 |
| 2 | Confident | Apply the failed → `text-red-400` token to BOTH the stage text AND the activity dot. | Backlog explicitly sanctions both ("fab-stage text (and/or activity dot)"); "both, for max legibility" is the obvious front-runner (the dot shows on quiet/short rows where stage text is absent). The dot already renders via a color token, so the swap is mechanical, and reversion is one className clause. Stage-text-only is a minor reviewer preference, not a different design. | S:65 R:88 A:75 D:72 |
| 3 | Confident | Use a filled red bullet `●` (U+25CF) as the PR-fail glyph, with an `aria-label`/`title` for accessibility. | Direct codebase precedent: `PrStatusLine`'s `stateGlyph` already uses `●` as the open-PR glyph, so this reuses an established vocabulary rather than inventing one. Trivially reversible (one character). The "could be confused with the activity dot" concern is a polish nuance resolvable at review, not a fork into incompatible designs. | S:60 R:88 A:78 D:70 |
| 4 | Confident | Place the PR-fail glyph in the right-side cluster (before stage text + duration), not on the left next to the activity dot. | The right cluster (window-row.tsx:223) already groups status signals (stage, duration); grouping needs-attention indicators there is the consistent placement and keeps the left side as pure name/identity. One obvious front-runner given existing layout. | S:60 R:85 A:75 D:70 |
| 5 | Certain | Keep the quiet-parked-row gate (`fabDisplayState !== "done"`) exactly as-is; only the color token becomes conditional on `"failed"`. | `260612-epqk` established the gate; the backlog targets the color, not the gate. A `"done"` row is parked and stays suppressed regardless. Determined by existing spec + backlog scope. | S:90 R:90 A:95 D:95 |
| 6 | Confident | Gate the PR-fail glyph on `win.prNumber` (change-bound windows with an actual PR), mirroring `PrStatusLine`'s own gate, even though `isFailish` is already false without PR data. | Explicit, readable guard; prevents a stray glyph on edge/partial data and matches the established `PrStatusLine` gating convention (`if (!win.fabChange || !win.prNumber) return null`). | S:65 R:85 A:80 D:75 |
| 7 | Certain | No `.spec.md` companion needed for `window-row.test.tsx`. | Constitution's Test Companion Docs rule exempts unit tests (`*.test.tsx`); the companion requirement is Playwright-only. | S:95 R:90 A:100 D:100 |

7 assumptions (3 certain, 4 confident, 0 tentative).
