# Intake: Sidebar Window-Row PR Glyph + Register Flyout Card

**Change**: 260805-93dy-window-row-pr-glyph-register-flyout
**Created**: 2026-08-05

## Origin

Conversational — a `/fab-discuss` design-study session with interactive HTML mocks the user reviewed and approved ("Mock C"). Created via `/fab-proceed` promptless dispatch (no user reachable at intake time; open decisions are deferred per SRAD, not silently assumed).

> **User (origin quote)**: "I want to know if we can show a PR icon (in case we have a PR ready state) also, that gets replaced on hover with Pin and Remove. Also, the hover popup we get when we hover on the status dot, can we show that on hover of the whole row instead, and instead of showing it near the mouse, can we fix its position on the right of the row."
>
> **User (after mock iteration)**: "I would right align the PR icon in all of them. Basically where you see the x icon. On hover, it would disappear and replace with Pin + Close (x) + the hover menu."
>
> **User (final)**: "Mock C seems nice. go ahead with the implementation."

Alternatives explicitly rejected during the mock session:

- **PR chip with visible `#number` at rest (Mock B)** — name-width cost at rest.
- **"Coexist"** (PR affordance stays visible during hover beside pin/✕) — explicitly rejected by the user in favor of the in-place swap.
- **Hover-preview inside the existing bottom PANE panel (Mock D)** — user chose the floating card.
- **Tip-sized card content** (label + agent + freshness only, Mock A) — user chose the full four-register view.

## Why

