# Intake: Keyboard Shortcut Registry, Uniform Shifted Tier & Cheatsheet Overlay

**Change**: 260730-g40a-keyboard-shortcut-registry-overlay
**Created**: 2026-07-30

## Origin

Conversational — a `/fab-discuss` session that researched Conductor's shortcut scheme, audited run-kit's existing bindings, and converged on a tier decision over several rounds.

> User's raw asks, in sequence: "Check the keyboard shortcuts for conductor. Then suggest a model to think of keyboard shortcuts for run-kit." → "Is alt available?" → "What if run-kit owns the whole Shift+Cmd / Ctrl namespace?" → "Three finger, 4 finger — doesn't matter as much as making sure that N becomes the letter associated with new, H and L for up tab, down tab. Then we need one for back and forward also. I want to know the cleanest namespace available" → (post-Electron) "We should keep Cmd and Ctrl symmetry" → disambiguation: "(B) — Shift is always part of the chord" → "Ok, lets start somewhere (B). Whatever we do, we should be able to override easily. Can you design a great looking keyboard shortcuts page?"

Key decisions from the discussion:

1. **Tier (B) chosen explicitly** over (A): the run-kit action tier is `Shift+CmdOrCtrl+<key>` — ⇧⌘ on macOS, ⇧Ctrl on Windows/Linux — *uniform on every platform*. The user's stated priority: letter consistency matters more than chord weight ("three finger, 4 finger — doesn't matter"). (A) plain-⌘-on-mac was rejected because ⌘H (Hide), ⌘M, ⌘Q are macOS/HIG-bound, so the H/L pair couldn't live in the same tier as N/T/W — the exact fragmentation Conductor exhibits (their attention-nav pair is exiled to ⌥H/⌥L because ⌘H is Hide, despite being macOS-only).
2. **Plain Ctrl must always reach the pane** on Windows/Linux (Ctrl+W delete-word, Ctrl+L clear-screen, Ctrl+T fzf, Ctrl+N/P history). This is why plain Cmd↔Ctrl symmetry was rejected and why every cross-platform terminal (Windows Terminal, GNOME Terminal, Konsole, kitty) uses Ctrl+Shift as its app tier. Legacy TTY encoding cannot distinguish Ctrl+Shift+letter from Ctrl+letter, so claiming the shifted tier costs terminal apps nothing.
3. **Overrides are a day-one requirement** ("Whatever we do, we should be able to override easily").
4. **The shortcuts "page" is an overlay, not a route** (Constitution IV bans settings pages; route set is fixed).
5. An interactive HTML design mock was built and reviewed by the user in an iframe window — preserved at `design-mock.html` in this change folder. It demonstrates the tier map, grouped rows with scope badges, click-to-capture rebinding, conflict warning, platform toggle, and locked shell-owned rows.
6. A follow-up change (`260730-hbyh-shortcut-macro-riff-bindings`) covers macro bindings; this change only reserves the schema slot for it.

## Why

run-kit's Constitution V mandates keyboard-first operation, but the current shortcut surface is five hand-rolled chords (⌘K palette, ⌘\ sidebar, ⌘. lens cycle, Ctrl+` chat toggle, board-only ⌘[/⌘]) each with its own `keydown` listener and its own ad-hoc suppression logic (`shouldSuppressViewChord`, a `.xterm` carve-out in the sidebar toggle, capture-phase handlers in dropdowns). There is no navigation or creation via keyboard at all — no new-session, no window switching, no back/forward — and discoverability is near-zero: only the view-lens palette actions render a `shortcut` hint; nothing else does, and there is no cheatsheet.

