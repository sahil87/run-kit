# Spec: Navbar Breadcrumb Dropdowns

**Change**: 260307-uzsa-navbar-breadcrumb-dropdowns
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Dashboard breadcrumb dropdowns — dashboard renders no breadcrumb segments, so there is nothing to attach a dropdown to
- Command palette integration for breadcrumb dropdowns — this is a mouse/touch interaction; keyboard navigation within dropdowns is sufficient
- Search/filtering within dropdowns — project and window lists are small enough that filtering is unnecessary

## Chrome: Breadcrumb Type Extension

### Requirement: Breadcrumb Type MUST Support Dropdown Items

The `Breadcrumb` type in `src/contexts/chrome-context.tsx` SHALL be extended with an optional `dropdownItems` property. When present, the breadcrumb segment renders a chevron toggle that opens a dropdown menu.

```typescript
export type BreadcrumbDropdownItem = {
  label: string;
  href: string;
  current?: boolean;
};

export type Breadcrumb = {
  icon?: string;
  label: string;
  href?: string;
  dropdownItems?: BreadcrumbDropdownItem[];
};
```

#### Scenario: Breadcrumb with no dropdown items
- **GIVEN** a breadcrumb with `dropdownItems` undefined or empty
- **WHEN** `TopBarChrome` renders the breadcrumb
- **THEN** no chevron is rendered
- **AND** behavior is identical to current implementation (link if `href`, static text otherwise)

#### Scenario: Breadcrumb with dropdown items
- **GIVEN** a breadcrumb with `dropdownItems` containing 2+ items
- **WHEN** `TopBarChrome` renders the breadcrumb
- **THEN** a chevron icon (`▾`) appears immediately after the label text
- **AND** the chevron is a separate click target from the label

## Chrome: Breadcrumb Dropdown Component

### Requirement: Chevron MUST Open a Dropdown Menu

A new `BreadcrumbDropdown` component (`src/components/breadcrumb-dropdown.tsx`) SHALL render the chevron button and its associated dropdown menu. The component receives `dropdownItems` and renders them as a list.

#### Scenario: Opening the dropdown
- **GIVEN** a breadcrumb segment with dropdown items and the dropdown is closed
- **WHEN** the user clicks the chevron icon
- **THEN** a dropdown menu appears below the breadcrumb segment
- **AND** the dropdown is visually aligned to the chevron/segment

#### Scenario: Selecting a dropdown item
- **GIVEN** the dropdown is open
- **WHEN** the user clicks an item
- **THEN** the browser navigates to the item's `href`
- **AND** the dropdown closes

#### Scenario: Current item highlighting
- **GIVEN** the dropdown is open and one item has `current: true`
- **WHEN** the dropdown renders
- **THEN** the current item has `text-accent` color
- **AND** all other items have `text-text-secondary` with `hover:text-text-primary`

#### Scenario: Dismiss on outside click
- **GIVEN** the dropdown is open
- **WHEN** the user clicks outside the dropdown
- **THEN** the dropdown closes

#### Scenario: Dismiss on Escape
- **GIVEN** the dropdown is open
- **WHEN** the user presses Escape
- **THEN** the dropdown closes

#### Scenario: Keyboard navigation
- **GIVEN** the dropdown is open
- **WHEN** the user presses ArrowDown/ArrowUp
- **THEN** focus moves between dropdown items
- **AND** pressing Enter on a focused item navigates to its `href`

### Requirement: Split Click-Target MUST Preserve Navigation

The label/name portion of a breadcrumb segment SHALL retain its existing click behavior (navigation via `href` or no-op if no `href`). The chevron SHALL be the sole trigger for the dropdown.

#### Scenario: Terminal page project breadcrumb — click name
- **GIVEN** the user is on the terminal page `/p/myproject/1`
- **WHEN** the user clicks the project name text "myproject"
- **THEN** the browser navigates to `/p/myproject` (existing back-navigation)
- **AND** the dropdown does NOT open

#### Scenario: Terminal page project breadcrumb — click chevron
- **GIVEN** the user is on the terminal page `/p/myproject/1`
- **WHEN** the user clicks the chevron next to the project name
- **THEN** the dropdown opens showing all projects
- **AND** "myproject" is highlighted as the current project

#### Scenario: Project page project breadcrumb — click name
- **GIVEN** the user is on the project page `/p/myproject`
- **WHEN** the user clicks the project name text "myproject"
- **THEN** nothing happens (no `href` — already on this page)

#### Scenario: Project page project breadcrumb — click chevron
- **GIVEN** the user is on the project page `/p/myproject`
- **WHEN** the user clicks the chevron next to the project name
- **THEN** the dropdown opens showing all projects
- **AND** "myproject" is highlighted as the current project

## Pages: Dropdown Data Population

### Requirement: Project Page MUST Provide Project Dropdown Items

The project page client component (`src/app/p/[project]/project-client.tsx`) SHALL populate `dropdownItems` on the project breadcrumb with all sessions from `useSessions()`, marking the current project as `current: true`.

#### Scenario: Project breadcrumb with session list
- **GIVEN** the user is on project page `/p/myproject` and there are 3 sessions
- **WHEN** the page sets breadcrumbs via `useChromeDispatch()`
- **THEN** the breadcrumb has `dropdownItems` with 3 entries
- **AND** each entry has `label` = session name, `href` = `/p/{name}`
- **AND** the entry matching `projectName` has `current: true`

