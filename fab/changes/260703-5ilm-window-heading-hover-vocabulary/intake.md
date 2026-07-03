# Intake: Centered Window Heading & Hover-Animation Vocabulary

**Change**: 260703-5ilm-window-heading-hover-vocabulary
**Created**: 2026-07-03

## Origin

Synthesized from a user design conversation and dispatched promptless (defer-and-surface mode — no questions asked at intake; every decision below marked "user decided" was made explicitly in that conversation). The user explicitly decided both parts ship as **one** fab change.

> Centered top-bar window heading with in-place rename, plus a site-wide hover-animation vocabulary. Part A: add a centered heading to the terminal-route top bar showing the current tmux window name (e.g. `riff-gallant-jackal`) — highlighted, looks good, animates on hover ("decode" scramble), click gives in-place text edit for rename. Part B: a coherent hover-animation map where each treatment encodes exactly one category of element — glitch = brand, brackets + caret = page titles, caret-only = section labels, CRT glint = buttons. All animations behind `prefers-reduced-motion: reduce`.

A live HTML demo of all chosen treatments exists (scratchpad "heading-lab", served in a tmux iframe window) — a reference for intended feel only; NOT part of the repo change.

## Why

1. **Pain point**: The current top bar identifies the window only as the last breadcrumb crumb — small, left-packed, and visually undifferentiated. The window name is the single most important identity on the terminal route (it is what the operator stares at all day across many agent windows), yet it has no prominence and renaming it requires the sidebar's inline edit or the palette's rename dialog — there is no direct manipulation on the name itself.
2. **Consequence of not fixing**: Operators keep mis-identifying which agent window they're in when many windows share prefixes, and rename friction means stale auto-generated names (`riff-gallant-jackal` style) persist. The chrome also has zero motion language — hover states are flat color shifts, so interactive vs. decorative elements read ambiguously.
3. **Why this approach**: A centered, highlighted, editable heading gives the window name the prominence of a document title (the mental model: browser tab / editor title bar), and in-place editing is the lowest-friction rename. The hover-animation vocabulary is deliberately a *map* — one treatment per element category — so motion carries meaning instead of noise: glitch says "brand", decode says "editable identity", brackets+caret says "page title", caret says "label", glint says "button". Alternatives rejected in discussion: wave/glitch on the window heading (too noisy for chrome stared at all day — glitch went to the brand instead, one place); keeping the window name in the breadcrumb AND center (same string twice in one bar); splitting into two fab changes (user explicitly chose one); caret-as-edit-affordance on the heading (decode owns the editable element so caret consistently means "label").

## What Changes

### Part A — Centered window heading with in-place rename (terminal route)

#### A1. Header layout: flex → grid

`app/frontend/src/components/top-bar.tsx` — the header row (currently `<div className="flex items-center justify-between py-2">`, line 187) becomes CSS grid `grid-template-columns: 1fr auto 1fr` so the center cell is truly centered regardless of asymmetric left/right widths (user approved). Left cell = existing breadcrumb `<nav>`; center cell = new window heading; right cell = existing button cluster (right-aligned within its `1fr`).

#### A2. No duplication: breadcrumb ends at session; window switcher moves

The breadcrumb ends at the **session** crumb. Window identity moves to the center slot. The existing window `BreadcrumbDropdown` (switcher with `+ New Window` action) moves to a small `▾` button beside the centered heading — **name-click = edit, ▾-click = switch** (user approved). The centered heading renders only in `terminal` mode (`mode === "terminal"` with a `currentWindow`); root/board/cockpit modes keep their current layouts (empty center cell).

#### A3. In-place rename

