# Spec: Normalize Toolbar Icon Colors

**Change**: 260321-y11t-normalize-toolbar-icon-colors
**Created**: 2026-03-21
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI Chrome: Toolbar Button Colors

### Requirement: Consistent Default Foreground Color

All toolbar buttons in the top bar and bottom bar MUST use `text-text-secondary` as their default (inactive) foreground color. Buttons SHALL NOT use `text-text-primary` for their default state.

#### Scenario: Top Bar Compose Button

- **GIVEN** the top bar is rendered on a terminal page
- **WHEN** the compose button (`>_`) is in its default (inactive) state
- **THEN** it MUST use `text-text-secondary` for text color
- **AND** it MUST use `hover:border-text-secondary` for hover state

#### Scenario: Bottom Bar Key Buttons

- **GIVEN** the bottom bar is rendered on a terminal page
- **WHEN** Esc, Tab, Fn trigger, and arrow pad buttons are in their default state
- **THEN** they MUST use `text-text-secondary` for text color

#### Scenario: Bottom Bar Modifier Toggles (Inactive)

- **GIVEN** the Ctrl or Alt modifier toggle is not armed
- **WHEN** the button is rendered
- **THEN** it MUST use `text-text-secondary` for text color

### Requirement: Active Toggle State Preserved

Buttons with active/toggle states (Ctrl, Alt, FixedWidthToggle) MUST retain `text-accent` with accent background when active. This change SHALL NOT modify active state styling.

#### Scenario: Armed Modifier Toggle

- **GIVEN** the Ctrl modifier toggle is armed (pressed)
- **WHEN** the button is rendered
- **THEN** it MUST use `text-accent` with `bg-accent/20` and `border-accent`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All toolbar buttons default to `text-text-secondary` | Confirmed from intake #1 — user explicitly verified via screenshots | S:95 R:90 A:95 D:95 |
| 2 | Certain | Active toggle states keep `text-accent` | Confirmed from intake #2 — only inactive states were inconsistent | S:90 R:90 A:90 D:95 |
| 3 | Certain | Hover pattern is `hover:border-text-secondary` | Confirmed from intake #3 — matches existing ThemeToggle/FixedWidthToggle pattern | S:85 R:90 A:90 D:90 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).
