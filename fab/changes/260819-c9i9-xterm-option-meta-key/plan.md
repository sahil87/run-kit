# Plan: Terminal Option Key as Meta

**Change**: 260819-c9i9-xterm-option-meta-key
**Intake**: `intake.md`

## Requirements

### Terminal: Physical-keyboard Meta encoding

#### R1: Option/Alt is transmitted as Meta, not as an OS-composed glyph
The xterm.js `Terminal` instance created by `TerminalClient`
(`app/frontend/src/components/terminal-client.tsx`) MUST be constructed with
`macOptionIsMeta: true`, so a physical Option/Alt + key press while the terminal pane has
focus is encoded as an `ESC`-prefixed (Meta) sequence and written to the pty, rather than
the macOS third-level-shift character the browser would otherwise compose. The option
MUST be set on the constructor's options object (xterm.js reads it at keyboard-encoding
time from `OptionsService`), alongside the existing `cursorBlink` / `fontFamily` /
`fontSize` / `theme` / `allowProposedApi` options.

- **GIVEN** a run-kit terminal pane on macOS running a CLI that binds a Meta chord (e.g.
  Claude Code's Option+P → `/model`)
- **WHEN** the user presses Option+P with the terminal pane focused
- **THEN** xterm.js transmits `ESC p` (Meta-p) over the relay stream to the pty
- **AND** the literal composed character `π` is NOT transmitted

#### R2: The Meta encoding is guarded by automated regression coverage
The existing xterm-mock unit suite
(`app/frontend/src/components/terminal-client.test.tsx`) MUST assert that the mocked
`Terminal` constructor receives `macOptionIsMeta: true`, so removing or flipping the
option fails a test rather than silently regressing keyboard behavior. The assertion MUST
read the recorded constructor options (the suite's established
`vi.mocked(Terminal).mock.calls[0]?.[0]` idiom) rather than simulating a keypress —
the composition step that causes the bug happens in the OS/browser IME layer, which jsdom
does not model.

- **GIVEN** the unit suite for `TerminalClient`
- **WHEN** `just test-frontend` (Vitest) runs the suite
- **THEN** a test asserts the recorded constructor options carry `macOptionIsMeta: true`
- **AND** that test fails when the option is absent from the constructor

### Non-Goals

- Playwright e2e coverage of the symptom — macOS composes `π` from Option+P at the OS/IME
  layer before any JS event fires; neither jsdom nor a Playwright-synthesised
  `keyboard.press()` reproduces the composition, and e2e runners are typically non-macOS.
  Final confirmation is a documented manual check.
- The docked compose textarea's `lib/readline-keys.ts` Alt+B/F/D word-motion handling — a
  separate DOM element with its own `event.code`-based routing, no shared code path with
  the xterm `Terminal` constructor.
- The bottom bar's Fn-menu `sendSpecial` Alt-prefix-with-ESC convention — it already
  implements the Meta convention this change extends to physical keypresses.
- The app keybinding registry (`lib/keybindings.ts`) and
  `shouldRefuseTerminalChord` — Alt chords are excluded from every registry tier, so no
  app-owned shortcut collides with the newly Meta-encoded chords.
- `docs/memory/` updates — owned by the hydrate stage, not apply.

### Design Decisions

#### Global `macOptionIsMeta` over scoped chord interception
**Decision**: Set `macOptionIsMeta: true` once on the `Terminal()` constructor so every
Option/Alt + key chord is Meta-encoded uniformly.
**Why**: xterm.js's own first-class option for this exact tradeoff — no fork, no version
coupling, no reimplementation of xterm's keyboard encoder, and one reversible line. Meta
is only useful as a modifier if *arbitrary* letters reach the program, which is precisely
what a uniform flag gives.
**Rejected**: Enumerating specific Option+letter combos inside the existing
`attachCustomKeyEventHandler` (where Cmd+C copy is already special-cased) and emitting
`\x1b` + letter manually. It only helps chords the app knows about in advance, so the
allowlist would need extending every time a CLI adds a Meta binding — while still leaving
the general case broken.
*Introduced by*: 260819-c9i9-xterm-option-meta-key

#### Accept the loss of Option-composed glyphs in the terminal pane
**Decision**: Option+letter no longer composes macOS special characters (é, π, ∫, …)
inside a terminal pane.
**Why**: run-kit is a terminal for driving CLI agents (constitution § V Keyboard-First);
Meta-bound chords are load-bearing there, while typing composed glyphs directly into a
pane is rare.
**Rejected**: Keeping composition and shipping no fix, or gating the option behind a user
preference — a settings surface is explicitly out of scope by constitution § IV (Minimal
Surface Area), and this change has no evidence of demand for the composing behavior.
*Introduced by*: 260819-c9i9-xterm-option-meta-key

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the failing regression assertion first: a `TerminalClient` describe block in `app/frontend/src/components/terminal-client.test.tsx` asserting the recorded `Terminal` constructor options carry `macOptionIsMeta: true`; confirm it fails for the right reason (option absent) before implementing <!-- R2 -->
- [x] T002 Add `macOptionIsMeta: true` to the `Terminal()` constructor options in `app/frontend/src/components/terminal-client.tsx` (the mount-only xterm init effect, ~line 279) <!-- R1 -->

### Phase 2: Verification

- [x] T003 Run the frontend gates — `cd app/frontend && npx tsc --noEmit` and the Vitest run covering `terminal-client.test.tsx` — and confirm both pass <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `terminal-client.tsx` constructs the xterm `Terminal` with `macOptionIsMeta: true` alongside the existing constructor options
- [x] A-002 R2: `terminal-client.test.tsx` contains an assertion on the recorded constructor options for `macOptionIsMeta === true`

### Behavioral Correctness

- [x] A-003 R1: Option/Alt + key with the terminal focused is Meta-encoded (`ESC` + key) rather than transmitted as the macOS-composed glyph; the option is set at construction so it is live from the terminal's first keystroke

### Scenario Coverage

- [x] A-004 R2: the Vitest suite for `terminal-client.test.tsx` passes, and `npx tsc --noEmit` is clean in `app/frontend`

### Edge Cases & Error Handling

- [x] A-005 R1: the change is confined to the xterm `Terminal` constructor — the compose textarea's `readline-keys.ts` Alt handling, the Fn-menu `sendSpecial` path, and `shouldRefuseTerminalChord` are untouched, so no Alt chord is handled twice

### Code Quality

- [x] A-006 Pattern consistency: the new option follows the surrounding constructor-option style, and the new test follows the file's existing per-concern `describe` + `vi.mocked(Terminal).mock.calls[0]?.[0]` idiom
- [x] A-007 No unnecessary duplication: the existing xterm module mock and `renderTerminalClient` helper are reused; no new mock or render harness is introduced
- [x] A-008 Test coverage: the fix ships automated coverage appropriate to its surface (a unit assertion on the constructor option); Playwright e2e is not applicable and the reason is recorded under Non-Goals
- [x] A-009 Type narrowing: no `as` casts are introduced in the new test code beyond the file's existing typed-mock idiom
- [x] A-010 No comment narration: any comment added states a constraint the code cannot show (why the flag exists / why a keypress cannot be simulated), never narrates the next line

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Manual verification (not automatable, per Non-Goals): focus a terminal pane in a real
  macOS browser session, press Option+P, and confirm the running program receives `ESC p`
  rather than displaying `π`.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

- `src/lib/readline-keys.ts` (Alt+B/F/D `event.code` interception) — NOT redundant: it
  serves the compose/chat textarea, a separate DOM element xterm never sees; the new
  constructor option changes nothing about that surface.
- `src/components/bottom-bar.tsx:320` (`sendSpecial`'s `snapshot.alt ? "\x1b" : ""` prefix)
  — NOT redundant: it synthesizes Meta for keyboardless coarse-pointer devices that have no
  physical Option key to encode.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Split the intake into exactly two requirements — R1 (constructor option / behavior) and R2 (regression coverage) — rather than folding the test into R1 | The intake's "What Changes" section itself separates the code change from a dedicated "Tests" subsection, and `code-quality.md` makes tests mandatory for bug fixes, so the coverage obligation is a first-class requirement with its own acceptance | S:85 R:90 A:90 D:85 |
| 2 | Certain | No Playwright e2e task; record the infeasibility as a Non-Goal instead | The intake documents that macOS IME composition happens before any JS/Playwright event fires and that CI runners are non-macOS; `code-quality.md` phrases e2e for UI changes as SHOULD, not MUST | S:80 R:85 A:90 D:85 |
| 3 | Confident | Place the assertion in a new dedicated `describe` block rather than extending the existing "Unicode width init" block that already reads constructor args | The file's convention is one `describe` per behavioral concern with its own mock-clearing `beforeEach`; keyboard encoding is a different concern from Unicode width, and a separate block keeps the failure message pointing at the right subject | S:60 R:95 A:80 D:60 |

3 assumptions (2 certain, 1 confident, 0 tentative).
