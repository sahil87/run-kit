# Intake: Terminal Option Key as Meta

**Change**: 260819-c9i9-xterm-option-meta-key
**Created**: 2026-08-19

## Origin

> for this fix

Conversational, one-shot follow-through on a diagnosis already completed earlier in the same session via `/fab-discuss`. The user reported: *"check why 'option+P' is printing out pi character instead of invoking '/model' in claude session"*. The agent investigated inline (no fab change active at the time) and reported a root-cause diagnosis plus two fix options; the user's `/fab-new "for this fix"` invocation is the go-ahead to turn the diagnosis into a tracked change.

**Investigation findings carried forward from the conversation:**

- The user is running a CLI agent (Claude Code) inside a tmux pane, viewed through run-kit's browser-based terminal (`TerminalClient` / xterm.js), and pressing macOS Option+P expecting a CLI keybinding (Option+P → `/model`) to fire. Instead, the terminal receives and transmits the literal composed character `π`.
- **Root cause**: `app/frontend/src/components/terminal-client.tsx:279-285` constructs the xterm.js `Terminal` without setting `macOptionIsMeta`:
  ```ts
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"MonaspiceNe Nerd Font Mono", ui-monospace, monospace',
    fontSize: fontPx,
    theme: deriveXtermTheme(activeTheme.palette),
    allowProposedApi: true,
  });
  ```
  xterm.js's `ITerminalOptions.macOptionIsMeta` defaults to `false` (confirmed against xterm.js's `OptionsService.ts` `DEFAULT_OPTIONS`). Per xterm.js's own keyboard-handling source (`common/input/Keyboard.ts`):
  ```ts
  } else if ((!isMac || macOptionIsMeta) && ev.altKey && !ev.metaKey) {
    // On macOS this is a third level shift when !macOptionIsMeta. Use <Esc> instead.
  ```
  With the default `false` on macOS, Option is treated as a **third-level shift** (OS-level character composition) rather than **Meta** — the browser resolves Option+P to `π` before xterm is involved, and xterm does not override that with an `ESC` prefix. The literal `π` bytes are sent over the pty (`terminal.onData` → the `RelayMux` stream) instead of the `ESC p` (Meta-p) sequence a CLI keybinding needs to see.
