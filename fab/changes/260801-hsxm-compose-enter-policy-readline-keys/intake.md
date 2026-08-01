# Intake: Compose Enter Policy Flip + Readline Keys

**Change**: 260801-hsxm-compose-enter-policy-readline-keys
**Created**: 2026-08-01

## Origin

Conversational (`/fab-discuss` session). The user asked for two things about the compose strip:

> I want the compose box to be more typing friendly. Eg: I can Ctrl b to move cursor back, or Ctrl U to backspace the whole line - the things you are used to on a terminal. […]
> Also, for submitting, I think the default action should be insert (on pressing enter). The only way to "Send" the text should be Cmd+Enter. So I can "Type 1st sentence". Then "Enter". Then "Sentence 2". Then "Enter". Then "Cmd + Enter" to submit the text (I am mostly concerned about sending the text to claude code over here.

An analysis of native textarea behavior + the keybinding registry followed. Two decisions were then explicitly confirmed by the user:

1. **Chat view flips too** — "Yes they can share the same. So yes, flap the other one two." (the chat send form keeps sharing `classifyComposeEnter`; both surfaces get Enter=newline).
2. **Shift+Enter remains newline.**

## Why

1. **Pain point — Enter policy**: on a fine pointer, plain Enter currently submits the compose strip's text to the pane. Composing a multi-sentence message (the primary use case: long prompts to Claude Code) requires Shift+Enter for every line break, and a reflexive Enter fires a half-written prompt at the agent. The user wants the terminal-free composition flow: Enter accumulates lines locally, one explicit chord (Cmd/Ctrl+Enter) sends.
2. **Pain point — line editing**: the strip is a plain `<textarea>`; on macOS most emacs-style bindings work natively via the Cocoa text system (Ctrl+A/E/B/F/P/N/D/H/K/T/O/Y), but the classic readline chords **Ctrl+U** (kill to line start), **Ctrl+W** (delete word back), and **Alt+B/F/D** (word motion / word delete) are unbound — Alt+B/F/D actually type ∫/ƒ/∂ on macOS. These are precisely the muscle-memory keys a terminal user reaches for.
3. **If unfixed**: accidental premature sends to agents continue; line editing stays keyboard-hostile for the project's terminal-first audience (Constitution V: keyboard-first).
4. **Why this approach**: flip the shared Enter classifier (one function, both surfaces stay consistent by design) rather than fork per-surface policies; intercept ONLY the missing readline chords rather than reimplementing natively-working ones (reimplementing Ctrl+K would break the native kill-buffer's interplay with Ctrl+Y).

## What Changes

### 1. Enter policy flip in `classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts`)

New policy (replaces the pointer-aware policy from 260719-mxvw):

- **Enter (no modifier)** → `"default"` (textarea inserts a newline) — on ALL pointer types.
- **Shift+Enter** → `"default"` (newline; kept for muscle memory, now redundant with plain Enter).
- **Cmd/Ctrl+Enter** → `"submit"` (the ONLY submit chord).
- **Alt+Enter** → `"insert"` (unchanged — deliver text without trailing `\r`).
- **IME-composing Enter** → `"default"` (unchanged guard).

The fine/coarse pointer distinction **disappears from Enter classification** — it existed solely because touch keyboards cannot express the old Enter-submits policy. The `coarse` parameter is removed from the classifier signature (or ignored — prefer removal; update both call sites). Precedence becomes: non-Enter/IME → default; meta/ctrl → submit; alt → insert; else → default.

### 2. Both consuming surfaces update identically

- **Compose strip** (`app/frontend/src/components/compose-strip.tsx`): `enterKeyHint` becomes `"enter"` unconditionally (no longer `coarse ? "enter" : "send"` — the hint must stay truthful). The Send button's `Tip` keycap changes from `kbd="Enter"` to the platform-formatted Cmd/Ctrl+Enter chord (e.g. `⌘Enter` on mac, `Ctrl+Enter` elsewhere — match the tooltip-chip conventions from PR #506). Insert button tip (`Alt+Enter`) unchanged.
- **Chat send form** (`app/frontend/src/components/chat-view.tsx`): same flip via the shared classifier (user explicitly confirmed chat flips too); same `enterKeyHint` and tooltip updates where present. The "two surfaces must not diverge" doc comments stay true.

### 3. Readline key layer (new, shared)

A small keydown helper (suggested home: extend `app/frontend/src/lib/compose-keys.ts` or a sibling `readline-keys.ts` — pure + unit-testable, per the `palette-move.ts` extraction pattern) intercepting ONLY the chords missing natively:

| Chord | Action |
|---|---|
| Ctrl+U | kill from cursor to line start (readline unix-line-discard) |
| Ctrl+W | delete word backward |
| Alt+B / Alt+F | move cursor word backward / forward |
| Alt+D | delete word forward |

Wired into the compose strip's textarea `onKeyDown` and the chat input (shared helper, both surfaces — consistency mirror of the Enter classifier).

**Implementation constraints:**

- **Do NOT intercept natively-bound macOS chords** (Ctrl+A/E/B/F/P/N/D/H/K/T/O/Y, Opt+arrows, Opt+Delete) — the browser/Cocoa implementations are correct and interplay with the native kill buffer.
- **Undo preservation**: deletions MUST go through undo-preserving editing (`document.execCommand("delete"/"insertText")` — deprecated but the only undo-preserving path; selection-set + execCommand for the kill operations) rather than React `setText(...)`, which would break Cmd+Z.
- **`e.preventDefault()` + `e.stopPropagation()`** on handled chords (mirrors the existing Enter/Escape handling).
- **Word boundary definition**: whitespace-delimited words (readline default), not camelCase-aware.

**Conflict safety (verified against `app/frontend/src/lib/keybindings.ts`):** app chords are suppressed while a textarea has focus (`shouldSuppressChord`); only `ignoreInputs` bindings (⌘K, ⇧⌘E, ⇧⌘/, ⇧⌘,) punch through and none collide. Alt chords are excluded from every registry tier, so Alt+B/F/D interception steps on nothing.

**Platform caveat (documented, not solved):** on Windows/Linux **browsers**, Ctrl+W is browser-reserved (closes the tab, uninterceptable by a web page) — the binding works on macOS and in the desktop shell only; win/linux users keep native Ctrl+Backspace. Ctrl+U (view-source) IS interceptable via preventDefault and works everywhere.

### 4. Tests + companion docs

- `compose-keys.test.ts`: rewrite the Enter matrix for the new policy; add unit coverage for the readline helper (cursor/selection math on plain strings where extractable).
- `compose-strip.test.tsx` + chat-view unit tests: update Enter-behavior and `enterKeyHint` assertions.
- `tests/e2e/compose-strip.spec.ts` (+ any chat e2e asserting Enter): update send-flow steps to Cmd/Ctrl+Enter. Constitution (Test Companion Docs): the sibling `.spec.md` files MUST be updated in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) compose strip Enter policy (Enter=newline everywhere, Cmd/Ctrl+Enter=send), readline key layer, tooltip keycap + enterKeyHint changes
- `run-kit/chat`: (modify) chat send form Enter policy flip (shared classifier, pointer distinction removed)

## Impact

- `app/frontend/src/lib/compose-keys.ts` — classifier rewrite + (possibly) readline helper home
- `app/frontend/src/components/compose-strip.tsx` — onKeyDown wiring, enterKeyHint, Send tooltip
- `app/frontend/src/components/chat-view.tsx` — same for the chat send form
- `app/frontend/src/lib/compose-keys.test.ts`, `compose-strip.test.tsx`, chat-view tests
- `tests/e2e/compose-strip.spec.ts` + `.spec.md` (and chat e2e if it asserts Enter-to-send)
- `useCoarsePointer` usage: the subscription remains for touch-target styling elsewhere, but its Enter-policy role ends; remove from the Enter path only
- No backend, no API, no routes. Scope is the frontend keydown layer.

## Open Questions

*(none — both open decisions were resolved in conversation: chat flips too; Shift+Enter stays newline)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Enter=newline + Cmd/Ctrl+Enter=submit applies to BOTH compose strip and chat send form | Discussed — user explicitly confirmed "flip the other one too" | S:95 R:85 A:95 D:95 |
| 2 | Certain | Shift+Enter keeps inserting a newline (silently redundant) | Discussed — user explicitly confirmed | S:95 R:90 A:95 D:95 |
| 3 | Certain | Alt+Enter insert-without-submit and the Insert/Send buttons are unchanged | Existing behavior orthogonal to the flip; no signal to change it | S:85 R:90 A:90 D:90 |
| 4 | Confident | Intercept only the missing readline set (Ctrl+U, Ctrl+W, Alt+B/F/D); leave natively-bound macOS chords alone | Reimplementing native bindings breaks the Cocoa kill-buffer (Ctrl+K↔Ctrl+Y); analysis presented to user without objection | S:75 R:80 A:85 D:80 |
| 5 | Confident | Ctrl+U = kill to line START (readline unix-line-discard), not whole-line wipe | User said "backspace the whole line" but framed it as "the things you are used to on a terminal" — readline semantics is that convention; identical when cursor is at end-of-line | S:60 R:85 A:75 D:65 |
| 6 | Confident | Readline layer applies to both surfaces (compose strip + chat input) via one shared helper | Mirrors the shared-classifier consistency contract; marginal cost | S:55 R:85 A:80 D:70 |
| 7 | Confident | Deletions use `document.execCommand` to preserve the native undo stack | Only undo-preserving programmatic edit path; deprecated but universally supported | S:60 R:75 A:85 D:75 |
| 8 | Confident | Ctrl+W stays unclaimed on win/linux browsers (browser-reserved); documented, not worked around | Uninterceptable by a web page; desktop shell + mac cover the user's platforms | S:70 R:80 A:90 D:80 |
| 9 | Confident | `enterKeyHint="enter"` on all pointers; Send tooltip shows platform-formatted Cmd/Ctrl+Enter | Direct consequence of the flip; hint must stay truthful (260719-mxvw rule) | S:75 R:90 A:90 D:85 |
| 10 | Confident | Word boundaries are whitespace-delimited (readline default) | Terminal-convention framing of the request | S:55 R:90 A:80 D:70 |

10 assumptions (3 certain, 7 confident, 0 tentative, 0 unresolved).
