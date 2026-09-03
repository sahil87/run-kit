# Intake: PR Glyph — Draft Shape + Closed Red

**Change**: 260829-lvvw-pr-glyph-draft-shape-closed-red
**Created**: 2026-08-29

## Origin

Synthesized from a `/fab-discuss` session (2026-08-29), dispatched promptless via `/fab-proceed`. The user's raw problem statement:

> "I can't tell closed from draft at a glance."

Conversational mode. The discussion walked the rest-state PR glyph on sidebar window rows and session-tile window rows, compared three treatments, and landed on two final, user-made decisions: (1) closed PRs render **red** (GitHub's coloring), reversing the recorded closed-is-muted design decision from `260810-xuej-closed-pr-row-glyph`; (2) open draft PRs get their **own glyph shape** (the lucide `git-pull-request-draft` silhouette), reversing the "draft keeps the shared icon, varied only by color" decision from `260807-e30p-draft-pr-row-glyph-color`. The user explicitly accepted the cost of (1): red on the sidebar no longer exclusively means "act now" — closed and failing are both red and are separated by shape only (✕ vs merge arc).

Alternatives the user rejected during the discussion (recorded here so hydrate can carry them into the memory Design Decisions):

- **Keep closed gray, only add the draft shape** (Option A alone) — rejected in favor of GitHub coloring; the user wants closed to read as GitHub renders it.
- **Bolder ✕ / dimmed gray for closed** — near-invisible on the dark background at 13px.
- **Closed earns no glyph** (the original `status-pyramid.md` D2 wording) — loses the "a PR existed and died" cue; already rejected once by xuej.

The nearest existing draft change, `fab/changes/260810-aqo6-statusdot-compositional-vocabulary`, is a different, already-shipped change — do not touch or reuse it.

## Why

**The pain point.** On sidebar window rows (`app/frontend/src/components/sidebar/window-row.tsx:726` fine-pointer overlay and `:820` coarse status-rail slot) and on session-tile window rows (`app/frontend/src/components/session-tiles/session-tiles.tsx:200`), `prGlyphColor(win)` returns the same `text-text-secondary` gray token for a **closed** PR and for an **open draft** PR. The only difference is the icon: `GitPullRequestClosedIcon` (an ✕ where the merge arc sits) vs `GitPullRequestIcon` (the arc). At the 13px row size the ✕-vs-arc difference is a ~3px corner detail — the recorded design ("the ✕ icon shape is what separates a closed PR from a draft") does not hold up in practice. The user cannot triage "this PR was rejected/abandoned — decide: rework, re-open, or kill" from "this PR is mine to finish" without hovering for the flyout card.

**The consequence of not fixing it.** Both states stay mistakable for each other on every rest-state row, which is exactly the surface the status pyramid designates as the PR channel ("the remote story lives on the row's rest-state glyph"). The glyph fails its one job for two of its six states.

**Why this approach.** Two channels are changed, one per confused state, so the states separate on *both* axes instead of neither:

1. **Closed → red.** GitHub renders closed PRs red; that is the mapping already in the user's head. It also resolves an existing inconsistency: `PR_STATE_COLORS.closed` (`pr-status-model.ts:35`) is *already* `text-signal-red` and colors the state word "closed" in the status-panel `pr` register and the row flyout card's PR identity segment (via `getPrSegments`/`getPrParts` in `registers.ts`). Today the card says "closed" in red while the glyph next to it is gray; after this change the glyph and the segment text agree. The known cost — red no longer exclusively means "act now" on the sidebar — is accepted by the user; closed vs failing separate by shape (✕ vs arc), which is the same shape difference GitHub relies on.
2. **Draft → its own shape.** With closed leaving the gray token, draft is the only gray glyph — but the user also wants the draft *shape*, because gray-arc vs green-arc is a color-only distinction that fails for colorblind users and under dim themes, and because the lucide `git-pull-request-draft` glyph (dotted merge rail) is GitHub's own draft silhouette. The previous rejection ("a second SVG is more maintained surface for one bit color already carries") is reversed by the user: one more 13px SVG in `icons.tsx` is cheap; the confusion is not.

The color token change is a one-line edit in a pure function; the shape change is one new icon plus a three-way branch at three render sites. No new color system, no new hex — `text-signal-red` is the established fail/closed token.

## What Changes

### 1. `prGlyphColor` — closed branch returns red

File: `app/frontend/src/components/pr-status-model.ts` (function at ~line 214).

Before:

```ts
export function prGlyphColor(win: WindowInfo): string {
  if (win.prState === "closed") return "text-text-secondary"; // dead PR: muted; stale checks are noise
  if (win.prState === "merged") return "text-signal-purple"; // landed: stale checks are noise too
  if (isFailish(win)) return "text-signal-red";
  if (win.prState === "open" && win.prIsDraft) return "text-text-secondary";
  if (win.prState === "open" && win.prChecks === "pending") return "text-signal-yellow";
  return win.prState === "open" ? "text-accent-green" : "text-signal-purple";
}
```

After — **only the first branch's token changes**:

```ts
export function prGlyphColor(win: WindowInfo): string {
  if (win.prState === "closed") return "text-signal-red"; // dead PR: GitHub's closed red; the ✕ shape separates it from failing
  if (win.prState === "merged") return "text-signal-purple";
  if (isFailish(win)) return "text-signal-red";
  if (win.prState === "open" && win.prIsDraft) return "text-text-secondary";
  if (win.prState === "open" && win.prChecks === "pending") return "text-signal-yellow";
  return win.prState === "open" ? "text-accent-green" : "text-signal-purple";
}
```

Resulting six-way chain: **closed → red; merged → purple; isFailish → red; open draft → gray; open pending → yellow; open → green.** Chain *order* is unchanged (closed still sits above fail — a closed PR with failing checks is red either way, and closed-above-fail keeps a closed PR with *passing* checks red rather than falling through to green). The JSDoc block above the function (the numbered 1–6 list and the "No new color system" sentence) must be updated to say closed is red and to drop the "muted" wording; keep the "GLYPH axis — the remote story" NOTE.

`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `isFailish`, `prOwnsGlyph`, `statusDotState`: **unchanged**.

### 2. New `GitPullRequestDraftIcon` in `sidebar/icons.tsx`

File: `app/frontend/src/components/sidebar/icons.tsx`. Add a new export alongside `GitPullRequestIcon` (line ~179) and `GitPullRequestClosedIcon` (line ~211), following the file's fixed idiom exactly (`stroke="currentColor"`, `strokeWidth={2}`, `fill="none"`, `strokeLinecap="round"`, `strokeLinejoin="round"`, 24-unit `viewBox`, `size = 13` default, `aria-hidden`). Use the lucide `git-pull-request-draft` silhouette — same source circle + rail as the sibling icons, a **dotted** merge rail (two short dashes) instead of the arc, and the target circle:

```tsx
/**
 * Lucide `git-pull-request-draft` silhouette: source circle + rail, a DOTTED
 * merge rail (two short dashes where the sibling's arc sits), target circle.
 * The rest-state glyph for an OPEN DRAFT PR — shape, not only color, separates
 * a draft from an open PR and from the closed ✕ (`GitPullRequestClosedIcon`).
 */
export function GitPullRequestDraftIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M18 6V5" />
      <path d="M18 11v-1" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}