- This is a **real gap, not a documented tradeoff**: `docs/memory/run-kit/ui/compose-and-bottom-bar.md` already documents that the team is aware Option composes special glyphs on macOS (Alt+B/F/D → `∫`/`ƒ`/`∂`) — but that awareness is scoped to a *different* subsystem (the on-screen compose textarea's `lib/readline-keys.ts`, which matches on `event.code` to route around exactly this quirk for 5 specific chords). It does not extend to the raw xterm terminal pane itself, and no memory file mentions `macOptionIsMeta`.
- The same memory file separately documents (§ Special keys) an existing "Alt prefix with ESC (Meta convention)" for the bottom-bar's Fn-menu synthetic key sender (`sendSpecial`) — i.e., the codebase's own on-screen affordance for sending special keys *already* treats Alt as Meta by convention. This change brings the raw physical-keyboard path (typing directly into the terminal) into parity with that existing convention, rather than introducing a new one.
- **Two fix options were discussed**:
  1. **Global `macOptionIsMeta: true`** on the `Terminal()` constructor (the recommended floor — one line, fixes every Option+letter chord for every CLI running in the pane).
  2. **Scoped interception** in the existing `attachCustomKeyEventHandler` (line 359, where Cmd+C copy is already special-cased) — manually detect specific Option+letter combos and send `\x1b` + the letter, leaving all other Option combos free to compose OS glyphs.
  Given this project is a terminal for driving CLI agents (constitution: keyboard-first, Claude Code and other CLIs rely on Meta-bound chords far more than users rely on typing composed glyphs like `π`/`∫`/`é` directly into a terminal pane), option 1 was recommended and is the one this change implements.

## Why

**Problem**: Any Option+letter chord typed directly into a run-kit terminal pane is silently swallowed as a literal composed macOS character instead of reaching the running program as a Meta-encoded (`ESC`+letter) key sequence. This breaks any CLI keybinding that relies on Option/Alt as Meta — e.g. Claude Code's Option+P → `/model` — and, more broadly, standard readline/shell Meta conventions (`Alt+.`, `Alt+B`/`Alt+F` word motion in bash/zsh, `M-x`-style bindings in other CLIs) that users expect to work when Option is the modifier.

**Consequence if unfixed**: users lose access to an entire class of keyboard shortcuts inside the terminal pane whenever they're on macOS with a physical keyboard, with no visible error — the keypress appears to "do nothing" (or worse, silently inserts a stray glyph into whatever text field/prompt currently has focus in the running program).

**Why this approach**: `macOptionIsMeta` is xterm.js's own first-class option for exactly this tradeoff (Meta semantics vs. OS glyph composition) — it needs no fork, no version coupling, and no reimplementation of xterm's keyboard-encoding logic. The scoped-interception alternative (enumerate specific Option+letter combos in the existing `attachCustomKeyEventHandler`) was rejected as the primary fix because it only helps combos the app happens to know about in advance, while the whole point of Meta-as-modifier is that arbitrary CLI programs bind arbitrary letters — a fixed allowlist would need to be extended every time a new CLI keybinding surfaces.

## What Changes

### Terminal keyboard configuration (`app/frontend/src/components/terminal-client.tsx`)

Add `macOptionIsMeta: true` to the `Terminal()` constructor options (currently at lines 279-285):

```ts
terminal = new Terminal({
  cursorBlink: true,
  fontFamily: '"MonaspiceNe Nerd Font Mono", ui-monospace, monospace',
  fontSize: fontPx,
  theme: deriveXtermTheme(activeTheme.palette),
  allowProposedApi: true,
  macOptionIsMeta: true,
});
```

**Resulting behavior change**: any `Option`/`Alt` + letter keydown while the terminal pane has focus now transmits `ESC` + the letter (the Meta encoding) to the pty, instead of the browser's OS-composed special character. This applies uniformly to every letter/key, not a fixed allowlist — the entire point of the fix.

**Explicitly out of scope** (verified not to overlap):
- The bottom-bar / docked compose textarea's `lib/readline-keys.ts` Alt+B/F/D word-motion interception — a separate DOM element with its own `event.code`-based handling, untouched by this change.
- The Fn-menu's `sendSpecial` synthetic Alt+ESC convention — already implements the same Meta convention this change extends to physical keypresses; no code change needed there.
- The app's own keybinding registry (`lib/keybindings.ts`) — Alt chords are already excluded from every registry tier (documented in `compose-and-bottom-bar.md`), so there is no collision between this change and any app-owned Alt shortcut.

### Tests

- **Unit test** (`terminal-client.test.tsx`): the existing test file already mocks `@xterm/xterm`'s `Terminal` as a `vi.fn().mockImplementation(...)` (see lines ~92-111). Add an assertion that the `Terminal` mock is constructed with `macOptionIsMeta: true` in its options object (e.g. `expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ macOptionIsMeta: true }))`), mirroring how other constructor options (`allowProposedApi`, `fontSize`) are already implicitly covered by the mount tests in that file.
- **Manual verification** (documented limitation, not automatable): the actual symptom — macOS composing `π` from Option+P — happens at the OS/browser IME layer before any JS or Playwright-simulated `keyboard.press()` event fires; neither jsdom (no OS keyboard layout) nor Playwright (no real macOS IME composition, and CI runners are typically non-macOS) can reproduce the composition step that causes the bug. The unit-test assertion above (constructor option is set) is the correct and sufficient automated coverage; final confirmation is a manual check — focus the terminal pane on a real macOS + browser session, press Option+P, and confirm the running program (a shell, or a Meta-bound CLI) receives it as `ESC p` rather than displaying `π`.

## Affected Memory

- `run-kit/ui/terminal`: (modify) Add a short subsection near "### Terminal Addons" (or a new "### Keyboard: Option as Meta" subsection) documenting the `macOptionIsMeta: true` constructor option, why xterm.js's default (`false`) breaks Meta-bound CLI keybindings on macOS, and the explicit non-overlap with the compose-bar's separate Alt+B/F/D handling. Also add a `## Design Decisions` entry (four-field shape: Decision / Why / Rejected / *Introduced by*) capturing the global-flag-vs-scoped-interception tradeoff already reasoned through in this intake's Origin section.

## Impact

- **Code**: one file, one constructor call — `app/frontend/src/components/terminal-client.tsx` (`Terminal()` options, lines 279-285).
- **Tests**: `app/frontend/src/components/terminal-client.test.tsx` (add one assertion to the existing xterm-mock-based test suite; no new test file).
- **No backend changes.** No API surface change. No new dependency (uses an existing xterm.js option already available in the pinned `@xterm/xterm` version).
- **User-visible behavior change**: Option+letter combos typed directly into a run-kit terminal pane no longer compose macOS special characters (é, π, ∫, etc.) — they now send Meta/ESC-prefixed sequences instead. This is the entire point of the fix, but is worth flagging explicitly as a tradeoff for any user who relied on typing special characters directly into a terminal pane via Option (uncommon in a CLI-agent-driving tool, but not impossible).
- **No impact** on the separate compose-bar/Fn-menu Alt handling (already verified non-overlapping above).

## Open Questions

None — the fix is fully scoped by the diagnosis above (single config flag, single file), the approach was already discussed and not objected to in conversation, and the only real judgment call (global flag vs. scoped interception) is recorded as a graded assumption below rather than left open.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix by setting `macOptionIsMeta: true` globally on the `Terminal()` constructor, rather than scoped interception in `attachCustomKeyEventHandler` | Discussed at length in conversation with a clear recommendation and explicit tradeoff (global Meta semantics vs. losing OS glyph composition); the fix is a single reversible config line; xterm.js's own docs/source give an unambiguous, well-established mechanism for this exact behavior; the user proceeded directly to `/fab-new` without redirecting away from the recommended option | S:80 R:90 A:85 D:65 |
| 2 | Certain | Scope excludes the bottom-bar compose textarea (`readline-keys.ts`) and the Fn-menu `sendSpecial` convention — both already handle Alt/Meta correctly for their own surfaces and are unaffected by the xterm `Terminal()` option | Directly verified by reading the code — these are separate DOM elements/handlers with no shared code path with the xterm `Terminal` constructor | S:85 R:95 A:95 D:90 |
| 3 | Confident | Accept the tradeoff that Option+letter can no longer compose OS special characters (é, π, ∫, etc.) directly in the terminal pane, in favor of Meta/ESC semantics for CLI compatibility | Explicitly surfaced in the conversation and not objected to; this project's constitution emphasizes keyboard-first CLI-agent driving over general-purpose text composition, but a user who specifically wants to type accented/special characters in a shell prompt does lose that ability via Option — a genuine, if narrow, UX tradeoff | S:75 R:90 A:75 D:55 |
| 4 | Certain | This change updates `docs/memory/run-kit/ui/terminal.md` (Affected Memory) rather than skipping memory updates | The change is a user-visible behavior-contract change (keyboard semantics), which the project's own hydrate convention requires recording; the target file and section are unambiguous from the existing "Terminal Addons" / "Design Decisions" structure already in that file | S:70 R:95 A:90 D:80 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
