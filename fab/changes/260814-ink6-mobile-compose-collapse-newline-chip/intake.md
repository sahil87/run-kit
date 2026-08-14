# Intake: Mobile Compose Strip — Coarse-Pointer Collapse + Local-Newline Chip

**Change**: 260814-ink6-mobile-compose-collapse-newline-chip
**Created**: 2026-08-14

## Origin

Synthesized from a `/fab-discuss` session on 2026-08-14, dispatched promptless via the shared Create-Intake Procedure (`{questioning-mode} = promptless-defer`). The user reported the problem with a 375px iPhone screenshot, and a visual mock of the agreed layout was presented via `rk present` and **approved by the user** (mock file: scratchpad `compose-mobile-mock.html` — session-scoped, not a repo artifact; the layout it showed is fully specified below).

> **Problem (user-reported)**: with the docked compose strip open and the on-screen keyboard up on a 375px phone, barely any terminal is visible. The strip spends ~130px on three stacked rows (the `→ {target}` header row with × close, a `rows={2}` textarea, a full button row with 📎/Insert/Send) plus the 48px bottom-bar key row below it. Separately, there is no way to insert a local newline in the compose textarea on mobile — Shift+Enter is the only local-newline path and mobile keyboards cannot produce it.

Key decisions from the discussion: all changes are **coarse-pointer only** (desktop layout byte-untouched — the desktop two-row stack from `260724-2bmy` stays); the alternative of flipping the coarse-pointer Enter policy to the chat surface's semantics was **considered and rejected** (see Why); the coarse gating reuses the strip's existing `useCoarsePointer()` consumption.

## Why

1. **The pain point**: On a phone (375×812) with the keyboard up, the visual viewport is roughly halved; the compose strip's three stacked rows (~130px) plus the 48px bottom-bar key row eat most of what remains, leaving only a few terminal rows visible. The user is composing text *for* the pane they can no longer see — the strip's core value ("staged text visibly lands in the pane's composer") is defeated on exactly the device class where the strip matters most (xterm's canvas has no OS text input, so mobile input flows through the strip). Separately, multi-line composition is impossible on mobile: plain Enter is insert-line (transmit), Shift+Enter is the only local newline, and mobile keyboards cannot produce Shift+Enter.

2. **Consequence of not fixing**: mobile compose stays borderline unusable — users either compose blind (no terminal feedback) or abandon the strip for direct xterm typing (no IME/dictation, no attachments, no drafts). Multi-line prompts on mobile stay impossible without sending line-by-line into the pane's composer.

3. **Why this approach**: every change is a coarse-pointer-only *presentation* collapse — the Enter policy, send semantics, draft store, and desktop layout are untouched. The rejected alternative — flipping the coarse-pointer Enter policy to the chat surface's (`Enter` = local newline, Send button = sole submit, `enterKeyHint="enter"`, the messaging-app convention) — would revisit the documented pointer-independent Enter-policy design decision (`compose-strip.tsx` consumes no pointer hook *for Enter policy*; the divergence lives per-surface inside `classifyComposeEnter`, never at a call site) and would fork return-key semantics between phone and desktop for the same surface. It is noted as a possible future, deliberate intake — explicitly **not** part of this change. The additive `⏎` chip delivers the missing local-newline capability without touching the classifier.

Combined saving ≈ 130px ≈ 8–9 extra terminal rows visible with the keyboard up (11px mobile terminal font → ~15px rows).

## What Changes

All five changes are gated on **coarse pointers only**, using the strip's existing `useCoarsePointer()` consumption pattern (it already gates the placeholder strings on it — `compose-strip.tsx:272`; note the project's documented "two pointer policies stay unmerged" posture when choosing the predicate — this is the `pointer: coarse` axis, not the width-based `isMobileViewport()` rule). Desktop (fine-pointer) rendering stays byte-identical, including the two-row stack from `260724-2bmy`.

### 1. Hide the bottom bar while the compose textarea is focused (coarse only)

While the compose strip's textarea has focus on a coarse pointer, the bottom-bar key row (`Tab Ctrl Alt Fn▴ ArrowPad | ⌘K a▏ ⌨`, `h-[48px]`) is hidden; it is restored on blur. The bottom-bar keys send keystrokes to the terminal via the focused `wsRef` and are dead weight mid-compose (the strip has its own input). Saves ~44–48px. Escape already blurs the textarea (the strip's focus contract — Escape blurs, never closes), so blur-restore has a clean seam; tapping the terminal or dismissing the keyboard likewise blurs and restores the bar.

