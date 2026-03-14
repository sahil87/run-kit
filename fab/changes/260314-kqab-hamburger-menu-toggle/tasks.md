# Tasks: Hamburger Menu Toggle

**Change**: 260314-kqab-hamburger-menu-toggle
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Replace `<img src="/logo.svg">` with inline SVG hamburger icon in `app/frontend/src/components/top-bar.tsx` (line 80). SVG: 20×20 viewBox, three horizontal lines, `stroke="currentColor"`, `strokeWidth="2"`, `strokeLinecap="round"`. Button wrapper unchanged.

## Phase 2: Verification

- [x] T002 Run existing frontend tests (`pnpm --filter frontend test`) to confirm no regressions. Tests reference the toggle button by `aria-label="Toggle navigation"`, not the logo image — should pass without changes.

---

## Execution Order

- T001 blocks T002
