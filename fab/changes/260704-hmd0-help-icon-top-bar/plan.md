# Plan: Help Icon on Top Bar

**Change**: 260704-hmd0-help-icon-top-bar
**Intake**: `intake.md`

## Requirements

### Top Bar: Help Link Chip

#### R1: Route-agnostic help link in the top-bar right cluster
The top bar SHALL render a persistent help link chip in the route-agnostic block of the right cluster, positioned immediately after `ThemeToggle` and before the connection dot (the dot remains the right-most element). The chip MUST be an anchor (`<a>`), not a button, opening `HELP_URL` (`https://shll.ai/run-kit`) in a new tab with `target="_blank"` and `rel="noopener noreferrer"` so the dashboard's live terminal/SSE state is never unloaded. The chip MUST expose an accessible name via `aria-label` and a matching `title`.

- **GIVEN** any top-bar mode (terminal, root, board, cockpit)
- **WHEN** the top bar renders at or above the `sm` breakpoint
- **THEN** a help anchor with `href="https://shll.ai/run-kit"`, `target="_blank"`, `rel` containing `noopener`, and an `aria-label` is present
- **AND** it sits after the theme toggle and before the connection dot

#### R2: Chip visual matches the sibling cluster controls
The help chip SHALL reuse the documented uniform cluster chip styling — the same class string as `ThemeToggle` (`rk-glint` glint hover, `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]`, `rounded border border-border text-text-secondary hover:border-text-secondary transition-colors`, centered flex). Its glyph SHALL be a question-mark rendered as an inline 14px `currentColor` SVG, matching the sibling icons. The chip SHALL be wrapped in a `<span className="hidden sm:flex">` like every other cluster control (hidden below `sm`).

- **GIVEN** the help chip rendered in the right cluster
- **WHEN** compared to the adjacent `ThemeToggle`
- **THEN** it carries the identical chip class string and a 14px inline SVG `?` glyph
- **AND** it is wrapped in a `hidden sm:flex` span

#### R3: `HELP_URL` is a single shared named constant
The target URL SHALL be a named `HELP_URL` constant (no magic string), defined once in `top-bar.tsx` adjacent to the `HelpLink` component (mirroring the `NOTIFICATIONS_HELP_URL` precedent) and **exported** so the command-palette action consumes the same constant — the icon and the palette action cannot drift.

- **GIVEN** the help chip and the palette action
- **WHEN** the target URL is referenced
- **THEN** both read the single exported `HELP_URL` constant
- **AND** no literal `https://shll.ai/run-kit` string appears outside that constant

### Command Palette: Help Documentation Action

#### R4: `Help: Documentation` palette action
A `Help: Documentation` action SHALL be added to the route-agnostic palette action set in `app.tsx`, grouped with the existing `Help: Keyboard Shortcuts` entry in `configActions`. It SHALL open the imported `HELP_URL` in a new tab (`window.open(HELP_URL, "_blank", "noopener,noreferrer")`), satisfying Constitution V (the palette is the primary discovery mechanism) and the review rule that new user-facing actions be palette-registered. The action MUST conform to the real `PaletteAction` shape (`{ id, label, onSelect }`), not a `{ label, run }` shape.

- **GIVEN** the command palette is open
- **WHEN** the user selects `Help: Documentation`
- **THEN** `HELP_URL` opens in a new tab with `noopener,noreferrer`
- **AND** the action is defined with `id`, `label`, and `onSelect` fields

### Non-Goals

- No dedicated Playwright e2e — the chip is a static anchor in existing chrome with no interactive state; unit coverage in `top-bar.test.tsx` is proportionate (R5 below).
- No backend, API, route, or config changes — frontend-only.
- No relocation or restyling of the existing `NOTIFICATIONS_HELP_URL` bell-dropdown link.

### Design Decisions

