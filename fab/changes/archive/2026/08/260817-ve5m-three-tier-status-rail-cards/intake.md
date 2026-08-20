# Intake: Continuous Three-Tier Status Rail + Session/Server Cards + Change Color Action

**Change**: 260817-ve5m-three-tier-status-rail-cards
**Created**: 2026-08-17

## Origin

Dispatched promptless (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a user-approved design finalized through a **four-times-iterated HTML mock session ("v4")**. All decisions below carry exact values from that mock and are user-approved — this intake transfers them verbatim. Builds directly on merged PRs **#634** and **#639** (both hydrated into memory).

> Title direction: Continuous three-tier status rail + session/server cards + Change color action.
>
> **Problem.** The shipped right-edge status rail (#639) exists only on window rows: the strip breaks at session rows and server-group headers (which still carry always-visible icon clusters on touch), the rail's 48px is a tight thumb target, the left label zone on touch is invisible-at-rest (undiscoverable) while eating 26+px of a narrow drawer, and the rail gives no visual feedback while a finger holds/scrubs it.
>
> (Full nine-decision description reproduced in § What Changes; alternatives-rejected and constraints reproduced below.)

## Why

1. **The pain point.** On coarse pointers the sidebar's right edge is inconsistent per tier: window rows carry the recessed 48px status rail (#639, `window-row.tsx:754-788`), but session rows still render a four-icon always-visible cluster (palette/bot/plus/kill, `session-row.tsx:263-311`) and server-group headers a three-icon cluster (palette/plus/close, `index.tsx:2363-2419`). The strip visually breaks at every non-window row; the clusters are exactly the cramped always-visible touch affordances the window tier already migrated away from in #634/#639. Meanwhile the 48px rail is a tight thumb target, the 26px left label zone (`window-row.tsx` `LabelZone`, `LABEL_ZONE_WIDTH = 26`) is invisible at rest on touch — undiscoverable while consuming ~26px of a 340px-max drawer — and a held/scrubbed rail gives zero visual feedback about which row's card is open.
2. **If we don't fix it.** Touch users keep three different right-edge idioms in one tree (rail vs two icon-cluster generations), fat-finger hazards on session/server kill icons persist, window names stay ~14px narrower than they could be on the narrowest screens, and the scrub gesture stays hard to learn because nothing on the row acknowledges the touch.
3. **Why this approach.** Extending the ONE shipped rail + card + scrub system to all three tiers (instead of inventing per-tier surfaces) reuses the placement/containment/held-state machinery, the module-scoped scrub registry, and the existing pickers/dialogs — satisfying Constitution IV (the cards exist only where their trigger, the rail, exists) and the reuse-don't-duplicate constraint, while the coarse left-zone reclaim funds the wider 56px rail without net loss of name width.

## What Changes

All values below are exact, from the user-approved v4 mock. **Frontend only.** No backend, no new data plumbing — `sessionId`/`sessionPath` already ride the session payload (consumed at `session-row.tsx:132-138`), server session counts are derivable from the group's data, `windowCount`/`sessionCount` ride `ServerInfo`.

### 1. Rail extends to session rows and server-group headers on coarse

- Same recessed inset band + 1px left seam as the shipped window rail (`bg-bg-inset`, `border-l border-border` — `window-row.tsx:757`), forming **ONE continuous strip down the tree** across window rows, session rows, and server-group headers.
- **Per-tier band tint** derived from existing tint systems: server/session header rails tint from their header's family tints (`rowTints` descriptor maps — session `tint.base/hover` in `session-row.tsx:140-153`, server `headerTint` keyed at `index.tsx:2288`); window rails keep the shipped neutral/selected treatment (the `color-mix(in srgb, var(--color-bg-inset) 55%, <selected>)` selected variant, `window-row.tsx:385-392`). Never a new token.
- Fixed slots exactly as shipped: **16px glyph slot** (`w-4`, ALWAYS an empty span on session/server rows — they own no PR glyph) and **12px `›` chevron** (`w-3`, ~55% opacity, `aria-hidden`) on EVERY rail, so chevrons column-align down the whole tree.
- Non-ghost rows only. The rail does not exist on fine pointers for any tier (fine pointers keep hover clusters + identity tips unchanged).

### 2. Rail width 48px → 56px on coarse, all tiers

- `STATUS_RAIL_WIDTH_PX` (exported from `row-flyout-card.tsx:75`, currently `48`) becomes **56** — one constant, all tiers, and the coarse card width cap (`size()` middleware: reference-width − rail − 8px gap, floored at 120px) follows automatically.
- The window-row coarse right-padding reserve grows to match: `coarse:pr-[48px]` (`window-row.tsx:360`, literal class — Tailwind scans literals; the comment there already pins the literal-must-match-constant rule) becomes `coarse:pr-[56px]`.

### 3. Coarse left-zone reclaim (window rows)

- On coarse the interactive label zone and its palette-icon reveal are **REMOVED** — the zone becomes desktop-only (26px, hover reveal, geometry and behavior on fine pointers unchanged; `LabelZone`, `window-row.tsx:873-927`). This supersedes the current "Active on coarse pointers — touch gets direct label access" wiring (`window-row.tsx:397-399`): the touch path to color/marker becomes the card's `Change color…` row (decision 7).
- The **display-only marker stripe REMAINS rendered on coarse** — it is information (dotted/dashed/solid/double/thick, up to 10px wide at `STRIPE_EDGE_INSET = 4`px inset). Only the interactive zone + icon reveal go; the stripe (and the row overlays: scanlines/hazard/data-rain/flair) stay.
- Row content start shifts on coarse from `pl-[30px]` to **≈16px** (4px stripe inset + 10px max stripe width + 2px clearance). Names gain ~14px, of which 8 fund the wider rail (48→56). Fine-pointer geometry (`pl-[30px]`, zone x = 0…26) untouched.

### 4. Session card (coarse-only surface)

Rail tap/scrub on a session row opens a card for it, using the same bottom-start/top-start placement + width-cap containment machinery as the window card (`row-flyout-card.tsx:699-746`):

- **Title bar** via the shared `PopupTitleBar`: `Session <name>` (secondary literal + primary name — the identity-tip grammar, `session-row.tsx:331-336`).
- **One facts line**: `$id · N windows · ~path` — the identity-tip content verbatim (`sessionId`/`sessionPath` already ride the session payload; underivable segments are omitted, exactly like `tipBody` at `session-row.tsx:132-138`; path `~`-abbreviated via `abbreviateHomePath`).
- **Action rows**, in order: `Change color…` (decision 7), `Spawn agent…` (**only when the consumer wires the existing optional `onSpawnAgent`** — the board-route sidebar wires none, so no row there), `New window` (→ existing `onCreateWindow` path), `Kill session` (red `hover:text-signal-red`, sub-hint `confirms first` — the existing kill-dialog path via `onKillClick(server, name, windowCount, false)`; never force-kill on touch).
- The desktop session **identity tip** (hover-only, non-interactive, coarse-suppressed — `identity-tip.tsx:60`) stays exactly as-is.

### 5. Server card (coarse-only surface)

Rail tap/scrub on a server-group header opens:

- **Title bar**: `Server <name>`.
- **Facts line**: `tmux -L <name> · N sessions` (server names ARE socket names — the ServerPanel tile identity-tip wording; session count from the group's own data).
- **Action rows**: `Change color…` (opens the server-group color popover, decision 7), `New session` (→ existing `onCreateSession(server)` instant create), `Kill server` (red, sub-hint `confirms first` — routes through the existing `killServerTarget` dialog via `onKillServer(server)` → `requestKillServer`; the rk-daemon warning line renders as today, `server-dialogs.tsx`).
- Desktop group headers unchanged.

### 6. Header clusters removed on coarse

- The session-row 4-icon cluster (palette/bot/plus/kill, `session-row.tsx:263-311`) and the server-group header cluster (palette/plus/close, `index.tsx:2363-2419`) become **render-gated `!coarse`** — the same relocation window rows went through in #634/#639 (the `!coarse` gate at `window-row.tsx:663`). Their actions live in the cards (decisions 4-5). Desktop clusters unchanged, including hover-reveal treatments and Tips.
- This retires the current always-visible coarse fallbacks (`coarse:opacity-100`, `coarse:min-w-[32px] coarse:min-h-[36px]` on those cluster buttons) at those two tiers.

### 7. `Change color…` is the FIRST action row of every card

- On ALL THREE tiers, wording exactly **`Change color…`**, and on the WINDOW card it renders on **BOTH pointer worlds** (the window card exists on desktop too), **above Fork** — the card's row order becomes Change color → Fork → Pin → Kill.
- **Mechanism: the Pin-row idiom** (`row-flyout-card.tsx:513-529` — close the card, then invoke): close the card, open the existing picker for that tier:
  - window: the combined Label picker `SwatchPopover` via the row's `setShowLabelPicker(true)` (`window-row.tsx:199,801-824`);
  - session: the session color popover the header palette icon opens today (`showColorPicker` → `SwatchPopover`, `session-row.tsx:312-327`);
  - server: the server-group color popover (`showColorPicker` → portalled `SwatchPopover`, `index.tsx:2298,2422`).
- The flyout `suppressed` gates already include the pickers where they exist (window row passes `ghost || showPinPopover || showLabelPicker`, `window-row.tsx:222`) — **extend the same precedence for session/server** (their card hooks suppress while their color popover is open, so popover-over-card precedence holds at every tier).
- Optional-handler gating follows the card's established idiom: a consumer wiring no color path for a tier renders no `Change color…` row (and throws nothing).

### 8. Held-rail highlight (all tiers, including the already-shipped window rail)

- While a row's card is open (tap-held or mid-scrub), that row's rail **lightens**: band background steps up one shade, seam brightens. No highlight at rest.
- Keyed on the **row-local open state** — the window row's `flyout.open` held-state precedent (`window-row.tsx:332-340,372-378` already keys the row's held hover-shade on `flyout.open`); the rail treatment joins the same key. It **travels row-to-row during a scrub** for free, because retargeting closes the previous row's card and opens the next one's (single-open coordinator).
- Shade derivation reuses the existing tint idioms (e.g. the `color-mix` step the selected rail already uses) — no new tokens.

### 9. Cross-tier scrub

- Sliding along the strip retargets cards across **ALL rows**: window, session, and server rows register in the **same module-scoped scrub registry** (`flyoutScrubTargets`, `row-flyout-card.tsx:131` — one `Map<HTMLElement, () => void>` beside the `activeFlyout`/`lastClosedAt` coordinator; `resetFlyoutWarmState()` keeps clearing it).
- The hit-test generalizes beyond `'[role="treeitem"][data-window-id]'` (`scrubTargetAt`, `row-flyout-card.tsx:137-144`, and the start-handler `closest` at `window-row.tsx:252`) to also match session/server rail rows — **mechanism free** (e.g. a shared data attribute on rail-bearing rows), with both ends of the gesture keeping the IDENTICAL selector. Note: session rows are `role="treeitem"` with `data-session-row` (no `data-window-id`); server-group headers are not treeitems at all — the shared-attribute route covers all three shapes.
- Suppressed rows (ghosts, open pickers/popovers) are skipped as today via `openNow()`'s `suppressed` early-return; single-open + warm-window semantics unchanged.

### Alternatives rejected (user decisions, verbatim)

- **Rail-hold palette reveal** — obsolete: the coarse zone is gone and `Change color…` is the discoverable path.
- **Desktop session/server cards** — identity tips + hover clusters already serve fine pointers; cards exist where their trigger — the rail — exists.
- **Keeping header clusters beside the rail** — cramped, breaks the strip.
- **Uniform wording "Change label…"** — user chose `Change color…` everywhere.

### Constraints (binding)

- **Render-performance invariants are hard and now extend to `SessionRow`/`ServerGroup`** (both `memo`'d — `session-row.tsx:347`, `index.tsx:2712`): card/open state stays row-local, registry stays module-scoped, no new subscriptions/ticks in rows, no lifted state (`sidebar.md` § Render Performance — the R6a parent-callback invariant especially: no inline arrows at `AppShell`/`BoardPage`, new per-row handlers are identity-arg `useCallback`s).
- **Reuse, don't duplicate**: ONE card system — generalize `useRowFlyout`/the card shell for the two new tiers or extract the shared shell (implementation freedom, but ONE placement/containment/held-state implementation); ONE scrub registry; existing pickers/dialogs/handlers (`onSpawnAgent`, kill dialogs, color popovers); `PopupTitleBar` for the card title bars (it already carries the identity-tip grammar).
- **Constitution IV**: no new surfaces beyond the cards the rail triggers. **Constitution V**: desktop keyboard paths unchanged; card rows Tab-reachable (the existing `FloatingFocusManager` `order={["reference","content"]}` pattern); palette parity untouched — every relocated action retains its palette/desktop path (session/server kill + color + create all keep their palette entries and desktop clusters).
- **Tests**: unit (`window-row.test.tsx`, `row-flyout-card.test.tsx`, `session-row.test.tsx`, `index.test.tsx` as applicable) + e2e — extend `tests/e2e/row-flyout.spec.ts` (+ sibling `.spec.md` in the SAME commit, per constitution) and update #639 assertions whose geometry moves (left zone gone on coarse → content start; 56px rail; held highlight); add session/server rail coverage (tap opens card, actions route, scrub crosses tiers). hasTouch emulation; `just test-e2e` / `just pw` only (port-3020 isolation — never raw playwright).

## Affected Memory

- `run-kit/ui/sidebar`: (modify) Rail extension to session rows + server-group headers (§ Sidebar Row Icon System scope, § Rest-state PR glyph geometry), coarse label-zone removal + content-start shift (§ Left-Edge Label Zone, § Row Anatomy), session-row/server-group cluster `!coarse` gating (§ session-row, § Server-group header action cluster), 56px rail width, render-performance notes extending to SessionRow/ServerGroup rails/cards.
- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card — three-tier card system (session/server cards, their content + action rows), `Change color…` first-row on all tiers, held-rail highlight keyed on row-local open state, cross-tier scrub registry + generalized hit-test, `STATUS_RAIL_WIDTH_PX` 48→56 and the coarse width-cap consequence.

## Impact

- **Code** (all under `app/frontend/src/components/sidebar/` unless noted):
  - `row-flyout-card.tsx` — `STATUS_RAIL_WIDTH_PX` 48→56; card shell generalization for session/server tiers (or extracted shared shell); `Change color…` action row (first, all tiers, both pointer worlds on window); scrub hit-test generalization; registry accepts all rail-bearing rows.
  - `window-row.tsx` — `coarse:pr-[48px]`→`[56px]`; label zone + icon reveal gated `!coarse` while the marker stripe stays; coarse content start `pl-[30px]`→≈16px (coarse-only class split); held-rail highlight on `flyout.open`; `Change color…` wiring via `setShowLabelPicker(true)`.
  - `session-row.tsx` — coarse rail + card wiring (suppression incl. `showColorPicker`); 4-icon cluster gated `!coarse`; scrub registration.
  - `index.tsx` (ServerGroup) — coarse rail + card wiring on the group header; 3-icon cluster gated `!coarse`; scrub registration; card actions bound to existing `onCreateSession`/`onKillServer`/`handleServerColorChange` seams (referential stability preserved for the memo contract).
  - `identity-tip.tsx` — untouched (desktop-only surface stays as-is).
- **Tests**: `window-row.test.tsx`, `row-flyout-card.test.tsx`, `session-row.test.tsx`, `sidebar/index.test.tsx`; e2e `tests/e2e/row-flyout.spec.ts` + `.spec.md` (extend + update moved #639 geometry assertions).
- **No backend, no API, no new data plumbing.** No route changes. Desktop behavior changes ONLY where stated (the window card gains the `Change color…` row on fine pointers too).

## Open Questions

- None. (Promptless dispatch — no would-be questions scored below the Unresolved threshold; the v4 mock pins all consequential values.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Rail extends to session rows + server-group headers on coarse: same inset band + 1px seam, 16px always-empty glyph slot + 12px `›` chevron, non-ghost only, never on fine pointers | User-approved v4 mock, exact values given; shipped window rail verified at `window-row.tsx:754-788` | S:95 R:70 A:90 D:95 |
| 2 | Certain | Rail width 48→56 on coarse, all tiers, via `STATUS_RAIL_WIDTH_PX` + matching `coarse:pr-[56px]` literal; coarse card width cap follows | Exact value from mock; constant + literal-coupling rule verified (`row-flyout-card.tsx:75`, `window-row.tsx:357-360`) | S:95 R:85 A:95 D:95 |
| 3 | Certain | Coarse left-zone reclaim: interactive zone + icon reveal desktop-only; marker stripe stays on coarse; content start ≈16px coarse-only; fine geometry untouched | User decision with arithmetic (4+10+2); supersedes hwtr's touch-zone wiring by explicit approval | S:95 R:75 A:90 D:90 |
| 4 | Certain | Session card: `Session <name>` title, `$id · N windows · ~path` facts (identity-tip content, omission-degrading), actions Change color…/Spawn agent… (onSpawnAgent-gated)/New window/Kill session (red, confirms first) | Exact content list from mock; payload fields verified riding session data (`session-row.tsx:132-138`) | S:95 R:70 A:90 D:95 |
| 5 | Certain | Server card: `Server <name>`, `tmux -L <name> · N sessions`, actions Change color…/New session/Kill server via existing `killServerTarget` dialog (daemon warning kept) | Exact content from mock; kill path verified (`onKillServer` → `requestKillServer` → `server-dialogs.tsx`) | S:95 R:70 A:90 D:95 |
| 6 | Certain | Session-row 4-icon + server-header 3-icon clusters render-gated `!coarse`; desktop clusters unchanged | User decision mirroring the shipped #634/#639 window-row relocation (`window-row.tsx:663` precedent) | S:95 R:75 A:95 D:95 |
| 7 | Certain | `Change color…` is the FIRST action row of every card, exact wording on all tiers, window card on both pointer worlds above Fork; mechanism = Pin-row idiom (close card → open that tier's existing picker); suppressed gates extended to session/server pickers | User chose wording + position + mechanism explicitly; Pin-row idiom + window suppression verified (`row-flyout-card.tsx:513-529`, `window-row.tsx:222`) | S:95 R:80 A:90 D:90 |
| 8 | Certain | Cross-tier scrub: one module-scoped registry for all three tiers; hit-test generalized beyond `[role="treeitem"][data-window-id]` with both gesture ends sharing the identical selector; suppressed rows skipped as today | User decision; registry + selector verified (`row-flyout-card.tsx:131,137-144`; `window-row.tsx:252`); mechanism explicitly free | S:90 R:70 A:85 D:85 |
| 9 | Confident | Held-rail highlight exact shades: "one shade up + brighter seam" realized via the existing tint idioms (e.g. the selected rail's `color-mix` step), keyed on row-local `flyout.open` | Direction + key pinned by mock ( `flyout.open` precedent verified at `window-row.tsx:332-340`); exact percentages left to apply — one obvious idiom, trivially reversible CSS | S:70 R:90 A:80 D:70 |
| 10 | Confident | Per-tier band tint formula: session/server rails mix their header family tints into the inset base the way the window rail's selected variant does; exact mix ratios apply-time | Mock says "derived from existing tint systems" without ratios; the `color-mix` idiom is the single established pattern (`window-row.tsx:385-392`) | S:70 R:85 A:85 D:70 |
| 11 | Confident | Card-shell reuse shape: generalize `useRowFlyout` or extract a shared shell — apply's choice, bound to ONE placement/containment/held-state implementation | Explicit implementation freedom in the description; the ONE-implementation constraint is the binding part | S:80 R:60 A:85 D:65 |
| 12 | Confident | Optional-handler gating governs every new card row: a tier/consumer wiring no handler (board-route `onSpawnAgent`, absent color seams) renders no row, no error | Not restated per-row in the mock but it is the card's established idiom (`onFork`/`onPinAction`/`onKillAction`) and the description invokes it for Spawn agent… explicitly | S:65 R:85 A:90 D:80 |
| 13 | Confident | Server card session count derives from the group's own session list (the display the header already represents); no new fetch | "Counts already ride the payloads" + no-new-plumbing constraint; exact source (group sessions vs `ServerInfo.sessionCount`) is apply-time with a clear front-runner | S:65 R:90 A:80 D:70 |
| 14 | Certain | Render-perf invariants extend to SessionRow/ServerGroup: row-local card state, module registry, no new subscriptions/ticks, R6a referential stability of new handler props | Stated as a hard constraint; memo tree verified (`session-row.tsx:347`, `index.tsx:2712`, sidebar.md § Render Performance) | S:95 R:70 A:90 D:95 |
| 15 | Certain | Frontend only; tests = named unit suites + `row-flyout.spec.ts`/`.spec.md` same-commit + #639 geometry-assertion updates + session/server rail coverage; hasTouch; `just test-e2e`/`just pw` only | Stated verbatim; constitution (.spec.md rule) + project context (port-3020 isolation) confirm | S:95 R:85 A:95 D:95 |

15 assumptions (10 certain, 5 confident, 0 tentative, 0 unresolved).
