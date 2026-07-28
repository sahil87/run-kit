# Intake: Mobile Chrome Polish

**Change**: 260724-2bmy-mobile-chrome-polish
**Created**: 2026-07-25

## Origin

Conversational — a `/fab-discuss` session where the user reported four mobile-screen issues, each replicated with Playwright (screenshots + bounding-box measurements against a dev server on :3020, tmux socket `rkshot`, session `shotsess`, mobile viewport 375×812 with coarse pointer, desktop 1280×800) before this intake was created.

> 1. Top bar, the buttons arent aligned well. And the panel toggle doesnt look the same size as the other buttons
> 2. the text input panel: with the attach, insert and send buttons, very little horizontal space is left for the input box. Stack the buttons better. Even on desktop, its default min height can be made 2 lines.
> 3. On the sessions panel on the sessions row, the color palette and the agent icon dont look equidistant and aligned horizontally. Also those action buttons are a bit too small to click.
> 4. The bottom bar - on a mobile screen, when the keyboard hasn't come up, stays at the complete bottom - which is the curved part of the mobile. So the extreme buttons on the left and right get cut off via the phone's corner arc. So what we need to do is increase the bottom padding of the buttons or the row, when the keyboard is collapsed, to come over the curved part.

Key decisions from the discussion: the user approved the full four-part fix plan, including stacking the compose strip into two rows with a 2-line default textarea **on desktop too**, and the CSS-only safe-area approach (`env()` padding that collapses automatically when the keyboard resizes the viewport). The branch was rebased onto latest main (through PR #456 "Uniform Bottom-Bar Chip Sizes") before intake creation.

## Why

run-kit is used heavily from phones (it is a PWA with identity assets and a keyboard-first mobile bottom bar), and four independent chrome defects degrade the mobile experience:

1. **Top bar reads as misaligned** — the sidebar/panel toggle is a borderless button with a 20px icon sitting beside bordered 30×30 chips (mobile) whose inner icons are 13–14px; the brand crumb is 26px tall at y=12 while its neighbor buttons are 30px at y=10. The toggle looks like a different, larger control and the row doesn't sit on one visual axis.
2. **Compose strip squeezes the input** — measured on 375px: the textarea gets 195.7px (~52% of the row) because 📎/Insert/Send (33 + 61.4 + 54.9px + gaps) share its flex row (`compose-strip.tsx` single `flex items-end` row, `rows={1}`). On desktop the 1-line textarea (28px) is even 2px shorter than the buttons beside it. Typing space is the strip's whole purpose.
3. **Session-row action icons look uneven and are hard to tap** — measured: icon center-to-center gaps are actually even (17.0/17.3/17.7px), so the problem is optical: palette/bot are 13px stroke SVGs while `+`/`✕` are 16px text glyphs (different ink width/weight → uneven whitespace), and the bot icon's antenna makes its body sit optically lower than the palette circle. Click targets are 17px wide on desktop AND mobile (`coarse:min-h-[36px]` exists, but there is no `min-w`, so touch width stays 17px — half the app's 36px touch guideline).
4. **Bottom bar is clipped by phone corner arcs** — the toolbar row has only `py-1.5` (6px); chips end ~4px from the physical bottom edge, inside the ~34px corner-arc/home-indicator zone. There is **zero** safe-area handling in the frontend (no `env(safe-area-inset-*)` anywhere; `index.html` viewport meta lacks `viewport-fit=cover`). When the keyboard is up the bar is fine (the meta already has `interactive-widget=resizes-content`, so the layout viewport shrinks and the bar rides above the keyboard on the flat screen area); collapsed, the extreme chips (`⇥` left, `⌨` right) fall inside the arc.

If unfixed: the strip stays hostile to typing (its core job), the extreme bottom-bar keys stay partially unreachable on curved-screen phones, and the chrome keeps reading as unpolished. All four are small, contained CSS/JSX changes — one change keeps the mobile polish reviewable as a unit.

## What Changes

### 1. Top bar — panel toggle + left-cluster alignment (`app/frontend/src/components/top-bar.tsx`)

