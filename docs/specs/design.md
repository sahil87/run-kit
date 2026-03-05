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

The top bar and bottom bar are **architecturally immovable**. They never shift, resize, or reflow between pages. Page content flows in the space between them. This creates spatial stability — your eyes always know where navigation, status, and modifier keys live.

### 4. Three Pages, No More (Constitution IV)

`/` (Dashboard), `/p/:project` (Project), `/p/:project/:window` (Terminal). No settings pages, no admin panels. Configuration lives on disk. New pages require explicit spec justification.

### 5. Derive, Don't Configure (Constitution VII)

Project identity from tmux session names. State from `tmux list-sessions` + filesystem. No database, no user accounts, no setup wizard. If tmux knows about it, run-kit knows about it.

### 6. Phone-Usable (iOS First)

run-kit must be fully usable on a phone. This is a primary use case, not an afterthought — checking on agent sessions from the couch, sending a quick command from your phone, monitoring progress while away from the desk.

**What this means for every design decision**:

- **Touch targets**: Minimum 44px tap height (Apple HIG). Window cards, bottom bar buttons, breadcrumb links — all must be comfortably tappable.
- **Bottom bar is essential on mobile**: No physical keyboard means the modifier bar is the *only* way to send Ctrl+C, Esc, function keys. On mobile the bottom bar appears on the terminal page and becomes the primary interaction surface alongside the on-screen keyboard.
- **Max-width becomes full-width on mobile**: `max-w-4xl` is the desktop constraint. On screens < 896px, content goes edge-to-edge with minimal padding (`px-3` or `px-4`).
- **Terminal font scales down**: 13px on desktop, smaller on mobile (10-11px) to fit more columns. The terminal should still be readable and horizontally scrollable if needed.
- **Top bar stays compact**: The icon-driven breadcrumb (`{logo} › ⬡ run-kit › ❯ zsh`) was already designed tight — it fits on a phone screen. Line 2 actions may need to collapse into the command palette on narrow screens.
- **Cards are already touch-friendly**: Full-width, stacked vertically, clear tap targets. The hover-reveal kill button (✕) needs a mobile alternative — long-press or swipe-to-reveal.
- **No hover states on mobile**: Hover-reveal patterns (kill button, border brightening) need touch equivalents. Either always-visible or gesture-activated.

---

## Layout Architecture: The Fixed Chrome

### Problem

The top bar shifts when navigating between Dashboard → Project → Terminal because:
1. TopBar is rendered **inside** each page's client component, not in a shared layout
2. Different pages use different container widths (`max-w-4xl` vs `max-w-[900px]`) and padding (`p-6` vs `px-4`)
3. Line 2 is conditionally rendered — `{children && (...)}` means height changes when no actions exist
4. No bottom bar exists at all

### Principle: Chrome Must Be Architecturally Immovable

The top bar and bottom bar should be **owned by the root layout**, not individual pages. Pages inject content into fixed slots, but the chrome's height and position never change. This is not a styling fix — it's a structural constraint. The layout makes it **difficult to accidentally shift the chrome**.

### Structure

```
┌─────────────────────────────────────────────┐
│ {logo} › ⬡ run-kit › ❯ zsh    ● live  ⌘K   │  ← fixed height, shrink-0
│ [Kill Window]                      ● active │  ← fixed height, shrink-0 (EVEN WHEN EMPTY)
├─────────────────────────────────────────────┤
│                                             │
│              Page Content                   │  ← flex-1, scrollable
│              (children)                     │
│                                             │
├─────────────────────────────────────────────┤
│ ⌃ Ctrl  ⌥ Alt  ⌘ Cmd  F1 F2 ... F12  Esc  │  ← fixed height, shrink-0
└─────────────────────────────────────────────┘
```

**CSS skeleton** (root layout):
```
h-screen flex flex-col
  ├── top-chrome: shrink-0   (2 lines, fixed height)
  ├── content:    flex-1 overflow-y-auto min-h-0
  └── bottom-bar: shrink-0   (1 line, fixed height)
```

**Single max-width**: One value everywhere — top bar, content, bottom bar. Same horizontal padding. No page can override the chrome's width. The fixed-width constraint applies to the terminal too — a fixed-width terminal is more pleasant to use than a full-bleed one, and the consistency across all three pages makes navigation feel seamless.

