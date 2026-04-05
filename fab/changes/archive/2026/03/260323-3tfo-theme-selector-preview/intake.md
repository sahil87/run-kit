# Intake: Theme Selector with Live Preview

**Change**: 260323-3tfo-theme-selector-preview
**Created**: 2026-03-23
**Status**: Draft

## Origin

> Create a theme selector that comes up when you ctrl + click on the Dark/Light theme selector icon on the top bar OR by selecting theme selector in the Command Palette. Put 15-20 most popular themes (terminal based themes) in it. The user must be able to preview the theme when that theme is selected from a list (something like VSCode theme selection behaviour)

One-shot request. The user wants a multi-theme system replacing the current 3-way toggle (system/light/dark) with a rich palette of terminal-inspired themes, accessible via Ctrl+Click on the existing theme toggle or through the command palette.

## Why

1. **Problem**: The current theme system only offers system/light/dark — three options that all look functionally the same aside from brightness. Users who spend extended time in the terminal UI want personalization and visual variety, especially familiar terminal themes they already know and love.

2. **Consequence without fix**: The UI feels generic and uncustomizable. Users accustomed to Dracula, Solarized, Gruvbox, Nord, etc. in their terminals and editors have no way to carry that preference into run-kit.

3. **Why this approach**: A VSCode-style theme picker (list with live preview on selection) is an established UX pattern that lets users quickly browse themes without committing. Ctrl+Click on the existing toggle provides a power-user shortcut, while the command palette entry makes it discoverable.

## What Changes

### Theme Data Model

Introduce a `Theme` type representing a named color palette:

```typescript
interface Theme {
  id: string;            // e.g. "dracula", "solarized-dark"
  name: string;          // Display name: "Dracula", "Solarized Dark"
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
  themeColor: string;    // <meta name="theme-color"> value
}
```

The color keys map 1:1 to the existing CSS custom properties in `globals.css` (`--color-bg-primary`, `--color-bg-card`, etc.).

### Built-in Themes (15–20)

Include popular terminal themes. Example set (exact colors to be defined in implementation):

**Dark themes**: Dracula, One Dark, Nord, Gruvbox Dark, Solarized Dark, Tokyo Night, Catppuccin Mocha, Monokai, Material Dark, Ayu Dark, Everforest Dark, Rosé Pine

**Light themes**: Solarized Light, Gruvbox Light, Catppuccin Latte, GitHub Light, Ayu Light, Rosé Pine Dawn

Plus the two existing themes renamed: "Default Dark" (current dark), "Default Light" (current light).

### Theme Selector UI

A modal/dropdown list that appears via:
1. **Ctrl+Click** (or **Cmd+Click** on macOS) on the existing ThemeToggle button in the top bar
2. **Command palette** → "Theme: Select Theme" action

**Behavior** (VSCode-style):
- Shows a scrollable list of all themes, grouped by dark/light category
- Current active theme is highlighted/checked
- **Arrow key navigation** moves selection up/down
- **Hovering or navigating to a theme applies it immediately as a preview** — CSS custom properties are updated in real-time so the entire UI reflects the theme
- **Pressing Enter or clicking** confirms the selection and persists it to localStorage
- **Pressing Escape or clicking outside** reverts to the previously active theme (cancels preview)
- Search/filter input at the top to narrow the list by name

### Theme Application Mechanism

Currently, themes are applied by setting `document.documentElement.dataset.theme` to `"dark"` or `"light"`, and `globals.css` has two hardcoded blocks of CSS custom properties.

New approach:
- Theme application sets CSS custom properties directly on `document.documentElement.style` (inline styles), which override the `globals.css` defaults
- The `data-theme` attribute continues to be set to the theme's `category` ("dark" or "light") for any CSS that branches on it
- The `<meta name="theme-color">` is updated to the theme's `themeColor` value
- `ThemeProvider` context expands to expose the active `Theme` object, not just `"light" | "dark"`

### Storage

