# Spec: xterm Clipboard & Addons

**Change**: 260313-dr60-xterm-clipboard-addons
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Terminal: Clipboard Copy via Key Handler

### Requirement: Cmd+C / Ctrl+C Selection-Aware Copy

The terminal component SHALL intercept `Cmd+C` (macOS) and `Ctrl+C` (Linux/Windows) via `attachCustomKeyEventHandler`. When text is selected in the terminal, the handler SHALL copy the selection to the system clipboard using `navigator.clipboard.writeText()` and prevent xterm from sending the keystroke to the backend (return `false`). When no text is selected, the handler SHALL allow the event to pass through (return `true`) so xterm sends SIGINT as normal.

The handler SHALL only intercept `keydown` events — `keyup` events MUST pass through unchanged.

#### Scenario: Copy selected text
- **GIVEN** the terminal has text selected via mouse or keyboard
- **WHEN** the user presses `Cmd+C` (macOS) or `Ctrl+C` (Linux)
- **THEN** the selected text is written to the system clipboard
- **AND** xterm does not send `\x03` (SIGINT) to the backend
- **AND** the selection remains visible

#### Scenario: SIGINT with no selection
- **GIVEN** the terminal has no text selected
- **WHEN** the user presses `Cmd+C` or `Ctrl+C`
- **THEN** xterm sends `\x03` (SIGINT) to the running process as normal

#### Scenario: Other key combinations pass through
- **GIVEN** any key combination that is not `Cmd+C` / `Ctrl+C`
- **WHEN** the user presses the key combination
- **THEN** the handler returns `true` and xterm processes the key normally

## Terminal: Addon Loading

### Requirement: Load ClipboardAddon for OSC 52 Support

The terminal component SHALL install `@xterm/addon-clipboard` as a new dependency and load it via dynamic import in the `init()` function, following the existing FitAddon pattern. This enables OSC 52 clipboard sequences — programs like tmux, vim, and SSH sessions can write to the system clipboard.

#### Scenario: ClipboardAddon loaded on init
- **GIVEN** the terminal component mounts
- **WHEN** the async `init()` function runs
- **THEN** `ClipboardAddon` is dynamically imported and loaded onto the terminal instance
- **AND** OSC 52 clipboard write sequences from backend programs reach the system clipboard

### Requirement: Activate WebLinksAddon

The terminal component SHALL activate `@xterm/addon-web-links` (already in `package.json`) by dynamically importing and loading it in the `init()` function. This makes URLs in terminal output clickable.

#### Scenario: WebLinksAddon loaded on init
- **GIVEN** the terminal component mounts
- **WHEN** the async `init()` function runs
- **THEN** `WebLinksAddon` is dynamically imported and loaded onto the terminal instance
- **AND** URLs appearing in terminal output become clickable links

### Requirement: Enable WebglAddon with Silent Fallback

The terminal component SHALL install `@xterm/addon-webgl` as a new dependency and attempt to load it via dynamic import in the `init()` function. Loading MUST be wrapped in a try/catch — WebGL2 context creation can fail on some hardware or when too many contexts are active. On failure, the canvas renderer continues working silently.

#### Scenario: WebGL rendering enabled
- **GIVEN** the browser supports WebGL2 and a context is available
- **WHEN** the terminal initializes
- **THEN** `WebglAddon` is loaded and GPU-accelerated rendering is active

#### Scenario: WebGL fallback to canvas
- **GIVEN** the browser does not support WebGL2 or context creation fails
- **WHEN** the terminal initializes
- **THEN** the `WebglAddon` load error is caught silently
- **AND** the terminal continues rendering via the default canvas renderer
- **AND** no error is logged or shown to the user

### Requirement: Addon Loading Order

All addons SHALL be loaded after `terminal.open()` and before the `ResizeObserver` is set up. The loading order SHALL be: FitAddon (existing), ClipboardAddon, WebLinksAddon, WebglAddon. FitAddon MUST be loaded first because `fitAddon.fit()` is called immediately after `terminal.open()`. WebglAddon MUST be loaded last because it replaces the renderer and should operate on a fully configured terminal.

#### Scenario: Addon loading sequence
- **GIVEN** the terminal is being initialized
- **WHEN** `terminal.open()` completes
- **THEN** addons are loaded in order: FitAddon → fit() → ClipboardAddon → WebLinksAddon → WebglAddon
- **AND** the terminal is fully functional before the ResizeObserver begins observing

## Design Decisions

1. **Cmd+C intercept via `attachCustomKeyEventHandler`**: Selected over auto-copy-on-select (option 2) because it matches native terminal behavior (iTerm2, Terminal.app) — users expect Cmd+C to copy and Ctrl+C to SIGINT.
   - *Why*: Preserves muscle memory and matches macOS/Linux conventions.
   - *Rejected*: Auto-copy-on-select — diverges from terminal conventions, could be surprising.

2. **Dynamic imports for all addons**: Follows existing FitAddon pattern in the codebase — all xterm addon imports are dynamic in the async `init()` function.
   - *Why*: Consistent with existing code, enables tree-shaking.
   - *Rejected*: Static imports — would diverge from established pattern.

3. **Silent WebGL fallback**: No error logging or user notification on WebGL failure.
   - *Why*: Canvas renderer is perfectly functional — the user never needs to know. Logging would create noise for devices that simply don't support WebGL2.
   - *Rejected*: Console.warn on failure — adds noise without actionable information.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `attachCustomKeyEventHandler` for Cmd+C copy | Confirmed from intake #1 — user chose option 3 (Cmd+C intercept) | S:95 R:90 A:90 D:95 |
| 2 | Certain | Load `@xterm/addon-web-links` | Confirmed from intake #2 — already installed, user confirmed | S:90 R:95 A:95 D:95 |
| 3 | Certain | Install `@xterm/addon-clipboard` | Confirmed from intake #3 — user explicitly requested | S:95 R:90 A:85 D:90 |
| 4 | Certain | Enable `@xterm/addon-webgl` with try/catch fallback | Confirmed from intake #7 — user confirmed, silent fallback | S:90 R:95 A:90 D:95 |
| 5 | Confident | Use `navigator.clipboard.writeText` for copy | Confirmed from intake #4 — standard web API, secure context required (run-kit uses localhost) | S:70 R:90 A:85 D:80 |
| 6 | Confident | Dynamic import pattern for all new addons | Confirmed from intake #5 — matches existing FitAddon pattern in codebase | S:75 R:95 A:90 D:90 |
| 7 | Confident | Handle both `metaKey` (macOS) and `ctrlKey` (Linux) | Confirmed from intake #6 — standard cross-platform terminal behavior | S:65 R:90 A:80 D:85 |
| 8 | Certain | Load addons after `terminal.open()`, WebglAddon last | xterm.js requires terminal to be open before loading renderer addons; FitAddon must be first for immediate fit() | S:85 R:85 A:95 D:90 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
