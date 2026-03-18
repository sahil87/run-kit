# Spec: Add Light Theme Support

**Change**: 260318-eseg-add-light-theme-support
**Created**: 2026-03-18
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Settings page or preferences panel — theme switching lives in the command palette only
- Per-session or per-window themes — one global theme for the entire app
- Custom user-defined color palettes — only system/light/dark presets

## CSS: Theme System

### Requirement: Dual Theme Palettes via data-theme Attribute

The app SHALL define two complete color palettes in `app/frontend/src/globals.css`, applied via a `data-theme` attribute on the `<html>` element. The `@theme` block SHALL define token names only (for Tailwind CSS 4 registration). Actual color values SHALL be set by `html[data-theme="dark"]` and `html[data-theme="light"]` selectors.

**Dark palette** (existing values, unchanged):
| Token | Value |
|-------|-------|
| `--color-bg-primary` | `#0f1117` |
| `--color-bg-card` | `#171b24` |
| `--color-text-primary` | `#e8eaf0` |
| `--color-text-secondary` | `#7a8394` |
| `--color-border` | `#454d66` |
| `--color-accent` | `#5b8af0` |
| `--color-accent-green` | `#22c55e` |

**Light palette** (new):
| Token | Value |
|-------|-------|
| `--color-bg-primary` | `#f8f9fb` |
| `--color-bg-card` | `#ffffff` |
| `--color-text-primary` | `#1a1d24` |
| `--color-text-secondary` | `#6b7280` |
| `--color-border` | `#d1d5db` |
| `--color-accent` | `#4a7ae8` |
| `--color-accent-green` | `#16a34a` |

The `color-scheme` CSS property SHALL be set to `dark` or `light` respectively within each `data-theme` selector, replacing the current `html { color-scheme: dark }` rule.

Scrollbar styles SHALL adapt per theme: dark theme keeps existing values; light theme uses theme-appropriate track/thumb colors.

#### Scenario: Dark theme applied
- **GIVEN** `<html data-theme="dark">`
- **WHEN** the page renders
- **THEN** all CSS custom properties resolve to the dark palette values
- **AND** `color-scheme` is `dark`

#### Scenario: Light theme applied
- **GIVEN** `<html data-theme="light">`
- **WHEN** the page renders
- **THEN** all CSS custom properties resolve to the light palette values
- **AND** `color-scheme` is `light`

### Requirement: Fixed-Width Background Token

The hard-coded `bg-[#0a0c12]` class in `app/frontend/src/app.tsx` (fixed-width outer background) SHALL be replaced with a theme-aware CSS custom property `--color-bg-inset`. Dark value: `#0a0c12`. Light value: `#e8eaef`. Applied via Tailwind class `bg-bg-inset`.

#### Scenario: Fixed-width mode with light theme
- **GIVEN** fixed-width mode is enabled and theme is light
- **WHEN** the terminal column renders
- **THEN** the outer background uses `--color-bg-inset` (`#e8eaef`), not `#0a0c12`

## Initialization: No-Flicker Theme Application

### Requirement: Blocking Theme Script in index.html

`app/frontend/index.html` SHALL include a synchronous inline `<script>` in `<head>`, before any `<link>` or `<script type="module">` tags, that:

1. Reads `localStorage.getItem("runkit-theme")`
2. If the value is `null`, treats it as `"system"`
3. If `"system"`, resolves to `"dark"` or `"light"` via `window.matchMedia("(prefers-color-scheme: dark)").matches`
4. Sets `document.documentElement.dataset.theme` to the resolved value (`"dark"` or `"light"`)

The `<html>` tag SHALL have `data-theme="dark"` as a static default (SSR/FOUC fallback, consistent with current behavior). The blocking script overwrites this synchronously before first paint.

The existing `class="dark"` on `<html>` SHALL be removed (it has no active consumers after this change).

#### Scenario: First visit — no localStorage value
- **GIVEN** `localStorage.getItem("runkit-theme")` returns `null`
- **AND** the OS is in light mode (`prefers-color-scheme: light`)
- **WHEN** the page loads
- **THEN** the blocking script sets `data-theme="light"` before first paint
- **AND** the page renders in light theme with zero flicker

#### Scenario: Returning visit — stored preference
- **GIVEN** `localStorage.getItem("runkit-theme")` returns `"dark"`
- **AND** the OS is in light mode
- **WHEN** the page loads
- **THEN** the blocking script sets `data-theme="dark"` (user preference overrides system)
- **AND** the page renders in dark theme with zero flicker