1. **Pain point — PR state is invisible at rest and PR detail costs a selection.** Post Row Minimalism (`260706-y1ar`), the sidebar `WindowRow`'s only status signal is the leading `StatusDot`. A window with an owned PR renders one 7px purple/orange dot — the *existence and health* of a PR is readable only by decoding dot hue, and the full detail (PR number, checks, review, agent state, fab stage) requires either hovering the tiny dot (a precise, small target) or selecting the row and reading the bottom PANE panel. Scanning "which of my 15 windows have PRs, and how are they doing" is slow.
2. **Consequence of not fixing** — the operator keeps selecting rows one-by-one (or aiming at 7px dots) to answer routine questions the sidebar could answer at a glance; the dense-tree design goal ("one glance answers 'does anything need me'") stops at the dot's coarse vocabulary.
3. **Why this approach** — (a) a rest-state PR glyph in the trailing cluster surfaces the highest-value journey endpoint (the PR) without costing name width (Mock B's `#number` chip rejected for exactly that cost); (b) an in-place hover swap keeps the row's rest state clean and the hover state actions-only (the user rejected coexistence); (c) promoting the dot-tip to a whole-ROW hover flyout with a FIXED x-position (sidebar right edge) turns every row into a large, forgiving hover target with a stable, non-jittering card position — "hovering any row answers everything without selecting it." This deliberately **partially reverses Row Minimalism** — a user-approved reversal (see § What Changes / Spec + memory updates).

## What Changes

Frontend only — no backend changes. All inputs (`prNumber`/`prState`/`prUrl`/`prChecks`/`prReview`/`prFetchedAt`, `agentState`/`agentIdleDuration`, `fabChange`/`fabStage`/`fabDisplayState`, `activity`/`activityTimestamp`) already ride `WindowInfo` via SSE.

### 1. Rest-state PR glyph, far-right slot (`window-row.tsx` + `sidebar/icons.tsx` + `pr-status-model.ts`)

When a window's row has an **owned PR**, the trailing cluster shows a **git-pull-request glyph at rest**, right-aligned so its **right edge lands exactly where the hover ✕'s right edge sits** (the ✕ currently renders at `right-2` inside the absolute icon-cluster container, `window-row.tsx:422-461`).

- **Gate**: any dot-owning PR — the existing `prOwnsDot(win)` predicate (`!!win.prNumber && win.prState !== "closed"`, currently file-private in `pr-status-model.ts:232`): open, failing, and merged PRs all earn the glyph; closed-unmerged never does. `prOwnsDot` needs to be exported (or wrapped in an exported helper) for the row to consume. The gate is deliberately NOT family-gated like dot ownership (D1) — this is a per-decision the plan should keep simple: reuse `prOwnsDot` as-is. The approved mocks showed all three owned states.
- **Color**: via the existing shared PR vocabulary in `pr-status-model.ts` — reuse `prDotState(win)` / `isFailish(win)`; **purple for open/merged, red for failing** (per the approved mocks). NO new color system, no new hex — use the established tokens (`text-purple-400`, `text-red-400`).
- **Glyph**: a **stroke SVG** in the sidebar icon idiom — a new `GitPullRequestIcon` (lucide-style git-pull-request: two vertical rails, circles at the ends, an arc) added to `sidebar/icons.tsx` following the file's fixed idiom (`stroke="currentColor"`, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, `size = 13` default, `aria-hidden`). NOT the Nerd Font `` glyph the PANE panel's L3 register uses — the Sidebar Row Icon System mandates ONE icon system with equal ink metrics in row clusters (ui-patterns § Sidebar Row Icon System, `260724-2bmy`).
- **Informational only — never mouse-clickable.** Consequence of the in-place swap (below), accepted by the user: the rest glyph disappears the moment the pointer enters the row, so it can never be the click target. The "Open PR #N" *action* lives in the hover card (and the existing surfaces: PANE-panel L3 register `PrLinkRow`, palette `Open: PR #n`).
- **Accessibility**: the glyph is `aria-hidden` decoration (its information is carried by the dot's `aria-label`, the hover card, and the PANE panel) — it must not become a focusable dead control.

### 2. In-place hover swap + pinned-row slot discipline (`window-row.tsx`)

- **Swap semantics**: on row hover (the existing `group` hover), the rest group **disappears entirely** (display swap — e.g. `group-hover:hidden` / conditional visibility classes — NOT an opacity fade over reserved space) and the existing pin + kill action cluster takes its place, exactly where the rest glyph sat.
- **Pinned-row slot discipline**: a row pinned to a board keeps its **persistent pin glyph** (today's `isPinnedToAny` persistent rendering, `window-row.tsx:439-445`): rest = `[pin][PR]` with the PR glyph in the last (✕) slot; hover = `[pin][✕]`. **The pin holds its slot; only the last slot swaps.** The pin's existing accent-when-`isPinnedToActiveBoard` cue is untouched.
- **Rest inertness preserved**: the cluster container's rest inertness (`pointer-events-none` at rest, restored via `group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto`, `window-row.tsx:422`) MUST be preserved — the rest PR glyph is non-interactive, so it changes nothing about the inert-at-rest contract (Playwright note: icon clicks still need a row `.hover()` first).
- **Right padding**: the row button's reserved right padding (`pr-[68px]` when the pin icon is wired, else `pr-11`, `window-row.tsx:236`) stays sufficient — the rest state occupies at most the same two slots the hover state does.
- **Coarse pointers**: unchanged — the action cluster is already always-visible on touch (`coarse:opacity-100`), so on coarse pointers the actions win the slots and the rest PR glyph does not render (the dot hue + dot-tap tip + PANE panel remain the touch PR-status path).

### 3. Row-hover register flyout card (new component, e.g. `sidebar/row-flyout-card.tsx`)

The "hover menu" from the user's quote — a floating card that opens on **WHOLE-ROW hover** (not dot hover):

- **Trigger**: row-level hover with an **open delay (~350ms)** and a **warm-window** so moving between rows retargets instantly instead of strobing — the same pattern as the existing `Tip` system's `TIP_OPEN_DELAY_MS = 300` + `TIP_WARM_WINDOW_MS = 500` warm cluster (`components/tip.tsx`, `TipGroup`/`FloatingDelayGroup`). The flyout needs its own shared delay-group scope across all window rows (a sibling mechanism to `TipGroup`, not a fatter tier-1 `Tip` — this card is tier-2 interactive content per the two-tier tooltip taxonomy).
- **Position**: FIXED x — the sidebar's right edge — vertically aligned to the hovered row: floating-ui `placement: "right"` anchored to the **ROW element** (not the mouse, not the dot), with `FloatingPortal` to escape the sidebar's overflow clip. This generalizes the existing `StatusDotTip` anchor+placement (`status-dot-tip.tsx` already uses `FloatingPortal` + `safePolygon`); `safePolygon` keeps the pointer able to travel row → card to click the PR link.
- **Clamping**: reuse the established middleware set — `offset(6)` / `flip()` / `shift({ padding: 8 })` / `autoUpdate` — for vertical clamping at viewport edges; width capped in the `max-w-xs` register the `StatusDotTip` uses.
- **Content — the full four-register view** promoted from the bottom PANE panel (`sidebar/status-panel.tsx` `WindowContent`): `out` / `agt` / `fab` / `PR` lines with the fixed 3-char prefix vocabulary and colored segments (`getOutputLine` / `getAgentLine` / the fab line / `getPrSegments` — all currently **file-private** in `status-panel.tsx`; they need extraction to a shared module so the card and the panel render from one source, no duplication). Absent layers render as absent (a plain shell pane shows only `out`). Plus an **"Open PR #N ↗" link when `prUrl` exists** (anchor-not-button idiom, `stopPropagation` so clicking never selects the row). The card also carries the dot tip's extras: the **`checked Xs ago` freshness line** (reuse the `FreshnessLine` leaf component with its leaf-scoped `useNow()`) and the **docs info-icon link** (`STATUS_DOT_DOCS_URL`).
- **Read-only vs. interactive split**: registers are read-only text; the PR link + docs icon are the card's only interactive elements.
- **Render performance (hard constraints, ui-patterns § Render Performance)**: the sidebar memo tree must not be defeated — hover/open state stays **row-local** (inside `WindowRow`/the card component; NO per-row hover state lifted to `Sidebar`), the card **mounts only while open**, and any `useNow()` clock stays leaf-scoped inside the open card (never on the row). No `nowSeconds` prop threaded into memoized components.
- **Interaction guards**: the card must not fight the row's other layers — close/suppress on drag start (`onDragStart`), and while the row's popovers (`PinPopover` / label `SwatchPopover`) are open. Exact suppression mechanics are plan-level detail.

### 4. StatusDotTip is REPLACED entirely — one surface (resolved, Assumptions #18)

**User decision (interactive clarify, 2026-08-05): the row flyout replaces `StatusDotTip` entirely.** One surface serves all three triggers: fine-pointer **row hover**, **keyboard focus** (the row is already a focusable treeitem via the roving-tabindex model — focus-open on the row, Constitution V), and **touch dot-tap** (tapping the dot opens the card). The `StatusDotTip` component is removed; its content — the `dotLabel` line, agent line, `FreshnessLine`, "Open PR #N" link, and docs info-icon — folds into the card. The dot's `tabIndex={0}` tab stop is dropped with the tip (removing the accepted second-tab-stop tradeoff from `260616-37ub`); `dotLabel` stays as the dot's `aria-label` (unchanged — it lives in `status-dot-label.ts`). Status detail stays keyboard- and touch-reachable via the card + the PANE-panel-on-selection path.

### 5. Spec + memory updates (at hydrate)

This change **deliberately partially reverses Row Minimalism** (`260706-y1ar`): `docs/specs/status-pyramid.md` § Row Minimalism currently says the StatusDot is the row's ONLY status signal. User-approved reversal — at hydrate, update:

- `docs/specs/status-pyramid.md` § Row Minimalism — the row now carries the dot PLUS a rest-state PR glyph in the trailing cluster; the register view gains a second surface (the row-hover flyout) beside the PANE panel.
- `docs/memory/run-kit/ui-patterns.md` — the Window rows / Row Minimalism notes, § Status Dot hover-card, § Tooltips Two-Tier Taxonomy (the flyout is a new tier-2 member), § Sidebar Row Icon System (new `GitPullRequestIcon`), § Row Anatomy.
- The stale row-comment in `window-row.tsx:405-414` ("the leading StatusDot is the row's ONLY externally visible status signal") is updated in-code during apply.

### 6. Tests

- **Unit** (colocated `.test.tsx`): rest-glyph gating (owned PR → glyph; closed/no PR → none), glyph color mapping (open/merged purple, failing red), slot discipline (pinned rest = `[pin][PR]`, hover = `[pin][✕]`), card content resolver (registers, PR link presence, freshness line), extraction module (register helpers behave identically for panel + card).
- **Playwright e2e** (+ sibling `.spec.md` per constitution Test Companion Docs): row-hover opens the card at the sidebar's right edge; delay + warm-window retarget between rows; PR-link click-through; rest glyph visible → hover swaps to pin+✕; keyboard path (row focus opens the card; Escape dismisses); coarse-pointer suppression of the hover trigger. Run via `just test-e2e` / `just pw` (port 3020 isolation — never raw Playwright).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Window rows / Row Minimalism reversal (rest PR glyph + swap), new § for the row-hover register flyout card (tier-2 hover-card taxonomy member), § Status Dot hover-card (per #18 resolution), § Sidebar Row Icon System (`GitPullRequestIcon`), § Row Anatomy, § Render Performance cross-references.

(`docs/specs/status-pyramid.md` § Row Minimalism is a spec, not memory — its revision is called out in What Changes § 5 and belongs to hydrate's spec-touch alongside the memory update.)

## Impact

- `app/frontend/src/components/sidebar/window-row.tsx` — rest glyph, in-place swap, flyout wiring (largest touch; must preserve `memo`, rest inertness, label zone, drag, popovers, roving tabindex).
- `app/frontend/src/components/sidebar/icons.tsx` — new `GitPullRequestIcon` (stroke idiom).
- `app/frontend/src/components/pr-status-model.ts` — export `prOwnsDot` (or an exported wrapper) + a small glyph-color helper reusing `prDotState`/`isFailish`.
- **New** `app/frontend/src/components/sidebar/row-flyout-card.tsx` (name flexible) — the flyout card + its shared delay-group scope.
- `app/frontend/src/components/sidebar/status-panel.tsx` — extract the file-private register helpers (`getOutputLine`/`getAgentLine`/fab line/`getPrSegments` + segment rendering) into a shared module consumed by both `WindowContent` and the card.
- `app/frontend/src/components/status-dot-tip.tsx` — REMOVED (content folds into the flyout card; `dotTipContent`/`FreshnessLine` logic migrates to the card module); `status-dot.tsx` drops the tip wrapper + `tabIndex`.
- Tests: `window-row` unit tests, new/updated `status-dot-tip`/card unit tests, new e2e spec + `.spec.md` under `app/frontend/tests/`.
- Docs: `docs/specs/status-pyramid.md`, `docs/memory/run-kit/ui-patterns.md` (hydrate), possibly `docs/site/status-dot.md` if the tip surface changes.
- No backend, no API, no new routes, no new dependencies (`@floating-ui/react` already present).

## Open Questions

None — the StatusDotTip-fate question was resolved by the user in an interactive clarify (2026-08-05): replace entirely (see What Changes § 4, Assumptions #18).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Rest-state PR glyph sits in the far-right (✕) slot, right-edge-aligned with the hover ✕; informational only, never mouse-clickable | Discussed — user's origin quote + "right align the PR icon… where you see the x icon" + Mock C approval; click consequence explicitly accepted | S:90 R:75 A:85 D:90 |
| 2 | Certain | In-place display swap on row hover: rest group disappears entirely; pin + kill cluster takes its place (no opacity fade over reserved space) | Discussed — user rejected "coexist" in favor of the swap | S:90 R:80 A:85 D:95 |
| 3 | Certain | Pinned-row slot discipline: rest `[pin][PR]`, hover `[pin][✕]` — pin holds its slot, only the last slot swaps | Discussed — part of the approved Mock C behavior | S:85 R:80 A:85 D:90 |
| 4 | Certain | Flyout opens on WHOLE-ROW hover, anchored to the row element at a fixed x (sidebar right edge): floating-ui `placement:"right"` + `FloatingPortal`, generalizing StatusDotTip's anchor/placement | Discussed — user asked for row hover + fixed position at the row's right; existing floating-ui infrastructure named in the design session | S:90 R:70 A:85 D:85 |
| 5 | Certain | Card content = full four-register view (`out`/`agt`/`fab`/`PR`, 3-char prefixes, colored segments, absent-as-absent) + "Open PR #N ↗" when `prUrl` | Discussed — Mock C (full registers) chosen over tip-sized Mock A and panel-preview Mock D | S:90 R:70 A:80 D:90 |
| 6 | Certain | Glyph colored via the shared PR vocabulary (`prDotState`/`isFailish`): purple open/merged, red failing; no new color system | Discussed — decision 1 names the exact helpers and colors | S:85 R:85 A:90 D:85 |
| 7 | Confident | Open delay ~350ms with a warm-window retarget between rows, mirroring `Tip`'s 300ms + 500ms warm-cluster pattern; exact constants tuned at implementation | Discussed pattern + named delay; precise constants are agent-tunable within the stated envelope | S:65 R:90 A:75 D:70 |
| 8 | Certain | This partially reverses Row Minimalism (`260706-y1ar`); `status-pyramid.md` § Row Minimalism + ui-patterns memory updated at hydrate | Discussed — user-approved reversal, explicitly constrained in the design session | S:90 R:70 A:85 D:90 |
| 9 | Certain | Frontend only — no backend changes; all card/glyph inputs already ride `WindowInfo` via SSE | Verified in repo: `prNumber`/`prState`/`prUrl`/`prFetchedAt`, `agentState`/`agentIdleDuration`, fab fields, `activity` are on `WindowInfo` today | S:85 R:90 A:95 D:95 |
| 10 | Certain | Perf discipline: `WindowRow` memo preserved, hover/open state row-local (never lifted to `Sidebar`), card mounts only while open, `useNow()` leaf-scoped inside the open card | Repo-documented load-bearing invariants (ui-patterns § Render Performance, use-now leaf contract) named as constraints in the session | S:80 R:85 A:95 D:90 |
| 11 | Certain | Icon-cluster rest inertness preserved: `pointer-events-none` at rest, restored on hover/coarse/focus-within | Existing contract (`window-row.tsx:422`, PR #257) named as a constraint in the session | S:80 R:85 A:95 D:90 |
| 12 | Certain | Ships Playwright e2e + sibling `.spec.md` companion + unit tests | Constitution (Test Companion Docs) + code-quality.md mandate; deterministic | S:85 R:90 A:100 D:95 |
| 13 | Confident | Rest-glyph gate = any dot-owning PR (`prOwnsDot`: `prNumber && prState !== "closed"` — open, failing, merged), not actionable-only | The user-approved mocks showed all three owned states; reuses the existing predicate unchanged; trivially re-gateable later | S:60 R:85 A:70 D:60 |
| 14 | Confident | Glyph is a stroke SVG (`GitPullRequestIcon` in `sidebar/icons.tsx` idiom), not the Nerd Font `` glyph | Repo evidence: Sidebar Row Icon System mandates one stroke-SVG icon system with equal ink metrics in row clusters (`260724-2bmy`) | S:55 R:90 A:85 D:75 |
| 15 | Confident | Card carries the dot tip's extras: `checked Xs ago` freshness line (reusing the `FreshnessLine` leaf) + the docs info-icon link | The card is a promotion of the tip's content; `FreshnessLine` is an existing leaf-scoped component built for exactly this mount pattern | S:50 R:90 A:70 D:60 |
| 16 | Confident | Card clamping/sizing: `offset(6)`/`flip()`/`shift({padding:8})`/`autoUpdate` middleware for viewport clamping; width capped in the `max-w-xs` register | Repo convention — the exact middleware set StatusDotTip and Tip already use; purely presentational and cheap to retune | S:50 R:90 A:75 D:65 |
| 17 | Confident | Coarse-pointer behavior unchanged for actions: they stay always-visible on touch (`coarse:opacity-100`), so the rest PR glyph is fine-pointer-only; touch status path = dot-tap opens the flyout card + PANE-panel-on-selection | Session constraint (touch has no hover) + #18 resolution routes the dot-tap to the card | S:45 R:85 A:70 D:65 |
| 18 | Certain | Row flyout REPLACES `StatusDotTip` entirely — one surface serving fine-pointer row hover, keyboard row-focus, and touch dot-tap; `StatusDotTip` removed, its content (label, agent line, freshness, PR link, docs icon) folds into the card; dot's `tabIndex={0}` tab stop dropped; `dotLabel` stays as the dot `aria-label` | User decision — interactive clarify 2026-08-05: "Replace StatusDotTip" selected over "Keep dot tip for focus/touch" | S:90 R:70 A:85 D:95 |

18 assumptions (12 certain, 6 confident, 0 tentative, 0 unresolved).