### Requirement: Terminal Page MUST Provide Both Dropdowns

The terminal page client component (`src/app/p/[project]/[window]/terminal-client.tsx`) SHALL populate `dropdownItems` on both the project breadcrumb and the window breadcrumb.

#### Scenario: Terminal breadcrumbs with dropdown data
- **GIVEN** the user is on terminal page `/p/myproject/1?name=agent` with 3 sessions, and the current session has 4 windows
- **WHEN** the page sets breadcrumbs via `useChromeDispatch()`
- **THEN** the project breadcrumb has `dropdownItems` with 3 project entries (current project marked)
- **AND** the window breadcrumb has `dropdownItems` with 4 window entries
- **AND** each window entry has `href` = `/p/myproject/{index}?name={name}` and `current: true` on the matching window

### Requirement: Dashboard MUST NOT Have Dropdowns

The dashboard page (`src/app/dashboard-client.tsx`) SHALL continue to set empty breadcrumbs. No dropdown functionality on the dashboard.

#### Scenario: Dashboard breadcrumbs unchanged
- **GIVEN** the user is on the dashboard
- **WHEN** the page sets breadcrumbs
- **THEN** `setBreadcrumbs([])` is called (no change from current behavior)

## Visual: Dropdown Styling

### Requirement: Dropdown MUST Follow Existing Visual Patterns

The dropdown menu SHALL use the same dark theme styling as the Fn key dropdown in `bottom-bar.tsx`:

- Background: `bg-bg-card` with `border border-border` and `shadow-lg`
- Items: `px-3 py-2` padding, `text-sm`, `text-text-secondary` default, `hover:text-text-primary hover:bg-bg-primary` on hover
- Current item: `text-accent` color
- Z-index: `z-50`
- Min-width: `min-w-[160px]`
- ARIA: `role="menu"` on container, `role="menuitem"` on items

#### Scenario: Dropdown visual consistency
- **GIVEN** the dropdown is open
- **WHEN** the user views the dropdown
- **THEN** it has dark background, border, and shadow consistent with other dropdowns in the app
- **AND** items are legible in the dark theme with appropriate hover states

### Requirement: Chevron MUST Be Visually Subtle

The chevron icon (`▾`) SHALL be styled with `text-text-secondary` at a smaller font size, with `hover:text-text-primary` transition. It SHOULD have sufficient click target size (at least 24px tap area via padding).

#### Scenario: Chevron appearance
- **GIVEN** a breadcrumb with dropdown items
- **WHEN** the page renders
- **THEN** a `▾` character appears after the label in secondary color
- **AND** hovering the chevron changes it to primary color

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `useSessions()` data for dropdown items | Sessions and windows already available in session context — no new API needed | S:90 R:95 A:95 D:95 |
| 2 | Certain | Follow existing dropdown pattern from bottom bar Fn keys | Codebase has established custom dropdown pattern with outside-click, Escape, ARIA roles | S:85 R:90 A:95 D:90 |
| 3 | Certain | Split click-target: name navigates, chevron opens dropdown | Discussed — user chose chevron approach to preserve back-navigation | S:95 R:90 A:95 D:95 |
| 4 | Certain | Chevron on both project and window segments for consistency | Discussed — user explicitly requested | S:95 R:90 A:95 D:95 |
| 5 | Certain | Extend `Breadcrumb` type with optional `dropdownItems` array | Confirmed — natural extension point, pages opt in by providing items | S:95 R:85 A:80 D:75 |
| 6 | Certain | Project dropdown on both project and terminal pages | Confirmed — applies wherever project segment appears | S:95 R:90 A:80 D:80 |
| 7 | Certain | Window dropdown only on terminal page | Confirmed — window breadcrumb only exists there | S:95 R:95 A:90 D:95 |
| 8 | Certain | Dropdown opens downward from breadcrumb | Confirmed — standard pattern | S:95 R:90 A:85 D:80 |
| 9 | Certain | Current item highlighted with accent color | Confirmed — standard switcher pattern | S:95 R:95 A:85 D:90 |
| 10 | Certain | No dashboard dropdown | Dashboard has empty breadcrumbs — no segment to attach to | S:95 R:85 A:90 D:90 |
| 11 | Certain | New `BreadcrumbDropdown` component for dropdown UI | Separation of concerns — keeps `TopBarChrome` clean, dropdown logic encapsulated | S:80 R:90 A:90 D:85 |
| 12 | Certain | Use Next.js `Link` for dropdown items (client-side navigation) | Consistent with existing breadcrumb link usage in `top-bar-chrome.tsx` | S:85 R:95 A:95 D:95 |
| 13 | Confident | `BreadcrumbDropdownItem` uses `href` string (not `onClick` callback) | Dropdown items are navigational — `href` + `Link` is the right pattern for Next.js routing | S:75 R:90 A:85 D:80 |
| 14 | Confident | Chevron character is `▾` (U+25BE BLACK DOWN-POINTING SMALL TRIANGLE) | Simple, universally supported, visually consistent with existing Unicode icons (⬡, ❯) | S:70 R:95 A:80 D:70 |

14 assumptions (12 certain, 2 confident, 0 tentative, 0 unresolved).
