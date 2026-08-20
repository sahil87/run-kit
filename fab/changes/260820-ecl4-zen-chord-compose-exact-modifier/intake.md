# Intake: Zen chord fires from compose surfaces (exact-modifier Enter classifier)

**Change**: 260820-ecl4-zen-chord-compose-exact-modifier
**Created**: 2026-08-20

## Origin

Created via promptless dispatch from a design discussion with the user (all decisions below are final — the discussion considered and rejected a rebind before settling on the classifier fix).

> **Bug fix**: the ⇧⌘⏎ / ⇧Ctrl+⏎ zen-toggle chord does not work when focus is in the compose strip or the chat send form — the shared Enter classifier swallows it.

Key decisions from the discussion (final, do not reopen):

- **Keep ⇧⌘⏎ / ⇧Ctrl+⏎ as the zen default.** A ⌘Y rebind was considered and REJECTED: ⇧⌘⏎ matches iTerm2's maximize-pane convention; ⌘Y is History in mac browsers with uncertain page-interceptability; Ctrl+Y is readline yank so win/linux could never mirror it. The chord isn't broken — the classifier is.
- **Fix = exact-modifier matching in `classifyComposeEnter`**: meta/ctrl+Enter WITH shift held returns `"default"` (not `"submit"`), so the keydown is left un-consumed at both surfaces and bubbles to the global chord dispatcher, where zen-toggle fires.
- **Scope guard**: ONLY the classifier fix + tests (+ memory lines asserting the classifier's Enter policy). The multi-window and ⌘N/⌘T/⇧⌘T rebinding topics from the same conversation are explicitly OUT of scope — separate future change.

## Why

1. **The pain point**: the zen-toggle chord (⇧⌘⏎ on mac, ⇧Ctrl+⏎ elsewhere — `zen-toggle` in `app/frontend/src/lib/keybindings.ts:245`) is registered with `ignoreInputs: true` precisely so it can fire from the compose textarea ("the chord must fire from the compose textarea", per its own comment). But it never receives the keydown when focus is in the compose strip or the chat send form: `classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts:65`) checks `metaKey || ctrlKey → "submit"` BEFORE consulting `shiftKey`, so ⇧⌘⏎ / ⇧Ctrl+⏎ classifies as `"submit"`, and both call sites consume every non-default action with `preventDefault()` + `stopPropagation()` (explicitly "so it never bubbles to global chords" — `compose-strip.tsx:659-665`, `chat-view.tsx:249-254`). The user submits their draft instead of toggling zen.

2. **The consequence if unfixed**: zen mode is keyboard-unreachable from exactly the surface its binding was designed to serve (`ignoreInputs: true` exists for this), violating Constitution V (keyboard-first). Worse, the chord is destructive-ish: instead of a no-op it fires an unintended submit of the staged text at a live agent.

3. **Why this approach over alternatives**: the design intent was always exact-modifier matching — the zen binding's comment claims "exact-modifier matching keeps the chord disjoint from the classifier-owned ⌘Enter/Ctrl+Enter compose-submit chords, which never carry Shift". The classifier implementation drifted from that intent. The documented contract everywhere (classifier header, tooltips via `composeSubmitKeycap()`, memory files) already states Cmd/Ctrl+Enter *without* Shift is "the ONLY submit chord"; nothing relies on ⇧⌘⏎-as-submit. Fixing the classifier restores the documented contract; rebinding zen (rejected, above) would have papered over the drift and cost the iTerm2 convention.

## What Changes

### 1. Classifier: exact-modifier submit in `classifyComposeEnter`

`app/frontend/src/lib/compose-keys.ts` — the submit branch gains a shift guard. Current implementation (line 63-69):

```ts
if (key.key !== "Enter" || key.isComposing) return "default";
if (key.metaKey || key.ctrlKey) return "submit";
if (key.altKey) return "insert";
if (key.shiftKey) return "default";
return surface === "strip" ? "insert-line" : "default";
```

New behavior: `meta/ctrl + Enter` **with `shiftKey` held** returns `"default"` — unconditionally (regardless of `altKey`), so every shift-carrying meta/ctrl+Enter chord is left un-consumed and bubbles to the global dispatcher. E.g.:

```ts
if (key.key !== "Enter" || key.isComposing) return "default";
if (key.metaKey || key.ctrlKey) return key.shiftKey ? "default" : "submit";
if (key.altKey) return "insert";
if (key.shiftKey) return "default";
return surface === "strip" ? "insert-line" : "default";
```

