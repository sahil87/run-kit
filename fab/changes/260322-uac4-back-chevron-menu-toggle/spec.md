# Spec: Back Chevron Menu Toggle

**Change**: 260322-uac4-back-chevron-menu-toggle
**Created**: 2026-03-22
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI: Navigation Toggle Icon

### Requirement: Chevron Open State

The `HamburgerIcon` component in `app/frontend/src/components/top-bar.tsx` SHALL render a left-pointing chevron (`<`) when `isOpen` is `true`, replacing the current X (crossed lines) animation.

The chevron MUST be formed by transforming the existing three SVG `<line>` elements:
- Top line: rotates to form the upper stroke of the chevron (angling down-left from center)
- Middle line: fades out (opacity 0) with scale to zero
- Bottom line: rotates to form the lower stroke of the chevron (angling up-left from center)

#### Scenario: Sidebar opens on desktop
- **GIVEN** the viewport width is >= 768px and `sidebarOpen` is false
- **WHEN** the user clicks the hamburger toggle button
- **THEN** `sidebarOpen` becomes true and the icon animates from three horizontal lines (☰) to a left-pointing chevron (<)
- **AND** the transition duration is 200ms with ease timing

#### Scenario: Drawer opens on mobile
- **GIVEN** the viewport width is < 768px and `drawerOpen` is false
- **WHEN** the user clicks the hamburger toggle button
- **THEN** `drawerOpen` becomes true and the icon animates from three horizontal lines (☰) to a left-pointing chevron (<)

#### Scenario: Sidebar/drawer closes
- **GIVEN** the sidebar or drawer is open (icon shows chevron)
- **WHEN** the user clicks the toggle button again
- **THEN** the icon animates back from chevron (<) to three horizontal lines (☰)

### Requirement: Closed State Unchanged

The `HamburgerIcon` component MUST continue to render three horizontal lines (☰) when `isOpen` is `false`. No changes to the closed-state SVG geometry or styling.

#### Scenario: Initial render
- **GIVEN** a fresh page load with sidebar/drawer closed
- **WHEN** the top bar renders
- **THEN** the hamburger icon shows three horizontal lines at y=4.5, y=9, y=13.5

### Requirement: Animation Continuity

The transition MUST use the same `200ms ease` timing function as the current X animation. The `transformOrigin` SHALL remain `9px 9px` (center of the 18x18 viewBox).

#### Scenario: Smooth transition
- **GIVEN** the icon is in closed state (three lines)
- **WHEN** `isOpen` changes to true
- **THEN** all line transforms animate over 200ms with ease timing
- **AND** the middle line fades out over 150ms (matching current behavior)

### Requirement: Accessibility Preserved

The button's `aria-label="Toggle navigation"` MUST NOT change. The SVG lines MUST retain `aria-hidden="true"` on the parent SVG element. Touch target dimensions (`min-w-[24px] min-h-[24px] coarse:min-w-[36px] coarse:min-h-[36px]`) MUST NOT change.

#### Scenario: Screen reader announcement
- **GIVEN** a screen reader is active
- **WHEN** focus reaches the hamburger toggle button
- **THEN** it announces "Toggle navigation" regardless of the icon's visual state

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hamburger (closed) icon stays the same | Confirmed from intake #1 — user only requested changing the open state | S:90 R:95 A:90 D:95 |
| 2 | Certain | Use CSS transform animation on existing SVG lines | Confirmed from intake #2 — same approach, no new SVG elements needed | S:80 R:90 A:95 D:90 |
| 3 | Confident | Chevron points left (`<`) | Confirmed from intake #3 — standard "close sidebar" affordance | S:75 R:90 A:85 D:80 |
| 4 | Confident | Keep 200ms ease transition timing | Confirmed from intake #4 — matches existing animation | S:70 R:95 A:85 D:85 |
| 5 | Certain | No aria-label changes needed | Confirmed from intake #5 — label describes action, not shape | S:85 R:95 A:90 D:95 |
| 6 | Certain | Chevron formed by rotating top/bottom lines ~30deg toward center | Codebase pattern — current X uses 45deg rotation; chevron uses smaller angle to create `<` shape | S:75 R:90 A:90 D:85 |
| 7 | Certain | Middle line fades out in chevron state (same as X state) | Current behavior fades middle line; no reason to change this for chevron | S:85 R:95 A:95 D:95 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
