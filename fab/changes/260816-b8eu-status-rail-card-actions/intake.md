# Intake: Right-edge status rail + contained mobile card + explicit card actions

**Change**: 260816-b8eu-status-rail-card-actions
**Created**: 2026-08-16

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake, `{questioning-mode} = promptless-defer`) from a user-approved design description. The design was iterated twice in an HTML mock session; the user chose rail treatment "A" (recessed inset band) over two alternatives (B grip dots, C accent edge glow). This change builds directly on merged PR #634 (`ys3q` — coarse-pointer dot-tap + slide-to-scrub flyout, Pin/Kill card action rows), whose memory is already hydrated in `docs/memory/run-kit/ui/status-signals.md` § Row-hover register flyout card and `docs/memory/run-kit/ui/sidebar.md` § Rest-state PR glyph.

> Title direction: Right-edge status rail + contained mobile card + explicit card actions (sidebar window rows).
>
> **Problem.** PR #634 (merged, released) gave mobile the flyout card via dot-tap + scrub, but two usability gaps surfaced immediately on-device: (a) it is not discoverable that the status DOT is the touch target — a ~7px dot with no affordance; (b) the card anchors at the row's right edge (`placement: "right"`), and in the mobile drawer (88%/max-320px) only ~45–55px of viewport remains, `flip()` has no room on either side, so the card renders clipped/off-screen.

(Full decision list reproduced verbatim in **What Changes** below — the description carried exact values and they are preserved, not summarized.)

## Why

1. **Pain point** — two on-device usability failures in the just-shipped #634 mobile flyout:
   - **Discoverability**: the coarse-pointer open gesture targets the leading `status-dot-tap` span (32×36px around a 7px dot, `window-row.tsx:587-597`). Nothing on the row *looks* tappable, so users don't find the card at all.
   - **Containment**: `useRowFlyout` positions the card with `placement: "right"` (`row-flyout-card.tsx:642`). In the mobile drawer (`w-[88%] max-w-[320px]`, `shell/shell.tsx:304`) a 375px viewport leaves ~45px to the drawer's right; `flip()` to the left has no room either (the card is wider than the drawer's free space over the rows), so the card clips off-screen — the feature is effectively broken on the device class it was built for.