Mount topology: the strip and `BottomBar` are siblings at two shell footers — `app.tsx` (AppShell) and `app/frontend/src/components/board/board-page.tsx` (board twin; `BottomBar` is byte-identical across them, reading `focused?.wsRef` from `FocusedTerminalContext`). The hide logic MUST work on both footers. Mobile always uses the footer dock (the in-tile dock predicate includes `!isMobile`), so the in-tile dock never needs this. The focus signal crosses two sibling components — the seam (context, chrome state, or a module-slot signal like `compose-strip-events.ts`) is an apply-time choice; what is fixed is the behavior: focus hides, blur restores, coarse-only.

Caveat surfaced in discussion: the hide/show changes footer height → terminal container `ResizeObserver` → `fitAndSync` (FitAddon `fit()` + tmux resize) on every focus change — the same reflow class as toggling the strip itself. Believed fine, but watch for resize churn against a busy pane during apply/review.

### 2. Fold the header row away on coarse when it carries no unique signal

On a phone there is one visible pane, so the `→ {target}` header row is redundant — fold the target name into the textarea placeholder (e.g. `→ grainy-magpie…` replacing the coarse `Compose text…`). The header's × close is droppable there too: closing remains lossless (the module draft store keys drafts per target and survives toggle-off) and two toggle affordances remain reachable (the bottom-bar `a▏` chip — visible whenever the textarea is not focused — and the `View: Text Input` palette action; the ⇧⌘E chord additionally works with a hardware keyboard).

The header MUST return (render as today) whenever it carries real signal:
- **Selection-broadcast mode** (`→ N selected` — the frozen-recipient mode, plus its `Sending…`/uploading affordances), and
- **the disabled no-target state** (`focused === null` — the "no target" label).

On fine pointers the header row renders unconditionally, exactly as today.

### 3. Collapse to a single row on coarse: 📎 · textarea (flex-1) · ⏎ · Send

The coarse layout replaces the two-row stack (textarea row + button row) with one `flex` row: 📎 attach chip, the textarea at `flex-1`, the new `⏎` chip (change 5), and Send. The **Insert button is dropped on coarse** — it is redundant there: the mobile return key already performs insert-line (`enterKeyHint="send"`; plain Enter = insert-line per `classifyComposeEnter` surface `"strip"`). Bounded auto-grow keeps working (the scrollHeight-based `resize()` is layout-agnostic); the flanking buttons bottom-align (`items-end`) so a grown textarea rises above them. Existing chip affordances carry over: `preventFocusSteal` on every button, `coarse:min-h-[36px]`/`coarse:min-w-[36px]` touch targets, existing enablement rules (📎 gated by `canUpload`, Send by `canSubmit`).

Desktop keeps the two-row stack byte-identical (row 1: textarea `w-full`; row 2: 📎 left, `ml-auto` Insert + Send).

### 4. `rows={1}` floor on coarse

The textarea's `rows` attribute becomes 1 on coarse pointers (desktop keeps `rows={2}`). The auto-grow floor follows the `rows` attribute by construction (the `height = "auto"` measurement resolves to it), so the strip opens at one line on a phone and grows to the unchanged `MAX_TEXTAREA_ROWS = 6` bound, settling back to one row when emptied.

### 5. New coarse-only `⏎` chip — the Shift+Enter equivalent

A new chip between the textarea and Send (coarse only) inserts `"\n"` at the caret — the local-newline path mobile keyboards cannot reach. Requirements:

