# Spec: Sidebar header "current item" affordances — Server collapsed shade + Sessions header name

**Change**: 260418-zar8-server-panel-collapsed-selected-shade
**Created**: 2026-04-18
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Active-tile body tint inside an expanded `ServerPanel` — already correct (uses `RowTint.selected` at `server-panel.tsx:222-224`).
- Tinting the `Sessions` panel header background from the current session's color — out of scope; the Sessions panel is always-open, so a persistent tint would double up with the colored active `WindowRow` body.
- Any change to `HostPanel`, `StatusPanel`/`WindowPanel`, or any other sidebar surface — they do not pass `tint` today and are unaffected.
- New theme tokens or `RowTint` fields — this change reuses the existing `RowTint.selected` shade.
- Changes to the `ServerSelector` legacy component or non-sidebar chrome.

## UI Patterns: Collapsible panel header tint shade

### Requirement: Collapsed-header tint SHALL use the selected shade when `tintOnlyWhenCollapsed` is set

When `CollapsiblePanel` is rendered with `tintOnlyWhenCollapsed` true AND the panel is collapsed AND a non-null `tint` is provided, the header background color MUST be `tint.selected` (the "selected row" shade — 32% saturated-ANSI blend per `themes.ts:206-232`). It MUST NOT use `tint.base`.

When `tintOnlyWhenCollapsed` is true AND the panel is open, no tint SHALL be applied to the header (existing behavior preserved).

When `tintOnlyWhenCollapsed` is false or omitted AND a non-null `tint` is provided, the header background MUST continue to use `tint.base` and hover MUST use `tint.hover` (existing behavior preserved — no caller currently exercises this mode, but the contract stays intact for forward compatibility).

#### Scenario: ServerPanel collapsed, active server has an assigned color
- **GIVEN** a user has `ServerPanel` collapsed and the active server has an assigned ANSI color
- **WHEN** the sidebar renders
- **THEN** the collapsed header background SHALL be `rowTints.get(activeColor).selected`
- **AND** the color visible in the collapsed header SHALL match the body tint of that same server's active tile when the panel is expanded

#### Scenario: ServerPanel collapsed, active server has no assigned color
- **GIVEN** a user has `ServerPanel` collapsed and the active server has no assigned color
- **WHEN** the sidebar renders
- **THEN** the collapsed header SHALL have no tinted background (existing fallback — `activeTint` resolves to null at `server-panel.tsx:79-80` and `CollapsiblePanel` applies no background)

#### Scenario: ServerPanel expanded (tintOnlyWhenCollapsed still true)
- **GIVEN** a user has expanded the `ServerPanel`
- **WHEN** the sidebar re-renders
- **THEN** the header SHALL have no tint (neither `.base` nor `.selected`)
- **AND** the active tile inside the panel SHALL continue to use `tint.selected` as its body background (unchanged at `server-panel.tsx:222-224`)

### Requirement: Hover on a selected-shade-tinted collapsed header SHALL stay at `tint.selected`

When the header background is `tint.selected` (per the previous requirement), pointer hover SHALL NOT change the background color. `tint.hover` (22% blend) MUST NOT be applied in this mode — it would render less saturated than the base selected shade and read as an inverted hover effect.

#### Scenario: Mouse enters collapsed, tinted ServerPanel header
- **GIVEN** a collapsed `ServerPanel` whose header is painted `tint.selected`
- **WHEN** the user moves the mouse over the header
- **THEN** the header background SHALL remain `tint.selected` with no visible change
- **AND** the cursor/interactive affordance on the toggle button itself (hover color on the title text, chevron) SHALL remain unchanged

#### Scenario: Mouse leaves a header in legacy tint mode (`tintOnlyWhenCollapsed` false)
- **GIVEN** a panel in legacy tint mode (no caller uses this today; contract-only)
- **WHEN** the user hovers and then leaves
- **THEN** the header SHALL transition `tint.base` → `tint.hover` → `tint.base` per existing behavior

## UI Patterns: Sessions panel header

### Requirement: Sessions header SHALL display the current session name on the right

