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
2. **Drawer** — hamburger icon opens the full session/window tree as an overlay. Pick a target → drawer closes → terminal resumes.

The drawer pattern (not a stack of pages) keeps one mental model across screen sizes. First-time mobile users land on the terminal — the hamburger icon and breadcrumbs provide discoverability.

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
│ ☰  {logo} ❯ run-kit ❯ zsh                   ● live  ⌘K          │  ← top bar (border-b)
│ [+ Session] [Rename] [Kill]                          ● active   │  ← line 2
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
│            │ Esc Tab │ ^ ⌥ ⌘ │ Fn▾  ← → ↑ ↓  >_               │  ← bottom bar (border-t)
└────────────┴─────────────────────────────────────────────────────┘
```

Sidebar is drag-resizable (default 220px, min 160px, max 400px, persisted to localStorage). Collapsible via `☰` or keyboard shortcut. When collapsed, only the terminal + chrome remain.

The bottom bar is scoped to the terminal column — it does not extend under the sidebar. The sidebar fills the full height of the main area.

### Mobile Layout

```
┌──────────────────────────┐
│ ☰ ❯ run-kit ❯ zsh    [⋯]│  ← top bar (compact)
├──────────────────────────┤
│                          │
│   Terminal (xterm.js)    │  ← full screen
│                          │
│   $ cursor_              │
│                          │
├──────────────────────────┤
│ Ctrl Alt Fn▾ Esc Tab  ✎ │  ← bottom bar
└──────────────────────────┘
```

Tap `☰` → drawer slides in from left:

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
│ Ctrl Alt Fn▾ Esc Tab  ✎ │
└──────────────────────────┘
```

Tap a window → drawer closes → terminal connects to that session:window.

### CSS Skeleton

```
h-screen flex flex-col
  ├── top-chrome:  shrink-0  (2 lines, fixed height, border-b)
  └── main-area:   flex-1 flex flex-row min-h-0
        ├── sidebar:   w-[var] shrink-0 overflow-y-auto (hidden on mobile, drag-resizable)
        └── terminal-col:  flex-1 min-w-0 flex flex-col
              ├── terminal:  flex-1 min-h-0 py-0.5 px-1
              └── bottom-bar:  shrink-0  (1 line, border-t, py-1.5)
```

On mobile (`<768px`), sidebar is `display: none` by default. Drawer is a fixed overlay triggered by `☰`. Bottom bar spans full width on mobile (no sidebar).

### Principle: Chrome Must Be Architecturally Immovable

The top bar is **owned by the root layout**. No component can change the chrome's structure, padding, or height. The bottom bar is owned by the terminal column — it tracks the terminal's width and sits below it, not below the sidebar.

### Top Bar (2 lines)

**Line 1 — Breadcrumbs + Global Status**

```
☰  {logo} ❯ run-kit ❯ zsh                         ● live  ⌘K
```

- `☰` — hamburger, toggles sidebar (desktop) / opens drawer (mobile)
- `{logo}` — the RunKit hex logo
- `❯` — unified separator/dropdown trigger icon (replaces both `›` separators and `⬡` icon)
- `run-kit` — **tappable**: opens dropdown of all sessions. Tap a different session → switch.
- `zsh` — **tappable**: opens dropdown of windows in current session. Tap a different window → switch.
- Right: Connection dot + "live"/"disconnected", `⌘K` kbd hint (desktop) / `⋯` (mobile)

The breadcrumb dropdowns are the **primary quick-navigation** mechanism. They avoid opening the full sidebar/drawer for simple session or window switches.

**Line 2 — Actions + Contextual Status**
- Left: Action buttons ([+ Session], [Rename], [Kill]). `[+ Session]` is always visible (global action, not gated on current window).
- Right: Status text (● active, fab: intake ◷, window count)
- **MUST render even when empty** — fixed height placeholder, never collapses

**Line 2 — Mobile collapse** (screens < 640px):

Actions collapse into the command palette via `⋯`. Status stays visible.

```
Desktop:
┌─────────────────────────────────────────────────┐
│ [Kill Window] [+ New Window]     ● active  ⌘K  │
└─────────────────────────────────────────────────┘

Mobile:
┌─────────────────────────────────────────────────┐
│ ● active  fab: intake ◷                    [⋯] │
└─────────────────────────────────────────────────┘
```

