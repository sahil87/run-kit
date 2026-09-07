# Intake: Breadcrumb Coarse-Pointer Touch Height Fix

**Change**: 260907-ibst-breadcrumb-coarse-touch-height
**Created**: 2026-09-07

## Origin

> Operator dispatch: "top nav issues on ipad" (bug report from user, iPad UI). The user
> attached a screenshot that turned out to be an unrelated Linear-agent transcript (not a
> clear top-nav bug), so the top toolbar's exact layout was used only as a visual reference.
> The dispatch asked the worker to reproduce/screenshot the top nav at real iPad breakpoints
> (768–1024px, both orientations) before drafting an intake, rather than guessing from the
> screenshot.
>
> Investigation (Chromium + WebKit via Playwright, real `devices["iPad Mini"]` /
> `devices["iPad Pro 11"]` profiles, 656–1366px width range, both orientations) found **no**
> overflow, clipping, or spacing defects in `TopBar`'s layout at any tested width — the
> component's fit-based overflow/collapse logic (`lib/top-bar-overflow.ts`,
> `lib/crumb-collapse.ts`) degrades gracefully everywhere.
>
> After reporting "no repro" back, the user clarified: "I was talking about the 'short'
> run-kit breadcrumb on top left" — pointing specifically at the top-left breadcrumb crumb
> row (brand "RunKit" crumb, plus the server/session crumbs), not at overflow/clipping.
> That reframed the investigation from *layout/overflow* to *control geometry*, and the root
> cause below was found by comparing the breadcrumb crumb's height class against the rest of
> the top bar's control geometry.

## Why

**The problem**: On a coarse-pointer device (iPad, or any touch device), the breadcrumb
crumbs in the top-left of `TopBar` — the brand "RunKit" crumb, the server crumb, and the
session crumb — render at `30px` tall, while every sibling control in the same toolbar row
(sidebar toggle, back/forward history arrows, and every right-cluster icon button) renders at
`40px` tall. The crumbs sit visibly shorter ("short") than their neighbors and present a
smaller touch target than the rest of the bar.

**Root cause**: `app/frontend/src/components/top-bar.tsx:288-289` defines:

```ts
const CRUMB_BOX_CLASS =
  "inline-flex items-center min-h-[28px] coarse:min-h-[30px] rounded border border-border px-1.5 py-0.5 text-text-secondary";
```

`coarse:min-h-[30px]` is the bug — it should be `coarse:min-h-[40px]`. The app's coarse
(touch) control floor is a single documented value, **40px**, defined once as
`--ctl-h-bar-coarse: 40px` in `app/frontend/src/globals.css:99` and consumed in lockstep by
every other top-bar control constant in `app/frontend/src/components/control.tsx`:

```ts
// control.tsx:111
const TOP_BAR_BUTTON_BASE =
  "w-[28px] h-[28px] coarse:w-[40px] coarse:h-[40px] rounded border transition-colors flex items-center justify-center shrink-0"; // lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse
// control.tsx:114
const TOP_BAR_BUTTON_H = "h-[28px] coarse:h-[40px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse
// control.tsx:115
const TOP_BAR_SEGMENT_H = "h-[26px] coarse:h-[38px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse minus the 2px wrapper border
// control.tsx:138
const WIDE_BTN_BASE =
  "min-h-[28px] coarse:min-h-[40px]"; // lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse
```

This 40px value is also the app's documented design-system standard: `docs/memory/run-kit/ui/visual-design.md:111`
states the `--ctl-h-bar-coarse: 40px` token explicitly and notes "the pair MUST change
together (the documented-lockstep convention...)". `CRUMB_BOX_CLASS` is the one control-height
constant in the top bar that broke this lockstep — every other constant correctly mirrors the
40px token; `CRUMB_BOX_CLASS` alone hardcodes 30px.

The doc comment directly above `CRUMB_BOX_CLASS` (`top-bar.tsx:280-283`) compounds the bug by
asserting something false:

```
 * min-h normalizes every crumb to the shared control height (28px fine /
 * 30px coarse — the same box as the toggle + HistoryNav arrows) so the left
 * cluster sits on one horizontal axis; a content-height crumb is ~1px shorter
 * and centers 1px high of the fixed-height buttons.
```

This claims parity with "the toggle + HistoryNav arrows," but those use `TOP_BAR_BUTTON_BASE`
/ the icon-button primitive, which is 40px coarse (confirmed via live Playwright measurement:
sidebar toggle and history-nav buttons measured 40×40px at `≥1024px` width with a coarse
pointer, while the breadcrumb crumb boxes measured with only ~30px allocated height in the
same row). The comment is stale/wrong and must be corrected alongside the fix so it doesn't
reintroduce the bug later.

**Consequence if unfixed**: iPad users get a visually inconsistent top bar (crumbs sit
shorter/mis-aligned against neighboring 40px controls) and a smaller-than-standard tap target
on the app's primary navigation affordance (the brand "RunKit" home crumb) — worse mobile/
tablet usability with no corresponding benefit.