- localStorage key `"runkit-theme"` stores the theme ID (e.g., `"dracula"`, `"default-dark"`, `"system"`)
- The "system" preference is preserved: a special value `"system"` means auto-select based on OS preference — picks the "Default Dark" or "Default Light" theme accordingly
- No migration: on first load with the new code, any unrecognized old value is treated as `"system"` (clean reset)

### ThemeToggle Button Behavior Change

- **Normal click**: Cycles through system → light → dark (same as now, using default light/dark themes, or the last-used light/dark theme)
- **Ctrl+Click / Cmd+Click**: Opens the theme selector

### Command Palette Integration

Add a "Theme: Select Theme" action to the command palette that opens the theme selector modal.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document theme selector UI, Ctrl+Click interaction, theme data model

## Impact

- **`app/frontend/src/contexts/theme-context.tsx`** — Major refactor: expand from 3-way toggle to multi-theme system with preview support
- **`app/frontend/src/globals.css`** — Default theme CSS custom properties remain as fallback; themes override via inline styles
- **`app/frontend/src/components/top-bar.tsx`** — ThemeToggle gains Ctrl+Click handler
- **`app/frontend/src/app.tsx`** — Command palette gains "Theme: Select Theme" action
- **New file**: Theme selector component (e.g., `app/frontend/src/components/theme-selector.tsx`)
- **New file**: Theme definitions (e.g., `app/frontend/src/themes.ts`)

## Open Questions

(None — SRAD analysis below covers all decision points)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Theme colors map to existing 8 CSS custom properties | The current system uses exactly these 8 properties; all UI components already consume them via Tailwind utilities | S:90 R:95 A:95 D:95 |
| 2 | Certain | Theme selector opens via Ctrl+Click on ThemeToggle and command palette | Explicitly stated in the user's request | S:95 R:90 A:90 D:95 |
| 3 | Certain | VSCode-style preview: hover/navigate applies theme, Escape reverts | Explicitly stated in the user's request ("VSCode theme selection behaviour") | S:95 R:90 A:90 D:95 |
| 4 | Certain | Theme data stored in localStorage | Existing pattern uses localStorage; constitution prohibits database; no reason to change | S:85 R:95 A:95 D:95 |
| 5 | Certain | Theme selector is a modal overlay (similar to command palette), not a sidebar or full page | Clarified — user confirmed | S:95 R:85 A:85 D:75 |
| 6 | Certain | Include ~18 themes (12 dark + 6 light) plus 2 defaults = 20 total | Clarified — user confirmed | S:95 R:90 A:70 D:70 |
| 7 | Certain | Normal click on ThemeToggle continues to cycle system/light/dark | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 8 | Certain | Themes are applied via inline CSS custom properties on document.documentElement | Clarified — user confirmed | S:95 R:80 A:85 D:75 |
| 9 | Certain | "system" preference selects Default Dark/Light based on OS preference | Clarified — user confirmed | S:95 R:85 A:85 D:80 |
| 10 | Certain | Theme selector has a search/filter input | Clarified — user confirmed | S:95 R:90 A:80 D:80 |
| 11 | Certain | Theme colors adapted from canonical terminal theme sources to run-kit's 8-property system | Clarified — user chose option (a): adapt from canonical sources | S:95 R:85 A:60 D:55 |
<!-- clarified: Theme color sourcing — adapt from canonical terminal theme definitions (iTerm2/Alacritty/etc.), mapping to run-kit's 8 CSS properties -->
| 12 | Certain | Reset to "system" on first load — no localStorage migration | Clarified — user changed to option (b): reset to system instead of migrating old values | S:95 R:80 A:70 D:55 |
<!-- clarified: No localStorage migration — old values are ignored, theme resets to "system" on upgrade -->

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-03-23 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 5 | Confirmed | — |
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 9 | Confirmed | — |
| 10 | Confirmed | — |

### Session 2026-03-23 (suggest)

| # | Action | Detail |
|---|--------|--------|
| 11 | Confirmed | User chose option (a): adapt from canonical terminal theme sources |
| 12 | Changed | "Reset to system on first load — no migration" (user chose option b) |