The desktop shell (PRs #465–#472) made this urgent and solvable: the shell's keyboard contract (`app/desktop/src/menu.ts`) deliberately leaves the entire unshifted Cmd/Ctrl tier unbound for the SPA and establishes `Shift+CmdOrCtrl` as the app-action tier (server switcher ⇧⌘1–9 / ⇧Ctrl+1–9). The SPA now needs to claim its half of that tier coherently, or ad-hoc chords will keep accreting listener-by-listener with inconsistent suppression, no override path, and no discoverability.

If we don't do this: every new action adds another scattered listener; users on Windows/Linux get chords that collide with the shell or the terminal; nothing is rebindable; and the keyboard-first principle stays aspirational for navigation.

Why this approach: a single declarative registry gives one place to define, suppress, override, display, and test every binding — and the uniform shifted tier is the only namespace where the user's required letters (N, T, W, H, L) coexist on every platform and in both shell and browser hosts.

## What Changes

### 1. Canonical tier & starter bindings

The run-kit action tier is `Shift+CmdOrCtrl+<key>` on all platforms. Starter set (letters are canonical, agreed in discussion and shown in the mock):

| Key | Action | Notes |
|-----|--------|-------|
| N | New session | opens the create-session dialog |
| T | New window | tab-analog in the current session |
| W | Close window | confirm flow, same as sidebar close |
| H | Previous window | within current session, sidebar order |
| L | Next window | within current session, sidebar order |
| [ | Back | router history |
| ] | Forward | router history |
| A | Next waiting agent | jump to the next window whose agent-state is `waiting` — the attention-nav loop |
| / | Toggle shortcuts overlay | the cheatsheet |

Claimed keys the registry must treat as unavailable (shown locked in the overlay): ⇧CmdOrCtrl+1–9 (shell server switcher), ⇧CmdOrCtrl+R (shell force reload), ⇧Ctrl+I (shell DevTools, win/linux), ⇧⌘Q (macOS logout), and — in *browser* hosts only — N/T/W (browser-reserved: incognito/reopen-tab/close-window; the actions remain palette-reachable there).

### 2. Declarative registry (new `lib/keybindings.ts` or similar)

One module owning all bindings:

```ts
type KeyBinding = {
  actionId: string;          // stable id, doubles as palette action id where one exists
  code: string;              // KeyboardEvent.code — layout-independent ("KeyN", "BracketLeft")
  tier: "shifted" | "cmd" | "ctrl";  // shifted = Shift+CmdOrCtrl (the run-kit tier)
  scope: "global" | "terminal" | "board" | "sidebar";
  kind: "builtin";           // "macro" reserved for change hbyh — schema slot only, no executor here
  label: string;             // human label for overlay + palette hint
};
```

- **Match on `e.code`, never `e.key`** — layout-safe, and sidesteps the Electron character-resolution flakiness the shell docs flag for shifted accelerators (`menu.ts:47-50`).
- Defaults are data; a resolver merges the per-device override layer (below) and produces the effective map.
- Conflict detection is a pure function over the effective map (used by capture UI and by tests).

### 3. Dispatch seams

- One `window`-level keydown listener for the app at large, consulting the registry + scope + a single shared suppression predicate (real text inputs suppress; `.xterm` and `.rk-chat-input` carve-outs preserved).
- `attachCustomKeyEventHandler` in `terminal-client.tsx` (currently only the ⌘C-copy special case at ~line 328) consults the registry and returns `false` for app-owned chords so they fire even with the terminal focused, while everything else — including all plain-Ctrl — flows to the pane untouched.
- Existing scattered chords (⌘K, ⌘\, ⌘., Ctrl+`, board ⌘[/⌘]) migrate INTO the registry with their **combos unchanged** (they are established, browser-safe punctuation; only their definition/suppression centralizes). The board pane-cycle stays scoped to `board`; the new ⇧-tier [/] back/forward is `global`.
- NOT Electron menu accelerators: the shell's documented seam is accelerator *avoidance* (`desktop-shell.md` design decisions); SPA keys live in the renderer and therefore work identically in shell and browser hosts.

### 4. Per-device overrides

- `localStorage["runkit-keybindings"]` stores **diffs only**: `{ [actionId]: { code, tier } | null }` (null = disabled). Same persistence pattern as `runkit-terminal-font-size`.
- Capture UI records `e.code` + modifiers; conflicts resolve as steal-with-warning (the previous owner becomes unbound and is flagged in the overlay until rebound or reset).
- Per-row reset + reset-all. Export/import deferred (it's a JSON blob; trivial later).
- No backend, no new config file — Constitution II.

### 5. Shortcuts overlay (the "page")

- Opened by ⇧CmdOrCtrl+/ and via a palette action; rendered as a dialog/sheet (focus-trapped like existing dialogs), NOT a new route.
- Contents per the reviewed mock (`design-mock.html`): tier-map keyboard visualization (bound / custom / claimed / free per key, per platform), platform display toggle (macOS ↔ Win·Linux keycap rendering), filter input, grouped rows with scope badges, click-to-rebind capture with Esc-cancel and conflict warning, modified-dot + per-row reset, shell-owned rows shown locked (🔒, edit lives in the shell menu), footer with storage note + reset all.
- Styling uses the existing hover-animation vocabulary (bracket section headings, CRT-glint buttons, accent-green states) and the three-mode theme tokens.

### 6. Palette hints

Every registered action that has a palette entry renders its effective combo as the palette `shortcut` hint (today only view-lens actions do). Hints reflect overrides, formatted per platform (⇧⌘N vs Shift+Ctrl+N).

### 7. Shell coordination

Document the tier-ownership split in `docs/memory/run-kit/desktop-shell.md` during hydrate: shifted digits + R/I = shell (menu accelerators), shifted letters = SPA registry; future shell menu additions must check the registry before claiming a shifted key.

## Affected Memory

- `run-kit/ui-patterns`: (modify) new keyboard-shortcut registry section — tier rule, starter bindings, override layer, overlay, palette hints
- `run-kit/desktop-shell`: (modify) tier-ownership split note (shell digits/R/I vs SPA letters)

## Impact

- `app/frontend/src/lib/` — new registry module + conflict/format helpers (pure, unit-testable)
- `app/frontend/src/components/` — new shortcuts-overlay component; edits to `terminal-client.tsx` (custom key handler consults registry), `command-palette.tsx` (hint rendering), `app.tsx` / `shell.tsx` / `board-page.tsx` (existing listeners migrate to registry dispatch)
- `app/frontend/tests/` — e2e for the new chords + overlay (with `.spec.md` companions per constitution); unit tests for resolver/conflict logic
- No backend changes. No shell (`app/desktop/`) changes — coordination is documentation-only.
- Board ⌘[/⌘] and all legacy chords keep working byte-identically during migration.

## Open Questions

- Should ⇧CmdOrCtrl+T create the new window in the current session always, or offer the session picker when invoked outside a session context (e.g., on the board route)? Default assumption: current session when on a terminal route; palette fallback elsewhere.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tier (B): uniform `Shift+CmdOrCtrl+<key>` on every platform | User explicitly chose (B) after an (A)/(B) disambiguation question; rationale documented in Origin | S:95 R:70 A:95 D:95 |
| 2 | Confident | Letter map: N=new session, T=new window (window = tab-analog) | User once said "Cmd+N should be the Open window shortcut"; N=session/T=window presented twice (incl. the mock) without objection; trivially swappable in the registry data | S:60 R:90 A:70 D:60 |
| 3 | Certain | Cheatsheet is an overlay, not a route | Constitution IV fixes the route set and bans settings pages | S:80 R:80 A:100 D:95 |
| 4 | Certain | Overrides in `localStorage` diffs, no backend | Constitution II (no database); mirrors `runkit-terminal-font-size` pattern; user asked only for "easily overridable" | S:85 R:85 A:95 D:90 |
| 5 | Certain | Match bindings on `e.code`, not `e.key` | Layout-independent; avoids the shifted-accelerator flakiness the shell docs flag; standard practice | S:70 R:85 A:90 D:85 |
| 6 | Confident | Legacy chords (⌘K, ⌘\, ⌘., Ctrl+`, board ⌘[/]) migrate into the registry with combos unchanged | Discussed ("keep the existing punctuation chords"); centralizing their definition is the registry's purpose | S:55 R:85 A:80 D:75 |
| 7 | Confident | v1 binding set = the 9 starter actions above | The set shown in the reviewed mock; registry makes additions cheap | S:65 R:90 A:75 D:70 |
| 8 | Certain | Dispatch in the SPA renderer, not Electron menu accelerators | Shell's documented accelerator-avoidance seam; must work in browser hosts too | S:70 R:75 A:90 D:85 |
| 9 | Certain | `kind` field reserves the macro slot; no macro executor in this change | User explicitly approved the two-change split | S:90 R:95 A:90 D:90 |
| 10 | Confident | Conflict policy = steal-with-warning; browser-dead letters (N/T/W) fall back to palette | Shown in the mock; consistent with "override easily" | S:55 R:90 A:70 D:65 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
