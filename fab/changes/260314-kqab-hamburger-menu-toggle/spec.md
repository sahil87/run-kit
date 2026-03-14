# Spec: Hamburger Menu Toggle

**Change**: 260314-kqab-hamburger-menu-toggle
**Created**: 2026-03-14
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Top Bar: Navigation Toggle Icon

### Requirement: Hamburger Icon Replaces Logo

The top-left toggle button in `app/frontend/src/components/top-bar.tsx` SHALL render an inline SVG hamburger icon (three horizontal lines) instead of the `<img src="/logo.svg">` element.

The SVG MUST:
- Use `currentColor` for stroke color (inherits from parent text color, consistent with other inline SVGs in the codebase like `FixedWidthToggle`)
- Be sized at 20×20 viewport (`width="20" height="20"`) to match the previous logo dimensions
- Render three horizontal lines with `strokeWidth="2"` and `strokeLinecap="round"`

The button wrapper (`<button>`) SHALL retain its existing `onClick`, `aria-label="Toggle navigation"`, `className` (including `coarse:` touch targets), and `hover:opacity-80` transition unchanged.

#### Scenario: Desktop sidebar toggle
- **GIVEN** the user is on a desktop viewport (≥ 768px)
- **WHEN** they click the hamburger icon
- **THEN** the sidebar toggles open/closed (same as before)

#### Scenario: Mobile drawer toggle
- **GIVEN** the user is on a mobile viewport (< 768px)
- **WHEN** they tap the hamburger icon
- **THEN** the drawer overlay opens/closes (same as before)

#### Scenario: Visual rendering
- **GIVEN** the top bar is rendered on any viewport
- **WHEN** the user views the top-left corner
- **THEN** they see a three-line hamburger icon (☰) instead of the hexagonal logo
- **AND** the icon color matches `text-text-secondary` (inherits from breadcrumb nav context)

### Requirement: Logo Asset Preserved

The file `app/frontend/public/logo.svg` SHALL NOT be deleted. It MAY be referenced elsewhere (favicon, future use). This change only removes its usage from the toggle button.

#### Scenario: Logo file untouched
- **GIVEN** the change is applied
- **WHEN** inspecting `app/frontend/public/logo.svg`
- **THEN** the file still exists with its original content

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Toggle behavior unchanged | Confirmed from intake #1 — user explicitly stated visual swap only | S:95 R:95 A:95 D:95 |
| 2 | Confident | Inline SVG over Unicode ☰ | Confirmed from intake #2 — SVG matches codebase pattern (FixedWidthToggle uses inline SVG). Consistent stroke styling, color inheritance via currentColor | S:75 R:90 A:85 D:75 |
| 3 | Certain | Logo.svg not deleted | Confirmed from intake #3 — only removing from toggle button, file preserved | S:85 R:90 A:85 D:90 |
| 4 | Certain | 20×20 SVG dimensions | Logo was 20×20; maintaining same bounding box avoids layout shift | S:85 R:95 A:90 D:90 |
| 5 | Certain | strokeLinecap round, strokeWidth 2 | Matches FixedWidthToggle SVG styling in the same file — consistent visual language | S:80 R:95 A:90 D:90 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