```

Match the exact JSX attribute shape of the two sibling PR icons (read them first — e.g. whether they use `<line>` or `<path d="M6 9v12"/>` for the rail, and how `aria-hidden` is spelled); the path data above is the contract, the attribute idiom is the file's.

### 3. Three-way icon selection at the three render sites

Today each site is a two-way ternary:

```tsx
{win.prState === "closed" ? <GitPullRequestClosedIcon /> : <GitPullRequestIcon />}
```

It becomes three-way, **closed first** so a closed draft still reads closed (mirrors the open-gate in `prGlyphColor`):

```tsx
{win.prState === "closed"
  ? <GitPullRequestClosedIcon />
  : win.prState === "open" && win.prIsDraft
    ? <GitPullRequestDraftIcon />
    : <GitPullRequestIcon />}
```

Sites (import `GitPullRequestDraftIcon` from `./icons` / `@/components/sidebar/icons` at each):

| Site | File:line | Surface |
|------|-----------|---------|
| Fine-pointer trailing-cluster overlay | `app/frontend/src/components/sidebar/window-row.tsx:726` (inside the `data-testid="row-pr-glyph"` span, class `... ${prGlyphColor(win)}`) | Sidebar window row |
| Coarse-pointer status-rail slot | `app/frontend/src/components/sidebar/window-row.tsx:820` (same testid, rail's fixed 16px slot) | Sidebar window row on touch |
| Tile header trailing glyph | `app/frontend/src/components/session-tiles/session-tiles.tsx:200` (`data-testid="tile-pr-glyph"`) | Session-tile window row |

If the ternary is duplicated verbatim three times, a small shared selector (e.g. `prGlyphIcon(win)` returning the element, colocated next to the icons or in `pr-status-model.ts`) is acceptable per the no-duplication code-quality rule — but keep it a pure state→icon mapping and keep `pr-status-model.ts` free of React imports if it currently has none (check before choosing the home; `icons.tsx` is the natural home if a helper is introduced). The three-way inline ternary is also acceptable; either shape passes review.

Update the nearby explanatory comments at each site (window-row.tsx ~711–716 "closed PR gets the distinct ✕ ... shape", session-tiles.tsx ~188–192 "muted closed /") — they currently say closed is muted and that shape alone separates closed from draft.

Behavior matrix after the change:

| `prState` | `prIsDraft` | `isFailish` | `prChecks` | Icon | Color |
|-----------|-------------|-------------|------------|------|-------|
| closed | any | any | any | Closed ✕ | `text-signal-red` |
| merged | any | any | any | Standard | `text-signal-purple` |
| open | true | true | any | **Draft** | `text-signal-red` |
| open | true | false | pending | **Draft** | `text-text-secondary` |
| open | true | false | pass/none | **Draft** | `text-text-secondary` |
| open | false | true | any | Standard | `text-signal-red` |
| open | false | false | pending | Standard | `text-signal-yellow` |
| open | false | false | pass/none | Standard | `text-accent-green` |

The coarse-pointer rail reuses the same glyph + color helper, so it follows automatically — no rail-specific work.

### 4. Tests

Unit (Vitest, run via `just test-frontend`):

- `app/frontend/src/components/pr-status-model.test.ts` — the four closed cases (`:154`, `:158`, `:164`, `:170`: closed; closed + failing checks; closed + changes requested; closed + draft) currently assert `text-text-secondary`; flip to `text-signal-red`. Update the describe-block prose comments (`:56–60`, `:151–153`) that say "the ✕ icon, not the color, says closed". Draft cases (`:108`, `:134`) stay gray; `:142` merged+draft stays purple.
- `app/frontend/src/components/sidebar/window-row.test.tsx` — `:535` "renders the glyph muted with the closed ✕ icon" asserts `text-text-secondary` at `:539`; flip to `text-signal-red` and rename. `:501` "renders the glyph gray for an open draft PR" keeps the gray assertion and gains an icon assertion: the draft dashes are present (`path[d="M18 6V5"]` and `path[d="M18 11v-1"]`) and the arc `path[d="M13 6h3a2 2 0 0 1 2 2v7"]` is absent. Add: closed + `prIsDraft: true` → closed ✕ (`path[d="m21 3-6 6"]`), red; open non-draft → arc present, no dashes. Also fix the stale title/comment at `:439–452` ("D2 … earns no glyph … prOwnsGlyph excludes closed") if it contradicts the current model — the test body asserts on the dot, not the glyph, so only the wording needs care.
- `app/frontend/src/components/session-tiles/session-tiles.test.tsx` — `:227` closed case asserts `text-text-secondary` at `:231`; flip to `text-signal-red`. Add a draft case mirroring the window-row one (draft dashes present, arc absent, gray) and a closed-draft case (✕, red).
- Any other unit test that asserts the closed glyph's class — grep `text-text-secondary` near `prState: "closed"` in `app/frontend/src/**/*.test.ts{,x}` (`row-flyout-card.test.tsx`, `server-panel.test.tsx`, `sidebar/index.test.tsx`, `popup-title-bar.test.tsx` matched the token but were not confirmed to touch the glyph — verify).

E2E (`app/frontend/tests/e2e/`): a grep at intake time found **no** e2e assertion on the closed glyph's color class or on `prIsDraft` (`row-flyout.spec.ts` asserts glyph *presence* by `row-pr-glyph` at `:512`, `:516`, `:604`, `:605` only). Re-run the grep during apply (`text-text-secondary`, `text-signal-red`, `prState: "closed"`, `prIsDraft` across `*.spec.ts`) and update anything found; otherwise no e2e edits are required. Adding a small e2e assertion for the closed-red / draft-shape glyph is optional (see Assumptions).

### 5. Docs to hydrate (reverse the recorded reasoning, do not leave it stale)

Memory — `docs/memory/run-kit/ui/status-signals.md`:

- § Row PR-glyph helpers (line ~73): the six-way chain description says `text-text-secondary` for closed "(a dead PR reads muted …)" and "Closed and open-draft share the inert gray token — the ✕ icon shape is what separates a closed PR from a draft". Rewrite: closed → `text-signal-red` (GitHub's closed red; matches `PR_STATE_COLORS.closed` so glyph and register segment agree), closed and failing share red and separate by shape (✕ vs arc); draft is the sole gray glyph and carries its own `GitPullRequestDraftIcon` shape.
- Line ~32 ("The rest-state PR glyph … is the one surface that colors draft differently — gray") — still true; leave, but check the sentence's tail.
- § Design Decisions, entry "draft lives on the row glyph's existing color axis …" (~384–387): the Decision says "Draft keeps the shared `GitPullRequestIcon`, varied only by color (the icon axis belongs to closed's ✕ variant, not draft)" and Rejected lists "GitHub's distinct dashed draft glyph". Revise: draft now owns the dashed `GitPullRequestDraftIcon`; move the old reasoning into Rejected/superseded wording; append this change ID to *Introduced by*.
- § Design Decisions, entry "The draft glyph branch sits below fail and is gated on `prState === "open"`" (~389–393): Decision says "closed-muted → fail-ish → …"; change to "closed-red → …". Ordering rationale unchanged.
- § Design Decisions, entry "Closed PR earns a muted ✕ glyph, ranked above fail" (~395–399): retitle ("Closed PR earns a red ✕ glyph, ranked above fail"), Decision `text-text-secondary` → `text-signal-red`; Why: replace "Muted gray keeps a dead PR from drawing rest-state attention, and the ✕ shape is what separates closed from draft at the same inert token" with the GitHub-coloring + register-agreement rationale and the accepted cost (red no longer exclusively "act now"; shape separates closed from failing); Rejected currently lists "GitHub-exact red + ✕ (collides visually with fail-ish red and lights up dead PRs — rejected by the user after mock review)" — this is now the chosen option; rewrite Rejected to list muted gray + ✕ (the previous decision — fails at 13px, indistinguishable from draft at a glance), bolder/dimmer gray, and glyph-less. Append this change ID to *Introduced by*.
- § Status Dot "PR is evicted from the dot" entry (~402) lists closed among glyph states — wording check only.
- Tests paragraph (~148) mentions `pr-status-model.test.ts` covering `prGlyphColor` — add the draft-icon and closed-red cases to the list.

Memory — `docs/memory/run-kit/ui/sidebar.md`:

- § Sidebar Row Icon System (line ~38): the icon inventory lists `GitPullRequestIcon` and `GitPullRequestClosedIcon`; add `GitPullRequestDraftIcon` (lucide `git-pull-request-draft`: source circle + rail, dotted merge rail, target circle) and change "The two PR glyphs are the members that are not action icons" to three.
- § Window rows item 3 (line ~188): "(gray closed / red failing / gray draft / … — closed and draft share the gray token; the ✕ icon shape separates them)" → "(red closed / … / gray draft / …) with the icon picked by state (✕ closed, dotted-rail draft, arc otherwise)".

Memory — `docs/memory/run-kit/ui/routes-and-shell.md` line ~104 (session tile header glyph) — check whether it restates the chain; update if it names closed's color or the two-icon choice.

Spec — `docs/specs/status-pyramid.md`:

- Line ~69 (channel table, PR glyph row): "five states via `prGlyphColor`: red failing > gray open-draft > yellow checks-running > green open > purple merged; gated on `prOwnsGlyph` (owned PR — never closed)" → six states incl. red closed; drop "never closed".
- Line ~158 and ~243–245 (chain restatements "red > draft-gray > pending-yellow > open-green >" and "owned state, `open` or `merged` — closed … never") → add closed (red, first) and the draft shape.
- Line ~230 row 21 ("PR closed-unmerged · change live … (closed earns no glyph)") → "closed earns the red ✕ glyph".
- Line ~359 D2 row ("closed-unmerged earns no glyph (register line only)") → "closed-unmerged renders the red ✕ glyph".

Hydrate also regenerates `docs/memory/index.md` / domain indexes via `fab memory-index` if descriptions change (they likely do not).

### Out of scope

- `StatusDot` / `statusDotState` — the dot renders no PR state; untouched.
- `PR_STATE_COLORS` / `PR_CHECKS_COLORS` / `PR_REVIEW_COLORS` — unchanged; `closed` is already red there.
- The flyout card's and PANE panel's PR text segments (`registers.ts` `getPrSegments`/`getPrParts`) — already colored via `PR_STATE_COLORS`; the `" (draft)"` suffix remains the accessible draft signal.
- Coarse-pointer status-rail geometry — reuses the same glyph + helper; follows automatically.
- `prOwnsGlyph` allowlist — unchanged (`open`/`merged`/`closed`).

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Row PR-glyph helpers chain (closed → `text-signal-red`; draft owns a shape), the three Design Decisions entries on draft color, chain order, and closed glyph (revise Decision/Why/Rejected, append change ID), the tests paragraph.
- `run-kit/ui/sidebar`: (modify) § Sidebar Row Icon System inventory gains `GitPullRequestDraftIcon`; § Window rows item 3 color/icon wording.
- `run-kit/ui/routes-and-shell`: (modify) session-tile header glyph sentence, only if it restates closed's color or the two-icon choice (verify at hydrate).

## Impact

- **Frontend source** (`app/frontend/src/`): `components/pr-status-model.ts` (one token + JSDoc), `components/sidebar/icons.tsx` (+1 icon, ~30 lines), `components/sidebar/window-row.tsx` (2 ternaries + import + comments), `components/session-tiles/session-tiles.tsx` (1 ternary + import + comment).
- **Frontend tests**: `pr-status-model.test.ts`, `sidebar/window-row.test.tsx`, `session-tiles/session-tiles.test.tsx` (flip 6 closed assertions to red; add ~4–6 draft/closed-draft icon cases). E2E: none expected to change; verify by grep.
- **Docs**: `docs/memory/run-kit/ui/status-signals.md`, `docs/memory/run-kit/ui/sidebar.md`, possibly `routes-and-shell.md`; `docs/specs/status-pyramid.md` (4 spots).
- **No backend, API, SSE, or `WindowInfo` shape changes** — `prState` and `prIsDraft` already ride the stream.
- **User-visible**: closed-PR rows/tiles turn red at rest; draft-PR rows/tiles show a dotted-rail icon (gray, or red when failing). Red on the sidebar now also means "closed", separated from "failing" by the ✕.
- **Verification gates** (code-quality.md): `just test-frontend` for the three suites first; `cd app/frontend && npx tsc --noEmit`; then the row-flyout / session-tiles e2e specs via `just test-e2e "<spec>"` as a regression check.

## Open Questions

- None blocking. See Assumptions for the one optional-scope call (e2e assertion).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Closed PR glyph renders `text-signal-red` (only `prGlyphColor`'s first branch changes; chain order unchanged) | Discussed — user's final decision, GitHub coloring; cost (red ≠ exclusively "act now") explicitly accepted | S:95 R:95 A:95 D:95 |
| 2 | Certain | Open draft PRs get a new `GitPullRequestDraftIcon` (lucide `git-pull-request-draft` path data as given) in `sidebar/icons.tsx`, same fixed icon idiom as siblings | Discussed — user chose the shape and supplied the exact silhouette | S:95 R:90 A:95 D:95 |
| 3 | Certain | Icon selection at the three render sites is three-way, closed first: closed → ✕; open && draft → draft icon; else standard. Draft color stays `text-text-secondary`; failing draft is red with the draft shape | Discussed — stated verbatim; mirrors the existing open-gate in `prGlyphColor` | S:95 R:90 A:95 D:95 |
| 4 | Certain | `PR_STATE_COLORS`, `StatusDot`, flyout/PANE text segments, `prOwnsGlyph`, and coarse-rail geometry are out of scope | Discussed — listed as out of scope; `PR_STATE_COLORS.closed` is already red so glyph and segments now agree with no change there | S:90 R:90 A:95 D:95 |
| 5 | Certain | Recorded design reasoning in `status-signals.md` (three DD entries + chain prose), `sidebar.md` (icon inventory, row item 3), and `status-pyramid.md` (~69, ~158, ~230, ~245, ~359) is rewritten to the new rationale, not left stale | User required the docs be reverted, not left stale; FKF present-truth memory style | S:90 R:85 A:90 D:90 |
| 6 | Confident | Superseded Design Decisions are revised in place (Decision/Why/Rejected rewritten, the old choice moved to Rejected, this change ID appended to *Introduced by*) rather than adding parallel "superseded" entries | Memory files follow the present-truth style (docs-distill-memory); the closed-glyph DD's current Rejected text names exactly the option now chosen, so in-place inversion is the clearest record | S:70 R:85 A:80 D:75 |
| 7 | Certain | Unit tests assert the draft icon by its distinguishing path data (`M18 6V5`, `M18 11v-1`) and the arc's absence, mirroring the existing closed-icon assertion style (`m21 3-6 6`) | Follows the exact pattern already in `window-row.test.tsx:540` and `session-tiles.test.tsx:232` | S:80 R:90 A:90 D:85 |
| 8 | Certain | A shared pure state→icon selector is optional; a three-way inline ternary at each of the three sites is acceptable, as is a small helper colocated in `icons.tsx` — either passes review | Three identical 3-line ternaries sit at the no-duplication threshold; both shapes match existing patterns (the current two-way ternary is already duplicated at the three sites) | S:70 R:95 A:85 D:70 |
| 9 | Confident | No new e2e test is required; existing e2e specs assert glyph presence only (no color/draft assertions found), so the change is covered by unit tests. An e2e assertion for closed-red / draft-shape is nice-to-have, not a gate | Code-quality "SHOULD include Playwright e2e where possible" vs cost of a new spec for a class-token change; reviewer may reasonably ask for one | S:60 R:90 A:60 D:45 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
