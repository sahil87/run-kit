# Intake: Add Light Theme Support

**Change**: 260318-eseg-add-light-theme-support
**Created**: 2026-03-18
**Status**: Draft

## Origin

> Run-kit doesn't support light theme, add light-theme support to run-kit. Switch the right theme based on the system theme preference if there is no user preference. Add a theme switcher - system, light, dark to the user and save the preference in the local storage for the future. Run-kit should be initialized with the the user preferred theme without any flicker.

One-shot request. User explicitly specified the three theme modes (system, light, dark), localStorage persistence, system preference detection, and no-flicker initialization.

## Why

1. **Problem**: run-kit is dark-theme-only. Users working in bright environments or with OS-level light mode get a jarring mismatch between their system and run-kit.
2. **Consequence**: Users with light-mode preferences must accept the visual dissonance. No way to match run-kit's appearance to OS theme.
3. **Approach**: Add a complete theming system with three modes (system, light, dark). The "system" mode follows `prefers-color-scheme` so the app matches the OS automatically. A blocking inline script in `<head>` applies the theme before first paint to eliminate FOUC/flicker.

## What Changes

### CSS Theme System (`app/frontend/src/globals.css`)

Replace the single hard-coded dark color palette with two theme palettes applied via a `data-theme` attribute on `<html>`:

**Dark theme** (existing colors, unchanged):
```css
html[data-theme="dark"] {
  color-scheme: dark;
  --color-bg-primary: #0f1117;
  --color-bg-card: #171b24;
  --color-text-primary: #e8eaf0;
  --color-text-secondary: #7a8394;
  --color-border: #454d66;
  --color-accent: #5b8af0;
  --color-accent-green: #22c55e;
}
```

**Light theme** (new):
```css
html[data-theme="light"] {
  color-scheme: light;
  --color-bg-primary: #f8f9fb;
  --color-bg-card: #ffffff;
  --color-text-primary: #1a1d24;
  --color-text-secondary: #6b7280;
  --color-border: #d1d5db;
  --color-accent: #4a7ae8;
  --color-accent-green: #16a34a;
}
```

The `@theme` block in Tailwind CSS 4 defines the token names. The actual values are set by the `data-theme` selector on `<html>`. Scrollbar styling adapts per theme.

### No-Flicker Initialization (`app/frontend/index.html`)

Add a blocking `<script>` in `<head>` (before any CSS or JS loads) that:

1. Reads `localStorage.getItem("runkit-theme")` — returns `"system"`, `"light"`, `"dark"`, or `null`
2. If `null` (first visit), treats as `"system"`
3. If `"system"`, checks `window.matchMedia("(prefers-color-scheme: dark)").matches`
4. Sets `document.documentElement.dataset.theme` to the resolved `"light"` or `"dark"`

This runs synchronously before first paint, so the correct theme is applied immediately with zero flicker.

### Theme Context (`app/frontend/src/contexts/theme-context.tsx`)

New React context following the existing ChromeContext split pattern:

```typescript
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;  // What the user chose
  resolved: ResolvedTheme;      // What's actually applied
}

interface ThemeActions {
  setTheme: (preference: ThemePreference) => void;
}
```

**Behavior**:
- On mount, reads `localStorage.getItem("runkit-theme")` (default: `"system"`)
- When preference is `"system"`, listens to `matchMedia("(prefers-color-scheme: dark)")` change events to react to OS theme changes in real-time
- On preference change: writes to `localStorage`, updates `document.documentElement.dataset.theme`, updates `color-scheme` CSS property
- Provider wraps the app at the root level (outside ChromeProvider)

### xterm Terminal Theme (`app/frontend/src/components/terminal-client.tsx`)

The xterm terminal has its own theme object (background, foreground, cursor, selection colors). These must update when the app theme changes:

- Define dark and light xterm theme objects
- When the resolved theme changes, call `terminal.options.theme = newTheme` on the existing terminal instance (xterm supports live theme updates without recreation)
- Use the `useTheme()` hook to access the resolved theme

