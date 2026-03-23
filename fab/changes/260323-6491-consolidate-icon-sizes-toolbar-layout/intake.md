# Intake: Consolidate Icon Sizes and Toolbar Layout

**Change**: 260323-6491-consolidate-icon-sizes-toolbar-layout
**Created**: 2026-03-23
**Status**: Draft

## Origin

> User reviewed all icon and button sizes across the frontend after noticing excessive conditional sizing logic. Discussion identified 6+ distinct size values applied ad-hoc per component with `coarse:` pointer-type variants creating unnecessary complexity. User directed consolidation to exactly two flat size tiers and several toolbar layout changes.

Interaction mode: conversational (multi-turn discussion refining approach).

## Why

The frontend had accumulated one-off icon/button sizes (24px, 28px, 30px, 32px, 36px, 44px) and pointer-type conditional variants (`coarse:min-h-[44px]`, `coarse:min-w-[36px]`, asymmetric `coarse:min-h-[36px] coarse:min-w-[28px]`) across components. This made the sizing system hard to reason about, inconsistent, and error-prone when adding new buttons. The `coarse:` (touch vs mouse) distinction added a second axis of variation that didn't justify the complexity — the larger "standard" size (36px) works fine for both mouse and touch input.

Additionally, the compose button (`>_`) was in the top bar but logically belongs with the other terminal key buttons in the bottom bar. The top-right icon order placed the logo leftmost, but it reads more naturally as the rightmost anchor element.

## What Changes

### Two-tier button sizing

All interactive button/icon containers use exactly one of two sizes:

- **Compact** (24×24px): Top bar toolbar buttons — hamburger, theme toggle, split horizontal, split vertical, fixed-width toggle, breadcrumb dropdown triggers
- **Standard** (36×36px): Bottom bar keyboard buttons (Esc, Tab, Ctrl, Alt, Fn, arrow pad, CmdK, compose), sidebar session/window rows, dashboard interactive cards

No `coarse:` pointer-type variants. No responsive size switching. One flat value per tier.

### Files changed and specific size migrations

**`app/frontend/src/components/top-bar.tsx`**:
- Hamburger: `min-w-[24px] min-h-[24px] coarse:min-w-[36px] coarse:min-h-[36px]` → `min-w-[24px] min-h-[24px]`
- Theme toggle: `coarse:min-h-[36px] coarse:min-w-[28px]` → removed (was already 24px base)
- Split buttons: same as theme toggle
- Fixed-width toggle: same as theme toggle
- Compose button: removed entirely (moved to bottom bar)

**`app/frontend/src/components/breadcrumb-dropdown.tsx`**:
- Trigger button: `coarse:min-w-[36px] coarse:min-h-[36px]` → removed (24px base stays)

**`app/frontend/src/components/bottom-bar.tsx`**:
- `KBD_CLASS`: `min-h-[36px] min-w-[36px] coarse:min-h-[36px] coarse:min-w-[36px]` → `min-h-[36px] min-w-[36px]` (removed redundant coarse)
- Fn/ext key popup buttons: `min-h-[30px]` → `min-h-[36px]`
- Added compose button (`>_`) before CmdK button
- Removed separator between Tab and Ctrl/Alt
- Removed separator between Alt and Fn popup

**`app/frontend/src/components/arrow-pad.tsx`**:
- Main button: `min-h-[36px] min-w-[36px] coarse:...` → `min-h-[36px] min-w-[36px]`
- Popup arrow buttons: `min-h-[30px] min-w-[30px]` → `min-h-[36px] min-w-[36px]`

**`app/frontend/src/components/sidebar.tsx`**:
- Session collapse/expand, session name, +/× buttons: `min-h-[32px] coarse:min-h-[44px]` → `min-h-[36px]`
- Window items: `min-h-[28px] coarse:min-h-[44px]` → `min-h-[36px]`
- Kill window button: `min-h-[28px] coarse:min-h-[44px]` → `min-h-[36px]`
- Server selector button: `coarse:min-h-[44px]` → `min-h-[36px]`

**`app/frontend/src/components/dashboard.tsx`**:
- Session cards, window buttons, create buttons: `coarse:min-h-[44px]` → `min-h-[36px]`

**`app/frontend/src/app.tsx`**:
- Pass `onOpenCompose` prop to `BottomBar`

### Compose button relocation

The compose text button (`>_`) moved from the top bar (visible on all viewports) to the bottom bar (next to the CmdK button, after the separator). It receives `onOpenCompose` as an optional prop on `BottomBar`.

### Bottom bar separator removal

Two separators removed:
- Between Tab and Ctrl/Alt modifier buttons
- Between Alt and Fn popup button

One separator retained: before the compose + CmdK group.

### Top-right icon order reversal

Previous order (left to right): Logo, "Run Kit", dot, [FixedWidth, SplitH, SplitV], Theme

New order (left to right): Theme, [SplitV, SplitH, FixedWidth], dot, "Run Kit", Logo

The logo is now the rightmost anchor element. The `<a>` link wrapping logo + "Run Kit" text now has text before image.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update button sizing conventions to document the two-tier system (compact 24px, standard 36px)

## Impact

- **Components**: top-bar, bottom-bar, arrow-pad, sidebar, breadcrumb-dropdown, dashboard, app.tsx
- **Touch targets**: Touch-specific sizing removed. 36px standard buttons are within acceptable touch target range (Apple HIG recommends 44px minimum, but 36px is the pragmatic choice for density). 24px compact buttons in the top bar are desktop-only controls (split, theme, fixed-width are `hidden sm:flex`).
- **Visual density**: Desktop sidebar rows get slightly taller (28→36px for windows, 32→36px for sessions). Bottom bar buttons get slightly smaller on desktop (were 36px, stay 36px) but lose the coarse bump to 44px on touch.

## Open Questions

None — all decisions made during conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two size tiers: compact (24px) and standard (36px) | Discussed — user explicitly chose these values after reviewing all existing sizes | S:95 R:85 A:90 D:95 |
| 2 | Certain | No pointer-type (`coarse:`) conditional sizing | Discussed — user questioned the logic of pointer-type variants and chose to eliminate them | S:95 R:80 A:85 D:95 |
| 3 | Certain | Arrow pad and fn keys use standard (36px) tier | Discussed — user explicitly said "arrow pad, function key buttons become list" (later renamed standard) | S:95 R:90 A:90 D:95 |
| 4 | Certain | Compose button moves from top bar to bottom bar next to CmdK | Discussed — user's explicit request | S:95 R:85 A:90 D:95 |
| 5 | Certain | Remove separators between Tab/Ctrl and Alt/Fn in bottom bar | Discussed — user specified "remove separators from between 2nd and 3rd and 4th and 5th icons" | S:95 R:90 A:90 D:95 |
| 6 | Certain | Reverse top-right icon order so logo is rightmost | Discussed — user's explicit request with specific layout description | S:95 R:85 A:90 D:95 |
| 7 | Confident | `coarse:opacity-100` on sidebar kill button is retained (visibility concern, not sizing) | Not discussed explicitly but logically separate from sizing consolidation | S:60 R:90 A:85 D:90 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
