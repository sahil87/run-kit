# run-kit UI Design Philosophy

> Living document. Captures UI principles, layout architecture, and interaction patterns
> for run-kit's web interface. Written during exploratory discussion sessions.

---

## Core Principles

### 1. Terminal-Native Aesthetic

run-kit is a terminal orchestrator. The UI should feel like a **polished terminal**, not a web app that happens to embed terminals. Monospace everywhere, minimal color, dark-only, no rounded corners on primary surfaces, no gradients.

### 2. Keyboard-First (Constitution V)

Every action reachable via keyboard. Mouse is supported but secondary. The command palette (`Cmd+K`) is the primary discovery mechanism. The bottom bar provides modifier keys that browsers can't capture natively.

### 3. Fixed Chrome, Fluid Content

The top bar and bottom bar are **architecturally immovable**. They never shift, resize, or reflow. The terminal fills the space between them. This creates spatial stability — your eyes always know where navigation, status, and modifier keys live.

### 4. Single View, Not Pages

The entire UI is one view: sidebar + terminal. There are no page transitions.

- **One route**: `/:session/:window` (defaults to first session, first window)
- **Sidebar** shows the full session → window tree (replaces Dashboard and Project pages)
- **Main area** is always the terminal
- **Breadcrumbs** in the top bar provide quick session/window switching without the sidebar

**Desktop (≥768px)**: Sidebar always visible (collapsible), terminal fills the rest.

**Mobile (<768px)**: Terminal is full-screen. Navigation via:
1. **Breadcrumbs** — tap session name → dropdown of sessions; tap window name → dropdown of windows
2. **Drawer** — logo icon opens the full session/window tree as an overlay. Pick a target → drawer closes → terminal resumes.

The drawer pattern (not a stack of pages) keeps one mental model across screen sizes. First-time mobile users land on the terminal — the logo icon and breadcrumbs provide discoverability.

No settings pages, no admin panels. Configuration lives on disk.

### 5. Derive, Don't Configure (Constitution VII)

Project identity from tmux session names. State from `tmux list-sessions` + filesystem. No database, no user accounts, no setup wizard. If tmux knows about it, run-kit knows about it.

### 6. Phone-Usable (iOS First)

run-kit must be fully usable on a phone. This is a primary use case, not an afterthought — checking on agent sessions from the couch, sending a quick command from your phone, monitoring progress while away from the desk.

**What this means for every design decision**:

- **Touch targets**: Minimum 44px tap height (Apple HIG). Window cards, bottom bar buttons, breadcrumb links — all must be comfortably tappable.
- **Bottom bar is essential on mobile**: No physical keyboard means the modifier bar is the *only* way to send Ctrl+C, Esc, function keys. On mobile the bottom bar appears on the terminal page and becomes the primary interaction surface alongside the on-screen keyboard.
- **Max-width becomes full-width on mobile**: `max-w-4xl` is the desktop constraint. On screens < 896px, content goes edge-to-edge with minimal padding (`px-3` or `px-4`).
- **Terminal font scales down**: 13px on desktop, smaller on mobile (10-11px) to fit more columns. The terminal should still be readable and horizontally scrollable if needed.
- **Top bar stays compact**: The breadcrumb (`{logo} ❯ run-kit ❯ zsh`) is minimal — it fits on a phone screen. Line 2 actions collapse into the command palette on narrow screens.
- **Cards are already touch-friendly**: Full-width, stacked vertically, clear tap targets. The hover-reveal kill button (✕) needs a mobile alternative — long-press or swipe-to-reveal.
- **No hover states on mobile**: Hover-reveal patterns (kill button, border brightening) need touch equivalents. Either always-visible or gesture-activated.

---

## Layout Architecture

### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ☰  run-kit / zsh          {logo} Run Kit ● ⇔ ⌘K  >_           │  ← top bar (border-b)
├────────────┬─────────────────────────────────────────────────────┤
│ Sessions   │                                                     │
│            │                                                     │
│ ▼ run-kit  │              Terminal (xterm.js)                    │
│  ● main  spec ◷ │                                               │
│  ● fix.. apply▸▸│          $ cursor_                            │
│    scratch       │                                               │
│            │                                                     │
│ ▼ ao-srv   │                                                     │
│   main  ●  │                                                     │
│            ├─────────────────────────────────────────────────────┤
│            │ Esc  Tab  │  ^  ⌥  │  F▴  ← → ↑ ↓                 │  ← bottom bar (border-t)
└────────────┴─────────────────────────────────────────────────────┘
```

Sidebar is drag-resizable (default 220px, min 160px, max 400px, persisted to localStorage). Collapsible via hamburger button or keyboard shortcut. When collapsed, only the terminal + chrome remain.

The bottom bar is scoped to the terminal column — it does not extend under the sidebar. The sidebar fills the full height of the main area.

### Mobile Layout

```
┌──────────────────────────┐
│ ☰  run-kit / zsh     >_  │  ← top bar (compact)
├──────────────────────────┤
│                          │
│   Terminal (xterm.js)    │  ← full screen
│                          │
│   $ cursor_              │
│                          │
├──────────────────────────┤
│ Esc  Tab │ ^  ⌥ │ F▴ ←→↑↓│  ← bottom bar
└──────────────────────────┘
```

Tap hamburger → drawer slides in from left:

```
┌──────────────────────────┐
│ ┌──────────────┐         │
│ │ Sessions     │ (dimmed │
│ │              │ terminal│
│ │ ▼ run-kit    │ behind) │
│ │   main    ●  │         │
│ │   fix..   ●  │         │
│ │   scratch    │         │
│ │              │         │
│ │ ▼ ao-srv     │         │
│ │   main    ●  │         │
│ │              │         │
│ └──────────────┘         │
├──────────────────────────┤
│ Esc  Tab │ ^  ⌥ │ F▴ ←→↑↓│
└──────────────────────────┘
```

Tap a window → drawer closes → terminal connects to that session:window.

### CSS Skeleton

```
h-screen flex flex-col
  ├── top-chrome:  shrink-0  (1 line, fixed height, border-b)
  └── main-area:   flex-1 flex flex-row min-h-0
        ├── sidebar:   w-[var] shrink-0 overflow-y-auto (hidden on mobile, drag-resizable)
        └── terminal-col:  flex-1 min-w-0 flex flex-col
              └── inner:  flex-1 min-h-0 flex flex-col (max-width + centered when fixed-width on)
                    ├── terminal:  flex-1 min-h-0 py-0.5 px-1
                    └── bottom-bar:  shrink-0  (1 line, border-t, px-1.5, py-1.5)
```

On mobile (`<768px`), sidebar is `display: none` by default. Drawer is a fixed overlay triggered by the hamburger button. Bottom bar spans full width on mobile (no sidebar).

### Principle: Chrome Must Be Architecturally Immovable

The top bar is **owned by the root layout**. No component can change the chrome's structure, padding, or height. The bottom bar is owned by the terminal column — it tracks the terminal's width and sits below it, not below the sidebar.

### Top Bar (1 line)

Single line with left-aligned navigation and right-aligned branding + controls.

```
Desktop:
┌──────────────────────────────────────────────────────────────────┐
│ ☰  run-kit / zsh              {logo} Run Kit  ●  ⇔  ⌘K  >_    │
└──────────────────────────────────────────────────────────────────┘

