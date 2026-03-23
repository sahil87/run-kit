# Spec: Theme Selector with Live Preview

**Change**: 260323-3tfo-theme-selector-preview
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Custom user-defined themes (only built-in themes)
- Theming the xterm.js terminal canvas (terminal has its own color scheme from tmux/shell)
- Per-session or per-window theming — theme is global

## Theme Data: Theme Model

### Requirement: Theme Type Definition

The system SHALL define a `Theme` interface in `app/frontend/src/themes.ts`:

```typescript
interface Theme {
  id: string;
  name: string;
  category: "dark" | "light";
  colors: {
    bgPrimary: string;
    bgCard: string;
    bgInset: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accent: string;
    accentGreen: string;
  };
  themeColor: string;
}
```

The `colors` keys MUST map 1:1 to the existing CSS custom properties (`--color-bg-primary`, `--color-bg-card`, `--color-bg-inset`, `--color-text-primary`, `--color-text-secondary`, `--color-border`, `--color-accent`, `--color-accent-green`).

#### Scenario: Theme type is correctly structured
- **GIVEN** a theme object from the built-in themes array
- **WHEN** the theme is accessed
- **THEN** it SHALL have all 8 color properties, a `category` of `"dark"` or `"light"`, and a `themeColor` string

### Requirement: Built-in Theme Collection

The system SHALL export a `THEMES` array containing 20 themes: 14 dark themes and 6 light themes. The collection MUST include:

**Dark themes** (14): Default Dark, Dracula, One Dark, Nord, Gruvbox Dark, Solarized Dark, Tokyo Night, Catppuccin Mocha, Monokai, Material Dark, Ayu Dark, Everforest Dark, Rosé Pine, Kanagawa

**Light themes** (6): Default Light, Solarized Light, Gruvbox Light, Catppuccin Latte, GitHub Light, Rosé Pine Dawn

"Default Dark" SHALL use the exact colors from the current `html[data-theme="dark"]` CSS block. "Default Light" SHALL use the exact colors from the current `html[data-theme="light"]` CSS block. All other themes SHALL have colors adapted from their canonical terminal/editor theme definitions, mapped to the 8-property system.

The system SHALL also export lookup helpers:
- `getThemeById(id: string): Theme | undefined`
- `DEFAULT_DARK_THEME: Theme` (the "Default Dark" theme object)
- `DEFAULT_LIGHT_THEME: Theme` (the "Default Light" theme object)

#### Scenario: Default themes preserve current colors
- **GIVEN** the built-in theme collection
- **WHEN** "default-dark" is looked up
- **THEN** its colors SHALL exactly match the current `globals.css` dark theme values (`bgPrimary: "#0f1117"`, `bgCard: "#171b24"`, etc.)

#### Scenario: All themes have valid colors
- **GIVEN** the `THEMES` array
- **WHEN** iterating over all themes
- **THEN** every theme SHALL have 8 non-empty hex color strings and a valid `themeColor`

## Theme Context: State Management

### Requirement: Expanded ThemeProvider

The `ThemeProvider` in `app/frontend/src/contexts/theme-context.tsx` SHALL be refactored to support multi-theme selection:

- `ThemePreference` type changes to `string` — either `"system"` or a theme ID (e.g., `"dracula"`, `"default-dark"`)
- `useTheme()` SHALL return `{ preference: string; resolved: ResolvedTheme; theme: Theme }` where `theme` is the active `Theme` object
- `useThemeActions()` SHALL return `{ setTheme: (preference: string) => void; previewTheme: (theme: Theme) => void; cancelPreview: () => void }`

The `previewTheme` function SHALL apply a theme's colors to the DOM without persisting to localStorage. The `cancelPreview` function SHALL revert to the last persisted theme.