Tapping `⋯` opens the command palette:
- New Session, New Window, Kill Window, Kill Session, Send Keys, Search...

### Bottom Bar (Modifier Keys)

**Purpose**: Browser terminals can't reliably capture F1-F12, Ctrl+C, Esc, and other modifier combos. The bottom bar provides clickable `<kbd>` buttons that inject these keystrokes into the active terminal.

**Scope**: Always visible. Since the terminal is always the main content area, the bottom bar is always relevant.

**Layout**: Single row of `<kbd>` styled buttons:

```
Esc  Tab  │  Ctrl  Alt  Cmd  │  Fn▾  ← → ↑ ↓  ✎
```

- Modifier toggles: `Ctrl`, `Alt`, `Cmd` — **sticky** with visual "armed" state (highlight color while active, e.g., `accent` bg or bright border). Click to arm, auto-clears after the next keypress is sent.
- Arrow keys: `← → ↑ ↓` — compact group. Essential on mobile (no physical arrow keys). Command history (`↑`/`↓`), cursor movement (`←`/`→`).
- Function keys: `Fn ▾` dropdown — F1–F12, PgUp, PgDn, Home, End (extended keys, rarely needed but grouped together)
- Special: `Esc`, `Tab`
- Compose: `✎` — opens local compose buffer (see below)

### Compose Buffer

**Problem**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste, and long-form input all work poorly in a canvas. Add network latency (remote server) and character-by-character streaming becomes painful. You need a way to compose locally and send in a burst.

**Solution**: A `✎ Compose` button on the bottom bar opens a native `<textarea>` overlay.

```
┌──────────────────────────┐
│ top chrome               │
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
│ Ctrl  Alt  ✎  Fn▾  Esc  │
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
│ top chrome (2 lines)     │
├──────────────────────────┤
│ terminal output          │
│ ...                      │
│ $ cursor is here_        │  ← prompt stays visible
├──────────────────────────┤
│ Ctrl  Alt  Fn▾  Esc Tab  │  ← modifier bar, pinned above keyboard
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

- **Horizontal padding**: `px-3 sm:px-6` for top bar, sidebar, and bottom bar (consistent chrome padding)
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

- `text-primary` (#fff) for actionable/focused text
- `text-secondary` (#888) for labels, hints, disabled state
- `accent-green` for "live" / active indicators only
- `accent` (blue) for fab status badges only
- `border` (#333) for all borders — no variation
- `bg-card` (#1a1a1a) for elevated surfaces (cards, dialogs)

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
| 11 | Bottom bar keys | `Esc Tab │ Ctrl Alt Cmd │ Fn▴ ← → ↑ ↓ >_`. Arrow keys essential for mobile. Fn dropdown includes F1-F12 + PgUp/PgDn/Home/End. |
| 12 | Breadcrumb format | `☰ {logo} ❯ run-kit ❯ zsh` — `❯` as unified separator/dropdown icon. No `›` separators, no `⬡` icon. Session and window names are tappable dropdown triggers. |
| 13 | Sidebar width | Drag-resizable (default 220px, min 160px, max 400px), width persisted to localStorage. ~75% viewport as drawer on mobile. |
| 14 | Sidebar ordering | Same as tmux output order (no resorting) |
| 15 | Drawer trigger | Hamburger icon only — no swipe gesture |
| 16 | Testing strategy | MSW-backed tests for UI behavior (drawer, breadcrumbs, sidebar, keyboard, touch targets, viewport). Thin E2E suite (3-5 tests) for API integration round-trips (create/kill session, SSE stream). |
| 17 | Sidebar fab status | Inline on same line as window name, right-aligned. Stage name + icon, `text-secondary`, no "fab:" prefix. Omitted for non-fab windows. |
| 18 | Layout borders | `border-b` on top bar, `border-t` on bottom bar, `border-r` on sidebar. Clear visual separation between chrome regions and content. |
| 19 | Padding consistency | All chrome uses `px-3 sm:px-6`. Terminal container gets `py-0.5 px-1` for breathing room. Bottom bar `py-1.5` for near-symmetry with top bar's `py-2`. |
| 20 | "+ New Session" location | Moved from sidebar footer to top bar line 2. Always visible (not gated on current window). Sidebar has no footer section. |
| 21 | Bottom bar position | Inside terminal column (not root layout). Width tracks terminal, not full viewport. Sidebar extends full height of main area. |

## Open Design Questions

None currently.
