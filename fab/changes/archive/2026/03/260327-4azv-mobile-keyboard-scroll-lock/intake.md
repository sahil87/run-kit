# Intake: Mobile Keyboard Scroll Lock

**Change**: 260327-4azv-mobile-keyboard-scroll-lock
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Mobile keyboard scroll lock — the new keyboard toggle button (bottom-right on mobile) needs a way to signal scroll-only intent, preventing the keyboard from appearing when the user wants to read content and scroll up/down. This could be a long-press toggle on the keyboard button, a separate scroll-lock state, or another interaction pattern. The goal is a clear mode distinction: "I want to type" vs "I want to scroll and read". When in scroll-lock mode, tapping the terminal should not bring up the soft keyboard. The keyboard button should visually indicate the locked state.

One-shot input with clear functional requirements and an explicit interaction pattern suggestion (long-press on existing keyboard button).

## Why

On mobile, the soft keyboard occupies roughly half the screen. When a user is reading terminal output or scrolling through logs, any accidental tap on the terminal area summons the keyboard — obscuring the content they were trying to read. The current keyboard toggle button (⌨, bottom-right on touch devices) can dismiss the keyboard, but there's no way to *prevent* it from appearing in the first place.

Without a scroll-lock mode, mobile users must repeatedly dismiss the keyboard every time they accidentally tap the terminal while scrolling. This is especially frustrating when reviewing long output, reading logs, or navigating with the arrow pad — contexts where the keyboard is actively unwanted.

A long-press on the existing keyboard button is the natural interaction pattern: it reuses the existing affordance, doesn't add a new button to the already-full bottom bar, and follows mobile platform conventions (long-press for secondary actions).

## What Changes

### Scroll-Lock State

A new boolean state `scrollLocked` in the bottom bar component. When `true`:

- The terminal's xterm textarea is kept blurred (or prevented from receiving focus) so the soft keyboard cannot appear
- The keyboard toggle button visually indicates the locked state (e.g., different icon, background color, or border treatment using the existing `accent` color pattern from modifier toggles)
- Touch interactions on the terminal area (taps, scrolls) do NOT trigger keyboard appearance

### Long-Press Interaction on Keyboard Button

The existing keyboard toggle button (`⌨`, `bottom-bar.tsx` lines 282-298) gains a long-press handler:

- **Tap** (current behavior preserved): Toggle keyboard show/hide (focus/blur xterm textarea)
- **Long-press** (~500ms hold): Toggle scroll-lock mode on/off
- Long-press detection uses `touchstart`/`touchend` timing (similar pattern to ArrowPad's drag detection in `arrow-pad.tsx` lines 28-79)
- A brief haptic feedback or visual flash on lock activation (if `navigator.vibrate` available)

### Focus Prevention When Locked

When `scrollLocked === true`:

- The `onFocusTerminal` callback is suppressed — tapping the keyboard button in scroll-lock mode should unlock first, not summon the keyboard
- Touch events on the terminal area that would normally focus the xterm textarea are intercepted
- The `preventFocusSteal` pattern already used by bottom bar buttons (`e.preventDefault()` on `mousedown`) needs to extend to the terminal container itself during scroll-lock
- The existing touch scroll behavior (SGR mouse sequences for vertical swipe in `terminal-client.tsx` lines 263-324) continues to work — scroll-lock only prevents *focus*, not scroll gestures

### Visual Indicator

When scroll-locked, the keyboard button should show a distinct visual state:

- Icon change: lock symbol (`🔒` or CSS-based lock icon) replacing the keyboard symbol, or overlay indicator
- Styling: Use the same armed-state pattern as Ctrl/Alt modifier toggles — `bg-accent/20 border-accent text-accent` background tint
- The `aria-label` updates to reflect the locked state (e.g., "Scroll lock on — long press to unlock")

### State Lifecycle

- Scroll-lock is **session-scoped** — not persisted across page reloads or navigation
- Entering scroll-lock automatically dismisses the keyboard if it's currently visible (blur the terminal)
- Navigating to a different session/window resets scroll-lock to off
- The compose buffer (if open) is unaffected by scroll-lock — it has its own input field

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add scroll-lock mode documentation to Bottom Bar section — interaction pattern, visual states, focus prevention behavior

## Impact

- **`app/frontend/src/components/bottom-bar.tsx`** — Primary change: scroll-lock state, long-press handler on keyboard button, visual indicator, modified click behavior
- **`app/frontend/src/components/terminal-client.tsx`** — Focus prevention: intercept touch-initiated focus when scroll-locked (may need a prop or callback from parent)
- **`app/frontend/src/app.tsx`** — Wire scroll-lock state between BottomBar and TerminalClient (new prop or shared state)
- **Tests**: Unit tests for long-press detection, scroll-lock state toggling, focus prevention behavior

## Open Questions

- None — the description is specific enough to proceed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Long-press on existing keyboard button (not a new button) | User explicitly suggested this pattern; bottom bar is full at 375px | S:90 R:85 A:90 D:90 |
| 2 | Certain | Scroll-lock is session-scoped, not persisted | Transient UI state — no API or localStorage needed; consistent with modifier toggle pattern | S:70 R:95 A:90 D:90 |
| 3 | Certain | ~500ms long-press threshold | Clarified — user confirmed | S:95 R:95 A:80 D:75 |
| 4 | Certain | Use accent color pattern from modifier toggles for visual indicator | Clarified — user confirmed | S:95 R:90 A:85 D:70 |
| 5 | Certain | Focus prevention via intercepting focus events on terminal, not an overlay | Clarified — user confirmed | S:95 R:75 A:80 D:65 |
| 6 | Certain | Keyboard button icon changes when scroll-locked | Clarified — user confirmed | S:95 R:90 A:75 D:65 |
| 7 | Tentative | Haptic feedback via `navigator.vibrate` on lock toggle | Nice-to-have UX cue; API availability varies; graceful no-op if unavailable | S:40 R:95 A:60 D:50 |
<!-- assumed: haptic feedback — common mobile pattern, non-critical, degrades gracefully -->

7 assumptions (6 certain, 0 confident, 1 tentative, 0 unresolved).

## Clarifications

### Session 2026-03-27 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 3 | Confirmed | — |
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Confirmed | — |
