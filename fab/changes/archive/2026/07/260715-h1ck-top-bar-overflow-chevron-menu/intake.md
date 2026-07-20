# Intake: Top-Bar Overflow Chevron Menu

**Change**: 260715-h1ck-top-bar-overflow-chevron-menu
**Created**: 2026-07-15

## Origin

Conversational (`/fab-discuss` session, 2026-07-15), following the diagnosis of top-bar overlap at mid widths (companion change `260715-q8ey-top-bar-overlap-fixes`). The user designed the right-cluster degradation mechanism:

> "On the top right corner, we need a mechanism to start hiding buttons, in a dropdown. [...] The right section pays the price for lesser available width, as buttons keep dropping down into the down arrow. We could have a down chevron as a fixed button at the end — a fixed item inside it can be an entry about the version of Run Kit (e.g. `Run Kit v3.3.3`). The rest of the items make it there as we get squeezed for space."

The assistant's design recommendations (drop order from the existing L1/L2/L3 pyramid, ViewSwitcher/dot exemptions, chevron left of the dot, version-row-as-update-surface, registry architecture, ResizeObserver + pure fit function) were accepted by the user proceeding to intake creation.

## Why

**Problem.** The top-bar right cluster is rigid: buttons are `shrink-0` and degrade only via a blunt `hidden sm:flex` cliff at 640px. Between "everything fits" and "mobile leaf layout" there is no graceful middle — width pressure currently produces overlap/clipping (the companion change `q8ey` converts that to clean clipping, but clipping controls is still losing them). Below `sm`, most controls simply vanish; on touch devices (no Cmd+K keyboard) they become unreachable entirely.

**Consequence if unfixed.** Mid-width layouts (VS Code side panes, half-screen windows — a primary run-kit context) lose working controls arbitrarily off the right edge, and mobile users permanently lose theme/refresh/help/update affordances.

**Why this approach.** This is the standard "priority+" overflow pattern (browser toolbars, macOS `»`), and the right cluster already encodes drop priority: the documented L1/L2/L3 cumulative pyramid (260704-9o7k) grows leftward from a stable always-block pinned right. Overflow consuming from the left = L1 drops first, L3 last — and surviving buttons never change screen position, preserving the pyramid's core invariant ("no shared button ever changes screen position between pages"). The always-present chevron with a fixed version row also gives the version a passive chrome surface consistent with 260715-ifco's philosophy, and gives future rarely-used actions a home without new top-bar real estate (Constitution IV).

**Dependency.** Builds on `260715-q8ey-top-bar-overlap-fixes` (left/center min-width floors + clip backstops). Sequence q8ey first. This change adds the right cluster's `min-w-0` so its grid track becomes squeezable — the overflow menu is what makes that squeeze safe.

## What Changes

### 1. Overflow chevron button (fixed, always visible)

A new down-chevron icon button in the right cluster, matching the top-bar icon-button convention (`rk-glint`, bordered chip, `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]`), visible at ALL breakpoints and in all four page modes. Placement: **immediately left of the connection dot** — the dot keeps its documented "right-most status terminator in every mode" role.
<!-- assumed: chevron sits left of the dot rather than after it — preserves the dot-terminator invariant; recommended in discussion and accepted -->

The chevron renders even when nothing is overflowed, because the menu always contains the fixed version row (user-specified). `aria-label` e.g. "More controls"; `aria-expanded`/`aria-haspopup` per menu-button pattern.

### 2. Overflow menu