**Dark xterm theme** (existing):
```typescript
{ background: "#0f1117", foreground: "#e8eaf0", cursor: "#e8eaf0", selectionBackground: "#2a3040" }
```

**Light xterm theme** (new):
```typescript
{ background: "#f8f9fb", foreground: "#1a1d24", cursor: "#1a1d24", selectionBackground: "#c7d2fe" }
```

### Theme Switcher in Command Palette

Add theme switching actions to the existing command palette (`app/frontend/src/components/command-palette.tsx`):

- Three actions: "Theme: System", "Theme: Light", "Theme: Dark"
- Current theme indicated (e.g., checkmark or "current" label)
- Selecting an option immediately applies the theme and saves to localStorage
- Searchable via palette's existing filter (typing "theme" or "light" or "dark" finds them)

This follows the constitution's keyboard-first principle — `Cmd+K` → type "theme" → select. No settings page needed.

### localStorage Key

Key: `runkit-theme`
Values: `"system"` | `"light"` | `"dark"`
Default (when absent): treated as `"system"`

Follows the existing naming convention (`runkit-sidebar-width`, `runkit-fixed-width`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Add theme system documentation — visual design section changes from "Dark theme only" to theme-aware, add theme switcher to command palette actions, document CSS custom property switching mechanism
- `run-kit/architecture`: (modify) Add ThemeProvider to Chrome Architecture section, document no-flicker initialization in index.html

## Impact

- **`app/frontend/src/globals.css`** — restructure from single theme to `data-theme` attribute selectors
- **`app/frontend/index.html`** — add blocking theme initialization script
- **`app/frontend/src/contexts/theme-context.tsx`** — new file: ThemeProvider, useTheme, useThemeDispatch
- **`app/frontend/src/app.tsx`** — wrap with ThemeProvider
- **`app/frontend/src/components/terminal-client.tsx`** — dynamic xterm theme
- **`app/frontend/src/components/command-palette.tsx`** — theme switching actions
- **`app/frontend/src/components/dashboard.tsx`** — may need minor adjustments if any inline colors exist
- **Tests** — theme context tests, command palette theme action tests

## Open Questions

None — the user's description is specific enough to proceed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Three theme modes: system, light, dark | User explicitly specified these three options | S:95 R:90 A:95 D:95 |
| 2 | Certain | localStorage key `runkit-theme` for persistence | User specified localStorage; key follows existing `runkit-*` convention | S:90 R:95 A:95 D:95 |
| 3 | Certain | System mode follows `prefers-color-scheme` media query | User specified "system theme preference"; this is the standard Web API | S:90 R:90 A:95 D:95 |
| 4 | Certain | Blocking inline script in `<head>` for no-flicker init | User explicitly required "without any flicker"; this is the standard FOUC prevention pattern | S:85 R:80 A:90 D:90 |
| 5 | Certain | Default to "system" when no localStorage value exists | User said "system theme preference if there is no user preference" | S:90 R:95 A:90 D:95 |
| 6 | Confident | Theme switcher lives in command palette (no dedicated settings page) | Constitution mandates minimal surface area and keyboard-first; Cmd+K is the primary discovery mechanism | S:60 R:90 A:85 D:70 |
| 7 | Confident | Light theme color palette as specified (bg #f8f9fb, card #ffffff, text #1a1d24, etc.) | Standard light theme colors that complement the existing dark palette; easily adjusted via CSS vars | S:50 R:95 A:80 D:75 |
| 8 | Confident | `data-theme` attribute on `<html>` for theme switching mechanism | Standard pattern; works with CSS selectors, Tailwind, and the blocking script; alternatives (class-based) are equivalent | S:70 R:90 A:85 D:80 |
| 9 | Confident | xterm terminal theme updates live via `terminal.options.theme` | xterm.js supports live theme property changes without terminal recreation | S:65 R:85 A:80 D:85 |
| 10 | Certain | New ThemeProvider context following existing ChromeContext split pattern | Codebase convention for UI state contexts is established; theme state is orthogonal to chrome state | S:80 R:90 A:90 D:90 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