**Why this approach**: The fix is a one-line value correction (`30px` → `40px`) plus a
comment correction, not a redesign — `CRUMB_BOX_CLASS`'s structure, fine-pointer height, and
every other property are already correct and already match the rest of the top bar; only the
coarse value drifted from the documented token.

## What Changes

### `app/frontend/src/components/top-bar.tsx`

1. **`CRUMB_BOX_CLASS` (line 289)**: change `coarse:min-h-[30px]` to `coarse:min-h-[40px]`,
   restoring lockstep with `--ctl-h-bar-coarse` (`globals.css:99`) and with every other
   top-bar control constant in `control.tsx` (`TOP_BAR_BUTTON_BASE`, `TOP_BAR_BUTTON_H`,
   `TOP_BAR_SEGMENT_H`, `WIDE_BTN_BASE`).

   ```diff
   - "inline-flex items-center min-h-[28px] coarse:min-h-[30px] rounded border border-border px-1.5 py-0.5 text-text-secondary";
   + "inline-flex items-center min-h-[28px] coarse:min-h-[40px] rounded border border-border px-1.5 py-0.5 text-text-secondary";
   ```

2. **Doc comment above `CRUMB_BOX_CLASS` (lines 280-283)**: correct "28px fine / 30px coarse"
   to "28px fine / 40px coarse" so the comment accurately reflects the height and its parity
   claim with the toggle/HistoryNav arrows becomes true instead of aspirational. Add the same
   `// lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse` trailing comment convention used by
   every other constant in `control.tsx`, so a future edit to `--ctl-h-bar-coarse` has a grep
   hit here too (this file currently has none — that missing lockstep marker is arguably the
   proximate cause of the drift).

### Not in scope

- No change to the **fine-pointer** height (`28px`) — only the coarse value is wrong.
- No change to `control.tsx`'s constants — they are already correct; this change brings
  `top-bar.tsx` into alignment with them, not the reverse.
- No change to crumb width/truncation behavior (`max-w-[16ch]`, `max-w-[6ch]` probe floor,
  `crumb-collapse.ts` hysteresis) — those are unrelated to the height regression and were
  independently verified correct during the investigation (Chromium + WebKit, 656–1366px,
  no overflow/clipping at any tested width).
- No change to `docs/memory/run-kit/ui/visual-design.md` — it already documents `40px` as the
  canonical coarse floor; this change makes the code match the existing, correct
  documentation, so no memory update is needed.

## Affected Memory

None. `docs/memory/run-kit/ui/visual-design.md` and `docs/memory/run-kit/ui/top-bar.md`
already document the 40px coarse-touch-floor convention accurately; this change fixes code
that was out of sync with that existing documentation. No memory file describes `30px` or
otherwise needs updating.

## Impact

- **Affected file**: `app/frontend/src/components/top-bar.tsx` (one constant + one comment
  block, lines ~280-289).
- **Affected UI surface**: the top-left breadcrumb crumbs (brand "RunKit" crumb, server
  crumb, session crumb) rendered by `TopBar` in every mode (`terminal`, `board`, `server`,
  `host`) whenever a coarse pointer is present (`useIsMobile()` / `any-pointer: coarse`) —
  i.e., iPad, other tablets, and touch-primary devices generally, regardless of viewport
  width.
- **No API, dependency, or cross-package impact.** Pure Tailwind class value fix, scoped to
  one file.
- **Visual delta**: breadcrumb crumb boxes grow from ~30px to 40px tall under coarse pointer
  only (no change under fine/mouse pointer) — aligns their height with the sidebar toggle,
  history arrows, and right-cluster icon buttons in the same row.

## Open Questions

(none — root cause and fix are fully determined from the codebase; this is a mechanical
value correction with a documented canonical value to align to)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix `CRUMB_BOX_CLASS`'s `coarse:min-h-[30px]` to `coarse:min-h-[40px]` | Directly verified against `--ctl-h-bar-coarse: 40px` (globals.css:99), every sibling control constant in control.tsx, and docs/memory/run-kit/ui/visual-design.md:111's documented lockstep convention; confirmed via live Playwright measurement (iPad device profiles, Chromium + WebKit) that sidebar toggle/history arrows render 40px while crumb boxes render ~30px in the same row | S:95 R:95 A:95 D:95 |
| 2 | Certain | Also correct the stale "30px coarse" doc comment (top-bar.tsx:280-283) in the same edit | Leaving the comment wrong would let it silently re-justify the bug on a future edit; the comment's own claim ("the same box as the toggle + HistoryNav arrows") becomes true only after the value fix | S:90 R:95 A:90 D:90 |
| 3 | Certain | No memory file needs updating | docs/memory/run-kit/ui/visual-design.md already documents 40px as canonical; this change brings code in line with existing docs, not the reverse | S:85 R:90 A:85 D:85 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).
