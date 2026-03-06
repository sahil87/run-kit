# Spec: iOS Keyboard Viewport Overlap

**Change**: 260307-f3o9-ios-keyboard-viewport-overlap
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Changing how non-fullbleed pages (dashboard, project) handle viewport — they don't trigger the keyboard in a meaningful way
- Reworking the `--app-height` mechanism — it correctly constrains the container height; only positioning is broken

## iOS Keyboard: Visual Viewport Scroll Compensation

### Requirement: Visual Viewport Scroll Listener

The `useVisualViewport` hook (`src/hooks/use-visual-viewport.ts`) SHALL listen to both the `resize` AND `scroll` events on `window.visualViewport`.

The `scroll` event fires when iOS Safari adjusts the visual viewport offset (e.g., panning to keep a focused element visible). Listening to both events ensures `--app-height` stays current regardless of which event fires first or in what order.

#### Scenario: Keyboard opens and iOS fires scroll before resize

- **GIVEN** the terminal page is open on iOS Safari
- **WHEN** the user taps the compose buffer or terminal, triggering the keyboard
- **AND** iOS fires a `scroll` event on `visualViewport` before the `resize` event
- **THEN** the `--app-height` CSS property SHALL be updated on the `scroll` event
- **AND** the app container SHALL shrink to fit above the keyboard

#### Scenario: Hook cleanup removes both listeners

- **GIVEN** the `useVisualViewport` hook is active
- **WHEN** the component unmounts
- **THEN** both the `resize` and `scroll` event listeners SHALL be removed from `window.visualViewport`
- **AND** the `--app-height` CSS property SHALL be removed from `document.documentElement`

### Requirement: Fixed Positioning in Fullbleed Mode

When the `fullbleed` CSS class is active on `<html>` (terminal page), the app's root flex container SHALL use `position: fixed` with `inset: 0` and `height: var(--app-height, 100vh)`.

This decouples the container from document scroll entirely. On iOS Safari, `overflow: hidden` on html/body does not reliably prevent the browser from scrolling the document when the keyboard opens. `position: fixed` removes this dependency — the container is pinned to the viewport origin regardless of page scroll.

The container div in `src/app/layout.tsx` SHALL have a stable CSS class (e.g., `app-shell`) so it can be targeted by the fullbleed CSS rule.

#### Scenario: Terminal page — keyboard opens on iOS

- **GIVEN** the terminal page is active (fullbleed class on `<html>`)
- **AND** the `useVisualViewport` hook is running
- **WHEN** the iOS keyboard appears
- **THEN** the app container SHALL remain pinned to `top: 0` of the viewport
- **AND** its height SHALL be `visualViewport.height` (the visible area above the keyboard)
- **AND** the bottom bar SHALL be visible above the keyboard
- **AND** the terminal (xterm) SHALL refit via the existing `ResizeObserver`

#### Scenario: Dashboard page — no effect

- **GIVEN** the dashboard or project page is active (no fullbleed class)
- **WHEN** the page renders
- **THEN** the app container SHALL NOT have `position: fixed`
- **AND** layout behavior SHALL be unchanged from current behavior

#### Scenario: Navigating away from terminal page

- **GIVEN** the terminal page was active (fullbleed, fixed positioning)
- **WHEN** the user navigates to the dashboard or project page
- **THEN** the fullbleed class SHALL be removed from `<html>` (existing behavior)
- **AND** the fixed positioning SHALL no longer apply
- **AND** `--app-height` SHALL be removed (existing hook cleanup)

### Requirement: Width Constraint Preserved

The fixed-position container SHALL maintain `width: 100%` so the `max-w-4xl mx-auto` constraints on child elements continue to work identically.

#### Scenario: Content width unchanged

- **GIVEN** the terminal page is active with fixed positioning
- **WHEN** the page renders
- **THEN** the top bar, content area, and bottom bar SHALL maintain their `max-w-4xl` centered layout
- **AND** horizontal padding (`px-6`) SHALL be preserved

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Listen to both `resize` and `scroll` on `visualViewport` | Confirmed from intake #2 — iOS fires `scroll` when viewport pans; `resize` when dimensions change. Both needed for robustness | S:80 R:90 A:95 D:95 |
| 2 | Certain | Use `position: fixed` scoped to `html.fullbleed` only | Upgraded from intake #3 (Confident→Certain) — fixed positioning is the only reliable way to decouple from iOS document scroll; `overflow: hidden` is insufficient on iOS Safari. Scoping to fullbleed ensures no impact on other pages | S:75 R:85 A:90 D:90 |
| 3 | Certain | No `--app-offset-top` needed | New — `position: fixed` pins to viewport origin regardless of document scroll offset, making offset tracking unnecessary. Simpler implementation. | S:80 R:90 A:90 D:95 |
| 4 | Certain | Add `app-shell` class to layout container div | New — required to target the container from CSS without fragile selectors. Minimal change to layout.tsx | S:85 R:95 A:90 D:90 |
| 5 | Certain | Only terminal page affected | Confirmed from intake #4 — fullbleed scoping ensures dashboard/project pages are completely unaffected | S:85 R:90 A:90 D:90 |
| 6 | Certain | Existing ResizeObserver handles xterm refit | Codebase confirms — `terminal-client.tsx` already has a ResizeObserver on the terminal div that calls `fitAddon.fit()` on resize | S:90 R:95 A:95 D:95 |

6 assumptions (6 certain, 0 confident, 0 tentative, 0 unresolved).
