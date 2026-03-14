# Intake: Top Bar & Bottom Bar UI Refresh

**Change**: 260314-9raw-top-bar-bottom-bar-refresh
**Created**: 2026-03-14
**Status**: Draft

## Origin

> Top bar and bottom bar UI refresh: (1) Remove Cmd toggle from bottom bar, (2) Move compose button (>_) from bottom bar to top bar as rightmost item — move entirely, not duplicated, (3) Increase remaining bottom bar button sizes (44px touch targets), (4) Restructure top bar left to: hamburger icon (animates to X when sidebar/drawer open) + SessionName / WindowName (names are dropdown triggers, session name max 7 chars), (5) Restructure top bar right to: RunKit logo + "Run Kit" text + green dot (no live/idle text) + fixed-width toggle + ⌘K + >_ compose button, (6) Mobile top bar right: both ⋯ (command palette) AND >_ (compose) stay visible — everything else hidden.

Conversational mode. User provided a detailed multi-point specification after a `/fab-discuss` session reviewing current UI state. All 6 points explicitly confirmed. The updated mockups are already captured in `docs/specs/design.md`.

## Why

The current chrome layout has several ergonomic and aesthetic issues:

1. **Cmd modifier is dead weight** — on desktop, users hold the real Cmd key; on mobile, Cmd combos aren't used in terminal workflows. It wastes bottom bar real estate.
2. **Compose button buried in bottom bar** — the `>_` compose buffer is a key interaction surface (especially mobile), but it's visually lost among modifier keys. Moving it to the top bar gives it prominence and persistent visibility.
3. **Bottom bar buttons too small** — with 3 modifiers + Fn + arrows + compose, buttons are cramped at 32px/28px. Removing Cmd and compose frees space for proper 44px Apple HIG touch targets.
4. **Top bar left is unclear** — the logo doubling as sidebar toggle is non-obvious. A hamburger icon with X animation is universally understood as a menu toggle.
5. **No product branding** — the logo is just a toggle button in the top-left. Moving it to the right side alongside "Run Kit" text creates a brand anchor without consuming navigation space.
6. **Connection text redundant** — "live"/"disconnected" text next to the green/gray dot is verbose. The dot color alone communicates the state.

## What Changes

### 1. Bottom Bar: Remove Cmd Toggle

Remove the `Cmd` (`⌘`) button from the modifier toggles section. The bottom bar layout changes from:

```
Esc  Tab  │  Ctrl  Alt  Cmd  │  F▴  ← → ↑ ↓  >_
```

to:

```
Esc  Tab  │  Ctrl  Alt  │  F▴  ← → ↑ ↓
```

In `bottom-bar.tsx`:
- Remove `"cmd"` from the modifier buttons array `[["ctrl", "^"], ["alt", "⌥"], ["cmd", "⌘"]]` → `[["ctrl", "^"], ["alt", "⌥"]]`
- Remove `MODIFIER_LABELS.cmd`
- Clean up `modParam()` — remove the `cmd` branch (`if (mods.cmd) p += 8`)
- Clean up `hasModifiers()` — remove `mods.cmd`
- Remove `cmd` from the armed modifier bridging `keydown` handler (the `snapshot.cmd` branches)

In `use-modifier-state.ts`:
- Remove `cmd` from the modifier state type and initial state
- Remove `cmd` from `toggle()`, `arm()`, `consume()`, `isArmed()`

### 2. Bottom Bar: Remove Compose Button

Remove the `>_` compose button entirely from `bottom-bar.tsx`. The `onOpenCompose` prop is no longer needed on `BottomBar`. The compose button moves to the top bar (see §4).

Current JSX to remove:
```tsx
<button aria-label="Compose text" className={`${KBD_CLASS} text-text-primary ml-auto`} onClick={onOpenCompose}>
  <kbd aria-hidden="true">&gt;_</kbd>
</button>
```

### 3. Bottom Bar: Increase Button Sizes

With fewer buttons occupying the bar, increase touch targets:

- Desktop: `min-h-[32px] min-w-[32px]` → `min-h-[36px] min-w-[36px]`
- Touch (`coarse:`): `coarse:min-h-[36px] coarse:min-w-[28px]` → `coarse:min-h-[44px] coarse:min-w-[36px]`

Update the `KBD_CLASS` constant in `bottom-bar.tsx`.

### 4. Top Bar Left: Hamburger + SessionName / WindowName

Replace the current breadcrumb layout:

**Current**: `{logo} ❯ run-kit ❯ zsh`
**New**: `☰  run-kit / zsh`  (hamburger animates to ✕ when sidebar/drawer is open)