#### Scenario: System preference with dark OS
- **GIVEN** `localStorage.getItem("runkit-theme")` returns `"system"`
- **AND** the OS is in dark mode
- **WHEN** the page loads
- **THEN** the blocking script sets `data-theme="dark"`

## State: Theme Context

### Requirement: ThemeProvider React Context

A new `ThemeProvider` component (`app/frontend/src/contexts/theme-context.tsx`) SHALL manage theme state and provide it via React context. It SHALL follow the existing split-context pattern (ChromeContext).

**Types**:
```typescript
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
```

**State**: `{ preference: ThemePreference, resolved: ResolvedTheme }`

**Actions**: `{ setTheme: (preference: ThemePreference) => void }`

**Hooks**: `useTheme()` returns `ThemeState`, `useThemeActions()` returns `ThemeActions`.

#### Scenario: Mount — reads from localStorage
- **GIVEN** `localStorage.getItem("runkit-theme")` returns `"light"`
- **WHEN** `ThemeProvider` mounts
- **THEN** `preference` is `"light"` and `resolved` is `"light"`

#### Scenario: Mount — defaults to system when no stored value
- **GIVEN** `localStorage.getItem("runkit-theme")` returns `null`
- **AND** the OS is in dark mode
- **WHEN** `ThemeProvider` mounts
- **THEN** `preference` is `"system"` and `resolved` is `"dark"`

### Requirement: System Theme Change Listener

When `preference` is `"system"`, the `ThemeProvider` SHALL listen to `matchMedia("(prefers-color-scheme: dark)")` change events and update `resolved` and `document.documentElement.dataset.theme` in real-time.

#### Scenario: OS switches from dark to light while preference is system
- **GIVEN** `preference` is `"system"` and `resolved` is `"dark"`
- **WHEN** the OS switches to light mode
- **THEN** `resolved` updates to `"light"`
- **AND** `document.documentElement.dataset.theme` updates to `"light"`

#### Scenario: OS theme changes while preference is explicit
- **GIVEN** `preference` is `"dark"`
- **WHEN** the OS switches to light mode
- **THEN** `resolved` remains `"dark"` (no change)

### Requirement: Theme Persistence

`setTheme(preference)` SHALL:
1. Write `preference` to `localStorage` key `"runkit-theme"`
2. Resolve the effective theme (`"system"` → check `matchMedia`, others → literal)
3. Set `document.documentElement.dataset.theme` to the resolved value
4. Update context state (`preference` and `resolved`)

#### Scenario: User switches to light theme
- **GIVEN** current preference is `"system"`
- **WHEN** `setTheme("light")` is called
- **THEN** `localStorage.getItem("runkit-theme")` returns `"light"`
- **AND** `document.documentElement.dataset.theme` is `"light"`
- **AND** context `resolved` is `"light"`

### Requirement: Provider Placement

`ThemeProvider` SHALL wrap the app at the outermost level in `app/frontend/src/app.tsx`, outside `ChromeProvider` and `SessionProvider`.

#### Scenario: Component tree order
- **GIVEN** the app component tree
- **WHEN** rendering
- **THEN** the provider order is `ThemeProvider > ChromeProvider > SessionProvider > AppShell`

## Terminal: xterm Theme Integration

### Requirement: Dynamic xterm Theme

The `TerminalClient` component SHALL update the xterm terminal theme when the resolved theme changes.

**Dark xterm theme**: `{ background: "#0f1117", foreground: "#e8eaf0", cursor: "#e8eaf0", selectionBackground: "#2a3040" }`

**Light xterm theme**: `{ background: "#f8f9fb", foreground: "#1a1d24", cursor: "#1a1d24", selectionBackground: "#c7d2fe" }`

The terminal SHALL read the resolved theme from `useTheme()` and set `terminal.options.theme` reactively. The initial theme at construction time SHALL also use the resolved theme (not hardcoded dark).

#### Scenario: Theme changes while terminal is open
- **GIVEN** a terminal is open with dark theme
- **WHEN** the user switches to light theme via command palette
- **THEN** the terminal background changes to `#f8f9fb` and foreground to `#1a1d24`
- **AND** no terminal recreation or reconnection occurs

#### Scenario: Terminal opens in light mode
- **GIVEN** the resolved theme is `"light"`
- **WHEN** a new terminal session is opened
- **THEN** xterm is constructed with the light theme object

## UI: Theme Switcher in Command Palette

### Requirement: Theme Actions in Command Palette

The command palette SHALL include three theme-switching actions:

- `"Theme: System"` — sets preference to `"system"`
- `"Theme: Light"` — sets preference to `"light"`
- `"Theme: Dark"` — sets preference to `"dark"`