The Sessions panel header (`app/frontend/src/components/sidebar/index.tsx:510-522`) MUST render the value of the `currentSession` prop, when non-null, on the right side of the header — between the "Sessions" label and the "+" new-session button. The rendered name SHALL use the same typographic treatment as the ServerPanel `headerRight` server name: `truncate text-text-primary font-mono`.

When `currentSession` is `null`, the header MUST NOT render the session name, placeholder text, or empty structural elements that change the layout.

#### Scenario: A session is selected
- **GIVEN** `currentSession === "editor"` is passed into `<Sidebar>`
- **WHEN** the Sessions header renders
- **THEN** the header SHALL contain the text `editor` in `text-text-primary font-mono` styling
- **AND** the text SHALL be positioned between the "Sessions" label and the `+` button

#### Scenario: No session is selected
- **GIVEN** `currentSession === null` is passed into `<Sidebar>`
- **WHEN** the Sessions header renders
- **THEN** the header SHALL render as "Sessions" label + `+` button only
- **AND** no blank span SHALL be inserted in place of the session name

#### Scenario: Long session name
- **GIVEN** `currentSession` is a long string (e.g., 40+ characters)
- **WHEN** the Sessions header renders at narrow sidebar widths
- **THEN** the session name SHALL truncate with ellipsis (per the `truncate` utility)
- **AND** the `+` button SHALL remain visible and unclipped

### Requirement: Sessions header SHALL normalize to ServerPanel text-color conventions

The Sessions panel header baseline color MUST be `text-text-secondary` (matching the ServerPanel header baseline). The current session name within the header MUST be `text-text-primary` (matching how ServerPanel renders the active server name).

The "Sessions" label SHALL use `font-medium` (unchanged from today).

#### Scenario: Text colors after normalization
- **GIVEN** the Sessions header is rendered
- **WHEN** inspected in the DOM
- **THEN** the outer header element SHALL apply `text-text-secondary`
- **AND** the "Sessions" label SHALL inherit `text-text-secondary`
- **AND** the session name span (when rendered) SHALL apply `text-text-primary`

### Requirement: Sessions header MUST NOT tint its background from the current session's color

The Sessions panel header background MUST remain the default sidebar chrome background. It MUST NOT adopt `RowTint.selected`, `.base`, or any other session-derived color.

#### Scenario: Current session has an assigned color
- **GIVEN** the current session has an assigned ANSI color (e.g., green)
- **WHEN** the Sessions header renders
- **THEN** the header background SHALL remain the default sidebar background (no colored overlay)
- **AND** only the session name text color SHALL reflect `text-text-primary` (no session-color tint)

## Design Decisions

1. **Gate shade selection on the existing `tintOnlyWhenCollapsed` flag (Option A).**
   - *Why*: The flag's semantic is already "this header tint is a proxy for the selected item inside the collapsed panel." The selected-shade reading is the direct match. `ServerPanel` is today's sole `tint` caller; adding a new prop (`tintShade`) for a single caller would just duplicate semantics.
   - *Rejected*: Option B — add a new `tintShade?: "base" | "selected"` prop, default `"base"`. Explicit, but adds surface for one caller and risks drifting out of sync with `tintOnlyWhenCollapsed`.

2. **Hover on the selected-shade-tinted header stays flat at `tint.selected` (Option H1).**
   - *Why*: `tint.hover` (22%) is *less* saturated than `tint.selected` (32%), so applying it on hover would look like the header backed off when hovered — the opposite of typical hover affordance. Flat-at-selected matches the "pressed/active button" convention: the header is already announcing "selected," further interactive darkening is redundant.
   - *Rejected*: Option H2 — compute a deeper hover shade (e.g., ~40% blend) via a new `tint.pressed` field or inline blending. Extra theme plumbing for a single surface.

3. **Sessions header is name-only, not tinted (Option 9 default).**
   - *Why*: The Sessions panel is always-open (not collapsible), so a persistent selected-shade tint on its header would be visually heavy, overlap with the colored active `WindowRow` body tint a few pixels below, and break the "tint = selected proxy while collapsed" semantic that `tintOnlyWhenCollapsed` encodes. The ServerPanel parallel the user asked for is surfacing the *current item name*; color is a ServerPanel-specific affordance tied to its collapsed-header proxy role.
   - *Rejected*: Tint the Sessions header from the current session color. Violates the semantic contract and adds visual noise.

