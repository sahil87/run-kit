# Spec: Fixed Chrome Architecture

**Change**: 260305-emla-fixed-chrome-architecture
**Created**: 2026-03-06
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Bottom bar implementation — deferred to change 2/3
- Mobile-specific polish — deferred to change 3/3
- RunKit logo SVG creation — use a text placeholder (`RK`) until a real SVG is designed

## Layout Architecture

### Requirement: Root Layout Owns Chrome Skeleton

The root layout (`src/app/layout.tsx`) SHALL own the full-height flex-column skeleton with three zones: top chrome (shrink-0), content (flex-1, scrollable), and bottom slot (shrink-0). Pages MUST NOT render their own outer containers or set page-level dimensions.

The top chrome and content zones SHALL both use `max-w-4xl mx-auto w-full px-6` for identical width/padding. Pages cannot override this.

#### Scenario: Page Navigation Preserves Layout Dimensions
- **GIVEN** the user is on the Dashboard page
- **WHEN** they navigate to a Project page or Terminal page
- **THEN** the top bar width, padding, and vertical position SHALL remain identical — no visible layout shift

#### Scenario: Terminal Page Fills Available Height
- **GIVEN** the user navigates to the Terminal page
- **WHEN** the page renders with xterm.js
- **THEN** the terminal container SHALL fill all vertical space between the top chrome and the bottom of the viewport
- **AND** the FitAddon SHALL correctly size the terminal to the available space

### Requirement: Body Uses Fixed Height

The `<body>` element SHALL use `h-screen` (not `min-h-screen`) and the flex-column layout SHALL use `h-screen` to create a fixed viewport. Content overflow SHALL be handled by `overflow-y-auto` on the content zone.

#### Scenario: Long Session List Scrolls in Content Zone
- **GIVEN** a Dashboard with more sessions than fit in the viewport
- **WHEN** the user scrolls
- **THEN** only the content zone scrolls — the top chrome remains fixed in place

## ChromeProvider Context

### Requirement: Slot Injection via React Context

A new `ChromeProvider` context (`src/contexts/chrome-context.tsx`) SHALL provide slot setters for breadcrumbs, line2Left, line2Right, and bottomBar. The provider SHALL wrap all children in the root layout.

```typescript
type Breadcrumb = {
  icon?: string;
  label: string;
  href?: string;
};

type ChromeContextType = {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  line2Left: React.ReactNode;
  setLine2Left: (node: React.ReactNode) => void;
  line2Right: React.ReactNode;
  setLine2Right: (node: React.ReactNode) => void;
  bottomBar: React.ReactNode;
  setBottomBar: (node: React.ReactNode) => void;
};
```

#### Scenario: Page Sets Breadcrumbs on Mount
- **GIVEN** the Dashboard client component mounts
- **WHEN** its `useEffect` runs
- **THEN** it SHALL call `setBreadcrumbs([])` (logo-only for Dashboard)
- **AND** the TopBarChrome SHALL render only the logo in the breadcrumb area

#### Scenario: Page Sets Line 2 Content
- **GIVEN** the Project client component mounts
- **WHEN** its `useEffect` runs
- **THEN** it SHALL call `setLine2Left` with the "+ New Window" and "Send Message" buttons
- **AND** `setLine2Right` with the window count
- **AND** TopBarChrome SHALL render these in Line 2

#### Scenario: Context Cleanup on Unmount
- **GIVEN** a page component has set breadcrumbs and line2 content
- **WHEN** the user navigates away (component unmounts)
- **THEN** the `useEffect` cleanup SHALL reset breadcrumbs to `[]` and line2Left/line2Right to `null`

## TopBarChrome Component

### Requirement: Fixed Two-Line Top Bar

`TopBarChrome` (`src/components/top-bar-chrome.tsx`) SHALL replace the current `TopBar` component. It SHALL read all display data from ChromeProvider context.

**Line 1** (fixed height): Left — breadcrumbs with icon format. Right — connection dot + "live"/"disconnected", `⌘K` kbd hint.

**Line 2** (fixed height, ALWAYS rendered): Left — `line2Left` from context (or empty). Right — `line2Right` from context (or empty). SHALL use `min-h-[36px]` to guarantee consistent height even when slots are empty.