The currently active preference SHALL be indicated with a `"(current)"` suffix on the label (e.g., `"Theme: System (current)"`).

These actions SHALL appear after the existing window/session actions in the palette action list. They are searchable via the palette's existing text filter (typing "theme", "light", "dark", or "system" matches them).

#### Scenario: User switches theme via palette
- **GIVEN** the command palette is open
- **WHEN** the user types "theme" and selects "Theme: Light"
- **THEN** the theme immediately switches to light
- **AND** the palette closes
- **AND** `localStorage.getItem("runkit-theme")` returns `"light"`

#### Scenario: Current theme indicated
- **GIVEN** the current preference is `"system"`
- **WHEN** the command palette opens and shows theme actions
- **THEN** `"Theme: System (current)"` is displayed
- **AND** `"Theme: Light"` and `"Theme: Dark"` have no suffix

## Design Decisions

1. **`data-theme` attribute over CSS class**: Using `data-theme="light|dark"` on `<html>` instead of class-based switching. Both are equivalent, but `data-theme` provides cleaner semantics and avoids collision with other class-based features (e.g., the `fullbleed` class).
   - *Rejected*: `.theme-light` / `.theme-dark` classes — functional but less semantic; `dark:` Tailwind prefix — requires Tailwind dark mode configuration and changes all existing utility classes.

2. **ThemeProvider as outermost context**: Theme wraps everything because ChromeProvider and SessionProvider may contain components that need theme-aware rendering.
   - *Rejected*: Merging into ChromeProvider — theme is an orthogonal concern; mixing it complicates the ChromeProvider interface.

3. **Blocking inline script for FOUC prevention**: The script runs synchronously before CSS/JS loads, reading localStorage and setting `data-theme`. This is a well-established pattern (Next.js, Tailwind docs, etc.) and the only reliable way to prevent flicker.
   - *Rejected*: React-only initialization (useEffect in ThemeProvider) — causes a flash of the default theme before React hydrates.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Three theme modes: system, light, dark | User explicitly specified; confirmed from intake #1 | S:95 R:90 A:95 D:95 |
| 2 | Certain | localStorage key `runkit-theme` | Confirmed from intake #2; follows existing `runkit-*` convention | S:90 R:95 A:95 D:95 |
| 3 | Certain | System mode follows `prefers-color-scheme` | Confirmed from intake #3; standard Web API | S:90 R:90 A:95 D:95 |
| 4 | Certain | Blocking inline script for no-flicker | Confirmed from intake #4; user required "without any flicker" | S:85 R:80 A:90 D:90 |
| 5 | Certain | Default to "system" when no localStorage | Confirmed from intake #5; user said "system preference if no user preference" | S:90 R:95 A:90 D:95 |
| 6 | Certain | Theme switcher in command palette only | Confirmed from intake #6; constitution mandates keyboard-first + minimal surface area; Cmd+K is primary discovery | S:75 R:90 A:90 D:80 |
| 7 | Confident | Light palette: bg #f8f9fb, card #ffffff, text #1a1d24, border #d1d5db, accent #4a7ae8, green #16a34a | Standard light colors complementing the dark palette; easily adjusted via CSS vars | S:50 R:95 A:80 D:75 |
| 8 | Certain | `data-theme` attribute on `<html>` | Confirmed from intake #8; cleaner semantics vs class-based, no collision with `fullbleed` class | S:70 R:90 A:85 D:80 |
| 9 | Confident | xterm theme updates live via `terminal.options.theme` | xterm.js supports live theme changes; verified from API docs | S:65 R:85 A:80 D:85 |
| 10 | Certain | ThemeProvider as outermost context | Confirmed from intake #10; orthogonal to chrome state, follows existing split pattern | S:80 R:90 A:90 D:90 |
| 11 | Certain | Remove `class="dark"` from `<html>` in index.html | No active consumers; `data-theme` replaces it | S:80 R:95 A:90 D:95 |
| 12 | Confident | Fixed-width bg token `--color-bg-inset` | Replaces hard-coded `#0a0c12`; dark: `#0a0c12`, light: `#e8eaef` | S:70 R:95 A:85 D:80 |
| 13 | Confident | Current theme indicated with "(current)" suffix | Simple, no extra UI complexity; consistent with palette's text-only style | S:55 R:95 A:80 D:75 |
| 14 | Certain | `color-scheme` CSS property set per data-theme selector | Required for native browser controls (scrollbars, form inputs) to match the theme | S:80 R:90 A:90 D:90 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
