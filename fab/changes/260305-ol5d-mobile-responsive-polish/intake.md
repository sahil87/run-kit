# Intake: 3/3 Mobile Responsive Polish

**Change**: 260305-ol5d-mobile-responsive-polish
**Created**: 2026-03-05
**Status**: Draft

## Origin

> Part 3 of the UI design philosophy implementation (see `docs/specs/design.md`). After change 1/3 (chrome architecture) and change 2/3 (bottom bar + compose), this change adds the responsive mobile layer — collapsing actions on narrow screens, ensuring touch targets, and adapting typography for phone use.

Interaction mode: conversational (arose from design philosophy discussion). All decisions resolved during discussion.

**Depends on**: `260305-emla-fixed-chrome-architecture` (change 1/3) for ChromeProvider and fixed chrome. `260305-fjh1-bottom-bar-compose-buffer` (change 2/3) for bottom bar (touch target sizing applies there too, but the component itself is created in 2/3).

## Why

1. **Core principle**: "Phone-Usable (iOS First)" is principle #6 in the design spec. Not an afterthought — checking agents from the couch, sending quick commands from phone.
2. **Line 2 actions overflow on mobile**: Dashboard has "New Session" + search input, Project has "New Window" + "Send Message". These don't fit on a 390px screen.
3. **Touch targets too small**: Current buttons use `text-sm px-3 py-1` — roughly 28px height. Apple HIG requires 44px minimum.
4. **No command palette trigger on mobile**: `⌘K` is meaningless without a physical keyboard. No alternative exists.
5. **Terminal font too large for phone**: 13px JetBrains Mono gives ~50 columns on a phone. Needs to scale down for usable terminal width.

If we don't do this: run-kit is desktop-only in practice, despite being a web app accessible from any browser.

## What Changes

### Line 2 Mobile Collapse

On screens < 640px (`sm:` breakpoint), Line 2 transforms:

**Desktop** (≥ 640px):
```
[+ New Session] [Search...]          3 sessions, 5 windows
```

**Mobile** (< 640px):
```
3 sessions, 5 windows                                 [⋯]
```

- Action buttons (left side) collapse — hidden on mobile
- Status text (right side) moves to the left — stays visible
- `⋯` button appears on the right — tapping opens the command palette
- The `⋯` button serves as the mobile command palette trigger (replaces `⌘K`)

Per-page mobile Line 2:
```
Dashboard:  3 sessions, 5 windows                     [⋯]
Project:    3 windows                                  [⋯]
Terminal:   ● active  fab: intake ◷                    [⋯]
```

**Implementation**: The ChromeProvider already receives `line2Left` and `line2Right` from pages. The `TopBarChrome` component checks screen width (CSS media query or `useMediaQuery` hook) and:
- On desktop: renders both slots normally
- On mobile: hides `line2Left`, shows `line2Right` + `⋯` button

### Command Palette Mobile Trigger

The `⋯` button in Line 2 (mobile only) opens the same `CommandPalette` component. This requires:
1. Exposing a `setOpen` or `open()` method from the command palette
2. The `⋯` button calling it on tap
3. The `⌘K` hint in Line 1 hidden on mobile (or replaced by `⋯`)

All page-specific actions (New Session, Kill Window, etc.) are already registered as palette actions. The `⋯` button just opens the same palette — no new action registration needed.

### Touch Target Audit

Ensure all interactive elements meet 44px minimum tap height:

| Element | Current | Required | Fix |
|---------|---------|----------|-----|
| Action buttons (New Session, etc.) | `py-1` (~28px) | 44px | `py-2.5` on mobile or min-h-[44px] |
| SessionCard | `p-3` (~48px total) | 44px | Already meets ✓ |
| Kill button (✕) | `text-xs` inline | 44px | Wrap in touch target padding |
| Breadcrumb links | `text-sm` inline | 44px | Add `py-2` or touch target wrapper |
| Bottom bar keys | Set in change 2/3 | 44px | Verify/enforce in this change |
| `⌘K` / `⋯` button | `px-1.5 py-0.5` (~24px) | 44px | Increase padding on mobile |

Use `@media (pointer: coarse)` or Tailwind's touch-specific utilities to apply larger targets only on touch devices, keeping desktop compact.

### Terminal Font Scaling

Terminal page font size adapts to screen width:
- Desktop (≥ 640px): 13px (current, ~108 columns at `max-w-4xl`)
- Mobile (< 640px): 10-11px (fits ~80+ columns on a 390px screen)

Implementation: Pass font size to xterm Terminal constructor based on a media query or `window.innerWidth` check. The FitAddon recalculates columns automatically.

### Full-Width on Mobile

On screens < 896px, the content container goes edge-to-edge:
- Desktop: `max-w-4xl mx-auto px-6`
- Mobile: `w-full px-3` (or `px-4`)

This applies to the root layout's wrapper divs (chrome + content). Tailwind responsive:
```
className="w-full max-w-4xl mx-auto px-3 sm:px-6"
```

### Line 1 `⌘K` → `⋯` on Mobile

The `⌘K` kbd hint in Line 1 is meaningless on mobile. Two options:
1. Hide it on mobile (the `⋯` in Line 2 serves the same purpose)
2. Replace it with a tappable `⋯` on mobile

Option 1 is simpler and avoids two `⋯` buttons. The Line 1 right side would just show the connection indicator on mobile.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document mobile collapse behavior, touch target sizes, responsive breakpoints, terminal font scaling

## Impact

- **New files**: Possibly `src/hooks/use-media-query.ts` (if not using CSS-only approach)
- **Modified files**: `src/components/top-bar-chrome.tsx` (mobile collapse logic), `src/components/command-palette.tsx` (expose open method), `src/app/layout.tsx` (responsive padding), `src/app/p/[project]/[window]/terminal-client.tsx` (responsive font size), all page client components (touch target adjustments)
- **Depends on**: Changes 1/3 and 2/3
- **Risk**: Low — mostly CSS/responsive adjustments on top of the architecture from changes 1/3 and 2/3

## Open Questions

None — all decisions resolved during design discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Line 2 actions collapse into command palette on mobile | Discussed — Resolved Decision #9, mockups agreed | S:95 R:90 A:90 D:95 |
| 2 | Certain | `⋯` button as mobile command palette trigger | Discussed — replaces `⌘K` which is meaningless on mobile | S:90 R:90 A:90 D:90 |
| 3 | Certain | 44px minimum touch targets (Apple HIG) | Discussed — Principle 6 (Phone-Usable) | S:85 R:90 A:90 D:90 |
| 4 | Certain | Full-width on screens < 896px | Discussed — Principle 6, `px-3` or `px-4` padding | S:85 R:95 A:90 D:90 |
| 5 | Confident | Terminal font 10-11px on mobile | Discussed — tradeoff between readability and column count, exact value needs testing | S:60 R:95 A:75 D:70 |
| 6 | Confident | Hide `⌘K` on mobile (don't replace with second `⋯`) | Simpler, avoids confusion of two `⋯` buttons. `⋯` in Line 2 is sufficient | S:55 R:95 A:80 D:70 |
| 7 | Confident | `@media (pointer: coarse)` for touch-specific sizing | Standard CSS approach, avoids JS-based device detection | S:55 R:95 A:85 D:75 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