#### Scenario: Line 2 Always Rendered
- **GIVEN** the Dashboard page with no line2 actions set
- **WHEN** the page renders (before `useEffect` fires or if slots are empty)
- **THEN** Line 2 SHALL still render with its minimum height
- **AND** the top bar total height SHALL be identical to when Line 2 has content

#### Scenario: Connection Status Display
- **GIVEN** the SSE connection is active
- **WHEN** TopBarChrome renders
- **THEN** it SHALL show a green dot with "live" text
- **AND** when the connection drops, it SHALL show a gray dot with "disconnected"

### Requirement: Icon-Driven Breadcrumbs

Breadcrumbs SHALL use a compact icon-driven format:

| Page | Breadcrumb |
|------|-----------|
| Dashboard | `RK` (logo placeholder) |
| Project | `RK › ⬡ {projectName}` |
| Terminal | `RK › ⬡ {projectName} › ❯ {windowName}` |

- The logo placeholder (`RK`) SHALL always link to `/`
- `⬡` (Unicode hexagon U+2B21) precedes the project name, styled `text-text-secondary`
- `❯` (Unicode heavy right-pointing angle U+276F) precedes the window name, styled `text-text-secondary`
- All segments except the last SHALL be clickable links
- No text prefixes like "project:" or "window:"

#### Scenario: Dashboard Breadcrumb
- **GIVEN** the user is on the Dashboard
- **WHEN** TopBarChrome renders breadcrumbs
- **THEN** only the `RK` logo placeholder SHALL appear (no additional segments)

#### Scenario: Terminal Breadcrumb with Navigation
- **GIVEN** the user is on the Terminal page for project "run-kit", window "zsh"
- **WHEN** they click the `⬡ run-kit` breadcrumb segment
- **THEN** they SHALL navigate to `/p/run-kit`

### Requirement: TopBarChrome Needs Connection Status

TopBarChrome SHALL accept an `isConnected` prop (boolean) for the connection indicator. This prop is passed by the root layout or provided via context — it is NOT read from ChromeProvider (connection status is a global concern, not a page-set slot).

#### Scenario: isConnected Prop Drives Indicator
- **GIVEN** TopBarChrome receives `isConnected={true}`
- **WHEN** it renders the connection indicator
- **THEN** it SHALL show `bg-accent-green` dot + "live" label

## Page Rewiring

### Requirement: Pages Remove Own TopBar and Container

Each page client component SHALL remove its own `<TopBar>` rendering and its wrapping `max-w-4xl mx-auto p-6` container. Pages SHALL set chrome slots via `useEffect` and render only their content.

#### Scenario: Dashboard Rewiring
- **GIVEN** `DashboardClient` mounts
- **WHEN** it renders
- **THEN** it SHALL NOT render `<TopBar>` or a `max-w-4xl mx-auto p-6` wrapper
- **AND** it SHALL call `setBreadcrumbs([])`, `setLine2Left(...)` with the "+ New Session" button and search input, `setLine2Right(...)` with session/window counts
- **AND** its return SHALL contain only the session list, dialogs, and command palette

#### Scenario: Project Rewiring
- **GIVEN** `ProjectClient` mounts
- **WHEN** it renders
- **THEN** it SHALL call `setBreadcrumbs([{ icon: '⬡', label: projectName, href: '/p/' + projectName }])`
- **AND** `setLine2Left(...)` with "+ New Window" and "Send Message" buttons
- **AND** `setLine2Right(...)` with window count

#### Scenario: Terminal Rewiring
- **GIVEN** `TerminalClient` mounts
- **WHEN** it renders
- **THEN** it SHALL call `setBreadcrumbs` with project and window segments
- **AND** it SHALL remove its own `h-screen flex flex-col` container and `max-w-[900px]` width
- **AND** the terminal `ref` div SHALL use `flex-1 min-h-0` to fill the content zone

## Kill Button Visibility

### Requirement: Always-Visible Kill Button

The `SessionCard` kill button (`src/components/session-card.tsx`) SHALL be always visible — no `opacity-0 group-hover:opacity-100`. It SHALL use `text-text-secondary hover:text-text-primary transition-colors`.