2. **Consequence of not fixing** — the mobile status-detail surface (the whole point of #634's coarse arm) is undiscoverable and unusable on phones; pin/kill on touch (which live *only* on the card's action rows on coarse) are unreachable.
3. **Why this approach** — the rail gives the gesture a *visible, learnable home* inside the existing row (no new surface — Constitution IV); anchoring the card below the row with a width cap keeps the finger's column visible during a scrub and guarantees on-screen rendering; consolidating actions as explicit labeled card rows (one card, both pointer worlds) removes the fork icon's second home and makes the card self-explanatory. Alternatives (grip dots, accent glow, title-bar fork, left-edge rail) were explicitly rejected in the mock session — see **Alternatives rejected**.

## What Changes

Frontend only. No backend, no new data plumbing — every input the rail and card need already rides `WindowInfo` / existing props.

### 1. Right-edge status rail (coarse pointers, window rows only) — `window-row.tsx`

The trailing 48px of every **non-ghost** window row becomes a visually-treated tap/scrub zone on coarse pointers:

- **Visual**: a recessed inset band — `bg-inset`-family background (`--color-bg-inset` token, `globals.css:32`; no new color tokens), 1px left seam border (`border-l border-border` family); a **darker selected-tint variant** on the selected row (derived from the existing tint system — `tint.selected` / inset mix — never a new hex).
- **Two FIXED slots** so glyphs/chevrons column-align down the sidebar:
  - a **16px PR-glyph slot** — an empty span when the row owns no PR; when owned, the existing state-picked `GitPullRequestIcon` / `GitPullRequestClosedIcon` colored by `prGlyphColor(win)`, gate `prOwnsGlyph(win)` — both unchanged (`window-row.tsx:663-671` is the current absolute-overlay rendering; on coarse the glyph MOVES into this rail slot).
  - a **12px chevron hint slot** — a muted `›` at ~55% opacity, rendered on EVERY row (a consistent rail is a learnable rail), including PR-less rows.
- **Presence**: every non-ghost window row on coarse. The rail **does not exist on fine pointers** — the desktop hover cluster (pin/✕ reveal, glyph display-swap, `window-row.tsx:639-711`) is unchanged.
- The row button's reserved right padding (`pr-[68px]` / `pr-11`, `window-row.tsx:351`) gains a coarse-variant reserve so the window name truncates before the rail column.

### 2. Rail = primary scrub/tap target — `window-row.tsx` (+ shared registry in `row-flyout-card.tsx`)

- The rail carries `touch-action: none` and the full #634 gesture: pointerdown-open (`flyout.openNow()`) + pointer-capture + pointermove-retarget (via the exported `scrubTargetAt` + module-scoped `flyoutScrubTargets` registry + `activeFlyout` single-open coordinator, `row-flyout-card.tsx:87-131`) + release-keeps-open. **Reuse the existing `onScrubStart`/`onScrubMove`/`onScrubEnd` handlers (`window-row.tsx:245-274`) — never duplicate the gesture.**
- The existing dot-tap zone (the `status-dot-tap` span with its `coarse:min-w-[32px] coarse:min-h-[36px] coarse:touch-none` geometry, `window-row.tsx:588-594`) **keeps working as a secondary target sharing the same handlers**.
- Row-body taps still navigate (`onSelectWindow` path unchanged); drawer scrolling from anywhere outside the rail (and outside the dot zone) is untouched; the scrub still never selects/navigates, and the `onDragStart` scrub guard (`window-row.tsx:436-439`) still applies.

### 3. Mobile drawer widened — `shell/shell.tsx:304`

The drawer aside goes from `w-[88%] max-w-[320px]` to ≈ `w-[92%] max-w-[340px]` (single classlist edit on the `<aside>`; nothing in `shell.test.tsx` or any e2e asserts the current width — verified by grep).

### 4. Card placement fix (coarse only) — `row-flyout-card.tsx`

- On **coarse** pointers the flyout card anchors BELOW the row: `placement: "bottom-start"` with fallback `top-start` near the drawer bottom (e.g. `flip({ fallbackPlacements: ["top-start"] })`). Desktop keeps `placement: "right"` **exactly as today** (`row-flyout-card.tsx:637-655`: `strategy: "fixed"`, `offset(6)`, `flip()`, `shift({ padding: 8 })`, `arrow()` all stay; only placement becomes pointer-conditional — `useCoarsePointer` is already imported by `window-row.tsx:14` and can be consumed by the hook).
- The card's width is capped so its **right edge stops BEFORE the rail column**: card max-width ≈ drawer width − 48px rail − margins. The card must **never overlap the rail** (the finger's column stays visible/touchable during a scrub) and **never render off-screen**.
- The `FloatingArrow` notch points **up at the rail** on coarse (the `notchFill` title-band seam logic, `row-flyout-card.tsx:760-771`, must keep working for the new arrow side).

### 5. Explicit card action rows (BOTH desktop and mobile — one card everywhere) — `row-flyout-card.tsx` + `window-row.tsx`

The action area at the card's bottom becomes a **sectioned list**: top border separating it from the registers/freshness block, one row per action, inter-row hairlines. Order and content:

1. `⑂ Fork conversation` — sub-hint "new window, same directory" (matches the existing `FORK_TOOLTIP` constant, `row-flyout-card.tsx:246`). Keeps the existing **double gate** (`canForkWindow(win)` — `chatProvider === "claude"`, `row-flyout-card.tsx:251-253` — AND an optional `onFork` handler) and the **in-flight busy guard** (leaf-scoped `busy` state + `mountedRef`, currently in `ForkLink`, `row-flyout-card.tsx:265-300` — the guard moves with the affordance into the row).
2. `Pin to board…` — pin icon (`PinIcon filled={pinned}`); sub-hint reflects pin state, e.g. "not pinned" / the board name (`pinnedBoard` is already a `WindowRow` prop, `window-row.tsx:123`, and can thread through `UseRowFlyoutOptions` beside the existing `pinned`). Keeps the #634 handler: `onPinAction` → close-card-then-`PinPopover` (`row-flyout-card.tsx:687-692`).
3. `✕ Kill window` — red treatment; sub-hint "confirms first". Keeps the #634 handler: `onKillAction` → `onKillClick(srv, session, windowId, false)` → `KillDialog` confirm, ctrl=false — never a force-kill (`window-row.tsx:231`).

