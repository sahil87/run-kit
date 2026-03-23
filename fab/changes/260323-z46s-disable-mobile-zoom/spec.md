# Spec: Disable Mobile Zoom on Input Focus

**Change**: 260323-z46s-disable-mobile-zoom
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Viewport: Zoom Prevention

### Requirement: Viewport Meta Tag SHALL Prevent Auto-Zoom

The `<meta name="viewport">` tag in `app/frontend/index.html` MUST include `maximum-scale=1.0` and `user-scalable=no` directives to prevent iOS Safari from auto-zooming when text inputs receive focus.

The existing `width=device-width`, `initial-scale=1.0`, and `interactive-widget=resizes-content` directives MUST be preserved unchanged.

The complete tag SHALL be:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content" />
```

#### Scenario: Text Input Focus on iOS Mobile
- **GIVEN** a user on iOS Safari at any viewport size
- **WHEN** the user taps a text input (command palette, compose buffer, text input dialog)
- **THEN** the browser SHALL NOT zoom in
- **AND** the interface layout (terminal, top bar, bottom bar) SHALL remain at 1x scale

#### Scenario: Pinch-to-Zoom Disabled
- **GIVEN** a user on any mobile browser
- **WHEN** the user attempts a pinch-to-zoom gesture
- **THEN** the page SHALL NOT zoom beyond 1x scale

#### Scenario: Existing Keyboard Behavior Preserved
- **GIVEN** a user on a mobile device with `interactive-widget=resizes-content` in the viewport tag
- **WHEN** the virtual keyboard opens
- **THEN** the layout SHALL resize content to accommodate the keyboard (existing behavior unchanged)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `maximum-scale=1.0` on viewport meta tag | Confirmed from intake #1 — user chose this approach | S:95 R:90 A:90 D:95 |
| 2 | Certain | Also add `user-scalable=no` for broader browser coverage | Confirmed from intake #2 — standard belt-and-suspenders | S:80 R:90 A:85 D:85 |
| 3 | Certain | Preserve existing `interactive-widget=resizes-content` | Confirmed from intake #3 — unrelated to zoom | S:90 R:95 A:90 D:95 |
| 4 | Confident | Accessibility tradeoff is acceptable | Confirmed from intake #4 — keyboard-first tool dashboard | S:70 R:80 A:75 D:80 |
| 5 | Certain | Single file change: `app/frontend/index.html` | Confirmed from intake #5 — only viewport meta involved | S:95 R:95 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