New precedence (first match wins): non-Enter / IME-composing → default; meta/ctrl **without shift** → submit (the only submit chord, now exact on shift); meta/ctrl **with shift** → default (bubbles to global chords — zen-toggle); alt → insert; shift alone → default (local newline); plain Enter → insert-line on the strip, default (newline) in chat.

**Unchanged** (explicit non-goals within the classifier): Alt+Enter (insert, byte-exact), Shift+Alt+Enter without meta/ctrl (insert — alt still outranks bare shift, existing test `compose-keys.test.ts:59`), Shift+Enter alone (default/local newline), plain-Enter per-surface divergence (strip insert-line vs chat newline), the IME-composing guard, `composeSubmitKeycap()` and both Send tooltips (they already render the shift-less chord).

Update the classifier's header comment and the `classifyComposeEnter` docstring (lines 54-58) to state the exact-modifier precedence — the header's "Cmd/Ctrl+Enter = submit — the ONLY submit chord" line becomes literally true and should note that Shift+Cmd/Ctrl+Enter deliberately falls through for the global zen chord.

### 2. Call sites: no logic change

`app/frontend/src/components/compose-strip.tsx` (keydown handler, `classifyComposeEnter` call at line 643, consume at 659-665) and `app/frontend/src/components/chat-view.tsx` (ChatSendForm `onKeyDown`, call at line 238, consume at 249-254) already early-return on `"default"` before the `preventDefault()`/`stopPropagation()` consume — so the fix requires **no call-site code change**; the chord bubbles automatically once the classifier returns `"default"`. Only touch these files if a comment states the old matrix (e.g. compose-strip's "Consume every non-default action" comment is still accurate; no edit expected).

The global side is already correct: `zen-toggle` (`keybindings.ts:245`) is `tier: "shifted"`, `code: "Enter"`, `scope: "terminal"`, `ignoreInputs: true`, and `keybindings.test.ts:348-380` already proves ⇧⌘⏎ / ⇧Ctrl+⏎ match zen-toggle alone via exact-modifier matching. No keybindings change.

### 3. Tests

- **`app/frontend/src/lib/compose-keys.test.ts`** — update the classifier matrix:
  - FLIP the existing assertion at line 56: `key({ metaKey: true, shiftKey: true })` must now be `"default"`, not `"submit"` (the "modifier precedence" test's framing changes: shift+meta/ctrl is exact-modifier fall-through, not "meta beats shift").
  - ADD cases on BOTH surfaces: `metaKey+shiftKey → "default"`, `ctrlKey+shiftKey → "default"`, `metaKey+shiftKey+altKey → "default"` (shift guard wins over alt inside the meta/ctrl branch), and keep `metaKey` / `ctrlKey` alone → `"submit"`.
  - Keep the untouched cases green: `altKey+shiftKey → "insert"`, `shiftKey → "default"`, plain-Enter divergence, IME guard.
- **Call-site tests** — `compose-strip.test.tsx` and `chat-view.test.tsx` currently assert no shift+meta/ctrl swallow case (verified by grep), so nothing to delete. ADD a non-consumption test per surface: dispatch a ⇧⌘⏎ (and/or ⇧Ctrl+⏎) keydown on the focused textarea and assert it is NOT consumed — nothing sent (no `ws.send` / no submit POST), `preventDefault` not called — so it bubbles to global chords.
- **Zen-fires verification** from (a) compose strip focused, (b) chat send form focused, (c) terminal focused: (c) is already covered by `keybindings.test.ts`'s exact-modifier match + `ignoreInputs` tests; (a)/(b) are covered by the new non-consumption tests combined with the existing dispatcher coverage. A component-integration or e2e test proving the full chain (focused textarea → zen zoom toggles) is welcome if an existing spec surface accommodates it cheaply, but not required (see Assumptions #5).

### 4. Memory updates (Enter-policy lines that enumerate the chord matrix)

- `docs/memory/run-kit/ui/compose-and-bottom-bar.md` § "Send semantics" — the precedence enumeration ("Precedence (first match wins): non-Enter/IME-composing → default; meta/ctrl → submit; alt → insert; shift → default; plain Enter → insert-line (strip) / default (chat)") gains the exact-modifier shift carve-out; note that a shift-carrying meta/ctrl+Enter falls through un-consumed for the global zen chord.
- `docs/memory/run-kit/chat.md` — the two send-form Enter-policy passages (~lines 794-800 and ~1176-1184) enumerate the same precedence and get the same update.
- `docs/memory/run-kit/ui/keyboard-and-palette.md` — the zen-chord entries (~line 88 and the Design Decision at ~line 336) claim "exact-modifier matching keeps the chord disjoint from the classifier-owned ⌘Enter/Ctrl+Enter compose-submit chords, which never carry Shift"; that claim was design intent the classifier had drifted from and now becomes true. At most a small note that the classifier enforces the disjointness (shift+meta/ctrl+Enter → default); possibly no edit needed.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) precedence enumeration in § Send semantics gains the exact-modifier shift carve-out (shift+meta/ctrl+Enter → default, bubbles to zen)
- `run-kit/chat`: (modify) the send-form Enter-policy passages (precedence enumeration + "every other rule is shared" summary) updated the same way
- `run-kit/ui/keyboard-and-palette`: (modify) zen-chord entry/DD — the "which never carry Shift" disjointness claim is now enforced by the classifier; minor note at most

## Impact

- **Code**: `app/frontend/src/lib/compose-keys.ts` only (one-line logic change + docstring updates). No call-site logic changes (`compose-strip.tsx`, `chat-view.tsx` already fall through on `"default"`), no `keybindings.ts` change, no tooltip/keycap change, no backend involvement.
- **Tests**: `app/frontend/src/lib/compose-keys.test.ts` (flip 1 assertion, add shift+meta/ctrl cases), `app/frontend/src/components/compose-strip.test.tsx` + `app/frontend/src/components/chat-view.test.tsx` (add non-consumption/bubble tests).
- **Behavior**: ⇧⌘⏎ / ⇧Ctrl+⏎ with focus in either compose surface now toggles zen instead of submitting the draft. No user-visible contract changes otherwise — the documented submit chord (⌘Enter / Ctrl+Enter, shift-less) is unchanged.
- **Risk**: low — the change tightens the classifier toward its documented contract; the only behavior removed (shift+meta/ctrl+Enter submitting) was undocumented drift nothing relies on.
- **Out of scope**: multi-window and ⌘N/⌘T/⇧⌘T rebinding topics from the same conversation (separate future change); any change to zen-toggle's binding, scope, or `ignoreInputs` handling.

## Open Questions

- None — all decisions were made and finalized in the originating design discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep ⇧⌘⏎ / ⇧Ctrl+⏎ as the zen default; no rebind (⌘Y considered and rejected: iTerm2 convention wins, ⌘Y is mac-browser History, Ctrl+Y is readline yank) | Discussed — user decision final in the originating conversation | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix is exact-modifier matching in `classifyComposeEnter`: meta/ctrl+Enter WITH shift → `"default"`, un-consumed at both surfaces so it bubbles to the global zen chord | Discussed — chosen over rebinding; matches the design intent stated in `keybindings.ts:239-244` and the documented "ONLY submit chord" contract; verified against source this session | S:95 R:90 A:90 D:90 |
| 3 | Certain | Everything else unchanged: Alt+Enter insert, Shift+Enter local newline, plain-Enter per-surface divergence, IME guard, tooltips/keycaps, zen binding itself | Discussed — explicit "Unchanged" list in the decision record; existing tests pin these | S:90 R:90 A:90 D:95 |
| 4 | Confident | Shift+meta/ctrl+alt+Enter (all held) also returns `"default"` — the shift guard applies inside the meta/ctrl branch before alt is consulted | The decided rule ("meta/ctrl WITH shift → default") reads unconditional on shift; uniform fall-through of shift-carrying meta/ctrl chords is the simplest disjointness rule; shift+alt WITHOUT meta/ctrl stays insert per existing test | S:70 R:85 A:75 D:65 |
| 5 | Confident | Zen-fires verification (a/b/c) is satisfied at unit/component level: classifier matrix + per-surface non-consumption (bubble) tests + existing `keybindings.test.ts` exact-modifier dispatch coverage; a full-chain e2e is optional, added only if an existing spec surface accommodates it cheaply | code-quality.md says e2e "where possible" (SHOULD, not MUST); no zen e2e spec exists today; the chain decomposes cleanly into already-tested halves | S:60 R:85 A:75 D:60 |
| 6 | Confident | Memory scope is the three files listed in Affected Memory; `keyboard-and-palette.md` may need no edit (its disjointness claim becomes true rather than stale) | Grep-verified: these are the only memory files enumerating the classifier's chord matrix; whether the now-true claim warrants a note is hydrate-time judgment | S:75 R:90 A:80 D:65 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