1. **`PaletteAction` shape `{ id, label, onSelect }`**: the intake snippet showed `{ label, run }`, but the real `PaletteAction` type in `command-palette.tsx` is `{ id; label; onSelect }`. — *Why*: implement against the actual type. — *Rejected*: the intake's illustrative `run:` shape (would not compile).
2. **Palette action lives in `configActions` next to `Help: Keyboard Shortcuts`**: the intake said "alongside `viewActions`/`configActions`". — *Why*: `configActions` already hosts the sole other `Help:`-prefixed action, so co-locating keeps the `Help:` group cohesive and the diff minimal. — *Rejected*: a new standalone action array (unnecessary surface).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the exported `HELP_URL` constant and the `HelpLink` component to `app/frontend/src/components/top-bar.tsx` (adjacent placement near the other cluster controls / help-URL precedent): `export const HELP_URL = "https://shll.ai/run-kit";` and a `HelpLink()` returning an `<a>` with `href={HELP_URL}`, `target="_blank"`, `rel="noopener noreferrer"`, `aria-label`/`title` "Help — run-kit docs", the ThemeToggle chip class string, and an inline 14px `currentColor` question-mark SVG. <!-- R2 --> <!-- R3 -->
- [x] T002 Render `<HelpLink />` in the right cluster of `TopBar` in `app/frontend/src/components/top-bar.tsx`, in a `<span className="hidden sm:flex">` inserted immediately after the `ThemeToggle` span and before the connection-dot block; update the cluster-ordering comment to note the new element (FixedWidth → Notification → Theme → Help → connection dot). <!-- R1 -->
- [x] T003 Add the `Help: Documentation` palette action to `configActions` in `app/frontend/src/app.tsx`, immediately after the `keyboard-shortcuts` entry, as `{ id: "help-documentation", label: "Help: Documentation", onSelect: () => window.open(HELP_URL, "_blank", "noopener,noreferrer") }`; import `HELP_URL` from `@/components/top-bar`. <!-- R4 -->

### Phase 3: Tests

- [x] T004 Add a unit test block to `app/frontend/src/components/top-bar.test.tsx` asserting the help link renders with `href="https://shll.ai/run-kit"`, `target="_blank"`, `rel` containing `noopener`, and an accessible `aria-label`. <!-- R1 --> <!-- R3 -->

## Execution Order

- T001 blocks T002 (the cluster slot references `HelpLink`) and T003 (imports `HELP_URL`).
- T004 depends on T001+T002 (asserts the rendered chip).
- T002 and T003 are independent of each other once T001 lands.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The top bar renders a help anchor in the route-agnostic cluster after `ThemeToggle` and before the connection dot, in every mode, wrapped in `hidden sm:flex`.
- [x] A-002 R2: The help chip uses the identical chip class string as `ThemeToggle` and a 14px inline `currentColor` `?` SVG glyph.
- [x] A-003 R3: A single exported `HELP_URL` constant holds `https://shll.ai/run-kit`; no duplicate literal exists; the palette action imports it. (The only other literal is the T004-mandated test assertion — asserting the literal, not the imported constant, is what makes the test non-tautological.)
- [x] A-004 R4: A `Help: Documentation` palette action exists in `configActions` (shape `{ id, label, onSelect }`) opening `HELP_URL` in a new tab with `noopener,noreferrer`.

### Behavioral Correctness

- [x] A-005 R1: The help link opens externally in a new tab (`target="_blank"` + `rel="noopener noreferrer"`), never unloading the current dashboard.

### Scenario Coverage

- [x] A-006 R1: `top-bar.test.tsx` asserts the anchor's `href`, `target`, `rel` (contains `noopener`), and accessible name; `just test-frontend` passes. (892/892 tests, 51 files.)

### Code Quality

- [x] A-007 Pattern consistency: `HelpLink` follows the surrounding cluster-control conventions (chip classes, `hidden sm:flex` wrapper span, inline SVG, comment style); the palette action follows the `configActions` entry shape.
- [x] A-008 No unnecessary duplication: The URL lives in one exported constant reused by both the chip and the palette action; the chip class string matches the documented uniform cluster styling rather than being re-derived.
- [x] A-009 Type check: `cd app/frontend && npx tsc --noEmit` passes with no new errors. (Ran via `./node_modules/.bin/tsc --noEmit` — clean.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Frontend tests run via `just test-frontend` only (never `pnpm test`/`playwright` directly).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the pre-existing `NOTIFICATIONS_HELP_URL` bell-dropdown link is explicitly retained per Non-Goals).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement the palette action against the real `PaletteAction` type `{ id, label, onSelect }`, not the intake's illustrative `{ label, run }` | The actual type is defined in `command-palette.tsx`; the intake snippet was illustrative and would not compile | S:90 R:90 A:100 D:90 |
| 2 | Confident | Place the `Help: Documentation` action inside `configActions`, right after `Help: Keyboard Shortcuts` | Intake said "alongside viewActions/configActions"; configActions already hosts the only other `Help:` action, so co-location keeps the group cohesive and the diff minimal | S:65 R:90 A:85 D:75 |
| 3 | Certain | `id: "help-documentation"` for the palette action | Every existing `PaletteAction` carries a kebab-case `id`; this follows the established pattern | S:80 R:95 A:95 D:90 |
| 4 | Confident | Reuse the exact `ThemeToggle` chip class string verbatim (glint + sizing + border) | Intake mandates "chip styling identical to ThemeToggle"; ui-patterns documents uniform 24px/coarse:30px cluster sizing | S:75 R:90 A:90 D:80 |

4 assumptions (2 certain, 2 confident, 0 tentative).