Clicking the name swaps it for an inline `<input>` styled identically (monospace, centered, width sized in `ch`, grows as you type). **Enter commits, Escape cancels, blur commits.** Wire to the EXISTING `renameWindow()` in `app/frontend/src/api/client.ts:191` → `POST /api/windows/{windowId}/rename` (endpoint exists — `app/backend/api/router.go:367`; no backend changes). Use the existing `useOptimisticAction` + toast error pattern (as `SplitButton`/`ClosePaneButton` in top-bar.tsx do), and the established optimistic window-store rename (`renameWindowStore` `pendingName` + `clearRename`, as the sidebar's inline rename at `app/frontend/src/components/sidebar/index.tsx:397` does) so heading and sidebar stay consistent. Note: tmux `rename-window` disables automatic-rename for that window so the name sticks; SSE propagates the rename to the sidebar and other clients automatically (user approved). Empty/whitespace-only input on commit = cancel (matches the existing `renameName.trim()` guard in `use-dialog-state.ts`).

#### A4. Keyboard path (Constitution V)

A command-palette action renames the current window — click-only would violate the constitution (user approved). **Gap-analysis finding**: `Window: Rename` already exists (`app/frontend/src/app.tsx:898`, opens the rename dialog via `dialogs.openRenameDialog`). Rewire this existing action to trigger the new inline edit (e.g., a `CustomEvent` mirroring the `theme-selector:open` pattern) rather than adding a duplicate action; retire the rename-dialog path only if the palette was its sole entry point. The action stays registered/documented per the command-palette convention (code-review rule: new keyboard shortcuts documented in palette registration).

#### A5. Decode hover animation

Heading hover animation = **"decode"**: characters scramble through random glyphs and resolve left-to-right, ~28ms/frame, reveal ~0.9 chars/step (user chose decode explicitly). Three implementation guards agreed in discussion:

- (a) ~140ms hover-intent delay before the scramble starts, so cursor transit across the bar toward the right-side buttons doesn't replay it;
- (b) on edit start, cancel the scramble timer — the input binds to the real name state, never the scrambled DOM text;
- (c) the decode replays once after a committed rename, serving as the rename confirmation animation; optionally also replay when an SSE snapshot delivers an external name change (nice-to-have).

#### A6. Rest state ("highlighted")

Font-weight 600 + primary text color — the crumbs around it are dim/secondary, so weight+color alone read as highlighted.

#### A7. Mobile

The centered heading becomes the **mobile leaf** (mobile currently shows only brand icon + leaf crumb; intermediate crumbs are `hidden sm:flex`). The single-line 375px top bar must not wrap — long names truncate in the center cell.

### Part B — Hover-animation vocabulary (CSS-only, ~5 components)

Each treatment encodes exactly one category of element (user-assigned map):

#### B1. Glitch = brand only

One-shot RGB-split (~300ms, `text-shadow` keyframes, `steps(2)`) on the top-left "Run Kit" logo+wordmark chip (`top-bar.tsx` brand anchor, line 193) on hover. The wordmark is hidden below `sm`, so on mobile only the icon jitters — accepted.

#### B2. Brackets + caret = page titles

`app/frontend/src/components/page-heading.tsx` (one component serving both Cockpit `/` and Server Cabin `/$server`). Its existing dim `aria-hidden` bracket spans (`[` / `]`) step outward on hover (`transform: translateX(∓3px)`, no layout shift) and turn accent; a blinking block caret (`▊`, 1.06s `steps(1)` blink) appears in an **always-reserved cell** (transparent at rest, so width NEVER shifts) before the closing bracket — after the instance name in the `[ cabin · name▊]` form. Hover scope = the bracket group only (`page-heading.tsx:38`'s inner group), NOT the whole heading row — the rule and `side` slot must not trigger it.

#### B3. Caret-only = section labels

Blinking caret on hover for: sidebar panel headings (PANE / HOST / SESSIONS / SERVER / BOARDS — `app/frontend/src/components/sidebar/collapsible-panel.tsx:287` `uppercase tracking-wide` title span and `sidebar/index.tsx:1081`) and the Cockpit zone subheadings (HOST HEALTH / BOARDS / TMUX SERVERS / SERVICES — the `text-xs uppercase tracking-wide` h2s at `app/frontend/src/components/server-list-page.tsx:204,229,267,327`). Purely decorative and color-neutral (headings stay non-interactive-looking). Both idioms share one treatment (small shared component or utility class).

#### B4. CRT glint = buttons

Every chip button in the top-bar right cluster (splits, close, Aa, bell, theme, fixed-width — the `rounded border border-border` chips) and the bottom bar (`app/frontend/src/components/bottom-bar.tsx` `KBD_CLASS` buttons, line 48) gets a skewed highlight strip sweeping across the button face on hover (`::after` pseudo-element, one-shot ~450ms animation). Buttons contain SVG icons so `background-clip: text` cannot work — the sweep-over-face mechanism is required. Needs `overflow: hidden` on the button (verified safe in discussion: the font/bell popovers are **siblings** of their trigger buttons, not children). One shared utility class.

#### B5. Reduced motion

ALL animations (Parts A and B) sit behind `@media (prefers-reduced-motion: reduce)` — disabled entirely. Keyframes/utilities live in `app/frontend/src/globals.css` (beside the existing `logo-chase` keyframes and `coarse` custom variant; Tailwind CSS 4).

### Constraints / obligations

- **Single fab change** covering both parts (explicit user decision — do not split).
- Constitution: Playwright e2e specs need sibling `.spec.md` companion docs; UI changes should include e2e tests where possible; palette action registered/documented per convention; no new routes (Constitution IV — all work lives on existing routes/components).
- Frontend stack: Vite + React 19 + TypeScript + Tailwind CSS 4; tests via `just` recipes only (never direct playwright/pnpm; `just test-e2e "<spec>"` for isolated e2e on port 3020).
- No backend changes — the rename endpoint already exists and is already `POST` (Constitution IX).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Top-bar layout changes from flex to 1fr/auto/1fr grid with a centered editable window heading (breadcrumb-ends-at-session, window switcher as ▾ beside the heading); new site-wide hover-animation vocabulary (glitch=brand, decode=editable identity, brackets+caret=page titles, caret=section labels, CRT glint=buttons; all behind prefers-reduced-motion); crumb affordance vocabulary and PageHeading sections need updating.

## Impact

- `app/frontend/src/components/top-bar.tsx` — header grid, new centered `WindowHeading` (display / decode / edit states), ▾ switcher, brand glitch, right-cluster glint (primary file, largest diff)
- `app/frontend/src/components/page-heading.tsx` — bracket hover step + reserved caret cell
- `app/frontend/src/components/server-list-page.tsx` — zone `h2` caret treatment
- `app/frontend/src/components/sidebar/collapsible-panel.tsx`, `app/frontend/src/components/sidebar/index.tsx` — panel-heading caret treatment
- `app/frontend/src/components/bottom-bar.tsx` — `KBD_CLASS` glint
- `app/frontend/src/globals.css` — keyframes + shared utility classes + reduced-motion gate
- `app/frontend/src/app.tsx` — rewire the existing `Window: Rename` palette action; TopBar prop threading if needed
- Existing API surface reused unchanged: `renameWindow()` (`app/frontend/src/api/client.ts:191`), `POST /api/windows/{windowId}/rename` (`app/backend/api/router.go:367`), optimistic window store (`app/frontend/src/store/window-store.ts`)
- Tests: `top-bar.test.tsx`, `page-heading.test.tsx` updates; new/updated Playwright e2e spec(s) under `app/frontend/tests/` with sibling `.spec.md` companion(s); mobile 375px no-wrap check

## Open Questions

None — every consequential decision was made explicitly in the originating discussion (see Origin); residual implementation choices are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Both parts (heading+rename, animation vocabulary) ship as ONE fab change | Discussed — user explicitly chose a single change; rejected splitting | S:95 R:75 A:95 D:95 |
| 2 | Certain | Header row becomes CSS grid `1fr auto 1fr` (replacing `flex justify-between` at top-bar.tsx:187) | Discussed — user approved; only layout that truly centers with asymmetric sides | S:95 R:90 A:90 D:90 |
| 3 | Certain | Breadcrumb ends at session crumb; window switcher becomes a ▾ button beside the centered heading (name-click=edit, ▾=switch) | Discussed — user approved; avoids duplicating the window name in one bar | S:95 R:80 A:90 D:90 |
| 4 | Certain | Inline rename: identically-styled ch-sized growing input; Enter commits, Escape cancels, blur commits; wired to existing `renameWindow()` + `useOptimisticAction` + toast | Discussed — user approved with these exact semantics; endpoint and patterns exist | S:95 R:85 A:95 D:90 |
| 5 | Certain | Hover animation = decode (~28ms/frame, ~0.9 chars/step) with 140ms hover-intent delay, edit-start cancel, replay-after-committed-rename | Discussed — user chose decode explicitly; the three guards were agreed in discussion | S:95 R:90 A:90 D:95 |
| 6 | Certain | Rest state = font-weight 600 + primary text color | Discussed — user decided; surrounding crumbs are secondary so this reads highlighted | S:90 R:95 A:90 D:90 |
| 7 | Certain | Mobile: centered heading becomes the mobile leaf; 375px top bar stays single-line | Discussed — user decided; matches existing intermediate-crumbs-hidden mobile pattern | S:85 R:85 A:85 D:80 |
| 8 | Certain | Vocabulary map: glitch=brand only, brackets+caret=page titles, caret-only=section labels, CRT glint=buttons — one treatment per element category | Discussed — user assigned the map explicitly, incl. rejected alternatives | S:95 R:85 A:90 D:95 |
| 9 | Certain | Brand glitch: one-shot ~300ms RGB-split text-shadow keyframes, steps(2); mobile icon-only jitter accepted | Discussed — user decided incl. the mobile caveat | S:95 R:90 A:85 D:90 |
| 10 | Certain | PageHeading: brackets step outward ∓3px + accent on hover; ▊ caret 1.06s steps(1) in an always-reserved cell before `]`; hover scope = bracket group only | Discussed — user decided incl. no-layout-shift and hover-scope guards | S:95 R:90 A:90 D:90 |
| 11 | Certain | Caret-only treatment on sidebar panel headings + Cockpit zone h2s; decorative, color-neutral, shared treatment | Discussed — user assigned both idioms to one treatment | S:90 R:90 A:85 D:85 |
| 12 | Certain | CRT glint via ::after sweep (~450ms one-shot) + `overflow:hidden` on top-bar right-cluster and bottom-bar chip buttons; one shared utility class | Discussed — user decided; popover-sibling safety verified in discussion | S:95 R:90 A:85 D:90 |
| 13 | Certain | All animations disabled under `prefers-reduced-motion: reduce` | Discussed — user decided; blanket gate | S:95 R:95 A:95 D:95 |
| 14 | Certain | Rename reachable from the command palette (Constitution V keyboard-first) | Discussed — user approved; constitution mandates keyboard reachability | S:90 R:90 A:95 D:85 |
| 15 | Confident | Reuse/rewire the EXISTING `Window: Rename` palette action (app.tsx:898) to trigger the inline edit (CustomEvent à la `theme-selector:open`) instead of adding a duplicate; retire the rename dialog only if the palette was its sole entry point | Gap analysis — description assumed the action was new; codebase shows it exists; rewiring keeps one rename surface | S:45 R:80 A:80 D:55 |
| 16 | Confident | Inline rename uses the optimistic window-store pattern (`renameWindowStore` pendingName + `clearRename`) like the sidebar's inline rename, so heading/sidebar stay consistent | Codebase precedent (sidebar/index.tsx:397, use-dialog-state.ts); description mandates the optimistic pattern generally | S:65 R:85 A:85 D:75 |
| 17 | Confident | Implement the nice-to-have: decode also replays when SSE delivers an external name change (keyed on displayed-name change, so committed-rename replay covers it for free) | Discussed as optional nice-to-have; trivial once replay is name-change-keyed; easily dropped | S:55 R:90 A:75 D:60 |
| 18 | Confident | ▾ window switcher stays visible on mobile (it becomes the only in-bar window switcher once the crumb moves) and keeps the `+ New Window` action item | Existing BreadcrumbDropdown carries the action; removing the mobile switcher would regress mobile navigation | S:55 R:85 A:80 D:70 |
| 19 | Confident | Long window names truncate (max-width + `truncate`) in the center cell rather than wrap or squeeze neighbors | User's no-wrap-at-375px requirement forces it; matches existing `max-w-[16ch] truncate` crumb pattern | S:60 R:90 A:85 D:75 |
| 20 | Confident | Part B treatments ship as shared utility classes + keyframes in `globals.css` (CSS-only), beside the existing `logo-chase` keyframes | User framed Part B as CSS-only; globals.css is the established home for keyframes/variants | S:55 R:95 A:80 D:60 |
| 21 | Confident | E2E: new/updated Playwright spec(s) with sibling `.spec.md` cover heading render + inline rename + palette path; animation treatments asserted via class presence and `prefers-reduced-motion` emulation, not pixel assertions | Constitution mandates .spec.md companions and e2e where possible; class-presence assertions are the stable seam for CSS animations | S:60 R:85 A:80 D:70 |
| 22 | Confident | Navigating to a different window (route change) counts as a displayed-name change and replays the decode once | Not discussed; consistent with name-change-keyed replay; trivially reversible | S:35 R:90 A:65 D:50 |

22 assumptions (14 certain, 8 confident, 0 tentative, 0 unresolved).
