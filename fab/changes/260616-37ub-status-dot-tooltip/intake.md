# Intake: Custom Status-Dot Tooltip / Hover-Card

**Change**: 260616-37ub-status-dot-tooltip
**Created**: 2026-06-16

## Origin

Initiated conversationally via `/fab-discuss` followed by `/fab-new`. The user's framing:

> "Right now, the status dots (on the left panel SESSIONS section, dashboard and the PANE section on the left panel) — all use HTML tooltips. I am thinking its time we built our own custom tooltip — so we can control both the looks and the timing of the tooltips. And allow embedding links on icons on the tooltips. Thoughts?"

The discussion established that the link requirement *forces* a custom component (native `title` is a plain string — it cannot contain interactive elements), and that "embed links" implies **hover-card semantics** (move-into-card-to-click), not pure tooltip semantics (which dismiss on pointer-leave). The user clarified the design is **"somewhere in between"** a static styled tooltip and a full interactive hover-card: mostly static text, plus a small set of interactive affordances.

Key decisions reached in conversation:
- **Positioning library**: `@floating-ui/react` (user-selected) — headless, ~10kb, solves portaling out of `overflow:hidden`, edge-flipping, and the `safePolygon` needed to cross from dot → card to click a link. Keeps full styling control (the stated goal). This is the first floating-element dependency in the frontend.
- **Docs-link icon**: an "open window" glyph on every tooltip → opens `docs/site/status-dot.md` **at the top** (user: "can open just the doc top"), in a new tab.
- **Fab-phase links**: **none.** The user confirmed there *is* an in-app route to a change, but decided **not to link it** ("for the fab-phase — we wouldn't link anything").
- **PR-phase links**: a single "Open PR #N" link (uses the existing `prUrl`). The originally-considered separate "view checks" link was **dropped** — `WindowInfo` carries only `prUrl` (no dedicated checks URL; verified against `app/frontend/src/types.ts:69-76`), and hardcoding `${prUrl}/checks` is a brittle GitHub-convention assumption that would also touch the backend. GitHub's PR page surfaces checks inline anyway.
- **Accessibility**: keep `aria-label` on the dot (the screen-reader name); **drop `title`** to avoid a double native+custom tooltip.

## Why

1. **Problem**: The status dots on three surfaces (sidebar SESSIONS rows, dashboard cards, pane-panel header) all rely on the native HTML `title` attribute for their tooltip. Native `title` has three hard limits: (a) the open delay is browser-fixed (~1.5s) and uncontrollable, (b) it cannot be styled to match the terminal aesthetic, and (c) **it cannot contain links or any interactive content** — it is a plain string.

