# Intake: Dashboard Chrome Nitpick Polish

**Change**: 260813-kvk7-dashboard-chrome-nitpick-polish
**Created**: 2026-08-14

## Origin

Promptless dispatch from `/fab-proceed` (Create-Intake Procedure, `{questioning-mode} = promptless-defer`). Source: a designer nitpick review of a dashboard screenshot, conducted in conversation with the user. All five fixes were mocked in HTML, reviewed by the user, and **explicitly approved**. One alternative (row-quantized viewport heights for Fix 1) was considered and **explicitly rejected** in favor of the fade treatment.

> Five small frontend-only UI polish fixes to the run-kit dashboard chrome (`app/frontend/src`). No backend changes expected.
>
> 1. Scroll-boundary row clipping → fade mask (sidebar session list + SERVER tile grid).
> 2. Top-bar center heading punctuation — `Window: <name> ▾`, single caret owned by the name.
> 3. Compose strip Insert/Send enablement — one shared rule: empty composer → both disabled.
> 4. Breadcrumb — drop the session dropdown, render the session crumb as a boxed chip like its siblings.
> 5. Sidebar header trailing-icon alignment — one shared trailing-icon column across all header tiers.

**Explicitly OUT of scope** (from the same review, deliberately excluded by the user): the empty "ghost pill" in the bottom bar (not run-kit's UI); the pane-identity notation mismatch between the terminal title `(1/%368)` and the PANE panel `pane 2/1 %368`; the `›` prefix glued to some completed session names; the attention-highlight treatment merging adjacent flagged rows; anything rendered by tmux or Claude Code inside the terminal.

## Why

Five independent chrome inconsistencies make the dashboard read as broken or unfinished rather than deliberate:

1. **Scroll-boundary clipping** slices rows mid-glyph — the Completed session group's last visible row is cut horizontally through its text/PR icon by the PANE panel below, and the SERVER tile grid shows an ~8px sliver of the next tile row above the SESSIONS divider. Partial content at a hard cut edge reads as a rendering bug, not as "more below".
2. **Heading punctuation** renders `Window ▾ : riff-robust-tetra ▾` — a caret-widened gap BEFORE the colon (wider on the colon's left than its right) and two dropdown carets in one heading. This violates the project's own `PageType: name` heading convention (context.md documents the center heading as `PageType: name`).
3. **Compose strip** with an empty composer shows Insert disabled but Send enabled with primary fill — two adjacent buttons over the same input following visibly different enablement rules, with the primary CTA lit when there is nothing to send.
4. **Breadcrumb** mixes affordances: two boxed chips (brand, server) followed by a bare-text session crumb carrying a ▾ dropdown. The session dropdown is essentially unused (user judgment) — the sidebar and the Cmd+K palette already own session switching.
5. **Header icon drift**: the server group header's trailing `+`/`×` sit further right, closer together, and at a different glyph size than the session-row `+`/`×` below them, so the icon columns don't align vertically down the sidebar.

If unfixed, each one keeps signaling low polish in the most-looked-at chrome surfaces (sidebar, top bar, composer). Each fix is small, isolated, and was individually mocked and approved — the approach per fix is settled, not open.

## What Changes

### 1. Scroll-boundary row clipping → fade mask

**Current state** (verified in code):
- The session-list scroll viewport is `app/frontend/src/components/sidebar/index.tsx` (~line 1530): the `role="tree"` container with `flex-1 min-h-0 overflow-y-auto`. Its bottom boundary is the hard edge against the status panels below (PANE panel etc.) — rows slice mid-glyph there.
- The SERVER tile grid scrolls inside `CollapsiblePanel`'s resizable content area (`app/frontend/src/components/sidebar/collapsible-panel.tsx`, `contentStyle` resizable branch: inline `height` + `overflowY: auto`, `overflowX: hidden`). The user-draggable height is arbitrary pixels, so a partial tile row (~8px sliver) routinely shows at the bottom edge above the SESSIONS divider. The grid itself lives in `app/frontend/src/components/sidebar/server-panel.tsx` (desktop: `gridTemplateColumns: repeat(auto-fill, minmax(72px, 1fr))`).

**Approved fix** (user explicitly chose this variant): partially visible rows/tiles at the bottom cut edge fade into the sidebar background via a CSS gradient veil/mask, so partial content reads as "more below" instead of broken rendering. **No layout change** — viewport geometry, panel heights, and drag-resize behavior are untouched.

**REJECTED alternative** (user considered and declined): quantizing the viewport height to whole rows/tiles.

Implementation notes for planning:
- Apply the treatment to the two evidenced viewports: the sessions tree viewport (sidebar/index.tsx ~1530) and the SERVER panel's resizable scroll area. Build it as a reusable treatment (e.g. an `rk-*` utility in `globals.css` per the project's utility-class convention), but do not sweep every scrollable in the app in this change.
- Prefer a `mask-image` (fading the content itself to transparent) over an opaque background-colored overlay veil: sidebar rows and tiles carry per-item color tints (`rowTints`), so a solid `bg-primary` gradient painted over them would mismatch tinted content; a mask fades whatever is there. Either satisfies the approved mock ("gradient veil/mask").
- Popover clipping is a non-issue: SwatchPopover and the color pickers in both areas are already portalled to `document.body` precisely to escape the `overflow-y: auto` clip (comments at sidebar/index.tsx ~2250 and server-panel.tsx), so a mask on the scroll container cannot hide them.
- The fade should render only when there actually is more content below (viewport scrollable AND not scrolled to the end): the approved semantic is "reads as more below", and a permanent veil would dim the final row when the list is fully scrolled or short. `CollapsiblePanel`'s legacy (non-resizable) mode keeps `overflow: visible` and is not a clipping surface — no fade there.

### 2. Top-bar center heading punctuation

**Current state** (verified in code, `app/frontend/src/components/top-bar.tsx`):
- The centered heading renders `Window ▾: <name> ▾`. The FIRST caret is the **hierarchy dropdown** (`HierarchyDropdown`, ~line 340, feature 260714-uco1) — a `BreadcrumbDropdown` listing the current page's ancestor chain (terminal: `tmux Server: {server}` → `Host`; board/server: `Host`), passed as the prefix `caret` so it renders between the prefix word and its colon. The SECOND caret is the window switcher (`BreadcrumbDropdown` with `windowItems`, ~line 1063).
- All three non-host modes carry the prefix caret: terminal (`Window ▾: name`, ~line 1061), board (`Board ▾: name`, ~line 1093), server (`tmux Server ▾: name`, ~line 1108).
- The prefix renderer already supports the no-caret case: with no `caret` prop, `Window:` renders contiguous (code comment ~line 1483: "keeps `Window:` contiguous for headings with no hierarchy ▾").

**Approved fix**: `Window: <window-name> ▾` — the colon hugs the prefix per the `PageType: name` heading convention, one space after the colon (the existing boot-sweep `sp` space cell), and a single caret owned by the name (the window switcher). The prefix's own caret goes away.

- Remove the `caret={<HierarchyDropdown …/>}` usage from all three modes and delete the now-dead `HierarchyDropdown` component. The board/server prefixes carry the identical convention violation, so the removal applies to all heading modes, not just `Window:` (the mock showed the window heading).
- **No replacement UI** for the ancestor navigation (explicit user note: if it matters it belongs in the Cmd+K palette). **Verified**: palette parity already exists — `lib/palette-nav.ts` `buildNavActions` emits `Go: tmux Server` / `Go: Host` ancestor entries explicitly mirroring the hierarchy dropdown ("Constitution V palette parity for the top-bar history arrows + hierarchy dropdown"), plus `Go: Back`/`Go: Forward`. Keyboard-first (Constitution V) is preserved with zero new code. The left breadcrumb's server crumb (terminal route, `md+`) and the brand crumb remain the pointer paths to the ancestors on desktop.
- Known consequence to record, not change: the server crumb hides below `md` (its demotion was justified by the hierarchy ▾ covering the same navigation — comment ~line 960). After removal, below-`md` ancestor navigation is palette + browser back. Leave the breakpoint ladder unchanged (no layout change is in scope).
- The `Go: tmux Server`/`Go: Host` palette entries and the history arrows are untouched.

### 3. Compose strip Insert/Send enablement

**Current state** (verified in code, `app/frontend/src/components/compose-strip.tsx` ~lines 681–689):

```tsx
const canInsert = !isSelectionTarget && hasTarget && text.trim() !== "";
const canSubmit = isSelectionTarget
  ? text.trim() !== "" && !selectionSending
  : hasTarget;
```

With an empty composer on a terminal target, Insert is disabled but Send is enabled with primary styling (`border-accent bg-accent/20`). This split is a **prior deliberate decision** (260802-lj98, documented in the code comment): Send mirrors its Cmd/Ctrl+Enter chord INCLUDING the empty case — an empty click sends a bare `\r` ("press Enter in the pane") — because "button and chord diverging on empty would be a lying affordance."

**Approved fix**: both buttons share one enablement rule — empty composer → both disabled (no primary fill anywhere; the disabled Send renders at `disabled:opacity-40`); text present → both enabled, Send keeps the primary fill. Concretely: the terminal-target arm of `canSubmit` gains the `text.trim() !== ""` condition.

- Selection-target mode is unchanged: `canSubmit` there already requires text, and Insert is deliberately disabled for selection targets regardless of text — the unified rule applies to the terminal-target arm.
- **Resolved decision** <!-- clarified: user chose button-only disable, 2026-08-14 -->: only the **button** gains the empty-disable. The Cmd/Ctrl+Enter chord's empty-composer bare-`\r` send (in the keydown path, `lib/compose-keys.ts` / `onKeyDown`) **stays** — it remains the compose-strip way to send a bare Enter to the pane (a real remote-control affordance, e.g. confirming an agent prompt from a phone). This deliberately reintroduces the button/chord divergence on empty that 260802-lj98 removed, now as a documented decision: the lit primary button was the misleading part, not the chord. Update the 260802-lj98 comment to record the new rationale (button state = "is there text to send"; chord = power-user pane keystroke).

### 4. Breadcrumb: drop the session dropdown, unify chip styling

**Current state** (verified in code, `app/frontend/src/components/top-bar.tsx` ~lines 943–997):
- Brand crumb (logo + wordmark, links `/`) and the server crumb (terminal route, `md+`, links `/{server}`) are boxed chips via `LINK_CRUMB_CLASS` (~line 250: `rounded border border-border hover:border-text-secondary px-1.5 py-0.5 …`).
- The final session crumb (~lines 979–995) is a `BreadcrumbDropdown` — bare text + persistent ▾, `items={sessionItems}` (a session switcher), with `action={{ label: "+ New Session", onAction: onCreateSession }}`.

**Approved fix** (user decision — the session dropdown is essentially unused): remove the dropdown entirely and render the session crumb as a boxed chip styled identically to its siblings. Result: three consistent chips, no caret.

- The chip is **non-interactive** (a session has no route of its own): a static span carrying the chip box (border, radius, padding, `max-w-[16ch] truncate`) without hover treatment or pointer cursor. The user explicitly chose visual chip consistency; update the `LINK_CRUMB_CLASS` "bordered = clickable" comment (~line 243) to reflect that the breadcrumb chips now share the box as crumb styling, with hover reserved for the interactive ones.
- **Keyboard/entry-point coverage verified** (Constitution V constraint from the review): session **switching** — sidebar rows + palette `Window: Switch to <session> › <window>` entries (app.tsx ~line 2981). Session **creation** (the dropdown's `+ New Session` was the top bar's only creation entry) — palette `Session: Create` and `Session: Create at Folder` (app.tsx ~lines 2047–2052) plus the sidebar server-header `+` ("New session on {server}", sidebar/index.tsx ~line 2350). Nothing is orphaned.
- Dead code to clean up: `sessionItems` construction and the now-unused `onCreateSession` plumbing into the top bar (prop + `top-bar-slot-context` field), if nothing else consumes them. The `BreadcrumbDropdown` component itself **stays** — the window switcher and board switcher use it.

### 5. Sidebar header trailing-icon alignment

**Current state** (verified in code — the two clusters use different geometry AND different glyphs):
- **Server group header** (the all-caps tinted header, e.g. `RUNKIT` — `app/frontend/src/components/sidebar/index.tsx` ~lines 2331–2369): wrapper `flex items-stretch` with no right padding of its own; buttons are `px-1` (kill: `px-1 pr-1.5 sm:pr-2`) with **text glyphs** `+` and `✕` at `text-[13px]`; palette icon hover-revealed. Note: the screenshot's "pinned operator group header" is this ServerGroup header — the uppercase server name on the server-color tint (purple in the screenshot). The pinned operator row itself (260813-ifya) is an ordinary `WindowRow` with no header of its own.
- **Session group headers** (`runKit`, `Completed` — `app/frontend/src/components/sidebar/session-row.tsx` ~lines 221–268): wrapper `flex items-center pr-2`; each button `px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px]`; **SVG glyphs** `PlusIcon` / `CloseIcon` (from `sidebar/icons.tsx`); palette + spawn-agent hover-revealed.

The divergence produces exactly the reported symptom: the server header's icons sit further right (missing `pr-2`), closer together (`px-1` text glyphs vs `min-w-[24px]` slots), and at a different glyph size (13px text `+`/`✕` vs the SVG icons).

**Approved fix**: every header tier shares one trailing-icon column — same fixed icon slot size, same inter-icon gap, same right padding, same glyph size — so the `+` icons and `×` icons align vertically across all headers in the sidebar. Direction: the server group header **adopts the session-row cluster metrics** (the established majority convention): `PlusIcon`/`CloseIcon` SVGs, `px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px]` slots, wrapper right padding matching the session rows' `pr-2`. Hover-reveal behavior for the palette icon and the color/tint inheritance of the server header are unchanged.

### Testing (all five fixes)

- Constitution: tests MUST cover changed behavior; UI changes SHOULD include Playwright e2e where possible; any touched/added `.spec.ts` under `app/frontend/tests/` MUST update its sibling `.spec.md` companion in the same commit.
- Colocated unit tests to update/extend: `top-bar.test.tsx`, `compose-strip.test.tsx`, `sidebar/index.test.tsx`, `sidebar/session-row.test.tsx`, `breadcrumb-dropdown.test.tsx` (existing hierarchy-dropdown and session-dropdown assertions will need removal/rework).
- Likely-affected e2e specs (each with its `.spec.md`): `window-heading.spec.ts`, `top-bar-overlap.spec.ts`, `compose-strip.spec.ts`, `multi-server-sidebar.spec.ts`, `sidebar-panels.spec.ts`, `sidebar-autoscroll.spec.ts`.
- Run through `just` recipes only (`just test-e2e "<spec>"`), never Playwright directly (port isolation).

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome (hierarchy-dropdown removal, breadcrumb chip unification, heading punctuation), compose strip enablement rule, sidebar scroll-edge fade treatment, sidebar header icon-cluster unification.

## Impact

- **Frontend only** (`app/frontend/src` + `app/frontend/tests`); no backend, no API, no routes, no new pages (Constitution IV untouched).
- Files: `components/top-bar.tsx` (Fixes 2, 4), `components/compose-strip.tsx` (+ possibly `lib/compose-keys.ts`, Fix 3), `components/sidebar/index.tsx` + `components/sidebar/session-row.tsx` (Fix 5), `components/sidebar/index.tsx` + `components/sidebar/collapsible-panel.tsx` / `components/sidebar/server-panel.tsx` + `globals.css` (Fix 1), `contexts/top-bar-slot-context.tsx` (Fix 4 plumbing cleanup).
- Removes one navigation affordance (hierarchy ▾) and one dropdown (session switcher) — both with verified palette/sidebar coverage; deletes dead code (`HierarchyDropdown`, `sessionItems`).
- Unit + e2e test updates with `.spec.md` companions (see Testing).

## Open Questions

- ~~Fix 3: should the Cmd/Ctrl+Enter chord's empty-composer bare-`\r` send ("press Enter in the pane") also become a no-op to match the newly disabled Send button, or does only the button disable?~~ **Resolved 2026-08-14** (user, via /fab-clarify): only the button disables; the chord keeps its bare-`\r` send. See What Changes § 3 and Assumptions #9.

## Clarifications

### Session 2026-08-14

**Q (Assumptions #9)**: With an empty composer, does the Cmd/Ctrl+Enter chord's bare-`\r` send also become a no-op once the Send button is disabled, or does only the button disable?
**A (user)**: Only the button disables — the chord keeps the bare-Enter send ("press Enter in the pane"). The button/chord divergence on empty is accepted and documented; the misleading affordance was the lit primary button, not the chord.

### Session 2026-08-14 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 10 | Confirmed | — |
| 12 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the five approved fixes, frontend-only; the review's other findings (ghost pill, pane notation, `›` prefix, attention merge, tmux-rendered content) stay out | User explicitly enumerated in/out lists | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix 1 uses the fade treatment, not row-quantized viewport heights | User explicitly chose fade and rejected quantization | S:95 R:85 A:90 D:95 |
| 3 | Certain | Fix 2 removes the prefix hierarchy ▾ with NO replacement UI; keyboard path preserved | User-approved mock; `lib/palette-nav.ts` already carries `Go: tmux Server`/`Go: Host` parity (verified) | S:90 R:80 A:95 D:90 |
| 4 | Certain | Fix 2 applies to all heading modes (board `Board ▾:` and server `tmux Server ▾:` prefixes lose their carets too), not just the window heading the mock showed | Clarified — user confirmed | S:95 R:80 A:80 D:70 |
| 5 | Confident | Fix 1 fade renders only when more content exists below (scrollable and not at end), not as a permanent veil | Clarified — user confirmed | S:95 R:85 A:70 D:65 |
| 6 | Confident | Fix 1 mechanism leans `mask-image` (content fades to transparent) over an opaque bg-colored overlay | Clarified — user confirmed | S:95 R:80 A:65 D:50 |
| 7 | Confident | Fix 1 applies to the two evidenced viewports (sessions tree, SERVER panel scroll area) as a reusable utility; no app-wide sweep of every scrollable | Clarified — user confirmed | S:95 R:85 A:70 D:60 |
| 8 | Certain | Fix 3's unified rule applies to the terminal-target arm only; selection-target behavior is unchanged (already requires text; Insert stays disabled there) | Clarified — user confirmed | S:95 R:80 A:80 D:70 |
| 9 | Tentative | Fix 3: only the Send button disables on empty; the Cmd/Ctrl+Enter chord keeps its bare-`\r` send — the 260802-lj98 divergence returns as a documented decision | Clarified — user chose button-only disable (chord keeps bare-Enter send) | S:95 R:55 A:15 D:20 |
| 10 | Confident | Fix 4's session chip is non-interactive: static span with the chip box, no hover treatment, no pointer cursor | Clarified — user confirmed | S:95 R:85 A:70 D:60 |
| 11 | Certain | Fix 4 orphans nothing: session switching stays in sidebar + palette `Window: Switch to …`; session creation stays in palette `Session: Create`/`Create at Folder` + sidebar server-header `+` | Verified in code (app.tsx ~2047/~2981, sidebar/index.tsx ~2350); Constitution V satisfied | S:85 R:90 A:95 D:90 |
| 12 | Certain | Fix 5 direction: the server group header adopts the session-row icon-cluster metrics (SVG `PlusIcon`/`CloseIcon`, `min-w-[24px]`/`coarse:min-w-[32px]` slots, `pr-2`-equivalent right padding) | Clarified — user confirmed | S:95 R:85 A:80 D:70 |
| 13 | Certain | Tests: unit coverage for changed logic, Playwright e2e where possible, and sibling `.spec.md` updates in the same commit for every touched `.spec.ts` | Constitution (Test Companion Docs) + code-quality.md mandate this | S:90 R:90 A:100 D:95 |
| 14 | Certain | The screenshot's "pinned operator group header" (purple all-caps `RUNKIT`) is the ServerGroup header — uppercase server name on the server-color tint; the pinned operator row (260813-ifya) is a plain `WindowRow` with no header of its own | Verified in code: sidebar/index.tsx ~2308 (uppercase header), ~2395 (operator row is a WindowRow) | S:75 R:80 A:90 D:85 |

14 assumptions (9 certain, 4 confident, 1 tentative, 0 unresolved).