- **Fork's title-bar icon is REMOVED** (`row-flyout-card.tsx:378` — `{onFork && canForkWindow(win) && <ForkLink onFork={onFork} />}` leaves the `PopupTitleBar` right slot). One affordance, one home. The title bar keeps **only** the ⓘ docs link (`InfoIcon` + `STATUS_DOT_DOCS_URL`).
- Row heights: **≥36px touch height on coarse, denser ~28px on fine pointers**.
- All rows `stopPropagation` (the existing idiom); Tab-reachable via the existing `FloatingFocusManager` `order={["reference", "content"]}` (`row-flyout-card.tsx:730-736`) — no focus-management changes.

### 6. Cleanup fold-in: unify the scrub hit-test selectors

`onScrubStart` uses `closest('[role="treeitem"]')` (`window-row.tsx:248`) while `scrubTargetAt` uses the stricter `'[role="treeitem"][data-window-id]'` (`row-flyout-card.tsx:127`). **Unify on the stricter one** (a #634 review nice-to-have).

### Alternatives rejected (in the mock session — record, do not revisit)

- Rail treatment **B** (grip dots — grips read as drag-to-reorder) and **C** (accent edge glow — green is a status hue; mixed signal on failing rows; no affordance on PR-less rows).
- Keeping fork in the title bar alongside the new action rows (two homes for one action).
- Leftmost-edge rail (the 26px label zone already owns the left edge on coarse — `window-row.tsx:766` `LABEL_ZONE_WIDTH = 26`, active on coarse).

### Constraints (hard)

- **Render-performance invariants** (`sidebar.md` § Render Performance): memo'd `WindowRow`, row-local flyout state, module-scoped (never context) coordination, card mounts only while open, no per-second ticks in rows. The rail is static per-render row content (its inputs — `coarse`, `ghost`, `prOwnsGlyph(win)`, `isSelected`, tint — are already row props/derivations), so it adds no new subscriptions.
- **Constitution IV** (no new surfaces — the rail lives inside existing rows; the card absorbs actions) and **V** (keyboard: desktop hover cluster unchanged, card rows Tab-reachable, palette paths untouched).
- **Tests**: unit — `window-row.test.tsx`, `row-flyout-card.test.tsx`, shell/drawer width only if asserted anywhere (verified: it is not). E2E — extend `app/frontend/tests/e2e/row-flyout.spec.ts` AND its sibling `row-flyout.spec.md` **in the same commit** (Constitution — Test Companion Docs). #634's e2e assertions need updating: the glyph now lives inside the rail on coarse (specs at `:316`, `:350`), the fork icon is gone from the title bar (specs at `:212`, `:249` — fork now asserted as a card action row), card placement on coarse is now bottom-start (coarse block `test.use({ hasTouch: true })` at `:337`). hasTouch coarse emulation; run only via `just test-e2e` / `just pw` (port-3020 isolation — never raw playwright).

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card — coarse placement `bottom-start`/`top-start` + width cap, rail as primary scrub target (dot-tap demoted to secondary), sectioned action rows (fork/pin/kill with sub-hints), fork removed from the title bar; § Rest-state PR glyph cross-references.
- `run-kit/ui/sidebar`: (modify) § Rest-state PR glyph (on coarse the glyph renders in the rail's fixed 16px slot instead of the absolute last-slot overlay; fine-pointer overlay unchanged), § Sidebar Row Icon System (rail geometry + chevron hint), § Sidebar → Mobile (drawer `w-[92%] max-w-[340px]`), § Render Performance (invariants re-affirmed, no new entries expected).

## Impact

- `app/frontend/src/components/sidebar/window-row.tsx` — rail rendering + gesture wiring + coarse right-padding reserve + glyph relocation on coarse + selector unification.
- `app/frontend/src/components/sidebar/row-flyout-card.tsx` — pointer-conditional placement + width cap, action-row section (fork row absorbing `ForkLink`'s gate/busy guard, pin sub-hint state, kill treatment), title-bar fork removal.
- `app/frontend/src/components/shell/shell.tsx` — drawer width classes (line 304).
- Tests: `window-row.test.tsx`, `row-flyout-card.test.tsx` (both exist), `app/frontend/tests/e2e/row-flyout.spec.ts` + `row-flyout.spec.md`.
- No Go, no API, no new routes, no new tokens, no new dependencies.

## Open Questions

- (none — the design was user-approved with specific values; residual choices are graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Rail treatment A: recessed inset band (`bg-inset` family, 1px left seam, darker selected-tint variant), two fixed slots — 16px PR glyph (empty span when unowned), 12px `›` chevron hint at ~55% opacity on every row | Discussed — user chose A over B (grip dots) and C (accent glow) in a twice-iterated mock session; exact slot sizes given | S:95 R:70 A:90 D:95 |
| 2 | Certain | Rail is coarse-only, non-ghost window rows only; desktop hover cluster (pin/✕ reveal + glyph display-swap) byte-identical | Stated verbatim in the approved description; `useCoarsePointer` gate already in the row | S:95 R:80 A:90 D:95 |
| 3 | Certain | Rail reuses the #634 gesture handlers verbatim (`onScrubStart/Move/End`, registry + `activeFlyout`) with `touch-action: none`; dot-tap zone kept as secondary target on the same handlers; row-body tap still navigates | Stated — "reuse, don't duplicate"; handlers exist at `window-row.tsx:245-274` | S:90 R:75 A:90 D:90 |
| 4 | Certain | Drawer widened to exactly `w-[92%] max-w-[340px]` at `shell/shell.tsx:304` | User gave the values (≈ marker tolerates ±, these are the stated numbers); trivially reversible one-line edit; no test asserts the old width | S:80 R:95 A:85 D:80 |
| 5 | Certain | Coarse card placement `bottom-start` with `top-start` fallback near the drawer bottom; desktop keeps `placement: "right"` unchanged; notch points up at the rail | Stated verbatim; floating-ui `flip({ fallbackPlacements })` is the one obvious mechanism | S:95 R:80 A:90 D:90 |
| 6 | Confident | Card width cap implemented as a coarse-only max-width so the right edge stops before the 48px rail column (≈ drawer width − 48px − margins; e.g. a `max-w-[calc(...)]`/`size()`-middleware cap replacing `max-w-xs` on coarse) | The invariant (never overlap the rail, never off-screen) is stated; the exact CSS/middleware mechanism is implementation freedom with a clear front-runner | S:70 R:85 A:80 D:65 |
| 7 | Certain | Action rows order fork → pin → kill as a sectioned list (top border, inter-row hairlines, sub-hints "new window, same directory" / pin state / "confirms first"); fork keeps `canForkWindow` + optional-`onFork` double gate and leaf-scoped busy guard; pin/kill keep #634 handlers (kill via KillDialog, ctrl=false); title bar keeps only the ⓘ docs link | Stated verbatim with exact copy; all gates/guards/handlers already exist and move, not change | S:95 R:75 A:90 D:95 |
| 8 | Confident | Pin sub-hint sources the board name from the existing `pinnedBoard` WindowRow prop (threaded into `UseRowFlyoutOptions` beside `pinned`); shows "not pinned" when unpinned, falls back to a bare pinned wording if `isPinnedToAny` is true but `pinnedBoard` is undefined | "sub-hint reflects pin state e.g. not pinned/board name" — `pinnedBoard` (window-row.tsx:123) is the only board-identity already at the row; the undefined-while-pinned edge is a degradation choice | S:70 R:85 A:85 D:70 |
| 9 | Certain | Action-row heights: `coarse:min-h-[36px]`, ~28px (`min-h-[28px]`) on fine pointers | Stated values; matches the row-cluster touch-target convention (context.md § Mobile Responsive Design) | S:80 R:90 A:85 D:80 |
| 10 | Certain | Selector unification lands on the stricter `'[role="treeitem"][data-window-id]'` in `onScrubStart` (`window-row.tsx:248`); `scrubTargetAt` unchanged | Stated ("unify on the stricter one"); one-line change, #634 review nice-to-have | S:90 R:90 A:95 D:95 |
| 11 | Confident | Coarse right-padding reserve: the row button's `pr-[68px]`/`pr-11` gains a coarse variant sized to the 48px rail so names truncate before it; fine-pointer padding untouched | Necessary consequence of the rail's geometry; exact class values are implementation detail with one obvious shape | S:70 R:90 A:85 D:75 |
| 12 | Confident | Chevron hint rendered as the text glyph `›` (muted, ~55% opacity), not a stroke SVG | Mock-approved glyph; the Icon-System "no text glyphs" rule governs *action* icons in the cluster — the chevron is aria-hidden decoration inside the rail; swapping to an SVG later is trivial | S:65 R:90 A:75 D:70 |
| 13 | Confident | Selected-row rail tint derives from the existing tint system (e.g. `tint.selected`/inset mix or the gray sentinel), introducing no new color tokens | "darker selected-tint variant" stated; the no-new-tokens constraint is established project law (themes/rowTints) | S:60 R:85 A:75 D:65 |

13 assumptions (8 certain, 5 confident, 0 tentative, 0 unresolved).