- **Panel toggle (hamburger)**: give it the same bordered-chip treatment as its siblings (the `rounded border border-border … hover:border-text-secondary` convention used by `HistoryNav` arrows and `LINK_CRUMB_CLASS`), keeping its existing `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]` box and `rk-glint` hover. Shrink `HamburgerIcon` from `width/height={20}` to ~16px so its optical size matches the ~13–14px icons inside neighboring chips. Keep the Notion-style open/closed fill behavior unchanged.
- **Brand crumb height**: normalize the brand crumb (`a[aria-label="RunKit home"]`, styled by `LINK_CRUMB_CLASS`) to the shared control height — `min-h-[24px] coarse:min-h-[30px]` (measured today: 26px vs the buttons' 30px on mobile) so the left cluster sits on one horizontal axis.
- Do NOT touch the right-cluster overflow registry/fit machinery — this is a pure styling change to the left cluster.

### 2. Compose strip — two-row stack + 2-line default (`app/frontend/src/components/compose-strip.tsx`)

Restructure the `TipGroup`-wrapped `flex items-end gap-1.5` row (currently textarea + 📎 + Insert + Send in one row) into two rows:

- **Row 1**: the textarea alone, full width (`w-full`), `rows={2}` (up from `rows={1}`) — the 2-line default applies on desktop too, per explicit user direction.
- **Row 2**: the buttons — 📎 on the left, spacer (`ml-auto` or `flex-1`), Insert and Send on the right.
- The bounded auto-grow (`MAX_TEXTAREA_ROWS = 6`, `resize()` via scrollHeight) is unaffected, but its floor must respect the new 2-row default (the `el.style.height = "auto"` measurement naturally returns the 2-row height when `rows={2}`; verify no regression where the strip re-collapses to 1 line after typing+deleting).
- Everything else is untouched: the `→ target` header row with × close, attachment previews row, Enter policy (`classifyComposeEnter`), focus rules, upload/re-home logic, module draft store.
- Update `compose-strip.test.tsx` for the new DOM structure if it asserts row layout.

### 3. Sidebar row action icons — one icon system + real touch targets (`app/frontend/src/components/sidebar/session-row.tsx`, `sidebar/icons.tsx`, `sidebar/window-row.tsx`)

- **One icon system**: replace the text-glyph `+` (`text-[16px]`) and `✕` (`text-[16px]` session row / `text-[14px]` window row) with stroke SVG icons in `sidebar/icons.tsx` matching the existing `PaletteIcon`/`BotIcon` convention (24-unit viewBox, `strokeWidth={2}`, 13px default size, `aria-hidden`) — e.g. `PlusIcon`, `CloseIcon`. Equal ink metrics is what makes the cluster read as equidistant (measured center gaps are already even at 17px; the unevenness is optical from mixed glyph systems).
- **Uniform button geometry**: same padding on all four buttons (today palette/bot are `px-0.5`, +/✕ are `px-1`), plus real minimum widths: `min-w-[24px] coarse:min-w-[32px]` alongside the existing `min-h-[24px] coarse:min-h-[36px]`. (4 buttons × 32px = 128px on coarse — verify against the 375px drawer with a long session name; drop to 28–30px only if the name column is crushed, never below 28px.)
- **Bot icon optical centering**: nudge `BotIcon` so its body center matches the palette circle's visual center (antenna adds top weight — measured body sits low). A `viewBox` shift or a `translate-y-[0.5px]`-style nudge inside the icon is acceptable; whatever keeps the rendered box 13px.
- **Window row** (`window-row.tsx` kill button at the icon cluster, `pin-icon` cluster): apply the same treatment — SVG ✕, uniform padding, `min-w` touch sizing — where the same primitives appear.
- Keep the hover-reveal behavior (`opacity-0 group-hover:opacity-100 coarse:opacity-100`) and all handlers/ARIA unchanged. Playwright note (memory): icon clusters may be `pointer-events-none` at rest in window rows — existing tests hover first; preserve that contract.
- Update `session-row.test.tsx` / `window-row.test.tsx` if they assert glyph text content (`+`, `✕`).

### 4. Bottom bar safe-area inset (`app/frontend/index.html`, `app/frontend/src/components/bottom-bar.tsx`, `app/frontend/src/components/top-bar.tsx`)

- **`index.html:5`** viewport meta: append `viewport-fit=cover` (required for `env(safe-area-inset-*)` to be non-zero on iOS). Existing `interactive-widget=resizes-content` stays.
- **`bottom-bar.tsx:293`** toolbar row (`flex items-center gap-1.5 coarse:gap-1 py-1.5 flex-wrap`): split `py-1.5` into `pt-1.5` + `pb-[max(0.375rem,env(safe-area-inset-bottom))]`. Behavior: keyboard collapsed → OS reports the bottom inset (≈34px on iPhone-class devices) and the chips ride above the corner arc; keyboard open → the resized viewport consumes the inset, `env()` → 0, padding returns to 6px. No JS keyboard detection, no `visualViewport` listener. Both mounts (terminal shell `app.tsx` + `board-page.tsx`) share the component, so this is one edit.
- **Top-bar guard**: `viewport-fit=cover` in standalone PWA mode can expose the status-bar area at the top; add `pt-[env(safe-area-inset-top)]` (or `max()` with the current padding) to the top-bar `<header>` so the bar never tucks under the clock. On browsers/desktop `env()` is 0 → no visual change.
- Post-#456 note verified: the row class at `bottom-bar.tsx:293` is unchanged by the chip-size PR; re-check line positions at apply time.

### Verification (all four)

- Re-run the Playwright measurement pass used for replication (mobile 375×812 `hasTouch`, desktop 1280×800) and confirm: toggle/brand/chips share one 30px axis on mobile; textarea ≥ ~90% row width and 2-line default; sidebar icon buttons ≥24px wide (fine) / ≥32px (coarse) with even optical gaps; bottom-bar `pb` resolves to `max(6px, env())`.
- `just test-frontend` for the touched component tests; `just test-e2e` for affected specs (never raw playwright — port isolation). E2E flake triage per project memory: `window-heading` arrows and max-update-depth console errors are known pre-existing.

## Affected Memory

- `run-kit/ui-patterns`: (modify) mobile section — record the safe-area inset convention (`viewport-fit=cover` + `env(safe-area-inset-bottom)` on the bottom bar, `env(safe-area-inset-top)` guard on the top bar), the compose strip's two-row layout + 2-line default, the sidebar icon-cluster uniform geometry (single SVG icon system, `min-w` touch targets), and the top-bar toggle's bordered-chip treatment.

## Impact

- **Frontend only** — no backend, no API, no routes. Files: `top-bar.tsx`, `compose-strip.tsx`, `sidebar/session-row.tsx`, `sidebar/window-row.tsx`, `sidebar/icons.tsx`, `bottom-bar.tsx`, `index.html`, plus their colocated tests.
- **Blast radius**: pure presentation; no state, handlers, ARIA, or data-flow changes. The riskiest edit is `viewport-fit=cover` (viewport-wide; interacts with standalone PWA status bar — mitigated by the top-bar guard) and the compose-strip DOM restructure (covered by `compose-strip.test.tsx`).
- **Constitution**: IV (minimal surface — no new pages), V (keyboard-first untouched), Test Companion Docs apply only if a new `.spec.ts` is added.

## Open Questions

- None — all four issues were replicated, measured, and the fixes discussed with the user before intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Compose strip: two-row stack, textarea `rows={2}` default on desktop too | Explicit user direction ("Stack the buttons better. Even on desktop, its default min height can be made 2 lines") | S:95 R:85 A:95 D:90 |
| 2 | Certain | Bottom bar: `viewport-fit=cover` + `pb-[max(0.375rem,env(safe-area-inset-bottom))]`, no JS keyboard detection | User approved the mechanism explicitly after it was presented; `interactive-widget=resizes-content` already present makes `env()` collapse when keyboard opens | S:90 R:85 A:90 D:85 |
| 3 | Confident | Panel toggle becomes a bordered chip with a ~16px icon (vs borderless-but-resized) | User asked for same-size look; bordered chip is the established sibling convention (`HistoryNav`, `LINK_CRUMB_CLASS`); reversible one-class change | S:70 R:85 A:75 D:65 |
| 4 | Confident | Brand crumb normalized to shared control height (`min-h-[24px] coarse:min-h-[30px]`) | Mechanical alignment fix implied by "buttons aren't aligned well"; measured 26px vs 30px mismatch | S:60 R:90 A:85 D:80 |
| 5 | Confident | Sidebar `+`/`✕` text glyphs converted to stroke SVGs matching PaletteIcon/BotIcon (new `PlusIcon`/`CloseIcon` in `sidebar/icons.tsx`) | Single icon system is the root-cause fix for the optical unevenness; follows the file's documented icon convention | S:65 R:80 A:80 D:70 |
| 6 | Confident | Touch targets `min-w-[24px] coarse:min-w-[32px]` (not the full 36px) on sidebar row action buttons | 4×36px = 144px would crowd a 375px drawer row with long session names; 32px is a measured compromise to verify at apply (drop no lower than 28px) | S:45 R:85 A:55 D:45 |
| 7 | Confident | `window-row.tsx` icon cluster included in scope | User named the sessions row; window rows share the same primitives and mixed-glyph defect (verified `✕` text glyph at window-row.tsx:457) — consistency within one change | S:55 R:80 A:75 D:70 |
| 8 | Confident | Top bar gets `env(safe-area-inset-top)` guard in the same change | `viewport-fit=cover` side effect surfaced to user ("I'd include that guard"), no objection; zero-cost outside standalone PWA | S:60 R:85 A:70 D:70 |
| 9 | Confident | Bot icon optical-centering nudge (viewBox/translate, rendered box stays 13px) | Measured: body sits low due to antenna top-weight; small, reversible, purely visual | S:55 R:90 A:70 D:75 |
| 10 | Certain | Tests via `just` recipes only; update colocated tests for DOM/glyph changes; no new e2e spec required unless one is added (then companion `.spec.md` per constitution) | Constitution Test Companion Docs + project context testing rules give a deterministic answer | S:80 R:90 A:95 D:90 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).