### Top Bar (2 lines)

**Line 1 — Navigation + Global Status**
- Left: Breadcrumbs — compact, icon-driven, no verbose labels
- Right: Connection dot + "live"/"disconnected", `⌘K` kbd hint

Breadcrumb format (icons replace words):

```
Dashboard:  {logo}
Project:    {logo} › ⬡ run-kit
Terminal:   {logo} › ⬡ run-kit › ❯ zsh
```

- `{logo}` — the RunKit hex logo, always links to `/`. Replaces the word "Dashboard".
- `⬡` — hexagon, ties to the RunKit brand. Followed by session name.
- `❯` — terminal prompt character (universally recognized from Pure, Starship, etc.). Followed by window name.
- Each segment is a link except the last (current page)
- Keep it tight — no "project:" or "window:" prefixes, just icon + name

**Line 2 — Actions + Contextual Status**
- Left: Page-specific action buttons (+ New Session, + New Window, Kill, etc.)
- Right: Page-specific status text (session/window counts, fab progress)
- **MUST render even when empty** — fixed height placeholder, never collapses

**Line 2 — Mobile collapse** (screens < 640px):

Actions collapse into the command palette, accessed via a `⋯` button. Status stays visible. The `⋯` also serves as the mobile command palette trigger (replacing the `⌘K` kbd hint which is meaningless without a physical keyboard).

```
Desktop:
┌─────────────────────────────────────────────────┐
│ [+ New Session] [Search...]   3 sessions, 5 win │
└─────────────────────────────────────────────────┘

Mobile:
┌─────────────────────────────────────────────────┐
│ 3 sessions, 5 windows                      [⋯] │
└─────────────────────────────────────────────────┘
```

Per-page mobile Line 2:

```
Dashboard:  3 sessions, 5 windows                [⋯]
Project:    3 windows                             [⋯]
Terminal:   ● active  fab: intake ◷               [⋯]
```

Tapping `⋯` opens the command palette with all page actions:
- Dashboard: New Session, Search, Go to project...
- Project: New Window, Send Message, Kill Window...
- Terminal: Kill Window, Back to Project...

The `⌘K` hint in Line 1 also becomes the `⋯` button on mobile (or is hidden, since `⋯` in Line 2 serves the same purpose).

### Bottom Bar (Modifier Keys — Terminal Page Only)

**Purpose**: Browser terminals can't reliably capture F1-F12, Ctrl+C, Esc, and other modifier combos. The bottom bar provides clickable `<kbd>` buttons that inject these keystrokes into the active terminal.

**Scope**: Terminal page only. Dashboard and Project pages do not render the bottom bar — they don't need it and the chrome height difference between pages is acceptable since the top bar (the spatial anchor for navigation) remains fixed.

**Layout**: Single row of `<kbd>` styled buttons:

```
Ctrl  Alt  Cmd  │  ← → ↑ ↓  │  Fn▾  Esc  Tab  ✎
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

### Slot Injection (Pages → Chrome)

Pages need to control what appears in Line 2 and breadcrumbs without owning the chrome container.

**Approach — React Context**:
- `ChromeProvider` wraps the app in root layout
- Exposes: `setBreadcrumbs()`, `setLine2Left()`, `setLine2Right()`, `setBottomBarActive()`
- Each page's client component calls these on mount/update via `useEffect`
- Chrome renders current slot content, maintaining fixed height regardless

This means the layout file contains the chrome markup and pages only inject content — they can never change the chrome's structure, padding, or height.

---

## Component Mockups

### Project Group (Dashboard page)

Each tmux session renders as a group with a header and its window cards stacked below.

```
  run-kit                     3 windows                ✕
 ┌───────────────────────────────────────────────────────┐
 │ main                         fab: spec ▸▸░░  ● idle  │
 │ ~/code/wvrdz/run-kit                                  │
 ├───────────────────────────────────────────────────────┤
 │ 260305-a1b2-fix-layout       fab: apply ▸▸▸░ ● active│
 │ ~/code/wvrdz/run-kit/.worktrees/fix-layout            │
 ├───────────────────────────────────────────────────────┤
 │ scratch                                      ● idle  │
 │ ~/code/wvrdz/run-kit                                  │
 └───────────────────────────────────────────────────────┘

  ao-server                   1 window                 ✕
 ┌───────────────────────────────────────────────────────┐
 │ main                                        ● active │
 │ ~/code/wvrdz/ao                                       │
 └───────────────────────────────────────────────────────┘