Mobile:
┌──────────────────────────────┐
│ ☰  run-kit / zsh         >_  │
└──────────────────────────────┘
```

**Left section — Navigation**

- `☰` — hamburger icon, toggles sidebar (desktop) or drawer (mobile). Replaces logo as the toggle trigger.
- `run-kit` — **tappable**: session name, opens dropdown of all sessions. Tap a different session → switch. **Max 7 characters** displayed (truncated with ellipsis via `max-w-[7ch]`).
- `/` — separator between session and window (lighter than `❯`, no dropdown trigger role)
- `zsh` — **tappable**: window name, opens dropdown of windows in current session. Tap a different window → switch.

The breadcrumb dropdowns are the **primary quick-navigation** mechanism. They avoid opening the full sidebar/drawer for simple session or window switches. Dropdown triggers are the names themselves (not separator icons).

**Right section — Branding + Controls**

- `{logo}` — RunKit hex logo SVG (decorative, not a button)
- `Run Kit` — product name text, `text-text-secondary`, `text-xs`
- `●` — green/gray connection dot. No text label — the dot color alone signals live (green) or disconnected (gray)
- `⇔` — fixed-width toggle (unchanged)
- `⌘K` — command palette hint (desktop only, `hidden sm:inline-flex`)
- `>_` — compose/terminal button (moved from bottom bar). Opens the compose buffer overlay.

**Mobile right section**: Everything except `>_` is hidden. The compose button is the sole right-side element on mobile. Command palette remains accessible via `⌘K` on external keyboards or from the compose buffer / sidebar actions.

> **Open question**: With `⋯` removed on mobile, the command palette loses its touch trigger. Options: (1) keep `⋯` alongside `>_` on mobile, (2) add a command palette action inside the compose buffer, (3) accept that mobile users use the sidebar + breadcrumb dropdowns for navigation and the compose buffer for input. Leaning toward option 3 — the palette was a catch-all, but sidebar + breadcrumbs + compose covers the key flows.

### Bottom Bar (Modifier Keys)

**Purpose**: Browser terminals can't reliably capture F1-F12, Ctrl+C, Esc, and other modifier combos. The bottom bar provides clickable `<kbd>` buttons that inject these keystrokes into the active terminal.

**Scope**: Always visible. Since the terminal is always the main content area, the bottom bar is always relevant.

**Layout**: Single row of `<kbd>` styled buttons:

```
Esc  Tab  │  Ctrl  Alt  │  F▴  ← → ↑ ↓
```

- Special keys: `Esc`, `Tab` — direct send
- Modifier toggles: `Ctrl`, `Alt` — **sticky** with visual "armed" state (highlight color while active, e.g., `accent` bg or bright border). Click to arm, auto-clears after the next keypress is sent. **`Cmd` removed** — on desktop users hold the real Cmd key; on mobile Cmd combos aren't used in terminal workflows
- Function keys: `F ▴` dropdown — F1–F12, PgUp, PgDn, Home, End (extended keys, rarely needed but grouped together)
- Arrow keys: `← → ↑ ↓` — compact group. Essential on mobile (no physical arrow keys). Command history (`↑`/`↓`), cursor movement (`←`/`→`)
- **Compose button moved to top bar** — the `>_` / `✎` button now lives in the top bar's right section, freeing bottom bar space

**Sizing**: With fewer buttons, each button gets larger touch targets: `min-h-[36px] min-w-[36px]` on desktop, `coarse:min-h-[44px] coarse:min-w-[36px]` on touch devices (up from 32px/28px). Proper Apple HIG 44px height on mobile.

### Compose Buffer

**Problem**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste, and long-form input all work poorly in a canvas. Add network latency (remote server) and character-by-character streaming becomes painful. You need a way to compose locally and send in a burst.

**Solution**: A `>_` compose button in the **top bar** (rightmost item) opens a native `<textarea>` overlay.

```
┌──────────────────────────┐
│ ☰ run-kit / zsh      >_  │  ← compose button in top bar
├──────────────────────────┤
│ terminal output (dimmed) │
│ ...                      │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ Your message here... │ │  ← native <textarea>, supports
│ │                      │ │    dictation, autocorrect, paste,
│ │              [Send]  │ │    multiline
│ └──────────────────────┘ │
├──────────────────────────┤
│ Esc  Tab │ ^  ⌥ │ F▴ ←→↑↓│
├──────────────────────────┤
│ iOS keyboard             │
└──────────────────────────┘
```

**Behavior**:
1. Tap `✎` → textarea slides up from the bottom bar, terminal dims slightly
2. Full native input works: iOS dictation (microphone), autocorrect, paste, multiline
3. Compose at leisure — zero latency, all local
4. `Send` (button or `Cmd+Enter`) → entire text pushed through WebSocket as one burst
5. Textarea dismisses, terminal resumes focus

**Why this matters beyond mobile**: Even on desktop with a remote server, pasting a large code block or heredoc through a laggy WebSocket is painful character-by-character. The compose buffer sends it as a single payload.

**Technical notes**:
- The textarea is a real DOM element — all OS-level input features work (dictation, IME, clipboard)
- Send transmits the text as a single WebSocket message, which the relay writes to the pty in one `write()` call
- On desktop, a keyboard shortcut (e.g., `Cmd+Shift+Enter` or just `i` when terminal has focus) could toggle compose mode

**Mobile behavior — modifier bar sits above the iOS keyboard**:

```
┌──────────────────────────┐
│ ☰ run-kit / zsh      >_  │  ← top chrome (1 line)
├──────────────────────────┤
│ terminal output          │
│ ...                      │
│ $ cursor is here_        │  ← prompt stays visible
├──────────────────────────┤
│ Esc Tab │ ^ ⌥ │ F▴ ←→↑↓  │  ← modifier bar, pinned above keyboard
├──────────────────────────┤
│ iOS on-screen keyboard   │
└──────────────────────────┘
```

The terminal (`flex-1`) naturally shrinks as the keyboard takes space. xterm's `FitAddon` refits to the remaining height. The prompt line — where you're looking 90% of the time — ends up right above the modifier keys, which are right above the typing surface. This is actually *better* than desktop, where the prompt can be far from the modifier bar.

**Technical approach**: Use the `visualViewport` API (`window.visualViewport.resize` event + `visualViewport.height`) to detect the iOS virtual keyboard. Pin the modifier bar to the top of the keyboard by constraining the app's height to `visualViewport.height`. No reliable `keyboard-show` event exists in mobile Safari — `visualViewport` is the standard workaround.

### Chrome State Management

Since there are no pages, the chrome content derives directly from the current `session:window` selection:

- **Breadcrumbs** — derived from current session name + window name (from URL state)
- **Line 2 left** — global + contextual actions ([+ Session], [Rename], [Kill])
- **Line 2 right** — window status (activity, fab progress)
- **Sidebar** — full session/window tree from SSE stream

A `ChromeProvider` context manages:
- Current session + window selection
- Sidebar open/collapsed state
- Drawer open state (mobile)

No slot injection needed — the chrome reads the current selection and renders directly.

---

## Component Mockups

### Sidebar — Session/Window Tree

The sidebar replaces the old Dashboard and Project pages. It shows all sessions with their windows as a collapsible tree.

```
┌─────────────────────┐
│ Sessions            │
│                     │
│ ▼ run-kit        ✕  │
│   ● main     spec ◷ │  ← active window (highlighted)
│   ● fix..  apply ▸▸ │
│     scratch          │
│                     │
│ ▼ ao-server      ✕  │
│     main             │
│                     │
└─────────────────────┘
```

**Session row**: Session name (left, collapsible), + new window (right), ✕ kill (right, always visible).

**Window row**: Single line, three zones:
- Left: Activity dot (● = active, dim/absent = idle) + window name
- Right: Fab stage + progress icon, `text-secondary`, no "fab:" prefix. Omitted for non-fab windows.
- Currently selected window gets `bg-accent/10` highlight + `border-accent` left border + `font-medium`
- Tap → switches terminal to that session:window

**Design constraints**:
- Sidebar width: drag-resizable (default 220px, min 160px, max 400px), persisted to localStorage. ~75% screen width as drawer on mobile.
- Window rows must be ≥44px tall on mobile (touch targets)
- Session groups are collapsible (▼/▶) to manage long lists
- No footer — `[+ Session]` lives in the top bar's line 2

### Fab Status Badge

The `fab: spec ▸▸░░` badge in the mockup represents real data from `fab status progress-line`. Current output format:
- In-progress: `intake ◷` (stage name + spinner)
- Completed: `intake → spec → tasks → apply → review → hydrate` (full chain)

This data is already wired — `lib/fab.ts` calls `statusman.sh progress-line` per worktree and `WindowInfo.fabProgress` carries it to the card.

---

## Conceptual Model: Project vs. Worktree

### Two Levels of Identity

run-kit operates at two conceptual levels:

1. **Project** — a tmux session. Represents a codebase (e.g., `run-kit`, `ao-server`). Identified by session name. Contains multiple windows.
2. **Worktree** — a tmux window within a session. Each window's CWD points to either the main checkout or a git worktree. The worktree is the unit of work — one change per worktree.

### Key Assumption: Shared Worktree Parent

All terminals within a session share the same worktree parent (the main checkout's root). This means we can run `fab change list` (or `fab status`) once from the main worktree root and get the status of **every** change/worktree in the project — no need to shell into each window individually.

This is how fab-kit already works: `fab/changes/` lives in the main checkout and is shared across all worktrees via git. One `fab change list` call returns:
```
260303-07iq-setup-vitest:intake:ready:0.0:false
260303-q8a9-configurable-port-host:hydrate:done:3.5:false
```

Each line: `{change-name}:{stage}:{state}:{confidence}:{indicative}`. We can match change names to worktree paths (worktree names often correspond to change slugs).

---

## Visual Consistency Rules

### Spacing

- **Horizontal padding**: `px-3 sm:px-6` for top bar and sidebar; `px-1.5` (6px) for bottom bar (tighter fit since it shares the terminal's fixed-width container)
- **Terminal padding**: `py-0.5 px-1` — minimal breathing room against border lines
- **No max-width**: The old `max-w-4xl` constraint is gone. The terminal fills all available space right of the sidebar. More columns = better.
- **Sidebar width**: Drag-resizable (default 220px, min 160px, max 400px), persisted to localStorage
- **Line heights**: Top bar lines use `py-2` + `text-sm`. Bottom bar uses `py-1.5` for near-symmetry.

### Typography

- Everything monospace (`--font-mono`)
- `text-sm` (14px) for primary content
- `text-xs` (12px) for secondary/status text
- No font-size variation within the chrome

### Color Discipline

- `text-primary` (#e8eaf0) for actionable/focused text
- `text-secondary` (#7a8394) for labels, hints, disabled state
- `accent-green` for "live" / active indicators only
- `accent` (#5b8af0) for fab status badges only
- `border` (#2a3040) for all borders — no variation
- `bg-card` (#171b24) for elevated surfaces (cards, dialogs)

### Interactive States

- Borders brighten on hover (`border-border` → `border-text-secondary`)
- Focus uses the same border brightening (no colored outlines)
- Destructive actions use `red-400` text + `red-900` bg on hover
- Keyboard focus indicator: highlight ring or background change on the focused card

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Page model | Single view — sidebar + terminal. No page transitions. One route: `/:session/:window`. |
| 2 | Mobile navigation | Drawer pattern (not page stack). Terminal is full-screen, drawer overlays from left. Breadcrumbs for quick switching. |
| 3 | Bottom bar scope | Scoped to terminal column width. Always visible, but sits below the terminal only — does not extend under the sidebar. |
| 4 | F1-F12 layout | Dropdown (`Fn ▾`) to keep the bar compact |
| 5 | Sticky modifier visual | Yes — "armed" state with highlight color while active |
| 6 | Terminal max-width | No max-width on terminal — it fills all space right of sidebar. Top bar spans full width; bottom bar spans terminal width. |
| 7 | Fn dropdown behavior | Closes after each selection — one key per open |
| 8 | Mobile keyboard + modifier bar | Modifier bar pins above iOS keyboard. Terminal shrinks via `flex-1` + `FitAddon`. Prompt stays visible adjacent to modifier keys. Use `visualViewport` API for detection. |
| 9 | Kill button (✕) | Always visible — no hover-reveal. Simpler, works on mobile and desktop equally. |
| 10 | Mobile Line 2 | Actions collapse into command palette via `⋯` button. Status text stays visible. `⋯` replaces `⌘K` as command palette trigger on mobile. |
| 11 | Bottom bar keys | `Esc Tab │ Ctrl Alt │ F▴ ← → ↑ ↓`. Cmd removed (unused in terminal workflows). Compose (`>_`) moved to top bar. Arrow keys essential for mobile. Fn dropdown includes F1-F12 + PgUp/PgDn/Home/End. Larger touch targets (44px) with freed space. |
| 12 | Breadcrumb format | `☰ run-kit / zsh` — hamburger (`☰`) toggles sidebar/drawer. Session name max 7 chars (truncated). `/` separator (no dropdown role). Session and window names are tappable dropdown triggers. Logo moved to right side as branding. |
| 13 | Sidebar width | Drag-resizable (default 220px, min 160px, max 400px), width persisted to localStorage. ~75% viewport as drawer on mobile. |
| 14 | Sidebar ordering | Same as tmux output order (no resorting) |
| 15 | Drawer trigger | Hamburger icon (`☰`) only — no swipe gesture. Hamburger is always the leftmost top bar element. |
| 16 | Testing strategy | MSW-backed tests for UI behavior (drawer, breadcrumbs, sidebar, keyboard, touch targets, viewport). Thin E2E suite (3-5 tests) for API integration round-trips (create/kill session, SSE stream). |
| 17 | Sidebar fab status | Inline on same line as window name, right-aligned. Stage name + icon, `text-secondary`, no "fab:" prefix. Omitted for non-fab windows. |
| 18 | Layout borders | `border-b` on top bar, `border-t` on bottom bar, `border-r` on sidebar. Clear visual separation between chrome regions and content. |
| 19 | Padding consistency | Top bar and sidebar use `px-3 sm:px-6`. Bottom bar uses `px-1.5` (6px) — tighter since it shares the terminal's fixed-width container. Terminal container gets `py-0.5 px-1` for breathing room. Bottom bar `py-1.5` for near-symmetry with top bar's `py-2`. |
| 20 | "+ New Session" location | Moved from sidebar footer to top bar line 2. Always visible (not gated on current window). Sidebar has no footer section. |
| 21 | Bottom bar position | Inside the terminal's fixed-width inner container (not root layout). Shares the same `max-width` + centering as the terminal when fixed-width toggle is on. Width always matches terminal width. Sidebar extends full height of main area. |

| 22 | Cmd modifier removed | Cmd toggle removed from bottom bar. On desktop, users hold the real Cmd key. On mobile, Cmd combos aren't used in terminal workflows. Armed modifier bridging code simplified (Alt prefix only). |
| 23 | Compose button location | Moved from bottom bar to top bar right section (rightmost item). Visible on all viewports including mobile. Frees bottom bar space for larger touch targets. |
| 24 | Top bar branding | RunKit logo + "Run Kit" text on right side of top bar (desktop). Connection indicator reduced to dot-only (no "live"/"disconnected" text). Mobile hides all right-side elements except compose button. |
| 25 | Session name max width | Session name in breadcrumb truncated at 7 characters (`max-w-[7ch]` + text overflow ellipsis). Keeps top bar compact on narrow screens. |

## Open Design Questions

| # | Question | Options | Leaning |
|---|----------|---------|---------|
| 1 | Mobile command palette access | With `⋯` removed on mobile, the command palette loses its touch trigger. (a) Keep `⋯` alongside `>_` on mobile, (b) Add palette action inside compose buffer, (c) Accept sidebar + breadcrumbs + compose covers key flows | Option (c) — palette was a catch-all; dedicated UI covers the important actions |