Dropdown panel anchored to the chevron, following the existing dropdown a11y conventions (reuse/mirror `BreadcrumbDropdown`'s `role="menu"`/`menuitem`, Escape, ArrowUp/ArrowDown, outside-click close — `app/frontend/src/components/breadcrumb-dropdown.tsx`).

Contents, top to bottom:

1. **Overflowed controls** as labeled menu rows (see change area 4), in pyramid order.
2. **Fixed version row** (always last, always present): `Run Kit v{version}` using `daemonVersion` from `useUpdateNotification()` (session-context) formatted via `displayVersion()` (`src/lib/palette-version.ts`). Click = copy the displayed form to clipboard with success/error toast — same behavior as the existing `run-kit: Version` palette action (`buildVersionAction`). When a qualifying update is pending AND the UpdateChip is currently overflowed, the row becomes the update surface: `Run Kit v{current} → v{latest} ⬆` and click triggers the update (same POST `/api/update` path as the chip). Version unknown (no `event: version` yet) → row shows plain `Run Kit` (never `vundefined`).

### 3. Drop order and exemptions

- **Drop priority = the existing pyramid, consumed from the left**: L1 first (SplitButton ×2, FixedWidthToggle), then L2 (TerminalFontControl Aa, BoardAutofitToggle, ClosePaneButton ✕), then L3 last (UpdateChip, NotificationControl, ThemeToggle, RefreshButton, HelpLink). Within a tier, leftmost drops first. Surviving buttons keep their exact positions.
- **Exempt (never overflow)**: the ViewSwitcher (deliberately visible at all breakpoints — chat on mobile is a primary use case, 260714-r7rq), the connection dot, and the chevron itself.
- **Attention propagation**: when the menu contains attention-bearing overflowed items (today: the UpdateChip with a qualifying, undismissed update), the chevron carries a small accent dot/badge so the signal isn't lost.

### 4. Menu-row representations

Icon buttons become labeled rows. Per-control mapping:

- SplitButton ×2 → two rows: "Split vertical" / "Split horizontal"
- FixedWidthToggle → "Fixed width" row with pressed/checked state (`role="menuitemcheckbox"` or equivalent)
- TerminalFontControl (Aa) → a single row with inline `−` / `+` steppers operating on `ChromeContext.terminalFontSize` (same bounds `TERMINAL_FONT_BOUNDS`); does NOT open the existing popover from inside the menu
  <!-- assumed: inline stepper row over reopening the Aa popover — avoids nested-popover interaction; implementer may adjust if the row proves awkward -->
- BoardAutofitToggle → "Autofit panes" checkbox row (board mode only, only when `onToggleAutofit` present)
- ClosePaneButton → "Close pane" (terminal) / "Unpin pane" (board) row, honoring the same disabled conditions
- UpdateChip → when overflowed, its function merges into the fixed version row (change area 2); no separate row
- NotificationControl → flatten its own dropdown into direct rows ("Enable notifications" / "Send test notification", per current subscription state); hidden entirely when push is unsupported (unchanged)
- ThemeToggle → "Theme: {current}" row cycling system/light/dark on click
- RefreshButton → row labeled **"Refresh page"** (NOT "Refresh" — disambiguate from the new `Status: Refresh` palette action shipped in 260715-jykd; Shift+click force-reload behavior preserved or noted)
- HelpLink → "Help / Documentation" row (external link to `HELP_URL`)

### 5. Registry architecture

Replace the hardcoded right-cluster JSX sequence in `top-bar.tsx` with an ordered registry: each entry declares `{ id, tier, modes, exempt?, barRender, menuRender, hidden? }`. The registry:

- drives both the bar (first N items render as buttons) and the menu (the rest render as rows) from one ordered source;
- absorbs the per-item responsive gating hacks — UpdateChip's and NotificationControl's self-carried `hidden sm:flex` (needed to avoid empty-flex-item double gaps) become registry data;
- **removes the `hidden sm:flex` breakpoint cliff**: below `sm`, buttons no longer vanish — they overflow into the menu like at any other width. This is a deliberate behavior change: mobile gains access to theme/refresh/help/split/etc. through the chevron. Per-item opt-out (e.g. if splits prove undesirable on touch) remains possible via a registry `hidden` predicate.
  <!-- assumed: all current controls become menu-reachable on mobile rather than hidden; flagged in discussion as a win, user did not object — revisit per-item during apply if any control is clearly touch-hostile -->

### 6. Measurement mechanism

- Give the right-cluster grid item `min-w-0` (its track becomes squeezable; with q8ey's left/center floors in place, the right `1fr` track's width is then fully determined by the grid — independent of how many buttons the cluster shows, so there is **no feedback loop and no oscillation**, and no hysteresis buffer is needed).
- One `ResizeObserver` on the right cell; measured actual child widths (buttons vary: ViewSwitcher, UpdateChip, `coarse:` sizing — do not hardcode 24px).
- Pure fit computation in `src/lib/top-bar-overflow.ts`: `computeVisibleCount(availableWidth, itemWidths, reservedWidth)` → how many non-exempt items fit after reserving space for exempt items + chevron + dot + gaps. Unit-tested (Vitest) like the other `lib/palette-*.ts` pure helpers.
- Initial render: collapse-first (render with everything overflowed or measure in `useLayoutEffect` before paint) to avoid a visible flash of overflowing buttons.

### 7. Keyboard path unchanged

Constitution V is satisfied by the command palette, which already exposes every affected action (`View:`/`Pane:` splits, fixed width, terminal font, theme, update, maintenance, version, help on AppShell routes). The menu is a pointer affordance; no palette changes required. The menu itself is keyboard-operable per change area 2's a11y contract.

### 8. Tests

- Vitest: `computeVisibleCount` edge cases (zero width, all fit, partial fit, exempt reservation); registry mode-filtering; version-row states (plain / update-pending / unknown version).
- Playwright e2e + companion `.spec.md` (constitution; `just pw` / `just test-e2e` only): width sweep (e.g. 1280 → 1024 → 800 → 700 → 640 → 500 → 375) asserting (a) no bounding-box overlap anywhere, (b) L1 drops before L2 before L3, (c) chevron menu contains exactly the dropped controls + version row, (d) version row copies to clipboard, (e) exempt items (ViewSwitcher when multi-view, dot, chevron) always visible, (f) a menu action (e.g. theme cycle) works from the menu.

### Non-Goals

- No changes to the bottom bar (mobile terminal toolbar) or sidebar.
- No new palette actions; no removal of existing ones.
- No change to the left breadcrumb / center heading beyond what `q8ey` ships.
- No settings/config surface for customizing the order (convention over configuration).

## Affected Memory

- `run-kit/ui-patterns`: (modify) chrome section — the right-cluster L1/L2/L3 pyramid gains the overflow-chevron mechanism (drop order, exemptions, attention propagation, registry, always-present version row); the "update notification" entry gains the version-row-as-update-surface behavior; the 260715-ifco steady-state version surfaces list gains the menu's fixed version row.

## Impact

- `app/frontend/src/components/top-bar.tsx` — right cluster refactored to registry-driven rendering (largest single-file impact).
- New: `src/components/top-bar-overflow-menu.tsx` (or similar), `src/lib/top-bar-overflow.ts` + `.test.ts`, possibly `src/hooks/use-top-bar-overflow.ts`.
- Touched: `update-chip.tsx` (overflow-aware suppression when merged into version row), `view-switcher.tsx` (exempt flag only, if anything), `top-bar.test.tsx`.
- New Playwright spec + `.spec.md` companion.
- Frontend only — no Go/backend changes, no new dependencies (no floating-ui addition needed if the menu follows `BreadcrumbDropdown`'s positioning approach; `status-dot-tip.tsx` already brings floating-ui if absolute positioning proves insufficient).
- Constitution: IV (dropdown, not a new page/route), V (palette remains the keyboard path; menu keyboard-operable).

## Open Questions

- Should any controls be excluded from the mobile menu on touch-hostility grounds (e.g. splits at 375px)? Default: include everything; revisit during apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Always-visible chevron with a fixed `Run Kit v{version}` menu row | User-specified verbatim | S:95 R:90 A:95 D:95 |
| 2 | Certain | Drop order = L1→L2→L3 pyramid consumed from the left; surviving buttons never shift | Follows the documented pyramid invariant (260704-9o7k); recommended and accepted | S:85 R:85 A:95 D:90 |
| 3 | Confident | Chevron placed left of the connection dot (dot stays right-most terminator) | Preserves documented dot invariant; user said "at the end" but accepted the recommendation without objection | S:65 R:90 A:80 D:70 |
| 4 | Confident | ViewSwitcher + dot + chevron exempt from overflow | ViewSwitcher's all-breakpoints visibility is a documented deliberate decision (chat on mobile) | S:75 R:85 A:90 D:80 |
| 5 | Confident | Version row doubles as update surface when UpdateChip is overflowed; chevron carries an attention dot | Solves the lost-attention problem the pattern creates; extends 260715-ifco surfaces consistently; recommended and accepted | S:70 R:80 A:85 D:75 |
| 6 | Confident | Measurement via ResizeObserver on the right cell + pure `computeVisibleCount`, measured child widths, no hysteresis | Grid-determined track width removes the feedback loop; matches pure-lib project pattern | S:70 R:85 A:90 D:80 |
| 7 | Confident | Registry `{id, tier, modes, exempt, barRender, menuRender}` replaces hardcoded JSX + per-item `hidden sm:flex` gating | Single ordered source for bar+menu; kills the documented empty-flex-item gap hack | S:70 R:70 A:85 D:75 |
| 8 | Confident | Below-`sm` cliff removed: controls overflow into the menu on mobile instead of vanishing | Flagged in discussion as a deliberate behavior change and a win; per-item opt-out retained | S:65 R:75 A:80 D:70 |
| 9 | Tentative | Aa terminal-font control becomes an inline `−/+` stepper row in the menu | Avoids nested popover; one of two viable options discussed (stepper row vs reopening popover) | S:45 R:85 A:70 D:45 |
| 10 | Tentative | RefreshButton menu row labeled "Refresh page" | Disambiguates from 260715-jykd's `Status: Refresh`; exact label is implementer's call | S:50 R:95 A:80 D:60 |

10 assumptions (2 certain, 6 confident, 2 tentative, 0 unresolved).