In `top-bar.tsx`:
- Replace the logo `<img>` button with a hamburger/X icon button. Use CSS transition to animate between ☰ (3-line) and ✕ (X) states. The icon state is driven by `sidebarOpen` (desktop) or `drawerOpen` (mobile).
- Change the `❯` (`\u276F`) separator to `/` between session and window names
- The `❯` icons currently serve as `BreadcrumbDropdown` triggers. With `/` as a plain separator, the **session name text** and **window name text** themselves become the dropdown triggers (tappable to open their respective dropdowns).
- Add `max-w-[7ch] truncate` to the session name span to cap display at ~7 characters with ellipsis overflow.
- Remove the logo `<img>` from the left section entirely — it moves to the right section.

The hamburger → X animation should be a CSS transform on SVG lines (3 horizontal lines → rotated X), triggered by a prop like `isOpen`. Smooth `transition-transform` for the animation.

### 5. Top Bar Right: Branding + Controls

Replace the current right section:

**Current**: `● live  ⇔  ⌘K` (desktop) / `⋯` (mobile)
**New (desktop)**: `{logo} Run Kit  ●  ⇔  ⌘K  >_`
**New (mobile)**: `⋯  >_`

In `top-bar.tsx` right section:
- Add RunKit logo `<img>` (decorative, `aria-hidden="true"`, not a button)
- Add "Run Kit" text span (`text-xs text-text-secondary`)
- Keep green/gray dot indicator, **remove** the "live"/"disconnected" text `<span>`
- Keep `FixedWidthToggle`
- Keep `⌘K` kbd hint (desktop only)
- Add compose button (`>_`) as the rightmost item. This needs the `onOpenCompose` callback — new prop on `TopBar`.
- Keep `⋯` command palette trigger (mobile only, `sm:hidden`)

Desktop visibility: logo, "Run Kit", dot, toggle, ⌘K, >_ all visible.
Mobile visibility: only `⋯` and `>_` visible. Everything else gets `hidden sm:flex` / `hidden sm:inline-flex`.

### 6. App Shell: Wire Compose to Top Bar

In `app.tsx`:
- Pass `onOpenCompose` to `<TopBar>` (new prop)
- Remove `onOpenCompose` from `<BottomBar>` props
- Update `BottomBarProps` type — remove `onOpenCompose`

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Chrome section (top bar layout, bottom bar layout), bottom bar section (remove Cmd, remove compose, new sizing), mobile responsive section
- `run-kit/architecture`: (modify) Update Chrome Architecture section (top bar description, bottom bar description)

## Impact

- **Frontend components**: `top-bar.tsx`, `bottom-bar.tsx`, `app.tsx`, `use-modifier-state.ts`
- **Props**: `BottomBarProps` loses `onOpenCompose`; `TopBarProps` gains `onOpenCompose`
- **Tests**: Bottom bar tests need Cmd references removed. Top bar tests need breadcrumb format updated. Touch target assertions updated.
- **Design spec**: `docs/specs/design.md` already updated with mockups (done during discussion).

## Open Questions

None — all points explicitly confirmed during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove Cmd toggle from bottom bar | Discussed — user explicitly confirmed. Cmd is unused in terminal workflows on both desktop and mobile | S:95 R:90 A:95 D:95 |
| 2 | Certain | Move compose button entirely to top bar (no duplication) | Discussed — user said "move entirely" | S:95 R:85 A:90 D:95 |
| 3 | Certain | Hamburger icon animates to X when sidebar/drawer open | Discussed — user explicitly specified animation | S:95 R:90 A:85 D:95 |
| 4 | Certain | Session/window names are dropdown triggers (not separator) | Discussed — user confirmed "names themselves become dropdowns" | S:95 R:85 A:90 D:95 |
| 5 | Certain | Mobile right side keeps both ⋯ and >_ visible | Discussed — user said "Ok both - ... and terminal icon" | S:95 R:85 A:90 D:95 |
| 6 | Certain | Session name max 7 chars with truncation | Discussed — user proposed, unchanged in review | S:90 R:90 A:90 D:90 |
| 7 | Certain | Green dot only, no "live"/"disconnected" text | Discussed — user accepted "the indicator is enough" | S:90 R:95 A:90 D:90 |
| 8 | Certain | Right side: logo + "Run Kit" + dot + toggle + ⌘K + >_ | Discussed — user confirmed full layout | S:90 R:85 A:85 D:90 |
| 9 | Confident | Hamburger → X animation via CSS transform on SVG lines | Strong convention, easily reversed. Standard pattern for menu toggle animation | S:70 R:90 A:85 D:80 |
| 10 | Confident | Bottom bar button sizes: 36px desktop, 44px touch | Follows Apple HIG. User said "increase the size slightly" — 44px is the standard mobile target | S:75 R:90 A:85 D:80 |
| 11 | Confident | Use `/` as plain separator (no dropdown trigger role) | User specified format as "SessionName / WindowName" — separator is decorative only | S:80 R:90 A:85 D:85 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).