#### Scenario: Kill Button Visible Without Hover
- **GIVEN** a SessionCard renders on a touch device
- **WHEN** the user views the card (no hover)
- **THEN** the `✕` button SHALL be visible and tappable

## Deprecated Requirements

### TopBar Component (`src/components/top-bar.tsx`)

**Reason**: Replaced by `TopBarChrome` which reads from ChromeProvider context instead of accepting props/children. The conditional Line 2 rendering (`{children && (...)}`) caused height shifts.

**Migration**: All pages use ChromeProvider setters + `TopBarChrome`. Remove `top-bar.tsx` after all pages are rewired.

## Design Decisions

1. **New `TopBarChrome` component instead of refactoring `TopBar`**
   - *Why*: The old `TopBar` has conditional rendering and props-based content baked in. A clean-break new component is simpler than retrofitting the context pattern into the existing one.
   - *Rejected*: Refactoring `TopBar` in-place — would require maintaining backward compatibility during transition and the conditional `{children && (...)}` pattern is fundamentally incompatible with always-rendered Line 2.

2. **React Context for slot injection (not props drilling or Zustand)**
   - *Why*: Slots are UI-only, scoped to the layout tree, and don't need persistence or middleware. React Context is the lightest-weight solution.
   - *Rejected*: Props drilling (layout can't pass props to `{children}` in Next.js App Router). Zustand (overkill for UI slot management).

3. **`max-w-4xl` (896px) as the universal width**
   - *Why*: Already used by Dashboard and Project pages. Aligns with Tailwind's native scale. Terminal's `max-w-[900px]` was a 4px deviation with no visual justification.
   - *Rejected*: Keeping `max-w-[900px]` for terminal — inconsistency is the root cause of layout shift.

4. **BottomSlot rendered in layout but empty for this change**
   - *Why*: The layout skeleton needs the slot to exist so change 2/3 (bottom bar) can inject content without modifying the layout. Rendering an empty div with `shrink-0` has zero visual impact.
   - *Rejected*: Omitting the bottom slot — would require layout changes in the next change, defeating the purpose of establishing the skeleton now.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root layout owns chrome (flex-col skeleton) | Confirmed from intake #1 — discussed, user confirmed | S:95 R:75 A:90 D:95 |
| 2 | Certain | ChromeProvider context for slot injection | Confirmed from intake #2 — agreed on React Context approach | S:90 R:85 A:85 D:90 |
| 3 | Certain | Icon breadcrumbs: logo › ⬡ name › ❯ window | Confirmed from intake #3 — user chose specific Unicode chars | S:95 R:95 A:90 D:95 |
| 4 | Certain | Line 2 always renders with fixed height (min-h-[36px]) | Confirmed from intake #4 — spec explicit "EVEN WHEN EMPTY" | S:95 R:90 A:95 D:95 |
| 5 | Certain | Kill button always visible (no hover-reveal) | Confirmed from intake #5 — design spec Resolved Decision #8 | S:95 R:95 A:90 D:95 |
| 6 | Certain | max-w-4xl (896px) everywhere | Confirmed from intake #6 — Tailwind native, removes deviation | S:90 R:95 A:95 D:95 |
| 7 | Confident | TopBarChrome as new component (not refactor of TopBar) | Upgraded from intake #7 — spec-level analysis confirms conditional rendering is incompatible | S:70 R:90 A:85 D:80 |
| 8 | Confident | Terminal xterm.js flex-1 works under layout-owned container | Confirmed from intake #8 — FitAddon uses ResizeObserver, needs verification during apply | S:50 R:70 A:80 D:80 |
| 9 | Certain | Logo placeholder "RK" text instead of SVG | Non-goal: real SVG deferred. Text placeholder is trivially replaceable | S:95 R:95 A:95 D:95 |
| 10 | Certain | BottomSlot rendered empty in layout | Skeleton preparation for change 2/3, zero visual impact | S:90 R:95 A:90 D:95 |
| 11 | Confident | useEffect cleanup resets slots on unmount | Standard React pattern for context side effects, prevents stale slot content during navigation | S:65 R:85 A:90 D:85 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).