2. **Consequence if unfixed**: We can never surface contextual actions (open the PR, jump to the docs that explain the dot's state vocabulary) from the dot. The dot communicates a state via hue+shape, but the only path to "what does this mean / where does it lead" is the slow, unstyled native tooltip — a dead end for discoverability. The keyboard-first / Cmd+K-discovery posture (Constitution V) is undercut: a native tooltip is mouse-hover-only with no focus affordance.

3. **Why this approach**: A headless floating-element library (`@floating-ui/react`) gives total visual control (meets "control the looks") while solving the genuinely hard parts — portaling out of the sidebar's `overflow:hidden` clipping (documented in `context.md`), viewport-edge collision/flip, and the `safePolygon` hover-bridge that makes links inside the card actually clickable. Hand-rolling positioning was considered and rejected: it would reimplement flip/collision/safe-polygon and *still* require a portal to escape `overflow:hidden`, so it carries the same conceptual footprint with more bug surface. The existing hand-rolled popovers (`SwatchPopover`, `PinPopover`) are click-anchored to a known corner and don't face the scrolling/edge/clip problem the dots do.

## What Changes

### New dependency

Add `@floating-ui/react` to `app/frontend/package.json` (via pnpm). First floating-element dependency in the frontend; no other tooltip/popover library exists today.

### New component: status-dot hover-card

A new component (e.g. `app/frontend/src/components/status-dot-tip.tsx`) that wraps the dot with a floating hover-card. Wiring:

- `useFloating` + `offset()` + `flip()` + `shift({ padding })` for collision-aware placement.
- `FloatingPortal` → renders to `document.body`, escaping the sidebar/app-shell `overflow: hidden` clipping.
- `useHover(context, { delay: { open: 150, close: 100 }, handleClose: safePolygon() })` — snappy open, short close-grace, and the safe-polygon bridge so the pointer can travel dot → card to click a link without the card vanishing.
- `useFocus` + `useDismiss` + `useRole` — focus-open (keyboard-first, Constitution V), Escape-to-dismiss, correct ARIA.

Exact open/close delay values (150ms / 100ms) are a reasonable default and tunable — recorded as a Tentative assumption.

### Content-resolution function

A pure function mapping a window + its derived `StatusDotState` to tooltip content, owned alongside `StatusDot`:

```ts
type DotLink = { label: string; href: string; testid: string };
type DotTipContent = { label: string; links: DotLink[] };

function dotTipContent(win: WindowInfo, state: StatusDotState): DotTipContent {
  const label = dotLabel(win, state);            // REUSE existing dotLabel() — single source of truth
  const links: DotLink[] = [];
  if (state.phase === "pr" && win.prUrl) {
    links.push({ label: `Open PR #${win.prNumber}`, href: win.prUrl, testid: "dot-tip-pr-link" });
  }
  return { label, links };
}
```

The docs-link icon is **not** in `links[]` — it is a fixed element the card always renders (constant href to `docs/site/status-dot.md`), so it does not flow through per-state logic.

### The full state matrix (what text/links each dot shows)

Driven by `statusDotState()` three-way precedence (PR > fab > tmux). Tooltip text = existing `dotLabel()` output — **unchanged**; this change only restyles the surface and adds links.

**PR phase** (change-bound AND has PR) — link: "Open PR #N" (always, when `prUrl` present):

| Condition | Tooltip text |
|---|---|
| `prState === "merged"` | `PR — merged` |
| failish (checks fail OR changes_requested) | `PR — failing` |
| `prChecks === "pending"` | `PR — checks running` |
| `prChecks === "pass"` | `PR — open` |
| neutral + closed | `PR — closed` |
| neutral, open/aged-merge | `PR — open` |

**Fab phase** (change-bound, no PR) — **no links**. Text = `{fabStage} — {status}`, e.g. `intake — pending`, `apply — active`, `review — failed`, `hydrate — done`, `ship — active`, `review-pr — done`, `apply — skipped`.

**tmux fallback** (no fab change) — **no links**. Text = bare activity word: `active` / `idle`.

**All three phases** carry the docs-link icon → `docs/site/status-dot.md` (top).

### `StatusDot` integration

`StatusDot` (`status-dot.tsx`) renders the dot wrapped by the new hover-card component. It already has `win` and computes `state`, so it owns the decision of which links to show. **Drop the `title` attribute** from the `common` object (keep `role="img"` + `aria-label`). The three call sites stay one-liners (`<StatusDot win={win} />`) — untouched.

### Click-through guard

In the sidebar, the dot sits inside a clickable window row. Card links MUST `stopPropagation` on click so opening the PR / docs does not also select/navigate the window — the existing `PrStatusLine` link already does exactly this (`pr-status-line.tsx:272`); reuse the pattern.

### Tests

- **Unit** (`status-dot.test.tsx`): update the two existing assertions that check `title` (the attribute is removed — assert on `aria-label` instead). Add tests for `dotTipContent`: PR-phase → one link with correct `href`; fab/tmux → zero links; label text unchanged. Content is jsdom-testable; positioning is not.
- **E2E** (Playwright, new `*.spec.ts` + sibling `*.spec.md` per Constitution): hover dot → card appears (snappy); move into card → click PR link / docs icon; focus dot → card opens (keyboard); Escape dismisses.

## Affected Memory

- `run-kit/ui-patterns`: (modify) StatusDot section — record the new custom hover-card (floating-ui based) replacing native `title`, the docs-link icon, PR-phase "Open PR" link, drop-of-`title`, and the `safePolygon`/portal/focus-open behavior.

## Impact

- **New dep**: `@floating-ui/react` (`app/frontend/package.json`, lockfile).
- **New file**: status-dot hover-card component + `dotTipContent` (`app/frontend/src/components/`).
- **Modified**: `status-dot.tsx` (render card, drop `title`); `status-dot.test.tsx` (assertions).
- **New tests**: Playwright `*.spec.ts` + `*.spec.md`.
- **Untouched**: the three call sites — `sidebar/window-row.tsx:260`, `dashboard.tsx:135`, `sidebar/status-panel.tsx:119` — still `<StatusDot win={win} />`.
- **No backend changes**, no new `WindowInfo` field, no new route (Constitution IV/II preserved).
- **Redundancy note**: the pane panel and dashboard already render `PrStatusLine` with an inline PR link; the card's PR link is *most* valuable in the dense sidebar. Rendered uniformly anyway (one component) — not net-new info on those two surfaces, but consistent.

## Open Questions

- Open/close delay tuning (150ms/100ms is the proposed default — fine to adjust after seeing it live).
- Whether the docs-link icon should eventually deep-link per-state (`status-dot.md#pr-failing`) — explicitly deferred; top-of-doc for now.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `@floating-ui/react` for positioning/portal/flip/safe-polygon | User explicitly selected it in `/fab-discuss`; headless preserves full styling control; solves the `overflow:hidden` clip + edge-flip + hover-bridge that hand-rolling cannot avoid | S:95 R:80 A:90 D:95 |
| 2 | Certain | Docs-link icon opens `docs/site/status-dot.md` at the top, new tab | User: "can open just the doc top"; the doc + `status-dot-matrix.svg` already exist | S:95 R:90 A:95 D:95 |
| 3 | Certain | Fab-phase dots carry NO links (only text + docs icon) | User: "for the fab-phase — we wouldn't link anything" (despite an in-app change route existing) | S:95 R:85 A:95 D:95 |
| 4 | Certain | PR-phase dots carry a single "Open PR #N" link via existing `prUrl` | Discussed and agreed; `prUrl` already on `WindowInfo` and already linked by `PrStatusLine` | S:90 R:85 A:95 D:90 |
| 5 | Certain | Drop the separate "view checks" link | `WindowInfo` has only `prUrl` (verified `types.ts:69-76`); deriving `/checks` is brittle + would touch backend; GitHub shows checks inline | S:90 R:80 A:90 D:90 |
| 6 | Certain | Keep `aria-label` on the dot; drop `title` (avoid double tooltip) | Constitution V (keyboard-first) + colorblind a11y require the accessible name; native `title` would duplicate the custom card | S:90 R:85 A:95 D:90 |
| 7 | Confident | Tooltip text reuses existing `dotLabel()` output unchanged | The label vocabulary (PR/fab/tmux matrix) is already correct and tested; this change restyles the surface, not the content | S:85 R:80 A:90 D:85 |
| 8 | Confident | One component owned by `StatusDot`; three call sites untouched | StatusDot is already the shared component across all three surfaces and has `win`+`state`; scattering wrappers would duplicate logic (anti-pattern) | S:85 R:75 A:90 D:85 |
| 9 | Confident | Card links `stopPropagation` on click (no row select/navigate) | Mirrors the proven `PrStatusLine` link pattern (`pr-status-line.tsx:272`); the dot sits inside a clickable row | S:85 R:85 A:90 D:85 |
| 10 | Confident | Focus-open + Escape-dismiss + safePolygon hover-bridge | Keyboard-first constitution requires focus reachability; safePolygon is the floating-ui idiom for clickable hover content | S:80 R:80 A:85 D:80 |
| 11 | Tentative | Open/close delays of 150ms / 100ms | Reasonable snappy default but not validated against feel; trivially tunable post-implementation | S:55 R:95 A:55 D:65 |
| 12 | Tentative | Component file named `status-dot-tip.tsx`, content fn `dotTipContent` | Follows existing kebab-case component naming; exact name is cosmetic and reversible | S:60 R:95 A:70 D:70 |

12 assumptions (6 certain, 4 confident, 2 tentative, 0 unresolved).