4. **Normalize Sessions header text colors to ServerPanel parity (Option N1).**
   - *Why*: The user explicitly said "similarly" when expanding scope. For a user scanning the sidebar, the two headers being typographically matched (label in `text-text-secondary`, current-item name in `text-text-primary font-mono`) makes them read as the same class of affordance. Leaving the existing `text-text-primary` baseline on "Sessions" would give the two headers a subtly different visual weight — the inconsistency the user is trying to remove.
   - *Rejected*: Option N2 — leave the current Sessions header styling untouched. Minimal diff, but keeps the "subtly different" look that motivated the scope expansion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope: collapsed-header tint shade on `CollapsiblePanel` (triggered only by `ServerPanel` today) + `currentSession` display in Sessions header + Sessions-header text-color normalization | Confirmed from intake #1; clarified scope from user's follow-up | S:95 R:95 A:95 D:95 |
| 2 | Certain | Active-tile body tint in `ServerPanel` is out of scope — already uses `tint.selected` | Confirmed from intake #2 | S:90 R:95 A:95 D:95 |
| 3 | Certain | Files touched: `collapsible-panel.tsx`, `index.tsx` (+ `collapsible-panel.test.tsx`, `docs/memory/run-kit/ui-patterns.md`) | Confirmed from intake #3 | S:90 R:95 A:95 D:95 |
| 4 | Certain | Fix #1 implementation: gate shade on existing `tintOnlyWhenCollapsed` flag; no new prop added | Confirmed from intake #4 (user bulk-confirmed) | S:95 R:85 A:80 D:70 |
| 5 | Certain | Hover on the selected-shade-tinted collapsed header stays flat at `tint.selected` (no darken) | Confirmed from intake #5 (user chose H1 in clarify) | S:95 R:80 A:65 D:55 |
| 6 | Certain | Reuse `RowTint.selected` (no new tint field / no new theme token) | Confirmed from intake #6 | S:95 R:90 A:90 D:85 |
| 7 | Certain | Sessions header reuses the ServerPanel `headerRight` pattern: `<span className="truncate text-text-primary font-mono">{currentSession}</span>`, omitted entirely when `currentSession` is null | Confirmed from intake #7 | S:95 R:90 A:85 D:80 |
| 8 | Certain | Sessions header text-color normalizes to `text-text-secondary` baseline with session name in `text-text-primary` (Option N1) | Confirmed from intake #8 (user chose N1 in clarify) | S:95 R:80 A:60 D:55 |
| 9 | Certain | Sessions header does NOT tint from current session color — name only | Confirmed from intake #9 | S:95 R:85 A:75 D:65 |
| 10 | Certain | Memory update scoped to `run-kit/ui-patterns`; no spec doc change | Confirmed from intake #10 | S:95 R:85 A:85 D:80 |
| 11 | Certain | Unit coverage lands in `collapsible-panel.test.tsx`; no new Playwright spec unless existing spec asserts sidebar header composition | Confirmed from intake #11 | S:95 R:85 A:70 D:75 |
| 12 | Confident | Legacy tint mode (`tintOnlyWhenCollapsed` false or omitted) keeps the existing `tint.base` / `tint.hover` behavior unchanged — no caller uses this today but the contract stays intact for forward compatibility | No caller exercises this path; preserving existing behavior is the safe, non-breaking default — plus avoids bifurcating the component's public contract | S:70 R:85 A:80 D:75 |
| 13 | Confident | `currentSession` prop on `Sidebar` is already wired through from the caller — no upstream plumbing required | Grep-verified: `index.tsx:22, 39` declare and destructure `currentSession`; already consumed elsewhere in the component | S:80 R:90 A:90 D:85 |
| 14 | Confident | `sidebar/index.tsx` Sessions header stays a plain `<div>` (not a `CollapsiblePanel`) — no collapsibility added | User asked for an affordance parallel, not panel-type conversion; introducing collapse on Sessions would regress a core always-visible nav surface | S:70 R:85 A:80 D:75 |

14 assumptions (11 certain, 3 confident, 0 tentative, 0 unresolved).
