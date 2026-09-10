# Intake: Watched underbar overlay + `opr` register

**Change**: 260910-0536-watched-underbar-opr-register
**Created**: 2026-09-10

## Origin

Dispatched by `/fab-proceed` (promptless create-new) from a 2026-09-10 design discussion. The
conversation produced — and the user confirmed — the design study
`docs/wiki/watched-row-indicator-studies.html` (uncommitted on disk, already indexed in
`docs/specs/index.md`'s Wiki table; both files belong to this change and are NOT rewritten by it).
The study is the design authority; this intake carries its decisions across the boundary.

> Replace the sidebar's watched-by-operator glyph with an additive underbar on the StatusDot, and
> give "watched" a register line.
>
> The C6 clock rung (change 260907-wuiu, PR #863) added `WatchedIndicator` in
> `app/frontend/src/components/sidebar/window-row.tsx`: a 12px green `◉` glyph beside the
> `<StatusDot>` when `win.monitored` is true (`text-accent-green`, `Tip` "Watched by operator —
> {monitoredStage}", `role="img"`, `data-testid="row-watched-indicator"`, dimmed to `opacity-50
> text-text-secondary` when the session's `operatorStale` is true). It never passed through the
> StatusDot vocabulary. Against `docs/specs/status-pyramid.md` § The Channel Model it fails twice:
> it spends `accent-green` (the "PR-ready/done" hue) on a relation that is not a journey position,
> and it adds a second dot-shaped silhouette beside the dot (beside a gray floor ring a neutral ◉
> forms the failed-over-solid bullseye). The pyramid's rule: anything that is not journey or
> liveness is an additive overlay — never a hue, never a shape. "Watched" is a flag, so it must be
> an overlay. The study evaluated six placements (A0 green ◉, A1 neutral ◉, B1 orbit ring, B3
> underbar, C1 name underline, E1 nothing) across the hue × shape × overlay matrix and recommends
> B3 plus a fifth `opr` register line. Marker well explicitly out of scope.

Key decisions from the discussion (all user-confirmed): B3 underbar; neutral ink only; stale =
dimmed AND dashed; `WatchedIndicator`'s separate `role="img"`/`Tip` goes away and the dot's
`aria-label` grows a clause; a fifth register `opr` on the flyout card and the PANE panel absorbs
`WatchedLine`; the marker well is never read or written by status.

## Why

**The pain.** A sidebar row today can show a blue ring (fab building, at rest) next to a green ◉.
Green is the pyramid's "PR-ready/done" hue; the row therefore asserts two contradictory journey
positions, and the second one is not a status at all — it is the fab operator's attention set.
On the collision row (a green PR-ready ring beside the green ◉) the reader cannot tell one
PR-ready window from two. The glyph is also the largest thing in the status cluster (12px vs the
7px dot), so the relation outranks the actual status. Making it neutral does not help: a gray ◉
beside a gray floor ring reproduces the bullseye silhouette the pyramid reserves for
"failed-over-solid". Every dot channel already has an owner (core hue = journey, shape =
liveness, red center = failed, yellow halo = waiting, PR glyph = remote story, marker well =
human-declared mode × stage, headset = role identity) — the wuiu intake called the glyph
"greenfield" because `grep ◉` returned nothing, but the grid says it was never greenfield.

**If we don't fix it.** The compositional vocabulary (`docs/site/status-dot.md`,
`docs/specs/status-pyramid.md`) stops being trustworthy: the sidebar carries a hue and a
silhouette the reference does not document, and the dot stops being a pure function of its
register lines (the flyout card / PANE panel show four registers; the row shows a fifth signal
with no register). Every future overlay proposal then has a precedent for skipping the grid.

**Why this approach.** The underbar is the one placement that is additive in the pyramid's own
sense: it touches neither the dot's hue nor its shape, it occupies the one free geometric slot
(the yellow halo owns the perimeter up to 3px of box-shadow, the red center owns the middle;
above/below are unclaimed), it composes with every base state in the study's matrix without
changing the reading of the dot beneath it, and its 7×12px footprint sits inside the 24px
fine-pointer row without eating the 8px well gap. It reads as "underlined = on the list" — the
idiom a tracked item has everywhere else — and because it is the same neutral ink whatever the
dot's hue, it can never be misread as journey. Giving it an `opr` register restores the
"dot derivable from the register lines" contract and makes the dimmed (stale) state explainable
from the same card (`tick 41m ago`), not a mystery opacity.

## What Changes

### 1. `StatusDot` gains an optional `watched` register and renders the underbar

`app/frontend/src/components/status-dot.tsx`. The dot stays "a pure function of its registers":
the new input is an optional prop, absent everywhere except the sidebar window row.

```ts
export type WatchedFlag = { stale: boolean };

export function StatusDot({ win, watched }: { win: WindowInfo; watched?: WatchedFlag }) {
```

Rendering contract:

- When `watched` is undefined the component renders EXACTLY what it renders today (same
  element, same classes, same label) — the three non-sidebar mounts (`session-tiles.tsx`
  dashboard window cards, `status-panel.tsx` PANE header, `status-bar.tsx`, `surface-layout.tsx`
  tty tile header) pass nothing and are unaffected.
- When `watched` is set, the dot element is wrapped in a `relative inline-flex items-center
  justify-center shrink-0` span and a sibling bar is rendered after the dot:

```tsx
<span className="relative inline-flex items-center justify-center shrink-0">
  {dot /* the existing element, untouched: hue, shape, halo, red center */}
  <span
    aria-hidden="true"
    data-testid="status-dot-watched-bar"
    data-stale={watched.stale ? "true" : undefined}
    className={`absolute left-0 right-0 h-px text-text-secondary rk-watched-underbar${
      watched.stale ? " rk-watched-underbar-stale opacity-50" : ""
    } ${state.failed ? "-bottom-[3px]" : "-bottom-[4px]"}`}
  />
</span>
```

- Geometry (from the study's B3 CSS): a **1px** bar, **dot-width** (`left-0 right-0` on the
  wrapper, so it is 7px under an unflagged dot and 9px under a flagged one), **4px below** the
  7px dot; under the 9px flagged/failed footprint it sits at 3px so the total watched footprint
  stays ~12px tall in both cases. The waiting halo's box-shadow reaches at most 3px (globals.css
  `rk-waiting-halo` 50% keyframe) — the bar sits clear of it at 4px.
- Ink: **neutral only** — `text-text-secondary` with the bar painted from `currentColor` (see
  §2's CSS), in EVERY state and on selected rows too. NEVER `accent-green`, never the dot's hue.
- The wrapper must not clip: the halo paints outside the dot's border-box (the window-row
  comment above the dot already forbids `truncate`/`overflow-hidden` on ancestors for this
  reason); the wrapper uses no overflow rule.
- The dot's `role="img"` + `aria-label` stay on the dot element; the bar is `aria-hidden`
  decoration with no hit target of its own — the dot remains the coarse-pointer flyout tap
  target (`data-testid="status-dot-tap"` wrapper in window-row is unchanged).
- Docblock: the "TWO additive overlay flags" paragraph becomes three; the watched underbar is
  documented as the relation overlay, rendered only where the mount passes `watched` (today: the
  sidebar window row).

### 2. Stale treatment — dimmed AND dashed (globals.css utilities)

`app/frontend/src/globals.css` gains a utility pair next to `.rk-waiting-halo`:

```css
/* Watched-by-operator underbar (status-dot.tsx): a 1px neutral bar under the
   StatusDot painted from currentColor so it can never carry a journey hue.
   Stale (the operator loop's tick is overdue, `operatorStale` server-derived)
   = the note-stale opacity-50 treatment PLUS a dashed 1px-on / 2px-off
   pattern, so staleness is never encoded in opacity alone. Static — no
   animation, nothing to zero under reduced motion. */
.rk-watched-underbar { background: currentColor; }
.rk-watched-underbar-stale {
  background: repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 3px);
}
```

Add one line to the `prefers-reduced-motion` audit comment block (around globals.css:1598)
noting `.rk-watched-underbar` is static by design (the audit list convention the hazard wedge
uses). `watched.stale` comes from `ProjectSession.operatorStale`, already threaded to
`WindowRow` as the `operatorStale` prop — never recomputed client-side (Constitution X;
`types.ts` comment: "Consumers read these verbatim — never re-derive the threshold").

### 3. Accessible name — `dotLabel` grows one clause

`app/frontend/src/components/status-dot-label.ts`:

```ts
export function dotLabel(win: WindowInfo, state: StatusDotState, watched?: WatchedFlag): string
```

Composition order: core → additive waiting suffix → additive watched suffix.

| Situation | Label |
|-----------|-------|
| building, at rest, watched | `building — at rest — watched` |
| building, at rest, watched, operator loop stale | `building — at rest — watched (operator stale)` |
| agent idle, waiting 3m, watched | `agent — idle — agent waiting 3m — watched` |
| review failed, rework live, watched | `building — failed — rework live — watched` |
| floor idle shell, watched | `idle — watched` |
| anything, not watched | unchanged from today |

`status-dot.tsx` passes its `watched` prop through: `dotLabel(win, state, watched)`. The
`WatchedIndicator`'s old `aria-label` ("Watched by operator — {stage}") is retired; the stage
word lives in the `opr` register (the same "exact stage lives in the register, not the label"
rule the fab label already follows).

### 4. `window-row.tsx` — remove `WatchedIndicator`, pass `watched` to the dot

- Delete the `WatchedIndicator` component (lines ~65–85) and its render site (~907–913) plus
  the now-unused `Tip` import (the only `Tip` use in the file).
- The dot render becomes:

```tsx
<StatusDot
  win={win}
  watched={!ghost && win.monitored === true ? { stale: operatorStale } : undefined}
/>
```

  Ghost rows stay excluded exactly as `WatchedIndicator` excluded them. The wrapper span
  `data-testid="status-dot-tap"` is untouched.
- Update the comment above the dot (and the Row Minimalism comment at ~940) so the row's status
  signals read: hue = journey, shape = liveness, additive halo = waiting, additive red center =
  failed, additive underbar = watched by the operator.
- New prop `operatorLastTickAt?: number` (sibling of `operatorStale`, same doc shape: threaded
  unchanged from `ProjectSession.operatorLastTickAt`, unix seconds, 0/absent = never), used only
  to feed the flyout card's `opr` register (§5). Threaded from the three `operatorStale` sites in
  `sidebar/index.tsx` (the operator-entry builder ~2502, the pinned operator row ~2879, the tree
  row ~3059). `React.memo` on `WindowRow` still works: both are primitives.

### 5. Fifth register `opr` — flyout card + PANE panel, one shared resolver

**Resolver** (`app/frontend/src/components/sidebar/registers.ts`, the single source both
register surfaces already share):

```ts
export type OperatorLoopFacts = { stale: boolean; lastTickAt?: number };
export type OperatorParts = { head: string; facets?: string };

/** L4 `opr` register. Null unless `win.monitored === true` (degrade-to-absent,
 *  the NoteLine/WatchedLine gate). `head` leads with the decisive tokens:
 *  `watched · <monitoredStage> · tick <age> ago`; the stage segment is omitted
 *  when absent, the tick segment when `lastTickAt` is 0/absent (never ticked).
 *  `facets` = `<monitoredRepo> · <monitoredBranch>` (empty segments omitted;
 *  undefined when both absent). */
export function getOperatorParts(win: WindowInfo, operator: OperatorLoopFacts | undefined, nowSeconds: number): OperatorParts | null
```

Examples: `watched · apply · tick 2m ago` (facets `run-kit · fab/wuiu`);
`watched · review` (no tick timestamp); `watched · tick 41m ago` (no stage). Age uses the
existing `formatDuration(seconds)` from `@/lib/format` (the same helper `ClockStaleWarning` and
the cron Activity banner use for the tick age). `nowSeconds` is passed in, as `getOutputLine`
does — the resolver holds no clock.

**Flyout card** (`app/frontend/src/components/sidebar/row-flyout-card.tsx`):

- Delete `WatchedLine` (and its `row-flyout-watched-line` test id). Its data folds into the
  `opr` register.
- `WindowFlyoutContent` gains `operator?: OperatorLoopFacts`; `window-row.tsx` passes
  `{ stale: operatorStale, lastTickAt: operatorLastTickAt }`.
- Render `opr` as the LAST register, after the `pr` block (the fifth line in the
  out/agt/fab/PR/opr order, per the study's register mock), using the existing `RegisterLine`
  (`prefix="opr "`, `testid="row-flyout-opr"`) for `head` and a `ContinuationLine`
  (`testid="row-flyout-opr-facets"`) for `facets` when present — the same lead-with-decisive-
  tokens / expendable-value-continues idiom the `fab` register uses. Stale: the head text
  renders `text-text-secondary` (the dimmed note idiom) with `data-stale="true"`; not stale:
  `text-text-primary`.
- `hasBody` already includes `win.monitored`; unchanged.
- `NoteLine` is unchanged (it is also used by the pinned operator row).

**PANE panel** (`app/frontend/src/components/sidebar/status-panel.tsx`):

- `WindowPanel({ window, operator })` and `WindowContent({ win, operator })` gain
  `operator?: OperatorLoopFacts`. `BottomPanels` in `sidebar/index.tsx` already resolves the
  owning session for the route window (`sessions.find(...)`) and for the board-route fallback
  (`ctx.sessionsByServer.get(focusedPane.server)`); it derives
  `{ stale: session.operatorStale === true, lastTickAt: session.operatorLastTickAt }` from that
  session and passes it down (undefined for the thin pin-only fallback window — registers
  honestly absent, as today).
- Render after the `fab` row (the panel renders PR above the register block, so the visual
  order is PR, out, agt, fab, opr — `opr` joins as the last signal register):

```tsx
{operatorParts && (
  <div className="truncate" data-testid="register-operator" data-stale={operator?.stale ? "true" : undefined}>
    <Tip label="Operator watchlist" placement="right">
      <span className="text-text-secondary">opr </span>
    </Tip>
    <span className={operator?.stale ? "text-text-secondary" : "text-text-primary"}>
      {operatorParts.head}{operatorParts.facets ? ` · ${operatorParts.facets}` : ""}
    </span>
  </div>
)}
```

  Fixed-width 3-char key `opr` matching `out`/`agt`/`fab` (lowercase vocabulary — the panel's
  own comment lists `tmx/cwd/git/out/agt/fab/pr`; extend it). Update the "four orthogonal
  signal registers" block comment to five. No icon glyph (the L0–L2 icons are per-layer
  animated marks; the watchlist has none — keep the column aligned by the 4-advance key only,
  as the `pr` row does).

### 6. Non-goal — the marker well

The left-gutter marker (mode × stage, `@/marker`) is human-declared; derived state never writes
it and status never reads from it. No marker code is touched. The E1-plus-`auto`-chevron path
("let the auto chevron stand in for watched") is closed by the study's recorded decision.

### 7. Documentation

- `docs/specs/status-pyramid.md` § The Channel Model: the Overlays row becomes THREE additive
  flags — add the **watched underbar** (1px neutral bar 4px below the dot, sidebar window row
  only; stale = dimmed + dashed; never a hue, never a shape) and note the `opr` register in the
  Hover-card row ("the five registers"). Add a "Rejected — watched placements" note under the
  channel model listing: green ◉ (hue + silhouette collision), neutral ◉ (bullseye trap beside
  a gray ring), orbit ring at 4px (17px footprint in a 24px row, eats the well gap, third
  concentric shape), reticle ticks (noise at 7px, collide with the halo perimeter), dashed dot
  border (border style is the shape/liveness channel and was the pre-#802 failed rendering),
  marker-well texture (human-owned well), ghost headset (headset = "this row IS the operator"),
  dotted name underline (reads as a link, rides the inline-rename control — parked fallback),
  nothing on the row (zero glance surface until the agents-tile dashboard — interim fallback).
  § Row Minimalism / § Accessibility: mention the `— watched` label clause. Link the study.
- `docs/specs/cron.md`: the two "watched-row ◉ indicators" mentions (~373 and the P2 row
  ~442) → "watched-row underbar"; the § detail-line sentence (~316) → the `opr` register.
- `docs/site/status-dot.md`: § 3 overlay table gains the `watched underbar` row (rendering,
  meaning, stale form, sidebar-row-only scope); the header's "two additive overlay flags" →
  three; § Reading a row gains composed examples (`blue ring + underbar` = building, at rest,
  watched by the operator; `blue ring, yellow halo + underbar` = watched agent asking;
  `dashed dim underbar` = watched, operator loop stale); § Accessibility notes the label clause;
  the "four registers" mention → five with `opr`.
- `README.md` § Status dots: the overlays bullet lists the third overlay in one clause.
- `docs/img/status-dot-reference.svg`: the § 3 OVERLAYS legend strip gains a third row (blue
  ring with a 1px gray underbar; caption "watched underbar = on the fab operator's watchlist
  (sidebar row only) · stale: dimmed + dashed"), the "2 overlays" counts in the footer lines
  become 3. Should-fix per the discussion; accepted into scope.
- Memory (hydrate): `docs/memory/run-kit/ui/sidebar.md` (the `WatchedIndicator`/`WatchedLine`
  paragraph in the file inventory and its frontmatter "watched-row ◉ indicator" phrase),
  `docs/memory/run-kit/ui/status-signals.md` (§ Status Dot overlays, § Accessibility label
  composition, § Register resolvers — five registers, `getOperatorParts`), and
  `docs/memory/run-kit/cron.md` (the ◉ mentions at ~11 and ~440 → underbar). Comments follow
  the constitution's Test Intent Comments / code-quality "no narration, no change IDs" rules.

### 8. Tests (conform to the spec, never the reverse; run via `just` recipes only)

- `app/frontend/src/components/status-dot.test.tsx`: new describe "StatusDot — additive watched
  underbar": renders the bar (`status-dot-watched-bar`) only when `watched` is passed; the bar
  is `aria-hidden` and carries `text-text-secondary`, never `text-accent-green` or the phase
  hue; stale adds `rk-watched-underbar-stale` + `opacity-50` + `data-stale`; the base dot's
  classes/shape are identical with and without `watched` (hue and shape untouched); composes
  with the halo (both classes present) and with the flagged 9px dot (bar at `-bottom-[3px]`);
  no `watched` ⇒ zero extra DOM. `dotLabel` cases from §3's table (suffix order after the
  waiting suffix; stale phrasing).
- `sidebar/window-row.test.tsx`: replace the `WatchedIndicator (wuiu)` describe (~1727–1785)
  with: the dot carries the underbar when `win.monitored`; none when false/absent or for ghost
  rows; stale prop ⇒ stale bar; `row-watched-indicator` no longer exists; the dot's aria-label
  ends with `— watched` / `— watched (operator stale)`.
- `sidebar/registers.test.ts`: `getOperatorParts` — null when unmonitored; head/facets
  composition; omitted stage; omitted tick when `lastTickAt` is 0/undefined; age formatting.
- `sidebar/row-flyout-card.test.tsx`: replace the four `row-flyout-watched-line` tests
  (~690–722) with `row-flyout-opr` (+ `row-flyout-opr-facets`) assertions: text, position after
  the `pr` block, absent when unmonitored, stale dimming via `data-stale`.
- `sidebar/status-panel.test.tsx`: `register-operator` renders for a monitored window with the
  `opr` key, absent otherwise; stale dimming; the register-label Tip reads "Operator watchlist".
- e2e: no spec asserts `row-watched-indicator` / `row-flyout-watched-line` today (grep of
  `app/frontend/tests/e2e` confirmed), and the `monitored` join needs a fab operator state file
  the e2e rig does not stage — no new e2e spec; coverage is vitest. `just test-frontend`, then
  `just test-e2e "sidebar"`-scoped smoke to confirm no row regression, then `just build`.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) `window-row.tsx` inventory paragraph — `WatchedIndicator` ◉ →
  the StatusDot `watched` prop/underbar, `WatchedLine` → the `opr` register; frontmatter phrase
  "the watched-row ◉ indicator" → underbar; WindowPanel/BottomPanels operator-facts plumbing
- `run-kit/ui/status-signals`: (modify) § Status Dot — third additive overlay (watched
  underbar: geometry, neutral ink, stale dashed+dimmed, sidebar-row-only mount); § Accessibility
  — `dotLabel(win, state, watched)` and the `— watched` clause; § Register resolvers — five
  registers, `getOperatorParts`/`OperatorLoopFacts`; § Row-hover flyout card content — `opr`
  line replaces `WatchedLine`; Design Decisions — "watched is an additive overlay, not a hue or
  shape" (with the rejected placements) and "an overlay always has a register"
- `run-kit/cron`: (modify) the two ◉ mentions (the UI Tier-1 sentence and the "◉ marks are
  projection" Why) → the underbar + `opr` register

## Impact

- **Frontend only**: `app/frontend/src/components/status-dot.tsx`, `status-dot-label.ts`,
  `sidebar/window-row.tsx`, `sidebar/row-flyout-card.tsx`, `sidebar/status-panel.tsx`,
  `sidebar/registers.ts`, `sidebar/index.tsx` (three `operatorLastTickAt` pass-throughs + the
  `BottomPanels` operator facts), `globals.css` (two utility classes + audit comment), and the
  five test files above.
- **Backend**: none. `monitored*`, `operatorStale`, `operatorLastTickAt` already ride the
  sessions payload (`types.ts` `WindowInfo` / `ProjectSession`).
- **Retired surface**: `data-testid="row-watched-indicator"`, `row-flyout-watched-line`, the
  `WatchedIndicator` and `WatchedLine` components, the `Tip` import in window-row.
- **New test ids**: `status-dot-watched-bar`, `row-flyout-opr`, `row-flyout-opr-facets`,
  `register-operator`.
- **Other StatusDot mounts** (dashboard window cards, PANE header, status bar, tty tile header)
  render byte-identical output — `watched` is undefined there.
- **Docs**: spec (status-pyramid, cron), site (status-dot.md), README overlay bullet, the SVG
  legend; memory via hydrate.
- **Risk**: low — pure presentation on an already-derived flag; the wrapper span around the dot
  only exists on watched rows, so unwatched row layout is untouched. Verify visually at both
  themes and pointer classes during apply (`just dev` + Playwright screenshot: the 1px
  secondary-ink bar's legibility on the light theme, and the halo + bar composition).

## Open Questions

- None blocking. Verify during apply (not user decisions): the light-theme contrast of a 1px
  `text-text-secondary` bar, and that the flagged-dot bar offset (3px) reads as the same
  footprint as the unflagged offset (4px) in a real row.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Placement is B3 — a 1px neutral underbar beneath the StatusDot on the sidebar window row, replacing the green ◉ | Discussed — the study's recommendation, confirmed by the user; every alternative has a recorded rejection | S:95 R:70 A:95 D:95 |
| 2 | Certain | Neutral ink only: `text-text-secondary` painted via `currentColor`, in every state incl. selected rows; never `accent-green`, never the phase hue | Discussed — the pyramid's rule that a flag is never a hue; the study's "same ink whatever the dot does" | S:95 R:90 A:95 D:95 |
| 3 | Confident | Seam: optional `watched?: { stale: boolean }` prop on `StatusDot`, passed only by `window-row.tsx` (non-ghost, `win.monitored === true`); bar rendered by StatusDot inside a `relative` wrapper | The description names this seam as likely; keeps the dot a pure function of its inputs and leaves the other four mounts byte-identical | S:80 R:80 A:80 D:70 |
| 4 | Certain | Geometry: bar `h-px`, dot-width (`left-0 right-0`), 4px below the 7px dot and 3px below the 9px flagged dot (study CSS `.dot.failed ~ .bar { bottom: -3px }`); clear of the halo's 3px box-shadow | Study's B3 CSS reproduced; the halo reach is read from `rk-waiting-halo` keyframes | S:85 R:90 A:80 D:75 |
| 5 | Confident | Stale = `opacity-50` + dashed via globals.css utilities `rk-watched-underbar` / `rk-watched-underbar-stale` (`repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 3px)`) | Discussed — dimmed AND dashed so staleness is not opacity-only; a named utility follows the `rk-*` convention over an inline arbitrary-value class | S:75 R:90 A:80 D:65 |
| 6 | Confident | Label clause appended LAST (after the waiting suffix): `— watched` / `— watched (operator stale)`; `dotLabel(win, state, watched?)` | The description gives these as examples; ordering core → attention → relation mirrors the overlay precedence; stage word stays in the register per the existing label rule | S:80 R:90 A:80 D:60 |
| 7 | Certain | `WatchedIndicator`, its `Tip`, `role="img"` and `row-watched-indicator` are removed; the bar is `aria-hidden`; ghost rows stay excluded; the dot remains the coarse tap target | Discussed — no new hit target; the `Tip` import becomes unused (only use in the file) | S:95 R:85 A:95 D:95 |
| 8 | Confident | `opr` resolver `getOperatorParts(win, operator, nowSeconds)` lives in `sidebar/registers.ts` and is shared by the flyout card and the PANE panel | registers.ts is the documented single source for both register surfaces ("cannot drift"); `nowSeconds` injected like `getOutputLine` | S:70 R:85 A:85 D:70 |
| 9 | Confident | `opr` text: head `watched · {stage} · tick {age} ago` (stage omitted when absent, tick omitted when `lastTickAt` is 0/absent), facets `{repo} · {branch}` on a continuation line (card) / appended inline (panel) | The description leaves field order to presentation; decisive tokens lead, expendable facets continue — the `fab` register idiom; age via the shared `formatDuration` | S:70 R:90 A:75 D:55 |
| 10 | Certain | `opr` is the LAST register on both surfaces (after the `pr` block on the card, after `fab` in the panel's register block); `WatchedLine` is deleted from its slot below `NoteLine` | Study's register mock places `opr` below `PR` as the fifth line | S:80 R:90 A:80 D:70 |
| 11 | Confident | Session facts reach the register surfaces as props: new `operatorLastTickAt` sibling prop on `WindowRow` (three `sidebar/index.tsx` sites), `operator?: OperatorLoopFacts` on `WindowFlyoutContent` and `WindowPanel`/`WindowContent`, resolved in `BottomPanels` from the owning session; no backend per-window stamping | Follows the existing `operatorStale` prop threading; `BottomPanels` already resolves the owning session for both route and board-fallback windows | S:70 R:80 A:85 D:70 |
| 12 | Certain | Only the sidebar window row shows the underbar; PANE header, dashboard cards, status bar and tty tile header pass no `watched` and their labels are unchanged | User-stated scope ("do not show it unless the intake finds a reason"); the PANE panel's `opr` register already tells the story beneath its header dot | S:85 R:95 A:80 D:70 |
| 13 | Certain | Marker well untouched — no marker code read or written; the auto-chevron-as-watched path is closed | Discussed and recorded in the study's decision section | S:95 R:95 A:95 D:95 |
| 14 | Confident | Docs count the overlays as THREE everywhere (spec channel model, site § 3 table + header, README bullet, status-dot.tsx docblock) and the SVG legend gains a third overlay strip | Consistency of the reference set; the SVG was should-fix — accepted into scope since it is the README's rendered legend | S:75 R:90 A:80 D:65 |
| 15 | Confident | Tests are vitest-only; no new Playwright spec | No e2e asserts the watched surface today and the `monitored` join needs a fab operator state file the e2e rig does not stage; code-quality's e2e SHOULD yields to the missing fixture, unit coverage is complete across all five touched files | S:60 R:85 A:60 D:55 |
| 16 | Certain | Staleness is consumed verbatim from `operatorStale`; `operatorLastTickAt` is displayed, never used to recompute a threshold | Constitution X + the `types.ts` consumer contract | S:95 R:90 A:100 D:95 |
| 17 | Certain | The underbar is static (no animation) — no reduced-motion rule needed; one audit-list line added to the globals.css reduced-motion block | Existing audit-list convention (`.rk-hazard` entry) | S:70 R:95 A:90 D:80 |
| 18 | Confident | `change_type` is `feat` (a new overlay vocabulary entry + a new register), overriding a `fix` inference triggered by "should-fix" wording if refresh infers it | The removal is incidental to adding the overlay and register; the constitution's change-type taxonomy keys on the delivered capability | S:70 R:95 A:80 D:60 |
| 19 | Confident | Stale `opr` head text renders `text-text-secondary` with `data-stale="true"` (the NoteLine stale idiom); no `opacity-50` on the register line itself | Mirrors `NoteLine`'s stale rendering so the two dimming idioms on the card agree; the bar (not the text) is where dashed+dim applies | S:60 R:95 A:75 D:60 |

19 assumptions (10 certain, 9 confident, 0 tentative, 0 unresolved).