```

**Project header**: Session name (left, clickable → `/p/:project`), window count (center), kill button (right, always visible).

**Window card**: Single box per window containing:
- **Row 1**: Window name (left), fab badge if present (right of center), activity dot + label (right), ✕ kill (always visible, far right)
- **Row 2**: Worktree path (subdued, `text-secondary`)
- Focused card gets `border-accent` + subtle bg highlight
- Clicking navigates to `/p/:project/:window`

### Window Card (Project page)

Same card component as Dashboard, without the project header — flat list.

The card component is **identical** between Dashboard and Project — same `SessionCard`, same dimensions, same padding. The only difference is the surrounding context (grouped under project headers on Dashboard, flat list on Project page).

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

### The Orchestrator Window (Future)

Soon, each session will have a **singleton orchestrator window** — a special terminal that manages all the worktrees in that session. This is conceptually different from regular windows:

| Aspect | Regular Window | Orchestrator |
|--------|---------------|-------------|
| Purpose | Run one agent on one change | Coordinate all changes in the session |
| Count | 0–N per session | Exactly 1 per session (singleton) |
| Identity | Named after change/worktree | Fixed name (e.g., `orchestrator` or `orch`) |
| UX weight | Standard card in the list | Visually distinct — elevated, pinned to top |

**UX implications** (to be designed):
- The orchestrator card should be visually separated from regular window cards — pinned at the top of the project group, different styling (e.g., subtle accent border, icon, or label)
- It may show aggregate status: how many worktrees are active, which stages they're in, overall health
- Clicking it opens the orchestrator terminal, but it could also have a dashboard-like summary view
- On the Dashboard page, the orchestrator status could be surfaced in the **project header** itself (since it's per-project metadata)

**Open questions**:
- How is the orchestrator window created? Auto-created when the session starts? On-demand via command palette?
- Does the orchestrator appear in the regular window list (with special styling) or in its own dedicated slot above the list?
- What does the orchestrator terminal actually run? A persistent Claude Code session? A custom TUI?

---

## Visual Consistency Rules

### Spacing

- **Horizontal padding**: `px-6` everywhere (chrome + content)
- **Max width**: `max-w-4xl` (896px) everywhere. Tailwind native, no magic numbers. Yields ~108 terminal columns at 13px JetBrains Mono — a practical width for modern terminal work.
- **Line heights**: Top bar lines use identical `py-2` + `text-sm`, producing predictable heights

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
| 1 | Bottom bar scope | Terminal page only — Dashboard/Project don't need modifier keys |
| 2 | F1-F12 layout | Dropdown (`Fn ▾`) to keep the bar compact |
| 3 | Sticky modifier visual | Yes — "armed" state with highlight color while active |
| 4 | Terminal max-width | Fixed width, same as all pages. Fixed-width terminal is more pleasant to use and keeps navigation seamless across pages |
| 5 | Max-width value | `max-w-4xl` (896px). Tailwind native, ~108 terminal columns at 13px JetBrains Mono |
| 6 | Fn dropdown behavior | Closes after each selection — one key per open |
| 7 | Mobile keyboard + modifier bar | Modifier bar pins above iOS keyboard. Terminal shrinks via `flex-1` + `FitAddon`. Prompt stays visible adjacent to modifier keys. Use `visualViewport` API for detection. |
| 8 | Kill button (✕) | Always visible — no hover-reveal. Simpler, works on mobile and desktop equally. |
| 9 | Mobile Line 2 | Actions collapse into command palette via `⋯` button. Status text stays visible. `⋯` replaces `⌘K` as command palette trigger on mobile. |
| 10 | Bottom bar keys | `Ctrl Alt Cmd │ ← → ↑ ↓ │ Fn▾ Esc Tab ✎`. Arrow keys essential for mobile. Fn dropdown includes F1-F12 + PgUp/PgDn/Home/End. |

## Open Design Questions

- Playwright E2E scope (separate change): mobile viewport testing (bottom bar, touch targets >= 44px, Line 2 collapse), fixed chrome pixel stability across navigation, compose buffer flow, `visualViewport` keyboard behavior