- **Undo-safe insertion** consistent with `lib/readline-keys.ts`: `document.execCommand("insertText", false, "\n")` so the native undo stack survives, with the controlled-component-safe fallback (prototype value setter + a bubbled `input` event) when `execCommand` is missing or returns false (jsdom, future removals). Caret lands after the inserted newline; the store-controlled textarea persists the mutation as the draft and auto-grows as if typed.
- **Ends any sent-history recall walk** like other text mutations (the walk's exit rule: any text mutation that is not a recall step calls `endRecall()`).
- `preventFocusSteal` on `onMouseDown` (the keyboard must not dismiss), coarse touch-target sizing, the strip's secondary-button vocabulary, an `aria-label` (e.g. `Insert newline`) and a `data-testid`.
- Enablement: usable whenever the textarea is usable (it is a local edit, not a send — no target/text gating beyond the disabled no-target state where the textarea itself is disabled).
- **Additive only**: `classifyComposeEnter` stays pointer-independent (documented design decision — the strip consumes no pointer hook for Enter policy), and `enterKeyHint` stays `"send"` on the terminal arm (`"enter"` in selection mode, unchanged).
- **Selection-broadcast mode: the chip is hidden.** Broadcast takes the chat Enter policy, where plain Enter is already a local newline — the chip would duplicate the return key. (Low-stakes call left open in discussion; hide is the consistent default — Assumptions row 8.)

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Docked Compose Strip — coarse-pointer layout (header fold, single row, `rows={1}` floor, ⏎ chip) and § Bottom Bar — compose-focus hide. Also correct the now-stale "`compose-strip.tsx` consumes no pointer hook at all" line (the coarse placeholder gating already consumes `useCoarsePointer()`; the pointer-independent claim is true of the Enter policy only).

## Impact

- `app/frontend/src/components/compose-strip.tsx` — coarse layout branch (header fold, single row, `rows` floor, ⏎ chip), focus/blur signal emission
- `app/frontend/src/components/compose-strip.test.tsx` — colocated Vitest coverage (coarse vs fine rendering, header return in broadcast/no-target modes, ⏎ insertion + undo-safe fallback + recall-walk exit)
- `app/frontend/src/components/bottom-bar.tsx` — hide-while-compose-focused (coarse only); `bottom-bar.test.tsx` updates
- `app/frontend/src/app.tsx` and `app/frontend/src/components/board/board-page.tsx` — the two footer mounts where strip + BottomBar are siblings (wiring only, per the chosen signal seam)
- `app/frontend/src/hooks/use-coarse-pointer.ts` — read-only (existing predicate)
- `app/frontend/src/lib/compose-keys.ts` — read-only (Enter policy untouched)
- `app/frontend/src/lib/readline-keys.ts` — pattern source for the undo-safe insertion (possibly a small shared helper extraction)
- `app/frontend/tests/e2e/compose-strip.spec.ts` (+ sibling `.spec.md`) — Playwright coverage where possible (coarse-pointer emulation via touch-enabled device descriptors); per constitution the `.spec.md` updates in the same commit
- No backend, API, or routing changes. No new chrome preference or localStorage key.

## Open Questions

- None — the discussion resolved direction on every point; remaining implementation choices are graded in Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All five changes gate on coarse pointers via the existing `useCoarsePointer()` pattern; desktop/fine-pointer layout byte-untouched | Discussed — explicit user decision, verified the hook is already consumed at compose-strip.tsx:272 | S:90 R:85 A:90 D:90 |
| 2 | Certain | Hide the bottom bar while the compose textarea is focused (coarse only), restore on blur; Escape-blurs contract is the seam | Discussed — agreed change 1, with the refit caveat noted for review | S:90 R:80 A:85 D:85 |
| 3 | Certain | Fold the `→ {target}` header on coarse into the placeholder (`→ {name}…`) and drop the × there; header returns for selection-broadcast and disabled no-target states | Discussed — agreed change 2 including the must-return conditions; closing stays lossless via the module draft store | S:85 R:80 A:85 D:80 |
| 4 | Certain | Single coarse row 📎 · textarea (flex-1) · ⏎ · Send; Insert dropped on coarse (return key already inserts via `enterKeyHint="send"`) | Discussed — agreed change 3, user approved the visual mock | S:90 R:80 A:85 D:85 |
| 5 | Certain | `rows={1}` floor on coarse, desktop `rows={2}`; `MAX_TEXTAREA_ROWS = 6` unchanged | Discussed — agreed change 4; auto-grow floor follows the `rows` attribute by construction | S:90 R:90 A:90 D:90 |
| 6 | Certain | ⏎ chip inserts `"\n"` at caret via undo-safe `execCommand` + controlled-component fallback (readline-keys pattern) and ends any recall walk; `classifyComposeEnter` and `enterKeyHint` untouched | Discussed — agreed change 5 with the insertion-path and walk-exit requirements stated explicitly | S:85 R:85 A:85 D:85 |
| 7 | Certain | Coarse Enter-policy flip to chat semantics is rejected for this change; noted as a possible future, deliberate intake | Discussed — user rejected it to preserve the pointer-independent Enter-policy design decision | S:90 R:90 A:90 D:90 |
| 8 | Confident | ⏎ chip is hidden (not disabled) in selection-broadcast mode | Discussed as a low-stakes open call; hide is the consistent default since broadcast's plain Enter is already a local newline | S:55 R:90 A:80 D:70 |
| 9 | Confident | The compose-focus→bottom-bar signal seam (context vs chrome state vs module slot à la `compose-strip-events.ts`) is an apply-time choice; behavior (focus hides, blur restores, both footer mounts) is fixed | Cross-sibling wiring detail with several equivalent shapes; trivially reversible, codebase precedents exist | S:60 R:85 A:75 D:60 |
| 10 | Confident | Focus/blur-driven terminal refit churn is accepted (same reflow class as toggling the strip); verified against a busy pane during apply/review, no debounce added up front | Discussed — "believed fine, watch for churn"; adding a guard preemptively would be speculative | S:70 R:80 A:70 D:75 |
| 11 | Certain | Tests: colocated Vitest `compose-strip.test.tsx` (+ `bottom-bar.test.tsx`) and Playwright e2e where possible with sibling `.spec.md` updated in the same commit | Constitution (Test Companion Docs; UI changes include tests) and code-quality.md answer this deterministically | S:80 R:95 A:100 D:95 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved).