#### Scenario: Setting a named theme
- **GIVEN** the ThemeProvider is mounted
- **WHEN** `setTheme("dracula")` is called
- **THEN** the Dracula theme colors SHALL be applied to `document.documentElement.style`
- **AND** `data-theme` SHALL be set to `"dark"` (Dracula's category)
- **AND** `"dracula"` SHALL be persisted to localStorage key `"runkit-theme"`
- **AND** `<meta name="theme-color">` SHALL be updated to Dracula's `themeColor` value

#### Scenario: System preference with multi-theme
- **GIVEN** the stored preference is `"system"`
- **WHEN** the OS preference is dark
- **THEN** the "Default Dark" theme SHALL be applied
- **AND** `useTheme().theme` SHALL return the Default Dark theme object

#### Scenario: Unrecognized localStorage value
- **GIVEN** localStorage contains an old/invalid value (e.g., `"dark"`, `"light"`, or garbage)
- **WHEN** the ThemeProvider initializes
- **THEN** it SHALL fall back to `"system"` preference (no migration)

#### Scenario: Preview without persisting
- **GIVEN** the active theme is "default-dark"
- **WHEN** `previewTheme(draculaTheme)` is called
- **THEN** Dracula colors SHALL be applied to the DOM immediately
- **AND** localStorage SHALL NOT be updated
- **AND** `useTheme().theme` SHALL return the Dracula theme object

#### Scenario: Cancel preview reverts
- **GIVEN** a preview is active (Dracula previewed over Default Dark)
- **WHEN** `cancelPreview()` is called
- **THEN** Default Dark colors SHALL be restored on the DOM
- **AND** `useTheme().theme` SHALL return the Default Dark theme object

### Requirement: Theme Application via Inline Styles

Themes SHALL be applied by setting CSS custom properties directly on `document.documentElement.style`. This overrides the `globals.css` fallback values.

The application function SHALL:
1. Set each of the 8 `--color-*` properties on `document.documentElement.style`
2. Set `document.documentElement.dataset.theme` to the theme's `category` (`"dark"` or `"light"`)
3. Set `color-scheme` CSS property to the theme's `category`
4. Update `<meta name="theme-color">` to the theme's `themeColor` value

#### Scenario: Inline styles override globals.css
- **GIVEN** `globals.css` defines `--color-bg-primary: #0f1117` for `[data-theme="dark"]`
- **WHEN** the Nord theme is applied (with `bgPrimary: "#2e3440"`)
- **THEN** `document.documentElement.style.getPropertyValue("--color-bg-primary")` SHALL return `"#2e3440"`
- **AND** all Tailwind utilities referencing `bg-bg-primary` SHALL render with the Nord color

## Theme Selector: UI Component

### Requirement: Theme Selector Modal

The system SHALL provide a `ThemeSelector` component in `app/frontend/src/components/theme-selector.tsx`. It SHALL render as a modal overlay, structurally similar to the existing `CommandPalette` component.

Layout:
- Fixed overlay (`fixed inset-0 z-50`)
- Backdrop (`bg-black/50`)
- Modal dialog (`max-w-lg`, positioned at ~20vh from top)
- Search input at top (placeholder: `"Search themes..."`)
- Scrollable list below, grouped by category with `"Dark"` and `"Light"` section headers
- Each theme row shows the theme name; the active theme has a checkmark or highlight

The modal MUST be opened via a custom DOM event `"theme-selector:open"` (dispatched by ThemeToggle or command palette). It MUST close on Escape, outside click, or theme confirmation.

#### Scenario: Opening theme selector via Ctrl+Click
- **GIVEN** the top bar is visible with the ThemeToggle button
- **WHEN** the user Ctrl+clicks (or Cmd+clicks on macOS) the ThemeToggle
- **THEN** the theme selector modal SHALL open
- **AND** the search input SHALL be focused
- **AND** the current active theme SHALL be highlighted in the list

#### Scenario: Opening via command palette
- **GIVEN** the command palette is open
- **WHEN** the user selects "Theme: Select Theme"
- **THEN** the command palette SHALL close
- **AND** the theme selector modal SHALL open

#### Scenario: Normal click still cycles
- **GIVEN** the top bar is visible with the ThemeToggle button
- **WHEN** the user clicks the ThemeToggle without holding Ctrl/Cmd
- **THEN** the theme SHALL cycle system → light → dark as before
- **AND** the theme selector SHALL NOT open

### Requirement: Live Preview on Navigation

When the user navigates the theme list (via arrow keys or mouse hover), the hovered/selected theme SHALL be previewed immediately via `previewTheme()`.

#### Scenario: Arrow key preview
- **GIVEN** the theme selector is open with "Default Dark" active
- **WHEN** the user presses ArrowDown to highlight "Dracula"
- **THEN** the entire UI SHALL immediately reflect Dracula's colors
- **AND** the theme selector modal itself SHALL also reflect the new colors

#### Scenario: Mouse hover preview
- **GIVEN** the theme selector is open
- **WHEN** the user hovers over "Nord" in the list
- **THEN** the UI SHALL immediately preview Nord's colors

#### Scenario: Confirm selection
- **GIVEN** "Dracula" is highlighted/previewed in the theme selector
- **WHEN** the user presses Enter or clicks on "Dracula"
- **THEN** Dracula SHALL be persisted as the active theme
- **AND** the theme selector SHALL close
- **AND** the UI SHALL remain in Dracula colors

#### Scenario: Cancel reverts to original
- **GIVEN** "Dracula" is being previewed but "Default Dark" was the original theme
- **WHEN** the user presses Escape or clicks outside the modal
- **THEN** the UI SHALL revert to Default Dark colors
- **AND** the theme selector SHALL close

### Requirement: Search Filtering

The search input SHALL filter themes by name (case-insensitive substring match). Category headers SHALL be hidden when all themes in that category are filtered out.

#### Scenario: Filtering themes
- **GIVEN** the theme selector is open with search input focused
- **WHEN** the user types "gru"
- **THEN** the list SHALL show only "Gruvbox Dark" and "Gruvbox Light"
- **AND** both "Dark" and "Light" category headers SHALL be visible

#### Scenario: No results
- **GIVEN** the theme selector is open
- **WHEN** the user types "xyz"
- **THEN** the list SHALL show "No matching themes"

### Requirement: Keyboard Navigation

The theme selector SHALL support full keyboard navigation:
- **ArrowDown/ArrowUp**: Move selection through themes (skipping category headers)
- **Enter**: Confirm selection
- **Escape**: Cancel and revert
- Selection SHALL wrap from last to first and vice versa

#### Scenario: Keyboard navigation wraps
- **GIVEN** the last theme in the list is highlighted
- **WHEN** the user presses ArrowDown
- **THEN** the first theme in the list SHALL be highlighted

## Theme Toggle: Ctrl+Click Behavior

### Requirement: Dual-Action ThemeToggle

The `ThemeToggle` component in `top-bar.tsx` SHALL distinguish between normal clicks and Ctrl/Cmd+clicks:

- **Normal click** (no modifier): Cycle through system → default-light → default-dark
- **Ctrl+Click** (or **Cmd+Click** on macOS): Dispatch `"theme-selector:open"` event

The modifier check SHALL use `e.ctrlKey || e.metaKey`.

#### Scenario: Ctrl+Click opens selector
- **GIVEN** the ThemeToggle button is visible
- **WHEN** the user clicks while holding Ctrl (or Cmd on Mac)
- **THEN** a `"theme-selector:open"` CustomEvent SHALL be dispatched on `document`
- **AND** the theme SHALL NOT cycle

#### Scenario: Normal click cycles theme
- **GIVEN** the current preference is `"system"`
- **WHEN** the user clicks ThemeToggle without modifiers
- **THEN** the preference SHALL change to `"default-light"`

## Command Palette: Theme Action

### Requirement: Theme Selector Action

The command palette actions in `app.tsx` SHALL include a "Theme: Select Theme" action that dispatches the `"theme-selector:open"` CustomEvent.

The existing three individual theme actions ("Theme: System", "Theme: Light", "Theme: Dark") SHALL be retained alongside the new selector action.

#### Scenario: Select Theme action
- **GIVEN** the command palette is open
- **WHEN** the user selects "Theme: Select Theme"
- **THEN** the command palette SHALL close
- **AND** the theme selector modal SHALL open

## Deprecated Requirements

### Requirement: Three-Way ThemePreference Type

**Reason**: `ThemePreference` expands from `"system" | "light" | "dark"` to `string` (theme IDs). The old `"light"` and `"dark"` literal values are no longer valid preferences — they are replaced by `"default-light"` and `"default-dark"` theme IDs.

**Migration**: Unrecognized values (including old `"light"` and `"dark"`) fall back to `"system"` on read.

## Design Decisions

1. **Inline CSS custom properties over CSS class switching**: Theme colors are set via `document.documentElement.style.setProperty()` rather than generating per-theme CSS classes or switching `data-theme` attribute values.
   - *Why*: With 20 themes, generating 20 CSS rule blocks in globals.css is impractical. Inline styles override the CSS cascade cleanly, require no build-time generation, and the existing 8-property system means only 8 `setProperty` calls per theme switch.
   - *Rejected*: CSS-in-JS (adds runtime dependency), CSS Modules per theme (build complexity), data-attribute switching (20 attribute blocks in globals.css).

2. **Custom DOM event for theme selector opening**: Using `document.dispatchEvent(new CustomEvent("theme-selector:open"))` rather than React state lifting or context.
   - *Why*: Matches the existing pattern used by the command palette (`palette:open`). Decouples the trigger (ThemeToggle, command palette) from the listener (ThemeSelector component). No prop drilling needed.
   - *Rejected*: Shared state/context (adds coupling), callback props (requires wiring through component tree).

3. **Category headers in theme list**: Themes grouped under "Dark" and "Light" headers rather than a flat list.
   - *Why*: With 20 themes, visual grouping helps users quickly scan for dark vs light options. Headers are non-interactive (skipped by keyboard nav).
   - *Rejected*: Flat list (harder to scan), tabs for dark/light (adds complexity, breaks linear keyboard nav).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Theme colors map to existing 8 CSS custom properties | Confirmed from intake #1 — all UI components consume these via Tailwind utilities | S:90 R:95 A:95 D:95 |
| 2 | Certain | Theme selector opens via Ctrl+Click and command palette | Confirmed from intake #2 — user's explicit request | S:95 R:90 A:90 D:95 |
| 3 | Certain | VSCode-style preview: navigate applies theme, Escape reverts | Confirmed from intake #3 — user's explicit request | S:95 R:90 A:90 D:95 |
| 4 | Certain | Theme data stored in localStorage | Confirmed from intake #4 — constitution prohibits database | S:85 R:95 A:95 D:95 |
| 5 | Certain | Theme selector is a modal overlay | Confirmed from intake #5 — user confirmed | S:95 R:85 A:85 D:75 |
| 6 | Certain | 20 themes total (14 dark + 6 light) | Confirmed from intake #6 — user confirmed. Added Kanagawa to reach 14 dark | S:95 R:90 A:70 D:70 |
| 7 | Certain | Normal click cycles system/light/dark | Confirmed from intake #7 — user confirmed | S:95 R:85 A:80 D:75 |
| 8 | Certain | Themes applied via inline CSS custom properties | Confirmed from intake #8 — user confirmed | S:95 R:80 A:85 D:75 |
| 9 | Certain | "system" preference selects Default Dark/Light | Confirmed from intake #9 — user confirmed | S:95 R:85 A:85 D:80 |
| 10 | Certain | Theme selector has search/filter | Confirmed from intake #10 — user confirmed | S:95 R:90 A:80 D:80 |
| 11 | Certain | Colors adapted from canonical terminal themes | Confirmed from intake #11 — user chose option (a) | S:95 R:85 A:60 D:55 |
| 12 | Certain | No localStorage migration — reset to "system" | Confirmed from intake #12 — user chose option (b) | S:95 R:80 A:70 D:55 |
| 13 | Certain | Use CustomEvent pattern for opening theme selector | Codebase already uses this pattern for command palette (`palette:open`) | S:85 R:90 A:95 D:90 |
| 14 | Certain | Retain existing theme cycle actions in command palette | Preserves quick-switch for users who know what they want; no reason to remove | S:80 R:95 A:85 D:85 |
| 15 | Certain | ThemeSelector component is structurally similar to CommandPalette | Consistent UI patterns; same overlay/backdrop/keyboard-nav approach | S:85 R:90 A:90 D:90 |
| 16 | Certain | Theme cycle uses default-light/default-dark (not last-used per category) | Simplest implementation; avoids needing to track "last dark theme" and "last light theme" separately | S:75 R:90 A:85 D:80 |

16 assumptions (16 certain, 0 confident, 0 tentative, 0 unresolved).
